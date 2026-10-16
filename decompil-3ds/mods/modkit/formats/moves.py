"""Les données des attaques (GARC a/2/1/2, 618 fichiers de 36 octets : le numéro 0 vide, puis 617 attaques).

Seuls les 8 premiers octets sont nommés, d'après pk3DS (Move.cs) et vérifiés sur Charge (type 0, catégorie 1,
puissance 40, précision 100, 35 PP) ; les 28 suivants (effets, drapeaux…) sont gardés bruts dans « rest », une
chaîne hexadécimale, en attendant d'être relus.

    00 type   01 quality   02 category (0 statut, 1 physique, 2 spéciale)   03 power   04 accuracy   05 pp
    06 priority (signé)   07 hits (bas : maximum, haut : minimum)
"""
import struct

SIZE = 36


def read_entry(data):
    if len(data) != SIZE:
        raise ValueError('une attaque fait %d octets, pas %d' % (SIZE, len(data)))
    type_, quality, category, power, accuracy, pp, priority, hits = struct.unpack_from('<BBBBBBbB', data)
    return {'type': type_, 'quality': quality, 'category': category, 'power': power, 'accuracy': accuracy,
            'pp': pp, 'priority': priority, 'hits': hits, 'rest': data[8:].hex()}


def write_entry(move):
    rest = bytes.fromhex(move['rest'])
    if len(rest) != SIZE - 8:
        raise ValueError('« rest » doit faire %d octets' % (SIZE - 8))
    for key, low, high in (('type', 0, 255), ('quality', 0, 255), ('category', 0, 255), ('power', 0, 255),
                           ('accuracy', 0, 255), ('pp', 0, 255), ('priority', -128, 127), ('hits', 0, 255)):
        if not isinstance(move[key], int) or not low <= move[key] <= high:
            raise ValueError('attaque : « %s » vaut %r, de %d à %d attendu' % (key, move[key], low, high))
    return struct.pack('<BBBBBBbB', move['type'], move['quality'], move['category'], move['power'],
                       move['accuracy'], move['pp'], move['priority'], move['hits']) + rest
