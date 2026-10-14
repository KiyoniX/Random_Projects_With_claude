"""Une requête d'un fil à un service, et sa réponse (kernel11.md, partie 5 ; contrats, partie 1).

Sur la console, le noyau recopie et traduit la requête du tampon du fil client vers celui du service, puis la
réponse dans l'autre sens. Ici le service est un objet Python dans le même espace d'adresses : la traduction se
résume à lire les descripteurs, à prendre ou donner des objets du noyau par la table des poignées, et à recopier les
tampons statiques que le client a déclarés à +0x180 de son stockage local.

Un service hérite de `Service` et déclare ses commandes par numéro dans `commands` ; chaque méthode reçoit une
`Request` et rend une `Reply`. Le journal note, pour chaque requête, le service, l'en-tête, le nom de la commande
d'après la Carte, la fonction du jeu qui envoie et celle qui l'appelle, et ce qui a été répondu.
"""
import struct

ERR_UNKNOWN_COMMAND = 0xD900182F


class Request:
    def __init__(self, kernel, thread, session):
        self.kernel = kernel
        self.memory = kernel.memory
        self.thread = thread
        self.session = session
        self.cmdbuf = thread.tls + 0x80
        self.header = self.memory.u32(self.cmdbuf)
        self.command = self.header >> 16
        self.normal = self.header >> 6 & 0x3F
        self.translate = self.header & 0x3F
        count = 1 + self.normal + self.translate
        self.w = self.memory.words(self.cmdbuf, min(count, 0x40))
        self.items = {}               # position du descripteur -> ce que le noyau en a fait
        self._parse_translate()

    def _parse_translate(self):
        pos = 1 + self.normal
        end = pos + self.translate
        while pos < end and pos < len(self.w):
            descriptor = self.w[pos]
            if descriptor & 0xE == 0:          # poignées (copiées, déplacées) ou numéro de processus
                if descriptor & 0x20:
                    self.items[pos] = ('pid', self.kernel.process.pid)
                    pos += 2
                    continue
                count = (descriptor >> 26) + 1
                handles = self.w[pos + 1:pos + 1 + count]
                objects = [self.kernel.lookup(h, self.thread) for h in handles]
                if descriptor & 0x10:              # poignées déplacées : fermées chez le client
                    for h in handles:
                        if h not in (0xFFFF8000, 0xFFFF8001):
                            self.kernel.handles.remove(h)
                self.items[pos] = ('handles', objects, handles)
                pos += 1 + count
                continue
            if descriptor & 0xF == 2:              # tampon statique
                size = descriptor >> 14
                index = descriptor >> 10 & 0xF
                address = self.w[pos + 1]
                self.items[pos] = ('static', index, address, size)
                pos += 2
                continue
            if descriptor & 0x8:                   # tampon projeté 0xA, 0xC, 0xE
                size = descriptor >> 4
                address = self.w[pos + 1]
                self.items[pos] = ('buffer', descriptor & 0xF, address, size)
                pos += 2
                continue
            # tampons PXI (genres 4 et 6) : un jeu n'en envoie pas
            self.items[pos] = ('raw', descriptor)
            pos += 2

    # --- lecture pour les services ---

    def word(self, n):
        return self.w[n] if n < len(self.w) else 0

    def s32(self, n):
        value = self.word(n)
        return value - (1 << 32) if value & 0x80000000 else value

    def u64(self, n):
        return self.word(n) | self.word(n + 1) << 32

    def handle_objects(self, pos):
        item = self.items.get(pos)
        return item[1] if item and item[0] == 'handles' else []

    def static_data(self, pos):
        """Les octets d'un tampon statique envoyé par le client (le chemin d'un fichier, par exemple)."""
        item = self.items.get(pos)
        if not item or item[0] != 'static':
            return b''
        return self.memory.read(item[2], item[3]) if item[3] else b''

    def buffer(self, pos):
        """(adresse, taille) d'un tampon projeté ou statique."""
        item = self.items.get(pos)
        if not item:
            return 0, 0
        if item[0] == 'buffer':
            return item[2], item[3]
        if item[0] == 'static':
            return item[2], item[3]
        return 0, 0

    def receive_buffer(self, index):
        """(adresse, taille) du tampon de réception n° index que le client a déclaré à +0x180."""
        descriptor = self.memory.u32(self.thread.tls + 0x180 + 8 * index)
        address = self.memory.u32(self.thread.tls + 0x184 + 8 * index)
        return address, descriptor >> 14


