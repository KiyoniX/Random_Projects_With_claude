"""Découpe un FIRM déchiffré (le NATIVE_FIRM dumpé par GodMode9) en morceaux que ghidra_raw.py sait ouvrir.

    python firm.py local/dump/systeme/native.firm [dossier]    tout, dans local/extrait/firm/ par défaut
    python firm.py map [cœur ...]                               la carte virtuelle de kernel11, lue dans ses tables de
                                                                pages, et la vérification de raw_targets.toml
    python firm.py test

Ce qu'il écrit (dans local/extrait/firm/) :
    firm_<n>_<adresse>.bin          chaque section, nommée comme le fait ctrtool (empreinte SHA-256 vérifiée)
    <module>.cxi                    les modules de démarrage rangés dans une section ARM11 (sm, fs, pm, loader, pxi)
    arm9/kernel9.bin                le noyau ARM9, à charger à l'adresse donnée dans arm9/layout.txt
    arm9/process9/exefs/code.bin    le code de Process9 (.text, .rodata, .data), avec exefs/exheader.bin à côté,
                                    comme un module extrait : ghidra_raw.py l'enveloppe en ELF par elfer.py
    arm9/process9/ncch_header.bin   l'en-tête NCCH de Process9
    arm9/arm9loader.bin             le chargeur ARM9 de la New 3DS, qui suit le binaire ARM9
    arm9/layout.txt                 adresses et tailles de chaque morceau
    kernel11/kernel11.elf           kernel11 remis à ses adresses virtuelles : un segment par morceau, plus des
                                    segments vides pour la mémoire qui n'existe qu'à l'exécution
    kernel11/layout.txt             la carte utilisée

Pourquoi. ctrtool (extraire.py) sort les sections d'un FIRM, mais rien de plus. Dans la section ARM9 sont collés
l'en-tête du binaire ARM9 (« K9L2 » sur la New 3DS : 0x800 octets de champs de clés, jamais recopiés ici), kernel9,
le NCCH de Process9 et le chargeur. Et kernel11 ne s'exécute pas là où il est chargé : son démarrage recopie des
morceaux de la section ailleurs et les place à 0xFFF00000 et plus haut par la MMU. Pour que les adresses de Ghidra
soient celles du code, il faut cette carte : elle a été lue dans le démarrage (les appels de recopie) et dans les
tables de pages que construit 0x1FFAF5A4, qu'on exécute ici sous unicorn (« map ») pour la vérifier. La carte est
dans raw_targets.toml, section [kernel11.firm].

Ce qu'il ne fait pas. Il ne déchiffre rien : un FIRM chiffré, ou une section ARM9 encore chiffrée, donne des morceaux
illisibles (signalé quand Process9 n'est pas trouvé). Il ne retrouve pas seul la carte de kernel11 : pour un autre
FIRM, « map » montre les tables de pages, mais les décalages dans la section (d'où vient chaque morceau) se relisent
dans le code de démarrage, et il refuse d'écrire l'ELF si le point d'entrée ARM11 n'est pas celui de la carte. Il ne
décompresse pas un .code compressé (Process9 ne l'est pas sur cette console).
"""
import glob
import hashlib
import os
import struct
import sys
import tempfile

import elfer
import ghidra_raw

ROOT = ghidra_raw.ROOT
DEFAULT_FIRM = os.path.join(ROOT, 'local', 'dump', 'systeme', 'native.firm')
DEFAULT_OUT = os.path.join(ROOT, 'local', 'extrait', 'firm')
SECTION_HEADERS, SECTION_HEADER_SIZE, SECTION_COUNT = 0x40, 0x30, 4
ARM9_BIN_HEADER = 0x800
MEDIA_UNIT = 0x200
EXHEADER_SIZE = 0x400
ELF_HEADER_SIZE, PROGRAM_HEADER_SIZE, PAGE = 52, 32, 0x1000
EF_ARM_EABI_VER5 = 0x05000000
MMU_SENTINEL = 0x00001000
MMU_MAX_INSTRUCTIONS = 50_000_000


