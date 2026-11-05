"""Le randomizer de Pokémon X : un mod du romfs tiré d'une graine, chaque partie au choix (cases du launcher). Deux joueurs
avec la même graine et les mêmes cases ont le même jeu (le multijoueur s'y appuie).

Parties :
- `capacites` : les capacités apprises par niveau (`a/2/1/4`, paires u16 capacité, u16 niveau, fin -1), tirées à nouveau,
  niveaux gardés, sans Lutte (165) ni doublon ;
- `dresseurs` : l'espèce de chaque Pokémon des dresseurs (`a/0/4/0`, entrées de 8 octets : force, talent et genre, u16
  niveau, u16 espèce, u16 forme ; + u16 objet si le bit 1 de l'octet 0 de `a/0/3/8`, + 4 u16 capacités si le bit 0). Les
  capacités imposées deviennent les quatre dernières que la nouvelle espèce apprend à ce niveau ;
- `objets` : les objets au sol mélangés entre eux (table (objet, quantité, n) des données du script commun 17 de
  `a/0/3/1` à +0x24, `local/analyse/pokemon-x-ap/catalogue.md`) : aucun objet ne disparaît, le drapeau n reste à sa place.

Le mod s'écrit dans `local/mods-build/random-<graine>` (les fichiers du jeu restent dans `local/`), à donner à `--mod`.

    python outils/randomizer.py GRAINE [capacites] [dresseurs] [objets] [--jauge] [--sortie DOSSIER]
    python outils/randomizer.py test
"""
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import amx
import garc
import lz11

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROMFS = os.path.join(RACINE, 'local', 'extrait', 'romfs')
ROMFS_MAJ = os.path.join(RACINE, 'local', 'extrait', 'maj', 'romfs')
PARTIES = ('capacites', 'dresseurs', 'objets')
ESPECES, CAPACITES, LUTTE = 721, 617, 165
OBJETS_SOL = 17  # le script commun des objets au sol
CS = range(420, 428)  # les CS : laissées en place, une CS ailleurs pourrait fermer le chemin qui y mène
TABLE_OBJETS = 0x24


def chemin(nom):
    """Le fichier du romfs, celui de la mise à jour d'abord."""
    maj = os.path.join(ROMFS_MAJ, *nom.split('/'))
    return maj if os.path.exists(maj) else os.path.join(ROMFS, *nom.split('/'))


def lire(nom):
    with open(chemin(nom), 'rb') as f:
        return garc.lire(f.read())[1]


# --- capacités par niveau ---

def apprises(bloc):
    """[(capacité, niveau)] d'une entrée de `a/2/1/4`, jusqu'à (-1, -1)."""
    out = []
    for i in range(0, len(bloc) - 3, 4):
        m, n = struct.unpack_from('<hh', bloc, i)
        if m == -1:
            break
        out.append((m, n))
    return out


def ecrire_apprises(liste):
    return b''.join(struct.pack('<hh', m, n) for m, n in liste) + struct.pack('<hh', -1, -1)


def melanger_capacites(blocs, rng):
    neufs = []
    for bloc in blocs:
        liste = apprises(bloc)
        vues = set()
        nouvelle = []
        for _, niveau in liste:
            m = rng.randint(1, CAPACITES)
            while m == LUTTE or m in vues:
                m = rng.randint(1, CAPACITES)
            vues.add(m)
            nouvelle.append((m, niveau))
        neufs.append(ecrire_apprises(nouvelle))
    return neufs


def dernieres(liste, niveau):
    """Les quatre dernières capacités apprises jusqu'à ce niveau (sans doublon), complétées de 0."""
    out = []
    for m, n in liste:
        if n <= niveau and m not in out:
            out.append(m)
    out = out[-4:]
    return out + [0] * (4 - len(out))


# --- dresseurs ---

