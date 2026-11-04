"""Un Pokémon de l'équipe dans la sauvegarde de Pokémon X : le lire et le changer (espèce, forme, capacités, talent, objet).

Format d'après PKHeX, faits seulement ; vérifié sur les parties de l'utilisateur : la somme tombe juste, et les capacités lues
sont celles des Pokémon de la partie. 0x104 octets : clé u32 à +0, somme
u16 à +6, puis de +8 à +0xE8 des mots chiffrés par le générateur 0x41C64E6D, 0x6073 de graine la clé, dont le XOR est les 16
bits hauts. Quatre blocs de 0x38 octets, mélangés selon (clé >> 13) & 31 modulo 24. Dans le bloc A : espèce u16 à +0, forme
dans les 5 bits hauts de l'octet +0x15, objet tenu u16 à +0x2, talent u8 à +0xC (et à +0xD le numéro du talent pour
l'espèce : 1, 2 ou 4 pour le caché ; le combat lit le talent lui-même, pas ce numéro). Dans le bloc B : quatre capacités u16 à +0x1A, leurs PP à +0x22, les PP Plus à +0x26.
Les 0x1C octets d'équipe de +0xE8 sont chiffrés à part, le générateur repris de la clé : statut u32 à +0xE8, niveau à +0xEC,
PV restants u16 à +0xF0, PV max à +0xF2 puis les autres stats (lu sur la partie : 0, 14, 33 sur 33). Ils n'entrent pas dans la somme.
"""
import struct
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import teleporter

EQUIPE = 0x14200
TAILLE = 0x104
# PKHeX, BlockPosition : la place de chaque bloc A, B, C, D, pour chacun des 24 mélanges.
PLACES = (0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2, 2, 0, 1, 3, 3, 0, 1, 2,
          2, 0, 3, 1, 3, 0, 2, 1, 1, 2, 0, 3, 1, 3, 0, 2, 2, 1, 0, 3, 3, 1, 0, 2, 2, 3, 0, 1, 3, 2, 0, 1, 1, 2, 3, 0, 1, 3, 2, 0,
          2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 0)
# Le numéro du bloc de l'équipe dans la table des blocs du pied de sauvegarde.
BLOC_EQUIPE = 18


def chiffre(pokemon):
    """Le chiffrement est un XOR : la même fonction déchiffre et chiffre le corps de 0xE0 octets, puis la partie d'équipe."""
    rendu = bytearray(pokemon)
    for debut, fin in ((8, 0xE8), (0xE8, len(pokemon))):
        graine = struct.unpack_from('<I', pokemon, 0)[0]
        for i in range(debut, fin, 2):
            graine = (graine * 0x41C64E6D + 0x6073) & 0xFFFFFFFF
            struct.pack_into('<H', rendu, i, struct.unpack_from('<H', pokemon, i)[0] ^ (graine >> 16))
    return bytes(rendu)


def bloc(pokemon, k):
    """Où commence le bloc k (0 = A, 1 = B…) dans ce Pokémon."""
    return 8 + PLACES[((struct.unpack_from('<I', pokemon, 0)[0] >> 13) & 31) % 24 * 4 + k] * 0x38


def somme(clair):
    return sum(struct.unpack_from('<112H', clair, 8)) & 0xFFFF


def _changer(pokemon, faire):
    clair = bytearray(chiffre(pokemon))
    if somme(clair) != struct.unpack_from('<H', clair, 6)[0]:
        raise ValueError('Pokémon illisible : la somme ne tombe pas juste')
    faire(clair)
    struct.pack_into('<H', clair, 6, somme(clair))
    return chiffre(bytes(clair))


def changer_pokemon(pokemon, espece, forme):
    """Rend ce Pokémon d'équipe (chiffré) devenu cette espèce et cette forme, la somme à jour."""
    def faire(clair):
        a = bloc(pokemon, 0)
        struct.pack_into('<H', clair, a, espece)
        clair[a + 0x15] = (clair[a + 0x15] & 7) | (forme << 3)
    return _changer(pokemon, faire)


def capacites(pokemon):
    """Les quatre capacités de ce Pokémon (chiffré)."""
    return struct.unpack_from('<4H', chiffre(pokemon), bloc(pokemon, 1) + 0x1A)


def changer_capacites(pokemon, liste, pp):
    """Rend ce Pokémon (chiffré) avec ces quatre capacités, chacune à `pp` PP et sans PP Plus."""
    def faire(clair):
        b = bloc(pokemon, 1)
        struct.pack_into('<4H', clair, b + 0x1A, *liste)
        clair[b + 0x22:b + 0x2A] = bytes([pp] * 4 + [0] * 4)
    return _changer(pokemon, faire)


def tenue(pokemon):
    """(talent, objet tenu) de ce Pokémon (chiffré)."""
    clair, a = chiffre(pokemon), bloc(pokemon, 0)
    return clair[a + 0xC], struct.unpack_from('<H', clair, a + 2)[0]


