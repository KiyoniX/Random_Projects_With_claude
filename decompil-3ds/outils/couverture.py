"""Le compteur de la décompilation à 100 %, et la propagation des noms d'un binaire à l'autre par empreinte.

    python couverture.py mesure [--no-write]                       le tableau par binaire ; les totaux vont dans etat.json
    python couverture.py entrees <binaire>                         les entrées manquées par Ghidra et les tailles qui débordent
    python couverture.py run   [--min N] [--min-moyenne N] [--out DOSSIER]   propositions de noms, ne touche à aucune fiche
    python couverture.py apply [--from proposals.tsv] [--exclusions exclusions.tsv]   verse les noms de confiance
                               haute d'un fichier de propositions RELU, sans refaire le calcul
    python couverture.py revoir [--out DOSSIER]   les noms de fiches/noms-propages.tsv que les règles d'aujourd'hui ne
                               verseraient plus (envoi IPC, nom de rôle, appelées d'autres noms) : propages-a-revoir.tsv
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

1. Le compteur (« mesure »). Pour chaque binaire, le dénominateur puis des niveaux du plus faible au plus fort :
    trouvees        ghidra + manquees + fiche_seule :
      ghidra        les fonctions de funcs.tsv (cro_table.c pour les .cro)
      manquees      les entrées que Ghidra n'a pas en début de fonction, trouvées ici (« entrees », plus bas)
      fiche_seule   les lignes « function » de la fiche de noms qui ne sont ni l'une ni l'autre
                    Ce n'est toujours pas le vrai total : une fonction que rien ne désigne reste invisible
    nommees         les fonctions qui ont un nom dans la fiche de noms du binaire, réparties par origine quand une passe
                    l'a écrit : la source de name_pass.py (rtti, svc, stdlib...) ou d'ici (empreinte, appel) ; « fiche »
                    pour le reste (les fiches n'ont pas de colonne de confiance : tout nom versé compte comme « fiche »)
    proposees_haute, proposees_moyenne   les noms proposés et pas encore versés : local/analyse/<binaire>/noms-proposes.tsv
                    (adresse, genre, nom, confiance, preuve), puis names-croises/proposals.tsv
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

   Les entrées manquées (« entrees », find_entries) : toutes les cibles de b, bl et blx, les mots des réserves de
   littéraux et les mots de l'image qui visent le texte (ARM pair, Thumb impair), qui ne tombent pas sur un début de
   fonction de Ghidra, y compris au milieu d'une fonction de Ghidra (une taille trop grande avale l'enrobage suivant) ;
   les veneers ARM vers Thumb (« add ip, pc, #N ; bx ip », précédé ou non d'un « mov r0, r0 ») et leur corps Thumb,
   même quand le veneer visé par un b ou un bl est dans la taille d'une fonction Thumb de Ghidra (ro 0x14000110) ou que
   N saute au milieu d'une fonction de Ghidra (news 0x105758, #0x17) ; les rappels Thumb dont l'adresse est calculée
   depuis pc (« ldr rX, =distance ; add rX, pc », news 0x105790) ; les tables de distances des données qu'un module
   recopie au démarrage (RUNTIME_COPIES : les constructeurs statiques de qtm), lues à l'adresse de la copie. Genres :
   cible de b (appel terminal), cible de bl, veneer, corps de veneer, pointeur de réserve, pointeur seul, adresse
   calculée, « au milieu de » la fonction qui la couvre. Une case d'aiguillage ou un saut qui reste dans sa fonction
   n'en est pas une : les cases des aiguillages Thumb sans aide (« add pc, rA » après une table de demi-mots, nim
   0x1055ae) et le code sans push entre l'aiguillage et le début de fonction qui suit sa dernière case sont des
   morceaux de l'aiguillage, même atteints par un bl (ac 0x1057dc) ; la sortie liste à part les fonctions de Ghidra
   qui sont des cases. Relevé à la main dans gpio
   (11) et codec (16, local/analyse/<m>/notes-100.md) : toutes retrouvées. Les entrées trouvées deviennent des
   fonctions pour l'empreinte et les noms, et coupent les tailles de Ghidra qui débordent (gpio 0x100c10 : 116 octets
   au lieu de 20, réserve comprise).

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
   de la fonction suivie de celle de chacune de ses appelées (« bl ») et des fonctions où elle saute en appel terminal
   (« b »), dans l'ordre (un niveau : l'appelée de l'appelée n'est pas regardée). Si les copies nommées d'une grappe
   portent toutes le même nom (au préfixe « <Module>_ » des .cro près), ce nom est proposé pour les copies sans nom.

   La confiance suit la règle du carnet, deux voies indépendantes (colonne « règle » de proposals.tsv) :
    haute    (a) au moins deux binaires d'origine portent ce nom sur ce code (deux fiches qui s'accordent ; un nom
             qu'apply a propagé, listé dans fiches/noms-propages.tsv, n'est pas un témoin et ne compte pas, et un
             module et sa variante « -safe » ne comptent que pour un), ou
             (b) le nom se prouve seul : symbole C++ manglé (_Z...), bibliothèque C (strlen, memcmp... ; pas memcpy,
             memmove ni memset, qu'armcc double de __aeabi_memcpy qui rend dest + n) ou exécution du compilateur
             (__aeabi_*, __cxa_*, __rw_*...), ou svc<Nom> sur une fonction ARM qui n'est que cet appel système, du bon
             numéro (octets relus par name_pass.decode_svc et is_pure_svc_wrapper) : un svc<Nom> n'est haute que
             par là. Et au moins --min instructions (8), sauf pour (b:svc).
             (jumeau) une fonction d'une variante « -safe » qui a l'empreinte d'une fonction nommée du module normal
             ET la même place dans les deux suites de fonctions alignées par adresse (même code source, même
             fonction : fiches/safe.md) ; sauf les adresses refusées par la relecture (exclusions*.tsv).
             Un témoin (la copie nommée qui donne son nom, pour (a), le jumeau et les appelées) a au moins deux
             instructions, et sa grappe ne porte qu'un nom dans les fiches : un « mov r0, r0 » seul a une empreinte
             vide, et le constructeur statique « range 0 dans une globale » est à 77 adresses sous autant de noms.
             Pour toutes ces règles, jumeau compris, au moins un témoin a les mêmes appelées que la copie : les bl,
             blx et b vers un début de fonction, veneers traversés, portent dans l'ordre le même nom versé des deux
             côtés (au suffixe « _alt_… » près), ou sont sans nom des deux côtés avec la même empreinte (callee_keys).
             La clé de grappe compare le code des appelées, pas leur nom : deux shared_memory_dtor de même code
             appellent unmap_shared_memory_or_panic ou unmap_shared_memory, deux appels par veneer ont le même veneer
             (local/analyse/audit-alt/notes.md).
    moyenne  le reste : une seule origine ; moins de --min instructions ; un nom qui contient un mot de service
             (cfg, ptm, nwm... délimité par « _ » ; pas srv, errf, svc*, ni « ns » en dernier mot) sans que la
             fonction cite dans sa réserve la chaîne « xxx:yyy » de ce service ; un nom d'ouverture ou de fermeture de
             session (open, close, exit, init, connect avec un service, srv, session ou handle) ; un nom qui commence
             par le nom du binaire d'origine. Dans ces cas la fonction identique peut viser un autre service ou une
             autre session, par un handle global que l'empreinte masque. Puis, sans exception (jumeau compris) :
             des appelées qui n'ont pas les mêmes noms versés que chez un témoin ; un nom de rôle, qui désigne un
             objet ou un service (préfixe de service en majuscules « IRUSER_ », « SRV_ », ou les mots session,
             handle) : il n'est jamais reporté par empreinte, il reste proposé en moyenne pour un lot. Vérifier que
             les globales lues sont les mêmes demanderait de suivre chaque globale jusqu'à son ouverture : on ne le
             fait pas (menu 0x163b18, code d'IRUSER_Disconnect d'extrapad, envoie sur ns:s).
    basse    une fonction qui envoie une commande IPC (lecture du tampon de commande « mrc p15, 0, rX, c13, c0, 3 » ou
             « svc 0x32 », dans son code ou dans une appelée de quatre instructions au plus, veneer traversé : les
             émetteurs Thumb de snote_ap appellent par blx le talon 0x13da98 « svc 0x32 ; bx lr »), jumeau compris : la commande 8 à un
             paramètre d'octet de mic (mic_SetGain dans le jeu) a exactement le code d'une commande 8 d'un autre
             service dans errdisp
    rien     moins de --min-moyenne instructions (4) : « bx lr » ou « mov r0, #0 ; bx lr » existent partout sous dix noms
   Une grappe dont les copies nommées ne s'accordent pas ne propose rien (conflicts.tsv). Les appelées : dans une
   grappe d'au moins --min instructions, l'appelée au rang k de chaque copie a le même code ; si les appelées
   nommées s'accordent, le nom est proposé aux autres, jugé par les mêmes règles sur l'appelée. C'est ce qui nomme les
   petites fonctions (« svc 0x23 ; bx lr ») que la règle des --min-moyenne instructions écarte seules. Une même
   proposition arrivée par deux chemins garde la confiance la plus haute.

   Les collisions suivent la règle de name_pass.py (dont reconcile est repris tel quel) : dans un binaire, une adresse
   n'a qu'un nom et un nom qu'une adresse. Le jeu (code.bin et ses 133 .cro) forme un seul espace de noms, comme pour
   name_pass.py ; chaque module système a le sien (le même enrobage peut s'appeler svcSendSyncRequest partout).

   Il écrit dans local/analyse/names-croises/ :
    proposals.tsv   binaire, adresse (dans l'espace de la fiche : position dans le fichier pour un .cro), nom, source
                    (« empreinte:<binaire d'origine> » ou « appel:<binaire d'origine> »), confiance, règle (a, b:nom,
                    b:svc, ou pourquoi pas haute), preuve
    exclusions.tsv  (à la main) binaire, adresse, raison : ce que « apply » ne verse pas, même en confiance haute
   Et « apply » ajoute chaque nom qu'il verse à fiches/noms-propages.tsv (versionné) : binaire, adresse, nom, origine
   (source et règle), date.
    collisions.tsv  ce qui a été écarté et pourquoi
    conflicts.tsv   les grappes dont les copies nommées ne s'accordent pas
    report.txt      le compte : grappes, propositions par confiance et par binaire

Ce qu'il ne fait pas. Il ne compare pas deux fonctions « presque » égales (une constante de ligne d'ERRF_Throw qui
change suffit à les séparer : c'est voulu, la fonction n'est alors pas tout à fait la même). Il ne reconnaît pas une
fonction que deux compilateurs ou deux versions du SDK ont produite autrement. Une fonction coupée autrement par Ghidra
dans deux binaires (un bout de code partagé, une fin manquée) n'y trouve pas sa jumelle.
"""
import bisect
import collections
import datetime
import difflib
import glob
import hashlib
import os
import re
import struct
import sys
import tempfile
import types

import elfer
import ghidra_direct
import ghidra_raw
import name_pass
import verifier

sys.path.insert(0, os.path.join(ghidra_direct.ROOT, 'recomp'))
import armdec  # noqa: E402
import cro_recomp  # noqa: E402
import recomp  # noqa: E402

ROOT = ghidra_direct.ROOT
ANALYSE = os.path.join(ROOT, 'local', 'analyse')
FICHES = name_pass.FICHES
CRO_FICHES = name_pass.CRO_FICHES
RECOMP_OUT = os.path.join(ROOT, 'local', 'recomp', 'jeu')
OUT = os.path.join(ANALYSE, 'names-croises')
PROPOSALS = os.path.join(OUT, 'proposals.tsv')
EXCLUSIONS = os.path.join(OUT, 'exclusions.tsv')
PROVENANCE = os.path.join(FICHES, 'noms-propages.tsv')
PROVENANCE_HEADER = [
    "# Les noms versés dans les fiches par « python outils/couverture.py apply » : propagés d'un binaire à l'autre par",
    "# empreinte, pas lus. Écrit par apply, une ligne par nom, jamais réécrit. « run » ne compte pas ces noms comme",
    "# origine de la règle (a) (deux binaires qui s'accordent) : un nom propagé n'est pas un témoin indépendant.",
    "# origine : la source de la proposition et sa règle (a : binaires d'origine ; b:nom, b:svc : le nom se prouve seul).",
    'binaire\tadresse\tnom\torigine\tdate']
NAME_PASS_PROPOSALS = os.path.join(name_pass.OUT, 'proposals.tsv')
MIN_HIGH = 8
MIN_LOW = 4
MIN_WITNESS = 2                         # un témoin d'au moins deux instructions : un « mov r0, r0 » seul qui tombe dans la
                                        # fonction suivante a une empreinte vide, la même partout
GAME = 'jeu'                            # l'espace de noms de code.bin (« maj ») et des .cro
SAFE = '-safe'                          # la variante du mode sans échec d'un module (fiches/safe.md)
# Des noms qui disent une adresse ou un défaut d'outil, pas une fonction : on ne les recopie pas ailleurs.
# Seulement les formes automatiques (Ghidra, trous du recompilateur, doublons « _alt_ » de name_pass) : un vrai nom
# peut finir par une adresse (init_vm_region_10000000).
GENERIC_NAME = re.compile(r'^(?:FUN|LAB|thunk|trou)_|_alt_')
PADDING = {0, 0x46C0, 0xE1A00000}       # demi-mot nul, « mov r8, r8 » Thumb, « mov r0, r0 » ARM
# Les données qu'un module recopie au démarrage ailleurs que là où le fichier les charge : (adresse dans le fichier,
# adresse de la copie, taille). Une table de distances y compte depuis la copie, pas depuis le fichier.
# qtm : copy_qtm_ram_image (0x1007a8, littéraux 0x100804, 0x100808, 0x10080c) recopie l'image des données vers la
# mémoire QTM ; run_static_initializers (0x1001d0) y parcourt la table des 31 constructeurs statiques (0x1eb6338c).
RUNTIME_COPIES = {'qtm': [(0x12503C, 0x1EADD800, 0x85E0C)]}


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
        self.entries = {}                    # les entrées manquées par Ghidra (add_entries)
        self.target = None                   # les réglages de raw_targets.toml pour une cible brute (ghidra_raw)
        self.copies = RUNTIME_COPIES.get(name, [])
        self.pieces = {}                     # les morceaux d'une fonction de Ghidra en plusieurs morceaux
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
    binary = Binary(name, functions, names_path, image, group=GAME if name == 'maj' else name)
    binary.target = targets.get(name)
    return binary


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


