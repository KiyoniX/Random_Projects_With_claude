"""La recompilation des modules .cro : python recomp/cro_recomp.py {stats,gen,bases} ...

Le jeu range presque tout son code dans 133 modules .cro que `ro` charge et reloge à l'exécution, à une adresse qui vient
du tas du jeu (« le miroir »). Ce fichier traduit leur code ARM en C comme `recomp.py` le fait pour `code.bin`, mais
**sans dépendre de l'adresse de chargement** : le C d'un module est relogeable.

Méthode (la voie « b » du README) :
- chaque module est traduit **à une adresse factice** (`FAKE_BASE + indice * FAKE_STEP`), avec ses corrections internes
  appliquées à cette adresse (le décodeur lit ainsi les tables de sauts et sait où mènent les pointeurs de fonction) ;
- les adresses qui dérivent du `pc` (retours d'appel, `add rX, pc, #imm`, cibles de l'aiguillage, repères d'entrée) sont
  réécrites en `RT_MBASE + décalage`, où `RT_MBASE` est la base réelle du module, posée par l'hôte au chargement
  (`rt_mod_set_base`). Le reste vient de la mémoire : un mot de pool de littéral (`ldr rX, [pc, #imm]`) est relu à
  l'exécution, il porte donc l'adresse réelle que `ro` y a écrite (correction interne ou import résolu), et un appel vers
  `code.bin` ou vers un autre module passe par l'aiguillage avec cette adresse réelle ;
- les tables de sauts (`switch`) restent en adresses factices des deux côtés, elles ne dépendent que de l'indice.

Aucune fonction n'est connue de Ghidra pour les modules : les points d'entrée viennent de ce que le fichier dit (exports,
pointeurs de fonction posés par les corrections internes, objet de contrôle, adresses que d'autres modules importent),
puis de la fermeture des appels ; les adresses que le banc rencontre sans qu'elles soient traduites vont dans
`local/recomp/trous-cro.txt` et servent de point de départ à la génération suivante, comme pour `code.bin`.

    python recomp/cro_recomp.py stats [--only A,B]               couverture et nombre de fonctions
    python recomp/cro_recomp.py gen [--out DIR] [--only A,B]     écrit le C dans local/recomp/jeu (avec table et métadonnées)
    python recomp/cro_recomp.py bases [--only A,B]               contrôle : même C avec deux adresses factices
"""
import collections
import hashlib
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LOCAL = os.path.join(ROOT, 'local')
for path in (HERE, os.path.join(ROOT, 'outils'), os.path.join(LOCAL, 'pylib')):
    if path not in sys.path:
        sys.path.insert(0, path)

import armdec  # noqa: E402
import cro_loader as cl  # noqa: E402
import recomp  # noqa: E402

FAKE_BASE = 0x40000000
FAKE_STEP = 0x00200000          # 2 Mio par module (le plus gros code fait 1,1 Mio)
DEFAULT_OUT = os.path.join(LOCAL, 'recomp', 'jeu')
HOLES_FILE = os.path.join(LOCAL, 'recomp', 'trous-cro.txt')
META_NAME = 'cro_meta.json'
CHUNK = 0x10000                 # une tranche de C par 64 Kio de code
LIT_RE = re.compile(r'0x([0-9a-f]{8})u')
# ce que la réécriture ne touche pas : les expressions d'un switch et ses étiquettes (adresses factices des deux côtés)
PROTECT_RE = re.compile(r'switch \([^{}]*?\) \{|case 0x[0-9a-f]{8}u:')


