"""Le processeur du banc, version native : le code ARM du jeu recompilé en C (recomp/), compilé en une DLL.

Même interface que `cpu_unicorn.py` (voir `cpu.py`) : le noyau, les services et le chargeur de modules ne voient pas
la différence. Ce fichier est avec `cpu_unicorn.py` le seul qui touche à un processeur.

Comment un fil de la console devient du code natif
--------------------------------------------------
Le C généré garde l'état d'un fil dans la pile C du PC (une fonction en appelle une autre, les registres sont des
variables locales). On ne peut donc pas ranger un fil comme le fait unicorn, par un contexte de registres. Choix fait :
**une fibre Windows par fil de la console** (`recomp/runtime/host.c`). Une fibre est une pile C et un point de reprise
que l'on quitte et reprend à la main, sans ordonnanceur du système, sans verrou, sans attente. Un seul fil de la
console tourne à la fois, ce que fait déjà le noyau du banc. Un fil hôte par fil de console aurait demandé deux
changements de contexte du système (réveil, attente) à chaque appel système ; la fibre en demande un, qui est un simple
échange de pile. Un rappel synchrone du C vers le noyau Python qui ferait lui-même l'ordonnancement aurait mis tout le
noyau (qui se croit appelé « entre deux tranches ») sur la pile d'un fil de la console.

- `run(max)` reprend la fibre du fil courant ; elle rend la main quand le fil fait un appel système (`Stop.SVC`, pc
  juste après l'instruction), quand son compteur est épuisé (`Stop.LIMIT`), quand un repère est atteint, quand il saute
  vers du code non recompilé, ou sur une faute (`Stop.FAULT`). Le noyau traite l'appel système, change éventuellement
  de fil, puis `run` reprend la fibre exactement là où elle s'était arrêtée.
- Préemption coopérative : le C décompte un « budget » à chaque entrée de fonction et à chaque branchement en arrière
  (RT_ENTER, RT_BACKEDGE). Une tranche de `max` instructions devient `max // BACKEDGE_WEIGHT` unités ; épuisées, la
  fibre cède la main et une boucle d'attente active ne bloque donc pas le banc. Ce n'est qu'une estimation : le compte
  d'instructions du natif diffère de celui d'unicorn (la tranche vaut le même temps de banc dans les deux cas).

Le mode hybride
---------------
L'essentiel du jeu vit dans les modules .cro, chargés et relogés à l'exécution : ils ne sont pas recompilés. Quand le
natif saute vers une adresse qui n'est pas une fonction recompilée, la fibre rend la main (`HS_MISS`) et le même fil
continue **sous unicorn, avec les mêmes registres et la même mémoire**. L'inverse : les pages du code recompilé sont
projetées sans droit d'exécution dans unicorn ; quand le code d'un module saute dans le jeu, unicorn lève une faute de
lecture d'instruction à l'adresse visée. Deux cas :
- l'adresse est le point de retour attendu du saut précédent (le dernier appel du natif vers unicorn) : le code
  « revient », on rend les registres à la fibre, qui reprend dans son appelant ;
- l'adresse est l'entrée d'une fonction recompilée : on la fait exécuter par la fibre (CMD_CALL), puis unicorn reprend à
  `lr`.
Toute autre adresse est une faute franche : jamais de silence.

Limite connue : un retour par `pop {pc}` ou `ldr pc` est un simple retour C ; il suppose que la valeur dépilée est
égale à `lr` à l'appel. C'est vrai du code compilé normalement.
"""
import ctypes
import hashlib
import json
import os
import sys
import time
import weakref

from cpu import REGISTERS, Cpu, Stop
from cpu_unicorn import UnicornCpu
from memory import PAGE, PERM_X

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_DLL = os.path.join(ROOT, 'local', 'recomp', 'jeu', 'build', 'jeu-hote.dll')
HOLES_FILE = os.path.join(ROOT, 'local', 'recomp', 'trous.txt')      # code du jeu rencontré sans être recompilé
CRO_HOLES_FILE = os.path.join(ROOT, 'local', 'recomp', 'trous-cro.txt')   # idem dans un module .cro : « nom décalage »
CRO_META = 'cro_meta.json'      # écrit par recomp/cro_recomp.py à côté du C : indices, empreintes et masques des modules

BACKEDGE_WEIGHT = 8             # instructions ARM comptées pour un décompte du C (un branchement en arrière, un appel)
HOT_PAGE_CALLS = 200            # appels depuis unicorn vers une même page du jeu avant de la laisser à unicorn
UNICORN_BURST_COST = 40         # instructions comptées pour une traversée natif <-> unicorn (le compte réel n'est pas connu)

