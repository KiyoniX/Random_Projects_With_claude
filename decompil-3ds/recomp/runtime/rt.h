/* Le support d'exécution du code ARM recompilé en C.

   Le recompilateur (recomp/recomp.py) produit des fonctions C qui incluent ce fichier. Il ne contient rien du jeu :
   l'état du processeur, l'accès à la mémoire de la console (par table de pages), les opérations de l'ARM qui n'ont
   pas d'équivalent direct en C (décalages avec retenue, drapeaux, saturations, VFP) et l'aiguillage des appels.

   La mémoire de la console (4 Gio d'adresses) ne peut pas être projetée telle quelle sur le PC : chaque page de
   4 Kio est donc retrouvée par une table (adresse >> 12) -> pointeur du PC. Une page absente de la table est une
   faute, rendue à l'hôte par rt_fault. */
#ifndef RT_H
#define RT_H

#include <stdint.h>
#include <string.h>

typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int32_t s32;
typedef uint64_t u64;
typedef int64_t s64;

/* Les registres VFP : 32 simples ou 16 doubles, les mêmes octets (petit boutien : d[i] = s[2i] | s[2i+1] << 32). */
typedef union VfpRegs {
    u32 s[32];
    u64 d[16];
    float f[32];
    double df[16];
} VfpRegs;

/* L'état d'un fil. Les fonctions recompilées en gardent une copie dans des variables locales (r0..lr, drapeaux) et
   la rendent ici avant chaque appel et chaque retour. Les drapeaux sont séparés, chacun vaut 0 ou 1. */
typedef struct Cpu {
    u32 r[16];              /* r0-r12, sp (13), lr (14) ; r[15] : l'adresse visée par le dernier retour (pop {pc}, bx lr), pour l'hôte */
    u32 nf, zf, cf, vf, qf; /* N Z C V Q */
    u32 ge;                 /* GE[3:0] */
    u32 fpscr;              /* FPSCR complet, drapeaux N Z C V de la VFP dans les bits 31 à 28 */
    u32 fpexc;
    u32 tls;                /* registre du stockage local du fil (c13, c0, 3) */
    u32 excl_addr;          /* moniteur exclusif (ldrex / strex) ; 0xFFFFFFFF = aucun */
    s32 budget;             /* nombre de branchements en arrière permis (constructions de test seulement) */
    VfpRegs vfp;
    void *user;             /* à l'usage de l'hôte */
    u32 *ras;               /* pile des adresses de retour des appels en cours (construction RT_HOST, voir RT_PUSH) */
    u32 rsp;
    u32 hint;               /* dernière entrée de fonction (construction RT_HOST) : situe une faute */
} Cpu;

typedef void (*RtFunc)(Cpu *);

typedef struct RtEntry {
    u32 addr;               /* adresse ARM, bit 0 à 1 pour un point d'entrée Thumb */
    RtFunc fn;
} RtEntry;

/* Les modules .cro recompilés (recomp/cro_recomp.py). Le C d'un module est relogeable : ses adresses dérivées de pc sont
   RT_MBASE + décalage, où RT_MBASE = rt_mb[indice] est la base réelle du module, posée par l'hôte au chargement
   (rt_mod_set_base) et remise à 0 au déchargement. Un module à base 0 n'est pas cherché par l'aiguillage. */
typedef struct RtModule {
    const char *name;
    const RtEntry *table;   /* triée : décalage dans le module (bit 0 à 1 pour un point d'entrée Thumb) -> fonction */
    u32 table_len;
    u32 index;              /* case de rt_mb */
    u32 code_off, code_size;
} RtModule;
#define RT_MAX_MODULES 256
extern u32 rt_mb[RT_MAX_MODULES];
void rt_mod_register(RtModule *m);

/* Rempli par le code généré (table.c) : toutes les fonctions recompilées, triées par adresse. */
extern const RtEntry rt_table[];
extern const u32 rt_table_len;
/* Adresses (hors entrées de fonction) où le C généré a un repère RT_HOOK : voir `recomp.py gen --hooks`. */
extern const u32 rt_hook_points[];
extern const u32 rt_hook_points_len;

