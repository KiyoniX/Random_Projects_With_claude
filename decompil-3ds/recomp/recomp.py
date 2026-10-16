"""Le recompilateur statique ARM -> C : python recomp/recomp.py {stats,gen,test} ...

Il lit le code d'un programme 3DS (code.bin + exheader), la liste des fonctions (début, taille, mode ARM ou Thumb),
et écrit pour chacune une fonction C qui opère sur l'état du processeur (rt.h). Voir recomp/README.md.

    python recomp/recomp.py stats                       # couverture des instructions de tout code.bin
    python recomp/recomp.py gen --out local/recomp/jeu  # tout le jeu en C (dans local/, jamais versionné)
    python recomp/recomp.py gen --out DIR --only 0x100048,0x1000a0
    python recomp/recomp.py gen --out DIR --hooks 0x106710,...   # repères au milieu d'une fonction (défaut : 0x106710)
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
        # Le code lui-même n'est pas une constante : le jeu réécrit certains mots de ses pools de littéraux à l'exécution
        # (relevé : 0x35078c et 0x350970 dans l'exécutable de Pokémon X). Seul le rodata est replié en constantes.
        self.readonly = [s for s in self.sections if not s.perms & 2 and s.name != 'text']
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
        self.hooked = []                # adresses d'instructions qui portent un repère RT_HOOK
        self.dispatch_consts = set()    # modules .cro : cibles constantes passées à l'aiguillage (adresses factices, avant réécriture)

    @property
    def complete(self):
        return not self.unimpl


def func_name(addr):
    return 'f_%08x' % addr


def manual_return_targets(insns):
    """Les adresses que des « add lr, pc, #imm » / « sub lr, pc, #imm » (mode ARM) donnent à lr."""
    out = set()
    for a, insn in insns.items():
        if insn.word & 0xFFFFF000 in (0xE28FE000, 0xE24FE000):
            imm = armdec.ror(insn.word & 0xFF, 2 * ((insn.word >> 8) & 15))
            target = a + 8 + (imm if insn.word & 0xFFFFF000 == 0xE28FE000 else -imm)
            out.add(target & 0xFFFFFFFF)
            # « add lr, lr, #imm » qui suit : l'adresse est ajustée
            nxt = insns.get(a + 4)
            while nxt is not None and nxt.word & 0xFFFFF000 in (0xE28EE000, 0xE24EE000):
                imm = armdec.ror(nxt.word & 0xFF, 2 * ((nxt.word >> 8) & 15))
                target += imm if nxt.word & 0xFFFFF000 == 0xE28EE000 else -imm
                out.add(target & 0xFFFFFFFF)
                nxt = insns.get(nxt.addr + 4)
    return out


