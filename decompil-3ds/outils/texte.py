"""Textes de Pokémon X/Y (génération 6) : décodage et encodage des fichiers de texte rangés dans les GARC.

Chaque fichier de texte est une liste de lignes en UTF-16 petit-boutiste, chiffrées par un simple
OU exclusif avec une clé de 16 bits qui change à chaque caractère. Structure :

    en-tête (0x10 octets)
        u16 sections      toujours 1
        u16 lignes        nombre de lignes
        u32 longueur      longueur de la section, en octets
        u32 cle_initiale  toujours 0
        u32 debut         début de la section, toujours 0x10
    section (à « debut »)
        u32 longueur      la même que dans l'en-tête
        par ligne : u32 décalage (depuis le début de la section), u16 longueur (en caractères,
                    remplissage compris), u16 à zéro
        puis les lignes chiffrées, chacune terminée par 0x0000 et complétée à un multiple de 4 octets

Clé de la ligne i : 0x7C89 + 0x2983 * i (sur 16 bits). Après chaque caractère, la clé tourne de
3 bits vers la gauche. Le même calcul chiffre et déchiffre.

Dans une ligne déchiffrée, 0x0010 ouvre une commande : u16 nombre (le code plus ses arguments),
u16 code, puis les arguments. Codes spéciaux : 0xBE00 attend un bouton puis fait défiler, 0xBE01
attend un bouton puis efface, 0xBE02 marque une pause (un argument, la durée), 0xBDFF marque une
ligne vide (un argument, son numéro). Pour ces deux derniers, l'argument suit alors que le nombre
vaut 1 : c'est ainsi que pk3DS les lit et les écrit.

Forme lisible, la même que pk3DS pour pouvoir comparer avec ses exports :

    \\n retour à la ligne       \\r défiler          \\c effacer
    \\\\ une barre oblique      \\[ un crochet ouvrant
    [VAR TRNAME]               une variable (ici le nom du dresseur), nom tiré de la table de X/Y
    [VAR ITEM1(0001)]          une variable avec ses arguments, en hexadécimal sur 4 chiffres
    [VAR 0BAD]                 une variable sans nom connu : son code en hexadécimal
    [WAIT 30]                  une pause          [~ 12]   une ligne vide numéro 12

Les fichiers de texte de X/Y sont dans deux GARC par langue, a/0/7/2 (« gametext ») et a/0/8/0
(« storytext »), plus le numéro de la langue (pk3DS, GARCReference.cs, lignes 51-52 ; l'ordre des
langues reste à vérifier sur le romfs).

Source : pk3DS de kwsch, https://github.com/kwsch/pk3DS (branche master, commit 6daaca9 du
27 février 2026 ; TextFile.cs inchangé depuis le commit 44df397 du 2 juin 2024) :
    pk3DS.Core/TextFile.cs, lignes 12-19     les constantes KEY_*
                            lignes 42-47     l'en-tête
                            lignes 49-77     la table des lignes (décalage, longueur)
                            lignes 97-141    la clé par ligne et la reconstruction du fichier
                            lignes 149-169   l'encodage ligne par ligne et le remplissage à 4 octets
                            lignes 173-182   le chiffrement (OU exclusif, rotation de 3 bits)
                            lignes 184-254   le texte vers les mots de 16 bits, les symboles ♂ ♀ …
                            lignes 256-399   les mots vers le texte, les variables et échappements
    pk3DS.Core/Game/TextVariableCode.cs, lignes 14-64   les noms des variables de X/Y

Deux écarts voulus avec pk3DS : on n'enlève pas les espaces en début et fin de ligne (pk3DS fait
un Trim à l'encodage), et un vrai retour à la ligne dans le texte vaut « \\n ».

Pas encore validé sur les vrais fichiers : sans dump, seuls les allers-retours sur des données
fabriquées sont testés. À la première extraction, décoder un fichier connu (les noms des Pokémon)
et réencoder : les octets doivent revenir identiques.

    python texte.py lire fichier                  affiche les lignes numérotées
    python texte.py garc fichier.garc [dossier]   décode chaque fichier du GARC, un .txt par fichier
    python texte.py ecrire lignes.txt sortie      une ligne du .txt (UTF-8) par ligne du jeu
    python texte.py test

Ajouter --symboles à lire et garc pour voir ♂, ♀, … et l'espace fine au lieu des caractères privés
du jeu (pk3DS l'appelle RemapChars ; à remettre à l'identique avant d'écrire).
"""
import os
import struct
import sys

