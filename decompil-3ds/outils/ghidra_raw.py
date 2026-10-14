"""Analyse avec Ghidra lancé directement sous Ubuntu (WSL) un binaire qui n'est pas un module : une image brute ou un
ELF déjà construit. Le chemin pour boot9, boot11, kernel11, kernel9, Process9 et le chargeur ARM9.

    python ghidra_raw.py <cible> [--no-names] [--plan]
    python ghidra_raw.py --image <fichier> [--name <nom>] [--base 0x...] [--language v5t|v6]
                         [--code 0xDÉBUT-0xFIN,...] [--seeds graines.tsv] [--names noms.tsv] [--plan]
    python ghidra_raw.py list
    python ghidra_raw.py test

        <cible>       une cible préréglée de raw_targets.toml (boot9, boot11, kernel11, kernel9, process9, arm9loader) :
                      fichier, adresse, langage, plages de code, graines et noms y sont écrits, avec leurs raisons
        --image       sinon, le fichier à analyser : un ELF (reconnu à son en-tête), un code.bin avec son exheader.bin
                      à côté (enveloppé en ELF par elfer.py), ou une image brute, qu'il faut placer avec --base
        --language    v5t pour l'ARM9 (ARM946E-S), v6 pour l'ARM11 (le défaut)
        --code        les plages de code, fin exclue ; le reste de l'image est rendu non exécutable avant l'analyse
        --seeds       des graines à la main, « 0xADRESSE <TAB> arm|thumb » par ligne
        --names       le fichier de noms posé après l'analyse (sans lui, aucun nom)
        --no-names    n'applique pas le fichier de noms de la cible : pour voir ce que la recherche trouve seule
        --plan        n'appelle pas Ghidra : affiche seulement les graines, les candidats et les tables de switch

Il range dans local/analyse/<cible>/gh/ les mêmes fichiers que ghidra_direct.py (funcs.tsv, pseudo/, refs.tsv,
seeds.tsv, candidates.tsv, switches.tsv, ghidra.log, project/), plus l'assembleur : asm/0xADRESSE.s par fonction et
listing.txt pour tout le code (DumpListing.java).

Pourquoi ce chemin existe. ghidra_direct.py suppose un module : local/extrait/<module>/exefs/code.bin, un exheader qui
donne .text, .rodata et .data, le langage de l'ARM11. Les mémoires de démarrage, les deux noyaux et Process9 n'ont rien
de cela : une image nue à une adresse qu'il faut connaître, du code ARM9 (v5t), du code et des données mêlés, ou des
morceaux recopiés ailleurs par le démarrage. Trois chaînes avaient été écrites à part pour eux ; celle-ci les réunit
et reprend de ghidra_direct.py la recherche des pointeurs, des tables de distances et des aides de switch (Image,
find_pointers), le lancement de Ghidra (run_headless) et les quatre scripts de ghidra_scripts/.

Ce qu'on donne à Ghidra en plus, et pourquoi :

1. Où est le code. Une image brute arrive en un seul bloc exécutable. Sans plages de code, Ghidra invente des fonctions
   dans les données (1 255 fausses fonctions Thumb dans les zéros de kernel9), et la recherche des trous de
   RecoverFunctions.java irait jusque dans les clés de boot9. Les plages qui ne sont pas du code deviennent des blocs
   non exécutables AVANT l'analyse (MarkDataBlocks.java) ; les pointeurs, graines et candidats hors du code sont
   écartés ici.
2. Les entrées que rien ne désigne : les cibles des huit vecteurs d'exception (des « b » au début de boot9 et boot11),
   les tables lues à la main (la table des appels système de kernel11, sa table de constructeurs en distances), et
   des graines données une à une, chacune avec sa raison dans raw_targets.toml.
3. Les pointeurs trouvés dans l'image, comme pour un module : un mot impair qui tombe sur un « push {..., lr} » Thumb
   est une graine sûre, le reste est jugé après l'analyse. Pour boot9 et boot11, on ne les cherche que dans le code
   (réserves de littéraux) ; pour kernel11, tout en ARM, les mots impairs sont ignorés.

Ce qu'il ne fait pas. Il ne trouve pas seul les plages de code, l'adresse de chargement ni le langage : ils ont été
lus par quelqu'un (entropie, pointeurs, code de démarrage) et sont écrits dans raw_targets.toml, valables pour les
binaires de cette console. Il ne fabrique pas l'ELF de kernel11 ni ne découpe le FIRM : c'est firm.py. Il ne lit pas
les aiguillages ARM par table de saut (« ldrlo pc, [pc, r0, lsl #2] » des commandes de Process9) : leurs cas restent
dans une seule fonction, comme il se doit, et le lien commande -> code se lit à part. Enfin, comme ghidra_direct.py,
il ne garantit pas que toutes les fonctions sont trouvées.
"""
import os
import struct
import sys
import tomllib

