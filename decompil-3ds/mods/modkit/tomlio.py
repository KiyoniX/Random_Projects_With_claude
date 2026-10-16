"""Lecture (tomllib, de Python) et écriture (petit écrivain maison) du TOML des mods.

L'écrivain ne sait faire que ce dont les exports ont besoin : des tables imbriquées de dictionnaires, des entiers, des
chaînes, des booléens, des listes de ces valeurs et des listes de dictionnaires (tableaux de tables).
"""
import re
import tomllib

_BARE = re.compile(r'^[A-Za-z0-9_-]+$')


def load(path):
    with open(path, 'rb') as f:
        return tomllib.load(f)


def loads(text):
    return tomllib.loads(text)


def _key(k):
    k = str(k)
    return k if _BARE.match(k) else '"%s"' % k.replace('\\', '\\\\').replace('"', '\\"')


def _value(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, str):
        out = v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\t', '\\t')
        return '"%s"' % ''.join(c if ord(c) >= 0x20 else '\\u%04x' % ord(c) for c in out)
    if isinstance(v, (list, tuple)):
        return '[%s]' % ', '.join(_value(x) for x in v)
    if isinstance(v, dict):
        return '{ %s }' % ', '.join('%s = %s' % (_key(k), _value(x)) for k, x in v.items())
    raise TypeError('valeur TOML non gérée : %r' % (v,))


def dumps(data, _prefix=''):
    lines = []
    plain = [(k, v) for k, v in data.items() if not isinstance(v, dict)]
    tables = [(k, v) for k, v in data.items() if isinstance(v, dict)]
    for k, v in plain:
        lines.append('%s = %s' % (_key(k), _value(v)))
    out = '\n'.join(lines) + ('\n' if lines else '')
    for k, v in tables:
        name = (_prefix + '.' if _prefix else '') + _key(k)
        out += '\n[%s]\n' % name + dumps(v, name)
    return out
