//! Une requête d'un fil à un service, et sa réponse (kernel11.md, partie 5 ; contrats, partie 1). Même rôle que
//! `banc/ipc.py`.
//!
//! Sur la console, le noyau recopie et traduit la requête du tampon du fil client vers celui du service, puis la réponse
//! dans l'autre sens. Ici le service est un objet Rust dans le même espace d'adresses : la traduction se résume à lire les
//! descripteurs, à prendre ou donner des objets du noyau par la table des poignées, et à recopier les tampons statiques
//! que le client a déclarés à +0x180 de son stockage local.
//!
//! Un service implémente `Service` : `handle` reçoit une `Request` et rend une `Reply`. Le journal note, pour chaque
//! requête, le service, l'en-tête, le nom de la commande d'après la Carte, la fonction du jeu qui envoie et celle qui
//! l'appelle, et ce qui a été répondu.

use std::collections::BTreeMap;

use crate::cpu::{Reg, R0};
use crate::kernel::{Kernel, PSEUDO_PROCESS, PSEUDO_THREAD};
use crate::object::{ClientSession, Obj, ObjId, SharedService};

pub const ERR_UNKNOWN_COMMAND: u32 = 0xD900_182F;

/// Ce que le noyau a fait d'un élément de traduction de la requête.
#[derive(Clone, Debug)]
pub enum Item {
    /// Le numéro du processus (descripteur 0x20).
    Pid(u32),
    /// Des poignées : les objets (rien si la poignée ne désigne rien) et les poignées d'origine.
    Handles { objects: Vec<Option<ObjId>>, handles: Vec<u32> },
    /// Un tampon statique : indice, adresse, taille.
    Static { index: u32, address: u32, size: u32 },
    /// Un tampon projeté (genre 0xA, 0xC ou 0xE) : adresse, taille.
    Buffer { kind: u32, address: u32, size: u32 },
    Raw(u32),
}

pub struct Request {
    pub thread: ObjId,
    pub session: ObjId,
    pub cmdbuf: u32,
    pub header: u32,
    pub command: u32,
    pub normal: u32,
    pub translate: u32,
    pub w: Vec<u32>,
    pub items: BTreeMap<usize, Item>,
    /// Le stockage local du fil client (pour les tampons de réception).
    pub tls: u32,
}

impl Request {
    /// Lit la requête dans le tampon de commandes du fil (`tls + 0x80`) et traduit les descripteurs. Les poignées
    /// déplacées sont fermées chez le client.
    pub fn parse(k: &mut Kernel, thread: ObjId, session: ObjId) -> Request {
        let tls = k.thread(thread).tls;
        let cmdbuf = tls + 0x80;
        let header = k.memory.u32(cmdbuf).unwrap_or(0);
        let normal = header >> 6 & 0x3F;
        let translate = header & 0x3F;
        let count = 1 + normal + translate;
        let w = k.memory.words(cmdbuf, count.min(0x40) as usize).unwrap_or_default();
        let mut request = Request {
            thread,
            session,
            cmdbuf,
            header,
            command: header >> 16,
            normal,
            translate,
            w,
            items: BTreeMap::new(),
            tls,
        };
        request.parse_translate(k);
        request
    }

    fn parse_translate(&mut self, k: &mut Kernel) {
        let mut pos = 1 + self.normal as usize;
        let end = pos + self.translate as usize;
        while pos < end && pos < self.w.len() {
            let descriptor = self.w[pos];
            if descriptor & 0xE == 0 {
                // poignées (copiées, déplacées) ou numéro de processus
                if descriptor & 0x20 != 0 {
                    self.items.insert(pos, Item::Pid(k.process_pid()));
                    pos += 2;
                    continue;
                }
                let count = (descriptor >> 26) as usize + 1;
                let from = (pos + 1).min(self.w.len());
                let to = (pos + 1 + count).min(self.w.len());
                let handles: Vec<u32> = self.w[from..to].to_vec();
                let objects: Vec<Option<ObjId>> = handles.iter().map(|&h| k.lookup(h, Some(self.thread))).collect();
                if descriptor & 0x10 != 0 {
                    // poignées déplacées : fermées chez le client
                    for &h in &handles {
                        if h != PSEUDO_THREAD && h != PSEUDO_PROCESS {
                            k.handles.remove(h);
                        }
                    }
                }
                self.items.insert(pos, Item::Handles { objects, handles });
                pos += 1 + count;
                continue;
            }
            if descriptor & 0xF == 2 {
                // tampon statique
                let size = descriptor >> 14;
                let index = descriptor >> 10 & 0xF;
                let address = self.w.get(pos + 1).copied().unwrap_or(0);
                self.items.insert(pos, Item::Static { index, address, size });
                pos += 2;
                continue;
            }
            if descriptor & 0x8 != 0 {
                // tampon projeté 0xA, 0xC, 0xE
                let size = descriptor >> 4;
                let address = self.w.get(pos + 1).copied().unwrap_or(0);
                self.items.insert(pos, Item::Buffer { kind: descriptor & 0xF, address, size });
                pos += 2;
                continue;
            }
            // tampons PXI (genres 4 et 6) : un jeu n'en envoie pas
            self.items.insert(pos, Item::Raw(descriptor));
            pos += 2;
        }
    }

