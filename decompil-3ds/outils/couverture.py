"""Le compteur de la décompilation à 100 %, et la propagation des noms d'un binaire à l'autre par empreinte.

    python couverture.py mesure [--no-write]                       le tableau par binaire ; les totaux vont dans etat.json
    python couverture.py run   [--min N] [--min-moyenne N] [--out DOSSIER]   propositions de noms, ne touche à aucune fiche
    python couverture.py apply [mêmes options]                     idem, puis verse les noms de confiance haute dans les fiches
    python couverture.py test

Ce qu'il lit (rien ne sort de local/ ni n'est versionné, sauf les noms versés par « apply » et les totaux d'etat.json) :
    local/analyse/<binaire>/gh/funcs.tsv   la liste des fonctions de ghidra_direct.py (modules, « maj » pour le jeu) ou de
                                           ghidra_raw.py (boot9, boot11, kernel11, kernel9, process9, arm9loader)
    local/extrait/<module>/exefs/          les octets d'un module (comme ghidra_direct.load_module) ; ceux d'une cible
                                           brute d'après raw_targets.toml (comme ghidra_raw.load_image)
    local/recomp/jeu/table.c, cro_table.c  les fonctions traduites en C par recomp/ ; cro_table.c est aussi la liste des
                                           fonctions des 133 .cro, que Ghidra n'analyse pas (recomp/cro_recomp.py)
    local/extrait/maj/romfs/*.cro          les octets des modules du jeu, relogés comme le fait cro_recomp.ModuleImage
    fiches/<fiche>.noms.tsv, fiches/cro/<Module>.noms.tsv, fiches/<fiche>*.md
    local/analyse/names/proposals.tsv, local/analyse/names-croises/proposals.tsv   d'où viennent les noms déjà versés

1. Le compteur (« mesure »). Pour chaque binaire, des niveaux du plus faible au plus fort :
    trouvees        les fonctions que l'analyse connaît (funcs.tsv ; cro_table.c pour les .cro). Ce n'est pas le vrai
                    total : une fonction que rien ne désigne reste invisible (voir ghidra_direct.py)
    nommees         les débuts de fonction qui ont un nom dans la fiche de noms du binaire, répartis par origine quand une
                    passe l'a écrit : la source de name_pass.py (rtti, svc, stdlib...) ou d'ici (empreinte, appel) ;
                    « fiche » pour le reste, noms posés à la main ou par prescan.py
    typees          un prototype (paramètres, retour) écrit dans un fichier versionné. Aucun format encore : 0 partout
    citees          l'adresse du début citée dans la fiche du binaire (fiches/<fiche>.md, <fiche>-*.md, ou une fiche
                    commune comme boot9-boot11.md). C'est une approximation de « lue » : une citation ne prouve pas que
                    toute la fonction a été relue
    recompilees     traduite en C par recomp/ (table.c pour code.bin ; toutes celles de cro_table.c pour les .cro).
                    0 pour les modules système, que recomp/ ne traduit pas
    reimplementees  réécrite à la main et prouvée équivalente (banc ou natif contre unicorn) : pas de liste encore, 0
   Les 133 .cro sont comptés ensemble sur une ligne. Les fiches de noms sans analyse (module pas encore repassé dans
   Ghidra) sont listées à part : leurs noms ne comptent pas dans les totaux, faute de liste de fonctions.
   Les totaux vont dans etat.json « fonctions » (identifiees, nommees, citees, recompilees, typees, reimplementees, et
   « binaires », le détail que montre la page), par verifier.ecrire.

2. La propagation (« run »). Les bibliothèques du SDK (nn::os, nn::fs, nn::srv, les enrobages d'appels système, la libc,
   l'exécution d'armcc __aeabi_*) sont liées statiquement dans chaque module et dans le jeu : la même fonction existe à
   des adresses différentes dans des dizaines de binaires. On calcule pour chaque fonction une empreinte qui ne dépend
   pas de l'adresse : la suite de ses instructions, mode compris (ARM ou Thumb), où l'on masque ce qui dépend de la
   place du code :
    - les déplacements des branchements : B, BL, BLX en ARM ; B, B<cond>, la paire BL/BLX en Thumb. On garde
      l'opcode et la condition, donc « bl » et « blx » restent distincts ;
    - le déplacement d'une lecture de littéral (ldr, ldrb, ldrh, ldrd, vldr relatifs à pc) : il dépend de la place de
      la réserve, que l'éditeur de liens peut décaler. À la place, la VALEUR du littéral entre dans l'empreinte, sauf si
      c'est une adresse dans l'image du binaire lui-même (ou un mot que ro écrit dans un .cro) : elle devient alors
      « adresse », sans valeur, sauf si elle vise une chaîne de l'image : la chaîne entre alors dans l'empreinte (une
      fonction qui ouvre « cfg:s » n'est pas celle qui ouvre « cfg:u »). Ainsi une constante (0xD900182F, un en-tête de
      commande IPC) distingue deux fonctions, un pointeur vers une variable globale ne les distingue pas. Les mots de la
      réserve ne comptent pas comme instructions ;
    - l'immédiat de ADR (add/sub rX, pc, #imm en ARM, add rX, pc, #imm en Thumb) ;
    - les cases des tables de saut ARM (« ldrcc pc, [pc, rX, lsl #2] », repérées par ghidra_direct.find_arm_jump_slots) :
      des adresses, classées comme les littéraux ; la table d'octets qui suit un appel à l'aide de switch Thumb
      (reconnue à son code, ghidra_direct.SWITCH_HELPER_SIGNATURES) entre telle quelle : ce sont des distances.
   Ce qui n'est PAS masqué : tout le reste de chaque instruction (registres, immédiats, conditions), et les valeurs des
   littéraux qui ne sont pas des adresses de l'image. Le bourrage final (mots ou demi-mots nuls) est retiré.
   L'étendue d'une fonction est la taille de Ghidra (octets d'instructions) ; pour un .cro, faute de taille, jusqu'à la
   fonction suivante.

   Masquer les cibles des appels confondrait deux enrobages qui ne diffèrent que par la fonction appelée (dans act,
   le même code appelle svcCloseHandle là où celui de fs appelle lock_leave). La grappe se fait donc sur l'empreinte
   de la fonction suivie de celle de chacune de ses appelées, dans l'ordre (un niveau : l'appelée de l'appelée n'est
   pas regardée). Si les copies nommées d'une grappe portent toutes le même nom (au préfixe « <Module>_ » des .cro
   près), ce nom est proposé pour les copies sans nom :
    haute    au moins --min instructions (8 par défaut) : va dans les fiches avec « apply »
    moyenne  de --min-moyenne (4) à --min ; ou un nom qui commence par le nom du binaire d'origine (« fs_... ») et qui
             décrit peut-être le rôle de la fonction dans ce module plutôt que la fonction elle-même
    basse    une fonction qui envoie une commande IPC (lecture du tampon de commande « mrc p15, 0, rX, c13, c0, 3 » ou
             « svc 0x32 », dans son code ou dans une appelée de quatre instructions au plus). Le service visé est le
             handle lu dans une variable globale, que l'empreinte masque : la commande 8 à un paramètre d'octet de mic
             (mic_SetGain dans le jeu) a exactement le code d'une commande 8 d'un autre service dans errdisp
    rien     moins de --min-moyenne instructions : « bx lr » ou « mov r0, #0 ; bx lr » existent partout sous dix noms
   Une grappe dont les copies nommées ne s'accordent pas ne propose rien (conflicts.tsv). Les appelées : dans une
   grappe d'au moins --min instructions, l'appelée au rang k de chaque copie a le même code ; si les appelées
   nommées s'accordent, le nom est proposé aux autres en confiance moyenne. C'est ce qui nomme les petites
   fonctions (« svc 0x23 ; bx lr ») que la règle des --min-moyenne instructions écarte seules : leur contexte d'appel
   est alors celui d'une grande fonction identique.

   Les collisions suivent la règle de name_pass.py (dont reconcile est repris tel quel) : dans un binaire, une adresse
   n'a qu'un nom et un nom qu'une adresse. Le jeu (code.bin et ses 133 .cro) forme un seul espace de noms, comme pour
   name_pass.py ; chaque module système a le sien (le même enrobage peut s'appeler svcSendSyncRequest partout).

   Il écrit dans local/analyse/names-croises/ :
    proposals.tsv   binaire, adresse (dans l'espace de la fiche : position dans le fichier pour un .cro), nom, source
                    (« empreinte:<binaire d'origine> » ou « appel:<binaire d'origine> »), confiance, preuve
    collisions.tsv  ce qui a été écarté et pourquoi
    conflicts.tsv   les grappes dont les copies nommées ne s'accordent pas
    report.txt      le compte : grappes, propositions par confiance et par binaire

Ce qu'il ne fait pas. Il ne compare pas deux fonctions « presque » égales (une constante de ligne d'ERRF_Throw qui
change suffit à les séparer : c'est voulu, la fonction n'est alors pas tout à fait la même). Il ne reconnaît pas une
fonction que deux compilateurs ou deux versions du SDK ont produite autrement. Une fonction coupée autrement par Ghidra
dans deux binaires (un bout de code partagé, une fin manquée) n'y trouve pas sa jumelle.
"""
import collections
import hashlib
import os
import re
import struct
import sys
import types