/* ---- la mémoire ---- */

extern u8 *rt_rpage[1 << 20];       /* page lisible -> pointeur du PC (ou NULL) */
extern u8 *rt_wpage[1 << 20];       /* page inscriptible -> pointeur du PC (ou NULL) */

u32 rt_rd_slow(u32 addr, int size);
void rt_wr_slow(u32 addr, u32 value, int size);

#define RT_LIKELY(x) __builtin_expect(!!(x), 1)
#define RT_UNLIKELY(x) __builtin_expect(!!(x), 0)

/* Mode vérification (RT_LOGW) : chaque écriture est journalisée, avec l'état d'avant de la page (pour revenir en arrière),
   et chaque entrée de fonction aussi (voir logw.c). */
#ifdef RT_LOGW
extern int rt_logw_on;
void rt_logw(u32 addr, u32 value, int size);
void rt_trace_entry(Cpu *c, u32 pc);
#define RT_LOGW_WRITE(a, v, n) do { if (rt_logw_on) rt_logw(a, v, n); } while (0)
#define RT_TRACE_ENTRY(pc) do { if (rt_logw_on) rt_trace_entry(c, pc); } while (0)
#else
#define RT_LOGW_WRITE(a, v, n) do { } while (0)
#define RT_TRACE_ENTRY(pc) do { } while (0)
#endif

static inline u32 rd32(u32 a) {
    u8 *p = rt_rpage[a >> 12];
    if (RT_LIKELY(p && (a & 0xfff) <= 0xffc)) { u32 v; memcpy(&v, p + (a & 0xfff), 4); return v; }
    return rt_rd_slow(a, 4);
}
static inline u32 rd16(u32 a) {
    u8 *p = rt_rpage[a >> 12];
    if (RT_LIKELY(p && (a & 0xfff) <= 0xffe)) { u16 v; memcpy(&v, p + (a & 0xfff), 2); return v; }
    return rt_rd_slow(a, 2);
}
static inline u32 rd8(u32 a) {
    u8 *p = rt_rpage[a >> 12];
    if (RT_LIKELY(p)) return p[a & 0xfff];
    return rt_rd_slow(a, 1);
}
static inline void wr32(u32 a, u32 v) {
    RT_LOGW_WRITE(a, v, 4);
    u8 *p = rt_wpage[a >> 12];
    if (RT_LIKELY(p && (a & 0xfff) <= 0xffc)) { memcpy(p + (a & 0xfff), &v, 4); return; }
    rt_wr_slow(a, v, 4);
}
static inline void wr16(u32 a, u32 v) {
    RT_LOGW_WRITE(a, v, 2);
    u8 *p = rt_wpage[a >> 12];
    if (RT_LIKELY(p && (a & 0xfff) <= 0xffe)) { u16 h = (u16)v; memcpy(p + (a & 0xfff), &h, 2); return; }
    rt_wr_slow(a, v, 2);
}
static inline void wr8(u32 a, u32 v) {
    RT_LOGW_WRITE(a, v, 1);
    u8 *p = rt_wpage[a >> 12];
    if (RT_LIKELY(p)) { p[a & 0xfff] = (u8)v; return; }
    rt_wr_slow(a, v, 1);
}

/* ---- les sorties anormales : elles ne reviennent jamais ---- */

enum { RT_OK = 0, RT_FAULT = 1, RT_UNIMPLEMENTED = 2, RT_NO_TARGET = 3, RT_OVERRUN = 4, RT_SVC = 5 };

_Noreturn void rt_unimplemented(Cpu *c, u32 pc);       /* instruction que le recompilateur ne sait pas traduire */
_Noreturn void rt_budget_exhausted(void);
_Noreturn void rt_misaligned(u32 addr);                /* accès exclusif mal aligné : faute d'alignement */
void rt_dispatch(Cpu *c, u32 addr);                    /* appel indirect : cherche la fonction recompilée à addr */
void rt_svc(Cpu *c, u32 number, u32 pc);               /* appel système : rappel vers l'hôte */
void rt_wfi_hint(Cpu *c, u32 kind);

