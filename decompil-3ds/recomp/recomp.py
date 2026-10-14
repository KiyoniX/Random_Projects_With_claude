"""Le recompilateur statique ARM -> C : python recomp/recomp.py {stats,gen,test} ...

Il lit le code d'un programme 3DS (code.bin + exheader), la liste des fonctions (début, taille, mode ARM ou Thumb),
et écrit pour chacune une fonction C qui opère sur l'état du processeur (rt.h). Voir recomp/README.md.

    python recomp/recomp.py stats                       # couverture des instructions de tout code.bin
    python recomp/recomp.py gen --out local/recomp/jeu  # tout le jeu en C (dans local/, jamais versionné)
    python recomp/recomp.py gen --out DIR --only 0x100048,0x1000a0
    python recomp/recomp.py test                        # les tests sur du code fabriqué
"""
import collections
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LOCAL = os.path.join(ROOT, 'local')
PYLIB = os.path.join(LOCAL, 'pylib')
for path in (HERE, PYLIB):
    if path not in sys.path:
        sys.path.insert(0, path)

import armdec  # noqa: E402

DEFAULT_CODE = os.path.join(LOCAL, 'extrait', 'maj', 'exefs', 'code.bin')
DEFAULT_EXHEADER = os.path.join(LOCAL, 'extrait', 'maj', 'exefs', 'exheader.bin')
DEFAULT_FUNCS = os.path.join(LOCAL, 'analyse', 'maj', 'gh', 'funcs.tsv')
PAGE = 0x1000


# ---------------------------------------------------------------------------------------------------------------------
# Le programme : sections et mémoire en lecture seule
# ---------------------------------------------------------------------------------------------------------------------

class Section:
    def __init__(self, name, address, size, data, perms):
        self.name, self.address, self.size, self.data, self.perms = name, address, size, data, perms


class Image:
    """Les sections d'un programme 3DS d'après l'exheader, comme le banc les charge (bench.map_program)."""

    def __init__(self, code, exheader):
        def section(offset):
            return struct.unpack_from('<III', exheader, offset)
        self.sections = []
        offset = 0
        for name, off, perms in (('text', 0x10, 5), ('rodata', 0x20, 1), ('data', 0x30, 3)):
            address, pages, size = section(off)
            chunk = bytearray(code[offset:offset + pages * PAGE])
            span = pages * PAGE
            if name == 'data':
                bss = struct.unpack_from('<I', exheader, 0x3C)[0]
                span = max(span, (size + bss + PAGE - 1) & ~(PAGE - 1))
            chunk.extend(bytes(span - len(chunk)))
            self.sections.append(Section(name, address, span, bytes(chunk), perms))
            offset += pages * PAGE
        self.readonly = [s for s in self.sections if not s.perms & 2]
        self.text = self.sections[0]

    @classmethod
    def load(cls, code_path=DEFAULT_CODE, exheader_path=DEFAULT_EXHEADER):
        return cls(open(code_path, 'rb').read(), open(exheader_path, 'rb').read())

    def _find(self, address, size):
        for s in self.readonly:
            if s.address <= address and address + size <= s.address + s.size:
                return s
        return None

    def const32(self, address):
        s = self._find(address, 4)
        if s is None or address & 3:
            return None
        return struct.unpack_from('<I', s.data, address - s.address)[0]

    def const16(self, address):
        s = self._find(address, 2)
        if s is None or address & 1:
            return None
        return struct.unpack_from('<H', s.data, address - s.address)[0]

    def const8(self, address):
        s = self._find(address, 1)
        return None if s is None else s.data[address - s.address]

    def word(self, address):
        """Un mot du code (section text), ou None."""
        s = self.text
        if s.address <= address and address + 4 <= s.address + s.size and not address & 3:
            return struct.unpack_from('<I', s.data, address - s.address)[0]
        return None

    def half(self, address):
        s = self.text
        if s.address <= address and address + 2 <= s.address + s.size and not address & 1:
            return struct.unpack_from('<H', s.data, address - s.address)[0]
        return None


