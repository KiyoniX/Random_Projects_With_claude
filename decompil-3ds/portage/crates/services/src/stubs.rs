//! Les services réseau et accessoires : des réponses factices (pokemon-x-services.md, partie 6). Même rôle que
//! `banc/services/stubs.py`.
//!
//! `y2r:u` (réel pour la conversion) et tout nom que le banc ne connaît pas. Chaque commande rend 0 et quelques mots à
//! zéro. Tout passe au journal avec la mention « factice », pour qu'on sache ce qu'il faudra écrire vraiment.
//!
//! Les treize modules qui ont une fiche (`nwm::UDS`, `boss:U`, `ssl:C`, `cecd:u`, `cam:u`, `mic:u`, `ir:USER`, `ndm:u`,
//! `ac:u`, `frd:u`, `soc:U`, `http:C`, `boss:M`) ne passent plus par le factice : `make_service` rend le module de
//! `modules.rs`, écrit d'après la fiche, qui n'est plus « factice » mais « simplifié » ou « réel ».
//!
//! Les deux sous-modules (`reply_shapes.rs`, `modules.rs`) sont déclarés ici par `#[path]`, sans passer par `lib.rs`.

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::rc::Rc;

use kernel::ipc::{Reply, Request, Service};
use kernel::kernel::Kernel;
use kernel::object::{ObjId, RESET_ONESHOT};

#[path = "modules.rs"]
pub mod modules;
#[path = "reply_shapes.rs"]
pub mod reply_shapes;

use modules::{first_time, neutral_reply};

pub const STUB_WORDS: usize = 4;

/// `Stub` : un service factice, tout répond 0 et quatre mots à zéro.
pub struct Stub {
    name: String,
    seen: BTreeSet<u32>,
}

impl Stub {
    pub fn new(name: &str) -> Stub {
        Stub { name: name.to_string(), seen: BTreeSet::new() }
    }

    fn answer(&mut self, req: &Request) -> Reply {
        let mut reply = Reply::with_words(0, &[0; STUB_WORDS]);
        first_time(&mut self.seen, req.command, &mut reply);
        reply
    }
}

impl Service for Stub {
    fn name(&self) -> &str {
        &self.name
    }

    fn kind(&self) -> &'static str {
        "factice"
    }

    fn handle(&mut self, _k: &mut Kernel, req: &Request) -> Reply {
        self.answer(req)
    }
}

/// `Bench.service_for` pour un nom que le banc ne connaît pas : `Y2r` pour `y2r:u`, sinon `Stub(bench, nom)`, qui choisit
/// la classe de `MODULES` ou le factice. C'est la fabrique à brancher sur `Kernel::service_factory`.
pub fn make_service(k: &mut Kernel, name: &str) -> Rc<RefCell<dyn Service>> {
    if name == "y2r:u" {
        return Rc::new(RefCell::new(Y2r::new(k, name)));
    }
    match modules::make_module(k, name) {
        Some(service) => service,
        None => Rc::new(RefCell::new(Stub::new(name))),
    }
}

/// Le rang de Morton d'un point (x, y) dans une tuile 8 x 8 (x en bit de poids faible).
fn morton(x: usize, y: usize) -> usize {
    (x & 1) | ((y & 1) << 1) | ((x & 2) << 1) | ((y & 2) << 2) | ((x & 4) << 2) | ((y & 4) << 3)
}

/// Lignes de `width * unit` octets -> octets en tuiles de 8 x 8 (largeur et hauteur complétées à 8 par des zéros).
/// Comme `formats::linear_to_tiled` (crate `formats`, pas encore en dépendance de `services`).
fn linear_to_tiled(image: &[u8], width: usize, height: usize, unit: usize) -> Vec<u8> {
    let (tw, th) = (width.div_ceil(8), height.div_ceil(8));
    let mut out = vec![0u8; tw * th * 64 * unit];
    for y in 0..height {
        for x in 0..width {
            let dst = (((y / 8) * tw + x / 8) * 64 + morton(x % 8, y % 8)) * unit;
            let src = (y * width + x) * unit;
            out[dst..dst + unit].copy_from_slice(&image[src..src + unit]);
        }
    }
    out
}

/// RGBA -> les octets du format de couleur (0 RGBA8, 1 RGB8, 2 RGB5A1, 3 RGB565), mêmes troncatures que `formats.py`.
fn encode_pixels(format: u32, rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for p in rgba.chunks_exact(4) {
        let (r, g, b, a) = (p[0] as u32, p[1] as u32, p[2] as u32, p[3] as u32);
        match format {
            1 => out.extend_from_slice(&[p[2], p[1], p[0]]),
            2 | 3 => {
                let value = if format == 3 {
                    ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
                } else {
                    ((r >> 3) << 11) | ((g >> 3) << 6) | ((b >> 3) << 1) | (a >> 7)
                };
                out.extend_from_slice(&[(value & 0xFF) as u8, (value >> 8) as u8]);
            }
            _ => out.extend_from_slice(&[p[3], p[2], p[1], p[0]]),
        }
    }
    out
}

/// Y, U, V (U et V centrés sur 0) -> RGB. 0 et 1 : plage réduite ; 2 et 3 : pleine plage ; 0/2 : Rec. 601. En
/// `f32`, comme le Python (numpy, `float32`), pour les mêmes arrondis.
pub fn yuv_to_rgb(y: f32, u: f32, v: f32, coefficient: u32) -> [u8; 3] {
    let (kr, kgu, kgv, kb): (f32, f32, f32, f32) = if coefficient == 1 || coefficient == 3 {
        (1.5748, 0.187324, 0.468124, 1.8556)
    } else {
        (1.402, 0.344136, 0.714136, 1.772)
    };
    let (mut y, mut u, mut v) = (y, u, v);
    if coefficient == 0 || coefficient == 1 {
        y = (y - 16.0) * (255.0f64 / 219.0) as f32;
        u *= (255.0f64 / 224.0) as f32;
        v *= (255.0f64 / 224.0) as f32;
    }
    let clip = |x: f32| x.clamp(0.0, 255.0) as u8;
    [clip(y + kr * v + 0.5), clip(y - kgu * u - kgv * v + 0.5), clip(y + kb * u + 0.5)]
}