/* Préemption et repères. Trois constructions :
   - sans rien : les macros sont vides (le plus rapide, pour les mesures d'une fonction seule) ;
   - RT_BUDGET (tests) : un compteur de branchements en arrière et d'appels ; à zéro, l'exécution est abandonnée ;
   - RT_HOST (le banc) : le même compteur, mais à zéro le fil de la console rend la main à l'ordonnanceur et reprendra
     plus tard au même endroit (voir host.c). C'est aussi là que les repères (`watch`) sont servis.
   RT_ENTER est au début de chaque fonction (les registres sont dans la structure) ; RT_BACKEDGE avant chaque `goto` en
   arrière (les registres sont dans les variables locales : on les range le temps de la cession) ; RT_HOOK sur une
   instruction choisie à la génération (`--hooks`). `pc` est l'adresse où le fil reprendra. */
#if defined(RT_HOST)
extern u8 rt_watch[1 << 21];                        /* repères actifs, indexés par (adresse >> 2) */
void rt_yield_slow(Cpu *c, u32 pc);                 /* cède la main : le compteur est épuisé */
void rt_hook_slow(Cpu *c, u32 pc);                  /* signale un repère à l'hôte */
#define RT_WATCHED(pc) RT_UNLIKELY(rt_watch[((pc) >> 2) & 0x1FFFFF])
#define RT_ENTER(pc) do { c->hint = (pc); RT_TRACE_ENTRY(pc); if (--c->budget < 0) rt_yield_slow(c, pc); if (RT_WATCHED(pc)) rt_hook_slow(c, pc); } while (0)
#define RT_BACKEDGE(pc) do { if (--c->budget < 0) { RT_SAVE(); rt_yield_slow(c, pc); RT_LOAD(); } } while (0)
#define RT_HOOK(pc) do { if (RT_WATCHED(pc)) { RT_SAVE(); rt_hook_slow(c, pc); RT_LOAD(); } } while (0)
/* Pile des adresses de retour. Chaque appel (bl, blx) y range lr, chaque retour du C l'enlève. Un `bx rX` ou `mov pc, rX`
   qui vise l'adresse du dessus est un retour fait avec un autre registre que lr (le Thumb dépile lr dans r3 puis
   `bx r3`) : on rend la main au C appelant au lieu de sauter. Sans cela, ce « saut » irait chercher le code au milieu d'une
   fonction déjà en cours et l'exécuterait une seconde fois. */
/* Retour ailleurs qu'à l'appelant (non-local) : un `pop {..., pc}` qui dépile une autre adresse que l'adresse de retour de
   l'appel (une fonction qui termine l'épilogue de son appelant, ou une adresse de retour choisie à la main). Le C ne sait
   que revenir à l'appelant ; l'adresse visée est dans c->r[15] (RT_PUSH le met à 0 avant l'appel, tout retour le pose).
   RT_POP la compare à celle que l'appel avait rangée : si elle diffère, cette fonction rend la main à son tour, jusqu'à
   l'appel qui attendait justement cette adresse (ou jusqu'à l'hôte, qui saura la suivre : unicorn, en mode hybride). */
extern u32 rt_unwinds;
#define RT_PUSH(v) do { if (RT_LIKELY(c->rsp < 65535u)) c->ras[c->rsp] = (v); c->rsp++; c->r[15] = 0; } while (0)
#define RT_POP() do { c->rsp--; if (RT_UNLIKELY(c->r[15] != 0 && c->rsp < 65535u && ((c->r[15] ^ c->ras[c->rsp]) > 1u))) { rt_unwinds++; return; } } while (0)
#define RT_POP_QUIET() do { c->rsp--; } while (0)
/* Comme RT_POP, mais pour une fonction qui a des adresses de reprise à elle (voir recomp.py) : au lieu de rendre la main,
   elle saute à son étiquette `rt_unwind`, qui reprend à l'adresse visée si c'est l'une des siennes. */
