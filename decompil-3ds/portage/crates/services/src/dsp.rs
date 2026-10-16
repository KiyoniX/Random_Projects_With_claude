//! `dsp::DSP` : le démarrage du son et une trame de son vide (contrat de dsp, partie 7). Port de `banc/services/dsp.py`.
//!
//! Réel pour le démarrage : LoadComponent rend l'octet 1 ; le tuyau 2 reçoit « démarre » et rend aussitôt la liste des
//! 15 adresses du composant, puis le signal du canal 2 est levé ; ConvertProcessAddressFromDspDram applique la
//! formule du module (0x1FF40000 + adresse × 2) ; « arrête » fait rendre 1 au registre de réponse 0.
//! Simplifié : la trame. À chaque fois que le jeu lève le signal du sémaphore, le banc attend une trame (5 ms du banc)
//! et lève le signal du canal 2, sans rien mixer : l'état des voix reste à zéro. Le décodeur AAC (canal 3) répond
//! « réussi » à chaque message, sans décoder.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::{Rc, Weak};

use kernel::ipc::{Reply, Request, Service, unknown_command};
use kernel::kernel::Kernel;
use kernel::object::ObjId;

pub const DSP_BASE: u32 = 0x1FF4_0000;
pub const ADDRESSES: [u16; 15] = [0xBFFF, 0x9E92, 0x8680, 0xA792, 0x9430, 0x8400, 0x8540, 0x9492, 0x8710, 0x8410, 0xA912,
                                  0xAA12, 0xAAD2, 0xAC52, 0xAC5C];
pub const FRAME_NS: u64 = 4_888_000;

pub struct Dsp {
    me: Weak<RefCell<Dsp>>,
    pub loaded: bool,
    pub channel_events: BTreeMap<u32, ObjId>,
    pub pipes: BTreeMap<u32, Vec<u8>>,
    pub reply_ready: bool,
    pub semaphore_event: ObjId,
    pub frames: u64,
    pub frame_pending: bool,
    pub running: bool,
    pub component_size: u32,
}

impl Dsp {
    /// Crée l'événement du sémaphore (un seul objet du noyau). L'accroche de `on_semaphore` se fait dans `new_shared`.
    pub fn new(k: &mut Kernel) -> Dsp {
        let semaphore_event = k.create_event(0, "dsp : sémaphore");
        let mut pipes = BTreeMap::new();
        pipes.insert(2, Vec::new());
        pipes.insert(3, Vec::new());
        Dsp {
            me: Weak::new(),
            loaded: false,
            channel_events: BTreeMap::new(),
            pipes,
            reply_ready: false,
            semaphore_event,
            frames: 0,
            frame_pending: false,
            running: false,
            component_size: 0,
        }
    }

    /// `new` rangé dans un `Rc<RefCell<_>>`, avec `on_semaphore` accroché à l'événement du sémaphore.
    pub fn new_shared(k: &mut Kernel) -> Rc<RefCell<Dsp>> {
        let dsp = Rc::new(RefCell::new(Dsp::new(k)));
        dsp.borrow_mut().me = Rc::downgrade(&dsp);
        let (weak, event) = (Rc::downgrade(&dsp), dsp.borrow().semaphore_event);
        k.add_event_listener(event, Rc::new(move |k: &mut Kernel, _| {
            if let Some(dsp) = weak.upgrade() {
                if let Ok(mut dsp) = dsp.try_borrow_mut() {
                    dsp.on_semaphore(k);
                }
            }
        }));
        dsp
    }

    fn load_component(&mut self, req: &Request) -> Reply {
        self.component_size = req.word(4) >> 4;
        let was = self.loaded;
        self.loaded = true;
        Reply::with_words(0, &[if was { 0 } else { 1 }]).raw(&[req.word(4), req.word(5)]).with_note(format!(
            "composant de {:#x} octets, masques {:#x}/{:#x}", self.component_size, req.word(2) & 0xFFFF,
            req.word(3) & 0xFFFF))
    }

    fn unload_component(&mut self) -> Reply {
        self.loaded = false;
        self.running = false;
        Reply::new(0)
    }

