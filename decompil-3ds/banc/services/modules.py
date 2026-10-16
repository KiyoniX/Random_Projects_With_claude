"""Les services remplaçants des modules réseau et accessoires, écrits d'après les fiches (colonne « Ce que Pokémon X envoie »).

`nwm::UDS`, `boss:U`, `ssl:C`, `cecd:u`, `cam:u`, `mic:u`, `ir:USER`, `ndm:u`, `ac:u`, `frd:u`, `soc:U`, `http:C`.

Chaque service a deux garanties : (1) toute commande de la fiche reçoit une réponse de la bonne forme, celle que le
vrai module écrit en tête (`reply_shapes.py` : nombre de mots, nombre de mots de traduction), et une commande
absente de la fiche reçoit `0xD900182F` comme sur la console ; (2) les commandes que Pokémon X envoie ont l'état et
les résultats que la fiche demande à un remplaçant (poignées d'événements vraies, états, erreurs). Tout ce que la
fiche dit pouvoir rester factice répond « 0 et des zéros ». Il n'y a aucun réseau : le Wi-Fi est « éteint », aucune
console voisine n'existe, aucun serveur ne répond. Quand une fiche laisse le choix ou n'a pas lu une réaction du jeu,
le commentaire du service le dit (« interprété »).

Les services sont créés par `Stub(bench, nom)` (stubs.py) : le nom choisit la classe.
"""
import hashlib
import os
import random
import shutil
import struct

from ipc import ERR_UNKNOWN_COMMAND, Reply, error
from kernel import Event, SharedMemory, Wait
from services import reply_shapes
from services.stubs import Stub

NS_PER_MS = 1_000_000


# --- la forme des réponses ---

def buffer_items(req):
    """Les tampons projetés de la requête, dans l'ordre : [(position, genre, adresse, taille)] ; genre 0xA lecture,
    0xC écriture, 0xE les deux."""
    return sorted((pos, item[1], item[2], item[3]) for pos, item in req.items.items() if item[0] == 'buffer')


def static_items(req):
    """Les tampons statiques de la requête : [(position, indice, adresse, taille)]."""
    return sorted((pos, item[1], item[2], item[3]) for pos, item in req.items.items() if item[0] == 'static')


def handle_objects(req):
    """Tous les objets des poignées envoyées, dans l'ordre."""
    objects = []
    for pos in sorted(req.items):
        if req.items[pos][0] == 'handles':
            objects += req.items[pos][1]
    return objects


def translate_length(reply):
    total = 0
    for item in reply.translate:
        total += 1 + len(item[1]) if item[0] in ('copy', 'move') else 2 if item[0] == 'static' else len(item[1])
    return total


def fit_reply(reply, req, shape):
    """Complète la réponse d'un service pour qu'elle ait la forme de la fiche : mots ordinaires à zéro, puis les
    mots de traduction (les descripteurs des tampons de la requête recopiés, sinon des zéros)."""
    wanted_words = (shape >> 6 & 0x3F) - 1
    reply.words += [0] * (wanted_words - len(reply.words))
    deficit = (shape & 0x3F) - translate_length(reply)
    echoed = translate_length(reply) // 2
    for pos, _, _, _ in buffer_items(req)[echoed:]:
        if deficit < 2:
            break
        reply.raw(req.word(pos), req.word(pos + 1))
        deficit -= 2
    if deficit > 0:
        reply.raw(*([0] * deficit))
    return reply


def neutral_reply(req, shape, zero_outputs=True):
    """La réponse « 0 et des zéros » de la forme `shape` : les tampons que le client prête en écriture sont remis à zéro."""
    if zero_outputs:
        for _, kind, address, size in buffer_items(req):
            if kind in (0xC, 0xE) and size:
                req.memory.write(address, bytes(min(size, 0x10000)))
    return fit_reply(Reply(0), req, shape)


class Shaped(Stub):
    """Un service dont chaque commande a la forme de la fiche. `commands` : {numéro: méthode} pour celles qui font
    quelque chose ; les autres rendent `neutral_reply`."""
    kind = 'simplifié'
    shapes = {}
    commands = {}

    def handle(self, req):
        shape = self.shapes.get(req.command)
        if shape is None:
            return error(ERR_UNKNOWN_COMMAND, 'commande absente de la fiche')
        method = self.commands.get(req.command)
        reply = getattr(self, method)(req) if method else None
        reply = neutral_reply(req, shape) if reply is None else fit_reply(reply, req, shape)
        if req.command not in self.seen:
            self.seen.add(req.command)
            reply.note = (reply.note + ' ; ' if reply.note else '') + 'première fois'
        return reply

    def fail(self, code, note=''):
        return Reply(code).with_note(note or 'refusé comme le ferait le module')

    def after_ms(self, ms, callback):
        self.kernel.schedule(self.kernel.now + ms * NS_PER_MS, callback)

    def block(self, req, ms, what):
        """Le fil client attend `ms` millisecondes du banc : c'est ce que fait un module qui travaille avant de répondre."""
        self.kernel.block(req.thread, Wait('sleep', deadline=self.kernel.now + ms * NS_PER_MS, what=what))


def event(service, name, reset=Event.ONESHOT):
    return Event(service.kernel, reset, name)


# --- nwm::UDS ---

UDS_STATE_NONE, UDS_STATE_IDLE, UDS_STATE_HOST, UDS_STATE_CLIENT, UDS_STATE_SPECTATOR = 0, 3, 6, 9, 10
ERR_UDS_NOT_ALLOWED = 0xC8A113EA          # commande hors de son état
ERR_UDS_BAD_ARGUMENT = 0xE10113FD
ERR_UDS_TOO_BIG = 0xE10113E9
ERR_UDS_NO_BIND = 0xE10113EA
ERR_UDS_NO_NODE = 0xC90113FA
ERR_UDS_NO_ROOM = 0xC86113F3
ERR_UDS_REFUSED = 0xC92113FB              # connexion refusée côté client (partie 7 de la fiche)
UDS_NETWORK_SIZE = 0x108
UDS_NODE_INFO_SIZE = 0x28
UDS_MAX_FRAME = 0x5C6
UDS_MAX_APP_DATA = 0xC8
UDS_SCAN_MS = 300                         # « de l'ordre d'une fraction de seconde » (fiche nwm, partie 6)
UDS_NETWORK_MAX_NODES_OFFSET = 0x1D       # interprété : « nombre maximal de nœuds » dans la structure du réseau de 0x108 octets
# (disposition de libctru, qui retombe sur l'octet de canal à +6, l'attribut à +0x16 et l'identifiant à +0x18 de la fiche)