def read_firm(data):
    """L'en-tête d'un FIRM (3dbrew, « FIRM ») : rend (entrée ARM11, entrée ARM9, sections), une section étant
    (numéro, décalage, adresse de chargement, taille, méthode de copie, empreinte juste)."""
    if data[:4] != b'FIRM':
        raise ValueError('pas un FIRM (signature %r)' % data[:4])
    arm11_entry, arm9_entry = struct.unpack_from('<II', data, 0x08)
    sections = []
    for index in range(SECTION_COUNT):
        at = SECTION_HEADERS + SECTION_HEADER_SIZE * index
        offset, load, size, method = struct.unpack_from('<IIII', data, at)
        if not size:
            continue
        if offset + size > len(data):
            raise ValueError('section %d hors du fichier' % index)
        good = hashlib.sha256(data[offset:offset + size]).digest() == data[at + 0x10:at + 0x30]
        sections.append((index, offset, load, size, method, good))
    return arm11_entry, arm9_entry, sections


def section_containing(sections, address):
    for section in sections:
        if section[2] <= address < section[2] + section[3]:
            return section
    return None


def split_arm9(section, load):
    """La section ARM9 -> ({nom de fichier: octets}, lignes de layout.txt). Les champs de clés de l'en-tête ne sont
    jamais recopiés."""
    header, loader_start = 0, None
    if section[0x50:0x53] == b'K9L':
        # L'en-tête du binaire ARM9 de la New 3DS : la taille du binaire est écrite en décimal ASCII à +0x30.
        header = ARM9_BIN_HEADER
        loader_start = header + int(section[0x30:0x40].split(b'\0')[0].decode('ascii'))
    ncch = section.find(b'NCCH', header) - 0x100
    if ncch < header or section[ncch + 0x100:ncch + 0x104] != b'NCCH':
        raise ValueError('pas de NCCH de Process9 dans la section ARM9 (encore chiffrée ?)')
    ncch_size = struct.unpack_from('<I', section, ncch + 0x104)[0] * MEDIA_UNIT
    exheader = section[ncch + 0x200:ncch + 0x200 + EXHEADER_SIZE]
    exefs = ncch + struct.unpack_from('<I', section, ncch + 0x1A0)[0] * MEDIA_UNIT
    name, file_offset, file_size = struct.unpack_from('<8sII', section, exefs)
    if name.rstrip(b'\0') != b'.code':
        raise ValueError('le premier fichier de l\'exefs de Process9 n\'est pas .code')
    if exheader[0xD] & 1:
        raise ValueError('le .code de Process9 est compressé : non géré')
    code_start = exefs + 0x200 + file_offset
    code = section[code_start:code_start + file_size]
    if elfer.segments_depuis_exheader(exheader, len(code)) is None:
        raise ValueError('exheader de Process9 incohérent avec son .code')
    text, ro, rw = (struct.unpack_from('<III', exheader, at) for at in (0x10, 0x20, 0x30))
    bss = struct.unpack_from('<I', exheader, 0x3C)[0]
    files = {'kernel9.bin': section[header:ncch],
             'process9/exefs/code.bin': code,
             'process9/exefs/exheader.bin': exheader,
             'process9/ncch_header.bin': section[ncch:ncch + 0x200]}
    lines = ['section            %#010x  %#x octets' % (load, len(section))]
    if header:
        lines.append('en-tête arm9bin    %#010x  %#x octets (champs de clés, non recopiés)  version %s'
                     % (load, header, section[0x50:0x54].decode('ascii', 'replace')))
    lines += ['kernel9            %#010x  %#x octets' % (load + header, ncch - header),
              'process9 ncch      %#010x  %#x octets, nom %s, titre %016x'
              % (load + ncch, ncch_size, exheader[:8].rstrip(b'\0').decode('ascii', 'replace'),
                 struct.unpack_from('<Q', section, ncch + 0x108)[0]),
              'process9 .code     %#010x  %#x octets' % (load + code_start, file_size),
              'process9 .text     %#010x  %#x octets' % (text[0], text[2]),
              'process9 .rodata   %#010x  %#x octets' % (ro[0], ro[2]),
              'process9 .data     %#010x  %#x octets' % (rw[0], rw[2]),
              'process9 .bss      %#010x  %#x octets' % (rw[0] + rw[2], bss)]
    if loader_start is not None and loader_start < len(section):
        files['arm9loader.bin'] = section[loader_start:]
        lines.append('chargeur ARM9      %#010x  %#x octets' % (load + loader_start, len(section) - loader_start))
    return files, lines


