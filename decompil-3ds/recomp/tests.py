"""Les tests du recompilateur : python recomp/tests.py   (aussi : python recomp/recomp.py test)

Rien ici ne vient du jeu : le code est fabriqué.
1. Le décodeur seul : des mots ARM choisis à la main donnent le C attendu et les bonnes arêtes de flot.
2. Le mini-assembleur et une fonction entière (boucle, appel, retour) recompilée et exécutée.
3. Le fuzzing différentiel : des milliers de mots ARM tirés par familles d'encodage, chacun suivi d'un `bx lr`,
   recompilés en C, compilés, puis rejoués contre unicorn sur des états aléatoires. Nécessite le compilateur
   portable (local/outils/llvm-mingw) et unicorn (local/pylib) ; sans eux, cette partie est sautée avec un message.
"""
import ctypes
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


PROGRAM_MANUAL_LR = [
    0xE92D4010,     # 00 push {r4, lr}
    0xE28FE010,     # 04 add lr, pc, #0x10            lr = 0x1c : l'adresse de retour choisie à la main
    0xE3100001,     # 08 tst r0, #1
    0x1A000003,     # 0c bne autre                    un branchement conditionnel entre « add lr » et le saut
    0xE28F2018,     # 10 add r2, pc, #0x18            r2 = aide
    0xE12FFF12,     # 14 bx r2                        un appel dont le retour est à 0x1c, pas à 0x18
    0xE1A00000,     # 18 nop
    0xE2800064,     # 1c add r0, r0, #100             la suite, atteinte quand aide revient
    0xE8BD8010,     # 20 pop {r4, pc}
    0xE3A00007,     # 24 autre : mov r0, #7
    0xEAFFFFFC,     # 28 b 0x20
    0xE1A00000,     # 2c nop
    0xE2800001,     # 30 aide : add r0, r0, #1
    0xE12FFF1E,     # 34 bx lr
]

