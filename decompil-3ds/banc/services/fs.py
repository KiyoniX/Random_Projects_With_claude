"""`fs:USER`, un fichier ouvert, un dossier ouvert (contrat des fichiers).

Réel :
- l'archive 0x00000003 : le chemin {0,0,0} rend le romfs du jeu de base, {5,0,0} celui de la mise à jour (niveau 3
  de l'IVFC, lu dans les .cxi déchiffrés), {2,"icon",0} le fichier icon de l'exefs ;
- l'archive 0x00000004 (la sauvegarde) : un dossier du PC, copie de la sauvegarde de la console faite au lancement
  du banc dans local/analyse/banc/archives/ (l'original n'est jamais touché) ;
- les données supplémentaires (6, 7, 0x12345678) et la carte SD (9, 0x567890AC) : un dossier du PC chacune, vide au
  départ (le format des données supplémentaires de la carte SD n'est pas relu par le banc) ;
- toutes les commandes d'un fichier et d'un dossier.
Les codes d'erreur « introuvable » et « existe déjà » ne sont pas dans les fiches : ce sont ceux qu'utilisent les
émulateurs (0xC8804470, 0xC8804471, 0xC82044BE, 0xC8A04478), signalés comme tels dans le journal.
"""
import bisect
import json
import os
import shutil
import struct

from ipc import Reply, Service, error

ERR_FILE_NOT_FOUND = 0xC8804470
ERR_PATH_NOT_FOUND = 0xC8804471
ERR_ALREADY_EXISTS = 0xC82044BE
ERR_ARCHIVE_NOT_FOUND = 0xC8A04478
ERR_INVALID_PATH = 0xE0E046BE
ERR_INVALID_HANDLE = 0xC8804465
ERR_UNSUPPORTED = 0xE0C046F8
ERR_OUT_OF_FILE = 0xE0E046C1

ARCHIVE_NAMES = {3: 'le programme (romfs, exefs)', 4: 'la sauvegarde', 6: 'données supplémentaires',
                 7: 'données supplémentaires partagées', 9: 'carte SD', 0x12345678: 'données supplémentaires (boss)',
                 0x567890AC: 'carte SD (écriture seule)', 0x2345678A: 'contenu d\'un autre titre'}


def decode_path(kind, data):
    """Un chemin de fs -> texte lisible et forme utile : (genre, valeur)."""
    if kind == 1:
        return 'vide', ''
    if kind == 2:
        return 'binaire', data
    if kind == 3:
        return 'texte', data.split(b'\0')[0].decode('latin-1')
    if kind == 4:
        text = data.decode('utf-16-le', 'replace')
        return 'texte', text.split('\0')[0]
    return 'genre %d' % kind, data


# --- les fichiers ---

class RomFile:
    def __init__(self, romfs, label):
        self.romfs = romfs
        self.label = label
        self.size = romfs.size
        self._index = None

    def read(self, position, size):
        return self.romfs.read(position, size)

    def write(self, position, data):
        return None

    def set_size(self, size):
        return ERR_UNSUPPORTED

    def what(self, position):
        """Le fichier du romfs où tombe une position (pour le journal)."""
        if self._index is None:
            try:
                entries = sorted(self.romfs.files(), key=lambda e: e[1])
            except Exception:
                entries = []
            self._index = ([e[1] for e in entries], entries)
        starts, entries = self._index
        i = bisect.bisect_right(starts, position) - 1
        if i >= 0:
            name, start, size = entries[i]
            if position < start + size:
                return '%s+%#x' % (name, position - start)
        return 'tables' if position < (starts[0] if starts else 1 << 62) else '?'


class BytesFile:
    def __init__(self, data, label):
        self.data = bytearray(data)
        self.label = label

    @property
    def size(self):
        return len(self.data)

    def read(self, position, size):
        return bytes(self.data[position:position + size])

    def write(self, position, data):
        return None

    def set_size(self, size):
        return ERR_UNSUPPORTED

    def what(self, position):
        return ''


class HostFile:
    def __init__(self, path, label):
        self.path = path
        self.label = label
        self.file = open(path, 'r+b')

    @property
    def size(self):
        return os.path.getsize(self.path)

    def read(self, position, size):
        self.file.seek(position)
        return self.file.read(size)

    def write(self, position, data):
        self.file.seek(position)
        self.file.write(data)
        self.file.flush()
        return len(data)

    def set_size(self, size):
        self.file.truncate(size)
        return 0

    def what(self, position):
        return ''

    def close(self):
        self.file.close()


