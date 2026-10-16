//! La vraie preuve : static.crs, static.crr et les .cro du jeu extraits dans `local/extrait/maj/` sont chargés en
//! Rust et en Python (`cro_loader.py`) sur le même scénario, et les deux rapports doivent être identiques ligne
//! pour ligne (images, mots écrits hors du module, imports en attente, problèmes, journal, code principal).
//! Ces tests se sautent s'il manque le dump (rien du jeu n'est versionné).

mod common;

use std::path::PathBuf;

use common::*;
use cro::sha256::sha256;
use cro::*;

fn dump() -> Option<(PathBuf, PathBuf)> {
    let extracted = repo_root().join("local").join("extrait").join("maj");
    let romfs = extracted.join("romfs");
    let code = extracted.join("exefs").join("code.bin");
    if romfs.join("static.crs").exists() && code.exists() { Some((romfs, code)) } else { None }
}

#[test]
fn real_headers_and_hashes() {
    let Some((romfs, code)) = dump() else {
        eprintln!("SAUTÉ : local/extrait/maj/ absent");
        return;
    };
    let (crs, cros, crr) = read_romfs(&romfs).unwrap();
    assert!(!cros.is_empty());
    let crr = read_crr(&crr.expect("static.crr")).unwrap();
    for cro in &cros {
        assert!(cro.ro_header_problems().is_empty(), "{} : {:?}", cro.name, cro.ro_header_problems());
        for (what, written, computed) in cro.hashes() {
            assert_eq!(written, computed.to_vec(), "{} : empreinte {what}", cro.name);
        }
        assert!(crr.contains(&cro.crr_hash()), "{} absent de static.crr", cro.name);
        for (name, tag) in &cro.named_exports {
            assert_eq!(cro.find_named_export(name), Some(*tag), "{}/{name}", cro.name);
        }
    }
    for (what, written, computed) in crs.hashes() {
        assert_eq!(written, computed.to_vec(), "static.crs : empreinte {what}");
    }
    // tout charger d'un coup, comme `cro_loader.py verify`
    let main = std::fs::read(code).unwrap();
    let names: Vec<String> = cros.iter().map(|c| c.name.clone()).collect();
    let (linker, _) = link_set(crs, cros, Some(&main), None).unwrap();
    assert_eq!(linker.chain.len(), names.len() + 1);
    eprintln!(
        "{} modules chargés, {} listes sans symbole, {} problèmes, code principal {}",
        names.len(),
        linker.unresolved().len(),
        linker.problems.len(),
        cro::sha256::hex(&sha256(linker.main_code_bytes().unwrap()))
    );
}

#[test]
fn real_matches_python() {
    let Some((romfs, code)) = dump() else {
        eprintln!("SAUTÉ : local/extrait/maj/ absent");
        return;
    };
    let (_, cros, _) = read_romfs(&romfs).unwrap();
    let places = layout(&cros, MODULES_BASE);
    let path = |name: &str| romfs.join(name).to_string_lossy().replace('\\', "/");
    let mut s = format!(
        "init {} {} {} 0x8100000\n",
        path("static.crs"),
        code.to_string_lossy().replace('\\', "/"),
        romfs.join(".crr").join("static.crr").to_string_lossy().replace('\\', "/")
    );
    let load = |i: usize| {
        let (f, d, b) = places[i].1;
        // le fichier .cro garde le nom du module (voir read_romfs : tri par nom de fichier)
        let file = cros[i].file_name.clone();
        format!("load {} {:#x} {f:#x} {d:#x} {b:#x}\n", path(&file), 0x0800_0000u32 + 0x10_0000 * i as u32)
    };
    for i in 0..places.len() {
        s += &load(i);
    }
    let n = places.len();
    for i in [0, n / 2, n - 1] {
        s += &format!("unload {:#x}\n", places[i].1.0);
    }
    s += &load(n / 2);
    s += &load(0);
    for i in (0..n).rev().step_by(7) {
        s += &format!("unload {:#x}\n", places[i].1.0);
    }
    let dir = repo_root().join("local").join("portage").join("cro-real");
    std::fs::create_dir_all(&dir).unwrap();
    let scenario = dir.join("scenario.txt");
    std::fs::write(&scenario, &s).unwrap();
    let rust = run_scenario(&s);
    std::fs::write(dir.join("rust.txt"), &rust).unwrap();
    let Some(python) = run_python(&scenario) else {
        eprintln!("SAUTÉ : Python ou cro_compare.py absent");
        return;
    };
    std::fs::write(dir.join("python.txt"), &python).unwrap();
    assert_same_report(&rust, &python);
    eprintln!("{} lignes identiques ({} modules)", rust.lines().count(), n);
}
