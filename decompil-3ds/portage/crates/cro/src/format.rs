//! Le format CRO0 : un fichier `.cro` ou `static.crs` lu tel qu'il est sur la cartouche (rien n'est modifié).
//!
//! Port de `outils/cro_loader.py` (constantes, `Cro`, `read_crr`) ; les noms sont les mêmes, en anglais. Le
//! docstring de ce module Python décrit ce que fait le module `ro` de la console et d'où on le sait.

use std::collections::BTreeSet;
use std::fmt;

use crate::sha256::sha256;

pub const MAGIC: &[u8; 4] = b"CRO0";
/// La marque que ro écrit après la finition (`FIXED_MAGIC`).
pub const FIXED_MAGIC: &[u8; 4] = b"FIXD";
pub const STATIC_NAME: &str = "|static|";
pub const MAIN_BASE: u64 = 0x0010_0000;
/// Première page après `.data` et `.bss` du programme (0x664498 arrondi).
pub const MODULES_BASE: u64 = 0x0066_5000;
pub const PAGE: u64 = 0x1000;
pub const NO_TAG: u32 = 0xFFFF_FFFF;
/// ro refuse d'écrire hors de cette plage (`UNRESOLVED_SPACE`).
pub const UNRESOLVED_SPACE: (u64, u64) = (0x0010_0000, 0x0E00_0000);

/// Les champs de l'en-tête avec leur décalage (`HEADER_FIELDS`).
pub const HEADER_FIELDS: [(u32, &str); 18] = [
    (0x80, "magic"),
    (0x84, "name_offset"),
    (0x88, "next"),
    (0x8C, "previous"),
    (0x90, "file_size"),
    (0x94, "bss_size"),
    (0x98, "fixed_size"),
    (0x9C, "unknown_9c"),
    (0xA0, "control_object"),
    (0xA4, "on_load"),
    (0xA8, "on_exit"),
    (0xAC, "on_unresolved"),
    (0xB0, "code_offset"),
    (0xB4, "code_size"),
    (0xB8, "data_offset"),
    (0xBC, "data_size"),
    (0xC0, "module_name_offset"),
    (0xC4, "module_name_size"),
];

/// (position dans l'en-tête, nom, taille d'une case ; 1 pour une table de chaînes dont le « nombre » est une taille).
pub const TABLES: [(u32, &str, u32); 14] = [
    (0xC8, "segments", 12),
    (0xD0, "named_exports", 8),
    (0xD8, "indexed_exports", 4),
    (0xE0, "export_strings", 1),
    (0xE8, "export_tree", 8),
    (0xF0, "import_modules", 20),
    (0xF8, "external_patches", 12),
    (0x100, "named_imports", 8),
    (0x108, "indexed_imports", 8),
    (0x110, "anonymous_imports", 8),
    (0x118, "import_strings", 1),
    (0x120, "static_anonymous_exports", 8),
    (0x128, "internal_patches", 12),
    (0x130, "static_patches", 12),
];
pub const HEADER_END: u32 = 0x138;
/// L'ordre dans lequel ro exige que les tables se suivent dans le fichier (ro, 0x14006e80).
pub const RO_ORDER: [u32; 18] =
    [0xB0, 0xC0, 0xC8, 0xD0, 0xE8, 0xD8, 0xE0, 0xF0, 0xF8, 0x100, 0x108, 0x110, 0x118, 0x120, 0x128, 0x130, 0xB8, 0x90];

/// Les genres de segment (`SEGMENT_KINDS`) : 0 text, 1 rodata, 2 data, 3 bss.
pub const SEGMENT_KINDS: [(u32, &str); 4] = [(0, "text"), (1, "rodata"), (2, "data"), (3, "bss")];
pub const SEGMENT_FLAGS: [(u32, &str); 4] = [(0, "rx"), (1, "r"), (2, "rw"), (3, "rw")];
pub const PATCH_TYPES: [(u8, &str); 8] = [
    (0, "aucune"),
    (2, "R_ARM_ABS32"),
    (3, "R_ARM_REL32"),
    (10, "R_ARM_THM_CALL"),
    (28, "R_ARM_CALL"),
    (29, "R_ARM_JUMP24"),
    (38, "R_ARM_TARGET1"),
    (42, "R_ARM_PREL31"),
];

