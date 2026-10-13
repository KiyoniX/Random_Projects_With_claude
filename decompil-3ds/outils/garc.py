"""Conteneurs GARC des jeux Pokémon sur 3DS (X/Y en version 4, ORAS et Soleil/Lune en version 6).

Un GARC empile des fichiers numérotés ; chaque numéro peut contenir jusqu'à 32 sous-fichiers,
annoncés par un vecteur de bits. Structure, d'après le code de pk3DS :

    GARC   en-tête : magic, longueur d'en-tête (0x1C en v4, 0x24 en v6), BOM 0xFEFF, version,
           nombre de sections (4), début des données, taille du fichier, plus gros fichier
           (v6 : paddé, non paddé, puis l'alignement)
    FATO   une entrée par numéro : décalage vers son entrée FATB
    FATB   par numéro : vecteur de 32 bits, puis pour chaque bit levé (début, fin, longueur)
    FIMB   les données, chaque fichier aligné sur 4 octets avec du 0xFF

Les magics sont écrits à l'envers sur le disque (« CRAG », « OTAF », « BTAF », « BMIF »).

    python garc.py lister fichier.garc
    python garc.py extraire fichier.garc dossier/
    python garc.py test
"""
import os
import struct
import sys

MAGIC_GARC, MAGIC_FATO, MAGIC_FATB, MAGIC_FIMB = 0x47415243, 0x4641544F, 0x46415442, 0x46494D42


def lire(donnees):
    """Rend (version, entrees) où entrees est une liste de listes de bytes (une liste par numéro, un bytes par sous-fichier)."""
    if len(donnees) < 0x1C or struct.unpack_from('<I', donnees, 0)[0] != MAGIC_GARC:
        raise ValueError('pas un GARC (magic absent)')
    longueur_entete, bom, version, sections, debut_donnees, taille = struct.unpack_from('<IHHIII', donnees, 4)
    if bom != 0xFEFF:
        raise ValueError('marque d\'ordre des octets inattendue : %#x' % bom)
    if version not in (0x0400, 0x0600):
        raise ValueError('version GARC inconnue : %#x' % version)
    if sections != 4:
        raise ValueError('%d sections au lieu de 4' % sections)
    pos = longueur_entete
    magic, taille_fato, nb_entrees, _ = struct.unpack_from('<IIHH', donnees, pos)
    if magic != MAGIC_FATO:
        raise ValueError('FATO attendu à %#x' % pos)
    decalages = struct.unpack_from('<%dI' % nb_entrees, donnees, pos + 0xC)
    pos += taille_fato
    magic, taille_fatb, nb_fichiers = struct.unpack_from('<III', donnees, pos)
    if magic != MAGIC_FATB:
        raise ValueError('FATB attendu à %#x' % pos)
    base_fatb = pos + 0xC
    pos_fimb = pos + taille_fatb
    magic, _, taille_donnees = struct.unpack_from('<III', donnees, pos_fimb)
    if magic != MAGIC_FIMB:
        raise ValueError('FIMB attendu à %#x' % pos_fimb)
    entrees = []
    for d in decalages:
        p = base_fatb + d
        vecteur = struct.unpack_from('<I', donnees, p)[0]
        p += 4
        sous = []
        for bit in range(32):
            if vecteur >> bit & 1:
                debut, fin, longueur = struct.unpack_from('<III', donnees, p)
                p += 12
                sous.append(bytes(donnees[debut_donnees + debut:debut_donnees + debut + longueur]))
        entrees.append(sous)
    return version, entrees


def ecrire(entrees, version=0x0400, alignement=4):
    """Fabrique un GARC à partir d'une liste de listes de bytes. Un numéro sans sous-fichier donne un vecteur nul."""
    fatb = bytearray()
    decalages = []
    fimb = bytearray()
    plus_gros = plus_gros_padde = 0
    for sous in entrees:
        decalages.append(len(fatb))
        vecteur = sum(1 << i for i in range(len(sous)))
        fatb += struct.pack('<I', vecteur)
        for f in sous:
            debut = len(fimb)
            fimb += f
            reste = (-len(fimb)) % alignement
            fimb += b'\xFF' * reste
            fatb += struct.pack('<III', debut, len(fimb), len(f))
            plus_gros = max(plus_gros, len(f))
            plus_gros_padde = max(plus_gros_padde, len(f) + reste)
    fato = struct.pack('<IIHH', MAGIC_FATO, 0xC + 4 * len(decalages), len(decalages), 0xFFFF) + struct.pack('<%dI' % len(decalages), *decalages)
    bloc_fatb = struct.pack('<III', MAGIC_FATB, 0xC + len(fatb), sum(len(s) for s in entrees)) + fatb
    bloc_fimb = struct.pack('<III', MAGIC_FIMB, 0xC, len(fimb))
    longueur_entete = 0x24 if version == 0x0600 else 0x1C
    debut_donnees = longueur_entete + len(fato) + len(bloc_fatb) + len(bloc_fimb)
    taille = debut_donnees + len(fimb)
    entete = struct.pack('<IIHHIII', MAGIC_GARC, longueur_entete, 0xFEFF, version, 4, debut_donnees, taille)
    if version == 0x0600:
        entete += struct.pack('<III', plus_gros_padde, plus_gros, alignement)
    else:
        entete += struct.pack('<I', plus_gros)
    return bytes(entete + fato + bloc_fatb + bloc_fimb + fimb)


def nature(f):
    """Une description courte d'un sous-fichier : compressé, magic lisible, ou taille."""
    if f[:1] in (b'\x10', b'\x11') and len(f) >= 4:
        return 'LZ%s, %d octets décompressés' % ('10' if f[0] == 0x10 else '11', f[1] | f[2] << 8 | f[3] << 16)
    tete = f[:4]
    if len(tete) == 4 and all(32 <= c < 127 for c in tete):
        return 'magic « %s »' % tete.decode('ascii')
    return '%d octets' % len(f)


def test():
    jeux = [
        [],
        [[b'']],
        [[b'un'], [b'deux', b'trois'], [], [b'\x00' * 7, b'x' * 13, b'y']],
        [[bytes(range(256))] * 5],
    ]
    for version in (0x0400, 0x0600):
        for e in jeux:
            g = ecrire(e, version)
            v, lu = lire(g)
            assert v == version and lu == e, 'aller-retour GARC raté (version %#x)' % version
    print('garc : %d aller-retours réussis en v4 et v6.' % (2 * len(jeux)))


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['test']:
        test()
    elif len(args) >= 2 and args[0] in ('lister', 'extraire'):
        with open(args[1], 'rb') as fh:
            version, entrees = lire(fh.read())
        print('GARC version %d, %d numéros' % (version >> 8, len(entrees)))
        for i, sous in enumerate(entrees):
            for j, f in enumerate(sous):
                print('  %4d.%-2d  %s' % (i, j, nature(f)))
                if args[0] == 'extraire':
                    dossier = args[2] if len(args) > 2 else os.path.splitext(args[1])[0]
                    os.makedirs(dossier, exist_ok=True)
                    with open(os.path.join(dossier, '%04d.%02d.bin' % (i, j)), 'wb') as out:
                        out.write(f)
    else:
        print(__doc__)
