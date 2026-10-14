"""Le processeur du banc : unicorn, un émulateur d'ARM. Un échafaudage, rien de plus.

Il ne sert qu'à faire tourner le code ARM du jeu tant qu'il n'est pas recompilé pour le PC. Tout ce qui fait la
console (noyau, services, fichiers, modules) est écrit en Python à côté et ne connaît que l'interface de `cpu.py`.
Ce fichier est le seul du banc qui importe unicorn.

Ce qu'il fait :
- il projette les plages de `memory.AddressSpace` avec `mem_map_ptr` : unicorn et Python voient les mêmes octets ;
- il arrête l'exécution à chaque `svc` (crochet d'interruption n° 2) et rend son numéro au noyau ;
- il range l'état complet d'un fil (registres, VFP, registre du stockage local) dans un contexte unicorn ;
- il compte les instructions d'une tranche (paramètre `count` d'`emu_start`).
"""
import os
import struct
import sys

from cpu import Cpu, Stop
from memory import PAGE

HERE = os.path.dirname(os.path.abspath(__file__))
PYLIB = os.path.join(os.path.dirname(HERE), 'local', 'pylib')

NEVER = 0xFFFFFFF0          # adresse d'arrêt qu'aucun fil n'atteint : la tranche s'arrête sur le compte


def import_unicorn():
    if PYLIB not in sys.path:
        sys.path.insert(0, PYLIB)
    try:
        import unicorn
        from unicorn import arm_const
    except ImportError:
        sys.exit('unicorn manque dans %s. L\'installer là, et seulement là :\n'
                 '    python -m pip install --target "%s" unicorn' % (PYLIB, PYLIB))
    return unicorn, arm_const


