"""Le niveau 3 d'un romfs (l'arbre de dossiers et de fichiers que le jeu lit), lu et refabriqué.

Disposition (3dbrew, recoupée avec les 653 fichiers du romfs de Pokémon X ; voir tests.py) :

    en-tête 0x28 : longueur 0x28, puis (décalage, taille) de la table de hachage des dossiers, de la table des
                   dossiers, de la table de hachage des fichiers, de la table des fichiers, puis le début des données
    dossier : parent, frère suivant, premier sous-dossier, premier fichier, suivant du même casier, longueur du nom
              (en octets), nom en UTF-16, complété à 4 octets
    fichier : parent, frère suivant, décalage des données (u64), taille (u64), suivant du même casier, longueur du
              nom, nom
    hachage : h = parent ^ 123456789, puis pour chaque caractère h = ror32(h, 5) ^ caractère ; casier = h % taille
              de la table ; les entrées d'un même casier sont chaînées

`parse` lit un arbre et garde l'ordre des tables ; `Tree.build` refabrique tous les octets des tables avec les
tailles et les positions qu'on lui donne. Sur l'arbre non modifié, le résultat est identique octet pour octet à
l'original. Une entrée ajoutée vient à la fin de la table et de la liste de son dossier.
"""
import struct

NONE = 0xFFFFFFFF
DATA_ALIGN = 0x10


class Dir:
    def __init__(self, name, parent):
        self.name = name
        self.parent = parent          # indice dans Tree.dirs, None pour la racine
        self.dirs = []                # indices, dans l'ordre de la chaîne des frères
        self.files = []


class File:
    def __init__(self, name, parent, size, source=None):
        self.name = name
        self.parent = parent
        self.size = size
        self.source = source          # à la discrétion de l'appelant (position d'origine, chemin d'un fichier…)


class Tree:
    def __init__(self):
        self.dirs = [Dir('', None)]
        self.files = []

    def path_of_file(self, index):
        f = self.files[index]
        parts = [f.name]
        d = f.parent
        while d:
            parts.append(self.dirs[d].name)
            d = self.dirs[d].parent
        return '/'.join(reversed(parts))

    def find_dir(self, path, create=False):
        """L'indice du dossier « a/0/7 » ; None s'il n'existe pas (ou le crée si create)."""
        d = 0
        for part in [p for p in path.split('/') if p]:
            for child in self.dirs[d].dirs:
                if self.dirs[child].name == part:
                    d = child
                    break
            else:
                if not create:
                    return None
                self.dirs.append(Dir(part, d))
                self.dirs[d].dirs.append(len(self.dirs) - 1)
                d = len(self.dirs) - 1
        return d

    def find_file(self, path):
        folder, _, name = path.rpartition('/')
        d = self.find_dir(folder)
        if d is None:
            return None
        for i in self.dirs[d].files:
            if self.files[i].name == name:
                return i
        return None

    def add_file(self, path, size, source=None):
        folder, _, name = path.rpartition('/')
        d = self.find_dir(folder, create=True)
        self.files.append(File(name, d, size, source))
        self.dirs[d].files.append(len(self.files) - 1)
        return len(self.files) - 1

    def all_paths(self):
        return [self.path_of_file(i) for i in range(len(self.files))]

    def build(self):
        """-> (octets des tables avec en-tête, liste des (indice du fichier, position des données dans le niveau 3)).

        Les données commencent juste après les tables (alignées sur 0x10), dans l'ordre de la table des fichiers,
        chacune alignée sur 0x10. Les tailles viennent de File.size.
        """
        dir_offsets, off = [], 0
        for d in self.dirs:
            dir_offsets.append(off)
            off += 0x18 + ((len(d.name) * 2 + 3) & ~3)
        dir_meta_size = off
        file_offsets, off = [], 0
        for f in self.files:
            file_offsets.append(off)
            off += 0x20 + ((len(f.name) * 2 + 3) & ~3)
        file_meta_size = off

        dir_hash_n = hash_table_size(len(self.dirs))
        file_hash_n = hash_table_size(len(self.files))
        dir_hash = [NONE] * dir_hash_n
        file_hash = [NONE] * file_hash_n
        dir_next = [NONE] * len(self.dirs)
        file_next = [NONE] * len(self.files)
        # casier : la dernière entrée insérée est en tête, comme makerom (vérifié par le test d'identité)
        for i, d in enumerate(self.dirs):
            parent = dir_offsets[d.parent] if d.parent is not None else 0
            bucket = name_hash(parent, d.name) % dir_hash_n
            dir_next[i] = dir_hash[bucket]
            dir_hash[bucket] = dir_offsets[i]
        for i, f in enumerate(self.files):
            bucket = name_hash(dir_offsets[f.parent], f.name) % file_hash_n
            file_next[i] = file_hash[bucket]
            file_hash[bucket] = file_offsets[i]

        positions, pos = [], 0
        tables_size = 0x28 + dir_hash_n * 4 + dir_meta_size + file_hash_n * 4 + file_meta_size
        data_start = (tables_size + DATA_ALIGN - 1) & ~(DATA_ALIGN - 1)
        for i, f in enumerate(self.files):
            pos = (pos + DATA_ALIGN - 1) & ~(DATA_ALIGN - 1)
            positions.append(pos)
            pos += f.size

        dir_hash_off = 0x28
        dir_meta_off = dir_hash_off + dir_hash_n * 4
        file_hash_off = dir_meta_off + dir_meta_size
        file_meta_off = file_hash_off + file_hash_n * 4
        out = bytearray(struct.pack('<10I', 0x28, dir_hash_off, dir_hash_n * 4, dir_meta_off, dir_meta_size,
                                    file_hash_off, file_hash_n * 4, file_meta_off, file_meta_size, data_start))
        out += struct.pack('<%dI' % dir_hash_n, *dir_hash)
        for i, d in enumerate(self.dirs):
            parent = dir_offsets[d.parent] if d.parent is not None else 0
            sibling = NONE
            if d.parent is not None:
                chain = self.dirs[d.parent].dirs
                k = chain.index(i)
                sibling = dir_offsets[chain[k + 1]] if k + 1 < len(chain) else NONE
            child_dir = dir_offsets[d.dirs[0]] if d.dirs else NONE
            child_file = file_offsets[d.files[0]] if d.files else NONE
            name = d.name.encode('utf-16-le')
            out += struct.pack('<6I', parent, sibling, child_dir, child_file, dir_next[i], len(name))
            out += name + b'\0' * (-len(name) % 4)
        out += struct.pack('<%dI' % file_hash_n, *file_hash)
        for i, f in enumerate(self.files):
            chain = self.dirs[f.parent].files
            k = chain.index(i)
            sibling = file_offsets[chain[k + 1]] if k + 1 < len(chain) else NONE
            name = f.name.encode('utf-16-le')
            out += struct.pack('<IIQQII', dir_offsets[f.parent], sibling, positions[i], f.size, file_next[i], len(name))
            out += name + b'\0' * (-len(name) % 4)
        out += b'\0' * (data_start - len(out))
        return bytes(out), [(i, data_start + p) for i, p in enumerate(positions)], data_start + pos


