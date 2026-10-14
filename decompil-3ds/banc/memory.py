"""L'espace d'adresses d'un programme 3DS, tenu sur PC.

Chaque plage projetée est adossée à une « réserve » : un bloc de mémoire du PC (mmap anonyme, donc à zéro et pris
seulement quand on y touche). Deux plages peuvent partager la même réserve : c'est ce qui donne les alias de la
console (le miroir des modules .cro que fait ro, MapMemoryBlock d'un bloc partagé, ControlMemory MAP).

Le processeur, quel qu'il soit, ne voit cet espace qu'à travers les rappels `on_map` / `on_unmap` / `on_protect` :
l'émulateur du banc y projette les mêmes octets (unicorn sait projeter un pointeur), et une future version native
pourra s'en passer. Python lit et écrit directement dans les réserves, sans passer par le processeur.
"""
import ctypes
import mmap
import struct

PAGE = 0x1000

PERM_R = 1
PERM_W = 2
PERM_X = 4
PERM_RW = PERM_R | PERM_W
PERM_RX = PERM_R | PERM_X
PERM_RWX = PERM_R | PERM_W | PERM_X


class MemoryError3ds(Exception):
    """Accès à une adresse que rien ne projette."""


def align_up(value, step=PAGE):
    return (value + step - 1) & ~(step - 1)


def align_down(value, step=PAGE):
    return value & ~(step - 1)


class Backing:
    """Un bloc de mémoire du PC, à adresse fixe tant qu'il vit."""

    def __init__(self, size, name=''):
        self.size = align_up(max(size, PAGE))
        self.name = name
        self.map = mmap.mmap(-1, self.size)
        self.view = memoryview(self.map)
        self.address = ctypes.addressof(ctypes.c_char.from_buffer(self.map))

    def __repr__(self):
        return '<Backing %s %#x>' % (self.name, self.size)


class Region:
    __slots__ = ('start', 'size', 'perms', 'backing', 'offset', 'name')

    def __init__(self, start, size, perms, backing, offset, name):
        self.start = start
        self.size = size
        self.perms = perms
        self.backing = backing
        self.offset = offset
        self.name = name

    @property
    def end(self):
        return self.start + self.size

    def host_pointer(self):
        return self.backing.address + self.offset

    def __repr__(self):
        return '<Region %s %#010x-%#010x %s>' % (self.name, self.start, self.end, 'rwx'[0] if self.perms & 1 else '-')


