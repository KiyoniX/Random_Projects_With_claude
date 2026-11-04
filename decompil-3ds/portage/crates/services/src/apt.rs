//! `APT:U`, la vie de l'application (contrat APT ; fiche ns). Port de `banc/services/apt.py`.
//!
//! Réel pour le démarrage : le verrou commun (un vrai mutex), les deux signaux d'Initialize, la boîte aux lettres des
//! paramètres (Enable y dépose la commande 1 du menu HOME et lève le signal des paramètres), GlanceParameter et
//! ReceiveParameter, la police partagée (un vrai bloc de mémoire partagée, premier mot à 2, police à +0x80, pointeurs
//! laissés tels qu'ils sont dans le fichier : c'est le jeu qui les reloge).
//! L'applet d'erreur (`0x406`) est servi comme le fait Azahar sans son titre : inscrit dès PrepareToStartLibraryApplet,
//! il répond 3 à la requête 2 du jeu, puis, à StartLibraryApplet, rend aussitôt la main par la commande `0x0A` avec les
//! données reçues telles quelles (rien n'est affiché).
//! Simplifié : les commandes du bouton HOME, des autres applets, de la veille et de la sortie répondent 0 sans rien lancer ;
//! aucune notification n'est jamais déposée (piège 2 du contrat). Le saut d'application (PrepareToDoApplicationJump puis
//! DoApplicationJump) est seulement noté : à l'ExitProcess qui suit, un saut vers soi relance le jeu, un autre l'arrête ;
//! le paramètre et le hachage passés au titre suivant ne sont pas gardés.

use kernel::bench::AppJump;
use kernel::ipc::{Reply, Request, Service, unknown_command};
use kernel::kernel::Kernel;
use kernel::object::ObjId;

pub const APP_ID: u32 = 0x300;
pub const HOME_MENU: u32 = 0x101;
pub const FONT_BLOCK_SIZE: u32 = 0x33_2000;
/// Dans la plage du tas linéaire, au-dessus de ce que le banc y donne au jeu.
pub const FONT_ADDRESS: u32 = 0x1B80_0000;
pub const ERR_NO_PARAMETER: u32 = 0xC8A0_CFEF;
/// L'applet d'erreur (erreula) : `AppletId::Error2` d'Azahar, envoyé par le jeu en `0x1353ec` (contrat APT, rubrique 0x18).
pub const ERROR_APPLET: u32 = 0x406;
/// Commandes de paramètre (Azahar, `SignalType`) : 2 requête à un applet, 3 sa réponse, `0x0A` le réveil après sa sortie.
const SIGNAL_REQUEST: u32 = 2;
const SIGNAL_RESPONSE: u32 = 3;
const SIGNAL_WAKEUP_BY_EXIT: u32 = 0x0A;

struct Parameter {
    sender: u32,
    #[allow(dead_code)]
    destination: u32,
    command: u32,
    data: Vec<u8>,
    handle: Option<ObjId>,
}

impl Parameter {
    fn new(sender: u32, destination: u32, command: u32) -> Parameter {
        Parameter { sender, destination, command, data: Vec::new(), handle: None }
    }
}

pub struct Apt {
    lock: ObjId,
    notification_event: ObjId,
    parameter_event: ObjId,
    parameter: Option<Parameter>,
    notifications: Vec<u32>,
    font: Option<(ObjId, String)>,
    pub startup_answers: Vec<String>,
    pub registered: bool,
    /// Le saut préparé, que DoApplicationJump confirme.
    jump: Option<AppJump>,
    /// L'applet de bibliothèque préparé et servi, inscrit jusqu'à ce qu'il rende la main.
    library_applet: Option<u32>,
}

impl Apt {
    /// Crée dans l'ordre du banc : le verrou, l'événement des notifications, celui des paramètres.
    pub fn new(k: &mut Kernel) -> Apt {
        let lock = k.create_mutex(None, "verrou d'APT");
        let notification_event = k.create_event(0, "APT : notifications");
        let parameter_event = k.create_event(0, "APT : paramètres");
        Apt {
            lock,
            notification_event,
            parameter_event,
            parameter: None,
            notifications: Vec::new(),
            font: None,
            startup_answers: Vec::new(),
            registered: false,
            jump: None,
            library_applet: None,
        }
    }

