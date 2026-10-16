//! Le montage : la mémoire du jeu, le noyau, le processeur recompilé, les services, et la boucle (même rôle que
//! `banc/bench.py` + `banc/run.py`, pour le seul mode `--cpu natif`).

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Instant;

use hostcpu::NativeCpu;
use kernel::bench::{ENTRY, Paths};
use kernel::journal::Journal;
use kernel::kernel::{CONFIG_PAGE, Kernel, SHARED_PAGE};
use kernel::memory::{AddressSpace, PAGE, PERM_R, PERM_RW, PERM_RWX, PERM_RX, align_up};
use kernel::names::Names;
use kernel::object::SharedService;

/// Les sections, la pile, la priorité du fil principal d'après l'exheader (3dbrew, « NCCH/Extended Header »).
#[derive(Debug, Clone)]
pub struct ExHeader {
    /// (adresse, pages, taille)
    pub text: (u32, u32, u32),
    pub rodata: (u32, u32, u32),
    pub data: (u32, u32, u32),
    pub stack: u32,
    pub bss: u32,
    pub priority: u32,
}

fn le32(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]])
}

pub fn read_exheader(data: &[u8]) -> ExHeader {
    let section = |offset: usize| (le32(data, offset), le32(data, offset + 4), le32(data, offset + 8));
    ExHeader {
        text: section(0x10),
        rodata: section(0x20),
        data: section(0x30),
        stack: le32(data, 0x1C),
        bss: le32(data, 0x3C),
        priority: data[0x20F] as u32,
    }
}

pub struct Options {
    /// La racine du dépôt `decompil-3ds` (où vit `local/`).
    pub root: PathBuf,
    pub out: PathBuf,
    pub dll: PathBuf,
    pub seconds: f64,
    pub turns: u64,
    pub wall_seconds: f64,
    pub presses: Vec<(f64, f64, u32)>,
    pub mod_dir: Option<PathBuf>,
    pub log_all_svc: bool,
    pub max_lines: usize,
}

impl Options {
    pub fn new(root: &Path) -> Options {
        Options {
            root: root.to_path_buf(),
            out: root.join("local/analyse/runtime/rust"),
            dll: root.join("local/recomp/jeu/build/jeu-hote.dll"),
            seconds: 30.0,
            turns: 0,
            wall_seconds: 20.0 * 60.0,
            presses: Vec::new(),
            mod_dir: None,
            log_all_svc: true,
            max_lines: 400_000,
        }
    }

    pub fn paths(&self) -> Paths {
        let local = self.root.join("local");
        Paths {
            code: local.join("extrait/maj/exefs/code.bin"),
            exheader: local.join("extrait/maj/exefs/exheader.bin"),
            exefs: local.join("extrait/maj/exefs"),
            romfs_base: local.join("dump/pokemon-x.cxi"),
            romfs_update: local.join("dump/pokemon-x_maj.cxi"),
            config: local.join("extrait/cfg-sauvegarde/config"),
            font: local.join("extrait/police-partagee/cbf_std.bcfnt"),
            save: local.join("extrait/sd-0004000000055d00/sauvegarde/fichiers"),
            extdata: local.join("extrait/sd-0004000000055d00/extdata"),
            out: self.out.clone(),
            archives: self.out.join("archives"),
            overlay: self.mod_dir.clone(),
        }
    }
}

pub struct Bench {
    pub kernel: Kernel,
    pub exheader: ExHeader,
    pub code: Vec<u8>,
    pub options: Options,
    pub elapsed: f64,
    pub services: Vec<(String, SharedService)>,
}

/// Jours depuis 1900-01-01 pour une date du calendrier grégorien (algorithme de Howard Hinnant).
fn days_since_1900(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let since_1970 = era * 146097 + doe - 719468;
    since_1970 + 25567
}

impl Bench {
    pub fn new(options: Options) -> Result<Bench, String> {
        let paths = options.paths();
        let names = Names::load(&options.root.join("fiches/pokemon-x.noms.tsv"),
            &options.root.join("local/analyse/maj/gh/funcs.tsv"),
            &options.root.parent().unwrap_or(Path::new(".")).join("carte-des-services/donnees.js"));
        let journal = Journal::new(Some(&options.out.join("journal.txt")), names, options.max_lines)
            .map_err(|e| format!("journal illisible : {e}"))?;
        let code = std::fs::read(&paths.code).map_err(|e| format!("{} : {e}", paths.code.display()))?;
        let exheader_bytes = std::fs::read(&paths.exheader).map_err(|e| format!("{} : {e}", paths.exheader.display()))?;
        let exheader = read_exheader(&exheader_bytes);
        let cpu = NativeCpu::load(&options.dll)?;
        let mut memory = AddressSpace::new();
        memory.set_sink(cpu.page_sink());
        let mut kernel = Kernel::new(memory, Box::new(cpu), journal);
        kernel.log_all_svc = options.log_all_svc;
        kernel.bench.paths = paths;
        kernel.bench.presses = options.presses.clone();
        kernel.bench.region = 2;
        kernel.bench.turns_limit = options.turns;
        let mut bench = Bench { kernel, exheader, code, options, elapsed: 0.0, services: Vec::new() };
        bench.map_program()?;
        bench.register_services()?;
        bench.kernel.watch_milestones()?;
        Ok(bench)
    }

