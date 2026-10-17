"""Re-prouve par l'exécution les noms de bibliothèque des fiches : memcpy, divisions, strlen, crc16, sha256...

    python oracles.py [BINAIRE ...]     tous les binaires analysés (local/analyse/<b>/gh), ou seulement ceux-là
    python oracles.py test              essais sur du code fabriqué, puis quelques routines du vrai code s'il est là

Pour chaque binaire qui a une fiche de noms, chaque nom de la table ORACLES (aux suffixes « _alt_<adresse> » près)
est exécuté sous unicorn à son adresse, en ARM ou en Thumb selon Ghidra (ou selon l'entrée retrouvée par
couverture.py, ou à défaut d'après les octets : couverture.looks_arm), sur quelques centaines d'entrées tirées au hasard, et comparé à un oracle Python écrit d'après la
spécification C ou AEABI : les entrées ne dépendent pas du code essayé. Verdicts :
    OK            tous les cas passent
    FAUX          le premier cas en échec : l'entrée, l'attendu, l'obtenu (ou le plantage)
    NON TESTABLE  pas d'octets, ou la routine fait ce que l'essai ne fournit pas : appel système,
                  écriture dans les variables du programme (le code est en lecture et exécution seules)

Les accès non alignés sont des plantages comme sur la console (name_pass.Prober : ldm, stm, ldrd... sur l'ARM11 ; tout
accès de 2 ou 4 octets sur l'ARM9, cibles « v5t » de raw_targets.toml) : une copie par mots alignés n'est pas un
__aeabi_memcpy, qui accepte toute adresse (les cas de memcpy, __aeabi_memcpy, memclr_bytes ont des adresses
quelconques, ceux de memcpy_words et memclr des adresses alignées sur 4).

Le banc d'essai et les familles de cas sont ceux de la passe « stdlib » de name_pass.py (Prober, build_specs) : ici on
part du nom écrit dans la fiche et on vérifie qu'il est juste, là-bas on part d'une fonction sans nom. Les binaires
viennent des chargeurs de couverture.py (modules, cibles brutes de raw_targets.toml). Un outil à part, pas une
sous-commande de name_pass.py : il lit tous les binaires par couverture.py, qui importe déjà name_pass.

Signatures retenues (relevées dans local/analyse/{pm,sm,cfg,gsp}/notes-100.md, les noms canoniques des fiches) :
    __aeabi_memcpy, memcpy_unaligned (dst, src, n), rend dst+n     memcpy, memmove : rendent dst
    memcpy_words (dst, src, n) dst et src alignés sur 4             __aeabi_memmove (dst, src, n), recouvrement permis
    memset (dst, c, n) rend dst ; __aeabi_memset (dst, n, c)        memset_words (dst aligné, n, mot = c répété ×4)
    memclr (dst aligné, n) ; memclr_bytes, __aeabi_memclr (dst, n)  fill_words (début, fin, mot), mots de début à fin
    strncpy (dst, src, n) complète de nuls, rend dst                 crc16 (crc, données, n) : CRC-16/ARC
    log10f (s0) -> s0                                               __aeabi_lmul (a, b) 64 bits sur r0:r1, r2:r3
    sha256_hash (sortie, données, n)                                hmac_sha256 (sortie, données, n, clé, taille de clé)

Écrit local/analyse/oracles/verdicts.tsv (binaire, adresse, nom, verdict, détail). Rien de versionné ne bouge.
"""
import collections
import glob
import hashlib
import hmac
import math
import os
import random
import struct
import sys

import couverture
import ghidra_direct
import ghidra_raw
import name_pass
from name_pass import DATA_BASE, STACK_BASE, STACK_SIZE, SENTINEL, DATA_SIZE, Spec, crash, make_canvas, memory_diff

OUT = os.path.join(couverture.ANALYSE, 'oracles')
ROUNDS = 18                       # ~300 cas par routine (17 tailles × 18, 40 × 18 couples de division)
ALT = '_alt_'


# --- Les oracles qui ne servent pas à la passe stdlib ---

