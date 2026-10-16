//! Le niveau 3 d'un romfs (l'arbre de dossiers et de fichiers que le jeu lit), lu et refabriqué.
//! Port fidèle de `mods/modkit/romfs3.py`.
//!
//! Disposition (3dbrew) :
//!
//! - en-tête 0x28 : longueur 0x28, puis (décalage, taille) de la table de hachage des dossiers, de la table des
//!   dossiers, de la table de hachage des fichiers, de la table des fichiers, puis le début des données ;
//! - dossier : parent, frère suivant, premier sous-dossier, premier fichier, suivant du même casier, longueur du
//!   nom (en octets), nom en UTF-16, complété à 4 octets ;
//! - fichier : parent, frère suivant, décalage des données (u64), taille (u64), suivant du même casier, longueur du
//!   nom, nom ;
//! - hachage : `h = parent ^ 123456789`, puis pour chaque unité UTF-16 `h = ror32(h, 5) ^ unité` ; casier = `h %`
//!   taille de la table ; les entrées d'un même casier sont chaînées.
//!
//! `parse` lit un arbre et garde l'ordre des tables ; `Tree::build` refabrique tous les octets des tables. Sur
//! l'arbre non modifié, le résultat est identique octet pour octet à l'original. Une entrée ajoutée vient à la fin
//! de la table et de la liste de son dossier.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::{RomfsError, RomfsSource};

/// « Pas d'entrée suivante » dans les tables.
pub const NONE: u32 = 0xFFFF_FFFF;
/// Alignement des données des fichiers.
pub const DATA_ALIGN: u64 = 0x10;

/// D'où viennent les octets d'un fichier de l'arbre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileSource {
    /// Position et taille dans le niveau 3 d'origine (python : `(position, taille)`).
    Level3 { position: u64, size: u64 },
    /// Fichier d'un mod sur le disque (python : `('host', chemin)`).
    Host(PathBuf),
}

#[derive(Debug, Clone)]
pub struct Dir {
    pub name: String,
    /// Indice dans `Tree::dirs`, `None` pour la racine.
    pub parent: Option<usize>,
    /// Indices, dans l'ordre de la chaîne des frères.
    pub dirs: Vec<usize>,
    pub files: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct File {
    pub name: String,
    pub parent: usize,
    pub size: u64,
    pub source: FileSource,
}

/// Résultat de `Tree::build`.
#[derive(Debug, Clone)]
pub struct Built {
    /// Octets des tables, en-tête compris, complétés jusqu'au début des données.
    pub tables: Vec<u8>,
    /// (indice du fichier, position des données dans le niveau 3), dans l'ordre de la table des fichiers.
    pub positions: Vec<(usize, u64)>,
    /// Taille totale du niveau 3.
    pub end: u64,
}

#[derive(Debug, Clone)]
pub struct Tree {
    pub dirs: Vec<Dir>,
    pub files: Vec<File>,
}

impl Default for Tree {
    fn default() -> Self {
        Self::new()
    }
}

fn utf16_len(name: &str) -> usize {
    name.encode_utf16().count()
}

fn pad4(n: usize) -> usize {
    (n + 3) & !3
}

impl Tree {
    /// Un arbre avec la seule racine.
    pub fn new() -> Tree {
        Tree { dirs: vec![Dir { name: String::new(), parent: None, dirs: vec![], files: vec![] }], files: vec![] }
    }

    pub fn path_of_file(&self, index: usize) -> String {
        let f = &self.files[index];
        let mut parts = vec![f.name.as_str()];
        let mut d = f.parent;
        while d != 0 {
            parts.push(self.dirs[d].name.as_str());
            d = self.dirs[d].parent.unwrap_or(0);
        }
        parts.reverse();
        parts.join("/")
    }

    /// L'indice du dossier « a/0/7 » ; `None` s'il n'existe pas (ou le crée si `create`).
    pub fn find_dir(&mut self, path: &str, create: bool) -> Option<usize> {
        let mut d = 0;
        for part in path.split('/').filter(|p| !p.is_empty()) {
            match self.dirs[d].dirs.iter().copied().find(|&c| self.dirs[c].name == part) {
                Some(c) => d = c,
                None => {
                    if !create {
                        return None;
                    }
                    self.dirs.push(Dir { name: part.to_string(), parent: Some(d), dirs: vec![], files: vec![] });
                    let new = self.dirs.len() - 1;
                    self.dirs[d].dirs.push(new);
                    d = new;
                }
            }
        }
        Some(d)
    }

