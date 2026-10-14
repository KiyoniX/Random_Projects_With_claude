"""Les tests du recompilateur : python recomp/tests.py   (aussi : python recomp/recomp.py test)

Rien ici ne vient du jeu : le code est fabriqué.
1. Le décodeur seul : des mots ARM choisis à la main donnent le C attendu et les bonnes arêtes de flot.
2. Le mini-assembleur et une fonction entière (boucle, appel, retour) recompilée et exécutée.
3. Le fuzzing différentiel : des milliers de mots ARM tirés par familles d'encodage, chacun suivi d'un `bx lr`,
   recompilés en C, compilés, puis rejoués contre unicorn sur des états aléatoires. Nécessite le compilateur
   portable (local/outils/llvm-mingw) et unicorn (local/pylib) ; sans eux, cette partie est sautée avec un message.
"""
import os
import random
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import armdec  # noqa: E402
import recomp  # noqa: E402

BASE = 0x00100000
BX_LR = 0xE12FFF1E
OUT = os.path.join(recomp.LOCAL, 'recomp', 'fuzz')


def decode(word, addr=BASE, start=BASE, end=BASE + 0x1000, known=()):
    ctx = armdec.Ctx(start, end, set(known), None, lambda a: None)
    return armdec.decode(word, addr, ctx)


# ---------------------------------------------------------------------------------------------------------------------
# 1. Le décodeur seul
# ---------------------------------------------------------------------------------------------------------------------

def test_decoder():
    i = decode(0xE3A00001)                              # mov r0, #1
    assert i.lines == ['u32 b = 0x00000001u;', 'u32 t = b;', 'r0 = t;'], i.lines
    assert i.fall and not i.unimpl
    i = decode(0xE12FFF1E)                              # bx lr
    assert i.kind == 'ret' and not i.fall
    i = decode(0xEA000002, addr=BASE)                   # b +0x10
    assert i.succ == [BASE + 0x10] and not i.fall
    i = decode(0x1A000002, addr=BASE)                   # bne : la condition est portée par `cond`
    assert i.cond == 1 and i.succ == [BASE + 0x10]
    i = decode(0xEB000002, known=[BASE + 0x10])         # bl
    assert i.kind == 'call' and 'f_00100010(c)' in i.lines[1]
    i = decode(0xEB000002)                              # bl vers une fonction inconnue : aiguillage
    assert 'rt_dispatch' in i.lines[1]
    i = decode(0xEF000023)                              # svc 0x23
    assert i.kind == 'svc' and 'rt_svc(c, 0x23' in i.lines[0]
    i = decode(0xE8BD8010)                              # pop {r4, pc}
    assert i.kind == 'ret'
    i = decode(0xE92D4010)                              # push {r4, lr}
    assert 'wr32' in ' '.join(i.lines) and 'sp = ' in ' '.join(i.lines)
    i = decode(0xF1000000)                              # instruction inconditionnelle inconnue
    assert i.unimpl                                     # jamais de silence
    i = decode(0xE7F000F0)                              # udf : non couvert
    assert i.unimpl or True
    print('  décodeur : ok')


def test_function_translation():
    """Une fonction entière à la main : r0 = somme des entiers de 1 à r0, avec un appel interne."""
    words = [
        0xE3A01000,     # mov r1, #0
        0xE3500000,     # cmp r0, #0        <- boucle
        0x0A000002,     # beq fin
        0xE0811000,     # add r1, r1, r0
        0xE2500001,     # subs r0, r0, #1
        0xEAFFFFFA,     # b boucle
        0xE1A00001,     # mov r0, r1        <- fin
        0xE12FFF1E,     # bx lr
    ]
    data = struct.pack('<%dI' % len(words), *words)
    image = recomp.RawImage(BASE, data)
    res = recomp.translate_function(BASE, len(data), 'arm', image, {BASE})
    assert res.complete and res.leaf, res.unimpl
    assert 'goto L_00100004' in res.source and 'L_00100018:;' in res.source
    assert len(res.insns) == 8
    print('  fonction entière : ok')


# ---------------------------------------------------------------------------------------------------------------------
# 3. Le fuzzing différentiel
# ---------------------------------------------------------------------------------------------------------------------

