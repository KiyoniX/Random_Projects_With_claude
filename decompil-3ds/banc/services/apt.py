"""`APT:U`, la vie de l'application (contrat APT ; fiche ns).

Réel pour le démarrage : le verrou commun (un vrai mutex), les deux signaux d'Initialize, la boîte aux lettres des
paramètres (Enable y dépose la commande 1 du menu HOME et lève le signal des paramètres), GlanceParameter et
ReceiveParameter, la police partagée (un vrai bloc de mémoire partagée, premier mot à 2, police à +0x80, pointeurs
laissés tels qu'ils sont dans le fichier : c'est le jeu qui les reloge, voir `relocate_bcfnt`).
Simplifié : les commandes du bouton HOME, des applets, de la veille et de la sortie répondent 0 sans rien lancer ;
aucune notification n'est jamais déposée (piège 2 du contrat).
"""
import os
import struct

from ipc import Reply, Service, error
from kernel import Event, Mutex, SharedMemory

APP_ID = 0x300
HOME_MENU = 0x101
FONT_BLOCK_SIZE = 0x332000
FONT_ADDRESS = 0x1B800000          # dans la plage du tas linéaire, au-dessus de ce que le banc y donne au jeu

ERR_NO_PARAMETER = 0xC8A0CFEF


def relocate_bcfnt(block, base_address, start=0x80):
    """Rend absolus les pointeurs d'une police CFNT posée à `start` d'un bloc projeté à `base_address`.

    Le banc ne s'en sert plus par défaut (option relocate_font) : essayé au premier passage, il a fait relire au
    jeu des pointeurs relogés deux fois (0x37000144 = 2 × 0x1B800080 + 0x44, faute à 0x4948ac). La bibliothèque du
    jeu reloge donc elle-même la police qu'elle trouve dans le bloc, à partir des décalages du fichier.

    La police lue dans l'archive a des pointeurs comptés depuis le début du fichier ; ns les fait pointer dans le
    bloc tel que le jeu le verra. La base d'origine est déduite de l'écart entre ce que FINF annonce et l'endroit où
    les sections se trouvent vraiment (même méthode que les émulateurs). Rend le décalage appliqué.
    """
    header_size = struct.unpack_from('<H', block, start + 6)[0]
    blocks = struct.unpack_from('<I', block, start + 0x10)[0]
    first = {}
    assumed = {}
    offset = start + header_size
    sections = []
    for _ in range(blocks):
        magic = bytes(block[offset:offset + 4])
        size = struct.unpack_from('<I', block, offset + 4)[0]
        sections.append((magic, offset))
        if magic in (b'CMAP', b'CWDH', b'TGLP') and magic not in first:
            first[magic] = offset
        if magic == b'FINF':
            tglp, cwdh, cmap = struct.unpack_from('<III', block, offset + 0x10)
            assumed = {b'TGLP': tglp - 8, b'CWDH': cwdh - 8, b'CMAP': cmap - 8}
        if size == 0:
            break
        offset += size
    previous = assumed[b'CMAP'] - first[b'CMAP']
    delta = (base_address - previous) & 0xFFFFFFFF

    def add(at):
        value = struct.unpack_from('<I', block, at)[0]
        if value:
            struct.pack_into('<I', block, at, (value + delta) & 0xFFFFFFFF)

    for magic, at in sections:
        if magic == b'FINF':
            for field in (0x10, 0x14, 0x18):
                add(at + field)
        elif magic == b'CMAP':
            add(at + 0x10)
        elif magic == b'CWDH':
            add(at + 0x0C)
        elif magic == b'TGLP':
            add(at + 0x1C)
    return delta


class Parameter:
    def __init__(self, sender, destination, command, data=b'', handle=None):
        self.sender = sender
        self.destination = destination
        self.command = command
        self.data = data
        self.handle = handle