/// Le nom d'un genre de segment, ou `None` s'il est inconnu (`SEGMENT_KINDS.get(kind)`).
pub fn segment_kind_name(kind: u32) -> Option<&'static str> {
    SEGMENT_KINDS.iter().find(|(k, _)| *k == kind).map(|(_, n)| *n)
}

/// Le nom d'un type de correction (`PATCH_TYPES.get(type, type)`), le numéro en décimal s'il est inconnu.
pub fn patch_type_name(kind: u8) -> String {
    match PATCH_TYPES.iter().find(|(k, _)| *k == kind) {
        Some((_, name)) => (*name).to_string(),
        None => kind.to_string(),
    }
}

/// Les erreurs de la crate (`CroError` du Python, plus les deux cas que le service distingue par un code).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CroError {
    /// Fichier mal formé, ou refus de ro, avec le texte du Python.
    Invalid(String),
    /// `load_exe_cro` avant `initialize` (ldr_ro.py : 0xD9012C19).
    NotInitialized,
    /// `unload_cro` d'une adresse où rien n'est chargé (ldr_ro.py : 0xD9012C1E).
    NothingLoadedAt(u32),
}

impl fmt::Display for CroError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(text) => f.write_str(text),
            Self::NotInitialized => f.write_str("LoadExeCRO avant Initialize"),
            Self::NothingLoadedAt(mirror) => write!(f, "rien de chargé à {mirror:#x}"),
        }
    }
}

impl std::error::Error for CroError {}

pub(crate) fn invalid<T>(text: String) -> Result<T, CroError> {
    Err(CroError::Invalid(text))
}

/// `align(value, step)` : arrondi au multiple supérieur (`step` puissance de deux).
pub fn align(value: u64, step: u64) -> u64 {
    (value + step - 1) & !(step - 1)
}

/// Lit un mot de 32 bits ; la lecture hors du tampon est une erreur (`struct.error` en Python).
pub fn u32_at(data: &[u8], offset: u64) -> Result<u32, CroError> {
    let slice = usize::try_from(offset).ok().and_then(|o| data.get(o..)).and_then(|s| s.get(..4));
    match slice {
        Some(b) => Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        None => invalid(format!("lecture de 4 octets à {offset:#x} hors d'un tampon de {:#x} octets", data.len())),
    }
}

fn u16_at(data: &[u8], offset: u64) -> Result<u16, CroError> {
    let slice = usize::try_from(offset).ok().and_then(|o| data.get(o..)).and_then(|s| s.get(..2));
    match slice {
        Some(b) => Ok(u16::from_le_bytes([b[0], b[1]])),
        None => invalid(format!("lecture de 2 octets à {offset:#x} hors d'un tampon de {:#x} octets", data.len())),
    }
}

/// Une chaîne terminée par un zéro (`c_string`) : ASCII, les autres octets deviennent U+FFFD comme `errors='replace'`.
pub fn c_string(data: &[u8], offset: u64, limit: Option<u64>) -> Result<String, CroError> {
    let limit = limit.unwrap_or(data.len() as u64).min(data.len() as u64);
    let found = if offset < limit {
        data[offset as usize..limit as usize].iter().position(|&b| b == 0).map(|p| offset as usize + p)
    } else {
        None
    };
    match found {
        Some(end) => {
            Ok(data[offset as usize..end].iter().map(|&b| if b < 0x80 { b as char } else { '\u{FFFD}' }).collect())
        }
        None => invalid(format!("chaîne sans fin à {offset:#x}")),
    }
}

/// Adresse étiquetée -> (numéro de segment, décalage dans le segment) (`split_tag`).
pub fn split_tag(tag: u32) -> (u32, u32) {
    (tag & 0xF, tag >> 4)
}

/// `make_tag(segment, offset)`.
pub fn make_tag(segment: u32, offset: u32) -> u32 {
    (offset << 4) | segment
}

/// Une correction de 12 octets (`Patch`) : adresse étiquetée du mot visé, type, un octet « dernière de la liste »
/// (import) ou numéro du segment du symbole (correction interne), l'octet « liste résolue », la valeur à ajouter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Patch {
    pub index: usize,
    pub tag: u32,
    pub kind: u8,
    pub flag: u8,
    pub resolved: u8,
    pub addend: i32,
}

