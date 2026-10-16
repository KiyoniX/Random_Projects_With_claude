//! `portage` : l'outil en ligne de commande du portage PC de Pokémon X.
//!
//!   portage replay <capture> [--scale N] [--out dossier]     rejoue une capture, écrit les PNG des deux écrans
//!   portage compare <capture> <dossier de référence> [--out dossier]
//!                                                          compare l'image native avec celle du banc (numpy)
//!   portage compare-images <dossier de référence> <dossier>  compare les PNG de même nom (ex. banc et runtime --dessiner)
//!   portage window <capture> [--scale N]                     affiche une capture rejouée dans une fenêtre
//!   portage play [--scale N] [--seconds S] [--screenshot-at T PRÉFIXE]
//!                                                          le jeu en direct dans une fenêtre (voir `play.rs`) ; capture
//!                                                          ce que la fenêtre présente à la fin d'image de l'heure T du jeu
//!   portage bench <capture> [répétitions] [--scale N]        temps par image, à froid puis à chaud
//!   portage overlay <dossier pc de mods-build>               lit et contrôle overlay.json et romfs/

mod play;
mod window;

use std::path::{Path, PathBuf};
use std::time::Instant;

use capture::Capture;
use pica::images::{diff, save_png};
use pica::{Pica, ScreenImage};

fn usage() -> ! {
    eprintln!(
        "usage :\n  portage replay <capture> [--scale N] [--out dossier]\n  portage compare <capture> <référence> [--out dossier]\n  portage compare-images <référence> <dossier>\n  portage window <capture> [--scale N]\n  portage play [--scale N] [--seconds S] [--screenshot-at T PRÉFIXE]"
    );
    std::process::exit(2);
}

struct Options {
    direct: bool,
    scale: u32,
    out: Option<PathBuf>,
    /// `play` : quitter après tant de secondes réelles.
    seconds: Option<f64>,
    /// `play` : capturer la fenêtre à cette heure du jeu, dans des PNG à ce préfixe.
    screenshot: Option<(f64, String)>,
    positional: Vec<String>,
}

fn parse(args: &[String]) -> Options {
    let mut o = Options { direct: false, scale: 1, out: None, seconds: None, screenshot: None, positional: Vec::new() };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--scale" => {
                i += 1;
                o.scale = args.get(i).and_then(|s| s.parse().ok()).unwrap_or_else(|| usage());
            }
            "--direct" => o.direct = true,
            "--screenshot-at" => {
                let at = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or_else(|| usage());
                o.screenshot = Some((at, args.get(i + 2).cloned().unwrap_or_else(|| usage())));
                i += 2;
            }
            "--seconds" => {
                i += 1;
                o.seconds = Some(args.get(i).and_then(|s| s.parse().ok()).unwrap_or_else(|| usage()));
            }
            "--out" => {
                i += 1;
                o.out = Some(PathBuf::from(args.get(i).unwrap_or_else(|| usage())));
            }
            other => o.positional.push(other.to_string()),
        }
        i += 1;
    }
    o
}

pub struct Replayed {
    pub memory_checksum: u32,
    pub memory_dump: Vec<(u32, Vec<u8>)>,
    pub images: Vec<ScreenImage>,
    pub setup_seconds: f64,
    pub replay_seconds: f64,
    pub adapter: String,
    pub notes: Vec<(String, u64)>,
    pub stats: pica::render::Stats,
    /// Le GPU du rendu (pour afficher les images sans second appareil).
    pub gpu: pica::render::Gpu,
}