import elfer
import ghidra_direct
import rea_bridge

ROOT = ghidra_direct.ROOT
TARGETS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raw_targets.toml')
LANGUAGES = {'v5t': 'ARM:LE:32:v5t', 'v6': 'ARM:LE:32:v6'}
FORMATS = ('raw', 'elf', 'code')
MAXMEM = '3G'
FLAGS = {'r': elfer.PF_R, 'w': elfer.PF_W, 'x': elfer.PF_X}
# Les lignes de détail des scripts, une par candidat ou par trou, qui se comptent par centaines pour Process9.
DETAIL_LINES = ('candidat écarté', 'fonction trouvée dans un trou', 'graine refusée', 'switch à ')


def parse_flags(text):
    """« rx » -> PF_R | PF_X."""
    flags = 0
    for letter in text:
        if letter not in FLAGS:
            raise ValueError('drapeau inconnu %r dans %r' % (letter, text))
        flags |= FLAGS[letter]
    return flags


def check_ranges(ranges, what):
    """[[début, fin], ...] -> [(début, fin)] triées, sans chevauchement."""
    checked = []
    for item in ranges:
        if len(item) != 2 or not 0 <= item[0] < item[1] <= 1 << 32:
            raise ValueError('%s : plage invalide %r' % (what, item))
        checked.append((item[0], item[1]))
    checked.sort()
    for (_, end), (start, _) in zip(checked, checked[1:]):
        if start < end:
            raise ValueError('%s : plages qui se chevauchent' % what)
    return checked


def check_target(name, spec):
    """Vérifie une cible de raw_targets.toml (ou faite des options de la ligne de commande) et la rend complétée."""
    known = {'input', 'made_by', 'format', 'base', 'language', 'code', 'pointer_sources', 'thumb_pointers',
             'relative_tables', 'vectors', 'seed_tables', 'seeds', 'names', 'firm'}
    unknown = set(spec) - known
    if unknown:
        raise ValueError('cible %s : clé(s) inconnue(s) %s' % (name, ', '.join(sorted(unknown))))
    what = 'cible ' + name
    if 'input' not in spec:
        raise ValueError(what + ' : pas de fichier (input)')
    target = {'name': name, 'input': os.path.join(ROOT, spec['input']), 'made_by': spec.get('made_by', ''),
              'format': spec.get('format', 'raw'), 'base': spec.get('base'),
              'language': LANGUAGES.get(spec.get('language', 'v6'), spec.get('language')),
              'code': check_ranges(spec['code'], what) if 'code' in spec else None,
              'pointer_sources': spec.get('pointer_sources', 'all'),
              'thumb_pointers': spec.get('thumb_pointers', True), 'relative_tables': spec.get('relative_tables', True),
              'vectors': spec.get('vectors', False), 'seed_tables': [], 'seeds': [],
              'names': os.path.join(ROOT, spec['names']) if spec.get('names') else None, 'firm': spec.get('firm')}
    if target['format'] not in FORMATS:
        raise ValueError('%s : format %r, attendu %s' % (what, target['format'], ', '.join(FORMATS)))
    if target['format'] == 'raw' and not isinstance(target['base'], int):
        raise ValueError(what + ' : une image brute a besoin de son adresse de chargement (base)')
    if target['language'] not in LANGUAGES.values():
        raise ValueError('%s : langage %r, attendu v5t ou v6' % (what, spec.get('language')))
    if target['pointer_sources'] not in ('all', 'code'):
        raise ValueError(what + ' : pointer_sources vaut « all » ou « code »')
    if target['vectors'] and target['format'] != 'raw':
        raise ValueError(what + ' : les vecteurs ne se lisent qu\'au début d\'une image brute')
    for table in spec.get('seed_tables', []):
        if table.get('kind') not in ('pointers', 'offsets') or not isinstance(table.get('at'), int) \
                or not isinstance(table.get('count'), int) or table['count'] <= 0:
            raise ValueError('%s : table de graines invalide %r' % (what, table))
        target['seed_tables'].append((table['at'], table['count'], table['kind']))
    for seed in spec.get('seeds', []):
        if seed.get('mode') not in ('arm', 'thumb') or not isinstance(seed.get('at'), int) or seed['at'] & 1:
            raise ValueError('%s : graine invalide %r' % (what, seed))
        if not seed.get('why'):
            raise ValueError('%s : la graine %#x n\'a pas de raison (why)' % (what, seed['at']))
        target['seeds'].append((seed['at'], seed['mode']))
    if target['firm'] is not None:
        target['firm'] = check_firm_layout(name, target['firm'])
    return target


