"""Dit ce qu'est un dump de cartouche 3DS (.3ds, image NCSD) sans aucun outil extérieur.

Lit la table des partitions NCSD, puis l'en-tête NCCH de la première partition : identifiant
de titre, code produit, taille, et surtout si le contenu est déchiffré, ce qu'il faut pour
l'extraire. Calcule aussi l'empreinte SHA-256, à recopier dans le journal.

    python inspecter.py local/dump/pokemon-x.3ds
    python inspecter.py test
"""
import hashlib
import os
import struct
import sys

UNITE = 0x200   # les tailles et décalages NCSD/NCCH sont en unités de 512 octets


def inspecter(chemin, empreinte=True):
    with open(chemin, 'rb') as f:
        tete = f.read(0x4000)
        if tete[0x100:0x104] != b'NCSD':
            raise ValueError('pas une image NCSD : magic « %r » à 0x100' % tete[0x100:0x104])
        taille_media = struct.unpack_from('<I', tete, 0x104)[0] * UNITE
        partitions = [struct.unpack_from('<II', tete, 0x120 + 8 * i) for i in range(8)]
        decalage, taille = partitions[0]
        if taille == 0:
            raise ValueError('première partition vide')
        f.seek(decalage * UNITE)
        ncch = f.read(0x200)
        if ncch[0x100:0x104] != b'NCCH':
            raise ValueError('pas de NCCH à la partition 0')
        titre = struct.unpack_from('<Q', ncch, 0x108)[0]
        produit = ncch[0x150:0x160].rstrip(b'\x00').decode('ascii', 'replace')
        drapeaux = ncch[0x188:0x190]
        plateforme = {1: 'CTR (3DS)', 2: 'SNAKE (New 3DS)'}.get(drapeaux[4], 'inconnue (%d)' % drapeaux[4])
        dechiffre = bool(drapeaux[7] & 0x04)
        cle_fixe = bool(drapeaux[7] & 0x01)
        sans_romfs = bool(drapeaux[7] & 0x02)
        exefs_dec, exefs_taille = struct.unpack_from('<II', ncch, 0x1A0)
        romfs_dec, romfs_taille = struct.unpack_from('<II', ncch, 0x1B0)
        f.seek(0, os.SEEK_END)
        taille_fichier = f.tell()
    resultat = {
        'fichier': os.path.basename(chemin), 'taille_fichier': taille_fichier, 'taille_media': taille_media,
        'partitions': [(d * UNITE, t * UNITE) for d, t in partitions if t],
        'titre': '%016X' % titre, 'produit': produit, 'plateforme': plateforme,
        'dechiffre': dechiffre, 'cle_fixe': cle_fixe, 'exefs': exefs_taille * UNITE, 'romfs': 0 if sans_romfs else romfs_taille * UNITE,
    }
    if empreinte:
        h = hashlib.sha256()
        with open(chemin, 'rb') as f:
            for bloc in iter(lambda: f.read(1 << 20), b''):
                h.update(bloc)
        resultat['sha256'] = h.hexdigest()
    return resultat


def rapport(r):
    lignes = [
        'Fichier        %s (%.1f Mo, média annoncé %.1f Mo)' % (r['fichier'], r['taille_fichier'] / 1e6, r['taille_media'] / 1e6),
        'Partitions     %s' % ', '.join('%#x (%.1f Mo)' % (d, t / 1e6) for d, t in r['partitions']),
        'Titre          %s   code produit %s   plateforme %s' % (r['titre'], r['produit'] or '?', r['plateforme']),
        'Code (exefs)   %.1f Mo' % (r['exefs'] / 1e6),
        'Fichiers       %.1f Mo (romfs)' % (r['romfs'] / 1e6),
        'Chiffrement    %s' % ('déchiffré, prêt à extraire' if r['dechiffre'] else 'ENCORE CHIFFRÉ : repasser par GodMode9, « Decrypt file »' + (' (clé fixe)' if r['cle_fixe'] else '')),
    ]
    if 'sha256' in r:
        lignes.append('SHA-256        %s' % r['sha256'])
    return '\n'.join(lignes)


def fabriquer_image(dechiffre=True, produit=b'CTR-P-TEST'):
    """Une petite image NCSD factice, pour le test et pour s'exercer sans cartouche."""
    ncsd = bytearray(0x4000)
    ncsd[0x100:0x104] = b'NCSD'
    struct.pack_into('<I', ncsd, 0x104, 0x40)
    struct.pack_into('<II', ncsd, 0x120, 0x20, 0x20)   # partition 0 à 0x4000, 0x4000 octets
    ncch = bytearray(0x4000)
    ncch[0x100:0x104] = b'NCCH'
    struct.pack_into('<Q', ncch, 0x108, 0x0004000000055E00)
    ncch[0x150:0x150 + len(produit)] = produit
    ncch[0x188 + 4] = 1
    ncch[0x188 + 7] = 0x04 if dechiffre else 0x00
    struct.pack_into('<II', ncch, 0x1A0, 0x10, 0x8)
    struct.pack_into('<II', ncch, 0x1B0, 0x18, 0x8)
    return bytes(ncsd + ncch)


def test():
    import tempfile
    for dechiffre in (True, False):
        with tempfile.NamedTemporaryFile(suffix='.3ds', delete=False) as tmp:
            tmp.write(fabriquer_image(dechiffre))
        try:
            r = inspecter(tmp.name)
            assert r['titre'] == '0004000000055E00' and r['produit'] == 'CTR-P-TEST' and r['dechiffre'] == dechiffre
            assert r['partitions'] == [(0x4000, 0x4000)] and r['exefs'] == 0x1000 and r['romfs'] == 0x1000
        finally:
            os.unlink(tmp.name)
    print('inspecter : image factice lue, chiffrée et déchiffrée.')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['test']:
        test()
    elif len(args) == 1:
        print(rapport(inspecter(args[0])))
    else:
        print(__doc__)
