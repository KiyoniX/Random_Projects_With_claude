//! `gsp::Gpu` : le droit d'affichage, la file de commandes graphiques, les interruptions relayées (contrat de gsp).
//! Port de `banc/services/gsp.py`, sans la partie dessin (`pica/`, `--dessiner`).
//!
//! Réel :
//! - la page de mémoire partagée (zone des interruptions, tampons d'écran, file de commandes) au format du contrat ;
//! - RegisterInterruptRelayQueue rend 0 (pas 0x2A07 : le jeu ne programme pas lui-même les écrans) ;
//! - la file : à TriggerCmdReqQueue et après chaque commande, le banc vide la file et dépose l'interruption de fin
//!   (6 transfert mémoire, 5 liste de commandes, 0 ou 1 remplissage — une seule —, 4 transfert ou copie, rien pour 5) ;
//! - les fins d'image : toutes les 1/60 s du banc, les interruptions 2 et 3 (écran du haut, du bas), après avoir pris
//!   la description d'image que le jeu a annoncée.
//!
//! Les listes de commandes PICA sont toujours lues et comptées (nombre, taille, registres visés, ordres de dessin) ; ici
//! rien n'est dessiné. Les transferts mémoire et les remplissages sont faits pour de bon. Les transferts vers l'écran
//! (tuiles, formats, réduction, retournement) et les copies de texture appartiennent à la crate `pica` : le service
//! offre deux crochets (`display_transfer`, `texture_copy`) que l'assemblage du portage peut brancher ; sans crochet, la
//! ligne du journal porte « non fait par le portage » (seul écart du journal avec celui du banc Python).

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::{Rc, Weak};

use kernel::ipc::{Reply, Request, Service, unknown_command};
use kernel::kernel::{Kernel, SHARED_PAGE};
use kernel::object::ObjId;

use crate::small::Hid;

pub const VBLANK_NS: u64 = 16_715_000;
pub const RELAY: usize = 0x000;
pub const QUEUE: usize = 0x800;
pub const FRAMEBUFFERS: usize = 0x200;
/// Garde-fou contre une boucle ; le terrain chaîne jusqu'à 2 200 sauts dans une seule commande.
pub const MAX_JUMPS: usize = 20000;
/// Adresses physiques que le GPU lit dans les registres de saut -> adresses du jeu : (début, fin, adresse du jeu du début).
pub const PHYSICAL_RANGES: [(u64, u64, u64); 2] = [(0x2000_0000, 0x2800_0000, 0x1400_0000),
                                                   (0x1800_0000, 0x1860_0000, 0x1F00_0000)];

pub fn interrupt_name(interrupt: u32) -> &'static str {
    match interrupt {
        0 => "PSC0",
        1 => "PSC1",
        2 => "PDC0 (fin d'image du haut)",
        3 => "PDC1 (fin d'image du bas)",
        4 => "PPF",
        5 => "P3D",
        6 => "DMA",
        _ => "?",
    }
}

pub fn command_name(command: u32) -> String {
    match command {
        0 => "RequestDma".to_string(),
        1 => "ProcessCommandList".to_string(),
        2 => "MemoryFill".to_string(),
        3 => "DisplayTransfer".to_string(),
        4 => "TextureCopy".to_string(),
        5 => "FlushCacheRegions".to_string(),
        n => format!("commande {n}"),
    }
}

pub fn format_name(format: u32) -> &'static str {
    match format {
        0 => "RGBA8",
        1 => "RGB8",
        2 => "RGB565",
        3 => "RGB5A1",
        4 => "RGBA4",
        _ => "?",
    }
}

fn draw_register_name(register: u32) -> Option<&'static str> {
    match register {
        0x022E => Some("DrawArrays"),
        0x022F => Some("DrawElements"),
        _ => None,
    }
}

fn bump(stats: &mut BTreeMap<String, u64>, key: &str, add: u64) {
    *stats.entry(key.to_string()).or_insert(0) += add;
}

/// Les listes se chaînent par les registres de saut du processeur de commandes (0x238/0x239 taille, 0x23A/0x23B
/// adresse physique, tous deux en unités de 8 octets ; l'écriture de 0x23C ou 0x23D déclenche le saut) : le reste
/// du tampon courant est abandonné et la lecture continue dans le tampon visé. Le jeu y range ses modèles prêts
/// à dessiner ; sans cela le banc ne voyait aucun ordre de dessin du terrain. Rend les octets mis bout à bout.
/// `read(adresse, taille)` lit la mémoire du jeu (`None` si illisible).
pub fn follow_jumps(read: &mut dyn FnMut(u32, u32) -> Option<Vec<u8>>, data: &[u8],
                    stats: Option<&mut BTreeMap<String, u64>>) -> Vec<u8> {
    let mut scratch = BTreeMap::new();
    let stats = stats.unwrap_or(&mut scratch);
    let mut out: Vec<u8> = Vec::new();
    let mut regs: BTreeMap<u32, u32> = BTreeMap::new();
    let mut data = data.to_vec();
    for _ in 0..=MAX_JUMPS {
        let words: Vec<u32> = data.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        let mut i = 0usize;
        let mut target: Option<u32> = None;
        while i + 1 < words.len() && target.is_none() {
            let header = words[i + 1];
            let register = header & 0xFFFF;
            let extra = (header >> 20 & 0x7FF) as usize;
            let consecutive = header >> 31 != 0;
            if i + 2 + extra > words.len() {
                // paquet coupé par la fin du tampon : on l'ignore
                i = words.len();
                break;
            }
            for k in 0..=extra {
                let reg = register + if consecutive { k as u32 } else { 0 };
                let value = if k == 0 { words[i] } else { words[i + 1 + k] };
                regs.insert(reg, value);
                if (reg == 0x23C || reg == 0x23D) && value & 1 != 0 {
                    target = Some(reg - 0x23C);
                }
            }
            i += 2 + extra + (extra & 1);
        }
        let Some(t) = target else {
            out.extend_from_slice(&data);
            break;
        };
        out.extend_from_slice(&data[..(i * 4).min(data.len())]);
        let physical = regs.get(&(0x23A + t)).copied().unwrap_or(0) as u64 * 8;
        let size = regs.get(&(0x238 + t)).copied().unwrap_or(0) as u64 * 8;
        let address = PHYSICAL_RANGES.iter()
            .find(|(low, high, _)| *low <= physical && physical < *high)
            .map(|(low, _, virt)| virt + physical - low)
            .unwrap_or(0);
        let next = if address != 0 && size != 0 && address + size <= 0x1_0000_0000 {
            read(address as u32, size as u32).unwrap_or_default()
        } else {
            Vec::new()
        };
        if next.is_empty() {
            bump(stats, "sauts de liste vers une adresse illisible", 1);
            break;
        }
        data = next;
        bump(stats, "sauts de liste suivis", 1);
    }
    out
}

