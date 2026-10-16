//! Le romfs « vu par le jeu » avec des fichiers de mods par-dessus (sans rien recopier du jeu).
//! Port de `mods/modkit/overlay.py` (`OverlayRomfs`) et de `overlay_romfs` (`banc/romfs.py`).
//!
//! On part d'un romfs réel (`RomfsSource`, par exemple `NcchRomfs`). Son arbre est lu, les fichiers superposés y
//! remplacent ceux de même chemin (ou s'ajoutent), les tables sont refabriquées (`tree`) et les données sont
//! servies à la volée : tantôt depuis le romfs d'origine, tantôt depuis le fichier du mod. Le jeu parse lui-même
//! l'arbre qu'on lui rend, comme sur la console avec les fichiers de LayeredFS.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::{Seek, SeekFrom};
use std::path::PathBuf;
use std::rc::Rc;

use crate::ncch::read_full;
use crate::tree::{self, FileSource, Tree};
use crate::{RomfsError, RomfsSource};

pub struct OverlayRomfs {
    base: Rc<dyn RomfsSource>,
    tree: Tree,
    size: u64,
    tables: Vec<u8>,
    /// (début, fin, indice du fichier de l'arbre), trié, fichiers vides exclus.
    segments: Vec<(u64, u64, usize)>,
    starts: Vec<u64>,
    hits: RefCell<BTreeMap<String, u64>>,
    replaced: Vec<String>,
    added: Vec<String>,
    /// Chemin -> (position, taille) dans le romfs d'origine.
    original: BTreeMap<String, (u64, u64)>,
    host: RefCell<HashMap<PathBuf, fs::File>>,
}

impl OverlayRomfs {
    /// `base` : le romfs d'origine ; `replacements` : chemin du romfs -> chemin du fichier sur le disque.
    /// Sans `allow_new`, les chemins absents du romfs sont ignorés.
    pub fn new(
        base: Rc<dyn RomfsSource>,
        replacements: BTreeMap<String, PathBuf>,
        allow_new: bool,
    ) -> Result<OverlayRomfs, RomfsError> {
        let mut tree = tree::parse(&*base)?;
        let mut replaced = Vec::new();
        let mut added = Vec::new();
        let mut original = BTreeMap::new();
        for (path, host) in replacements {
            let size = fs::metadata(&host).map_err(|source| RomfsError::Io { path: host.clone(), source })?.len();
            match tree.find_file(&path) {
                Some(index) => {
                    if let FileSource::Level3 { position, size: old } = tree.files[index].source {
                        original.insert(path.clone(), (position, old));
                    }
                    tree.files[index].source = FileSource::Host(host);
                    tree.files[index].size = size;
                    replaced.push(path);
                }
                None if allow_new => {
                    tree.add_file(&path, size, FileSource::Host(host));
                    added.push(path);
                }
                None => {}
            }
        }
        let built = tree.build();
        let mut segments: Vec<(u64, u64, usize)> = built
            .positions
            .iter()
            .filter(|&&(i, _)| tree.files[i].size > 0)
            .map(|&(i, p)| (p, p + tree.files[i].size, i))
            .collect();
        segments.sort();
        let starts = segments.iter().map(|s| s.0).collect();
        Ok(OverlayRomfs {
            base,
            tree,
            size: built.end,
            tables: built.tables,
            segments,
            starts,
            hits: RefCell::new(BTreeMap::new()),
            replaced,
            added,
            original,
            host: RefCell::new(HashMap::new()),
        })
    }

    /// Ferme les fichiers de mods ouverts.
    pub fn close(&self) {
        self.host.borrow_mut().clear();
    }

    /// Chemin -> nombre de lectures tombées dans le fichier du mod.
    pub fn hits(&self) -> BTreeMap<String, u64> {
        self.hits.borrow().clone()
    }

    pub fn replaced(&self) -> &[String] {
        &self.replaced
    }

    pub fn added(&self) -> &[String] {
        &self.added
    }

    /// (position, taille) d'un fichier remplacé dans le romfs d'origine.
    pub fn original(&self, path: &str) -> Option<(u64, u64)> {
        self.original.get(path).copied()
    }

