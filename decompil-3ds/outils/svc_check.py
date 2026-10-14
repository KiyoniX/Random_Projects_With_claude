"""Recoupe les appels système (svc) cités par les fiches avec kernel11 et avec les exheaders des modules.

    python svc_check.py         le constat, module par module
    python svc_check.py test    le test : sans dump, la lecture des tableaux et des masques ; avec, le recoupement

Pour chaque fiche de module qui a un tableau des svc (lignes « | Nom | `0xNN` | ... »), et pour le code de Pokémon X
(les instructions « svc » de son code ARM), chaque numéro doit :
    - avoir une entrée dans la table des svc de kernel11 (la table « pointers » de la cible kernel11 de
      raw_targets.toml), et cette entrée ne doit pas être une souche qui rend 0xF8C007F4 (« non implémenté ») ;
    - porter dans la fiche le nom que lui donne 3dbrew, tel qu'il est recopié dans le tableau des svc de
      fiches/kernel11.md ;
    - être permis par le masque des svc de l'exheader du module (les descripteurs 0b11110 de l'ARM11 kernel caps).

Pourquoi. Une fiche écrite à partir du pseudo-code peut se tromper de numéro (deux svc voisins), ou citer un svc que
le module n'a pas le droit d'appeler : ce recoupement l'attrape sans relire la fiche.

Ce qu'il ne fait pas. Il ne vérifie pas que la fiche cite TOUS les svc du module, ni les arguments. Il a besoin de
kernel11.elf (firm.py) et des exheaders extraits (extraire.py) : sans eux, le test ne lit que ses propres exemples.
"""
import os
import re
import struct
import sys
from collections import defaultdict

import ghidra_raw

ROOT = ghidra_raw.ROOT
FICHES = os.path.join(ROOT, 'fiches')
EXTRACTED = os.path.join(ROOT, 'local', 'extrait')
GAME = ('pokemon-x', 'maj')     # le nom de la fiche du jeu, et son dossier extrait (la mise à jour)
FICHE_ROW = re.compile(r'^\| ([A-Za-z0-9]+) \| `0x([0-9A-Fa-f]{2})` \|', re.M)
KERNEL_ROW = re.compile(r'^\| `0x([0-9A-Fa-f]{2})` \| ([A-Za-z0-9]+|—) \|', re.M)
NOT_IMPLEMENTED_STUB = (0xE59F0000, 0xE12FFF1E, 0xF8C007F4)   # ldr r0, [pc] ; bx lr ; .word 0xF8C007F4
SVC_CAPABILITY_OFFSET, SVC_CAPABILITY_COUNT = 0x370, 28


def fiche_svcs(text):
    """{numéro: nom} d'après les lignes « | Nom | `0xNN` | » d'une fiche."""
    return {int(number, 16): name for name, number in FICHE_ROW.findall(text)}


def kernel_names(text):
    """{numéro: nom de 3dbrew} d'après le tableau des svc de fiches/kernel11.md."""
    return {int(number, 16): name for number, name in KERNEL_ROW.findall(text) if name != '—'}


def exheader_svc_mask(exheader):
    """Les svc permis par un exheader : les descripteurs dont les 5 bits du haut valent 0b11110 portent 24 bits de
    masque, l'index (bits 24 à 26) disant quels 24 numéros."""
    allowed = set()
    for descriptor in struct.unpack_from('<%dI' % SVC_CAPABILITY_COUNT, exheader, SVC_CAPABILITY_OFFSET):
        if descriptor >> 27 == 0b11110:
            index = (descriptor >> 24) & 7
            allowed |= {index * 24 + bit for bit in range(24) if descriptor >> bit & 1}
    return allowed


def code_svcs(code):
    """{numéro: nombre} des instructions « svc #N » ARM d'un code.bin."""
    used = defaultdict(int)
    for offset in range(0, len(code) - 3, 4):
        word = struct.unpack_from('<I', code, offset)[0]
        if word & 0xFFFFFF00 == 0xEF000000:
            used[word & 0xFF] += 1
    return used


def check(used, table, names, mask, is_game=False):
    """Les problèmes d'une liste de svc : [« 0xNN Nom : problème ; problème »]."""
    bad = []
    for number, name in sorted(used.items()):
        issues = []
        handler = table.get(number)
        if not handler:
            issues.append('absent de la table du noyau')
        elif tuple(handler[1]) == NOT_IMPLEMENTED_STUB:
            issues.append('souche qui rend 0xF8C007F4')
        if not is_game and names.get(number) and names[number] != name:
            issues.append('nommé %s dans la fiche, %s dans 3dbrew' % (name, names[number]))
        if mask is not None and number not in mask:
            issues.append('absent du masque des svc de l\'exheader')
        if issues:
            bad.append('%#04x %s : %s' % (number, name, ' ; '.join(issues)))
    return bad


