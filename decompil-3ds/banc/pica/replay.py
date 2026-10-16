"""Enregistrer puis rejouer quelques images du GPU, sans relancer le jeu (secondes au lieu de minutes).

Enregistrement (dans le banc, avec `--dessiner`) : `PICA_ENREGISTRER=fichier.pkl` ; `PICA_ENREGISTRER_DE=S1,S2,...` (secondes du
banc, défaut 0 ; un fichier par instant, suffixé s'il y en a plusieurs) ; `PICA_ENREGISTRER_IMAGES=N` (nombre d'images, c'est-à-dire de paires de transferts vers l'écran, défaut 2).
À la première commande de transfert vers l'écran après la seconde S, on prend une photo de la mémoire que le GPU peut lire
(le tas linéaire et la mémoire vidéo) et de l'état des registres ; puis on note chaque commande de la file de gsp (listes,
remplissages, copies, transferts) jusqu'à la fin des N images.

Rejeu :
    python banc/pica/replay.py fichier.pkl --sortie local/analyse/pica/rejeu [--images] [--tout]
recharge la photo, rejoue les commandes avec le vrai code de `pica/` et écrit les deux écrans après chaque transfert.
Des variables comme PICA_DEBUG ou PICA_CIBLES marchent comme dans le banc.

Limite : le processeur du jeu continue d'écrire dans la mémoire pendant l'enregistrement ; la photo est celle du début,
donc un tampon de sommets réécrit au milieu d'une image est vu dans son état d'avant.
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

RANGES = ((0x14000000, 0x1C000000), (0x1F000000, 0x1F600000))     # tas linéaire et mémoire vidéo, adresses du jeu


class Recorder:
    def __init__(self, path, starts, frames):
        self.base, self.starts, self.frames = path, list(starts), frames
        self.path, self.start = self.next_path(), self.starts.pop(0)
        self.state = None                # None : pas commencé ; 1 : on enregistre ; 2 : fini
        self.events = []
        self.transfers = 0
        self.snapshot = None

    def next_path(self):
        if len(self.starts) <= 1:
            return self.base
        return self.base.replace('.pkl', '-%g.pkl' % self.starts[0])

    def take_snapshot(self, memory, gpu):
        gpu.flush()
        regions = []
        for region in memory.regions:
            lo, hi = max(region.start, RANGES[0][0]), min(region.end, RANGES[0][1])
            for low, high in RANGES:
                lo, hi = max(region.start, low), min(region.end, high)
                if lo < hi:
                    regions.append((lo, zlib.compress(memory.read(lo, hi - lo), 1)))
        saved = gpu.memory, gpu.journal, gpu.color_surfaces, gpu.depth_surfaces, gpu.textures, gpu.shader_cache
        gpu.memory = gpu.journal = None
        gpu.color_surfaces, gpu.depth_surfaces, gpu.textures, gpu.shader_cache = {}, {}, {}, {}
        try:
            blob = pickle.dumps(gpu)
        finally:
            gpu.memory, gpu.journal, gpu.color_surfaces, gpu.depth_surfaces, gpu.textures, gpu.shader_cache = saved
        self.snapshot = (regions, blob)

    def before(self, words, memory, gpu, now):
        """Avant l'exécution d'une commande de la file."""
        if self.state != 1:
            return
        command = words[0] & 0xFF
        data = memory.read(words[1], words[2]) if command == 1 else None
        if data is not None:
            from services.gsp import follow_jumps          # les listes chaînées par les registres de saut
            data = follow_jumps(memory, data)
        self.events.append((tuple(words), data))

    def after(self, words, memory, gpu, now):
        """Après l'exécution d'une commande de la file."""
        if self.state == 2:
            return
        if words[0] & 0xFF != 3:
            return
        if self.state is None:
            if now >= self.start:
                self.take_snapshot(memory, gpu)
                self.state = 1
            return
        self.transfers += 1
        if self.transfers >= 2 * self.frames:
            self.state = 2
            with open(self.path, 'wb') as out:
                pickle.dump({'regions': self.snapshot[0], 'gpu': self.snapshot[1], 'events': self.events, 'sauts': 2}, out)
            print('PICA : %d commandes enregistrées dans %s' % (len(self.events), self.path))
            if self.starts:                                        # un autre instant à photographier
                self.path, self.start = self.next_path(), self.starts.pop(0)
                self.state, self.events, self.transfers = None, [], 0


def from_environment():
    path = os.environ.get('PICA_ENREGISTRER')
    if not path:
        return None
    starts = [float(t) for t in os.environ.get('PICA_ENREGISTRER_DE', '0').split(',')]
    return Recorder(path, starts,
                    int(os.environ.get('PICA_ENREGISTRER_IMAGES', '2')))


def load(path):
    """Rend (mémoire, gpu, événements) prêts à rejouer."""
    from memory import AddressSpace
    from pica.gpu import Gpu
    with open(path, 'rb') as source:
        saved = pickle.load(source)
    memory = AddressSpace()
    for start, blob in saved['regions']:
        data = zlib.decompress(blob)
        memory.map(start, (len(data) + 0xFFF) // 0x1000 * 0x1000, 3, 'photo')
        memory.write(start, data)
    gpu = pickle.loads(saved['gpu'])
    gpu.memory = memory
    events = saved['events']
    if saved.get('sauts') != 2:        # enregistré quand la chaîne de sauts était coupée à 64 : on la suit en entier
        from services.gsp import follow_jumps
        events = [(words, follow_jumps(memory, memory.read(words[1], words[2]))
                   if data is not None and words[0] & 0xFF == 1 else data) for words, data in events]
    gpu.color_surfaces, gpu.depth_surfaces, gpu.textures, gpu.shader_cache = (
        __import__('collections').OrderedDict(), __import__('collections').OrderedDict(), {}, {})
    return memory, gpu, events


def run_command(memory, gpu, words, data, on_transfer=None):
    """Une commande de la file, comme `Gsp.execute` (seulement ce qui touche au rendu)."""
    from pica import transfer
    command = words[0] & 0xFF
    if command in (0, 2, 3, 4):
        if command == 3:
            gpu.flush()
        else:
            gpu.invalidate()
    if command == 0:
        source, destination, size = words[1:4]
        memory.write(destination, memory.read(source, size))
    elif command == 1:
        gpu.process_list(data, draw=True)
    elif command == 2:
        for start, value, end, control in ((words[1], words[2], words[3], words[7] & 0xFFFF),
                                           (words[4], words[5], words[6], words[7] >> 16)):
            if start:
                width = (control >> 8) & 3
                pattern = struct.pack('<I', value)[:(2, 3, 4)[min(width, 2)]]
                size = end - start
                memory.write(start, (pattern * (size // len(pattern) + 1))[:size])
    elif command == 3:
        source, destination, in_dim, out_dim, flags = words[1:6]
        problem = transfer.display_transfer(memory, source, destination, in_dim, out_dim, flags)
        if on_transfer and not problem:
            on_transfer(destination, in_dim, out_dim, flags)
    elif command == 4:
        transfer.texture_copy(memory, *words[1:7])


def main(argv):
    import argparse
    from pica import formats
    parser = argparse.ArgumentParser(description="Rejouer des images du GPU enregistrées par le banc")
    parser.add_argument('fichier')
    parser.add_argument('--sortie', default=os.path.join('local', 'analyse', 'pica', 'rejeu'))
    parser.add_argument('--jusqua', type=int, default=0, help='nombre maximal de commandes à rejouer')
    args = parser.parse_args(argv)
    os.makedirs(args.sortie, exist_ok=True)
    memory, gpu, events = load(args.fichier)
    count = [0]

    def on_transfer(destination, in_dim, out_dim, flags):
        fmt = formats.GX_FORMATS[flags >> 12 & 7]
        unit = formats.BYTES_PER_PIXEL[fmt]
        columns_count, rows = out_dim >> 16, out_dim & 0xFFFF       # 400 (ou 320) colonnes de 240 points, de bas en haut
        raw = memory.read(destination, columns_count * rows * unit)
        columns = np.frombuffer(raw, dtype=np.uint8).reshape(columns_count, rows, unit)
        image = np.ascontiguousarray(formats.decode_pixels(fmt, columns).transpose(1, 0, 2)[::-1, :, :3])
        count[0] += 1
        formats.write_png(os.path.join(args.sortie, 'ecran-%02d-%s.png' % (count[0], 'haut' if columns_count == 400 else 'bas')),
                          image)

    import time
    start = time.perf_counter()
    for k, (words, data) in enumerate(events):
        if args.jusqua and k >= args.jusqua:
            break
        run_command(memory, gpu, words, data, on_transfer)
    gpu.flush()
    print('rejeu : %d commandes en %.1f s ; %s' % (len(events), time.perf_counter() - start, dict(gpu.stats)))
    for text, n in gpu.notes.items():
        print('  PICA : %s (%d)' % (text, n))


if __name__ == '__main__':
    main(sys.argv[1:])