def name_hash(parent_offset, name):
    h = parent_offset ^ 123456789
    raw = name.encode('utf-16-le')
    for k in range(0, len(raw), 2):
        c = raw[k] | raw[k + 1] << 8
        h = ((h >> 5 | h << 27) & 0xFFFFFFFF) ^ c
    return h


def hash_table_size(count):
    if count < 3:
        return 3
    if count < 19:
        return count | 1
    n = count
    while any(n % p == 0 for p in (2, 3, 5, 7, 11, 13, 17)):
        n += 1
    return n


def parse(read):
    """read(position, taille) -> octets du niveau 3. Rend un Tree ; File.source = (position des données, taille)."""
    header = read(0, 0x28)
    (hlen, _, _, dir_off, dir_size, _, _, file_off, file_size, data_off) = struct.unpack('<10I', header)
    if hlen != 0x28:
        raise ValueError('en-tête de niveau 3 inattendu (%#x)' % hlen)
    dirs = read(dir_off, dir_size)
    files = read(file_off, file_size)
    tree = Tree()
    tree.dirs = []
    by_offset = {}
    # dossiers dans l'ordre de la table
    pos = 0
    while pos < len(dirs):
        parent, sibling, child_dir, child_file, _, length = struct.unpack_from('<6I', dirs, pos)
        name = dirs[pos + 0x18:pos + 0x18 + length].decode('utf-16-le')
        by_offset[pos] = len(tree.dirs)
        tree.dirs.append(Dir(name, parent))       # le parent est fixé plus bas
        pos += 0x18 + ((length + 3) & ~3)
    pos = 0
    raw_dirs = []
    while pos < len(dirs):
        parent, sibling, child_dir, child_file, _, length = struct.unpack_from('<6I', dirs, pos)
        raw_dirs.append((pos, parent, sibling, child_dir, child_file))
        pos += 0x18 + ((length + 3) & ~3)
    for pos, parent, sibling, child_dir, child_file in raw_dirs:
        d = tree.dirs[by_offset[pos]]
        d.parent = None if pos == 0 else by_offset[parent]
        c = child_dir
        while c != NONE:
            d.dirs.append(by_offset[c])
            c = struct.unpack_from('<I', dirs, c + 4)[0]
    # fichiers dans l'ordre de la table
    file_by_offset = {}
    pos = 0
    while pos < len(files):
        parent, sibling, data, size, _, length = struct.unpack_from('<IIQQII', files, pos)
        name = files[pos + 0x20:pos + 0x20 + length].decode('utf-16-le')
        file_by_offset[pos] = len(tree.files)
        tree.files.append(File(name, by_offset[parent], size, (data_off + data, size)))
        pos += 0x20 + ((length + 3) & ~3)
    for pos, parent, sibling, child_dir, child_file in raw_dirs:
        d = tree.dirs[by_offset[pos]]
        c = child_file
        while c != NONE:
            d.files.append(file_by_offset[c])
            c = struct.unpack_from('<I', files, c + 4)[0]
    return tree