    fn find_dir_ro(&self, path: &str) -> Option<usize> {
        let mut d = 0;
        for part in path.split('/').filter(|p| !p.is_empty()) {
            d = self.dirs[d].dirs.iter().copied().find(|&c| self.dirs[c].name == part)?;
        }
        Some(d)
    }

    pub fn find_file(&self, path: &str) -> Option<usize> {
        let (folder, name) = path.rsplit_once('/').unwrap_or(("", path));
        let d = self.find_dir_ro(folder)?;
        self.dirs[d].files.iter().copied().find(|&i| self.files[i].name == name)
    }

    /// Ajoute un fichier (les dossiers manquants sont créés) à la fin de la table et de la liste de son dossier.
    pub fn add_file(&mut self, path: &str, size: u64, source: FileSource) -> usize {
        let (folder, name) = path.rsplit_once('/').unwrap_or(("", path));
        let d = self.find_dir(folder, true).unwrap_or(0);
        self.files.push(File { name: name.to_string(), parent: d, size, source });
        let i = self.files.len() - 1;
        self.dirs[d].files.push(i);
        i
    }

    pub fn all_paths(&self) -> Vec<String> {
        (0..self.files.len()).map(|i| self.path_of_file(i)).collect()
    }

    /// Refabrique les tables et les positions des données. Les données commencent juste après les tables (alignées
    /// sur 0x10), dans l'ordre de la table des fichiers, chacune alignée sur 0x10. Les tailles viennent de
    /// `File::size`.
    pub fn build(&self) -> Built {
        let mut dir_offsets = Vec::with_capacity(self.dirs.len());
        let mut off = 0usize;
        for d in &self.dirs {
            dir_offsets.push(off as u32);
            off += 0x18 + pad4(utf16_len(&d.name) * 2);
        }
        let dir_meta_size = off;
        let mut file_offsets = Vec::with_capacity(self.files.len());
        off = 0;
        for f in &self.files {
            file_offsets.push(off as u32);
            off += 0x20 + pad4(utf16_len(&f.name) * 2);
        }
        let file_meta_size = off;

        let dir_hash_n = hash_table_size(self.dirs.len());
        let file_hash_n = hash_table_size(self.files.len());
        let mut dir_hash = vec![NONE; dir_hash_n];
        let mut file_hash = vec![NONE; file_hash_n];
        let mut dir_next = vec![NONE; self.dirs.len()];
        let mut file_next = vec![NONE; self.files.len()];
        // casier : la dernière entrée insérée est en tête, comme makerom
        for (i, d) in self.dirs.iter().enumerate() {
            let parent = d.parent.map_or(0, |p| dir_offsets[p]);
            let bucket = name_hash(parent, &d.name) as usize % dir_hash_n;
            dir_next[i] = dir_hash[bucket];
            dir_hash[bucket] = dir_offsets[i];
        }
        for (i, f) in self.files.iter().enumerate() {
            let bucket = name_hash(dir_offsets[f.parent], &f.name) as usize % file_hash_n;
            file_next[i] = file_hash[bucket];
            file_hash[bucket] = file_offsets[i];
        }

        let mut positions = Vec::with_capacity(self.files.len());
        let mut pos = 0u64;
        let tables_size = 0x28 + dir_hash_n * 4 + dir_meta_size + file_hash_n * 4 + file_meta_size;
        let data_start = (tables_size as u64 + DATA_ALIGN - 1) & !(DATA_ALIGN - 1);
        for f in &self.files {
            pos = (pos + DATA_ALIGN - 1) & !(DATA_ALIGN - 1);
            positions.push(pos);
            pos += f.size;
        }

        // frères suivants, d'après l'ordre des listes des dossiers
        let mut dir_sibling = vec![NONE; self.dirs.len()];
        let mut file_sibling = vec![NONE; self.files.len()];
        for d in &self.dirs {
            for w in d.dirs.windows(2) {
                dir_sibling[w[0]] = dir_offsets[w[1]];
            }
            for w in d.files.windows(2) {
                file_sibling[w[0]] = file_offsets[w[1]];
            }
        }

        let dir_hash_off = 0x28u32;
        let dir_meta_off = dir_hash_off + dir_hash_n as u32 * 4;
        let file_hash_off = dir_meta_off + dir_meta_size as u32;
        let file_meta_off = file_hash_off + file_hash_n as u32 * 4;
        let mut out: Vec<u8> = Vec::with_capacity(data_start as usize);
        for v in [
            0x28,
            dir_hash_off,
            dir_hash_n as u32 * 4,
            dir_meta_off,
            dir_meta_size as u32,
            file_hash_off,
            file_hash_n as u32 * 4,
            file_meta_off,
            file_meta_size as u32,
            data_start as u32,
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        for v in &dir_hash {
            out.extend_from_slice(&v.to_le_bytes());
        }
        for (i, d) in self.dirs.iter().enumerate() {
            let parent = d.parent.map_or(0, |p| dir_offsets[p]);
            let child_dir = d.dirs.first().map_or(NONE, |&c| dir_offsets[c]);
            let child_file = d.files.first().map_or(NONE, |&c| file_offsets[c]);
            let name = utf16_bytes(&d.name);
            for v in [parent, dir_sibling[i], child_dir, child_file, dir_next[i], name.len() as u32] {
                out.extend_from_slice(&v.to_le_bytes());
            }
            out.extend_from_slice(&name);
            out.resize(out.len() + (pad4(name.len()) - name.len()), 0);
        }
        for v in &file_hash {
            out.extend_from_slice(&v.to_le_bytes());
        }
        for (i, f) in self.files.iter().enumerate() {
            let name = utf16_bytes(&f.name);
            out.extend_from_slice(&dir_offsets[f.parent].to_le_bytes());
            out.extend_from_slice(&file_sibling[i].to_le_bytes());
            out.extend_from_slice(&positions[i].to_le_bytes());
            out.extend_from_slice(&f.size.to_le_bytes());
            out.extend_from_slice(&file_next[i].to_le_bytes());
            out.extend_from_slice(&(name.len() as u32).to_le_bytes());
            out.extend_from_slice(&name);
            out.resize(out.len() + (pad4(name.len()) - name.len()), 0);
        }
        out.resize(data_start as usize, 0);
        Built {
            tables: out,
            positions: positions.iter().enumerate().map(|(i, p)| (i, data_start + p)).collect(),
            end: data_start + pos,
        }
    }
}

fn utf16_bytes(name: &str) -> Vec<u8> {
    name.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
}

/// Le hachage de nom du romfs (`parent_offset` : décalage de l'entrée du dossier parent).
pub fn name_hash(parent_offset: u32, name: &str) -> u32 {
    let mut h = parent_offset ^ 123_456_789;
    for u in name.encode_utf16() {
        h = h.rotate_right(5) ^ u as u32;
    }
    h
}

/// Taille de la table de hachage pour `count` entrées.
pub fn hash_table_size(count: usize) -> usize {
    if count < 3 {
        return 3;
    }
    if count < 19 {
        return count | 1;
    }
    let mut n = count;
    while [2, 3, 5, 7, 11, 13, 17].iter().any(|p| n % p == 0) {
        n += 1;
    }
    n
}

fn u32_at(buf: &[u8], pos: usize, what: &str) -> Result<u32, RomfsError> {
    buf.get(pos..pos + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| RomfsError::Malformed(format!("{what} : lecture hors table en {pos:#x}")))
}

fn u64_at(buf: &[u8], pos: usize, what: &str) -> Result<u64, RomfsError> {
    Ok(u32_at(buf, pos, what)? as u64 | (u32_at(buf, pos + 4, what)? as u64) << 32)
}

fn read_exact(src: &dyn RomfsSource, position: u64, size: u64, what: &str) -> Result<Vec<u8>, RomfsError> {
    let size = usize::try_from(size).map_err(|_| RomfsError::Truncated(what.to_string()))?;
    let v = src.read(position, size);
    if v.len() != size {
        return Err(RomfsError::Truncated(what.to_string()));
    }
    Ok(v)
}

fn name_at(buf: &[u8], pos: usize, length: usize, what: &str) -> Result<String, RomfsError> {
    let raw = buf
        .get(pos..pos.saturating_add(length))
        .ok_or_else(|| RomfsError::Malformed(format!("{what} : nom hors table en {pos:#x}")))?;
    let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    Ok(String::from_utf16_lossy(&units))
}

/// Lit l'arbre d'un niveau 3 ; `File::source` = `FileSource::Level3 { position des données, taille }`.
pub fn parse(src: &dyn RomfsSource) -> Result<Tree, RomfsError> {
    let header = read_exact(src, 0, 0x28, "en-tête du niveau 3")?;
    let mut h = [0u32; 10];
    for (i, v) in h.iter_mut().enumerate() {
        *v = u32_at(&header, i * 4, "en-tête")?;
    }
    if h[0] != 0x28 {
        return Err(RomfsError::BadHeader(h[0]));
    }
    let (dir_off, dir_size, file_off, file_size, data_off) =
        (h[3] as u64, h[4] as u64, h[7] as u64, h[8] as u64, h[9] as u64);
    let dirs = read_exact(src, dir_off, dir_size, "table des dossiers")?;
    let files = read_exact(src, file_off, file_size, "table des fichiers")?;

    struct RawDir {
        pos: usize,
        parent: u32,
        child_dir: u32,
        child_file: u32,
    }
    let mut tree = Tree { dirs: vec![], files: vec![] };
    let mut by_offset: HashMap<u32, usize> = HashMap::new();
    let mut raw_dirs = Vec::new();
    // dossiers, dans l'ordre de la table
    let mut pos = 0usize;
    while pos < dirs.len() {
        let parent = u32_at(&dirs, pos, "dossier")?;
        let child_dir = u32_at(&dirs, pos + 8, "dossier")?;
        let child_file = u32_at(&dirs, pos + 12, "dossier")?;
        let length = u32_at(&dirs, pos + 20, "dossier")? as usize;
        let name = name_at(&dirs, pos + 0x18, length, "dossier")?;
        by_offset.insert(pos as u32, tree.dirs.len());
        tree.dirs.push(Dir { name, parent: None, dirs: vec![], files: vec![] });
        raw_dirs.push(RawDir { pos, parent, child_dir, child_file });
        pos += 0x18 + pad4(length);
    }
    if tree.dirs.is_empty() {
        return Err(RomfsError::Malformed("table des dossiers vide".into()));
    }
    for r in &raw_dirs {
        let i = by_offset[&(r.pos as u32)];
        tree.dirs[i].parent = if r.pos == 0 {
            None
        } else {
            Some(*by_offset.get(&r.parent).ok_or_else(|| {
                RomfsError::Malformed(format!("dossier {:#x} : parent {:#x} inconnu", r.pos, r.parent))
            })?)
        };
        let mut c = r.child_dir;
        let mut steps = 0;
        while c != NONE {
            steps += 1;
            if steps > raw_dirs.len() {
                return Err(RomfsError::Malformed("chaîne de sous-dossiers qui boucle".into()));
            }
            let idx = *by_offset.get(&c).ok_or_else(|| {
                RomfsError::Malformed(format!("sous-dossier {c:#x} inconnu (dossier {:#x})", r.pos))
            })?;
            tree.dirs[i].dirs.push(idx);
            c = u32_at(&dirs, c as usize + 4, "frère de dossier")?;
        }
    }
    // fichiers, dans l'ordre de la table
    let mut file_by_offset: HashMap<u32, usize> = HashMap::new();
    let mut pos = 0usize;
    while pos < files.len() {
        let parent = u32_at(&files, pos, "fichier")?;
        let data = u64_at(&files, pos + 8, "fichier")?;
        let size = u64_at(&files, pos + 16, "fichier")?;
        let length = u32_at(&files, pos + 28, "fichier")? as usize;
        let name = name_at(&files, pos + 0x20, length, "fichier")?;
        let parent = *by_offset
            .get(&parent)
            .ok_or_else(|| RomfsError::Malformed(format!("fichier {pos:#x} : dossier parent {parent:#x} inconnu")))?;
        file_by_offset.insert(pos as u32, tree.files.len());
        tree.files.push(File { name, parent, size, source: FileSource::Level3 { position: data_off + data, size } });
        pos += 0x20 + pad4(length);
    }
    for r in &raw_dirs {
        let i = by_offset[&(r.pos as u32)];
        let mut c = r.child_file;
        let mut steps = 0;
        while c != NONE {
            steps += 1;
            if steps > tree.files.len() {
                return Err(RomfsError::Malformed("chaîne de fichiers qui boucle".into()));
            }
            let idx = *file_by_offset
                .get(&c)
                .ok_or_else(|| RomfsError::Malformed(format!("fichier {c:#x} inconnu (dossier {:#x})", r.pos)))?;
            tree.dirs[i].files.push(idx);
            c = u32_at(&files, c as usize + 4, "frère de fichier")?;
        }
    }
    Ok(tree)
}
