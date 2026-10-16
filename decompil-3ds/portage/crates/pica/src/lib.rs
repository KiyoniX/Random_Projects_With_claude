//! `pica` : la traduction du GPU PICA200 de la 3DS vers wgpu (Vulkan).
//!
//! - [`state`] : registres et listes de commandes ; [`vertex`] : tampons de sommets ;
//! - [`shader`] : programmes de sommets traduits en WGSL ; [`fragment`] : combinateur TEV en WGSL ;
//! - [`render`] : dessins, tampons de rendu, textures, mélange ; [`transfer`] : commandes de mémoire de gsp ;
//! - [`Pica`] : rejoue une capture et rend les images des deux écrans.

pub mod fragment;
pub mod memory;
pub mod render;
pub mod shader;
pub mod state;
pub mod transfer;
pub mod vertex;

use capture::{Capture, Command};
use formats::{decode_pixels, ColorFormat};

use memory::Memory;
use render::Renderer;
use state::GpuState;

/// L'éclairage par fragment est allumé quand le jeu a écrit le registre 0x1C6 et que son bit « éteint » est à zéro
/// (comme `raster.lighting_on` du banc).
pub fn lighting_on(state: &GpuState) -> bool {
    state.seen[0x1C6] && state.regs[0x1C6] & 1 == 0
}

/// L'image d'un écran rendu par un transfert vers l'écran.
pub struct ScreenImage {
    /// Rang du transfert dans la capture (à partir de 1).
    pub index: usize,
    /// Vrai pour l'écran du haut (400 points de large), faux pour celui du bas (320).
    pub top: bool,
    pub width: usize,
    pub height: usize,
    /// RGBA, alpha à 255.
    pub rgba: Vec<u8>,
    /// Vrai si l'image vient du tampon du GPU à l'échelle `scale` (sinon de la mémoire, à la taille native).
    pub from_gpu: bool,
    /// L'image sur le GPU (RGBA8, à la définition de l'échelle) quand elle y a été construite : pour l'afficher sans
    /// la relire.
    pub texture: Option<wgpu::Texture>,
}

pub struct Pica {
    pub state: GpuState,
    pub memory: Memory,
    pub renderer: Renderer,
    transfers: usize,
    /// Vrai (par défaut) : chaque transfert vers l'écran rend aussi les octets de l'image. Faux : seule la texture du
    /// GPU est rendue, sans attente de la file (le cas d'un affichage en direct).
    pub readback: bool,
    /// Vrai : les transferts vers l'écran passent toujours par la mémoire (comme avant la version paresseuse).
    pub eager_transfers: bool,
}

impl Pica {
    pub fn new(capture: &Capture, scale: u32) -> Result<Pica, String> {
        Ok(Pica {
            state: GpuState::from_capture(capture),
            memory: Memory::from_capture(capture),
            renderer: Renderer::new(scale)?,
            transfers: 0,
            readback: true,
            eager_transfers: false,
        })
    }

    /// Exécute une liste de commandes GPU.
    pub fn process_list(&mut self, data: &[u8]) {
        let Pica { state, memory, renderer, .. } = self;
        state.process_list(data, |st, indexed| renderer.draw(st, memory, indexed));
    }

    /// Une commande de la file de gsp, comme `replay.run_command` du banc. Rend l'image si c'est un transfert vers l'écran.
    pub fn run_command(&mut self, command: &Command) -> Option<ScreenImage> {
        let words = &command.words;
        let kind = command.kind();
        if kind == 3 && !self.eager_transfers {
            // le transfert vers l'écran se fait sur le GPU ; la mémoire n'est écrite que si quelqu'un la lit
            let (source, destination, in_dim, out_dim, flags) = (words[1], words[2], words[3], words[4], words[5]);
            if let Some(p) = self.renderer.present_transfer(&mut self.memory, source, destination, in_dim, out_dim, flags, self.readback) {
                self.transfers += 1;
                let top = (out_dim >> 16) == 400;
                return Some(ScreenImage { index: self.transfers, top, width: p.width, height: p.height, rgba: p.rgba, from_gpu: true, texture: p.texture });
            }
        }
        // ce que la commande lit est d'abord rendu à la mémoire ; ce qu'elle écrase n'est rendu que s'il en reste une partie
        let (reads, writes): (Vec<(u32, usize)>, Vec<(u32, usize)>) = match kind {
            0 => (vec![(words[1], words[3] as usize)], vec![(words[2], words[3] as usize)]),
            2 => (Vec::new(), transfer::fill_ranges(words)),
            3 => {
                let (read, written) = transfer::display_ranges(words[1], words[2], words[3], words[4], words[5]);
                (vec![read], vec![written])
            }
            4 => (vec![(words[1], transfer::copy_span(words[3], words[4]))], vec![(words[2], transfer::copy_span(words[3], words[5]))]),
            _ => (Vec::new(), Vec::new()),
        };
        for &(start, len) in &reads {
            self.renderer.sync_read(&mut self.memory, start, len);
        }
        for &(start, len) in &writes {
            self.renderer.before_write(&mut self.memory, start, len);
        }
        let result = self.execute(command);
        for &(start, len) in &writes {
            self.renderer.after_write(&mut self.memory, start, len);
        }
        result
    }

