"""Sépare un dump déchiffré en code (exefs) et fichiers (romfs) avec ctrtool, puis inventorie le romfs.

    python extraire.py local/dump/pokemon-x.cxi            titre installé dumpé par GodMode9 (NCCH) -> local/extrait/
    python extraire.py local/dump/pokemon-x.3ds            image de cartouche (NCSD) : ctrtool prend la partition 0
    python extraire.py local/dump/hid.cxi hid               un module système, dans local/extrait/hid/ pour ne pas
                                                           écraser le jeu ; le nom est libre
    python extraire.py local/dump/systeme/native.firm firm  un FIRM déchiffré (NATIVE_FIRM) : ctrtool en sort les
                                                           sections ARM9 et ARM11 dans local/extrait/firm/, et les
                                                           modules de démarrage (sm, fs, pm, loader, pxi) en .cxi

Le résultat : exefs/ (code.bin décompressé, icon, banner), romfs/ et exefs/exheader.bin (dont elfer.py se sert
pour découper le code en segments). Puis un inventaire des GARC trouvés est écrit dans inventaire.txt.
"""
import os
import struct
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


def extraire_firm(dump, exe, sortie):
    """Un FIRM : ctrtool écrit chaque section (ARM9, ARM11) avec son adresse de chargement dans le nom du fichier."""
    os.makedirs(sortie, exist_ok=True)
    cmd = [exe, '-p', '--firmdir=' + sortie, dump]
    print('> ' + ' '.join(cmd))
    code = subprocess.call(cmd)
    if code:
        sys.exit('ctrtool a rendu le code %d' % code)
    sections = sorted(n for n in os.listdir(sortie) if n.startswith('firm_') and n.endswith('.bin'))
    print('\nSections écrites dans %s :' % sortie)
    for n in sections:
        print('  %-40s %d octets' % (n, os.path.getsize(os.path.join(sortie, n))))
    modules = []
    for n in sections:
        modules += modules_du_firm(os.path.join(sortie, n), sortie)
    if modules:
        print('\nModules rangés dans le FIRM, écrits à côté (à extraire comme un .cxi dumpé) :')
        for nom, titre, taille in modules:
            print('  %-40s %d octets, titre %016X' % (nom + '.cxi', taille, titre))
    print('\nUne section ARM11 contient le noyau (kernel11), une autre les cinq modules de démarrage (sm, fs, pm, loader,'
          '\npxi) ; la section ARM9, Process9 et kernel9. Les autres modules système (hid, gsp, cfg...) ne sont pas'
          '\ndedans : ce sont des titres à part dans la CTRNAND, à dumper un par un.')


def modules_du_firm(section, sortie):
    """Les modules de démarrage sont des NCCH posés bout à bout dans une section ARM11, alignés sur 0x200.
    Chacun est écrit dans <nom>.cxi, le nom étant celui de son exheader ; rend la liste (nom, titre, taille)."""
    with open(section, 'rb') as f:
        donnees = f.read()
    trouves, pos = [], 0
    while pos + 0x208 <= len(donnees):
        if donnees[pos + 0x100:pos + 0x104] != b'NCCH':
            pos += inspecter.UNITE
            continue
        taille = struct.unpack_from('<I', donnees, pos + 0x104)[0] * inspecter.UNITE
        titre = struct.unpack_from('<Q', donnees, pos + 0x108)[0]
        nom = donnees[pos + 0x200:pos + 0x208].rstrip(b'\x00').decode('ascii', 'replace')
        if not taille or pos + taille > len(donnees) or not nom.isalnum():
            pos += inspecter.UNITE
            continue
        with open(os.path.join(sortie, nom + '.cxi'), 'wb') as f:
            f.write(donnees[pos:pos + taille])
        trouves.append((nom, titre, taille))
        pos += taille
    return trouves


def extraire(dump, nom=None):
    exe = trouver_ctrtool()
    if not exe:
        sys.exit('\nctrtool.exe introuvable sous local/outils/. Lancer outils/installer.py.')
    sortie = os.path.join(LOCAL, 'extrait', nom) if nom else os.path.join(LOCAL, 'extrait')
    with open(dump, 'rb') as f:
        magic = f.read(4)
    if magic == b'FIRM':
        extraire_firm(dump, exe, sortie)
        return
    r = inspecter.inspecter(dump, empreinte=False)
    print(inspecter.rapport(r))
    if not r['dechiffre']:
        sys.exit('\nLe dump est chiffré : ctrtool ne pourra rien en tirer. Déchiffrer d\'abord dans GodMode9.')
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
    if len(sys.argv) not in (2, 3):
        print(__doc__)
    else:
        extraire(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
