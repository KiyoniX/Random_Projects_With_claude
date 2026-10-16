//! Ce que fait `banc/services/ldr_ro.py` autour du Linker, sans dépendre du noyau : `LoaderState` garde le
//! Linker, la liste des empreintes autorisées et les modules chargés ; le service Rust n'a plus qu'à lire et écrire
//! la mémoire du jeu avec ce que cette structure rend (le tampon du jeu, le miroir, les mots à recopier).
//!
//! Les commandes correspondent une à une au Python : `initialize` (commande 1), `load_crr` (2), `load_exe_cro`
//! (4 et 9), `unload_cro` (5). L'habillage (projeter le miroir, invalider le cache du processeur, remplir le tampon
//! avec l'image, répondre) reste à l'appelant.

use std::collections::{BTreeMap, BTreeSet};

use crate::format::*;
use crate::linker::{LoadedModule, Linker, relocate};

/// Les décalages de l'en-tête que `convert_header` transforme en adresses (`TABLE_OFFSETS`).
pub fn table_offsets() -> Vec<u32> {
    let mut v = vec![0x84, 0xB0, 0xB8, 0xC0];
    v.extend(TABLES.iter().map(|t| t.0));
    v
}

/// Un mot (ou demi-mot) que le Linker a écrit et que l'appelant doit recopier dans la mémoire du jeu : l'adresse,
/// la valeur lue après coup dans la mémoire du Linker (ce que `ldr_ro.py: sync` recopie), et la largeur (4 ou 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WordWrite {
    pub address: u32,
    pub value: u32,
    pub width: u8,
}

/// Le résultat d'un `load_exe_cro` (`ldr_ro.py: load_exe_cro`).
#[derive(Debug, Clone)]
pub struct LoadedCro {
    /// Le nom du module (`cro.name`).
    pub name: String,
    pub buffer: u32,
    pub mirror: u32,
    /// La taille du fichier d'origine (le jeu répond avec elle).
    pub size: u32,
    /// L'image finale à écrire au miroir : `.data` corrigé en place, `convert_header` appliqué, marque FIXD.
    pub image: Vec<u8>,
    /// L'empreinte du fichier est-elle dans static.crr ?
    pub allowed: bool,
    /// Le message de `bench.note` quand elle n'y est pas.
    pub warning: Option<String>,
    /// Les mots écrits hors de l'image du module (le tampon `.data`, le code principal, les autres modules), dans
    /// l'ordre où le Linker les a écrits ; ceux qui tombent dans l'image sont déjà dans `image`.
    pub external_writes: Vec<WordWrite>,
    /// Le nombre de mots compté par `sync` : toutes les écritures du Linker, y compris celles qui tombent dans
    /// l'image (c'est le « N mots liés hors du module » du journal Python).
    pub written: usize,
    /// Les imports de ce module restés en attente (`unresolved()` filtré sur ce module).
    pub pending_imports: usize,
    /// Les problèmes relevés pour ce module pendant tout le chargement (`linker.problems` filtré).
    pub problems: Vec<String>,
    /// Les dix premières lignes de problèmes, au format du journal (« `  nom : texte` »).
    pub problem_lines: Vec<String>,
    /// La ligne de journal de `ldr_ro.py`.
    pub journal: String,
}

/// Le résultat d'un `unload_cro` (`ldr_ro.py: unload_cro`).
#[derive(Debug, Clone)]
pub struct UnloadedCro {
    pub name: String,
    pub mirror: u32,
    pub size: u32,
    /// Le fichier d'origine, à remettre dans le tampon du jeu.
    pub original: Vec<u8>,
    /// Les mots des autres modules et du code principal qui reviennent à « non résolu », à recopier.
    pub external_writes: Vec<WordWrite>,
    pub written: usize,
    pub journal: String,
}

struct Loaded {
    name: String,
    size: u32,
    original: Vec<u8>,
}

/// L'état du service `ldr:ro` : le Linker, `crr` et `loaded` de `LdrRo`.
#[derive(Default)]
pub struct LoaderState {
    linker: Option<Linker>,
    crr: BTreeSet<[u8; 32]>,
    /// adresse miroir -> module chargé.
    loaded: BTreeMap<u32, Loaded>,
}