def load_all(with_image=True, cro_images=None, entries=None):
    """Les binaires analysés puis les .cro. entries (par défaut : with_image) : chercher les entrées manquées par
    Ghidra de chaque binaire qui a ses octets (add_entries) ; les .cro n'en ont pas, leur liste vient du recompilateur."""
    names = sorted(n for n in os.listdir(ANALYSE) if os.path.isfile(os.path.join(ANALYSE, n, 'gh', 'funcs.tsv'))) \
        if os.path.isdir(ANALYSE) else []
    binaries = []
    for name in names:
        print('lecture de %s...' % name, flush=True)
        binary = load_system(name, with_image)
        if binary.image is not None and (with_image if entries is None else entries):
            add_entries(binary)
        binaries.append(binary)
    binaries += load_cros(with_image if cro_images is None else cro_images)
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


# L'empreinte d'une fonction, et ce qu'on en garde pour juger un nom : appelées (« bl ») et cibles des « b » dans
# l'ordre, envoi IPC dans son code, chaînes citées par sa réserve, adresses des mots de sa réserve, adresses calculées
# depuis pc (« ldr rX, =distance ; add rX, pc » : un rappel passé en argument, news 0x105790).
Print = collections.namedtuple('Print', 'digest count calls ipc strings jumps pool computed')


def is_ipc(token):
    """mrc p15, 0, rX, c13, c0, 3 (le tampon de commande du fil) ou svc 0x32 (SendSyncRequest), ARM ou Thumb."""
    return isinstance(token, int) and (token & 0x0FFF0FFF == 0x0E1D0F70 or token & 0x0FFFFFFF == 0x0F000032
                                       or token == 0xDF32)


def arm_token(binary, pos, w, literals, calls, jumps, window):
    """Le mot ARM masqué. Note dans `literals` les mots de réserve lus dans la fonction, dans `calls` les appelées,
    dans `jumps` les cibles des « b » (sauts internes, et appels terminaux vers une autre fonction)."""
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
        (calls if w & 0x01000000 else jumps).append(pos + 8 + offset)
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


def thumb_token(binary, pos, code, at, literals, calls, jumps, window, computed):
    """(demi-mot Thumb masqué, octets lus, octets d'instruction comptés)."""
    h = struct.unpack_from('<H', code, at)[0]
    if h & 0xFF78 == 0x4478 and h & 0x87 != 0x87:                       # add rX, pc (rX n'est pas pc)
        register = h & 7 | (h >> 4) & 8
        # La distance vient d'un « ldr rX, [pc, #imm] » d'au plus quatre demi-mots avant (ac 0x1142be : trois), lu dans
        # l'image : il peut précéder le début de la fonction de Ghidra.
        for back in range(pos - 2, pos - 10, -2):
            ldr = binary.image.half(back)
            if ldr is not None and ldr >> 11 == 0x09 and (ldr >> 8) & 7 == register:
                value = binary.image.word(((back + 4) & ~3) + ((ldr & 0xFF) << 2))
                if value is not None:
                    computed.append((pos + 4 + value) & 0xFFFFFFFF)
                break
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
    if h >> 12 == 0xD and (h >> 8) & 0xF < 0xE:                        # b<cond>
        jumps.append(pos + 4 + (sext(h & 0xFF, 8) << 1))
        return h & 0xFF00, 2, 2
    if h >> 11 == 0x14:                                                 # adr
        return h & 0xFF00, 2, 2
    if h >> 11 == 0x1C:                                                 # b
        jumps.append(pos + 4 + (sext(h & 0x7FF, 11) << 1))
        return 0xE000, 2, 2
    if h >> 11 == 0x09:                                                 # ldr rX, [pc, #imm]
        address = ((pos + 4) & ~3) + ((h & 0xFF) << 2)
        if window[0] <= address < window[1]:
            literals.add(address)
        return ('L', h & 0xFF00) + literal_token(binary, address), 2, 2
    return h, 2, 2


def fingerprint(binary, start, mode, size, limit):
    """L'empreinte d'une fonction (Print). size : octets d'instructions selon Ghidra, ou None (jusqu'à `limit`, le début
    de la fonction suivante ou la fin du code)."""
    code = binary.image.read(start, limit - start) or b''
    tokens, calls, jumps, literals, computed = [], [], [], set(), []
    window = (start, start + len(code))
    at = used = 0
    thumb = mode == 'thumb'
    while at + (2 if thumb else 4) <= len(code) and (size is None or used < size):
        pos = start + at
        if pos in literals:
            at += 4
            continue
        if thumb:
            token, step, counted = thumb_token(binary, pos, code, at, literals, calls, jumps, window, computed)
        elif pos in binary.jump_slots:
            token, step, counted = ('J',) + literal_token(binary, pos), 4, 0
        else:
            word = struct.unpack_from('<I', code, at)[0]
            token, step, counted = arm_token(binary, pos, word, literals, calls, jumps, window), 4, 4
        tokens.append(token)
        at += step
        used += counted
    while tokens and tokens[-1] in PADDING:
        tokens.pop()
    count = sum(1 for t in tokens if not (isinstance(t, tuple) and t[0] == 'J'))
    digest = hashlib.blake2b(repr((mode, tokens)).encode(), digest_size=12).hexdigest()
    strings = {x[1] for t in tokens if isinstance(t, tuple) for x in t if isinstance(x, tuple) and x[0] == 'S'}
    return Print(digest, count, calls, any(is_ipc(t) for t in tokens), strings, jumps, sorted(literals), computed)


def code_end(binary, address):
    return next((high for low, high in binary.image.code_ranges if low <= address < high), None)


def fingerprints(binary):
    """{adresse: Print} pour toutes les fonctions d'un binaire qui a ses octets. L'étendue s'arrête au début connu
    suivant, entrées manquées comprises : une taille de Ghidra qui déborde sur une autre fonction est coupée."""
    out = {}
    starts = sorted(binary.starts)
    following = dict(zip(starts, starts[1:]))
    for address, size, mode in binary.functions:
        end = code_end(binary, address)
        if end is not None:
            out[address] = fingerprint(binary, address, mode, size, min(end, following.get(address, end)))
    return out


# --- Les entrées que Ghidra n'a pas en début de fonction ---

def is_add_ip_pc(word):
    return word is not None and word & 0xFFFFF000 == 0xE28FC000


def veneer_body(image, address):
    """Le corps Thumb d'un veneer ARM vers Thumb (« add ip, pc, #N ; bx ip », ou « ldr ip, [pc] ; bx ip ; .word »),
    précédé ou non d'un « mov r0, r0 » où arrivent les appelants (fs 0x100194, corps en 0x1001a0). Avec N = 1, le
    corps suit le veneer ; un autre N impair saute plus loin, souvent au milieu d'une fonction de Ghidra (news 0x105758,
    « add ip, pc, #0x17 », vers 0x105776 ; cecd 0x115d7c, « #0x7f », vers 0x115e02). N pair viserait de l'ARM : refusé."""
    first, second = image.word(address), image.word(address + 4)
    if first == 0xE1A00000 and is_add_ip_pc(second):
        address, first, second = address + 4, second, image.word(address + 8)
    if second != 0xE12FFF1C:
        return None
    if is_add_ip_pc(first):
        target = address + 8 + armdec.ror(first & 0xFF, 2 * ((first >> 8) & 15))
    else:
        target = image.word(address + 8) if first == 0xE59FC000 else None
    return target - 1 if target is not None and target & 1 else None


PIECE = 'morceau de '                   # genre d'un bout de fonction de Ghidra en plusieurs morceaux : pas une entrée


def opens_frame(image, address, mode):
    """Le code commence par « push {..., lr} » (recomp.is_arm_prologue ; 0xB5xx en Thumb) : un début de fonction."""
    if mode == 'thumb':
        return (image.half(address) or 0) & 0xFF00 == 0xB500
    return recomp.is_arm_prologue(image.word(address) or 0)


def looks_arm(image, address):
    """Autour de l'adresse, au moins quatre mots sur cinq ont la condition « toujours » (0xE...) : du code ARM. Lu en
    Thumb, chacun donnerait un « b » suivi d'un demi-mot quelconque."""
    words = [image.word((address & ~3) + 4 * k) for k in range(-2, 3)]
    return sum(1 for w in words if w is not None and w >> 28 == 0xE) >= 4


def at_boundary(binary, address, mode, pools):
    """Une entrée plausible : un « push » (stmdb sp!, push Thumb), ou juste avant un mot de réserve de littéraux
    (`pools`, ou une adresse du fichier qui ne se lit pas comme une instruction « toujours » : la réserve d'une
    fonction que rien n'a lue), du bourrage (nul,
    nop) ou une instruction qui ne laisse pas passer le fil (bx lr, pop {..., pc}, ldr pc, [sp], #4, b sans
    condition). Une case d'aiguillage, une donnée lue comme du code, un pointeur vers le milieu d'une boucle n'y sont
    pas."""
    image = binary.image
    before = image.word(address - 4)
    if address - 4 in pools or mode == 'arm' and before and image.offset(before) is not None and before >> 28 != 0xE:
        return True
    # Le code d'avant peut être dans l'autre mode (une fonction Thumb, son bourrage 0xFFFF, puis de l'ARM).
    half = image.half(address - 2)
    if half is not None and (half in (0x4770, 0xFFFF) or half >> 8 == 0xBD):
        return True
    if mode == 'thumb':
        return (image.half(address) or 0) >> 9 == 0x5A or half is not None and (half in (0x46C0, 0) or half >> 11 == 0x1C)
    here, before = image.word(address) or 0, image.word(address - 4)
    return here >> 16 == 0xE92D or before is not None and (
        before in (0xE12FFF1E, 0xE49DF004, 0xE1A00000, 0) or before >> 24 == 0xEA or before >> 16 == 0xE8BD and before & 0x8000)


def thumb_cases(binary):
    """Les cases des aiguillages Thumb sans aide (ghidra_direct.find_thumb_jump_cases) : {cible: adresse du add pc}."""
    cases = {}
    for low, high in binary.image.code_ranges:
        cases.update(ghidra_direct.find_thumb_jump_cases(binary.image.read(low, high - low) or b'', low))
    return cases