def fill_cases(seed, rounds):
    """fill_words(début, fin, mot) : le mot dans chaque case de début (aligné) à fin, fin exclue."""
    rng = random.Random(seed)
    cases = []
    for count in list(range(0, 17)) * rounds:
        def case(prober, address, thumb, count=count, salt=rng.randrange(1 << 30)):
            r = random.Random(salt)
            canvas = make_canvas(r)
            begin = DATA_BASE + 0x200 + 4 * r.randrange(0, 64)
            word = r.getrandbits(32)
            what = '(début=%#x, fin=%#x, mot=%#x)' % (begin, begin + 4 * count, word)
            prober.reset(canvas)
            if prober.call(address, thumb, [begin, begin + 4 * count, word, r.getrandbits(32)]) is None:
                return crash(prober, what)
            expected = bytearray(canvas)
            expected[begin - DATA_BASE:begin - DATA_BASE + 4 * count] = struct.pack('<I', word) * count
            return memory_diff(prober, expected, what)
        cases.append(case)
    return cases


def lmul_cases(seed, count):
    rng = random.Random(seed)
    edge = [0, 1, 2, 0xFFFFFFFF, 1 << 32, 0xFFFFFFFFFFFFFFFF, 1 << 63, 0x123456789ABCDEF0]
    cases = []
    for _ in range(count):
        a = rng.choice(edge + [rng.getrandbits(64), rng.getrandbits(rng.randrange(1, 65))])
        b = rng.choice(edge + [rng.getrandbits(64), rng.getrandbits(rng.randrange(1, 65))])
        def case(prober, address, thumb, a=a, b=b):
            what = '%#x * %#x' % (a, b)
            out = prober.call(address, thumb, [a & 0xFFFFFFFF, a >> 32, b & 0xFFFFFFFF, b >> 32])
            if out is None:
                return crash(prober, what)
            got, want = out[0] | out[1] << 32, a * b & 0xFFFFFFFFFFFFFFFF
            return None if got == want else '%s : attendu %#x, obtenu %#x' % (what, want, got)
        cases.append(case)
    return cases


def crc16_arc(crc, data):
    """CRC-16/ARC (polynôme 0x8005 réfléchi, 0xA001), à partir de `crc`."""
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = crc >> 1 ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def crc16_oracle(r, data, canvas):
    init = r.choice([0, 0xFFFF, r.getrandbits(16)])
    return crc16_arc(init, data), init


def buffer_cases(seed, rounds, oracle, args):
    """Une routine qui lit des octets et rend un mot ou écrit une sortie. oracle(r, données) -> (attendu, extra) ;
    args(data, n, out, extra) -> registres ; attendu est un entier (rendu dans r0) ou des octets (écrits à `out`)."""
    rng = random.Random(seed)
    cases = []
    for n in [0, 1, 2, 3, 4, 7, 9, 31, 55, 56, 63, 64, 65, 100, 119, 120, 200] * rounds:
        def case(prober, address, thumb, n=n, salt=rng.randrange(1 << 30)):
            r = random.Random(salt)
            canvas = bytearray(make_canvas(r))
            data = DATA_BASE + 0x100 + r.randrange(0, 4)
            out = DATA_BASE + 0x800 + 4 * r.randrange(0, 4)
            want, extra = oracle(r, bytes(canvas[data - DATA_BASE:data - DATA_BASE + n]), canvas)
            registers = args(data, n, out, extra)
            what = '(%s, n=%d)' % (', '.join('%#x' % v for v in registers), n)
            prober.reset(canvas)
            got = prober.call(address, thumb, registers)
            if got is None:
                return crash(prober, what)
            if isinstance(want, int):
                return memory_diff(prober, canvas, what) or (
                    None if got[0] == want else '%s : attendu %#x, obtenu %#x' % (what, want, got[0]))
            canvas[out - DATA_BASE:out - DATA_BASE + len(want)] = want
            return memory_diff(prober, canvas, what)
        cases.append(case)
    return cases


KEY = DATA_BASE + 0x600


def hmac_oracle(r, data, canvas):
    size = r.choice([0, 1, 16, 32, 63, 64, 65, 100])
    key = bytes(canvas[KEY - DATA_BASE:KEY - DATA_BASE + size])
    return hmac.new(key, data, hashlib.sha256).digest(), size