def check_firm_layout(name, firm):
    """La carte d'un noyau ARM11 (kernel11.firm) : morceaux de la section et mémoire d'exécution."""
    what = 'cible %s, carte du FIRM' % name
    for key in ('load', 'entry', 'pieces'):
        if key not in firm:
            raise ValueError('%s : il manque %s' % (what, key))
    pieces = []
    for piece in firm['pieces']:
        pieces.append((piece['name'], piece['va'], piece['offset'], piece['size'], piece['memsize'],
                       parse_flags(piece['flags']), piece.get('pa')))
        if piece['memsize'] < piece['size']:
            raise ValueError('%s : %s plus petit en mémoire que dans le fichier' % (what, piece['name']))
    runtime = [(block['name'], block['va'], block['size'], parse_flags(block['flags']))
               for block in firm.get('runtime', [])]
    spans = sorted([(va, va + memsize, label) for label, va, _, _, memsize, _, _ in pieces]
                   + [(va, va + size, label) for label, va, size, _ in runtime])
    for (_, end, first), (start, _, second) in zip(spans, spans[1:]):
        if start < end:
            raise ValueError('%s : %s et %s se chevauchent' % (what, first, second))
    return dict(firm, pieces=pieces, runtime=runtime)


def load_targets(path=TARGETS_FILE):
    """{nom: cible} d'après raw_targets.toml."""
    with open(path, 'rb') as f:
        specs = tomllib.load(f)
    return {name: check_target(name, spec) for name, spec in specs.items()}


def read_seed_file(path):
    """« 0xADRESSE <TAB> arm|thumb » par ligne -> [(adresse, mode)]."""
    seeds = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            fields = line.rstrip('\n').split('\t')
            if fields[0].startswith('0x'):
                if len(fields) < 2 or fields[1] not in ('arm', 'thumb'):
                    raise ValueError('%s : ligne illisible %r' % (path, line))
                seeds.append((int(fields[0], 16), fields[1]))
    return seeds