import elfer
import ghidra_direct
import ghidra_raw
import name_pass
import verifier

ROOT = ghidra_direct.ROOT
ANALYSE = os.path.join(ROOT, 'local', 'analyse')
FICHES = name_pass.FICHES
CRO_FICHES = name_pass.CRO_FICHES
RECOMP_OUT = os.path.join(ROOT, 'local', 'recomp', 'jeu')
OUT = os.path.join(ANALYSE, 'names-croises')
NAME_PASS_PROPOSALS = os.path.join(name_pass.OUT, 'proposals.tsv')
MIN_HIGH = 8
MIN_LOW = 4
GAME = 'jeu'                            # l'espace de noms de code.bin (« maj ») et des .cro
# Des noms qui disent une adresse ou un défaut d'outil, pas une fonction : on ne les recopie pas ailleurs.
GENERIC_NAME = re.compile(r'^(?:FUN|LAB|SUB|sub|thunk|DAT|switchD|caseD|nullsub)_|_alt_|0x[0-9a-fA-F]+|_[0-9a-fA-F]{6,8}$')
PADDING = {0, 0x46C0, 0xE1A00000}       # demi-mot nul, « mov r8, r8 » Thumb, « mov r0, r0 » ARM


# --- Les binaires ---

class Binary:
    """Un binaire analysé : ses fonctions [(adresse, taille ou None, mode)] dans l'espace de son image, sa fiche de noms.
    base : ce qu'il faut ôter à une adresse de l'image pour avoir celle de la fiche (l'adresse factice d'un .cro, dont
    la fiche donne des positions dans le fichier). prefix : « <Module>_ » pour un .cro. relocated : les mots que ro écrit."""

    def __init__(self, name, functions, names_path, image=None, group=None, prefix='', base=0, relocated=()):
        self.name = name
        self.functions = sorted(functions)
        self.names_path = names_path
        self.names = {a: v for a, v in name_pass.read_names(names_path).items() if v[1]}
        self.image = image
        self.group = group or name
        self.prefix = prefix
        self.base = base
        self.relocated = set(relocated)
        self.starts = {a for a, _, _ in self.functions}
        self.spans = [(b, b + max(fs, ms)) for b, _, fs, ms, _ in image.segments] if image else []
        self.jump_slots = set()
        self.switch_helpers = {}
        for start, end in image.code_ranges if image else []:
            chunk = image.read(start, end - start) or b''
            self.jump_slots.update(start + o for o in ghidra_direct.find_arm_jump_slots(chunk, len(chunk)))

    def name_at(self, address):
        """Le nom de la fiche sans le préfixe du module, ou None."""
        entry = self.names.get(address - self.base)
        if entry is None:
            return None
        name = entry[1]
        return name[len(self.prefix):] if self.prefix and name.startswith(self.prefix) else name

    def in_image(self, value):
        return any(low <= value < high for low, high in self.spans)

    def is_switch_helper(self, address):
        if address not in self.switch_helpers:
            self.switch_helpers[address] = (self.image.read(address, 24) or b'') in ghidra_direct.SWITCH_HELPER_SIGNATURES
        return self.switch_helpers[address]


def fiche_stem(names_path):
    return os.path.basename(names_path)[:-len('.noms.tsv')]


def load_system(name, with_image):
    """Un binaire de local/analyse/<nom>/gh : module (ghidra_direct) ou cible brute (ghidra_raw)."""
    functions = [(a, s, m) for a, s, m, _ in ghidra_direct.read_functions(os.path.join(ANALYSE, name, 'gh', 'funcs.tsv'))]
    targets = ghidra_raw.load_targets()
    image = None
    if name in targets:
        target = targets[name]
        names_path = target['names'] or os.path.join(FICHES, name + '.noms.tsv')
        if with_image and os.path.isfile(target['input']):
            image = ghidra_raw.load_image(target)[0]
    else:
        names_path = os.path.join(FICHES, ghidra_direct.NAME_FILES.get(name, name) + '.noms.tsv')
        folder = os.path.join(ROOT, 'local', 'extrait', name, 'exefs')
        if with_image and all(os.path.isfile(os.path.join(folder, f)) for f in ('code.bin', 'exheader.bin')):
            _, code, segments = ghidra_direct.load_module(name)
            image = ghidra_direct.Image(code, segments)
    return Binary(name, functions, names_path, image, group=GAME if name == 'maj' else name)