def translate_function(addr, size, mode, image, known, comments=None, limit=None, hooks=(), module=None):
    """Traduit une fonction en C. `known` : adresses des fonctions qui seront dans la même construction. `hooks` :
    adresses d'instructions où poser un repère RT_HOOK (en plus de l'entrée de chaque fonction). `module` : un objet
    de recomp/cro_recomp.py quand la fonction est celle d'un module .cro, traduite à une adresse factice : les adresses
    qui en dérivent sont réécrites à partir de la base réelle du module (voir `module.rewrite`)."""
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
    while True:
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
        # Une adresse de retour choisie à la main (« add lr, pc, #imm ») est du code atteignable, même si rien dans la
        # fonction n'y mène : un autre morceau de code y « revient » (voir plus bas).
        if mode == 'thumb':
            break
        more = [t for t in manual_return_targets(insns) if t not in insns and ctx.inside(t)]
        if not more:
            break
        work.extend(more)
    labels = set()
    for insn in insns.values():
        labels.update(insn.succ)
    # Les adresses de retour choisies à la main (« add lr, pc, #imm ») qui tombent dans la fonction : un autre morceau de
    # code peut y « revenir » (pop {pc}) alors que la fonction n'a fait aucun appel vers elle. Un retour qui les vise
    # continue ici au lieu de quitter la fonction (voir RT_POPC dans rt.h).
    resume = set()          # dans la fonction : on y reprend par un goto
    resume_out = set()      # ailleurs (une autre fonction, que le découpage a séparée de celle-ci) : on y saute par l'aiguillage
    if mode != 'thumb':
        for t in manual_return_targets(insns):
            (resume if t in insns else resume_out).add(t)
        labels.update(resume)
    ret_pattern = re.compile(r'c->r\[15\] = (\w+); RT_SAVE\(\); return;')

    def ret_catch(m):
        cases = ' '.join('case %s: goto L_%08x;' % (armdec.lit(t), t) for t in sorted(resume))
        cases += ' '.join(' case %s: RT_SAVE(); rt_dispatch(c, %s); { return; }' % (armdec.lit(t), armdec.lit(t))
                          for t in sorted(resume_out))
        return 'switch (%s) { %s default: break; } %s' % (unwind_key(m.group(1)), cases, m.group(0))

    def unwind_key(expr):
        """Ce sur quoi un retour non-local est aiguillé : l'adresse visée, ramenée à l'adresse factice d'un module."""
        if module is None:
            return '%s & ~1u' % expr
        return '(%s & ~1u) - RT_MBASE + %s' % (expr, armdec.lit(module.fake))
    out = []
    fname = func_name(addr)
    out.append('void %s(Cpu *c) {' % fname)
    entry_pc = addr | (1 if mode == 'thumb' else 0)
    out.append('  RT_LOCALS; RT_ENTER(%s); RT_LOAD();' % armdec.lit(entry_pc))
    last = None
    for a in sorted(insns):
        insn = insns[a]
        if a in labels:
            out.append('L_%08x:;' % a)
        if a in hooks and a != addr:
            out.append('  RT_HOOK(%s);' % armdec.lit(a | (1 if mode == 'thumb' else 0)))
            result.hooked.append(a)
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
        if resume or resume_out:
            lines = [ret_pattern.sub(ret_catch, ln) for ln in lines]
        body = ' '.join(lines) if not any('\n' in ln for ln in lines) else '\n'.join(lines)
        if cond:
            out.append('  if (%s) { %s }' % (cond, body))
        else:
            out.append('  { %s }' % body)
        last = insn
    if last is not None and (last.fall or last.cond != 14) and not last.unimpl:
        nxt = last.addr + last.size
        nxt_key = nxt | (1 if mode == 'thumb' else 0)         # la suite reste dans le même mode
        result.leaf = False
        if nxt_key in known:
            out.append('  RT_SAVE(); %s(c); return;' % func_name(nxt))
            result.callees.add(nxt)
        else:
            out.append('  RT_SAVE(); rt_dispatch(c, %s); return;' % armdec.lit(nxt_key))
    if resume or resume_out:
        # un retour non-local qui vise une de ces adresses reprend ici (construction RT_HOST) : les registres sont ceux que
        # l'appelé a laissés dans la structure
        out.append('#ifdef RT_HOST')
        out.append('rt_unwind:;')
        out.append('  switch (%s) {' % unwind_key('c->r[15]'))
        for t in sorted(resume):
            out.append('  case %s: RT_LOAD(); goto L_%08x;' % (armdec.lit(t), t))
        for t in sorted(resume_out):
            out.append('  case %s: rt_dispatch(c, %s); { return; }' % (armdec.lit(t), armdec.lit(t)))
        out.append('  default: return;')
        out.append('  }')
        out.append('#endif')
    out.append('}')
    result.source = '\n'.join(out) + '\n'
    if resume or resume_out:
        result.source = result.source.replace('RT_POP()', 'RT_POPC()')
        # Un appel en position terminale (f(c); return;) peut lui aussi revenir à une de ces adresses : on regarde.
        result.source = re.sub(r'((?:f_[0-9a-f]{8}\(c\)|rt_dispatch\(c, [^;]*\)); )return;', r'\1RT_TAIL_RET();', result.source)
    if module is not None:
        result.dispatch_consts = set(int(x, 16) for x in DISPATCH_CONST.findall(result.source))
        result.source = module.rewrite(result.source)
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

