"""Charge les modules .cro de Pokémon X sur PC comme le ferait le module ro de la console, et en tire des ELF pour Ghidra.

Le jeu range presque tout son code dans 133 fichiers .cro (des « DLL ») que ro place en mémoire à la demande, écran
par écran. Un .cro seul est illisible dans Ghidra : ses pointeurs internes valent des décalages, ses appels vers le code
principal et vers les autres modules sont des mots à zéro, à remplir au chargement. Cet outil refait ce chargement :
il lit le fichier, place ses segments, applique ses corrections internes, résout ses imports contre static.crs (la
fiche d'identité du code principal) et contre les autres modules, puis écrit un ELF ARM où tout est à sa place, avec
un symbole par export et par cible d'import, un .noms.tsv au format du carnet et un rapport.

    python cro_loader.py info <fichier.cro|static.crs>
    python cro_loader.py link <dossier romfs> [--only A,B,...] [--each] [--out DOSSIER] [--code code.bin]
    python cro_loader.py verify <dossier romfs> [--out DOSSIER]
    python cro_loader.py ghidra <dossier romfs> --only A,B,... [--out DOSSIER]
    python cro_loader.py test

        info      l'en-tête, les segments, les tables, les empreintes, ce que le module importe et exporte
        link      charge static.crs puis les modules (tous, ou ceux de --only, dans cet ordre), et écrit
                  <sortie>/<nom>.elf, .noms.tsv et .rapport.txt ; le code principal (../exefs/code.bin) est mis dans
                  l'ELF avec les 331 mots que static.crs fait remplir. --each écrit en plus un ELF par module, où le
                  code principal et les autres modules ne sont que des blocs vides portant les noms des cibles
        verify    la validation chiffrée sur tout le dossier -> <sortie>/validation.txt : en-têtes et règles de ro,
                  empreintes et static.crr, arbre des exports, bornes des corrections, liaison complète et module par
                  module, cibles dans le code principal comparées à la liste de fonctions de Ghidra
                  (local/analyse/maj/gh/funcs.tsv et refs.tsv, de ghidra_direct.py maj) et à pokemon-x.noms.tsv,
                  imports entre modules, et appels au gestionnaire de modules du jeu (qui charge quoi avec quoi)
        ghidra    lie les modules de --only, écrit un ELF où eux seuls ont des octets (le code principal en bloc vide),
                  le fait analyser par Ghidra sans interface sous Ubuntu (/opt/ghidra, ghidra_scripts/DumpFunctions.java),
                  puis classe chaque appel ou saut que Ghidra voit sortir d'un module : début de fonction connu, adresse
                  importée, ou ailleurs (une erreur de liaison)
    La sortie par défaut est local/analyse/cro/ : rien de ce qui sort d'ici ne doit être versionné.

Ce que fait ro, et d'où on le sait. « (ro) » : lu dans le code du module ro de la console (local/extrait/ro, chargé à
0x14000000 ; les adresses sont celles de ses fonctions). « (données) » : vérifié sur les 134 fichiers du jeu.
« (3dbrew) » : seulement d'après la page CRO0 de 3dbrew, à recouper avec la fiche de ro.

- En-tête : à 0x80 « CRO0 », puis les champs de HEADER_FIELDS et quatorze couples (décalage, nombre) de TABLES. ro
  refuse un fichier dont les tables ne sont pas rangées dans l'ordre code ≤ nom ≤ segments ≤ exports par nom ≤ arbre
  ≤ exports par numéro ≤ chaînes d'exports ≤ modules importés ≤ corrections d'imports ≤ … ≤ données ≤ taille, dont
  0x88, 0x8C ou 0x98 ne sont pas nuls, ou dont le code commence avant 0x138 (ro, 0x14006e80).
- Empreintes : SHA-256 de 0x80..0x180, du code, des tables (du nom du module jusqu'aux données), des données ; static.crr
  liste l'empreinte des 0x80 premiers octets de chaque .cro autorisé (données).
- Adresse étiquetée : 4 bits de numéro de segment, 28 bits de décalage. Elle ne vaut rien (0) si le numéro dépasse la
  table ou si le décalage dépasse la taille du segment (ro, partout).
- Segments : ro remplace le décalage de .data (genre 2) par l'adresse du tampon fourni par le jeu, celui de .bss
  (genre 3) par l'adresse du tampon .bss, et ajoute l'adresse du module aux autres s'ils ne sont pas nuls. Pas pour
  static.crs, dont la table donne déjà des adresses (ro, 0x140041c0 ; données).
- Module importé (20 octets) : nom, PUIS début et nombre des imports par numéro, PUIS début et nombre des imports
  anonymes (ro, 0x140041c0 rebase les mots 0, 1 et 3 ; données). La table de 3dbrew met le nombre avant le début :
  elle se trompe.
- Correction (12 octets) : adresse étiquetée du mot visé, type, un octet (« dernière de la liste » pour un import,
  numéro du segment du symbole pour une correction interne), un octet « liste résolue » écrit par ro sur la première
  correction d'une liste, un octet libre, la valeur à ajouter (données ; ro, 0x1400519c et 0x140077c8).
- Types (ro, 0x14004050, avec S le symbole, A l'ajout, P l'adresse où le mot sera à l'exécution) : 0 rien ; 2 et 38
  S+A ; 3 S+A-P ; 42 A + (S signé sur 31 bits) - P ; 28 un « bl » ARM (S pair) ou un « blx » (S impair) vers S+A ;
  29 refait le décalage d'un branchement ARM existant (S pair seulement) ; 10 un « bl » Thumb (S impair) ou « blx »
  (S pair). Les branchements refusent |P-S| ≥ 32 Mo (ARM) ou 4 Mo (Thumb). Tout autre type est une erreur. Seul le
  type 2 existe dans Pokémon X (données) : les autres sont codés d'après ro mais jamais exercés sur le jeu.
- Correction interne visant .data : ro écrit dans le .data du fichier (à son adresse d'origine) mais calcule P avec
  l'adresse du tampon .data ; c'est le jeu qui recopie ensuite .data dans son tampon (ro, 0x140077c8 ; fiche
  contrat-petits-services). Ici on écrit directement dans le tampon : le résultat est le même.
- Avant de lier, ro écrit dans chaque correction d'import l'adresse de la fonction OnUnresolved DU MODULE QUI IMPORTE,
  ou 0 s'il n'en a pas (ro, 0x14007ae8 et 0x140069d8). Un import jamais résolu vaut donc 0 + ajout dans un module, et
  0x4d7bc0 + ajout dans le code principal (OnUnresolved de static.crs).
- Lier (ro, 0x140063d4) : 1) les imports par nom du module pas encore résolus, cherchés dans chaque module chargé
  (static.crs d'abord) par l'arbre des exports ; 2) pour chaque module importé, le premier module chargé qui porte ce
  nom : imports par numéro (case de sa table d'exports par numéro) et anonymes (adresse étiquetée dans ses segments) ;
  3) dans l'autre sens, pour chaque module déjà chargé, static.crs compris, ses imports qui visent le nouveau module.
  Une liste dont le symbole vaut 0 fait échouer le chargement (ro, 0x1400519c).
- Un import par nom « __aeabi_atexit » reçoit l'export « nnroAeabiAtexit_ » d'un module chargé (ro, 0x140041c0).
- Exports anonymes « statiques » (0x120) : corrections que le module fait dans le code principal, avec les segments de
  static.crs (ro, 0x140041c0). Vides dans Pokémon X.
- Finition (ro, 0x14007bd4 et 0x14005fd4) : au niveau 1, celui du jeu, la marque devient « FIXD », les tables
  d'exports anonymes statiques, de corrections internes et statiques sont oubliées, et 0x98 reçoit la fin des tables
  gardées arrondie à la page. ro y compte la table des modules importés à 8 octets par case au lieu de 20.

Où sont placés les modules. ro les fait apparaître à l'adresse « miroir » que le jeu lui donne (tampon du tas moins
0x0799B000) : elle dépend de l'allocateur du jeu à l'exécution et ne se déduit pas des fichiers. Ici, chaque .cro du
dossier reçoit une place fixe, dans l'ordre des noms, à partir de 0x00665000 (la première page après le programme,
là où apparaît le début du tas) : son fichier entier, puis son tampon .data (taille arrondie à 8, comme le jeu le
réserve), puis son .bss, puis on passe à la page suivante. Un module garde donc la même adresse quel que soit l'ensemble
lié. Les modules sont tous chargés en même temps, ce que le jeu ne fait jamais (32 au plus) : c'est sans effet sur le
résultat, puisque chaque import vise un module par son nom.

Ce que l'outil ne fait pas : il ne déroule ni OnLoad ni les constructeurs (l'objet de contrôle), ne réserve rien dans le
tas du jeu, n'écrit pas l'en-tête transformé par ro dans l'ELF (seuls les quatre segments y sont), et ne refait pas la
finition. Le décodage des branchements (types 10, 28, 29) n'a jamais servi sur un vrai fichier.
"""
import bisect
import collections
import hashlib
import os
import re
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, 'local', 'analyse', 'cro')
DEFAULT_ROMFS = os.path.join(ROOT, 'local', 'extrait', 'maj', 'romfs')
NAMES_FILE = os.path.join(ROOT, 'fiches', 'pokemon-x.noms.tsv')
GHIDRA_FUNCTIONS = os.path.join(ROOT, 'local', 'analyse', 'maj', 'gh', 'funcs.tsv')
GHIDRA_HEADLESS = '/opt/ghidra/support/analyzeHeadless'
GHIDRA_SCRIPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ghidra_scripts')

MAGIC = b'CRO0'
FIXED_MAGIC = b'FIXD'
STATIC_NAME = '|static|'
MAIN_BASE = 0x00100000
MODULES_BASE = 0x00665000      # première page après .data et .bss du programme (0x664498 arrondi)
PAGE = 0x1000
NO_TAG = 0xFFFFFFFF
UNRESOLVED_SPACE = (0x00100000, 0x0E000000)   # ro refuse d'écrire hors de cette plage (ro, partout)

HEADER_FIELDS = [
    (0x80, 'magic'), (0x84, 'name_offset'), (0x88, 'next'), (0x8C, 'previous'), (0x90, 'file_size'),
    (0x94, 'bss_size'), (0x98, 'fixed_size'), (0x9C, 'unknown_9c'), (0xA0, 'control_object'), (0xA4, 'on_load'),
    (0xA8, 'on_exit'), (0xAC, 'on_unresolved'), (0xB0, 'code_offset'), (0xB4, 'code_size'), (0xB8, 'data_offset'),
    (0xBC, 'data_size'), (0xC0, 'module_name_offset'), (0xC4, 'module_name_size'),
]
# (position dans l'en-tête, nom, taille d'une case ; 1 pour une table de chaînes dont le « nombre » est une taille)
TABLES = [
    (0xC8, 'segments', 12), (0xD0, 'named_exports', 8), (0xD8, 'indexed_exports', 4), (0xE0, 'export_strings', 1),
    (0xE8, 'export_tree', 8), (0xF0, 'import_modules', 20), (0xF8, 'external_patches', 12),
    (0x100, 'named_imports', 8), (0x108, 'indexed_imports', 8), (0x110, 'anonymous_imports', 8),
    (0x118, 'import_strings', 1), (0x120, 'static_anonymous_exports', 8), (0x128, 'internal_patches', 12),
    (0x130, 'static_patches', 12),
]
HEADER_END = 0x138
# L'ordre dans lequel ro exige que les tables se suivent dans le fichier (ro, 0x14006e80).
RO_ORDER = [0xB0, 0xC0, 0xC8, 0xD0, 0xE8, 0xD8, 0xE0, 0xF0, 0xF8, 0x100, 0x108, 0x110, 0x118, 0x120, 0x128, 0x130, 0xB8,
            0x90]
SEGMENT_KINDS = {0: 'text', 1: 'rodata', 2: 'data', 3: 'bss'}
SEGMENT_FLAGS = {0: 'rx', 1: 'r', 2: 'rw', 3: 'rw'}
PATCH_TYPES = {0: 'aucune', 2: 'R_ARM_ABS32', 3: 'R_ARM_REL32', 10: 'R_ARM_THM_CALL', 28: 'R_ARM_CALL',
               29: 'R_ARM_JUMP24', 38: 'R_ARM_TARGET1', 42: 'R_ARM_PREL31'}

# Gestionnaire de modules du code principal de Pokémon X (fiches/contrat-petits-services.md, partie 6).
LOAD_FUNCTIONS = {0x357960: ('ro_manager_load_and_start_module', 0), 0x357A54: ('ro_manager_load_module', 1)}


