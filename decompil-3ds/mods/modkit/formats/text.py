"""Les fichiers de texte du jeu, lus et réécrits sans perdre un octet.

Le décodage des lignes (clé qui tourne, commandes, variables) est celui d'outils/texte.py. Ce module ajoute ce qui
manque pour un aller-retour exact sur les vrais fichiers, relevé sur les 8 langues de a/0/7 et a/0/8 :

- la table des lignes donne, par ligne, un décalage, une longueur en caractères (terminateur compris, sans le
  remplissage) et un mot de 16 bits que le jeu remplit parfois (nous le gardons tel quel) ;
- une ligne peut garder des mots après son premier terminateur : nous les gardons aussi (« queue »), sinon la
  longueur ne se retrouverait pas ;
- le remplissage à 4 octets, lui, est en clair et à zéro.

Une ligne modifiée perd sa queue ; une ligne laissée telle quelle revient identique.
"""
import struct

import texte


class TextLine:
    __slots__ = ('words', 'flags')

    def __init__(self, words, flags=0):
        self.words = list(words)       # mots déchiffrés, terminateur compris, queue éventuelle comprise
        self.flags = flags

    def text(self):
        return texte.mots_vers_texte(self.words)

    def set_text(self, value):
        self.words = texte.texte_vers_mots(value)


class TextFile:
    def __init__(self, lines):
        self.lines = lines

    @classmethod
    def from_lines(cls, strings):
        return cls([TextLine(texte.texte_vers_mots(s)) for s in strings])

    def strings(self):
        return [line.text() for line in self.lines]

    def __len__(self):
        return len(self.lines)


def read(data):
    """Un fichier de texte -> TextFile. Lève ValueError si ce n'en est pas un."""
    texte.decoder(data)            # contrôle de l'en-tête (mêmes erreurs que l'outil existant)
    count = struct.unpack_from('<H', data, 2)[0]
    start = texte.DEBUT_SECTION
    lines = []
    for i in range(count):
        offset, length, flags = struct.unpack_from('<IHH', data, start + 4 + 8 * i)
        words = struct.unpack_from('<%dH' % length, data, start + offset)
        lines.append(TextLine(texte.chiffrer(words, texte.cle_de_ligne(i)), flags))
    return TextFile(lines)


def write(textfile):
    """TextFile -> octets. Les lignes sont posées dans l'ordre, chacune complétée à 4 octets par des zéros."""
    lines = textfile.lines
    if len(lines) > 0xFFFF:
        raise ValueError('trop de lignes : %d' % len(lines))
    table, body = bytearray(), bytearray()
    body_start = 4 + 8 * len(lines)
    for i, line in enumerate(lines):
        words = texte.chiffrer(line.words, texte.cle_de_ligne(i))
        raw = struct.pack('<%dH' % len(words), *words)
        table += struct.pack('<IHH', body_start + len(body), len(words), line.flags)
        body += raw
        if len(raw) % 4:
            body += b'\x00\x00'
    length = 4 + len(table) + len(body)
    header = struct.pack('<HHIII', 1, len(lines), length, 0, texte.DEBUT_SECTION)
    return bytes(header + struct.pack('<I', length) + table + body)
