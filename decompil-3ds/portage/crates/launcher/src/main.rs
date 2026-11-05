//! Le launcher : une application à part qui garde les réglages et lance `portage play` avec eux.
//!
//! Les réglages sont dans `local/portage/reglages.json` (ce fichier n'est pas versionné, comme tout `local/`).

#![cfg_attr(not(test), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use eframe::egui;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
enum CombatUi {
    /// L'écran du bas dans le coin en bas à droite.
    Corner,
    /// L'écran du bas seulement quand on ouvre le menu (Échap).
    Menu,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
enum Screens {
    /// L'écran du haut, l'écran du bas à la demande.
    Top,
    /// Les deux écrans l'un sur l'autre, comme sur la console.
    Both,
}

/// Jouer seul, héberger une session, ou en rejoindre une.
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
enum Multi {
    Solo,
    Host,
    Join,
}

/// Les parties du randomizer (`outils/randomizer.py`) : (nom, ce qu'on affiche).
const PARTS: [(&str, &str); 5] = [("sauvages", "Pokémon sauvages"), ("starters", "Starters et dons"), ("dresseurs", "Dresseurs"), ("objets", "Objets au sol"), ("capacites", "Capacités apprises")];

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    scale: u32,
    screens: Screens,
    combat: CombatUi,
    /// Le dossier du mod dans `local/mods-build`, s'il y en a un.
    game_mod: Option<String>,
    /// De 0 (pas de son) à 100.
    volume: u32,
    /// Le nom du filtre de texture pour `portage play`.
    texture_filter: String,
    /// L'image lissée en s'agrandissant à la fenêtre.
    smooth: bool,
    /// Une partie Archipelago : l'adresse (vide : aucune) et le nom du joueur.
    archipelago: String,
    player: String,
    /// Le pack de textures : un dossier de `local/mods-build/textures`.
    texture_pack: Option<String>,
    /// La partie à part, commencée de zéro, plutôt que celle de la console.
    new_game: bool,
    /// Le jeu avance tant de fois plus vite ; le son se coupe au-delà de 1.
    speed: u32,
    /// Le randomizer : la graine (vide : aucun) et ses parties cochées.
    seed: String,
    parts: Vec<String>,
    /// À plusieurs : seul, hôte (nom de session, règle) ou joueur (le code de session que l'hôte lui a donné).
    multi: Multi,
    session: String,
    address: String,
    nuzlocke: bool,
}

/// Les filtres de texture : (nom pour `portage play`, ce qu'on affiche).
const TEXTURE_FILTERS: [(&str, &str); 6] = [("aucun", "Aucun"), ("scale2x", "Scale2x"), ("mmpx", "MMPX"), ("bicubique", "Bicubique"), ("scaleforce", "ScaleForce"), ("anime4k", "Anime4K")];

impl Default for Settings {
    fn default() -> Settings {
        Settings {
            scale: 2,
            screens: Screens::Top,
            combat: CombatUi::Corner,
            game_mod: None,
            volume: 100,
            texture_filter: "aucun".to_string(),
            smooth: false,
            texture_pack: None,
            archipelago: String::new(),
            player: String::new(),
            new_game: false,
            speed: 1,
            seed: String::new(),
            parts: PARTS.iter().map(|p| p.0.to_string()).collect(),
            multi: Multi::Solo,
            session: "potes".to_string(),
            address: String::new(),
            nuzlocke: true,
        }
    }
}

