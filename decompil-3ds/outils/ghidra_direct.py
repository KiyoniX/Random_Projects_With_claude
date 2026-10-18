"""Analyse un module avec Ghidra lancé directement sous Ubuntu (WSL), sans REA : le chemin pour les modules en Thumb.

    python ghidra_direct.py <module> [--no-names] [--plan]
    python ghidra_direct.py test

        <module>      un dossier de local/extrait/ (cfg, ptm, fs...) : il lit exefs/code.bin, exheader.bin et code.elf
        --no-names    n'applique pas fiches/<module>.noms.tsv : pour voir ce que la recherche automatique trouve seule
        --plan        n'appelle pas Ghidra : affiche seulement les graines, les candidats et les tables de switch

Il range dans local/analyse/<module>/gh/ :
    funcs.tsv     la liste des fonctions : adresse, taille, « arm » ou « thumb », nom (séparés par des tabulations)
    pseudo/       le pseudo-code, un fichier 0xADRESSE.c par fonction
    refs.tsv      toutes les références : depuis, vers, genre, fonction qui contient « depuis »
    seeds.tsv, candidates.tsv, switches.tsv    ce qui a été donné à Ghidra (pour comprendre un résultat)
    ghidra.log    tout ce que Ghidra a écrit
    project/      le projet Ghidra, qu'on peut rouvrir dans l'interface avec les noms et les fonctions en place

Pourquoi ce chemin existe. Par le pont REA (rea_bridge.py, prescan.py), une graine ne sait créer qu'une fonction ARM :
dans un module en Thumb (fs, cfg, ptm), le pont ne voit qu'une partie du code, et prescan annonce « aucune fonction
manquée » alors qu'il en manque des centaines. Ici on parle à Ghidra sans intermédiaire, avec quatre scripts rangés
dans ghidra_scripts/, et on lui donne ce qu'il ne trouve pas seul.

Ce que Ghidra ne trouve pas seul, et comment on le lui donne :

1. Les fonctions appelées seulement par un pointeur (méthodes d'objets, gestionnaires de commandes, fonctions de fils).
   Un pointeur vers du code Thumb est IMPAIR : l'adresse de la fonction plus un. On relève donc tous les mots impairs
   du fichier qui tombent dans .text. Certains ne sont pas des pointeurs mais des nombres qui y ressemblent (les
   identifiants de blocs 0x00100001 et 0x00100003 de cfg, des constantes de fs) : on les écarte ainsi.
   - Ceux qui tombent sur un « push {..., lr} » (0xB5xx), le début habituel d'une fonction Thumb, sont sûrs : ils
     sont posés AVANT l'analyse (seeds.tsv), pour que tout ce qu'ils appellent soit découvert au premier passage.
   - Les autres sont jugés APRÈS l'analyse (candidates.tsv) : un faux pointeur tombe alors au milieu d'une fonction
     déjà connue, ou sur du code ARM, et Ghidra le refuse. Un vrai tombe sur des octets pas encore lus.
2. Les tables de distances : la table d'initialisation des objets globaux ne contient pas des adresses mais des
   distances (cible = mot + adresse de la case), avec le même bit impair pour le Thumb. Une suite d'au moins trois
   cases qui tombent toutes dans .text est une table ; elle est acceptée en bloc ou refusée en bloc.
3. Les pointeurs pairs vers un début de fonction ARM plausible, comme le fait prescan, jugés eux aussi après l'analyse.
4. Les « switch » Thumb. Le compilateur ARM n'écrit pas la table de saut dans le code de la fonction : il appelle une
   aide (__ARM_common_switch8) suivie d'un octet N, de N octets (un par cas) et d'un octet pour le cas par défaut ;
   l'aide lit cette table et saute. Elle est reconnue ici À SON CODE (les six mêmes instructions dans tous les
   modules), pas à une adresse. Elle reçoit le réglage « Call Fixup » switch8_r3 avant l'analyse, sinon Ghidra croit
   que l'exécution continue après l'appel et désassemble la table comme du code. Puis les cibles de chaque table,
   décodées ici, sont imposées au décompilateur, qui souvent ne les retrouve pas (« Could not recover jumptable »).
5. Les trous : après tout cela, un morceau de .text que Ghidra n'a pas lu est une fonction que plus rien ne désigne
   (du code mort de la bibliothèque, souvent) s'il commence par « push {..., lr} », ou s'il est collé à la fin d'une
   fonction, et s'il se désassemble proprement jusqu'à un retour. Elle est créée, signalée dans le compte rendu
   (« à relire » pour le second cas, moins sûr), et on recommence tant que quelque chose change.

Les noms de fiches/<module>.noms.tsv sont posés à la fin, APRÈS l'analyse (lignes « function » pour l'ARM, « label »
pour le Thumb). Les poser avant abîme le résultat : voir ApplyNames.java.

Ce qu'il ne fait pas. Il ne garantit pas que toutes les fonctions sont trouvées : une fonction Thumb qui ne commence
pas par « push » et que rien ne désigne reste invisible. Et le pseudo-code des aiguillages reste douteux même avec les
tables imposées : pour savoir quelle commande mène à quelle fonction, utiliser emulate_dispatch.py, qui exécute le code.

Pour un binaire qui n'est pas un module (boot9, boot11, kernel11, kernel9, Process9), voir ghidra_raw.py : même
recherche des graines (Image et find_pointers ci-dessous), même lancement de Ghidra (run_headless).
"""
import os
import shlex
import shutil
import struct
import subprocess
import sys

