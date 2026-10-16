/* Le support d'exécution : tables de pages, fautes, aiguillage, sortie propre vers l'hôte. Voir rt.h. */
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <fenv.h>
#include <xmmintrin.h>
#include "rt.h"

#ifdef _WIN32
#define RT_EXPORT __declspec(dllexport)
#else
#define RT_EXPORT __attribute__((visibility("default")))
#endif

u8 *rt_rpage[1 << 20];
u8 *rt_wpage[1 << 20];

jmp_buf *rt_jmp;                        /* le point de sortie de l'appel en cours (un par fil quand l'hôte en a plusieurs) */
u8 rt_watch[1 << 21];                   /* repères actifs (construction RT_HOST) */
void (*rt_miss_hook)(Cpu *, u32);       /* si posé : appelé au lieu d'une sortie RT_NO_TARGET */
static u32 rt_info[4];                  /* [0] adresse fautive, [1] 1 si écriture, [2] pc ou numéro, [3] libre */
static void (*rt_svc_hook)(Cpu *, u32, u32);

/* ---- sorties ---- */

static _Noreturn void rt_leave(int code) {
    if (rt_jmp) longjmp(*rt_jmp, code);
    fprintf(stderr, "recomp: sortie anormale %d (adresse %#x)\n", code, rt_info[0]);
    abort();
}

static _Noreturn void rt_fault(u32 addr, int write) {
    rt_info[0] = addr;
    rt_info[1] = (u32)write;
    rt_leave(RT_FAULT);
}

_Noreturn void rt_unimplemented(Cpu *c, u32 pc) {
    (void)c;
    rt_info[0] = pc;
    rt_leave(RT_UNIMPLEMENTED);
}

_Noreturn void rt_misaligned(u32 addr) { rt_fault(addr, 0); }

_Noreturn void rt_budget_exhausted(void) { rt_leave(RT_OVERRUN); }

void rt_svc(Cpu *c, u32 number, u32 pc) {
    if (rt_svc_hook) { rt_svc_hook(c, number, pc); return; }
    rt_info[0] = pc;
    rt_info[2] = number;
    rt_leave(RT_SVC);
}

void rt_wfi_hint(Cpu *c, u32 kind) { (void)c; (void)kind; }

/* ---- la mémoire, chemins lents : accès à cheval sur deux pages, ou page absente ---- */

u32 rt_rd_slow(u32 addr, int size) {
    u32 v = 0;
    for (int i = 0; i < size; i++) {
        u32 a = addr + (u32)i;
        u8 *p = rt_rpage[a >> 12];
        if (!p) rt_fault(a, 0);
        v |= (u32)p[a & 0xfff] << (8 * i);
    }
    return v;
}

void rt_wr_slow(u32 addr, u32 value, int size) {
    for (int i = 0; i < size; i++) {
        u32 a = addr + (u32)i;
        if (!rt_wpage[a >> 12]) rt_fault(a, 1);
    }
    for (int i = 0; i < size; i++) {
        u32 a = addr + (u32)i;
        rt_wpage[a >> 12][a & 0xfff] = (u8)(value >> (8 * i));
    }
}

/* ---- les modules .cro ---- */

u32 rt_mb[RT_MAX_MODULES];                      /* base réelle de chaque module (0 : pas chargé) */
static RtModule *rt_mods[RT_MAX_MODULES];
static u32 rt_mod_n;                            /* plus grand indice enregistré + 1 */
static u32 rt_loaded[RT_MAX_MODULES];           /* les indices des modules chargés */
static u32 rt_loaded_n;
static u32 rt_last_mod = 0xFFFFFFFFu;           /* le dernier module trouvé : la plupart des appels restent dans le même */

void rt_mod_register(RtModule *m) {
    if (m->index >= RT_MAX_MODULES) return;
    rt_mods[m->index] = m;
    if (m->index >= rt_mod_n) rt_mod_n = m->index + 1;
}

static const RtEntry *rt_search(const RtEntry *table, u32 len, u32 key) {
    u32 lo = 0, hi = len;
    while (lo < hi) {
        u32 mid = (lo + hi) / 2;
        if (table[mid].addr < key) lo = mid + 1; else hi = mid;
    }
    return (lo < len && table[lo].addr == key) ? &table[lo] : NULL;
}

