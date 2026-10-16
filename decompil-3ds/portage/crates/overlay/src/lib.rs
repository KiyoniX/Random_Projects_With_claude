//! Lecture de la sortie PC du moteur de mods (`mods/build.py --pc`) : `overlay.json` (format 1) et le dossier
//! `romfs/` à côté. Voir « Le contrat avec le portage PC » dans `mods/README.md`.
//!
//! Cette crate ne connaît aucun format du jeu : elle dit seulement, pour un chemin du romfs (`a/0/7/4`, sans barre
//! initiale), si le fichier vient d'un mod (à servir depuis `romfs/`) ou du jeu (rien à surcharger).

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Version la plus récente de `overlay.json` que ce lecteur comprend.
pub const SUPPORTED_FORMAT: u64 = 1;

/// Erreurs de lecture et de service.
#[derive(Debug)]
pub enum OverlayError {
    /// Lecture d'un fichier impossible.
    Io { path: PathBuf, source: io::Error },
    /// `overlay.json` n'est pas un JSON du bon type.
    Json(serde_json::Error),
    /// Le champ obligatoire `format` manque.
    MissingFormat,
    /// `format` plus récent que ce que le lecteur sait lire.
    UnsupportedFormat { found: u64, supported: u64 },
    /// Chemin qui sort du dossier ou mal formé.
    InvalidPath(String),
    /// Chemin absent de la liste des fichiers du mod.
    UnknownFile(String),
    /// La taille lue ne correspond pas à celle annoncée.
    SizeMismatch { path: String, expected: u64, found: u64 },
    /// Le sha1 lu ne correspond pas à celui annoncé.
    HashMismatch { path: String, expected: String, found: String },
}

impl fmt::Display for OverlayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, source } => write!(f, "lecture de {} impossible : {source}", path.display()),
            Self::Json(e) => write!(f, "overlay.json invalide : {e}"),
            Self::MissingFormat => write!(f, "overlay.json n'a pas de champ « format »"),
            Self::UnsupportedFormat { found, supported } => write!(
                f,
                "overlay.json est au format {found}, ce lecteur comprend jusqu'au format {supported}"
            ),
            Self::InvalidPath(p) => write!(f, "chemin refusé (hors du dossier ou mal formé) : {p:?}"),
            Self::UnknownFile(p) => write!(f, "fichier absent de overlay.json : {p}"),
            Self::SizeMismatch { path, expected, found } => {
                write!(f, "{path} : taille {found} au lieu de {expected} annoncés")
            }
            Self::HashMismatch { path, expected, found } => {
                write!(f, "{path} : sha1 {found} au lieu de {expected} annoncé")
            }
        }
    }
}

impl std::error::Error for OverlayError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Json(e) => Some(e),
            _ => None,
        }
    }
}

pub type Result<T> = std::result::Result<T, OverlayError>;

/// Un mod, tel que résumé dans `overlay.json`.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct ModInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
}

/// Un fichier du romfs fourni par les mods.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct FileEntry {
    pub size: u64,
    pub sha1: String,
    /// Vrai si le jeu n'a pas ce fichier (ajout pur).
    pub new: bool,
}

/// D'où vient un fichier du romfs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    /// Le fichier du mod, à servir à la place de celui du jeu.
    Overlay(PathBuf),
    /// Le fichier vient du romfs du jeu, rien à surcharger.
    Game,
}

#[derive(Deserialize)]
struct Raw {
    format: Option<u64>,
    #[serde(default)]
    game: String,
    #[serde(default)]
    title_id: String,
    #[serde(default)]
    update_title_id: String,
    #[serde(default)]
    mods: Vec<ModInfo>,
    #[serde(default)]
    files: BTreeMap<String, FileEntry>,
    #[serde(default)]
    code_patches: Vec<serde_json::Value>,
}

/// Le contenu d'un dossier `pc/` produit par le moteur de mods.
#[derive(Debug, Clone)]
pub struct Overlay {
    dir: PathBuf,
    pub format: u64,
    pub game: String,
    pub title_id: String,
    pub update_title_id: String,
    mods: Vec<ModInfo>,
    files: BTreeMap<String, FileEntry>,
    code_patches: Vec<serde_json::Value>,
}

