"""Un robot joue quelques minutes dans chaque zone : il marche au hasard et appuie sur A, pour dérouler ce qu'une zone chargée n'a pas déroulé.

    python tournee.py lancer SORTIE [--secondes 180] [--travailleurs 10] [ZONE...]   reprend là où il s'est arrêté
    python tournee.py parler SORTIE [--secondes 70] [--travailleurs 10] [ZONE...]    le joueur posé devant chaque personnage, A
    python tournee.py fouiller SORTIE [--secondes 70] [--travailleurs 10] [ZONE...]  devant chaque meuble et déclencheur : un pas au nord, A
    python tournee.py scenes SORTIE [--secondes 70] [--travailleurs 10] [ZONE...]    chaque scène d'entrée, son compteur à la bonne valeur
    python tournee.py muets SORTIE [--secondes 70] [--travailleurs 10] DOSSIER       les personnages muets de DOSSIER, scènes passées, leur drapeau inversé
    python tournee.py caches SORTIE [--secondes 70] [--travailleurs 10]              au sud de chaque objet caché, A
    python tournee.py rails SORTIE [--secondes 70] [--travailleurs 10] [ZONE...]     les personnages sur rail, de part et d'autre
    python tournee.py declencheurs SORTIE [--secondes 70] [--travailleurs 10] [ZONE...]  ceux que garde un compteur, à la bonne valeur
    python tournee.py forcer SORTIE [--secondes 70] [--travailleurs 10] ESSAIS PARLER RAILS [--tous]  chaque (zone, script)
                                                    d'ESSAIS (JSON) prêté à un personnage qui a répondu dans PARLER ou RAILS
    python tournee.py arrivees SORTIE [--secondes 70] [--travailleurs 10] [ZONE...]  chaque zone par le changement de zone
                                                    (modes d'entrée 0 et 1 de la section 1), le robot ensuite
    python tournee.py bilan SORTIE
    python tournee.py test

Chaque zone part d'une sauvegarde téléportée (teleporter.py) et rejoue un journal d'entrées fabriqué, sans fenêtre, donc une
partie se refait à l'identique. Le journal et la sortie ne restent que pour les zones anormales ; pour les autres, le verdict
et la dernière image. Rien de ceci n'est versionné : tout est écrit dans local/.
"""
import collections
import glob
import hashlib
import json
import os
import random
import re
import shutil
import struct
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import teleporter

RACINE = teleporter.RACINE
RUNTIME = os.environ.get('RUNTIME', os.path.join(RACINE, 'portage', 'target', 'release', 'runtime.exe'))
DEPART = os.path.join(RACINE, 'local', 'analyse', 'rendu', 'run-premiere-arene', 'archives-fin', 'sauvegarde')
A = 0x1
B = 0x2
PAD = 156
# Les deux appuis sur A de l'écran titre, relevés sur une vraie partie : à ces heures, le rejeu arrive à la partie sauvegardée.
TITRE = ((21838.295, A), (21939.679, 0), (24258.088, A), (24358.378, 0))
DEBUT_ROBOT_MS = 36000
CACHES = (0x547118, 151)


def entrees(graine, secondes):
    """Le journal du robot : une direction tenue, deux appuis sur A, et un B de temps en temps pour sortir d'un menu."""
    alea = random.Random(graine)
    lignes = [f'[{t:10.3f} ms] hid : boutons tenus {b:#x}' for t, b in TITRE]
    t = DEBUT_ROBOT_MS
    while t < secondes * 1000:
        pad = alea.choice(((PAD, 0), (-PAD, 0), (0, PAD), (0, -PAD)))
        lignes.append(f'[{t:10.3f} ms] hid : pad circulaire ({pad[0]}, {pad[1]})')
        t += alea.randint(300, 1500)
        lignes.append(f'[{t:10.3f} ms] hid : pad circulaire (0, 0)')
        for bouton in (A, A, B) if alea.random() < 0.2 else (A, A):
            t += 150
            lignes.append(f'[{t:10.3f} ms] hid : boutons tenus {bouton:#x}')
            t += 150
            lignes.append(f'[{t:10.3f} ms] hid : boutons tenus 0x0')
    return lignes


