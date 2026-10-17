"""Une passe de nommage rejouable : propose des noms de fonctions à partir de sources sûres, dit d'où vient chacun.

    python name_pass.py run   [--only S1,S2,...] [--out DOSSIER]     écrit les propositions, ne touche à aucune fiche
    python name_pass.py apply [--only S1,S2,...] [--out DOSSIER]     idem, puis verse les noms de confiance haute dans
                                                                     fiches/pokemon-x.noms.tsv et fiches/cro/<Module>.noms.tsv
    python name_pass.py test

        Sources (--only, séparées par des virgules ; toutes par défaut) :
          services   chaque commande de fiches/pokemon-x-services.tsv a sa fonction d'envoi nommée <service>_<Commande>
          cro        les noms exportés par les .cro (table d'exports nommés, OnLoad/OnExit/OnUnresolved de l'en-tête)
          svc        les fonctions qui ne font qu'un appel système (octets du « svc » décodés, journal du banc en contrôle)
          stdlib     memcpy, memset, strlen, divisions... reconnus en les EXÉCUTANT sur des entrées fabriquées
          rtti       les destructeurs des classes C++ : nom de classe lu dans le typeinfo, place dans la table virtuelle
          assert     les fonctions qui citent un seul fichier source (chemins de compilation du jeu et des bibliothèques)

Il lit (rien de ce qu'il lit ne sort de local/ ni n'est versionné) :
    local/extrait/maj/exefs/code.bin, local/extrait/maj/romfs/*.cro et static.crs
    local/analyse/maj/gh/funcs.tsv et refs.tsv (de `python outils/ghidra_direct.py maj`)
    local/analyse/banc*/journal.txt (facultatif : sert de contrôle aux appels système)
    fiches/pokemon-x.noms.tsv, fiches/pokemon-x-services.tsv, fiches/cro/<Module>.noms.tsv, ../carte-des-services/donnees.js

Il écrit dans local/analyse/names/ :
    proposals.tsv   adresse, nom, source, confiance, preuve (une ligne par proposition retenue ; pour un module .cro,
                    l'adresse s'écrit « Module+0xPOSITION », la position dans le fichier du module comme le journal du banc)
    collisions.tsv  ce qui a été écarté et pourquoi : adresse déjà nommée autrement, nom déjà pris à une autre adresse
    report.txt      le compteur : fonctions nommées avant et après, par source

Confiance :
    haute    deux voies indépendantes, ou une preuve par exécution : va dans les fiches avec `apply`
    moyenne  une seule voie (un fichier source cité, par exemple) : reste dans proposals.tsv
    basse    un indice : idem

Règles de nom. Anglais. Les noms C++ gardent leur forme manglée comme les 285 de static.crs. Les services s'écrivent
<préfixe>_<Commande> avec le préfixe déjà en usage dans pokemon-x.noms.tsv (gspgpu_TriggerCmdReqQueue). Un appel système
seul s'écrit svc<Nom> (svcConnectToPort). Une fonction de bibliothèque s'écrit comme la bibliothèque (memcpy,
__aeabi_uidivmod). Aucune collision : une adresse n'a qu'un nom, un nom n'a qu'une adresse ; si deux fonctions
se valent (deux copies de memcpy), la plus appelée garde le nom et l'autre prend « _alt_<adresse> ».

Ce qu'il ne fait pas : il ne nomme pas une fonction d'après son pseudo-code ni d'après sa seule taille, et il ne
devine pas le nom d'une méthode qui n'a aucune trace dans les chaînes, les exports ou les tables virtuelles.
"""
import bisect
import collections
import json
import os
import random
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PYLIB = os.path.join(ROOT, 'local', 'pylib')
FICHES = os.path.join(ROOT, 'fiches')
MAIN_NAMES = os.path.join(FICHES, 'pokemon-x.noms.tsv')
CRO_FICHES = os.path.join(FICHES, 'cro')           # un <Module>.noms.tsv par module .cro
SERVICES_TSV = os.path.join(FICHES, 'pokemon-x-services.tsv')
CARTE = os.path.join(os.path.dirname(ROOT), 'carte-des-services', 'donnees.js')
CODE_BIN = os.path.join(ROOT, 'local', 'extrait', 'maj', 'exefs', 'code.bin')
ROMFS = os.path.join(ROOT, 'local', 'extrait', 'maj', 'romfs')
GH = os.path.join(ROOT, 'local', 'analyse', 'maj', 'gh')
OUT = os.path.join(ROOT, 'local', 'analyse', 'names')
BASE = 0x100000

SOURCES = ['services', 'cro', 'svc', 'stdlib', 'rtti', 'assert']
LEVELS = {'haute': 3, 'moyenne': 2, 'basse': 1}
SVC_SEND_SYNC_REQUEST = 0x32


# --- Lecture des données ---

class Proposal:
    """Un nom proposé pour une fonction. module vide : le code principal ; address : adresse (principal) ou position."""

    def __init__(self, address, name, source, confidence, proof, module='', thumb=False):
        self.address = address
        self.name = name
        self.source = source
        self.confidence = confidence
        self.proof = proof
        self.module = module
        self.thumb = thumb

    def key(self):
        return (self.module, self.address)

    def label(self):
        if self.module:
            return '%s+%#x' % (self.module, self.address)
        return '%#x' % self.address


class Game:
    """code.bin, la liste de fonctions de Ghidra, les références, les noms déjà versionnés."""

    def __init__(self, code_path=CODE_BIN, gh=GH, names_path=MAIN_NAMES):
        with open(code_path, 'rb') as f:
            self.code = f.read()
        self.funcs = {}                      # début -> (taille, 'arm'|'thumb', nom Ghidra)
        path = os.path.join(gh, 'funcs.tsv')
        if os.path.isfile(path):
            for line in open(path, encoding='utf-8'):
                p = line.rstrip('\n').split('\t')
                if len(p) >= 3 and p[0].startswith('0x'):
                    self.funcs[int(p[0], 16)] = (int(p[1]), p[2], p[3] if len(p) > 3 else '')
        self.starts = sorted(self.funcs)
        self.names = read_names(names_path)  # adresse -> (genre, nom)
        self.calls = collections.defaultdict(list)    # fonction -> cibles appelées (appels et sauts sans retour)
        self.data_refs = collections.defaultdict(set)  # adresse visée -> fonctions qui la lisent
        path = os.path.join(gh, 'refs.tsv')
        if os.path.isfile(path):
            for line in open(path, encoding='utf-8'):
                p = line.rstrip('\n').split('\t')
                if len(p) < 4 or not p[3]:
                    continue
                kind = p[2]
                owner = int(p[3], 16)
                if 'CALL' in kind or kind == 'UNCONDITIONAL_JUMP':
                    self.calls[owner].append(int(p[1], 16))
                elif kind in ('DATA', 'READ', 'PARAM'):
                    self.data_refs[int(p[1], 16)].add(owner)
        self.text_end = BASE + len(self.code)

    def word(self, address):
        return struct.unpack_from('<I', self.code, address - BASE)[0]

    def owner(self, address):
        """Le début de la fonction qui contient (ou précède de près) cette adresse, ou None."""
        index = bisect.bisect_right(self.starts, address) - 1
        if index < 0:
            return None
        start = self.starts[index]
        return start if address - start < 0x4000 else None

    def called_count(self):
        count = collections.Counter()
        for owner, targets in self.calls.items():
            for target in set(targets):
                if target != owner:
                    count[target] += 1
        return count


def read_names(path):
    """fiches/*.noms.tsv : {adresse: (genre, nom)}."""
    names = {}
    if os.path.isfile(path):
        for line in open(path, encoding='utf-8'):
            p = line.rstrip('\n').split('\t')
            if len(p) >= 3 and p[0].startswith('0x'):
                names[int(p[0], 16)] = (p[1], p[2])
    return names


def load_carte(path=CARTE):
    try:
        text = open(path, encoding='utf-8').read()
    except OSError:
        return {}
    data, _ = json.JSONDecoder().raw_decode(text[text.index('{'):])
    return data


def svc_names():
    out = {}
    for entry in load_carte().get('svc', []):
        out[entry['n']] = entry['nom']
    return out


# --- Source : les services ---

