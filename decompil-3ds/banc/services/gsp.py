"""`gsp::Gpu` : le droit d'affichage, la file de commandes graphiques, les interruptions relayées (contrat de gsp).

Réel :
- la page de mémoire partagée (zone des interruptions, tampons d'écran, file de commandes) au format du contrat ;
- RegisterInterruptRelayQueue rend 0 (pas 0x2A07 : le jeu ne programme pas lui-même les écrans) ;
- la file : à TriggerCmdReqQueue et après chaque commande, le banc vide la file et dépose l'interruption de fin
  (6 transfert mémoire, 5 liste de commandes, 0 ou 1 remplissage — une seule —, 4 transfert ou copie, rien pour 5) ;
- les fins d'image : toutes les 1/60 s du banc, les interruptions 2 et 3 (écran du haut, du bas), après avoir pris
  la description d'image que le jeu a annoncée.
Les remplissages, transferts mémoire, copies de texture et transferts vers l'écran (tuiles, formats, réduction,
retournement) sont faits pour de bon (`pica/transfer.py`). Les listes de commandes PICA sont toujours lues et
comptées (nombre, taille, registres visés, ordres de dessin). Avec l'option `draw` (`run.py --dessiner`), elles sont
aussi exécutées par `pica/` : l'état des registres est toujours suivi, les ordres de dessin ne sont rastérisés que
dans la fenêtre de temps demandée. Sans cette option, rien n'est dessiné.
"""
import collections
import struct

from ipc import Reply, Service
from kernel import SharedMemory
from pica import transfer

VBLANK_NS = 16_715_000
RELAY, QUEUE, FRAMEBUFFERS = 0x000, 0x800, 0x200
INTERRUPT_NAMES = {0: 'PSC0', 1: 'PSC1', 2: 'PDC0 (fin d\'image du haut)', 3: 'PDC1 (fin d\'image du bas)',
                   4: 'PPF', 5: 'P3D', 6: 'DMA'}
COMMAND_NAMES = {0: 'RequestDma', 1: 'ProcessCommandList', 2: 'MemoryFill', 3: 'DisplayTransfer',
                 4: 'TextureCopy', 5: 'FlushCacheRegions'}
FORMATS = {0: 'RGBA8', 1: 'RGB8', 2: 'RGB565', 3: 'RGB5A1', 4: 'RGBA4'}
DRAW_REGISTERS = {0x022E: 'DrawArrays', 0x022F: 'DrawElements'}
# Adresses physiques que le GPU lit dans les registres de saut -> adresses du jeu : (début, fin, adresse du jeu du début)
PHYSICAL_RANGES = ((0x20000000, 0x28000000, 0x14000000), (0x18000000, 0x18600000, 0x1F000000))
MAX_JUMPS = 20000       # garde-fou contre une boucle ; le terrain chaîne jusqu'à 2 200 sauts dans une seule commande


