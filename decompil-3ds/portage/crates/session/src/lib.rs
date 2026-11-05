//! Les parties à plusieurs, à distance : une session (graine du randomizer, règle, génération) gardée sur le disque, un hôte
//! qui l'annonce, des joueurs qui s'y joignent par son adresse IP et son port.
//!
//! La règle « nuzlocke » : quand un Pokémon d'un joueur est K.O., tout le monde recommence une partie neuve, avec la même
//! graine. La génération compte ces recommencements ; un joueur qui revient plus tard avec une génération en retard
//! recommence aussi. On quitte et on reprend quand on veut : la session et la partie de chacun restent sur son disque.
//!
//! Protocole : TCP, une ligne de texte par message (UTF-8).
//! - joueur -> hôte : `bonjour <nom>`, `ko <nom> <texte>` ;
//! - hôte -> joueur : `session <JSON>` (en réponse à bonjour), `recommencer <génération> <message>`, `joueurs <noms, ...>`.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Ce qu'un K.O. déclenche.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize, Default)]
pub enum Rule {
    /// Un Pokémon K.O. chez un joueur : tout le monde recommence.
    #[default]
    Nuzlocke,
    /// Rien : on joue ensemble le même jeu (la même graine), sans règle.
    Free,
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Session {
    pub name: String,
    /// La graine du randomizer (vide : le jeu d'origine) et ses parties (`outils/randomizer.py`).
    pub seed: String,
    pub parts: Vec<String>,
    pub rule: Rule,
    /// Combien de fois tout le monde a recommencé.
    pub generation: u32,
    pub players: Vec<String>,
    /// Le dernier recommencement : qui, quoi.
    pub last_reset: String,
}

impl Session {
    /// Le dossier d'une session : `local/sessions/<nom>`.
    pub fn folder(root: &Path, name: &str) -> PathBuf {
        let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        root.join("local/sessions").join(safe)
    }

    pub fn load(root: &Path, name: &str) -> Option<Session> {
        let text = std::fs::read_to_string(Self::folder(root, name).join("session.json")).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn save(&self, root: &Path) -> Result<(), String> {
        let folder = Self::folder(root, &self.name);
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        std::fs::write(folder.join("session.json"), serde_json::to_string_pretty(self).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }

    /// Le nom du mod du randomizer de cette session (`local/mods-build/<nom>`), s'il y a une graine.
    pub fn mod_name(&self) -> Option<String> {
        (!self.seed.is_empty()).then(|| format!("random-{}-{}", self.seed, self.parts.join("-")))
    }
}

/// Ce que le jeu apprend du réseau.
#[derive(Clone, PartialEq, Debug)]
pub enum Event {
    /// Tout le monde recommence : la nouvelle génération et pourquoi.
    Reset { generation: u32, message: String },
    /// Les joueurs connectés.
    Players(Vec<String>),
    /// La connexion à l'hôte est perdue.
    Lost(String),
}

fn line(stream: &mut TcpStream, text: &str) -> std::io::Result<()> {
    stream.write_all(format!("{}\n", text.replace('\n', " ")).as_bytes())
}

/// L'hôte : il garde la session (et l'écrit à chaque changement), répond aux joueurs et leur envoie les recommencements.
pub struct Host {
    shared: Arc<Mutex<HostState>>,
    events: Receiver<Event>,
}

struct HostState {
    root: PathBuf,
    session: Session,
    me: String,
    /// Les joueurs connectés : nom, adresse (une connexion), flux.
    clients: Vec<(String, std::net::SocketAddr, TcpStream)>,
    events: Sender<Event>,
}

impl HostState {
    fn broadcast(&mut self, text: &str) {
        self.clients.retain_mut(|(_, _, s)| line(s, text).is_ok());
    }

    fn players(&mut self) {
        let mut names = vec![self.me.clone()];
        for (n, _, _) in &self.clients {
            if !names.contains(n) {
                names.push(n.clone());
            }
        }
        self.session.players = names.clone();
        let _ = self.session.save(&self.root);
        self.broadcast(&format!("joueurs {}", names.join(", ")));
        let _ = self.events.send(Event::Players(names));
    }

    /// Un K.O. (d'un joueur ou de l'hôte) : nouvelle génération pour tous.
    fn knocked_out(&mut self, who: &str, what: &str) {
        if self.session.rule != Rule::Nuzlocke {
            return;
        }
        self.session.generation += 1;
        self.session.last_reset = format!("{who} : {what}");
        let _ = self.session.save(&self.root);
        let message = format!("{who} a perdu {what} : tout le monde recommence");
        self.broadcast(&format!("recommencer {} {message}", self.session.generation));
        let _ = self.events.send(Event::Reset { generation: self.session.generation, message });
    }
}

impl Host {
    /// Écoute sur ce port (toutes les interfaces) pour cette session.
    pub fn start(root: &Path, session: Session, me: &str, port: u16) -> Result<Host, String> {
        let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|e| format!("port {port} : {e}"))?;
        let (tx, rx) = channel();
        let shared = Arc::new(Mutex::new(HostState { root: root.to_path_buf(), session, me: me.to_string(), clients: Vec::new(), events: tx }));
        let accept = shared.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let state = accept.clone();
                std::thread::spawn(move || serve(state, stream));
            }
        });
        shared.lock().unwrap().players();
        Ok(Host { shared, events: rx })
    }

    pub fn session(&self) -> Session {
        self.shared.lock().unwrap().session.clone()
    }

    /// Un Pokémon de l'hôte lui-même est K.O.
    pub fn knocked_out(&self, what: &str) {
        let mut state = self.shared.lock().unwrap();
        let me = state.me.clone();
        state.knocked_out(&me, what);
    }

    pub fn poll(&self) -> Vec<Event> {
        self.events.try_iter().collect()
    }
}

