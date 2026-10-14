"""Le noyau du banc : ce que kernel11 fait pour un jeu, réécrit en Python (fiches/kernel11.md).

Il tient les objets (événements, mutex, sémaphores, minuteries, arbitres, fils, blocs partagés, sessions), la table
des poignées du processus, la mémoire (ControlMemory, MapMemoryBlock), les fils et leur ordonnancement, l'horloge,
et répond aux appels système. Il ne connaît le processeur que par l'interface de `cpu.py`.

L'horloge est celle du banc, pas celle du PC : elle avance d'un coût fixe à chaque appel système et à chaque tranche
d'instructions, et saute directement à la prochaine échéance (réveil, minuterie, fin d'image) quand plus aucun fil
n'est prêt. Une exécution est donc reproductible d'une fois sur l'autre.

L'ordonnanceur : le fil prêt le plus prioritaire tourne (nombre le plus petit) ; un fil plus prioritaire qui devient
prêt prend la place à la sortie de l'appel système suivant, comme sur la console. Au bout d'une tranche
d'instructions, le fil qui attend depuis le plus longtemps passe, quelle que soit sa priorité : c'est ce qui tient
lieu des deux cœurs de la console (un fil qui tourne en boucle sur un cœur n'empêche pas l'autre d'avancer).
"""
import heapq
import itertools
import struct

from cpu import Stop
from memory import (PAGE, PERM_R, PERM_RW, PERM_RWX, PERM_W, Backing, MemoryError3ds, align_up)

# --- codes de résultat (kernel11.md, parties 3 et 7) ---
OK = 0
TIMEOUT = 0x09401BFE
ERR_INVALID_HANDLE = 0xD8E007F7
ERR_INVALID_ADDRESS = 0xE0E01BF5
ERR_MISALIGNED_ADDRESS = 0xE0E01BF1
ERR_MISALIGNED_SIZE = 0xE0E01BF2
ERR_INVALID_ENUM = 0xE0E01BEE
ERR_OUT_OF_RANGE = 0xE0E01BFD
ERR_NOT_IMPLEMENTED = 0xF8C007F4
ERR_UNKNOWN_INFO = 0xD8E007ED
ERR_PORT_NOT_FOUND = 0xD88007FA
ERR_NOT_OWNER = 0xD8E0041F
ERR_INVALID_COMBINATION = 0xD8E007FD
ERR_SESSION_CLOSED = 0xC920181A

PSEUDO_THREAD = 0xFFFF8000
PSEUDO_PROCESS = 0xFFFF8001

# --- plan mémoire d'une application (kernel11.md, partie 6) ---
HEAP_BASE, HEAP_END = 0x08000000, 0x10000000
LINEAR_BASE, LINEAR_END = 0x14000000, 0x1C000000
TLS_BASE = 0x1FF82000
TLS_SLOT = 0x200
CONFIG_PAGE = 0x1FF80000
SHARED_PAGE = 0x1FF81000

TICKS_PER_SECOND = 268111856

# --- temps du banc ---
SLICE_INSTRUCTIONS = 200000
NS_PER_INSTRUCTION = 4          # un peu plus que 1 / 268 MHz : le banc n'a pas le pipeline de la console
SVC_COST_NS = 2000

READY, WAITING, DEAD = 'prêt', 'attend', 'fini'


class Stopped(Exception):
    """Le banc s'arrête : `reason` dit pourquoi, en français."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


# --- objets du noyau (kernel11.md, partie 4) ---

class KObject:
    kind = 'objet'
    waitable = False

    def __init__(self, kernel, name=''):
        self.kernel = kernel
        self.serial = next(kernel.serials)
        self.name = name

    def label(self):
        return '%s#%d%s' % (self.kind, self.serial, ' « %s »' % self.name if self.name else '')

    def is_free(self, thread):
        return False

    def acquire(self, thread):
        pass

    def on_close(self):
        pass


class Event(KObject):
    kind = 'événement'
    waitable = True
    ONESHOT, STICKY, PULSE = 0, 1, 2

    def __init__(self, kernel, reset_type=0, name=''):
        super().__init__(kernel, name)
        self.reset_type = reset_type
        self.signaled = False
        self.listeners = []          # rappels Python quand le jeu déclenche l'événement (services du banc)
        self.signal_count = 0

    def is_free(self, thread):
        return self.signaled

    def acquire(self, thread):
        if self.reset_type == Event.ONESHOT:
            self.signaled = False

    def signal(self):
        self.signal_count += 1
        self.signaled = True
        for listener in list(self.listeners):
            listener(self)
        self.kernel.wake_waiters()
        if self.reset_type == Event.PULSE:
            self.signaled = False

    def clear(self):
        self.signaled = False


class Semaphore(KObject):
    kind = 'sémaphore'
    waitable = True

    def __init__(self, kernel, count, maximum, name=''):
        super().__init__(kernel, name)
        self.count = count
        self.maximum = maximum

    def is_free(self, thread):
        return self.count > 0

    def acquire(self, thread):
        self.count -= 1


class Mutex(KObject):
    kind = 'mutex'
    waitable = True

    def __init__(self, kernel, owner=None, name=''):
        super().__init__(kernel, name)
        self.owner = owner
        self.depth = 1 if owner else 0

    def is_free(self, thread):
        return self.owner is None or self.owner is thread

    def acquire(self, thread):
        self.owner = thread
        self.depth += 1

    def release(self, thread):
        if self.owner is not thread:
            return ERR_NOT_OWNER
        self.depth -= 1
        if self.depth == 0:
            self.owner = None
            self.kernel.wake_waiters()
        return OK


class Timer(KObject):
    kind = 'minuterie'
    waitable = True

    def __init__(self, kernel, reset_type=0, name=''):
        super().__init__(kernel, name)
        self.reset_type = reset_type
        self.signaled = False
        self.token = None

    def is_free(self, thread):
        return self.signaled

    def acquire(self, thread):
        if self.reset_type == Event.ONESHOT:
            self.signaled = False

    def fire(self, interval, token):
        if token is not self.token:
            return
        self.signaled = True
        self.kernel.wake_waiters()
        if self.reset_type == Event.PULSE:
            self.signaled = False
        if interval > 0:
            self.kernel.schedule(self.kernel.now + interval, lambda: self.fire(interval, token))


class AddressArbiter(KObject):
    kind = 'arbitre'


class ResourceLimit(KObject):
    kind = 'limite'


class SharedMemory(KObject):
    """Un bloc de mémoire partagée. `address` : là où il se projette quand on demande l'adresse 0."""
    kind = 'mémoire partagée'

    def __init__(self, kernel, size, backing=None, offset=0, address=0, name=''):
        super().__init__(kernel, name)
        self.size = align_up(size)
        self.backing = backing or Backing(self.size, name)
        self.offset = offset
        self.address = address
        self.mappings = []

    def read(self, offset, size):
        return bytes(self.backing.view[self.offset + offset:self.offset + offset + size])

    def write(self, offset, data):
        self.backing.view[self.offset + offset:self.offset + offset + len(data)] = data

    def u8(self, offset):
        return self.backing.view[self.offset + offset]

    def u32(self, offset):
        return struct.unpack_from('<I', self.backing.view, self.offset + offset)[0]

    def w32(self, offset, value):
        struct.pack_into('<I', self.backing.view, self.offset + offset, value & 0xFFFFFFFF)


