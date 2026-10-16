//! Tests de `fs:USER` : les requêtes passent par `kernel::testing::call`, écrites en mots IPC comme le jeu les envoie.
//! Aucun octet du jeu : le romfs est factice, la sauvegarde est un dossier temporaire.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use kernel::Kernel;
use kernel::memory::PERM_RW;
use kernel::object::ObjId;
use kernel::testing::{call, header, test_kernel, test_main_thread};
use romfs::RomfsSource;
use services::fs::*;

const AREA: u32 = 0x0800_0000;
const PATH_A: u32 = AREA;
const PATH_B: u32 = AREA + 0x400;
const BUF: u32 = AREA + 0x2000;
const TLS_RECV: u32 = 0x180;

/// Un romfs factice : 0x100 octets, deux fichiers.
struct FakeRomfs {
    data: Vec<u8>,
}

impl FakeRomfs {
    fn new() -> FakeRomfs {
        FakeRomfs { data: (0..0x100u32).map(|i| i as u8).collect() }
    }
}

impl RomfsSource for FakeRomfs {
    fn size(&self) -> u64 {
        self.data.len() as u64
    }

    fn read(&self, position: u64, size: usize) -> Vec<u8> {
        let start = (position as usize).min(self.data.len());
        let end = start.saturating_add(size).min(self.data.len());
        self.data[start..end].to_vec()
    }

    fn files(&self) -> Vec<(String, u64, u64)> {
        // volontairement dans le désordre : l'index doit trier par position
        vec![("b".to_string(), 0x80, 0x10), ("a/0/7/5".to_string(), 0x40, 0x20)]
    }
}

struct Rig {
    k: Kernel,
    t: ObjId,
    fs: ObjId,
    dir: PathBuf,
}

