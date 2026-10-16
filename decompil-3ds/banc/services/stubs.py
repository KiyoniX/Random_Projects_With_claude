"""Les services réseau et accessoires : des réponses factices (pokemon-x-services.md, partie 6).

`y2r:u` (réel pour la conversion) et tout nom que le banc ne connaît pas. Chaque commande rend 0 et quelques mots à
zéro. Tout passe au journal avec la mention « factice », pour qu'on sache ce qu'il faudra écrire vraiment.

Les treize modules qui ont une fiche (`nwm::UDS`, `boss:U`, `ssl:C`, `cecd:u`, `cam:u`, `mic:u`, `ir:USER`,
`ndm:u`, `ac:u`, `frd:u`, `soc:U`, `http:C`, `boss:M`) ne passent plus par ici : `Stub(bench, nom)` rend la classe
de `modules.py`, écrite d'après la fiche, qui n'est plus « factice » mais « simplifiée » ou « réelle ».
"""
from ipc import Reply, Service
from services.reply_shapes import Y2R_U

STUB_WORDS = 4


class Stub(Service):
    kind = 'factice'

    def __new__(cls, bench=None, name=None):
        """`Stub(bench, nom)` rend la classe écrite d'après la fiche du module quand il y en a une (modules.py)."""
        if cls is Stub:
            from services.modules import MODULES
            cls = MODULES.get(name, Stub)
        return object.__new__(cls)

    def __init__(self, bench, name):
        super().__init__(bench)
        self.name = name
        self.carte = name
        self.seen = set()

    def handle(self, req):
        reply = Reply(0, [0] * STUB_WORDS)
        if req.command not in self.seen:
            self.seen.add(req.command)
            reply.note = (reply.note + ' ; ' if reply.note else '') + 'première fois'
        return reply


