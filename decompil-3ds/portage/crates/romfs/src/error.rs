//! Les erreurs de la crate `romfs`.

use std::fmt;
use std::io;
use std::path::PathBuf;

/// Erreurs de lecture d'un romfs et de fabrication d'une surcouche.
#[derive(Debug)]
pub enum RomfsError {
    /// Lecture ou ouverture d'un fichier impossible.
    Io { path: PathBuf, source: io::Error },
    /// Le fichier n'est pas un NCCH.
    NotNcch(PathBuf),
    /// Le NCCH est chiffré (on lit les dumps déchiffrés).
    Encrypted(PathBuf),
    /// Pas d'en-tête IVFC au début du romfs.
    NoIvfc(PathBuf),
    /// Le niveau 3 ne commence pas par 0x28.
    BadLevel3(PathBuf),
    /// En-tête de niveau 3 inattendu (longueur lue).
    BadHeader(u32),
    /// Lecture plus courte que prévu dans le romfs (ce qu'on voulait lire).
    Truncated(String),
    /// Tables du romfs incohérentes (description).
    Malformed(String),
    /// Erreur du lecteur de `overlay.json`.
    Overlay(overlay::OverlayError),
}

impl fmt::Display for RomfsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, source } => write!(f, "lecture de {} impossible : {source}", path.display()),
            Self::NotNcch(p) => write!(f, "{} : pas un NCCH", p.display()),
            Self::Encrypted(p) => {
                write!(f, "{} : NCCH chiffré (on lit les dumps déchiffrés)", p.display())
            }
            Self::NoIvfc(p) => write!(f, "{} : pas d'en-tête IVFC au début du romfs", p.display()),
            Self::BadLevel3(p) => write!(f, "{} : le niveau 3 ne commence pas par 0x28", p.display()),
            Self::BadHeader(n) => write!(f, "en-tête de niveau 3 inattendu ({n:#x})"),
            Self::Truncated(what) => write!(f, "romfs trop court : {what}"),
            Self::Malformed(what) => write!(f, "tables du romfs incohérentes : {what}"),
            Self::Overlay(e) => write!(f, "surcouche : {e}"),
        }
    }
}

impl std::error::Error for RomfsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Overlay(e) => Some(e),
            _ => None,
        }
    }
}

impl From<overlay::OverlayError> for RomfsError {
    fn from(e: overlay::OverlayError) -> Self {
        Self::Overlay(e)
    }
}
