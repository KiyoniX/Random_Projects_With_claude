"""Placer le joueur d'une sauvegarde de Pokémon X dans n'importe quelle zone, pour faire tourner le jeu partout sans y marcher.

    python teleporter.py zones                                   une zone par ligne : numéro, X, hauteur, Z
    python teleporter.py placer SAUVEGARDE SORTIE ZONE [X H Z]   sans position : à deux cases de la première sortie de la zone
    python teleporter.py test

Le fichier de sauvegarde (d'après PKHeX, faits seulement) fait 0x65600 octets. Son pied, à 0x65400, porte la signature
« FEEB » à +0x10 puis, pour chaque bloc, (longueur u32, numéro u16, CRC u16) à +0x14. Le CRC d'un bloc est CRC-16/CCITT-FALSE
(vérifié sur les trois blocs lus ici, sur les parties de l'utilisateur). La position est dans le bloc 4, à 0x1400 : zone u16 à
+2 et sa copie à +0xF4, X, hauteur, Z en flottants à +0x10 et leur copie à +0x104. Les personnages de la zone sont dans le
bloc 10 : vidés, sinon le jeu, chargeant une autre zone, ne les y retrouve pas et s'arrête dans sa boucle d'erreur (0x11eba0).

Les zones (`a/0/1/2` de la mise à jour, rien n'en est versionné) : un fichier ZO par zone, dont la section 1 liste les
entités. Une sortie y fait 0x18 octets : zone visée u16 à +0, X, hauteur, Z en entiers signés à +8, +0xA, +0xC. Un personnage
fait 0x30 octets, sa case X, Z en u16 à +0x28, +0x2A (une case fait 18 unités : 8811 = 489 x 18 + 9). Sur la partie de
référence, le joueur sorti d'une porte se tient à 36 unités (deux cases) au sud de cette sortie.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import garc
import lz11

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZONES = os.path.join(RACINE, 'local', 'extrait', 'maj', 'romfs', 'a', '0', '1', '2')
TAILLE = 0x65600
PIED = 0x65400
SITUATION = (4, 0x1400, 0x150)
# Les personnages de la zone sauvegardée : le jeu les recherche dans la zone chargée, et se fige s'il ne les trouve pas.
PERSONNAGES = (10, 0x2000, 0x2100)
DEVANT_LA_PORTE = 36
CASE = 18


def crc16(donnees):
    registre = 0xFFFF
    for octet in donnees:
        registre ^= octet << 8
        for _ in range(8):
            registre = ((registre << 1) ^ 0x1021) & 0xFFFF if registre & 0x8000 else (registre << 1) & 0xFFFF
    return registre


def placer(sauvegarde, zone, x, hauteur, z):
    """Rend une copie de la sauvegarde, le joueur à cette position, le CRC du bloc recalculé."""
    if len(sauvegarde) != TAILLE or sauvegarde[PIED + 0x10:PIED + 0x14] != b'FEEB':
        raise ValueError("pas une sauvegarde de Pokémon X (taille ou signature)")
    copie = bytearray(sauvegarde)
    copie[PERSONNAGES[1]:PERSONNAGES[1] + PERSONNAGES[2]] = bytes(PERSONNAGES[2])
    debut = SITUATION[1]
    for champ in (debut + 2, debut + 0xF4):
        struct.pack_into('<H', copie, champ, zone)
    for champ in (debut + 0x10, debut + 0x104):
        struct.pack_into('<fff', copie, champ, x, hauteur, z)
    for numero, debut, longueur in (SITUATION, PERSONNAGES):
        struct.pack_into('<H', copie, PIED + 0x14 + numero * 8 + 6, crc16(copie[debut:debut + longueur]))
    return bytes(copie)


def sorties(fichier):
    """Les sorties d'un fichier de zone : (zone visée, X, hauteur, Z). `fichier` est tel que dans le GARC."""
    donnees = lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    if donnees[:2] != b'ZO':
        return []
    debut, fin = struct.unpack_from('<II', donnees, 8)
    entites = donnees[debut:fin]
    meubles, personnages, nombre = entites[4:7]
    premiere = 0xC + meubles * 0x14 + personnages * 0x30
    rendu = []
    for i in range(nombre):
        p = premiere + i * 0x18
        vers, = struct.unpack_from('<H', entites, p)
        x, hauteur, z = struct.unpack_from('<hhh', entites, p + 8)
        rendu.append((vers, x, hauteur, z))
    return rendu


def premier_personnage(fichier):
    """La case du premier personnage d'un fichier de zone, ou None."""
    donnees = lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    if donnees[:2] != b'ZO':
        return None
    debut, fin = struct.unpack_from('<II', donnees, 8)
    entites = donnees[debut:fin]
    meubles, personnages = entites[4:6]
    if not personnages:
        return None
    return struct.unpack_from('<HH', entites, 0xC + meubles * 0x14 + 0x28)