/// Les champs de l'en-tête à partir de 0x84 (`Cro.header`, un dictionnaire en Python).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Header {
    pub name_offset: u32,
    pub next: u32,
    pub previous: u32,
    pub file_size: u32,
    pub bss_size: u32,
    pub fixed_size: u32,
    pub unknown_9c: u32,
    pub control_object: u32,
    pub on_load: u32,
    pub on_exit: u32,
    pub on_unresolved: u32,
    pub code_offset: u32,
    pub code_size: u32,
    pub data_offset: u32,
    pub data_size: u32,
    pub module_name_offset: u32,
    pub module_name_size: u32,
}

/// Un module importé (`import_modules`) : nom, imports par numéro (numéro, liste), imports anonymes (étiquette, liste).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportModule {
    pub name: String,
    pub indexed: Vec<(u32, u32)>,
    pub anonymous: Vec<(u32, u32)>,
}

/// Un fichier .cro ou static.crs lu tel qu'il est sur la cartouche (`Cro`).
#[derive(Debug, Clone)]
pub struct Cro {
    pub data: Vec<u8>,
    pub file_name: String,
    pub header: Header,
    /// (début, nombre) de chaque table, dans l'ordre de `TABLES`.
    pub tables: Vec<(u32, u32)>,
    pub name: String,
    pub is_static: bool,
    /// (décalage ou adresse, taille, genre).
    pub segments: Vec<(u32, u32, u32)>,
    pub named_exports: Vec<(String, u32)>,
    pub indexed_exports: Vec<u32>,
    /// Nœuds de l'arbre des exports : (bit, fils gauche, fils droit, numéro d'export).
    pub export_tree: Vec<(u16, u16, u16, u16)>,
    pub external_patches: Vec<Patch>,
    pub internal_patches: Vec<Patch>,
    pub static_patches: Vec<Patch>,
    /// (nom, décalage de la liste de corrections dans le fichier).
    pub named_imports: Vec<(String, u32)>,
    pub indexed_imports: Vec<(u32, u32)>,
    pub anonymous_imports: Vec<(u32, u32)>,
    pub static_anonymous_exports: Vec<(u32, u32)>,
    pub import_modules: Vec<ImportModule>,
}

fn table_of(tables: &[(u32, u32)], name: &str) -> (u32, u32) {
    TABLES.iter().position(|(_, n, _)| *n == name).map_or((0, 0), |i| tables[i])
}

fn pairs(data: &[u8], tables: &[(u32, u32)], name: &str) -> Result<Vec<(u32, u32)>, CroError> {
    let (start, count) = table_of(tables, name);
    (0..count as u64)
        .map(|i| Ok((u32_at(data, start as u64 + 8 * i)?, u32_at(data, start as u64 + 8 * i + 4)?)))
        .collect()
}

fn patches(data: &[u8], tables: &[(u32, u32)], name: &str) -> Result<Vec<Patch>, CroError> {
    let (start, count) = table_of(tables, name);
    (0..count as usize)
        .map(|i| {
            let at = start as u64 + 12 * i as u64;
            let tag = u32_at(data, at)?;
            let b = &data[at as usize + 4..at as usize + 8];
            Ok(Patch { index: i, tag, kind: b[0], flag: b[1], resolved: b[2], addend: u32_at(data, at + 8)? as i32 })
        })
        .collect()
}

