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

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    scale: u32,
    screens: Screens,
    combat: CombatUi,
    /// Le dossier du mod dans `local/mods-build`, s'il y en a un.
    game_mod: Option<String>,
}

impl Default for Settings {
    fn default() -> Settings {
        Settings { scale: 2, screens: Screens::Top, combat: CombatUi::Corner, game_mod: None }
    }
}

impl Settings {
    /// Les arguments de `portage play`.
    fn arguments(&self, root: &Path) -> Vec<String> {
        let mut out = vec!["play".to_string(), "--scale".to_string(), self.scale.to_string()];
        out.extend(["--combat".to_string(), if self.combat == CombatUi::Corner { "coin" } else { "menu" }.to_string()]);
        if self.screens == Screens::Both {
            out.extend(["--ecrans".to_string(), "deux".to_string()]);
        }
        if let Some(name) = &self.game_mod {
            out.extend(["--mod".to_string(), root.join("local/mods-build").join(name).display().to_string()]);
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
    game: Option<Child>,
    status: String,
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
        let name = if cfg!(windows) { "portage.exe" } else { "portage" };
        let program = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(name))).unwrap_or_else(|| PathBuf::from(name));
        match Command::new(&program).args(self.settings.arguments(&self.root)).current_dir(self.root.join("portage")).spawn() {
            Ok(child) => {
                self.game = Some(child);
                self.status = "Le jeu est lancé.".to_string();
            }
            Err(e) => self.status = format!("{} : {e}", program.display()),
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
        let running = self.game.as_mut().is_some_and(|g| matches!(g.try_wait(), Ok(None)));
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
    let app = Launcher { root, settings, mods, game: None, status: String::new() };
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([520.0, 260.0]),
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
        assert_eq!(Settings::default().arguments(root), ["play", "--scale", "2", "--combat", "coin"]);
        let settings = Settings { scale: 4, screens: Screens::Both, combat: CombatUi::Menu, game_mod: Some("pc".into()) };
        let arguments = settings.arguments(root);
        assert_eq!(&arguments[..7], ["play", "--scale", "4", "--combat", "menu", "--ecrans", "deux"]);
        assert_eq!(arguments[7], "--mod");
        assert!(arguments[8].ends_with("pc"));
    }

    #[test]
    fn settings_survive_a_file_and_a_missing_field() {
        let path = std::env::temp_dir().join(format!("reglages-{}/r.json", std::process::id()));
        let settings = Settings { scale: 3, screens: Screens::Both, combat: CombatUi::Menu, game_mod: Some("x".into()) };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
        std::fs::write(&path, r#"{"scale": 1}"#).unwrap();
        assert_eq!(load(&path), Settings { scale: 1, ..Settings::default() });
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert_eq!(load(&path), Settings::default());
    }
}
