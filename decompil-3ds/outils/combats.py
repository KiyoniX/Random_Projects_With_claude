"""Chaque capacité du jeu lancée une fois en combat, dans le vrai moteur : ce qui mesure les capacités déroulées.

    python combats.py capacites SORTIE [--travailleurs 6] [--secondes 100] [CAPACITE...]
    python combats.py tenues SORTIE [--travailleurs 6] [--secondes 100] [K...]   talent et objet tenu de la case K des tables
    python combats.py bilan SORTIE
    python combats.py test

Pour chaque capacité, on rejoue la partie de `revue_modeles.PARTIE` jusqu'au combat contre le dresseur 86, avec une sauvegarde
où le Pokémon de tête porte cette capacité dans ses quatre emplacements ; puis A, encore et encore : Attaque, puis la capacité,
quel que soit l'emplacement sous le curseur. Le runtime note chaque capacité lancée (« capacité : N par joueur… », guet de
DllBattle+0x1fc58, local/analyse/DllBattle/capacites.md). Une capacité notée a tourné ; qu'elle ait réussi n'est pas jugé.
Les talents et les objets tenus de même (« talent : N », « objet tenu : N », branchés à l'entrée en combat ; « objet consommé :
N »), local/analyse/DllBattle/talents.md : l'essai K donne au Pokémon de tête la case K de chacune des deux tables de 182
gestionnaires de DllBattle. Le combat lit l'octet du talent lui-même : un talent que l'espèce n'a pas est accepté.
Rien de ceci n'est versionné : tout est écrit dans local/.
"""
import glob
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import garc
import pk6
import revue_modeles
import texte

RUNTIME = os.environ.get('RUNTIME', revue_modeles.RUNTIME)
TEXTE_CAPACITES = 13
# DllBattle : les tables des gestionnaires d'objets tenus et de talents, 182 cases de 8 octets (numéro, fonction)
MODULE = os.path.join(revue_modeles.RACINE, 'local', 'extrait', 'maj', 'romfs', 'DllBattle.cro')
TABLES = (0xD3848, 0xD5128)
CASES = 182
DERNIERE = 617
# Le PP le plus bas d'une capacité : plus, et le jeu montrerait un compte faux
PP = 5
# le combat attend devant son menu à 27 s (revue_modeles.journal_de_depart)
PREMIER_A_MS = 28000
PAS_A_MS = 700


def journal(secondes):
    """Les entrées jusqu'au combat, puis A toutes les 700 ms."""
    lignes = revue_modeles.journal_de_depart(None).rstrip('\n').split('\n')
    t = PREMIER_A_MS
    while t + 150 < secondes * 1000:
        lignes += [f'[{t:10.3f} ms] hid : boutons tenus 0x1', f'[{t + 150:10.3f} ms] hid : boutons tenus 0x0']
        t += PAS_A_MS
    return '\n'.join(lignes) + '\n'


def lancees(chemin):
    """Ce que le journal note du combat : les capacités (capacité, joueur ou adversaire, appelée par), puis les talents et
    objets (genre, numéro, joueur ou adversaire)."""
    capacites, branches = [], []
    with open(chemin, encoding='utf-8', errors='replace') as f:
        for ligne in f:
            m = re.search(r'capacité : (\d+) par (\w+) \(Pokémon \d+\)(?: appelée par (\d+))?', ligne)
            b = re.search(r'(talent|objet tenu|objet consommé) : (\d+) par (\w+) \(Pokémon', ligne)
            if m:
                capacites.append((int(m.group(1)), m.group(2), int(m.group(3) or m.group(1))))
            elif b:
                branches.append((b.group(1), int(b.group(2)), b.group(3)))
    return capacites, branches


def tables():
    """(objets tenus, talents) que DllBattle sait brancher."""
    with open(MODULE, 'rb') as f:
        donnees = f.read()
    return tuple([struct.unpack_from('<I', donnees, t + 8 * i)[0] for i in range(CASES)] for t in TABLES)


def essayer(sortie, nom, changer, attendu, sauvegarde, lignes, secondes):
    """Une partie : le Pokémon de tête passé par `changer` ; `attendu(capacités, branches)` dit si l'essai a porté."""
    dossier = os.path.join(sortie, nom)
    if os.path.exists(os.path.join(dossier, 'verdict.json')):
        return
    shutil.rmtree(dossier, ignore_errors=True)
    entree = os.path.join(dossier, 'in')
    shutil.copytree(os.path.join(revue_modeles.PARTIE, 'depart'), os.path.join(entree, 'depart'))
    with open(os.path.join(entree, 'depart', 'sauvegarde', 'main'), 'wb') as f:
        f.write(pk6.avec_tete(sauvegarde, changer))
    with open(os.path.join(entree, 'journal.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(lignes)
    debut = time.time()
    out = os.path.join(dossier, 'out')
    with open(os.path.join(dossier, 'sortie.txt'), 'wb') as o:
        try:
            code = subprocess.run([RUNTIME, 'run', '--rejouer', os.path.join(entree, 'journal.txt'), '--seconds', str(secondes),
                                   '--minutes-pc', '15', '--out', out], stdout=o, stderr=subprocess.STDOUT, timeout=1200).returncode
        except subprocess.TimeoutExpired:
            code = 'temps'
    with open(os.path.join(dossier, 'sortie.txt'), encoding='utf-8', errors='replace') as f:
        arret = next((l.strip() for l in f if l.startswith('Arrêt')), '?')
    j = os.path.join(out, 'journal.txt')
    liste, branches = lancees(j) if os.path.exists(j) else ([], [])
    v = {'essai': nom, 'code': code, 'arret': arret, 'pc': round(time.time() - debut), 'lancees': liste, 'branches': branches,
         'faite': attendu(liste, branches)}
    if code == 0 and 'limite de temps' in arret:
        shutil.rmtree(entree, ignore_errors=True)
        shutil.rmtree(out, ignore_errors=True)
    with open(os.path.join(dossier, 'verdict.json'), 'w', encoding='utf-8') as f:
        json.dump(v, f, ensure_ascii=False)
    print(nom, code, v['pc'], 's', 'faite' if v['faite'] else 'NON', arret[:60], flush=True)


def tourner(sortie, secondes, travailleurs, essais):
    """`essais` : (nom, changer, attendu)."""
    os.makedirs(sortie, exist_ok=True)
    with open(os.path.join(revue_modeles.PARTIE, 'depart', 'sauvegarde', 'main'), 'rb') as f:
        sauvegarde = f.read()
    lignes = journal(secondes)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: essayer(sortie, *e, sauvegarde, lignes, secondes), essais))


