"""Ce que le noyau du banc attend d'un processeur : une interface étroite.

Le noyau, les services et le chargeur de modules ne parlent jamais à unicorn. Ils voient un objet qui sait :
- lire et écrire les registres du fil en cours (`get`, `set`, `regs`) ;
- garder et reprendre l'état complet d'un fil (`save`, `restore`, `new_context`) ;
- faire avancer le fil en cours jusqu'à un appel système, une faute ou un nombre d'instructions (`run`) ;
- oublier ce qu'il a traduit d'une plage de code quand Python l'a réécrite (`invalidate`).

La mémoire n'est pas ici : elle est dans `memory.AddressSpace`, que le processeur suit par des rappels. Le jour où le
code ARM du jeu sera recompilé pour le PC, ce fichier et `cpu_unicorn.py` disparaîtront ; le noyau et les services
resteront, branchés sur une autre réalisation de la même interface (ou appelés directement par le code recompilé).
"""

# Noms des registres tels que le noyau les demande.
REGISTERS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc', 'cpsr']


class Stop:
    """Pourquoi `run` a rendu la main."""
    SVC = 'svc'            # un appel système : `number` est son numéro, pc est déjà après l'instruction
    LIMIT = 'limit'        # le nombre d'instructions demandé est atteint
    FAULT = 'fault'        # une faute : `detail` dit laquelle, `address` où
    REQUEST = 'request'    # le noyau a demandé l'arrêt (depuis un rappel de `watch`)

    def __init__(self, kind, number=None, address=None, detail=''):
        self.kind = kind
        self.number = number
        self.address = address
        self.detail = detail

    def __repr__(self):
        return '<Stop %s %s %s %s>' % (self.kind, self.number, self.address, self.detail)


class Cpu:
    """L'interface. Voir `cpu_unicorn.UnicornCpu` pour la seule réalisation actuelle."""

    def get(self, name):
        raise NotImplementedError

    def set(self, name, value):
        raise NotImplementedError

    def regs(self):
        return {name: self.get(name) for name in REGISTERS}

    def new_context(self, pc, sp, r0, tls, thumb=False):
        """Un état neuf de fil : rendu par `save`, repris par `restore`."""
        raise NotImplementedError

    def save(self):
        raise NotImplementedError

    def restore(self, context):
        raise NotImplementedError

    def run(self, max_instructions):
        """Fait tourner le fil en cours. Rend un `Stop`."""
        raise NotImplementedError

    def invalidate(self, start, size):
        raise NotImplementedError

    def watch(self, address, callback, once=False):
        """Appelle callback(address) quand un fil exécute cette adresse (repères des paliers) ; une seule fois si
        `once`, ce qui ne ralentit plus l'exécution ensuite."""
        raise NotImplementedError

    def request_stop(self):
        """Depuis un rappel : rendre la main au noyau dès que possible (Stop.REQUEST)."""
        raise NotImplementedError
