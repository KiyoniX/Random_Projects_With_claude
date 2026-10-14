"""Les formats de pixels et le rangement en tuiles du processeur graphique PICA200.

Tout ce qui sort d'ici est un tableau numpy. Un « pixel décodé » est toujours RGBA sur 4 octets (0 à 255).

Le rangement en tuiles : l'image est coupée en tuiles de 8 x 8 points, rangées ligne de tuiles par ligne de tuiles ;
dans une tuile, les points sont dans l'ordre de Morton (les bits de x et de y entrelacés, x en bit de poids faible).
La première ligne de la mémoire est la ligne 0 du tableau ; c'est au dessin de savoir si c'est le haut ou le bas.
"""
import numpy as np


def _morton_table():
    table = np.zeros((8, 8), dtype=np.int64)          # table[y, x] = rang dans la tuile
    for y in range(8):
        for x in range(8):
            table[y, x] = ((x & 1) | ((y & 1) << 1) | ((x & 2) << 1) | ((y & 2) << 2) | ((x & 4) << 2)
                           | ((y & 4) << 3))
    return table


MORTON = _morton_table()
MORTON_X = np.zeros(64, dtype=np.int64)               # inverse : rang -> x, y
MORTON_Y = np.zeros(64, dtype=np.int64)
for _y in range(8):
    for _x in range(8):
        MORTON_X[MORTON[_y, _x]] = _x
        MORTON_Y[MORTON[_y, _x]] = _y

# Octets par point des formats de couleur (tampons de rendu, écrans, textures 0 à 4).
FORMAT_NAMES = ('RGBA8', 'RGB8', 'RGB565', 'RGB5A1', 'RGBA4')
BYTES_PER_PIXEL = {'RGBA8': 4, 'RGB8': 3, 'RGB565': 2, 'RGB5A1': 2, 'RGBA4': 2}
# Les trois numérotations : transferts GX et tampons d'écran, tampon de couleur du PICA, textures du PICA.
GX_FORMATS = {0: 'RGBA8', 1: 'RGB8', 2: 'RGB565', 3: 'RGB5A1', 4: 'RGBA4'}
COLORBUFFER_FORMATS = {0: 'RGBA8', 1: 'RGB8', 2: 'RGB5A1', 3: 'RGB565', 4: 'RGBA4'}

# Textures : numéro -> (nom, octets par point ou 0.5, 0 pour les blocs)
TEXTURE_FORMATS = {0: 'RGBA8', 1: 'RGB8', 2: 'RGB5A1', 3: 'RGB565', 4: 'RGBA4', 5: 'LA8', 6: 'HILO8', 7: 'L8',
                   8: 'A8', 9: 'LA4', 10: 'L4', 11: 'A4', 12: 'ETC1', 13: 'ETC1A4'}
TEXTURE_BITS = {'RGBA8': 32, 'RGB8': 24, 'RGB5A1': 16, 'RGB565': 16, 'RGBA4': 16, 'LA8': 16, 'HILO8': 16, 'L8': 8,
                'A8': 8, 'LA4': 8, 'L4': 4, 'A4': 4, 'ETC1': 4, 'ETC1A4': 8}


def expand_bits(values, bits):
    """Étend une valeur de `bits` bits à 8 bits en répétant les bits hauts (255 reste 255)."""
    values = values.astype(np.uint16)
    if bits == 5:
        return ((values << 3) | (values >> 2)).astype(np.uint8)
    if bits == 6:
        return ((values << 2) | (values >> 4)).astype(np.uint8)
    if bits == 4:
        return ((values << 4) | values).astype(np.uint8)
    if bits == 1:
        return (values * 255).astype(np.uint8)
    raise ValueError(bits)


def tiled_to_linear(raw, width, height, unit):
    """Passe d'octets rangés en tuiles à un tableau (height, width, unit) d'octets.

    `raw` : octets (au moins width*height*unit) ; width et height sont arrondis par le haut au multiple de 8 pour
    la lecture mais le tableau rendu a exactement la taille demandée.
    """
    tw, th = (width + 7) // 8, (height + 7) // 8
    need = tw * th * 64 * unit
    data = np.frombuffer(raw, dtype=np.uint8, count=need).reshape(th, tw, 64, unit)
    picked = data[:, :, MORTON]                        # (th, tw, 8 y, 8 x, unit)
    full = picked.transpose(0, 2, 1, 3, 4).reshape(th * 8, tw * 8, unit)
    return full[:height, :width]


def linear_to_tiled(image, unit):
    """L'inverse : (height, width, unit) d'octets -> octets en tuiles (height et width arrondis à 8, complétés de 0)."""
    height, width = image.shape[:2]
    tw, th = (width + 7) // 8, (height + 7) // 8
    if (tw * 8, th * 8) != (width, height):
        padded = np.zeros((th * 8, tw * 8, unit), dtype=np.uint8)
        padded[:height, :width] = image.reshape(height, width, unit)
        image = padded
    blocks = image.reshape(th, 8, tw, 8, unit).transpose(0, 2, 1, 3, 4)      # (th, tw, y, x, unit)
    out = np.empty((th, tw, 64, unit), dtype=np.uint8)
    out[:, :, MORTON.reshape(64)] = blocks.reshape(th, tw, 64, unit)
    return out.reshape(-1)