def entrees_parler(secondes, tenu=120, vers=PAD):
    """Se tourner vers le nord, où est le personnage, puis A sans s'arrêter : il répond, et le dialogue défile. Un nord tenu
    plus longtemps fait un pas : c'est ce qui fait entrer sur un déclencheur, et un meuble ne laisse que se tourner."""
    lignes = [f'[{t:10.3f} ms] hid : boutons tenus {b:#x}' for t, b in TITRE]
    lignes += [f'[{DEBUT_ROBOT_MS:10.3f} ms] hid : pad circulaire (0, {vers})', f'[{DEBUT_ROBOT_MS + tenu:10.3f} ms] hid : pad circulaire (0, 0)']
    t = DEBUT_ROBOT_MS + tenu + 880
    while t < secondes * 1000:
        lignes.append(f'[{t:10.3f} ms] hid : boutons tenus {A:#x}')
        lignes.append(f'[{t + 150:10.3f} ms] hid : boutons tenus 0x0')
        t += 700
    return lignes


def lire_journal(chemin):
    """Les modules chargés, les écarts notés par le moteur et les scripts lancés (zone, publiques, g_mode)."""
    modules, ecarts, scripts = set(), collections.Counter(), set()
    with open(chemin, encoding='utf-8', errors='replace') as f:
        for ligne in f:
            m = re.search(r'module : (Dll\w+) chargé', ligne)
            s = re.search(r'script : zone (\d+) publiques (\d+) g_mode (-?\d+)', ligne)
            if m:
                modules.add(m.group(1))
            elif s:
                scripts.add(tuple(int(x) for x in s.groups()))
            elif 'ÉCART' in ligne:
                ecarts[ligne.split('ÉCART : ')[1].strip()[:140]] += 1
    return sorted(modules), ecarts, sorted(scripts)


def jouer_zone(sortie, zone, porte, secondes):
    jouer(os.path.join(sortie, f'{zone:03d}'), zone, porte or (360, 0, 360), entrees(zone, secondes), secondes)


def jouer(d, zone, place, lignes, secondes, fichier=None, compteurs=None, drapeaux=None, rail=None, changement=False):
    if os.path.exists(os.path.join(d, 'verdict.json')):
        return
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(os.path.join(d, 'in', 'depart'))
    shutil.copytree(DEPART, os.path.join(d, 'in', 'depart', 'sauvegarde'))
    with open(os.path.join(DEPART, 'main'), 'rb') as f:
        depart = f.read()
    placee = teleporter.placer(depart, zone, *place, fichier=fichier, compteurs=compteurs, drapeaux=drapeaux, rail=rail,
                               changement=changement)
    with open(os.path.join(d, 'in', 'depart', 'sauvegarde', 'main'), 'wb') as f:
        f.write(placee)
    journal = os.path.join(d, 'in', 'journal.txt')
    with open(journal, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lignes) + '\n')
    debut = time.time()
    with open(os.path.join(d, 'stdout.txt'), 'wb') as o, open(os.path.join(d, 'stderr.txt'), 'wb') as e:
        try:
            code = subprocess.run([RUNTIME, 'run', '--rejouer', journal, '--dessiner', '--scale', '1', '--seconds', str(secondes),
                                   '--minutes-pc', '15', '--out', os.path.join(d, 'out')], stdout=o, stderr=e, timeout=1200).returncode
        except subprocess.TimeoutExpired:
            code = 'temps'
    v = {'zone': zone, 'dossier': os.path.basename(d), 'code': code, 'pc': round(time.time() - debut)}
    with open(os.path.join(d, 'stdout.txt'), encoding='utf-8', errors='replace') as f:
        v['arret'] = next((l.strip() for l in f if l.startswith('Arrêt')), '?')
    j = os.path.join(d, 'out', 'journal.txt')
    modules, ecarts, scripts = lire_journal(j) if os.path.exists(j) else ([], {}, [])
    v['modules'] = modules
    v['ecarts'] = dict(ecarts)
    v['scripts'] = scripts
    images = sorted(glob.glob(os.path.join(d, 'out', 'images', '*haut.png')))
    v['images'] = len(images)
    # Toutes les images identiques sur la dernière minute : un jeu figé qui ne s'arrête pas.
    derniere = []
    for p in images[-60:]:
        with open(p, 'rb') as f:
            derniere.append(hashlib.md5(f.read()).hexdigest())
    v['differentes'] = len(set(derniere))
    if images:
        shutil.copy(images[-1], os.path.join(d, 'haut.png'))
    shutil.rmtree(os.path.join(d, 'out', 'images'), ignore_errors=True)
    if code == 0 and 'limite de temps' in v['arret'] and v['differentes'] > 1:
        shutil.rmtree(os.path.join(d, 'out'), ignore_errors=True)
        shutil.rmtree(os.path.join(d, 'in'), ignore_errors=True)
    with open(os.path.join(d, 'verdict.json'), 'w', encoding='utf-8') as f:
        json.dump(v, f, ensure_ascii=False)
    print(os.path.basename(d), code, v['pc'], 's', v['differentes'], v['arret'][:90], flush=True)