def find_entries(binary):
    """Les entrées manquées : {adresse: (mode, genre, origine)}. Toutes les cibles de b, bl, blx, tous les mots des
    réserves de littéraux et tous les mots de l'image qui visent le texte (ghidra_direct.find_pointers, comme les
    graines de Ghidra) et qui ne tombent pas sur un début de fonction de Ghidra, y compris au milieu d'une autre
    fonction ; les veneers ARM vers Thumb et leur corps. Les entrées trouvées sont lues à leur tour (jusqu'au début
    connu suivant) : un veneer manqué mène à son corps Thumb, manqué lui aussi.
    Ce qui n'en est pas : un saut ou un pointeur (case d'un aiguillage, adresse de retour posée à la main) qui reste
    dans la fonction de Ghidra d'où il part, c'est-à-dire dans sa taille ou avant le début de fonction suivant. Un
    saut au-delà, mais que la taille de Ghidra couvre, vise un autre morceau d'une fonction que Ghidra a vue en
    plusieurs morceaux (codec_init_hardware) : il est rendu avec le genre « morceau de ... », lu pour ses sauts, et
    n'est pas compté, sauf s'il ouvre un cadre de pile (« push {..., lr} ») : c'est alors une fonction que Ghidra a
    avalée par une taille trop grande (errf_send_fatal_error dans gpio). Les cases d'un aiguillage Thumb sans aide
    (« add pc, rA » après une table de demi-mots, thumb_cases) sont des morceaux de la fonction de l'aiguillage, quel
    que soit le chemin qui y mène : le cas par défaut est souvent atteint par un « bl » (nim 0x107f5e)."""
    ghidra = sorted((a, s or 0) for a, s, _ in binary.functions)
    starts = [a for a, _ in ghidra]
    longest = max([s for _, s in ghidra] + [0])
    modes = {a: m for a, _, m in binary.functions}
    found, todo, rejected = {}, [], []

    def covering(address):
        """Les débuts des fonctions de Ghidra dont la taille couvre l'adresse."""
        low = bisect.bisect_left(starts, address - longest)
        high = bisect.bisect_right(starts, address)
        return [a for a, s in ghidra[low:high] if address < a + s]

    def region(address):
        """De la fonction de Ghidra qui précède l'adresse jusqu'à la suivante : (début, fin)."""
        i = bisect.bisect_right(starts, address)
        return (starts[i - 1] if i else None), (starts[i] if i < len(starts) else None)

    def inside(origin, target):
        """La cible reste dans la fonction de Ghidra d'où elle part (sa taille, ou jusqu'au début suivant). Pour un mot
        de réserve connu (lu par un ldr pc de sa fonction), seule la taille compte : au-delà, c'est l'adresse d'une
        autre fonction (main_thread_terminate_handler, un « bl abort » seul, juste après la réserve), pas une case."""
        first, end = region(origin)
        if first is None:
            return False
        return first in covering(target) or origin not in pools and first <= target < (end or target + 1)

    # Les cases des aiguillages Thumb sans aide : {cible: (adresse du add pc, fonction de l'aiguillage)}, et l'étendue
    # de chaque fonction d'aiguillage : jusqu'au début de fonction de Ghidra qui suit sa plus haute case. Ce code est le
    # sien, même là où Ghidra s'arrête au « add pc » (nim_s_dispatch_command, 52 octets) : ses cases y reviennent par
    # des « bl » qui servent de sauts longs (ac 0x1057dc), et une suite peut être après la dernière case (cecd 0x11ba02).
    cases, highest = {}, {}
    for target, site in thumb_cases(binary).items():
        host = (covering(site) or [region(site)[0]])[0]
        if host is not None:
            cases[target] = (site, host)
            highest[host] = max(highest.get(host, target), target)
    extent = {h: (region(t)[1] or t + 1) - 1 for h, t in highest.items()}

    def switch_host(hosts, target, mode):
        """La fonction d'aiguillage d'où part ce code, si la cible est dans son étendue sans ouvrir de cadre : un
        morceau d'elle (nim 0x1071aa, atteint par un bl depuis une case), pas une fonction."""
        inner = [h for h in hosts if h <= target <= extent.get(h, -1) and modes[h] == mode]
        return inner[0] if inner and not opens_frame(binary.image, target, mode) else None

    def note(target, mode, kind, origin):
        target = virtual(binary, target)
        if target in binary.starts or target in found or not binary.image.in_code(target) or mode == 'arm' and target & 3:
            return
        hosts = covering(target)
        if target in cases and mode == 'thumb' and not kind.startswith(PIECE):
            site, host = cases[target]
            kind, origin = PIECE + '%#x' % host, "case de l'aiguillage à %#x" % site
        # Un veneer ARM visé par un b ou un bl peut être dans la taille d'une fonction Thumb de Ghidra, qui avale sa
        # réserve et le veneer qui suit (ro 0x14000110, après FUN_140000c0, visé par le b de 0x14002218).
        veneer = mode == 'arm' and kind.startswith(('cible de b', 'appel hors fonction')) \
            and veneer_body(binary.image, target) is not None
        if any(modes[h] != mode for h in hosts) and not veneer:
            return                      # du Thumb lu en ARM (ou l'inverse) : un mot de données, pas un pointeur de code
        if mode == 'arm' and veneer_body(binary.image, target) is not None and not kind.startswith(PIECE):
            kind = 'veneer'
        elif not kind.startswith(('cible de bl', 'corps de veneer', PIECE)) and not (
                mode == 'arm' and kind == 'cible de b (appel terminal)' and not hosts) and (
                not at_boundary(binary, target, mode, pools) or mode == 'thumb' and looks_arm(binary.image, target)):
            rejected.append((target, mode, kind, origin))   # rejugé quand d'autres réserves seront connues
            return                      # un saut ou un pointeur seul : il faut qu'il tombe à une frontière de code
        within = [a for a in hosts if not kind.startswith(PIECE)]
        found[target] = (mode, kind + (', au milieu de %#x' % within[0] if within else ''), origin)
        todo.append((target, None, mode))

    first = fingerprints(binary)        # le premier tour, gardé : il donne aussi les mots de réserve
    pools = {word for pr in first.values() for word in pr.pool}
    for target in sorted(cases):        # lues pour leurs appels : Ghidra ne suit pas le « add pc »
        note(target, 'thumb', 'case', '')
    for start, _, mode in binary.functions:
        body = veneer_body(binary.image, start) if mode == 'arm' else None
        if body is not None:
            note(body, 'thumb', 'corps de veneer', '%#x' % start)
    # Les réglages de la cible brute (raw_targets.toml) : sans eux, le bourrage 0xFFFFFFFF de kernel11 se lit comme
    # une table de distances (-1), et chaque case comme une fonction Thumb (1 230 fausses entrées).
    target = binary.target or {'pointer_sources': 'all', 'thumb_pointers': True, 'relative_tables': True}
    seeds, candidates = ghidra_direct.find_pointers(
        binary.image, binary.image.code_ranges if target['pointer_sources'] == 'code' else None,
        target['thumb_pointers'], target['relative_tables'])
    for target, mode, origin, _ in [(t, m, 'push Thumb', '') for t, m in seeds] + candidates:
        word = int(origin.split()[-1], 16) if origin.startswith('pointeur à ') else None
        if word is None or not inside(word, target):
            note(target, mode, 'pointeur seul', origin)
    # Les tables de distances des données recopiées au démarrage, lues à l'adresse de la copie : une image où ces
    # octets sont aussi à cette adresse. Seules les tables : les pointeurs absolus sont déjà lus dans le fichier.
    for source, copy, size in binary.copies:
        alias = ghidra_direct.Image(binary.image.data, binary.image.segments + [
            (copy, binary.image.offset(source), size, size, 0)], binary.image.code_ranges)
        for target, mode, origin, group in ghidra_direct.find_pointers(alias, [(copy, copy + size)])[1]:
            if group != '-':
                note(target, mode, 'pointeur seul', '%s (copie de %#x)' % (origin, source))

    def scan_outside():
        """Le code que Ghidra n'a mis dans aucune fonction : ses b et bl, lus mot à mot (ARM seulement). Un saut qui
        reste entre les deux mêmes débuts connus (une entrée trouvée et la suivante) est interne à cette entrée."""
        known = sorted(set(binary.starts) | set(found))
        for low, high in binary.image.code_ranges:
            for at in range(low, high - 3, 4):
                word = binary.image.word(at)
                if word is None or word & 0x0E000000 != 0x0A000000 or word >> 28 == 0xF or at in pools \
                        or at in binary.jump_slots or covering(at) or not looks_arm(binary.image, at):
                    continue
                target = virtual(binary, at + 8 + (sext(word & 0xFFFFFF, 24) << 2))
                if bisect.bisect_right(known, at) == bisect.bisect_right(known, target) and known and known[0] <= at:
                    continue
                kind = 'appel hors fonction' if word & 0x01000000 else 'cible de b hors fonction'
                note(target, 'arm', kind, 'code hors fonction à %#x' % at)

    work = list(binary.functions)
    while work:
        known = sorted(set(binary.starts) | set(found))
        following = dict(zip(known, known[1:]))
        for start, size, mode in work:
            end = code_end(binary, start)
            if end is None:
                continue
            limit = min(end, following.get(start, end))
            pr = first.pop(start, None) or fingerprint(binary, start, mode, size, limit)
            pools.update(pr.pool)
            # Les fonctions de Ghidra d'où part ce code : elle-même, celle qui la couvre (entrée au milieu), ou celle
            # dont c'est un morceau. Un saut qui reste chez elles est interne, sauf vers un « push {..., lr} ».
            hosts = set(covering(start)) | ({start} if start not in found else set())
            if start in found and found[start][1].startswith(PIECE):
                hosts.add(int(found[start][1][len(PIECE):], 16))
            for target in pr.calls:
                target, called = target & ~1, 'thumb' if target & 1 else 'arm'
                host = switch_host(hosts, target, called)
                note(target, called, PIECE + '%#x' % host if host else 'cible de bl', '%#x' % start)
            for target in pr.jumps:
                if start <= target < limit:
                    continue
                host = switch_host(hosts, target, mode)
                if host:
                    note(target, mode, PIECE + '%#x' % host, '%#x' % start)
                    continue
                covered = [h for h in hosts if h in covering(target)]
                near = any(region(h)[0] == h and h <= target < (region(h)[1] or target + 1) for h in hosts)
                if (covered or near) and opens_frame(binary.image, target, mode):
                    note(target, mode, 'cible de b (appel terminal)', '%#x' % start)
                elif covered and not near:
                    note(target, mode, PIECE + '%#x' % covered[0], '%#x' % start)
                elif not covered and not near:
                    note(target, mode, 'cible de b (appel terminal)', '%#x' % start)
            for word in pr.pool:
                value = binary.image.word(word)
                if value is not None and not inside(word, value & ~1):
                    note(value & ~1, 'thumb' if value & 1 else 'arm', 'pointeur de réserve', 'réserve à %#x' % word)
            for value in pr.computed:
                if not inside(start, value & ~1):
                    note(value & ~1, 'thumb' if value & 1 else 'arm', 'adresse calculée', '%#x' % start)
            body = veneer_body(binary.image, start) if start in found and mode == 'arm' else None
            if body is not None:
                note(body, 'thumb', 'corps de veneer', '%#x' % start)
        retry, rejected[:] = list(rejected), []
        for item in retry:
            note(*item)
        work, todo[:] = list(todo), []
        if not work:
            scan_outside()
            work, todo[:] = list(todo), []
    return found


def virtual(binary, address):
    """L'adresse virtuelle d'une adresse physique d'un morceau du noyau (carte [<cible>.firm] de raw_targets.toml) :
    le code de lancement d'un FIRM de kernel11 est atteint par son alias 0x1FFF4AC4 (veneer 0xFFF16EC4)."""
    for _, va, _, size, _, _, pa in ((binary.target or {}).get('firm') or {}).get('pieces', []):
        if pa is not None and pa != va and pa <= address < pa + size:
            return va + address - pa
    return address


def overruns(binary, entries):
    """Les fonctions de Ghidra dont la taille déborde sur l'entrée suivante : [(début, taille de Ghidra, taille coupée)]."""
    known = sorted(set(binary.starts) | set(entries))
    following = dict(zip(known, known[1:]))
    return [(a, s, following[a] - a) for a, s, _ in binary.functions
            if s and a in following and a + s > following[a] and a not in entries]


def add_entries(binary):
    """Trouve les entrées manquées et les ajoute aux fonctions du binaire (taille inconnue) : elles reçoivent une
    empreinte, des noms, et coupent les tailles de Ghidra qui débordent. Les morceaux n'en sont pas."""
    found = find_entries(binary)
    binary.pieces = {a: v for a, v in found.items() if v[1].startswith(PIECE)}
    binary.entries = {a: v for a, v in found.items() if a not in binary.pieces}
    binary.functions = sorted(binary.functions + [(a, None, m) for a, (m, _, _) in binary.entries.items()])
    binary.starts |= set(binary.entries)
    return binary.entries


def print_entries(binary):
    entries = binary.entries
    print('%s : %d fonctions de Ghidra, %d entrées manquées' % (binary.name, len(binary.functions) - len(entries),
                                                                 len(entries)))
    for address, (mode, kind, origin) in sorted(entries.items()) + sorted(binary.pieces.items()):
        print('   %#10x  %-5s %-55s depuis %-22s %s' % (address - binary.base, mode, kind, origin,
                                                        binary.name_at(address) or ''))
    cut = overruns(binary, entries)
    if cut:
        print('Tailles de Ghidra qui débordent sur une entrée (coupées pour l\'empreinte) :')
        print('\n'.join('   %#10x  %d octets -> %d' % (a - binary.base, s, c) for a, s, c in cut))
    split = sorted((a, site) for a, site in thumb_cases(binary).items() if a in binary.starts and a not in entries)
    if split:
        print('Fonctions de Ghidra qui sont des cases d\'aiguillage (des morceaux, pas des fonctions) :')
        print('\n'.join('   %#10x  case de l\'aiguillage à %#x  %s' % (a - binary.base, site, binary.name_at(a) or '')
                        for a, site in split))


# --- Les grappes et les propositions ---

def usable(name):
    return name is not None and not GENERIC_NAME.search(name)


def make_proposal(binary, address, name, source, confidence, proof, mode, rule=''):
    p = name_pass.Proposal(address - binary.base, binary.prefix + name, source, confidence, proof,
                           module=binary.name if binary.prefix else '', thumb=mode == 'thumb')
    p.binary = binary
    p.rule = rule
    return p


# --- Le jugement d'un nom : « deux voies indépendantes » ou un nom qui se prouve seul ---

# Un nom de la bibliothèque C ou de l'exécution du compilateur : la fonction est la même partout où le code l'est.
RUNTIME_NAME = re.compile(r'^(?:_Z|__aeabi_|__cxa_|__cxx|__rw_|__ARM_|__rt_|__gnu_)')
# memcpy, memmove et memset (MEM_FAMILY) n'y sont pas : armcc a aussi __aeabi_memcpy, qui rend dest + n au lieu de
# dest, avec un
# code presque pareil ; c'est la règle (a) qui les nomme.
MEM_FAMILY = {'memcpy', 'memmove', 'memset'}
LIBC_NAMES = set('memcmp memchr strlen strnlen strcpy strncpy strcat strncat strcmp strncmp strchr '
                 'strrchr strstr strspn strcspn strpbrk strtok strtol strtoul strtoll strtoull strtod atoi atol wcslen '
                 'wcscpy wcscmp wcsncmp wcsncpy sprintf snprintf vsprintf vsnprintf printf abs labs qsort bsearch rand srand '
                 'malloc free calloc realloc tolower toupper setjmp longjmp sqrt sqrtf sin sinf cos cosf tan tanf atan atanf '
                 'atan2 atan2f exp expf log logf pow powf floor floorf ceil ceilf fmod fmodf'.split())
# Les mots de nom qui désignent un service : le code identique peut viser un autre service (handle global masqué).
SERVICE_WORDS = set('ac acu aci act am apt boss cam cdc cecd cfg csnd dlp dsp frd fs gsp gx hid http i2c ir ldr mcu mic mp '
                    'mvd ndm news nfc nim nwm ns pdn pm ps ptm pxi qtm soc socket ssl tst uds y2r'.split())