class Nwm(Shaped):
    """`nwm::UDS`, la communication locale sans fil. Un seul objet global, comme le module (fiche nwm, parties 3 et 6).

    Faits : l'état (3 après Initialize, 4 pendant la création, 6 hôte, 9 client, 10 spectateur), la liste des nœuds,
    le NodeInfo reçu d'Initialize, l'événement d'Initialize (signalé à la création du réseau), les Bind et leurs
    événements, un balayage qui dure UDS_SCAN_MS et ne trouve rien, tous les refus par `0xC8A113EA`. Pas fait :
    les trames (aucune console voisine), donc PullPacket ne rend jamais de trame et SendTo n'envoie nulle part ;
    ConnectNetwork refuse (aucun réseau à rejoindre).
    """
    shapes = reply_shapes.NWM_UDS
    commands = {0x01: 'initialize', 0x1B: 'initialize', 0x03: 'finalize', 0x04: 'create_network',
                0x1D: 'create_network', 0x05: 'host_only', 0x06: 'host_only', 0x07: 'host_only',
                0x08: 'destroy_network', 0x09: 'connect_network', 0x1E: 'connect_network',
                0x0A: 'disconnect_network', 0x0B: 'get_connection_status', 0x0D: 'get_node_information',
                0x0F: 'start_scan', 0x22: 'scan_on_connection', 0x10: 'set_application_data',
                0x11: 'get_application_data', 0x12: 'bind', 0x13: 'unbind', 0x14: 'pull_packet', 0x17: 'send_to',
                0x1A: 'get_channel', 0x21: 'set_probe_response_param', 0x18: 'in_idle_state',
                0x19: 'in_idle_state', 0x16: 'in_idle_state'}

    def __init__(self, bench, name='nwm::UDS'):
        super().__init__(bench, name)
        self.reset()

    def reset(self):
        self.state = UDS_STATE_NONE
        self.event = None
        self.local_node = bytes(UDS_NODE_INFO_SIZE)
        self.network = bytes(UDS_NETWORK_SIZE)
        self.channel = 0
        self.nodes = {}                  # identifiant de nœud -> NodeInfo (0x28 octets)
        self.changed = 0
        self.binds = {}                  # identifiant de Bind -> (canal de données, événement)
        self.scans = 0

    def signal(self):
        if self.event is not None:
            self.event.signal()

    def initialize(self, req):
        node = b''.join(struct.pack('<I', req.word(i)) for i in range(2, 12))
        self.reset()
        self.event = event(self, 'nwm::UDS : événement d\'Initialize')
        self.local_node = node
        self.state = UDS_STATE_IDLE
        return Reply(0).copy_handles(self.event).with_note('état 3, %s' % self.event.label())

    def finalize(self, req):
        self.reset()
        return Reply(0).with_note('état 0, événement fermé')

    def create_network(self, req):
        if self.state != UDS_STATE_IDLE:
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d au lieu de 3' % self.state)
        statics = static_items(req)
        network = req.static_data(statics[0][0]) if statics else b''
        self.network = network.ljust(UDS_NETWORK_SIZE, b'\0')[:UDS_NETWORK_SIZE]
        self.channel = self.network[6] or 1
        self.nodes = {1: self.local_node}
        self.changed = 1
        self.state = UDS_STATE_HOST
        self.signal()
        return Reply(0).with_note('hôte : état 6, nœud 1, canal %d, %d nœuds au plus' % (
            self.channel, self.network[UDS_NETWORK_MAX_NODES_OFFSET]))

    def destroy_network(self, req):
        if self.state != UDS_STATE_HOST:
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d au lieu de 6' % self.state)
        self.state = UDS_STATE_IDLE
        self.nodes, self.changed, self.channel = {}, 0, 0
        return Reply(0).with_note('état 3, événement non signalé')

    def disconnect_network(self, req):
        if self.state != UDS_STATE_NONE:
            self.state = UDS_STATE_IDLE
            self.nodes, self.changed, self.channel = {}, 0, 0
        return Reply(0).with_note('état %d' % self.state)

    def connect_network(self, req):
        if self.state != UDS_STATE_IDLE:
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d au lieu de 3' % self.state)
        return self.fail(ERR_UDS_REFUSED, 'aucun réseau à rejoindre')

    def host_only(self, req):
        if self.state != UDS_STATE_HOST:
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d au lieu de 6' % self.state)
        return Reply(0)

    def in_idle_state(self, req):
        if self.state != UDS_STATE_IDLE:
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d au lieu de 3' % self.state)
        value = req.word(1)
        if req.command == 0x18 and not 0x400 <= value * 1000 >> 10 <= 0xC400:
            return self.fail(ERR_UDS_BAD_ARGUMENT)
        if req.command == 0x19 and value >= 0x20000:
            return self.fail(ERR_UDS_BAD_ARGUMENT)
        return Reply(0)

    def set_probe_response_param(self, req):
        if self.state != UDS_STATE_IDLE:
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d au lieu de 3' % self.state)
        return Reply(0)

    def get_connection_status(self, req):
        ids = sorted(self.nodes)[:16]
        present = 0
        for node in ids:
            present |= 1 << (node - 1)
        local = 1 if self.state == UDS_STATE_HOST else 0
        data = struct.pack('<IIHH16HBBH', self.state, 0, local, self.changed,
                           *(ids + [0] * (16 - len(ids))), len(ids),
                           self.network[UDS_NETWORK_MAX_NODES_OFFSET] if self.nodes else 0, present)
        self.changed = 0
        return Reply(0, list(struct.unpack('<12I', data))).with_note('état %d, %d nœud(s)' % (self.state, len(ids)))

    def get_node_information(self, req):
        node = self.nodes.get(req.word(1) & 0xFFFF)
        if node is None:
            return self.fail(ERR_UDS_NO_NODE, 'nœud %d absent' % (req.word(1) & 0xFFFF))
        return Reply(0, list(struct.unpack('<10I', node)))

    def scan(self, req, needed):
        if self.state not in needed:
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d' % self.state)
        buffers = [b for b in buffer_items(req) if b[1] in (0xC, 0xE)]
        reply = Reply(0)
        if buffers:
            pos, _, address, size = buffers[0]
            req.memory.write(address, struct.pack('<III', size, 0xC, 0)[:size])
            reply.raw(req.word(pos), req.word(pos + 1))
        self.scans += 1
        self.block(req, UDS_SCAN_MS, 'nwm::UDS : balayage')
        return reply.with_note('balayage %d : aucune balise, %d ms' % (self.scans, UDS_SCAN_MS))

    def start_scan(self, req):
        return self.scan(req, (UDS_STATE_IDLE,))

    def scan_on_connection(self, req):
        return self.scan(req, (UDS_STATE_CLIENT, UDS_STATE_SPECTATOR))

    def set_application_data(self, req):
        if self.state != UDS_STATE_HOST:
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d au lieu de 6' % self.state)
        if req.word(1) > UDS_MAX_APP_DATA:
            return self.fail(ERR_UDS_TOO_BIG)
        return Reply(0)

    def get_application_data(self, req):
        if self.state not in (UDS_STATE_HOST, UDS_STATE_CLIENT, UDS_STATE_SPECTATOR):
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d' % self.state)
        return None

    def bind(self, req):
        node_id, size, channel = req.word(1), req.word(2), req.word(3) & 0xFF
        if channel == 0 or size == 0:
            return self.fail(ERR_UDS_NO_BIND, 'canal %d, tampon %#x' % (channel, size))
        if len(self.binds) >= 16:
            return self.fail(ERR_UDS_NO_ROOM, '16 Bind déjà')
        bind_event = event(self, 'nwm::UDS : Bind %#x canal %#x' % (node_id, channel))
        self.binds[node_id] = (channel, bind_event)
        return Reply(0).copy_handles(bind_event).with_note('canal %#x' % channel)

    def unbind(self, req):
        self.binds.pop(req.word(1), None)
        return None

    def pull_packet(self, req):
        if self.state not in (UDS_STATE_HOST, UDS_STATE_CLIENT, UDS_STATE_SPECTATOR):
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d' % self.state)
        if req.word(1) not in self.binds:
            return self.fail(ERR_UDS_NO_BIND, 'pas de Bind %#x' % req.word(1))
        return Reply(0, [0, 0]).static(0, b'').with_note('aucune trame')

    def send_to(self, req):
        if self.state not in (UDS_STATE_HOST, UDS_STATE_CLIENT):
            return self.fail(ERR_UDS_NOT_ALLOWED, 'état %d' % self.state)
        if req.word(3) > UDS_MAX_FRAME:
            return self.fail(ERR_UDS_TOO_BIG)
        return Reply(0).with_note('%d octets pour personne' % req.word(3))

    def get_channel(self, req):
        return Reply(0, [self.channel])


# --- boss:U, boss:M ---

