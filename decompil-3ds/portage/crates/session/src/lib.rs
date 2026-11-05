//! Les parties à plusieurs, à distance : une session (graine du randomizer, règle, génération) gardée sur le disque, un hôte
//! qui l'annonce, des joueurs qui s'y joignent par son code de session, sans ouvrir de port.
//!
//! La règle « nuzlocke » : quand un Pokémon d'un joueur est K.O., tout le monde recommence une partie neuve, avec la même
//! graine. La génération compte ces recommencements ; un joueur qui revient plus tard avec une génération en retard
//! recommence aussi. On quitte et on reprend quand on veut : la session et la partie de chacun restent sur son disque.
//!
//! Réseau : iroh (crate `iroh`, MIT ou Apache-2.0). Le code de session est le ticket iroh de l'hôte (son identifiant, son
//! relais, ses adresses) ; iroh relie les PC directement à travers les box quand il peut, sinon par les relais publics de
//! n0 (gratuits, limités en débit, prévus pour les petits projets, sans garantie). La clé de l'hôte est gardée dans le
//! dossier de la session : il garde son identité d'un lancement à l'autre, et ses potes le retrouvent avec le même code.
//!
//! Protocole : un flux QUIC dans les deux sens par joueur, une ligne de texte par message (UTF-8).
//! - joueur -> hôte : `bonjour <nom>`, `ko <nom> <texte>` ;
//! - hôte -> joueur : `session <JSON>` (en réponse à bonjour), `recommencer <génération> <message>`, `joueurs <noms, ...>`.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use iroh::endpoint::{RecvStream, SendStream, presets};
use iroh::{Endpoint, SecretKey};
use iroh_tickets::endpoint::EndpointTicket;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader, Lines};
use tokio::runtime::Runtime;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

/// Le protocole des sessions, pour iroh.
const ALPN: &[u8] = b"pokemon-x/session/1";

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

    /// Le code de session que l'hôte a écrit au lancement (`code.txt`), à donner aux potes.
    pub fn code(root: &Path, name: &str) -> Option<String> {
        std::fs::read_to_string(Self::folder(root, name).join("code.txt")).ok().map(|c| c.trim().to_string())
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

/// Les relais : ceux de n0 en vrai, aucun dans les tests (deux points sur la même machine).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Relays {
    Public,
    None,
}

fn runtime() -> Result<Runtime, String> {
    tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().map_err(|e| e.to_string())
}

async fn endpoint(key: Option<SecretKey>, accept: bool, relays: Relays) -> Result<Endpoint, String> {
    let builder = match relays {
        Relays::Public => Endpoint::builder(presets::N0),
        Relays::None => Endpoint::builder(presets::Minimal),
    };
    let builder = if let Some(key) = key { builder.secret_key(key) } else { builder };
    let builder = if accept { builder.alpns(vec![ALPN.to_vec()]) } else { builder };
    let endpoint = builder.bind().await.map_err(|e| format!("réseau : {e}"))?;
    if relays == Relays::Public {
        // le relais connu : sans lui le code ne dit pas comment joindre l'hôte derrière sa box
        let _ = tokio::time::timeout(Duration::from_secs(10), endpoint.online()).await;
    }
    Ok(endpoint)
}

/// La clé de l'hôte de cette session (32 octets dans `cle-hote`), créée la première fois.
fn host_key(root: &Path, name: &str) -> Result<SecretKey, String> {
    let path = Session::folder(root, name).join("cle-hote");
    if let Some(bytes) = std::fs::read(&path).ok().and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok()) {
        return Ok(SecretKey::from_bytes(&bytes));
    }
    let key = SecretKey::generate();
    std::fs::create_dir_all(Session::folder(root, name)).map_err(|e| e.to_string())?;
    std::fs::write(&path, key.to_bytes()).map_err(|e| e.to_string())?;
    Ok(key)
}

async fn send_line(send: &mut SendStream, text: &str) -> Result<(), String> {
    send.write_all(format!("{}\n", text.replace('\n', " ")).as_bytes()).await.map_err(|e| e.to_string())
}

