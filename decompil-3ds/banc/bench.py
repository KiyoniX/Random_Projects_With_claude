"""Le banc d'essai : il monte la mémoire du jeu, le noyau, les services, et suit les paliers du démarrage.

Rien ici ne dépend d'unicorn : le processeur est donné de l'extérieur (`run.py` lui passe `cpu_unicorn`, les tests
aussi). Les chemins des données de la console sont tous sous local/, jamais versionnés.
"""
import collections
import datetime
import os
import struct
import time

from journal import Journal
from kernel import (CONFIG_PAGE, SHARED_PAGE, Kernel, Stopped)
from memory import PAGE, PERM_R, PERM_RW, PERM_RWX, PERM_RX, AddressSpace, align_up
from names import Names

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LOCAL = os.path.join(ROOT, 'local')

DEFAULT_PATHS = {
    'code': os.path.join(LOCAL, 'extrait', 'maj', 'exefs', 'code.bin'),
    'exheader': os.path.join(LOCAL, 'extrait', 'maj', 'exefs', 'exheader.bin'),
    'exefs': os.path.join(LOCAL, 'extrait', 'maj', 'exefs'),
    'romfs_base': os.path.join(LOCAL, 'dump', 'pokemon-x.cxi'),
    'romfs_update': os.path.join(LOCAL, 'dump', 'pokemon-x_maj.cxi'),
    'config': os.path.join(LOCAL, 'extrait', 'cfg-sauvegarde', 'config'),
    'font': os.path.join(LOCAL, 'extrait', 'police-partagee', 'cbf_std.bcfnt'),
    'save': os.path.join(LOCAL, 'extrait', 'sd-0004000000055d00', 'sauvegarde', 'fichiers'),
    'extdata': os.path.join(LOCAL, 'extrait', 'sd-0004000000055d00', 'extdata'),
    'out': os.path.join(LOCAL, 'analyse', 'banc'),
}

# Repères du démarrage (pokemon-x-services.md, partie 4).
ENTRY = 0x100000
MAIN = 0x106138
GAME_INIT_SYSTEMS = 0x107CBC
MAIN_LOOP = 0x1066EC
MAIN_LOOP_TURN = 0x106710

APT_STARTUP = ['GetLockHandle', 'Initialize', 'Enable', 'NotifyToWait', 'GlanceParameter', 'ReceiveParameter',
               'AppletUtility(7)', 'AppletUtility(4)', 'GetSharedFont']


def read_exheader(data):
    """Les sections, la pile, la priorité du fil principal et la version du noyau visée (3dbrew, « NCCH/Extended Header »)."""
    def section(offset):
        address, pages, size = struct.unpack_from('<III', data, offset)
        return address, pages, size
    info = {'text': section(0x10), 'rodata': section(0x20), 'data': section(0x30),
            'stack': struct.unpack_from('<I', data, 0x1C)[0], 'bss': struct.unpack_from('<I', data, 0x3C)[0],
            'priority': data[0x20F], 'title': data[:8].rstrip(b'\0').decode('latin-1'),
            'program_id': struct.unpack_from('<Q', data, 0x200)[0], 'kernel_version': None}
    for i in range(28):
        word = struct.unpack_from('<I', data, 0x370 + 4 * i)[0]
        if word >> 25 == 0x7E:      # 1111110 : version du noyau visée
            info['kernel_version'] = word & 0xFFFF
    return info


CPU_KINDS = ('unicorn', 'natif', 'hybride', 'verifier')


def cpu_factory(kind):
    """Le processeur du banc, d'après `--cpu` : `unicorn` (l'émulateur, défaut), `natif` (le jeu recompilé, et rien
    d'autre : un saut vers un module .cro est une faute), `hybride` (le natif, qui passe la main à unicorn pour le code
    non recompilé : ce qu'il faut pour aller au-delà du chargement des .cro), `verifier` (l'hybride, rejoué contre
    unicorn à chaque tranche, arrêt à la première divergence)."""
    if kind == 'unicorn':
        from cpu_unicorn import UnicornCpu
        return UnicornCpu
    if kind in ('natif', 'hybride'):
        from cpu_native import NativeCpu
        return lambda memory: NativeCpu(memory, hybrid=(kind == 'hybride'))
    if kind == 'verifier':
        from cpu_verify import VerifyCpu
        return VerifyCpu
    raise ValueError('processeur inconnu : %s (attendu : %s)' % (kind, ', '.join(CPU_KINDS)))