def load_image(target):
    """Rend (Image, fichier à donner à Ghidra, adresse de base si image brute sinon None)."""
    path = target['input']
    if not os.path.isfile(path):
        sys.exit('Pas de %s.%s' % (path, ' Le fabriquer : ' + target['made_by'] if target['made_by'] else ''))
    with open(path, 'rb') as f:
        data = f.read()
    if target['format'] == 'code':
        exheader_path = os.path.join(os.path.dirname(path), 'exheader.bin')
        if not os.path.isfile(exheader_path):
            sys.exit('Pas de %s à côté de %s.' % (exheader_path, path))
        with open(exheader_path, 'rb') as f:
            exheader = f.read()
        segments = elfer.segments_depuis_exheader(exheader, len(data))
        if not segments:
            sys.exit('exheader illisible : pas de découpage en sections pour %s' % path)
        elf = os.path.splitext(path)[0] + '.elf'
        with open(elf, 'wb') as f:
            f.write(elfer.envelopper(data, exheader))
        image, imported, base = ghidra_direct.Image(data, segments, target['code']), elf, None
    elif target['format'] == 'elf':
        if data[:4] != b'\x7fELF':
            sys.exit('%s n\'est pas un ELF.' % path)
        image, imported, base = ghidra_direct.Image(data, elfer.lire_segments(data), target['code']), path, None
    else:
        segment = (target['base'], 0, len(data), len(data), elfer.PF_R | elfer.PF_W | elfer.PF_X)
        image, imported, base = ghidra_direct.Image(data, [segment], target['code']), path, target['base']
    loaded = image.loaded_ranges()
    for start, end in image.code_ranges:
        if not any(low <= start and end <= high for low, high in loaded):
            sys.exit('Plage de code %#x-%#x hors du fichier %s.' % (start, end, path))
    return image, imported, base


def subtract_ranges(ranges, removed):
    """Les plages de `ranges` privées de celles de `removed` (fin exclue partout)."""
    result = []
    for start, end in ranges:
        pieces = [(start, end)]
        for cut_start, cut_end in removed:
            pieces = [part for low, high in pieces
                      for part in ((low, min(high, cut_start)), (max(low, cut_end), high)) if part[0] < part[1]]
        result += pieces
    return result


def data_ranges(image, raw):
    """Ce qui serait exécutable dans Ghidra sans être du code : toute l'image brute, ou les segments exécutables d'un
    ELF, moins les plages de code."""
    executable = image.loaded_ranges() if raw else \
        [(base, base + size) for base, _, size, _, flags in image.segments if flags & elfer.PF_X and size]
    return subtract_ranges(executable, image.code_ranges)


def decode_branch(word, address):
    """La cible d'un « b » ARM sans condition, ou None."""
    if word is None or word >> 24 != 0xEA:
        return None
    offset = word & 0xFFFFFF
    if offset & 0x800000:
        offset -= 0x1000000
    return (address + 8 + offset * 4) & 0xFFFFFFFF


def vector_targets(image, base):
    """Les cibles des huit vecteurs d'exception, s'ils sont des « b » (un « b . » sur lui-même ne compte pas)."""
    seeds = {}
    for index in range(8):
        target = decode_branch(image.word(base + 4 * index), base + 4 * index)
        if target is not None and target != base + 4 * index:
            seeds[target] = 'arm'
    return seeds


def table_targets(image, at, count, kind):
    """Les entrées d'une table lue à la main : des adresses (« pointers ») ou des distances à la case (« offsets »),
    le bit 0 désignant le Thumb. Une case nulle est vide."""
    seeds = {}
    for slot in range(at, at + 4 * count, 4):
        word = image.word(slot)
        if not word:
            continue
        target = word if kind == 'pointers' else (slot + word) & 0xFFFFFFFF
        seeds[target & ~1] = 'thumb' if target & 1 else 'arm'
    return seeds


def make_plan(target, image, extra_seeds=()):
    """Rend (graines {adresse: mode}, aides de switch {adresse: réglage}, candidats, tables de switch)."""
    sources = image.code_ranges if target['pointer_sources'] == 'code' else None
    found, candidates = ghidra_direct.find_pointers(image, sources, target['thumb_pointers'],
                                                    target['relative_tables'])
    seeds = dict(found)
    forced = {}
    if target['vectors']:
        forced.update(vector_targets(image, target['base']))
    for at, count, kind in target['seed_tables']:
        forced.update(table_targets(image, at, count, kind))
    forced.update(target['seeds'])
    forced.update(extra_seeds)
    seeds.update(forced)
    candidates = [c for c in candidates if not (c[3] == '-' and c[0] in forced)]
    helpers, switches = {}, []
    for start, end in image.code_ranges:
        helpers.update(ghidra_direct.find_switch_helpers(image.read(start, end - start), start, end - start))
    for start, end in image.code_ranges:
        switches += ghidra_direct.find_switch_sites(image.read(start, end - start), start, end - start, helpers)
    # Une graine ou un candidat posé sur l'aide de switch en ferait une fonction ordinaire.
    seeds = {address: mode for address, mode in seeds.items() if address not in helpers}
    candidates = [c for c in candidates if c[0] not in helpers]
    outside = [address for address in seeds if not image.in_code(address)]
    if outside:
        raise ValueError('graine(s) hors des plages de code : %s' % ' '.join('%#x' % a for a in sorted(outside)))
    return seeds, helpers, candidates, switches