/* La fonction recompilée d'un module chargé qui commence à addr (bit 0 : Thumb), ou NULL. */
static const RtEntry *rt_find_module(u32 addr) {
    u32 k = rt_last_mod;
    if (k != 0xFFFFFFFFu) {
        u32 off = addr - rt_mb[k];
        if (rt_mb[k] && off - rt_mods[k]->code_off < rt_mods[k]->code_size)
            return rt_search(rt_mods[k]->table, rt_mods[k]->table_len, off);
    }
    for (u32 i = 0; i < rt_loaded_n; i++) {
        k = rt_loaded[i];
        u32 off = addr - rt_mb[k];
        if (off - rt_mods[k]->code_off < rt_mods[k]->code_size) {
            rt_last_mod = k;
            return rt_search(rt_mods[k]->table, rt_mods[k]->table_len, off);
        }
    }
    return NULL;
}

/* ---- l'aiguillage ---- */

void rt_dispatch(Cpu *c, u32 addr) {
    if (rt_table_len && addr >= rt_table[0].addr && addr <= rt_table[rt_table_len - 1].addr) {
        const RtEntry *e = rt_search(rt_table, rt_table_len, addr);
        if (e) { e->fn(c); return; }
    }
    if (rt_loaded_n) {
        const RtEntry *e = rt_find_module(addr);
        if (e) { e->fn(c); return; }
    }
    if (rt_miss_hook) { rt_miss_hook(c, addr); return; }
    rt_info[0] = addr;
    rt_leave(RT_NO_TARGET);
}

/* Cherche l'entrée recompilée à addr (bit 0 à 1 pour Thumb) : rend son index dans la table, ou -1. */
static int rt_find(u32 addr) {
    u32 lo = 0, hi = rt_table_len;
    while (lo < hi) {
        u32 mid = (lo + hi) / 2;
        if (rt_table[mid].addr < addr) lo = mid + 1; else hi = mid;
    }
    return (lo < rt_table_len && rt_table[lo].addr == addr) ? (int)lo : -1;
}

/* ---- l'interface de l'hôte (ctypes) ---- */

/* Branche (ou débranche, avec NULL) une plage de pages sur un bloc du PC. perms : 1 lecture, 2 écriture. */
RT_EXPORT void rt_map(u32 first_page, u32 pages, u8 *host, int perms) {
    for (u32 i = 0; i < pages; i++) {
        u8 *p = host ? host + (size_t)i * 4096 : NULL;
        rt_rpage[first_page + i] = (perms & 1) ? p : NULL;
        rt_wpage[first_page + i] = (perms & 2) ? p : NULL;
    }
}

/* Pour l'hôte : l'adresse est-elle l'entrée d'une fonction recompilée ? un repère peut-il y être posé ? */
RT_EXPORT int rt_has_entry(u32 addr) { return rt_find(addr) >= 0 || (rt_loaded_n && rt_find_module(addr) != NULL); }
RT_EXPORT u32 rt_list_entries(u32 *out, u32 max) {
    u32 n = rt_table_len < max ? rt_table_len : max;
    for (u32 i = 0; i < n; i++) out[i] = rt_table[i].addr;
    return rt_table_len;
}
RT_EXPORT int rt_can_hook(u32 addr) {
    if (rt_find(addr & ~1u) >= 0 || rt_find(addr | 1u) >= 0) return 1;
    for (u32 i = 0; i < rt_hook_points_len; i++) if (rt_hook_points[i] == addr) return 1;
    if (rt_loaded_n && (rt_find_module(addr & ~1u) || rt_find_module(addr | 1u))) return 1;
    return 0;
}
RT_EXPORT void rt_watch_set(u32 addr, int on) { rt_watch[(addr >> 2) & 0x1FFFFF] = (u8)on; }
RT_EXPORT u8 *rt_watch_table(void) { return rt_watch; }

/* Les modules .cro (voir rt.h). rt_cro_init, écrite dans le C généré (cro_table.c), enregistre les modules recompilés. */
RT_EXPORT u32 rt_mod_count(void) { return rt_mod_n; }
RT_EXPORT const char *rt_mod_name(u32 i) { return i < rt_mod_n && rt_mods[i] ? rt_mods[i]->name : NULL; }
/* out[0..3] : indice, décalage du code, taille du code, nombre de points d'entrée. Rend 0 si le module n'est pas là. */
RT_EXPORT int rt_mod_info(u32 i, u32 *out) {
    if (i >= rt_mod_n || !rt_mods[i]) return 0;
    out[0] = rt_mods[i]->index; out[1] = rt_mods[i]->code_off; out[2] = rt_mods[i]->code_size; out[3] = rt_mods[i]->table_len;
    return 1;
}
RT_EXPORT u32 rt_mod_list_entries(u32 i, u32 *out, u32 max) {
    if (i >= rt_mod_n || !rt_mods[i]) return 0;
    u32 n = rt_mods[i]->table_len < max ? rt_mods[i]->table_len : max;
    for (u32 k = 0; k < n; k++) out[k] = rt_mods[i]->table[k].addr;
    return rt_mods[i]->table_len;
}
/* Pose la base réelle d'un module (0 : déchargé). Un module à base 0 n'est jamais cherché. */
RT_EXPORT void rt_mod_set_base(u32 i, u32 base) {
    if (i >= rt_mod_n || !rt_mods[i]) return;
    rt_mb[i] = base;
    rt_loaded_n = 0;
    for (u32 k = 0; k < rt_mod_n; k++) if (rt_mb[k] && rt_mods[k]) rt_loaded[rt_loaded_n++] = k;
    rt_last_mod = 0xFFFFFFFFu;
}

