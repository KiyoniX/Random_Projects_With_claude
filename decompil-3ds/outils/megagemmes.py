"""Les images des Méga-Gemmes que le combat montre à la place de la bille Méga (texture 16 x 16 `5de17103`) à côté du nom d'un
Pokémon méga-évolué : la gemme qu'il tient (`portage/crates/portage/src/play.rs`, `mega_stone`).

Images : icônes de Légendes Pokémon Z-A chez Serebii (`itemdex/sprites/za/<nom>.png`, 160 x 160, fond transparent),
© Nintendo / Game Freak : téléchargées sur la machine du joueur dans `local/mods-build/megagemmes/<numéro d'objet>.png`,
jamais versionnées. Numéros d'objet de la 6e génération (liste des objets de PKHeX, MIT).

Chaque image est recadrée sur sa partie visible puis posée dans 128 x 128 avec un bord de 8 points, comme la bille dans ses
16 x 16 (visible de 1 à 15).

    python outils/megagemmes.py [DOSSIER]
    python outils/megagemmes.py test
"""
import io
import os
import sys
import urllib.request

from PIL import Image

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.join(RACINE, 'local', 'mods-build', 'megagemmes')
SOURCE = 'https://serebii.net/itemdex/sprites/za/{}.png'
COTE, BORD = 128, 8

GEMMES = {
    656: 'gengarite', 657: 'gardevoirite', 658: 'ampharosite', 659: 'venusaurite', 660: 'charizarditex', 661: 'blastoisinite',
    662: 'mewtwonitex', 663: 'mewtwonitey', 664: 'blazikenite', 665: 'medichamite', 666: 'houndoominite', 667: 'aggronite',
    668: 'banettite', 669: 'tyranitarite', 670: 'scizorite', 671: 'pinsirite', 672: 'aerodactylite', 673: 'lucarionite',
    674: 'abomasite', 675: 'kangaskhanite', 676: 'gyaradosite', 677: 'absolite', 678: 'charizarditey', 679: 'alakazite',
    680: 'heracronite', 681: 'mawilite', 682: 'manectite', 683: 'garchompite',
    # Rubis Oméga / Saphir Alpha (les objets existent dans le jeu, sans Pokémon de X pour les tenir tous)
    752: 'swampertite', 753: 'sceptilite', 754: 'sablenite', 758: 'metagrossite', 759: 'sharpedonite', 760: 'slowbronite',
    761: 'steelixite', 762: 'pidgeotite', 763: 'glalitite', 764: 'diancite', 767: 'cameruptite', 768: 'lopunnite',
    769: 'salamencite', 770: 'beedrillite',
}


def cadrer(image):
    """La partie visible de `image`, agrandie au plus grand dans COTE x COTE avec un bord de BORD points, centrée."""
    image = image.convert('RGBA')
    boite = image.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if boite:
        image = image.crop(boite)
    place = COTE - 2 * BORD
    fois = place / max(image.size)
    image = image.resize((max(1, round(image.size[0] * fois)), max(1, round(image.size[1] * fois))), Image.LANCZOS)
    sortie = Image.new('RGBA', (COTE, COTE))
    sortie.alpha_composite(image, ((COTE - image.size[0]) // 2, (COTE - image.size[1]) // 2))
    return sortie


def telecharger(dossier):
    os.makedirs(dossier, exist_ok=True)
    faites = 0
    for numero, nom in GEMMES.items():
        chemin = os.path.join(dossier, f'{numero}.png')
        if os.path.exists(chemin):
            continue
        requete = urllib.request.Request(SOURCE.format(nom), headers={'User-Agent': 'Mozilla/5.0'})
        try:
            octets = urllib.request.urlopen(requete, timeout=30).read()
        except OSError as e:
            print(nom, ':', e)
            continue
        cadrer(Image.open(io.BytesIO(octets))).save(chemin)
        faites += 1
    return faites


def test():
    # une gemme de 40 x 20 au milieu d'une image transparente de 160 x 160 : 112 x 56 centrée dans 128 x 128
    image = Image.new('RGBA', (160, 160))
    image.paste((255, 0, 0, 255), (60, 70, 100, 90))
    sortie = cadrer(image)
    assert sortie.size == (COTE, COTE)
    assert sortie.getchannel('A').getbbox() == (8, 36, 120, 92), sortie.getchannel('A').getbbox()
    assert len(set(GEMMES.values())) == len(GEMMES)
    print('megagemmes : ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['test']:
        test()
    else:
        dossier = sys.argv[1] if len(sys.argv) > 1 else SORTIE
        print(dossier, ':', telecharger(dossier), 'images')
