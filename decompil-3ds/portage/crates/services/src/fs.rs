//! `fs:USER`, un fichier ouvert, un dossier ouvert (contrat des fichiers). Port de `banc/services/fs.py`.
//!
//! Réel :
//! - l'archive 0x00000003 : le chemin {0,0,0} rend le romfs du jeu de base, {5,0,0} celui de la mise à jour (niveau 3
//!   de l'IVFC, lu dans les .cxi déchiffrés), {2,"icon",0} le fichier icon de l'exefs ;
//! - l'archive 0x00000004 (la sauvegarde) : un dossier du PC, copie de la sauvegarde de la console faite au lancement
//!   du banc dans `archives/` (l'original n'est jamais touché) ;
//! - les données supplémentaires (6, 7, 0x12345678) et la carte SD (9, 0x567890AC) : un dossier du PC chacune ;
//! - toutes les commandes d'un fichier et d'un dossier.
//!
//! Les codes d'erreur « introuvable » et « existe déjà » ne sont pas dans les fiches : ce sont ceux qu'utilisent les
//! émulateurs, signalés comme tels dans le journal.
//!
//! Les romfs : `FsUser::new` appelle `load_romfs` (comme `Bench.load_romfs`) puis, si `paths.overlay` est donné, lit
//! le dossier par la crate `overlay` et superpose par `romfs::overlay_romfs`. `FsUser::with_romfs` prend des romfs
//! déjà faits (tests, ou appelant qui les a ouverts avant).
//!
//! Écarts avec le python (là où il lèverait une exception) : une entrée-sortie qui échoue rend un code d'erreur
//! (fichier ou dossier introuvable) au lieu de planter ; un fichier de sauvegarde en lecture seule s'ouvre en lecture
//! seule ; un mod illisible est signalé dans `bench.events` et le jeu garde le romfs sans mod.

use std::cell::{OnceCell, RefCell};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{MAIN_SEPARATOR_STR, Path, PathBuf};
use std::rc::Rc;

use kernel::Kernel;
use kernel::bench::Paths;
use kernel::ipc::{Reply, Request, Service, unknown_command};
use kernel::object::{ObjId, SharedService};
use romfs::{NcchRomfs, OverlayRomfs, RomfsSource, overlay_romfs};

pub const ERR_FILE_NOT_FOUND: u32 = 0xC880_4470;
pub const ERR_PATH_NOT_FOUND: u32 = 0xC880_4471;
pub const ERR_ALREADY_EXISTS: u32 = 0xC820_44BE;
pub const ERR_ARCHIVE_NOT_FOUND: u32 = 0xC8A0_4478;
pub const ERR_INVALID_PATH: u32 = 0xE0E0_46BE;
pub const ERR_INVALID_HANDLE: u32 = 0xC880_4465;
pub const ERR_UNSUPPORTED: u32 = 0xE0C0_46F8;
pub const ERR_OUT_OF_FILE: u32 = 0xE0E0_46C1;

fn archive_name(id: u32) -> &'static str {
    match id {
        3 => "le programme (romfs, exefs)",
        4 => "la sauvegarde",
        6 => "données supplémentaires",
        7 => "données supplémentaires partagées",
        9 => "carte SD",
        0x1234_5678 => "données supplémentaires (boss)",
        0x5678_90AC => "carte SD (écriture seule)",
        0x2345_678A => "contenu d'un autre titre",
        _ => "?",
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// --- les chemins ---

/// Un chemin de fs décodé : `decode_path` du python (genre, valeur).
#[derive(Clone, Debug, PartialEq)]
pub enum PathValue {
    /// Genre 1 : texte vide.
    Empty,
    /// Genre 2 (ou inconnu) : octets.
    Binary(Vec<u8>),
    /// Genres 3 et 4 : texte.
    Text(String),
}

impl PathValue {
    pub fn as_text(&self) -> Option<&str> {
        match self {
            PathValue::Empty => Some(""),
            PathValue::Text(t) => Some(t),
            PathValue::Binary(_) => None,
        }
    }

    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            PathValue::Binary(b) => Some(b),
            _ => None,
        }
    }

    /// `repr()` du python (pour les notes `%r`).
    pub fn repr(&self) -> String {
        match self {
            PathValue::Empty => "''".to_string(),
            PathValue::Text(t) => repr_str(t),
            PathValue::Binary(b) => repr_bytes(b),
        }
    }

    /// `path.hex()` pour des octets, `str(path)` pour du texte, comme le python pour les noms de dossiers.
    pub fn ident(&self) -> String {
        match self {
            PathValue::Binary(b) => hex(b),
            PathValue::Empty => String::new(),
            PathValue::Text(t) => t.clone(),
        }
    }
}

fn quote_for(has_single: bool, has_double: bool) -> char {
    if has_single && !has_double { '"' } else { '\'' }
}

fn repr_str(s: &str) -> String {
    let q = quote_for(s.contains('\''), s.contains('"'));
    let mut out = String::new();
    out.push(q);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == q => {
                out.push('\\');
                out.push(c);
            }
            c if (c as u32) < 0x20 || c as u32 == 0x7F => out.push_str(&format!("\\x{:02x}", c as u32)),
            c if c.is_control() => {
                let v = c as u32;
                if v < 0x100 {
                    out.push_str(&format!("\\x{v:02x}"))
                } else {
                    out.push_str(&format!("\\u{v:04x}"))
                }
            }
            c => out.push(c),
        }
    }
    out.push(q);
    out
}