import elfer
import rea_bridge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ghidra_scripts')
GHIDRA_HEADLESS = '/opt/ghidra/support/analyzeHeadless'
LANGUAGE = 'ARM:LE:32:v6'
RELATIVE_RUN_IN_DATA, RELATIVE_RUN_IN_TEXT = 3, 5
# Le fichier de noms porte le nom du module, sauf pour le code de Pokémon X : son dossier est « maj » (la mise à jour).
NAME_FILES = {'maj': 'pokemon-x'}

# L'aide de switch du compilateur ARM, telle qu'elle est dans tous les modules de la console et dans Pokémon X :
#     ldrb ip, [lr, #-1]      le nombre de cas (lr est impair : lr - 1 est l'octet qui suit l'appel)
#     cmp r3, ip              r3 est le numéro du cas
#     ldrbhs r3, [lr, ip]     hors plage : l'octet du cas par défaut
#     ldrblo r3, [lr, r3]     sinon l'octet du cas
#     add ip, lr, r3, lsl #1  cible = adresse de retour + 2 × octet
#     bx ip
# La valeur est le réglage « Call Fixup » de Ghidra qui décrit ce code. Une autre variante (table de mots de 16 bits,
# index dans un autre registre) n'a jamais été rencontrée : si un module en a une, c'est ici qu'il faut l'ajouter.
SWITCH_HELPER_SIGNATURES = {
    bytes.fromhex('01c05ee50c0053e10c30de270330de3783c08ee01cff2fe1'): 'switch8_r3',
    # La variante de boot9 (0xFFFF0CDC) : les deux lectures conditionnelles dans l'autre ordre, même effet.
    bytes.fromhex('01c05ee50c0053e10330de370c30de2783c08ee01cff2fe1'): 'switch8_r3',
}


def load_module(module):
    folder = os.path.join(ROOT, 'local', 'extrait', module, 'exefs')
    if not os.path.isfile(os.path.join(folder, 'code.bin')):
        sys.exit('Pas de %s : extraire le module d\'abord.' % os.path.join(folder, 'code.bin'))
    with open(os.path.join(folder, 'code.bin'), 'rb') as f:
        code = f.read()
    with open(os.path.join(folder, 'exheader.bin'), 'rb') as f:
        exheader = f.read()
    segments = elfer.segments_depuis_exheader(exheader, len(code))
    if not segments:
        sys.exit('exheader illisible : pas de découpage en sections pour %s' % module)
    elf = os.path.join(folder, 'code.elf')
    if not os.path.isfile(elf):
        with open(elf, 'wb') as f:
            f.write(elfer.envelopper(code, exheader))
    return folder, code, segments