class AddressSpace:
    """Les plages projetées, triées. Les accès de Python passent ici ; ceux du processeur, par ses propres tables."""

    def __init__(self):
        self.regions = []          # triées par adresse, sans chevauchement
        self.listeners = []        # objets avec on_map(region), on_unmap(start, size), on_protect(start, size, perms)
        self._last = None

    # --- projection ---

    def map(self, start, size, perms, name='', backing=None, offset=0):
        if start % PAGE or size % PAGE or size <= 0:
            raise ValueError('projection mal alignée : %#x + %#x' % (start, size))
        if self.overlaps(start, size):
            raise ValueError('projection %s %#x + %#x : la plage est déjà prise (%s)'
                             % (name, start, size, self.find(start) or self.find(start + size - 1)))
        if backing is None:
            backing = Backing(size, name)
            offset = 0
        if offset + size > backing.size:
            raise ValueError('projection %s : la réserve %s est trop petite' % (name, backing.name))
        region = Region(start, size, perms, backing, offset, name)
        self.regions.append(region)
        self.regions.sort(key=lambda r: r.start)
        self._last = None
        for listener in self.listeners:
            listener.on_map(region)
        return region

    def unmap(self, start, size):
        """Retire [start, start+size) ; une plage coupée en deux garde ses deux morceaux."""
        end = start + size
        kept = []
        for region in self.regions:
            if region.end <= start or region.start >= end:
                kept.append(region)
                continue
            if region.start < start:
                kept.append(Region(region.start, start - region.start, region.perms, region.backing, region.offset,
                                   region.name))
            if region.end > end:
                kept.append(Region(end, region.end - end, region.perms, region.backing,
                                   region.offset + end - region.start, region.name))
        self.regions = sorted(kept, key=lambda r: r.start)
        self._last = None
        for listener in self.listeners:
            listener.on_unmap(start, size)

    def protect(self, start, size, perms):
        end = start + size
        out = []
        for region in self.regions:
            if region.end <= start or region.start >= end:
                out.append(region)
                continue
            pieces = []
            if region.start < start:
                pieces.append(Region(region.start, start - region.start, region.perms, region.backing, region.offset,
                                     region.name))
            lo, hi = max(region.start, start), min(region.end, end)
            pieces.append(Region(lo, hi - lo, perms, region.backing, region.offset + lo - region.start, region.name))
            if region.end > end:
                pieces.append(Region(end, region.end - end, region.perms, region.backing,
                                     region.offset + end - region.start, region.name))
            out.extend(pieces)
        self.regions = sorted(out, key=lambda r: r.start)
        self._last = None
        for listener in self.listeners:
            listener.on_protect(start, size, perms)

    def overlaps(self, start, size):
        end = start + size
        return any(r.start < end and start < r.end for r in self.regions)

    def find(self, address):
        last = self._last
        if last is not None and last.start <= address < last.end:
            return last
        for region in self.regions:
            if region.start <= address < region.end:
                self._last = region
                return region
        return None

    def is_mapped(self, address, size=1):
        while size > 0:
            region = self.find(address)
            if region is None:
                return False
            step = min(size, region.end - address)
            address += step
            size -= step
        return True

    def find_free(self, low, high, size):
        """La première plage libre de cette taille entre low et high, ou None."""
        cursor = align_up(low)
        for region in self.regions:
            if region.end <= cursor:
                continue
            if region.start >= high:
                break
            if region.start - cursor >= size:
                return cursor
            cursor = max(cursor, align_up(region.end))
        return cursor if cursor + size <= high else None

    def backing_at(self, address):
        """(réserve, décalage) derrière une adresse, ou (None, None)."""
        region = self.find(address)
        if region is None:
            return None, None
        return region.backing, region.offset + address - region.start

    # --- lecture et écriture depuis Python ---

    def read(self, address, size):
        out = bytearray()
        while size > 0:
            region = self.find(address)
            if region is None:
                raise MemoryError3ds('lecture hors mémoire à %#010x' % address)
            at = region.offset + address - region.start
            step = min(size, region.end - address)
            out += region.backing.view[at:at + step]
            address += step
            size -= step
        return bytes(out)

    def write(self, address, data):
        data = bytes(data)
        pos = 0
        while pos < len(data):
            region = self.find(address)
            if region is None:
                raise MemoryError3ds('écriture hors mémoire à %#010x' % address)
            at = region.offset + address - region.start
            step = min(len(data) - pos, region.end - address)
            region.backing.view[at:at + step] = data[pos:pos + step]
            address += step
            pos += step

    def fill(self, address, size, byte=0):
        self.write(address, bytes([byte]) * size)

    def u8(self, address):
        return self.read(address, 1)[0]

    def u16(self, address):
        return struct.unpack('<H', self.read(address, 2))[0]

    def u32(self, address):
        region = self.find(address)
        if region is not None and address + 4 <= region.end:
            at = region.offset + address - region.start
            return struct.unpack_from('<I', region.backing.view, at)[0]
        return struct.unpack('<I', self.read(address, 4))[0]

    def u64(self, address):
        return struct.unpack('<Q', self.read(address, 8))[0]

    def w8(self, address, value):
        self.write(address, bytes([value & 0xFF]))

    def w16(self, address, value):
        self.write(address, struct.pack('<H', value & 0xFFFF))

    def w32(self, address, value):
        region = self.find(address)
        if region is not None and address + 4 <= region.end:
            at = region.offset + address - region.start
            struct.pack_into('<I', region.backing.view, at, value & 0xFFFFFFFF)
            return
        self.write(address, struct.pack('<I', value & 0xFFFFFFFF))

    def w64(self, address, value):
        self.write(address, struct.pack('<Q', value & 0xFFFFFFFFFFFFFFFF))

    def words(self, address, count):
        return list(struct.unpack('<%dI' % count, self.read(address, 4 * count)))

    def cstring(self, address, limit=0x100):
        out = bytearray()
        for i in range(limit):
            try:
                byte = self.u8(address + i)
            except MemoryError3ds:
                break
            if byte == 0:
                break
            out.append(byte)
        return out.decode('latin-1')

    def describe(self):
        return ['%#010x-%#010x %s%s%s %s' % (r.start, r.end, 'r' if r.perms & 1 else '-', 'w' if r.perms & 2 else '-',
                                             'x' if r.perms & 4 else '-', r.name) for r in self.regions]