# Ouvrir, fermer, initialiser une session : quelle session, le code ne le dit pas.
SESSION_VERBS = {'open', 'close', 'exit', 'init', 'connect'}
SESSION_OBJECTS = SERVICE_WORDS | {'srv', 'session', 'sessions', 'handle', 'handles'}


def name_words(name):
    """Les mots d'un nom : coupés aux « _ », puis aux majuscules (CloseSession), en minuscules."""
    out = []
    for part in name.split('_'):
        out += [w.lower() for w in re.findall(r'[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+', part)] if part[:1].isupper() else [part.lower()]
    return [w for w in out if w]


def self_proving(name):
    return bool(RUNTIME_NAME.match(name)) or name in LIBC_NAMES


def service_words(name):
    """Les mots de service d'un nom, délimités par « _ » (srv_, errf_ et svc* n'en sont pas ; « ns » en dernier mot non plus)."""
    if name.startswith('svc'):
        return set()
    parts = [p.lower() for p in name.split('_') if p]
    if parts and parts[-1] == 'ns':
        parts.pop()
    return {p for p in parts if p in SERVICE_WORDS}


def cites_service(strings, word):
    """Une chaîne « xxx:yyy » de la réserve qui nomme ce service (« cfg:s » pour cfg, « nwm::UDS » pour uds, « ac:u » pour acu)."""
    for text in strings:
        parts = [p for p in re.split(rb':+', text.rstrip(b'\0').lower()) if p]
        if len(parts) > 1 and (word.encode() in parts or word.encode() == b''.join(parts)):
            return True
    return False


SVC_NAMES = {}


def is_pure_svc(binary, address, name):
    """svc<Nom> sur une fonction ARM qui n'est que cet appel système, du bon numéro : name_pass.decode_svc et
    is_pure_svc_wrapper sur ses octets, la table des numéros de la Carte des services (name_pass.svc_names)."""
    m = re.match(r'svc([A-Z]\w*)$', name)
    size = next((s for a, s, _ in binary.functions if a == address), None)
    if not m or not size or binary.image is None:
        return False
    if not SVC_NAMES:
        SVC_NAMES.update(name_pass.svc_names())
    mode = next(md for a, _, md in binary.functions if a == address)
    game = types.SimpleNamespace(code=binary.image.read(address, size) or b'', funcs={name_pass.BASE: (size, mode, '')})
    numbers, _ = name_pass.decode_svc(game, name_pass.BASE)
    return len(numbers) == 1 and SVC_NAMES.get(numbers[0]) == m.group(1) and name_pass.is_pure_svc_wrapper(game, name_pass.BASE)


def svc_rule(binary, address, name):
    """Un svc<Nom> n'est haute que par ses octets (is_pure_svc), jamais par ses origines ; None pour un autre nom."""
    if not re.match(r'svc[A-Z]', name):
        return None
    if is_pure_svc(binary, address, name):
        return 'haute', 'b:svc'
    return 'moyenne', 'svc<Nom> : haute seulement par les octets (enrobage pur, bon numéro)'


ALT_SUFFIX = re.compile(r'_alt(?:_[0-9a-f]+|_entry)?$')
# Un nom qui désigne un objet ou un service (IRUSER_Disconnect, gsp_lcd_get_session_handle) : la globale ou la poignée
# qu'il vise est masquée dans l'empreinte, et le même code vise ailleurs autre chose (menu 0x163b18 envoie sur ns:s).
ROLE_WORDS = {'session', 'sessions', 'handle', 'handles'}


def role_name(name):
    return bool(re.match(r'[A-Z][A-Z0-9]+_', name)) or bool(ROLE_WORDS & set(name_words(name)))


def callee_keys(binary, own, address):
    """Les appelées d'une fonction dans l'ordre (bl, blx, puis b vers un autre début de fonction), à travers les veneers
    ARM vers Thumb : (nom versé sans « _alt_… » ou None, empreinte). own : les Print du binaire. L'empreinte masque les cibles : deux shared_memory_dtor de même code appellent l'un
    unmap_shared_memory_or_panic, l'autre unmap_shared_memory (local/analyse/audit-alt/notes.md)."""
    pr = own[address]
    out = []
    for target in [c & ~1 for c in pr.calls] + [j for j in pr.jumps if j in binary.starts and j != address]:
        name = binary.name_at(target)
        body = veneer_body(binary.image, target) if name is None and binary.image is not None else None
        if body is not None:
            target, name = body, binary.name_at(body)
        name = ALT_SUFFIX.sub('', name) if name else None
        out.append((name if usable(name) else None, own[target].digest if target in own else None))
    return out


def same_callees(mine, theirs, strict=True):
    """Mêmes appelées (callee_keys) : même nom versé, ou sans nom des deux côtés et même empreinte. Non strict
    (pour « revoir » seulement) : une appelée nommée d'un côté seulement suffit à la même empreinte."""
    return len(mine) == len(theirs) and all(
        n1 == n2 and (n1 is not None or d1 == d2) if strict or (n1 and n2) else d1 == d2
        for (n1, d1), (n2, d2) in zip(mine, theirs))


def sends_ipc(binary, own, address):
    """Un envoi IPC dans la fonction ou dans une appelée de quatre instructions au plus, veneer traversé (lecture du
    tampon de commande, talon « svc 0x32 ; bx lr » : snote_ap 0x13da98) : le service visé dépend d'un handle global,
    masqué dans l'empreinte."""
    def tiny_ipc(target):
        target &= ~1
        body = veneer_body(binary.image, target) if binary.image is not None else None
        target = target if body is None else body
        return target in own and own[target].ipc and own[target].count <= 4
    return own[address].ipc or any(tiny_ipc(t) for t in own[address].calls)


def blind_spot(name, ipc):
    """Ce que l'empreinte ne voit pas et qui interdit la confiance haute (sauf un svc<Nom> prouvé par ses octets)."""
    if ipc:
        return 'basse', 'envoi IPC : le service dépend d\'un handle masqué'
    if role_name(name):
        return 'moyenne', 'nom de rôle (préfixe de service, session, handle) : jamais haute par empreinte'
    return None


def twin_grade(binary, address, name, ipc=False):
    """La confiance d'un nom de jumeau : haute, sauf un svc<Nom> que ses octets ne prouvent pas, un envoi IPC ou un nom
    de rôle (blind_spot) et la famille de memcpy (le nom du module normal peut être celui de __aeabi_memcpy)."""
    judged = svc_rule(binary, address, name)
    if judged:
        return ('haute', 'jumeau') if judged[0] == 'haute' else judged
    if name in MEM_FAMILY:
        return 'moyenne', 'memcpy, memmove, memset : peut-être __aeabi_memcpy, qui rend dest + n'
    return blind_spot(name, ipc) or ('haute', 'jumeau')


def grade(binary, address, print_, name, origins, ipc, min_high):
    """(confiance, règle ou raison du plafond) d'un nom pour une fonction sans nom. Haute seulement par deux voies :
    (a) au moins deux binaires d'origine portent ce nom sur ce code, ou (b) le nom se prouve seul (symbole C++ manglé,
    bibliothèque C ou exécution du compilateur, enrobage svc vérifié sur les octets)."""
    judged = svc_rule(binary, address, name)
    if judged:
        return judged
    if ipc:
        return blind_spot(name, ipc)
    if print_.count < min_high:
        return 'moyenne', 'moins de %d instructions' % min_high
    rule = 'b:nom' if self_proving(name) else 'a' if len(origins) >= 2 else ''
    if not rule:
        return 'moyenne', ('une seule origine (%s)' % origins[0] if origins else
                           'aucune origine indépendante (noms propagés, fiches/noms-propages.tsv)')
    if rule == 'a':
        words = name_words(name)
        if SESSION_VERBS & set(words) and SESSION_OBJECTS & set(words):
            return 'moyenne', 'ouverture ou fermeture de session : laquelle, le code ne le dit pas'
        missing = sorted(w for w in service_words(name) if not cites_service(print_.strings, w))
        if missing:
            return 'moyenne', 'service %s : aucune chaîne « %s:… » dans la fonction' % ('/'.join(missing), missing[0])
        if any(name.startswith(o + '_') for o in origins if o != binary.name):
            return 'moyenne', 'nom propre au binaire d\'origine'
    return blind_spot(name, False) or ('haute', rule if rule != 'a' else 'a (%s)' % ', '.join(origins[:4]))


def rule_kind(rule):
    """La règle sans ses détails, pour le compte : « a », « b:svc », « service », « une seule origine »..."""
    head = rule.split(' (')[0].split(' :')[0]
    return 'service' if head.startswith('service ') else re.sub(r'\d+', 'N', head)


CONFIDENCE_RANK = {'basse': 1, 'moyenne': 2, 'haute': 3}
PROPOSALS_HEADER = ('binaire', 'adresse', 'nom', 'source', 'confiance', 'règle', 'preuve')


def family(name):
    """Un module et sa variante « -safe » : le même code source, une seule origine pour la règle (a)."""
    return name[:-len(SAFE)] if name.endswith(SAFE) else name


def twins(binaries, prints, excluded=frozenset(), disputed=frozenset()):
    """La règle « jumeau » : [(variante, adresse, nom, module, adresse dans le module)]. Les fonctions du module et de
    sa variante « -safe », chacune dans l'ordre des adresses, sont alignées sur leurs empreintes (la plus longue suite
    commune, difflib) ; une fonction sans nom de la variante qui a l'empreinte d'une fonction nommée du module ET la
    même place dans l'alignement en prend le nom. Pas si l'une des deux adresses est refusée par la relecture, ni si la
    fonction du module n'est pas un témoin : moins de MIN_WITNESS instructions, ou une grappe qui porte plusieurs noms
    dans les fiches (`disputed` : le constructeur statique « range 0 dans une globale » de quatre instructions est à
    77 adresses sous autant de noms)."""
    by_name = {b.name: b for b in binaries}
    out = []
    for safe in binaries:
        normal = by_name.get(family(safe.name)) if safe.name.endswith(SAFE) else None
        if normal is None or safe.name not in prints or normal.name not in prints:
            continue
        left, right = sorted(prints[normal.name]), sorted(prints[safe.name])
        left_digests = [prints[normal.name][a].digest for a in left]
        right_digests = [prints[safe.name][a].digest for a in right]
        # Un code présent deux fois dans un module (deux enrobages de commandes pareils) rend la place ambiguë : quand
        # la variante perd des commandes (http-safe, huit de moins), l'alignement pourrait donner le nom du voisin.
        once = {d for d, n in collections.Counter(left_digests + right_digests).items() if n == 2}
        matcher = difflib.SequenceMatcher(None, left_digests, right_digests, autojunk=False)
        for i, j, size in matcher.get_matching_blocks():
            for k in range(size):
                here, there = left[i + k], right[j + k]
                if left_digests[i + k] not in once or prints[normal.name][here].count < MIN_WITNESS \
                        or (normal.name, here) in disputed:
                    continue
                name = normal.name_at(here)
                refused = (normal.name, here - normal.base) in excluded or (safe.name, there - safe.base) in excluded
                if usable(name) and safe.name_at(there) is None and not refused:
                    out.append((safe, there, name, normal, here))
    return out


