//! La partie Archipelago côté jeu, à chaque fin d'image : envoyer les contrôles faits, donner les objets reçus, dire que
//! l'objectif est atteint. Tout ce qui est propre au jeu est `services::game_state`, et ces règles :
//! un numéro de contrôle est le numéro du drapeau qui le marque, un numéro d'objet est celui du jeu.

use std::collections::BTreeSet;
use std::path::PathBuf;

use apclient::{Client, Command, Event, Settings};
use kernel::kernel::Kernel;
use services::game_state::GameState;

/// Le dernier numéro d'objet du jeu : au-delà, ce n'est pas un objet du sac (`LAST_ITEM` de `game_state`).
const LAST_ITEM: i64 = 0x2CD;
/// Les drapeaux se relisent une fois toutes les 30 fins d'image : un contrôle n'a pas besoin de partir plus vite.
const CHECK_PERIOD: u64 = 30;

pub struct Session {
    client: Client,
    slot: String,
    /// Où garder le compte des objets donnés, un fichier par partie et par joueur.
    folder: PathBuf,
    seed: String,
    connected: bool,
    goal_badges: u32,
    goal_sent: bool,
    watched: Vec<i64>,
    sent: BTreeSet<i64>,
    /// La liste complète reçue du serveur.
    received: Vec<i64>,
    /// Combien de `received` ont été donnés : c'est ce compte qui évite de redonner, et qui rattrape après une coupure.
    applied: usize,
    /// Combien ont été remis à la file du noyau.
    queued: usize,
    frames: u64,
}

impl Session {
    pub fn new(settings: Settings, folder: PathBuf) -> Session {
        let slot = settings.slot.clone();
        Session {
            client: Client::start(settings),
            slot,
            folder,
            seed: String::new(),
            connected: false,
            goal_badges: 8,
            goal_sent: false,
            watched: Vec::new(),
            sent: BTreeSet::new(),
            received: Vec::new(),
            applied: 0,
            queued: 0,
            frames: 0,
        }
    }

    fn progress_path(&self) -> PathBuf {
        self.folder.join(format!("archipelago-{}-{}.txt", self.seed, self.slot))
    }

    fn handle(&mut self, event: Event) {
        match event {
            Event::Room { seed } => {
                self.seed = seed;
                self.applied = std::fs::read_to_string(self.progress_path()).ok().and_then(|t| t.trim().parse().ok()).unwrap_or(0);
                self.queued = self.applied;
            }
            Event::Connected { missing, slot_data, .. } => {
                println!("Archipelago : connecté, {} contrôles à trouver", missing.len());
                self.connected = true;
                self.goal_sent = false;
                self.watched = missing;
                self.sent.clear();
                if let Some(badges) = slot_data["goal_badges"].as_u64() {
                    self.goal_badges = badges as u32;
                }
            }
            Event::Refused { errors } => println!("Archipelago : connexion refusée : {errors:?}"),
            Event::Items { index, items } => {
                if index == 0 {
                    self.received = items;
                } else if index as usize == self.received.len() {
                    self.received.extend(items);
                } else {
                    self.client.send(Command::Sync);
                }
            }
            Event::Text(text) => println!("Archipelago : {text}"),
            Event::Disconnected(reason) => {
                println!("Archipelago : déconnecté ({reason}), nouvel essai");
                self.connected = false;
            }
        }
    }

    fn give_items(&mut self, k: &mut Kernel) {
        let applied = self.queued - k.bench.gifts.len();
        if applied != self.applied {
            self.applied = applied;
            let _ = std::fs::write(self.progress_path(), applied.to_string());
        }
        while self.queued < self.received.len() {
            let item = self.received[self.queued];
            // un objet qui n'est pas du sac compte comme donné : la liste du serveur doit rester alignée
            k.bench.gifts.push_back((0.0, if (1..=LAST_ITEM).contains(&item) { item as u32 } else { 0 }, 1));
            self.queued += 1;
        }
    }

    fn report_checks(&mut self, k: &Kernel) {
        let Some(game) = GameState::find(&k.memory) else { return };
        let done: Vec<i64> = self.watched.iter().copied().filter(|id| !self.sent.contains(id) && game.flag(*id as u32) == Some(true)).collect();
        if !done.is_empty() {
            self.sent.extend(&done);
            self.client.send(Command::LocationChecks(done));
        }
        if !self.goal_sent && game.badges().is_some_and(|b| b >= self.goal_badges) {
            self.goal_sent = true;
            self.client.send(Command::Goal);
        }
    }

    /// Une fin d'image.
    pub fn update(&mut self, k: &mut Kernel) {
        for event in self.client.events() {
            self.handle(event);
        }
        if !self.connected {
            return;
        }
        self.give_items(k);
        self.frames += 1;
        if self.frames % CHECK_PERIOD == 0 {
            self.report_checks(k);
        }
    }
}
