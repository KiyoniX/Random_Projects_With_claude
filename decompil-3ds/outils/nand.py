"""Lit sur PC la sauvegarde NAND de la console (faite par GodMode9) et en sort les titres système, sans repasser par
la console.

    python nand.py                              résumé : partitions de la NAND et titres installés de la CTRNAND
    python nand.py titles [filtre]              les titres : identifiant, nom (tiré de l'exheader), version, taille
    python nand.py ls [chemin]                  le contenu d'un dossier de la CTRNAND (« / » par défaut)
    python nand.py title <titre|nom> [...]      extrait chaque titre : son NCCH déchiffré dans local/dump/systeme/
                                                <nom>.cxi (.cfa pour une archive), puis extraire.py vers
                                                local/extrait/<nom>/
    python nand.py file <chemin> [sortie]       copie un fichier de la CTRNAND (par défaut dans local/dump/ctrnand/)
    python nand.py config                       la sauvegarde système de cfg (00010017) et son fichier « config »
    python nand.py all                          le lot du carnet : modules système, applets, archives système,
                                                police partagée, config, et l'inventaire
                                                local/extrait/inventaire-nand.txt
    python nand.py sd <dossier> <titre>         la sauvegarde et les données étendues d'un jeu, copiées de la carte SD
                                                (<dossier> : la copie locale de « Nintendo 3DS », <titre> : par
                                                exemple 0004000000055D00) ; déchiffrées avec le movable.sed de la
                                                CTRNAND, rangées dans local/extrait/sd-<titre>/
    python nand.py verify [nom ...]             déchiffre en mémoire et compare octet pour octet aux .cxi dumpés
                                                un par un par GodMode9 (tous ceux de local/dump/systeme/ par défaut)
    python nand.py test

Options, avant la commande : --nand <image>  --boot9 <boot9.bin>  --otp <otp.bin>  --cid <nand_cid.bin>
Par défaut : local/dump/nand.bin, local/dump/systeme/boot9.bin, et l'OTP et le CID de la sauvegarde « essentielle »
que GodMode9 range à 0x200 de l'image (un ExeFS : nand_hdr, secinfo, movable, frndseed, nand_cid, otp...).

Comment. Les clés ne sont écrites nulle part ici : la bibliothèque libre pyctr (installée dans local/pylib/ par
« python -m pip install --target local/pylib pyctr ») les tire à l'exécution de boot9.bin et de l'OTP, et déchiffre
la CTRNAND à la volée. Le reste est lu ici :
- la CTRNAND est un volume FAT16 (lu par FatVolume, sans écriture possible) ;
- un titre installé est rangé dans /title/<haut>/<bas>/content/ : un .tmd (version, liste des contenus) et un .app
  par contenu, le premier étant un NCCH chiffré par la console (emplacement 0x2C, la clé Y étant le début de la
  signature de l'en-tête) ;
- decrypt_ncch le déchiffre comme le fait GodMode9 : exheader, en-tête et fichiers de l'ExeFS, RomFS, puis les
  drapeaux de l'en-tête passés à « sans chiffrement » ; le reste (en-tête, logo, zone en clair) est recopié tel quel.
- La sauvegarde de cfg est un conteneur DISA (lu par pyctr) qui porte un petit système de fichiers « SAVE » (lu par
  read_save_fs).

Ce qu'il ne fait pas. Il n'écrit jamais dans l'image ni dans boot9.bin, et n'écrase aucun .cxi déjà présent dans
local/dump/systeme/ : sa version est écrite à côté, en <nom>.nand.cxi. Il ne lit pas la partie TWL (DSi) de la NAND,
ni les titres à graine (aucun titre système n'en a), ni les NCCH de version 1. Tout ce qu'il écrit va sous local/.
"""
import hashlib
import io
import os
import struct
import subprocess
import sys
from collections import namedtuple

import lz11

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, 'local')
PYLIB = os.path.join(LOCAL, 'pylib')
DEFAULT_NAND = os.path.join(LOCAL, 'dump', 'nand.bin')
DEFAULT_BOOT9 = os.path.join(LOCAL, 'dump', 'systeme', 'boot9.bin')
SYSTEM_DUMPS = os.path.join(LOCAL, 'dump', 'systeme')
EXTRACTED = os.path.join(LOCAL, 'extrait')
CTRNAND_FILES = os.path.join(LOCAL, 'dump', 'ctrnand')
INVENTORY = os.path.join(EXTRACTED, 'inventaire-nand.txt')

MEDIA_UNIT = 0x200
EXEFS_HEADER_SIZE = 0x200
EXHEADER_SIZE = 0x800            # exheader (0x400) et descripteur d'accès (0x400), chiffrés ensemble
SECTION_EXHEADER, SECTION_EXEFS, SECTION_ROMFS = 1, 2, 3
EXEFS_MAIN_KEY_FILES = ('icon', 'banner')
FLAG_FIXED_KEY, FLAG_NO_ROMFS, FLAG_NO_CRYPTO, FLAG_SEED = 0x01, 0x02, 0x04, 0x20

# Emplacements de clés de la console, d'après 3dbrew (« AES Registers ») : des numéros, pas des clés.
SLOT_NCCH = 0x2C
EXTRA_SLOTS = {0x00: 0x2C, 0x01: 0x25, 0x0A: 0x18, 0x0B: 0x1B}

# Les catégories (moitié haute de l'identifiant) que « all » extrait, avec leur nom dans l'inventaire.
CATEGORIES = {
    0x00040130: 'module système',
    0x00040030: 'applet',
    0x0004001B: 'archive système',
    0x0004009B: 'archive système',
    0x000400DB: 'archive système',
}
# Les archives système nommées d'après ce qu'on a trouvé dans leur RomFS sur cette console ; les autres prennent le
# nom data-<bas de l'identifiant> (l'inventaire montre le début de leur contenu).
KNOWN_ARCHIVES = {
    0x0004009B00014002: 'police-std',       # cbf_std.bcfnt.lz : la police partagée (Japon, Europe, Amérique)
    0x0004009B00014102: 'police-chn',       # cbf_zh-Hans-CN.bcfnt.lz
    0x0004009B00014202: 'police-kor',       # cbf_ko-Hang-KR.bcfnt.lz
    0x0004009B00014302: 'police-twn',       # cbf_zh-Hant-TW.bcfnt.lz
    0x0004001B00010002: 'clcerta',          # ctr-common-1-cert.bin, ctr-common-1-key.bin : certificat client SSL
    0x0004009B00010202: 'mii-ressources',   # CFL_Res.dat
    0x0004009B00010402: 'pays',             # <région>/country_LZ.bin : listes de pays et de régions
    0x0004009B00010602: 'certificats-ca',   # CACERT_*.der : autorités de certification
    0x000400DB00010302: 'mots-interdits',   # <langue>.txt : expressions régulières des mots refusés
    0x000400DB00017102: 'cver',             # titleversion.txt : version du système affichée
    0x000400DB20016102: 'nver',             # version.bin
}
SHARED_FONT_DIR = os.path.join(EXTRACTED, 'police-partagee')
# Les modules dumpés un par un par GodMode9 avant cet outil, que « verify » compare par défaut.
GODMODE9_DUMPS = ('cfg', 'dsp', 'gsp', 'hid', 'ns', 'nwm', 'ptm', 'ro')
CFG_SAVE_ID = 0x00010017


# --- Lecture seule ---------------------------------------------------------------------------------------------------

class ReadOnlyIO(io.RawIOBase):
    """Enveloppe un flux pour qu'aucune écriture ne passe, même par erreur."""

    def __init__(self, stream):
        super().__init__()
        self._stream = stream

    def readable(self):
        return True

    def seekable(self):
        return True

    def writable(self):
        return False

    def seek(self, offset, whence=0):
        return self._stream.seek(offset, whence)

    def tell(self):
        return self._stream.tell()

    def read(self, size=-1):
        return self._stream.read(size)

    def readinto(self, buffer):
        data = self._stream.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)


# --- FAT (la CTRNAND) ------------------------------------------------------------------------------------------------

FatEntry = namedtuple('FatEntry', 'name is_dir cluster size')