class UnicornCpu(Cpu):
    def __init__(self, memory):
        self.unicorn, self.arm = import_unicorn()
        u, a = self.unicorn, self.arm
        self.uc = u.Uc(u.UC_ARCH_ARM, u.UC_MODE_ARM)
        # L'ARM11 MPCore de la 3DS (ARMv6K) : ldrex/strex sur octet, demi-mot et double mot, VFPv2.
        self.uc.ctl_set_cpu_model(a.UC_CPU_ARM_11MPCORE)
        self.reg_ids = {('r%d' % i): getattr(a, 'UC_ARM_REG_R%d' % i) for i in range(13)}
        self.reg_ids.update(sp=a.UC_ARM_REG_SP, lr=a.UC_ARM_REG_LR, pc=a.UC_ARM_REG_PC, cpsr=a.UC_ARM_REG_CPSR,
                            tls=a.UC_ARM_REG_C13_C0_3, fpexc=a.UC_ARM_REG_FPEXC, fpscr=a.UC_ARM_REG_FPSCR)
        self.memory = memory
        self._stop = None
        self._fault = ''
        self._unwatch = []
        self.timeslice_us = 0          # si non nul : tranches mesurées en temps du PC (plus rapide, pas reproductible)
        self.uc.hook_add(u.UC_HOOK_INTR, self._on_interrupt)
        self.uc.hook_add(u.UC_HOOK_MEM_INVALID, self._on_invalid)
        memory.listeners.append(self)
        for region in memory.regions:
            self.on_map(region)

    # --- mémoire ---

    def on_map(self, region):
        self.uc.mem_map_ptr(region.start, region.size, region.perms, region.host_pointer())

    def _remap_span(self, start, end):
        """Retire d'unicorn tout ce qui touche [start, end), puis reprojette ce que l'espace d'adresses y garde."""
        spans = []
        for begin, last, _ in list(self.uc.mem_regions()):
            if begin < end and start <= last:
                spans.append((begin, last + 1))
        for begin, stop in spans:
            self.uc.mem_unmap(begin, stop - begin)
        for begin, stop in spans:
            for region in self.memory.regions:
                lo, hi = max(region.start, begin), min(region.end, stop)
                if lo < hi:
                    self.uc.mem_map_ptr(lo, hi - lo, region.perms,
                                        region.backing.address + region.offset + lo - region.start)
        self.invalidate(start, end - start)

    def on_unmap(self, start, size):
        self._remap_span(start, start + size)

    def on_protect(self, start, size, perms):
        self._remap_span(start, start + size)

    def invalidate(self, start, size):
        try:
            self.uc.ctl_remove_cache(start, start + size)
        except self.unicorn.UcError:
            self.uc.ctl_flush_tb()

    # --- registres et contextes ---

    def get(self, name):
        return self.uc.reg_read(self.reg_ids[name])

    def set(self, name, value):
        self.uc.reg_write(self.reg_ids[name], value & 0xFFFFFFFF)

    def thumb(self):
        return bool(self.get('cpsr') & 0x20)

    def new_context(self, pc, sp, r0, tls, thumb=False):
        for i in range(13):
            self.set('r%d' % i, 0)
        self.set('r0', r0)
        self.set('sp', sp & ~7)
        self.set('lr', 0)
        cpsr = self.get('cpsr') & ~0x20
        self.set('cpsr', cpsr | (0x20 if thumb else 0))
        self.set('pc', pc & ~1)
        self.set('tls', tls)
        # La VFP est ouverte (FPEXC.EN) et FPSCR vaut ce que pose le noyau de la console (kernel11.md, partie 7).
        self.set('fpexc', 0x40000000)
        self.set('fpscr', 0x03C00000)
        return self.uc.context_save()

    def save(self):
        return self.uc.context_save()

    def restore(self, context):
        self.uc.context_restore(context)

    # --- exécution ---

    def _on_interrupt(self, uc, number, user_data):
        if number == 2:     # EXCP_SWI : l'instruction svc ; pc est déjà sur l'instruction suivante
            pc = self.get('pc')
            if self.thumb():
                word = struct.unpack('<H', bytes(uc.mem_read(pc - 2, 2)))[0]
                svc = word & 0xFF
            else:
                word = struct.unpack('<I', bytes(uc.mem_read(pc - 4, 4)))[0]
                svc = word & 0xFFFFFF
            self._stop = Stop(Stop.SVC, number=svc, address=pc)
        else:
            names = {1: 'instruction indéfinie', 3: 'abandon de lecture d\'instruction', 4: 'abandon de données',
                     7: 'point d\'arrêt (bkpt)'}
            self._stop = Stop(Stop.FAULT, address=self.get('pc'),
                              detail='exception %d (%s)' % (number, names.get(number, '?')))
        uc.emu_stop()

    def _on_invalid(self, uc, access, address, size, value, user_data):
        kinds = {19: 'lecture hors mémoire', 20: 'écriture hors mémoire', 21: 'exécution hors mémoire',
                 22: 'écriture interdite', 23: 'lecture interdite', 24: 'exécution interdite'}
        self._fault = '%s à %#010x (%d octets)' % (kinds.get(access, 'accès %d' % access), address, size)
        return False

    def request_stop(self):
        if self._stop is None:
            self._stop = Stop(Stop.REQUEST, address=self.get('pc'))
        self.uc.emu_stop()

    def run(self, max_instructions):
        self._stop = None
        self._fault = ''
        if self._unwatch:
            self._drop_watches()
        pc = self.get('pc')
        begin = pc | 1 if self.thumb() else pc
        try:
            if self.timeslice_us:
                self.uc.emu_start(begin, NEVER, self.timeslice_us, 0)
            else:
                self.uc.emu_start(begin, NEVER, 0, max_instructions)
        except self.unicorn.UcError as error:
            return Stop(Stop.FAULT, address=self.get('pc'), detail=self._fault or str(error))
        if self._stop is not None:
            return self._stop
        return Stop(Stop.LIMIT, address=self.get('pc'))

    def watch(self, address, callback, once=False):
        def hook(uc, at, size, user_data):
            callback(at)
            if once:
                self._unwatch.append(handle)
        handle = self.uc.hook_add(self.unicorn.UC_HOOK_CODE, hook, begin=address, end=address)
        return handle

    def _drop_watches(self):
        # Un crochet ne se retire pas depuis son propre rappel : on le fait avant la tranche suivante.
        while self._unwatch:
            self.uc.hook_del(self._unwatch.pop())
