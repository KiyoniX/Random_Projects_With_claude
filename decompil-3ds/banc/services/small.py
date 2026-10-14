"""Les petits services du démarrage : `cfg:u`, `ptm:u`, `hid:USER`, le port `err:f` (contrat des petits services).

- `cfg:u` : réel. Les blocs viennent du fichier `config` de la console (local/, jamais versionné), lu au format de
  `cfg` (fiche cfg, partie 5) ; GenHashConsoleUnique refait le calcul du module (SHA-256 du bloc 0x00090001 et du sel).
  Sans fichier, des valeurs raisonnables pour les 16 blocs que le jeu demande.
- `ptm:u` : réel pour la seule commande envoyée (GetStepHistory écrit des zéros).
- `hid:USER` : simplifié. Une vraie page partagée, mise à jour à chaque fin d'image avec « aucun bouton », cinq
  signaux jamais déclenchés (le jeu ne les attend pas), les constantes du gyroscope.
- `err:f` : réel côté banc : la fiche d'erreur est décodée, notée, et le banc s'arrête là.
"""
import hashlib
import os
import struct

from ipc import Reply, Service, error
from kernel import Event, SharedMemory


def parse_config(data):
    """{bloc: octets} depuis le fichier `config` de cfg : nombre, décalage des données, puis cases de 12 octets."""
    count, _ = struct.unpack_from('<HH', data, 0)
    blocks = {}
    for i in range(count):
        block_id, value, size, flags = struct.unpack_from('<IIHH', data, 4 + 12 * i)
        if size <= 4:
            blocks[block_id] = struct.pack('<I', value)[:size]
        else:
            blocks[block_id] = data[value:value + size]
    return blocks


DEFAULT_BLOCKS = {
    0x00030001: bytes(8),
    0x00050005: struct.pack('<8f', 62.0, 289.0, 76.8, 46.08, 10.0, 5.0, 55.58, 21.57),
    0x00070001: bytes([1]),
    0x00070002: bytes(8),
    0x00090000: bytes(8),
    0x00090001: bytes(8),
    0x000A0000: 'Banc'.encode('utf-16-le').ljust(0x1C, b'\0'),
    0x000A0001: bytes([1, 1]),
    0x000A0002: bytes([2]),
    0x000B0000: bytes([0, 0, 2, 77]),
    0x000B0001: bytes(0x800),
    0x000B0002: bytes(0x800),
    0x000B0003: bytes(4),
    0x000C0000: bytes(0xC0),
    0x000C0001: bytes(0x14),
    0x000D0000: bytes([0xFF, 0xFF, 0, 0]),
    0x00130000: bytes(4),
}


class Cfg(Service):
    name = 'cfg:u'
    carte = 'cfg:u'
    commands = {0x0001: 'get_config_info_blk2', 0x0002: 'secure_info_get_region', 0x0003: 'gen_hash_console_unique',
                0x0004: 'get_region_canada_usa', 0x0005: 'get_system_model'}

    def __init__(self, bench):
        super().__init__(bench)
        path = bench.paths.get('config')
        self.source = 'valeurs par défaut du banc'
        self.blocks = dict(DEFAULT_BLOCKS)
        if path and os.path.isfile(path):
            self.blocks.update(parse_config(open(path, 'rb').read()))
            self.source = 'fichier config de la console'
        self.region = bench.options.get('region', 2)

    def get_config_info_blk2(self, req):
        size, block_id = req.word(1), req.word(2)
        address, buffer_size = req.buffer(3)
        data = self.blocks.get(block_id)
        if data is None:
            return Reply(0xD90103FA, [req.word(3), address]).with_note('bloc %#010x inconnu' % block_id)
        if buffer_size != len(data):
            return Reply(0xD90103EC, [req.word(3), address]).with_note(
                'bloc %#010x : taille %#x demandée, %#x dans la console' % (block_id, buffer_size, len(data)))
        self.memory.write(address, data)
        return Reply(0, [req.word(3), address]).with_note('bloc %#010x (%s) : %s' % (
            block_id, self.source, data[:16].hex() + ('…' if len(data) > 16 else '')))

    def secure_info_get_region(self, req):
        return Reply(0, [self.region]).with_note('région %d' % self.region)

    def gen_hash_console_unique(self, req):
        salt = req.word(1) & 0xFFFFF
        seed = self.blocks.get(0x00090001, bytes(8))
        digest = hashlib.sha256(seed[:8] + struct.pack('<I', salt)).digest()
        low, high = struct.unpack('<II', digest[-8:])
        return Reply(0, [low, high]).with_note('sel %#x' % salt)

    def get_region_canada_usa(self, req):
        country = self.blocks.get(0x000B0000, bytes(4))[3]
        value = 1 if self.region == 1 and country in (0x12, 0x31) else 0
        return Reply(0, [value])

    def get_system_model(self, req):
        return Reply(0, [2])


