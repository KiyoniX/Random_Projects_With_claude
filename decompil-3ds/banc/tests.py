"""Les tests du banc : python banc/tests.py

1. Sans dump : un petit programme ARM fabriqué ici (quelques mots de code machine, aucun octet du jeu) se connecte à
   `srv:`, s'inscrit, demande `ptm:u`, lui envoie GetStepHistory, crée un événement et un second fil plus prioritaire
   qui dort 1 ms puis lève l'événement, attend cet événement, puis quitte. On vérifie le journal, les réponses,
   l'ordonnancement et l'horloge du banc.
2. Les pièces seules : la mémoire (alias), la table des poignées, la police (relogement), le romfs fabriqué.
3. Avec le dump, s'il est dans local/ : le vrai jeu doit atteindre le palier P1.
"""
import os
import shutil
import struct
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bench as bench_module  # noqa: E402
from cpu_unicorn import UnicornCpu  # noqa: E402
from memory import PERM_RW, AddressSpace  # noqa: E402

CODE_BASE = 0x00100000
DATA_BASE = 0x00101000


class Assembler:
    """Juste ce qu'il faut d'ARM pour le programme d'essai, chaque constante dans une réserve de littéraux."""

    def __init__(self, base):
        self.base = base
        self.words = []
        self.literals = []          # (index du mot à corriger, valeur)
        self.labels = {}
        self.fixups = []            # (index, étiquette) pour les branchements et les adresses d'étiquettes

    def here(self):
        return self.base + 4 * len(self.words)

    def label(self, name):
        self.labels[name] = self.here()

    def emit(self, word):
        self.words.append(word & 0xFFFFFFFF)

    def ldr_const(self, rd, value):
        self.literals.append((len(self.words), value))
        self.emit(0xE59F0000 | rd << 12)

    def ldr_label(self, rd, name):
        self.literals.append((len(self.words), name))
        self.emit(0xE59F0000 | rd << 12)

    def mov(self, rd, rm):
        self.emit(0xE1A00000 | rd << 12 | rm)

    def svc(self, number):
        self.emit(0xEF000000 | number)

    def str_(self, rt, rn, offset):
        self.emit(0xE5800000 | rn << 16 | rt << 12 | offset)

    def ldr(self, rt, rn, offset):
        self.emit(0xE5900000 | rn << 16 | rt << 12 | offset)

    def tls(self, rd):
        self.emit(0xEE1D0F70 | rd << 12)          # mrc p15, 0, rd, c13, c0, 3

    def loop_forever(self):
        self.emit(0xEAFFFFFE)

    def build(self):
        pool_start = len(self.words)
        values = []
        for index, value in self.literals:
            if isinstance(value, str):
                value = self.labels[value]
            slot = pool_start + len(values)
            values.append(value)
            offset = 4 * slot - (4 * index + 8)
            self.words[index] |= offset
        return struct.pack('<%dI' % (len(self.words) + len(values)), *(self.words + values))