/// `y2r:u`, la conversion YUV vers RGB (l'écran-titre s'en sert pour sa vidéo).
///
/// Les réglages sont retenus ; à StartConversion la conversion est faite pour de bon (plans Y, U, V lus dans la mémoire
/// du jeu, RGB écrit à l'adresse de réception, en tuiles de 8 x 8 si le jeu l'a demandé) et la fin est signalée par un
/// vrai événement (GetTransferEndEvent), 1 ms du banc plus tard. Faits : entrées YUV 4:2:0 et 4:2:2 en plans séparés,
/// sorties RGB32, RGB24, RGB15, RGB565, les coefficients ITU 601 et 709 avec ou sans mise à l'échelle. Pas faits :
/// l'entrée YUYV en un seul plan, la rotation.
pub struct Y2r {
    name: String,
    seen: BTreeSet<u32>,
    end_event: ObjId,
    pub conversions: u32,
    input_format: u32,
    output_format: u32,
    rotation: u32,
    block_alignment: u32,
    line_width: u32,
    lines: u32,
    coefficient: u32,
    alpha: u32,
    /// y, u, v, sortie : (adresse, taille, unité, écart)
    planes: [Option<(u32, u32, u32, u32)>; 4],
    pub problems: Vec<String>,
}

const PLANE_Y: usize = 0;
const PLANE_U: usize = 1;
const PLANE_V: usize = 2;
const PLANE_OUT: usize = 3;

impl Y2r {
    pub fn new(k: &mut Kernel, name: &str) -> Y2r {
        let end_event = k.create_event(RESET_ONESHOT, "y2r : fin de transfert");
        Y2r {
            name: name.to_string(),
            seen: BTreeSet::new(),
            end_event,
            conversions: 0,
            input_format: 1,
            output_format: 0,
            rotation: 0,
            block_alignment: 0,
            line_width: 0,
            lines: 0,
            coefficient: 0,
            alpha: 255,
            planes: [None; 4],
            problems: Vec::new(),
        }
    }

    pub fn end_event(&self) -> ObjId {
        self.end_event
    }

    fn convert(&mut self, k: &mut Kernel) -> String {
        let (width, lines) = (self.line_width as usize, self.lines as usize);
        let (Some(y_plane), Some(out)) = (self.planes[PLANE_Y], self.planes[PLANE_OUT]) else {
            return "réglages incomplets, rien n'est converti".to_string();
        };
        if width == 0 || lines == 0 {
            return "réglages incomplets, rien n'est converti".to_string();
        }
        let (Some(u_plane), Some(v_plane)) = (self.planes[PLANE_U], self.planes[PLANE_V]) else {
            self.problems.push(format!("entrée de format {} non faite", self.input_format));
            return format!("entrée de format {} : rien n'est converti", self.input_format);
        };
        if self.input_format != 0 && self.input_format != 1 {
            self.problems.push(format!("entrée de format {} non faite", self.input_format));
            return format!("entrée de format {} : rien n'est converti", self.input_format);
        }

        let read_plane = |k: &Kernel, (address, size, unit, gap): (u32, u32, u32, u32), w: usize, h: usize| -> Result<Vec<u8>, String> {
            let pitch = unit as usize + gap as usize;
            let raw = k.memory.read(address, size).map_err(|e| format!("{:?}", e))?;
            let mut rows = vec![0u8; w * h];
            for line in 0..h {
                let start = line * pitch;
                if start >= raw.len() {
                    break;
                }
                let chunk = &raw[start..raw.len().min(start + w)];
                rows[line * w..line * w + chunk.len()].copy_from_slice(chunk);
            }
            Ok(rows)
        };
        let chroma_lines = if self.input_format == 1 { lines / 2 } else { lines };
        if chroma_lines == 0 {
            let text = "integer division or modulo by zero";
            self.problems.push(format!("lecture refusée : {}", text));
            return format!("lecture refusée ({})", text);
        }
        let planes = (|| -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
            Ok((
                read_plane(k, y_plane, width, lines)?,
                read_plane(k, u_plane, width / 2, chroma_lines)?,
                read_plane(k, v_plane, width / 2, chroma_lines)?,
            ))
        })();
        let (y, u, v) = match planes {
            Ok(planes) => planes,
            Err(text) => {
                self.problems.push(format!("lecture refusée : {}", text));
                return format!("lecture refusée ({})", text);
            }
        };
        let repeat = lines / chroma_lines;
        let chroma_width = width / 2;
        let mut rgba = Vec::with_capacity(width * lines * 4);
        for row in 0..lines {
            let chroma_row = (row / repeat).min(chroma_lines - 1);
            for column in 0..width {
                let chroma = chroma_row * chroma_width + (column / 2).min(chroma_width.saturating_sub(1));
                let (cu, cv) = if chroma_width == 0 { (128, 128) } else { (u[chroma], v[chroma]) };
                let rgb = yuv_to_rgb(y[row * width + column] as f32, cu as f32 - 128.0, cv as f32 - 128.0, self.coefficient);
                rgba.extend_from_slice(&[rgb[0], rgb[1], rgb[2], (self.alpha & 255) as u8]);
            }
        }
        let (name, unit_bytes) = match self.output_format {
            1 => ("RGB8", 3),
            2 => ("RGB5A1", 2),
            3 => ("RGB565", 2),
            _ => ("RGBA8", 4),
        };
        let encoded = encode_pixels(self.output_format, &rgba);
        let stream = if self.block_alignment == 1 { linear_to_tiled(&encoded, width, lines, unit_bytes) } else { encoded };
        let (address, size, mut unit, gap) = out;
        // Comme Python, les adresses ne sont pas bornées à 32 bits : un pas qui dépasse la mémoire est une écriture refusée.
        let mut address = address as u64;
        if unit == 0 {
            unit = stream.len() as u32;
        }
        let mut position = 0usize;
        while position < stream.len().min(size as usize) && unit > 0 {
            let chunk = &stream[position..stream.len().min(position + unit as usize)];
            let written = if address > u32::MAX as u64 {
                Err(format!("écriture hors mémoire à {address:#010x}"))
            } else {
                k.memory.write(address as u32, chunk).map_err(|e| e.to_string())
            };
            if let Err(e) = written {
                self.problems.push(format!("écriture refusée : {e}"));
                return format!("écriture refusée ({e})");
            }
            address += unit as u64 + gap as u64;
            position += unit as usize;
        }
        format!(
            "{}x{} en {}{}, fin signalée dans 1 ms",
            width,
            lines,
            name,
            if self.block_alignment == 1 { " par blocs" } else { "" }
        )
    }
}

impl Service for Y2r {
    fn name(&self) -> &str {
        &self.name
    }

