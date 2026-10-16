//! Outils partagés par les tests : un fabricant de fichiers .cro / static.crs (aucun octet du jeu), le rejeu d'un
//! scénario (init, load, unload) par `LoaderState`, et le rapport texte que `local/analyse/runtime/cro_compare.py`
//! produit à l'identique avec `cro_loader.py`.
#![allow(dead_code)]

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;

use cro::sha256::{hex, sha256};
use cro::*;

// ---------------------------------------------------------------------------------------------------------------
// Fabrication de fichiers
// ---------------------------------------------------------------------------------------------------------------

/// Une correction d'une liste (le dernier de la liste reçoit la marque de fin tout seul).
#[derive(Clone, Copy)]
pub struct P {
    pub tag: u32,
    pub kind: u8,
    pub addend: i32,
}

pub fn p(tag: u32, kind: u8, addend: i32) -> P {
    P { tag, kind, addend }
}

pub fn t(segment: u32, offset: u32) -> u32 {
    make_tag(segment, offset)
}

#[derive(Default, Clone)]
pub struct ModImport {
    pub name: String,
    /// (numéro, liste)
    pub indexed: Vec<(u32, usize)>,
    /// (étiquette, liste)
    pub anonymous: Vec<(u32, usize)>,
}

#[derive(Clone)]
pub struct Spec {
    pub name: String,
    pub text: Vec<u8>,
    pub rodata: Vec<u8>,
    pub data: Vec<u8>,
    pub bss: u32,
    pub static_segments: Option<Vec<(u32, u32, u32)>>,
    pub named_exports: Vec<(String, u32)>,
    pub indexed_exports: Vec<u32>,
    pub lists: Vec<Vec<P>>,
    pub named_imports: Vec<(String, usize)>,
    pub import_modules: Vec<ModImport>,
    /// (étiquette, type, segment du symbole, ajout)
    pub internal: Vec<(u32, u8, u8, i32)>,
    pub static_lists: Vec<Vec<P>>,
    pub static_anonymous_exports: Vec<(u32, usize)>,
    pub on_load: u32,
    pub on_exit: u32,
    pub on_unresolved: u32,
    pub fixed_size: u32,
}

impl Spec {
    pub fn new(name: &str) -> Spec {
        Spec {
            name: name.to_string(),
            text: vec![0; 16],
            rodata: vec![],
            data: vec![],
            bss: 0,
            static_segments: None,
            named_exports: vec![],
            indexed_exports: vec![],
            lists: vec![],
            named_imports: vec![],
            import_modules: vec![],
            internal: vec![],
            static_lists: vec![],
            static_anonymous_exports: vec![],
            on_load: NO_TAG,
            on_exit: NO_TAG,
            on_unresolved: NO_TAG,
            fixed_size: 0,
        }
    }
}

/// Des octets sans signification, toujours les mêmes pour une graine donnée.
pub fn noise(seed: u32, len: usize) -> Vec<u8> {
    let mut x = seed.wrapping_mul(2654435761) | 1;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x >> 8) as u8
        })
        .collect()
}

fn pad4(v: &mut Vec<u8>) {
    while v.len() % 4 != 0 {
        v.push(0);
    }
}