def find_switch_helpers(code, text_base, text_size):
    """{adresse: réglage Call Fixup} des aides de switch, reconnues à leurs octets."""
    helpers = {}
    for offset in range(0, text_size - 23, 4):
        for signature, fixup in SWITCH_HELPER_SIGNATURES.items():
            if code.startswith(signature, offset):
                helpers[text_base + offset] = fixup
    return helpers


def find_switch_sites(code, text_base, text_size, helpers):
    """Les appels « blx aide » du code Thumb et leur table : [(adresse de l'appel, nombre de cas, cibles)].
    La dernière cible est le cas par défaut. Un « blx » Thumb tient en deux demi-mots : 11110 + haut de la distance,
    puis 11101 + bas de la distance ; la cible est en ARM, donc alignée sur 4."""
    sites = []
    for offset in range(0, text_size - 5, 2):
        first, second = struct.unpack_from('<HH', code, offset)
        if first >> 11 != 0x1E or second >> 11 != 0x1D:
            continue
        distance = (first & 0x7FF) << 12 | (second & 0x7FF) << 1
        if distance & 0x400000:
            distance -= 0x800000
        if ((text_base + offset + 4) & ~3) + distance not in helpers:
            continue
        table = offset + 4
        count = code[table]
        if table + count + 2 > text_size:
            continue
        targets = [text_base + table + 2 * code[table + 1 + index] for index in range(count + 1)]
        if all(target < text_base + text_size for target in targets):
            sites.append((text_base + offset, count, targets))
    return sites


def find_arm_jump_slots(code, text_size):
    """Les cases des tables de saut ARM (« cmp rX, #n » puis « ldrcc pc, [pc, rX, lsl #2] ») : ce sont des adresses de
    branches à l'intérieur d'une fonction, pas des fonctions. Même repérage que dans prescan.py."""
    slots = set()
    for offset in range(4, text_size - 11, 4):
        word = struct.unpack_from('<I', code, offset)[0]
        if word & 0x0FFFFFF0 != 0x079FF100:
            continue
        compare = struct.unpack_from('<I', code, offset - 4)[0]
        if compare & 0x0FF0F000 != 0x03500000:
            continue
        rotation, value = (compare >> 8) & 0xF, compare & 0xFF
        count = ((value >> (2 * rotation)) | (value << (32 - 2 * rotation))) & 0xFFFFFFFF if rotation else value
        slots.update(offset + 8 + 4 * index for index in range(min(count, 4096)))
    return slots


def find_thumb_jump_cases(code, base):
    """Les cases des aiguillages Thumb d'armcc qui n'appellent pas l'aide de switch : {cible: adresse du « add pc »}.
        cmp rI, #n ; bhs défaut        (au plus huit demi-mots avant : des « b » vers des cases peuvent s'intercaler)
        lsls rA, rI, #1 ; add rA, pc ; ldrh rA, [rA, #4] ; lsls rA, rA, #1 ; add pc, rA ; .hword × n
    La table suit le « add pc » ; la case k vise « add pc » + 4 + 2 × demi-mot k (nim 0x1055ae, ac 0x10341e). Sans le
    cmp qui donne n, rien : lire la table au jugé prendrait le code qui la suit pour des cases. Le processeur est un
    ARMv6K : pas de tbb ni de tbh. Seule autre forme vue, une fois (skater 0x1f7f70) : une table de mots lue par ldr."""
    cases = {}
    for offset in range(0, len(code) - 11, 2):
        h = struct.unpack_from('<5H', code, offset)
        if h[0] & 0xFFC0 != 0x0040:
            continue
        a, i = h[0] & 7, (h[0] >> 3) & 7
        if h[1:] != (0x4478 | a, 0x8880 | a << 3 | a, 0x0040 | a << 3 | a, 0x4487 | a << 3):
            continue
        count = next((p & 0xFF for p in (struct.unpack_from('<H', code, offset - 2 * k)[0]
                                         for k in range(1, 9) if offset >= 2 * k) if p >> 8 == 0x28 | i), 0)
        table = offset + 10
        if table + 2 * count > len(code):
            continue
        site = base + offset + 8
        for k in range(count):
            cases.setdefault(site + 4 + 2 * struct.unpack_from('<H', code, table + 2 * k)[0], site)
    return cases


