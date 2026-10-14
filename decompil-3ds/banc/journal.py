"""Le journal du banc : chaque appel système, chaque requête IPC, les fils, les modules, les paliers.

Il écrit `journal.txt` au fil de l'eau (une ligne par événement, heure du banc en tête) et garde les comptes qui
servent au résumé. Les appels système très fréquents et sans intérêt (GetSystemTick, les verrous) ne sont écrits
que s'ils changent quelque chose ; les autres le sont tous.
"""
import collections
import os


def hex_words(words, limit=8):
    text = ' '.join('%08x' % w for w in words[:limit])
    return text + (' …' if len(words) > limit else '')


class Journal:
    def __init__(self, path, names, max_lines=400000):
        self.path = path
        self.names = names
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.out = open(path, 'w', encoding='utf-8', newline='\n')
        self.lines = 0
        self.max_lines = max_lines
        self.truncated = 0
        self.ipc_counts = collections.Counter()      # (service, en-tête, nom) -> nombre
        self.ipc_kinds = {}                           # service -> réel / simplifié / factice
        self.ipc_first = {}                           # (service, en-tête) -> première ligne
        self.ipc_errors = []                          # requêtes qui ont rendu une erreur
        self.threads = []
        self.modules = []
        self.milestones = collections.OrderedDict()   # palier -> (heure, texte)
        self.notes = []                               # écarts et faits remarquables
        self.ipc_order = []                           # (service, nom) dans l'ordre de la première apparition
        self.last_ipc = collections.deque(maxlen=40)
        self.last_svc = collections.deque(maxlen=40)
        self.kernel = None

    def stamp(self, kernel):
        return '[%10.3f ms]' % (kernel.now / 1e6)

    def write(self, kernel, text):
        line = '%s %s' % (self.stamp(kernel), text)
        if self.lines < self.max_lines:
            self.out.write(line + '\n')
            self.lines += 1
        else:
            self.truncated += 1
        return line

    def where(self, pc, lr):
        return '@%#x %s <- %#x %s' % (pc, self.names.function(pc) or '?', lr, self.names.function(lr - 4) or '?')

    def svc(self, kernel, thread, number, pc, lr, summary):
        name = self.names.svc(number)
        if summary.startswith(name):
            summary = summary[len(name):]
        line = self.write(kernel, 'f%x svc %02X %s%s   %s' % (thread.thread_id, number, name,
                                                           summary if summary.startswith('(') else ' ' + summary,
                                                           self.where(pc, lr)))
        self.last_svc.append(line)

    def ipc(self, kernel, thread, session, request, reply, pc, lr, written):
        handler = session.handler
        service = getattr(handler, 'carte', None) or handler.name
        label = session.name
        name = self.names.command(service, request.header)
        if reply is None:
            text = 'f%x IPC %s %08x %s [%s] -> exception du banc' % (thread.thread_id, label, request.header, name,
                                                                     hex_words(request.w[1:]))
            self.last_ipc.append(self.write(kernel, text))
            return
        header, words, translated = written
        kind = reply.kind
        self.ipc_kinds.setdefault(label, set()).add(kind)
        key = (label, request.header, name)
        self.ipc_counts[key] += 1
        if (label, name) not in self.ipc_order:
            self.ipc_order.append((label, name))
        text = 'f%x IPC %s %08x %s (%s) [%s] -> %08x %08x [%s]%s   %s' % (
            thread.thread_id, label, request.header, name, kind, hex_words(request.w[1:]), header, reply.result,
            hex_words(words[1:] + translated), ('  « %s »' % reply.note) if reply.note else '', self.where(pc, lr))
        line = self.write(kernel, text)
        self.last_ipc.append(line)
        self.ipc_first.setdefault((label, request.header), line)
        if reply.result & 0x80000000:
            self.ipc_errors.append(line)

    def thread_created(self, kernel, parent, thread):
        self.threads.append((kernel.now, parent.thread_id if parent else None, thread))
        self.write(kernel, 'fil %#x créé : entrée %#x %s, priorité %#x, cœur %d, pile %#x, stockage local %#x' % (
            thread.thread_id, thread.entry, self.names.function(thread.entry), thread.priority, thread.core,
            thread.stack_top, thread.tls))

    def module(self, kernel, text):
        self.modules.append((kernel.now, text))
        self.write(kernel, 'module : ' + text)

    def milestone(self, kernel, key, text):
        if key in self.milestones:
            return
        self.milestones[key] = (kernel.now, text)
        self.write(kernel, '=== palier %s : %s' % (key, text))

    def note(self, kernel, text):
        if text in (n for _, n in self.notes):
            return
        self.notes.append((kernel.now, text))
        self.write(kernel, 'ÉCART : ' + text)

    def close(self):
        if self.truncated:
            self.out.write('… %d lignes de plus non écrites (limite %d)\n' % (self.truncated, self.max_lines))
        self.out.close()