BOSS_ERR_NO_SESSION = 0xC8A0F82B
BOSS_ERR_NO_PROGRAM = 0xC8A0F832
BOSS_ERR_NO_TASK = 0xC8A0F833
BOSS_ERR_BAD_INFO_TYPE = 0xC8A0F83F
BOSS_ERR_NO_ENTRY = 0xC8A0F842
BOSS_ERR_BAD_SIZE = 0xC960F844
BOSS_ERR_OTHER = 0xC960F84D
BOSS_ERR_BAD_TASK_PROPERTY = 0xD8E0F802
BOSS_SESSION_FREE = 0x15                  # SendPropertyHandle, la seule commande sans session
BOSS_ERROR_CODE_ABSENT = 0xB3B1           # GetErrorCode : « 0xB3B1 si absent » de la table du module
# (identifiant -> (décalage, taille maximale)) des propriétés de SendProperty (fiche boss, partie 5)
BOSS_PROPERTIES = {
    0x00: (0xC, 1), 0x01: (0xD, 1), 0x02: (0x10, 4), 0x03: (0x14, 4), 0x04: (0x18, 4), 0x05: (0xE, 1),
    0x06: (0x1C, 1), 0x07: (0x234, 512), 0x08: (0x28, 4), 0x09: (0x20, 1), 0x0A: (0x34, 256), 0x0B: (0x34, 512),
    0x0C: (0x30, 4), 0x0D: (0x434, 864), 0x0E: (0x7A0, 4), 0x0F: (0x794, 12), 0x10: (0x1E, 1), 0x11: (0x1D, 1),
    0x12: (0x1F, 1), 0x13: (0x7A4, 4), 0x14: (0x7A8, 4), 0x15: (0x7B0, 64), 0x16: (0x24, 4), 0x18: (0, 1),
    0x19: (1, 1), 0x1A: (2, 1), 0x1B: (4, 4), 0x1C: (8, 4), 0x3B: (0x2C, 4), 0x3E: (0x34, 512), 0x3F: (0x21, 1),
}
BOSS_OUTPUT_PROPERTIES = range(0x1D, 0x39)   # ReceiveProperty seulement : état de tâche, listes (décalages non repris)
BOSS_NS_INFO_SIZES = {0: 8, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 32}
BOSS_TASK_QUERY_SIZE = 0x60


class Boss(Shaped):
    """`boss:U`, les téléchargements SpotPass. Une console sans tâche reçue : listes vides, aucun NsData.

    Faits : rien ne répond sans InitializeSession (sauf SendPropertyHandle), le bloc de propriétés de chaque
    session (SendProperty puis ReceiveProperty rend ce qui a été envoyé), le refus de RegisterTask quand la
    propriété 0x06 vaut 6, 7, 8, 9 ou 0xD, la liste des tâches enregistrées, l'événement de GetTaskFinishHandle,
    le stockage (RegisterStorageEntry). Interprété : les codes d'erreur de la taille d'une propriété, de
    SetTaskQuery et de GetNsDataHeaderInfo sans NsData ; la table de GetErrorCode n'est pas reprise (0xB3B1).
    """
    shapes = reply_shapes.BOSS_U
    commands = {0x01: 'initialize_session', 0x03: 'unregister_storage', 0x0B: 'register_task',
                0x35: 'register_task', 0x0C: 'unregister_task', 0x14: 'send_property', 0x15: 'send_property_handle',
                0x16: 'receive_property', 0x1F: 'get_task_finish_handle', 0x27: 'get_ns_data_header_info',
                0x2E: 'get_error_code', 0x2F: 'register_storage_entry', 0x30: 'get_storage_entry_info',
                0x36: 'set_task_query'}

    def __init__(self, bench, name='boss:U'):
        super().__init__(bench, name)
        self.sessions = {}               # session -> {'properties': {...}}
        self.tasks = set()
        self.storage = False
        self.finish_event = event(self, 'boss : fin de tâche')

    def on_session_closed(self, session):
        self.sessions.pop(session, None)

    def handle(self, req):
        if req.command in self.shapes and req.command not in (0x01, BOSS_SESSION_FREE) \
                and req.session not in self.sessions:
            reply = fit_reply(self.fail(BOSS_ERR_NO_SESSION, 'InitializeSession pas faite'), req,
                              self.shapes[req.command])
            return reply
        return super().handle(req)

    def initialize_session(self, req):
        self.sessions.setdefault(req.session, {'properties': {}})
        pids = [item[1] for item in req.items.values() if item[0] == 'pid']
        return Reply(0).with_note('session ouverte, processus %#x' % (pids[0] if pids else 0))

    def properties(self, req):
        return self.sessions[req.session]['properties']

    def send_property(self, req):
        entry = BOSS_PROPERTIES.get(req.word(1))
        if entry is None:
            return self.fail(BOSS_ERR_OTHER, 'propriété %#x inconnue' % req.word(1))
        buffers = buffer_items(req)
        data = b''
        if buffers:
            data = req.memory.read(buffers[0][2], min(buffers[0][3], req.word(2), entry[1]))
        self.properties(req)[req.word(1)] = data
        return Reply(0).raw(req.word(3), req.word(4)).with_note('propriété %#x : %d octets' % (req.word(1), len(data)))

    def send_property_handle(self, req):
        if req.word(1) != 0x0C:
            return self.fail(BOSS_ERR_OTHER, 'seule la propriété 0x0C prend une poignée')
        return Reply(0)

    def receive_property(self, req):
        prop = req.word(1)
        if prop not in BOSS_PROPERTIES and prop not in BOSS_OUTPUT_PROPERTIES:
            return self.fail(BOSS_ERR_OTHER, 'propriété %#x inconnue' % prop)
        buffers = buffer_items(req)
        reply = Reply(0, [0])
        if buffers:
            pos, _, address, size = buffers[0]
            data = self.properties(req).get(prop, b'')[:size].ljust(size, b'\0')
            req.memory.write(address, data)
            reply.words = [size]
            reply.raw(req.word(pos), req.word(pos + 1))
        return reply

    def task_key(self, req):
        reads = [b for b in buffer_items(req) if b[1] in (0xA, 0xE)]
        return req.memory.read(reads[0][2], min(reads[0][3], 8)) if reads else b''

    def register_task(self, req):
        value = self.properties(req).get(0x06, b'')[:1]
        if value and value[0] in (6, 7, 8, 9, 0xD):
            return self.fail(BOSS_ERR_BAD_TASK_PROPERTY, 'propriété 0x06 = %d' % value[0])
        self.tasks.add(self.task_key(req))
        return None

    def unregister_task(self, req):
        key = self.task_key(req)
        if key not in self.tasks:
            return self.fail(BOSS_ERR_NO_TASK, 'tâche inconnue')
        self.tasks.discard(key)
        return None

    def unregister_storage(self, req):
        if not self.storage:
            return self.fail(BOSS_ERR_NO_ENTRY, 'stockage jamais enregistré')
        self.storage = False
        return None

    def register_storage_entry(self, req):
        self.storage = True
        return None

    def get_storage_entry_info(self, req):
        if not self.storage:
            return self.fail(BOSS_ERR_NO_ENTRY, 'stockage jamais enregistré')
        return None

    def get_task_finish_handle(self, req):
        return Reply(0).copy_handles(self.finish_event)

    def get_error_code(self, req):
        return Reply(0, [BOSS_ERROR_CODE_ABSENT])

    def get_ns_data_header_info(self, req):
        kind, size = req.word(2), req.word(3)
        if kind not in BOSS_NS_INFO_SIZES:
            return self.fail(BOSS_ERR_BAD_INFO_TYPE, 'type %d' % kind)
        if size != BOSS_NS_INFO_SIZES[kind]:
            return self.fail(BOSS_ERR_BAD_SIZE, 'taille %d pour le type %d' % (size, kind))
        return self.fail(BOSS_ERR_NO_PROGRAM, 'aucun NsData')

    def set_task_query(self, req):
        if req.word(2) != BOSS_TASK_QUERY_SIZE:
            return self.fail(BOSS_ERR_OTHER, 'requête de %#x octets au lieu de 0x60' % req.word(2))
        return None