class Y2r(Stub):
    """`y2r:u`, la conversion YUV vers RGB (l'écran-titre s'en sert pour sa vidéo).

    Les réglages sont retenus ; à StartConversion la conversion est faite pour de bon (planes Y, U, V lues dans la
    mémoire du jeu, RGB écrit à l'adresse de réception, en tuiles de 8 x 8 si le jeu l'a demandé) et la fin est
    signalée par un vrai événement (GetTransferEndEvent), 1 ms du banc plus tard. Faits : entrées YUV 4:2:0 et
    4:2:2 en plans séparés, sorties RGB32, RGB24, RGB15, RGB565, les coefficients ITU 601 et 709 avec ou sans mise à
    l'échelle. Pas faits : l'entrée YUYV en un seul plan, la rotation.
    """
    SETTERS = {0x0001: 'input_format', 0x0003: 'output_format', 0x0005: 'rotation', 0x0007: 'block_alignment',
               0x001A: 'line_width', 0x001C: 'lines', 0x0020: 'coefficient', 0x0022: 'alpha'}
    PLANES = {0x0010: 'y', 0x0011: 'u', 0x0012: 'v', 0x0018: 'out'}

    def __init__(self, bench, name='y2r:u'):
        super().__init__(bench, name)
        from kernel import Event
        self.end_event = Event(self.kernel, 0, 'y2r : fin de transfert')
        self.conversions = 0
        self.settings = {'input_format': 1, 'output_format': 0, 'rotation': 0, 'block_alignment': 0, 'line_width': 0,
                         'lines': 0, 'coefficient': 0, 'alpha': 255}
        self.planes = {}
        self.problems = []

    def handle(self, req):
        command = req.command
        if command in self.SETTERS:
            self.settings[self.SETTERS[command]] = req.word(1)
        elif command in self.PLANES:
            self.planes[self.PLANES[command]] = (req.word(1), req.word(2), req.word(3), req.word(4))
        if command == 0x000F:
            reply = Reply(0).copy_handles(self.end_event)
        elif command == 0x0026:
            self.conversions += 1
            note = self.convert()
            self.kernel.schedule(self.kernel.now + 1_000_000, self.end_event.signal)
            reply = Reply(0).with_note('conversion %d : %s' % (self.conversions, note))
        elif command in (0x0014, 0x0015, 0x0016, 0x0017, 0x0019, 0x002A):
            reply = Reply(0, [1])
        elif command == 0x0028:
            reply = Reply(0, [0])
        elif command in Y2R_U:
            from services.modules import neutral_reply
            reply = neutral_reply(req, Y2R_U[command])
        else:
            return super().handle(req)
        if command not in self.seen:
            self.seen.add(command)
            reply.note = (reply.note + ' ; ' if reply.note else '') + 'première fois'
        return reply

    def convert(self):
        import numpy as np
        from pica import formats
        s = self.settings
        width, lines = s['line_width'], s['lines']
        if not width or not lines or 'y' not in self.planes or 'out' not in self.planes:
            return "réglages incomplets, rien n'est converti"
        if s['input_format'] not in (0, 1) or 'u' not in self.planes or 'v' not in self.planes:
            self.problems.append('entrée de format %d non faite' % s['input_format'])
            return "entrée de format %d : rien n'est converti" % s['input_format']

        def plane(name, w, h):
            address, size, unit, gap = self.planes[name]
            pitch = unit + gap
            raw = np.frombuffer(self.memory.read(address, size), dtype=np.uint8)
            rows = np.zeros((h, w), dtype=np.uint8)
            for line in range(h):
                chunk = raw[line * pitch:line * pitch + w]
                rows[line, :len(chunk)] = chunk
            return rows
        try:
            y = plane('y', width, lines).astype(np.float32)
            chroma_lines = lines // 2 if s['input_format'] == 1 else lines
            u = np.repeat(np.repeat(plane('u', width // 2, chroma_lines), 2, axis=1), lines // chroma_lines,
                          axis=0).astype(np.float32) - 128
            v = np.repeat(np.repeat(plane('v', width // 2, chroma_lines), 2, axis=1), lines // chroma_lines,
                          axis=0).astype(np.float32) - 128
        except Exception as exc:
            self.problems.append('lecture refusée : %s' % exc)
            return 'lecture refusée (%s)' % exc
        rgb = yuv_to_rgb(y, u, v, s['coefficient'])
        out_format = s['output_format']
        alpha = np.full((lines, width), s['alpha'] & 255, dtype=np.uint8)
        rgba = np.concatenate([rgb, alpha[..., None]], axis=2)
        names = {0: 'RGBA8', 1: 'RGB8', 2: 'RGB5A1', 3: 'RGB565'}
        fmt = names.get(out_format, 'RGBA8')
        unit_bytes = formats.BYTES_PER_PIXEL[fmt]
        encoded = formats.encode_pixels(fmt, rgba)
        if s['block_alignment'] == 1:
            stream = formats.linear_to_tiled(encoded, unit_bytes).tobytes()
        else:
            stream = encoded.tobytes()
        address, size, unit, gap = self.planes['out']
        unit = unit or len(stream)
        try:
            position = 0
            while position < min(len(stream), size):
                chunk = stream[position:position + unit]
                self.memory.write(address, chunk)
                address += unit + gap
                position += unit
        except Exception as exc:
            self.problems.append('écriture refusée : %s' % exc)
            return 'écriture refusée (%s)' % exc
        return '%dx%d en %s%s, fin signalée dans 1 ms' % (width, lines, fmt, ' par blocs' if s['block_alignment'] == 1 else '')


def yuv_to_rgb(y, u, v, coefficient):
    """Y, U, V (U et V centrés sur 0) -> RGB uint8. 0 et 1 : plage réduite ; 2 et 3 : pleine plage ; 0/2 : Rec. 601."""
    import numpy as np
    if coefficient in (1, 3):
        kr, kgu, kgv, kb = 1.5748, 0.187324, 0.468124, 1.8556
    else:
        kr, kgu, kgv, kb = 1.402, 0.344136, 0.714136, 1.772
    if coefficient in (0, 1):
        y = (y - 16) * (255 / 219)
        u, v = u * (255 / 224), v * (255 / 224)
    out = np.empty(y.shape + (3,), dtype=np.uint8)
    out[..., 0] = np.clip(y + kr * v + 0.5, 0, 255)
    out[..., 1] = np.clip(y - kgu * u - kgv * v + 0.5, 0, 255)
    out[..., 2] = np.clip(y + kb * u + 0.5, 0, 255)
    return out