impl Settings {
    /// Les arguments de `portage play`.
    fn arguments(&self, root: &Path) -> Vec<String> {
        let mut out = vec!["play".to_string(), "--scale".to_string(), self.scale.to_string()];
        out.extend(["--combat".to_string(), if self.combat == CombatUi::Corner { "coin" } else { "menu" }.to_string()]);
        out.extend(["--volume".to_string(), self.volume.to_string()]);
        out.extend(["--filtre-texture".to_string(), self.texture_filter.clone()]);
        if self.smooth {
            out.push("--lissage".to_string());
        }
        if self.screens == Screens::Both {
            out.extend(["--ecrans".to_string(), "deux".to_string()]);
        }
        if !self.archipelago.is_empty() {
            out.extend(["--archipelago".to_string(), self.archipelago.clone(), "--joueur".to_string(), self.player.clone()]);
        }
        if let Some(name) = &self.texture_pack {
            out.extend(["--textures".to_string(), root.join("local/mods-build/textures").join(name).display().to_string()]);
        }
        if let Some(name) = &self.game_mod {
            out.extend(["--mod".to_string(), root.join("local/mods-build").join(name).display().to_string()]);
        } else if self.texture_pack.as_deref() == Some("police-hd") && root.join("local/mods-build/jauge-hd/pc/overlay.json").is_file() {
            // les plaques de PV redessinées du pack vont avec la barre agrandie du mod
            out.extend(["--mod".to_string(), root.join("local/mods-build/jauge-hd/pc").display().to_string()]);
        }
        if self.new_game {
            out.push("--nouvelle-partie".to_string());
        }
        if self.speed > 1 {
            out.extend(["--vitesse".to_string(), self.speed.to_string()]);
        }
        out
    }
}

/// Le dossier du dépôt : celui qui contient `etat.json` et `banc`, en remontant depuis le programme.
fn find_root() -> PathBuf {
    let start = std::env::current_exe().unwrap_or_default();
    let found = start.ancestors().find(|dir| dir.join("etat.json").is_file() && dir.join("banc").is_dir());
    found.map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."))
}

/// Les packs de textures : les dossiers de `local/mods-build/textures`.
fn list_texture_packs(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root.join("local/mods-build/textures")) else { return Vec::new() };
    let mut names: Vec<String> = entries.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    names
}

/// Les mods construits : les dossiers de `local/mods-build` qui ont un `overlay.json`.
fn list_mods(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root.join("local/mods-build")) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().join("overlay.json").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

struct Launcher {
    root: PathBuf,
    settings: Settings,
    mods: Vec<String>,
    texture_packs: Vec<String>,
    game: Option<Child>,
    status: String,
    /// Le randomizer en construction, et les arguments du jeu à lancer ensuite.
    building: Option<(Child, Vec<String>)>,
}

/// Le dossier du mod du randomizer (le jeu lit sa sortie `pc`), avec ou sans la barre de PV agrandie.
fn random_mod(root: &Path, seed: &str, parts: &[String], jauge: bool) -> PathBuf {
    let name = format!("random-{seed}-{}{}", parts.join("-"), if jauge { "-jauge" } else { "" });
    root.join("local/mods-build").join(name)
}

impl Launcher {
    fn settings_path(&self) -> PathBuf {
        self.root.join("local/portage/reglages.json")
    }

    fn play(&mut self) {
        if let Err(e) = save(&self.settings_path(), &self.settings) {
            self.status = format!("réglages non écrits : {e}");
            return;
        }
        match self.prepare() {
            Ok(Some(arguments)) => self.launch(arguments),
            Ok(None) => {}
            Err(e) => self.status = e,
        }
    }