class CroError(ValueError):
    pass


def align(value, step):
    return (value + step - 1) & ~(step - 1)


def u32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]


def c_string(data, offset, limit=None):
    end = data.find(b'\0', offset, limit if limit is not None else len(data))
    if end < 0:
        raise CroError('chaîne sans fin à %#x' % offset)
    return data[offset:end].decode('ascii', errors='replace')


def split_tag(tag):
    """Adresse étiquetée -> (numéro de segment, décalage dans le segment)."""
    return tag & 0xF, tag >> 4


def make_tag(segment, offset):
    return (offset << 4) | segment


Patch = collections.namedtuple('Patch', 'index tag type flag resolved addend')


class Cro:
    """Un fichier .cro ou static.crs lu tel qu'il est sur la cartouche (rien n'est modifié)."""

    def __init__(self, data, file_name='?'):
        self.data = bytes(data)
        self.file_name = file_name
        if len(self.data) < HEADER_END:
            raise CroError('%s : %d octets, trop court pour un en-tête' % (file_name, len(self.data)))
        if self.data[0x80:0x84] != MAGIC:
            raise CroError('%s : marque %r au lieu de CRO0' % (file_name, self.data[0x80:0x84]))
        self.header = {}
        for offset, name in HEADER_FIELDS[1:]:
            self.header[name] = u32(self.data, offset)
        self.tables = {}
        for offset, name, entry in TABLES:
            start, count = struct.unpack_from('<II', self.data, offset)
            size = count * entry
            if start + size > len(self.data):
                raise CroError('%s : table %s hors du fichier (%#x + %#x)' % (file_name, name, start, size))
            self.tables[name] = (start, count)
        h = self.header
        if h['file_size'] != len(self.data):
            raise CroError('%s : taille annoncée %#x, fichier %#x' % (file_name, h['file_size'], len(self.data)))
        self.name = self.data[h['module_name_offset']:h['module_name_offset'] + h['module_name_size']].rstrip(b'\0').decode('ascii')
        self.is_static = self.name == STATIC_NAME
        self.segments = [struct.unpack_from('<III', self.data, self.tables['segments'][0] + 12 * i)
                         for i in range(self.tables['segments'][1])]
        start, count = self.tables['named_exports']
        strings = self.tables['export_strings']
        self.named_exports = []
        for i in range(count):
            name_offset, tag = struct.unpack_from('<II', self.data, start + 8 * i)
            self.named_exports.append((c_string(self.data, name_offset, strings[0] + strings[1]), tag))
        start, count = self.tables['indexed_exports']
        self.indexed_exports = [u32(self.data, start + 4 * i) for i in range(count)]
        start, count = self.tables['export_tree']
        self.export_tree = [struct.unpack_from('<HHHH', self.data, start + 8 * i) for i in range(count)]
        start, count = self.tables['external_patches']
        self.external_patches = [Patch(i, *struct.unpack_from('<IBBBxi', self.data, start + 12 * i)) for i in range(count)]
        start, count = self.tables['internal_patches']
        self.internal_patches = [Patch(i, *struct.unpack_from('<IBBBxi', self.data, start + 12 * i)) for i in range(count)]
        start, count = self.tables['static_patches']
        self.static_patches = [Patch(i, *struct.unpack_from('<IBBBxi', self.data, start + 12 * i)) for i in range(count)]
        # Les imports désignent leur liste de corrections par un décalage dans le fichier : on le garde tel quel.
        self.named_imports = [(c_string(self.data, n), b) for n, b in self._pairs('named_imports')]
        self.indexed_imports = self._pairs('indexed_imports')
        self.anonymous_imports = self._pairs('anonymous_imports')
        self.static_anonymous_exports = self._pairs('static_anonymous_exports')
        start, count = self.tables['import_modules']
        self.import_modules = []
        for i in range(count):
            name_offset, indexed_start, indexed_count, anonymous_start, anonymous_count = struct.unpack_from('<5I', self.data, start + 20 * i)
            indexed = [struct.unpack_from('<II', self.data, indexed_start + 8 * k) for k in range(indexed_count)]
            anonymous = [struct.unpack_from('<II', self.data, anonymous_start + 8 * k) for k in range(anonymous_count)]
            self.import_modules.append((c_string(self.data, name_offset), indexed, anonymous))

    def _pairs(self, table):
        start, count = self.tables[table]
        return [struct.unpack_from('<II', self.data, start + 8 * i) for i in range(count)]

    # --- lecture ---

    def segment_of_kind(self, kind):
        for index, (_, size, k) in enumerate(self.segments):
            if k == kind and size:
                return index
        return None

    def tag_file_offset(self, tag):
        """Où tombe une adresse étiquetée dans le fichier, ou None si ro la refuserait (ro : numéro et décalage bornés)."""
        segment, offset = split_tag(tag)
        if segment >= len(self.segments) or offset >= self.segments[segment][1]:
            return None
        return self.segments[segment][0] + offset

    def batch(self, file_offset):
        """La liste de corrections qui commence à ce décalage de la table des imports : jusqu'à la marque de fin."""
        start, count = self.tables['external_patches']
        if file_offset < start or (file_offset - start) % 12 or file_offset >= start + 12 * count:
            raise CroError('%s : liste de corrections à %#x hors de la table' % (self.name, file_offset))
        first = (file_offset - start) // 12
        out = []
        for patch in self.external_patches[first:]:
            out.append(patch)
            if patch.flag:
                break
        return out

    def find_named_export(self, name):
        """Cherche un export par son nom avec l'arbre de l'en-tête, comme ro (0x14004fc0) : rend l'adresse étiquetée
        ou None. Un nœud : bit à tester (octet × 8 + bit, le bit 0 étant le poids faible), fils gauche, fils droit
        (bit 15 : c'est une feuille, le nœud désigné donne le numéro d'export), numéro d'export. Le nœud 0 ne sert
        que d'entrée : on part de son fils gauche."""
        if not self.export_tree:
            return None
        raw = name.encode('ascii')
        child = self.export_tree[0][1]
        for _ in range(len(self.export_tree) + 1):
            node = self.export_tree[child & 0x7FFF]
            if child & 0x8000:
                index = node[3]
                if index < len(self.named_exports) and self.named_exports[index][0] == name:
                    return self.named_exports[index][1]
                return None
            bit = node[0]
            byte = bit >> 3
            child = node[2] if byte < len(raw) and raw[byte] >> (bit & 7) & 1 else node[1]
        return None

    # --- contrôles ---

    def hashes(self):
        """[(nom, empreinte écrite, empreinte recalculée)] pour les quatre empreintes de l'en-tête."""
        h = self.header
        regions = [('en-tête', 0x80, 0x100), ('code', h['code_offset'], h['code_size']),
                   ('tables', h['module_name_offset'], h['data_offset'] - h['module_name_offset']),
                   ('données', h['data_offset'], h['data_size'])]
        return [(name, self.data[32 * i:32 * i + 32], hashlib.sha256(self.data[start:start + size]).digest())
                for i, (name, start, size) in enumerate(regions)]

    def crr_hash(self):
        return hashlib.sha256(self.data[:0x80]).digest()

    def ro_header_problems(self):
        """Ce que ro refuserait dans l'en-tête (ro, 0x14006e80), en clair. Liste vide : accepté."""
        problems = []
        h = self.header
        if h['next'] or h['previous']:
            problems.append('maillons 0x88/0x8C non nuls')
        if h['fixed_size']:
            problems.append('0x98 (taille après finition) non nul')
        if h['file_size'] > 0x0FFFFFFF or h['bss_size'] > 0x0FFFFFFF:
            problems.append('taille ou .bss démesurés')
        if h['code_offset'] < HEADER_END:
            problems.append('le code commence avant 0x138')
        values = [u32(self.data, offset) for offset in RO_ORDER]
        for (a, va), (b, vb) in zip(zip(RO_ORDER, values), zip(RO_ORDER[1:], values[1:])):
            if vb < va:
                problems.append('table %#x (%#x) avant table %#x (%#x)' % (b, vb, a, va))
        for name in ('export_strings', 'import_strings'):
            start, size = self.tables[name]
            if size and self.data[start + size - 1] != 0:
                problems.append('%s ne finit pas par un zéro' % name)
        if self.external_patches and not self.external_patches[-1].flag:
            problems.append('la dernière correction d\'import ne porte pas la marque de fin')
        return problems

    def fixed_end(self, level=1):
        """Fin (décalage) de ce que ro garde à ce niveau de finition, avant l'arrondi à la page (ro, 0x14005fd4)."""
        h, t = self.header, self.tables
        def end(name, entry):
            return t[name][0] + t[name][1] * entry
        level3 = max(HEADER_END, h['code_offset'] + h['code_size'], h['module_name_offset'] + h['module_name_size'],
                     end('segments', 12))
        level2 = max(level3, end('named_exports', 8), end('indexed_exports', 4), end('export_strings', 1),
                     end('export_tree', 8))
        level1 = max(level2, end('import_modules', 8), end('external_patches', 12), end('named_imports', 8),
                     end('indexed_imports', 8), end('anonymous_imports', 8), end('import_strings', 1))
        level0 = max(level1, end('static_patches', 12), end('static_anonymous_exports', 8), end('internal_patches', 12))
        return {0: level0, 1: level1, 2: level2, 3: level3}.get(level, level0)


def read_crr(data):
    """Les empreintes d'un .crr : décalage de la table à 0x350, nombre de cases à 0x354, 32 octets par case."""
    if data[:4] != b'CRR0':
        raise CroError('pas un CRR0')
    start, count = struct.unpack_from('<II', data, 0x350)
    return {data[start + 32 * i:start + 32 * i + 32] for i in range(count)}


# --- Chargement ---

class LoadedModule:
    def __init__(self, cro, base, data_address, bss_address):
        self.cro = cro
        self.name = cro.name
        self.base = base
        self.data_address = data_address
        self.bss_address = bss_address
        self.image = bytearray(cro.data)
        self.data = bytearray(align(cro.header['data_size'], 8)) if not cro.is_static else bytearray()
        # Table des segments telle que ro la réécrit : [(adresse, taille, genre)].
        self.segments = []
        for offset, size, kind in cro.segments:
            if cro.is_static:
                address = offset
            elif kind == 2 and size:
                address = data_address
            elif kind == 3 and size:
                address = bss_address
            elif offset:
                address = base + offset
            else:
                address = 0
            self.segments.append((address, size, kind))

    def tag_address(self, tag):
        """Adresse étiquetée -> adresse en mémoire, ou 0, exactement comme ro."""
        segment, offset = split_tag(tag)
        if segment >= len(self.segments) or offset >= self.segments[segment][1]:
            return 0
        address = self.segments[segment][0] + offset
        return address

    def end(self):
        return max(self.base + len(self.image), self.bss_address + self.cro.header['bss_size'])


class Memory:
    """Les octets que le chargement modifie : le code principal et, pour chaque module, son fichier et son .data."""

    def __init__(self):
        self.regions = []    # (début, fin, tampon, décalage dans le tampon)

    def add(self, start, buffer, offset=0, size=None):
        size = len(buffer) - offset if size is None else size
        self.regions.append((start, start + size, buffer, offset))

    def locate(self, address, width):
        for start, end, buffer, offset in self.regions:
            if start <= address and address + width <= end:
                return buffer, offset + address - start
        return None, None

    def read32(self, address):
        buffer, at = self.locate(address, 4)
        return None if buffer is None else u32(buffer, at)

    def write(self, address, value, width=4):
        buffer, at = self.locate(address, width)
        if buffer is None:
            return False
        struct.pack_into('<I' if width == 4 else '<H', buffer, at, value & (0xFFFFFFFF if width == 4 else 0xFFFF))
        return True


