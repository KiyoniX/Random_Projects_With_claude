"""`ldr:ro`, le chargeur des modules `.cro` (contrat des petits services, partie 6 ; fiche ro).

Réel. Le travail de liaison est celui d'`outils/cro_loader.py` (classe `Linker`), vérifié octet pour octet contre le
code de ro ; ce service le branche sur la mémoire du jeu :
- Initialize : static.crs, lu dans le tampon du jeu ; le miroir de ce tampon est projeté à l'adresse donnée ;
- LoadCRR : la liste des empreintes autorisées ;
- LoadExeCRO : le fichier apparaît à l'adresse miroir (la même mémoire que le tampon du tas, comme le fait ro),
  les corrections internes et les imports sont appliqués, `.data` corrigé reste à sa place dans l'image (le jeu le
  recopie lui-même), les décalages de l'en-tête et de la table des segments deviennent des adresses, la marque
  devient FIXD, et les mots du code principal que static.crs réserve à ce module sont remplis ;
- UnloadCRO : les imports qui visaient le module reviennent à « symbole non résolu », le fichier d'origine est
  remis dans le tampon, le miroir est retiré.
"""
import os
import struct
import sys

from ipc import Reply, Service
from memory import PAGE, PERM_RWX, align_up

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), 'outils'))
import cro_loader  # noqa: E402

TABLE_OFFSETS = [0x84, 0xB0, 0xB8, 0xC0] + [offset for offset, _, _ in cro_loader.TABLES]


class RecordingMemory:
    """Enveloppe la mémoire du Linker : chaque mot qu'il écrit est noté, pour être recopié dans celle du jeu."""

    def __init__(self, inner):
        self.inner = inner
        self.writes = []

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def write(self, address, value, width=4):
        ok = self.inner.write(address, value, width)
        if ok:
            self.writes.append((address, width))
        return ok