def as_float(bits):
    return struct.unpack('<f', struct.pack('<I', bits))[0]


def log10f_cases(seed, count):
    """log10f(x) en VFP (s0 -> s0), sur des x positifs finis : pour 0 et les négatifs, la routine écrit errno."""
    rng = random.Random(seed)
    values = [0x3F800000, 0x41200000, 0x447A0000, 0x3DCCCCCD, 0x00000001, 0x007FFFFF, 0x7F7FFFFF]
    values += [rng.randrange(1, 0x7F800000) for _ in range(count - len(values))]
    cases = []
    for bits in values:
        def case(prober, address, thumb, bits=bits):
            a = prober.a
            x = as_float(bits)
            what = 'log10f(%r)' % x
            prober.uc.reg_write(a.UC_ARM_REG_S0, bits)
            if prober.call(address, thumb, [bits, 0, 0, 0]) is None:
                return crash(prober, what)
            got, want = as_float(prober.uc.reg_read(a.UC_ARM_REG_S0)), math.log10(x)
            # float32 : quelques ulp d'écart permis ; ln ou log2 à la place de log10 s'écartent d'un facteur 2,3 ou 3,3
            return None if abs(got - want) <= 1e-6 * abs(want) + 1e-9 else '%s : attendu %r, obtenu %r' % (what, want, got)
        cases.append(case)
    return cases