    /// Les arguments du jeu : la session (créée par l'hôte, lue chez l'hôte par un joueur) et le mod du randomizer de sa
    /// graine. `None` : le randomizer se construit d'abord (`building`), le jeu partira ensuite.
    fn prepare(&mut self) -> Result<Option<Vec<String>>, String> {
        let s = &self.settings;
        let mut arguments = s.arguments(&self.root);
        let player = if s.player.is_empty() { "Joueur".to_string() } else { s.player.clone() };
        let (seed, parts) = match s.multi {
            Multi::Solo => (s.seed.clone(), s.parts.clone()),
            Multi::Host => {
                let session = session::Session::load(&self.root, &s.session).unwrap_or_else(|| session::Session {
                    name: s.session.clone(),
                    seed: s.seed.clone(),
                    parts: s.parts.clone(),
                    rule: if s.nuzlocke { session::Rule::Nuzlocke } else { session::Rule::Free },
                    ..Default::default()
                });
                session.save(&self.root)?;
                arguments.extend(["--session".into(), s.session.clone(), "--joueur".into(), player, "--heberger".into()]);
                (session.seed, session.parts)
            }
            Multi::Join => {
                // l'hôte relance peut-être (quelqu'un a perdu un Pokémon) : quelques essais
                let mut found = Err(String::new());
                for _ in 0..10 {
                    found = session::fetch(&s.address, &player, session::Relays::Public);
                    if found.is_ok() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
                let host = found.map_err(|e| format!("hôte injoignable : {e}"))?;
                arguments.extend(["--session".into(), host.name.clone(), "--joueur".into(), player, "--rejoindre".into(), s.address.clone()]);
                (host.seed, host.parts)
            }
        };
        if seed.is_empty() {
            return Ok(Some(arguments));
        }
        let jauge = s.texture_pack.as_deref() == Some("police-hd");
        let folder = random_mod(&self.root, &seed, &parts, jauge);
        // le mod du randomizer remplace celui des réglages
        if let Some(i) = arguments.iter().position(|a| a == "--mod") {
            arguments.drain(i..i + 2);
        }
        arguments.extend(["--mod".into(), folder.join("pc").display().to_string()]);
        if folder.join("pc/overlay.json").is_file() {
            return Ok(Some(arguments));
        }
        let mut build = vec!["outils/randomizer.py".to_string(), seed.clone()];
        build.extend(parts.iter().cloned());
        if jauge {
            build.push("--jauge".into());
        }
        build.extend(["--sortie".into(), folder.display().to_string()]);
        let child = Command::new("python").args(&build).current_dir(&self.root).spawn().map_err(|e| format!("python : {e}"))?;
        self.building = Some((child, arguments));
        self.status = format!("Construction du randomizer (graine {seed})…");
        Ok(None)
    }

    fn launch(&mut self, arguments: Vec<String>) {
        let name = if cfg!(windows) { "portage.exe" } else { "portage" };
        let program = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(name))).unwrap_or_else(|| PathBuf::from(name));
        match Command::new(&program).args(&arguments).current_dir(self.root.join("portage")).spawn() {
            Ok(child) => {
                self.game = Some(child);
                self.status = "Le jeu est lancé.".to_string();
            }
            Err(e) => self.status = format!("{} : {e}", program.display()),
        }
    }

    /// Le randomizer fini : lancer le jeu. Le jeu sorti pour recommencer (code 3) : le relancer, sur une partie neuve.
    fn follow(&mut self) {
        if let Some((child, _)) = self.building.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let (_, arguments) = self.building.take().unwrap();
                    if status.success() {
                        self.launch(arguments);
                    } else {
                        self.status = "Le randomizer a échoué (voir la console).".to_string();
                    }
                }
                Ok(None) => {}
                Err(e) => self.status = e.to_string(),
            }
        }
        if let Some(Ok(Some(status))) = self.game.as_mut().map(|g| g.try_wait()) {
            self.game = None;
            if status.code() == Some(3) {
                self.status = "Un Pokémon est tombé : tout le monde recommence.".to_string();
                match self.prepare() {
                    Ok(Some(arguments)) => self.launch(arguments),
                    Ok(None) => {}
                    Err(e) => self.status = e,
                }
            }
        }
    }

    /// Repartir de la sauvegarde d'origine : le prochain lancement la recopie.
    fn reset_save(&mut self) {
        let archives = self.root.join("local/analyse/runtime/play/archives");
        self.status = match std::fs::remove_dir_all(&archives) {
            Ok(()) => "La partie du portage est effacée : le prochain lancement repart de la sauvegarde d'origine.".to_string(),
            Err(e) => format!("{} : {e}", archives.display()),
        };
    }
}