    pub fn tree(&self) -> &Tree {
        &self.tree
    }

    pub fn wants(&self, path: &str) -> bool {
        self.replaced.iter().any(|p| p == path) || self.added.iter().any(|p| p == path)
    }

    /// Lit `take` octets du fichier du mod à `offset` ; complète par des zéros si le fichier a raccourci depuis
    /// la construction (les positions suivantes restent justes).
    fn read_host(&self, host: &PathBuf, offset: u64, take: usize) -> Result<Vec<u8>, RomfsError> {
        let io = |source| RomfsError::Io { path: host.clone(), source };
        let mut files = self.host.borrow_mut();
        if !files.contains_key(host) {
            files.insert(host.clone(), fs::File::open(host).map_err(io)?);
        }
        let f = files.get_mut(host).ok_or_else(|| RomfsError::Truncated(host.display().to_string()))?;
        f.seek(SeekFrom::Start(offset)).map_err(io)?;
        let mut buf = vec![0u8; take];
        read_full(f, &mut buf).map_err(io)?;
        Ok(buf)
    }

    /// Comme `read`, mais une erreur sur un fichier de mod est rendue.
    pub fn try_read(&self, position: u64, size: usize) -> Result<Vec<u8>, RomfsError> {
        if position >= self.size {
            return Ok(Vec::new());
        }
        let end = position.saturating_add(size as u64).min(self.size);
        let mut out = Vec::with_capacity((end - position) as usize);
        let mut pos = position;
        let tables_len = self.tables.len() as u64;
        if pos < tables_len {
            let take = end.min(tables_len) - pos;
            out.extend_from_slice(&self.tables[pos as usize..(pos + take) as usize]);
            pos += take;
        }
        while pos < end {
            let i = self.starts.partition_point(|&s| s <= pos) as isize - 1;
            if i >= 0 && pos < self.segments[i as usize].1 {
                let (start, stop, index) = self.segments[i as usize];
                let take = (end.min(stop) - pos) as usize;
                match &self.tree.files[index].source {
                    FileSource::Host(host) => {
                        out.extend_from_slice(&self.read_host(host, pos - start, take)?);
                        let name = self.tree.path_of_file(index);
                        *self.hits.borrow_mut().entry(name).or_insert(0) += 1;
                    }
                    FileSource::Level3 { position: origin, .. } => {
                        let mut data = self.base.read(origin + (pos - start), take);
                        data.resize(take, 0);
                        out.extend_from_slice(&data);
                    }
                }
                pos += take as u64;
            } else {
                // remplissage entre deux fichiers
                let next = self.starts.get((i + 1) as usize).copied().unwrap_or(end);
                let take = end.min(next) - pos;
                out.resize(out.len() + take as usize, 0);
                pos += take;
            }
        }
        Ok(out)
    }

    /// (chemin, décalage) du fichier où tombe une position, ou `None`.
    pub fn which_file(&self, position: u64) -> Option<(String, u64)> {
        let i = self.starts.partition_point(|&s| s <= position) as isize - 1;
        if i >= 0 && position < self.segments[i as usize].1 {
            let (start, _, index) = self.segments[i as usize];
            return Some((self.tree.path_of_file(index), position - start));
        }
        None
    }

    /// Comme `which_file`, mais seulement si le fichier vient d'un mod.
    pub fn is_replaced_at(&self, position: u64) -> Option<(String, u64)> {
        self.which_file(position).filter(|(path, _)| self.wants(path))
    }

