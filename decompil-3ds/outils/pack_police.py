"""Le pack de police : les feuilles de glyphes des polices du jeu, refaites 4 fois plus grandes, pour que le texte reste net
quand le portage agrandit l'image (`local/analyse/rendu/upscale.md`).

Le jeu lit ses feuilles en place dans les CFNT (`romfs/a/1/8/5` et la police partagée `cbf_std.bcfnt`) ; le moteur nomme
chaque texture par le crc32 de ses octets en mémoire, et un pack remplace `<crc32>.png` aux mêmes UV. Chaque feuille est donc
décodée (A4 ou IA4, tuiles 8 x 8 en ordre de Morton), agrandie, et écrite sous le crc32 de ses octets.

Agrandissement « contour lissé » : bicubique, flou, puis seuil adouci (un champ de distance du pauvre). Le dessin des lettres
reste celui du jeu. La police pixel des noms en combat (IA4) garde ses marches : seuil sur l'alpha et sur l'intensité.

Le pack dérive des fichiers du jeu : il s'écrit dans `local/` (par défaut `local/mods-build/textures/police-hd`, que le
launcher propose), jamais dans le dépôt.

    python outils/pack_police.py [DOSSIER]
    python outils/pack_police.py test
"""
import os
import struct
import sys
import zlib

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import garc

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.join(RACINE, 'local', 'mods-build', 'textures', 'police-hd')
FOIS = 4
A4, IA4 = 11, 9


def sections(d):
    """Les sections d'un CFNT (nom -> décalages), depuis la première après l'en-tête."""
    o = struct.unpack_from('<H', d, 6)[0]
    out = {}
    for _ in range(struct.unpack_from('<I', d, 0x10)[0]):
        nom, taille = d[o:o + 4].decode('latin-1'), struct.unpack_from('<I', d, o + 4)[0]
        out.setdefault(nom, []).append(o)
        if taille == 0:
            break
        o += taille
    return out


def tglp(d):
    """La section des feuilles : taille d'une feuille, nombre, format, dimensions, décalage des données."""
    o = sections(d)['TGLP'][0]
    _, _, _, _, taille, nombre, fmt, _, _, largeur, hauteur, debut = struct.unpack_from('<BBbBIHHHHHHI', d, o + 8)
    return dict(taille=taille, nombre=nombre, fmt=fmt, largeur=largeur, hauteur=hauteur, debut=debut)


def detuiler(valeurs, largeur, hauteur):
    """Tuiles 8 x 8 en ordre de Morton -> lignes (comme `formats::tiled_to_linear`)."""
    out = np.zeros((hauteur, largeur), np.uint8)
    i = 0
    for ty in range(0, hauteur, 8):
        for tx in range(0, largeur, 8):
            for k in range(64):
                x = (k & 1) | (k >> 1 & 2) | (k >> 2 & 4)
                y = (k >> 1 & 1) | (k >> 2 & 2) | (k >> 3 & 4)
                out[ty + y, tx + x] = valeurs[i]
                i += 1
    return out


def decoder(brut, t):
    """(intensité ou None pour A4, alpha), en 0..255."""
    octets = np.frombuffer(brut, np.uint8)
    if t['fmt'] == A4:
        return None, detuiler(np.stack([octets & 15, octets >> 4], 1).ravel(), t['largeur'], t['hauteur']) * 17
    if t['fmt'] == IA4:
        b = detuiler(octets, t['largeur'], t['hauteur'])
        return (b >> 4) * 17, (b & 15) * 17
    raise ValueError(f'format de feuille {t["fmt"]} inconnu')


def agrandir(canal):
    return np.asarray(Image.fromarray(canal).resize((canal.shape[1] * FOIS, canal.shape[0] * FOIS), Image.BICUBIC), np.float32) / 255


