//! `ldr:ro`, le chargeur des modules `.cro` (contrat des petits services, partie 6 ; fiche ro). Port de
//! `banc/services/ldr_ro.py`, avec le travail de liaison fait par la crate `cro` (`LoaderState`, vérifiée contre
//! `outils/cro_loader.py`).
//!
//! - Initialize : static.crs, lu dans le tampon du jeu ; le miroir de ce tampon est projeté à l'adresse donnée ;
//! - LoadCRR : la liste des empreintes autorisées ;
//! - LoadExeCRO : le fichier apparaît à l'adresse miroir (la même mémoire que le tampon du tas, comme le fait ro), les
//!   corrections internes et les imports sont appliqués, la marque devient FIXD, les mots du code principal que
//!   static.crs réserve à ce module sont remplis ;
//! - UnloadCRO : les imports qui visaient le module reviennent à « symbole non résolu », le fichier d'origine est remis
//!   dans le tampon, le miroir est retiré.

use std::collections::HashMap;

use cro::{LoaderState, WordWrite};
use kernel::ipc::{Reply, Request, Service, unknown_command};
use kernel::kernel::Kernel;
use kernel::memory::{PERM_RWX, align_up};

pub struct LdrRo {
    state: LoaderState,
    /// adresse miroir -> tampon du jeu du module chargé
    buffers: HashMap<u32, u32>,
    code: Option<Vec<u8>>,
}

impl LdrRo {
    pub fn new(k: &mut Kernel) -> LdrRo {
        // Le code principal (`bench.code`) sert à remplir les mots que static.crs réserve : lu une fois.
        let code = std::fs::read(&k.bench.paths.code).ok();
        LdrRo { state: LoaderState::new(), buffers: HashMap::new(), code }
    }

    fn map_mirror(&self, k: &mut Kernel, mirror: u32, buffer: u32, size: u32) -> Result<(), String> {
        let Some((backing, offset)) = k.memory.backing_at(buffer) else {
            return Err(format!("tampon {buffer:#x} non projeté"));
        };
        let size = align_up(size);
        if k.memory.overlaps(mirror, size) {
            k.memory.unmap(mirror, size);
        }
        k.memory
            .map(mirror, size, PERM_RWX, &format!("miroir de {buffer:#x} (ro)"), Some((&backing, offset)))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// `sync` : recopie dans la mémoire du jeu ce que le Linker vient d'écrire chez lui.
    fn sync(&self, k: &mut Kernel, writes: &[WordWrite]) {
        for w in writes {
            let bytes = if w.width == 4 { w.value.to_le_bytes().to_vec() } else { (w.value as u16).to_le_bytes().to_vec() };
            let _ = k.memory.write(w.address, &bytes);
            k.cpu.invalidate(w.address & !0xFFF, 0x1000);
        }
    }

    fn initialize(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (buffer, size, mirror) = (req.word(1), req.word(2), req.word(3));
        let data = match k.memory.read(buffer, size) {
            Ok(d) => d,
            Err(e) => return Reply::new(0xE0E0_1BF5).with_note(e.to_string()),
        };
        let journal = match self.state.initialize(&data, self.code.as_deref(), mirror) {
            Ok(j) => j,
            Err(e) => return Reply::new(0xD901_2C11).with_note(e.to_string()),
        };
        if let Err(e) = self.map_mirror(k, mirror, buffer, size) {
            return Reply::new(0xE0E0_1BF5).with_note(e);
        }
        let now = k.now;
        k.journal.module(now, &journal);
        k.on_ro("Initialize");
        Reply::new(0).with_note(format!("static.crs {size:#x} octets, miroir {mirror:#x}"))
    }

    fn load_crr(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (buffer, size) = (req.word(1), req.word(2));
        let data = k.memory.read(buffer, size).unwrap_or_default();
        match self.state.load_crr(&data) {
            Ok(n) => {
                let now = k.now;
                k.journal.module(now, &format!("static.crr : {n} empreintes autorisées"));
                k.on_ro("LoadCRR");
                Reply::new(0).with_note(format!("{n} empreintes"))
            }
            Err(e) => Reply::new(0xD901_2C11).with_note(e.to_string()),
        }
    }

    fn load_exe_cro(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let (buffer, mirror, size) = (req.word(1), req.word(2), req.word(3));
        let (data_address, bss_address) = (req.word(4), req.word(7));
        if self.state.linker().is_none() {
            return Reply::with_words(0xD901_2C19, &[0]).with_note("LoadExeCRO avant Initialize");
        }
        let original = match k.memory.read(buffer, size) {
            Ok(d) => d,
            Err(e) => return Reply::new(0xE0E0_1BF5).with_note(e.to_string()),
        };
        let loaded = match self.state.load_exe_cro(&original, buffer, mirror, data_address, bss_address) {
            Ok(l) => l,
            Err(e) => return Reply::with_words(0xD901_2C11, &[0]).with_note(e.to_string()),
        };
        if let Some(warning) = &loaded.warning {
            k.note(warning);
        }
        if let Err(e) = self.map_mirror(k, mirror, buffer, size) {
            return Reply::with_words(0xE0E0_1BF5, &[0]).with_note(e);
        }
        self.sync(k, &loaded.external_writes);
        let _ = k.memory.write(mirror, &loaded.image);
        k.cpu.invalidate(mirror, align_up(size));
        self.buffers.insert(mirror, buffer);
        let now = k.now;
        k.journal.module(now, &loaded.journal);
        for line in &loaded.problem_lines {
            k.journal.module(now, line);
        }
        k.journal.names.modules.push((mirror, mirror + size, loaded.name.clone()));
        k.on_cro_loaded(&loaded.name, mirror);
        Reply::with_words(0, &[size]).with_note(format!("{} -> {mirror:#x}", loaded.name))
    }

    fn unload_cro(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let mirror = req.word(1);
        match self.state.unload_cro(mirror) {
            Err(_) => Reply::new(0xD901_2C1E).with_note(format!("rien de chargé à {mirror:#x}")),
            Ok(unloaded) => {
                self.sync(k, &unloaded.external_writes);
                let buffer = self.buffers.remove(&mirror).unwrap_or(req.word(3));
                let _ = k.memory.write(buffer, &unloaded.original);
                k.memory.unmap(mirror, align_up(unloaded.size));
                k.journal.names.modules.retain(|m| m.0 != mirror);
                let now = k.now;
                k.journal.module(now, &unloaded.journal);
                Reply::new(0).with_note(unloaded.name)
            }
        }
    }
}

impl Service for LdrRo {
    fn name(&self) -> &str {
        "ldr:ro"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x0001 => self.initialize(k, req),
            0x0002 => self.load_crr(k, req),
            0x0003 => Reply::new(0),
            0x0004 | 0x0009 => self.load_exe_cro(k, req),
            0x0005 => self.unload_cro(k, req),
            0x0006..=0x0008 => Reply::new(0),
            _ => unknown_command(),
        }
    }
}