impl Cro {
    /// Lit un fichier (`Cro.__init__`) ; `file_name` ne sert qu'aux messages.
    pub fn new(data: &[u8], file_name: &str) -> Result<Cro, CroError> {
        if data.len() < HEADER_END as usize {
            return invalid(format!("{file_name} : {} octets, trop court pour un en-tête", data.len()));
        }
        if &data[0x80..0x84] != MAGIC {
            return invalid(format!("{file_name} : marque {:?} au lieu de CRO0", &data[0x80..0x84]));
        }
        let word = |offset: u32| u32_at(data, offset as u64);
        let header = Header {
            name_offset: word(0x84)?,
            next: word(0x88)?,
            previous: word(0x8C)?,
            file_size: word(0x90)?,
            bss_size: word(0x94)?,
            fixed_size: word(0x98)?,
            unknown_9c: word(0x9C)?,
            control_object: word(0xA0)?,
            on_load: word(0xA4)?,
            on_exit: word(0xA8)?,
            on_unresolved: word(0xAC)?,
            code_offset: word(0xB0)?,
            code_size: word(0xB4)?,
            data_offset: word(0xB8)?,
            data_size: word(0xBC)?,
            module_name_offset: word(0xC0)?,
            module_name_size: word(0xC4)?,
        };
        let mut tables = Vec::new();
        for (offset, name, entry) in TABLES {
            let (start, count) = (word(offset)?, word(offset + 4)?);
            let size = count as u64 * entry as u64;
            if start as u64 + size > data.len() as u64 {
                return invalid(format!("{file_name} : table {name} hors du fichier ({start:#x} + {size:#x})"));
            }
            tables.push((start, count));
        }
        if header.file_size as usize != data.len() {
            return invalid(format!("{file_name} : taille annoncée {:#x}, fichier {:#x}", header.file_size, data.len()));
        }
        let name_start = header.module_name_offset as usize;
        let name_end = name_start + header.module_name_size as usize;
        let Some(raw_name) = data.get(name_start..name_end) else {
            return invalid(format!("{file_name} : nom du module hors du fichier"));
        };
        let trimmed_len = raw_name.iter().rposition(|&b| b != 0).map_or(0, |p| p + 1);
        if !raw_name[..trimmed_len].is_ascii() {
            return invalid(format!("{file_name} : nom du module non ASCII"));
        }
        let name: String = raw_name[..trimmed_len].iter().map(|&b| b as char).collect();
        let is_static = name == STATIC_NAME;
        let (seg_start, seg_count) = table_of(&tables, "segments");
        let segments = (0..seg_count as u64)
            .map(|i| {
                let at = seg_start as u64 + 12 * i;
                Ok((u32_at(data, at)?, u32_at(data, at + 4)?, u32_at(data, at + 8)?))
            })
            .collect::<Result<Vec<_>, CroError>>()?;
        let (start, count) = table_of(&tables, "named_exports");
        let strings = table_of(&tables, "export_strings");
        let limit = strings.0 as u64 + strings.1 as u64;
        let named_exports = (0..count as u64)
            .map(|i| {
                let at = start as u64 + 8 * i;
                Ok((c_string(data, u32_at(data, at)? as u64, Some(limit))?, u32_at(data, at + 4)?))
            })
            .collect::<Result<Vec<_>, CroError>>()?;
        let (start, count) = table_of(&tables, "indexed_exports");
        let indexed_exports =
            (0..count as u64).map(|i| u32_at(data, start as u64 + 4 * i)).collect::<Result<Vec<_>, _>>()?;
        let (start, count) = table_of(&tables, "export_tree");
        let export_tree = (0..count as u64)
            .map(|i| {
                let at = start as u64 + 8 * i;
                Ok((u16_at(data, at)?, u16_at(data, at + 2)?, u16_at(data, at + 4)?, u16_at(data, at + 6)?))
            })
            .collect::<Result<Vec<_>, CroError>>()?;
        let external_patches = patches(data, &tables, "external_patches")?;
        let internal_patches = patches(data, &tables, "internal_patches")?;
        let static_patches = patches(data, &tables, "static_patches")?;
        // Les imports désignent leur liste de corrections par un décalage dans le fichier : on le garde tel quel.
        let named_imports = pairs(data, &tables, "named_imports")?
            .into_iter()
            .map(|(n, b)| Ok((c_string(data, n as u64, None)?, b)))
            .collect::<Result<Vec<_>, CroError>>()?;
        let indexed_imports = pairs(data, &tables, "indexed_imports")?;
        let anonymous_imports = pairs(data, &tables, "anonymous_imports")?;
        let static_anonymous_exports = pairs(data, &tables, "static_anonymous_exports")?;
        let (start, count) = table_of(&tables, "import_modules");
        let mut import_modules = Vec::new();
        for i in 0..count as u64 {
            let at = start as u64 + 20 * i;
            let name_offset = u32_at(data, at)? as u64;
            let (indexed_start, indexed_count) = (u32_at(data, at + 4)? as u64, u32_at(data, at + 8)? as u64);
            let (anonymous_start, anonymous_count) = (u32_at(data, at + 12)? as u64, u32_at(data, at + 16)? as u64);
            let read_pairs = |first: u64, n: u64| -> Result<Vec<(u32, u32)>, CroError> {
                (0..n).map(|k| Ok((u32_at(data, first + 8 * k)?, u32_at(data, first + 8 * k + 4)?))).collect()
            };
            import_modules.push(ImportModule {
                name: c_string(data, name_offset, None)?,
                indexed: read_pairs(indexed_start, indexed_count)?,
                anonymous: read_pairs(anonymous_start, anonymous_count)?,
            });
        }
        Ok(Cro {
            data: data.to_vec(),
            file_name: file_name.to_string(),
            header,
            tables,
            name,
            is_static,
            segments,
            named_exports,
            indexed_exports,
            export_tree,
            external_patches,
            internal_patches,
            static_patches,
            named_imports,
            indexed_imports,
            anonymous_imports,
            static_anonymous_exports,
            import_modules,
        })
    }

