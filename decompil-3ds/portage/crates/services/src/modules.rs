//! Les services remplaçants des modules réseau et accessoires, écrits d'après les fiches (colonne « Ce que Pokémon X
//! envoie »). Même rôle que `banc/services/modules.py`.
//!
//! `nwm::UDS`, `boss:U`, `boss:M`, `ssl:C`, `cecd:u`, `cam:u`, `mic:u`, `ir:USER`, `ndm:u`, `ac:u`, `frd:u`, `soc:U`,
//! `http:C`.
//!
//! Chaque service a deux garanties : (1) toute commande de la fiche reçoit une réponse de la bonne forme, celle que le
//! vrai module écrit en tête (`reply_shapes.rs` : nombre de mots, nombre de mots de traduction), et une commande
//! absente de la fiche reçoit `0xD900182F` comme sur la console ; (2) les commandes que Pokémon X envoie ont l'état et
//! les résultats que la fiche demande à un remplaçant (poignées d'événements vraies, états, erreurs). Tout ce que la
//! fiche dit pouvoir rester factice répond « 0 et des zéros ». Il n'y a aucun réseau : le Wi-Fi est « éteint », aucune
//! console voisine n'existe, aucun serveur ne répond.
//!
//! Là où le Python a une classe qui hérite de `Shaped`, il y a ici un type qui implémente `Module` ; `Shaped<M>` est le
//! service qui l'enveloppe (la forme des réponses, la note « première fois »). Les services sont créés par
//! `stubs::make_service` : le nom choisit le module.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use kernel::ipc::{error, Reply, Request, Service, Translate, ERR_UNKNOWN_COMMAND};
use kernel::kernel::Kernel;
use kernel::object::{Obj, ObjId, Wait, WaitKind, RESET_ONESHOT, RESET_STICKY};

use super::reply_shapes::{self, lookup, Shapes};

pub const NS_PER_MS: u64 = 1_000_000;

// --- la forme des réponses ---

/// Les tampons projetés de la requête, dans l'ordre : (position, genre, adresse, taille) ; genre 0xA lecture, 0xC
/// écriture, 0xE les deux.
pub fn buffer_items(req: &Request) -> Vec<(usize, u32, u32, u32)> {
    req.buffer_items()
}

/// Les tampons statiques de la requête : (position, indice, adresse, taille).
pub fn static_items(req: &Request) -> Vec<(usize, u32, u32, u32)> {
    req.static_items()
}

/// Tous les objets des poignées envoyées, dans l'ordre.
pub fn handle_objects(req: &Request) -> Vec<Option<ObjId>> {
    req.all_handle_objects()
}

fn objects_where(k: &Kernel, req: &Request, wanted: impl Fn(&Obj) -> bool) -> Vec<ObjId> {
    handle_objects(req).into_iter().flatten().filter(|&id| wanted(&k.objects[id].data)).collect()
}

/// Les événements parmi les poignées envoyées.
pub fn event_objects(k: &Kernel, req: &Request) -> Vec<ObjId> {
    objects_where(k, req, |o| matches!(o, Obj::Event(_)))
}

/// Les blocs de mémoire partagée parmi les poignées envoyées.
pub fn shared_objects(k: &Kernel, req: &Request) -> Vec<ObjId> {
    objects_where(k, req, |o| matches!(o, Obj::Shared(_)))
}

/// Les mots de traduction que prendra la réponse (`translate_length`).
pub fn translate_length(reply: &Reply) -> usize {
    reply
        .translate
        .iter()
        .map(|item| match item {
            Translate::Copy(objects) | Translate::Move(objects) => 1 + objects.len(),
            Translate::Static { .. } => 2,
            Translate::Raw(words) => words.len(),
        })
        .sum()
}

/// Complète la réponse d'un service pour qu'elle ait la forme de la fiche : mots ordinaires à zéro, puis les mots de
/// traduction (les descripteurs des tampons de la requête recopiés, sinon des zéros).
pub fn fit_reply(mut reply: Reply, req: &Request, shape: u32) -> Reply {
    let wanted_words = ((shape >> 6 & 0x3F) as usize).saturating_sub(1);
    if wanted_words > reply.words.len() {
        reply.words.resize(wanted_words, 0);
    }
    let mut deficit = (shape & 0x3F) as i64 - translate_length(&reply) as i64;
    let echoed = translate_length(&reply) / 2;
    for &(pos, _, _, _) in buffer_items(req).iter().skip(echoed) {
        if deficit < 2 {
            break;
        }
        reply.translate.push(Translate::Raw(vec![req.word(pos), req.word(pos + 1)]));
        deficit -= 2;
    }
    if deficit > 0 {
        reply.translate.push(Translate::Raw(vec![0; deficit as usize]));
    }
    reply
}

/// La réponse « 0 et des zéros » de la forme `shape` : les tampons que le client prête en écriture sont remis à zéro.
pub fn neutral_reply(k: &Kernel, req: &Request, shape: u32, zero_outputs: bool) -> Reply {
    if zero_outputs {
        for (_, kind, address, size) in buffer_items(req) {
            if (kind == 0xC || kind == 0xE) && size != 0 {
                let _ = k.memory.write(address, &vec![0u8; size.min(0x10000) as usize]);
            }
        }
    }
    fit_reply(Reply::new(0), req, shape)
}

/// Ajoute la note « première fois » à la première réponse de chaque commande.
pub fn first_time(seen: &mut BTreeSet<u32>, command: u32, reply: &mut Reply) {
    if seen.insert(command) {
        if !reply.note.is_empty() {
            reply.note.push_str(" ; ");
        }
        reply.note.push_str("première fois");
    }
}

/// `Shaped.fail` : un refus, avec la forme de la fiche (ajoutée par `Shaped`).
pub fn fail(code: u32, note: &str) -> Reply {
    Reply::new(code).with_note(if note.is_empty() { "refusé comme le ferait le module" } else { note })
}

/// `Shaped.after_ms` : un rappel dans `ms` millisecondes du banc.
pub fn after_ms(k: &mut Kernel, ms: u64, callback: impl FnOnce(&mut Kernel) + 'static) {
    let when = k.now + ms * NS_PER_MS;
    k.schedule(when, Box::new(callback));
}

/// `Shaped.block` : le fil client attend `ms` millisecondes du banc (un module qui travaille avant de répondre).
pub fn block(k: &mut Kernel, req: &Request, ms: u64, what: &str) {
    let mut wait = Wait::new(WaitKind::Sleep);
    wait.deadline = Some(k.now + ms * NS_PER_MS);
    wait.what = what.to_string();
    k.block(req.thread, wait);
}

fn le_words(data: &[u8]) -> Vec<u32> {
    data.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

/// Écrit dans un bloc partagé sans jamais sortir de ses limites.
fn shared_write(k: &Kernel, id: ObjId, offset: usize, data: &[u8]) {
    if let Obj::Shared(shared) = &k.objects[id].data {
        if offset + data.len() <= shared.size as usize {
            shared.write(offset, data);
        }
    }
}

fn shared_read(k: &Kernel, id: ObjId, offset: usize, size: usize) -> Vec<u8> {
    if let Obj::Shared(shared) = &k.objects[id].data {
        if offset + size <= shared.size as usize {
            return shared.read(offset, size);
        }
    }
    vec![0; size]
}

fn read_memory(k: &Kernel, address: u32, size: u32) -> Vec<u8> {
    k.memory.read(address, size).unwrap_or_default()
}

fn write_memory(k: &Kernel, address: u32, data: &[u8]) {
    let _ = k.memory.write(address, data);
}

fn clear_event(k: &mut Kernel, id: ObjId) {
    k.event_mut(id).signaled = false;
}

// --- Shaped ---

/// Un module dont chaque commande a la forme de la fiche. `command` fait ce que fait la commande ; `None` (commande qui
/// ne fait rien, ou absente de `commands` du Python) rend `neutral_reply`.
pub trait Module {
    /// Ce que vaut l'ensemble du service (« simplifié » sauf `ssl:C`).
    fn kind(&self) -> &'static str {
        "simplifié"
    }
    fn shapes(&self) -> Shapes;
    /// Avant tout (la réponse complète, sans « première fois » : le refus de `boss:U` sans session).
    fn before(&mut self, _k: &mut Kernel, _req: &Request) -> Option<Reply> {
        None
    }
    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply>;
    fn after_reply(&mut self, _k: &mut Kernel, _req: &Request, _reply: &Reply) {}
    fn on_session_closed(&mut self, _k: &mut Kernel, _session: ObjId) {}
}

/// `Shaped` : le service qui enveloppe un module. Son nom est aussi son identifiant dans la Carte.
pub struct Shaped<M: Module> {
    name: String,
    seen: BTreeSet<u32>,
    pub module: M,
}

impl<M: Module> Shaped<M> {
    pub fn new(name: &str, module: M) -> Shaped<M> {
        Shaped { name: name.to_string(), seen: BTreeSet::new(), module }
    }
}

impl<M: Module> Service for Shaped<M> {
    fn name(&self) -> &str {
        &self.name
    }

    fn kind(&self) -> &'static str {
        self.module.kind()
    }

    /// Le nom de la classe Python du module (pour la note de `GetServiceHandle`).
    fn class_name(&self) -> String {
        let full = std::any::type_name::<M>();
        full.rsplit("::").next().unwrap_or(full).to_string()
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        if let Some(reply) = self.module.before(k, req) {
            return reply;
        }
        let Some(shape) = lookup(self.module.shapes(), req.command) else {
            return error(ERR_UNKNOWN_COMMAND, "commande absente de la fiche");
        };
        let mut reply = match self.module.command(k, req) {
            None => neutral_reply(k, req, shape, true),
            Some(reply) => fit_reply(reply, req, shape),
        };
        first_time(&mut self.seen, req.command, &mut reply);
        reply
    }

    fn after_reply(&mut self, k: &mut Kernel, req: &Request, reply: &Reply) {
        self.module.after_reply(k, req, reply);
    }

    fn on_session_closed(&mut self, k: &mut Kernel, session: ObjId) {
        self.module.on_session_closed(k, session);
    }
}

// --- nwm::UDS ---

