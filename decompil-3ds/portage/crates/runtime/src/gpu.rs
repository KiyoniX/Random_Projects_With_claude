//! Le GPU derrière la file de gsp : sans dessin (le journal du banc Python sans `--dessiner`), ou `pica` en direct sur
//! la mémoire du noyau, sans copie, avec les images PNG des écrans aux mêmes instants et sous les mêmes noms que
//! `banc/run.py --dessiner` (`snapshot` et `dump_screens`).

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Instant;

use capture::Command;
use formats::ColorFormat;
use kernel::kernel::{Kernel, LINEAR_BASE};
use pica::images::save_png;
use pica::memory::Memory;
use pica::{transfer, Pica, ScreenImage};
use services::gsp::{transfer_screen, GpuBackend, Gsp};

const VRAM: u32 = 0x1F00_0000;

/// Le GPU sans dessin : copies et remplissages laissés à gsp, le reste tenu pour fait (comme le banc Python sans
/// `--dessiner`, au journal).
pub struct NoDrawing;

impl GpuBackend for NoDrawing {
    fn command(&mut self, _k: &mut Kernel, words: [u32; 8], _list: Vec<u8>) -> Result<(), String> {
        if matches!(words[0] & 0xFF, 0 | 2) { Err("à gsp".to_string()) } else { Ok(()) }
    }
}

/// Les chiffres du dessin, pour le résumé.
#[derive(Default)]
pub struct DrawStats {
    pub commands: u64,
    /// Temps passé dans `touch_all` (avant chaque commande) et dans `pica` (le reste de la commande), en secondes.
    pub touch_seconds: f64,
    pub pica_seconds: f64,
    pub snapshots: u32,
    /// Pipelines créés par pica et le temps passé à les créer (secondes) : ce que le cache sur disque abrège.
    pub pipelines: u64,
    pub pipeline_seconds: f64,
}

/// Écran (0 haut, 1 bas) -> (destination, image) du dernier transfert vers lui.
pub type Screens = [Option<(u32, ScreenImage)>; 2];

/// Ce que le GPU partage avec le résumé et la fenêtre (tout sur le même fil).
#[derive(Clone)]
pub struct Shared {
    pub stats: Rc<RefCell<DrawStats>>,
    pub screens: Rc<RefCell<Screens>>,
    pub gpu: pica::render::Gpu,
}

pub struct PicaBackend {
    pica: Pica,
    /// Où écrire les PNG ; `None` pour l'affichage en direct (ni PNG ni relecture des images).
    folder: Option<PathBuf>,
    screens: Rc<RefCell<Screens>>,
    next_snapshot: f64,
    snapshot_transfers: u64,
    stats: Rc<RefCell<DrawStats>>,
    /// `PORTAGE_FINISH_EACH` : tout ce que pica garde sur le GPU est rendu à la mémoire après chaque commande (mode de
    /// vérification : le journal doit rester le même qu'avec la mémoire paresseuse).
    finish_each: bool,
}

/// L'image d'un écran lue dans la mémoire du jeu (`screen_image` du banc), `stride` octets par colonne de l'écran.
fn screen_from_kernel(k: &Kernel, screen: usize, address: u32, format: u32, stride: u32, scale: usize) -> Option<(usize, usize, Vec<u8>)> {
    let fmt = ColorFormat::from_gx(format & 7)?;
    let (width, stride) = (if screen == 0 { 400 } else { 320 }, stride as usize);
    if stride < 240 * fmt.bytes_per_pixel() {
        return None;
    }
    let raw = k.memory.read(address, (stride * width) as u32).ok()?;
    Some(transfer::screen_from_memory(&raw, fmt, width, 240, stride, scale))
}