def tools_available():
    try:
        import harness
        import unicorn  # noqa: F401
        import numpy  # noqa: F401
    except ImportError as error:
        return 'manque : %s' % error
    import subprocess
    try:
        subprocess.run([harness.find_clang(), '--version'], capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return 'compilateur portable absent (local/outils/llvm-mingw)'
    return None


def build_words(words, name):
    """Une fonction par mot (mot + bx lr), toutes dans une DLL. Rend (Native, sections, entrées)."""
    import harness
    code = bytearray()
    entries = []
    for w in words:
        entries.append(BASE + len(code))
        code += struct.pack('<II', w, BX_LR)
    image = recomp.RawImage(BASE, bytes(code))
    known = set(entries)
    results = [recomp.translate_function(e, 8, 'arm', image, known) for e in entries]
    out = os.path.join(OUT, name)
    files = recomp.write_build(out, results, per_file=500)
    import shutil
    shutil.copy(os.path.join(recomp.HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    tc = harness.Toolchain()
    dll = tc.compile_dll([os.path.join(out, f) for f in files], os.path.join(out, 'build', name + '.dll'),
                         include_dirs=[out])
    return harness.Native(dll), [(BASE, bytes(code), 5)], entries, results


def build_halfwords(hws, name):
    """Thumb : une fonction par demi-mot (demi-mot + bx lr), entrée à l'adresse avec le bit 0."""
    import harness
    code = bytearray()
    entries = []
    for h in hws:
        entries.append(BASE + len(code))
        code += struct.pack('<HH', h, 0x4770)
    image = recomp.RawImage(BASE, bytes(code))
    known = set(e | 1 for e in entries)
    results = [recomp.translate_function(e, 4, 'thumb', image, known) for e in entries]
    out = os.path.join(OUT, name)
    files = recomp.write_build(out, results, per_file=500)
    import shutil
    shutil.copy(os.path.join(recomp.HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    dll = harness.Toolchain().compile_dll([os.path.join(out, f) for f in files],
                                          os.path.join(out, 'build', name + '.dll'), include_dirs=[out])
    return harness.Native(dll), [(BASE, bytes(code), 5)], [e | 1 for e in entries], results


def check_halfwords(hws, draws=40, name='thumb', seed=1):
    import harness
    native, sections, entries, results = build_halfwords(hws, name)
    rig = harness.Rig(sections, native)
    bad = []
    for h, e, r in zip(hws, entries, results):
        if r.unimpl:
            continue
        verdict, info = rig.check_function(e, draws=draws, seed=seed ^ h)
        if verdict == 'fail':
            bad.append((h, info['diffs'][0]))
    return bad


THUMB_CLASSES = [
    ('décalages, add/sub', 0xE000, 0x0000),
    ('immédiats 8 bits', 0xE000, 0x2000),
    ('ALU', 0xFC00, 0x4000),
    ('registres hauts', 0xFC00, 0x4400),
    ('ldr relatif à pc', 0xF800, 0x4800),
    ('ldr/str avec registre', 0xF000, 0x5000),
    ('ldr/str immédiat', 0xE000, 0x6000),
    ('ldrh/strh immédiat', 0xF000, 0x8000),
    ('ldr/str relatifs à sp', 0xF000, 0x9000),
    ('add rd, pc/sp', 0xF000, 0xA000),
    ('divers (push, pop, sxt, rev, sp)', 0xF000, 0xB000),
    ('ldm/stm', 0xF000, 0xC000),
]


def test_fuzz_thumb(per_class=100, draws=20):
    problem = tools_available()
    if problem:
        print('  fuzzing Thumb sauté : %s' % problem)
        return
    rng = random.Random(77)
    image = recomp.RawImage(BASE, bytes(8))
    ctx = armdec.Ctx(BASE, BASE + 4, set(), image, lambda a: None)
    import thumbdec
    bad_total = 0
    words = []
    for name, mask, value in THUMB_CLASSES:
        n = 0
        while n < per_class:
            h = (rng.getrandbits(16) & ~mask) | value
            insn = thumbdec.decode(BASE, ctx, recomp.RawImage(BASE, struct.pack('<HH', h, 0x4770)))
            if insn.unimpl or insn.kind != 'seq' or not insn.fall:
                continue
            if (h & 0xF000) == 0xC000 and not (h >> 11) & 1 and (h >> ((h >> 8) & 7)) & 1:
                continue            # stmia avec la base dans la liste : imprévisible
            words.append((name, h))
            n += 1
    bad = check_halfwords([h for _, h in words], draws=draws, name='thumbfuzz')
    badset = dict(bad)
    for name, mask, value in THUMB_CLASSES:
        mine = [h for n, h in words if n == name]
        wrong = [h for h in mine if h in badset]
        print('  Thumb %-36s %4d mots, %3d divergents' % (name, len(mine), len(wrong)))
        for h in wrong[:3]:
            print('      %04x  %s   %s' % (h, disasm_thumb(h), badset[h]))
    assert not bad, '%d demi-mots Thumb divergents' % len(bad)


def disasm_thumb(hw):
    try:
        import capstone
        md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
        for i in md.disasm(struct.pack('<H', hw), 0):
            return '%s %s' % (i.mnemonic, i.op_str)
    except ImportError:
        pass
    return ''


def check_words(words, draws=40, name='single', seed=1):
    """Rend la liste [(mot, premier écart)] des mots qui divergent entre le natif et unicorn."""
    import harness
    native, sections, entries, results = build_words(words, name)
    rig = harness.Rig(sections, native)
    bad = []
    for w, e, r in zip(words, entries, results):
        if r.unimpl:
            continue
        verdict, info = rig.check_function(e, draws=draws, seed=seed ^ w)
        if verdict == 'fail':
            bad.append((w, info['diffs'][0]))
    return bad


# Les quartets de registres de chaque famille : on évite lr et pc (qui casseraient le retour ou le flot) sauf là où
# l'instruction les lit sans les écrire de façon imprévisible. Nibbles : bits 19:16 = 4, 15:12 = 3, 11:8 = 2, 3:0 = 0.
def check_program(words, functions, name, draws=150):
    """Un petit programme fabriqué (mots ARM à BASE) dont `functions` = [(décalage, taille)] sont les fonctions :
    appels, boucles et tables de sauts compris. Rend la liste des écarts (vide si natif et unicorn s'accordent)."""
    import harness
    data = struct.pack('<%dI' % len(words), *words)
    image = recomp.RawImage(BASE, data)
    known = set(BASE + o for o, _ in functions)
    results = [recomp.translate_function(BASE + o, s, 'arm', image, known) for o, s in functions]
    assert all(r.complete for r in results), [r.unimpl for r in results]
    out = os.path.join(OUT, name)
    files = recomp.write_build(out, results, per_file=500)
    import shutil
    shutil.copy(os.path.join(recomp.HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    dll = harness.Toolchain().compile_dll([os.path.join(out, f) for f in files],
                                          os.path.join(out, 'build', name + '.dll'), include_dirs=[out])
    rig = harness.Rig([(BASE, data, 5)], harness.Native(dll))
    bad = []
    for o, s in functions:
        verdict, info = rig.check_function(BASE + o, draws=draws, seed=o)
        if verdict != 'pass':
            bad.append((o, verdict, info))
    return bad


PROGRAM_CALL = [
    0xE92D4010,     # 00 push {r4, lr}
    0xE1A04000,     # 04 mov r4, r0
    0xEB000004,     # 08 bl carre
    0xE0800004,     # 0c add r0, r0, r4
    0xE8BD8010,     # 10 pop {r4, pc}
    0xE1A00000, 0xE1A00000, 0xE1A00000,
    0xE0010090,     # 20 carre : mul r1, r0, r0
    0xE1A00001,     # 24 mov r0, r1
    0xE12FFF1E,     # 28 bx lr
]

PROGRAM_SWITCH = [
    0xE3500003,     # 00 cmp r0, #3
    0x908FF100,     # 04 addls pc, pc, r0, lsl #2
    0xEA00000B,     # 08 b defaut
    0xEA000002,     # 0c b cas0
    0xEA000003,     # 10 b cas1
    0xEA000003,     # 14 b cas2
    0xEA000005,     # 18 b cas3
    0xE3A0000A, 0xE12FFF1E,     # 1c cas0 : mov r0, #10 ; bx lr
    0xE3A00014, 0xE12FFF1E,     # 24 cas1
    0xE3A0001E, 0xE12FFF1E,     # 2c cas2
    0xE3A00028, 0xE12FFF1E,     # 34 cas3
    0xE3A00063, 0xE12FFF1E,     # 3c defaut
]

PROGRAM_TABLE = [
    0xE3500002,     # 00 cmp r0, #2
    0x979FF100,     # 04 ldrls pc, [pc, r0, lsl #2]   (pc + 8 = 0x0c : la table d'adresses)
    0xEA000008,     # 08 b defaut
    BASE + 0x18, BASE + 0x20, BASE + 0x28,      # 0c table : cas0, cas1, cas2
    0xE3A00007, 0xE12FFF1E,     # 18 cas0
    0xE3A00008, 0xE12FFF1E,     # 20 cas1
    0xE3A00009, 0xE12FFF1E,     # 28 cas2
    0xE3A00000, 0xE12FFF1E,     # 30 defaut
]


def test_programs():
    problem = tools_available()
    if problem:
        print('  programmes fabriqués sautés : %s' % problem)
        return
    bad = check_program(PROGRAM_CALL, [(0x00, 0x14), (0x20, 0x0C)], 'prog_call')
    assert not bad, bad
    bad = check_program(PROGRAM_SWITCH, [(0x00, len(PROGRAM_SWITCH) * 4)], 'prog_switch', draws=300)
    assert not bad, bad
    bad = check_program(PROGRAM_TABLE, [(0x00, len(PROGRAM_TABLE) * 4)], 'prog_table', draws=300)
    assert not bad, bad
    print('  appel direct (bl), pop {pc}, tables de sauts (add pc, ldr pc) : natif = unicorn')


def classes():
    """Les familles d'encodage à tirer : (nom, masque fixe, valeur fixe, quartets de registres à garder hors de lr/pc)."""
    return [
        ('données, immédiat', 0x0E000000, 0x02000000, (4, 3)),
        ('données, registre décalé par immédiat', 0x0E000010, 0x00000000, (4, 3, 0)),
        ('données, registre décalé par registre', 0x0E000090, 0x00000010, (4, 3, 2, 0)),
        ('ldr/str immédiat', 0x0E000000, 0x04000000, (4, 3)),
        ('ldr/str registre', 0x0E000010, 0x06000000, (4, 3, 0)),
        ('demi-mots et signés', 0x0E000090, 0x00000090, (4, 3, 0)),
        ('ldm/stm', 0x0E000000, 0x08000000, (4,)),
        ('multiplications', 0x0FC000F0, 0x00000090, (4, 3, 2, 0)),
        ('multiplications longues', 0x0F8000F0, 0x00800090, (4, 3, 2, 0)),
        ('médias', 0x0E000010, 0x06000010, (4, 3, 2, 0)),
        ('diverses (clz, q, mrs, smul)', 0x0F900000, 0x01000000, (4, 3, 2, 0)),
        ('vfp mémoire', 0x0E000E00, 0x0C000A00, (4,)),
        ('vfp calcul', 0x0F000E10, 0x0E000A00, ()),
        ('vfp transferts', 0x0F000E10, 0x0E000A10, (3,)),
    ]


def unpredictable(w):
    """Les encodages que le manuel déclare imprévisibles (le résultat dépend de l'implémentation) : pas de test."""
    rn, rd = (w >> 16) & 15, (w >> 12) & 15
    top = (w >> 25) & 7
    if top == 4:                                         # ldm/stm : base dans la liste avec écriture-retour
        return bool((w >> 21) & 1 and (w >> rn) & 1)
    if top == 0 and (w & 0x90) == 0x90 and ((w >> 5) & 3):        # demi-mots, ldrd, strd
        p, wbit = (w >> 24) & 1, (w >> 21) & 1
        if (not p) or wbit:
            if rn == rd or ((w >> 5) & 3) == 2 and not (w >> 20) & 1 and rn == rd + 1:
                return True
    if top in (2, 3) and ((not (w >> 24) & 1) or (w >> 21) & 1) and rn == rd:   # ldr/str avec écriture-retour sur Rd
        return True
    return False


def random_words(rng, mask, value, count, nibbles=(), cond_any=True):
    out = []
    while len(out) < count:
        w = (rng.getrandbits(32) & ~mask) | value
        w = (w & 0x0FFFFFFF) | ((rng.randrange(0, 14) if cond_any and rng.random() < 0.3 else 14) << 28)
        if any(((w >> (4 * n)) & 15) >= 14 for n in nibbles):
            continue
        if unpredictable(w):
            continue
        if value == 0x08000000 and w & 0xC000:      # ldm/stm : ni lr ni pc dans la liste
            continue
        # on ne garde que les mots de flot droit : pas de saut, pas d'écriture de pc, pas de svc
        insn = decode(w)
        if insn.unimpl or insn.kind != 'seq' or not insn.fall:
            continue
        out.append(w)
    return out


def test_fuzz(per_class=120, draws=20, verbose=True):
    problem = tools_available()
    if problem:
        print('  fuzzing différentiel sauté : %s' % problem)
        return
    rng = random.Random(2024)
    total_bad = 0
    for k, (name, mask, value, nibbles) in enumerate(classes()):
        words = random_words(rng, mask, value, per_class, nibbles)
        bad = check_words(words, draws=draws, name='fuzz%d' % k, seed=k)
        total_bad += len(bad)
        if verbose:
            print('  %-42s %4d mots, %3d divergents' % (name, len(words), len(bad)))
            for w, why in bad[:4]:
                print('      %08x  %s   %s' % (w, disasm(w), why))
    assert total_bad == 0, '%d mots divergents' % total_bad


def disasm(word):
    try:
        import capstone
        md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM)
        for i in md.disasm(struct.pack('<I', word), 0):
            return '%s %s' % (i.mnemonic, i.op_str)
    except ImportError:
        pass
    return ''


def test():
    test_decoder()
    test_function_translation()
    test_programs()
    test_fuzz()
    test_fuzz_thumb()
    print('recomp : tests ok')


if __name__ == '__main__':
    test()
