"""Compression LZ10 et LZ11 de Nintendo, telle qu'on la trouve dans les fichiers de la 3DS.

Un fichier compressé commence par un octet de type (0x10 ou 0x11) suivi de la taille
décompressée sur trois octets. Viennent ensuite des blocs de huit éléments annoncés par un
octet de drapeaux : bit à 1, l'élément est une référence arrière (longueur, distance) ;
bit à 0, c'est un octet copié tel quel.

    python lz11.py decompresser entree sortie
    python lz11.py compresser entree sortie      (LZ11, glouton, pour les tests)
    python lz11.py test
"""
import os
import sys


def decompresser(donnees):
    """Rend les octets décompressés, ou lève ValueError si l'en-tête n'est pas LZ10/LZ11."""
    if len(donnees) < 4 or donnees[0] not in (0x10, 0x11):
        raise ValueError('pas un flux LZ10/LZ11 (octet de type %s)' % (hex(donnees[0]) if donnees else 'absent'))
    type_ = donnees[0]
    taille = donnees[1] | donnees[2] << 8 | donnees[3] << 16
    sortie = bytearray()
    pos = 4
    while len(sortie) < taille:
        if pos >= len(donnees):
            raise ValueError('flux tronqué à %d octets sur %d' % (len(sortie), taille))
        drapeaux = donnees[pos]
        pos += 1
        for bit in range(7, -1, -1):
            if len(sortie) >= taille:
                break
            if not drapeaux >> bit & 1:
                sortie.append(donnees[pos])
                pos += 1
                continue
            b1 = donnees[pos]
            if type_ == 0x10:
                longueur = (b1 >> 4) + 3
                distance = ((b1 & 0xF) << 8 | donnees[pos + 1]) + 1
                pos += 2
            else:
                haut = b1 >> 4
                if haut == 0:
                    b2 = donnees[pos + 1]
                    longueur = ((b1 & 0xF) << 4 | b2 >> 4) + 0x11
                    distance = ((b2 & 0xF) << 8 | donnees[pos + 2]) + 1
                    pos += 3
                elif haut == 1:
                    b2, b3 = donnees[pos + 1], donnees[pos + 2]
                    longueur = ((b1 & 0xF) << 12 | b2 << 4 | b3 >> 4) + 0x111
                    distance = ((b3 & 0xF) << 8 | donnees[pos + 3]) + 1
                    pos += 4
                else:
                    longueur = haut + 1
                    distance = ((b1 & 0xF) << 8 | donnees[pos + 1]) + 1
                    pos += 2
            if distance > len(sortie):
                raise ValueError('référence arrière hors du flux (distance %d à la position %d)' % (distance, len(sortie)))
            for _ in range(longueur):
                sortie.append(sortie[-distance])
    return bytes(sortie[:taille])


def compresser(donnees):
    """Compresse en LZ11 par recherche gloutonne. Lent mais exact : sert aux tests et aux petits fichiers."""
    if len(donnees) >= 1 << 24:
        raise ValueError('trop gros pour LZ11 (taille sur trois octets)')
    sortie = bytearray([0x11, len(donnees) & 0xFF, len(donnees) >> 8 & 0xFF, len(donnees) >> 16 & 0xFF])
    pos = 0
    FENETRE, MAXI = 0x1000, 0x10110
    while pos < len(donnees):
        drapeaux, bloc = 0, bytearray()
        for bit in range(7, -1, -1):
            if pos >= len(donnees):
                break
            meilleur_long, meilleur_dist = 0, 0
            debut = max(0, pos - FENETRE)
            for cand in range(pos - 1, debut - 1, -1):
                l = 0
                while pos + l < len(donnees) and l < MAXI and donnees[cand + l] == donnees[pos + l]:
                    l += 1
                if l > meilleur_long:
                    meilleur_long, meilleur_dist = l, pos - cand
                    if l >= MAXI:
                        break
            if meilleur_long >= 3:
                drapeaux |= 1 << bit
                d = meilleur_dist - 1
                if meilleur_long <= 0x10:
                    bloc += bytes([(meilleur_long - 1) << 4 | d >> 8, d & 0xFF])
                elif meilleur_long <= 0x110:
                    l = meilleur_long - 0x11
                    bloc += bytes([l >> 4, (l & 0xF) << 4 | d >> 8, d & 0xFF])
                else:
                    l = meilleur_long - 0x111
                    bloc += bytes([0x10 | l >> 12, l >> 4 & 0xFF, (l & 0xF) << 4 | d >> 8, d & 0xFF])
                pos += meilleur_long
            else:
                bloc.append(donnees[pos])
                pos += 1
        sortie.append(drapeaux)
        sortie += bloc
    return bytes(sortie)


def test():
    import random
    rng = random.Random(3)
    essais = [b'', b'a', b'abcabcabcabcabc', bytes(range(256)) * 3, b'\x00' * 5000,
              bytes(rng.getrandbits(8) for _ in range(3000)),
              b''.join(rng.choice([b'pokemon', b'garc', b'kalos', b'\xff\x00']) for _ in range(800))]
    for d in essais:
        c = compresser(d)
        assert decompresser(c) == d, 'aller-retour LZ11 raté sur %d octets' % len(d)
    # Un flux LZ10 écrit à la main : « abab » puis une référence de 4 octets à distance 2 (abababab).
    lz10 = bytes([0x10, 8, 0, 0, 0b00001000, ord('a'), ord('b'), ord('a'), ord('b'), (4 - 3) << 4 | 0, 2 - 1])
    assert decompresser(lz10) == b'abababab'
    print('lz11 : %d aller-retours réussis, LZ10 lu.' % len(essais))


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['test']:
        test()
    elif len(args) == 3 and args[0] in ('decompresser', 'compresser'):
        with open(args[1], 'rb') as f:
            d = f.read()
        r = decompresser(d) if args[0] == 'decompresser' else compresser(d)
        with open(args[2], 'wb') as f:
            f.write(r)
        print('%s : %d octets -> %d octets' % (os.path.basename(args[1]), len(d), len(r)))
    else:
        print(__doc__)