/// `ldr_ro.py: convert_header` : les décalages de l'en-tête deviennent des adresses (`base` + décalage), la table
/// des segments reçoit les adresses de `module.segments`, les trois mots d'adresse de chaque module importé et les
/// noms des exports sont rebasés, la marque devient FIXD. `image` est modifiée sur place.
pub fn convert_header(image: &mut [u8], base: u32, module: &LoadedModule) -> Result<(), CroError> {
    let put = |image: &mut [u8], at: u64, value: u32| -> Result<(), CroError> {
        match image.get_mut(at as usize..at as usize + 4) {
            Some(slot) => {
                slot.copy_from_slice(&value.to_le_bytes());
                Ok(())
            }
            None => invalid(format!("écriture hors de l'image à {at:#x}")),
        }
    };
    for offset in table_offsets() {
        let value = u32_at(image, offset as u64)?;
        if value != 0 || offset == 0xB0 || offset == 0xB8 {
            put(image, offset as u64, base.wrapping_add(value))?;
        }
    }
    let (start, _) = module.cro.table("segments");
    for (i, &(address, _, _)) in module.segments.iter().enumerate() {
        put(image, start as u64 + 12 * i as u64, address as u32)?;
    }
    let (start, count) = module.cro.table("import_modules");
    for i in 0..count as u64 {
        for word in [0u64, 1, 3] {
            let at = start as u64 + 20 * i + 4 * word;
            let value = u32_at(image, at)?;
            put(image, at, base.wrapping_add(value))?;
        }
    }
    let (start, count) = module.cro.table("named_exports");
    for i in 0..count as u64 {
        let at = start as u64 + 8 * i;
        let value = u32_at(image, at)?;
        put(image, at, base.wrapping_add(value))?;
    }
    image[0x80..0x84].copy_from_slice(FIXED_MAGIC);
    Ok(())
}

impl LoaderState {
    pub fn new() -> LoaderState {
        LoaderState::default()
    }

    /// Le Linker, une fois `initialize` fait.
    pub fn linker(&self) -> Option<&Linker> {
        self.linker.as_ref()
    }

    /// Les empreintes autorisées par le dernier `load_crr`.
    pub fn crr(&self) -> &BTreeSet<[u8; 32]> {
        &self.crr
    }

    /// Les adresses miroir des modules chargés.
    pub fn loaded_mirrors(&self) -> Vec<u32> {
        self.loaded.keys().copied().collect()
    }

    /// Fait comme `ldr_ro.py: initialize` : `crs_bytes` est static.crs lu dans le tampon du jeu, `code` le code
    /// principal (`bench.code`), `mirror` l'adresse du miroir de ce tampon. Rend la ligne de journal. Les écritures
    /// de l'initialisation dans le code principal ne sont pas notées (le Python n'enveloppe la mémoire qu'après).
    pub fn initialize(&mut self, crs_bytes: &[u8], code: Option<&[u8]>, mirror: u32) -> Result<String, CroError> {
        let crs = Cro::new(crs_bytes, "static.crs")?;
        let journal = format!(
            "static.crs donné à ro : {} exports par nom, {} modules importés, miroir {mirror:#x}",
            crs.named_exports.len(),
            crs.import_modules.len()
        );
        let mut linker = Linker::new(crs, code)?;
        linker.memory.recording = true;
        self.linker = Some(linker);
        Ok(journal)
    }

    /// Fait comme `ldr_ro.py: load_crr` : lit la liste des empreintes autorisées et rend leur nombre.
    pub fn load_crr(&mut self, bytes: &[u8]) -> Result<usize, CroError> {
        self.crr = read_crr(bytes)?;
        Ok(self.crr.len())
    }