impl eframe::App for Launcher {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.follow();
        ui.ctx().request_repaint_after(std::time::Duration::from_millis(500));
        let running = self.building.is_some() || self.game.as_mut().is_some_and(|g| matches!(g.try_wait(), Ok(None)));
        egui::CentralPanel::default().show(ui, |ui| {
            ui.heading("Pokémon X");
            ui.add_space(8.0);
            egui::Grid::new("reglages").num_columns(2).spacing([16.0, 8.0]).show(ui, |ui| {
                ui.label("Échelle de rendu");
                ui.horizontal(|ui| {
                    for scale in 1..=4 {
                        ui.radio_value(&mut self.settings.scale, scale, format!("{scale}x"));
                    }
                });
                ui.end_row();
                ui.label("Filtre de texture");
                ui.horizontal(|ui| {
                    for (name, label) in TEXTURE_FILTERS {
                        ui.radio_value(&mut self.settings.texture_filter, name.to_string(), label);
                    }
                });
                ui.end_row();
                ui.label("Pack de textures");
                let current = self.settings.texture_pack.clone().unwrap_or_else(|| "Aucun".to_string());
                egui::ComboBox::from_id_salt("textures").selected_text(current).show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.settings.texture_pack, None, "Aucun");
                    for name in &self.texture_packs {
                        ui.selectable_value(&mut self.settings.texture_pack, Some(name.clone()), name);
                    }
                });
                ui.end_row();
                ui.label("Affichage");
                ui.checkbox(&mut self.settings.smooth, "Lissé");
                ui.end_row();
                ui.label("Écrans");
                ui.horizontal(|ui| {
                    ui.radio_value(&mut self.settings.screens, Screens::Top, "Haut seul (Échap : écran du bas)");
                    ui.radio_value(&mut self.settings.screens, Screens::Both, "Les deux");
                });
                ui.end_row();
                ui.label("Interface de combat");
                ui.horizontal(|ui| {
                    ui.radio_value(&mut self.settings.combat, CombatUi::Corner, "Dans le coin");
                    ui.radio_value(&mut self.settings.combat, CombatUi::Menu, "Avec Échap");
                });
                ui.end_row();
                ui.label("Volume");
                ui.add(egui::Slider::new(&mut self.settings.volume, 0..=100));
                ui.end_row();
                ui.label("Vitesse");
                ui.add(egui::Slider::new(&mut self.settings.speed, 1..=5).suffix(" x"));
                ui.end_row();
                ui.label("Partie");
                ui.checkbox(&mut self.settings.new_game, "À part, commencée de zéro");
                ui.end_row();
                ui.label("Archipelago");
                ui.horizontal(|ui| {
                    ui.add(egui::TextEdit::singleline(&mut self.settings.archipelago).hint_text("adresse:port").desired_width(170.0));
                    ui.add(egui::TextEdit::singleline(&mut self.settings.player).hint_text("joueur").desired_width(110.0));
                });
                ui.end_row();
                ui.label("Randomizer");
                ui.horizontal(|ui| {
                    ui.add(egui::TextEdit::singleline(&mut self.settings.seed).hint_text("graine (vide : aucun)").desired_width(140.0));
                    if ui.button("Nouvelle graine").clicked() {
                        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
                        self.settings.seed = format!("{}", (t as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) % 1_000_000);
                    }
                });
                ui.end_row();
                ui.label("");
                ui.horizontal_wrapped(|ui| {
                    for (name, label) in PARTS {
                        let mut on = self.settings.parts.iter().any(|p| p == name);
                        if ui.checkbox(&mut on, label).changed() {
                            self.settings.parts.retain(|p| p != name);
                            if on {
                                self.settings.parts.push(name.to_string());
                                self.settings.parts.sort_by_key(|p| PARTS.iter().position(|q| q.0 == p));
                            }
                        }
                    }
                });
                ui.end_row();
                ui.label("À plusieurs");
                ui.horizontal(|ui| {
                    ui.radio_value(&mut self.settings.multi, Multi::Solo, "Seul");
                    ui.radio_value(&mut self.settings.multi, Multi::Host, "Héberger");
                    ui.radio_value(&mut self.settings.multi, Multi::Join, "Rejoindre");
                });
                ui.end_row();
                match self.settings.multi {
                    Multi::Solo => {}
                    Multi::Host => {
                        ui.label("");
                        ui.horizontal(|ui| {
                            ui.add(egui::TextEdit::singleline(&mut self.settings.session).hint_text("session").desired_width(110.0));
                            ui.checkbox(&mut self.settings.nuzlocke, "Nuzlocke : un K.O., tout le monde recommence");
                        });
                        ui.end_row();
                        // le code que le jeu de l'hôte écrit au lancement : à envoyer aux potes
                        ui.label("Code");
                        match session::Session::code(&self.root, &self.settings.session) {
                            Some(code) => {
                                ui.horizontal(|ui| {
                                    ui.label(format!("{}…", code.chars().take(24).collect::<String>()));
                                    if ui.button("Copier le code").clicked() {
                                        ui.ctx().copy_text(code.clone());
                                        self.status = "Code copié : envoie-le à tes potes.".to_string();
                                    }
                                });
                            }
                            None => {
                                ui.label("lance la partie : le code apparaît ici");
                            }
                        }
                        ui.end_row();
                    }
                    Multi::Join => {
                        ui.label("");
                        ui.add(egui::TextEdit::singleline(&mut self.settings.address).hint_text("code de session de l'hôte (coller)").desired_width(300.0));
                        ui.end_row();
                    }
                }
                ui.label("Mod");
                let current = self.settings.game_mod.clone().unwrap_or_else(|| "Aucun".to_string());
                egui::ComboBox::from_id_salt("mod").selected_text(current).show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.settings.game_mod, None, "Aucun");
                    for name in &self.mods {
                        ui.selectable_value(&mut self.settings.game_mod, Some(name.clone()), name);
                    }
                });
                ui.end_row();
            });
            ui.add_space(12.0);
            ui.horizontal(|ui| {
                if ui.add_enabled(!running, egui::Button::new("Jouer")).clicked() {
                    self.play();
                }
                if ui.add_enabled(!running, egui::Button::new("Repartir de la sauvegarde d'origine")).clicked() {
                    self.reset_save();
                }
            });
            ui.add_space(8.0);
            ui.label(&self.status);
        });
    }
}

