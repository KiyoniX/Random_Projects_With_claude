//! Tests sur des fichiers fabriqués (aucun octet du jeu) : un static.crs et trois modules qui s'importent les uns
//! des autres. Le premier test est autonome (les valeurs attendues sont calculées ici, avec des encodeurs ARM
//! écrits à part) ; le second compare le rapport complet à celui de `cro_loader.py` s'il y a un Python.

mod common;

use std::path::PathBuf;

use common::*;
use cro::*;

fn fixture_dir() -> PathBuf {
    let dir = repo_root().join("local").join("portage").join("cro-fixture");
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}

fn arm_bl_encode(target: i64, place: i64) -> u32 {
    // BL (cible ARM) : imm24 = (cible - place) / 4.
    0xEB00_0000 | ((((target - place) >> 2) & 0xFF_FFFF) as u32)
}

fn arm_blx_encode(target: i64, place: i64) -> u32 {
    // BLX imm (cible Thumb, bit 0 déjà retiré) : H = bit 1 de la distance.
    let delta = target - place;
    0xFA00_0000 | ((((delta >> 1) & 1) as u32) << 24) | (((delta >> 2) & 0xFF_FFFF) as u32)
}

fn thumb_bl_encode(target: i64, place: i64) -> (u16, u16) {
    let delta = target - place;
    (0xF000 | ((delta >> 12) & 0x7FF) as u16, 0xF800 | ((delta >> 1) & 0x7FF) as u16)
}

fn thumb_blx_encode(target: i64, place: i64) -> (u16, u16) {
    // La cible ARM est alignée sur 4 : le décalage bas est arrondi comme le fait ro (adresse + 2 si le bit 1 est posé).
    let mut delta = target - place;
    if delta & 2 != 0 {
        delta += 2;
    }
    (0xF000 | ((delta >> 12) & 0x7FF) as u16, 0xE800 | ((delta >> 1) & 0x7FF) as u16)
}

