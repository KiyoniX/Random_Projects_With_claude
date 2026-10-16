//! Les petits services du démarrage : `cfg:u`, `ptm:u`, `hid:USER`, le port `err:f` (contrat des petits services).
//! Port de `banc/services/small.py`.
//!
//! - `cfg:u` : réel. Les blocs viennent du fichier `config` de la console (local/, jamais versionné), lu au format de
//!   `cfg` (fiche cfg, partie 5) ; GenHashConsoleUnique refait le calcul du module (SHA-256 du bloc 0x00090001 et du sel).
//!   Sans fichier, des valeurs raisonnables pour les 16 blocs que le jeu demande.
//! - `ptm:u` : réel pour la seule commande envoyée (GetStepHistory écrit des zéros).
//! - `hid:USER` : simplifié. Une vraie page partagée, mise à jour à chaque fin d'image avec « aucun bouton », cinq
//!   signaux jamais déclenchés (le jeu ne les attend pas), les constantes du gyroscope.
//! - `err:f` : réel côté banc : la fiche d'erreur est décodée, notée, et le banc s'arrête là.

use std::collections::BTreeMap;

use cro::sha256::sha256;
use kernel::ipc::{Reply, Request, Service, unknown_command};
use kernel::kernel::Kernel;
use kernel::object::ObjId;

fn le16(data: &[u8], at: usize) -> u32 {
    u16::from_le_bytes([data[at], data[at + 1]]) as u32
}

fn le32(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]])
}

fn hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

/// {bloc: octets} depuis le fichier `config` de cfg : nombre, décalage des données, puis cases de 12 octets.
/// Une case qui dépasse le fichier arrête la lecture (le banc Python s'arrêterait sur une erreur).
pub fn parse_config(data: &[u8]) -> BTreeMap<u32, Vec<u8>> {
    let mut blocks = BTreeMap::new();
    if data.len() < 4 {
        return blocks;
    }
    let count = le16(data, 0) as usize;
    for i in 0..count {
        let at = 4 + 12 * i;
        if at + 12 > data.len() {
            break;
        }
        let (block_id, value, size) = (le32(data, at), le32(data, at + 4), le16(data, at + 8) as usize);
        if size <= 4 {
            blocks.insert(block_id, value.to_le_bytes()[..size].to_vec());
        } else {
            let start = (value as usize).min(data.len());
            let end = (value as usize + size).min(data.len());
            blocks.insert(block_id, data[start..end].to_vec());
        }
    }
    blocks
}

pub fn default_blocks() -> BTreeMap<u32, Vec<u8>> {
    let mut blocks: BTreeMap<u32, Vec<u8>> = BTreeMap::new();
    blocks.insert(0x00030001, vec![0; 8]);
    let floats = [62.0f32, 289.0, 76.8, 46.08, 10.0, 5.0, 55.58, 21.57];
    blocks.insert(0x00050005, floats.iter().flat_map(|f| f.to_le_bytes()).collect());
    blocks.insert(0x00070001, vec![1]);
    blocks.insert(0x00070002, vec![0; 8]);
    blocks.insert(0x00090000, vec![0; 8]);
    blocks.insert(0x00090001, vec![0; 8]);
    let mut name: Vec<u8> = "Banc".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    name.resize(0x1C, 0);
    blocks.insert(0x000A0000, name);
    blocks.insert(0x000A0001, vec![1, 1]);
    blocks.insert(0x000A0002, vec![2]);
    blocks.insert(0x000B0000, vec![0, 0, 2, 77]);
    blocks.insert(0x000B0001, vec![0; 0x800]);
    blocks.insert(0x000B0002, vec![0; 0x800]);
    blocks.insert(0x000B0003, vec![0; 4]);
    blocks.insert(0x000C0000, vec![0; 0xC0]);
    blocks.insert(0x000C0001, vec![0; 0x14]);
    blocks.insert(0x000D0000, vec![0xFF, 0xFF, 0, 0]);
    blocks.insert(0x00130000, vec![0; 4]);
    blocks
}

