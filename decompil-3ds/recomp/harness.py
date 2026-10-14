"""La validation différentielle : le C recompilé contre unicorn, mêmes registres et même mémoire de départ.

- `Toolchain` compile le C généré en DLL (clang portable de local/outils/llvm-mingw) et la charge avec ctypes ;
- `Rig` monte deux copies identiques de la mémoire (une pour unicorn, une pour le natif) et rejoue une fonction sur
  des états de départ tirés au hasard (registres, drapeaux, VFP, mémoire) ;
- on compare ensuite les registres, les drapeaux, la VFP et toute la mémoire inscriptible.

Une tirée où les deux côtés font la même faute mémoire est écartée (ce n'est pas une divergence) ; une faute d'un seul
côté est une divergence. Une tirée où unicorn n'atteint pas le retour (boucle trop longue) est écartée.
"""
import ctypes
import glob
import hashlib
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LOCAL = os.path.join(ROOT, 'local')
PYLIB = os.path.join(LOCAL, 'pylib')
for _p in (HERE, PYLIB):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np  # noqa: E402

RUNTIME = os.path.join(HERE, 'runtime')
SENTINEL = 0xF0000000
HEAP = 0x08000000
HEAP_SIZE = 0x10000
STACK = 0x0FFF0000
STACK_SIZE = 0x4000
FPSCR_KERNEL = 0x03C00000          # le FPSCR que pose le noyau de la console : arrondi vers zéro, FZ et DN


# ---------------------------------------------------------------------------------------------------------------------
# Le compilateur portable
# ---------------------------------------------------------------------------------------------------------------------

def find_clang():
    for exe in glob.glob(os.path.join(LOCAL, 'outils', 'llvm-mingw', '*', 'bin', 'clang.exe')):
        return exe
    return 'clang'


class Toolchain:
    def __init__(self, clang=None, opt='-O1'):
        self.clang = clang or find_clang()
        self.opt = opt

    def flags(self, budget=True):
        f = [self.opt, '-w', '-ffp-contract=off', '-fno-strict-aliasing', '-fno-fast-math', '-I' + RUNTIME]
        if budget:
            f.append('-DRT_BUDGET')
        return f

    def compile_dll(self, sources, out_dll, include_dirs=(), budget=True, jobs=8):
        """sources : liste de chemins .c (le support d'exécution est ajouté). Compile en parallèle puis lie."""
        build = os.path.dirname(out_dll)
        os.makedirs(build, exist_ok=True)
        flags = self.flags(budget) + ['-I' + d for d in include_dirs]
        sources = list(sources) + [os.path.join(RUNTIME, 'rt.c')]
        objs = []
        if len(sources) <= 5:               # peu de fichiers : un seul processus (le démarrage de clang coûte cher)
            run = subprocess.run([self.clang, '-shared', '-o', out_dll] + sources + flags, capture_output=True, text=True)
            if run.returncode:
                raise RuntimeError('compilation : %s' % run.stderr[:3000])
            return out_dll

        def one(src):
            obj = os.path.join(build, hashlib.md5(src.encode()).hexdigest()[:10] + '_' + os.path.basename(src) + '.o')
            subprocess.run([self.clang, '-c', '-o', obj, src] + flags, check=True, capture_output=True, text=True)
            return obj

        try:
            with ThreadPoolExecutor(jobs) as pool:
                objs = list(pool.map(one, sources))
        except subprocess.CalledProcessError as error:
            raise RuntimeError('compilation : %s' % error.stderr[:3000])
        link = subprocess.run([self.clang, '-shared', '-o', out_dll] + objs, capture_output=True, text=True)
        if link.returncode:
            raise RuntimeError('édition de liens : %s' % link.stderr[:3000])
        for obj in objs:
            try:
                os.remove(obj)
            except OSError:
                pass
        return out_dll


class CpuStruct(ctypes.Structure):
    _fields_ = [('r', ctypes.c_uint32 * 16), ('nf', ctypes.c_uint32), ('zf', ctypes.c_uint32),
                ('cf', ctypes.c_uint32), ('vf', ctypes.c_uint32), ('qf', ctypes.c_uint32), ('ge', ctypes.c_uint32),
                ('fpscr', ctypes.c_uint32), ('fpexc', ctypes.c_uint32), ('tls', ctypes.c_uint32),
                ('excl_addr', ctypes.c_uint32), ('budget', ctypes.c_int32), ('d', ctypes.c_uint64 * 16),
                ('user', ctypes.c_void_p)]