def test_program():
    a = Assembler(CODE_BASE)
    a.ldr_label(1, 'srv_name')
    a.svc(0x2D)                                  # ConnectToPort("srv:")
    a.ldr_const(4, DATA_BASE)
    a.str_(1, 4, 0)
    a.tls(5)
    a.ldr_const(0, 0x00010002)                   # RegisterClient
    a.str_(0, 5, 0x80)
    a.ldr_const(0, 0x20)
    a.str_(0, 5, 0x84)
    a.ldr(0, 4, 0)
    a.svc(0x32)
    a.ldr_const(0, 0x00050100)                   # GetServiceHandle("ptm:u")
    a.str_(0, 5, 0x80)
    a.ldr_const(0, struct.unpack('<I', b'ptm:')[0])
    a.str_(0, 5, 0x84)
    a.ldr_const(0, struct.unpack('<I', b'u\0\0\0')[0])
    a.str_(0, 5, 0x88)
    a.ldr_const(0, 5)
    a.str_(0, 5, 0x8C)
    a.ldr_const(0, 0)
    a.str_(0, 5, 0x90)
    a.ldr(0, 4, 0)
    a.svc(0x32)
    a.ldr(0, 5, 0x8C)
    a.str_(0, 4, 4)                              # la poignée de ptm:u
    a.ldr_const(0, 0x000B00C2)                   # GetStepHistory : 4 heures dans un tampon de 8 octets
    a.str_(0, 5, 0x80)
    a.ldr_const(0, 4)
    a.str_(0, 5, 0x84)
    a.ldr_const(0, 0)
    a.str_(0, 5, 0x88)
    a.str_(0, 5, 0x8C)
    a.ldr_const(0, 8 << 4 | 0xC)
    a.str_(0, 5, 0x90)
    a.ldr_const(0, DATA_BASE + 0x40)
    a.str_(0, 5, 0x94)
    a.ldr(0, 4, 4)
    a.svc(0x32)
    a.ldr_const(1, 0)                            # CreateEvent(ONESHOT)
    a.svc(0x17)
    a.str_(1, 4, 8)
    a.ldr_const(0, 0x20)                         # CreateThread : priorité 0x20, plus forte que celle du principal
    a.ldr_label(1, 'thread2')
    a.mov(2, 1)
    a.ldr(2, 4, 8)                               # argument : l'événement
    a.ldr_const(3, DATA_BASE + 0x800)            # haut de pile du second fil
    a.ldr_const(4, 0xFFFFFFFE)
    a.svc(0x08)
    a.ldr_const(4, DATA_BASE)
    a.str_(1, 4, 12)
    a.ldr(0, 4, 8)                               # WaitSynchronization1(événement, sans limite)
    a.ldr_const(2, 0xFFFFFFFF)
    a.ldr_const(3, 0xFFFFFFFF)
    a.svc(0x24)
    a.str_(0, 4, 16)
    a.svc(0x03)                                  # ExitProcess
    a.loop_forever()
    a.label('thread2')
    a.mov(6, 0)
    a.ldr_const(0, 1_000_000)                    # SleepThread(1 ms)
    a.ldr_const(1, 0)
    a.svc(0x0A)
    a.mov(0, 6)
    a.svc(0x18)                                  # SignalEvent
    a.svc(0x09)                                  # ExitThread
    a.loop_forever()
    a.label('srv_name')
    a.emit(struct.unpack('<I', b'srv:')[0])
    a.emit(0)
    return a.build()


def make_exheader(code_size):
    exheader = bytearray(0x400)
    exheader[0:8] = b'essai\0\0\0'
    struct.pack_into('<III', exheader, 0x10, CODE_BASE, 1, code_size)
    struct.pack_into('<I', exheader, 0x1C, 0x4000)
    struct.pack_into('<III', exheader, 0x20, 0x00100800, 0, 0)
    struct.pack_into('<III', exheader, 0x30, DATA_BASE, 1, 0x1000)
    struct.pack_into('<I', exheader, 0x3C, 0)
    exheader[0x20F] = 0x30
    struct.pack_into('<I', exheader, 0x370, 0xFC000223)
    return bytes(exheader)


def no_files(out):
    paths = {key: os.path.join(out, 'absent') for key in bench_module.DEFAULT_PATHS}
    paths['out'] = out
    return paths