pub struct Cfg {
    pub source: String,
    pub blocks: BTreeMap<u32, Vec<u8>>,
    pub region: u32,
}

impl Cfg {
    pub fn new(k: &Kernel) -> Cfg {
        let mut source = "valeurs par défaut du banc".to_string();
        let mut blocks = default_blocks();
        let path = &k.bench.paths.config;
        if path.is_file() {
            if let Ok(data) = std::fs::read(path) {
                blocks.extend(parse_config(&data));
                source = "fichier config de la console".to_string();
            }
        }
        Cfg { source, blocks, region: k.bench.region }
    }

    fn get_config_info_blk2(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let block_id = req.word(2);
        let (address, buffer_size) = req.buffer(3);
        let Some(data) = self.blocks.get(&block_id) else {
            return Reply::with_words(0xD90103FA, &[req.word(3), address]).with_note(format!("bloc {block_id:#010x} inconnu"));
        };
        if buffer_size as usize != data.len() {
            return Reply::with_words(0xD90103EC, &[req.word(3), address]).with_note(format!(
                "bloc {:#010x} : taille {:#x} demandée, {:#x} dans la console", block_id, buffer_size, data.len()));
        }
        let _ = k.memory.write(address, data);
        let shown = hex(&data[..data.len().min(16)]) + if data.len() > 16 { "…" } else { "" };
        Reply::with_words(0, &[req.word(3), address]).with_note(format!("bloc {:#010x} ({}) : {}", block_id,
            self.source, shown))
    }

    fn gen_hash_console_unique(&self, req: &Request) -> Reply {
        let salt = req.word(1) & 0xFFFFF;
        let empty = vec![0u8; 8];
        let seed = self.blocks.get(&0x00090001).unwrap_or(&empty);
        let mut input = seed[..seed.len().min(8)].to_vec();
        input.extend_from_slice(&salt.to_le_bytes());
        let digest = sha256(&input);
        let (low, high) = (le32(&digest, 24), le32(&digest, 28));
        Reply::with_words(0, &[low, high]).with_note(format!("sel {salt:#x}"))
    }

    fn get_region_canada_usa(&self) -> Reply {
        let country = self.blocks.get(&0x000B0000).and_then(|b| b.get(3)).copied().unwrap_or(0);
        let value = if self.region == 1 && (country == 0x12 || country == 0x31) { 1 } else { 0 };
        Reply::with_words(0, &[value])
    }
}

impl Service for Cfg {
    fn name(&self) -> &str {
        "cfg:u"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x0001 => self.get_config_info_blk2(k, req),
            0x0002 => Reply::with_words(0, &[self.region]).with_note(format!("région {}", self.region)),
            0x0003 => self.gen_hash_console_unique(req),
            0x0004 => self.get_region_canada_usa(),
            0x0005 => Reply::with_words(0, &[2]),
            _ => unknown_command(),
        }
    }
}

pub struct Ptm;

impl Service for Ptm {
    fn name(&self) -> &str {
        "ptm:u"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x000B => {
                let (address, size) = req.buffer(4);
                let _ = k.memory.write(address, &vec![0u8; size as usize]);
                Reply::with_words(0, &[req.word(4), address]).with_note(format!("{} heures, toutes à 0 pas", size / 2))
            }
            _ => Reply::with_words(0, &[0, 0]).with_kind("factice"),
        }
    }
}

/// (section, décalage dans la page) : pad, touch, accel, gyro, debug.
pub const HID_SECTIONS: [(&str, usize); 5] = [("pad", 0x000), ("touch", 0x0A8), ("accel", 0x108), ("gyro", 0x158),
                                              ("debug", 0x238)];

pub struct Hid {
    pub shared: ObjId,
    pub events: Vec<ObjId>,
    /// Dernier indice écrit : pad, touch (-1 au départ).
    index: [i32; 2],
    pub buttons: u32,
    pub updates: u64,
}

