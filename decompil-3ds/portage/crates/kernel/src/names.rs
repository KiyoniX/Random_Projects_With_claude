//! Les noms qui rendent le journal lisible : fonctions du jeu, appels système, commandes des services
//! (même rôle et mêmes règles que `banc/names.py`).
//!
//! - Fonctions du jeu : `fiches/pokemon-x.noms.tsv` (versionné) ; les débuts de fonction de Ghidra
//!   (`local/analyse/maj/gh/funcs.tsv`, s'il existe) disent dans quelle fonction tombe une adresse sans nom.
//! - Appels système et commandes IPC : la Carte des services (`carte-des-services/donnees.js`), lue telle quelle.
//!
//! Rien ici n'est indispensable : sans ces fichiers, le journal donne des adresses nues.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

#[derive(Default)]
pub struct Names {
    /// adresse -> nom
    named: HashMap<u32, String>,
    /// débuts de fonction triés
    starts: Vec<u32>,
    /// début -> fin (si Ghidra la donne)
    ends: HashMap<u32, u32>,
    /// (début, fin, nom) des modules .cro chargés, tenu par `ldr:ro`
    pub modules: Vec<(u32, u32, String)>,
    svc_names: HashMap<u32, String>,
    commands: HashMap<(String, u32), String>,
    command_ids: HashMap<(String, u32), String>,
}

fn parse_hex(text: &str) -> Option<u32> {
    let digits = text.strip_prefix("0x")?;
    u32::from_str_radix(digits, 16).ok()
}

impl Names {
    /// Rien du tout : le journal donne des adresses nues.
    pub fn empty() -> Names {
        Names::default()
    }

    /// Lit les trois sources ; un fichier absent ou illisible est simplement ignoré.
    pub fn load(names_tsv: &Path, funcs_tsv: &Path, carte: &Path) -> Names {
        let mut names = Names::default();
        if let Ok(text) = std::fs::read_to_string(names_tsv) {
            for line in text.split('\n') {
                let parts: Vec<&str> = line.trim_end_matches('\r').split('\t').collect();
                if parts.len() >= 3 && !parts[2].is_empty() {
                    if let Some(address) = parse_hex(parts[0]) {
                        names.named.insert(address, parts[2].to_string());
                    }
                }
            }
        }
        let mut starts: Vec<u32> = names.named.keys().copied().collect();
        if let Ok(text) = std::fs::read_to_string(funcs_tsv) {
            for line in text.split('\n') {
                let parts: Vec<&str> = line.trim_end_matches('\r').split('\t').collect();
                if parts.len() >= 2 {
                    if let Some(address) = parse_hex(parts[0]) {
                        starts.push(address);
                        if let Ok(size) = parts[1].parse::<u32>() {
                            names.ends.insert(address, address + size);
                        }
                    }
                }
            }
        }
        starts.sort_unstable();
        starts.dedup();
        names.starts = starts;
        if let Ok(text) = std::fs::read_to_string(carte) {
            names.load_carte(&text);
        }
        names
    }

    fn load_carte(&mut self, text: &str) {
        let Some(start) = text.find('{') else { return };
        let mut stream = serde_json::Deserializer::from_str(&text[start..]).into_iter::<serde_json::Value>();
        let Some(Ok(data)) = stream.next() else { return };
        if let Some(list) = data.get("svc").and_then(|v| v.as_array()) {
            for entry in list {
                if let (Some(n), Some(nom)) = (entry.get("n").and_then(|v| v.as_u64()), entry.get("nom").and_then(|v| v.as_str())) {
                    self.svc_names.insert(n as u32, nom.to_string());
                }
            }
        }
        if let Some(list) = data.get("services").and_then(|v| v.as_array()) {
            for service in list {
                let Some(id) = service.get("id").and_then(|v| v.as_str()) else { continue };
                let Some(commands) = service.get("commandes").and_then(|v| v.as_array()) else { continue };
                for command in commands {
                    let (Some(h), Some(n)) = (command.get("h").and_then(|v| v.as_str()), command.get("n").and_then(|v| v.as_str()))
                    else {
                        continue;
                    };
                    let Ok(header) = u32::from_str_radix(h.trim_start_matches("0x"), 16) else { continue };
                    self.commands.insert((id.to_string(), header), n.to_string());
                    self.command_ids.entry((id.to_string(), header >> 16)).or_insert_with(|| n.to_string());
                }
            }
        }
    }