def pass_services(game):
    """Vérifie que chaque commande de pokemon-x-services.tsv a sa fonction d'envoi nommée <préfixe>_<Commande>."""
    proposals, notes = [], []
    rows = [l.rstrip('\n').split('\t') for l in open(SERVICES_TSV, encoding='utf-8')][1:]
    prefixes = collections.defaultdict(collections.Counter)
    for r in rows:
        address = int(r[3], 16)
        if address in game.names:
            prefixes[r[0]][game.names[address][1].split('_')[0]] += 1
    prefix_of = {s: c.most_common(1)[0][0] for s, c in prefixes.items()}
    total = missing = wrong = 0
    for r in rows:
        service, header, command, address = r[0], r[1], r[2], int(r[3], 16)
        total += 1
        if not re.match(r'^[A-Za-z0-9]+$', command):
            continue            # « Inconnue » ou un commentaire : la fiche n'a pas de nom de commande
        expected = '%s_%s' % (prefix_of.get(service, ''), command)
        have = game.names.get(address)
        if have is None:
            missing += 1
            if service in prefix_of:
                kind = game.funcs.get(address, (0, 'arm'))[1]
                proposals.append(Proposal(address, expected, 'services', 'haute',
                                          'pokemon-x-services.tsv : %s %s envoyée par cette fonction' % (service, command),
                                          thumb=kind == 'thumb'))
        elif have[1] != expected and not have[1].endswith('_' + command):
            wrong += 1
            notes.append('%s %s (%#x) : nommée %s, le style donnerait %s' % (service, command, address, have[1], expected))
    notes.insert(0, 'services : %d lignes, %d sans nom, %d nommées autrement que <préfixe>_<Commande>' % (total, missing, wrong))
    return proposals, notes


# --- Source : les .cro ---

def pass_cro(game):
    """Les exports nommés et les trois crochets de l'en-tête de chaque module : la position est celle du fichier."""
    sys.path.insert(0, HERE)
    import cro_loader
    proposals, notes = [], []
    if not os.path.isfile(os.path.join(ROMFS, 'static.crs')):
        return proposals, ['cro : %s absent' % ROMFS]
    crs, cros, _ = cro_loader.read_romfs(ROMFS)
    counts = collections.Counter()
    for cro in cros:
        module = cro.name
        text_start = cro.segments[0][0] if cro.segments else 0
        for name, tag in cro.named_exports:
            segment, offset = cro_loader.split_tag(tag)
            if segment != 0 or segment >= len(cro.segments):
                counts['export hors du code'] += 1
                continue
            position = text_start + (offset & ~1)
            proposals.append(Proposal(position, '%s_%s' % (module, name), 'cro-export', 'haute',
                                      'table d\'exports nommés de %s : « %s » (étiquette %#x, segment 0)' % (module, name, tag),
                                      module=module, thumb=bool(offset & 1)))
            counts['export'] += 1
        for field, label in (('on_load', 'OnLoad'), ('on_exit', 'OnExit'), ('on_unresolved', 'OnUnresolved')):
            tag = cro.header[field]
            if tag == cro_loader.NO_TAG:
                continue
            segment, offset = cro_loader.split_tag(tag)
            if segment != 0 or segment >= len(cro.segments):
                counts['crochet hors du code'] += 1
                continue
            proposals.append(Proposal(text_start + (offset & ~1), '%s_%s' % (module, label), 'cro-hook', 'haute',
                                      'champ %s de l\'en-tête de %s (étiquette %#x)' % (field, module, tag),
                                      module=module, thumb=bool(offset & 1)))
            counts['crochet ' + label] += 1
    # Le code principal : les exports de static.crs sont déjà nommés dans pokemon-x.noms.tsv ; on le vérifie.
    segs = crs.segments
    absent = same = other = 0
    for name, tag in crs.named_exports:
        segment, offset = cro_loader.split_tag(tag)
        if segment >= len(segs) or segs[segment][2] != 0:
            continue
        address = segs[segment][0] + (offset & ~1)
        have = game.names.get(address)
        if have is None:
            absent += 1
            kind = game.funcs.get(address, (0, 'thumb' if offset & 1 else 'arm'))[1]
            proposals.append(Proposal(address, name, 'crs-export', 'haute',
                                      'table d\'exports nommés de static.crs : « %s »' % name, thumb=kind == 'thumb'))
        elif have[1] == name:
            same += 1
        else:
            other += 1          # alias C2/D2 d'un C1/D1 au même endroit
    notes.append('cro : %d modules ; %s' % (len(cros), ', '.join('%d %s' % (v, k) for k, v in sorted(counts.items()))))
    notes.append('cro : exports de static.crs en code : %d déjà nommés pareil, %d alias du même endroit sous un autre nom, '
                 '%d sans nom' % (same, other, absent))
    notes.append('cro : les imports des 133 modules sont tous anonymes (aucun import par nom ni par numéro) : ils donnent '
                 'des adresses cibles, jamais de noms')
    return proposals, notes


# --- Source : les appels système ---

def decode_svc(game, address):
    """Les numéros d'appel système (« svc ») que contient la fonction, lus dans les octets. Rend (liste, nombre d'instr.)."""
    size, mode, _ = game.funcs[address]
    found = []
    offset = address - BASE
    if mode == 'arm':
        for i in range(0, size - 3, 4):
            word = struct.unpack_from('<I', game.code, offset + i)[0]
            if word >> 24 == 0xEF:
                found.append(word & 0xFFFFFF)
        return found, size // 4
    for i in range(0, size - 1, 2):
        half = struct.unpack_from('<H', game.code, offset + i)[0]
        if half >> 8 == 0xDF:
            found.append(half & 0xFF)
    return found, size // 2


def read_banc_svc():
    """Contrôle : {(adresse de l'instruction svc, numéro)} vus par le banc. Vide si aucun journal."""
    import glob
    seen = set()
    rx = re.compile(r'\] f\w+ svc ([0-9A-F]{2}) .*?@0x([0-9a-f]+) ')
    for path in glob.glob(os.path.join(ROOT, 'local', 'analyse', 'banc*', 'journal.txt')):
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                if ' svc ' not in line:
                    continue
                m = rx.search(line)
                if m:
                    seen.add((int(m.group(2), 16), int(m.group(1), 16)))
    return seen


def is_pure_svc_wrapper(game, address):
    """Vrai si la fonction ARM n'a que des instructions d'enrobage : mise sur la pile, lecture des arguments sur la pile,
    mov, le svc, rangement des sorties dans la mémoire que les arguments désignent, retour. Aucun branchement, aucune
    comparaison, aucun calcul : sinon c'est une fonction de bibliothèque qui APPELLE l'appel système (fermer une poignée
    seulement si elle n'est pas nulle, la remettre à zéro...), et le nom svc<Nom> serait faux. Le pointeur de pile peut
    être ajusté (add ou sub sp, sp, #imm : svcQueryMemory range cinq sorties en 48 octets)."""
    size, mode, _ = game.funcs[address]
    if mode != 'arm' or size > 0x30:
        return False
    for i in range(0, size, 4):
        word = struct.unpack_from('<I', game.code, address - BASE + i)[0]
        if word >> 24 == 0xEF or word == 0xE12FFF1E or word & 0xFFFFFF00 in (0xE28DD000, 0xE24DD000):
            continue
        if word >> 16 in (0xE92D, 0xE8BD, 0xE59D) or word & 0xFFFF0FFF in (0xE52D0004, 0xE49D0004) or word >> 20 == 0xE58:
            continue
        if word >> 28 == 0xE and (word >> 21) & 0x7F in (0x0D, 0x1D) and not word >> 20 & 1:
            continue                    # mov, sans changer les indicateurs
        return False
    return True


def pass_svc(game):
    names = svc_names()
    seen = read_banc_svc()
    called = game.called_count()
    found = []
    for address in game.starts:
        if address in game.names:
            continue
        size, mode, _ = game.funcs[address]
        if size > 0x24:
            continue
        numbers, _ = decode_svc(game, address)
        if len(numbers) != 1 or numbers[0] == SVC_SEND_SYNC_REQUEST or numbers[0] not in names:
            continue
        if not is_pure_svc_wrapper(game, address):
            continue
        number = numbers[0]
        confirmed = any(address <= pc < address + size and n == number for pc, n in seen)
        found.append((address, number, confirmed, mode))
    by_number = collections.defaultdict(list)
    for item in found:
        by_number[item[1]].append(item)
    proposals = []
    confirmed_count = 0
    for number, items in by_number.items():
        items.sort(key=lambda it: (-called[it[0]], it[0]))
        for rank, (address, _, confirmed, mode) in enumerate(items):
            name = 'svc' + names[number]
            if rank:
                name += '_alt_%x' % address
            proof = 'octets : « svc %#x » seul dans une fonction de %d octets' % (number, game.funcs[address][0])
            if confirmed:
                proof += ' ; banc : l\'appel système %#x a été vu à cette fonction' % number
                confirmed_count += 1
            else:
                proof += ' ; pas vu au banc'
            # Haute : l'appel système est lu dans les octets ET sa seule présence fait de la fonction son enrobage.
            proposals.append(Proposal(address, name, 'svc', 'haute', proof, thumb=mode == 'thumb'))
    notes = ['svc : %d enrobages d\'appel système sans nom (hors SendSyncRequest), dont %d vus au banc' % (len(found), confirmed_count)]
    return proposals, notes


