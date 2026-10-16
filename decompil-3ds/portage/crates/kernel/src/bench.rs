//! L'état du « banc » partagé entre le noyau et les services : chemins, options, repères du démarrage et paliers
//! (même rôle que les rappels `on_*` et `check_milestones` de `banc/bench.py`).

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::kernel::Kernel;

// Repères du démarrage (pokemon-x-services.md, partie 4).
pub const ENTRY: u32 = 0x100000;
pub const MAIN: u32 = 0x106138;
pub const GAME_INIT_SYSTEMS: u32 = 0x107CBC;
pub const MAIN_LOOP: u32 = 0x1066EC;
pub const MAIN_LOOP_TURN: u32 = 0x106710;

pub const APT_STARTUP: [&str; 9] = ["GetLockHandle", "Initialize", "Enable", "NotifyToWait", "GlanceParameter",
    "ReceiveParameter", "AppletUtility(7)", "AppletUtility(4)", "GetSharedFont"];

/// Les chemins des données de la console (tous sous `local/`, jamais versionnés).
#[derive(Default, Clone)]
pub struct Paths {
    pub code: PathBuf,
    pub exheader: PathBuf,
    pub exefs: PathBuf,
    pub romfs_base: PathBuf,
    pub romfs_update: PathBuf,
    pub config: PathBuf,
    pub font: PathBuf,
    pub save: PathBuf,
    pub extdata: PathBuf,
    pub out: PathBuf,
    pub archives: PathBuf,
    /// Un dossier de sortie `mods/build.py --pc` (overlay.json + romfs/).
    pub overlay: Option<PathBuf>,
}

#[derive(Default)]
pub struct BenchState {
    pub paths: Paths,
    /// (début en s, durée en s, masque de boutons)
    pub presses: Vec<(f64, f64, u32)>,
    pub region: u32,
    pub gsp_first_result: u32,
    pub apt_answers: Vec<String>,
    pub files_opened: Vec<(u64, u32, String)>,
    pub romfs_reads: u64,
    pub cros: Vec<(u64, String, u32)>,
    pub ro_steps: Vec<String>,
    pub command_lists: u64,
    pub vblanks: u64,
    /// L'heure (ns) de la dernière fin d'image : la suivante tombe `VBLANK_NS` plus tard.
    pub last_vblank: u64,
    pub lcd_unblacked: Option<u64>,
    pub loop_turns: u64,
    pub stop_request: Option<String>,
    pub events: Vec<(u64, String)>,
    pub stats: BTreeMap<String, u64>,
    pub start_milliseconds: u64,
    /// Les boutons tenus en direct (le clavier de la fenêtre), en plus des appuis programmés.
    pub buttons: u32,
    pub turns_limit: u64,
}

impl BenchState {
    pub fn stat(&mut self, key: &str, add: u64) {
        *self.stats.entry(key.to_string()).or_insert(0) += add;
    }
}

impl Kernel {
    pub fn note(&mut self, text: &str) {
        let now = self.now;
        self.journal.note(now, text);
    }

    pub fn note_event(&mut self, text: &str) {
        let now = self.now;
        self.bench.events.push((now, text.to_string()));
        self.journal.write(now, text);
    }

    pub fn request_stop(&mut self, text: &str) {
        self.bench.stop_request = Some(text.to_string());
    }

    pub fn on_apt_answer(&mut self, name: &str) {
        self.bench.apt_answers.push(name.to_string());
        self.check_milestones();
    }

    pub fn on_file_open(&mut self, archive_id: u32, label: &str) {
        let now = self.now;
        self.bench.files_opened.push((now, archive_id, label.to_string()));
        self.check_milestones();
    }

    pub fn on_file_read(&mut self, label: &str) {
        if label.starts_with("romfs") {
            self.bench.romfs_reads += 1;
        }
        self.check_milestones();
    }

    pub fn on_ro(&mut self, step: &str) {
        self.bench.ro_steps.push(step.to_string());
        self.check_milestones();
    }

    pub fn on_cro_loaded(&mut self, name: &str, address: u32) {
        let now = self.now;
        self.bench.cros.push((now, name.to_string(), address));
        // le processeur natif branche le C recompilé du module, s'il en a un pour ce code exact
        self.cpu.module_loaded(name, address, &self.memory);
        self.check_milestones();
    }