def make_kernel_elf(section, layout):
    """kernel11 en ELF : un segment par morceau à son adresse virtuelle, puis la mémoire d'exécution, sans octets."""
    headers, blobs, offset = [], [], PAGE
    for _, va, file_offset, size, memsize, flags, _ in layout['pieces']:
        if file_offset + size > len(section):
            raise ValueError('morceau à %#x hors de la section' % va)
        headers.append((1, offset, va, va, size, memsize, flags, PAGE))
        blobs.append((offset, section[file_offset:file_offset + size]))
        offset += (size + PAGE - 1) & ~(PAGE - 1)
    for _, va, size, flags in layout['runtime']:
        headers.append((1, offset, va, va, 0, size, flags, PAGE))
    out = bytearray(offset)
    struct.pack_into('<4sBBBBB7sHHIIIIIHHHHHH', out, 0, b'\x7fELF', 1, 1, 1, 0, 0, bytes(7),
                     2, elfer.EM_ARM, 1, layout['entry'], ELF_HEADER_SIZE, 0, EF_ARM_EABI_VER5,
                     ELF_HEADER_SIZE, PROGRAM_HEADER_SIZE, len(headers), 40, 0, 0)
    for index, program_header in enumerate(headers):
        struct.pack_into('<IIIIIIII', out, ELF_HEADER_SIZE + PROGRAM_HEADER_SIZE * index, *program_header)
    for at, blob in blobs:
        out[at:at + len(blob)] = blob
    return bytes(out)


def kernel_layout_lines(layout):
    lines = ['%-16s VA %#010x  section +%#07x  %#07x octets (%#07x en mémoire)  %s'
             % (name, va, offset, size, memsize, flags_text(flags)) for name, va, offset, size, memsize, flags, _ in
             layout['pieces']]
    lines += ['%-16s VA %#010x  %#x octets, à l\'exécution seulement  %s' % (name, va, size, flags_text(flags))
              for name, va, size, flags in layout['runtime']]
    return lines


def flags_text(flags):
    return ''.join(letter for letter, bit in (('r', elfer.PF_R), ('w', elfer.PF_W), ('x', elfer.PF_X)) if flags & bit)