    fn execute(&mut self, command: &Command) -> Option<ScreenImage> {
        let words = &command.words;
        match command.kind() {
            0 => {
                let (source, destination, size) = (words[1], words[2], words[3] as usize);
                if let Some(data) = self.memory.read(source, size).map(|d| d.into_owned()) {
                    self.memory.write(destination, &data);
                }
                None
            }
            1 => {
                self.process_list(&command.data);
                None
            }
            2 => {
                transfer::memory_fill(&mut self.memory, words);
                None
            }
            3 => {
                let (source, destination, in_dim, out_dim, flags) = (words[1], words[2], words[3], words[4], words[5]);
                if transfer::display_transfer(&mut self.memory, source, destination, in_dim, out_dim, flags).is_err() {
                    return None;
                }
                self.transfers += 1;
                Some(self.screen_image(source, destination, in_dim, out_dim, flags))
            }
            4 => {
                transfer::texture_copy(&mut self.memory, words[1], words[2], words[3], words[4], words[5]);
                None
            }
            _ => None,
        }
    }

    fn screen_image(&mut self, source: u32, destination: u32, in_dim: u32, out_dim: u32, flags: u32) -> ScreenImage {
        let (rows, cols) = ((out_dim >> 16) as usize, (out_dim & 0xFFFF) as usize); // rows : colonnes de l'écran
        let top = rows == 400;
        let scale = self.renderer.scale() as usize;
        if scale > 1 {
            let (in_w, in_h) = ((in_dim & 0xFFFF) as usize, (in_dim >> 16) as usize);
            if let Some((big, rows)) = self.renderer.color_image(source, in_w) {
                let in_h = in_h.min(rows);
                let (reduced, w, h) = transfer::reduce(&big, in_w * scale, in_h * scale, (flags >> 24) & 3);
                let cropped = transfer::crop(&reduced, w, h, cols * scale, rows * scale);
                let (cw, ch) = ((cols * scale).min(w), (rows * scale).min(h));
                let cropped = if flags & 1 != 0 { transfer::flip_rows(&cropped, cw, ch) } else { cropped };
                let (width, height, rgba) = transfer::rotate_screen(&cropped, ch, cw);
                return ScreenImage { index: self.transfers, top, width, height, rgba, from_gpu: true, texture: None };
            }
        }
        let fmt = ColorFormat::from_gx((flags >> 12) & 7).unwrap_or(ColorFormat::Rgba8);
        let unit = fmt.bytes_per_pixel();
        let raw = self.memory.read(destination, rows * cols * unit).map(|r| r.into_owned()).unwrap_or_else(|| vec![0; rows * cols * unit]);
        let rgba = decode_pixels(fmt, &raw);
        let (width, height, rgba) = transfer::rotate_screen(&rgba, rows, cols);
        // une image qui ne vient pas d'un tampon vivant (l'écran d'avant la capture) est agrandie sans lissage
        let (width, height, rgba) = if scale > 1 { transfer::upscale_nearest(&rgba, width, height, scale) } else { (width, height, rgba) };
        ScreenImage { index: self.transfers, top, width, height, rgba, from_gpu: false, texture: None }
    }

    /// Envoie le travail au GPU et attend qu'il soit fini ; la mémoire n'est pas mise à jour (voir [`Pica::finish`]).
    pub fn wait_gpu(&mut self) {
        self.renderer.wait_idle();
    }

    /// Rend à la mémoire ce qui est encore dans le GPU.
    pub fn finish(&mut self) {
        self.renderer.flush(&mut self.memory);
    }
}
