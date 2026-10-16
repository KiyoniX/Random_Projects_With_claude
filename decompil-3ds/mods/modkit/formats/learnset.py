"""Les attaques apprises par niveau (GARC a/2/1/4, un fichier par espèce et par forme, 799 en tout).

Un fichier est une suite de couples (attaque u16, niveau u16) terminée par 0xFFFF 0xFFFF. Vérifié sur Bulbizarre :
Charge au niveau 1, Rugissement au 3, Vampigraine au 7. Un fichier mal terminé est refusé.
"""
import struct


def read_entry(data):
    """Rend la liste des couples (niveau, attaque)."""
    if len(data) % 4 or len(data) < 4 or data[-4:] != b'\xff\xff\xff\xff':
        raise ValueError('fichier d\'attaques apprises mal terminé (%d octets)' % len(data))
    pairs = []
    for i in range(0, len(data) - 4, 4):
        move, level = struct.unpack_from('<HH', data, i)
        if move == 0xFFFF:
            raise ValueError('terminateur au milieu d\'un fichier d\'attaques apprises')
        pairs.append((level, move))
    return pairs


def write_entry(pairs):
    out = bytearray()
    for level, move in pairs:
        if not 0 <= move < 0xFFFF or not 0 <= level <= 0xFFFE:
            raise ValueError('attaque %r au niveau %r : hors limites' % (move, level))
        out += struct.pack('<HH', move, level)
    return bytes(out + b'\xff\xff\xff\xff')
