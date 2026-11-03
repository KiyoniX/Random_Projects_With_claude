"""Placer le joueur d'une sauvegarde de Pokémon X dans n'importe quelle zone, pour faire tourner le jeu partout sans y marcher.

    python teleporter.py zones                                   une zone par ligne : numéro, X, hauteur, Z
    python teleporter.py placer SAUVEGARDE SORTIE ZONE [X H Z]   sans position : à deux cases de la première sortie de la zone
    python teleporter.py test

Le fichier de sauvegarde (d'après PKHeX, faits seulement) fait 0x65600 octets. Son pied, à 0x65400, porte la signature
« FEEB » à +0x10 puis, pour chaque bloc, (longueur u32, numéro u16, CRC u16) à +0x14. Le CRC d'un bloc est CRC-16/CCITT-FALSE
(vérifié sur les trois blocs lus ici, sur les parties de l'utilisateur). La position est dans le bloc 4, à 0x1400 : zone u16 à
+2 et sa copie à +0xF4, X, hauteur, Z en flottants à +0x10 et leur copie à +0x104. Les personnages de la zone sont dans le
bloc 10 : un enregistrement de 0x108 octets par personnage, le joueur compris. Au lancement d'une partie, le jeu les restaure
tels quels : gardés d'une autre zone, il ne les y retrouve pas et s'arrête dans sa boucle d'erreur (0x11eba0) ; vidés, la zone
est déserte. Donner le fichier de la zone à `placer` les refait d'après elle (champs relevés sur les parties de l'utilisateur).
Le bloc 19, à 0x14a00, porte l'avancement de l'histoire : les compteurs 16 bits 0x4000.. à +0, les drapeaux à +0x2f0
(eventwork_get_work_ptr, field::EventWork ; 0 écart avec un vidage).

Une position sur rail (Illumis, neuf zones) : u16 type = 1 ; u32 ligne, u32 clé, f32 front, f32 côté, six flottants à 1
(0x3ce2fc). Dans le bloc 4 à +0xC et +0x100, en unités ; dans le bloc 10 à +0x3C et +0x68, en cases (0x430874). Essayé sur la
zone 63 : le jeu y pose bien le joueur.

Les zones (`a/0/1/2` de la mise à jour, rien n'en est versionné) : un fichier ZO par zone, dont la section 1 liste les
entités. Une sortie y fait 0x18 octets : zone visée u16 à +0, X, hauteur, Z en entiers signés à +8, +0xA, +0xC. Un personnage
fait 0x30 octets, sa case X, Z en u16 à +0x28, +0x2A (une case fait 18 unités : 8811 = 489 x 18 + 9). Sur la partie de
référence, le joueur sorti d'une porte se tient à 36 unités (deux cases) au sud de cette sortie.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import amx
import garc
import lz11

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZONES = os.path.join(RACINE, 'local', 'extrait', 'maj', 'romfs', 'a', '0', '1', '2')
TAILLE = 0x65600
PIED = 0x65400
SITUATION = (4, 0x1400, 0x150)
# Les personnages de la zone sauvegardée : le jeu les recherche dans la zone chargée, et se fige s'il ne les trouve pas.
PERSONNAGES = (10, 0x2000, 0x2100)
ENREGISTREMENT = 0x108
AVANCEMENT = (19, 0x14A00, 0x504)
COMPTEURS = 0x14A00
DRAPEAUX = 0x14CF0
PREMIER_COMPTEUR, DERNIER_COMPTEUR = 0x4000, 0x4177
NOMBRE_DRAPEAUX = 0xD00
DEVANT_LA_PORTE = 36
CASE = 18
SCENES = amx.hachage('GetSceneChangeData')


def crc16(donnees):
    registre = 0xFFFF
    for octet in donnees:
        registre ^= octet << 8
        for _ in range(8):
            registre = ((registre << 1) ^ 0x1021) & 0xFFFF if registre & 0x8000 else (registre << 1) & 0xFFFF
    return registre


def ecrire_rail(tampon, o, rail, echelle):
    """Une position sur rail à `o` ; `rail` : (ligne, clé, front, côté), en cases."""
    ligne, cle, front, cote = rail
    struct.pack_into('<H', tampon, o, 1)
    struct.pack_into('<IIff6f', tampon, o + 4, ligne, cle, front * echelle, cote * echelle, 1, 1, 1, 1, 1, 1)


def enregistrements(donnees_joueur, fichier, zone, x, hauteur, z, rail=None):
    """Le contenu du bloc 10 pour une zone : ses personnages à leur place, puis le joueur, repris de l'ancien bloc."""
    donnees = lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    debut, fin = struct.unpack_from('<II', donnees, 8)
    entites = donnees[debut:fin]
    meubles, nombre = entites[4:6]
    bloc = bytearray()
    for i in range(min(nombre, PERSONNAGES[2] // ENREGISTREMENT - 1)):
        p = 0xC + meubles * 0x14 + i * 0x30
        r = bytearray(ENREGISTREMENT)
        struct.pack_into('<IHH', r, 0, 0x08010003, i, zone)
        r[8:0x14] = entites[p + 2:p + 0xE]
        r[0x34:0x3C] = entites[p + 0x14:p + 0x1C]
        case_x, case_z, h = struct.unpack_from('<HHf', entites, p + 0x28)
        if entites[p + 0x24] == 1:
            ligne, front, cote, cle = struct.unpack_from('<IhbB', entites, p + 0x28)
            ecrire_rail(r, 0x3C, (ligne, cle, front, cote), 1)
            ecrire_rail(r, 0x68, (ligne, cle, front, cote), 1)
        else:
            for champ in (0x40, 0x6C):
                struct.pack_into('<fff', r, champ, case_x, h / CASE, case_z)
        # regard vers le sud, échelles à 1, et les valeurs que tous les personnages relevés ont en commun
        struct.pack_into('<fff', r, 0x1C, 1, 0, 0)
        struct.pack_into('<fff', r, 0x28, 1, 0, 0)
        for champ in (0x58, 0x60, 0x84, 0x8C):
            struct.pack_into('<f', r, champ, 1)
        struct.pack_into('<III', r, 0x94, 0x20, 0x00010100, 0x00FFFFFF)
        struct.pack_into('<I', r, 0xA0, 0xFFFFFFFF)
        bloc += r
    joueur = bytearray(donnees_joueur)
    struct.pack_into('<H', joueur, 6, zone)
    for champ in (0x40, 0x6C):
        struct.pack_into('<fff', joueur, champ, x / CASE, hauteur / CASE, z / CASE)
    if rail:
        ecrire_rail(joueur, 0x3C, rail, 1)
        ecrire_rail(joueur, 0x68, rail, 1)
    return bytes(bloc + joueur)


def placer(sauvegarde, zone, x, hauteur, z, fichier=None, compteurs=None, drapeaux=None, rail=None, changement=False):
    """Rend une copie de la sauvegarde, le joueur à cette position, le CRC du bloc recalculé. Sans le fichier de la zone,
    ses personnages sont absents. `compteurs` et `drapeaux` (numéro : valeur) changent l'avancement de l'histoire. `rail`
    (ligne, clé, front, côté) remplace la position dans les zones à rails. `changement` : l'octet +0x14e du bloc 4 posé, la
    Location de +0x70 (type 3) reprise de la première ; le jeu passe par le changement de zone, et la section 1 tourne en
    modes 0 et 1 au lieu de 2 (essayé sur les zones 13, 53, 100 et 120) ; le joueur arrive alors à la porte."""
    if len(sauvegarde) != TAILLE or sauvegarde[PIED + 0x10:PIED + 0x14] != b'FEEB':
        raise ValueError("pas une sauvegarde de Pokémon X (taille ou signature)")
    copie = bytearray(sauvegarde)
    ancien = bytes(copie[PERSONNAGES[1]:PERSONNAGES[1] + PERSONNAGES[2]])
    copie[PERSONNAGES[1]:PERSONNAGES[1] + PERSONNAGES[2]] = bytes(PERSONNAGES[2])
    if fichier:
        # le joueur porte le numéro 0xff dans l'ancien bloc
        joueur = next((ancien[i:i + ENREGISTREMENT] for i in range(0, len(ancien), ENREGISTREMENT) if ancien[i + 4] == 0xFF), None)
        if joueur:
            nouveau = enregistrements(joueur, fichier, zone, x, hauteur, z, rail)
            copie[PERSONNAGES[1]:PERSONNAGES[1] + len(nouveau)] = nouveau
    debut = SITUATION[1]
    for champ in (debut + 2, debut + 0xF4):
        struct.pack_into('<H', copie, champ, zone)
    for champ in (debut + 0x10, debut + 0x104):
        struct.pack_into('<fff', copie, champ, x, hauteur, z)
    if rail:
        for champ in (debut + 0xC, debut + 0x100):
            ecrire_rail(copie, champ, rail, CASE)
    if changement:
        copie[debut + 0x14E] = 1
        copie[debut + 0x70:debut + 0xA8] = struct.pack('<H', 3) + copie[debut + 2:debut + 0x38]
    for numero, valeur in (compteurs or {}).items():
        struct.pack_into('<H', copie, COMPTEURS + (numero - PREMIER_COMPTEUR) * 2, valeur)
    for numero, valeur in (drapeaux or {}).items():
        octet, masque = DRAPEAUX + numero // 8, 1 << (numero % 8)
        copie[octet] = copie[octet] | masque if valeur else copie[octet] & ~masque
    for numero, debut, longueur in (SITUATION, PERSONNAGES, AVANCEMENT):
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


def personnages(fichier):
    """Les personnages d'un fichier de zone qui ont un script : (numéro du script, case X, case Z, hauteur, drapeau à +8).
    0 et 2000 : aucun script. La hauteur, flottante, est à +0x2C (36 sur la zone de référence, comme ses sorties).
    Sur un rail (+0x24 vaut 1), voir `personnages_rail` : les cases rendues ici n'y veulent rien dire."""
    donnees = lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    if donnees[:2] != b'ZO':
        return []
    debut, fin = struct.unpack_from('<II', donnees, 8)
    entites = donnees[debut:fin]
    meubles, nombre = entites[4:6]
    rendu = []
    for i in range(nombre):
        p = 0xC + meubles * 0x14 + i * 0x30
        script, = struct.unpack_from('<H', entites, p + 0xA)
        if script not in (0, 2000):
            rendu.append((script, *struct.unpack_from('<HHf', entites, p + 0x28), struct.unpack_from('<H', entites, p + 8)[0]))
    return rendu


def personnages_rail(fichier):
    """Les personnages sur rail d'un fichier de zone qui ont un script : (script, ligne, clé, front, côté). +0x28 ligne (son
    hachage), +0x2C front s16, +0x2E côté s8, +0x2F clé (0x3be594, 0x3d909c)."""
    donnees = lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    if donnees[:2] != b'ZO':
        return []
    debut, fin = struct.unpack_from('<II', donnees, 8)
    entites = donnees[debut:fin]
    meubles, nombre = entites[4:6]
    rendu = []
    for i in range(nombre):
        p = 0xC + meubles * 0x14 + i * 0x30
        script, = struct.unpack_from('<H', entites, p + 0xA)
        if script not in (0, 2000) and entites[p + 0x24] == 1:
            ligne, front, cote, cle = struct.unpack_from('<IhbB', entites, p + 0x28)
            rendu.append((script, ligne, cle, front, cote))
    return rendu


def scenes(fichier):
    """Les scènes d'entrée d'un fichier de zone : (script, compteur, valeur). Le jeu lit jusqu'à 8 triplets par la publique
    GetSceneChangeData de la section 2, qui donne l'adresse de sa table (0x3df818), et lance le script quand le compteur vaut
    cette valeur (0x3df9dc). Les compteurs hors de 0x4000.. sont ce qui suit la table."""
    donnees = lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    if donnees[:2] != b'ZO':
        return []
    sections = struct.unpack_from('<%dI' % (donnees[2] + 1), donnees, 4)
    a = amx.Amx(donnees[sections[2]:sections[3]])
    rendu = []
    for adresse, h in a.fonctions_publiques():
        if h == SCENES:
            table = a.mot(adresse + 4) >> 16
            for i in range(0, min(24, (len(a.donnees) - table) // 4 - 2), 3):
                triplet = struct.unpack_from('<III', a.donnees, table + i * 4)
                if not PREMIER_COMPTEUR <= triplet[1] <= DERNIER_COMPTEUR:
                    break
                rendu.append(triplet)
    return rendu


def objets(fichier):
    """Les meubles et les déclencheurs d'un fichier de zone qui ont un script : (numéro du script, case X, case Z, profondeur
    en cases, hauteur). Les champs sont lus sur les données : un meuble (liste 0, 0x14 octets) porte le script à +0, sa case à
    +8, sa taille à +0xC, sa hauteur à +0x10 ; un déclencheur (listes 3 et 4, 0x18 octets), les mêmes à +0, +0xC, +0x10, +0x14."""
    donnees = lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    if donnees[:2] != b'ZO':
        return []
    debut, fin = struct.unpack_from('<II', donnees, 8)
    entites = donnees[debut:fin]
    meubles, nombre, nombre_sorties, premiers, seconds = entites[4:9]
    rendu = []
    declencheurs = 0xC + meubles * 0x14 + nombre * 0x30 + nombre_sorties * 0x18
    places = [(0xC + i * 0x14, 8) for i in range(meubles)] + [(declencheurs + i * 0x18, 0xC) for i in range(premiers + seconds)]
    for p, champ in places:
        script, = struct.unpack_from('<H', entites, p)
        x, z, _, profondeur = struct.unpack_from('<HHHH', entites, p + champ)
        hauteur, = struct.unpack_from('<i', entites, p + champ + 8)
        if script not in (0, 2000):
            rendu.append((script, x, z, profondeur, hauteur))
    return rendu


def declencheurs(fichier):
    """Les déclencheurs de la liste 3 gardés par un compteur : (script, case X, case Z, profondeur, hauteur, compteur, valeur).
    +2 valeur, +4 compteur : relevé sur les données (de ceux dont le compteur a une autre valeur dans la sauvegarde, 113 restent
    muets et 21 répondent ; à valeur égale, 47 et 59), le code n'est pas lu."""
    donnees = lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    if donnees[:2] != b'ZO':
        return []
    debut, fin = struct.unpack_from('<II', donnees, 8)
    entites = donnees[debut:fin]
    meubles, nombre, nombre_sorties, premiers = entites[4:8]
    rendu = []
    for i in range(premiers):
        p = 0xC + meubles * 0x14 + nombre * 0x30 + nombre_sorties * 0x18 + i * 0x18
        script, valeur, compteur = struct.unpack_from('<HHH', entites, p)
        x, z, _, profondeur = struct.unpack_from('<HHHH', entites, p + 0xC)
        hauteur, = struct.unpack_from('<i', entites, p + 0x14)
        if script not in (0, 2000) and PREMIER_COMPTEUR <= compteur <= DERNIER_COMPTEUR:
            rendu.append((script, x, z, profondeur, hauteur, compteur, valeur))
    return rendu


def preter(fichier, indice, script):
    """Le fichier de zone décompressé, le personnage `indice` portant le script `script` : le bloc 10 que `placer` en tire
    le lance quand on lui parle, pour essayer un script qu'aucune entité ne désigne."""
    donnees = bytearray(lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier)
    debut, _ = struct.unpack_from('<II', donnees, 8)
    meubles, nombre = donnees[debut + 4:debut + 6]
    if indice >= nombre:
        raise IndexError(f'la zone a {nombre} personnages')
    struct.pack_into('<H', donnees, debut + 0xC + meubles * 0x14 + indice * 0x30 + 0xA, script)
    return bytes(donnees)


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
    change = placer(bytes(sauvegarde), 53, 8811, 36, 10611, changement=True)
    assert change[0x154E] == 1 and change[0x1470:0x1474] == b'\x03\x00\x35\x00' and change[0x1474:0x14A8] == change[0x1404:0x1438]
    assert struct.unpack_from('<H', change, PIED + 0x14 + 4 * 8 + 6) == (crc16(change[0x1400:0x1550]),)
    sauvegarde[0x2000] = 3
    assert placer(bytes(sauvegarde), 53, 0, 0, 0)[0x2000:0x4100] == bytes(0x2100), 'les personnages sont vidés'
    try:
        placer(bytes(10), 1, 0, 0, 0)
    except ValueError:
        pass
    else:
        raise AssertionError('un fichier de mauvaise taille est refusé')
    # le joueur repris, les personnages refaits : le jeu les retrouve dans la zone, à leur place
    sauvegarde[0x2000:0x2108] = bytes(4) + b'\xff' + bytes(0x103)
    fichier = bytearray(b'ZO\x00\x00' + bytes(12))
    struct.pack_into('<II', fichier, 8, 16, 16 + 0xC + 0x30)
    fichier += bytes(0xC) + bytes(0x30)
    fichier[16 + 5] = 1
    struct.pack_into('<H', fichier, 16 + 0xC + 0xA, 77)
    struct.pack_into('<HHf', fichier, 16 + 0xC + 0x28, 7, 8, 36.0)
    rendu = placer(bytes(sauvegarde), 53, 18, 36, 90, bytes(fichier))
    assert struct.unpack_from('<IHH', rendu, 0x2000) == (0x08010003, 0, 53) and struct.unpack_from('<H', rendu, 0x2010) == (77,)
    assert placer(bytes(sauvegarde), 53, 18, 36, 90, preter(bytes(fichier), 0, 4321))[0x2010:0x2012] == struct.pack('<H', 4321)
    assert personnages(preter(bytes(fichier), 0, 4321))[0][0] == 4321
    assert struct.unpack_from('<fff', rendu, 0x2040) == (7, 2, 8) == struct.unpack_from('<fff', rendu, 0x206C)
    assert rendu[0x2108 + 4] == 0xFF and struct.unpack_from('<H', rendu, 0x2108 + 6) == (53,)
    assert struct.unpack_from('<fff', rendu, 0x2108 + 0x40) == (1, 2, 5)
    # un personnage sur rail : le joueur à côté de lui, les deux aux deux places de chaque bloc
    fichier = bytearray(b'ZO\x00\x00' + bytes(12))
    struct.pack_into('<II', fichier, 8, 16, 16 + 0xC + 0x30)
    fichier += bytes(0xC) + bytes(0x30)
    fichier[16 + 5] = 1
    struct.pack_into('<H', fichier, 16 + 0xC + 0xA, 12)
    fichier[16 + 0xC + 0x24] = 1
    struct.pack_into('<IhbB', fichier, 16 + 0xC + 0x28, 0x305AC3B, 3, -8, 1)
    assert personnages_rail(bytes(fichier)) == [(12, 0x305AC3B, 1, 3, -8)]
    rendu = placer(bytes(sauvegarde), 63, 0, 0, 0, bytes(fichier), rail=(0x305AC3B, 1, 4, -8))
    assert struct.unpack_from('<HxxIIff', rendu, 0x2000 + 0x3C) == (1, 0x305AC3B, 1, 3, -8)
    assert struct.unpack_from('<HxxIIff', rendu, 0x2108 + 0x68) == (1, 0x305AC3B, 1, 4, -8)
    assert struct.unpack_from('<HxxIIff', rendu, 0x1400 + 0xC) == (1, 0x305AC3B, 1, 72, -144) == struct.unpack_from('<HxxIIff', rendu, 0x1400 + 0x100)
    # l'avancement : un compteur, un drapeau, le CRC de leur bloc
    rendu = placer(bytes(sauvegarde), 53, 0, 0, 0, compteurs={0x4001: 7}, drapeaux={9: 1})
    assert struct.unpack_from('<H', rendu, COMPTEURS + 2) == (7,) and rendu[DRAPEAUX + 1] == 2
    assert struct.unpack_from('<H', rendu, PIED + 0x14 + 19 * 8 + 6) == (crc16(rendu[0x14A00:0x14A00 + 0x504]),)
    assert placer(rendu, 53, 0, 0, 0, drapeaux={9: 0})[DRAPEAUX + 1] == 0
    # une table de scènes : deux triplets, puis ce qui suit la table
    code = struct.pack('<II', 0x2E, 0xAC | 8 << 16)
    table = struct.pack('<8I', 0, 0, 5, 0x4072, 1, 14, 0x4072, 5) + struct.pack('<3I', 3, 0x23, 34)
    t = 0x38 + 8
    tete = struct.pack('<IHBBHHIIIIiIIIIII', t + len(code) + len(table), 0xF1E0, 10, 10, 0, 8, t, t + len(code), t + len(code) + len(table), 0, -1, 0x38, t, t, t, t, t)
    script = tete + struct.pack('<II', 0, SCENES) + code + table
    zo = b'ZO\x03\x00' + struct.pack('<IIII', 0x14, 0x14, 0x14, 0x14 + len(script)) + script
    assert scenes(zo) == [(5, 0x4072, 1), (14, 0x4072, 5)], scenes(zo)
    # les meubles et les déclencheurs : un de chaque, le reste sans script
    fabrique = bytearray(0xC + 2 * 0x14 + 2 * 0x18)
    fabrique[4:9] = bytes([2, 0, 0, 1, 1])
    struct.pack_into('<H', fabrique, 0xC, 7)
    struct.pack_into('<HHHHi', fabrique, 0xC + 8, 10, 20, 2, 3, 36)
    struct.pack_into('<H', fabrique, 0xC + 0x28, 9)
    struct.pack_into('<HHHHi', fabrique, 0xC + 0x28 + 0xC, 30, 40, 4, 5, -18)
    struct.pack_into('<H', fabrique, 0xC + 0x28 + 0x18, 2000)
    fabrique = b'ZO\x02\x00' + struct.pack('<III', 0x10, 0x10, 0x10 + len(fabrique)) + bytes(fabrique)
    assert objets(fabrique) == [(7, 10, 20, 3, 36), (9, 30, 40, 5, -18)]
    garde = bytearray(fabrique)
    struct.pack_into('<HH', garde, 0x10 + 0xC + 0x28 + 2, 4, 0x407C)
    assert declencheurs(bytes(garde)) == [(9, 30, 40, 5, -18, 0x407C, 4)]
    # une zone fabriquée : un meuble, un personnage, deux sorties
    entites = bytearray(0xC + 0x14 + 0x30 + 2 * 0x18)
    entites[4:7] = bytes([1, 1, 2])
    p = 0xC + 0x14 + 0x30
    struct.pack_into('<HHf', entites, 0xC + 0x14 + 0x28, 7, 8, 36.0)
    struct.pack_into('<H', entites, 0xC + 0x14 + 0xA, 1234)
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