pub const UDS_STATE_NONE: u32 = 0;
pub const UDS_STATE_IDLE: u32 = 3;
pub const UDS_STATE_HOST: u32 = 6;
pub const UDS_STATE_CLIENT: u32 = 9;
pub const UDS_STATE_SPECTATOR: u32 = 10;
pub const ERR_UDS_NOT_ALLOWED: u32 = 0xC8A1_13EA; // commande hors de son état
pub const ERR_UDS_BAD_ARGUMENT: u32 = 0xE101_13FD;
pub const ERR_UDS_TOO_BIG: u32 = 0xE101_13E9;
pub const ERR_UDS_NO_BIND: u32 = 0xE101_13EA;
pub const ERR_UDS_NO_NODE: u32 = 0xC901_13FA;
pub const ERR_UDS_NO_ROOM: u32 = 0xC861_13F3;
pub const ERR_UDS_REFUSED: u32 = 0xC921_13FB; // connexion refusée côté client (partie 7 de la fiche)
pub const UDS_NETWORK_SIZE: usize = 0x108;
pub const UDS_NODE_INFO_SIZE: usize = 0x28;
pub const UDS_MAX_FRAME: u32 = 0x5C6;
pub const UDS_MAX_APP_DATA: u32 = 0xC8;
pub const UDS_SCAN_MS: u64 = 300; // « de l'ordre d'une fraction de seconde » (fiche nwm, partie 6)
/// Interprété : « nombre maximal de nœuds » dans la structure du réseau de 0x108 octets (disposition de libctru).
pub const UDS_NETWORK_MAX_NODES_OFFSET: usize = 0x1D;

/// `nwm::UDS`, la communication locale sans fil. Un seul objet global, comme le module (fiche nwm, parties 3 et 6).
///
/// Faits : l'état (3 après Initialize, 4 pendant la création, 6 hôte, 9 client, 10 spectateur), la liste des nœuds, le
/// NodeInfo reçu d'Initialize, l'événement d'Initialize (signalé à la création du réseau), les Bind et leurs
/// événements, un balayage qui dure UDS_SCAN_MS et ne trouve rien, tous les refus par `0xC8A113EA`. Pas fait : les
/// trames (aucune console voisine), donc PullPacket ne rend jamais de trame et SendTo n'envoie nulle part ;
/// ConnectNetwork refuse (aucun réseau à rejoindre).
pub struct Nwm {
    state: u32,
    event: Option<ObjId>,
    local_node: Vec<u8>,
    network: Vec<u8>,
    channel: u32,
    nodes: BTreeMap<u32, Vec<u8>>, // identifiant de nœud -> NodeInfo (0x28 octets)
    changed: u32,
    binds: BTreeMap<u32, (u32, ObjId)>, // identifiant de Bind -> (canal de données, événement)
    scans: u32,
}

impl Nwm {
    pub fn new() -> Nwm {
        let mut nwm = Nwm {
            state: 0,
            event: None,
            local_node: Vec::new(),
            network: Vec::new(),
            channel: 0,
            nodes: BTreeMap::new(),
            changed: 0,
            binds: BTreeMap::new(),
            scans: 0,
        };
        nwm.reset();
        nwm
    }

    fn reset(&mut self) {
        self.state = UDS_STATE_NONE;
        self.event = None;
        self.local_node = vec![0; UDS_NODE_INFO_SIZE];
        self.network = vec![0; UDS_NETWORK_SIZE];
        self.channel = 0;
        self.nodes = BTreeMap::new();
        self.changed = 0;
        self.binds = BTreeMap::new();
        self.scans = 0;
    }

    fn signal(&self, k: &mut Kernel) {
        if let Some(event) = self.event {
            k.signal_event(event);
        }
    }

    fn not_allowed(&self, wanted: u32) -> Reply {
        fail(ERR_UDS_NOT_ALLOWED, &format!("état {} au lieu de {}", self.state, wanted))
    }

    fn initialize(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let node: Vec<u8> = (2..12).flat_map(|i| req.word(i).to_le_bytes()).collect();
        self.reset();
        let event = k.create_event(RESET_ONESHOT, "nwm::UDS : événement d'Initialize");
        self.event = Some(event);
        self.local_node = node;
        self.state = UDS_STATE_IDLE;
        Some(Reply::new(0).copy_handles(&[event]).with_note(format!("état 3, {}", k.label(event))))
    }

    fn finalize(&mut self) -> Option<Reply> {
        self.reset();
        Some(Reply::new(0).with_note("état 0, événement fermé"))
    }

    fn create_network(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        if self.state != UDS_STATE_IDLE {
            return Some(self.not_allowed(3));
        }
        let statics = static_items(req);
        let mut network = match statics.first() {
            Some(first) => req.static_data(k, first.0),
            None => Vec::new(),
        };
        network.resize(UDS_NETWORK_SIZE, 0);
        self.network = network;
        self.channel = if self.network[6] != 0 { self.network[6] as u32 } else { 1 };
        self.nodes = BTreeMap::from([(1, self.local_node.clone())]);
        self.changed = 1;
        self.state = UDS_STATE_HOST;
        self.signal(k);
        Some(Reply::new(0).with_note(format!(
            "hôte : état 6, nœud 1, canal {}, {} nœuds au plus",
            self.channel, self.network[UDS_NETWORK_MAX_NODES_OFFSET]
        )))
    }

    fn destroy_network(&mut self) -> Option<Reply> {
        if self.state != UDS_STATE_HOST {
            return Some(self.not_allowed(6));
        }
        self.state = UDS_STATE_IDLE;
        self.nodes = BTreeMap::new();
        self.changed = 0;
        self.channel = 0;
        Some(Reply::new(0).with_note("état 3, événement non signalé"))
    }

    fn disconnect_network(&mut self) -> Option<Reply> {
        if self.state != UDS_STATE_NONE {
            self.state = UDS_STATE_IDLE;
            self.nodes = BTreeMap::new();
            self.changed = 0;
            self.channel = 0;
        }
        Some(Reply::new(0).with_note(format!("état {}", self.state)))
    }

    fn connect_network(&mut self) -> Option<Reply> {
        if self.state != UDS_STATE_IDLE {
            return Some(self.not_allowed(3));
        }
        Some(fail(ERR_UDS_REFUSED, "aucun réseau à rejoindre"))
    }

    fn host_only(&mut self) -> Option<Reply> {
        if self.state != UDS_STATE_HOST {
            return Some(self.not_allowed(6));
        }
        Some(Reply::new(0))
    }

    fn in_idle_state(&mut self, req: &Request) -> Option<Reply> {
        if self.state != UDS_STATE_IDLE {
            return Some(self.not_allowed(3));
        }
        let value = req.word(1) as u64;
        if req.command == 0x18 && !(0x400..=0xC400).contains(&(value * 1000 >> 10)) {
            return Some(fail(ERR_UDS_BAD_ARGUMENT, ""));
        }
        if req.command == 0x19 && value >= 0x20000 {
            return Some(fail(ERR_UDS_BAD_ARGUMENT, ""));
        }
        Some(Reply::new(0))
    }

    fn set_probe_response_param(&mut self) -> Option<Reply> {
        if self.state != UDS_STATE_IDLE {
            return Some(self.not_allowed(3));
        }
        Some(Reply::new(0))
    }

    fn get_connection_status(&mut self) -> Option<Reply> {
        let ids: Vec<u32> = self.nodes.keys().copied().take(16).collect();
        let mut present: u32 = 0;
        for node in &ids {
            present |= 1u32.wrapping_shl(node.wrapping_sub(1));
        }
        let local: u16 = if self.state == UDS_STATE_HOST { 1 } else { 0 };
        // '<IIHH16HBBH' : état, 0, nœud local, changements, 16 identifiants, nombre, maximum, présents
        let mut data: Vec<u8> = Vec::new();
        data.extend_from_slice(&self.state.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&local.to_le_bytes());
        data.extend_from_slice(&(self.changed as u16).to_le_bytes());
        for i in 0..16 {
            data.extend_from_slice(&(ids.get(i).copied().unwrap_or(0) as u16).to_le_bytes());
        }
        data.push(ids.len() as u8);
        data.push(if self.nodes.is_empty() { 0 } else { self.network[UDS_NETWORK_MAX_NODES_OFFSET] });
        data.extend_from_slice(&(present as u16).to_le_bytes());
        self.changed = 0;
        Some(Reply::with_words(0, &le_words(&data)).with_note(format!("état {}, {} nœud(s)", self.state, ids.len())))
    }

    fn get_node_information(&mut self, req: &Request) -> Option<Reply> {
        let id = req.word(1) & 0xFFFF;
        match self.nodes.get(&id) {
            None => Some(fail(ERR_UDS_NO_NODE, &format!("nœud {} absent", id))),
            Some(node) => Some(Reply::with_words(0, &le_words(node))),
        }
    }

    fn scan(&mut self, k: &mut Kernel, req: &Request, needed: &[u32]) -> Option<Reply> {
        if !needed.contains(&self.state) {
            return Some(fail(ERR_UDS_NOT_ALLOWED, &format!("état {}", self.state)));
        }
        let buffers: Vec<_> = buffer_items(req).into_iter().filter(|b| b.1 == 0xC || b.1 == 0xE).collect();
        let mut reply = Reply::new(0);
        if let Some(&(pos, _, address, size)) = buffers.first() {
            let mut data = Vec::new();
            for word in [size, 0xC, 0] {
                data.extend_from_slice(&word.to_le_bytes());
            }
            data.truncate(size as usize);
            write_memory(k, address, &data);
            reply = reply.raw(&[req.word(pos), req.word(pos + 1)]);
        }
        self.scans += 1;
        block(k, req, UDS_SCAN_MS, "nwm::UDS : balayage");
        Some(reply.with_note(format!("balayage {} : aucune balise, {} ms", self.scans, UDS_SCAN_MS)))
    }

    fn set_application_data(&mut self, req: &Request) -> Option<Reply> {
        if self.state != UDS_STATE_HOST {
            return Some(self.not_allowed(6));
        }
        if req.word(1) > UDS_MAX_APP_DATA {
            return Some(fail(ERR_UDS_TOO_BIG, ""));
        }
        Some(Reply::new(0))
    }

    fn get_application_data(&mut self) -> Option<Reply> {
        if ![UDS_STATE_HOST, UDS_STATE_CLIENT, UDS_STATE_SPECTATOR].contains(&self.state) {
            return Some(fail(ERR_UDS_NOT_ALLOWED, &format!("état {}", self.state)));
        }
        None
    }