fn repr_bytes(b: &[u8]) -> String {
    let q = quote_for(b.contains(&b'\''), b.contains(&b'"'));
    let mut out = String::from("b");
    out.push(q);
    for &c in b {
        match c {
            b'\\' => out.push_str("\\\\"),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            c if c as char == q => {
                out.push('\\');
                out.push(c as char);
            }
            0x20..=0x7E => out.push(c as char),
            c => out.push_str(&format!("\\x{c:02x}")),
        }
    }
    out.push(q);
    out
}

/// `decode_path` : un chemin de fs -> forme utile. Les genres inconnus gardent leurs octets.
pub fn decode_path(kind: u32, data: &[u8]) -> PathValue {
    match kind {
        1 => PathValue::Empty,
        2 => PathValue::Binary(data.to_vec()),
        3 => PathValue::Text(data.split(|&b| b == 0).next().unwrap_or(&[]).iter().map(|&b| b as char).collect()),
        4 => {
            let units: Vec<u16> = data.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let mut text = String::from_utf16_lossy(&units);
            if data.len() % 2 == 1 {
                text.push('\u{FFFD}');
            }
            PathValue::Text(text.split('\0').next().unwrap_or("").to_string())
        }
        _ => PathValue::Binary(data.to_vec()),
    }
}

// --- les fichiers ---

/// Ce que cache un fichier ouvert : le romfs, un fichier de l'exefs en mémoire, un fichier du PC.
pub trait FsFile {
    fn label(&self) -> &str;
    fn size(&self) -> u64;
    fn read(&mut self, position: u64, size: u64) -> Vec<u8>;
    /// Les octets écrits, ou `None` si le fichier est en lecture seule.
    fn write(&mut self, position: u64, data: &[u8]) -> Option<usize>;
    fn set_size(&mut self, size: u64) -> u32;
    /// Le fichier du romfs où tombe une position (pour le journal).
    fn what(&self, _position: u64) -> String {
        String::new()
    }
    /// Lecture dans un fichier de mod : ce qui a été servi, pour le journal (vide sinon).
    fn describe(&self, _position: u64, _data: &[u8]) -> String {
        String::new()
    }
}

type SharedFile = Rc<RefCell<dyn FsFile>>;

type RomIndex = (Vec<u64>, Vec<(String, u64, u64)>);

pub struct RomFile {
    romfs: Rc<dyn RomfsSource>,
    overlay: Option<Rc<OverlayRomfs>>,
    label: String,
    size: u64,
    index: OnceCell<RomIndex>,
}

impl RomFile {
    pub fn new(romfs: Rc<dyn RomfsSource>, overlay: Option<Rc<OverlayRomfs>>, label: &str) -> RomFile {
        let size = romfs.size();
        RomFile { romfs, overlay, label: label.to_string(), size, index: OnceCell::new() }
    }
}

impl FsFile for RomFile {
    fn label(&self) -> &str {
        &self.label
    }

    fn size(&self) -> u64 {
        self.size
    }

    fn read(&mut self, position: u64, size: u64) -> Vec<u8> {
        self.romfs.read(position, size as usize)
    }

    fn write(&mut self, _position: u64, _data: &[u8]) -> Option<usize> {
        None
    }

    fn set_size(&mut self, _size: u64) -> u32 {
        ERR_UNSUPPORTED
    }

    /// Index construit à la première demande (`bisect` sur les fichiers triés par position).
    fn what(&self, position: u64) -> String {
        let (starts, entries) = self.index.get_or_init(|| {
            let mut entries = self.romfs.files();
            entries.sort_by_key(|e| e.1);
            (entries.iter().map(|e| e.1).collect(), entries)
        });
        let i = starts.partition_point(|&s| s <= position) as isize - 1;
        if i >= 0 {
            let (name, start, size) = &entries[i as usize];
            if position < start + size {
                return format!("{name}+{:#x}", position - start);
            }
        }
        let first = starts.first().copied().unwrap_or(1 << 62);
        if position < first { "tables".to_string() } else { "?".to_string() }
    }

    fn describe(&self, position: u64, data: &[u8]) -> String {
        match &self.overlay {
            Some(o) => o.describe(position, data),
            None => String::new(),
        }
    }
}

pub struct BytesFile {
    data: Vec<u8>,
    label: String,
}

impl BytesFile {
    pub fn new(data: Vec<u8>, label: &str) -> BytesFile {
        BytesFile { data, label: label.to_string() }
    }
}

impl FsFile for BytesFile {
    fn label(&self) -> &str {
        &self.label
    }

    fn size(&self) -> u64 {
        self.data.len() as u64
    }

    fn read(&mut self, position: u64, size: u64) -> Vec<u8> {
        let start = position.min(self.data.len() as u64) as usize;
        let end = position.saturating_add(size).min(self.data.len() as u64) as usize;
        self.data[start..end].to_vec()
    }

    fn write(&mut self, _position: u64, _data: &[u8]) -> Option<usize> {
        None
    }

    fn set_size(&mut self, _size: u64) -> u32 {
        ERR_UNSUPPORTED
    }
}

pub struct HostFile {
    path: PathBuf,
    label: String,
    file: fs::File,
}

impl HostFile {
    pub fn open(path: &Path, label: &str) -> std::io::Result<HostFile> {
        let file = match fs::OpenOptions::new().read(true).write(true).open(path) {
            Ok(f) => f,
            Err(_) => fs::File::open(path)?,
        };
        Ok(HostFile { path: path.to_path_buf(), label: label.to_string(), file })
    }
}