def write_file(path, data):
    """Des octets tels quels, ou un texte en UTF-8 avec des fins de ligne LF."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(data, str):
        data = data.encode('utf-8')
    with open(path, 'wb') as f:
        f.write(data)


def split_pieces(firm_path, out, layout=None, verbose=True):
    """La section ARM9 en morceaux et kernel11 en ELF. Rend la liste des fichiers écrits."""
    say = print if verbose else (lambda *_: None)
    if layout is None:
        layout = ghidra_raw.load_targets()['kernel11']['firm']
    with open(firm_path, 'rb') as f:
        data = f.read()
    arm11_entry, arm9_entry, sections = read_firm(data)
    written = []
    arm9 = section_containing(sections, arm9_entry)
    if arm9 is None:
        say('Aucune section ne contient le point d\'entrée ARM9 %#x.' % arm9_entry)
    else:
        _, offset, load, size, _, _ = arm9
        files, lines = split_arm9(data[offset:offset + size], load)
        lines.append('point d\'entrée     %#010x' % arm9_entry)
        for name, content in sorted(files.items()):
            write_file(os.path.join(out, 'arm9', name), content)
            written.append(os.path.join('arm9', name))
        write_file(os.path.join(out, 'arm9', 'layout.txt'), '\n'.join(lines) + '\n')
        say('\n'.join('  ' + line for line in lines))
    kernel = section_containing(sections, arm11_entry)
    if kernel is None or kernel[2] != layout['load']:
        say('Pas de section ARM11 chargée à %#x : pas de kernel11.elf.' % layout['load'])
    elif arm11_entry != layout['entry']:
        say('Le point d\'entrée ARM11 est %#x, la carte de raw_targets.toml a été lue pour %#x : ce n\'est pas le '
            'même FIRM. Relire la carte (firm.py map, puis le code de démarrage) avant de fabriquer kernel11.elf.'
            % (arm11_entry, layout['entry']))
    else:
        _, offset, load, size, _, _ = kernel
        write_file(os.path.join(out, 'kernel11', 'kernel11.elf'), make_kernel_elf(data[offset:offset + size], layout))
        lines = kernel_layout_lines(layout)
        write_file(os.path.join(out, 'kernel11', 'layout.txt'), '\n'.join(lines) + '\n')
        written.append(os.path.join('kernel11', 'kernel11.elf'))
        say('  kernel11.elf : %d morceaux, %d blocs d\'exécution' % (len(layout['pieces']), len(layout['runtime'])))
    return written


def split_firm(firm_path, out):
    """Tout : les sections, les modules de démarrage, puis split_pieces."""
    import extraire  # pour les modules de démarrage, déjà lus là par modules_du_firm
    with open(firm_path, 'rb') as f:
        data = f.read()
    arm11_entry, arm9_entry, sections = read_firm(data)
    print('%s : entrée ARM11 %#x, entrée ARM9 %#x' % (os.path.basename(firm_path), arm11_entry, arm9_entry))
    os.makedirs(out, exist_ok=True)
    for index, offset, load, size, method, good in sections:
        name = 'firm_%d_%08x.bin' % (index, load)
        write_file(os.path.join(out, name), data[offset:offset + size])
        print('  %-22s %#x octets, copie %d, empreinte %s' % (name, size, method, 'juste' if good else 'FAUSSE'))
        for module, title, module_size in extraire.modules_du_firm(os.path.join(out, name), out):
            print('    %-18s %#x octets, titre %016X' % (module + '.cxi', module_size, title))
    split_pieces(firm_path, out)
    print('-> %s' % out)


def mmu_map(section, layout, core):
    """Exécute sous unicorn le constructeur des tables de pages de kernel11 pour un cœur, puis lit les tables qu'il a
    écrites. Rend (adresse de la table L1, [[va, pa, taille, droits]] fusionnées en suites)."""
    import emulate_dispatch
    unicorn, _ = emulate_dispatch.import_emulator()
    from unicorn import arm_const
    emulator = unicorn.Uc(unicorn.UC_ARCH_ARM, unicorn.UC_MODE_ARM)
    emulator.mem_map(0x1F000000, 0x01000000)       # VRAM et AXI WRAM, où vit l'image et où vont les tables
    emulator.mem_map(0x00000000, 0x00010000)
    emulator.mem_write(layout['load'], section)
    emulator.reg_write(arm_const.UC_ARM_REG_SP, 0x1FFFF000)
    emulator.reg_write(arm_const.UC_ARM_REG_R0, core)
    emulator.reg_write(arm_const.UC_ARM_REG_LR, MMU_SENTINEL)
    emulator.emu_start(layout['page_table_builder'], MMU_SENTINEL, count=MMU_MAX_INSTRUCTIONS)
    l1 = struct.unpack('<I', emulator.mem_read(layout['l1_table_pointers'] + 4 * core, 4))[0]

    def read(address):
        return struct.unpack('<I', emulator.mem_read(address, 4))[0]

    entries = []
    for index in range(4096):
        descriptor = read(l1 + 4 * index)
        va = index << 20
        if descriptor & 3 == 2:
            if descriptor & (1 << 18):     # supersection de 16 Mo
                entries.append((va, (descriptor & 0xFF000000) + (va & 0x00F00000), 0x100000,
                                'supersection ap%d apx%d xn%d tex%d c%d b%d'
                                % ((descriptor >> 10) & 3, (descriptor >> 15) & 1, (descriptor >> 4) & 1,
                                   (descriptor >> 12) & 7, (descriptor >> 3) & 1, (descriptor >> 2) & 1)))
                continue
            entries.append((va, descriptor & 0xFFF00000, 0x100000,
                            '%s%s tex%d c%d b%d%s' % (access_text((descriptor >> 10) & 3, (descriptor >> 15) & 1),
                                                      ' xn' if descriptor >> 4 & 1 else ' x', (descriptor >> 12) & 7,
                                                      (descriptor >> 3) & 1, (descriptor >> 2) & 1,
                                                      ' ng' if descriptor & (1 << 17) else '')))
        elif descriptor & 3 == 1:          # table L2 grossière
            l2 = descriptor & 0xFFFFFC00
            for sub in range(256):
                small = read(l2 + 4 * sub)
                page_va = va + (sub << 12)
                if small & 3 == 0:
                    continue
                access = access_text((small >> 4) & 3, (small >> 9) & 1)
                if small & 2:              # petite page de 4 Ko, XN au bit 0
                    entries.append((page_va, small & 0xFFFFF000, 0x1000,
                                    '%s%s tex%d c%d b%d%s' % (access, ' xn' if small & 1 else ' x', (small >> 6) & 7,
                                                              (small >> 3) & 1, (small >> 2) & 1,
                                                              ' ng' if small & (1 << 11) else '')))
                else:                      # grande page de 64 Ko, XN au bit 15
                    entries.append((page_va, (small & 0xFFFF0000) + (page_va & 0xF000), 0x1000,
                                    '%s%s large' % (access, ' xn' if small & 0x8000 else ' x')))
    runs = []
    for va, pa, size, attributes in entries:
        if runs and runs[-1][0] + runs[-1][2] == va and runs[-1][1] + runs[-1][2] == pa and runs[-1][3] == attributes:
            runs[-1][2] += size
        else:
            runs.append([va, pa, size, attributes])
    return l1, runs


def access_text(ap, apx):
    """Les droits ARMv6 (AP[1:0] et APX) : « privilégié/utilisateur »."""
    table = {(0, 0): 'none/none', (0, 1): 'rw/none', (0, 2): 'rw/r', (0, 3): 'rw/rw',
             (1, 1): 'r/none', (1, 2): 'r/r', (1, 3): 'r/r'}
    return table.get((apx, ap), 'ap%d apx%d' % (ap, apx))


def check_pieces(runs, layout):
    """Chaque morceau de la carte doit être là où les tables de pages le mettent, exécutable s'il est « x ».
    Rend les lignes du constat et le nombre d'écarts."""
    lines, problems = [], 0
    for name, va, _, _, memsize, flags, pa in layout['pieces']:
        issues = []
        for address in range(va, va + memsize, 0x1000):
            run = next((r for r in runs if r[0] <= address < r[0] + r[2]), None)
            if run is None:
                issues.append('%#x non projetée' % address)
                break
            if pa is not None and run[1] + address - run[0] != pa + address - va:
                issues.append('%#x -> PA %#x, la carte dit %#x' % (address, run[1] + address - run[0],
                                                                    pa + address - va))
                break
            if (' xn' not in run[3] and 'xn1' not in run[3]) != bool(flags & elfer.PF_X):
                issues.append('%#x : droit d\'exécution différent (%s)' % (address, run[3]))
                break
        problems += bool(issues)
        lines.append('%-10s VA %#010x -> PA %#010x  %s' % (name, va, pa or 0, '; '.join(issues) or 'conforme'))
    return lines, problems