fn put(buf: &mut [u8], at: usize, value: u32) {
    buf[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

fn put16(buf: &mut [u8], at: usize, value: u16) {
    buf[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

/// Un arbre d'exports valide pour `find_named_export` : nœud 0 = entrée, feuilles à bit 15.
fn build_tree(names: &[&str]) -> Vec<(u16, u16, u16, u16)> {
    if names.is_empty() {
        return vec![];
    }
    fn bit_of(name: &str, bit: usize) -> bool {
        let raw = name.as_bytes();
        let byte = bit >> 3;
        byte < raw.len() && (raw[byte] >> (bit & 7)) & 1 != 0
    }
    fn build(names: &[&str], idxs: &[usize], nodes: &mut Vec<(u16, u16, u16, u16)>) -> u16 {
        if idxs.len() == 1 {
            nodes.push((0, 0, 0, idxs[0] as u16));
            return (nodes.len() - 1) as u16 | 0x8000;
        }
        let max = idxs.iter().map(|&i| names[i].len()).max().unwrap() * 8;
        let bit = (0..max)
            .find(|&b| idxs.iter().any(|&i| bit_of(names[i], b)) && idxs.iter().any(|&i| !bit_of(names[i], b)))
            .expect("noms identiques");
        let pos = nodes.len();
        nodes.push((0, 0, 0, 0));
        let zeros: Vec<usize> = idxs.iter().copied().filter(|&i| !bit_of(names[i], bit)).collect();
        let ones: Vec<usize> = idxs.iter().copied().filter(|&i| bit_of(names[i], bit)).collect();
        let left = build(names, &zeros, nodes);
        let right = build(names, &ones, nodes);
        nodes[pos] = (bit as u16, left, right, 0);
        pos as u16
    }
    let mut nodes = vec![(0u16, 0u16, 0u16, 0u16)];
    let all: Vec<usize> = (0..names.len()).collect();
    let top = build(names, &all, &mut nodes);
    nodes[0].1 = top;
    nodes
}

/// Écrit le fichier décrit par `spec`. Les tables se suivent dans l'ordre que ro exige.
pub fn build(spec: &Spec) -> Vec<u8> {
    let is_static = spec.name == STATIC_NAME;
    let mut code = spec.text.clone();
    code.extend_from_slice(&spec.rodata);
    pad4(&mut code);
    let mut name_bytes = spec.name.as_bytes().to_vec();
    name_bytes.push(0);
    pad4(&mut name_bytes);
    // chaînes d'exports et d'imports
    let mut estr = Vec::new();
    let mut export_name_offsets = Vec::new();
    for (n, _) in &spec.named_exports {
        export_name_offsets.push(estr.len());
        estr.extend_from_slice(n.as_bytes());
        estr.push(0);
    }
    pad4(&mut estr);
    let mut istr = Vec::new();
    let mut module_name_offsets = Vec::new();
    for m in &spec.import_modules {
        module_name_offsets.push(istr.len());
        istr.extend_from_slice(m.name.as_bytes());
        istr.push(0);
    }
    let mut import_name_offsets = Vec::new();
    for (n, _) in &spec.named_imports {
        import_name_offsets.push(istr.len());
        istr.extend_from_slice(n.as_bytes());
        istr.push(0);
    }
    pad4(&mut istr);
    let names: Vec<&str> = spec.named_exports.iter().map(|(n, _)| n.as_str()).collect();
    let tree = build_tree(&names);
    let n_indexed: usize = spec.import_modules.iter().map(|m| m.indexed.len()).sum();
    let n_anon: usize = spec.import_modules.iter().map(|m| m.anonymous.len()).sum();
    let n_ext: usize = spec.lists.iter().map(|l| l.len()).sum();
    let n_static: usize = spec.static_lists.iter().map(|l| l.len()).sum();

    let mut pos = 0x138usize;
    let mut take = |len: usize| {
        let at = pos;
        pos += len;
        at
    };
    let code_off = take(code.len());
    let name_off = take(name_bytes.len());
    let seg_off = take(4 * 12);
    let exp_off = take(8 * spec.named_exports.len());
    let tree_off = take(8 * tree.len());
    let idx_off = take(4 * spec.indexed_exports.len());
    let estr_off = take(estr.len());
    let impmod_off = take(20 * spec.import_modules.len());
    let ext_off = take(12 * n_ext);
    let nimp_off = take(8 * spec.named_imports.len());
    let iimp_off = take(8 * n_indexed);
    let aimp_off = take(8 * n_anon);
    let istr_off = take(istr.len());
    let sanon_off = take(8 * spec.static_anonymous_exports.len());
    let int_off = take(12 * spec.internal.len());
    let sp_off = take(12 * n_static);
    let mut data = spec.data.clone();
    pad4(&mut data);
    let data_off = take(data.len());
    let total = pos;
    let mut buf = vec![0u8; total];

    buf[0x80..0x84].copy_from_slice(MAGIC);
    put(&mut buf, 0x84, name_off as u32);
    put(&mut buf, 0x90, total as u32);
    put(&mut buf, 0x94, spec.bss);
    put(&mut buf, 0x98, spec.fixed_size);
    put(&mut buf, 0xA0, NO_TAG);
    put(&mut buf, 0xA4, spec.on_load);
    put(&mut buf, 0xA8, spec.on_exit);
    put(&mut buf, 0xAC, spec.on_unresolved);
    put(&mut buf, 0xB0, code_off as u32);
    put(&mut buf, 0xB4, code.len() as u32);
    put(&mut buf, 0xB8, data_off as u32);
    put(&mut buf, 0xBC, spec.data.len() as u32);
    put(&mut buf, 0xC0, name_off as u32);
    put(&mut buf, 0xC4, (spec.name.len() + 1) as u32);
    let table = |buf: &mut Vec<u8>, header_at: usize, start: usize, count: usize| {
        put(buf, header_at, start as u32);
        put(buf, header_at + 4, count as u32);
    };
    table(&mut buf, 0xC8, seg_off, 4);
    table(&mut buf, 0xD0, exp_off, spec.named_exports.len());
    table(&mut buf, 0xD8, idx_off, spec.indexed_exports.len());
    table(&mut buf, 0xE0, estr_off, estr.len());
    table(&mut buf, 0xE8, tree_off, tree.len());
    table(&mut buf, 0xF0, impmod_off, spec.import_modules.len());
    table(&mut buf, 0xF8, ext_off, n_ext);
    table(&mut buf, 0x100, nimp_off, spec.named_imports.len());
    table(&mut buf, 0x108, iimp_off, n_indexed);
    table(&mut buf, 0x110, aimp_off, n_anon);
    table(&mut buf, 0x118, istr_off, istr.len());
    table(&mut buf, 0x120, sanon_off, spec.static_anonymous_exports.len());
    table(&mut buf, 0x128, int_off, spec.internal.len());
    table(&mut buf, 0x130, sp_off, n_static);

    buf[code_off..code_off + code.len()].copy_from_slice(&code);
    buf[name_off..name_off + name_bytes.len()].copy_from_slice(&name_bytes);
    // segments
    let segments = match (&spec.static_segments, is_static) {
        (Some(s), _) => s.clone(),
        _ => vec![
            (code_off as u32, spec.text.len() as u32, 0),
            ((code_off + spec.text.len()) as u32, spec.rodata.len() as u32, 1),
            (data_off as u32, spec.data.len() as u32, 2),
            (0, spec.bss, 3),
        ],
    };
    for (i, (o, s, k)) in segments.iter().enumerate() {
        put(&mut buf, seg_off + 12 * i, *o);
        put(&mut buf, seg_off + 12 * i + 4, *s);
        put(&mut buf, seg_off + 12 * i + 8, *k);
    }
    for (i, (_, tag)) in spec.named_exports.iter().enumerate() {
        put(&mut buf, exp_off + 8 * i, (estr_off + export_name_offsets[i]) as u32);
        put(&mut buf, exp_off + 8 * i + 4, *tag);
    }
    for (i, n) in tree.iter().enumerate() {
        put16(&mut buf, tree_off + 8 * i, n.0);
        put16(&mut buf, tree_off + 8 * i + 2, n.1);
        put16(&mut buf, tree_off + 8 * i + 4, n.2);
        put16(&mut buf, tree_off + 8 * i + 6, n.3);
    }
    for (i, tag) in spec.indexed_exports.iter().enumerate() {
        put(&mut buf, idx_off + 4 * i, *tag);
    }
    buf[estr_off..estr_off + estr.len()].copy_from_slice(&estr);
    buf[istr_off..istr_off + istr.len()].copy_from_slice(&istr);
    // listes de corrections d'import : positions de départ
    let mut list_start = Vec::new();
    let mut cursor = 0;
    for list in &spec.lists {
        list_start.push(ext_off + 12 * cursor);
        for (k, patch) in list.iter().enumerate() {
            let at = ext_off + 12 * (cursor + k);
            put(&mut buf, at, patch.tag);
            buf[at + 4] = patch.kind;
            buf[at + 5] = (k == list.len() - 1) as u8;
            put(&mut buf, at + 8, patch.addend as u32);
        }
        cursor += list.len();
    }
    for (i, (_, list)) in spec.named_imports.iter().enumerate() {
        put(&mut buf, nimp_off + 8 * i, (istr_off + import_name_offsets[i]) as u32);
        put(&mut buf, nimp_off + 8 * i + 4, list_start[*list] as u32);
    }
    let (mut ci, mut ca) = (0, 0);
    for (i, m) in spec.import_modules.iter().enumerate() {
        let at = impmod_off + 20 * i;
        put(&mut buf, at, (istr_off + module_name_offsets[i]) as u32);
        put(&mut buf, at + 4, (iimp_off + 8 * ci) as u32);
        put(&mut buf, at + 8, m.indexed.len() as u32);
        put(&mut buf, at + 12, (aimp_off + 8 * ca) as u32);
        put(&mut buf, at + 16, m.anonymous.len() as u32);
        for &(index, list) in &m.indexed {
            put(&mut buf, iimp_off + 8 * ci, index);
            put(&mut buf, iimp_off + 8 * ci + 4, list_start[list] as u32);
            ci += 1;
        }
        for &(tag, list) in &m.anonymous {
            put(&mut buf, aimp_off + 8 * ca, tag);
            put(&mut buf, aimp_off + 8 * ca + 4, list_start[list] as u32);
            ca += 1;
        }
    }
    let mut static_start = Vec::new();
    let mut cursor = 0;
    for list in &spec.static_lists {
        static_start.push(sp_off + 12 * cursor);
        for (k, patch) in list.iter().enumerate() {
            let at = sp_off + 12 * (cursor + k);
            put(&mut buf, at, patch.tag);
            buf[at + 4] = patch.kind;
            buf[at + 5] = (k == list.len() - 1) as u8;
            put(&mut buf, at + 8, patch.addend as u32);
        }
        cursor += list.len();
    }
    for (i, &(tag, list)) in spec.static_anonymous_exports.iter().enumerate() {
        put(&mut buf, sanon_off + 8 * i, tag);
        put(&mut buf, sanon_off + 8 * i + 4, static_start[list] as u32);
    }
    for (i, &(tag, kind, segment, addend)) in spec.internal.iter().enumerate() {
        let at = int_off + 12 * i;
        put(&mut buf, at, tag);
        buf[at + 4] = kind;
        buf[at + 5] = segment;
        put(&mut buf, at + 8, addend as u32);
    }
    buf[data_off..data_off + data.len()].copy_from_slice(&data);
    // empreintes : 0x80..0x180, code, tables (du nom aux données), données
    let regions = [
        (0x80usize, 0x100usize),
        (code_off, code.len()),
        (name_off, data_off - name_off),
        (data_off, spec.data.len()),
    ];
    for (i, (start, size)) in regions.iter().enumerate() {
        let digest = sha256(&buf[*start..*start + *size]);
        buf[32 * i..32 * i + 32].copy_from_slice(&digest);
    }
    buf
}

/// La liste de modules du scénario fabriqué : (static.crs, code principal, [ModA, ModB, ModC]).
pub fn fixture_files() -> (Vec<u8>, Vec<u8>, Vec<(String, Vec<u8>)>) {
    // --- static.crs ---
    let mut crs = Spec::new(STATIC_NAME);
    crs.text = noise(1, 0x20);
    crs.static_segments = Some(vec![(0x100000, 0x200, 0), (0x100200, 0x100, 1), (0x100300, 0x100, 2), (0x100400, 0x40, 3)]);
    crs.on_unresolved = t(0, 0xF0);
    crs.named_exports = vec![
        ("static_func".into(), t(0, 0x41)),
        ("nnroAeabiAtexit_".into(), t(0, 0x80)),
        ("static_data".into(), t(2, 0x10)),
    ];
    crs.indexed_exports = vec![t(0, 0x40), t(2, 0x20)];
    crs.lists = vec![
        vec![p(t(0, 0x10), 2, 4)],                         // 0 : ModA, par numéro 0
        vec![p(t(0, 0x14), 3, 0)],                         // 1 : ModA, anonyme t(0,0x20)
        vec![p(t(0, 0x18), 2, 0), p(t(0, 0x1C), 28, 0)],   // 2 : mod_a_named
        vec![p(t(0, 0x20), 2, 0)],                         // 3 : ModB, par numéro 1
        vec![p(t(0, 0x24), 2, 8)],                         // 4 : never_defined
        vec![p(t(0, 0x28), 2, 0)],                         // 5 : ModC, par numéro 0
    ];
    crs.named_imports = vec![("mod_a_named".into(), 2), ("never_defined".into(), 4)];
    crs.import_modules = vec![
        ModImport { name: "ModA".into(), indexed: vec![(0, 0)], anonymous: vec![(t(0, 0x20), 1)] },
        ModImport { name: "ModB".into(), indexed: vec![(1, 3)], anonymous: vec![] },
        ModImport { name: "ModC".into(), indexed: vec![(0, 5)], anonymous: vec![] },
    ];
    let mut code = noise(7, 0x400);
    code[0x10..0x14].copy_from_slice(&[0, 0, 0, 0]);

    // --- ModA ---
    let mut a = Spec::new("ModA");
    a.text = noise(11, 0x80);
    a.rodata = noise(12, 0x20);
    a.data = noise(13, 0x40);
    a.bss = 0x30;
    a.on_load = t(0, 0x60);
    a.on_unresolved = t(0, 0x70);
    a.named_exports = vec![
        ("mod_a_named".into(), t(0, 0x20)),
        ("mod_a_data".into(), t(2, 0x8)),
        ("mod_a_thumb".into(), t(0, 0x31)),
        ("zeta".into(), t(1, 4)),
    ];
    a.indexed_exports = vec![t(0, 0x40), t(0, 0x44)];
    a.lists = vec![
        vec![p(t(0, 0x00), 2, 0), p(t(0, 0x04), 28, 0)],   // 0 static_func
        vec![p(t(0, 0x08), 10, 0)],                        // 1 static_data (Thumb trop loin)
        vec![p(t(0, 0x10), 2, 5)],                         // 2 ghost_symbol
        vec![p(t(0, 0x14), 2, 0)],                         // 3 __aeabi_atexit
        vec![p(t(1, 0x00), 3, 0), p(t(2, 0x30), 2, 1)],    // 4 static, par numéro 1
        vec![p(t(0, 0x18), 2, 0)],                         // 5 static, anonyme
        vec![p(t(0, 0x1C), 2, 0), p(t(0, 0x2C), 42, 0)],   // 6 ModB, par numéro 0
        vec![p(t(0, 0x24), 29, 0)],                        // 7 ModB, anonyme t(0,0x10)
    ];
    a.named_imports = vec![
        ("static_func".into(), 0),
        ("static_data".into(), 1),
        ("ghost_symbol".into(), 2),
        ("__aeabi_atexit".into(), 3),
    ];
    a.import_modules = vec![
        ModImport { name: STATIC_NAME.into(), indexed: vec![(1, 4)], anonymous: vec![(t(2, 0x10), 5)] },
        ModImport { name: "ModB".into(), indexed: vec![(0, 6)], anonymous: vec![(t(0, 0x10), 7)] },
    ];
    a.internal = vec![
        (t(2, 0x00), 2, 0, 0x10),
        (t(2, 0x04), 3, 1, 0),
        (t(1, 0x08), 2, 2, 0x20),
        (t(3, 0x00), 2, 0, 0),
        (t(0, 0x7C), 38, 0, -4),
        (t(0, 0x78), 42, 0, 0),
        (t(2, 0x3C), 2, 5, 0),
        (t(2, 0x38), 0, 0, 0),
        (t(0, 0x74), 99, 0, 0),
    ];
    a.static_lists = vec![vec![p(t(0, 0x30), 2, 0)], vec![p(t(0, 0x34), 28, 0)]];
    a.static_anonymous_exports = vec![(t(0, 0x50), 0), (t(0, 0x58), 1)];

    // --- ModB ---
    let mut b = Spec::new("ModB");
    b.text = noise(21, 0x60);
    b.rodata = noise(22, 0x10);
    b.data = noise(23, 0x20);
    b.bss = 0x10;
    b.named_exports = vec![("mod_b_fn".into(), t(0, 0x40)), ("mod_b_thumb".into(), t(0, 0x21))];
    b.indexed_exports = vec![t(0, 0x08), t(0, 0x44)];
    b.lists = vec![
        vec![p(t(0, 0x00), 10, 0), p(t(0, 0x08), 28, 0)],  // 0 mod_a_thumb
        vec![p(t(0, 0x04), 28, 0), p(t(0, 0x0C), 10, 0)],  // 1 mod_a_named
        vec![p(t(0, 0x14), 2, 0)],                         // 2 __aeabi_atexit
        vec![p(t(0, 0x18), 2, 0)],                         // 3 ModA par numéro 1
        vec![p(t(0, 0x1C), 2, 0)],                         // 4 ModA par numéro 5 (absent)
        vec![p(t(0, 0x20), 3, 0)],                         // 5 ModA anonyme t(0,0x20)
        vec![p(t(0, 0x24), 2, 0)],                         // 6 ModA anonyme hors segment
        vec![p(t(0, 0x28), 2, 0)],                         // 7 ModC par numéro 0
    ];
    b.named_imports = vec![
        ("mod_a_thumb".into(), 0),
        ("mod_a_named".into(), 1),
        ("__aeabi_atexit".into(), 2),
    ];
    b.import_modules = vec![
        ModImport {
            name: "ModA".into(),
            indexed: vec![(1, 3), (5, 4)],
            anonymous: vec![(t(0, 0x20), 5), (t(0, 0xFFF0), 6)],
        },
        ModImport { name: "ModC".into(), indexed: vec![(0, 7)], anonymous: vec![] },
    ];

    // --- ModC : en-tête avec 0x98 non nul ---
    let mut c = Spec::new("ModC");
    c.text = noise(31, 0x30);
    c.data = noise(32, 0x10);
    c.fixed_size = 0x2000;
    c.indexed_exports = vec![t(0, 0x10)];
    c.lists = vec![vec![p(t(0, 0x00), 2, 0)]];
    c.named_imports = vec![("zeta".into(), 0)];
    c.internal = vec![(t(2, 0x08), 3, 0, 8)];

    (build(&crs), code, vec![("ModA".into(), build(&a)), ("ModB".into(), build(&b)), ("ModC".into(), build(&c))])
}

/// Un static.crr fabriqué avec les empreintes données.
pub fn build_crr(hashes: &[[u8; 32]]) -> Vec<u8> {
    let mut v = vec![0u8; 0x358 + 32 * hashes.len()];
    v[..4].copy_from_slice(b"CRR0");
    put(&mut v, 0x350, 0x358);
    put(&mut v, 0x354, hashes.len() as u32);
    for (i, h) in hashes.iter().enumerate() {
        v[0x358 + 32 * i..0x358 + 32 * i + 32].copy_from_slice(h);
    }
    v
}

// ---------------------------------------------------------------------------------------------------------------
// Rejeu d'un scénario et rapport
// ---------------------------------------------------------------------------------------------------------------

fn digest_text(text: &str) -> String {
    hex(&sha256(text.as_bytes()))
}

/// CRC-32 (zlib) : assez pour comparer l'état complet à chaque étape sans ralentir les tests en mode debug.
fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, slot) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *slot = c;
        }
        t
    });
    !data.iter().fold(!0u32, |c, &b| table[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8))
}