/// Crochet d'un transfert vers l'écran : reçoit les mots 1 à 5 de la commande (source, destination, dimensions en
/// entrée, en sortie, drapeaux) et rend le problème (chaîne vide si tout va bien).
pub type DisplayTransferHook = Box<dyn FnMut(&mut Kernel, [u32; 5]) -> String>;
/// Crochet d'une copie de texture : reçoit les mots 1 à 6 (source, destination, taille, lignes en entrée, en sortie,
/// drapeaux) et rend une erreur éventuelle.
pub type TextureCopyHook = Box<dyn FnMut(&mut Kernel, [u32; 6]) -> Result<(), String>>;

pub struct Gsp {
    me: Weak<RefCell<Gsp>>,
    hid: Rc<RefCell<Hid>>,
    /// Le bloc partagé (créé à l'inscription au relais).
    pub shared: Option<ObjId>,
    pub event: Option<ObjId>,
    pub right: bool,
    pub first_result: u32,
    pub stats: BTreeMap<String, u64>,
    pub registers: BTreeMap<u32, u64>,
    /// (heure, adresse, taille, écritures de registres, dessins)
    pub lists: Vec<(u64, u32, u32, u64, u64)>,
    /// écran -> [(heure, adresse, format, largeur de ligne)]
    pub frames: [Vec<(u64, u32, u32, u32)>; 2],
    /// écran -> (adresse, format, largeur de ligne) de la dernière image annoncée
    pub current: [Option<(u32, u32, u32)>; 2],
    pub vblank_count: u64,
    pub black: Option<u32>,
    pub hw_writes: Vec<(u32, Vec<u8>)>,
    pub unknown_ops: Vec<[u32; 8]>,
    pub transfers: u64,
    /// écran -> (adresse, format, octets par colonne) du dernier transfert fait
    pub latest_transfer: BTreeMap<u32, (u32, u32, u32)>,
    pub display_transfer: Option<DisplayTransferHook>,
    pub texture_copy: Option<TextureCopyHook>,
}

impl Gsp {
    /// Aucun objet du noyau à la construction. Pour que les fins d'image puissent se replanifier, le service doit vivre
    /// dans un `Rc<RefCell<_>>` : voir `new_shared`.
    pub fn new(k: &Kernel, hid: Rc<RefCell<Hid>>) -> Gsp {
        Gsp {
            me: Weak::new(),
            hid,
            shared: None,
            event: None,
            right: false,
            first_result: k.bench.gsp_first_result,
            stats: BTreeMap::new(),
            registers: BTreeMap::new(),
            lists: Vec::new(),
            frames: [Vec::new(), Vec::new()],
            current: [None, None],
            vblank_count: 0,
            black: None,
            hw_writes: Vec::new(),
            unknown_ops: Vec::new(),
            transfers: 0,
            latest_transfer: BTreeMap::new(),
            display_transfer: None,
            texture_copy: None,
        }
    }

    /// `new` rangé dans un `Rc<RefCell<_>>` qui se connaît lui-même (nécessaire aux fins d'image).
    pub fn new_shared(k: &Kernel, hid: Rc<RefCell<Hid>>) -> Rc<RefCell<Gsp>> {
        let gsp = Rc::new(RefCell::new(Gsp::new(k, hid)));
        gsp.borrow_mut().me = Rc::downgrade(&gsp);
        gsp
    }

    fn schedule_vblank(&self, k: &mut Kernel) {
        let me = self.me.clone();
        let when = k.now + VBLANK_NS;
        k.schedule(when, Box::new(move |k: &mut Kernel| {
            if let Some(gsp) = me.upgrade() {
                Gsp::vblank(&gsp, k);
            }
        }));
    }

    fn acquire_right(&mut self, k: &mut Kernel) -> Reply {
        self.right = true;
        if let Some(shared) = self.shared {
            for screen in 0..2 {
                k.shared(shared).write(FRAMEBUFFERS + 0x40 * screen + 1, &[0]);
            }
        }
        Reply::new(0)
    }

    fn register_interrupt_relay_queue(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let objects = req.handle_objects(2);
        self.event = objects.first().copied().flatten();
        let shared = match self.shared {
            Some(s) => s,
            None => {
                let s = k.create_shared(0x1000, None, 0, "gsp");
                self.shared = Some(s);
                s
            }
        };
        for word in 0..3 {
            k.shared(shared).w32(RELAY + 4 * word, 0);
        }
        self.schedule_vblank(k);
        k.on_gsp_registered();
        let signal = self.event.map(|e| k.label(e)).unwrap_or_else(|| "?".to_string());
        Reply::with_words(self.first_result, &[0]).copy_handles(&[shared]).with_note(format!(
            "drapeaux {:#x}, client 0, signal {}, réponse {:#x}", req.word(1), signal, self.first_result))
    }

    fn set_lcd_force_black(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let black = req.word(1) & 0xFF;
        self.black = Some(black);
        k.on_lcd_force_black(black);
        Reply::new(0).with_note(if black != 0 { "écrans au noir" } else { "le noir est levé : l'image devient visible" })
    }

    fn write_hw_regs(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (address, size) = req.buffer(3);
        let data = if size != 0 { k.memory.read(address, size).unwrap_or_default() } else { Vec::new() };
        let hex: String = data.iter().map(|b| format!("{b:02x}")).collect();
        self.hw_writes.push((req.word(1), data));
        Reply::new(0).with_note(format!("registre {:#x} + 0x1EB00000 <- {}", req.word(1), hex))
    }

    fn read_hw_regs(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (_, room) = req.receive_buffer(k, 0);
        let size = room.min(req.word(2)) as usize;
        Reply::new(0).static_buffer(0, &vec![0u8; size]).with_note(format!("registre {:#x} : zéros", req.word(1)))
    }

    fn import_display_capture_info(&mut self) -> Reply {
        let mut words = Vec::new();
        for screen in 0..2 {
            let info = self.current[screen].unwrap_or((0, 0, 0));
            words.extend_from_slice(&[info.0, info.0, info.1, info.2]);
        }
        Reply::with_words(0, &words)
    }