class Apt(Service):
    name = 'APT:U'
    carte = 'APT:U'
    kind = 'simplifié'
    commands = {0x01: 'get_lock_handle', 0x02: 'initialize', 0x03: 'enable', 0x05: 'get_applet_man_info',
                0x09: 'is_registered', 0x0B: 'inquire_notification', 0x0C: 'send_parameter',
                0x0D: 'receive_parameter', 0x0E: 'glance_parameter', 0x0F: 'cancel_parameter',
                0x18: 'ok', 0x19: 'ok', 0x1E: 'ok', 0x1F: 'ok', 0x22: 'prepare_to_close', 0x27: 'close_application',
                0x2B: 'ok', 0x2C: 'ok', 0x31: 'ok', 0x32: 'ok', 0x3B: 'ok', 0x3E: 'ok', 0x3F: 'ok', 0x40: 'ok',
                0x42: 'ok', 0x43: 'notify_to_wait', 0x44: 'get_shared_font', 0x4B: 'applet_utility',
                0x4D: 'get_applet_program_info'}

    def __init__(self, bench):
        super().__init__(bench)
        self.lock = Mutex(self.kernel, None, 'verrou d\'APT')
        self.notification_event = Event(self.kernel, 0, 'APT : notifications')
        self.parameter_event = Event(self.kernel, 0, 'APT : paramètres')
        self.parameter = None
        self.notifications = []
        self.font = None
        self.startup_answers = []        # les neuf réponses du démarrage, dans l'ordre (contrat, partie 2)
        self.registered = False

    def note_startup(self, name):
        self.startup_answers.append(name)
        self.bench.on_apt_answer(name)

    def ok(self, req):
        reply = Reply(0)
        reply.kind = 'factice'
        return reply

    def get_lock_handle(self, req):
        attributes = req.word(1)
        self.note_startup('GetLockHandle')
        return Reply(0, [attributes, 0]).copy_handles(self.lock).with_note('attributs %#x, verrou %s'
                                                                           % (attributes, self.lock.label()))

    def initialize(self, req):
        self.note_startup('Initialize')
        if req.word(1) != APP_ID:
            self.bench.note('APT Initialize : identifiant %#x au lieu de 0x300 attendu' % req.word(1))
        return Reply(0).copy_handles(self.notification_event, self.parameter_event)

    def enable(self, req):
        self.note_startup('Enable')
        self.registered = True
        # Le réveil du démarrage : commande 1, venue du menu HOME, sans données ni poignée.
        self.parameter = Parameter(HOME_MENU, APP_ID, 1)
        self.parameter_event.signal()
        return Reply(0).with_note('paramètre « commande 1 » déposé, signal des paramètres levé')

    def get_applet_man_info(self, req):
        position = req.word(1) & 0xFF
        return Reply(0, [0, APP_ID if position == 0 else 0, HOME_MENU, APP_ID])

    def is_registered(self, req):
        app = req.word(1)
        value = 1 if app in (HOME_MENU, APP_ID) else 0
        return Reply(0, [value])

    def inquire_notification(self, req):
        if not self.notifications:
            return Reply(0xC880CFFA, [0]).with_note('aucune notification (le banc n\'en dépose pas)')
        return Reply(0, [self.notifications.pop(0)])

    def send_parameter(self, req):
        sender, destination, command = req.word(1), req.word(2), req.word(3)
        address, size = req.buffer(7)
        if command & 0xFF == 0x10:
            # ns garde les données et répond aussitôt par la commande 3 du destinataire (contrat, rubrique 0x0C).
            self.parameter = Parameter(destination, sender, 3)
            self.parameter_event.signal()
            return Reply(0).with_note('commande 0x10 : réponse « commande 3 » déposée pour le jeu')
        return Reply(0).with_note('paramètre %#x pour %#x : pas de destinataire dans le banc' % (command, destination))

    def _parameter_reply(self, req, move):
        if self.parameter is None:
            return Reply(ERR_NO_PARAMETER).with_note('boîte vide')
        p = self.parameter
        _, room = req.receive_buffer(0)
        data = p.data[:min(room, req.word(2), 0x1000)]
        reply = Reply(0, [p.sender, p.command, len(data)])
        if move:
            reply.move_handles(p.handle)
        else:
            reply.copy_handles(p.handle)
        reply.static(0, data)
        reply.note = 'expéditeur %#x, commande %#x, %d octets' % (p.sender, p.command, len(data))
        return reply

    def receive_parameter(self, req):
        reply = self._parameter_reply(req, True)
        if self.parameter is not None:
            if self.parameter.command == 1:
                self.note_startup('ReceiveParameter')
            self.parameter = None
        return reply

    def glance_parameter(self, req):
        reply = self._parameter_reply(req, False)
        if self.parameter is not None:
            if self.parameter.command == 1:
                self.note_startup('GlanceParameter')
            if self.parameter.command in (8, 9):
                self.parameter = None
        return reply

    def cancel_parameter(self, req):
        removed = 0
        if self.parameter is not None and (not req.word(1) & 0xFF or self.parameter.sender == req.word(2)):
            self.parameter = None
            removed = 1
        return Reply(0, [removed])

    def notify_to_wait(self, req):
        self.note_startup('NotifyToWait')
        return Reply(0)

    def applet_utility(self, req):
        operation = req.word(1)
        self.note_startup('AppletUtility(%d)' % operation)
        _, room = req.receive_buffer(0)
        return Reply(0, [0]).static(0, bytes(min(room, req.word(3)))).with_note('opération %d' % operation)

    def load_font(self):
        block = SharedMemory(self.kernel, FONT_BLOCK_SIZE, address=FONT_ADDRESS, name='police partagée')
        path = self.bench.paths.get('font')
        note = 'police absente : bloc vide (premier mot 3)'
        if path and os.path.isfile(path):
            data = bytearray(FONT_BLOCK_SIZE)
            font = open(path, 'rb').read()
            if font[:4] != b'CFNT':
                note = 'police illisible (%r)' % font[:4]
                data[0:4] = struct.pack('<I', 3)
            else:
                data[0x80:0x80 + len(font)] = font
                note = '%s, %d octets, pointeurs laissés tels quels' % (os.path.basename(path), len(font))
                if self.bench.options.get('relocate_font'):
                    delta = relocate_bcfnt(data, FONT_ADDRESS)
                    note = '%s, %d octets, pointeurs décalés de %#x' % (os.path.basename(path), len(font), delta)
                data[0:4] = struct.pack('<I', 2)
            block.write(0, bytes(data))
        else:
            block.w32(0, 3)
        return block, note

    def get_shared_font(self, req):
        if self.font is None:
            self.font, self.font_note = self.load_font()
        self.note_startup('GetSharedFont')
        return Reply(0, [FONT_ADDRESS]).copy_handles(self.font).with_note(self.font_note)

    def prepare_to_close(self, req):
        self.bench.note_event('le jeu prépare sa fermeture (PrepareToCloseApplication)')
        return Reply(0)

    def close_application(self, req):
        self.bench.request_stop('le jeu s\'est fermé (CloseApplication)')
        return Reply(0)

    def get_applet_program_info(self, req):
        return Reply(0xC880CFFA, [0]).with_note('applet %#x absent du banc' % req.word(1))
