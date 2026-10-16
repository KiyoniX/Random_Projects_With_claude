"""Le manifeste d'un mod (mod.toml) et l'ordre dans lequel plusieurs mods s'empilent.

    [mod]
    id = "depart-musclé"          # lettres, chiffres, tirets : l'identité du mod, sans espace
    name = "Un nom lisible"
    version = "1.0.0"
    author = "Quelqu'un"
    description = "Une phrase."
    game = "pokemon-x-eu"         # le jeu visé (voir modkit.GAME_ID)

    [dependencies]                # ce mod exige ces mods, avec une version minimale
    autre-mod = ">=1.2"

    [conflicts]                   # ce mod refuse de tourner avec ceux-ci
    ancien-mod = "*"

    [order]
    after = ["autre-mod"]         # à charger après ceux-ci s'ils sont là (sans les exiger)

Un mod ne contient aucun octet du jeu : seulement ce qu'il change et ses propres fichiers.
"""
import os
import re

from . import GAME_ID, tomlio


class ModError(Exception):
    pass


ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]*$')


def version_tuple(text):
    try:
        return tuple(int(p) for p in str(text).split('.'))
    except ValueError:
        raise ModError('version illisible : %r (attendu : 1.2.3)' % (text,))


def satisfies(version, requirement):
    """requirement : « * », « 1.2 », « >=1.2 », « ==1.2.3 », « >1 », « <2 », « <=2 ». Comparaison par numéros."""
    requirement = str(requirement).strip()
    if requirement in ('', '*'):
        return True
    m = re.match(r'^(>=|<=|==|>|<|=)?\s*([0-9][0-9.]*)$', requirement)
    if not m:
        raise ModError('exigence de version illisible : %r' % requirement)
    op, wanted = m.group(1) or '>=', version_tuple(m.group(2))
    have = version_tuple(version)
    size = max(len(have), len(wanted))
    have += (0,) * (size - len(have))
    wanted += (0,) * (size - len(wanted))
    return {'>=': have >= wanted, '<=': have <= wanted, '==': have == wanted, '=': have == wanted,
            '>': have > wanted, '<': have < wanted}[op]


class Mod:
    def __init__(self, path, meta):
        self.path = path
        mod = meta.get('mod')
        if not isinstance(mod, dict):
            raise ModError('%s : la table [mod] manque' % os.path.join(path, 'mod.toml'))
        for key in ('id', 'name', 'version', 'author', 'game'):
            if not isinstance(mod.get(key), str) or not mod[key]:
                raise ModError('%s : [mod] doit donner « %s » (texte)' % (os.path.join(path, 'mod.toml'), key))
        if not ID_RE.match(mod['id']):
            raise ModError('identité de mod invalide : %r (lettres, chiffres, - et _)' % mod['id'])
        version_tuple(mod['version'])
        self.id = mod['id']
        self.name = mod['name']
        self.version = mod['version']
        self.author = mod['author']
        self.description = mod.get('description', '')
        self.game = mod['game']
        self.dependencies = dict(meta.get('dependencies', {}))
        self.conflicts = dict(meta.get('conflicts', {}))
        self.after = list(meta.get('order', {}).get('after', []))

    def file(self, *parts):
        return os.path.join(self.path, *parts)

    def has(self, *parts):
        return os.path.exists(self.file(*parts))

    def __repr__(self):
        return 'Mod(%s %s)' % (self.id, self.version)


def load(path):
    manifest = os.path.join(path, 'mod.toml')
    if not os.path.isfile(manifest):
        raise ModError('%s : pas de mod.toml (ce dossier n\'est pas un mod)' % path)
    try:
        meta = tomlio.load(manifest)
    except Exception as exc:
        raise ModError('%s illisible : %s' % (manifest, exc))
    return Mod(path, meta)


def resolve(mods):
    """Vérifie la pile et rend les mods dans l'ordre de chargement (le dernier gagne en cas de conflit).

    L'ordre demandé est gardé, sauf quand une dépendance ou un « after » impose de charger un mod plus tôt.
    Lève ModError pour : doublon, jeu différent, dépendance absente ou trop ancienne, conflit déclaré, cycle.
    """
    by_id = {}
    for m in mods:
        if m.id in by_id:
            raise ModError('le mod « %s » est donné deux fois (%s et %s)' % (m.id, by_id[m.id].path, m.path))
        by_id[m.id] = m
        if m.game != GAME_ID:
            raise ModError('le mod « %s » vise « %s », ce moteur gère « %s »' % (m.id, m.game, GAME_ID))
    for m in mods:
        for dep, req in m.dependencies.items():
            if dep not in by_id:
                raise ModError('le mod « %s » exige « %s » (%s), absent de la pile' % (m.id, dep, req))
            if not satisfies(by_id[dep].version, req):
                raise ModError('le mod « %s » exige « %s » %s, la pile a la version %s'
                               % (m.id, dep, req, by_id[dep].version))
        for other, req in m.conflicts.items():
            if other in by_id and satisfies(by_id[other].version, req):
                raise ModError('le mod « %s » est déclaré incompatible avec « %s » (%s)' % (m.id, other, by_id[other].version))
    before = {m.id: set(d for d in list(m.dependencies) + m.after if d in by_id) for m in mods}
    order, done, state = [], set(), {}

    def visit(mid, chain):
        if mid in done:
            return
        if state.get(mid) == 1:
            raise ModError('cycle de dépendances : %s' % ' -> '.join(chain + [mid]))
        state[mid] = 1
        for dep in sorted(before[mid], key=lambda d: [m.id for m in mods].index(d)):
            visit(dep, chain + [mid])
        state[mid] = 2
        done.add(mid)
        order.append(by_id[mid])

    for m in mods:
        visit(m.id, [])
    return order
