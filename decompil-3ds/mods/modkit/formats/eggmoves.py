"""Les attaques d'oeuf (GARC a/2/1/3, 722 fichiers).

Un fichier : nombre u16, puis ce nombre d'attaques u16. Le numéro 0 (pas une espèce) est un fichier de 0 octet : il
se lit None et se réécrit vide ; « aucune attaque d'oeuf » se code 00 00 et se lit [].
"""
import struct


def read_entry(data):
    if not data:
        return None
    count = struct.unpack_from('<H', data)[0]
    if len(data) != 2 + 2 * count:
        raise ValueError('fichier d\'attaques d\'oeuf : %d attaques annoncées, %d octets' % (count, len(data)))
    return list(struct.unpack_from('<%dH' % count, data, 2))


def write_entry(moves):
    if moves is None:
        return b''
    return struct.pack('<H%dH' % len(moves), len(moves), *moves)
