"""Un ordre de dessin du PICA200 : sommets, shader, triangles, rastérisation, textures, combinateur, mélange.

Tout est vectorisé avec numpy : les sommets d'un ordre passent ensemble dans le shader, les triangles sont
rastérisés ensemble (toutes les boîtes englobantes d'un coup, par paquets), les fragments sont éclairés par le
combinateur ensemble, puis fusionnés au tampon de couleur couche par couche (une couche = au plus un fragment par
point, pour que les recouvrements d'un même ordre se fassent dans l'ordre des triangles).

Fait aussi : l'éclairage par fragment (`lighting.py`), le brouillard, le pochoir, les opérations logiques, les ciseaux
qui excluent, le découpage aux plans proche et lointain, la texture projetée, et le shader de géométrie en modes point
et primitive fixe (`geometry_stage`, jamais vu dans une capture du jeu : vérifié sur des données fabriquées seulement).
Pas fait : le mode primitive variable du shader de géométrie, les textures procédurales, les niveaux de détail
(mipmaps), les cubes, le découpage en x et en y (les ciseaux suffisent).
"""
import os
import zlib

import numpy as np

from . import formats, lighting
from .shader import f24_to_f32

SEMANTIC_SLOTS = {4: 14, 5: 15, 6: 16, 7: 17, 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 7, 16: 10,
                  18: 11, 19: 12, 20: 13, 22: 8, 23: 9}
ATTRIBUTE_COUNT = 18
STAGE_BASES = (0xC0, 0xC8, 0xD0, 0xD8, 0xF0, 0xF8)
MAX_CANDIDATES = 700_000
TEXTURE_REGISTERS = {0: (0x81, 0x85, 0x8E), 1: (0x91, 0x95, 0x96), 2: (0x99, 0x9D, 0x9E)}
FLIP_TEXTURES = True          # la ligne 0 d'une texture en mémoire est le haut de l'image (v = 1) : vérifié sur l'écran-titre

COMPARE = (lambda a, b: np.zeros(a.shape, bool), lambda a, b: np.ones(a.shape, bool), lambda a, b: a == b,
           lambda a, b: a != b, lambda a, b: a < b, lambda a, b: a <= b, lambda a, b: a > b, lambda a, b: a >= b)


def translate(address):
    from .gpu import translate as t
    return t(address)


# --- les sommets ---

def fetch_indices(gpu, indexed):
    regs = gpu.regs
    count = regs[0x228]
    if not indexed:
        first = regs[0x22A]
        return np.arange(first, first + count, dtype=np.int64)
    base = (regs[0x200] & 0x1FFFFFFF) << 3
    info = regs[0x227]
    address = translate(base + (info & 0x0FFFFFFF))
    wide = info >> 31
    raw = gpu.memory.read(address, count * (2 if wide else 1))
    return np.frombuffer(raw, dtype=np.uint16 if wide else np.uint8).astype(np.int64)


def load_vertices(gpu, ids):
    """Les attributs de chaque sommet de `ids` -> (n, 16, 4) float32 rangés dans les registres d'entrée du shader."""
    regs = gpu.regs
    n = len(ids)
    base = (regs[0x200] & 0x1FFFFFFF) << 3
    fmt_low, fmt_high = regs[0x201], regs[0x202]
    count = (fmt_high >> 28) + 1
    fixed_mask = fmt_high >> 16 & 0xFFF
    formats_ = []
    for a in range(12):
        nib = (fmt_low >> (4 * a) & 15) if a < 8 else (fmt_high >> (4 * (a - 8)) & 15)
        formats_.append((nib & 3, (nib >> 2) + 1))
    values = {}
    lo, hi = int(ids.min()), int(ids.max())
    for i in range(12):
        offset, w1, w2 = regs[0x203 + 3 * i], regs[0x204 + 3 * i], regs[0x205 + 3 * i]
        components = w2 >> 28
        stride = w2 >> 16 & 0xFF
        if not components or not stride:
            continue
        ids_c = [(w1 >> (4 * k) & 15) for k in range(8)] + [(w2 >> (4 * k) & 15) for k in range(4)]
        address = translate(base + offset + lo * stride)
        if address is None:
            gpu.notes['tampon de sommets hors mémoire'] += 1
            continue
        try:
            raw = gpu.memory.read(address, (hi - lo + 1) * stride)
        except Exception:
            gpu.notes['tampon de sommets illisible'] += 1
            continue
        rows = np.frombuffer(raw, dtype=np.uint8).reshape(-1, stride)[ids - lo]
        position = 0
        for comp in ids_c[:components]:
            if comp >= 12:
                position += 4 * (comp - 11)
                continue
            kind, size = formats_[comp]
            dtype = np.dtype(ATTRIBUTE_TYPES_[kind])
            width = dtype.itemsize
            position = (position + width - 1) // width * width
            span = width * size
            if position + span > stride:
                break
            chunk = np.ascontiguousarray(rows[:, position:position + span]).view(dtype).astype(np.float32)
            vec = np.zeros((n, 4), dtype=np.float32)
            vec[:, 3] = 1
            vec[:, :size] = chunk
            values[comp] = vec
            position += span
    for a in range(12):
        if fixed_mask >> a & 1:
            values[a] = np.broadcast_to(gpu.fixed[a], (n, 4))
    inputs = np.zeros((n, 16, 4), dtype=np.float32)
    inputs[:, :, 3] = 1
    permutation = regs[0x2BB] | (regs[0x2BC] << 32)
    for a in range(min(count, 12)):
        register = permutation >> (4 * a) & 15
        if a in values:
            inputs[:, register] = values[a]
    return inputs


ATTRIBUTE_TYPES_ = (np.int8, np.uint8, np.int16, np.float32)