class Native:
    """Une DLL recompilée, chargée."""

    def __init__(self, dll_path):
        self.lib = ctypes.CDLL(dll_path)
        self.lib.rt_call.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        self.lib.rt_call.restype = ctypes.c_int
        self.lib.rt_map.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]
        self.lib.rt_get_info.argtypes = [ctypes.c_int]
        self.lib.rt_get_info.restype = ctypes.c_uint32
        self.lib.rt_fp_setup.argtypes = [ctypes.c_uint32]
        self.lib.rt_cpu_size.restype = ctypes.c_uint32
        assert self.lib.rt_cpu_size() == ctypes.sizeof(CpuStruct), 'la structure Cpu du C et de ctypes divergent'

    def map(self, address, size, buf_address, perms):
        self.lib.rt_map(address >> 12, size >> 12, buf_address, perms)

    def call(self, cpu, address):
        return self.lib.rt_call(ctypes.byref(cpu), address)

    def info(self, i):
        return self.lib.rt_get_info(i)


# ---------------------------------------------------------------------------------------------------------------------
# Le montage de comparaison
# ---------------------------------------------------------------------------------------------------------------------

REG_NAMES = ['r%d' % i for i in range(13)] + ['sp', 'lr']


class State:
    """Un état de départ : tout ce qu'une fonction peut lire."""
    __slots__ = ('r', 'flags', 'q', 'ge', 'd', 'heap', 'stack')