/// Un joueur connecté à l'hôte : une ligne à la fois, jusqu'à la déconnexion.
fn serve(state: Arc<Mutex<HostState>>, mut stream: TcpStream) {
    let (Ok(reader), Ok(peer)) = (stream.try_clone(), stream.peer_addr()) else { return };
    let mut joined = false;
    for text in BufReader::new(reader).lines() {
        let Ok(text) = text else { break };
        let (word, rest) = text.split_once(' ').unwrap_or((&text, ""));
        let mut s = state.lock().unwrap();
        match word {
            "bonjour" => {
                let session = serde_json::to_string(&s.session).unwrap_or_default();
                if line(&mut stream, &format!("session {session}")).is_err() {
                    break;
                }
                if let Ok(copy) = stream.try_clone() {
                    s.clients.push((rest.to_string(), peer, copy));
                }
                joined = true;
                s.players();
            }
            "ko" => {
                let (who, what) = rest.split_once(' ').unwrap_or((rest, "un Pokémon"));
                s.knocked_out(who, what);
            }
            _ => {}
        }
    }
    let mut s = state.lock().unwrap();
    if joined {
        s.clients.retain(|(_, a, _)| *a != peer);
        s.players();
    }
}

/// Un joueur : connecté à l'hôte, il reçoit la session puis les recommencements.
pub struct Client {
    stream: TcpStream,
    events: Receiver<Event>,
    me: String,
}

fn connect(address: &str) -> Result<TcpStream, String> {
    let target = address.to_socket_addrs().map_err(|e| format!("{address} : {e}"))?.next().ok_or(format!("{address} : adresse inconnue"))?;
    TcpStream::connect_timeout(&target, Duration::from_secs(5)).map_err(|e| format!("{address} : {e}"))
}

/// La session de l'hôte, lue une fois (le launcher en a besoin pour construire le mod avant de lancer le jeu).
pub fn fetch(address: &str, me: &str) -> Result<Session, String> {
    let mut stream = connect(address)?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
    line(&mut stream, &format!("bonjour {me}")).map_err(|e| e.to_string())?;
    let mut text = String::new();
    BufReader::new(stream).read_line(&mut text).map_err(|e| format!("pas de réponse de l'hôte : {e}"))?;
    let json = text.trim_end().strip_prefix("session ").ok_or("l'hôte n'a pas envoyé la session")?;
    serde_json::from_str(json).map_err(|e| e.to_string())
}