def show_map(cores):
    layout = ghidra_raw.load_targets()['kernel11']['firm']
    found = glob.glob(os.path.join(DEFAULT_OUT, 'firm_*_%08x.bin' % layout['load']))
    if not found:
        sys.exit('Pas de section kernel11 dans %s : lancer d\'abord firm.py sur native.firm.' % DEFAULT_OUT)
    with open(found[0], 'rb') as f:
        section = f.read()
    text = []
    for core in cores:
        l1, runs = mmu_map(section, layout, core)
        text.append('cœur %d : table L1 à %#x' % (core, l1))
        text += ['  VA %08x-%08x -> PA %08x  (%#x)  %s' % (va, va + size, pa, size, attributes)
                 for va, pa, size, attributes in runs]
        if core == cores[0]:
            checked, problems = check_pieces(runs, layout)
    text += ['', 'Les morceaux de raw_targets.toml dans la carte du cœur %d :' % cores[0]] + ['  ' + l for l in checked]
    text.append('%d écart(s)' % problems)
    write_file(os.path.join(DEFAULT_OUT, 'kernel11', 'mmu_map.txt'), '\n'.join(text) + '\n')
    print('\n'.join(text))
    print('-> %s' % os.path.join(DEFAULT_OUT, 'kernel11', 'mmu_map.txt'))