class RawImage:
    """Un code fabriqué : un bloc d'octets à une adresse, entièrement lisible comme constante (tests)."""

    def __init__(self, base, data):
        self.text = Section('text', base, len(data), bytes(data), 5)
        self.readonly = [self.text]
        self.sections = [self.text]
        self._img = Image.__new__(Image)
        self._img.text = self.text
        self._img.readonly = self.readonly

    def __getattr__(self, name):
        return getattr(self._img, name)


def load_functions(path=DEFAULT_FUNCS):
    """[(adresse, taille, 'arm' | 'thumb', nom)] triées par adresse."""
    out = []
    for line in open(path, encoding='utf-8'):
        parts = line.rstrip('\n').split('\t')
        if len(parts) >= 3 and parts[0].startswith('0x'):
            out.append((int(parts[0], 16), int(parts[1]), parts[2], parts[3] if len(parts) > 3 else ''))
    out.sort()
    return out


# ---------------------------------------------------------------------------------------------------------------------
# Une fonction
# ---------------------------------------------------------------------------------------------------------------------

class Result:
    """Ce qu'a donné la traduction d'une fonction."""

    def __init__(self, addr, size, mode):
        self.addr, self.size, self.mode = addr, size, mode
        self.source = ''
        self.insns = []                 # les Insn atteignables
        self.callees = set()
        self.unimpl = []                # [(pc, mnémonique, raison)]
        self.leaf = True                # ni appel, ni svc, ni saut vers une autre fonction
        self.calls_indirect = False
        self.uses_dispatch = False      # un appel ou un saut passe par l'aiguillage (indirect, ou cible non recompilée)
        self.uses_svc = False

    @property
    def complete(self):
        return not self.unimpl


def func_name(addr):
    return 'f_%08x' % addr


def translate_function(addr, size, mode, image, known, comments=None, limit=None):
    """Traduit une fonction en C. `known` : adresses des fonctions qui seront dans la même construction."""
    if mode == 'thumb':
        import thumbdec
        decoder = thumbdec
        read = image.half
        step = 2
    else:
        decoder = armdec
        read = image.word
        step = 4
    end = addr + size
    ctx = armdec.Ctx(addr, end, known, image, image.word, limit)
    result = Result(addr, size, mode)
    insns = {}
    work = [addr]
    while work:
        a = work.pop()
        if a in insns or not ctx.inside(a):
            continue
        if mode == 'thumb':
            ctx.prev_word = None
            insn = thumbdec.decode(a, ctx, image)
        else:
            word = image.word(a)
            if word is None:
                break
            ctx.prev_word = image.word(a - 4)
            insn = armdec.decode(word, a, ctx)
        insns[a] = insn
        work.extend(insn.succ)
        if insn.fall or insn.cond != 14:
            work.append(a + insn.size)
    labels = set()
    for insn in insns.values():
        labels.update(insn.succ)
    out = []
    fname = func_name(addr)
    out.append('void %s(Cpu *c) {' % fname)
    out.append('  RT_LOCALS; RT_LOAD(); RT_BACKEDGE();')
    last = None
    for a in sorted(insns):
        insn = insns[a]
        if a in labels:
            out.append('L_%08x:;' % a)
        if comments:
            text = comments(insn)
            if text:
                out.append('  /* %08x: %s */' % (a, text))
        cond = armdec.COND[insn.cond] if insn.cond < 14 else None
        lines = insn.lines
        kind = insn.kind
        if insn.unimpl:
            result.unimpl.append((a, insn.mnem or ('%08x' % insn.word), insn.unimpl))
            lines = ['RT_SAVE(); rt_unimplemented(c, %s);' % armdec.lit(a)]
        if kind in ('call', 'svc', 'tail'):
            result.leaf = False
        if kind == 'call' and any('rt_dispatch' in ln for ln in insn.lines):
            result.calls_indirect = True
        body = ' '.join(lines) if not any('\n' in ln for ln in lines) else '\n'.join(lines)
        if cond:
            out.append('  if (%s) { %s }' % (cond, body))
        else:
            out.append('  { %s }' % body)
        last = insn
    if last is not None and (last.fall or last.cond != 14) and not last.unimpl:
        nxt = last.addr + last.size
        result.leaf = False
        if nxt in known:
            out.append('  RT_SAVE(); %s(c); return;' % func_name(nxt))
            result.callees.add(nxt)
        else:
            out.append('  RT_SAVE(); rt_dispatch(c, %s); return;' % armdec.lit(nxt))
    out.append('}')
    result.source = '\n'.join(out) + '\n'
    result.uses_dispatch = 'rt_dispatch' in result.source
    result.uses_svc = 'rt_svc' in result.source
    result.insns = [insns[a] for a in sorted(insns)]
    result.callees |= ctx.callees
    return result