impl Client {
    pub fn join(address: &str, me: &str) -> Result<(Client, Session), String> {
        let mut stream = connect(address)?;
        line(&mut stream, &format!("bonjour {me}")).map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
        let mut text = String::new();
        reader.read_line(&mut text).map_err(|e| e.to_string())?;
        let session: Session = serde_json::from_str(text.trim_end().strip_prefix("session ").ok_or("l'hôte n'a pas envoyé la session")?).map_err(|e| e.to_string())?;
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            for text in reader.lines() {
                let Ok(text) = text else { break };
                let (word, rest) = text.split_once(' ').unwrap_or((&text, ""));
                let event = match word {
                    "recommencer" => {
                        let (generation, message) = rest.split_once(' ').unwrap_or((rest, ""));
                        Event::Reset { generation: generation.parse().unwrap_or(0), message: message.to_string() }
                    }
                    "joueurs" => Event::Players(rest.split(", ").map(str::to_string).collect()),
                    _ => continue,
                };
                if tx.send(event).is_err() {
                    return;
                }
            }
            let _ = tx.send(Event::Lost("l'hôte s'est déconnecté".to_string()));
        });
        Ok((Client { stream, events: rx, me: me.to_string() }, session))
    }

    pub fn knocked_out(&mut self, what: &str) {
        let me = self.me.clone();
        let _ = line(&mut self.stream, &format!("ko {me} {what}"));
    }

    pub fn poll(&self) -> Vec<Event> {
        self.events.try_iter().collect()
    }
}

/// Le côté réseau d'une partie : hôte ou joueur.
pub enum Link {
    Host(Host),
    Client(Client),
}

impl Link {
    pub fn knocked_out(&mut self, what: &str) {
        match self {
            Link::Host(h) => h.knocked_out(what),
            Link::Client(c) => c.knocked_out(what),
        }
    }

    pub fn poll(&self) -> Vec<Event> {
        match self {
            Link::Host(h) => h.poll(),
            Link::Client(c) => c.poll(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wait<T>(mut f: impl FnMut() -> Option<T>) -> T {
        for _ in 0..200 {
            if let Some(v) = f() {
                return v;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("rien reçu");
    }

    #[test]
    fn a_knock_out_resets_everyone_and_is_kept_on_disk() {
        let root = std::env::temp_dir().join(format!("session-{}", std::process::id()));
        let session = Session { name: "potes".into(), seed: "42".into(), parts: vec!["sauvages".into()], ..Session::default() };
        let host = Host::start(&root, session, "Hôte", 47311).unwrap();
        // le launcher lit la session avant de lancer le jeu
        let lu = fetch("127.0.0.1:47311", "Kris").unwrap();
        assert_eq!((lu.seed.as_str(), lu.generation), ("42", 0));
        let (mut client, _) = Client::join("127.0.0.1:47311", "Kris").unwrap();
        wait(|| host.poll().into_iter().find(|e| matches!(e, Event::Players(p) if p.contains(&"Kris".to_string()))));
        client.knocked_out("Pikachu");
        let reset = wait(|| client.poll().into_iter().find(|e| matches!(e, Event::Reset { .. })));
        assert_eq!(reset, Event::Reset { generation: 1, message: "Kris a perdu Pikachu : tout le monde recommence".into() });
        assert!(wait(|| host.poll().into_iter().find(|e| matches!(e, Event::Reset { .. }))) == reset);
        // reprise plus tard : la génération est sur le disque
        assert_eq!(Session::load(&root, "potes").unwrap().generation, 1);
        assert_eq!(Session::load(&root, "potes").unwrap().mod_name().as_deref(), Some("random-42-sauvages"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