def melanger_dresseurs(donnees, equipes, apprises_par_espece, rng):
    neuves = []
    for t, p in zip(donnees, equipes):
        drapeaux = t[0] if t else 0
        taille = 8 + (2 if drapeaux & 2 else 0) + (8 if drapeaux & 1 else 0)
        p = bytearray(p)
        for o in range(0, len(p) - taille + 1, taille):
            espece = rng.randint(1, ESPECES)
            niveau = struct.unpack_from('<H', p, o + 2)[0]
            struct.pack_into('<HH', p, o + 4, espece, 0)
            if drapeaux & 1:
                struct.pack_into('<4H', p, o + taille - 8, *dernieres(apprises_par_espece(espece), niveau))
        neuves.append(bytes(p))
    return neuves


# --- objets au sol (script AMX compact) ---

def compacter(cellules):
    """L'inverse de `amx.developper` : 7 bits par octet, le premier porte le signe au bit 6, bit 7 : un octet suit."""
    out = bytearray()
    for c in cellules:
        v = c - (1 << 32) if c & 0x80000000 else c
        groupes = [v & 0x7f]
        v >>= 7
        while not ((v == 0 and not groupes[0] & 0x40) or (v == -1 and groupes[0] & 0x40)):
            groupes.insert(0, v & 0x7f)
            v >>= 7
        out += bytes(g | 0x80 for g in groupes[:-1]) + bytes([groupes[-1]])
    return bytes(out)