def follow_jumps(memory, data, stats=None):
    """Les listes se chaînent par les registres de saut du processeur de commandes (0x238/0x239 taille, 0x23A/0x23B
    adresse physique, tous deux en unités de 8 octets ; l'écriture de 0x23C ou 0x23D déclenche le saut) : le reste
    du tampon courant est abandonné et la lecture continue dans le tampon visé. Le jeu y range ses modèles prêts
    à dessiner ; sans cela le banc ne voyait aucun ordre de dessin du terrain. Rend les octets mis bout à bout."""
    out = []
    regs = {}
    for _ in range(MAX_JUMPS + 1):
        words = struct.unpack('<%dI' % (len(data) // 4), data[:len(data) // 4 * 4])
        i = 0
        target = None
        while i + 1 < len(words) and target is None:
            header = words[i + 1]
            register = header & 0xFFFF
            extra = header >> 20 & 0x7FF
            consecutive = header >> 31
            if i + 2 + extra > len(words):          # paquet coupé par la fin du tampon : on l'ignore
                i = len(words)
                break
            for k in range(1 + extra):
                reg = register + (k if consecutive else 0)
                regs[reg] = words[i] if k == 0 else words[i + 1 + k]
                if reg in (0x23C, 0x23D) and regs[reg] & 1:
                    target = reg - 0x23C
            i += 2 + extra + (extra & 1)
        out.append(data[:i * 4] if target is not None else data)
        if target is None:
            break
        physical, size = regs.get(0x23A + target, 0) * 8, regs.get(0x238 + target, 0) * 8
        address = next((virtual + physical - low for low, high, virtual in PHYSICAL_RANGES if low <= physical < high), 0)
        try:
            data = memory.read(address, size) if address and size else b''
        except Exception:
            data = b''
        if not data:
            (stats if stats is not None else collections.Counter())['sauts de liste vers une adresse illisible'] += 1
            break
        (stats if stats is not None else collections.Counter())['sauts de liste suivis'] += 1
    return b''.join(out)


class Gsp(Service):
    name = 'gsp::Gpu'
    carte = 'gsp::Gpu'
    kind = 'simplifié'
    commands = {0x01: 'write_hw_regs', 0x02: 'write_hw_regs', 0x04: 'read_hw_regs', 0x08: 'ok',
                0x0B: 'set_lcd_force_black', 0x0C: 'trigger_cmd_req_queue', 0x10: 'ok',
                0x13: 'register_interrupt_relay_queue', 0x14: 'unregister', 0x16: 'acquire_right', 0x17: 'ok',
                0x18: 'import_display_capture_info', 0x19: 'ok', 0x1A: 'ok'}

    def __init__(self, bench):
        super().__init__(bench)
        self.shared = None
        self.event = None
        self.right = False
        self.first_result = bench.options.get('gsp_first_result', 0)
        self.stats = collections.Counter()
        self.registers = collections.Counter()
        self.lists = []                       # (heure, adresse, taille, mots, dessins)
        self.frames = {0: [], 1: []}          # écran -> [(heure, adresse, format, largeur de ligne)]
        self.current = {0: None, 1: None}
        self.vblank_count = 0
        self.black = None
        self.hw_writes = []
        self.unknown_ops = []
        self.gpu = None
        self.recorder = None
        self.draw_from = bench.options.get('draw_from', 0.0)
        self.draw_until = bench.options.get('draw_until', float('inf'))
        self.snapshot_every = bench.options.get('snapshot_every', 1.0)
        self.next_snapshot = self.draw_from
        self.draw_every = max(1, bench.options.get('draw_every', 1))
        self.transfers = 0
        self.drawn_transfers = 0
        self.latest_transfer = {}               # écran -> (adresse, format, octets par colonne) du dernier transfert fait
        self.snapshot_transfers = 0
        self.draw_seconds = 0.0
        if bench.options.get('draw'):
            from pica.gpu import Gpu
            self.gpu = Gpu(bench.memory)
            from pica import replay
            self.recorder = replay.from_environment()       # PICA_ENREGISTRER : voir pica/replay.py

    def drawing_now(self):
        now = self.kernel.now / 1e9
        return self.draw_from <= now < self.draw_until and (self.transfers // 2) % self.draw_every == 0

    def ok(self, req):
        return Reply(0)

    def acquire_right(self, req):
        self.right = True
        if self.shared is not None:
            for screen in (0, 1):
                self.shared.write(FRAMEBUFFERS + 0x40 * screen + 1, b'\0')
        return Reply(0)

    def register_interrupt_relay_queue(self, req):
        objects = req.handle_objects(2)
        self.event = objects[0] if objects else None
        if self.shared is None:
            self.shared = SharedMemory(self.kernel, 0x1000, name='gsp')
        for word in range(3):
            self.shared.w32(RELAY + 4 * word, 0)
        self.kernel.schedule(self.kernel.now + VBLANK_NS, self.vblank)
        self.bench.on_gsp_registered()
        return Reply(self.first_result, [0]).copy_handles(self.shared).with_note(
            'drapeaux %#x, client 0, signal %s, réponse %#x' % (req.word(1), self.event.label() if self.event else '?',
                                                                 self.first_result))

    def unregister(self, req):
        self.event = None
        return Reply(0)

    def set_lcd_force_black(self, req):
        self.black = req.word(1) & 0xFF
        self.bench.on_lcd_force_black(self.black)
        return Reply(0).with_note('écrans au noir' if self.black else 'le noir est levé : l\'image devient visible')

    def write_hw_regs(self, req):
        address, size = req.buffer(3)
        data = req.memory.read(address, size) if size else b''
        self.hw_writes.append((req.word(1), data))
        return Reply(0).with_note('registre %#x + 0x1EB00000 <- %s' % (req.word(1), data.hex()))

    def read_hw_regs(self, req):
        _, room = req.receive_buffer(0)
        return Reply(0).static(0, bytes(min(room, req.word(2)))).with_note('registre %#x : zéros' % req.word(1))

    def import_display_capture_info(self, req):
        words = []
        for screen in (0, 1):
            info = self.current[screen] or (0, 0, 0, 0)
            words += [info[0], info[0], info[1], info[2]]
        return Reply(0, words)

    def trigger_cmd_req_queue(self, req):
        done = self.process_queue()
        return Reply(0).with_note('%d commande(s) traitée(s) : %s' % (len(done), ', '.join(done)))

    # --- la zone des interruptions ---

    def deposit(self, interrupt):
        if self.shared is None or self.event is None:
            return
        if interrupt in (2, 3) and self.shared.u8(RELAY + 3) & 1:
            return
        index, count = self.shared.u8(RELAY), self.shared.u8(RELAY + 1)
        if count >= 0x34:
            self.shared.write(RELAY + 2, b'\1')
            return
        self.shared.write(RELAY + 0xC + (index + count) % 0x34, bytes([interrupt]))
        self.shared.write(RELAY + 1, bytes([count + 1]))
        self.stats['interruption %d %s' % (interrupt, INTERRUPT_NAMES[interrupt])] += 1
        self.event.signal()

    # --- la file de commandes ---

    def process_queue(self):
        done = []
        while self.shared is not None:
            index, count = self.shared.u8(QUEUE), self.shared.u8(QUEUE + 1)
            if count == 0:
                break
            slot = QUEUE + 0x20 + index * 0x20
            words = struct.unpack('<8I', self.shared.read(slot, 0x20))
            self.shared.write(QUEUE, bytes([(index + 1) % 15, count - 1]))
            done.append(self.execute(words))
        return done

    def execute(self, words):
        if self.recorder is not None:
            self.recorder.before(words, self.memory, self.gpu, self.kernel.now / 1e9)
        name = self.execute_command(words)
        if self.recorder is not None:
            self.recorder.after(words, self.memory, self.gpu, self.kernel.now / 1e9)
        return name

    def execute_command(self, words):
        command = words[0] & 0xFF
        name = COMMAND_NAMES.get(command, 'commande %d' % command)
        self.stats[name] += 1
        memory = self.memory
        journal = self.bench.journal
        if self.gpu is not None and command in (0, 2, 3, 4):
            if command == 3:
                self.gpu.flush()                 # le transfert lit le tampon de rendu
            else:
                self.gpu.invalidate()            # ces commandes réécrivent la mémoire sous les recopies du PC
        if command == 0:
            source, destination, size = words[1:4]
            try:
                memory.write(destination, memory.read(source, size))
            except Exception as exc:
                journal.write(self.kernel, 'gsp : transfert mémoire %#x -> %#x refusé (%s)' % (source, destination, exc))
            journal.write(self.kernel, 'gsp file : RequestDma %#x -> %#x, %#x octets' % (source, destination, size))
            self.deposit(6)
        elif command == 1:
            address, size = words[1], words[2]
            summary = self.read_command_list(address, size)
            journal.write(self.kernel, 'gsp file : ProcessCommandList %#x, %#x octets : %s' % (address, size, summary))
            if self.gpu is not None:
                self.run_gpu_list(address, size)
            self.deposit(5)
            self.bench.on_command_list(address, size)
        elif command == 2:
            zones = [(words[1], words[2], words[3], words[7] & 0xFFFF), (words[4], words[5], words[6], words[7] >> 16)]
            texts = []
            for start, value, end, control in zones:
                if not start:
                    continue
                width = (control >> 8) & 3
                pattern = struct.pack('<I', value)[:(2, 3, 4)[min(width, 2)]]
                try:
                    size = end - start
                    memory.write(start, (pattern * (size // len(pattern) + 1))[:size])
                except Exception as exc:
                    texts.append('refusé (%s)' % exc)
                texts.append('%#x-%#x <- %#x (%d bits)' % (start, end, value, (16, 24, 32)[min(width, 2)]))
            journal.write(self.kernel, 'gsp file : MemoryFill ' + ' ; '.join(texts))
            self.deposit(0 if words[1] else 1)
        elif command == 3:
            source, destination, in_dim, out_dim, flags = words[1:6]
            problem = ''
            skipped = self.gpu is not None and not self.drawing_now()
            self.transfers += 1
            try:
                if skipped:
                    problem = "sauté : cette image n'est pas dessinée"
                else:
                    problem = transfer.display_transfer(memory, source, destination, in_dim, out_dim, flags)
                    self.drawn_transfers += 1
                    if not problem and out_dim & 0xFFFF == 240:
                        from pica import formats as _formats
                        unit = _formats.BYTES_PER_PIXEL[_formats.GX_FORMATS[flags >> 12 & 7]]
                        self.latest_transfer[0 if out_dim >> 16 == 400 else 1] = (destination, flags >> 12 & 7, 240 * unit)
            except Exception as exc:
                problem = 'refusé (%s)' % exc
            self.stats['transferts vers écran faits'] += 0 if problem else 1
            journal.write(self.kernel, 'gsp file : DisplayTransfer %#x (%dx%d, %s) -> %#x (%dx%d, %s), drapeaux %#x%s' % (
                source, in_dim & 0xFFFF, in_dim >> 16, FORMATS.get(flags >> 8 & 7, '?'), destination,
                out_dim & 0xFFFF, out_dim >> 16, FORMATS.get(flags >> 12 & 7, '?'), flags,
                ' : ' + problem if problem else ''))
            self.deposit(4)
        elif command == 4:
            source, destination, size, in_dim, out_dim, flags = words[1:7]
            try:
                transfer.texture_copy(memory, source, destination, size, in_dim, out_dim, flags)
            except Exception as exc:
                journal.write(self.kernel, 'gsp : copie de texture refusée (%s)' % exc)
            journal.write(self.kernel, 'gsp file : TextureCopy %#x -> %#x, %#x octets, lignes %#x/%#x' % (
                source, destination, size, in_dim, out_dim))
            self.deposit(4)
        elif command == 5:
            pass
        else:
            self.unknown_ops.append(words)
        return name

    def follow_jumps(self, data):
        return follow_jumps(self.memory, data, self.stats)

    def run_gpu_list(self, address, size):
        """Fait suivre la liste à `pica/` : l'état est toujours suivi, le dessin seulement dans la fenêtre de temps."""
        import time
        try:
            data = self.memory.read(address, size)
        except Exception:
            return
        data = self.follow_jumps(data)
        start = time.perf_counter()
        self.gpu.process_list(data, draw=self.drawing_now())
        self.draw_seconds += time.perf_counter() - start

    def read_command_list(self, address, size):
        try:
            data = self.memory.read(address, size)
        except Exception as exc:
            self.lists.append((self.kernel.now, address, size, 0, 0))
            return 'illisible (%s)' % exc
        data = self.follow_jumps(data)
        words = struct.unpack('<%dI' % (len(data) // 4), data[:len(data) // 4 * 4])
        i = 0
        writes = 0
        draws = collections.Counter()
        while i + 1 < len(words):
            header = words[i + 1]
            register = header & 0xFFFF
            extra = header >> 20 & 0x7FF
            consecutive = header >> 31
            for k in range(1 + extra):
                reg = register + (k if consecutive else 0)
                self.registers[reg] += 1
                writes += 1
                if reg in DRAW_REGISTERS:
                    draws[DRAW_REGISTERS[reg]] += 1
            i += 2 + extra + (extra & 1)
        self.lists.append((self.kernel.now, address, size, writes, sum(draws.values())))
        return '%d écritures de registres, dessins : %s' % (writes, dict(draws) or 'aucun')

    # --- les fins d'image ---

    def take_framebuffer(self, screen):
        base = FRAMEBUFFERS + 0x40 * screen
        if not self.shared.u8(base + 1):
            return
        which = self.shared.u8(base) & 1
        active, left, right, stride, fmt, select, attribute = struct.unpack(
            '<7I', self.shared.read(base + 4 + 0x1C * which, 0x1C))
        self.shared.write(base + 1, b'\0')
        self.current[screen] = (left, fmt, stride)
        self.frames[screen].append((self.kernel.now, left, fmt, stride))
        if len(self.frames[screen]) <= 3:
            self.bench.journal.write(self.kernel, 'gsp : image annoncée pour l\'écran du %s : %#x, %s, ligne de %d '
                                     'octets, format %#x' % ('haut' if screen == 0 else 'bas', left,
                                                             FORMATS.get(fmt & 7, '?'), stride, fmt))

    def vblank(self):
        if self.shared is None:
            return
        self.vblank_count += 1
        for screen in (0, 1):
            self.take_framebuffer(screen)
        self.bench.on_vblank()
        snapshot = self.bench.options.get('snapshot')
        now = self.kernel.now / 1e9
        if snapshot is not None and self.gpu is not None and self.draw_from <= now < self.draw_until \
                and now >= self.next_snapshot and self.drawn_transfers != self.snapshot_transfers:
            self.snapshot_transfers = self.drawn_transfers
            self.gpu.flush()
            self.next_snapshot = now + self.snapshot_every
            snapshot(self.bench)
        self.deposit(2)
        self.deposit(3)
        self.process_queue()
        self.kernel.schedule(self.kernel.now + VBLANK_NS, self.vblank)