class Process(KObject):
    kind = 'processus'

    def __init__(self, kernel, pid, name=''):
        super().__init__(kernel, name)
        self.pid = pid


class ClientSession(KObject):
    """Le bout client d'une session : `handler` est l'objet Python qui répond (un service du banc)."""
    kind = 'session'

    def __init__(self, kernel, handler, name=''):
        super().__init__(kernel, name or getattr(handler, 'name', '?'))
        self.handler = handler

    def on_close(self):
        close = getattr(self.handler, 'on_session_closed', None)
        if close:
            close(self)


class Thread(KObject):
    kind = 'fil'
    waitable = True

    def __init__(self, kernel, thread_id, entry, priority, core, tls, stack_top, name=''):
        super().__init__(kernel, name)
        self.thread_id = thread_id
        self.entry = entry
        self.priority = priority
        self.core = core
        self.tls = tls
        self.stack_top = stack_top
        self.state = READY
        self.context = None
        self.pending = {}             # registres à écrire quand le fil reprendra
        self.wait = None              # ce que le fil attend (Wait)
        self.ready_since = 0
        self.svc_count = 0
        self.created_at = kernel.now

    def is_free(self, thread):
        return self.state == DEAD


class Wait:
    """Une attente : sur des objets (tous ou un seul), sur une adresse (arbitre), ou un simple sommeil."""

    def __init__(self, kind, objects=(), wait_all=False, deadline=None, address=None, arbiter=None, what=''):
        self.kind = kind              # 'sync', 'arbiter', 'sleep'
        self.objects = list(objects)
        self.wait_all = wait_all
        self.deadline = deadline
        self.address = address
        self.arbiter = arbiter
        self.what = what
        self.since = None


# --- la table des poignées (kernel11.md, partie 4) ---

class HandleTable:
    def __init__(self, size=512):
        self.size = size
        self.entries = {}             # index -> (compteur, objet)
        self.counter = 0

    def add(self, obj):
        for index in range(self.size):
            if index not in self.entries:
                break
        else:
            raise Stopped('table des poignées pleine (%d)' % self.size)
        self.counter = self.counter + 1 if self.counter < 0x7FFF else 1
        self.entries[index] = (self.counter, obj)
        return index | self.counter << 15

    def get(self, handle):
        entry = self.entries.get(handle & 0x7FFF)
        if entry is None or entry[0] != handle >> 15 & 0x7FFF or handle >> 30:
            return None
        return entry[1]

    def remove(self, handle):
        obj = self.get(handle)
        if obj is not None:
            del self.entries[handle & 0x7FFF]
        return obj

    def handles_of(self, obj):
        return [index | counter << 15 for index, (counter, o) in self.entries.items() if o is obj]