def decode_pixels(fmt, data):
    """Octets (…, unit) d'un format de couleur (nom) -> RGBA (…, 4) uint8."""
    shape = data.shape[:-1]
    if fmt == 'RGBA8':
        return data[..., ::-1].copy()                  # mémoire : A B G R
    if fmt == 'RGB8':
        out = np.empty(shape + (4,), dtype=np.uint8)
        out[..., 0:3] = data[..., ::-1]                # mémoire : B G R
        out[..., 3] = 255
        return out
    value = data[..., 0].astype(np.uint16) | (data[..., 1].astype(np.uint16) << 8)
    out = np.empty(shape + (4,), dtype=np.uint8)
    if fmt == 'RGB565':
        out[..., 0] = expand_bits(value >> 11, 5)
        out[..., 1] = expand_bits((value >> 5) & 0x3F, 6)
        out[..., 2] = expand_bits(value & 0x1F, 5)
        out[..., 3] = 255
    elif fmt == 'RGB5A1':
        out[..., 0] = expand_bits(value >> 11, 5)
        out[..., 1] = expand_bits((value >> 6) & 0x1F, 5)
        out[..., 2] = expand_bits((value >> 1) & 0x1F, 5)
        out[..., 3] = (value & 1) * 255
    elif fmt == 'RGBA4':
        out[..., 0] = expand_bits(value >> 12, 4)
        out[..., 1] = expand_bits((value >> 8) & 0xF, 4)
        out[..., 2] = expand_bits((value >> 4) & 0xF, 4)
        out[..., 3] = expand_bits(value & 0xF, 4)
    else:
        raise ValueError(fmt)
    return out


def encode_pixels(fmt, rgba):
    """RGBA (…, 4) uint8 -> octets (…, unit) du format de couleur (nom)."""
    shape = rgba.shape[:-1]
    if fmt == 'RGBA8':
        return rgba[..., ::-1].copy()
    if fmt == 'RGB8':
        return rgba[..., 2::-1].copy()
    r, g, b, a = (rgba[..., i].astype(np.uint16) for i in range(4))
    if fmt == 'RGB565':
        value = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    elif fmt == 'RGB5A1':
        value = ((r >> 3) << 11) | ((g >> 3) << 6) | ((b >> 3) << 1) | (a >> 7)
    elif fmt == 'RGBA4':
        value = ((r >> 4) << 12) | ((g >> 4) << 8) | ((b >> 4) << 4) | (a >> 4)
    else:
        raise ValueError(fmt)
    out = np.empty(shape + (2,), dtype=np.uint8)
    out[..., 0] = value & 0xFF
    out[..., 1] = value >> 8
    return out


# --- les textures ---

ETC1_TABLES = np.array([[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]],
                       dtype=np.int32)


def decode_etc1_blocks(blocks):
    """blocks : (n, 8) octets tels que la 3DS les range (mot de 64 bits petit-boutiste) -> (n, 4, 4, 3) RGB, [y, x]."""
    std = blocks[:, ::-1].astype(np.int32)             # dans l'ordre standard : en-tête puis index des pixels
    n = len(std)
    diff = (std[:, 3] >> 1) & 1
    flip = std[:, 3] & 1
    table1 = ETC1_TABLES[(std[:, 3] >> 5) & 7]
    table2 = ETC1_TABLES[(std[:, 3] >> 2) & 7]
    base1 = np.empty((n, 3), dtype=np.int32)
    base2 = np.empty((n, 3), dtype=np.int32)
    for c in range(3):
        byte = std[:, c]
        # mode individuel : deux fois 4 bits
        i1 = (byte >> 4) * 17
        i2 = (byte & 15) * 17
        # mode différentiel : 5 bits et un delta signé de 3 bits
        d1 = byte >> 3
        delta = byte & 7
        delta = np.where(delta >= 4, delta - 8, delta)
        d2 = np.clip(d1 + delta, 0, 31)
        d1x = (d1 << 3) | (d1 >> 2)
        d2x = (d2 << 3) | (d2 >> 2)
        base1[:, c] = np.where(diff == 1, d1x, i1)
        base2[:, c] = np.where(diff == 1, d2x, i2)
    bits = (std[:, 4] << 24) | (std[:, 5] << 16) | (std[:, 6] << 8) | std[:, 7]
    out = np.empty((n, 4, 4, 3), dtype=np.int32)
    for y in range(4):
        for x in range(4):
            k = x * 4 + y
            msb = (bits >> (k + 16)) & 1
            lsb = (bits >> k) & 1
            second = np.where(flip == 1, y >= 2, x >= 2)         # sous-bloc 2 ?
            base = np.where(second[:, None], base2, base1)
            table = np.where(second[:, None], table2, table1)
            small = table[:, 0]
            big = table[:, 1]
            magnitude = np.where(lsb == 1, big, small)
            modifier = np.where(msb == 1, -magnitude, magnitude)
            out[:, y, x, :] = np.clip(base + modifier[:, None], 0, 255)
    return out.astype(np.uint8)


