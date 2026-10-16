"""Applique un mod à l'établi : fichiers, entrées de GARC, tables éditées, textes, correctifs de code.

Contenu d'un dossier de mod (tout est facultatif sauf mod.toml) :

    mod.toml          le manifeste
    files/<chemin>    un fichier entier du romfs, qui remplace ou ajoute celui du jeu (ex. files/a/0/1/2) ;
                      ce sont les fichiers du mod, jamais ceux du jeu
    garc/<chemin>/N   remplace le numéro N d'un GARC (garc/a/1/8/5/0123.bin ; un numéro à plusieurs
                      sous-fichiers : 0123-0.bin, 0123-1.bin…)
    personal.toml     [species.<numéro ou nom anglais>] champs de la table « personal » à changer
    moves.toml        [move.<numéro ou nom anglais>] champs de la table des attaques
    learnset.toml     [species.X] moves = [[niveau, attaque], …] (remplace), add = […], remove = [attaques]
    evolution.toml    [species.X] evolutions = [{method, param, species, level}, …] (remplace)
    eggmoves.toml     [species.X] moves = [attaques] (remplace)
    text.toml         [<table>.<langue>] "<ligne>" = "texte" (langue « all » = les huit)
    code.toml         [[patch]] address = 0x…, hex = "…", expect_sha1 = "…" (facultatif)

Les tables sont appliquées après les fichiers et les entrées de GARC, dans cet ordre : un mod peut donc remplacer un
GARC puis en éditer une table.
"""
import os

from . import tomlio
from .formats import personal as personal_format
from .workspace import BuildError, LANGUAGES, TEXT_TABLES


def apply_mod(ws, mod):
    if mod.has('files'):
        _files(ws, mod)
    if mod.has('garc'):
        _garc_entries(ws, mod)
    for name, handler in (('personal.toml', _personal), ('moves.toml', _moves), ('learnset.toml', _learnset),
                          ('evolution.toml', _evolution), ('eggmoves.toml', _eggmoves), ('text.toml', _text),
                          ('code.toml', _code)):
        if mod.has(name):
            try:
                handler(ws, mod, tomlio.load(mod.file(name)))
            except BuildError as exc:
                raise BuildError('%s / %s : %s' % (mod.id, name, exc))
            except (KeyError, TypeError, ValueError) as exc:
                raise BuildError('%s / %s : %s' % (mod.id, name, exc))


def _walk(folder):
    for root, _, names in os.walk(folder):
        for name in sorted(names):
            full = os.path.join(root, name)
            yield os.path.relpath(full, folder).replace(os.sep, '/'), full


def _files(ws, mod):
    for rel, full in _walk(mod.file('files')):
        with open(full, 'rb') as f:
            ws.set_file(mod.id, rel, f.read())
        ws.log.append('%s : fichier %s (%s)' % (mod.id, rel, 'remplacé' if ws.game.exists(rel) else 'nouveau'))


def _garc_entries(ws, mod):
    grouped = {}
    for rel, full in _walk(mod.file('garc')):
        folder, _, name = rel.rpartition('/')
        stem = name.rsplit('.', 1)[0]
        number, _, sub = stem.partition('-')
        try:
            grouped.setdefault((folder, int(number)), {})[int(sub or 0)] = full
        except ValueError:
            raise BuildError('%s : nom de fichier de GARC illisible (attendu 0123.bin ou 0123-1.bin) : %s' % (mod.id, rel))
    for (path, number), subs in sorted(grouped.items()):
        if not ws.game.exists(path) and path not in ws.files:
            raise BuildError('%s : le GARC %s n\'existe pas dans le jeu' % (mod.id, path))
        if sorted(subs) != list(range(len(subs))):
            raise BuildError('%s : sous-fichiers non consécutifs pour %s/%d' % (mod.id, path, number))
        data = []
        for k in sorted(subs):
            with open(subs[k], 'rb') as f:
                data.append(f.read())
        ws.replace_garc_entry(mod.id, path, number, data)
        ws.log.append('%s : %s numéro %d remplacé (%d sous-fichier(s))' % (mod.id, path, number, len(data)))


def _entry_index(ws, kind, key, table):
    index = ws.resolve(kind, key)
    if not 0 <= index < len(table):
        raise BuildError('%s %s hors de la table (%d entrées)' % (kind, key, len(table)))
    return index


def _type_value(value):
    if isinstance(value, str) and value.lower() in personal_format.TYPE_NAMES:
        return personal_format.TYPE_NAMES.index(value.lower())
    return value


