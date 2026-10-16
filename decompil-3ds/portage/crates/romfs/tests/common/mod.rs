//! Outils communs aux tests : un constructeur de niveau 3 indépendant de `Tree::build` (il pose les tables d'après
//! la description de 3dbrew), une source en mémoire, des dossiers temporaires, la recherche de python.
//! Aucun octet du jeu : tout est fabriqué.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use romfs::RomfsSource;

/// Un niveau 3 en mémoire.
pub struct MemRomfs {
    pub data: Vec<u8>,
    pub list: Vec<(String, u64, u64)>,
}

impl RomfsSource for MemRomfs {
    fn size(&self) -> u64 {
        self.data.len() as u64
    }
    fn read(&self, position: u64, size: usize) -> Vec<u8> {
        let start = (position as usize).min(self.data.len());
        let end = start.saturating_add(size).min(self.data.len());
        self.data[start..end].to_vec()
    }
    fn files(&self) -> Vec<(String, u64, u64)> {
        self.list.clone()
    }
}

fn pad4(n: usize) -> usize {
    (n + 3) & !3
}

fn hash(parent: u32, name: &str) -> u32 {
    let mut h = parent ^ 123456789;
    for unit in name.encode_utf16() {
        h = (h >> 5 | h << 27) ^ unit as u32;
    }
    h
}

fn table_size(count: usize) -> usize {
    match count {
        0..=2 => 3,
        3..=18 => count | 1,
        _ => (count..).find(|n| ![2, 3, 5, 7, 11, 13, 17].iter().any(|p| n % p == 0)).unwrap_or(count),
    }
}

/// Fabrique un niveau 3 : dossiers dans l'ordre de première apparition, fichiers dans l'ordre donné, données à la
/// suite des tables, alignées sur 0x10.
pub fn make_level3(entries: &[(&str, Vec<u8>)]) -> MemRomfs {
    // dossiers : (nom, indice du parent)
    let mut dirs: Vec<(String, usize)> = vec![(String::new(), 0)];
    let mut files: Vec<(String, usize, &Vec<u8>)> = Vec::new();
    for (path, content) in entries {
        let parts: Vec<&str> = path.split('/').collect();
        let mut d = 0;
        for part in &parts[..parts.len() - 1] {
            d = match (1..dirs.len()).find(|&i| dirs[i].1 == d && dirs[i].0 == *part) {
                Some(i) => i,
                None => {
                    dirs.push((part.to_string(), d));
                    dirs.len() - 1
                }
            };
        }
        files.push((parts[parts.len() - 1].to_string(), d, content));
    }
    let mut dir_off = Vec::new();
    let mut o = 0;
    for (name, _) in &dirs {
        dir_off.push(o as u32);
        o += 0x18 + pad4(name.encode_utf16().count() * 2);
    }
    let dir_meta = o;
    let mut file_off = Vec::new();
    o = 0;
    for (name, _, _) in &files {
        file_off.push(o as u32);
        o += 0x20 + pad4(name.encode_utf16().count() * 2);
    }
    let file_meta = o;
    let (dn, fnn) = (table_size(dirs.len()), table_size(files.len()));
    let mut dir_head = vec![u32::MAX; dn];
    let mut dir_chain = vec![u32::MAX; dirs.len()];
    for (i, (name, parent)) in dirs.iter().enumerate() {
        let p = if i == 0 { 0 } else { dir_off[*parent] };
        let b = hash(p, name) as usize % dn;
        dir_chain[i] = dir_head[b];
        dir_head[b] = dir_off[i];
    }
    let mut file_head = vec![u32::MAX; fnn];
    let mut file_chain = vec![u32::MAX; files.len()];
    for (i, (name, parent, _)) in files.iter().enumerate() {
        let b = hash(dir_off[*parent], name) as usize % fnn;
        file_chain[i] = file_head[b];
        file_head[b] = file_off[i];
    }
    let tables = 0x28 + dn * 4 + dir_meta + fnn * 4 + file_meta;
    let data_start = (tables + 15) & !15;
    let mut positions = Vec::new();
    let mut p = data_start;
    for (_, _, c) in &files {
        p = (p + 15) & !15;
        positions.push(p);
        p += c.len();
    }
    let mut out = Vec::new();
    let put = |out: &mut Vec<u8>, v: u32| out.extend_from_slice(&v.to_le_bytes());
    for v in [
        0x28,
        0x28,
        (dn * 4) as u32,
        (0x28 + dn * 4) as u32,
        dir_meta as u32,
        (0x28 + dn * 4 + dir_meta) as u32,
        (fnn * 4) as u32,
        (0x28 + dn * 4 + dir_meta + fnn * 4) as u32,
        file_meta as u32,
        data_start as u32,
    ] {
        put(&mut out, v);
    }
    for v in &dir_head {
        put(&mut out, *v);
    }
    for (i, (name, parent)) in dirs.iter().enumerate() {
        let sibling = (i + 1..dirs.len()).find(|&j| dirs[j].1 == *parent && j != 0).map_or(u32::MAX, |j| dir_off[j]);
        let child_dir = (1..dirs.len()).find(|&j| dirs[j].1 == i).map_or(u32::MAX, |j| dir_off[j]);
        let child_file = (0..files.len()).find(|&j| files[j].1 == i).map_or(u32::MAX, |j| file_off[j]);
        let raw: Vec<u8> = name.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let parent_off = if i == 0 { 0 } else { dir_off[*parent] };
        for v in [parent_off, if i == 0 { u32::MAX } else { sibling }, child_dir, child_file, dir_chain[i], raw.len() as u32] {
            put(&mut out, v);
        }
        out.extend_from_slice(&raw);
        out.resize(out.len() + pad4(raw.len()) - raw.len(), 0);
    }
    for v in &file_head {
        put(&mut out, *v);
    }
    for (i, (name, parent, c)) in files.iter().enumerate() {
        let sibling = (i + 1..files.len()).find(|&j| files[j].1 == *parent).map_or(u32::MAX, |j| file_off[j]);
        let raw: Vec<u8> = name.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        put(&mut out, dir_off[*parent]);
        put(&mut out, sibling);
        out.extend_from_slice(&((positions[i] - data_start) as u64).to_le_bytes());
        out.extend_from_slice(&(c.len() as u64).to_le_bytes());
        put(&mut out, file_chain[i]);
        put(&mut out, raw.len() as u32);
        out.extend_from_slice(&raw);
        out.resize(out.len() + pad4(raw.len()) - raw.len(), 0);
    }
    out.resize(data_start, 0);
    let mut list = Vec::new();
    for (i, (_, _, c)) in files.iter().enumerate() {
        out.resize(positions[i], 0);
        out.extend_from_slice(c);
        if !c.is_empty() {
            list.push((entries[i].0.to_string(), positions[i] as u64, c.len() as u64));
        }
    }
    MemRomfs { data: out, list }
}

