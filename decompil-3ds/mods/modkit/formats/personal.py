"""La table « personal » : statistiques de base, types, talents, groupes d'oeufs… d'une espèce (64 octets par entrée).

GARC a/2/1/8 : 800 numéros. Les 799 premiers sont les entrées (0 vide, 1 à 721 les espèces, ensuite les formes) ;
le dernier est la table entière, les 799 entrées bout à bout. Le jeu lit l'un ou l'autre : les deux sont réécrits
ensemble, et la lecture refuse un fichier où ils ne coïncident pas.

Disposition d'une entrée, recoupée avec pk3DS (PersonalInfoXY.cs, lue pour comprendre) et vérifiée sur Bulbizarre
(45/49/49/45/65/65, Plante/Poison, 64 d'expérience, 0,7 m, 6,9 kg) :

    00-05  hp, attack, defense, speed, sp_attack, sp_defense
    06-07  type1, type2                 (0 Normal … 17 Fée)
    08     catch_rate                   09  evo_stage
    0A-0B  rendement en EV, deux bits par stat dans l'ordre hp, attack, defense, speed, sp_attack, sp_defense
    0C-11  item1, item2, item3 (u16)    12  gender_ratio    13  hatch_cycles    14  base_friendship
    15     exp_growth                   16-17  egg_group1, egg_group2
    18-1A  ability1, ability2, ability3 (le troisième est le talent caché)
    1B     unknown_1b                   1C-1D  form_stats_index (u16)    1E-1F  form_sprite_index (u16)
    20     form_count                   21  color (6 bits bas) et color_flags (2 bits hauts)
    22-23  base_exp (u16)               24-25  height (u16)    26-27  weight (u16)
    28-37  CT/CS appris, 128 bits       38-3B  tutor_flags (u32)     3C-3F  unknown_3c (u32)
"""
import struct

ENTRY_SIZE = 0x40
EV_NAMES = ('ev_hp', 'ev_attack', 'ev_defense', 'ev_speed', 'ev_sp_attack', 'ev_sp_defense')
TYPE_NAMES = ('normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'fire', 'water',
              'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy')

BYTE_FIELDS = {'hp': 0, 'attack': 1, 'defense': 2, 'speed': 3, 'sp_attack': 4, 'sp_defense': 5, 'type1': 6, 'type2': 7,
               'catch_rate': 8, 'evo_stage': 9, 'gender_ratio': 0x12, 'hatch_cycles': 0x13, 'base_friendship': 0x14,
               'exp_growth': 0x15, 'egg_group1': 0x16, 'egg_group2': 0x17, 'ability1': 0x18, 'ability2': 0x19,
               'ability3': 0x1A, 'unknown_1b': 0x1B, 'form_count': 0x20}
WORD_FIELDS = {'item1': 0x0C, 'item2': 0x0E, 'item3': 0x10, 'form_stats_index': 0x1C, 'form_sprite_index': 0x1E,
               'base_exp': 0x22, 'height': 0x24, 'weight': 0x26}
FIELDS = (list(BYTE_FIELDS) + list(WORD_FIELDS) + list(EV_NAMES) + ['ev_unused', 'color', 'color_flags',
                                                                   'tm_learnable', 'tutor_flags', 'unknown_3c'])


def read_entry(data):
    if len(data) != ENTRY_SIZE:
        raise ValueError('une entrée « personal » fait %d octets, pas %d' % (ENTRY_SIZE, len(data)))
    out = {}
    for name, off in BYTE_FIELDS.items():
        out[name] = data[off]
    for name, off in WORD_FIELDS.items():
        out[name] = struct.unpack_from('<H', data, off)[0]
    ev = struct.unpack_from('<H', data, 0x0A)[0]
    for i, name in enumerate(EV_NAMES):
        out[name] = ev >> (2 * i) & 3
    out['ev_unused'] = ev >> 12            # les 4 bits hauts, gardés pour l'aller-retour
    out['color'] = data[0x21] & 0x3F
    out['color_flags'] = data[0x21] >> 6
    bits = int.from_bytes(data[0x28:0x38], 'little')
    out['tm_learnable'] = [i for i in range(128) if bits >> i & 1]
    out['tutor_flags'] = struct.unpack_from('<I', data, 0x38)[0]
    out['unknown_3c'] = struct.unpack_from('<I', data, 0x3C)[0]
    return out


def _check(name, value, maximum):
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= maximum:
        raise ValueError('« %s » vaut %r : un entier de 0 à %d est attendu' % (name, value, maximum))


def write_entry(entry):
    out = bytearray(ENTRY_SIZE)
    for name, off in BYTE_FIELDS.items():
        _check(name, entry[name], 255)
        out[off] = entry[name]
    for name, off in WORD_FIELDS.items():
        _check(name, entry[name], 0xFFFF)
        struct.pack_into('<H', out, off, entry[name])
    ev = 0
    for i, name in enumerate(EV_NAMES):
        _check(name, entry[name], 3)
        ev |= entry[name] << (2 * i)
    _check('ev_unused', entry['ev_unused'], 15)
    struct.pack_into('<H', out, 0x0A, ev | entry['ev_unused'] << 12)
    _check('color', entry['color'], 63)
    _check('color_flags', entry['color_flags'], 3)
    out[0x21] = entry['color'] | entry['color_flags'] << 6
    bits = 0
    for i in entry['tm_learnable']:
        _check('tm_learnable', i, 127)
        bits |= 1 << i
    out[0x28:0x38] = bits.to_bytes(16, 'little')
    _check('tutor_flags', entry['tutor_flags'], 0xFFFFFFFF)
    _check('unknown_3c', entry['unknown_3c'], 0xFFFFFFFF)
    struct.pack_into('<II', out, 0x38, entry['tutor_flags'], entry['unknown_3c'])
    return bytes(out)


def read_table(entries):
    """Les entrées d'un GARC a/2/1/8 (liste de listes d'octets) -> liste de dictionnaires, une par numéro d'espèce."""
    if len(entries) < 3 or any(len(e) != 1 for e in entries):
        raise ValueError('le GARC « personal » doit avoir un sous-fichier par numéro')
    whole = entries[-1][0]
    singles = [e[0] for e in entries[:-1]]
    if whole != b''.join(singles):
        raise ValueError('la table entière de « personal » ne coïncide pas avec ses %d entrées' % len(singles))
    return [read_entry(s) for s in singles]


def write_table(table):
    singles = [write_entry(e) for e in table]
    return [[s] for s in singles] + [[b''.join(singles)]]