class Rig:
    def __init__(self, sections, native, writable=None):
        """sections : [(adresse, octets, perms)]. native : une `Native` qui contient les fonctions."""
        import unicorn
        from unicorn import arm_const
        self.unicorn, self.arm = unicorn, arm_const
        self.native = native
        self.uc = unicorn.Uc(unicorn.UC_ARCH_ARM, unicorn.UC_MODE_ARM)
        self.uc.ctl_set_cpu_model(arm_const.UC_CPU_ARM_11MPCORE)
        self.regions = []               # (adresse, taille, perms, tampon unicorn, tampon natif, octets d'origine)
        spec = list(sections) + [(HEAP, bytes(HEAP_SIZE), 3), (STACK, bytes(STACK_SIZE), 3)]
        for address, data, perms in spec:
            size = (len(data) + 0xFFF) & ~0xFFF
            ub = (ctypes.c_char * size).from_buffer_copy(bytes(data).ljust(size, b'\0'))
            nb = (ctypes.c_char * size).from_buffer_copy(bytes(data).ljust(size, b'\0'))
            self.uc.mem_map_ptr(address, size, perms, ctypes.addressof(ub))
            native.map(address, size, ctypes.addressof(nb), perms & 3)
            self.regions.append((address, size, perms, ub, nb, bytes(data).ljust(size, b'\0')))
        self.writable = [r for r in self.regions if r[2] & 2]
        self.cpu = CpuStruct()
        a = arm_const
        self.ureg = [getattr(a, 'UC_ARM_REG_R%d' % i) for i in range(13)] + [a.UC_ARM_REG_SP, a.UC_ARM_REG_LR]
        self.ud = [getattr(a, 'UC_ARM_REG_D%d' % i) for i in range(16)]
        self.rng = np.random.RandomState(12345)
        self.heap_buf = (HEAP, HEAP_SIZE)
        self.stats_budget = 0

    # --- tirage ---

    def draw(self, rng, ptr_regions):
        s = State()
        regs = []
        for i in range(13):
            roll = rng.randint(100)
            if roll < 35:
                regs.append(HEAP + 0x1000 + (int(rng.randint(0, (HEAP_SIZE - 0x2000) // 8)) * 8))
            elif roll < 55:
                regs.append(int(rng.randint(0, 40)))
            elif roll < 78:
                regs.append(int(rng.randint(0, 1 << 32, dtype=np.uint64)))
            elif roll < 93:
                regs.append(int(rng.choice([0, 1, 0xFFFFFFFF, 0x80000000, 0x7FFFFFFF, 0xFFFF, 0xFF, 0x100, 0x8000,
                                            0xFFFF0000, 2, 3, 4, 8, 16, 32, 31, 33, 0xFF00FF00])))
            else:
                a, size = ptr_regions[int(rng.randint(len(ptr_regions)))]
                regs.append(a + (int(rng.randint(0, max(1, size // 8))) * 8))
        sp = STACK + STACK_SIZE - 0x100 - 8 * int(rng.randint(0, 16))
        regs.append(sp)
        regs.append(SENTINEL)
        s.r = regs
        s.flags = int(rng.randint(0, 16))
        s.q = int(rng.randint(0, 2))
        s.ge = int(rng.randint(0, 16))
        d = []
        for i in range(16):
            roll = rng.randint(10)
            if roll < 3:
                d.append(int(rng.randint(0, 1 << 62, dtype=np.uint64)) << 2 | int(rng.randint(0, 4)))
            elif roll < 6:
                x = np.float32(rng.uniform(-1000, 1000)) if rng.randint(2) else np.float32(rng.randint(-50, 50))
                y = np.float32(rng.uniform(-1000, 1000))
                d.append(int(np.array([x, y], dtype=np.float32).view(np.uint64)[0]))
            elif roll < 9:
                x = rng.uniform(-1e6, 1e6) if rng.randint(2) else float(rng.randint(-50, 50))
                d.append(int(np.array([x], dtype=np.float64).view(np.uint64)[0]))
            else:
                d.append(int(rng.choice([0, 0x8000000000000000, 0x7FF0000000000000, 0xFFF0000000000000,
                                         0x7FF8000000000000, 0x0000000000000001, 0x3F800000_3F800000,
                                         0x7FC00000_7FC00000, 0x00000001_00000001])))
        s.d = d
        if rng.randint(2):
            s.heap = rng.bytes(HEAP_SIZE)
        else:
            # un tas « plausible » : des mots qui sont des petits entiers, des pointeurs dans le tas ou des valeurs libres
            n = HEAP_SIZE // 4
            kind = rng.randint(0, 3, size=n)
            small = rng.randint(0, 64, size=n, dtype=np.uint32)
            ptr = (HEAP + 0x1000 + rng.randint(0, (HEAP_SIZE - 0x2000) // 4, size=n, dtype=np.uint32) * 4).astype(np.uint32)
            free = rng.randint(0, 1 << 32, size=n, dtype=np.uint64).astype(np.uint32)
            words = np.where(kind == 0, small, np.where(kind == 1, ptr, free)).astype(np.uint32)
            s.heap = words.tobytes()
        stack = bytearray(rng.bytes(STACK_SIZE))
        # au-dessus de sp, c'est la zone de l'appelant : les adresses de retour y valent SENTINEL (un `pop {..., pc}`
        # de fin de fonction coupée par Ghidra rend alors la main proprement)
        top = sp - STACK
        stack[top:] = (SENTINEL.to_bytes(4, 'little')) * ((STACK_SIZE - top) // 4)
        s.stack = bytes(stack)
        return s

    # --- exécution ---

    def reset_memory(self, state):
        for address, size, perms, ub, nb, orig in self.writable:
            if address == HEAP:
                content = state.heap
            elif address == STACK:
                content = state.stack
            else:
                content = orig
            ctypes.memmove(ub, content, size)
            ctypes.memmove(nb, content, size)

    def setup_unicorn(self, state):
        a = self.arm
        uc = self.uc
        # le CPSR d'abord : changer de mode (superviseur -> utilisateur) échange les registres sp et lr
        cpsr = (state.flags << 28) | (state.q << 27) | (state.ge << 16) | 0x10
        uc.reg_write(a.UC_ARM_REG_CPSR, cpsr)
        for name, value in zip(self.ureg, state.r):
            uc.reg_write(name, value)
        uc.reg_write(a.UC_ARM_REG_FPEXC, 0x40000000)
        uc.reg_write(a.UC_ARM_REG_FPSCR, FPSCR_KERNEL)
        uc.reg_write(a.UC_ARM_REG_C13_C0_3, 0x1FF82000)
        for name, value in zip(self.ud, state.d):
            uc.reg_write(name, value)

    def run_unicorn(self, entry, state, limit):
        self.setup_unicorn(state)
        return self.emulate(entry, limit)

    def emulate(self, entry, limit):
        a = self.arm
        uc = self.uc
        try:
            uc.emu_start(entry, SENTINEL, 0, limit)
        except self.unicorn.UcError as error:
            text = str(error)
            if 'INSN_INVALID' in text:
                return 'invalid', text            # encodage indéfini ou imprévisible pour ce modèle de processeur
            if 'FETCH' in text:
                return 'budget', text             # le fil est parti ailleurs qu'au retour : tirée écartée
            return 'fault', text
        pc = uc.reg_read(a.UC_ARM_REG_PC)
        if pc != SENTINEL:
            return 'budget', pc
        return 'ok', None

    def setup_native(self, state):
        c = self.cpu
        for i, v in enumerate(state.r):
            c.r[i] = v
        c.r[15] = 0
        c.nf, c.zf, c.cf, c.vf = (state.flags >> 3) & 1, (state.flags >> 2) & 1, (state.flags >> 1) & 1, state.flags & 1
        c.qf = state.q
        c.ge = state.ge
        c.fpscr = FPSCR_KERNEL
        c.fpexc = 0x40000000
        c.tls = 0x1FF82000
        c.excl_addr = 0xFFFFFFFF
        c.budget = 20000000
        for i, v in enumerate(state.d):
            c.d[i] = v

    def run_native(self, entry, state):
        self.setup_native(state)
        return self.native.call(self.cpu, entry)

    def snapshot_unicorn(self):
        a = self.arm
        uc = self.uc
        regs = [uc.reg_read(r) for r in self.ureg]
        cpsr = uc.reg_read(a.UC_ARM_REG_CPSR)
        d = [uc.reg_read(r) for r in self.ud]
        return {'r': regs, 'nzcv': cpsr >> 28, 'q': (cpsr >> 27) & 1, 'ge': (cpsr >> 16) & 15, 'd': d,
                'fpscr': uc.reg_read(a.UC_ARM_REG_FPSCR) >> 28}

    def snapshot_native(self):
        c = self.cpu
        return {'r': [c.r[i] for i in range(15)], 'nzcv': (c.nf << 3) | (c.zf << 2) | (c.cf << 1) | c.vf, 'q': c.qf,
                'ge': c.ge, 'd': [c.d[i] for i in range(16)], 'fpscr': c.fpscr >> 28}

    def compare(self, u, n, check_vfp=True):
        diffs = []
        for name, x, y in zip(REG_NAMES, u['r'], n['r']):
            if x != y:
                diffs.append('%s unicorn=%#x natif=%#x' % (name, x, y))
        for key in ('nzcv', 'q', 'ge'):
            if u[key] != n[key]:
                diffs.append('%s unicorn=%#x natif=%#x' % (key, u[key], n[key]))
        if check_vfp:
            for i, (x, y) in enumerate(zip(u['d'], n['d'])):
                if x != y:
                    diffs.append('d%d unicorn=%#018x natif=%#018x' % (i, x, y))
            if u['fpscr'] != n['fpscr']:
                diffs.append('fpscr nzcv unicorn=%#x natif=%#x' % (u['fpscr'], n['fpscr']))
        for address, size, perms, ub, nb, orig in self.writable:
            bu, bn = bytes(ub), bytes(nb)
            if bu != bn:
                at = next(i for i in range(size) if bu[i] != bn[i])
                diffs.append('mémoire %#x unicorn=%#04x natif=%#04x' % (address + at, bu[at], bn[at]))
        return diffs

    def check_function(self, entry, draws=200, seed=0, limit=40000, ptr_regions=None):
        """Rend (verdict, détails) : 'pass', 'fail', ou 'skip' (aucune tirée exploitable)."""
        rng = np.random.RandomState(seed)
        ptr_regions = ptr_regions or [(HEAP + 0x1000, HEAP_SIZE - 0x2000)]
        compared = 0
        faults = budgets = 0
        for _ in range(draws):
            state = self.draw(rng, ptr_regions)
            self.reset_memory(state)
            kind, extra = self.run_unicorn(entry, state, limit)
            if kind in ('budget', 'invalid'):
                budgets += 1
                continue
            ucode = self.run_native(entry, state)
            if kind == 'fault':
                if ucode == 1:
                    faults += 1
                    continue
                return 'fail', {'state': state, 'diffs': ['unicorn fautif (%s), natif code %d' % (extra, ucode)]}
            if ucode != 0:
                names = {1: 'faute mémoire à %#x' % self.native.info(0), 2: 'instruction non traduite à %#x' %
                         self.native.info(0), 3: 'cible inconnue %#x' % self.native.info(0), 4: 'budget'}
                return 'fail', {'state': state, 'diffs': ['natif sorti anormalement : %s' % names.get(ucode, ucode)],
                                'code': ucode}
            diffs = self.compare(self.snapshot_unicorn(), self.snapshot_native())
            compared += 1
            if diffs:
                return 'fail', {'state': state, 'diffs': diffs}
        if compared == 0:
            return 'skip', {'faults': faults, 'budgets': budgets}
        return 'pass', {'compared': compared, 'faults': faults, 'budgets': budgets}
