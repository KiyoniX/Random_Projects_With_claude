//! Compare la surcouche Rust à celle du python de référence (`mods/modkit/romfs3.py`, `overlay.py`) sur des
//! données fabriquées : mêmes octets, même liste de fichiers. Se saute si python ou `mods/modkit` manque.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::process::Command;
use std::rc::Rc;

use common::*;
use romfs::{OverlayRomfs, RomfsSource};

const SCRIPT: &str = r#"
import sys, os
mods_dir, level3, spec, allow_new, out_dir = sys.argv[1:6]
sys.path.insert(0, mods_dir)
from modkit.overlay import OverlayRomfs

class Base:
    def __init__(self, data, files):
        self.data = data
        self.size = len(data)
        self._files = files
    def read(self, position, size):
        return self.data[position:position + size]
    def files(self):
        return self._files

data = open(level3, 'rb').read()
listing = [l.rstrip('\n').split('\t') for l in open(level3 + '.list', encoding='utf-8') if l.strip()]
base = Base(data, [(p, int(a), int(b)) for p, a, b in listing])
repl = {}
for line in open(spec, encoding='utf-8'):
    if line.strip():
        path, host = line.rstrip('\n').split('\t')
        repl[path] = host
ov = OverlayRomfs(base, repl, allow_new == '1')
open(os.path.join(out_dir, 'out.bin'), 'wb').write(ov.read(0, ov.size))
with open(os.path.join(out_dir, 'files.txt'), 'w', encoding='utf-8') as f:
    for p, a, b in ov.files():
        f.write('%s\t%d\t%d\n' % (p, a, b))
    f.write('replaced\t%s\n' % ','.join(ov.replaced))
    f.write('added\t%s\n' % ','.join(ov.added))
"#;

#[test]
fn matches_python_reference() {
    let root = repo_root();
    let mods = root.join("mods");
    let Some(python) = find_python() else {
        eprintln!("python absent : test sauté");
        return;
    };
    if !mods.join("modkit").join("overlay.py").exists() {
        eprintln!("mods/modkit absent : test sauté");
        return;
    }
    let dir = temp_dir("pyref");
    let script = dir.join("ref.py");
    fs::write(&script, SCRIPT).unwrap();
    let base = Rc::new(sample_level3());
    let level3 = dir.join("level3.bin");
    fs::write(&level3, &base.data).unwrap();
    let list: String = base.list.iter().map(|(p, a, b)| format!("{p}\t{a}\t{b}\n")).collect();
    fs::write(dir.join("level3.bin.list"), list).unwrap();

    let sets: Vec<Vec<(&str, usize)>> = vec![
        vec![],
        vec![("a/0/3", 5000), ("a/2", 4), ("a/1/vide", 21), ("a/0/ajout", 777), ("n/o/uveau/f.bin", 100)],
        vec![("a/0/0", 5), ("a/0/ajout", 16), ("racine2", 1), ("é/ü/ï.bin", 33), ("b/c3/d", 1000), ("b/c3/e", 31)],
    ];
    for (case, set) in sets.iter().enumerate() {
        for allow_new in [true, false] {
            let mut repl = BTreeMap::new();
            let mut spec = String::new();
            for (i, (p, n)) in set.iter().enumerate() {
                let host = dir.join(format!("h{case}_{i}"));
                fs::write(&host, noise(700 + i as u32, *n)).unwrap();
                spec += &format!("{p}\t{}\n", host.display());
                repl.insert(p.to_string(), host);
            }
            let spec_file = dir.join(format!("spec{case}"));
            fs::write(&spec_file, spec).unwrap();
            let out_dir = dir.join(format!("out{case}_{allow_new}"));
            fs::create_dir_all(&out_dir).unwrap();
            let status = Command::new(&python)
                .arg("-I")
                .arg(&script)
                .arg(&mods)
                .arg(&level3)
                .arg(&spec_file)
                .arg(if allow_new { "1" } else { "0" })
                .arg(&out_dir)
                .output()
                .expect("python");
            assert!(status.status.success(), "python : {}", String::from_utf8_lossy(&status.stderr));

            let ov = OverlayRomfs::new(base.clone(), repl, allow_new).unwrap();
            let want = fs::read(out_dir.join("out.bin")).unwrap();
            let got = ov.read(0, ov.size() as usize);
            assert_eq!(got.len(), want.len(), "taille, cas {case} allow_new={allow_new}");
            let first = got.iter().zip(&want).position(|(a, b)| a != b);
            assert_eq!(first, None, "octets différents, cas {case} allow_new={allow_new}");
            let text = fs::read_to_string(out_dir.join("files.txt")).unwrap();
            let mut lines: Vec<String> = ov.files().iter().map(|(p, a, b)| format!("{p}\t{a}\t{b}")).collect();
            lines.push(format!("replaced\t{}", ov.replaced().join(",")));
            lines.push(format!("added\t{}", ov.added().join(",")));
            assert_eq!(text.lines().map(String::from).collect::<Vec<_>>(), lines, "fichiers, cas {case}");
        }
    }
    let _ = fs::remove_dir_all(&dir);
}