    fn bind(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let (node_id, size, channel) = (req.word(1), req.word(2), req.word(3) & 0xFF);
        if channel == 0 || size == 0 {
            return Some(fail(ERR_UDS_NO_BIND, &format!("canal {}, tampon {:#x}", channel, size)));
        }
        if self.binds.len() >= 16 {
            return Some(fail(ERR_UDS_NO_ROOM, "16 Bind déjà"));
        }
        let bind_event = k.create_event(RESET_ONESHOT, &format!("nwm::UDS : Bind {:#x} canal {:#x}", node_id, channel));
        self.binds.insert(node_id, (channel, bind_event));
        Some(Reply::new(0).copy_handles(&[bind_event]).with_note(format!("canal {:#x}", channel)))
    }

    fn unbind(&mut self, req: &Request) -> Option<Reply> {
        self.binds.remove(&req.word(1));
        None
    }

    fn pull_packet(&mut self, req: &Request) -> Option<Reply> {
        if ![UDS_STATE_HOST, UDS_STATE_CLIENT, UDS_STATE_SPECTATOR].contains(&self.state) {
            return Some(fail(ERR_UDS_NOT_ALLOWED, &format!("état {}", self.state)));
        }
        if !self.binds.contains_key(&req.word(1)) {
            return Some(fail(ERR_UDS_NO_BIND, &format!("pas de Bind {:#x}", req.word(1))));
        }
        Some(Reply::with_words(0, &[0, 0]).static_buffer(0, &[]).with_note("aucune trame"))
    }

    fn send_to(&mut self, req: &Request) -> Option<Reply> {
        if ![UDS_STATE_HOST, UDS_STATE_CLIENT].contains(&self.state) {
            return Some(fail(ERR_UDS_NOT_ALLOWED, &format!("état {}", self.state)));
        }
        if req.word(3) > UDS_MAX_FRAME {
            return Some(fail(ERR_UDS_TOO_BIG, ""));
        }
        Some(Reply::new(0).with_note(format!("{} octets pour personne", req.word(3))))
    }
}

impl Module for Nwm {
    fn shapes(&self) -> Shapes {
        reply_shapes::NWM_UDS
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x01 | 0x1B => self.initialize(k, req),
            0x03 => self.finalize(),
            0x04 | 0x1D => self.create_network(k, req),
            0x05..=0x07 => self.host_only(),
            0x08 => self.destroy_network(),
            0x09 | 0x1E => self.connect_network(),
            0x0A => self.disconnect_network(),
            0x0B => self.get_connection_status(),
            0x0D => self.get_node_information(req),
            0x0F => self.scan(k, req, &[UDS_STATE_IDLE]),
            0x22 => self.scan(k, req, &[UDS_STATE_CLIENT, UDS_STATE_SPECTATOR]),
            0x10 => self.set_application_data(req),
            0x11 => self.get_application_data(),
            0x12 => self.bind(k, req),
            0x13 => self.unbind(req),
            0x14 => self.pull_packet(req),
            0x17 => self.send_to(req),
            0x1A => Some(Reply::with_words(0, &[self.channel])),
            0x21 => self.set_probe_response_param(),
            0x18 | 0x19 | 0x16 => self.in_idle_state(req),
            _ => None,
        }
    }
}

// --- boss:U, boss:M ---

pub const BOSS_ERR_NO_SESSION: u32 = 0xC8A0_F82B;
pub const BOSS_ERR_NO_PROGRAM: u32 = 0xC8A0_F832;
pub const BOSS_ERR_NO_TASK: u32 = 0xC8A0_F833;
pub const BOSS_ERR_BAD_INFO_TYPE: u32 = 0xC8A0_F83F;
pub const BOSS_ERR_NO_ENTRY: u32 = 0xC8A0_F842;
pub const BOSS_ERR_BAD_SIZE: u32 = 0xC960_F844;
pub const BOSS_ERR_OTHER: u32 = 0xC960_F84D;
pub const BOSS_ERR_BAD_TASK_PROPERTY: u32 = 0xD8E0_F802;
pub const BOSS_SESSION_FREE: u32 = 0x15; // SendPropertyHandle, la seule commande sans session
pub const BOSS_ERROR_CODE_ABSENT: u32 = 0xB3B1; // GetErrorCode : « 0xB3B1 si absent » de la table du module
/// (identifiant, décalage, taille maximale) des propriétés de SendProperty (fiche boss, partie 5).
pub const BOSS_PROPERTIES: &[(u32, u32, u32)] = &[
    (0x00, 0xC, 1), (0x01, 0xD, 1), (0x02, 0x10, 4), (0x03, 0x14, 4), (0x04, 0x18, 4), (0x05, 0xE, 1),
    (0x06, 0x1C, 1), (0x07, 0x234, 512), (0x08, 0x28, 4), (0x09, 0x20, 1), (0x0A, 0x34, 256), (0x0B, 0x34, 512),
    (0x0C, 0x30, 4), (0x0D, 0x434, 864), (0x0E, 0x7A0, 4), (0x0F, 0x794, 12), (0x10, 0x1E, 1), (0x11, 0x1D, 1),
    (0x12, 0x1F, 1), (0x13, 0x7A4, 4), (0x14, 0x7A8, 4), (0x15, 0x7B0, 64), (0x16, 0x24, 4), (0x18, 0, 1),
    (0x19, 1, 1), (0x1A, 2, 1), (0x1B, 4, 4), (0x1C, 8, 4), (0x3B, 0x2C, 4), (0x3E, 0x34, 512), (0x3F, 0x21, 1),
];
/// ReceiveProperty seulement : état de tâche, listes (décalages non repris).
pub const BOSS_OUTPUT_PROPERTIES: std::ops::Range<u32> = 0x1D..0x39;
pub const BOSS_NS_INFO_SIZES: &[(u32, u32)] = &[(0, 8), (1, 4), (2, 4), (3, 4), (4, 4), (5, 4), (6, 32)];
pub const BOSS_TASK_QUERY_SIZE: u32 = 0x60;

fn boss_property(id: u32) -> Option<(u32, u32)> {
    BOSS_PROPERTIES.iter().find(|p| p.0 == id).map(|p| (p.1, p.2))
}

/// `boss:U`, les téléchargements SpotPass. Une console sans tâche reçue : listes vides, aucun NsData.
///
/// Faits : rien ne répond sans InitializeSession (sauf SendPropertyHandle), le bloc de propriétés de chaque session
/// (SendProperty puis ReceiveProperty rend ce qui a été envoyé), le refus de RegisterTask quand la propriété 0x06 vaut
/// 6, 7, 8, 9 ou 0xD, la liste des tâches enregistrées, l'événement de GetTaskFinishHandle, le stockage
/// (RegisterStorageEntry). Interprété : les codes d'erreur de la taille d'une propriété, de SetTaskQuery et de
/// GetNsDataHeaderInfo sans NsData ; la table de GetErrorCode n'est pas reprise (0xB3B1).
pub struct Boss {
    sessions: BTreeMap<ObjId, BTreeMap<u32, Vec<u8>>>, // session -> propriétés
    tasks: BTreeSet<Vec<u8>>,
    storage: bool,
    finish_event: ObjId,
}

impl Boss {
    pub fn new(k: &mut Kernel) -> Boss {
        let finish_event = k.create_event(RESET_ONESHOT, "boss : fin de tâche");
        Boss { sessions: BTreeMap::new(), tasks: BTreeSet::new(), storage: false, finish_event }
    }

    pub fn has_session(&self, session: ObjId) -> bool {
        self.sessions.contains_key(&session)
    }

    fn initialize_session(&mut self, req: &Request) -> Option<Reply> {
        self.sessions.entry(req.session).or_default();
        let pids = req.pids();
        Some(Reply::new(0).with_note(format!("session ouverte, processus {:#x}", pids.first().copied().unwrap_or(0))))
    }

    fn send_property(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let Some((_, max)) = boss_property(req.word(1)) else {
            return Some(fail(BOSS_ERR_OTHER, &format!("propriété {:#x} inconnue", req.word(1))));
        };
        let buffers = buffer_items(req);
        let mut data = Vec::new();
        if let Some(first) = buffers.first() {
            data = read_memory(k, first.2, first.3.min(req.word(2)).min(max));
        }
        let length = data.len();
        self.sessions.entry(req.session).or_default().insert(req.word(1), data);
        Some(
            Reply::new(0)
                .raw(&[req.word(3), req.word(4)])
                .with_note(format!("propriété {:#x} : {} octets", req.word(1), length)),
        )
    }

    fn send_property_handle(&mut self, req: &Request) -> Option<Reply> {
        if req.word(1) != 0x0C {
            return Some(fail(BOSS_ERR_OTHER, "seule la propriété 0x0C prend une poignée"));
        }
        Some(Reply::new(0))
    }

    fn receive_property(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let prop = req.word(1);
        if boss_property(prop).is_none() && !BOSS_OUTPUT_PROPERTIES.contains(&prop) {
            return Some(fail(BOSS_ERR_OTHER, &format!("propriété {:#x} inconnue", prop)));
        }
        let buffers = buffer_items(req);
        let mut reply = Reply::with_words(0, &[0]);
        if let Some(&(pos, _, address, size)) = buffers.first() {
            let mut data = self.sessions.entry(req.session).or_default().get(&prop).cloned().unwrap_or_default();
            data.truncate(size as usize);
            data.resize(size as usize, 0);
            write_memory(k, address, &data);
            reply.words = vec![size];
            reply = reply.raw(&[req.word(pos), req.word(pos + 1)]);
        }
        Some(reply)
    }

    fn task_key(&self, k: &Kernel, req: &Request) -> Vec<u8> {
        match buffer_items(req).into_iter().find(|b| b.1 == 0xA || b.1 == 0xE) {
            Some(b) => read_memory(k, b.2, b.3.min(8)),
            None => Vec::new(),
        }
    }

    fn register_task(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let value = self.sessions.entry(req.session).or_default().get(&6).and_then(|v| v.first()).copied();
        if let Some(value) = value {
            if [6, 7, 8, 9, 0xD].contains(&value) {
                return Some(fail(BOSS_ERR_BAD_TASK_PROPERTY, &format!("propriété 0x06 = {}", value)));
            }
        }
        let key = self.task_key(k, req);
        self.tasks.insert(key);
        None
    }