def analyse(target, use_names=True, plan_only=False, extra_seeds=()):
    image, imported, raw_base = load_image(target)
    seeds, helpers, candidates, switches = make_plan(target, image, extra_seeds)
    blocks = data_ranges(image, raw_base is not None)
    name = target['name']
    print('%s : %s, code en %d plage(s) : %s' % (name, os.path.relpath(target['input'], ROOT), len(image.code_ranges),
                                                ', '.join('%#x-%#x' % r for r in image.code_ranges)))
    print('Plages rendues non exécutables avant l\'analyse : %s'
          % (', '.join('%#x-%#x' % r for r in blocks) or 'aucune'))
    groups = {c[3] for c in candidates if c[3] != '-'}
    print('Graines posées avant l\'analyse : %d (%d en Thumb) ; candidats jugés après : %d pointeurs, %d cases de %d '
          'table(s) de distances' % (len(seeds), sum(1 for m in seeds.values() if m == 'thumb'),
                                     sum(1 for c in candidates if c[3] == '-'),
                                     sum(1 for c in candidates if c[3] != '-'), len(groups)))
    print('Aide(s) de switch : %s ; %d table(s) de switch'
          % (', '.join('%#x (%s)' % item for item in sorted(helpers.items())) or 'aucune', len(switches)))
    if plan_only:
        return None
    out = os.path.join(ROOT, 'local', 'analyse', name, 'gh')
    os.makedirs(out, exist_ok=True)
    ghidra_direct.write_lines(os.path.join(out, 'seeds.tsv'),
                              ['%#x\t%s\t' % item for item in sorted(seeds.items())]
                              + ['%#x\tarm\t%s' % item for item in sorted(helpers.items())])
    ghidra_direct.write_lines(os.path.join(out, 'candidates.tsv'), ['%#x\t%s\t%s\t%s' % c for c in candidates])
    ghidra_direct.write_lines(os.path.join(out, 'switches.tsv'),
                              ['%#x\t%d\t%s' % (site, count, '\t'.join('%#x' % t for t in targets))
                               for site, count, targets in switches])
    wsl = rea_bridge.to_wsl_path
    pre_scripts = []
    if blocks:
        pre_scripts.append(('MarkDataBlocks.java', ','.join('%#x-%#x' % r for r in blocks)))
    pre_scripts.append(('SeedFunctions.java', wsl(os.path.join(out, 'seeds.tsv'))))
    post_scripts = [('RecoverFunctions.java', wsl(os.path.join(out, 'switches.tsv')),
                     wsl(os.path.join(out, 'candidates.tsv')))]
    if use_names and target['names']:
        if os.path.isfile(target['names']):
            post_scripts.append(('ApplyNames.java', wsl(target['names'])))
        else:
            print('Pas de fichier de noms %s : analyse sans noms.' % target['names'])
    post_scripts += [('DumpFunctions.java', wsl(out)), ('DumpListing.java', wsl(out))]
    print('Ghidra tourne sous Ubuntu (une à cinq minutes)...', flush=True)
    log = ghidra_direct.run_headless(out, name, imported, target['language'], pre_scripts, post_scripts,
                                     raw_base=raw_base, maxmem=MAXMEM)
    ghidra_direct.print_report(log, DETAIL_LINES)
    listing = os.path.join(out, 'funcs.tsv')
    if not os.path.isfile(listing):
        sys.exit('Ghidra n\'a pas rendu de liste de fonctions : lire %s' % os.path.join(out, 'ghidra.log'))
    functions = ghidra_direct.read_functions(listing)
    thumb = sum(1 for _, _, mode, _ in functions if mode == 'thumb')
    print('%s : %d fonctions, dont %d en Thumb et %d en ARM' % (name, len(functions), thumb, len(functions) - thumb))
    print('-> %s' % out)
    return {'functions': functions, 'log': log}


