"""Le mod de la jauge de PV : la barre (verte, jaune ou rouge) remplit tout l'encadrement des plaques redessinées
(`pack_dessins.py`) au lieu de la fente de 48 x 4 du jeu.

Les plaques du combat sont dans les mises en page CLYT de `a/0/0/4` (simple, double, triple et une quatrième ; textures
`ally_gauge.bclim`, `enemy_gauge.bclim`). La barre y est une image de 48 x 4, ancrée au milieu de son bord gauche (origine 3),
une par plaque : (2, 1) et (-15, -8) en simple. Le code du jeu en pose la largeur (48 x la part de PV restante : 48 points
mesurés à PV pleins avec une case de 49) mais pas l'échelle : chaque barre devient 8 de haut, un point plus à gauche, et
son échelle horizontale 52 / 48. Dans la texture de la plaque, elle va alors de la fin de la pastille « PV » au début de
l'arrondi du bout droit (ses coins carrés restent sur l'anneau noir), et du haut au bas du fond sombre.

Une case CLYT (pan1, pic1, txt1…) : en-tête de section (8 octets), drapeaux, origine, alpha, octet, nom (0x10), données (8),
puis dix flottants : position x y z, rotation x y z, échelle x y, taille l h (à +0x24 de la section).

    python outils/mod_jauge.py [DOSSIER]
    python outils/mod_jauge.py test
"""
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tournee

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(RACINE, 'local', 'extrait', 'romfs', 'a', '0', '0', '4')
SORTIE = os.path.join(RACINE, 'local', 'mods-build', 'jauge-hd')
LONGUEUR = 52  # la barre à PV pleins, en points de la plaque
CASES = (b'pan1', b'pic1', b'txt1', b'wnd1', b'bnd1', b'prt1')


def cases(d, o):
    """Les cases du CLYT qui commence à `o` : (type, décalage de la section)."""
    p = o + struct.unpack_from('<H', d, o + 6)[0]
    for _ in range(struct.unpack_from('<I', d, o + 0x10)[0]):
        if p + 8 > len(d):
            break
        nature, taille = d[p:p + 4], struct.unpack_from('<I', d, p + 4)[0]
        if nature in CASES:
            yield nature, p
        if taille == 0:
            break
        p += taille


def agrandir(donnees):
    """Les octets de `a/0/0/4`, chaque barre de 48 x 4 ancrée à gauche devenue 48 x 8 à l'échelle 52 / 48, un point plus à gauche ; rend
    (octets, nombre de barres). Les tailles ne changent pas : les flottants sont réécrits en place."""
    d = bytearray(donnees)
    faites = 0
    for m in re.finditer(b'CLYT', d):
        for nature, p in cases(d, m.start()):
            x, y = struct.unpack_from('<2f', d, p + 0x24)
            w, h = struct.unpack_from('<2f', d, p + 0x24 + 32)
            if nature == b'pic1' and d[p + 9] == 3 and (w, h) == (48.0, 4.0):
                struct.pack_into('<f', d, p + 0x24, x - 1)
                struct.pack_into('<f', d, p + 0x24 + 24, LONGUEUR / 48)
                struct.pack_into('<2f', d, p + 0x24 + 32, 48.0, 8.0)
                faites += 1
    return bytes(d), faites


def clyt_fabrique(barres):
    """Un CLYT d'une section pic1 par (origine, l, h)."""
    sections = b''
    for origine, w, h in barres:
        corps = bytes([1, origine, 255, 0]) + b'barre'.ljust(0x10, b'\0') + bytes(8)
        corps += struct.pack('<10f', 2.0, 1.0, 0, 0, 0, 0, 1, 1, w, h)
        sections += b'pic1' + struct.pack('<I', 8 + len(corps)) + corps
    return b'CLYT' + struct.pack('<HHIII', 0xFEFF, 0x14, 0x02020000, 0x14 + len(sections), len(barres)) + sections


def test():
    d = b'avant' + clyt_fabrique([(3, 48.0, 4.0), (4, 48.0, 4.0), (3, 93.0, 2.0)]) + b'apres'
    neuf, faites = agrandir(d)
    assert faites == 1 and len(neuf) == len(d), 'seule la barre ancrée à gauche de 48 x 4'
    p = d.find(b'pic1')
    assert struct.unpack_from('<2f', neuf, p + 0x24) == (1.0, 1.0)
    assert struct.unpack_from('<2f', neuf, p + 0x44) == (48.0, 8.0)
    assert abs(struct.unpack_from('<f', neuf, p + 0x3C)[0] - 52 / 48) < 1e-6, 'échelle horizontale'
    assert neuf[p + 0x58:] == d[p + 0x58:], 'le reste ne bouge pas'
    print('mod_jauge : ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['test']:
        test()
    else:
        dossier = sys.argv[1] if len(sys.argv) > 1 else SORTIE
        octets, faites = agrandir(open(SOURCE, 'rb').read())
        print(faites, 'barres ;', tournee.mod_fichiers(dossier, {'a/0/0/4': octets}))
