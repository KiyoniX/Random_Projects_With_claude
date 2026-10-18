"""Remonte la poignée d'un envoi IPC jusqu'au nom du service ouvert : la seconde voie d'un nom de requête.

    python ipc_trace.py run <module> <adresse> [<adresse> ...]    le constat pour ces émetteurs, à l'écran
    python ipc_trace.py all [--only M1,M2,...]                    tous les noms de confiance moyenne des
                                                                  local/analyse/<module>/noms-proposes*.tsv qui
                                                                  envoient une requête ; écrit local/analyse/ipc_trace/
    python ipc_trace.py test

Un nom de requête (CFG_GetSystemModel) est haut quand trois choses se recoupent : l'en-tête que l'émetteur écrit dans
le tampon du fil, le nom que la Carte des services donne à cet en-tête dans ce service (../carte-des-services/
donnees.js, corrigée par corrections-pxi.json), et la poignée passée à « svc 0x32 » remontée jusqu'à la chaîne du
service ouvert (« cfg:s »). La troisième se faisait à la main ; ici elle est exécutée, sous unicorn, en trois temps.

1. L'émetteur. Il tourne depuis son entrée jusqu'au « svc 0x32 » qui est dans son corps ou dans un enrobage pur
   qu'il appelle (name_pass.is_pure_svc_wrapper : un émetteur court qui écrit son propre en-tête n'en est pas un).
   Ne sont pris par « all » que les noms dont le corps a l'un ou l'autre (lecture des octets). Chaque mot nul lu dans les données du module (.data, .bss) et chaque mot d'un objet
   reçu en argument reçoit à sa première lecture une marque, une valeur unique qui dit d'où elle vient ; r0..r3 et les
   quatre premiers mots de la pile en reçoivent une aussi. Au « svc », r0 est la poignée : sa marque dit où elle était
   (une globale, le champ +N d'un objet désigné par une globale, le champ +N d'un argument, l'argument lui-même), et
   le mot 0 du tampon du fil est l'en-tête. Si l'envoi n'est pas atteint (une marque prise pour une taille fait
   sortir la fonction), on recommence arguments à zéro, puis globales à zéro aussi (ATTEMPTS).
2. Les appelants, quand la poignée vient d'un argument. Chaque fonction qui appelle l'émetteur (« bl », « blx ») tourne
   jusqu'à l'appel, et le registre de l'argument (plus le décalage du champ) dit la place de la poignée chez elle ;
   si le mot qui y est porte une marque (la poignée recopiée sur la pile depuis une globale), c'est sa place d'origine.
   Un seul niveau : un argument de l'appelant reste un argument.
3. Les ouvertures, une fois par module. Chaque fonction de gh/funcs.tsv tourne deux fois : mémoire à zéro (l'état du
   démarrage, pour qu'un compteur d'ouverture laisse passer l'ouverture) puis avec les marques (pour voir les copies).
   Une requête srv:GetServiceHandle (en-tête 0x00050100) lit le nom aux mots 1 et 2 et sa longueur au mot 3, et rend
   au mot 3 une poignée factice propre à ce nom ; svcConnectToPort (0x2D) de même avec la chaîne en r1. Toute
   écriture d'une de ces poignées dit « cette place tient la session de ce service » ; toute écriture dans une globale
   d'une marque lue dans une autre globale dit « celle-ci est la copie de celle-là ».

Verdict, par émetteur :
    TRACED     un service ouvert à cette place (ou à l'original dont elle est la copie), et le nom de la Carte pour cet
               en-tête dans ce service est le nom proposé ; plusieurs services possibles (la session cfg commune à
               cfg:u, cfg:s et cfg:i) seulement si la Carte leur donne à tous ce même nom, c'est dit dans la note. Un
               service sans cet en-tête dans la Carte prend le nom de ses frères du même module s'ils s'accordent
               (am:net reçoit les 0x10xx d'am:app), c'est dit aussi. Un nom <SERVICE>_cmd_0xNNNN va avec un en-tête
               que la Carte ne nomme pas (ou dit « Inconnue ») : la voie est prouvée, le nom reste moyen.
    MISMATCH   le service est trouvé, mais la Carte nomme cet en-tête autrement que la proposition
    AMBIGUOUS  plusieurs services possibles, que la Carte nomme différemment ; ou la poignée est le champ +N d'un objet
               que l'appelant reçoit lui-même, et le service vient du même champ ouvert dans une autre fonction (même
               classe supposée : le nom de la Carte s'accorde, la place n'est pas prouvée)
    UNTRACED   pas de « svc 0x32 » atteint, poignée sans marque, ou aucune ouverture trouvée pour sa place

Ce que l'exécution suppose. La mémoire est celle du démarrage, marques en plus : un chemin choisi d'après l'état
(poignée nulle, drapeau d'initialisation) est celui que donnent les marques non nulles. Les appels système rendent 0,
sauf les deux ouvertures ci-dessus. Un passage qui tourne jusqu'à sa limite est refait une fois avec les verrous
légers libres (un « ldrex » qui lit 0 ou un nombre négatif y lit 1) : un verrou jamais initialisé attend sans fin.
Les données que qtm recopie dans la mémoire QTM (couverture.RUNTIME_COPIES) sont vues à l'adresse de la copie, mais
ce qui suit la copie (sa mémoire à zéro) n'est pas marqué. Une ouverture qui n'a lieu que derrière un compteur déjà à un, ou dans un objet
désigné par une globale que seule une autre fonction remplit, n'est pas vue : UNTRACED veut dire « pas trouvé ici »,
pas « faux ». Rien n'est écrit qui vienne de la console hors de local/ ; aucune clé n'est lue.
"""
import bisect
import collections
import json
import os
import re
import struct
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import couverture          # noqa: E402
import elfer               # noqa: E402
import emulate_dispatch    # noqa: E402
import ghidra_direct       # noqa: E402
import name_pass           # noqa: E402