def position(fichier):
    """Où poser le joueur dans une zone : à deux cases d'une sortie, vers le nord dans une pièce (une ou deux portes, en bas
    de la pièce), vers le sud ailleurs. Supposé pour toutes les zones, vu sur quelques-unes. Sans sortie : la case du premier
    personnage. Sans rien : None."""
    liste = sorties(fichier)
    if not liste:
        case = premier_personnage(fichier)
        return case and (case[0] * CASE + CASE // 2, 0, case[1] * CASE + CASE // 2)
    _, x, hauteur, z = liste[0]
    return x, hauteur, z - DEVANT_LA_PORTE if len(liste) <= 2 else z + DEVANT_LA_PORTE


def zones():
    """Pour chaque zone du jeu, la position où poser le joueur, ou None."""
    with open(ZONES, 'rb') as f:
        _, entrees = garc.lire(f.read())
    return [position(e[0]) for e in entrees]


def test():
    sauvegarde = bytearray(TAILLE)
    sauvegarde[PIED + 0x10:PIED + 0x14] = b'FEEB'
    assert crc16(b'123456789') == 0x29B1, 'la valeur de contrôle de CRC-16/CCITT-FALSE'
    rendu = placer(bytes(sauvegarde), 53, 8811, 36, 10611)
    assert struct.unpack_from('<H', rendu, 0x1402) == (53,) and struct.unpack_from('<H', rendu, 0x14F4) == (53,)
    assert struct.unpack_from('<fff', rendu, 0x1410) == (8811, 36, 10611) == struct.unpack_from('<fff', rendu, 0x1504)
    assert struct.unpack_from('<H', rendu, PIED + 0x14 + 4 * 8 + 6) == (crc16(rendu[0x1400:0x1550]),)
    assert len(rendu) == TAILLE and rendu[:0x1400] == bytes(0x1400), 'le reste ne bouge pas'
    sauvegarde[0x2000] = 3
    assert placer(bytes(sauvegarde), 53, 0, 0, 0)[0x2000:0x4100] == bytes(0x2100), 'les personnages sont vidés'
    try:
        placer(bytes(10), 1, 0, 0, 0)
    except ValueError:
        pass
    else:
        raise AssertionError('un fichier de mauvaise taille est refusé')
    # une zone fabriquée : un meuble, un personnage, deux sorties
    entites = bytearray(0xC + 0x14 + 0x30 + 2 * 0x18)
    entites[4:7] = bytes([1, 1, 2])
    p = 0xC + 0x14 + 0x30
    struct.pack_into('<H', entites, p, 54)
    struct.pack_into('<HHH', entites, p + 8, 100, 36, 200)
    struct.pack_into('<H', entites, p + 0x18, 57)
    zone = b'ZO\x02\x00' + struct.pack('<III', 0x10, 0x10, 0x10 + len(entites)) + bytes(entites)
    assert sorties(zone) == [(54, 100, 36, 200), (57, 0, 0, 0)]
    assert sorties(b'XX\x00\x00') == []
    assert position(zone) == (100, 36, 164), 'deux sorties : une pièce, on se pose au nord de la porte'
    assert position(b'XX\x00\x00') is None
    seul = bytearray(0xC + 0x30)
    seul[4:7] = bytes([0, 1, 0])
    struct.pack_into('<HH', seul, 0xC + 0x28, 18, 26)
    seul = b'ZO\x02\x00' + struct.pack('<III', 0x10, 0x10, 0x10 + len(seul)) + bytes(seul)
    assert position(seul) == (333, 0, 477), 'sans sortie : le premier personnage'
    negatif = bytearray(entites)
    struct.pack_into('<h', negatif, p + 0xA, -144)
    negatif = b'ZO\x02\x00' + struct.pack('<III', 0x10, 0x10, 0x10 + len(negatif)) + bytes(negatif)
    assert sorties(negatif)[0] == (54, 100, -144, 200), 'une hauteur peut être négative'
    print('teleporter : tests ok')


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ''
    if action == 'test':
        test()
    elif action == 'zones':
        for numero, ici in enumerate(zones()):
            print(numero, *(ici or ('-',)))
    elif action == 'placer':
        source, sortie, zone = sys.argv[2], sys.argv[3], int(sys.argv[4])
        if len(sys.argv) > 5:
            x, hauteur, z = map(float, sys.argv[5:8])
        else:
            porte = zones()[zone]
            if porte is None:
                sys.exit(f'la zone {zone} n\'a pas de sortie : donner la position')
            x, hauteur, z = porte[1], porte[2], porte[3] + DEVANT_LA_PORTE
        with open(source, 'rb') as f:
            rendu = placer(f.read(), zone, x, hauteur, z)
        with open(sortie, 'wb') as f:
            f.write(rendu)
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