    fn register_interrupt_events(&mut self, k: &Kernel, req: &Request) -> Reply {
        let (kind, channel) = (req.word(1) & 0xFF, req.word(2));
        let event = req.handle_objects(3).first().copied().flatten();
        match event {
            None => {
                self.channel_events.remove(&channel);
                Reply::new(0).with_note(format!("canal {channel} désinscrit"))
            }
            Some(event) => {
                self.channel_events.insert(channel, event);
                Reply::new(0).with_note(format!("type {kind}, canal {channel} : {}", k.label(event)))
            }
        }
    }

    fn write_process_pipe(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let channel = req.word(1);
        let (address, size) = req.buffer(3);
        let data = k.memory.read(address, size).unwrap_or_default();
        if channel == 2 && data.len() >= 2 {
            let word = u16::from_le_bytes([data[0], data[1]]);
            if word == 0 || word == 2 {
                let pipe = self.pipes.entry(2).or_default();
                pipe.extend_from_slice(&(ADDRESSES.len() as u16).to_le_bytes());
                for address in ADDRESSES {
                    pipe.extend_from_slice(&address.to_le_bytes());
                }
                self.running = true;
                self.signal(k, 2);
                return Reply::new(0).with_note(format!("« démarre » ({word}) : 15 adresses dans le tuyau, signal du canal 2"));
            }
            self.reply_ready = true;
            self.running = false;
            return Reply::new(0).with_note(format!("« arrête » ({word}) : le registre 0 rendra 1"));
        }
        if channel == 3 {
            let request: i64 = if data.len() >= 4 { u16::from_le_bytes([data[2], data[3]]) as i64 } else { -1 };
            // En-tête recopié (codec, demande), résultat 0, arguments à zéro : le contenu d'une vraie réponse n'est
            // pas lu (contrat de dsp, partie 5). Renvoyer les arguments de la demande fait lire au jeu des
            // adresses physiques comme des index (faute à 0x2c95c0 au premier essai).
            let mut answer = data[..data.len().min(4)].to_vec();
            answer.resize(0x20, 0);
            self.pipes.entry(3).or_default().extend_from_slice(&answer);
            self.signal(k, 3);
            return Reply::new(0).with_note(format!("décodeur AAC, demande {request} : « réussi » sans décoder"));
        }
        Reply::new(0)
    }

    fn signal(&self, k: &mut Kernel, channel: u32) {
        if let Some(&event) = self.channel_events.get(&channel) {
            k.signal_event(event);
        }
    }

    fn read_pipe_if_possible(&mut self, req: &Request) -> Reply {
        let (channel, size) = (req.word(1), (req.word(3) & 0xFFFF) as usize);
        let pipe = self.pipes.get_mut(&channel);
        let length = pipe.as_ref().map(|p| p.len()).unwrap_or(0);
        if length < size {
            return Reply::with_words(0, &[0]).static_buffer(0, &[]).with_note(format!(
                "tuyau {channel} : {length} octets, {size} demandés"));
        }
        let data: Vec<u8> = match pipe {
            Some(pipe) => pipe.drain(..size).collect(),
            None => Vec::new(),
        };
        let hex: String = data.iter().take(32).map(|b| format!("{b:02x}")).collect();
        Reply::with_words(0, &[size as u32]).static_buffer(0, &data).with_note(format!("tuyau {channel} : {hex}"))
    }

    fn convert_address(&self, req: &Request) -> Reply {
        let address = req.word(1);
        let value = if self.loaded { DSP_BASE.wrapping_add(address.wrapping_mul(2)) } else { 0 };
        Reply::with_words(0, &[value])
    }

    /// Le jeu a levé le signal du sémaphore : une trame viendra dans `FRAME_NS`.
    pub fn on_semaphore(&mut self, k: &mut Kernel) {
        if self.frame_pending || !self.running {
            return;
        }
        self.frame_pending = true;
        let me = self.me.clone();
        let when = k.now + FRAME_NS;
        k.schedule(when, Box::new(move |k: &mut Kernel| {
            if let Some(dsp) = me.upgrade() {
                dsp.borrow_mut().frame(k);
            }
        }));
    }

    pub fn frame(&mut self, k: &mut Kernel) {
        self.frame_pending = false;
        if !self.running {
            return;
        }
        self.frames += 1;
        self.signal(k, 2);
    }
}