class FileSession(Service):
    name = 'FSFile'
    carte = 'FSFile'
    commands = {0x0801: 'open_sub_file', 0x0802: 'read', 0x0803: 'write', 0x0804: 'get_size', 0x0805: 'set_size',
                0x0808: 'close', 0x0809: 'flush', 0x080A: 'set_priority', 0x080B: 'get_priority',
                0x080C: 'open_link_file', 0x0C01: 'get_available'}

    def __init__(self, bench, file, mode, start=0, window=None, priority=0):
        super().__init__(bench)
        self.file = file
        self.mode = mode
        self.start = start
        self.window = window
        self.priority = priority
        self.closed = False

    def length(self):
        return self.window if self.window is not None else self.file.size

    def read(self, req):
        position = req.u64(1)
        address, size = req.buffer(4)
        size = min(size, max(0, self.length() - position)) if self.window is not None else size
        data = self.file.read(self.start + position, size) if size else b''
        if data:
            self.memory.write(address, data)
        self.bench.stats['fs_read_bytes'] += len(data)
        self.bench.on_file_read(self, position, len(data))
        what = self.file.what(self.start + position)
        served = getattr(getattr(self.file, 'romfs', None), 'describe', None)
        if served and data:                  # lecture dans un fichier de mod : ce qui a été servi, pour le journal
            note = served(self.start + position, data)
            what += (' ; ' if what and note else '') + note
        return Reply(0, [len(data)]).raw(req.word(4), req.word(5)).with_note(
            '%s, position %#x, %#x octets lus%s' % (self.file.label, position, len(data),
                                                    ' (%s)' % what if what else ''))

    def write(self, req):
        position = req.u64(1)
        address, size = req.buffer(5)
        data = self.memory.read(address, size) if size else b''
        written = self.file.write(self.start + position, data)
        if written is None:
            return Reply(ERR_UNSUPPORTED, [0]).raw(req.word(5), req.word(6)).with_note('fichier en lecture seule')
        return Reply(0, [written]).raw(req.word(5), req.word(6)).with_note(
            '%s, position %#x, %#x octets écrits' % (self.file.label, position, written))

    def get_size(self, req):
        size = self.length()
        return Reply(0, [size & 0xFFFFFFFF, size >> 32]).with_note('%s : %#x octets' % (self.file.label, size))

    def set_size(self, req):
        if self.window is not None:
            return Reply(ERR_UNSUPPORTED)
        return Reply(self.file.set_size(req.u64(1)))

    def close(self, req):
        self.closed = True
        return Reply(0).with_note(self.file.label)

    def flush(self, req):
        return Reply(0)

    def set_priority(self, req):
        self.priority = req.word(1)
        return Reply(0)

    def get_priority(self, req):
        return Reply(0, [self.priority])

    def open_link_file(self, req):
        twin = FileSession(self.bench, self.file, self.mode, self.start, self.window, self.priority)
        return Reply(0).move_handles(twin.session('FSFile')).with_note(self.file.label)

    def open_sub_file(self, req):
        start, size = req.u64(1), req.u64(3)
        if self.window is not None:
            return Reply(ERR_UNSUPPORTED)
        if start + size > self.file.size:
            return Reply(ERR_OUT_OF_FILE)
        sub = FileSession(self.bench, self.file, self.mode, start, size, self.priority)
        return Reply(0).move_handles(sub.session('FSFile'))

    def get_available(self, req):
        position, size = req.u64(1), req.u64(3)
        available = max(0, min(size, self.length() - position))
        return Reply(0, [available & 0xFFFFFFFF, available >> 32])