    fn note_startup(&mut self, k: &mut Kernel, name: &str) {
        self.startup_answers.push(name.to_string());
        k.on_apt_answer(name);
    }

    /// 3dbrew, APT PrepareToDoApplicationJump : drapeaux 0 = le titre donné, 1 = celui que garde ns (non servi),
    /// 2 = le titre courant ; puis le titre (u64) et le média.
    fn prepare_jump(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (flags, title) = (req.word(1) & 0xFF, req.word(2) as u64 | (req.word(3) as u64) << 32);
        let jump = match flags {
            2 => AppJump::Myself,
            0 if title == k.bench.title_id => AppJump::Myself,
            0 => AppJump::Elsewhere(format!("le titre {title:016x}")),
            _ => AppJump::Elsewhere(format!("le titre gardé par ns (drapeaux {flags})")),
        };
        let note = format!("saut préparé : {jump:?}");
        self.jump = Some(jump);
        Reply::new(0).with_note(note)
    }

    fn prepare_library_applet(&mut self, req: &Request) -> Reply {
        let applet = req.word(1);
        if applet != ERROR_APPLET {
            return ok_reply().with_note(format!("applet {applet:#x} non servi"));
        }
        self.library_applet = Some(applet);
        Reply::new(0).with_note("applet d'erreur inscrit, il rendra la main dès son lancement")
    }

    /// Azahar, `ErrEula::Start` puis `CloseApplet` : la sortie de l'applet dépose pour le jeu la commande `0x0A`, avec
    /// les données de lancement (0xF80 octets pour l'applet d'erreur) et sans poignée ; l'applet n'est plus inscrit.
    fn start_library_applet(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let applet = req.word(1);
        if self.library_applet != Some(applet) {
            return ok_reply().with_note(format!("applet {applet:#x} non servi"));
        }
        self.library_applet = None;
        let mut exit = Parameter::new(applet, APP_ID, SIGNAL_WAKEUP_BY_EXIT);
        exit.data = req.static_data(k, 5);
        let note = format!("l'applet {applet:#x} rend aussitôt la main : commande 0x0a, {} octets rendus", exit.data.len());
        self.post(k, exit);
        Reply::new(0).with_note(note)
    }

    /// Dépose un paramètre pour le jeu et lève le signal des paramètres.
    fn post(&mut self, k: &mut Kernel, p: Parameter) {
        self.parameter = Some(p);
        k.signal_event(self.parameter_event);
    }

