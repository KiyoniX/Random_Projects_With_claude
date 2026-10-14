"""Fait tourner un aiguillage de commandes dans un émulateur, numéro par numéro, et dit où mène chaque commande.

    python emulate_dispatch.py <module> <adresse> [<adresse> ...] [options]

        <module>            un dossier de local/extrait/ (cfg, ptm, hid, fs...)
        <adresse>           l'adresse de l'aiguillage, par exemple 0x107d40. On peut lui coller une étiquette qui
                            sortira dans les tableaux : 0x107d40=cfg:u
        --range A-B         les numéros de commande à essayer, bornes comprises (défaut 0x0000-0xFFFF : tous)
        --thumb / --arm     impose le jeu d'instructions de l'aiguillage (sinon il est lu dans gh/funcs.tsv si
                            ghidra_direct.py est passé, ou deviné sur la première instruction)
        --set NOM=VALEUR    un registre au départ (r1=3) ou un mot en mémoire (0x20000108=3), autant de fois qu'on veut
        --helper ADRESSE    impose qu'une fonction soit prise pour une aide (on la laisse tourner)
        --function ADRESSE  impose qu'une fonction soit prise pour une fonction de travail (on ne la laisse pas tourner)
        --trace NUMERO      au lieu des tableaux, affiche pas à pas ce qui se passe pour ce numéro

    Exemples :
        python emulate_dispatch.py cfg 0x107d40=cfg:u 0x106db4=cfg:s 0x107288=cfg:i 0x1081f8=cfg:nor
        python emulate_dispatch.py hid 0x102fc8 --range 0-0x40

Il écrit, par aiguillage, local/analyse/<module>/emulate_dispatch_<adresse>.txt (le tableau) et .json (tout le détail).

Pourquoi émuler. Un aiguillage, c'est le « switch » qui reçoit une commande et appelle la fonction qui la traite.
Dans les modules en Thumb, Ghidra ne le reconstruit pas (voir ghidra_direct.py) : le pseudo-code est tronqué ou faux.
Plutôt que de le lire, on l'exécute : on pose un en-tête de requête dans le tampon du fil, on lance l'aiguillage, et on
regarde ce qu'il fait. C'est une voie indépendante de Ghidra, qui n'a besoin que de code.bin et exheader.bin.

Ce qui est rendu pour chaque numéro qui existe :
- la fonction appelée : la première fonction de travail que l'aiguillage appelle (et la liste de toutes) ;
- l'en-tête de réponse : le mot 0 du tampon du fil à la sortie, et le mot 1, le résultat ;
- l'en-tête de requête exigé : « entier » si le code compare tout l'en-tête à une valeur (on donne laquelle), « numéro »
  s'il ne regarde que le numéro de commande ; avec, le cas échéant, les descripteurs qu'il a fallu poser dans la requête
  pour que l'aiguillage accepte de continuer (0x20 : numéro de processus, 0xA/0xC/0xE : tampon, 0x2 : tampon statique).

Comment c'est fait, étape par étape :
1. Un passage par numéro avec l'en-tête « numéro << 16 ». Le résultat le plus fréquent sur toute la plage est celui
   d'un numéro inconnu ; les numéros qui donnent autre chose existent.
2. Pendant ce passage on surveille les comparaisons : si le code compare notre en-tête à une autre valeur qui porte le
   même numéro, cette autre valeur est l'en-tête qu'il attend. On recommence avec elle. Si elle mène au même refus
   par les mêmes adresses (le code vérifie l'en-tête et le premier descripteur par des instructions conditionnelles,
   comme fs pour Initialize), on essaie aussitôt les descripteurs avec cet en-tête.
3. Si l'aiguillage refuse encore, il vérifie les descripteurs : on essaie les genres connus aux places que l'en-tête
   attendu annonce (après les paramètres ordinaires).
4. On change un par un les 16 bits du bas de l'en-tête : si chaque changement est refusé, l'en-tête est vérifié en
   entier ; si aucun ne change rien, seul le numéro compte.

Aide ou fonction de travail. Un aiguillage appelle deux sortes de fonctions : des aides (lire le registre du fil,
découper des bits, fabriquer ou comparer un en-tête, reconnaître un descripteur) et la fonction qui traite la commande.
On laisse tourner les premières et on court-circuite les secondes. Le tri se fait sans liste d'adresses, à la première
rencontre de chaque fonction : on la laisse tourner à l'essai, en notant tout ce qu'elle écrit pour pouvoir le défaire.
C'est une aide si elle revient en n'ayant touché qu'à la pile, au tampon du fil et aux constantes du module (ni
variable globale, ni objet reçu, ni appel système), si elle est appelée d'au moins trois endroits du module
(HELPER_MIN_CALL_SITES), et si elle ne rend pas un code d'erreur. Sinon c'est une fonction de travail : l'essai est
défait et l'appel remplacé par « rend 0 ». Les deux dernières conditions écartent les fonctions de travail qui
ressemblent à une aide : la commande qui rend une constante (un seul appelant), et celle qui refuse ses arguments
avant d'avoir touché à quoi que ce soit (elle rend une erreur). Le classement de chaque fonction et sa raison sont dans
le .json, les aides sont rappelées sous chaque tableau, et --helper / --function corrigent une erreur de tri.

Deux choses qui ressemblent à un appel et n'en sont pas sont laissées passer : l'aide de « switch » du compilateur,
reconnue à son code, et le « bl » qui sert de saut long à l'intérieur de l'aiguillage (le Thumb n'a pas de saut long),
reconnu à ce que le code visé dépile le cadre de l'aiguillage au lieu de revenir.

CE QUE L'ÉMULATION SUPPOSE, ET DONC CE QU'ELLE NE PROUVE PAS.
- La mémoire est factice. Seul le module est chargé (code, constantes, données telles qu'elles sont dans le fichier,
  mémoire à zéro). L'objet passé en premier argument (r0) est une zone de zéros ; toute adresse inconnue est remplacée
  par une page de zéros (c'est signalé). Si l'aiguillage choisit son chemin d'après l'état de la session ou d'une
  variable globale, on ne voit que le chemin « tout à zéro » : dans hid, la commande 24 exige une session de type 3 et
  il faut le dire avec --set.
- Les fonctions de travail ne tournent pas. Elles sont remplacées par « rend 0 » : on apprend QUELLE fonction est
  appelée et quel en-tête de réponse suit un succès, pas ce que fait la fonction, ni ses codes d'erreur, ni les valeurs
  de la réponse. Les mots de la réponse autres que l'en-tête et le résultat ne veulent rien dire.
- Les appels système (svc) sont court-circuités aussi : ils rendent 0 sans rien faire.
- Seul le chemin du succès est suivi. Un contrôle qui dépend d'une valeur rendue par une fonction de travail (une
  taille, un droit) est vu comme réussi ou raté selon ce que donne zéro.
- « En-tête vérifié en entier » est établi sur les 16 bits du bas changés un par un, pas sur les 65 536 valeurs.
- Les descripteurs essayés sont une liste finie, avec une seule taille (0x40). Un aiguillage qui exige une taille
  précise avant d'appeler sa fonction apparaît comme « refusé malgré les descripteurs essayés ».
- Le tri entre aide et fonction de travail est une règle, pas une preuve. Il est à relire dans le .json quand une
  ligne étonne.
"""
import itertools
import json
import os
import struct
import sys

