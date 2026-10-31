//! `runtime` : le noyau, les services et le processeur recompilé du portage, en ligne de commande.
//!
//!   runtime run [--seconds S] [--turns N] [--minutes-pc M] [--out DOSSIER] [--dll CHEMIN] [--mod DOSSIER]
//!               [--appuis "12:A,14:START"] [--rejouer JOURNAL] [--root DOSSIER] [--appels-systeme-rares] [--dessiner [--scale N]]
//!   runtime compare JOURNAL_GAUCHE JOURNAL_DROITE      (ex. le journal du banc Python et celui du runtime)

use std::path::PathBuf;
use std::process::ExitCode;

use runtime::bench::{BUTTONS, Bench, Options, find_root};
use runtime::compare;

fn parse_presses(text: &str) -> Result<Vec<(f64, f64, u32)>, String> {
    let mut out = Vec::new();
    for item in text.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let (when, names) = item.split_once(':').ok_or_else(|| format!("appui illisible : {item}"))?;
        let mut mask = 0;
        for name in names.split('+') {
            let upper = name.to_uppercase();
            mask |= BUTTONS.iter().find(|(n, _)| *n == upper).ok_or_else(|| format!("bouton inconnu : {name}"))?.1;
        }
        out.push((when.parse::<f64>().map_err(|e| format!("{when} : {e}"))?, 0.25, mask));
    }
    Ok(out)
}

/// Les boutons et le stylet relevés dans le journal d'une partie (`portage play`). Le journal note la fin d'image où ils
/// changent, arrondie à la microseconde : on avance d'une milliseconde pour que le changement tombe sur cette même image.
fn parse_replay(text: &str) -> (Vec<(f64, f64, u32)>, Vec<(f64, f64, u16, u16)>) {
    let (mut presses, mut touches) = (Vec::new(), Vec::new());
    let (mut held, mut stylus): (Option<(f64, u32)>, Option<(f64, u16, u16)>) = (None, None);
    for line in text.lines() {
        let Some((stamp, rest)) = line.strip_prefix('[').and_then(|l| l.split_once(" ms] ")) else { continue };
        let Ok(ms) = stamp.trim().parse::<f64>() else { continue };
        let at = ms / 1e3 - 0.001;
        if let Some(mask) = rest.strip_prefix("hid : boutons tenus 0x") {
            if let Some((start, bits)) = held.take() {
                presses.push((start, at - start, bits));
            }
            let bits = u32::from_str_radix(mask.trim(), 16).unwrap_or(0);
            if bits != 0 {
                held = Some((at, bits));
            }
        } else if let Some(point) = rest.strip_prefix("hid : stylet ") {
            if let Some((start, x, y)) = stylus.take() {
                touches.push((start, at - start, x, y));
            }
            let mut numbers = point.split(|c: char| !c.is_ascii_digit()).filter_map(|n| n.parse::<u16>().ok());
            if let (Some(x), Some(y)) = (numbers.next(), numbers.next()) {
                stylus = Some((at, x, y));
            }
        }
    }
    if let Some((start, bits)) = held {
        presses.push((start, f64::INFINITY, bits));
    }
    if let Some((start, x, y)) = stylus {
        touches.push((start, f64::INFINITY, x, y));
    }
    (presses, touches)
}

fn run(args: &[String]) -> Result<ExitCode, String> {
    let mut root = find_root();
    let mut it = args.iter();
    let mut pending: Vec<(String, String)> = Vec::new();
    let mut flags: Vec<String> = Vec::new();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--appels-systeme-rares" | "--dessiner" => flags.push(arg.clone()),
            a if a.starts_with("--") => {
                let value = it.next().ok_or_else(|| format!("{a} demande une valeur"))?;
                if a == "--root" {
                    root = PathBuf::from(value);
                } else {
                    pending.push((a.to_string(), value.clone()));
                }
            }
            other => return Err(format!("argument inattendu : {other}")),
        }
    }
    let mut options = Options::new(&root);
    for (key, value) in pending {
        match key.as_str() {
            "--seconds" | "--secondes" => options.seconds = value.parse().map_err(|e| format!("{key} : {e}"))?,
            "--turns" | "--tours" => options.turns = value.parse().map_err(|e| format!("{key} : {e}"))?,
            "--minutes-pc" => options.wall_seconds = value.parse::<f64>().map_err(|e| format!("{key} : {e}"))? * 60.0,
            "--out" | "--sortie" => options.out = PathBuf::from(value),
            "--dll" => options.dll = PathBuf::from(value),
            "--mod" => options.mod_dir = Some(PathBuf::from(value)),
            "--appuis" => options.presses = parse_presses(&value)?,
            "--rejouer" => {
                let text = String::from_utf8_lossy(&std::fs::read(&value).map_err(|e| format!("{value} : {e}"))?).into_owned();
                (options.presses, options.touches) = parse_replay(&text);
            }
            "--max-lines" => options.max_lines = value.parse().map_err(|e| format!("{key} : {e}"))?,
            "--scale" => options.scale = value.parse().map_err(|e| format!("{key} : {e}"))?,
            _ => return Err(format!("option inconnue : {key}")),
        }
    }
    if flags.iter().any(|f| f == "--appels-systeme-rares") {
        options.log_all_svc = false;
    }
    // comme le banc : les listes de commandes sont dessinées et une paire d'images par seconde va dans `out/images`
    options.draw = flags.iter().any(|f| f == "--dessiner");
    let out = options.out.clone();
    let mut bench = Bench::new(options)?;
    let reason = bench.run();
    let summary = bench.summary(&reason);
    println!("{summary}");
    let _ = std::fs::write(out.join("resume.txt"), summary + "\n");
    println!("Journal : {}", out.join("journal.txt").display());
    Ok(ExitCode::SUCCESS)
}

fn compare_command(args: &[String]) -> Result<ExitCode, String> {
    if args.len() != 2 {
        return Err("usage : runtime compare JOURNAL_GAUCHE JOURNAL_DROITE".into());
    }
    let read = |p: &str| std::fs::read_to_string(p).map_err(|e| format!("{p} : {e}"));
    let (left, right) = (read(&args[0])?, read(&args[1])?);
    let report = compare::compare(&left, &right);
    print!("{}", compare::render(&report, &args[0], &args[1]));
    Ok(if report.first_no_where.is_none() { ExitCode::SUCCESS } else { ExitCode::from(1) })
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("run") => run(&args[1..]),
        Some("compare") => compare_command(&args[1..]),
        _ => Err("usage : runtime run [options] | runtime compare GAUCHE DROITE".into()),
    };
    match result {
        Ok(code) => code,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_replay;

    #[test]
    fn replay_reads_buttons_and_stylus_from_the_journal() {
        let journal = "[  1000.000 ms] hid : boutons tenus 0x2\n[  1500.000 ms] hid : boutons tenus 0x0\n\
            [  2000.000 ms] hid : stylet Some((127, 225))\n[  2250.000 ms] hid : stylet None\n\
            [  3000.000 ms] hid : boutons tenus 0x1\n[  3100.000 ms] f40 autre ligne\n";
        let (presses, touches) = parse_replay(journal);
        assert_eq!(presses.len(), 2);
        assert!((presses[0].0 - 0.999).abs() < 1e-9 && (presses[0].1 - 0.5).abs() < 1e-9 && presses[0].2 == 2);
        assert!(presses[1].1.is_infinite() && presses[1].2 == 1, "un bouton jamais relâché reste tenu");
        assert_eq!(touches.len(), 1);
        assert!((touches[0].1 - 0.25).abs() < 1e-9 && touches[0].2 == 127 && touches[0].3 == 225);
    }
}