    fn map_program(&mut self) -> Result<(), String> {
        let ex = self.exheader.clone();
        let k = &mut self.kernel;
        let mut offset = 0usize;
        for (name, (address, pages, size), perms) in
            [("text", ex.text, PERM_RX), ("rodata", ex.rodata, PERM_R), ("data", ex.data, PERM_RW)]
        {
            let mut region_size = pages * PAGE;
            if name == "data" {
                region_size = align_up(size + ex.bss).max(pages * PAGE);
            }
            if region_size == 0 {
                continue;
            }
            let perms = perms | if name == "data" { PERM_RWX } else { 0 };
            k.memory.map(address, region_size, perms, &format!(".{name}"), None).map_err(|e| e.to_string())?;
            let end = (offset + (pages * PAGE) as usize).min(self.code.len());
            let chunk = &self.code[offset.min(end)..end];
            k.memory.write(address, chunk).map_err(|e| e.to_string())?;
            offset += (pages * PAGE) as usize;
        }
        k.code_size = offset as u32 + align_up(ex.bss);
        let stack = align_up(ex.stack);
        k.memory.map(0x1000_0000 - stack, stack, PERM_RW, "pile du fil principal", None).map_err(|e| e.to_string())?;
        k.memory.map(CONFIG_PAGE, PAGE, PERM_R, "page de configuration", None).map_err(|e| e.to_string())?;
        k.memory.map(SHARED_PAGE, PAGE, PERM_RW, "page partagée", None).map_err(|e| e.to_string())?;
        k.memory.map(0x1F00_0000, 0x60_0000, PERM_RW, "mémoire vidéo", None).map_err(|e| e.to_string())?;
        k.memory.map(0x1FF0_0000, 0x8_0000, PERM_RW, "mémoire du DSP", None).map_err(|e| e.to_string())?;
        self.fill_config_pages()
    }

    fn fill_config_pages(&mut self) -> Result<(), String> {
        let k = &mut self.kernel;
        let mut page = vec![0u8; PAGE as usize];
        let put32 = |page: &mut Vec<u8>, at: usize, v: u32| page[at..at + 4].copy_from_slice(&v.to_le_bytes());
        page[0..4].copy_from_slice(&[0, 0, 0x3A, 2]); // version du noyau 2.58-0
        page[0x08..0x10].copy_from_slice(&0x0004_0130_0000_8002u64.to_le_bytes()); // NSTID
        put32(&mut page, 0x10, 2); // SYSCOREVER
        page[0x14] = 1; // ENVINFO : console du commerce (bit 0)
        page[0x15] = 0; // UNITINFO
        put32(&mut page, 0x18, 0xF450); // KERNEL_CTRSDKVERSION
        put32(&mut page, 0x30, 0); // APPMEMTYPE
        put32(&mut page, 0x40, k.app_memory);
        put32(&mut page, 0x44, 0x02C0_0000);
        put32(&mut page, 0x48, 0x0140_0000);
        page[0x60..0x64].copy_from_slice(&[0, 0, 0x3A, 2]); // FIRM_VERSION
        put32(&mut page, 0x64, 2);
        put32(&mut page, 0x68, 0xF450);
        k.memory.write(CONFIG_PAGE, &page).map_err(|e| e.to_string())?;
        let mut shared = vec![0u8; PAGE as usize];
        // 2026-10-14 12:00:00, en millisecondes depuis 1900
        let milliseconds = (days_since_1900(2026, 10, 14) * 86400 + 12 * 3600) as u64 * 1000;
        shared[0x20..0x28].copy_from_slice(&milliseconds.to_le_bytes()); // DATETIME_0 : l'heure, et le tick de la mise à jour
        shared[0x40..0x48].copy_from_slice(&milliseconds.to_le_bytes());
        shared[0x04] = 1; // RUNNING_HW : console du commerce
        shared[0x67] = 0; // pas de réseau
        k.memory.write(SHARED_PAGE, &shared).map_err(|e| e.to_string())?;
        k.bench.start_milliseconds = milliseconds;
        Ok(())
    }

