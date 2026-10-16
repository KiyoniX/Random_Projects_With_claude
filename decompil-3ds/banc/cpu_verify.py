"""Le mode vérification du banc : le natif tourne, unicorn le rejoue, on s'arrête à la première divergence.

    python banc/run.py --cpu verifier --secondes 3

Pour chaque tranche du fil courant (de la reprise au prochain appel système), `VerifyCpu` :
1. note les registres de départ, et commence le journal des écritures (`recomp/runtime/logw.c`, DLL `jeu-journal.dll`) ;
2. laisse le processeur natif (hybride) faire la tranche, qui reste la référence du banc : c'est lui que le noyau voit ;
3. garde l'état final des pages touchées, remet la mémoire dans son état d'origine (le journal garde l'état d'avant de
   chaque page), et fait rejouer la même tranche à un unicorn complet, depuis les mêmes registres, jusqu'au même appel
   système ;
4. compare les registres (r0-r12, sp, lr, drapeaux N Z C V Q, GE, d0-d15, FPSCR), le numéro et l'adresse de l'appel
   système, et le contenu final de chaque page touchée par l'un ou l'autre ;
5. remet la mémoire dans l'état final du natif et rend son arrêt au noyau.

Une divergence rend `Stop.FAULT` (le banc s'arrête) avec un rapport : ce qui diffère, la première écriture qui diffère
(avec l'instruction d'unicorn qui l'a faite, désassemblée), et la première entrée de fonction recompilée dont les
arguments diffèrent. Les tranches qui finissent autrement que par un appel système (fin de tranche par compteur, repère,
faute) ne sont pas comparées : elles sont comptées dans `stats`.

C'est lent (le journal et le rejeu), à réserver au diagnostic : quelques secondes de banc.
"""
import ctypes
import os

from cpu import Cpu, Stop
from cpu_native import NATIVE, UNICORN, NativeCpu
from cpu_unicorn import UnicornCpu
from memory import PAGE

HERE = os.path.dirname(os.path.abspath(__file__))
JOURNAL_DLL = os.path.join(os.path.dirname(HERE), 'local', 'recomp', 'jeu', 'build', 'jeu-journal.dll')
REPLAY_LIMIT = 30_000_000       # instructions permises au rejeu avant de le déclarer perdu


class WriteRec(ctypes.Structure):
    _fields_ = [('addr', ctypes.c_uint32), ('value', ctypes.c_uint32), ('size', ctypes.c_uint32)]


class EntryRec(ctypes.Structure):
    _fields_ = [('pc', ctypes.c_uint32), ('r0', ctypes.c_uint32), ('r1', ctypes.c_uint32), ('r2', ctypes.c_uint32),
                ('r3', ctypes.c_uint32), ('sp', ctypes.c_uint32), ('lr', ctypes.c_uint32), ('writes', ctypes.c_uint32),
                ('r4', ctypes.c_uint32), ('r5', ctypes.c_uint32), ('r6', ctypes.c_uint32), ('r7', ctypes.c_uint32),
                ('r8', ctypes.c_uint32), ('r9', ctypes.c_uint32), ('r10', ctypes.c_uint32), ('r11', ctypes.c_uint32),
                ('r12', ctypes.c_uint32), ('pad', ctypes.c_uint32)]


class State:
    """Tout ce qu'un fil porte : de quoi repartir (unicorn) et de quoi comparer."""
    NAMES = ['cpsr'] + ['r%d' % i for i in range(13)] + ['sp', 'lr', 'pc', 'tls', 'fpexc', 'fpscr'] + \
            ['d%d' % i for i in range(16)]

    def __init__(self, values, thumb):
        self.values = list(values)
        self.thumb = thumb
        self.named = dict(zip(self.NAMES, self.values))

    def diffs(self, other):
        out = []
        for name in self.NAMES:
            if name in ('pc', 'fpexc'):
                continue
            a, b = self.named[name], other.named[name]
            if name == 'cpsr':
                a, b = a & 0xF8FF0000, b & 0xF8FF0000        # N Z C V Q et GE ; pas le mode
            elif name == 'fpscr':
                a, b = a & 0xFFC00000, b & 0xFFC00000        # drapeaux de la VFP et arrondi
            if a != b:
                out.append((name, a, b))
        return out


