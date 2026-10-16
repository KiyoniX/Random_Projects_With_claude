"""Tests du moteur de mods : python mods/tests.py

Deux familles, comme pour les autres outils du dépôt :
- des données fabriquées, versionnées, qui tournent toujours ;
- les vrais fichiers du dump de l'utilisateur (local/extrait/), aller-retour octet pour octet sur toutes les entrées,
  qui se sautent proprement si le dump est absent.
"""
import io
import os
import struct
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from modkit import ips, manifest, romfs3, tomlio, LOCAL                       # noqa: E402
from modkit.formats import eggmoves, evolution, learnset, moves, personal, text  # noqa: E402
from modkit.overlay import OverlayRomfs                                        # noqa: E402
from modkit.workspace import BuildError, Workspace, TABLES                     # noqa: E402
import garc                                                                    # noqa: E402
import texte                                                                   # noqa: E402

SKIPPED = []
REAL_BASE = os.path.join(LOCAL, 'extrait', 'romfs')
REAL_UPDATE = os.path.join(LOCAL, 'extrait', 'maj', 'romfs')
BIG = 64 << 20          # au-dessus, un GARC n'est pas relu par défaut (MODS_TESTS_GROS=1 pour tout relire)


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def raises(exception, function, *args):
    try:
        function(*args)
    except exception:
        return
    raise AssertionError('%s aurait dû lever %s' % (function.__name__, exception.__name__))


# --- données fabriquées ---

def fake_personal_entry(seed):
    e = personal.read_entry(bytes(range(seed, seed + 64)))
    return e


def test_personal():
    for seed in (0, 7, 100, 190):
        raw = bytes((seed + i * 3) & 0xFF for i in range(64))
        check(personal.write_entry(personal.read_entry(raw)) == raw, 'personal : aller-retour de l\'entrée %d' % seed)
    entry = personal.read_entry(bytes(64))
    entry['hp'] = 300
    raises(ValueError, personal.write_entry, entry)
    entry['hp'] = 45
    entry['tm_learnable'] = [0, 5, 127]
    check(personal.read_entry(personal.write_entry(entry))['tm_learnable'] == [0, 5, 127], 'personal : CT')
    singles = [bytes(64), bytes([45] * 64), bytes([7] * 64)]
    table = [[s] for s in singles] + [[b''.join(singles)]]
    check(personal.write_table(personal.read_table(table)) == table, 'personal : table entière recalculée')
    table[-1] = [b''.join(singles[::-1])]
    raises(ValueError, personal.read_table, table)


def test_small_formats():
    for pairs in ([], [(1, 33), (3, 45)]):
        check(learnset.read_entry(learnset.write_entry(pairs)) == pairs, 'learnset')
    raw = struct.pack('<4H', 33, 1, 0xFFFF, 0xFFFF)
    check(learnset.write_entry(learnset.read_entry(raw)) == raw, 'learnset : octets')
    raises(ValueError, learnset.read_entry, b'\x01\x00\x01\x00')
    evo = [{'method': 4, 'param': 16, 'species': 2, 'level': 0}]
    check(evolution.read_entry(evolution.write_entry(evo)) == evo, 'evolution')
    raises(ValueError, evolution.write_entry, evo * 7)
    check(eggmoves.write_entry(eggmoves.read_entry(b'')) == b'', 'eggmoves : fichier vide')
    check(eggmoves.write_entry(eggmoves.read_entry(b'\0\0')) == b'\0\0', 'eggmoves : zéro attaque')
    check(eggmoves.read_entry(struct.pack('<3H', 2, 10, 20)) == [10, 20], 'eggmoves : lecture')
    raw = bytes([0, 0, 1, 40, 100, 35, 0, 0]) + bytes(range(28))
    check(moves.write_entry(moves.read_entry(raw)) == raw, 'moves')
    raw = bytes([0, 0, 1, 40, 100, 35, 0xFF, 0]) + bytes(28)
    check(moves.read_entry(raw)['priority'] == -1, 'moves : priorité signée')