    fn trigger_cmd_req_queue(&mut self, k: &mut Kernel) -> Reply {
        let done = self.process_queue(k);
        Reply::new(0).with_note(format!("{} commande(s) traitée(s) : {}", done.len(), done.join(", ")))
    }

    // --- la zone des interruptions ---

    pub fn deposit(&mut self, k: &mut Kernel, interrupt: u32) {
        let (Some(shared), Some(event)) = (self.shared, self.event) else { return };
        if (interrupt == 2 || interrupt == 3) && k.shared(shared).u8(RELAY + 3) & 1 != 0 {
            return;
        }
        let (index, count) = (k.shared(shared).u8(RELAY) as usize, k.shared(shared).u8(RELAY + 1) as usize);
        if count >= 0x34 {
            k.shared(shared).write(RELAY + 2, &[1]);
            return;
        }
        k.shared(shared).write(RELAY + 0xC + (index + count) % 0x34, &[interrupt as u8]);
        k.shared(shared).write(RELAY + 1, &[(count + 1) as u8]);
        bump(&mut self.stats, &format!("interruption {} {}", interrupt, interrupt_name(interrupt)), 1);
        k.signal_event(event);
    }

    // --- la file de commandes ---

    pub fn process_queue(&mut self, k: &mut Kernel) -> Vec<String> {
        let mut done = Vec::new();
        while let Some(shared) = self.shared {
            let (index, count) = (k.shared(shared).u8(QUEUE) as usize, k.shared(shared).u8(QUEUE + 1));
            if count == 0 {
                break;
            }
            let slot = QUEUE + 0x20 + index * 0x20;
            let raw = k.shared(shared).read(slot, 0x20);
            let mut words = [0u32; 8];
            for (i, word) in words.iter_mut().enumerate() {
                *word = u32::from_le_bytes([raw[4 * i], raw[4 * i + 1], raw[4 * i + 2], raw[4 * i + 3]]);
            }
            k.shared(shared).write(QUEUE, &[((index + 1) % 15) as u8, count.wrapping_sub(1)]);
            done.push(self.execute_command(k, words));
        }
        done
    }

    pub fn execute_command(&mut self, k: &mut Kernel, words: [u32; 8]) -> String {
        let command = words[0] & 0xFF;
        let name = command_name(command);
        bump(&mut self.stats, &name, 1);
        match command {
            0 => {
                let (source, destination, size) = (words[1], words[2], words[3]);
                let copy = k.memory.read(source, size).and_then(|data| k.memory.write(destination, &data));
                if let Err(exc) = copy {
                    let text = format!("gsp : transfert mémoire {source:#x} -> {destination:#x} refusé ({exc})");
                    k.journal.write(k.now, &text);
                }
                let text = format!("gsp file : RequestDma {source:#x} -> {destination:#x}, {size:#x} octets");
                k.journal.write(k.now, &text);
                self.deposit(k, 6);
            }
            1 => {
                let (address, size) = (words[1], words[2]);
                let summary = self.read_command_list(k, address, size);
                let text = format!("gsp file : ProcessCommandList {address:#x}, {size:#x} octets : {summary}");
                k.journal.write(k.now, &text);
                self.deposit(k, 5);
                k.on_command_list();
            }
            2 => {
                let zones = [(words[1], words[2], words[3], words[7] & 0xFFFF),
                             (words[4], words[5], words[6], words[7] >> 16)];
                let mut texts: Vec<String> = Vec::new();
                for (start, value, end, control) in zones {
                    if start == 0 {
                        continue;
                    }
                    let width = ((control >> 8) & 3).min(2) as usize;
                    let pattern_len = [2usize, 3, 4][width];
                    let pattern = &value.to_le_bytes()[..pattern_len];
                    let size = end as i64 - start as i64;
                    if size > 0 {
                        if size > 0x2000_0000 {
                            texts.push(format!("refusé (remplissage de {size:#x} octets)"));
                        } else {
                            let bytes: Vec<u8> = pattern.iter().copied().cycle().take(size as usize).collect();
                            if let Err(exc) = k.memory.write(start, &bytes) {
                                texts.push(format!("refusé ({exc})"));
                            }
                        }
                    }
                    texts.push(format!("{:#x}-{:#x} <- {:#x} ({} bits)", start, end, value, [16, 24, 32][width]));
                }
                let text = format!("gsp file : MemoryFill {}", texts.join(" ; "));
                k.journal.write(k.now, &text);
                self.deposit(k, if words[1] != 0 { 0 } else { 1 });
            }
            3 => {
                let (source, destination, in_dim, out_dim, flags) = (words[1], words[2], words[3], words[4], words[5]);
                self.transfers += 1;
                let problem = match self.display_transfer.take() {
                    Some(mut hook) => {
                        let problem = hook(k, [source, destination, in_dim, out_dim, flags]);
                        self.display_transfer = Some(hook);
                        if problem.is_empty() && out_dim & 0xFFFF == 240 {
                            let unit = match flags >> 12 & 7 {
                                0 => 4,
                                1 => 3,
                                _ => 2,
                            };
                            self.latest_transfer.insert(if out_dim >> 16 == 400 { 0 } else { 1 },
                                                        (destination, flags >> 12 & 7, 240 * unit));
                        }
                        problem
                    }
                    None => "non fait par le portage".to_string(),
                };
                bump(&mut self.stats, "transferts vers écran faits", if problem.is_empty() { 1 } else { 0 });
                let text = format!("gsp file : DisplayTransfer {:#x} ({}x{}, {}) -> {:#x} ({}x{}, {}), drapeaux {:#x}{}",
                    source, in_dim & 0xFFFF, in_dim >> 16, format_name(flags >> 8 & 7), destination,
                    out_dim & 0xFFFF, out_dim >> 16, format_name(flags >> 12 & 7), flags,
                    if problem.is_empty() { String::new() } else { format!(" : {problem}") });
                k.journal.write(k.now, &text);
                self.deposit(k, 4);
            }
            4 => {
                let (source, destination, size, in_dim, out_dim, flags) =
                    (words[1], words[2], words[3], words[4], words[5], words[6]);
                let result = match self.texture_copy.take() {
                    Some(mut hook) => {
                        let result = hook(k, [source, destination, size, in_dim, out_dim, flags]);
                        self.texture_copy = Some(hook);
                        result
                    }
                    None => Err("non fait par le portage".to_string()),
                };
                if let Err(exc) = result {
                    let text = format!("gsp : copie de texture refusée ({exc})");
                    k.journal.write(k.now, &text);
                }
                let text = format!("gsp file : TextureCopy {source:#x} -> {destination:#x}, {size:#x} octets, lignes {in_dim:#x}/{out_dim:#x}");
                k.journal.write(k.now, &text);
                self.deposit(k, 4);
            }
            5 => {}
            _ => self.unknown_ops.push(words),
        }
        name
    }