def relocate(memory, write_address, kind, addend, symbol, place):
    """Une correction, comme ro (0x14004050). Rend None si tout va bien, sinon la raison du refus."""
    value = (symbol + addend - place) & 0xFFFFFFFF
    distance = (place - symbol) & 0xFFFFFFFF
    distance = distance - (1 << 32) if distance & 0x80000000 else distance
    if kind == 0:
        return None
    if kind in (2, 38):
        ok = memory.write(write_address, symbol + addend)
    elif kind == 3:
        ok = memory.write(write_address, value)
    elif kind == 42:
        signed31 = ((symbol << 1) & 0xFFFFFFFF)
        signed31 = (signed31 - (1 << 32) if signed31 & 0x80000000 else signed31) >> 1
        ok = memory.write(write_address, addend + signed31 - place)
    elif kind == 28:
        if not -0x1FFFFFF <= distance <= 0x1FFFFFF:
            return 'branchement ARM trop loin'
        if symbol & 1:
            word = 0xFA000000 | ((value << 23) & 0x1000000) | ((value & 0x3FFFFFF) >> 2)
        else:
            word = 0xEB000000 | ((value & 0x3FFFFFF) >> 2)
        ok = memory.write(write_address, word)
    elif kind == 29:
        if not -0x1FFFFFF <= distance <= 0x1FFFFFF or symbol & 1:
            return 'branchement ARM trop loin ou vers du Thumb'
        old = memory.read32(write_address)
        if old is None:
            return 'mot hors mémoire'
        ok = memory.write(write_address, (old & 0xFF000000) | ((value & 0x3FFFFFF) >> 2))
    elif kind == 10:
        if not -0x400000 < distance <= 0x3FFFFF:
            return 'branchement Thumb trop loin'
        if symbol & 1:
            low = 0xF800 | ((value << 20 & 0xFFFFFFFF) >> 21)
        else:
            if value & 2:
                value = (value + 2) & 0xFFFFFFFF
            low = 0xE800 | ((value << 20 & 0xFFFFFFFF) >> 21)
        high = 0xF000 | ((value << 9 & 0xFFFFFFFF) >> 21)
        ok = memory.write(write_address, high, 2) and memory.write(write_address + 2, low, 2)
    else:
        return 'type de correction %d inconnu de ro' % kind
    return None if ok else 'mot %#x hors mémoire' % write_address


class Linker:
    """Rejoue Initialize (static.crs) puis LoadExeCRO pour chaque module, avec liaison automatique."""

    def __init__(self, crs, main_code=None):
        if not crs.is_static:
            raise CroError('%s n\'est pas static.crs' % crs.file_name)
        self.memory = Memory()
        self.main_code = bytearray(main_code) if main_code is not None else None
        self.static = LoadedModule(crs, 0, 0, 0)
        if self.main_code is not None:
            self.memory.add(MAIN_BASE, self.main_code)
        self.chain = [self.static]            # l'ordre de la liste de ro : static.crs d'abord
        self.problems = []                    # (module, texte)
        self.resolution = {}                  # (module, décalage de la liste) -> (module exportateur, adresse) ou None
        self.batch_owner = {}                 # (module, décalage de la liste) -> (genre, détail)
        self.patch_log = collections.Counter()
        self.import_symbols = {}              # adresse -> (module exportateur, adresse étiquetée)
        self.module_targets = collections.defaultdict(set)   # module -> adresses que ses imports ont reçues
        self._register_batches(self.static)
        # Initialize : les mots du code principal reçoivent OnUnresolved de static.crs, comme dans le fichier.
        self._reset_external(self.static)

    def _register_batches(self, module):
        cro = module.cro
        for name, batch in cro.named_imports:
            self.batch_owner[(module.name, batch)] = ('nom', name)
            self.resolution[(module.name, batch)] = None
        for target, indexed, anonymous in cro.import_modules:
            for index, batch in indexed:
                self.batch_owner[(module.name, batch)] = ('numéro', (target, index))
                self.resolution[(module.name, batch)] = None
            for tag, batch in anonymous:
                self.batch_owner[(module.name, batch)] = ('anonyme', (target, tag))
                self.resolution[(module.name, batch)] = None

    def _apply_batch(self, module, batch_offset, symbol, exporter=None):
        """Applique une liste de corrections d'import (ro, 0x1400519c) ; rend la raison d'un refus ou None."""
        if not symbol:
            return 'symbole à 0 dans %s' % (exporter or '?')
        if module.cro.is_static and self.main_code is None:
            # Sans code.bin, les mots du code principal n'existent pas ici : on retient seulement la résolution.
            self.resolution[(module.name, batch_offset)] = (exporter, symbol)
            return None
        for patch in module.cro.batch(batch_offset):
            address = module.tag_address(patch.tag)
            if not address or not UNRESOLVED_SPACE[0] <= address < UNRESOLVED_SPACE[1]:
                self.problems.append((module.name, 'correction d\'import %d hors de son segment (%#x)' % (patch.index, patch.tag)))
                continue
            reason = relocate(self.memory, address, patch.type, patch.addend, symbol, address)
            if reason:
                self.problems.append((module.name, 'correction d\'import %d : %s' % (patch.index, reason)))
            self.patch_log['import_%s' % PATCH_TYPES.get(patch.type, patch.type)] += 1
        self.resolution[(module.name, batch_offset)] = (exporter, symbol)
        self.module_targets[module.name].add(symbol)
        return None

    def _reset_external(self, module):
        """Toutes les corrections d'import du module reçoivent son OnUnresolved, ou 0 (ro, 0x14007ae8)."""
        symbol = module.tag_address(module.cro.header['on_unresolved'])
        for patch in module.cro.external_patches:
            address = module.tag_address(patch.tag)
            if address:
                relocate(self.memory, address, patch.type, patch.addend, symbol, address)

    def _resolve_named(self, importer, name, batch, sources):
        for source in sources:
            tag = source.cro.find_named_export(name)
            if tag is not None:
                address = source.tag_address(tag)
                self.import_symbols.setdefault(address, (source.name, tag, name))
                return self._apply_batch(importer, batch, address, source.name)
        return None

    def _resolve_module_imports(self, importer, target_name, indexed, anonymous, exporter):
        for index, batch in indexed:
            if not 0 <= index < len(exporter.cro.indexed_exports):
                self.problems.append((importer.name, 'import par numéro %d absent de %s' % (index, exporter.name)))
                continue
            tag = exporter.cro.indexed_exports[index]
            address = exporter.tag_address(tag)
            self.import_symbols.setdefault(address, (exporter.name, tag, None))
            reason = self._apply_batch(importer, batch, address, exporter.name)
            if reason:
                self.problems.append((importer.name, 'import par numéro %d de %s : %s' % (index, target_name, reason)))
        for tag, batch in anonymous:
            address = exporter.tag_address(tag)
            if address:
                self.import_symbols.setdefault(address, (exporter.name, tag, None))
            reason = self._apply_batch(importer, batch, address, exporter.name)
            if reason:
                self.problems.append((importer.name, 'import anonyme %#x de %s : %s' % (tag, target_name, reason)))

    def load(self, cro, base, data_address=None, bss_address=None):
        """LoadExeCRO avec liaison automatique. base : adresse du fichier ; .data et .bss juste après par défaut."""
        if cro.is_static:
            raise CroError('static.crs se donne au constructeur, pas à load()')
        if any(m.name == cro.name for m in self.chain):
            raise CroError('%s est déjà chargé' % cro.name)
        h = cro.header
        if data_address is None:
            data_address = base + align(len(cro.data), PAGE)
        if bss_address is None:
            bss_address = data_address + align(h['data_size'], 8)
        for problem in cro.ro_header_problems():
            self.problems.append((cro.name, 'en-tête refusé par ro : ' + problem))
        module = LoadedModule(cro, base, data_address, bss_address)
        self.memory.add(base, module.image)
        if module.data:
            self.memory.add(data_address, module.data)
            module.data[:h['data_size']] = cro.data[h['data_offset']:h['data_offset'] + h['data_size']]
        for address, size, kind in module.segments:
            if size and not (UNRESOLVED_SPACE[0] <= address and address + size <= UNRESOLVED_SPACE[1]):
                self.problems.append((cro.name, 'segment %s hors de la mémoire permise' % SEGMENT_KINDS.get(kind)))
        self._register_batches(module)
        self._reset_external(module)
        # Exports anonymes « statiques » : des mots du code principal à remplir avec une adresse de ce module.
        for tag, batch in cro.static_anonymous_exports:
            symbol = module.tag_address(tag)
            for patch in self._static_batch(cro, batch):
                address = self.static.tag_address(patch.tag)
                reason = relocate(self.memory, address, patch.type, patch.addend, symbol, address)
                if reason:
                    self.problems.append((cro.name, 'correction statique %d : %s' % (patch.index, reason)))
        # Corrections internes (ro, 0x140077c8).
        for patch in cro.internal_patches:
            place = module.tag_address(patch.tag)
            symbol = module.segments[patch.flag][0] if patch.flag < len(module.segments) else 0
            if not place or not symbol:
                self.problems.append((cro.name, 'correction interne %d hors de son segment (cible %#x, segment du symbole %d)'
                                      % (patch.index, patch.tag, patch.flag)))
                continue
            reason = relocate(self.memory, place, patch.type, patch.addend, symbol, place)
            if reason:
                self.problems.append((cro.name, 'correction interne %d : %s' % (patch.index, reason)))
            self.patch_log['interne_%s' % PATCH_TYPES.get(patch.type, patch.type)] += 1
        # __aeabi_atexit -> nnroAeabiAtexit_ (ro, 0x140041c0).
        for name, batch in cro.named_imports:
            if name == '__aeabi_atexit':
                for source in self.chain:
                    tag = source.cro.find_named_export('nnroAeabiAtexit_')
                    if tag is not None:
                        self._apply_batch(module, batch, source.tag_address(tag), source.name)
                        break
        # Lier (ro, 0x140063d4) : ce que le module importe des modules chargés...
        for name, batch in cro.named_imports:
            if self.resolution.get((cro.name, batch)) is None:
                self._resolve_named(module, name, batch, self.chain)
        for target, indexed, anonymous in cro.import_modules:
            exporter = next((m for m in self.chain if m.name == target), None)
            if exporter:
                self._resolve_module_imports(module, target, indexed, anonymous, exporter)
        # ... puis ce que les modules chargés, static.crs compris, importent du nouveau.
        for other in self.chain:
            for name, batch in other.cro.named_imports:
                if self.resolution.get((other.name, batch)) is None:
                    self._resolve_named(other, name, batch, [module])
            for target, indexed, anonymous in other.cro.import_modules:
                if target == cro.name:
                    self._resolve_module_imports(other, target, indexed, anonymous, module)
                    break
        self.chain.append(module)
        return module

    def _static_batch(self, cro, batch_offset):
        start, count = cro.tables['static_patches']
        first = (batch_offset - start) // 12
        out = []
        for patch in cro.static_patches[first:]:
            out.append(patch)
            if patch.flag:
                break
        return out

    def module(self, name):
        return next((m for m in self.chain if m.name == name), None)

    def unresolved(self):
        """[(module importateur, genre, détail, raison)] pour chaque liste de corrections restée sans symbole."""
        loaded = {m.name for m in self.chain}
        out = []
        for (importer, batch), result in sorted(self.resolution.items()):
            if result is not None:
                continue
            kind, detail = self.batch_owner[(importer, batch)]
            if kind == 'nom':
                reason = 'aucun module chargé n\'exporte ce nom'
            else:
                target = detail[0]
                reason = ('module %s pas chargé' % target) if target not in loaded else 'symbole introuvable dans %s' % target
            out.append((importer, kind, detail, reason))
        return out


# --- Placement ---

def layout(cros, base=MODULES_BASE):
    """{nom: (fichier, .data, .bss)} : une place fixe par module, dans l'ordre donné (voir la docstring)."""
    places = {}
    cursor = base
    for cro in cros:
        h = cro.header
        file_address = cursor
        data_address = file_address + align(len(cro.data), PAGE)
        bss_address = data_address + align(h['data_size'], 8)
        places[cro.name] = (file_address, data_address, bss_address)
        cursor = align(bss_address + h['bss_size'], PAGE)
    return places


def read_romfs(folder):
    """Lit static.crs et tous les .cro du dossier : (crs, [cro triés par nom de fichier], static.crr ou None)."""
    names = sorted(n for n in os.listdir(folder) if n.lower().endswith('.cro'))
    crs = Cro(open(os.path.join(folder, 'static.crs'), 'rb').read(), 'static.crs')
    cros = [Cro(open(os.path.join(folder, n), 'rb').read(), n) for n in names]
    crr_path = os.path.join(folder, '.crr', 'static.crr')
    crr = open(crr_path, 'rb').read() if os.path.isfile(crr_path) else None
    return crs, cros, crr


def find_code(folder, explicit=None):
    path = explicit or os.path.join(os.path.dirname(os.path.abspath(folder)), 'exefs', 'code.bin')
    if os.path.isfile(path):
        return open(path, 'rb').read(), path
    return None, None


def link_set(crs, cros, main_code, only=None):
    """Charge les modules (tous, ou ceux de only dans cet ordre) à leur place fixe. Rend le Linker."""
    places = layout(cros)
    by_name = {c.name: c for c in cros}
    order = only if only else [c.name for c in cros]
    linker = Linker(crs, main_code)
    for name in order:
        if name not in by_name:
            raise CroError('module %s absent du dossier' % name)
        linker.load(by_name[name], *places[name])
    return linker, places