# statuts rendus par host_resume (runtime/host.c)
HS_DONE, HS_SVC, HS_LIMIT, HS_HOOK, HS_MISS, HS_FAULT, HS_UNIMPL, HS_NOTARGET, HS_OVERRUN, HS_BADCMD = range(10)
CMD_CALL, CMD_CONTINUE, CMD_RETURN = 1, 2, 3
NATIVE, UNICORN = 'natif', 'unicorn'

FETCH_FAULTS = (21, 24)         # lecture d'instruction hors mémoire / sans droit d'exécution (cpu_unicorn._on_invalid)


class CtxStruct(ctypes.Structure):
    """`Ctx` de host.c : la structure `Cpu` de rt.h, suivie de ce que l'hôte y ajoute."""
    _fields_ = [('r', ctypes.c_uint32 * 16), ('nf', ctypes.c_uint32), ('zf', ctypes.c_uint32),
                ('cf', ctypes.c_uint32), ('vf', ctypes.c_uint32), ('qf', ctypes.c_uint32), ('ge', ctypes.c_uint32),
                ('fpscr', ctypes.c_uint32), ('fpexc', ctypes.c_uint32), ('tls', ctypes.c_uint32),
                ('excl_addr', ctypes.c_uint32), ('budget', ctypes.c_int32), ('d', ctypes.c_uint64 * 16),
                ('user', ctypes.c_void_p), ('ras', ctypes.c_void_p), ('rsp', ctypes.c_uint32), ('hint', ctypes.c_uint32),
                ('fiber', ctypes.c_void_p), ('status', ctypes.c_int), ('cmd', ctypes.c_int), ('arg', ctypes.c_uint32),
                ('info0', ctypes.c_uint32), ('info1', ctypes.c_uint32), ('jmp', ctypes.c_void_p)]


REG_INDEX = {('r%d' % i): i for i in range(13)}
REG_INDEX.update(sp=13, lr=14)

_loaded = {}


def load_library(path):
    """Charge la DLL du jeu (une seule fois par chemin : ses tables de pages sont globales)."""
    path = os.path.abspath(path)
    lib = _loaded.get(path)
    if lib is not None:
        return lib
    if not os.path.isfile(path):
        sys.exit('la DLL du jeu recompilé manque : %s\nLa fabriquer :\n'
                 '    python recomp/recomp.py gen --out local/recomp/jeu\n'
                 '    python recomp/validate.py build --host' % path)
    lib = ctypes.CDLL(path)
    u32, ptr, i32 = ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int
    lib.rt_map.argtypes = [u32, u32, ptr, i32]
    lib.rt_has_entry.argtypes = [u32]
    lib.rt_has_entry.restype = i32
    lib.rt_can_hook.argtypes = [u32]
    lib.rt_can_hook.restype = i32
    lib.rt_watch_set.argtypes = [u32, i32]
    lib.rt_list_entries.argtypes = [ptr, u32]
    lib.rt_list_entries.restype = u32
    lib.rt_get_info.argtypes = [i32]
    lib.rt_get_info.restype = u32
    lib.rt_get_unwinds.restype = u32
    if hasattr(lib, 'rt_cro_init'):                 # le C des modules .cro est dans la DLL
        lib.rt_cro_init()
        lib.rt_mod_name.restype = ctypes.c_char_p
        lib.rt_mod_info.argtypes = [u32, ptr]
        lib.rt_mod_set_base.argtypes = [u32, u32]
        lib.rt_mod_list_entries.argtypes = [u32, ptr, u32]
        lib.rt_mod_list_entries.restype = u32
    lib.host_init.restype = i32
    lib.host_ctx_size.restype = u32
    lib.host_new.restype = ptr
    lib.host_free.argtypes = [ptr]
    lib.host_reset.argtypes = [ptr]
    lib.host_ras_push.argtypes = [ptr, u32]
    lib.host_ras_pop.argtypes = [ptr]
    lib.host_resume.argtypes = [ptr, i32, u32, i32]
    lib.host_resume.restype = i32
    if lib.host_ctx_size() != ctypes.sizeof(CtxStruct):
        sys.exit('la structure Ctx de host.c et celle de cpu_native.py divergent (%d / %d)'
                 % (lib.host_ctx_size(), ctypes.sizeof(CtxStruct)))
    if lib.host_init() != 0:
        sys.exit('host_init a échoué : le fil de Python ne peut pas devenir une fibre')
    _loaded[path] = lib
    return lib