ROOT = os.path.dirname(HERE)
ANALYSE = os.path.join(ROOT, 'local', 'analyse')
OUT = os.path.join(ANALYSE, 'ipc_trace')
CORRECTIONS_PXI = os.path.join(os.path.dirname(ROOT), 'carte-des-services', 'corrections-pxi.json')

TLS_BASE = emulate_dispatch.TLS_BASE
COMMAND_BUFFER = emulate_dispatch.COMMAND_BUFFER
STACK_BASE, STACK_SIZE = 0x0F000000, 0x10000
SENTINEL = 0x0DEAD000
TAG_BASE, TAG_STRIDE, TAG_COUNT = 0x40000000, 0x4000, 0x1000    # une marque est aussi un faux objet de 16 Kio
HANDLE_BASE = 0x7E000000                                        # les poignées factices des ouvertures
GET_SERVICE_HANDLE = 0x00050100
SVC_CONNECT_TO_PORT, SVC_SEND_SYNC_REQUEST = 0x2D, 0x32
SENDER_LIMIT, STORE_LIMIT = 20000, 40000
MAX_CALLERS = 8
# Les passages essayés tour à tour (globales marquées, arguments marqués) : une marque prise pour une taille ou un
# drapeau peut écarter le chemin de l'envoi ; à zéro, il passe souvent.
ATTEMPTS = [(True, True), (True, False), (False, False)]


# --- La Carte ---

def load_carte(carte=None, corrections=CORRECTIONS_PXI):
    """({service: {en-tête: nom}}, {service: module}) d'après donnees.js, corrections-pxi.json par-dessus."""
    data = name_pass.load_carte() if carte is None else carte
    names, modules = {}, {}
    for service in data.get('services', []):
        modules[service['id']] = service.get('module', '')
        names[service['id']] = {int(c['h'], 16): c['n'] for c in service.get('commandes', [])}
    if corrections and os.path.isfile(corrections):
        for table in json.load(open(corrections, encoding='utf-8')).get('tables', []):
            for service in table['services']:
                names.setdefault(service, {}).update({int(c['h'], 16): c['n'] for c in table['commandes']})
    return names, modules


# --- Le module ---