    /// Suit les sauts d'une liste (voir `follow_jumps`) en lisant la mémoire du jeu.
    pub fn follow_jumps(&mut self, k: &Kernel, data: &[u8]) -> Vec<u8> {
        let mut read = |address: u32, size: u32| k.memory.read(address, size).ok();
        follow_jumps(&mut read, data, Some(&mut self.stats))
    }

    /// Lit et compte une liste de commandes PICA : rend le résumé du journal.
    pub fn read_command_list(&mut self, k: &Kernel, address: u32, size: u32) -> String {
        let data = match k.memory.read(address, size) {
            Ok(data) => data,
            Err(exc) => {
                self.lists.push((k.now, address, size, 0, 0));
                return format!("illisible ({exc})");
            }
        };
        let data = self.follow_jumps(k, &data);
        let words: Vec<u32> = data.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        let mut i = 0usize;
        let mut writes = 0u64;
        let mut draws: Vec<(&'static str, u64)> = Vec::new();
        while i + 1 < words.len() {
            let header = words[i + 1];
            let register = header & 0xFFFF;
            let extra = (header >> 20 & 0x7FF) as usize;
            let consecutive = header >> 31 != 0;
            for n in 0..=extra {
                let reg = register + if consecutive { n as u32 } else { 0 };
                *self.registers.entry(reg).or_insert(0) += 1;
                writes += 1;
                if let Some(name) = draw_register_name(reg) {
                    match draws.iter_mut().find(|(d, _)| *d == name) {
                        Some(entry) => entry.1 += 1,
                        None => draws.push((name, 1)),
                    }
                }
            }
            i += 2 + extra + (extra & 1);
        }
        self.lists.push((k.now, address, size, writes, draws.iter().map(|d| d.1).sum()));
        let shown = if draws.is_empty() {
            "aucun".to_string()
        } else {
            let items: Vec<String> = draws.iter().map(|(n, c)| format!("'{n}': {c}")).collect();
            format!("{{{}}}", items.join(", "))
        };
        format!("{writes} écritures de registres, dessins : {shown}")
    }

    // --- les fins d'image ---

    pub fn take_framebuffer(&mut self, k: &mut Kernel, screen: usize) {
        let Some(shared) = self.shared else { return };
        let base = FRAMEBUFFERS + 0x40 * screen;
        if k.shared(shared).u8(base + 1) == 0 {
            return;
        }
        let which = (k.shared(shared).u8(base) & 1) as usize;
        let raw = k.shared(shared).read(base + 4 + 0x1C * which, 0x1C);
        let word = |i: usize| u32::from_le_bytes([raw[4 * i], raw[4 * i + 1], raw[4 * i + 2], raw[4 * i + 3]]);
        let (left, stride, format) = (word(1), word(3), word(4));
        k.shared(shared).write(base + 1, &[0]);
        self.current[screen] = Some((left, format, stride));
        self.frames[screen].push((k.now, left, format, stride));
        if self.frames[screen].len() <= 3 {
            let text = format!("gsp : image annoncée pour l'écran du {} : {:#x}, {}, ligne de {} octets, format {:#x}",
                if screen == 0 { "haut" } else { "bas" }, left, format_name(format & 7), stride, format);
            k.journal.write(k.now, &text);
        }
    }

    /// Une fin d'image (appelée par l'échéance planifiée) : décrit les images, met à jour la page de `hid`, dépose les
    /// interruptions 2 et 3, vide la file, replanifie.
    pub fn vblank(gsp: &Rc<RefCell<Gsp>>, k: &mut Kernel) {
        let hid = {
            let mut this = gsp.borrow_mut();
            if this.shared.is_none() {
                return;
            }
            this.vblank_count += 1;
            for screen in 0..2 {
                this.take_framebuffer(k, screen);
            }
            this.hid.clone()
        };
        on_vblank(k, &hid);
        let mut this = gsp.borrow_mut();
        this.deposit(k, 2);
        this.deposit(k, 3);
        this.process_queue(k);
        this.schedule_vblank(k);
    }
}

/// `Bench.on_vblank` : les boutons tenus, la mise à jour de la page de `hid`, l'heure de la page partagée du noyau.
pub fn on_vblank(k: &mut Kernel, hid: &Rc<RefCell<Hid>>) {
    k.bench.vblanks += 1;
    let buttons = k.buttons_now();
    let mut hid = hid.borrow_mut();
    if buttons != hid.buttons {
        k.journal.write(k.now, &format!("hid : boutons tenus {buttons:#x}"));
    }
    hid.buttons = buttons;
    hid.update(k);
    // L'heure de la page partagée suit l'horloge du banc.
    let milliseconds = k.bench.start_milliseconds + k.now / 1_000_000;
    let ticks = k.ticks();
    let _ = k.memory.w64(SHARED_PAGE + 0x20, milliseconds);
    let _ = k.memory.w64(SHARED_PAGE + 0x28, ticks);
}

impl Service for Gsp {
    fn name(&self) -> &str {
        "gsp::Gpu"
    }