class Ptm(Service):
    name = 'ptm:u'
    carte = 'ptm:u'
    commands = {0x000B: 'get_step_history'}

    def get_step_history(self, req):
        address, size = req.buffer(4)
        self.memory.write(address, bytes(size))
        return Reply(0, [req.word(4), address]).with_note('%d heures, toutes à 0 pas' % (size // 2))

    def unknown(self, req):
        reply = Reply(0, [0, 0])
        reply.kind = 'factice'
        return reply


HID_SECTIONS = {'pad': 0x000, 'touch': 0x0A8, 'accel': 0x108, 'gyro': 0x158, 'debug': 0x238}


class Hid(Service):
    name = 'hid:USER'
    carte = 'hid:USER'
    kind = 'simplifié'
    commands = {0x000A: 'get_ipc_handles', 0x0011: 'ok', 0x0012: 'ok', 0x0013: 'ok', 0x0014: 'ok',
                0x0015: 'get_gyro_coefficient', 0x0016: 'get_gyro_calibration'}

    def __init__(self, bench):
        super().__init__(bench)
        self.shared = SharedMemory(self.kernel, 0x1000, name='hid')
        self.events = [Event(self.kernel, 0, 'hid : %s' % n) for n in ('boutons', 'tactile', 'accéléromètre',
                                                                     'gyroscope', 'pad de débogage')]
        for offset in HID_SECTIONS.values():
            for word in range(5):
                self.shared.w32(offset + 4 * word, 0xFFFFFFFF)
        self.index = {'pad': -1, 'touch': -1}
        self.buttons = 0
        self.updates = 0

    def ok(self, req):
        return Reply(0)

    def get_ipc_handles(self, req):
        return Reply(0).copy_handles(self.shared, *self.events)

    def get_gyro_coefficient(self, req):
        return Reply(0, [0x41660000])

    def get_gyro_calibration(self, req):
        # Zéro à 0, références ±6700 sur chaque axe : deux valeurs différentes, le jeu ne divise pas par zéro.
        values = [0, 6700, -6700] * 3
        raw = struct.pack('<9h', *values) + b'\0\0'
        return Reply(0, list(struct.unpack('<5I', raw)))

    def _push(self, section, entry_offset, entry_size, count, entry):
        base = HID_SECTIONS[section]
        now = self.kernel.ticks()
        index = (self.index[section] + 1) % count
        if index == 0:
            self.shared.w32(base + 8, self.shared.u32(base))
            self.shared.w32(base + 0xC, self.shared.u32(base + 4))
        self.shared.write(base + entry_offset + index * entry_size, entry)
        self.shared.w32(base, now & 0xFFFFFFFF)
        self.shared.w32(base + 4, now >> 32)
        self.shared.w32(base + 0x10, index)
        self.index[section] = index

    def update(self):
        """Une lecture des périphériques : aucun bouton, pas de toucher (appelé à chaque fin d'image)."""
        self.updates += 1
        held = self.buttons
        self._push('pad', 0x28, 0x10, 8, struct.pack('<IIIhh', held, 0, 0, 0, 0))
        self._push('touch', 0x20, 8, 8, struct.pack('<HHI', 0, 0, 0))


class ErrF(Service):
    name = 'err:f'
    carte = 'err:f'
    commands = {0x0001: 'throw'}

    def throw(self, req):
        info = req.memory.read(req.cmdbuf + 4, 0x80)
        kind = info[0]
        result, address, pid = struct.unpack_from('<III', info, 4)
        names = self.bench.names
        text = 'erreur fatale du jeu : genre %d, code %#010x, à %#x (%s), processus %#x' % (
            kind, result, address, names.function(address) or '?', pid)
        self.bench.request_stop(text)
        return Reply(0).with_note(text)
