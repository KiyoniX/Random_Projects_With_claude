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
    test_synthetic()
    test_real_game()


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    test()