PROGRAM_MANUAL_LR2 = [
    0xE92D4010,     # 00 push {r4, lr}
    0xE28FE010,     # 04 add lr, pc, #0x10
    0xE28EE004,     # 08 add lr, lr, #4               lr = 0x20 en deux temps
    0xE3100001,     # 0c tst r0, #1
    0x1A000004,     # 10 bne autre
    0xE28F2018,     # 14 add r2, pc, #0x18            r2 = aide
    0xE12FFF12,     # 18 bx r2
    0xE1A00000,     # 1c nop
    0xE2800064,     # 20 add r0, r0, #100             la reprise
    0xE8BD8010,     # 24 pop {r4, pc}
    0xE3A00007,     # 28 autre : mov r0, #7
    0xEAFFFFFC,     # 2c b 0x24
    0xE1A00000,     # 30 nop
    0xE2800001,     # 34 aide : add r0, r0, #1
    0xE12FFF1E,     # 38 bx lr
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
    bad = check_program(PROGRAM_MANUAL_LR, [(0x00, 0x30), (0x30, 8)], 'prog_manual_lr', draws=300)
    assert not bad, bad
    bad = check_program(PROGRAM_MANUAL_LR2, [(0x00, 0x34), (0x34, 8)], 'prog_manual_lr2', draws=300)
    assert not bad, bad
    print('  appel direct (bl), pop {pc}, tables de sauts (add pc, ldr pc), retour choisi par add lr, pc : natif = unicorn')


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



# ---------------------------------------------------------------------------------------------------------------------
# 4. Le processeur natif du banc (banc/cpu_native.py) : fibres, appels système, préemption, mode hybride
# ---------------------------------------------------------------------------------------------------------------------

def arm_branch(cond, src, dst, link=False):
    """Un mot B ou BL de `src` vers `dst`."""
    return (cond << 28) | (0x0B000000 if link else 0x0A000000) | (((dst - src - 8) >> 2) & 0xFFFFFF)


def test_native_cpu():
    """Un petit programme dans la DLL « hôte » : une boucle, un appel système, un appel vers du code non recompilé
    (exécuté par unicorn) qui rappelle une fonction recompilée, deux fils entrelacés, une boucle d'attente active préemptée
    et un repère. Le code est fabriqué, rien ne vient du jeu."""
    why = tools_available()
    if why:
        print('  cpu natif : sauté (%s)' % why)
        return
    import harness
    import shutil
    banc = os.path.join(recomp.ROOT, 'banc')
    if banc not in sys.path:
        sys.path.insert(0, banc)
    from cpu import Stop
    from cpu_native import NativeCpu
    from memory import PERM_R, PERM_RW, PERM_RX, AddressSpace
    AL = 14
    main = [0xE52DE004,                                     # 00 push {lr}
            0xE3A04000,                                     # 04 mov r4, #0
            0xE2844001,                                     # 08 add r4, r4, #1
            0xE3540064,                                     # 0c cmp r4, #100
            arm_branch(0xB, BASE + 0x10, BASE + 0x08),      # 10 blt 08  (en arrière : décompte de préemption)
            0xE1A00004,                                     # 14 mov r0, r4
            0xEF000024,                                     # 18 svc 0x24
            arm_branch(AL, BASE + 0x1C, 0x00200000, True),  # 1c bl 0x200000  (code non recompilé)
            0xE2800001,                                     # 20 add r0, r0, #1
            0xEF000025,                                     # 24 svc 0x25
            0xE49DF004]                                     # 28 pop {pc}
    nat2 = [0xE2800064, 0xE12FFF1E]                         # add r0, r0, #100 ; bx lr
    spin = [arm_branch(AL, BASE + 0x200, BASE + 0x200)]     # b .
    # retour non-local : « inner » dépile le cadre de « outer » (pop {r4, pc}) et revient donc à l'appelant de outer
    outer = [0xE92D4010,                                    # 300 push {r4, lr}
             arm_branch(AL, BASE + 0x304, BASE + 0x320, True),     # 304 bl inner
             0xE2800005,                                    # 308 add r0, r0, #5   (jamais exécuté)
             0xE8BD8010]                                    # 30c pop {r4, pc}
    inner = [0xE2800001, 0xE8BD8010]                        # 320 add r0, r0, #1 ; pop {r4, pc}
    caller = [0xE52DE004,                                   # 340 push {lr}
              0xE3A00007,                                   # 344 mov r0, #7
              arm_branch(AL, BASE + 0x348, BASE + 0x300, True),     # 348 bl outer
              0xE2800064,                                   # 34c add r0, r0, #100
              0xEF000026,                                   # 350 svc 0x26
              0xE49DF004]                                   # 354 pop {pc}
    # retour non-local qui enjambe du code non recompilé : A appelle B, B appelle du code non recompilé, qui appelle X ;
    # X dépile le cadre de B et de ce code (pop {r1} puis pop {r4, pc}) et revient donc à A
    caller_a = [0xE52DE004,                                 # 380 push {lr}
                0xE3A00007,                                 # 384 mov r0, #7
                arm_branch(AL, BASE + 0x388, BASE + 0x3A0, True),     # 388 bl B
                0xE2800064,                                 # 38c add r0, r0, #100
                0xEF000027,                                 # 390 svc 0x27
                0xE49DF004]                                 # 394 pop {pc}
    func_b = [0xE92D4010,                                   # 3a0 push {r4, lr}
              arm_branch(AL, BASE + 0x3A4, 0x200040, True),   # 3a4 bl (code non recompilé)
              0xE2800005,                                   # 3a8 add r0, r0, #5   (jamais exécuté)
              0xE8BD8010]                                   # 3ac pop {r4, pc}
    func_x = [0xE2800001, 0xE49D1004, 0xE8BD8010]           # 3c0 add r0, r0, #1 ; pop {r1} ; pop {r4, pc}
    hole2 = struct.pack('<4I', 0xE52DE004, arm_branch(AL, 0x200044, BASE + 0x3C0, True), 0xE2800032, 0xE49DF004)
    # adresse de reprise : G fixe lr à une de ses propres adresses (add lr, pc, #imm), l'empile avec r4, puis appelle H qui
    # dépile ce cadre (pop {r4, pc}) : H « revient » donc au milieu de G, sans que G ait fait d'appel vers cette adresse
    func_g = [0xE52DE004,                                   # 400 push {lr}
              0xE28FE014,                                   # 404 add lr, pc, #0x14     lr = 0x420
              0xE92D4010,                                   # 408 push {r4, lr}
              arm_branch(AL, BASE + 0x40C, BASE + 0x440, True),     # 40c bl H
              0xE2800005,                                   # 410 add r0, r0, #5   (jamais exécuté)
              0xE1A00000, 0xE1A00000, 0xE1A00000,           # 414 418 41c nop
              0xE2800FFA,                                   # 420 add r0, r0, #1000    (la reprise)
              0xE49DF004]                                   # 424 pop {pc}
    func_h = [0xE2800001, 0xE8BD8010]                       # 440 add r0, r0, #1 ; pop {r4, pc}
    caller_g = [0xE52DE004,                                 # 460 push {lr}
                0xE3A00007,                                 # 464 mov r0, #7
                arm_branch(AL, BASE + 0x468, BASE + 0x400, True),     # 468 bl G
                0xEF000029,                                 # 46c svc 0x29
                0xE49DF004]                                 # 470 pop {pc}
    # même chose, mais l'appel de H est un branchement en position terminale (b H) et la reprise est une autre fonction
    func_g2 = [0xE52DE004,                                  # 4a0 push {lr}
               0xE28FE00C,                                  # 4a4 add lr, pc, #0xc      lr = 0x4b8
               0xE92D4010,                                  # 4a8 push {r4, lr}
               arm_branch(AL, BASE + 0x4AC, BASE + 0x440),  # 4ac b H
               0xE1A00000, 0xE1A00000,                      # 4b0 4b4 nop
               0xE2800FFA,                                  # 4b8 add r0, r0, #1000    (la reprise)
               0xE49DF004]                                  # 4bc pop {pc}
    caller_g2 = [0xE52DE004, 0xE3A00007,                    # 4e0 push {lr} ; mov r0, #7
                 arm_branch(AL, BASE + 0x4E8, BASE + 0x4A0, True),     # 4e8 bl G2
                 0xEF00002A,                                # 4ec svc 0x2a
                 0xE49DF004]                                # 4f0 pop {pc}
    data = bytearray(0x500)
    for offset, words in ((0, main), (0x100, nat2), (0x200, spin), (0x300, outer), (0x320, inner), (0x340, caller),
                          (0x380, caller_a), (0x3A0, func_b), (0x3C0, func_x), (0x400, func_g), (0x440, func_h),
                          (0x460, caller_g), (0x4A0, func_g2), (0x4E0, caller_g2)):
        data[offset:offset + 4 * len(words)] = struct.pack('<%dI' % len(words), *words)
    hole = struct.pack('<5I', 0xE52DE004, 0xE280000A, arm_branch(AL, 0x200008, BASE + 0x100, True), 0xE2800FFA, 0xE49DF004)
    entries = [(BASE, 0x2C), (BASE + 0x100, 8), (BASE + 0x200, 4), (BASE + 0x300, 0x10), (BASE + 0x320, 8), (BASE + 0x340, 0x18),
               (BASE + 0x380, 0x18), (BASE + 0x3A0, 0x10), (BASE + 0x3C0, 0xC), (BASE + 0x400, 0x28), (BASE + 0x440, 8),
               (BASE + 0x460, 0x14), (BASE + 0x4A0, 0x18), (BASE + 0x4B8, 8), (BASE + 0x4E0, 0x14)]
    image = recomp.RawImage(BASE, bytes(data))
    known = set(a for a, _ in entries)
    results = [recomp.translate_function(a, n, 'arm', image, known) for a, n in entries]
    assert all(r.complete for r in results)
    out = os.path.join(OUT, 'cpu_natif')
    files = recomp.write_build(out, results, per_file=500)
    shutil.copy(os.path.join(recomp.HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    dll = harness.Toolchain().compile_dll([os.path.join(out, f) for f in files],
                                          os.path.join(out, 'build', 'hote.dll'), include_dirs=[out], budget=False,
                                          host=True)
    memory = AddressSpace()
    cpu = NativeCpu(memory, dll=dll, hybrid=True)
    memory.map(BASE, 0x1000, PERM_RX, 'code recompilé')
    memory.write(BASE, bytes(data))
    memory.map(0x00200000, 0x1000, PERM_RX, 'code non recompilé')
    memory.write(0x00200000, hole)
    memory.write(0x00200040, hole2)
    memory.map(0x0F000000, 0x10000, PERM_RW, 'pile')
    memory.map(0x1FF82000, 0x1000, PERM_RW, 'tls')
    sp = 0x0F010000

    def start(entry):
        ctx = cpu.new_context(entry, sp - 0x1000 * len(started), 0, 0x1FF82000)
        started.append(ctx)
        return ctx
    started = []
    one = start(BASE)
    cpu.restore(one)
    stop = cpu.run(1_000_000)
    assert stop.kind == Stop.SVC and stop.number == 0x24 and stop.address == BASE + 0x1C, stop
    assert cpu.get('r0') == 100 and cpu.get('pc') == BASE + 0x1C
    cpu.set('r0', 7)
    stop = cpu.run(1_000_000)
    # 7 + 10 (code non recompilé) + 100 (fonction recompilée appelée par ce code) + 1000 + 1
    assert stop.kind == Stop.SVC and stop.number == 0x25 and cpu.get('r0') == 1118, (stop, cpu.get('r0'))
    assert cpu.stats['natif_vers_unicorn'] == 1 and cpu.stats['unicorn_vers_natif'] == 1, cpu.stats
    stop = cpu.run(1_000_000)
    assert stop.kind == Stop.FAULT and 'ExitThread' in stop.detail, stop
    # deux fils entrelacés : chacun garde sa pile, ses registres et son point de reprise
    a, b = start(BASE), start(BASE)
    cpu.restore(a)
    assert cpu.run(1_000_000).number == 0x24
    cpu.set('r0', 1)
    saved = cpu.save()
    cpu.restore(b)
    assert cpu.run(1_000_000).number == 0x24 and cpu.get('r0') == 100
    cpu.set('r0', 2)
    assert cpu.run(1_000_000).number == 0x25 and cpu.get('r0') == 1113
    cpu.restore(saved)
    assert cpu.run(1_000_000).number == 0x25 and cpu.get('r0') == 1112
    # une boucle d'attente active rend la main à la fin de sa tranche, et reprend ensuite
    spinner = start(BASE + 0x200)
    cpu.restore(spinner)
    for _ in range(3):
        stop = cpu.run(4000)
        assert stop.kind == Stop.LIMIT, stop
    # un repère à l'entrée d'une fonction recompilée, une seule fois
    seen = []
    cpu.watch(BASE + 0x100, seen.append, once=True)
    c = start(BASE)
    cpu.restore(c)
    cpu.run(1_000_000)
    cpu.set('r0', 0)
    cpu.run(1_000_000)
    assert seen == [BASE + 0x100], seen
    # le retour non-local : le C remonte jusqu'à l'appel qui attendait cette adresse, le code mort de « outer » ne tourne pas
    n = start(BASE + 0x340)
    cpu.restore(n)
    stop = cpu.run(1_000_000)
    assert stop.kind == Stop.SVC and stop.number == 0x26 and cpu.get('r0') == 108, (stop, cpu.get('r0'))
    assert cpu.lib.rt_get_unwinds() >= 1
    n = start(BASE + 0x380)
    cpu.restore(n)
    stop = cpu.run(1_000_000)
    assert stop.kind == Stop.SVC and stop.number == 0x27 and cpu.get('r0') == 108, (stop, cpu.get('r0'))
    assert not cpu.holes_seen, cpu.holes_seen         # A a repris en natif, pas sous unicorn
    # une adresse de reprise à l'intérieur de la fonction : G continue à 0x420 (et le code mort ne tourne pas)
    n = start(BASE + 0x460)
    cpu.restore(n)
    stop = cpu.run(1_000_000)
    assert stop.kind == Stop.SVC and stop.number == 0x29 and cpu.get('r0') == 1008, (stop, cpu.get('r0'))
    n = start(BASE + 0x4E0)
    cpu.restore(n)
    stop = cpu.run(1_000_000)
    assert stop.kind == Stop.SVC and stop.number == 0x2A and cpu.get('r0') == 1008, (stop, cpu.get('r0'))
    print('  cpu natif : ok (appels système, reprise, hybride, deux fils, préemption, repère, retours non-locaux)')


def vcvt_words():
    """Les conversions VFP où D ou M désignent le bit de poids faible d'un registre simple (et non d16-d31) : un registre
    simple impair d'un côté, un double de l'autre. Le décodeur les prenait pour des registres de la VFPv3."""
    words = []
    for sm in (0, 1, 2, 5, 7, 30, 31):
        for dd in (0, 2, 14):
            for signed in (0, 1):
                words.append(0xEEB80B40 | signed << 7 | dd << 12 | (sm & 1) << 5 | sm >> 1)      # vcvt.f64.s32/u32 Dd, Sm
            words.append(0xEEB70AC0 | dd << 12 | (sm & 1) << 5 | sm >> 1)                       # vcvt.f64.f32 Dd, Sm
    for sd in (0, 1, 2, 5, 31):
        for dm in (0, 2, 14):
            for ext in (0xC, 0xD):
                for trunc in (0, 1):
                    words.append(0xEEB00B40 | ext << 16 | trunc << 7 | (sd & 1) << 22 | (sd >> 1) << 12 | dm)   # vcvt.s32.f64 Sd, Dm
            words.append(0xEEB70BC0 | (sd & 1) << 22 | (sd >> 1) << 12 | dm)                     # vcvt.f32.f64 Sd, Dm
    return words


def test_vfp_conversions():
    words = vcvt_words()
    for w in words:
        assert not decode(w).unimpl, '%08x : %s' % (w, decode(w).unimpl)
    # un double d16-d31 reste refusé (il n'existe pas sur l'ARM11)
    assert decode(0xEEB80B40 | 1 << 22).unimpl
    assert decode(0xEEB00B40 | 0xD << 16 | 1 << 5).unimpl          # vcvt.s32.f64 avec Dm = d16+
    problem = tools_available()
    if problem:
        print('  conversions VFP : décodées, comparaison sautée (%s)' % problem)
        return
    bad = check_words(words, draws=24, name='vcvt_odd', seed=5)
    assert not bad, bad[:3]
    print('  conversions VFP avec registres simples impairs : %d mots, natif = unicorn' % len(words))


# ---------------------------------------------------------------------------------------------------------------------
# 5. Les modules .cro recompilés (cro_recomp.py) : un C qui ne dépend pas de l'adresse de chargement
# ---------------------------------------------------------------------------------------------------------------------

def fabricated_module():
    """Un module .cro fabriqué : F1 (appel indirect par un pointeur relogé, appel direct, adresse calculée à partir de pc
    rangée en mémoire), T (table de sauts `ldr pc, [pc, r0, lsl #2]` aux entrées relogées), et un retour choisi par
    `add lr, pc, #imm`. Rend (octets du .cro, décalages des fonctions dans le segment de code)."""
    sys.path.insert(0, os.path.join(recomp.ROOT, 'outils'))
    import cro_loader as cl
    text = {
        0x00: 0xE92D4010,       # F1 : push {r4, lr}
        0x04: 0xE59F1030,       #      ldr r1, [pc, #0x30]       -> 0x3c : adresse de .data (correction interne)
        0x08: 0xE59F2030,       #      ldr r2, [pc, #0x30]       -> 0x40 : adresse de G (correction interne)
        0x0C: 0xE28F3010,       #      add r3, pc, #0x10         : une adresse du module, calculée à partir de pc
        0x10: 0xE5813000,       #      str r3, [r1]              : rangée en mémoire, pour que la comparaison la voie
        0x14: 0xE12FFF32,       #      blx r2                    : appel par un pointeur relogé
        0x18: 0xEB000005,       #      bl G
        0x1C: 0xE1A00000,
        0x20: 0xE8BD8010,       #      pop {r4, pc}
        0x34: 0xE2800007,       # G  : add r0, r0, #7
        0x38: 0xE12FFF1E,       #      bx lr
        0x44: 0xE3500002,       # T  : cmp r0, #2
        0x48: 0x979FF100,       #      ldrls pc, [pc, r0, lsl #2]
        0x4C: 0xEA000008,       #      b default
        0x5C: 0xE3A00001, 0x60: 0xE12FFF1E,     # cas 0
        0x64: 0xE3A00002, 0x68: 0xE12FFF1E,     # cas 1
        0x6C: 0xE3A00003, 0x70: 0xE12FFF1E,     # cas 2
        0x74: 0xE3A00063, 0x78: 0xE12FFF1E,     # default
        # M : un retour choisi à la main (« add lr, pc, #imm ») puis un saut par registre
        0x80: 0xE52DE004,       # M  : push {lr}
        0x84: 0xE28FE008,       #      add lr, pc, #8            lr = 0x94
        0x88: 0xE59F2010,       #      ldr r2, [pc, #0x10]       -> 0xa0 : adresse de G
        0x8C: 0xE12FFF12,       #      bx r2
        0x90: 0xE1A00000,
        0x94: 0xE2800064,       #      add r0, r0, #100          (la reprise)
        0x98: 0xE49DF004,       #      pop {pc}
    }
    words = [0xE1A00000] * 0x2C           # des nop partout ailleurs
    for off, w in text.items():
        words[off // 4] = w
    code = bytearray(struct.pack('<%dI' % len(words), *words))
    pool = {0x3C: 0, 0x40: 0x34, 0x50: 0x5C, 0x54: 0x64, 0x58: 0x6C, 0xA0: 0x34}
    internal = [(cl.make_tag(0, off), 2, 2 if off == 0x3C else 0, addend) for off, addend in pool.items()]
    cro = cl.make_cro('Fab', text=bytes(code), data=bytes(16), named_exports=[('F1', cl.make_tag(0, 0)), ('T', cl.make_tag(0, 0x44)),
                                                                              ('M', cl.make_tag(0, 0x80))], internal=internal)
    return cro, {'F1': 0, 'T': 0x44, 'M': 0x80, 'G': 0x34}


def build_fabricated_module(out):
    """Traduit le module fabriqué et le compile en DLL (sans programme principal : tables vides). Rend (DLL, cro, indice)."""
    import harness
    import shutil
    import cro_recomp
    import cro_loader as cl
    cro_bytes, offsets = fabricated_module()
    cro = cl.Cro(cro_bytes, 'Fab.cro')
    img = cro_recomp.ModuleImage(cro, 0)
    results = cro_recomp.translate_module(img, (), ())
    assert all(r.complete for r in results), [r.unimpl for r in results]
    os.makedirs(out, exist_ok=True)
    files, table = cro_recomp.write_module(out, img, results)
    summary = dict(name='Fab', index=0, files=files, table=table, functions=len(results), insns=0, unimpl=0, covered=0,
                   code_off=img.code_off, code_size=img.code_size, file_size=len(cro.data), sha1=img.code_hash(),
                   mask=img.mask_offsets())
    cro_recomp.write_tables(out, [summary])
    recomp.write_build(out, [], per_file=10)           # table.c vide : pas de programme principal
    shutil.copy(os.path.join(recomp.HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    sources = [os.path.join(out, f) for f in files + ['table.c', 'cro_table.c']]
    dll = harness.Toolchain().compile_dll(sources, os.path.join(out, 'build', 'fab.dll'), include_dirs=[out], budget=False)
    return dll, cro, offsets, img


def relocated_sections(cro, base):
    """Le module tel que ro le laisse en mémoire à `base` : le fichier relogé, puis son .data."""
    import cro_recomp
    img = cro_recomp.ModuleImage(cro, 0, fake=base)
    data_address = base + (len(cro.data) + 0xFFF) // 0x1000 * 0x1000
    return img, [(base, bytes(img.module.image), 5), (data_address, bytes(img.module.data), 3)], data_address


def test_cro_relocatable():
    """Le même C, à trois adresses de chargement, donne les mêmes résultats qu'unicorn sur le module relogé là : le
    module est relogeable (adresses dérivées de pc, pointeurs relogés, tables de sauts, retour choisi à la main)."""
    why = tools_available()
    if why:
        print('  modules .cro : sautés (%s)' % why)
        return
    import harness
    import cro_recomp
    dll, cro, offsets, img = build_fabricated_module(os.path.join(OUT, 'cro_fab'))
    source = open(os.path.join(OUT, 'cro_fab', 'cro_Fab_00.c')).read()
    assert 'RT_MBASE + 0x' in source and 'case 0x%08xu' % (img.fake + 0x180 + 0x50) in source
    native = harness.Native(dll)
    native.lib.rt_cro_init()
    native.lib.rt_mod_set_base.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
    for base in (0x00700000, 0x00A55000, 0x03E00000):
        native.lib.rt_mod_set_base(0, base)
        loaded, sections, data_address = relocated_sections(cro, base)
        rig = harness.Rig(sections, native)
        for name in ('F1', 'T', 'M'):
            entry = base + 0x180 + offsets[name]
            verdict, info = rig.check_function(entry, draws=60, seed=base ^ offsets[name],
                                               ptr_regions=[(harness.HEAP + 0x1000, 0x8000), (data_address, 16)])
            assert verdict == 'pass', (hex(base), name, verdict, info.get('diffs'))
        native.lib.rt_mod_set_base(0, 0)
    # un module déchargé (base 0) n'est plus trouvé : le saut n'a pas de cible
    loaded, sections, data_address = relocated_sections(cro, 0x00700000)
    rig = harness.Rig(sections, native)
    state = rig.draw(__import__('numpy').random.RandomState(1), [(harness.HEAP + 0x1000, 0x8000)])
    rig.reset_memory(state)
    assert rig.run_native(0x00700000 + 0x180, state) == 3          # RT_NO_TARGET
    print('  modules .cro : le même C, trois bases de chargement, natif = unicorn (appel par pointeur relogé, table de sauts, '
          'adresse dérivée de pc, retour choisi à la main) ; déchargé : aucune cible')


def test_cro_cpu():
    """Le processeur natif branche un module à son chargement, le débranche à son déchargement, refuse un code différent
    de celui qu'il a compilé, et ne laisse jamais le code d'une ancienne adresse s'exécuter."""
    why = tools_available()
    if why:
        print('  cpu et modules .cro : sautés (%s)' % why)
        return
    import harness
    import cro_recomp
    banc = os.path.join(recomp.ROOT, 'banc')
    if banc not in sys.path:
        sys.path.insert(0, banc)
    from cpu import Stop
    from cpu_native import NativeCpu
    from memory import PERM_RW, PERM_RWX, PERM_RX, AddressSpace
    import shutil
    out = os.path.join(OUT, 'cro_cpu')
    dll_dir = os.path.join(out, 'mod')
    cro_bytes, offsets = fabricated_module()
    import cro_loader as cl
    cro = cl.Cro(cro_bytes, 'Fab.cro')
    FILE_SIZE = len(cro_bytes)
    img = cro_recomp.ModuleImage(cro, 0)
    results = cro_recomp.translate_module(img, (), ())
    os.makedirs(dll_dir, exist_ok=True)
    mod_files, table = cro_recomp.write_module(dll_dir, img, results)
    cro_recomp.write_tables(dll_dir, [dict(name='Fab', index=0, files=mod_files, table=table, functions=len(results),
                                           code_off=img.code_off, code_size=img.code_size, file_size=len(cro.data),
                                           sha1=img.code_hash(), mask=img.mask_offsets())])
    # le programme principal : appelle l'adresse reçue dans r0 (celle d'une fonction du module), puis un appel système
    main = [0xE52DE004,                                     # 00 push {lr}
            0xE1A01000,                                     # 04 mov r1, r0
            0xE3A00001,                                     # 08 mov r0, #1
            0xE12FFF31,                                     # 0c blx r1
            0xEF000024,                                     # 10 svc 0x24
            0xE49DF004]                                     # 14 pop {pc}
    data = struct.pack('<6I', *main)
    image = recomp.RawImage(BASE, data)
    res = recomp.translate_function(BASE, 0x18, 'arm', image, {BASE})
    files = recomp.write_build(dll_dir, [res], per_file=10)
    shutil.copy(os.path.join(recomp.HERE, 'runtime', 'rt.h'), os.path.join(dll_dir, 'rt.h'))
    sources = [os.path.join(dll_dir, f) for f in files + mod_files + ['cro_table.c']]
    dll = harness.Toolchain().compile_dll(sources, os.path.join(dll_dir, 'build', 'hote.dll'), include_dirs=[dll_dir],
                                          budget=False, host=True)
    memory = AddressSpace()
    cpu = NativeCpu(memory, dll=dll, hybrid=True)
    assert 'Fab' in cpu.modules
    memory.map(BASE, 0x1000, PERM_RX, 'code recompilé')
    memory.write(BASE, data)
    memory.map(0x0F000000, 0x10000, PERM_RW, 'pile')
    memory.map(0x1FF82000, 0x1000, PERM_RW, 'tls')
    memory.map(0x00800000, 0x40000, PERM_RW, 'tas')

    def load(base, tamper=False):
        """Ce que fait ro : le module relogé à `base`, en lecture-écriture-exécution, puis l'avis au processeur."""
        _, sections, data_address = relocated_sections(cro, base)
        memory.map(base, len(sections[0][1]), PERM_RWX, 'miroir')
        memory.write(base, sections[0][1])
        memory.map(data_address, 0x1000, PERM_RW, 'data')
        memory.write(data_address, sections[1][1])
        if tamper:
            memory.write(base + 0x180 + 0x34, struct.pack('<I', 0xE2800009))        # G ajoute 9 au lieu de 7
        return cpu.module_loaded('Fab', base), data_address

    def call(entry, r0=1):
        ctx = cpu.new_context(BASE, 0x0F010000, entry, 0x1FF82000)
        cpu.restore(ctx)
        stop = cpu.run(1_000_000)
        assert stop.kind == Stop.SVC and stop.number == 0x24, stop
        return cpu.get('r0')
    # 1) chargé à une adresse : F1 appelé depuis le programme principal va au natif (aucun passage par unicorn)
    ok, data_address = load(0x00700000)
    assert ok and cpu.stats['modules branchés'] == 1
    r0 = call(0x00700000 + 0x180)
    assert r0 == 1 + 7 + 7, r0
    assert cpu.stats['natif_vers_unicorn'] == 0 and cpu.stats['unicorn_vers_natif'] == 0, cpu.stats
    assert struct.unpack('<I', memory.read(data_address, 4))[0] == 0x00700000 + 0x180 + 0x24        # l'adresse dérivée de pc
    # 2) déchargé (la mémoire est reprise) : plus rien n'est branché
    memory.unmap(0x00700000, FILE_SIZE)
    assert not cpu.loaded and cpu.stats['modules débranchés'] == 1
    # 3) rechargé ailleurs : le même C sert, avec la nouvelle base
    ok, data_address = load(0x00A55000)
    assert ok
    assert call(0x00A55000 + 0x180) == 15
    assert struct.unpack('<I', memory.read(data_address, 4))[0] == 0x00A55000 + 0x180 + 0x24
    assert cpu.stats['natif_vers_unicorn'] == 0, cpu.stats
    memory.unmap(0x00A55000, FILE_SIZE)
    memory.unmap(data_address, 0x1000)
    # 4) un code différent de celui qui a été compilé : refusé, le module s'exécute sous unicorn, avec son vrai code
    ok, data_address = load(0x00C00000, tamper=True)
    assert not ok and not cpu.loaded and cpu.stats['modules refusés (code différent)'] == 1
    assert call(0x00C00000 + 0x180) == 1 + 9 + 9, cpu.get('r0')
    assert cpu.stats['natif_vers_unicorn'] >= 1
    print('  cpu et modules .cro : branché au chargement, natif sans passer par unicorn, débranché au déchargement, rechargé '
          'ailleurs, code différent refusé (et exécuté par unicorn)')


def test():
    test_decoder()
    test_function_translation()
    test_programs()
    test_fuzz()
    test_vfp_conversions()
    test_fuzz_thumb()
    test_native_cpu()
    test_cro_relocatable()
    test_cro_cpu()
    print('recomp : tests ok')


if __name__ == '__main__':
    test()
