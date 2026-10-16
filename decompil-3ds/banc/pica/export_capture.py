"""Exporter une capture du GPU (fichier `.pkl` de `replay.py`) vers le format neutre du portage PC (Rust).

    python banc/pica/export_capture.py local/analyse/pica/np.pkl local/portage/captures/titre.picacap

Le `.pkl` est propre à Python (pickle de l'objet `Gpu`) ; le portage Rust ne doit pas dépendre de ça. Le format neutre
(décrit dans `portage/README.md`, section « Le format de capture ») est une suite de blocs `étiquette(4) | longueur(u32) |
contenu`, tout en petit-boutiste :

    PICACAP\\0 | version u32 | nombre de blocs u32
    REGS  nombre N u32, N valeurs u32, N octets « vu »
    SHDR  code 4096 u32, descripteurs 4096 u32, uniformes 96x4 f32, attributs fixes 16x4 f32
    GSTA  indices et files en attente des ports à auto-incrément (voir `STATE_FIELDS`)
    FOGT  table du brouillard 128x2 f32
    LUTS  tables d'éclairage 24x256x2 f32
    MEMR  une région de mémoire : adresse u32, taille u32, codec u32 (0 brut, 1 zlib), octets
    CMDW  une commande de la file de gsp : 8 mots u32, longueur u32, octets (la liste de commandes du GPU, si commande 1)

Les captures du vrai jeu vivent dans `local/` et ne sont jamais versionnées.
"""
import os
import pickle
import struct
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))

MAGIC = b'PICACAP\0'
VERSION = 1
STATE_FIELDS = ('code_offset', 'swizzle_offset', 'fixed_index', 'uniform_index', 'uniform_f32', 'fog_row',
                'lut_which', 'lut_row')


class _Stub:
    """Remplace les classes de `pica/` à la lecture : on ne veut que leurs attributs, sans dépendre du code du banc
    (qui change et peut être en cours de modification)."""


class _Unpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module.split('.')[0] == 'pica':
            return _Stub
        return super().find_class(module, name)


def decode_fog_word(word):
    """Une entrée de la table de brouillard : bits 13-23 la valeur, bits 0-12 la différence (signée), sur 2048 (comme
    `Gpu.decode_fog` du banc)."""
    diff = word & 0x1FFF
    return (word >> 13 & 0x7FF) / 2048.0, (diff - 0x2000 if diff & 0x1000 else diff) / 2048.0


def fog_table(gpu):
    """La table du brouillard dans la lecture actuelle, même pour un enregistrement d'avant (lecture inversée, que le banc
    a corrigée depuis : on refait la conversion comme son `__setstate__`)."""
    words = getattr(gpu, 'fog_words', None)
    if words is None:
        old = np.asarray(gpu.fog)
        words = [((int(round(old[r][1] * 2048)) & 0x7FF) << 13) | (int(round(old[r][0] * 2048)) & 0x1FFF) for r in range(128)]
    return np.array([decode_fog_word(int(w)) for w in words], dtype=np.float32)


PHYSICAL_RANGES = ((0x20000000, 0x28000000, 0x14000000), (0x18000000, 0x18600000, 0x1F000000))
MAX_JUMPS = 20000


class Photo:
    """La mémoire de la photo (régions décompressées), en lecture seule, pour suivre les sauts de liste."""

    def __init__(self, regions):
        self.regions = [(start, zlib.decompress(blob)) for start, blob in regions]

    def read(self, address, size):
        for start, data in self.regions:
            if start <= address and address + size <= start + len(data):
                return data[address - start:address - start + size]
        return None


