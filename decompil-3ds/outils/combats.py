"""Chaque capacité du jeu lancée une fois en combat, dans le vrai moteur : ce qui mesure les capacités déroulées.

    python combats.py capacites SORTIE [--travailleurs 6] [--secondes 100] [--format double] [CAPACITE...]
    python combats.py tenues SORTIE [--travailleurs 6] [--secondes 100] [K...]   talent et objet tenu de la case K des tables
    python combats.py dresseurs SORTIE [--travailleurs 6] [--secondes 300] [N...]   chaque dresseur du jeu, à la place du 86
    python combats.py bilan SORTIE
    python combats.py test

Pour chaque capacité, on rejoue la partie de `revue_modeles.PARTIE` jusqu'au combat contre le dresseur 86, avec une sauvegarde
où le Pokémon de tête porte cette capacité dans ses quatre emplacements ; puis A, encore et encore : Attaque, puis la capacité,
quel que soit l'emplacement sous le curseur. Le runtime note chaque capacité lancée (« capacité : N par joueur… », guet de
DllBattle+0x1fc58, local/analyse/DllBattle/capacites.md). Une capacité notée a tourné ; qu'elle ait réussi n'est pas jugé.
Les talents et les objets tenus de même (« talent : N », « objet tenu : N », branchés à l'entrée en combat ; « objet consommé :
N »), local/analyse/DllBattle/talents.md : l'essai K donne au Pokémon de tête la case K de chacune des deux tables de 182
gestionnaires de DllBattle. Le combat lit l'octet du talent lui-même : un talent que l'espèce n'a pas est accepté.
`dresseurs` : un mod met les données et l'équipe du dresseur N (`a/0/3/8`, `a/0/4/0`) à la place de celles du 86 ; notre
Pokémon de tête, niveau 100 à 999 partout, quatre Frappe Atlas et Querelleur (dégâts = niveau, Spectres compris), comme chacun de
ses équipiers, au style « Défini » et sans animations, doit gagner. L'essai porte si le combat finit (DllBattle déchargé) :
chaque équipe, chaque format et chaque fin de combat (local/analyse/pokemon-x/dresseurs.md). Une défaite déchargerait
aussi DllBattle : supposée exclue à 999 PV. Le combat garde la mise en place du 86 (un seul Pokémon de notre côté) : en
double, si un tour finit sans que les deux adverses tombent, l'écran de l'équipe s'ouvre et ne rend plus la main
(dresseur 424 ; supposé : le jeu attend un second Pokémon), l'essai ne porte pas.
`--format` double, triple ou rotation : le même combat, changé par le mod de `local/analyse/rendu/mods-test/build-FORMAT`
(octet 2 du dresseur 86 ; notre Pokémon de tête est le seul à porter la capacité essayée).
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
import tournee

RUNTIME = os.environ.get('RUNTIME', revue_modeles.RUNTIME)
TEXTE_CAPACITES = 13
# DllBattle : les tables des gestionnaires d'objets tenus et de talents, 182 cases de 8 octets (numéro, fonction)
MODULE = os.path.join(revue_modeles.RACINE, 'local', 'extrait', 'maj', 'romfs', 'DllBattle.cro')
TABLES = (0xD3848, 0xD5128)
CASES = 182
DERNIERE = 617
# Les PP donnés à la capacité essayée ; assez pour un combat, la mesure ne regarde pas le compte
PP = 5
# le combat attend devant son menu à 27 s (revue_modeles.journal_de_depart)
PREMIER_A_MS = 28000
PAS_A_MS = 700
DONNEES_DRESSEURS = os.path.join(revue_modeles.RACINE, 'local', 'extrait', 'romfs', 'a', '0', '3', '8')
FRAPPE_ATLAS, QUERELLEUR = 69, 113
# Les réglages : bloc 23 de la sauvegarde, à 0x16200 (PKHeX, SaveBlockAccessor6XY et ConfigSave6) ; octet 0, bit 2 animations
# coupées, bit 3 style « Défini ». En style « Choix », le jeu demande s'il faut changer de Pokémon quand le dresseur en envoie
# un autre, A y dit oui, et l'écran de l'équipe ne rend plus la main (dresseur 1).
REGLAGES, BLOC_REGLAGES = 0x16200, 23


def combat_rapide(sauvegarde, changer):
    """La sauvegarde au style « Défini », sans animations, chaque Pokémon de l'équipe (le compte u8 suit les six places) passé
    par `changer` : Cyclone ou Hurlement font entrer un équipier, qui doit tenir aussi (dresseur 84 : Salamèche K.O., le
    curseur reste sur lui et A ne choisit rien). Réduire le compte à 1 n'y change rien."""
    copie = bytearray(sauvegarde)
    copie[REGLAGES] |= 0x0C
    for i in range(copie[pk6.EQUIPE + 6 * pk6.TAILLE]):
        debut = pk6.EQUIPE + i * pk6.TAILLE
        copie[debut:debut + pk6.TAILLE] = changer(sauvegarde[debut:debut + pk6.TAILLE])
    pk6.teleporter.refaire_crc(copie, BLOC_REGLAGES, REGLAGES)
    pk6.teleporter.refaire_crc(copie, pk6.BLOC_EQUIPE, pk6.EQUIPE)
    return bytes(copie)