def write_build(out_dir, results, per_file=400, by_address=False):
    """Écrit protos.h, fonctions par paquets, table.c. `results` : liste de Result. `by_address` : les paquets sont des
    tranches fixes de 64 Kio d'adresses (un fichier par tranche) au lieu de paquets de `per_file` fonctions : ajouter une
    fonction ne change alors que le fichier de sa tranche, et la compilation incrémentale (harness) ne refait que lui."""
    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if old.startswith('f') and old.endswith('.c'):
            os.remove(os.path.join(out_dir, old))
    addrs = sorted(r.addr for r in results)
    with open(os.path.join(out_dir, 'protos.h'), 'w', newline='\n') as f:
        f.write('#include "rt.h"\n')
        for a in addrs:
            f.write('void %s(Cpu *c);\n' % func_name(a))
    files = []
    if by_address:
        groups = collections.defaultdict(list)
        for r in sorted(results, key=lambda r: r.addr):
            groups[r.addr >> 16].append(r)
        chunks = [('f%04x.c' % k, groups[k]) for k in sorted(groups)]
    else:
        chunks = [('f%04d.c' % (i // per_file), results[i:i + per_file]) for i in range(0, len(results), per_file)]
    for name, chunk in chunks:
        with open(os.path.join(out_dir, name), 'w', newline='\n') as f:
            f.write('#include "protos.h"\n')
            for r in chunk:
                f.write(r.source)
        files.append(name)
    with open(os.path.join(out_dir, 'table.c'), 'w', newline='\n') as f:
        f.write('#include "protos.h"\n')
        f.write('const RtEntry rt_table[] = {\n')
        for r in sorted(results, key=lambda r: r.addr | (1 if r.mode == 'thumb' else 0)):
            f.write('  { 0x%08xu, %s },\n' % (r.addr | (1 if r.mode == 'thumb' else 0), func_name(r.addr)))
        f.write('};\nconst u32 rt_table_len = %d;\n' % len(results))
        hooked = sorted(a for r in results for a in r.hooked)
        f.write('const u32 rt_hook_points[] = { %s };\nconst u32 rt_hook_points_len = %d;\n' % (
            ', '.join('0x%08xu' % a for a in hooked) or '0', len(hooked)))
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


def translate_all(image, functions, comments=None, progress=False, hooks=(), holes=False, seeds=()):
    """Traduit toutes les fonctions. `holes` : Ghidra laisse du code hors de ses fonctions (suite d'une fonction coupée,
    cible d'un saut que personne n'a nommée). Avec `holes`, toute cible constante d'un appel ou d'un saut qui tombe dans
    le code sans être une fonction connue devient elle-même une fonction (nommée `trou_...`), jusqu'à ce qu'il n'y en
    ait plus : le natif n'a alors plus à confier ce code à unicorn. `seeds` : adresses de départ supplémentaires (bit 0
    à 1 pour Thumb), celles que le banc a rencontrées sans les trouver recompilées (local/recomp/trous.txt)."""
    arm = [f for f in functions if f[2] == 'arm']
    thumb = [f for f in functions if f[2] == 'thumb']
    try:
        import thumbdec  # noqa: F401
        have_thumb = True
    except ImportError:
        have_thumb = False
    todo = arm + (thumb if have_thumb else [])
    results = []
    done = 0
    pending = tuple(seeds)
    text = image.text
    text_lo, text_hi = text.address, text.address + len(text.data)
    while True:
        known = set(f[0] | (1 if f[2] == 'thumb' else 0) for f in todo)
        limits = function_limits(todo, image)
        for n in range(done, len(todo)):
            addr, size, mode, name = todo[n]
            results.append(translate_function(addr, size, mode, image, known, comments, limits.get(addr), hooks))
            if progress and n % 2000 == 0:
                print('  %d / %d fonctions' % (n, len(todo)), file=sys.stderr)
        done = len(todo)
        if not holes:
            return results
        keys = set(f[0] | (1 if f[2] == 'thumb' else 0) for f in todo)
        found = {}
        for seed in pending:
            if text_lo <= seed & ~1 < text_hi and seed not in keys:
                found[seed] = 'thumb' if seed & 1 else 'arm'
        pending = ()
        for r in results:
            for m in DISPATCH_CONST.finditer(r.source):
                target = int(m.group(1), 16)
                base = target & ~1
                if text_lo <= base < text_hi and target not in keys and target not in found:
                    found[target] = 'thumb' if target & 1 else 'arm'
        if not found:
            return results
        # Ghidra a parfois nommé « fonction » un bout de données ou de code dans l'autre mode, à une adresse où du code
        # (atteint par une chute ou un saut) continue : le code atteint l'emporte, l'autre fonction est retirée.
        starts = set(f[0] for f in todo)
        for target, mode in sorted(found.items()):
            base = target & ~1
            if base in starts:
                todo[:] = [f for f in todo if f[0] != base]
                results[:] = [r for r in results if r.addr != base]
                done = len(todo)
                if progress:
                    print('  la fonction à %#x est remplacée (mode %s)' % (base, mode), file=sys.stderr)
        starts = set(f[0] for f in todo)
        # taille : jusqu'à la fonction suivante (la traduction n'écrit que les instructions atteignables)
        ordered = sorted(starts | set(t & ~1 for t in found))
        for target, mode in sorted(found.items()):
            base = target & ~1
            i = ordered.index(base)
            nxt = ordered[i + 1] if i + 1 < len(ordered) else text_hi
            todo.append((base, min(nxt - base, 0x4000), mode, 'trou_%08x' % base))
        # Les fonctions déjà traduites gardent leurs appels vers ces trous par l'aiguillage ; seules les nouvelles passent.
        if progress:
            print('  %d trous trouvés, nouvelle passe' % len(found), file=sys.stderr)


import re  # noqa: E402
DISPATCH_CONST = re.compile(r'rt_dispatch\(c, (0x[0-9a-f]+)u\)')


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
    hooks = set(DEFAULT_HOOKS)
    use_seeds = True
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
        elif args[i] == '--no-seeds':
            use_seeds = False
        elif args[i] == '--hooks':
            hooks = set(int(x, 16) for x in args[i + 1].split(',') if x)
            i += 1
        i += 1
    image = Image.load()
    functions = load_functions()
    if only:
        functions = [f for f in functions if f[0] in only]
    if limit:
        functions = functions[:limit]
    results = translate_all(image, functions, comments=disassembler() if asm else None, progress=True, hooks=hooks, holes=True,
                             seeds=load_seeds() if use_seeds else ())
    files = write_build(out, results, by_address=True)
    import shutil
    shutil.copy(os.path.join(HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    total, ok, _, _, _ = coverage(results)
    print('%d fonctions, %d fichiers dans %s, instructions traduites : %d / %d' % (len(results), len(files), out, ok, total))


DEFAULT_OUT = os.path.join(LOCAL, 'recomp', 'jeu')
SEEDS_FILE = os.path.join(LOCAL, 'recomp', 'trous.txt')


def load_seeds():
    """Les adresses de code rencontrées par le banc sans être recompilées (écrites par banc/cpu_native.py)."""
    try:
        return sorted(set(int(line, 16) for line in open(SEEDS_FILE) if line.strip()))
    except OSError:
        return []

# Les repères du banc qui ne sont pas une entrée de fonction (banc/bench.py : MAIN_LOOP_TURN, au milieu de main_loop).
DEFAULT_HOOKS = [0x106710]


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
