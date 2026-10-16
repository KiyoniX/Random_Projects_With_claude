"""L'établi : les fichiers du jeu du joueur, les modifications des mods empilés, et les conflits repérés.

Rien n'est écrit sur le disque ici. L'établi lit le dump (gamefiles), garde en mémoire les GARC et les tables
décodés au fur et à mesure que des mods les touchent, et à la fin rend `result()` : les seuls fichiers qui diffèrent
du jeu, chemin du romfs -> octets.

Les conflits : chaque modification déclare une clé (chemin du fichier, numéro, champ…). Deux mods qui touchent la
même clé avec des valeurs différentes, ou un mod qui remplace un fichier entier qu'un autre édite, sont notés ; le
mod chargé en dernier l'emporte.
"""
import garc as garc_lib
import texte

from .formats import eggmoves, evolution, learnset, moves, personal, text

GAMETEXT = 'a/0/7/%d'        # + 2 + numéro de langue
LANGUAGES = ('ja_kana', 'ja_kanji', 'en', 'fr', 'it', 'de', 'es', 'ko')
GAMETEXT_FIRST = 2

# nom de table de texte -> numéro du fichier dans le GARC de texte de la langue
TEXT_TABLES = {'species_names': 80, 'move_names': 14, 'move_descriptions': 15, 'ability_names': 34,
               'item_names': 96, 'trainer_classes': 20, 'trainer_names': 21}

# nom de table de données -> (GARC, module de format, une entrée par numéro ?)
TABLES = {'personal': 'a/2/1/8', 'learnset': 'a/2/1/4', 'evolution': 'a/2/1/5', 'eggmoves': 'a/2/1/3',
          'moves': 'a/2/1/2'}


class BuildError(Exception):
    pass