    fn unregister_task(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let key = self.task_key(k, req);
        if !self.tasks.remove(&key) {
            return Some(fail(BOSS_ERR_NO_TASK, "tâche inconnue"));
        }
        None
    }

    fn get_ns_data_header_info(&mut self, req: &Request) -> Option<Reply> {
        let (kind, size) = (req.word(2), req.word(3));
        let Some(&(_, wanted)) = BOSS_NS_INFO_SIZES.iter().find(|e| e.0 == kind) else {
            return Some(fail(BOSS_ERR_BAD_INFO_TYPE, &format!("type {}", kind)));
        };
        if size != wanted {
            return Some(fail(BOSS_ERR_BAD_SIZE, &format!("taille {} pour le type {}", size, kind)));
        }
        Some(fail(BOSS_ERR_NO_PROGRAM, "aucun NsData"))
    }
}

impl Module for Boss {
    fn shapes(&self) -> Shapes {
        reply_shapes::BOSS_U
    }

    fn before(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let shape = lookup(self.shapes(), req.command)?;
        if req.command != 0x01 && req.command != BOSS_SESSION_FREE && !self.sessions.contains_key(&req.session) {
            let _ = k;
            return Some(fit_reply(fail(BOSS_ERR_NO_SESSION, "InitializeSession pas faite"), req, shape));
        }
        None
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x01 => self.initialize_session(req),
            0x03 => {
                if !self.storage {
                    return Some(fail(BOSS_ERR_NO_ENTRY, "stockage jamais enregistré"));
                }
                self.storage = false;
                None
            }
            0x0B | 0x35 => self.register_task(k, req),
            0x0C => self.unregister_task(k, req),
            0x14 => self.send_property(k, req),
            0x15 => self.send_property_handle(req),
            0x16 => self.receive_property(k, req),
            0x1F => Some(Reply::new(0).copy_handles(&[self.finish_event])),
            0x27 => self.get_ns_data_header_info(req),
            0x2E => Some(Reply::with_words(0, &[BOSS_ERROR_CODE_ABSENT])),
            0x2F => {
                self.storage = true;
                None
            }
            0x30 => {
                if !self.storage {
                    return Some(fail(BOSS_ERR_NO_ENTRY, "stockage jamais enregistré"));
                }
                None
            }
            0x36 => {
                if req.word(2) != BOSS_TASK_QUERY_SIZE {
                    return Some(fail(BOSS_ERR_OTHER, &format!("requête de {:#x} octets au lieu de 0x60", req.word(2))));
                }
                None
            }
            _ => None,
        }
    }

    fn on_session_closed(&mut self, _k: &mut Kernel, session: ObjId) {
        self.sessions.remove(&session);
    }
}

/// `boss:M` (appelé par `ndm`) : la commande 3 ne compare que son numéro (fiche boss, « Écarts avec la Carte »).
pub struct BossManagement;

impl Module for BossManagement {
    fn shapes(&self) -> Shapes {
        reply_shapes::BOSS_M
    }

    fn command(&mut self, _k: &mut Kernel, _req: &Request) -> Option<Reply> {
        None
    }
}

// --- ssl:C ---

/// `ssl:C`. Trois commandes (Initialize, SeedRNG, GenerateRandomData), le reste est « commande inconnue » (fiche ssl,
/// partie 6). Les octets aléatoires sont vrais ; avec une graine ils se répètent d'une exécution à l'autre.
pub struct Ssl {
    state: u64,
    pub generated: u64,
}

impl Ssl {
    /// `seed` : `options['seed']` du banc ; sans graine, les octets viennent de l'horloge de l'ordinateur.
    pub fn new(seed: Option<u64>) -> Ssl {
        let seed = seed.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0x9E37_79B9_7F4A_7C15)
        });
        Ssl { state: seed, generated: 0 }
    }

    fn next(&mut self) -> u64 {
        // splitmix64
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn random_bytes(&mut self, count: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(count);
        while out.len() < count {
            out.extend_from_slice(&self.next().to_le_bytes());
        }
        out.truncate(count);
        out
    }

    fn generate_random_data(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let buffers: Vec<_> = buffer_items(req).into_iter().filter(|b| b.1 == 0xC || b.1 == 0xE).collect();
        let Some(&(pos, _, address, size)) = buffers.first() else {
            return Some(fail(0xE0E0_B7F6, "pas de tampon de sortie"));
        };
        let count = req.word(1).min(size);
        let data = self.random_bytes(count as usize);
        write_memory(k, address, &data);
        self.generated += count as u64;
        Some(Reply::new(0).raw(&[req.word(pos), req.word(pos + 1)]).with_note(format!("{} octets aléatoires", count)))
    }
}

impl Module for Ssl {
    fn kind(&self) -> &'static str {
        "réel"
    }

    fn shapes(&self) -> Shapes {
        reply_shapes::SSL_C_USED
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x11 => self.generate_random_data(k, req),
            _ => None,
        }
    }
}

// --- cecd:u ---

pub const ERR_CEC_BLOCKED: u32 = 0xC8A1_0BF0;
pub const ERR_FILE_NOT_FOUND: u32 = 0xC880_4470;
pub const CEC_CREATE: u32 = 4;
pub const CEC_DIRECTORY_TYPES: [u32; 4] = [10, 11, 12, 13];

fn cec_path_names(path_type: u32) -> Option<&'static [&'static str]> {
    Some(match path_type {
        1 => &["MBoxList____"],
        2 => &["{box}", "MBoxInfo____"],
        3 => &["{box}", "InBox___", "BoxInfo_____"],
        4 => &["{box}", "OutBox__", "BoxInfo_____"],
        5 => &["{box}", "OutBox__", "OBIndex_____"],
        6 => &["{box}", "InBox___", "_{message}"],
        7 => &["{box}", "OutBox__", "_{message}"],
        10 => &[],
        11 => &["{box}"],
        12 => &["{box}", "InBox___"],
        13 => &["{box}", "OutBox__"],
        _ => return None,
    })
}