/// L'hôte : il garde la session (et l'écrit à chaque changement), répond aux joueurs et leur envoie les recommencements.
pub struct Host {
    shared: Arc<Mutex<HostState>>,
    events: Receiver<Event>,
    code: String,
    _endpoint: Endpoint,
    _runtime: Runtime,
}

struct HostState {
    root: PathBuf,
    session: Session,
    me: String,
    /// Les joueurs connectés : nom, numéro de connexion, la file de ce qu'on lui écrit.
    clients: Vec<(String, u64, UnboundedSender<String>)>,
    events: Sender<Event>,
}

impl HostState {
    fn broadcast(&mut self, text: &str) {
        self.clients.retain(|(_, _, tx)| tx.send(text.to_string()).is_ok());
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
    /// Ouvre la session : le code à donner aux potes est aussi écrit dans `code.txt` de son dossier.
    pub fn start(root: &Path, session: Session, me: &str, relays: Relays) -> Result<Host, String> {
        let runtime = runtime()?;
        let key = host_key(root, &session.name)?;
        let endpoint = runtime.block_on(endpoint(Some(key), true, relays))?;
        let code = EndpointTicket::new(endpoint.addr()).to_string();
        std::fs::write(Session::folder(root, &session.name).join("code.txt"), &code).map_err(|e| e.to_string())?;
        let (tx, rx) = channel();
        let shared = Arc::new(Mutex::new(HostState { root: root.to_path_buf(), session, me: me.to_string(), clients: Vec::new(), events: tx }));
        let accept = endpoint.clone();
        let state = shared.clone();
        runtime.spawn(async move {
            let mut next = 0u64;
            while let Some(incoming) = accept.accept().await {
                next += 1;
                let (state, id) = (state.clone(), next);
                tokio::spawn(async move {
                    let Ok(connection) = incoming.await else { return };
                    let Ok((send, recv)) = connection.accept_bi().await else { return };
                    serve(state, id, send, recv).await;
                });
            }
        });
        shared.lock().unwrap().players();
        Ok(Host { shared, events: rx, code, _endpoint: endpoint, _runtime: runtime })
    }

    /// Le code de session à donner aux potes.
    pub fn code(&self) -> &str {
        &self.code
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
async fn serve(state: Arc<Mutex<HostState>>, id: u64, mut send: SendStream, recv: RecvStream) {
    let (tx, mut rx) = unbounded_channel::<String>();
    // ce qu'on écrit à ce joueur passe par une file : la session n'attend jamais le réseau
    tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            if send_line(&mut send, &text).await.is_err() {
                break;
            }
        }
    });
    let mut joined = false;
    let mut lines = BufReader::new(recv).lines();
    while let Ok(Some(text)) = lines.next_line().await {
        let (word, rest) = text.split_once(' ').unwrap_or((&text, ""));
        let mut s = state.lock().unwrap();
        match word {
            "bonjour" => {
                let session = serde_json::to_string(&s.session).unwrap_or_default();
                let _ = tx.send(format!("session {session}"));
                s.clients.push((rest.to_string(), id, tx.clone()));
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
        s.clients.retain(|(_, c, _)| *c != id);
        s.players();
    }
}

/// Un joueur : connecté à l'hôte par son code, il reçoit la session puis les recommencements.
pub struct Client {
    send: Arc<tokio::sync::Mutex<SendStream>>,
    events: Receiver<Event>,
    me: String,
    _endpoint: Endpoint,
    runtime: Runtime,
}

/// Se connecter à l'hôte du code et dire bonjour : (point iroh, flux, lignes reçues, la session de la première ligne).
async fn hello(code: &str, me: &str, relays: Relays) -> Result<(Endpoint, SendStream, Lines<BufReader<RecvStream>>, Session), String> {
    let ticket: EndpointTicket = code.trim().parse().map_err(|e| format!("code de session illisible : {e}"))?;
    let endpoint = endpoint(None, false, relays).await?;
    let connection = tokio::time::timeout(Duration::from_secs(20), endpoint.connect(ticket, ALPN))
        .await
        .map_err(|_| "l'hôte ne répond pas (20 s)".to_string())?
        .map_err(|e| format!("hôte injoignable : {e}"))?;
    let (mut send, recv) = connection.open_bi().await.map_err(|e| e.to_string())?;
    send_line(&mut send, &format!("bonjour {me}")).await?;
    let mut lines = BufReader::new(recv).lines();
    let first = tokio::time::timeout(Duration::from_secs(10), lines.next_line())
        .await
        .map_err(|_| "l'hôte n'a pas envoyé la session".to_string())?
        .map_err(|e| e.to_string())?
        .ok_or("l'hôte a fermé la connexion")?;
    let json = first.strip_prefix("session ").ok_or("l'hôte n'a pas envoyé la session")?;
    let session = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok((endpoint, send, lines, session))
}

/// La session de l'hôte, lue une fois (le launcher en a besoin pour construire le mod avant de lancer le jeu).
pub fn fetch(code: &str, me: &str, relays: Relays) -> Result<Session, String> {
    let runtime = runtime()?;
    runtime.block_on(async {
        let (endpoint, mut send, _, session) = hello(code, me, relays).await?;
        let _ = send.finish();
        endpoint.close().await;
        Ok(session)
    })
}

impl Client {
    pub fn join(code: &str, me: &str, relays: Relays) -> Result<(Client, Session), String> {
        let runtime = runtime()?;
        let (endpoint, send, mut lines, session) = runtime.block_on(hello(code, me, relays))?;
        let (tx, rx) = channel();
        runtime.spawn(async move {
            while let Ok(Some(text)) = lines.next_line().await {
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
        let send = Arc::new(tokio::sync::Mutex::new(send));
        Ok((Client { send, events: rx, me: me.to_string(), _endpoint: endpoint, runtime }, session))
    }

    pub fn knocked_out(&mut self, what: &str) {
        let (send, text) = (self.send.clone(), format!("ko {} {what}", self.me));
        self.runtime.spawn(async move {
            let _ = send_line(&mut *send.lock().await, &text).await;
        });
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
        for _ in 0..500 {
            if let Some(v) = f() {
                return v;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("rien reçu");
    }

    #[test]
    fn a_knock_out_resets_everyone_and_is_kept_on_disk() {
        // deux points iroh sur cette machine, sans relais : le code porte les adresses locales de l'hôte
        let root = std::env::temp_dir().join(format!("session-{}", std::process::id()));
        let session = Session { name: "potes".into(), seed: "42".into(), parts: vec!["sauvages".into()], ..Session::default() };
        let host = Host::start(&root, session, "Hôte", Relays::None).unwrap();
        let code = Session::code(&root, "potes").unwrap();
        assert_eq!(code, host.code());
        // le launcher lit la session avant de lancer le jeu
        let lu = fetch(&code, "Kris", Relays::None).unwrap();
        assert_eq!((lu.seed.as_str(), lu.generation), ("42", 0));
        let (mut client, _) = Client::join(&code, "Kris", Relays::None).unwrap();
        wait(|| host.poll().into_iter().find(|e| matches!(e, Event::Players(p) if p.contains(&"Kris".to_string()))));
        client.knocked_out("Pikachu");
        let reset = wait(|| client.poll().into_iter().find(|e| matches!(e, Event::Reset { .. })));
        assert_eq!(reset, Event::Reset { generation: 1, message: "Kris a perdu Pikachu : tout le monde recommence".into() });
        assert!(wait(|| host.poll().into_iter().find(|e| matches!(e, Event::Reset { .. }))) == reset);
        // reprise plus tard : la génération est sur le disque, et l'hôte garde son identité (sa clé)
        assert_eq!(Session::load(&root, "potes").unwrap().generation, 1);
        assert_eq!(Session::load(&root, "potes").unwrap().mod_name().as_deref(), Some("random-42-sauvages"));
        assert_eq!(host_key(&root, "potes").unwrap().public(), host_key(&root, "potes").unwrap().public());
        drop(client);
        drop(host);
        let _ = std::fs::remove_dir_all(&root);
    }
}