class Workspace:
    def __init__(self, game):
        self.game = game
        self.files = {}            # chemin -> octets, fichiers remplacés en bloc
        self.garcs = {}            # chemin -> [version, entrées] décodé
        self.texts = {}            # (chemin du GARC, numéro) -> TextFile
        self.tables = {}           # nom -> liste d'objets décodés
        self.code_patches = []     # (adresse, octets, mod)
        self.claims = {}           # clé -> (mod, valeur)
        self._below = {}           # préfixe -> {mod: une clé}
        self.conflicts = []
        self.log = []
        self._names = {}

    # --- conflits ---

    def claim(self, mod, key, value=None):
        for n in range(1, len(key)):
            prior = self.claims.get(key[:n])
            if prior and prior[0] != mod:
                self._conflict(key, mod, prior[0], 'a remplacé ou édité l\'ensemble (%s)' % '/'.join(map(str, key[:n])))
        prior = self.claims.get(key)
        if prior and prior[0] != mod and prior[1] != value:
            self._conflict(key, mod, prior[0], '%r devient %r' % (prior[1], value))
        for other, example in self._below.get(key, {}).items():
            if other != mod:
                self._conflict(key, mod, other, 'remplace un fichier que l\'autre édite (%s)' % '/'.join(map(str, example)))
        self.claims[key] = (mod, value)
        for n in range(1, len(key)):
            self._below.setdefault(key[:n], {}).setdefault(mod, key)

    def _conflict(self, key, mod, other, detail):
        self.conflicts.append('%s : « %s » écrase « %s » (%s)' % ('/'.join(map(str, key)), mod, other, detail))

    # --- fichiers et GARC ---

    def read_file(self, path):
        if path in self.files:
            return self.files[path]
        return self.game.read(path)

    def set_file(self, mod, path, data):
        self.claim(mod, (path,), len(data))
        self.files[path] = bytes(data)
        self.garcs.pop(path, None)

    def garc(self, path):
        if path not in self.garcs:
            raw = self.read_file(path)
            version, entries = garc_lib.lire(raw)
            self.garcs[path] = [version, [list(e) for e in entries], garc_lib.lire_vecteurs(raw)]
        return self.garcs[path]

    def replace_garc_entry(self, mod, path, number, subfiles):
        state = self.garc(path)
        if not 0 <= number < len(state[1]):
            raise BuildError('%s : le numéro %d n\'existe pas (le GARC en a %d)' % (path, number, len(state[1])))
        self.claim(mod, (path, number), sum(len(s) for s in subfiles))
        state[1][number] = list(subfiles)
        state[2][number] = (1 << len(subfiles)) - 1

    # --- textes ---

    def text_path(self, lang):
        if lang not in LANGUAGES:
            raise BuildError('langue inconnue : %r (%s)' % (lang, ', '.join(LANGUAGES)))
        return GAMETEXT % (GAMETEXT_FIRST + LANGUAGES.index(lang))

    def text_file(self, path, number):
        key = (path, number)
        if key not in self.texts:
            self.texts[key] = text.read(self.garc(path)[1][number][0])
        return self.texts[key]

    def set_line(self, mod, lang, table, index, value):
        path = self.text_path(lang)
        number = TEXT_TABLES[table]
        tf = self.text_file(path, number)
        if not 0 <= index < len(tf):
            raise BuildError('%s (%s) : la ligne %d n\'existe pas (%d lignes)' % (table, lang, index, len(tf)))
        try:
            words = texte.texte_vers_mots(value)
        except ValueError as exc:
            raise BuildError('%s (%s) ligne %d : %s' % (table, lang, index, exc))
        self.claim(mod, (path, number, index), value)
        tf.lines[index].words = words

    # --- tables ---

    def table(self, name):
        if name not in self.tables:
            entries = self.garc(TABLES[name])[1]
            if name == 'personal':
                self.tables[name] = personal.read_table(entries)
            else:
                module = {'learnset': learnset, 'evolution': evolution, 'eggmoves': eggmoves, 'moves': moves}[name]
                self.tables[name] = [module.read_entry(e[0]) for e in entries]
        return self.tables[name]

    # --- noms (lus dans le jeu d'origine, en anglais) ---

    def names(self, kind):
        """nom anglais en minuscules -> numéro, pour 'species' ou 'move'."""
        if kind not in self._names:
            table = {'species': 'species_names', 'move': 'move_names'}[kind]
            data = self.game.read(self.text_path('en'))
            entry = garc_lib.lire(data)[1][TEXT_TABLES[table]][0]
            out = {}
            for i, s in enumerate(text.read(entry).strings()):
                out.setdefault(s.lower(), i)
            self._names[kind] = out
        return self._names[kind]

    def resolve(self, kind, value):
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if isinstance(value, str):
            if value.isdigit():
                return int(value)
            found = self.names(kind).get(value.lower())
            if found is not None:
                return found
        raise BuildError('%s inconnu : %r (un numéro ou un nom anglais du jeu)' % (kind, value))

    # --- résultat ---

    def result(self):
        """Chemin -> octets des fichiers qui diffèrent du jeu."""
        for (path, number), tf in self.texts.items():
            self.garc(path)[1][number] = [text.write(tf)]
        for name, objects in self.tables.items():
            path = TABLES[name]
            state = self.garc(path)
            if name == 'personal':
                state[1] = personal.write_table(objects)
            else:
                module = {'learnset': learnset, 'evolution': evolution, 'eggmoves': eggmoves, 'moves': moves}[name]
                state[1] = [[module.write_entry(o)] for o in objects]
        out = dict(self.files)
        for path, (version, entries, vectors) in self.garcs.items():
            if path in self.files and path not in self._edited_garcs():
                continue
            data = garc_lib.ecrire(entries, version, vecteurs=vectors)
            out[path] = data
        changed = {}
        for path, data in out.items():
            if self.game.exists(path) and self.game.read(path) == data:
                self.log.append('%s : identique au jeu, non écrit' % path)
                continue
            changed[path] = data
        return changed

    def _edited_garcs(self):
        edited = {path for (path, _number) in self.texts}
        edited |= {TABLES[n] for n in self.tables}
        edited |= {key[0] for key in self.claims if len(key) > 1}
        return edited
