//! Le chargement : `Memory`, `relocate` (les types de correction de ro), `LoadedModule` et `Linker`.
//!
//! Port de la partie « Chargement » et « Placement » de `outils/cro_loader.py`. Là où le Python partage des
//! objets (un tampon `bytearray` que la mémoire et le module regardent tous deux), la mémoire possède ici les
//! tampons et les modules gardent leur numéro (`image_buffer`, `data_buffer`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::rc::Rc;

use crate::format::*;

/// Une plage d'adresses du Linker : (début, fin, numéro du tampon, décalage dans le tampon).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Region {
    start: u64,
    end: u64,
    buffer: usize,
    offset: usize,
}

/// Les octets que le chargement modifie : le code principal et, pour chaque module, son fichier et son `.data`
/// (`Memory`). Si `recording` est vrai, chaque écriture réussie est notée (adresse, largeur) : c'est le
/// `RecordingMemory` de `ldr_ro.py`, que l'appelant vide avec [`Memory::take_writes`].
#[derive(Debug, Default)]
pub struct Memory {
    buffers: Vec<Vec<u8>>,
    regions: Vec<Region>,
    pub recording: bool,
    writes: Vec<(u64, usize)>,
}

impl Memory {
    pub fn new() -> Memory {
        Memory::default()
    }

    /// Prend possession d'un tampon et rend son numéro.
    pub fn add_buffer(&mut self, bytes: Vec<u8>) -> usize {
        self.buffers.push(bytes);
        self.buffers.len() - 1
    }

    /// Le contenu d'un tampon.
    pub fn buffer(&self, id: usize) -> &[u8] {
        &self.buffers[id]
    }

    /// Place un tampon (ou `size` octets de lui à partir de `offset`) à l'adresse `start` (`Memory.add`).
    pub fn add(&mut self, start: u64, buffer: usize, offset: usize, size: Option<usize>) {
        let size = size.unwrap_or(self.buffers[buffer].len().saturating_sub(offset));
        self.regions.push(Region { start, end: start + size as u64, buffer, offset });
    }

    /// Retire toutes les plages qui regardent l'un de ces tampons (le déchargement d'un module).
    pub fn remove_regions_of(&mut self, buffers: &[usize]) {
        self.regions.retain(|r| !buffers.contains(&r.buffer));
    }

    /// Où se trouve l'adresse : (numéro du tampon, décalage dans ce tampon), ou `None` (`Memory.locate`).
    pub fn locate(&self, address: u64, width: usize) -> Option<(usize, usize)> {
        for r in &self.regions {
            if r.start <= address && address + width as u64 <= r.end {
                return Some((r.buffer, r.offset + (address - r.start) as usize));
            }
        }
        None
    }

    /// Les `width` octets à cette adresse, s'ils sont dans la mémoire du Linker.
    pub fn read_bytes(&self, address: u64, width: usize) -> Option<&[u8]> {
        let (buffer, at) = self.locate(address, width)?;
        self.buffers[buffer].get(at..at + width)
    }