# --- Source : la bibliothèque standard, reconnue en l'exécutant ---

SENTINEL = 0x7F000000
DATA_BASE = 0x20000000
DATA_SIZE = 0x2000
STACK_BASE = 0x30000000
STACK_SIZE = 0x10000


def import_unicorn():
    if PYLIB not in sys.path:
        sys.path.insert(0, PYLIB)
    import unicorn
    from unicorn import arm_const
    return unicorn, arm_const


class Prober:
    """Exécute une fonction sur des entrées fabriquées. Le code est en lecture et exécution seules : la moindre écriture
    dans le programme, la moindre lecture hors de lui ou de la zone d'essai, fait refuser la fonction.
    chunks : [(adresse, octets)], les morceaux du programme (un seul pour code.bin, un par segment d'un ELF).
    Les accès non alignés à la zone d'essai, qu'unicorn fait sans faute, sont des plantages comme sur la console.
    L'ARM11 tourne avec SCTLR.U = 1 et A = 0 (kernel11.elf, position 0x33000 : « orr r0, r0, r1 » du littéral 0xC03805
    lu à 0x332b8, puis « mcr p15, 0, r0, c1, c0, 0 ») : ldr, str, ldrh, strh non alignés passent, mais ldm, stm, push,
    pop, ldrd, strd, swp, ldrex, vldm, vstr fautent sur une adresse qui n'est pas multiple de 4. arm9 : l'ARM946E-S
    (ARMv5, SCTLR 0x4307D, kernel9.bin position 0x14b5c) ne faute jamais mais tourne le mot lu ou ignore les bits bas :
    tout accès de 2 ou 4 octets non aligné y donne autre chose qu'unicorn."""

    def __init__(self, chunks, limit=60000, arm9=False):
        self.u, self.a = import_unicorn()
        u, a = self.u, self.a
        self.uc = u.Uc(u.UC_ARCH_ARM, u.UC_MODE_ARM)
        self.uc.ctl_set_cpu_model(a.UC_CPU_ARM_11MPCORE)
        pages = sorted((start & ~0xFFF, (start + len(data) + 0xFFF) & ~0xFFF) for start, data in chunks if data)
        merged = []
        for low, high in pages:
            if merged and low <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], high)
            else:
                merged.append([low, high])
        for low, high in merged:
            self.uc.mem_map(low, high - low, u.UC_PROT_READ | u.UC_PROT_EXEC)
        for start, data in chunks:
            self.uc.mem_write(start, bytes(data))
        self.uc.mem_map(DATA_BASE, DATA_SIZE, u.UC_PROT_READ | u.UC_PROT_WRITE)
        self.uc.mem_map(STACK_BASE, STACK_SIZE, u.UC_PROT_READ | u.UC_PROT_WRITE)
        self.uc.mem_map(SENTINEL, 0x1000, u.UC_PROT_READ | u.UC_PROT_EXEC)
        self.uc.mem_write(SENTINEL, struct.pack('<I', 0xE12FFF1E))
        self.limit = limit
        self.regs = [a.UC_ARM_REG_R0, a.UC_ARM_REG_R1, a.UC_ARM_REG_R2, a.UC_ARM_REG_R3]
        # La VFP, allumée comme le noyau le fait pour les processus (sinon « vpush » est une instruction invalide).
        self.uc.reg_write(a.UC_ARM_REG_C1_C0_2, self.uc.reg_read(a.UC_ARM_REG_C1_C0_2) | 0xF << 20)
        self.uc.reg_write(a.UC_ARM_REG_FPEXC, 0x40000000)
        # Ce qui a arrêté le dernier appel : why (texte), blocked (une limite du banc d'essai, pas une faute de la
        # fonction : appel système, écriture dans les variables du programme, que l'essai ne fournit pas).
        self.why, self.blocked = '', False
        self.uc.hook_add(u.UC_HOOK_MEM_INVALID, self._on_memory)
        self.uc.hook_add(u.UC_HOOK_INTR, self._on_interrupt)
        self.arm9 = arm9
        self.uc.hook_add(u.UC_HOOK_MEM_READ | u.UC_HOOK_MEM_WRITE, self._on_access, begin=DATA_BASE,
                         end=DATA_BASE + DATA_SIZE - 1)

    def _on_memory(self, uc, access, address, size, value, data):
        u = self.u
        kind = {u.UC_MEM_WRITE_PROT: 'écriture dans le programme', u.UC_MEM_READ_UNMAPPED: 'lecture hors mémoire',
                u.UC_MEM_WRITE_UNMAPPED: 'écriture hors mémoire', u.UC_MEM_FETCH_UNMAPPED: 'saut hors mémoire'}
        self.why = '%s à %#x (pc=%#x)' % (kind.get(access, 'accès refusé'), address, uc.reg_read(self.a.UC_ARM_REG_PC))
        self.blocked = access == u.UC_MEM_WRITE_PROT
        return False

    def _on_access(self, uc, access, address, size, value, data):
        if not address & (min(size, 4) - 1) or not (self.arm9 or self._needs_word_alignment(uc)):
            return
        self.why = 'accès non aligné de %d octets à %#x (pc=%#x)' % (size, address, uc.reg_read(self.a.UC_ARM_REG_PC))
        uc.emu_stop()

    def _needs_word_alignment(self, uc):
        """L'instruction en cours est de celles qui fautent sur l'ARM11 à une adresse non multiple de 4."""
        pc = uc.reg_read(self.a.UC_ARM_REG_PC)
        if uc.reg_read(self.a.UC_ARM_REG_CPSR) & 0x20:
            h = struct.unpack('<H', uc.mem_read(pc, 2))[0]
            return h >> 12 == 0xC or h & 0xF600 == 0xB400                  # ldmia, stmia ; push, pop
        w = struct.unpack('<I', uc.mem_read(pc, 4))[0]
        # ldm, stm, rfe, srs ; ldc, stc, vldr, vldm ; ldrd, strd ; swp, ldrex, strex
        return (w >> 25) & 7 in (4, 6) or w & 0x0E1000D0 == 0x000000D0 or w & 0x0F0000F0 == 0x01000090

    def _on_interrupt(self, uc, number, data):
        self.why = 'exception %d (2 : svc) à pc=%#x' % (number, uc.reg_read(self.a.UC_ARM_REG_PC))
        self.blocked = True
        uc.emu_stop()

    def reset(self, canvas):
        self.uc.mem_write(DATA_BASE, bytes(canvas) + bytes(DATA_SIZE - len(canvas)))

    def call(self, address, thumb, args):
        """Lance la fonction avec r0..r3 = args (la suite sur la pile) ; rend [r0..r3] ou None si elle a échoué ou
        n'a pas fini (self.why dit pourquoi)."""
        a = self.a
        self.why, self.blocked = '', False
        for reg, value in zip(self.regs, args):
            self.uc.reg_write(reg, value & 0xFFFFFFFF)
        sp = STACK_BASE + STACK_SIZE - 0x100
        if len(args) > 4:
            self.uc.mem_write(sp, struct.pack('<%dI' % (len(args) - 4), *(v & 0xFFFFFFFF for v in args[4:])))
        self.uc.reg_write(a.UC_ARM_REG_R12, 0)
        self.uc.reg_write(a.UC_ARM_REG_SP, sp)
        self.uc.reg_write(a.UC_ARM_REG_LR, SENTINEL)
        try:
            self.uc.emu_start(address | (1 if thumb else 0), SENTINEL, count=self.limit)
        except self.u.UcError as error:
            self.why = self.why or str(error)
            return None
        if self.why:
            return None
        if self.uc.reg_read(a.UC_ARM_REG_PC) != SENTINEL:
            self.why = 'ne rend pas la main en %d instructions' % self.limit
            return None
        return [self.uc.reg_read(r) for r in self.regs]

    def read(self, address, size):
        return bytes(self.uc.mem_read(address, size))