fn state_line(state: &LoaderState) -> String {
    let Some(linker) = state.linker() else {
        return "state: -".to_string();
    };
    let main = linker.main_code_bytes().map_or("-".to_string(), |c| format!("{:08x}", crc32(c)));
    let mut mods = String::new();
    for m in linker.chain.iter().skip(1) {
        write!(mods, "{}:{:08x}:{:08x};", m.name, crc32(linker.image(m)), crc32(linker.data(m))).unwrap();
    }
    format!("state: main={main} mods={}", digest_text(&mods))
}

fn linker_lines(state: &LoaderState, out: &mut String) {
    let Some(linker) = state.linker() else {
        return;
    };
    let mut unresolved = String::new();
    let list = linker.unresolved();
    for u in &list {
        let detail = match &u.detail {
            ImportDetail::Name(n) => n.clone(),
            ImportDetail::Indexed(t, i) => format!("{t}#{i}"),
            ImportDetail::Anonymous(t, tag) => format!("{t}@{tag:#x}"),
        };
        writeln!(unresolved, "{}|{}|{}|{}", u.importer, u.kind, detail, u.reason).unwrap();
    }
    writeln!(out, "unresolved: {} {}", list.len(), digest_text(&unresolved)).unwrap();
    let mut problems = String::new();
    for (m, text) in &linker.problems {
        writeln!(problems, "{m}|{text}").unwrap();
    }
    writeln!(out, "problems: {} {}", linker.problems.len(), digest_text(&problems)).unwrap();
    let log: Vec<String> = linker.patch_log.iter().map(|(k, v)| format!("{k}={v}")).collect();
    writeln!(out, "patchlog: {}", log.join(",")).unwrap();
}