    fn kind(&self) -> &'static str {
        "factice"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let command = req.command;
        match command {
            0x0001 => self.input_format = req.word(1),
            0x0003 => self.output_format = req.word(1),
            0x0005 => self.rotation = req.word(1),
            0x0007 => self.block_alignment = req.word(1),
            0x001A => self.line_width = req.word(1),
            0x001C => self.lines = req.word(1),
            0x0020 => self.coefficient = req.word(1),
            0x0022 => self.alpha = req.word(1),
            0x0010 | 0x0011 | 0x0012 | 0x0018 => {
                let index = match command {
                    0x0010 => PLANE_Y,
                    0x0011 => PLANE_U,
                    0x0012 => PLANE_V,
                    _ => PLANE_OUT,
                };
                self.planes[index] = Some((req.word(1), req.word(2), req.word(3), req.word(4)));
            }
            _ => {}
        }
        let _ = self.rotation;
        let mut reply = match command {
            0x000F => Reply::new(0).copy_handles(&[self.end_event]),
            0x0026 => {
                self.conversions += 1;
                let note = self.convert(k);
                let (when, event) = (k.now + 1_000_000, self.end_event);
                k.schedule(when, Box::new(move |k: &mut Kernel| k.signal_event(event)));
                Reply::new(0).with_note(format!("conversion {} : {}", self.conversions, note))
            }
            0x0014 | 0x0015 | 0x0016 | 0x0017 | 0x0019 | 0x002A => Reply::with_words(0, &[1]),
            0x0028 => Reply::with_words(0, &[0]),
            _ => match reply_shapes::lookup(reply_shapes::Y2R_U, command) {
                Some(shape) => neutral_reply(k, req, shape, true),
                // `super().handle(req)` du Python : la réponse factice, avec le même ensemble « déjà vu »
                None => Reply::with_words(0, &[0; STUB_WORDS]),
            },
        };
        first_time(&mut self.seen, command, &mut reply);
        reply
    }
}

#[cfg(test)]
mod tests {
    use super::modules::*;
    use super::reply_shapes::*;
    use super::*;
    use kernel::testing::{header, make_request, test_kernel, test_main_thread};

    const BUFFER: u32 = 0x0FF0_2000;

    struct Rig {
        k: Kernel,
        thread: ObjId,
        session: ObjId,
        service: Rc<RefCell<dyn Service>>,
        dir: std::path::PathBuf,
    }

    impl Drop for Rig {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn rig(name: &str) -> Rig {
        let (mut k, _script) = test_kernel();
        let dir = std::env::temp_dir().join(format!("services-stubs-{}-{}", std::process::id(), name.replace([':', '/'], "_")));
        k.bench.paths.archives = dir.clone();
        let thread = test_main_thread(&mut k);
        let service = make_service(&mut k, name);
        let session = k.new_session(service.clone(), name);
        k.add_handle(session);
        Rig { k, thread, session, service, dir }
    }

    impl Rig {
        /// Une requête : commande, mots ordinaires (après l'en-tête), mots de traduction. Rend (en-tête, mots de la réponse).
        fn call(&mut self, command: u32, normal: &[u32], translate: &[u32]) -> Vec<u32> {
            let mut words = vec![header(command, normal.len() as u32, translate.len() as u32)];
            words.extend_from_slice(normal);
            words.extend_from_slice(translate);
            kernel::testing::call(&mut self.k, self.thread, self.session, &words)
        }

        /// Comme `call`, mais rend la `Reply` (pour la note et le genre).
        fn direct(&mut self, command: u32, normal: &[u32], translate: &[u32]) -> Reply {
            let mut words = vec![header(command, normal.len() as u32, translate.len() as u32)];
            words.extend_from_slice(normal);
            words.extend_from_slice(translate);
            let req = make_request(&mut self.k, self.thread, self.session, &words);
            let service = self.service.clone();
            let reply = service.borrow_mut().handle(&mut self.k, &req);
            reply
        }
    }

    fn read_descriptor(size: u32) -> u32 {
        size << 4 | 0xA
    }

