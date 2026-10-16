//! Le journal : chaque appel système, chaque requête IPC, les fils, les modules, les paliers.
//!
//! Même format, ligne pour ligne, que `banc/journal.py` : c'est ce qui permet de comparer l'exécution Rust à celle du
//! banc Python (`runtime compare`). Les lignes s'écrivent au fil de l'eau, avec l'heure du banc en tête.

use std::collections::{BTreeMap, VecDeque};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use crate::names::Names;

/// `Journal.hex_words` : les mots en hexadécimal sur 8 chiffres, séparés par une espace ; « … » au-delà de `limit`.
pub fn hex_words(words: &[u32], limit: usize) -> String {
    let mut text = words.iter().take(limit).map(|w| format!("{w:08x}")).collect::<Vec<_>>().join(" ");
    if words.len() > limit {
        text.push_str(" …");
    }
    text
}

pub struct Journal {
    out: Option<BufWriter<File>>,
    pub names: Names,
    pub lines: usize,
    pub max_lines: usize,
    pub truncated: usize,
    /// (service, en-tête, nom) -> nombre
    pub ipc_counts: BTreeMap<(String, u32, String), u64>,
    pub ipc_kinds: BTreeMap<String, std::collections::BTreeSet<String>>,
    pub ipc_errors: Vec<String>,
    /// palier -> (heure en ns, texte), dans l'ordre d'atteinte
    pub milestones: Vec<(String, u64, String)>,
    /// (heure, texte) des écarts relevés
    pub notes: Vec<(u64, String)>,
    pub modules: Vec<(u64, String)>,
    pub last_ipc: VecDeque<String>,
    pub last_svc: VecDeque<String>,
    /// Toutes les lignes écrites, gardées en mémoire quand on le demande (tests).
    pub capture: Option<Vec<String>>,
}

pub fn stamp(now: u64) -> String {
    // '[%10.3f ms]' % (now / 1e6)
    format!("[{:10.3} ms]", now as f64 / 1e6)
}