    fn register_services(&mut self) -> Result<(), String> {
        use services::{apt::Apt, dsp::Dsp, fs::FsUser, gsp::Gsp, ldr_ro::LdrRo, small::{Cfg, ErrF, Hid, Ptm}, srv::Srv};
        let k = &mut self.kernel;
        let paths = k.bench.paths.clone();
        let note = services::fs::prepare_archives(&paths, Some(&paths.save), Some(&paths.extdata));
        k.bench.events.push((0, note));
        let srv = Rc::new(RefCell::new(Srv::new(k)));
        let errf = Rc::new(RefCell::new(ErrF));
        let mut add = |k: &mut Kernel, name: &str, service: SharedService, list: &mut Vec<(String, SharedService)>| {
            k.services.insert(name.to_string(), service.clone());
            list.push((name.to_string(), service));
        };
        let mut list = Vec::new();
        let apt: SharedService = Rc::new(RefCell::new(Apt::new(k)));
        add(k, "APT:U", apt, &mut list);
        let fs: SharedService = Rc::new(RefCell::new(FsUser::new(k)));
        add(k, "fs:USER", fs, &mut list);
        // Gsp ne crée aucun objet du noyau : on peut le construire après Hid sans changer les numéros de série.
        let dsp = Dsp::new_shared(k);
        let hid = Rc::new(RefCell::new(Hid::new(k)));
        let gsp = Gsp::new_shared(k, hid.clone());
        {
            // Les transferts vers l'écran et les copies de texture appartiennent à `pica` (pas branché ici) : ils sont
            // notés au journal comme au banc, sans écrire la mémoire. Le journal reste identique ; l'image n'existe pas.
            let mut g = gsp.borrow_mut();
            g.display_transfer = Some(Box::new(|_k: &mut Kernel, _words: [u32; 5]| String::new()));
            g.texture_copy = Some(Box::new(|_k: &mut Kernel, _words: [u32; 6]| Ok(())));
        }
        add(k, "gsp::Gpu", gsp, &mut list);
        add(k, "dsp::DSP", dsp, &mut list);
        add(k, "hid:USER", hid, &mut list);
        let cfg: SharedService = Rc::new(RefCell::new(Cfg::new(k)));
        add(k, "cfg:u", cfg, &mut list);
        let ptm: SharedService = Rc::new(RefCell::new(Ptm));
        add(k, "ptm:u", ptm, &mut list);
        let ro: SharedService = Rc::new(RefCell::new(LdrRo::new(k)));
        add(k, "ldr:ro", ro, &mut list);
        self.services = list;
        let k = &mut self.kernel;
        let srv: SharedService = srv;
        let errf: SharedService = errf;
        k.ports.insert("srv:".into(), srv);
        k.ports.insert("err:f".into(), errf);
        k.service_factory = Some(Box::new(|k: &mut Kernel, name: &str| services::stubs::make_service(k, name)));
        Ok(())
    }

    /// `Bench.start` : le fil principal.
    pub fn start(&mut self) {
        let priority = self.exheader.priority;
        let k = &mut self.kernel;
        let thread = k.create_thread(ENTRY, 0, 0x1000_0000, priority, 0, "principal");
        let (id, tls, entry) = (k.thread(thread).thread_id, k.thread(thread).tls, k.thread(thread).entry);
        let now = k.now;
        k.journal.thread_created(now, None, id, entry, priority, 0, 0x1000_0000, tls);
    }

    pub fn run(&mut self) -> String {
        let started = Instant::now();
        self.start();
        let limit = (self.options.seconds * 1e9) as u64;
        let wall = self.options.wall_seconds;
        let mut should_stop = move |k: &mut Kernel| -> Option<String> {
            if let Some(text) = &k.bench.stop_request {
                return Some(text.clone());
            }
            let turns = k.bench.turns_limit;
            if turns > 0 && k.bench.loop_turns >= turns {
                return Some(format!("la boucle principale a fait {turns} tours (limite demandée)"));
            }
            if wall > 0.0 && started.elapsed().as_secs_f64() > wall {
                return Some(format!("limite de temps du PC atteinte ({} s)", wall as u64));
            }
            None
        };
        let reason = self.kernel.run(limit, &mut should_stop);
        self.elapsed = started.elapsed().as_secs_f64();
        let now = self.kernel.now;
        self.kernel.journal.write(now, &format!("=== arrêt : {reason}"));
        self.kernel.journal.close();
        reason
    }

    /// Le résumé en texte (palier, arrêt, fils, comptes) : l'équivalent court de `resume.md`.
    pub fn summary(&mut self, reason: &str) -> String {
        let mut lines = Vec::new();
        lines.push(format!("Palier atteint : {}", self.kernel.highest_milestone()));
        lines.push(format!("Arrêt : {reason}"));
        lines.push(format!("Temps du banc {:.3} s, temps du PC {:.1} s", self.kernel.now as f64 / 1e9, self.elapsed));
        for (key, when, text) in &self.kernel.journal.milestones {
            lines.push(format!("  {:.3} ms  {key} : {text}", *when as f64 / 1e6));
        }
        for line in self.kernel.describe_threads() {
            lines.push(format!("  {line}"));
        }
        let counts: Vec<String> = self
            .kernel
            .svc_counts
            .iter()
            .map(|(n, c)| format!("{} {}", self.kernel.journal.names.svc(*n), c))
            .collect();
        lines.push(format!("Appels système : {}", counts.join(", ")));
        lines.join("\n")
    }
}