fn hex_lower(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

/// `cecd:u`, StreetPass. La réception reste factice (aucune boîte ne se remplit, l'état est « inactif », les événements
/// ne sont jamais signalés) ; le système de fichiers est vrai (fiche cecd, partie 6) : les fichiers de `data:/CEC/`
/// sont écrits dans `<sortie>/archives/cec/`, dans un dossier par identifiant de boîte, et relus.
///
/// Interprété : la place des mots de chaque requête (d'après les en-têtes de la fiche et l'organisation de CECD chez
/// 3dbrew et Citra), le nom du fichier d'un message (son identifiant en hexadécimal).
pub struct Cecd {
    root: PathBuf,
    opened: BTreeMap<ObjId, (PathBuf, u64)>, // session -> (chemin, position)
    events: BTreeMap<u32, ObjId>,
    next_message: u64,
}

impl Cecd {
    pub fn new(k: &Kernel) -> Cecd {
        Cecd { root: k.bench.paths.archives.join("cec"), opened: BTreeMap::new(), events: BTreeMap::new(), next_message: 1 }
    }

    fn path(&self, box_id: u32, path_type: u32, message: &[u8]) -> Option<PathBuf> {
        let names: Vec<String> = if path_type >= 100 {
            vec!["{box}".to_string(), format!("MBoxData.{:03}", path_type - 100)]
        } else {
            cec_path_names(path_type)?.iter().map(|s| s.to_string()).collect()
        };
        let mut path = self.root.clone();
        for name in names {
            let name = name.replace("{box}", &format!("{:08x}", box_id)).replace("{message}", &hex_lower(message).to_uppercase());
            path = path.join(name);
        }
        Some(path)
    }

    fn relative(&self, path: &Path) -> String {
        let rel = path.strip_prefix(&self.root).map(|p| p.display().to_string()).unwrap_or_else(|_| path.display().to_string());
        if rel.is_empty() { ".".to_string() } else { rel }
    }

    fn read_buffer(&self, k: &Kernel, req: &Request, index: usize) -> Vec<u8> {
        let reads: Vec<_> = buffer_items(req).into_iter().filter(|b| b.1 == 0xA || b.1 == 0xE).collect();
        match reads.get(index) {
            Some(b) => read_memory(k, b.2, b.3),
            None => Vec::new(),
        }
    }

    fn write_buffer(&self, req: &Request) -> Option<(usize, u32, u32, u32)> {
        buffer_items(req).into_iter().filter(|b| b.1 == 0xC || b.1 == 0xE).last()
    }

    fn echo(&self, req: &Request, mut reply: Reply) -> Reply {
        for (pos, _, _, _) in buffer_items(req) {
            reply = reply.raw(&[req.word(pos), req.word(pos + 1)]);
        }
        reply
    }

    fn open_raw_file(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let (box_id, path_type, mode) = (req.word(1), req.word(2), req.word(3));
        let message = if req.items.contains_key(&4) { req.static_data(k, 4) } else { Vec::new() };
        let Some(path) = self.path(box_id, path_type, &message) else {
            return Some(fail(ERR_CEC_BLOCKED, &format!("type de chemin {} inconnu", path_type)));
        };
        if CEC_DIRECTORY_TYPES.contains(&path_type) {
            if mode & CEC_CREATE != 0 {
                let _ = fs::create_dir_all(&path);
            } else if !path.is_dir() {
                return Some(fail(ERR_FILE_NOT_FOUND, "dossier absent"));
            }
            let base = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            self.opened.insert(req.session, (path, 0));
            return Some(Reply::with_words(0, &[0]).with_note(format!("dossier {}", base)));
        }
        if !path.is_file() {
            if mode & CEC_CREATE == 0 {
                return Some(fail(ERR_FILE_NOT_FOUND, "fichier absent"));
            }
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::File::create(&path);
        }
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let note = format!("ouvert : {}", self.relative(&path));
        self.opened.insert(req.session, (path, 0));
        Some(Reply::with_words(0, &[size as u32]).with_note(note))
    }

    fn read_raw_file(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let out = self.write_buffer(req);
        let entry = self.opened.get_mut(&req.session);
        let (Some(entry), Some(out)) = (entry, out) else {
            return Some(fail(ERR_FILE_NOT_FOUND, "aucun fichier ouvert"));
        };
        if !entry.0.is_file() {
            return Some(fail(ERR_FILE_NOT_FOUND, "aucun fichier ouvert"));
        }
        let wanted = req.word(1).min(out.3) as u64;
        let mut data = Vec::new();
        if let Ok(mut file) = fs::File::open(&entry.0) {
            let _ = file.seek(SeekFrom::Start(entry.1));
            let _ = file.take(wanted).read_to_end(&mut data);
        }
        entry.1 += data.len() as u64;
        write_memory(k, out.2, &data);
        let length = data.len() as u32;
        Some(self.echo(req, Reply::with_words(0, &[length])))
    }

    fn write_raw_file(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let mut data = self.read_buffer(k, req, 0);
        data.truncate(req.word(1) as usize);
        let Some(entry) = self.opened.get_mut(&req.session) else {
            return Some(fail(ERR_FILE_NOT_FOUND, "aucun fichier ouvert"));
        };
        if entry.0.is_dir() {
            return Some(fail(ERR_FILE_NOT_FOUND, "aucun fichier ouvert"));
        }
        match fs::OpenOptions::new().read(true).write(true).open(&entry.0) {
            Ok(mut file) => {
                let _ = file.seek(SeekFrom::Start(entry.1));
                let _ = file.write_all(&data);
            }
            Err(_) => return Some(fail(ERR_FILE_NOT_FOUND, "aucun fichier ouvert")),
        }
        entry.1 += data.len() as u64;
        Some(self.echo(req, Reply::new(0)).with_note(format!("{} octets écrits", data.len())))
    }

    fn message_path(&self, req: &Request, message: &[u8]) -> Option<PathBuf> {
        self.path(req.word(1), if req.word(2) != 0 { 7 } else { 6 }, message)
    }

    fn read_message(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let mut message = self.read_buffer(k, req, 0);
        message.truncate(if req.word(3) != 0 { req.word(3) } else { 8 } as usize);
        let out = self.write_buffer(req);
        let path = self.message_path(req, &message);
        let (Some(out), Some(path)) = (out, path) else {
            return Some(fail(ERR_FILE_NOT_FOUND, &format!("message {} absent", hex_lower(&message))));
        };
        if !path.is_file() {
            return Some(fail(ERR_FILE_NOT_FOUND, &format!("message {} absent", hex_lower(&message))));
        }
        let mut data = fs::read(&path).unwrap_or_default();
        data.truncate(req.word(4).min(out.3) as usize);
        write_memory(k, out.2, &data);
        let note = format!("message {} : {} octets", hex_lower(&message), data.len());
        Some(self.echo(req, Reply::with_words(0, &[data.len() as u32])).with_note(note))
    }

    fn write_message(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let reads = buffer_items(req);
        let mut data = self.read_buffer(k, req, 0);
        data.truncate(req.word(4) as usize);
        let mut message = self.read_buffer(k, req, 1);
        message.truncate(if req.word(3) != 0 { req.word(3) } else { 8 } as usize);
        if message.iter().all(|&b| b == 0) {
            message = self.next_message.to_be_bytes().to_vec();
            self.next_message += 1;
            if let Some(id_buffer) = reads.get(1) {
                if id_buffer.1 == 0xC || id_buffer.1 == 0xE {
                    write_memory(k, id_buffer.2, &message[..message.len().min(id_buffer.3 as usize)]);
                }
            }
        }
        let path = self.message_path(req, &message)?;
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, &data);
        let note = format!("message {} : {} octets", hex_lower(&message), data.len());
        Some(self.echo(req, Reply::new(0)).with_note(note))
    }

    fn delete(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let mut message = self.read_buffer(k, req, 0);
        message.truncate(if req.word(4) != 0 { req.word(4) } else { 8 } as usize);
        let path = self.path(req.word(1), req.word(2), &message);
        let Some(path) = path.filter(|p| p.exists()) else {
            return Some(fail(ERR_FILE_NOT_FOUND, "rien à effacer"));
        };
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        } else {
            let _ = fs::remove_file(&path);
        }
        Some(self.echo(req, Reply::new(0)))
    }

    fn open_and_write(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let Some(path) = self.path(req.word(2), req.word(3), &[]) else {
            return Some(fail(ERR_CEC_BLOCKED, &format!("type de chemin {} inconnu", req.word(3))));
        };
        let mut data = self.read_buffer(k, req, 0);
        data.truncate(req.word(1) as usize);
        let is_directory = CEC_DIRECTORY_TYPES.contains(&req.word(3));
        let folder = if is_directory { Some(path.clone()) } else { path.parent().map(|p| p.to_path_buf()) };
        if let Some(folder) = folder {
            let _ = fs::create_dir_all(folder);
        }
        if !is_directory {
            let _ = fs::write(&path, &data);
        }
        let note = format!("{} octets dans {}", data.len(), self.relative(&path));
        Some(self.echo(req, Reply::new(0)).with_note(note))
    }

    fn open_and_read(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let path = self.path(req.word(2), req.word(3), &[]);
        let out = self.write_buffer(req);
        let (Some(path), Some(out)) = (path, out) else {
            return Some(fail(ERR_FILE_NOT_FOUND, "fichier absent"));
        };
        if !path.is_file() {
            return Some(fail(ERR_FILE_NOT_FOUND, "fichier absent"));
        }
        let mut data = fs::read(&path).unwrap_or_default();
        data.truncate(req.word(1).min(out.3) as usize);
        write_memory(k, out.2, &data);
        let note = format!("{} octets de {}", data.len(), self.relative(&path));
        Some(self.echo(req, Reply::with_words(0, &[data.len() as u32])).with_note(note))
    }

    fn get_event(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        // Comme le Python (`setdefault(clé, event(...))`), l'événement est créé à chaque appel, même s'il existe déjà.
        let fresh = k.create_event(RESET_ONESHOT, &format!("cecd : événement {:#x}", req.command));
        let event = *self.events.entry(req.command).or_insert(fresh);
        Some(Reply::new(0).copy_handles(&[event]))
    }
}

impl Module for Cecd {
    fn shapes(&self) -> Shapes {
        reply_shapes::CECD_U
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x01 => self.open_raw_file(k, req),
            0x02 => self.read_raw_file(k, req),
            0x03 | 0x04 => self.read_message(k, req),
            0x05 => self.write_raw_file(k, req),
            0x06 | 0x07 => self.write_message(k, req),
            0x08 => self.delete(k, req),
            0x0E => Some(Reply::with_words(0, &[1]).with_note("inactif")),
            0x0F | 0x10 => self.get_event(k, req),
            0x11 => self.open_and_write(k, req),
            0x12 => self.open_and_read(k, req),
            _ => None,
        }
    }
}

// --- cam:u ---

pub const CAM_ERR_BAD_SIZE: u32 = 0xE0E0_53FD;
pub const CAM_ERR_BAD_PORT: u32 = 0xE0E0_53ED;
pub const CAM_TRANSFER_MAX: u64 = 0x1400;

/// `cam:u`. Pas de capteur : les réglages sont acceptés, les poignées d'événement sont vraies (celles de synchro
/// verticale et d'erreur ne sont jamais signalées ; celle de SetReceiving l'est 33 ms plus tard, sans image écrite),
/// GetMaxLines et GetMaxBytes suivent les formules du module (fiche camera, partie « cam:u »).
pub struct Camera {
    events: BTreeMap<(u32, u32), ObjId>,
    transfer_bytes: BTreeMap<u32, u32>,
    activated: u32,
    sleeping: u32,
}

impl Camera {
    pub fn new() -> Camera {
        Camera { events: BTreeMap::new(), transfer_bytes: BTreeMap::from([(1, 0), (2, 0)]), activated: 0, sleeping: 0 }
    }

    fn port_event(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let port = req.word(1) & 0xFF;
        if port != 1 && port != 2 {
            return Some(fail(CAM_ERR_BAD_PORT, &format!("port {}", port)));
        }
        // Comme le Python : l'événement est créé à chaque appel, même s'il existe déjà.
        let fresh = k.create_event(RESET_ONESHOT, &format!("cam : événement {:#x} du port {}", req.command, port));
        let event = *self.events.entry((req.command, port)).or_insert(fresh);
        Some(Reply::new(0).copy_handles(&[event]))
    }

    fn set_receiving(&mut self, k: &mut Kernel) -> Option<Reply> {
        let event = k.create_event(RESET_ONESHOT, "cam : image reçue");
        after_ms(k, 33, move |k| k.signal_event(event));
        Some(Reply::new(0).copy_handles(&[event]).with_note("événement signalé dans 33 ms, aucune image écrite"))
    }

    fn sizes_ok(width: u32, height: u32) -> bool {
        width > 0 && height > 0 && width as u64 * height as u64 % 128 == 0
    }

    fn get_max_lines(&mut self, req: &Request) -> Option<Reply> {
        let (width, height) = ((req.word(1) & 0xFFFF) as u64, (req.word(2) & 0xFFFF) as u64);
        if !Self::sizes_ok(width as u32, height as u32) {
            return Some(fail(CAM_ERR_BAD_SIZE, ""));
        }
        let mut best = 0;
        for lines in 1..=height {
            if height % lines == 0 && lines * width % 128 == 0 && lines * width * 2 <= CAM_TRANSFER_MAX {
                best = lines;
            }
        }
        Some(Reply::with_words(0, &[best as u32]))
    }

    fn get_max_bytes(&mut self, req: &Request) -> Option<Reply> {
        let (width, height) = ((req.word(1) & 0xFFFF) as u64, (req.word(2) & 0xFFFF) as u64);
        if !Self::sizes_ok(width as u32, height as u32) {
            return Some(fail(CAM_ERR_BAD_SIZE, ""));
        }
        let mut best = 0;
        let mut size = 0x100;
        while size <= CAM_TRANSFER_MAX {
            if 2 * width * height % size == 0 {
                best = size;
            }
            size += 0x100;
        }
        Some(Reply::with_words(0, &[best as u32]))
    }
}

impl Module for Camera {
    fn shapes(&self) -> Shapes {
        reply_shapes::CAM_U
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x05 | 0x06 => self.port_event(k, req),
            0x07 => self.set_receiving(k),
            0x0A => self.get_max_lines(req),
            0x0C => Some(Reply::with_words(0, &[self.transfer_bytes.get(&(req.word(1) & 0xFF)).copied().unwrap_or(0)])),
            0x0B => {
                self.transfer_bytes.insert(req.word(2) & 0xFF, req.word(1) & 0xFFFF);
                None
            }
            0x0D => self.get_max_bytes(req),
            0x13 => {
                self.activated = req.word(1) & 7;
                None
            }
            0x36 => Some(Reply::with_words(0, &[1])),
            0x3B => Some(Reply::with_words(0, &[self.activated])),
            0x3C => Some(Reply::with_words(0, &[self.sleeping])),
            0x3D => {
                self.sleeping = req.word(1) & 7;
                None
            }
            _ => None,
        }
    }
}