class ModuleImage:
    """Un module .cro tel que le décodeur le voit : son code, avec les corrections internes appliquées à l'adresse
    factice. Même interface que `recomp.Image` pour ce que les décodeurs lisent."""

    def __init__(self, cro, index, fake=None):
        self.cro = cro
        self.name = cro.name
        self.index = index
        self.fake = fake if fake is not None else FAKE_BASE + index * FAKE_STEP
        h = cro.header
        data_address = self.fake + cl.align(len(cro.data), cl.PAGE)
        bss_address = data_address + cl.align(h['data_size'], 8)
        self.module = cl.LoadedModule(cro, self.fake, data_address, bss_address)
        mem = cl.Memory()
        mem.add(self.fake, self.module.image)
        if self.module.data:
            mem.add(data_address, self.module.data)
            self.module.data[:h['data_size']] = cro.data[h['data_offset']:h['data_offset'] + h['data_size']]
        self.problems = []
        self.relocated = []                     # (adresse factice du mot, valeur) des corrections internes
        for patch in cro.internal_patches:
            place = self.module.tag_address(patch.tag)
            segment = self.module.segments[patch.flag][0] if patch.flag < len(self.module.segments) else 0
            if not place or not segment:
                self.problems.append('correction interne %d sans cible' % patch.index)
                continue
            reason = cl.relocate(mem, place, patch.type, patch.addend, segment, place)
            if reason:
                self.problems.append('correction interne %d : %s' % (patch.index, reason))
            self.relocated.append((place, patch.type, patch.flag, patch.addend))
        index_code = cro.segment_of_kind(0)
        if index_code is None:
            raise cl.CroError('%s : pas de segment de code' % cro.name)
        self.code_off, self.code_size, _ = cro.segments[index_code]
        self.code_index = index_code
        self.lo = self.fake + self.code_off
        self.hi = self.lo + self.code_size
        code = bytes(self.module.image[self.code_off:self.code_off + self.code_size])
        self.text = recomp.Section('text', self.lo, self.code_size, code, 5)
        self.readonly = []
        self.sections = [self.text]

    # --- ce que les décodeurs lisent : le code seul, jamais de constante repliée ---

    def const32(self, address):
        return None

    def const16(self, address):
        return None

    def const8(self, address):
        return None

    def word(self, address):
        s = self.text
        if s.address <= address and address + 4 <= s.address + s.size and not address & 3:
            return struct.unpack_from('<I', s.data, address - s.address)[0]
        return None

    def half(self, address):
        s = self.text
        if s.address <= address and address + 2 <= s.address + s.size and not address & 1:
            return struct.unpack_from('<H', s.data, address - s.address)[0]
        return None

    def in_code(self, address):
        return self.lo <= (address & ~1) < self.hi

    # --- la réécriture des adresses dérivées de pc ---

    def rewrite(self, source):
        """Les littéraux du code généré qui tombent dans la fenêtre factice du module deviennent `RT_MBASE + décalage`.
        Les expressions de `switch` et les étiquettes `case` restent factices (voir la docstring du fichier)."""
        lo, hi, fake = self.lo, self.hi, self.fake

        def lit(match):
            value = int(match.group(1), 16)
            if lo <= value < hi + 1:
                return '(RT_MBASE + 0x%xu)' % (value - fake)
            return match.group(0)
        out = []
        pos = 0
        for m in PROTECT_RE.finditer(source):
            out.append(LIT_RE.sub(lit, source[pos:m.start()]))
            out.append(m.group(0))
            pos = m.end()
        out.append(LIT_RE.sub(lit, source[pos:]))
        return ''.join(out)

    # --- les points d'entrée que le fichier nomme ---

    def tag_address(self, tag):
        return self.module.tag_address(tag)

    def seeds(self, incoming=()):
        """(forts, faibles) : les adresses de fonctions d'après le fichier. Forts : exports, objet de contrôle,
        pointeurs posés dans les données, adresses que d'autres modules importent. Faibles : pointeurs posés dans le
        code lui-même (pools de littéraux : fonctions passées en rappel, mais aussi cibles de tables de sauts)."""
        cro = self.cro
        strong, weak = set(), set()

        places = set(place for place, _, _, _ in self.relocated)
        for patch in cro.external_patches:
            places.add(self.tag_address(patch.tag))
        self.places = places            # les mots que ro écrit : de la donnée, jamais du code

        def add(bucket, address):
            if self.in_code(address) and (address & ~3) not in places:
                bucket.add(address)
        for _, tag in cro.named_exports:
            add(strong, self.tag_address(tag))
        for tag in cro.indexed_exports:
            add(strong, self.tag_address(tag))
        for key in ('control_object', 'on_load', 'on_exit', 'on_unresolved'):
            if cro.header[key] != cl.NO_TAG:
                add(strong, self.tag_address(cro.header[key]))
        for tag in incoming:
            add(strong, self.tag_address(tag))
        for place, kind, flag, addend in self.relocated:
            if kind not in (2, 38):
                continue
            segment = self.module.segments[flag][0] if flag < len(self.module.segments) else 0
            target = (segment + addend) & 0xFFFFFFFF
            if not self.in_code(target):
                continue
            add(weak if self.in_code(place) else strong, target)
        return strong, weak

    def mask_offsets(self):
        """Les mots du code que `ro` écrit (corrections internes et imports) : décalages dans le segment de code."""
        cro = self.cro
        words = set()
        for patch in list(cro.internal_patches):
            self._mask_add(words, patch)
        for patch in list(cro.external_patches):
            self._mask_add(words, patch)
        return sorted(words)

    def _mask_add(self, words, patch):
        address = self.module.tag_address(patch.tag)
        if not address:
            return
        offset = address - self.fake
        if self.code_off <= offset < self.code_off + self.code_size:
            words.add(offset - self.code_off)

    def code_hash(self):
        """L'empreinte du code tel que le fichier le donne, mots écrits par `ro` mis à zéro (voir cpu_native.py)."""
        data = bytearray(self.cro.data[self.code_off:self.code_off + self.code_size])
        for off in self.mask_offsets():
            data[off:off + 4] = bytes(len(data[off:off + 4]))
        return hashlib.sha1(bytes(data)).hexdigest()