    fn get_lock_handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let attributes = req.word(1);
        self.note_startup(k, "GetLockHandle");
        Reply::with_words(0, &[attributes, 0]).copy_handles(&[self.lock])
            .with_note(format!("attributs {attributes:#x}, verrou {}", k.label(self.lock)))
    }

    fn initialize(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        self.note_startup(k, "Initialize");
        if req.word(1) != APP_ID {
            k.note(&format!("APT Initialize : identifiant {:#x} au lieu de 0x300 attendu", req.word(1)));
        }
        Reply::new(0).copy_handles(&[self.notification_event, self.parameter_event])
    }

    fn enable(&mut self, k: &mut Kernel) -> Reply {
        self.note_startup(k, "Enable");
        self.registered = true;
        // Le réveil du démarrage : commande 1, venue du menu HOME, sans données ni poignée.
        self.post(k, Parameter::new(HOME_MENU, APP_ID, 1));
        Reply::new(0).with_note("paramètre « commande 1 » déposé, signal des paramètres levé")
    }

    fn send_parameter(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (sender, destination, command) = (req.word(1), req.word(2), req.word(3));
        if command & 0xFF == SIGNAL_REQUEST && self.library_applet == Some(destination) {
            // Azahar, `ErrEula::ReceiveParameterImpl` : l'applet répond 3 avec un bloc partagé de la taille que donne le
            // premier mot des informations de capture ; le jeu le projette et y copie ses écrans (MapMemoryBlock après
            // la réponse, `0x149804` -> `0x164824`), une réponse sans bloc le fait fauter.
            let data = req.static_data(k, 7);
            let size = data.get(..4).map_or(0, |w| u32::from_le_bytes(w.try_into().unwrap()));
            let block = k.create_shared(size, None, 0, "capture de l'applet");
            let mut response = Parameter::new(destination, sender, SIGNAL_RESPONSE);
            response.handle = Some(block);
            self.post(k, response);
            return Reply::new(0)
                .with_note(format!("requête à l'applet {destination:#x} : réponse « commande 3 » et bloc de {size:#x} octets"));
        }
        if command & 0xFF == 0x10 {
            // ns garde les données et répond aussitôt par la commande 3 du destinataire (contrat, rubrique 0x0C).
            self.post(k, Parameter::new(destination, sender, 3));
            return Reply::new(0).with_note("commande 0x10 : réponse « commande 3 » déposée pour le jeu");
        }
        Reply::new(0).with_note(format!("paramètre {command:#x} pour {destination:#x} : pas de destinataire dans le banc"))
    }

    fn parameter_reply(&mut self, k: &mut Kernel, req: &Request, move_handles: bool) -> Reply {
        let Some(p) = &self.parameter else {
            return Reply::new(ERR_NO_PARAMETER).with_note("boîte vide");
        };
        let (_, room) = req.receive_buffer(k, 0);
        let take = (room.min(req.word(2)).min(0x1000)) as usize;
        let data: Vec<u8> = p.data[..take.min(p.data.len())].to_vec();
        let mut reply = Reply::with_words(0, &[p.sender, p.command, data.len() as u32]);
        reply = if move_handles { reply.move_optional(vec![p.handle]) } else { reply.copy_optional(vec![p.handle]) };
        reply = reply.static_buffer(0, &data);
        reply.note = format!("expéditeur {:#x}, commande {:#x}, {} octets", p.sender, p.command, data.len());
        reply
    }

    fn receive_parameter(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let reply = self.parameter_reply(k, req, true);
        if let Some(command) = self.parameter.as_ref().map(|p| p.command) {
            if command == 1 {
                self.note_startup(k, "ReceiveParameter");
            }
            self.parameter = None;
        }
        reply
    }

    fn glance_parameter(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let reply = self.parameter_reply(k, req, false);
        if let Some(command) = self.parameter.as_ref().map(|p| p.command) {
            if command == 1 {
                self.note_startup(k, "GlanceParameter");
            }
            if command == 8 || command == 9 {
                self.parameter = None;
            }
        }
        reply
    }

    fn cancel_parameter(&mut self, req: &Request) -> Reply {
        let mut removed = 0;
        if let Some(sender) = self.parameter.as_ref().map(|p| p.sender) {
            if req.word(1) & 0xFF == 0 || sender == req.word(2) {
                self.parameter = None;
                removed = 1;
            }
        }
        Reply::with_words(0, &[removed])
    }

    fn applet_utility(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let operation = req.word(1);
        self.note_startup(k, &format!("AppletUtility({operation})"));
        let (_, room) = req.receive_buffer(k, 0);
        let size = room.min(req.word(3)) as usize;
        Reply::with_words(0, &[0]).static_buffer(0, &vec![0u8; size]).with_note(format!("opération {operation}"))
    }

    /// `load_font` : la police partagée dans un vrai bloc (premier mot 2, police à +0x80), lue dans `local/`.
    fn load_font(&mut self, k: &mut Kernel) -> (ObjId, String) {
        let block = k.create_shared(FONT_BLOCK_SIZE, None, FONT_ADDRESS, "police partagée");
        let path = k.bench.paths.font.clone();
        let mut note = "police absente : bloc vide (premier mot 3)".to_string();
        match std::fs::read(&path) {
            Ok(font) if !path.as_os_str().is_empty() => {
                let mut data = vec![0u8; FONT_BLOCK_SIZE as usize];
                if font.len() < 4 || &font[..4] != b"CFNT" {
                    let head: Vec<u8> = font.iter().take(4).copied().collect();
                    note = format!("police illisible ({})", python_bytes(&head));
                    data[0..4].copy_from_slice(&3u32.to_le_bytes());
                } else {
                    let room = data.len() - 0x80;
                    let n = font.len().min(room);
                    data[0x80..0x80 + n].copy_from_slice(&font[..n]);
                    let base = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    note = format!("{base}, {} octets, pointeurs laissés tels quels", font.len());
                    data[0..4].copy_from_slice(&2u32.to_le_bytes());
                }
                k.shared(block).write(0, &data);
            }
            _ => k.shared(block).w32(0, 3),
        }
        (block, note)
    }

    fn get_shared_font(&mut self, k: &mut Kernel) -> Reply {
        if self.font.is_none() {
            self.font = Some(self.load_font(k));
        }
        self.note_startup(k, "GetSharedFont");
        let (block, note) = self.font.clone().unwrap();
        Reply::with_words(0, &[FONT_ADDRESS]).copy_handles(&[block]).with_note(note)
    }
}