    pub fn on_gsp_registered(&mut self) {
        self.note_event("gsp : le jeu est inscrit au relais des interruptions ; fins d'image toutes les 1/60 s");
    }

    pub fn on_command_list(&mut self) {
        self.bench.command_lists += 1;
        self.check_milestones();
    }

    pub fn on_lcd_force_black(&mut self, value: u32) {
        if value == 0 && self.bench.lcd_unblacked.is_none() {
            self.bench.lcd_unblacked = Some(self.now);
            self.note_event("SetLcdForceBlack(0) : sur la console, l'image deviendrait visible ici");
        }
    }

    pub fn buttons_now(&self) -> u32 {
        let seconds = self.now as f64 / 1e9;
        let mut mask = self.bench.buttons;
        for &(start, duration, bits) in &self.bench.presses {
            if start <= seconds && seconds < start + duration {
                mask |= bits;
            }
        }
        mask
    }

    pub fn reached(&mut self, key: &str, text: &str) {
        if !self.journal.has_milestone(key) {
            let now = self.now;
            self.journal.milestone(now, key, text);
            self.check_milestones();
        }
    }

    pub fn loop_turn(&mut self) {
        self.bench.loop_turns += 1;
        let n = self.bench.loop_turns;
        if n <= 5 || n % 100 == 0 {
            let now = self.now;
            self.journal.write(now, &format!("boucle principale : tour {n}"));
        }
        self.check_milestones();
    }

    /// Les paliers P1 à P5 (README du banc).
    pub fn check_milestones(&mut self) {
        let now = self.now;
        let has = |k: &Kernel, key: &str| k.journal.has_milestone(key);
        if !has(self, "P1") && self.bench.apt_answers.iter().any(|a| a == "GetLockHandle") {
            self.journal.milestone(now, "P1", "entry tourne ; srv: et APT:U ont répondu (GetLockHandle)");
        }
        if !has(self, "P2")
            && APT_STARTUP.iter().all(|a| self.bench.apt_answers.iter().any(|x| x == a))
            && has(self, "main")
            && has(self, "install")
        {
            self.journal.milestone(now, "P2", "les neuf réponses d'APT sont passées ; main et game_init_systems atteints");
        }
        if !has(self, "P3")
            && self.bench.romfs_reads > 0
            && self.bench.ro_steps.iter().any(|s| s == "Initialize")
            && self.bench.ro_steps.iter().any(|s| s == "LoadCRR")
            && !self.bench.cros.is_empty()
        {
            let text = format!("romfs ouvert et lu, static.crs et static.crr donnés à ro, premier .cro chargé ({})",
                self.bench.cros[0].1);
            self.journal.milestone(now, "P3", &text);
        }
        if !has(self, "P4") && self.bench.loop_turns >= 3 {
            let text = format!("la boucle principale a fait {} tours", self.bench.loop_turns);
            self.journal.milestone(now, "P4", &text);
        }
        if !has(self, "P5") && self.bench.command_lists > 0 {
            self.journal.milestone(now, "P5", "première liste de commandes PICA envoyée par la file de gsp::Gpu");
        }
    }

    pub fn highest_milestone(&self) -> &'static str {
        let mut best = "aucun";
        for p in ["P1", "P2", "P3", "P4", "P5"] {
            if !self.journal.has_milestone(p) {
                break;
            }
            best = p;
        }
        best
    }

    /// Pose les repères du démarrage (`watch_milestones` du banc).
    pub fn watch_milestones(&mut self) -> Result<(), String> {
        use std::rc::Rc;
        self.watch(MAIN, true, Rc::new(|k: &mut Kernel, _| k.reached("main", "main (0x106138) atteint")))?;
        self.watch(GAME_INIT_SYSTEMS, true,
            Rc::new(|k: &mut Kernel, _| k.reached("install", "game_init_systems (0x107cbc) atteint")))?;
        self.watch(MAIN_LOOP, true, Rc::new(|k: &mut Kernel, _| k.reached("loop", "main_loop (0x1066ec) atteint")))?;
        self.watch(MAIN_LOOP_TURN, false, Rc::new(|k: &mut Kernel, _| k.loop_turn()))?;
        Ok(())
    }
}
