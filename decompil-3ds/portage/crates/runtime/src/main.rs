//! `runtime` : le noyau, les services et le processeur recompilé du portage, en ligne de commande.
//!
//!   runtime run [--seconds S] [--turns N] [--minutes-pc M] [--out DOSSIER] [--dll CHEMIN] [--mod DOSSIER]
//!               [--appuis "12:A,14:START"] [--rejouer JOURNAL] [--garder-sauvegarde] [--donner "30:17:7,..."] [--son WAV] [--filtre-texture NOM] [--textures DOSSIER] [--extraire-textures DOSSIER] [--root DOSSIER] [--appels-systeme-rares] [--dessiner [--scale N]]
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

fn run(args: &[String]) -> Result<ExitCode, String> {
    let mut root = find_root();
    let mut it = args.iter();
    let mut pending: Vec<(String, String)> = Vec::new();
    let mut flags: Vec<String> = Vec::new();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--appels-systeme-rares" | "--dessiner" | "--garder-sauvegarde" => flags.push(arg.clone()),
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
    let mut wav = None;
    for (key, value) in pending {
        match key.as_str() {
            "--seconds" | "--secondes" => options.seconds = value.parse().map_err(|e| format!("{key} : {e}"))?,
            "--turns" | "--tours" => options.turns = value.parse().map_err(|e| format!("{key} : {e}"))?,
            "--minutes-pc" => options.wall_seconds = value.parse::<f64>().map_err(|e| format!("{key} : {e}"))? * 60.0,
            "--out" | "--sortie" => options.out = PathBuf::from(value),
            "--dll" => options.dll = PathBuf::from(value),
            "--mod" => options.mod_dir = Some(PathBuf::from(value)),
            "--appuis" => options.presses = parse_presses(&value)?,
            "--filtre-texture" => {
                options.textures.filter = pica::upscale::TextureFilter::from_name(&value).ok_or_else(|| format!("filtre inconnu : {value}"))?;
            }
            "--textures" => options.textures.pack = Some(PathBuf::from(value)),
            "--extraire-textures" => options.textures.dump = Some(PathBuf::from(value)),
            "--donner" => {
                // heure en s : objet : quantité
                for gift in value.split(',') {
                    let mut parts = gift.split(':').map(str::parse::<f64>);
                    let mut next = || parts.next().and_then(Result::ok).ok_or_else(|| format!("don illisible : {gift}"));
                    options.gifts.push((next()?, next()? as u32, next()? as u32));
                }
            }
            "--son" => {
                wav = Some(value);
                options.audio = Some(Default::default());
            }
            "--rejouer" => {
                options.replay(&value)?;
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
    options.keep_archives = flags.iter().any(|f| f == "--garder-sauvegarde");
    let out = options.out.clone();
    let audio = options.audio.clone();
    let mut bench = Bench::new(options)?;
    let reason = bench.run();
    if let (Some(path), Some(audio)) = (wav, audio) {
        let samples = audio.lock().map_err(|e| e.to_string())?;
        let mut bytes = Vec::with_capacity(44 + samples.len() * 2);
        let size = samples.len() as u32 * 2;
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + size).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        for (word, width) in [(16u32, 4), (1, 2), (2, 2), (32728, 4), (32728 * 4, 4), (4, 2), (16, 2)] {
            bytes.extend_from_slice(&word.to_le_bytes()[..width]);
        }
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&size.to_le_bytes());
        bytes.extend(samples.iter().flat_map(|s| s.to_le_bytes()));
        std::fs::write(&path, bytes).map_err(|e| format!("{path} : {e}"))?;
    }
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