/// Contenu pseudo-aléatoire reproductible.
pub fn noise(seed: u32, len: usize) -> Vec<u8> {
    let mut s = seed.wrapping_mul(2654435761).wrapping_add(12345);
    (0..len)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            (s >> 11) as u8
        })
        .collect()
}

/// Les fichiers du faux romfs : plusieurs dossiers, noms UTF-16, un fichier vide, assez d'entrées pour que les
/// casiers de hachage en contiennent plusieurs.
pub fn sample_entries() -> Vec<(String, Vec<u8>)> {
    let mut v: Vec<(String, Vec<u8>)> = Vec::new();
    for i in 0..9 {
        v.push((format!("a/0/{i}"), noise(i, 5 + i as usize * 13)));
    }
    v.push(("a/1/é.bin".into(), noise(100, 33)));
    v.push(("a/1/日本語/ファイル.bin".into(), noise(101, 0x40)));
    v.push(("a/1/vide".into(), vec![]));
    v.push(("a/2".into(), noise(102, 17)));
    for i in 0..8 {
        v.push((format!("b/c{i}/d"), noise(200 + i, 100 + i as usize)));
    }
    v.push(("racine.txt".into(), noise(300, 0x20)));
    v.push(("a/0/last".into(), noise(301, 3)));
    v
}

pub fn sample_level3() -> MemRomfs {
    let entries = sample_entries();
    let refs: Vec<(&str, Vec<u8>)> = entries.iter().map(|(p, c)| (p.as_str(), c.clone())).collect();
    make_level3(&refs)
}

/// Un dossier temporaire à soi, vidé à la création.
pub fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("romfs-test-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dossier temporaire");
    dir
}

/// Racine du dépôt (decompil-3ds/).
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().expect("racine du dépôt")
}

/// Un python qui marche, ou `None`.
pub fn find_python() -> Option<String> {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let candidates = [
        "python".to_string(),
        "python3".to_string(),
        "py".to_string(),
        format!("{local}\\Programs\\Python\\Python312\\python.exe"),
    ];
    candidates.into_iter().find(|c| {
        Command::new(c).args(["-I", "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}