/// Rejoue toutes les commandes d'une capture.
pub fn replay(capture: &Capture, scale: u32) -> Result<Replayed, String> {
    let start = Instant::now();
    if std::env::var_os("PORTAGE_TRACE_CMD").is_some() {
        for c in &capture.commands {
            if c.kind() == 3 {
                eprintln!("transfert : source {:x} destination {:x} entrée {}x{} sortie {}x{} drapeaux {:x}", c.words[1], c.words[2], c.words[3] & 0xFFFF, c.words[3] >> 16, c.words[4] & 0xFFFF, c.words[4] >> 16, c.words[5]);
            }
        }
    }
    let mut pica = Pica::new(capture, scale)?;
    pica.eager_transfers = std::env::var_os("PORTAGE_EAGER").is_some();
    let setup_seconds = start.elapsed().as_secs_f64();
    let start = Instant::now();
    let mut images = Vec::new();
    for command in &capture.commands {
        if let Some(image) = pica.run_command(command) {
            images.push(image);
        }
    }
    pica.finish();
    let replay_seconds = start.elapsed().as_secs_f64();
    Ok(Replayed {
        memory_checksum: pica.memory.checksum(),
        memory_dump: if std::env::var_os("PORTAGE_DUMP_MEM").is_some() { pica.memory.regions().map(|(a, d)| (a, d.to_vec())).collect() } else { Vec::new() },
        images,
        setup_seconds,
        replay_seconds,
        adapter: pica.renderer.adapter_name.clone(),
        notes: pica.renderer.notes.iter().map(|(k, v)| (k.clone(), *v)).collect(),
        stats: pica.renderer.stats.clone(),
        gpu: pica.renderer.gpu(),
    })
}

fn name(image: &ScreenImage) -> String {
    format!("ecran-{:02}-{}.png", image.index, if image.top { "haut" } else { "bas" })
}

fn cmd_replay(o: Options) -> Result<(), String> {
    let path = o.positional.first().unwrap_or_else(|| usage());
    let capture = Capture::load(Path::new(path)).map_err(|e| format!("{path} : {e}"))?;
    let out = o.out.unwrap_or_else(|| PathBuf::from(format!("rejeu-x{}", o.scale)));
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let r = replay(&capture, o.scale)?;
    for image in &r.images {
        save_png(&out.join(name(image)), image.width, image.height, &image.rgba)?;
        println!("  {} : {}x{}, {}", name(image), image.width, image.height, if image.from_gpu { "tampon du GPU" } else { "mémoire (taille native)" });
    }
    println!(
        "{} : {} commandes, {} images à l'échelle {} sur {} ; mise en place {:.2} s, rejeu {:.3} s ({:.1} ms par image)",
        path,
        capture.commands.len(),
        r.images.len(),
        o.scale,
        r.adapter,
        r.setup_seconds,
        r.replay_seconds,
        1000.0 * r.replay_seconds / r.images.len().max(1) as f64
    );
    println!("  mémoire finale : crc {:08x}", r.memory_checksum);
    if let Some(dir) = std::env::var_os("PORTAGE_DUMP_MEM") {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        for (address, data) in &r.memory_dump {
            std::fs::write(Path::new(&dir).join(format!("{address:08x}.bin")), data).map_err(|e| e.to_string())?;
        }
    }
    println!("  {:?}", r.stats);
    for (note, n) in &r.notes {
        println!("  note : {note} ({n})");
    }
    Ok(())
}

/// Les PNG d'un dossier, triés par nom.
fn png_names(dir: &Path) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("{} : {e}", dir.display()))?;
    let mut names: Vec<String> =
        entries.filter_map(|e| e.ok()?.file_name().into_string().ok()).filter(|n| n.ends_with(".png")).collect();
    names.sort();
    Ok(names)
}

/// Compare image par image deux dossiers de PNG de mêmes noms : écart moyen et maximal de chacune, puis le pire.
fn cmd_compare_images(o: Options) -> Result<(), String> {
    if o.positional.len() < 2 {
        usage();
    }
    let (reference, dir) = (Path::new(&o.positional[0]), Path::new(&o.positional[1]));
    let (names, others) = (png_names(reference)?, png_names(dir)?);
    let (mut compared, mut worst_mean, mut worst_max) = (0usize, 0f64, 0u8);
    for name in &names {
        let Ok(image) = image::open(dir.join(name)) else {
            println!("  {name} : absente de {}", dir.display());
            continue;
        };
        let image = image.to_rgba8();
        let expected = image::open(reference.join(name)).map_err(|e| format!("{name} : {e}"))?.to_rgb8();
        if image.dimensions() != expected.dimensions() {
            println!("  {name} : tailles différentes ({:?} contre {:?})", image.dimensions(), expected.dimensions());
            continue;
        }
        let (w, h) = image.dimensions();
        let d = diff(image.as_raw(), expected.as_raw(), 3, w as usize, h as usize);
        println!("  {name} : écart moyen {:.3}/255, écart maximal {}, {:.2} % des points diffèrent", d.mean_abs, d.max, d.differing);
        compared += 1;
        worst_mean = worst_mean.max(d.mean_abs);
        worst_max = worst_max.max(d.max);
    }
    let extra = others.iter().filter(|n| !names.contains(n)).count();
    println!("{compared} image(s) comparée(s) sur {} de référence ({extra} en plus dans {}) ; pire écart moyen {worst_mean:.3}/255, écart maximal {worst_max}",
        names.len(), dir.display());
    Ok(())
}