def read(path, mode='rb'):
    with open(path, mode, **({'encoding': 'utf-8'} if 'b' not in mode else {})) as f:
        return f.read()


def kernel_table():
    """{numéro: (entrée, ses trois premiers mots)} de la table des svc de kernel11, ou None sans kernel11.elf."""
    target = ghidra_raw.load_targets()['kernel11']
    if not os.path.isfile(target['input']):
        return None
    image, _, _ = ghidra_raw.load_image(target)
    at, count, _ = next(table for table in target['seed_tables'] if table[2] == 'pointers')
    table = {}
    for number in range(count):
        handler = image.word(at + 4 * number)
        if handler:
            table[number] = (handler, [image.word(handler + 4 * index) for index in range(3)])
    return table


def crosscheck():
    """Rend (lignes du constat, nombre de problèmes), ou None si kernel11.elf manque."""
    table = kernel_table()
    if table is None:
        return None
    names = kernel_names(read(os.path.join(FICHES, 'kernel11.md'), 'r'))
    lines, problems = [], 0
    sources = []
    for entry in sorted(os.listdir(FICHES)):
        module = entry[:-3]
        exheader = os.path.join(EXTRACTED, module, 'exefs', 'exheader.bin')
        if not entry.endswith('.md') or not os.path.isfile(exheader):
            continue        # kernel11.md, process9.md (svc de l'ARM9), les contrats : pas des modules extraits
        used = fiche_svcs(read(os.path.join(FICHES, entry), 'r'))
        if used:
            sources.append((module, used, exheader_svc_mask(read(exheader)), False))
    game_code = os.path.join(EXTRACTED, GAME[1], 'exefs', 'code.bin')
    if os.path.isfile(game_code):
        used = {number: names.get(number, '?') for number in code_svcs(read(game_code))}
        sources.append(('%s (%s)' % GAME, used, exheader_svc_mask(read(os.path.join(EXTRACTED, GAME[1], 'exefs',
                                                                                      'exheader.bin'))), True))
    for module, used, mask, is_game in sources:
        bad = check(used, table, names, mask, is_game)
        problems += len(bad)
        lines.append('%-18s %2d svc, %s' % (module, len(used), 'tous présents et permis' if not bad else ' | '.join(bad)))
    lines.append('%d problème(s)' % problems)
    return lines, problems


def test():
    """Sans dump : un tableau de fiche, un tableau de kernel11.md et un exheader fabriqués. Avec kernel11.elf et les
    exheaders extraits : le recoupement réel, qui doit être sans problème."""
    text = '| Nom | N° |\n| --- | --- |\n| ControlMemory | `0x01` | x |\n| SendSyncRequest | `0x32` | y |\n'
    assert fiche_svcs(text) == {0x01: 'ControlMemory', 0x32: 'SendSyncRequest'}
    assert kernel_names('| `0x00` | — | vide |\n| `0x01` | ControlMemory | `0xFFF0364C` |\n') == {1: 'ControlMemory'}
    exheader = bytearray(0x400)
    struct.pack_into('<II', exheader, SVC_CAPABILITY_OFFSET, 0xF0000002, 0xF1000001 | 1 << 8)   # svc 1 ; 24 et 32
    assert exheader_svc_mask(bytes(exheader)) == {1, 24, 32}
    assert code_svcs(struct.pack('<III', 0xEF000032, 0xE12FFF1E, 0xEF000032)) == {0x32: 2}
    table = {1: (0xFFF0364C, [0, 0, 0]), 0x32: (0xFFF0A000, list(NOT_IMPLEMENTED_STUB))}
    bad = check({1: 'ControlMemory', 0x32: 'SendSyncRequest', 0x40: 'X'}, table, {1: 'QueryMemory'}, {1, 0x32})
    assert len(bad) == 3 and '3dbrew' in bad[0] and 'souche' in bad[1] and 'masque' in bad[2], bad
    message = 'svc_check : tableaux des fiches, masque d\'exheader et souches lus sur des exemples.'
    result = crosscheck()
    if result is not None:
        lines, problems = result
        assert problems == 0, '\n'.join(lines)
        message += ' Vrais fichiers : %d sources recoupées avec kernel11, sans problème.' % (len(lines) - 1)
    print(message)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    if sys.argv[1:] == ['test']:
        test()
    else:
        result = crosscheck()
        if result is None:
            sys.exit('Pas de kernel11.elf : python outils/firm.py local/dump/systeme/native.firm')
        print('\n'.join(result[0]))