def test_text():
    f = text.TextFile.from_lines(['Un', 'Deux[VAR TRNAME]\\nsuite', ''])
    f.lines[1].flags = 4
    f.lines[0].words += [0x41, 0]          # une queue après le terminateur
    data = text.write(f)
    back = text.read(data)
    check(text.write(back) == data, 'texte : aller-retour')
    check(back.strings() == ['Un', 'Deux[VAR TRNAME]\\nsuite', ''], 'texte : lignes')
    check(back.lines[1].flags == 4 and len(back.lines[0].words) == 5, 'texte : drapeaux et queue gardés')
    check(len(data) % 4 == 0, 'texte : taille multiple de 4')
    back.lines[2].set_text('Neuf')
    check(text.read(text.write(back)).strings()[2] == 'Neuf', 'texte : ligne modifiée')


def test_romfs3_fabricated():
    tree = romfs3.Tree()
    contents = {}
    for path, size in (('a/0/0', 100), ('a/0/1', 0), ('a/1/0', 17), ('b', 4096), ('shaders/x.shbin', 33)):
        i = tree.add_file(path, size)
        contents[path] = bytes([i + 1]) * size
    tables, positions, end = tree.build()
    image = bytearray(end)
    image[:len(tables)] = tables
    for i, pos in positions:
        image[pos:pos + tree.files[i].size] = contents[tree.path_of_file(i)]
    back = romfs3.parse(lambda p, n: bytes(image[p:p + n]))
    check(sorted(back.all_paths()) == sorted(contents), 'romfs3 : chemins relus')
    check(back.build()[0] == tables, 'romfs3 : tables identiques après relecture')
    check(tree.find_file('a/1/0') is not None and tree.find_file('a/2/0') is None, 'romfs3 : recherche')
    check([romfs3.hash_table_size(n) for n in (0, 1, 2, 5, 18, 19, 20, 653)] == [3, 3, 3, 5, 19, 19, 23, 653],
          'romfs3 : taille des tables de hachage')
    return tree, bytes(image), contents


class FakeBase:
    """Un romfs de niveau 3 fabriqué en mémoire, avec l'interface de banc/romfs.NcchRomfs."""

    def __init__(self, image):
        self.image = image
        self.size = len(image)

    def read(self, position, size):
        return self.image[position:position + size]


def test_overlay():
    tree, image, contents = test_romfs3_fabricated()
    base = FakeBase(image)
    with tempfile.TemporaryDirectory() as tmp:
        mine = os.path.join(tmp, 'mine.bin')
        extra = os.path.join(tmp, 'extra.bin')
        open(mine, 'wb').write(b'\xAA' * 300)
        open(extra, 'wb').write(b'\xBB' * 10)
        over = OverlayRomfs(base, {'a/0/0': mine, 'c/new': extra})
        check(over.replaced == ['a/0/0'] and over.added == ['c/new'], 'overlay : remplacés et ajoutés')
        reparsed = romfs3.parse(over.read)
        check(sorted(reparsed.all_paths()) == sorted(list(contents) + ['c/new']), 'overlay : le jeu relit un arbre cohérent')
        served = {}
        for i, f in enumerate(reparsed.files):
            served[reparsed.path_of_file(i)] = over.read(f.source[0], f.size)
        check(served['a/0/0'] == b'\xAA' * 300 and served['c/new'] == b'\xBB' * 10, 'overlay : octets des mods')
        for path in ('a/1/0', 'b', 'shaders/x.shbin'):
            check(served[path] == contents[path], 'overlay : %s inchangé' % path)
        whole = over.read(0, over.size)
        check(len(whole) == over.size and over.read(over.size, 10) == b'', 'overlay : lecture entière et au-delà')
        pos = reparsed.files[reparsed.find_file('a/0/0')].source[0]
        note = over.describe(pos + 5, b'\xAA' * 4)
        check('FICHIER DE MOD a/0/0+0x5' in note and 'DIFFÉRENT' in note and 'servi aa aa' in note, 'overlay : description pour le journal')
        over.close()


def test_ips():
    patches = [(0x100010, b'\x01\x02'), (0x100000, b'\xFF')]
    data = ips.build(patches)
    check(data.startswith(b'PATCH') and data.endswith(b'EOF'), 'ips : encadrement')
    check(ips.parse(data) == sorted(patches), 'ips : aller-retour')
    raises(ValueError, ips.build, [(0x0FFFFF, b'\0')])
    raises(ValueError, ips.build, [(0x100000, b'\0\0'), (0x100001, b'\0')])
    raises(ValueError, ips.build, [(0x100000 + 0x454F46, b'\0')])