class LdrRo(Service):
    name = 'ldr:ro'
    carte = 'ldr:ro'
    commands = {0x0001: 'initialize', 0x0002: 'load_crr', 0x0003: 'unload_crr', 0x0004: 'load_exe_cro',
                0x0005: 'unload_cro', 0x0006: 'ok', 0x0007: 'ok', 0x0008: 'ok', 0x0009: 'load_exe_cro'}

    def __init__(self, bench):
        super().__init__(bench)
        self.linker = None
        self.recorder = None
        self.crr = set()
        self.loaded = {}          # adresse miroir -> (module, tampon, taille, octets d'origine)
        self.static_mirror = None

    def ok(self, req):
        return Reply(0)

    def map_mirror(self, mirror, buffer, size):
        backing, offset = self.memory.backing_at(buffer)
        if backing is None:
            raise ValueError('tampon %#x non projeté' % buffer)
        size = align_up(size)
        if self.memory.overlaps(mirror, size):
            self.memory.unmap(mirror, size)
        self.memory.map(mirror, size, PERM_RWX, 'miroir de %#x (ro)' % buffer, backing, offset)

    def sync(self):
        """Recopie dans la mémoire du jeu ce que le Linker vient d'écrire chez lui."""
        count = 0
        for address, width in self.recorder.writes:
            buffer, at = self.recorder.inner.locate(address, width)
            if buffer is None:
                continue
            data = bytes(buffer[at:at + width])
            try:
                self.memory.write(address, data)
                self.kernel.cpu.invalidate(address & ~(PAGE - 1), PAGE)
                count += 1
            except Exception:
                pass
        self.recorder.writes = []
        return count

    def initialize(self, req):
        buffer, size, mirror = req.word(1), req.word(2), req.word(3)
        data = self.memory.read(buffer, size)
        crs = cro_loader.Cro(data, 'static.crs')
        self.linker = cro_loader.Linker(crs, self.bench.code)
        self.recorder = RecordingMemory(self.linker.memory)
        self.linker.memory = self.recorder
        self.map_mirror(mirror, buffer, size)
        self.static_mirror = mirror
        self.bench.journal.module(self.kernel, 'static.crs donné à ro : %d exports par nom, %d modules importés, '
                                  'miroir %#x' % (len(crs.named_exports), len(crs.import_modules), mirror))
        self.bench.on_ro('Initialize')
        return Reply(0).with_note('static.crs %#x octets, miroir %#x' % (size, mirror))

    def load_crr(self, req):
        buffer, size = req.word(1), req.word(2)
        data = self.memory.read(buffer, size)
        try:
            self.crr = cro_loader.read_crr(data)
        except cro_loader.CroError as exc:
            return Reply(0xD9012C11).with_note(str(exc))
        self.bench.journal.module(self.kernel, 'static.crr : %d empreintes autorisées' % len(self.crr))
        self.bench.on_ro('LoadCRR')
        return Reply(0).with_note('%d empreintes' % len(self.crr))

    def unload_crr(self, req):
        return Reply(0)

    def convert_header(self, image, base, module):
        h = module.cro.header
        for offset in TABLE_OFFSETS:
            value = struct.unpack_from('<I', image, offset)[0]
            if value or offset in (0xB0, 0xB8):
                struct.pack_into('<I', image, offset, (base + value) & 0xFFFFFFFF)
        start, count = module.cro.tables['segments']
        for i, (address, size, kind) in enumerate(module.segments):
            struct.pack_into('<I', image, start + 12 * i, address)
        start, count = module.cro.tables['import_modules']
        for i in range(count):
            for word in (0, 1, 3):
                at = start + 20 * i + 4 * word
                value = struct.unpack_from('<I', image, at)[0]
                struct.pack_into('<I', image, at, (base + value) & 0xFFFFFFFF)
        start, count = module.cro.tables['named_exports']
        for i in range(count):
            at = start + 8 * i
            value = struct.unpack_from('<I', image, at)[0]
            struct.pack_into('<I', image, at, (base + value) & 0xFFFFFFFF)
        image[0x80:0x84] = cro_loader.FIXED_MAGIC

    def load_exe_cro(self, req):
        buffer, mirror, size = req.word(1), req.word(2), req.word(3)
        data_address, data_size = req.word(4), req.word(6)
        bss_address, bss_size = req.word(7), req.word(8)
        if self.linker is None:
            return Reply(0xD9012C19, [0]).with_note('LoadExeCRO avant Initialize')
        original = self.memory.read(buffer, size)
        cro = cro_loader.Cro(original, 'cro@%#x' % buffer)
        allowed = cro.crr_hash() in self.crr
        if not allowed:
            self.bench.note('module %s : son empreinte n\'est pas dans static.crr' % cro.name)
        self.map_mirror(mirror, buffer, size)
        module = self.linker.load(cro, mirror, data_address, bss_address)
        image = bytearray(module.image)
        h = cro.header
        image[h['data_offset']:h['data_offset'] + h['data_size']] = module.data[:h['data_size']]
        self.convert_header(image, mirror, module)
        written = self.sync()
        self.memory.write(mirror, bytes(image))
        self.kernel.cpu.invalidate(mirror, align_up(size))
        self.loaded[mirror] = (module, buffer, size, original)
        unresolved = [u for u in self.linker.unresolved() if u[0] == cro.name]
        problems = [p for m, p in self.linker.problems if m == cro.name]
        segments = ', '.join('%s %#x+%#x' % (cro_loader.SEGMENT_KINDS.get(k, k), a, s)
                             for a, s, k in module.segments if s)
        self.bench.journal.module(self.kernel, '%s chargé au miroir %#x (tampon %#x, %#x octets) : %s ; %d mots '
                                  'liés hors du module ; %d imports encore en attente (modules pas chargés) ; %s'
                                  % (cro.name, mirror, buffer, size, segments, written, len(unresolved),
                                     'empreinte autorisée' if allowed else 'EMPREINTE ABSENTE de static.crr'))
        for problem in problems[:10]:
            self.bench.journal.module(self.kernel, '  %s : %s' % (cro.name, problem))
        self.bench.names.modules.append((mirror, mirror + size, cro.name))
        self.bench.on_cro_loaded(cro.name, mirror)
        return Reply(0, [size]).with_note('%s -> %#x' % (cro.name, mirror))

    def unload_cro(self, req):
        mirror, buffer = req.word(1), req.word(3)
        entry = self.loaded.pop(mirror, None)
        if entry is None:
            return Reply(0xD9012C1E).with_note('rien de chargé à %#x' % mirror)
        module, buffer, size, original = entry
        name = module.name
        for other in self.linker.chain:
            if other is module:
                continue
            fallback = other.tag_address(other.cro.header['on_unresolved']) if other.cro.header['on_unresolved'] != \
                cro_loader.NO_TAG else 0
            for target, indexed, anonymous in other.cro.import_modules:
                if target != name:
                    continue
                for _, batch in list(indexed) + list(anonymous):
                    for patch in other.cro.batch(batch):
                        address = other.tag_address(patch.tag)
                        if address:
                            cro_loader.relocate(self.recorder, address, patch.type, patch.addend, fallback, address)
                    self.linker.resolution[(other.name, batch)] = None
        self.linker.chain.remove(module)
        self.linker.memory.inner.regions = [r for r in self.linker.memory.inner.regions
                                            if r[2] is not module.image and r[2] is not module.data]
        written = self.sync()
        self.memory.write(buffer, original)
        self.memory.unmap(mirror, align_up(size))
        self.bench.names.modules = [m for m in self.bench.names.modules if m[0] != mirror]
        self.bench.journal.module(self.kernel, '%s déchargé (%d mots remis à « non résolu »)' % (name, written))
        return Reply(0).with_note(name)