#[test]
fn autonomous_link_and_unlink() {
    let (crs_bytes, code, files) = fixture_files();
    let crs = Cro::new(&crs_bytes, "static.crs").unwrap();
    assert!(crs.is_static);
    assert_eq!(crs.name, STATIC_NAME);
    assert_eq!(crs.named_exports.len(), 3);
    // l'arbre retrouve chaque export par son nom, et rien d'autre
    for (name, tag) in &crs.named_exports {
        assert_eq!(crs.find_named_export(name), Some(*tag), "{name}");
    }
    assert_eq!(crs.find_named_export("static_fun"), None);
    assert_eq!(crs.find_named_export("zzz"), None);
    for (name, bytes) in &files {
        let c = Cro::new(bytes, name).unwrap();
        for (n, tag) in &c.named_exports {
            assert_eq!(c.find_named_export(n), Some(*tag), "{name}/{n}");
        }
        // les empreintes de l'en-tête sont bonnes
        for (what, written, computed) in c.hashes() {
            assert_eq!(written, computed.to_vec(), "{name} : empreinte {what}");
        }
    }
    let mod_a = Cro::new(&files[0].1, "ModA").unwrap();
    assert!(mod_a.ro_header_problems().is_empty(), "{:?}", mod_a.ro_header_problems());
    assert_eq!(Cro::new(&files[2].1, "ModC").unwrap().ro_header_problems(), vec!["0x98 (taille après finition) non nul"]);
    assert_eq!(mod_a.batch(mod_a.table("external_patches").0).unwrap().len(), 2);
    assert!(mod_a.batch(mod_a.table("external_patches").0 + 1).is_err());

    let crr = build_crr(&[mod_a.crr_hash(), Cro::new(&files[1].1, "ModB").unwrap().crr_hash()]);
    let mut state = LoaderState::new();
    let journal = state.initialize(&crs_bytes, Some(&code), 0x0810_0000).unwrap();
    assert_eq!(journal, "static.crs donné à ro : 3 exports par nom, 3 modules importés, miroir 0x8100000");
    assert_eq!(state.load_crr(&crr).unwrap(), 2);
    // Initialize : les mots du code principal valent OnUnresolved de static.crs + l'ajout
    {
        let main = state.linker().unwrap().main_code_bytes().unwrap();
        assert_eq!(word(main, 0x10), 0x1000F0 + 4);
        assert_eq!(word(main, 0x14), 0x1000F0 - 0x100014);
        assert_eq!(word(main, 0x1C), arm_bl_encode(0x1000F0, 0x10001C));
        assert_eq!(word(main, 0x24), 0x1000F0 + 8);
    }
    // places des modules
    let cros: Vec<Cro> = files.iter().map(|(n, b)| Cro::new(b, n).unwrap()).collect();
    let places = layout(&cros, MODULES_BASE);
    assert_eq!(places[0], ("ModA".to_string(), (0x665000, 0x666000, 0x666040)));
    assert_eq!(places[1].1.0, 0x667000);

    // --- ModA : seul chargé ---
    let (a_file, a_data, a_bss) = places[0].1;
    let a = state.load_exe_cro(&files[0].1, 0x0800_0000, a_file as u32, a_data as u32, a_bss as u32).unwrap();
    assert!(a.allowed && a.warning.is_none());
    assert_eq!(a.name, "ModA");
    assert_eq!(&a.image[0x80..0x84], FIXED_MAGIC);
    let text = a_file + 0x138; // le code commence à 0x138 dans le fichier
    let rodata = text + 0x80;
    let img = |at: u64| word(&a.image, (at - a_file) as usize);
    let ext = |writes: &[WordWrite], address: u32| writes.iter().rev().find(|w| w.address == address).map(|w| w.value);
    // import par numéro de static.crs, rempli dans le code principal (indexed_exports[0] de ModA, + 4)
    assert_eq!(ext(&a.external_writes, 0x100010), Some((text + 0x40 + 4) as u32));
    // anonyme (REL32 vers t(0,0x20) de ModA) et par nom (ABS32 + BL vers mod_a_named)
    assert_eq!(ext(&a.external_writes, 0x100014), Some((text + 0x20 - 0x100014) as u32));
    assert_eq!(ext(&a.external_writes, 0x100018), Some((text + 0x20) as u32));
    assert_eq!(ext(&a.external_writes, 0x10001C), Some(arm_bl_encode((text + 0x20) as i64, 0x10001C)));
    // imports de ModA vers static.crs
    assert_eq!(img(text), 0x100041); // static_func, ABS32
    assert_eq!(img(text + 4), arm_blx_encode(0x100040, (text + 4) as i64)); // symbole Thumb : BLX
    assert_eq!(img(text + 0x14), 0x100080); // __aeabi_atexit -> nnroAeabiAtexit_
    assert_eq!(img(text + 0x10), (text + 0x70 + 5) as u32); // ghost_symbol : OnUnresolved du module + 5
    assert_eq!(img(text + 0x18), 0x100310); // anonyme vers static_data
    assert_eq!(img(rodata), (0x100320i64 - rodata as i64) as u32); // indexed_exports[1] de static, REL32
    // le Thumb vers static est trop loin : un problème, pas un plantage
    let joined = a.problems.join("\n");
    assert!(joined.contains("correction d'import 2 : branchement Thumb trop loin"), "{joined}");
    // corrections internes : ABS32 dans .data, REL32 dans .data, ABS32 dans rodata, PREL31, TARGET1
    let data = state.linker().unwrap().data(state.linker().unwrap().module("ModA").unwrap()).to_vec();
    assert_eq!(word(&data, 0), (text + 0x10) as u32);
    assert_eq!(word(&data, 0x30), 0x100321);
    assert_eq!(word(&data, 4), (rodata as i64 - (a_data + 4) as i64) as u32);
    assert_eq!(img(rodata + 8), (a_data + 0x20) as u32);
    assert_eq!(img(text + 0x7C), (text as i64 - 4) as u32);
    assert_eq!(img(text + 0x78), (text as i64 - (text + 0x78) as i64) as u32);
    assert!(joined.contains("correction interne 3 : mot 0x666040 hors mémoire"), "{joined}");
    assert!(joined.contains("correction interne 8 : type de correction 99 inconnu de ro"), "{joined}");
    assert!(joined.contains("correction interne 6 hors de son segment (cible 0x3c2, segment du symbole 5)"), "{joined}");
    // .data corrigé en place dans l'image finale, à son décalage de fichier
    let data_offset = Cro::new(&files[0].1, "ModA").unwrap().header.data_offset as usize;
    assert_eq!(word(&a.image, data_offset), (text + 0x10) as u32);
    // exports anonymes statiques : mots du code principal vers ModA
    assert_eq!(ext(&a.external_writes, 0x100030), Some((text + 0x50) as u32));
    assert_eq!(ext(&a.external_writes, 0x100034), Some(arm_bl_encode((text + 0x58) as i64, 0x100034)));
    // en-tête converti : le code est une adresse, le module « FIXD »
    assert_eq!(word(&a.image, 0xB0), (a_file + 0x138) as u32);
    // ModB (par numéro 0 et anonyme) et static (ModB par numéro 1, ModC) en attente
    assert_eq!(a.pending_imports, 3); // ghost_symbol, ModB par numéro, ModB anonyme
    assert_eq!(a.journal.split(" ; ").count(), 4);
    assert!(a.journal.contains("empreinte autorisée"));

    // --- ModB : résout dans les deux sens ---
    let (b_file, b_data, b_bss) = places[1].1;
    let b = state.load_exe_cro(&files[1].1, 0x0801_0000, b_file as u32, b_data as u32, b_bss as u32).unwrap();
    let b_text = b_file + 0x138;
    let b_img = |at: u64| word(&b.image, (at - b_file) as usize);
    // static.crs -> ModB par numéro 1
    assert_eq!(ext(&b.external_writes, 0x100020), Some((b_text + 0x44) as u32));
    // ModA -> ModB : par numéro 0 (ABS32 + PREL31) et anonyme (JUMP24, conserve l'octet de condition)
    assert_eq!(ext(&b.external_writes, (text + 0x1C) as u32), Some((b_text + 0x08) as u32));
    assert_eq!(ext(&b.external_writes, (text + 0x2C) as u32), Some((b_text as i64 + 8 - (text + 0x2C) as i64) as u32));
    let old = word(&a.image, (0x24 + 0x138) as usize);
    let jump = ext(&b.external_writes, (text + 0x24) as u32).unwrap();
    assert_eq!(jump >> 24, old >> 24);
    assert_eq!(jump & 0xFF_FFFF, (((b_text + 0x10) as i64 - (text + 0x24) as i64) >> 2) as u32 & 0xFF_FFFF);
    // ModB -> ModA : Thumb BL, BLX, ARM BL, BLX ARM->Thumb, Thumb BLX
    let mod_a_thumb = (text + 0x31) as i64;
    let mod_a_named = (text + 0x20) as i64;
    let (hi, lo) = thumb_bl_encode(mod_a_thumb & !1, b_text as i64);
    assert_eq!(b_img(b_text), (hi as u32) | ((lo as u32) << 16));
    assert_eq!(b_img(b_text + 8), arm_blx_encode(mod_a_thumb & !1, (b_text + 8) as i64));
    assert_eq!(b_img(b_text + 4), arm_bl_encode(mod_a_named, (b_text + 4) as i64));
    let (hi, lo) = thumb_blx_encode(mod_a_named, (b_text + 0xC) as i64);
    assert_eq!(b_img(b_text + 0xC), (hi as u32) | ((lo as u32) << 16));
    // __aeabi_atexit, numéro, numéro absent, anonyme, anonyme hors segment
    assert_eq!(b_img(b_text + 0x14), 0x100080);
    assert_eq!(b_img(b_text + 0x18), (text + 0x44) as u32);
    assert_eq!(b_img(b_text + 0x20), (mod_a_named - (b_text + 0x20) as i64) as u32);
    let joined = b.problems.join("\n");
    assert!(joined.contains("import par numéro 5 absent de ModA"), "{joined}");
    assert!(joined.contains("import anonyme 0xfff00 de ModA : symbole à 0 dans ModA"), "{joined}");
    assert_eq!(b.warning, None);

    // --- ModC : pas dans static.crr ---
    let (c_file, c_data, c_bss) = places[2].1;
    let c = state.load_exe_cro(&files[2].1, 0x0802_0000, c_file as u32, c_data as u32, c_bss as u32).unwrap();
    assert!(!c.allowed);
    assert_eq!(c.warning.as_deref(), Some("module ModC : son empreinte n'est pas dans static.crr"));
    assert!(c.journal.ends_with("EMPREINTE ABSENTE de static.crr"));
    assert!(c.problems.iter().any(|p| p.starts_with("en-tête refusé par ro : 0x98")));
    let c_text = c_file + 0x138;
    assert_eq!(ext(&c.external_writes, 0x100028), Some((c_text + 0x10) as u32));
    assert_eq!(state.linker().unwrap().unresolved().iter().filter(|u| u.importer == STATIC_NAME).count(), 1);

    // --- erreurs ---
    let again = state.load_exe_cro(&files[0].1, 0x0800_0000, a_file as u32, a_data as u32, a_bss as u32);
    assert_eq!(again.unwrap_err().to_string(), "ModA est déjà chargé");
    assert_eq!(state.unload_cro(0x123).unwrap_err(), CroError::NothingLoadedAt(0x123));
    assert_eq!(LoaderState::new().load_exe_cro(&files[0].1, 0, 0, 0, 0).unwrap_err(), CroError::NotInitialized);

    // --- ModB déchargé : tout ce qui le visait revient à « non résolu » ---
    let un = state.unload_cro(b_file as u32).unwrap();
    assert_eq!(un.name, "ModB");
    assert_eq!(un.original, files[1].1);
    assert_eq!(ext(&un.external_writes, 0x100020), Some(0x1000F0));
    assert_eq!(ext(&un.external_writes, (text + 0x1C) as u32), Some((text + 0x70) as u32));
    assert_eq!(un.journal, format!("ModB déchargé ({} mots remis à « non résolu »)", un.written));
    assert!(state.linker().unwrap().module("ModB").is_none());
    assert_eq!(state.linker().unwrap().unresolved().iter().filter(|u| u.importer == "ModA").count(), 3);
    // ... et se recharge sans erreur ailleurs
    let b2 = state.load_exe_cro(&files[1].1, 0x0801_0000, 0x0900_0000, 0x0901_0000, 0x0902_0000).unwrap();
    assert!(b2.allowed);
}