#define RT_TAIL_RET() goto rt_unwind
#define RT_POPC() do { c->rsp--; if (RT_UNLIKELY(c->r[15] != 0 && c->rsp < 65535u && ((c->r[15] ^ c->ras[c->rsp]) > 1u))) { rt_unwinds++; goto rt_unwind; } } while (0)
#define RT_TAILCHECK(t) do { u32 _t = (t); if (c->rsp && c->rsp <= 65535u && ((_t ^ c->ras[c->rsp - 1]) <= 1u)) { c->r[15] = _t; RT_SAVE(); return; } } while (0)
#elif defined(RT_BUDGET)
#define RT_ENTER(pc) do { if (--c->budget < 0) rt_budget_exhausted(); } while (0)
#define RT_BACKEDGE(pc) do { if (--c->budget < 0) rt_budget_exhausted(); } while (0)
#define RT_HOOK(pc) do { } while (0)
#define RT_PUSH(v) do { } while (0)
#define RT_POP() do { } while (0)
#define RT_POP_QUIET() do { } while (0)
#define RT_POPC() do { } while (0)
#define RT_TAIL_RET() return
#define RT_TAILCHECK(t) do { } while (0)
#else
#define RT_ENTER(pc) do { } while (0)
#define RT_BACKEDGE(pc) do { } while (0)
#define RT_HOOK(pc) do { } while (0)
#define RT_PUSH(v) do { } while (0)
#define RT_POP() do { } while (0)
#define RT_POP_QUIET() do { } while (0)
#define RT_POPC() do { } while (0)
#define RT_TAIL_RET() return
#define RT_TAILCHECK(t) do { } while (0)
#endif

/* ---- les registres locaux d'une fonction recompilée ---- */

#define RT_LOCALS \
    u32 r0, r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, sp, lr, nf, zf, cf, vf, qf, ge
#define RT_LOAD() do { \
    r0 = c->r[0]; r1 = c->r[1]; r2 = c->r[2]; r3 = c->r[3]; r4 = c->r[4]; r5 = c->r[5]; r6 = c->r[6]; \
    r7 = c->r[7]; r8 = c->r[8]; r9 = c->r[9]; r10 = c->r[10]; r11 = c->r[11]; r12 = c->r[12]; \
    sp = c->r[13]; lr = c->r[14]; nf = c->nf; zf = c->zf; cf = c->cf; vf = c->vf; qf = c->qf; ge = c->ge; \
} while (0)
#define RT_SAVE() do { \
    c->r[0] = r0; c->r[1] = r1; c->r[2] = r2; c->r[3] = r3; c->r[4] = r4; c->r[5] = r5; c->r[6] = r6; \
    c->r[7] = r7; c->r[8] = r8; c->r[9] = r9; c->r[10] = r10; c->r[11] = r11; c->r[12] = r12; \
    c->r[13] = sp; c->r[14] = lr; c->nf = nf; c->zf = zf; c->cf = cf; c->vf = vf; c->qf = qf; c->ge = ge; \
} while (0)

/* ---- l'arithmétique de l'ARM ---- */

/* a + b + cin avec les drapeaux C et V. La soustraction a - b est add_flags(a, ~b, 1). */
static inline u32 add_flags(u32 a, u32 b, u32 cin, u32 *cf, u32 *vf) {
    u64 s = (u64)a + b + cin;
    u32 r = (u32)s;
    *cf = (u32)(s >> 32);
    *vf = ((a ^ r) & (b ^ r)) >> 31;
    return r;
}

static inline u32 ror32(u32 x, u32 n) { n &= 31; return n ? (x >> n) | (x << (32 - n)) : x; }

