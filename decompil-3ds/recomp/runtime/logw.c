/* Le journal du mode vérification (construction RT_LOGW) : de quoi rejouer une tranche sous unicorn et comparer.

   Pendant une tranche on journalise :
   - chaque écriture en mémoire (adresse, valeur, taille), dans l'ordre ;
   - l'état d'origine de chaque page touchée (la première fois), pour pouvoir revenir en arrière ;
   - chaque entrée de fonction recompilée (pc, r0-r3, sp, lr), pour situer une divergence.
   L'hôte (banc/cpu_verify.py) lit ces tableaux par ctypes. Les écritures faites par unicorn (code non recompilé, pendant
   une tranche native) y sont ajoutées par l'hôte avec logw_write. */
#include <stdlib.h>
#include <string.h>
#include "rt.h"

#define RT_EXPORT __declspec(dllexport)

typedef struct { u32 addr, value, size; } WriteRec;
typedef struct { u32 pc, r0, r1, r2, r3, sp, lr, spare, r4, r5, r6, r7, r8, r9, r10, r11, r12, pad; } EntryRec;
typedef struct { u32 page; u8 *saved; } PageRec;

int rt_logw_on;
static WriteRec *writes;
static u32 write_count, write_cap;
static EntryRec *entries;
static u32 entry_count, entry_cap;
static PageRec *pages;
static u32 page_count, page_cap;
static u8 touched[1 << 20];

static void touch(u32 page) {
    if (touched[page]) return;
    u8 *p = rt_rpage[page];
    if (!p) return;
    touched[page] = 1;
    if (page_count == page_cap) {
        page_cap = page_cap ? page_cap * 2 : 256;
        pages = (PageRec *)realloc(pages, page_cap * sizeof(PageRec));
    }
    pages[page_count].page = page;
    pages[page_count].saved = (u8 *)malloc(4096);
    memcpy(pages[page_count].saved, p, 4096);
    page_count++;
}

void rt_logw(u32 addr, u32 value, int size) {
    touch(addr >> 12);
    if ((addr & 0xfff) + (u32)size > 0x1000) touch((addr >> 12) + 1);
    if (write_count == write_cap) {
        write_cap = write_cap ? write_cap * 2 : 4096;
        writes = (WriteRec *)realloc(writes, write_cap * sizeof(WriteRec));
    }
    writes[write_count].addr = addr;
    writes[write_count].value = value;
    writes[write_count].size = (u32)size;
    write_count++;
}

void rt_trace_entry(Cpu *c, u32 pc) {
    if (entry_count == entry_cap) {
        entry_cap = entry_cap ? entry_cap * 2 : 4096;
        entries = (EntryRec *)realloc(entries, entry_cap * sizeof(EntryRec));
    }
    EntryRec *e = &entries[entry_count++];
    e->pc = pc; e->r0 = c->r[0]; e->r1 = c->r[1]; e->r2 = c->r[2]; e->r3 = c->r[3]; e->sp = c->r[13]; e->lr = c->r[14];
    e->r4 = c->r[4]; e->r5 = c->r[5]; e->r6 = c->r[6]; e->r7 = c->r[7]; e->r8 = c->r[8]; e->r9 = c->r[9];
    e->r10 = c->r[10]; e->r11 = c->r[11]; e->r12 = c->r[12]; e->pad = 0;
    e->spare = write_count;                 /* combien d'écritures avant cette entrée : situe l'entrée dans le journal */
}

RT_EXPORT void logw_begin(void) {
    for (u32 i = 0; i < page_count; i++) { touched[pages[i].page] = 0; free(pages[i].saved); }
    page_count = write_count = entry_count = 0;
    rt_logw_on = 1;
}

RT_EXPORT void logw_end(void) { rt_logw_on = 0; }
RT_EXPORT void logw_write(u32 addr, u32 value, int size) { rt_logw(addr, value, size); }
RT_EXPORT u32 logw_write_count(void) { return write_count; }
RT_EXPORT WriteRec *logw_writes(void) { return writes; }
RT_EXPORT u32 logw_entry_count(void) { return entry_count; }
RT_EXPORT EntryRec *logw_entries(void) { return entries; }
RT_EXPORT u32 logw_page_count(void) { return page_count; }
RT_EXPORT u32 logw_page(u32 i) { return pages[i].page; }
RT_EXPORT u8 *logw_page_saved(u32 i) { return pages[i].saved; }

/* Remet les pages touchées dans l'état d'origine. */
RT_EXPORT void logw_rewind(void) {
    for (u32 i = 0; i < page_count; i++) {
        u8 *p = rt_wpage[pages[i].page];
        if (!p) p = rt_rpage[pages[i].page];
        if (p) memcpy(p, pages[i].saved, 4096);
    }
}
