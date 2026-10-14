"""Premier passage automatique sur un module extrait : appels système, fonctions que Ghidra a manquées, boucle de service.

    python prescan.py <module> [--port N] [--dump]   module = un dossier de local/extrait/ (sm, hid, fs...)
                                                     --dump range aussi dans local/analyse/<module>/ le pseudo-code
                                                     de toutes les fonctions (pseudo/, un .c par fonction) et
                                                     l'assembleur du module entier (code.asm, par objdump)

Il faut le pont ouvert (rea_bridge.py serve) ; prescan l'attend, puis y ouvre local/extrait/<module>/exefs/code.elf.

Ce qu'il fait :
1. Repère dans .text toutes les instructions « svc N » (ARM, avec ou sans condition) et leur donne un nom d'après la
   Carte des services.
2. Demande à REA la fonction qui contient chacune : une fonction courte avec un seul svc est son enveloppe
   (svcReplyAndReceive...), elle est nommée d'office.
3. Cherche dans tout le fichier les mots qui pointent vers du code. Ceux qui ne tombent dans aucune fonction
   connue de Ghidra sont des fonctions manquées : appelées seulement par une table de pointeurs, Ghidra ne les
   crée pas. C'est le cas des gestionnaires de commandes eux-mêmes. Les tables de distances (initialisation des
   objets globaux) sont décodées aussi ; les cases des tables de saut d'un aiguillage sont laissées de côté, ce
   sont des branches et pas des fonctions.
4. Écrit le tout dans fiches/<module>.noms.tsv (adresse, « function » ou « label », nom éventuel), sans toucher aux
   lignes déjà là, et un résumé dans local/analyse/<module>/prescan.json.

Le fichier de noms sert de graines à REA : relancer le pont avec REA_GHIDRA_SEED_FILE=<chemin /mnt/c/... du .tsv>,
puis relancer prescan, jusqu'à ce qu'il ne trouve plus de fonction manquée.

Ce qu'il ne fait pas : le code Thumb. Il signale les pointeurs impairs vers .text, sans les suivre. Une fonction Thumb
se nomme par une ligne « label » (une graine « function » serait désassemblée en ARM) : voir REA.md, partie 4 bis.
Pour un module en Thumb (fs, cfg, ptm), le bon outil est ghidra_direct.py, puis emulate_dispatch.py pour les tables de
commandes ; prescan le dit quand il reconnaît le cas.
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import time

import elfer
import rea_bridge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_MAP = os.path.join(os.path.dirname(ROOT), 'carte-des-services', 'donnees.js')
OBJDUMP = 'C:\\devkitPro\\devkitARM\\bin\\arm-none-eabi-objdump.exe'
WRAPPER_MAX_BYTES = 0x30
SEND_WRAPPER_MAX_BYTES = 0x10
COVERAGE_SAMPLES = 200
BRIDGE_WAIT_SECONDS = 90


def load_service_map():
    with open(SERVICE_MAP, encoding='utf-8') as f:
        source = f.read()
    start = source.index('const DONNEES = ') + len('const DONNEES = ')
    return json.JSONDecoder().raw_decode(source[start:])[0]


def load_names(path):
    """fiches/<module>.noms.tsv -> {adresse: (genre, nom ou None)}, genre valant « function », « label » ou « code »."""
    names = {}
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                fields = line.rstrip('\n').split('\t')
                if len(fields) >= 2 and fields[0].startswith('0x'):
                    names[int(fields[0], 16)] = (fields[1], fields[2] if len(fields) > 2 and fields[2] else None)
    return names


def save_names(path, names):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        for address in sorted(names):
            kind, name = names[address]
            f.write('%#x\t%s%s\n' % (address, kind, '\t' + name if name else ''))


def wait_for_bridge(port):
    """Le pont met quelques secondes à écouter après « serve »."""
    deadline = time.time() + BRIDGE_WAIT_SECONDS
    while True:
        try:
            rea_bridge.ask('tools/list', port=port)
            return
        except OSError:
            if time.time() > deadline:
                sys.exit('Le pont ne répond pas sur le port %d : lancer « python rea_bridge.py serve --port %d ».' % (port, port))
            time.sleep(2)


def find_jump_table_slots(code, text_size):
    """Les cases des tables de saut posées dans .text : « cmp rX, #n » puis « ldrcc pc, [pc, rX, lsl #2] », la table
    commence deux mots plus loin et compte n cases. Rend l'ensemble des décalages de ces cases dans code.bin."""
    slots = set()
    for offset in range(4, text_size - 11, 4):
        word = struct.unpack_from('<I', code, offset)[0]
        if word & 0x0FFFFFF0 != 0x079FF100:          # ldr<cond> pc, [pc, rX, lsl #2]
            continue
        compare = struct.unpack_from('<I', code, offset - 4)[0]
        if compare & 0x0FF0F000 != 0x03500000:       # cmp rX, #imm
            continue
        rotation, value = (compare >> 8) & 0xF, compare & 0xFF
        count = (value >> (2 * rotation)) | (value << (32 - 2 * rotation)) & 0xFFFFFFFF if rotation else value
        for index in range(min(count, 4096)):
            slot = offset + 8 + 4 * index
            if slot + 4 <= text_size:
                slots.add(slot)
    return slots