import elfer
import ghidra_direct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYLIB = os.path.join(ROOT, 'local', 'pylib')

TLS_BASE = 0x1FF82000            # là où le noyau de la 3DS pose le stockage local du premier fil
COMMAND_BUFFER = TLS_BASE + 0x80  # le tampon du fil : la requête à l'arrivée, la réponse au retour
STACK_BASE, STACK_SIZE = 0x0F000000, 0x10000
OBJECT_BASE, OBJECT_SIZE = 0x20000000, 0x10000   # l'objet factice passé en r0, que des zéros
SENTINEL = 0x0DEAD000            # l'adresse de retour de l'aiguillage : y arriver, c'est avoir fini
COMMAND_WORDS = 64
RUN_MAX_INSTRUCTIONS = 20000
HELPER_MAX_INSTRUCTIONS = 3000
HELPER_MIN_CALL_SITES = 3
DESCRIPTOR_SIZE = 0x40
MAX_DESCRIPTOR_PAIRS = 4



def import_emulator():
    """unicorn (l'émulateur) et capstone (le désassembleur) sont rangés dans local/pylib/, pas dans le Python du système."""
    sys.path.insert(0, PYLIB)
    try:
        import capstone
        import unicorn
    except ImportError:
        sys.exit('unicorn et capstone manquent dans %s. Les installer là, et seulement là :\n'
                 '    python -m pip install --target "%s" unicorn capstone' % (PYLIB, PYLIB))
    return unicorn, capstone


def describe_descriptor(word):
    """Le genre d'un descripteur de traduction, d'après ses bits du bas (3dbrew, « IPC »)."""
    if word & 0xF == 0xA:
        return 'tampon en lecture (0xA)'
    if word & 0xF == 0xC:
        return 'tampon en écriture (0xC)'
    if word & 0xF == 0xE:
        return 'tampon en lecture et écriture (0xE)'
    if word & 0xF == 0x2:
        return 'tampon statique n° %d (0x2)' % ((word >> 10) & 0xF)
    if word == 0x20:
        return 'numéro de processus (0x20)'
    if word == 0x10:
        return 'poignée déplacée (0x10)'
    return 'poignée copiée (0x0)' if word == 0 else '%#x' % word


# Les genres de descripteurs essayés à l'étape 3, les plus courants d'abord (3dbrew, « IPC ») : poignée, tampon où le
# service écrit, tampon qu'il lit, numéro de processus, tampons statiques n° 0 à 2, tampon lu et écrit, poignée déplacée.
DESCRIPTOR_CANDIDATES = [0x0, DESCRIPTOR_SIZE << 4 | 0xC, DESCRIPTOR_SIZE << 4 | 0xA, 0x20,
                         DESCRIPTOR_SIZE << 14 | 0x2, DESCRIPTOR_SIZE << 4 | 0xE, 0x10,
                         DESCRIPTOR_SIZE << 14 | 1 << 10 | 0x2, DESCRIPTOR_SIZE << 14 | 2 << 10 | 0x2]