class Image:
    """Les octets d'un fichier vus à leurs adresses. segments : [(adresse, décalage dans le fichier, taille dans le
    fichier, taille en mémoire, drapeaux ELF)], la forme que rendent elfer.segments_depuis_exheader et
    elfer.lire_segments. code_ranges : les plages [début, fin) où l'on cherche des fonctions ; par défaut, la partie
    lue du fichier de chaque segment exécutable (le .text d'un module)."""

    def __init__(self, data, segments, code_ranges=None):
        self.data = data
        self.segments = list(segments)
        if code_ranges is None:
            code_ranges = [(base, base + size) for base, _, size, _, flags in self.segments if flags & elfer.PF_X]
        self.code_ranges = sorted(code_ranges)

    def offset(self, address):
        """Le décalage dans le fichier d'une adresse, ou None si elle n'y est pas (.bss, mémoire d'exécution)."""
        for base, file_offset, file_size, _, _ in self.segments:
            if base <= address < base + file_size:
                return file_offset + address - base
        return None

    def read(self, address, size):
        offset = self.offset(address)
        if offset is None or offset + size > len(self.data):
            return None
        return self.data[offset:offset + size]

    def word(self, address):
        raw = self.read(address, 4)
        return None if raw is None else struct.unpack('<I', raw)[0]

    def half(self, address):
        raw = self.read(address, 2)
        return None if raw is None else struct.unpack('<H', raw)[0]

    def in_code(self, address):
        return any(start <= address < end for start, end in self.code_ranges)

    def loaded_ranges(self):
        """Les plages lues du fichier, segment par segment : là où l'on cherche des pointeurs."""
        return [(base, base + file_size) for base, _, file_size, _, _ in self.segments if file_size]


def find_candidates(code, segments):
    """Rend (graines sûres, candidats à juger) pour un module : find_pointers sur ses trois segments."""
    return find_pointers(Image(code, segments))


def find_pointers(image, sources=None, thumb_pointers=True, relative_tables=True):
    """Rend (graines sûres, candidats à juger). Une graine : (adresse, 'thumb'). Un candidat : (adresse, mode, origine,
    groupe), le groupe valant '-' pour un pointeur isolé et l'adresse de la table pour une case de table de distances.

    sources : les plages où l'on lit des mots qui pourraient être des pointeurs (par défaut tout ce qui est chargé du
    fichier) ; une cible doit tomber dans image.code_ranges. thumb_pointers=False ignore les mots impairs (un noyau
    tout en ARM : un mot impair n'y est jamais un pointeur de fonction). relative_tables=False ne cherche pas de
    tables de distances."""
    if sources is None:
        sources = image.loaded_ranges()

    # Un début de fonction ARM plausible, même garde-fou que prescan.py : une instruction sans condition (quartet du
    # haut à 0xE), et pas un « bl » (un pointeur vers un « bl » isolé vise la fin d'une fonction qui ne revient pas).
    def looks_like_arm_entry(address):
        word = image.word(address)
        return address % 4 == 0 and word is not None and word >> 28 == 0xE and word >> 24 != 0xEB

    jump_slots = set()
    for start, end in image.code_ranges:
        chunk = image.read(start, end - start) or b''
        jump_slots.update(start + offset for offset in find_arm_jump_slots(chunk, len(chunk)))
    seeds, candidates = {}, {}
    for start, end in sources:
        for address in range(start, end - 3, 4):
            if address in jump_slots:
                continue
            value = image.word(address)
            if value is None or not image.in_code(value):
                continue
            origin = 'pointeur à %#x' % address
            if value & 1:
                if not thumb_pointers:
                    continue
                target = value - 1
                if (image.half(target) or 0) & 0xFF00 == 0xB500:
                    seeds.setdefault(target, 'thumb')
                else:
                    candidates.setdefault(target, (target, 'thumb', origin, '-'))
            elif looks_like_arm_entry(value):
                candidates.setdefault(value, (value, 'arm', origin, '-'))

    # Les tables de distances. Dans le code le hasard est plus probable : on y exige une suite plus longue.
    relative = []
    for start, end in sources if relative_tables else []:
        run, minimum = [], RELATIVE_RUN_IN_TEXT if image.in_code(start) else RELATIVE_RUN_IN_DATA
        for address in list(range(start, end - 3, 4)) + [None]:
            target = None
            # Un mot nul « viserait » sa propre case : le bourrage de zéros n'est pas une table.
            if address is not None and address not in jump_slots and image.word(address):
                target = (image.word(address) + address) & 0xFFFFFFFF
            if target is not None and image.in_code(target) and (target & 1 or target % 4 == 0):
                run.append((address, target))
                continue
            if len(run) >= minimum and len({target for _, target in run}) >= minimum:
                relative.append(run)
            run = []
    # Une adresse peut être désignée à la fois par un pointeur et par une table de distances, peut-être fausse : les
    # deux lignes sont gardées, pour que le refus de la table n'emporte pas le pointeur.
    for address in seeds:
        candidates.pop(address, None)
    judged = sorted(candidates.values())
    for run in relative:
        group = 'table de distances à %#x' % run[0][0]
        judged += [(target & ~1, 'thumb' if target & 1 else 'arm', 'case %#x' % slot, group) for slot, target in run]
    return sorted(seeds.items()), judged