fn cmd_compare(o: Options) -> Result<(), String> {
    if o.positional.len() < 2 {
        usage();
    }
    let (path, reference) = (&o.positional[0], Path::new(&o.positional[1]));
    let capture = Capture::load(Path::new(path)).map_err(|e| format!("{path} : {e}"))?;
    let out = o.out.unwrap_or_else(|| PathBuf::from("comparaison"));
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let r = replay(&capture, 1)?;
    println!("{path} sur {} : rejeu {:.3} s pour {} images ({:.1} ms par image)", r.adapter, r.replay_seconds, r.images.len(), 1000.0 * r.replay_seconds / r.images.len().max(1) as f64);
    for image in &r.images {
        let file = reference.join(name(image));
        let Ok(reference_image) = image::open(&file) else {
            println!("  {} : pas de référence ({})", name(image), file.display());
            continue;
        };
        let reference_image = reference_image.to_rgb8();
        if reference_image.width() as usize != image.width || reference_image.height() as usize != image.height {
            println!("  {} : tailles différentes", name(image));
            continue;
        }
        save_png(&out.join(name(image)), image.width, image.height, &image.rgba)?;
        let d = diff(&image.rgba, reference_image.as_raw(), 3, image.width, image.height);
        save_png(&out.join(name(image).replace(".png", "-diff.png")), image.width, image.height, &d.image)?;
        println!(
            "  {} : écart moyen {:.3}/255, {:.2} % des points diffèrent, {:.2} % de plus de 8, écart maximal {}",
            name(image),
            d.mean_abs,
            d.differing,
            d.big,
            d.max
        );
    }
    for (note, n) in &r.notes {
        println!("  note : {note} ({n})");
    }
    Ok(())
}