FORMATS = ('simple', 'double', 'triple', 'rotation')


def mod_du_format(format):
    return None if format == 'simple' else os.path.join(revue_modeles.RACINE, 'local', 'analyse', 'rendu', 'mods-test', f'build-{format}', 'pc')


def journal(secondes, mod=None):
    """Les entrées jusqu'au combat, puis A toutes les 700 ms."""
    lignes = revue_modeles.journal_de_depart(mod).rstrip('\n').split('\n')
    t = PREMIER_A_MS
    while t + 150 < secondes * 1000:
        lignes += [f'[{t:10.3f} ms] hid : boutons tenus 0x1', f'[{t + 150:10.3f} ms] hid : boutons tenus 0x0']
        t += PAS_A_MS
    return '\n'.join(lignes) + '\n'


def lancees(chemin):
    """Ce que le journal note du combat : les capacités (capacité, joueur ou adversaire, appelée par), les talents et objets
    (genre, numéro, joueur ou adversaire), et si le combat a fini (DllBattle déchargé)."""
    capacites, branches, fini = [], [], False
    with open(chemin, encoding='utf-8', errors='replace') as f:
        for ligne in f:
            fini = fini or 'module : DllBattle déchargé' in ligne
            m = re.search(r'capacité : (\d+) par (\w+) \(Pokémon \d+\)(?: appelée par (\d+))?', ligne)
            b = re.search(r'(talent|objet tenu|objet consommé) : (\d+) par (\w+) \(Pokémon', ligne)
            if m:
                capacites.append((int(m.group(1)), m.group(2), int(m.group(3) or m.group(1))))
            elif b:
                branches.append((b.group(1), int(b.group(2)), b.group(3)))
    return capacites, branches, fini


def tables():
    """(objets tenus, talents) que DllBattle sait brancher."""
    with open(MODULE, 'rb') as f:
        donnees = f.read()
    return tuple([struct.unpack_from('<I', donnees, t + 8 * i)[0] for i in range(CASES)] for t in TABLES)


def essayer(sortie, nom, changer, attendu, sauvegarde, lignes, secondes, rapide=False):
    """Une partie : le Pokémon de tête passé par `changer` ; `attendu(capacités, branches)` dit si l'essai a porté."""
    dossier = os.path.join(sortie, nom)
    if os.path.exists(os.path.join(dossier, 'verdict.json')):
        return
    shutil.rmtree(dossier, ignore_errors=True)
    entree = os.path.join(dossier, 'in')
    shutil.copytree(os.path.join(revue_modeles.PARTIE, 'depart'), os.path.join(entree, 'depart'))
    with open(os.path.join(entree, 'depart', 'sauvegarde', 'main'), 'wb') as f:
        f.write(combat_rapide(sauvegarde, changer) if rapide else pk6.avec_tete(sauvegarde, changer))
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
    liste, branches, fini = lancees(j) if os.path.exists(j) else ([], [], False)
    v = {'essai': nom, 'code': code, 'arret': arret, 'pc': round(time.time() - debut), 'lancees': liste, 'branches': branches,
         'fini': fini, 'faite': attendu(liste, branches, fini)}
    if code == 0 and 'limite de temps' in arret:
        shutil.rmtree(entree, ignore_errors=True)
        shutil.rmtree(out, ignore_errors=True)
    with open(os.path.join(dossier, 'verdict.json'), 'w', encoding='utf-8') as f:
        json.dump(v, f, ensure_ascii=False)
    print(nom, code, v['pc'], 's', 'faite' if v['faite'] else 'NON', arret[:60], flush=True)


def tourner(sortie, secondes, travailleurs, essais, format='simple'):
    """`essais` : (nom, changer, attendu), ou (nom, changer, attendu, mod) pour un combat de dresseur, qui a son mod."""
    os.makedirs(sortie, exist_ok=True)
    with open(os.path.join(revue_modeles.PARTIE, 'depart', 'sauvegarde', 'main'), 'rb') as f:
        sauvegarde = f.read()
    lignes = journal(secondes, mod_du_format(format))
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: essayer(sortie, *e[:3], sauvegarde, journal(secondes, e[3]), secondes, True) if len(e) > 3
                    else essayer(sortie, *e, sauvegarde, lignes, secondes), essais))