# --- Noms ---

def read_names(path):
    """fiches/<module>.noms.tsv : {adresse: nom}."""
    names = {}
    if path and os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                parts = line.rstrip('\n').split('\t')
                if len(parts) >= 3 and parts[0].startswith('0x'):
                    names[int(parts[0], 16)] = parts[2]
    return names


def read_ghidra_functions(path):
    """funcs.tsv de ghidra_direct.py : {adresse: « arm » ou « thumb »}."""
    out = {}
    if path and os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                parts = line.rstrip('\n').split('\t')
                if len(parts) >= 3 and parts[0].startswith('0x'):
                    out[int(parts[0], 16)] = parts[2]
    return out


def read_ghidra_owners(path):
    """refs.tsv de ghidra_direct.py : {adresse d'une instruction qui fait référence: début de la fonction qui la contient}."""
    out = {}
    if path and os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                parts = line.rstrip('\n').split('\t')
                if len(parts) >= 4 and parts[3]:
                    out[int(parts[0], 16)] = int(parts[3], 16)
    return out


def symbol_name(module_name, segment_kind, offset):
    owner = 'static' if module_name == STATIC_NAME else module_name
    return '%s_%s_%08x' % (owner, SEGMENT_KINDS.get(segment_kind, 'seg'), offset)


def collect_symbols(linker, modules, known_names):
    """[(adresse, nom, genre)] avec genre 'func' ou 'data' ; l'adresse garde le bit Thumb des fonctions."""
    symbols = {}
    duplicate_names = collections.Counter(name for m in modules for name, _ in m.cro.named_exports)
    def add(address, name, module, tag):
        if not address:
            return
        segment, _ = split_tag(tag)
        kind = module.segments[segment][2] if segment < len(module.segments) else 1
        symbols.setdefault(address, (name, 'func' if kind == 0 else 'data'))
    for module in modules:
        cro = module.cro
        for name, tag in cro.named_exports:
            # Un nom exporté par plusieurs modules (nnroControlObject_ partout, une méthode de xy_system dans 46
            # modules et dans static.crs) reçoit le nom du module devant, sauf dans le code principal.
            if not module.cro.is_static and duplicate_names[name] > 1:
                name = '%s_%s' % (module.name, name)
            add(module.tag_address(tag), name, module, tag)
        for field, label in (('on_load', 'OnLoad'), ('on_exit', 'OnExit'), ('on_unresolved', 'OnUnresolved')):
            tag = cro.header[field]
            if tag != NO_TAG:
                add(module.tag_address(tag), '%s_%s' % (module.name.strip('|'), label), module, tag)
    for address, (exporter, tag, name) in sorted(linker.import_symbols.items()):
        module = linker.module(exporter)
        segment, offset = split_tag(tag)
        if exporter == STATIC_NAME:
            plain = known_names.get(address & ~1) or known_names.get(address)
            label = plain or 'static_%08x' % (address & ~1)
        else:
            label = name or symbol_name(exporter, module.segments[segment][2], offset)
        add(address, label, module, tag)
    return sorted((address, name, kind) for address, (name, kind) in symbols.items())


def write_names_tsv(path, symbols):
    """Au format du carnet : « 0xADRESSE <TAB> function|label <TAB> nom ». Le Thumb et les données en label."""
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        for address, name, kind in symbols:
            arm_function = kind == 'func' and not address & 1
            f.write('%#x\t%s\t%s\n' % (address & ~1 if kind == 'func' else address, 'function' if arm_function else 'label', name))


# --- ELF ---

SHF_WRITE, SHF_ALLOC, SHF_EXECINSTR = 1, 2, 4
SHT_PROGBITS, SHT_SYMTAB, SHT_STRTAB, SHT_NOBITS = 1, 2, 3, 8
STT_NOTYPE, STT_OBJECT, STT_FUNC = 0, 1, 2
STB_GLOBAL = 1


def build_elf(sections, symbols, entry):
    """sections : [(nom, adresse, octets ou None pour un bloc sans contenu, taille, 'rx'|'r'|'rw')].
    symbols : [(nom, valeur, type ELF)]. Un ELF exécutable ARM avec un segment chargeable par section, des en-têtes
    de section et une table de symboles : Ghidra en fait un bloc par section et pose un nom par symbole."""
    shstr = bytearray(b'\0')
    def add_name(table, text):
        offset = len(table)
        table.extend(text.encode('utf-8') + b'\0')
        return offset
    ehsize, phsize, shsize = 52, 32, 40
    count = len(sections)
    data_start = align(ehsize + phsize * count, PAGE)
    blobs = []
    cursor = data_start
    placed = []
    for name, address, content, size, flags in sections:
        if content is not None:
            cursor = align(cursor, PAGE) + (address % PAGE)
            if cursor < data_start:
                cursor += PAGE
            placed.append(cursor)
            blobs.append((cursor, content))
            cursor += len(content)
        else:
            placed.append(cursor)
    strtab = bytearray(b'\0')
    sym_entries = [struct.pack('<IIIBBH', 0, 0, 0, 0, 0, 0)]
    def section_index(value):
        for i, (_, address, _, size, _) in enumerate(sections):
            if address <= (value & ~1) < address + max(size, 1):
                return i + 1
        return 0xFFF1
    for name, value, kind in symbols:
        sym_entries.append(struct.pack('<IIIBBH', add_name(strtab, name), value, 0, (STB_GLOBAL << 4) | kind, 0,
                                       section_index(value)))
    symtab = b''.join(sym_entries)
    symtab_offset = align(cursor, 4)
    strtab_offset = symtab_offset + len(symtab)
    shstr_names = [add_name(shstr, s[0]) for s in sections]
    symtab_name, strtab_name, shstr_name = add_name(shstr, '.symtab'), add_name(shstr, '.strtab'), add_name(shstr, '.shstrtab')
    shstr_offset = strtab_offset + len(strtab)
    sh_offset = align(shstr_offset + len(shstr), 4)
    out = bytearray(sh_offset + shsize * (count + 4))
    struct.pack_into('<4sBBBBB7xHHIIIIIHHHHHH', out, 0, b'\x7fELF', 1, 1, 1, 0, 0, 2, 40, 1, entry, ehsize, sh_offset,
                     0x05000000, ehsize, phsize, count, shsize, count + 4, count + 3)
    for i, ((name, address, content, size, flags), offset) in enumerate(zip(sections, placed)):
        p_flags = (4 if 'r' in flags else 0) | (2 if 'w' in flags else 0) | (1 if 'x' in flags else 0)
        file_size = len(content) if content is not None else 0
        struct.pack_into('<IIIIIIII', out, ehsize + phsize * i, 1, offset, address, address, file_size, size, p_flags, PAGE)
    for offset, content in blobs:
        out[offset:offset + len(content)] = content
    out[symtab_offset:symtab_offset + len(symtab)] = symtab
    out[strtab_offset:strtab_offset + len(strtab)] = strtab
    out[shstr_offset:shstr_offset + len(shstr)] = shstr
    headers = [struct.pack('<10I', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)]
    for (name, address, content, size, flags), offset, name_offset in zip(sections, placed, shstr_names):
        sh_flags = SHF_ALLOC | (SHF_WRITE if 'w' in flags else 0) | (SHF_EXECINSTR if 'x' in flags else 0)
        headers.append(struct.pack('<10I', name_offset, SHT_PROGBITS if content is not None else SHT_NOBITS, sh_flags,
                                   address, offset, size, 0, 0, 4, 0))
    headers.append(struct.pack('<10I', symtab_name, SHT_SYMTAB, 0, 0, symtab_offset, len(symtab), count + 2, 1, 4, 16))
    headers.append(struct.pack('<10I', strtab_name, SHT_STRTAB, 0, 0, strtab_offset, len(strtab), 0, 0, 1, 0))
    headers.append(struct.pack('<10I', shstr_name, SHT_STRTAB, 0, 0, shstr_offset, len(shstr), 0, 0, 1, 0))
    out[sh_offset:] = b''.join(headers)
    return bytes(out)


