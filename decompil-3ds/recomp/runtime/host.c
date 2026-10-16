/* Les fils de la console dans le processus du PC : une fibre Windows par fil de la console.

   Pourquoi des fibres. Le C généré garde l'état d'un fil dans sa pile C (une fonction appelle l'autre, les registres
   sont des variables locales). On ne peut donc pas « ranger » l'état d'un fil comme le fait unicorn (un contexte de
   registres) : il faut ranger la pile entière. Une fibre est exactement cela : une pile et un point de reprise, que
   l'on quitte et reprend à la main (SwitchToFiber), sans ordonnanceur du système, sans verrou et sans attente. Un seul
   fil de la console tourne à la fois, ce qui est aussi ce que fait le noyau du banc.

   Qui reprend la main. Le fil du PC qui lance le banc (Python) est le « maître » : il appelle host_resume, qui passe
   dans la fibre du fil de la console. La fibre rend la main (host_yield) dans quatre cas :
     - HS_SVC    un appel système : le noyau en Python le traite, puis reprend la fibre juste après ;
     - HS_LIMIT  le compteur de branchements en arrière est épuisé : fin de tranche, préemption coopérative ;
     - HS_HOOK   un repère (watch) est atteint ;
     - HS_MISS   un saut vers une adresse qui n'est pas du code recompilé (module .cro...) : l'hôte fait tourner ce
                 code autrement (unicorn), puis dit à la fibre de continuer (CMD_RETURN) ou d'exécuter une fonction
                 recompilée appelée depuis ce code (CMD_CALL).
   Et quand l'appel de plus haut niveau finit (HS_DONE) ou sort sur une faute (HS_FAULT...).

   Les réglages de l'arrondi flottant (MXCSR) sont ceux de la console dans la fibre et ceux de l'hôte dehors. */
#include <windows.h>
#include <setjmp.h>
#include <stdlib.h>
#include <fenv.h>
#include <xmmintrin.h>
#include "rt.h"

#define RT_EXPORT __declspec(dllexport)

enum { HS_DONE = 0, HS_SVC = 1, HS_LIMIT = 2, HS_HOOK = 3, HS_MISS = 4,
       HS_FAULT = 5, HS_UNIMPL = 6, HS_NOTARGET = 7, HS_OVERRUN = 8, HS_BADCMD = 9 };
enum { CMD_CALL = 1, CMD_CONTINUE = 2, CMD_RETURN = 3 };

typedef struct Ctx {
    Cpu cpu;                /* en premier : un Cpu* est un Ctx* */
    void *fiber;
    int status;             /* pourquoi la fibre a rendu la main */
    int cmd;                /* ce que l'hôte demande en reprenant */
    u32 arg;                /* adresse à appeler (CMD_CALL) */
    u32 info0, info1;       /* HS_SVC : numéro, pc. HS_LIMIT, HS_HOOK : pc. HS_MISS : adresse visée */
    jmp_buf *jmp;
} Ctx;

extern jmp_buf *rt_jmp;
extern void (*rt_miss_hook)(Cpu *, u32);
int rt_call(Cpu *c, u32 addr);
void rt_set_svc_hook(void (*hook)(Cpu *, u32, u32));
u32 rt_get_info(int i);

static void *host_fiber;

/* ---- dans la fibre ---- */

static void host_yield(Ctx *x, int status, u32 i0, u32 i1) {
    x->status = status;
    x->info0 = i0;
    x->info1 = i1;
    unsigned csr = _mm_getcsr();
    int round = fegetround();
    SwitchToFiber(host_fiber);
    _mm_setcsr(csr);
    fesetround(round);
}

static void host_svc(Cpu *c, u32 number, u32 pc) {
    host_yield((Ctx *)c, HS_SVC, number, pc);
}

void rt_yield_slow(Cpu *c, u32 pc) {
    host_yield((Ctx *)c, HS_LIMIT, pc, 0);
}

void rt_hook_slow(Cpu *c, u32 pc) {
    host_yield((Ctx *)c, HS_HOOK, pc, 0);
}

/* Un saut vers du code non recompilé. L'hôte le fait tourner, puis reprend avec CMD_RETURN (le code est revenu à
   l'appelant : on rend la main au C qui nous a appelés) ou CMD_CALL (ce code appelle une fonction recompilée : on
   l'exécute ici, sur la pile de la fibre, puis on le dit à l'hôte). */