class BossManagement(Shaped):
    """`boss:M` (appelé par `ndm`) : la commande 3 ne compare que son numéro (fiche boss, « Écarts avec la Carte »)."""
    shapes = reply_shapes.BOSS_M


# --- ssl:C ---

class Ssl(Shaped):
    """`ssl:C`. Trois commandes (Initialize, SeedRNG, GenerateRandomData), le reste est « commande inconnue »
    (fiche ssl, partie 6). Les octets aléatoires sont vrais ; avec `options['seed']` ils se répètent d'une
    exécution à l'autre."""
    kind = 'réel'
    shapes = {n: s for n, s in reply_shapes.SSL_C.items() if n in (0x01, 0x10, 0x11)}
    commands = {0x11: 'generate_random_data'}

    def __init__(self, bench, name='ssl:C'):
        super().__init__(bench, name)
        seed = bench.options.get('seed')
        self.rng = random.Random(seed) if seed is not None else random.SystemRandom()
        self.generated = 0

    def generate_random_data(self, req):
        buffers = [b for b in buffer_items(req) if b[1] in (0xC, 0xE)]
        reply = Reply(0)
        if not buffers:
            return self.fail(0xE0E0B7F6, 'pas de tampon de sortie')
        pos, _, address, size = buffers[0]
        count = min(req.word(1), size)
        req.memory.write(address, self.rng.randbytes(count))
        self.generated += count
        return reply.raw(req.word(pos), req.word(pos + 1)).with_note('%d octets aléatoires' % count)


# --- cecd:u ---

ERR_CEC_BLOCKED = 0xC8A10BF0
ERR_FILE_NOT_FOUND = 0xC8804470
CEC_READ, CEC_WRITE, CEC_CREATE = 1, 2, 4
CEC_PATH_NAMES = {1: ('MBoxList____',), 2: ('{box}', 'MBoxInfo____'), 3: ('{box}', 'InBox___', 'BoxInfo_____'),
                  4: ('{box}', 'OutBox__', 'BoxInfo_____'), 5: ('{box}', 'OutBox__', 'OBIndex_____'),
                  6: ('{box}', 'InBox___', '_{message}'), 7: ('{box}', 'OutBox__', '_{message}'), 10: (),
                  11: ('{box}',), 12: ('{box}', 'InBox___'), 13: ('{box}', 'OutBox__')}
CEC_DIRECTORY_TYPES = (10, 11, 12, 13)


class Cecd(Shaped):
    """`cecd:u`, StreetPass. La réception reste factice (aucune boîte ne se remplit, l'état est « inactif », les
    événements ne sont jamais signalés) ; le système de fichiers est vrai (fiche cecd, partie 6) : les fichiers de
    `data:/CEC/` sont écrits dans `<sortie>/archives/cec/`, dans un dossier par identifiant de boîte, et relus.

    Interprété : la place des mots de chaque requête (d'après les en-têtes de la fiche et l'organisation de CECD
    chez 3dbrew et Citra), le nom du fichier d'un message (son identifiant en hexadécimal).
    """
    shapes = reply_shapes.CECD_U
    commands = {0x01: 'open_raw_file', 0x02: 'read_raw_file', 0x03: 'read_message', 0x04: 'read_message',
                0x05: 'write_raw_file', 0x06: 'write_message', 0x07: 'write_message', 0x08: 'delete',
                0x0E: 'get_state', 0x0F: 'get_event', 0x10: 'get_event', 0x11: 'open_and_write',
                0x12: 'open_and_read'}

    def __init__(self, bench, name='cecd:u'):
        super().__init__(bench, name)
        self.root = os.path.join(bench.paths['archives'], 'cec')
        self.opened = {}                 # session -> [chemin, position]
        self.events = {}
        self.next_message = 1

    def path(self, box, path_type, message=b''):
        if path_type >= 100:
            parts = ('{box}', 'MBoxData.%03d' % (path_type - 100))
        else:
            parts = CEC_PATH_NAMES.get(path_type)
        if parts is None:
            return None
        names = [p.format(box='%08x' % box, message=message.hex().upper()) for p in parts]
        return os.path.join(self.root, *names)

    def read_buffer(self, req, index=0):
        reads = [b for b in buffer_items(req) if b[1] in (0xA, 0xE)]
        if index >= len(reads):
            return b''
        return req.memory.read(reads[index][2], reads[index][3])

    def write_buffer(self, req):
        writes = [b for b in buffer_items(req) if b[1] in (0xC, 0xE)]
        return writes[-1] if writes else None

    def echo(self, req, reply):
        for pos, _, _, _ in buffer_items(req):
            reply.raw(req.word(pos), req.word(pos + 1))
        return reply

    def open_raw_file(self, req):
        box, path_type, mode = req.word(1), req.word(2), req.word(3)
        message = req.static_data(4) if 4 in req.items else b''
        path = self.path(box, path_type, message)
        if path is None:
            return self.fail(ERR_CEC_BLOCKED, 'type de chemin %d inconnu' % path_type)
        if path_type in CEC_DIRECTORY_TYPES:
            if mode & CEC_CREATE:
                os.makedirs(path, exist_ok=True)
            elif not os.path.isdir(path):
                return self.fail(ERR_FILE_NOT_FOUND, 'dossier absent')
            self.opened[req.session] = [path, 0]
            return Reply(0, [0]).with_note('dossier %s' % os.path.basename(path))
        if not os.path.isfile(path):
            if not mode & CEC_CREATE:
                return self.fail(ERR_FILE_NOT_FOUND, 'fichier absent')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, 'wb').close()
        self.opened[req.session] = [path, 0]
        return Reply(0, [os.path.getsize(path)]).with_note('ouvert : %s' % os.path.relpath(path, self.root))

    def read_raw_file(self, req):
        entry = self.opened.get(req.session)
        out = self.write_buffer(req)
        if entry is None or out is None or not os.path.isfile(entry[0]):
            return self.fail(ERR_FILE_NOT_FOUND, 'aucun fichier ouvert')
        with open(entry[0], 'rb') as f:
            f.seek(entry[1])
            data = f.read(min(req.word(1), out[3]))
        entry[1] += len(data)
        req.memory.write(out[2], data)
        return self.echo(req, Reply(0, [len(data)]))

    def write_raw_file(self, req):
        entry = self.opened.get(req.session)
        if entry is None or os.path.isdir(entry[0]):
            return self.fail(ERR_FILE_NOT_FOUND, 'aucun fichier ouvert')
        data = self.read_buffer(req)[:req.word(1)]
        with open(entry[0], 'r+b') as f:
            f.seek(entry[1])
            f.write(data)
        entry[1] += len(data)
        return self.echo(req, Reply(0)).with_note('%d octets écrits' % len(data))

    def message_path(self, req, message):
        return self.path(req.word(1), 7 if req.word(2) else 6, message)

    def read_message(self, req):
        message = self.read_buffer(req, 0)[:req.word(3) or 8]
        out = self.write_buffer(req)
        path = self.message_path(req, message)
        if out is None or not os.path.isfile(path):
            return self.fail(ERR_FILE_NOT_FOUND, 'message %s absent' % message.hex())
        data = open(path, 'rb').read()[:min(req.word(4), out[3])]
        req.memory.write(out[2], data)
        return self.echo(req, Reply(0, [len(data)])).with_note('message %s : %d octets' % (message.hex(), len(data)))

    def write_message(self, req):
        reads = [b for b in buffer_items(req)]
        data = self.read_buffer(req, 0)[:req.word(4)]
        message = self.read_buffer(req, 1)[:req.word(3) or 8]
        if not message.strip(b'\0'):
            message = struct.pack('>Q', self.next_message)
            self.next_message += 1
            id_buffer = reads[1] if len(reads) > 1 else None
            if id_buffer and id_buffer[1] in (0xC, 0xE):
                req.memory.write(id_buffer[2], message[:id_buffer[3]])
        path = self.message_path(req, message)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)
        return self.echo(req, Reply(0)).with_note('message %s : %d octets' % (message.hex(), len(data)))

    def delete(self, req):
        message = self.read_buffer(req, 0)[:req.word(4) or 8]
        path = self.path(req.word(1), req.word(2), message)
        if path is None or not os.path.exists(path):
            return self.fail(ERR_FILE_NOT_FOUND, 'rien à effacer')
        shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
        return self.echo(req, Reply(0))

    def open_and_write(self, req):
        path = self.path(req.word(2), req.word(3))
        if path is None:
            return self.fail(ERR_CEC_BLOCKED, 'type de chemin %d inconnu' % req.word(3))
        data = self.read_buffer(req, 0)[:req.word(1)]
        os.makedirs(os.path.dirname(path) if req.word(3) not in CEC_DIRECTORY_TYPES else path, exist_ok=True)
        if req.word(3) not in CEC_DIRECTORY_TYPES:
            with open(path, 'wb') as f:
                f.write(data)
        return self.echo(req, Reply(0)).with_note('%d octets dans %s' % (len(data), os.path.relpath(path, self.root)))

    def open_and_read(self, req):
        path = self.path(req.word(2), req.word(3))
        out = self.write_buffer(req)
        if path is None or out is None or not os.path.isfile(path):
            return self.fail(ERR_FILE_NOT_FOUND, 'fichier absent')
        data = open(path, 'rb').read()[:min(req.word(1), out[3])]
        req.memory.write(out[2], data)
        return self.echo(req, Reply(0, [len(data)])).with_note('%d octets de %s' % (
            len(data), os.path.relpath(path, self.root)))

    def get_state(self, req):
        return Reply(0, [1]).with_note('inactif')

    def get_event(self, req):
        ev = self.events.setdefault(req.command, event(self, 'cecd : événement %#x' % req.command))
        return Reply(0).copy_handles(ev)


