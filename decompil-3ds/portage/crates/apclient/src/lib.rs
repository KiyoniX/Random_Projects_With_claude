//! Un client du protocole d'Archipelago, sans rien du jeu : il se connecte dans son propre fil, se reconnecte quand la
//! connexion tombe, et échange des messages avec le fil du jeu par des files. Protocole : `docs/network protocol.md` du
//! dépôt Archipelago. Le serveur envoie et reçoit des listes de commandes en JSON sur une WebSocket.

use std::net::TcpStream;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::Duration;

use serde_json::{Value, json};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

/// Ce qui arrive du serveur.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// Le nom de la partie (`seed_name`) : il lie une sauvegarde à sa partie.
    Room { seed: String },
    /// Connecté : ce qu'il reste à trouver, ce qui est déjà trouvé, et les réglages de la partie.
    Connected { missing: Vec<i64>, checked: Vec<i64>, slot_data: Value },
    Refused { errors: Vec<String> },
    /// Les objets reçus : `index` est la place du premier dans la liste complète.
    Items { index: u64, items: Vec<i64> },
    /// Un message à montrer au joueur.
    Text(String),
    Disconnected(String),
}

/// Ce que le jeu envoie au serveur.
#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    LocationChecks(Vec<i64>),
    Goal,
    Sync,
}

/// Les réglages de la connexion.
#[derive(Debug, Clone)]
pub struct Settings {
    /// `hôte:port`, ou une adresse avec `ws://` ou `wss://`.
    pub address: String,
    pub game: String,
    pub slot: String,
    pub password: Option<String>,
    /// La version du protocole qu'on annonce.
    pub version: (u32, u32, u32),
}

/// Les adresses à essayer : sans préfixe, sécurisé d'abord (archipelago.gg), puis non sécurisé (un serveur local).
fn urls(address: &str) -> Vec<String> {
    if address.contains("://") {
        vec![address.to_string()]
    } else {
        vec![format!("wss://{address}"), format!("ws://{address}")]
    }
}

/// La commande `Connect`. Tous les objets viennent du serveur (0b111) : le jeu n'en place aucun lui-même.
fn connect_message(settings: &Settings) -> Value {
    let (major, minor, build) = settings.version;
    json!([{
        "cmd": "Connect",
        "password": settings.password,
        "game": settings.game,
        "name": settings.slot,
        "uuid": format!("portage-{}", settings.slot),
        "version": {"major": major, "minor": minor, "build": build, "class": "Version"},
        "items_handling": 0b111,
        "tags": [],
        "slot_data": true,
    }])
}

fn command_message(command: &Command) -> Value {
    match command {
        Command::LocationChecks(locations) => json!([{"cmd": "LocationChecks", "locations": locations}]),
        Command::Goal => json!([{"cmd": "StatusUpdate", "status": 30}]),
        Command::Sync => json!([{"cmd": "Sync"}]),
    }
}

fn ids(value: &Value) -> Vec<i64> {
    value.as_array().map(|list| list.iter().filter_map(Value::as_i64).collect()).unwrap_or_default()
}