def changer_tenue(pokemon, talent, objet):
    """Rend ce Pokémon (chiffré) avec ce talent et cet objet tenu (0 : aucun) ; le numéro du talent ne bouge pas."""
    def faire(clair):
        a = bloc(pokemon, 0)
        clair[a + 0xC] = talent
        struct.pack_into('<H', clair, a + 2, objet)
    return _changer(pokemon, faire)


def pv_max(pokemon):
    return struct.unpack_from('<H', chiffre(pokemon), 0xF2)[0]


def changer_pv(pokemon, pv):
    """Rend ce Pokémon d'équipe (chiffré) avec ces PV restants."""
    return _changer(pokemon, lambda clair: struct.pack_into('<H', clair, 0xF0, pv))


def avec_tete(sauvegarde, changer):
    """La sauvegarde, le Pokémon de tête passé par `changer`, le CRC du bloc de l'équipe à jour."""
    copie = bytearray(sauvegarde)
    copie[EQUIPE:EQUIPE + TAILLE] = changer(sauvegarde[EQUIPE:EQUIPE + TAILLE])
    longueur = struct.unpack_from('<I', copie, teleporter.PIED + 0x14 + BLOC_EQUIPE * 8)[0]
    struct.pack_into('<H', copie, teleporter.PIED + 0x14 + BLOC_EQUIPE * 8 + 6, teleporter.crc16(copie[EQUIPE:EQUIPE + longueur]))
    return bytes(copie)


def test():
    # un Pokémon fabriqué : la clé donne le mélange 8 (bloc A en troisième place, B en première)
    cle = 8 << 13
    clair = bytearray(TAILLE)
    struct.pack_into('<I', clair, 0, cle)
    a, b = 8 + 2 * 0x38, 8
    struct.pack_into('<H', clair, a, 25)
    clair[a + 0x15] = 0b00001_010
    clair[0xE0] = 7
    struct.pack_into('<H', clair, 6, somme(clair))
    pokemon = chiffre(bytes(clair))
    assert chiffre(pokemon) == bytes(clair), 'le chiffrement se défait'
    assert (bloc(pokemon, 0), bloc(pokemon, 1)) == (a, b)
    assert tuple(PLACES[i * 4] for i in range(24)) == (0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 2, 3, 1, 1, 2, 3, 2, 3, 1, 1, 2, 3, 2, 3)
    assert all(sorted(PLACES[i * 4:i * 4 + 4]) == [0, 1, 2, 3] for i in range(24))
    change = chiffre(changer_pokemon(pokemon, 5, 3))
    assert struct.unpack_from('<H', change, a) == (5,)
    assert change[a + 0x15] == 0b00011_010, 'les bits bas de cet octet (sexe, rencontre) ne bougent pas'
    assert change[0xE0] == 7, 'le reste ne bouge pas'
    assert somme(change) == struct.unpack_from('<H', change, 6)[0]
    appris = changer_capacites(pokemon, (33, 33, 33, 33), 5)
    assert capacites(appris) == (33, 33, 33, 33) and chiffre(appris)[b + 0x22:b + 0x2A] == bytes([5, 5, 5, 5, 0, 0, 0, 0])
    assert chiffre(appris)[a] == 25 and somme(chiffre(appris)) == struct.unpack_from('<H', chiffre(appris), 6)[0]
    tenu = changer_tenue(pokemon, 22, 234)
    assert tenue(tenu) == (22, 234) and chiffre(tenu)[a] == 25 and chiffre(tenu)[a + 0x15] == 0b00001_010
    assert somme(chiffre(tenu)) == struct.unpack_from('<H', chiffre(tenu), 6)[0]
    blesse = changer_pv(pokemon, 1)
    assert struct.unpack_from('<H', chiffre(blesse), 0xF0) == (1,) and blesse[0xF0:0xF2] != b'\x01\x00', 'les PV sont chiffrés'
    assert chiffre(blesse)[:0xE8] == chiffre(pokemon)[:0xE8], 'le reste ne bouge pas'
    try:
        changer_pokemon(bytes(TAILLE - 1) + b'\x01', 1, 0)
    except (ValueError, struct.error):
        pass
    else:
        raise AssertionError('un Pokémon illisible est refusé')
    # une sauvegarde fabriquée : le bloc de l'équipe se recalcule
    sauvegarde = bytearray(teleporter.TAILLE)
    sauvegarde[EQUIPE:EQUIPE + TAILLE] = pokemon
    struct.pack_into('<I', sauvegarde, teleporter.PIED + 0x14 + BLOC_EQUIPE * 8, 0x61C)
    rendu = avec_tete(bytes(sauvegarde), lambda p: changer_pokemon(p, 5, 0))
    assert struct.unpack_from('<H', rendu, teleporter.PIED + 0x14 + BLOC_EQUIPE * 8 + 6) == (teleporter.crc16(rendu[EQUIPE:EQUIPE + 0x61C]),)
    assert chiffre(rendu[EQUIPE:EQUIPE + TAILLE])[a] == 5
    print('pk6 : tests ok')


if __name__ == '__main__':
    test()