def test_toml_and_manifest():
    data = {'a': 1, 'b': 'x"y\n', 'c': [1, 2], 'sub': {'k': True, '12': {'z': 'ü'}}}
    check(tomlio.loads(tomlio.dumps(data)) == data, 'toml : aller-retour')
    check(manifest.satisfies('1.2.3', '>=1.2') and not manifest.satisfies('1.1', '>=1.2') and manifest.satisfies('1', '*'),
          'versions')
    check(manifest.satisfies('2.0', '<3') and not manifest.satisfies('2.0', '==2.1'), 'versions : opérateurs')

    def mod(i, **extra):
        meta = {'mod': {'id': i, 'name': i, 'version': '1.0', 'author': 'x', 'game': 'pokemon-x-eu'}}
        meta.update(extra)
        return manifest.Mod('/tmp/' + i, meta)
    a, b, c = mod('a'), mod('b', dependencies={'a': '>=1'}), mod('c', order={'after': ['b']})
    check([m.id for m in manifest.resolve([c, b, a])] == ['a', 'b', 'c'], 'pile : ordre imposé par les dépendances')
    check([m.id for m in manifest.resolve([a, c, b])] == ['a', 'b', 'c'], 'pile : after')
    check([m.id for m in manifest.resolve([c, a])] == ['c', 'a'], 'pile : ordre demandé gardé sans contrainte')
    raises(manifest.ModError, manifest.resolve, [b])
    raises(manifest.ModError, manifest.resolve, [a, a])
    raises(manifest.ModError, manifest.resolve, [mod('d', conflicts={'a': '*'}), a])
    raises(manifest.ModError, manifest.resolve, [mod('e', dependencies={'a': '>=2'}), a])
    raises(manifest.ModError, manifest.resolve, [mod('x', dependencies={'y': '*'}), mod('y', dependencies={'x': '*'})])
    other = manifest.Mod('/tmp/z', {'mod': {'id': 'z', 'name': 'z', 'version': '1', 'author': 'x', 'game': 'autre'}})
    raises(manifest.ModError, manifest.resolve, [other])


class MemoryGame:
    """Un « jeu » fabriqué : chemin -> octets, avec l'interface de gamefiles.GameFiles."""

    def __init__(self, files):
        self.files = files

    def exists(self, path):
        return path in self.files

    def read(self, path):
        return self.files[path]

    def paths(self):
        return sorted(self.files)


def fake_game():
    singles = [bytes(64)] + [bytes([10 * i] * 6 + [0] * 58) for i in (1, 2, 3)]
    files = {'a/2/1/8': garc.ecrire([[s] for s in singles] + [[b''.join(singles)]])}
    files['a/2/1/4'] = garc.ecrire([[learnset.write_entry([])]] + [[learnset.write_entry([(1, 33)])]] * 3)
    names = ['Oeuf', 'Alpha', 'Beta', 'Gamma']
    moves_names = ['-', 'Charge', 'Flamme']
    langs = {}
    for lang_index in range(8):
        entries = [[b'']] * 14                         # des numéros qui ne sont pas du texte
        entries[0] = [b'']
        entries += [[text.write(text.TextFile.from_lines(moves_names))]]       # 14
        entries += [[b'']] * 65
        entries += [[text.write(text.TextFile.from_lines(names))]]             # 80
        files['a/0/7/%d' % (2 + lang_index)] = garc.ecrire(entries)
    return MemoryGame(files)


def make_mod(root, mod_id, **files):
    folder = os.path.join(root, mod_id)
    os.makedirs(folder)
    with open(os.path.join(folder, 'mod.toml'), 'w', encoding='utf-8') as f:
        f.write('[mod]\nid = "%s"\nname = "%s"\nversion = "1.0"\nauthor = "t"\ngame = "pokemon-x-eu"\n' % (mod_id, mod_id))
    for name, content in files.items():
        target = os.path.join(folder, *name.split('/'))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as f:
            f.write(content if isinstance(content, bytes) else content.encode('utf-8'))
    return manifest.load(folder)