def seuil(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def feuille_hd(intensite, alpha):
    """L'image RGBA 4 fois plus grande d'une feuille."""
    if intensite is None:
        # police lissée (A4) : flou puis seuil adouci ; le jeu teinte le glyphe, le RGB reste noir
        flou = np.asarray(Image.fromarray((agrandir(alpha) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(FOIS / 2)), np.float32) / 255
        a, rgb = seuil(0.3, 0.7, flou), np.zeros_like(flou)
    else:
        a, rgb = seuil(0.35, 0.65, agrandir(alpha)), seuil(0.35, 0.65, agrandir(intensite))
    rgb, a = (rgb * 255 + 0.5).astype(np.uint8), (a * 255 + 0.5).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, rgb, rgb, a]), 'RGBA')


def pack(polices, sortie):
    """Écrit les feuilles de ces CFNT dans `sortie` ; rend le nombre écrit (les feuilles communes ne s'écrivent qu'une fois)."""
    os.makedirs(sortie, exist_ok=True)
    faites = 0
    for d in polices:
        t = tglp(d)
        if t['fmt'] not in (A4, IA4):
            continue
        for s in range(t['nombre']):
            brut = d[t['debut'] + s * t['taille']:t['debut'] + (s + 1) * t['taille']]
            chemin = os.path.join(sortie, '%08x.png' % zlib.crc32(brut))
            if os.path.exists(chemin):
                continue
            feuille_hd(*decoder(brut, t)).save(chemin)
            faites += 1
    return faites


def polices_du_jeu():
    _, entrees = garc.lire(open(os.path.join(RACINE, 'local', 'extrait', 'romfs', 'a', '1', '8', '5'), 'rb').read())
    polices = [f for e in entrees for f in e if f[:4] == b'CFNT']
    partagee = os.path.join(RACINE, 'local', 'extrait', 'police-partagee', 'cbf_std.bcfnt')
    if os.path.exists(partagee):
        polices.append(open(partagee, 'rb').read())
    return polices


def cfnt_fabrique(fmt, feuilles):
    """Un CFNT minimal : en-tête, FINF vide, TGLP de feuilles 8 x 8."""
    taille = 32 if fmt == A4 else 64
    debut = 0x14 + 0x20 + 0x20
    tglp_ = b'TGLP' + struct.pack('<I', 0x20) + struct.pack('<BBbBIHHHHHHI', 8, 8, 7, 8, taille, len(feuilles), fmt, 1, 1, 8, 8, debut)
    tglp_ += bytes(0x20 - len(tglp_))
    finf = b'FINF' + struct.pack('<I', 0x20) + bytes(0x18)
    entete = b'CFNT' + struct.pack('<HHIII', 0xFEFF, 0x14, 0x03000000, 0, 2)
    return entete + finf + tglp_ + b''.join(feuilles)


def test():
    import tempfile
    # une feuille A4 vide dans la tuile du coin haut gauche (Morton 0..15), pleine ailleurs ; une IA4 : un point blanc opaque
    a4 = bytes([0x00] * 8 + [0xFF] * 24)
    ia4 = bytes([0xFF] + [0x00] * 63)
    with tempfile.TemporaryDirectory() as dossier:
        assert pack([cfnt_fabrique(A4, [a4, a4]), cfnt_fabrique(IA4, [ia4])], dossier) == 2, 'les feuilles identiques une fois'
        image = Image.open(os.path.join(dossier, '%08x.png' % zlib.crc32(a4)))
        assert image.size == (32, 32)
        alpha = np.asarray(image)[:, :, 3]
        assert alpha[28, 28] > 200 and alpha[2, 2] < 20, 'plein en bas à droite, vide en haut à gauche'
        assert os.path.exists(os.path.join(dossier, '%08x.png' % zlib.crc32(ia4)))
    print('pack_police : ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['test']:
        test()
    else:
        sortie = sys.argv[1] if len(sys.argv) > 1 else SORTIE
        print(sortie, ':', pack(polices_du_jeu(), sortie), 'feuilles')