class DirSession(Service):
    name = 'FSDir'
    carte = 'FSDir'
    commands = {0x0801: 'read', 0x0802: 'close', 0x0803: 'set_priority', 0x0804: 'get_priority'}

    def __init__(self, bench, path, label):
        super().__init__(bench)
        self.label = label
        self.entries = sorted(os.listdir(path)) if os.path.isdir(path) else []
        self.path = path
        self.cursor = 0
        self.priority = 0

    def read(self, req):
        address, size = req.buffer(2)
        count = size // 0x228
        out = bytearray()
        n = 0
        while n < count and self.cursor < len(self.entries):
            name = self.entries[self.cursor]
            self.cursor += 1
            full = os.path.join(self.path, name)
            entry = bytearray(0x228)
            encoded = name.encode('utf-16-le')[:0x20A]
            entry[0:len(encoded)] = encoded
            stem, _, ext = name.upper().partition('.')
            entry[0x20C:0x20C + min(8, len(stem))] = stem[:8].encode('latin-1', 'replace')
            entry[0x216:0x216 + min(3, len(ext))] = ext[:3].encode('latin-1', 'replace')
            entry[0x21A] = 1
            entry[0x21C] = 1 if os.path.isdir(full) else 0
            entry[0x21E] = 0 if os.path.isdir(full) else 1
            if os.path.isfile(full):
                struct.pack_into('<Q', entry, 0x220, os.path.getsize(full))
            out += entry
            n += 1
        if out:
            self.memory.write(address, bytes(out))
        return Reply(0, [n]).raw(req.word(2), req.word(3)).with_note('%s : %d entrées' % (self.label, n))

    def close(self, req):
        return Reply(0)

    def set_priority(self, req):
        self.priority = req.word(1)
        return Reply(0)

    def get_priority(self, req):
        return Reply(0, [self.priority])


# --- les archives ---

class Archive:
    def __init__(self, archive_id, root, label, readonly=False):
        self.archive_id = archive_id
        self.root = root
        self.label = label
        self.readonly = readonly
        self.priority = 0

    def host(self, text):
        parts = [p for p in text.replace('\\', '/').split('/') if p not in ('', '.')]
        if any(p == '..' for p in parts):
            return None
        return os.path.join(self.root, *parts)