class Module:
    """Les octets du module à leurs adresses, ses fonctions (gh/funcs.tsv) et ses appels (iter_calls)."""

    def __init__(self, name, code, segments, functions):
        self.name, self.code, self.segments = name, code, segments
        self.funcs = {a: (size, mode) for a, size, mode in functions}
        self.starts = sorted(self.funcs)
        self.text_base, _, self.text_size = segments[0][0], segments[0][1], segments[0][2]
        self.callers = collections.defaultdict(set)
        for site, target in emulate_dispatch.iter_calls(code, self.text_base, self.text_size):
            self.callers[target].add(site)
        self.wrapper_calls = None          # les sites qui appellent un enrobage de « svc 0x32 », triés

    @classmethod
    def load(cls, name):
        _, code, segments = ghidra_direct.load_module(name)
        functions = [(a, s, m) for a, s, m, _ in ghidra_direct.read_functions(os.path.join(ANALYSE, name, 'gh', 'funcs.tsv'))]
        return cls(name, code, segments, functions)

    def owner(self, address):
        """Le début de la fonction qui couvre l'adresse, ou None."""
        index = bisect.bisect_right(self.starts, address) - 1
        if index >= 0:
            start = self.starts[index]
            if address < start + self.funcs[start][0]:
                return start
        return None

    def extent(self, address):
        if address in self.funcs:
            return self.funcs[address][0]
        index = bisect.bisect_right(self.starts, address)
        return (self.starts[index] if index < len(self.starts) else address + 0x400) - address

    def sends_request(self, address, size, mode):
        """Le corps contient « svc 0x32 », ou appelle un enrobage de « svc 0x32 » (lecture des octets)."""
        offset = address - self.text_base
        body = self.code[offset:offset + size]
        if mode == 'arm':
            if any(w & 0x0FFFFFFF == 0x0F000032 for w in struct.unpack_from('<%dI' % (len(body) // 4), body)):
                return True
        elif any(h == 0xDF32 for h in struct.unpack_from('<%dH' % (len(body) // 2), body)):
            return True
        if self.wrapper_calls is None:
            self.wrapper_calls = sorted(s for t, sites in self.callers.items() if self.is_svc_wrapper(t) for s in sites)
        index = bisect.bisect_left(self.wrapper_calls, address)
        return index < len(self.wrapper_calls) and self.wrapper_calls[index] < address + size

    def is_svc_wrapper(self, address):
        """Un enrobage pur de « svc 0x32 » (name_pass.is_pure_svc_wrapper) : pas un émetteur court qui écrit son en-tête."""
        size, mode = self.funcs.get(address, (0, 'arm'))
        if not size or self.text_base != name_pass.BASE:
            return False
        game = types.SimpleNamespace(code=self.code, funcs={address: (size, mode, '')})
        return SVC_SEND_SYNC_REQUEST in name_pass.decode_svc(game, address)[0] and name_pass.is_pure_svc_wrapper(game, address)


# --- La machine ---

class Machine:
    """Le module sous unicorn, avec les marques. Une marque n'est posée que sur un mot nul jamais écrit pendant le
    passage, lu en entier : un pointeur déjà là (une table virtuelle dans .data) garde sa valeur."""

    def __init__(self, module):
        self.u, self.a = name_pass.import_unicorn()
        u, a = self.u, self.a
        self.module = module
        uc = self.uc = u.Uc(u.UC_ARCH_ARM, u.UC_MODE_ARM)
        uc.ctl_set_cpu_model(a.UC_CPU_ARM_11MPCORE)
        low = module.segments[0][0] & ~0xFFF
        high = (max(b + m for b, _, _, m, _ in module.segments) + 0xFFF) & ~0xFFF
        uc.mem_map(low, high - low)
        self.pristine = []
        for base, offset, file_size, mem_size, flags in module.segments:
            uc.mem_write(base, module.code[offset:offset + file_size])
            if flags & elfer.PF_W:
                self.pristine.append((base, module.code[offset:offset + file_size] + bytes(mem_size - file_size)))
        # Les données qu'un module recopie ailleurs au démarrage (la mémoire QTM de qtm) : vues à l'adresse de la copie.
        for source, copy, size in couverture.RUNTIME_COPIES.get(module.name, []):
            for base, offset, file_size, _, _ in module.segments:
                if base <= source < base + file_size:
                    uc.mem_map(copy & ~0xFFF, (copy + size - (copy & ~0xFFF) + 0xFFF) & ~0xFFF)
                    self.pristine.append((copy, module.code[offset + source - base:offset + source - base + size]))
        self.writable = [(b, b + len(d)) for b, d in self.pristine]
        uc.mem_map(TLS_BASE, 0x1000)
        uc.mem_map(STACK_BASE, STACK_SIZE)
        uc.mem_map(SENTINEL, 0x1000)
        uc.mem_write(SENTINEL, struct.pack('<I', 0xE12FFF1E))
        uc.reg_write(a.UC_ARM_REG_C1_C0_2, uc.reg_read(a.UC_ARM_REG_C1_C0_2) | 0xF << 20)
        uc.reg_write(a.UC_ARM_REG_FPEXC, 0x40000000)
        self.pages = set()
        self.regs = [getattr(a, 'UC_ARM_REG_R%d' % n) for n in range(4)]
        for start, end in self.writable + [(TAG_BASE, TAG_BASE + TAG_STRIDE * TAG_COUNT)]:
            uc.hook_add(u.UC_HOOK_MEM_READ, self._on_read, begin=start, end=end - 1)
        for start, end in self.writable + [(TAG_BASE, TAG_BASE + TAG_STRIDE * TAG_COUNT), (TLS_BASE, TLS_BASE + 0x1000)]:
            uc.hook_add(u.UC_HOOK_MEM_WRITE, self._on_write, begin=start, end=end - 1)
        uc.hook_add(u.UC_HOOK_MEM_READ_UNMAPPED | u.UC_HOOK_MEM_WRITE_UNMAPPED | u.UC_HOOK_MEM_FETCH_UNMAPPED,
                    self._on_unmapped)
        uc.hook_add(u.UC_HOOK_INTR, self._on_interrupt)

    # Les crochets

    def _on_read(self, uc, access, address, size, value, data):
        if size < 4:
            return
        for word in range(address & ~3, address + size, 4):
            if word in self.written or len(self.tags) >= TAG_COUNT or struct.unpack('<I', uc.mem_read(word, 4))[0]:
                continue
            index = (word - TAG_BASE) // TAG_STRIDE
            if not (self.mark_globals and any(s <= word < e for s, e in self.writable)) and \
                    not 0 <= index < len(self.tags):
                continue                    # une marque n'est posée que dans un faux objet qui existe déjà
            uc.mem_write(word, struct.pack('<I', self.new_tag(('load', word))))
            self.written.add(word)

    def _on_lock_read(self, uc, access, address, size, value, data):
        """Un verrou léger libre vaut 1 ; à 0 (jamais initialisé) ou pris (négatif), il attend sans fin. Partout en
        mémoire : le verrou peut être hors des données connues (la mémoire QTM de qtm)."""
        if size != 4 or address & 3 or struct.unpack('<i', uc.mem_read(address, 4))[0] > 0:
            return
        pc = uc.reg_read(self.a.UC_ARM_REG_PC)
        if uc.reg_read(self.a.UC_ARM_REG_CPSR) & 0x20:
            ldrex = struct.unpack('<H', uc.mem_read(pc, 2))[0] & 0xFFF0 == 0xE850
        else:
            ldrex = struct.unpack('<I', uc.mem_read(pc, 4))[0] & 0x0FF00FFF == 0x01900F9F
        if ldrex:
            uc.mem_write(address, struct.pack('<I', 1))
            self.written.add(address)

    def _on_write(self, uc, access, address, size, value, data):
        self.written.update(range(address & ~3, address + size, 4))
        if size == 4:
            self.writes.append((address, value & 0xFFFFFFFF, uc.reg_read(self.a.UC_ARM_REG_PC)))

    def _on_unmapped(self, uc, access, address, size, value, data):
        page = address & ~0xFFF
        if self.new_pages > 256:
            return False
        self.new_pages += 1
        try:
            uc.mem_map(page, 0x1000)
        except self.u.UcError:
            return False
        self.pages.add(page)
        return True

    def _on_interrupt(self, uc, number, data):
        a = self.a
        pc = uc.reg_read(a.UC_ARM_REG_PC)
        thumb = bool(uc.reg_read(a.UC_ARM_REG_CPSR) & 0x20)
        at = pc - (2 if thumb else 4)
        svc = uc.mem_read(at, 1)[0] if thumb else struct.unpack('<I', uc.mem_read(at, 4))[0] & 0xFFFFFF
        if svc == SVC_SEND_SYNC_REQUEST:
            header = self.word(COMMAND_BUFFER)
            if self.on_request and self.on_request(at, header):
                uc.emu_stop()
                return
            reply = [0, 0]
            if header == GET_SERVICE_HANDLE:
                length = min(self.word(COMMAND_BUFFER + 12), 8)
                reply = [0x00050042, 0, 0, self.handle(bytes(uc.mem_read(COMMAND_BUFFER + 4, length)))]
            uc.mem_write(COMMAND_BUFFER, struct.pack('<%dI' % len(reply), *reply))
        elif svc == SVC_CONNECT_TO_PORT:
            uc.reg_write(a.UC_ARM_REG_R1, self.handle(self.string(uc.reg_read(a.UC_ARM_REG_R1))))
        uc.reg_write(a.UC_ARM_REG_R0, 0)

    # Les marques et les poignées factices

    def new_tag(self, source):
        self.tags.append(source)
        return TAG_BASE + TAG_STRIDE * (len(self.tags) - 1)

    def handle(self, name):
        """La poignée factice d'un service : son nom s'il se lit (« cfg:s »), sinon None (un nom venu d'un argument)."""
        text = name.split(b'\0')[0]
        readable = text.decode('ascii') if text and all(0x20 < c < 0x7F for c in text) else None
        self.handles.append(readable)
        return HANDLE_BASE + 4 * (len(self.handles) - 1)

    def handle_name(self, value):
        index = (value - HANDLE_BASE) // 4
        if value & 3 or not 0 <= index < len(self.handles):
            return False, None
        return True, self.handles[index]

    def word(self, address):
        return struct.unpack('<I', self.uc.mem_read(address, 4))[0]

    def string(self, address):
        try:
            return bytes(self.uc.mem_read(address, 12))
        except self.u.UcError:
            return b''

    # Où était une valeur, où est une adresse

    def place(self, address, depth=0):
        """('global', A), ('ptr', A, k) le champ +k de l'objet désigné par la globale A, ('arg', n, k) le champ +k de
        l'argument n, ('stack', décalage), ('deep', texte) une marque de marque, ou ('other', adresse)."""
        if any(s <= address < e for s, e in self.writable):
            return ('global', address)
        index, offset = divmod(address - TAG_BASE, TAG_STRIDE)
        if 0 <= index < len(self.tags):
            source = self.tags[index]
            if source[0] == 'arg':
                return ('arg', source[1], offset)
            if depth > 3:
                return ('deep', '[…]+%#x' % offset)
            outer = self.place(source[1], depth + 1)
            if outer[0] == 'global':
                return ('ptr', outer[1], offset)
            return ('deep', '[%s]+%#x' % (describe(outer), offset))
        if STACK_BASE <= address < STACK_BASE + STACK_SIZE:
            return ('stack', address - (STACK_BASE + STACK_SIZE - 0x100))
        return ('other', address)

    def origin(self, value):
        """D'où vient une valeur : sa marque (la place qui la tenait, ou ('arg', n, None)), sinon ('const', valeur)."""
        index, offset = divmod(value - TAG_BASE, TAG_STRIDE)
        if not offset and 0 <= index < len(self.tags):
            source = self.tags[index]
            return ('arg', source[1], None) if source[0] == 'arg' else self.place(source[1])
        return ('const', value)

    # Un passage

    def run(self, entry, thumb, mark_globals, limit, on_request=None, stop_at=None, mark_args=True):
        """Lance la fonction, arguments marqués (à zéro sans mark_args). Rend la raison de l'arrêt ('svc', 'stop',
        'return' ou l'erreur). Un passage qui tourne jusqu'à la limite est refait une fois, verrous libres : un
        verrou jamais initialisé (0) fait tourner sans fin ; un « ldrex » qui lit un mot nul y lit alors 1."""
        for free_locks in (False, True):
            end = self._run(entry, thumb, mark_globals, limit, on_request, stop_at, mark_args, free_locks)
            if end != 'limite':
                break
        return end

    def _run(self, entry, thumb, mark_globals, limit, on_request, stop_at, mark_args, free_locks):
        uc, a = self.uc, self.a
        self.free_locks = free_locks
        for base, data in self.pristine:
            uc.mem_write(base, data)
        for page in self.pages:                # les pages ajoutées restent, vidées
            uc.mem_write(page, bytes(0x1000))
        uc.mem_write(TLS_BASE, bytes(0x1000))
        self.tags, self.handles, self.written, self.writes, self.new_pages = [], [], set(), [], 0
        self.mark_globals, self.on_request, self.stopped = mark_globals, on_request, None
        for n, reg in enumerate(self.regs):
            uc.reg_write(reg, self.new_tag(('arg', n)) if mark_args else 0)
        for reg in range(4, 13):
            uc.reg_write(getattr(a, 'UC_ARM_REG_R%d' % reg), 0)
        sp = STACK_BASE + STACK_SIZE - 0x100
        uc.mem_write(sp, struct.pack('<4I', *(self.new_tag(('arg', n)) if mark_args else 0 for n in range(4, 8))))
        uc.reg_write(a.UC_ARM_REG_SP, sp)
        uc.reg_write(a.UC_ARM_REG_LR, SENTINEL)
        uc.reg_write(a.UC_ARM_REG_C13_C0_3, TLS_BASE)
        hook = uc.hook_add(self.u.UC_HOOK_MEM_READ, self._on_lock_read) if free_locks else None
        stop_hook = None
        if stop_at is not None:
            def on_code(uc_, address, size, data):
                self.stopped = 'stop'
                uc_.emu_stop()
            stop_hook = uc.hook_add(self.u.UC_HOOK_CODE, on_code, begin=stop_at, end=stop_at)
            uc.ctl_remove_cache(stop_at, stop_at + 4)     # un bloc déjà traduit ne verrait pas le nouveau crochet
        try:
            uc.emu_start(entry | (1 if thumb else 0), SENTINEL, count=limit)
        except self.u.UcError as error:
            self.stopped = self.stopped or 'erreur %s à %#x' % (error, uc.reg_read(a.UC_ARM_REG_PC))
        finally:
            for h in (hook, stop_hook):
                if h is not None:
                    uc.hook_del(h)
        if self.stopped is None:
            self.stopped = 'return' if uc.reg_read(a.UC_ARM_REG_PC) == SENTINEL else 'limite'
        return self.stopped

    def argument(self, n):
        if n < 4:
            return self.uc.reg_read(self.regs[n])
        return self.word(self.uc.reg_read(self.a.UC_ARM_REG_SP) + 4 * (n - 4))


def describe(place):
    kind = place[0]
    if kind == 'global':
        return '[%#x]' % place[1]
    if kind == 'ptr':
        return '[[%#x]+%#x]' % place[1:]
    if kind == 'arg':
        name = 'r%d' % place[1] if place[1] < 4 else 'arg%d' % place[1]
        return name if place[2] is None else '[%s+%#x]' % (name, place[2])
    if kind == 'stack':
        return 'pile %+#x' % place[1]
    if kind == 'deep':
        return place[1]
    return '%s %#x' % (kind, place[1])


# --- Les trois temps ---

def trace_sender(machine, address, mode):
    """(en-tête, place de la poignée, adresse du svc) au premier « svc 0x32 » de son corps, ou (None, raison, None)."""
    module = machine.module
    size = module.extent(address)
    seen = {}

    def on_request(at, header):
        owner = module.owner(at)
        if address <= at < address + size or owner is not None and module.is_svc_wrapper(owner):
            if COMMAND_BUFFER not in machine.written:
                return False
            seen['at'], seen['header'] = at, header
            seen['place'] = machine.origin(machine.uc.reg_read(machine.a.UC_ARM_REG_R0))
            return True
        return False

    for marks in ATTEMPTS:
        end = machine.run(address, mode == 'thumb', marks[0], SENDER_LIMIT, on_request, mark_args=marks[1])
        if 'at' in seen:
            break
    if 'at' not in seen:
        return None, 'pas de svc 0x32 atteint (%s)' % end, None
    return seen['header'], seen['place'], seen['at']


def caller_places(machine, address, place):
    """[(appelant, place)] : la place de la poignée chez chaque appelant d'une poignée reçue en argument."""
    module = machine.module
    out = []
    callers = sorted({module.owner(s) for s in module.callers.get(address, ()) if module.owner(s) is not None})
    for caller in callers[:MAX_CALLERS]:
        for marks in ATTEMPTS:
            end = machine.run(caller, module.funcs[caller][1] == 'thumb', marks[0], SENDER_LIMIT, stop_at=address,
                              mark_args=marks[1])
            if end == 'stop':
                break
        if end != 'stop':
            out.append((caller, ('other', 0), 'n\'atteint pas l\'appel (%s)' % end))
            continue
        value = machine.argument(place[1])
        if place[2] is None:
            found = machine.origin(value)
        else:
            # Le mot que l'émetteur va lire : s'il porte une marque, sa place d'origine (une poignée recopiée sur la
            # pile de l'appelant depuis une globale) ; sinon la place elle-même.
            try:
                found = machine.origin(machine.word(value + place[2]))
            except machine.u.UcError:
                found = ('const', 0)
            if found[0] == 'const':
                found = machine.place(value + place[2])
        out.append((caller, found, ''))
    return out


class Stores:
    """Les ouvertures et les copies d'un module, en faisant tourner chacune de ses fonctions (troisième temps)."""

    def __init__(self, machine):
        self.opens = collections.defaultdict(set)     # place -> {(service, fonction)}
        self.copies = collections.defaultdict(set)    # globale -> {(globale d'origine, fonction)}
        module = self.module = machine.module
        for address in module.starts:
            mode = module.funcs[address][1]
            for marked in (False, True):
                machine.run(address, mode == 'thumb', marked, STORE_LIMIT)
                for at, value, pc in machine.writes:
                    writer = module.owner(pc) or address     # la fonction qui écrit, pas celle qu'on a lancée
                    is_handle, name = machine.handle_name(value)
                    if is_handle:
                        if name:
                            self.opens[machine.place(at)].add((name, writer))
                        continue
                    if marked:
                        source, target = machine.origin(value), machine.place(at)
                        if source[0] == 'global' and target[0] == 'global' and source != target:
                            self.copies[target[1]].add((source[1], writer))

    def literal(self, service):
        """Les adresses de la chaîne du service dans le module (« cfg:s » suivi d'un zéro)."""
        found, code, needle = [], self.module.code, service.encode() + bytes(1)
        start = code.find(needle)
        while start >= 0 and len(found) < 3:
            for base, offset, size, _, _ in self.module.segments:
                if offset <= start < offset + size:
                    found.append(base + start - offset)
            start = code.find(needle, start + 1)
        return '/'.join('%#x' % a for a in found) or 'chaîne absente'

    def services(self, place):
        """[(service, preuve)] des ouvertures à cette place, ou à la globale dont elle est la copie."""
        out = [(s, 'ouverte par %#x avec « %s » (%s)' % (f, s, self.literal(s))) for s, f in sorted(self.opens.get(place, ()))]
        if place[0] == 'global':
            for source, function in sorted(self.copies.get(place[1], ())):
                out += [(s, 'copie de [%#x] par %#x, ouverte par %#x avec « %s » (%s)' % (source, function, f, s, self.literal(s)))
                        for s, f in sorted(self.opens.get(('global', source), ()))]
        return out


# --- Le verdict ---

def normalise(text):
    return re.sub(r'[^a-z0-9]', '', text.lower())


def carte_name(carte, modules, service, header):
    """(nom, note) : le nom de la Carte dans ce service, sinon celui que ses frères du même module s'accordent à donner."""
    names, _ = carte
    name = names.get(service, {}).get(header)
    if name:
        return name, ''
    siblings = {s: n[header] for s, n in names.items() if header in n and modules.get(s) and
                modules.get(s) == modules.get(service) and s != service}
    if siblings and len(set(siblings.values())) == 1:
        return next(iter(siblings.values())), '%s n\'a pas %#010x dans la Carte ; %s : même nom' % (
            service, header, '/'.join(sorted(siblings)))
    return None, ''


def judge(name, header, services, carte):
    """(verdict, noms de la Carte par service, note)."""
    if header is None or not services:
        return 'UNTRACED', '', ''
    names, modules = carte
    found, notes = {}, []
    for service in sorted({s for s, _ in services}):
        carte_n, note = carte_name(carte, modules, service, header)
        found[service] = carte_n
        if note:
            notes.append(note)
    shown = ', '.join('%s %s' % (s, n or '—') for s, n in found.items())

    def agrees(carte_n):
        if carte_n and carte_n != 'Inconnue':
            return normalise(name).endswith(normalise(carte_n))
        return bool(re.search(r'cmd_0x0*%x$' % (header >> 16), name, re.I))

    values = set(found.values())
    if len(values) == 1 and agrees(next(iter(values))):
        if None in values or 'Inconnue' in values:
            notes.append('la Carte ne nomme pas cet en-tête : voie prouvée, le nom par numéro reste moyen')
        if len(found) > 1:
            notes.append('session commune à %s, même nom partout' % '/'.join(found))
        return 'TRACED', shown, ' ; '.join(notes)
    if len(found) > 1:
        return 'AMBIGUOUS', shown, ' ; '.join(notes)
    return 'MISMATCH', shown, ' ; '.join(notes)


def all_carte_names(carte, header):
    if header is None:
        return ''
    out = collections.defaultdict(list)
    for service, commands in carte[0].items():
        if header in commands:
            out[commands[header]].append(service)
    return ' | '.join('%s (%s)' % (n, ', '.join(sorted(s))) for n, s in sorted(out.items()))


def analyse(machine, stores, carte, address, mode, name):
    """La ligne d'un émetteur : en-tête, noms de la Carte, place de la poignée, service ouvert, verdict, note."""
    header, place, at = trace_sender(machine, address, mode)
    row = {'header': header, 'carte': all_carte_names(carte, header), 'place': '', 'service': '', 'note': ''}
    if header is None:
        row.update(verdict='UNTRACED', note=place)
        return row
    places = [(None, place, '')]
    if place[0] == 'arg':
        places = caller_places(machine, address, place)
    row['place'] = describe(place) + ('' if place[0] != 'arg' else ' ; appelants : ' + ', '.join(
        '%#x %s%s' % (c, describe(p), ' (%s)' % why if why else '') for c, p, why in places))
    services, proofs, assumed = [], [], False
    for _, where, _ in places:
        for service, proof in stores.services(where):
            services.append((service, proof))
            proofs.append('%s %s %s' % (describe(where), service, proof))
            assumed |= where[0] not in ('global', 'ptr')
    row['service'] = ', '.join(sorted({s for s, _ in services}))
    verdict, _, note = judge(name, header, services, carte)
    if assumed and verdict == 'TRACED':
        # Le champ +N d'un objet reçu par l'appelant n'est pas une place fixe : l'ouverture trouvée l'est dans le même
        # champ d'un objet reçu par une autre fonction. Même classe supposée, pas prouvée.
        verdict = 'AMBIGUOUS'
        note = ' ; '.join(x for x in [note, 'objet reçu par l\'appelant : même champ ouvert ailleurs, classe supposée'] if x)
    row['verdict'] = verdict
    row['note'] = ' ; '.join(x for x in ['svc à %#x' % at] + sorted(set(proofs)) + [note] if x)
    if not services:
        row['note'] += ' ; aucune ouverture trouvée pour cette place'
    return row


# --- Les propositions ---

def proposal_rows(module):
    """[(adresse, genre, nom, preuve)] de confiance moyenne des noms-proposes*.tsv du module."""
    out = []
    folder = os.path.join(ANALYSE, module)
    for file in sorted(os.listdir(folder)):
        if file.startswith('noms-proposes') and file.endswith('.tsv'):
            for line in open(os.path.join(folder, file), encoding='utf-8'):
                p = line.rstrip('\n').split('\t')
                if len(p) >= 5 and p[0].startswith('0x') and p[3] == 'moyenne':
                    out.append((int(p[0], 16), p[1], p[2], p[4]))
    return out


def traceable_modules():
    names = []
    for name in sorted(os.listdir(ANALYSE)):
        folder = os.path.join(ROOT, 'local', 'extrait', name, 'exefs')
        if os.path.isfile(os.path.join(ANALYSE, name, 'gh', 'funcs.tsv')) and \
                os.path.isfile(os.path.join(folder, 'code.bin')) and os.path.isfile(os.path.join(folder, 'exheader.bin')) \
                and any(f.startswith('noms-proposes') for f in os.listdir(os.path.join(ANALYSE, name))):
            names.append(name)
    return names


def trace_module(name, addresses=None, carte=None):
    """[(adresse, nom proposé, ligne)] des émetteurs du module (ses propositions moyennes, ou ces adresses)."""
    module = Module.load(name)
    carte = carte or load_carte()
    proposals = {a: (g, n) for a, g, n, _ in proposal_rows(name)}
    if addresses is None:
        targets = []
        for address, (genre, proposed) in sorted(proposals.items()):
            mode = module.funcs.get(address, (0, 'thumb' if genre == 'label' else 'arm'))[1]
            if module.sends_request(address, module.extent(address), mode):
                targets.append((address, mode, proposed))
    else:
        names = emulate_dispatch.load_names(os.path.join(ROOT, 'fiches', ghidra_direct.NAME_FILES.get(name, name) + '.noms.tsv'))
        targets = [(a, module.funcs.get(a, (0, 'thumb' if proposals.get(a, ('',))[0] == 'label' else 'arm'))[1],
                    proposals.get(a, ('', names.get(a, '')))[1]) for a in addresses]
    if not targets:
        return []
    machine = Machine(module)
    stores = Stores(machine)
    return [(a, proposed, analyse(machine, stores, carte, a, mode, proposed)) for a, mode, proposed in targets]


COLUMNS = ['module', 'adresse', 'nom proposé', 'en-tête', 'noms Carte', 'poignée', 'service ouvert', 'verdict', 'note']


def tsv_line(module, address, proposed, row):
    header = '' if row['header'] is None else '%#010x' % row['header']
    return '\t'.join([module, '%#x' % address, proposed, header, row['carte'], row['place'], row['service'],
                      row['verdict'], row['note']])


def run_all(only=None, out=OUT):
    """Écrit resultats.tsv et compte.tsv. Avec only, seules les lignes de ces modules sont refaites : les autres
    lignes du resultats.tsv déjà là sont gardées."""
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, 'resultats.tsv')
    carte = load_carte()
    rows = []
    if only and os.path.isfile(path):
        rows = [line.rstrip('\n').split('\t') for line in open(path, encoding='utf-8')][1:]
        rows = [r for r in rows if r[0] not in only]
    for name in traceable_modules():
        if only and name not in only:
            continue
        print('%s...' % name, flush=True)
        for address, proposed, row in trace_module(name, carte=carte):
            rows.append(tsv_line(name, address, proposed, row).split('\t'))
    rows.sort(key=lambda r: (r[0], int(r[1], 16)))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\t'.join(COLUMNS) + '\n' + ''.join('\t'.join(r) + '\n' for r in rows))
    counts = collections.defaultdict(collections.Counter)
    for r in rows:
        counts[r[0]][r[7]] += 1
    verdicts = ['TRACED', 'MISMATCH', 'AMBIGUOUS', 'UNTRACED']
    summary = ['module\t' + '\t'.join(verdicts) + '\ttotal']
    total = collections.Counter()
    for name, count in sorted(counts.items()):
        total.update(count)
        summary.append('\t'.join([name] + [str(count[v]) for v in verdicts] + [str(sum(count.values()))]))
    summary.append('\t'.join(['total'] + [str(total[v]) for v in verdicts] + [str(sum(total.values()))]))
    with open(os.path.join(out, 'compte.tsv'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(summary) + '\n')
    print('\n'.join(summary))


# --- L'essai sur un module fabriqué ---

def fake_module(carte_services):
    """Un module ARM écrit à la main : une ouverture de « foo:s » dans G, une copie de G dans G+4, un émetteur qui
    lit G, un émetteur qui lit *r0 et son appelant qui passe G+4, un émetteur dont la poignée vient de nulle part,
    une session commune ouverte deux fois (« bar:u », « bar:s ») dans H."""
    text, ro, data = 0x100000, 0x110000, 0x120000
    G, H = data + 0x10, data + 0x20
    words, literals = {}, {}

    def ldr_literal(at, rd, value):
        pool = literals.setdefault(value, text + 0xF00 + 4 * len(literals))
        return 0xE59F0000 | rd << 12 | (pool - at - 8)

    def emit(start, program):
        for i, item in enumerate(program):
            at = start + 4 * i
            words[at] = item(at) if callable(item) else item

    def ldr(rd, value):
        return lambda at: ldr_literal(at, rd, value)

    def bl(target):
        return lambda at: 0xEB000000 | ((target - at - 8) >> 2 & 0xFFFFFF)

    mrc0, svc, ret, push, pop = 0xEE1D0F70, 0xEF000032, 0xE12FFF1E, 0xE52DE004, 0xE49DF004

    def opener(name_at, place):
        return [mrc0, ldr(1, GET_SERVICE_HANDLE), 0xE5801080, ldr(2, name_at), 0xE5923000, 0xE5803084, 0xE5923004,
                0xE5803088, 0xE3A03005, 0xE580308C, svc, mrc0, 0xE590108C, ldr(2, place), 0xE5821000, ret]
    emit(text + 0x000, opener(ro, G))                                         # ouvre « foo:s » dans G
    emit(text + 0x100, [ldr(2, G), 0xE5921000, 0xE5821004, ret])              # copie G dans G+4
    emit(text + 0x200, [mrc0, ldr(1, 0x00050000), 0xE5801080, ldr(2, G), 0xE5920000, svc, ret])
    emit(text + 0x300, [0xEE1D1F70, ldr(2, 0x00140082), 0xE5812080, 0xE5900000, svc, ret])   # poignée = *r0
    emit(text + 0x400, [push, ldr(0, G + 4), bl(text + 0x300), pop])
    emit(text + 0x500, [mrc0, ldr(1, 0x00050000), 0xE5801080, 0xE3A00007, svc, ret])          # poignée constante
    emit(text + 0x600, opener(ro + 8, H))
    emit(text + 0x700, opener(ro + 16, H))
    emit(text + 0x800, [mrc0, ldr(1, 0x00060000), 0xE5801080, ldr(2, H), 0xE5920000, svc, ret])
    for value, pool in literals.items():
        words[pool] = value
    code = bytearray(0x1000)
    for at, w in words.items():
        struct.pack_into('<I', code, at - text, w)
    code += b'foo:s\0\0\0bar:u\0\0\0bar:s\0\0\0'.ljust(0x1000, b'\0') + bytes(0x100)
    segments = [(text, 0, 0x1000, 0x1000, elfer.PF_R | elfer.PF_X), (ro, 0x1000, 0x1000, 0x1000, elfer.PF_R),
                (data, 0x2000, 0x100, 0x1000, elfer.PF_R | elfer.PF_W)]
    sizes = {0x000: 0x40, 0x100: 0x10, 0x200: 0x1C, 0x300: 0x18, 0x400: 0x10, 0x500: 0x18, 0x600: 0x40, 0x700: 0x40,
             0x800: 0x1C}
    module = Module('essai', bytes(code), segments, [(text + o, s, 'arm') for o, s in sizes.items()])
    carte = load_carte({'services': carte_services}, corrections=None)
    return module, carte, G, H


def test():
    failures = []

    def check(condition, text):
        print(('ok    ' if condition else 'ÉCHEC ') + text)
        if not condition:
            failures.append(text)

    services = [{'id': 'foo:s', 'module': 'foo', 'commandes': [{'h': '0x00050000', 'n': 'GetThing'},
                                                               {'h': '0x00140082', 'n': 'WriteRaw'}]},
                {'id': 'foo:u', 'module': 'foo', 'commandes': [{'h': '0x00090000', 'n': 'Only'}]},
                {'id': 'bar:u', 'module': 'bar', 'commandes': [{'h': '0x00060000', 'n': 'GetModel'}]},
                {'id': 'bar:s', 'module': 'bar', 'commandes': [{'h': '0x00060000', 'n': 'GetModel'}]}]
    carte = load_carte({'services': services}, corrections=None)
    check(judge('FOO_GetThing', 0x00050000, [('foo:s', '')], carte)[0] == 'TRACED', 'verdict : un service, même nom')
    check(judge('FOO_Other', 0x00050000, [('foo:s', '')], carte)[0] == 'MISMATCH', 'verdict : nom différent')
    check(judge('FOO_GetThing', 0x00050000, [('foo:s', ''), ('bar:u', '')], carte)[0] == 'AMBIGUOUS',
          'verdict : deux services de noms différents')
    check(judge('FOO_Only', 0x00090000, [('foo:s', '')], carte)[0] == 'TRACED', 'verdict : nom d\'un frère du module')
    check(judge('FOO_cmd_0x0007', 0x00070000, [('foo:s', '')], carte)[0] == 'TRACED', 'verdict : nom par numéro')
    check(judge('FOO_GetThing', 0x00050000, [], carte)[0] == 'UNTRACED', 'verdict : rien d\'ouvert')
    try:
        name_pass.import_unicorn()
    except ImportError:
        print('unicorn manque : essais d\'exécution sautés')
        return failures
    module, carte, G, H = fake_module(services)
    machine = Machine(module)
    stores = Stores(machine)
    check(('foo:s', 0x100000) in stores.opens[('global', G)], 'ouverture de « foo:s » dans G')
    check((G, 0x100100) in stores.copies[G + 4], 'G+4 est une copie de G')
    row = analyse(machine, stores, carte, 0x100200, 'arm', 'FOO_GetThing')
    check((row['header'], row['place'], row['service'], row['verdict']) == (0x00050000, '[%#x]' % G, 'foo:s', 'TRACED'),
          'poignée globale : %r' % row)
    row = analyse(machine, stores, carte, 0x100300, 'arm', 'FOO_WriteRaw')
    check(row['verdict'] == 'TRACED' and row['place'].startswith('[r0+0x0] ; appelants : 0x100400 [%#x]' % (G + 4))
          and 'copie de' in row['note'], 'poignée en argument, copie d\'une globale : %r' % row)
    row = analyse(machine, stores, carte, 0x100500, 'arm', 'FOO_GetThing')
    check(row['verdict'] == 'UNTRACED' and row['place'] == 'const 0x7', 'poignée sans marque : %r' % row)
    row = analyse(machine, stores, carte, 0x100800, 'arm', 'BAR_GetModel')
    check(row['verdict'] == 'TRACED' and row['service'] == 'bar:s, bar:u' and 'session commune' in row['note'],
          'session commune, même nom : %r' % row)
    check(row['carte'] == 'GetModel (bar:s, bar:u)', 'noms de la Carte pour l\'en-tête : %r' % row['carte'])
    print('%d échec(s)' % len(failures))
    return failures


def main():
    args = sys.argv[1:]
    if not args or args[0] == 'test':
        sys.exit(1 if test() else 0)
    if args[0] == 'run' and len(args) >= 3:
        for address, proposed, row in trace_module(args[1], [int(a, 16) for a in args[2:]]):
            print(tsv_line(args[1], address, proposed, row))
    elif args[0] == 'all':
        only = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
        run_all(only)
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
