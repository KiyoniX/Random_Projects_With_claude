//! L'état du « banc » partagé entre le noyau et les services : chemins, options, repères du démarrage et paliers
//! (même rôle que les rappels `on_*` et `check_milestones` de `banc/bench.py`).

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::cpu::Reg;
use crate::kernel::Kernel;

// Repères du démarrage (pokemon-x-services.md, partie 4).
pub const ENTRY: u32 = 0x100000;
pub const MAIN: u32 = 0x106138;
pub const GAME_INIT_SYSTEMS: u32 = 0x107CBC;
pub const MAIN_LOOP: u32 = 0x1066EC;
pub const MAIN_LOOP_TURN: u32 = 0x106710;
/// Appelée à chaque tour de la boucle du terrain avec r0 = le terrain, dans DllField au miroir 0x6a9000.
const FIELD_TURN: u32 = 0x6a9000 + 0x2fa4c;
/// `amx_exec` : r0 l'AMX, r2 la fonction à lancer.
const AMX_EXEC: u32 = 0x4cd938;
/// Le hachage du nom `g_mode` dans la table des variables publiques (c ^ (h * 0x83)).
const G_MODE_HASH: u32 = 0xd7477c97;
/// Le pointeur vers l'objet qui porte le numéro de la zone courante, à +0x38.
const ZONE_HOLDER: u32 = 0x5b1748;
// Décalages dans DllBattle des guets du combat (local/analyse/DllBattle/capacites.md).
/// Appelée une seule fois par capacité lancée, à la fin de la fonction qui la déroule (DllBattle+0x1b028, seul appel en
/// +0x1bda4) : r1 la capacité vraiment lancée, et, laissés par l'appelant, r11 celle qui était choisie et r6 le Pokémon.
const MOVE_DONE: u32 = 0x1fc58;
/// Branche un gestionnaire d'effets du combat : r0 son genre (4 un talent, 5 un objet tenu ; 0 à 3 capacité, place, camp,
/// terrain), r1 le talent ou l'objet, [sp] le Pokémon.
const FACTOR_ADD: u32 = 0x4d308;
/// Annonce qu'un Pokémon a consommé son objet (Baie mangée, Herbe Blanche) : r1 le Pokémon, r2 l'objet.
const ITEM_CONSUMED: u32 = 0x6b550;

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
    /// (début en s, durée en s, X, Y) : le stylet programmé
    pub touches: Vec<(f64, f64, u16, u16)>,
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
    /// La sortie du son, s'il y en a une : les échantillons stéréo mixés par le DSP, à 32 728 Hz.
    pub audio: Option<std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<i16>>>>,
    /// Appelé à chaque fin d'image (la partie Archipelago).
    pub vblank_hook: Option<Box<dyn FnMut(&mut Kernel)>>,
    /// (heure en s, objet, quantité) : ce qu'il reste à donner au joueur, dans l'ordre (`--donner`, Archipelago).
    pub gifts: std::collections::VecDeque<(f64, u32, u32)>,
    /// Les requêtes de l'écran du bas à poser (`--requete`) : heure en s, numéro.
    pub requests: std::collections::VecDeque<(f64, u32)>,
    pub requests_watched: bool,
    /// Les adresses de DllBattle où les guets du combat sont déjà posés : le module revient au même miroir à chaque combat.
    pub battle_watched: Vec<u32>,
    /// Le pad circulaire tenu en direct (Shift et la croix du clavier) : X et Y, Y vers le haut.
    pub circle: (i16, i16),
    /// (début en s, durée en s, X, Y) : le pad circulaire programmé
    pub circles: Vec<(f64, f64, i16, i16)>,
    /// La rotation de la console en direct (la souris de la fenêtre) : les valeurs brutes des trois axes du gyroscope.
    pub gyro: [i16; 3],
    /// (début en s, durée en s, valeurs brutes) : la rotation programmée
    pub gyros: Vec<(f64, f64, [i16; 3])>,
    /// Le jeu a allumé le gyroscope : la souris de la fenêtre le mène.
    pub gyro_on: bool,
    /// Le stylet tenu en direct (la souris de la fenêtre) : X et Y sur l'écran du bas.
    pub touch: Option<(u16, u16)>,
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
        if name == "DllBattle" {
            self.watch_battle(address);
        }
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

    pub fn circle_now(&self) -> (i16, i16) {
        let seconds = self.now as f64 / 1e9;
        self.bench.circles.iter().find(|c| c.0 <= seconds && seconds < c.0 + c.1).map_or(self.bench.circle, |c| (c.2, c.3))
    }

    pub fn gyro_now(&self) -> [i16; 3] {
        let seconds = self.now as f64 / 1e9;
        self.bench.gyros.iter().find(|g| g.0 <= seconds && seconds < g.0 + g.1).map_or(self.bench.gyro, |g| g.2)
    }

    pub fn touch_now(&self) -> Option<(u16, u16)> {
        let seconds = self.now as f64 / 1e9;
        self.bench.touch.or_else(|| {
            self.bench.touches.iter().find(|t| t.0 <= seconds && seconds < t.0 + t.1).map(|t| (t.2, t.3))
        })
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
        self.watch(AMX_EXEC, false, Rc::new(|k: &mut Kernel, _| k.note_script()))?;
        Ok(())
    }

    /// Pose les requêtes de `--requete`. La boucle du terrain F appelle `FIELD_TURN(F)` puis, si [F+0x48] a le bit 0x100, lit
    /// les requêtes de l'écran du bas : le bit n de S+0xa4, avec S = [[F+0x10]+0x16c]. L'écran du bas remet ce tableau à zéro
    /// entre deux images, d'où l'écriture juste avant la lecture. Un repère dans un module ne se pose qu'une fois celui-ci chargé.
    pub fn watch_requests(&mut self) {
        use std::rc::Rc;
        let in_field = self.journal.names.modules.iter().any(|m| m.2 == "DllField");
        if self.bench.requests_watched || self.bench.requests.is_empty() || !in_field {
            return;
        }
        self.bench.requests_watched = true;
        let watched = self.watch(FIELD_TURN, false, Rc::new(|k: &mut Kernel, _| {
            let Some(&(at, request)) = k.bench.requests.front() else { return };
            let in_field = k.journal.names.modules.iter().any(|m| m.2 == "DllField");
            if !in_field || (k.now as f64 / 1e9) < at {
                return;
            }
            let field = k.cpu.get(Reg::R(0));
            let word = |k: &Kernel, a: u32| k.memory.u32(a).unwrap_or(0);
            let screen = word(k, word(k, field.wrapping_add(0x10)).wrapping_add(0x16c));
            let bits = screen.wrapping_add(0xa4 + 4 * (request >> 5));
            let (flags, requests) = (word(k, field.wrapping_add(0x48)), word(k, bits));
            let _ = k.memory.w32(field.wrapping_add(0x48), flags | 0x100);
            let _ = k.memory.w32(bits, requests | 1 << (request & 31));
            k.bench.requests.pop_front();
            let now = k.now;
            k.journal.write(now, &format!("requête {request} posée (terrain {field:#x}, écran du bas {screen:#x})"));
        }));
        if let Err(text) = watched {
            self.bench.stop_request = Some(text);
        }
    }

    /// Pose les guets du combat dans DllBattle chargé à `base`. Le miroir dépend de ce qui est déjà chargé (0x6a9000
    /// après le terrain, 0x6d1000 vu sous l'évolution), d'où une base lue au chargement plutôt qu'une constante.
    fn watch_battle(&mut self, base: u32) {
        use std::rc::Rc;
        if self.bench.battle_watched.contains(&base) {
            return;
        }
        self.bench.battle_watched.push(base);
        let notes: [(u32, fn(&mut Kernel)); 3] =
            [(MOVE_DONE, Kernel::note_move), (FACTOR_ADD, Kernel::note_factor), (ITEM_CONSUMED, Kernel::note_item_consumed)];
        for (offset, note) in notes {
            let watched = self.watch(base + offset, false, Rc::new(move |k: &mut Kernel, _| {
                // le guet reste posé quand le module part : un autre module peut avoir une fonction à cette adresse
                if k.journal.names.modules.iter().any(|m| m.0 == base && m.2 == "DllBattle") {
                    note(k);
                }
            }));
            if let Err(text) = watched {
                self.note(&format!("combat : pas de guet à DllBattle+{offset:#x} ({text})"));
            }
        }
    }

    /// « par joueur (Pokémon 0) » : l'identifiant du Pokémon dans le combat, 0 à 5 l'équipe du joueur, 12 à 17 celle d'en
    /// face, 6 à 11 et 18 à 23 celles des deux autres dresseurs d'un combat à quatre (premier identifiant de chaque
    /// dresseur : DllBattle+0xd10db).
    fn by_pokemon(id: u32) -> String {
        format!("par {} (Pokémon {id})", if id < 12 { "joueur" } else { "adversaire" })
    }

    /// Note au journal chaque capacité que le moteur de combat lance, ce qui mesure les capacités vraiment jouées. Une
    /// capacité qui en appelle une autre (Métronome) donne la capacité appelée, suivie de « appelée par » celle qui était choisie.
    fn note_move(&mut self) {
        let used = self.cpu.get(Reg::R(1)) & 0xffff;
        let chosen = self.cpu.get(Reg::R(11)) & 0xffff;
        let id = self.memory.u8(self.cpu.get(Reg::R(6)).wrapping_add(0x19)).unwrap_or(0xff);
        let mut text = format!("capacité : {used} {}", Self::by_pokemon(id.into()));
        if chosen != used {
            text += &format!(" appelée par {chosen}");
        }
        let now = self.now;
        self.journal.write(now, &text);
    }

    /// Note le talent ou l'objet tenu dont le combat branche les effets sur un Pokémon : à son entrée, et quand il change
    /// (Calque, Passe-Passe). Seuls ceux qui ont des effets en combat sont branchés, les autres ne sont pas notés.
    fn note_factor(&mut self) {
        let kind = match self.cpu.get(Reg::R(0)) {
            4 => "talent",
            5 => "objet tenu",
            _ => return,
        };
        let value = self.cpu.get(Reg::R(1)) & 0xffff;
        let id = self.memory.u32(self.cpu.get(Reg::Sp)).unwrap_or(0xff) & 0xff;
        let now = self.now;
        self.journal.write(now, &format!("{kind} : {value} {}", Self::by_pokemon(id)));
    }

    fn note_item_consumed(&mut self) {
        let item = self.cpu.get(Reg::R(2)) & 0xffff;
        let id = self.memory.u8(self.cpu.get(Reg::R(1)).wrapping_add(0x19)).unwrap_or(0xff);
        let now = self.now;
        self.journal.write(now, &format!("objet consommé : {item} {}", Self::by_pokemon(id.into())));
    }

    /// Note au journal chaque script lancé : ce qui mesure les événements déroulés. Un script est un fichier et une valeur
    /// de sa variable publique `g_mode`, sur laquelle `main` aiguille ; le fichier se déduit de `g_mode`, de la zone et du
    /// nombre de variables publiques.
    fn note_script(&mut self) {
        // -1 lance `main` ; -2 reprend un script en attente, et un index positif appelle une fonction publique
        if self.cpu.get(Reg::R(2)) != u32::MAX {
            return;
        }
        let amx = self.cpu.get(Reg::R(0));
        let word = |k: &Kernel, a: u32| k.memory.u32(a).unwrap_or(0);
        let base = word(self, amx);
        let data = match word(self, amx.wrapping_add(8)) {
            0 => base.wrapping_add(word(self, base.wrapping_add(0x10))),
            d => d,
        };
        let first = base.wrapping_add(word(self, base.wrapping_add(0x2c)));
        let last = base.wrapping_add(word(self, base.wrapping_add(0x30)));
        let publics = last.wrapping_sub(first) / 8;
        let mode = (0..publics.min(64)).map(|i| first.wrapping_add(i * 8)).find(|&e| word(self, e.wrapping_add(4)) == G_MODE_HASH)
            .map(|e| word(self, data.wrapping_add(word(self, e))) as i32);
        let zone = word(self, word(self, ZONE_HOLDER).wrapping_add(0x38)) & 0xffff;
        let now = self.now;
        let text = match mode {
            Some(mode) => format!("script : zone {zone} publiques {publics} g_mode {mode}"),
            None => format!("script : zone {zone} publiques {publics} sans g_mode"),
        };
        self.journal.write(now, &text);
    }
}