impl FsFile for HostFile {
    fn label(&self) -> &str {
        &self.label
    }

    fn size(&self) -> u64 {
        fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0)
    }

    fn read(&mut self, position: u64, size: u64) -> Vec<u8> {
        let mut out = Vec::new();
        if self.file.seek(SeekFrom::Start(position)).is_ok() {
            let _ = (&mut self.file).take(size).read_to_end(&mut out);
        }
        out
    }

    fn write(&mut self, position: u64, data: &[u8]) -> Option<usize> {
        self.file.seek(SeekFrom::Start(position)).ok()?;
        self.file.write_all(data).ok()?;
        self.file.flush().ok()?;
        Some(data.len())
    }

    fn set_size(&mut self, size: u64) -> u32 {
        if self.file.set_len(size).is_ok() { 0 } else { ERR_UNSUPPORTED }
    }
}

pub struct FileSession {
    file: SharedFile,
    mode: u32,
    start: u64,
    window: Option<u64>,
    priority: u32,
    closed: bool,
}

impl FileSession {
    pub fn new(file: SharedFile, mode: u32, start: u64, window: Option<u64>, priority: u32) -> FileSession {
        FileSession { file, mode, start, window, priority, closed: false }
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    pub fn mode(&self) -> u32 {
        self.mode
    }

    fn length(&self) -> u64 {
        self.window.unwrap_or_else(|| self.file.borrow().size())
    }

    fn read(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let position = req.u64(1);
        let (address, size) = req.buffer(4);
        let mut size = size as u64;
        if self.window.is_some() {
            size = size.min(self.length().saturating_sub(position));
        }
        let at = self.start.saturating_add(position);
        let (data, label, mut what, note) = {
            let mut file = self.file.borrow_mut();
            let data = if size > 0 { file.read(at, size) } else { Vec::new() };
            if !data.is_empty() {
                let _ = k.memory.write(address, &data);
            }
            k.bench.stat("fs_read_bytes", data.len() as u64);
            let label = file.label().to_string();
            k.on_file_read(&label);
            let what = file.what(at);
            let note = if data.is_empty() { String::new() } else { file.describe(at, &data) };
            (data, label, what, note)
        };
        if !data.is_empty() {
            // lecture dans un fichier de mod : ce qui a été servi, pour le journal
            let sep = if !what.is_empty() && !note.is_empty() { " ; " } else { "" };
            what += &format!("{sep}{note}");
        }
        Reply::with_words(0, &[data.len() as u32]).raw(&[req.word(4), req.word(5)]).with_note(format!(
            "{label}, position {position:#x}, {:#x} octets lus{}",
            data.len(),
            if what.is_empty() { String::new() } else { format!(" ({what})") }
        ))
    }

    fn write(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let position = req.u64(1);
        let (address, size) = req.buffer(5);
        let data = if size > 0 { k.memory.read(address, size).unwrap_or_default() } else { Vec::new() };
        let mut file = self.file.borrow_mut();
        match file.write(self.start.saturating_add(position), &data) {
            None => Reply::with_words(ERR_UNSUPPORTED, &[0])
                .raw(&[req.word(5), req.word(6)])
                .with_note("fichier en lecture seule"),
            Some(n) => Reply::with_words(0, &[n as u32]).raw(&[req.word(5), req.word(6)]).with_note(format!(
                "{}, position {position:#x}, {n:#x} octets écrits",
                file.label()
            )),
        }
    }

    fn get_size(&mut self) -> Reply {
        let size = self.length();
        Reply::with_words(0, &[size as u32, (size >> 32) as u32])
            .with_note(format!("{} : {size:#x} octets", self.file.borrow().label()))
    }

    fn set_size(&mut self, req: &Request) -> Reply {
        if self.window.is_some() {
            return Reply::new(ERR_UNSUPPORTED);
        }
        let code = self.file.borrow_mut().set_size(req.u64(1));
        Reply::new(code)
    }

    fn twin(&self) -> FileSession {
        FileSession::new(self.file.clone(), self.mode, self.start, self.window, self.priority)
    }
}

fn session_of(k: &mut Kernel, service: impl Service + 'static, name: &str) -> ObjId {
    let shared: SharedService = Rc::new(RefCell::new(service));
    k.new_session(shared, name)
}

impl Service for FileSession {
    fn name(&self) -> &str {
        "FSFile"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x0802 => self.read(k, req),
            0x0803 => self.write(k, req),
            0x0804 => self.get_size(),
            0x0805 => self.set_size(req),
            0x0808 => {
                self.closed = true;
                Reply::new(0).with_note(self.file.borrow().label().to_string())
            }
            0x0809 => Reply::new(0),
            0x080A => {
                self.priority = req.word(1);
                Reply::new(0)
            }
            0x080B => Reply::with_words(0, &[self.priority]),
            0x080C => {
                let label = self.file.borrow().label().to_string();
                let id = session_of(k, self.twin(), "FSFile");
                Reply::new(0).move_handles(&[id]).with_note(label)
            }
            0x0801 => {
                let (start, size) = (req.u64(1), req.u64(3));
                if self.window.is_some() {
                    return Reply::new(ERR_UNSUPPORTED);
                }
                if start as u128 + size as u128 > self.file.borrow().size() as u128 {
                    return Reply::new(ERR_OUT_OF_FILE);
                }
                let sub = FileSession::new(self.file.clone(), self.mode, start, Some(size), self.priority);
                let id = session_of(k, sub, "FSFile");
                Reply::new(0).move_handles(&[id])
            }
            0x0C01 => {
                let (position, size) = (req.u64(1), req.u64(3));
                let available = size.min(self.length().saturating_sub(position));
                Reply::with_words(0, &[available as u32, (available >> 32) as u32])
            }
            _ => unknown_command(),
        }
    }
}

