"""Le romfs « vu par le jeu » avec des fichiers de mods par-dessus, pour le banc d'essai (sans rien recopier du jeu).

On part d'un romfs réel (banc/romfs.py : NcchRomfs, niveau 3 lu dans le .cxi déchiffré). Son arbre est lu, les
fichiers superposés y remplacent ceux de même chemin (ou s'ajoutent), les tables sont refabriquées (romfs3) et les
données sont servies à la volée : tantôt depuis le romfs d'origine, tantôt depuis le fichier du mod. Le jeu parse lui-même
l'arbre qu'on lui rend, comme sur la console avec les fichiers de LayeredFS.

Même interface que NcchRomfs : size, read(position, taille), files().
"""
import bisect
import os

from . import romfs3


class OverlayRomfs:
    def __init__(self, base, replacements, allow_new=True):
        """base : un NcchRomfs ; replacements : chemin du romfs -> chemin du fichier sur le disque."""
        self.base = base
        self.tree = romfs3.parse(base.read)
        self.hits = {}                 # chemin -> nombre de lectures qui sont tombées dans le fichier du mod
        self.replaced = []
        self.original = {}             # chemin -> (position, taille) dans le romfs d'origine
        self.added = []
        for path, host in sorted(replacements.items()):
            size = os.path.getsize(host)
            index = self.tree.find_file(path)
            if index is not None:
                self.original[path] = self.tree.files[index].source
                self.tree.files[index].source = ('host', host)
                self.tree.files[index].size = size
                self.replaced.append(path)
            elif allow_new:
                self.tree.add_file(path, size, ('host', host))
                self.added.append(path)
        tables, positions, end = self.tree.build()
        self.size = end
        self._tables = tables
        segments = []                  # (début, fin, fichier de l'arbre)
        for index, position in positions:
            f = self.tree.files[index]
            if f.size:
                segments.append((position, position + f.size, index))
        segments.sort()
        self._starts = [s[0] for s in segments]
        self._segments = segments
        self._host = {}

    def close(self):
        for h in self._host.values():
            h.close()
        self._host.clear()

    def wants(self, path):
        return path in self.replaced or path in self.added

    def _host_file(self, path):
        if path not in self._host:
            self._host[path] = open(path, 'rb')
        return self._host[path]

    def read(self, position, size):
        if position >= self.size:
            return b''
        end = min(position + size, self.size)
        out = bytearray()
        pos = position
        if pos < len(self._tables):
            take = min(end, len(self._tables)) - pos
            out += self._tables[pos:pos + take]
            pos += take
        while pos < end:
            i = bisect.bisect_right(self._starts, pos) - 1
            if i >= 0 and pos < self._segments[i][1]:
                start, stop, index = self._segments[i]
                f = self.tree.files[index]
                take = min(end, stop) - pos
                if f.source[0] == 'host':
                    h = self._host_file(f.source[1])
                    h.seek(pos - start)
                    out += h.read(take)
                    name = self.tree.path_of_file(index)
                    self.hits[name] = self.hits.get(name, 0) + 1
                else:
                    out += self.base.read(f.source[0] + (pos - start), take)
                pos += take
            else:                       # remplissage entre deux fichiers
                nxt = self._starts[i + 1] if i + 1 < len(self._starts) else end
                take = min(end, nxt) - pos
                out += b'\0' * take
                pos += take
        return bytes(out)

    def files(self):
        """[(chemin, position des données dans le niveau 3, taille)] comme NcchRomfs.files()."""
        out = []
        for start, stop, index in self._segments:
            out.append((self.tree.path_of_file(index), start, stop - start))
        return out

    def which_file(self, position):
        """(chemin, décalage) du fichier où tombe une position, ou None."""
        i = bisect.bisect_right(self._starts, position) - 1
        if i >= 0 and position < self._segments[i][1]:
            start, _, index = self._segments[i]
            return self.tree.path_of_file(index), position - start
        return None

    def is_replaced_at(self, position):
        hit = self.which_file(position)
        if hit and self.wants(hit[0]):
            return hit
        return None

    def describe(self, position, data):
        """Pour le journal du banc : si la lecture tombe dans un fichier de mod, ce qui a été servi et ce que le jeu
        aurait lu dans le romfs d'origine à la même place. Chaîne vide sinon."""
        hit = self.is_replaced_at(position)
        if hit is None or not data:
            return ''
        path, offset = hit
        text = 'FICHIER DE MOD %s+%#x, %d octets servis' % (path, offset, len(data))
        if path in self.original:
            start, size = self.original[path]
            if offset < size:
                before = self.base.read(start + offset, min(len(data), size - offset))
                diff = [i for i in range(len(before)) if before[i] != data[i]]
                if diff:
                    i = diff[0]
                    text += (" ; DIFFÉRENT du romfs d'origine sur %d octet(s), le premier en %s+%#x : origine %s, servi %s"
                             % (len(diff) + len(data) - len(before), path, offset + i, before[i:i + 8].hex(' '),
                                data[i:i + 8].hex(' ')))
                else:
                    text += " ; identique au romfs d'origine sur cette plage"
        else:
            text += ' ; fichier absent du jeu, servi : %s' % data[:16].hex(' ')
        return text