    /// (début, nombre) d'une table par son nom de `TABLES` ; (0, 0) si le nom n'existe pas (`tables[name]`).
    pub fn table(&self, name: &str) -> (u32, u32) {
        table_of(&self.tables, name)
    }

    // --- lecture ---

    /// Le premier segment de ce genre qui n'est pas vide (`segment_of_kind`).
    pub fn segment_of_kind(&self, kind: u32) -> Option<usize> {
        self.segments.iter().position(|&(_, size, k)| k == kind && size != 0)
    }

    /// Où tombe une adresse étiquetée dans le fichier, ou `None` si ro la refuserait (`tag_file_offset`).
    pub fn tag_file_offset(&self, tag: u32) -> Option<u64> {
        let (segment, offset) = split_tag(tag);
        let entry = self.segments.get(segment as usize)?;
        if offset >= entry.1 {
            return None;
        }
        Some(entry.0 as u64 + offset as u64)
    }

    /// La liste de corrections qui commence à ce décalage de la table des imports : jusqu'à la marque de fin
    /// (`Cro.batch`).
    pub fn batch(&self, file_offset: u32) -> Result<Vec<Patch>, CroError> {
        let (start, count) = self.table("external_patches");
        let (start, count) = (start as u64, count as u64);
        let at = file_offset as u64;
        if at < start || (at - start) % 12 != 0 || at >= start + 12 * count {
            return invalid(format!("{} : liste de corrections à {at:#x} hors de la table", self.name));
        }
        let first = ((at - start) / 12) as usize;
        let mut out = Vec::new();
        for patch in &self.external_patches[first..] {
            out.push(*patch);
            if patch.flag != 0 {
                break;
            }
        }
        Ok(out)
    }

    /// Cherche un export par son nom avec l'arbre de l'en-tête, comme ro (0x14004fc0) : rend l'adresse étiquetée
    /// ou `None` (`find_named_export`). Un nœud : bit à tester (octet × 8 + bit, le bit 0 étant le poids faible),
    /// fils gauche, fils droit (bit 15 : c'est une feuille, le nœud désigné donne le numéro d'export), numéro
    /// d'export. Le nœud 0 ne sert que d'entrée : on part de son fils gauche.
    pub fn find_named_export(&self, name: &str) -> Option<u32> {
        if self.export_tree.is_empty() {
            return None;
        }
        let raw = name.as_bytes();
        let mut child = self.export_tree[0].1;
        for _ in 0..self.export_tree.len() + 1 {
            // Un indice hors de l'arbre : le Python lèverait IndexError, ici l'export est simplement introuvable.
            let node = self.export_tree.get((child & 0x7FFF) as usize)?;
            if child & 0x8000 != 0 {
                return match self.named_exports.get(node.3 as usize) {
                    Some((n, tag)) if n == name => Some(*tag),
                    _ => None,
                };
            }
            let bit = node.0;
            let byte = (bit >> 3) as usize;
            child = if byte < raw.len() && (raw[byte] >> (bit & 7)) & 1 != 0 { node.2 } else { node.1 };
        }
        None
    }

    // --- contrôles ---

    /// [(nom, empreinte écrite, empreinte recalculée)] pour les quatre empreintes de l'en-tête (`hashes`).
    pub fn hashes(&self) -> Vec<(&'static str, Vec<u8>, [u8; 32])> {
        let h = &self.header;
        let regions = [
            ("en-tête", 0x80u64, 0x100u64),
            ("code", h.code_offset as u64, h.code_size as u64),
            ("tables", h.module_name_offset as u64, (h.data_offset as u64).wrapping_sub(h.module_name_offset as u64)),
            ("données", h.data_offset as u64, h.data_size as u64),
        ];
        regions
            .iter()
            .enumerate()
            .map(|(i, &(name, start, size))| {
                let end = start.saturating_add(size).min(self.data.len() as u64) as usize;
                let begin = (start as usize).min(end);
                (name, self.data[32 * i..32 * i + 32].to_vec(), sha256(&self.data[begin..end]))
            })
            .collect()
    }