class VerifyCpu(Cpu):
    def __init__(self, memory):
        self.native = NativeCpu(memory, dll=JOURNAL_DLL, hybrid=True)
        self.ref = UnicornCpu(memory)
        self.memory = memory
        self.lib = self.native.lib
        lib, u32, i32, ptr = self.lib, ctypes.c_uint32, ctypes.c_int, ctypes.c_void_p
        lib.logw_write.argtypes = [u32, u32, i32]
        lib.logw_writes.restype = ptr
        lib.logw_entries.restype = ptr
        lib.logw_write_count.restype = u32
        lib.logw_entry_count.restype = u32
        lib.logw_page_count.restype = u32
        lib.logw_page.argtypes = [u32]
        lib.logw_page.restype = u32
        lib.logw_page_saved.argtypes = [u32]
        lib.logw_page_saved.restype = ptr
        entries = (ctypes.c_uint32 * 40000)()
        count = lib.rt_list_entries(ctypes.addressof(entries), 40000)
        self.entry_set = set(entries[i] & ~1 for i in range(count))
        self.main_entries = set(self.entry_set)
        self.stats = {'comparées': 0, 'non comparées (fin par compteur ou faute)': 0, 'divergences': 0}
        self.native_stats = self.native.stats
        self.report = ''
        # VERIFIER_DEPUIS=N : les N premières tranches (tous fils confondus) tournent sans vérification, pour atteindre vite
        # une tranche suspecte (le numéro de la tranche fautive s'obtient en comptant les appels de run() d'un banc natif).
        self.skip_slices = int(os.environ.get('VERIFIER_DEPUIS', '0'))
        self.slice_count = 0
        self.history = []                   # les dernières entrées de fonction du natif, toutes tranches confondues (diagnostic)
        self._uc_hook = None
        self.t_ref = 0.0
        try:
            import capstone
            self.cs = {False: capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM),
                       True: capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)}
        except ImportError:
            self.cs = None

    # --- l'interface : tout passe au natif, qui reste la référence du banc ---

    def get(self, name):
        return self.native.get(name)

    def set(self, name, value):
        self.native.set(name, value)

    def new_context(self, *args, **kwargs):
        return self.native.new_context(*args, **kwargs)

    def save(self):
        return self.native.save()

    def restore(self, context):
        self.native.restore(context)

    def invalidate(self, start, size):
        self.native.invalidate(start, size)
        self.ref.invalidate(start, size)

    def watch(self, address, callback, once=False):
        return self.native.watch(address, callback, once)

    def module_loaded(self, name, base):
        return self.native.module_loaded(name, base)

    def request_stop(self):
        self.native.request_stop()

    def timing(self):
        native, uni = self.native.timing()
        return native, uni + self.t_ref

    # --- l'état d'un fil ---

    def _state(self):
        """L'état du fil courant, quel que soit celui qui tient les registres."""
        n = self.native
        ctx = n.cur
        if ctx.mode == UNICORN:
            values = n.uc.uc.reg_read_batch(n._uc_ids())
            thumb = bool(values[0] & 0x20)
            values = list(values)
            values[16] &= ~1
            return State(values, thumb)
        st = ctx.st
        thumb = bool(ctx.thumb) if ctx.started else bool(ctx.entry & 1)
        cpsr = st.nf << 31 | st.zf << 30 | st.cf << 29 | st.vf << 28 | st.qf << 27 | st.ge << 16 | (0x20 if thumb else 0)
        values = [cpsr] + [st.r[i] for i in range(15)] + [ctx.pc & ~1, st.tls, st.fpexc, st.fpscr] + list(st.d)
        return State(values, thumb)

    def _load_ref(self, state):
        ref = self.ref
        values = list(state.values)
        values[0] = (values[0] & ~0x1F) | (ref.get('cpsr') & 0x1F)           # le mode d'unicorn ne change pas
        values[16] = values[16] | (1 if state.thumb else 0)                  # le bit 0 du pc : Thumb
        ids = self.native._uc_ids()
        ref.uc.reg_write_batch(list(zip(ids, values)))

    def _ref_state(self):
        values = list(self.ref.uc.reg_read_batch(self.native._uc_ids()))
        thumb = bool(values[0] & 0x20)
        values[16] &= ~1
        return State(values, thumb)

    # --- la tranche ---

    def run(self, max_instructions):
        n = self.native
        lib = self.lib
        self.slice_count += 1
        if self.slice_count <= self.skip_slices:
            return n.run(max_instructions)        # avant la tranche suspecte : le natif seul, sans journal ni rejeu
        start = self._state()
        self._last_start = start
        lib.logw_begin()
        self._uc_hook = n.uc.uc.hook_add(n.uc.unicorn.UC_HOOK_MEM_WRITE, self._on_native_uc_write)
        try:
            stop = n.run(max_instructions)
        finally:
            lib.logw_end()
            n.uc.uc.hook_del(self._uc_hook)
        if stop.kind == Stop.FAULT:
            # Le natif est tombé sur une faute : unicorn rejoue la tranche pour dire où les deux chemins se séparent.
            problem = self._compare(start, stop, faulted=True)
            self.stats['divergences'] += 1
            self.report = problem
            return Stop(Stop.FAULT, address=stop.address, detail="%s\nDIVERGENCE : le natif a fait une faute, voici ce "
                        "qu'unicorn fait de la même tranche :\n%s" % (stop.detail, problem))
        if stop.kind != Stop.SVC:
            self.stats['non comparées (fin par compteur ou faute)'] += 1
            return stop
        problem = self._compare(start, stop)
        if problem:
            self.stats['divergences'] += 1
            self.report = problem
            return Stop(Stop.FAULT, address=stop.address, detail='DIVERGENCE natif / unicorn avant l\'appel système %#x :\n%s'
                        % (stop.number, problem))
        self.stats['comparées'] += 1
        return stop

    def _on_native_uc_write(self, uc, access, address, size, value, user_data):
        self.lib.logw_write(address, value & 0xFFFFFFFF, size)

    # --- le rejeu et la comparaison ---

    def _native_journal(self):
        lib = self.lib
        count = lib.logw_page_count()
        final = {}
        for i in range(count):
            page = lib.logw_page(i)
            final[page] = self.memory.read(page << 12, PAGE)
        wcount = lib.logw_write_count()
        writes = [(w.addr, w.size, w.value & ((1 << 8 * w.size) - 1)) for w in (WriteRec * wcount).from_address(lib.logw_writes())] if wcount else []
        ecount = lib.logw_entry_count()
        entries = list((EntryRec * ecount).from_address(lib.logw_entries())) if ecount else []
        entries = [(e.pc, e.r0, e.r1, e.r2, e.r3, e.sp, e.lr, e.writes, e.r4, e.r5, e.r6, e.r7, e.r8, e.r9, e.r10, e.r11, e.r12)
                   for e in entries]
        return final, writes, entries

    def _replay(self, start, native_pages, trace):
        """Rejoue sous unicorn complet. La mémoire est dans l'état d'origine pour les pages du natif. Rend (arrêt, état
        final, écritures [(adresse, taille, valeur, pc)], états d'origine des pages que seul unicorn a écrites, entrées)."""
        ref = self.ref
        u = ref.unicorn
        self._load_ref(start)
        writes = []
        extra = {}
        entries = []

        def on_write(uc, access, address, size, value, user):
            writes.append((address, size, value & ((1 << 8 * size) - 1), ref.get('pc') | (1 if ref.thumb() else 0)))
            page = address >> 12
            for p in {page, (address + size - 1) >> 12}:
                if p not in native_pages and p not in extra and self.memory.is_mapped(p << 12):
                    extra[p] = self.memory.read(p << 12, PAGE)

        def on_code(uc, address, size, user):
            if address in self.entry_set or (address & ~1) in self.entry_set:
                entries.append((address, ref.get('r0'), ref.get('r1'), ref.get('r2'), ref.get('r3'), ref.get('sp'),
                                ref.get('lr'), len(writes)) + tuple(ref.get('r%d' % i) for i in range(4, 13)))
        hooks = [ref.uc.hook_add(u.UC_HOOK_MEM_WRITE, on_write)]
        if trace:
            self.entry_set = self.main_entries | set(self.native.module_entries())     # les modules branchés à cet instant
            for lo, hi in [self.native.native_range] + [(lo, hi) for _, lo, hi, _ in self.native.loaded.values()]:
                hooks.append(ref.uc.hook_add(u.UC_HOOK_CODE, on_code, begin=lo, end=hi))
            ref.uc.ctl_flush_tb()           # les blocs déjà traduits n'ont pas le crochet
        try:
            stop = ref.run(REPLAY_LIMIT)
        finally:
            for h in hooks:
                ref.uc.hook_del(h)
            if trace:
                ref.uc.ctl_flush_tb()
        return stop, self._ref_state(), writes, extra, entries

    def _compare(self, start, stop, faulted=False):
        import time
        lib = self.lib
        final, nwrites, nentries = self._native_journal()
        self.history.extend(nentries)
        del self.history[:-300000]
        end = self._state()
        lib.logw_rewind()                                  # la mémoire retrouve son état d'avant la tranche
        t0 = time.perf_counter()
        try:
            rstop, rend, rwrites, extra, _ = self._replay(start, set(final), False)
            problems = []
            if faulted:
                problems.append('unicorn termine la tranche par : %r' % (rstop,))
            elif rstop.kind != Stop.SVC or rstop.number != stop.number or rstop.address != stop.address:
                problems.append('unicorn s\'arrête autrement : %r (le natif : appel système %#x à %#x)'
                                % (rstop, stop.number, stop.address))
            for name, a, b in ([] if faulted else end.diffs(rend)):
                problems.append('registre %s : natif %#010x, unicorn %#010x' % (name, a, b))
            for page in ([] if faulted else sorted(set(final) | set(extra))):
                after_ref = self.memory.read(page << 12, PAGE)
                after_native = final.get(page)
                if after_native is None:
                    after_native = extra[page]
                if after_ref != after_native:
                    k = next(i for i in range(PAGE) if after_ref[i] != after_native[i])
                    problems.append('mémoire à %#010x : natif %02x, unicorn %02x'
                                    % ((page << 12) + k, after_native[k], after_ref[k]))
                    if sum(1 for p in problems if p.startswith('mémoire')) >= 6:
                        break
            if problems:
                # Deuxième rejeu, avec la trace des entrées de fonction, pour situer la divergence.
                for page, data in final.items():
                    self.memory.write(page << 12, data)
                for page, data in extra.items():
                    self.memory.write(page << 12, data)
                lib.logw_rewind()
                rstop, rend, rwrites, extra2, rentries = self._replay(start, set(final), True)
                extra.update(extra2)
                problems.append(self._locate(nwrites, nentries, rwrites, rentries))
        finally:
            # la mémoire revient à l'état final du natif, qui reste la référence du banc
            for page, data in extra.items():
                self.memory.write(page << 12, data)
            for page, data in final.items():
                self.memory.write(page << 12, data)
            self.t_ref += time.perf_counter() - t0
        return '\n'.join(problems)

    def _disasm(self, address, thumb):
        if self.cs is None:
            return '(capstone absent)'
        try:
            code = self.memory.read(address, 4)
            for i in self.cs[thumb].disasm(code, address):
                return '%s %s' % (i.mnemonic, i.op_str)
        except Exception:
            pass
        return '?'

    def _locate(self, nwrites, nentries, rwrites, rentries):
        lines = ['--- où ça diverge ---']
        if os.environ.get('VERIFY_DUMP'):
            with open(os.environ['VERIFY_DUMP'], 'w') as f:
                for tag, es in (('N', nentries), ('U', rentries)):
                    for k, e in enumerate(es):
                        f.write('%s %d %s' % (tag, k, ' '.join('%x' % v for v in e)) + chr(10))
        first = None
        for i in range(min(len(nwrites), len(rwrites))):
            a, b = nwrites[i], rwrites[i][:3]
            if a != b:
                first = i
                break
        if first is None and len(nwrites) != len(rwrites):
            first = min(len(nwrites), len(rwrites))
        if first is None:
            lines.append('les %d écritures sont les mêmes dans le même ordre : la divergence est dans des registres '
                         'ou des pages écrasées après coup' % len(nwrites))
        else:
            na = nwrites[first] if first < len(nwrites) else None
            ra = rwrites[first] if first < len(rwrites) else None
            lines.append('première écriture qui diffère : la n° %d sur %d (natif) / %d (unicorn)'
                         % (first, len(nwrites), len(rwrites)))
            if na:
                lines.append('  natif   : %d octets à %#010x = %#x' % (na[1], na[0], na[2]))
            if ra:
                pc = ra[3]
                lines.append('  unicorn : %d octets à %#010x = %#x, par l\'instruction à %#x : %s'
                             % (ra[1], ra[0], ra[2], pc, self._disasm(pc & ~1, bool(pc & 1))))
            before = [e for e in nentries if e[7] <= first]
            if before:
                e = before[-1]
                lines.append('  dernière fonction recompilée entrée avant : %#x (r0=%#x r1=%#x r2=%#x r3=%#x sp=%#x lr=%#x)'
                             % e[:7])
        # première entrée de fonction dont les arguments diffèrent
        j = 0
        for k, e in enumerate(nentries):
            found = None
            for m in range(j, min(len(rentries), j + 64)):
                if (rentries[m][0] & ~1) == (e[0] & ~1):
                    found = m
                    break
            if found is None:
                lines.append('entrée native n° %d à %#x sans équivalent chez unicorn (elle est exécutée par unicorn, ou '
                             'le flot diverge avant)' % (k, e[0]))
                break
            r = rentries[found]
            j = found + 1
            if e[1:7] != r[1:7] or e[8:17] != r[8:17]:
                lines.append('première entrée de fonction aux arguments différents : n° %d, %#x' % (k, e[0]))
                for who, x in (('natif  ', e), ('unicorn', r)):
                    lines.append('  %s : r0=%#x r1=%#x r2=%#x r3=%#x sp=%#x lr=%#x ; r4..r12 = %s'
                                 % ((who,) + tuple(x[1:7]) + (' '.join('%x' % v for v in x[8:17]),)))
                if k:
                    p = nentries[k - 1]
                    lines.append('  l\'entrée précédente du natif : %#x (lr=%#x) : la divergence est entre elle et celle-ci'
                                 % (p[0], p[6]))
                break
        else:
            lines.append('toutes les entrées de fonction ont les mêmes arguments (%d)' % len(nentries))
        return '\n'.join(lines)