impl PicaBackend {
    /// `folder` : où écrire les PNG (vidé de ses anciens PNG, comme le banc), ou `None` pour l'affichage en direct ;
    /// `pipeline_cache` : le dossier du cache des pipelines sur disque (voir `Renderer::load_pipeline_cache`).
    pub fn new(k: &Kernel, scale: u32, folder: Option<PathBuf>, pipeline_cache: Option<&Path>) -> Result<PicaBackend, String> {
        let linear = k.linear_backing.clone();
        let vram = k.memory.find(VRAM).ok_or("pas de mémoire vidéo projetée")?;
        let mut memory = Memory::default();
        // SAFETY : chaque région garde le `Rc` de sa réserve ; le jeu, le noyau et pica tournent sur ce seul fil, et
        // `command` n'écrit par `k.memory` qu'entre deux appels à pica (voir `Memory::map_external`).
        unsafe {
            memory.map_external(LINEAR_BASE, linear.address(), linear.size, linear.clone());
            memory.map_external(VRAM, vram.host_pointer(), vram.size as usize, vram.backing.clone());
        }
        if let Some(folder) = &folder {
            if let Ok(entries) = std::fs::read_dir(folder) {
                for entry in entries.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "png")) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
            std::fs::create_dir_all(folder).map_err(|e| format!("{} : {e}", folder.display()))?;
        }
        let mut pica = Pica::live(memory, scale)?;
        pica.readback = folder.is_some();
        if let Some(cache) = pipeline_cache {
            pica.renderer.load_pipeline_cache(cache);
        }
        Ok(PicaBackend {
            pica,
            folder,
            screens: Rc::new(RefCell::new([None, None])),
            next_snapshot: 0.0,
            snapshot_transfers: 0,
            stats: Rc::new(RefCell::new(DrawStats::default())),
            finish_each: std::env::var_os("PORTAGE_FINISH_EACH").is_some(),
        })
    }

    pub fn shared(&self) -> Shared {
        Shared { stats: self.stats.clone(), screens: self.screens.clone(), gpu: self.pica.renderer.gpu() }
    }

    fn run(&mut self, k: &mut Kernel, words: [u32; 8], list: Vec<u8>) -> Result<(), String> {
        let kind = words[0] & 0xFF;
        // une commande que le noyau refuse est refusée avant que pica n'y touche : ses tampons n'oublient rien ; pour 0 et
        // 2, gsp la refait lui-même et note le refus du banc
        if kind == 0 {
            // la source ou la destination peut être hors de la mémoire du GPU (le tas de l'application) : la copie
            // passe par le noyau, entre ce que pica doit d'abord rendre à la mémoire et ce qu'il doit ensuite oublier
            let (source, destination, size) = (words[1], words[2], words[3]);
            if !k.memory.is_mapped(source, size) || !k.memory.is_mapped(destination, size) {
                return Err("hors mémoire".to_string());
            }
            let Pica { memory, renderer, .. } = &mut self.pica;
            renderer.sync_read(memory, source, size as usize);
            renderer.before_write(memory, destination, size as usize);
            let data = k.memory.read(source, size).map_err(|e| e.to_string())?;
            k.memory.write(destination, &data).map_err(|e| e.to_string())?;
            renderer.after_write(memory, destination, size as usize);
            return Ok(());
        }
        if kind == 2 && transfer::fill_ranges(&words).iter().any(|&(start, len)| !k.memory.is_mapped(start, len as u32)) {
            return Err("hors mémoire".to_string());
        }
        transfer::check(&words, &|address, len, writing| k.memory.check(address, len as u32, writing).map_err(|e| e.to_string()))?;
        let image = self.pica.run_command(&Command { words, data: list })?;
        if let (Some(image), Some(screen)) = (image.filter(|i| i.width > 0), transfer_screen(words[4])) {
            if self.folder.is_none() {
                // en direct, la fenêtre dessine l'image de son côté : le travail qui la construit doit déjà être parti
                self.pica.renderer.submit();
            }
            self.screens.borrow_mut()[screen] = Some((words[2], image));
        }
        Ok(())
    }
}

impl GpuBackend for PicaBackend {
    fn command(&mut self, k: &mut Kernel, words: [u32; 8], list: Vec<u8>) -> Result<(), String> {
        // le jeu a pu écrire n'importe où depuis la commande précédente : les caches revalident tout
        let start = Instant::now();
        self.pica.memory.touch_all();
        let touched = start.elapsed().as_secs_f64();
        let result = self.run(k, words, list);
        if self.finish_each {
            self.pica.finish();
        }
        let renderer = &self.pica.renderer.stats;
        let mut stats = self.stats.borrow_mut();
        stats.commands += 1;
        stats.pipelines = renderer.pipelines;
        stats.pipeline_seconds = renderer.time.get("pipeline").copied().unwrap_or(0.0);
        stats.touch_seconds += touched;
        stats.pica_seconds += start.elapsed().as_secs_f64() - touched;
        result
    }