def fort(p):
    p = pk6.changer_niveau(pk6.changer_capacites(p, [FRAPPE_ATLAS] * 4, 20), 100, 999)
    return pk6.changer_tenue(p, QUERELLEUR, 0)


def essai_dresseur(n, sortie, donnees, equipes):
    """Le dresseur n à la place du 86 : son mod est fait ici, dans `sortie/mods`."""
    d, e = list(donnees), list(equipes)
    d[revue_modeles.DRESSEUR], e[revue_modeles.DRESSEUR] = donnees[n], equipes[n]
    mod = tournee.mod_fichiers(os.path.join(sortie, 'mods', f'd{n:03d}'), {'a/0/3/8': garc.ecrire(d), 'a/0/4/0': garc.ecrire(e)})
    return f'd{n:03d}', fort, lambda _l, _b, fini: fini, os.path.abspath(mod)


def dresseurs(sortie, secondes, travailleurs, choisies):
    with open(DONNEES_DRESSEURS, 'rb') as f:
        donnees = garc.lire(f.read())[1]
    with open(revue_modeles.EQUIPES, 'rb') as f:
        equipes = garc.lire(f.read())[1]
    # l'octet 3 compte les Pokémon : le dresseur 0 n'en a pas ; un verdict déjà là n'est pas rejoué (son mod n'est pas refait)
    tourner(sortie, secondes, travailleurs, [essai_dresseur(n, sortie, donnees, equipes) for n in choisies or range(len(donnees))
                                             if donnees[n][0][3] and not os.path.exists(os.path.join(sortie, f'd{n:03d}', 'verdict.json'))])


# Éructation ne se lance qu'après une Baie mangée : la Baie Sitrus (158, texte 96 des objets), tenue à la moitié des PV, part
# dès l'entrée (à 1 PV, le Pokémon tombe avant d'agir)
ERUCTATION, SITRUS = 562, 158