    fn write_descriptor(size: u32) -> u32 {
        size << 4 | 0xC
    }

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len() / 2).map(|i| u8::from_str_radix(&text[2 * i..2 * i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn every_command_of_every_table_has_the_shape_of_its_sheet() {
        let expected_counts = [("nwm::UDS", 35), ("boss:U", 55), ("boss:M", 7), ("ssl:C", 3), ("cecd:u", 22), ("cam:u", 36),
            ("mic:u", 16), ("ir:USER", 26), ("ndm:u", 24), ("ac:u", 62), ("frd:u", 54), ("soc:U", 35), ("http:C", 66)];
        assert_eq!(ALL.len(), 13);
        assert_eq!(Y2R_U.len(), 22);
        let mut checked = 0;
        for (name, table) in ALL {
            assert_eq!(table.len(), expected_counts.iter().find(|e| e.0 == *name).unwrap().1, "{}", name);
            let mut rig = rig(name);
            assert_ne!(rig.service.borrow().kind(), "factice", "{}", name);
            for &(number, shape) in table.iter() {
                let reply = rig.call(number, &[], &[]);
                assert_eq!(reply[0], shape, "{} commande {:#x} : en-tête {:#010x} au lieu de {:#010x}", name, number, reply[0], shape);
                checked += 1;
            }
            let unknown = rig.call(0x7FFF, &[], &[]);
            assert_eq!((unknown[0], unknown[1]), (0x40, 0xD900_182F), "{}", name);
        }
        assert_eq!(checked, 35 + 55 + 7 + 3 + 22 + 36 + 16 + 26 + 24 + 62 + 54 + 35 + 66);
        let mut y2r = rig("y2r:u");
        for &(number, shape) in Y2R_U {
            if number != 0x0F && number != 0x26 {
                assert_eq!(y2r.call(number, &[], &[])[0], shape, "y2r {:#x}", number);
            }
        }
        let other = rig("inconnu:x");
        assert_eq!(other.service.borrow().kind(), "factice");
        assert_eq!(y2r.service.borrow().kind(), "factice");
    }

    #[test]
    fn stub_answers_four_zero_words_and_notes_the_first_time() {
        let mut stub = rig("inconnu:x");
        assert_eq!(stub.service.borrow().name(), "inconnu:x");
        let first = stub.direct(0x77, &[], &[]);
        assert_eq!((first.result, first.words.clone(), first.note.as_str()), (0, vec![0; 4], "première fois"));
        let second = stub.direct(0x77, &[], &[]);
        assert_eq!(second.note, "");
        assert_eq!(stub.direct(0x78, &[], &[]).note, "première fois");
        let words = stub.call(0x79, &[], &[]);
        assert_eq!(words, vec![header(0x79, 5, 0), 0, 0, 0, 0, 0]);
    }

    #[test]
    fn modules_create_their_kernel_objects_like_the_python() {
        for (name, created) in [("boss:U", 1), ("mic:u", 1), ("y2r:u", 1), ("nwm::UDS", 0), ("ndm:u", 0), ("frd:u", 0),
            ("cam:u", 0), ("ac:u", 0), ("inconnu:x", 0)] {
            let (mut k, _) = test_kernel();
            let before = k.objects.len();
            let _ = make_service(&mut k, name);
            assert_eq!(k.objects.len() - before, created, "{}", name);
        }
        // l'événement de boss:U est le premier objet créé après le processus et la limite
        let (mut k, _) = test_kernel();
        let _ = make_service(&mut k, "boss:U");
        assert_eq!(k.label(2), "événement#3 « boss : fin de tâche »");
    }

    #[test]
    fn neutral_reply_zeroes_output_buffers_and_echoes_descriptors() {
        let mut ssl = rig("ssl:C");
        // GenerateRandomData : 1 mot ordinaire, un tampon d'écriture de 16 octets
        ssl.k.memory.write(BUFFER, &[0xFF; 16]).unwrap();
        let reply = ssl.direct(0x11, &[16], &[write_descriptor(16), BUFFER]);
        assert_eq!(reply.note, "16 octets aléatoires ; première fois");
        assert!(reply.words.is_empty());
        assert_eq!(translate_length(&reply), 2);
        let words = ssl.call(0x11, &[16], &[write_descriptor(16), BUFFER]);
        assert_eq!(words, vec![0x0011_0042, 0, write_descriptor(16), BUFFER]);
        // sans tampon de sortie : un refus, de la bonne forme
        let words = ssl.call(0x11, &[16], &[]);
        assert_eq!(words[0], 0x0011_0042);
        assert_eq!(words[1], 0xE0E0_B7F6);
        // une commande qui ne fait rien remet à zéro le tampon d'écriture
        let mut http = rig("http:C");
        http.k.memory.write(BUFFER, &[0xFF; 8]).unwrap();
        let words = http.call(0x01, &[], &[write_descriptor(8), BUFFER]);
        assert_eq!(words[0], 0x0001_0040);
        assert_eq!(http.k.memory.read(BUFFER, 8).unwrap(), vec![0; 8]);
    }

    #[test]
    fn ndm_enter_twice_is_refused() {
        let mut ndm = rig("ndm:u");
        assert_eq!(ndm.service.borrow().kind(), "simplifié");
        let first = ndm.direct(0x01, &[7], &[]);
        assert_eq!((first.result, first.note.as_str()), (0, "état exclusif 7 ; première fois"));
        let second = ndm.direct(0x01, &[7], &[]);
        assert_eq!((second.result, second.note.as_str()), (0xC8A0_6811, "déjà dans l'état 7"));
        let query = ndm.call(0x03, &[], &[]);
        assert_eq!(query, vec![0x0003_0080, 0, 7]);
        assert_eq!(ndm.call(0x02, &[], &[])[1], 0);
        assert_eq!(ndm.call(0x03, &[], &[]), vec![0x0003_0080, 0, 0]);
        assert_eq!(ndm.call(0x01, &[2], &[])[1], 0);
    }

    #[test]
    fn ndm_suspend_and_resume_by_session() {
        let mut ndm = rig("ndm:u");
        assert_eq!(ndm.call(0x06, &[0], &[])[1], 0xD8E0_6BED);
        assert_eq!(ndm.call(0x06, &[16], &[])[1], 0xD8E0_6BED);
        assert_eq!(ndm.call(0x07, &[1], &[])[1], 0xC8A0_680D);
        assert_eq!(ndm.call(0x06, &[3], &[])[1], 0);
        assert_eq!(ndm.call(0x07, &[1], &[])[1], 0);
        let refused = ndm.direct(0x07, &[5], &[]);
        assert_eq!((refused.result, refused.note.as_str()), (0xC8A0_680D, "masque 0x5, suspendus par la session : 0x2"));
        assert_eq!(ndm.call(0x09, &[], &[])[1], 0xC8A0_680D);
        assert_eq!(ndm.call(0x08, &[], &[])[1], 0);
        assert_eq!(ndm.call(0x09, &[], &[])[1], 0);
        // la session fermée oublie tout
        assert_eq!(ndm.call(0x06, &[2], &[])[1], 0);
        let (service, session) = (ndm.service.clone(), ndm.session);
        service.borrow_mut().on_session_closed(&mut ndm.k, session);
        assert_eq!(ndm.call(0x07, &[2], &[])[1], 0xC8A0_680D);
    }

    #[test]
    fn boss_needs_initialize_session() {
        let mut boss = rig("boss:U");
        // rien ne répond sans InitializeSession, mais la forme est celle de la fiche
        let words = boss.call(0x14, &[6, 1, 0, 0], &[read_descriptor(1), BUFFER]);
        assert_eq!(words[0], 0x0014_0042);
        assert_eq!(words[1], 0xC8A0_F82B);
        let no_session = boss.direct(0x16, &[6, 0], &[]);
        assert_eq!((no_session.result, no_session.note.as_str()), (0xC8A0_F82B, "InitializeSession pas faite"));
        // SendPropertyHandle n'a pas besoin de session
        assert_eq!(boss.call(0x15, &[0x0C], &[])[1], 0);
        assert_eq!(boss.call(0x15, &[0x01], &[])[1], 0xC960_F84D);
        // InitializeSession : le descripteur 0x20 est le numéro de processus
        let init = boss.direct(0x01, &[], &[0x20, 0]);
        assert_eq!((init.result, init.note.as_str()), (0, "session ouverte, processus 0x30 ; première fois"));
        // SendProperty 0x06 = 7 : RegisterTask refuse
        boss.k.memory.write(BUFFER, &[7]).unwrap();
        let sent = boss.direct(0x14, &[6, 1, 0xAA, 0xBB], &[read_descriptor(1), BUFFER]);
        assert_eq!(sent.note, "propriété 0x6 : 1 octets ; première fois");
        assert_eq!(translate_length(&sent), 2);
        let refused = boss.direct(0x0B, &[1, 2, 3, 4], &[read_descriptor(8), BUFFER]);
        assert_eq!((refused.result, refused.note.as_str()), (0xD8E0_F802, "propriété 0x06 = 7 ; première fois"));
        // ReceiveProperty rend ce qui a été envoyé
        let out = BUFFER + 0x100;
        let words = boss.call(0x16, &[6, 4], &[write_descriptor(4), out]);
        assert_eq!(words, vec![0x0016_0082, 0, 4, write_descriptor(4), out]);
        assert_eq!(boss.k.memory.read(out, 4).unwrap(), vec![7, 0, 0, 0]);
        assert_eq!(boss.call(0x14, &[0x99, 1, 0, 0], &[read_descriptor(1), BUFFER])[1], 0xC960_F84D);
        // une propriété 6 correcte : la tâche s'enregistre puis se désenregistre
        boss.k.memory.write(BUFFER, &[1]).unwrap();
        assert_eq!(boss.call(0x14, &[6, 1, 0, 0], &[read_descriptor(1), BUFFER])[1], 0);
        boss.k.memory.write(BUFFER + 0x40, b"Task0001").unwrap();
        assert_eq!(boss.call(0x0B, &[0, 0, 0, 0], &[read_descriptor(8), BUFFER + 0x40])[1], 0);
        assert_eq!(boss.call(0x0C, &[0, 0], &[read_descriptor(8), BUFFER + 0x40])[1], 0);
        assert_eq!(boss.call(0x0C, &[0, 0], &[read_descriptor(8), BUFFER + 0x40])[1], 0xC8A0_F833);
        // le stockage
        assert_eq!(boss.call(0x30, &[], &[])[1], 0xC8A0_F842);
        assert_eq!(boss.call(0x2F, &[], &[])[1], 0);
        assert_eq!(boss.call(0x30, &[], &[])[1], 0);
        assert_eq!(boss.call(0x03, &[], &[])[1], 0);
        assert_eq!(boss.call(0x03, &[], &[])[1], 0xC8A0_F842);
        // le reste
        assert_eq!(boss.call(0x2E, &[], &[]), vec![0x002E_0080, 0, 0xB3B1]);
        assert_eq!(boss.call(0x36, &[0, 0x60], &[])[1], 0);
        assert_eq!(boss.call(0x36, &[0, 0x20], &[])[1], 0xC960_F84D);
        assert_eq!(boss.call(0x27, &[0, 9, 4], &[])[1], 0xC8A0_F83F);
        assert_eq!(boss.call(0x27, &[0, 1, 8], &[])[1], 0xC960_F844);
        assert_eq!(boss.call(0x27, &[0, 1, 4], &[])[1], 0xC8A0_F832);
        // GetTaskFinishHandle : une poignée vers l'événement créé avec le service
        let words = boss.call(0x1F, &[0, 0, 0], &[]);
        assert_eq!(words[0], 0x001F_0042);
        let event = boss.k.lookup(words[3], None).unwrap();
        assert_eq!(boss.k.label(event), "événement#4 « boss : fin de tâche »");
        // la session fermée est oubliée
        let (service, session) = (boss.service.clone(), boss.session);
        service.borrow_mut().on_session_closed(&mut boss.k, session);
        assert_eq!(boss.call(0x16, &[6, 0], &[])[1], 0xC8A0_F82B);
    }

    #[test]
    fn friends_key_uses_sha1_of_the_principal_id() {
        assert_eq!(friend_code(FRD_PRINCIPAL_ID), 0x0BEC_0DE1 | (0x2c_u64 >> 1) << 32);
        let digest = overlay::sha1(b"abc");
        assert_eq!(digest[..4], [0xa9, 0x99, 0x3e, 0x36]);
        let mut frd = rig("frd:u");
        let key = frd.call(0x05, &[], &[]);
        assert_eq!(key, vec![0x0005_0140, 0, 0x0BEC_0DE1, 0, 0x0BEC_0DE1, 0x16]);
        // l'identité n'est pas nulle
        assert_ne!(key[2], 0);
    }

    #[test]
    fn friends_error_codes_and_last_result() {
        assert_eq!(result_to_error_code(0x1234_5678), (0xE0E0_C403, 0));
        let module = FRD_MODULE << 10;
        assert_eq!(result_to_error_code(module | 0x5), (0, 0));
        assert_eq!(result_to_error_code(0x8000_0000 | module | 0x101), (0, 23000));
        assert_eq!(result_to_error_code(0x8000_0000 | module | (3 << 5) | 4), (0, 10304));
        assert_eq!(result_to_error_code(0x8000_0000 | module), (0, 0));
        let mut frd = rig("frd:u");
        assert_eq!(frd.call(0x27, &[0x8000_0000 | module | 0x101], &[]), vec![0x0027_0080, 0, 23000]);
        // GetLastResponseResult rend le dernier résultat, sans se compter lui-même
        assert_eq!(frd.call(0x23, &[], &[])[1], 0);
        assert_eq!(frd.call(0x28, &[0, 0], &[])[1], 0xD8A0_C402);
        assert_eq!(frd.call(0x23, &[], &[])[1], 0xD8A0_C402);
        assert_eq!(frd.call(0x23, &[], &[])[1], 0xD8A0_C402);
        assert_eq!(frd.call(0x33, &[], &[])[1], 0xD8A0_C4F8);
        assert_eq!(frd.call(0x23, &[], &[])[1], 0xD8A0_C4F8);
        // le nom d'écran : « Banc » en UTF-16
        let name = frd.call(0x09, &[], &[]);
        assert_eq!(&name[2..], [0x0061_0042, 0x0063_006E, 0, 0, 0, 0]);
        // la liste d'amis est vide
        let list = frd.direct(0x11, &[0, 0, 0, 0], &[]);
        assert_eq!((list.words.clone(), list.note.as_str()), (vec![0], "aucun ami ; première fois"));
    }

    #[test]
    fn friends_zeros_fill_the_receive_buffer() {
        let mut frd = rig("frd:u");
        let tls = frd.k.thread(frd.thread).tls;
        frd.k.memory.w32(tls + 0x180, 0x100 << 14 | 2).unwrap();
        frd.k.memory.w32(tls + 0x184, BUFFER).unwrap();
        frd.k.memory.write(BUFFER, &[0xFF; 0x100]).unwrap();
        let reply = frd.direct(0x08, &[], &[]);
        assert_eq!(reply.note, "présence nulle ; première fois");
        let words = frd.call(0x10, &[], &[]);
        assert_eq!(words[0], 0x0010_0042);
        assert_eq!(frd.k.memory.read(BUFFER, 0x100).unwrap(), vec![0; 0x100]);
    }

    #[test]
    fn friends_login_signals_the_event() {
        let mut frd = rig("frd:u");
        let event = frd.k.create_event(0, "login");
        let handle = frd.k.add_handle(event).unwrap();
        assert!(!frd.k.event(event).signaled);
        let reply = frd.call(0x03, &[0, 0], &[0, handle]);
        assert_eq!(reply[1], 0);
        assert!(frd.k.event(event).signaled);
    }

    #[test]
    fn nwm_state_machine() {
        let mut uds = rig("nwm::UDS");
        // avant Initialize : l'état est 0, rien n'est permis
        assert_eq!(uds.call(0x0B, &[], &[])[2], 0);
        assert_eq!(uds.call(0x08, &[], &[])[1], 0xC8A1_13EA);
        // Initialize rend la poignée de l'événement
        let node: Vec<u32> = (0..10).map(|i| 0x1000 + i).collect();
        let mut args = vec![0x400];
        args.extend(&node);
        let words = uds.call(0x01, &args, &[0x20, 0]);
        assert_eq!(words[0], 0x0001_0042);
        let event = uds.k.lookup(words[3], None).unwrap();
        assert!(!uds.k.event(event).signaled);
        assert_eq!(uds.call(0x0B, &[], &[])[2], 3);
        // CreateNetwork avec une structure de réseau en tampon statique
        let mut network = vec![0u8; 0x108];
        network[6] = 6;
        network[0x1D] = 8;
        uds.k.memory.write(BUFFER, &network).unwrap();
        let create = uds.direct(0x04, &[0; 6], &[0x108 << 14 | 2, BUFFER]);
        assert_eq!(create.note, "hôte : état 6, nœud 1, canal 6, 8 nœuds au plus ; première fois");
        assert!(uds.k.event(event).signaled);
        let status = uds.call(0x0B, &[], &[]);
        assert_eq!(status[0], 0x000B_0340);
        assert_eq!(status[2], 6);
        assert_eq!(uds.call(0x0D, &[1], &[])[2..], node);
        assert_eq!(uds.call(0x0D, &[5], &[])[1], 0xC901_13FA);
        assert_eq!(uds.call(0x1A, &[], &[])[2], 6);
        // Bind : une poignée, un événement de plus ; PullPacket sans trame
        let bind = uds.call(0x12, &[0x2000, 0x300, 0x11], &[]);
        assert_eq!(bind[0], 0x0012_0042);
        assert_ne!(bind[3], 0);
        assert_eq!(uds.call(0x12, &[0x2001, 0, 0], &[])[1], 0xE101_13EA);
        assert_eq!(uds.call(0x14, &[0x2000, 0x300], &[])[1], 0);
        assert_eq!(uds.call(0x14, &[0x1], &[])[1], 0xE101_13EA);
        assert_eq!(uds.call(0x17, &[0, 0, 0x5C7], &[])[1], 0xE101_13E9);
        assert_eq!(uds.call(0x10, &[0xC9], &[])[1], 0xE101_13E9);
        assert_eq!(uds.call(0x10, &[0xC8], &[])[1], 0);
        // un hôte ne peut plus créer, ne peut ni rejoindre ni balayer
        assert_eq!(uds.call(0x04, &[0; 6], &[0x108 << 14 | 2, BUFFER])[1], 0xC8A1_13EA);
        assert_eq!(uds.call(0x09, &[0; 6], &[])[1], 0xC8A1_13EA);
        assert_eq!(uds.call(0x0F, &[0; 6], &[])[1], 0xC8A1_13EA);
        // DestroyNetwork ramène à 3 ; ConnectNetwork refuse alors que l'état est bon ; un balayage fait attendre
        assert_eq!(uds.call(0x08, &[], &[])[1], 0);
        assert_eq!(uds.call(0x09, &[0; 6], &[])[1], 0xC921_13FB);
        let scan = uds.direct(0x0F, &[0; 6], &[write_descriptor(0x20), BUFFER]);
        assert_eq!(scan.note, "balayage 1 : aucune balise, 300 ms");
        assert_eq!(uds.k.memory.read(BUFFER, 12).unwrap(), [0x20, 0, 0, 0, 0xC, 0, 0, 0, 0, 0, 0, 0]);
        assert!(uds.k.thread(uds.thread).wait.is_some());
        // Finalize remet tout à zéro
        assert_eq!(uds.call(0x03, &[], &[])[1], 0);
        assert_eq!(uds.call(0x0B, &[], &[])[2], 0);
    }

    #[test]
    fn camera_formulas() {
        let mut cam = rig("cam:u");
        // le plus grand nombre de lignes qui divise 192 et tient dans 0x1400 octets de 2 octets par point
        assert_eq!(cam.call(0x0A, &[256, 192], &[])[2], 8);
        assert_eq!(cam.call(0x0A, &[3, 3], &[])[1], 0xE0E0_53FD);
        assert_eq!(cam.call(0x0D, &[400, 240], &[])[2], 0xF00);
        assert_eq!(cam.call(0x05, &[3], &[])[1], 0xE0E0_53ED);
        // deux appels de la même poignée d'événement : le Python en crée un neuf à chaque fois
        let before = cam.k.objects.len();
        let first = cam.call(0x05, &[1], &[]);
        let second = cam.call(0x05, &[1], &[]);
        assert_eq!(cam.k.objects.len() - before, 2);
        // mais c'est le premier qui est gardé et rendu
        assert_eq!(cam.k.lookup(first[3], None), cam.k.lookup(second[3], None));
        assert_eq!(cam.call(0x0B, &[0x1234, 2, 0], &[])[1], 0);
        assert_eq!(cam.call(0x0C, &[2], &[])[2], 0x1234);
        assert_eq!(cam.call(0x13, &[0xFF], &[])[1], 0);
        assert_eq!(cam.call(0x3B, &[], &[])[2], 7);
    }

    #[test]
    fn mic_page_and_silence() {
        let mut mic = rig("mic:u");
        let page = mic.k.create_shared(0x2000, None, 0, "page du micro");
        let handle = mic.k.add_handle(page).unwrap();
        assert_eq!(mic.call(0x03, &[0, 0, 0, 0x100, 0], &[])[1], 0xD820_8FF8);
        assert_eq!(mic.call(0x01, &[0x1001], &[0, handle])[1], 0xE0E0_8FF2);
        assert_eq!(mic.call(0x01, &[0x1800], &[0, handle])[1], 0xE0E0_1BF2);
        assert_eq!(mic.call(0x01, &[0x2000], &[0, handle])[1], 0);
        assert_eq!(mic.call(0x01, &[0x2000], &[0, handle])[1], 0xD820_8FF9);
        mic.k.shared(page).write(0x10, &[0xAA; 0x40]);
        let start = mic.direct(0x03, &[0, 3, 0x10, 0x40, 0], &[]);
        assert_eq!(start.note, "codage 0, 8182 Hz, anneau 0x10+0x40");
        assert_eq!(mic.call(0x06, &[], &[])[2], 1);
        mic.k.now += 10_000_000;
        mic.k.run_due_events();
        // 8182 Hz pendant 10 ms = 81 échantillons de 2 octets : l'anneau de 0x40 octets est plein
        assert_eq!(mic.k.shared(page).read(0x10, 0x40), vec![0; 0x40]);
        assert_eq!(mic.k.shared(page).u32(0x1FFC), 0x10 + 0x3E);
        assert_eq!(mic.call(0x06, &[], &[])[2], 0);
        let event = mic.call(0x07, &[], &[]);
        let event = mic.k.lookup(event[3], None).unwrap();
        assert!(mic.k.event(event).signaled);
        assert_eq!(mic.call(0x08, &[0x1FF], &[])[1], 0);
        assert_eq!(mic.call(0x09, &[], &[])[2], 0xFF);
        assert_eq!(mic.call(0x02, &[], &[])[1], 0);
        assert_eq!(mic.call(0x02, &[], &[])[1], 0xD820_8FF8);
        assert_eq!(format!("{:.0}", mic_rate(0).round_ties_even()), "32728");
    }

    #[test]
    fn ir_link_states() {
        let mut ir = rig("ir:USER");
        let page = ir.k.create_shared(0x1000, None, 0, "page ir");
        let handle = ir.k.add_handle(page).unwrap();
        assert_eq!(ir.call(0x02, &[], &[])[1], 0xD821_0FF8);
        assert_eq!(ir.call(0x18, &[0x1000, 0x100, 4, 0x100, 4], &[0, 0])[1], 0xD8E0_07F7);
        let init = ir.direct(0x18, &[0x1000, 0x100, 4, 0x100, 4], &[0, handle]);
        assert_eq!(init.note, "page 0x1000, réception 256/4, envoi 256/4");
        assert_eq!(ir.k.shared(page).u8(0xE), 1);
        assert_eq!(ir.call(0x0D, &[], &[])[1], 0xC8A1_0C0D);
        assert_eq!(ir.call(0x15, &[], &[]), vec![0x0015_0140, 0, 0xF0, 4, 0, 0]);
        assert_eq!(ir.call(0x05, &[3, 0], &[])[1], 0);
        assert_eq!(ir.k.shared(page).u8(8), 1);
        assert_eq!(ir.call(0x05, &[3, 0], &[])[1], 0xC8A1_0C0C);
        assert_eq!(ir.call(0x13, &[], &[])[2], 1);
        assert_eq!(ir.call(0x09, &[], &[])[1], 0);
        assert_eq!(ir.k.shared(page).u8(8), 0);
        assert_eq!(ir.call(0x09, &[], &[])[1], 0xC8A1_0C0D);
        assert_eq!(ir.call(0x19, &[], &[])[1], 0xC8A1_0C0D);
    }

    #[test]
    fn ac_connect_is_offline() {
        let mut ac = rig("ac:u");
        let created = ac.call(0x01, &[], &[]);
        assert_eq!(created[0], 0x0001_0042);
        let event = ac.k.create_event(0, "connexion");
        let handle = ac.k.add_handle(event).unwrap();
        let mut config = default_ac_config();
        ac.k.memory.write(BUFFER, &config).unwrap();
        assert_eq!(ac.call(0x04, &[0, 0], &[0x200 << 14 | 2, BUFFER, 0, handle])[1], 0);
        assert_eq!(ac.call(0x05, &[], &[])[1], 0xE120_9C46);
        assert_eq!(ac.call(0x04, &[0, 0], &[0x200 << 14 | 2, BUFFER, 0, handle])[1], 0xE0A0_9FFC);
        ac.k.now += 50_000_000;
        ac.k.run_due_events();
        assert!(ac.k.event(event).signaled);
        assert_eq!(ac.call(0x05, &[], &[])[1], 0xE0A0_9D2E);
        assert_eq!(ac.call(0x0D, &[], &[])[1], 0xE0A0_9D2E);
        config[4] = 3;
        ac.k.memory.write(BUFFER, &config).unwrap();
        assert_eq!(ac.call(0x04, &[0, 0], &[0x200 << 14 | 2, BUFFER, 0, handle])[1], 0xE040_9FFF);
        assert_eq!(ac.call(0x04, &[0, 0], &[])[1], 0xE040_9FFF);
    }

    #[test]
    fn socket_http_and_ssl() {
        let mut soc = rig("soc:U");
        assert_eq!(soc.call(0x02, &[0, 0, 0], &[])[2], 0xFFFF_FFD9);
        assert_eq!(soc.call(0x03, &[0, 0, 0], &[])[2], 0xFFFF_FFFF);
        assert_eq!(soc.call(0x0B, &[], &[])[2], 0);
        let mut poll = vec![0u8; 24];
        poll[0] = 5;
        soc.k.memory.write(BUFFER, &poll).unwrap();
        let tls = soc.k.thread(soc.thread).tls;
        soc.k.memory.w32(tls + 0x180, 24 << 14 | 2).unwrap();
        soc.k.memory.w32(tls + 0x184, BUFFER + 0x100).unwrap();
        let words = soc.call(0x14, &[2, 0], &[24 << 14 | 2, BUFFER]);
        assert_eq!(words[0], 0x0014_0082 + 0 * 0 + 0);
        let out = soc.k.memory.read(BUFFER + 0x100, 24).unwrap();
        assert_eq!(&out[8..12], &[0x20, 0, 0, 0]);
        assert_eq!(&out[20..24], &[0x20, 0, 0, 0]);
        let mut http = rig("http:C");
        assert_eq!(http.call(0x02, &[0, 0], &[]), vec![0x0002_0082, 0, 1, 0, 0]);
        assert_eq!(http.call(0x08, &[1], &[])[1], 0);
        assert_eq!(http.call(0x08, &[9], &[])[1], 0xD8A0_A064);
        assert_eq!(http.call(0x03, &[1], &[])[1], 0);
        assert_eq!(http.call(0x08, &[1], &[])[1], 0xD8A0_A064);
        for _ in 0..8 {
            assert_eq!(http.call(0x02, &[0, 0], &[])[1], 0);
        }
        assert_eq!(http.call(0x02, &[0, 0], &[])[1], 0xD8A0_A01A);
        let mut ssl = rig("ssl:C");
        assert_eq!(ssl.service.borrow().kind(), "réel");
        assert_eq!(ssl.call(0x02, &[], &[])[1], 0xD900_182F);
        assert_eq!(ssl.call(0x01, &[], &[])[0], 0x0001_0040);
    }

    #[test]
    fn cecd_files_live_under_the_archives_folder() {
        let mut cec = rig("cecd:u");
        assert_eq!(cec.call(0x01, &[0x1234, 99, 1], &[0, 0])[1], 0xC8A1_0BF0);
        assert_eq!(cec.call(0x01, &[0x1234, 3, 1], &[0, 0])[1], 0xC880_4470);
        // ouverture avec création, écriture puis relecture
        let opened = cec.direct(0x01, &[0x1234, 3, 4], &[0, 0]);
        assert_eq!(opened.note, format!("ouvert : {} ; première fois", ["00001234", "InBox___", "BoxInfo_____"].join(std::path::MAIN_SEPARATOR_STR)).replace(" ; première fois", ""));
        cec.k.memory.write(BUFFER, b"hello cecd").unwrap();
        let written = cec.direct(0x05, &[5], &[read_descriptor(10), BUFFER]);
        assert_eq!(written.note, "5 octets écrits ; première fois");
        assert_eq!(translate_length(&written), 2);
        assert_eq!(cec.call(0x01, &[0x1234, 3, 1], &[0, 0]), vec![0x0001_0080, 0, 5]);
        let out = BUFFER + 0x100;
        let read = cec.call(0x02, &[16], &[write_descriptor(16), out]);
        assert_eq!(read, vec![0x0002_0082 + 0, 0, 5, write_descriptor(16), out]);
        assert_eq!(cec.k.memory.read(out, 5).unwrap(), b"hello");
        // l'état et les événements
        assert_eq!(cec.call(0x0E, &[], &[]), vec![0x000E_0080, 0, 1]);
        assert_eq!(cec.direct(0x0E, &[], &[]).note, "inactif");
        assert_ne!(cec.call(0x0F, &[], &[])[3], 0);
    }

    fn y2r_convert(settings: &[(u32, u32)], out_size: u32) -> (Rig, Vec<u8>) {
        let mut y2r = rig("y2r:u");
        let y: Vec<u8> = (0..64u32).map(|i| ((i * 3 + 16) % 256) as u8).collect();
        let u: Vec<u8> = (0..16u32).map(|i| ((i * 7 + 30) % 256) as u8).collect();
        let v: Vec<u8> = (0..16u32).map(|i| ((i * 11 + 200) % 256) as u8).collect();
        let (y_at, u_at, v_at, out_at) = (BUFFER, BUFFER + 0x100, BUFFER + 0x200, BUFFER + 0x400);
        y2r.k.memory.write(y_at, &y).unwrap();
        y2r.k.memory.write(u_at, &u).unwrap();
        y2r.k.memory.write(v_at, &v).unwrap();
        for &(command, value) in settings {
            assert_eq!(y2r.call(command, &[value], &[])[0], 0x0000_0040 | command << 16);
        }
        assert_eq!(y2r.call(0x1A, &[8], &[])[1], 0);
        assert_eq!(y2r.call(0x1C, &[8], &[])[1], 0);
        y2r.call(0x10, &[y_at, 64, 8, 0], &[]);
        y2r.call(0x11, &[u_at, 16, 4, 0], &[]);
        y2r.call(0x12, &[v_at, 16, 4, 0], &[]);
        y2r.call(0x18, &[out_at, out_size, 0, 0], &[]);
        let note = y2r.direct(0x26, &[], &[]).note;
        assert!(note.starts_with("conversion 1 : 8x8 en "), "{}", note);
        let out = y2r.k.memory.read(out_at, out_size).unwrap();
        (y2r, out)
    }

    #[test]
    fn y2r_converts_like_the_python() {
        // 4:2:0, Rec. 601 plage réduite, RGBA8 linéaire
        let (mut y2r, out) = y2r_convert(&[(0x01, 1), (0x03, 0), (0x20, 0)], 256);
        let expected = hex("ff000073ff000076ff00008bff00008fff0000a4ff0000a7ff0000bdff0000c0ff00088fff000b92ff0003a7ff0007abff0000c0ff0002c3ff0000d8ff0000dcff0000f1ff0000f5ff0000ffff0000ffff00bc00ff00bf00ff00b700ff00bb00ff0011ffff0014ffff000cffff0010ffff00d800ff00db00ff06d300ff09d600ff1bce00ff1fd200ff30ca00ff34cd00ff45c508ff49c80bff5ac020ff5ec424ff37ea00ff3aee00ff4ce60bff50e90fff61e124ff65e427ff76dc3cff7ae040ff8bd755ff8fdb58ffa1d36dffa4d671ffb6ce86ffb9d289ffcbc99effcecda2ffa7f371ffabf774ffbcef89ffc0f28dffd2eaa2ffd5eda5ffe7e5baffeae9be");
        assert_eq!(out, expected);
        // la fin du transfert est signalée 1 ms plus tard par un vrai événement
        let words = y2r.call(0x0F, &[], &[]);
        assert_eq!(words[0], 0x000F_0042);
        let event = y2r.k.lookup(words[3], None).unwrap();
        assert_eq!(y2r.k.label(event), "événement#4 « y2r : fin de transfert »");
        assert!(!y2r.k.event(event).signaled);
        y2r.k.now += 1_000_000;
        y2r.k.run_due_events();
        assert!(y2r.k.event(event).signaled);
        // Rec. 709 pleine plage, RGB565 par blocs de Morton
        let (_, out) = y2r_convert(&[(0x01, 1), (0x03, 3), (0x07, 1), (0x20, 3)], 128);
        assert_eq!(out, hex("00802080c098e09800980098c0b0c0b0a0f0c0f860f980f9a0f8c0f860f980f900b000b0c0c8c0c800c000c8a0d8c0e06004800420054005600480042105420524054405e705070626052705e90dea0dd04df1559366b46ed365f36d967eb6862905290dec1dec250b1d2b25ce35ee3dd57df5859896b89ed795f8959aaebbae"));
        // Rec. 601 plage réduite, 3 octets par point, alpha ignoré
        let (_, out) = y2r_convert(&[(0x01, 1), (0x03, 1), (0x20, 1), (0x22, 0x80)], 192);
        assert_eq!(out, hex("00008100008500009c00009f0000b60000ba0000d10000d5000a9d000ea1000ab8000ebb000ad2000dd60009ed000df10009ff000cff0009ff000cff0091000094000090000094000025ff0028ff0025ff0028ff00ad0000b00001ac0005b00017ac001baf002dac0030af0043ab0046af0058ab145cae1733c80036cb0049c7004ccb005fc71562cb1974c73078ca338ac64a8eca4ea0c665a3c969b6c680b9c983cbc59bcfc99ea6e266aae66abce281bfe585d2e29cd5e59fe7e1b7ebe5ba"));
        // RGB5A1 : l'alpha tient dans le bit de poids faible
        let (_, out) = y2r_convert(&[(0x01, 1), (0x03, 2), (0x07, 1), (0x20, 2), (0x22, 0x80)], 128);
        assert_eq!(out, hex("017001788188c1900188018881a081a001e041e0c1f801f901f801f8c1f8c1f801a001a041b881b801b001b841c841d08105810541064106410581050506450609060b06cf06d106cf050f069516d51e6156635e276f2977276e6776ed862d8fd315d315992e992e972dd92d5d469f462b862b86f19ef19eef95319eb5aef7b6"));
    }

    #[test]
    fn y2r_incomplete_settings_convert_nothing() {
        let mut y2r = rig("y2r:u");
        let note = y2r.direct(0x26, &[], &[]).note;
        assert_eq!(note, "conversion 1 : réglages incomplets, rien n'est converti ; première fois");
        assert_eq!(y2r.call(0x14, &[], &[]), vec![0x0014_0080, 0, 1]);
        assert_eq!(y2r.call(0x28, &[], &[]), vec![0x0028_0080, 0, 0]);
        // une commande hors table rend le factice
        assert_eq!(y2r.call(0x2D, &[], &[]), vec![header(0x2D, 5, 0), 0, 0, 0, 0, 0]);
    }
}
