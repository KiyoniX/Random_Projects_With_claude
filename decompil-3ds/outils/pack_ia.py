"""Le pack HD : les textures relevées en jeu (`--extraire-textures`), agrandies par Real-ESRGAN, avec le pack de police par-dessus
(`local/analyse/rendu/upscale.md`, point 5).

Le moteur nomme chaque texture par le crc32 de ses octets en mémoire et un pack remplace `<crc32>.png` aux mêmes UV : un relevé
donne donc directement les noms. Chaque texture de 16 à 512 points de côté passe par le modèle `realesrgan-x4plus-anime`
(Real-ESRGAN, BSD-3, version ncnn-vulkan : `local/outils-tiers/realesrgan/`), 4 fois plus grande (2 fois au-delà de 256 points,
pour la mémoire de la carte graphique). Avant et après, les points transparents prennent la couleur de leurs voisins visibles :
sinon le modèle, puis le filtre bilinéaire du jeu, font un liseré sombre au bord des découpes.

Seules les textures dessinées sur l'écran du bas (l'interface) passent : le relevé les note dans `bas.txt`. Celles du haut
sont surtout des modèles et du décor, dont beaucoup sont des tables (ombrage, couleurs) que le modèle rendrait fausses
(Pokémon noirs, décor méconnaissable : essai du 4/11).

Les feuilles de police viennent de `pack_police.py` (le dessin des lettres reste celui du jeu) et ne passent pas par le modèle.
Les textures que le jeu redessine (noms du combat, écrits dans une texture) changent d'empreinte à chaque fois : relevées
quand même, elles ne servent pas. Les textures répétées (sols, murs) peuvent garder une couture au bord : le modèle les voit
seules.

Le pack dérive des fichiers du jeu : il s'écrit dans `local/` (par défaut `local/mods-build/textures/hd`, que le launcher
propose), jamais dans le dépôt.

    python outils/pack_ia.py RELEVÉ... [--sortie DOSSIER]
    python outils/pack_ia.py test
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_police

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.join(RACINE, 'local', 'mods-build', 'textures', 'hd')
ESRGAN = os.path.join(RACINE, 'local', 'outils-tiers', 'realesrgan', 'realesrgan-ncnn-vulkan.exe')
MODELE = 'realesrgan-x4plus-anime'
LOT = 200


def baver(rgba, tours):
    """Les points transparents prennent la moyenne de leurs voisins colorés, `tours` anneaux de suite ; l'alpha ne bouge pas."""
    rgba = rgba.copy()
    connu = rgba[:, :, 3] > 0
    if connu.all() or not connu.any():
        return rgba
    couleur = rgba[:, :, :3].astype(np.float32) * connu[:, :, None]
    for _ in range(tours):
        somme, nombre = np.zeros_like(couleur), np.zeros(connu.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            somme += np.roll(couleur, (dy, dx), (0, 1))
            nombre += np.roll(connu, (dy, dx), (0, 1))
        neuf = ~connu & (nombre > 0)
        if not neuf.any():
            break
        couleur[neuf] = somme[neuf] / nombre[neuf][:, None]
        connu = connu | neuf
    rgba[:, :, :3] = np.where(connu[:, :, None], couleur, rgba[:, :, :3]).round().astype(np.uint8)
    return rgba


def a_agrandir(chemin):
    """Une texture relevée qui vaut la peine : 8 à 512 points de côté, pas d'une seule couleur."""
    image = Image.open(chemin)
    if not all(16 <= c <= 512 for c in image.size):
        return False
    points = np.asarray(image.convert('RGBA')).reshape(-1, 4)
    return len(np.unique(points[::max(1, len(points) // 4096)], axis=0)) > 1


def esrgan(entree, sortie):
    """Real-ESRGAN sur chaque PNG du dossier `entree`, 4 fois plus grand, dans `sortie` (mêmes noms)."""
    subprocess.run([ESRGAN, '-i', entree, '-o', sortie, '-n', MODELE, '-s', '4', '-f', 'png'], check=True, capture_output=True,
                   cwd=os.path.dirname(ESRGAN))


def ressemble(original, grand):
    """Le résultat, ramené à la taille d'origine, a les couleurs de l'original sur ses points visibles (moins de 30 d'écart
    moyen ; un bon résultat en a moins de 12). Real-ESRGAN a déjà écrit une image sous le nom d'une autre dans un lot de
    4 639 (le bouton Sac devenu un morceau de décor)."""
    petit = np.asarray(grand.resize((original.shape[1], original.shape[0]), Image.BOX)).astype(np.float32)
    visible = original[:, :, 3] > 128
    if visible.sum() < 10:
        return True
    return float(np.abs(original[:, :, :3].astype(np.float32) - petit[:, :, :3])[visible].mean()) < 30


def pack(releves, sortie, polices, agrandir=esrgan):
    """Écrit dans `sortie` les feuilles de ces polices, puis les textures des relevés passées par `agrandir` ; rend le nombre de
    textures agrandies (celles déjà dans `sortie` ne sont pas refaites). Par lots de `LOT` ; un résultat qui ne ressemble pas à
    son original est refait seul, puis laissé au jeu s'il reste faux."""
    os.makedirs(sortie, exist_ok=True)
    pack_police.pack(polices, sortie)
    noms = {}
    for dossier in releves:
        bas = os.path.join(dossier, 'bas.txt')
        if not os.path.exists(bas):
            raise SystemExit(f"{dossier} : pas de bas.txt (relevé d'avant le tri par écran)")
        for nom in sorted({ligne.strip() + '.png' for ligne in open(bas)}):
            if os.path.exists(os.path.join(dossier, nom)) and nom not in noms and not os.path.exists(os.path.join(sortie, nom)):
                noms[nom] = os.path.join(dossier, nom)
    noms = {n: c for n, c in noms.items() if a_agrandir(c)}
    if not noms:
        return 0
    def lot(choisis):
        """Les résultats de `agrandir` sur ces noms : nom -> (original bavé, image agrandie ou None)."""
        with tempfile.TemporaryDirectory() as travail:
            entree, faites = os.path.join(travail, 'in'), os.path.join(travail, 'out')
            os.makedirs(entree)
            os.makedirs(faites)
            originaux = {}
            for nom in choisis:
                originaux[nom] = baver(np.asarray(Image.open(noms[nom]).convert('RGBA')), 8)
                Image.fromarray(originaux[nom], 'RGBA').save(os.path.join(entree, nom))
            agrandir(entree, faites)
            rendu = {}
            for nom, original in originaux.items():
                chemin = os.path.join(faites, nom)
                grand = Image.open(chemin).convert('RGBA') if os.path.exists(chemin) else None
                rendu[nom] = grand if grand is not None and ressemble(original, grand) else None
            return rendu
    liste, faites = sorted(noms), 0
    for debut in range(0, len(liste), LOT):
        rendu = lot(liste[debut:debut + LOT])
        for nom, grand in rendu.items():
            if grand is None:
                grand = lot([nom])[nom]
            if grand is None:
                print(nom, ': le résultat ne ressemble pas à la texture, laissée au jeu')
                continue
            w, h = Image.open(noms[nom]).size
            fois = 4 if max(w, h) <= 256 else 2
            if grand.size != (w * fois, h * fois):
                grand = grand.resize((w * fois, h * fois), Image.LANCZOS)
            Image.fromarray(baver(np.asarray(grand), 4 * fois), 'RGBA').save(os.path.join(sortie, nom))
            faites += 1
        print(min(debut + LOT, len(liste)), '/', len(liste), flush=True)
    return faites


def test():
    def bicubique(entree, sortie):
        """Agrandit, mais dans un lot de plusieurs échange les deux premiers noms (le défaut vu chez Real-ESRGAN)."""
        noms = sorted(os.listdir(entree))
        for nom, dest in zip(noms, noms[1::-1] + noms[2:] if len(noms) > 1 else noms):
            image = Image.open(os.path.join(entree, nom))
            image.resize((image.size[0] * 4, image.size[1] * 4), Image.BICUBIC).save(os.path.join(sortie, dest))

    # un carré rouge opaque au milieu d'une texture transparente noire : le bord transparent devient rouge, pas noir
    carre = np.zeros((16, 16, 4), np.uint8)
    carre[4:12, 4:12] = [255, 0, 0, 255]
    bave = baver(carre, 8)
    assert tuple(bave[0, 0]) == (255, 0, 0, 0), 'le transparent prend la couleur voisine, garde son alpha'
    with tempfile.TemporaryDirectory() as dossier:
        releve, sortie = os.path.join(dossier, 'releve'), os.path.join(dossier, 'hd')
        os.makedirs(releve)
        Image.fromarray(carre, 'RGBA').save(os.path.join(releve, '0000abcd.png'))
        bleu = carre.copy()
        bleu[4:12, 4:12] = [0, 0, 255, 255]
        Image.fromarray(bleu, 'RGBA').save(os.path.join(releve, '0000abce.png'))
        Image.new('RGBA', (16, 16), (9, 9, 9, 255)).save(os.path.join(releve, '0000eeee.png'))
        Image.new('RGBA', (1024, 8), (0, 0, 0, 255)).save(os.path.join(releve, '0000ffff.png'))
        # une feuille de police relevée aussi : c'est celle du pack de police qui reste
        a4 = bytes([0x00] * 8 + [0xFF] * 24)
        police = '%08x.png' % pack_police.zlib.crc32(a4)
        Image.new('RGBA', (8, 8), (1, 2, 3, 255)).save(os.path.join(releve, police))
        # une texture de l'écran du haut (pas dans bas.txt) : laissée au jeu
        Image.fromarray(carre, 'RGBA').save(os.path.join(releve, '00001111.png'))
        open(os.path.join(releve, 'bas.txt'), 'w').write(''.join(n + '\n' for n in ['0000abcd', '0000abce', '0000eeee', '0000ffff', police[:-4]]))
        assert pack([releve], sortie, [pack_police.cfnt_fabrique(pack_police.A4, [a4])], bicubique) == 2
        assert sorted(os.listdir(sortie)) == ['0000abcd.png', '0000abce.png', police], 'ni la texture unie, ni la trop grande'
        bleue = np.asarray(Image.open(os.path.join(sortie, '0000abce.png')))
        assert bleue[32, 32, 2] > 200 and bleue[32, 32, 0] < 50, 'les noms échangés dans le lot : refaite seule'
        hd = np.asarray(Image.open(os.path.join(sortie, '0000abcd.png')))
        assert hd.shape == (64, 64, 4) and hd[2, 2, 0] > 200, '4 fois plus grande, sans liseré noir'
        assert np.asarray(Image.open(os.path.join(sortie, police))).shape == (32, 32, 4), 'la feuille du pack de police'
        assert pack([releve], sortie, [], bicubique) == 0, 'rien à refaire'
    print('pack_ia : ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['test']:
        test()
    else:
        args = sys.argv[1:]
        sortie = SORTIE
        if '--sortie' in args:
            i = args.index('--sortie')
            sortie = args[i + 1]
            del args[i:i + 2]
        print(sortie, ':', pack(args, sortie, pack_police.polices_du_jeu()), 'textures agrandies')