def vertex_stage(gpu, inputs):
    """Le shader de sommets sur `inputs` (n, 16, 4) : les registres de sortie (n, 16, 4). Mémorisé."""
    regs = gpu.regs
    shader = gpu.shader
    shader.bools = regs[0x2B0] & 0xFFFF
    shader.ints = [(regs[0x2B1 + k] & 0xFF, regs[0x2B1 + k] >> 8 & 0xFF, regs[0x2B1 + k] >> 16 & 0xFF)
                   for k in range(4)]
    shader.entry = regs[0x2BA] & 0xFFFF
    key = (hash(tuple(shader.code)), hash(tuple(shader.swizzle)), shader.uniforms.tobytes(), shader.bools,
           tuple(shader.ints), shader.entry, inputs.tobytes())
    out = gpu.shader_cache.get(key)
    if out is None:
        out = shader.run(inputs)
        if len(gpu.shader_cache) > 3000:
            gpu.shader_cache.clear()
        gpu.shader_cache[key] = out
    note_unsupported(gpu, shader)
    return out


def note_unsupported(gpu, shader):
    if shader.unsupported:
        for op in shader.unsupported:
            gpu.notes['instruction de shader %#x non faite' % op] += 1
        shader.unsupported.clear()


def map_outputs(regs, out, mask):
    """Les registres de sortie d'un shader (n, 16, 4) rangés selon la carte des sorties (0x50-0x56) : la position (n, 4)
    et les attributs (n, 18). `mask` : les registres de sortie allumés, dans l'ordre desquels vont les cartes."""
    n = len(out)
    slots = [r for r in range(16) if mask >> r & 1]
    position = np.zeros((n, 4), dtype=np.float32)
    position[:, 3] = 1
    attributes = np.zeros((n, ATTRIBUTE_COUNT), dtype=np.float32)
    attributes[:, 3] = 1
    for k, r in enumerate(slots[:7]):
        word = regs[0x50 + k]
        for c in range(4):
            semantic = word >> (8 * c) & 0x1F
            if semantic < 4:
                position[:, semantic] = out[:, r, c]
            elif semantic in SEMANTIC_SLOTS:
                attributes[:, SEMANTIC_SLOTS[semantic]] = out[:, r, c]
    return position, attributes


def run_vertex_shader(gpu, inputs):
    regs = gpu.regs
    return map_outputs(regs, vertex_stage(gpu, inputs), regs[0x2BD] & 0xFFFF)