def target_from_options(options):
    """Une cible faite des options --image, --base, --language, --code, --names."""
    image = options['image']
    with open(image, 'rb') as f:
        magic = f.read(4)
    if magic == b'\x7fELF':
        fmt = 'elf'
    elif os.path.isfile(os.path.join(os.path.dirname(os.path.abspath(image)), 'exheader.bin')) and 'base' not in options:
        fmt = 'code'
    else:
        fmt = 'raw'
    spec = {'input': os.path.relpath(os.path.abspath(image), ROOT), 'format': fmt,
            'language': options.get('language', 'v6')}
    if 'base' in options:
        spec['base'] = int(options['base'], 0)
    if 'code' in options:
        spec['code'] = [[int(bound, 0) for bound in item.split('-')] for item in options['code'].split(',')]
    if 'names' in options:
        spec['names'] = os.path.relpath(os.path.abspath(options['names']), ROOT)
    name = options.get('name') or os.path.splitext(os.path.basename(image))[0]
    return check_target(name, spec)


def test():
    """Sans dump : la lecture de raw_targets.toml, et le plan d'une fausse image brute fabriquée ici (vecteurs, table
    de pointeurs, pointeur Thumb, plage de données). Ne lance pas Ghidra."""
    targets = load_targets()
    assert {'boot9', 'boot11', 'kernel11', 'kernel9', 'process9'} <= set(targets)
    for target in targets.values():
        assert target['language'] in LANGUAGES.values()
        if target['names']:
            assert os.path.isfile(target['names']), target['names']
        for at, mode in target['seeds']:
            assert target['code'] is None or any(s <= at < e for s, e in target['code']), (target['name'], hex(at))
    assert targets['boot9']['code'][0] == (0xFFFF0000, 0xFFFF5D40) and targets['boot9']['pointer_sources'] == 'code'
    pieces = targets['kernel11']['firm']['pieces']
    assert [p[0] for p in pieces][:2] == ['text_low', 'text_high'] and pieces[0][5] == elfer.PF_R | elfer.PF_X
    for bad in ({'input': 'x', 'format': 'raw'}, {'input': 'x', 'base': 0, 'code': [[8, 4]]},
                {'input': 'x', 'base': 0, 'seeds': [{'at': 4, 'mode': 'arm'}]}, {'input': 'x', 'base': 0, 'oops': 1},
                {'input': 'x', 'base': 0, 'code': [[0, 8], [4, 12]]}):
        try:
            check_target('essai', bad)
        except ValueError:
            continue
        raise AssertionError('cible invalide acceptée : %r' % bad)

    # Une image brute à 0x10000 : code de 0x10000 à 0x10100, données ensuite.
    base = 0x10000
    raw = bytearray(0x200)
    struct.pack_into('<I', raw, 0x00, 0xEA000000 | ((0x40 - 8) >> 2))          # vecteur 0 : b 0x10040
    struct.pack_into('<I', raw, 0x04, 0xEAFFFFFE)                               # vecteur 1 : b . (ignoré)
    struct.pack_into('<II', raw, 0x40, 0xE3A00000, 0xE12FFF1E)                  # ARM : mov r0, #0 ; bx lr
    struct.pack_into('<HH', raw, 0x50, 0xB510, 0xBD10)                          # Thumb : push {r4, lr} ; pop {r4, pc}
    struct.pack_into('<II', raw, 0x60, 0xE92D4010, 0xE8BD8010)                  # ARM : push ; pop
    struct.pack_into('<I', raw, 0xF0, base + 0x51)                              # littéral : pointeur Thumb
    struct.pack_into('<I', raw, 0xF4, base + 0x60)                              # littéral : pointeur ARM
    struct.pack_into('<II', raw, 0x180, base + 0x41, base + 0x60)               # dans les données : jamais lus
    struct.pack_into('<II', raw, 0x1C0, base + 0x60, 0)                         # table de pointeurs (case vide)
    spec = {'input': 'x', 'base': base, 'code': [[base, base + 0x100]], 'pointer_sources': 'code', 'vectors': True,
            'relative_tables': False, 'seed_tables': [{'at': base + 0x1C0, 'count': 2, 'kind': 'pointers'}],
            'seeds': [{'at': base + 0x80, 'mode': 'arm', 'why': 'essai'}]}
    target = check_target('essai', spec)
    image = ghidra_direct.Image(bytes(raw), [(base, 0, len(raw), len(raw), 7)], target['code'])
    seeds, helpers, candidates, switches = make_plan(target, image)
    assert seeds == {base + 0x40: 'arm', base + 0x50: 'thumb', base + 0x60: 'arm', base + 0x80: 'arm'}, seeds
    assert candidates == [] and helpers == {} and switches == []                # le pointeur ARM est devenu graine
    assert data_ranges(image, True) == [(base + 0x100, base + 0x200)]
    assert subtract_ranges([(0, 100)], [(10, 20), (50, 100)]) == [(0, 10), (20, 50)]
    target = check_target('essai', dict(spec, pointer_sources='all', seed_tables=[], seeds=[]))
    _, _, candidates, _ = make_plan(target, image)
    assert [c[0] for c in candidates] == [base + 0x60]                          # lu aussi dans les données
    assert vector_targets(image, base) == {base + 0x40: 'arm'}
    print('ghidra_raw : %d cibles lues dans raw_targets.toml, cibles invalides refusées, vecteurs, table de pointeurs, '
          'graines, candidats et plages de données d\'une fausse image calculés.' % len(targets))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    use_names = '--no-names' not in args
    plan_only = '--plan' in args
    options, positional, index = {}, [], 0
    while index < len(args):
        arg = args[index]
        if arg in ('--no-names', '--plan'):
            index += 1
        elif arg.startswith('--') and index + 1 < len(args):
            options[arg[2:]] = args[index + 1]
            index += 2
        else:
            positional.append(arg)
            index += 1
    unknown = set(options) - {'image', 'name', 'base', 'language', 'code', 'seeds', 'names'}
    if unknown:
        sys.exit('Option(s) inconnue(s) : %s' % ', '.join('--' + o for o in sorted(unknown)))
    extra = read_seed_file(options['seeds']) if 'seeds' in options else []
    if positional == ['test']:
        test()
    elif positional == ['list']:
        for name, target in load_targets().items():
            present = 'présent' if os.path.isfile(target['input']) else 'absent : ' + target['made_by']
            language = target['language'].rsplit(':', 1)[1]
            print('%-11s %-5s %-4s %s (%s)' % (name, target['format'], language,
                                              os.path.relpath(target['input'], ROOT), present))
    elif 'image' in options and not positional:
        analyse(target_from_options(options), use_names, plan_only, extra)
    elif len(positional) == 1:
        targets = load_targets()
        if positional[0] not in targets:
            sys.exit('Cible inconnue %s ; cibles de raw_targets.toml : %s' % (positional[0], ', '.join(targets)))
        target = dict(targets[positional[0]])
        # Une cible préréglée, modifiée pour un essai : --code, --names, et --name pour ne pas écraser son dossier.
        if 'image' in options or 'base' in options or 'language' in options:
            sys.exit('--image, --base et --language ne se combinent pas avec une cible préréglée.')
        if 'code' in options:
            target['code'] = check_ranges([[int(bound, 0) for bound in item.split('-')]
                                           for item in options['code'].split(',')], 'option --code')
        if 'names' in options:
            target['names'] = os.path.abspath(options['names'])
        target['name'] = options.get('name', target['name'])
        analyse(target, use_names, plan_only, extra)
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