    /// Le mot de 32 bits à cette adresse (`Memory.read32`).
    pub fn read32(&self, address: u64) -> Option<u32> {
        let b = self.read_bytes(address, 4)?;
        Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    /// Écrit `value` (tronquée à 32 bits, ou à 16 si `width` n'est pas 4) ; faux si l'adresse est hors mémoire
    /// (`Memory.write`).
    pub fn write(&mut self, address: u64, value: i64, width: usize) -> bool {
        let Some((buffer, at)) = self.locate(address, width) else {
            return false;
        };
        let bytes = if width == 4 { (value as u32).to_le_bytes().to_vec() } else { (value as u16).to_le_bytes().to_vec() };
        let target = &mut self.buffers[buffer];
        if at + bytes.len() > target.len() {
            return false;
        }
        target[at..at + bytes.len()].copy_from_slice(&bytes);
        if self.recording {
            self.writes.push((address, width));
        }
        true
    }

    /// Les écritures notées depuis la dernière fois, dans l'ordre (`RecordingMemory.writes`), et remet la liste à zéro.
    pub fn take_writes(&mut self) -> Vec<(u64, usize)> {
        std::mem::take(&mut self.writes)
    }
}

/// Une correction, comme ro (0x14004050). Rend `None` si tout va bien, sinon la raison du refus (`relocate`).
pub fn relocate(memory: &mut Memory, write_address: u64, kind: u8, addend: i32, symbol: u64, place: u64) -> Option<String> {
    let (symbol, place, addend) = (symbol as i64, place as i64, addend as i64);
    let value = (symbol + addend - place) & 0xFFFF_FFFF;
    let distance = ((place - symbol) & 0xFFFF_FFFF) as u32 as i32 as i64;
    let ok = match kind {
        0 => return None,
        2 | 38 => memory.write(write_address, symbol + addend, 4),
        3 => memory.write(write_address, value, 4),
        42 => {
            let signed31 = (((symbol << 1) & 0xFFFF_FFFF) as u32 as i32 >> 1) as i64;
            memory.write(write_address, addend + signed31 - place, 4)
        }
        28 => {
            if !(-0x1FF_FFFF..=0x1FF_FFFF).contains(&distance) {
                return Some("branchement ARM trop loin".to_string());
            }
            let word = if symbol & 1 != 0 {
                0xFA00_0000 | ((value << 23) & 0x100_0000) | ((value & 0x3FF_FFFF) >> 2)
            } else {
                0xEB00_0000 | ((value & 0x3FF_FFFF) >> 2)
            };
            memory.write(write_address, word, 4)
        }
        29 => {
            if !(-0x1FF_FFFF..=0x1FF_FFFF).contains(&distance) || symbol & 1 != 0 {
                return Some("branchement ARM trop loin ou vers du Thumb".to_string());
            }
            let Some(old) = memory.read32(write_address) else {
                return Some("mot hors mémoire".to_string());
            };
            memory.write(write_address, ((old & 0xFF00_0000) as i64) | ((value & 0x3FF_FFFF) >> 2), 4)
        }
        10 => {
            if !(-0x40_0000 < distance && distance <= 0x3F_FFFF) {
                return Some("branchement Thumb trop loin".to_string());
            }
            let mut value = value;
            let low = if symbol & 1 != 0 {
                0xF800 | (((value << 20) & 0xFFFF_FFFF) >> 21)
            } else {
                if value & 2 != 0 {
                    value = (value + 2) & 0xFFFF_FFFF;
                }
                0xE800 | (((value << 20) & 0xFFFF_FFFF) >> 21)
            };
            let high = 0xF000 | (((value << 9) & 0xFFFF_FFFF) >> 21);
            memory.write(write_address, high, 2) && memory.write(write_address + 2, low, 2)
        }
        other => return Some(format!("type de correction {other} inconnu de ro")),
    };
    if ok { None } else { Some(format!("mot {write_address:#x} hors mémoire")) }
}

/// Un module chargé (`LoadedModule`). Les octets de son fichier (`image`) et de son `.data` sont dans la
/// [`Memory`] du Linker, aux tampons `image_buffer` et `data_buffer`.
#[derive(Debug)]
pub struct LoadedModule {
    pub cro: Cro,
    pub name: String,
    pub base: u64,
    pub data_address: u64,
    pub bss_address: u64,
    pub image_buffer: usize,
    pub data_buffer: usize,
    /// La table des segments telle que ro la réécrit : (adresse, taille, genre).
    pub segments: Vec<(u64, u32, u32)>,
}

impl LoadedModule {
    /// Adresse étiquetée -> adresse en mémoire, ou 0, exactement comme ro (`tag_address`).
    pub fn tag_address(&self, tag: u32) -> u64 {
        let (segment, offset) = split_tag(tag);
        match self.segments.get(segment as usize) {
            Some(&(address, size, _)) if offset < size => address + offset as u64,
            _ => 0,
        }
    }

