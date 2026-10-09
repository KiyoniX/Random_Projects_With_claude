#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod render;
mod sim;

use std::fmt::Write as _;
use std::path::Path;

/// Mode sans fenêtre : simule chaque monde prêt à l'emploi et enregistre des images et un rapport.
/// Usage : `erosion --images <dossier> [pas]`
fn images(dir: &Path, ticks: usize) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(dir)?;
    let reliefs = sim::Relief::ALL;
    let mut report = String::new();
    for (n, (name, p)) in sim::presets().into_iter().enumerate() {
        let relief = reliefs[n % reliefs.len()];
        let mut w = sim::World::new(42, relief);
        let start = std::time::Instant::now();
        for _ in 0..ticks {
            w.tick(&p);
        }
        let per_tick = start.elapsed().as_secs_f64() * 1000.0 / ticks.max(1) as f64;
        let (colors, height) = render::shade(&w, &p, render::ColorMode::Naturel);
        let slug: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
        image::save_buffer(dir.join(format!("{n}-{slug}-carte.png")), &render::top_down(&colors), sim::N as u32, sim::N as u32, image::ExtendedColorType::Rgb8)?;
        let view = render::render_3d(&p, &colors, &height, &render::Camera::default(), 960, 560);
        image::save_buffer(dir.join(format!("{n}-{slug}-3d.png")), &view, 960, 560, image::ExtendedColorType::Rgb8)?;
        let c = sim::Climate::from(&p);
        let (green, iced, alt) = w.summary(&p);
        let s = w.stats;
        writeln!(
            report,
            "{name} ({}) : {:.0} ans, {per_tick:.1} ms/pas | T effective {:.0} °C, mer {:?}, UV au sol {:.1} | végétation {:.0} %, glace {:.0} %, altitude moyenne {alt:.0} m\n    eau {:.5}  éboulis {:.5}  gel {:.5}  chimie {:.5}  vent {:.5}  glace {:.5}",
            relief.name(),
            w.years(),
            c.t_eff,
            c.sea,
            c.uv_ground,
            green * 100.0,
            iced * 100.0,
            s.hydraulic,
            s.talus,
            s.frost,
            s.chemical,
            s.wind,
            s.glacial
        )?;
    }
    std::fs::write(dir.join("rapport.txt"), report)?;
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 3 && args[1] == "--images" {
        let ticks = args.get(3).and_then(|t| t.parse().ok()).unwrap_or(600);
        return images(Path::new(&args[2]), ticks);
    }
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default().with_inner_size([1360.0, 820.0]).with_min_inner_size([900.0, 560.0]),
        ..Default::default()
    };
    eframe::run_native("Érosion", options, Box::new(|_cc| Ok(Box::new(app::App::new()))))?;
    Ok(())
}