def lancer(sortie, secondes, travailleurs, choisies):
    os.makedirs(sortie, exist_ok=True)
    portes = teleporter.zones()
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda z: jouer_zone(sortie, z, portes[z], secondes), choisies or range(len(portes))))


def arrivees(sortie, secondes, travailleurs, choisies):
    os.makedirs(sortie, exist_ok=True)
    portes = teleporter.zones()
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    # sans sortie ni personnage, la place par défaut de `jouer_zone`
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda z: jouer(os.path.join(sortie, f'{z:03d}'), z, portes[z] or (360, 0, 360), entrees(z, secondes), secondes,
                                    fichiers[z][0], changement=True), choisies or range(len(portes))))


def parler(sortie, secondes, travailleurs, choisies):
    os.makedirs(sortie, exist_ok=True)
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    # un seul essai par script d'une zone : plusieurs personnages en partagent souvent un
    essais = []
    for zone in choisies or range(len(fichiers)):
        vus = set()
        for script, x, z, h, _ in teleporter.personnages(fichiers[zone][0]):
            if script not in vus:
                vus.add(script)
                # sur la case au sud du personnage
                essais.append((zone, script, (x * teleporter.CASE + teleporter.CASE // 2, h, (z + 1) * teleporter.CASE + teleporter.CASE // 2)))
    print(len(essais), 'essais', flush=True)
    lignes = entrees_parler(secondes)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: jouer(os.path.join(sortie, f'{e[0]:03d}-{e[1]}'), e[0], e[2], lignes, secondes, fichiers[e[0]][0]), essais))


def fouiller(sortie, secondes, travailleurs, choisies):
    os.makedirs(sortie, exist_ok=True)
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    essais = []
    for zone in choisies or range(len(fichiers)):
        vus = set()
        for script, x, z, profondeur, h in teleporter.objets(fichiers[zone][0]):
            if script not in vus:
                vus.add(script)
                # sur la case au sud de l'objet
                essais.append((zone, script, (x * teleporter.CASE + teleporter.CASE // 2, h, (z + profondeur) * teleporter.CASE + teleporter.CASE // 2)))
    print(len(essais), 'essais', flush=True)
    lignes = entrees_parler(secondes, 700)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: jouer(os.path.join(sortie, f'{e[0]:03d}-{e[1]}'), e[0], e[2], lignes, secondes, fichiers[e[0]][0]), essais))


def declencheurs(sortie, secondes, travailleurs, choisies):
    os.makedirs(sortie, exist_ok=True)
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    with open(os.path.join(DEPART, 'main'), 'rb') as f:
        depart = f.read()
    essais = []
    for zone in choisies or range(len(fichiers)):
        for i, (script, x, z, profondeur, h, compteur, valeur) in enumerate(teleporter.declencheurs(fichiers[zone][0])):
            if struct.unpack_from('<H', depart, teleporter.COMPTEURS + (compteur - teleporter.PREMIER_COMPTEUR) * 2)[0] != valeur:
                place = (x * teleporter.CASE + teleporter.CASE // 2, h, (z + profondeur) * teleporter.CASE + teleporter.CASE // 2)
                essais.append((zone, script, i, place, {compteur: valeur}))
    print(len(essais), 'essais', flush=True)
    lignes = entrees_parler(secondes, 700)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: jouer(os.path.join(sortie, f'{e[0]:03d}-{e[1]}-{e[2]}'), e[0], e[3], lignes, secondes, fichiers[e[0]][0], e[4]), essais))


def scenes(sortie, secondes, travailleurs, choisies):
    os.makedirs(sortie, exist_ok=True)
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    essais = []
    for zone in choisies or range(len(fichiers)):
        for i, (script, compteur, valeur) in enumerate(teleporter.scenes(fichiers[zone][0])):
            essais.append((zone, script, i, compteur, valeur, teleporter.position(fichiers[zone][0]) or (360, 0, 360)))
    print(len(essais), 'essais', flush=True)
    lignes = entrees_parler(secondes)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: jouer(os.path.join(sortie, f'{e[0]:03d}-{e[1]}-{e[2]}'), e[0], e[5], lignes, secondes, fichiers[e[0]][0], {e[3]: e[4]}), essais))