class NativeContext:
    """L'état d'un fil de la console : une structure `Cpu` du C et sa fibre, plus ce que Python en sait."""

    def __init__(self, lib, entry):
        self.lib = lib
        self.ptr = lib.host_new()
        self.st = CtxStruct.from_address(self.ptr)
        self.entry = entry              # adresse d'entrée, bit 0 à 1 pour Thumb
        self.mode = NATIVE              # qui détient les registres : la structure C, ou unicorn
        self.started = False
        self.next_cmd = (CMD_CALL, entry)
        self.thumb = entry & 1          # le code qui a rendu la main est en Thumb
        self.pc = entry & ~1            # dernier pc connu (après le dernier appel système, ou à la dernière cession)
        self.segments = []              # adresses de retour attendues des passages en cours sous unicorn
        self.calls = []                 # retours attendus des fonctions recompilées appelées depuis unicorn (lr à l'appel :
                                        # au retour, lr n'est plus fiable, un `pop {pc}` ne le rétablit pas)
        self.uc_ctx = None              # contexte unicorn rangé quand le fil est en mode unicorn

    def __del__(self):
        try:
            self.lib.host_free(self.ptr)
        except Exception:
            pass


class HybridUnicorn(UnicornCpu):
    """Un UnicornCpu dont les pages du code recompilé ne sont pas exécutables : y sauter est une faute que `NativeCpu`
    transforme en appel natif (ou en retour). Le code recompilé, ce sont les pages du programme principal et, tant qu'un
    module .cro recompilé est chargé, celles de son code."""

    def __init__(self, memory, native_range):
        self.native_range = native_range            # [début, fin) des adresses recompilées du programme principal
        self.module_ranges = []                     # [début, fin) du code des modules .cro recompilés et chargés
        self.last_invalid = None
        self.granted = set()                        # pages du code recompilé rendues exécutables (trous)
        self.stop_hooks = {}                        # adresse -> crochet : retours attendus sur une page rendue exécutable
        self.hit_stop = None
        self.skip_at = None
        super().__init__(memory)

    def _native_ranges(self):
        return [self.native_range] + self.module_ranges

    def _pieces(self, lo, hi, perms):
        if not perms & PERM_X:
            return [(lo, hi, perms)]
        cuts = {lo, hi}
        for a, b in self._native_ranges():
            if lo < b and a < hi:
                cuts.update((max(lo, a), min(hi, b)))
        cuts = sorted(cuts)
        out = []
        for p_lo, p_hi in zip(cuts, cuts[1:]):
            native = any(a <= p_lo and p_hi <= b for a, b in self._native_ranges())
            out.append((p_lo, p_hi, perms & ~PERM_X if native else perms))
        return out

    def _map_piece(self, region, lo, hi):
        for p_lo, p_hi, perms in self._pieces(lo, hi, region.perms):
            if p_lo < p_hi:
                self.uc.mem_map_ptr(p_lo, p_hi - p_lo, perms, region.backing.address + region.offset + p_lo - region.start)

    def set_module_ranges(self, ranges):
        """Un module recompilé arrive ou part : ses pages de code changent de droits, la mémoire est reprojetée."""
        old = self.module_ranges
        self.module_ranges = list(ranges)
        for a, b in set(old) ^ set(self.module_ranges):
            self._remap_span(a, b)
            for page in range(a >> 12, b >> 12):
                self.granted.discard(page)

    def on_map(self, region):
        self._map_piece(region, region.start, region.end)

    def _remap_span(self, start, end):
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
                    self._map_piece(region, lo, hi)
        for page in self.granted:
            region = self.memory.find(page << 12)
            if region is not None and start <= page << 12 < end:
                self.uc.mem_protect(page << 12, PAGE, region.perms)
        self.invalidate(start, end - start)

    def grant(self, address):
        """Rend exécutable la page de ce code du jeu que le recompilateur n'a pas traduit (un trou) : unicorn l'exécute.
        Le code recompilé de la même page s'exécute alors aussi sous unicorn, correctement mais sans passer par le natif."""
        page = address >> 12
        if page in self.granted:
            return False
        region = self.memory.find(address)
        self.uc.mem_protect(page << 12, PAGE, region.perms)
        self.granted.add(page)
        return True

    def ensure_stop_hook(self, address):
        """Un retour attendu sur une page exécutable ne lève plus de faute : on l'attrape par un crochet sur l'adresse."""
        address &= ~1
        if address >> 12 in self.granted and address not in self.stop_hooks:
            self.stop_hooks[address] = self.uc.hook_add(self.unicorn.UC_HOOK_CODE, self._on_stop_hook, begin=address,
                                                        end=address)

    def _on_stop_hook(self, uc, address, size, user_data):
        if self.skip_at == address:
            self.skip_at = None
            return
        self.hit_stop = address
        uc.emu_stop()

    def _on_invalid(self, uc, access, address, size, value, user_data):
        self.last_invalid = (access, address)
        return super()._on_invalid(uc, access, address, size, value, user_data)