const DIR_ENTRY: usize = 0x228;

pub struct DirSession {
    label: String,
    entries: Vec<String>,
    path: PathBuf,
    cursor: usize,
    priority: u32,
}

impl DirSession {
    pub fn new(path: &Path, label: &str) -> DirSession {
        let mut entries: Vec<String> = match fs::read_dir(path) {
            Ok(it) => it.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect(),
            Err(_) => Vec::new(),
        };
        // ordre des points de code, comme `sorted(os.listdir)` (l'ordre des octets UTF-8 est le même)
        entries.sort();
        DirSession { label: label.to_string(), entries, path: path.to_path_buf(), cursor: 0, priority: 0 }
    }

    fn read(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (address, size) = req.buffer(2);
        let count = size as usize / DIR_ENTRY;
        let mut out: Vec<u8> = Vec::new();
        let mut n = 0usize;
        while n < count && self.cursor < self.entries.len() {
            let name = self.entries[self.cursor].clone();
            self.cursor += 1;
            let full = self.path.join(&name);
            let mut entry = vec![0u8; DIR_ENTRY];
            let encoded: Vec<u8> = name.encode_utf16().flat_map(|u| u.to_le_bytes()).take(0x20A).collect();
            entry[..encoded.len()].copy_from_slice(&encoded);
            let upper = name.to_uppercase();
            let (stem, ext) = upper.split_once('.').unwrap_or((upper.as_str(), ""));
            let latin = |c: char| if (c as u32) < 0x100 { c as u32 as u8 } else { b'?' };
            for (i, c) in stem.chars().take(8).enumerate() {
                entry[0x20C + i] = latin(c);
            }
            for (i, c) in ext.chars().take(3).enumerate() {
                entry[0x216 + i] = latin(c);
            }
            let is_dir = full.is_dir();
            entry[0x21A] = 1;
            entry[0x21C] = is_dir as u8;
            entry[0x21E] = !is_dir as u8;
            if full.is_file() {
                let len = fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
                entry[0x220..0x228].copy_from_slice(&len.to_le_bytes());
            }
            out.extend_from_slice(&entry);
            n += 1;
        }
        if !out.is_empty() {
            let _ = k.memory.write(address, &out);
        }
        Reply::with_words(0, &[n as u32])
            .raw(&[req.word(2), req.word(3)])
            .with_note(format!("{} : {n} entrées", self.label))
    }
}

impl Service for DirSession {
    fn name(&self) -> &str {
        "FSDir"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x0801 => self.read(k, req),
            0x0802 => Reply::new(0),
            0x0803 => {
                self.priority = req.word(1);
                Reply::new(0)
            }
            0x0804 => Reply::with_words(0, &[self.priority]),
            _ => unknown_command(),
        }
    }
}

// --- les archives ---

pub struct Archive {
    pub archive_id: u32,
    pub root: Option<PathBuf>,
    pub label: String,
    pub readonly: bool,
    pub priority: u32,
}

impl Archive {
    /// Le chemin sur le PC, et ce chemin relatif à la racine (`os.path.relpath`). `None` si le chemin remonte (`..`).
    pub fn host(&self, text: &str) -> Option<(PathBuf, String)> {
        let unified = text.replace('\\', "/");
        let parts: Vec<&str> = unified.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
        if parts.contains(&"..") {
            return None;
        }
        let mut path = self.root.clone()?;
        for p in &parts {
            path.push(p);
        }
        let rel = if parts.is_empty() { ".".to_string() } else { parts.join(MAIN_SEPARATOR_STR) };
        Some((path, rel))
    }
}

/// `Bench.load_romfs` : ouvre les romfs de `paths.romfs_base` et `paths.romfs_update` s'ils existent. Un romfs
/// illisible est signalé dans `events` (`(0, texte)`) et reste absent.
#[allow(clippy::type_complexity)]
pub fn load_romfs(
    paths: &Paths,
    events: &mut Vec<(u64, String)>,
) -> (Option<Rc<dyn RomfsSource>>, Option<Rc<dyn RomfsSource>>) {
    let mut open = |key: &str, path: &Path| -> Option<Rc<dyn RomfsSource>> {
        if !path.is_file() {
            return None;
        }
        match NcchRomfs::open(path) {
            Ok(r) => Some(Rc::new(r) as Rc<dyn RomfsSource>),
            Err(e) => {
                events.push((0, format!("romfs {key} illisible : {e}")));
                None
            }
        }
    };
    let base = open("romfs_base", &paths.romfs_base);
    let update = open("romfs_update", &paths.romfs_update);
    (base, update)
}

fn same_romfs(a: &Rc<dyn RomfsSource>, b: &Rc<OverlayRomfs>) -> bool {
    std::ptr::eq(Rc::as_ptr(a) as *const (), Rc::as_ptr(b) as *const ())
}

pub struct FsUser {
    priority: u32,
    initialized: bool,
    archives: HashMap<u64, Archive>,
    next_archive: u64,
    roots: PathBuf,
    exefs: PathBuf,
    romfs_base: Option<Rc<dyn RomfsSource>>,
    romfs_update: Option<Rc<dyn RomfsSource>>,
    /// Les surcouches de mods (`bench.overlays` du python), pour les `hits` de fin de partie.
    pub overlays: Vec<Rc<OverlayRomfs>>,
    secure_values: HashMap<u32, u64>,
}

