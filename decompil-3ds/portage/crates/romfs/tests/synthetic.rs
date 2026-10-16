//! Tests sur des romfs fabriqués : aller-retour de l'arbre, surcouche, lecture à cheval, `overlay_romfs`.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::rc::Rc;

use common::*;
use romfs::tree::{self, FileSource, Tree};
use romfs::{OverlayRomfs, RomfsSource, overlay_romfs};

#[test]
fn parse_then_build_is_identical() {
    let level3 = sample_level3();
    let t = tree::parse(&level3).expect("parse");
    assert_eq!(t.files.len(), sample_entries().len());
    let built = t.build();
    let data_start = built.positions[0].1 as usize;
    assert_eq!(&built.tables[..], &level3.data[..built.tables.len()]);
    assert!(data_start >= built.tables.len());
    assert_eq!(built.end, level3.data.len() as u64);
    for (i, pos) in &built.positions {
        match t.files[*i].source {
            FileSource::Level3 { position, .. } => assert_eq!(*pos, position),
            _ => panic!("source inattendue"),
        }
    }
}

#[test]
fn chains_exist_in_sample() {
    // le test d'identité n'a de sens que si des casiers contiennent plusieurs entrées
    let level3 = sample_level3();
    let tables = &level3.data;
    let h = |i: usize| u32::from_le_bytes(tables[i * 4..i * 4 + 4].try_into().unwrap()) as usize;
    let (file_hash_off, file_hash_size) = (h(5), h(6));
    let heads = (file_hash_off..file_hash_off + file_hash_size).step_by(4).filter(|&p| {
        u32::from_le_bytes(tables[p..p + 4].try_into().unwrap()) != u32::MAX
    });
    assert!(heads.count() < sample_entries().len(), "aucun casier de fichiers à plusieurs entrées");
}

#[test]
fn paths_and_lookup() {
    let level3 = sample_level3();
    let mut t = tree::parse(&level3).unwrap();
    let paths = t.all_paths();
    let wanted: Vec<String> = sample_entries().into_iter().map(|e| e.0).collect();
    let mut a = paths.clone();
    a.sort();
    let mut b = wanted.clone();
    b.sort();
    assert_eq!(a, b);
    let i = t.find_file("a/1/日本語/ファイル.bin").expect("fichier");
    assert_eq!(t.path_of_file(i), "a/1/日本語/ファイル.bin");
    assert!(t.find_file("a/9/x").is_none());
    assert_eq!(t.find_file("racine.txt").map(|i| t.files[i].parent), Some(0));
    assert!(t.find_dir("a/zzz", false).is_none());
    assert!(t.find_dir("a/zzz", true).is_some());
}

fn write(dir: &std::path::Path, name: &str, data: &[u8]) -> std::path::PathBuf {
    let p = dir.join(name);
    fs::write(&p, data).unwrap();
    p
}

/// Ce que doit contenir le fichier `path` d'après la surcouche.
fn expected_of(path: &str, repl: &BTreeMap<String, Vec<u8>>, base: &[(String, Vec<u8>)]) -> Option<Vec<u8>> {
    repl.get(path).cloned().or_else(|| base.iter().find(|e| e.0 == path).map(|e| e.1.clone()))
}