// --- mic:u ---

pub const MIC_PAGE_UNIT: u32 = 0x1000;
pub const MIC_TICK_MS: u64 = 10;
pub const MIC_DEFAULT_GAIN: u32 = 0x40; // arbitraire : le jeu ne fait que le garder pour le rétablir

pub fn mic_rate(rate: u32) -> f64 {
    match rate {
        0 => 32728.5,
        1 => 16364.0,
        2 => 10909.0,
        _ => 8182.0,
    }
}

struct MicState {
    page: Option<ObjId>,
    page_size: u32,
    sampling: bool,
    event: ObjId,
    run: u64, // numéro de la prise de son en cours (annule les tranches d'une ancienne)
    written: u64,
}

/// `mic:u`. Le micro entend le silence : la page partagée est remplie d'échantillons à zéro, au rythme choisi, et le mot
/// de fin (dernier mot de la page) avance à chaque tranche de 10 ms du banc. Interprété : le gain de départ (le jeu ne
/// le lit que pour le rétablir).
pub struct Mic {
    state: Rc<RefCell<MicState>>,
    gain: u32,
    power: u32,
    clamp: u32,
}

#[allow(clippy::too_many_arguments)]
fn mic_tick(state: Rc<RefCell<MicState>>, k: &mut Kernel, run: u64, offset: u64, size: u64, looping: bool, rate: f64, mut carry: f64) {
    let (page, page_size) = {
        let s = state.borrow();
        if run != s.run || !s.sampling || s.page.is_none() {
            return;
        }
        (s.page.unwrap(), s.page_size)
    };
    carry += rate * MIC_TICK_MS as f64 / 1000.0;
    let count = carry as u64;
    carry -= count as f64;
    let mut wanted = count as i64 * 2;
    let written = state.borrow().written;
    if !looping && written as i64 + wanted > size as i64 {
        wanted = size as i64 - written as i64;
    }
    let mut position = written;
    while wanted > 0 && size > 0 {
        let chunk = (wanted as u64).min(size - position % size);
        shared_write(k, page, (offset + position % size) as usize, &vec![0u8; chunk as usize]);
        position += chunk;
        wanted -= chunk as i64;
    }
    state.borrow_mut().written = position;
    if position != 0 {
        let last = offset + (position - 2) % size.max(1);
        shared_write(k, page, page_size as usize - 4, &(last as u32).to_le_bytes());
    }
    if !looping && position >= size {
        let event = {
            let mut s = state.borrow_mut();
            s.sampling = false;
            s.event
        };
        k.signal_event(event);
        return;
    }
    after_ms(k, MIC_TICK_MS, move |k| mic_tick(state, k, run, offset, size, looping, rate, carry));
}

impl Mic {
    pub fn new(k: &mut Kernel) -> Mic {
        let event = k.create_event(RESET_STICKY, "mic : tampon plein");
        let state = MicState { page: None, page_size: 0, sampling: false, event, run: 0, written: 0 };
        Mic { state: Rc::new(RefCell::new(state)), gain: MIC_DEFAULT_GAIN, power: 0, clamp: 1 }
    }

    fn map_shared_mem(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let size = req.word(1);
        if self.state.borrow().page.is_some() {
            return Some(fail(0xD820_8FF9, "déjà projeté"));
        }
        if size == 0 {
            return Some(fail(0xE0E0_8FEC, ""));
        }
        if size & 1 != 0 {
            return Some(fail(0xE0E0_8FF2, ""));
        }
        if size % MIC_PAGE_UNIT != 0 {
            return Some(fail(0xE0E0_1BF2, ""));
        }
        let objects = shared_objects(k, req);
        let Some(&page) = objects.first() else {
            return Some(fail(0xD8E0_07F7, "pas de bloc partagé"));
        };
        {
            let mut s = self.state.borrow_mut();
            s.page = Some(page);
            s.page_size = size;
        }
        shared_write(k, page, size as usize - 4, &[0; 4]);
        Some(Reply::new(0).with_note(format!("page de {:#x} octets", size)))
    }

    fn start_sampling(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let (page_size, has_page) = {
            let s = self.state.borrow();
            (s.page_size, s.page.is_some())
        };
        if !has_page {
            return Some(fail(0xD820_8FF8, "pas projeté"));
        }
        let encoding = req.word(1) & 0xFF;
        let rate = req.word(2) & 0xFF;
        let (offset, size, looping) = (req.word(3) as u64, req.word(4) as u64, req.word(5) & 0xFF != 0);
        if offset + size > page_size as u64 - 4 {
            return Some(fail(0xE100_8FFD, &format!("décalage {:#x} + taille {:#x}", offset, size)));
        }
        let run = {
            let mut s = self.state.borrow_mut();
            s.sampling = true;
            s.run += 1;
            s.written = 0;
            s.run
        };
        let event = self.state.borrow().event;
        clear_event(k, event);
        let hertz = mic_rate(rate);
        let state = self.state.clone();
        after_ms(k, MIC_TICK_MS, move |k| mic_tick(state, k, run, offset, size, looping, hertz, 0.0));
        Some(Reply::new(0).with_note(format!(
            "codage {}, {:.0} Hz, anneau {:#x}+{:#x}",
            encoding,
            hertz.round_ties_even(),
            offset,
            size
        )))
    }
}

impl Module for Mic {
    fn shapes(&self) -> Shapes {
        reply_shapes::MIC_U
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x01 => self.map_shared_mem(k, req),
            0x02 => {
                if self.state.borrow().page.is_none() {
                    return Some(fail(0xD820_8FF8, "pas projeté"));
                }
                self.state.borrow_mut().page = None;
                None
            }
            0x03 => self.start_sampling(k, req),
            0x05 => {
                self.state.borrow_mut().sampling = false;
                None
            }
            0x06 => Some(Reply::with_words(0, &[self.state.borrow().sampling as u32])),
            0x07 => Some(Reply::new(0).copy_handles(&[self.state.borrow().event])),
            0x08 => {
                self.gain = req.word(1) & 0xFF;
                None
            }
            0x09 => Some(Reply::with_words(0, &[self.gain])),
            0x0A => {
                self.power = req.word(1) & 0xFF;
                None
            }
            0x0B => Some(Reply::with_words(0, &[self.power])),
            0x0D => {
                self.clamp = req.word(1) & 0xFF;
                None
            }
            0x0E => Some(Reply::with_words(0, &[self.clamp])),
            _ => None,
        }
    }
}

// --- ir:USER ---

pub const IR_ERR_NOT_NOW: u32 = 0xC8A1_0C0D; // tolérée par le jeu
pub const IR_ERR_BUSY: u32 = 0xC8A1_0C0C;
pub const IR_ERR_NOT_INITIALIZED: u32 = 0xD821_0FF8;
pub const IR_LINK_OFFSET: usize = 8;
pub const IR_RING_HEADER: u32 = 0x10;

const IR_EVENT_NAMES: [&str; 3] = ["réception", "envoi", "état de la liaison"];

/// `ir:USER`, sans partenaire infrarouge (fiche ir, parties 5 et 9). La page partagée est vraie : en-tête (liaison 0,
/// octet +0xE à 1), deux anneaux vides ; AutoConnection laisse la liaison à 1, Disconnect la remet à 0 en levant
/// l'événement d'état ; rien n'arrive jamais ; les envois répondent `0xC8A10C0D` (liaison pas à 2).
pub struct IrUser {
    page: Option<ObjId>,
    link: u32,
    events: BTreeMap<&'static str, ObjId>,
    /// taille de la page, de l'anneau de réception, ses cases, idem pour l'envoi
    sizes: [u32; 5],
}

impl IrUser {
    pub fn new() -> IrUser {
        IrUser { page: None, link: 0, events: BTreeMap::new(), sizes: [0; 5] }
    }

    fn set_link(&mut self, k: &Kernel, value: u32) {
        self.link = value;
        if let Some(page) = self.page {
            shared_write(k, page, IR_LINK_OFFSET, &[value as u8]);
        }
    }

    fn initialize_shared(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let objects = shared_objects(k, req);
        let Some(&page) = objects.first() else {
            return Some(fail(0xD8E0_07F7, "pas de page partagée"));
        };
        self.page = Some(page);
        for i in 0..5 {
            self.sizes[i] = req.word(i + 1);
        }
        let [size, recv, recv_slots, send, send_slots] = self.sizes;
        shared_write(k, page, 0, &[0; 0x40]);
        shared_write(k, page, 0xE, &[1]);
        self.events = BTreeMap::new();
        for name in IR_EVENT_NAMES {
            let event = k.create_event(RESET_ONESHOT, &format!("ir : {}", name));
            self.events.insert(name, event);
        }
        self.set_link(k, 0);
        Some(Reply::new(0).with_note(format!(
            "page {:#x}, réception {}/{}, envoi {}/{}",
            size, recv, recv_slots, send, send_slots
        )))
    }

    fn need_connected(&self) -> Option<Reply> {
        if self.link == 2 {
            None
        } else {
            Some(fail(IR_ERR_NOT_NOW, &format!("liaison {}", self.link)))
        }
    }

    fn start_connecting(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        if self.link == 1 || self.link == 2 {
            return Some(fail(IR_ERR_BUSY, &format!("liaison {}", self.link)));
        }
        self.set_link(k, 1);
        if let Some(page) = self.page {
            shared_write(k, page, 0xC, &[(req.word(1) & 0xFF) as u8]);
        }
        Some(Reply::new(0).with_note("liaison à 1 : on cherche un partenaire"))
    }

    fn disconnect(&mut self, k: &mut Kernel) -> Option<Reply> {
        if self.link != 1 && self.link != 2 {
            return Some(fail(IR_ERR_NOT_NOW, &format!("liaison {}", self.link)));
        }
        self.set_link(k, 0);
        if let Some(&event) = self.events.get("état de la liaison") {
            k.signal_event(event);
        }
        Some(Reply::new(0).with_note("liaison à 0"))
    }