def amx_avec_donnees(brut, donnees):
    """Le script `brut` avec ces données (même taille), recompacté si besoin ; la taille de l'en-tête suit."""
    a = amx.Amx(brut)
    memoire = a.code + donnees
    if not a.drapeaux & 4:
        return brut[:a.cod] + memoire[:a.hea - a.cod] + brut[a.hea:]
    corps = compacter(struct.unpack('<%dI' % (len(memoire) // 4), memoire))
    neuf = bytearray(brut[:a.cod] + corps)
    struct.pack_into('<I', neuf, 0, len(neuf))
    return bytes(neuf)


def melanger_objets(script, rng):
    """Le commun 17 aux objets au sol mélangés : (objet, quantité) permutés entre les cases, n gardé ; les CS restent."""
    a = amx.Amx(script)
    d = bytearray(a.donnees)
    n = (len(d) - TABLE_OBJETS) // 12
    cases = []
    for i in range(n):
        objet, qte, _ = struct.unpack_from('<3i', d, TABLE_OBJETS + 12 * i)
        if objet <= 0 or qte <= 0:
            break
        if objet not in CS:
            cases.append((i, (objet, qte)))
    melange = [e for _, e in cases]
    rng.shuffle(melange)
    for (i, _), (objet, qte) in zip(cases, melange):
        struct.pack_into('<2i', d, TABLE_OBJETS + 12 * i, objet, qte)
    return amx_avec_donnees(script, bytes(d))


# --- le mod ---

def fichiers(graine, parties):
    """{chemin du romfs: octets} du randomizer."""
    out = {}
    blocs = [e[0] for e in lire('a/2/1/4')]
    if 'capacites' in parties:
        blocs = melanger_capacites(blocs, random.Random(f'{graine}:capacites'))
        out['a/2/1/4'] = garc.ecrire([[b] for b in blocs])
    if 'dresseurs' in parties:
        donnees, equipes = [e[0] for e in lire('a/0/3/8')], [e[0] for e in lire('a/0/4/0')]
        par_espece = lambda s: apprises(blocs[s]) if s < len(blocs) else []
        out['a/0/4/0'] = garc.ecrire([[p] for p in melanger_dresseurs(donnees, equipes, par_espece, random.Random(f'{graine}:dresseurs'))])
    if 'objets' in parties:
        communs = lire('a/0/3/1')
        brut = communs[OBJETS_SOL][0]
        compresse = brut[:1] == b'\x11'
        script = melanger_objets(lz11.decompresser(brut) if compresse else brut, random.Random(f'{graine}:objets'))
        communs = [list(e) for e in communs]
        communs[OBJETS_SOL][0] = lz11.compresser(script) if compresse else script
        out['a/0/3/1'] = garc.ecrire(communs)
    return out


def test():
    # le compactage refait ce que le jeu développe, petites et grandes valeurs, négatives comprises
    cellules = [0, 1, 63, 64, 127, 128, 0x7fffffff, 0xffffffff, 0x80000000, 0xffffffc0, 1234567]
    corps = compacter(cellules)
    assert amx.developper(b'\0' * 4 + corps, 4 + len(corps), 4, 4, 4 + 4 * len(cellules)) == struct.pack('<11I', *cellules)
    # capacités : niveaux gardés, ni Lutte ni doublon
    bloc = ecrire_apprises([(33, 1), (45, 1), (10, 7), (52, 13)])
    neuf = apprises(melanger_capacites([bloc], random.Random(1))[0])
    assert [n for _, n in neuf] == [1, 1, 7, 13] and LUTTE not in [m for m, _ in neuf] and len({m for m, _ in neuf}) == 4
    assert dernieres([(1, 1), (2, 5), (3, 9), (4, 12), (5, 20)], 12) == [1, 2, 3, 4][-4:]
    assert dernieres([(7, 1)], 5) == [7, 0, 0, 0]
    # dresseurs : une équipe à capacités (16 octets) ; espèce changée, forme 0, capacités de la nouvelle espèce
    donnees = [bytes([1, 0, 0, 1]) + bytes(16)]
    equipe = struct.pack('<BBHHH4H', 0, 0, 12, 25, 1, 84, 0, 0, 0)
    (neuve,) = melanger_dresseurs(donnees, [equipe], lambda s: [(500 + s % 50, 1), (600, 12), (601, 30)], random.Random(2))
    _, _, niveau, espece, forme, *capacites = struct.unpack('<BBHHH4H', neuve)
    assert niveau == 12 and forme == 0 and 1 <= espece <= ESPECES and capacites == [500 + espece % 50, 600, 0, 0]
    # objets : un AMX compact fabriqué, sa table permutée, n gardés, le reste intact
    code = [0x2e, 0]
    table = [0, 0, 0, 0, 0, 0, 0, 0, 0] + [4, 1, 0, 17, 3, 1, 50, 2, 2, 420, 1, 3] + [0, 0, 0]
    corps = compacter(code + table)
    tete = bytearray(0x38)
    struct.pack_into('<IHBBHHIIIIiIIIIII', tete, 0, 0, 0xf1e0, 0, 0, 4, 8, 0x38, 0x38 + 8, 0x38 + 8 + 4 * len(table), 0, -1, 0x38, 0x38, 0x38, 0x38, 0x38, 0x38)
    brut = bytes(tete) + corps
    brut = struct.pack('<I', len(brut)) + brut[4:]
    neuf = amx.Amx(melanger_objets(brut, random.Random(3)))
    lus = [struct.unpack_from('<3i', neuf.donnees, TABLE_OBJETS + 12 * i) for i in range(4)]
    assert sorted((o, q) for o, q, _ in lus[:3]) == [(4, 1), (17, 3), (50, 2)] and [k for _, _, k in lus] == [0, 1, 2, 3]
    assert lus[3] == (420, 1, 3), 'la CS reste à sa case'
    assert neuf.code == amx.Amx(brut).code
    print('randomizer : ok')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['test']:
        test()
    else:
        sortie = None
        if '--sortie' in args:
            i = args.index('--sortie')
            sortie = args[i + 1]
            del args[i:i + 2]
        jauge = '--jauge' in args
        args = [a for a in args if a != '--jauge']
        graine, parties = args[0], [a for a in args[1:] if a in PARTIES] or list(PARTIES)
        fic = fichiers(graine, parties)
        if jauge:
            import mod_jauge
            fic['a/0/0/4'] = mod_jauge.agrandir(open(mod_jauge.SOURCE, 'rb').read())[0]
        import tournee
        dossier = sortie or os.path.join(RACINE, 'local', 'mods-build', f'random-{graine}')
        print(', '.join(sorted(fic)), ';', tournee.mod_fichiers(dossier, fic))