static void host_miss(Cpu *c, u32 addr) {
    Ctx *x = (Ctx *)c;
    host_yield(x, HS_MISS, addr, 0);
    for (;;) {
        if (x->cmd == CMD_RETURN) return;
        if (x->cmd != CMD_CALL) {
            for (;;) host_yield(x, HS_BADCMD, (u32)x->cmd, 0);     /* l'hôte s'est trompé : on ne repart pas */
        }
        rt_dispatch(c, x->arg);
        host_yield(x, HS_DONE, 0, 0);
    }
}

static VOID CALLBACK fiber_main(PVOID param) {
    Ctx *x = (Ctx *)param;
    for (;;) {
        int code = x->cmd == CMD_CALL ? rt_call(&x->cpu, x->arg) : -1;
        int status = HS_DONE;
        switch (code) {
        case -1: status = HS_BADCMD; break;
        case RT_OK: status = HS_DONE; break;
        case RT_FAULT: status = HS_FAULT; break;
        case RT_UNIMPLEMENTED: status = HS_UNIMPL; break;
        case RT_NO_TARGET: status = HS_NOTARGET; break;
        default: status = HS_OVERRUN; break;
        }
        host_yield(x, status, rt_get_info(0), rt_get_info(1));
    }
}

/* ---- côté hôte (appelé par ctypes) ---- */

RT_EXPORT int host_init(void) {
    if (host_fiber) return 0;
    host_fiber = ConvertThreadToFiberEx(NULL, 0);
    if (!host_fiber) {
        if (GetLastError() != ERROR_ALREADY_FIBER) return -1;
        host_fiber = GetCurrentFiber();
    }
    rt_set_svc_hook(host_svc);
    rt_miss_hook = host_miss;
    return 0;
}

RT_EXPORT u32 host_ctx_size(void) { return (u32)sizeof(Ctx); }

RT_EXPORT Cpu *host_new(void) {
    Ctx *x = (Ctx *)calloc(1, sizeof(Ctx));
    if (!x) return NULL;
    x->cpu.excl_addr = 0xFFFFFFFFu;
    x->cpu.user = x;
    x->cpu.ras = (u32 *)calloc(65536, sizeof(u32));
    return &x->cpu;
}

RT_EXPORT void host_free(Cpu *c) {
    Ctx *x = (Ctx *)c;
    if (x->fiber) DeleteFiber(x->fiber);
    free(x->cpu.ras);
    free(x);
}

/* Abandonne la pile C du fil (la fibre et la pile des adresses de retour) : le fil repartira d'une fonction neuve. */
RT_EXPORT void host_reset(Cpu *c) {
    Ctx *x = (Ctx *)c;
    if (x->fiber) DeleteFiber(x->fiber);
    x->fiber = NULL;
    x->jmp = NULL;
    c->rsp = 0;
}

RT_EXPORT void host_ras_push(Cpu *c, u32 v) { RT_PUSH(v); }
RT_EXPORT void host_ras_pop(Cpu *c) { RT_POP_QUIET(); }

/* Passe dans la fibre. cmd : CMD_CALL (arg = adresse), CMD_CONTINUE, CMD_RETURN. budget : branchements en arrière
   permis avant de rendre la main (HS_LIMIT). Rend le statut ; les détails sont dans info0 et info1. */
RT_EXPORT int host_resume(Cpu *c, int cmd, u32 arg, int budget) {
    Ctx *x = (Ctx *)c;
    if (!x->fiber) {
        x->fiber = CreateFiberEx(128 * 1024, 2 * 1024 * 1024, 0, fiber_main, x);
        if (!x->fiber) return HS_BADCMD;
    }
    x->cmd = cmd;
    x->arg = arg;
    c->budget = budget;
    jmp_buf *saved_jmp = rt_jmp;
    unsigned csr = _mm_getcsr();
    int round = fegetround();
    rt_jmp = x->jmp;
    SwitchToFiber(x->fiber);
    x->jmp = rt_jmp;
    rt_jmp = saved_jmp;
    _mm_setcsr(csr);
    fesetround(round);
    return x->status;
}