def essai_capacite(c):
    return (f'{c:03d}', lambda p: pk6.changer_capacites(p, [c] * 4, PP),
            lambda liste, _: any(c in (u, appelee) and cote == 'joueur' for u, cote, appelee in liste))


def essai_tenue(k, objets, talents):
    def attendu(_, branches):
        return {('talent', talents[k], 'joueur'), ('objet tenu', objets[k], 'joueur')} <= set(branches)
    return f'{k:03d}-{talents[k]}-{objets[k]}', lambda p: pk6.changer_tenue(p, talents[k], objets[k]), attendu


def capacites(sortie, secondes, travailleurs, choisies):
    tourner(sortie, secondes, travailleurs, [essai_capacite(c) for c in choisies or range(1, DERNIERE + 1)])


def tenues(sortie, secondes, travailleurs, choisies):
    objets, talents = tables()
    tourner(sortie, secondes, travailleurs, [essai_tenue(k, objets, talents) for k in choisies or range(CASES)])


def bilan(sortie):
    with open(revue_modeles.TEXTES, 'rb') as f:
        noms = texte.decoder(garc.lire(f.read())[1][TEXTE_CAPACITES][0])
    vs = []
    for p in glob.glob(os.path.join(sortie, '*', 'verdict.json')):
        with open(p, encoding='utf-8') as f:
            vs.append(json.load(f))
    # une capacité compte aussi quand l'adversaire ou Métronome l'a lancée ; les essais d'avant la colonne « essai » ont « capacite »
    nom = {id(v): v.get('essai') or f"{v['capacite']:03d}" for v in vs}
    vues = {c for v in vs for c, _, _ in v['lancees']}
    branches = {(g, n) for v in vs for g, n, _ in v.get('branches', ())}
    print(len(vs), 'essais,', sum(v['faite'] for v in vs), 'ont porté ;', len(vues & set(range(1, DERNIERE + 1))),
          f'capacités vues sur {DERNIERE},', sum(g == 'talent' for g, _ in branches), 'talents,',
          sum(g == 'objet tenu' for g, _ in branches), 'objets tenus,', sum(g == 'objet consommé' for g, _ in branches), 'objets consommés')
    print('anormaux :', [(nom[id(v)], v['code'], v['arret'][:60]) for v in vs if v['code'] != 0 or 'limite de temps' not in v['arret']])
    ratees = sorted(nom[id(v)] for v in vs if not v['faite'])
    print('sans effet noté :', ', '.join(f"{n} {noms[int(n)]}" if '-' not in n else n for n in ratees))

def test():
    lignes = journal(40).split('\n')
    assert 'mod :' not in lignes[1] and lignes[-2].endswith('boutons tenus 0x0'), 'sans mod, et A relâché à la fin'
    heures = [float(l[1:l.index(' ms]')]) for l in lignes if ' ms]' in l]
    assert heures == sorted(heures) and heures[-1] < 40000, 'le rejeu lit les entrées dans l\'ordre'
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        chemin = os.path.join(d, 'journal.txt')
        with open(chemin, 'w', encoding='utf-8') as f:
            f.write('[ 1.000 ms] capacité : 45 par adversaire (Pokémon 12)\n[ 2.000 ms] capacité : 123 par joueur (Pokémon 0) appelée par 118\n')
            f.write('[ 3.000 ms] talent : 22 par joueur (Pokémon 0)\n[ 3.000 ms] objet tenu : 214 par joueur (Pokémon 0)\n')
        capacites_vues, branches = lancees(chemin)
        assert capacites_vues == [(45, 'adversaire', 45), (123, 'joueur', 118)]
        assert branches == [('talent', 22, 'joueur'), ('objet tenu', 214, 'joueur')]
    assert essai_capacite(118)[2](capacites_vues, branches) and not essai_capacite(45)[2](capacites_vues, branches)
    assert essai_tenue(0, [214], [22])[2]([], branches) and not essai_tenue(0, [215], [22])[2]([], branches)
    print('combats : tests ok')


if __name__ == '__main__':
    arg = sys.argv[1:]
    if not arg or arg[0] == 'test':
        test()
    elif arg[0] == 'bilan':
        bilan(arg[1])
    elif arg[0] in ('capacites', 'tenues'):
        reste, secondes, travailleurs = arg[2:], 100, 6
        for nom in ('--secondes', '--travailleurs'):
            if nom in reste:
                i = reste.index(nom)
                valeur = int(reste[i + 1])
                reste = reste[:i] + reste[i + 2:]
                secondes, travailleurs = (valeur, travailleurs) if nom == '--secondes' else (secondes, valeur)
        {'capacites': capacites, 'tenues': tenues}[arg[0]](arg[1], secondes, travailleurs, [int(c) for c in reste])
    else:
        sys.exit(__doc__)