def test_workspace():
    from modkit.apply import apply_mod
    game = fake_game()
    with tempfile.TemporaryDirectory() as tmp:
        one = make_mod(tmp, 'un', **{
            'personal.toml': '[species.Beta]\nhp = 99\ntype1 = "fire"\ntm_add = [3]\n',
            'learnset.toml': '[species.1]\nadd = [[5, "Flamme"]]\n',
            'text.toml': '[species_names.fr]\n1 = "Premier"\n[species_names.all]\n2 = "Second"\n',
            'files/z/nouveau.bin': b'\x01\x02\x03'})
        ws = Workspace(game)
        apply_mod(ws, one)
        out = ws.result()
        check(sorted(out) == ['a/0/7/%d' % i for i in range(2, 10)] + ['a/2/1/4', 'a/2/1/8', 'z/nouveau.bin'],
              'établi : fichiers produits %s' % sorted(out))
        table = personal.read_table(garc.lire(out['a/2/1/8'])[1])
        check(table[2]['hp'] == 99 and table[2]['type1'] == 9 and table[2]['tm_learnable'] == [3], 'établi : personal')
        check(table[1]['hp'] == 10 and table[3]['hp'] == 30, 'établi : les autres espèces intactes')
        check(learnset.read_entry(garc.lire(out['a/2/1/4'])[1][1][0]) == [(1, 33), (5, 2)], 'établi : attaques apprises')
        fr = text.read(garc.lire(out['a/0/7/5'])[1][80][0]).strings()
        en = text.read(garc.lire(out['a/0/7/4'])[1][80][0]).strings()
        check(fr == ['Oeuf', 'Premier', 'Second', 'Gamma'] and en == ['Oeuf', 'Alpha', 'Second', 'Gamma'], 'établi : textes')
        check(not ws.conflicts, 'établi : pas de conflit seul')

        two = make_mod(tmp, 'deux', **{'personal.toml': '[species.2]\nhp = 50\nattack = 7\n',
                                       'garc/a/2/1/8/0002.bin': b'\0' * 64})
        three = make_mod(tmp, 'trois', **{'personal.toml': '[species.2]\nhp = 99\n',
                                          'text.toml': '[species_names.fr]\n1 = "Premier"\n'})
        ws = Workspace(game)
        for m in (one, two, three):
            apply_mod(ws, m)
        text_conflicts = [c for c in ws.conflicts if 'a/0/7' in c]
        check(not text_conflicts, 'conflits : même valeur, pas de conflit')
        check(any('un' in c and 'deux' in c and 'a/2/1/8/2/hp' in c for c in ws.conflicts), 'conflits : champ différent')
        check(any('a/2/1/8/2' in c and 'trois' in c for c in ws.conflicts), 'conflits : entrée remplacée puis éditée')
        table = personal.read_table(garc.lire(ws.result()['a/2/1/8'])[1])
        check(table[2]['hp'] == 99, 'conflits : le dernier chargé l\'emporte')

        bad = make_mod(tmp, 'mauvais', **{'personal.toml': '[species.Beta]\nhp = 999\n'})
        raises(BuildError, apply_mod, Workspace(game), bad)
        unknown = make_mod(tmp, 'inconnu', **{'personal.toml': '[species.Nulle-part]\nhp = 9\n'})
        raises(BuildError, apply_mod, Workspace(game), unknown)
        field = make_mod(tmp, 'champ', **{'personal.toml': '[species.1]\nhpp = 9\n'})
        raises(BuildError, apply_mod, Workspace(game), field)
        line = make_mod(tmp, 'ligne', **{'text.toml': '[species_names.fr]\n999 = "x"\n'})
        raises(BuildError, apply_mod, Workspace(game), line)
        same = make_mod(tmp, 'identique', **{'personal.toml': '[species.1]\nhp = 10\n'})
        ws = Workspace(game)
        apply_mod(ws, same)
        check(ws.result() == {}, 'établi : un mod sans effet ne produit aucun fichier')


def test_builder_outputs():
    from modkit import builder
    game = fake_game()
    with tempfile.TemporaryDirectory() as tmp:
        m = make_mod(tmp, 'sortie', **{'personal.toml': '[species.1]\nhp = 11\n',
                                       'code.toml': '[[patch]]\naddress = 0x100020\nhex = "0102"\n',
                                       'files/x/y': b'abc'})
        report, _ = builder.make([m.path], game)
        out = os.path.join(tmp, 'out')
        console = builder.write_console(report, out)
        title = os.path.join(console, 'luma', 'titles', '0004000000055D00')
        check(os.path.isfile(os.path.join(title, 'romfs', 'a', '2', '1', '8')), 'console : romfs/a/2/1/8')
        check(open(os.path.join(title, 'romfs', 'x', 'y'), 'rb').read() == b'abc', 'console : fichier du mod')
        check(ips.parse(open(os.path.join(title, 'code.ips'), 'rb').read()) == [(0x100020, b'\x01\x02')], 'console : code.ips')
        pc = builder.write_pc(report, out)
        check(os.path.isfile(os.path.join(pc, 'overlay.json')) and os.path.isfile(os.path.join(pc, 'romfs', 'x', 'y')),
              'pc : overlay.json et romfs/')
        check(report.new_files == ['x/y'], 'rapport : fichiers nouveaux')