def read_cro_table(path=os.path.join(RECOMP_OUT, 'cro_table.c')):
    """{module: [(position, mode)]} d'après la table que cro_recomp.py écrit."""
    if not os.path.isfile(path):
        return {}
    text = open(path, encoding='utf-8').read()
    entries = {}
    for match in re.finditer(r'static const RtEntry t_(\d+)\[\] = \{(.*?)\n\};', text, re.S):
        keys = [int(k, 16) for k in re.findall(r'\{ 0x([0-9a-f]+)u, f_', match.group(2))]
        entries[int(match.group(1))] = [(k & ~1, 'thumb' if k & 1 else 'arm') for k in keys]
    return {name: entries.get(int(index), []) for name, index in re.findall(r'\{ "([^"]+)", t_(\d+),', text)}


def load_cros(with_image):
    """Les 133 .cro, avec leurs octets relogés à l'adresse factice de cro_recomp si le romfs est là."""
    table = read_cro_table()
    images = {}
    if with_image and table:
        sys.path.insert(0, os.path.join(ROOT, 'recomp'))
        import cro_recomp
        if os.path.isdir(cro_recomp.cl.DEFAULT_ROMFS):
            for index, cro in enumerate(cro_recomp.load_cros()):
                images[cro.name] = cro_recomp.ModuleImage(cro, index)
    out = []
    for module, entries in sorted(table.items()):
        names_path = os.path.join(CRO_FICHES, module + '.noms.tsv')
        img = images.get(module)
        if img is None:
            out.append(Binary(module, [(p, None, m) for p, m in entries], names_path, group=GAME, prefix=module + '_'))
            continue
        data = bytes(img.module.image)
        image = ghidra_direct.Image(data, [(img.fake, 0, len(data), len(data), elfer.PF_R | elfer.PF_X)], [(img.lo, img.hi)])
        out.append(Binary(module, [(img.fake + p, None, m) for p, m in entries], names_path, image, group=GAME,
                          prefix=module + '_', base=img.fake, relocated=[img.lo + o for o in img.mask_offsets()]))
    return out


def load_all(with_image=True):
    names = sorted(n for n in os.listdir(ANALYSE) if os.path.isfile(os.path.join(ANALYSE, n, 'gh', 'funcs.tsv'))) \
        if os.path.isdir(ANALYSE) else []
    binaries = []
    for name in names:
        print('lecture de %s...' % name, flush=True)
        binaries.append(load_system(name, with_image))
    binaries += load_cros(with_image)
    return binaries


# --- L'empreinte ---

def sext(value, bits):
    return value - (1 << bits) if value & (1 << (bits - 1)) else value


STRING = re.compile(rb'[\x20-\x7e]{3,}\x00')


def literal_token(binary, address, words=1):
    """La valeur des mots d'un littéral, ou « P » pour une adresse dans l'image (ou un mot que ro écrit). Une adresse
    qui vise une chaîne de l'image donne la chaîne : « cfg:s » et « cfg:u » ne se confondent pas."""
    out = []
    for k in range(words):
        value = binary.image.word(address + 4 * k)
        if value is None:
            out.append('?')
        elif address + 4 * k in binary.relocated or binary.in_image(value):
            text = STRING.match(binary.image.read(value, 64) or b'') if binary.image.offset(value) is not None else None
            out.append(('S', text.group()) if text else 'P')
        else:
            out.append(value)
    return tuple(out)


def is_ipc(token):
    """mrc p15, 0, rX, c13, c0, 3 (le tampon de commande du fil) ou svc 0x32 (SendSyncRequest), ARM ou Thumb."""
    return isinstance(token, int) and (token & 0x0FFF0FFF == 0x0E1D0F70 or token & 0x0FFFFFFF == 0x0F000032
                                       or token == 0xDF32)


def arm_token(binary, pos, w, literals, calls, window):
    """Le mot ARM masqué. Note dans `literals` les mots de réserve lus dans la fonction, dans `calls` les appelées."""
    def literal(address, words):
        if window[0] <= address < window[1]:
            literals.update(address + 4 * k for k in range(words))
        return literal_token(binary, address, words)

    cond, rn = w >> 28, (w >> 16) & 0xF
    if w & 0x0E000000 == 0x0A000000:                                   # b, bl, blx
        offset = sext(w & 0xFFFFFF, 24) << 2
        if cond == 0xF:
            calls.append((pos + 8 + offset + ((w >> 23) & 2)) | 1)
            return w & 0xFE000000
        if w & 0x01000000:
            calls.append(pos + 8 + offset)
        return w & 0xFF000000
    if cond == 0xF or rn != 15:
        return w
    if w & 0x0E100000 == 0x04100000:                                   # ldr, ldrb [pc, #imm]
        imm = w & 0xFFF
        return ('L', w & 0xFF7FF000) + literal((pos + 8 + (imm if w & 0x00800000 else -imm)) & ~3, 1)
    if w & 0x0E400090 == 0x00400090 and w & 0x60:                      # ldrh, ldrsh, ldrsb, ldrd [pc, #imm]
        imm = (w >> 4) & 0xF0 | w & 0xF
        double = not w & 0x00100000 and w & 0x60 == 0x40
        return ('L', w & 0xFF7FF0F0) + literal((pos + 8 + (imm if w & 0x00800000 else -imm)) & ~3, 2 if double else 1)
    if w & 0x0F300E00 == 0x0D100A00:                                   # vldr [pc, #imm]
        imm = (w & 0xFF) << 2
        return ('L', w & 0xFF7FFF00) + literal(((pos + 8) & ~3) + (imm if w & 0x00800000 else -imm), 2 if w & 0x100 else 1)
    if w & 0x0FEF0000 in (0x028F0000, 0x024F0000):                     # adr : add/sub rX, pc, #imm
        return ('A', w & 0xF000F000)
    return w