/// La représentation d'un `bytes` Python (b'…') pour une note d'erreur.
fn python_bytes(data: &[u8]) -> String {
    let mut out = String::from("b'");
    for &b in data {
        match b {
            b'\\' => out.push_str("\\\\"),
            b'\'' => out.push_str("\\'"),
            0x20..=0x7E => out.push(b as char),
            _ => out.push_str(&format!("\\x{b:02x}")),
        }
    }
    out.push('\'');
    out
}

fn ok_reply() -> Reply {
    Reply::new(0).with_kind("factice")
}

impl Service for Apt {
    fn name(&self) -> &str {
        "APT:U"
    }

    fn kind(&self) -> &'static str {
        "simplifié"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x01 => self.get_lock_handle(k, req),
            0x02 => self.initialize(k, req),
            0x03 => self.enable(k),
            0x05 => {
                let position = req.word(1) & 0xFF;
                Reply::with_words(0, &[0, if position == 0 { APP_ID } else { 0 }, HOME_MENU, APP_ID])
            }
            0x09 => {
                let app = req.word(1);
                let registered = app == HOME_MENU || app == APP_ID || self.library_applet == Some(app);
                Reply::with_words(0, &[registered as u32])
            }
            0x0B => {
                if self.notifications.is_empty() {
                    Reply::with_words(0xC880_CFFA, &[0]).with_note("aucune notification (le banc n'en dépose pas)")
                } else {
                    Reply::with_words(0, &[self.notifications.remove(0)])
                }
            }
            0x0C => self.send_parameter(k, req),
            0x0D => self.receive_parameter(k, req),
            0x0E => self.glance_parameter(k, req),
            0x0F => self.cancel_parameter(req),
            0x18 => self.prepare_library_applet(req),
            0x1E => self.start_library_applet(k, req),
            0x19 | 0x1F | 0x2B | 0x2C | 0x3B | 0x3E | 0x3F | 0x40 | 0x42 => ok_reply(),
            0x31 => self.prepare_jump(k, req),
            0x32 => {
                let Some(jump) = self.jump.take() else {
                    return Reply::new(0).with_note("aucun saut préparé");
                };
                let note = format!("saut confirmé : {jump:?}, servi à la sortie du jeu");
                k.bench.app_jump = Some(jump);
                Reply::new(0).with_note(note)
            }
            0x22 => {
                k.note_event("le jeu prépare sa fermeture (PrepareToCloseApplication)");
                Reply::new(0)
            }
            0x27 => {
                k.request_stop("le jeu s'est fermé (CloseApplication)");
                Reply::new(0)
            }
            0x43 => {
                self.note_startup(k, "NotifyToWait");
                Reply::new(0)
            }
            0x44 => self.get_shared_font(k),
            0x4B => self.applet_utility(k, req),
            0x4D => Reply::with_words(0xC880_CFFA, &[0]).with_note(format!("applet {:#x} absent du banc", req.word(1))),
            _ => unknown_command(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel::cpu::Stop;
    use kernel::testing::{Step, call, header, test_kernel, test_main_thread};
    use std::cell::RefCell;
    use std::rc::Rc;

    const TITLE: u64 = 0x0004_0000_0005_5D00;

    /// PrepareToDoApplicationJump (drapeaux, titre), DoApplicationJump comme le jeu l'envoie, puis svcExitProcess : rend la
    /// raison de l'arrêt et la demande de relance.
    fn jump_then_exit(flags: u32, title: u64) -> (String, bool) {
        let (mut k, script) = test_kernel();
        k.bench.title_id = TITLE;
        let thread = test_main_thread(&mut k);
        let apt: kernel::object::SharedService = Rc::new(RefCell::new(Apt::new(&mut k)));
        let session = k.new_session(apt, "APT:U");
        k.add_handle(session);
        call(&mut k, thread, session, &[header(0x31, 4, 0), flags, title as u32, (title >> 32) as u32, 0]);
        call(&mut k, thread, session, &[header(0x32, 2, 4), 0, 0, 2, 0, 0x802, 0]);
        script.borrow_mut().push_back(Step { regs: vec![], stop: Stop::Svc { number: 3, pc: 0x10_0004 } });
        let reason = k.run(1_000_000_000, &mut |_| None);
        (reason, k.bench.restart_requested)
    }

    #[test]
    fn a_jump_to_itself_then_exit_asks_for_a_restart() {
        // drapeaux 2 : le titre courant, comme le jeu à la fin de la Ligue ; drapeaux 0 avec notre titre : pareil
        assert_eq!(jump_then_exit(2, u64::MAX), (kernel::bench::RESTART.to_string(), true));
        assert_eq!(jump_then_exit(0, TITLE), (kernel::bench::RESTART.to_string(), true));
    }

    #[test]
    fn a_jump_elsewhere_keeps_the_stop_and_says_why() {
        let (reason, restart) = jump_then_exit(0, 0x0004_0000_0005_5E00);
        assert!(!restart);
        assert!(reason.contains("0004000000055e00") && reason.contains("ne sait pas servir"), "{reason}");
        let (reason, restart) = jump_then_exit(1, 0);
        assert!(!restart && reason.contains("gardé par ns"), "{reason}");
    }

    /// Le chemin de l'applet d'erreur tel que le jeu l'envoie (contrat APT, rubriques 0x18, 0x0C, 0x1E) : préparation,
    /// IsRegistered, requête 2 et sa réponse, lancement, puis le paramètre de sortie avec les données rendues.
    #[test]
    fn the_error_applet_answers_then_hands_back_at_once() {
        let (mut k, _) = test_kernel();
        let thread = test_main_thread(&mut k);
        let apt: kernel::object::SharedService = Rc::new(RefCell::new(Apt::new(&mut k)));
        let session = k.new_session(apt, "APT:U");
        let (data, back) = (0x0800_0000u32, 0x0800_1000u32);
        k.memory.map(data, 0x2000, kernel::memory::PERM_RW, "données de test", None).unwrap();
        let config: Vec<u8> = (0..0xF80u32).map(|i| (i * 7) as u8).collect();
        k.memory.write(data, &config).unwrap();
        let tls = k.thread(thread).tls;
        k.memory.w32(tls + 0x180, 0x1000 << 14 | 2).unwrap();
        k.memory.w32(tls + 0x184, back).unwrap();
        let registered = |k: &mut Kernel| call(k, thread, session, &[header(0x09, 1, 0), ERROR_APPLET])[2];
        let receive = |k: &mut Kernel| call(k, thread, session, &[header(0x0D, 2, 0), APP_ID, 0x1000]);

        assert_eq!(registered(&mut k), 0);
        assert_eq!(call(&mut k, thread, session, &[header(0x18, 1, 0), ERROR_APPLET])[1], 0);
        assert_eq!(registered(&mut k), 1);
        k.memory.w32(data, 0x3_C000).unwrap();
        let request = [header(0x0C, 4, 4), APP_ID, ERROR_APPLET, 2, 0x20, 0, 0, 0x20 << 14 | 2, data];
        assert_eq!(call(&mut k, thread, session, &request)[1], 0);
        let response = receive(&mut k);
        assert_eq!(response[1..5], [0, ERROR_APPLET, 3, 0]);
        let block = k.lookup(response[6], Some(thread)).expect("la réponse joint un bloc partagé");
        assert_eq!(k.shared(block).size, 0x3_C000);
        k.memory.write(data, &config).unwrap();

        let start = [header(0x1E, 2, 4), ERROR_APPLET, 0xF80, 0, 0, 0xF80 << 14 | 2, data];
        assert_eq!(call(&mut k, thread, session, &start)[1], 0);
        assert_eq!(registered(&mut k), 0);
        assert_eq!(receive(&mut k)[1..5], [0, ERROR_APPLET, 0x0A, 0xF80]);
        assert_eq!(k.memory.read(back, 0xF80).unwrap(), config);
        assert_eq!(receive(&mut k)[1], ERR_NO_PARAMETER);
    }

    #[test]
    fn exit_without_a_jump_is_the_plain_stop() {
        let (mut k, script) = test_kernel();
        test_main_thread(&mut k);
        script.borrow_mut().push_back(Step { regs: vec![], stop: Stop::Svc { number: 3, pc: 0x10_0004 } });
        assert_eq!(k.run(1_000_000_000, &mut |_| None), "le jeu a appelé svcExitProcess");
        assert!(!k.bench.restart_requested);
    }
}