# ---------------------------------------------------------------------------------------------------------------------
# La traduction d'un module
# ---------------------------------------------------------------------------------------------------------------------

def load_cros(folder=cl.DEFAULT_ROMFS):
    names = sorted(n for n in os.listdir(folder) if n.lower().endswith('.cro'))
    return [cl.Cro(open(os.path.join(folder, n), 'rb').read(), n) for n in names]


def incoming_tags(cros, folder=cl.DEFAULT_ROMFS):
    """{nom du module: tags de son code que d'autres modules, ou le programme principal (static.crs), importent
    (imports anonymes)}."""
    out = collections.defaultdict(set)
    sources = list(cros)
    path = os.path.join(folder, 'static.crs')
    if os.path.isfile(path):
        sources.append(cl.Cro(open(path, 'rb').read(), 'static.crs'))
    for cro in sources:
        for target, indexed, anonymous in cro.import_modules:
            for tag, _batch in anonymous:
                out[target].add(tag)
    return out


def load_holes():
    """{nom du module: {décalages}} d'après local/recomp/trous-cro.txt (écrit par banc/cpu_native.py)."""
    out = collections.defaultdict(set)
    try:
        for line in open(HOLES_FILE):
            parts = line.split()
            if len(parts) == 2:
                out[parts[0]].add(int(parts[1], 16))
    except OSError:
        pass
    return out