    /// Fait comme `ldr_ro.py: load_exe_cro`. `original` est le fichier lu dans le tampon du jeu (adresse `buffer`),
    /// `mirror` l'adresse où il apparaît, `data_address` et `bss_address` les tampons `.data` et `.bss` donnés par
    /// le jeu. Le nom du fichier pour les messages est « cro@<buffer> » comme en Python.
    pub fn load_exe_cro(
        &mut self,
        original: &[u8],
        buffer: u32,
        mirror: u32,
        data_address: u32,
        bss_address: u32,
    ) -> Result<LoadedCro, CroError> {
        let Some(linker) = self.linker.as_mut() else {
            return Err(CroError::NotInitialized);
        };
        let cro = Cro::new(original, &format!("cro@{buffer:#x}"))?;
        let allowed = self.crr.contains(&cro.crr_hash());
        let warning = (!allowed).then(|| format!("module {} : son empreinte n'est pas dans static.crr", cro.name));
        let size = original.len() as u32;
        let module = linker.load(cro, mirror as u64, Some(data_address as u64), Some(bss_address as u64))?;
        let cro = &module.cro;
        let h = &cro.header;
        let mut image = linker.image(&module).to_vec();
        let data_start = h.data_offset as usize;
        let data_size = h.data_size as usize;
        image[data_start..data_start + data_size].copy_from_slice(&linker.data(&module)[..data_size]);
        convert_header(&mut image, mirror, &module)?;
        let (written, external_writes) = sync(linker, Some((mirror as u64, size as u64)));
        self.loaded.insert(mirror, Loaded { name: module.name.clone(), size, original: original.to_vec() });
        let pending_imports = linker.unresolved().iter().filter(|u| u.importer == cro.name).count();
        let problems: Vec<String> =
            linker.problems.iter().filter(|(m, _)| *m == cro.name).map(|(_, p)| p.clone()).collect();
        let segments = module
            .segments
            .iter()
            .filter(|s| s.1 != 0)
            .map(|&(a, s, k)| {
                let kind = segment_kind_name(k).map_or_else(|| k.to_string(), str::to_string);
                format!("{kind} {a:#x}+{s:#x}")
            })
            .collect::<Vec<_>>()
            .join(", ");
        let journal = format!(
            "{} chargé au miroir {mirror:#x} (tampon {buffer:#x}, {size:#x} octets) : {segments} ; {written} mots \
             liés hors du module ; {pending_imports} imports encore en attente (modules pas chargés) ; {}",
            cro.name,
            if allowed { "empreinte autorisée" } else { "EMPREINTE ABSENTE de static.crr" }
        );
        let problem_lines = problems.iter().take(10).map(|p| format!("  {} : {p}", cro.name)).collect();
        Ok(LoadedCro {
            name: cro.name.clone(),
            buffer,
            mirror,
            size,
            image,
            allowed,
            warning,
            external_writes,
            written,
            pending_imports,
            problems,
            problem_lines,
            journal,
        })
    }

    /// Fait comme `ldr_ro.py: unload_cro` : les imports des autres modules qui visaient celui-ci reviennent à
    /// « symbole non résolu » (leur OnUnresolved, ou 0), le module sort de la chaîne et de la mémoire du Linker.
    /// Rend le fichier d'origine à remettre dans le tampon du jeu et les mots à recopier ; le miroir est à retirer
    /// par l'appelant.
    pub fn unload_cro(&mut self, mirror: u32) -> Result<UnloadedCro, CroError> {
        let Some(linker) = self.linker.as_mut() else {
            return Err(CroError::NothingLoadedAt(mirror));
        };
        let Some(entry) = self.loaded.remove(&mirror) else {
            return Err(CroError::NothingLoadedAt(mirror));
        };
        let name = entry.name.clone();
        let chain = linker.chain.clone();
        for other in &chain {
            if other.name == name {
                continue;
            }
            let on_unresolved = other.cro.header.on_unresolved;
            let fallback = if on_unresolved != NO_TAG { other.tag_address(on_unresolved) } else { 0 };
            for import in &other.cro.import_modules {
                if import.name != name {
                    continue;
                }
                for &(_, batch) in import.indexed.iter().chain(import.anonymous.iter()) {
                    for patch in other.cro.batch(batch)? {
                        let address = other.tag_address(patch.tag);
                        if address != 0 {
                            relocate(&mut linker.memory, address, patch.kind, patch.addend, fallback, address);
                        }
                    }
                    linker.resolution.insert((other.name.clone(), batch), None);
                }
            }
        }
        let Some(position) = linker.chain.iter().position(|m| m.name == name) else {
            return Err(CroError::NothingLoadedAt(mirror));
        };
        let module = linker.chain.remove(position);
        linker.memory.remove_regions_of(&[module.image_buffer, module.data_buffer]);
        let (written, external_writes) = sync(linker, None);
        let journal = format!("{name} déchargé ({written} mots remis à « non résolu »)");
        Ok(UnloadedCro { name, mirror, size: entry.size, original: entry.original, external_writes, written, journal })
    }
}

/// `ldr_ro.py: sync` : relit dans la mémoire du Linker les mots qu'il vient d'écrire. Rend leur nombre (ceux qui
/// tombent dans la mémoire du Linker) et la liste de ceux qui sont hors de `skip` (adresse, taille), plage de
/// l'image que l'appelant écrit lui-même.
fn sync(linker: &mut Linker, skip: Option<(u64, u64)>) -> (usize, Vec<WordWrite>) {
    let mut count = 0;
    let mut out = Vec::new();
    for (address, width) in linker.memory.take_writes() {
        let Some(bytes) = linker.memory.read_bytes(address, width) else {
            continue;
        };
        count += 1;
        if skip.is_some_and(|(start, size)| address >= start && address < start + size) {
            continue;
        }
        let value = if width == 4 {
            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        } else {
            u16::from_le_bytes([bytes[0], bytes[1]]) as u32
        };
        out.push(WordWrite { address: address as u32, value, width: width as u8 });
    }
    (count, out)
}