class NativeCpu(Cpu):
    """`hybrid` : les adresses non recompilées passent à unicorn (sinon, c'est une faute)."""

    def __init__(self, memory, dll=None, hybrid=True):
        self.lib = load_library(dll or DEFAULT_DLL)
        self.memory = memory
        self.hybrid = hybrid
        entries = (ctypes.c_uint32 * 40000)()
        count = self.lib.rt_list_entries(ctypes.addressof(entries), 40000)
        addresses = [entries[i] & ~1 for i in range(min(count, 40000))]
        self.entry_count = count
        self.native_range = (min(addresses) & ~(PAGE - 1), (max(addresses) + 0x1000 + PAGE - 1) & ~(PAGE - 1))
        self.uc = HybridUnicorn(memory, self.native_range) if hybrid else None
        self.cur = None
        self.contexts = weakref.WeakSet()
        self.holes_seen = set()
        self.entry_calls = {}           # page du jeu -> appels reçus depuis unicorn (voir HOT_PAGE_CALLS)
        self.watchers = {}
        self.request = False
        self.t_native = self.t_unicorn = 0.0
        self.modules = {}               # nom -> métadonnées d'un module .cro recompilé (cro_meta.json), voir module_loaded
        self.loaded = {}                # nom -> (base, début du code, fin du code, fin de l'image) des modules branchés
        self._load_module_meta(dll)
        self.stats = {'reprises': 0, 'natif_vers_unicorn': 0, 'unicorn_vers_natif': 0, 'retours': 0, 'repères': 0}
        memory.listeners.append(self)
        for region in memory.regions:
            self.on_map(region)

    # --- les modules .cro recompilés ---

    def _load_module_meta(self, dll):
        """Les modules que la DLL sait exécuter, d'après `cro_meta.json` (à côté du C généré, `recomp/cro_recomp.py`)."""
        if not hasattr(self.lib, 'rt_mod_set_base'):
            return
        folder = os.path.dirname(os.path.dirname(os.path.abspath(dll or DEFAULT_DLL)))
        try:
            with open(os.path.join(folder, CRO_META)) as f:
                meta = json.load(f)
        except (OSError, ValueError):
            return
        info = (ctypes.c_uint32 * 4)()
        for name, entry in meta.items():
            if self.lib.rt_mod_info(entry['index'], ctypes.addressof(info)) and \
                    self.lib.rt_mod_name(entry['index']).decode() == name and info[2] == entry['code_size']:
                self.modules[name] = entry

    def _in_native(self, address):
        """Cette adresse est-elle du code que le C recompilé sait exécuter ? (le programme principal, ou le code d'un
        module .cro recompilé et chargé)"""
        if self.native_range[0] <= address < self.native_range[1]:
            return True
        for _, lo, hi, _ in self.loaded.values():
            if lo <= address < hi:
                return True
        return False

    def _module_at(self, address):
        for name, (base, lo, hi, end) in self.loaded.items():
            if lo <= address < hi:
                return name, address - base
        return None, None

    def _code_matches(self, entry, base):
        """Le code en mémoire est-il celui que le C a été généré pour ? Empreinte du segment de code, mots écrits par ro
        (corrections internes et imports) mis à zéro."""
        try:
            data = bytearray(self.memory.read(base + entry['code_off'], entry['code_size']))
        except Exception:
            return False
        for off in entry['mask']:
            data[off:off + 4] = bytes(len(data[off:off + 4]))
        return hashlib.sha1(bytes(data)).hexdigest() == entry['sha1']

    def _count(self, key):
        self.stats[key] = self.stats.get(key, 0) + 1

    def module_loaded(self, name, base):
        """Le chargeur de modules (ro) vient de finir de charger `name` à `base` : si le C recompilé de ce module est dans
        la DLL et que le code en mémoire est exactement celui-là, les sauts vers ce code vont au natif. Sinon le module
        reste à unicorn. Rend vrai si le module est branché."""
        entry = self.modules.get(name)
        if entry is None:
            self._count('modules non recompilés')
            return False
        if name in self.loaded:
            self._count('modules chargés deux fois (le second reste à unicorn)')
            return False
        if base & (PAGE - 1) or not self._code_matches(entry, base):
            self._count('modules refusés (code différent)')
            return False
        lo = base + entry['code_off']
        hi = lo + entry['code_size']
        self.loaded[name] = (base, lo, hi, base + ((entry['file_size'] + PAGE - 1) & ~(PAGE - 1)))
        self.lib.rt_mod_set_base(entry['index'], base)
        self._sync_module_ranges()
        self._count('modules branchés')
        return True

    def module_unloaded(self, name):
        """Le module part (ou sa mémoire est reprise) : plus aucun saut ne doit aller à son code recompilé."""
        entry = self.modules.get(name)
        if name not in self.loaded or entry is None:
            return
        del self.loaded[name]
        self.lib.rt_mod_set_base(entry['index'], 0)
        self._sync_module_ranges()
        self._count('modules débranchés')

    def _sync_module_ranges(self):
        if self.uc is not None:
            self.uc.set_module_ranges([(lo & ~(PAGE - 1), (hi + PAGE - 1) & ~(PAGE - 1))
                                       for _, lo, hi, _ in self.loaded.values()])

    def _touch_modules(self, start, size):
        """Une plage de mémoire est reprise ou changée : tout module branché qui la touche est débranché."""
        for name, (base, lo, hi, end) in list(self.loaded.items()):
            if start < end and base < start + size:
                self.module_unloaded(name)

    def module_entries(self):
        """{adresse: nom} des points d'entrée recompilés des modules branchés (diagnostic : cpu_verify.py)."""
        out = {}
        for name, (base, lo, hi, end) in self.loaded.items():
            meta = self.modules[name]
            entries = (ctypes.c_uint32 * meta['functions'])()
            n = self.lib.rt_mod_list_entries(meta['index'], ctypes.addressof(entries), len(entries))
            for i in range(min(n, len(entries))):
                out[base + (entries[i] & ~1)] = name
        return out

    # --- mémoire : la table de pages du C ---

    def _map_native(self, lo, hi, region):
        self.lib.rt_map(lo >> 12, (hi - lo) >> 12, region.backing.address + region.offset + lo - region.start,
                        region.perms & 3)

    def on_map(self, region):
        self._map_native(region.start, region.end, region)

    def on_unmap(self, start, size):
        self._touch_modules(start, size)
        self.lib.rt_map(start >> 12, size >> 12, None, 0)

    def on_protect(self, start, size, perms):
        self._touch_modules(start, size)
        self.lib.rt_map(start >> 12, size >> 12, None, 0)
        for region in self.memory.regions:
            lo, hi = max(region.start, start), min(region.end, start + size)
            if lo < hi:
                self._map_native(lo, hi, region)

    def invalidate(self, start, size):
        if self.uc is not None:
            self.uc.invalidate(start, size)

    # --- registres ---

    def get(self, name):
        ctx = self.cur
        if ctx.mode == UNICORN:
            return self.uc.get(name)
        st = ctx.st
        index = REG_INDEX.get(name)
        if index is not None:
            return st.r[index]
        if name == 'pc':
            return ctx.pc
        if name == 'cpsr':
            return (st.nf << 31 | st.zf << 30 | st.cf << 29 | st.vf << 28 | st.qf << 27 | st.ge << 16 | 0x10)
        if name in ('tls', 'fpscr', 'fpexc'):
            return getattr(st, name)
        raise KeyError(name)

    def set(self, name, value):
        ctx = self.cur
        value &= 0xFFFFFFFF
        if ctx.mode == UNICORN:
            self.uc.set(name, value)
            return
        st = ctx.st
        index = REG_INDEX.get(name)
        if index is not None:
            st.r[index] = value
        elif name == 'pc':
            if ctx.started:
                # La pile C du fil (suspendu dans un appel système) est abandonnée ; le fil repart d'une fonction neuve
                # à cette adresse, avec les registres actuels. Un retour de cette fonction finit le fil.
                self.lib.host_reset(ctx.ptr)
                ctx.started = False
                ctx.segments = []
                ctx.calls = []
            ctx.pc = value & ~1
            ctx.entry = value
            ctx.next_cmd = (CMD_CALL, value)
        elif name == 'cpsr':
            st.nf, st.zf, st.cf, st.vf, st.qf = (value >> 31) & 1, (value >> 30) & 1, (value >> 29) & 1, \
                (value >> 28) & 1, (value >> 27) & 1
            st.ge = (value >> 16) & 15
        elif name in ('tls', 'fpscr', 'fpexc'):
            setattr(st, name, value)
        else:
            raise KeyError(name)

    # --- passage des registres entre la structure du C et unicorn ---

    def _uc_ids(self):
        ids = getattr(self, '_ids', None)
        if ids is None:
            a = self.uc.arm
            r = self.uc.reg_ids
            # Le CPSR d'abord (changer de mode échange sp et lr), le pc en dernier (son bit 0 donne l'état Thumb).
            ids = self._ids = ([r['cpsr']] + [r['r%d' % i] for i in range(13)] + [r['sp'], r['lr'], r['pc'], r['tls'],
                                                                                    r['fpexc'], r['fpscr']]
                               + [getattr(a, 'UC_ARM_REG_D%d' % i) for i in range(16)])
        return ids

    def _native_to_uc(self, ctx, pc, thumb):
        st = ctx.st
        mode = self.uc.get('cpsr') & 0x1F             # le mode d'unicorn ne change pas : sp et lr restent ceux du fil
        cpsr = st.nf << 31 | st.zf << 30 | st.cf << 29 | st.vf << 28 | st.qf << 27 | st.ge << 16 | mode | (0x20 if thumb else 0)
        values = [cpsr] + [st.r[i] for i in range(15)] + [(pc & ~1) | (1 if thumb else 0), st.tls, st.fpexc, st.fpscr]             + list(st.d)
        self.uc.uc.reg_write_batch(list(zip(self._uc_ids(), values)))
        ctx.mode = UNICORN

    def _uc_to_native(self, ctx):
        st = ctx.st
        v = self.uc.uc.reg_read_batch(self._uc_ids())
        cpsr = v[0]
        for i in range(15):
            st.r[i] = v[1 + i]
        pc = v[16] & ~1
        st.nf, st.zf, st.cf, st.vf, st.qf = (cpsr >> 31) & 1, (cpsr >> 30) & 1, (cpsr >> 29) & 1, (cpsr >> 28) & 1,             (cpsr >> 27) & 1
        st.ge = (cpsr >> 16) & 15
        st.tls, st.fpexc, st.fpscr = v[17], v[18], v[19]
        for i in range(16):
            st.d[i] = v[20 + i]
        st.excl_addr = 0xFFFFFFFF
        ctx.pc = pc
        ctx.mode = NATIVE

    # --- contextes ---

    def new_context(self, pc, sp, r0, tls, thumb=False):
        ctx = NativeContext(self.lib, (pc | 1) if thumb else (pc & ~1))
        self.contexts.add(ctx)
        st = ctx.st
        st.r[0] = r0 & 0xFFFFFFFF
        st.r[13] = sp & ~7 & 0xFFFFFFFF
        st.tls = tls
        st.fpexc = 0x40000000          # la VFP est ouverte et FPSCR vaut ce que pose le noyau de la console
        st.fpscr = 0x03C00000
        st.excl_addr = 0xFFFFFFFF
        return ctx

    def save(self):
        ctx = self.cur
        if ctx is not None and ctx.mode == UNICORN:
            ctx.uc_ctx = self.uc.save()
        return ctx

    def restore(self, context):
        self.cur = context
        if context.mode == UNICORN and context.uc_ctx is not None:
            self.uc.restore(context.uc_ctx)

    # --- repères ---

    def watch(self, address, callback, once=False):
        key = address & ~1
        if self.lib.rt_can_hook(address):
            self.watchers.setdefault(key, []).append((callback, once))
            self.lib.rt_watch_set(key, 1)
            return None
        if self.uc is not None:
            return self.uc.watch(address, callback, once)     # dans du code qui tourne sous unicorn seulement
        raise ValueError('pas de repère possible à %#x : ni entrée de fonction recompilée, ni point de la génération '
                         '(python recomp/recomp.py gen --hooks %#x)' % (address, address))

    def _fire(self, pc):
        key = pc & ~1
        entries = self.watchers.get(key)
        self.stats['repères'] += 1
        if not entries:
            return          # une collision de la table d'indices : pas notre adresse
        for item in list(entries):
            callback, once = item
            if once:
                entries.remove(item)
            callback(key)
        if not entries:
            self.watchers.pop(key, None)
            self.lib.rt_watch_set(key, 0)

    def request_stop(self):
        self.request = True
        if self.uc is not None:
            self.uc.request_stop()

    # --- exécution ---

    def _enter_unicorn_at(self, ctx, address):
        """Le code à `address` n'est pas recompilé. S'il est dans le code du jeu, c'est un trou du recompilateur : on
        rend sa page exécutable sous unicorn et on le note (local/recomp/trous.txt) pour la prochaine génération."""
        base = address & ~1
        if self._in_native(base):
            if base not in self.holes_seen:
                self.holes_seen.add(base)
                name, offset = self._module_at(base)
                try:
                    os.makedirs(os.path.dirname(HOLES_FILE), exist_ok=True)
                    if name is None:
                        with open(HOLES_FILE, 'a') as f:
                            f.write('%#x\n' % address)
                    else:
                        with open(CRO_HOLES_FILE, 'a') as f:     # un module : « nom décalage », avec le bit Thumb
                            f.write('%s %#x\n' % (name, offset | (address & 1)))
                except OSError:
                    pass
            if self.uc.grant(base):
                for other in list(self.contexts):
                    for stop in other.segments:
                        self.uc.ensure_stop_hook(stop)


    def run(self, max_instructions):
        ctx = self.cur
        left = max_instructions
        self.request = False
        lib = self.lib
        st = ctx.st
        while True:
            if left <= 0:
                return Stop(Stop.LIMIT, address=self.get('pc'))
            if ctx.mode == NATIVE:
                if not ctx.started:
                    ctx.started = True
                    if not lib.rt_has_entry(ctx.entry):
                        if self.uc is None:
                            return Stop(Stop.FAULT, address=ctx.entry, detail='adresse d\'entrée sans cible recompilée')
                        self._enter_unicorn_at(ctx, ctx.entry)
                        self._native_to_uc(ctx, ctx.entry, ctx.entry & 1)
                        continue
                cmd, arg = ctx.next_cmd
                if cmd == CMD_CALL:
                    st.r[15] = 0                    # le C y range l'adresse de retour de la fonction (voir rt.h)
                budget = max(1, left // BACKEDGE_WEIGHT)
                t0 = time.perf_counter()
                status = lib.host_resume(ctx.ptr, cmd, arg, budget)
                self.t_native += time.perf_counter() - t0
                self.stats['reprises'] += 1
                left -= max(1, (budget - max(st.budget, 0)) * BACKEDGE_WEIGHT)
                ctx.next_cmd = (CMD_CONTINUE, 0)
                if status == HS_SVC:
                    ctx.pc = st.info1 & ~1          # le bit 0 dit que le code est en Thumb
                    ctx.thumb = st.info1 & 1
                    return Stop(Stop.SVC, number=st.info0, address=ctx.pc)
                if status == HS_LIMIT:
                    ctx.pc = st.info0 & ~1
                    ctx.thumb = st.info0 & 1
                    return Stop(Stop.LIMIT, address=ctx.pc)
                if status == HS_HOOK:
                    ctx.pc = st.info0 & ~1
                    ctx.thumb = st.info0 & 1
                    self._fire(st.info0)
                    if self.request:
                        return Stop(Stop.REQUEST, address=ctx.pc)
                    continue
                if status == HS_MISS:
                    if self.uc is None:
                        return Stop(Stop.FAULT, address=st.info0, detail='saut vers du code non recompilé (%#x), '
                                    'sans mode hybride' % st.info0)
                    self.stats['natif_vers_unicorn'] += 1
                    self.last_miss = (st.info0, st.r[14], st.r[13])
                    ctx.segments.append(st.r[14])
                    self._enter_unicorn_at(ctx, st.info0)
                    self.uc.ensure_stop_hook(st.r[14])
                    self._native_to_uc(ctx, st.info0, st.info0 & 1)
                    left -= UNICORN_BURST_COST
                    continue
                if status == HS_DONE:
                    if ctx.calls:
                        self.stats['retours'] += 1
                        lr = st.r[15]               # l'adresse que le retour du code recompilé visait (pop {pc}, bx lr...)
                        expected = ctx.calls.pop()
                        lib.host_ras_pop(ctx.ptr)
                        if lr == 0:
                            lr = expected
                        elif (lr & ~1) != (expected & ~1):
                            self.stats['retours_ailleurs_que_lr'] = self.stats.get('retours_ailleurs_que_lr', 0) + 1
                            if ctx.segments and self._in_native(lr & ~1) \
                                    and (lr >> 12) not in self.uc.granted:
                                # Un retour non-local (RT_POP) vers du code du jeu : l'appelant qui l'attend est plus bas
                                # dans la pile C, sous le passage par unicorn que ce retour enjambe. On « revient » de ce
                                # passage (CMD_RETURN) et le C remonte de lui-même jusqu'à l'appel qui attendait `lr`.
                                ctx.segments.pop()
                                ctx.next_cmd = (CMD_RETURN, 0)
                                continue
                        self._native_to_uc(ctx, lr, lr & 1)
                        continue
                    target = st.r[15]
                    if target > 0xFFFF and self.uc is not None:
                        # Les fonctions C ont toutes rendu la main (un retour vers une adresse que personne n'attendait :
                        # `ldr lr, [pc, #imm]` puis un saut, par exemple). L'état d'un processeur ARM est ses registres et la
                        # mémoire, que la structure garde : unicorn reprend à cette adresse comme si de rien n'était.
                        self.stats['retours_repris_par_unicorn'] = self.stats.get('retours_repris_par_unicorn', 0) + 1
                        self._enter_unicorn_at(ctx, target)
                        self._native_to_uc(ctx, target, target & 1)
                        continue
                    return Stop(Stop.FAULT, address=ctx.pc,
                                detail='le fil est revenu de sa fonction d\'entrée sans appeler ExitThread')
                where = rt_info = (lib.rt_get_info(0), lib.rt_get_info(1))
                where_am_i = st.hint & ~1           # la dernière fonction recompilée entrée : le pc exact n'est pas connu
                if status == HS_FAULT:
                    return Stop(Stop.FAULT, address=where_am_i, detail='%s hors mémoire à %#010x (code recompilé, dans la '
                                'fonction entrée en dernier : %#x)' % ('écriture' if st.info1 else 'lecture', st.info0, where_am_i))
                if status == HS_UNIMPL:
                    return Stop(Stop.FAULT, address=st.info0, detail='instruction non traduite par le recompilateur à %#x'
                                % st.info0)
                if status == HS_NOTARGET:
                    return Stop(Stop.FAULT, address=st.info0, detail='saut sans cible à %#x' % st.info0)
                return Stop(Stop.FAULT, address=ctx.pc, detail='sortie anormale du code natif (statut %d, %s)' % (status, where))
            # --- sous unicorn ---
            uc = self.uc
            uc.last_invalid = None
            uc.hit_stop = None
            t0 = time.perf_counter()
            stop = uc.run(left)
            self.t_unicorn += time.perf_counter() - t0
            invalid = uc.last_invalid
            fetch = stop.kind == Stop.FAULT and invalid is not None and invalid[0] in FETCH_FAULTS
            if uc.hit_stop is not None:
                pc = uc.hit_stop
                thumb = 1 if uc.thumb() else 0
                if not (ctx.segments and (pc & ~1) == (ctx.segments[-1] & ~1)):
                    uc.skip_at = pc             # un autre fil de passage : on n'en tient pas compte, une fois
                    continue
            elif not fetch:
                return stop
            else:
                pc = uc.get('pc')
                thumb = 1 if uc.thumb() else 0
            left -= UNICORN_BURST_COST
            if ctx.segments and (pc & ~1) == (ctx.segments[-1] & ~1):
                stop_address = ctx.segments.pop()
                self._uc_to_native(ctx)
                st.r[15] = stop_address         # si le C appelant rend la main à son tour, c'est là que le fil reprend
                ctx.next_cmd = (CMD_RETURN, 0)
                continue
            if lib.rt_has_entry(pc | thumb):
                # Une traversée coûte cher (copie des registres, des dizaines de microsecondes). Une page du jeu appelée
                # très souvent depuis du code d'un module (une boucle d'un .cro qui rappelle de petites fonctions du jeu)
                # est donnée à unicorn : ces fonctions y tournent sans traverser, comme avec unicorn seul.
                page = pc >> 12
                if page not in uc.granted:
                    count = self.entry_calls.get(page, 0) + 1
                    self.entry_calls[page] = count
                    if count > HOT_PAGE_CALLS and uc.grant(pc):
                        self.stats['pages_cédées_à_unicorn'] = self.stats.get('pages_cédées_à_unicorn', 0) + 1
                        for other in list(self.contexts):
                            for stop in other.segments:
                                uc.ensure_stop_hook(stop)
                if page in uc.granted:
                    continue
                self.stats['unicorn_vers_natif'] += 1
                self._uc_to_native(ctx)
                ctx.calls.append(st.r[14])
                lib.host_ras_push(ctx.ptr, st.r[14])           # le C y retrouve l'adresse de retour (bx r3 qui dépile lr)
                ctx.next_cmd = (CMD_CALL, pc | thumb)
                continue
            if self._in_native(pc) and (pc >> 12) not in uc.granted:
                self._enter_unicorn_at(ctx, pc | thumb)         # un trou du recompilateur
                continue
            return Stop(Stop.FAULT, address=pc, detail='saut vers %#010x : ni code recompilé, ni retour attendu, ni '
                        'code exécutable (%s)' % (pc, 'fil en attente de retour vers ' + ', '.join(
                            '%#x' % s for s in ctx.segments) if ctx.segments else 'aucun retour attendu'))

    def timing(self):
        """(secondes passées dans le code natif, secondes sous unicorn)."""
        self.stats['retours non-locaux'] = self.lib.rt_get_unwinds()
        return self.t_native, self.t_unicorn
