//! Le romfs d'un NCCH déchiffré, et sa surcouche de mods. Port en Rust de `banc/romfs.py` (`NcchRomfs`,
//! `overlay_romfs`), de `mods/modkit/romfs3.py` (module `tree`) et de `mods/modkit/overlay.py` (`OverlayRomfs`).
//!
//! Les noms de l'API suivent le python : `size`, `read(position, taille)`, `files()` -> `(chemin, position des
//! données dans le niveau 3, taille)`, `describe`, `which_file`, `hits`, `wants`. Écarts imposés par Rust :
//! `size` est une méthode du trait `RomfsSource` ; `read` rend les octets lus (écourtés si une entrée-sortie
//! échoue, les variantes `try_read` rendent l'erreur) ; `overlay_romfs` rend un `Result`.
//!
//! Le romfs du jeu fait des centaines de Mo : il n'est jamais chargé, seules les tables de l'arbre sont gardées.

mod error;
mod layered;
mod ncch;
pub mod tree;

pub use error::RomfsError;
pub use layered::{OverlayRomfs, overlay_romfs};
pub use ncch::NcchRomfs;

/// Un niveau 3 de romfs lisible : le jeu de base, la mise à jour, ou une surcouche.
pub trait RomfsSource {
    /// Taille du niveau 3.
    fn size(&self) -> u64;
    /// Lit `size` octets à `position` (moins si on dépasse la fin, vide au-delà).
    fn read(&self, position: u64, size: usize) -> Vec<u8>;
    /// `(chemin, position des données dans le niveau 3, taille)` : pour savoir quel fichier une lecture vise.
    fn files(&self) -> Vec<(String, u64, u64)>;
}