def prescan(module, port, dump=False):
    folder = os.path.join(ROOT, 'local', 'extrait', module, 'exefs')
    with open(os.path.join(folder, 'code.bin'), 'rb') as f:
        code = f.read()
    with open(os.path.join(folder, 'exheader.bin'), 'rb') as f:
        segments = elfer.segments_depuis_exheader(f.read(), len(code))
    if not segments:
        sys.exit('exheader illisible : pas de découpage en sections pour %s' % module)
    text_base, text_size = segments[0][0], segments[0][2]

    def call(tool, arguments):
        return rea_bridge.call_tool(tool, arguments, port)

    def first_word(address):
        return struct.unpack_from('<I', code, address - text_base)[0]

    # Garde-fou : une fonction ARM commence presque toujours par une instruction sans condition (quartet haut à 0xE),
    # et pas par un « bl » : un pointeur vers un « bl » isolé vise la fin d'une fonction qui ne revient pas, et le donner
    # en graine fait déborder la fausse fonction dans la suivante (vu dans hid à 0x102fc4, juste avant l'aiguillage).
    def looks_like_entry(address):
        return first_word(address) >> 28 == 0xE and first_word(address) >> 24 != 0xEB

    wait_for_bridge(port)
    call('open_binary', {'path': rea_bridge.to_wsl_path(os.path.join(folder, 'code.elf')), 'provider_id': 'ghidra'})
    procedures = {int(p['address'], 16): p['value'] for p in call('list_procedures', {})}
    svc_names = {entry['n']: entry['nom'] for entry in load_service_map()['svc']}

    # 1 et 2 : les svc, et la fonction qui contient chacun.
    svc_sites, by_procedure = [], {}
    for offset in range(0, text_size - 3, 4):
        word = struct.unpack_from('<I', code, offset)[0]
        if word & 0x0FFFFF00 == 0x0F000000 and word >> 28 != 0xF:
            address, number = text_base + offset, word & 0xFF
            owner = call('resolve_containing_procedure', {'address': '%#x' % address})
            entry = int(owner['procedure']['address'], 16) if owner.get('found') else None
            size = owner['procedure']['body']['total_bytes'] if owner.get('found') else None
            svc_sites.append({'address': address, 'number': number, 'name': svc_names.get(number, '?'),
                              'procedure': entry, 'conditional': word >> 28 != 0xE})
            if entry is not None:
                by_procedure.setdefault(entry, {'size': size, 'sites': []})['sites'].append((address, number))
    # Une enveloppe : une fonction courte dont le seul svc est dans ses premiers octets, et la seule de ce genre pour ce
    # numéro. Le svc doit être tout près de l'entrée : Ghidra rattache parfois à une fonction courte le svc d'un morceau
    # atteint par un saut (c'est ainsi que le point d'entrée des modules se retrouvait nommé svcExitProcess). Quand
    # plusieurs fonctions conviennent (sept pour SendSyncRequest dans hid), elles font autre chose : pas de nom d'office.
    # SendSyncRequest à part : son enveloppe ne fait que deux instructions, alors qu'une petite fonction qui écrit un
    # en-tête puis envoie (SRV_Subscribe, SRV_PublishToSubscriber) tient elle aussi sous la limite générale.
    small = {}
    for entry, info in by_procedure.items():
        limit = SEND_WRAPPER_MAX_BYTES if info['sites'][0][1] == 0x32 else WRAPPER_MAX_BYTES
        if len(info['sites']) == 1 and info['size'] <= limit and 0 <= info['sites'][0][0] - entry < limit:
            small.setdefault(info['sites'][0][1], []).append(entry)
    wrappers = {entries[0]: 'svc' + svc_names.get(number, '%02X' % number) for number, entries in small.items() if len(entries) == 1}

    # 3 : les pointeurs vers du code qui ne tombent dans aucune fonction.
    jump_slots = find_jump_table_slots(code, text_size)
    targets, thumb_targets = set(), 0
    for offset in range(0, len(code) - 3, 4):
        if offset in jump_slots:
            continue
        word = struct.unpack_from('<I', code, offset)[0]
        if text_base <= word < text_base + text_size:
            if word % 4 == 0:
                targets.add(word)
            elif word % 2 == 1:
                thumb_targets += 1

    # Les tables de distances : la table d'initialisation des objets globaux ne contient pas des adresses mais des
    # distances (cible = mot + adresse de la case). On ne garde que les suites de cases qui tombent toutes sur un
    # début de fonction plausible : trois de suite dans les données, cinq dans .text où le hasard est plus probable
    # (la table de loader y est, avec dix cases ; hid en a 23 dans ses données).
    relative_targets = set()
    for index, (base, file_offset, file_size, _, _) in enumerate(segments):
        run, minimum = [], 5 if index == 0 else 3
        for offset in range(0, file_size - 3, 4):
            target = (struct.unpack_from('<I', code, file_offset + offset)[0] + base + offset) & 0xFFFFFFFF
            if text_base <= target < text_base + text_size and target % 4 == 0 and looks_like_entry(target) \
                    and (file_offset + offset) not in jump_slots:
                run.append(target)
                continue
            if len(run) >= minimum:
                relative_targets.update(run)
            run = []
        if len(run) >= minimum:
            relative_targets.update(run)

    outside = [t for t in sorted((targets | relative_targets) - set(procedures))
               if not call('resolve_containing_procedure', {'address': '%#x' % t}).get('found')]
    missed = [t for t in outside if looks_like_entry(t)]
    doubtful = [t for t in outside if not looks_like_entry(t)]
    orphan_svc = [site for site in svc_sites if site['procedure'] is None]

    # Combien de .text n'est dans aucune fonction : un sondage, pas une mesure. C'est le signal qui manquait sur les
    # modules en Thumb, où « aucune fonction manquée » ne veut rien dire (dans ptm, 9 000 octets restaient dehors,
    # dont les cinq aiguillages). Les réserves de constantes et les tables comptent aussi comme « dehors ».
    step = max(4, (text_size // COVERAGE_SAMPLES) & ~3)
    samples = range(0, text_size, step)
    uncovered = sum(1 for offset in samples
                    if not call('resolve_containing_procedure', {'address': '%#x' % (text_base + offset)}).get('found'))
    uncovered_percent = round(100 * uncovered / len(samples))

    # La boucle de service : qui appelle l'enveloppe de ReplyAndReceive (svc 0x4F).
    loops = []
    for entry, name in wrappers.items():
        if name == 'svcReplyAndReceive':
            loops += [int(c, 16) for c in call('procedure_callers', {'procedure': '%#x' % entry})]
    loops += [e for e, info in by_procedure.items() if any(n == 0x4F for _, n in info['sites']) and e not in wrappers]

    # 4 : le fichier de noms, sans toucher aux lignes déjà là (ni leur genre, ni leur nom).
    names_path = os.path.join(ROOT, 'fiches', module + '.noms.tsv')
    names = load_names(names_path)
    taken = {name for _, name in names.values() if name}
    for address, name in wrappers.items():
        # Deux fonctions du même nom : REA n'en nommerait qu'une. D'un passage à l'autre, les graines déplacent les
        # frontières des fonctions et l'enveloppe peut changer d'adresse ; le nom déjà posé gagne.
        if address not in names and name not in taken:
            names[address] = ('function', name)
        elif address in names and names[address][1] is None and names[address][0] == 'function' and name not in taken:
            names[address] = ('function', name)
    for address in missed:
        names.setdefault(address, ('function', None))
    save_names(names_path, names)

    summary = {'module': module, 'text': [text_base, text_size], 'procedures': len(procedures), 'svc_sites': svc_sites,
               'wrappers': {'%#x' % a: n for a, n in sorted(wrappers.items())},
               'missed_functions': ['%#x' % a for a in missed], 'doubtful_pointers': ['%#x' % a for a in doubtful],
               'service_loops': ['%#x' % a for a in sorted(set(loops))], 'odd_pointers_into_text': thumb_targets,
               'uncovered_text_percent': uncovered_percent,
               'jump_table_slots': len(jump_slots)}
    out = os.path.join(ROOT, 'local', 'analyse', module)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'prescan.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)

    print('%s : %d fonctions pour Ghidra, .text de %d octets à %#x' % (module, len(procedures), text_size, text_base))
    used = {}
    for site in svc_sites:
        used.setdefault((site['number'], site['name']), []).append(site['address'])
    print('Appels système (%d numéros, %d sites dont %d sous condition) :'
          % (len(used), len(svc_sites), sum(1 for site in svc_sites if site['conditional'])))
    for (number, name), addresses in sorted(used.items()):
        print('  %#04x %-26s %s' % (number, name, ' '.join('%#x' % a for a in addresses[:6]) + (' …' if len(addresses) > 6 else '')))
    print('Enveloppes nommées : %d' % len(wrappers))
    print('Boucle(s) de service : %s' % (', '.join('%#x' % a for a in sorted(set(loops))) or 'aucune trouvée'))
    print('Fonctions manquées par Ghidra : %s' % (', '.join('%#x' % a for a in missed) or 'aucune'))
    if doubtful:
        print('Pointeurs écartés (ne ressemblent pas à un début de fonction) : %s' % ', '.join('%#x' % a for a in doubtful))
    if orphan_svc:
        print('Appels système hors de toute fonction. S\'il reste des fonctions manquées, repasser d\'abord ; sinon c\'est une '
              'fonction dont il faut trouver le début à la main : %s'
              % ', '.join('%s à %#x' % (site['name'], site['address']) for site in orphan_svc))
    print('Code hors de toute fonction : environ %d %% de .text (sondage de %d points)' % (uncovered_percent, len(samples)))
    if thumb_targets:
        print('%d pointeurs impairs vers .text : peut-être du code Thumb, que ce balayage ne lit pas (dans ns, c\'étaient '
              'surtout des nombres qui ressemblaient à des adresses).' % thumb_targets)
    if uncovered_percent >= 10 and not missed:
        print('ATTENTION : beaucoup de code hors de toute fonction alors qu\'aucune fonction manquée n\'est trouvée. Le module est '
              'sans doute en Thumb : ne pas se fier à ce passage. Lancer à la place :\n'
              '    python outils/ghidra_direct.py %s\n'
              '        (Ghidra sans REA : il crée les fonctions Thumb, règle les « switch », range fonctions et pseudo-code '
              'dans local/analyse/%s/gh/)\n'
              '    python outils/emulate_dispatch.py %s <adresse de l\'aiguillage>\n'
              '        (la table des commandes d\'un aiguillage, par émulation)\n'
              'Voir REA.md, partie 4 bis.' % (module, module, module))
    if missed:
        print('-> relancer le pont avec REA_GHIDRA_SEED_FILE=%s puis relancer prescan.' % rea_bridge.to_wsl_path(names_path))
    if dump:
        dump_pseudo_code(sorted(procedures), os.path.join(out, 'pseudo'), port)
        dump_assembly(os.path.join(folder, 'code.bin'), text_base, os.path.join(out, 'code.asm'))
    return summary


def dump_pseudo_code(addresses, folder, port, batch_size=20):
    """Décompile toutes les fonctions par lots et range un .c par fonction (quelques secondes pour 300 fonctions).
    Le dossier est vidé d'abord : d'un passage à l'autre les fonctions changent. Rien de tout ça ne se versionne."""
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)
    written = 0
    for start in range(0, len(addresses), batch_size):
        batch = ['%#x' % a for a in addresses[start:start + batch_size]]
        for item in rea_bridge.call_tool('batch_decompile', {'addresses': batch}, port)['items']:
            pseudo_code = item.get('pseudocode') or item.get('value') or item.get('result') or item.get('text')
            if isinstance(pseudo_code, str):
                with open(os.path.join(folder, item['address'] + '.c'), 'w', encoding='utf-8') as f:
                    f.write(pseudo_code)
                written += 1
    print('Pseudo-code : %d fonctions sur %d dans %s' % (written, len(addresses), folder))


def dump_assembly(code_path, text_base, target):
    """L'assembleur du module entier par l'objdump de devkitPro. Le pseudo-code de Ghidra perd les registres autour
    des svc écrits sur place (poignée d'une requête, arguments de ControlMemory) : c'est là qu'on les lit.
    Tout est désassemblé en ARM, données et Thumb compris : à lire en sachant où sont les sections."""
    if not os.path.isfile(OBJDUMP):
        print('Assembleur : objdump de devkitPro introuvable (%s), étape sautée.' % OBJDUMP)
        return
    with open(target, 'w', encoding='utf-8') as f:
        subprocess.run([OBJDUMP, '-D', '-b', 'binary', '-marm', '--adjust-vma=%#x' % text_base, code_path], stdout=f, check=True)
    print('Assembleur : %s' % target)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    port = int((rea_bridge.pop_option(args, '--port') or [rea_bridge.DEFAULT_PORT])[0])
    dump = '--dump' in args
    args = [a for a in args if a != '--dump']
    if len(args) != 1:
        print(__doc__)
    else:
        prescan(args[0], port, dump)