def read_elf(elf):
    """Relit un ELF de build_elf : ({nom de section: (adresse, octets ou None, taille)}, {nom de symbole: valeur})."""
    shoff, = struct.unpack_from('<I', elf, 32)
    shnum, shstrndx = struct.unpack_from('<HH', elf, 48)
    headers = [struct.unpack_from('<10I', elf, shoff + 40 * i) for i in range(shnum)]
    shstr = headers[shstrndx]
    def name_at(table, offset):
        return elf[table[4] + offset:elf.index(b'\0', table[4] + offset)].decode('utf-8')
    sections, symbols = {}, {}
    for h in headers[1:]:
        name = name_at(shstr, h[0])
        if h[1] in (SHT_PROGBITS, SHT_NOBITS) and h[2] & SHF_ALLOC:
            sections[name] = (h[3], elf[h[4]:h[4] + h[5]] if h[1] == SHT_PROGBITS else None, h[5])
        if h[1] == SHT_SYMTAB:
            strtab = headers[h[6]]
            for i in range(1, h[5] // 16):
                st_name, value, _, info, _, _ = struct.unpack_from('<IIIBBH', elf, h[4] + 16 * i)
                symbols[name_at(strtab, st_name)] = value
    return sections, symbols


def main_sections(linker, code_path, ghost):
    """Les sections du code principal, d'après exheader.bin s'il est à côté de code.bin, sinon d'après static.crs."""
    segments = []
    exheader = os.path.join(os.path.dirname(code_path), 'exheader.bin') if code_path else None
    if exheader and os.path.isfile(exheader):
        ex = open(exheader, 'rb').read()
        text, ro, data = (struct.unpack_from('<III', ex, o) for o in (0x10, 0x20, 0x30))
        bss = u32(ex, 0x3C)
        segments = [('text', text[0], text[2]), ('rodata', ro[0], ro[2]), ('data', data[0], data[2] + bss)]
        file_sizes = {'text': text[2], 'rodata': ro[2], 'data': data[2]}
    else:
        for address, size, kind in linker.static.segments[:3]:
            segments.append((SEGMENT_KINDS[kind], address, size))
        file_sizes = {name: size for name, _, size in segments}
    out = []
    for kind, address, size in segments:
        content = None
        if not ghost and linker.main_code is not None:
            start = address - MAIN_BASE
            content = bytes(linker.main_code[start:start + file_sizes[kind]])
            if len(content) < size:
                content = content + bytes(size - len(content))
        out.append(('.static.%s' % kind, address, content, size, SEGMENT_FLAGS[{'text': 0, 'rodata': 1, 'data': 2}[kind]]))
    return out


def module_sections(module, ghost=False):
    out = []
    cro = module.cro
    for (address, size, kind), (offset, _, _) in zip(module.segments, cro.segments):
        if not size or kind not in SEGMENT_KINDS:
            continue
        if ghost or kind == 3:
            content = None
        elif kind == 2:
            content = bytes(module.data[:size])
        else:
            content = bytes(module.image[offset:offset + size])
        out.append(('.%s.%s' % (module.name, SEGMENT_KINDS[kind]), address, content, size, SEGMENT_FLAGS[kind]))
    return out


def elf_symbols(symbols, sections):
    out = []
    for address, name, kind in symbols:
        target = next((s for s in sections if s[1] <= (address & ~1) < s[1] + max(s[3], 1)), None)
        if target is None:
            continue
        if target[2] is None:
            # Dans un bloc sans octets, une simple étiquette : un symbole impair y ferait créer une fonction Thumb
            # que Ghidra ne peut pas désassembler.
            out.append((name, address & ~1, STT_NOTYPE))
        else:
            out.append((name, address, STT_FUNC if kind == 'func' else STT_OBJECT))
    return out


# --- Rapport ---

def module_report(linker, module):
    cro = module.cro
    h = cro.header
    lines = ['== %s (%s) : fichier à %#x, .data à %#x, .bss à %#x' % (cro.name, cro.file_name, module.base,
                                                                   module.data_address, module.bss_address)]
    for (address, size, kind), (offset, _, _) in zip(module.segments, cro.segments):
        if size:
            lines.append('   %-7s %#010x  %#8x octets  (fichier %#x)' % (SEGMENT_KINDS.get(kind, kind), address, size, offset))
    bad = [n for n, expected, computed in cro.hashes() if expected != computed]
    lines.append('   empreintes : %s' % ('bonnes' if not bad else 'FAUSSES : ' + ', '.join(bad)))
    lines.append('   exports par nom : %d ; corrections internes : %d ; listes d\'imports : %d' % (
        len(cro.named_exports), len(cro.internal_patches), sum(len(i) + len(a) for _, i, a in cro.import_modules) + len(cro.named_imports)))
    for target, indexed, anonymous in cro.import_modules:
        resolved = sum(1 for _, b in indexed + anonymous if linker.resolution.get((cro.name, b)))
        lines.append('   importe de %-28s %4d symboles, %4d résolus' % (target, len(indexed) + len(anonymous), resolved))
    for field in ('on_load', 'on_exit', 'on_unresolved'):
        if h[field] != NO_TAG:
            lines.append('   %s : %#x' % (field, module.tag_address(h[field])))
    return lines


def write_report(path, linker, modules, extra=()):
    lines = ['Chargement de %d module(s) par cro_loader.py' % len(modules), '']
    lines.extend(extra)
    unresolved = linker.unresolved()
    lines.append('Listes d\'imports non résolues : %d' % len(unresolved))
    by_reason = collections.Counter((importer, reason) for importer, _, _, reason in unresolved)
    for (importer, reason), count in sorted(by_reason.items()):
        lines.append('   %-28s %4d  %s' % (importer, count, reason))
    lines.append('Problèmes relevés pendant le chargement : %d' % len(linker.problems))
    for module, text in linker.problems[:200]:
        lines.append('   %s : %s' % (module, text))
    lines.append('Corrections appliquées : ' + ', '.join('%s %d' % kv for kv in sorted(linker.patch_log.items())))
    lines.append('')
    for module in modules:
        lines.extend(module_report(linker, module))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')


# --- Commandes ---

def command_info(path):
    cro = Cro(open(path, 'rb').read(), os.path.basename(path))
    h = cro.header
    print('%s : module « %s », %d octets%s' % (cro.file_name, cro.name, len(cro.data), ' (code principal)' if cro.is_static else ''))
    for name in ('bss_size', 'code_offset', 'code_size', 'data_offset', 'data_size'):
        print('   %-16s %#x' % (name, h[name]))
    for field in ('control_object', 'on_load', 'on_exit', 'on_unresolved'):
        tag = h[field]
        print('   %-16s %s' % (field, 'aucun' if tag == NO_TAG else 'segment %d + %#x' % split_tag(tag)))
    print('   segments :')
    for i, (offset, size, kind) in enumerate(cro.segments):
        print('      %d  %-7s %s %#x, %#x octets' % (i, SEGMENT_KINDS.get(kind, kind), 'adresse' if cro.is_static else 'décalage', offset, size))
    print('   tables :')
    for _, name, entry in TABLES:
        start, count = cro.tables[name]
        print('      %-26s à %#8x : %d %s' % (name, start, count, 'octets' if entry == 1 else 'cases'))
    for name, expected, computed in cro.hashes():
        print('   empreinte %-9s %s' % (name, 'bonne' if expected == computed else 'FAUSSE'))
    problems = cro.ro_header_problems()
    print('   règles de ro sur l\'en-tête : %s' % ('respectées' if not problems else '; '.join(problems)))
    print('   taille gardée après finition au niveau 1 : %#x' % align(cro.fixed_end(1), PAGE))
    tree_ok = sum(1 for name, tag in cro.named_exports if cro.find_named_export(name) == tag)
    print('   exports par nom : %d (retrouvés par l\'arbre : %d)' % (len(cro.named_exports), tree_ok))
    for name, tag in cro.named_exports[:20]:
        print('      %-60s segment %d + %#x' % ((name,) + split_tag(tag)))
    if len(cro.named_exports) > 20:
        print('      ...')
    print('   imports : %d par nom, %d par numéro, %d anonymes, %d corrections ; %d corrections internes' % (
        len(cro.named_imports), len(cro.indexed_imports), len(cro.anonymous_imports), len(cro.external_patches), len(cro.internal_patches)))
    for target, indexed, anonymous in cro.import_modules:
        print('      de %-30s %d par numéro, %d anonymes' % (target, len(indexed), len(anonymous)))
    types = collections.Counter(PATCH_TYPES.get(p.type, p.type) for p in cro.internal_patches + cro.external_patches)
    print('   types de correction : ' + ', '.join('%s %d' % kv for kv in sorted(types.items())))


def parse_options(args):
    options = {'only': None, 'out': DEFAULT_OUT, 'code': None, 'each': False}
    rest = []
    i = 0
    while i < len(args):
        if args[i] == '--only':
            options['only'] = [n for n in args[i + 1].split(',') if n]
            i += 2
        elif args[i] == '--out':
            options['out'] = args[i + 1]
            i += 2
        elif args[i] == '--code':
            options['code'] = args[i + 1]
            i += 2
        elif args[i] == '--each':
            options['each'] = True
            i += 1
        else:
            rest.append(args[i])
            i += 1
    return options, rest


def write_linked(linker, places, code_path, out, label, names, each=False):
    """Écrit <label>.elf (le code principal et les modules chargés), .noms.tsv et .rapport.txt."""
    os.makedirs(out, exist_ok=True)
    modules = linker.chain[1:]
    symbols = collect_symbols(linker, linker.chain, names)
    sections = main_sections(linker, code_path, ghost=linker.main_code is None)
    for module in modules:
        sections += module_sections(module)
    elf = build_elf(sections, elf_symbols(symbols, sections), MAIN_BASE)
    with open(os.path.join(out, label + '.elf'), 'wb') as f:
        f.write(elf)
    write_names_tsv(os.path.join(out, label + '.noms.tsv'), symbols)
    write_report(os.path.join(out, label + '.rapport.txt'), linker, modules)
    written = [label + '.elf']
    if each:
        for module in modules:
            write_module_elf(linker, module, code_path, out, names, symbols)
            written.append(module.name + '.elf')
    return written


def write_module_elf(linker, module, code_path, out, names, symbols=None):
    """Un ELF pour un module : ses segments, plus le code principal et les modules qu'il importe en blocs vides."""
    symbols = symbols if symbols is not None else collect_symbols(linker, linker.chain, names)
    sections = module_sections(module)
    targets = {t for t, _, _ in module.cro.import_modules} | {o.name for o in linker.chain[1:]
                                                              if any(t == module.name for t, _, _ in o.cro.import_modules)}
    sections += main_sections(linker, code_path, ghost=True)
    for other in linker.chain[1:]:
        if other is not module and other.name in targets:
            sections += module_sections(other, ghost=True)
    # Seuls les symboles du module et les cibles de SES imports : pas les milliers de noms du code principal.
    own = [s for s in sections if s[2] is not None or s[0].startswith('.%s.' % module.name)]
    wanted = linker.module_targets.get(module.name, set())
    lines = [(a, n, k) for a, n, k in symbols
             if a in wanted or any(s[1] <= (a & ~1) < s[1] + max(s[3], 1) for s in own)]
    elf = build_elf(sections, elf_symbols(lines, sections), module.segments[0][0] if module.segments else 0)
    with open(os.path.join(out, module.name + '.elf'), 'wb') as f:
        f.write(elf)
    write_names_tsv(os.path.join(out, module.name + '.noms.tsv'), lines)


def command_link(folder, options):
    crs, cros, _ = read_romfs(folder)
    code, code_path = find_code(folder, options['code'])
    linker, places = link_set(crs, cros, code, options['only'])
    label = 'tout' if not options['only'] else '+'.join(options['only'])
    if len(label) > 80:
        label = label[:60] + '+%d' % len(options['only'])
    written = write_linked(linker, places, code_path, options['out'], label, read_names(NAMES_FILE), options['each'])
    unresolved = linker.unresolved()
    print('%d module(s) chargés%s ; %d listes d\'imports non résolues ; %d problème(s)' % (
        len(linker.chain) - 1, ' avec le code principal' if code is not None else ' (code.bin introuvable)',
        len(unresolved), len(linker.problems)))
    print('-> %s : %s' % (options['out'], ', '.join(written[:5]) + (' ...' if len(written) > 5 else '')))


# --- Validation ---

def arm_branch_target(word, address):
    offset = word & 0xFFFFFF
    if offset & 0x800000:
        offset -= 1 << 24
    return address + 8 + (offset << 2)


def arm_pc_relative(word, address):
    """« add Rd, pc, #imm » ou « sub Rd, pc, #imm » -> (Rd, adresse), sinon None."""
    if word >> 28 != 0xE or (word & 0x0FFF0000) not in (0x028F0000, 0x024F0000):
        return None
    rotate = (word >> 8 & 0xF) * 2
    immediate = word & 0xFF
    immediate = ((immediate >> rotate) | (immediate << (32 - rotate))) & 0xFFFFFFFF if rotate else immediate
    sign = 1 if (word & 0x0FFF0000) == 0x028F0000 else -1
    return word >> 12 & 0xF, address + 8 + sign * immediate


def find_load_sites(code, functions):
    """Les appels du code principal aux fonctions de chargement du gestionnaire de modules, avec le nom du module
    (chaîne « rom2:/X.cro » posée dans r0 ou r1 par un « add rX, pc, #imm » juste avant). Rend
    [(adresse de l'appel, fonction appelante, fonction appelée, nom du module)]."""
    starts = sorted(functions)
    out = []
    text_end = min(len(code), 0x43F000)
    for offset in range(0, text_end - 3, 4):
        word = u32(code, offset)
        if word & 0x0F000000 != 0x0B000000 or word >> 28 != 0xE:
            continue
        address = MAIN_BASE + offset
        target = arm_branch_target(word, address)
        if target not in LOAD_FUNCTIONS:
            continue
        register = LOAD_FUNCTIONS[target][1]
        module = None
        # On remonte au plus 12 instructions en suivant le registre de l'argument : « add rX, pc, #imm » ou
        # « ldr rX, [pc, #imm] » donnent l'adresse de la chaîne ; « mov rX, rY » fait suivre rY.
        for back in range(1, 13):
            at = address - 4 * back
            previous = u32(code, at - MAIN_BASE)
            string = None
            hit = arm_pc_relative(previous, at)
            if hit and hit[0] == register:
                string = hit[1]
            elif previous & 0x0F7F0000 == 0x051F0000 and previous >> 28 == 0xE and previous >> 12 & 0xF == register:
                literal = at + 8 + (previous & 0xFFF) * (1 if previous & 0x00800000 else -1)
                string = u32(code, literal - MAIN_BASE)
            elif previous & 0x0FEF0FF0 == 0x01A00000 and previous >> 28 == 0xE and previous >> 12 & 0xF == register:
                register = previous & 0xF
                continue
            elif previous >> 12 & 0xF == register and previous >> 28 == 0xE and previous & 0x0C000000 == 0:
                break               # une autre instruction de calcul écrit le registre : on ne sait plus
            elif previous & 0xFFFF0000 == 0xE92D0000:
                break               # début de la fonction
            if string is not None:
                if MAIN_BASE <= string < MAIN_BASE + len(code):
                    match = re.match(r'rom2?:/(\w+)\.cro$', c_string(code, string - MAIN_BASE))
                    module = match.group(1) if match else None
                break
        index = bisect.bisect_right(starts, address) - 1
        out.append((address, starts[index] if index >= 0 else None, LOAD_FUNCTIONS[target][0], module))
    return out


def command_verify(folder, options):
    out_lines = []
    def say(text=''):
        print(text)
        out_lines.append(text)
    crs, cros, crr = read_romfs(folder)
    code, code_path = find_code(folder, options['code'])
    everything = [crs] + cros
    say('Validation de cro_loader.py sur %s : %d .cro et static.crs' % (folder, len(cros)))
    # 1. En-têtes et règles de ro.
    refused = [(c.name, p) for c in everything for p in c.ro_header_problems()]
    say('1. En-têtes lus sans erreur : %d sur %d ; refusés par les règles de ro : %d' % (len(everything), len(everything), len(refused)))
    for name, problem in refused[:10]:
        say('      %s : %s' % (name, problem))
    # 2. Empreintes.
    bad = [(c.name, n) for c in everything for n, e, h in c.hashes() if e != h]
    say('2. Empreintes recalculées : %d sur %d bonnes' % (4 * len(everything) - len(bad), 4 * len(everything)))
    if crr is not None:
        allowed = read_crr(crr)
        found = sum(1 for c in cros if c.crr_hash() in allowed)
        say('   static.crr : %d empreintes ; %d des %d .cro y sont ; static.crs y est : %s' % (
            len(allowed), found, len(cros), 'oui' if crs.crr_hash() in allowed else 'non'))
    # 3. Arbre des exports et noms C++.
    tree_total = sum(len(c.named_exports) for c in everything)
    tree_ok = sum(1 for c in everything for n, t in c.named_exports if c.find_named_export(n) == t)
    say('3. Exports par nom retrouvés par l\'arbre de recherche, comme ro les cherche : %d sur %d' % (tree_ok, tree_total))
    names = read_names(NAMES_FILE)
    crs_by_address = collections.defaultdict(set)
    for name, tag in crs.named_exports:
        segment, offset = split_tag(tag)
        crs_by_address[crs.segments[segment][0] + offset].add(name)
    agree = sum(1 for a, ns in crs_by_address.items() if names.get(a & ~1) in ns or names.get(a) in ns)
    say('   static.crs : %d exports par nom, %d adresses ; le nom de pokemon-x.noms.tsv est l\'un des leurs pour %d'
        % (len(crs.named_exports), len(crs_by_address), agree))
    crs_names = {n for n, _ in crs.named_exports}
    module_exports = collections.Counter(n for c in cros for n, _ in c.named_exports)
    shared = sorted(n for n in module_exports if n in crs_names)
    say('   exports des modules : %d noms, %d distincts ; nnroControlObject_ dans %d modules ; '
        'noms aussi exportés par static.crs : %d' % (sum(module_exports.values()), len(module_exports),
                                                     module_exports['nnroControlObject_'], len(shared)))
    for name in sorted(module_exports):
        if name == 'nnroControlObject_':
            continue
        same_place = len({(c.tag_file_offset(t) is not None) and c.data[c.tag_file_offset(t):c.tag_file_offset(t) + 16]
                          for c in cros for n, t in c.named_exports if n == name})
        say('   %s : exporté par %d modules%s ; les 16 premiers octets du code sont %s d\'un module à l\'autre' % (
            name, module_exports[name], ' et par static.crs' if name in crs_names else '',
            'identiques' if same_place == 1 else 'différents (%d variantes)' % same_place))
    # 4. Bornes des corrections.
    out_of_bounds = collections.Counter()
    for c in everything:
        for p in c.internal_patches:
            segment, offset = split_tag(p.tag)
            if segment >= len(c.segments) or offset + 4 > c.segments[segment][1]:
                out_of_bounds['cible interne'] += 1
            if p.flag >= len(c.segments):
                out_of_bounds['segment du symbole interne inexistant'] += 1
            elif not c.segments[p.flag][1]:
                # ro accepte : le symbole est l'adresse du segment, non nulle tant que son décalage ne l'est pas.
                out_of_bounds['symbole au début d\'un segment vide, ' + (
                    'accepté par ro (décalage non nul)' if c.segments[p.flag][0] else 'refusé par ro (décalage nul)')] += 1
            elif not 0 <= p.addend <= c.segments[p.flag][1]:
                out_of_bounds['ajout hors du segment du symbole (pointeur calculé)'] += 1
        for p in c.external_patches:
            segment, offset = split_tag(p.tag)
            if segment >= len(c.segments) or offset + 4 > c.segments[segment][1]:
                out_of_bounds['cible d\'import'] += 1
        for target, indexed, anonymous in c.import_modules:
            exporter = crs if target == STATIC_NAME else next((x for x in cros if x.name == target), None)
            for tag, _ in anonymous:
                if exporter is not None and exporter.tag_file_offset(tag) is None and not exporter.is_static:
                    out_of_bounds['symbole anonyme hors du segment exportateur'] += 1
                if exporter is not None and exporter.is_static:
                    segment, offset = split_tag(tag)
                    if segment >= len(exporter.segments) or offset >= exporter.segments[segment][1]:
                        out_of_bounds['symbole anonyme hors du code principal'] += 1
    types = collections.Counter(PATCH_TYPES.get(p.type, p.type) for c in everything for p in c.internal_patches + c.external_patches)
    targets = collections.Counter((SEGMENT_KINDS[c.segments[split_tag(p.tag)[0]][2]], 'interne' if internal else 'import')
                                  for c in everything for internal, ps in ((True, c.internal_patches), (False, c.external_patches))
                                  for p in ps)
    say('4. Corrections : %d internes, %d d\'imports ; types : %s' % (
        sum(len(c.internal_patches) for c in everything), sum(len(c.external_patches) for c in everything),
        ', '.join('%s %d' % kv for kv in sorted(types.items()))))
    say('   segments visés : ' + ', '.join('%s %s %d' % (k[1], k[0], v) for k, v in sorted(targets.items())))
    say('   hors bornes : ' + (', '.join('%s %d' % kv for kv in sorted(out_of_bounds.items())) or 'aucune'))
    # 5. Liaison complète.
    linker, places = link_set(crs, cros, code)
    unresolved = linker.unresolved()
    total_batches = len(linker.resolution)
    say('5. Tout chargé ensemble (%d modules, de %#x à %#x) : %d listes d\'imports, %d non résolues ; %d problème(s)' % (
        len(cros), MODULES_BASE, max(m.end() for m in linker.chain[1:]), total_batches, len(unresolved), len(linker.problems)))
    for importer, kind, detail, reason in unresolved[:10]:
        say('      %s : %s %s : %s' % (importer, kind, detail, reason))
    for module, text in linker.problems[:10]:
        say('      %s : %s' % (module, text))
    crs_batches = [(k, v) for k, v in linker.resolution.items() if k[0] == STATIC_NAME]
    say('   mots du code principal remplis par un module (static.crs) : %d listes, %d résolues' % (
        len(crs_batches), sum(1 for _, v in crs_batches if v)))
    if code is not None:
        changed = sum(1 for p in crs.external_patches if linker.memory.read32(linker.static.tag_address(p.tag)) != u32(code, linker.static.tag_address(p.tag) - MAIN_BASE))
        say('   mots de code.bin changés par la liaison : %d sur %d corrections de static.crs (avant : 0x4d7bc0 partout)' % (
            changed, len(crs.external_patches)))
        with_addend = [p for p in crs.external_patches if p.addend]
        say("   dès Initialize, ro y écrit OnUnresolved + ajout : %d mots ont un ajout (%s) et passent donc de 0x4d7bc0 à "
            "autre chose avant tout chargement" % (len(with_addend), ', '.join(sorted({'+%d' % p.addend for p in with_addend}))))
    # Chargement isolé : chaque module seul avec static.crs, pour compter ce qui dépend d'un autre module.
    alone = collections.Counter()
    for c in cros:
        single, _ = link_set(crs, cros, None, [c.name])
        for importer, kind, detail, reason in single.unresolved():
            if importer == c.name:
                alone[detail[0] if kind != 'nom' else '(nom)'] += 1
    say('   chaque module chargé seul avec static.crs : %d listes restent sans symbole, toutes vers un autre module '
        '(%d modules exportateurs)' % (sum(alone.values()), len(alone)))
    # 6. Imports vers le code principal : débuts de fonction ?
    ghidra = read_ghidra_functions(options.get('functions') or GHIDRA_FUNCTIONS)
    text_start, text_size, _ = crs.segments[0]
    main_targets = {}
    for c in cros:
        for target, indexed, anonymous in c.import_modules:
            if target == STATIC_NAME:
                for tag, _ in anonymous:
                    address = linker.static.tag_address(tag)
                    main_targets.setdefault(address, set()).add(c.name)
    text_targets = sorted(a for a in main_targets if text_start <= a < text_start + text_size)
    data_targets = len(main_targets) - len(text_targets)
    in_ghidra = [a for a in text_targets if (a & ~1) in ghidra]
    mode_ok = [a for a in in_ghidra if ghidra[a & ~1] == ('thumb' if a & 1 else 'arm')]
    in_names = [a for a in text_targets if (a & ~1) in names]
    either = [a for a in text_targets if (a & ~1) in ghidra or (a & ~1) in names]
    say('6. Adresses du code principal importées par les modules : %d distinctes, %d dans .text, %d dans les données' % (
        len(main_targets), len(text_targets), data_targets))
    if ghidra:
        say('   débuts de fonction de Ghidra (%s, %d fonctions) : %d sur %d ; mode ARM/Thumb d\'accord avec le bit 0 : %d' % (
            os.path.relpath(options.get('functions') or GHIDRA_FUNCTIONS, ROOT), len(ghidra), len(in_ghidra), len(text_targets), len(mode_ok)))
    say('   noms de pokemon-x.noms.tsv : %d ; l\'un ou l\'autre : %d' % (len(in_names), len(either)))
    missing = [a for a in text_targets if (a & ~1) not in ghidra and (a & ~1) not in names]
    if code is not None and missing:
        pushes = sum(1 for a in missing if (a & 1 and code[(a & ~1) - MAIN_BASE + 1] == 0xB5) or
                     (not a & 1 and u32(code, a - MAIN_BASE) & 0xFFFF4000 == 0xE92D4000))
        say('   les %d autres : %d en Thumb ; %d commencent par un « push {..., lr} », les autres sont surtout des fonctions '
            "feuilles (lecture d'un champ puis « bx lr »)" % (len(missing), sum(1 for a in missing if a & 1), pushes))
        owners = read_ghidra_owners(os.path.join(os.path.dirname(options.get('functions') or GHIDRA_FUNCTIONS), 'refs.tsv'))
        if owners:
            sources = sorted(owners)
            inside = []
            for a in missing:
                k = bisect.bisect_left(sources, a & ~1)
                if k < len(sources) and sources[k] - (a & ~1) < 0x30 and owners[sources[k]] < (a & ~1):
                    inside.append((a, owners[sources[k]]))
            say("   d'après refs.tsv de Ghidra : %d tombent dans du code que Ghidra n'a jamais lu (rien ne les appelle dans le "
                "code principal), %d au milieu d'une fonction de Ghidra : %s" % (len(missing) - len(inside), len(inside),
                ', '.join('%#x (dans %#x)' % x for x in inside[:6]) + (' ...' if len(inside) > 6 else '')))
    # 7. Imports entre modules.
    cross = collections.Counter()
    starts = collections.Counter()
    for c in cros:
        module = linker.module(c.name)
        for target, indexed, anonymous in c.import_modules:
            if target == STATIC_NAME:
                continue
            exporter = linker.module(target)
            for tag, _ in anonymous:
                segment, offset = split_tag(tag)
                kind = exporter.segments[segment][2]
                cross[SEGMENT_KINDS[kind]] += 1
                if kind == 0:
                    at = exporter.cro.segments[segment][0] + offset
                    word = u32(exporter.cro.data, at & ~1)
                    push = (exporter.cro.data[(at & ~1) + 1] == 0xB5) if at & 1 else (word & 0xFFFF4000 == 0xE92D4000)
                    starts['push' if push else 'autre'] += 1
    say('7. Imports entre modules : ' + ', '.join('%s %d' % kv for kv in sorted(cross.items())) +
        ' ; parmi ceux de .text, commencent par un « push {..., lr} » : %d sur %d' % (starts['push'], sum(starts.values())))
    dependencies = collections.defaultdict(set)
    for c in cros:
        for target, _, _ in c.import_modules:
            if target != STATIC_NAME:
                dependencies[c.name].add(target)
    exporters = collections.Counter(t for ds in dependencies.values() for t in ds)
    say('   %d modules importent d\'un autre module ; %d modules exportent vers d\'autres ; le plus demandé : %s' % (
        len(dependencies), len(exporters), ', '.join('%s (%d)' % kv for kv in exporters.most_common(4))))
    # 8. Le gestionnaire de modules du jeu : qui est chargé avec qui.
    if code is not None:
        sites = find_load_sites(code, ghidra or {})
        named_sites = [s for s in sites if s[3]]
        say('8. Appels au gestionnaire de modules dans le code principal : %d, dont %d avec le nom du module retrouvé' % (
            len(sites), len(named_sites)))
        # Le jeu nomme le FICHIER ; un seul diffère du nom de module : DllEshop.cro contient « DllEShop ».
        file_to_module = {c.file_name[:-4].lower(): c.name for c in cros}
        groups = collections.defaultdict(list)
        for address, function, callee, module_name in named_sites:
            groups[function].append(file_to_module.get(module_name.lower(), module_name))
        loaded_by_main = {file_to_module.get(s[3].lower(), s[3]) for s in named_sites}
        # Les modules qui en chargent d'autres eux-mêmes : leurs noms « rom2:/X.cro » sont dans leurs données.
        loaded_by_module = collections.defaultdict(set)
        for c in cros:
            for found in re.findall(rb'rom2?:/(\w+)\.cro', c.data):
                loaded_by_module[file_to_module.get(found.decode().lower(), found.decode())].add(c.name)
        main_strings = {file_to_module.get(n.decode().lower(), n.decode()) for n in re.findall(rb'rom2?:/(\w+)\.cro\0', code)}
        never = sorted(c.name for c in cros if c.name not in main_strings and c.name not in loaded_by_module)
        say('   modules dont le nom « rom2:/X.cro » est dans le code principal : %d (dont %d sur un appel retrouvé) ; '
            'dans un autre module (%s) : %d ; nommés nulle part en clair : %d (%s)' % (
                len(main_strings), len(loaded_by_main), ', '.join(sorted({m for ms in loaded_by_module.values() for m in ms})),
                len(loaded_by_module), len(never), ', '.join(never)))
        unnamed_sites = [s for s in sites if not s[3]]
        say("   appels dont le nom vient d'un paramètre (pas d'une chaîne posée juste avant) : %s" % (
            ', '.join('%#x' % s[0] for s in unnamed_sites) or 'aucun'))
        verdict = collections.Counter()
        apart = []
        for importer, targets_ in sorted(dependencies.items()):
            for target in sorted(targets_):
                if any(importer in g and target in g for g in groups.values()):
                    verdict['chargés par la même fonction du code principal'] += 1
                elif importer in loaded_by_module.get(target, ()):
                    verdict["l'importateur charge lui-même l'exportateur"] += 1
                elif target in loaded_by_module.get(importer, ()):
                    verdict["l'exportateur charge lui-même l'importateur"] += 1
                else:
                    apart.append((importer, target))
        say("   liens d'import entre modules : %d ; " % sum(len(t) for t in dependencies.values()) +
            '; '.join('%s : %d' % kv for kv in sorted(verdict.items())) + ' ; à expliquer autrement : %d' % len(apart))
        for importer, target in apart:
            def where(name):
                places_ = sorted('%#x' % f for f, g in groups.items() if name in g)
                return ','.join(places_[:3]) or ('par ' + ','.join(sorted(loaded_by_module[name])) if name in loaded_by_module
                                                 else 'nommé nulle part')
            say('      %s -> %s : le premier chargé %s ; le second %s' % (importer, target, where(importer), where(target)))
    path = os.path.join(options['out'], 'validation.txt')
    os.makedirs(options['out'], exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out_lines) + '\n')
    print('-> %s' % path)