def test_synthetic():
    out = tempfile.mkdtemp(prefix='banc-essai-')
    try:
        program = test_program()
        code = program.ljust(0x1000, b'\0') + bytes(0x1000)
        b = bench_module.Bench(UnicornCpu, paths=no_files(out), options={'seconds': 1},
                               code=code, exheader=make_exheader(len(program)))
        reason = b.run()
        b.journal.close()
        journal = open(b.journal.path, encoding='utf-8').read()
        mem = b.memory
        assert 'svcExitProcess' in reason, reason
        assert 'IPC srv: 00010002 RegisterClient' in journal, journal
        assert 'IPC srv: 00050100 GetServiceHandle' in journal and 'ptm:u -> Ptm' in journal
        assert 'IPC ptm:u 000b00c2 GetStepHistory' in journal
        ptm_handle = mem.u32(DATA_BASE + 4)
        assert ptm_handle and b.kernel.lookup(ptm_handle) is not None
        assert mem.read(DATA_BASE + 0x40, 8) == bytes(8)
        assert mem.u32(DATA_BASE + 16) == 0, 'WaitSynchronization1 devait rendre 0, pas %#x' % mem.u32(DATA_BASE + 16)
        assert b.kernel.now >= 1_000_000, 'le réveil doit attendre 1 ms du banc'
        threads = b.kernel.threads
        assert len(threads) == 2 and threads[1].state == 'fini' and threads[1].priority == 0x20
        order = [line for line in journal.splitlines() if 'SleepThread' in line or 'WaitSynchronization1' in line]
        assert 'SleepThread' in order[0], 'le second fil, plus prioritaire, doit passer avant l\'attente du principal'
    finally:
        shutil.rmtree(out, ignore_errors=True)
    print('banc : programme d\'essai — srv:, IPC vers ptm:u, événement, second fil prioritaire, sommeil, horloge.')


def test_pieces():
    mem = AddressSpace()
    region = mem.map(0x08000000, 0x2000, PERM_RW, 'tas')
    mem.map(0x00665000, 0x2000, PERM_RW, 'miroir', region.backing, 0)
    mem.w32(0x08001004, 0x12345678)
    assert mem.u32(0x00666004) == 0x12345678
    mem.unmap(0x00665000, 0x1000)
    assert not mem.is_mapped(0x00665000) and mem.u32(0x00666004) == 0x12345678
    from kernel import HandleTable
    table = HandleTable()
    first = table.add('a')
    table.remove(first)
    second = table.add('b')
    assert first != second and table.get(first) is None and table.get(second) == 'b'
    from services.apt import relocate_bcfnt
    font = bytearray(0x200)
    font[0x80:0x84] = b'CFNT'
    struct.pack_into('<H', font, 0x86, 0x14)
    struct.pack_into('<I', font, 0x90, 3)
    finf = 0x80 + 0x14
    font[finf:finf + 4] = b'FINF'
    struct.pack_into('<I', font, finf + 4, 0x20)
    tglp, cwdh, cmap = finf + 0x20, finf + 0x40, finf + 0x60
    struct.pack_into('<III', font, finf + 0x10, tglp - 0x80 + 8, cwdh - 0x80 + 8, cmap - 0x80 + 8)
    font[tglp:tglp + 4] = b'TGLP'
    struct.pack_into('<I', font, tglp + 4, 0x20)
    struct.pack_into('<I', font, tglp + 0x1C, 0x100)
    font[cwdh:cwdh + 4] = b'CWDH'
    struct.pack_into('<I', font, cwdh + 4, 0x20)
    font[cmap:cmap + 4] = b'CMAP'
    struct.pack_into('<I', font, cmap + 4, 0x20)
    struct.pack_into('<I', font, 0x90, 4)
    delta = relocate_bcfnt(font, 0x1B800000)
    assert delta == 0x1B800080
    assert struct.unpack_from('<I', font, finf + 0x10)[0] == 0x1B800000 + tglp + 8
    print('banc : alias de mémoire, poignées réutilisées, relogement d\'une police fabriquée.')


# --- le processeur graphique (pica/), sans dump : des données fabriquées ---