def thumb_token(binary, pos, code, at, literals, calls, window):
    """(demi-mot Thumb masqué, octets lus, octets d'instruction comptés)."""
    h = struct.unpack_from('<H', code, at)[0]
    if h >> 11 == 0x1E and at + 4 <= len(code):
        h2 = struct.unpack_from('<H', code, at + 2)[0]
        if h2 >> 11 in (0x1F, 0x1D):                                    # bl, blx
            offset = sext(h & 0x7FF, 11) << 12 | (h2 & 0x7FF) << 1
            if h2 >> 11 == 0x1F:
                calls.append((pos + 4 + offset) | 1)
                return ('BL', h2 & 0xF800), 4, 4
            target = (pos + 4 + offset) & ~3
            calls.append(target)
            if binary.is_switch_helper(target) and at + 4 < len(code):
                table = code[at + 4:at + 4 + code[at + 4] + 2]
                return ('BL', h2 & 0xF800, bytes(table)), 4 + (len(table) + 1 & ~1), 4
            return ('BL', h2 & 0xF800), 4, 4
    if h >> 12 == 0xD and (h >> 8) & 0xF < 0xE or h >> 11 == 0x14:     # b<cond>, adr
        return h & 0xFF00, 2, 2
    if h >> 11 == 0x1C:                                                 # b
        return 0xE000, 2, 2
    if h >> 11 == 0x09:                                                 # ldr rX, [pc, #imm]
        address = ((pos + 4) & ~3) + ((h & 0xFF) << 2)
        if window[0] <= address < window[1]:
            literals.add(address)
        return ('L', h & 0xFF00) + literal_token(binary, address), 2, 2
    return h, 2, 2


def fingerprint(binary, start, mode, size, limit):
    """(empreinte, nombre d'instructions, appelées dans l'ordre, envoi IPC dans son code) d'une fonction. size :
    octets d'instructions selon Ghidra, ou None (jusqu'à `limit`, le début de la fonction suivante ou la fin du code)."""
    code = binary.image.read(start, limit - start) or b''
    tokens, calls, literals = [], [], set()
    window = (start, start + len(code))
    at = used = 0
    thumb = mode == 'thumb'
    while at + (2 if thumb else 4) <= len(code) and (size is None or used < size):
        pos = start + at
        if pos in literals:
            at += 4
            continue
        if thumb:
            token, step, counted = thumb_token(binary, pos, code, at, literals, calls, window)
        elif pos in binary.jump_slots:
            token, step, counted = ('J',) + literal_token(binary, pos), 4, 0
        else:
            token, step, counted = arm_token(binary, pos, struct.unpack_from('<I', code, at)[0], literals, calls, window), 4, 4
        tokens.append(token)
        at += step
        used += counted
    while tokens and tokens[-1] in PADDING:
        tokens.pop()
    count = sum(1 for t in tokens if not (isinstance(t, tuple) and t[0] == 'J'))
    digest = hashlib.blake2b(repr((mode, tokens)).encode(), digest_size=12).hexdigest()
    return digest, count, calls, any(is_ipc(t) for t in tokens)


def fingerprints(binary):
    """{adresse: (empreinte, instructions, appelées, envoi IPC)} pour toutes les fonctions d'un binaire qui a ses octets."""
    out = {}
    starts = sorted(binary.starts)
    following = dict(zip(starts, starts[1:]))
    for address, size, mode in binary.functions:
        end = next((high for low, high in binary.image.code_ranges if low <= address < high), None)
        if end is None:
            continue
        out[address] = fingerprint(binary, address, mode, size, min(end, following.get(address, end)))
    return out


# --- Les grappes et les propositions ---

def usable(name):
    return name is not None and not GENERIC_NAME.search(name)


def make_proposal(binary, address, name, source, confidence, proof, mode):
    p = name_pass.Proposal(address - binary.base, binary.prefix + name, source, confidence, proof,
                           module=binary.name if binary.prefix else '', thumb=mode == 'thumb')
    p.binary = binary
    return p


def propose(binaries, prints, min_high=MIN_HIGH, min_low=MIN_LOW):
    """Rend (propositions, conflits [(empreinte, instructions, [(binaire, adresse, nom)])], compte)."""
    modes = {(b.name, a): m for b in binaries for a, _, m in b.functions}
    clusters = collections.defaultdict(list)
    for b in binaries:
        own = prints.get(b.name, {})
        for address, (digest, _, calls, _) in own.items():
            # La clé de grappe ajoute l'empreinte de chaque appelée, dans l'ordre : deux enrobages qui ne diffèrent que
            # par la fonction appelée (svcCloseHandle ou lock_leave) ne se confondent pas.
            callees = tuple(own[t & ~1][0] if t & ~1 in own else '?' for t in calls)
            key = digest if not callees else hashlib.blake2b(repr((digest, callees)).encode(), digest_size=12).hexdigest()
            clusters[key].append((b, address))
    proposals, conflicts, stats, seen = [], [], collections.Counter(), set()

    def sends_ipc(b, a):
        """Un envoi IPC dans la fonction ou dans une appelée de quatre instructions au plus (lecture du tampon de
        commande, enrobage de SendSyncRequest) : le service visé dépend d'un handle global, masqué dans l'empreinte."""
        own = prints[b.name]
        return own[a][3] or any(t & ~1 in own and own[t & ~1][3] and own[t & ~1][1] <= 4 for t in own[a][2])

    def add(binary, address, name, source, confidence, proof):
        key = (binary.name, address, name)
        if key not in seen:
            seen.add(key)
            proposals.append(make_proposal(binary, address, name, source, confidence, proof, modes[(binary.name, address)]))

    for digest, members in clusters.items():
        if len(members) < 2:
            continue
        stats['grappes'] += 1
        if len({b.name for b, _ in members}) > 1:
            stats['grappes sur plusieurs binaires'] += 1
        count = prints[members[0][0].name][members[0][1]][1]
        named = [(b, a, b.name_at(a)) for b, a in members if b.name_at(a) is not None]
        unnamed = [(b, a) for b, a in members if b.name_at(a) is None]
        good = [(b, a, n) for b, a, n in named if usable(n)]
        if good and unnamed:
            names = sorted({n for _, _, n in good})
            if len(names) > 1:
                conflicts.append((digest, count, named))
                stats['grappes en désaccord'] += 1
            elif count < min_low:
                stats['grappes trop petites (copies sans nom)'] += len(unnamed)
            else:
                name = names[0]
                origins = sorted({b.name for b, _, _ in good})
                witnesses = ', '.join('%s@%#x' % (b.name, a - b.base) for b, a, _ in good[:3])
                ipc = sends_ipc(*members[0])
                for b, a in unnamed:
                    local = any(name.startswith(o + '_') for o in origins if o != b.name)
                    confidence = 'basse' if ipc else 'haute' if count >= min_high and not local else 'moyenne'
                    add(b, a, name, 'empreinte:' + origins[0], confidence,
                        'empreinte %s identique (%d instructions, %s) à %s « %s » ; grappe de %d copies dans %d binaires%s%s'
                        % (digest, count, modes[(b.name, a)], witnesses, name, len(members),
                           len({m.name for m, _ in members}), ' ; nom propre au binaire d\'origine' if local else '',
                           ' ; envoi IPC : le service dépend d\'un handle masqué' if ipc else ''))
        if count < min_high:
            continue
        # Un niveau plus loin : les appelées au même rang dans des copies identiques.
        calls = [(b, a, prints[b.name][a][2]) for b, a in members]
        for rank in range(len(calls[0][2])):
            callees = []
            for b, a, targets in calls:
                target = targets[rank] & ~1
                if target in b.starts:
                    callees.append((b, a, target))
            known = [(b, a, t, b.name_at(t)) for b, a, t in callees if usable(b.name_at(t))]
            names = {n for _, _, _, n in known}
            if len(names) != 1:
                continue
            name = names.pop()
            origins = sorted({b.name for b, _, _, _ in known})
            witness = known[0]
            for b, a, t in callees:
                if b.name_at(t) is None:
                    add(b, t, name, 'appel:' + origins[0], 'moyenne',
                        'appelée au rang %d par %s@%#x, dont l\'empreinte %s (%d instructions) est celle de %s@%#x, qui '
                        'appelle à ce rang %s@%#x « %s »' % (rank, b.name, a - b.base, digest, count, witness[0].name,
                                                             witness[1] - witness[0].base, witness[0].name,
                                                             witness[2] - witness[0].base, name))
    stats['propositions brutes'] = len(proposals)
    return proposals, conflicts, stats