class Module:
    """Le module tel qu'il est en mémoire au démarrage : trois sections lues dans code.bin, plus la mémoire à zéro."""

    def __init__(self, name):
        self.name = name
        folder = os.path.join(ROOT, 'local', 'extrait', name, 'exefs')
        if not os.path.isfile(os.path.join(folder, 'code.bin')):
            sys.exit('Pas de %s : extraire le module d\'abord (outils/extraire.py).' % os.path.join(folder, 'code.bin'))
        with open(os.path.join(folder, 'code.bin'), 'rb') as f:
            self.code = f.read()
        with open(os.path.join(folder, 'exheader.bin'), 'rb') as f:
            self.segments = elfer.segments_depuis_exheader(f.read(), len(self.code))
        if not self.segments:
            sys.exit('exheader illisible : pas de découpage en sections pour %s' % name)
        self.text_base, self.text_size = self.segments[0][0], self.segments[0][2]
        self.constants_end = self.segments[1][0] + self.segments[1][3]      # fin de .rodata
        self.end = self.segments[2][0] + self.segments[2][3]                # fin de la mémoire à zéro
        self.names = load_names(os.path.join(ROOT, 'fiches', name + '.noms.tsv'))
        self.modes = load_modes(os.path.join(ROOT, 'local', 'analyse', name, 'gh', 'funcs.tsv'))

    def in_text(self, address):
        return self.text_base <= address < self.text_base + self.text_size

    def is_constant(self, address):
        """Du code ou des données en lecture seule : les lire ne dépend d'aucun état."""
        return self.text_base <= address < self.constants_end

    def is_global(self, address):
        return self.constants_end <= address < self.end

    def text_bytes(self, address, size):
        return self.code[address - self.text_base:address - self.text_base + size]

    def guess_thumb(self, address):
        """Thumb ou ARM ? D'abord la liste de Ghidra si elle existe. Sinon la première instruction : une fonction
        Thumb commence presque toujours par « push {..., lr} » (0xB5xx), une instruction ARM sans condition a son
        quartet du haut à 0xE."""
        if address in self.modes:
            return self.modes[address] == 'thumb'
        half = struct.unpack_from('<H', self.text_bytes(address, 2))[0]
        word = struct.unpack_from('<I', self.text_bytes(address, 4))[0]
        return half & 0xFE00 == 0xB400 or word >> 28 != 0xE

    def count_call_sites(self):
        """Combien d'endroits du module appellent chaque adresse, par un balayage brut de .text : « bl » ARM tous les
        4 octets, paires « bl / blx » Thumb tous les 2 octets. Des données prises pour des appels ajoutent un peu de
        bruit ; on ne s'en sert que pour distinguer « appelée de partout » de « appelée d'un seul endroit »."""
        sites = {}
        code, base = self.code, self.text_base
        for offset in range(0, self.text_size - 3, 2):
            first, second = struct.unpack_from('<HH', code, offset)
            if first >> 11 == 0x1E and second >> 11 in (0x1F, 0x1D):
                distance = (first & 0x7FF) << 12 | (second & 0x7FF) << 1
                if distance & 0x400000:
                    distance -= 0x800000
                target = base + offset + 4 + distance
                if second >> 11 == 0x1D:              # blx : la cible est en ARM, alignée sur 4
                    target &= ~3
                if self.in_text(target):
                    sites.setdefault(target, set()).add(base + offset)
            if offset % 4 == 0:
                word = struct.unpack_from('<I', code, offset)[0]
                if word & 0x0F000000 == 0x0B000000 and word >> 28 != 0xF or word >> 25 == 0x7D:
                    distance = (word & 0xFFFFFF) << 2
                    if distance & 0x2000000:
                        distance -= 0x4000000
                    target = base + offset + 8 + distance + (word >> 23 & 2 if word >> 28 == 0xF else 0)
                    if self.in_text(target):
                        sites.setdefault(target, set()).add(base + offset)
        return {target: len(callers) for target, callers in sites.items()}


def load_names(path):
    """fiches/<module>.noms.tsv -> {adresse: nom}, pour que les tableaux se lisent."""
    names = {}
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                fields = line.rstrip('\n').split('\t')
                if len(fields) > 2 and fields[0].startswith('0x') and fields[2]:
                    names[int(fields[0], 16)] = fields[2]
    return names


def load_modes(path):
    """gh/funcs.tsv de ghidra_direct.py -> {adresse: 'arm' ou 'thumb'}. Absent, on devine."""
    modes = {}
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                fields = line.rstrip('\n').split('\t')
                if len(fields) > 3 and fields[0].startswith('0x'):
                    modes[int(fields[0], 16)] = next((x for x in fields[1:] if x in ('arm', 'thumb')), 'arm')
    return modes