/// Les événements d'un texte reçu du serveur ; ce qu'on ne connaît pas est ignoré, comme le demande le protocole.
fn parse_events(text: &str) -> Vec<Event> {
    let Ok(Value::Array(commands)) = serde_json::from_str::<Value>(text) else { return Vec::new() };
    commands
        .iter()
        .filter_map(|command| match command["cmd"].as_str()? {
            "RoomInfo" => Some(Event::Room { seed: command["seed_name"].as_str().unwrap_or("").to_string() }),
            "Connected" => Some(Event::Connected {
                missing: ids(&command["missing_locations"]),
                checked: ids(&command["checked_locations"]),
                slot_data: command["slot_data"].clone(),
            }),
            "ConnectionRefused" => Some(Event::Refused {
                errors: command["errors"].as_array().map(|e| e.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default(),
            }),
            "ReceivedItems" => Some(Event::Items {
                index: command["index"].as_u64().unwrap_or(0),
                items: command["items"].as_array().map(|list| list.iter().filter_map(|i| i["item"].as_i64()).collect()).unwrap_or_default(),
            }),
            "PrintJSON" => {
                let parts = command["data"].as_array()?;
                Some(Event::Text(parts.iter().filter_map(|p| p["text"].as_str()).collect()))
            }
            _ => None,
        })
        .collect()
}

/// Le fil du jeu ne parle qu'à ça.
pub struct Client {
    commands: Sender<Command>,
    events: Receiver<Event>,
}

impl Client {
    pub fn start(settings: Settings) -> Client {
        let (commands, commands_in) = channel();
        let (events_out, events) = channel();
        std::thread::spawn(move || run(settings, commands_in, events_out));
        Client { commands, events }
    }

    pub fn send(&self, command: Command) {
        let _ = self.commands.send(command);
    }

    /// Ce qui est arrivé depuis la dernière fois ; ne bloque jamais.
    pub fn events(&self) -> Vec<Event> {
        self.events.try_iter().collect()
    }
}

/// Se connecte, échange jusqu'à ce que ça tombe, recommence. S'arrête quand le jeu a lâché le client.
fn run(settings: Settings, commands: Receiver<Command>, events: Sender<Event>) {
    let mut wait = Duration::from_secs(1);
    loop {
        let reason = match open(&settings) {
            Ok(mut socket) => {
                wait = Duration::from_secs(1);
                match exchange(&mut socket, &settings, &commands, &events) {
                    Ok(()) => return,
                    Err(reason) => reason,
                }
            }
            Err(reason) => reason,
        };
        if events.send(Event::Disconnected(reason)).is_err() {
            return;
        }
        std::thread::sleep(wait);
        wait = (wait * 2).min(Duration::from_secs(30));
    }
}

fn open(settings: &Settings) -> Result<WebSocket<MaybeTlsStream<TcpStream>>, String> {
    let mut last = String::new();
    for url in urls(&settings.address) {
        match tungstenite::connect(url.as_str()) {
            Ok((socket, _)) => {
                // une attente courte : les commandes du jeu doivent passer même quand le serveur se tait
                let timeout = Some(Duration::from_millis(50));
                let set = match socket.get_ref() {
                    MaybeTlsStream::Plain(stream) => stream.set_read_timeout(timeout),
                    MaybeTlsStream::Rustls(stream) => stream.get_ref().set_read_timeout(timeout),
                    _ => Ok(()),
                };
                set.map_err(|e| e.to_string())?;
                return Ok(socket);
            }
            Err(e) => last = format!("{url} : {e}"),
        }
    }
    Err(last)
}

/// Rend `Ok` quand le jeu a lâché le client, `Err` quand la connexion tombe.
fn exchange(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>, settings: &Settings, commands: &Receiver<Command>, events: &Sender<Event>) -> Result<(), String> {
    loop {
        match commands.try_recv() {
            Ok(command) => {
                socket.send(Message::text(command_message(&command).to_string())).map_err(|e| e.to_string())?;
                continue;
            }
            Err(std::sync::mpsc::TryRecvError::Disconnected) => return Ok(()),
            Err(std::sync::mpsc::TryRecvError::Empty) => {}
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                for event in parse_events(text.as_str()) {
                    if matches!(event, Event::Room { .. }) {
                        socket.send(Message::text(connect_message(settings).to_string())).map_err(|e| e.to_string())?;
                    }
                    if events.send(event).is_err() {
                        return Ok(());
                    }
                }
            }
            Ok(Message::Close(_)) => return Err("le serveur a fermé la connexion".to_string()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Settings {
        Settings { address: "localhost:38281".into(), game: "Pokemon X".into(), slot: "Kris".into(), password: None, version: (0, 6, 0) }
    }

    #[test]
    fn address_without_scheme_tries_secure_first() {
        assert_eq!(urls("archipelago.gg:1234"), ["wss://archipelago.gg:1234", "ws://archipelago.gg:1234"]);
        assert_eq!(urls("ws://localhost:1"), ["ws://localhost:1"]);
    }

    #[test]
    fn connect_asks_for_every_item_and_the_slot_data() {
        let message = connect_message(&settings());
        assert_eq!(message[0]["cmd"], "Connect");
        assert_eq!(message[0]["game"], "Pokemon X");
        assert_eq!(message[0]["name"], "Kris");
        assert_eq!(message[0]["items_handling"], 7);
        assert_eq!(message[0]["slot_data"], true);
        assert_eq!(message[0]["version"]["class"], "Version");
    }

    #[test]
    fn commands_have_their_shape() {
        assert_eq!(command_message(&Command::LocationChecks(vec![1, 2])), json!([{"cmd": "LocationChecks", "locations": [1, 2]}]));
        assert_eq!(command_message(&Command::Goal), json!([{"cmd": "StatusUpdate", "status": 30}]));
    }

    #[test]
    fn events_are_read_and_the_unknown_ignored() {
        let text = r#"[
            {"cmd": "RoomInfo", "seed_name": "AP123"},
            {"cmd": "Connected", "missing_locations": [5, 6], "checked_locations": [7], "slot_data": {"goal": 8}},
            {"cmd": "ReceivedItems", "index": 2, "items": [{"item": 17, "location": 5, "player": 1, "flags": 0}]},
            {"cmd": "PrintJSON", "data": [{"text": "Bonjour "}, {"text": "Kris"}]},
            {"cmd": "ConnectionRefused", "errors": ["InvalidSlot"]},
            {"cmd": "Inconnu"}
        ]"#;
        let events = parse_events(text);
        assert_eq!(events.len(), 5);
        assert_eq!(events[0], Event::Room { seed: "AP123".into() });
        assert_eq!(events[1], Event::Connected { missing: vec![5, 6], checked: vec![7], slot_data: json!({"goal": 8}) });
        assert_eq!(events[2], Event::Items { index: 2, items: vec![17] });
        assert_eq!(events[3], Event::Text("Bonjour Kris".into()));
        assert_eq!(events[4], Event::Refused { errors: vec!["InvalidSlot".into()] });
        assert!(parse_events("pas du json").is_empty());
    }
}