# --- cam:u ---

CAM_ERR_BAD_SIZE = 0xE0E053FD
CAM_ERR_BAD_PORT = 0xE0E053ED
CAM_TRANSFER_MAX = 0x1400


class Camera(Shaped):
    """`cam:u`. Pas de capteur : les réglages sont acceptés, les poignées d'événement sont vraies (celles de
    synchro verticale et d'erreur ne sont jamais signalées ; celle de SetReceiving l'est 33 ms plus tard, sans
    image écrite), GetMaxLines et GetMaxBytes suivent les formules du module (fiche camera, partie « cam:u »)."""
    shapes = reply_shapes.CAM_U
    commands = {0x05: 'port_event', 0x06: 'port_event', 0x07: 'set_receiving', 0x0A: 'get_max_lines',
                0x0C: 'get_transfer_bytes', 0x0B: 'set_transfer_bytes', 0x0D: 'get_max_bytes',
                0x13: 'activate', 0x36: 'one', 0x3B: 'get_activated', 0x3C: 'get_sleep', 0x3D: 'set_sleep'}

    def __init__(self, bench, name='cam:u'):
        super().__init__(bench, name)
        self.events = {}
        self.transfer_bytes = {1: 0, 2: 0}
        self.activated = 0
        self.sleeping = 0

    def port_event(self, req):
        port = req.word(1) & 0xFF
        if port not in (1, 2):
            return self.fail(CAM_ERR_BAD_PORT, 'port %d' % port)
        ev = self.events.setdefault((req.command, port), event(self, 'cam : événement %#x du port %d' % (
            req.command, port)))
        return Reply(0).copy_handles(ev)

    def set_receiving(self, req):
        ev = event(self, 'cam : image reçue')
        self.after_ms(33, ev.signal)
        return Reply(0).copy_handles(ev).with_note('événement signalé dans 33 ms, aucune image écrite')

    @staticmethod
    def sizes_ok(width, height):
        return width > 0 and height > 0 and width * height % 128 == 0

    def get_max_lines(self, req):
        width, height = req.word(1) & 0xFFFF, req.word(2) & 0xFFFF
        if not self.sizes_ok(width, height):
            return self.fail(CAM_ERR_BAD_SIZE)
        best = 0
        for lines in range(1, height + 1):
            if height % lines == 0 and lines * width % 128 == 0 and lines * width * 2 <= CAM_TRANSFER_MAX:
                best = lines
        return Reply(0, [best])

    def get_max_bytes(self, req):
        width, height = req.word(1) & 0xFFFF, req.word(2) & 0xFFFF
        if not self.sizes_ok(width, height):
            return self.fail(CAM_ERR_BAD_SIZE)
        best = 0
        for size in range(0x100, CAM_TRANSFER_MAX + 1, 0x100):
            if 2 * width * height % size == 0:
                best = size
        return Reply(0, [best])

    def set_transfer_bytes(self, req):
        self.transfer_bytes[req.word(2) & 0xFF] = req.word(1) & 0xFFFF
        return None

    def get_transfer_bytes(self, req):
        return Reply(0, [self.transfer_bytes.get(req.word(1) & 0xFF, 0)])

    def activate(self, req):
        self.activated = req.word(1) & 7
        return None

    def get_activated(self, req):
        return Reply(0, [self.activated])

    def get_sleep(self, req):
        return Reply(0, [self.sleeping])

    def set_sleep(self, req):
        self.sleeping = req.word(1) & 7
        return None

    def one(self, req):
        return Reply(0, [1])


# --- mic:u ---

MIC_PAGE_UNIT = 0x1000
MIC_RATES = {0: 32728.5, 1: 16364.0, 2: 10909.0, 3: 8182.0}
MIC_TICK_MS = 10
MIC_DEFAULT_GAIN = 0x40                  # arbitraire : le jeu ne fait que le garder pour le rétablir


