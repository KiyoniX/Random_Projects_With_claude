"""Le mod de la jauge de PV : la barre (verte, jaune ou rouge) remplit tout l'encadrement des plaques redessinées
(`pack_dessins.py`), passe derrière le cadre (dont l'anneau arrondit son bout), sur un fond sombre.

Les plaques du combat sont dans les mises en page CLYT de `a/0/0/4` (`btl_up01`, `02`, `03`, `05` : simple, double, triple et
une quatrième), rangées dans un DARC à 0x5000 derrière une table de noms. Dans chaque plaque, la barre est une image de
48 x 4 ancrée au milieu de son bord gauche (origine 3), sœur de l'image de la plaque (128 x 32, origine 4) qui la précède.
Le code du jeu pose la largeur de la barre (48 x la part de PV restante : 48 points mesurés à PV pleins avec une case de 49)
mais pas son échelle. Pour chaque barre :
- 8 de haut, un point plus à gauche, échelle horizontale LONGUEUR / 48 : de la fin de la pastille « PV » au bout arrondi ;
- dessinée avant la plaque (l'ordre des sœurs est l'ordre du dessin), dont la fente est transparente ;
- la plaque n'affiche que les 32 premières lignes de sa texture (la redessinée en a 40) ;
- précédée d'une copie fixe d'elle-même (nom suivi de « f »), avec le matériau de la plaque et des coordonnées de texture
  sur le dégradé sombre que `pack_dessins.py` pose dans un coin vide de la texture : le fond de la partie vide.

Une case CLYT : en-tête de section (8 octets), drapeaux, origine, alpha, octet, nom (0x10), données (8), dix flottants
(position x y z, rotation x y z, échelle x y, taille l h) ; une image (pic1) ajoute quatre couleurs de sommet, son matériau
(u16), le nombre de jeux de coordonnées (u16) et ces jeux (4 x 2 flottants). Les enfants d'une case suivent entre pas1 et
pae1 (les groupes entre grs1 et gre1).

    python outils/mod_jauge.py [DOSSIER]
    python outils/mod_jauge.py test
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import garc
import pack_dessins
import tournee

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(RACINE, 'local', 'extrait', 'romfs', 'a', '0', '0', '4')
SORTIE = os.path.join(RACINE, 'local', 'mods-build', 'jauge-hd')
LONGUEUR = pack_dessins.LONGUEUR
DARC = 0x5000
OUVRE, FERME = (b'pas1', b'grs1'), (b'pae1', b'gre1')


def sections(clyt):
    """Les sections d'un CLYT (octets de chacune)."""
    p, out = struct.unpack_from('<H', clyt, 6)[0], []
    for _ in range(struct.unpack_from('<I', clyt, 0x10)[0]):
        taille = struct.unpack_from('<I', clyt, p + 4)[0]
        out.append(bytes(clyt[p:p + taille]))
        p += taille
    return out


def arbre(secs, i=0):
    """Les sœurs à partir de `secs[i]` jusqu'à leur pae1/gre1 : [section, ouverture, enfants, fermeture] ; rend (sœurs, i)."""
    soeurs = []
    while i < len(secs):
        s = secs[i]
        if s[:4] in FERME:
            return soeurs, i
        if s[:4] in OUVRE:
            enfants, i = arbre(secs, i + 1)
            soeurs[-1][1:] = [s, enfants, secs[i] if i < len(secs) else b'']
        else:
            soeurs.append([s, None, None, None])
        i += 1
    return soeurs, i


def aplatir(soeurs):
    out = []
    for s, ouvre, enfants, ferme in soeurs:
        out.append(s)
        if ouvre is not None:
            out += [ouvre] + aplatir(enfants) + [ferme]
    return out


def image(s, origine, taille):
    return s[:4] == b'pic1' and s[9] == origine and struct.unpack_from('<2f', s, 0x44) == taille