fn writes_text(writes: &[WordWrite]) -> String {
    let mut s = String::new();
    for w in writes {
        write!(s, "{:#x}:{:#x}:{};", w.address, w.value, w.width).unwrap();
    }
    s
}

fn parse(text: &str) -> u32 {
    let text = text.trim();
    match text.strip_prefix("0x") {
        Some(h) => u32::from_str_radix(h, 16).unwrap(),
        None => text.parse().unwrap(),
    }
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap()
}

/// Rejoue le scénario (voir `local/analyse/runtime/cro_compare.py` pour le format) et rend le rapport.
pub fn run_scenario(scenario: &str) -> String {
    let mut state = LoaderState::new();
    let mut out = String::new();
    for line in scenario.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let w: Vec<&str> = line.split_whitespace().collect();
        match w[0] {
            "init" => {
                let mirror = parse(w[4]);
                writeln!(out, "== init mirror={mirror:#x}").unwrap();
                let crs = std::fs::read(w[1]).unwrap();
                let code = (w[2] != "-").then(|| std::fs::read(w[2]).unwrap());
                match state.initialize(&crs, code.as_deref(), mirror) {
                    Ok(journal) => writeln!(out, "journal: {journal}").unwrap(),
                    Err(e) => writeln!(out, "ERR {e}").unwrap(),
                }
                if w[3] != "-" {
                    match state.load_crr(&std::fs::read(w[3]).unwrap()) {
                        Ok(n) => writeln!(out, "crr: {n}").unwrap(),
                        Err(e) => writeln!(out, "ERR {e}").unwrap(),
                    }
                }
            }
            "load" => {
                let (buffer, mirror, data, bss) = (parse(w[2]), parse(w[3]), parse(w[4]), parse(w[5]));
                writeln!(out, "== load {} mirror={mirror:#x}", base_name(w[1])).unwrap();
                let original = std::fs::read(w[1]).unwrap();
                match state.load_exe_cro(&original, buffer, mirror, data, bss) {
                    Err(e) => writeln!(out, "ERR {e}").unwrap(),
                    Ok(r) => {
                        writeln!(out, "image: {}", hex(&sha256(&r.image))).unwrap();
                        writeln!(out, "writes: {} {}", r.external_writes.len(), digest_text(&writes_text(&r.external_writes)))
                            .unwrap();
                        writeln!(out, "written: {}", r.written).unwrap();
                        writeln!(out, "warning: {}", r.warning.as_deref().unwrap_or("-")).unwrap();
                        writeln!(out, "journal: {}", r.journal).unwrap();
                        for l in &r.problem_lines {
                            writeln!(out, "problem: {l}").unwrap();
                        }
                        writeln!(out, "pending: {}", r.pending_imports).unwrap();
                    }
                }
            }
            "unload" => {
                let mirror = parse(w[1]);
                writeln!(out, "== unload mirror={mirror:#x}").unwrap();
                match state.unload_cro(mirror) {
                    Err(e) => writeln!(out, "ERR {e}").unwrap(),
                    Ok(r) => {
                        writeln!(out, "name: {}", r.name).unwrap();
                        writeln!(out, "writes: {} {}", r.external_writes.len(), digest_text(&writes_text(&r.external_writes)))
                            .unwrap();
                        writeln!(out, "written: {}", r.written).unwrap();
                        writeln!(out, "journal: {}", r.journal).unwrap();
                        writeln!(out, "original: {}", hex(&sha256(&r.original))).unwrap();
                    }
                }
            }
            other => panic!("commande de scénario inconnue : {other}"),
        }
        writeln!(out, "{}", state_line(&state)).unwrap();
        linker_lines(&state, &mut out);
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------------------------------------------

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap().to_path_buf()
}