    /// `snapshot` du banc : au plus une paire d'images par seconde du banc, et seulement si un transfert a eu lieu.
    fn vblank(&mut self, k: &mut Kernel, gsp: &Gsp) {
        let now = k.now as f64 / 1e9;
        let Some(folder) = &self.folder else { return };
        if now < self.next_snapshot || gsp.transfers == self.snapshot_transfers {
            return;
        }
        self.snapshot_transfers = gsp.transfers;
        self.pica.finish();
        self.next_snapshot = now + 1.0;
        let mut stats = self.stats.borrow_mut();
        stats.snapshots += 1;
        let prefix = format!("{:03}-{:06.2}s-", stats.snapshots, now);
        let scale = self.pica.renderer.scale() as usize;
        for (screen, label) in [(0usize, "haut"), (1, "bas")] {
            // comme le banc : rien tant que le jeu n'a pas annoncé d'image pour l'écran ; sinon le dernier transfert vers
            // lui, ou à défaut l'image annoncée, lus en mémoire, sauf si l'image du transfert est déjà là
            let Some(&(_, address, format, stride)) = gsp.frames[screen].last() else { continue };
            let latest = gsp.latest_transfer.get(&(screen as u32)).copied();
            let path = folder.join(format!("{prefix}{label}.png"));
            let saved = match (&self.screens.borrow()[screen], latest) {
                (Some((destination, image)), Some((address, ..))) if *destination == address => {
                    save_png(&path, image.width, image.height, &image.rgba)
                }
                _ => {
                    let (address, format, stride) = latest.unwrap_or((address, format, stride));
                    match screen_from_kernel(k, screen, address, format, stride, scale) {
                        Some((w, h, rgba)) => save_png(&path, w, h, &rgba),
                        None => continue,
                    }
                }
            };
            if let Err(e) = saved {
                eprintln!("{} : {e}", path.display());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel::memory::PERM_RW;
    use kernel::testing::test_kernel;
    use services::small::Hid;

    const LINEAR: u32 = LINEAR_BASE;
    /// Dans la réserve linéaire que pica voit en entier, mais pas projeté par le noyau.
    const OUTSIDE: u32 = LINEAR_BASE + 0x30_0000;

    /// Un noyau avec 2 Mio de tas linéaire et 64 Kio de mémoire vidéo, et pica dessus ; `None` sans GPU Vulkan.
    fn rig(folder: Option<PathBuf>) -> Option<(Kernel, PicaBackend)> {
        let (mut k, _) = test_kernel();
        let linear = k.linear_backing.clone();
        k.memory.map(LINEAR, 0x20_0000, PERM_RW, "tas linéaire", Some((&linear, 0))).unwrap();
        k.memory.map(VRAM, 0x1_0000, PERM_RW, "mémoire vidéo", None).unwrap();
        match PicaBackend::new(&k, 1, folder, None) {
            Ok(gpu) => Some((k, gpu)),
            Err(e) => {
                eprintln!("test sauté, pas de GPU : {e}");
                None
            }
        }
    }

    /// Transfert vers l'écran du haut : 240 x 400 RGBA8 en tuiles -> RGB8 en lignes.
    fn to_top(source: u32, destination: u32) -> [u32; 8] {
        [3, source, destination, 0x0190_00F0, 0x0190_00F0, 0x1000, 0, 0]
    }

    #[test]
    fn what_the_kernel_refuses_is_refused_before_pica() {
        let Some((mut k, mut gpu)) = rig(None) else { return };
        k.memory.write(LINEAR, &[1, 2, 3, 4]).unwrap();
        // copie : vérifiée avant que pica ne rende ou n'oublie ses tampons, refaite par gsp (qui note le refus)
        assert!(gpu.command(&mut k, [0, LINEAR, OUTSIDE, 4, 0, 0, 0, 0], Vec::new()).is_err());
        assert!(gpu.command(&mut k, [0, OUTSIDE, LINEAR + 0x100, 4, 0, 0, 0, 0], Vec::new()).is_err());
        assert_eq!(k.memory.read(LINEAR + 0x100, 4).unwrap(), [0; 4]);
        gpu.command(&mut k, [0, LINEAR, VRAM, 4, 0, 0, 0, 0], Vec::new()).unwrap();
        assert_eq!(k.memory.read(VRAM, 4).unwrap(), [1, 2, 3, 4]);
        // remplissage : une zone hors du noyau le rend à gsp
        assert!(gpu.command(&mut k, [2, LINEAR + 0x200, 0xFF, LINEAR + 0x210, OUTSIDE, 0xFF, OUTSIDE + 0x10, 0x200 << 16 | 0x200], Vec::new()).is_err());
        assert_eq!(k.memory.read(LINEAR + 0x200, 4).unwrap(), [0; 4]);
        gpu.command(&mut k, [2, LINEAR + 0x200, 0xAABB_CCDD, LINEAR + 0x208, 0, 0, 0, 0x200], Vec::new()).unwrap();
        assert_eq!(k.memory.read(LINEAR + 0x200, 8).unwrap(), [0xDD, 0xCC, 0xBB, 0xAA, 0xDD, 0xCC, 0xBB, 0xAA]);
        // transfert et copie de texture : les textes du banc, rien d'écrit, aucun écran
        assert_eq!(gpu.command(&mut k, to_top(OUTSIDE, LINEAR), Vec::new()), Err("source illisible (lecture hors mémoire à 0x14300000)".into()));
        assert_eq!(gpu.command(&mut k, to_top(LINEAR, LINEAR + 0x1F_FF00), Vec::new()), Err("destination refusée (écriture hors mémoire à 0x14200000)".into()));
        assert_eq!(gpu.command(&mut k, [4, LINEAR, OUTSIDE, 0x20, 0, 0, 0, 0], Vec::new()), Err("écriture hors mémoire à 0x14300000".into()));
        assert_eq!(gpu.command(&mut k, [3, LINEAR, LINEAR + 0x1000, 0, 0x0190_00F0, 0x1000, 0, 0], Vec::new()), Err("dimensions ou format illisibles".into()));
        assert!(gpu.screens.borrow().iter().all(Option::is_none));
        gpu.command(&mut k, to_top(LINEAR, LINEAR + 0x8_0000), Vec::new()).unwrap();
        let screens = gpu.screens.borrow();
        let (destination, image) = screens[0].as_ref().expect("l'écran du haut");
        assert_eq!((*destination, image.width, image.height), (LINEAR + 0x8_0000, 400, 240));
        assert!(screens[1].is_none());
    }

    #[test]
    fn snapshots_follow_the_bench() {
        let folder = std::env::temp_dir().join(format!("runtime-images-{}", std::process::id()));
        let Some((mut k, mut gpu)) = rig(Some(folder.clone())) else { return };
        let hid = Rc::new(RefCell::new(Hid::new(&mut k)));
        let mut gsp = Gsp::new(&k, hid);
        let names = || {
            let mut names: Vec<String> = std::fs::read_dir(&folder).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
            names.sort();
            names
        };
        // un transfert, mais aucune image annoncée : la paire est comptée, aucun PNG (comme `dump_screens`)
        gpu.command(&mut k, to_top(LINEAR, LINEAR + 0x8_0000), Vec::new()).unwrap();
        gsp.transfers = 1;
        gsp.latest_transfer.insert(0, (LINEAR + 0x8_0000, 1, 720));
        k.now = 500_000_000;
        gpu.vblank(&mut k, &gsp);
        assert!(names().is_empty());
        // les deux écrans annoncés : le haut est l'image du transfert, le bas l'image annoncée lue en mémoire
        gsp.frames[0].push((0, LINEAR + 0x8_0000, 1, 720));
        gsp.frames[1].push((0, LINEAR, 0, 960));
        gsp.transfers = 2;
        k.now = 1_000_000_000;
        gpu.vblank(&mut k, &gsp);
        k.now = 1_500_000_000;
        gpu.vblank(&mut k, &gsp);
        assert_eq!(names(), ["002-001.50s-bas.png", "002-001.50s-haut.png"]);
        // le dernier transfert vers le haut a changé d'adresse : relu en mémoire, pas l'image gardée
        k.memory.write(LINEAR + 0x10_0000, &[0x40; 720 * 400]).unwrap();
        gsp.latest_transfer.insert(0, (LINEAR + 0x10_0000, 1, 720));
        gsp.transfers = 3;
        k.now = 2_600_000_000;
        gpu.vblank(&mut k, &gsp);
        let read = |name: &str| std::fs::read(folder.join(name)).unwrap();
        assert_ne!(read("003-002.60s-haut.png"), read("002-001.50s-haut.png"));
        assert_eq!(read("003-002.60s-bas.png"), read("002-001.50s-bas.png"));
        let _ = std::fs::remove_dir_all(&folder);
    }
}