impl Hid {
    /// Crée un bloc partagé puis cinq événements (dans cet ordre, pour les numéros de série).
    pub fn new(k: &mut Kernel) -> Hid {
        let shared = k.create_shared(0x1000, None, 0, "hid");
        let events = ["boutons", "tactile", "accéléromètre", "gyroscope", "pad de débogage"]
            .iter()
            .map(|n| k.create_event(0, &format!("hid : {n}")))
            .collect();
        for (_, offset) in HID_SECTIONS {
            for word in 0..5 {
                k.shared(shared).w32(offset + 4 * word, 0xFFFF_FFFF);
            }
        }
        Hid { shared, events, index: [-1, -1], buttons: 0, updates: 0 }
    }

    fn push(&mut self, k: &Kernel, section: usize, entry_offset: usize, entry_size: usize, count: i32, entry: &[u8]) {
        let base = HID_SECTIONS[section].1;
        let shared = k.shared(self.shared);
        let now = k.ticks();
        let index = (self.index[section] + 1) % count;
        if index == 0 {
            shared.w32(base + 8, shared.u32(base));
            shared.w32(base + 0xC, shared.u32(base + 4));
        }
        shared.write(base + entry_offset + index as usize * entry_size, entry);
        shared.w32(base, (now & 0xFFFF_FFFF) as u32);
        shared.w32(base + 4, (now >> 32) as u32);
        shared.w32(base + 0x10, index as u32);
        self.index[section] = index;
    }

    /// Une lecture des périphériques : aucun bouton, pas de toucher (appelé à chaque fin d'image).
    pub fn update(&mut self, k: &Kernel) {
        self.updates += 1;
        let held = self.buttons;
        let mut pad = Vec::new();
        for word in [held, 0, 0] {
            pad.extend_from_slice(&word.to_le_bytes());
        }
        pad.extend_from_slice(&[0, 0, 0, 0]);
        self.push(k, 0, 0x28, 0x10, 8, &pad);
        self.push(k, 1, 0x20, 8, 8, &[0u8; 8]);
    }
}

impl Service for Hid {
    fn name(&self) -> &str {
        "hid:USER"
    }

    fn kind(&self) -> &'static str {
        "simplifié"
    }

    fn handle(&mut self, _k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x000A => {
                let mut objects = vec![self.shared];
                objects.extend_from_slice(&self.events);
                Reply::new(0).copy_handles(&objects)
            }
            0x0011..=0x0014 => Reply::new(0),
            0x0015 => Reply::with_words(0, &[0x41660000]),
            0x0016 => {
                // Zéro à 0, références ±6700 sur chaque axe : deux valeurs différentes, le jeu ne divise pas par zéro.
                let mut raw = Vec::new();
                for _ in 0..3 {
                    for value in [0i16, 6700, -6700] {
                        raw.extend_from_slice(&value.to_le_bytes());
                    }
                }
                raw.extend_from_slice(&[0, 0]);
                let words: Vec<u32> = (0..5).map(|i| le32(&raw, 4 * i)).collect();
                Reply::with_words(0, &words)
            }
            _ => unknown_command(),
        }
    }
}

pub struct ErrF;