    /// « nom » ou « FUN_xxxxxxxx+décalage » pour une adresse de code, ou chaîne vide si on ne sait pas.
    pub fn function(&self, address: u32) -> String {
        let address = address & !1;
        for (start, end, name) in &self.modules {
            if *start <= address && address < *end {
                return format!("{}+{:#x}", name, address - start);
            }
        }
        let index = self.starts.partition_point(|&s| s <= address);
        if index == 0 {
            return String::new();
        }
        let start = self.starts[index - 1];
        if let Some(&end) = self.ends.get(&start) {
            if address >= end && address - start > 0x2000 {
                return String::new();
            }
        }
        if address - start > 0x10000 {
            return String::new();
        }
        let name = self.named.get(&start).cloned().unwrap_or_else(|| format!("FUN_{start:08x}"));
        if address == start { name } else { format!("{}+{:#x}", name, address - start) }
    }

    pub fn svc(&self, number: u32) -> String {
        self.svc_names.get(&number).cloned().unwrap_or_else(|| format!("svc_{number:02X}"))
    }

    pub fn command(&self, service: &str, header: u32) -> String {
        if let Some(name) = self.commands.get(&(service.to_string(), header)) {
            return name.clone();
        }
        match self.command_ids.get(&(service.to_string(), header >> 16)) {
            Some(name) => format!("{name} (en-tête différent de la Carte)"),
            None => "?".to_string(),
        }
    }

    /// Pour les tests : un nom de fonction fabriqué.
    pub fn insert_function(&mut self, address: u32, name: &str) {
        self.named.insert(address, name.to_string());
        if let Err(at) = self.starts.binary_search(&address) {
            self.starts.insert(at, address);
        }
    }

    /// Pour les tests : un nom d'appel système fabriqué.
    pub fn insert_svc(&mut self, number: u32, name: &str) {
        self.svc_names.insert(number, name.to_string());
    }

    /// Pour les tests : une commande fabriquée.
    pub fn insert_command(&mut self, service: &str, header: u32, name: &str) {
        self.commands.insert((service.to_string(), header), name.to_string());
        self.command_ids.entry((service.to_string(), header >> 16)).or_insert_with(|| name.to_string());
    }

    /// Nombre de noms connus (pour un message de démarrage).
    pub fn count(&self) -> BTreeMap<&'static str, usize> {
        let mut out = BTreeMap::new();
        out.insert("fonctions nommées", self.named.len());
        out.insert("débuts de fonction", self.starts.len());
        out.insert("appels système", self.svc_names.len());
        out.insert("commandes", self.commands.len());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn function_names_follow_the_banc_rules() {
        let mut names = Names::empty();
        names.insert_function(0x100000, "entry");
        names.insert_function(0x100024, "clear_bss");
        assert_eq!(names.function(0x100000), "entry");
        assert_eq!(names.function(0x100004), "entry+0x4");
        assert_eq!(names.function(0x100025), "clear_bss"); // le bit 0 est ignoré
        assert_eq!(names.function(0x50), "");
        assert_eq!(names.function(0x200000), ""); // trop loin du dernier début (> 0x10000)
        names.modules.push((0x8000000, 0x8001000, "Mod".to_string()));
        assert_eq!(names.function(0x8000010), "Mod+0x10");
    }

    #[test]
    fn carte_is_read_from_javascript() {
        let mut names = Names::empty();
        names.load_carte(
            "const DONNEES = {\"svc\": [{\"n\": 33, \"nom\": \"CreateAddressArbiter\"}], \"services\": [{\"id\": \"srv:\", \
             \"commandes\": [{\"h\": \"00010002\", \"n\": \"RegisterClient\"}]}]};\n",
        );
        assert_eq!(names.svc(33), "CreateAddressArbiter");
        assert_eq!(names.svc(1), "svc_01");
        assert_eq!(names.command("srv:", 0x00010002), "RegisterClient");
        assert_eq!(names.command("srv:", 0x00010003), "RegisterClient (en-tête différent de la Carte)");
        assert_eq!(names.command("x", 1), "?");
    }
}