def propose(binaries, prints, min_high=MIN_HIGH, min_low=MIN_LOW, propagated=frozenset(), excluded=frozenset()):
    """Rend (propositions, conflits [(empreinte, instructions, [(binaire, adresse, nom)])], compte). propagated : les
    (binaire, adresse de fiche, nom de fiche) de fiches/noms-propages.tsv, qui ne comptent pas comme origine ;
    excluded : les (binaire, adresse de fiche) refusées par la relecture (exclusions*.tsv), pour les jumeaux."""

    def independent(witnesses):
        """Les origines des témoins [(binaire, adresse, nom)], sans les noms qu'apply a propagés ; un module et sa
        variante « -safe » comptent pour un."""
        return sorted({family(b.name) for b, a, n in witnesses if (b.name, a - b.base) not in propagated})

    modes = {(b.name, a): m for b in binaries for a, _, m in b.functions}
    clusters = collections.defaultdict(list)
    for b in binaries:
        own = prints.get(b.name, {})
        for address, pr in own.items():
            # La clé de grappe ajoute l'empreinte de chaque appelée (« bl ») puis de chaque fonction visée par un « b »
            # (appel terminal), dans l'ordre : deux enrobages qui ne diffèrent que par la fonction appelée
            # (svcCloseHandle ou lock_leave) ne se confondent pas.
            callees = tuple(own[t & ~1].digest if t & ~1 in own else '?' for t in pr.calls)
            tails = tuple(own[t].digest for t in pr.jumps if t in own and t != address)
            key = pr.digest if not callees + tails else \
                hashlib.blake2b(repr((pr.digest, callees, tails)).encode(), digest_size=12).hexdigest()
            clusters[key].append((b, address))
    proposals, conflicts, stats, seen = [], [], collections.Counter(), {}
    # Les fonctions dont la grappe porte deux noms : la voie des appelées ne les nomme pas, et elles ne sont pas des
    # témoins pour les jumeaux.
    disputed = set()
    for members in clusters.values():
        if len({b.name_at(a) for b, a in members if usable(b.name_at(a))}) > 1:
            disputed.update((b.name, a) for b, a in members)

    def add(binary, address, name, source, witnesses, proof, twin=False):
        """Une proposition jugée ; la même (binaire, adresse, nom) venue par deux chemins garde la confiance la plus
        haute. witnesses : les (binaire, adresse, nom) qui donnent le nom ; seuls ceux dont les appelées portent les
        mêmes noms versés (callee_keys) comptent, et sans aucun, pas de haute."""
        own = prints[binary.name]
        mine = callee_keys(binary, own, address)
        agree = [w for w in witnesses if same_callees(mine, callee_keys(w[0], prints[w[0].name], w[1]))]
        ipc = sends_ipc(binary, own, address)
        if twin:
            confidence, rule = twin_grade(binary, address, name, ipc)
        else:
            confidence, rule = grade(binary, address, own[address], name, independent(agree or witnesses), ipc, min_high)
        if confidence == 'haute' and not agree:
            w = witnesses[0]
            confidence, rule = 'moyenne', 'appelées : pas les mêmes noms versés que chez %s@%#x' % (w[0].name,
                                                                                                    w[1] - w[0].base)
        p = make_proposal(binary, address, name, source, confidence, proof, modes[(binary.name, address)], rule)
        key = (binary.name, address, name)
        if key not in seen:
            seen[key] = len(proposals)
            proposals.append(p)
        elif CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[proposals[seen[key]].confidence]:
            proposals[seen[key]] = p

    for digest, members in clusters.items():
        if len(members) < 2:
            continue
        stats['grappes'] += 1
        if len({b.name for b, _ in members}) > 1:
            stats['grappes sur plusieurs binaires'] += 1
        count = prints[members[0][0].name][members[0][1]].count
        named = [(b, a, b.name_at(a)) for b, a in members if b.name_at(a) is not None]
        unnamed = [(b, a) for b, a in members if b.name_at(a) is None]
        good = [(b, a, n) for b, a, n in named if usable(n)]
        if good and unnamed:
            names = sorted({n for _, _, n in good})
            if len(names) > 1:
                conflicts.append((digest, count, named))
                stats['grappes en désaccord'] += 1
            elif count < max(min_low, MIN_WITNESS):
                stats['grappes trop petites (copies sans nom)'] += len(unnamed)
            else:
                name = names[0]
                origins = sorted({b.name for b, _, _ in good})
                witnesses = ', '.join('%s@%#x' % (b.name, a - b.base) for b, a, _ in good[:3])
                for b, a in unnamed:
                    add(b, a, name, 'empreinte:' + origins[0], good,
                        'empreinte %s identique (%d instructions, %s) à %s « %s » ; grappe de %d copies dans %d binaires'
                        % (digest, count, modes[(b.name, a)], witnesses, name, len(members),
                           len({m.name for m, _ in members})))
        if count < min_high:
            continue
        # Un niveau plus loin : les appelées au même rang dans des copies identiques (leur code est le même : il est
        # dans la clé de grappe).
        calls = [(b, a, prints[b.name][a].calls) for b, a in members]
        for rank in range(len(calls[0][2])):
            callees = []
            for b, a, targets in calls:
                target = targets[rank] & ~1
                if target in b.starts and (b.name, target) not in disputed:
                    callees.append((b, a, target))
            known = [(b, a, t, b.name_at(t)) for b, a, t in callees if usable(b.name_at(t))
                     and t in prints[b.name] and prints[b.name][t].count >= MIN_WITNESS]
            names = {n for _, _, _, n in known}
            if len(names) != 1:
                continue
            name = names.pop()
            origins = sorted({b.name for b, _, _, _ in known})
            witness = known[0]
            for b, a, t in callees:
                if b.name_at(t) is None:
                    add(b, t, name, 'appel:' + origins[0], [(kb, kt, kn) for kb, _, kt, kn in known],
                        'appelée au rang %d par %s@%#x, dont l\'empreinte %s (%d instructions) est celle de %s@%#x, qui '
                        'appelle à ce rang %s@%#x « %s »' % (rank, b.name, a - b.base, digest, count, witness[0].name,
                                                             witness[1] - witness[0].base, witness[0].name,
                                                             witness[2] - witness[0].base, name))
    for safe, there, name, normal, here in twins(binaries, prints, excluded, disputed):
        add(safe, there, name, 'jumeau:' + normal.name, [(normal, here, name)],
            'jumeau : empreinte %s identique (%d instructions) à %s@%#x « %s », à la même place dans l\'alignement des '
            'fonctions de %s et %s' % (prints[safe.name][there].digest, prints[safe.name][there].count, normal.name,
                                       here - normal.base, name, normal.name, safe.name),
            twin=True)
        stats['jumeaux'] += 1
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


def load_prints():
    binaries = load_all()
    return binaries, {b.name: fingerprints(b) for b in binaries if b.image is not None}


def run(min_high=MIN_HIGH, min_low=MIN_LOW, out_dir=OUT):
    binaries, prints = load_prints()
    print('%d binaires, %d avec leurs octets, %d fonctions empreintes' % (
        len(binaries), len(prints), sum(len(v) for v in prints.values())), flush=True)
    proposals, conflicts, stats = propose(binaries, prints, min_high, min_low, read_propagated(), read_excluded())
    kept, dropped = reconcile_all(binaries, proposals)
    os.makedirs(out_dir, exist_ok=True)
    name_pass.write_tsv(os.path.join(out_dir, 'proposals.tsv'),
                        [PROPOSALS_HEADER] +
                        [(p.binary.name, '%#x' % p.address, p.name, p.source, p.confidence, p.rule, p.proof) for p in kept])
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
    lines += ['', 'Pourquoi haute (a : deux binaires d\'origine ; b : nom qui se prouve seul) ou pourquoi pas :']
    rules = collections.Counter((p.confidence, rule_kind(p.rule)) for p in kept)
    lines += ['   %-8s %-70s %6d' % (c, r, n) for (c, r), n in sorted(rules.items())]
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


def review(binaries, prints, provenance=PROVENANCE):
    """Les noms qu'apply a versés (fiches/noms-propages.tsv), encore dans leur fiche, que les règles d'aujourd'hui ne
    verseraient plus : [(fiche, adresse, nom, raison, origine)]. Raisons : envoi IPC, nom de rôle, ou aucune autre
    fonction de même empreinte et de même nom n'a les mêmes appelées (same_callees), en distinguant des noms qui
    diffèrent d'une appelée nommée d'un côté seulement (même code : souvent une appelée de la variante « -safe » que
    rien n'a encore nommée)."""
    def shown(keys):
        return ', '.join(n or '?' + (d or '')[:6] for n, d in keys) or '-'

    by_name = {b.name: b for b in binaries}
    named = collections.defaultdict(list)
    for b in binaries:
        for address, pr in prints.get(b.name, {}).items():
            if usable(b.name_at(address)):
                named[(pr.digest, b.name_at(address))].append((b, address))
    out = []
    for row in read_rows(provenance):
        b = by_name.get(row[0])
        entry = b.names.get(int(row[1], 16)) if b else None
        if entry is None or entry[1] != row[2] or b.name not in prints:
            continue                    # renommé ou retiré depuis : relu
        address = b.base + int(row[1], 16)
        own, name = prints[b.name], b.name_at(address)
        if address not in own:
            out.append((b, row, 'plus un début de fonction empreinte'))
            continue
        spot = blind_spot(name, sends_ipc(b, own, address))
        reasons = [spot[1]] if spot else []
        others = [w for w in named[(own[address].digest, name)] if w != (b, address)]
        mine = callee_keys(b, own, address)
        if not others:
            reasons.append('aucune autre fonction de même empreinte et de même nom')
        else:
            theirs = [(w, a, callee_keys(w, prints[w.name], a)) for w, a in others]
            if not any(same_callees(mine, k) for _, _, k in theirs):
                loose = [t for t in theirs if same_callees(mine, t[2], strict=False)]
                w, a, k = (loose or theirs)[0]
                reasons.append('appelées %s %s ; chez %s@%#x : %s' % (
                    "nommées d'un côté seulement (même code) :" if loose else 'de noms ou de code différents :',
                    shown(mine), w.name, a - w.base, shown(k)))
        if reasons:
            out.append((b, row, ' ; '.join(reasons)))
    return [(fiche_stem(b.names_path), row[1], row[2], why, row[3]) for b, row, why in out]


def read_rows(path):
    """Les lignes d'un .tsv à en-tête, sans l'en-tête ni les lignes vides ou commentées."""
    if not os.path.isfile(path):
        return []
    lines = [line.rstrip('\r\n') for line in open(path, encoding='utf-8')][1:]
    return [line.split('\t') for line in lines if line and not line.startswith('#')]


def read_excluded(folder=OUT):
    """{(binaire, adresse)} de toutes les exclusions relues (local/analyse/names-croises/exclusions*.tsv)."""
    return {(r[0], int(r[1], 16)) for path in glob.glob(os.path.join(folder, 'exclusions*.tsv'))
            for r in read_rows(path) if len(r) > 1 and r[1].startswith('0x')}


def read_propagated(path=PROVENANCE):
    """{(binaire, adresse de fiche)} des noms qu'apply a versés : un nom renommé depuis reste propagé, il ne devient
    pas une origine indépendante."""
    return {(r[0], int(r[1], 16)) for r in read_rows(path) if len(r) > 2 and r[1].startswith('0x')}


def record_propagated(rows, path=PROVENANCE):
    """Ajoute (binaire, adresse, nom, origine) à fiches/noms-propages.tsv, créé avec son en-tête s'il manque."""
    new = not os.path.isfile(path)
    today = datetime.date.today().isoformat()
    with open(path, 'a', encoding='utf-8') as f:
        if new:
            f.write('\n'.join(PROVENANCE_HEADER) + '\n')
        f.write(''.join('\t'.join(row + (today,)) + '\n' for row in rows))


def apply(source=PROPOSALS, exclusions=EXCLUSIONS, binaries=None, provenance=PROVENANCE):
    """Verse les noms de confiance haute d'un fichier de propositions RELU (sans refaire le calcul) dans la fiche de noms
    de chaque binaire, sauf ceux d'exclusions.tsv (binaire, adresse, raison). Les collisions sont revérifiées contre les
    fiches du moment (name_pass.reconcile). Un binaire sans fiche de noms n'en reçoit pas une (les variantes « -safe »
    ont la leur, remplie par les jumeaux). Chaque nom versé est noté dans fiches/noms-propages.tsv."""
    binaries = binaries or load_all(cro_images=False)
    by_name = {b.name: b for b in binaries}
    # Toutes les exclusions relues du dossier, pas seulement le fichier donné : un fichier oublié ferait verser des
    # noms que la relecture a refusés.
    excluded = read_excluded(os.path.dirname(exclusions))
    proposals, skipped = [], collections.Counter()
    for binary, address, name, origin, confidence, rule, proof in (r[:7] for r in read_rows(source)):
        b, address = by_name.get(binary), int(address, 16)
        if confidence != 'haute':
            continue
        if (binary, address) in excluded:
            skipped['exclue (%s)' % os.path.basename(exclusions)] += 1
            continue
        mode = next((m for a, _, m in b.functions if a == b.base + address), None) if b else None
        if mode is None:
            skipped['binaire inconnu ou adresse qui n\'est plus un début de fonction'] += 1
            continue
        p = name_pass.Proposal(address, name, origin, confidence, proof, module=b.name if b.prefix else '',
                               thumb=mode == 'thumb')
        p.binary, p.rule = b, rule
        proposals.append(p)
    kept, dropped = reconcile_all(binaries, proposals)
    for p, why in dropped:
        skipped['collision : ' + re.sub(r'«.*?»|\S*0x[0-9a-f]+', '…', why)] += 1
    by_path = collections.defaultdict(list)
    for p in kept:
        by_path[p.binary.names_path].append(name_pass.fiche_line(p))
    for why, n in sorted(skipped.items()):
        print('   écartées, %s : %d' % (why, n))
    for path, items in sorted(by_path.items()):
        if not os.path.isfile(path):
            print('   %-50s pas de fiche de noms : %d noms laissés en proposition' % (os.path.relpath(path, ROOT), len(items)))
            del by_path[path]
            continue
        name_pass.merge_lines(path, items, name_pass.is_sorted(path))
        print('   %-50s +%d' % (os.path.relpath(path, ROOT), len(items)))
    written = [(p.binary.name, '%#x' % p.address, p.name, '%s ; %s' % (p.source, p.rule))
               for p in kept if p.binary.names_path in by_path]
    if written:
        record_propagated(written, provenance)
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
    path = PROPOSALS
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


def read_proposed(binary):
    """{adresse de fiche: confiance} des noms proposés et pas encore versés : local/analyse/<binaire>/noms-proposes.tsv
    (adresse, genre, nom, confiance, preuve), puis les propositions d'ici (names-croises/proposals.tsv)."""
    out = {}
    for row in read_rows(os.path.join(ANALYSE, binary.name, 'noms-proposes.tsv')):
        if len(row) > 3 and row[0].startswith('0x') and row[2]:
            out.setdefault(int(row[0], 16), row[3])
    for row in read_rows(PROPOSALS):
        if row[0] == binary.name:
            out.setdefault(int(row[1], 16), row[4])
    return out


def read_hand_entries(name):
    """{adresse} des entrées trouvées à la main par un lot de reverse : lignes « ABSENTE de funcs.tsv » de
    local/analyse/<binaire>/noms-proposes*.tsv. Elles comptent au dénominateur même quand leur nom n'est que moyen."""
    return {int(r[0], 16) for path in glob.glob(os.path.join(ANALYSE, name, 'noms-proposes*.tsv')) for r in read_rows(path)
            if len(r) > 4 and r[0].startswith('0x') and r[1] in ('function', 'label') and r[4].startswith('ABSENTE')}


def read_outside(name):
    """{adresse} de fiches/<binaire>.hors-compte.tsv (adresse, raison) : versionné, puisque le compteur en dépend."""
    return {int(r[0], 16) for r in read_rows(os.path.join(FICHES, name + '.hors-compte.tsv')) if r[0].startswith('0x')}