def translate_module(img, incoming=(), holes=(), comments=None, progress=None, gap_scan=True):
    """Traduit un module : fermeture des appels depuis les points d'entrée, puis pointeurs de pools, puis prologues
    dans les trous. Rend la liste des `Result`."""
    strong, weak = img.seeds(incoming)
    for off in holes:
        strong.add(img.fake + off)
    entries = {}                        # clé (adresse | bit Thumb) -> mode
    results = {}                        # clé -> Result
    covered = set()                     # adresses d'instructions traduites

    def add_entry(address):
        base = address & ~1
        thumb = address & 1
        if not img.in_code(base) or (not thumb and base & 3):
            return False
        key = base | thumb
        if key in entries:
            return False
        entries[key] = 'thumb' if thumb else 'arm'
        return True

    for s in sorted(strong):
        add_entry(s)

    def run_closure():
        while True:
            pending = [k for k in entries if k not in results]
            if not pending:
                return
            starts = sorted(set(k & ~1 for k in entries) | {img.hi})
            nxt = {}
            for i, a in enumerate(starts[:-1]):
                nxt[a] = starts[i + 1]
            known = set(entries)
            for key in sorted(pending):
                base = key & ~1
                result = recomp.translate_function(base, nxt[base] - base, entries[key], img, known, comments, nxt[base],
                                                    module=img)
                results[key] = result
                covered.update(i.addr for i in result.insns)
                for target in result.dispatch_consts:
                    add_entry(target)
            if progress:
                progress('  %d fonctions' % len(results))

    run_closure()
    # Les pointeurs posés dans le code (pools) : des fonctions passées en rappel, sauf ceux qui tombent au milieu de ce
    # qu'on a déjà traduit (cibles de tables de sauts, étiquettes).
    for _ in range(4):
        added = False
        for w in sorted(weak):
            base = w & ~1
            if base in covered and (base | (w & 1)) not in entries:
                continue
            if add_entry(w):
                added = True
        if not added:
            break
        run_closure()
    if gap_scan:
        # Les prologues ARM, dans ce qu'aucune fonction n'a atteint.
        found = False
        for off in range(0, img.code_size - 3, 4):
            address = img.lo + off
            if address in covered or address in img.places:
                continue
            if recomp.is_arm_prologue(struct.unpack_from('<I', img.text.data, off)[0]):
                if add_entry(address):
                    found = True
        if found:
            run_closure()
    return [results[k] for k in sorted(results)]


def coverage_text(img, results):
    covered = set()
    for r in results:
        for i in r.insns:
            covered.update(range(i.addr, i.addr + i.size))
    return len(covered), img.code_size


# ---------------------------------------------------------------------------------------------------------------------
# L'écriture du C
# ---------------------------------------------------------------------------------------------------------------------

def c_name(name):
    return re.sub(r'\W', '_', name)