impl Overlay {
    /// Lit `dir/overlay.json`. Les champs inconnus sont ignorés ; un `format` plus grand que 1 est refusé.
    pub fn load(dir: &Path) -> Result<Overlay> {
        let json_path = dir.join("overlay.json");
        let text = fs::read(&json_path).map_err(|source| OverlayError::Io { path: json_path, source })?;
        let raw: Raw = serde_json::from_slice(&text).map_err(OverlayError::Json)?;
        let format = raw.format.ok_or(OverlayError::MissingFormat)?;
        if format > SUPPORTED_FORMAT {
            return Err(OverlayError::UnsupportedFormat { found: format, supported: SUPPORTED_FORMAT });
        }
        Ok(Overlay {
            dir: dir.to_path_buf(),
            format,
            game: raw.game,
            title_id: raw.title_id,
            update_title_id: raw.update_title_id,
            mods: raw.mods,
            files: raw.files,
            code_patches: raw.code_patches,
        })
    }

    /// Les chemins des fichiers du mod, triés.
    pub fn files(&self) -> Vec<&str> {
        self.files.keys().map(String::as_str).collect()
    }

    pub fn contains(&self, path: &str) -> bool {
        self.files.contains_key(path)
    }

    pub fn entry(&self, path: &str) -> Option<&FileEntry> {
        self.files.get(path)
    }

    pub fn mods(&self) -> &[ModInfo] {
        &self.mods
    }

    /// Les correctifs de code, tels quels (valeurs JSON).
    pub fn code_patches(&self) -> &[serde_json::Value] {
        &self.code_patches
    }

    /// Chemin sur disque du fichier d'un mod, après vérification du chemin (sans lire le fichier).
    pub fn disk_path(&self, path: &str) -> Result<PathBuf> {
        check_path(path)?;
        let mut full = self.dir.join("romfs");
        full.extend(path.split('/'));
        Ok(full)
    }

    /// Lit le fichier du mod et vérifie sa taille annoncée.
    pub fn open(&self, path: &str) -> Result<Vec<u8>> {
        let full = self.disk_path(path)?;
        let entry = self.entry(path).ok_or_else(|| OverlayError::UnknownFile(path.to_string()))?;
        let data = fs::read(&full).map_err(|source| OverlayError::Io { path: full, source })?;
        if data.len() as u64 != entry.size {
            return Err(OverlayError::SizeMismatch {
                path: path.to_string(),
                expected: entry.size,
                found: data.len() as u64,
            });
        }
        Ok(data)
    }

    /// Contrôle la taille et le sha1 d'un fichier.
    pub fn verify(&self, path: &str) -> Result<()> {
        let data = self.open(path)?;
        let entry = &self.files[path];
        let found = hex(&sha1(&data));
        if !found.eq_ignore_ascii_case(&entry.sha1) {
            return Err(OverlayError::HashMismatch {
                path: path.to_string(),
                expected: entry.sha1.clone(),
                found,
            });
        }
        Ok(())
    }

    /// Contrôle tous les fichiers ; s'arrête à la première erreur.
    pub fn verify_all(&self) -> Result<()> {
        for path in self.files.keys() {
            self.verify(path)?;
        }
        Ok(())
    }

    /// D'où servir `path` (chemin du romfs sans barre initiale).
    pub fn resolve(&self, path: &str) -> Source {
        if self.contains(path) {
            if let Ok(full) = self.disk_path(path) {
                return Source::Overlay(full);
            }
        }
        Source::Game
    }
}

