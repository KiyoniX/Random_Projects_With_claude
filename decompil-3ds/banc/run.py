"""Lance Pokémon X sur le banc d'essai et écrit le journal et le résumé dans local/analyse/banc/.

    python banc/run.py [--secondes S] [--tours N] [--minutes-pc M] [--appels-systeme-rares] [--2a07]

        --secondes S            temps du banc au bout duquel on s'arrête (défaut 30 s de console simulée)
        --tours N               s'arrêter quand la boucle principale a fait N tours
        --minutes-pc M          s'arrêter au bout de M minutes de temps réel (défaut 20)
        --appels-systeme-rares  ne pas écrire au journal les appels système courants qui réussissent tout de suite
        --cpu TYPE              le processeur : unicorn (défaut), natif, hybride ou verifier (voir bench.cpu_factory)
        --mod DOSSIER           un mod (mods/), à répéter pour empiler : construit pour le PC puis superposé au romfs
                                (ou un dossier déjà construit par mods/build.py --pc)
        --2a07                  rendre 0x2A07 au premier RegisterInterruptRelayQueue (contrat de gsp, partie 2)
        --sortie DOSSIER        écrire ailleurs que dans local/analyse/banc/
        --dessiner              exécuter les listes de commandes PICA (voir banc/pica/) ; plus lent
        --dessiner-de S         ne dessiner qu'à partir de la seconde S du banc ; --dessiner-jusqu-a S : jusqu'à S
        --images-chaque S       une image PNG toutes les S secondes du banc dans la fenêtre (local/analyse/banc/images/)
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

from bench import APT_STARTUP, CPU_KINDS, Bench, cpu_factory  # noqa: E402


def write_png(path, width, height, rows):
    import zlib
    raw = b''.join(b'\x00' + row for row in rows)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)


def write_png_array(path, image):
    """image : tableau numpy (hauteur, largeur, 3) uint8."""
    write_png(path, image.shape[1], image.shape[0], [image[y].tobytes() for y in range(image.shape[0])])


def np_rgb(pixels):
    import numpy as np
    return np.ascontiguousarray(pixels[..., :3])


def screen_image(bench, screen):
    """Ce qu'un écran montrerait : la dernière image annoncée par le jeu, lue telle quelle en mémoire vidéo.

    Les tampons d'écran de la 3DS sont rangés tournés d'un quart de tour (une « ligne » mémoire est une colonne de
    240 points, de bas en haut). Rend (image RGB, adresse, nom du format) ou None.
    """
    import numpy as np
    from pica import formats
    width = 400 if screen == 0 else 320
    frames = bench.gsp.frames[screen]
    if not frames:
        return None
    when, address, fmt, stride = frames[-1]
    if bench.gsp.gpu is not None and screen in bench.gsp.latest_transfer:
        # en mode dessin, des images sautées laissent l'un des deux tampons du jeu périmé : on prend le dernier transfert fait
        address, fmt, stride = bench.gsp.latest_transfer[screen]
    name = formats.GX_FORMATS.get(fmt & 7)
    if name is None:
        return None
    unit = formats.BYTES_PER_PIXEL[name]
    try:
        data = bench.memory.read(address, stride * width)
    except Exception:
        return None
    columns = np.frombuffer(data, dtype=np.uint8).reshape(width, stride)[:, :240 * unit].reshape(width, 240, unit)
    rgba = formats.decode_pixels(name, columns)                 # [x][r], r = 0 en bas
    image = rgba.transpose(1, 0, 2)[::-1, :, :3]
    return np.ascontiguousarray(image), address, name


def dump_screens(bench, folder=None, prefix=''):
    out = []
    for screen in (0, 1):
        found = screen_image(bench, screen)
        if found is None:
            continue
        image, address, name = found
        label = 'haut' if screen == 0 else 'bas'
        path = os.path.join(folder or bench.paths['out'], '%secran-%s.png' % (prefix, label) if folder is None
                            else '%s%s.png' % (prefix, label))
        write_png_array(path, image)
        distinct = len({image[y].tobytes() for y in range(image.shape[0])})
        out.append('%s : image de %#x (%s), %d lignes différentes' % (os.path.basename(path), address, name, distinct))
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
    if g.gpu is not None:
        lines.append('- processeur graphique (pica/) : %s ; %.1f s de PC dans les listes' % (
            ', '.join('%s %d' % (k, v) for k, v in sorted(g.gpu.stats.items())) or 'rien', g.draw_seconds))
        for text, n in sorted(g.gpu.notes.items()):
            if not text.startswith(('trace', '_')):
                lines.append('- pica : %s (%d fois)' % (text, n))
    y2r = bench.services.get('y2r:u')
    if y2r is not None and getattr(y2r, 'conversions', 0):
        lines.append('- y2r:u : %d conversions YUV vers RGB%s' % (y2r.conversions, ' ; problèmes : ' + ', '.join(
            sorted(set(y2r.problems))) if y2r.problems else ''))
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


def prepare_mods(mod_args):
    """--mod : un dossier déjà construit (overlay.json) ou des dossiers de mods à construire pour le PC."""
    if len(mod_args) == 1 and os.path.isfile(os.path.join(mod_args[0], 'overlay.json')):
        import json
        with open(os.path.join(mod_args[0], 'overlay.json'), encoding='utf-8') as f:
            version = json.load(f).get('format', 1)
        if version > 1:         # mods/README.md, « Le contrat avec le portage PC »
            raise SystemExit('overlay.json au format %d : ce banc ne lit que le format 1' % version)
        return os.path.abspath(mod_args[0])
    mods_dir = os.path.join(os.path.dirname(HERE), 'mods')
    sys.path.insert(0, mods_dir)
    from modkit import builder
    report, _ = builder.make(mod_args)
    for line in report.conflicts:
        print('Mod, conflit : ' + line)
    folder = builder.write_pc(report)
    print('Mods construits pour le PC dans %s : %s' % (folder, ', '.join(m.id for m in report.mods)))
    return folder


def main(argv=None):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Le banc d\'essai de Pokémon X')
    parser.add_argument('--secondes', type=float, default=30)
    parser.add_argument('--tours', type=int, default=0)
    parser.add_argument('--minutes-pc', type=float, default=20)
    parser.add_argument('--appels-systeme-rares', action='store_true')
    parser.add_argument('--2a07', dest='first', action='store_true')
    parser.add_argument('--cpu', default='unicorn', choices=CPU_KINDS,
                        help='le processeur : unicorn (défaut), natif, hybride (natif + unicorn pour les .cro), verifier')
    parser.add_argument('--mod', action='append', default=[], metavar='DOSSIER',
                        help="un mod de mods/ (répétable, dans l'ordre de chargement) ou un dossier de mods/build.py --pc")
    parser.add_argument('--appuis', default='')
    parser.add_argument('--sortie', default='')
    parser.add_argument('--dessiner', action='store_true',
                        help="exécuter les listes de commandes PICA (rastérisation) ; l'état est toujours suivi")
    parser.add_argument('--dessiner-de', type=float, default=None, metavar='S',
                        help="ne dessiner qu'à partir de cette seconde du banc (implique --dessiner)")
    parser.add_argument('--dessiner-jusqu-a', type=float, default=None, metavar='S',
                        help='ne plus dessiner à partir de cette seconde du banc')
    parser.add_argument('--dessiner-un-sur', type=int, default=1, metavar='N',
                        help="ne dessiner qu'une image sur N (les autres ne sont ni dessinées ni transférées à l'écran)")
    parser.add_argument('--images-chaque', type=float, default=1.0, metavar='S',
                        help='une image PNG toutes les S secondes du banc dans la fenêtre de dessin (défaut 1)')
    args = parser.parse_args(argv)
    options = {'seconds': args.secondes, 'turns': args.tours, 'wall_seconds': args.minutes_pc * 60,
               'log_all_svc': not args.appels_systeme_rares, 'gsp_first_result': 0x2A07 if args.first else 0,
               'presses': parse_presses(args.appuis)}
    if args.dessiner or args.dessiner_de is not None or args.dessiner_jusqu_a is not None:
        options['draw'] = True
        options['draw_from'] = args.dessiner_de or 0.0
        options['draw_until'] = args.dessiner_jusqu_a if args.dessiner_jusqu_a is not None else float('inf')
        options['snapshot_every'] = args.images_chaque
        options['draw_every'] = args.dessiner_un_sur
        counter = [0]
        folder = os.path.join(args.sortie or os.path.join(os.path.dirname(HERE), 'local', 'analyse', 'banc'), 'images')
        if os.path.isdir(folder):
            for old in os.listdir(folder):
                if old.endswith('.png'):
                    os.remove(os.path.join(folder, old))

        def snapshot(bench):
            folder = os.path.join(bench.paths['out'], 'images')
            os.makedirs(folder, exist_ok=True)
            counter[0] += 1
            prefix = '%03d-%06.2fs-' % (counter[0], bench.kernel.now / 1e9)
            dump_screens(bench, folder, prefix)
            if os.environ.get('PICA_CIBLES'):
                for surface in bench.gsp.gpu.color_surfaces.values():
                    write_png_array(os.path.join(folder, '%scible-%x.png' % (prefix, surface.address)),
                                    np_rgb(surface.pixels))
        options['snapshot'] = snapshot
    paths = {'out': args.sortie} if args.sortie else {}
    if args.mod:
        paths['overlay'] = prepare_mods(args.mod)
    bench = Bench(cpu_factory(args.cpu), paths=paths or None, options=options)
    reason = bench.run()
    bench.journal.close()
    bench.screen_dumps = dump_screens(bench)
    summary = os.path.join(bench.paths['out'], 'resume.md')
    write_summary(bench, reason, summary)
    print('Palier atteint : %s' % bench.highest_milestone())
    for overlay in getattr(bench, 'overlays', []):
        for path, n in sorted(overlay.hits.items()):
            print('Mod : %d lecture(s) dans le fichier de mod %s (voir le journal : « FICHIER DE MOD »)' % (n, path))
    print('Arrêt : %s' % reason)
    print('Temps du banc %.3f s, temps du PC %.1f s' % (bench.kernel.now / 1e9, bench.elapsed))
    if hasattr(bench.cpu, 'timing'):
        native, uni = bench.cpu.timing()
        kernel = bench.elapsed - native - uni
        print('Processeur %s : %.1f s dans le code natif, %.1f s sous unicorn, %.1f s dans le reste (noyau, services, '
              'journal : Python) ; %s' % (args.cpu, native, uni, kernel, dict(bench.cpu.stats)))
    if bench.gsp.gpu is not None:
        print('Temps du PC passé dans les listes PICA : %.1f s ; %s' % (bench.gsp.draw_seconds, dict(bench.gsp.gpu.stats)))
        for text, n in bench.gsp.gpu.notes.items():
            print('  PICA : %s (%d)' % (text, n))
    print('Journal : %s' % bench.journal.path)
    print('Résumé : %s' % summary)


if __name__ == '__main__':
    main()
