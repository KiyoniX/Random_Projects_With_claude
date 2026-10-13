"""Premier passage automatique sur un module extrait : appels système, fonctions que Ghidra a manquées, boucle de service.

    python prescan.py <module> [--port N] [--dump]   module = un dossier de local/extrait/ (sm, hid, fs...)
                                                     --dump range aussi le pseudo-code de toutes les fonctions
                                                     dans local/analyse/<module>/pseudo/, un .c par fonction

Il faut le pont ouvert (rea_bridge.py serve) ; prescan y ouvre lui-même local/extrait/<module>/exefs/code.elf.

Ce qu'il fait :
1. Repère dans .text toutes les instructions « svc N » (ARM) et leur donne un nom d'après la Carte des services.
2. Demande à REA la fonction qui contient chacune : une fonction courte avec un seul svc est son enveloppe
   (svcReplyAndReceive...), elle est nommée d'office.
3. Cherche dans tout le fichier les mots qui pointent vers du code. Ceux qui ne tombent dans aucune fonction
   connue de Ghidra sont des fonctions manquées : appelées seulement par une table de pointeurs, Ghidra ne les
   crée pas. C'est le cas des gestionnaires de commandes eux-mêmes. Les tables de distances (initialisation des
   objets globaux) sont décodées aussi.
4. Écrit le tout dans fiches/<module>.noms.tsv (adresse, « function », nom éventuel), sans toucher aux noms déjà
   posés, et un résumé dans local/analyse/<module>/prescan.json.

Le fichier de noms sert de graines à REA : relancer le pont avec REA_GHIDRA_SEED_FILE=<chemin /mnt/c/... du .tsv>,
puis relancer prescan, jusqu'à ce qu'il ne trouve plus de fonction manquée (deux passages ont suffi pour sm).
"""
import json
import os
import struct
import sys

import elfer
import rea_bridge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_MAP = os.path.join(os.path.dirname(ROOT), 'carte-des-services', 'donnees.js')
WRAPPER_MAX_BYTES = 0x30


def load_service_map():
    with open(SERVICE_MAP, encoding='utf-8') as f:
        source = f.read()
    start = source.index('const DONNEES = ') + len('const DONNEES = ')
    return json.JSONDecoder().raw_decode(source[start:])[0]


def load_names(path):
    """fiches/<module>.noms.tsv -> {adresse: nom ou None}."""
    names = {}
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                fields = line.rstrip('\n').split('\t')
                if len(fields) >= 2 and fields[0].startswith('0x'):
                    names[int(fields[0], 16)] = fields[2] if len(fields) > 2 and fields[2] else None
    return names


