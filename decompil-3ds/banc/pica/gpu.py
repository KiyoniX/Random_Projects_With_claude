"""L'état du processeur graphique PICA200 et ses ordres de dessin.

Une liste de commandes est une suite de paires (donnée, en-tête) : l'en-tête dit quel registre écrire (bits 0-15),
quels octets de la donnée comptent (bits 16-19), combien de données suivent (bits 20-30) et si le numéro de registre
monte à chaque donnée (bit 31). Une liste est complétée à une longueur paire.

`Gpu.process_list` suit toujours l'état des registres (shaders, uniformes, textures…). Les ordres de dessin
(registres 0x22E et 0x22F) ne sont rastérisés que si `draw` est vrai : voir `raster.py` pour la suite du travail.
Les adresses des registres sont physiques (divisées par 8) ; `translate` les rend à l'espace du jeu.
"""
import collections
import os
import struct
import zlib

import numpy as np

from . import formats, raster
from .shader import VertexShader, f24_to_f32

REG_COUNT = 0x300
# Pour la mise au point, trois variables d'environnement (voir le README) :
#   PICA_TRACE=fichier  écrit les premières écritures de registres (PICA_TRACE_N : combien, 3000 par défaut)
#   PICA_CIBLES=dossier écrit en PNG les tampons de rendu quand ils sont rendus à la mémoire
#   PICA_DEBUG=fichier  (dans raster.py) écrit une ligne par ordre de dessin : viewport, ciseaux, tampon
DUMP_TARGETS = os.environ.get('PICA_CIBLES')
TRACE = [open(os.environ['PICA_TRACE'], 'w'), int(os.environ.get('PICA_TRACE_N', '3000'))]     if os.environ.get('PICA_TRACE') else None
STREAM_UNIFORM = range(0x2C1, 0x2C9)
STREAM_CODE = range(0x2CC, 0x2D4)
STREAM_SWIZZLE = range(0x2D6, 0x2DE)
STREAM_FIXED = range(0x233, 0x236)
ATTRIBUTE_TYPES = (np.int8, np.uint8, np.int16, np.float32)


def translate(address):
    """Adresse physique -> adresse du jeu (mémoire vidéo et tas linéaire), ou None."""
    if 0x18000000 <= address < 0x18600000:
        return address + 0x07000000
    if 0x20000000 <= address < 0x28000000:
        return address - 0x0C000000
    return None


def unpack_f24_words(words, count):
    """3 mots -> 4 flottants 24 bits (w d'abord) pour `count` groupes. words : tableau uint32 (3*count,)."""
    w = np.asarray(words, dtype=np.uint64).reshape(count, 3)
    out = np.empty((count, 4), dtype=np.uint32)
    out[:, 3] = (w[:, 0] >> 8)
    out[:, 2] = ((w[:, 0] & 0xFF) << 16) | (w[:, 1] >> 16)
    out[:, 1] = ((w[:, 1] & 0xFFFF) << 8) | (w[:, 2] >> 24)
    out[:, 0] = w[:, 2] & 0xFFFFFF
    return f24_to_f32(out)


class Surface:
    """Un tampon de couleur ou de profondeur recopié sur le PC (en lignes), en attendant d'être rendu à la mémoire."""
    __slots__ = ('address', 'width', 'height', 'fmt', 'pixels', 'dirty', 'valid')

    def __init__(self, address, width, height, fmt):
        self.address, self.width, self.height, self.fmt = address, width, height, fmt
        self.pixels = None
        self.dirty = False
        self.valid = False


