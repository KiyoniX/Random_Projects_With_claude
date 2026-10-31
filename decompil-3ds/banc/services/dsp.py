"""`dsp::DSP` : le démarrage du son et une trame de son vide (contrat de dsp, partie 7).

Réel pour le démarrage : LoadComponent rend l'octet 1 ; le tuyau 2 reçoit « démarre » et rend aussitôt la liste des
15 adresses du composant, puis le signal du canal 2 est levé ; ConvertProcessAddressFromDspDram applique la
formule du module (0x1FF40000 + adresse × 2) ; « arrête » fait rendre 1 au registre de réponse 0.
Simplifié : la trame. À chaque fois que le jeu lève le signal du sémaphore, le banc attend une trame (5 ms du banc),
fait avancer les voix (`Voice`) et lève le signal du canal 2, sans rien mixer. Le décodeur AAC (canal 3) répond
« réussi » à chaque message, sans décoder.
"""
import struct

from ipc import Reply, Service
from kernel import Event
from memory import MemoryError3ds

DSP_BASE = 0x1FF40000
ADDRESSES = [0xBFFF, 0x9E92, 0x8680, 0xA792, 0x9430, 0x8400, 0x8540, 0x9492, 0x8710, 0x8410, 0xA912, 0xAA12,
             0xAAD2, 0xAC52, 0xAC5C]
FRAME_NS = 4_888_000

VOICES = 24
COUNTER_A = 0x1FF57FFE
CONFIG_A = 0x1FF53D24
STATUS_A = 0x1FF50D00
ZONE_B = 0x20000
CONFIG_SIZE = 0xC0
SAMPLES_PER_FRAME = 160.0


def dsp32(data, at):
    """Un mot de 32 bits du DSP : la moitié haute d'abord (le jeu le fait tourner de 16 bits, 0x18f6dc)."""
    high, low = struct.unpack_from('<HH', data, at)
    return high << 16 | low


class Voice:
    """Une voix qui avance sans produire de son : le jeu attend la fin de certains sons (la fanfare de « CT activée ! »).
    Les champs viennent d'Azahar (audio_core/hle/shared_memory.h) ; ceux de l'état sont recoupés par la lecture du jeu
    (0x18f6b8) : compteur à +2, position à +4, drapeau à +1, identifiants à +8 et +0xA."""

    def __init__(self):
        self.enabled = False
        self.rate = 0.0
        self.sync = 0
        self.queue = []         # [taille, début, identifiant, boucle, de la file, déjà joué]
        self.current = None     # la taille du tampon en cours, en échantillons
        self.position = 0.0
        self.current_id = 0
        self.last_id = 0
        self.update = False

    def configure(self, config):
        """Prend les réglages que le jeu a marqués « à relire »."""
        dirty = struct.unpack_from('<I', config, 0)[0]
        if dirty & 1 << 29:
            self.__init__()
        if dirty & 1 << 4:
            self.queue.clear()
        if dirty & 1 << 16:
            self.enabled = config[0xA0] != 0
        if dirty & 1 << 28:
            self.sync = struct.unpack_from('<H', config, 0xA2)[0]
        if dirty & 1 << 18:
            self.rate = struct.unpack_from('<f', config, 0x34)[0]
        if dirty & 1 << 30 and dsp32(config, 0xB0) < 0x80000000:
            self.queue.append([dsp32(config, 0xB0), dsp32(config, 0xA4) if dirty & 1 << 21 else 0,
                               struct.unpack_from('<H', config, 0xBE)[0], config[0xBC] & 2 != 0, False, False])
        if dirty & 1 << 19:
            marked = struct.unpack_from('<H', config, 0x4A)[0]
            for slot in range(4):
                at = 0x4C + 20 * slot
                if marked & 1 << slot and dsp32(config, at + 4) < 0x80000000:
                    self.queue.append([dsp32(config, at + 4), 0, struct.unpack_from('<H', config, at + 0x10)[0],
                                       config[at + 0xF] != 0, True, False])

    def dequeue(self):
        """Passe au tampon suivant : le plus petit identifiant d'abord. Un tampon en boucle retourne dans la file."""
        if not self.queue:
            return False
        buffer = min(self.queue, key=lambda b: b[2])
        self.queue.remove(buffer)
        length, start, buffer_id, looping, from_queue, played = buffer
        self.position = 0.0 if played else float(start)
        self.current = length
        self.current_id = buffer_id
        self.last_id = 0
        self.update = from_queue and not played
        if looping:
            buffer[5] = True
            self.queue.append(buffer)
        return True

    def advance(self):
        """Une trame : 160 échantillons de sortie, soit 160 fois la vitesse de lecture de la voix."""
        if not self.enabled:
            return
        if self.current is None:
            if not self.dequeue():
                self.enabled = False
                self.update = True
                self.last_id = self.current_id
                self.current_id = 0
            return
        left = SAMPLES_PER_FRAME * (self.rate if self.rate > 0.0 else 1.0)
        while left > 0.0:
            if self.current is None and not self.dequeue():
                break
            used = min(left, self.current - self.position)
            if used <= 0.0:
                self.current = None     # un tampon vide, ou déjà lu : ne pas tourner sans fin sur une boucle vide
                break
            self.position += used
            left -= used
            if self.position >= self.current:
                self.current = None

    def status(self):
        """L'état que lit le jeu ; le drapeau « l'identifiant a changé » n'est vu qu'une fois."""
        position = int(self.position) & 0xFFFFFFFF
        out = struct.pack('<BBHHHHH', self.enabled, self.update, self.sync, position >> 16, position & 0xFFFF,
                          self.current_id, self.last_id)
        self.update = False
        return out


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
        self.voices = [Voice() for _ in range(VOICES)]

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
        self.advance_voices()
        self.signal(2)

    def advance_voices(self):
        """Les ordres viennent de la zone au compteur le plus haut, l'état va dans l'autre (contrat de dsp, partie 3)."""
        memory = self.kernel.memory

        def counter(zone):
            try:
                return struct.unpack('<H', memory.read(COUNTER_A + zone, 2))[0]
            except MemoryError3ds:
                return 0
        a, b = counter(0), counter(ZONE_B)
        if a == 0 and b == 0:
            return
        if a == 0xFFFF and b != 0xFFFE:     # le compteur a fait le tour
            zone_b_newer = True
        elif b == 0xFFFF and a != 0xFFFE:
            zone_b_newer = False
        else:
            zone_b_newer = b > a
        orders, answers = (ZONE_B, 0) if zone_b_newer else (0, ZONE_B)
        try:
            configs = memory.read(CONFIG_A + orders, VOICES * CONFIG_SIZE)
        except MemoryError3ds:
            return
        status = bytearray()
        for i, voice in enumerate(self.voices):
            config = configs[i * CONFIG_SIZE:(i + 1) * CONFIG_SIZE]
            voice.configure(config)
            voice.advance()
            status += voice.status()
            if config[:4] != bytes(4):
                place = CONFIG_A + orders + i * CONFIG_SIZE
                memory.write(place, bytes(4))       # le DSP efface les marques
                memory.write(place + 0x4A, bytes(2))
        memory.write(STATUS_A + answers, bytes(status))