    /// Fin du module en mémoire (`end`).
    pub fn end(&self) -> u64 {
        (self.base + self.cro.data.len() as u64).max(self.bss_address + self.cro.header.bss_size as u64)
    }
}

/// Ce que désigne une liste de corrections d'import (`batch_owner`) : genre « nom », « numéro » ou « anonyme ».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportDetail {
    /// Import par nom : le nom.
    Name(String),
    /// Import par numéro : (module visé, numéro).
    Indexed(String, u32),
    /// Import anonyme : (module visé, adresse étiquetée).
    Anonymous(String, u32),
}

impl ImportDetail {
    /// Le genre, avec le mot du Python (« nom », « numéro », « anonyme »).
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Name(_) => "nom",
            Self::Indexed(..) => "numéro",
            Self::Anonymous(..) => "anonyme",
        }
    }
}

/// Une ligne de [`Linker::unresolved`] : (module importateur, genre, détail, raison).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unresolved {
    pub importer: String,
    pub kind: &'static str,
    pub detail: ImportDetail,
    pub reason: String,
}

/// Rejoue Initialize (static.crs) puis LoadExeCRO pour chaque module, avec liaison automatique (`Linker`).
#[derive(Debug)]
pub struct Linker {
    pub memory: Memory,
    /// Le numéro du tampon du code principal, s'il y en a un (`main_code`).
    pub main_code: Option<usize>,
    pub static_module: Rc<LoadedModule>,
    /// L'ordre de la liste de ro : static.crs d'abord.
    pub chain: Vec<Rc<LoadedModule>>,
    /// (module, texte).
    pub problems: Vec<(String, String)>,
    /// (module, décalage de la liste) -> (module exportateur, adresse) ou `None`.
    pub resolution: BTreeMap<(String, u32), Option<(String, u64)>>,
    /// (module, décalage de la liste) -> genre et détail.
    pub batch_owner: BTreeMap<(String, u32), ImportDetail>,
    pub patch_log: BTreeMap<String, u64>,
    /// adresse -> (module exportateur, adresse étiquetée, nom).
    pub import_symbols: BTreeMap<u64, (String, u32, Option<String>)>,
    /// module -> adresses que ses imports ont reçues.
    pub module_targets: BTreeMap<String, BTreeSet<u64>>,
}

impl Linker {
    /// `Linker.__init__` : `crs` doit être static.crs ; `main_code` est le contenu de code.bin (copié), placé à
    /// `MAIN_BASE`. Les mots du code principal reçoivent d'abord OnUnresolved de static.crs.
    pub fn new(crs: Cro, main_code: Option<&[u8]>) -> Result<Linker, CroError> {
        if !crs.is_static {
            return invalid(format!("{} n'est pas static.crs", crs.file_name));
        }
        let mut memory = Memory::new();
        let main_buffer = main_code.map(|code| memory.add_buffer(code.to_vec()));
        let image_buffer = memory.add_buffer(crs.data.clone());
        let data_buffer = memory.add_buffer(Vec::new());
        let segments = crs.segments.iter().map(|&(offset, size, kind)| (offset as u64, size, kind)).collect();
        let static_module = Rc::new(LoadedModule {
            name: crs.name.clone(),
            cro: crs,
            base: 0,
            data_address: 0,
            bss_address: 0,
            image_buffer,
            data_buffer,
            segments,
        });
        if let Some(id) = main_buffer {
            memory.add(MAIN_BASE, id, 0, None);
        }
        let mut linker = Linker {
            memory,
            main_code: main_buffer,
            chain: vec![static_module.clone()],
            static_module: static_module.clone(),
            problems: Vec::new(),
            resolution: BTreeMap::new(),
            batch_owner: BTreeMap::new(),
            patch_log: BTreeMap::new(),
            import_symbols: BTreeMap::new(),
            module_targets: BTreeMap::new(),
        };
        linker.register_batches(&static_module);
        // Initialize : les mots du code principal reçoivent OnUnresolved de static.crs, comme dans le fichier.
        linker.reset_external(&static_module);
        Ok(linker)
    }

    /// Le code principal tel que le Linker l'a modifié.
    pub fn main_code_bytes(&self) -> Option<&[u8]> {
        self.main_code.map(|id| self.memory.buffer(id))
    }