class Gpu:
    def __init__(self, memory, journal=None):
        self.memory = memory
        self.journal = journal
        self.regs = [0] * REG_COUNT
        self.seen = bytearray(REG_COUNT)
        for stage in (0xC0, 0xC8, 0xD0, 0xD8, 0xF0, 0xF8):       # étages du combinateur : « précédent » par défaut
            self.regs[stage] = 0x000F000F
            self.regs[stage + 3] = 0xFF000000
        self.regs[0x107] = 0x0F00                                   # par défaut : toutes les couleurs écrites
        self.shader = VertexShader()
        self.fixed = np.zeros((16, 4), dtype=np.float32)
        self.fixed[:, 3] = 1
        self.fixed_index = 0
        self.fixed_pending = []
        self.uniform_index = 0
        self.uniform_f32 = False
        self.uniform_pending = []
        self.code_offset = 0
        self.swizzle_offset = 0
        self.draw_enabled = True
        self.color_surfaces = collections.OrderedDict()
        self.depth_surfaces = collections.OrderedDict()
        self.textures = {}
        self.shader_cache = {}
        self.stats = collections.Counter()
        self.notes = collections.Counter()
        self.triangle_hook = None

    # --- les listes de commandes ---

    def process_list(self, data, draw=True):
        """data : octets de la liste. Rend le nombre d'ordres de dessin exécutés."""
        count = len(data) // 4
        words = struct.unpack('<%dI' % count, data[:count * 4])
        regs = self.regs
        i = 0
        drawn = 0
        self.draw_enabled = draw
        while i + 1 < count:
            header = words[i + 1]
            reg = header & 0xFFFF
            extra = header >> 20 & 0x7FF
            mask = header >> 16 & 0xF
            consecutive = header >> 31
            end = i + 2 + extra
            if reg >= REG_COUNT:
                i += 2 + extra + (extra & 1)
                self.notes['registre hors de 0x300'] += 1
                continue
            if not consecutive and mask == 0xF and extra and (reg in STREAM_UNIFORM or reg in STREAM_CODE
                                                                  or reg in STREAM_SWIZZLE or reg in STREAM_FIXED):
                self.stream(reg, (words[i],) + words[i + 2:end])
            else:
                drawn += self.write(reg, words[i], mask)
                for k in range(extra):
                    value = words[i + 2 + k]
                    drawn += self.write(reg + k + 1 if consecutive else reg, value, mask)
            i += 2 + extra + (extra & 1)
        return drawn

    def write(self, reg, value, mask=0xF):
        """Écrit un registre ; rend 1 si cela a déclenché un dessin."""
        if reg >= REG_COUNT:
            return 0
        if TRACE is not None and TRACE[1] > 0:
            TRACE[0].write('%03x <- %08x (masque %x)' % (reg, value, mask) + chr(10))
            TRACE[1] -= 1
        if mask != 0xF:
            old = self.regs[reg]
            merged = 0
            for b in range(4):
                merged |= (value if mask >> b & 1 else old) & (0xFF << (8 * b))
            value = merged
        self.regs[reg] = value
        self.seen[reg] = 1
        if reg < 0x22E:
            return 0
        if reg == 0x22E or reg == 0x22F:
            self.stats['dessins demandés'] += 1
            if self.draw_enabled:
                return self.draw(reg == 0x22F)
            return 0
        if reg in STREAM_UNIFORM or reg in STREAM_CODE or reg in STREAM_SWIZZLE or reg in STREAM_FIXED:
            self.stream(reg, (value,))
        elif reg == 0x2C0:
            self.uniform_index = value & 0x7F
            self.uniform_f32 = bool(value >> 31)
            self.uniform_pending = []
        elif reg == 0x2CB:
            self.code_offset = value & 0xFFFF
        elif reg == 0x2D5:
            self.swizzle_offset = value & 0xFFFF
        elif reg == 0x232:
            self.fixed_index = value & 0xF
            self.fixed_pending = []
        return 0

    def stream(self, reg, words):
        """Des données poussées vers un tampon à index automatique : uniformes, code, descripteurs, attributs fixes."""
        if reg in STREAM_CODE:
            code = self.shader.code
            for value in words:
                code[self.code_offset & 0xFFF] = value
                self.code_offset += 1
            self.regs[reg] = words[-1]
        elif reg in STREAM_SWIZZLE:
            table = self.shader.swizzle
            for value in words:
                table[self.swizzle_offset & 0xFFF] = value
                self.swizzle_offset += 1
            self.regs[reg] = words[-1]
        elif reg in STREAM_UNIFORM:
            pending = self.uniform_pending
            pending.extend(words)
            need = 4 if self.uniform_f32 else 3
            groups = len(pending) // need
            if groups:
                chunk = np.array(pending[:groups * need], dtype=np.uint32)
                del pending[:groups * need]
                if self.uniform_f32:
                    values = chunk.reshape(groups, 4)[:, ::-1].view(np.float32)
                else:
                    values = unpack_f24_words(chunk, groups)
                start = self.uniform_index
                take = min(groups, 96 - start)
                if take > 0:
                    self.shader.uniforms[start:start + take] = values[:take]
                self.uniform_index += groups
            self.regs[reg] = words[-1]
        else:
            pending = self.fixed_pending
            pending.extend(words)
            while len(pending) >= 3:
                self.fixed[self.fixed_index & 0xF] = unpack_f24_words(np.array(pending[:3], dtype=np.uint32), 1)[0]
                self.fixed_index += 1
                del pending[:3]
            self.regs[reg] = words[-1]
        self.seen[reg] = 1

    # --- les tampons ---

    def color_config(self):
        regs = self.regs
        address = translate((regs[0x11D] & 0x1FFFFFFF) << 3)
        dim = regs[0x11E]
        width, height = dim & 0xFFF, (dim >> 12 & 0xFFF) + 1
        fmt = formats.COLORBUFFER_FORMATS.get(regs[0x117] >> 16 & 7, 'RGBA8')
        return address, width, height, fmt

    def depth_config(self):
        regs = self.regs
        raw = regs[0x11C] & 0x1FFFFFFF
        if not raw:
            return None
        address = translate(raw << 3)
        dim = regs[0x11E]
        return address, dim & 0xFFF, (dim >> 12 & 0xFFF) + 1, regs[0x116] & 3

    def color_surface(self):
        address, width, height, fmt = self.color_config()
        if address is None or not width or not height:
            return None
        key = (address, width, height, fmt)
        surface = self.color_surfaces.get(key)
        if surface is None:
            while len(self.color_surfaces) >= 4:
                self.flush_surface(self.color_surfaces.popitem(last=False)[1])
            surface = Surface(address, width, height, fmt)
            unit = formats.BYTES_PER_PIXEL[fmt]
            try:
                raw = self.memory.read(address, ((width + 7) // 8) * ((height + 7) // 8) * 64 * unit)
                surface.pixels = formats.decode_pixels(fmt, formats.tiled_to_linear(raw, width, height, unit)).copy()
                surface.valid = True
            except Exception:
                surface.pixels = np.zeros((height, width, 4), dtype=np.uint8)
            self.color_surfaces[key] = surface
        return surface

    DEPTH_BYTES = {0: 2, 2: 3, 3: 4}

    def depth_surface(self):
        config = self.depth_config()
        if config is None or config[0] is None or not config[1] or not config[2]:
            return None
        address, width, height, fmt = config
        if fmt not in self.DEPTH_BYTES:
            return None
        key = (address, width, height, fmt)
        surface = self.depth_surfaces.get(key)
        if surface is None:
            while len(self.depth_surfaces) >= 4:
                self.flush_surface(self.depth_surfaces.popitem(last=False)[1])
            surface = Surface(address, width, height, fmt)
            unit = self.DEPTH_BYTES[fmt]
            try:
                raw = self.memory.read(address, ((width + 7) // 8) * ((height + 7) // 8) * 64 * unit)
                data = formats.tiled_to_linear(raw, width, height, unit).astype(np.uint32)
                value = data[..., 0]
                for k in range(1, unit):
                    value |= data[..., k] << (8 * k)
                surface.pixels = value
                surface.valid = True
            except Exception:
                surface.pixels = np.zeros((height, width), dtype=np.uint32)
            self.depth_surfaces[key] = surface
        return surface

    def scratch(self, surface):
        """Un tableau de travail de la taille du tampon (pour repérer les fragments qui se recouvrent)."""
        size = surface.width * surface.height
        if getattr(self, '_scratch', None) is None or len(self._scratch) < size:
            self._scratch = np.zeros(size, dtype=np.int32)
        return self._scratch

    def flush_surface(self, surface):
        if not surface.dirty or not surface.valid:
            return
        surface.dirty = False
        if DUMP_TARGETS and isinstance(surface.fmt, str) and self.stats['cibles écrites'] < 60:
            self.stats['cibles écrites'] += 1
            formats.write_png(os.path.join(DUMP_TARGETS, 'cible-%03d-%x.png' % (self.stats['cibles écrites'], surface.address)),
                              np.ascontiguousarray(surface.pixels))
        try:
            if isinstance(surface.fmt, str):
                data = formats.linear_to_tiled(formats.encode_pixels(surface.fmt, surface.pixels),
                                               formats.BYTES_PER_PIXEL[surface.fmt])
            else:
                unit = self.DEPTH_BYTES[surface.fmt]
                value = surface.pixels
                planes = np.stack([(value >> (8 * k)) & 0xFF for k in range(unit)], axis=-1).astype(np.uint8)
                data = formats.linear_to_tiled(planes, unit)
            self.memory.write(surface.address, data.tobytes())
        except Exception as exc:
            self.notes['écriture d\'un tampon refusée : %s' % exc] += 1

    def flush(self):
        """Rend à la mémoire ce qui a été dessiné (avant qu'une commande de gsp ne lise ou n'écrive la mémoire)."""
        for surface in self.color_surfaces.values():
            self.flush_surface(surface)
        for surface in self.depth_surfaces.values():
            self.flush_surface(surface)

    def invalidate(self):
        """Oublie les recopies (la mémoire a changé sous elles) après les avoir rendues."""
        self.flush()
        self.color_surfaces.clear()
        self.depth_surfaces.clear()

    # --- le dessin ---

    def draw(self, indexed):
        try:
            return raster.draw(self, indexed)
        except Exception as exc:                       # un défaut de rendu ne doit pas arrêter le banc
            import traceback
            self.notes['dessin en erreur : %s' % ''.join(traceback.format_exception_only(type(exc), exc)).strip()] += 1
            if self.notes['_trace'] < 3:
                self.notes['_trace'] += 1
                self.notes['trace:' + traceback.format_exc()[-1500:]] += 1
            return 0
