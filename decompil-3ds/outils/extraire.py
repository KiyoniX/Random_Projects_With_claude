"""Sépare un dump déchiffré en code (exefs) et fichiers (romfs) avec ctrtool, puis inventorie le romfs.

    python extraire.py local/dump/pokemon-x.cxi        titre installé dumpé par GodMode9 (NCCH)
    python extraire.py local/dump/pokemon-x.3ds        image de cartouche (NCSD) : ctrtool prend la partition 0

Le résultat va dans local/extrait/ : exefs/ (code.bin décompressé, icon, banner), romfs/ et exheader.bin
(dont elfer.py se sert pour découper le code en segments). Puis un inventaire des GARC trouvés est écrit
dans local/extrait/inventaire.txt.
"""
import os
import subprocess
import sys

import garc
import inspecter

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(RACINE, 'local')


def trouver_ctrtool():
    for dossier, _, fichiers in os.walk(os.path.join(LOCAL, 'outils')):
        if 'ctrtool.exe' in fichiers:
            return os.path.join(dossier, 'ctrtool.exe')
    return None


def extraire(dump):
    r = inspecter.inspecter(dump, empreinte=False)
    print(inspecter.rapport(r))
    if not r['dechiffre']:
        sys.exit('\nLe dump est chiffré : ctrtool ne pourra rien en tirer. Déchiffrer d\'abord dans GodMode9.')
    exe = trouver_ctrtool()
    if not exe:
        sys.exit('\nctrtool.exe introuvable sous local/outils/. Lancer outils/installer.py.')
    sortie = os.path.join(LOCAL, 'extrait')
    exefs, romfs = os.path.join(sortie, 'exefs'), os.path.join(sortie, 'romfs')
    os.makedirs(exefs, exist_ok=True)
    os.makedirs(romfs, exist_ok=True)
    cmd = [exe, '-p', '--decompresscode', '--exefsdir=' + exefs, '--romfsdir=' + romfs, '--exheader=' + os.path.join(exefs, 'exheader.bin'), dump]
    print('\n> ' + ' '.join(cmd))
    code = subprocess.call(cmd)
    if code:
        sys.exit('ctrtool a rendu le code %d' % code)
    inventorier(romfs, os.path.join(sortie, 'inventaire.txt'))


def inventorier(romfs, chemin_rapport):
    lignes, nb = [], 0
    for dossier, _, fichiers in os.walk(romfs):
        for nom in sorted(fichiers):
            chemin = os.path.join(dossier, nom)
            with open(chemin, 'rb') as f:
                tete = f.read(4)
            if tete == b'CRAG':
                nb += 1
                with open(chemin, 'rb') as f:
                    try:
                        version, entrees = garc.lire(f.read())
                        lignes.append('%s\tGARC v%d\t%d numéros\t%d sous-fichiers' % (os.path.relpath(chemin, romfs), version >> 8, len(entrees), sum(len(e) for e in entrees)))
                    except ValueError as e:
                        lignes.append('%s\tGARC illisible : %s' % (os.path.relpath(chemin, romfs), e))
    with open(chemin_rapport, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lignes) + '\n')
    print('\n%d conteneurs GARC inventoriés dans %s' % (nb, chemin_rapport))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
    else:
        extraire(sys.argv[1])