    /// Le fichier d'un module chargé, tel que le Linker l'a modifié (`module.image`).
    pub fn image(&self, module: &LoadedModule) -> &[u8] {
        self.memory.buffer(module.image_buffer)
    }

    /// Le tampon `.data` d'un module chargé (`module.data`, taille arrondie à 8).
    pub fn data(&self, module: &LoadedModule) -> &[u8] {
        self.memory.buffer(module.data_buffer)
    }

    fn register_batches(&mut self, module: &LoadedModule) {
        let cro = &module.cro;
        for (name, batch) in &cro.named_imports {
            self.batch_owner.insert((module.name.clone(), *batch), ImportDetail::Name(name.clone()));
            self.resolution.insert((module.name.clone(), *batch), None);
        }
        for import in &cro.import_modules {
            for &(index, batch) in &import.indexed {
                self.batch_owner.insert((module.name.clone(), batch), ImportDetail::Indexed(import.name.clone(), index));
                self.resolution.insert((module.name.clone(), batch), None);
            }
            for &(tag, batch) in &import.anonymous {
                self.batch_owner.insert((module.name.clone(), batch), ImportDetail::Anonymous(import.name.clone(), tag));
                self.resolution.insert((module.name.clone(), batch), None);
            }
        }
    }

    /// Applique une liste de corrections d'import (ro, 0x1400519c) ; rend la raison d'un refus ou `None`
    /// (`_apply_batch`).
    fn apply_batch(
        &mut self,
        module: &LoadedModule,
        batch_offset: u32,
        symbol: u64,
        exporter: &str,
    ) -> Result<Option<String>, CroError> {
        if symbol == 0 {
            let who = if exporter.is_empty() { "?" } else { exporter };
            return Ok(Some(format!("symbole à 0 dans {who}")));
        }
        let key = (module.name.clone(), batch_offset);
        if module.cro.is_static && self.main_code.is_none() {
            // Sans code.bin, les mots du code principal n'existent pas ici : on retient seulement la résolution.
            self.resolution.insert(key, Some((exporter.to_string(), symbol)));
            return Ok(None);
        }
        for patch in module.cro.batch(batch_offset)? {
            let address = module.tag_address(patch.tag);
            if address == 0 || !(UNRESOLVED_SPACE.0 <= address && address < UNRESOLVED_SPACE.1) {
                self.problems.push((
                    module.name.clone(),
                    format!("correction d'import {} hors de son segment ({:#x})", patch.index, patch.tag),
                ));
                continue;
            }
            if let Some(reason) = relocate(&mut self.memory, address, patch.kind, patch.addend, symbol, address) {
                self.problems.push((module.name.clone(), format!("correction d'import {} : {reason}", patch.index)));
            }
            *self.patch_log.entry(format!("import_{}", patch_type_name(patch.kind))).or_insert(0) += 1;
        }
        self.resolution.insert(key, Some((exporter.to_string(), symbol)));
        self.module_targets.entry(module.name.clone()).or_default().insert(symbol);
        Ok(None)
    }

    /// Toutes les corrections d'import du module reçoivent son OnUnresolved, ou 0 (ro, 0x14007ae8)
    /// (`_reset_external`).
    fn reset_external(&mut self, module: &LoadedModule) {
        let symbol = module.tag_address(module.cro.header.on_unresolved);
        for patch in &module.cro.external_patches {
            let address = module.tag_address(patch.tag);
            if address != 0 {
                relocate(&mut self.memory, address, patch.kind, patch.addend, symbol, address);
            }
        }
    }

    fn resolve_named(
        &mut self,
        importer: &LoadedModule,
        name: &str,
        batch: u32,
        sources: &[Rc<LoadedModule>],
    ) -> Result<Option<String>, CroError> {
        for source in sources {
            if let Some(tag) = source.cro.find_named_export(name) {
                let address = source.tag_address(tag);
                self.import_symbols.entry(address).or_insert_with(|| (source.name.clone(), tag, Some(name.to_string())));
                return self.apply_batch(importer, batch, address, &source.name);
            }
        }
        Ok(None)
    }