def _personal(ws, mod, data):
    table = ws.table('personal')
    path = 'a/2/1/8'
    for key, changes in data.get('species', {}).items():
        index = _entry_index(ws, 'species', key, table)
        entry = table[index]
        for field, value in changes.items():
            if field in ('tm_add', 'tm_remove'):
                bits = set(entry['tm_learnable'])
                bits = bits | set(value) if field == 'tm_add' else bits - set(value)
                field, value = 'tm_learnable', sorted(bits)
            elif field in ('type1', 'type2'):
                value = _type_value(value)
            if field not in entry:
                raise BuildError('champ inconnu « %s » (espèce %s) ; champs : %s'
                                 % (field, key, ', '.join(personal_format.FIELDS)))
            ws.claim(mod.id, (path, index, field), value)
            entry[field] = value
        personal_format.write_entry(entry)          # valide tout de suite, le message nomme l'espèce
        ws.log.append('%s : personal, espèce %d : %s' % (mod.id, index, ', '.join(sorted(changes))))


def _moves(ws, mod, data):
    table = ws.table('moves')
    for key, changes in data.get('move', {}).items():
        index = _entry_index(ws, 'move', key, table)
        for field, value in changes.items():
            if field not in table[index]:
                raise BuildError('champ inconnu « %s » (attaque %s) ; champs : %s' % (field, key, ', '.join(table[index])))
            if field == 'type':
                value = _type_value(value)
            ws.claim(mod.id, ('a/2/1/2', index, field), value)
            table[index][field] = value
        ws.log.append('%s : attaques, numéro %d : %s' % (mod.id, index, ', '.join(sorted(changes))))


def _pairs(ws, raw):
    return [(int(level), ws.resolve('move', move)) for level, move in raw]


def _learnset(ws, mod, data):
    table = ws.table('learnset')
    for key, changes in data.get('species', {}).items():
        index = _entry_index(ws, 'species', key, table)
        pairs = list(table[index])
        if 'moves' in changes:
            pairs = _pairs(ws, changes['moves'])
        for pair in _pairs(ws, changes.get('add', [])):
            if pair not in pairs:
                pairs.append(pair)
        removed = {ws.resolve('move', m) for m in changes.get('remove', [])}
        pairs = [p for p in pairs if p[1] not in removed]
        pairs.sort(key=lambda p: p[0])          # le jeu les lit dans l'ordre des niveaux
        ws.claim(mod.id, ('a/2/1/4', index), tuple(pairs))
        table[index] = pairs
        ws.log.append('%s : attaques apprises, espèce %d : %d attaques' % (mod.id, index, len(pairs)))


def _evolution(ws, mod, data):
    table = ws.table('evolution')
    for key, changes in data.get('species', {}).items():
        index = _entry_index(ws, 'species', key, table)
        evolutions = [dict(e, species=ws.resolve('species', e['species'])) for e in changes['evolutions']]
        ws.claim(mod.id, ('a/2/1/5', index), repr(evolutions))
        table[index] = evolutions
        ws.log.append('%s : évolutions, espèce %d : %d' % (mod.id, index, len(evolutions)))


def _eggmoves(ws, mod, data):
    table = ws.table('eggmoves')
    for key, changes in data.get('species', {}).items():
        index = _entry_index(ws, 'species', key, table)
        moves = [ws.resolve('move', m) for m in changes['moves']]
        ws.claim(mod.id, ('a/2/1/3', index), tuple(moves))
        table[index] = moves
        ws.log.append('%s : attaques d\'oeuf, espèce %d : %d' % (mod.id, index, len(moves)))


def _text(ws, mod, data):
    for table, by_lang in data.items():
        if table not in TEXT_TABLES:
            raise BuildError('table de texte inconnue : « %s » (%s)' % (table, ', '.join(TEXT_TABLES)))
        for lang, lines in by_lang.items():
            for index, value in lines.items():
                if not str(index).isdigit():
                    raise BuildError('%s.%s : la clé « %s » devrait être un numéro de ligne' % (table, lang, index))
                for target in (LANGUAGES if lang == 'all' else (lang,)):
                    ws.set_line(mod.id, target, table, int(index), value)
            ws.log.append('%s : textes %s (%s) : %d ligne(s)' % (mod.id, table, lang, len(lines)))


def _code(ws, mod, data):
    for patch in data.get('patch', []):
        address, payload = patch['address'], bytes.fromhex(patch['hex'])
        ws.claim(mod.id, ('code', address), payload.hex())
        ws.code_patches.append((address, payload, mod.id, patch.get('expect_sha1'), patch.get('note', '')))
        ws.log.append('%s : correctif de code en %#x (%d octets)' % (mod.id, address, len(payload)))