    fn get_event(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let name = match req.command {
            0x0A => "réception",
            0x0B => "envoi",
            _ => "état de la liaison",
        };
        let event = match self.events.get(name) {
            Some(&event) => event,
            None => {
                let event = k.create_event(RESET_ONESHOT, &format!("ir : {}", name));
                self.events.insert(name, event);
                event
            }
        };
        Some(Reply::new(0).copy_handles(&[event]))
    }

    fn latest_error(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let offset = if req.command == 0x11 { 0 } else { 4 };
        let mut value = 0;
        if let Some(page) = self.page {
            let bytes = shared_read(k, page, offset, 4);
            value = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            if req.word(1) != 0 {
                shared_write(k, page, offset, &[0; 4]);
            }
        }
        Some(Reply::with_words(0, &[value]))
    }

    fn ring_sizes(&mut self, req: &Request) -> Option<Reply> {
        let [_, recv, recv_slots, send, send_slots] = self.sizes;
        let (free, slots) = if req.command == 0x15 { (recv, recv_slots) } else { (send, send_slots) };
        Some(Reply::with_words(0, &[free.saturating_sub(IR_RING_HEADER), slots, 0, 0]))
    }
}

impl Module for IrUser {
    fn shapes(&self) -> Shapes {
        reply_shapes::IR_USER
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x18 => self.initialize_shared(k, req),
            0x02 => {
                if self.page.is_none() {
                    return Some(fail(IR_ERR_NOT_INITIALIZED, ""));
                }
                self.page = None;
                self.link = 0;
                None
            }
            0x03 | 0x04 => self.need_connected(),
            0x05..=0x08 => self.start_connecting(k, req),
            0x09 => self.disconnect(k),
            0x0A..=0x0C => self.get_event(k, req),
            0x0D | 0x0E => self.need_connected(),
            0x11 | 0x12 => self.latest_error(k, req),
            0x13 => Some(Reply::with_words(0, &[self.link])),
            0x15 | 0x16 => self.ring_sizes(req),
            0x19 => Some(fail(IR_ERR_NOT_NOW, "rien à rendre")),
            0x1A => {
                if self.link != 1 && self.link != 2 {
                    return Some(fail(IR_ERR_BUSY, &format!("liaison {}", self.link)));
                }
                None
            }
            _ => None,
        }
    }
}

// --- ndm:u ---

pub const NDM_ERR_ALREADY_EXCLUSIVE: u32 = 0xC8A0_6811;
pub const NDM_ERR_NOT_SUSPENDED: u32 = 0xC8A0_680D;
pub const NDM_ERR_BAD_MASK: u32 = 0xD8E0_6BED;

/// `ndm:u`, l'état exclusif et la suspension des démons. Le module n'envoie jamais de poignée à Pokémon X : rien à
/// créer. L'état exclusif est gardé (Enter deux fois de suite refuse, Query le rend) ; chaque session retient ce
/// qu'elle a suspendu.
pub struct Ndm {
    exclusive: Option<u32>,
    suspended: BTreeMap<ObjId, u32>, // session -> masque des démons suspendus
    scheduler: BTreeSet<ObjId>,
}

impl Ndm {
    pub fn new() -> Ndm {
        Ndm { exclusive: None, suspended: BTreeMap::new(), scheduler: BTreeSet::new() }
    }
}

impl Module for Ndm {
    fn shapes(&self) -> Shapes {
        reply_shapes::NDM_U
    }

    fn command(&mut self, _k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x01 => {
                if let Some(state) = self.exclusive {
                    return Some(fail(NDM_ERR_ALREADY_EXCLUSIVE, &format!("déjà dans l'état {}", state)));
                }
                self.exclusive = Some(req.word(1));
                Some(Reply::new(0).with_note(format!("état exclusif {}", req.word(1))))
            }
            0x02 => {
                self.exclusive = None;
                None
            }
            0x03 => Some(Reply::with_words(0, &[self.exclusive.unwrap_or(0)])),
            0x06 => {
                let mask = req.word(1);
                if !(1..=15).contains(&mask) {
                    return Some(fail(NDM_ERR_BAD_MASK, &format!("masque {:#x}", mask)));
                }
                *self.suspended.entry(req.session).or_insert(0) |= mask;
                None
            }
            0x07 => {
                let mask = req.word(1);
                let held = self.suspended.get(&req.session).copied().unwrap_or(0);
                if !(1..=15).contains(&mask) {
                    return Some(fail(NDM_ERR_BAD_MASK, &format!("masque {:#x}", mask)));
                }
                if mask & !held != 0 {
                    return Some(fail(
                        NDM_ERR_NOT_SUSPENDED,
                        &format!("masque {:#x}, suspendus par la session : {:#x}", mask, held),
                    ));
                }
                self.suspended.insert(req.session, held & !mask);
                None
            }
            0x08 => {
                self.scheduler.insert(req.session);
                None
            }
            0x09 => {
                if !self.scheduler.remove(&req.session) {
                    return Some(fail(NDM_ERR_NOT_SUSPENDED, "planificateur pas suspendu"));
                }
                None
            }
            _ => None,
        }
    }

    fn on_session_closed(&mut self, _k: &mut Kernel, session: ObjId) {
        self.suspended.remove(&session);
        self.scheduler.remove(&session);
    }
}

// --- ac:u ---

pub const AC_ERR_BAD_ARGUMENT: u32 = 0xE040_9FFF;
pub const AC_ERR_BUSY: u32 = 0xE0A0_9FFC;
pub const AC_ERR_WAITING: u32 = 0xE120_9C46; // le résultat tant que la connexion dure
pub const AC_ERR_OFFLINE: u32 = 0xE0A0_9D2E; // GetWifiStatus et GetCurrentAPInfo hors ligne
pub const AC_CONNECT_MS: u64 = 50;
pub const AC_CONFIG_SIZE: usize = 0x200;

pub fn default_ac_config() -> Vec<u8> {
    let mut config = vec![0u8; AC_CONFIG_SIZE];
    config[0] = 0xBF;
    config[8..14].copy_from_slice(&[0xFF; 6]);
    config
}

/// `ac:u`, la connexion à internet, hors ligne (fiche ac, parties 4 et 9) : les réglages passent par la configuration de
/// 0x200 octets que le jeu garde lui-même, ConnectAsync rend 0 puis signale l'événement donné 50 ms plus tard,
/// GetConnectResult rend alors un échec ; GetWifiStatus et GetCurrentAPInfo rendent `0xE0A09D2E` ; IsConnected 0.
/// Interprété : le code de l'échec de la connexion (la fiche n'a pas lu ce que `connect_to_ap` rend quand le Wi-Fi est
/// coupé), pris égal à celui de GetWifiStatus.
pub struct Ac {
    connect_result: Rc<RefCell<BTreeMap<ObjId, u32>>>, // session -> résultat
}

impl Ac {
    pub fn new() -> Ac {
        Ac { connect_result: Rc::new(RefCell::new(BTreeMap::new())) }
    }

    fn config_in(&self, k: &Kernel, req: &Request) -> Option<Vec<u8>> {
        let statics = static_items(req);
        let first = statics.first()?;
        let mut config = req.static_data(k, first.0);
        if config.len() < AC_CONFIG_SIZE {
            config.resize(AC_CONFIG_SIZE, 0);
        }
        Some(config)
    }

    fn connect_async(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let config = self.config_in(k, req);
        let events = event_objects(k, req);
        let (Some(config), Some(&done)) = (config, events.first()) else {
            return Some(fail(AC_ERR_BAD_ARGUMENT, ""));
        };
        let head = u32::from_le_bytes([config[0], config[1], config[2], config[3]]);
        if head >= 0x8000_0000 || config[4] >= 3 || config[6] >= 3 || config[7] >= 7 {
            return Some(fail(AC_ERR_BAD_ARGUMENT, "configuration refusée"));
        }
        if self.connect_result.borrow().get(&req.session) == Some(&AC_ERR_WAITING) {
            return Some(fail(AC_ERR_BUSY, "une connexion est déjà en cours"));
        }
        self.connect_result.borrow_mut().insert(req.session, AC_ERR_WAITING);
        let (session, results) = (req.session, self.connect_result.clone());
        after_ms(k, AC_CONNECT_MS, move |k| {
            results.borrow_mut().insert(session, AC_ERR_OFFLINE);
            k.signal_event(done);
        });
        Some(Reply::new(0).with_note(format!(
            "hors ligne : l'événement sera signalé dans {} ms, avec un échec",
            AC_CONNECT_MS
        )))
    }
}

impl Module for Ac {
    fn shapes(&self) -> Shapes {
        reply_shapes::AC_U
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x01 => Some(Reply::new(0).static_buffer(0, &default_ac_config())),
            0x27 => match self.config_in(k, req) {
                None => Some(fail(AC_ERR_BAD_ARGUMENT, "")),
                Some(config) => Some(Reply::with_words(0, &[config[6] as u32])),
            },
            0x2D => match self.config_in(k, req) {
                None => Some(fail(AC_ERR_BAD_ARGUMENT, "")),
                Some(mut config) => {
                    config[0x1B] = (req.word(1) & 0xFF) as u8;
                    config[0x1A] = (req.word(2) & 0xFF) as u8;
                    Some(Reply::new(0).static_buffer(0, &config))
                }
            },
            0x24 => match self.config_in(k, req) {
                None => Some(fail(AC_ERR_BAD_ARGUMENT, "")),
                Some(mut config) => {
                    let head = u32::from_le_bytes([config[0], config[1], config[2], config[3]]);
                    config[0..4].copy_from_slice(&(head & !req.word(1)).to_le_bytes());
                    Some(Reply::new(0).static_buffer(0, &config))
                }
            },
            0x04 => self.connect_async(k, req),
            0x05 => {
                let result = self.connect_result.borrow().get(&req.session).copied().unwrap_or(0);
                Some(Reply::new(result).with_note("connexion"))
            }
            0x08 => {
                if let Some(&event) = event_objects(k, req).first() {
                    after_ms(k, 10, move |k| k.signal_event(event));
                }
                self.connect_result.borrow_mut().remove(&req.session);
                None
            }
            0x0D | 0x0E => Some(fail(AC_ERR_OFFLINE, "hors ligne")),
            _ => None,
        }
    }
}

// --- frd:u ---

