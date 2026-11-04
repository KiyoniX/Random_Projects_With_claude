"""Quelques textures de l'interface du combat redessinées en formes géométriques (pas d'IA, pas de points recopiés), 4 fois
plus grandes, écrites dans le pack de police (`pack_police.py`) sous le nom que le moteur leur donne (crc32 de leurs octets).

Seulement ce que l'utilisateur a demandé : les deux plaques de PV (cadre arrondi, fente de la barre, « PV », « N. » ; la
nôtre a aussi la barre d'expérience). Les mesures sont relevées sur les textures du jeu (128 x 32, une case = un point) :
anneaux de la plaque (noir, reflet gris dégradé, noir, fond sombre translucide), fente noire de 47 points et son dégradé,
pastille verte des lettres. Les lettres sont tracées en polygones aux mêmes cases que les lettres pixel du jeu.

Le dessin est fait 16 fois plus grand puis réduit à 4 fois (bords lissés).

    python outils/pack_dessins.py [DOSSIER]
    python outils/pack_dessins.py test
"""
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_police

FOIS = 4
SUR = 4  # suréchantillonnage : dessin à FOIS * SUR, réduit ensuite
NOIR = (0, 0, 0, 255)
VERT = (0xbb, 0xff, 0x45, 255)
OR = (0xee, 0xc6, 0x3a, 255)

# Les plaques : coin haut gauche (ox, oy) de l'anneau noir (14 points de haut), largeur, bord gauche de la fente (47 points
# de fond entre deux bords noirs), pastille des lettres, lettres P et V (bord gauche, largeur de V), N (bord gauche, haut,
# hauteur), reflet blanc sur le bout gauche, barre d'expérience.
PLAQUES = {
    0x2ccf7c12: dict(ox=42, oy=13, w=76, fente=62, pastille=(47, 62), p=48, v=(54, 6), n=(83, 9, 5), reflet=False, exp=False),
    0x5ea935f9: dict(ox=28, oy=8, w=80, fente=52, pastille=(35, 52), p=36, v=(43, 7), n=(77, 3, 6), reflet=True, exp=True),
}


def stade(d, k, x0, y0, x1, y1, couleur):
    """Un rectangle aux bouts ronds (une demi-hauteur de rayon), en points du jeu."""
    d.rounded_rectangle([x0 * k, y0 * k, x1 * k - 1, y1 * k - 1], radius=(y1 - y0) * k / 2, fill=couleur)


def degrade(taille, haut, bas):
    """Une image verticale de `haut` à `bas` (RGBA)."""
    w, h = taille
    image = Image.new('RGBA', taille)
    for y in range(h):
        t = y / max(1, h - 1)
        image.paste(tuple(round(a + (b - a) * t) for a, b in zip(haut, bas)), (0, y, w, y + 1))
    return image


def remplir(image, forme, motif):
    """Pose `motif` (image de la taille de `image`) là où `forme` (dessin noir et blanc) est blanc."""
    image.alpha_composite(Image.composite(motif, Image.new('RGBA', image.size), forme))


def masque(image, dessin):
    m = Image.new('L', image.size, 0)
    dessin(ImageDraw.Draw(m))
    return m


def trait(d, k, points, largeur, couleur):
    """Une ligne brisée d'épaisseur `largeur` points, bouts carrés prolongés d'une demi-épaisseur."""
    d.line([(x * k, y * k) for x, y in points], fill=couleur, width=round(largeur * k), joint='curve')
    for x, y in (points[0], points[-1]):
        r = largeur * k / 2
        d.rectangle([x * k - r, y * k - r, x * k + r, y * k + r], fill=couleur)


def lettres(d, k, p, v, y0, couleur, epaisseur):
    """« P » (5 x 6) et « V » (largeur v[1] x 6) aux cases des lettres du jeu ; les traits passent au milieu des cases."""
    h = 6
    trait(d, k, [(p + 0.5, y0 + h - 0.5), (p + 0.5, y0 + 0.5), (p + 4, y0 + 0.5), (p + 4.5, y0 + 1), (p + 4.5, y0 + 2.5),
                 (p + 4, y0 + 3.5), (p + 0.5, y0 + 3.5)], epaisseur, couleur)
    x, w = v
    trait(d, k, [(x + 0.5, y0 + 0.5), (x + 0.5, y0 + 2), (x + w / 2, y0 + h - 0.5), (x + w - 0.5, y0 + 2), (x + w - 0.5, y0 + 0.5)],
          epaisseur, couleur)


def n_point(d, k, x, y, h, couleur, epaisseur):
    """« N. » : N de 4 points de large sur `h`, point carré en bas à droite."""
    trait(d, k, [(x + 0.5, y + h - 0.5), (x + 0.5, y + 0.5), (x + 3.5, y + h - 0.5), (x + 3.5, y + 0.5)], epaisseur, couleur)
    trait(d, k, [(x + 5.5, y + h - 0.5), (x + 5.5, y + h - 0.5)], epaisseur, couleur)