def signed32(value):
    return value - (1 << 32) if value & 0x80000000 else value


def sign(value):
    return (value > 0) - (value < 0)


def make_canvas(rng, size=0x1000):
    return rng.randbytes(size)


class Spec:
    """Une famille de cas d'essai. Chaque cas (prober, address, thumb) rend None s'il passe, sinon ce qui a manqué."""

    def __init__(self, name, cases):
        self.name = name
        self.cases = cases

    def failure(self, prober, address, thumb):
        """Le premier cas en échec, décrit, ou None."""
        for case in self.cases:
            why = case(prober, address, thumb)
            if why:
                return why
        return None

    def check(self, prober, address, thumb):
        return self.failure(prober, address, thumb) is None


def crash(prober, what):
    return '%s : plantage, %s' % (what, prober.why)


def memory_diff(prober, expected, what):
    """None si la zone d'essai vaut `expected`, sinon le premier octet qui diffère."""
    got = prober.read(DATA_BASE, len(expected))
    if got == bytes(expected):
        return None
    k = next(i for i in range(len(expected)) if got[i] != expected[i])
    return '%s : octet %#x attendu %02x, obtenu %02x' % (what, DATA_BASE + k, expected[k], got[k])


def returned(out, want, what):
    return None if out[0] == want else '%s : rend %#x au lieu de %#x' % (what, out[0], want)