impl Service for ErrF {
    fn name(&self) -> &str {
        "err:f"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x0001 => {
                let info = k.memory.read(req.cmdbuf + 4, 0x80).unwrap_or_else(|_| vec![0; 0x80]);
                let (kind, result, address, pid) = (info[0], le32(&info, 4), le32(&info, 8), le32(&info, 12));
                let function = k.journal.names.function(address);
                let text = format!("erreur fatale du jeu : genre {}, code {:#010x}, à {:#x} ({}), processus {:#x}", kind,
                    result, address, if function.is_empty() { "?" } else { &function }, pid);
                k.request_stop(&text);
                Reply::new(0).with_note(text)
            }
            _ => unknown_command(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    use kernel::kernel::SHARED_PAGE;
    use kernel::memory::PERM_RW;
    use kernel::testing::{call, header, test_kernel, test_main_thread};

    const BUFFERS: u32 = 0x0200_0000;

    fn setup() -> (Kernel, ObjId) {
        let (mut k, _script) = test_kernel();
        let thread = test_main_thread(&mut k);
        k.memory.map(BUFFERS, 0x10000, PERM_RW, "tampons", None).unwrap();
        (k, thread)
    }

    fn session(k: &mut Kernel, service: Rc<RefCell<dyn Service>>, name: &str) -> ObjId {
        k.new_session(service, name)
    }

    fn lines(k: &Kernel) -> Vec<String> {
        k.journal.capture.clone().unwrap()
    }

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(cro::sha256::hex(&sha256(b"abc")),
                   "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(cro::sha256::hex(&sha256(b"")),
                   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn parse_config_reads_small_and_large_blocks() {
        // 2 blocs : un petit (2 octets dans la case) et un grand (6 octets à l'adresse 0x20 du fichier)
        let mut file = vec![0u8; 0x30];
        file[0..2].copy_from_slice(&2u16.to_le_bytes());
        file[2..4].copy_from_slice(&0x1Cu16.to_le_bytes());
        file[4..8].copy_from_slice(&0x000A0001u32.to_le_bytes());
        file[8..12].copy_from_slice(&0x0000_0201u32.to_le_bytes());
        file[12..14].copy_from_slice(&2u16.to_le_bytes());
        file[16..20].copy_from_slice(&0x000B0001u32.to_le_bytes());
        file[20..24].copy_from_slice(&0x20u32.to_le_bytes());
        file[24..26].copy_from_slice(&6u16.to_le_bytes());
        file[0x20..0x26].copy_from_slice(&[9, 8, 7, 6, 5, 4]);
        let blocks = parse_config(&file);
        assert_eq!(blocks[&0x000A0001], vec![1, 2]);
        assert_eq!(blocks[&0x000B0001], vec![9, 8, 7, 6, 5, 4]);
        assert_eq!(blocks.len(), 2);
        assert!(parse_config(&[1]).is_empty());
    }

    #[test]
    fn cfg_reads_the_console_file_when_present() {
        let (mut k, _) = setup();
        let mut file = vec![0u8; 0x20];
        file[0..2].copy_from_slice(&1u16.to_le_bytes());
        file[4..8].copy_from_slice(&0x000A0002u32.to_le_bytes());
        file[8..12].copy_from_slice(&5u32.to_le_bytes());
        file[12..14].copy_from_slice(&1u16.to_le_bytes());
        let path = std::env::temp_dir().join(format!("cfg-test-{}.bin", std::process::id()));
        std::fs::write(&path, &file).unwrap();
        k.bench.paths.config = path.clone();
        let cfg = Cfg::new(&k);
        let _ = std::fs::remove_file(&path);
        assert_eq!(cfg.source, "fichier config de la console");
        assert_eq!(cfg.blocks[&0x000A0002], vec![5]);
        assert_eq!(cfg.blocks[&0x00130000], vec![0; 4]);
        let (k2, _) = setup();
        assert_eq!(Cfg::new(&k2).source, "valeurs par défaut du banc");
    }

    #[test]
    fn cfg_blocks_and_errors() {
        let (mut k, t) = setup();
        let cfg: Rc<RefCell<dyn Service>> = Rc::new(RefCell::new(Cfg::new(&k)));
        let s = session(&mut k, cfg, "cfg:u");
        let command = |id: u32, size: u32| vec![header(1, 2, 2), size, id, size << 4 | 0xC, BUFFERS];
        // bloc connu, bonne taille
        let reply = call(&mut k, t, s, &command(0x000A0001, 2));
        assert_eq!(reply[1], 0);
        assert_eq!(reply[2], 2 << 4 | 0xC);
        assert_eq!(reply[3], BUFFERS);
        assert_eq!(k.memory.read(BUFFERS, 2).unwrap(), vec![1, 1]);
        assert!(lines(&k).last().unwrap().contains("bloc 0x000a0001 (valeurs par défaut du banc) : 0101"));
        // mauvaise taille
        let reply = call(&mut k, t, s, &command(0x000A0001, 4));
        assert_eq!(reply[1], 0xD90103EC);
        assert!(lines(&k).last().unwrap().contains("bloc 0x000a0001 : taille 0x4 demandée, 0x2 dans la console"));
        // bloc inconnu
        let reply = call(&mut k, t, s, &command(0x00FF0000, 4));
        assert_eq!(reply[1], 0xD90103FA);
        assert!(lines(&k).last().unwrap().contains("bloc 0x00ff0000 inconnu"));
        // un grand bloc : la note coupe à 16 octets
        let reply = call(&mut k, t, s, &command(0x00050005, 32));
        assert_eq!(reply[1], 0);
        assert!(lines(&k).last().unwrap().contains("…"));
        // commande inconnue
        assert_eq!(call(&mut k, t, s, &[header(0x77, 0, 0)])[1], 0xD900182F);
    }

    #[test]
    fn cfg_region_model_and_hash() {
        let (mut k, t) = setup();
        k.bench.region = 1;
        let cfg = Rc::new(RefCell::new(Cfg::new(&k)));
        let s = session(&mut k, cfg.clone(), "cfg:u");
        assert_eq!(call(&mut k, t, s, &[header(2, 0, 0)])[2], 1);
        assert!(lines(&k).last().unwrap().contains("région 1"));
        assert_eq!(call(&mut k, t, s, &[header(5, 0, 0)])[2], 2);
        // pays 0x4D : pas Canada/USA ; avec 0x12 oui (région 1)
        assert_eq!(call(&mut k, t, s, &[header(4, 0, 0)])[2], 0);
        cfg.borrow_mut().blocks.insert(0x000B0000, vec![0, 0, 2, 0x12]);
        assert_eq!(call(&mut k, t, s, &[header(4, 0, 0)])[2], 1);
        // GenHashConsoleUnique : valeurs calculées en Python avec hashlib.sha256(graine[:8] + pack('<I', sel))
        let reply = call(&mut k, t, s, &[header(3, 1, 0), 7]);
        assert_eq!((reply[2], reply[3]), (1893534544, 513910476));
        assert!(lines(&k).last().unwrap().contains("sel 0x7"));
        cfg.borrow_mut().blocks.insert(0x00090001, (1..=8).collect());
        let reply = call(&mut k, t, s, &[header(3, 1, 0), 0xFFF12345]);
        assert_eq!((reply[2], reply[3]), (2869528517, 3106994603));
        assert!(lines(&k).last().unwrap().contains("sel 0x12345"));
    }

    #[test]
    fn ptm_step_history_and_unknown() {
        let (mut k, t) = setup();
        let s = session(&mut k, Rc::new(RefCell::new(Ptm)), "ptm:u");
        k.memory.write(BUFFERS, &[0xAA; 16]).unwrap();
        let reply = call(&mut k, t, s, &[header(0x0B, 3, 2), 0, 0, 0, 8 << 4 | 0xC, BUFFERS]);
        assert_eq!(reply[1], 0);
        assert_eq!(reply[2], 8 << 4 | 0xC);
        assert_eq!(reply[3], BUFFERS);
        assert_eq!(k.memory.read(BUFFERS, 10).unwrap(), vec![0, 0, 0, 0, 0, 0, 0, 0, 0xAA, 0xAA]);
        assert!(lines(&k).last().unwrap().contains("(réel)"));
        assert!(lines(&k).last().unwrap().contains("« 4 heures, toutes à 0 pas »"));
        let reply = call(&mut k, t, s, &[header(0x99, 0, 0)]);
        assert_eq!(&reply[1..], &[0, 0, 0]);
        assert!(lines(&k).last().unwrap().contains("(factice)"));
    }

    #[test]
    fn hid_objects_handles_and_constants() {
        let (mut k, t) = setup();
        let base = k.objects.last().unwrap().serial;
        let hid = Hid::new(&mut k);
        // 1 bloc puis 5 événements, dans l ordre
        assert_eq!(k.objects[hid.shared].serial, base + 1);
        let serials: Vec<u64> = hid.events.iter().map(|&e| k.objects[e].serial).collect();
        assert_eq!(serials, (base + 2..=base + 6).collect::<Vec<u64>>());
        assert_eq!(k.objects[hid.events[4]].name, "hid : pad de débogage");
        for (_, offset) in HID_SECTIONS {
            assert_eq!(k.shared(hid.shared).u32(offset + 0x10), 0xFFFF_FFFF);
        }
        let s = session(&mut k, Rc::new(RefCell::new(hid)), "hid:USER");
        let reply = call(&mut k, t, s, &[header(0x0A, 0, 0)]);
        assert_eq!(reply[0], header(0x0A, 1, 7));
        assert_eq!(reply[2], 5 << 26);
        assert!(reply[3..].iter().all(|&h| h != 0));
        assert_eq!(call(&mut k, t, s, &[header(0x15, 0, 0)])[2], 0x41660000);
        let reply = call(&mut k, t, s, &[header(0x16, 0, 0)]);
        assert_eq!(&reply[2..], &[0x1a2c0000, 0xe5d4, 0xe5d41a2c, 0x1a2c0000, 0xe5d4]);
        for command in 0x11..=0x14 {
            assert_eq!(call(&mut k, t, s, &[header(command, 0, 0)])[1], 0);
        }
        assert_eq!(call(&mut k, t, s, &[header(0x40, 0, 0)])[1], 0xD900182F);
    }

    #[test]
    fn hid_shared_page_after_two_updates() {
        let (mut k, _) = setup();
        let mut hid = Hid::new(&mut k);
        let page = hid.shared;
        k.now = 1_000_000_000;
        hid.update(&k);
        let t1 = k.ticks();
        assert_eq!(t1, 268_111_856);
        let word = |k: &Kernel, offset: usize| k.shared(page).u32(offset);
        // première mise à jour : indice 0, les anciennes dates (tout à 1) recopiées en +8/+0xC
        assert_eq!(word(&k, 0), t1 as u32);
        assert_eq!(word(&k, 4), (t1 >> 32) as u32);
        assert_eq!(word(&k, 8), 0xFFFF_FFFF);
        assert_eq!(word(&k, 0xC), 0xFFFF_FFFF);
        assert_eq!(word(&k, 0x10), 0);
        assert_eq!(word(&k, 0x28), 0);
        assert_eq!(word(&k, 0xA8 + 0x10), 0);
        // seconde mise à jour avec un bouton tenu, plus tard
        k.now = 3_000_000_000;
        hid.buttons = 0x8;
        hid.update(&k);
        let t2 = k.ticks();
        assert_eq!(hid.updates, 2);
        assert_eq!(word(&k, 0), t2 as u32);
        assert_eq!(word(&k, 0x10), 1);
        assert_eq!(word(&k, 0x28 + 0x10), 0x8);
        assert_eq!(word(&k, 0x28), 0);
        assert_eq!(word(&k, 0xA8), t2 as u32);
        assert_eq!(word(&k, 0xA8 + 0x10), 1);
        // le tampon circulaire revient à 0 au 9e et recopie la date précédente
        for _ in 0..6 {
            k.now += 1_000_000_000;
            hid.update(&k);
        }
        let before = k.ticks();
        k.now += 1_000_000_000;
        hid.update(&k);
        assert_eq!(word(&k, 0x10), 0);
        assert_eq!(word(&k, 8), before as u32);
        assert_eq!(word(&k, 0), k.ticks() as u32);
        // les sections accéléromètre, gyroscope, débogage ne bougent pas
        assert_eq!(word(&k, 0x108), 0xFFFF_FFFF);
    }

    #[test]
    fn errf_stops_the_bench() {
        let (mut k, t) = setup();
        let s = session(&mut k, Rc::new(RefCell::new(ErrF)), "err:f");
        let mut words = vec![header(1, 0x20, 0), 2, 0xC8804464, 0x123456, 0x30];
        words.resize(33, 0);
        let reply = call(&mut k, t, s, &words);
        assert_eq!(reply[1], 0);
        let stop = k.bench.stop_request.clone().unwrap();
        assert!(stop.starts_with("erreur fatale du jeu : genre 2, code 0xc8804464, à 0x123456 ("), "{stop}");
        assert!(stop.ends_with("), processus 0x30"), "{stop}");
        assert!(lines(&k).last().unwrap().contains(&stop));
        let _ = SHARED_PAGE;
    }
}
