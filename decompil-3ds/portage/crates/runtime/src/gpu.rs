//! Le GPU derrière la file de gsp : sans dessin (le journal du banc Python sans `--dessiner`), ou `pica` en direct sur
//! la mémoire du noyau, sans copie, avec les images PNG des écrans aux mêmes instants et sous les mêmes noms que
//! `banc/run.py --dessiner` (`snapshot` et `dump_screens`).

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Instant;

use capture::Command;
use formats::{decode_pixels, ColorFormat};
use kernel::kernel::{Kernel, LINEAR_BASE};
use pica::images::save_png;
use pica::memory::Memory;
use pica::{transfer, Pica, ScreenImage};
use services::gsp::{GpuBackend, Gsp};

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
}

/// Écran (0 haut, 1 bas) -> l'image du dernier transfert vers lui (celui de `latest_transfer`).
pub type Screens = [Option<ScreenImage>; 2];

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
}

impl PicaBackend {
    /// `folder` : où écrire les PNG (vidé de ses anciens PNG, comme le banc), ou `None` pour l'affichage en direct.
    pub fn new(k: &Kernel, scale: u32, folder: Option<PathBuf>) -> Result<PicaBackend, String> {
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
        Ok(PicaBackend {
            pica,
            folder,
            screens: Rc::new(RefCell::new([None, None])),
            next_snapshot: 0.0,
            snapshot_transfers: 0,
            stats: Rc::new(RefCell::new(DrawStats::default())),
        })
    }

    pub fn shared(&self) -> Shared {
        Shared { stats: self.stats.clone(), screens: self.screens.clone(), gpu: self.pica.renderer.gpu() }
    }

    fn run(&mut self, k: &mut Kernel, words: [u32; 8], list: Vec<u8>) -> Result<(), String> {
        let kind = words[0] & 0xFF;
        if kind == 0 {
            // la source ou la destination peut être hors de la mémoire du GPU (le tas de l'application) : la copie
            // passe par le noyau, entre ce que pica doit d'abord rendre à la mémoire et ce qu'il doit ensuite oublier
            let (source, destination, size) = (words[1], words[2], words[3]);
            let Pica { memory, renderer, .. } = &mut self.pica;
            renderer.sync_read(memory, source, size as usize);
            renderer.before_write(memory, destination, size as usize);
            if !k.memory.is_mapped(destination, size) {
                return Err("destination hors mémoire".to_string()); // gsp refait la copie et note le refus
            }
            let data = k.memory.read(source, size).map_err(|e| e.to_string())?;
            k.memory.write(destination, &data).map_err(|e| e.to_string())?;
            renderer.after_write(memory, destination, size as usize);
            return Ok(());
        }
        if kind == 2 && transfer::fill_ranges(&words).iter().any(|&(start, len)| self.pica.memory.read(start, len).is_none()) {
            return Err("hors de la mémoire du GPU".to_string()); // gsp remplit (ou refuse) lui-même
        }
        let image = self.pica.run_command(&Command { words, data: list });
        if let Some(image) = image.filter(|i| words[4] & 0xFFFF == 240 && i.width > 0) {
            if self.folder.is_none() {
                // en direct, la fenêtre dessine l'image de son côté : le travail qui la construit doit déjà être parti
                self.pica.renderer.submit();
            }
            let screen = if image.top { 0 } else { 1 };
            self.screens.borrow_mut()[screen] = Some(image);
        }
        Ok(())
    }

    /// L'image annoncée par le jeu pour un écran qui n'a pas encore reçu de transfert (`screen_image` du banc).
    fn announced(k: &Kernel, gsp: &Gsp, screen: usize, scale: usize) -> Option<(usize, usize, Vec<u8>)> {
        let &(_, address, format, stride) = gsp.frames[screen].last()?;
        let fmt = ColorFormat::from_gx(format & 7)?;
        let (width, column) = (if screen == 0 { 400 } else { 320 }, 240 * fmt.bytes_per_pixel());
        let stride = stride as usize;
        if stride < column {
            return None;
        }
        let raw = k.memory.read(address, (stride * width) as u32).ok()?;
        let columns: Vec<u8> = raw.chunks(stride).flat_map(|c| &c[..column]).copied().collect();
        let (w, h, rgba) = transfer::rotate_screen(&decode_pixels(fmt, &columns), width, 240);
        Some(if scale > 1 { transfer::upscale_nearest(&rgba, w, h, scale) } else { (w, h, rgba) })
    }
}

impl GpuBackend for PicaBackend {
    fn command(&mut self, k: &mut Kernel, words: [u32; 8], list: Vec<u8>) -> Result<(), String> {
        // le jeu a pu écrire n'importe où depuis la commande précédente : les caches revalident tout
        let start = Instant::now();
        self.pica.memory.touch_all();
        let touched = start.elapsed().as_secs_f64();
        let result = self.run(k, words, list);
        let mut stats = self.stats.borrow_mut();
        stats.commands += 1;
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
        for (screen, label) in [(0usize, "haut"), (1, "bas")] {
            let path = folder.join(format!("{prefix}{label}.png"));
            let saved = match (&self.screens.borrow()[screen], gsp.latest_transfer.contains_key(&(screen as u32))) {
                (Some(image), true) => save_png(&path, image.width, image.height, &image.rgba),
                _ => match Self::announced(k, gsp, screen, self.pica.renderer.scale() as usize) {
                    Some((w, h, rgba)) => save_png(&path, w, h, &rgba),
                    None => continue,
                },
            };
            if let Err(e) = saved {
                eprintln!("{} : {e}", path.display());
            }
        }
    }
}