    fn resolve_module_imports(
        &mut self,
        importer: &LoadedModule,
        target_name: &str,
        indexed: &[(u32, u32)],
        anonymous: &[(u32, u32)],
        exporter: &LoadedModule,
    ) -> Result<(), CroError> {
        for &(index, batch) in indexed {
            if index as usize >= exporter.cro.indexed_exports.len() {
                self.problems.push((
                    importer.name.clone(),
                    format!("import par numéro {index} absent de {}", exporter.name),
                ));
                continue;
            }
            let tag = exporter.cro.indexed_exports[index as usize];
            let address = exporter.tag_address(tag);
            self.import_symbols.entry(address).or_insert_with(|| (exporter.name.clone(), tag, None));
            if let Some(reason) = self.apply_batch(importer, batch, address, &exporter.name)? {
                self.problems.push((
                    importer.name.clone(),
                    format!("import par numéro {index} de {target_name} : {reason}"),
                ));
            }
        }
        for &(tag, batch) in anonymous {
            let address = exporter.tag_address(tag);
            if address != 0 {
                self.import_symbols.entry(address).or_insert_with(|| (exporter.name.clone(), tag, None));
            }
            if let Some(reason) = self.apply_batch(importer, batch, address, &exporter.name)? {
                self.problems.push((
                    importer.name.clone(),
                    format!("import anonyme {tag:#x} de {target_name} : {reason}"),
                ));
            }
        }
        Ok(())
    }