def geometry_stage(gpu, vertex_out, order):
    """Le shader de géométrie (0x229 : bits 0-1 égaux à 2). Les sorties du shader de sommets (tassées selon le masque
    0x2BD) vont dans les entrées du shader de géométrie, dans l'ordre du dessin (`order` : l'indice de chaque sommet de
    l'ordre dans `vertex_out`), par groupes selon le mode (0x252, bits 0-7) :
    - 0 « point » : une exécution par sommet, ses attributs en entrée ;
    - 2 « primitive fixe » : une exécution par groupe de `(bits 8-11) + 1` sommets, chacun apportant ses `(bits 12-15) + 1`
      premiers attributs, mis bout à bout ;
    - 1 « primitive variable » : pas fait.
    Les attributs d'entrée vont dans les registres d'entrée selon la permutation 0x28B/0x28C, au plus
    `(0x289 & 15) + 1` d'entre eux. L'unité est celle des sommets si 0x244 bit 0 est nul (code, constantes, booléens et
    entiers partagés ; seule l'entrée 0x28A change), sinon une unité à part (0x280-0x2AD). Rend (positions (3t, 4),
    attributs (3t, 18), triangles (t, 3)), ou None."""
    regs = gpu.regs
    mode = regs[0x252] & 0xFF
    mask = regs[0x2BD] & 0xFFFF
    slots = [r for r in range(16) if mask >> r & 1]
    packed = vertex_out[:, slots][order] if slots else np.zeros((len(order), 0, 4), dtype=np.float32)
    if mode == 0:
        group, stride = 1, packed.shape[1]
    elif mode == 2:
        group, stride = (regs[0x252] >> 8 & 15) + 1, (regs[0x252] >> 12 & 15) + 1
    else:
        gpu.notes['shader de géométrie en mode primitive variable (non fait)'] += 1
        return None
    if len(packed) % group:
        gpu.notes['shader de géométrie : sommets en trop pour des groupes de %d' % group] += 1
        packed = packed[:len(packed) // group * group]
    count = len(packed) // group
    if not count:
        return None
    attributes = packed[:, :stride].reshape(count, group * min(stride, packed.shape[1]), 4)
    unit = gpu if not regs[0x244] & 1 else gpu.gs_unit
    shader = unit.shader
    if regs[0x244] & 1:
        shader.bools = regs[0x280] & 0xFFFF
        shader.ints = [(regs[0x281 + k] & 0xFF, regs[0x281 + k] >> 8 & 0xFF, regs[0x281 + k] >> 16 & 0xFF)
                       for k in range(4)]
    else:
        shader.bools = regs[0x2B0] & 0xFFFF
        shader.ints = [(regs[0x2B1 + k] & 0xFF, regs[0x2B1 + k] >> 8 & 0xFF, regs[0x2B1 + k] >> 16 & 0xFF)
                       for k in range(4)]
    saved_entry = shader.entry
    shader.entry = regs[0x28A] & 0xFFFF
    inputs = np.zeros((count, 16, 4), dtype=np.float32)
    inputs[:, :, 3] = 1
    permutation = regs[0x28B] | (regs[0x28C] << 32)
    for a in range(min((regs[0x289] & 15) + 1, attributes.shape[1])):
        inputs[:, permutation >> (4 * a) & 15] = attributes[:, a]
    try:
        triangles, flipped = shader.run_geometry(inputs)
    finally:
        shader.entry = saved_entry
    note_unsupported(gpu, shader)
    gpu.stats['triangles émis par le shader de géométrie'] += len(triangles)
    if not len(triangles):
        return None
    flat = triangles.reshape(-1, 16, 4)
    position, attrs = map_outputs(regs, flat, regs[0x28D] & 0xFFFF)
    index = np.arange(len(flat), dtype=np.int64).reshape(-1, 3)
    index[flipped] = index[flipped][:, (1, 0, 2)]                  # SETEMIT « sens inverse » : les deux premiers échangés
    return position, attrs, index


def assemble(topology, index):
    """Les triangles (t, 3) d'une suite d'indices, selon le mode : 0 liste, 1 bande, 2 éventail, 3 liste."""
    n = len(index)
    if topology == 1:
        if n < 3:
            return np.zeros((0, 3), dtype=np.int64)
        i = np.arange(n - 2)
        a, b, c = index[i], index[i + 1], index[i + 2]
        odd = (i & 1) == 1
        return np.stack([np.where(odd, b, a), np.where(odd, a, b), c], axis=1)
    if topology == 2:
        if n < 3:
            return np.zeros((0, 3), dtype=np.int64)
        i = np.arange(1, n - 1)
        return np.stack([np.full(len(i), index[0]), index[i], index[i + 1]], axis=1)
    return index[:n // 3 * 3].reshape(-1, 3)


CLIP_PLANES = ((0, 0, 1, 1), (0, 0, -1, 0))      # le volume de la console : -w <= z <= 0 (plan proche, puis plan lointain)


def clip_plane(position, attributes, triangles, plane):
    """Découpe les triangles (t, 3) à un plan de clip (a, b, c, d) : on garde a x + b y + c z + d w >= 0. Un triangle
    à moitié dedans devient un polygone (1 ou 2 triangles) dont les sommets coupés sont interpolés dans l'espace de clip
    (position et attributs, ce qui reste juste en perspective). Rend (positions, attributs, triangles)."""
    d = position @ np.array(plane, dtype=np.float32)
    inside = d >= 0
    flags = inside[triangles]
    inside_count = flags.sum(axis=1)
    keep = triangles[inside_count == 3]
    partial = np.nonzero((inside_count > 0) & (inside_count < 3))[0]
    if not len(partial):
        return position, attributes, keep
    new_p, new_a, new_t = [], [], []
    next_index = len(position)
    for t in partial:
        v = triangles[t]
        polygon = []
        for k in range(3):
            a, b = v[k], v[(k + 1) % 3]
            da, db = d[a], d[b]
            if da >= 0:
                polygon.append(int(a))
            if (da >= 0) != (db >= 0):
                s = np.float32(da / (da - db))
                new_p.append(position[a] + (position[b] - position[a]) * s)
                new_a.append(attributes[a] + (attributes[b] - attributes[a]) * s)
                polygon.append(next_index)
                next_index += 1
        for j in range(1, len(polygon) - 1):
            new_t.append((polygon[0], polygon[j], polygon[j + 1]))
    if new_p:
        position = np.concatenate([position, np.array(new_p, dtype=np.float32)])
        attributes = np.concatenate([attributes, np.array(new_a, dtype=np.float32)])
    if new_t:
        keep = np.concatenate([keep, np.array(new_t, dtype=np.int64)])
    return position, attributes, keep


def clip_near(position, attributes, triangles):
    """Découpe aux plans proche (z + w >= 0) et lointain (z <= 0). Le nom est resté : à l'origine, le plan proche seul."""
    for plane in CLIP_PLANES:
        position, attributes, triangles = clip_plane(position, attributes, triangles, plane)
        if not len(triangles):
            break
    return position, attributes, triangles


# --- les textures ---

def get_texture(gpu, unit):
    """(pixels RGBA uint8, mode s, mode t, linéaire, bordure) de l'unité de texture, ou None."""
    regs = gpu.regs
    border_reg, address_reg, format_reg = TEXTURE_REGISTERS[unit]
    dim, config = regs[border_reg + 1], regs[border_reg + 2]
    width, height = dim >> 16 & 0x7FF, dim & 0x7FF
    fmt = formats.TEXTURE_FORMATS.get(regs[format_reg] & 15)
    address = translate((regs[address_reg] & 0x1FFFFFFF) << 3)
    if not width or not height or fmt is None or address is None:
        return None
    size = formats.texture_size(fmt, width, height)
    gpu.stats['texture ' + fmt] += 1
    for surface in gpu.color_surfaces.values():            # une texture qui est un tampon de rendu : le rendre d'abord
        if surface.dirty and surface.address < address + size and address < surface.address + surface.width * surface.height * 4:
            gpu.flush_surface(surface)
    for surface in gpu.depth_surfaces.values():            # ou le tampon de profondeur (le terrain le relit en RGBA8)
        if surface.dirty and surface.address < address + size and                 address < surface.address + surface.width * surface.height * gpu.DEPTH_BYTES[surface.fmt]:
            gpu.flush_surface(surface)
    try:
        raw = gpu.memory.read(address, size)
    except Exception:
        gpu.notes['texture illisible'] += 1
        return None
    key = (address, width, height, fmt)
    crc = zlib.crc32(raw)
    entry = gpu.textures.get(key)
    if entry is None or entry[0] != crc:
        try:
            pixels = formats.decode_texture(fmt, raw, width, height)
        except Exception as exc:
            gpu.notes['texture %s illisible : %s' % (fmt, exc)] += 1
            return None
        if len(gpu.textures) > 80:
            gpu.textures.clear()
        gpu.textures[key] = entry = (crc, pixels)
    border = regs[border_reg]
    border_color = np.array([border & 255, border >> 8 & 255, border >> 16 & 255, border >> 24 & 255],
                            dtype=np.float32) / 255
    return entry[1], config >> 12 & 7, config >> 8 & 7, bool(config >> 1 & 1), border_color


def wrap_index(i, size, mode):
    mode &= 3
    valid = None
    if mode == 0:
        i = np.clip(i, 0, size - 1)
    elif mode == 1:
        valid = (i >= 0) & (i < size)
        i = np.clip(i, 0, size - 1)
    elif mode == 2:
        i = i % size
    else:
        m = i % (2 * size)
        i = np.where(m >= size, 2 * size - 1 - m, m)
    return i, valid


def sample(texture, u, v):
    pixels, wrap_s, wrap_t, linear, border = texture
    height, width = pixels.shape[:2]
    x = u.astype(np.float64) * width
    y = v.astype(np.float64) * height
    if FLIP_TEXTURES:
        y = height - y
    if not linear:
        ix, vx = wrap_index(np.floor(x).astype(np.int64), width, wrap_s)
        iy, vy = wrap_index(np.floor(y).astype(np.int64), height, wrap_t)
        out = pixels[iy, ix].astype(np.float32) / 255
        for valid in (vx, vy):
            if valid is not None:
                out = np.where(valid[:, None], out, border)
        return out
    x -= 0.5
    y -= 0.5
    x0, y0 = np.floor(x), np.floor(y)
    fx, fy = (x - x0).astype(np.float32)[:, None], (y - y0).astype(np.float32)[:, None]
    x0, y0 = x0.astype(np.int64), y0.astype(np.int64)
    total = 0
    for dx, dy, weight in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        ix, vx = wrap_index(x0 + dx, width, wrap_s)
        iy, vy = wrap_index(y0 + dy, height, wrap_t)
        texel = pixels[iy, ix].astype(np.float32) / 255
        for valid in (vx, vy):
            if valid is not None:
                texel = np.where(valid[:, None], texel, border)
        total = total + texel * weight
    return total


# --- le combinateur de textures ---

COLOR_MODIFIERS = {0: (None, False), 1: (None, True), 2: (3, False), 3: (3, True), 4: (0, False), 5: (0, True),
                   8: (1, False), 9: (1, True), 12: (2, False), 13: (2, True)}
ALPHA_MODIFIERS = {0: (3, False), 1: (3, True), 2: (0, False), 3: (0, True), 4: (1, False), 5: (1, True),
                   6: (2, False), 7: (2, True)}


def color_operand(source, modifier):
    channel, invert = COLOR_MODIFIERS.get(modifier, (None, False))
    value = source[:, :3] if channel is None else np.repeat(source[:, channel:channel + 1], 3, axis=1)
    return 1 - value if invert else value


def alpha_operand(source, modifier):
    channel, invert = ALPHA_MODIFIERS.get(modifier, (3, False))
    value = source[:, channel]
    return 1 - value if invert else value


def combine(op, s0, s1, s2, dot_is_alpha=False):
    if op == 0:
        r = s0
    elif op == 1:
        r = s0 * s1
    elif op == 2:
        r = s0 + s1
    elif op == 3:
        r = s0 + s1 - 0.5
    elif op == 4:
        r = s0 * s2 + s1 * (1 - s2)
    elif op == 5:
        r = s0 - s1
    elif op in (6, 7):
        d = 4 * ((s0 - 0.5) * (s1 - 0.5)).sum(axis=1) if s0.ndim == 2 else 4 * (s0 - 0.5) * (s1 - 0.5)
        r = np.repeat(d[:, None], 3, axis=1) if s0.ndim == 2 else d
    elif op == 8:
        r = s0 * s1 + s2
    elif op == 9:
        r = (s0 + s1) * s2
    else:
        r = s0
    return r


def byte_color(word):
    return np.array([word & 255, word >> 8 & 255, word >> 16 & 255, word >> 24 & 255], dtype=np.float32) / 255


def run_combiner(gpu, attributes, textures, lit=None):
    regs = gpu.regs
    m = len(attributes)
    primary = np.clip(attributes[:, 0:4], 0, 1)
    zero = np.zeros((m, 4), dtype=np.float32)
    secondary = zero
    if lit is not None:                         # éclairage : la couleur primaire de fragment vient des lumières
        fragment_primary, secondary = lit
    else:
        fragment_primary = primary
    sources = {0: primary, 1: fragment_primary, 2: secondary, 3: textures[0], 4: textures[1], 5: textures[2], 6: zero}
    buffer = zero
    next_buffer = np.broadcast_to(byte_color(regs[0xFD]), (m, 4))
    previous = zero
    update = regs[0xE0]
    for k, base in enumerate(STAGE_BASES):
        w0, w1, w2, w3, w4 = regs[base:base + 5]
        if w0 == 0x000F000F and w1 == 0 and w2 == 0 and w4 == 0:
            continue
        constant = np.broadcast_to(byte_color(w3), (m, 4))

        def fetch(code):
            if code == 0xF:
                return previous
            if code == 0xD:
                return buffer
            if code == 0xE:
                return constant
            return sources.get(code, zero)
        c = [color_operand(fetch(w0 >> (4 * i) & 15), w1 >> (4 * i) & 15) for i in range(3)]
        a = [alpha_operand(fetch(w0 >> (16 + 4 * i) & 15), w1 >> (12 + 4 * i) & 7) for i in range(3)]
        color_op, alpha_op = w2 & 15, w2 >> 16 & 15
        rgb = combine(color_op, c[0], c[1], c[2])
        alpha = combine(alpha_op if alpha_op < 6 or alpha_op > 7 else 0, a[0], a[1], a[2])
        if color_op == 7:
            alpha = rgb[:, 0]
        rgb = np.clip(rgb * (1, 2, 4)[min(w4 & 3, 2)], 0, 1)
        alpha = np.clip(alpha * (1, 2, 4)[min(w4 >> 16 & 3, 2)], 0, 1)
        output = np.empty((m, 4), dtype=np.float32)
        output[:, :3] = rgb
        output[:, 3] = alpha
        previous = output
        buffer = next_buffer
        if k < 4 and (update >> (8 + k) & 1 or update >> (12 + k) & 1):
            next_buffer = np.array(next_buffer)
            if update >> (8 + k) & 1:
                next_buffer[:, :3] = rgb
            if update >> (12 + k) & 1:
                next_buffer[:, 3] = alpha
    if previous is zero:
        previous = fragment_primary
    return previous


def used_texture_units(gpu):
    regs = gpu.regs
    used = set()
    for base in STAGE_BASES:
        w0 = regs[base]
        if w0 == 0x000F000F and regs[base + 1] == 0 and regs[base + 2] == 0 and regs[base + 4] == 0:
            continue
        for i in range(3):
            used.add(w0 >> (4 * i) & 15)
            used.add(w0 >> (16 + 4 * i) & 15)
    return {u - 3 for u in used if 3 <= u <= 5}


# --- la fusion avec les tampons ---

def blend_factor(code, src, dst, const):
    one = np.float32(1)
    if code == 0:
        return np.zeros_like(src[:, :3]), 0
    if code == 1:
        return np.ones_like(src[:, :3]), 0
    table = {2: src[:, :3], 3: one - src[:, :3], 4: dst[:, :3], 5: one - dst[:, :3],
             6: np.repeat(src[:, 3:4], 3, 1), 7: np.repeat(one - src[:, 3:4], 3, 1),
             8: np.repeat(dst[:, 3:4], 3, 1), 9: np.repeat(one - dst[:, 3:4], 3, 1),
             10: np.broadcast_to(const[:3], src[:, :3].shape), 11: np.broadcast_to(one - const[:3], src[:, :3].shape),
             12: np.broadcast_to(const[3], src[:, :3].shape), 13: np.broadcast_to(one - const[3], src[:, :3].shape),
             14: np.repeat(np.minimum(src[:, 3:4], one - dst[:, 3:4]), 3, 1)}
    return table.get(code, np.ones_like(src[:, :3])), 0


def alpha_factor(code, src, dst, const):
    one = np.float32(1)
    sa, da = src[:, 3], dst[:, 3]
    table = {0: np.zeros_like(sa), 1: np.ones_like(sa), 2: sa, 3: one - sa, 4: da, 5: one - da, 6: sa, 7: one - sa,
             8: da, 9: one - da, 10: np.full_like(sa, const[3]), 11: np.full_like(sa, 1 - const[3]),
             12: np.full_like(sa, const[3]), 13: np.full_like(sa, 1 - const[3]), 14: np.ones_like(sa)}
    return table.get(code, np.ones_like(sa))


def equation(code, a, b, sa, sb):
    if code == 0:
        return a * sa + b * sb
    if code == 1:
        return a * sa - b * sb
    if code == 2:
        return b * sb - a * sa
    if code == 3:
        return np.minimum(a, b)
    return np.maximum(a, b)


def logic_op(op, src, dst):
    """Les seize opérations logiques sur les octets de la source et du tampon."""
    s, d = src.astype(np.uint8), dst.astype(np.uint8)
    table = (lambda: np.zeros_like(s), lambda: s & d, lambda: s & ~d, lambda: s, lambda: np.full_like(s, 255),
             lambda: ~s, lambda: d, lambda: ~d, lambda: ~(s & d), lambda: s | d, lambda: ~(s | d), lambda: s ^ d,
             lambda: ~(s ^ d), lambda: ~s & d, lambda: s | ~d, lambda: ~s | d)
    return table[op]()


def stencil_apply(depth, x, y, op, ref, buffer_mask):
    """Une opération de pochoir (0 garder, 1 zéro, 2 remplacer, 3 et 4 monter et descendre en butée, 5 inverser, 6 et 7
    monter et descendre en boucle) sur les points (x, y) du tampon D24S8 ; seuls les bits de `buffer_mask` changent."""
    if not len(x) or op == 0:
        return
    pixels = depth.pixels[y, x]
    old = (pixels >> np.uint32(24)).astype(np.int64)
    new = {1: np.zeros_like(old), 2: np.full_like(old, ref), 3: np.minimum(old + 1, 255), 4: np.maximum(old - 1, 0),
           5: old ^ 255, 6: (old + 1) & 255, 7: (old - 1) & 255}[op]
    new = (new & buffer_mask) | (old & ~buffer_mask & 255)
    depth.pixels[y, x] = (pixels & np.uint32(0xFFFFFF)) | (new.astype(np.uint32) << np.uint32(24))
    depth.dirty = True


def merge(gpu, surface, depth, px, py, color, z):
    """Test de profondeur, mélange et écriture. Les fragments sont dans l'ordre des triangles."""
    regs = gpu.regs
    width = surface.width
    pix = py * width + px
    count = len(pix)
    owner = gpu.scratch(surface)
    owner[pix] = np.arange(count, dtype=np.int32)
    if (owner[pix] == np.arange(count, dtype=np.int32)).all():
        layers = [np.arange(count)]
    else:
        # des fragments se recouvrent : on les passe couche par couche, dans l'ordre des triangles
        order = np.argsort(pix, kind='stable')
        sorted_pix = pix[order]
        fresh = np.ones(count, dtype=bool)
        fresh[1:] = sorted_pix[1:] != sorted_pix[:-1]
        start = np.maximum.accumulate(np.where(fresh, np.arange(count), 0))
        rank = np.arange(count) - start
        layers = [order[rank == r] for r in range(int(rank.max()) + 1)]
    depth_cfg = regs[0x107]
    depth_test = bool(depth_cfg & 1) and depth is not None
    depth_func = depth_cfg >> 4 & 7
    depth_write = bool(depth_cfg >> 12 & 1) and depth is not None and (not gpu.seen[0x115] or regs[0x115] & 3)
    color_mask = depth_cfg >> 8 & 15
    color_write = (not gpu.seen[0x113]) or (regs[0x113] & 15)
    depth_mask = 0xFFFF if depth is not None and depth.fmt == 0 else 0xFFFFFF
    blending = bool(regs[0x100] >> 8 & 1)
    blend_cfg = regs[0x101]
    const = byte_color(regs[0x103])
    stencil_on = bool(regs[0x105] & 1) and depth is not None and depth.fmt == 3
    if stencil_on:
        s_func, s_buffer, s_ref, s_mask = regs[0x105] >> 4 & 7, regs[0x105] >> 8 & 255, regs[0x105] >> 16 & 255,             regs[0x105] >> 24 & 255
        s_ops = (regs[0x106] & 7, regs[0x106] >> 4 & 7, regs[0x106] >> 8 & 7)         # échec, échec de profondeur, réussite
    for sel in layers:
        x, y = px[sel], py[sel]
        zz = z[sel]
        if stencil_on:
            stored = depth.pixels[y, x] >> np.uint32(24)
            passed = COMPARE[s_func](np.full(len(x), s_ref & s_mask, dtype=np.int64), (stored & s_mask).astype(np.int64))
            if not passed.all():
                stencil_apply(depth, x[~passed], y[~passed], s_ops[0], s_ref, s_buffer)
                sel, x, y, zz = sel[passed], x[passed], y[passed], zz[passed]
                if not len(x):
                    continue
        if depth_test:
            current = depth.pixels[y, x] & depth_mask
            keep = COMPARE[depth_func](zz, current)
            if stencil_on and not keep.all():
                stencil_apply(depth, x[~keep], y[~keep], s_ops[1], s_ref, s_buffer)
            if not keep.any():
                continue
            sel, x, y, zz = sel[keep], x[keep], y[keep], zz[keep]
        if stencil_on:
            stencil_apply(depth, x, y, s_ops[2], s_ref, s_buffer)
        if depth_write:
            old = depth.pixels[y, x]
            depth.pixels[y, x] = (old & ~np.uint32(depth_mask)) | zz.astype(np.uint32)
            depth.dirty = True
        if not color_write:
            continue
        src = color[sel]
        if blending:
            dst = surface.pixels[y, x].astype(np.float32) / 255
            sf, _ = blend_factor(blend_cfg >> 16 & 15, src, dst, const)
            df, _ = blend_factor(blend_cfg >> 20 & 15, src, dst, const)
            rgb = equation(blend_cfg & 7, src[:, :3], dst[:, :3], sf, df)
            asf = alpha_factor(blend_cfg >> 24 & 15, src, dst, const)
            adf = alpha_factor(blend_cfg >> 28 & 15, src, dst, const)
            alpha = equation(blend_cfg >> 8 & 7, src[:, 3], dst[:, 3], asf, adf)
            out = np.concatenate([rgb, alpha[:, None]], axis=1)
        else:
            out = src
        bytes_ = (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)
        if not blending and gpu.seen[0x102] and regs[0x102] & 15 != 3:      # opération logique (3 : copie)
            bytes_ = logic_op(regs[0x102] & 15, bytes_, surface.pixels[y, x])
        if color_mask != 15:
            old = surface.pixels[y, x]
            for c in range(4):
                if not color_mask >> c & 1:
                    bytes_[:, c] = old[:, c]
        surface.pixels[y, x] = bytes_
        surface.dirty = True


# --- l'ordre de dessin ---

DEBUG = open(os.environ['PICA_DEBUG'], 'w') if os.environ.get('PICA_DEBUG') else None
BIG_TRIANGLE = 1500             # au-dessus (points de la boîte), un triangle est traité seul, sur une grille
FRAGMENT_BATCH = 1_000_000      # on éclaire et on fusionne par paquets de cette taille


def draw(gpu, indexed):
    regs = gpu.regs
    gpu.stats['dessins faits'] += 1
    surface = gpu.color_surface()
    if surface is None:
        gpu.notes['dessin sans tampon de couleur'] += 1
        return 0
    depth = gpu.depth_surface()
    ids = fetch_indices(gpu, indexed)
    if not len(ids):
        return 0
    unique, inverse = np.unique(ids, return_inverse=True)
    inputs = load_vertices(gpu, unique)
    topology = regs[0x25E] >> 8 & 3
    if regs[0x229] & 3 == 2:                                      # le shader de géométrie fait les triangles
        made = geometry_stage(gpu, vertex_stage(gpu, inputs), inverse.astype(np.int64))
        if made is None:
            return 1
        position, attributes, triangles = made
    else:
        position, attributes = run_vertex_shader(gpu, inputs)
        triangles = assemble(topology, inverse.astype(np.int64))
    if not len(triangles):
        return 1
    position, attributes, triangles = clip_near(position, attributes, triangles)
    if not len(triangles):
        return 1
    hx = float(f24_to_f32(regs[0x41] & 0xFFFFFF))
    hy = float(f24_to_f32(regs[0x43] & 0xFFFFFF))
    zscale = float(f24_to_f32(regs[0x4D] & 0xFFFFFF))
    zoffset = float(f24_to_f32(regs[0x4E] & 0xFFFFFF))
    corner_x, corner_y = regs[0x68] & 0x3FF, regs[0x68] >> 16 & 0x3FF
    if DEBUG is not None:
        DEBUG.write('draw n=%d topo=%d view=(%g,%g) corner=(%d,%d) zs=%g zo=%g scissor=%x/%x/%x dim=%x cull=%d surf=%dx%d pos0=%s\n' % (
            len(ids), topology, hx, hy, corner_x, corner_y, zscale, zoffset, regs[0x65], regs[0x66], regs[0x67],
            regs[0x11E], regs[0x40] & 3, surface.width, surface.height, position[:3].tolist()))
        DEBUG.flush()
    w = position[:, 3].astype(np.float64)
    good = w > 1e-12
    inv_w = np.where(good, 1 / np.where(good, w, 1), 0)
    sx = (position[:, 0] * inv_w + 1) * hx + corner_x
    # le matériel range les lignes à l'envers : la ligne 0 de la mémoire est le haut du tampon (hauteur - 1 - y)
    sy = surface.height - ((position[:, 1] * inv_w + 1) * hy + corner_y)
    sz = position[:, 2] * inv_w * zscale + zoffset
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    ok = good[a] & good[b] & good[c]
    area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sy[b] - sy[a]) * (sx[c] - sx[a])
    ok &= area != 0
    cull = regs[0x40] & 3
    # `area` est mesurée avec y vers le bas (les lignes sont à l'envers) : le sens est l'inverse de celui de l'espace
    # de l'écran de la console. Mode 1 : on garde le sens horaire, mode 2 : le sens antihoraire (vérifié sur le terrain :
    # sol et lampadaires entiers avec le mode 2).
    if cull == 1:
        ok &= area > 0
    elif cull == 2:
        ok &= area < 0
    triangles, area = triangles[ok], area[ok]
    if not len(triangles):
        return 1
    swap = area < 0
    a = triangles[:, 0]
    b = np.where(swap, triangles[:, 2], triangles[:, 1])
    c = np.where(swap, triangles[:, 1], triangles[:, 2])
    area = np.abs(area)
    gpu.stats['triangles'] += len(a)
    # couleur et trois jeux de coordonnées de texture ; avec l'éclairage, aussi la vue et le quaternion
    attributes = np.ascontiguousarray(attributes if lighting_on(gpu) else attributes[:, :11])    # 10 : le w de la texture 0
    ax, ay, bx, by, cx, cy = sx[a], sy[a], sx[b], sy[b], sx[c], sy[c]
    x_min, y_min, x_max, y_max = 0, 0, surface.width - 1, surface.height - 1
    if regs[0x65] & 3 == 3:
        x_min, y_min = max(x_min, regs[0x66] & 0x3FF), max(y_min, regs[0x66] >> 16 & 0x3FF)
        x_max, y_max = min(x_max, regs[0x67] & 0x3FF), min(y_max, regs[0x67] >> 16 & 0x3FF)
    x0 = np.maximum(np.ceil(np.minimum(np.minimum(ax, bx), cx) - 0.5).astype(np.int64), x_min)
    x1 = np.minimum(np.floor(np.maximum(np.maximum(ax, bx), cx) - 0.5).astype(np.int64), x_max)
    y0 = np.maximum(np.ceil(np.minimum(np.minimum(ay, by), cy) - 0.5).astype(np.int64), y_min)
    y1 = np.minimum(np.floor(np.maximum(np.maximum(ay, by), cy) - 0.5).astype(np.int64), y_max)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    counts = np.where((bw > 0) & (bh > 0), bw * bh, 0)
    if not counts.any():
        return 1

    def owns(dx, dy):              # règle du haut et de la gauche : un bord appartient à un seul des deux triangles
        return (dy > 0) | ((dy == 0) & (dx < 0))
    setup = dict(ax=ax, ay=ay, bx=bx, by=by, cx=cx, cy=cy, area=area, x0=x0, y0=y0, bw=bw, bh=bh, counts=counts,
                 own_a=owns(cx - bx, cy - by), own_b=owns(ax - cx, ay - cy), own_c=owns(bx - ax, by - ay),
                 z0=sz[a], z1=sz[b], z2=sz[c], iw0=inv_w[a], iw1=inv_w[b], iw2=inv_w[c], ia=a, ib=b, ic=c,
                 attributes=attributes)
    if regs[0x80] >> 10 & 1:
        gpu.notes['texture 3 (textures procédurales) non faite'] += 1
    textures = {}
    for unit in used_texture_units(gpu):
        if regs[0x80] >> unit & 1:
            textures[unit] = get_texture(gpu, unit)
            if textures[unit] is None:
                gpu.notes['texture %d introuvable' % unit] += 1
    pending, pending_count = [], 0
    for batch in fragment_batches(setup):
        pending.append(batch)
        pending_count += len(batch[0])
        if pending_count >= FRAGMENT_BATCH:
            shade_and_merge(gpu, surface, depth, textures, pending)
            pending, pending_count = [], 0
    if pending:
        shade_and_merge(gpu, surface, depth, textures, pending)
    return 1


def fragment_batches(s):
    """Les fragments des triangles, dans l'ordre : des paquets (px, py, z, attributs interpolés)."""
    counts = s['counts']
    total_triangles = len(counts)
    i = 0
    while i < total_triangles:
        count = counts[i]
        if count == 0:
            i += 1
            continue
        if count >= BIG_TRIANGLE:
            batch = single_triangle(s, i)
            i += 1
        else:
            j, total = i, 0
            while j < total_triangles and counts[j] < BIG_TRIANGLE and (total + counts[j] <= MAX_CANDIDATES or j == i):
                total += counts[j]
                j += 1
            batch = triangle_group(s, i, j)
            i = j
        if batch is not None and len(batch[0]):
            yield batch


def single_triangle(s, i):
    x0, y0, bw, bh = int(s['x0'][i]), int(s['y0'][i]), int(s['bw'][i]), int(s['bh'][i])
    ax, ay, bx, by, cx, cy = (s[k][i] for k in ('ax', 'ay', 'bx', 'by', 'cx', 'cy'))
    xs = np.arange(x0, x0 + bw) + 0.5
    ys = np.arange(y0, y0 + bh) + 0.5
    ea = ((cx - bx) * (ys - by))[:, None] - ((cy - by) * (xs - bx))[None, :]
    eb = ((ax - cx) * (ys - cy))[:, None] - ((ay - cy) * (xs - cx))[None, :]
    ec = ((bx - ax) * (ys - ay))[:, None] - ((by - ay) * (xs - ax))[None, :]
    inside = (ea >= 0 if s['own_a'][i] else ea > 0) & (eb >= 0 if s['own_b'][i] else eb > 0) & \
             (ec >= 0 if s['own_c'][i] else ec > 0)
    iy, ix = np.nonzero(inside)
    if not len(iy):
        return None
    inv_area = 1 / s['area'][i]
    l0, l1, l2 = ea[iy, ix] * inv_area, eb[iy, ix] * inv_area, ec[iy, ix] * inv_area
    attributes = s['attributes']
    return interpolate(x0 + ix, y0 + iy, l0, l1, l2, s['z0'][i], s['z1'][i], s['z2'][i], s['iw0'][i], s['iw1'][i],
                       s['iw2'][i], attributes[s['ia'][i]], attributes[s['ib'][i]], attributes[s['ic'][i]], True)


def triangle_group(s, i, j):
    counts = s['counts'][i:j]
    live = np.nonzero(counts)[0] + i
    if not len(live):
        return None
    cnt = s['counts'][live]
    n = int(cnt.sum())
    tri = np.repeat(live, cnt)
    first = np.cumsum(cnt) - cnt
    local = np.arange(n) - np.repeat(first, cnt)
    width = s['bw'][tri]
    px = s['x0'][tri] + local % width
    py = s['y0'][tri] + local // width
    pxc, pyc = px + 0.5, py + 0.5
    ax, ay, bx, by, cx, cy = (s[k][tri] for k in ('ax', 'ay', 'bx', 'by', 'cx', 'cy'))
    ea = (cx - bx) * (pyc - by) - (cy - by) * (pxc - bx)
    eb = (ax - cx) * (pyc - cy) - (ay - cy) * (pxc - cx)
    ec = (bx - ax) * (pyc - ay) - (by - ay) * (pxc - ax)
    inside = ((ea > 0) | ((ea == 0) & s['own_a'][tri])) & ((eb > 0) | ((eb == 0) & s['own_b'][tri])) & \
             ((ec > 0) | ((ec == 0) & s['own_c'][tri]))
    if not inside.any():
        return None
    tri, px, py = tri[inside], px[inside], py[inside]
    inv_area = 1 / s['area'][tri]
    l0, l1, l2 = ea[inside] * inv_area, eb[inside] * inv_area, ec[inside] * inv_area
    attributes = s['attributes']
    return interpolate(px, py, l0, l1, l2, s['z0'][tri], s['z1'][tri], s['z2'][tri], s['iw0'][tri], s['iw1'][tri],
                       s['iw2'][tri], attributes[s['ia'][tri]], attributes[s['ib'][tri]], attributes[s['ic'][tri]],
                       False)


def interpolate(px, py, l0, l1, l2, z0, z1, z2, iw0, iw1, iw2, A0, A1, A2, scalar):
    """Profondeur et attributs d'un paquet de fragments. `scalar` : les données du triangle sont celles d'un seul."""
    z = l0 * z0 + l1 * z1 + l2 * z2
    keep = (z >= 0) & (z <= 1)
    if not keep.all():
        px, py, l0, l1, l2, z = px[keep], py[keep], l0[keep], l1[keep], l2[keep], z[keep]
        if not len(px):
            return None
        if not scalar:
            iw0, iw1, iw2 = iw0[keep], iw1[keep], iw2[keep]
            A0, A1, A2 = A0[keep], A1[keep], A2[keep]
    q0, q1, q2 = l0 * iw0, l1 * iw1, l2 * iw2
    norm = 1 / (q0 + q1 + q2)
    q0, q1, q2 = q0 * norm, q1 * norm, q2 * norm
    q0, q1, q2 = q0.astype(np.float32), q1.astype(np.float32), q2.astype(np.float32)
    frag = q0[:, None] * A0 + q1[:, None] * A1 + q2[:, None] * A2
    return px, py, z, frag


def lighting_on(gpu):
    """L'éclairage par fragment est allumé quand le jeu a écrit le registre 0x1C6 et que son bit « éteint » est à zéro
    (c'est ce que fait Citra ; le jeu écrit aussi 0x8F, dont le sens exact n'est pas vérifié)."""
    return bool(gpu.seen[0x1C6]) and not gpu.regs[0x1C6] & 1


def apply_fog(gpu, color, z):
    """Le brouillard : un facteur lu dans la table selon la profondeur (128 entrées, interpolées), mélange avec sa couleur."""
    regs = gpu.regs
    depth = np.clip(z, 0, 1)
    if regs[0xE0] >> 16 & 1:
        depth = 1 - depth
    pos = depth * 127.999
    index = pos.astype(np.int64)
    factor = np.clip(gpu.fog[index, 0] + gpu.fog[index, 1] * (pos - index), 0, 1).astype(np.float32)
    fog_color = byte_color(regs[0xE1])[:3]
    out = np.array(color)
    out[:, :3] = color[:, :3] * factor[:, None] + fog_color[None, :] * (1 - factor[:, None])
    return out


def texture_uv(regs, unit, frag):
    """Les coordonnées (u, v) d'une unité de texture pour des fragments. L'unité 0 lit le jeu 0 (et le divise par son w
    si son type est « projection » : bits 28-30 de 0x83 égaux à 3) ; l'unité 1 le jeu 1 ; l'unité 2 le jeu 2, ou le jeu 1
    si le bit 13 de 0x80 est levé."""
    if unit == 0:
        u, v = frag[:, 4], frag[:, 5]
        if regs[0x83] >> 28 & 7 == 3:
            w = frag[:, 10]
            safe = np.where(w == 0, np.float32(1), w)
            return np.where(w == 0, 0, u / safe), np.where(w == 0, 0, v / safe)
        return u, v
    if unit == 1 or regs[0x80] >> 13 & 1:
        return frag[:, 6], frag[:, 7]
    return frag[:, 8], frag[:, 9]


def shade_and_merge(gpu, surface, depth, textures, batches):
    regs = gpu.regs
    if len(batches) == 1:
        px, py, z, frag = batches[0]
    else:
        px, py, z, frag = (np.concatenate([b[k] for b in batches]) for k in range(4))
    if regs[0x65] & 3 == 1:                                      # ciseaux qui excluent : le rectangle est retiré
        inside = (px >= (regs[0x66] & 0x3FF)) & (px <= (regs[0x67] & 0x3FF)) &                  (py >= (regs[0x66] >> 16 & 0x3FF)) & (py <= (regs[0x67] >> 16 & 0x3FF))
        if inside.any():
            outside = ~inside
            px, py, z, frag = px[outside], py[outside], z[outside], frag[outside]
            if not len(px):
                return
    scale = 0xFFFF if depth is not None and depth.fmt == 0 else 0xFFFFFF
    zint = (z * scale + 0.5).astype(np.uint32)
    samples = {}
    for unit in range(3):
        if unit in textures:
            texture = textures[unit]
            u, v = texture_uv(regs, unit, frag)
            if texture is None:
                samples[unit] = np.tile(np.array([1, 0, 1, 1], dtype=np.float32), (len(frag), 1))
            else:
                samples[unit] = sample(texture, u, v)
        else:
            samples[unit] = np.zeros((len(frag), 4), dtype=np.float32)
    lit = None
    if lighting_on(gpu):
        zero = np.zeros((len(frag), 4), dtype=np.float32)
        lit = lighting.shade(regs, gpu.luts, frag, [samples[0], samples[1], samples[2], zero])
    color = run_combiner(gpu, frag, samples, lit)
    if regs[0xE0] & 7 == 5:
        color = apply_fog(gpu, color, z)
    if regs[0x104] & 1:
        reference = regs[0x104] >> 8 & 255
        alpha = (color[:, 3] * 255 + 0.5).astype(np.int64)
        passed = COMPARE[regs[0x104] >> 4 & 7](alpha, reference)
        if not passed.all():
            color, px, py, zint = color[passed], px[passed], py[passed], zint[passed]
            if not len(px):
                return
    gpu.stats['fragments'] += len(px)
    merge(gpu, surface, depth, px, py, color, zint)