impl Drop for Rig {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn rig(name: &str, with_update: bool) -> Rig {
    let dir = std::env::temp_dir().join(format!("services-fs-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("exefs")).unwrap();
    let (mut k, _script) = test_kernel();
    k.bench.paths.archives = dir.join("archives");
    k.bench.paths.exefs = dir.join("exefs");
    std::fs::create_dir_all(&k.bench.paths.archives).unwrap();
    let t = test_main_thread(&mut k);
    k.memory.map(AREA, 0x10000, PERM_RW, "tampons de test", None).unwrap();
    let base: Rc<dyn RomfsSource> = Rc::new(FakeRomfs::new());
    let update = if with_update { Some(Rc::new(FakeRomfs::new()) as Rc<dyn RomfsSource>) } else { None };
    let service = FsUser::with_romfs(&mut k, Some(base), update);
    let shared: kernel::object::SharedService = Rc::new(RefCell::new(service));
    let fs = k.new_session(shared, "fs:USER");
    Rig { k, t, fs, dir }
}

fn static_desc(size: u32, index: u32) -> u32 {
    size << 14 | index << 10 | 2
}

fn put(r: &mut Rig, address: u32, bytes: &[u8]) {
    r.k.memory.write(address, bytes).unwrap();
}

fn last_lines(r: &Rig) -> String {
    r.k.journal.capture.as_ref().unwrap().join("\n")
}

fn session_from(r: &Rig, reply: &[u32]) -> ObjId {
    let handle = *reply.last().unwrap();
    r.k.lookup(handle, Some(r.t)).expect("la réponse doit porter une poignée de session")
}

/// Un chemin de genre 3 (texte latin-1) posé à `address`.
fn text_path(r: &mut Rig, address: u32, text: &str) -> u32 {
    let mut bytes = text.as_bytes().to_vec();
    bytes.push(0);
    put(r, address, &bytes);
    bytes.len() as u32
}

fn binary_path(kind: u32, name: &[u8]) -> Vec<u8> {
    let mut v = kind.to_le_bytes().to_vec();
    let mut n = name.to_vec();
    n.resize(8, 0);
    v.extend(n);
    v
}

/// OpenFileDirectly d'un fichier du programme (archive 3, chemin d'archive vide).
fn open_program_file(r: &mut Rig, path: &[u8]) -> Vec<u32> {
    put(r, PATH_A, &[0]);
    put(r, PATH_B, path);
    call(&mut r.k, r.t, r.fs, &[
        header(0x803, 8, 4), 0, 3, 1, 1, 2, path.len() as u32, 1, 0,
        static_desc(1, 0), PATH_A, static_desc(path.len() as u32, 1), PATH_B,
    ])
}

fn read_words(position: u32, size: u32, buffer: u32) -> Vec<u32> {
    vec![header(0x802, 3, 2), position, 0, size, size << 4 | 0xC, buffer]
}

#[test]
fn romfs_ouverture_lecture_taille_fermeture() {
    let mut r = rig("romfs", true);
    let reply = open_program_file(&mut r, &binary_path(0, b""));
    assert_eq!(reply[1], 0, "{reply:x?}");
    assert_eq!(reply[2], 0x10, "poignée déplacée");
    assert!(last_lines(&r).contains("la romfs") || last_lines(&r).contains("le programme (romfs, exefs) : romfs du jeu de base"));
    assert_eq!(r.k.bench.files_opened.len(), 1);
    assert_eq!(r.k.bench.files_opened[0].1, 3);
    assert_eq!(r.k.bench.files_opened[0].2, "romfs du jeu de base");
    let file = session_from(&r, &reply);

    let words = read_words(0x44, 8, BUF);
    let out = call(&mut r.k, r.t, file, &words);
    assert_eq!(&out[1..], &[0, 8, 8 << 4 | 0xC, BUF]);
    assert_eq!(r.k.memory.read(BUF, 8).unwrap(), (0x44..0x4C).collect::<Vec<u8>>());
    assert_eq!(r.k.bench.stats["fs_read_bytes"], 8);
    assert_eq!(r.k.bench.romfs_reads, 1);
    assert!(last_lines(&r).contains("« romfs du jeu de base, position 0x44, 0x8 octets lus (a/0/7/5+0x4) »"));

    // les trois sortes de position : dans les tables, entre deux fichiers, après le dernier
    for (pos, what) in [(0x10u32, "tables"), (0x70, "?"), (0xF0, "?"), (0x80, "b+0x0")] {
        call(&mut r.k, r.t, file, &read_words(pos, 4, BUF));
        assert!(last_lines(&r).contains(&format!("position {pos:#x}, 0x4 octets lus ({what})")), "{pos:#x} {what}");
    }
    // lecture au-delà de la fin : 0 octet, pas de « (…) » vide de sens mais « ? »
    let out = call(&mut r.k, r.t, file, &read_words(0x200, 4, BUF));
    assert_eq!(out[2], 0);

    let out = call(&mut r.k, r.t, file, &[header(0x804, 0, 0)]);
    assert_eq!(&out[1..], &[0, 0x100, 0]);
    assert!(last_lines(&r).contains("« romfs du jeu de base : 0x100 octets »"));

    let out = call(&mut r.k, r.t, file, &[header(0x808, 0, 0)]);
    assert_eq!(out[1], 0);
    assert!(last_lines(&r).contains("« romfs du jeu de base »"));

    // l'écriture et le changement de taille sont refusés
    put(&mut r, BUF, &[1, 2, 3, 4]);
    let out = call(&mut r.k, r.t, file, &[header(0x803, 4, 2), 0, 0, 4, 0, 4 << 4 | 0xA, BUF]);
    assert_eq!(out[1], ERR_UNSUPPORTED);
    assert!(last_lines(&r).contains("« fichier en lecture seule »"));
    let out = call(&mut r.k, r.t, file, &[header(0x805, 2, 0), 0, 0x10, 0]);
    assert_eq!(out[1], ERR_UNSUPPORTED);
}

#[test]
fn romfs_mise_a_jour_absente_et_chemins_refuses() {
    let mut r = rig("absent", false);
    let out = open_program_file(&mut r, &binary_path(5, b""));
    assert_eq!(out[1], ERR_FILE_NOT_FOUND);
    assert_eq!(&out[2..], &[0x10, 0]);
    assert!(last_lines(&r).contains("« romfs 5 absent du banc »"));
    let out = open_program_file(&mut r, &binary_path(9, b""));
    assert_eq!(out[1], ERR_INVALID_PATH);
    assert!(last_lines(&r).contains("« premier mot 9 refusé »"));
    let out = open_program_file(&mut r, &[1, 2, 3]);
    assert_eq!(out[1], ERR_INVALID_PATH);
    assert!(last_lines(&r).contains("chemin de b'\\x01\\x02\\x03' : il faut 12 octets binaires"));
    // archive inconnue
    put(&mut r, PATH_A, &[0]);
    put(&mut r, PATH_B, b"x\0");
    let out = call(&mut r.k, r.t, r.fs, &[
        header(0x803, 8, 4), 0, 0x77, 1, 1, 3, 2, 1, 0, static_desc(1, 0), PATH_A, static_desc(2, 1), PATH_B,
    ]);
    assert_eq!(out[1], ERR_ARCHIVE_NOT_FOUND);
    assert!(last_lines(&r).contains("« archive 0x77 (?) absente du banc »"));
}

#[test]
fn exefs_lu_en_memoire() {
    let mut r = rig("exefs", false);
    std::fs::write(r.dir.join("exefs").join("icon.bin"), b"ICONDATA").unwrap();
    let reply = open_program_file(&mut r, &binary_path(2, b"icon"));
    assert_eq!(reply[1], 0);
    let file = session_from(&r, &reply);
    assert_eq!(r.k.bench.files_opened[0].2, "exefs/icon");
    let out = call(&mut r.k, r.t, file, &read_words(4, 100, BUF));
    assert_eq!(out[2], 4);
    assert_eq!(r.k.memory.read(BUF, 4).unwrap(), b"DATA");
    // pas de « what » pour l'exefs ; pas de romfs_reads
    assert_eq!(r.k.bench.romfs_reads, 0);
    assert!(last_lines(&r).contains("« exefs/icon, position 0x4, 0x4 octets lus »"));
    let out = open_program_file(&mut r, &binary_path(2, b"nope"));
    assert_eq!(out[1], ERR_FILE_NOT_FOUND);
    assert!(last_lines(&r).contains("« exefs/nope absent »"));
}

#[test]
fn sous_fichier_jumeau_et_disponible() {
    let mut r = rig("sous", true);
    let reply = open_program_file(&mut r, &binary_path(0, b""));
    let file = session_from(&r, &reply);
    // OpenSubFile(0x40, 0x20)
    let out = call(&mut r.k, r.t, file, &[header(0x801, 4, 0), 0x40, 0, 0x20, 0]);
    assert_eq!(out[1], 0);
    let sub = session_from(&r, &out);
    let out = call(&mut r.k, r.t, sub, &read_words(0x1C, 0x10, BUF));
    assert_eq!(out[2], 4, "coupé à la fenêtre");
    assert_eq!(r.k.memory.read(BUF, 4).unwrap(), vec![0x5C, 0x5D, 0x5E, 0x5F]);
    let out = call(&mut r.k, r.t, sub, &[header(0x804, 0, 0)]);
    assert_eq!(&out[1..], &[0, 0x20, 0]);
    // un sous-fichier n'a ni sous-fichier ni changement de taille
    assert_eq!(call(&mut r.k, r.t, sub, &[header(0x801, 4, 0), 0, 0, 1, 0])[1], ERR_UNSUPPORTED);
    assert_eq!(call(&mut r.k, r.t, sub, &[header(0x805, 2, 0), 0, 0, 0])[1], ERR_UNSUPPORTED);
    // hors du fichier
    assert_eq!(call(&mut r.k, r.t, file, &[header(0x801, 4, 0), 0xF0, 0, 0x20, 0])[1], ERR_OUT_OF_FILE);
    // GetAvailable
    let out = call(&mut r.k, r.t, file, &[header(0xC01, 4, 0), 0xF0, 0, 0x40, 0]);
    assert_eq!(&out[1..], &[0, 0x10, 0]);
    // priorité
    call(&mut r.k, r.t, file, &[header(0x80A, 1, 0), 7]);
    assert_eq!(call(&mut r.k, r.t, file, &[header(0x80B, 0, 0)])[2], 7);
    // fichier jumeau : mêmes données, la priorité est recopiée
    let out = call(&mut r.k, r.t, file, &[header(0x80C, 0, 0)]);
    let twin = session_from(&r, &out);
    assert_ne!(twin, file);
    assert_eq!(call(&mut r.k, r.t, twin, &[header(0x80B, 0, 0)])[2], 7);
    assert_eq!(call(&mut r.k, r.t, twin, &[header(0x804, 0, 0)])[2], 0x100);
    // commande inconnue
    assert_eq!(call(&mut r.k, r.t, file, &[header(0x8FF, 0, 0)])[1], kernel::ipc::ERR_UNKNOWN_COMMAND);
}

fn open_archive(r: &mut Rig, id: u32) -> (u32, u32) {
    put(r, PATH_A, &[0]);
    let out = call(&mut r.k, r.t, r.fs, &[header(0x80C, 3, 2), id, 1, 1, static_desc(1, 0), PATH_A]);
    assert_eq!(out[1], 0, "{out:x?}");
    (out[2], out[3])
}

#[test]
fn sauvegarde_creer_ecrire_lire_supprimer() {
    let mut r = rig("sauve", false);
    let (hl, hh) = open_archive(&mut r, 4);
    assert_eq!((hl, hh), (1, 1), "premier identifiant d'archive : 0x100000001");
    assert!(last_lines(&r).contains("« sauvegarde »"));

    // CreateFile dossier/a.bin, 0x10 octets
    let n = text_path(&mut r, PATH_B, "/dossier/a.bin");
    let out = call(&mut r.k, r.t, r.fs, &[
        header(0x808, 8, 2), 0, hl, hh, 3, n, 0, 0x10, 0, static_desc(n, 0), PATH_B,
    ]);
    assert_eq!(out[1], 0, "{out:x?}");
    let sep = std::path::MAIN_SEPARATOR;
    assert!(last_lines(&r).contains(&format!("« dossier{sep}a.bin, 0x10 octets »")));
    let host = r.dir.join("archives").join("sauvegarde").join("dossier").join("a.bin");
    assert_eq!(std::fs::metadata(&host).unwrap().len(), 0x10);
    // deuxième création : existe déjà
    let out = call(&mut r.k, r.t, r.fs, &[
        header(0x808, 8, 2), 0, hl, hh, 3, n, 0, 0x10, 0, static_desc(n, 0), PATH_B,
    ]);
    assert_eq!(out[1], ERR_ALREADY_EXISTS);
    assert!(last_lines(&r).contains("existe déjà (code des émulateurs)"));

    // OpenFile mode 3, écriture de 4 octets à 2
    let out = call(&mut r.k, r.t, r.fs, &[
        header(0x802, 7, 2), 0, hl, hh, 3, n, 3, 0, static_desc(n, 0), PATH_B,
    ]);
    assert_eq!(out[1], 0, "{out:x?}");
    assert!(last_lines(&r).contains("« sauvegarde:/dossier/a.bin, mode 3 »"));
    let file = session_from(&r, &out);
    put(&mut r, BUF, &[9, 8, 7, 6]);
    let out = call(&mut r.k, r.t, file, &[header(0x803, 4, 2), 2, 0, 4, 0, 4 << 4 | 0xA, BUF]);
    assert_eq!(&out[1..], &[0, 4, 4 << 4 | 0xA, BUF]);
    assert!(last_lines(&r).contains("« sauvegarde:/dossier/a.bin, position 0x2, 0x4 octets écrits »"));
    // lecture de ce qui vient d'être écrit
    let out = call(&mut r.k, r.t, file, &read_words(0, 8, BUF + 0x100));
    assert_eq!(out[2], 8);
    assert_eq!(r.k.memory.read(BUF + 0x100, 8).unwrap(), vec![0, 0, 9, 8, 7, 6, 0, 0]);
    // agrandissement puis taille
    assert_eq!(call(&mut r.k, r.t, file, &[header(0x805, 2, 0), 0x40, 0])[1], 0);
    assert_eq!(&call(&mut r.k, r.t, file, &[header(0x804, 0, 0)])[1..], &[0, 0x40, 0]);
    assert_eq!(std::fs::metadata(&host).unwrap().len(), 0x40);
    assert_eq!(call(&mut r.k, r.t, file, &[header(0x808, 0, 0)])[1], 0);

    // renommer a.bin -> b.bin
    let n2 = text_path(&mut r, PATH_A, "/dossier/b.bin");
    let out = call(&mut r.k, r.t, r.fs, &[
        header(0x805, 9, 4), 0, hl, hh, 3, n, hl, hh, 3, n2,
        static_desc(n, 0), PATH_B, static_desc(n2, 1), PATH_A,
    ]);
    assert_eq!(out[1], 0, "{out:x?}");
    assert!(!host.exists());
    // supprimer b.bin, puis le supprimer encore
    let delete = |r: &mut Rig, address: u32, n: u32| {
        call(&mut r.k, r.t, r.fs, &[header(0x804, 5, 2), 0, hl, hh, 3, n, static_desc(n, 0), address])
    };
    let out = delete(&mut r, PATH_A, n2);
    assert_eq!(out[1], 0);
    assert!(last_lines(&r).contains(&format!("« dossier{sep}b.bin »")));
    assert_eq!(delete(&mut r, PATH_A, n2)[1], ERR_FILE_NOT_FOUND);
    assert!(last_lines(&r).contains("b.bin absent"));

    // DeleteDirectory (vide) puis introuvable
    let n3 = text_path(&mut r, PATH_A, "/dossier");
    let rmdir = |r: &mut Rig, command: u32, n: u32| {
        call(&mut r.k, r.t, r.fs, &[header(command, 5, 2), 0, hl, hh, 3, n, static_desc(n, 0), PATH_A])
    };
    assert_eq!(rmdir(&mut r, 0x806, n3)[1], 0);
    assert_eq!(rmdir(&mut r, 0x806, n3)[1], ERR_PATH_NOT_FOUND);
    assert_eq!(rmdir(&mut r, 0x807, n3)[1], ERR_PATH_NOT_FOUND);

    // « .. » refusé
    let n4 = text_path(&mut r, PATH_A, "/../x");
    let out = rmdir(&mut r, 0x804, n4);
    assert_eq!(out[1], ERR_INVALID_PATH);
    assert!(last_lines(&r).contains("« chemin '/../x' »"));

    // poignée d'archive inconnue
    let out = call(&mut r.k, r.t, r.fs, &[header(0x804, 5, 2), 0, 99, 0, 3, n4, static_desc(n4, 0), PATH_A]);
    assert_eq!(out[1], ERR_INVALID_HANDLE);

    // fermeture de l'archive, puis de nouveau
    assert_eq!(call(&mut r.k, r.t, r.fs, &[header(0x80E, 2, 0), hl, hh])[1], 0);
    assert_eq!(call(&mut r.k, r.t, r.fs, &[header(0x80E, 2, 0), hl, hh])[1], ERR_INVALID_HANDLE);
}

#[test]
fn open_file_directly_sur_la_sauvegarde_et_creation() {
    let mut r = rig("direct", false);
    let n = text_path(&mut r, PATH_B, "/slot.dat");
    put(&mut r, PATH_A, &[0]);
    let words = |mode: u32| {
        vec![header(0x803, 8, 4), 0, 4, 1, 1, 3, n, mode, 0, static_desc(1, 0), PATH_A, static_desc(n, 1), PATH_B]
    };
    let out = call(&mut r.k, r.t, r.fs, &words(1));
    assert_eq!(out[1], ERR_FILE_NOT_FOUND);
    assert_eq!(&out[2..], &[0x10, 0]);
    assert!(last_lines(&r).contains("« sauvegarde/slot.dat introuvable (code des émulateurs) »"));
    let out = call(&mut r.k, r.t, r.fs, &words(7));
    assert_eq!(out[1], 0);
    assert!(last_lines(&r).contains("« la sauvegarde : sauvegarde:/slot.dat »"));
    assert!(r.dir.join("archives/sauvegarde/slot.dat").is_file());
    assert_eq!(r.k.bench.files_opened[0].1, 4);
}

#[test]
fn dossier_lecture_des_entrees() {
    let mut r = rig("dossier", false);
    let save = r.dir.join("archives").join("sauvegarde");
    std::fs::create_dir_all(save.join("sous").join("adir")).unwrap();
    std::fs::write(save.join("sous").join("b.txt"), b"12345").unwrap();
    std::fs::write(save.join("sous").join("Éclair.dat"), b"x").unwrap();
    let (hl, hh) = open_archive(&mut r, 4);
    let n = text_path(&mut r, PATH_B, "/sous");
    let out = call(&mut r.k, r.t, r.fs, &[header(0x80B, 4, 2), hl, hh, 3, n, static_desc(n, 0), PATH_B]);
    assert_eq!(out[1], 0, "{out:x?}");
    assert!(last_lines(&r).contains("« sauvegarde:/sous »"));
    let dir = session_from(&r, &out);
    let size = 3 * 0x228u32 + 5;
    let out = call(&mut r.k, r.t, dir, &[header(0x801, 1, 2), 5, size << 4 | 0xC, BUF]);
    assert_eq!(&out[1..], &[0, 3, size << 4 | 0xC, BUF]);
    assert!(last_lines(&r).contains("« sauvegarde:/sous : 3 entrées »"));
    let all = r.k.memory.read(BUF, 3 * 0x228).unwrap();
    let utf16 = |s: &str| s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect::<Vec<u8>>();
    // ordre des points de code : « adir », « b.txt », « Éclair.dat » (É = U+00C9)
    let e0 = &all[..0x228];
    assert_eq!(&e0[..8], &utf16("adir")[..]);
    assert_eq!(&e0[0x20C..0x210], b"ADIR");
    assert_eq!((e0[0x21A], e0[0x21C], e0[0x21E]), (1, 1, 0));
    let e1 = &all[0x228..0x450];
    assert_eq!(&e1[..10], &utf16("b.txt")[..]);
    assert_eq!(&e1[0x20C..0x20D], b"B");
    assert_eq!(&e1[0x216..0x219], b"TXT");
    assert_eq!((e1[0x21C], e1[0x21E]), (0, 1));
    assert_eq!(u64::from_le_bytes(e1[0x220..0x228].try_into().unwrap()), 5);
    let e2 = &all[0x450..];
    assert_eq!(&e2[..12], &utf16("Éclair")[..12]);
    assert_eq!(e2[0x20C], 0xC9);
    assert_eq!(&e2[0x20D..0x212], b"CLAIR");
    assert_eq!(&e2[0x216..0x219], b"DAT");
    // plus rien ensuite
    let out = call(&mut r.k, r.t, dir, &[header(0x801, 1, 2), 5, size << 4 | 0xC, BUF]);
    assert_eq!(out[2], 0);
    assert_eq!(call(&mut r.k, r.t, dir, &[header(0x802, 0, 0)])[1], 0);
    // dossier introuvable
    let n = text_path(&mut r, PATH_B, "/rien");
    let out = call(&mut r.k, r.t, r.fs, &[header(0x80B, 4, 2), hl, hh, 3, n, static_desc(n, 0), PATH_B]);
    assert_eq!(out[1], ERR_PATH_NOT_FOUND);
    assert_eq!(&out[2..], &[0x10, 0]);
    assert!(last_lines(&r).contains("« dossier '/rien' introuvable »"));
}

#[test]
fn format_et_secure_value_et_divers() {
    let mut r = rig("divers", false);
    // sans fichier de format : valeurs par défaut
    let out = call(&mut r.k, r.t, r.fs, &[header(0x845, 1, 0), 4]);
    assert_eq!(&out[1..], &[0, 0x80000, 1, 1, 1]);
    assert!(last_lines(&r).contains("« sauvegarde : {'size': 524288, 'dirs': 1, 'files': 1, 'duplicate': 1} »"));
    // FormatSaveData : vide la copie et écrit le format
    std::fs::create_dir_all(r.dir.join("archives/sauvegarde")).unwrap();
    std::fs::write(r.dir.join("archives/sauvegarde/old"), b"x").unwrap();
    let mut w = vec![0u32; 12];
    w[0] = header(0x84C, 11, 0);
    w[5] = 8;
    w[6] = 5;
    w[9] = 0x1FF;
    let out = call(&mut r.k, r.t, r.fs, &w);
    assert_eq!(out[1], 0);
    assert!(!r.dir.join("archives/sauvegarde/old").exists());
    assert!(last_lines(&r).contains("le jeu a formaté sa sauvegarde (FormatSaveData)"));
    assert!(last_lines(&r).contains("« 8 dossiers, 5 fichiers »"));
    let out = call(&mut r.k, r.t, r.fs, &[header(0x845, 1, 0), 4]);
    assert_eq!(&out[1..], &[0, 0x80000, 8, 5, 0xFF]);
    // archive de format inconnue
    let out = call(&mut r.k, r.t, r.fs, &[header(0x845, 1, 0), 9]);
    assert_eq!(&out[1..], &[ERR_ARCHIVE_NOT_FOUND, 0, 0, 0, 0]);

    // valeur sécurisée
    let out = call(&mut r.k, r.t, r.fs, &[header(0x86F, 1, 0), 5]);
    assert_eq!(&out[1..], &[0, 0, 0, 0, 0]);
    call(&mut r.k, r.t, r.fs, &[header(0x86E, 3, 0), 5, 0x1111_2222, 0x3]);
    let out = call(&mut r.k, r.t, r.fs, &[header(0x86F, 1, 0), 5]);
    assert_eq!(&out[1..], &[0, 1, 0, 0x1111_2222, 3]);

    // initialisation, priorité, constantes
    let out = call(&mut r.k, r.t, r.fs, &[header(0x861, 1, 2), 0x4000]);
    assert_eq!(out[1], 0);
    assert!(last_lines(&r).contains("« version 0x4000 »"));
    call(&mut r.k, r.t, r.fs, &[header(0x862, 1, 0), 3]);
    assert_eq!(call(&mut r.k, r.t, r.fs, &[header(0x863, 0, 0)])[2], 3);
    assert_eq!(&call(&mut r.k, r.t, r.fs, &[header(0x812, 2, 0), 0, 0])[1..], &[0, 0x1000_0000, 0]);
    assert_eq!(&call(&mut r.k, r.t, r.fs, &[header(0x817, 0, 0)])[1..], &[0, 1]);
    assert_eq!(&call(&mut r.k, r.t, r.fs, &[header(0x818, 0, 0)])[1..], &[0, 1]);
    assert_eq!(&call(&mut r.k, r.t, r.fs, &[header(0x854, 0, 0)])[1..], &[0, 0x4000, 0, 0x2000, 0, 0x1000]);
    let mut w = vec![0u32; 11];
    w[0] = header(0x80D, 10, 0);
    (w[3], w[6], w[7], w[8], w[9]) = (2, 10, 11, 12, 13);
    assert_eq!(&call(&mut r.k, r.t, r.fs, &w)[1..], &[0, 10, 11, 12, 13]);
    assert!(last_lines(&r).contains("« action 2 »"));
    let out = call(&mut r.k, r.t, r.fs, &[header(0x849, 1, 0), 2]);
    assert_eq!(&out[1..], &[0, 0x200, 0x8000, 0x80000, 0x40000]);
    assert!(last_lines(&r).contains("« support 2 : 16 Go, 8 Go libres »"));

    // priorité d'archive
    let (hl, hh) = open_archive(&mut r, 4);
    assert_eq!(call(&mut r.k, r.t, r.fs, &[header(0x85A, 3, 0), hl, hh, 9])[1], 0);
    assert_eq!(&call(&mut r.k, r.t, r.fs, &[header(0x85B, 2, 0), hl, hh])[1..], &[0, 9]);
    assert_eq!(&call(&mut r.k, r.t, r.fs, &[header(0x85B, 2, 0), 77, 0])[1..], &[ERR_INVALID_HANDLE, 0]);
}

#[test]
fn donnees_supplementaires_et_carte_sd() {
    let mut r = rig("ext", false);
    // les données supplémentaires n'existent pas tant qu'on ne les a pas créées
    let info = [0x11u32, 0x22, 0x33];
    put(&mut r, PATH_A, &info.iter().flat_map(|w| w.to_le_bytes()).collect::<Vec<u8>>());
    let out = call(&mut r.k, r.t, r.fs, &[header(0x80C, 3, 2), 6, 2, 12, static_desc(12, 0), PATH_A]);
    assert_eq!(out[1], ERR_ARCHIVE_NOT_FOUND);
    assert_eq!(&out[2..], &[0, 0]);
    // CreateExtSaveData : le chemin est dans les mots 1 à 3 de la requête
    let mut w = vec![0u32; 12];
    w[0] = header(0x851, 11, 0);
    (w[1], w[2], w[3], w[5], w[6], w[10], w[11]) = (0x11, 0x22, 0x33, 4, 2, 0xAA, 0xBB);
    let out = call(&mut r.k, r.t, r.fs, &w);
    assert_eq!(&out[1..], &[0, 0xAA, 0xBB]);
    assert!(last_lines(&r).contains("« dossier extdata-6-110000002200000033000000 »"));
    // la même chose, vue par OpenArchive puis GetFormatInfo
    let out = call(&mut r.k, r.t, r.fs, &[header(0x80C, 3, 2), 6, 2, 12, static_desc(12, 0), PATH_A]);
    assert_eq!(out[1], 0, "{out:x?}");
    assert!(last_lines(&r).contains("« données supplémentaires 110000002200000033000000 »"));
    let out = call(&mut r.k, r.t, r.fs, &[header(0x845, 3, 2), 6, 2, 12, static_desc(12, 0), PATH_A]);
    assert_eq!(&out[1..], &[0, 0, 4, 2, 0], "{out:x?}");
    assert!(last_lines(&r).contains("« données supplémentaires : {'size': 0, 'dirs': 4, 'files': 2, 'duplicate': 0} »"));
    // suppression
    let mut w = vec![0u32; 12];
    w[0] = header(0x852, 11, 0);
    (w[1], w[2], w[3]) = (0x11, 0x22, 0x33);
    assert_eq!(call(&mut r.k, r.t, r.fs, &w)[1], 0);
    let out = call(&mut r.k, r.t, r.fs, &[header(0x80C, 3, 2), 6, 2, 12, static_desc(12, 0), PATH_A]);
    assert_eq!(out[1], ERR_ARCHIVE_NOT_FOUND);

    // carte SD : le dossier est créé à l'ouverture
    let _ = open_archive(&mut r, 9);
    assert!(r.dir.join("archives/sdmc").is_dir());
    assert!(last_lines(&r).contains("« carte SD »"));

    // contenu d'un autre titre : titre et chemin de fichier dans la note
    put(&mut r, PATH_A, &[0x78, 0x56, 0x34, 0x12, 0xEF, 0xCD, 0xAB, 0x89, 0, 0, 0, 0]);
    put(&mut r, PATH_B, &[1, 2, 3, 4]);
    let out = call(&mut r.k, r.t, r.fs, &[
        header(0x803, 8, 4), 0, 0x2345_678A, 2, 12, 2, 4, 1, 0, static_desc(12, 0), PATH_A, static_desc(4, 1), PATH_B,
    ]);
    assert_eq!(out[1], ERR_ARCHIVE_NOT_FOUND);
    assert!(last_lines(&r).contains(
        "« archive 0x2345678a (contenu d'un autre titre) absente du banc : titre 89abcdef12345678, chemin de fichier 01020304 »"
    ));
}

#[test]
fn prepare_archives_copie_et_vide() {
    let dir = std::env::temp_dir().join(format!("services-fs-test-prepare-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let source = dir.join("source");
    std::fs::create_dir_all(source.join("a/b")).unwrap();
    std::fs::write(source.join("a/b/c.bin"), b"abc").unwrap();
    let paths = kernel::bench::Paths { archives: dir.join("archives"), ..Default::default() };
    std::fs::create_dir_all(&paths.archives).unwrap();
    std::fs::write(paths.archives.join("vieux"), b"x").unwrap();
    let msg = prepare_archives(&paths, Some(&source), None);
    assert_eq!(msg, format!("sauvegarde copiée de {}", source.display()));
    assert_eq!(std::fs::read(paths.archives.join("sauvegarde/a/b/c.bin")).unwrap(), b"abc");
    assert!(!paths.archives.join("vieux").exists());
    let msg = prepare_archives(&paths, None, None);
    assert_eq!(msg, "pas de sauvegarde : dossier vide");
    assert!(paths.archives.join("sauvegarde").is_dir());
    assert!(!paths.archives.join("sauvegarde/a").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn decode_path_et_repr() {
    assert_eq!(decode_path(1, b"zz"), PathValue::Empty);
    assert_eq!(decode_path(3, b"ab\0cd"), PathValue::Text("ab".into()));
    assert_eq!(decode_path(3, &[0xE9, 0]), PathValue::Text("é".into()));
    let utf16: Vec<u8> = "a\u{e9}\0z".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    assert_eq!(decode_path(4, &utf16), PathValue::Text("a\u{e9}".into()));
    assert_eq!(decode_path(9, b"q"), PathValue::Binary(b"q".to_vec()));
    assert_eq!(decode_path(2, &[1, 0x41, 0x27]).repr(), "b\"\\x01A'\"");
    assert_eq!(PathValue::Text("it's".into()).repr(), "\"it's\"");
    assert_eq!(PathValue::Text("a\\b".into()).repr(), "'a\\\\b'");
    assert_eq!(PathValue::Empty.repr(), "''");
}

/// Si le dump du jeu est là : le vrai romfs (jamais chargé en mémoire) se lit par `load_romfs` et le niveau 3 débute
/// par le mot 0x28. Sinon le test est sauté.
#[test]
fn vrai_romfs_si_present() {
    let cxi: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../local/dump/pokemon-x.cxi");
    if !cxi.is_file() {
        eprintln!("local/dump/pokemon-x.cxi absent : test sauté");
        return;
    }
    let mut r = rig("vrai", false);
    let paths = kernel::bench::Paths { romfs_base: cxi, ..Default::default() };
    let mut events = Vec::new();
    let (base, update) = load_romfs(&paths, &mut events);
    assert!(events.is_empty(), "{events:?}");
    assert!(update.is_none());
    let service = FsUser::with_romfs(&mut r.k, base, None);
    let shared: kernel::object::SharedService = Rc::new(RefCell::new(service));
    r.fs = r.k.new_session(shared, "fs:USER");
    let reply = open_program_file(&mut r, &binary_path(0, b""));
    assert_eq!(reply[1], 0);
    let file = session_from(&r, &reply);
    let out = call(&mut r.k, r.t, file, &read_words(0, 4, BUF));
    assert_eq!(out[2], 4);
    assert_eq!(r.k.memory.u32(BUF).unwrap(), 0x28);
    assert!(last_lines(&r).contains("(tables)"));
    let _ = TLS_RECV;
}