class Kernel:
    def __init__(self, memory, cpu, journal, names):
        self.memory = memory
        self.cpu = cpu
        self.journal = journal
        self.names = names
        self.serials = itertools.count(1)
        self.now = 0                                  # nanosecondes du banc
        self.events = []                              # tas (échéance, ordre, rappel)
        self.event_order = itertools.count()
        self.handles = HandleTable()
        self.process = Process(self, 0x30, 'Pokémon X')
        self.resource_limit = ResourceLimit(self, 'application')
        self.threads = []
        self.thread_ids = itertools.count(0x40)
        self.loaded = None                            # le fil dont le contexte est dans le processeur
        self.current = None                           # le fil qui tourne
        self.ready_order = itertools.count()
        self.tls_used = set()
        self.ports = {}                               # nom -> fabrique de session
        self.services = {}                            # nom -> service
        self.heap_backing = Backing(HEAP_END - HEAP_BASE, 'tas')
        self.linear_backing = Backing(LINEAR_END - LINEAR_BASE, 'tas linéaire')
        self.app_memory = 0x04000000                  # APPMEMALLOC d'un titre de l'ancienne 3DS (64 Mo)
        self.code_size = 0
        self.watchers = []                            # rappels (fil, numéro, ...) après chaque appel système
        self.stop_reason = None
        self.svc_table = {
            0x01: self.svc_control_memory, 0x02: self.svc_query_memory, 0x03: self.svc_exit_process,
            0x08: self.svc_create_thread, 0x09: self.svc_exit_thread, 0x0A: self.svc_sleep_thread,
            0x0B: self.svc_get_thread_priority, 0x0C: self.svc_set_thread_priority,
            0x13: self.svc_create_mutex, 0x14: self.svc_release_mutex, 0x15: self.svc_create_semaphore,
            0x16: self.svc_release_semaphore, 0x17: self.svc_create_event, 0x18: self.svc_signal_event,
            0x19: self.svc_clear_event, 0x1A: self.svc_create_timer, 0x1B: self.svc_set_timer,
            0x1C: self.svc_cancel_timer, 0x1D: self.svc_clear_timer, 0x1E: self.svc_create_memory_block,
            0x1F: self.svc_map_memory_block, 0x20: self.svc_unmap_memory_block,
            0x21: self.svc_create_address_arbiter, 0x22: self.svc_arbitrate_address, 0x23: self.svc_close_handle,
            0x24: self.svc_wait_synchronization1, 0x25: self.svc_wait_synchronization_n,
            0x27: self.svc_duplicate_handle, 0x28: self.svc_get_system_tick, 0x29: self.svc_get_handle_info,
            0x2A: self.svc_get_system_info, 0x2B: self.svc_get_process_info, 0x2D: self.svc_connect_to_port,
            0x32: self.svc_send_sync_request, 0x35: self.svc_get_process_id, 0x37: self.svc_get_thread_id,
            0x38: self.svc_get_resource_limit, 0x39: self.svc_get_resource_limit_limit_values,
            0x3A: self.svc_get_resource_limit_current_values, 0x3C: self.svc_break,
            0x3D: self.svc_output_debug_string,
        }
        self.svc_counts = {}
        self.log_all_svc = True

    # --- échéances ---

    def schedule(self, when, callback):
        heapq.heappush(self.events, (when, next(self.event_order), callback))

    def run_due_events(self):
        while self.events and self.events[0][0] <= self.now:
            _, _, callback = heapq.heappop(self.events)
            callback()

    def ticks(self):
        return self.now * TICKS_PER_SECOND // 1_000_000_000

    # --- poignées ---

    def add_handle(self, obj):
        return self.handles.add(obj)

    def lookup(self, handle, thread=None):
        if handle == PSEUDO_THREAD:
            return thread or self.current
        if handle == PSEUDO_PROCESS:
            return self.process
        return self.handles.get(handle)

    # --- fils ---

    def allocate_tls(self):
        slot = 0
        while slot in self.tls_used:
            slot += 1
        self.tls_used.add(slot)
        address = TLS_BASE + slot * TLS_SLOT
        page = address & ~(PAGE - 1)
        if not self.memory.is_mapped(page):
            self.memory.map(page, PAGE, PERM_RW, 'stockage local des fils')
        self.memory.fill(address, TLS_SLOT)
        return address

    def create_thread(self, entry, arg, stack_top, priority, core, name=''):
        tls = self.allocate_tls()
        thread = Thread(self, next(self.thread_ids), entry, priority, core, tls, stack_top, name)
        saved = self.cpu.save() if self.loaded is not None else None
        thread.context = self.cpu.new_context(entry, stack_top, arg, tls, thumb=bool(entry & 1))
        if saved is not None:
            self.cpu.restore(saved)
        thread.ready_since = next(self.ready_order)
        self.threads.append(thread)
        return thread

    def make_ready(self, thread, result_regs=None):
        thread.state = READY
        thread.wait = None
        if result_regs:
            thread.pending.update(result_regs)
        thread.ready_since = next(self.ready_order)

    def block(self, thread, wait):
        thread.state = WAITING
        wait.since = self.now
        thread.wait = wait
        if wait.deadline is not None:
            self.schedule(wait.deadline, lambda: self._timeout(thread, wait))

    def _timeout(self, thread, wait):
        if thread.wait is not wait or thread.state != WAITING:
            return
        if wait.kind == 'sleep':
            self.make_ready(thread, {'r0': OK})
        else:
            if wait.kind == 'arbiter':
                pass
            self.make_ready(thread, {'r0': TIMEOUT})

    def wake_waiters(self):
        """Sert, du plus prioritaire au moins prioritaire, chaque fil dont l'attente peut être satisfaite."""
        progress = True
        while progress:
            progress = False
            waiting = sorted((t for t in self.threads if t.state == WAITING and t.wait and t.wait.kind == 'sync'),
                             key=lambda t: (t.priority, t.ready_since))
            for thread in waiting:
                wait = thread.wait
                if wait.wait_all:
                    if all(o.is_free(thread) for o in wait.objects):
                        for o in wait.objects:
                            o.acquire(thread)
                        self.make_ready(thread, {'r0': OK, 'r1': 0})
                        progress = True
                        break
                else:
                    for index, o in enumerate(wait.objects):
                        if o.is_free(thread):
                            o.acquire(thread)
                            self.make_ready(thread, {'r0': OK, 'r1': index})
                            progress = True
                            break
                    if progress:
                        break

    def ready_threads(self):
        return [t for t in self.threads if t.state == READY]

    def pick(self):
        ready = self.ready_threads()
        if not ready:
            return None
        return min(ready, key=lambda t: (t.priority, t.ready_since))

    def switch_to(self, thread):
        if self.loaded is not thread:
            if self.loaded is not None and self.loaded.state != DEAD:
                self.loaded.context = self.cpu.save()
            self.cpu.restore(thread.context)
            self.cpu.set('tls', thread.tls)
            self.loaded = thread
        for name, value in thread.pending.items():
            self.cpu.set(name, value)
        thread.pending = {}
        self.current = thread

    def next_event_time(self):
        return self.events[0][0] if self.events else None

    # --- la boucle ---

    def run(self, limit_ns, should_stop=None):
        """Fait tourner le jeu jusqu'à un arrêt. Rend la raison, en français."""
        try:
            while True:
                if self.now >= limit_ns:
                    raise Stopped('limite de temps du banc atteinte (%.1f s)' % (limit_ns / 1e9))
                if should_stop:
                    reason = should_stop()
                    if reason:
                        raise Stopped(reason)
                self.run_due_events()
                thread = self.current
                if thread is None or thread.state != READY:
                    thread = self.pick()
                    if thread is None:
                        when = self.next_event_time()
                        if when is None:
                            raise Stopped('plus aucun fil prêt et plus aucune échéance : interblocage')
                        self.now = max(self.now, when)
                        continue
                else:
                    best = self.pick()
                    if best is not None and best.priority < thread.priority:
                        thread.ready_since = next(self.ready_order)
                        thread = best
                self.switch_to(thread)
                stop = self.cpu.run(SLICE_INSTRUCTIONS)
                if stop.kind == Stop.SVC:
                    self.now += SVC_COST_NS
                    self.handle_svc(thread, stop.number)
                elif stop.kind == Stop.LIMIT:
                    self.now += SLICE_INSTRUCTIONS * NS_PER_INSTRUCTION
                    others = [t for t in self.ready_threads() if t is not thread]
                    if others:
                        thread.ready_since = next(self.ready_order)
                        self.current = min(others, key=lambda t: t.ready_since)
                elif stop.kind == Stop.FAULT:
                    self.dump_registers(thread)
                    raise Stopped('faute du fil %#x à %#010x (%s) : %s'
                                  % (thread.thread_id, stop.address, self.names.function(stop.address), stop.detail))
                elif stop.kind == Stop.REQUEST:
                    pass
        except Stopped as stopped:
            self.stop_reason = stopped.reason
            return stopped.reason

    def dump_registers(self, thread):
        regs = self.cpu.regs()
        text = ' '.join('%s=%08x' % (name, regs[name]) for name in regs)
        self.journal.write(self, 'registres du fil %#x : %s' % (thread.thread_id, text))
        try:
            stack = self.memory.words(regs['sp'], 16)
            self.journal.write(self, 'pile : ' + ' '.join('%08x' % w for w in stack))
            calls = [w for w in stack if 0x100000 <= w < 0x53F000 and self.names.function(w)]
            self.journal.write(self, 'adresses de code sur la pile : ' + ', '.join(
                '%#x %s' % (w, self.names.function(w)) for w in calls))
        except MemoryError3ds:
            pass

    # --- appels système ---

    def arg(self, name):
        return self.cpu.get(name)

    def ret(self, **regs):
        for name, value in regs.items():
            self.cpu.set(name, value)

    def handle_svc(self, thread, number):
        thread.svc_count += 1
        self.svc_counts[number] = self.svc_counts.get(number, 0) + 1
        pc = self.cpu.get('pc') - 4
        lr = self.cpu.get('lr')
        handler = self.svc_table.get(number)
        if handler is None:
            self.ret(r0=ERR_NOT_IMPLEMENTED)
            self.journal.svc(self, thread, number, pc, lr, 'pas fait par le banc : rend %#x' % ERR_NOT_IMPLEMENTED)
            return
        try:
            summary = handler(thread)
        except MemoryError3ds as error:
            self.ret(r0=ERR_INVALID_ADDRESS)
            summary = 'adresse invalide (%s) : rend %#x' % (error, ERR_INVALID_ADDRESS)
        if summary is False:
            summary = None
        elif summary is None and self.log_all_svc and number != 0x28:
            summary = '-> r0=%#x r1=%#x' % (self.cpu.get('r0'), self.cpu.get('r1')) if thread.state == READY \
                else '(%s)' % (thread.wait.what if thread.wait else 'bloqué')
        if summary is not None:
            self.journal.svc(self, thread, number, pc, lr, summary)
        for watcher in self.watchers:
            watcher(thread, number)

    def check_handle_result(self, obj, cls):
        return obj is not None and isinstance(obj, cls)

    # 0x01
    def svc_control_memory(self, thread):
        op, addr0, addr1, size, perms = (self.arg(r) for r in ('r0', 'r1', 'r2', 'r3', 'r4'))
        kind = op & 0xFF
        linear = bool(op & 0x10000)
        text = 'ControlMemory(op=%#x, addr0=%#x, addr1=%#x, taille=%#x, droits=%d)' % (op, addr0, addr1, size, perms)
        if addr0 % PAGE or addr1 % PAGE:
            self.ret(r0=ERR_MISALIGNED_ADDRESS)
            return text + ' -> adresse mal alignée'
        if size % PAGE:
            self.ret(r0=ERR_MISALIGNED_SIZE)
            return text + ' -> taille mal alignée'
        uperm = (perms & 3) or PERM_R
        if kind == 3 and linear:
            if addr0 == 0:
                addr0 = self.memory.find_free(LINEAR_BASE, LINEAR_END - 0x00800000, size)
            if addr0 is None or not LINEAR_BASE <= addr0 < LINEAR_END or self.memory.overlaps(addr0, size):
                self.ret(r0=ERR_INVALID_ADDRESS)
                return text + ' -> plus de place dans le tas linéaire'
            self.memory.map(addr0, size, PERM_RWX, 'tas linéaire', self.linear_backing, addr0 - LINEAR_BASE)
            self.memory.fill(addr0, size)
            self.ret(r0=OK, r1=addr0)
            return text + ' -> 0, %#x (tas linéaire)' % addr0
        if kind == 3:
            if not HEAP_BASE <= addr0 < HEAP_END or addr0 + size > HEAP_END:
                self.ret(r0=ERR_INVALID_ADDRESS)
                return text + ' -> hors du tas'
            # Les pages déjà là restent (le jeu agrandit son tas par le haut) ; seules les manquantes sont prises.
            cursor = addr0
            while cursor < addr0 + size:
                if self.memory.is_mapped(cursor):
                    cursor += PAGE
                    continue
                stop = cursor
                while stop < addr0 + size and not self.memory.is_mapped(stop):
                    stop += PAGE
                self.memory.map(cursor, stop - cursor, PERM_RWX, 'tas', self.heap_backing, cursor - HEAP_BASE)
                self.memory.fill(cursor, stop - cursor)
                cursor = stop
            self.ret(r0=OK, r1=addr0)
            return text + ' -> 0, %#x (tas)' % addr0
        if kind == 1:
            self.memory.unmap(addr0, size)
            self.ret(r0=OK, r1=addr0)
            return text + ' -> 0 (libéré)'
        if kind == 4:
            cursor = 0
            while cursor < size:
                region = self.memory.find(addr1 + cursor)
                if region is None:
                    self.ret(r0=ERR_INVALID_ADDRESS)
                    return text + ' -> source non projetée'
                step = min(size - cursor, region.end - (addr1 + cursor))
                self.memory.map(addr0 + cursor, step, PERM_RWX, 'alias', region.backing,
                                region.offset + addr1 + cursor - region.start)
                cursor += step
            self.ret(r0=OK, r1=addr0)
            return text + ' -> 0 (alias)'
        if kind == 5:
            self.memory.unmap(addr0, size)
            self.ret(r0=OK, r1=addr0)
            return text + ' -> 0 (alias retiré)'
        if kind == 6:
            self.memory.protect(addr0, size, uperm | (PERM_RWX & 4))
            self.ret(r0=OK, r1=addr0)
            return text + ' -> 0 (droits)'
        self.ret(r0=ERR_INVALID_ENUM)
        return text + ' -> opération inconnue'

    # 0x02
    def svc_query_memory(self, thread):
        address = self.arg('r2')
        region = self.memory.find(address)
        if region is not None:
            base, end, perms = region.start, region.end, region.perms
            # Les plages voisines de mêmes droits forment un seul bloc pour la console.
            for r in self.memory.regions:
                if r.end == base and r.perms == perms:
                    base = r.start
            for r in self.memory.regions:
                if r.start == end and r.perms == perms:
                    end = r.end
            state = 5 if HEAP_BASE <= address < LINEAR_END else 3
            self.ret(r0=OK, r1=base, r2=end - base, r3=perms & 3, r4=state, r5=0)
            return 'QueryMemory(%#x) -> %#x + %#x, droits %d' % (address, base, end - base, perms & 3)
        low, high = 0, 0x40000000
        for r in self.memory.regions:
            if r.end <= address:
                low = max(low, r.end)
            elif r.start > address:
                high = min(high, r.start)
        self.ret(r0=OK, r1=low, r2=high - low, r3=0, r4=0, r5=0)
        return 'QueryMemory(%#x) -> libre %#x + %#x' % (address, low, high - low)

    # 0x03
    def svc_exit_process(self, thread):
        self.journal.svc(self, thread, 3, self.cpu.get('pc') - 4, self.cpu.get('lr'), 'ExitProcess')
        raise Stopped('le jeu a appelé svcExitProcess')

    # 0x08
    def svc_create_thread(self, thread):
        priority, entry, arg, stack_top, core = (self.arg(r) for r in ('r0', 'r1', 'r2', 'r3', 'r4'))
        core = core - (1 << 32) if core & 0x80000000 else core
        if priority >= 0x40:
            self.ret(r0=ERR_OUT_OF_RANGE)
            return 'CreateThread(priorité %#x) -> refusé' % priority
        new = self.create_thread(entry, arg, stack_top, priority, core)
        handle = self.add_handle(new)
        self.ret(r0=OK, r1=handle)
        self.journal.thread_created(self, thread, new)
        return 'CreateThread(entrée %#x %s, arg %#x, pile %#x, priorité %#x, cœur %d) -> fil %#x, h=%#x' % (
            entry, self.names.function(entry), arg, stack_top, priority, core, new.thread_id, handle)

    # 0x09
    def svc_exit_thread(self, thread):
        thread.state = DEAD
        self.tls_used.discard((thread.tls - TLS_BASE) // TLS_SLOT)
        self.journal.svc(self, thread, 9, self.cpu.get('pc') - 4, self.cpu.get('lr'), 'ExitThread')
        self.wake_waiters()
        return False

    # 0x0A
    def svc_sleep_thread(self, thread):
        ns = self.arg('r0') | self.arg('r1') << 32
        if ns & (1 << 63):
            self.ret(r0=OK)
            return None
        if ns == 0:
            thread.ready_since = next(self.ready_order)
            self.ret(r0=OK)
            others = [t for t in self.ready_threads() if t is not thread and t.priority == thread.priority]
            if others:
                self.current = None
            return None
        self.ret(r0=OK)
        self.block(thread, Wait('sleep', deadline=self.now + ns, what='sommeil %d µs' % (ns // 1000)))
        return None

    # 0x0B
    def svc_get_thread_priority(self, thread):
        target = self.lookup(self.arg('r1'), thread)
        if not isinstance(target, Thread):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'GetThreadPriority -> poignée invalide'
        self.ret(r0=OK, r1=target.priority)
        return None

    # 0x0C
    def svc_set_thread_priority(self, thread):
        target = self.lookup(self.arg('r0'), thread)
        priority = self.arg('r1')
        if not isinstance(target, Thread):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'SetThreadPriority -> poignée invalide'
        if priority >= 0x40:
            self.ret(r0=ERR_OUT_OF_RANGE)
            return 'SetThreadPriority(%#x) -> hors bornes' % priority
        target.priority = priority
        self.ret(r0=OK)
        return 'SetThreadPriority(fil %#x, %#x) -> 0' % (target.thread_id, priority)

    # 0x13, 0x14
    def svc_create_mutex(self, thread):
        locked = self.arg('r1') & 0xFF
        mutex = Mutex(self, thread if locked else None)
        handle = self.add_handle(mutex)
        self.ret(r0=OK, r1=handle)
        return 'CreateMutex(pris=%d) -> h=%#x' % (locked, handle)

    def svc_release_mutex(self, thread):
        mutex = self.lookup(self.arg('r0'))
        if not isinstance(mutex, Mutex):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'ReleaseMutex -> poignée invalide'
        result = mutex.release(thread)
        self.ret(r0=result)
        return None if result == OK else 'ReleaseMutex(%s) -> %#x (pas le propriétaire)' % (mutex.label(), result)

    # 0x15, 0x16
    def svc_create_semaphore(self, thread):
        count, maximum = self.arg('r1'), self.arg('r2')
        semaphore = Semaphore(self, count, maximum)
        handle = self.add_handle(semaphore)
        self.ret(r0=OK, r1=handle)
        return 'CreateSemaphore(%d, max %d) -> h=%#x' % (count, maximum, handle)

    def svc_release_semaphore(self, thread):
        semaphore = self.lookup(self.arg('r1'))
        count = self.arg('r2')
        if not isinstance(semaphore, Semaphore):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'ReleaseSemaphore -> poignée invalide'
        if semaphore.count + count > semaphore.maximum:
            self.ret(r0=ERR_INVALID_COMBINATION)
            return 'ReleaseSemaphore -> au-delà du maximum'
        previous = semaphore.count
        semaphore.count += count
        self.ret(r0=OK, r1=previous)
        self.wake_waiters()
        return None

    # 0x17 à 0x19
    def svc_create_event(self, thread):
        reset = self.arg('r1')
        event = Event(self, reset)
        handle = self.add_handle(event)
        self.ret(r0=OK, r1=handle)
        return 'CreateEvent(type %d) -> %s, h=%#x' % (reset, event.label(), handle)

    def svc_signal_event(self, thread):
        event = self.lookup(self.arg('r0'))
        if not isinstance(event, Event):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'SignalEvent(%#x) -> poignée invalide' % self.arg('r0')
        self.ret(r0=OK)
        event.signal()
        return 'SignalEvent(%s)' % event.label() if event.listeners or event.name else None

    def svc_clear_event(self, thread):
        event = self.lookup(self.arg('r0'))
        if not isinstance(event, (Event, Timer)):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'ClearEvent(%#x) -> poignée invalide' % self.arg('r0')
        event.signaled = False
        self.ret(r0=OK)
        return None

    # 0x1A à 0x1D
    def svc_create_timer(self, thread):
        timer = Timer(self, self.arg('r1'))
        handle = self.add_handle(timer)
        self.ret(r0=OK, r1=handle)
        return 'CreateTimer(type %d) -> h=%#x' % (timer.reset_type, handle)

    def svc_set_timer(self, thread):
        timer = self.lookup(self.arg('r0'))
        initial = self.arg('r2') | self.arg('r3') << 32
        interval = self.arg('r1') | self.arg('r4') << 32
        if not isinstance(timer, Timer):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'SetTimer -> poignée invalide'
        if initial >> 63 or interval >> 63:
            self.ret(r0=ERR_INVALID_COMBINATION)
            return 'SetTimer -> délai négatif'
        token = object()
        timer.token = token
        self.schedule(self.now + initial, lambda: timer.fire(interval, token))
        self.ret(r0=OK)
        return 'SetTimer(%s, %d ns, période %d ns)' % (timer.label(), initial, interval)

    def svc_cancel_timer(self, thread):
        timer = self.lookup(self.arg('r0'))
        if isinstance(timer, Timer):
            timer.token = None
        self.ret(r0=OK)
        return None

    def svc_clear_timer(self, thread):
        timer = self.lookup(self.arg('r0'))
        if isinstance(timer, Timer):
            timer.signaled = False
        self.ret(r0=OK)
        return None

    # 0x1E à 0x20
    def svc_create_memory_block(self, thread):
        other, address, size, mine = (self.arg(r) for r in ('r0', 'r1', 'r2', 'r3'))
        text = 'CreateMemoryBlock(%#x, taille %#x, droits %d/%d)' % (address, size, mine, other)
        if address == 0:
            self.ret(r0=0xD92007EA)
            return text + ' -> adresse 0 refusée à une application'
        backing, offset = self.memory.backing_at(address)
        if backing is None:
            self.ret(r0=ERR_INVALID_ADDRESS)
            return text + ' -> adresse non projetée'
        block = SharedMemory(self, size, backing, offset, address, 'bloc du jeu')
        handle = self.add_handle(block)
        self.ret(r0=OK, r1=handle)
        return text + ' -> h=%#x' % handle

    def map_shared(self, block, address, perms):
        if address == 0:
            address = block.address
        if address == 0:
            address = self.memory.find_free(0x10000000, 0x14000000, block.size)
        if self.memory.overlaps(address, block.size):
            region = self.memory.find(address)
            if region is not None and region.backing is block.backing:
                return address
            raise Stopped('MapMemoryBlock : %#x est déjà pris' % address)
        self.memory.map(address, block.size, PERM_RWX, block.name or 'mémoire partagée', block.backing, block.offset)
        block.mappings.append(address)
        return address

    def svc_map_memory_block(self, thread):
        handle, address, mine, other = (self.arg(r) for r in ('r0', 'r1', 'r2', 'r3'))
        block = self.lookup(handle)
        if not isinstance(block, SharedMemory):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'MapMemoryBlock(%#x) -> poignée invalide' % handle
        if address and not 0x08000000 <= address < 0x14000000:
            self.ret(r0=ERR_INVALID_ADDRESS)
            return 'MapMemoryBlock(%s, %#x) -> hors de 0x08000000-0x14000000' % (block.label(), address)
        mapped = self.map_shared(block, address, mine)
        self.ret(r0=OK)
        return 'MapMemoryBlock(%s, %#x, droits %d) -> projeté à %#x' % (block.label(), address, mine, mapped)

    def svc_unmap_memory_block(self, thread):
        block = self.lookup(self.arg('r0'))
        address = self.arg('r1')
        if not isinstance(block, SharedMemory):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'UnmapMemoryBlock -> poignée invalide'
        if address in block.mappings:
            block.mappings.remove(address)
            self.memory.unmap(address, block.size)
        self.ret(r0=OK)
        return 'UnmapMemoryBlock(%s, %#x)' % (block.label(), address)

    # 0x21, 0x22
    def svc_create_address_arbiter(self, thread):
        arbiter = AddressArbiter(self)
        handle = self.add_handle(arbiter)
        self.ret(r0=OK, r1=handle)
        return 'CreateAddressArbiter -> h=%#x' % handle

    def svc_arbitrate_address(self, thread):
        handle, address, kind, value = (self.arg(r) for r in ('r0', 'r1', 'r2', 'r3'))
        timeout = self.arg('r4') | self.arg('r5') << 32
        arbiter = self.lookup(handle)
        signed = value - (1 << 32) if value & 0x80000000 else value
        if address & 3:
            self.ret(r0=0xD8E007F1)
            return 'ArbitrateAddress(%#x) -> mal alignée' % address
        if not isinstance(arbiter, AddressArbiter):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'ArbitrateAddress -> poignée invalide'
        if kind == 0:
            waiting = sorted((t for t in self.threads if t.state == WAITING and t.wait and t.wait.kind == 'arbiter'
                              and t.wait.arbiter is arbiter and t.wait.address == address),
                             key=lambda t: (t.priority, t.wait.since))
            count = len(waiting) if signed < 0 else min(signed, len(waiting))
            for t in waiting[:count]:
                self.make_ready(t, {'r0': OK})
            self.ret(r0=OK)
            return None
        if kind > 4:
            self.ret(r0=0xD8E093ED)
            return 'ArbitrateAddress(type %d) -> type inconnu' % kind
        current = self.memory.u32(address)
        current_signed = current - (1 << 32) if current & 0x80000000 else current
        if current_signed >= signed:
            self.ret(r0=OK)
            return None
        if kind in (2, 4):
            self.memory.w32(address, current - 1)
        deadline = None
        if kind in (3, 4) and not timeout >> 63:
            deadline = self.now + timeout
        self.ret(r0=OK)
        self.block(thread, Wait('arbiter', address=address, arbiter=arbiter, deadline=deadline,
                                what='adresse %#x (%s)' % (address, self.names.function(self.cpu.get('lr')))))
        return None

    # 0x23
    def svc_close_handle(self, thread):
        handle = self.arg('r0')
        obj = self.handles.remove(handle)
        if obj is None:
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'CloseHandle(%#x) -> poignée invalide' % handle
        if not self.handles.handles_of(obj):
            obj.on_close()
        self.ret(r0=OK)
        return 'CloseHandle(%#x : %s)' % (handle, obj.label()) if isinstance(obj, ClientSession) else None

    # 0x24, 0x25
    def _wait(self, thread, objects, wait_all, timeout, what):
        ns = timeout - (1 << 64) if timeout >> 63 else timeout
        if not wait_all:
            for index, o in enumerate(objects):
                if o.is_free(thread):
                    o.acquire(thread)
                    self.ret(r0=OK, r1=index)
                    return 'libre'
        elif all(o.is_free(thread) for o in objects):
            for o in objects:
                o.acquire(thread)
            self.ret(r0=OK, r1=0)
            return 'libre'
        if ns == 0:
            self.ret(r0=TIMEOUT)
            return 'délai 0'
        deadline = None if ns < 0 else self.now + ns
        self.ret(r0=TIMEOUT)
        self.block(thread, Wait('sync', objects, wait_all, deadline, what=what))
        return 'attend'

    def svc_wait_synchronization1(self, thread):
        handle = self.arg('r0')
        timeout = self.arg('r2') | self.arg('r3') << 32
        obj = self.lookup(handle, thread)
        if obj is None or not obj.waitable:
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'WaitSynchronization1(%#x) -> poignée invalide' % handle
        what = '%s (%s)' % (obj.label(), self.names.function(self.cpu.get('lr')))
        outcome = self._wait(thread, [obj], False, timeout, what)
        return None if outcome == 'libre' or isinstance(obj, Mutex) else 'WaitSynchronization1(%s) : %s' % (obj.label(), outcome)

    def svc_wait_synchronization_n(self, thread):
        timeout = self.arg('r0') | self.arg('r4') << 32
        pointer, count, wait_all = self.arg('r1'), self.arg('r2'), self.arg('r3') & 0xFF
        if count > 256:
            self.ret(r0=0xD86007F3)
            return 'WaitSynchronizationN(%d) -> trop de poignées' % count
        objects = []
        for handle in self.memory.words(pointer, count) if count else []:
            obj = self.lookup(handle, thread)
            if obj is None or not obj.waitable:
                self.ret(r0=ERR_INVALID_HANDLE)
                return 'WaitSynchronizationN -> poignée invalide %#x' % handle
            objects.append(obj)
        what = ', '.join(o.label() for o in objects) + ' (%s)' % self.names.function(self.cpu.get('lr'))
        outcome = self._wait(thread, objects, bool(wait_all), timeout, what)
        return None if outcome == 'libre' else 'WaitSynchronizationN(%s, tous=%d) : %s' % (
            ', '.join(o.label() for o in objects), wait_all, outcome)

    # 0x27 à 0x2B
    def svc_duplicate_handle(self, thread):
        obj = self.lookup(self.arg('r1'), thread)
        if obj is None:
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'DuplicateHandle -> poignée invalide'
        handle = self.add_handle(obj)
        self.ret(r0=OK, r1=handle)
        return 'DuplicateHandle(%s) -> h=%#x' % (obj.label(), handle)

    def svc_get_system_tick(self, thread):
        ticks = self.ticks()
        self.ret(r0=ticks & 0xFFFFFFFF, r1=ticks >> 32)
        return None

    def svc_get_handle_info(self, thread):
        self.ret(r0=OK, r1=0, r2=0)
        return 'GetHandleInfo(%#x, %d) -> 0' % (self.arg('r1'), self.arg('r2'))

    def committed(self):
        total = 0
        for r in self.memory.regions:
            if r.name in ('tas', 'tas linéaire'):
                total += r.size
        return total

    def svc_get_system_info(self, thread):
        kind, param = self.arg('r1'), self.arg('r2')
        value = 0
        if kind == 0:
            value = self.committed() + self.code_size if param in (0, 1) else 0
        elif kind == 0x1A:
            value = 5
        self.ret(r0=OK, r1=value & 0xFFFFFFFF, r2=value >> 32)
        return 'GetSystemInfo(%#x, %d) -> %#x' % (kind, param, value)

    def svc_get_process_info(self, thread):
        kind = self.arg('r2')
        values = {0: self.committed() + self.code_size, 1: self.committed(), 2: self.committed() + self.code_size,
                  3: self.committed(), 4: len(self.handles.entries), 5: len(self.handles.entries), 8: len(self.threads),
                  0x13: 1, 0x14: 0x20000000 - LINEAR_BASE}
        if kind not in values:
            self.ret(r0=ERR_UNKNOWN_INFO)
            return 'GetProcessInfo(type %#x) -> type inconnu' % kind
        value = values[kind]
        self.ret(r0=OK, r1=value & 0xFFFFFFFF, r2=value >> 32)
        return 'GetProcessInfo(type %#x) -> %#x' % (kind, value)

    # 0x2D, 0x32
    def svc_connect_to_port(self, thread):
        name = self.memory.cstring(self.arg('r1'), 12)
        factory = self.ports.get(name)
        if factory is None:
            self.ret(r0=ERR_PORT_NOT_FOUND)
            return 'ConnectToPort("%s") -> port inconnu' % name
        session = ClientSession(self, factory(), name)
        handle = self.add_handle(session)
        self.ret(r0=OK, r1=handle)
        return 'ConnectToPort("%s") -> h=%#x' % (name, handle)

    def svc_send_sync_request(self, thread):
        handle = self.arg('r0')
        session = self.lookup(handle)
        if not isinstance(session, ClientSession):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'SendSyncRequest(%#x) -> poignée invalide (%s)' % (handle, session.label() if session else 'absente')
        import ipc
        ipc.dispatch(self, thread, session)
        self.ret(r0=OK)
        return False

    # 0x35 à 0x3A
    def svc_get_process_id(self, thread):
        self.ret(r0=OK, r1=self.process.pid)
        return None

    def svc_get_thread_id(self, thread):
        target = self.lookup(self.arg('r1'), thread)
        if not isinstance(target, Thread):
            self.ret(r0=ERR_INVALID_HANDLE)
            return 'GetThreadId -> poignée invalide'
        self.ret(r0=OK, r1=target.thread_id)
        return None

    def svc_get_resource_limit(self, thread):
        handle = self.add_handle(self.resource_limit)
        self.ret(r0=OK, r1=handle)
        return 'GetResourceLimit -> h=%#x' % handle

    def _limit_values(self, current):
        out, handle, names, count = (self.arg(r) for r in ('r0', 'r1', 'r2', 'r3'))
        limits = {0: 0x18, 1: self.app_memory, 2: 32, 3: 32, 4: 32, 5: 8, 6: 8, 7: 16, 8: 2, 9: 0}
        used = {0: 0, 1: self.committed() + self.code_size, 2: len([t for t in self.threads if t.state != DEAD])}
        texts = []
        for i in range(count):
            name = self.memory.u32(names + 4 * i)
            value = used.get(name, 0) if current else limits.get(name, 0)
            self.memory.w64(out + 8 * i, value)
            texts.append('%d=%#x' % (name, value))
        self.ret(r0=OK)
        return ', '.join(texts)

    def svc_get_resource_limit_limit_values(self, thread):
        return 'GetResourceLimitLimitValues(%s)' % self._limit_values(False)

    def svc_get_resource_limit_current_values(self, thread):
        return 'GetResourceLimitCurrentValues(%s)' % self._limit_values(True)

    # 0x3C, 0x3D
    def svc_break(self, thread):
        reason = self.arg('r0')
        self.journal.svc(self, thread, 0x3C, self.cpu.get('pc') - 4, self.cpu.get('lr'), 'Break(%d)' % reason)
        raise Stopped('svcBreak(%d) appelé par %s (lr %#x) : sur une console du commerce le jeu est terminé'
                      % (reason, self.names.function(self.cpu.get('lr')) or '?', self.cpu.get('lr')))

    def svc_output_debug_string(self, thread):
        text = self.memory.read(self.arg('r0'), min(self.arg('r1'), 0x400)).decode('latin-1', 'replace')
        self.ret(r0=OK)
        return 'OutputDebugString("%s")' % text.rstrip('\n')

    # --- état pour le rapport ---

    def describe_threads(self):
        lines = []
        for t in self.threads:
            if t is self.loaded and t.state != DEAD:
                pc, lr = self.cpu.get('pc'), self.cpu.get('lr')
            else:
                pc = lr = None
                if t.context is not None and t.state != DEAD:
                    saved = self.cpu.save()
                    self.cpu.restore(t.context)
                    pc, lr = self.cpu.get('pc'), self.cpu.get('lr')
                    self.cpu.restore(saved)
            where = ''
            if pc is not None:
                where = 'pc %#010x %s, lr %#010x %s' % (pc, self.names.function(pc), lr, self.names.function(lr))
            wait = ''
            if t.state == WAITING and t.wait:
                wait = ' sur %s depuis %.3f ms' % (t.wait.what or t.wait.kind, t.wait.since / 1e6)
            lines.append('fil %#x « %s » priorité %#x, entrée %#x (%s) : %s%s ; %s ; %d appels système'
                         % (t.thread_id, t.name, t.priority, t.entry, self.names.function(t.entry), t.state, wait,
                            where, t.svc_count))
        return lines
