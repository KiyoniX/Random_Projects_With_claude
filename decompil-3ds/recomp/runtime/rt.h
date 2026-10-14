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
    u32 r[16];              /* r0-r12, sp (13), lr (14) ; r[15] n'est pas tenu */
    u32 nf, zf, cf, vf, qf; /* N Z C V Q */
    u32 ge;                 /* GE[3:0] */
    u32 fpscr;              /* FPSCR complet, drapeaux N Z C V de la VFP dans les bits 31 à 28 */
    u32 fpexc;
    u32 tls;                /* registre du stockage local du fil (c13, c0, 3) */
    u32 excl_addr;          /* moniteur exclusif (ldrex / strex) ; 0xFFFFFFFF = aucun */
    s32 budget;             /* nombre de branchements en arrière permis (constructions de test seulement) */
    VfpRegs vfp;
    void *user;             /* à l'usage de l'hôte */
} Cpu;

typedef void (*RtFunc)(Cpu *);

typedef struct RtEntry {
    u32 addr;               /* adresse ARM, bit 0 à 1 pour un point d'entrée Thumb */
    RtFunc fn;
} RtEntry;

/* Rempli par le code généré (table.c) : toutes les fonctions recompilées, triées par adresse. */
extern const RtEntry rt_table[];
extern const u32 rt_table_len;

/* ---- la mémoire ---- */

extern u8 *rt_rpage[1 << 20];       /* page lisible -> pointeur du PC (ou NULL) */
extern u8 *rt_wpage[1 << 20];       /* page inscriptible -> pointeur du PC (ou NULL) */

u32 rt_rd_slow(u32 addr, int size);
void rt_wr_slow(u32 addr, u32 value, int size);

#define RT_LIKELY(x) __builtin_expect(!!(x), 1)

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
    u8 *p = rt_wpage[a >> 12];
    if (RT_LIKELY(p && (a & 0xfff) <= 0xffc)) { memcpy(p + (a & 0xfff), &v, 4); return; }
    rt_wr_slow(a, v, 4);
}
static inline void wr16(u32 a, u32 v) {
    u8 *p = rt_wpage[a >> 12];
    if (RT_LIKELY(p && (a & 0xfff) <= 0xffe)) { u16 h = (u16)v; memcpy(p + (a & 0xfff), &h, 2); return; }
    rt_wr_slow(a, v, 2);
}
static inline void wr8(u32 a, u32 v) {
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

#ifdef RT_BUDGET
#define RT_BACKEDGE() do { if (--c->budget < 0) rt_budget_exhausted(); } while (0)
#else
#define RT_BACKEDGE() do { } while (0)
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
