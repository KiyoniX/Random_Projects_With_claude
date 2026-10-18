"""Tableau d'avancement dans la console, lu dans etat.json.

    python outils/tableau.py            une fois
    python outils/tableau.py --suivre   se redessine quand etat.json change (Ctrl+C pour quitter)

Les pourcentages sont approchés : un palier compte ses tâches faites, un groupe de binaires ses fonctions nommées
(versées dans les fiches) et, en clair, celles qui n'attendent plus que la relecture (noms proposés).
"""
import json
import os
import sys
import time

from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

ETAT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'etat.json')
WIDTH = 30

BOOT = {'boot9', 'boot11', 'arm9loader', 'kernel9', 'process9'}
KERNEL = {'kernel11'}
APPLETS = {'appleted', 'cabinet', 'cherry', 'ctrapp', 'error', 'error-safe', 'extrapad', 'friend', 'hmvp', 'memolib',
           'menu', 'mint', 'newslist', 'olv', 'pnote_ap', 'snote_ap', 'skater', 'solv3', 'swkbd', 'swkbd-safe'}
GAME = {'maj'}


def group_of(name):
    for label, members in (('Démarrage et ARM9', BOOT), ('Noyau ARM11', KERNEL), ('Applets', APPLETS), ('Jeu (Pokémon X)', GAME)):
        if name in members or (members is GAME and name.startswith('.cro')):
            return label
    return 'Modules système'


def bar(done, extra=0.0, width=WIDTH):
    """Barre pleine pour le fait, claire pour ce qui attend la relecture."""
    full = round(done * width)
    light = min(width - full, round(extra * width))
    return Text('█' * full, 'green') + Text('▒' * light, 'yellow') + Text('·' * (width - full - light), 'grey35')


def row(table, label, done, extra=0.0, detail='', width=WIDTH):
    table.add_row(label, bar(done, extra, width), '%5.1f %%' % (100 * done), detail)


def new_table(title):
    table = Table(title=title, title_justify='left', title_style='bold', box=None, pad_edge=False)
    for column, justify in (('', 'left'), ('', 'left'), ('', 'right'), ('', 'left')):
        table.add_column(column, justify=justify, no_wrap=True)
    table.show_header = False
    return table


def render(etat):
    paliers = new_table('Paliers du projet (tâches faites)')
    weight = sum(p['poids'] for p in etat['paliers'])
    overall = 0.0
    for p in etat['paliers']:
        done = sum(t['fait'] for t in p['taches']) / len(p['taches'])
        overall += done * p['poids'] / weight
        row(paliers, '%d. %s' % (p['id'], p['nom']), done, detail='%d/%d' % (sum(t['fait'] for t in p['taches']), len(p['taches'])))
    row(paliers, 'Ensemble (pondéré)', overall)

    groups = {}
    for b in etat['fonctions']['binaires']:
        g = groups.setdefault(group_of(b['nom']), [0, 0, 0, 0])
        g[0] += b['trouvees']
        g[1] += b['nommees']
        g[2] += b['proposees_haute'] + b['proposees_moyenne']
        g[3] += 1
    decomp = new_table('Décompilation (vert : nommé et relu ; jaune : proposé, à relire)')
    for label in ('Démarrage et ARM9', 'Noyau ARM11', 'Modules système', 'Applets', 'Jeu (Pokémon X)'):
        total, named, proposed, count = groups.get(label, [0, 0, 0, 0])
        if total:
            row(decomp, label, named / total, proposed / total, '%d/%d fonctions, %d binaires' % (named, total, count))
    f = etat['fonctions']
    row(decomp, 'Console + jeu', f['nommees'] / f['total'], 0, '%d/%d fonctions' % (f['nommees'], f['total']))

    system = [b for b in f['binaires'] if group_of(b['nom']) == 'Modules système' and not b['nom'].endswith('-safe') and b['trouvees']]
    system.sort(key=lambda b: (b['nommees'] + b['proposees_haute'] + b['proposees_moyenne']) / b['trouvees'])
    half = (len(system) + 1) // 2
    columns = []
    for part in (system[:half], system[half:]):
        table = new_table('')
        for b in part:
            t = b['trouvees']
            row(table, b['nom'], b['nommees'] / t, (b['proposees_haute'] + b['proposees_moyenne']) / t, '%d/%d' % (b['nommees'], t), 16)
        columns.append(table)
    modules = Table.grid(padding=(0, 4))
    modules.add_row(*columns)
    modules = Group(Text('Modules système (sans les copies -safe), du moins avancé au plus avancé', 'bold'), modules)

    port = new_table('Portage natif')
    row(port, 'Fonctions recompilées (ARM → C)', f['recompilees'] / f['total'], 0, '%d/%d' % (f['recompilees'], f['total']))
    row(port, 'Fonctions citées dans les fiches', f['citees'] / f['total'], 0, '%d/%d' % (f['citees'], f['total']))

    stamp = time.strftime('%d/%m/%Y à %H:%M', time.localtime(os.path.getmtime(ETAT)))
    head = Text('Mis à jour le %s — prochaine action : %s' % (stamp, etat['prochaine_action']), 'grey62')
    return Panel(Group(head, Text(), paliers, Text(), decomp, Text(), port, Text(), modules), title='Décompil 3DS — avancement',
                 border_style='cyan')


def load():
    with open(ETAT, encoding='utf-8') as f:
        return json.load(f)


def main():
    console = Console()
    if '--suivre' not in sys.argv:
        console.print(render(load()))
        return
    seen = None
    with Live(render(load()), console=console, screen=True, auto_refresh=False) as live:
        while True:
            stamp = os.path.getmtime(ETAT)
            if stamp != seen:
                seen = stamp
                try:
                    live.update(render(load()), refresh=True)
                except (json.JSONDecodeError, OSError):
                    seen = None  # fichier en cours d'écriture : on relit au tour suivant
            time.sleep(2)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
