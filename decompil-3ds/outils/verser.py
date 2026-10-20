"""Verse dans fiches/<m>.noms.tsv une liste relue de noms de local/analyse/<m>/noms-proposes.tsv.

    python outils/verser.py <decision.json>

decision.json : {module: {"accept": [adresses hex], "override": {adresse: nom}, "file": "noms-proposes-2.tsv",
"promote": true}}, écrit à la main d'après le rapport du vérificateur ; un module peut aussi recevoir une liste de ces
objets (un par fichier de propositions). Une adresse acceptée déjà nommée dans la fiche est renommée ; les autres
s'ajoutent si elles sont haute, ou si « promote » dit que la relecture a apporté la seconde voie (envois suivis par
ipc_trace). Une ligne déjà dans la fiche avec le même nom est sautée ; tout autre doublon (nom ou adresse) arrête le
script avant d'écrire.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'outils'))
import name_pass  # noqa: E402

decision = json.load(open(sys.argv[1], encoding='utf-8'))
def verse(module, d):
    accept = {int(a, 16) for a in d['accept']}
    override = {int(a, 16): n for a, n in d.get('override', {}).items()}
    fiche = os.path.join(ROOT, 'fiches', module + '.noms.tsv')
    rows = [l.rstrip('\r\n').split('\t') for l in open(os.path.join(ROOT, 'local', 'analyse', module, d.get('file', 'noms-proposes.tsv')), encoding='utf-8')][1:]
    text = open(fiche, encoding='utf-8', newline='').read()
    ending = '\r\n' if '\r\n' in text else '\n'
    lines = text.replace('\r\n', '\n').split('\n')
    current = {}
    for line in lines:
        f = line.split('\t')
        if line.startswith('0x') and len(f) > 2 and f[2]:
            current[int(f[0], 16)] = f[2]
    renames, additions, skipped = {}, [], 0
    for address, kind, name, confidence, proof in rows:
        a = int(address, 16)
        if a not in accept:
            continue
        accept.discard(a)
        name = override.get(a, name)
        if current.get(a) == name:
            skipped += 1
        elif a in current:
            renames[a] = name
        elif confidence == 'haute' or d.get('promote'):
            additions.append((a, kind, name))
        else:
            skipped += 1  # une correction moyenne d'un nom proposé n'entre pas dans la fiche
    assert not accept, '%s : adresses acceptées absentes des propositions : %s' % (module, sorted(map(hex, accept)))
    final = dict(current)
    final.update(renames)
    final.update({a: n for a, _, n in additions})
    names = list(final.values())
    dup = sorted({n for n in names if names.count(n) > 1})
    assert not dup, '%s : noms en double : %s' % (module, dup)
    for i, line in enumerate(lines):
        f = line.split('\t')
        if line.startswith('0x') and int(f[0], 16) in renames:
            f[2] = renames[int(f[0], 16)]
            lines[i] = '\t'.join(f)
    with open(fiche, 'w', encoding='utf-8', newline='') as out:
        out.write(ending.join(lines))
    name_pass.merge_lines(fiche, additions, keep_sorted=True)
    print('%s : %d ajoutés, %d renommés, %d déjà là' % (module, len(additions), len(renames), skipped))


for module, entries in decision.items():
    for d in entries if isinstance(entries, list) else [entries]:
        verse(module, d)