impl Service for Dsp {
    fn name(&self) -> &str {
        "dsp::DSP"
    }

    fn kind(&self) -> &'static str {
        "simplifié"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x01 => {
                self.reply_ready = false;
                Reply::with_words(0, &[1])
            }
            0x02 => Reply::with_words(0, &[if self.reply_ready { 1 } else { 0 }]),
            0x07 => Reply::new(0),
            0x0C => self.convert_address(req),
            0x0D => self.write_process_pipe(k, req),
            0x10 => self.read_pipe_if_possible(req),
            0x11 => self.load_component(req),
            0x12 => self.unload_component(),
            0x13 | 0x14 | 0x17 => Reply::new(0),
            0x15 => self.register_interrupt_events(k, req),
            0x16 => Reply::new(0).copy_handles(&[self.semaphore_event]),
            _ => unknown_command(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel::memory::PERM_RW;
    use kernel::testing::{call, header, test_kernel, test_main_thread};

    const BUFFERS: u32 = 0x0200_0000;

    struct Rig {
        k: Kernel,
        thread: ObjId,
        dsp: Rc<RefCell<Dsp>>,
        session: ObjId,
    }

    fn rig() -> Rig {
        let (mut k, _script) = test_kernel();
        let thread = test_main_thread(&mut k);
        k.memory.map(BUFFERS, 0x10000, PERM_RW, "tampons", None).unwrap();
        let before = k.objects.len();
        let dsp = Dsp::new_shared(&mut k);
        assert_eq!(k.objects.len(), before + 1, "un seul objet à la construction : l'événement du sémaphore");
        let session = k.new_session(dsp.clone(), "dsp");
        Rig { k, thread, dsp, session }
    }

    impl Rig {
        fn call(&mut self, words: &[u32]) -> Vec<u32> {
            call(&mut self.k, self.thread, self.session, words)
        }

        fn last_line(&self) -> String {
            self.k.journal.capture.as_ref().unwrap().last().unwrap().clone()
        }

        /// RegisterInterruptEvents(type, canal) avec un nouvel événement ; rend l'événement.
        fn register(&mut self, channel: u32) -> ObjId {
            let event = self.k.create_event(0, &format!("canal {channel}"));
            let handle = self.k.add_handle(event).unwrap();
            let reply = self.call(&[header(0x15, 2, 2), 0, channel, 0, handle]);
            assert_eq!(reply[1], 0);
            event
        }

        fn write_pipe(&mut self, channel: u32, data: &[u8]) -> Vec<u32> {
            self.k.memory.write(BUFFERS, data).unwrap();
            let size = data.len() as u32;
            self.call(&[header(0x0D, 2, 2), channel, size, size << 4 | 0xA, BUFFERS])
        }

        /// ReadPipeIfPossible(canal, taille) avec un tampon de réception de 0x100 octets à BUFFERS + 0x200.
        fn read_pipe(&mut self, channel: u32, size: u32) -> Vec<u32> {
            let tls = self.k.thread(self.thread).tls;
            self.k.memory.w32(tls + 0x180, 0x100 << 14 | 2).unwrap();
            self.k.memory.w32(tls + 0x184, BUFFERS + 0x200).unwrap();
            self.call(&[header(0x10, 3, 2), channel, 0, size, 0x100 << 14 | 2, BUFFERS + 0x200])
        }

        fn signals(&self, event: ObjId) -> u64 {
            self.k.event(event).signal_count
        }
    }

    #[test]
    fn semaphore_handle_and_simple_commands() {
        let mut r = rig();
        let sem = r.dsp.borrow().semaphore_event;
        assert_eq!(r.k.objects[sem].name, "dsp : sémaphore");
        assert_eq!(r.k.event(sem).reset_type, 0);
        let reply = r.call(&[header(0x16, 0, 0)]);
        assert_eq!(reply[0], header(0x16, 1, 2));
        assert_eq!(reply[2], 0);
        assert_eq!(r.k.lookup(reply[3], None), Some(sem));
        for command in [0x07, 0x13, 0x14, 0x17] {
            assert_eq!(r.call(&[header(command, 0, 0)])[1], 0);
        }
        assert_eq!(r.call(&[header(0x40, 0, 0)])[1], 0xD900182F);
        assert!(r.last_line().contains("(simplifié)"));
    }

    #[test]
    fn component_loading_and_address_conversion() {
        let mut r = rig();
        // avant le chargement : 0
        assert_eq!(r.call(&[header(0x0C, 1, 0), 0x1000])[2], 0);
        let reply = r.call(&[header(0x11, 3, 2), 0, 0xFFFF_00FF, 0xFFFF_01FF, 0x1000 << 4 | 0xA, BUFFERS]);
        assert_eq!(reply[0], header(0x11, 2, 2));
        assert_eq!(&reply[1..], &[0, 1, 0x1000 << 4 | 0xA, BUFFERS]);
        assert!(r.last_line().contains("« composant de 0x1000 octets, masques 0xff/0x1ff »"));
        assert_eq!(r.call(&[header(0x0C, 1, 0), 0x1000])[2], 0x1FF4_2000);
        assert_eq!(r.call(&[header(0x0C, 1, 0), 0x8000_0000])[2], 0x1FF4_0000);
        // un second chargement rend 0
        let reply = r.call(&[header(0x11, 3, 2), 0, 0, 0, 0x10 << 4 | 0xA, BUFFERS]);
        assert_eq!(reply[2], 0);
        // le déchargement
        r.dsp.borrow_mut().running = true;
        assert_eq!(r.call(&[header(0x12, 0, 0)])[1], 0);
        assert!(!r.dsp.borrow().loaded && !r.dsp.borrow().running);
        assert_eq!(r.call(&[header(0x0C, 1, 0), 0x1000])[2], 0);
    }

    #[test]
    fn interrupt_events_register_and_unregister() {
        let mut r = rig();
        let e2 = r.register(2);
        assert!(r.last_line().contains("« type 0, canal 2 : événement#"));
        assert!(r.last_line().contains("« canal 2 »"));
        assert_eq!(r.dsp.borrow().channel_events[&2], e2);
        // une poignée vide désinscrit
        let reply = r.call(&[header(0x15, 2, 2), 0, 2, 0, 0]);
        assert_eq!(reply[1], 0);
        assert!(r.last_line().contains("« canal 2 désinscrit »"));
        assert!(r.dsp.borrow().channel_events.is_empty());
    }

    #[test]
    fn sound_start_writes_the_fifteen_addresses() {
        let mut r = rig();
        let e2 = r.register(2);
        let reply = r.write_pipe(2, &[0, 0]);
        assert_eq!(reply[1], 0);
        assert!(r.last_line().contains("« « démarre » (0) : 15 adresses dans le tuyau, signal du canal 2 »"));
        assert!(r.dsp.borrow().running);
        assert_eq!(r.signals(e2), 1);
        assert_eq!(r.dsp.borrow().pipes[&2].len(), 32);
        // trop tôt : le tuyau 2 n'a pas 100 octets
        let reply = r.read_pipe(2, 100);
        assert_eq!(reply[0], header(0x10, 2, 2));
        assert_eq!(reply[2], 0);
        assert_eq!(reply[3], 0 << 14 | 2);
        assert!(r.last_line().contains("« tuyau 2 : 32 octets, 100 demandés »"));
        // lecture du compte puis des 15 adresses
        let reply = r.read_pipe(2, 2);
        assert_eq!(reply[2], 2);
        assert_eq!(reply[3], 2 << 14 | 2);
        assert_eq!(reply[4], BUFFERS + 0x200);
        assert_eq!(r.k.memory.read(BUFFERS + 0x200, 2).unwrap(), vec![15, 0]);
        assert!(r.last_line().contains("« tuyau 2 : 0f00 »"));
        let reply = r.read_pipe(2, 30);
        assert_eq!(reply[2], 30);
        let data = r.k.memory.read(BUFFERS + 0x200, 30).unwrap();
        let addresses: Vec<u16> = data.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(addresses, ADDRESSES.to_vec());
        assert_eq!(addresses[0], 0xBFFF);
        assert_eq!(addresses[14], 0xAC5C);
        assert!(r.dsp.borrow().pipes[&2].is_empty());
        // la valeur 2 démarre aussi ; un canal inconnu ne fait rien
        r.write_pipe(2, &[2, 0]);
        assert_eq!(r.dsp.borrow().pipes[&2].len(), 32);
        assert_eq!(r.write_pipe(5, &[0, 0])[1], 0);
        assert_eq!(r.dsp.borrow().pipes[&2].len(), 32);
        // un tuyau jamais ouvert se lit comme vide
        let reply = r.read_pipe(9, 0);
        assert_eq!(reply[2], 0);
        assert!(r.last_line().contains("« tuyau 9 :  »"));
    }

    #[test]
    fn stop_and_reply_register() {
        let mut r = rig();
        r.register(2);
        r.write_pipe(2, &[0, 0]);
        assert_eq!(r.call(&[header(0x02, 0, 0)])[2], 0);
        r.write_pipe(2, &[1, 0]);
        assert!(r.last_line().contains("« « arrête » (1) : le registre 0 rendra 1 »"));
        assert!(!r.dsp.borrow().running);
        assert_eq!(r.call(&[header(0x02, 0, 0)])[2], 1);
        assert_eq!(r.call(&[header(0x01, 0, 0)])[2], 1);
        assert_eq!(r.call(&[header(0x02, 0, 0)])[2], 0);
        // un seul octet sur le canal 2 : rien
        let len = r.dsp.borrow().pipes[&2].len();
        r.write_pipe(2, &[0]);
        assert_eq!(r.dsp.borrow().pipes[&2].len(), len);
    }

    #[test]
    fn aac_decoder_answers_success_without_decoding() {
        let mut r = rig();
        let e3 = r.register(3);
        r.write_pipe(3, &[1, 0, 5, 0, 9, 9, 9, 9]);
        assert!(r.last_line().contains("« décodeur AAC, demande 5 : « réussi » sans décoder »"));
        assert_eq!(r.signals(e3), 1);
        let reply = r.read_pipe(3, 0x20);
        assert_eq!(reply[2], 0x20);
        let mut expected = vec![1, 0, 5, 0];
        expected.resize(0x20, 0);
        assert_eq!(r.k.memory.read(BUFFERS + 0x200, 0x20).unwrap(), expected);
        // une demande trop courte : -1, en-tête complété de zéros
        r.write_pipe(3, &[7, 7]);
        assert!(r.last_line().contains("demande -1 :"));
        assert_eq!(r.dsp.borrow().pipes[&3], {
            let mut v = vec![7, 7];
            v.resize(0x20, 0);
            v
        });
    }

    #[test]
    fn frames_follow_the_semaphore() {
        let mut r = rig();
        let e2 = r.register(2);
        let sem = r.dsp.borrow().semaphore_event;
        // pas démarré : le signal du sémaphore ne planifie rien
        r.k.signal_event(sem);
        assert_eq!(r.k.next_event_time(), None);
        r.write_pipe(2, &[0, 0]);
        assert_eq!(r.signals(e2), 1);
        // démarré : une trame arrive FRAME_NS plus tard, un second signal en attente ne double rien
        r.k.now = 1_000;
        r.k.signal_event(sem);
        r.k.signal_event(sem);
        assert!(r.dsp.borrow().frame_pending);
        assert_eq!(r.k.next_event_time(), Some(1_000 + FRAME_NS));
        r.k.now = 1_000 + FRAME_NS - 1;
        r.k.run_due_events();
        assert_eq!(r.dsp.borrow().frames, 0);
        r.k.now = 1_000 + FRAME_NS;
        r.k.run_due_events();
        assert_eq!(r.dsp.borrow().frames, 1);
        assert!(!r.dsp.borrow().frame_pending);
        assert_eq!(r.signals(e2), 2);
        assert_eq!(r.k.next_event_time(), None);
        // une trame en attente quand le son s'arrête ne lève rien
        r.k.signal_event(sem);
        r.write_pipe(2, &[1, 0]);
        r.k.now += FRAME_NS;
        r.k.run_due_events();
        assert_eq!(r.dsp.borrow().frames, 1);
        assert_eq!(r.signals(e2), 2);
        assert!(!r.dsp.borrow().frame_pending);
        // arrêté : le sémaphore ne planifie plus
        r.k.signal_event(sem);
        assert_eq!(r.k.next_event_time(), None);
    }
}