def disassembler():
    """Un commentaire désassemblé par instruction, si capstone est là."""
    try:
        import capstone
    except ImportError:
        return None
    md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM)
    mt = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)

    def comment(insn):
        if insn.thumb:
            raw = struct.pack('<H', insn.word) if insn.size == 2 else struct.pack('<HH', insn.word & 0xFFFF, insn.word >> 16)
            for i in mt.disasm(raw, insn.addr):
                return ('%s %s' % (i.mnemonic, i.op_str)).replace('*/', '* /')
            return '.short 0x%04x' % (insn.word & 0xFFFF)
        raw = struct.pack('<I', insn.word)
        for i in md.disasm(raw, insn.addr):
            return ('%s %s' % (i.mnemonic, i.op_str)).replace('*/', '* /')
        return '.word 0x%08x' % insn.word
    return comment


# ---------------------------------------------------------------------------------------------------------------------
# L'écriture des fichiers C d'une construction
# ---------------------------------------------------------------------------------------------------------------------

def write_build(out_dir, results, per_file=400):
    """Écrit protos.h, fonctions par paquets, table.c. `results` : liste de Result."""
    os.makedirs(out_dir, exist_ok=True)
    addrs = sorted(r.addr for r in results)
    with open(os.path.join(out_dir, 'protos.h'), 'w', newline='\n') as f:
        f.write('#include "rt.h"\n')
        for a in addrs:
            f.write('void %s(Cpu *c);\n' % func_name(a))
    files = []
    for i in range(0, len(results), per_file):
        name = 'f%04d.c' % (i // per_file)
        with open(os.path.join(out_dir, name), 'w', newline='\n') as f:
            f.write('#include "protos.h"\n')
            for r in results[i:i + per_file]:
                f.write(r.source)
        files.append(name)
    with open(os.path.join(out_dir, 'table.c'), 'w', newline='\n') as f:
        f.write('#include "protos.h"\n')
        f.write('const RtEntry rt_table[] = {\n')
        for r in sorted(results, key=lambda r: r.addr | (1 if r.mode == 'thumb' else 0)):
            f.write('  { 0x%08xu, %s },\n' % (r.addr | (1 if r.mode == 'thumb' else 0), func_name(r.addr)))
        f.write('};\nconst u32 rt_table_len = %d;\n' % len(results))
    files.append('table.c')
    return files


# ---------------------------------------------------------------------------------------------------------------------
# La ligne de commande
# ---------------------------------------------------------------------------------------------------------------------

def function_limits(functions, image):
    """Pour chaque fonction, le début de la suivante (ou la fin du code) : jusqu'où elle peut s'étendre."""
    starts = sorted(set(f[0] for f in functions))
    end = image.text.address + len(image.text.data)
    out = {}
    for i, a in enumerate(starts):
        out[a] = starts[i + 1] if i + 1 < len(starts) else end
    return out


def translate_all(image, functions, comments=None, progress=False):
    arm = [f for f in functions if f[2] == 'arm']
    thumb = [f for f in functions if f[2] == 'thumb']
    try:
        import thumbdec  # noqa: F401
        have_thumb = True
    except ImportError:
        have_thumb = False
    todo = arm + (thumb if have_thumb else [])
    known = set(f[0] | (1 if f[2] == 'thumb' else 0) for f in todo)
    limits = function_limits(functions, image)
    results = []
    for n, (addr, size, mode, name) in enumerate(todo):
        results.append(translate_function(addr, size, mode, image, known, comments, limits.get(addr)))
        if progress and n % 2000 == 0:
            print('  %d / %d fonctions' % (n, len(todo)), file=sys.stderr)
    return results


def coverage(results):
    total = ok = 0
    reasons = collections.Counter()
    ok_mn = collections.Counter()
    bad_mn = collections.Counter()
    for r in results:
        for insn in r.insns:
            total += 1
            if insn.unimpl:
                bad_mn[insn.mnem or '?'] += 1
                reasons[insn.unimpl] += 1
            else:
                ok += 1
                ok_mn[insn.mnem or insn.kind] += 1
    return total, ok, reasons, ok_mn, bad_mn


def count_thumb_instructions(image, functions):
    """Les instructions Thumb du jeu, comptées avec capstone (à titre de mesure quand il n'y a pas de traducteur)."""
    import capstone
    mt = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
    n = 0
    for addr, size, mode, name in functions:
        if mode != 'thumb':
            continue
        off = addr - image.text.address
        n += sum(1 for _ in mt.disasm(image.text.data[off:off + size], addr))
    return n


def cmd_stats(args):
    image = Image.load()
    functions = load_functions()
    print('%d fonctions (%d ARM, %d Thumb)' % (len(functions), sum(1 for f in functions if f[2] == 'arm'),
                                               sum(1 for f in functions if f[2] == 'thumb')))
    results = translate_all(image, functions, progress=True)
    total, ok, reasons, ok_mn, bad_mn = coverage(results)
    arm_res = [r for r in results if r.mode == 'arm']
    thumb_res = [r for r in results if r.mode == 'thumb']
    print('instructions atteignables traduites : ARM %s' % _share(coverage(arm_res)))
    if thumb_res:
        print('                                       Thumb %s' % _share(coverage(thumb_res)))
    else:
        n = count_thumb_instructions(image, functions)
        print('Thumb : non traduit, %d instructions (mesure capstone)' % n)
    vfp_ok = sum(n for mn, n in ok_mn.items() if mn.startswith('v') or mn == 'fmstat')
    vfp_bad = sum(n for why, n in reasons.items() if 'vfp' in why.lower() or 'VFPv3' in why)
    print('dont VFP : %d / %d (%.2f %%)' % (vfp_ok, vfp_ok + vfp_bad, 100.0 * vfp_ok / max(1, vfp_ok + vfp_bad)))
    print('les plus fréquentes : ' + ', '.join('%s %d' % (mn, n) for mn, n in ok_mn.most_common(14)))
    complete = sum(1 for r in results if r.complete)
    print('fonctions entièrement traduites : %d / %d' % (complete, len(results)))
    print('feuilles (ni appel, ni svc) : %d, dont complètes : %d' % (
        sum(1 for r in results if r.leaf), sum(1 for r in results if r.leaf and r.complete)))
    print('\nraisons des instructions non traduites :')
    for why, n in reasons.most_common(25):
        print('  %7d  %s' % (n, why))
    print('\nmnémoniques non traduits :')
    for mn, n in bad_mn.most_common(25):
        print('  %7d  %s' % (n, mn))


def _share(cov):
    total, ok = cov[0], cov[1]
    return '%d / %d (%.2f %%)' % (ok, total, 100.0 * ok / total if total else 0)


def cmd_gen(args):
    out = DEFAULT_OUT
    only = None
    asm = False
    limit = None
    i = 0
    while i < len(args):
        if args[i] == '--out':
            out = args[i + 1]
            i += 1
        elif args[i] == '--only':
            only = set(int(x, 16) for x in args[i + 1].split(','))
            i += 1
        elif args[i] == '--asm':
            asm = True
        elif args[i] == '--limit':
            limit = int(args[i + 1])
            i += 1
        i += 1
    image = Image.load()
    functions = load_functions()
    if only:
        functions = [f for f in functions if f[0] in only]
    if limit:
        functions = functions[:limit]
    results = translate_all(image, functions, comments=disassembler() if asm else None, progress=True)
    files = write_build(out, results)
    import shutil
    shutil.copy(os.path.join(HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    total, ok, _, _, _ = coverage(results)
    print('%d fonctions, %d fichiers dans %s, instructions traduites : %d / %d' % (len(results), len(files), out, ok, total))


DEFAULT_OUT = os.path.join(LOCAL, 'recomp', 'jeu')


def main(argv):
    if len(argv) < 2 or argv[1] not in ('stats', 'gen', 'test'):
        print(__doc__)
        return 1
    if argv[1] == 'stats':
        cmd_stats(argv[2:])
    elif argv[1] == 'gen':
        cmd_gen(argv[2:])
    else:
        import tests
        tests.test()
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