def write_lines(path, lines):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(''.join(line + '\n' for line in lines))


def read_functions(path):
    """gh/funcs.tsv -> [(adresse, taille, mode, nom)]."""
    functions = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            fields = line.rstrip('\n').split('\t')
            if len(fields) >= 4 and fields[0].startswith('0x'):
                functions.append((int(fields[0], 16), int(fields[1]), fields[2], fields[3]))
    return functions


def run_headless(out, program, image, language, pre_scripts, post_scripts, raw_base=None, maxmem=None,
                 stale=('pseudo', 'asm', 'funcs.tsv', 'refs.tsv', 'listing.txt')):
    """Lance analyzeHeadless sous Ubuntu sur `image` (chemin Windows), dans un projet neuf out/project, range tout ce
    que Ghidra écrit dans out/ghidra.log et rend ce journal.

    pre_scripts, post_scripts : [(script, argument, ...)], arguments déjà traduits en chemins d'Ubuntu, dans l'ordre
    où ils doivent tourner. raw_base : l'adresse de chargement d'une image brute (chargeur BinaryLoader) ; None pour un
    ELF. maxmem : le tas de Java (« 3G »), à donner quand plusieurs Ghidra tournent à la fois ; sinon 2 Go.

    wsl.exe ne passe pas ses arguments tels quels : il en refait une ligne qu'un shell relit. Chaque argument est donc
    protégé ici ; sans cela, le « ; » qui sépare deux dossiers de -scriptPath coupe la commande en deux, Ghidra
    importe, et aucun script ne tourne."""
    project = os.path.join(out, 'project')
    shutil.rmtree(project, ignore_errors=True)
    os.makedirs(project)
    # Ce qu'un passage précédent a écrit ne vaut plus rien : les fonctions ont pu changer.
    for name in stale:
        path = os.path.join(out, name)
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        elif os.path.isfile(path):
            os.remove(path)
    wsl = rea_bridge.to_wsl_path
    arguments = ([] if maxmem is None else ['env', 'GHIDRA_HEADLESS_MAXMEM=' + maxmem]) + [
        GHIDRA_HEADLESS, wsl(project), program, '-import', wsl(image), '-overwrite']
    if raw_base is not None:
        arguments += ['-loader', 'BinaryLoader', '-loader-baseAddr', '%#x' % raw_base]
    arguments += ['-processor', language, '-cspec', 'default', '-scriptPath', wsl(SCRIPTS)]
    for script, *script_args in pre_scripts:
        arguments += ['-preScript', script] + list(script_args)
    for script, *script_args in post_scripts:
        arguments += ['-postScript', script] + list(script_args)
    command = ['wsl.exe', '-d', 'Ubuntu', '--'] + [shlex.quote(argument) for argument in arguments]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = result.stdout.decode('utf-8', errors='replace')
    with open(os.path.join(out, 'ghidra.log'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(log)
    return log


def print_report(log, skip=()):
    """Les scripts écrivent leurs comptes sur des lignes marquées « >> » ; le reste du journal est dans ghidra.log.
    skip : les débuts de lignes « >> » à taire (une ligne par candidat écarté, quand il y en a des centaines)."""
    hidden = 0
    for line in log.splitlines():
        if '>> ' in line:
            text = line[line.index('>> ') + 3:].replace(' (GhidraScript)', '').rstrip()
            if text.startswith(tuple(skip)):
                hidden += 1
                continue
            print('  ' + text)
        elif 'ERROR' in line and 'REPORT' not in line or 'error:' in line:
            print('  [Ghidra] ' + line.strip()[:200])
    if hidden:
        print('  (%d ligne(s) de détail, candidats écartés et fonctions trouvées une à une : voir ghidra.log)' % hidden)


def analyse(module, use_names=True, plan_only=False):
    folder, code, segments = load_module(module)
    text_base, text_size = segments[0][0], segments[0][2]
    helpers = find_switch_helpers(code, text_base, text_size)
    switches = find_switch_sites(code, text_base, text_size, helpers)
    seeds, candidates = find_candidates(code, segments)
    # Une graine ou un candidat posé sur l'aide de switch en ferait une fonction ordinaire.
    seeds = [(address, mode) for address, mode in seeds if address not in helpers]
    candidates = [candidate for candidate in candidates if candidate[0] not in helpers]

    groups = {candidate[3] for candidate in candidates if candidate[3] != '-'}
    print('%s : .text de %d octets à %#x' % (module, text_size, text_base))
    print('Graines posées avant l\'analyse : %d pointeurs impairs vers un « push {..., lr} »' % len(seeds))
    print('Candidats jugés après l\'analyse : %d pointeurs impairs, %d pointeurs pairs, %d cases de %d table(s) de distances'
          % (sum(1 for c in candidates if c[3] == '-' and c[1] == 'thumb'),
             sum(1 for c in candidates if c[3] == '-' and c[1] == 'arm'),
             sum(1 for c in candidates if c[3] != '-'), len(groups)))
    print('Aide(s) de switch : %s ; %d table(s) de switch'
          % (', '.join('%#x (%s)' % item for item in sorted(helpers.items())) or 'aucune', len(switches)))
    if plan_only:
        return None
    out = os.path.join(ROOT, 'local', 'analyse', module, 'gh')
    os.makedirs(out, exist_ok=True)
    write_lines(os.path.join(out, 'seeds.tsv'),
                ['%#x\tthumb\t' % address for address, _ in seeds]
                + ['%#x\tarm\t%s' % (address, fixup) for address, fixup in sorted(helpers.items())])
    write_lines(os.path.join(out, 'candidates.tsv'), ['%#x\t%s\t%s\t%s' % candidate for candidate in candidates])
    write_lines(os.path.join(out, 'switches.tsv'),
                ['%#x\t%d\t%s' % (site, count, '\t'.join('%#x' % target for target in targets))
                 for site, count, targets in switches])

    names = os.path.join(ROOT, 'fiches', NAME_FILES.get(module, module) + '.noms.tsv')
    wsl = rea_bridge.to_wsl_path
    post_scripts = [('RecoverFunctions.java', wsl(os.path.join(out, 'switches.tsv')),
                     wsl(os.path.join(out, 'candidates.tsv')))]
    if use_names and os.path.isfile(names):
        post_scripts.append(('ApplyNames.java', wsl(names)))
    post_scripts.append(('DumpFunctions.java', wsl(out)))
    print('Ghidra tourne sous Ubuntu (une à trois minutes)...', flush=True)
    log = run_headless(out, module, os.path.join(folder, 'code.elf'), LANGUAGE,
                       [('SeedFunctions.java', wsl(os.path.join(out, 'seeds.tsv')))], post_scripts)
    print_report(log)
    listing = os.path.join(out, 'funcs.tsv')
    if not os.path.isfile(listing):
        sys.exit('Ghidra n\'a pas rendu de liste de fonctions : lire %s' % os.path.join(out, 'ghidra.log'))
    functions = read_functions(listing)
    entries = {address for address, _, _, _ in functions}
    thumb = sum(1 for _, _, mode, _ in functions if mode == 'thumb')
    print('%s : %d fonctions, dont %d en Thumb et %d en ARM' % (module, len(functions), thumb, len(functions) - thumb))
    print('-> %s' % out)
    return {'functions': functions, 'entries': entries}


def test():
    """Un faux module de quelques octets, fabriqué ici : l'aide de switch, un appel « blx » et sa table, des pointeurs
    vrais et faux, une table de distances. Ne lance pas Ghidra."""
    base = 0x100000
    text = bytearray(0x80)
    struct.pack_into('<II', text, 0x00, 0xE3A00000, 0xE12FFF1E)          # ARM : mov r0, #0 ; bx lr
    struct.pack_into('<HH', text, 0x10, 0xB510, 0xBD10)                  # Thumb : push {r4, lr} ; pop {r4, pc}
    struct.pack_into('<HH', text, 0x20, 0x2000, 0x4770)                  # Thumb sans push : movs r0, #0 ; bx lr
    text[0x40:0x58] = next(iter(SWITCH_HELPER_SIGNATURES))               # l'aide de switch
    struct.pack_into('<HHH', text, 0x60, 0xB500, 0xF7FF, 0xEFEE)         # push {lr} ; blx 0x100040
    text[0x66:0x6A] = bytes([2, 3, 4, 5])                                # 2 cas (octets 3 et 4), cas par défaut 5
    constants = bytearray(0x20)
    struct.pack_into('<III', constants, 0x00, base + 0x11, base + 0x21, base + 0x01)   # trois pointeurs impairs
    for index, target in enumerate((base + 0x11, base + 0x21, base)):                  # une table de trois distances
        struct.pack_into('<I', constants, 0x10 + 4 * index, (target - (0x101010 + 4 * index)) & 0xFFFFFFFF)
    code = bytes(text) + bytes(constants) + bytes(4)
    segments = [(base, 0, 0x80, 0x80, 5), (0x101000, 0x80, 0x20, 0x20, 4), (0x102000, 0xA0, 4, 4, 6)]
    helpers = find_switch_helpers(code, base, 0x80)
    assert helpers == {base + 0x40: 'switch8_r3'}
    assert find_switch_sites(code, base, 0x80, helpers) == [(base + 0x62, 2, [base + 0x6C, base + 0x6E, base + 0x70])]
    seeds, candidates = find_candidates(code, segments)
    assert seeds == [(base + 0x10, 'thumb')]                             # le pointeur vers un « push » est sûr
    alone = {address: mode for address, mode, _, group in candidates if group == '-'}
    assert alone == {base + 0x20: 'thumb', base: 'thumb'}                # les deux autres seront jugés par Ghidra
    table = [(address, mode) for address, mode, _, group in candidates if group != '-']
    assert table == [(base + 0x10, 'thumb'), (base + 0x20, 'thumb'), (base, 'arm')]
    print('ghidra_direct : aide de switch reconnue à son code, table de switch décodée, graines, candidats et table '
          'de distances triés.')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    use_names = '--no-names' not in args
    plan_only = '--plan' in args
    args = [a for a in args if not a.startswith('--')]
    if len(args) != 1:
        print(__doc__)
    elif args[0] == 'test':
        test()
    else:
        analyse(args[0], use_names, plan_only)