impl Journal {
    pub fn new(path: Option<&Path>, names: Names, max_lines: usize) -> std::io::Result<Journal> {
        let out = match path {
            Some(path) => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                Some(BufWriter::new(File::create(path)?))
            }
            None => None,
        };
        Ok(Journal {
            out,
            names,
            lines: 0,
            max_lines,
            truncated: 0,
            ipc_counts: BTreeMap::new(),
            ipc_kinds: BTreeMap::new(),
            ipc_errors: Vec::new(),
            milestones: Vec::new(),
            notes: Vec::new(),
            modules: Vec::new(),
            last_ipc: VecDeque::new(),
            last_svc: VecDeque::new(),
            capture: None,
        })
    }

    /// Un journal en mémoire, pour les tests.
    pub fn in_memory(names: Names) -> Journal {
        let mut journal = Journal::new(None, names, usize::MAX).unwrap();
        journal.capture = Some(Vec::new());
        journal
    }

    pub fn write(&mut self, now: u64, text: &str) -> String {
        let line = format!("{} {}", stamp(now), text);
        if self.lines < self.max_lines {
            if let Some(out) = self.out.as_mut() {
                let _ = writeln!(out, "{line}");
            }
            if let Some(capture) = self.capture.as_mut() {
                capture.push(line.clone());
            }
            self.lines += 1;
        } else {
            self.truncated += 1;
        }
        line
    }

    /// `@0x10e3e0 svcCreateAddressArbiter+0x4 <- 0x1097a8 FUN_00109784+0x20`
    pub fn where_(&self, pc: u32, lr: u32) -> String {
        let or_question = |text: String| if text.is_empty() { "?".to_string() } else { text };
        format!("@{:#x} {} <- {:#x} {}", pc, or_question(self.names.function(pc)), lr,
            or_question(self.names.function(lr.wrapping_sub(4))))
    }

    pub fn svc(&mut self, now: u64, thread_id: u32, number: u32, pc: u32, lr: u32, summary: &str) {
        let name = self.names.svc(number);
        let summary = summary.strip_prefix(name.as_str()).unwrap_or(summary);
        let sep = if summary.starts_with('(') { "" } else { " " };
        let text = format!("f{:x} svc {:02X} {}{}{}   {}", thread_id, number, name, sep, summary, self.where_(pc, lr));
        let line = self.write(now, &text);
        self.last_svc.push_back(line);
        if self.last_svc.len() > 40 {
            self.last_svc.pop_front();
        }
    }

    /// Une requête IPC sans réponse (exception du banc).
    pub fn ipc_exception(&mut self, now: u64, thread_id: u32, label: &str, header: u32, command_name: &str, words: &[u32]) {
        let text = format!("f{:x} IPC {} {:08x} {} [{}] -> exception du banc", thread_id, label, header, command_name,
            hex_words(words, 8));
        let line = self.write(now, &text);
        self.push_ipc(line);
    }

    fn push_ipc(&mut self, line: String) {
        self.last_ipc.push_back(line);
        if self.last_ipc.len() > 40 {
            self.last_ipc.pop_front();
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ipc(&mut self, now: u64, thread_id: u32, label: &str, service_carte: &str, header: u32, request_words: &[u32],
        kind: &str, result: u32, note: &str, pc: u32, lr: u32, written_header: u32, written_words: &[u32],
        written_translate: &[u32]) {
        let name = self.names.command(service_carte, header);
        self.ipc_kinds.entry(label.to_string()).or_default().insert(kind.to_string());
        *self.ipc_counts.entry((label.to_string(), header, name.clone())).or_insert(0) += 1;
        let mut tail: Vec<u32> = written_words.iter().skip(1).copied().collect();
        tail.extend_from_slice(written_translate);
        let text = format!("f{:x} IPC {} {:08x} {} ({}) [{}] -> {:08x} {:08x} [{}]{}   {}", thread_id, label, header, name,
            kind, hex_words(request_words.get(1..).unwrap_or(&[]), 8), written_header, result, hex_words(&tail, 8),
            if note.is_empty() { String::new() } else { format!("  « {note} »") }, self.where_(pc, lr));
        let line = self.write(now, &text);
        self.push_ipc(line.clone());
        if result & 0x8000_0000 != 0 {
            self.ipc_errors.push(line);
        }
    }

    pub fn thread_created(&mut self, now: u64, parent: Option<u32>, thread_id: u32, entry: u32, priority: u32, core: i32,
        stack_top: u32, tls: u32) {
        let _ = parent;
        let text = format!("fil {:#x} créé : entrée {:#x} {}, priorité {:#x}, cœur {}, pile {:#x}, stockage local {:#x}",
            thread_id, entry, self.names.function(entry), priority, core, stack_top, tls);
        self.write(now, &text);
    }

    pub fn module(&mut self, now: u64, text: &str) {
        self.modules.push((now, text.to_string()));
        self.write(now, &format!("module : {text}"));
    }

    pub fn milestone(&mut self, now: u64, key: &str, text: &str) {
        if self.milestones.iter().any(|(k, _, _)| k == key) {
            return;
        }
        self.milestones.push((key.to_string(), now, text.to_string()));
        self.write(now, &format!("=== palier {key} : {text}"));
    }

    pub fn has_milestone(&self, key: &str) -> bool {
        self.milestones.iter().any(|(k, _, _)| k == key)
    }

    pub fn note(&mut self, now: u64, text: &str) {
        if self.notes.iter().any(|(_, n)| n == text) {
            return;
        }
        self.notes.push((now, text.to_string()));
        self.write(now, &format!("ÉCART : {text}"));
    }

    pub fn close(&mut self) {
        if let Some(out) = self.out.as_mut() {
            if self.truncated > 0 {
                let _ = writeln!(out, "… {} lignes de plus non écrites (limite {})", self.truncated, self.max_lines);
            }
            let _ = out.flush();
        }
        self.out = None;
    }
}

impl Drop for Journal {
    fn drop(&mut self) {
        if let Some(out) = self.out.as_mut() {
            let _ = out.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamp_and_hex_words_match_python() {
        assert_eq!(stamp(3_202_000), "[     3.202 ms]");
        assert_eq!(stamp(0), "[     0.000 ms]");
        assert_eq!(hex_words(&[1, 0xabc], 8), "00000001 00000abc");
        assert_eq!(hex_words(&[1, 2, 3], 2), "00000001 00000002 …");
    }

    #[test]
    fn svc_line_strips_the_name() {
        let mut names = Names::empty();
        names.insert_svc(0x21, "CreateAddressArbiter");
        names.insert_function(0x10e3dc, "svcCreateAddressArbiter");
        names.insert_function(0x109784, "FUN_00109784");
        let mut journal = Journal::in_memory(names);
        journal.svc(3_202_000, 0x40, 0x21, 0x10e3e0, 0x1097a8, "CreateAddressArbiter -> h=0x8000");
        let line = &journal.capture.as_ref().unwrap()[0];
        assert_eq!(line, "[     3.202 ms] f40 svc 21 CreateAddressArbiter  -> h=0x8000   @0x10e3e0 \
            svcCreateAddressArbiter+0x4 <- 0x1097a8 FUN_00109784+0x20");
    }
}