/* Décalages par registre (quantité = octet bas de Rs) : sans retenue, puis avec. */
static inline u32 shl_r(u32 x, u32 n) { return n < 32 ? x << n : 0; }
static inline u32 shr_r(u32 x, u32 n) { return n < 32 ? x >> n : 0; }
static inline u32 sar_r(u32 x, u32 n) { return (u32)((s32)x >> (n < 32 ? n : 31)); }
static inline u32 ror_r(u32 x, u32 n) { return ror32(x, n & 31); }
static inline u32 shl_c(u32 x, u32 n, u32 *cf) {
    if (n == 0) return x;
    if (n < 32) { *cf = (x >> (32 - n)) & 1; return x << n; }
    *cf = n == 32 ? x & 1 : 0;
    return 0;
}
static inline u32 shr_c(u32 x, u32 n, u32 *cf) {
    if (n == 0) return x;
    if (n < 32) { *cf = (x >> (n - 1)) & 1; return x >> n; }
    *cf = n == 32 ? x >> 31 : 0;
    return 0;
}
static inline u32 sar_c(u32 x, u32 n, u32 *cf) {
    if (n == 0) return x;
    if (n < 32) { *cf = (x >> (n - 1)) & 1; return (u32)((s32)x >> n); }
    *cf = x >> 31;
    return (u32)((s32)x >> 31);
}
static inline u32 ror_c(u32 x, u32 n, u32 *cf) {
    if (n == 0) return x;
    n &= 31;
    if (n == 0) { *cf = x >> 31; return x; }
    *cf = (x >> (n - 1)) & 1;
    return (x >> n) | (x << (32 - n));
}

/* Saturations. Elles lèvent Q (qf) quand elles écrêtent. */
static inline s32 ssat32(s64 v, int bits, u32 *qf) {
    s64 hi = ((s64)1 << (bits - 1)) - 1, lo = -hi - 1;
    if (v > hi) { *qf = 1; return (s32)hi; }
    if (v < lo) { *qf = 1; return (s32)lo; }
    return (s32)v;
}
static inline u32 usat32(s64 v, int bits, u32 *qf) {
    s64 hi = ((s64)1 << bits) - 1;
    if (v > hi) { *qf = 1; return (u32)hi; }
    if (v < 0) { *qf = 1; return 0; }
    return (u32)v;
}
static inline u32 clz32(u32 x) { return x ? (u32)__builtin_clz(x) : 32; }

static inline s32 sx16(u32 x) { return (s32)(int16_t)x; }
static inline s32 sx8(u32 x) { return (s32)(int8_t)x; }

/* Les instructions du jeu ARMv6 en parallèle (additions et soustractions sur 2 x 16 bits ou 4 x 8 bits).
   kind : 0 signé, 1 signé saturé, 2 signé divisé par deux, 3 non signé, 4 non signé saturé, 5 non signé divisé.
   op : 0 add16, 1 asx, 2 sax, 3 sub16, 4 add8, 5 sub8. Rend le résultat, range les drapeaux GE dans *ge. */
u32 rt_parallel(int kind, int op, u32 a, u32 b, u32 *ge);
u32 rt_usad8(u32 a, u32 b);

/* ---- VFP : NaN par défaut (mode DN) et conversions en entier avec saturation ---- */

static inline float fcanon(float x) { if (x != x) { u32 u = 0x7fc00000u; memcpy(&x, &u, 4); } return x; }
static inline double dcanon(double x) { if (x != x) { u64 u = 0x7ff8000000000000ull; memcpy(&x, &u, 8); } return x; }
static inline u32 f2s_t(double t) {
    if (t != t) return 0;
    if (t >= 2147483648.0) return 0x7fffffffu;
    if (t <= -2147483648.0) return 0x80000000u;
    return (u32)(s32)t;
}
static inline u32 f2u_t(double t) {
    if (t != t || t <= 0.0) return 0;
    if (t >= 4294967296.0) return 0xffffffffu;
    return (u32)t;
}
static inline u32 f2s(double x) { return f2s_t(__builtin_trunc(x)); }
static inline u32 f2u(double x) { return f2u_t(__builtin_trunc(x)); }
static inline u32 f2sr(double x) { return f2s_t(__builtin_nearbyint(x)); }
static inline u32 f2ur(double x) { return f2u_t(__builtin_nearbyint(x)); }
void rt_fp_setup(u32 fpscr);

#endif