class Bench:
    def __init__(self, cpu_factory, paths=None, options=None, code=None, exheader=None):
        self.paths = dict(DEFAULT_PATHS)
        self.paths.update(paths or {})
        self.paths['archives'] = os.path.join(self.paths['out'], 'archives')
        self.options = options or {}
        self.names = Names() if self.options.get('names', True) else Names(names_tsv='', funcs_tsv='', carte='')
        self.journal = Journal(os.path.join(self.paths['out'], 'journal.txt'), self.names,
                               self.options.get('max_lines', 400000))
        self.memory = AddressSpace()
        self.code = bytes(code) if code is not None else open(self.paths['code'], 'rb').read()
        exheader = exheader if exheader is not None else open(self.paths['exheader'], 'rb').read()
        self.exheader = read_exheader(exheader)
        self.cpu = cpu_factory(self.memory)
        self.kernel = Kernel(self.memory, self.cpu, self.journal, self.names)
        self.kernel.log_all_svc = self.options.get('log_all_svc', True)
        self.journal.kernel = self.kernel
        self.stats = collections.Counter()
        self.events = []                      # (heure, texte) remarquables
        self.stop_request = None
        self.loop_turns = 0
        self.apt_answers = []
        self.files_opened = []
        self.romfs_reads = 0
        self.cros = []
        self.ro_steps = []
        self.command_lists = 0
        self.vblanks = 0
        self.lcd_unblacked = None
        self.services = {}
        self.romfs_base = self.romfs_update = None
        self.load_romfs()
        self.map_program()
        self.register_services()
        self.watch_milestones()

    # --- montage ---

    def load_romfs(self):
        from romfs import NcchRomfs, RomfsError
        for key in ('romfs_base', 'romfs_update'):
            path = self.paths.get(key)
            if path and os.path.isfile(path):
                try:
                    setattr(self, key, NcchRomfs(path))
                except RomfsError as exc:
                    self.events.append((0, 'romfs %s illisible : %s' % (key, exc)))

    def map_program(self):
        mem = self.memory
        ex = self.exheader
        offset = 0
        for name, perms in (('text', PERM_RX), ('rodata', PERM_R), ('data', PERM_RW)):
            address, pages, _ = ex[name]
            size = pages * PAGE
            if name == 'data':
                size = align_up(ex['data'][2] + ex['bss'])
                size = max(size, pages * PAGE)
            if size == 0:
                continue
            mem.map(address, size, perms | (PERM_RWX if name == 'data' else 0), '.%s' % name)
            chunk = self.code[offset:offset + pages * PAGE]
            mem.write(address, chunk)
            offset += pages * PAGE
        self.kernel.code_size = offset + align_up(ex['bss'])
        stack = ex['stack']
        mem.map(0x10000000 - align_up(stack), align_up(stack), PERM_RW, 'pile du fil principal')
        mem.map(CONFIG_PAGE, PAGE, PERM_R, 'page de configuration')
        mem.map(SHARED_PAGE, PAGE, PERM_RW, 'page partagée')
        mem.map(0x1F000000, 0x600000, PERM_RW, 'mémoire vidéo')
        mem.map(0x1FF00000, 0x80000, PERM_RW, 'mémoire du DSP')
        self.fill_config_pages()

    def fill_config_pages(self):
        mem = self.memory
        page = bytearray(PAGE)
        struct.pack_into('<BBBB', page, 0, 0, 0, 0x3A, 2)            # version du noyau 2.58-0
        struct.pack_into('<Q', page, 0x08, 0x0004013000008002)       # NSTID
        struct.pack_into('<I', page, 0x10, 2)                        # SYSCOREVER
        page[0x14] = 1                                               # ENVINFO : console du commerce (bit 0)
        page[0x15] = 0                                               # UNITINFO
        struct.pack_into('<I', page, 0x18, 0xF450)                   # KERNEL_CTRSDKVERSION
        struct.pack_into('<I', page, 0x30, 0)                        # APPMEMTYPE
        struct.pack_into('<III', page, 0x40, self.kernel.app_memory, 0x02C00000, 0x01400000)
        struct.pack_into('<BBBB', page, 0x60, 0, 0, 0x3A, 2)         # FIRM_VERSION
        struct.pack_into('<I', page, 0x64, 2)
        struct.pack_into('<I', page, 0x68, 0xF450)
        mem.write(CONFIG_PAGE, bytes(page))
        shared = bytearray(PAGE)
        start = datetime.datetime(2026, 10, 14, 12, 0, 0)
        milliseconds = int((start - datetime.datetime(1900, 1, 1)).total_seconds() * 1000)
        struct.pack_into('<QQ', shared, 0x20, milliseconds, 0)      # DATETIME_0 : l'heure, et le tick de la mise à jour
        struct.pack_into('<QQ', shared, 0x40, milliseconds, 0)
        shared[0x04] = 1                                             # RUNNING_HW : console du commerce
        shared[0x67] = 0                                             # pas de réseau
        struct.pack_into('<f', shared, 0x80, 0.0)                    # curseur 3D
        mem.write(SHARED_PAGE, bytes(shared))
        self.start_milliseconds = milliseconds

    def register_services(self):
        from services.apt import Apt
        from services.dsp import Dsp
        from services.fs import FsUser, prepare_archives
        from services.gsp import Gsp
        from services.ldr_ro import LdrRo
        from services.small import Cfg, ErrF, Hid, Ptm
        from services.srv import Srv
        self.events.append((0, prepare_archives(self, self.paths.get('save'), self.paths.get('extdata'))))
        self.srv = Srv(self)
        self.errf = ErrF(self)
        for cls in (Apt, FsUser, Gsp, Dsp, Hid, Cfg, Ptm, LdrRo):
            service = cls(self)
            self.services[service.name] = service
        self.apt = self.services['APT:U']
        self.gsp = self.services['gsp::Gpu']
        self.hid = self.services['hid:USER']
        self.dsp = self.services['dsp::DSP']
        self.kernel.ports['srv:'] = lambda: self.srv
        self.kernel.ports['err:f'] = lambda: self.errf

    def service_for(self, name):
        service = self.services.get(name)
        if service is None:
            from services.stubs import Stub, Y2r
            service = self.services[name] = (Y2r(self, name) if name == 'y2r:u' else Stub(self, name))
        return service

    def watch_milestones(self):
        cpu = self.cpu
        cpu.watch(MAIN, lambda a: self.reached('main', 'main (0x106138) atteint'), once=True)
        cpu.watch(GAME_INIT_SYSTEMS, lambda a: self.reached('install', 'game_init_systems (0x107cbc) atteint'),
                  once=True)
        cpu.watch(MAIN_LOOP, lambda a: self.reached('loop', 'main_loop (0x1066ec) atteint'), once=True)
        cpu.watch(MAIN_LOOP_TURN, self.loop_turn)

    def reached(self, key, text):
        if key not in self.journal.milestones:
            self.journal.milestone(self.kernel, key, text)
            self.check_milestones()

    def loop_turn(self, address):
        self.loop_turns += 1
        if self.loop_turns <= 5 or self.loop_turns % 100 == 0:
            self.journal.write(self.kernel, 'boucle principale : tour %d' % self.loop_turns)
        self.check_milestones()

    # --- rappels des services ---

    def note(self, text):
        self.journal.note(self.kernel, text)

    def note_event(self, text):
        self.events.append((self.kernel.now, text))
        self.journal.write(self.kernel, text)

    def request_stop(self, text):
        self.stop_request = text

    def on_apt_answer(self, name):
        self.apt_answers.append(name)
        self.check_milestones()

    def on_file_open(self, archive_id, path, file):
        self.files_opened.append((self.kernel.now, archive_id, file.label))
        self.check_milestones()

    def on_file_read(self, session, position, size):
        if session.file.label.startswith('romfs'):
            self.romfs_reads += 1
        self.check_milestones()

    def on_ro(self, step):
        self.ro_steps.append(step)
        self.check_milestones()

    def on_cro_loaded(self, name, address):
        self.cros.append((self.kernel.now, name, address))
        if hasattr(self.cpu, 'module_loaded'):
            # le processeur natif branche le C recompilé du module, s'il en a un pour ce code exact (cpu_native.py)
            self.cpu.module_loaded(name, address)
        self.check_milestones()

    def on_gsp_registered(self):
        self.note_event('gsp : le jeu est inscrit au relais des interruptions ; fins d\'image toutes les 1/60 s')

    def buttons_now(self):
        mask = 0
        seconds = self.kernel.now / 1e9
        for start, duration, bits in self.options.get('presses', ()):
            if start <= seconds < start + duration:
                mask |= bits
        return mask

    def on_vblank(self):
        self.vblanks += 1
        buttons = self.buttons_now()
        if buttons != self.hid.buttons:
            self.journal.write(self.kernel, 'hid : boutons tenus %#x' % buttons)
        self.hid.buttons = buttons
        self.hid.update()
        # L'heure de la page partagée suit l'horloge du banc.
        milliseconds = self.start_milliseconds + self.kernel.now // 1_000_000
        self.memory.w64(SHARED_PAGE + 0x20, milliseconds)
        self.memory.w64(SHARED_PAGE + 0x28, self.kernel.ticks())

    def on_command_list(self, address, size):
        self.command_lists += 1
        self.check_milestones()

    def on_lcd_force_black(self, value):
        if value == 0 and self.lcd_unblacked is None:
            self.lcd_unblacked = self.kernel.now
            self.note_event('SetLcdForceBlack(0) : sur la console, l\'image deviendrait visible ici')

    # --- les paliers ---

    def check_milestones(self):
        m = self.journal.milestones
        k = self.kernel
        if 'P1' not in m and 'GetLockHandle' in self.apt_answers:
            self.journal.milestone(k, 'P1', 'entry tourne ; srv: et APT:U ont répondu (GetLockHandle)')
        if 'P2' not in m and all(a in self.apt_answers for a in APT_STARTUP) and 'main' in m and 'install' in m:
            self.journal.milestone(k, 'P2', 'les neuf réponses d\'APT sont passées ; main et game_init_systems atteints')
        if 'P3' not in m and self.romfs_reads and 'Initialize' in self.ro_steps and 'LoadCRR' in self.ro_steps \
                and self.cros:
            self.journal.milestone(k, 'P3', 'romfs ouvert et lu, static.crs et static.crr donnés à ro, premier .cro '
                                   'chargé (%s)' % self.cros[0][1])
        if 'P4' not in m and self.loop_turns >= 3:
            self.journal.milestone(k, 'P4', 'la boucle principale a fait %d tours' % self.loop_turns)
        if 'P5' not in m and self.command_lists:
            self.journal.milestone(k, 'P5', 'première liste de commandes PICA envoyée par la file de gsp::Gpu')

    def highest_milestone(self):
        best = 'aucun'
        for p in ('P1', 'P2', 'P3', 'P4', 'P5'):
            if p not in self.journal.milestones:
                break
            best = p
        return best

    # --- lancement ---

    def start(self):
        ex = self.exheader
        thread = self.kernel.create_thread(ENTRY, 0, 0x10000000, ex['priority'], 0, 'principal')
        self.journal.thread_created(self.kernel, None, thread)
        self.main_thread = thread
        return thread

    def should_stop(self):
        if self.stop_request:
            return self.stop_request
        turns = self.options.get('turns')
        if turns and self.loop_turns >= turns:
            return 'la boucle principale a fait %d tours (limite demandée)' % self.loop_turns
        wall = self.options.get('wall_seconds')
        if wall and time.time() - self.started > wall:
            return 'limite de temps du PC atteinte (%d s)' % wall
        return None

    def run(self):
        self.started = time.time()
        self.start()
        limit = int(self.options.get('seconds', 30) * 1e9)
        reason = self.kernel.run(limit, self.should_stop)
        self.elapsed = time.time() - self.started
        self.journal.write(self.kernel, '=== arrêt : %s' % reason)
        return reason
