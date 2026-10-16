"""Les évolutions (GARC a/2/1/5, 799 fichiers de 48 octets : six emplacements de 8 octets).

Un emplacement : méthode u16, paramètre u16, espèce d'arrivée u16, niveau u16. Un emplacement vide est tout à zéro.
Vérifié sur Bulbizarre : méthode 4, paramètre 16, arrivée 2 (Herbizarre). La signification des numéros de méthode
n'est pas relue ici : le module les garde tels quels.
"""
import struct

SLOTS = 6


def read_entry(data):
    if len(data) != SLOTS * 8:
        raise ValueError('un fichier d\'évolutions fait %d octets, pas %d' % (SLOTS * 8, len(data)))
    out = []
    for i in range(SLOTS):
        method, param, species, level = struct.unpack_from('<4H', data, 8 * i)
        if method or param or species or level:
            out.append({'method': method, 'param': param, 'species': species, 'level': level})
    return out


def write_entry(evolutions):
    if len(evolutions) > SLOTS:
        raise ValueError('%d évolutions, six au plus' % len(evolutions))
    out = bytearray(SLOTS * 8)
    for i, e in enumerate(evolutions):
        for key in ('method', 'param', 'species', 'level'):
            if not isinstance(e.get(key), int) or not 0 <= e[key] <= 0xFFFF:
                raise ValueError('évolution : « %s » absent ou hors limites (%r)' % (key, e.get(key)))
        struct.pack_into('<4H', out, 8 * i, e['method'], e['param'], e['species'], e['level'])
    return bytes(out)