def essai_capacite(c):
    def changer(p):
        p = pk6.changer_capacites(p, [c] * 4, PP)
        return pk6.changer_pv(pk6.changer_tenue(p, pk6.tenue(p)[0], SITRUS), pk6.pv_max(p) // 2) if c == ERUCTATION else p
    return (f'{c:03d}', changer,
            lambda liste, _b, _f: any(c in (u, appelee) and cote == 'joueur' for u, cote, appelee in liste))


def essai_tenue(k, objets, talents):
    def attendu(_, branches, _f):
        return {('talent', talents[k], 'joueur'), ('objet tenu', objets[k], 'joueur')} <= set(branches)
    return f'{k:03d}-{talents[k]}-{objets[k]}', lambda p: pk6.changer_tenue(p, talents[k], objets[k]), attendu


def capacites(sortie, secondes, travailleurs, choisies, format='simple'):
    tourner(sortie, secondes, travailleurs, [essai_capacite(c) for c in choisies or range(1, DERNIERE + 1)], format)


def tenues(sortie, secondes, travailleurs, choisies, format='simple'):
    objets, talents = tables()
    tourner(sortie, secondes, travailleurs, [essai_tenue(k, objets, talents) for k in choisies or range(CASES)], format)


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
    print('sans effet noté :', ', '.join(f"{n} {noms[int(n)]}" if n.isdigit() else n for n in ratees))

def test():
    import tempfile
    # le journal de départ est fabriqué : les tests ne lisent rien de local/
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, 'journal.txt'), 'w', encoding='utf-8') as f:
            f.write('[     0.000 ms] horloge au départ : 0\n[  1000.000 ms] hid : boutons tenus 0x1\n'
                    '[  1100.000 ms] hid : boutons tenus 0x0\n[ 99000.000 ms] hid : boutons tenus 0x1\n')
        partie, revue_modeles.PARTIE = revue_modeles.PARTIE, d
        try:
            lignes = journal(40).split('\n')
            avec_mod = journal(40, 'M').split('\n')
        finally:
            revue_modeles.PARTIE = partie
    assert 'mod :' not in lignes[1] and lignes[-2].endswith('boutons tenus 0x0'), 'sans mod, et A relâché à la fin'
    assert avec_mod[1] == '[     0.000 ms] mod : M'
    assert mod_du_format('double').endswith(os.path.join('build-double', 'pc')) and mod_du_format('simple') is None
    heures = [float(l[1:l.index(' ms]')]) for l in lignes if ' ms]' in l]
    assert heures == sorted(heures) and heures[-1] < 40000, 'le rejeu lit les entrées dans l\'ordre'
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        chemin = os.path.join(d, 'journal.txt')
        with open(chemin, 'w', encoding='utf-8') as f:
            f.write('[ 1.000 ms] capacité : 45 par adversaire (Pokémon 12)\n[ 2.000 ms] capacité : 123 par joueur (Pokémon 0) appelée par 118\n')
            f.write('[ 3.000 ms] talent : 22 par joueur (Pokémon 0)\n[ 3.000 ms] objet tenu : 214 par joueur (Pokémon 0)\n')
        capacites_vues, branches, _ = lancees(chemin)
        assert capacites_vues == [(45, 'adversaire', 45), (123, 'joueur', 118)]
        assert branches == [('talent', 22, 'joueur'), ('objet tenu', 214, 'joueur')]
    assert essai_capacite(118)[2](capacites_vues, branches, False) and not essai_capacite(45)[2](capacites_vues, branches, False)
    assert essai_tenue(0, [214], [22])[2]([], branches, False) and not essai_tenue(0, [215], [22])[2]([], branches, False)
    # les réglages et l'équipe d'une sauvegarde fabriquée, et leurs CRC
    sauvegarde = bytearray(pk6.teleporter.TAILLE)
    for bloc, longueur in ((BLOC_REGLAGES, 4), (pk6.BLOC_EQUIPE, 0x61C)):
        struct.pack_into('<I', sauvegarde, pk6.teleporter.PIED + 0x14 + bloc * 8, longueur)
    sauvegarde[REGLAGES], sauvegarde[pk6.EQUIPE + 6 * pk6.TAILLE] = 0x31, 3
    rendu = combat_rapide(bytes(sauvegarde), lambda p: bytes([7]) * len(p))
    assert rendu[REGLAGES] == 0x3D and rendu[pk6.EQUIPE + 6 * pk6.TAILLE] == 3
    assert set(rendu[pk6.EQUIPE:pk6.EQUIPE + 3 * pk6.TAILLE]) == {7} and not any(rendu[pk6.EQUIPE + 3 * pk6.TAILLE:pk6.EQUIPE + 6 * pk6.TAILLE])
    for bloc, debut, longueur in ((BLOC_REGLAGES, REGLAGES, 4), (pk6.BLOC_EQUIPE, pk6.EQUIPE, 0x61C)):
        assert struct.unpack_from('<H', rendu, pk6.teleporter.PIED + 0x14 + bloc * 8 + 6) == \
            (pk6.teleporter.crc16(rendu[debut:debut + longueur]),)
    # un dresseur : ses deux entrées passent à la place du 86, les autres ne bougent pas
    with tempfile.TemporaryDirectory() as d:
        donnees = [[bytes([0, 1, 0, 1]) + bytes(16)] for _ in range(revue_modeles.DRESSEUR + 2)]
        donnees[-1] = [bytes([0, 9, 2, 3]) + bytes(16)]
        equipes = [[bytes(8)] for _ in donnees]
        equipes[-1] = [bytes(range(24))]
        nom, _, attendu, mod = essai_dresseur(len(donnees) - 1, d, donnees, equipes)
        assert nom == 'd%03d' % (len(donnees) - 1) and attendu([], [], True) and not attendu([], [], False)
        with open(os.path.join(mod, 'romfs', 'a', '0', '4', '0'), 'rb') as f:
            e = garc.lire(f.read())[1]
        with open(os.path.join(mod, 'overlay.json'), encoding='utf-8') as f:
            assert set(json.load(f)['files']) == {'a/0/3/8', 'a/0/4/0'}
        assert e[revue_modeles.DRESSEUR] == [bytes(range(24))] and e[-1] == [bytes(range(24))] and e[0] == [bytes(8)]
    print('combats : tests ok')


if __name__ == '__main__':
    arg = sys.argv[1:]
    if not arg or arg[0] == 'test':
        test()
    elif arg[0] == 'bilan':
        bilan(arg[1])
    elif arg[0] in ('capacites', 'tenues', 'dresseurs'):
        reste = arg[2:]
        options = {'--secondes': '300' if arg[0] == 'dresseurs' else '100', '--travailleurs': '6', '--format': 'simple'}
        for nom in options:
            if nom in reste:
                i = reste.index(nom)
                options[nom] = reste[i + 1]
                reste = reste[:i] + reste[i + 2:]
        if arg[0] == 'dresseurs' and options['--format'] != 'simple':
            sys.exit('dresseurs : le format est celui des données du dresseur')
        if options['--format'] not in FORMATS:
            sys.exit(f"format inconnu : {options['--format']} ({', '.join(FORMATS)})")
        if arg[0] == 'dresseurs':
            dresseurs(arg[1], int(options['--secondes']), int(options['--travailleurs']),
                      [int(c) for c in reste])
        else:
            {'capacites': capacites, 'tenues': tenues}[arg[0]](arg[1], int(options['--secondes']), int(options['--travailleurs']),
                                                             [int(c) for c in reste], options['--format'])
    else:
        sys.exit(__doc__)