class Reply:
    """La réponse : le résultat, les mots ordinaires, puis les éléments à traduire."""

    def __init__(self, result=0, words=(), header=None):
        self.result = result & 0xFFFFFFFF
        self.words = [w & 0xFFFFFFFF for w in words]
        self.translate = []
        self.header = header          # en-tête imposé (sinon calculé)
        self.note = ''
        self.kind = None              # 'réel', 'simplifié', 'factice' : pour le journal

    def copy_handles(self, *objects):
        self.translate.append(('copy', list(objects)))
        return self

    def move_handles(self, *objects):
        self.translate.append(('move', list(objects)))
        return self

    def static(self, index, data):
        self.translate.append(('static', index, bytes(data)))
        return self

    def raw(self, *words):
        self.translate.append(('raw', [w & 0xFFFFFFFF for w in words]))
        return self

    def with_note(self, text):
        self.note = text
        return self


def error(code, note=''):
    reply = Reply(code, header=0x40)
    reply.note = note
    return reply


class Service:
    """Un service du banc. `name` : son nom pour srv: ; `carte` : son identifiant dans la Carte (pour les noms)."""
    name = '?'
    carte = None
    kind = 'réel'                     # ce que vaut l'ensemble du service : réel, simplifié, factice
    commands = {}

    def __init__(self, bench):
        self.bench = bench
        self.kernel = bench.kernel
        self.memory = bench.kernel.memory

    def handle(self, request):
        method = self.commands.get(request.command)
        if method is None:
            return self.unknown(request)
        return getattr(self, method)(request)

    def unknown(self, request):
        return error(ERR_UNKNOWN_COMMAND, 'commande inconnue du banc')

    def session(self, name=None):
        """Une nouvelle session vers ce service (le bout client, à mettre dans la table des poignées)."""
        from kernel import ClientSession
        return ClientSession(self.kernel, self, name or self.name)


def write_reply(kernel, request, reply):
    memory = kernel.memory
    words = [reply.result] + reply.words
    translated = []
    for item in reply.translate:
        if item[0] in ('copy', 'move'):
            objects = item[1]
            translated.append((len(objects) - 1) << 26 | (0x10 if item[0] == 'move' else 0))
            for obj in objects:
                translated.append(kernel.add_handle(obj) if obj is not None else 0)
        elif item[0] == 'static':
            index, data = item[1], item[2]
            address, size = request.receive_buffer(index)
            data = data[:size]
            if data:
                memory.write(address, data)
            translated += [len(data) << 14 | index << 10 | 2, address]
        else:
            translated += item[1]
    header = reply.header
    if header is None:
        header = request.command << 16 | len(words) << 6 | len(translated)
    if header == 0x40:
        words = [reply.result]
        translated = []
    elif header & 0xFFFF0000 == 0:
        header |= request.command << 16
    memory.write(request.cmdbuf, struct.pack('<%dI' % (1 + len(words) + len(translated)), header, *words,
                                             *translated))
    return header, words, translated


def dispatch(kernel, thread, session):
    handler = session.handler
    request = Request(kernel, thread, session)
    pc = kernel.cpu.get('pc') - 4
    lr = kernel.cpu.get('lr')
    try:
        reply = handler.handle(request)
    except Exception as exc:       # une erreur du banc lui-même : on la montre dans le journal et on s'arrête
        kernel.journal.ipc(kernel, thread, session, request, None, pc, lr, None)
        raise
    if reply is None:
        reply = error(ERR_UNKNOWN_COMMAND, 'le service n\'a rien rendu')
    if reply.kind is None:
        reply.kind = getattr(handler, 'kind', 'réel')
    written = write_reply(kernel, request, reply)
    kernel.journal.ipc(kernel, thread, session, request, reply, pc, lr, written)
    after = getattr(handler, 'after_reply', None)
    if after:
        after(request, reply)
