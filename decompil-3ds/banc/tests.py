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
    # 5 bis. un branchement qui diverge (CMP puis IFC selon v0.x > 0) : les sommets sont séparés en deux groupes, le résultat
    # est celui de chaque sommet seul
    sh = VertexShader()
    sh.swizzle[0] = desc
    sh.swizzle[1] = 0xF | ident1 | ident2 | (1 << 4)
    sh.code[0] = 0x2E << 26 | 4 << 24 | 6 << 21 | 0x10 << 7                     # CMP v0, r0 : x plus grand ?
    sh.code[1] = 0x28 << 26 | 1 << 25 | 2 << 22 | 3 << 10 | 1                   # IFC (x vrai) : instruction 2, sinon 3
    sh.code[2] = 0x13 << 26 | 1 << 12 | 0                                         # MOV o0, v1
    sh.code[3] = 0x13 << 26 | 1 << 12 | 1                                         # MOV o0, -v1
    sh.code[4] = 0x22 << 26
    inputs = np.zeros((5, 16, 4), dtype=np.float32)
    inputs[:, 0, 0] = (1, -1, 2, -2, 3)
    inputs[:, 1] = np.arange(1, 6)[:, None] * np.array([1, 2, 3, 4], dtype=np.float32)[None, :]
    out = sh.run(inputs)
    expected = inputs[:, 1] * np.where(inputs[:, 0, 0] > 0, 1, -1)[:, None]
    assert np.array_equal(out[:, 0], expected), out[:, 0]
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
    # 7 bis. les ciseaux qui excluent : le rectangle x de 0 à 7 est retiré du dessin
    surface = next(iter(gpu.color_surfaces.values()))
    surface.pixels[:] = 0
    w(0x65, 1)
    w(0x66, 0)
    w(0x67, 7 | 15 << 16)
    w(0x228, 3)
    w(0x22E, 1)
    gpu.flush()
    pic = formats.decode_pixels('RGBA8', formats.tiled_to_linear(memory.read(0x1F000000, 16 * 16 * 4), 16, 16, 4))
    assert pic[13, 2].tolist() == [0, 0, 0, 0] and pic[15, 12].tolist() == [255, 0, 0, 255], (pic[13, 2], pic[15, 12])
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
    # 8 ter. l'éclairage : une lumière directionnelle de face (diffus orange), puis une table de consultation en rampe
    from pica import lighting
    from pica.gpu import Surface
    gpu = Gpu(memory)
    w = gpu.write
    w(0x1C2, 0)
    w(0x1D9, 0)
    w(0x1C4, 0xFF00FF00)                                      # spot et atténuation de distance éteints
    w(0x149, 1)                                               # lumière 0 directionnelle
    w(0x144, 0)
    w(0x145, 0x3C00)                                          # direction (0, 0, 1) en flottants de 16 bits
    w(0x142, 255 << 20 | 128 << 10)                           # diffus : rouge 255, vert 128, bleu 0
    frag = np.zeros((2, 18), dtype=np.float32)
    frag[:, 17] = 1                                           # quaternion neutre : la normale est (0, 0, 1)
    frag[:, 13] = 1
    primary, secondary = lighting.shade(gpu.regs, gpu.luts, frag)
    assert np.allclose(primary[0], [1, 128 / 255, 0, 1]) and np.allclose(secondary[0, :3], 0), primary[0]
    frag[1, 14:18] = (0, 0.7071068, 0, 0.7071068)            # normale tournée de 90 degrés : (1, 0, 0), plus de diffus
    primary, _ = lighting.shade(gpu.regs, gpu.luts, frag)
    assert np.allclose(primary[1, :3], 0, atol=1e-5), primary[1]
    w(0x1C5, 0)                                               # table D0 : valeur = ligne / 256, différence 1/256
    for row in range(256):
        w(0x1C8, 16 << 12 | row * 16)
    x = np.array([0.5, -0.5], dtype=np.float32)
    assert np.allclose(lighting.lookup(gpu.luts, 0, x, False), [0.5, 0]), 'les négatives valent 0 sans « deux faces »'
    assert np.allclose(lighting.lookup(gpu.luts, 0, x, False, True), 0.5)         # deux faces : valeur absolue
    assert np.allclose(lighting.lookup(gpu.luts, 0, x, True), [0.25, 0.75])       # signé : les négatives sont les lignes 128 à 255
    w(0x1C3, 0)                                               # un spéculaire : D0 (la rampe) fois la couleur spéculaire 0
    w(0x140, 255 << 20 | 255 << 10 | 255)
    w(0x1D1, 0)                                               # D0 lit N.H
    w(0x1D0, 0)
    frag = np.zeros((1, 18), dtype=np.float32)
    frag[:, 17] = 1
    frag[:, 13] = 1
    _, secondary = lighting.shade(gpu.regs, gpu.luts, frag)
    assert secondary[0, 0] > 0.9, secondary                   # N.H = 1 : la rampe vaut presque 1
    w(0x1D2, 6)                                               # échelle 1/4 sur la sortie de D0
    _, secondary = lighting.shade(gpu.regs, gpu.luts, frag)
    assert 0.2 < secondary[0, 0] < 0.3, secondary             # l'échelle multiplie la sortie, pas l'entrée
    w(0x1D2, 0)
    w(0x1C3, 1 << 4)                                          # mode 1 : pas de D0 ; le spéculaire devient la couleur nue
    _, secondary = lighting.shade(gpu.regs, gpu.luts, frag)
    assert secondary[0, 0] == 1, secondary
    w(0x1C4, 0xFF00FF00 | 1 << 16)                            # D0 éteinte par 0x1C4 : même résultat qu'une table absente
    w(0x1C3, 0)
    _, secondary = lighting.shade(gpu.regs, gpu.luts, frag)
    assert secondary[0, 0] == 1, secondary
    w(0x1C4, 0xFF00FF00)
    # l'atténuation de distance : table DA0 = 0,5 partout, lumière ponctuelle à 1 (échelle 1, biais 0 en flottants de 20 bits)
    w(0x149, 0)
    w(0x1C4, 0xFE00FF00 | 0)                                  # atténuation de distance de la lumière 0 allumée
    w(0x14A, 0)
    w(0x14B, 63 << 12)                                        # échelle : exposant 63 = 1,0
    w(0x1C5, 16 << 8)
    for row in range(256):
        w(0x1C8, 2048)
    w(0x144, 0)
    w(0x145, 0)                                               # lumière à l'origine : la direction est la vue elle-même
    frag[:, 11:14] = (0, 0, 0.25)
    primary, _ = lighting.shade(gpu.regs, gpu.luts, frag)
    assert np.allclose(primary[0, 0], 0.5, atol=1e-3), primary       # diffus rouge 1 fois N.L 1 fois 0,5
    w(0x1C4, 0xFF00FF00)
    # le Fresnel : sortie vers l'alpha primaire, seulement avec un mode qui a la table (mode 1)
    w(0x149, 1)
    w(0x145, 0x3C00)
    w(0x1C5, 3 << 8)
    for row in range(256):
        w(0x1C8, 1024)                                        # table FR = 0,25
    w(0x1D1, 0)
    w(0x1C3, 1 << 4 | 1 << 2)
    primary, _ = lighting.shade(gpu.regs, gpu.luts, frag)
    assert np.allclose(primary[0, 3], 0.25), primary
    w(0x1C3, 0 << 4 | 1 << 2)                                 # mode 0 : pas de Fresnel, l'alpha reste 1
    primary, _ = lighting.shade(gpu.regs, gpu.luts, frag)
    assert primary[0, 3] == 1, primary
    # 8 quater. le brouillard : facteur lu dans la table selon la profondeur, mélangé à la couleur du brouillard
    gpu = Gpu(memory)
    w = gpu.write
    w(0xE6, 0)
    for entry in range(128):                                   # valeur = entrée / 128 sur 11 bits (bits 13-23, x 2048), pente nulle
        w(0xE8, entry * 16 << 13)
    w(0xE1, 0x00FF0000)                                        # couleur du brouillard : bleu
    colors = np.tile(np.array([[1, 1, 1, 1]], dtype=np.float32), (2, 1))
    fogged = raster.apply_fog(gpu, colors, np.array([0.0, 0.5], dtype=np.float32))
    assert np.allclose(fogged[0], [0, 0, 1, 1], atol=1e-3), fogged[0]          # profondeur 0 : facteur 0, tout brouillard
    assert np.allclose(fogged[1], [0.5, 0.5, 1, 1], atol=0.02), fogged[1]      # profondeur 0,5 : facteur 0,5
    # le décodage d'une entrée : valeur en haut (11 bits), différence signée en bas (13 bits) ; relevé sur le terrain, où la
    # table vaut 1,0 partout puis descend (l'ancienne lecture donnait des facteurs de 4 et collait le brouillard partout)
    value, diff = Gpu.decode_fog(2047 << 13 | (0x2000 - 3))
    assert abs(value - 2047 / 2048) < 1e-9 and abs(diff + 3 / 2048) < 1e-9, (value, diff)
    gpu.fog_row = 5
    gpu.write(0xE8, 1024 << 13 | 7)
    assert gpu.fog[5].tolist() == [0.5, 7 / 2048] and gpu.fog_row == 6, gpu.fog[5]
    # 8 quinquies. les opérations logiques et le pochoir
    src = np.array([[0b1100, 0b1010]], dtype=np.uint8)
    dst = np.array([[0b1010, 0b0110]], dtype=np.uint8)
    assert raster.logic_op(1, src, dst).tolist() == [[0b1000, 0b0010]]       # et
    assert raster.logic_op(11, src, dst).tolist() == [[0b0110, 0b1100]]      # ou exclusif
    assert raster.logic_op(0, src, dst).tolist() == [[0, 0]] and raster.logic_op(4, src, dst).tolist() == [[255, 255]]
    gpu = Gpu(memory)
    depth = Surface(0x1F000000, 4, 1, 3)
    depth.pixels = np.array([[0x00ABCDEF | 5 << 24, 0x00000001 | 255 << 24, 0, 0]], dtype=np.uint32)
    xs, ys = np.array([0, 1]), np.array([0, 0])
    raster.stencil_apply(depth, xs, ys, 3, 0, 255)                                   # monter en butée
    assert depth.pixels[0, 0] >> 24 == 6 and depth.pixels[0, 1] >> 24 == 255 and depth.pixels[0, 0] & 0xFFFFFF == 0xABCDEF
    raster.stencil_apply(depth, xs, ys, 6, 0, 255)                                   # monter en boucle
    assert depth.pixels[0, 1] >> 24 == 0
    raster.stencil_apply(depth, xs, ys, 2, 0x42, 0x0F)                               # remplacer sous un masque
    assert depth.pixels[0, 0] >> 24 == (0x07 & ~0x0F & 255 | 0x42 & 0x0F), hex(depth.pixels[0, 0])
    # le test de pochoir dans une fusion : ne passent que les points où le pochoir vaut la référence
    surface = Surface(0x1F000000, 4, 1, 'RGBA8')
    surface.pixels = np.zeros((1, 4, 4), dtype=np.uint8)
    depth = Surface(0x1F001000, 4, 1, 3)
    depth.pixels = np.array([[0x00FFFFFF | 1 << 24, 0x00FFFFFF | 2 << 24, 0x00FFFFFF | 1 << 24, 0x00FFFFFF | 2 << 24]],
                            dtype=np.uint32)
    gpu = Gpu(memory)
    gpu.regs[0x105] = 1 | 2 << 4 | 255 << 8 | 1 << 16 | 255 << 24             # pochoir : égal à 1
    gpu.regs[0x106] = 0 | 0 << 4 | 3 << 8                                      # réussite : monter
    gpu.regs[0x107] = 0x0F00
    gpu.regs[0x100] = 0
    color = np.tile(np.array([[1, 0, 0, 1]], dtype=np.float32), (4, 1))
    raster.merge(gpu, surface, depth, np.arange(4), np.zeros(4, dtype=np.int64), color, np.zeros(4, dtype=np.uint32))
    assert surface.pixels[0, :, 0].tolist() == [255, 0, 255, 0], surface.pixels
    assert (depth.pixels[0] >> 24).tolist() == [2, 2, 2, 2], depth.pixels >> 24
    # 8 sexies. le sens des faces : le triangle (-1,-1), (1,-1), (-1,1) est antihoraire dans l'espace de la console (y vers le
    # haut) ; le mode 2 garde l'antihoraire, le mode 1 l'horaire (relevé sur le terrain : sol et lampadaires entiers en mode 2)
    def triangle_gpu(order, cull, z=0.0):
        """Un GPU sur 16 x 16 prêt à dessiner en rouge le triangle donné (trois sommets (x, y)) : rend (mémoire, gpu)."""
        mem2 = AddressSpace()
        mem2.map(0x1F000000, 0x10000, PERM_RW, 'vram')
        mem2.map(0x14000000, 0x10000, PERM_RW, 'tas')
        verts = np.array([[x, y, z, 1, 1, 0, 0, 1] for x, y in order], dtype=np.float32)
        mem2.write(0x14000000, verts.tobytes())
        g = Gpu(mem2)
        put = g.write
        put(0x2CB, 0)
        g.stream(0x2CC, (0x13 << 26 | 0 << 21 | 0 << 12, 0x13 << 26 | 1 << 21 | 1 << 12, 0x22 << 26))
        put(0x2D5, 0)
        g.stream(0x2D6, (desc,))
        put(0x2BA, 0)
        put(0x200, 0x20000000 >> 3)
        put(0x201, 0xFF)
        put(0x202, 1 << 28)
        put(0x203, 0)
        put(0x204, 0x10)
        put(0x205, 32 << 16 | 2 << 28)
        put(0x2BB, 0x10)
        put(0x2BD, 3)
        put(0x50, 0x03020100)
        put(0x51, 0x0B0A0908)
        put(0x41, int(f32_to_f24(np.float32(8))))
        put(0x43, int(f32_to_f24(np.float32(8))))
        put(0x4D, int(f32_to_f24(np.float32(1))))
        put(0x40, cull)
        put(0xC0, 0)
        put(0x11D, 0x18000000 >> 3)
        put(0x11E, 16 | 15 << 12)
        put(0x117, 0)
        put(0x228, 3)
        return mem2, g

    def covered_points(mem2):
        image = formats.decode_pixels('RGBA8', formats.tiled_to_linear(mem2.read(0x1F000000, 16 * 16 * 4), 16, 16, 4))
        return int((image[..., 3] > 0).sum())
    ccw, cw = [(-1, -1), (1, -1), (-1, 1)], [(-1, -1), (-1, 1), (1, -1)]
    results = {}
    for name, order in (('ccw', ccw), ('cw', cw)):
        for cull in (0, 1, 2):
            mem2, g2 = triangle_gpu(order, cull)
            g2.write(0x22E, 1)
            g2.flush()
            results[name, cull] = covered_points(mem2)
    assert results['ccw', 0] > 100 and results['cw', 0] > 100, results                          # sans élimination : les deux
    assert results['ccw', 2] > 100 and results['cw', 2] == 0, results                           # mode 2 : antihoraire gardé
    assert results['cw', 1] > 100 and results['ccw', 1] == 0, results                           # mode 1 : horaire gardé
    # 8 septies. le découpage aux plans proche (z = -w) et lointain (z = 0) : un sommet au-delà du plan lointain est coupé
    # et le polygone obtenu (deux triangles) reste dans le volume ; les attributs sont interpolés avec la position
    position = np.array([[0, 0, -0.5, 1], [0, 1, 0.5, 1], [1, 0, -0.5, 1]], dtype=np.float32)
    attributes = np.zeros((3, 2), dtype=np.float32)
    attributes[1] = (10, 20)
    out_p, out_a, out_t = raster.clip_near(position, attributes, np.array([[0, 1, 2]]))
    assert len(out_t) == 2 and (out_p[np.unique(out_t)][:, 2] <= 1e-6).all(), (out_p, out_t)
    cut = out_p[:, 2] == 0                                                                      # les deux sommets sur le plan
    assert cut.sum() == 2 and np.allclose(out_a[cut][:, 0], 5) and np.allclose(out_a[cut][:, 1], 10), out_a      # à mi-chemin
    behind = np.array([[0, 0, -0.5, 1], [0, 1, -0.5, 1], [1, 0, -2.0, -1]], dtype=np.float32)    # un sommet derrière l'œil
    out_p, _, out_t = raster.clip_near(behind, np.zeros((3, 1), dtype=np.float32), np.array([[0, 1, 2]]))
    assert len(out_t) == 2 and (out_p[np.unique(out_t)][:, 3] > 0).all(), out_p                   # tous les w sont positifs
    far = np.array([[0, 0, 0.5, 1], [0, 1, 0.5, 1], [1, 0, 0.5, 1]], dtype=np.float32)
    assert len(raster.clip_near(far, np.zeros((3, 1), dtype=np.float32), np.array([[0, 1, 2]]))[2]) == 0    # tout au-delà : rien
    # 8 octies. le tampon de profondeur relu comme une texture RGBA8 (l'effet de contour du jeu) : il faut le rendre à la
    # mémoire avant la lecture. Triangle à la profondeur 0,5 (échelle 0, décalage 0,5) dans un tampon D24S8 de 16 x 16
    mem2, g2 = triangle_gpu(ccw, 0)
    g2.write(0x4D, 0)
    g2.write(0x4E, int(f32_to_f24(np.float32(0.5))))
    g2.write(0x11C, 0x18004000 >> 3)
    g2.write(0x116, 3)
    g2.write(0x107, 0x1F11)                                    # test de profondeur « toujours », écriture de la profondeur
    g2.write(0x22E, 1)
    g2.write(0x81, 0)
    g2.write(0x82, 16 << 16 | 16)
    g2.write(0x83, 0)
    g2.write(0x85, 0x18004000 >> 3)
    g2.write(0x8E, 0)                                          # RGBA8
    texture = raster.get_texture(g2, 0)
    texel = texture[0][13, 2]                                  # la même case que le triangle, en bas à gauche
    assert abs(int(texel[1]) - 0x7F) <= 1 and texel[0] == 0, texel      # G = octet haut de la profondeur 24 bits, R = pochoir
    # 8 nonies. la texture projetée (type 3 de 0x83) : (u, v) divisés par le w de la texture 0 ; w nul : zéro, pas d'infini
    frag = np.zeros((2, 18), dtype=np.float32)
    frag[:, 4], frag[:, 5], frag[:, 10] = 1, 1, (2, 0)
    flat_regs = [0] * 0x300
    assert [a.tolist() for a in raster.texture_uv(flat_regs, 0, frag)] == [[1, 1], [1, 1]]      # type 2D : inchangé
    flat_regs[0x83] = 3 << 28
    u, v = raster.texture_uv(flat_regs, 0, frag)
    assert u.tolist() == [0.5, 0] and v.tolist() == [0.5, 0], (u, v)
    # 8 decies. une longue chaîne de sauts (le terrain en a jusqu'à 2 200 dans une seule commande) est suivie en entier
    from services.gsp import follow_jumps

    def link(reg, *values):
        words = [values[0], reg | (len(values) - 1) << 20 | 0xF << 16] + list(values[1:])
        if len(values) % 2 == 0:
            words.append(0)
        return struct.pack('<%dI' % len(words), *words)
    mem2 = AddressSpace()
    mem2.map(0x14000000, 0x10000, PERM_RW, 'tas')
    hops = 300
    for k in range(hops):                                      # le tampon k : une écriture de 0x201 puis le saut vers k + 1
        body = link(0x201, k)
        if k + 1 < hops:
            body += link(0x238, 4) + link(0x23A, (0x20000000 + 0x40 * (k + 1)) // 8) + link(0x23C, 1)
        mem2.write(0x14000000 + 0x40 * k, body)
    counter = __import__('collections').Counter()
    flat = follow_jumps(mem2, mem2.read(0x14000000, 0x40), counter)
    found = [struct.unpack('<I', flat[i:i + 4])[0] for i in range(0, len(flat), 8)
             if struct.unpack('<I', flat[i + 4:i + 8])[0] & 0xFFFF == 0x201]
    assert counter['sauts de liste suivis'] == hops - 1 and found == list(range(hops)), (counter, len(found))
    # 8 undecies. le shader de géométrie (0x229 : 2 dans les bits 0-1). Pas dans la capture du terrain : tout est fabriqué.
    # Mode point : une exécution par sommet ; le programme émet trois sommets, le dernier (SETEMIT 2, primitive) finit le triangle.
    mov = lambda dest, src: 0x13 << 26 | dest << 21 | src << 12
    setemit = lambda vertex, primitive, winding: 0x2B << 26 | vertex << 22 | primitive << 24 | winding << 25
    emit = 0x2A << 26
    end = 0x22 << 26

    def geometry_gpu(order, code, mode, group, stride, max_input, permutation, cull=0):
        mem3, g3 = triangle_gpu(order, cull)
        g3.write(0x2CB, 4)                                     # le shader de géométrie est à l'instruction 4, avec celui des sommets
        g3.stream(0x2CC, code)
        g3.shader.uniforms[0] = (1, 0, 0, 0)
        g3.shader.uniforms[1] = (0, 1, 0, 0)
        g3.write(0x229, 2)
        g3.write(0x25E, 0x305)
        g3.write(0x252, mode | (group - 1) << 8 | (stride - 1) << 12)
        g3.write(0x28A, 4 | 0x7FFF0000)
        g3.write(0x289, max_input | 0xA0000000)
        g3.write(0x28B, permutation)
        g3.write(0x28D, 3)
        g3.write(0x228, len(order))
        g3.write(0x22E, 1)
        g3.flush()
        return mem3, g3
    add_c0, add_c1 = 0x20 << 12 | 0 << 7, 0x21 << 12 | 0 << 7             # ADD o0, c0, v0 et ADD o0, c1, v0 (désc. 0)
    point_program = lambda winding: (setemit(0, 0, 0), mov(0, 0), mov(1, 1), emit,
                                     setemit(1, 0, 0), add_c0, emit,
                                     setemit(2, 1, winding), add_c1, emit, end)
    mem3, g3 = geometry_gpu([(-1, -1)], point_program(0), 0, 1, 2, 1, 0x10)
    shape = formats.decode_pixels('RGBA8', formats.tiled_to_linear(mem3.read(0x1F000000, 16 * 16 * 4), 16, 16, 4))
    # le point (-1, -1) devient le triangle (-1, -1), (0, -1), (-1, 0) : le quart bas-gauche d'un coin de 8 x 8 points
    assert 28 <= int((shape[..., 3] > 0).sum()) <= 36 and shape[14, 1].tolist() == [255, 0, 0, 255], shape[14, 1]
    assert shape[2, 12].tolist() == [0, 0, 0, 0], shape[2, 12]
    assert g3.stats['triangles émis par le shader de géométrie'] == 1, g3.stats
    # le sens inverse de SETEMIT : avec « garder l'antihoraire », le triangle ordinaire passe et l'inversé disparaît
    mem3, g3 = geometry_gpu([(-1, -1)], point_program(0), 0, 1, 2, 1, 0x10, cull=2)
    assert covered_points(mem3) > 24
    mem3, g3 = geometry_gpu([(-1, -1)], point_program(1), 0, 1, 2, 1, 0x10, cull=2)
    assert covered_points(mem3) == 0
    # mode primitive fixe : trois sommets (deux attributs chacun) en une exécution, recopiés tels quels en un triangle
    fixed_program = (setemit(0, 0, 0), mov(0, 0), mov(1, 1), emit,
                     setemit(1, 0, 0), mov(0, 2), mov(1, 3), emit,
                     setemit(2, 1, 0), mov(0, 4), mov(1, 5), emit, end)
    mem3, g3 = geometry_gpu(ccw, fixed_program, 2, 3, 2, 5, 0x543210)
    shape = formats.decode_pixels('RGBA8', formats.tiled_to_linear(mem3.read(0x1F000000, 16 * 16 * 4), 16, 16, 4))
    assert shape[13, 2].tolist() == [255, 0, 0, 255] and shape[2, 13].tolist() == [0, 0, 0, 0], shape[13, 2]
    assert 120 <= int((shape[..., 3] > 0).sum()) <= 136
    # un branchement qui diverge dans le shader de géométrie : les triangles restent dans l'ordre des entrées
    gs = VertexShader()
    gs.swizzle[0] = desc
    gs.code[0] = 0x2E << 26 | 4 << 24 | 6 << 21 | 0x10 << 7                     # CMP v0, r0 : x plus grand ?
    gs.code[1] = 0x28 << 26 | 1 << 25 | 2 << 22 | 5 << 10                       # IFC (x vrai) : instructions 2 à 4, sinon rien
    gs.code[2] = setemit(2, 1, 0)
    gs.code[3] = mov(0, 0)
    gs.code[4] = emit
    gs.code[5] = end
    inputs = np.zeros((5, 16, 4), dtype=np.float32)
    inputs[:, 0, 0] = (1, -1, 2, -2, 3)
    made, flipped = gs.run_geometry(inputs)
    assert made[:, 2, 0, 0].tolist() == [1, 2, 3] and not flipped.any(), made[:, 2, 0, 0]
    assert gs.emitted is None
    # 9. la conversion YUV vers RGB de y2r:u : gris moyen et rouge pur (Rec. 601, pleine plage)
    from services.stubs import yuv_to_rgb
    gray = yuv_to_rgb(np.full((1, 1), 128, np.float32), np.zeros((1, 1), np.float32), np.zeros((1, 1), np.float32), 2)
    assert gray[0, 0].tolist() == [128, 128, 128]
    red = yuv_to_rgb(np.full((1, 1), 76, np.float32), np.full((1, 1), -43, np.float32), np.full((1, 1), 127, np.float32), 2)
    assert red[0, 0, 0] > 250 and red[0, 0, 1] < 5 and red[0, 0, 2] < 5, red
    print('banc : pica : Morton, formats, transferts, shader, liste de commandes, triangle, combinateur, éclairage, brouillard, pochoir.')


def test_list_jumps():
    """Les listes de commandes PICA se chaînent par les registres de saut 0x238-0x23D (liste fabriquée)."""
    import struct
    from memory import AddressSpace, PERM_RW
    from services.gsp import follow_jumps

    def group(reg, *values):
        words = [values[0], reg | (len(values) - 1) << 20 | 0xF << 16]
        words += list(values[1:])
        if len(values) % 2 == 0:
            words.append(0)
        return struct.pack('<%dI' % len(words), *words)
    memory = AddressSpace()
    memory.map(0x14000000, 0x1000, PERM_RW, 'tas linéaire')
    final = group(0x22F, 1) + group(0x22E, 1)                                   # deux ordres de dessin
    memory.write(0x14000100, final)
    # physique 0x20000100 = 0x14000100 du jeu ; taille et adresse en unités de 8 octets
    first = group(0x200, 7) + group(0x238, len(final) // 8) + group(0x23A, 0x20000100 // 8) + group(0x23C, 1)         + group(0x201, 9)                                                       # cette dernière écriture est abandonnée
    flat = follow_jumps(memory, first)
    words = struct.unpack('<%dI' % (len(flat) // 4), flat)
    regs = [words[i + 1] & 0xFFFF for i in range(0, len(words) - 1, 2)]
    assert 0x201 not in regs, regs
    assert 0x22E in regs and 0x22F in regs and regs[0] == 0x200, regs
    stats = __import__('collections').Counter()
    follow_jumps(memory, first, stats)
    assert stats['sauts de liste suivis'] == 1, stats
    # un saut vers une adresse illisible s'arrête sans planter
    bad = group(0x238, 4) + group(0x23A, 0x2FFFF000 // 8) + group(0x23C, 1)
    follow_jumps(memory, bad, stats)
    assert stats['sauts de liste vers une adresse illisible'] == 1, stats
    print('banc : listes PICA chaînées par les registres de saut (suivies, reste abandonné, adresse illisible).')


# --- les services remplaçants des modules (services/modules.py), appelés directement ---

SCRATCH = 0x08100000
READ_BUFFER, WRITE_BUFFER = 0xA, 0xC


def read_desc(size):
    return size << 4 | READ_BUFFER


def write_desc(size):
    return size << 4 | WRITE_BUFFER


def static_desc(size, index):
    return size << 14 | index << 10 | 2


class Call:
    """Le résultat d'un appel : l'en-tête de la réponse, ses mots (le résultat en premier) et ses mots de traduction."""

    def __init__(self, header, words, translated, reply):
        self.header, self.words, self.translated, self.reply = header, words, translated, reply
        self.result = words[0]


class Caller:
    """Envoie des requêtes fabriquées à un service du banc, sans processeur : le tampon de commande du fil principal est
    rempli, le service répond, la réponse est écrite comme `ipc.dispatch` le ferait."""

    def __init__(self, bench, name):
        from ipc import Request, write_reply
        self.Request, self.write_reply = Request, write_reply
        self.bench = bench
        self.kernel = bench.kernel
        self.memory = bench.memory
        self.service = bench.service_for(name)
        self.session = self.service.session()
        self.thread = bench.main_thread
        if not self.memory.is_mapped(SCRATCH):
            self.memory.map(SCRATCH, 0x10000, PERM_RW, 'essai')

    def call(self, header, words=(), receive=(), session=None):
        tls = self.thread.tls
        self.memory.write(tls + 0x80, struct.pack('<%dI' % (1 + len(words)), header, *words))
        for i, (address, size) in enumerate(receive):
            self.memory.w32(tls + 0x180 + 8 * i, static_desc(size, i))
            self.memory.w32(tls + 0x184 + 8 * i, address)
        req = self.Request(self.kernel, self.thread, session or self.session)
        reply = self.service.handle(req)
        written = self.write_reply(self.kernel, req, reply)
        after = getattr(self.service, 'after_reply', None)
        if after:
            after(req, reply)
        return Call(written[0], list(written[1]), list(written[2]), reply)

    def handle_of(self, call, index=1):
        return self.kernel.lookup(call.translated[index])

    def new_handle(self, obj):
        return self.kernel.add_handle(obj)


def make_service_bench(out, seed=None):
    program = test_program()
    code = program.ljust(0x1000, b'\0') + bytes(0x1000)
    options = {'seconds': 1}
    if seed is not None:
        options['seed'] = seed
    b = bench_module.Bench(UnicornCpu, paths=no_files(out), options=options, code=code,
                           exheader=make_exheader(len(program)))
    b.start()
    return b


def test_service_shapes():
    """Chaque commande de chaque service remplaçant répond avec l'en-tête de la fiche ; une commande hors fiche rend
    0xD900182F ; rien ne plante sur une requête vide."""
    from services import reply_shapes
    from services.modules import MODULES
    out = tempfile.mkdtemp(prefix='banc-formes-')
    try:
        b = make_service_bench(out)
        tables = {'nwm::UDS': reply_shapes.NWM_UDS, 'boss:U': reply_shapes.BOSS_U, 'boss:M': reply_shapes.BOSS_M,
                  'ssl:C': {n: s for n, s in reply_shapes.SSL_C.items() if n in (1, 0x10, 0x11)},
                  'cecd:u': reply_shapes.CECD_U, 'cam:u': reply_shapes.CAM_U, 'mic:u': reply_shapes.MIC_U,
                  'ir:USER': reply_shapes.IR_USER, 'ndm:u': reply_shapes.NDM_U, 'ac:u': reply_shapes.AC_U,
                  'frd:u': reply_shapes.FRD_U, 'soc:U': reply_shapes.SOC_U, 'http:C': reply_shapes.HTTP_C}
        assert set(tables) == set(MODULES), set(tables) ^ set(MODULES)
        checked = 0
        for name, table in tables.items():
            caller = Caller(b, name)
            assert type(caller.service).__name__ != 'Stub', name
            for number, shape in table.items():
                call = caller.call(number << 16)
                assert call.header == shape, '%s commande %#x : en-tête %#010x au lieu de %#010x (résultat %#x)' % (
                    name, number, call.header, shape, call.result)
                checked += 1
            unknown = caller.call(0x7FFF << 16)
            assert unknown.header == 0x40 and unknown.result == 0xD900182F, (name, unknown.header)
        # y2r:u : les réglages n'ont plus cinq mots
        y2r = Caller(b, 'y2r:u')
        for number, shape in reply_shapes.Y2R_U.items():
            if number not in (0x0F, 0x26):                    # celles-ci demandent un vrai événement ou une conversion
                assert y2r.call(number << 16).header == shape, hex(number)
        # un nom inconnu reste un service factice
        assert type(b.service_for('inconnu:x')).__name__ == 'Stub'
        print('banc : %d commandes de 13 services remplaçants, toutes avec l\'en-tête de leur fiche ; hors fiche : '
              '0xD900182F ; y2r:u : réglages à un mot.' % checked)
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test_nwm_uds():
    from kernel import Event, SharedMemory, WAITING
    out = tempfile.mkdtemp(prefix='banc-uds-')
    try:
        b = make_service_bench(out)
        uds = Caller(b, 'nwm::UDS')
        k = b.kernel
        # avant Initialize : l'état est 0, rien n'est permis
        assert uds.call(0x000B0000).words[1] == 0
        assert uds.call(0x00080000).result == 0xC8A113EA
        # InitializeWithVersion : 0x001B0042, un descripteur nul puis une vraie poignée d'événement
        shared = uds.new_handle(SharedMemory(k, 0x14000))
        node = [0x01234567 + i for i in range(10)]
        call = uds.call(0x001B0302, [0x14000] + node + [0x400, 0, shared])
        assert call.header == 0x001B0042 and call.result == 0, hex(call.header)
        assert call.translated[0] == 0 and call.translated[1] != 0, call.translated
        event = uds.handle_of(call)
        assert isinstance(event, Event) and not event.signaled
        # GetConnectionStatus : le statut 3 juste après Initialize, tout le reste à 0
        status = uds.call(0x000B0000)
        assert status.header == 0x000B0340 and status.words[1] == 3 and status.words[2:] == [0] * 11, status.words
        # StartScan : l'en-tête vide dans le tampon de sortie, et le fil attend
        out_address = SCRATCH
        b.memory.write(out_address, b'\xAA' * 0x40)
        now = k.now
        scan = uds.call(0x000F0404, [0x4000] + [0] * 15 + [0x20, 0, write_desc(0x4000), out_address])
        assert scan.header == 0x000F0042 and scan.result == 0, hex(scan.header)
        assert struct.unpack('<III', b.memory.read(out_address, 12)) == (0x4000, 0xC, 0)
        assert uds.thread.state == WAITING and uds.thread.wait.deadline - now >= 100_000_000, uds.thread.state
        k.make_ready(uds.thread)
        # SetProbeResponseParam puis CreateNetwork2 : 0, l'état 6, le nœud 1, l'événement d'Initialize signalé
        assert uds.call(0x00210080, [0x00321F00, 0]).result == 0
        structure = bytearray(0x108)
        structure[6] = 6
        structure[0x1D] = 4
        b.memory.write(SCRATCH + 0x100, bytes(structure))
        b.memory.write(SCRATCH + 0x300, b'motdepasse123')
        create_words = [13, static_desc(0x108, 1), SCRATCH + 0x100, static_desc(13, 0), SCRATCH + 0x300]
        create = uds.call(0x001D0044, create_words)
        assert create.header == 0x001D0040 and create.result == 0
        assert event.signaled and event.signal_count == 1
        status = uds.call(0x000B0000)
        assert status.words[1] == 6, status.words
        assert status.words[3] & 0xFFFF == 1, 'identifiant du nœud local : %s' % status.words
        data = struct.pack('<12I', *status.words[1:])
        assert data[0x2C] == 1 and data[0x2D] == 4 and struct.unpack_from('<H', data, 0x2E)[0] == 1, data.hex()
        info = uds.call(0x000D0040, [1])
        assert info.header == 0x000D02C0 and info.words[1:] == node, info.words
        assert uds.call(0x000D0040, [7]).result == 0xC90113FA
        assert uds.call(0x001A0000).words[1] == 6
        # un second réseau est refusé, StartScan aussi : l'état n'est plus 3
        assert uds.call(0x001D0044, create_words).result == 0xC8A113EA
        scan_words = [0x4000] + [0] * 15 + [0x20, 0, write_desc(0x4000), out_address]
        assert uds.call(0x000F0404, scan_words).result == 0xC8A113EA
        # SetApplicationData : au plus 0xC8 octets
        assert uds.call(0x00100042, [0xC8, read_desc(0xC8), SCRATCH]).result == 0
        assert uds.call(0x00100042, [0xC9, read_desc(0xC9), SCRATCH]).result == 0xE10113E9
        # Bind, PullPacket (rien), Unbind (quatre mots à zéro)
        assert uds.call(0x00120100, [1, 0x3C0, 0, 0]).result == 0xE10113EA              # canal 0
        bind = uds.call(0x00120100, [1, 0x3C0, 0x11, 0])
        assert bind.header == 0x00120042 and isinstance(uds.handle_of(bind), Event)
        pull = uds.call(0x001400C0, [1, 0x500, 0], receive=[(SCRATCH + 0x800, 0x500)])
        assert pull.header == 0x001400C2 and pull.words[1:3] == [0, 0], pull.words
        assert uds.call(0x001400C0, [9, 0x500, 0], receive=[(SCRATCH + 0x800, 0x500)]).result == 0xE10113EA
        unbind = uds.call(0x00130040, [1])
        assert unbind.header == 0x00130140 and unbind.words == [0, 0, 0, 0, 0], unbind.header
        # SendTo : au plus 0x5C6 octets
        assert uds.call(0x00170182, [0xFFFF, 0x11, 0x20, 0, 0x20, 0, read_desc(0x20), SCRATCH]).result == 0
        assert uds.call(0x00170182, [0xFFFF, 0x11, 0x5C7, 0, 0x20, 0, read_desc(0x20), SCRATCH]).result == 0xE10113E9
        # DestroyNetwork : 0, l'état revient à 3, l'événement n'est pas signalé ; une seconde fois : refusé
        count = event.signal_count
        assert uds.call(0x00080000).result == 0
        assert event.signal_count == count
        assert uds.call(0x000B0000).words[1] == 3
        assert uds.call(0x00080000).result == 0xC8A113EA
        # on peut recommencer un balayage, puis Finalize remet tout à zéro
        assert uds.call(0x000F0404, scan_words).result == 0
        k.make_ready(uds.thread)
        assert uds.call(0x00030000).result == 0 and uds.call(0x000B0000).words[1] == 0
    finally:
        shutil.rmtree(out, ignore_errors=True)
    print('banc : nwm::UDS — Initialize avec une vraie poignée, statut 3, balayage qui écrit son en-tête et prend du '
          'temps, CreateNetwork2 (état 6, nœud 1, événement), Destroy (état 3, sans signal), Bind, SendTo, refus.')


def test_boss():
    from kernel import Event
    out = tempfile.mkdtemp(prefix='banc-boss-')
    try:
        b = make_service_bench(out)
        boss = Caller(b, 'boss:U')
        # rien ne répond avant InitializeSession, sauf SendPropertyHandle
        for number in (0x03, 0x0B, 0x0E, 0x14, 0x16, 0x1F, 0x2E, 0x30):
            call = boss.call(number << 16)
            assert call.result == 0xC8A0F82B, (hex(number), hex(call.result))
        handle = boss.call(0x00150042, [0x0C, 0, 0])
        assert handle.result == 0 and handle.header == 0x00150040
        assert boss.call(0x00150042, [0x01, 0, 0]).result == 0xC960F84D
        init = boss.call(0x00010082, [0, 0, 0x20, 0x1234])
        assert init.header == 0x00010040 and init.result == 0
        # GetTaskFinishHandle : 0x001F0042, un descripteur nul puis une vraie poignée d'événement
        finish = boss.call(0x001F0000)
        assert finish.header == 0x001F0042 and finish.translated[0] == 0 and finish.translated[1] != 0
        assert isinstance(boss.handle_of(finish), Event)
        assert boss.handle_of(boss.call(0x001F0000)) is boss.handle_of(finish), 'la même poignée du cœur'
        # SendProperty puis ReceiveProperty : ce qui a été envoyé revient, le reste est à zéro
        b.memory.write(SCRATCH, b'\x07\x08\x09\x0A')
        assert boss.call(0x00140082, [0x02, 4, read_desc(4), SCRATCH]).result == 0
        got = boss.call(0x00160082, [0x02, 8, write_desc(8), SCRATCH + 0x100])
        assert got.header == 0x00160082 and b.memory.read(SCRATCH + 0x100, 8) == b'\x07\x08\x09\x0A\0\0\0\0'
        assert boss.call(0x00160082, [0x01, 1, write_desc(1), SCRATCH + 0x100]).result == 0
        assert boss.call(0x00140082, [0x17, 4, read_desc(4), SCRATCH]).result == 0xC960F84D       # identifiant inconnu
        # RegisterTask : refusé quand la propriété 6 vaut 6, 7, 8, 9 ou 0xD
        b.memory.write(SCRATCH, b'\x07')
        boss.call(0x00140082, [0x06, 1, read_desc(1), SCRATCH])
        b.memory.write(SCRATCH + 0x200, b'tache001')
        task = [8, 0, 0, read_desc(8), SCRATCH + 0x200]
        assert boss.call(0x000B00C2, task).result == 0xD8E0F802
        b.memory.write(SCRATCH, b'\x01')
        boss.call(0x00140082, [0x06, 1, read_desc(1), SCRATCH])
        reg = boss.call(0x000B00C2, task)
        assert reg.result == 0 and reg.header == 0x000B0042 and reg.translated == [read_desc(8), SCRATCH + 0x200]
        untask = [8, 0, read_desc(8), SCRATCH + 0x200]
        assert boss.call(0x000C0082, untask).result == 0
        assert boss.call(0x000C0082, untask).result == 0xC8A0F833                     # plus de tâche
        # une autre session n'est pas initialisée
        other = boss.service.session()
        assert boss.call(0x000E0000, session=other).result == 0xC8A0F82B
        # stockage, erreurs de NsData
        assert boss.call(0x00030000).result == 0xC8A0F842 and boss.call(0x00300000).result == 0xC8A0F842
        assert boss.call(0x002F0140, [0x55D, 0, 0x100000, 0x14, 1]).result == 0
        assert boss.call(0x00300000).result == 0 and boss.call(0x00030000).result == 0
        assert boss.call(0x002700C2, [1, 9, 4, 0, 0]).result == 0xC8A0F83F
        assert boss.call(0x002700C2, [1, 0, 4, 0, 0]).result == 0xC960F844
        assert boss.call(0x002E0000).words[1] == 0xB3B1
        # boss:M : la commande 3 ne compare que son numéro
        manager = Caller(b, 'boss:M')
        assert manager.call(0x00030000).header == 0x00030040
    finally:
        shutil.rmtree(out, ignore_errors=True)
    print('banc : boss — refus avant InitializeSession (sauf SendPropertyHandle), poignée de GetTaskFinishHandle, '
          'propriétés, RegisterTask refusé, stockage.')


def test_ssl_random():
    out = tempfile.mkdtemp(prefix='banc-ssl-')
    try:
        def draw(seed, calls=2):
            b = make_service_bench(out, seed)
            ssl = Caller(b, 'ssl:C')
            assert ssl.call(0x00010002).header == 0x00010040
            assert ssl.call(0x00100000).header == 0x00100040
            blocks = []
            for _ in range(calls):
                call = ssl.call(0x00110042, [0x40, write_desc(0x40), SCRATCH])
                assert call.header == 0x00110042 and call.result == 0
                blocks.append(b.memory.read(SCRATCH, 0x40))
            return blocks
        first = draw(None)
        assert first[0] != first[1] and first[0] != bytes(0x40) and len(set(first[0])) > 8, 'octets variables'
        a, b2, c = draw(1234), draw(1234), draw(99)
        assert a == b2 and a[0] != a[1] and a != c, 'même graine : mêmes octets ; autre graine : autres octets'
        # une taille plus petite que le tampon : seulement ces octets
        bench = make_service_bench(out, 5)
        ssl = Caller(bench, 'ssl:C')
        bench.memory.write(SCRATCH, b'\xEE' * 0x20)
        ssl.call(0x00110042, [0x10, write_desc(0x20), SCRATCH])
        assert bench.memory.read(SCRATCH + 0x10, 0x10) == b'\xEE' * 0x10
        assert ssl.call(0x00020082).result == 0xD900182F, 'le reste de ssl:C est inconnu'
    finally:
        shutil.rmtree(out, ignore_errors=True)
    print('banc : ssl:C — GenerateRandomData rend des octets variables, reproductibles avec la graine du banc.')


def test_cecd_files():
    out = tempfile.mkdtemp(prefix='banc-cecd-')
    try:
        b = make_service_bench(out)
        cec = Caller(b, 'cecd:u')
        cec_id = 0x00014300
        payload = bytes(range(200))
        b.memory.write(SCRATCH, payload)
        # OpenAndWrite (chemin 2 : MBoxInfo) puis OpenAndRead : ce qui a été écrit revient
        write = cec.call(0x00110104, [len(payload), cec_id, 2, 6, 0x20, 0, read_desc(len(payload)), SCRATCH])
        assert write.header == 0x00110042 and write.result == 0
        path = os.path.join(b.paths['archives'], 'cec', '%08x' % cec_id, 'MBoxInfo____')
        assert open(path, 'rb').read() == payload, 'le fichier est écrit sur le disque, dans archives/cec'
        read = cec.call(0x00120104, [0x100, cec_id, 2, 1, 0x20, 0, write_desc(0x100), SCRATCH + 0x1000])
        assert read.header == 0x00120082 and read.result == 0 and read.words[1] == len(payload), read.words
        assert b.memory.read(SCRATCH + 0x1000, len(payload)) == payload
        # un fichier absent est une erreur, pas des zéros
        missing = cec.call(0x00120104, [0x100, cec_id + 1, 2, 1, 0x20, 0, write_desc(0x100), SCRATCH + 0x1000])
        assert missing.result == 0xC8804470, hex(missing.result)
        # OpenRawFile (création), WriteRawFile, ReadRawFile : même fichier, position de lecture à part
        b.memory.write(SCRATCH + 0x2000, b'identifiant8')
        opened = cec.call(0x000100C2, [cec_id, 3, 5, static_desc(8, 0), SCRATCH + 0x2000])
        assert opened.header == 0x00010080 and opened.result == 0 and opened.words[1] == 0
        b.memory.write(SCRATCH + 0x3000, b'0123456789')
        wrote = cec.call(0x00050042, [10, read_desc(10), SCRATCH + 0x3000])
        assert wrote.header == 0x00050042 and wrote.result == 0
        cec.call(0x000100C2, [cec_id, 3, 1, static_desc(8, 0), SCRATCH + 0x2000])
        raw = cec.call(0x00020042, [4, write_desc(4), SCRATCH + 0x3100])
        assert raw.header == 0x00020082 and raw.words[1] == 4 and b.memory.read(SCRATCH + 0x3100, 4) == b'0123'
        raw = cec.call(0x00020042, [100, write_desc(100), SCRATCH + 0x3100])
        assert raw.words[1] == 6 and b.memory.read(SCRATCH + 0x3100, 6) == b'456789', 'la lecture continue'
        # WriteMessage dans la boîte de sortie, ReadMessage le relit ; un message absent est une erreur
        message_id = struct.pack('>Q', 0x1122334455667788)
        b.memory.write(SCRATCH + 0x4000, b'un message')
        b.memory.write(SCRATCH + 0x4100, message_id)
        msg = cec.call(0x00060104, [cec_id, 1, 8, 10, read_desc(10), SCRATCH + 0x4000, write_desc(8), SCRATCH + 0x4100])
        assert msg.header == 0x00060044 and msg.result == 0
        read_words = [cec_id, 1, 8, 0x40, read_desc(8), SCRATCH + 0x4100, write_desc(0x40), SCRATCH + 0x4200]
        back = cec.call(0x00030104, read_words)
        assert back.header == 0x00030084 and back.words[1] == 10 and b.memory.read(SCRATCH + 0x4200, 10) == b'un message'
        in_box = [cec_id, 0] + read_words[2:]
        assert cec.call(0x00030104, in_box).result == 0xC8804470, 'la boîte d\'entrée est vide'
        # Delete efface le message
        assert cec.call(0x00080102, [cec_id, 7, 1, 8, read_desc(8), SCRATCH + 0x4100]).result == 0
        assert cec.call(0x00030104, read_words).result == 0xC8804470
        # l'état « inactif », une vraie poignée d'événement
        assert cec.call(0x000E0000).words[1] == 1
        assert cec.handle_of(cec.call(0x00100000)).label()
        assert cec.call(0x000B0040, [1]).result == 0 and cec.call(0x000C0040, [1]).result == 0
    finally:
        shutil.rmtree(out, ignore_errors=True)
    print('banc : cecd:u — les fichiers de boîte sont vrais : écrits dans archives/cec puis relus (OpenAndWrite/Read, '
          'RawFile, messages, Delete), un fichier absent est une erreur.')


def test_small_modules():
    from kernel import Event
    from services.modules import friend_code
    out = tempfile.mkdtemp(prefix='banc-modules-')
    try:
        b = make_service_bench(out)
        k = b.kernel
        # ndm:u : l'état exclusif, la suspension par session
        ndm = Caller(b, 'ndm:u')
        assert ndm.call(0x00010042, [2, 0x20, 0]).result == 0
        assert ndm.call(0x00010042, [2, 0x20, 0]).result == 0xC8A06811, 'deux Enter de suite'
        assert ndm.call(0x00030000).words[1] == 2
        assert ndm.call(0x00020002, [0x20, 0]).result == 0 and ndm.call(0x00030000).words[1] == 0
        assert ndm.call(0x00060040, [6]).result == 0 and ndm.call(0x00060040, [16]).result == 0xD8E06BED
        assert ndm.call(0x00070040, [2]).result == 0 and ndm.call(0x00070040, [4]).result == 0
        assert ndm.call(0x00070040, [4]).result == 0xC8A0680D
        assert ndm.call(0x00090000).result == 0xC8A0680D
        # ac:u hors ligne : configuration, priorité, ConnectAsync signale l'événement plus tard avec un échec
        ac = Caller(b, 'ac:u')
        config = ac.call(0x00010000, receive=[(SCRATCH, 0x200)])
        assert config.header == 0x00010042 and b.memory.read(SCRATCH, 1) == b'\xBF'
        assert b.memory.read(SCRATCH + 8, 6) == b'\xFF' * 6
        assert ac.call(0x00270002, [static_desc(0x200, 0), SCRATCH]).words[1] == 0
        done = Event(k, 0, 'essai')
        connect = ac.call(0x00040006, [0x20, 0, 0, ac.new_handle(done), static_desc(0x200, 2), SCRATCH])
        assert connect.header == 0x00040040 and connect.result == 0 and not done.signaled
        assert ac.call(0x00050002, [0x20, 0]).result == 0xE1209C46, 'tant que la connexion dure'
        k.now += 60_000_000
        k.run_due_events()
        assert done.signaled and ac.call(0x00050002, [0x20, 0]).result == 0xE0A09D2E
        assert ac.call(0x000D0000).result == 0xE0A09D2E and ac.call(0x000E0042, [0x34, 0, 0]).result == 0xE0A09D2E
        assert ac.call(0x003E0042, [0]).words[1] == 0
        # frd:u : l'identité, la liste vide, le nom, la formule des codes d'erreur
        frd = Caller(b, 'frd:u')
        key = frd.call(0x00050000)
        assert key.header == 0x00050140 and key.words[1] != 0 and key.words[3] | key.words[4] << 32 == \
            friend_code(key.words[1])
        assert frd.call(0x00010000).words[1] == 0, 'jamais connecté'
        presence = frd.call(0x00080000, receive=[(SCRATCH + 0x100, 0x12C)])
        assert presence.header == 0x00080042 and b.memory.read(SCRATCH + 0x100, 0x12C) == bytes(0x12C)
        assert frd.call(0x00110080, [0, 100], receive=[(SCRATCH + 0x200, 0x640)]).words[1] == 0
        name = frd.call(0x00090000)
        assert name.header == 0x000901C0 and \
            struct.pack('<6I', *name.words[1:]).decode('utf-16-le').rstrip('\0') == 'Banc'
        def frd_result(description, negative=True):
            return (0x80000000 if negative else 0) | 0x31 << 10 | description
        for result, expected in ((frd_result(5 << 5 | 3), (0, 10000 + 500 + 3)),         # module 0x31, q = 5, r = 3
                                 (frd_result(0x101), (0, 23000)), (frd_result(0x20), (0, 10100)),
                                 (frd_result(0x3E0 | 5), (0, 0)), (frd_result(0x105, False), (0, 0)),
                                 (0xC8804470, (0xE0E0C403, 0)), (0, (0xE0E0C403, 0))):
            got = frd.call(0x00270040, [result])
            assert got.header == 0x00270080 and (got.result, got.words[1]) == expected, (hex(result), got.words)
        login_event = Event(k, 0, 'login')
        assert frd.call(0x00030002, [0, frd.new_handle(login_event)]).result == 0 and login_event.signaled
        # soc:U hors ligne : socket rend un descripteur négatif, le reste échoue, poll rend 0x20
        soc = Caller(b, 'soc:U')
        assert soc.call(0x00010044, [0x20000, 0x20, 0, 0, 0]).result == 0
        sock = soc.call(0x000200C2, [2, 2, 0, 0x20, 0])
        assert sock.header == 0x00020080 and sock.result == 0 and sock.words[1] >= 0x80000000
        b.memory.write(SCRATCH + 0x300, struct.pack('<III', 5, 1, 0))
        poll = soc.call(0x00140084, [1, 100, 0x20, 0, static_desc(12, 0), SCRATCH + 0x300],
                        receive=[(SCRATCH + 0x400, 12)])
        assert poll.header == 0x00140082 and struct.unpack('<III', b.memory.read(SCRATCH + 0x400, 12)) == (5, 1, 0x20)
        # http:C : des contextes non nuls et distincts, huit au plus
        http = Caller(b, 'http:C')
        assert http.call(0x00010044, [0x2000, 0x20, 0, 0, 0]).result == 0
        handles = []
        for _ in range(8):
            made = http.call(0x00020082, [0, 0, 0, 0])
            assert made.header == 0x00020082 and made.result == 0 and made.words[1] != 0
            handles.append(made.words[1])
        assert len(set(handles)) == 8 and http.call(0x00020082).result == 0xD8A0A01A
        assert http.call(0x00080042, [handles[0], 0, 0]).result == 0
        assert http.call(0x00080042, [999, 0, 0]).result == 0xD8A0A064
        assert http.call(0x00030040, [handles[0]]).result == 0 and http.call(0x00020082).result == 0
        # cam:u : les formules de GetMaxLines et GetMaxBytes, les poignées d'événement
        cam = Caller(b, 'cam:u')
        lines = cam.call(0x000A0080, [640, 480]).words[1]
        assert lines and 480 % lines == 0 and lines * 640 % 128 == 0 and lines * 640 * 2 <= 0x1400, lines
        assert cam.call(0x000A0080, [0, 480]).result == 0xE0E053FD
        maxbytes = cam.call(0x000D0080, [640, 480]).words[1]
        assert maxbytes % 0x100 == 0 and maxbytes <= 0x1400 and (2 * 640 * 480) % maxbytes == 0
        assert isinstance(cam.handle_of(cam.call(0x00050042, [1])), Event)
        assert cam.call(0x00050042, [4]).result == 0xE0E053ED
    finally:
        shutil.rmtree(out, ignore_errors=True)
    print('banc : ndm, ac, frd, soc, http, cam — états et résultats de leurs fiches (ConnectAsync signalé plus tard, '
          'identité, formule des codes d\'erreur, sockets hors ligne, huit contextes, formules de la caméra).')


def test_mic_ir():
    from kernel import Event, SharedMemory
    out = tempfile.mkdtemp(prefix='banc-micir-')
    try:
        b = make_service_bench(out)
        k = b.kernel
        mic = Caller(b, 'mic:u')
        page = SharedMemory(k, 0x2000)
        page.write(0x1000, b'\x55' * 0x100)
        assert mic.call(0x00100040, [0x050200C8]).result == 0
        assert mic.call(0x00030140, [3, 3, 0, 0x1000, 1]).result == 0xD8208FF8, 'pas projeté'
        assert mic.call(0x00010042, [0x1001, 0, mic.new_handle(page)]).result == 0xE0E08FF2
        assert mic.call(0x00010042, [0x2000, 0, mic.new_handle(page)]).result == 0
        assert mic.call(0x00010042, [0x2000, 0, mic.new_handle(page)]).result == 0xD8208FF9
        gain = mic.call(0x00090000).words[1]
        assert mic.call(0x00090000).words[1] == gain
        assert mic.call(0x00030140, [3, 3, 0, 0x2000, 1]).result == 0xE1008FFD, 'décalage + taille > page - 4'
        assert mic.call(0x00030140, [3, 3, 0, 0x1000, 1]).result == 0
        assert mic.call(0x00060000).words[1] == 1
        for _ in range(10):
            k.now += 10_000_000
            k.run_due_events()
        end = struct.unpack('<I', page.read(0x1FFC, 4))[0]
        assert 0 < end < 0x1000 and end % 2 == 0, end
        assert page.read(0x1000, 0x100) == b'\x55' * 0x100, 'seul l\'anneau est touché'
        assert page.read(0, 0x40) == bytes(0x40), 'échantillons à zéro'
        # 8 182 Hz : 100 ms font environ 818 échantillons de 2 octets
        assert abs(end + 2 - 2 * 818) < 20, end
        assert mic.call(0x00050000).result == 0 and mic.call(0x00060000).words[1] == 0
        before = page.read(0x1FFC, 4)
        for _ in range(10):
            k.now += 10_000_000
            k.run_due_events()
        assert page.read(0x1FFC, 4) == before, 'plus rien après StopSampling'
        assert mic.call(0x00020000).result == 0 and mic.call(0x00020000).result == 0xD8208FF8
        # ir:USER : la page partagée, la liaison, les envois
        ir = Caller(b, 'ir:USER')
        irpage = SharedMemory(k, 0x2000)
        assert ir.call(0x00020000).result == 0xD8210FF8
        init = ir.call(0x00180182, [0x2000, 602, 2, 602, 2, 3, 0, ir.new_handle(irpage)])
        assert init.header == 0x00180040 and init.result == 0
        assert irpage.read(8, 1) == b'\0' and irpage.read(0xE, 1) == b'\1'
        assert ir.call(0x00160000).words[1:] == [586, 2, 0, 0] and ir.call(0x00150000).words[1:] == [586, 2, 0, 0]
        assert ir.call(0x000D0042, [4, static_desc(4, 0), SCRATCH]).result == 0xC8A10C0D, 'pas connecté'
        assert ir.call(0x00190040, [1]).result == 0xC8A10C0D
        status = ir.handle_of(ir.call(0x000C0000))
        assert isinstance(status, Event) and isinstance(ir.handle_of(ir.call(0x000A0000)), Event)
        auto = ir.call(0x000702C0, [0] + [0] * 10)
        assert auto.result == 0 and irpage.read(8, 1) == b'\1'
        assert ir.call(0x000702C0, [0] + [0] * 10).result == 0xC8A10C0C
        count = status.signal_count
        assert ir.call(0x00090000).result == 0 and irpage.read(8, 1) == b'\0' and status.signal_count == count + 1
        assert ir.call(0x00090000).result == 0xC8A10C0D
        assert ir.call(0x00110040, [0]).words[1] == 0
        assert ir.call(0x00020000).result == 0
    finally:
        shutil.rmtree(out, ignore_errors=True)
    print('banc : mic:u (page partagée remplie de silence à 8 182 Hz, mot de fin, erreurs de la fiche) et ir:USER (page, '
          'liaison 0 puis 1 puis 0, envois refusés).')


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
    test_list_jumps()
    test_service_shapes()
    test_nwm_uds()
    test_boss()
    test_ssl_random()
    test_cecd_files()
    test_small_modules()
    test_mic_ir()
    test_real_game()


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    test()
