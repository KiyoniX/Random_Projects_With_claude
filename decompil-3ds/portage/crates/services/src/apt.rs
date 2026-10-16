//! `APT:U`, la vie de l'application (contrat APT ; fiche ns). Port de `banc/services/apt.py`.
//!
//! Réel pour le démarrage : le verrou commun (un vrai mutex), les deux signaux d'Initialize, la boîte aux lettres des
//! paramètres (Enable y dépose la commande 1 du menu HOME et lève le signal des paramètres), GlanceParameter et
//! ReceiveParameter, la police partagée (un vrai bloc de mémoire partagée, premier mot à 2, police à +0x80, pointeurs
//! laissés tels qu'ils sont dans le fichier : c'est le jeu qui les reloge).
//! Simplifié : les commandes du bouton HOME, des applets, de la veille et de la sortie répondent 0 sans rien lancer ;
//! aucune notification n'est jamais déposée (piège 2 du contrat).

use kernel::ipc::{Reply, Request, Service, unknown_command};
use kernel::kernel::Kernel;
use kernel::object::ObjId;

pub const APP_ID: u32 = 0x300;
pub const HOME_MENU: u32 = 0x101;
pub const FONT_BLOCK_SIZE: u32 = 0x33_2000;
/// Dans la plage du tas linéaire, au-dessus de ce que le banc y donne au jeu.
pub const FONT_ADDRESS: u32 = 0x1B80_0000;
pub const ERR_NO_PARAMETER: u32 = 0xC8A0_CFEF;

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
        }
    }

    fn note_startup(&mut self, k: &mut Kernel, name: &str) {
        self.startup_answers.push(name.to_string());
        k.on_apt_answer(name);
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
        self.parameter = Some(Parameter::new(HOME_MENU, APP_ID, 1));
        k.signal_event(self.parameter_event);
        Reply::new(0).with_note("paramètre « commande 1 » déposé, signal des paramètres levé")
    }

    fn send_parameter(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (sender, destination, command) = (req.word(1), req.word(2), req.word(3));
        if command & 0xFF == 0x10 {
            // ns garde les données et répond aussitôt par la commande 3 du destinataire (contrat, rubrique 0x0C).
            self.parameter = Some(Parameter::new(destination, sender, 3));
            k.signal_event(self.parameter_event);
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
                Reply::with_words(0, &[if app == HOME_MENU || app == APP_ID { 1 } else { 0 }])
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
            0x18 | 0x19 | 0x1E | 0x1F | 0x2B | 0x2C | 0x31 | 0x32 | 0x3B | 0x3E | 0x3F | 0x40 | 0x42 => ok_reply(),
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