def ranger(soeurs):
    """Dans ces sœurs et leurs descendants, chaque barre avant sa plaque, sur son fond ; rend le nombre de barres."""
    faites = sum(ranger(n[2]) for n in soeurs if n[2])
    plaques = [i for i, n in enumerate(soeurs) if image(n[0], 4, (128.0, 32.0))]
    barres = [i for i, n in enumerate(soeurs) if image(n[0], 3, (48.0, 4.0))]
    if not plaques or not barres:
        return faites
    plaque, (barre,) = soeurs[plaques[0]][0], barres
    s = bytearray(soeurs[barre][0])
    x = struct.unpack_from('<f', s, 0x24)[0] - 1
    struct.pack_into('<f', s, 0x24, x)
    struct.pack_into('<f', s, 0x3C, LONGUEUR / 48)
    struct.pack_into('<2f', s, 0x44, 48.0, 8.0)
    # la colonne de la texture où commence la barre dit quelle plaque c'est (et où est son fond)
    fente = round(x - (struct.unpack_from('<f', plaque, 0x24)[0] - 64))
    dessin = next(c for c in pack_dessins.PLAQUES.values() if c['fente'] == fente)
    fond = dessin['fond']
    x += dessin['decale']
    struct.pack_into('<f', s, 0x24, x)
    copie = bytearray(s)
    copie[0xC:0x1C] = (bytes(s[0xC:0x1C]).split(b'\0')[0] + b'f').ljust(0x10, b'\0')
    struct.pack_into('<4I', copie, 0x4C, *[0xFFFFFFFF] * 4)
    struct.pack_into('<H', copie, 0x5C, struct.unpack_from('<H', plaque, 0x5C)[0])
    x0, y0, x1, y1 = fond
    # le milieu des points du bord : le lissage ne prend rien autour
    h = pack_dessins.HAUTEUR
    u0, u1, v0, v1 = (x0 + 0.5) / 128, (x1 - 0.5) / 128, (y0 + 0.5) / h, (y1 - 0.5) / h
    struct.pack_into('<8f', copie, 0x60, u0, v0, u1, v0, u0, v1, u1, v1)
    # la plaque n'affiche que ses 32 lignes : la texture redessinée en a 8 de plus pour le fond
    plaque = bytearray(plaque)
    struct.pack_into('<8f', plaque, 0x60, 0, 0, 1, 0, 0, 32 / h, 1, 32 / h)
    soeurs[plaques[0]][0] = plaque = bytes(plaque)
    noeud = soeurs.pop(barre)
    noeud[0] = bytes(s)
    i = next(i for i, n in enumerate(soeurs) if n[0] is plaque)
    soeurs[i:i] = [[bytes(copie), None, None, None], noeud]
    return faites + 1


def clyt_neuf(clyt):
    """Le CLYT réarrangé ; rend (octets, nombre de barres)."""
    soeurs, _ = arbre(sections(clyt))
    faites = ranger(soeurs)
    secs = aplatir(soeurs)
    tete = bytearray(clyt[:struct.unpack_from('<H', clyt, 6)[0]])
    corps = b''.join(secs)
    struct.pack_into('<I', tete, 0xC, len(tete) + len(corps))
    struct.pack_into('<I', tete, 0x10, len(secs))
    return bytes(tete) + corps, faites