class Mic(Shaped):
    """`mic:u`. Le micro entend le silence : la page partagée est remplie d'échantillons à zéro, au rythme choisi,
    et le mot de fin (dernier mot de la page) avance à chaque tranche de 10 ms du banc. Interprété : le gain de
    départ (le jeu ne le lit que pour le rétablir)."""
    shapes = reply_shapes.MIC_U
    commands = {0x01: 'map_shared_mem', 0x02: 'unmap_shared_mem', 0x03: 'start_sampling', 0x05: 'stop_sampling',
                0x06: 'is_sampling', 0x07: 'get_event', 0x08: 'set_gain', 0x09: 'get_gain', 0x0A: 'set_power',
                0x0B: 'get_power', 0x0D: 'set_clamp', 0x0E: 'get_clamp'}

    def __init__(self, bench, name='mic:u'):
        super().__init__(bench, name)
        self.page = None
        self.sampling = False
        self.gain, self.power, self.clamp = MIC_DEFAULT_GAIN, 0, 1
        self.event = event(self, 'mic : tampon plein', Event.STICKY)
        self.run = 0                      # numéro de la prise de son en cours (annule les tranches d'une ancienne)
        self.written = 0

    def map_shared_mem(self, req):
        size = req.word(1)
        if self.page is not None:
            return self.fail(0xD8208FF9, 'déjà projeté')
        if size == 0:
            return self.fail(0xE0E08FEC)
        if size & 1:
            return self.fail(0xE0E08FF2)
        if size % MIC_PAGE_UNIT:
            return self.fail(0xE0E01BF2)
        objects = [o for o in handle_objects(req) if isinstance(o, SharedMemory)]
        if not objects:
            return self.fail(0xD8E007F7, 'pas de bloc partagé')
        self.page = objects[0]
        self.page_size = size
        self.page.write(size - 4, bytes(4))
        return Reply(0).with_note('page de %#x octets' % size)

    def unmap_shared_mem(self, req):
        if self.page is None:
            return self.fail(0xD8208FF8, 'pas projeté')
        self.page = None
        return None

    def start_sampling(self, req):
        if self.page is None:
            return self.fail(0xD8208FF8, 'pas projeté')
        encoding, rate, offset, size, loop = req.word(1) & 0xFF, req.word(2) & 0xFF, req.word(3), req.word(4), \
            req.word(5) & 0xFF
        if offset + size > self.page_size - 4:
            return self.fail(0xE1008FFD, 'décalage %#x + taille %#x' % (offset, size))
        self.sampling = True
        self.run += 1
        self.written = 0
        self.event.clear()
        self.after_ms(MIC_TICK_MS, lambda run=self.run: self.tick(run, offset, size, loop, MIC_RATES.get(rate, 8182.0),
                                                                 0.0))
        return Reply(0).with_note('codage %d, %.0f Hz, anneau %#x+%#x' % (encoding, MIC_RATES.get(rate, 8182.0),
                                                                          offset, size))

    def tick(self, run, offset, size, loop, rate, carry):
        if run != self.run or not self.sampling or self.page is None:
            return
        carry += rate * MIC_TICK_MS / 1000
        count = int(carry)
        carry -= count
        wanted = count * 2
        if not loop and self.written + wanted > size:
            wanted = size - self.written
        position = self.written
        while wanted > 0:
            chunk = min(wanted, size - position % size)
            self.page.write(offset + position % size, bytes(chunk))
            position += chunk
            wanted -= chunk
        self.written = position
        if self.written:
            last = offset + (self.written - 2) % size
            self.page.write(self.page_size - 4, struct.pack('<I', last))
        if not loop and self.written >= size:
            self.sampling = False
            self.event.signal()
            return
        self.after_ms(MIC_TICK_MS, lambda: self.tick(run, offset, size, loop, rate, carry))

    def stop_sampling(self, req):
        self.sampling = False
        return None

    def is_sampling(self, req):
        return Reply(0, [1 if self.sampling else 0])

    def get_event(self, req):
        return Reply(0).copy_handles(self.event)

    def set_gain(self, req):
        self.gain = req.word(1) & 0xFF
        return None

    def get_gain(self, req):
        return Reply(0, [self.gain])

    def set_power(self, req):
        self.power = req.word(1) & 0xFF
        return None

    def get_power(self, req):
        return Reply(0, [self.power])

    def set_clamp(self, req):
        self.clamp = req.word(1) & 0xFF
        return None

    def get_clamp(self, req):
        return Reply(0, [self.clamp])


# --- ir:USER ---

IR_ERR_NOT_NOW = 0xC8A10C0D              # tolérée par le jeu
IR_ERR_BUSY = 0xC8A10C0C
IR_ERR_NOT_INITIALIZED = 0xD8210FF8
IR_LINK_OFFSET = 8
IR_RING_HEADER = 0x10


class IrUser(Shaped):
    """`ir:USER`, sans partenaire infrarouge (fiche ir, parties 5 et 9). La page partagée est vraie : en-tête (liaison
    0, octet +0xE à 1), deux anneaux vides ; AutoConnection laisse la liaison à 1, Disconnect la remet à 0 en
    levant l'événement d'état ; rien n'arrive jamais ; les envois répondent `0xC8A10C0D` (liaison pas à 2)."""
    shapes = reply_shapes.IR_USER
    commands = {0x18: 'initialize_shared', 0x02: 'finalize', 0x03: 'need_connected', 0x04: 'need_connected',
                0x05: 'start_connecting', 0x06: 'start_connecting', 0x07: 'start_connecting',
                0x08: 'start_connecting', 0x09: 'disconnect', 0x0A: 'get_event', 0x0B: 'get_event',
                0x0C: 'get_event', 0x0D: 'send', 0x0E: 'send', 0x11: 'latest_error', 0x12: 'latest_error',
                0x13: 'get_link', 0x15: 'ring_sizes', 0x16: 'ring_sizes', 0x19: 'release_received',
                0x1A: 'set_machine_id'}

    def __init__(self, bench, name='ir:USER'):
        super().__init__(bench, name)
        self.page = None
        self.link = 0
        self.events = {}
        self.sizes = (0, 0, 0, 0, 0)       # taille de la page, de l'anneau de réception, ses cases, idem pour l'envoi

    def set_link(self, value):
        self.link = value
        if self.page is not None:
            self.page.write(IR_LINK_OFFSET, bytes([value]))

    def initialize_shared(self, req):
        objects = [o for o in handle_objects(req) if isinstance(o, SharedMemory)]
        if not objects:
            return self.fail(0xD8E007F7, 'pas de page partagée')
        self.page = objects[0]
        size, recv, recv_slots, send, send_slots = [req.word(i) for i in range(1, 6)]
        self.sizes = (size, recv, recv_slots, send, send_slots)
        self.page.write(0, bytes(0x40))
        self.page.write(0xE, bytes([1]))
        self.events = {n: event(self, 'ir : %s' % n) for n in ('réception', 'envoi', 'état de la liaison')}
        self.set_link(0)
        return Reply(0).with_note('page %#x, réception %d/%d, envoi %d/%d' % (size, recv, recv_slots, send, send_slots))

    def finalize(self, req):
        if self.page is None:
            return self.fail(IR_ERR_NOT_INITIALIZED)
        self.page = None
        self.link = 0
        return None

    def need_connected(self, req):
        return None if self.link == 2 else self.fail(IR_ERR_NOT_NOW, 'liaison %d' % self.link)

    def start_connecting(self, req):
        if self.link in (1, 2):
            return self.fail(IR_ERR_BUSY, 'liaison %d' % self.link)
        self.set_link(1)
        if self.page is not None:
            self.page.write(0xC, bytes([req.word(1) & 0xFF]))
        return Reply(0).with_note('liaison à 1 : on cherche un partenaire')

    def disconnect(self, req):
        if self.link not in (1, 2):
            return self.fail(IR_ERR_NOT_NOW, 'liaison %d' % self.link)
        self.set_link(0)
        if 'état de la liaison' in self.events:
            self.events['état de la liaison'].signal()
        return Reply(0).with_note('liaison à 0')

    def get_event(self, req):
        name = {0x0A: 'réception', 0x0B: 'envoi', 0x0C: 'état de la liaison'}[req.command]
        if name not in self.events:
            self.events[name] = event(self, 'ir : %s' % name)
        return Reply(0).copy_handles(self.events[name])

    def send(self, req):
        return None if self.link == 2 else self.fail(IR_ERR_NOT_NOW, 'liaison %d' % self.link)

    def latest_error(self, req):
        offset = 0 if req.command == 0x11 else 4
        value = struct.unpack('<I', self.page.read(offset, 4))[0] if self.page else 0
        if req.word(1) and self.page:
            self.page.write(offset, bytes(4))
        return Reply(0, [value])

    def get_link(self, req):
        return Reply(0, [self.link])

    def ring_sizes(self, req):
        _, recv, recv_slots, send, send_slots = self.sizes
        free, slots = (recv, recv_slots) if req.command == 0x15 else (send, send_slots)
        return Reply(0, [max(free - IR_RING_HEADER, 0), slots, 0, 0])

    def release_received(self, req):
        return self.fail(IR_ERR_NOT_NOW, 'rien à rendre')

    def set_machine_id(self, req):
        if self.link not in (1, 2):
            return self.fail(IR_ERR_BUSY, 'liaison %d' % self.link)
        return None


# --- ndm:u ---