pub fn python() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(r"C:\Users\krisr\AppData\Local\Programs\Python\Python312\python.exe"),
        PathBuf::from("python"),
    ];
    candidates.into_iter().find(|c| Command::new(c).arg("--version").output().map(|o| o.status.success()).unwrap_or(false))
}

pub fn compare_script() -> PathBuf {
    repo_root().join("local").join("analyse").join("runtime").join("cro_compare.py")
}

/// Lance `cro_compare.py` sur un scénario ; `None` si Python ou le script manque.
pub fn run_python(scenario: &Path) -> Option<String> {
    let python = python()?;
    let script = compare_script();
    if !script.exists() {
        return None;
    }
    let output = Command::new(python).arg(script).arg(scenario).output().ok()?;
    assert!(output.status.success(), "cro_compare.py a échoué : {}", String::from_utf8_lossy(&output.stderr));
    Some(String::from_utf8(output.stdout).unwrap().replace("\r\n", "\n"))
}

/// Compare ligne à ligne et panique avec la première différence.
pub fn assert_same_report(rust: &str, python: &str) {
    for (i, (r, p)) in rust.lines().zip(python.lines()).enumerate() {
        assert_eq!(r, p, "première différence à la ligne {} du rapport", i + 1);
    }
    assert_eq!(rust.lines().count(), python.lines().count(), "rapports de longueurs différentes");
}