import garc

CLE_BASE = 0x7C89
CLE_AVANCE = 0x2983
VARIABLE = 0x0010
FIN = 0x0000
DEFILER = 0xBE00
EFFACER = 0xBE01
PAUSE = 0xBE02
LIGNE_VIDE = 0xBDFF
DEBUT_SECTION = 0x10

# Les noms que pk3DS donne aux variables de X/Y (TextVariableCode.cs, VariableCodes_XY).
VARIABLES_XY = {
    0xFF00: 'COLOR', 0x0100: 'TRNAME', 0x0101: 'PKNAME', 0x0102: 'PKNICK', 0x0103: 'TYPE',
    0x0105: 'LOCATION', 0x0106: 'ABILITY', 0x0107: 'MOVE', 0x0108: 'ITEM1', 0x0109: 'ITEM2',
    0x010A: 'sTRBAG', 0x010B: 'BOX', 0x010D: 'EVSTAT', 0x0110: 'OPOWER', 0x0127: 'RIBBON',
    0x0134: 'MIINAME', 0x013E: 'WEATHER', 0x0189: 'TRNICK', 0x018A: '1stchrTR', 0x018B: 'SHOUTOUT',
    0x018E: 'BERRY', 0x018F: 'REMFEEL', 0x0190: 'REMQUAL', 0x0191: 'WEBSITE', 0x019C: 'CHOICECOS',
    0x01A1: 'GSYNCID', 0x0192: 'PRVIDSAY', 0x0193: 'BTLTEST', 0x0195: 'GENLOC', 0x0199: 'CHOICEFOOD',
    0x019A: 'HOTELITEM', 0x019B: 'TAXISTOP', 0x019F: 'MAISTITLE', 0x1000: 'ITEMPLUR0',
    0x1001: 'ITEMPLUR1', 0x1100: 'GENDBR', 0x1101: 'NUMBRNCH', 0x1302: 'iCOLOR2', 0x1303: 'iCOLOR3',
    0x0200: 'NUM1', 0x0201: 'NUM2', 0x0202: 'NUM3', 0x0203: 'NUM4', 0x0204: 'NUM5', 0x0205: 'NUM6',
    0x0206: 'NUM7', 0x0207: 'NUM8', 0x0208: 'NUM9',
}
CODES_XY = {nom: code for code, nom in VARIABLES_XY.items()}

# Caractères privés du jeu et leur équivalent Unicode (TextFile.cs, TryRemapChar / TryUnmapChar).
SYMBOLES = {0xE07F: 0x202F, 0xE08D: 0x2026, 0xE08E: 0x2642, 0xE08F: 0x2640}
SYMBOLES_INVERSES = {u: j for j, u in SYMBOLES.items()}


def cle_de_ligne(i):
    return (CLE_BASE + CLE_AVANCE * i) & 0xFFFF


def chiffrer(mots, cle):
    """OU exclusif mot par mot avec une clé qui tourne de 3 bits à chaque pas. Sert aussi à déchiffrer."""
    sortie = []
    for m in mots:
        sortie.append(m ^ cle)
        cle = (cle << 3 | cle >> 13) & 0xFFFF
    return sortie