def command_ghidra(folder, options):
    """Lie les modules de --only, écrit un ELF où ils sont seuls initialisés (le reste en blocs vides), le fait
    analyser par Ghidra sous Ubuntu, puis contrôle les références que Ghidra voit sortir de leur code."""
    if not options['only']:
        sys.exit('ghidra : donner les modules par --only A,B')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import rea_bridge
    crs, cros, _ = read_romfs(folder)
    code, code_path = find_code(folder, options['code'])
    linker, places = link_set(crs, cros, code, options['only'])
    label = 'ghidra_' + '_'.join(options['only'])
    out = os.path.join(options['out'], label)
    os.makedirs(out, exist_ok=True)
    names = read_names(NAMES_FILE)
    group = linker.chain[1:]
    wanted = set().union(*(linker.module_targets.get(m.name, set()) for m in group))
    sections = main_sections(linker, code_path, ghost=True)
    for module in group:
        sections += module_sections(module)
    symbols = [(a, n, k) for a, n, k in collect_symbols(linker, linker.chain, names)
               if a in wanted or any(s[2] is not None and s[1] <= (a & ~1) < s[1] + s[3] for s in sections)]
    elf_path = os.path.join(out, label + '.elf')
    with open(elf_path, 'wb') as f:
        f.write(build_elf(sections, elf_symbols(symbols, sections), group[0].segments[0][0]))
    project = os.path.join(out, 'project')
    os.makedirs(project, exist_ok=True)
    wsl = rea_bridge.to_wsl_path
    command = ['wsl.exe', '-d', 'Ubuntu', '--', GHIDRA_HEADLESS, wsl(project), label, '-import', wsl(elf_path),
               '-overwrite', '-processor', 'ARM:LE:32:v6', '-cspec', 'default', '-scriptPath', wsl(GHIDRA_SCRIPTS),
               '-postScript', 'DumpFunctions.java', wsl(out)]
    print('Ghidra tourne sous Ubuntu...', flush=True)
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    with open(os.path.join(out, 'ghidra.log'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(result.stdout.decode('utf-8', errors='replace'))
    functions = read_ghidra_functions(os.path.join(out, 'funcs.tsv'))
    if not functions:
        sys.exit('Ghidra n\'a pas rendu de fonctions : lire %s' % os.path.join(out, 'ghidra.log'))
    main_functions = read_ghidra_functions(options.get('functions') or GHIDRA_FUNCTIONS)
    ranges = [(m.name, s[0], s[0] + s[1]) for m in group for s in m.segments if s[2] == 0 and s[1]]
    text_start, text_size, _ = crs.segments[0]
    def owner(address):
        for name, start, end in ranges:
            if start <= address < end:
                return name
        if text_start <= address < text_start + text_size:
            return STATIC_NAME
        return None
    tally = collections.Counter()
    misses = []
    # Les adresses que les imports du groupe ont reçues (sans le bit Thumb, comme Ghidra les note).
    imported = {address & ~1 for m in group for address in linker.module_targets.get(m.name, ())}
    with open(os.path.join(out, 'refs.tsv'), encoding='utf-8') as f:
        for line in f:
            source, target, kind, _ = (line.rstrip('\n').split('\t') + [''])[:4]
            if 'CALL' not in kind and 'JUMP' not in kind:
                continue
            source, target = int(source, 16), int(target, 16)
            here, there = owner(source), owner(target)
            if here is None or here == STATIC_NAME or there is None or there == here:
                continue
            key = 'vers le code principal' if there == STATIC_NAME else 'vers un autre module'
            known = main_functions if there == STATIC_NAME else functions
            if target in known:
                verdict = 'début de fonction pour Ghidra'
            elif target in imported:
                verdict = 'adresse importée que Ghidra ne connaît pas comme fonction (rien ne l\'appelle dans le code principal)'
            else:
                verdict = 'AILLEURS'
                if len(misses) < 20:
                    misses.append('%#x -> %#x (%s, %s)' % (source, target, kind, there))
            tally[(key, verdict)] += 1
    lines = ['Ghidra sur %s : %d fonctions' % (label, len(functions))]
    for key in ('vers le code principal', 'vers un autre module'):
        total = sum(v for (k, _), v in tally.items() if k == key)
        lines.append('   appels et sauts %s : %d' % (key, total))
        for (k, verdict), count in sorted(tally.items()):
            if k == key:
                lines.append('      %-100s %d' % (verdict, count))
    lines.extend('   raté : ' + m for m in misses)
    with open(os.path.join(out, 'verification.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    print('-> %s' % out)


# --- Test ---

def build_tree(names):
    """Fabrique l'arbre de recherche des exports pour ces noms (même lecture que find_named_export)."""
    keys = [n.encode('ascii') for n in names]
    def bit(key, index):
        byte = index >> 3
        return key[byte] >> (index & 7) & 1 if byte < len(key) else 0
    nodes = [[0xFFFF, 0, 0, 0]]
    leaf_of = {}
    def build(indices):
        if len(indices) == 1:
            return ('leaf', indices[0]), indices[0]
        width = 8 * max(len(keys[i]) for i in indices) + 8
        split = next(b for b in range(width) if len({bit(keys[i], b) for i in indices}) > 1)
        left = [i for i in indices if not bit(keys[i], split)]
        right = [i for i in indices if bit(keys[i], split)]
        node = len(nodes)
        nodes.append([split, 0, 0, 0])
        left_ref, spare_left = build(left)
        right_ref, spare_right = build(right)
        nodes[node][1], nodes[node][2] = left_ref, right_ref
        nodes[node][3] = spare_left
        leaf_of[spare_left] = node
        return ('node', node), spare_right
    if not names:
        return []
    root, spare = build(list(range(len(names))))
    nodes[0][1] = root
    nodes[0][3] = spare
    leaf_of[spare] = 0
    def resolve(ref):
        kind, value = ref
        return value if kind == 'node' else 0x8000 | leaf_of[value]
    for node in nodes:
        node[1] = resolve(node[1]) if isinstance(node[1], tuple) else node[1]
        node[2] = resolve(node[2]) if isinstance(node[2], tuple) else node[2]
    return [tuple(n) for n in nodes]


def make_cro(name, text=b'', rodata=b'', data=b'', bss=0, named_exports=(), indexed_exports=(), import_modules=(),
             named_imports=(), internal=(), on_unresolved=NO_TAG, static_segments=None):
    """Fabrique un .cro (ou un static.crs si static_segments donne les adresses) valide pour ro, empreintes comprises.
    import_modules : [(module, [(numéro, [(tag, type, ajout)])], [(tag exporté, [(tag, type, ajout)])])].
    named_imports : [(nom, [(tag, type, ajout)])]. internal : [(tag, type, segment du symbole, ajout)]."""
    out = bytearray(0x180)
    def put(blob, step=4):
        while len(out) % step:
            out.append(0)
        start = len(out)
        out.extend(blob)
        return start
    text_offset = put(text) if text else len(out)
    rodata_offset = put(rodata) if rodata else 0
    code_end = len(out)
    module_name = put(name.encode('ascii') + b'\0')
    segments = static_segments or [(text_offset, len(text), 0), (rodata_offset, len(rodata), 1), (0, len(data), 2), (0, bss, 3)]
    segment_table = put(b''.join(struct.pack('<III', *s) for s in segments))
    export_names = [n for n, _ in named_exports]
    strings = bytearray()
    string_at = {}
    for n in export_names:
        string_at[n] = len(strings)
        strings.extend(n.encode('ascii') + b'\0')
    exports_blob = bytearray(8 * len(named_exports))
    named_exports_offset = put(exports_blob)
    tree = build_tree(export_names)
    tree_offset = put(b''.join(struct.pack('<HHHH', *n) for n in tree))
    indexed_offset = put(b''.join(struct.pack('<I', t) for t in indexed_exports))
    export_strings = put(bytes(strings))
    for i, (n, tag) in enumerate(named_exports):
        struct.pack_into('<II', out, named_exports_offset + 8 * i, export_strings + string_at[n], tag)
    # Imports : les listes de corrections d'abord, puis les tables qui les désignent.
    import_strings = bytearray()
    def import_string(text_):
        offset = len(import_strings)
        import_strings.extend(text_.encode('ascii') + b'\0')
        return offset
    batches = []
    def add_batch(patches):
        first = len(batches)
        for k, (tag, kind, addend) in enumerate(patches):
            batches.append((tag, kind, 1 if k == len(patches) - 1 else 0, addend))
        return first
    module_entries = []
    indexed_entries, anonymous_entries, named_entries = [], [], []
    for target, indexed, anonymous in import_modules:
        name_ref = import_string(target)
        first_indexed = len(indexed_entries)
        for index, patches in indexed:
            indexed_entries.append((index, add_batch(patches)))
        first_anonymous = len(anonymous_entries)
        for tag, patches in anonymous:
            anonymous_entries.append((tag, add_batch(patches)))
        module_entries.append((name_ref, first_indexed, len(indexed), first_anonymous, len(anonymous)))
    for n, patches in named_imports:
        named_entries.append((import_string(n), add_batch(patches)))
    import_modules_offset = put(bytes(20 * len(module_entries)))
    patches_offset = put(b''.join(struct.pack('<IBBBxi', t, k, f, 0, a) for t, k, f, a in batches))
    named_offset = put(bytes(8 * len(named_entries)))
    indexed_import_offset = put(bytes(8 * len(indexed_entries)))
    anonymous_offset = put(bytes(8 * len(anonymous_entries)))
    import_strings_offset = put(bytes(import_strings))
    for i, (name_ref, fi, ni, fa, na) in enumerate(module_entries):
        struct.pack_into('<5I', out, import_modules_offset + 20 * i, import_strings_offset + name_ref,
                         indexed_import_offset + 8 * fi, ni, anonymous_offset + 8 * fa, na)
    for i, (name_ref, batch) in enumerate(named_entries):
        struct.pack_into('<II', out, named_offset + 8 * i, import_strings_offset + name_ref, patches_offset + 12 * batch)
    for i, (index, batch) in enumerate(indexed_entries):
        struct.pack_into('<II', out, indexed_import_offset + 8 * i, index, patches_offset + 12 * batch)
    for i, (tag, batch) in enumerate(anonymous_entries):
        struct.pack_into('<II', out, anonymous_offset + 8 * i, tag, patches_offset + 12 * batch)
    static_anonymous = put(b'')
    internal_offset = put(b''.join(struct.pack('<IBBBxi', t, k, s, 0, a) for t, k, s, a in internal))
    static_patches = put(b'')
    data_offset = put(data)
    if not static_segments:
        struct.pack_into('<I', out, segment_table + 24, data_offset)
    while len(out) % PAGE:
        out.append(0xCC)
    tables = [(segment_table, len(segments)), (named_exports_offset, len(named_exports)), (indexed_offset, len(indexed_exports)),
              (export_strings, len(strings)), (tree_offset, len(tree)), (import_modules_offset, len(module_entries)),
              (patches_offset, len(batches)), (named_offset, len(named_entries)), (indexed_import_offset, len(indexed_entries)),
              (anonymous_offset, len(anonymous_entries)), (import_strings_offset, len(import_strings)), (static_anonymous, 0),
              (internal_offset, len(internal)), (static_patches, 0)]
    control = next((t for n, t in named_exports if n == 'nnroControlObject_'), NO_TAG)
    struct.pack_into('<4s17I', out, 0x80, MAGIC, module_name, 0, 0, len(out), bss, 0, 0, control, NO_TAG, NO_TAG,
                     on_unresolved, 0x180, code_end - 0x180, data_offset, len(data), module_name, len(name) + 1)
    for i, (start, count) in enumerate(tables):
        struct.pack_into('<II', out, 0xC8 + 8 * i, start, count)
    regions = [(0x80, 0x100), (0x180, code_end - 0x180), (module_name, data_offset - module_name), (data_offset, len(data))]
    for i, (start, size) in enumerate(regions):
        out[32 * i:32 * i + 32] = hashlib.sha256(out[start:start + size]).digest()
    return bytes(out)


def test():
    import tempfile
    # Un code principal de 0x3000 octets : .text à 0x100000, .rodata à 0x101000, .data à 0x102000.
    main = bytearray(0x3000)
    struct.pack_into('<I', main, 0x100, 0xE92D4010)          # push {r4, lr} : une fonction ARM à 0x100100
    struct.pack_into('<I', main, 0x200, 0x4D7BC0)            # un mot que static.crs fait remplir par le module B
    static_segments = [(0x100000, 0x1000, 0), (0x101000, 0x1000, 1), (0x102000, 0x1000, 2)]
    crs = Cro(make_cro(STATIC_NAME, static_segments=static_segments,
                       named_exports=[('nnroAeabiAtexit_', make_tag(0, 0x300)), ('_ZN3foo3barEv', make_tag(0, 0x101))],
                       import_modules=[('B', [], [(make_tag(0, 0x20), [(make_tag(0, 0x200), 2, 0)])])],
                       on_unresolved=make_tag(0, 0x400)), 'static.crs')
    assert crs.is_static and not crs.ro_header_problems() and all(e == h for _, e, h in crs.hashes())
    assert crs.find_named_export('_ZN3foo3barEv') == make_tag(0, 0x101) and crs.find_named_export('absent') is None
    # B : exporte une fonction par numéro et une par nom.
    b_text = bytearray(0x40)
    struct.pack_into('<I', b_text, 0x20, 0xE92D4000)
    b = Cro(make_cro('B', text=bytes(b_text), data=b'\x11' * 8, named_exports=[('nnroControlObject_', make_tag(0, 0)),
                     ('_ZN1B4workEv', make_tag(0, 0x20))], indexed_exports=[make_tag(0, 0x24)]), 'B.cro')
    # A : corrections internes de tous les types que ro connaît, imports anonymes du code principal et de B, un import
    # par numéro de B, un import par nom (__aeabi_atexit), et un import d'un module C qui n'existe pas.
    a_text = bytearray(0x80)
    struct.pack_into('<I', a_text, 0x40, 0xEA000000)          # un « b » ARM dont ro refait le décalage (type 29)
    a = Cro(make_cro('A', text=bytes(a_text), rodata=b'\x22' * 0x20, data=b'\x33' * 0x10, bss=0x20,
                     named_exports=[('nnroControlObject_', make_tag(0, 0))], on_unresolved=NO_TAG,
                     internal=[(make_tag(0, 0x00), 2, 1, 4), (make_tag(0, 0x04), 3, 0, 0x10), (make_tag(2, 0x8), 2, 3, 8),
                               (make_tag(0, 0x08), 42, 0, 0x20), (make_tag(0, 0x0C), 28, 0, 0x30),
                               (make_tag(0, 0x10), 28, 0, 0x31), (make_tag(0, 0x40), 29, 0, 0x60),
                               (make_tag(0, 0x14), 10, 0, 0x31), (make_tag(0, 0x18), 0, 0, 0)],
                     import_modules=[(STATIC_NAME, [], [(make_tag(0, 0x100), [(make_tag(0, 0x20), 2, 0), (make_tag(1, 0x4), 2, 8)]),
                                                        (make_tag(0, 0x101), [(make_tag(0, 0x34), 28, 0)])]),
                                     ('B', [(0, [(make_tag(0, 0x24), 2, 0)])], [(make_tag(0, 0x20), [(make_tag(0, 0x28), 2, 0)])]),
                                     ('C', [], [(make_tag(0, 0), [(make_tag(0, 0x2C), 2, 4)])])],
                     named_imports=[('__aeabi_atexit', [(make_tag(0, 0x30), 2, 0)])]), 'A.cro')
    for cro in (a, b):
        assert not cro.ro_header_problems(), cro.ro_header_problems()
        assert all(e == h for _, e, h in cro.hashes())
        assert all(cro.find_named_export(n) == t for n, t in cro.named_exports)
    assert a.fixed_end(1) < a.fixed_end(0) and a.import_modules[1][0] == 'B' and len(a.external_patches) == 7
    # Un arbre plus grand : chaque nom retrouvé, et un nom proche refusé.
    words = ['n%d_%s' % (i, 'x' * (i % 5)) for i in range(40)] + ['ab', 'abc', 'abd', 'b']
    tree_cro = Cro(make_cro('T', text=b'\0' * 4, named_exports=[(w, make_tag(0, 0)) for w in words]), 'T.cro')
    assert all(tree_cro.find_named_export(w) is not None for w in words) and tree_cro.find_named_export('abe') is None
    # Liaison : A d'abord (B pas encore là), puis B.
    places = layout([a, b])
    linker = Linker(crs, main)
    module_a = linker.load(a, *places['A'])
    base_a, data_a, bss_a = places['A']
    assert module_a.segments[2][0] == data_a and module_a.segments[3][0] == bss_a and module_a.segments[0][0] == base_a + 0x180
    text_a = base_a + 0x180
    rodata_a = module_a.segments[1][0]
    read = linker.memory.read32
    assert read(text_a + 0x00) == rodata_a + 4                                   # type 2 : S + A
    assert read(text_a + 0x04) == (text_a + 0x10 - (text_a + 0x04)) & 0xFFFFFFFF   # type 3 : S + A - P
    assert read(data_a + 0x8) == bss_a + 8                                       # .data corrigé dans son tampon
    assert read(text_a + 0x08) == (text_a + 0x20 - (text_a + 0x08)) & 0xFFFFFFFF   # type 42
    assert read(text_a + 0x0C) == 0xEB000000 | ((0x30 - 0x0C - 0) & 0x3FFFFFF) >> 2   # bl vers une adresse paire
    assert read(text_a + 0x10) >> 24 == 0xEB                                      # ro regarde le bit 0 de S, pas de S + A
    assert read(text_a + 0x34) >> 24 in (0xFA, 0xFB)                              # import d'une fonction Thumb : blx
    assert read(text_a + 0x40) == 0xEA000000 | (0x60 - 0x40) >> 2                 # b : condition gardée, décalage refait
    assert read(text_a + 0x14) & 0xF800F800 == 0xE800F000                         # S pair depuis du Thumb : blx
    assert read(text_a + 0x20) == 0x100100 and read(rodata_a + 4) == 0x100108     # import du code principal, ajout 8
    assert read(text_a + 0x30) == 0x100300                                        # __aeabi_atexit -> nnroAeabiAtexit_
    assert read(text_a + 0x24) == 0 and read(text_a + 0x28) == 0                  # B pas chargé : OnUnresolved absent -> 0
    assert read(0x100200) == 0x100400                                             # static.crs : son OnUnresolved
    module_b = linker.load(b, *places['B'])
    text_b = module_b.segments[0][0]
    assert read(text_a + 0x24) == text_b + 0x24 and read(text_a + 0x28) == text_b + 0x20   # résolus au chargement de B
    assert read(0x100200) == text_b + 0x20                                        # le code principal reçoit B
    unresolved = linker.unresolved()
    assert [(u[0], u[2][0], u[3]) for u in unresolved] == [('A', 'C', 'module C pas chargé')], unresolved
    assert read(text_a + 0x2C) == 4                                               # jamais résolu : 0 + ajout
    assert not [p for p in linker.problems if 'interne' in p[1] or 'import' in p[1]], linker.problems
    # Une correction interne qui vise hors de son segment est signalée.
    bad = Cro(make_cro('D', text=b'\0' * 8, internal=[(make_tag(0, 0x100), 2, 0, 0)]), 'D.cro')
    probe = Linker(crs, main)
    probe.load(bad, 0x00800000)
    assert any('hors de son segment' in p[1] for p in probe.problems)
    # ELF, noms et rapport.
    symbols = collect_symbols(linker, linker.chain, {0x100100: 'known_function'})
    names = {n for _, n, _ in symbols}
    assert {'known_function', 'A_nnroControlObject_', 'B_nnroControlObject_', '_ZN1B4workEv'} <= names
    with tempfile.TemporaryDirectory() as out:
        write_linked(linker, places, None, out, 'essai', {0x100100: 'known_function'}, each=True)
        sections, elf_names = read_elf(open(os.path.join(out, 'essai.elf'), 'rb').read())
        assert sections['.A.text'][0] == text_a and sections['.A.text'][1][0x20:0x24] == struct.pack('<I', 0x100100)
        assert sections['.A.bss'][1] is None and sections['.A.data'][1][8:12] == struct.pack('<I', bss_a + 8)
        assert elf_names['_ZN1B4workEv'] == text_b + 0x20 and elf_names['known_function'] == 0x100100
        module_sections_, module_names = read_elf(open(os.path.join(out, 'A.elf'), 'rb').read())
        assert module_sections_['.static.text'][1] is None and module_sections_['.B.text'][1] is None
        assert module_names['known_function'] == 0x100100
        tsv = open(os.path.join(out, 'essai.noms.tsv'), encoding='utf-8').read()
        assert '0x100100\tfunction\tknown_function' in tsv
        assert 'Listes d\'imports non résolues : 1' in open(os.path.join(out, 'essai.rapport.txt'), encoding='utf-8').read()
    # Le gestionnaire de modules : « add r0, pc, #imm » puis « bl » vers la fonction de chargement.
    code = bytearray(0x400000)
    struct.pack_into('<I', code, 0x1000, 0xE28F0008)                              # add r0, pc, #8 -> 0x101010
    struct.pack_into('<I', code, 0x1004, 0xEB000000 | ((0x357960 - 0x101004 - 8) >> 2 & 0xFFFFFF))
    code[0x1010:0x1023] = b'rom2:/DllTitle.cro\0'
    sites = find_load_sites(bytes(code), {0x101000: 'arm'})
    assert sites == [(0x101004, 0x101000, 'ro_manager_load_and_start_module', 'DllTitle')], sites
    message = 'cro_loader : en-têtes, empreintes, arbre des exports, six types de correction, liaison dans les deux sens, ELF et noms relus.'
    # Sur les vrais fichiers, s'ils sont là.
    if os.path.isfile(os.path.join(DEFAULT_ROMFS, 'static.crs')):
        crs, cros, crr = read_romfs(DEFAULT_ROMFS)
        allowed = read_crr(crr) if crr else set()
        assert all(e == h for c in [crs] + cros for _, e, h in c.hashes())
        assert all(c.crr_hash() in allowed for c in cros) and not any(c.ro_header_problems() for c in cros)
        linker, _ = link_set(crs, cros, None)
        assert not linker.unresolved() and not linker.problems, (linker.unresolved()[:3], linker.problems[:3])
        message += ' Vrais fichiers : %d modules liés sans import manquant.' % len(cros)
    print(message)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    if args[:1] == ['test']:
        test()
    elif args[:1] == ['info'] and len(args) == 2:
        command_info(args[1])
    elif args[:1] in (['link'], ['verify'], ['ghidra']):
        options, rest = parse_options(args[1:])
        folder = rest[0] if rest else DEFAULT_ROMFS
        {'link': command_link, 'verify': command_verify, 'ghidra': command_ghidra}[args[0]](folder, options)
    else:
        print(__doc__)