# --- le vrai dump (sauté s'il est absent) ---

def real_available():
    return os.path.isdir(REAL_BASE) and os.path.isdir(os.path.join(REAL_UPDATE, 'a'))


def real_files(roots=(REAL_BASE, REAL_UPDATE)):
    for root in roots:
        for folder, _, names in os.walk(os.path.join(root, 'a')):
            for name in sorted(names):
                yield os.path.join(folder, name)


def test_real_garc_and_formats():
    if not real_available():
        SKIPPED.append('dump du romfs (local/extrait/)')
        return
    everything = os.environ.get('MODS_TESTS_GROS') == '1'
    counts = {'garc': 0, 'trop gros': 0, 'texte': 0, 'personal': 0, 'learnset': 0, 'evolution': 0, 'eggmoves': 0,
              'moves': 0}
    for full in real_files():
        rel = os.path.relpath(full, os.path.join(LOCAL, 'extrait')).replace(os.sep, '/')
        if os.path.getsize(full) > BIG and not everything:
            counts['trop gros'] += 1
            continue
        with open(full, 'rb') as f:
            raw = f.read()
        try:
            version, entries = garc.lire(raw)
        except ValueError:
            continue
        check(garc.ecrire(entries, version, vecteurs=garc.lire_vecteurs(raw)) == raw, 'GARC : aller-retour de %s' % rel)
        counts['garc'] += 1
        key = rel.split('/a/', 1)[-1]
        if key.startswith('0/7/') or key.startswith('0/8/'):
            for n, e in enumerate(entries):
                try:
                    tf = text.read(e[0])
                except (ValueError, struct.error):
                    continue
                check(text.write(tf) == e[0], 'texte : aller-retour de %s numéro %d' % (rel, n))
                counts['texte'] += 1
    for name, path, module in (('learnset', 'a/2/1/4', learnset), ('evolution', 'a/2/1/5', evolution),
                               ('eggmoves', 'a/2/1/3', eggmoves), ('moves', 'a/2/1/2', moves)):
        entries = garc.lire(open(os.path.join(REAL_BASE, *path.split('/')), 'rb').read())[1]
        for n, e in enumerate(entries):
            if name == 'moves' and not e[0]:
                continue
            check(module.write_entry(module.read_entry(e[0])) == e[0], '%s : aller-retour numéro %d' % (name, n))
            counts[name] += 1
    entries = garc.lire(open(os.path.join(REAL_BASE, 'a', '2', '1', '8'), 'rb').read())[1]
    table = personal.read_table(entries)
    check(personal.write_table(table) == entries, 'personal : table entière')
    counts['personal'] = len(table)
    check((table[1]['hp'], table[1]['attack'], table[1]['type1'], table[1]['type2']) == (45, 49, 11, 3),
          'personal : Bulbizarre (45/49, Plante/Poison)')
    names = text.read(garc.lire(open(os.path.join(REAL_UPDATE, 'a', '0', '7', '5'), 'rb').read())[1][80][0]).strings()
    check(names[1] == 'Bulbizarre' and names[25] == 'Pikachu', 'texte : noms français des espèces')
    print('  dump réel : %s' % ', '.join('%d %s' % (v, k) for k, v in counts.items()))