def mots_vers_texte(mots, symboles=False):
    """Une ligne déchiffrée (liste de u16) vers sa forme lisible."""
    morceaux = []
    i = 0
    while i < len(mots):
        m = mots[i]
        if m == FIN:
            break
        i += 1
        if m == VARIABLE:
            if i + 2 > len(mots):
                raise ValueError('commande coupée en fin de ligne')
            nombre, code = mots[i], mots[i + 1]
            i += 2
            if code == DEFILER:
                morceaux.append('\\r')
            elif code == EFFACER:
                morceaux.append('\\c')
            elif code in (PAUSE, LIGNE_VIDE):
                if i >= len(mots):
                    raise ValueError('argument manquant après la commande %#06x' % code)
                morceaux.append('[%s %d]' % ('WAIT' if code == PAUSE else '~', mots[i]))
                i += 1
            else:
                args = mots[i:i + nombre - 1] if nombre > 1 else []
                if len(args) != max(nombre - 1, 0):
                    raise ValueError('arguments manquants pour la variable %#06x' % code)
                i += len(args)
                nom = VARIABLES_XY.get(code, '%04X' % code)
                morceaux.append('[VAR %s%s]' % (nom, '(%s)' % ','.join('%04X' % a for a in args) if args else ''))
        elif m == 0x0A:
            morceaux.append('\\n')
        elif m == 0x5C:
            morceaux.append('\\\\')
        elif m == 0x5B:
            morceaux.append('\\[')
        else:
            morceaux.append(chr(SYMBOLES.get(m, m) if symboles else m))
    return ''.join(morceaux)


def nombre_de_variable(nom):
    """Le code d'une variable : par son nom dans la table de X/Y, sinon lu en hexadécimal. None si ni l'un ni l'autre."""
    if nom in CODES_XY:
        return CODES_XY[nom]
    try:
        code = int(nom, 16)
    except ValueError:
        return None
    return code if 0 <= code <= 0xFFFF else None


def commande_vers_mots(contenu):
    """Le texte entre crochets (« VAR TRNAME », « WAIT 30 », « ~ 12 ») vers ses mots de 16 bits."""
    genre, _, reste = contenu.partition(' ')
    if not reste:
        raise ValueError('commande mal formée : [%s]' % contenu)
    if genre in ('~', 'WAIT'):
        return [VARIABLE, 1, LIGNE_VIDE if genre == '~' else PAUSE, int(reste) & 0xFFFF]
    if genre != 'VAR':
        raise ValueError('commande inconnue : [%s]' % contenu)
    nom, parenthese, args = reste.partition('(')
    code = nombre_de_variable(nom)
    if code is None:
        raise ValueError('variable inconnue : %s' % nom)
    if not parenthese:
        return [VARIABLE, 1, code]
    if not args.endswith(')'):
        raise ValueError('parenthèse non fermée : [%s]' % contenu)
    valeurs = [int(a, 16) & 0xFFFF for a in args[:-1].split(',')]
    return [VARIABLE, 1 + len(valeurs), code] + valeurs


def texte_vers_mots(texte, symboles=False):
    """Une ligne lisible vers ses mots de 16 bits, terminateur compris."""
    mots = []
    i = 0
    while i < len(texte):
        c = texte[i]
        i += 1
        if c == '[':
            fin = texte.find(']', i)
            if fin < 0:
                raise ValueError('crochet non fermé : %r' % texte)
            mots += commande_vers_mots(texte[i:fin])
            i = fin + 1
        elif c == '\\':
            if i >= len(texte):
                raise ValueError('barre oblique en fin de ligne : %r' % texte)
            e = texte[i]
            i += 1
            echappements = {'n': [0x0A], '\\': [0x5C], '[': [0x5B],
                            'r': [VARIABLE, 1, DEFILER], 'c': [VARIABLE, 1, EFFACER]}
            if e not in echappements:
                raise ValueError('échappement inconnu \\%s dans %r' % (e, texte))
            mots += echappements[e]
        else:
            u = ord(c)
            if u > 0xFFFF:
                raise ValueError('caractère hors du plan de base (le jeu stocke de l\'UCS-2) : %r' % c)
            mots.append(SYMBOLES_INVERSES.get(u, u) if symboles else u)
    mots.append(FIN)
    return mots


