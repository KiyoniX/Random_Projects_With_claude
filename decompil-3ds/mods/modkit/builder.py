"""La construction : une pile de mods + le dump du joueur -> la sortie console (LayeredFS) et la sortie PC (banc).

Les deux sorties contiennent les mêmes fichiers de romfs. Console : l'arborescence que Luma3DS lit sur la carte SD,
luma/titles/<id>/romfs/<chemin>, plus luma/titles/<id>/code.ips si un mod corrige le code. PC : le dossier romfs/ des
fichiers à superposer et overlay.json, que banc/run.py --mod fait lire au jeu.
"""
import hashlib
import json
import os
import shutil

from . import LOCAL, TITLE_ID, GAME_ID, UPDATE_TITLE_ID, ips, manifest
from .apply import apply_mod
from .gamefiles import GameFiles
from .workspace import BuildError, Workspace

DEFAULT_OUT = os.path.join(LOCAL, 'mods-build')
OVERLAY_FORMAT = 1
CODE_BIN = os.path.join(LOCAL, 'extrait', 'maj', 'exefs', 'code.bin')

SD_NOTE = """Mods pour Pokémon X ({game}) : à copier sur la carte SD de la console.

1. Éteindre la console, retirer la carte SD, la brancher sur le PC.
2. Copier le dossier « luma » de ce dossier à la racine de la carte SD, en fusionnant avec le dossier « luma »
   existant (les fichiers de luma/titles/{title}/ s'ajoutent ; rien d'autre n'est touché).
3. Dans Luma3DS (menu Select au démarrage, ou manette au lancement), activer « Enable game patching ».
4. Remettre la carte, lancer Pokémon X.

Pour revenir au jeu d'origine : supprimer le dossier luma/titles/{title} de la carte SD.

Mods : {mods}
"""


class Report:
    def __init__(self):
        self.mods = []
        self.files = {}
        self.new_files = []
        self.conflicts = []
        self.log = []
        self.code_patches = []
        self.outputs = []


def load_stack(mod_dirs):
    mods = [manifest.load(d) for d in mod_dirs]
    return manifest.resolve(mods)


def make(mod_dirs, game=None):
    """Applique la pile et rend (Report, Workspace). Ne produit rien sur le disque."""
    game = game or GameFiles()
    ordered = load_stack(mod_dirs)
    ws = Workspace(game)
    report = Report()
    report.mods = ordered
    for mod in ordered:
        apply_mod(ws, mod)
    report.files = ws.result()
    report.new_files = sorted(p for p in report.files if not game.exists(p))
    report.conflicts = list(ws.conflicts)
    report.log = list(ws.log)
    report.code_patches = list(ws.code_patches)
    _check_code(report.code_patches)
    return report, ws


def _check_code(patches):
    for address, payload, mod, expect, _note in patches:
        if not expect:
            continue
        if not os.path.isfile(CODE_BIN):
            raise BuildError('%s : expect_sha1 demandé mais %s est absent' % (mod, CODE_BIN))
        with open(CODE_BIN, 'rb') as f:
            f.seek(address - ips.CODE_BASE)
            current = f.read(len(payload))
        if hashlib.sha1(current).hexdigest() != expect.lower():
            raise BuildError('%s : le code en %#x n\'est pas celui que le correctif attend (sha1 %s)'
                             % (mod, address, hashlib.sha1(current).hexdigest()))


def _clean(folder):
    if os.path.isdir(folder):
        shutil.rmtree(folder)
    os.makedirs(folder)


def _write_files(root, files):
    for path, data in files.items():
        target = os.path.join(root, *path.split('/'))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as f:
            f.write(data)


def _summary(report):
    return [{'id': m.id, 'name': m.name, 'version': m.version, 'author': m.author} for m in report.mods]


def write_console(report, out=DEFAULT_OUT):
    root = os.path.join(out, 'console')
    _clean(root)
    title = os.path.join(root, 'luma', 'titles', TITLE_ID)
    _write_files(os.path.join(title, 'romfs'), report.files)
    if report.code_patches:
        data = ips.build([(a, p) for a, p, *_ in report.code_patches])
        with open(os.path.join(title, 'code.ips'), 'wb') as f:
            f.write(data)
    with open(os.path.join(root, 'A-LIRE.txt'), 'w', encoding='utf-8') as f:
        f.write(SD_NOTE.format(game=GAME_ID, title=TITLE_ID,
                               mods=', '.join('%s %s' % (m.id, m.version) for m in report.mods)))
    report.outputs.append(root)
    return root


def write_pc(report, out=DEFAULT_OUT):
    root = os.path.join(out, 'pc')
    _clean(root)
    _write_files(os.path.join(root, 'romfs'), report.files)
    # format : version de overlay.json, lue par le banc et par le portage Rust (mods/README.md, « Le contrat avec le
    # portage PC ») ; à augmenter à tout changement incompatible
    info = {'format': OVERLAY_FORMAT, 'game': GAME_ID, 'title_id': TITLE_ID, 'update_title_id': UPDATE_TITLE_ID, 'mods': _summary(report),
            'files': {p: {'size': len(d), 'sha1': hashlib.sha1(d).hexdigest(), 'new': p in report.new_files}
                      for p, d in sorted(report.files.items())},
            'code_patches': [{'address': a, 'size': len(p), 'mod': m} for a, p, m, *_ in report.code_patches]}
    with open(os.path.join(root, 'overlay.json'), 'w', encoding='utf-8') as f:
        json.dump(info, f, indent=1, ensure_ascii=False)
    report.outputs.append(root)
    return root
