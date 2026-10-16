//! Comparaison de deux journaux de même format (celui du banc Python, `banc/journal.py`, et celui du runtime Rust).
//!
//! Le journal est une ligne par événement : `[  heure ms] f40 svc 21 …`, `… IPC …`, `fil … créé`, `=== palier …`. La
//! comparaison se fait ligne à ligne, en trois niveaux : exacte (heure comprise), sans l'heure, et sans l'heure ni la
//! partie « où » (`@pc fonction <- lr fonction`). Elle rend le nombre de lignes identiques à chaque niveau et le premier
//! écart de chacun, avec le contexte.

use std::fmt::Write;

/// Retire l'heure du début de ligne : `[     3.202 ms] reste` -> `reste`.
pub fn strip_stamp(line: &str) -> &str {
    if line.starts_with('[') {
        if let Some(end) = line.find("ms] ") {
            return &line[end + 4..];
        }
    }
    line
}

/// Retire la fin « @0x… fonction <- 0x… fonction » ajoutée par `Journal.where`.
pub fn strip_where(line: &str) -> &str {
    match line.rfind("   @0x") {
        Some(at) => &line[..at],
        None => line,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Divergence {
    /// Numéro de ligne (à partir de 1).
    pub line: usize,
    pub left: String,
    pub right: String,
}

#[derive(Debug, Default)]
pub struct Report {
    pub left_lines: usize,
    pub right_lines: usize,
    /// Lignes identiques en tête, pour chaque niveau.
    pub same_exact: usize,
    pub same_no_time: usize,
    pub same_no_where: usize,
    pub first_exact: Option<Divergence>,
    pub first_no_time: Option<Divergence>,
    pub first_no_where: Option<Divergence>,
}

fn first_difference(left: &[&str], right: &[&str], key: impl Fn(&str) -> &str) -> (usize, Option<Divergence>) {
    let n = left.len().min(right.len());
    for i in 0..n {
        if key(left[i]) != key(right[i]) {
            return (i, Some(Divergence { line: i + 1, left: left[i].to_string(), right: right[i].to_string() }));
        }
    }
    if left.len() != right.len() {
        let line = n + 1;
        return (n, Some(Divergence {
            line,
            left: left.get(n).map(|s| s.to_string()).unwrap_or_else(|| "(fin du journal)".into()),
            right: right.get(n).map(|s| s.to_string()).unwrap_or_else(|| "(fin du journal)".into()),
        }));
    }
    (n, None)
}

/// Compare deux journaux (textes entiers). Les lignes de bilan de fin (`=== arrêt`) ne comptent pas : elles disent
/// pourquoi chaque exécution s'est arrêtée, pas ce qu'elle a fait.
pub fn compare(left: &str, right: &str) -> Report {
    let keep = |text: &str| -> Vec<String> {
        text.lines().filter(|l| !strip_stamp(l).starts_with("=== arrêt")).map(|s| s.to_string()).collect()
    };
    let (l, r) = (keep(left), keep(right));
    let l: Vec<&str> = l.iter().map(|s| s.as_str()).collect();
    let r: Vec<&str> = r.iter().map(|s| s.as_str()).collect();
    let (same_exact, first_exact) = first_difference(&l, &r, |s| s);
    let (same_no_time, first_no_time) = first_difference(&l, &r, strip_stamp);
    let (same_no_where, first_no_where) = first_difference(&l, &r, |s| strip_where(strip_stamp(s)));
    Report { left_lines: l.len(), right_lines: r.len(), same_exact, same_no_time, same_no_where, first_exact,
        first_no_time, first_no_where }
}

fn show(out: &mut String, title: &str, same: usize, divergence: &Option<Divergence>) {
    let _ = writeln!(out, "{title} : {same} lignes identiques en tête");
    match divergence {
        None => {
            let _ = writeln!(out, "    aucun écart");
        }
        Some(d) => {
            let _ = writeln!(out, "    premier écart à la ligne {} :", d.line);
            let _ = writeln!(out, "    - gauche : {}", d.left);
            let _ = writeln!(out, "    - droite : {}", d.right);
        }
    }
}

pub fn render(report: &Report, left_name: &str, right_name: &str) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "gauche : {left_name} ({} lignes)", report.left_lines);
    let _ = writeln!(out, "droite : {right_name} ({} lignes)", report.right_lines);
    show(&mut out, "exact (heure comprise)", report.same_exact, &report.first_exact);
    show(&mut out, "sans l'heure", report.same_no_time, &report.first_no_time);
    show(&mut out, "sans l'heure ni le « où »", report.same_no_where, &report.first_no_where);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "[     3.202 ms] f40 svc 21 CreateAddressArbiter  -> h=0x8000   @0x10e3e0 x+0x4 <- 0x1097a8 y+0x20\n\
        [     3.204 ms] f40 svc 38 GetResourceLimit  -> h=0x10001   @0x1088e8 z <- 0x10706c w\n\
        [     9.000 ms] === arrêt : fin\n";

    #[test]
    fn identical_journals_have_no_divergence() {
        let report = compare(A, A);
        assert!(report.first_exact.is_none());
        assert_eq!(report.same_exact, 2);
    }

    #[test]
    fn levels_separate_time_and_place() {
        let b = A.replace("3.204", "3.206").replace("@0x1088e8 z", "@0x1088e8 q");
        let report = compare(A, &b);
        assert_eq!(report.same_exact, 1);
        assert_eq!(report.first_exact.as_ref().unwrap().line, 2);
        // l'heure change, le « où » aussi : sans l'heure, l'écart reste (le « où » diffère)
        assert_eq!(report.same_no_time, 1);
        // sans l'heure ni le « où » : plus d'écart
        assert!(report.first_no_where.is_none());
    }

    #[test]
    fn a_missing_line_is_a_divergence() {
        let short: String = A.lines().take(1).collect::<Vec<_>>().join("\n");
        let report = compare(A, &short);
        let d = report.first_exact.unwrap();
        assert_eq!(d.line, 2);
        assert_eq!(d.right, "(fin du journal)");
    }
}