fn main() -> eframe::Result {
    let root = find_root();
    let settings = load(&root.join("local/portage/reglages.json"));
    let mods = list_mods(&root);
    let texture_packs = list_texture_packs(&root);
    let app = Launcher { root, settings, mods, texture_packs, game: None, status: String::new(), building: None };
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([640.0, 560.0]),
        ..Default::default()
    };
    eframe::run_native("Pokémon X", options, Box::new(|_| Ok(Box::new(app))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_follow_the_settings() {
        let root = Path::new("R");
        assert_eq!(Settings::default().arguments(root), ["play", "--scale", "2", "--combat", "coin", "--volume", "100", "--filtre-texture", "aucun"]);
        let settings = Settings { scale: 4, screens: Screens::Both, combat: CombatUi::Menu, game_mod: Some("pc".into()), volume: 30, texture_filter: "mmpx".into(), smooth: true, texture_pack: None, archipelago: "h:1".into(), player: "K".into(), ..Settings::default() };
        let arguments = settings.arguments(root);
        assert_eq!(&arguments[..16], ["play", "--scale", "4", "--combat", "menu", "--volume", "30", "--filtre-texture", "mmpx", "--lissage", "--ecrans", "deux", "--archipelago", "h:1", "--joueur", "K"]);
        assert_eq!(arguments[16], "--mod");
        assert!(arguments[17].ends_with("pc"));
        let fast = Settings { new_game: true, speed: 5, ..Settings::default() }.arguments(root);
        assert!(fast.ends_with(&["--nouvelle-partie".to_string(), "--vitesse".to_string(), "5".to_string()]));
    }

    #[test]
    fn settings_survive_a_file_and_a_missing_field() {
        let path = std::env::temp_dir().join(format!("reglages-{}/r.json", std::process::id()));
        let settings = Settings { scale: 3, screens: Screens::Both, combat: CombatUi::Menu, game_mod: Some("x".into()), volume: 7, texture_filter: "mmpx".into(), smooth: true, texture_pack: Some("hd".into()), archipelago: String::new(), player: String::new(), ..Settings::default() };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
        std::fs::write(&path, r#"{"scale": 1}"#).unwrap();
        assert_eq!(load(&path), Settings { scale: 1, ..Settings::default() });
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert_eq!(load(&path), Settings::default());
    }
}
