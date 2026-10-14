"""Les services réseau et accessoires : des réponses factices (pokemon-x-services.md, partie 6).

`ndm:u`, `frd:u`, `boss:U`, `ac:u`, `cecd:u`, `http:C`, `ssl:C`, `soc:U`, `ir:USER`, `mic:u`, `cam:u`, `y2r:u`,
`nwm::UDS`, et tout nom que le banc ne connaît pas. Chaque commande rend 0 et quelques mots à zéro ; quelques
commandes reçoivent une réponse un peu plus précise quand le démarrage en dépend (la liste d'amis vide, « pas
connecté »). Tout passe au journal avec la mention « factice », pour qu'on sache ce qu'il faudra écrire vraiment.
"""
from ipc import Reply, Service

STUB_WORDS = 4


class Stub(Service):
    kind = 'factice'

    def __init__(self, bench, name):
        super().__init__(bench)
        self.name = name
        self.carte = name
        self.seen = set()

    def handle(self, req):
        special = SPECIAL.get((self.name, req.command))
        if special:
            reply = special(self, req)
        else:
            reply = Reply(0, [0] * STUB_WORDS)
        if req.command not in self.seen:
            self.seen.add(req.command)
            reply.note = (reply.note + ' ; ' if reply.note else '') + 'première fois'
        return reply


def frd_friend_key_list(service, req):
    _, room = req.receive_buffer(0)
    return Reply(0, [0]).static(0, bytes(min(room, 8))).with_note('aucun ami')


def frd_my_presence(service, req):
    _, room = req.receive_buffer(0)
    return Reply(0).static(0, bytes(min(room, 0x12C)))


def ac_wifi_status(service, req):
    return Reply(0, [0]).with_note('pas connecté')


def static_zero(service, req):
    _, room = req.receive_buffer(0)
    return Reply(0, [0]).static(0, bytes(room))


SPECIAL = {
    ('frd:u', 0x0011): frd_friend_key_list,
    ('frd:u', 0x0008): frd_my_presence,
    ('ac:u', 0x000D): ac_wifi_status,
}


class Y2r(Stub):
    """`y2r:u`, la conversion YUV vers RGB (l'écran-titre s'en sert pour sa vidéo).

    Factice, mais avec ce que le jeu attend pour ne pas s'arrêter : un vrai signal de fin de transfert
    (GetTransferEndEvent), levé 1 ms du banc après StartConversion ; « fini » à toutes les questions. Rien n'est
    converti : l'image reçue reste celle qui était dans le tampon.
    """

    def __init__(self, bench, name='y2r:u'):
        super().__init__(bench, name)
        from kernel import Event
        self.end_event = Event(self.kernel, 0, 'y2r : fin de transfert')
        self.conversions = 0

    def handle(self, req):
        command = req.command
        if command == 0x000F:
            reply = Reply(0).copy_handles(self.end_event)
        elif command == 0x0026:
            self.conversions += 1
            self.kernel.schedule(self.kernel.now + 1_000_000, self.end_event.signal)
            reply = Reply(0).with_note('conversion %d : rien n\'est converti, fin signalée dans 1 ms' % self.conversions)
        elif command in (0x0014, 0x0015, 0x0016, 0x0017, 0x0019, 0x002A):
            reply = Reply(0, [1])
        elif command == 0x0028:
            reply = Reply(0, [0])
        else:
            return super().handle(req)
        if command not in self.seen:
            self.seen.add(command)
            reply.note = (reply.note + ' ; ' if reply.note else '') + 'première fois'
        return reply