def muets(sortie, secondes, travailleurs, dossier):
    """Une scène d'entrée prend la main avant le personnage : ses compteurs sont mis après leur dernière valeur. Le drapeau
    d'un personnage décide peut-être de sa présence (sens non établi : muets et parlants l'ont posé ou baissé) : il est inversé."""
    os.makedirs(sortie, exist_ok=True)
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    with open(os.path.join(DEPART, 'main'), 'rb') as f:
        depart = f.read()
    essais = []
    for p in glob.glob(os.path.join(dossier, '*', 'verdict.json')):
        with open(p, encoding='utf-8') as f:
            v = json.load(f)
        zone, script = (int(x) for x in v['dossier'].split('-')[:2])
        if any(s[0] == zone and s[2] == script for s in v['scripts']):
            continue
        compteurs = {}
        for _, compteur, valeur in teleporter.scenes(fichiers[zone][0]):
            compteurs[compteur] = max(compteurs.get(compteur, 0), valeur + 1)
        x, z, h, drapeau = next((x, z, h, d) for s, x, z, h, d in teleporter.personnages(fichiers[zone][0]) if s == script)
        drapeaux = {drapeau: not depart[teleporter.DRAPEAUX + drapeau // 8] >> (drapeau % 8) & 1} if 0 < drapeau < teleporter.NOMBRE_DRAPEAUX else {}
        essais.append((zone, script, (x * teleporter.CASE + teleporter.CASE // 2, h, (z + 1) * teleporter.CASE + teleporter.CASE // 2), compteurs, drapeaux))
    print(len(essais), 'essais', flush=True)
    lignes = entrees_parler(secondes)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: jouer(os.path.join(sortie, f'{e[0]:03d}-{e[1]}'), e[0], e[2], lignes, secondes, fichiers[e[0]][0], e[3], e[4]), essais))


def lire_caches(code):
    """La table des objets cachés lue par 0x4ad2dc : (zone, script, case X, hauteur, case Z). 14 octets par objet : script
    moins 8000 à +0, X, hauteur, Z à +4, zone à +0xA."""
    rendu = []
    for i in range(CACHES[1]):
        numero, _, x, h, z, zone = struct.unpack_from('<HHHhHH', code, CACHES[0] - 0x100000 + i * 14)
        rendu.append((zone, 8000 + numero, x, h, z))
    return rendu


def caches(sortie, secondes, travailleurs, _):
    os.makedirs(sortie, exist_ok=True)
    with open(os.path.join(RACINE, 'local', 'extrait', 'maj', 'exefs', 'code.bin'), 'rb') as f:
        essais = lire_caches(f.read())
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    print(len(essais), 'essais', flush=True)
    lignes = entrees_parler(secondes)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: jouer(os.path.join(sortie, f'{e[0]:03d}-{e[1]}'), e[0],
                                    (e[2] * teleporter.CASE + teleporter.CASE // 2, e[3], (e[4] + 1) * teleporter.CASE + teleporter.CASE // 2),
                                    lignes, secondes, fichiers[e[0]][0]), essais))


def rails(sortie, secondes, travailleurs, choisies):
    """Essayé sur la zone 63 : d'un côté du personnage (côté + 1 ou - 1), le regard vers lui, il répond. Le sens du côté
    s'inverse peut-être avec la clé (0x5483f4, supposé) : les deux essais couvrent les deux cas."""
    os.makedirs(sortie, exist_ok=True)
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    essais = []
    for zone in choisies or range(len(fichiers)):
        vus = set()
        for script, ligne, cle, front, cote in teleporter.personnages_rail(fichiers[zone][0]):
            if script not in vus:
                vus.add(script)
                essais += [(zone, script, i, (ligne, cle, front, cote + pas), vers) for i, (pas, vers) in enumerate(((1, -PAD), (-1, PAD)))]
    print(len(essais), 'essais', flush=True)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: jouer(os.path.join(sortie, f'{e[0]:03d}-{e[1]}-{e[2]}'), e[0], (0, 0, 0), entrees_parler(secondes, vers=e[4]), secondes, fichiers[e[0]][0], rail=e[3]), essais))