#[test]
fn overlay_replace_add_and_straddle() {
    let dir = temp_dir("overlay");
    let base_entries = sample_entries();
    let base = Rc::new(sample_level3());
    let mut repl_data: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    repl_data.insert("a/0/3".into(), noise(900, 5000)); // plus gros
    repl_data.insert("a/2".into(), noise(901, 4)); // plus petit
    repl_data.insert("a/1/vide".into(), noise(902, 21)); // était vide
    repl_data.insert("a/0/ajout".into(), noise(903, 777)); // nouveau, dossier existant
    repl_data.insert("n/o/uveau/f.bin".into(), noise(904, 100)); // nouveaux dossiers
    repl_data.insert("racine2".into(), noise(905, 1)); // nouveau à la racine
    let mut repl = BTreeMap::new();
    for (i, (p, d)) in repl_data.iter().enumerate() {
        repl.insert(p.clone(), write(&dir, &format!("f{i}"), d));
    }
    let ov = OverlayRomfs::new(base.clone(), repl.clone(), true).expect("surcouche");
    assert_eq!(ov.replaced().len(), 3);
    assert_eq!(ov.added().len(), 3);
    assert!(ov.wants("a/0/3") && ov.wants("n/o/uveau/f.bin") && !ov.wants("a/0/4"));
    assert_eq!(ov.original("a/0/3").map(|o| o.1), Some(5 + 3 * 13));

    // tout lire d'un coup, puis par morceaux de tailles irrégulières : même résultat
    let size = ov.size();
    let whole = ov.read(0, size as usize);
    assert_eq!(whole.len() as u64, size);
    for chunk in [1usize, 7, 16, 100, 4093] {
        let mut got = Vec::new();
        while (got.len() as u64) < size {
            let part = ov.read(got.len() as u64, chunk);
            assert!(!part.is_empty());
            got.extend(part);
        }
        assert_eq!(got, whole, "morceaux de {chunk}");
    }
    assert!(ov.read(size, 10).is_empty());
    assert_eq!(ov.read(size - 3, 100).len(), 3);

    // le jeu relit l'arbre qu'on lui rend : chaque fichier a le bon contenu
    let t = tree::parse(&ov).expect("relecture de l'arbre");
    let mut seen = 0;
    for i in 0..t.files.len() {
        let path = t.path_of_file(i);
        let want = expected_of(&path, &repl_data, &base_entries).unwrap_or_else(|| panic!("fichier inattendu {path}"));
        let FileSource::Level3 { position, size } = t.files[i].source else { panic!() };
        assert_eq!(size as usize, want.len(), "{path}");
        assert_eq!(&whole[position as usize..position as usize + want.len()], &want[..], "{path}");
        assert_eq!(position % 16, 0);
        seen += 1;
    }
    assert_eq!(seen, base_entries.len() + 3);
    // remplissage entre fichiers : des zéros
    let files = ov.files();
    for w in files.windows(2) {
        let (end, next) = (w[0].1 + w[0].2, w[1].1);
        assert!(whole[end as usize..next as usize].iter().all(|&b| b == 0));
    }
    // les tables relues puis refabriquées sont identiques (hachages cohérents)
    let rebuilt = t.build();
    assert_eq!(&rebuilt.tables[..], &whole[..rebuilt.tables.len()]);
    assert_eq!(rebuilt.end, size);

    // which_file / hits / describe
    let (path, start, _) = files.iter().find(|f| f.0 == "a/0/3").cloned().unwrap();
    assert_eq!(ov.which_file(start + 10), Some(("a/0/3".to_string(), 10)));
    assert!(ov.which_file(0).is_none());
    assert!(ov.hits().is_empty() || ov.hits().values().all(|&n| n > 0));
    let before = ov.hits().get(&path).copied().unwrap_or(0);
    let served = ov.read(start + 10, 20);
    assert_eq!(ov.hits().get(&path).copied().unwrap_or(0), before + 1);
    let text = ov.describe(start + 10, &served);
    assert!(text.starts_with("FICHIER DE MOD a/0/3+0xa, 20 octets servis ; DIFFÉRENT du romfs d'origine"), "{text}");
    let (_, start_new, _) = files.iter().find(|f| f.0 == "a/0/ajout").cloned().unwrap();
    let served = ov.read(start_new, 40);
    let text = ov.describe(start_new, &served);
    assert!(text.contains("fichier absent du jeu, servi : "), "{text}");
    let (_, start_other, _) = files.iter().find(|f| f.0 == "a/0/4").cloned().unwrap();
    assert_eq!(ov.describe(start_other, &[1, 2, 3]), "");
    // une plage identique à l'origine : un mod qui recopie le fichier
    let same = write(&dir, "same", &base_entries.iter().find(|e| e.0 == "a/0/5").unwrap().1);
    let ov2 = OverlayRomfs::new(base.clone(), BTreeMap::from([("a/0/5".to_string(), same)]), false).unwrap();
    let (_, s5, _) = ov2.files().into_iter().find(|f| f.0 == "a/0/5").unwrap();
    let served = ov2.read(s5, 8);
    assert!(ov2.describe(s5, &served).ends_with("identique au romfs d'origine sur cette plage"));
    assert_eq!(ov2.read(0, ov2.size() as usize), base.data, "un mod qui recopie ne change rien");

    // sans allow_new, les ajouts sont ignorés
    let ov3 = OverlayRomfs::new(base.clone(), repl, false).unwrap();
    assert_eq!(ov3.added().len(), 0);
    assert_eq!(ov3.replaced().len(), 3);
    assert!(ov3.files().iter().all(|f| f.0 != "a/0/ajout"));
    ov.close();
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overlay_without_replacement_is_identical() {
    let base = Rc::new(sample_level3());
    let ov = OverlayRomfs::new(base.clone(), BTreeMap::new(), true).unwrap();
    assert_eq!(ov.size(), base.size());
    assert_eq!(ov.read(0, base.data.len()), base.data);
    assert_eq!(ov.files(), base.files().into_iter().filter(|f| f.2 > 0).collect::<Vec<_>>());
}

#[test]
fn errors_are_romfs_errors() {
    let junk = MemRomfs { data: vec![1, 2, 3], list: vec![] };
    let e = tree::parse(&junk).unwrap_err();
    assert!(e.to_string().contains("trop court"), "{e}");
    let mut bad = sample_level3();
    bad.data[0] = 0x30;
    let e = tree::parse(&bad).unwrap_err();
    assert!(e.to_string().contains("0x30"), "{e}");
    let e = OverlayRomfs::new(Rc::new(sample_level3()), BTreeMap::from([("a/2".to_string(), "/nulle/part".into())]), true)
        .err()
        .expect("erreur");
    assert!(e.to_string().contains("impossible"), "{e}");
    let e = romfs::NcchRomfs::open(std::path::Path::new("/nulle/part.cxi")).err().expect("erreur");
    assert!(e.to_string().contains("impossible"), "{e}");
    // Tree seul
    let mut t = Tree::new();
    t.add_file("x/y", 3, FileSource::Host("h".into()));
    let b = t.build();
    assert_eq!(b.end % 16, 3);
}

#[test]
fn overlay_romfs_splits_between_base_and_update() {
    let dir = temp_dir("layers");
    let base = Rc::new(make_level3(&[("x/a", noise(1, 50)), ("x/b", noise(2, 60)), ("k", noise(3, 5))]));
    let update = Rc::new(make_level3(&[("x/b", noise(4, 70)), ("y/c", noise(5, 80))]));
    let mods = dir.join("pc");
    let mut json = String::from("{\"format\": 1, \"files\": {");
    let items = [("x/a", 11usize), ("x/b", 22), ("y/c", 33), ("z/new", 44)];
    for (i, (p, n)) in items.iter().enumerate() {
        let full = mods.join("romfs").join(p);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        let data = noise(50 + i as u32, *n);
        fs::write(&full, &data).unwrap();
        let sep = if i > 0 { "," } else { "" };
        json += &format!("{sep}\"{p}\": {{\"size\": {n}, \"sha1\": \"\", \"new\": {}}}", *p == "z/new");
    }
    json += "}}";
    fs::write(mods.join("overlay.json"), json).unwrap();
    let ov = overlay::Overlay::load(&mods).expect("overlay.json");

    let b: Rc<dyn RomfsSource> = base.clone();
    let u: Rc<dyn RomfsSource> = update.clone();
    let (nb, nu, made) = overlay_romfs(Some(b), Some(u), &ov).expect("surcouche");
    assert_eq!(made.len(), 2);
    let (nb, nu) = (nb.unwrap(), nu.unwrap());
    let names = |s: &Rc<dyn RomfsSource>| {
        let mut v: Vec<_> = s.files().into_iter().map(|f| f.0).collect();
        v.sort();
        v
    };
    assert_eq!(names(&nb), ["k", "x/a", "x/b", "z/new"]);
    assert_eq!(names(&nu), ["x/b", "y/c"]);
    assert!(made[0].wants("x/a") && made[0].wants("x/b") && made[0].wants("z/new") && !made[0].wants("y/c"));
    assert!(made[1].wants("x/b") && made[1].wants("y/c"));
    // y/c n'est que dans la mise à jour : remplacé là, pas ajouté au jeu de base
    assert!(!names(&nb).contains(&"y/c".to_string()));

    // sans mise à jour : tout va au jeu de base
    let b: Rc<dyn RomfsSource> = base.clone();
    let (nb, nu, made) = overlay_romfs(Some(b), None, &ov).unwrap();
    assert!(nu.is_none() && made.len() == 1);
    assert!(nb.unwrap().files().iter().any(|f| f.0 == "y/c"));
    // rien à faire pour la mise à jour si elle ne contient aucun fichier du mod
    let b: Rc<dyn RomfsSource> = base.clone();
    let other: Rc<dyn RomfsSource> = Rc::new(make_level3(&[("q", noise(9, 4))]));
    let (_, nu, made) = overlay_romfs(Some(b), Some(other), &ov).unwrap();
    assert_eq!(made.len(), 1);
    assert_eq!(nu.unwrap().files().len(), 1);
    let _ = fs::remove_dir_all(&dir);
}
