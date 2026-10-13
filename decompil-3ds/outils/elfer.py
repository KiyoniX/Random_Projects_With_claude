"""Enveloppe un code.bin de 3DS dans un ELF ARM chargé à 0x00100000, pour que Ghidra et REA l'ouvrent à la bonne adresse.

Un code.bin est du code nu : ni en-tête, ni adresse. Ghidra demande alors l'adresse de base à la
main, et REA, qui pilote Ghidra sans interface, ne sait imposer une adresse qu'aux programmes DOS.
Un ELF minimal règle les deux : un en-tête, un segment chargeable à 0x00100000, le code tel quel.
Si l'exheader extrait par ctrtool est à côté (exheader.bin), on lit les vraies tailles de .text,
.rodata et .data et on les écrit en trois segments, lecture-exécution, lecture seule, lecture-écriture,
plus le .bss. Sinon un seul segment en lecture-écriture-exécution.

    python elfer.py local/extrait/exefs/code.bin                 écrit code.elf à côté
    python elfer.py local/extrait/exefs/code.bin sortie.elf
    python elfer.py test

L'exheader (3dbrew, « NCCH/Extended Header ») commence par le nom du titre (8 octets), des drapeaux,
puis à 0x10 trois descripteurs (adresse, pages, taille) pour .text, .rodata et .data, chacun de 12 octets,
avec la taille du .bss à 0x3C ; .rodata est à 0x20 et .data à 0x30.
"""
import os
import struct
import sys

BASE = 0x00100000
EM_ARM = 40
PF_X, PF_W, PF_R = 1, 2, 4
EF_ARM_EABI_VER5 = 0x05000000


def segments_depuis_exheader(exheader, taille_code):
    """Rend [(adresse, decalage dans code.bin, taille fichier, taille memoire, drapeaux)] d'après l'exheader, ou None s'il est incohérent."""
    if len(exheader) < 0x40:
        return None
    text = struct.unpack_from('<III', exheader, 0x10)
    ro = struct.unpack_from('<III', exheader, 0x20)
    data = struct.unpack_from('<III', exheader, 0x30)
    bss = struct.unpack_from('<I', exheader, 0x3C)[0]
    if text[0] != BASE or ro[0] < text[0] + text[2] or data[0] < ro[0] + ro[2]:
        return None
    # Dans code.bin, chaque section est alignée sur une page de 0x1000 octets.
    def pages(t):
        return (t + 0xFFF) & ~0xFFF
    dec_ro = pages(text[2])
    dec_data = dec_ro + pages(ro[2])
    if dec_data + data[2] > taille_code:
        return None
    return [
        (text[0], 0, text[2], text[2], PF_R | PF_X),
        (ro[0], dec_ro, ro[2], ro[2], PF_R),
        (data[0], dec_data, data[2], data[2] + bss, PF_R | PF_W),
    ]


def envelopper(code, exheader=None):
    segs = segments_depuis_exheader(exheader, len(code)) if exheader else None
    if not segs:
        segs = [(BASE, 0, len(code), len(code), PF_R | PF_W | PF_X)]
    ehsize, phsize = 52, 32
    debut_code = ehsize + phsize * len(segs)
    debut_code = (debut_code + 0xFFF) & ~0xFFF   # le code reste aligné sur une page, comme en mémoire
    entete = struct.pack('<4sBBBBB7xHHIIIIIHHHHHH',
                         b'\x7fELF', 1, 1, 1, 0, 0,   # 32 bits, little-endian, version 1, System V
                         2, EM_ARM, 1, BASE, ehsize, 0, EF_ARM_EABI_VER5,
                         ehsize, phsize, len(segs), 40, 0, 0)
    phdrs = b''.join(struct.pack('<IIIIIIII', 1, debut_code + dec, adr, adr, tf, tm, drap, 0x1000)
                     for adr, dec, tf, tm, drap in segs)
    return entete + phdrs + b'\x00' * (debut_code - ehsize - len(phdrs)) + code


def lire_segments(elf):
    """Relit les segments d'un ELF 32 bits : [(adresse, decalage, taille fichier, taille memoire, drapeaux)]."""
    assert elf[:4] == b'\x7fELF'
    e_phoff, = struct.unpack_from('<I', elf, 28)
    e_phentsize, e_phnum = struct.unpack_from('<HH', elf, 42)
    out = []
    for i in range(e_phnum):
        p_type, p_offset, p_vaddr, _, p_filesz, p_memsz, p_flags, _ = struct.unpack_from('<IIIIIIII', elf, e_phoff + i * e_phentsize)
        if p_type == 1:
            out.append((p_vaddr, p_offset, p_filesz, p_memsz, p_flags))
    return out


def test():
    code = bytes(range(256)) * 20
    elf = envelopper(code)
    segs = lire_segments(elf)
    assert len(segs) == 1 and segs[0][0] == BASE and segs[0][2] == len(code)
    assert elf[segs[0][1]:segs[0][1] + len(code)] == code
    assert struct.unpack_from('<H', elf, 18)[0] == EM_ARM and struct.unpack_from('<I', elf, 24)[0] == BASE
    # Un exheader fabriqué : .text 0x1800 octets, .rodata 0x400, .data 0x200, bss 0x1000.
    code = bytes([0xAA]) * 0x2000 + bytes([0xBB]) * 0x1000 + bytes([0xCC]) * 0x200
    ex = bytearray(0x400)
    struct.pack_into('<III', ex, 0x10, BASE, 2, 0x1800)
    struct.pack_into('<III', ex, 0x20, BASE + 0x2000, 1, 0x400)
    struct.pack_into('<III', ex, 0x30, BASE + 0x3000, 1, 0x200)
    struct.pack_into('<I', ex, 0x3C, 0x1000)
    elf = envelopper(code, bytes(ex))
    segs = lire_segments(elf)
    assert [s[0] for s in segs] == [BASE, BASE + 0x2000, BASE + 0x3000]
    assert segs[2][3] == 0x200 + 0x1000 and segs[1][4] == PF_R
    assert elf[segs[1][1]:segs[1][1] + 4] == b'\xBB' * 4 and elf[segs[2][1]:segs[2][1] + 4] == b'\xCC' * 4
    # Un exheader incohérent retombe sur le segment unique.
    assert len(lire_segments(envelopper(code, b'\x00' * 0x400))) == 1
    print('elfer : ELF à un segment et à trois segments relus, exheader faux ignoré.')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['test']:
        test()
    elif 1 <= len(args) <= 2:
        with open(args[0], 'rb') as f:
            code = f.read()
        exh = os.path.join(os.path.dirname(args[0]), 'exheader.bin')
        exheader = open(exh, 'rb').read() if os.path.isfile(exh) else None
        sortie = args[1] if len(args) == 2 else os.path.splitext(args[0])[0] + '.elf'
        elf = envelopper(code, exheader)
        with open(sortie, 'wb') as f:
            f.write(elf)
        print('%s : %d octets, %d segment(s)%s -> %s' % (os.path.basename(args[0]), len(code), len(lire_segments(elf)),
                                                       ' d\'après exheader.bin' if exheader and len(lire_segments(elf)) == 3 else '', sortie))
    else:
        print(__doc__)
