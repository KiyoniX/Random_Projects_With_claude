//! Tests sur le vrai dump (`local/dump/pokemon-x.cxi`, `pokemon-x_maj.cxi`, déchiffrés). Chacun se saute si les
//! fichiers manquent ; la comparaison avec `banc/romfs.py` se saute si python manque. Aucun octet du jeu n'est
//! écrit ici : les références sont calculées au moment du test par python.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::rc::Rc;
use std::time::Instant;

use common::*;
use romfs::{NcchRomfs, OverlayRomfs, RomfsSource};

const SCRIPT: &str = r#"
import sys, hashlib
banc, cxi = sys.argv[1:3]
sys.path.insert(0, banc)
import romfs
r = romfs.NcchRomfs(cxi)
files = r.files()
print('size', r.size)
print('count', len(files))
print('head', hashlib.sha1(r.read(0, 0x2000)).hexdigest())
mid = files[len(files) // 2]
print('mid', mid[0], mid[1], mid[2], hashlib.sha1(r.read(mid[1], mid[2])).hexdigest())
last = files[-1]
print('tail', hashlib.sha1(r.read(last[1] + last[2] - 10, 100)).hexdigest())
for p, a, b in files:
    print('f\t%s\t%d\t%d' % (p, a, b))
"#;

fn dumps() -> Vec<PathBuf> {
    let dir = repo_root().join("local").join("dump");
    ["pokemon-x.cxi", "pokemon-x_maj.cxi"].iter().map(|n| dir.join(n)).filter(|p| p.exists()).collect()
}

#[test]
fn ncch_matches_python() {
    let paths = dumps();
    if paths.is_empty() {
        eprintln!("pas de dump : test sauté");
        return;
    }
    let python = find_python();
    let dir = temp_dir("dump-py");
    let script = dir.join("ref.py");
    fs::write(&script, SCRIPT).unwrap();
    for path in paths {
        let started = Instant::now();
        let r = NcchRomfs::open(&path).expect("open");
        let files = r.files();
        assert!(files.len() > 100);
        let took = started.elapsed();
        eprintln!("{} : {} fichiers, taille {:#x}, open+files {took:?}", path.display(), files.len(), r.size());
        assert!(took.as_secs_f32() < 2.0);
        assert_eq!(r.try_files().unwrap(), files);
        // lecture hors limites
        assert!(r.read(r.size(), 16).is_empty());
        assert_eq!(r.read(r.size() - 4, 16).len(), 4);
        assert_eq!(&r.read(0, 4), &[0x28, 0, 0, 0]);

        let Some(python) = &python else {
            eprintln!("python absent : comparaison sautée");
            continue;
        };
        let out = Command::new(python)
            .arg("-I")
            .arg(&script)
            .arg(repo_root().join("banc"))
            .arg(&path)
            .output()
            .expect("python");
        assert!(out.status.success(), "python : {}", String::from_utf8_lossy(&out.stderr));
        let text = String::from_utf8(out.stdout).unwrap();
        let mut lines = text.lines();
        assert_eq!(lines.next().unwrap(), format!("size {}", r.size()));
        assert_eq!(lines.next().unwrap(), format!("count {}", files.len()));
        let sha = |b: &[u8]| overlay::sha1(b).iter().map(|x| format!("{x:02x}")).collect::<String>();
        assert_eq!(lines.next().unwrap(), format!("head {}", sha(&r.read(0, 0x2000))));
        let mid = &files[files.len() / 2];
        assert_eq!(
            lines.next().unwrap(),
            format!("mid {} {} {} {}", mid.0, mid.1, mid.2, sha(&r.read(mid.1, mid.2 as usize)))
        );
        let last = files.last().unwrap();
        assert_eq!(lines.next().unwrap(), format!("tail {}", sha(&r.read(last.1 + last.2 - 10, 100))));
        let want: Vec<String> = lines.map(String::from).collect();
        let got: Vec<String> = files.iter().map(|(p, a, b)| format!("f\t{p}\t{a}\t{b}")).collect();
        assert_eq!(got, want);
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overlay_without_replacement_rereads_the_same_bytes() {
    for path in dumps() {
        let base: Rc<dyn RomfsSource> = Rc::new(NcchRomfs::open(&path).expect("open"));
        let started = Instant::now();
        let ov = OverlayRomfs::new(base.clone(), BTreeMap::new(), true).expect("surcouche");
        let took = started.elapsed();
        eprintln!("{} : OverlayRomfs::new en {took:?}", path.display());
        assert!(took.as_secs_f32() < 3.0, "trop lent : {took:?}");
        assert_eq!(ov.size(), base.size(), "taille du niveau 3");
        let mut files = base.files();
        files.retain(|f| f.2 > 0);
        assert_eq!(ov.files(), files);
        const BLOCK: usize = 1 << 20;
        let mut pos = 0u64;
        while pos < base.size() {
            let a = base.read(pos, BLOCK);
            let b = ov.read(pos, BLOCK);
            assert!(a == b, "octets différents dans le bloc à {pos:#x}");
            pos += BLOCK as u64;
        }
    }
}

#[test]
fn real_file_replaced_in_the_dump() {
    let Some(path) = dumps().into_iter().next() else {
        eprintln!("pas de dump : test sauté");
        return;
    };
    let base: Rc<dyn RomfsSource> = Rc::new(NcchRomfs::open(&path).expect("open"));
    let files = base.files();
    let (name, start, size) = files.iter().find(|f| f.2 >= 64).cloned().expect("un fichier");
    let dir = temp_dir("dump-repl");
    let host = dir.join("mod.bin");
    let content = noise(5, size as usize + 100);
    fs::write(&host, &content).unwrap();
    let ov = OverlayRomfs::new(
        base.clone(),
        BTreeMap::from([(name.clone(), host), ("zz/ajout.bin".to_string(), dir.join("mod.bin"))]),
        true,
    )
    .unwrap();
    let (_, new_start, new_size) = ov.files().into_iter().find(|f| f.0 == name).unwrap();
    assert_eq!(new_size as usize, content.len());
    assert_eq!(ov.read(new_start, content.len()), content);
    let _ = start;
    // un autre fichier, inchangé, relu à l'identique à sa nouvelle place
    let (other, ostart, osize) = files.iter().filter(|f| f.0 != name && f.2 > 0).last().cloned().unwrap();
    let (_, nstart, _) = ov.files().into_iter().find(|f| f.0 == other).unwrap();
    assert_eq!(ov.read(nstart, osize as usize), base.read(ostart, osize as usize));
    let _ = fs::remove_dir_all(&dir);
}
