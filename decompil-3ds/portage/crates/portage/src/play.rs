//! `portage play` : le jeu en direct dans une fenêtre. Un seul fil : la boucle de winit mène le runtime par tranches
//! (`Bench::run_slice`), le temps du jeu rattrape le temps réel (deux images de retard au plus, au-delà le jeu ralentit),
//! puis les dernières images des deux écrans sont présentées telles que pica les a construites sur le GPU.
//!
//! Touches : voir le README. Seul l'écran du haut est affiché ; Échap pose l'écran du bas par-dessus, le jeu continue, et
//! le clic gauche y devient le stylet. La fenêtre se ferme par sa croix.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use runtime::bench::{BUTTONS, Bench, Options, find_root};
use runtime::gpu::Shared;
use services::gsp::VBLANK_NS;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

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

const MOUSE: [(MouseButton, &str); 2] = [(MouseButton::Left, "A"), (MouseButton::Right, "B")];

fn bit(name: &str) -> Option<u32> {
    BUTTONS.iter().find(|(n, _)| *n == name).map(|(_, bit)| *bit)
}

/// Les compteurs d'une seconde de fenêtre (titre et ligne de suivi).
#[derive(Default)]
struct Second {
    presented: u32,
    game_frames: u32,
    run_seconds: f64,
    emulated_from: u64,
}

struct Play {
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
    /// L'écran du bas est posé sur le jeu (Échap).
    menu: bool,
    /// Le clic gauche est tenu sur cet écran.
    stylus: bool,
    cursor: (f32, f32),
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
        let mut target = (self.started.elapsed().as_nanos() as u64).saturating_sub(self.dropped);
        if target > now + 2 * VBLANK_NS {
            self.dropped += target - (now + 2 * VBLANK_NS);
            target = now + 2 * VBLANK_NS;
        }
        let next = self.bench.kernel.bench.last_vblank + VBLANK_NS;
        if self.shot.is_some() && next > now {
            target = target.min(next); // une fin d'image par tranche au plus
        }
        if target > now {
            let start = Instant::now();
            if let Some(reason) = self.bench.run_slice(target) {
                self.stopped = Some(reason);
            }
            self.second.run_seconds += start.elapsed().as_secs_f64();
        }
        if let Some((at, _)) = &self.shot {
            // la fin d'image est due mais pas encore faite (Kernel::run teste l'heure avant les échéances) : c'est
            // l'instant où le banc prend ses images
            let next = self.bench.kernel.bench.last_vblank + VBLANK_NS;
            self.shot_ready = self.bench.kernel.now >= next && next >= *at;
        }
    }

    /// Tient ou relâche un bouton de la console dans le masque que lit hid.
    fn hold(&mut self, name: &str, state: ElementState) {
        let Some(bit) = bit(name) else { return };
        let held = &mut self.bench.kernel.bench.buttons;
        *held = if state == ElementState::Pressed { *held | bit } else { *held & !bit };
    }

    /// Pose ou lève le stylet : il suit la souris tant qu'elle reste sur l'écran du bas.
    fn update_stylus(&mut self) {
        let Some(window) = &self.window else { return };
        let size = window.inner_size();
        let (x, y) = self.cursor;
        self.bench.kernel.bench.touch =
            if self.menu && self.stylus { Layout::Overlaid.bottom_point(size.width as f32, size.height as f32, x, y) } else { None };
    }

    fn toggle_menu(&mut self) {
        self.menu = !self.menu;
        self.stylus = false;
        self.update_stylus();
        self.hold("A", ElementState::Released); // un clic gauche tenu change de sens
    }

    fn draw(&mut self) {
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
            for ((w, h, rgba), label) in pair.iter().zip(["haut", "bas"]) {
                let path = format!("{prefix}{label}.png");
                match save_png(Path::new(&path), *w, *h, rgba) {
                    Ok(()) => println!("capture de la fenêtre au temps du jeu {:.4} s : {path}", self.bench.kernel.now as f64 / 1e9),
                    Err(e) => eprintln!("{path} : {e}"),
                }
            }
        }
        let bottom = if self.menu { textures[1].as_ref() } else { None };
        screens.draw([textures[0].as_ref(), bottom], false, Layout::Overlaid);
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

impl ApplicationHandler for Play {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let window = open(event_loop, "Pokémon X, portage PC", 800.0, 480.0);
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

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(screens) = self.screens.as_mut() {
                    screens.resize(size.width, size.height);
                }
            }
            WindowEvent::RedrawRequested => self.draw(),
            WindowEvent::KeyboardInput { event, .. } => {
                let PhysicalKey::Code(code) = event.physical_key else { return };
                if code == KeyCode::Escape {
                    if event.state == ElementState::Pressed && !event.repeat {
                        self.toggle_menu();
                    }
                } else if let Some((_, name)) = KEYS.iter().find(|(k, _)| *k == code) {
                    self.hold(name, event.state);
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.cursor = (position.x as f32, position.y as f32);
                self.update_stylus();
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if self.menu && button == MouseButton::Left {
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

/// `seconds` : quitter après tant de secondes réelles (pour une mesure), sinon à la fermeture de la fenêtre.
pub fn run(scale: u32, seconds: Option<f64>, shot: Option<(f64, String)>) -> Result<(), String> {
    let root = find_root();
    let mut options = Options::new(&root);
    options.out = root.join("local/analyse/runtime/play");
    options.seconds = f64::INFINITY;
    options.draw = true;
    options.live = true;
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
        window: None,
        screens: None,
        last_top: 0,
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
    Ok(())
}