    /// LoadExeCRO avec liaison automatique (`load`). `base` : adresse du fichier ; `.data` et `.bss` juste après
    /// par défaut (`None`). Rend le module chargé, aussi ajouté à `chain`.
    pub fn load(
        &mut self,
        cro: Cro,
        base: u64,
        data_address: Option<u64>,
        bss_address: Option<u64>,
    ) -> Result<Rc<LoadedModule>, CroError> {
        if cro.is_static {
            return invalid("static.crs se donne au constructeur, pas à load()".to_string());
        }
        if self.chain.iter().any(|m| m.name == cro.name) {
            return invalid(format!("{} est déjà chargé", cro.name));
        }
        let h = cro.header.clone();
        let data_address = data_address.unwrap_or(base + align(cro.data.len() as u64, PAGE));
        let bss_address = bss_address.unwrap_or(data_address + align(h.data_size as u64, 8));
        for problem in cro.ro_header_problems() {
            self.problems.push((cro.name.clone(), format!("en-tête refusé par ro : {problem}")));
        }
        // LoadedModule.__init__
        let segments: Vec<(u64, u32, u32)> = cro
            .segments
            .iter()
            .map(|&(offset, size, kind)| {
                let address = if kind == 2 && size != 0 {
                    data_address
                } else if kind == 3 && size != 0 {
                    bss_address
                } else if offset != 0 {
                    base + offset as u64
                } else {
                    0
                };
                (address, size, kind)
            })
            .collect();
        let image_buffer = self.memory.add_buffer(cro.data.clone());
        let mut data = vec![0u8; align(h.data_size as u64, 8) as usize];
        let data_end = h.data_offset as usize + h.data_size as usize;
        let Some(file_data) = cro.data.get(h.data_offset as usize..data_end) else {
            return invalid(format!("{} : données hors du fichier", cro.name));
        };
        data[..h.data_size as usize].copy_from_slice(file_data);
        let has_data = !data.is_empty();
        let data_buffer = self.memory.add_buffer(data);
        let module = Rc::new(LoadedModule {
            name: cro.name.clone(),
            cro,
            base,
            data_address,
            bss_address,
            image_buffer,
            data_buffer,
            segments,
        });
        let cro = &module.cro;
        self.memory.add(base, image_buffer, 0, None);
        if has_data {
            self.memory.add(data_address, data_buffer, 0, None);
        }
        for &(address, size, kind) in &module.segments {
            if size != 0 && !(UNRESOLVED_SPACE.0 <= address && address + size as u64 <= UNRESOLVED_SPACE.1) {
                self.problems.push((
                    cro.name.clone(),
                    format!("segment {} hors de la mémoire permise", segment_kind_name(kind).unwrap_or("None")),
                ));
            }
        }
        self.register_batches(&module);
        self.reset_external(&module);
        // Exports anonymes « statiques » : des mots du code principal à remplir avec une adresse de ce module.
        let static_module = self.static_module.clone();
        for &(tag, batch) in &cro.static_anonymous_exports {
            let symbol = module.tag_address(tag);
            for patch in static_batch(cro, batch) {
                let address = static_module.tag_address(patch.tag);
                if let Some(reason) = relocate(&mut self.memory, address, patch.kind, patch.addend, symbol, address) {
                    self.problems.push((cro.name.clone(), format!("correction statique {} : {reason}", patch.index)));
                }
            }
        }
        // Corrections internes (ro, 0x140077c8).
        for patch in &cro.internal_patches {
            let place = module.tag_address(patch.tag);
            let symbol = module.segments.get(patch.flag as usize).map_or(0, |s| s.0);
            if place == 0 || symbol == 0 {
                self.problems.push((
                    cro.name.clone(),
                    format!(
                        "correction interne {} hors de son segment (cible {:#x}, segment du symbole {})",
                        patch.index, patch.tag, patch.flag
                    ),
                ));
                continue;
            }
            if let Some(reason) = relocate(&mut self.memory, place, patch.kind, patch.addend, symbol, place) {
                self.problems.push((cro.name.clone(), format!("correction interne {} : {reason}", patch.index)));
            }
            *self.patch_log.entry(format!("interne_{}", patch_type_name(patch.kind))).or_insert(0) += 1;
        }
        let chain = self.chain.clone();
        // __aeabi_atexit -> nnroAeabiAtexit_ (ro, 0x140041c0).
        for (name, batch) in &cro.named_imports {
            if name == "__aeabi_atexit" {
                for source in &chain {
                    if let Some(tag) = source.cro.find_named_export("nnroAeabiAtexit_") {
                        self.apply_batch(&module, *batch, source.tag_address(tag), &source.name)?;
                        break;
                    }
                }
            }
        }
        // Lier (ro, 0x140063d4) : ce que le module importe des modules chargés...
        for (name, batch) in &cro.named_imports {
            if self.resolution.get(&(cro.name.clone(), *batch)).is_none_or(|r| r.is_none()) {
                self.resolve_named(&module, name, *batch, &chain)?;
            }
        }
        for import in &cro.import_modules {
            if let Some(exporter) = chain.iter().find(|m| m.name == import.name) {
                self.resolve_module_imports(&module, &import.name, &import.indexed, &import.anonymous, exporter)?;
            }
        }
        // ... puis ce que les modules chargés, static.crs compris, importent du nouveau.
        for other in &chain {
            for (name, batch) in &other.cro.named_imports {
                if self.resolution.get(&(other.name.clone(), *batch)).is_none_or(|r| r.is_none()) {
                    self.resolve_named(other, name, *batch, std::slice::from_ref(&module))?;
                }
            }
            for import in &other.cro.import_modules {
                if import.name == cro.name {
                    self.resolve_module_imports(other, &import.name, &import.indexed, &import.anonymous, &module)?;
                    break;
                }
            }
        }
        self.chain.push(module.clone());
        Ok(module)
    }

    /// Le module chargé de ce nom (`module`).
    pub fn module(&self, name: &str) -> Option<&Rc<LoadedModule>> {
        self.chain.iter().find(|m| m.name == name)
    }

    /// Une liste de corrections d'import restée sans symbole, pour chaque (importateur, liste) (`unresolved`).
    pub fn unresolved(&self) -> Vec<Unresolved> {
        let loaded: BTreeSet<&str> = self.chain.iter().map(|m| m.name.as_str()).collect();
        let mut out = Vec::new();
        for ((importer, batch), result) in &self.resolution {
            if result.is_some() {
                continue;
            }
            let Some(detail) = self.batch_owner.get(&(importer.clone(), *batch)) else {
                continue;
            };
            let reason = match detail {
                ImportDetail::Name(_) => "aucun module chargé n'exporte ce nom".to_string(),
                ImportDetail::Indexed(target, _) | ImportDetail::Anonymous(target, _) => {
                    if !loaded.contains(target.as_str()) {
                        format!("module {target} pas chargé")
                    } else {
                        format!("symbole introuvable dans {target}")
                    }
                }
            };
            out.push(Unresolved { importer: importer.clone(), kind: detail.kind(), detail: detail.clone(), reason });
        }
        out
    }
}