NDM_ERR_ALREADY_EXCLUSIVE = 0xC8A06811
NDM_ERR_NOT_SUSPENDED = 0xC8A0680D
NDM_ERR_BAD_MASK = 0xD8E06BED


class Ndm(Shaped):
    """`ndm:u`, l'état exclusif et la suspension des démons. Le module n'envoie jamais de poignée à Pokémon X : rien à
    créer. L'état exclusif est gardé (Enter deux fois de suite refuse, Query le rend) ; chaque session retient ce
    qu'elle a suspendu."""
    shapes = reply_shapes.NDM_U
    commands = {0x01: 'enter_exclusive', 0x02: 'leave_exclusive', 0x03: 'query_exclusive', 0x06: 'suspend_daemons',
                0x07: 'resume_daemons', 0x08: 'suspend_scheduler', 0x09: 'resume_scheduler'}

    def __init__(self, bench, name='ndm:u'):
        super().__init__(bench, name)
        self.exclusive = None
        self.suspended = {}               # session -> masque des démons suspendus
        self.scheduler = set()

    def enter_exclusive(self, req):
        if self.exclusive is not None:
            return self.fail(NDM_ERR_ALREADY_EXCLUSIVE, 'déjà dans l\'état %d' % self.exclusive)
        self.exclusive = req.word(1)
        return Reply(0).with_note('état exclusif %d' % self.exclusive)

    def leave_exclusive(self, req):
        self.exclusive = None
        return None

    def query_exclusive(self, req):
        return Reply(0, [self.exclusive or 0])

    def suspend_daemons(self, req):
        mask = req.word(1)
        if not 1 <= mask <= 15:
            return self.fail(NDM_ERR_BAD_MASK, 'masque %#x' % mask)
        self.suspended[req.session] = self.suspended.get(req.session, 0) | mask
        return None

    def resume_daemons(self, req):
        mask = req.word(1)
        held = self.suspended.get(req.session, 0)
        if not 1 <= mask <= 15:
            return self.fail(NDM_ERR_BAD_MASK, 'masque %#x' % mask)
        if mask & ~held:
            return self.fail(NDM_ERR_NOT_SUSPENDED, 'masque %#x, suspendus par la session : %#x' % (mask, held))
        self.suspended[req.session] = held & ~mask
        return None

    def suspend_scheduler(self, req):
        self.scheduler.add(req.session)
        return None

    def resume_scheduler(self, req):
        if req.session not in self.scheduler:
            return self.fail(NDM_ERR_NOT_SUSPENDED, 'planificateur pas suspendu')
        self.scheduler.discard(req.session)
        return None

    def on_session_closed(self, session):
        self.suspended.pop(session, None)
        self.scheduler.discard(session)


# --- ac:u ---

AC_ERR_BAD_ARGUMENT = 0xE0409FFF
AC_ERR_BUSY = 0xE0A09FFC
AC_ERR_WAITING = 0xE1209C46               # le résultat tant que la connexion dure
AC_ERR_OFFLINE = 0xE0A09D2E               # GetWifiStatus et GetCurrentAPInfo hors ligne
AC_CONNECT_MS = 50
AC_CONFIG_SIZE = 0x200


def default_ac_config():
    config = bytearray(AC_CONFIG_SIZE)
    config[0] = 0xBF
    config[8:14] = b'\xFF' * 6
    return bytes(config)


class Ac(Shaped):
    """`ac:u`, la connexion à internet, hors ligne (fiche ac, parties 4 et 9) : les réglages passent par la
    configuration de 0x200 octets que le jeu garde lui-même, ConnectAsync rend 0 puis signale l'événement donné
    50 ms plus tard, GetConnectResult rend alors un échec ; GetWifiStatus et GetCurrentAPInfo rendent `0xE0A09D2E` ;
    IsConnected 0. Interprété : le code de l'échec de la connexion (la fiche n'a pas lu ce que `connect_to_ap`
    rend quand le Wi-Fi est coupé), pris égal à celui de GetWifiStatus."""
    shapes = reply_shapes.AC_U
    commands = {0x01: 'create_default_config', 0x04: 'connect_async', 0x05: 'get_connect_result',
                0x08: 'close_async', 0x0D: 'offline', 0x0E: 'offline', 0x24: 'add_deny_ap_type',
                0x27: 'get_infra_priority', 0x2D: 'set_request_eula_version'}

    def __init__(self, bench, name='ac:u'):
        super().__init__(bench, name)
        self.connect_result = {}          # session -> résultat
        self.disconnect_event = {}

    def create_default_config(self, req):
        return Reply(0).static(0, default_ac_config())

    def config_in(self, req):
        statics = static_items(req)
        return bytearray(req.static_data(statics[0][0]).ljust(AC_CONFIG_SIZE, b'\0')) if statics else None

    def get_infra_priority(self, req):
        config = self.config_in(req)
        if config is None:
            return self.fail(AC_ERR_BAD_ARGUMENT)
        return Reply(0, [config[6]])

    def set_request_eula_version(self, req):
        config = self.config_in(req)
        if config is None:
            return self.fail(AC_ERR_BAD_ARGUMENT)
        config[0x1B], config[0x1A] = req.word(1) & 0xFF, req.word(2) & 0xFF
        return Reply(0).static(0, bytes(config))

    def add_deny_ap_type(self, req):
        config = self.config_in(req)
        if config is None:
            return self.fail(AC_ERR_BAD_ARGUMENT)
        mask = struct.unpack_from('<I', config, 0)[0] & ~req.word(1) & 0xFFFFFFFF
        struct.pack_into('<I', config, 0, mask)
        return Reply(0).static(0, bytes(config))

    def connect_async(self, req):
        config = self.config_in(req)
        events = [o for o in handle_objects(req) if isinstance(o, Event)]
        if config is None or not events:
            return self.fail(AC_ERR_BAD_ARGUMENT)
        if struct.unpack_from('<I', config, 0)[0] >= 0x80000000 or config[4] >= 3 or config[6] >= 3 or config[7] >= 7:
            return self.fail(AC_ERR_BAD_ARGUMENT, 'configuration refusée')
        if self.connect_result.get(req.session) == AC_ERR_WAITING:
            return self.fail(AC_ERR_BUSY, 'une connexion est déjà en cours')
        self.connect_result[req.session] = AC_ERR_WAITING
        session, done = req.session, events[0]

        def finish():
            self.connect_result[session] = AC_ERR_OFFLINE
            done.signal()
        self.after_ms(AC_CONNECT_MS, finish)
        return Reply(0).with_note('hors ligne : l\'événement sera signalé dans %d ms, avec un échec' % AC_CONNECT_MS)

    def get_connect_result(self, req):
        return Reply(self.connect_result.get(req.session, 0)).with_note('connexion')

    def close_async(self, req):
        events = [o for o in handle_objects(req) if isinstance(o, Event)]
        if events:
            self.after_ms(10, events[0].signal)
        self.connect_result.pop(req.session, None)
        return None

    def offline(self, req):
        return self.fail(AC_ERR_OFFLINE, 'hors ligne')


# --- frd:u ---

FRD_PRINCIPAL_ID = 0x0BEC0DE1            # une identité fabriquée pour le banc (jamais celle d'une console)
FRD_ERR_NOT_CONNECTED = 0xD8A0C402
FRD_ERR_NO_RESULT = 0xC8A0C7EF
FRD_ERR_NO_MII = 0xD8A0C4F8
FRD_ERR_REFUSED = 0xC8A0C7EA
FRD_MODULE = 0x31


def friend_code(principal_id):
    """Le code d'ami : l'identifiant en bas, l'octet de tête du SHA-1 de l'identifiant (4 octets, petit-boutiste)
    décalé d'un bit à droite en haut (fiche friends, partie 5)."""
    digest = hashlib.sha1(struct.pack('<I', principal_id)).digest()
    return principal_id | (digest[0] >> 1) << 32