#[test]
fn matches_python() {
    let (crs, code, files) = fixture_files();
    let dir = fixture_dir();
    std::fs::write(dir.join("static.crs"), &crs).unwrap();
    std::fs::write(dir.join("code.bin"), &code).unwrap();
    let cros: Vec<Cro> = files.iter().map(|(n, b)| Cro::new(b, n).unwrap()).collect();
    for (n, b) in &files {
        std::fs::write(dir.join(format!("{n}.cro")), b).unwrap();
    }
    std::fs::write(dir.join("static.crr"), build_crr(&[cros[0].crr_hash(), cros[1].crr_hash()])).unwrap();
    let places = layout(&cros, MODULES_BASE);
    let d = |name: &str| dir.join(name).to_string_lossy().replace('\\', "/");
    let mut s = format!("init {} {} {} 0x8100000\n", d("static.crs"), d("code.bin"), d("static.crr"));
    let load = |i: usize, buffer: u32| {
        let (f, da, bs) = places[i].1;
        format!("load {} {buffer:#x} {f:#x} {da:#x} {bs:#x}\n", d(&format!("{}.cro", places[i].0)))
    };
    s += &load(0, 0x0800_0000);
    s += &load(1, 0x0801_0000);
    s += &load(2, 0x0802_0000);
    s += &load(0, 0x0800_0000);
    s += &format!("unload {:#x}\nunload 0x123\n", places[1].1.0);
    s += &load(1, 0x0801_0000);
    s += &format!("unload {:#x}\nunload {:#x}\n", places[0].1.0, places[0].1.0);
    s += &format!("unload {:#x}\n", places[2].1.0);
    let scenario = dir.join("scenario.txt");
    std::fs::write(&scenario, &s).unwrap();
    let rust = run_scenario(&s);
    std::fs::write(dir.join("rust.txt"), &rust).unwrap();
    assert!(!rust.contains("ERR static") && rust.contains("== load ModA"));
    let Some(python) = run_python(&scenario) else {
        eprintln!("SAUTÉ : Python ou cro_compare.py absent, comparaison impossible");
        return;
    };
    std::fs::write(dir.join("python.txt"), &python).unwrap();
    assert_same_report(&rust, &python);
}
