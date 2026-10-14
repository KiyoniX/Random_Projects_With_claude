"""Le romfs d'un NCCH déchiffré, vu comme le jeu le voit : le dernier niveau de l'IVFC, un seul fichier.

Contrat des fichiers, partie 2 : `fs` rend au jeu, pour l'archive 0x00000003 et le chemin {0,0,0} ou {5,0,0}, un
fichier dont le contenu est le niveau 3 du romfs (il commence par le mot 0x28). Ici on le lit directement dans le
`.cxi` déchiffré de local/dump/, sans empreintes ni chiffrement.
"""
import struct

MEDIA_UNIT = 0x200


class RomfsError(ValueError):
    pass


class NcchRomfs:
    def __init__(self, path):
        self.path = path
        self.file = open(path, 'rb')
        header = self.file.read(0x200)
        if header[0x100:0x104] != b'NCCH':
            raise RomfsError('%s : pas un NCCH' % path)
        flags = header[0x188:0x190]
        if not flags[7] & 4:
            raise RomfsError('%s : NCCH chiffré (le banc lit les dumps déchiffrés)' % path)
        offset, size = struct.unpack_from('<II', header, 0x1B0)
        self.romfs_offset = offset * MEDIA_UNIT
        self.file.seek(self.romfs_offset)
        ivfc = self.file.read(0x60)
        if ivfc[:4] != b'IVFC':
            raise RomfsError('%s : pas d\'en-tête IVFC au début du romfs' % path)
        master = struct.unpack_from('<I', ivfc, 8)[0]
        _, level3_size, level3_block = struct.unpack_from('<QQI', ivfc, 0x3C)
        block = 1 << level3_block
        self.level3_offset = self.romfs_offset + ((0x60 + master + block - 1) & ~(block - 1))
        self.size = level3_size
        self.file.seek(self.level3_offset)
        if struct.unpack('<I', self.file.read(4))[0] != 0x28:
            raise RomfsError('%s : le niveau 3 ne commence pas par 0x28' % path)

    def read(self, position, size):
        if position >= self.size:
            return b''
        size = min(size, self.size - position)
        self.file.seek(self.level3_offset + position)
        return self.file.read(size)

    def files(self):
        """[(chemin, position des données dans le niveau 3, taille)] : pour savoir quel fichier une lecture vise."""
        header = self.read(0, 0x28)
        (_, dir_hash_off, dir_hash_size, dir_off, dir_size, file_hash_off, file_hash_size, file_off, file_size,
         data_off) = struct.unpack('<10I', header)
        dirs = self.read(dir_off, dir_size)
        files = self.read(file_off, file_size)
        out = []

        def dir_name(offset):
            parent, _, _, _, _, length = struct.unpack_from('<6I', dirs, offset)
            name = dirs[offset + 0x18:offset + 0x18 + length].decode('utf-16-le')
            return parent, name

        def full_dir(offset):
            parts = []
            while offset != 0:
                parent, name = dir_name(offset)
                parts.append(name)
                offset = parent
            return '/'.join(reversed(parts))

        position = 0
        while position + 0x20 <= len(files):
            parent, sibling, data, size, _, length = struct.unpack_from('<IIQQII', files, position)
            name = files[position + 0x20:position + 0x20 + length].decode('utf-16-le', 'replace')
            folder = full_dir(parent)
            out.append(((folder + '/' if folder else '') + name, data_off + data, size))
            position += 0x20 + ((length + 3) & ~3)
        return out
