//! `portage play` : le jeu en direct dans une fenêtre. Un seul fil : la boucle de winit mène le runtime par tranches
//! (`Bench::run_slice`), le temps du jeu rattrape le temps réel (deux images de retard au plus, au-delà le jeu ralentit),
//! puis les dernières images des deux écrans sont présentées telles que pica les a construites sur le GPU.
//!
//! Touches (voir le README) : flèches = croix, X = A, Z = B, S = X, A = Y, Q = L, W = R, Entrée = START,
//! Retour arrière = SELECT, Échap quitte.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use runtime::bench::{BUTTONS, Bench, Options, find_root};
use runtime::gpu::Shared;
use services::gsp::VBLANK_NS;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

use pica::images::save_png;

use crate::window::{Screens, open};

/// Touche -> bouton de la console (nom de `BUTTONS`).
const KEYS: [(KeyCode, &str); 12] = [
    (KeyCode::KeyX, "A"),
    (KeyCode::KeyZ, "B"),
    (KeyCode::KeyS, "X"),
    (KeyCode::KeyA, "Y"),
    (KeyCode::KeyQ, "L"),
    (KeyCode::KeyW, "R"),
    (KeyCode::Enter, "START"),
    (KeyCode::Backspace, "SELECT"),
    (KeyCode::ArrowUp, "UP"),
    (KeyCode::ArrowDown, "DOWN"),
    (KeyCode::ArrowLeft, "LEFT"),
    (KeyCode::ArrowRight, "RIGHT"),
];

fn button(code: KeyCode) -> Option<u32> {
    let name = KEYS.iter().find(|(k, _)| *k == code)?.1;
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
}

impl Play {
    /// Fait avancer le jeu jusqu'au temps réel, deux images au plus.
    fn step(&mut self) {
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

    fn draw(&mut self) {
        let Some(screens) = self.screens.as_mut() else { return };
        let images = self.shared.screens.borrow();
        if let Some(top) = &images[0] {
            if top.index != self.last_top {
                self.last_top = top.index;
                self.second.game_frames += 1;
                self.first_frame.get_or_insert(self.started.elapsed().as_secs_f64());
            }
        }
        let textures: Vec<Option<wgpu::Texture>> = images.iter().map(|i| i.as_ref().map(|i| screens.texture(i))).collect();
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
        screens.draw([textures[0].as_ref(), textures[1].as_ref()], false);
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
        let window = open(event_loop, "Pokémon X, portage PC");
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
                    event_loop.exit();
                } else if let Some(bit) = button(code) {
                    let held = &mut self.bench.kernel.bench.buttons;
                    *held = if event.state == ElementState::Pressed { *held | bit } else { *held & !bit };
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
