"""Déballe les outils téléchargés dans local/telechargements/ vers local/outils/, et récupère les scripts Ghidra 3DS.

    python installer.py

Attend les zips de ctrtool, makerom et Ghidra (voir README). devkitPro a un installateur graphique
et n'est pas géré ici.
"""
import os
import shutil
import subprocess
import sys
import zipfile

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(RACINE, 'local')
TELE = os.path.join(LOCAL, 'telechargements')
OUTILS = os.path.join(LOCAL, 'outils')


def deballer(prefixe, cible):
    zips = sorted(n for n in os.listdir(TELE) if n.startswith(prefixe) and n.endswith('.zip')) if os.path.isdir(TELE) else []
    if not zips:
        print('%-10s rien à déballer (pas de zip %s* dans local/telechargements/)' % (prefixe, prefixe))
        return
    chemin = os.path.join(TELE, zips[-1])
    if os.path.getsize(chemin) < 10000:
        print('%-10s %s fait %d octets : téléchargement raté, à refaire' % (prefixe, zips[-1], os.path.getsize(chemin)))
        return
    dest = os.path.join(OUTILS, cible)
    marque = os.path.join(dest, '.deballe-depuis')
    if os.path.isfile(marque) and open(marque, encoding='utf-8').read().strip() == zips[-1]:
        print('%-10s déjà déballé (%s)' % (prefixe, zips[-1]))
        return
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)
    with zipfile.ZipFile(chemin) as z:
        z.extractall(dest)
    # Ghidra se déballe dans un sous-dossier ghidra_x.y.z_PUBLIC : on le remonte d'un cran.
    contenu = os.listdir(dest)
    if len(contenu) == 1 and os.path.isdir(os.path.join(dest, contenu[0])):
        seul = os.path.join(dest, contenu[0])
        for n in os.listdir(seul):
            shutil.move(os.path.join(seul, n), dest)
        os.rmdir(seul)
    with open(marque, 'w', encoding='utf-8') as f:
        f.write(zips[-1] + '\n')
    print('%-10s déballé dans local/outils/%s' % (prefixe, cible))


SCRIPTS_3DS = ['Label3dsSVCs.py', 'Label3dsHandles.py', 'Label3dsCTRFns.py', 'Set3dsTlsType.py']


def scripts_ghidra():
    dest = os.path.join(OUTILS, 'ghidra-scripts')
    if os.path.isdir(os.path.join(dest, '.git')):
        print('%-10s déjà là' % 'scripts')
    elif shutil.which('git') is None:
        print('%-10s git absent, cloner à la main https://github.com/zaksabeast/3ds-Ghidra-Scripts' % 'scripts')
        return
    else:
        os.makedirs(OUTILS, exist_ok=True)
        code = subprocess.call(['git', 'clone', '--depth', '1', 'https://github.com/zaksabeast/3ds-Ghidra-Scripts', dest])
        print('%-10s %s' % ('scripts', 'clonés' if code == 0 else 'clone raté (code %d)' % code))
        if code:
            return
    # Les scripts sont écrits pour Jython (Python 2). Ghidra 12 lance les .py avec PyGhidra par défaut,
    # sauf si le script annonce son moteur en tête : on ajoute cette ligne.
    for nom in SCRIPTS_3DS:
        chemin = os.path.join(dest, nom)
        if not os.path.isfile(chemin):
            continue
        with open(chemin, encoding='utf-8') as f:
            texte = f.read()
        if '@runtime Jython' not in texte:
            with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
                f.write('# @runtime Jython\n' + texte)
    print('%-10s en-tête « @runtime Jython » posé sur les quatre scripts' % '')


def jython():
    """Ghidra 12 ne livre plus Jython actif : l'extension est dans Extensions/Ghidra/, on la déballe dans Ghidra/Extensions/."""
    ghidra = os.path.join(OUTILS, 'ghidra')
    source = os.path.join(ghidra, 'Extensions', 'Ghidra')
    cible = os.path.join(ghidra, 'Ghidra', 'Extensions')
    if os.path.isdir(os.path.join(cible, 'Jython')):
        print('%-10s déjà installé' % 'jython')
        return
    zips = [n for n in os.listdir(source)] if os.path.isdir(source) else []
    zips = [n for n in zips if n.endswith('_Jython.zip')]
    if not zips:
        print('%-10s extension absente de %s' % ('jython', source))
        return
    os.makedirs(cible, exist_ok=True)
    with zipfile.ZipFile(os.path.join(source, zips[0])) as z:
        z.extractall(cible)
    print('%-10s extension déballée dans Ghidra/Extensions/Jython' % 'jython')


if __name__ == '__main__':
    os.makedirs(OUTILS, exist_ok=True)
    deballer('ctrtool', 'ctrtool')
    deballer('makerom', 'makerom')
    deballer('ghidra', 'ghidra')
    jython()
    scripts_ghidra()
    print('\nPuis : python outils/verifier.py')
