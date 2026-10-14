"""Les commandes 3 (transfert vers l'écran) et 4 (copie de texture) de la file de gsp, faites pour de bon."""
import numpy as np

from . import formats


def display_transfer(memory, source, destination, in_dim, out_dim, flags):
    """Commande 3 : l'image rendue (en tuiles) devient une image affichable (en lignes).

    Dimensions : largeur dans les 16 bits bas, hauteur dans les 16 bits hauts. Drapeaux : bit 0 retourner de haut en
    bas, bit 1 sortie en tuiles, bit 3 copie brute, bits 8-10 format d'entrée, bits 12-14 format de sortie,
    bits 24-25 réduction (1 en largeur, 2 dans les deux sens). Quand la sortie est plus petite que l'entrée, on
    prend le coin haut-gauche. Rend un texte pour le journal (vide si tout va bien).
    """
    in_w, in_h = in_dim & 0xFFFF, in_dim >> 16
    out_w, out_h = out_dim & 0xFFFF, out_dim >> 16
    flip, out_tiled, raw_copy = flags & 1, flags >> 1 & 1, flags >> 3 & 1
    in_fmt = formats.GX_FORMATS.get(flags >> 8 & 7)
    out_fmt = formats.GX_FORMATS.get(flags >> 12 & 7)
    scaling = flags >> 24 & 3
    if in_fmt is None or out_fmt is None or not (in_w and in_h and out_w and out_h):
        return 'dimensions ou format illisibles'
    in_unit = formats.BYTES_PER_PIXEL[in_fmt]
    if raw_copy:
        # copie d'octets, sans conversion : on recopie la taille de sortie
        size = out_w * out_h * formats.BYTES_PER_PIXEL[out_fmt]
        memory.write(destination, memory.read(source, size))
        return ''
    try:
        raw = memory.read(source, ((in_w + 7) // 8) * ((in_h + 7) // 8) * 64 * in_unit)
    except Exception as exc:
        return 'source illisible (%s)' % exc
    image = formats.decode_pixels(in_fmt, formats.tiled_to_linear(raw, in_w, in_h, in_unit))
    if scaling:
        image = image[:, :image.shape[1] // 2 * 2]
        wide = image.reshape(image.shape[0], -1, 2, 4).astype(np.uint16)
        image = ((wide[:, :, 0] + wide[:, :, 1] + 1) >> 1).astype(np.uint8)
        if scaling == 2:
            image = image[:image.shape[0] // 2 * 2]
            tall = image.reshape(-1, 2, image.shape[1], 4).astype(np.uint16)
            image = ((tall[:, 0] + tall[:, 1] + 1) >> 1).astype(np.uint8)
    image = image[:out_h, :out_w]
    if flip:
        image = image[::-1]
    unit = formats.BYTES_PER_PIXEL[out_fmt]
    encoded = formats.encode_pixels(out_fmt, np.ascontiguousarray(image))
    if out_tiled:
        data = formats.linear_to_tiled(encoded, unit)
    else:
        data = encoded.reshape(-1)
    try:
        memory.write(destination, data.tobytes())
    except Exception as exc:
        return 'destination refusée (%s)' % exc
    return ''


def texture_copy(memory, source, destination, size, in_dim, out_dim, flags):
    """Commande 4 : copie d'octets, par lignes si les largeurs sont données (largeur, intervalle : paquets de 16 octets)."""
    in_line, in_skip = (in_dim & 0xFFFF) * 16, (in_dim >> 16) * 16
    out_line, out_skip = (out_dim & 0xFFFF) * 16, (out_dim >> 16) * 16
    if (not in_line and not in_skip) or (not out_line and not out_skip) or not in_line or not out_line:
        memory.write(destination, memory.read(source, size))
        return
    left_in, left_out = in_line, out_line
    remaining = size
    while remaining > 0:
        chunk = min(left_in, left_out, remaining)
        memory.write(destination, memory.read(source, chunk))
        source += chunk
        destination += chunk
        remaining -= chunk
        left_in -= chunk
        left_out -= chunk
        if left_in == 0:
            source += in_skip
            left_in = in_line
        if left_out == 0:
            destination += out_skip
            left_out = out_line