def decode_texture(fmt, raw, width, height):
    """Octets d'une texture (niveau 0) -> RGBA (height, width, 4) uint8. fmt : nom (TEXTURE_FORMATS)."""
    if fmt in BYTES_PER_PIXEL:
        unit = BYTES_PER_PIXEL[fmt]
        return decode_pixels(fmt, tiled_to_linear(raw, width, height, unit))
    if fmt in ('LA8', 'HILO8'):
        data = tiled_to_linear(raw, width, height, 2)
        out = np.empty((height, width, 4), dtype=np.uint8)
        if fmt == 'LA8':
            out[..., 0] = out[..., 1] = out[..., 2] = data[..., 1]
            out[..., 3] = data[..., 0]
        else:
            out[..., 0] = data[..., 1]
            out[..., 1] = data[..., 0]
            out[..., 2] = 0
            out[..., 3] = 255
        return out
    if fmt in ('L8', 'A8', 'LA4'):
        data = tiled_to_linear(raw, width, height, 1)[..., 0]
        out = np.empty((height, width, 4), dtype=np.uint8)
        if fmt == 'L8':
            out[..., 0] = out[..., 1] = out[..., 2] = data
            out[..., 3] = 255
        elif fmt == 'A8':
            out[..., 0:3] = 0
            out[..., 3] = data
        else:
            out[..., 0] = out[..., 1] = out[..., 2] = expand_bits(data >> 4, 4)
            out[..., 3] = expand_bits(data & 15, 4)
        return out
    if fmt in ('L4', 'A4'):
        packed = np.frombuffer(raw, dtype=np.uint8, count=((width + 7) // 8) * ((height + 7) // 8) * 32)
        nibbles = np.empty(len(packed) * 2, dtype=np.uint8)
        nibbles[0::2] = packed & 15
        nibbles[1::2] = packed >> 4
        data = tiled_to_linear(nibbles, width, height, 1)[..., 0]
        values = expand_bits(data, 4)
        out = np.empty((height, width, 4), dtype=np.uint8)
        if fmt == 'L4':
            out[..., 0] = out[..., 1] = out[..., 2] = values
            out[..., 3] = 255
        else:
            out[..., 0:3] = 0
            out[..., 3] = values
        return out
    if fmt in ('ETC1', 'ETC1A4'):
        tw, th = (width + 7) // 8, (height + 7) // 8
        size = 8 if fmt == 'ETC1' else 16
        data = np.frombuffer(raw, dtype=np.uint8, count=tw * th * 4 * size).reshape(th, tw, 4, size)
        alpha = None
        if fmt == 'ETC1A4':
            a_bytes = data[..., :8]
            blocks = data[..., 8:]
        else:
            blocks = data
        rgb = decode_etc1_blocks(np.ascontiguousarray(blocks).reshape(-1, 8)).reshape(th, tw, 4, 4, 4, 3)
        # blocs : 4 par tuile dans l'ordre (0,0) (1,0) (0,1) (1,1) ; rang 2 bits : bit 0 = x du bloc, bit 1 = y
        rgb = rgb.reshape(th, tw, 2, 2, 4, 4, 3)       # [ty, tx, by, bx, y, x, c]
        image = rgb.transpose(0, 2, 4, 1, 3, 5, 6).reshape(th * 8, tw * 8, 3)
        out = np.empty((th * 8, tw * 8, 4), dtype=np.uint8)
        out[..., 0:3] = image
        out[..., 3] = 255
        if fmt == 'ETC1A4':
            words = np.ascontiguousarray(a_bytes).reshape(-1, 8)
            alpha_blocks = np.empty((len(words), 4, 4), dtype=np.uint8)
            value = np.zeros(len(words), dtype=np.uint64)
            for i in range(8):
                value |= words[:, i].astype(np.uint64) << np.uint64(8 * i)
            for y in range(4):
                for x in range(4):
                    k = x * 4 + y
                    alpha_blocks[:, y, x] = expand_bits(((value >> np.uint64(4 * k)) & np.uint64(15)).astype(np.uint8), 4)
            alpha_blocks = alpha_blocks.reshape(th, tw, 2, 2, 4, 4)
            out[..., 3] = alpha_blocks.transpose(0, 2, 4, 1, 3, 5).reshape(th * 8, tw * 8)
        return out[:height, :width]
    raise ValueError(fmt)


def texture_size(fmt, width, height):
    """Taille en octets du niveau 0, hauteur et largeur arrondies à 8."""
    return ((width + 7) // 8) * ((height + 7) // 8) * 64 * TEXTURE_BITS[fmt] // 8


def write_png(path, image):
    """Écrit un tableau (hauteur, largeur, 3 ou 4) uint8 en PNG (RGB ou RGBA)."""
    import struct
    import zlib
    height, width, channels = image.shape
    raw = b''.join(bytes(1) + image[y].tobytes() for y in range(height))

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    png = bytes((137, 80, 78, 71, 13, 10, 26, 10)) + chunk(
        b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2 if channels == 3 else 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 3)) + chunk(b'IEND', b'')
    with open(path, 'wb') as out:
        out.write(png)