def build_oracles(rounds=ROUNDS):
    """{nom de la fiche: Spec}."""
    specs = dict(name_pass.build_specs(rounds))
    p = name_pass
    end_copy = Spec('__aeabi_memcpy', p.copy_cases(901, 1, 0, 'end', rounds))
    oracles = {name: specs[name] for name in ('memcpy', 'memmove', '__aeabi_memmove', 'memset', '__aeabi_memset',
                                              '__aeabi_memclr', 'strlen', 'strcmp', 'strcpy', 'memcmp',
                                              '__aeabi_uidivmod', '__aeabi_uidiv', '__aeabi_idivmod', '__aeabi_idiv',
                                              '__aeabi_uldivmod', '__aeabi_ldivmod')}
    oracles.update({
        '__aeabi_memcpy': end_copy,
        'memcpy_unaligned': end_copy,
        'memcpy_words': specs['__aeabi_memcpy4'],
        'memclr': specs['__aeabi_memclr4'],
        'memclr_bytes': specs['__aeabi_memclr'],
        'memset_words': Spec('memset_words', p.set_cases(902, 4, 'nc', False, False, word=True, rounds=rounds)),
        'fill_words': Spec('fill_words', fill_cases(903, rounds)),
        'strncmp': Spec('strncmp', p.string_cases(904, 'strncmp', rounds)),
        'strncpy': Spec('strncpy', p.string_cases(905, 'strncpy', rounds)),
        '__aeabi_lmul': Spec('__aeabi_lmul', lmul_cases(906, 40 * rounds)),
        'crc16': Spec('crc16', buffer_cases(907, rounds, crc16_oracle, lambda data, n, out, init: [init, data, n, 0])),
        'log10f': Spec('log10f', log10f_cases(908, 17 * rounds)),
        'sha256_hash': Spec('sha256_hash', buffer_cases(909, max(1, rounds // 6),
                                                        lambda r, data, canvas: (hashlib.sha256(data).digest(), None),
                                                        lambda data, n, out, extra: [out, data, n, 0])),
        'hmac_sha256': Spec('hmac_sha256', buffer_cases(910, max(1, rounds // 6), hmac_oracle,
                                                        lambda data, n, out, size: [out, data, n, KEY, size])),
    })
    return oracles


# --- Le banc : un binaire, ses noms ---

def chunks(image):
    """Les morceaux d'une image à charger dans unicorn : chaque segment lu du fichier, complété de zéros (.bss)."""
    return [(base, image.data[offset:offset + size] + bytes(max(0, memory - size)))
            for base, offset, size, memory, _ in image.segments if size]


RESERVED = [(DATA_BASE, DATA_BASE + DATA_SIZE), (STACK_BASE, STACK_BASE + STACK_SIZE), (SENTINEL, SENTINEL + 0x1000)]


def make_prober(image, arm9=False):
    """Le Prober d'une image, ou le texte qui dit pourquoi on ne peut pas. arm9 : les accès non alignés de l'ARM9."""
    parts = chunks(image)
    for base, data in parts:
        for low, high in RESERVED:
            if base < high and low < base + len(data):
                return None, 'le binaire occupe la zone d\'essai %#x-%#x' % (low, high)
    return name_pass.Prober(parts, arm9=arm9), ''


def oracle_name(name):
    return name.split(ALT)[0]


def check_binary(binary, oracles, only=None):
    """[(binaire, adresse, nom, verdict, détail)] pour les noms de la fiche qui ont un oracle."""
    wanted = sorted((a, name) for a, (_, name) in binary.names.items()
                    if oracle_name(name) in oracles and (only is None or oracle_name(name) in only))
    if not wanted:
        return []
    rows = []
    if binary.image is None:
        return [(binary.name, a, name, 'NON TESTABLE', 'pas d\'octets dans local/extrait') for a, name in wanted]
    target = getattr(binary, 'target', None) or {}
    prober, why = make_prober(binary.image, target.get('language') == ghidra_raw.LANGUAGES['v5t'])
    if prober is None:
        return [(binary.name, a, name, 'NON TESTABLE', why) for a, name in wanted]
    modes = {a: m for a, _, m in binary.functions}
    if any(a not in modes for a, _ in wanted):
        couverture.add_entries(binary)
        modes = {a: m for a, _, m in binary.functions}
    for address, name in wanted:
        spec = oracles[oracle_name(name)]
        mode = modes.get(address)
        if mode is None:
            # Une adresse que ni Ghidra ni couverture.py ne connaissent (nom posé à la main) : les deux modes, celui
            # que suggèrent les octets d'abord (looks_arm se trompe à la frontière d'un code Thumb et d'un code ARM).
            guess = 'arm' if couverture.looks_arm(binary.image, address) else 'thumb'
            other = 'thumb' if guess == 'arm' else 'arm'
            why, blocked = spec.failure(prober, address, guess == 'thumb'), prober.blocked
            if why is not None and spec.check(prober, address, other == 'thumb'):
                rows.append((binary.name, address, name, 'OK', other + ' (mode absent de Ghidra, essayé)'))
                continue
            mode = guess + ' (mode absent de Ghidra, deviné)'
        else:
            why, blocked = spec.failure(prober, address, mode == 'thumb'), prober.blocked
        if why is None:
            rows.append((binary.name, address, name, 'OK', mode))
        else:
            rows.append((binary.name, address, name, 'NON TESTABLE' if blocked else 'FAUX', '%s : %s' % (mode, why)))
    return rows


def analysed():
    names = sorted(n for n in os.listdir(couverture.ANALYSE)
                   if os.path.isfile(os.path.join(couverture.ANALYSE, n, 'gh', 'funcs.tsv'))) \
        if os.path.isdir(couverture.ANALYSE) else []
    return names


def run(selected=None, rounds=ROUNDS, only=None):
    oracles = build_oracles(rounds)
    rows = []
    seen = set()
    for name in selected or analysed():
        binary = couverture.load_system(name, False)
        seen.add(os.path.normcase(os.path.abspath(binary.names_path)))
        if not any(oracle_name(n) in oracles for _, n in binary.names.values()):
            continue
        print('%s...' % name, flush=True)
        rows += check_binary(couverture.load_system(name, True), oracles, only)
    if not selected:
        # Les fiches dont le binaire n'est pas analysé ici (pas de funcs.tsv) : leurs noms restent sans preuve.
        for path in sorted(glob.glob(os.path.join(couverture.FICHES, '*.noms.tsv'))):
            if os.path.normcase(os.path.abspath(path)) in seen:
                continue
            for address, (_, n) in sorted(name_pass.read_names(path).items()):
                if oracle_name(n) in oracles and (only is None or oracle_name(n) in only):
                    rows.append((couverture.fiche_stem(path), address, n, 'NON TESTABLE',
                                 'pas de local/analyse/<binaire>/gh/funcs.tsv'))
    return rows


def report(rows):
    for b, a, n, verdict, detail in rows:
        if verdict != 'OK':
            print('%-12s %-12s %#10x  %-24s %s' % (verdict, b, a, n, detail))
    count = collections.defaultdict(collections.Counter)
    for _, _, n, verdict, _ in rows:
        count[oracle_name(n)][verdict] += 1
    print('\n%-20s %5s %5s %13s' % ('routine', 'OK', 'FAUX', 'NON TESTABLE'))
    for n in sorted(count):
        c = count[n]
        print('%-20s %5d %5d %13d' % (n, c['OK'], c['FAUX'], c['NON TESTABLE']))
    total = collections.Counter(v for _, _, _, v, _ in rows)
    print('%-20s %5d %5d %13d' % ('total', total['OK'], total['FAUX'], total['NON TESTABLE']))


def write(rows, folder=OUT):
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, 'verdicts.tsv')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('binaire\tadresse\tnom\tverdict\tdétail\n')
        for b, a, n, verdict, detail in rows:
            f.write('%s\t%#x\t%s\t%s\t%s\n' % (b, a, n, verdict, detail))
    print('écrit : %s' % path)


# --- Essais ---

# Un strlen Thumb fabriqué : movs r1,#0 ; ldrb r2,[r0,r1] ; cbz... sans cbz (ARMv6) : cmp r2,#0 ; beq ; adds ; b
THUMB_STRLEN = [0x2100, 0x5C42, 0x2A00, 0xD001, 0x3101, 0xE7FA, 0x0008, 0x4770]
ARM_STRLEN_OFF_BY_ONE = name_pass.ARM_STRLEN[:5] + [0xE2810001, 0xE12FFF1E]        # add r0, r1, #1 : un de trop
ARM_SVC = [0xEF000032, 0xE12FFF1E]
# Copie par mots (ldmia/stmia) puis octet par octet : juste si dst et src sont alignés, rend dst+n
ARM_MEMCPY_WORDS = [0xE3520004, 0xBA000003, 0xE8B10008, 0xE8A00008, 0xE2422004, 0xEAFFFFF9, 0xE2522001, 0xA4D13001,
                    0xA4C03001, 0xCAFFFFFB, 0xE12FFF1E]
# Mise à zéro par mots (stmia) puis octet par octet : juste si dst est aligné
ARM_MEMCLR_WORDS = [0xE3A02000, 0xE3510004, 0xBA000002, 0xE8A00004, 0xE2411004, 0xEAFFFFFA, 0xE2511001, 0xA4C02001,
                    0xCAFFFFFC, 0xE12FFF1E]


def fake_binary(placed):
    """Un binaire fabriqué : placed = [(position, nom, mode, mots ou demi-mots)]."""
    base = 0x00100000
    blob = bytearray(0x400)
    functions, names = [], {}
    for offset, name, mode, code in placed:
        if mode == 'thumb':
            struct.pack_into('<%dH' % len(code), blob, offset, *code)
        else:
            struct.pack_into('<%dI' % len(code), blob, offset, *code)
        functions.append((base + offset, 2 * len(code) if mode == 'thumb' else 4 * len(code), mode))
        names[base + offset] = ('function', name)
    binary = couverture.Binary.__new__(couverture.Binary)
    binary.name, binary.functions, binary.names = 'fabrique', functions, names
    binary.image = ghidra_direct.Image(bytes(blob), [(base, 0, len(blob), len(blob), 5)])
    return binary


def test():
    failures = []

    def check(condition, text):
        if not condition:
            failures.append(text)
            print('ECHEC  ' + text)

    check(crc16_arc(0, b'123456789') == 0xBB3D, 'CRC-16/ARC de « 123456789 »')
    try:
        name_pass.import_unicorn()
    except ImportError:
        print('unicorn manque : essais d\'exécution sautés')
        return failures
    oracles = build_oracles(1)
    binary = fake_binary([(0x000, 'strlen', 'arm', name_pass.ARM_STRLEN),
                          (0x040, 'strlen_alt_100040', 'thumb', THUMB_STRLEN),
                          (0x080, 'strlen', 'arm', ARM_STRLEN_OFF_BY_ONE),
                          (0x0c0, '__aeabi_memcpy', 'arm', name_pass.ARM_MEMCPY),
                          (0x100, 'strcmp', 'arm', ARM_SVC),
                          (0x140, 'not_an_oracle', 'arm', ARM_SVC),
                          (0x180, 'memcpy_words', 'arm', ARM_MEMCPY_WORDS),
                          (0x1c0, '__aeabi_memcpy', 'arm', ARM_MEMCPY_WORDS),
                          (0x200, 'memclr', 'arm', ARM_MEMCLR_WORDS),
                          (0x240, 'memclr_bytes', 'arm', ARM_MEMCLR_WORDS)])
    verdicts = {a: (v, d) for _, a, _, v, d in check_binary(binary, oracles)}
    check(verdicts.get(0x100000, ('',))[0] == 'OK', 'strlen ARM fabriqué : OK')
    check(verdicts.get(0x100040, ('',))[0] == 'OK', 'strlen Thumb fabriqué (nom _alt_) : OK')
    check(verdicts.get(0x100080, ('',))[0] == 'FAUX' and 'rend' in verdicts[0x100080][1], 'strlen qui compte un de trop : FAUX')
    check(verdicts.get(0x1000c0, ('',))[0] == 'FAUX' and 'rend' in verdicts[0x1000c0][1],
          'une copie qui rend dst, nommée __aeabi_memcpy (qui rend dst+n) : FAUX')
    check(verdicts.get(0x100100, ('',))[0] == 'NON TESTABLE', 'appel système : NON TESTABLE')
    check(0x100140 not in verdicts, 'nom sans oracle : ignoré')
    check(verdicts.get(0x100180, ('',))[0] == 'OK', 'copie par ldm/stm nommée memcpy_words : OK')
    check(verdicts.get(0x1001c0, ('',))[0] == 'FAUX' and 'non aligné' in verdicts[0x1001c0][1],
          'copie par ldm/stm nommée __aeabi_memcpy : FAUX (accès non aligné) %r' % (verdicts.get(0x1001c0),))
    check(verdicts.get(0x100200, ('',))[0] == 'OK', 'mise à zéro par stm nommée memclr : OK')
    check(verdicts.get(0x100240, ('',))[0] == 'FAUX' and 'non aligné' in verdicts[0x100240][1],
          'mise à zéro par stm nommée memclr_bytes : FAUX (accès non aligné) %r' % (verdicts.get(0x100240),))
    # Le vrai code, s'il est là : quelques routines de pm et de sm, déjà exécutées à la main lors de leur relecture.
    if all(os.path.isfile(os.path.join(couverture.ANALYSE, m, 'gh', 'funcs.tsv')) and
           os.path.isfile(os.path.join(couverture.ROOT, 'local', 'extrait', m, 'exefs', 'code.bin')) for m in ('pm', 'sm')):
        rows = run(['pm', 'sm'], rounds=1, only={'__aeabi_uidivmod', 'memcpy_words', 'strlen', 'strcmp', 'fill_words'})
        for b, a, n, verdict, detail in rows:
            check(verdict == 'OK', '%s %#x %s : %s %s' % (b, a, n, verdict, detail))
        check(len(rows) >= 8, 'pm et sm : au moins huit routines essayées (%d)' % len(rows))
    else:
        print('oracles : pas de local/analyse/pm ni sm, essais sur le vrai code sautés')
    print('%d échec(s)' % len(failures) if failures else 'oracles : tous les essais passent')
    return failures


def main():
    args = sys.argv[1:]
    if args[:1] == ['test']:
        sys.exit(1 if test() else 0)
    if not os.path.isdir(couverture.ANALYSE):
        sys.exit('Pas de local/analyse : rien à vérifier.')
    unknown = [a for a in args if a not in analysed()]
    if unknown:
        sys.exit('binaire inconnu : %s' % ', '.join(unknown))
    rows = run(args or None)
    report(rows)
    write(rows)


if __name__ == '__main__':
    main()