class Emulator:
    """Une machine factice autour du module, qu'on relance pour chaque en-tête essayé."""

    def __init__(self, module, forced_helpers=(), forced_functions=(), presets=()):
        self.unicorn, self.capstone = import_emulator()
        self.arm = self.unicorn.arm_const
        self.module = module
        self.forced_helpers, self.forced_functions = set(forced_helpers), set(forced_functions)
        self.presets = list(presets)
        self.call_sites = module.count_call_sites()
        self.kinds = {}                # adresse -> 'helper', 'function', 'switch' ou 'jump', une fois décidé
        self.costs = {}                # adresse d'une aide -> le plus grand nombre d'instructions qu'elle a pris
        self.reasons = {}              # adresse -> pourquoi
        self.decoded = {}
        self.extra_pages = set()
        self.trace = None
        uc = self.uc = self.unicorn.Uc(self.unicorn.UC_ARCH_ARM, self.unicorn.UC_MODE_ARM)
        page = 0x1000
        start = module.text_base & ~(page - 1)
        uc.mem_map(start, (module.end - start + page - 1) & ~(page - 1))
        for base, offset, file_size, _, _ in module.segments:
            uc.mem_write(base, module.code[offset:offset + file_size])
        uc.mem_map(TLS_BASE & ~(page - 1), page)
        uc.mem_map(STACK_BASE, STACK_SIZE)
        uc.mem_map(OBJECT_BASE, OBJECT_SIZE)
        uc.mem_map(SENTINEL & ~(page - 1), page)
        # Les calculs en virgule flottante (VFP) sont coupés au démarrage d'un processeur ARM : on les autorise, sinon
        # la première instruction flottante d'un aiguillage arrête tout (hid rend un nombre flottant, commande 21).
        uc.reg_write(self.arm.UC_ARM_REG_C1_C0_2, uc.reg_read(self.arm.UC_ARM_REG_C1_C0_2) | 0xF00000)
        uc.reg_write(self.arm.UC_ARM_REG_FPEXC, 0x40000000)
        self.readers = {False: self.capstone.Cs(self.capstone.CS_ARCH_ARM, self.capstone.CS_MODE_ARM),
                        True: self.capstone.Cs(self.capstone.CS_ARCH_ARM, self.capstone.CS_MODE_THUMB)}
        for reader in self.readers.values():
            reader.detail = True
        self.general = [getattr(self.arm, 'UC_ARM_REG_R%d' % n) for n in range(13)]
        uc.hook_add(self.unicorn.UC_HOOK_CODE, self.on_instruction)
        uc.hook_add(self.unicorn.UC_HOOK_MEM_WRITE, self.on_write)
        uc.hook_add(self.unicorn.UC_HOOK_MEM_READ, self.on_read)
        uc.hook_add(self.unicorn.UC_HOOK_MEM_READ_UNMAPPED | self.unicorn.UC_HOOK_MEM_WRITE_UNMAPPED
                    | self.unicorn.UC_HOOK_MEM_FETCH_UNMAPPED, self.on_unmapped)
        uc.hook_add(self.unicorn.UC_HOOK_INTR, self.on_interrupt)

    # ------------------------------------------------------------------ lecture des instructions

    def decode(self, address):
        """Ce qu'on a besoin de savoir d'une instruction, calculé une fois : est-ce un appel, est-ce une comparaison
        entre deux valeurs qu'on peut relire (registre ou constante)."""
        info = self.decoded.get(address)
        if info is None:
            thumb = bool(self.uc.reg_read(self.arm.UC_ARM_REG_CPSR) & 0x20)
            data = bytes(self.uc.mem_read(address, 4))
            instruction = next(self.readers[thumb].disasm(data, address), None)
            is_call, compared, text, size = False, None, '?', 2 if thumb else 4
            if instruction is not None:
                text, size = '%s %s' % (instruction.mnemonic, instruction.op_str), instruction.size
                mnemonic = instruction.mnemonic.split('.')[0]
                is_call = instruction.id in (self.capstone.arm.ARM_INS_BL, self.capstone.arm.ARM_INS_BLX)
                if mnemonic[:3] in ('cmp', 'teq', 'sub', 'eor', 'rsb'):
                    operands = []
                    for operand in instruction.operands[-2:]:
                        if operand.type == self.capstone.arm.ARM_OP_REG and not operand.shift.type:
                            name = instruction.reg_name(operand.reg).upper()
                            operands.append(('reg', getattr(self.arm, 'UC_ARM_REG_' + name, None)))
                        elif operand.type == self.capstone.arm.ARM_OP_IMM:
                            operands.append(('imm', operand.imm & 0xFFFFFFFF))
                    if len(operands) == 2 and all(kind != 'reg' or register is not None for kind, register in operands):
                        compared = operands
            info = self.decoded[address] = (is_call, compared, text, size, thumb)
        return info

    def is_switch_helper(self, address):
        code = self.module.text_bytes(address, 24) if self.module.in_text(address) else b''
        return any(code.startswith(signature) for signature in ghidra_direct.SWITCH_HELPER_SIGNATURES)

    # ------------------------------------------------------------------ les crochets de l'émulateur

    def on_instruction(self, uc, address, size, user):
        run = self.run
        trial = run['trial']
        if run['pending_call'] is not None:
            return_address, run['pending_call'] = run['pending_call'], None
            if trial is None and address != return_address:     # même adresse : appel sous condition, pas pris
                self.enter_call(address, return_address)
                if run['redirect'] is not None:
                    return
                trial = run['trial']
        if trial is not None:
            stack = uc.reg_read(self.arm.UC_ARM_REG_SP)
            trial['count'] += 1
            if stack > trial['sp']:
                self.end_trial('jump', 'dépile le cadre de l\'aiguillage : un saut long écrit « bl », pas un appel')
                return
            if address == trial['return'] and stack == trial['sp']:
                verdict = self.judge(trial, uc.reg_read(self.arm.UC_ARM_REG_R0))
                if verdict is not None:
                    self.end_trial('function', verdict)
                    return
                run['calls'].append((trial['entry'], 'helper'))
                self.costs[trial['entry']] = max(self.costs.get(trial['entry'], 0), trial['count'])
                if trial['entry'] not in self.kinds:
                    self.kinds[trial['entry']] = 'helper'
                    self.reasons[trial['entry']] = 'ne touche que la pile, le tampon du fil et les constantes'
                self.note('    aide %#x revenue après %d instructions' % (trial['entry'], trial['count']))
                run['trial'] = trial = None
            elif trial['count'] > HELPER_MAX_INSTRUCTIONS:
                self.end_trial('function', trial['impure'] or 'ne revient pas en %d instructions' % HELPER_MAX_INSTRUCTIONS)
                return
        is_call, compared, text, _, _ = self.decode(address)
        if self.trace is not None:
            self.trace.append('%s%#x: %s' % ('        ' if trial else '', address, text))
        if compared is not None:
            values = [uc.reg_read(value) if kind == 'reg' else value for kind, value in compared]
            header = run['header']
            for mine, other in (values, values[::-1]):
                if mine == header and other != header and other >> 16 == header >> 16:
                    run['expected'].add(other)
        if trial is None:
            run['path'] = hash((run['path'], address))
            run['count'] += 1
            if is_call:
                run['pending_call'] = address + size
            if run['count'] > RUN_MAX_INSTRUCTIONS:
                run['end'] = 'ne finit pas en %d instructions' % RUN_MAX_INSTRUCTIONS
                uc.emu_stop()

    def judge(self, trial, returned_value):
        """La fonction essayée vient de revenir. Rend None si c'est une aide, sinon la raison d'en faire une fonction
        de travail. Le verdict est rendu une fois, à la première rencontre, et ne change plus : une aide reconnue
        peut plus tard rendre un en-tête dont le bit 31 est à 1 sans qu'on y voie un code d'erreur."""
        entry = trial['entry']
        if entry in self.forced_helpers or self.kinds.get(entry) == 'helper':
            return None
        if trial['impure']:
            return trial['impure']
        sites = self.call_sites.get(entry, 0)
        if sites < HELPER_MIN_CALL_SITES:
            return 'appelée de %d endroit(s) du module seulement' % sites
        # Une fonction de travail peut ressembler à une aide quand elle refuse ses arguments tout de suite, sans avoir
        # touché à rien. Elle se trahit en rendant un code d'erreur (bit 31 à 1), ce qu'une aide ne fait pas.
        if returned_value >> 31:
            return 'rend un code d\'erreur (%#x) sans avoir rien touché' % returned_value
        return None

    def enter_call(self, address, return_address):
        """L'aiguillage vient d'exécuter « bl address ». Ce que c'est se décide à la première rencontre :
        - l'aide de switch, reconnue à son code : elle saute à une case, on laisse filer ;
        - une fonction de travail déjà connue : on la remplace par « rend 0 » ;
        - sinon un essai. On laisse tourner sous surveillance, en notant tout ce qui est écrit pour pouvoir le
          défaire. Si elle revient sans avoir touché à l'état du module, c'est une aide et l'essai devient
          l'exécution. Si elle revient après y avoir touché, c'est une fonction de travail : on défait tout et on la
          court-circuite. Si elle ne revient pas mais dépile le cadre de l'aiguillage, ce n'était pas un appel : le
          Thumb n'a pas de saut long, et le compilateur écrit « bl » pour sauter loin dans la même fonction (vu dans
          cfg:i, vers le morceau qui pose le résultat et sort). On défait tout et on repart de là en mode normal."""
        run, uc = self.run, self.uc
        kind = self.kinds.get(address)
        if kind is None and self.is_switch_helper(address):
            kind = self.kinds[address] = 'switch'
            self.reasons[address] = 'aide de switch reconnue à son code'
        if kind is None and address in self.forced_functions:
            kind = self.kinds[address] = 'function'
            self.reasons[address] = 'imposé par --function'
        if kind in ('switch', 'jump'):
            self.note('    %s %#x' % ('aide de switch' if kind == 'switch' else 'saut long', address))
            return
        if kind == 'function':
            self.stub(address)
            return
        run['trial'] = {'entry': address, 'return': return_address, 'sp': uc.reg_read(self.arm.UC_ARM_REG_SP),
                        'count': 0, 'impure': None, 'context': uc.context_save(), 'journal': len(run['journal']),
                        'calls': len(run['calls']), 'unknown': len(run['unknown_memory']),
                        'expected': set(run['expected']), 'trace': len(self.trace) if self.trace is not None else 0}

    def stub(self, address):
        """Remplace l'appel par « rend 0 » : on arrête l'émulateur, execute() le relancera à l'adresse de retour."""
        run, uc = self.run, self.uc
        arguments = [uc.reg_read(register) for register in self.general[:4]]
        run['calls'].append((address, 'function'))
        run['arguments'].append(arguments)
        self.note('    fonction de travail %#x(%s) -> rend 0' % (address, ', '.join('%#x' % a for a in arguments)))
        uc.reg_write(self.arm.UC_ARM_REG_R0, 0)
        run['redirect'] = uc.reg_read(self.arm.UC_ARM_REG_LR)
        uc.emu_stop()

    def end_trial(self, kind, reason):
        """L'essai n'a pas montré une aide : on défait tout ce qui a été écrit depuis l'appel, on remet les registres
        comme à l'entrée, puis on court-circuite (fonction de travail) ou on repart de l'adresse visée (saut long)."""
        run, uc, trial = self.run, self.uc, self.run['trial']
        while len(run['journal']) > trial['journal']:
            address, old = run['journal'].pop()
            uc.mem_write(address, old)
        uc.context_restore(trial['context'])
        del run['calls'][trial['calls']:]
        del run['unknown_memory'][trial['unknown']:]
        run['expected'] = trial['expected']
        run['trial'] = None
        entry = trial['entry']
        if self.trace is not None:
            del self.trace[trial['trace']:]
        self.kinds[entry] = kind
        self.reasons[entry] = reason
        self.note('    essai de %#x défait (%s)' % (entry, reason))
        if kind == 'function':
            self.stub(entry)
        else:
            run['redirect'] = entry | (1 if uc.reg_read(self.arm.UC_ARM_REG_CPSR) & 0x20 else 0)
            uc.emu_stop()

    def on_write(self, uc, access, address, size, value, user):
        run = self.run
        run['journal'].append((address, bytes(uc.mem_read(address, size))))
        trial = run['trial']
        if trial is not None and not trial['impure']:
            if not (STACK_BASE <= address < STACK_BASE + STACK_SIZE or TLS_BASE <= address < TLS_BASE + 0x1000):
                trial['impure'] = 'écrit hors de la pile et du tampon du fil, à %#x' % address

    def on_read(self, uc, access, address, size, value, user):
        run = self.run
        trial = run['trial']
        if self.module.is_constant(address) or STACK_BASE <= address < STACK_BASE + STACK_SIZE \
                or TLS_BASE <= address < TLS_BASE + 0x1000:
            return
        if trial is not None:
            if not trial['impure']:
                trial['impure'] = 'lit une variable globale ou un objet, à %#x' % address
        elif address & ~0xFFF in self.extra_pages:
            if address not in run['unknown_memory']:
                run['unknown_memory'].append(address)
        elif address not in run['state_reads']:
            run['state_reads'].append(address)

    def on_unmapped(self, uc, access, address, size, value, user):
        """Une adresse que rien ne couvre : on y pose une page de zéros et on le note, c'est de la mémoire factice."""
        page = address & ~0xFFF
        try:
            uc.mem_map(page, 0x1000)
        except self.unicorn.UcError:
            return False
        self.extra_pages.add(page)
        self.run['unknown_memory'].append(address)
        if self.run['trial'] is not None and not self.run['trial']['impure']:
            self.run['trial']['impure'] = 'touche une adresse inconnue, %#x' % address
        return True

    def on_interrupt(self, uc, number, user):
        """Un appel système : il rend 0 sans rien faire. Dans un essai, c'est le signe d'une fonction de travail."""
        run = self.run
        pc = uc.reg_read(self.arm.UC_ARM_REG_PC)
        thumb = bool(uc.reg_read(self.arm.UC_ARM_REG_CPSR) & 0x20)
        try:
            svc = uc.mem_read(pc - 2, 1)[0] if thumb else struct.unpack('<I', uc.mem_read(pc - 4, 4))[0] & 0xFFFFFF
        except self.unicorn.UcError:
            svc = -1
        if run['trial'] is not None:
            run['trial']['impure'] = 'fait un appel système (svc %#x)' % svc
        else:
            run['svc'].append(svc)
            uc.reg_write(self.arm.UC_ARM_REG_R0, 0)

    def note(self, text):
        if self.trace is not None:
            self.trace.append(text)

    # ------------------------------------------------------------------ un passage

    def execute(self, entry, thumb, words):
        """Lance l'aiguillage avec ces mots dans le tampon du fil. Rend ce qui s'est passé."""
        uc, arm = self.uc, self.arm
        self.run = run = {'header': words[0], 'count': 0, 'calls': [], 'arguments': [], 'expected': set(), 'svc': [],
                          'unknown_memory': [], 'state_reads': [], 'journal': [], 'trial': None, 'pending_call': None,
                          'redirect': None, 'end': None, 'path': 0}
        for register in self.general:
            uc.reg_write(register, 0)
        uc.reg_write(arm.UC_ARM_REG_CPSR, 0x10)
        uc.reg_write(arm.UC_ARM_REG_R0, OBJECT_BASE + 0x100)
        uc.reg_write(arm.UC_ARM_REG_SP, STACK_BASE + STACK_SIZE // 2)
        uc.reg_write(arm.UC_ARM_REG_LR, SENTINEL | (1 if thumb else 0))
        uc.reg_write(arm.UC_ARM_REG_C13_C0_3, TLS_BASE)
        padded = list(words) + [0] * (COMMAND_WORDS - len(words))
        uc.mem_write(COMMAND_BUFFER, struct.pack('<%dI' % COMMAND_WORDS, *padded))
        for name, value in self.presets:
            if isinstance(name, int):
                uc.mem_write(name, struct.pack('<I', value))
            else:
                uc.reg_write(getattr(arm, 'UC_ARM_REG_' + name.upper()), value)
        start = entry | (1 if thumb else 0)
        while True:
            try:
                uc.emu_start(start, SENTINEL)
            except self.unicorn.UcError as error:
                if run['trial'] is None:
                    run['end'] = 'erreur de l\'émulateur à %#x : %s' % (uc.reg_read(arm.UC_ARM_REG_PC), error)
                    break
                self.end_trial('function', run['trial']['impure'] or 'plante sur la mémoire factice (%s)' % error)
            else:
                if run['trial'] is not None and run['redirect'] is None and run['end'] is None:
                    self.end_trial('jump', 'sort de l\'aiguillage sans revenir : un saut long écrit « bl », pas un appel')
            if run['redirect'] is None:
                break
            start, run['redirect'] = run['redirect'], None
            if start & ~1 == SENTINEL:      # la fonction court-circuitée était le dernier geste de l'aiguillage
                uc.reg_write(arm.UC_ARM_REG_PC, SENTINEL)
                break
        if run['end'] is None:
            pc = uc.reg_read(arm.UC_ARM_REG_PC)
            run['end'] = 'ok' if pc == SENTINEL else 'arrêté à %#x' % pc
        reply = struct.unpack('<%dI' % COMMAND_WORDS, uc.mem_read(COMMAND_BUFFER, 4 * COMMAND_WORDS))
        # Tout remettre comme avant : les écritures sont défaites dans l'ordre inverse, les pages ajoutées vidées.
        for address, old in reversed(run['journal']):
            uc.mem_write(address, old)
        uc.mem_write(COMMAND_BUFFER, bytes(4 * COMMAND_WORDS))
        functions = [address for address, kind in run['calls'] if kind == 'function']
        return {'request': list(words), 'calls': run['calls'], 'functions': functions, 'arguments': run['arguments'],
                'reply': reply[0], 'result': reply[1], 'reply_words': list(reply[:8]), 'end': run['end'],
                'expected': sorted(run['expected']), 'svc': run['svc'], 'unknown_memory': run['unknown_memory'],
                'state_reads': run['state_reads'], 'path': run['path']}

    @staticmethod
    def outcome(result):
        """Ce qui distingue deux passages : les fonctions de travail appelées, l'en-tête et le résultat de la réponse."""
        return (tuple(result['functions']), result['reply'], result['result'], result['end'], tuple(result['svc']))


def explore(emulator, entry, thumb, first, last):
    """Toutes les commandes d'un aiguillage sur la plage [first, last]. Rend (lignes, résultat d'un numéro inconnu)."""
    probes = {number: emulator.execute(entry, thumb, [number << 16]) for number in range(first, last + 1)}
    # Le résultat le plus fréquent est celui d'un numéro inconnu : sur 65 536 numéros, quelques dizaines existent.
    tally = {}
    for result in probes.values():
        tally[Emulator.outcome(result)] = tally.get(Emulator.outcome(result), 0) + 1
    unknown = max(tally, key=tally.get)
    if len(probes) < 16 or tally[unknown] * 2 < len(probes):
        unknown = None      # plage trop courte ou trop pleine pour le dire : toutes les lignes sont gardées
    rows = []
    for number, probe in probes.items():
        if unknown is not None and Emulator.outcome(probe) == unknown and not probe['expected']:
            continue
        row = study_command(emulator, entry, thumb, number, probe)
        # Un numéro qui donne le résultat « inconnu » et dont l'en-tête n'est pas vérifié n'existe pas : la
        # comparaison surprise au passage n'en était pas une d'en-tête.
        if unknown is None or row['check'] != 'numéro' or (tuple(row['functions']), row['reply'], row['result'],
                                                            row['end'], tuple(row['svc'])) != unknown:
            rows.append(row)
    return rows, unknown


def study_command(emulator, entry, thumb, number, probe):
    """Une commande qui existe : trouver l'en-tête et les descripteurs qu'elle accepte, puis dire ce qu'elle vérifie.

    Deux passages se comparent de deux façons. Leur « résultat » (fonctions appelées, en-tête et résultat de la
    réponse) dit si la commande a abouti. Leur « chemin » (la suite des instructions de l'aiguillage) dit si le code a
    fait la différence entre deux requêtes, même quand les deux finissent refusées."""
    def run(words):
        return emulator.execute(entry, thumb, words)

    def search_descriptors(header, rejected):
        """Étape 3 : les descripteurs. L'en-tête dit où ils sont : après les paramètres ordinaires, deux mots chacun.
        Rend (passage, mots de la requête, descripteurs exigés) pour la première combinaison qui n'est plus refusée,
        ou None."""
        normal, translate = header >> 6 & 0x3F, header & 0x3F
        if 1 + normal + translate > COMMAND_WORDS:   # une valeur comparée qui n'est pas un en-tête possible
            return None
        slots = [1 + normal + 2 * index for index in range(min(translate // 2, MAX_DESCRIPTOR_PAIRS))]
        for choice in itertools.product(DESCRIPTOR_CANDIDATES, repeat=len(slots)):
            attempt_words = [header] + [0] * (normal + translate)
            for slot, descriptor in zip(slots, choice):
                attempt_words[slot], attempt_words[slot + 1] = descriptor, OBJECT_BASE + 0x8000 + 0x100 * slot
            attempt = run(attempt_words)
            if Emulator.outcome(attempt) not in rejected:
                # Lesquels comptent vraiment : à la place de chacun, on essaie tous les genres.
                required = {}
                for slot in slots:
                    accepted = []
                    for other in DESCRIPTOR_CANDIDATES:
                        changed = list(attempt_words)
                        changed[slot] = other
                        if Emulator.outcome(run(changed)) == Emulator.outcome(attempt):
                            accepted.append(other)
                    if len(accepted) < len(DESCRIPTOR_CANDIDATES):
                        required[slot] = accepted
                return attempt, attempt_words, required
        return None

    # Étape 2 : l'en-tête attendu, vu dans une comparaison. On le garde s'il change le chemin suivi (sinon ce n'était
    # pas une comparaison d'en-tête), ou si, avec des descripteurs, la commande cesse d'être refusée. Ce second cas
    # existe : dans fs, l'en-tête et le premier descripteur sont vérifiés par des instructions conditionnelles qui
    # mènent au même refus, donc par le même chemin d'adresses que la requête « numéro << 16 » (Initialize, 0x0801).
    best, method, words, required = probe, 'numéro << 16', None, {}
    for candidate in probe['expected']:
        attempt = run([candidate])
        if attempt['path'] != probe['path']:
            best, method = attempt, 'en-tête lu dans une comparaison du code'
            break
        found = search_descriptors(candidate, {Emulator.outcome(probe)}) if candidate & 0x3F else None
        if found:
            best, words, required = found
            method = 'en-tête lu dans une comparaison du code, accepté avec ses descripteurs'
            break
    header = best['request'][0]
    translate = header & 0x3F

    # Le même en-tête avec un bit du bas changé, seize fois. Les passages qui prennent un autre chemin, ou un autre
    # résultat, sont ceux d'un en-tête refusé : leur résultat sert de repère à l'étape 3.
    tail = words[1:] if words else []
    flips = [run([header ^ (1 << bit)] + tail) for bit in range(16)]
    rejected = {Emulator.outcome(flip) for flip in flips
                if flip['path'] != best['path'] or Emulator.outcome(flip) != Emulator.outcome(best)}

    # Étape 3, quand l'étape 2 ne l'a pas déjà faite : l'en-tête est accepté mais la commande finit quand même comme
    # un en-tête refusé.
    if words is None:
        words = [header]
        if translate and Emulator.outcome(best) in rejected:
            found = search_descriptors(header, rejected)
            if found:
                best, words, required = found
                flips = [run([header ^ (1 << bit)] + words[1:]) for bit in range(16)]

    # Étape 4 : ce que l'aiguillage vérifie de l'en-tête.
    checked_mask = sum(1 << bit for bit, flip in enumerate(flips)
                       if flip['path'] != best['path'] or Emulator.outcome(flip) != Emulator.outcome(best))
    check = 'numéro' if checked_mask == 0 else 'entier' if checked_mask == 0xFFFF else 'partiel'
    return {'number': number, 'check': check, 'expected_header': header if check != 'numéro' else None,
            'checked_mask': checked_mask, 'method': method, 'request': words,
            'descriptors': {str(slot): accepted for slot, accepted in sorted(required.items())},
            'function': best['functions'][0] if best['functions'] else None, 'functions': best['functions'],
            'calls': best['calls'], 'arguments': best['arguments'], 'reply': best['reply'], 'result': best['result'],
            'reply_words': best['reply_words'], 'end': best['end'], 'svc': best['svc'],
            'unknown_memory': best['unknown_memory'], 'state_reads': best['state_reads'],
            'refused': check != 'numéro' and Emulator.outcome(best) in rejected}


def format_table(module, emulator, label, entry, thumb, rows, unknown, first, last):
    lines = ['Aiguillage %#x%s du module %s (%s), numéros %#06x à %#06x : %d commande(s).'
             % (entry, ' (' + label + ')' if label else '', module.name, 'Thumb' if thumb else 'ARM', first, last, len(rows))]
    if unknown is not None:
        lines.append('Numéro inconnu : en-tête de réponse %#010x, résultat %#010x.' % (unknown[1], unknown[2]))
    lines.append('')
    lines.append('%-7s %-11s %-8s %-9s %-36s %-11s %-11s %s' % ('N°', 'Requête', 'Vérifié', 'Fonction', 'Nom', 'Réponse',
                                                                 'Résultat', 'Remarques'))
    for row in rows:
        remarks = []
        for slot, accepted in row['descriptors'].items():
            remarks.append('mot %s : %s' % (slot, ' ou '.join(describe_descriptor(word) for word in accepted)))
        if row['check'] == 'partiel':
            remarks.append('bits de l\'en-tête vérifiés : %#06x' % row['checked_mask'])
        if row['refused']:
            remarks.append('refusé malgré les descripteurs essayés')
        if len(row['functions']) > 1:
            remarks.append('puis ' + ', '.join('%#x' % a for a in row['functions'][1:]))
        if row['svc']:
            remarks.append('svc ' + ', '.join('%#x' % n for n in row['svc']))
        if row['state_reads']:
            remarks.append('lit l\'état (%s)' % ', '.join('%#x' % a for a in row['state_reads'][:3]))
        if row['unknown_memory']:
            remarks.append('mémoire inconnue (%s)' % ', '.join('%#x' % a for a in row['unknown_memory'][:3]))
        if row['end'] != 'ok':
            remarks.append(row['end'])
        function = row['function']
        lines.append('%-7s %-11s %-8s %-9s %-36s %-11s %-11s %s' % (
            '%#06x' % row['number'], '%#010x' % row['expected_header'] if row['check'] != 'numéro' else '-', row['check'],
            '%#x' % function if function else '-', module.names.get(function, '') if function else 'dans l\'aiguillage',
            '%#010x' % row['reply'], '%#010x' % row['result'], ' ; '.join(remarks)))
    called = {address for row in rows for address, _ in row['calls']}
    helpers = ['%#x%s (%d appelants)' % (a, ' ' + module.names[a] if a in module.names else '', emulator.call_sites.get(a, 0))
               for a in sorted(called) if emulator.kinds.get(a) == 'helper']
    lines.append('')
    lines.append('Aides laissées tourner, à relire si une ligne étonne : %s.' % (', '.join(helpers) or 'aucune'))
    return '\n'.join(lines) + '\n'


def parse_number(text):
    return int(text, 0)


def main(args):
    def options(name):
        values = []
        while name in args:
            index = args.index(name)
            values.append(args[index + 1])
            del args[index:index + 2]
        return values

    def flag(name):
        present = name in args
        while name in args:
            args.remove(name)
        return present

    span = (options('--range') or ['0-0xFFFF'])[-1]
    first, last = (parse_number(part) for part in span.split('-'))
    presets = []
    for item in options('--set'):
        name, value = item.split('=')
        presets.append((parse_number(name) if name[:1].isdigit() else name, parse_number(value)))
    helpers = [parse_number(a) for a in options('--helper')]
    functions = [parse_number(a) for a in options('--function')]
    traced = options('--trace')
    force_thumb, force_arm = flag('--thumb'), flag('--arm')
    if len(args) < 2:
        print(__doc__)
        return 1
    module = Module(args[0])
    emulator = Emulator(module, helpers, functions, presets)
    out = os.path.join(ROOT, 'local', 'analyse', module.name)
    os.makedirs(out, exist_ok=True)
    for item in args[1:]:
        address, _, label = item.partition('=')
        entry = parse_number(address) & ~1
        thumb = True if force_thumb else False if force_arm else bool(parse_number(address) & 1) or module.guess_thumb(entry)
        if traced:
            for number in traced:
                emulator.trace = []
                result = emulator.execute(entry, thumb, [parse_number(number) << 16])
                print('\n'.join(emulator.trace))
                print(json.dumps({k: v for k, v in result.items() if k != 'calls'}, ensure_ascii=False, default=hex))
            emulator.trace = None
            continue
        rows, unknown = explore(emulator, entry, thumb, first, last)
        table = format_table(module, emulator, label, entry, thumb, rows, unknown, first, last)
        base = os.path.join(out, 'emulate_dispatch_%#x' % entry)
        with open(base + '.txt', 'w', encoding='utf-8', newline='\n') as f:
            f.write(table)
        called = {address for row in rows for address, _ in row['calls']}
        classified = {'%#x' % a: {'kind': emulator.kinds[a], 'why': emulator.reasons.get(a, ''),
                                  'call_sites': emulator.call_sites.get(a, 0), 'name': module.names.get(a)}
                      for a in sorted(called) if a in emulator.kinds}
        with open(base + '.json', 'w', encoding='utf-8', newline='\n') as f:
            json.dump({'module': module.name, 'dispatcher': entry, 'label': label, 'thumb': thumb, 'range': [first, last],
                       'unknown_command': None if unknown is None else {'reply': unknown[1], 'result': unknown[2]},
                       'assumptions': 'mémoire factice, fonctions de travail et appels système remplacés par « rend 0 » : '
                                      'voir la docstring de outils/emulate_dispatch.py',
                       'callees': classified, 'commands': rows}, f, ensure_ascii=False, indent=1)
        print(table)
        print('-> %s.txt et .json' % base)
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main(sys.argv[1:]))
