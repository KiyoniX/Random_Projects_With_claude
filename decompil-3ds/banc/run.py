"""Lance Pokémon X sur le banc d'essai et écrit le journal et le résumé dans local/analyse/banc/.

    python banc/run.py [--secondes S] [--tours N] [--minutes-pc M] [--appels-systeme-rares] [--2a07]

        --secondes S            temps du banc au bout duquel on s'arrête (défaut 30 s de console simulée)
        --tours N               s'arrêter quand la boucle principale a fait N tours
        --minutes-pc M          s'arrêter au bout de M minutes de temps réel (défaut 20)
        --appels-systeme-rares  ne pas écrire au journal les appels système courants qui réussissent tout de suite
        --2a07                  rendre 0x2A07 au premier RegisterInterruptRelayQueue (contrat de gsp, partie 2)
        --sortie DOSSIER        écrire ailleurs que dans local/analyse/banc/
        --appuis LISTE          des boutons à tenir, en secondes du banc : « 12:A,14:START,15.5:A+UP »
                                (chaque appui dure 0,25 s ; boutons A B X Y L R START SELECT UP DOWN LEFT RIGHT)

Il écrit :
    local/analyse/banc/journal.txt   chaque appel système et chaque requête IPC, les fils, les modules, les paliers
    local/analyse/banc/resume.md     le palier atteint, où et pourquoi l'exécution s'arrête, les comptes
    local/analyse/banc/archives/     la copie de travail de la sauvegarde (l'original n'est jamais touché)
"""
import argparse
import collections
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from bench import APT_STARTUP, Bench  # noqa: E402
from cpu_unicorn import UnicornCpu  # noqa: E402


def write_png(path, width, height, rows):
    import zlib
    raw = b''.join(b'\x00' + row for row in rows)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)


def dump_screens(bench):
    """Ce qu'un écran montrerait : la dernière image annoncée par le jeu, lue telle quelle en mémoire vidéo.

    Les tampons d'écran de la 3DS sont rangés tournés d'un quart de tour (une « ligne » mémoire est une colonne de
    240 points, de bas en haut). Seuls RGB8 et RGBA8 sont décodés. Le banc ne dessine rien : ce qui sort ici est ce
    que les remplissages et les copies ont laissé, pas le rendu du jeu.
    """
    out = []
    for screen, width in ((0, 400), (1, 320)):
        frames = bench.gsp.frames[screen]
        if not frames:
            continue
        when, address, fmt, stride = frames[-1]
        kind = fmt & 7
        if kind not in (0, 1):
            continue
        size = 3 if kind == 1 else 4
        try:
            data = bench.memory.read(address, stride * width)
        except Exception:
            continue
        rows = []
        for y in range(240):
            row = bytearray()
            for x in range(width):
                at = x * stride + (239 - y) * size
                pixel = data[at:at + size]
                row += bytes((pixel[size - 1], pixel[size - 2], pixel[size - 3]))
            rows.append(bytes(row))
        name = os.path.join(bench.paths['out'], 'ecran-%s.png' % ('haut' if screen == 0 else 'bas'))
        write_png(name, width, 240, rows)
        distinct = len({bytes(r) for r in rows})
        out.append('%s : image de %#x (%s), %d lignes différentes' % (os.path.basename(name), address,
                                                                       'RGB8' if kind == 1 else 'RGBA8', distinct))
    return out


