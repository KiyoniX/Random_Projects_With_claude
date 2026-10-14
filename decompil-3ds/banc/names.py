"""Les noms qui rendent le journal lisible : fonctions du jeu, appels système, commandes des services.

- Fonctions du jeu : `fiches/pokemon-x.noms.tsv` (versionné) ; les débuts de fonction de Ghidra
  (`local/analyse/maj/gh/funcs.tsv`, s'il existe) servent à dire dans quelle fonction tombe une adresse, même
  quand elle n'a pas de nom.
- Appels système et commandes IPC : la Carte des services (`../carte-des-services/donnees.js`), lue telle quelle.
Rien ici n'est indispensable : sans ces fichiers, le journal donne des adresses nues.
"""
import bisect
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NAMES_TSV = os.path.join(ROOT, 'fiches', 'pokemon-x.noms.tsv')
GHIDRA_FUNCS = os.path.join(ROOT, 'local', 'analyse', 'maj', 'gh', 'funcs.tsv')
CARTE = os.path.join(os.path.dirname(ROOT), 'carte-des-services', 'donnees.js')


def load_carte(path=CARTE):
    try:
        text = open(path, encoding='utf-8').read()
    except OSError:
        return None
    start = text.index('{')
    data, _ = json.JSONDecoder().raw_decode(text[start:])
    return data


class Names:
    def __init__(self, names_tsv=NAMES_TSV, funcs_tsv=GHIDRA_FUNCS, carte=CARTE):
        self.named = {}                  # adresse -> nom
        self.starts = []                 # débuts de fonction triés
        self.ends = {}                   # début -> fin (si Ghidra la donne)
        if os.path.isfile(names_tsv):
            for line in open(names_tsv, encoding='utf-8'):
                parts = line.rstrip('\n').split('\t')
                if len(parts) >= 3 and parts[2] and parts[0].startswith('0x'):
                    self.named[int(parts[0], 16)] = parts[2]
        starts = set(self.named)
        if os.path.isfile(funcs_tsv):
            for line in open(funcs_tsv, encoding='utf-8'):
                parts = line.rstrip('\n').split('\t')
                if len(parts) >= 2 and parts[0].startswith('0x'):
                    address = int(parts[0], 16)
                    starts.add(address)
                    try:
                        self.ends[address] = address + int(parts[1])
                    except ValueError:
                        pass
        self.starts = sorted(starts)
        self.modules = []                # (début, fin, nom) des modules .cro chargés, tenu par le banc
        self.svc_names = {}
        self.commands = {}               # (service, en-tête) -> nom
        self.command_ids = {}            # (service, numéro) -> nom
        data = load_carte(carte)
        if data:
            for entry in data.get('svc', []):
                self.svc_names[entry['n']] = entry['nom']
            for service in data.get('services', []):
                for command in service.get('commandes', []):
                    header = int(command['h'], 16)
                    self.commands[(service['id'], header)] = command['n']
                    self.command_ids.setdefault((service['id'], header >> 16), command['n'])

    def function(self, address):
        """« nom » ou « FUN_xxxxxxxx+décalage » pour une adresse de code, ou '' si on ne sait pas."""
        address &= ~1
        for start, end, name in self.modules:
            if start <= address < end:
                return '%s+%#x' % (name, address - start)
        index = bisect.bisect_right(self.starts, address) - 1
        if index < 0:
            return ''
        start = self.starts[index]
        end = self.ends.get(start)
        if end is not None and address >= end and address - start > 0x2000:
            return ''
        if address - start > 0x10000:
            return ''
        name = self.named.get(start, 'FUN_%08x' % start)
        return name if address == start else '%s+%#x' % (name, address - start)

    def svc(self, number):
        return self.svc_names.get(number, 'svc_%02X' % number)

    def command(self, service, header):
        name = self.commands.get((service, header))
        if name:
            return name
        name = self.command_ids.get((service, header >> 16))
        return name + ' (en-tête différent de la Carte)' if name else '?'