def test_pica():
    import numpy as np
    from pica import formats, transfer
    from pica.gpu import Gpu
    from pica.shader import VertexShader, f24_to_f32, f32_to_f24

    # 1. le détuilage de Morton : (1,0) est le point 1 de la tuile, (0,1) le 2, (2,0) le 4 ; aller-retour exact
    assert formats.MORTON[0, 1] == 1 and formats.MORTON[1, 0] == 2 and formats.MORTON[0, 2] == 4
    assert formats.MORTON[7, 7] == 63
    rng = np.random.default_rng(1)
    image = rng.integers(0, 256, size=(16, 24, 4), dtype=np.uint8)
    tiled = formats.linear_to_tiled(image, 4)
    assert np.array_equal(formats.tiled_to_linear(tiled.tobytes(), 24, 16, 4), image)
    # la deuxième tuile (x de 8 à 15) commence 256 octets plus loin
    assert np.array_equal(tiled[256:260], image[0, 8])
    # 2. des formats : RGB565 pur rouge, RGBA4, LA8, A4, et un bloc ETC1 uni
    px = formats.decode_pixels('RGB565', np.array([[[0x00, 0xF8]]], dtype=np.uint8))
    assert px[0, 0].tolist() == [255, 0, 0, 255]
    px = formats.decode_pixels('RGBA4', np.array([[[0x0F, 0xF0]]], dtype=np.uint8))
    assert px[0, 0].tolist() == [255, 0, 0, 255]
    la = np.zeros(8 * 8 * 2, dtype=np.uint8)
    la[0], la[1] = 0x40, 0xC0                       # alpha 0x40, luminance 0xC0 pour le point (0,0)
    assert formats.decode_texture('LA8', la.tobytes(), 8, 8)[0, 0].tolist() == [0xC0, 0xC0, 0xC0, 0x40]
    a4 = np.zeros(32, dtype=np.uint8)
    a4[0] = 0xF1                                    # point 0 : alpha 1 (nibble bas), point 1 : alpha 15
    out = formats.decode_texture('A4', a4.tobytes(), 8, 8)
    assert out[0, 0, 3] == 17 and out[0, 1, 3] == 255
    block = bytes([0, 0, 0, 0, 0x02, 0x80, 0x80, 0x80])          # ETC1 uni : base 16 (-> 132), modificateur +2
    flat = formats.decode_etc1_blocks(np.frombuffer(block, dtype=np.uint8).reshape(1, 8))
    assert (flat == 134).all()
    # 3. un transfert vers l'écran : RGBA8 en tuiles, 16 x 8 -> RGB8 en lignes, rogné à 12 x 8, retourné
    mem = AddressSpace()
    mem.map(0x1F000000, 0x10000, PERM_RW, 'vram')
    src = np.zeros((8, 16, 4), dtype=np.uint8)
    src[..., 0] = np.arange(16)[None, :]            # R = x
    src[..., 1] = np.arange(8)[:, None]             # G = y
    src[..., 3] = 255
    mem.write(0x1F000000, formats.linear_to_tiled(formats.encode_pixels('RGBA8', src), 4).tobytes())
    transfer.display_transfer(mem, 0x1F000000, 0x1F004000, 16 | 8 << 16, 12 | 8 << 16, 1 | 1 << 12 | 4)
    out = np.frombuffer(mem.read(0x1F004000, 12 * 8 * 3), dtype=np.uint8).reshape(8, 12, 3)[..., ::-1]
    assert out[0, 5].tolist() == [5, 7, 0] and out[7, 3].tolist() == [3, 0, 0]     # retourné : la ligne 0 est y = 7
    # une copie de texture par lignes : 2 lignes de 16 octets prises tous les 32 octets, posées à la suite
    mem.write(0x1F008000, bytes(range(256)) * 1)
    transfer.texture_copy(mem, 0x1F008000, 0x1F009000, 32, 1 | 1 << 16, 1 | 0 << 16, 8)
    assert mem.read(0x1F009000, 32) == mem.read(0x1F008000, 16) + mem.read(0x1F008020, 16)
    # 4. des flottants 24 bits
    assert abs(float(f24_to_f32(f32_to_f24(np.float32(-3.5)))) + 3.5) < 1e-6
    # 5. des instructions de shader : DP4 avec une constante, puis MUL et ADD d'entrées, sorties dans o0 et o1
    sh = VertexShader()
    ident1 = (0 << 11) | (1 << 9) | (2 << 7) | (3 << 5)
    ident2 = (0 << 20) | (1 << 18) | (2 << 16) | (3 << 14)
    desc = 0xF | ident1 | ident2
    sh.swizzle[0] = desc
    sh.swizzle[1] = 0xF | ident1 | ident2 | (1 << 4)                # source 1 niée
    sh.uniforms[0] = (1, 2, 3, 4)
    sh.code[0] = 0x02 << 26 | 0 << 21 | 0x20 << 12 | 0 << 7 | 0              # DP4 o0, c0, v0
    sh.code[1] = 0x08 << 26 | 1 << 21 | 0 << 12 | 1 << 7 | 0                 # MUL o1, v0, v1
    sh.code[2] = 0x00 << 26 | 2 << 21 | 0 << 12 | 1 << 7 | 1                 # ADD o2, -v0, v1
    sh.code[3] = 0x22 << 26
    inputs = np.zeros((2, 16, 4), dtype=np.float32)
    inputs[0, 0] = (1, 1, 1, 1)
    inputs[1, 0] = (2, 0, 0, 1)
    inputs[:, 1] = (0.5, 2, 3, 4)
    out = sh.run(inputs)
    assert out[0, 0].tolist() == [10] * 4 and out[1, 0].tolist() == [6] * 4          # 1+2+3+4, 2+0+0+4
    assert out[1, 1].tolist() == [1, 0, 0, 4]
    assert out[0, 2].tolist() == [-0.5, 1, 2, 3]
    # 6. une liste de commandes : écritures consécutives et masque d'octets
    gpu = Gpu(mem)
    gpu.process_list(struct.pack('<4I', 0x11, 0x000F00C1 | 2 << 20 | 1 << 31, 0x22, 0x33), draw=False)
    assert gpu.regs[0xC1:0xC4] == [0x11, 0x22, 0x33]
    gpu.process_list(struct.pack('<2I', 0xAABBCCDD, 0x00050101), draw=False)      # octets 0 et 2 seulement
    assert gpu.regs[0x101] == 0x00BB00DD
    # 7. un triangle de bout en bout : shader MOV, attributs flottants, combinateur « couleur du sommet », 16 x 16
    memory = AddressSpace()
    memory.map(0x1F000000, 0x10000, PERM_RW, 'vram')
    memory.map(0x14000000, 0x10000, PERM_RW, 'tas')
    vertices = np.array([[-1, -1, 0, 1, 1, 0, 0, 1], [1, -1, 0, 1, 1, 0, 0, 1], [-1, 1, 0, 1, 1, 0, 0, 1]],
                        dtype=np.float32)
    memory.write(0x14000000, vertices.tobytes())
    gpu = Gpu(memory)
    w = gpu.write
    w(0x2CB, 0)
    gpu.stream(0x2CC, (0x13 << 26 | 0 << 21 | 0 << 12, 0x13 << 26 | 1 << 21 | 1 << 12, 0x22 << 26))
    w(0x2D5, 0)
    gpu.stream(0x2D6, (desc,))
    w(0x2BA, 0)
    w(0x200, 0x20000000 >> 3)
    w(0x201, 0xFF)
    w(0x202, 1 << 28)
    w(0x203, 0)
    w(0x204, 0x10)
    w(0x205, 32 << 16 | 2 << 28)
    w(0x2BB, 0x10)
    w(0x2BD, 3)
    w(0x50, 0x03020100)
    w(0x51, 0x0B0A0908)
    w(0x41, int(f32_to_f24(np.float32(8))))
    w(0x43, int(f32_to_f24(np.float32(8))))
    w(0x4D, int(f32_to_f24(np.float32(1))))
    w(0xC0, 0)                                           # étage 0 : couleur du sommet, « remplacer »
    w(0x11D, 0x18000000 >> 3)
    w(0x11E, 16 | 15 << 12)
    w(0x117, 0)
    w(0x228, 3)
    w(0x22E, 1)
    gpu.flush()
    pic = formats.decode_pixels('RGBA8', formats.tiled_to_linear(memory.read(0x1F000000, 16 * 16 * 4), 16, 16, 4))
    # les lignes de la mémoire sont à l'envers : le bas du triangle (y = -1) est la dernière ligne
    assert pic[13, 2].tolist() == [255, 0, 0, 255], pic[13, 2]         # dans le triangle, en bas à gauche
    assert pic[2, 13].tolist() == [0, 0, 0, 0], pic[2, 13]             # de l'autre côté de la diagonale
    covered = int((pic[..., 3] > 0).sum())
    assert 120 <= covered <= 136, covered                              # la moitié de 16 x 16, bord compris
    # 8. un étage du combinateur : texture 0 fois couleur du sommet, doublée
    from pica import raster
    gpu = Gpu(memory)
    gpu.regs[0xC0] = 3 | 0 << 4 | 3 << 16 | 0 << 20           # sources 1 : texture 0, 2 : couleur primaire
    gpu.regs[0xC2] = 1 | 1 << 16                              # modulation
    gpu.regs[0xC4] = 1                                        # couleur x2
    attributes = np.zeros((2, 10), dtype=np.float32)
    attributes[:, 0:4] = (0.25, 0.5, 1.0, 0.5)
    tex = np.tile(np.array([[0.5, 0.5, 0.25, 1.0]], dtype=np.float32), (2, 1))
    color = raster.run_combiner(gpu, attributes, {0: tex, 1: tex * 0, 2: tex * 0})
    assert np.allclose(color[0], [0.25, 0.5, 0.5, 0.5]), color[0]
    # 8 bis. une texture : la ligne 0 de la mémoire est le haut (v = 1) ; répétition et bordure
    pixels = np.zeros((8, 8, 4), dtype=np.uint8)
    pixels[0] = (255, 0, 0, 255)
    pixels[1:] = (0, 255, 0, 255)
    border = np.array([0, 0, 1, 1], dtype=np.float32)
    top = raster.sample((pixels, 2, 2, False, border), np.array([0.5]), np.array([0.95]))
    low = raster.sample((pixels, 2, 2, False, border), np.array([0.5]), np.array([0.2]))
    assert top[0].tolist() == [1, 0, 0, 1] and low[0].tolist() == [0, 1, 0, 1]
    wrapped = raster.sample((pixels, 2, 2, False, border), np.array([1.5]), np.array([0.2]))
    assert wrapped[0].tolist() == [0, 1, 0, 1]                                # répétition
    outside = raster.sample((pixels, 1, 1, False, border), np.array([1.5]), np.array([0.2]))
    assert outside[0].tolist() == [0, 0, 1, 1]                                # couleur de bordure
    # 9. la conversion YUV vers RGB de y2r:u : gris moyen et rouge pur (Rec. 601, pleine plage)
    from services.stubs import yuv_to_rgb
    gray = yuv_to_rgb(np.full((1, 1), 128, np.float32), np.zeros((1, 1), np.float32), np.zeros((1, 1), np.float32), 2)
    assert gray[0, 0].tolist() == [128, 128, 128]
    red = yuv_to_rgb(np.full((1, 1), 76, np.float32), np.full((1, 1), -43, np.float32), np.full((1, 1), 127, np.float32), 2)
    assert red[0, 0, 0] > 250 and red[0, 0, 1] < 5 and red[0, 0, 2] < 5, red
    print('banc : pica : Morton, formats, transferts, shader, liste de commandes, triangle, combinateur.')


def test_real_game():
    code = bench_module.DEFAULT_PATHS['code']
    if not os.path.isfile(code):
        print('banc : pas de code.bin dans local/, essai sur le vrai jeu sauté.')
        return
    out = tempfile.mkdtemp(prefix='banc-jeu-')
    try:
        paths = {'out': out}
        b = bench_module.Bench(UnicornCpu, paths=paths, options={'seconds': 0.002, 'log_all_svc': False})
        reason = b.run()
        b.journal.close()
        assert 'P1' in b.journal.milestones, (reason, list(b.journal.milestones))
        print('banc : le vrai jeu atteint %s en %.3f ms du banc (arrêt : %s).' % (
            b.highest_milestone(), b.kernel.now / 1e6, reason))
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test():
    test_pieces()
    test_pica()
    test_synthetic()
    test_real_game()


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    test()