struct FormatInfo {
    size: u64,
    dirs: u64,
    files: u64,
    duplicate: u64,
}

impl FormatInfo {
    fn read(path: &Path) -> Option<FormatInfo> {
        let value: serde_json::Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
        let get = |key: &str| value.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
        Some(FormatInfo { size: get("size"), dirs: get("dirs"), files: get("files"), duplicate: get("duplicate") })
    }

    fn write(&self, path: &Path) {
        let _ = fs::write(
            path,
            format!(
                "{{\"size\": {}, \"dirs\": {}, \"files\": {}, \"duplicate\": {}}}",
                self.size, self.dirs, self.files, self.duplicate
            ),
        );
    }

    fn words(&self) -> [u32; 4] {
        [self.size as u32, self.dirs as u32, self.files as u32, self.duplicate as u32]
    }

    /// Le `repr` du dictionnaire python.
    fn repr(&self) -> String {
        format!(
            "{{'size': {}, 'dirs': {}, 'files': {}, 'duplicate': {}}}",
            self.size, self.dirs, self.files, self.duplicate
        )
    }
}

fn suffixed(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

type Opened = Result<SharedFile, (u32, String)>;

impl FsUser {
    /// Ouvre les romfs d'après `k.bench.paths` (`load_romfs`), superpose les mods si `paths.overlay` est donné.
    pub fn new(k: &mut Kernel) -> FsUser {
        let paths = k.bench.paths.clone();
        let (base, update) = load_romfs(&paths, &mut k.bench.events);
        FsUser::with_overlay(k, base, update, paths.overlay.as_deref())
    }

    /// Comme `new`, mais avec des romfs déjà ouverts (sans surcouche).
    pub fn with_romfs(
        k: &mut Kernel,
        base: Option<Rc<dyn RomfsSource>>,
        update: Option<Rc<dyn RomfsSource>>,
    ) -> FsUser {
        FsUser::with_overlay(k, base, update, None)
    }

    /// Romfs déjà ouverts, et dossier de mod facultatif (lu par la crate `overlay`).
    pub fn with_overlay(
        k: &mut Kernel,
        base: Option<Rc<dyn RomfsSource>>,
        update: Option<Rc<dyn RomfsSource>>,
        overlay_dir: Option<&Path>,
    ) -> FsUser {
        let (mut base, mut update, mut overlays) = (base, update, Vec::new());
        if let Some(dir) = overlay_dir {
            let built = overlay::Overlay::load(dir)
                .map_err(|e| e.to_string())
                .and_then(|ov| overlay_romfs(base.clone(), update.clone(), &ov).map_err(|e| e.to_string()));
            match built {
                Ok((b, u, made)) => {
                    base = b;
                    update = u;
                    overlays = made;
                }
                Err(e) => k.bench.events.push((0, format!("mod {} illisible : {e}", dir.display()))),
            }
        }
        FsUser {
            priority: 0,
            initialized: false,
            archives: HashMap::new(),
            next_archive: 0x1_0000_0001,
            roots: k.bench.paths.archives.clone(),
            exefs: k.bench.paths.exefs.clone(),
            romfs_base: base,
            romfs_update: update,
            overlays,
            secure_values: HashMap::new(),
        }
    }

    pub fn initialized(&self) -> bool {
        self.initialized
    }

    fn path_of(&self, k: &Kernel, req: &Request, kind_word: usize, pos: usize) -> PathValue {
        decode_path(req.word(kind_word), &req.static_data(k, pos))
    }

    fn make_archive(&self, archive_id: u32, path: &PathValue) -> Option<Archive> {
        let make = |root: Option<PathBuf>, label: &str, readonly: bool| {
            Some(Archive { archive_id, root, label: label.to_string(), readonly, priority: 0 })
        };
        match archive_id {
            3 => make(None, "programme", true),
            4 => make(Some(self.roots.join("sauvegarde")), "sauvegarde", false),
            6 | 7 | 0x1234_5678 => {
                let ident = path.ident();
                let root = self.roots.join(format!("extdata-{archive_id:x}-{ident}"));
                if !root.is_dir() {
                    return None;
                }
                make(Some(root), &format!("données supplémentaires {ident}"), false)
            }
            9 | 0x5678_90AC => {
                let root = self.roots.join("sdmc");
                let _ = fs::create_dir_all(&root);
                make(Some(root), "carte SD", false)
            }
            _ => None,
        }
    }

    fn archive(&self, req: &Request, pos: usize) -> Option<&Archive> {
        self.archives.get(&req.u64(pos))
    }

    fn rom_layer(&self, romfs: &Rc<dyn RomfsSource>) -> Option<Rc<OverlayRomfs>> {
        self.overlays.iter().find(|o| same_romfs(romfs, o)).cloned()
    }

    /// L'archive 0x00000003 : romfs ou exefs selon le premier mot du chemin binaire (contrat, partie 2).
    fn open_in_program(&self, path: &PathValue) -> Opened {
        let bytes = match path.as_bytes() {
            Some(b) if b.len() == 12 => b,
            _ => return Err((ERR_INVALID_PATH, format!("chemin de {} : il faut 12 octets binaires", path.repr()))),
        };
        let kind = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        match kind {
            0 | 5 => {
                let romfs = if kind == 0 { &self.romfs_base } else { &self.romfs_update };
                let Some(romfs) = romfs else {
                    return Err((ERR_FILE_NOT_FOUND, format!("romfs {kind} absent du banc")));
                };
                let label = format!("romfs {}", if kind == 0 { "du jeu de base" } else { "de la mise à jour" });
                Ok(Rc::new(RefCell::new(RomFile::new(romfs.clone(), self.rom_layer(romfs), &label))))
            }
            2 => {
                let raw = &bytes[4..12];
                let name: String = raw.split(|&b| b == 0).next().unwrap_or(&[]).iter().map(|&b| b as char).collect();
                let host = self.exefs.join(format!("{name}.bin"));
                if !host.is_file() {
                    return Err((ERR_FILE_NOT_FOUND, format!("exefs/{name} absent")));
                }
                match fs::read(&host) {
                    Ok(data) => Ok(Rc::new(RefCell::new(BytesFile::new(data, &format!("exefs/{name}"))))),
                    Err(_) => Err((ERR_FILE_NOT_FOUND, format!("exefs/{name} absent"))),
                }
            }
            _ => Err((ERR_INVALID_PATH, format!("premier mot {kind} refusé"))),
        }
    }

    fn open_host(&self, archive: &Archive, path: &PathValue, mode: u32) -> Opened {
        let Some((host, _)) = path.as_text().and_then(|t| archive.host(t)) else {
            return Err((ERR_INVALID_PATH, format!("chemin {} illisible", path.repr())));
        };
        let text = path.as_text().unwrap_or("");
        if !host.is_file() {
            if mode & 4 != 0 {
                // création demandée
                if let Some(parent) = host.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if fs::File::create(&host).is_err() {
                    return Err((ERR_INVALID_PATH, format!("chemin {} illisible", path.repr())));
                }
            } else {
                return Err((ERR_FILE_NOT_FOUND, format!("{}{text} introuvable (code des émulateurs)", archive.label)));
            }
        }
        match HostFile::open(&host, &format!("{}:{text}", archive.label)) {
            Ok(f) => Ok(Rc::new(RefCell::new(f))),
            Err(_) => Err((ERR_FILE_NOT_FOUND, format!("{}{text} introuvable (code des émulateurs)", archive.label))),
        }
    }

    fn open_any(&self, archive: &Archive, path: &PathValue, mode: u32) -> Opened {
        if archive.archive_id == 3 { self.open_in_program(path) } else { self.open_host(archive, path, mode) }
    }

    fn open_file_directly(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (archive_id, mode) = (req.word(2), req.word(7));
        let a_path = self.path_of(k, req, 3, 9);
        let f_path = self.path_of(k, req, 5, 11);
        let Some(archive) = self.make_archive(archive_id, &a_path) else {
            let mut detail = String::new();
            if archive_id == 0x2345_678A {
                if let Some(b) = a_path.as_bytes().filter(|b| b.len() >= 8) {
                    let title = u64::from_le_bytes(b[..8].try_into().unwrap());
                    detail = format!(" : titre {title:016x}, chemin de fichier {}", f_path.ident());
                }
            }
            return Reply::with_words(ERR_ARCHIVE_NOT_FOUND, &[0x10, 0])
                .with_note(format!("archive {archive_id:#x} ({}) absente du banc{detail}", archive_name(archive_id)));
        };
        let file = match self.open_any(&archive, &f_path, mode) {
            Ok(f) => f,
            Err((code, why)) => return Reply::with_words(code, &[0x10, 0]).with_note(why),
        };
        let label = file.borrow().label().to_string();
        let session = session_of(k, FileSession::new(file, mode, 0, None, self.priority), "FSFile");
        k.on_file_open(archive_id, &label);
        Reply::new(0).move_handles(&[session]).with_note(format!("{} : {label}", archive_name(archive_id)))
    }

    fn open_archive(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let archive_id = req.word(1);
        let path = self.path_of(k, req, 2, 4);
        let Some(archive) = self.make_archive(archive_id, &path) else {
            return Reply::with_words(ERR_ARCHIVE_NOT_FOUND, &[0, 0])
                .with_note(format!("archive {archive_id:#x} ({}) absente du banc", archive_name(archive_id)));
        };
        let handle = self.next_archive;
        self.next_archive += 1;
        let note = archive.label.clone();
        self.archives.insert(handle, archive);
        Reply::with_words(0, &[handle as u32, (handle >> 32) as u32]).with_note(note)
    }

    fn open_file(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let Some(archive) = self.archive(req, 2) else { return Reply::with_words(ERR_INVALID_HANDLE, &[0x10, 0]) };
        let path = self.path_of(k, req, 4, 8);
        let mode = req.word(6);
        let file = match self.open_any(archive, &path, mode) {
            Ok(f) => f,
            Err((code, why)) => return Reply::with_words(code, &[0x10, 0]).with_note(why),
        };
        let (archive_id, priority) = (archive.archive_id, archive.priority);
        let label = file.borrow().label().to_string();
        let session = session_of(k, FileSession::new(file, mode, 0, None, priority), "FSFile");
        k.on_file_open(archive_id, &label);
        Reply::new(0).move_handles(&[session]).with_note(format!("{label}, mode {mode}"))
    }

    fn open_directory(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let Some(archive) = self.archive(req, 1).filter(|a| a.root.is_some()) else {
            return Reply::with_words(ERR_INVALID_HANDLE, &[0x10, 0]);
        };
        let path = self.path_of(k, req, 3, 5);
        let host = path.as_text().and_then(|t| archive.host(t));
        let Some((host, _)) = host.filter(|(h, _)| h.is_dir()) else {
            return Reply::with_words(ERR_PATH_NOT_FOUND, &[0x10, 0])
                .with_note(format!("dossier {} introuvable", path.repr()));
        };
        let label = format!("{}:{}", archive.label, path.as_text().unwrap_or(""));
        let session = session_of(k, DirSession::new(&host, &label), "FSDir");
        Reply::new(0).move_handles(&[session]).with_note(label)
    }

    /// `_host_path` : le chemin sur le PC et son relatif, ou la réponse d'échec.
    fn host_path(
        &self,
        k: &Kernel,
        req: &Request,
        handle_pos: usize,
        kind_pos: usize,
        static_pos: usize,
    ) -> Result<(PathBuf, String), Reply> {
        let Some(archive) = self.archive(req, handle_pos).filter(|a| a.root.is_some()) else {
            return Err(Reply::new(ERR_INVALID_HANDLE));
        };
        let path = self.path_of(k, req, kind_pos, static_pos);
        match path.as_text().and_then(|t| archive.host(t)) {
            Some(found) => Ok(found),
            None => Err(Reply::new(ERR_INVALID_PATH).with_note(format!("chemin {}", path.repr()))),
        }
    }

    fn delete_file(&mut self, k: &Kernel, req: &Request) -> Reply {
        let (host, rel) = match self.host_path(k, req, 2, 4, 6) {
            Ok(v) => v,
            Err(r) => return r,
        };
        if !host.is_file() || fs::remove_file(&host).is_err() {
            return Reply::new(ERR_FILE_NOT_FOUND).with_note(format!("{} absent", host.display()));
        }
        Reply::new(0).with_note(rel)
    }

    fn delete_directory(&mut self, k: &Kernel, req: &Request, recursive: bool) -> Reply {
        let (host, _) = match self.host_path(k, req, 2, 4, 6) {
            Ok(v) => v,
            Err(r) => return r,
        };
        if !host.is_dir() {
            return Reply::new(ERR_PATH_NOT_FOUND);
        }
        let done = if recursive { fs::remove_dir_all(&host) } else { fs::remove_dir(&host) };
        if done.is_err() { Reply::new(ERR_PATH_NOT_FOUND) } else { Reply::new(0) }
    }

    fn create_file(&mut self, k: &Kernel, req: &Request) -> Reply {
        let (host, rel) = match self.host_path(k, req, 2, 4, 9) {
            Ok(v) => v,
            Err(r) => return r,
        };
        let size = req.u64(7);
        if host.exists() {
            return Reply::new(ERR_ALREADY_EXISTS).with_note(format!("{rel} existe déjà (code des émulateurs)"));
        }
        if let Some(parent) = host.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::File::create(&host).and_then(|f| f.set_len(size)).is_err() {
            return Reply::new(ERR_PATH_NOT_FOUND).with_note(format!("{rel} impossible à créer"));
        }
        Reply::new(0).with_note(format!("{rel}, {size:#x} octets"))
    }

    fn create_directory(&mut self, k: &Kernel, req: &Request) -> Reply {
        let (host, _) = match self.host_path(k, req, 2, 4, 7) {
            Ok(v) => v,
            Err(r) => return r,
        };
        if host.exists() {
            return Reply::new(ERR_ALREADY_EXISTS);
        }
        if fs::create_dir_all(&host).is_err() { Reply::new(ERR_PATH_NOT_FOUND) } else { Reply::new(0) }
    }

    fn rename(&mut self, k: &Kernel, req: &Request) -> Reply {
        let (source, _) = match self.host_path(k, req, 2, 4, 10) {
            Ok(v) => v,
            Err(r) => return r,
        };
        let (target, _) = match self.host_path(k, req, 6, 8, 12) {
            Ok(v) => v,
            Err(r) => return r,
        };
        if !source.exists() {
            return Reply::new(ERR_FILE_NOT_FOUND);
        }
        if fs::rename(&source, &target).is_err() { Reply::new(ERR_PATH_NOT_FOUND) } else { Reply::new(0) }
    }

    fn format_info_path(&self) -> PathBuf {
        self.roots.join("sauvegarde.format.json")
    }

    fn ext_root(&self, archive_id: u32, info: &[u8]) -> PathBuf {
        self.roots.join(format!("extdata-{archive_id:x}-{}", hex(info)))
    }

    fn get_format_info(&mut self, k: &Kernel, req: &Request) -> Reply {
        let archive_id = req.word(1);
        if archive_id == 4 {
            let info = FormatInfo::read(&self.format_info_path())
                .unwrap_or(FormatInfo { size: 0x80000, dirs: 1, files: 1, duplicate: 1 });
            return Reply::with_words(0, &info.words()).with_note(format!("sauvegarde : {}", info.repr()));
        }
        if archive_id == 6 || archive_id == 7 {
            let root = self.ext_root(archive_id, &req.static_data(k, 4));
            if root.is_dir() {
                let info = FormatInfo::read(&suffixed(&root, ".format.json"))
                    .unwrap_or(FormatInfo { size: 0, dirs: 0, files: 0, duplicate: 0 });
                return Reply::with_words(0, &info.words())
                    .with_note(format!("données supplémentaires : {}", info.repr()));
            }
        }
        Reply::with_words(ERR_ARCHIVE_NOT_FOUND, &[0, 0, 0, 0]).with_note(format!("archive {archive_id:#x} absente"))
    }

    fn format_save_data(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let root = self.roots.join("sauvegarde");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::create_dir_all(&root);
        FormatInfo {
            size: 0x80000,
            dirs: req.word(5) as u64,
            files: req.word(6) as u64,
            duplicate: (req.word(9) & 0xFF) as u64,
        }
        .write(&self.format_info_path());
        k.note("le jeu a formaté sa sauvegarde (FormatSaveData) : la copie du banc est vidée");
        Reply::new(0).with_note(format!("{} dossiers, {} fichiers", req.word(5), req.word(6)))
    }

    fn create_ext_save_data(&mut self, k: &Kernel, req: &Request) -> Reply {
        let info = k.memory.read(req.cmdbuf + 4, 12).unwrap_or_default();
        let root = self.ext_root(6, &info);
        let _ = fs::create_dir_all(&root);
        FormatInfo { size: 0, dirs: req.word(5) as u64, files: req.word(6) as u64, duplicate: 0 }
            .write(&suffixed(&root, ".format.json"));
        let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        Reply::new(0).raw(&[req.word(10), req.word(11)]).with_note(format!("dossier {name}"))
    }

    fn delete_ext_save_data(&mut self, k: &Kernel, req: &Request) -> Reply {
        let info = k.memory.read(req.cmdbuf + 4, 12).unwrap_or_default();
        let _ = fs::remove_dir_all(self.ext_root(6, &info));
        Reply::new(0)
    }

    fn set_archive_priority(&mut self, req: &Request) -> Reply {
        match self.archives.get_mut(&req.u64(1)) {
            None => Reply::new(ERR_INVALID_HANDLE),
            Some(a) => {
                a.priority = req.word(3);
                Reply::new(0)
            }
        }
    }

    fn get_archive_priority(&mut self, req: &Request) -> Reply {
        match self.archive(req, 1) {
            None => Reply::with_words(ERR_INVALID_HANDLE, &[0]),
            Some(a) => Reply::with_words(0, &[a.priority]),
        }
    }

    fn get_secure_value(&mut self, req: &Request) -> Reply {
        match self.secure_values.get(&req.word(1)) {
            None => Reply::with_words(0, &[0, 0, 0, 0]).with_note("pas de valeur (première fois)"),
            Some(&v) => Reply::with_words(0, &[1, 0, v as u32, (v >> 32) as u32]),
        }
    }
}

impl Service for FsUser {
    fn name(&self) -> &str {
        "fs:USER"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x0802 => self.open_file(k, req),
            0x0803 => self.open_file_directly(k, req),
            0x0804 => self.delete_file(k, req),
            0x0805 | 0x080A => self.rename(k, req),
            0x0806 => self.delete_directory(k, req, false),
            0x0807 => self.delete_directory(k, req, true),
            0x0808 => self.create_file(k, req),
            0x0809 => self.create_directory(k, req),
            0x080B => self.open_directory(k, req),
            0x080C => self.open_archive(k, req),
            0x080D => Reply::with_words(0, &[req.word(6), req.word(7), req.word(8), req.word(9)])
                .with_note(format!("action {}", req.word(3))),
            0x080E => {
                if self.archives.remove(&req.u64(1)).is_none() { Reply::new(ERR_INVALID_HANDLE) } else { Reply::new(0) }
            }
            0x0812 => {
                let free: u64 = 0x1000_0000;
                Reply::with_words(0, &[free as u32, (free >> 32) as u32])
            }
            0x0817 | 0x0818 => Reply::with_words(0, &[1]),
            0x0845 => self.get_format_info(k, req),
            0x0849 => Reply::with_words(0, &[0x200, 0x8000, 0x80000, 0x40000])
                .with_note(format!("support {} : 16 Go, 8 Go libres", req.word(1))),
            0x084C => self.format_save_data(k, req),
            0x0851 => self.create_ext_save_data(k, req),
            0x0852 => self.delete_ext_save_data(k, req),
            0x0854 => Reply::with_words(0, &[0x4000, 0, 0x2000, 0, 0x1000]),
            0x085A => self.set_archive_priority(req),
            0x085B => self.get_archive_priority(req),
            0x0861 => {
                self.initialized = true;
                Reply::new(0).with_note(format!("version {:#x}", req.word(1)))
            }
            0x0862 => {
                self.priority = req.word(1);
                Reply::new(0)
            }
            0x0863 => Reply::with_words(0, &[self.priority]),
            0x086E => {
                self.secure_values.insert(req.word(1), req.u64(2));
                Reply::new(0)
            }
            0x086F => self.get_secure_value(req),
            _ => unknown_command(),
        }
    }
}

/// Copie la sauvegarde de la console dans le dossier de travail du banc (jamais l'original) : vide `paths.archives`,
/// y copie `save_source` dans `sauvegarde/`, ou crée un dossier vide. `extdata_source` n'est pas relu (comme le python).
pub fn prepare_archives(paths: &Paths, save_source: Option<&Path>, _extdata_source: Option<&Path>) -> String {
    let root = &paths.archives;
    let _ = fs::remove_dir_all(root);
    let _ = fs::create_dir_all(root);
    let save = root.join("sauvegarde");
    if let Some(source) = save_source.filter(|s| !s.as_os_str().is_empty() && s.is_dir()) {
        return match copy_tree(source, &save) {
            Ok(()) => format!("sauvegarde copiée de {}", source.display()),
            Err(e) => format!("sauvegarde non copiée de {} : {e}", source.display()),
        };
    }
    let _ = fs::create_dir_all(&save);
    "pas de sauvegarde : dossier vide".to_string()
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}