/// Mesure le temps par image du jeu (une image du jeu = un transfert vers l'écran du haut, avec les écrans du bas qui
/// l'accompagnent) : le premier rejeu (à froid : pipelines, shaders et textures à créer) puis les suivants (à chaud).
///
/// Par défaut, chaque rejeu rend aussi les octets des images et finit par `finish` (la mémoire du jeu est mise à jour) :
/// c'est ce que fait `replay`. Avec `--direct`, comme un affichage en direct : pas de relecture des images, la mémoire
/// n'est pas mise à jour, le rejeu finit quand le GPU a fini (temps « sérialisé »), puis tous les rejeux sont aussi
/// enchaînés sans attendre (temps « enchaîné » : le processeur prépare l'image suivante pendant que le GPU dessine).
fn cmd_bench(o: Options) -> Result<(), String> {
    let path = o.positional.first().unwrap_or_else(|| usage());
    let repeat: usize = o.positional.get(1).and_then(|s| s.parse().ok()).unwrap_or(20);
    let capture = Capture::load(Path::new(path)).map_err(|e| format!("{path} : {e}"))?;
    let start = Instant::now();
    let mut pica = Pica::new(&capture, o.scale)?;
    pica.readback = !o.direct;
    let setup = start.elapsed().as_secs_f64();
    let mut times = Vec::new();
    let (mut transfers, mut frames) = (0, 0);
    let one_pass = |pica: &mut Pica, transfers: &mut usize, frames: &mut usize| {
        *transfers = 0;
        *frames = 0;
        for command in &capture.commands {
            let top = command.kind() == 3 && (command.words[4] >> 16) == 400;
            if pica.run_command(command).is_some() {
                *transfers += 1;
                *frames += top as usize;
            }
        }
    };
    for _ in 0..repeat {
        let start = Instant::now();
        one_pass(&mut pica, &mut transfers, &mut frames);
        if o.direct {
            pica.wait_gpu();
        } else {
            pica.finish();
        }
        times.push(start.elapsed().as_secs_f64());
    }
    let frames = frames.max(1);
    if std::env::var_os("PORTAGE_PROFILE").is_some() {
        // un rejeu de plus, mesuré étape par étape (à chaud)
        pica.renderer.stats.time.clear();
        let mut by_kind: std::collections::BTreeMap<u32, f64> = Default::default();
        let start = Instant::now();
        for command in &capture.commands {
            let t = Instant::now();
            pica.run_command(command);
            *by_kind.entry(command.kind()).or_insert(0.0) += t.elapsed().as_secs_f64();
        }
        let t = Instant::now();
        if o.direct {
            pica.wait_gpu();
        } else {
            pica.finish();
        }
        let finish = t.elapsed().as_secs_f64();
        println!("profil à chaud d'un rejeu ({:.1} ms) :", 1000.0 * start.elapsed().as_secs_f64());
        for (k, v) in &by_kind {
            println!("  commande {k} : {:.2} ms", 1000.0 * v);
        }
        println!("  fin ({}) : {:.2} ms", if o.direct { "attente du GPU" } else { "finish" }, 1000.0 * finish);
        for (k, v) in &pica.renderer.stats.time {
            println!("  . {k} : {:.2} ms", 1000.0 * v);
        }
        println!("  {:?}", pica.renderer.stats);
    }
    let warm: Vec<f64> = times[1..].to_vec();
    let mean = warm.iter().sum::<f64>() / warm.len().max(1) as f64;
    let best = warm.iter().cloned().fold(f64::MAX, f64::min);
    let mut line = format!(
        "{path} échelle {} sur {} ({}) : mise en place {:.2} s ; {} transferts, {frames} images du jeu ; à froid {:.1} ms ({:.1} ms par image du jeu) ; à chaud (moyenne de {}) {:.1} ms ({:.2} ms par image du jeu), meilleur {:.1} ms ({:.2} par image)",
        o.scale,
        pica.renderer.adapter_name,
        if o.direct { "direct" } else { "avec images et mémoire" },
        setup,
        transfers,
        1000.0 * times[0],
        1000.0 * times[0] / frames as f64,
        warm.len(),
        1000.0 * mean,
        1000.0 * mean / frames as f64,
        1000.0 * best,
        1000.0 * best / frames as f64
    );
    if o.direct {
        // les rejeux enchaînés, une seule attente à la fin
        let n = repeat.max(2);
        let (mut t2, mut f2) = (0, 0);
        let start = Instant::now();
        for _ in 0..n {
            one_pass(&mut pica, &mut t2, &mut f2);
        }
        pica.wait_gpu();
        let total = start.elapsed().as_secs_f64();
        line += &format!(" ; enchaîné ({n} rejeux) {:.2} ms par image du jeu", 1000.0 * total / (n * f2.max(1)) as f64);
    }
    println!("{line}");
    Ok(())
}

fn cmd_overlay(o: Options) -> Result<(), String> {
    let dir = o.positional.first().unwrap_or_else(|| usage());
    let overlay = overlay::Overlay::load(Path::new(dir)).map_err(|e| e.to_string())?;
    for m in overlay.mods() {
        println!("mod {} {} ({})", m.id, m.version, m.name);
    }
    overlay.verify_all().map_err(|e| e.to_string())?;
    for f in overlay.files() {
        println!("  {f} : {} octets, contrôle sha1 ok", overlay.entry(f).map(|e| e.size).unwrap_or(0));
    }
    println!("{} correctifs de code", overlay.code_patches().len());
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((command, rest)) = args.split_first() else { usage() };
    let options = parse(rest);
    let result = match command.as_str() {
        "replay" => cmd_replay(options),
        "compare" => cmd_compare(options),
        "compare-images" => cmd_compare_images(options),
        "play" => play::run(options.scale, options.seconds, options.screenshot),
        "overlay" => cmd_overlay(options),
        "bench" => cmd_bench(options),
        "window" => window::run(options.positional.first().cloned().unwrap_or_else(|| usage()), options.scale),
        _ => usage(),
    };
    if let Err(e) = result {
        eprintln!("erreur : {e}");
        std::process::exit(1);
    }
}
