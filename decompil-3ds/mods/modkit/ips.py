"""Fabrication d'un fichier IPS pour le code du jeu (Luma3DS : luma/titles/<id>/code.ips).

Luma lit « PATCH », puis des enregistrements (décalage sur 3 octets en gros-boutiste, taille sur 2 octets, données ;
une taille nulle annonce une répétition : taille de répétition sur 2 octets puis un octet), puis « EOF »
(patcher.c, applyCodeIpsPatch). Les décalages sont relatifs au début de la section de code décompressée (.code), qui
est chargée à l'adresse virtuelle 0x100000 : une adresse virtuelle 0x1234A8 s'écrit donc 0x2348A.
"""
import struct

CODE_BASE = 0x100000


def build(patches):
    """patches : liste de (adresse virtuelle, octets). Rend les octets du fichier IPS."""
    out = bytearray(b'PATCH')
    last_end = -1
    for address, data in sorted(patches):
        offset = address - CODE_BASE
        if offset < 0 or offset + len(data) > 0xFFFFFF:
            raise ValueError('adresse %#x hors de la section de code' % address)
        if offset == 0x454F46:
            raise ValueError('le décalage %#x se confond avec « EOF » en IPS : décaler le correctif d\'un octet' % offset)
        if not 0 < len(data) <= 0xFFFF:
            raise ValueError('correctif de %d octets en %#x : de 1 à 65535 attendu' % (len(data), address))
        if offset < last_end:
            raise ValueError('correctifs qui se chevauchent près de %#x' % address)
        last_end = offset + len(data)
        out += offset.to_bytes(3, 'big') + struct.pack('>H', len(data)) + data
    return bytes(out + b'EOF')


def parse(data):
    """L'inverse de build, pour les tests : rend la liste de (adresse virtuelle, octets)."""
    if data[:5] != b'PATCH':
        raise ValueError('pas un IPS')
    pos, out = 5, []
    while data[pos:pos + 3] != b'EOF':
        offset = int.from_bytes(data[pos:pos + 3], 'big')
        size = struct.unpack_from('>H', data, pos + 3)[0]
        pos += 5
        if size == 0:
            run, value = struct.unpack_from('>HB', data, pos)
            pos += 3
            out.append((offset + CODE_BASE, bytes([value]) * run))
        else:
            out.append((offset + CODE_BASE, data[pos:pos + size]))
            pos += size
    return out
