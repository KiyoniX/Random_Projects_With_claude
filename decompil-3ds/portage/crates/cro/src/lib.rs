//! Le chargeur de modules .cro de la console (module `ro`), porté de `outils/cro_loader.py`.
//!
//! - [`format`] : le format CRO0 (`Cro`, `read_crr`, les constantes) ;
//! - [`linker`] : la mémoire de travail, `relocate`, `Linker` ;
//! - [`loader`] : ce que fait `banc/services/ldr_ro.py` autour du Linker, sans le noyau (`LoaderState`) ;
//! - [`sha256`] : l'empreinte des en-têtes, écrite ici (aucune dépendance).
//!
//! Les noms sont ceux du Python, en anglais ; les types de correction, les messages et le journal sont les
//! mêmes, mot pour mot, pour qu'on puisse comparer les deux sorties.

pub mod format;
pub mod linker;
pub mod loader;
pub mod sha256;

pub use format::*;
pub use linker::{
    ImportDetail, LoadedModule, Linker, Memory, Unresolved, layout, link_set, read_romfs, relocate,
};
pub use loader::{LoadedCro, LoaderState, UnloadedCro, WordWrite, convert_header};