def measure_binary(binary, sources, cited, recompiled, proposed=None, outside=frozenset(), hand=frozenset()):
    """Une ligne du compteur. Les adresses sont celles de la fiche. Le dénominateur : fonctions de Ghidra, entrées
    manquées trouvées (add_entries), et lignes « function » de la fiche de noms qui ne sont ni l'une ni l'autre, moins
    les adresses de fiches/<binaire>.hors-compte.tsv (adresse, raison) : une donnée, un milieu de fonction, du
    code mort, relevés à la relecture."""
    starts = {a - binary.base for a in binary.starts}
    declared = {a for a, (kind, _) in name_pass.read_names(binary.names_path).items() if kind == 'function'} - starts
    declared |= set(hand) - starts
    outside = set(outside) & (starts | declared)
    total = (starts | declared) - outside
    named = {a for a in total if a in binary.names}
    origin = collections.Counter(sources.get((binary.name, a, binary.names[a][1]), 'fiche') for a in named)
    waiting = collections.Counter(c for a, c in (proposed or {}).items() if a in total and a not in named)
    return {'nom': binary.name, 'ghidra': len(starts) - len(binary.entries), 'manquees': len(binary.entries),
            'fiche_seule': len(declared), 'hors_compte': len(outside), 'trouvees': len(total), 'nommees': len(named),
            'proposees_haute': waiting['haute'], 'proposees_moyenne': waiting['moyenne'], 'typees': 0,
            'citees': len(starts & cited), 'recompilees': len(starts & recompiled), 'reimplementees': 0,
            'origines': dict(sorted(origin.items()))}


