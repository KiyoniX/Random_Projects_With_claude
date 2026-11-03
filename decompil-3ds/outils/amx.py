"""Lire un fichier AMX de Pokémon X : Pawn modifié, table de symboles par hachage, code et données compacts.

Tailles d'instructions d'après 0x1cbfb4 (contrôle du code au chargement), jamais d'après Pawn. Détail dans
`local/analyse/pokemon-x/scripts-amx.md`. Aucun script n'est versionné : les tests fabriquent leur fichier.
"""
import struct

OP_CASETBL, OP_SWITCH = 0x82, 0x81


def _taille(op):
    """Taille d'une instruction à opérandes fixes, ou None pour un opcode que 0x1cbfb4 refuse."""
    huit = (1 <= op <= 8 or 0xa <= op <= 0x16 or 0x1c <= op <= 0x20 or 0x26 <= op <= 0x29 or 0x35 <= op <= 0x40
            or 0x44 <= op <= 0x47 or 0x75 <= op <= 0x79
            or op in (0x18, 0x1a, 0x2c, 0x2d, 0x31, 0x33, 0x34, 0x57, 0x58, 0x5b, 0x5c, 0x69, 0x6a, 0x6d, 0x6e, 0x72, 0x73, 0x7b, 0x81, 0x85, 0x9e, 0xa0))
    if huit:
        return 8
    if op == 0x87 or 0x8a <= op <= 0x8d or 0x9a <= op <= 0x9d:
        return 0xc
    if 0x8e <= op <= 0x91:
        return 0x10
    if 0x92 <= op <= 0x95:
        return 0x14
    if 0x96 <= op <= 0x99:
        return 0x18
    quatre = (0x21 <= op <= 0x25 or 0x41 <= op <= 0x43 or 0x48 <= op <= 0x56 or 0x5d <= op <= 0x68 or 0xa2 <= op <= 0xd4
              or op in (9, 0x17, 0x19, 0x1b, 0x2a, 0x2b, 0x2e, 0x2f, 0x30, 0x59, 0x5a, 0x6b, 0x6c, 0x6f, 0x70, 0x71, 0x74, 0x7a, 0x83, 0x84, 0x86, 0x89, 0x9f))
    return 4 if quatre else None


def hachage(nom):
    """Le hachage des noms de la table de symboles : c ^ (h * 0x83), lu en 0x4d0028 et 0x4d0820."""
    h = 0
    for c in nom.encode():
        h = (c ^ (h * 0x83)) & 0xffffffff
    return h


def developper(amx, taille, drapeaux, cod, hea):
    """Le code et les données compacts (drapeau 4), comme 0x4d01e4 : 7 bits par octet, signe au bit 6 du premier."""
    if not drapeaux & 4:
        return amx[cod:hea]
    cellules, v, debut = [], 0, True
    for b in amx[cod:taille]:
        if debut:
            v = -1 if b & 0x40 else 0
            debut = False
        v = (v << 7) | (b & 0x7f)
        if not b & 0x80:
            cellules.append(v & 0xffffffff)
            v, debut = 0, True
    rendu = struct.pack('<%dI' % len(cellules), *cellules)
    return rendu + bytes(max(0, hea - cod - len(rendu)))


class Amx:
    def __init__(self, brut):
        self.brut = brut
        (self.taille, magic, _, _, self.drapeaux, self.defsize, self.cod, self.dat, self.hea, self.stp, self.cip,
         self.publics, self.natives, self.libraries, self.pubvars, self.tags, self.nametable) = struct.unpack_from('<IHBBHHIIIIiIIIIII', brut, 0)
        if magic != 0xf1e0:
            raise ValueError('pas un AMX')
        memoire = developper(brut, self.taille, self.drapeaux, self.cod, self.hea)
        self.code = memoire[:self.dat - self.cod]
        self.donnees = memoire[self.dat - self.cod:]

    def _table(self, debut, fin):
        return [struct.unpack_from('<II', self.brut, p) for p in range(debut, fin, self.defsize)]

    def fonctions_publiques(self):
        return self._table(self.publics, self.natives)

    def natifs(self):
        return self._table(self.natives, self.libraries)

    def variables_publiques(self):
        return self._table(self.pubvars, self.tags)

    def mot(self, p):
        return struct.unpack_from('<I', self.code, p)[0]

    def signe(self, p):
        return struct.unpack_from('<i', self.code, p)[0]

    def instructions(self, debut=0):
        """Rend (position, opcode, valeur empaquetée, taille) ; lève ValueError sur un opcode refusé."""
        p = debut
        while p + 4 <= len(self.code):
            mot = self.mot(p)
            op = mot & 0xffff
            t = 0xc + self.mot(p + 4) * 8 if op == OP_CASETBL else _taille(op)
            if t is None:
                raise ValueError('opcode %#x refusé en %#x' % (op, p))
            yield p, op, mot >> 16, t
            p += t

    def casetbl(self, p):
        """Le CASETBL à p : (cas [(valeur, cible)], cible par défaut). Cibles relatives à la cellule précédente (0x1cbfb4, cas 0x82)."""
        n = self.mot(p + 4)
        cas = []
        for i in range(n):
            q = p + 0xc + i * 8
            cas.append((self.signe(q), q + self.signe(q + 4)))
        return cas, p + 4 + self.signe(p + 8)
