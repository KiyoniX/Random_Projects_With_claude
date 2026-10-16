"""Construit une pile de mods pour la console et/ou pour le portage PC.

    python mods/build.py --console --pc mods/exemples/marisson-muscle
    python mods/build.py --console mod-a mod-b          mod-b est chargé après mod-a (il l'emporte en cas de conflit)
    python mods/build.py --check mod-a mod-b            vérifie la pile et liste les conflits, n'écrit rien
    python mods/build.py --export personal              écrit la table « personal » du jeu en TOML (pour partir de là)
    python mods/build.py test                           les tests (comme python mods/tests.py)

Sorties : local/mods-build/console/ (à copier sur la carte SD, voir A-LIRE.txt) et local/mods-build/pc/.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from modkit import builder, manifest, tomlio                       # noqa: E402
from modkit.gamefiles import GameFiles, MissingDump                 # noqa: E402
from modkit.workspace import BuildError, Workspace, TABLES          # noqa: E402


def export_table(name, out):
    ws = Workspace(GameFiles())
    table = ws.table(name)
    data = {}
    for i, entry in enumerate(table):
        if entry in (None, []):
            continue
        if name == 'learnset':
            data[str(i)] = {'moves': [list(p) for p in entry]}
        elif name == 'evolution':
            data[str(i)] = {'evolutions': entry}
        elif name == 'eggmoves':
            data[str(i)] = {'moves': entry}
        elif name == 'personal' and not any(entry[k] for k in ('hp', 'attack', 'defense')):
            continue
        else:
            data[str(i)] = dict(entry)
    root = {'move': data} if name == 'moves' else {'species': data}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write('# Table « %s » lue dans le jeu de l\'utilisateur ; à ne pas versionner ni redistribuer.\n' % name)
        f.write(tomlio.dumps(root))
    return out


def main(argv=None):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if argv is None:
        argv = sys.argv[1:]
    if argv[:1] == ['test']:
        import tests
        return tests.main()
    parser = argparse.ArgumentParser(description='Construit des mods pour Pokémon X (console et PC)')
    parser.add_argument('mods', nargs='*', help='les dossiers de mods, dans l\'ordre de chargement')
    parser.add_argument('--console', action='store_true', help='sortie LayeredFS de Luma3DS (carte SD)')
    parser.add_argument('--pc', action='store_true', help='sortie pour le banc d\'essai (banc/run.py --mod)')
    parser.add_argument('--check', action='store_true', help='vérifie la pile et les conflits sans rien écrire')
    parser.add_argument('--export', choices=sorted(TABLES), help='écrit une table du jeu en TOML')
    parser.add_argument('--out', default=builder.DEFAULT_OUT, help='dossier de sortie (défaut local/mods-build)')
    args = parser.parse_args(argv)
    try:
        if args.export:
            path = export_table(args.export, os.path.join(args.out, 'export', args.export + '.toml'))
            print('Table %s écrite dans %s' % (args.export, path))
            return 0
        if not args.mods:
            parser.error('donner au moins un dossier de mod')
        if not (args.console or args.pc or args.check):
            parser.error('choisir --console, --pc ou --check')
        report, _ = builder.make(args.mods)
    except (manifest.ModError, BuildError, MissingDump) as exc:
        print('Erreur : %s' % exc)
        return 2
    print('Pile (ordre de chargement) : %s' % ', '.join('%s %s' % (m.id, m.version) for m in report.mods))
    for line in report.log:
        print('  ' + line)
    if report.conflicts:
        print('Conflits (%d), le dernier mod chargé l\'emporte :' % len(report.conflicts))
        for line in report.conflicts:
            print('  ! ' + line)
    print('%d fichier(s) à écrire, dont %d nouveau(x) ; %d correctif(s) de code.'
          % (len(report.files), len(report.new_files), len(report.code_patches)))
    for path, data in sorted(report.files.items()):
        print('  %s (%d octets)' % (path, len(data)))
    if args.console and not args.check:
        print('Console : %s' % builder.write_console(report, args.out))
    if args.pc and not args.check:
        print('PC : %s' % builder.write_pc(report, args.out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