def save_names(path, names):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        for address in sorted(names):
            f.write('%#x\tfunction%s\n' % (address, '\t' + names[address] if names[address] else ''))


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

    call('open_binary', {'path': rea_bridge.to_wsl_path(os.path.join(folder, 'code.elf')), 'provider_id': 'ghidra'})
    procedures = {int(p['address'], 16): p['value'] for p in call('list_procedures', {})}
    svc_names = {entry['n']: entry['nom'] for entry in load_service_map()['svc']}

    # 1 et 2 : les svc, et la fonction qui contient chacun.
    svc_sites, by_procedure = [], {}
    for offset in range(0, text_size - 3, 4):
        word = struct.unpack_from('<I', code, offset)[0]
        if word >> 24 == 0xEF and word & 0xFFFF00 == 0:
            address, number = text_base + offset, word & 0xFF
            owner = call('resolve_containing_procedure', {'address': '%#x' % address})
            entry = int(owner['procedure']['address'], 16) if owner.get('found') else None
            size = owner['procedure']['body']['total_bytes'] if owner.get('found') else None
            svc_sites.append({'address': address, 'number': number, 'name': svc_names.get(number, '?'), 'procedure': entry})
            if entry is not None:
                by_procedure.setdefault(entry, {'size': size, 'numbers': []})['numbers'].append(number)
    # Une enveloppe : une fonction courte avec un seul svc, et la seule de ce genre pour ce numéro. Quand il y en a
    # plusieurs (sept pour SendSyncRequest dans hid), ce sont de petites fonctions qui font autre chose : pas de nom d'office.
    small = {}
    for entry, info in by_procedure.items():
        if len(info['numbers']) == 1 and info['size'] <= WRAPPER_MAX_BYTES:
            small.setdefault(info['numbers'][0], []).append(entry)
    wrappers = {entries[0]: 'svc' + svc_names.get(number, '%02X' % number) for number, entries in small.items() if len(entries) == 1}

    # 3 : les pointeurs vers du code qui ne tombent dans aucune fonction.
    targets, thumb_targets = set(), 0
    for offset in range(0, len(code) - 3, 4):
        word = struct.unpack_from('<I', code, offset)[0]
        if text_base <= word < text_base + text_size:
            if word % 4 == 0:
                targets.add(word)
            elif word % 2 == 1:
                thumb_targets += 1
    def first_word(address):
        return struct.unpack_from('<I', code, address - text_base)[0]

    # Garde-fou : une fonction ARM commence presque toujours par une instruction sans condition (quartet haut à 0xE),
    # et pas par un « bl » : un pointeur vers un « bl » isolé vise la fin d'une fonction qui ne revient pas, et le donner
    # en graine fait déborder la fausse fonction dans la suivante (vu dans hid à 0x102fc4, juste avant l'aiguillage).
    def looks_like_entry(address):
        return first_word(address) >> 28 == 0xE and first_word(address) >> 24 != 0xEB

    # Les tables de distances : la table d'initialisation des objets globaux ne contient pas des adresses mais des
    # distances (cible = mot + adresse de la case). On ne garde que les suites d'au moins trois cases qui tombent
    # toutes sur un début de fonction plausible ; hid en a 23 de suite.
    relative_targets, run = set(), []
    for base, file_offset, file_size, _, _ in segments[1:]:
        for offset in range(0, file_size - 3, 4):
            slot = base + offset
            target = (struct.unpack_from('<I', code, file_offset + offset)[0] + slot) & 0xFFFFFFFF
            if text_base <= target < text_base + text_size and target % 4 == 0 and looks_like_entry(target):
                run.append(target)
                continue
            if len(run) >= 3:
                relative_targets.update(run)
            run = []
        if len(run) >= 3:
            relative_targets.update(run)
        run = []

    outside = [t for t in sorted((targets | relative_targets) - set(procedures))
               if not call('resolve_containing_procedure', {'address': '%#x' % t}).get('found')]
    missed = [t for t in outside if looks_like_entry(t)]
    doubtful = [t for t in outside if not looks_like_entry(t)]
    orphan_svc = [site for site in svc_sites if site['procedure'] is None]

    # La boucle de service : qui appelle l'enveloppe de ReplyAndReceive (svc 0x4F).
    loops = []
    for entry, name in wrappers.items():
        if name == 'svcReplyAndReceive':
            loops += [int(c, 16) for c in call('procedure_callers', {'procedure': '%#x' % entry})]
    loops += [e for e, info in by_procedure.items() if 0x4F in info['numbers'] and e not in wrappers]

    # 4 : le fichier de noms, sans écraser ce qui est déjà nommé.
    names_path = os.path.join(ROOT, 'fiches', module + '.noms.tsv')
    names = load_names(names_path)
    for address, name in wrappers.items():
        # Deux fonctions du même nom : REA n'en nommerait qu'une. D'un passage à l'autre, les graines déplacent les
        # frontières des fonctions et l'enveloppe peut changer d'adresse ; le nom déjà posé gagne.
        if not names.get(address) and name not in names.values():
            names[address] = name
    for address in missed:
        names.setdefault(address, None)
    save_names(names_path, names)

    summary = {'module': module, 'text': [text_base, text_size], 'procedures': len(procedures), 'svc_sites': svc_sites,
               'wrappers': {'%#x' % a: n for a, n in sorted(wrappers.items())}, 'missed_functions': ['%#x' % a for a in missed], 'doubtful_pointers': ['%#x' % a for a in doubtful],
               'service_loops': ['%#x' % a for a in sorted(set(loops))], 'odd_pointers_into_text': thumb_targets}
    out = os.path.join(ROOT, 'local', 'analyse', module)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'prescan.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)

    print('%s : %d fonctions pour Ghidra, .text de %d octets à %#x' % (module, len(procedures), text_size, text_base))
    used = {}
    for site in svc_sites:
        used.setdefault((site['number'], site['name']), []).append(site['address'])
    print('Appels système (%d) :' % len(used))
    for (number, name), addresses in sorted(used.items()):
        print('  %#04x %-26s %s' % (number, name, ' '.join('%#x' % a for a in addresses[:6]) + (' …' if len(addresses) > 6 else '')))
    print('Enveloppes nommées : %d' % len(wrappers))
    print('Boucle(s) de service : %s' % (', '.join('%#x' % a for a in sorted(set(loops))) or 'aucune trouvée'))
    print('Fonctions manquées par Ghidra : %s' % (', '.join('%#x' % a for a in missed) or 'aucune'))
    if doubtful:
        print('Pointeurs écartés (ne ressemblent pas à un début de fonction) : %s' % ', '.join('%#x' % a for a in doubtful))
    if orphan_svc:
        print('Appels système hors de toute fonction, donc une fonction manquée dont il faut trouver le début à la main : %s'
              % ', '.join('%s à %#x' % (site['name'], site['address']) for site in orphan_svc))
    if thumb_targets:
        print('Attention : %d pointeurs impairs vers .text, il y a peut-être du code Thumb que ce balayage ne lit pas.' % thumb_targets)
    if missed:
        print('-> relancer le pont avec REA_GHIDRA_SEED_FILE=%s puis relancer prescan.' % rea_bridge.to_wsl_path(names_path))
    if dump:
        dump_pseudo_code(sorted(procedures), os.path.join(out, 'pseudo'), port)
    return summary


def dump_pseudo_code(addresses, folder, port, batch_size=20):
    """Décompile toutes les fonctions par lots et range un .c par fonction (quelques secondes pour 300 fonctions).
    Le pseudo-code reste dans local/ : il ne se versionne pas."""
    os.makedirs(folder, exist_ok=True)
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