    fn kind(&self) -> &'static str {
        "simplifié"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x01 | 0x02 => self.write_hw_regs(k, req),
            0x04 => self.read_hw_regs(k, req),
            0x08 | 0x10 | 0x17 | 0x19 | 0x1A => Reply::new(0),
            0x0B => self.set_lcd_force_black(k, req),
            0x0C => self.trigger_cmd_req_queue(k),
            0x13 => self.register_interrupt_relay_queue(k, req),
            0x14 => {
                self.event = None;
                Reply::new(0)
            }
            0x16 => self.acquire_right(k),
            0x18 => self.import_display_capture_info(),
            _ => unknown_command(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use kernel::kernel::SHARED_PAGE;
    use kernel::memory::PERM_RW;
    use kernel::testing::{call, header, test_kernel, test_main_thread};

    const BUFFERS: u32 = 0x0200_0000;
    const LINEAR: u32 = 0x1400_0000;
    const VRAM: u32 = 0x1F00_0000;

    struct Rig {
        k: Kernel,
        thread: ObjId,
        gsp: Rc<RefCell<Gsp>>,
        hid: Rc<RefCell<Hid>>,
        session: ObjId,
        event: ObjId,
    }

    fn rig() -> Rig {
        let (mut k, _script) = test_kernel();
        let thread = test_main_thread(&mut k);
        k.memory.map(BUFFERS, 0x10000, PERM_RW, "tampons", None).unwrap();
        k.memory.map(LINEAR, 0x10000, PERM_RW, "linéaire", None).unwrap();
        k.memory.map(VRAM, 0x10000, PERM_RW, "vram", None).unwrap();
        k.memory.map(SHARED_PAGE, 0x1000, PERM_RW, "page partagée", None).unwrap();
        let hid = Rc::new(RefCell::new(Hid::new(&mut k)));
        let before = k.objects.len();
        let gsp = Gsp::new_shared(&k, hid.clone());
        assert_eq!(k.objects.len(), before, "Gsp ne crée aucun objet à la construction");
        let session = k.new_session(gsp.clone(), "gsp");
        let event = k.create_event(0, "relais");
        Rig { k, thread, gsp, hid, session, event }
    }

    impl Rig {
        fn call(&mut self, words: &[u32]) -> Vec<u32> {
            call(&mut self.k, self.thread, self.session, words)
        }

        fn register(&mut self) -> Vec<u32> {
            let handle = self.k.add_handle(self.event).unwrap();
            self.call(&[header(0x13, 1, 2), 0, 0, handle])
        }

        fn shared(&self) -> ObjId {
            self.gsp.borrow().shared.unwrap()
        }

        fn lines(&self) -> Vec<String> {
            self.k.journal.capture.clone().unwrap()
        }

        fn has_line(&self, part: &str) -> bool {
            self.lines().iter().any(|l| l.contains(part))
        }

        fn push_command(&mut self, words: [u32; 8]) {
            let shared = self.shared();
            let (index, count) = (self.k.shared(shared).u8(QUEUE) as usize, self.k.shared(shared).u8(QUEUE + 1) as usize);
            let slot = (index + count) % 15;
            let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
            self.k.shared(shared).write(QUEUE + 0x20 + slot * 0x20, &bytes);
            self.k.shared(shared).write(QUEUE + 1, &[(count + 1) as u8]);
        }

        fn relay(&self) -> (u8, Vec<u8>) {
            let shared = self.shared();
            let count = self.k.shared(shared).u8(RELAY + 1);
            (count, (0..count as usize).map(|i| self.k.shared(shared).u8(RELAY + 0xC + i)).collect())
        }

        fn signals(&self) -> u64 {
            self.k.event(self.event).signal_count
        }
    }

    /// Un paquet d'une écriture : (valeur, en-tête = registre).
    fn pkt(value: u32, register: u32) -> Vec<u32> {
        vec![value, register]
    }

    fn bytes(words: &[Vec<u32>]) -> Vec<u8> {
        words.iter().flatten().flat_map(|w| w.to_le_bytes()).collect()
    }

    fn jump(size_bytes: usize, physical: u32) -> Vec<Vec<u32>> {
        vec![pkt((size_bytes / 8) as u32, 0x238), pkt(physical / 8, 0x23A), pkt(1, 0x23C)]
    }

    #[test]
    fn registration_creates_the_block_and_answers() {
        let mut r = rig();
        r.gsp.borrow_mut().first_result = 0x2A07;
        let serial_before = r.k.objects.last().unwrap().serial;
        let reply = r.register();
        assert_eq!(reply[0], header(0x13, 2, 2));
        assert_eq!(reply[1], 0x2A07);
        assert_eq!(reply[2], 0);
        assert_eq!(reply[3], 0);
        assert_ne!(reply[4], 0);
        // le bloc partagé est créé à l'inscription (un seul objet)
        assert_eq!(r.k.objects[r.shared()].serial, serial_before + 1);
        assert_eq!(r.k.objects[r.shared()].name, "gsp");
        assert!(r.has_line("« drapeaux 0x0, client 0, signal événement#"));
        assert!(r.has_line("réponse 0x2a07 »"));
        assert!(r.has_line("gsp : le jeu est inscrit au relais des interruptions"));
        assert_eq!(r.k.next_event_time(), Some(VBLANK_NS));
        // une seconde inscription réutilise le bloc
        let shared = r.shared();
        r.register();
        assert_eq!(r.shared(), shared);
        assert!(r.has_line("(simplifié)"));
    }

    #[test]
    fn simple_commands() {
        let mut r = rig();
        // droit d'affichage avant l'inscription
        assert_eq!(r.call(&[header(0x16, 0, 0)])[1], 0);
        assert!(r.gsp.borrow().right);
        for command in [0x08, 0x10, 0x17, 0x19, 0x1A] {
            assert_eq!(r.call(&[header(command, 0, 0)])[1], 0);
        }
        assert_eq!(r.call(&[header(0x55, 0, 0)])[1], 0xD900182F);
        // le noir
        r.call(&[header(0x0B, 1, 0), 1]);
        assert!(r.has_line("« écrans au noir »"));
        assert!(r.k.bench.lcd_unblacked.is_none());
        r.call(&[header(0x0B, 1, 0), 0x100]);
        assert_eq!(r.gsp.borrow().black, Some(0));
        assert!(r.has_line("« le noir est levé : l'image devient visible »"));
        assert!(r.k.bench.lcd_unblacked.is_some());
        // registres matériels : écriture (tampon projeté) puis lecture (tampon de réception)
        r.k.memory.write(BUFFERS, &[1, 2, 3, 4]).unwrap();
        let reply = r.call(&[header(0x01, 2, 2), 0x20, 4, 4 << 4 | 0xA, BUFFERS]);
        assert_eq!(reply[1], 0);
        assert_eq!(r.gsp.borrow().hw_writes, vec![(0x20, vec![1, 2, 3, 4])]);
        assert!(r.has_line("« registre 0x20 + 0x1EB00000 <- 01020304 »"));
        let tls = r.k.thread(r.thread).tls;
        r.k.memory.write(BUFFERS + 0x100, &[0xFF; 8]).unwrap();
        r.k.memory.w32(tls + 0x180, 8 << 14 | 2).unwrap();
        r.k.memory.w32(tls + 0x184, BUFFERS + 0x100).unwrap();
        let reply = r.call(&[header(0x04, 2, 2), 0x30, 4, 0, 0]);
        assert_eq!(reply[1], 0);
        assert_eq!(reply[2], 4 << 14 | 2);
        assert_eq!(reply[3], BUFFERS + 0x100);
        assert_eq!(r.k.memory.read(BUFFERS + 0x100, 8).unwrap(), vec![0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF]);
        assert!(r.has_line("« registre 0x30 : zéros »"));
        // aucune image annoncée : quatre zéros par écran
        assert_eq!(r.call(&[header(0x18, 0, 0)]), vec![header(0x18, 9, 0), 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn queue_commands_and_interrupts() {
        let mut r = rig();
        r.register();
        r.k.memory.write(LINEAR, &(0u8..16).collect::<Vec<u8>>()).unwrap();
        r.push_command([0, LINEAR, LINEAR + 0x100, 0x10, 0, 0, 0, 0]);
        r.push_command([2, LINEAR + 0x200, 0xAABBCCDD, LINEAR + 0x210, 0, 0, 0, 0x200]);
        r.push_command([3, LINEAR + 0x1000, LINEAR + 0x2000, 0x00F00190, 0x00F00190, 0x1000, 0, 0]);
        r.push_command([4, LINEAR + 0x1000, LINEAR + 0x2000, 0x40, 0x10, 0x20, 0, 0]);
        r.push_command([5, 0, 0, 0, 0, 0, 0, 0]);
        r.push_command([9, 0, 0, 0, 0, 0, 0, 0]);
        let reply = r.call(&[header(0x0C, 0, 0)]);
        assert_eq!(reply[1], 0);
        assert!(r.has_line("« 6 commande(s) traitée(s) : RequestDma, MemoryFill, DisplayTransfer, TextureCopy, FlushCacheRegions, commande 9 »"));
        // effets réels : copie, remplissage 32 bits
        assert_eq!(r.k.memory.read(LINEAR + 0x100, 16).unwrap(), (0u8..16).collect::<Vec<u8>>());
        assert_eq!(r.k.memory.read(LINEAR + 0x200, 8).unwrap(), vec![0xDD, 0xCC, 0xBB, 0xAA, 0xDD, 0xCC, 0xBB, 0xAA]);
        assert_eq!(r.k.memory.read(LINEAR + 0x210, 1).unwrap(), vec![0]);
        // lignes du journal
        assert!(r.has_line("gsp file : RequestDma 0x14000000 -> 0x14000100, 0x10 octets"));
        assert!(r.has_line("gsp file : MemoryFill 0x14000200-0x14000210 <- 0xaabbccdd (32 bits)"));
        assert!(r.has_line("gsp file : DisplayTransfer 0x14001000 (400x240, RGBA8) -> 0x14002000 (400x240, RGB8), drapeaux 0x1000 : non fait par le portage"));
        assert!(r.has_line("gsp : copie de texture refusée (non fait par le portage)"));
        assert!(r.has_line("gsp file : TextureCopy 0x14001000 -> 0x14002000, 0x40 octets, lignes 0x10/0x20"));
        // interruptions : DMA, remplissage 0, transfert 4, copie 4 ; rien pour 5 ni pour l'inconnue
        assert_eq!(r.relay(), (4, vec![6, 0, 4, 4]));
        assert_eq!(r.signals(), 4);
        let shared = r.shared();
        assert_eq!((r.k.shared(shared).u8(QUEUE), r.k.shared(shared).u8(QUEUE + 1)), (6, 0));
        assert_eq!(r.gsp.borrow().unknown_ops.len(), 1);
        assert_eq!(r.gsp.borrow().stats["MemoryFill"], 1);
        assert_eq!(r.gsp.borrow().stats["interruption 6 DMA"], 1);
        assert_eq!(r.gsp.borrow().stats["interruption 4 PPF"], 2);
        assert_eq!(r.gsp.borrow().stats["transferts vers écran faits"], 0);
        assert_eq!(r.gsp.borrow().unknown_ops[0][0], 9);
    }

    #[test]
    fn display_transfer_hooks_and_fill_variants() {
        let mut r = rig();
        r.register();
        r.gsp.borrow_mut().display_transfer = Some(Box::new(|_, words| {
            assert_eq!(words, [LINEAR, LINEAR + 0x100, 0x00F00190, 0x019000F0, 0x1000]);
            String::new()
        }));
        r.gsp.borrow_mut().texture_copy = Some(Box::new(|_, _| Ok(())));
        r.push_command([3, LINEAR, LINEAR + 0x100, 0x00F00190, 0x019000F0, 0x1000, 0, 0]);
        r.push_command([4, LINEAR, LINEAR + 0x100, 0x10, 0, 0, 0, 0]);
        // deux zones de remplissage : 16 bits (largeur 0) puis 24 bits (largeur 1), la première absente → interruption 1
        r.push_command([2, 0, 0, 0, LINEAR + 0x300, 0x00112233, LINEAR + 0x306, 0x0100 << 16]);
        r.call(&[header(0x0C, 0, 0)]);
        assert!(r.lines().iter().any(|l| l.ends_with("gsp file : DisplayTransfer 0x14000000 (400x240, RGBA8) -> 0x14000100 (240x400, RGB8), drapeaux 0x1000")));
        assert!(!r.has_line("non fait par le portage"));
        assert!(!r.has_line("copie de texture refusée"));
        assert_eq!(r.gsp.borrow().latest_transfer[&0], (LINEAR + 0x100, 1, 240 * 3));
        assert_eq!(r.gsp.borrow().stats["transferts vers écran faits"], 1);
        assert!(r.has_line("gsp file : MemoryFill 0x14000300-0x14000306 <- 0x112233 (24 bits)"));
        assert_eq!(r.k.memory.read(LINEAR + 0x300, 7).unwrap(), vec![0x33, 0x22, 0x11, 0x33, 0x22, 0x11, 0]);
        assert_eq!(r.relay(), (3, vec![4, 4, 1]));
    }

    #[test]
    fn queue_wraps_and_relay_overflows() {
        let mut r = rig();
        r.register();
        let shared = r.shared();
        r.k.shared(shared).write(QUEUE, &[14]);
        r.push_command([5, 0, 0, 0, 0, 0, 0, 0]);
        r.push_command([0, LINEAR, LINEAR + 0x10, 4, 0, 0, 0, 0]);
        assert_eq!(r.k.shared(shared).u8(QUEUE + 1), 2);
        let done = r.gsp.borrow_mut().process_queue(&mut r.k);
        assert_eq!(done, vec!["FlushCacheRegions".to_string(), "RequestDma".to_string()]);
        assert_eq!(r.k.shared(shared).u8(QUEUE), 1);
        // le relais plein : l'indicateur de débordement, pas de signal
        r.k.shared(shared).write(RELAY + 1, &[0x34]);
        let signals = r.signals();
        r.gsp.borrow_mut().deposit(&mut r.k, 4);
        assert_eq!(r.k.shared(shared).u8(RELAY + 2), 1);
        assert_eq!(r.signals(), signals);
        // sans événement inscrit : rien
        r.call(&[header(0x14, 0, 0)]);
        r.k.shared(shared).write(RELAY + 1, &[0]);
        r.gsp.borrow_mut().deposit(&mut r.k, 4);
        assert_eq!(r.k.shared(shared).u8(RELAY + 1), 0);
    }

    #[test]
    fn follow_jumps_with_two_jumps() {
        // A -> B (adresse physique du tas linéaire) -> C (adresse physique de la mémoire vidéo)
        let phys_b = 0x2000_0200u32;
        let phys_c = 0x1800_0100u32;
        let c = vec![pkt(5, 0x22E), pkt(6, 0x22F), pkt(7, 0x22E)];
        let mut b = vec![pkt(0x22, 0x201)];
        b.extend(jump(bytes(&c).len(), phys_c));
        b.push(pkt(0xBAD, 0x3FF)); // abandonné : après le saut
        let mut a = vec![pkt(0x11, 0x200)];
        a.extend(jump(bytes(&b).len(), phys_b));
        a.push(pkt(0xBAD, 0x3FE)); // abandonné
        let mut memory: HashMap<u32, Vec<u8>> = HashMap::new();
        memory.insert(0x1400_0200, bytes(&b));
        memory.insert(0x1F00_0100, bytes(&c));
        let mut read = |address: u32, size: u32| memory.get(&address).filter(|d| d.len() as u32 == size).cloned();
        let mut stats = BTreeMap::new();
        let out = follow_jumps(&mut read, &bytes(&a), Some(&mut stats));
        let expected: Vec<u8> = [bytes(&a[..4]), bytes(&b[..4]), bytes(&c)].concat();
        assert_eq!(out, expected);
        assert_eq!(stats["sauts de liste suivis"], 2);
        assert!(!stats.contains_key("sauts de liste vers une adresse illisible"));
        // sans saut : la liste rendue telle quelle (même coupée en mot)
        let mut plain = bytes(&c);
        plain.extend_from_slice(&[1, 2, 3]);
        assert_eq!(follow_jumps(&mut read, &plain, None), plain);
    }

    #[test]
    fn follow_jumps_unreadable_truncated_and_loop() {
        let mut nothing = |_: u32, _: u32| -> Option<Vec<u8>> { None };
        let mut a = vec![pkt(0x11, 0x200)];
        a.extend(jump(16, 0x3000_0000));
        a.push(pkt(0xBAD, 0x3FE));
        let mut stats = BTreeMap::new();
        let out = follow_jumps(&mut nothing, &bytes(&a), Some(&mut stats));
        assert_eq!(out, bytes(&a[..4]));
        assert_eq!(stats["sauts de liste vers une adresse illisible"], 1);
        assert!(!stats.contains_key("sauts de liste suivis"));
        // un paquet à écritures consécutives coupé par la fin du tampon est ignoré (rien n'est déclenché)
        let truncated = vec![0x23C, 0x1 << 20 | 0x23C];
        let data: Vec<u8> = truncated.iter().flat_map(|w: &u32| w.to_le_bytes()).collect();
        assert_eq!(follow_jumps(&mut nothing, &data, None), data);
        // un paquet consécutif complet : 0x23B <- 3 puis 0x23C <- 1 ne déclenche pas (c'est 0x23C avec le bit 0 qui le fait)
        // ici : registres 0x23B et 0x23C écrits d'un coup (consécutifs), le saut vise la cible 0 (taille 0x238 absente = 0)
        let both = vec![3u32, 0x1 << 20 | 1 << 31 | 0x23B, 1, 0];
        let data: Vec<u8> = both.iter().flat_map(|w| w.to_le_bytes()).collect();
        let mut stats = BTreeMap::new();
        let out = follow_jumps(&mut nothing, &data, Some(&mut stats));
        assert_eq!(out, data);
        assert_eq!(stats["sauts de liste vers une adresse illisible"], 1);
        // une liste qui se saute elle-même : le garde-fou arrête à 20 001 tours
        let looping = jump(24, 0x2000_0000);
        let looped = bytes(&looping);
        assert_eq!(looped.len(), 24);
        let mut again = |address: u32, size: u32| if address == 0x1400_0000 && size == 24 { Some(looped.clone()) } else { None };
        let mut stats = BTreeMap::new();
        let out = follow_jumps(&mut again, &looped, Some(&mut stats));
        assert_eq!(stats["sauts de liste suivis"], MAX_JUMPS as u64 + 1);
        assert_eq!(out.len(), 24 * (MAX_JUMPS + 1));
    }

    #[test]
    fn command_lists_are_counted_and_followed() {
        let mut r = rig();
        r.register();
        let c = vec![pkt(5, 0x22E), pkt(6, 0x22F), pkt(7, 0x22E)];
        let mut b = vec![pkt(0x22, 0x201)];
        b.extend(jump(bytes(&c).len(), 0x1800_0100));
        let mut a = vec![pkt(0x11, 0x200)];
        a.extend(jump(bytes(&b).len(), 0x2000_0200));
        r.k.memory.write(LINEAR, &bytes(&a)).unwrap();
        r.k.memory.write(LINEAR + 0x200, &bytes(&b)).unwrap();
        r.k.memory.write(VRAM + 0x100, &bytes(&c)).unwrap();
        let size = bytes(&a).len() as u32;
        r.push_command([1, LINEAR, size, 0, 0, 0, 0, 0]);
        r.call(&[header(0x0C, 0, 0)]);
        assert!(r.has_line("gsp file : ProcessCommandList 0x14000000, 0x20 octets : 11 écritures de registres, dessins : {'DrawArrays': 2, 'DrawElements': 1}"));
        let gsp = r.gsp.borrow();
        assert_eq!(gsp.stats["sauts de liste suivis"], 2);
        assert_eq!(gsp.registers[&0x22E], 2);
        assert_eq!(gsp.registers[&0x238], 2);
        assert_eq!(gsp.lists, vec![(0, LINEAR, size, 11, 3)]);
        drop(gsp);
        assert_eq!(r.k.bench.command_lists, 1);
        assert!(r.k.journal.has_milestone("P5"));
        assert_eq!(r.relay(), (1, vec![5]));
        // une liste sans dessin, puis une liste illisible
        r.push_command([1, LINEAR + 0x400, 8, 0, 0, 0, 0, 0]);
        r.push_command([1, 0x3000_0000, 8, 0, 0, 0, 0, 0]);
        r.call(&[header(0x0C, 0, 0)]);
        assert!(r.has_line("ProcessCommandList 0x14000400, 0x8 octets : 1 écritures de registres, dessins : aucun"));
        assert!(r.has_line("ProcessCommandList 0x30000000, 0x8 octets : illisible ("));
        assert_eq!(r.gsp.borrow().lists.last().unwrap().3, 0);
    }

    #[test]
    fn vblank_frames_interrupts_and_hid() {
        let mut r = rig();
        r.k.bench.start_milliseconds = 1000;
        r.k.bench.presses = vec![(0.0, 1.0, 0x8)];
        r.register();
        let shared = r.shared();
        // le jeu annonce une image pour l'écran du haut (jeu de description n° 1)
        r.k.shared(shared).write(FRAMEBUFFERS, &[1, 1]);
        let mut description = Vec::new();
        for word in [1u32, LINEAR, 0, 0x960, 2, 0, 0] {
            description.extend_from_slice(&word.to_le_bytes());
        }
        r.k.shared(shared).write(FRAMEBUFFERS + 4 + 0x1C, &description);
        // une commande attend dans la file : la fin d'image la traite
        r.push_command([5, 0, 0, 0, 0, 0, 0, 0]);
        // rien n'est dû avant l'heure
        r.k.run_due_events();
        assert_eq!(r.gsp.borrow().vblank_count, 0);
        r.k.now = VBLANK_NS;
        r.k.run_due_events();
        let gsp = r.gsp.borrow();
        assert_eq!(gsp.vblank_count, 1);
        assert_eq!(gsp.current[0], Some((LINEAR, 2, 0x960)));
        assert_eq!(gsp.frames[0], vec![(VBLANK_NS, LINEAR, 2, 0x960)]);
        assert!(gsp.frames[1].is_empty());
        drop(gsp);
        assert_eq!(r.k.shared(shared).u8(FRAMEBUFFERS + 1), 0);
        assert!(r.has_line("gsp : image annoncée pour l'écran du haut : 0x14000000, RGB565, ligne de 2400 octets, format 0x2"));
        assert_eq!(r.relay(), (2, vec![2, 3]));
        assert_eq!(r.signals(), 2);
        assert_eq!(r.k.shared(shared).u8(QUEUE + 1), 0);
        assert_eq!(r.k.next_event_time(), Some(2 * VBLANK_NS));
        // le banc : boutons, hid, heure de la page partagée
        assert_eq!(r.k.bench.vblanks, 1);
        assert!(r.has_line("hid : boutons tenus 0x8"));
        assert_eq!(r.hid.borrow().buttons, 0x8);
        assert_eq!(r.hid.borrow().updates, 1);
        let hid_page = r.hid.borrow().shared;
        assert_eq!(r.k.shared(hid_page).u32(0x28), 0x8);
        assert_eq!(r.k.memory.u64(SHARED_PAGE + 0x20).unwrap(), 1000 + 16);
        assert_eq!(r.k.memory.u64(SHARED_PAGE + 0x28).unwrap(), r.k.ticks());
        // capture d'écran annoncée vue par ImportDisplayCaptureInfo
        assert_eq!(r.call(&[header(0x18, 0, 0)])[1..], [0, LINEAR, LINEAR, 2, 0x960, 0, 0, 0, 0]);
        // le masque d'interruptions des fins d'image (octet 3) les supprime
        r.k.shared(shared).write(RELAY + 3, &[1]);
        r.k.now = 2 * VBLANK_NS;
        r.k.run_due_events();
        assert_eq!(r.gsp.borrow().vblank_count, 2);
        assert_eq!(r.relay().0, 2);
        assert_eq!(r.k.next_event_time(), Some(3 * VBLANK_NS));
        r.k.shared(shared).write(RELAY + 3, &[0]);
        r.k.now = 3 * VBLANK_NS;
        r.k.run_due_events();
        assert_eq!(r.relay(), (4, vec![2, 3, 2, 3]));
        // une seule ligne « boutons tenus » (les boutons n'ont pas changé)
        assert_eq!(r.lines().iter().filter(|l| l.contains("hid : boutons tenus")).count(), 1);
        // une échéance en retard replanifie à partir de l'heure courante, comme le banc Python
        r.k.now = 5 * VBLANK_NS;
        r.k.run_due_events();
        assert_eq!(r.gsp.borrow().vblank_count, 4);
        assert_eq!(r.k.next_event_time(), Some(6 * VBLANK_NS));
    }

    #[test]
    fn vblank_before_registration_does_nothing() {
        let mut r = rig();
        Gsp::vblank(&r.gsp, &mut r.k);
        assert_eq!(r.gsp.borrow().vblank_count, 0);
        assert_eq!(r.k.next_event_time(), None);
        assert_eq!(r.k.bench.vblanks, 0);
    }

    #[test]
    fn on_vblank_follows_presses_and_clock() {
        let (mut k, _s) = test_kernel();
        k.memory.map(SHARED_PAGE, 0x1000, PERM_RW, "page partagée", None).unwrap();
        let hid = Rc::new(RefCell::new(Hid::new(&mut k)));
        k.bench.start_milliseconds = 5;
        k.bench.presses = vec![(1.0, 0.5, 0x1), (1.25, 1.0, 0x4)];
        k.now = 1_300_000_000;
        on_vblank(&mut k, &hid);
        assert_eq!(hid.borrow().buttons, 0x5);
        assert_eq!(k.memory.u64(SHARED_PAGE + 0x20).unwrap(), 5 + 1300);
        k.now = 1_600_000_000;
        on_vblank(&mut k, &hid);
        assert_eq!(hid.borrow().buttons, 0x4);
        k.now = 2_400_000_000;
        on_vblank(&mut k, &hid);
        assert_eq!(hid.borrow().buttons, 0);
        let lines = k.journal.capture.clone().unwrap();
        let held: Vec<&String> = lines.iter().filter(|l| l.contains("hid : boutons tenus")).collect();
        assert_eq!(held.len(), 3);
        assert!(held[0].ends_with("hid : boutons tenus 0x5"));
        assert!(held[2].ends_with("hid : boutons tenus 0x0"));
        assert_eq!(k.bench.vblanks, 3);
    }
}