LEVELS = ('ghidra', 'manquees', 'fiche_seule', 'hors_compte', 'trouvees', 'nommees', 'proposees_haute', 'proposees_moyenne', 'typees',
          'citees', 'recompilees', 'reimplementees')


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
                                       recompiled if b.name == 'maj' else set(), read_proposed(b), read_outside(b.name),
                                       read_hand_entries(b.name)))
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
    head = '%-20s %7s %7s %6s %6s %8s %8s %6s %7s %7s %7s %7s   %s' % (
        'binaire', 'Ghidra', 'manq.', 'fiche', 'hors', 'trouvées', 'nommées', '%', 'p.haute', 'p.moy.', 'citées',
        'recomp.', 'origine des noms (typées et réimplémentées : 0 partout)')
    print(head)
    print('-' * len(head))
    for r in rows + [total_row(rows)]:
        share = 100 * r['nommees'] / r['trouvees'] if r['trouvees'] else 0
        print('%-20s %7d %7d %6d %6d %8d %8d %5.1f%% %7d %7d %7d %7d   %s' % (
            r['nom'], r['ghidra'], r['manquees'], r['fiche_seule'], r['hors_compte'], r['trouvees'], r['nommees'], share,
            r['proposees_haute'], r['proposees_moyenne'], r['citees'], r['recompilees'],
            ', '.join('%s %d' % kv for kv in r.get('origines', {}).items())))
    print('\nGhidra : funcs.tsv ; manq. : entrées manquées par Ghidra (couverture.py entrees <binaire>) ; fiche : lignes '
          '« function » de la fiche de noms hors des deux ; hors : retirées par fiches/<binaire>.hors-compte.tsv '
          '(données, milieux de fonction, code mort) ; p.haute, p.moy. : noms proposés pas encore versés')
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
    etat['mise_a_jour'] = datetime.date.today().isoformat()
    etat['mise_a_jour_heure'] = datetime.datetime.now().strftime('%d/%m/%Y à %H:%M')
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
          and found[('mod_b', b_base + 0x100)].confidence == 'moyenne'
          and found[('mod_b', b_base + 0x100)].source == 'empreinte:mod_a', 'nom ARM propagé, une seule origine : moyenne')
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
    # Les deux voies. Une fonction de neuf instructions (sans appel) dans trois binaires, nommée dans deux d'entre eux.
    plain = [0xE2800001] * 8 + [0xE12FFF1E]

    def graded(name, names_in=('r1', 'r2'), literal_text=None):
        """La confiance et la règle de `name` pour la copie sans nom de r3 ; r1 et r2 la nomment si cités."""
        made = []
        for k, label in enumerate(('r1', 'r2', 'r3')):
            base = 0x00500000 + k * 0x100000
            words = arm_function(base, base + 0x200, base + 0x300) if literal_text else plain
            r = fake_binary(label, base, [(0, words, 'arm', 36)] +
                            ([(0x200, one[1], 'arm', 8)] if literal_text else []),
                            {0: name} if label in names_in else {})
            if literal_text:
                r.image.data = r.image.data[:0x300] + literal_text + r.image.data[0x300 + len(literal_text):]
            made.append(r)
        props, _, _ = propose(made, {r.name: fingerprints(r) for r in made})
        return [(p.confidence, p.rule.split(' ')[0]) for p in props if p.binary.name == 'r3' and p.address == 0x00700000]
    check(graded('heap_find_block') == [('haute', 'a')], 'deux binaires d\'origine : haute (a)')
    check(graded('heap_find_block', names_in=('r1',)) == [('moyenne', 'une')], 'une seule origine : moyenne')
    check(graded('strlen', names_in=('r1',)) == [('haute', 'b:nom')], 'bibliothèque C, une origine : haute (b)')
    check(graded('memcpy', names_in=('r1',)) == [('moyenne', 'une')], 'memcpy ne se prouve pas seul (__aeabi_memcpy)')
    check(graded('svcFooBar') == [('moyenne', 'svc<Nom>')], 'svc<Nom> : pas haute par la règle (a)')
    check(graded('_ZN2nn2os5Mutex4LockEv', names_in=('r1',)) == [('haute', 'b:nom')], 'symbole manglé : haute (b)')
    check(graded('cfg_read_block') == [('moyenne', 'service')], 'mot de service sans sa chaîne : moyenne')
    check(graded('cfg_read_block', literal_text=b'cfg:s\0') == [('haute', 'a')], 'mot de service avec « cfg:s » : haute')
    check(graded('srv_init_session_handles') == [('moyenne', 'ouverture')], 'ouverture de session : moyenne')
    check(graded('copy_ns') == [('haute', 'a')], '« ns » en dernier mot n\'est pas un service')
    check(graded('IRUSER_Disconnect', literal_text=b'ir:USER\0')[0][0] == 'moyenne'
          and graded('get_session_handle')[0][1] == 'nom', 'nom de rôle (préfixe de service, session, handle) : moyenne')

    def callee_trio(callee, body, names3):
        """r1, r2, r3 : « heap_walk » en 0, nommée dans r1 et r2, appelle en 0x200 un veneer (ou une fonction ARM)
        vers `body` en 0x208, nommé « body_x » dans r1 et r2 ; les noms de r3 sont names3."""
        made = []
        for k, label in enumerate(('r1', 'r2', 'r3')):
            base = 0x00500000 + k * 0x100000
            names = {0: 'heap_walk', 0x208: 'body_x'} if label != 'r3' else names3
            made.append(fake_binary(label, base, [(0, arm_function(base, base + 0x200, base + 0x300), 'arm', 36),
                                                  (0x200, callee, 'arm', 4 * len(callee)), (0x208, [body], 'thumb', 4)],
                                    names))
        return made

    def via_callee(callee, body, names3):
        """La confiance proposée pour heap_walk dans r3@0 (callee_trio)."""
        made = callee_trio(callee, body, names3)
        props, _, _ = propose(made, {r.name: fingerprints(r) for r in made})
        return [(p.confidence, p.rule.split(' ')[0]) for p in props if p.binary.name == 'r3' and p.address == 0x00700000]
    veneer = [0xE28FC001, 0xE12FFF1C]                                    # add ip, pc, #1 ; bx ip -> corps Thumb en 0x208
    check(via_callee(veneer, 0x47702001, {0x208: 'body_x'}) == [('haute', 'a')], 'appelée de même nom à travers le veneer')
    check(via_callee(veneer, 0x47702001, {0x208: 'body_y'}) == [('moyenne', 'appelées')]
          and via_callee(veneer, 0x47702001, {}) == [('moyenne', 'appelées')],
          'appelée d\'un autre nom, ou sans nom d\'un côté : pas haute')
    check(via_callee(veneer, 0x4770DF32, {0x208: 'body_x'}) == [('basse', 'envoi')],
          'talon svc 0x32 partagé derrière un veneer : envoi IPC')
    check(twin_grade(a, a_base, 'SRV_GetServiceHandle')[0] == 'moyenne'
          and twin_grade(a, a_base, 'heap_walk', ipc=True)[0] == 'basse', 'jumeau : nom de rôle, envoi IPC')
    # « revoir » : heap_walk propagé dans r2 (mêmes appelées que r1) et dans r3 (body_y) ; seul r3 est à revoir
    made = callee_trio(veneer, 0x47702001, {0: 'heap_walk', 0x208: 'body_y'})
    with tempfile.TemporaryDirectory() as folder:
        provenance = os.path.join(folder, 'noms-propages.tsv')
        record_propagated([('r2', '0x600000', 'heap_walk', 'empreinte:r1 ; a'),
                           ('r3', '0x700000', 'heap_walk', 'empreinte:r1 ; a')], provenance)
        rows = review(made, {r.name: fingerprints(r) for r in made}, provenance)
    check([(r[1], ' '.join(r[3].split(' ')[:3])) for r in rows] == [('0x700000', 'appelées de noms')], 'revoir : appelée d\'un autre nom')
    # svc<Nom> : haute seulement si la fonction n'est que cet appel système, du bon numéro
    SVC_NAMES.update({0x23: 'CloseHandle'})
    svc = fake_binary('svc', 0x00500000, [(0, [0xEF000023, 0xE12FFF1E], 'arm', 8), (0x10, [0xEF000024, 0xE12FFF1E], 'arm', 8)], {})
    check(is_pure_svc(svc, 0x00500000, 'svcCloseHandle') and not is_pure_svc(svc, 0x00500010, 'svcCloseHandle'),
          'svc<Nom> vérifié sur les octets')
    # Une même proposition par deux chemins garde la plus haute : appelée nommée par une seule origine (moyenne),
    # et même code nommé dans deux binaires (haute)
    h1, h2, h3 = (fake_binary(n, base, [(0x40, arm_function(base + 0x40, base + 0x200, base + 0x300, step=st), 'arm', 36),
                                        (0x200, plain, 'arm', 36)], {0x200: 'heap_find_block'} if n != 'h3' else {})
                  for n, base, st in (('h1', 0x00500000, 1), ('h2', 0x00600000, 2), ('h3', 0x00700000, 1)))
    props, _, _ = propose([h1, h2, h3], {h.name: fingerprints(h) for h in (h1, h2, h3)})
    check([(p.confidence, p.source) for p in props if p.binary.name == 'h3' and p.address == 0x00700200]
          == [('haute', 'empreinte:h1')], 'deux chemins : la confiance la plus haute est gardée')
    # Voie des appelées : une appelée dont la grappe porte deux noms (x dans k1, y dans k2) n'est pas nommée dans k3
    k1, k2, k3 = (fake_binary(n, base, [(0x40, arm_function(base + 0x40, base + 0x200, base + 0x300, step=st), 'arm', 36),
                                        (0x200, plain, 'arm', 36)], {0x200: nm} if nm else {})
                  for n, base, st, nm in (('k1', 0x00500000, 1, 'x_name'), ('k2', 0x00600000, 2, 'y_name'),
                                          ('k3', 0x00700000, 1, '')))
    props, _, _ = propose([k1, k2, k3], {k.name: fingerprints(k) for k in (k1, k2, k3)})
    check(not [p for p in props if p.binary.name == 'k3' and p.address == 0x00700200], 'appelée disputée : pas de nom')
    # Un module et sa variante « -safe » ne font qu'une origine pour la règle (a)
    m1, m2, m3 = (fake_binary(n, base, [(0, plain, 'arm', 36)], {0: 'heap_find_block'} if n != 'other' else {})
                  for n, base in (('mod', 0x00500000), ('mod-safe', 0x00600000), ('other', 0x00700000)))
    props, _, _ = propose([m1, m2, m3], {m.name: fingerprints(m) for m in (m1, m2, m3)})
    check([(p.binary.name, p.confidence) for p in props] == [('other', 'moyenne')], 'module et variante : une origine')
    # La règle « jumeau » : la variante a une fonction de plus (insérée) ; les fonctions identiques à la même place de
    # l'alignement prennent le nom ; une adresse refusée par la relecture non
    codes = [[0xE3A00000 | k, 0xE12FFF1E] for k in range(1, 5)]
    tw = fake_binary('tw', 0x00500000, [(0x10 * k, codes[k], 'arm', 8) for k in range(4)],
                     {0x00: 'first_fn', 0x10: 'second_fn', 0x20: 'third_fn'})
    tws = fake_binary('tw-safe', 0x00600000, [(0x00, codes[0], 'arm', 8), (0x10, [0xE3A000FF, 0xE12FFF1E], 'arm', 8)] +
                      [(0x10 * k + 0x10, codes[k], 'arm', 8) for k in range(1, 4)], {})
    tprints = {t.name: fingerprints(t) for t in (tw, tws)}
    props, _, _ = propose([tw, tws], tprints, excluded={('tw', 0x00500020)})
    check(sorted((p.address, p.name, p.confidence, p.rule) for p in props if p.source.startswith('jumeau'))
          == [(0x00600000, 'first_fn', 'haute', 'jumeau'), (0x00600020, 'second_fn', 'haute', 'jumeau')],
          'jumeaux : même code à la même place, sauf l\'adresse refusée')
    dp = fake_binary('dp', 0x00500000, [(0x00, codes[0], 'arm', 8), (0x10, codes[0], 'arm', 8)], {0x00: 'a_fn', 0x10: 'b_fn'})
    dps = fake_binary('dp-safe', 0x00600000, [(0x00, codes[0], 'arm', 8)], {})
    check(not twins([dp, dps], {d.name: fingerprints(d) for d in (dp, dps)}), 'jumeau : code en double, place ambiguë')
    # Pas de témoin d'une seule instruction (« mov r0, r0 » qui tombe dans la suite : empreinte vide), ni d'une grappe
    # qui porte deux noms (le constructeur statique ctor_a ici, ctor_b ailleurs), ni pour un jumeau ni pour une appelée
    ctor = [0xE59F0008, 0xE3A01000, 0xE5801000, 0xE12FFF1E]           # ldr r0, =globale ; mov r1, #0 ; str r1, [r0]
    tz, tzs, oth = (fake_binary(n, base, [(0x00, codes[0], 'arm', 8), (0x10, [0xE1A00000], 'arm', 4),
                                          (0x20, ctor + [base + 0x3F0], 'arm', 16)],
                                {0x00: 'first_fn', 0x10: 'falls_through', 0x20: 'ctor_a'} if n == 'tz' else
                                {0x20: 'ctor_b'} if n == 'oth' else {})
                    for n, base in (('tz', 0x00500000), ('tz-safe', 0x00600000), ('oth', 0x00700000)))
    props, _, _ = propose([tz, tzs, oth], {t.name: fingerprints(t) for t in (tz, tzs, oth)})
    check([(p.address, p.name) for p in props if p.source.startswith('jumeau')] == [(0x00600000, 'first_fn')],
          'jumeau : pas de témoin vide ni de grappe à deux noms')
    e1, e2, e3 = (fake_binary(n, base, [(0x40, arm_function(base + 0x40, base + 0x200, base + 0x300), 'arm', 36),
                                        (0x200, [0xE1A00000], 'arm', 4)], {0x200: 'empty_callee'} if n != 'e3' else {})
                  for n, base in (('e1', 0x00500000), ('e2', 0x00600000), ('e3', 0x00700000)))
    props, _, _ = propose([e1, e2, e3], {e.name: fingerprints(e) for e in (e1, e2, e3)})
    check(not [p for p in props if p.source.startswith('appel')], 'appelée à l\'empreinte vide : pas un témoin')
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
    # « apply » depuis un fichier relu : la graine sans nom reçoit le nom sur place (fins de ligne CRLF gardées), une
    # ligne d'exclusions.tsv n'est pas versée, une moyenne non plus, un binaire sans fiche de noms n'en reçoit pas une
    with tempfile.TemporaryDirectory() as folder:
        b.names, b.names_path = {}, os.path.join(folder, 'mod_b.noms.tsv')
        with open(b.names_path, 'w', encoding='utf-8', newline='') as f:
            f.write('0x340000\tfunction\tfirst\r\n0x340100\tfunction\t\r\n')
        d.names_path = os.path.join(folder, 'absent.noms.tsv')
        source, exclusions = os.path.join(folder, 'proposals.tsv'), os.path.join(folder, 'exclusions.tsv')
        name_pass.write_tsv(source, [PROPOSALS_HEADER,
                                     ('mod_b', '0x340100', 'nnosMutexLock', 'empreinte:mod_a', 'haute', 'a', ''),
                                     ('mod_b', '0x340140', 'excluded_name', 'empreinte:mod_a', 'haute', 'a', ''),
                                     ('mod_b', '0x340180', 'medium_name', 'empreinte:mod_a', 'moyenne', '', ''),
                                     ('mod_d', '0x600000', 'nnosMutexLock', 'empreinte:mod_a', 'haute', 'a', '')])
        name_pass.write_tsv(exclusions, [('binaire', 'adresse', 'raison'), ('mod_b', '0x340140', 'relu : faux')])
        provenance = os.path.join(folder, 'noms-propages.tsv')
        apply(source, exclusions, binaries=[a, b, d], provenance=provenance)
        check(open(b.names_path, 'rb').read() == b'0x340000\tfunction\tfirst\r\n0x340100\tfunction\tnnosMutexLock\r\n'
              and not os.path.exists(d.names_path), 'apply : graine nommée sur place, exclusion, pas de fiche créée')
        check(read_propagated(provenance) == {('mod_b', 0x340100)}, 'apply : provenance notée')
        # Le cycle propager -> verser -> relancer : le nom versé dans q2 depuis q1 seul ne fait pas une seconde origine
        q1, q2, q3 = (fake_binary(n, base, [(0, plain, 'arm', 36)], {0: 'heap_find_block'} if n == 'q1' else {})
                      for n, base in (('q1', 0x00500000), ('q2', 0x00600000), ('q3', 0x00700000)))
        qs, qprints = [q1, q2, q3], {}
        qprints.update({q.name: fingerprints(q) for q in qs})
        props, _, _ = propose(qs, qprints)
        check({p.binary.name: p.confidence for p in props} == {'q2': 'moyenne', 'q3': 'moyenne'}, 'une seule origine')
        q2.names_path = os.path.join(folder, 'q2.noms.tsv')
        open(q2.names_path, 'w', encoding='utf-8').close()
        name_pass.write_tsv(source, [PROPOSALS_HEADER] + [(p.binary.name, '%#x' % p.address, p.name, p.source, 'haute',
                                                           p.rule, '') for p in props if p.binary is q2])
        apply(source, os.devnull, binaries=qs, provenance=provenance)
        q2.names = {a: v for a, v in name_pass.read_names(q2.names_path).items() if v[1]}
        promoted = {p.binary.name: p.confidence for p in propose(qs, qprints)[0]}
        props, _, _ = propose(qs, qprints, propagated=read_propagated(provenance))
        check(promoted == {'q3': 'haute'} and [(p.binary.name, p.confidence) for p in props] == [('q3', 'moyenne')],
              'cycle propager, verser, relancer : le nom propagé ne fait pas une seconde origine')
    # Les noms automatiques seulement sont écartés
    check(usable('init_vm_region_10000000') and not usable('FUN_00100abc') and not usable('thunk_FUN_00100abc')
          and not usable('trou_00100abc') and not usable('memcpy_alt_100abc'), 'noms automatiques écartés, pas les autres')
    # Les entrées manquées. A (0x000) : push ; bl V ; ldr r0, =H ; b X. V (0x100) : veneer, corps Thumb en 0x108.
    # X (0x200) : cible du b. H (0x300) : commence par un bl (find_pointers l'écarte), visé par la réserve de A.
    # C (0x040) : b M, où M (0x1c0) est dans la taille trop grande de B (0x180, 0x60 octets).
    # D (0x220) : un pointeur vers sa propre case (0x230), pas une entrée. E (0x260) : b vers 0x2a4, au milieu d'une
    # suite d'instructions sans frontière (ni push, ni retour, ni réserve juste avant) : refusé. F (0x380) : sa réserve
    # (0x388) vise 0x38c, juste après elle, un « bl » seul : une fonction (dsp 0x1016e0), pas une case de F.
    base = 0x00100000
    ent = fake_binary('ent', base, [
        (0x000, [0xE92D4010, 0xEB00003D, 0xE59F0000, 0xEA00007B, base + 0x300], 'arm', 16),
        (0x040, [0xE92D4010, 0xEA00005D], 'arm', 8),
        (0x180, [0xE3A00001, 0xE12FFF1E], 'arm', 0x60),
        (0x220, [0xE3A00000, 0xE12FFF1E, base + 0x230, 0, 0xE3A00003, 0xE12FFF1E], 'arm', 0x18),
        (0x260, [0xE92D4010, 0xEA00000E], 'arm', 8),
        (0x380, [0xE59F0000, 0xE12FFF1E, base + 0x38C], 'arm', 8)], {})
    for at, words in ((0x100, [0xE28FC001, 0xE12FFF1C, 0x00004770]), (0x200, [0xE3A00000, 0xE12FFF1E]),
                      (0x300, [0xEBFFFF3E, 0xE12FFF1E]), (0x1C0, [0xE3A00002, 0xE12FFF1E]),
                      (0x2A0, [0xE3A00005, 0xE3A00006, 0xE12FFF1E]), (0x38C, [0xEBFFFF1B])):
        ent.image.data = ent.image.data[:at] + struct.pack('<%dI' % len(words), *words) + ent.image.data[at + 4 * len(words):]
    found = add_entries(ent)
    kinds = {a - base: (m, k) for a, (m, k, _) in found.items()}
    check(kinds == {0x100: ('arm', 'veneer'), 0x108: ('thumb', 'corps de veneer'),
                    0x200: ('arm', 'cible de b (appel terminal)'), 0x300: ('arm', 'pointeur de réserve'),
                    0x1C0: ('arm', 'cible de b (appel terminal), au milieu de 0x100180'),
                    0x38C: ('arm', 'pointeur de réserve')}, 'entrées manquées : %r' % kinds)
    check(overruns(ent, found) == [(base + 0x180, 0x60, 0x40)], 'taille de Ghidra qui déborde, coupée à l\'entrée')
    check(fingerprints(ent)[base + 0x180].count == 2, 'empreinte coupée à l\'entrée suivante')
    row = measure_binary(ent, {}, set(), set())
    check((row['ghidra'], row['manquees'], row['trouvees']) == (6, 6, 12), 'dénominateur avec les entrées : %r' % row)
    row = measure_binary(ent, {}, set(), set(), outside={base + 0x300, base + 0x9999})
    check((row['hors_compte'], row['trouvees']) == (1, 11), 'hors-compte.tsv retiré du dénominateur : %r' % row)
    # Une cible brute : ses réglages (raw_targets.toml) sont suivis. Le bourrage 0xFFFFFFFF du code se lit sinon comme
    # une table de distances (-1) qui vise du Thumb ; le pointeur vers l'alias physique d'un morceau (0x1fff4100) mène à
    # son adresse virtuelle ; un b dans du code qu'aucune fonction de Ghidra ne couvre (0x380) est lu aussi.
    raw = fake_binary('raw', base, [(0x000, [0xE59F0000, 0xE12FFF1E, 0x1FFF4100], 'arm', 8),
                                    (0x108, [0xE3A00007, 0xE12FFF1E], 'arm', 8), (0x390, [0xE3A00006, 0xE12FFF1E], 'arm', 8)], {})
    for at, words in ((0x100, [0xE3A00001, 0xE12FFF1E]), (0x200, [0xFFFFFFFF] * 8),
                      (0x370, [0xE12FFF1E, 0xE3A00000, 0xE3A00001, 0xE3A00002]),
                      (0x380, [0xEA000006, 0xE3A00003, 0xE3A00004, 0xE12FFF1E]), (0x3A0, [0xE12FFF1E, 0xE3A00005])):
        raw.image.data = raw.image.data[:at] + struct.pack('<%dI' % len(words), *words) + raw.image.data[at + 4 * len(words):]
    free = find_entries(raw)
    raw.target = {'pointer_sources': 'code', 'thumb_pointers': False, 'relative_tables': False,
                  'firm': {'pieces': [('vectors', base, 0, 0x400, 0x400, 5, 0x1FFF4000)]}}
    kept = find_entries(raw)
    check(any(0x200 <= a - base < 0x220 and m == 'thumb' for a, (m, _, _) in free.items())
          and not any(0x200 <= a - base < 0x220 for a in kept), 'cible brute : réglages suivis, bourrage écarté')
    check(kept.get(base + 0x100, ('', ''))[1] == 'pointeur de réserve', 'cible brute : alias physique suivi')
    check(kept.get(base + 0x3A0, ('', ''))[1] == 'cible de b hors fonction', 'b lu dans le code hors fonction')
    check(twin_grade(raw, base, 'memcpy')[0] == 'moyenne' and twin_grade(raw, base, 'heap_find_block') == ('haute', 'jumeau'),
          'jumeau : la famille de memcpy reste moyenne')
    # Un veneer ARM visé par un b, dans la taille (0x18) d'une fonction Thumb de Ghidra : trouvé avec son corps
    vt = fake_binary('vt', base, [(0x000, [0x4770], 'thumb', 0x18), (0x100, [0xEAFFFFC2], 'arm', 4)], {})
    # Lu en Thumb par sa fonction hôte, le veneer donne des « b » vers 0x278 et 0x534 : du code ARM là, rejeté
    vt.image.data = (vt.image.data[:0x10] + struct.pack('<3I', 0xE28FC001, 0xE12FFF1C, 0x4770) + vt.image.data[0x1C:0x200]
                     + struct.pack('<I', 0xE3A00000) * 0x80)
    kinds = {a - base: (m, k) for a, (m, k, _) in find_entries(vt).items()}
    check(kinds == {0x10: ('arm', 'veneer, au milieu de 0x100000'), 0x18: ('thumb', 'corps de veneer')},
          'veneer dans une fonction Thumb : %r' % kinds)
    # Le veneer précédé d'un « mov r0, r0 » (fs 0x100194) : celui de Ghidra (0x000) et celui qu'atteint le b de 0x200
    # (0x100) mènent à leur corps Thumb, après le bx ip
    nop = [0xE1A00000, 0xE28FC001, 0xE12FFF1C, 0x4770]
    nv = fake_binary('nv', base, [(0x000, nop, 'arm', 12), (0x100, nop, 'arm', 0), (0x200, [0xEAFFFFBE], 'arm', 4)], {})
    nv.functions.remove((base + 0x100, 0, 'arm'))
    nv.starts.discard(base + 0x100)
    kinds = {a - base: (m, k) for a, (m, k, _) in find_entries(nv).items()}
    check(kinds == {0x0C: ('thumb', 'corps de veneer'), 0x100: ('arm', 'veneer'), 0x10C: ('thumb', 'corps de veneer')},
          'veneer « mov r0, r0 ; add ip, pc, #1 ; bx ip » : %r' % kinds)
    # Une table de distances dans des données recopiées au démarrage (qtm) : les cases comptent depuis la copie. Dans
    # le fichier (0x300), elles ne visent rien ; lues à 0x1e000300, elles visent les fonctions 0x040, 0x080 et 0x0c0.
    rc = fake_binary('rc', base, [(0x000, [0xE3A00000, 0xE12FFF1E], 'arm', 8)], {})
    rc.image.data = rc.image.data[:0x300] + struct.pack('<3I', *[(base + t - 0x1E000300 - 4 * k) & 0xFFFFFFFF
                                                                  for k, t in enumerate((0x40, 0x80, 0xC0))])
    for at in (0x40, 0x80, 0xC0):
        rc.image.data = rc.image.data[:at] + struct.pack('<2I', 0xE92D4010, 0xE8BD8010) + rc.image.data[at + 8:]
    rc.image.data += bytes(0x400 - len(rc.image.data))
    check(not any(0x40 <= a - base <= 0xC0 for a in find_entries(rc)), 'données recopiées : rien sans la copie')
    rc.copies = [(base + 0x300, 0x1E000300, 0x10)]
    check(sorted(a - base for a in find_entries(rc)) == [0x40, 0x80, 0xC0], 'données recopiées : table lue à la copie')

    def thumb_words(halves):
        halves = list(halves) + [0] * (len(halves) & 1)
        return list(struct.unpack('<%dI' % (len(halves) // 2), struct.pack('<%dH' % len(halves), *halves)))

    def thumb_bl(at, target):
        offset = target - (at + 4)
        return [0xF000 | (offset >> 12) & 0x7FF, 0xF800 | (offset >> 1) & 0x7FF]

    # Un veneer « add ip, pc, #0x17 ; bx ip » visé par le b de 0x300 (news 0x105758) : le corps est en 0x100 + 8 + 0x17 - 1, au
    # milieu de la fonction Thumb de Ghidra qui suit (0x108, 0x20 octets). « #0x16 » viserait de l'ARM : pas un veneer.
    vn = fake_binary('vn', base, [(0x300, [0xEAFFFF7E], 'arm', 4), (0x100, [0xE28FC017, 0xE12FFF1C], 'arm', 0),
                                  (0x108, thumb_words([0x2000, 0x4770] * 8), 'thumb', 0x20),
                                  (0x200, [0xE28FC016, 0xE12FFF1C], 'arm', 0)], {})
    vn.functions = [f for f in vn.functions if f[1]]
    vn.starts = {a for a, _, _ in vn.functions}
    kinds = {a - base: (m, k) for a, (m, k, _) in find_entries(vn).items()}
    check(kinds == {0x100: ('arm', 'veneer'), 0x11E: ('thumb', 'corps de veneer, au milieu de 0x100108')}
          and veneer_body(vn.image, base + 0x200) is None, 'veneer « add ip, pc, #0x17 » : %r' % kinds)
    # Un aiguillage Thumb sans aide (nim 0x1055ae) : la fonction de Ghidra (0x000, 0x10 octets) s'arrête au add pc.
    # Les trois cases (0x18, 0x20, 0x30) sont des morceaux ; le bl de la case 0 vers 0x2a, dans l'aiguillage et sans
    # push, en est un aussi (nim 0x1071aa) ; celui de la case 1 vers 0x100 (un push, au-delà) est une vraie entrée.
    # 0x200 : ldr r1, =distance ; add r1, pc donne 0x1e1, le rappel Thumb 0x1e0 (news 0x105790), une entrée.
    switch = ([0xB510, 0x2803, 0xD214, 0x0043, 0x447B, 0x889B, 0x005B, 0x449F, 3, 7, 0xF, 0]
              + thumb_bl(0x18, 0x2A) + [0xBD10, 0] + thumb_bl(0x20, 0x100) + [0xBD10, 0, 0x2001, 0xBD10, 0, 0, 0x2002,
                                                                                 0xBD10])
    sw = fake_binary('swt', base, [(0x000, thumb_words(switch), 'thumb', 0x10),
                                   (0x200, thumb_words([0xB500, 0x4901, 0x4479, 0xBD00]) + [-0x27 & 0xFFFFFFFF], 'thumb', 8)], {})
    sw.image.data = (sw.image.data[:0xFC] + struct.pack('<4H', 0, 0x4770, 0xB510, 0xBD10) + sw.image.data[0x104:0x1DE]
                     + struct.pack('<3H', 0x4770, 0x7808, 0x4770) + sw.image.data[0x1E4:])
    check({a - base: s for a, s in thumb_cases(sw).items()} == {0x18: base + 0xE, 0x20: base + 0xE, 0x30: base + 0xE},
          'aiguillage Thumb : cases lues dans la table')
    found = add_entries(sw)
    kinds = {a - base: (m, k) for a, (m, k, _) in found.items()}
    check(kinds == {0x100: ('thumb', 'cible de bl'), 0x1E0: ('thumb', 'adresse calculée')}
          and sorted(a - base for a in sw.pieces) == [0x18, 0x20, 0x2A, 0x30], 'aiguillage Thumb et adresse calculée : '
          '%r, morceaux %r' % (kinds, sorted(hex(a - base) for a in sw.pieces)))
    sw.image.data = sw.image.data[:2] + struct.pack('<H', 0x46C0) + sw.image.data[4:]
    check(not thumb_cases(sw), 'aiguillage Thumb sans le cmp qui donne le nombre de cases : rien')
    # Sur les vrais binaires s'ils sont là : les entrées relevées à la main dans gpio et codec (notes-100.md), et les
    # main_thread_terminate_handler de dsp et hid (un « bl abort » seul, juste après la réserve qui le désigne)
    by_hand = {'gpio': [0x100134, 0x100160, 0x100168, 0x100db0, 0x100e30, 0x100f48, 0x1011e8, 0x101580, 0x10169c,
                        0x101aa0, 0x101b0c],
               'codec': [0x100168, 0x100170, 0x1010a4, 0x10165c, 0x1016a0, 0x101828, 0x102318, 0x1022f4, 0x102514,
                         0x102f3c, 0x10343c, 0x103800, 0x103808, 0x103ec4, 0x103ee4, 0x103f70],
               'dsp': [0x1016e0], 'hid': [0x102fc4],
               # fs (notes-100.md) : corps Thumb des veneers « mov r0, r0 ; add ip, pc, #1 ; bx ip »
               'fs': [0x1001a0, 0x100488, 0x10049c, 0x1004bc, 0x10bbcc],
               # qtm (noms-proposes.tsv) : les 31 constructeurs statiques de la table recopiée en mémoire QTM
               'qtm': [0x12081c, 0x12086c, 0x1208c8, 0x120b34, 0x120bac, 0x120bc0, 0x120c20, 0x120c8c, 0x120ca0,
                       0x120d00, 0x120d34, 0x120d48, 0x120dac, 0x120dc0, 0x120dd4, 0x120dd8, 0x120ddc, 0x120e14,
                       0x120e28, 0x120e3c, 0x120e50, 0x120e64, 0x120e9c, 0x120eb0, 0x120ee8, 0x120efc, 0x120f10,
                       0x120f48, 0x120f5c, 0x121090, 0x1210a4],
               # ro : le veneer de destroy_array dans la taille de FUN_140000c0 (Thumb), visé par le b de 0x14002218
               'ro': [0x14000110, 0x14000118],
               # kernel11 (notes-100.md) : relais des vecteurs, veneer de destroy_array, code de lancement d'un FIRM
               # atteint par son alias physique. Pas la table des vecteurs (seul le processeur y va) ni les deux bouts
               # qui ne s'exécutent qu'une fois recopiés (0xffff09ac, 0xffff0a00).
               # news, cecd, ac (noms-proposes.tsv) : corps des veneers « add ip, pc, #0x17 / #0x7f » et rappels Thumb
               # dont l'adresse est calculée (« ldr rX, =distance ; add rX, pc »)
               'news': [0x105776, 0x1057ee, 0x105790], 'cecd': [0x115e02, 0x116f0e, 0x116f46, 0x115284],
               'ac': [0x112a76, 0x112478, 0x11b790],
               'kernel11': [0x1ffb1254, 0x1ffb125c, 0xfff00004, 0xfff0000c, 0xfff0060c, 0xfff00618, 0xfff00624,
                            0xfff00630, 0xfff0063c, 0xfff02e20, 0xfff02e60, 0xfff03174, 0xfff0355c, 0xfff03d48,
                            0xfff0ba5c, 0xfff12758, 0xfff15664, 0xfff15a0c, 0xfff16ec4, 0xfff18a54, 0xfff1eb64,
                            0xfff20258, 0xfff20c20, 0xfff25c34, 0xfff29124, 0xfff29e3c, 0xfff2a360, 0xfff2ba44,
                            0xffff0578, 0xffff05a0, 0xffff0994, 0xffff09e4, 0xffff0a78, 0xffff0ac4]}
    # Les morceaux d'aiguillage que les lots ont marqués PAS UNE FONCTION (noms-proposes.tsv, hors-compte.tsv) : cases et
    # suites atteintes par un b ou un bl qui sert de saut long, jusqu'au début de fonction qui suit la dernière case
    by_hand_pieces = {'ac': [0x10217e, 0x1021e0, 0x1031b4, 0x103628, 0x1057dc], 'cecd': [0x11ba02],
                      'nim': [0x107038, 0x1071aa, 0x105670]}
    for module, expected in by_hand.items():
        if os.path.isfile(os.path.join(ANALYSE, module, 'gh', 'funcs.tsv')):
            real = load_system(module, True)
            if real.image is not None:
                missing = sorted(set(expected) - set(add_entries(real)))
                check(not missing, '%s : entrées relevées à la main retrouvées (manquent %s)' % (module, [hex(a) for a in missing]))
                wrong = sorted(set(by_hand_pieces.get(module, [])) - set(real.pieces))
                check(not wrong, "%s : morceaux d'aiguillage pas comptés (manquent %s)" % (module, [hex(a) for a in wrong]))
    for module, expected in by_hand_pieces.items():
        if module not in by_hand and os.path.isfile(os.path.join(ANALYSE, module, 'gh', 'funcs.tsv')):
            real = load_system(module, True)
            if real.image is not None:
                add_entries(real)
                wrong = sorted(set(expected) - set(real.pieces))
                check(not wrong, "%s : morceaux d'aiguillage pas comptés (manquent %s)" % (module, [hex(a) for a in wrong]))
                check(thumb_cases(real).get(0x107f5e) == 0x1055ae if module == 'nim' else True,
                      "nim : le cas par défaut 0x107f5e est une case de l'aiguillage 0x1055ae")
    # Le compteur
    a.names[a_base + 0x999] = ('function', 'not_a_start')
    row = measure_binary(a, {('mod_a', a_base + 0x40, 'nnosMutexLock'): 'rtti'}, {a_base + 0x80}, {a_base + 0x40})
    check((row['trouvees'], row['nommees'], row['citees'], row['recompilees']) == (6, 5, 1, 1)
          and row['origines'] == {'fiche': 4, 'rtti': 1}, 'compteur : %r' % row)
    print('%d échec(s)' % len(failures) if failures else 'couverture : tous les essais passent')
    return failures


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ('mesure', 'entrees', 'run', 'apply', 'revoir', 'test'):
        sys.exit(__doc__)
    if args[0] == 'test':
        sys.exit(1 if test() else 0)
    if args[0] == 'entrees':
        if len(args) != 2 or not os.path.isfile(os.path.join(ANALYSE, args[1], 'gh', 'funcs.tsv')):
            sys.exit('python couverture.py entrees <binaire> : un dossier de local/analyse/ qui a gh/funcs.tsv')
        binary = load_system(args[1], True)
        if binary.image is None:
            sys.exit('%s : pas d\'octets (local/extrait/%s ou la cible de raw_targets.toml)' % (args[1], args[1]))
        add_entries(binary)
        print_entries(binary)
        return
    if args[0] == 'mesure':
        rows, waiting = measure(load_all(cro_images=False))
        print_measure(rows, waiting)
        if '--no-write' not in args:
            write_etat(rows, waiting)
        return
    options = {'--min': MIN_HIGH, '--min-moyenne': MIN_LOW, '--out': OUT, '--from': PROPOSALS, '--exclusions': EXCLUSIONS}
    i = 1
    while i < len(args):
        if args[i] not in options or i + 1 >= len(args):
            sys.exit('option inconnue : %s' % args[i])
        options[args[i]] = type(options[args[i]])(args[i + 1])
        i += 2
    if args[0] == 'apply':
        apply(options['--from'], options['--exclusions'])
    elif args[0] == 'revoir':
        rows = review(*load_prints())
        path = os.path.join(options['--out'], 'propages-a-revoir.tsv')
        os.makedirs(options['--out'], exist_ok=True)
        name_pass.write_tsv(path, [('fiche', 'adresse', 'nom', 'raison', 'origine')] + rows)
        heads = ('envoi IPC', 'nom de rôle', 'appelées nommées', 'appelées de noms', 'aucune autre', 'plus un début')
        for (kind, why), n in sorted(collections.Counter((r[4].split(':')[0], ' + '.join(h for h in heads if h in r[3]))
                                                         for r in rows).items()):
            print('   %-10s %-40s %5d' % (kind, why, n))
        print('%d noms propagés à revoir -> %s' % (len(rows), path))
    else:
        run(options['--min'], options['--min-moyenne'], options['--out'])


if __name__ == '__main__':
    main()