    /// L'empreinte que static.crr liste pour ce fichier : SHA-256 de ses 0x80 premiers octets (`crr_hash`).
    pub fn crr_hash(&self) -> [u8; 32] {
        sha256(&self.data[..0x80])
    }

    /// Ce que ro refuserait dans l'en-tête (ro, 0x14006e80), en clair. Liste vide : accepté (`ro_header_problems`).
    pub fn ro_header_problems(&self) -> Vec<String> {
        let mut problems = Vec::new();
        let h = &self.header;
        if h.next != 0 || h.previous != 0 {
            problems.push("maillons 0x88/0x8C non nuls".to_string());
        }
        if h.fixed_size != 0 {
            problems.push("0x98 (taille après finition) non nul".to_string());
        }
        if h.file_size > 0x0FFF_FFFF || h.bss_size > 0x0FFF_FFFF {
            problems.push("taille ou .bss démesurés".to_string());
        }
        if h.code_offset < HEADER_END {
            problems.push("le code commence avant 0x138".to_string());
        }
        let values: Vec<u32> = RO_ORDER.iter().map(|&o| u32_at(&self.data, o as u64).unwrap_or(0)).collect();
        for i in 0..RO_ORDER.len() - 1 {
            let (a, va, b, vb) = (RO_ORDER[i], values[i], RO_ORDER[i + 1], values[i + 1]);
            if vb < va {
                problems.push(format!("table {b:#x} ({vb:#x}) avant table {a:#x} ({va:#x})"));
            }
        }
        for name in ["export_strings", "import_strings"] {
            let (start, size) = self.table(name);
            if size != 0 && self.data[start as usize + size as usize - 1] != 0 {
                problems.push(format!("{name} ne finit pas par un zéro"));
            }
        }
        if let Some(last) = self.external_patches.last() {
            if last.flag == 0 {
                problems.push("la dernière correction d'import ne porte pas la marque de fin".to_string());
            }
        }
        problems
    }

    /// Fin (décalage) de ce que ro garde à ce niveau de finition, avant l'arrondi à la page (`fixed_end`).
    pub fn fixed_end(&self, level: u32) -> u64 {
        let h = &self.header;
        let end = |name: &str, entry: u64| {
            let (start, count) = self.table(name);
            start as u64 + count as u64 * entry
        };
        let max = |values: &[u64]| values.iter().copied().max().unwrap_or(0);
        let level3 = max(&[
            HEADER_END as u64,
            h.code_offset as u64 + h.code_size as u64,
            h.module_name_offset as u64 + h.module_name_size as u64,
            end("segments", 12),
        ]);
        let level2 = max(&[
            level3,
            end("named_exports", 8),
            end("indexed_exports", 4),
            end("export_strings", 1),
            end("export_tree", 8),
        ]);
        let level1 = max(&[
            level2,
            end("import_modules", 8),
            end("external_patches", 12),
            end("named_imports", 8),
            end("indexed_imports", 8),
            end("anonymous_imports", 8),
            end("import_strings", 1),
        ]);
        let level0 =
            max(&[level1, end("static_patches", 12), end("static_anonymous_exports", 8), end("internal_patches", 12)]);
        match level {
            1 => level1,
            2 => level2,
            3 => level3,
            _ => level0,
        }
    }
}

/// Les empreintes d'un .crr : décalage de la table à 0x350, nombre de cases à 0x354, 32 octets par case (`read_crr`).
pub fn read_crr(data: &[u8]) -> Result<BTreeSet<[u8; 32]>, CroError> {
    if data.get(..4) != Some(b"CRR0") {
        return invalid("pas un CRR0".to_string());
    }
    let start = u32_at(data, 0x350)? as usize;
    let count = u32_at(data, 0x354)? as usize;
    let mut out = BTreeSet::new();
    for i in 0..count {
        // Une case coupée par la fin du fichier n'est jamais une empreinte entière : on l'ignore.
        if let Some(cell) = data.get(start + 32 * i..start + 32 * i + 32) {
            let mut h = [0u8; 32];
            h.copy_from_slice(cell);
            out.insert(h);
        }
    }
    Ok(out)
}