class FatVolume:
    """Un volume FAT12, FAT16 ou FAT32, en lecture seule, noms longs compris. La CTRNAND est en FAT16."""

    def __init__(self, stream):
        self.stream = stream
        stream.seek(0)
        boot = stream.read(0x200)
        if boot[0x1FE:0x200] != b'\x55\xAA':
            raise ValueError('pas de secteur de démarrage FAT (signature 55AA absente) : mauvais déchiffrement ?')
        (self.sector_size, self.cluster_sectors, reserved, fat_count, root_entries, total16, _, fat_size16) = \
            struct.unpack_from('<HBHBHHBH', boot, 0x0B)
        total32, fat_size32 = struct.unpack_from('<II', boot, 0x20)
        root_cluster = struct.unpack_from('<I', boot, 0x2C)[0]
        if not self.sector_size or not self.cluster_sectors or not fat_count:
            raise ValueError('secteur de démarrage FAT incohérent')
        total = total16 or total32
        fat_size = fat_size16 or fat_size32
        root_sectors = (root_entries * 32 + self.sector_size - 1) // self.sector_size
        self.cluster_size = self.sector_size * self.cluster_sectors
        self.root_offset = (reserved + fat_count * fat_size) * self.sector_size
        self.data_offset = self.root_offset + root_sectors * self.sector_size
        clusters = (total - reserved - fat_count * fat_size - root_sectors) // self.cluster_sectors
        self.bits = 12 if clusters < 4085 else 16 if clusters < 65525 else 32
        self.root_cluster = root_cluster if self.bits == 32 else 0
        self.root_size = root_entries * 32
        stream.seek(reserved * self.sector_size)
        self.fat = stream.read(fat_size * self.sector_size)

    def next_cluster(self, cluster):
        if self.bits == 16:
            value = struct.unpack_from('<H', self.fat, cluster * 2)[0]
            return None if value >= 0xFFF8 else value
        if self.bits == 32:
            value = struct.unpack_from('<I', self.fat, cluster * 4)[0] & 0x0FFFFFFF
            return None if value >= 0x0FFFFFF8 else value
        pair = struct.unpack_from('<H', self.fat, cluster * 3 // 2)[0]
        value = pair >> 4 if cluster & 1 else pair & 0xFFF
        return None if value >= 0xFF8 else value

    def chain(self, cluster):
        """Les grappes d'un fichier, en suites contiguës (première, nombre) pour lire d'un bloc."""
        runs, seen = [], set()
        while cluster is not None and cluster >= 2:
            if cluster in seen:
                raise ValueError('chaîne FAT qui boucle sur la grappe %d' % cluster)
            seen.add(cluster)
            if runs and runs[-1][0] + runs[-1][1] == cluster:
                runs[-1][1] += 1
            else:
                runs.append([cluster, 1])
            cluster = self.next_cluster(cluster)
        return runs

    def read_clusters(self, cluster, size=None, offset=0):
        out, position = [], 0
        end = None if size is None else offset + size
        for first, count in self.chain(cluster):
            length = count * self.cluster_size
            if end is not None and position >= end:
                break
            if position + length > offset:
                start = max(offset - position, 0)
                stop = length if end is None else min(length, end - position)
                self.stream.seek(self.data_offset + (first - 2) * self.cluster_size + start)
                out.append(self.stream.read(stop - start))
            position += length
        return b''.join(out)

    def directory(self, entry=None):
        """Les entrées d'un dossier (la racine si entry est None), sans « . » ni « .. »."""
        if entry is None and self.bits != 32:
            self.stream.seek(self.root_offset)
            raw = self.stream.read(self.root_size)
        else:
            raw = self.read_clusters(entry.cluster if entry else self.root_cluster)
        entries, long_parts = [], {}
        for at in range(0, len(raw) - 31, 32):
            record = raw[at:at + 32]
            if record[0] == 0x00:
                break
            if record[0] == 0xE5:
                long_parts = {}
                continue
            attributes = record[11]
            if attributes == 0x0F:
                order = record[0] & 0x1F
                chars = record[1:11] + record[14:26] + record[28:32]
                long_parts[order] = chars.decode('utf-16-le', 'replace').split('\x00')[0].rstrip('￿')
                continue
            if attributes & 0x08:
                long_parts = {}
                continue
            base = record[0:8].decode('ascii', 'replace').rstrip()
            extension = record[8:11].decode('ascii', 'replace').rstrip()
            if record[12] & 0x08:
                base = base.lower()
            if record[12] & 0x10:
                extension = extension.lower()
            name = ''.join(long_parts[k] for k in sorted(long_parts)) if long_parts else \
                base + ('.' + extension if extension else '')
            long_parts = {}
            if name in ('.', '..'):
                continue
            cluster = struct.unpack_from('<H', record, 0x1A)[0] | struct.unpack_from('<H', record, 0x14)[0] << 16
            entries.append(FatEntry(name, bool(attributes & 0x10), cluster, struct.unpack_from('<I', record, 0x1C)[0]))
        return entries

    def find(self, path):
        """L'entrée d'un chemin (« /title/00040130 »), sans tenir compte de la casse ; None pour la racine."""
        entry = None
        for part in [p for p in path.replace('\\', '/').split('/') if p]:
            if entry is not None and not entry.is_dir:
                raise FileNotFoundError(path)
            matches = [e for e in self.directory(entry) if e.name.lower() == part.lower()]
            if not matches:
                raise FileNotFoundError(path)
            entry = matches[0]
        return entry

    def listdir(self, path='/'):
        entry = self.find(path)
        if entry is not None and not entry.is_dir:
            raise NotADirectoryError(path)
        return self.directory(entry)

    def read(self, path_or_entry, offset=0, size=None):
        entry = self.find(path_or_entry) if isinstance(path_or_entry, str) else path_or_entry
        if entry is None or entry.is_dir:
            raise IsADirectoryError(str(path_or_entry))
        stop = entry.size if size is None else min(entry.size, offset + size)
        if offset >= stop:
            return b''
        return self.read_clusters(entry.cluster, stop - offset, offset)


# --- TMD et titres ---------------------------------------------------------------------------------------------------

SIGNATURE_SIZES = {0x10000: 0x240, 0x10001: 0x140, 0x10002: 0x80, 0x10003: 0x240, 0x10004: 0x140, 0x10005: 0x80}
ContentRecord = namedtuple('ContentRecord', 'content_id index type size digest')


def read_tmd(data):
    """(identifiant de titre, version, contenus) d'un TMD (3dbrew, « Title metadata »)."""
    signature_type = struct.unpack_from('>I', data, 0)[0]
    if signature_type not in SIGNATURE_SIZES:
        raise ValueError('TMD : type de signature inconnu %#x' % signature_type)
    header = SIGNATURE_SIZES[signature_type]
    title_id = struct.unpack_from('>Q', data, header + 0x4C)[0]
    version, count = struct.unpack_from('>HH', data, header + 0x9C)
    contents, at = [], header + 0xC4 + 64 * 0x24
    for _ in range(count):
        content_id, index, kind, size = struct.unpack_from('>IHHQ', data, at)
        contents.append(ContentRecord(content_id, index, kind, size, data[at + 0x10:at + 0x30]))
        at += 0x30
    return title_id, version, contents


def version_text(version):
    return 'v%d (%d.%d.%d)' % (version, version >> 10, (version >> 4) & 0x3F, version & 0xF)


Title = namedtuple('Title', 'title_id version content_path size tmd_path')


def list_titles(fat):
    """Les titres installés de la CTRNAND : pour chacun, le TMD le plus récent dont le contenu principal est là."""
    titles = []
    for high in fat.listdir('/title'):
        if not high.is_dir:
            continue
        for low in fat.directory(high):
            if not low.is_dir:
                continue
            base = '/title/%s/%s/content' % (high.name, low.name)
            try:
                files = {e.name.lower(): e for e in fat.listdir(base)}
            except FileNotFoundError:
                continue
            best = None
            for name, entry in files.items():
                if not name.endswith('.tmd'):
                    continue
                try:
                    title_id, version, contents = read_tmd(fat.read(entry))
                except (ValueError, struct.error):
                    continue
                main = [c for c in contents if c.index == 0] or contents[:1]
                if not main:
                    continue
                app = files.get('%08x.app' % main[0].content_id)
                if app is None:
                    continue
                if best is None or version > best.version:
                    best = Title(title_id, version, base + '/' + app.name, app.size, base + '/' + entry.name)
            if best:
                titles.append(best)
    return sorted(titles, key=lambda t: t.title_id)


# --- NCCH ------------------------------------------------------------------------------------------------------------

def ncch_regions(header):
    """Les régions d'un NCCH en octets : {nom: (décalage, taille)}, seulement celles qui existent."""
    if header[0x100:0x104] != b'NCCH':
        raise ValueError('pas un NCCH (signature %r à 0x100)' % header[0x100:0x104])
    regions = {}
    if struct.unpack_from('<I', header, 0x180)[0] == 0x400:
        regions['exheader'] = (0x200, EXHEADER_SIZE)
    for name, at in (('plain', 0x190), ('logo', 0x198), ('exefs', 0x1A0), ('romfs', 0x1B0)):
        offset, size = struct.unpack_from('<II', header, at)
        if size and not (name == 'romfs' and header[0x18F] & FLAG_NO_ROMFS):
            regions[name] = (offset * MEDIA_UNIT, size * MEDIA_UNIT)
    return regions


def exefs_files(exefs_header):
    """Les fichiers d'un en-tête ExeFS déchiffré : [(nom, décalage dans l'ExeFS, taille)]."""
    files = []
    for slot in range(10):
        name, offset, size = struct.unpack_from('<8sII', exefs_header, slot * 0x10)
        name = name.rstrip(b'\x00').decode('ascii', 'replace')
        if name and size:
            files.append((name, EXEFS_HEADER_SIZE + offset, size))
    return files


def aes_ctr(key, counter, data):
    if PYLIB not in sys.path:
        sys.path.insert(0, PYLIB)
    try:
        from Cryptodome.Cipher import AES
    except ImportError:
        from Crypto.Cipher import AES
    return AES.new(key, AES.MODE_CTR, nonce=b'', initial_value=counter.to_bytes(16, 'big')).decrypt(data)


def crypt_range(buffer, base, start, stop, key, counter):
    """Chiffre ou déchiffre (c'est le même calcul en CTR) buffer[base+start:base+stop], le compteur partant de base."""
    if stop <= start:
        return
    aligned = start - start % 16
    chunk = bytes(buffer[base + aligned:base + stop])
    buffer[base + start:base + stop] = aes_ctr(key, counter + aligned // 16, chunk)[start - aligned:]


def crypt_ncch(buffer, main_key, extra_key, exefs_header_plain):
    """Applique la clé de chaque région à un NCCH (bytearray), dans un sens ou dans l'autre. L'en-tête ExeFS en clair
    est donné à part : il dit quels fichiers prennent la seconde clé (tous sauf icon et banner)."""
    header = bytes(buffer[:0x200])
    regions = ncch_regions(header)
    partition_id = struct.unpack_from('<Q', header, 0x108)[0]

    def counter(section):
        return partition_id << 64 | section << 56

    if 'exheader' in regions:
        offset, size = regions['exheader']
        crypt_range(buffer, offset, 0, size, main_key, counter(SECTION_EXHEADER))
    if 'exefs' in regions:
        offset, size = regions['exefs']
        cuts = []
        for name, start, length in exefs_files(exefs_header_plain):
            if name not in EXEFS_MAIN_KEY_FILES:
                cuts.append((start, min(start + length, size)))
        position = 0
        for start, stop in sorted(cuts) + [(size, size)]:
            crypt_range(buffer, offset, position, start, main_key, counter(SECTION_EXEFS))
            crypt_range(buffer, offset, max(start, position), stop, extra_key, counter(SECTION_EXEFS))
            position = max(position, stop)
    if 'romfs' in regions:
        offset, size = regions['romfs']
        crypt_range(buffer, offset, 0, size, extra_key, counter(SECTION_ROMFS))


def mark_decrypted(header):
    """Les drapeaux d'un NCCH déchiffré, comme les écrit GodMode9 : méthode 0, plus de clé fixe ni de graine, et le
    bit « sans chiffrement »."""
    header = bytearray(header)
    header[0x18B] = 0
    header[0x18F] = (header[0x18F] & ~(FLAG_FIXED_KEY | FLAG_SEED)) | FLAG_NO_CRYPTO
    return bytes(header)


def decrypt_ncch(data, key_pair):
    """Rend le NCCH déchiffré. key_pair(en-tête) rend (clé principale, seconde clé) ; rien n'est fait s'il est déjà
    en clair."""
    header = data[:0x200]
    if header[0x18F] & FLAG_NO_CRYPTO:
        return bytes(data)
    version = struct.unpack_from('<H', header, 0x112)[0]
    if version == 1:
        raise ValueError('NCCH de version 1 (compteur par décalage) : non pris en charge')
    main_key, extra_key = key_pair(header)
    buffer = bytearray(data)
    regions = ncch_regions(header)
    exefs_header = b''
    if 'exefs' in regions:
        offset = regions['exefs'][0]
        partition_id = struct.unpack_from('<Q', header, 0x108)[0]
        exefs_header = aes_ctr(main_key, partition_id << 64 | SECTION_EXEFS << 56,
                               bytes(data[offset:offset + EXEFS_HEADER_SIZE]))
    crypt_ncch(buffer, main_key, extra_key, exefs_header)
    buffer[:0x200] = mark_decrypted(header)
    return bytes(buffer)


def check_ncch(data):
    """Contrôle un NCCH déchiffré par les empreintes de son en-tête : rend la liste des régions fausses."""
    header = data[:0x200]
    regions = ncch_regions(header)
    wrong = []
    if 'exheader' in regions and hashlib.sha256(data[0x200:0x600]).digest() != header[0x160:0x180]:
        wrong.append('exheader')
    for name, at in (('exefs', 0x1C0), ('romfs', 0x1E0)):
        if name not in regions:
            continue
        offset = regions[name][0]
        hashed = struct.unpack_from('<I', header, 0x1A8 if name == 'exefs' else 0x1B8)[0] * MEDIA_UNIT
        if hashed and hashlib.sha256(data[offset:offset + hashed]).digest() != header[at:at + 0x20]:
            wrong.append(name)
    return wrong


def exheader_name(data):
    """Le nom du titre écrit au début de l'exheader déchiffré (« cfg », « ns »...), ou None."""
    if struct.unpack_from('<I', data, 0x180)[0] != 0x400:
        return None
    name = data[0x200:0x208].split(b'\x00')[0].decode('ascii', 'replace')
    return name if name.isprintable() and name else None


# --- SAVE (sauvegardes système) --------------------------------------------------------------------------------------

def save_chain(fat, first_block):
    """Les blocs d'une chaîne de la table d'allocation d'une sauvegarde (3dbrew, « Inner FAT »). La table compte à
    partir de 1 : l'entrée k décrit le bloc k-1 ; un nœud de plusieurs blocs porte le bit 31 dans son mot V, et
    l'entrée qui le suit donne l'indice du dernier bloc du nœud."""
    blocks, index, seen = [], first_block + 1, set()
    while index:
        if index in seen or index >= len(fat):
            raise ValueError('chaîne de sauvegarde incohérente à l\'entrée %d' % index)
        seen.add(index)
        _, v = fat[index]
        if v & 0x80000000:
            last = fat[index + 1][1] & 0x7FFFFFFF
            blocks.extend(range(index - 1, last))
        else:
            blocks.append(index - 1)
        index = v & 0x7FFFFFFF
    return blocks


def read_save_fs(image, data_image=None):
    """Les fichiers d'une image « SAVE » (la partition A d'un DISA ; data_image, la partition B s'il y en a une) :
    {chemin: octets}."""
    if image[:4] != b'SAVE':
        raise ValueError('pas une image SAVE (signature %r)' % image[:4])
    info = struct.unpack_from('<Q', image, 0x08)[0]
    (_, block_size, _, _, _, _, fat_offset, fat_count, data_offset, _, dir_table, dir_max, file_table,
     file_max) = struct.unpack_from('<IIQI4xQI4xQI4xQI4xQI4xQI4x', image, info)[:14]
    data = image if data_image is None else data_image
    fat = [struct.unpack_from('<II', image, fat_offset + 8 * i) for i in range(fat_count + 1)]

    def chain_bytes(first_block, size=None):
        out = b''.join(data[data_offset + b * block_size:data_offset + (b + 1) * block_size]
                       for b in save_chain(fat, first_block))
        return out if size is None else out[:size]

    directories = chain_bytes(dir_table & 0xFFFFFFFF, (dir_max + 2) * 0x28)
    files = chain_bytes(file_table & 0xFFFFFFFF, (file_max + 1) * 0x30)
    found = {}

    def walk(dir_index, prefix, depth=0):
        if depth > 32:
            raise ValueError('dossiers de sauvegarde trop profonds')
        _, name, _, first_dir, first_file = struct.unpack_from('<I16sIII', directories, dir_index * 0x28)
        file_index = first_file
        while file_index:
            _, file_name, next_file, _, first_block, size = struct.unpack_from('<I16sIIIQ', files, file_index * 0x30)
            file_name = file_name.rstrip(b'\x00').decode('ascii', 'replace')
            found[prefix + file_name] = b'' if size == 0 or first_block & 0x80000000 else chain_bytes(first_block, size)
            file_index = next_file
        sub = first_dir
        while sub:
            sub_name = struct.unpack_from('<16s', directories, sub * 0x28 + 4)[0].rstrip(b'\x00').decode('ascii')
            walk(sub, prefix + sub_name + '/', depth + 1)
            sub = struct.unpack_from('<I', directories, sub * 0x28 + 0x14)[0]

    walk(1, '/')
    return found


# --- La console ------------------------------------------------------------------------------------------------------

def load_pyctr():
    if PYLIB not in sys.path:
        sys.path.insert(0, PYLIB)
    try:
        import pyctr.crypto
        import pyctr.type.nand
        import pyctr.type.save.disa
    except ImportError:
        sys.exit('pyctr est absent de local/pylib/. L\'installer par :\n'
                 '    python -m pip install --target local/pylib pyctr')
    return pyctr


class Console:
    """La NAND ouverte : la CTRNAND en FAT et les clés des NCCH. Les clés restent dans pyctr, jamais affichées."""

    def __init__(self, nand_path=DEFAULT_NAND, boot9_path=DEFAULT_BOOT9, otp_path=None, cid_path=None):
        pyctr = load_pyctr()
        from pyctr.crypto import CryptoEngine
        from pyctr.type.nand import NAND
        for path, what in ((nand_path, 'l\'image NAND'), (boot9_path, 'boot9.bin')):
            if not os.path.isfile(path):
                sys.exit('%s introuvable : %s' % (what, path))
        try:
            # Deux moteurs : celui de la NAND reçoit les clés de l'OTP, qui réécrivent aussi les clés X des
            # emplacements 0x18 à 0x1B avec les valeurs de boot9 ; or les NCCH « New 3DS » (méthodes 0x0A et 0x0B)
            # veulent celles que pose le chargeur ARM9 de la New 3DS. Le second moteur, sans OTP, les garde.
            self.nand_crypto = CryptoEngine(boot9=boot9_path)
            self.crypto = CryptoEngine(boot9=boot9_path)
            self.boot9_path = boot9_path
            self.nand = NAND(nand_path, crypto=self.nand_crypto, otp_file=otp_path, cid_file=cid_path,
                             auto_raise_exceptions=False)
        except pyctr.common.PyCTRError as error:
            # Les messages de pyctr citent parfois des empreintes de l'OTP : on ne les recopie pas.
            sys.exit('pyctr n\'a pas pu ouvrir la NAND (%s). boot9.bin, l\'OTP et le CID sont-ils bien ceux de cette '
                     'console ?' % type(error).__name__)
        if not self.nand.ctr_partitions:
            sys.exit('La CTRNAND ne se déchiffre pas : l\'OTP ou le CID ne sont pas ceux de cette image.')
        self.fat = FatVolume(ReadOnlyIO(self.nand.open_ctr_partition(0)))
        self._names = {}
        self._titles = None

    def close(self):
        self.nand.close()

    def key_pair(self, header):
        """Les deux clés d'un NCCH, tirées par pyctr de boot9 (clé X) et de la signature de l'en-tête (clé Y)."""
        from pyctr.crypto import Keyslot
        flags = header[0x188:0x190]
        if flags[7] & FLAG_SEED:
            raise ValueError('NCCH à graine : non pris en charge')
        if flags[7] & FLAG_FIXED_KEY:
            program_id = struct.unpack_from('<Q', header, 0x118)[0]
            slot = Keyslot.FixedSystemKey if program_id & (0x10 << 32) else Keyslot.ZeroKey
            key = self.crypto.key_normal[slot]
            return key, key
        if flags[3] not in EXTRA_SLOTS:
            raise ValueError('méthode de chiffrement NCCH inconnue %#x' % flags[3])
        key_y = int.from_bytes(header[:16], 'big')
        main = self.crypto.keygen_manual(self.crypto.key_x[SLOT_NCCH], key_y)
        extra = self.crypto.keygen_manual(self.crypto.key_x[EXTRA_SLOTS[flags[3]]], key_y)
        return main, extra

    def partitions(self):
        from pyctr.type.nand import NANDSection
        rows = []
        for key, info in sorted(self.nand.header.partition_table.items(), key=lambda kv: (kv[1].offset, str(kv[0]))):
            if isinstance(key, int) and not isinstance(key, NANDSection) and key >= 0:
                rows.append((key, info.base_file or '?', info.offset, info.size))
        return rows

    def titles(self):
        if self._titles is None:
            self._titles = list_titles(self.fat)
        return self._titles

    def title_ncch(self, title):
        """Le contenu principal d'un titre, déchiffré, vérifié par les empreintes de son en-tête."""
        data = decrypt_ncch(self.fat.read(title.content_path), self.key_pair)
        wrong = check_ncch(data)
        if wrong:
            raise ValueError('%016X : empreintes fausses après déchiffrement (%s)' % (title.title_id, ', '.join(wrong)))
        return data

    def title_name(self, title):
        """Nom d'un titre : celui de l'exheader pour un programme ; pour une archive, celui de KNOWN_ARCHIVES ou
        data-<bas de l'identifiant>."""
        if title not in self._names:
            self._names[title] = self._read_name(title)
        return self._names[title]

    def _read_name(self, title):
        head = self.fat.read(title.content_path, 0, 0x600)
        if struct.unpack_from('<I', head, 0x180)[0] == 0x400:
            if not head[0x18F] & FLAG_NO_CRYPTO:
                main, _ = self.key_pair(head[:0x200])
                partition_id = struct.unpack_from('<Q', head, 0x108)[0]
                head = head[:0x200] + aes_ctr(main, partition_id << 64 | SECTION_EXHEADER << 56, head[0x200:0x600])
            name = exheader_name(head)
            if name:
                return name
            product = head[0x150:0x160].split(b'\x00')[0].decode('ascii', 'replace')
            if head[0x18D] & 0x02 and product.count('-') == 2 and product.isprintable():
                return product.rsplit('-', 1)[1]          # programme sans nom dans l'exheader : son code produit
        return KNOWN_ARCHIVES.get(title.title_id, 'data-%08X' % (title.title_id & 0xFFFFFFFF))

    def save_image(self, save_id):
        """Le fichier brut d'une sauvegarde système : /data/<ID0>/sysdata/<id>/00000000."""
        for entry in self.fat.listdir('/data'):
            if entry.is_dir:
                try:
                    return self.fat.read('/data/%s/sysdata/%08x/00000000' % (entry.name, save_id))
                except FileNotFoundError:
                    continue
        raise FileNotFoundError('sauvegarde système %08X absente de /data' % save_id)


def disa_files(raw, crypto):
    """Les fichiers d'un conteneur DISA (sauvegarde système), lu par pyctr, puis l'image SAVE par read_save_fs.
    Les sauvegardes de la CTRNAND ne sont pas chiffrées (seulement signées par un CMAC, qu'on ne vérifie pas)."""
    load_pyctr()
    from pyctr.type.save.disa import DISA
    from pyctr.type.save.partdesc.ivfc import IVFCLevel4Reader
    disa = DISA(io.BytesIO(raw), crypto=crypto)
    images = [IVFCLevel4Reader(disa.partitions[i].ivfc_hash_tree).read() for i in sorted(disa.partitions)]
    return read_save_fs(images[0], images[1] if len(images) > 1 else None)


# --- Commandes -------------------------------------------------------------------------------------------------------

def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_new(path, data):
    """Écrit un fichier sous local/ ; si un fichier existe déjà, rien n'est écrasé : le nouveau va en .nand.<ext>.
    Rend le chemin écrit (ou le chemin existant s'il a déjà les mêmes octets)."""
    if not os.path.abspath(path).startswith(LOCAL + os.sep):
        raise ValueError('écriture hors de local/ refusée : %s' % path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, 'rb') as f:
            if f.read() == data:
                return path
        stem, extension = os.path.splitext(path)
        path = stem + '.nand' + extension
    with open(path, 'wb') as f:
        f.write(data)
    return path


def relative(path):
    return os.path.relpath(path, ROOT).replace('\\', '/')


def show_summary(console):
    print('Partitions de la NAND :')
    for index, kind, offset, size in console.partitions():
        print('  %d  %-10s à %#011x, %7.1f Mo' % (index, kind, offset, size / 1e6))
    print('Sauvegarde essentielle de GodMode9 : %s' % (', '.join(console.nand.essential.entries)
                                                    if console.nand.essential else 'absente'))
    print('CTRNAND : FAT%d, grappes de %d octets\n' % (console.fat.bits, console.fat.cluster_size))
    show_titles(console)


def show_titles(console, text_filter=None):
    titles = console.titles()
    names = output_names(console, titles)
    shown = 0
    for title in titles:
        line = '%016X  %-18s %-18s %9d octets  %s' % (title.title_id, names[title], version_text(title.version), title.size,
                                                      CATEGORIES.get(title.title_id >> 32, ''))
        if text_filter and text_filter.lower() not in line.lower():
            continue
        print(line)
        shown += 1
    print('\n%d titres sur %d installés.' % (shown, len(titles)))


def resolve_titles(console, wanted):
    """Les titres désignés par identifiant (16 chiffres, ou les 8 du bas) ou par nom de sortie (« cfg »,
    « cfg-safe », « police »)."""
    titles = console.titles()
    names = output_names(console, titles)
    chosen = []
    for item in wanted:
        matches = []
        try:
            number = int(item, 16) if len(item) in (8, 16) else None
        except ValueError:
            number = None
        for title in titles:
            if number is not None and (title.title_id == number or (len(item) == 8 and title.title_id & 0xFFFFFFFF == number)):
                matches.append(title)
            elif names[title] == item.lower():
                matches.append(title)
        if not matches:
            sys.exit('Aucun titre ne répond à « %s » (voir « python nand.py titles »).' % item)
        chosen.extend(matches)
    return chosen


def is_safe_mode(title_id):
    """Les modules et applets du mode sans échec (SAFE_MODE_FIRM) de la New 3DS finissent par 03 ; ceux qui
    tournent sous NATIVE_FIRM, par 02."""
    return title_id >> 32 in (0x00040130, 0x00040030, 0x00040138) and title_id & 0xFF == 0x03


def output_names(console, titles):
    """Un nom de fichier par titre, en minuscules comme les dumps de GodMode9 (« cfg », « ns »). La version du mode
    sans échec prend le suffixe -safe ; si deux titres ont encore le même nom, les catégories extraites par « all »
    le gardent, les autres prennent -<bas de l'identifiant>."""
    order = sorted(titles, key=lambda t: (t.title_id >> 32 not in CATEGORIES, is_safe_mode(t.title_id), t.title_id))
    taken, names = set(), {}
    for title in order:
        name = console.title_name(title).lower() + ('-safe' if is_safe_mode(title.title_id) else '')
        if name in taken:
            name = '%s-%08x' % (name, title.title_id & 0xFFFFFFFF)
        taken.add(name)
        names[title] = name
    return names


def extract_title(console, title, name, run_extraire=True):
    """Écrit le NCCH déchiffré dans local/dump/systeme/<nom>.cxi (ou .cfa) et le passe à extraire.py. Rend une ligne
    d'inventaire (titre, nom, version, taille, empreinte, chemin du dump, dossier extrait)."""
    data = console.title_ncch(title)
    extension = '.cxi' if data[0x18D] & 0x02 else '.cfa'
    path = write_new(os.path.join(SYSTEM_DUMPS, name + extension), data)
    out_dir = os.path.join(EXTRACTED, name)
    if run_extraire and not os.path.isdir(os.path.join(out_dir, 'exefs')) and not os.path.isdir(os.path.join(out_dir, 'romfs')):
        quiet_extraire(path, name)
    return (title, name, len(data), sha256(data), path, out_dir if os.path.isdir(out_dir) else None)


def quiet_extraire(path, name):
    """extraire.py, sa sortie écrite dans local/extrait/<nom>.log comme pour les modules déjà extraits."""
    log_path = os.path.join(EXTRACTED, name + '.log')
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'extraire.py')
    environment = dict(os.environ, PYTHONIOENCODING='utf-8')
    with open(log_path, 'w', encoding='utf-8') as log:
        code = subprocess.call([sys.executable, script, path, name], stdout=log, stderr=subprocess.STDOUT,
                               env=environment)
    if code:
        print('  extraire.py a échoué pour %s (code %d, voir %s)' % (name, code, relative(log_path)))


def cmd_title(console, wanted):
    titles = resolve_titles(console, wanted)
    names = output_names(console, console.titles())
    for title in titles:
        row = extract_title(console, title, names[title])
        print('%016X  %-14s %s  ->  %s' % (title.title_id, row[1], version_text(title.version), relative(row[4])))
        if row[5]:
            print('    extrait dans %s' % relative(row[5]))


def cmd_file(console, path, out=None):
    data = console.fat.read(path)
    target = out or os.path.join(CTRNAND_FILES, *[p for p in path.replace('\\', '/').split('/') if p])
    written = write_new(os.path.abspath(target), data)
    print('%s : %d octets, SHA-256 %s  ->  %s' % (path, len(data), sha256(data), relative(written)))
    return written


def cmd_config(console):
    """La sauvegarde de cfg : le conteneur brut dans local/dump/systeme/, le fichier config dans local/extrait/."""
    raw = console.save_image(CFG_SAVE_ID)
    raw_path = write_new(os.path.join(SYSTEM_DUMPS, 'sysdata-%08X.sav' % CFG_SAVE_ID), raw)
    files = disa_files(raw, console.crypto)
    rows = [('sauvegarde %08X' % CFG_SAVE_ID, 'cfg (conteneur DISA)', len(raw), sha256(raw), raw_path)]
    for name, data in sorted(files.items()):
        path = write_new(os.path.join(EXTRACTED, 'cfg-sauvegarde', name.strip('/')), data)
        rows.append(('sauvegarde %08X' % CFG_SAVE_ID, 'fichier ' + name, len(data), sha256(data), path))
    config = files.get('/config')
    if config is not None:
        from pyctr.type.config.save import ConfigSaveReader
        blocks = ConfigSaveReader.load(io.BytesIO(config))
        print('config : %d octets, %d blocs de configuration lus par pyctr' % (len(config), len(blocks.blocks)))
    for row in rows:
        print('%-22s %-24s %7d octets  ->  %s' % (row[0], row[1], row[2], relative(row[4])))
    return rows


def cmd_sd(console, sd_root, title_id):
    """La sauvegarde (title/<haut>/<bas>/data/*.sav) et les données étendues (extdata/00000000/<bas sans le
    00000 de tête>) d'un jeu, dans une copie locale du dossier « Nintendo 3DS » de la carte SD.

    La clé de la carte vient du movable.sed de la CTRNAND (/private/movable.sed), pas de celui de la sauvegarde
    « essentielle » de GodMode9 : sur cette console, les deux diffèrent, et seul celui de la CTRNAND donne l'id0 du
    dossier de la carte (relevé le 2026-10-14). pyctr le vérifie : il refuse un movable dont l'id0 n'est pas là."""
    load_pyctr()
    from pyctr.crypto import CryptoEngine
    from pyctr.type.sd import SDFilesystem
    from pyctr.type.save.diff import DIFF
    from pyctr.type.save.partdesc.ivfc import IVFCLevel4Reader
    title_id = title_id.lower().replace('/', '')
    if len(title_id) != 16:
        raise ValueError('identifiant de titre attendu sur 16 chiffres hexadécimaux : %s' % title_id)
    high, low = title_id[:8], title_id[8:]
    crypto = CryptoEngine(boot9=console.boot9_path)
    sd = SDFilesystem(sd_root, crypto=crypto, sd_key=console.fat.read('/private/movable.sed'))
    out = os.path.join(EXTRACTED, 'sd-' + title_id)
    written = []

    def keep(relative_path, data):
        target = os.path.join(out, *relative_path.split('/'))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as f:
            f.write(data)
        written.append((relative_path, len(data), sha256(data)))

    data_dir = '/title/%s/%s/data' % (high, low)
    if sd.isdir(data_dir):
        for name in sorted(sd.listdir(data_dir)):
            with sd.open(data_dir + '/' + name) as f:
                raw = f.read()
            keep('sauvegarde/' + name, raw)
            for path, content in sorted(disa_files(raw, crypto).items()):
                keep('sauvegarde/fichiers' + path, content)
    extdata_dir = '/extdata/00000000/%08x' % (int(low, 16) >> 8)
    if sd.isdir(extdata_dir):
        for sub in sorted(sd.listdir(extdata_dir)):
            for name in sorted(sd.listdir(extdata_dir + '/' + sub)):
                with sd.open('%s/%s/%s' % (extdata_dir, sub, name)) as f:
                    raw = f.read()
                diff = DIFF(io.BytesIO(raw), crypto=crypto)
                image = IVFCLevel4Reader(diff.partitions[sorted(diff.partitions)[0]].ivfc_hash_tree).read()
                keep('extdata/%s/%s.bin' % (sub, name), image)
    if not written:
        raise ValueError('ni sauvegarde ni données étendues pour %s sous %s' % (title_id, sd_root))
    for path, size, digest in written:
        print('%-40s %9d octets  %s' % (path, size, digest[:16]))
    print('->', relative(out))


def shared_font(rows):
    """Décompresse les cbf_*.bcfnt.lz des archives de police extraites, dans local/extrait/police-partagee/."""
    out = []
    for _, name, _, _, _, folder in rows:
        if not folder or not name.startswith('police'):
            continue
        romfs = os.path.join(folder, 'romfs')
        for file_name in sorted(os.listdir(romfs)) if os.path.isdir(romfs) else []:
            if file_name.endswith('.bcfnt.lz'):
                with open(os.path.join(romfs, file_name), 'rb') as f:
                    font = lz11.decompresser(f.read())
                if font[:4] != b'CFNT':
                    print('  %s : décompressé, mais la signature n\'est pas CFNT (%r)' % (file_name, font[:4]))
                path = write_new(os.path.join(SHARED_FONT_DIR, file_name[:-3]), font)
                out.append((name, file_name[:-3], len(font), sha256(font), path))
    return out


def cmd_all(console):
    titles = [t for t in console.titles() if t.title_id >> 32 in CATEGORIES]
    names = output_names(console, console.titles())
    rows, failures = [], []
    for number, title in enumerate(titles, 1):
        print('[%d/%d] %016X %s' % (number, len(titles), title.title_id, names[title]), flush=True)
        try:
            rows.append(extract_title(console, title, names[title]))
        except (ValueError, struct.error) as error:
            failures.append((title, str(error)))
            print('  échec : %s' % error)
    fonts = shared_font(rows)
    config_rows = cmd_config(console)
    write_inventory(rows, fonts, config_rows, failures)
    print('\n%d titres extraits, %d échecs ; inventaire dans %s' % (len(rows), len(failures), relative(INVENTORY)))


def romfs_preview(folder, count=4):
    """Les premiers noms du RomFS extrait (« CFL_Res.dat », « 0.txt 1.txt ... (18) »), pour reconnaître une archive."""
    romfs = os.path.join(folder, 'romfs') if folder else None
    if not romfs or not os.path.isdir(romfs):
        return '-'
    names = sorted(n + ('/' if os.path.isdir(os.path.join(romfs, n)) else '') for n in os.listdir(romfs))
    if not names:
        return '(vide)'
    return ' '.join(names[:count]) + (' ... (%d)' % len(names) if len(names) > count else '')


def write_inventory(rows, fonts, config_rows, failures):
    lines = ['# Ce que nand.py a tiré de local/dump/nand.bin. Colonnes : titre, nom, version, catégorie, taille,',
             '# SHA-256 du NCCH déchiffré, dump, dossier extrait, début du RomFS.', '']
    for title, name, size, digest, path, folder in rows:
        lines.append('\t'.join(('%016X' % title.title_id, name, version_text(title.version),
                                CATEGORIES.get(title.title_id >> 32, ''), str(size), digest, relative(path),
                                relative(folder) if folder else '-', romfs_preview(folder))))
    lines += ['', '# Police partagée, décompressée (LZ11) depuis l\'archive : archive, fichier, taille, SHA-256, chemin.']
    for archive, name, size, digest, path in fonts:
        lines.append('\t'.join((archive, name, str(size), digest, relative(path))))
    lines += ['', '# Sauvegarde de configuration de cfg : quoi, taille, SHA-256, chemin.']
    for what, name, size, digest, path in config_rows:
        lines.append('\t'.join((what, name, str(size), digest, relative(path))))
    if failures:
        lines += ['', '# Échecs']
        lines += ['%016X\t%s' % (title.title_id, error) for title, error in failures]
    os.makedirs(EXTRACTED, exist_ok=True)
    with open(INVENTORY, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')


def first_difference(a, b):
    for at in range(0, min(len(a), len(b)), 0x1000):
        if a[at:at + 0x1000] != b[at:at + 0x1000]:
            return next(i for i in range(at, at + 0x1000) if i >= len(a) or i >= len(b) or a[i] != b[i])
    return min(len(a), len(b)) if len(a) != len(b) else None


def region_of(header, offset):
    if offset < 0x200:
        return 'en-tête NCCH'
    for name, (start, size) in ncch_regions(header).items():
        if start <= offset < start + size:
            return name
    return 'hors des régions'


def cmd_verify(console, names=None, write=True):
    """Déchiffre les titres dont GodMode9 a dumpé un .cxi et compare octet pour octet. La version tirée de la NAND
    est écrite à côté, en <nom>.nand.cxi, pour qu'on puisse refaire la comparaison sans cet outil. Le titre est
    retrouvé par l'identifiant écrit dans l'en-tête du dump de GodMode9."""
    wanted = names or [n for n in GODMODE9_DUMPS if os.path.isfile(os.path.join(SYSTEM_DUMPS, n + '.cxi'))]
    by_id = {title.title_id: title for title in console.titles()}
    same = 0
    for name in wanted:
        path = os.path.join(SYSTEM_DUMPS, name + '.cxi')
        if not os.path.isfile(path):
            print('%-8s pas de .cxi à comparer' % name)
            continue
        with open(path, 'rb') as f:
            reference = f.read()
        title = by_id.get(struct.unpack_from('<Q', reference, 0x118)[0])
        if title is None:
            print('%-8s %016X absent de la CTRNAND' % (name, struct.unpack_from('<Q', reference, 0x118)[0]))
            continue
        ours = console.title_ncch(title)
        if write:
            with open(os.path.join(SYSTEM_DUMPS, name + '.nand.cxi'), 'wb') as f:
                f.write(ours)
        if ours == reference:
            same += 1
            print('%-8s %016X %s  identique (%d octets, SHA-256 %s)' % (name, title.title_id, version_text(title.version),
                                                                     len(ours), sha256(ours)))
            continue
        at = first_difference(ours, reference)
        print('%-8s %016X  DIFFÉRENT : tailles %d et %d, premier écart à %#x (%s)' % (
            name, title.title_id, len(ours), len(reference), at, region_of(ours[:0x200], at)))
    print('\n%d identiques sur %d comparés.' % (same, len(wanted)))
    if not names:
        verify_firm(console)
    return same


NATIVE_FIRM_TITLE = 0x0004013820000002          # NATIVE_FIRM de la New 3DS, titre de la CTRNAND


def firm_sections(data):
    """Les sections d'un FIRM : [(adresse de chargement, octets)]."""
    if data[:4] != b'FIRM':
        raise ValueError('pas un FIRM')
    sections = []
    for index in range(4):
        offset, load, size = struct.unpack_from('<III', data, 0x40 + 0x30 * index)
        if size:
            sections.append((load, data[offset:offset + size]))
    return sections


def verify_firm(console):
    """Les modules de démarrage (sm, fs, pm, loader, pxi) ne sont pas des titres : ils sont dans une section ARM11
    du FIRM. On compare donc le .firm du titre NATIVE_FIRM de la CTRNAND au native.firm de GodMode9, section par
    section. La section ARM9 diffère forcément : GodMode9 l'écrit déchiffrée, la CTRNAND la garde chiffrée."""
    path = os.path.join(SYSTEM_DUMPS, 'native.firm')
    titles = [t for t in console.titles() if t.title_id == NATIVE_FIRM_TITLE]
    if not titles or not os.path.isfile(path):
        return
    data = console.title_ncch(titles[0])
    offset = ncch_regions(data[:0x200])['exefs'][0]
    files = {name: (start, size) for name, start, size in exefs_files(data[offset:offset + EXEFS_HEADER_SIZE])}
    start, size = files['.firm']
    ours = firm_sections(data[offset + start:offset + start + size])
    with open(path, 'rb') as f:
        reference = firm_sections(f.read())
    print('\nNATIVE_FIRM %016X %s, comparé à native.firm :' % (titles[0].title_id, version_text(titles[0].version)))
    for (load, section), (_, other) in zip(ours, reference):
        arm9 = 0x08000000 <= load < 0x08100000
        print('  section à %#010x (%s, %d octets) : %s' % (
            load, 'ARM9' if arm9 else 'ARM11', len(section),
            'identique' if section == other else 'différente' + (' (attendu : chiffrée dans la CTRNAND)' if arm9 else '')))


# --- Test sans dump --------------------------------------------------------------------------------------------------

def make_fat16(files):
    """Un petit volume FAT16 fabriqué : files = {chemin: octets}. Noms longs pour tout ce qui n'est pas 8.3 en
    majuscules, grappes de 512 octets, fichiers volontairement fragmentés."""
    sector, cluster_sectors, reserved, fat_sectors, root_entries = 0x200, 1, 1, 64, 64
    total = 5000
    boot = bytearray(sector)
    struct.pack_into('<HBHBHHBH', boot, 0x0B, sector, cluster_sectors, reserved, 1, root_entries, total, 0xF8,
                     fat_sectors)
    boot[0x1FE:0x200] = b'\x55\xAA'
    fat = [0xFFF8, 0xFFFF] + [0] * (fat_sectors * sector // 2 - 2)
    data = {}
    next_free = [2]

    def allocate(payload):
        count = max(1, (len(payload) + sector - 1) // sector)
        clusters = []
        for _ in range(count):
            clusters.append(next_free[0])
            next_free[0] += 2 if len(clusters) % 2 else 1      # un trou sur deux : la chaîne n'est pas contiguë
        for here, following in zip(clusters, clusters[1:] + [None]):
            fat[here] = following if following else 0xFFFF
        for i, cluster in enumerate(clusters):
            data[cluster] = payload[i * sector:(i + 1) * sector].ljust(sector, b'\x00')
        return clusters[0]

    def entries_for(name, is_dir, cluster, size):
        records = []
        if name.upper() == name and len(name.split('.')[0]) <= 8 and '.' not in name[:-4]:
            base, _, ext = name.partition('.')
            short = base.ljust(8).encode() + ext.ljust(3).encode()
        else:
            short = ('~%06d' % (len(name) * 7 % 999999)).encode().ljust(8) + b'   '
            checksum = 0
            for byte in short:
                checksum = ((checksum >> 1) | ((checksum & 1) << 7)) + byte & 0xFF
            utf16 = name.encode('utf-16-le') + b'\x00\x00'
            pieces = [utf16[i:i + 26] for i in range(0, len(utf16), 26)]
            for order in range(len(pieces), 0, -1):
                chunk = pieces[order - 1].ljust(26, b'\xff')
                record = bytearray(32)
                record[0] = order | (0x40 if order == len(pieces) else 0)
                record[1:11], record[14:26], record[28:32] = chunk[0:10], chunk[10:22], chunk[22:26]
                record[11], record[13] = 0x0F, checksum
                records.append(bytes(record))
        record = bytearray(32)
        record[0:11] = short
        record[11] = 0x10 if is_dir else 0x20
        struct.pack_into('<HI', record, 0x1A, cluster, 0 if is_dir else size)
        records.append(bytes(record))
        return records

    tree = {}
    for path, payload in files.items():
        parts = [p for p in path.split('/') if p]
        node = tree
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = payload

    def build(node):
        records = []
        for name, value in node.items():
            if isinstance(value, dict):
                listing = build(value)
                records += entries_for(name, True, allocate(listing), 0)
            else:
                records += entries_for(name, False, allocate(value), len(value))
        return b''.join(records) + b'\x00' * 32

    root = build(tree)
    assert len(root) <= root_entries * 32
    image = bytearray(boot)
    image += struct.pack('<%dH' % len(fat), *fat)
    image += root.ljust(root_entries * 32, b'\x00')
    for cluster in range(2, max(data) + 1):
        image += data.get(cluster, b'\x00' * sector)
    return bytes(image)


def make_tmd(title_id, version, contents):
    """Un TMD (signature RSA-2048) : contents = [(identifiant, index, taille)]."""
    header = 0x140
    tmd = bytearray(header + 0xC4 + 64 * 0x24 + 0x30 * len(contents))
    struct.pack_into('>I', tmd, 0, 0x10004)
    struct.pack_into('>Q', tmd, header + 0x4C, title_id)
    struct.pack_into('>HH', tmd, header + 0x9C, version, len(contents))
    for i, (content_id, index, size) in enumerate(contents):
        struct.pack_into('>IHHQ', tmd, header + 0xC4 + 64 * 0x24 + 0x30 * i, content_id, index, 0, size)
    return bytes(tmd)


def make_plain_ncch(title_id, name, with_romfs=True):
    """Un NCCH en clair (drapeaux « chiffré »), avec exheader, ExeFS (.code, icon, banner) et RomFS, empreintes
    justes : ce que la console a avant de chiffrer."""
    import random
    rng = random.Random(title_id)
    exefs_files_ = [('.code', bytes(rng.randrange(256) for _ in range(0x530))), ('icon', b'I' * 0x36C0),
                    ('banner', b'B' * 0x100)]
    exefs_header = bytearray(EXEFS_HEADER_SIZE)
    body, position = b'', 0
    for slot, (file_name, payload) in enumerate(exefs_files_):
        struct.pack_into('<8sII', exefs_header, slot * 0x10, file_name.encode(), position, len(payload))
        exefs_header[0xC0 + (9 - slot) * 0x20:0xE0 + (9 - slot) * 0x20] = hashlib.sha256(payload).digest()
        padded = payload.ljust((len(payload) + 0x1FF) // 0x200 * 0x200, b'\x00')
        body += padded
        position += len(padded)
    exefs = bytes(exefs_header) + body
    romfs = bytes(rng.randrange(256) for _ in range(0x1000)) if with_romfs else b''
    exheader = bytearray(EXHEADER_SIZE)
    exheader[0:len(name)] = name.encode()
    header = bytearray(0x200)
    header[0:0x100] = bytes(rng.randrange(256) for _ in range(0x100))
    header[0x100:0x104] = b'NCCH'
    exefs_offset = 0x200 + EXHEADER_SIZE + 0x200                          # une zone vide entre exheader et ExeFS
    romfs_offset = exefs_offset + len(exefs) + 0x200
    total = romfs_offset + len(romfs)
    struct.pack_into('<IQ', header, 0x104, total // MEDIA_UNIT, title_id)
    struct.pack_into('<H', header, 0x112, 2)
    struct.pack_into('<Q', header, 0x118, title_id)
    header[0x150:0x15A] = b'CTR-P-TEST'
    header[0x160:0x180] = hashlib.sha256(bytes(exheader[:0x400])).digest()
    struct.pack_into('<I', header, 0x180, 0x400)
    header[0x188 + 3] = 0x00
    header[0x188 + 4] = 2
    header[0x188 + 5] = 0x03
    header[0x188 + 7] = 0x00 if with_romfs else FLAG_NO_ROMFS
    struct.pack_into('<IIII', header, 0x1A0, exefs_offset // MEDIA_UNIT, len(exefs) // MEDIA_UNIT, 1, 0)
    header[0x1C0:0x1E0] = hashlib.sha256(exefs[:0x200]).digest()
    if with_romfs:
        struct.pack_into('<IIII', header, 0x1B0, romfs_offset // MEDIA_UNIT, len(romfs) // MEDIA_UNIT, len(romfs) // MEDIA_UNIT, 0)
        header[0x1E0:0x200] = hashlib.sha256(romfs).digest()
    image = bytearray(total)
    image[0:0x200] = header
    image[0x200:0x200 + EXHEADER_SIZE] = exheader
    image[exefs_offset:exefs_offset + len(exefs)] = exefs
    image[romfs_offset:romfs_offset + len(romfs)] = romfs
    return bytes(image), bytes(exefs_header)


def make_save_image(files, block_size=0x200):
    """Une image SAVE fabriquée, un seul dossier (la racine) : files = {nom: octets}. Les fichiers de plus d'un bloc
    sont des nœuds de plusieurs blocs, le second coupé en deux nœuds pour suivre la chaîne."""
    dir_max, file_max = 4, 4
    blocks, fat = [], [(0, 0)]

    def store(payload, split=False):
        count = max(1, (len(payload) + block_size - 1) // block_size)
        first = len(blocks)
        for i in range(count):
            blocks.append(payload[i * block_size:(i + 1) * block_size].ljust(block_size, b'\x00'))
        nodes = [(first, first + count - 1)]
        if split and count >= 3:
            nodes = [(first, first), (first + 1, first + count - 1)]
        for n, (start, last) in enumerate(nodes):
            following = nodes[n + 1][0] + 1 if n + 1 < len(nodes) else 0
            previous = nodes[n - 1][0] + 1 if n else 0
            while len(fat) < last + 2:
                fat.append((0, 0))
            multi = 0x80000000 if last > start else 0
            fat[start + 1] = ((0x80000000 if n == 0 else 0) | previous, multi | following)
            if multi:
                fat[start + 2] = (0x80000000 | (start + 1), last + 1)
                fat[last + 1] = (0x80000000 | (start + 1), last + 1)
        return first

    directories = bytearray((dir_max + 2) * 0x28)
    file_table = bytearray((file_max + 1) * 0x30)
    file_records = []
    for index, (name, payload) in enumerate(files.items(), 1):
        first = store(payload, split=index == 2)
        file_records.append((index, name, first, len(payload)))
    for index, name, first, size in file_records:
        following = index + 1 if index < len(file_records) else 0
        struct.pack_into('<I16sIIIQ', file_table, index * 0x30, 1, name.encode(), following, 0, first, size)
    struct.pack_into('<I16sIII', directories, 0x28, 0, b'', 0, 0, 1 if file_records else 0)
    dir_first = store(bytes(directories))
    file_first = store(bytes(file_table))
    fat_offset = 0x100
    data_offset = (fat_offset + 8 * len(fat) + 0x1FF) // 0x200 * 0x200
    image = bytearray(data_offset + len(blocks) * block_size)
    image[0:4] = b'SAVE'
    struct.pack_into('<IQ', image, 4, 0x40000, 0x20)
    struct.pack_into('<IIQI4xQI4xQI4xQI4xQI4xQI4x', image, 0x20, 0, block_size, 0, 0, 0, 0, fat_offset, len(fat) - 1,
                     data_offset, len(blocks), dir_first | (2 << 32), dir_max, file_first | (2 << 32), file_max)
    for i, (u, v) in enumerate(fat):
        struct.pack_into('<II', image, fat_offset + 8 * i, u, v)
    assert fat_offset + 8 * len(fat) <= data_offset
    image[data_offset:] = b''.join(blocks)
    return bytes(image)


def test():
    import tempfile
    # FAT16 : chemins, noms longs, casse, fichiers fragmentés, lecture partielle.
    module, module_exefs_header = make_plain_ncch(0x0004013000001702, 'cfg')
    archive, archive_exefs_header = make_plain_ncch(0x0004009B00014002, 'police', with_romfs=True)
    files = {
        '/title/00040130/00001702/content/00000005.tmd': make_tmd(0x0004013000001702, 1024 * 9 + 16, [(5, 0, len(module))]),
        '/title/00040130/00001702/content/00000005.app': module,
        '/title/00040130/00001702/content/00000003.tmd': make_tmd(0x0004013000001702, 3, [(3, 0, 1)]),
        '/title/0004009b/00014002/content/0000000a.tmd': make_tmd(0x0004009B00014002, 7, [(10, 0, len(archive))]),
        '/title/0004009b/00014002/content/0000000a.app': archive,
        '/title/00040130/00002702/content/00000001.tmd': make_tmd(0x0004013000002702, 1, [(1, 0, 4)]),
        '/dbs/title.db': b'DB' * 300,
        '/Un nom bien plus long que huit.txt': b'long',
    }
    fat = FatVolume(io.BytesIO(make_fat16(files)))
    assert fat.bits == 16
    assert sorted(e.name for e in fat.listdir('/')) == ['Un nom bien plus long que huit.txt', 'dbs', 'title']
    assert fat.read('/UN NOM BIEN PLUS LONG QUE HUIT.TXT') == b'long'
    assert fat.read('/dbs/title.db') == b'DB' * 300 and fat.read('/dbs/title.db', 510, 4) == b'DBDB'
    assert fat.read('/title/00040130/00001702/content/00000005.app') == module
    try:
        fat.read('/title/absent')
        raise AssertionError('chemin absent accepté')
    except FileNotFoundError:
        pass
    # Les titres : le TMD le plus récent dont le contenu est là ; un titre sans contenu est écarté.
    titles = list_titles(fat)
    assert [(t.title_id, t.version) for t in titles] == [(0x0004009B00014002, 7), (0x0004013000001702, 9232)]
    assert titles[1].content_path.endswith('00000005.app') and titles[1].size == len(module)
    assert version_text(9232) == 'v9232 (9.1.0)'
    # Noms de sortie : la variante du mode sans échec prend -safe, un doublon hors catégorie son identifiant.
    named = [Title(0x0004013000001702, 0, '', 0, ''), Title(0x0004013020001703, 0, '', 0, ''),
             Title(0x0004001020009D00, 0, '', 0, ''), Title(0x0004003000009D02, 0, '', 0, '')]

    class Names:
        title_name = staticmethod(lambda t: {0x0004001020009D00: 'Menu', 0x0004003000009D02: 'menu'}.get(t.title_id, 'cfg'))

    assert sorted(output_names(Names, named).values()) == ['cfg', 'cfg-safe', 'menu', 'menu-20009d00']
    # SAVE : nœuds d'un bloc et de plusieurs, chaîne coupée, fichier vide.
    config = bytes(range(256)) * 0x80
    image = make_save_image({'config': config, 'second': b'S' * 0x700, 'vide': b''})
    found = read_save_fs(image)
    assert found == {'/config': config, '/second': b'S' * 0x700, '/vide': b''}, sorted(found)
    # write_new : rien hors de local/.
    try:
        write_new(os.path.join(tempfile.gettempdir(), 'x.cxi'), b'')
        raise AssertionError('écriture hors de local/ acceptée')
    except ValueError:
        pass
    # NCCH : chiffré ici avec des clés tirées au hasard (aucune vraie clé), puis déchiffré comme par GodMode9.
    try:
        aes_ctr(bytes(16), 0, bytes(16))
    except ImportError:
        print('nand : ni pycryptodomex (local/pylib) ni pycryptodome, le déchiffrement n\'est pas testé.')
        return
    main, extra = os.urandom(16), os.urandom(16)
    for plain, exefs_header, two_keys in ((module, module_exefs_header, False), (archive, archive_exefs_header, True)):
        source = bytearray(plain)
        if two_keys:
            source[0x18B] = 0x0A                            # seconde clé distincte : .code et RomFS la prennent
        else:
            source[0x18F] |= FLAG_FIXED_KEY                 # clé fixe : le bit doit disparaître au déchiffrement
        second = extra if two_keys else main
        reference = mark_decrypted(source[:0x200]) + bytes(source[0x200:])
        encrypted = bytearray(source)
        crypt_ncch(encrypted, main, second, exefs_header)
        assert encrypted[0x200:0x210] != source[0x200:0x210]
        regions = ncch_regions(source[:0x200])
        gap = regions['exheader'][0] + regions['exheader'][1]
        assert encrypted[gap:gap + 0x200] == source[gap:gap + 0x200]           # les trous restent tels quels
        result = decrypt_ncch(bytes(encrypted), lambda header: (main, second))
        assert result == reference, 'déchiffrement faux'
        assert result[0x18F] & FLAG_NO_CRYPTO and not result[0x18F] & FLAG_FIXED_KEY and result[0x18B] == 0
        assert check_ncch(result) == [] and exheader_name(result) in ('cfg', 'police')
        assert decrypt_ncch(result, None) == result                            # déjà en clair : rendu tel quel
        if two_keys:                                                           # la mauvaise seconde clé se voit
            wrong = decrypt_ncch(bytes(encrypted), lambda header: (main, main))
            assert check_ncch(wrong) == ['romfs']
        damaged = bytearray(result)
        damaged[0x210] ^= 1
        assert check_ncch(bytes(damaged)) == ['exheader']
    # Sans RomFS : le bit 0x02 est gardé, la région ignorée.
    no_romfs, no_romfs_header = make_plain_ncch(0x0004013000002702, 'ptm', with_romfs=False)
    encrypted = bytearray(no_romfs)
    crypt_ncch(encrypted, main, main, no_romfs_header)
    result = decrypt_ncch(bytes(encrypted), lambda header: (main, main))
    assert 'romfs' not in ncch_regions(result) and result[0x18F] == FLAG_NO_CRYPTO | FLAG_NO_ROMFS
    assert result[0x200:] == no_romfs[0x200:]
    print('nand : FAT16 fabriquée lue (noms longs, chaînes fragmentées), TMD et titres choisis, NCCH chiffré au hasard '
          'puis déchiffré comme GodMode9 (clé fixe, seconde clé, sans RomFS), image SAVE relue.')
    test_real()


def test_real():
    """Si la NAND et boot9 sont là : la CTRNAND s'ouvre, et cfg, ns, ro redonnent les octets de GodMode9."""
    if not (os.path.isfile(DEFAULT_NAND) and os.path.isfile(DEFAULT_BOOT9) and os.path.isdir(PYLIB)):
        print('nand : pas de NAND dans local/dump/, test sur les vrais fichiers sauté.')
        return
    console = Console()
    try:
        names = [n for n in ('cfg', 'ns', 'ro') if os.path.isfile(os.path.join(SYSTEM_DUMPS, n + '.cxi'))]
        assert console.fat.bits == 16 and console.titles()
        saved = sys.stdout
        sys.stdout = io.StringIO()
        try:
            same = cmd_verify(console, names, write=False)
        finally:
            sys.stdout = saved
        assert same == len(names), 'un module ne redonne pas les octets de GodMode9'
        files = disa_files(console.save_image(CFG_SAVE_ID), console.crypto)
        assert '/config' in files
    finally:
        console.close()
    print('nand : vraie NAND ouverte, %s identiques aux dumps de GodMode9, config de cfg relu.' % ', '.join(names))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    options = {'--nand': DEFAULT_NAND, '--boot9': DEFAULT_BOOT9, '--otp': None, '--cid': None}
    while args and args[0] in options:
        if len(args) < 2:
            sys.exit(__doc__)
        options[args[0]] = args[1]
        args = args[2:]
    if args[:1] == ['test']:
        test()
        return
    command = args[0] if args else 'summary'
    if command not in ('summary', 'titles', 'ls', 'title', 'file', 'config', 'all', 'verify', 'sd'):
        print(__doc__)
        return
    console = Console(options['--nand'], options['--boot9'], options['--otp'], options['--cid'])
    try:
        if command == 'summary':
            show_summary(console)
        elif command == 'titles':
            show_titles(console, args[1] if len(args) > 1 else None)
        elif command == 'ls':
            for entry in console.fat.listdir(args[1] if len(args) > 1 else '/'):
                print('%-40s %s' % (entry.name + ('/' if entry.is_dir else ''), '' if entry.is_dir else entry.size))
        elif command == 'title' and len(args) > 1:
            cmd_title(console, args[1:])
        elif command == 'file' and len(args) in (2, 3):
            cmd_file(console, args[1], args[2] if len(args) == 3 else None)
        elif command == 'config':
            cmd_config(console)
        elif command == 'all':
            cmd_all(console)
        elif command == 'verify':
            cmd_verify(console, args[1:])
        elif command == 'sd' and len(args) == 3:
            cmd_sd(console, args[1], args[2])
        else:
            print(__doc__)
    except (FileNotFoundError, NotADirectoryError, IsADirectoryError) as error:
        sys.exit('Introuvable dans la CTRNAND, ou pas du bon type : %s (sous Git Bash, mettre MSYS_NO_PATHCONV=1 '
                 'pour qu\'un chemin « / » ne soit pas réécrit)' % error)
    except ValueError as error:
        sys.exit('Arrêt : %s' % error)
    finally:
        console.close()


if __name__ == '__main__':
    main()