def decoder(donnees, symboles=False):
    """Rend la liste des lignes (str) d'un fichier de texte, ou lève ValueError si l'en-tête ne colle pas."""
    if len(donnees) < DEBUT_SECTION + 4:
        raise ValueError('trop court pour un fichier de texte (%d octets)' % len(donnees))
    sections, nb_lignes, longueur, cle_initiale, debut = struct.unpack_from('<HHIII', donnees, 0)
    if sections != 1:
        raise ValueError('%d sections au lieu de 1' % sections)
    if cle_initiale != 0:
        raise ValueError('clé initiale %#x au lieu de 0' % cle_initiale)
    if debut + longueur != len(donnees):
        raise ValueError('taille annoncée %d + %d, fichier de %d octets' % (debut, longueur, len(donnees)))
    if struct.unpack_from('<I', donnees, debut)[0] != longueur:
        raise ValueError('longueur de section différente de celle de l\'en-tête')
    lignes = []
    for i in range(nb_lignes):
        decalage, nb_mots = struct.unpack_from('<IH', donnees, debut + 4 + 8 * i)
        mots = struct.unpack_from('<%dH' % nb_mots, donnees, debut + decalage)
        lignes.append(mots_vers_texte(chiffrer(mots, cle_de_ligne(i)), symboles))
    return lignes


def encoder(lignes, symboles=False):
    """Fabrique un fichier de texte à partir d'une liste de lignes lisibles. Un vrai « \\n » vaut « \\\\n »."""
    if len(lignes) > 0xFFFF:
        raise ValueError('trop de lignes : %d' % len(lignes))
    table, corps = bytearray(), bytearray()
    debut_corps = 4 + 8 * len(lignes)
    for i, ligne in enumerate(lignes):
        mots = chiffrer(texte_vers_mots(ligne.replace('\n', '\\n'), symboles), cle_de_ligne(i))
        brut = struct.pack('<%dH' % len(mots), *mots)
        if len(brut) % 4 == 2:
            brut += b'\x00\x00'
        if len(brut) // 2 > 0xFFFF:
            raise ValueError('ligne %d trop longue' % i)
        table += struct.pack('<IHH', debut_corps + len(corps), len(brut) // 2, 0)
        corps += brut
    longueur = 4 + len(table) + len(corps)
    entete = struct.pack('<HHIII', 1, len(lignes), longueur, 0, DEBUT_SECTION)
    return bytes(entete + struct.pack('<I', longueur) + table + corps)


def test():
    # Le fichier vide de pk3DS (TextFile.cs, ligne 20), à l'octet près.
    vide = bytes([1, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0x10, 0, 0, 0, 4, 0, 0, 0])
    assert encoder([]) == vide and decoder(vide) == [], 'fichier vide différent de celui de pk3DS'

    jeux = [
        [''],
        ['Bonjour !'],
        ['Électhor', 'Pokémon', 'Œuf de Pikachu à éclore… peut-être', 'ça, là, où, Noël, garçon'],
        ['Première ligne\\nseconde ligne', 'Appuie sur A\\rpuis la suite\\c', 'Fin.'],
        ['[VAR TRNAME] a reçu [VAR ITEM1(0001)] !', '[VAR COLOR(0003)]rouge[VAR COLOR(0000)] et noir',
         '[VAR 0BAD(0002,FFFF)] variable sans nom', '[VAR NUM3(0000,0001,0002)]'],
        ['Attends…[WAIT 30] voilà.', '[~ 12]', 'Barre \\\\ et crochet \\[ ouvert ] fermé'],
        ['  espaces gardés  ', 'a' * 1000, 'b' * 1001],
        ['ligne %d, ça boucle' % n for n in range(300)],
    ]
    for lignes in jeux:
        d = encoder(lignes)
        assert decoder(d) == lignes, 'aller-retour texte raté sur %r' % lignes[:2]
        assert encoder(decoder(d)) == d, 'réencodage différent sur %r' % lignes[:2]

    # La structure, vérifiée à la main sur deux lignes : décalages, longueurs, clés, remplissage.
    d = encoder(['B', 'é'])
    assert struct.unpack_from('<HHIII', d, 0) == (1, 2, 4 + 16 + 4 + 4, 0, 0x10)
    assert struct.unpack_from('<IHH', d, 0x14) == (4 + 16, 2, 0)
    assert struct.unpack_from('<IHH', d, 0x1C) == (4 + 16 + 4, 2, 0)
    assert struct.unpack_from('<HH', d, 0x10 + 20) == (ord('B') ^ 0x7C89, 0 ^ 0xE44B)
    assert struct.unpack_from('<H', d, 0x10 + 24)[0] == ord('é') ^ 0xA60C

    # Un vrai retour à la ligne vaut \n ; les symboles du jeu ne changent qu'avec symboles=True.
    assert decoder(encoder(['a\nb'])) == ['a\\nb']
    d = encoder(['Nidoran♂ et Nidoran♀…'], symboles=True)
    assert decoder(d, symboles=True) == ['Nidoran♂ et Nidoran♀…']
    assert decoder(d) == ['Nidoran et Nidoran']

    for mauvais in (['[VAR TRNAME'], ['\\x'], ['[INCONNU 1]'], ['[VAR PASUNNOM]'], ['fin\\']):
        try:
            encoder(mauvais)
        except ValueError:
            continue
        raise AssertionError('%r aurait dû être refusé' % mauvais)
    try:
        decoder(encoder(['abc'])[:-2])
        raise AssertionError('un fichier tronqué aurait dû être refusé')
    except ValueError:
        pass
    print('texte : %d jeux de lignes en aller-retour, structure et erreurs vérifiées.' % len(jeux))


def ecrire_txt(chemin, lignes):
    with open(chemin, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lignes) + '\n')