/// La liste de corrections statiques qui commence à ce décalage (`_static_batch`). Le Python tranche une liste
/// avec un indice qui peut être négatif : même chose ici.
fn static_batch(cro: &Cro, batch_offset: u32) -> Vec<Patch> {
    let (start, _) = cro.table("static_patches");
    let first = (batch_offset as i64 - start as i64).div_euclid(12);
    let len = cro.static_patches.len() as i64;
    let first = if first < 0 { (len + first).max(0) } else { first.min(len) } as usize;
    let mut out = Vec::new();
    for patch in &cro.static_patches[first..] {
        out.push(*patch);
        if patch.flag != 0 {
            break;
        }
    }
    out
}

// --- Placement ---

/// {nom: (fichier, .data, .bss)} : une place fixe par module, dans l'ordre donné (`layout`). Le résultat est une
/// liste de (nom, places) dans cet ordre.
pub fn layout(cros: &[Cro], base: u64) -> Vec<(String, (u64, u64, u64))> {
    let mut places = Vec::new();
    let mut cursor = base;
    for cro in cros {
        let file_address = cursor;
        let data_address = file_address + align(cro.data.len() as u64, PAGE);
        let bss_address = data_address + align(cro.header.data_size as u64, 8);
        places.push((cro.name.clone(), (file_address, data_address, bss_address)));
        cursor = align(bss_address + cro.header.bss_size as u64, PAGE);
    }
    places
}

/// Lit static.crs et tous les .cro du dossier : (crs, [cro triés par nom de fichier], static.crr ou `None`)
/// (`read_romfs`).
pub fn read_romfs(folder: &Path) -> Result<(Cro, Vec<Cro>, Option<Vec<u8>>), CroError> {
    let io = |path: &Path, e: std::io::Error| CroError::Invalid(format!("lecture de {} impossible : {e}", path.display()));
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .map_err(|e| io(folder, e))?
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.to_lowercase().ends_with(".cro"))
        .collect();
    names.sort();
    let crs_path = folder.join("static.crs");
    let crs = Cro::new(&std::fs::read(&crs_path).map_err(|e| io(&crs_path, e))?, "static.crs")?;
    let mut cros = Vec::new();
    for name in &names {
        let path = folder.join(name);
        cros.push(Cro::new(&std::fs::read(&path).map_err(|e| io(&path, e))?, name)?);
    }
    let crr = std::fs::read(folder.join(".crr").join("static.crr")).ok();
    Ok((crs, cros, crr))
}

/// Charge les modules (tous, ou ceux de `only` dans cet ordre) à leur place fixe. Rend le Linker et les places
/// (`link_set`).
#[allow(clippy::type_complexity)]
pub fn link_set(
    crs: Cro,
    cros: Vec<Cro>,
    main_code: Option<&[u8]>,
    only: Option<&[String]>,
) -> Result<(Linker, Vec<(String, (u64, u64, u64))>), CroError> {
    let places = layout(&cros, MODULES_BASE);
    let order: Vec<String> = match only {
        Some(names) if !names.is_empty() => names.to_vec(),
        _ => cros.iter().map(|c| c.name.clone()).collect(),
    };
    let mut by_name: BTreeMap<String, Cro> = cros.into_iter().map(|c| (c.name.clone(), c)).collect();
    let mut linker = Linker::new(crs, main_code)?;
    for name in order {
        let Some(cro) = by_name.remove(&name) else {
            return invalid(format!("module {name} absent du dossier"));
        };
        let place = places.iter().find(|(n, _)| *n == name).map(|(_, p)| *p).unwrap_or_default();
        linker.load(cro, place.0, Some(place.1), Some(place.2))?;
    }
    Ok((linker, places))
}
