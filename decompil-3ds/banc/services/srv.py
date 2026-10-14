"""`srv:`, le registre des services (contrat des petits services, partie 1 ; fiche sm).

Réel : RegisterClient, EnableNotification (un vrai sémaphore, libéré seulement quand une notification est en
file), GetServiceHandle (une session neuve vers le service Python du même nom), Subscribe, ReceiveNotification.
Un nom que le banc ne connaît pas reçoit une session vers un service factice, signalée dans le journal.
"""
from ipc import Reply, Service, error
from kernel import Semaphore


class Srv(Service):
    name = 'srv:'
    carte = 'srv:'
    commands = {0x0001: 'register_client', 0x0002: 'enable_notification', 0x0005: 'get_service_handle',
                0x0009: 'subscribe', 0x000A: 'unsubscribe', 0x000B: 'receive_notification',
                0x000C: 'publish_to_subscriber'}

    def __init__(self, bench):
        super().__init__(bench)
        self.semaphore = None
        self.subscribed = set()
        self.queue = []

    def register_client(self, req):
        if req.header != 0x00010002 or req.word(1) != 0x20:
            return error(0xD9001830, 'en-tête ou descripteur inattendu')
        return Reply(0).with_note('processus %#x' % self.kernel.process.pid)

    def enable_notification(self, req):
        if self.semaphore is None:
            self.semaphore = Semaphore(self.kernel, 0, 16, 'notifications de srv:')
        return Reply(0).copy_handles(self.semaphore).with_note(self.semaphore.label())

    def get_service_handle(self, req):
        raw = req.memory.read(req.cmdbuf + 4, 8)
        length = req.word(3)
        name = raw[:min(length, 8)].split(b'\0')[0].decode('latin-1')
        service = self.bench.service_for(name)
        reply = Reply(0).move_handles(service.session(name))
        reply.note = '%s -> %s (%s)' % (name, type(service).__name__, service.kind)
        return reply

    def subscribe(self, req):
        number = req.word(1)
        if self.semaphore is None:
            return error(0xD8806404, 'Subscribe avant EnableNotification')
        if number in self.subscribed:
            return Reply(0xD9006403).with_note('déjà inscrit')
        self.subscribed.add(number)
        return Reply(0).with_note('notification %#x retenue (le banc n\'en publie aucune)' % number)

    def unsubscribe(self, req):
        self.subscribed.discard(req.word(1))
        return Reply(0)

    def receive_notification(self, req):
        if not self.queue:
            return Reply(0xD8806404).with_note('aucune notification en file')
        return Reply(0, [self.queue.pop(0)])

    def publish_to_subscriber(self, req):
        return Reply(0)

    def publish(self, number):
        """Pour simuler une notification (0x209 : carte SD retirée). Le banc ne s'en sert pas par défaut."""
        if self.semaphore is None:
            return
        self.queue.append(number)
        self.semaphore.count += 1
        self.kernel.wake_waiters()