/// Refuse tout chemin qui pourrait sortir de `romfs/` : vide, absolu, antislash, lettre de lecteur, `.`/`..`,
/// composants vides, octet nul.
fn check_path(path: &str) -> Result<()> {
    let bad = path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.contains('\0')
        || path.split('/').any(|c| c.is_empty() || c == "." || c == "..");
    if bad { Err(OverlayError::InvalidPath(path.to_string())) } else { Ok(()) }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// SHA-1 (FIPS 180-4), suffisant pour contrôler l'intégrité des fichiers (pas un usage de sécurité).
pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let split = data.len() - data.len() % 64;
    let mut tail = data[split..].to_vec();
    tail.push(0x80);
    while tail.len() % 64 != 56 {
        tail.push(0);
    }
    tail.extend_from_slice(&((data.len() as u64).wrapping_mul(8)).to_be_bytes());
    for block in data[..split].chunks_exact(64).chain(tail.chunks_exact(64)) {
        let mut w = [0u32; 80];
        for (i, c) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([c[0], c[1], c[2], c[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(y);
        }
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Dossier temporaire supprimé à la fin du test.
    struct Tmp(PathBuf);
    impl Tmp {
        fn new() -> Tmp {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let p = std::env::temp_dir().join(format!("overlay-test-{}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const FILES: [(&str, &[u8], bool); 4] = [
        ("a/0/7/4", b"texte un", false),
        ("a/0/7/5", b"texte deux, un peu plus long", false),
        ("a/2/1/8", &[0, 1, 2, 3, 255, 254], false),
        ("a/9/9/9", b"fichier ajoute", true),
    ];

    /// Fabrique un dossier `pc/` : overlay.json (avec des champs en plus si `extra`) et romfs/.
    fn build(extra: &str) -> Tmp {
        let tmp = Tmp::new();
        let mut files = Vec::new();
        for (p, d, new) in FILES {
            let full = tmp.0.join("romfs").join(p);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(&full, d).unwrap();
            files.push(format!(
                "\"{p}\": {{\"size\": {}, \"sha1\": \"{}\", \"new\": {new}}}",
                d.len(),
                hex(&sha1(d))
            ));
        }
        let json = format!(
            "{{\"format\": 1, \"game\": \"jeu-test\", \"title_id\": \"0004000000000001\", \
             \"update_title_id\": \"0004000E00000001\", \
             \"mods\": [{{\"id\": \"m\", \"name\": \"Mod\", \"version\": \"1.0.0\", \"author\": \"Moi\"}}], \
             \"files\": {{{}}}, \"code_patches\": []{extra}}}",
            files.join(", ")
        );
        fs::write(tmp.0.join("overlay.json"), json).unwrap();
        tmp
    }

    fn json_only(json: &str) -> Tmp {
        let tmp = Tmp::new();
        fs::write(tmp.0.join("overlay.json"), json).unwrap();
        tmp
    }

    #[test]
    fn sha1_standard_vectors() {
        assert_eq!(hex(&sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(hex(&sha1(b"abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            hex(&sha1(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
            "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
        );
        assert_eq!(hex(&sha1(&vec![b'a'; 1_000_000])), "34aa973cd4c4daa4f61eeb2bdbad27316534016f");
    }

    #[test]
    fn loads_and_serves() {
        let tmp = build("");
        let o = Overlay::load(&tmp.0).unwrap();
        assert_eq!(o.format, 1);
        assert_eq!(o.game, "jeu-test");
        assert_eq!(o.mods().len(), 1);
        assert_eq!(o.mods()[0].id, "m");
        assert_eq!(o.mods()[0].author, "Moi");
        assert_eq!(o.files(), vec!["a/0/7/4", "a/0/7/5", "a/2/1/8", "a/9/9/9"]);
        assert!(o.code_patches().is_empty());
        assert!(o.contains("a/0/7/4"));
        assert!(o.entry("a/9/9/9").unwrap().new);
        assert!(!o.entry("a/0/7/4").unwrap().new);
        assert_eq!(o.open("a/2/1/8").unwrap(), vec![0, 1, 2, 3, 255, 254]);
        o.verify("a/0/7/5").unwrap();
        o.verify_all().unwrap();
    }

    #[test]
    fn resolve_overlay_or_game() {
        let tmp = build("");
        let o = Overlay::load(&tmp.0).unwrap();
        let expected = tmp.0.join("romfs").join("a").join("0").join("7").join("4");
        assert_eq!(o.resolve("a/0/7/4"), Source::Overlay(expected));
        assert_eq!(o.resolve("a/0/7/6"), Source::Game);
        assert_eq!(o.resolve("/a/0/7/4"), Source::Game);
        assert_eq!(o.resolve("../overlay.json"), Source::Game);
    }

    #[test]
    fn refuses_newer_format() {
        let tmp = json_only("{\"format\": 2}");
        match Overlay::load(&tmp.0) {
            Err(OverlayError::UnsupportedFormat { found: 2, supported: 1 }) => {}
            other => panic!("attendu UnsupportedFormat, obtenu {other:?}"),
        }
    }

    #[test]
    fn requires_format() {
        let tmp = json_only("{\"game\": \"x\", \"files\": {}}");
        assert!(matches!(Overlay::load(&tmp.0), Err(OverlayError::MissingFormat)));
    }

    #[test]
    fn refuses_invalid_json() {
        let tmp = json_only("{\"format\": 1,");
        assert!(matches!(Overlay::load(&tmp.0), Err(OverlayError::Json(_))));
        let tmp = Tmp::new();
        assert!(matches!(Overlay::load(&tmp.0), Err(OverlayError::Io { .. })));
    }

    #[test]
    fn defaults_when_minimal() {
        let tmp = json_only("{\"format\": 1}");
        let o = Overlay::load(&tmp.0).unwrap();
        assert!(o.files().is_empty() && o.mods().is_empty() && o.code_patches().is_empty());
        assert_eq!(o.game, "");
    }

    #[test]
    fn tolerates_unknown_fields() {
        let tmp = build(", \"pc_extras\": {\"textures\": [1, 2]}, \"avenir\": true");
        let o = Overlay::load(&tmp.0).unwrap();
        assert_eq!(o.files().len(), 4);
        // Champs inconnus aussi à l'intérieur d'un mod et d'un fichier.
        let json = "{\"format\": 1, \"mods\": [{\"id\": \"a\", \"licence\": \"MIT\"}], \
                    \"files\": {\"x/y\": {\"size\": 0, \"sha1\": \"\", \"new\": false, \"mode\": 7}}}";
        let tmp = json_only(json);
        let o = Overlay::load(&tmp.0).unwrap();
        assert_eq!(o.mods()[0].id, "a");
        assert!(o.contains("x/y"));
    }

    #[test]
    fn keeps_code_patches_as_json() {
        let tmp = build("");
        let json = fs::read_to_string(tmp.0.join("overlay.json")).unwrap().replace(
            "\"code_patches\": []",
            "\"code_patches\": [{\"address\": 1048576, \"size\": 4, \"mod\": \"m\"}]",
        );
        fs::write(tmp.0.join("overlay.json"), json).unwrap();
        let o = Overlay::load(&tmp.0).unwrap();
        assert_eq!(o.code_patches().len(), 1);
        assert_eq!(o.code_patches()[0]["address"], 1048576);
        assert_eq!(o.code_patches()[0]["mod"], "m");
    }

    #[test]
    fn refuses_path_escape() {
        let tmp = build("");
        fs::write(tmp.0.join("secret"), b"x").unwrap();
        let o = Overlay::load(&tmp.0).unwrap();
        for bad in [
            "../secret",
            "a/../../secret",
            "/etc/passwd",
            "a\\0\\7\\4",
            "C:/Windows/win.ini",
            "C:secret",
            "",
            "a//b",
            "./a/0/7/4",
            "a/0/7/4/",
        ] {
            assert!(matches!(o.open(bad), Err(OverlayError::InvalidPath(_))), "{bad:?} aurait dû être refusé");
            assert!(matches!(o.disk_path(bad), Err(OverlayError::InvalidPath(_))), "{bad:?}");
            assert_eq!(o.resolve(bad), Source::Game);
        }
    }

    #[test]
    fn refuses_path_escape_even_if_listed() {
        let tmp = json_only(
            "{\"format\": 1, \"files\": {\"../secret\": {\"size\": 1, \"sha1\": \"\", \"new\": false}}}",
        );
        let o = Overlay::load(&tmp.0).unwrap();
        assert!(matches!(o.open("../secret"), Err(OverlayError::InvalidPath(_))));
        assert_eq!(o.resolve("../secret"), Source::Game);
    }

    #[test]
    fn unknown_file_is_reported() {
        let tmp = build("");
        let o = Overlay::load(&tmp.0).unwrap();
        assert!(matches!(o.open("a/0/7/6"), Err(OverlayError::UnknownFile(_))));
        assert!(o.entry("a/0/7/6").is_none());
    }

    #[test]
    fn detects_wrong_size() {
        let tmp = build("");
        fs::write(tmp.0.join("romfs/a/0/7/4"), b"trop long pour la taille annoncee").unwrap();
        let o = Overlay::load(&tmp.0).unwrap();
        assert!(matches!(o.open("a/0/7/4"), Err(OverlayError::SizeMismatch { .. })));
        assert!(matches!(o.verify("a/0/7/4"), Err(OverlayError::SizeMismatch { .. })));
        assert!(o.verify_all().is_err());
    }

    #[test]
    fn detects_wrong_sha1() {
        let tmp = build("");
        // Même taille, contenu différent.
        fs::write(tmp.0.join("romfs/a/0/7/4"), b"texte on").unwrap();
        let o = Overlay::load(&tmp.0).unwrap();
        assert!(o.open("a/0/7/4").is_ok());
        assert!(matches!(o.verify("a/0/7/4"), Err(OverlayError::HashMismatch { .. })));
        assert!(matches!(o.verify_all(), Err(OverlayError::HashMismatch { .. })));
        o.verify("a/0/7/5").unwrap();
    }

    #[test]
    fn missing_file_on_disk() {
        let tmp = build("");
        fs::remove_file(tmp.0.join("romfs/a/2/1/8")).unwrap();
        let o = Overlay::load(&tmp.0).unwrap();
        assert!(matches!(o.open("a/2/1/8"), Err(OverlayError::Io { .. })));
    }
}