def test_real_romfs3():
    banc = os.path.join(os.path.dirname(HERE), 'banc')
    cxi = [os.path.join(LOCAL, 'dump', n) for n in ('pokemon-x.cxi', 'pokemon-x_maj.cxi')]
    if not all(os.path.isfile(c) for c in cxi):
        SKIPPED.append('romfs niveau 3 des .cxi (local/dump/)')
        return
    sys.path.insert(0, banc)
    from romfs import NcchRomfs
    for path in cxi:
        r = NcchRomfs(path)
        tree = romfs3.parse(r.read)
        tables, positions, end = tree.build()
        data_start = struct.unpack_from('<I', r.read(0, 0x28), 36)[0]
        check(tables == r.read(0, data_start), 'romfs3 : tables identiques à l\'original (%s)' % os.path.basename(path))
        check(all(tree.files[i].source[0] == p for i, p in positions) and end == r.size,
              'romfs3 : positions et taille identiques (%s)' % os.path.basename(path))
        print('  %s : %d dossiers, %d fichiers, tables identiques octet pour octet' % (os.path.basename(path),
                                                                                      len(tree.dirs), len(tree.files)))
    # une surcouche sur le vrai jeu : un fichier remplacé, un ajouté, le reste servi comme avant
    base = NcchRomfs(cxi[0])
    with tempfile.TemporaryDirectory() as tmp:
        small = os.path.join(tmp, 'a')
        open(small, 'wb').write(b'\x55' * 1000)
        over = OverlayRomfs(base, {'a/0/1/0': small, 'zz/nouveau': small})
        tree = romfs3.parse(over.read)
        i = tree.find_file('a/0/1/0')
        check(over.read(tree.files[i].source[0], 1000) == b'\x55' * 1000, 'surcouche réelle : octets du mod')
        orig = romfs3.parse(base.read)
        j = orig.find_file('a/0/1/1')
        k = tree.find_file('a/0/1/1')
        check(over.read(tree.files[k].source[0], tree.files[k].size) == base.read(orig.files[j].source[0],
                                                                                   orig.files[j].size),
              'surcouche réelle : un fichier voisin intact')
        over.close()


def test_real_example():
    if not real_available():
        SKIPPED.append('mod d\'exemple sur le vrai jeu')
        return
    from modkit import builder
    example = os.path.join(HERE, 'exemples', 'marisson-muscle')
    report, _ = builder.make([example])
    check(sorted(report.files) == ['a/0/7/4', 'a/0/7/5', 'a/2/1/4', 'a/2/1/8'], 'exemple : fichiers produits')
    entries = garc.lire(report.files['a/2/1/8'])[1]
    table = personal.read_table(entries)
    check((table[650]['hp'], table[650]['attack'], table[650]['defense']) == (80, 95, 70), 'exemple : statistiques')
    original = personal.read_table(garc.lire(open(os.path.join(REAL_BASE, 'a', '2', '1', '8'), 'rb').read())[1])
    for i, (a, b) in enumerate(zip(table, original)):
        if i != 650:
            check(a == b, 'exemple : l\'espèce %d est restée intacte' % i)
    check(text.read(garc.lire(report.files['a/0/7/5'])[1][80][0]).strings()[650] == 'Marissonne', 'exemple : nom français')
    moves_out = learnset.read_entry(garc.lire(report.files['a/2/1/4'])[1][650][0])
    check((1, 52) in moves_out, 'exemple : Flamme au niveau 1')
    print('  exemple marisson-muscle : Marisson %s -> %s' % ((original[650]['hp'], original[650]['attack'],
                                                            original[650]['defense']), (80, 95, 70)))


def test_real_export_identity():
    """Exporter les cinq tables en TOML puis les réappliquer comme un mod ne doit rien changer au jeu."""
    if not real_available():
        SKIPPED.append('export puis réimport des tables')
        return
    import build
    from modkit import builder
    with tempfile.TemporaryDirectory() as tmp:
        folder = os.path.join(tmp, 'identite')
        os.makedirs(folder)
        for name in sorted(TABLES):
            build.export_table(name, os.path.join(folder, name + '.toml'))
        with open(os.path.join(folder, 'mod.toml'), 'w', encoding='utf-8') as f:
            f.write('[mod]\nid = "identite"\nname = "x"\nversion = "1"\nauthor = "x"\ngame = "pokemon-x-eu"\n')
        report, _ = builder.make([folder])
        check(report.files == {}, 'export puis réimport : fichiers changés %s' % sorted(report.files))
    print('  les cinq tables exportées en TOML et réappliquées ne changent aucun octet')


def main():
    for test in (test_personal, test_small_formats, test_text, test_romfs3_fabricated, test_overlay, test_ips,
                 test_toml_and_manifest, test_workspace, test_builder_outputs, test_real_garc_and_formats,
                 test_real_romfs3, test_real_example, test_real_export_identity):
        test()
        print('ok  %s' % test.__name__)
    if SKIPPED:
        print('sauté (dump absent) : %s' % '; '.join(SKIPPED))
    print('Tests du moteur de mods : tout passe.')
    return 0


def test():
    main()


if __name__ == '__main__':
    sys.exit(main())