def write_module(out_dir, img, results):
    """Écrit les tranches de C d'un module. Rend [(nom de fichier, ...)] et la table [(décalage | bit Thumb, nom C)]."""
    files = []
    chunks = collections.defaultdict(list)
    for r in sorted(results, key=lambda r: r.addr):
        chunks[(r.addr - img.fake) // CHUNK].append(r)
    for k in sorted(chunks):
        fname = 'cro_%s_%02x.c' % (c_name(img.name), k)
        with open(os.path.join(out_dir, fname), 'w', newline='\n') as f:
            f.write('#include "cro_protos.h"\n#define RT_MBASE rt_mb[%d]\n' % img.index)
            for r in chunks[k]:
                f.write(r.source)
        files.append(fname)
    table = sorted(((r.addr - img.fake) | (1 if r.mode == 'thumb' else 0), 'f_%08x' % r.addr) for r in results)
    return files, table


def gen_module(args):
    """Le travail d'un module (appelé dans un processus à part). Rend un résumé."""
    name, index, out_dir, incoming, holes = args
    cros = {c.name: c for c in load_cros()}
    cro = cros[name]
    img = ModuleImage(cro, index)
    results = translate_module(img, incoming, holes)
    files, table = write_module(out_dir, img, results)
    total = sum(len(r.insns) for r in results)
    bad = sum(1 for r in results for i in r.insns if i.unimpl)
    covered, size = coverage_text(img, results)
    mask = img.mask_offsets()
    return dict(name=name, index=index, files=files, table=table, functions=len(results), insns=total, unimpl=bad,
                covered=covered, code_off=img.code_off, code_size=img.code_size, file_size=len(cro.data),
                sha1=img.code_hash(), mask=mask, problems=img.problems[:5],
                unimpl_list=[(r.addr - img.fake, i.mnem, i.unimpl) for r in results for i in r.insns if i.unimpl][:20])


def write_tables(out_dir, summaries):
    protos = ['#include "rt.h"', 'extern u32 rt_mb[];']
    for s in summaries:
        for _, cname in s['table']:
            protos.append('void %s(Cpu *c);' % cname)
    with open(os.path.join(out_dir, 'cro_protos.h'), 'w', newline='\n') as f:
        f.write('\n'.join(protos) + '\n')
    with open(os.path.join(out_dir, 'cro_table.c'), 'w', newline='\n') as f:
        f.write('#include "cro_protos.h"\n#ifdef _WIN32\n#define RT_EXPORT_DECL __declspec(dllexport)\n#else\n'
                '#define RT_EXPORT_DECL __attribute__((visibility("default")))\n#endif\n')
        for s in summaries:
            f.write('static const RtEntry t_%d[] = {\n' % s['index'])
            for key, cname in s['table']:
                f.write('  { 0x%xu, %s },\n' % (key, cname))
            f.write('};\n')
        f.write('static RtModule modules[] = {\n')
        for s in summaries:
            f.write('  { "%s", t_%d, %d, %d, 0x%xu, 0x%xu },\n' % (s['name'], s['index'], len(s['table']), s['index'],
                                                                    s['code_off'], s['code_size']))
        f.write('};\n')
        f.write('RT_EXPORT_DECL void rt_cro_init(void) {\n')
        f.write('  for (unsigned i = 0; i < %d; i++) rt_mod_register(&modules[i]);\n}\n' % len(summaries))
    meta = {}
    for s in summaries:
        meta[s['name']] = dict(index=s['index'], code_off=s['code_off'], code_size=s['code_size'], file_size=s['file_size'],
                               sha1=s['sha1'], mask=s['mask'], functions=s['functions'])
    with open(os.path.join(out_dir, META_NAME), 'w') as f:
        json.dump(meta, f)


def select(cros, only):
    if not only:
        return cros
    wanted = set(only)
    missing = wanted - {c.name for c in cros}
    if missing:
        sys.exit('modules inconnus : %s' % ', '.join(sorted(missing)))
    return [c for c in cros if c.name in wanted]


def cmd_gen(args):
    out = DEFAULT_OUT
    only = None
    i = 0
    while i < len(args):
        if args[i] == '--out':
            out = args[i + 1]
            i += 1
        elif args[i] == '--only':
            only = args[i + 1].split(',')
            i += 1
        i += 1
    cros = load_cros()
    index_of = {c.name: n for n, c in enumerate(cros)}
    incoming = incoming_tags(cros)
    holes = load_holes()
    chosen = select(cros, only)
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.startswith('cro_') and old.endswith('.c'):
            os.remove(os.path.join(out, old))
    jobs = [(c.name, index_of[c.name], out, sorted(incoming.get(c.name, ())), sorted(holes.get(c.name, ()))) for c in chosen]
    # les plus gros d'abord : le temps total est celui du plus gros module
    sizes = {c.name: c.header['code_size'] for c in cros}
    jobs.sort(key=lambda j: -sizes[j[0]])
    import concurrent.futures
    import time
    t0 = time.time()
    summaries = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=min(len(jobs), os.cpu_count() or 4)) as pool:
        for s in pool.map(gen_module, jobs):
            summaries.append(s)
            print('  %-28s %5d fonctions, %7d instructions, %2d non traduites, code couvert %.1f %%  [%.0f s]' % (
                s['name'], s['functions'], s['insns'], s['unimpl'], 100.0 * s['covered'] / max(1, s['code_size']),
                time.time() - t0), flush=True)
            for p in s['problems']:
                print('      problème : %s' % p)
    summaries.sort(key=lambda s: s['index'])
    write_tables(out, summaries)
    import shutil
    shutil.copy(os.path.join(HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    print('%d modules, %d fonctions, %d instructions (%d non traduites), %d fichiers C dans %s' % (
        len(summaries), sum(s['functions'] for s in summaries), sum(s['insns'] for s in summaries),
        sum(s['unimpl'] for s in summaries), sum(len(s['files']) for s in summaries), out))
    for s in summaries:
        for entry in s['unimpl_list']:
            print('  non traduit : %s +%#x %s : %s' % (s['name'], entry[0], entry[1], entry[2]))


def cmd_stats(args):
    only = args[args.index('--only') + 1].split(',') if '--only' in args else None
    cros = load_cros()
    index_of = {c.name: n for n, c in enumerate(cros)}
    incoming = incoming_tags(cros)
    holes = load_holes()
    for cro in select(cros, only):
        img = ModuleImage(cro, index_of[cro.name])
        results = translate_module(img, incoming.get(cro.name, ()), holes.get(cro.name, ()))
        covered, size = coverage_text(img, results)
        insns = sum(len(r.insns) for r in results)
        bad = collections.Counter(i.unimpl for r in results for i in r.insns if i.unimpl)
        thumb = sum(1 for r in results if r.mode == 'thumb')
        print('%-28s %5d fonctions (%d Thumb), %7d instructions, code couvert %.1f %%, non traduites %s' % (
            cro.name, len(results), thumb, insns, 100.0 * covered / max(1, size), dict(bad) or 0))


def cmd_bases(args):
    """Le même module traduit à deux adresses factices doit donner le même C une fois réécrit : sinon une constante du
    code est prise pour une adresse (ou l'inverse)."""
    only = args[args.index('--only') + 1].split(',') if '--only' in args else None
    cros = load_cros()
    index_of = {c.name: n for n, c in enumerate(cros)}
    incoming = incoming_tags(cros)
    holes = load_holes()
    bad = 0
    for cro in select(cros, only):
        def build(fake):
            img = ModuleImage(cro, index_of[cro.name], fake)
            inc = [t for t in incoming.get(cro.name, ())]
            results = translate_module(img, inc, [h for h in holes.get(cro.name, ())])
            def norm(text):
                text = re.sub(r'f_[0-9a-f]{8}|L_[0-9a-f]{8}', '', text)
                return LIT_RE.sub(lambda m: 'W%x' % (int(m.group(1), 16) - img.fake)
                                  if img.fake <= int(m.group(1), 16) < img.fake + FAKE_STEP else m.group(0), text)
            return {(r.addr - img.fake, r.mode): norm(r.source) for r in results}
        a = build(FAKE_BASE + index_of[cro.name] * FAKE_STEP)
        b = build(0x60000000 + index_of[cro.name] * FAKE_STEP + 0x00100000)
        diff = [k for k in set(a) | set(b) if a.get(k) != b.get(k)]
        print('%-28s %5d fonctions, %d différentes' % (cro.name, len(a), len(diff)))
        bad += len(diff)
        for k in sorted(diff)[:3]:
            print('    +%#x %s' % k)
            sa, sb = a.get(k, ''), b.get(k, '')
            for la, lb in zip(sa.splitlines(), sb.splitlines()):
                if la != lb:
                    print('      A: %s\n      B: %s' % (la[:200], lb[:200]))
                    break
    print('au total %d fonctions différentes' % bad)
    return 1 if bad else 0


def main(argv):
    if len(argv) < 2 or argv[1] not in ('stats', 'gen', 'bases'):
        print(__doc__)
        return 1
    if argv[1] == 'stats':
        cmd_stats(argv[2:])
    elif argv[1] == 'gen':
        cmd_gen(argv[2:])
    else:
        return cmd_bases(argv[2:])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