COTES = ((1, -PAD), (-1, PAD))


def personnes(fichier):
    """Les personnages d'un fichier de zone que le bloc 10 peut porter : (indice, script, sur rail, champs de +0x28)."""
    d = teleporter.lz11.decompresser(fichier) if fichier[0] == 0x11 else fichier
    if d[:2] != b'ZO':
        return []
    debut, _ = struct.unpack_from('<II', d, 8)
    meubles, nombre = d[debut + 4:debut + 6]
    rendu = []
    for i in range(min(nombre, teleporter.PERSONNAGES[2] // teleporter.ENREGISTREMENT - 1)):
        q = debut + 0xC + meubles * 0x14 + i * 0x30
        rendu.append((i, struct.unpack_from('<H', d, q + 0xA)[0], d[q + 0x24] == 1, d[q + 0x28:q + 0x30]))
    return rendu


def repondants(fichiers, parler_dossier, rails_dossier, tous=False):
    """Pour chaque zone, où se poser pour parler à un personnage : (indice, place, rail, sens du pad). D'abord ceux qui ont
    répondu dans les tournées `parler` et `rails`, puis, à défaut, le premier personnage hors rail de la zone, même sans
    script (aucun n'a répondu : caché, ou mal placé ; on essaie quand même). `tous` : chaque personnage hors rail de la zone
    vient ensuite, pour les scripts que le premier n'a pas lancés, puis chaque personnage sur rail, des deux côtés."""
    rendu = collections.defaultdict(list)

    def sud(champs):
        x, z, h = struct.unpack('<HHf', champs)
        return (x * teleporter.CASE + teleporter.CASE // 2, h, (z + 1) * teleporter.CASE + teleporter.CASE // 2)

    for dossier in (parler_dossier, rails_dossier):
        for p in sorted(glob.glob(os.path.join(dossier, '*', 'verdict.json'))):
            with open(p, encoding='utf-8') as f:
                v = json.load(f)
            zone, script, *cote = map(int, v['dossier'].split('-'))
            if [zone, 3, script] not in v['scripts']:
                continue
            for i, s, rail, champs in personnes(fichiers[zone][0]):
                if s != script or rail != bool(cote):
                    continue
                if cote:
                    ligne, front, c, cle = struct.unpack('<IhbB', champs)
                    pas, vers = COTES[cote[0]]
                    rendu[zone].append((i, (0, 0, 0), (ligne, cle, front, c + pas), vers))
                else:
                    rendu[zone].append((i, sud(champs), None, PAD))
                break
    for zone, (fichier, *_) in enumerate(fichiers):
        if tous or not rendu[zone]:
            deja = {e[0] for e in rendu[zone]}
            rendu[zone] += [(i, sud(champs), None, PAD) for i, _, rail, champs in personnes(fichier) if not rail and i not in deja]
            rendu[zone] = rendu[zone][:None if tous else 1]
        if tous:
            # sur rail, des deux côtés (zone 69 : sa scène d'entrée avait pris la main pendant la tournée `rails`)
            for i, _, rail, champs in personnes(fichier):
                if rail and i not in {e[0] for e in rendu[zone] if e[2]}:
                    ligne, front, c, cle = struct.unpack('<IhbB', champs)
                    rendu[zone] += [(i, (0, 0, 0), (ligne, cle, front, c + pas), vers) for pas, vers in COTES]
    return rendu


def forcer(sortie, secondes, travailleurs, essais, parler_dossier, rails_dossier, tous=False):
    """Un script qu'aucune entité ne désigne (ou qu'aucune n'a lancé) est prêté à un personnage qui répond : on lui parle.
    Le script tourne alors hors de son contexte d'origine ; il compte comme déroulé sans dire que son vrai déclencheur l'est.
    Un personnage venu d'une autre zone ne se prête pas : recopié dans le bloc 10, il fait tomber le jeu sur un écran noir
    (essayé sur les zones 5, 14, 89 et 107). `tous` : chaque personnage de la zone essayé, dossiers ZONE-SCRIPT-K. Les scènes
    d'entrée de la zone sont désamorcées (leur compteur à la valeur suivante) : sinon la scène prend la main à l'arrivée et le
    personnage ne parle plus (vu sur les zones 14, 89, 107, 182, 192 et 262, où le script 1 tournait à la place)."""
    os.makedirs(sortie, exist_ok=True)
    with open(teleporter.ZONES, 'rb') as f:
        _, fichiers = teleporter.garc.lire(f.read())
    with open(essais, encoding='utf-8') as f:
        demandes = json.load(f)
    pretes = repondants(fichiers, parler_dossier, rails_dossier, tous)
    travail = []
    for zone, script in demandes:
        if not pretes[zone]:
            print('zone', zone, ': aucun personnage, script', script, 'laissé', flush=True)
            continue
        for k, (i, place, rail, vers) in enumerate(pretes[zone] if tous else pretes[zone][:1]):
            nom = f'{zone:03d}-{script}' + (f'-{k}' if k else '')
            calmes = {c: v + 1 for s, c, v in teleporter.scenes(fichiers[zone][0]) if s != script}
            travail.append((nom, zone, place, teleporter.preter(fichiers[zone][0], i, script), rail, entrees_parler(secondes, vers=vers),
                            calmes))
    print(len(travail), 'essais', flush=True)
    with ThreadPoolExecutor(travailleurs) as ex:
        list(ex.map(lambda e: jouer(os.path.join(sortie, e[0]), e[1], e[2], e[5], secondes, e[3], e[6], rail=e[4]), travail))


def bilan(sortie):
    vs = []
    for p in glob.glob(os.path.join(sortie, '*', 'verdict.json')):
        with open(p, encoding='utf-8') as f:
            vs.append(json.load(f))
    print(len(vs), 'zones')
    print('arrêts :')
    for arret, n in collections.Counter(re.sub(r'\(.*?\)', '', v['arret'])[:90] for v in vs).most_common():
        print(f'  {n:4} {arret}')
    print('figées (image identique sur la dernière minute) :', sorted(v['zone'] for v in vs if v['differentes'] <= 1))
    print('anormales :')
    for v in sorted(vs, key=lambda v: v['zone']):
        if v['code'] != 0 or 'limite de temps' not in v['arret']:
            print(f"  {v['zone']:3} code {v['code']} {v['arret'][:120]}")
    print('modules :', ' '.join(sorted({m for v in vs for m in v['modules']})))
    ecarts = collections.Counter()
    for v in vs:
        ecarts.update(v['ecarts'])
    print('écarts :', ecarts.most_common(20))
    print(f'scripts de zone lancés : {len({(s[0], s[2]) for v in vs for s in v.get("scripts", ()) if s[1] == 3})}')
    # chaque essai de « parler » et de « fouiller » porte zone-script dans son nom : a-t-il lancé le script visé ?
    essais = [(int(m.group(1)), int(m.group(2)), v) for v, m in ((v, re.match(r'(\d+)-(\d+)(?:-\d+)?$', v.get('dossier', ''))) for v in vs) if m]
    if essais:
        print(f'personnages qui ont répondu : {sum(any(s[0] == z and s[2] == c for s in v["scripts"]) for z, c, v in essais)} / {len(essais)}')


def test():
    a = entrees(7, 60)
    assert a == entrees(7, 60) and a != entrees(8, 60)
    heures = [float(re.match(r'\[\s*([\d.]+) ms\]', l).group(1)) for l in a]
    assert heures == sorted(heures), 'le rejeu lit les entrées dans l\'ordre'
    assert heures[-1] < 61000 and heures[4] == DEBUT_ROBOT_MS
    assert a[-1].endswith('0x0'), 'le robot ne finit pas un bouton tenu'
    b = [float(re.match(r'\[\s*([\d.]+) ms\]', l).group(1)) for l in entrees_parler(60)]
    assert b == sorted(b)
    table = bytearray(CACHES[0] - 0x100000 + 14 * CACHES[1])
    struct.pack_into('<6H', table, CACHES[0] - 0x100000 + 14, 9, 3, 40, 36, 50, 53)
    assert lire_caches(bytes(table))[1] == (53, 8009, 40, 36, 50)
    assert f'pad circulaire (0, {-PAD})' in entrees_parler(60, vers=-PAD)[4]
    # deux zones fabriquées : la 0, un personnage sans script et un sur rail qui a répondu ; la 1, un seul, jamais essayé
    import tempfile
    entites = bytearray(0xC + 2 * 0x30)
    entites[5] = 2
    struct.pack_into('<HHf', entites, 0xC + 0x28, 3, 4, 36.0)
    struct.pack_into('<H', entites, 0xC + 0x30 + 0xA, 12)
    entites[0xC + 0x30 + 0x24] = 1
    struct.pack_into('<IhbB', entites, 0xC + 0x30 + 0x28, 0x305AC3B, 3, -8, 1)
    zone = b'ZO' + bytes(6) + struct.pack('<II', 16, 16 + len(entites)) + bytes(entites)
    assert [p[:3] for p in personnes(zone)] == [(0, 0, False), (1, 12, True)]
    with tempfile.TemporaryDirectory() as racine:
        os.makedirs(os.path.join(racine, 'rails', '000-12-1'))
        with open(os.path.join(racine, 'rails', '000-12-1', 'verdict.json'), 'w') as f:
            json.dump({'dossier': '000-12-1', 'scripts': [[0, 3, 12]]}, f)
        pretes = repondants([[zone], [zone]], os.path.join(racine, 'parler'), os.path.join(racine, 'rails'))
        assert [e[0] for e in repondants([[zone]], os.path.join(racine, 'parler'), os.path.join(racine, 'rails'), True)[0]] == [1, 0], 'tous : le rail qui répond, puis les autres (sauf lui)'
    assert pretes[0] == [(1, (0, 0, 0), (0x305AC3B, 1, 3, -9), PAD)], 'le côté - 1, le pad vers +PAD'
    assert pretes[1] == [(0, (63, 36.0, 99), None, PAD)], 'à défaut, au sud du premier personnage hors rail'
    pas = entrees_parler(60, 700)
    assert 'pad circulaire (0, 0)' in pas[5] and pas[5].startswith(f'[{DEBUT_ROBOT_MS + 700:10.3f}'), 'le pas se tient 700 ms'


if __name__ == '__main__':
    arg = sys.argv[1:]
    if not arg or arg[0] == 'test':
        test()
        print('ok  tournee')
    elif arg[0] == 'bilan':
        bilan(arg[1])
    elif arg[0] in ('lancer', 'parler', 'fouiller', 'scenes', 'muets', 'caches', 'rails', 'declencheurs', 'forcer', 'arrivees'):
        reste, secondes, travailleurs = arg[2:], 180 if arg[0] == 'lancer' else 70, 10
        for nom in ('--secondes', '--travailleurs'):
            if nom in reste:
                i = reste.index(nom)
                valeur = int(reste[i + 1])
                reste = reste[:i] + reste[i + 2:]
                if nom == '--secondes':
                    secondes = valeur
                else:
                    travailleurs = valeur
        if arg[0] == 'muets':
            muets(arg[1], secondes, travailleurs, reste[0])
        elif arg[0] == 'forcer':
            forcer(arg[1], secondes, travailleurs, reste[0], reste[1], reste[2], '--tous' in reste)
        else:
            {'lancer': lancer, 'parler': parler, 'fouiller': fouiller, 'scenes': scenes, 'caches': caches, 'rails': rails, 'declencheurs': declencheurs,
             'arrivees': arrivees}[arg[0]](arg[1], secondes, travailleurs, [int(z) for z in reste])
    else:
        sys.exit(__doc__)
