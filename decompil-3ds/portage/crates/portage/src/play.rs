//! `portage play` : le jeu en direct dans une fenêtre. Un seul fil : la boucle de winit mène le runtime par tranches
//! (`Bench::run_slice`), le temps du jeu rattrape le temps réel (deux images de retard au plus, au-delà le jeu ralentit),
//! puis les dernières images des deux écrans sont présentées telles que pica les a construites sur le GPU.
//!
//! Touches : voir le README. Seul l'écran du haut est affiché ; Échap pose l'écran du bas par-dessus, le jeu continue, et
//! le clic gauche y devient le stylet et la croix du clavier ne répond plus. La fenêtre se ferme par sa croix. Shift
//! fait de la croix du clavier le pad circulaire. F11 passe en plein écran. En combat, l'écran du bas est toujours là, dans le coin en bas à droite.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use kernel::memory::AddressSpace;
use runtime::bench::{BUTTONS, Bench, Options, find_root};
use runtime::gpu::Shared;
use services::gsp::VBLANK_NS;
use winit::application::ApplicationHandler;
use winit::event::{DeviceEvent, DeviceId, ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{CursorGrabMode, Window, WindowId};

use pica::images::save_png;

use crate::window::{Layout, Screens, open};

/// Touche -> bouton de la console (nom de `BUTTONS`). Les touches sont lues à leur place sur le clavier, nommée d'après
/// le QWERTY : sur un AZERTY, KeyW/KeyA/KeyS/KeyD sont Z/Q/S/D, KeyQ est A. A et B sont sur la souris (`MOUSE`).
const KEYS: [(KeyCode, &str); 10] = [
    (KeyCode::KeyX, "X"),
    (KeyCode::KeyC, "Y"),
    (KeyCode::KeyQ, "L"),
    (KeyCode::KeyE, "R"),
    (KeyCode::Enter, "START"),
    (KeyCode::Backspace, "SELECT"),
    (KeyCode::KeyW, "UP"),
    (KeyCode::KeyS, "DOWN"),
    (KeyCode::KeyA, "LEFT"),
    (KeyCode::KeyD, "RIGHT"),
];

/// Les boutons que le menu ouvert retire au clavier : le personnage ne marche pas pendant qu'on clique.
const MOVES: [&str; 4] = ["UP", "DOWN", "LEFT", "RIGHT"];

/// Le pad circulaire poussé à fond, tout droit (`CIRCLE_MAX`) ou en diagonale (`CIRCLE_DIAGONAL`, le même rayon).
const CIRCLE_MAX: i16 = 156;
const CIRCLE_DIAGONAL: i16 = 110;

const MOUSE: [(MouseButton, &str); 2] = [(MouseButton::Left, "A"), (MouseButton::Right, "B")];

fn bit(name: &str) -> Option<u32> {
    BUTTONS.iter().find(|(n, _)| *n == name).map(|(_, bit)| *bit)
}

/// `DllBattle` en mémoire, d'après ses octets : la case de sa table des segments réécrite par ro (.bss), le contexte du
/// module dans .bss, les vtables de `BattleViewSystem` et `BtlvUiActSelect` qui gardent le chemin.
const BATTLE_BSS_SEGMENT: u32 = 0xDC00C + 36;
const BATTLE_CONTEXT: u32 = 0xF3E0;
const BATTLE_VIEW_VTABLE: u32 = 0xDAFC0;
const ACTION_SELECT_VTABLE: u32 = 0xDAFA0;

/// Ce que l'écran du bas montre en combat.
#[derive(Clone, Copy, PartialEq, Debug)]
enum BattleScreen {
    /// Assombri ou en transition : rien à y faire.
    Idle,
    Menu,
    Moves,
    YesNo,
}

/// Les objets d'interface du combat : `[bss + 0xF3E0] + 0x14` est le `BattleViewSystem`, `+0x190` ses objets.
fn battle_objects(memory: &AddressSpace, base: u32) -> Option<u32> {
    // les valeurs lues peuvent être n'importe quoi après un déchargement : d'où wrapping_add, et la garde par les vtables
    let word = |address: u32, offset: u32| memory.u32(address.wrapping_add(offset)).ok();
    let context = word(word(base, BATTLE_BSS_SEGMENT)?, BATTLE_CONTEXT)?;
    let view = word(context, 0x14)?;
    (word(view, 0)? == base + BATTLE_VIEW_VTABLE).then_some(())?;
    let objects = word(view, 0x190)?;
    (word(objects, 0x5C)? == base + ACTION_SELECT_VTABLE).then_some(objects)
}

/// Plusieurs Pokémon de chaque côté : l'octet `+0xA1` des objets est la règle (0 simple, 1 double, 2 triple, 3 rotation), relevé
/// par différence des quatre combats, avec le type de combat du dresseur changé dans `a/0/3/8` (`local/analyse/rendu/mods-test`).
fn battle_with_many(memory: &AddressSpace, base: u32) -> bool {
    battle_objects(memory, base).and_then(|objects| memory.u8(objects.wrapping_add(0xA1)).ok()).is_some_and(|rule| rule != 0)
}

/// Octets lus : `+0x93` le menu
/// (`BtlvUiActSelect` : 0 aucun, 4 première ouverture, 1 menu, 2 capacités, 5 et 6 fermetures de 1 et 2), `+0xF0` la liste
/// des Pokémon, `+0x1B3` le choix d'un Pokémon, `+0x1E8` le sac, `+0x244` la question ; le mot `+0x26C` est la liste d'oubli de
/// capacité, nul si fermée (`local/analyse/DllBattle/notes.md` et `notes-ecrans.md`).
fn battle_screen(memory: &AddressSpace, base: u32) -> Option<BattleScreen> {
    let word = |address: u32, offset: u32| memory.u32(address.wrapping_add(offset)).ok();
    let objects = battle_objects(memory, base)?;
    let byte = |offset: u32| memory.u8(objects.wrapping_add(offset)).ok();
    Some(if byte(0x244)? == 1 {
        BattleScreen::YesNo
    } else if matches!(byte(0x93)?, 2 | 6) {
        BattleScreen::Moves
    } else if byte(0x93)? != 0 || byte(0xF0)? != 0 || byte(0x1B3)? != 0 || byte(0x1E8)? != 0 || word(objects, 0x26C)? != 0 {
        BattleScreen::Menu
    } else {
        BattleScreen::Idle
    })
}

/// Les scènes qui se jouent au stylet : l'écran du bas s'y ouvre tout seul, sans Échap (saisie d'un nom, boîtes, Poké
/// Récré, tenue, puzzle). Échap le referme quand même.
const TOUCH_SCENES: [&str; 8] = ["DllStrInput", "DllNumberInput", "DllBox", "DllBoxSearch", "DllKawaigari", "DllKawaigariArrange", "DllKisekae", "DllPuzzle"];

/// Les compteurs d'une seconde de fenêtre (titre et ligne de suivi).
#[derive(Default)]
struct Second {
    presented: u32,
    game_frames: u32,
    run_seconds: f64,
    emulated_from: u64,
}

/// Valeur brute du gyroscope par point de souris : environ 2 degrés pour 100 points.
const AIM_RAW_PER_COUNT: f64 = 20.0;
/// Le plus par fin d'image, soit 7 degrés par seconde : mesuré à Otto Focus, 100 reste stable, et à partir de 150 la caméra
/// rebondit quand la rotation s'arrête, à l'horizontale comme à la verticale.
const AIM_MAX_RAW: f64 = 100.0;
/// Le retard gardé au plus, un quart de seconde : quand la souris s'arrête, la visée s'arrête peu après.
const AIM_MAX_PENDING: f64 = 15.0 * AIM_MAX_RAW;

/// La visée à la souris : ce qui reste à envoyer au gyroscope (X, Y), étalé d'une fin d'image à l'autre.
#[derive(Default)]
struct Aim {
    pending: [f64; 2],
    sent: [f64; 2],
    vblanks: u64,
}

impl Aim {
    /// Un déplacement de la souris, en points d'écran. Haut de l'écran : on incline vers le haut (X négatif) ; droite : on
    /// tourne à droite (Y négatif). Les deux sens sont lus sur les images d'Otto Focus.
    fn moved(&mut self, dx: f64, dy: f64) {
        for (pending, delta) in self.pending.iter_mut().zip([dy, -dx]) {
            *pending = (*pending + delta * AIM_RAW_PER_COUNT).clamp(-AIM_MAX_PENDING, AIM_MAX_PENDING);
        }
    }

    /// Les valeurs du gyroscope pour la prochaine fin d'image, sachant combien de fins d'image ont eu lieu.
    fn gyro(&mut self, vblanks: u64) -> [i16; 3] {
        if vblanks != self.vblanks {
            self.vblanks = vblanks;
            for (pending, sent) in self.pending.iter_mut().zip(self.sent) {
                *pending -= sent;
            }
        }
        self.sent = self.pending.map(|p| p.clamp(-AIM_MAX_RAW, AIM_MAX_RAW).trunc());
        [self.sent[0] as i16, self.sent[1] as i16, 0]
    }

    fn reset(&mut self) {
        self.pending = [0.0; 2];
        self.sent = [0.0; 2];
    }
}

/// Les tranches de jeu trop longues : une tranche vise au plus deux images (33 ms), au-delà le joueur voit un à-coup.
#[derive(Default)]
struct Hitches {
    /// Combien ont dépassé 33 ms, 100 ms, 500 ms.
    over: [u32; 3],
    /// Les plus longues : (secondes, temps du jeu en s), la pire d'abord.
    worst: Vec<(f64, f64)>,
}

impl Hitches {
    fn add(&mut self, seconds: f64, now: u64) {
        for (count, limit) in self.over.iter_mut().zip([0.033, 0.1, 0.5]) {
            *count += (seconds > limit) as u32;
        }
        if seconds > 0.033 {
            self.worst.push((seconds, now as f64 / 1e9));
            self.worst.sort_by(|a, b| b.0.total_cmp(&a.0));
            self.worst.truncate(8);
        }
    }

    fn summary(&self) -> String {
        let worst: Vec<String> = self.worst.iter().map(|(s, at)| format!("{:.0} ms à {at:.1} s", s * 1000.0)).collect();
        format!("À-coups : {} tranches de plus de 33 ms, {} de plus de 100 ms, {} de plus de 500 ms ; les pires : {}", self.over[0], self.over[1], self.over[2], worst.join(", "))
    }
}

struct Play {
    hitches: Hitches,
    aim: Aim,
    /// La souris peut viser : ni rejeu, ni pendant que l'on va à un moment donné.
    can_aim: bool,
    focused: bool,
    /// Le curseur est retenu dans la fenêtre et caché, le temps de viser.
    grabbed: bool,
    bench: Bench,
    shared: Shared,
    started: Instant,
    /// Le retard abandonné (ns) : le temps du jeu vise le temps réel moins ce retard.
    dropped: u64,
    /// Arrêt demandé après tant de secondes réelles (`--seconds`).
    limit: Option<f64>,
    scale: u32,
    window: Option<Arc<Window>>,
    screens: Option<Screens>,
    last_top: usize,
    second: Second,
    second_start: Instant,
    first_frame: Option<f64>,
    stopped: Option<String>,
    /// `--screenshot-at` : (heure du jeu en ns, préfixe des PNG) ; la capture se fait juste avant la première fin
    /// d'image à cette heure ou après, au moment où le banc `--dessiner` prend les siennes.
    shot: Option<(u64, String)>,
    /// La fin d'image visée est atteinte : la prochaine présentation est capturée.
    shot_ready: bool,
    forward: Option<f64>,
    speed: u64,
    /// L'écran du bas est posé sur le jeu (Échap).
    menu: bool,
    /// Le clic gauche est tenu sur cet écran.
    stylus: bool,
    cursor: (f32, f32),
    /// Les touches de la croix tenues, dans l'ordre de `MOVES`.
    moves: [bool; 4],
    /// Shift est tenu : la croix du clavier est le pad circulaire.
    shift: bool,
    combat_in_corner: bool,
    both_screens: bool,
    smooth: bool,
    /// On est dans une scène de `TOUCH_SCENES` : le menu s'y est ouvert seul.
    touch_scene: bool,
    /// Les relances du jeu déjà suivies (`Bench::restarts`).
    restarts: usize,
}

/// Ce que `portage play` reçoit de la ligne de commande (les réglages du launcher).
pub struct Settings {
    pub scale: u32,
    /// Quitter après tant de secondes réelles (pour une mesure), sinon à la fermeture de la fenêtre.
    pub seconds: Option<f64>,
    pub shot: Option<(f64, String)>,
    pub replay: Option<String>,
    /// La fenêtre ne paraît qu'à cette heure du jeu, atteinte à pleine vitesse (secondes).
    pub forward: Option<f64>,
    /// Le jeu avance tant de fois plus vite que le temps réel (le son se coupe : il ne suivrait pas).
    pub speed: u64,
    /// Une partie à part (`play-neuve`), partie d'une sauvegarde vide.
    pub new_game: bool,
    pub combat_in_corner: bool,
    pub both_screens: bool,
    pub game_mod: Option<std::path::PathBuf>,
    pub archipelago: Option<apclient::Settings>,
    pub volume: u32,
    pub textures: runtime::gpu::TextureOptions,
    pub smooth: bool,
}

impl Play {
    /// Fait avancer le jeu jusqu'au temps réel, deux images au plus.
    fn step(&mut self) {
        // arrêté : la boucle de winit peut repasser ici avant de sortir, et reprendre le fil masquerait la vraie raison
        if self.stopped.is_some() {
            return;
        }
        if self.shot_ready {
            return; // le jeu attend la capture, juste avant la fin d'image visée
        }
        let now = self.bench.kernel.now;
        if self.forward.is_some_and(|at| now as f64 / 1e9 >= at) {
            // arrivé : l'horloge réelle repart de l'heure du jeu
            self.forward = None;
            self.started = Instant::now() - std::time::Duration::from_nanos(now);
            self.dropped = 0;
            if let Some(window) = &self.window {
                window.set_visible(true);
                window.focus_window();
            }
        }
        let mut target = (self.started.elapsed().as_nanos() as u64 * self.speed).saturating_sub(self.dropped);
        let most = now + 2 * self.speed * VBLANK_NS;
        if self.forward.is_some() {
            target = now + 2 * VBLANK_NS;
        } else if target > most {
            self.dropped += target - most;
            target = most;
        }
        let next = self.bench.kernel.bench.last_vblank + VBLANK_NS;
        if self.shot.is_some() && next > now {
            target = target.min(next); // une fin d'image par tranche au plus
        }
        if target > now {
            self.update_aim();
            let start = Instant::now();
            if let Some(reason) = self.bench.run_slice(target) {
                self.stopped = Some(reason);
            }
            if self.bench.restarts.len() != self.restarts {
                self.follow_restart();
            }
            let spent = start.elapsed().as_secs_f64();
            self.second.run_seconds += spent;
            self.hitches.add(spent, self.bench.kernel.now);
        }
        if let Some((at, _)) = &self.shot {
            // la fin d'image est due mais pas encore faite (Kernel::run teste l'heure avant les échéances) : c'est
            // l'instant où le banc prend ses images
            let next = self.bench.kernel.bench.last_vblank + VBLANK_NS;
            self.shot_ready = self.bench.kernel.now >= next && next >= *at;
        }
    }

    fn aiming(&self) -> bool {
        self.can_aim && self.focused && !self.menu && self.bench.kernel.bench.gyro_on && !self.layout().1
    }

    /// Envoie la visée au gyroscope, et ne retient le curseur que le temps de viser.
    fn update_aim(&mut self) {
        let aiming = self.aiming();
        if !aiming {
            self.aim.reset();
        }
        let bench = &mut self.bench.kernel.bench;
        bench.gyro = self.aim.gyro(bench.vblanks);
        if aiming != self.grabbed {
            self.grabbed = aiming;
            if let Some(window) = &self.window {
                let mode = if aiming { CursorGrabMode::Confined } else { CursorGrabMode::None };
                if let Err(e) = window.set_cursor_grab(mode) {
                    eprintln!("curseur non retenu : {e}");
                }
                window.set_cursor_visible(!aiming);
            }
        }
    }

    /// Tient ou relâche un bouton de la console dans le masque que lit hid.
    fn hold(&mut self, name: &str, state: ElementState) {
        let Some(bit) = bit(name) else { return };
        let held = &mut self.bench.kernel.bench.buttons;
        *held = if state == ElementState::Pressed { *held | bit } else { *held & !bit };
    }

    /// Envoie les touches de la croix tenues au jeu : aucune si le menu est ouvert, au pad circulaire si Shift est tenu.
    fn update_moves(&mut self) {
        let active = if self.menu { [false; 4] } else { self.moves };
        for (name, pressed) in MOVES.iter().zip(active) {
            let state = if pressed && !self.shift { ElementState::Pressed } else { ElementState::Released };
            self.hold(name, state);
        }
        let axis = |plus: bool, minus: bool| plus as i16 - minus as i16;
        let (x, y) = if self.shift { (axis(active[3], active[2]), axis(active[0], active[1])) } else { (0, 0) };
        let reach = if x != 0 && y != 0 { CIRCLE_DIAGONAL } else { CIRCLE_MAX };
        self.bench.kernel.bench.circle = (x * reach, y * reach);
    }

    /// En combat : l'adresse de `DllBattle`, chargé tant qu'il dure.
    fn battle_base(&self) -> Option<u32> {
        self.bench.kernel.journal.names.modules.iter().find(|m| m.2 == "DllBattle").map(|m| m.0)
    }

    /// Où est l'écran du bas : (disposition, affiché ou non). Échap l'emporte sur le coin du combat.
    fn layout(&self) -> (Layout, bool) {
        if self.both_screens {
            (Layout::Stacked, true)
        } else if self.menu {
            (Layout::Overlaid, true)
        } else if let Some(base) = self.battle_base().filter(|_| self.combat_in_corner) {
            // rien quand l'écran du bas n'offre rien à toucher : Échap l'affiche quand même
            let memory = &self.bench.kernel.memory;
            match battle_screen(memory, base) {
                Some(BattleScreen::Moves) if battle_with_many(memory, base) => (Layout::SmallMoves, true),
                Some(BattleScreen::Moves) => (Layout::Moves, true),
                Some(BattleScreen::YesNo) => (Layout::YesNo, true),
                Some(BattleScreen::Menu) if battle_with_many(memory, base) => (Layout::SmallCorner, true),
                Some(BattleScreen::Menu) => (Layout::Corner, true),
                _ => (Layout::Overlaid, false),
            }
        } else {
            (Layout::Overlaid, false)
        }
    }

    /// Le point de l'écran du bas sous la souris, s'il est affiché.
    fn point_under_cursor(&self) -> Option<(u16, u16)> {
        let (layout, shown) = self.layout();
        let size = self.window.as_ref()?.inner_size();
        let (x, y) = self.cursor;
        shown.then(|| layout.bottom_point(size.width as f32, size.height as f32, x, y)).flatten()
    }

    /// Pose ou lève le stylet : il suit la souris tant qu'elle reste sur l'écran du bas.
    fn update_stylus(&mut self) {
        self.bench.kernel.bench.touch = if self.stylus { self.point_under_cursor() } else { None };
    }

    /// À l'entrée et à la sortie d'une scène au stylet, ouvre ou referme l'écran du bas.
    fn follow_touch_scenes(&mut self) {
        let inside = self.bench.kernel.journal.names.modules.iter().any(|m| TOUCH_SCENES.contains(&m.2.as_str()));
        if inside != self.touch_scene {
            self.touch_scene = inside;
            if self.menu != inside && !self.both_screens {
                self.toggle_menu();
            }
        }
    }

    fn toggle_menu(&mut self) {
        self.menu = !self.menu;
        self.stylus = false;
        self.update_stylus();
        self.hold("A", ElementState::Released); // un clic gauche tenu change de sens
        self.update_moves();
    }

    fn draw(&mut self) {
        self.follow_touch_scenes();
        let (layout, shown) = self.layout();
        let Some(screens) = self.screens.as_mut() else { return };
        let images = self.shared.screens.borrow();
        if let Some((_, top)) = &images[0] {
            if top.index != self.last_top {
                self.last_top = top.index;
                self.second.game_frames += 1;
                self.first_frame.get_or_insert(self.started.elapsed().as_secs_f64());
            }
        }
        let textures: Vec<Option<wgpu::Texture>> = images.iter().map(|i| i.as_ref().map(|(_, i)| screens.texture(i))).collect();
        drop(images);
        if self.shot_ready {
            let (_, prefix) = self.shot.take().unwrap();
            self.shot_ready = false;
            let pair = screens.capture([textures[0].as_ref(), textures[1].as_ref()], self.scale);
            let (w, h, rgba) = screens.capture_window([textures[0].as_ref(), if shown { textures[1].as_ref() } else { None }], self.scale, layout);
            if let Err(e) = save_png(Path::new(&format!("{prefix}fenetre.png")), w, h, &rgba) {
                eprintln!("{prefix}fenetre.png : {e}");
            }
            for ((w, h, rgba), label) in pair.iter().zip(["haut", "bas"]) {
                let path = format!("{prefix}{label}.png");
                match save_png(Path::new(&path), *w, *h, rgba) {
                    Ok(()) => println!("capture de la fenêtre au temps du jeu {:.4} s : {path}", self.bench.kernel.now as f64 / 1e9),
                    Err(e) => eprintln!("{path} : {e}"),
                }
            }
        }
        screens.draw([textures[0].as_ref(), if shown { textures[1].as_ref() } else { None }], self.smooth, layout);
        self.second.presented += 1;
        let elapsed = self.second_start.elapsed().as_secs_f64();
        if elapsed >= 1.0 {
            let s = &self.second;
            let emulated = (self.bench.kernel.now - s.emulated_from) as f64 / 1e9;
            let text = format!(
                "{:.0} présentations/s, {:.1} ms par présentation, {:.0} images du jeu/s, vitesse {:.2}x, jeu {:.1} ms par seconde, temps du jeu {:.1} s",
                s.presented as f64 / elapsed,
                1000.0 * elapsed / s.presented.max(1) as f64,
                s.game_frames as f64 / elapsed,
                emulated / elapsed,
                1000.0 * s.run_seconds / elapsed,
                self.bench.kernel.now as f64 / 1e9
            );
            println!("{:6.1} s : {text}", self.started.elapsed().as_secs_f64());
            screens.window.set_title(&format!("Pokémon X, portage PC : {text}"));
            self.second = Second { emulated_from: self.bench.kernel.now, ..Default::default() };
            self.second_start = Instant::now();
        }
    }
}

impl Play {
    /// Le jeu s'est relancé : son GPU est neuf, la même fenêtre se rebranche dessus.
    fn follow_restart(&mut self) {
        self.restarts = self.bench.restarts.len();
        let Some(shared) = self.bench.drawing.clone() else { return };
        self.shared = shared;
        let Some(window) = self.window.clone() else { return };
        // la surface de l'ancien GPU rend la fenêtre avant que le nouveau ne la prenne
        self.screens = None;
        match Screens::new(window, self.shared.gpu.clone()) {
            Ok(screens) => self.screens = Some(screens),
            Err(e) => self.stopped = Some(e),
        }
    }
}

impl ApplicationHandler for Play {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let window = open(event_loop, "Pokémon X, portage PC", 800.0, if self.both_screens { 960.0 } else { 480.0 });
        window.set_visible(self.forward.is_none());
        match Screens::new(window.clone(), self.shared.gpu.clone()) {
            Ok(screens) => self.screens = Some(screens),
            Err(e) => {
                self.stopped = Some(e);
                event_loop.exit();
            }
        }
        self.window = Some(window);
        event_loop.set_control_flow(ControlFlow::Poll);
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.step();
        let over = self.limit.is_some_and(|s| self.started.elapsed().as_secs_f64() >= s);
        if self.stopped.is_some() || over {
            event_loop.exit();
        } else if let Some(window) = &self.window {
            window.request_redraw();
        }
    }

    fn device_event(&mut self, _event_loop: &ActiveEventLoop, _id: DeviceId, event: DeviceEvent) {
        if let DeviceEvent::MouseMotion { delta } = event {
            if self.aiming() {
                self.aim.moved(delta.0, delta.1);
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(screens) = self.screens.as_mut() {
                    screens.resize(size.width, size.height);
                }
            }
            WindowEvent::RedrawRequested => self.draw(),
            WindowEvent::Focused(focused) => self.focused = focused,
            WindowEvent::KeyboardInput { event, .. } => {
                let PhysicalKey::Code(code) = event.physical_key else { return };
                if code == KeyCode::F11 {
                    if event.state == ElementState::Pressed && !event.repeat {
                        if let Some(window) = &self.window {
                            let full = window.fullscreen().is_none().then_some(winit::window::Fullscreen::Borderless(None));
                            window.set_fullscreen(full);
                        }
                    }
                } else if code == KeyCode::Escape {
                    if event.state == ElementState::Pressed && !event.repeat && !self.both_screens {
                        self.toggle_menu();
                    }
                } else if matches!(code, KeyCode::ShiftLeft | KeyCode::ShiftRight) {
                    self.shift = event.state == ElementState::Pressed;
                    self.update_moves();
                } else if let Some((_, name)) = KEYS.iter().find(|(k, _)| *k == code) {
                    if let Some(i) = MOVES.iter().position(|m| m == name) {
                        self.moves[i] = event.state == ElementState::Pressed;
                        self.update_moves();
                    } else {
                        self.hold(name, event.state);
                    }
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.cursor = (position.x as f32, position.y as f32);
                self.update_stylus();
            }
            WindowEvent::MouseInput { state, button, .. } => {
                // le clic gauche est le stylet s'il commence sur l'écran du bas, A partout ailleurs (sauf menu ouvert)
                let on_screen = self.point_under_cursor().is_some();
                if button == MouseButton::Left && (self.stylus || (state == ElementState::Pressed && (on_screen || self.menu))) {
                    self.stylus = state == ElementState::Pressed;
                    self.update_stylus();
                } else if let Some((_, name)) = MOUSE.iter().find(|(b, _)| *b == button) {
                    self.hold(name, state);
                }
            }
            _ => {}
        }
    }
}

pub fn run(settings: Settings) -> Result<(), String> {
    let Settings { scale, seconds, shot, replay, forward, speed, new_game, combat_in_corner, both_screens, game_mod, archipelago, volume, textures, smooth } = settings;
    let root = find_root();
    let mut options = Options::new(&root);
    // un rejeu repart de la sauvegarde d'origine : il ne touche ni à la partie du joueur ni à son journal
    let folder = if replay.is_some() { "play-rejeu" } else if new_game { "play-neuve" } else { "play" };
    options.out = root.join("local/analyse/runtime").join(folder);
    options.empty_save = new_game;
    options.seconds = f64::INFINITY;
    options.draw = true;
    options.live = true;
    options.keep_archives = replay.is_none();
    if replay.is_none() {
        // de 1900 à 1970 : 2 208 988 800 secondes
        let local = chrono::Local::now().naive_local().and_utc().timestamp_millis();
        options.clock_milliseconds = Some((local + 2_208_988_800_000) as u64);
    }
    options.mod_dir = game_mod;
    options.archipelago = archipelago;
    options.textures = textures;
    let audio: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<i16>>> = Default::default();
    // un volume nul ne décode rien du tout : le son reste éteint comme sur le banc
    let _output = if volume > 0 && speed == 1 { crate::sound::start(audio.clone(), volume.min(100) as f32 / 100.0) } else { None };
    if _output.is_some() {
        options.audio = Some(audio);
    }
    if let Some(path) = &replay {
        options.replay(path)?;
        options.out = root.join("local/analyse/runtime/play-rejeu");
    }
    options.scale = scale.clamp(1, 4);
    let mut bench = Bench::new(options)?;
    let shared = bench.drawing.clone().ok_or("pas de GPU")?;
    bench.start();
    let event_loop = EventLoop::new().map_err(|e| e.to_string())?;
    let mut play = Play {
        bench,
        shared,
        started: Instant::now(),
        dropped: 0,
        limit: seconds,
        forward,
        speed,
        window: None,
        screens: None,
        last_top: 0,
        hitches: Hitches::default(),
        aim: Aim::default(),
        can_aim: replay.is_none(),
        focused: true,
        grabbed: false,
        second: Second::default(),
        second_start: Instant::now(),
        first_frame: None,
        stopped: None,
        shot: shot.map(|(at, prefix)| ((at * 1e9) as u64, prefix)),
        shot_ready: false,
        scale: scale.clamp(1, 4),
        menu: false,
        stylus: false,
        cursor: (0.0, 0.0),
        moves: [false; 4],
        shift: false,
        combat_in_corner,
        both_screens,
        smooth,
        touch_scene: false,
        restarts: 0,
    };
    event_loop.run_app(&mut play).map_err(|e| e.to_string())?;
    let reason = play.stopped.clone().unwrap_or_else(|| "fenêtre fermée".to_string());
    let now = play.bench.kernel.now;
    play.bench.kernel.journal.write(now, &format!("=== arrêt : {reason}"));
    play.bench.kernel.journal.close();
    play.bench.elapsed = play.started.elapsed().as_secs_f64();
    if let Some(first) = play.first_frame {
        println!("Première image du jeu présentée à {first:.2} s");
    }
    println!("{}", play.bench.summary(&reason).lines().filter(|l| !l.starts_with("  ")).collect::<Vec<_>>().join("\n"));
    println!("{}", play.hitches.summary());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel::memory::PERM_RW;

    #[test]
    fn aim_spreads_a_fast_move_over_the_next_frames() {
        let mut aim = Aim::default();
        aim.moved(10.0, -2.0); // 200 et 40 unités
        assert_eq!(aim.gyro(0), [-40, -100, 0]);
        assert_eq!(aim.gyro(0), [-40, -100, 0], "sans fin d'image, rien n'est consommé");
        assert_eq!(aim.gyro(1), [0, -100, 0], "le vertical est fini, il reste 100 à l'horizontale");
        assert_eq!(aim.gyro(2), [0, 0, 0]);
        aim.moved(1000.0, 0.0);
        let total: i32 = (3..40).map(|v| -aim.gyro(v)[1] as i32).sum();
        assert_eq!(total, AIM_MAX_PENDING as i32, "le retard gardé est borné");
        aim.moved(1.0, 1.0);
        aim.reset();
        assert_eq!(aim.gyro(50), [0, 0, 0]);
    }

    #[test]
    fn screen_follows_the_open_application() {
        const BASE: u32 = 0x0100_0000;
        let (bss, context, view, objects) = (BASE + 0x10_0000, BASE + 0x11_0000, BASE + 0x11_1000, BASE + 0x11_2000);
        let mut memory = AddressSpace::new();
        memory.map(BASE, 0x20_0000, PERM_RW, "DllBattle", None).unwrap();
        let word = |memory: &AddressSpace, at: u32, value: u32| memory.write(at, &value.to_le_bytes()).unwrap();
        word(&memory, BASE + BATTLE_BSS_SEGMENT, bss);
        word(&memory, bss + BATTLE_CONTEXT, context);
        word(&memory, context + 0x14, view);
        word(&memory, view, BASE + BATTLE_VIEW_VTABLE);
        word(&memory, view + 0x190, objects);
        word(&memory, objects + 0x5C, BASE + ACTION_SELECT_VTABLE);
        use BattleScreen::*;
        for (state, expected) in [(0u8, Idle), (1, Menu), (2, Moves), (6, Moves), (3, Menu), (4, Menu), (5, Menu), (7, Menu)] {
            memory.write(objects + 0x93, &[state]).unwrap();
            assert_eq!(battle_screen(&memory, BASE), Some(expected), "état {state}");
        }
        memory.write(objects + 0x93, &[0]).unwrap();
        assert!(!battle_with_many(&memory, BASE));
        memory.write(objects + 0xA1, &[1]).unwrap();
        assert!(battle_with_many(&memory, BASE));
        memory.write(objects + 0xA1, &[0]).unwrap();
        for (offset, expected) in [(0xF0, Menu), (0x1B3, Menu), (0x1E8, Menu), (0x26C, Menu), (0x244, YesNo)] {
            memory.write(objects + offset, &[1]).unwrap();
            assert_eq!(battle_screen(&memory, BASE), Some(expected), "{offset:#x}");
            memory.write(objects + offset, &[0]).unwrap();
        }
        // un objet qui n'a pas la bonne vtable (module rechargé, mémoire réutilisée) : pas d'écran connu
        memory.write(objects + 0x93, &[2]).unwrap();
        word(&memory, objects + 0x5C, 0x1234);
        assert_eq!(battle_screen(&memory, BASE), None);
        // un pointeur qui sort de la mémoire
        word(&memory, BASE + BATTLE_BSS_SEGMENT, 0xFFFF_0000);
        assert_eq!(battle_screen(&memory, BASE), None);
    }
}