def make_fake_firm(layout):
    """Un FIRM fabriqué pour le test : une section ARM9 (en-tête K9L2 sans clés, faux kernel9, NCCH de Process9,
    chargeur) et une section kernel11 où chaque morceau porte une marque. Aucun octet d'un vrai dump."""
    arm9_load = 0x08006000
    kernel9 = bytes([0x99]) * 0x300
    code = bytes([0xC1]) * 0x1000 + bytes([0xC2]) * 0x1000 + bytes([0xC3]) * 0x100
    exheader = bytearray(EXHEADER_SIZE)
    exheader[:8] = b'Process9'
    struct.pack_into('<III', exheader, 0x10, 0x08028000, 1, 0x1000)
    struct.pack_into('<III', exheader, 0x20, 0x08029000, 1, 0x1000)
    struct.pack_into('<III', exheader, 0x30, 0x0802A000, 1, 0x100)
    struct.pack_into('<I', exheader, 0x3C, 0x400)
    exefs = bytearray(0x200)
    struct.pack_into('<8sII', exefs, 0, b'.code', 0, len(code))
    ncch = bytearray(0xA00)
    ncch[0x100:0x104] = b'NCCH'
    struct.pack_into('<IQ', ncch, 0x104, (0xA00 + 0x200 + len(code) + MEDIA_UNIT - 1) // MEDIA_UNIT, 0x0004013000003000)
    struct.pack_into('<I', ncch, 0x1A0, 0xA00 // MEDIA_UNIT)
    ncch[0x200:0x600] = exheader
    ncch = bytes(ncch) + bytes(exefs) + code
    binary = kernel9 + ncch
    header = bytearray(ARM9_BIN_HEADER)
    header[0x30:0x30 + len(str(len(binary)))] = str(len(binary)).encode('ascii')
    header[0x50:0x54] = b'K9L2'
    loader = bytes([0x7E]) * 0x80
    arm9 = bytes(header) + binary + loader
    kernel = bytearray(max(offset + size for _, _, offset, size, _, _, _ in layout['pieces']))
    for index, (_, _, offset, size, _, _, _) in enumerate(layout['pieces']):
        kernel[offset:offset + 4] = bytes([0xA0 + index]) * 4
    sections = [(0x400, layout['load'], bytes(kernel)), (0x400 + len(kernel), arm9_load, arm9)]
    firm = bytearray(0x400)
    firm[:4] = b'FIRM'
    struct.pack_into('<II', firm, 0x08, layout['entry'], arm9_load + ARM9_BIN_HEADER + 0x10)
    for index, (offset, load, content) in enumerate(sections):
        at = SECTION_HEADERS + SECTION_HEADER_SIZE * index
        struct.pack_into('<IIII', firm, at, offset, load, len(content), 1)
        firm[at + 0x10:at + 0x30] = hashlib.sha256(content).digest()
    firm = bytes(firm) + b''.join(content for _, _, content in sections)
    return firm, kernel9, code, bytes(exheader), loader


def test():
    """Sans dump : un faux FIRM fabriqué ici, découpé, et l'ELF de kernel11 relu morceau par morceau."""
    layout = ghidra_raw.load_targets()['kernel11']['firm']
    firm, kernel9, code, exheader, loader = make_fake_firm(layout)
    arm11_entry, arm9_entry, sections = read_firm(firm)
    assert arm11_entry == layout['entry'] and len(sections) == 2 and all(s[5] for s in sections)
    with tempfile.TemporaryDirectory() as out:
        path = os.path.join(out, 'faux.firm')
        with open(path, 'wb') as f:
            f.write(firm)
        written = split_pieces(path, out, layout, verbose=False)

        def read(name):
            with open(os.path.join(out, name), 'rb') as f:
                return f.read()
        assert read('arm9/kernel9.bin') == kernel9 and read('arm9/arm9loader.bin') == loader
        assert read('arm9/process9/exefs/code.bin') == code and read('arm9/process9/exefs/exheader.bin') == exheader
        assert read('arm9/process9/ncch_header.bin')[0x100:0x104] == b'NCCH'
        assert b'K9L2' not in b''.join(read(name) for name in written if name.startswith('arm9'))
        elf = read('kernel11/kernel11.elf')
        segments = elfer.lire_segments(elf)
        assert len(segments) == len(layout['pieces']) + len(layout['runtime'])
        for index, (_, va, _, size, memsize, flags, _) in enumerate(layout['pieces']):
            address, offset, file_size, memory_size, segment_flags = segments[index]
            assert (address, file_size, memory_size, segment_flags) == (va, size, memsize, flags)
            assert elf[offset:offset + 4] == bytes([0xA0 + index]) * 4
        assert struct.unpack_from('<I', elf, 24)[0] == layout['entry']
        assert all(segment[2] == 0 for segment in segments[len(layout['pieces']):])
    # Un FIRM dont l'entrée ARM11 n'est pas celle de la carte : pas d'ELF.
    other = bytearray(firm)
    struct.pack_into('<I', other, 0x08, layout['entry'] + 4)
    with tempfile.TemporaryDirectory() as out:
        path = os.path.join(out, 'autre.firm')
        with open(path, 'wb') as f:
            f.write(other)
        assert not any('kernel11' in name for name in split_pieces(path, out, layout, verbose=False))
    print('firm : faux FIRM lu (empreintes justes), kernel9, Process9 et chargeur découpés sans l\'en-tête de clés, '
          'kernel11.elf relu morceau par morceau, FIRM étranger refusé.')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    if args[:1] == ['test']:
        test()
    elif args[:1] == ['map']:
        show_map([int(a) for a in args[1:]] or [0])
    elif 1 <= len(args) <= 2:
        split_firm(args[0], args[1] if len(args) == 2 else DEFAULT_OUT)
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