def write_summary(bench, reason, path):
    j = bench.journal
    k = bench.kernel
    lines = ['# Banc d\'essai : premier démarrage de Pokémon X', '']
    lines.append('Palier atteint : **%s**. Arrêt au temps %.3f s du banc, après %.1f s de PC : %s.' % (
        bench.highest_milestone(), k.now / 1e9, bench.elapsed, reason))
    lines.append('')
    lines.append('## Paliers')
    lines.append('')
    for key, (when, text) in j.milestones.items():
        lines.append('- `%.3f ms` %s : %s' % (when / 1e6, key, text))
    lines.append('')
    lines.append('Réponses d\'APT du démarrage reçues : %s (attendues : %s).' % (
        ', '.join(bench.apt_answers) or 'aucune', ', '.join(APT_STARTUP)))
    lines.append('')
    lines.append('## Les fils à l\'arrêt')
    lines.append('')
    for line in k.describe_threads():
        lines.append('- ' + line)
    lines.append('')
    lines.append('## Les dernières requêtes IPC')
    lines.append('')
    lines.append('```')
    lines.extend(list(j.last_ipc)[-15:])
    lines.append('```')
    lines.append('')
    lines.append('## Les derniers appels système notés')
    lines.append('')
    lines.append('```')
    lines.extend(list(j.last_svc)[-15:])
    lines.append('```')
    lines.append('')
    lines.append('## Requêtes IPC par service et par commande')
    lines.append('')
    lines.append('| Service | En-tête | Commande | Nombre | Réponse |')
    lines.append('| --- | --- | --- | --- | --- |')
    for (service, header, name), count in sorted(j.ipc_counts.items(), key=lambda x: (x[0][0], x[0][1])):
        lines.append('| `%s` | `%08x` | %s | %d | %s |' % (service, header, name, count,
                                                         '/'.join(sorted(j.ipc_kinds.get(service, ())))))
    lines.append('')
    lines.append('## Appels système')
    lines.append('')
    lines.append(', '.join('%s %d' % (bench.names.svc(n), c) for n, c in sorted(k.svc_counts.items())))
    lines.append('')
    lines.append('## Fichiers ouverts')
    lines.append('')
    for when, archive, label in bench.files_opened[:60]:
        lines.append('- `%.3f ms` archive %#x : %s' % (when / 1e6, archive, label))
    lines.append('')
    lines.append('Lectures dans les romfs : %d, %d octets en tout.' % (bench.romfs_reads, bench.stats['fs_read_bytes']))
    lines.append('')
    lines.append('## Modules .cro')
    lines.append('')
    lines.append('Étapes de ro : %s.' % (', '.join(bench.ro_steps) or 'aucune'))
    for when, name, address in bench.cros:
        lines.append('- `%.3f ms` %s au miroir %#x' % (when / 1e6, name, address))
    lines.append('')
    lines.append('## Affichage')
    lines.append('')
    g = bench.gsp
    lines.append('Fins d\'image simulées : %d. Listes de commandes : %d. Noir levé (SetLcdForceBlack 0) : %s.' % (
        g.vblank_count, len(g.lists), '%.3f ms' % (bench.lcd_unblacked / 1e6) if bench.lcd_unblacked else 'non'))
    for name, count in sorted(g.stats.items()):
        lines.append('- %s : %d' % (name, count))
    if g.lists:
        sizes = [size for _, _, size, _, _ in g.lists]
        draws = sum(d for *_, d in g.lists)
        lines.append('- tailles des listes : de %#x à %#x octets, %d ordres de dessin en tout' % (
            min(sizes), max(sizes), draws))
        lines.append('- registres PICA les plus écrits : ' + ', '.join(
            '%#06x×%d' % (reg, n) for reg, n in g.registers.most_common(20)))
    for screen in (0, 1):
        frames = g.frames[screen]
        if frames:
            when, address, fmt, stride = frames[-1]
            lines.append('- écran du %s : %d images annoncées, la dernière à %#x (format %#x, ligne de %d octets)' % (
                'haut' if screen == 0 else 'bas', len(frames), address, fmt, stride))
    for text in getattr(bench, 'screen_dumps', []):
        lines.append('- ' + text)
    lines.append('')
    lines.append('## Son')
    lines.append('')
    d = bench.dsp
    lines.append('Composant chargé : %s ; trames simulées : %d.' % ('oui' if d.loaded else 'non', d.frames))
    lines.append('')
    lines.append('## Écarts avec les fiches et les contrats')
    lines.append('')
    for when, text in j.notes:
        lines.append('- `%.3f ms` %s' % (when / 1e6, text))
    if not j.notes:
        lines.append('- aucun relevé automatiquement')
    lines.append('')
    lines.append('## Requêtes qui ont rendu une erreur')
    lines.append('')
    lines.append('```')
    lines.extend(j.ipc_errors[:40])
    lines.append('```')
    lines.append('')
    lines.append('## Événements')
    lines.append('')
    for when, text in bench.events:
        lines.append('- `%.3f ms` %s' % (when / 1e6, text))
    open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')


BUTTONS = {'A': 0x1, 'B': 0x2, 'SELECT': 0x4, 'START': 0x8, 'RIGHT': 0x10, 'LEFT': 0x20, 'UP': 0x40, 'DOWN': 0x80,
           'R': 0x100, 'L': 0x200, 'X': 0x400, 'Y': 0x800}


def parse_presses(text, duration=0.25):
    presses = []
    for item in filter(None, (t.strip() for t in text.split(','))):
        when, _, names = item.partition(':')
        mask = 0
        for name in names.upper().split('+'):
            mask |= BUTTONS[name]
        presses.append((float(when), duration, mask))
    return presses


def main(argv=None):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Le banc d\'essai de Pokémon X')
    parser.add_argument('--secondes', type=float, default=30)
    parser.add_argument('--tours', type=int, default=0)
    parser.add_argument('--minutes-pc', type=float, default=20)
    parser.add_argument('--appels-systeme-rares', action='store_true')
    parser.add_argument('--2a07', dest='first', action='store_true')
    parser.add_argument('--appuis', default='')
    parser.add_argument('--sortie', default='')
    args = parser.parse_args(argv)
    options = {'seconds': args.secondes, 'turns': args.tours, 'wall_seconds': args.minutes_pc * 60,
               'log_all_svc': not args.appels_systeme_rares, 'gsp_first_result': 0x2A07 if args.first else 0,
               'presses': parse_presses(args.appuis)}
    bench = Bench(UnicornCpu, paths={'out': args.sortie} if args.sortie else None, options=options)
    reason = bench.run()
    bench.journal.close()
    bench.screen_dumps = dump_screens(bench)
    summary = os.path.join(bench.paths['out'], 'resume.md')
    write_summary(bench, reason, summary)
    print('Palier atteint : %s' % bench.highest_milestone())
    print('Arrêt : %s' % reason)
    print('Temps du banc %.3f s, temps du PC %.1f s' % (bench.kernel.now / 1e9, bench.elapsed))
    print('Journal : %s' % bench.journal.path)
    print('Résumé : %s' % summary)


if __name__ == '__main__':
    main()