def reconcile_all(binaries, proposals):
    """name_pass.reconcile par espace de noms : le jeu (code.bin et ses .cro) ensemble, chaque autre binaire seul."""
    kept, dropped = [], []
    groups = collections.defaultdict(list)
    for p in proposals:
        groups[p.binary.group].append(p)
    for group, items in groups.items():
        members = [b for b in binaries if b.group == group]
        holder = types.SimpleNamespace(names={})
        for b in members:
            if not b.prefix:
                holder.names.update(b.names)
        modules = {b.name: b.names for b in members if b.prefix}
        k, d = name_pass.reconcile(holder, items, modules)
        kept += k
        dropped += d
    kept.sort(key=lambda p: (p.binary.name, p.address))
    return kept, dropped


def run(min_high=MIN_HIGH, min_low=MIN_LOW, out_dir=OUT):
    binaries = load_all()
    prints = {}
    for b in binaries:
        if b.image is not None:
            prints[b.name] = fingerprints(b)
    print('%d binaires, %d avec leurs octets, %d fonctions empreintes' % (
        len(binaries), len(prints), sum(len(v) for v in prints.values())), flush=True)
    proposals, conflicts, stats = propose(binaries, prints, min_high, min_low)
    kept, dropped = reconcile_all(binaries, proposals)
    os.makedirs(out_dir, exist_ok=True)
    name_pass.write_tsv(os.path.join(out_dir, 'proposals.tsv'),
                        [('binaire', 'adresse', 'nom', 'source', 'confiance', 'preuve')] +
                        [(p.binary.name, '%#x' % p.address, p.name, p.source, p.confidence, p.proof) for p in kept])
    name_pass.write_tsv(os.path.join(out_dir, 'collisions.tsv'),
                        [('binaire', 'adresse', 'nom proposé', 'source', 'raison')] +
                        [(p.binary.name, '%#x' % p.address, p.name, p.source, why) for p, why in dropped])
    name_pass.write_tsv(os.path.join(out_dir, 'conflicts.tsv'),
                        [('empreinte', 'instructions', 'copies nommées')] +
                        [(d, str(n), ' ; '.join('%s@%#x %s' % (b.name, a - b.base, nm) for b, a, nm in named))
                         for d, n, named in sorted(conflicts, key=lambda c: -c[1])])
    lines = ['Propagation par empreinte : %d binaires lus, %d avec leurs octets (%s)' % (
        len(binaries), len(prints), ', '.join(sorted(n for n in prints if n in {b.name for b in binaries if not b.prefix}))
        + (' et %d .cro' % sum(1 for b in binaries if b.prefix and b.name in prints))), '']
    lines += ['   %-45s %7d' % (k, v) for k, v in sorted(stats.items())]
    lines += ['', 'Retenues (sans collision), par confiance et par source :']
    table = collections.Counter((p.confidence, p.source.split(':')[0]) for p in kept)
    lines += ['   %-8s %-10s %6d' % (c, s, n) for (c, s), n in sorted(table.items())]
    lines += ['', 'Retenues par binaire visé (haute / toutes) :']
    per = collections.Counter(p.binary.group if p.binary.prefix else p.binary.name for p in kept)
    high = collections.Counter(p.binary.group if p.binary.prefix else p.binary.name for p in kept if p.confidence == 'haute')
    lines += ['   %-20s %6d / %d' % (k, high[k], v) for k, v in sorted(per.items())]
    lines += ['', 'Écartées : %d (voir collisions.tsv)' % len(dropped)]
    reasons = collections.Counter(re.sub(r'«.*?»|\S*0x[0-9a-f]+', '…', why) for _, why in dropped)
    lines += ['   %-60s %5d' % (k, v) for k, v in reasons.most_common()]
    text = '\n'.join(lines) + '\n'
    with open(os.path.join(out_dir, 'report.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print(text)
    print('-> %s' % out_dir)
    return kept


def apply(kept):
    """Verse les noms de confiance haute dans la fiche de noms de chaque binaire (name_pass.merge_lines). Un binaire
    sans fiche de noms (une variante « -safe ») n'en reçoit pas une : ses noms restent dans proposals.tsv."""
    by_path = collections.defaultdict(list)
    for p in kept:
        if p.confidence == 'haute':
            by_path[p.binary.names_path].append((p.address, 'label' if p.thumb else 'function', p.name))
    for path, items in sorted(by_path.items()):
        if not os.path.isfile(path):
            print('   %-50s pas de fiche de noms : %d noms laissés en proposition' % (os.path.relpath(path, ROOT), len(items)))
            del by_path[path]
            continue
        name_pass.merge_lines(path, items, name_pass.is_sorted(path))
        print('   %-50s +%d' % (os.path.relpath(path, ROOT), len(items)))
    print('versé : %d noms dans %d fichiers' % (sum(len(v) for v in by_path.values()), len(by_path)))


# --- Le compteur ---

def read_sources():
    """{(binaire, adresse de fiche, nom): source} d'après les propositions de name_pass.py et d'ici."""
    out = {}
    if os.path.isfile(NAME_PASS_PROPOSALS):
        for line in list(open(NAME_PASS_PROPOSALS, encoding='utf-8'))[1:]:
            label, name, source = line.rstrip('\n').split('\t')[:3]
            module, _, address = label.rpartition('+')
            out[(module or 'maj', int(address, 16), name)] = source.split('-')[0]
    path = os.path.join(OUT, 'proposals.tsv')
    if os.path.isfile(path):
        for line in list(open(path, encoding='utf-8'))[1:]:
            binary, address, name, source = line.rstrip('\n').split('\t')[:4]
            out[(binary, int(address, 16), name)] = source.split(':')[0]
    return out


def cited_addresses(stem):
    """Les adresses citées dans les fiches .md du binaire : <fiche>.md, <fiche>-*.md, ou une fiche commune (boot9-boot11)."""
    found = set()
    for name in os.listdir(FICHES) if os.path.isdir(FICHES) else []:
        if name.endswith('.md') and (name[:-3] == stem or name.startswith(stem + '-') or stem in name[:-3].split('-')):
            text = open(os.path.join(FICHES, name), encoding='utf-8').read()
            found.update(int(h, 16) for h in re.findall(r'0x([0-9a-fA-F]{1,8})\b', text))
    return found


def read_recompiled(path=os.path.join(RECOMP_OUT, 'table.c')):
    if not os.path.isfile(path):
        return set()
    return {int(h, 16) & ~1 for h in re.findall(r'\{ 0x([0-9a-f]{8})u, f_', open(path, encoding='utf-8').read())}


def measure_binary(binary, sources, cited, recompiled):
    """Une ligne du compteur. Les adresses sont celles de la fiche."""
    starts = {a - binary.base for a in binary.starts}
    named = {a for a in starts if a in binary.names}
    origin = collections.Counter(sources.get((binary.name, a, binary.names[a][1]), 'fiche') for a in named)
    return {'nom': binary.name, 'trouvees': len(starts), 'nommees': len(named), 'typees': 0,
            'citees': len(starts & cited), 'recompilees': len(starts & recompiled), 'reimplementees': 0,
            'origines': dict(sorted(origin.items()))}


LEVELS = ('trouvees', 'nommees', 'typees', 'citees', 'recompilees', 'reimplementees')


def measure(binaries):
    """Rend (lignes par binaire, lignes des fiches sans analyse). Les .cro sont réunis sur une ligne."""
    sources = read_sources()
    recompiled = read_recompiled()
    rows, cro = [], None
    for b in binaries:
        if b.prefix:
            row = measure_binary(b, sources, set(), {a - b.base for a in b.starts})
            if cro is None:
                cro = {'nom': '.cro (0 modules)', 'modules': 0, 'origines': collections.Counter()}
                cro.update({k: 0 for k in LEVELS})
            cro['modules'] += 1
            cro['nom'] = '.cro (%d modules)' % cro['modules']
            for k in LEVELS:
                cro[k] += row[k]
            cro['origines'].update(row['origines'])
        else:
            rows.append(measure_binary(b, sources, cited_addresses(fiche_stem(b.names_path)),
                                       recompiled if b.name == 'maj' else set()))
    if cro:
        cro['origines'] = dict(sorted(cro['origines'].items()))
        del cro['modules']
        rows.append(cro)
    analysed = {fiche_stem(b.names_path) for b in binaries if not b.prefix}
    waiting = []
    for name in sorted(os.listdir(FICHES)) if os.path.isdir(FICHES) else []:
        if name.endswith('.noms.tsv') and name[:-len('.noms.tsv')] not in analysed:
            names = name_pass.read_names(os.path.join(FICHES, name))
            waiting.append({'nom': name[:-len('.noms.tsv')], 'trouvees': None,
                            'nommees': sum(1 for _, n in names.values() if n)})
    return rows, waiting


def print_measure(rows, waiting):
    head = '%-22s %8s %8s %6s %7s %8s %8s %8s   %s' % ('binaire', 'trouvées', 'nommées', '%', 'typées', 'citées',
                                                    'recomp.', 'réimpl.', 'origine des noms')
    print(head)
    print('-' * len(head))
    for r in rows + [total_row(rows)]:
        share = 100 * r['nommees'] / r['trouvees'] if r['trouvees'] else 0
        print('%-22s %8d %8d %5.1f%% %7d %8d %8d %8d   %s' % (
            r['nom'], r['trouvees'], r['nommees'], share, r['typees'], r['citees'], r['recompilees'],
            r['reimplementees'], ', '.join('%s %d' % kv for kv in r.get('origines', {}).items())))
    if waiting:
        print('\nFiches de noms sans analyse dans local/analyse/<binaire>/gh (non comptées) :')
        print('   ' + ', '.join('%s (%d noms)' % (w['nom'], w['nommees']) for w in waiting))


def total_row(rows):
    total = {'nom': 'total'}
    total.update({k: sum(r[k] for r in rows) for k in LEVELS})
    return total


def write_etat(rows, waiting):
    etat = verifier.lire()
    total = total_row(rows)
    fonctions = etat.get('fonctions', {})
    fonctions.update({'total': total['trouvees'], 'identifiees': total['trouvees'], 'nommees': total['nommees'],
                      'typees': total['typees'], 'citees': total['citees'], 'recompilees': total['recompilees'],
                      'reimplementees': total['reimplementees'],
                      'binaires': [{k: r[k] for k in ('nom',) + LEVELS} for r in rows],
                      'sans_analyse': len(waiting)})
    etat['fonctions'] = fonctions
    verifier.ecrire(etat)
    print('\netat.json : %d fonctions trouvées, %d nommées dans %d binaires' % (total['trouvees'], total['nommees'], len(rows)))


# --- Essais, avec des données fabriquées ---

def arm_function(at, callee, literal, step=1):
    """push {r4, lr} ; ldr r0, [pc, #24] ; bl callee ; add r0, r0, #step ; cmp r0, #3 ; bne -> add ; adr r1 ;
    mov r0, #0 ; pop {r4, pc} ; .word literal. Neuf instructions (36 octets), puis la réserve."""
    bl = 0xEB000000 | ((callee - (at + 8 + 8)) >> 2) & 0xFFFFFF
    return [0xE92D4010, 0xE59F0018, bl, 0xE2800000 | step, 0xE3500003, 0x1AFFFFFC, 0xE28F1004, 0xE3A00000,
            0xE8BD8010, literal]


def thumb_function(at, callee, literal):
    """push {r4, lr} ; ldr r0, [pc, #16] ; bl callee ; adds r0, #1 ; cmp r0, #3 ; bne -> adds ; adr r1 ; movs r0, #0 ;
    pop {r4, pc} ; .word literal. Neuf instructions (20 octets), at aligné sur 4."""
    offset = callee - (at + 4 + 4)
    halves = [0xB510, 0x4804, 0xF000 | (offset >> 12) & 0x7FF, 0xF800 | (offset >> 1) & 0x7FF, 0x3001, 0x2803, 0xD1FC,
              0xA101, 0x2000, 0xBD10]
    return list(struct.unpack('<5I', struct.pack('<10H', *halves))) + [literal]


def fake_binary(name, base, placed, names, size=0x400):
    """Une image brute à `base` : placed = [(position, mots, mode, taille)], names = {position: nom}."""
    data = bytearray(size)
    functions = []
    for offset, words, mode, length in placed:
        struct.pack_into('<%dI' % len(words), data, offset, *words)
        functions.append((base + offset, length, mode))
    image = ghidra_direct.Image(bytes(data), [(base, 0, size, size, elfer.PF_R | elfer.PF_X)])
    b = Binary(name, functions, os.devnull, image)
    b.names = {base + o: ('function', n) for o, n in names.items()}
    return b


def test():
    failures = []

    def check(condition, text):
        if not condition:
            failures.append(text)
            print('ECHEC  ' + text)

    a_base, b_base = 0x00100000, 0x00340000
    stub = [0xE12FFF1E]                                                   # bx lr
    a = fake_binary('mod_a', a_base, [
        (0x040, arm_function(a_base + 0x40, a_base + 0x200, a_base + 0x300), 'arm', 36),
        (0x080, thumb_function(a_base + 0x80, a_base + 0x208, a_base + 0x310), 'thumb', 20),
        (0x0C0, arm_function(a_base + 0xC0, a_base + 0x200, 0xD900182F), 'arm', 36),
        (0x100, stub, 'arm', 4),
        (0x200, [0xE3A00001, 0xE12FFF1E], 'arm', 8),                      # mov r0, #1 ; bx lr
        (0x208, [0x47702001], 'thumb', 4)],                               # movs r0, #1 ; bx lr
        {0x040: 'nnosMutexLock', 0x080: 'thumb_helper', 0x0C0: 'ipc_send', 0x100: 'nullreturn', 0x200: 'inner_callee'})
    b = fake_binary('mod_b', b_base, [
        (0x100, arm_function(b_base + 0x100, b_base + 0x380, b_base + 0x20), 'arm', 36),
        (0x200, thumb_function(b_base + 0x200, b_base + 0x388, b_base + 0x40), 'thumb', 20),
        (0x140, arm_function(b_base + 0x140, b_base + 0x380, 0xD900182E), 'arm', 36),
        (0x180, arm_function(b_base + 0x180, b_base + 0x380, b_base + 0x24, step=2), 'arm', 36),
        (0x300, stub, 'arm', 4),
        (0x380, [0xE3A00001, 0xE12FFF1E], 'arm', 8),                      # les mêmes appelées, ailleurs
        (0x388, [0x47702001], 'thumb', 4),
        (0x3C0, [0xE3A00002, 0xE12FFF1E], 'arm', 8),                      # une autre appelée, autre code
        (0x340, arm_function(b_base + 0x340, b_base + 0x3C0, b_base + 0x20), 'arm', 36)],
        {})
    pa, pb = fingerprints(a), fingerprints(b)
    check(pa[a_base + 0x40][0] == pb[b_base + 0x100][0], 'ARM : même empreinte à deux adresses dans deux images')
    check(pa[a_base + 0x40][1] == 9, 'ARM : neuf instructions, la réserve ne compte pas (%d)' % pa[a_base + 0x40][1])
    check(pa[a_base + 0x80][0] == pb[b_base + 0x200][0], 'Thumb : même empreinte à deux adresses dans deux images')
    check(pa[a_base + 0x40][0] != pb[b_base + 0x180][0], 'une instruction non masquée change l\'empreinte')
    check(pa[a_base + 0xC0][0] != pb[b_base + 0x140][0], 'une constante de réserve change l\'empreinte')
    check(pa[a_base + 0x40][0] != pa[a_base + 0xC0][0], 'adresse de l\'image et constante se distinguent')
    check(pa[a_base + 0x40][2] == [a_base + 0x200] and pa[a_base + 0x80][2] == [(a_base + 0x208) | 1], 'appelées relevées')
    # Une réserve au milieu, sautée par un « b », n'est pas lue comme une instruction : ldr r0, [pc] ; b ; .word ; bx lr
    mid = fake_binary('mid', a_base, [(0, [0xE59F0000, 0xEA000000, 0x12345678, 0xE12FFF1E], 'arm', 12)], {})
    check(fingerprints(mid)[a_base][1] == 3, 'réserve au milieu : trois instructions')
    # Un « blx » vers l'aide de switch Thumb : la table d'octets n'est pas décodée
    helper = struct.unpack('<6I', next(iter(ghidra_direct.SWITCH_HELPER_SIGNATURES)))
    blx = (0x200 - (0 + 4)) & ~3
    switch = struct.unpack('<3I', struct.pack('<6H', 0xF000 | (blx >> 12) & 0x7FF, 0xE800 | (blx >> 1) & 0x7FF,
                                              0x0002, 0x0302, 0x4770, 0x0000))
    sw = fake_binary('sw', a_base, [(0, list(switch), 'thumb', 6), (0x200, list(helper), 'arm', 24)], {})
    check(fingerprints(sw)[a_base][1] == 2, 'table de switch Thumb sautée (%d instructions)' % fingerprints(sw)[a_base][1])

    proposals, conflicts, stats = propose([a, b], {'mod_a': pa, 'mod_b': pb})
    found = {(p.binary.name, p.address): p for p in proposals}
    check(found.get(('mod_b', b_base + 0x100)) is not None and found[('mod_b', b_base + 0x100)].name == 'nnosMutexLock'
          and found[('mod_b', b_base + 0x100)].confidence == 'haute'
          and found[('mod_b', b_base + 0x100)].source == 'empreinte:mod_a', 'nom ARM propagé, confiance haute')
    check(found.get(('mod_b', b_base + 0x200)) is not None and found[('mod_b', b_base + 0x200)].thumb, 'nom Thumb propagé')
    check(('mod_b', b_base + 0x300) not in found, 'un « bx lr » ne propage pas son nom')
    check(('mod_b', b_base + 0x140) not in found, 'une autre constante : pas de nom')
    check(('mod_b', b_base + 0x340) not in found, 'même code mais une appelée différente : pas de nom')
    callee = found.get(('mod_b', b_base + 0x380))
    check(callee is not None and callee.name == 'inner_callee' and callee.confidence == 'moyenne'
          and callee.source == 'appel:mod_a', 'appelée nommée par le rang de l\'appel, confiance moyenne')
    # Désaccord : deux copies nommées autrement
    one = (0x200, [0xE3A00001, 0xE12FFF1E], 'arm', 8)
    c = fake_binary('mod_c', 0x00500000, [(0, arm_function(0x00500000, 0x00500200, 0x00500300), 'arm', 36), one],
                    {0: 'other'})
    d = fake_binary('mod_d', 0x00600000, [(0, arm_function(0x00600000, 0x00600200, 0x00600300), 'arm', 36), one], {})
    _, conf, _ = propose([a, c, d], {'mod_a': pa, 'mod_c': fingerprints(c), 'mod_d': fingerprints(d)})
    check(len(conf) == 1, 'noms en désaccord : pas de proposition, un conflit')
    # Une chaîne visée entre dans l'empreinte : « cfg:s » et « cfg:u » se distinguent, l'adresse de la chaîne non
    strings = []
    for base, at, text in ((0x00500000, 0x300, b'cfg:s\0'), (0x00600000, 0x340, b'cfg:s\0'), (0x00700000, 0x300, b'cfg:u\0')):
        s = fake_binary('s%x' % base, base, [(0, arm_function(base, base + 0x200, base + at), 'arm', 36)], {})
        s.image.data = s.image.data[:at] + text + s.image.data[at + len(text):]
        strings.append(fingerprints(s)[base][0])
    check(strings[0] == strings[1] != strings[2], 'chaîne visée : même texte même empreinte, autre texte autre empreinte')
    # Un envoi IPC (mrc du tampon de commande, en-tête, handle global, svc 0x32) ne propage qu'en confiance basse
    def ipc_function(base, at):
        return (at, [0xE92D4010, 0xEE1D4F70, 0xE59F0014, 0xE5A40080, 0xE59F0010, 0xE5900000, 0xEF000032, 0xE5940004,
                     0xE8BD8010, 0x00080040, base + 0x3F0], 'arm', 36)
    f = fake_binary('mod_f', 0x00500000, [ipc_function(0x00500000, 0x100)], {0x100: 'mic_SetGain'})
    g = fake_binary('mod_g', 0x00600000, [ipc_function(0x00600000, 0x40)], {})
    proposals_ipc, _, _ = propose([f, g], {'mod_f': fingerprints(f), 'mod_g': fingerprints(g)})
    check([(p.address, p.confidence) for p in proposals_ipc] == [(0x00600040, 'basse')], 'envoi IPC : confiance basse')
    # Collisions : le nom est déjà pris ailleurs dans le binaire visé, l'adresse est déjà nommée
    b.names = {b_base + 0x10: ('function', 'nnosMutexLock')}
    kept, dropped = reconcile_all([a, b], proposals)
    check(not any(p.name == 'nnosMutexLock' for p in kept) and any('nom déjà pris' in why for _, why in dropped),
          'collision de nom refusée')
    b.names = {b_base + 0x200: ('label', 'already')}
    proposals, _, _ = propose([a, b], {'mod_a': pa, 'mod_b': pb})
    check(not any(p.address == b_base + 0x200 for p in proposals), 'adresse déjà nommée : rien de proposé')
    # Un .cro : le nom porte le préfixe du module, l'adresse est la position dans le fichier
    e = fake_binary('DllX', 0x40000000, [(0x180, arm_function(0x40000180, 0x40000200, 0x40000300), 'arm', None),
                                         (0x200, one[1], 'arm', None)], {})
    e.prefix, e.base, e.group = 'DllX_', 0x40000000, GAME
    proposals, _, _ = propose([a, e], {'mod_a': pa, 'DllX': fingerprints(e)})
    check(sorted((p.module, p.address, p.name) for p in proposals) == [('DllX', 0x180, 'DllX_nnosMutexLock'),
                                                                    ('DllX', 0x200, 'DllX_inner_callee')],
          '.cro : position et préfixe du module')
    # « apply » : la graine sans nom reçoit le nom sur place ; un binaire sans fiche de noms n'en reçoit pas une
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        b.names_path = os.path.join(folder, 'mod_b.noms.tsv')
        with open(b.names_path, 'w', encoding='utf-8', newline='\n') as f:
            f.write('0x340000\tfunction\tfirst\n0x340100\tfunction\t\n')
        d.names_path = os.path.join(folder, 'absent.noms.tsv')
        apply([make_proposal(b, b_base + 0x100, 'nnosMutexLock', 'empreinte:mod_a', 'haute', '', 'arm'),
               make_proposal(d, 0x00600000, 'nnosMutexLock', 'empreinte:mod_a', 'haute', '', 'arm')])
        check(open(b.names_path, encoding='utf-8').read() == '0x340000\tfunction\tfirst\n0x340100\tfunction\tnnosMutexLock\n'
              and not os.path.exists(d.names_path), 'apply : graine nommée sur place, pas de fiche créée')
    # Le compteur
    a.names[a_base + 0x999] = ('function', 'not_a_start')
    row = measure_binary(a, {('mod_a', a_base + 0x40, 'nnosMutexLock'): 'rtti'}, {a_base + 0x80}, {a_base + 0x40})
    check((row['trouvees'], row['nommees'], row['citees'], row['recompilees']) == (6, 5, 1, 1)
          and row['origines'] == {'fiche': 4, 'rtti': 1}, 'compteur : %r' % row)
    print('%d échec(s)' % len(failures) if failures else 'couverture : tous les essais passent')
    return failures


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ('mesure', 'run', 'apply', 'test'):
        sys.exit(__doc__)
    if args[0] == 'test':
        sys.exit(1 if test() else 0)
    if args[0] == 'mesure':
        rows, waiting = measure(load_all(with_image=False))
        print_measure(rows, waiting)
        if '--no-write' not in args:
            write_etat(rows, waiting)
        return
    min_high, min_low, out = MIN_HIGH, MIN_LOW, OUT
    i = 1
    while i < len(args):
        if args[i] in ('--min', '--min-moyenne', '--out') and i + 1 < len(args):
            if args[i] == '--min':
                min_high = int(args[i + 1])
            elif args[i] == '--min-moyenne':
                min_low = int(args[i + 1])
            else:
                out = args[i + 1]
            i += 2
        else:
            sys.exit('option inconnue : %s' % args[i])
    kept = run(min_high, min_low, out)
    if args[0] == 'apply':
        apply(kept)


if __name__ == '__main__':
    main()