def result_to_error_code(result):
    """(résultat de la commande, code d'erreur) pour un résultat reçu (fiche friends, partie 5)."""
    module, description, negative = result >> 10 & 0xFF, result & 0x3FF, result & 0x80000000
    if module != FRD_MODULE:
        return 0xE0E0C403, 0
    if not negative:
        return 0, 0
    if description == 0x101:
        return 0, 23000
    q, r = description >> 5, description & 0x1F
    return 0, 0 if q in (0, 0x1F) else 10000 + 100 * q + r


class Friends(Shaped):
    """`frd:u`, hors ligne et sans ami (fiche friends, partie 9). Vrai : l'identité locale (identifiant principal non
    nul et son code d'ami), le nom d'écran, ResultToErrorCode. Neutre : liste d'amis vide, présence nulle, mot de
    passe vide. Échec : tout ce qui touche un serveur. Login signale tout de suite l'événement et HasLoggedIn rend 0.
    Interprété : les codes d'échec des demandes de serveur (la fiche ne dit que « un résultat négatif »)."""
    shapes = reply_shapes.FRD_U
    commands = {0x03: 'login', 0x05: 'get_my_friend_key', 0x08: 'zeros_in_buffer', 0x09: 'get_my_screen_name',
                0x10: 'zeros_in_buffer', 0x17: 'zeros_in_buffer', 0x1C: 'zeros_in_buffer', 0x11: 'friend_key_list',
                0x23: 'last_response_result', 0x27: 'result_to_error_code', 0x28: 'not_connected',
                0x29: 'no_result', 0x2A: 'not_connected', 0x2B: 'no_result', 0x2E: 'not_connected',
                0x33: 'no_mii', 0x34: 'refused'}

    def __init__(self, bench, name='frd:u'):
        super().__init__(bench, name)
        self.last = {}                    # session -> dernier résultat

    def after_reply(self, req, reply):
        if req.command != 0x23:
            self.last[req.session] = reply.result

    def login(self, req):
        for obj in handle_objects(req):
            if isinstance(obj, Event):
                obj.signal()
        return Reply(0).with_note('hors ligne : connexion « finie » tout de suite, HasLoggedIn restera à 0')

    def get_my_friend_key(self, req):
        code = friend_code(FRD_PRINCIPAL_ID)
        return Reply(0, [FRD_PRINCIPAL_ID, 0, code & 0xFFFFFFFF, code >> 32])

    def get_my_screen_name(self, req):
        name = 'Banc'.encode('utf-16-le').ljust(24, b'\0')
        return Reply(0, list(struct.unpack('<6I', name)))

    def zeros_in_buffer(self, req):
        _, room = req.receive_buffer(0)
        return Reply(0).static(0, bytes(min(room, 0x12C if req.command == 0x08 else 0x800))).with_note(
            {0x08: 'présence nulle', 0x10: 'mot de passe vide', 0x17: 'attributs à 0',
             0x1C: 'codes à 0'}.get(req.command, ''))

    def friend_key_list(self, req):
        return Reply(0, [0]).static(0, b'').with_note('aucun ami')

    def last_response_result(self, req):
        return Reply(self.last.get(req.session, 0))

    def result_to_error_code(self, req):
        result, error_code = result_to_error_code(req.word(1))
        return Reply(result, [error_code])

    def not_connected(self, req):
        return self.fail(FRD_ERR_NOT_CONNECTED, 'pas de serveur')

    def no_result(self, req):
        return self.fail(FRD_ERR_NO_RESULT, 'aucune demande aboutie')

    def no_mii(self, req):
        return self.fail(FRD_ERR_NO_MII)

    def refused(self, req):
        return self.fail(FRD_ERR_REFUSED, 'liste locale refusée')


# --- soc:U ---

SOC_ERR_NOT_STARTED = -0x27 & 0xFFFFFFFF   # « pile non démarrée » (fiche socket, partie 11)
SOC_ERR_GENERIC = 0xFFFFFFFF
SOC_POLL_NVAL = 0x20


class Socket(Shaped):
    """`soc:U`, hors ligne : InitializeSockets réussit, `socket` rend un descripteur négatif (« pile non démarrée »,
    -0x27), donc aucun descripteur n'existe et tout le reste échoue en -1 ; `poll` rend `revents` à 0x20 pour les
    descripteurs inconnus ; close, ShutdownSockets et gethostid rendent 0 (fiche socket, partie 11)."""
    shapes = reply_shapes.SOC_U
    FAILING = (0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13,
               0x15, 0x17, 0x18, 0x1B, 0x1C, 0x1D, 0x1E, 0x20)
    commands = {0x02: 'socket', 0x14: 'poll', 0x0B: 'zero', 0x16: 'zero', 0x1A: 'zeros_static',
                0x1F: 'zeros_static', **{number: 'bsd_failure' for number in FAILING}}

    def socket(self, req):
        return Reply(0, [SOC_ERR_NOT_STARTED]).with_note('hors ligne : descripteur -0x27')

    def bsd_failure(self, req):
        return Reply(0, [SOC_ERR_GENERIC]).with_note('hors ligne : -1')

    def zero(self, req):
        return Reply(0, [0])

    def zeros_static(self, req):
        _, room = req.receive_buffer(0)
        return Reply(0, [room]).static(0, bytes(min(room, 0x150)))

    def poll(self, req):
        statics = static_items(req)
        count = req.word(1)
        data = bytearray(req.static_data(statics[0][0])) if statics else bytearray()
        for i in range(min(count, len(data) // 12)):
            struct.pack_into('<I', data, 12 * i + 8, SOC_POLL_NVAL)
        return Reply(0, [count]).static(0, bytes(data)).with_note('%d descripteur(s) inconnu(s)' % count)


# --- http:C ---

HTTP_ERR_TOO_MANY = 0xD8A0A01A
HTTP_ERR_NO_CONTEXT = 0xD8A0A064
HTTP_MAX_CONTEXTS = 8


class Http(Shaped):
    """`http:C`, sans réseau (fiche http, partie 10) : une vraie machine à contextes (poignées non nulles et
    distinctes, huit au plus, InitializeConnectionSession refuse une poignée inconnue), mais toute requête est
    « finie » aussitôt, corps vide, code HTTP 0, rien à lire (ReceiveData rend 0 : pas de `0xD840A02B`). Interprété :
    la fiche ne dit pas ce que fait le jeu d'un code 0."""
    shapes = reply_shapes.HTTP_C
    commands = {0x02: 'create_context', 0x03: 'close_context', 0x08: 'initialize_connection_session'}

    def __init__(self, bench, name='http:C'):
        super().__init__(bench, name)
        self.contexts = set()
        self.next_handle = 1

    def create_context(self, req):
        if len(self.contexts) >= HTTP_MAX_CONTEXTS:
            return self.fail(HTTP_ERR_TOO_MANY, '8 contextes ouverts')
        handle = self.next_handle
        self.next_handle += 1
        self.contexts.add(handle)
        return Reply(0, [handle]).with_note('contexte %d' % handle)

    def close_context(self, req):
        self.contexts.discard(req.word(1))
        return None

    def initialize_connection_session(self, req):
        if req.word(1) not in self.contexts:
            return self.fail(HTTP_ERR_NO_CONTEXT, 'contexte %d inconnu' % req.word(1))
        return None


MODULES = {'nwm::UDS': Nwm, 'boss:U': Boss, 'boss:M': BossManagement, 'ssl:C': Ssl, 'cecd:u': Cecd, 'cam:u': Camera,
           'mic:u': Mic, 'ir:USER': IrUser, 'ndm:u': Ndm, 'ac:u': Ac, 'frd:u': Friends, 'soc:U': Socket,
           'http:C': Http}