    /// Pour le journal du banc : si la lecture tombe dans un fichier de mod, ce qui a été servi et ce que le jeu
    /// aurait lu dans le romfs d'origine à la même place. Chaîne vide sinon.
    pub fn describe(&self, position: u64, data: &[u8]) -> String {
        let Some((path, offset)) = self.is_replaced_at(position) else { return String::new() };
        if data.is_empty() {
            return String::new();
        }
        let mut text = format!("FICHIER DE MOD {path}+{offset:#x}, {} octets servis", data.len());
        if let Some(&(start, size)) = self.original.get(&path) {
            if offset < size {
                let want = data.len().min((size - offset) as usize);
                let before = self.base.read(start + offset, want);
                let diff: Vec<usize> = (0..before.len().min(data.len())).filter(|&i| before[i] != data[i]).collect();
                if let Some(&i) = diff.first() {
                    text += &format!(
                        " ; DIFFÉRENT du romfs d'origine sur {} octet(s), le premier en {path}+{:#x} : origine {}, servi {}",
                        diff.len() + data.len() - before.len(),
                        offset + i as u64,
                        hex(&before[i..(i + 8).min(before.len())]),
                        hex(&data[i..(i + 8).min(data.len())]),
                    );
                } else {
                    text += " ; identique au romfs d'origine sur cette plage";
                }
            }
        } else {
            text += &format!(" ; fichier absent du jeu, servi : {}", hex(&data[..data.len().min(16)]));
        }
        text
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ")
}

impl RomfsSource for OverlayRomfs {
    fn size(&self) -> u64 {
        self.size
    }

    /// Une erreur sur un fichier de mod écourte la lecture (utiliser `try_read` pour la connaître).
    fn read(&self, position: u64, size: usize) -> Vec<u8> {
        self.try_read(position, size).unwrap_or_default()
    }

    fn files(&self) -> Vec<(String, u64, u64)> {
        self.segments.iter().map(|&(start, stop, index)| (self.tree.path_of_file(index), start, stop - start)).collect()
    }
}

/// Superpose au romfs du jeu de base et à celui de la mise à jour les fichiers d'un mod construit pour le PC
/// (lus par la crate `overlay` : `ov.files()`, `ov.disk_path`). Rend (base, mise à jour, la liste des surcouches).
///
/// Comme LayeredFS sur la console, un fichier remplace celui de même chemin dans chaque romfs qui le contient ; un
/// fichier que ni l'un ni l'autre ne contient est ajouté au jeu de base. Voir `mods/README.md`.
///
/// Écart avec le python : le résultat est un `Result`, car une surcouche peut échouer (fichier de mod illisible,
/// tables du romfs incohérentes).
#[allow(clippy::type_complexity)]
pub fn overlay_romfs(
    base: Option<Rc<dyn RomfsSource>>,
    update: Option<Rc<dyn RomfsSource>>,
    ov: &overlay::Overlay,
) -> Result<(Option<Rc<dyn RomfsSource>>, Option<Rc<dyn RomfsSource>>, Vec<Rc<OverlayRomfs>>), RomfsError> {
    let mut wanted: BTreeMap<String, PathBuf> = BTreeMap::new();
    for path in ov.files() {
        wanted.insert(path.to_string(), ov.disk_path(path)?);
    }
    let names_of = |src: &Option<Rc<dyn RomfsSource>>| -> BTreeSet<String> {
        match src {
            Some(s) => s.files().into_iter().map(|f| f.0).filter(|p| wanted.contains_key(p)).collect(),
            None => BTreeSet::new(),
        }
    };
    let in_base = names_of(&base);
    let in_update = names_of(&update);
    let mut made: Vec<Rc<OverlayRomfs>> = Vec::new();
    let mut out_base = base.clone();
    let mut out_update = update.clone();
    if let Some(b) = base {
        let picked = wanted
            .iter()
            .filter(|(p, _)| in_base.contains(*p) || !in_update.contains(*p))
            .map(|(p, h)| (p.clone(), h.clone()))
            .collect();
        let layer = Rc::new(OverlayRomfs::new(b, picked, true)?);
        out_base = Some(layer.clone());
        made.push(layer);
    }
    if let Some(u) = update {
        if !in_update.is_empty() {
            let picked = wanted.iter().filter(|(p, _)| in_update.contains(*p)).map(|(p, h)| (p.clone(), h.clone())).collect();
            let layer = Rc::new(OverlayRomfs::new(u, picked, false)?);
            out_update = Some(layer.clone());
            made.push(layer);
        }
    }
    Ok((out_base, out_update, made))
}