def plaque(c):
    """La texture `c` de PLAQUES, 4 fois plus grande (RGBA)."""
    k = FOIS * SUR
    image = Image.new('RGBA', (128 * k, 32 * k))
    ox, oy, w = c['ox'], c['oy'], c['w']
    d = ImageDraw.Draw(image)
    stade(d, k, ox, oy, ox + w, oy + 14, NOIR)
    # le reflet : gris clair en haut, sombre en bas, à la hauteur de la plaque
    reflet = Image.new('RGBA', image.size)
    reflet.paste(degrade((image.size[0], 12 * k), (0x88, 0x85, 0x82, 255), (0x3a, 0x38, 0x36, 255)), (0, (oy + 1) * k))
    remplir(image, masque(image, lambda m: stade(m, k, ox + 1, oy + 1, ox + w - 1, oy + 13, 255)), reflet)
    # le bout gauche a un reflet plus large (4 points) que le droit (2)
    stade(d, k, ox + 4, oy + 2, ox + w - 2, oy + 12, NOIR)
    fond = Image.new('RGBA', image.size)
    fond.paste(degrade((image.size[0], 8 * k), (0x33, 0x33, 0x35, 0x59), (0x26, 0x25, 0x27, 0x79)), (0, (oy + 3) * k))
    trou = masque(image, lambda m: stade(m, k, ox + 5, oy + 3, ox + w - 3, oy + 11, 255))
    image.paste(Image.new('RGBA', image.size), (0, 0), trou)
    remplir(image, trou, fond)
    # la fente de la barre : bord noir, fond plus clair en bas et à gauche
    f = c['fente']
    d.rectangle([f * k, (oy + 4) * k, (f + 49) * k - 1, (oy + 10) * k - 1], fill=NOIR)
    for y in range(4 * k):
        t = y / (4 * k - 1)
        gauche, droite = 0x2d + (0x68 - 0x2d) * t, 0x17 + (0x35 - 0x17) * t
        for x in range(47 * k):
            g = round(gauche + (droite - gauche) * x / (47 * k - 1))
            image.putpixel(((f + 1) * k + x, (oy + 5) * k + y), (g, g, g, 255))
    # la pastille des lettres
    a, b = c['pastille']
    d.rectangle([a * k, (oy + 3) * k, b * k - 1, (oy + 11) * k - 1], fill=(0x0a, 0x0b, 0x08, 255))
    d.rectangle([a * k, (oy + 3) * k, b * k - 1, (oy + 4) * k - 1], fill=(0x1d, 0x26, 0x0c, 255))
    lettres(d, k, c['p'], c['v'], oy + 4, (0x19, 0x22, 0x09, 255), 1.9)
    lettres(d, k, c['p'], c['v'], oy + 4, VERT, 1.0)
    if c['reflet']:
        d.ellipse([(ox + 3.6) * k, (oy + 3.5) * k, (ox + 5.6) * k, (oy + 7.5) * k], fill=(0xc8, 0xc8, 0xc8, 220))
    x, y, h = c['n']
    n_point(d, k, x, y, h, NOIR, 3.0)
    n_point(d, k, x, y, h, OR, 1.0)
    if c['exp']:
        d.rectangle([11 * k, 28 * k, 115 * k - 1, 32 * k - 1], fill=NOIR)
        d.rectangle([17 * k, 29 * k, 109 * k - 1, 31 * k - 1], fill=(0xbf, 0xbf, 0xbf, 255))
    return image.resize((128 * FOIS, 32 * FOIS), Image.LANCZOS)


def pack(sortie):
    os.makedirs(sortie, exist_ok=True)
    for crc, c in PLAQUES.items():
        plaque(c).save(os.path.join(sortie, '%08x.png' % crc))
    return len(PLAQUES)


def test():
    image = plaque(PLAQUES[0x5ea935f9])
    assert image.size == (512, 128)
    k = FOIS
    fente = image.getpixel(((52 + 10) * k, (8 + 8) * k))
    assert fente[3] == 255 and 0x30 < fente[0] < 0x70 and fente[0] == fente[1], f'le fond gris de la fente : {fente}'
    assert image.getpixel((4 * k, 4 * k))[3] == 0, 'transparent hors de la plaque'
    p = image.getpixel(((36 + 0.5) * k, (12 + 3) * k))
    assert p[1] > 200 and p[2] < 120, f'le trait du P est vert : {p}'
    print('pack_dessins : ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['test']:
        test()
    else:
        sortie = sys.argv[1] if len(sys.argv) > 1 else pack_police.SORTIE
        print(sortie, ':', pack(sortie), 'textures dessinées')