if __name__ == '__main__':
    # Les textes du jeu contiennent des caractères privés que la console Windows ne sait pas toujours afficher.
    sys.stdout.reconfigure(errors='replace')
    args = [a for a in sys.argv[1:] if a != '--symboles']
    symboles = '--symboles' in sys.argv[1:]
    if args[:1] == ['test']:
        test()
    elif len(args) == 2 and args[0] == 'lire':
        with open(args[1], 'rb') as fh:
            for n, ligne in enumerate(decoder(fh.read(), symboles)):
                print('%5d  %s' % (n, ligne))
    elif len(args) in (2, 3) and args[0] == 'garc':
        with open(args[1], 'rb') as fh:
            _, entrees = garc.lire(fh.read())
        dossier = args[2] if len(args) == 3 else None
        if dossier:
            os.makedirs(dossier, exist_ok=True)
        for i, sous in enumerate(entrees):
            for j, f in enumerate(sous):
                try:
                    lignes = decoder(f, symboles)
                except ValueError as e:
                    print('  %4d.%-2d  illisible : %s' % (i, j, e))
                    continue
                print('  %4d.%-2d  %4d lignes  %s' % (i, j, len(lignes), (lignes[0][:60] if lignes else '')))
                if dossier:
                    ecrire_txt(os.path.join(dossier, '%04d.%02d.txt' % (i, j)), lignes)
    elif len(args) == 3 and args[0] == 'ecrire':
        with open(args[1], encoding='utf-8') as fh:
            contenu = fh.read()
        lignes = contenu.split('\n')
        if lignes and lignes[-1] == '':
            lignes.pop()
        with open(args[2], 'wb') as fh:
            fh.write(encoder(lignes, symboles))
        print('%d lignes écrites dans %s' % (len(lignes), args[2]))
    else:
        print(__doc__)