    // --- lecture pour les services ---

    pub fn word(&self, n: usize) -> u32 {
        self.w.get(n).copied().unwrap_or(0)
    }

    pub fn s32(&self, n: usize) -> i32 {
        self.word(n) as i32
    }

    pub fn u64(&self, n: usize) -> u64 {
        self.word(n) as u64 | (self.word(n + 1) as u64) << 32
    }

    pub fn handle_objects(&self, pos: usize) -> Vec<Option<ObjId>> {
        match self.items.get(&pos) {
            Some(Item::Handles { objects, .. }) => objects.clone(),
            _ => Vec::new(),
        }
    }

    /// Les octets d'un tampon statique envoyé par le client (le chemin d'un fichier, par exemple).
    pub fn static_data(&self, k: &Kernel, pos: usize) -> Vec<u8> {
        match self.items.get(&pos) {
            Some(Item::Static { address, size, .. }) if *size > 0 => k.memory.read(*address, *size).unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    /// (adresse, taille) d'un tampon projeté ou statique.
    pub fn buffer(&self, pos: usize) -> (u32, u32) {
        match self.items.get(&pos) {
            Some(Item::Buffer { address, size, .. }) => (*address, *size),
            Some(Item::Static { address, size, .. }) => (*address, *size),
            _ => (0, 0),
        }
    }

    /// (adresse, taille) du tampon de réception n° `index` que le client a déclaré à +0x180.
    pub fn receive_buffer(&self, k: &Kernel, index: u32) -> (u32, u32) {
        let descriptor = k.memory.u32(self.tls + 0x180 + 8 * index).unwrap_or(0);
        let address = k.memory.u32(self.tls + 0x184 + 8 * index).unwrap_or(0);
        (address, descriptor >> 14)
    }

    /// Les tampons projetés de la requête dans l'ordre : (position, genre, adresse, taille).
    pub fn buffer_items(&self) -> Vec<(usize, u32, u32, u32)> {
        self.items
            .iter()
            .filter_map(|(pos, item)| match item {
                Item::Buffer { kind, address, size } => Some((*pos, *kind, *address, *size)),
                _ => None,
            })
            .collect()
    }

    /// Les tampons statiques : (position, indice, adresse, taille).
    pub fn static_items(&self) -> Vec<(usize, u32, u32, u32)> {
        self.items
            .iter()
            .filter_map(|(pos, item)| match item {
                Item::Static { index, address, size } => Some((*pos, *index, *address, *size)),
                _ => None,
            })
            .collect()
    }

    /// Tous les objets des poignées envoyées, dans l'ordre.
    pub fn all_handle_objects(&self) -> Vec<Option<ObjId>> {
        let mut out = Vec::new();
        for item in self.items.values() {
            if let Item::Handles { objects, .. } = item {
                out.extend(objects.iter().copied());
            }
        }
        out
    }

    pub fn pids(&self) -> Vec<u32> {
        self.items.values().filter_map(|i| if let Item::Pid(p) = i { Some(*p) } else { None }).collect()
    }
}

/// Un élément à traduire dans la réponse.
#[derive(Clone, Debug)]
pub enum Translate {
    Copy(Vec<Option<ObjId>>),
    Move(Vec<Option<ObjId>>),
    Static { index: u32, data: Vec<u8> },
    Raw(Vec<u32>),
}

/// La réponse : le résultat, les mots ordinaires, puis les éléments à traduire.
#[derive(Clone, Debug)]
pub struct Reply {
    pub result: u32,
    pub words: Vec<u32>,
    pub translate: Vec<Translate>,
    /// En-tête imposé (sinon calculé).
    pub header: Option<u32>,
    pub note: String,
    /// « réel », « simplifié », « factice » : pour le journal (sinon celui du service).
    pub kind: Option<&'static str>,
}

impl Reply {
    pub fn new(result: u32) -> Reply {
        Reply { result, words: Vec::new(), translate: Vec::new(), header: None, note: String::new(), kind: None }
    }

    pub fn with_words(result: u32, words: &[u32]) -> Reply {
        let mut reply = Reply::new(result);
        reply.words = words.to_vec();
        reply
    }

    pub fn copy_handles(mut self, objects: &[ObjId]) -> Reply {
        self.translate.push(Translate::Copy(objects.iter().map(|&o| Some(o)).collect()));
        self
    }

    pub fn move_handles(mut self, objects: &[ObjId]) -> Reply {
        self.translate.push(Translate::Move(objects.iter().map(|&o| Some(o)).collect()));
        self
    }

    /// Comme `copy_handles` mais avec des cases vides possibles (poignée 0).
    pub fn copy_optional(mut self, objects: Vec<Option<ObjId>>) -> Reply {
        self.translate.push(Translate::Copy(objects));
        self
    }

    pub fn move_optional(mut self, objects: Vec<Option<ObjId>>) -> Reply {
        self.translate.push(Translate::Move(objects));
        self
    }

    pub fn static_buffer(mut self, index: u32, data: &[u8]) -> Reply {
        self.translate.push(Translate::Static { index, data: data.to_vec() });
        self
    }

    pub fn raw(mut self, words: &[u32]) -> Reply {
        self.translate.push(Translate::Raw(words.to_vec()));
        self
    }

    pub fn with_note(mut self, text: impl Into<String>) -> Reply {
        self.note = text.into();
        self
    }

    pub fn with_kind(mut self, kind: &'static str) -> Reply {
        self.kind = Some(kind);
        self
    }
}

/// `ipc.error` : un résultat d'erreur d'en-tête 0x40.
pub fn error(code: u32, note: &str) -> Reply {
    let mut reply = Reply::new(code);
    reply.header = Some(0x40);
    reply.note = note.to_string();
    reply
}

/// Un service du banc. `name` : son nom pour `srv:` ; `carte` : son identifiant dans la Carte (pour les noms).
pub trait Service {
    fn name(&self) -> &str;
    /// Le nom du type du service (celui de la classe Python du banc), pour la note de `GetServiceHandle`.
    fn class_name(&self) -> String {
        let full = std::any::type_name_of_val(self);
        let base = full.split('<').next().unwrap_or(full);
        base.rsplit("::").next().unwrap_or(base).to_string()
    }
    fn carte(&self) -> &str {
        self.name()
    }
    /// Ce que vaut l'ensemble du service : « réel », « simplifié », « factice ».
    fn kind(&self) -> &'static str {
        "réel"
    }
    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply;
    /// Après l'écriture de la réponse (`after_reply` du banc).
    fn after_reply(&mut self, _k: &mut Kernel, _req: &Request, _reply: &Reply) {}
    /// La dernière poignée vers cette session est fermée.
    fn on_session_closed(&mut self, _k: &mut Kernel, _session: ObjId) {}
}

/// `unknown` du banc : la commande n'est pas connue.
pub fn unknown_command() -> Reply {
    error(ERR_UNKNOWN_COMMAND, "commande inconnue du banc")
}

/// Ce qui a été écrit dans le tampon de commandes : (en-tête, mots ordinaires y compris le résultat, éléments traduits).
pub struct Written {
    pub header: u32,
    pub words: Vec<u32>,
    pub translated: Vec<u32>,
}

pub fn write_reply(k: &mut Kernel, request: &Request, reply: &Reply) -> Written {
    let mut words = vec![reply.result];
    words.extend_from_slice(&reply.words);
    let mut translated: Vec<u32> = Vec::new();
    for item in &reply.translate {
        match item {
            Translate::Copy(objects) | Translate::Move(objects) => {
                let moving = matches!(item, Translate::Move(_));
                translated.push((objects.len() as u32).wrapping_sub(1) << 26 | if moving { 0x10 } else { 0 });
                for obj in objects {
                    translated.push(match obj {
                        Some(id) => k.add_handle(*id).unwrap_or(0),
                        None => 0,
                    });
                }
            }
            Translate::Static { index, data } => {
                let (address, size) = request.receive_buffer(k, *index);
                let data = &data[..data.len().min(size as usize)];
                if !data.is_empty() {
                    let _ = k.memory.write(address, data);
                }
                translated.push((data.len() as u32) << 14 | index << 10 | 2);
                translated.push(address);
            }
            Translate::Raw(raw) => translated.extend_from_slice(raw),
        }
    }
    let mut header = reply.header.unwrap_or_else(|| request.command << 16 | (words.len() as u32) << 6 | translated.len() as u32);
    if header == 0x40 {
        words = vec![reply.result];
        translated.clear();
    } else if header & 0xFFFF_0000 == 0 {
        header |= request.command << 16;
    }
    let mut out = vec![header];
    out.extend_from_slice(&words);
    out.extend_from_slice(&translated);
    let bytes: Vec<u8> = out.iter().flat_map(|w| w.to_le_bytes()).collect();
    let _ = k.memory.write(request.cmdbuf, &bytes);
    Written { header, words, translated }
}

/// `ipc.dispatch` : traite un SendSyncRequest.
pub fn dispatch(k: &mut Kernel, thread: ObjId, session: ObjId) {
    let handler: SharedService = match &k.objects[session].data {
        Obj::Session(ClientSession { handler }) => handler.clone(),
        _ => return,
    };
    let request = Request::parse(k, thread, session);
    let pc = k.cpu.get(Reg::Pc).wrapping_sub(4);
    let lr = k.cpu.get(Reg::Lr);
    let mut reply = handler.borrow_mut().handle(k, &request);
    let kind = reply.kind.unwrap_or_else(|| handler.borrow().kind());
    reply.kind = Some(kind);
    let written = write_reply(k, &request, &reply);
    let (label, carte) = (k.objects[session].name.clone(), handler.borrow().carte().to_string());
    let (now, thread_id) = (k.now, k.thread(thread).thread_id);
    k.journal.ipc(now, thread_id, &label, &carte, request.header, &request.w, kind, reply.result, &reply.note, pc, lr,
        written.header, &written.words, &written.translated);
    handler.borrow_mut().after_reply(k, &request, &reply);
    let _ = R0;
}