RT_EXPORT void rt_set_svc_hook(void (*hook)(Cpu *, u32, u32)) { rt_svc_hook = hook; }
RT_EXPORT u32 rt_get_info(int i) { return rt_info[i & 3]; }
u32 rt_unwinds;                          /* retours non-locaux suivis (voir RT_POP) */
RT_EXPORT u32 rt_get_unwinds(void) { return rt_unwinds; }
RT_EXPORT u32 rt_cpu_size(void) { return (u32)sizeof(Cpu); }

/* Réglages de l'arithmétique flottante d'après FPSCR : arrondi (bits 23:22), vidage des dénormaux (bit 24). */
RT_EXPORT void rt_fp_setup(u32 fpscr) {
    static const int modes[4] = { FE_TONEAREST, FE_UPWARD, FE_DOWNWARD, FE_TOWARDZERO };
    fesetround(modes[(fpscr >> 22) & 3]);
    unsigned csr = _mm_getcsr() & ~0x8040u;
    if (fpscr & (1u << 24)) csr |= 0x8040u;     /* FTZ et DAZ */
    _mm_setcsr(csr);
}

/* Appelle la fonction recompilée à addr. Rend RT_OK ou le code de la sortie anormale. */
RT_EXPORT int rt_call(Cpu *c, u32 addr) {
    jmp_buf jb;
    jmp_buf *prev = rt_jmp;
    unsigned saved_csr = _mm_getcsr();          /* l'hôte garde son arrondi : on ne règle celui de la console que le temps de l'appel */
    rt_fp_setup(c->fpscr);
    rt_jmp = &jb;
    int code = setjmp(jb);
    if (code == 0) rt_dispatch(c, addr);
    rt_jmp = prev;
    _mm_setcsr(saved_csr);
    fesetround(FE_TONEAREST);
    return code;
}

/* ---- ARMv6 : opérations en parallèle ---- */

u32 rt_parallel(int kind, int op, u32 a, u32 b, u32 *ge) {
    int is16 = op <= 3;
    int lanes = is16 ? 2 : 4, w = is16 ? 16 : 8;
    int sgn = kind <= 2;
    int base = kind % 3;            /* 0 simple, 1 saturé, 2 divisé par deux */
    u32 res = 0, g = 0;
    for (int i = 0; i < lanes; i++) {
        int add;
        int ai = i, bi = i;
        if (!is16) add = (op == 4);
        else if (op == 0) add = 1;
        else if (op == 3) add = 0;
        else {
            /* asx : voie 0 = a0 - b1, voie 1 = a1 + b0 ; sax : voie 0 = a0 + b1, voie 1 = a1 - b0 */
            bi = 1 - i;
            add = (op == 1) ? (i == 1) : (i == 0);
        }
        u32 mask = (w == 16) ? 0xffffu : 0xffu;
        s64 x = (a >> (w * ai)) & mask, y = (b >> (w * bi)) & mask;
        if (sgn) {
            x = w == 16 ? (int16_t)x : (int8_t)x;
            y = w == 16 ? (int16_t)y : (int8_t)y;
        }
        s64 v = add ? x + y : x - y;
        u32 lane;
        if (base == 0) {
            lane = (u32)v & mask;
            int gev = sgn ? v >= 0 : (add ? v >= ((s64)1 << w) : v >= 0);
            if (gev) g |= is16 ? (3u << (2 * i)) : (1u << i);
        } else if (base == 1) {
            s64 hi = sgn ? ((s64)1 << (w - 1)) - 1 : ((s64)1 << w) - 1;
            s64 lo = sgn ? -hi - 1 : 0;
            if (v > hi) v = hi;
            if (v < lo) v = lo;
            lane = (u32)v & mask;
        } else {
            lane = (u32)(v >> 1) & mask;
        }
        res |= lane << (w * i);
    }
    if (base == 0) *ge = g;
    return res;
}

u32 rt_usad8(u32 a, u32 b) {
    u32 s = 0;
    for (int i = 0; i < 4; i++) {
        int x = (a >> (8 * i)) & 0xff, y = (b >> (8 * i)) & 0xff;
        s += (u32)(x > y ? x - y : y - x);
    }
    return s;
}