pub const FRD_PRINCIPAL_ID: u32 = 0x0BEC_0DE1; // une identité fabriquée pour le banc (jamais celle d'une console)
pub const FRD_ERR_NOT_CONNECTED: u32 = 0xD8A0_C402;
pub const FRD_ERR_NO_RESULT: u32 = 0xC8A0_C7EF;
pub const FRD_ERR_NO_MII: u32 = 0xD8A0_C4F8;
pub const FRD_ERR_REFUSED: u32 = 0xC8A0_C7EA;
pub const FRD_MODULE: u32 = 0x31;

/// Le code d'ami : l'identifiant en bas, l'octet de tête du SHA-1 de l'identifiant (4 octets, petit-boutiste) décalé d'un
/// bit à droite en haut (fiche friends, partie 5).
pub fn friend_code(principal_id: u32) -> u64 {
    let digest = overlay::sha1(&principal_id.to_le_bytes());
    principal_id as u64 | ((digest[0] >> 1) as u64) << 32
}

/// (résultat de la commande, code d'erreur) pour un résultat reçu (fiche friends, partie 5).
pub fn result_to_error_code(result: u32) -> (u32, u32) {
    let (module, description, negative) = (result >> 10 & 0xFF, result & 0x3FF, result & 0x8000_0000 != 0);
    if module != FRD_MODULE {
        return (0xE0E0_C403, 0);
    }
    if !negative {
        return (0, 0);
    }
    if description == 0x101 {
        return (0, 23000);
    }
    let (q, r) = (description >> 5, description & 0x1F);
    (0, if q == 0 || q == 0x1F { 0 } else { 10000 + 100 * q + r })
}

/// `frd:u`, hors ligne et sans ami (fiche friends, partie 9). Vrai : l'identité locale (identifiant principal non nul et
/// son code d'ami), le nom d'écran, ResultToErrorCode. Neutre : liste d'amis vide, présence nulle, mot de passe vide.
/// Échec : tout ce qui touche un serveur. Login signale tout de suite l'événement et HasLoggedIn rend 0. Interprété : les
/// codes d'échec des demandes de serveur (la fiche ne dit que « un résultat négatif »).
pub struct Friends {
    last: BTreeMap<ObjId, u32>, // session -> dernier résultat
}

impl Friends {
    pub fn new() -> Friends {
        Friends { last: BTreeMap::new() }
    }

    fn zeros_in_buffer(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        let (_, room) = req.receive_buffer(k, 0);
        let limit = if req.command == 0x08 { 0x12C } else { 0x800 };
        let note = match req.command {
            0x08 => "présence nulle",
            0x10 => "mot de passe vide",
            0x17 => "attributs à 0",
            0x1C => "codes à 0",
            _ => "",
        };
        Some(Reply::new(0).static_buffer(0, &vec![0u8; room.min(limit) as usize]).with_note(note))
    }
}

impl Module for Friends {
    fn shapes(&self) -> Shapes {
        reply_shapes::FRD_U
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x03 => {
                for event in event_objects(k, req) {
                    k.signal_event(event);
                }
                Some(Reply::new(0).with_note("hors ligne : connexion « finie » tout de suite, HasLoggedIn restera à 0"))
            }
            0x05 => {
                let code = friend_code(FRD_PRINCIPAL_ID);
                Some(Reply::with_words(0, &[FRD_PRINCIPAL_ID, 0, code as u32, (code >> 32) as u32]))
            }
            0x09 => {
                let mut name: Vec<u8> = "Banc".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
                name.resize(24, 0);
                Some(Reply::with_words(0, &le_words(&name)))
            }
            0x08 | 0x10 | 0x17 | 0x1C => self.zeros_in_buffer(k, req),
            0x11 => Some(Reply::with_words(0, &[0]).static_buffer(0, &[]).with_note("aucun ami")),
            0x23 => Some(Reply::new(self.last.get(&req.session).copied().unwrap_or(0))),
            0x27 => {
                let (result, error_code) = result_to_error_code(req.word(1));
                Some(Reply::with_words(result, &[error_code]))
            }
            0x28 | 0x2A | 0x2E => Some(fail(FRD_ERR_NOT_CONNECTED, "pas de serveur")),
            0x29 | 0x2B => Some(fail(FRD_ERR_NO_RESULT, "aucune demande aboutie")),
            0x33 => Some(fail(FRD_ERR_NO_MII, "")),
            0x34 => Some(fail(FRD_ERR_REFUSED, "liste locale refusée")),
            _ => None,
        }
    }

    fn after_reply(&mut self, _k: &mut Kernel, req: &Request, reply: &Reply) {
        if req.command != 0x23 {
            self.last.insert(req.session, reply.result);
        }
    }
}

// --- soc:U ---

pub const SOC_ERR_NOT_STARTED: u32 = (-0x27i32) as u32; // « pile non démarrée » (fiche socket, partie 11)
pub const SOC_ERR_GENERIC: u32 = 0xFFFF_FFFF;
pub const SOC_POLL_NVAL: u32 = 0x20;
const SOC_FAILING: [u32; 24] = [
    0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x15, 0x17, 0x18,
    0x1B, 0x1C, 0x1D, 0x1E, 0x20,
];

/// `soc:U`, hors ligne : InitializeSockets réussit, `socket` rend un descripteur négatif (« pile non démarrée », -0x27),
/// donc aucun descripteur n'existe et tout le reste échoue en -1 ; `poll` rend `revents` à 0x20 pour les descripteurs
/// inconnus ; close, ShutdownSockets et gethostid rendent 0 (fiche socket, partie 11).
pub struct Socket;

impl Module for Socket {
    fn shapes(&self) -> Shapes {
        reply_shapes::SOC_U
    }

    fn command(&mut self, k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x02 => Some(Reply::with_words(0, &[SOC_ERR_NOT_STARTED]).with_note("hors ligne : descripteur -0x27")),
            0x14 => {
                let statics = static_items(req);
                let count = req.word(1);
                let mut data = match statics.first() {
                    Some(first) => req.static_data(k, first.0),
                    None => Vec::new(),
                };
                for i in 0..(count as usize).min(data.len() / 12) {
                    data[12 * i + 8..12 * i + 12].copy_from_slice(&SOC_POLL_NVAL.to_le_bytes());
                }
                Some(Reply::with_words(0, &[count]).static_buffer(0, &data).with_note(format!("{} descripteur(s) inconnu(s)", count)))
            }
            0x0B | 0x16 => Some(Reply::with_words(0, &[0])),
            0x1A | 0x1F => {
                let (_, room) = req.receive_buffer(k, 0);
                Some(Reply::with_words(0, &[room]).static_buffer(0, &vec![0u8; room.min(0x150) as usize]))
            }
            command if SOC_FAILING.contains(&command) => {
                Some(Reply::with_words(0, &[SOC_ERR_GENERIC]).with_note("hors ligne : -1"))
            }
            _ => None,
        }
    }
}

// --- http:C ---

pub const HTTP_ERR_TOO_MANY: u32 = 0xD8A0_A01A;
pub const HTTP_ERR_NO_CONTEXT: u32 = 0xD8A0_A064;
pub const HTTP_MAX_CONTEXTS: usize = 8;

/// `http:C`, sans réseau (fiche http, partie 10) : une vraie machine à contextes (poignées non nulles et distinctes,
/// huit au plus, InitializeConnectionSession refuse une poignée inconnue), mais toute requête est « finie » aussitôt,
/// corps vide, code HTTP 0, rien à lire (ReceiveData rend 0 : pas de `0xD840A02B`). Interprété : la fiche ne dit pas ce
/// que fait le jeu d'un code 0.
pub struct Http {
    contexts: BTreeSet<u32>,
    next_handle: u32,
}

impl Http {
    pub fn new() -> Http {
        Http { contexts: BTreeSet::new(), next_handle: 1 }
    }
}

impl Module for Http {
    fn shapes(&self) -> Shapes {
        reply_shapes::HTTP_C
    }

    fn command(&mut self, _k: &mut Kernel, req: &Request) -> Option<Reply> {
        match req.command {
            0x02 => {
                if self.contexts.len() >= HTTP_MAX_CONTEXTS {
                    return Some(fail(HTTP_ERR_TOO_MANY, "8 contextes ouverts"));
                }
                let handle = self.next_handle;
                self.next_handle += 1;
                self.contexts.insert(handle);
                Some(Reply::with_words(0, &[handle]).with_note(format!("contexte {}", handle)))
            }
            0x03 => {
                self.contexts.remove(&req.word(1));
                None
            }
            0x08 => {
                if !self.contexts.contains(&req.word(1)) {
                    return Some(fail(HTTP_ERR_NO_CONTEXT, &format!("contexte {} inconnu", req.word(1))));
                }
                None
            }
            _ => None,
        }
    }
}

/// `MODULES` du Python : les noms de service qui ont une fiche. Rien pour les autres.
pub const MODULE_NAMES: [&str; 13] = [
    "nwm::UDS", "boss:U", "boss:M", "ssl:C", "cecd:u", "cam:u", "mic:u", "ir:USER", "ndm:u", "ac:u", "frd:u", "soc:U",
    "http:C",
];

/// `MODULES.get(name)(bench, name)` : le service écrit d'après la fiche, ou `None` si le nom n'a pas de fiche.
/// L'ordre de création des objets du noyau est celui du `__init__` Python de chaque classe.
pub fn make_module(k: &mut Kernel, name: &str) -> Option<Rc<RefCell<dyn Service>>> {
    fn wrap<M: Module + 'static>(name: &str, module: M) -> Option<Rc<RefCell<dyn Service>>> {
        Some(Rc::new(RefCell::new(Shaped::new(name, module))))
    }
    match name {
        "nwm::UDS" => wrap(name, Nwm::new()),
        "boss:U" => {
            let module = Boss::new(k);
            wrap(name, module)
        }
        "boss:M" => wrap(name, BossManagement),
        "ssl:C" => wrap(name, Ssl::new(None)),
        "cecd:u" => {
            let module = Cecd::new(k);
            wrap(name, module)
        }
        "cam:u" => wrap(name, Camera::new()),
        "mic:u" => {
            let module = Mic::new(k);
            wrap(name, module)
        }
        "ir:USER" => wrap(name, IrUser::new()),
        "ndm:u" => wrap(name, Ndm::new()),
        "ac:u" => wrap(name, Ac::new()),
        "frd:u" => wrap(name, Friends::new()),
        "soc:U" => wrap(name, Socket),
        "http:C" => wrap(name, Http::new()),
        _ => None,
    }
}
