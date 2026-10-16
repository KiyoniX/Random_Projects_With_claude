"""Les fichiers du jeu tels que l'utilisateur les a extraits de son propre dump (jamais versionnés).

Le jeu ouvre deux romfs : celui du jeu de base et celui de la mise à jour. Relevé dans les journaux du banc : il lit
dans la mise à jour les fichiers qu'elle contient (a/0/1/2, a/0/3/6, a/0/7/0 à a/0/7/9, a/2/2/5, static.crs,
.crr/static.crr et les .cro corrigés) et dans le jeu de base tout le reste. La vue « telle que le jeu la voit » est
donc : la mise à jour par-dessus le jeu de base.
"""
import os

from . import LOCAL

DEFAULT_BASE = os.path.join(LOCAL, 'extrait', 'romfs')
DEFAULT_UPDATE = os.path.join(LOCAL, 'extrait', 'maj', 'romfs')


class MissingDump(Exception):
    pass


class GameFiles:
    def __init__(self, base=DEFAULT_BASE, update=DEFAULT_UPDATE):
        self.base = base
        self.update = update
        if not os.path.isdir(base):
            raise MissingDump('le romfs extrait du jeu est absent (%s) : lancer outils/extraire.py sur le dump' % base)
        self._index = None

    def available(self):
        return os.path.isdir(self.base)

    def _scan(self):
        if self._index is None:
            index = {}
            for root, tag in ((self.base, 'base'), (self.update, 'update')):
                if not os.path.isdir(root):
                    continue
                for folder, _, names in os.walk(root):
                    for name in names:
                        full = os.path.join(folder, name)
                        index[os.path.relpath(full, root).replace(os.sep, '/')] = (tag, full)
            self._index = index
        return self._index

    def paths(self):
        return sorted(self._scan())

    def exists(self, path):
        return path in self._scan()

    def source(self, path):
        """'base' ou 'update' : l'archive où le jeu lit ce fichier."""
        return self._scan()[path][0]

    def host_path(self, path):
        return self._scan()[path][1]

    def read(self, path):
        entry = self._scan().get(path)
        if entry is None:
            raise MissingDump('fichier du jeu absent : %s' % path)
        with open(entry[1], 'rb') as f:
            return f.read()