class FsUser(Service):
    name = 'fs:USER'
    carte = 'fs:USER'
    commands = {0x0802: 'open_file', 0x0803: 'open_file_directly', 0x0804: 'delete_file', 0x0805: 'rename',
                0x0806: 'delete_directory', 0x0807: 'delete_directory_recursively', 0x0808: 'create_file',
                0x0809: 'create_directory', 0x080A: 'rename', 0x080B: 'open_directory', 0x080C: 'open_archive',
                0x080D: 'control_archive', 0x080E: 'close_archive', 0x0812: 'get_free_bytes',
                0x0817: 'is_sdmc_detected', 0x0818: 'is_sdmc_writable', 0x0845: 'get_format_info',
                0x0849: 'get_archive_resource', 0x084C: 'format_save_data', 0x0851: 'create_ext_save_data',
                0x0852: 'delete_ext_save_data', 0x0854: 'get_ext_data_block_size', 0x085A: 'set_archive_priority',
                0x085B: 'get_archive_priority', 0x0861: 'initialize', 0x0862: 'set_priority', 0x0863: 'get_priority',
                0x086E: 'set_secure_value', 0x086F: 'get_secure_value'}

    def __init__(self, bench):
        super().__init__(bench)
        self.priority = 0
        self.initialized = False
        self.archives = {}
        self.next_archive = 0x100000001
        self.roots = bench.paths['archives']
        self.romfs = {0: bench.romfs_base, 5: bench.romfs_update}
        if bench.paths.get('overlay'):       # un mod construit pour le PC (mods/build.py --pc), voir banc/romfs.py
            from romfs import overlay_romfs
            self.romfs[0], self.romfs[5], bench.overlays = overlay_romfs(bench.romfs_base, bench.romfs_update,
                                                                         bench.paths['overlay'])
        self.secure_values = {}

    # chemins
    def path_of(self, req, kind_word, pos):
        return decode_path(req.word(kind_word), req.static_data(pos))

    def make_archive(self, archive_id, path_kind, path):
        if archive_id == 3:
            return Archive(3, None, 'programme', True)
        if archive_id == 4:
            return Archive(4, os.path.join(self.roots, 'sauvegarde'), 'sauvegarde')
        if archive_id in (6, 7, 0x12345678):
            ident = path.hex() if isinstance(path, bytes) else str(path)
            root = os.path.join(self.roots, 'extdata-%x-%s' % (archive_id, ident))
            if not os.path.isdir(root):
                return None
            return Archive(archive_id, root, 'données supplémentaires %s' % ident)
        if archive_id in (9, 0x567890AC):
            root = os.path.join(self.roots, 'sdmc')
            os.makedirs(root, exist_ok=True)
            return Archive(archive_id, root, 'carte SD')
        return None

    def archive(self, req, pos):
        return self.archives.get(req.u64(pos))

    def open_in_program(self, path, mode):
        """L'archive 0x00000003 : romfs ou exefs selon le premier mot du chemin binaire (contrat, partie 2)."""
        if not isinstance(path, bytes) or len(path) != 12:
            return None, ERR_INVALID_PATH, 'chemin de %r : il faut 12 octets binaires' % (path,)
        kind = struct.unpack_from('<I', path)[0]
        if kind in (0, 5):
            romfs = self.romfs.get(kind)
            if romfs is None:
                return None, ERR_FILE_NOT_FOUND, 'romfs %d absent du banc' % kind
            return RomFile(romfs, 'romfs %s' % ('du jeu de base' if kind == 0 else 'de la mise à jour')), 0, ''
        if kind == 2:
            name = path[4:12].split(b'\0')[0].decode('latin-1')
            host = os.path.join(self.bench.paths['exefs'], name + '.bin')
            if not os.path.isfile(host):
                return None, ERR_FILE_NOT_FOUND, 'exefs/%s absent' % name
            return BytesFile(open(host, 'rb').read(), 'exefs/%s' % name), 0, ''
        return None, ERR_INVALID_PATH, 'premier mot %d refusé' % kind

    def open_host(self, archive, text, mode, label):
        host = archive.host(text) if isinstance(text, str) else None
        if host is None:
            return None, ERR_INVALID_PATH, 'chemin %r illisible' % (text,)
        if not os.path.isfile(host):
            if mode & 4:      # création demandée
                os.makedirs(os.path.dirname(host), exist_ok=True)
                open(host, 'wb').close()
            else:
                return None, ERR_FILE_NOT_FOUND, '%s%s introuvable (code des émulateurs)' % (archive.label, text)
        return HostFile(host, '%s:%s' % (archive.label, text)), 0, ''

    def open_any(self, archive, path_kind, path, mode):
        if archive.archive_id == 3:
            return self.open_in_program(path, mode)
        return self.open_host(archive, path, mode, archive.label)

    # commandes de la session
    def initialize(self, req):
        self.initialized = True
        return Reply(0).with_note('version %#x' % req.word(1))

    def set_priority(self, req):
        self.priority = req.word(1)
        return Reply(0)

    def get_priority(self, req):
        return Reply(0, [self.priority])

    def open_file_directly(self, req):
        archive_id, mode = req.word(2), req.word(7)
        a_kind, a_path = self.path_of(req, 3, 9)
        f_kind, f_path = self.path_of(req, 5, 11)
        archive = self.make_archive(archive_id, a_kind, a_path)
        if archive is None:
            detail = ''
            if archive_id == 0x2345678A and isinstance(a_path, bytes) and len(a_path) >= 8:
                detail = ' : titre %016x, chemin de fichier %s' % (struct.unpack_from('<Q', a_path)[0],
                                                                    f_path.hex() if isinstance(f_path, bytes) else f_path)
            return Reply(ERR_ARCHIVE_NOT_FOUND, [0x10, 0]).with_note('archive %#x (%s) absente du banc%s' % (
                archive_id, ARCHIVE_NAMES.get(archive_id, '?'), detail))
        file, code, why = self.open_any(archive, f_kind, f_path, mode)
        if file is None:
            return Reply(code, [0x10, 0]).with_note(why)
        session = FileSession(self.bench, file, mode, priority=self.priority).session('FSFile')
        self.bench.on_file_open(archive_id, f_path, file)
        return Reply(0).move_handles(session).with_note('%s : %s' % (ARCHIVE_NAMES.get(archive_id, '?'), file.label))

    def open_archive(self, req):
        archive_id = req.word(1)
        kind, path = self.path_of(req, 2, 4)
        archive = self.make_archive(archive_id, kind, path)
        if archive is None:
            return Reply(ERR_ARCHIVE_NOT_FOUND, [0, 0]).with_note('archive %#x (%s) absente du banc' % (
                archive_id, ARCHIVE_NAMES.get(archive_id, '?')))
        handle = self.next_archive
        self.next_archive += 1
        self.archives[handle] = archive
        return Reply(0, [handle & 0xFFFFFFFF, handle >> 32]).with_note('%s' % archive.label)

    def close_archive(self, req):
        if self.archives.pop(req.u64(1), None) is None:
            return Reply(ERR_INVALID_HANDLE)
        return Reply(0)

    def open_file(self, req):
        archive = self.archive(req, 2)
        if archive is None:
            return Reply(ERR_INVALID_HANDLE, [0x10, 0])
        kind, path = self.path_of(req, 4, 8)
        mode = req.word(6)
        file, code, why = self.open_any(archive, kind, path, mode)
        if file is None:
            return Reply(code, [0x10, 0]).with_note(why)
        session = FileSession(self.bench, file, mode, priority=archive.priority).session('FSFile')
        self.bench.on_file_open(archive.archive_id, path, file)
        return Reply(0).move_handles(session).with_note('%s, mode %d' % (file.label, mode))

    def open_directory(self, req):
        archive = self.archive(req, 1)
        if archive is None or archive.root is None:
            return Reply(ERR_INVALID_HANDLE, [0x10, 0])
        kind, path = self.path_of(req, 3, 5)
        host = archive.host(path) if isinstance(path, str) else None
        if host is None or not os.path.isdir(host):
            return Reply(ERR_PATH_NOT_FOUND, [0x10, 0]).with_note('dossier %r introuvable' % (path,))
        session = DirSession(self.bench, host, '%s:%s' % (archive.label, path)).session('FSDir')
        return Reply(0).move_handles(session).with_note('%s:%s' % (archive.label, path))

    def _host_path(self, req, handle_pos, kind_pos, static_pos):
        archive = self.archive(req, handle_pos)
        if archive is None or archive.root is None:
            return None, None, Reply(ERR_INVALID_HANDLE)
        kind, path = self.path_of(req, kind_pos, static_pos)
        host = archive.host(path) if isinstance(path, str) else None
        if host is None:
            return None, None, Reply(ERR_INVALID_PATH).with_note('chemin %r' % (path,))
        return archive, host, None

    def delete_file(self, req):
        archive, host, fail = self._host_path(req, 2, 4, 6)
        if fail:
            return fail
        if not os.path.isfile(host):
            return Reply(ERR_FILE_NOT_FOUND).with_note('%s absent' % host)
        os.remove(host)
        return Reply(0).with_note(os.path.relpath(host, archive.root))

    def delete_directory(self, req):
        archive, host, fail = self._host_path(req, 2, 4, 6)
        if fail:
            return fail
        if not os.path.isdir(host):
            return Reply(ERR_PATH_NOT_FOUND)
        os.rmdir(host)
        return Reply(0)

    def delete_directory_recursively(self, req):
        archive, host, fail = self._host_path(req, 2, 4, 6)
        if fail:
            return fail
        if not os.path.isdir(host):
            return Reply(ERR_PATH_NOT_FOUND)
        shutil.rmtree(host)
        return Reply(0)

    def create_file(self, req):
        archive, host, fail = self._host_path(req, 2, 4, 9)
        if fail:
            return fail
        size = req.u64(7)
        if os.path.exists(host):
            return Reply(ERR_ALREADY_EXISTS).with_note('%s existe déjà (code des émulateurs)'
                                                       % os.path.relpath(host, archive.root))
        os.makedirs(os.path.dirname(host), exist_ok=True)
        with open(host, 'wb') as out:
            out.truncate(size)
        return Reply(0).with_note('%s, %#x octets' % (os.path.relpath(host, archive.root), size))

    def create_directory(self, req):
        archive, host, fail = self._host_path(req, 2, 4, 7)
        if fail:
            return fail
        if os.path.exists(host):
            return Reply(ERR_ALREADY_EXISTS)
        os.makedirs(host)
        return Reply(0)

    def rename(self, req):
        archive, source, fail = self._host_path(req, 2, 4, 10)
        if fail:
            return fail
        _, target, fail = self._host_path(req, 6, 8, 12)
        if fail:
            return fail
        if not os.path.exists(source):
            return Reply(ERR_FILE_NOT_FOUND)
        os.replace(source, target)
        return Reply(0)

    def control_archive(self, req):
        return Reply(0, [req.word(6), req.word(7), req.word(8), req.word(9)]).with_note('action %d' % req.word(3))

    def get_free_bytes(self, req):
        free = 0x10000000
        return Reply(0, [free & 0xFFFFFFFF, free >> 32])

    def is_sdmc_detected(self, req):
        return Reply(0, [1])

    def is_sdmc_writable(self, req):
        return Reply(0, [1])

    def format_info_path(self):
        return os.path.join(self.roots, 'sauvegarde.format.json')

    def get_format_info(self, req):
        archive_id = req.word(1)
        if archive_id == 4:
            info = {'size': 0x80000, 'dirs': 1, 'files': 1, 'duplicate': 1}
            if os.path.isfile(self.format_info_path()):
                info = json.load(open(self.format_info_path()))
            return Reply(0, [info['size'], info['dirs'], info['files'], info['duplicate']]).with_note(
                'sauvegarde : %s' % info)
        if archive_id in (6, 7):
            root = self.ext_root(req, archive_id, path_word=4)
            info_path = root + '.format.json'
            if os.path.isdir(root):
                info = json.load(open(info_path)) if os.path.isfile(info_path) else {'size': 0, 'dirs': 0, 'files': 0,
                                                                                      'duplicate': 0}
                return Reply(0, [info['size'], info['dirs'], info['files'], info['duplicate']]).with_note(
                    'données supplémentaires : %s' % info)
        return Reply(ERR_ARCHIVE_NOT_FOUND, [0, 0, 0, 0]).with_note('archive %#x absente' % archive_id)

    def get_archive_resource(self, req):
        return Reply(0, [0x200, 0x8000, 0x80000, 0x40000]).with_note('support %d : 16 Go, 8 Go libres' % req.word(1))

    def format_save_data(self, req):
        root = os.path.join(self.roots, 'sauvegarde')
        shutil.rmtree(root, ignore_errors=True)
        os.makedirs(root)
        info = {'size': 0x80000, 'dirs': req.word(5), 'files': req.word(6), 'duplicate': req.word(9) & 0xFF}
        json.dump(info, open(self.format_info_path(), 'w'))
        self.bench.note('le jeu a formaté sa sauvegarde (FormatSaveData) : la copie du banc est vidée')
        return Reply(0).with_note('%d dossiers, %d fichiers' % (req.word(5), req.word(6)))

    def ext_root(self, req, archive_id=6, path_word=None):
        if path_word is None:
            info = req.memory.read(req.cmdbuf + 4, 12)
        else:
            info = req.static_data(path_word)
        return os.path.join(self.roots, 'extdata-%x-%s' % (archive_id, info.hex()))

    def create_ext_save_data(self, req):
        os.makedirs(self.ext_root(req), exist_ok=True)
        json.dump({'size': 0, 'dirs': req.word(5), 'files': req.word(6), 'duplicate': 0},
                  open(self.ext_root(req) + '.format.json', 'w'))
        return Reply(0).raw(req.word(10), req.word(11)).with_note('dossier %s' % os.path.basename(self.ext_root(req)))

    def delete_ext_save_data(self, req):
        shutil.rmtree(self.ext_root(req), ignore_errors=True)
        return Reply(0)

    def get_ext_data_block_size(self, req):
        return Reply(0, [0x4000, 0, 0x2000, 0, 0x1000])

    def set_archive_priority(self, req):
        archive = self.archive(req, 1)
        if archive is None:
            return Reply(ERR_INVALID_HANDLE)
        archive.priority = req.word(3)
        return Reply(0)

    def get_archive_priority(self, req):
        archive = self.archive(req, 1)
        if archive is None:
            return Reply(ERR_INVALID_HANDLE, [0])
        return Reply(0, [archive.priority])

    def set_secure_value(self, req):
        self.secure_values[req.word(1)] = req.u64(2)
        return Reply(0)

    def get_secure_value(self, req):
        value = self.secure_values.get(req.word(1))
        if value is None:
            return Reply(0, [0, 0, 0, 0]).with_note('pas de valeur (première fois)')
        return Reply(0, [1, 0, value & 0xFFFFFFFF, value >> 32])


def prepare_archives(bench, save_source, extdata_source):
    """Copie la sauvegarde de la console dans le dossier de travail du banc (jamais l'original)."""
    root = bench.paths['archives']
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    save = os.path.join(root, 'sauvegarde')
    if save_source and os.path.isdir(save_source):
        shutil.copytree(save_source, save)
        return 'sauvegarde copiée de %s' % save_source
    os.makedirs(save)
    return 'pas de sauvegarde : dossier vide'