def follow_jumps(photo, data):
    """Comme `follow_jumps` de `banc/services/gsp.py` (0x238-0x23D : sauts du processeur de commandes), recopié ici pour
    que l'exporteur ne dépende pas du code du banc. Utilisé pour les anciens `.pkl` dont la chaîne était coupée."""
    out = []
    regs = {}
    for _ in range(MAX_JUMPS + 1):
        words = struct.unpack('<%dI' % (len(data) // 4), data[:len(data) // 4 * 4])
        i = 0
        target = None
        while i + 1 < len(words) and target is None:
            header = words[i + 1]
            register = header & 0xFFFF
            extra = header >> 20 & 0x7FF
            consecutive = header >> 31
            if i + 2 + extra > len(words):
                i = len(words)
                break
            for k in range(1 + extra):
                reg = register + (k if consecutive else 0)
                regs[reg] = words[i] if k == 0 else words[i + 1 + k]
                if reg in (0x23C, 0x23D) and regs[reg] & 1:
                    target = reg - 0x23C
            i += 2 + extra + (extra & 1)
        out.append(data[:i * 4] if target is not None else data)
        if target is None:
            break
        physical, size = regs.get(0x23A + target, 0) * 8, regs.get(0x238 + target, 0) * 8
        address = next((virtual + physical - low for low, high, virtual in PHYSICAL_RANGES if low <= physical < high), 0)
        data = photo.read(address, size) if address and size else None
        if not data:
            break
    return b''.join(out)


def chunk(tag, payload):
    assert len(tag) == 4
    return tag + struct.pack('<I', len(payload)) + payload


def u32s(values):
    return struct.pack('<%dI' % len(values), *[int(v) & 0xFFFFFFFF for v in values])


def f32s(array):
    return np.ascontiguousarray(array, dtype='<f4').tobytes()


def export(source, destination):
    """Lit `source` (.pkl de replay.py) et écrit `destination` (.picacap). Rend (régions, commandes, octets écrits)."""
    with open(source, 'rb') as stream:
        saved = pickle.load(stream)
    import io
    gpu = _Unpickler(io.BytesIO(saved['gpu'])).load()
    chunks = []
    regs = list(gpu.regs)
    chunks.append(chunk(b'REGS', u32s([len(regs)]) + u32s(regs) + bytes(gpu.seen)[:len(regs)].ljust(len(regs), b'\0')))
    shader = gpu.shader
    code = list(shader.code) + [0] * (4096 - len(shader.code))
    swizzle = list(shader.swizzle) + [0] * (4096 - len(shader.swizzle))
    chunks.append(chunk(b'SHDR', u32s(code[:4096]) + u32s(swizzle[:4096]) + f32s(np.asarray(shader.uniforms).reshape(96, 4))
                        + f32s(np.asarray(gpu.fixed).reshape(16, 4))))
    state = [gpu.code_offset, gpu.swizzle_offset, gpu.fixed_index, gpu.uniform_index, int(gpu.uniform_f32), gpu.fog_row,
             gpu.luts.which, gpu.luts.row]
    fixed_pending, uniform_pending = list(gpu.fixed_pending), list(gpu.uniform_pending)
    chunks.append(chunk(b'GSTA', u32s(state + [len(fixed_pending), len(uniform_pending)] + fixed_pending + uniform_pending)))
    chunks.append(chunk(b'FOGT', f32s(fog_table(gpu).reshape(128, 2))))
    chunks.append(chunk(b'LUTS', f32s(np.asarray(gpu.luts.table).reshape(24, 256, 2))))
    for address, blob in saved['regions']:
        size = len(zlib.decompress(blob))
        chunks.append(chunk(b'MEMR', u32s([address, size, 1]) + blob))
    events = saved['events']
    if saved.get('sauts') != 2:        # enregistré quand la chaîne de sauts était coupée à 64 : on la suit en entier
        photo = Photo(saved['regions'])
        events = [(words, follow_jumps(photo, photo.read(words[1], words[2]) or b'')
                   if data is not None and words[0] & 0xFF == 1 else data) for words, data in events]
    for words, data in events:
        words = list(words) + [0] * (8 - len(words))
        data = data or b''
        chunks.append(chunk(b'CMDW', u32s(words[:8]) + u32s([len(data)]) + bytes(data)))
    os.makedirs(os.path.dirname(os.path.abspath(destination)), exist_ok=True)
    with open(destination, 'wb') as out:
        out.write(MAGIC + struct.pack('<II', VERSION, len(chunks)))
        for c in chunks:
            out.write(c)
        total = out.tell()
    return len(saved['regions']), len(saved['events']), total


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    regions, events, total = export(argv[0], argv[1])
    print('capture : %d régions, %d commandes, %d octets -> %s' % (regions, events, total, argv[1]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