def copy_cases(seed, alignment, overlap, ret, rounds=1):
    """memcpy/memmove (dst, src, n) : adresses alignées sur `alignment`, avec ou sans recouvrement.
    ret : 'dst' (rend la destination), 'end' (rend destination + n) ou None (rien de promis)."""
    rng = random.Random(seed)
    cases = []
    sizes = [0, 1, 2, 3, 4, 5, 7, 8, 9, 13, 16, 17, 31, 33, 64, 100, 129]
    for n in sizes * rounds:
        def case(prober, address, thumb, n=n, salt=rng.randrange(1 << 30)):
            r = random.Random(salt)
            canvas = make_canvas(r)
            pick = lambda lo: lo + (r.randrange(0, 64) // alignment) * alignment
            if overlap:
                src = DATA_BASE + 0x100 + (r.randrange(0, 32) // alignment) * alignment
                shift = (r.randrange(1, 40) // alignment) * alignment or alignment
                dst = src + shift if overlap == 1 else src - shift
            else:
                src = DATA_BASE + pick(0x100)
                dst = DATA_BASE + pick(0x800)
            what = '(dst=%#x, src=%#x, n=%d)' % (dst, src, n)
            prober.reset(canvas)
            out = prober.call(address, thumb, [dst, src, n, r.randrange(1 << 32)])
            if out is None:
                return crash(prober, what)
            expected = bytearray(canvas)
            expected[dst - DATA_BASE:dst - DATA_BASE + n] = canvas[src - DATA_BASE:src - DATA_BASE + n]
            return memory_diff(prober, expected, what) or (
                returned(out, {'dst': dst, 'end': dst + n}[ret], what) if ret else None)
        cases.append(case)
    return cases


def set_cases(seed, alignment, order, ret_dst, clear, word=False, rounds=1):
    """memset(dst, c, n) ; __aeabi_memset(dst, n, c) ; __aeabi_memclr(dst, n). word : c est passé répété sur les
    quatre octets d'un mot (memset_words)."""
    rng = random.Random(seed)
    cases = []
    for n in [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 32, 33, 64, 100, 129] * rounds:
        def case(prober, address, thumb, n=n, salt=rng.randrange(1 << 30)):
            r = random.Random(salt)
            canvas = make_canvas(r)
            dst = DATA_BASE + 0x200 + (r.randrange(0, 64) // alignment) * alignment
            c = 0 if clear else r.randrange(1, 256)
            value = c * 0x01010101 if word else c
            prober.reset(canvas)
            garbage = r.randrange(1 << 32)
            if clear:
                args = [dst, n, garbage, garbage ^ 0x5A5A5A5A]
                what = '(dst=%#x, n=%d)' % (dst, n)
            elif order == 'cn':
                args = [dst, value, n, garbage]
                what = '(dst=%#x, c=%#x, n=%d)' % (dst, value, n)
            else:
                args = [dst, n, value, garbage]
                what = '(dst=%#x, n=%d, c=%#x)' % (dst, n, value)
            out = prober.call(address, thumb, args)
            if out is None:
                return crash(prober, what)
            expected = bytearray(canvas)
            expected[dst - DATA_BASE:dst - DATA_BASE + n] = bytes([c]) * n
            return memory_diff(prober, expected, what) or (returned(out, dst, what) if ret_dst else None)
        cases.append(case)
    return cases


def c_strncmp(a, b, n):
    """strncmp sur deux chaînes terminées (octets non signés, arrêt au premier nul)."""
    for x, y in zip(a[:n], b[:n]):
        if x != y or not x:
            return (x > y) - (x < y)
    return 0


def string_cases(seed, kind, rounds=1):
    rng = random.Random(seed)
    cases = []
    for length in [0, 1, 2, 3, 4, 5, 7, 8, 15, 17, 40] * rounds:
        def case(prober, address, thumb, length=length, salt=rng.randrange(1 << 30)):
            r = random.Random(salt)
            canvas = bytearray(make_canvas(r).replace(b'\0', b'\1'))     # pas d'octet nul par hasard
            a = DATA_BASE + 0x100 + r.randrange(0, 4)
            b = DATA_BASE + 0x800 + r.randrange(0, 4)
            canvas[a - DATA_BASE + length] = 0
            if kind == 'strlen':
                prober.reset(canvas)
                what = '(s=%#x, longueur %d)' % (a, length)
                out = prober.call(address, thumb, [a, r.randrange(1 << 32), 0, 0])
                if out is None:
                    return crash(prober, what)
                return memory_diff(prober, canvas, what) or returned(out, length, what)
            # une copie de la chaîne en b, puis une différence éventuelle
            canvas[b - DATA_BASE:b - DATA_BASE + length] = canvas[a - DATA_BASE:a - DATA_BASE + length]
            canvas[b - DATA_BASE + length] = 0
            if kind in ('strcpy', 'strncpy'):
                dst = b + 0x200
                n = r.randrange(0, length + 10)
                count = length + 1 if kind == 'strcpy' else n
                expected = bytearray(canvas)
                source = bytes(canvas[a - DATA_BASE:a - DATA_BASE + length + 1]) + bytes(max(0, count - length - 1))
                expected[dst - DATA_BASE:dst - DATA_BASE + count] = source[:count]
                what = '(dst=%#x, src=%#x de longueur %d%s)' % (dst, a, length, ', n=%d' % n if kind == 'strncpy' else '')
                prober.reset(canvas)
                out = prober.call(address, thumb, [dst, a, n, 0])
                if out is None:
                    return crash(prober, what)
                return memory_diff(prober, expected, what) or returned(out, dst, what)
            mode = r.randrange(3)       # 0 égales, 1 b plus grande, 2 b plus petite
            if length and mode:
                k = r.randrange(length)
                high = r.random() < 0.3
                base = canvas[a - DATA_BASE + k]
                if mode == 1:
                    canvas[b - DATA_BASE + k] = min(255, base + 1 + r.randrange(40)) if base < 255 else 254
                else:
                    canvas[b - DATA_BASE + k] = max(1, base - 1 - r.randrange(40)) if base > 1 else 2
                if high:
                    canvas[a - DATA_BASE + k] = 0xF0
                    canvas[b - DATA_BASE + k] = 0x10 if mode == 1 else 0xFF
                    if mode == 1:
                        canvas[a - DATA_BASE + k], canvas[b - DATA_BASE + k] = 0x10, 0xF0
                    else:
                        canvas[a - DATA_BASE + k], canvas[b - DATA_BASE + k] = 0xF0, 0x10
            ca = bytes(canvas[a - DATA_BASE:a - DATA_BASE + length + 1])
            cb = bytes(canvas[b - DATA_BASE:b - DATA_BASE + length + 1])
            prober.reset(canvas)
            what = '(%r, %r)' % (ca, cb)
            if kind == 'strcmp':
                out = prober.call(address, thumb, [a, b, 0, 0])
                want = sign((ca > cb) - (ca < cb))
            elif kind == 'strncmp':
                n = r.randrange(0, length + 4)
                what = '(%r, %r, n=%d)' % (ca, cb, n)
                out = prober.call(address, thumb, [a, b, n, 0])
                want = c_strncmp(ca, cb, n)
            elif kind == 'memcmp':
                out = prober.call(address, thumb, [a, b, length + 1, 0])
                want = (ca > cb) - (ca < cb)
            else:                                   # strchr
                target = canvas[a - DATA_BASE + r.randrange(length)] if length else 7
                first = ca.find(bytes([target]))
                what = '(%r, %#x)' % (ca, target)
                out = prober.call(address, thumb, [a, target, 0, 0])
                if out is None:
                    return crash(prober, what)
                return memory_diff(prober, canvas, what) or returned(out, a + first if 0 <= first < length else 0, what)
            if out is None:
                return crash(prober, what)
            if sign(signed32(out[0])) != want:
                return '%s : signe %d attendu, rend %#x' % (what, want, out[0])
            return memory_diff(prober, canvas, what)
        cases.append(case)
    return cases


def division_cases(seed, signed, modulo, wide, count=40):
    rng = random.Random(seed)
    edge = [0, 1, 2, 3, 7, 10, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF, 0x12345678, 100, 65535, 65536, 0x00010001]
    if wide:
        edge += [0x1FFFFFFFF, 0xFFFFFFFFFF, 0x123456789ABCDEF0, 0xFFFFFFFFFFFFFFFF, 1 << 40, (1 << 63) + 5]
    pairs = []
    bits = 64 if wide else 32
    for _ in range(count):
        a = rng.choice(edge + [rng.getrandbits(bits), rng.getrandbits(rng.randrange(1, bits + 1))])
        b = rng.choice(edge + [rng.getrandbits(rng.randrange(1, bits + 1))])
        pairs.append((a, b))
    cases = []
    for a, b in pairs:
        if b == 0:
            continue
        def case(prober, address, thumb, a=a, b=b):
            prober.reset(b'')
            mask = (1 << bits) - 1
            x, y = a, b
            if signed:
                x = a - (1 << bits) if a >> (bits - 1) else a
                y = b - (1 << bits) if b >> (bits - 1) else b
                if x == -(1 << (bits - 1)) and y == -1:
                    return None
                q = abs(x) // abs(y) * (1 if (x < 0) == (y < 0) else -1)
            else:
                q = x // y
            r = x - q * y
            what = '%#x / %#x' % (a, b)
            if wide:
                out = prober.call(address, thumb, [a & 0xFFFFFFFF, a >> 32, b & 0xFFFFFFFF, b >> 32])
                if out is None:
                    return crash(prober, what)
                got_q, got_r = out[0] | out[1] << 32, out[2] | out[3] << 32
            else:
                out = prober.call(address, thumb, [a, b, 0, 0])
                if out is None:
                    return crash(prober, what)
                got_q, got_r = out[0], out[1]
            if got_q != q & mask or modulo and got_r != r & mask:
                return '%s : attendu q=%#x r=%#x, obtenu q=%#x r=%#x' % (what, q & mask, r & mask, got_q, got_r)
            return None
        cases.append(case)
    return cases


def build_specs(rounds=1):
    """[(nom, Spec)] dans l'ordre où on les essaie : le plus exigeant d'abord. rounds : combien de fois chaque famille
    reprend ses tailles (40 couples de division par tour)."""
    specs = []
    seed = 100
    for alignment, suffix in ((1, ''), (4, '4'), (8, '8')):
        for overlap_name, overlap in (('memmove', 1), ('memcpy', 0)):
            for ret_dst in (True, False):
                seed += 1
                ret = 'dst' if ret_dst else None
                if overlap:
                    cases = copy_cases(seed, alignment, 1, ret, rounds) + copy_cases(seed + 1, alignment, 2, ret, rounds)
                else:
                    cases = copy_cases(seed, alignment, 0, ret, rounds)
                if ret_dst:
                    name = overlap_name if not suffix else '__aeabi_%s%s' % (overlap_name, suffix)
                else:
                    name = '__aeabi_%s%s' % (overlap_name, suffix)
                specs.append((name, Spec(name, cases)))
    for alignment, suffix in ((1, ''), (4, '4'), (8, '8')):
        seed += 1
        name = 'memset' if not suffix else '__aeabi_memset' + suffix
        specs.append((name, Spec(name, set_cases(seed, alignment, 'cn' if not suffix else 'nc', not suffix, False,
                                                 rounds=rounds))))
        if not suffix:
            specs.append(('__aeabi_memset', Spec('__aeabi_memset', set_cases(seed + 1, 1, 'nc', False, False, rounds=rounds))))
        specs.append(('__aeabi_memclr' + suffix, Spec('__aeabi_memclr' + suffix,
                                                      set_cases(seed + 2, alignment, 'cn', False, True, rounds=rounds))))
    for kind in ('strlen', 'strcmp', 'strcpy', 'memcmp', 'strchr'):
        seed += 1
        specs.append((kind, Spec(kind, string_cases(seed, kind, rounds))))
    for name, signed, modulo, wide in (('__aeabi_uidivmod', False, True, False), ('__aeabi_uidiv', False, False, False),
                                       ('__aeabi_idivmod', True, True, False), ('__aeabi_idiv', True, False, False),
                                       ('__aeabi_uldivmod', False, True, True), ('__aeabi_ldivmod', True, True, True)):
        seed += 1
        specs.append((name, Spec(name, division_cases(seed, signed, modulo, wide, 40 * rounds))))
    return specs


def recognise(prober, address, thumb, specs):
    """Le premier nom dont toutes les épreuves réussissent, ou None."""
    for name, spec in specs:
        if spec.check(prober, address, thumb):
            return name
    return None


def pass_stdlib(game):
    try:
        import_unicorn()
    except ImportError:
        return [], ['stdlib : unicorn manque dans local/pylib, passe sautée']
    prober = Prober([(BASE, game.code)])
    specs = build_specs()
    called = game.called_count()
    tried = 0
    hits = []
    for address in game.starts:
        if address in game.names:
            continue
        size, mode, _ = game.funcs[address]
        if size > 0x400 or size < 4:
            continue
        if decode_svc(game, address)[0]:
            continue
        tried += 1
        name = recognise(prober, address, mode == 'thumb', specs)
        if name:
            hits.append((address, name, mode))
    by_name = collections.defaultdict(list)
    for item in hits:
        by_name[item[1]].append(item)
    proposals = []
    for name, items in by_name.items():
        items.sort(key=lambda it: (-called[it[0]], it[0]))
        for rank, (address, _, mode) in enumerate(items):
            final = name if not rank else '%s_alt_%x' % (name, address)
            proposals.append(Proposal(address, final, 'stdlib', 'haute',
                                      'exécutée sur des entrées fabriquées (%d épreuves) : se comporte exactement comme %s, '
                                      'sans écrire hors de sa destination' % (len(dict(specs)[name].cases), name),
                                      thumb=mode == 'thumb'))
    return proposals, ['stdlib : %d fonctions sans nom essayées (taille de 4 à 0x400 octets, sans svc), %d reconnues : %s' % (
        tried, len(hits), ', '.join('%s x%d' % (k, len(v)) for k, v in sorted(by_name.items())) or 'aucune')]


# --- Source : les classes C++ (typeinfo et tables virtuelles) ---

TYPEINFO_NAME = re.compile(rb'(?<![\x20-\x7e])(St\d+[A-Za-z_]\w*|N(?:\d+[A-Za-z_]\w*)+E|\d+[A-Za-z_]\w*)\x00')


def parse_class_name(text):
    """« N2nn3nex10ByteStreamE » -> ['nn', 'nex', 'ByteStream'] (liste des identifiants), ou None si le nom a des
    gabarits, des substitutions ou autre chose que des identifiants à longueur."""
    prefix = ''
    body = text
    if body.startswith('St'):
        prefix, body = 'St', body[2:]
    elif body.startswith('N'):
        if not body.endswith('E'):
            return None
        body = body[1:-1]
    parts = []
    while body:
        m = re.match(r'(\d+)', body)
        if not m:
            return None
        n = int(m.group(1))
        ident = body[m.end():m.end() + n]
        if len(ident) != n or not re.match(r'^[A-Za-z_]\w*$', ident):
            return None
        parts.append(ident)
        body = body[m.end() + n:]
    return (prefix, parts) if parts else None


def mangle_destructor(prefix, parts, kind):
    return '_ZN' + prefix + ''.join('%d%s' % (len(p), p) for p in parts) + kind + 'Ev'


def find_vtables(game):
    """[(nom du typeinfo, adresse de la table virtuelle, [mots des cases])] : un typeinfo est un objet dont le deuxième
    mot pointe sa chaîne de nom ; une table virtuelle est un mot nul suivi de l'adresse du typeinfo."""
    code = game.code
    words = struct.unpack('<%dI' % (len(code) // 4), code[:len(code) // 4 * 4])
    names = {}
    for m in TYPEINFO_NAME.finditer(code):
        names[m.start() + BASE] = m.group(1).decode()
    infos = {}
    for i, w in enumerate(words):
        if w in names and i:
            infos[BASE + 4 * (i - 1)] = names[w]
    tables = []
    for i in range(1, len(words)):
        w = words[i]
        if w in infos and words[i - 1] == 0:
            tables.append((infos[w], BASE + 4 * (i + 1), words[i + 1:i + 5]))
    return tables


def pass_rtti(game):
    """Les deux premières cases d'une table virtuelle de destructeur : case 0 = destructeur complet (D1), case 1 =
    destructeur libérant (D0), qui appelle la case 0 puis la fonction de libération. Contrôlé sur les classes de la
    bibliothèque standard dont static.crs donne les noms."""
    tables = find_vtables(game)
    known = {n: a for a, (k, n) in game.names.items()}
    pairs = []
    for name, vtable, cells in tables:
        if len(cells) < 2:
            continue
        d1, d0 = cells[0] & ~1, cells[1] & ~1
        if d1 not in game.funcs or d0 not in game.funcs or d1 == d0:
            continue
        calls = game.calls.get(d0, [])
        size = game.funcs[d0][0]
        others = {t for t in calls if t != d1}
        if d1 not in calls or size > 0x60 or len(others) != 1:
            continue
        pairs.append((name, vtable, d1, d0, next(iter(others))))
    free = collections.Counter(p[4] for p in pairs)
    # Contrôle : pour les paires dont static.crs nomme D1 ou D0, le nom prédit doit être celui de static.crs.
    agree = disagree = 0
    checked = []
    for name, vtable, d1, d0, deleter in pairs:
        parsed = parse_class_name(name)
        if not parsed:
            continue
        for address, kind in ((d1, 'D1'), (d0, 'D0')):
            have = game.names.get(address)
            if have:
                if have[1] == mangle_destructor(parsed[0], parsed[1], kind):
                    agree += 1
                elif have[1].startswith('_Z'):
                    disagree += 1
                    checked.append('%s attendu %s, static.crs dit %s' % (name, kind, have[1]))
                else:
                    checked.append('%s : nom à la main %s en %s, non comparé' % (name, have[1], kind))
    # Second contrôle, sans regarder le code : la place des destructeurs dans TOUTES les tables dont static.crs nomme
    # un destructeur (case 0 = D1, case 1 = D0).
    layout_agree = layout_disagree = 0
    for name, vtable, cells in tables:
        for slot, kind in ((0, 'D1'), (1, 'D0')):
            if len(cells) <= slot:
                continue
            have = game.names.get(cells[slot] & ~1)
            if have and re.search(r'D[012]Ev$', have[1]):
                if have[1].endswith(kind + 'Ev'):
                    layout_agree += 1
                else:
                    layout_disagree += 1
    trusted = layout_disagree == 0 and layout_agree >= 10 and disagree == 0
    proposals = []
    skipped = collections.Counter()
    for name, vtable, d1, d0, deleter in pairs:
        parsed = parse_class_name(name)
        if not parsed:
            skipped['nom de classe à gabarit ou à substitution'] += 1
            continue
        if free[deleter] < 5:
            skipped['fonction de libération rare'] += 1
            continue
        for address, kind, role in ((d1, 'D1', 'case 0'), (d0, 'D0', 'case 1')):
            if address in game.names:
                continue
            proposals.append(Proposal(address, mangle_destructor(parsed[0], parsed[1], kind), 'rtti',
                                      'haute' if trusted else 'moyenne',
                                      'typeinfo « %s », table virtuelle %#x, %s ; la case 1 appelle la case 0 puis %#x (appelé '
                                      'par %d classes)' % (name, vtable, role, deleter, free[deleter]),
                                      thumb=game.funcs[address][1] == 'thumb'))
    notes = ['rtti : %d typeinfo, %d tables virtuelles, %d paires (D1, D0) de forme sûre ; contrôle sur les noms de '
             'static.crs : %d concordent, %d diffèrent ; place des destructeurs nommés par static.crs : %d dans la case prévue, %d '
             'ailleurs' % (len(set(t[0] for t in tables)), len(tables), len(pairs), agree, disagree, layout_agree, layout_disagree)]
    notes += ['rtti : écarté : %s (%d)' % (k, v) for k, v in skipped.items()]
    notes += ['rtti : ' + c for c in checked[:5]]
    return proposals, notes


# --- Source : les chaînes de chemins de fichiers source ---

PATH_STRING = re.compile(rb'[A-Za-z]:\\[ -~]*?\.(?:cpp|c|h|inl|hpp|cc)(?=\x00)')


def source_stem(path):
    base = re.split(r'[\\/]', path)[-1]
    stem = base.rsplit('.', 1)[0]
    if 'BSAFE' in path or 'CRYPTOCME' in path:
        return 'bsafe_' + stem
    return stem


def pass_assert(game):
    strings = {}
    for m in PATH_STRING.finditer(game.code):
        strings[m.start() + BASE] = m.group().decode('ascii')
    citing = collections.defaultdict(lambda: collections.defaultdict(set))   # fonction -> chemin -> preuves
    for address, path in strings.items():
        for owner in game.data_refs.get(address, ()):
            citing[owner][path].add('référence de Ghidra')
    words = struct.unpack('<%dI' % (len(game.code) // 4), game.code[:len(game.code) // 4 * 4])
    for i, w in enumerate(words):
        if w in strings:
            location = BASE + 4 * i
            owner = game.owner(location)
            if owner is not None and location < BASE + 0x43DCCC + 0x1000:
                citing[owner][strings[w]].add('mot littéral')
    proposals = []
    ambiguous = 0
    for owner, paths in sorted(citing.items()):
        if owner in game.names or owner not in game.funcs:
            continue
        files = {source_stem(p) for p in paths}
        if len(files) != 1:
            ambiguous += 1
            continue
        stem = next(iter(files))
        how = sorted(set().union(*paths.values()))
        proposals.append(Proposal(owner, '%s_%x' % (stem, owner), 'assert', 'moyenne',
                                  'cite le chemin « %s » (%s) ; le nom de fichier ne dit pas ce que fait la fonction' % (
                                      next(iter(paths)), ', '.join(how)), thumb=game.funcs[owner][1] == 'thumb'))
    # La fonction d'échec d'assertion elle-même : celle que le plus d'appelants de chemins appellent.
    callee = collections.Counter()
    for owner in citing:
        for target in set(game.calls.get(owner, [])):
            callee[target] += 1
    notes = ['assert : %d chemins de fichiers source dans code.bin, %d fonctions les citent, %d citent plusieurs fichiers '
             '(laissées sans nom)' % (len(strings), len(citing), ambiguous)]
    if callee:
        target, count = callee.most_common(1)[0]
        total = sum(1 for o, ts in game.calls.items() if target in ts)
        if target not in game.names and target in game.funcs and total >= 50 and count >= 20:
            proposals.append(Proposal(target, 'assert_fail', 'assert', 'moyenne',
                                      'appelée par %d des %d fonctions qui citent un chemin de fichier source (elle reçoit alors le fichier, la ligne '
                                      'et le texte de la condition), et par %d fonctions en tout, la plupart avec des zéros (chaînes retirées) ; '
                                      'ne rend jamais la main (boucle sur un rappel)' % (count, len(citing), total),
                                      thumb=game.funcs[target][1] == 'thumb'))
            notes.append('assert : %#x est la fonction d\'échec (%d des %d fonctions qui citent un chemin l\'appellent, '
                         '%d appelants au total)' % (target, count, len(citing), total))
    return proposals, notes


# --- Assemblage, collisions, compteur ---

def classify_existing(game):
    """Répartition des 940 noms existants par origine, pour le compteur « avant »."""
    services = set()
    for r in [l.rstrip('\n').split('\t') for l in open(SERVICES_TSV, encoding='utf-8')][1:]:
        services.add(int(r[3], 16))
    count = collections.Counter()
    for address, (kind, name) in game.names.items():
        if name.startswith('_Z'):
            count['static.crs (C++)'] += 1
        elif address in services:
            count['services (fonctions d\'envoi)'] += 1
        else:
            count['contrats et noms faits à la main'] += 1
    return count


def reconcile(game, proposals, module_names):
    """Écarte les propositions qui collisionnent. Rend (retenues, écartées[(proposition, raison)])."""
    kept, dropped = [], []
    taken_names = {}
    for address, (kind, name) in game.names.items():
        taken_names[name] = ('', address)
    for module, names in module_names.items():
        for address, (kind, name) in names.items():
            taken_names.setdefault(name, (module, address))
    order = sorted(range(len(proposals)), key=lambda i: (-LEVELS[proposals[i].confidence], SOURCES_ORDER(proposals[i].source), i))
    placed = {}
    for i in order:
        p = proposals[i]
        existing = game.names.get(p.address) if not p.module else module_names.get(p.module, {}).get(p.address)
        if existing is not None:
            if existing[1] != p.name:
                dropped.append((p, 'adresse déjà nommée « %s »' % existing[1]))
            else:
                dropped.append((p, 'déjà dans les fiches, même nom'))
            continue
        if p.key() in placed:
            q = placed[p.key()]
            if q.name != p.name:
                dropped.append((p, 'même adresse proposée sous « %s » par %s (%s)' % (q.name, q.source, q.confidence)))
            else:
                dropped.append((p, 'même nom proposé par %s' % q.source))
            continue
        owner = taken_names.get(p.name)
        if owner is not None and owner != (p.module, p.address):
            where = '%s+%#x' % owner if owner[0] else '%#x' % owner[1]
            dropped.append((p, 'nom déjà pris à %s' % where))
            continue
        taken_names[p.name] = (p.module, p.address)
        placed[p.key()] = p
        kept.append(p)
    kept.sort(key=lambda p: (p.module, p.address))
    return kept, dropped


def SOURCES_ORDER(source):
    base = source.split('-')[0]
    order = {'services': 0, 'cro': 1, 'crs': 1, 'svc': 2, 'stdlib': 3, 'rtti': 4, 'assert': 5}
    return order.get(base, 9)


def read_module_names():
    out = {}
    if os.path.isdir(CRO_FICHES):
        for name in os.listdir(CRO_FICHES):
            if name.endswith('.noms.tsv'):
                out[name[:-len('.noms.tsv')]] = read_names(os.path.join(CRO_FICHES, name))
    return out


def write_tsv(path, rows):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        for row in rows:
            f.write('\t'.join(row) + '\n')


def run(only, out_dir=OUT):
    game = Game()
    module_names = read_module_names()
    passes = {'services': pass_services, 'cro': pass_cro, 'svc': pass_svc, 'stdlib': pass_stdlib, 'rtti': pass_rtti,
              'assert': pass_assert}
    proposals, notes = [], []
    for name in SOURCES:
        if name not in only:
            continue
        print('source %s...' % name, flush=True)
        found, said = passes[name](game)
        proposals += found
        notes += said
        print('   %d propositions' % len(found), flush=True)
    kept, dropped = reconcile(game, proposals, module_names)
    os.makedirs(out_dir, exist_ok=True)
    write_tsv(os.path.join(out_dir, 'proposals.tsv'),
              [('adresse', 'nom', 'source', 'confiance', 'preuve')] +
              [(p.label(), p.name, p.source, p.confidence, p.proof) for p in kept])
    write_tsv(os.path.join(out_dir, 'collisions.tsv'),
              [('adresse', 'nom proposé', 'source', 'raison')] + [(p.label(), p.name, p.source, why) for p, why in dropped])
    before = classify_existing(game)
    lines = ['Passe de nommage : %d fonctions dans code.bin (Ghidra), %d nommées dans pokemon-x.noms.tsv avant la passe' % (
        len(game.funcs), len(game.names)), '']
    lines.append('Noms existants par origine :')
    lines += ['   %-45s %5d' % (k, v) for k, v in sorted(before.items())]
    lines += ['', 'Propositions retenues (sans collision), par source et confiance :']
    table = collections.Counter((p.source, p.confidence, 'module' if p.module else 'principal') for p in kept)
    for (source, confidence, where), count in sorted(table.items()):
        lines.append('   %-12s %-8s %-9s %6d' % (source, confidence, where, count))
    lines += ['', 'Écartées : %d (voir collisions.tsv)' % len(dropped)]
    reasons = collections.Counter(re.sub(r'«.*?»|\S*0x[0-9a-f]+', '…', why) for _, why in dropped)
    lines += ['   %-60s %5d' % (k, v) for k, v in reasons.most_common()]
    main_high = sum(1 for p in kept if not p.module and p.confidence == 'haute')
    main_all = sum(1 for p in kept if not p.module)
    lines += ['', 'Code principal : %d nommées avant ; +%d de confiance haute (versionnables) = %d ; +%d moyennes/basses en '
              'proposition seulement (%d si tout est pris)' % (len(game.names), main_high, len(game.names) + main_high,
                                                               main_all - main_high, len(game.names) + main_all)]
    modules_high = collections.Counter(p.module for p in kept if p.module and p.confidence == 'haute')
    lines.append('Modules .cro : %d noms de confiance haute dans %d modules (avant : %d noms dans %d fichiers)' % (
        sum(modules_high.values()), len(modules_high), sum(len(v) for v in module_names.values()), len(module_names)))
    lines += ['', 'Notes des sources :'] + ['   ' + n for n in notes]
    text = '\n'.join(lines) + '\n'
    with open(os.path.join(out_dir, 'report.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print(text)
    print('-> %s' % out_dir)
    return game, kept, module_names


def merge_lines(path, additions, keep_sorted):
    """Ajoute des lignes (adresse, genre, nom) à un .noms.tsv sans toucher aux lignes existantes. Une graine (ligne
    sans nom) à la même adresse reçoit le nom sur place, avec son genre, plutôt qu'une seconde ligne. Les fins de ligne
    du fichier sont gardées (CRLF dans une copie de travail Windows)."""
    existing = []
    ending = '\n'
    if os.path.isfile(path):
        with open(path, encoding='utf-8', newline='') as f:
            text = f.read()
        ending = '\r\n' if '\r\n' in text else '\n'
        existing = text.replace('\r\n', '\n').split('\n')
        if existing and existing[-1] == '':
            existing.pop()
    seeds = {}
    for i, old in enumerate(existing):
        fields = old.split('\t')
        if old.startswith('0x') and (len(fields) < 3 or not fields[2]):
            seeds[int(fields[0], 16)] = i
    new = []
    for address, kind, name in additions:
        if address in seeds:
            fields = existing[seeds[address]].split('\t')
            existing[seeds[address]] = '%s\t%s\t%s' % (fields[0], fields[1] if len(fields) > 1 else kind, name)
        else:
            new.append('%#x\t%s\t%s' % (address, kind, name))
    if keep_sorted:
        # Insère chaque ligne neuve avant la première ligne d'adresse plus grande ; les anciennes ne bougent pas.
        for line in sorted(new, key=lambda s: int(s.split('\t')[0], 16)):
            address = int(line.split('\t')[0], 16)
            at = len(existing)
            for i, old in enumerate(existing):
                if old.startswith('0x') and int(old.split('\t')[0], 16) > address:
                    at = i
                    break
            existing.insert(at, line)
    else:
        existing += new
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(ending.join(existing) + ending)


def fiche_line(p):
    """La ligne de .noms.tsv d'une proposition : (adresse, genre, nom), « label » pour le Thumb (fiches/README.md)."""
    return p.address, 'label' if p.thumb else 'function', p.name


def is_sorted(path):
    last = -1
    for line in open(path, encoding='utf-8'):
        if line.startswith('0x'):
            a = int(line.split('\t')[0], 16)
            if a < last:
                return False
            last = a
    return True


def apply(kept):
    main = [fiche_line(p) for p in kept if not p.module and p.confidence == 'haute']
    if main:
        merge_lines(MAIN_NAMES, main, is_sorted(MAIN_NAMES))
    by_module = collections.defaultdict(list)
    for p in kept:
        if p.module and p.confidence == 'haute':
            by_module[p.module].append(fiche_line(p))
    for module, items in by_module.items():
        os.makedirs(CRO_FICHES, exist_ok=True)
        path = os.path.join(CRO_FICHES, module + '.noms.tsv')
        merge_lines(path, items, False)
    print('versé : %d lignes dans pokemon-x.noms.tsv, %d lignes dans %d fichiers de modules' % (
        len(main), sum(len(v) for v in by_module.values()), len(by_module)))


# --- Essais, avec des données fabriquées ---

ARM_MEMCPY = [0xE1A0C000, 0xE3520000, 0x0A000004, 0xE4D13001, 0xE4CC3001, 0xE2522001, 0x1AFFFFFB, 0xE1A00000, 0xE12FFF1E]
ARM_STRLEN = [0xE3A01000, 0xE7D02001, 0xE3520000, 0x12811001, 0x1AFFFFFB, 0xE1A00001, 0xE12FFF1E]
ARM_NOP_RET = [0xE12FFF1E]
ARM_WRITES_CODE = [0xE5801000, 0xE12FFF1E]               # str r1,[r0] : doit être refusé si r0 vise le programme


def test():
    failures = []

    def check(condition, text):
        if not condition:
            failures.append(text)
            print('ECHEC  ' + text)

    check(parse_class_name('N2nn3nex10ByteStreamE') == ('', ['nn', 'nex', 'ByteStream']), 'nom de classe imbriqué')
    check(parse_class_name('St14__rw_exception') == ('St', ['__rw_exception']), 'nom de classe std')
    check(parse_class_name('20JobExecuteDelayedRMC') == ('', ['JobExecuteDelayedRMC']), 'nom de classe simple')
    check(parse_class_name('N2nn3nex9TimedQueueINS0_5PacketEEE') is None, 'gabarit refusé')
    check(mangle_destructor('', ['nn', 'nex', 'ByteStream'], 'D0') == '_ZN2nn3nex10ByteStreamD0Ev', 'destructeur manglé')
    check(mangle_destructor('St', ['__rw_exception'], 'D1') == '_ZNSt14__rw_exceptionD1Ev', 'destructeur std manglé')
    check(source_stem('c:\\x\\BSAFE\\CRYPTOCME\\common\\key\\pkey_pk.c') == 'bsafe_pkey_pk', 'nom de fichier BSAFE')
    check(source_stem('c:\\rev\\gflnet\\prog\\src/p2p/gflnet_P2pManager.cpp') == 'gflnet_P2pManager', 'nom de fichier gflnet')
    check(PATH_STRING.search(b'\0c:\\a\\b.cpp\0') is not None, 'chemin reconnu')

    try:
        import_unicorn()
    except ImportError:
        print('unicorn manque : essais d\'exécution sautés')
        return failures
    base = 0x00100000
    blob = bytearray(0x400)
    def put(offset, words):
        for i, w in enumerate(words):
            struct.pack_into('<I', blob, offset + 4 * i, w)
    put(0x000, ARM_MEMCPY)
    put(0x100, ARM_STRLEN)
    put(0x200, ARM_NOP_RET)
    put(0x300, ARM_WRITES_CODE)
    prober = Prober([(base, bytes(blob))])
    specs = build_specs()
    check(recognise(prober, base + 0x000, False, specs) == 'memcpy', 'memcpy fabriquée reconnue')
    check(recognise(prober, base + 0x100, False, specs) == 'strlen', 'strlen fabriquée reconnue')
    check(recognise(prober, base + 0x200, False, specs) is None, 'fonction vide non reconnue')
    check(recognise(prober, base + 0x300, False, specs) is None, 'fonction qui écrit dans le code refusée')
    # un memcpy qui copie un octet de trop doit être refusé
    broken = bytearray(blob)
    struct.pack_into('<I', broken, 0x14, 0xE2522002)        # subs r2,r2,#2 : copie trop ou trop peu
    check(recognise(Prober([(base, bytes(broken))]), base, False, specs) is None, 'memcpy cassée refusée')
    # Les accès non alignés : ldr passe sur l'ARM11, pas sur l'ARM9 ; ldm échoue sur les deux ; un octet passe partout
    put(0x380, [0xE5900000, 0xE12FFF1E, 0xE8900001, 0xE12FFF1E, 0xE5D00000, 0xE12FFF1E])   # ldr ; ldm ; ldrb
    arm11, arm9 = Prober([(base, bytes(blob))]), Prober([(base, bytes(blob))], arm9=True)
    calls = [(p.call(base + at, False, [DATA_BASE + 0x101, 0, 0, 0]) is not None) for p in (arm11, arm9)
             for at in (0x380, 0x388, 0x390)]
    check(calls == [True, False, True, False, False, True], 'accès non alignés : %r' % calls)
    check(arm11.call(base + 0x388, False, [DATA_BASE + 0x100, 0, 0, 0]) is not None, 'ldm aligné : passe')
    # Fabrication d'un décodage d'appel système
    game = Game.__new__(Game)
    game.code = struct.pack('<IIII', 0xEF000013, 0xE12FFF1E, 0xEF000032, 0xE12FFF1E)
    game.funcs = {BASE: (8, 'arm', ''), BASE + 8: (8, 'arm', '')}
    numbers, _ = decode_svc(game, BASE)
    check(numbers == [0x13], 'svc 0x13 décodé')
    game.code = struct.pack('<HHHH', 0xDF08, 0x4770, 0xB500, 0x4770)
    game.funcs = {BASE: (4, 'thumb', '')}
    check(decode_svc(game, BASE)[0] == [8], 'svc Thumb décodé')
    # Enrobage pur : push, svc, ldr/str des sorties, add sp, bx lr (svcCreatePort) ; un cmp ou un bl le refuse
    create_port = [0xE92D0003, 0xEF000047, 0xE59D3000, 0xE5831000, 0xE59D3004, 0xE5832000, 0xE28DD008, 0xE12FFF1E]
    for words, pure, what in ((create_port, True, 'add sp, sp, #8 accepté'),
                              (create_port[:6] + [0xE3500000] + create_port[7:], False, 'cmp refusé'),
                              (create_port[:6] + [0xEB000000] + create_port[7:], False, 'bl refusé')):
        game.code = struct.pack('<%dI' % len(words), *words)
        game.funcs = {BASE: (4 * len(words), 'arm', '')}
        check(is_pure_svc_wrapper(game, BASE) == pure, 'enrobage svc : ' + what)
    # Collisions
    game = Game.__new__(Game)
    game.names = {0x100010: ('function', 'taken')}
    ps = [Proposal(0x100010, 'other', 'rtti', 'haute', ''), Proposal(0x100020, 'taken', 'rtti', 'haute', ''),
          Proposal(0x100030, 'fresh', 'svc', 'haute', ''), Proposal(0x100030, 'fresh2', 'assert', 'moyenne', ''),
          Proposal(0x100040, 'fresh', 'assert', 'moyenne', '')]
    kept, dropped = reconcile(game, ps, {})
    check([p.name for p in kept] == ['fresh'] and len(dropped) == 4, 'collisions : une seule retenue, quatre écartées')
    # Fusion triée : les lignes existantes ne bougent pas
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, 'x.noms.tsv')
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write('0x100000\tfunction\ta\n0x100100\tlabel\tc\n')
        merge_lines(path, [(0x100050, 'function', 'b')], True)
        check(open(path, encoding='utf-8').read() == '0x100000\tfunction\ta\n0x100050\tfunction\tb\n0x100100\tlabel\tc\n',
              'fusion triée')
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write('0x100000\tlabel\t\n')
        merge_lines(path, [(0x100000, 'function', 'd')], True)
        check(open(path, encoding='utf-8').read() == '0x100000\tlabel\td\n', 'graine nommée sur place')
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write('0x100000\tfunction\ta\r\n')
        merge_lines(path, [(0x100050, 'function', 'b')], True)
        check(open(path, 'rb').read() == b'0x100000\tfunction\ta\r\n0x100050\tfunction\tb\r\n', 'fins de ligne CRLF gardées')
    print('%d échec(s)' % len(failures) if failures else 'name_pass : tous les essais passent')
    return failures


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ('run', 'apply', 'test'):
        sys.exit(__doc__)
    if args[0] == 'test':
        sys.exit(1 if test() else 0)
    only = list(SOURCES)
    out = OUT
    i = 1
    while i < len(args):
        if args[i] == '--only':
            only = args[i + 1].split(',')
            i += 2
        elif args[i] == '--out':
            out = args[i + 1]
            i += 2
        else:
            sys.exit('option inconnue : %s' % args[i])
    unknown = [s for s in only if s not in SOURCES]
    if unknown:
        sys.exit('source inconnue : %s (sources : %s)' % (', '.join(unknown), ', '.join(SOURCES)))
    game, kept, module_names = run(only, out)
    if args[0] == 'apply':
        apply(kept)


if __name__ == '__main__':
    main()
