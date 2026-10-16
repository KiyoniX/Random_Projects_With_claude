//! Le romfs d'un NCCH déchiffré, vu comme le jeu le voit : le dernier niveau de l'IVFC, un seul fichier.
//! Port de `NcchRomfs` (`banc/romfs.py`). Le fichier est lu à la demande, jamais chargé en mémoire.

use std::cell::{OnceCell, RefCell};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::{RomfsError, RomfsSource};

const MEDIA_UNIT: u64 = 0x200;

pub struct NcchRomfs {
    path: PathBuf,
    file: RefCell<fs::File>,
    romfs_offset: u64,
    level3_offset: u64,
    size: u64,
    files: OnceCell<Vec<(String, u64, u64)>>,
}

fn le32(b: &[u8], pos: usize) -> u32 {
    u32::from_le_bytes([b[pos], b[pos + 1], b[pos + 2], b[pos + 3]])
}

fn le64(b: &[u8], pos: usize) -> u64 {
    le32(b, pos) as u64 | (le32(b, pos + 4) as u64) << 32
}

impl NcchRomfs {
    /// Ouvre le `.cxi` déchiffré et repère le niveau 3 de l'IVFC.
    pub fn open(path: &Path) -> Result<NcchRomfs, RomfsError> {
        let io = |source| RomfsError::Io { path: path.to_path_buf(), source };
        let mut file = fs::File::open(path).map_err(io)?;
        let mut header = [0u8; 0x200];
        if read_full(&mut file, &mut header).map_err(io)? < 0x200 || &header[0x100..0x104] != b"NCCH" {
            return Err(RomfsError::NotNcch(path.to_path_buf()));
        }
        if header[0x188 + 7] & 4 == 0 {
            return Err(RomfsError::Encrypted(path.to_path_buf()));
        }
        let romfs_offset = le32(&header, 0x1B0) as u64 * MEDIA_UNIT;
        file.seek(SeekFrom::Start(romfs_offset)).map_err(io)?;
        let mut ivfc = [0u8; 0x60];
        if read_full(&mut file, &mut ivfc).map_err(io)? < 0x60 || &ivfc[..4] != b"IVFC" {
            return Err(RomfsError::NoIvfc(path.to_path_buf()));
        }
        let master = le32(&ivfc, 8) as u64;
        let level3_size = le64(&ivfc, 0x44);
        let level3_block = le32(&ivfc, 0x4C);
        if level3_block > 40 {
            return Err(RomfsError::NoIvfc(path.to_path_buf()));
        }
        let block = 1u64 << level3_block;
        let level3_offset = romfs_offset + ((0x60 + master + block - 1) & !(block - 1));
        file.seek(SeekFrom::Start(level3_offset)).map_err(io)?;
        let mut first = [0u8; 4];
        if read_full(&mut file, &mut first).map_err(io)? < 4 || u32::from_le_bytes(first) != 0x28 {
            return Err(RomfsError::BadLevel3(path.to_path_buf()));
        }
        Ok(NcchRomfs {
            path: path.to_path_buf(),
            file: RefCell::new(file),
            romfs_offset,
            level3_offset,
            size: level3_size,
            files: OnceCell::new(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Position du romfs (IVFC) dans le `.cxi`.
    pub fn romfs_offset(&self) -> u64 {
        self.romfs_offset
    }

    /// Position du niveau 3 dans le `.cxi`.
    pub fn level3_offset(&self) -> u64 {
        self.level3_offset
    }

    /// Comme `read`, mais une erreur d'entrée-sortie est rendue au lieu d'une lecture écourtée.
    pub fn try_read(&self, position: u64, size: usize) -> Result<Vec<u8>, RomfsError> {
        if position >= self.size {
            return Ok(Vec::new());
        }
        let size = (size as u64).min(self.size - position) as usize;
        let io = |source| RomfsError::Io { path: self.path.clone(), source };
        let mut f = self.file.borrow_mut();
        f.seek(SeekFrom::Start(self.level3_offset + position)).map_err(io)?;
        let mut buf = vec![0u8; size];
        let n = read_full(&mut *f, &mut buf).map_err(io)?;
        buf.truncate(n);
        Ok(buf)
    }

    /// `files()` avec les erreurs : (chemin, position des données dans le niveau 3, taille). Calculé une fois.
    pub fn try_files(&self) -> Result<Vec<(String, u64, u64)>, RomfsError> {
        if let Some(v) = self.files.get() {
            return Ok(v.clone());
        }
        let v = self.read_files()?;
        Ok(self.files.get_or_init(|| v).clone())
    }

    fn need(&self, position: u64, size: u64, what: &str) -> Result<Vec<u8>, RomfsError> {
        let v = self.try_read(position, size as usize)?;
        if v.len() as u64 != size {
            return Err(RomfsError::Truncated(what.to_string()));
        }
        Ok(v)
    }

    fn read_files(&self) -> Result<Vec<(String, u64, u64)>, RomfsError> {
        let header = self.need(0, 0x28, "en-tête du niveau 3")?;
        let (dir_off, dir_size) = (le32(&header, 12) as u64, le32(&header, 16) as u64);
        let (file_off, file_size) = (le32(&header, 28) as u64, le32(&header, 32) as u64);
        let data_off = le32(&header, 36) as u64;
        let dirs = self.need(dir_off, dir_size, "table des dossiers")?;
        let files = self.need(file_off, file_size, "table des fichiers")?;
        let bad = |what: &str| RomfsError::Malformed(what.to_string());

        let mut names: HashMap<u32, String> = HashMap::new();
        let mut full_dir = |offset: u32| -> Result<String, RomfsError> {
            if let Some(s) = names.get(&offset) {
                return Ok(s.clone());
            }
            let mut parts = Vec::new();
            let mut cur = offset as usize;
            while cur != 0 {
                if parts.len() > 4096 || cur + 0x18 > dirs.len() {
                    return Err(bad("chemin de dossier hors table ou qui boucle"));
                }
                let parent = le32(&dirs, cur) as usize;
                let length = le32(&dirs, cur + 20) as usize;
                let raw = dirs
                    .get(cur + 0x18..cur.saturating_add(0x18).saturating_add(length))
                    .ok_or_else(|| bad("nom de dossier hors table"))?;
                parts.push(utf16(raw));
                cur = parent;
            }
            parts.reverse();
            let s = parts.join("/");
            names.insert(offset, s.clone());
            Ok(s)
        };

        let mut out = Vec::new();
        let mut pos = 0usize;
        while pos + 0x20 <= files.len() {
            let parent = le32(&files, pos);
            let data = le64(&files, pos + 8);
            let size = le64(&files, pos + 16);
            let length = le32(&files, pos + 28) as usize;
            let raw = files
                .get(pos + 0x20..(pos + 0x20).saturating_add(length))
                .ok_or_else(|| bad("nom de fichier hors table"))?;
            let name = utf16(raw);
            let folder = full_dir(parent)?;
            let path = if folder.is_empty() { name } else { format!("{folder}/{name}") };
            out.push((path, data_off + data, size));
            pos += 0x20 + ((length + 3) & !3);
        }
        Ok(out)
    }
}

fn utf16(raw: &[u8]) -> String {
    let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

/// Lit jusqu'à remplir `buf` ou jusqu'à la fin du fichier ; rend le nombre d'octets lus.
pub(crate) fn read_full<R: Read>(r: &mut R, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match r.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(n)
}

impl RomfsSource for NcchRomfs {
    fn size(&self) -> u64 {
        self.size
    }

    /// Une erreur d'entrée-sortie écourte la lecture (utiliser `try_read` pour la connaître).
    fn read(&self, position: u64, size: usize) -> Vec<u8> {
        self.try_read(position, size).unwrap_or_default()
    }

    /// Vide si les tables sont illisibles (utiliser `try_files` pour connaître l'erreur).
    fn files(&self) -> Vec<(String, u64, u64)> {
        self.try_files().unwrap_or_default()
    }
}
