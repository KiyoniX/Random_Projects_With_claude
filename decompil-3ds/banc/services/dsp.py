"""`dsp::DSP` : le démarrage du son et une trame de son vide (contrat de dsp, partie 7).

Réel pour le démarrage : LoadComponent rend l'octet 1 ; le tuyau 2 reçoit « démarre » et rend aussitôt la liste des
15 adresses du composant, puis le signal du canal 2 est levé ; ConvertProcessAddressFromDspDram applique la
formule du module (0x1FF40000 + adresse × 2) ; « arrête » fait rendre 1 au registre de réponse 0.
Simplifié : la trame. À chaque fois que le jeu lève le signal du sémaphore, le banc attend une trame (5 ms du banc)
et lève le signal du canal 2, sans rien mixer : l'état des voix reste à zéro. Le décodeur AAC (canal 3) répond
« réussi » à chaque message, sans décoder.
"""
import struct

from ipc import Reply, Service
from kernel import Event

DSP_BASE = 0x1FF40000
ADDRESSES = [0xBFFF, 0x9E92, 0x8680, 0xA792, 0x9430, 0x8400, 0x8540, 0x9492, 0x8710, 0x8410, 0xA912, 0xAA12,
             0xAAD2, 0xAC52, 0xAC5C]
FRAME_NS = 4_888_000


class Dsp(Service):
    name = 'dsp::DSP'
    carte = 'dsp::DSP'
    kind = 'simplifié'
    commands = {0x01: 'recv_data', 0x02: 'recv_data_is_ready', 0x07: 'set_semaphore',
                0x0C: 'convert_address', 0x0D: 'write_process_pipe', 0x10: 'read_pipe_if_possible',
                0x11: 'load_component', 0x12: 'unload_component', 0x13: 'ok', 0x14: 'ok',
                0x15: 'register_interrupt_events', 0x16: 'get_semaphore_event_handle', 0x17: 'ok'}

    def __init__(self, bench):
        super().__init__(bench)
        self.loaded = False
        self.channel_events = {}
        self.pipes = {2: bytearray(), 3: bytearray()}
        self.reply_ready = False
        self.semaphore_event = Event(self.kernel, 0, 'dsp : sémaphore')
        self.semaphore_event.listeners.append(self.on_semaphore)
        self.frames = 0
        self.frame_pending = False
        self.running = False
        self.component_size = 0

    def ok(self, req):
        return Reply(0)

    def load_component(self, req):
        self.component_size = req.word(4) >> 4
        was = self.loaded
        self.loaded = True
        return Reply(0, [0 if was else 1]).raw(req.word(4), req.word(5)).with_note(
            'composant de %#x octets, masques %#x/%#x' % (self.component_size, req.word(2) & 0xFFFF,
                                                          req.word(3) & 0xFFFF))

    def unload_component(self, req):
        self.loaded = False
        self.running = False
        return Reply(0)

    def register_interrupt_events(self, req):
        kind, channel = req.word(1) & 0xFF, req.word(2)
        objects = req.handle_objects(3)
        event = objects[0] if objects else None
        if event is None:
            self.channel_events.pop(channel, None)
            return Reply(0).with_note('canal %d désinscrit' % channel)
        self.channel_events[channel] = event
        return Reply(0).with_note('type %d, canal %d : %s' % (kind, channel, event.label()))

    def get_semaphore_event_handle(self, req):
        return Reply(0).copy_handles(self.semaphore_event)

    def write_process_pipe(self, req):
        channel = req.word(1)
        address, size = req.buffer(3)
        data = req.memory.read(address, size)
        if channel == 2 and len(data) >= 2:
            word = struct.unpack_from('<H', data)[0]
            if word in (0, 2):
                self.pipes[2] += struct.pack('<H', len(ADDRESSES)) + struct.pack('<%dH' % len(ADDRESSES), *ADDRESSES)
                self.running = True
                self.signal(2)
                return Reply(0).with_note('« démarre » (%d) : 15 adresses dans le tuyau, signal du canal 2' % word)
            self.reply_ready = True
            self.running = False
            return Reply(0).with_note('« arrête » (%d) : le registre 0 rendra 1' % word)
        if channel == 3:
            request = struct.unpack_from('<H', data, 2)[0] if len(data) >= 4 else -1
            # En-tête recopié (codec, demande), résultat 0, arguments à zéro : le contenu d'une vraie réponse n'est
            # pas lu (contrat de dsp, partie 5). Renvoyer les arguments de la demande fait lire au jeu des
            # adresses physiques comme des index (faute à 0x2c95c0 au premier essai).
            answer = bytearray(data[:4].ljust(0x20, b'\0'))
            self.pipes[3] += answer
            self.signal(3)
            return Reply(0).with_note('décodeur AAC, demande %d : « réussi » sans décoder' % request)
        return Reply(0)

    def signal(self, channel):
        event = self.channel_events.get(channel)
        if event is not None:
            event.signal()

    def set_semaphore(self, req):
        return Reply(0)

    def read_pipe_if_possible(self, req):
        channel, size = req.word(1), req.word(3) & 0xFFFF
        pipe = self.pipes.get(channel, bytearray())
        if len(pipe) < size:
            return Reply(0, [0]).static(0, b'').with_note('tuyau %d : %d octets, %d demandés' % (channel, len(pipe), size))
        data = bytes(pipe[:size])
        del pipe[:size]
        return Reply(0, [size]).static(0, data).with_note('tuyau %d : %s' % (channel, data[:32].hex()))

    def convert_address(self, req):
        address = req.word(1)
        value = DSP_BASE + address * 2 if self.loaded else 0
        return Reply(0, [value & 0xFFFFFFFF])

    def recv_data_is_ready(self, req):
        return Reply(0, [1 if self.reply_ready else 0])

    def recv_data(self, req):
        self.reply_ready = False
        return Reply(0, [1])

    def on_semaphore(self, event):
        if self.frame_pending or not self.running:
            return
        self.frame_pending = True
        self.kernel.schedule(self.kernel.now + FRAME_NS, self.frame)

    def frame(self):
        self.frame_pending = False
        if not self.running:
            return
        self.frames += 1
        self.signal(2)