def darc_neuf(darc, changer):
    """Le DARC, chaque fichier passé par `changer(nom, octets) -> octets` ; les suivants décalés d'un multiple de 0x80
    (l'alignement des images)."""
    table, taille_table, debut = struct.unpack_from('<III', darc, 0x10)
    n = struct.unpack_from('<I', darc, table + 8)[0]
    noms = table + 12 * n
    entrees = [list(struct.unpack_from('<III', darc, table + 12 * i)) for i in range(n)]
    nom = lambda o: darc[noms + o:noms + o + 256].decode('utf-16-le', 'replace').split('\0')[0]
    neuf = bytearray(darc[:debut])
    decalage = 0
    for i in sorted((i for i, e in enumerate(entrees) if not e[0] >> 24), key=lambda i: entrees[i][1]):
        o, taille = entrees[i][1], entrees[i][2]
        octets = changer(nom(entrees[i][0] & 0xFFFFFF), bytes(darc[o:o + taille]))
        neuf += bytes(o + decalage - len(neuf))
        neuf += octets
        entrees[i][1:] = [o + decalage, len(octets)]
        if len(octets) > taille:
            decalage += -(-(len(octets) - taille) // 0x80) * 0x80
    for i, e in enumerate(entrees):
        struct.pack_into('<III', neuf, table + 12 * i, *e)
    struct.pack_into('<I', neuf, 0xC, len(neuf))
    return bytes(neuf)


def agrandir(donnees):
    """Les octets de `a/0/0/4` (un GARC d'un fichier : table de noms, DARC à 0x5000), barres réarrangées ; rend
    (octets, nombre de barres)."""
    _, fichiers = garc.lire(donnees)
    tout = fichiers[0][0]
    faites = 0

    def changer(nom, octets):
        nonlocal faites
        if not nom.endswith('.bclyt'):
            return octets
        octets, n = clyt_neuf(octets)
        faites += n
        return octets
    return garc.ecrire([[tout[:DARC] + darc_neuf(tout[DARC:], changer)]] + fichiers[1:]), faites


def section(nature, corps):
    return nature + struct.pack('<I', 8 + len(corps)) + corps


def pic(nom, origine, x, taille, matiere):
    corps = bytes([1, origine, 255, 0]) + nom.ljust(0x10, b'\0') + bytes(8)
    corps += struct.pack('<10f', x, 1.0, 0, 0, 0, 0, 1, 1, *taille) + struct.pack('<4IHH', *[0xFF969696] * 4, matiere, 1)
    return section(b'pic1', corps + struct.pack('<8f', 0, 0, 1, 0, 0, 1, 1, 1))


def clyt_fabrique():
    """Une plaque comme celle de l'adversaire en simple : la plaque (128 x 32 au centre 13), sa marque, la barre (48 x 4 à
    gauche en 2), le texte ; dans une case racine."""
    secs = [section(b'lyt1', bytes(12)), pic(b'Root', 4, 0, (400.0, 240.0), 9), section(b'pas1', b''),
            pic(b'1z', 4, 13.0, (128.0, 32.0), 0), pic(b'2q', 4, 28.0, (16.0, 16.0), 13), pic(b'21', 3, 2.0, (48.0, 4.0), 1),
            pic(b'25', 5, 65.0, (30.0, 16.0), 3), section(b'pae1', b'')]
    corps = b''.join(secs)
    return b'CLYT' + struct.pack('<HHIII', 0xFEFF, 0x14, 0x02020000, 0x14 + len(corps), len(secs)) + corps


def test():
    neuf, faites = clyt_neuf(clyt_fabrique())
    assert faites == 1
    noms = [s[0xC:0x1C].split(b'\0')[0] for s in sections(neuf) if s[:4] == b'pic1']
    assert noms == [b'Root', b'21f', b'21', b'1z', b'2q', b'25'], f'le fond, la barre, puis la plaque : {noms}'
    secs = {s[0xC:0x1C].split(b'\0')[0]: s for s in sections(neuf) if s[:4] == b'pic1'}
    barre, fond = secs[b'21'], secs[b'21f']
    # un point à gauche, puis 4 de plus : la fente redessinée de cette plaque est ramenée (`decale`)
    assert struct.unpack_from('<f', barre, 0x24)[0] == -3.0 and struct.unpack_from('<2f', barre, 0x44) == (48.0, 8.0)
    assert abs(struct.unpack_from('<f', barre, 0x3C)[0] - LONGUEUR / 48) < 1e-6, 'échelle horizontale'
    assert struct.unpack_from('<H', fond, 0x5C)[0] == 0, 'le matériau de la plaque'
    x0, y0, x1, y1 = pack_dessins.PLAQUES[0x5ea935f9]['fond']
    assert abs(struct.unpack_from('<f', fond, 0x60)[0] - (x0 + 0.5) / 128) < 1e-6, 'coordonnées sur le fond sombre'
    assert struct.unpack_from('<I', neuf, 0x10)[0] == len(sections(neuf)) == 9
    assert abs(struct.unpack_from('<8f', secs[b'1z'], 0x60)[5] - 32 / pack_dessins.HAUTEUR) < 1e-6, 'la plaque cache le fond'
    # un DARC de deux fichiers : le premier grandit, le second (aligné sur 0x80) suit de 0x80 plus loin
    noms = 'a.bclyt\0b.bclim\0'.encode('utf-16-le')
    table = struct.pack('<III', 0x01000000, 0, 3) + struct.pack('<III', 0, 0x80, 4) + struct.pack('<III', 16, 0x100, 4)
    darc = bytearray(b'darc' + struct.pack('<HHIIIII', 0xFEFF, 0x1C, 0x01000000, 0, 0x1C, 36 + len(noms), 0x80))
    darc += table + noms
    darc += bytes(0x80 - len(darc)) + b'AAAA' + bytes(0x7C) + b'BBBB'
    sortie = darc_neuf(bytes(darc), lambda nom, o: o * 0x11 if nom == 'a.bclyt' else o)
    assert sortie[0x180:0x184] == b'BBBB' and struct.unpack_from('<III', sortie, 0x1C + 24)[1] == 0x180
    assert struct.unpack_from('<I', sortie, 0xC)[0] == len(sortie)
    print('mod_jauge : ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['test']:
        test()
    else:
        dossier = sys.argv[1] if len(sys.argv) > 1 else SORTIE
        octets, faites = agrandir(open(SOURCE, 'rb').read())
        print(faites, 'barres ;', tournee.mod_fichiers(dossier, {'a/0/0/4': octets}))
