#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod render;
mod sim;

use glam::Vec2;
use std::fmt::Write as _;
use std::path::Path;

/// Mode sans fenêtre : allume un feu sous chaque météo prête à l'emploi, derrière un pare-feu qui barre la moitié
/// du passage, puis enregistre des images et un rapport.
/// Usage : `feu --images <dossier> [pas]`
fn images(dir: &Path, ticks: usize) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(dir)?;
    let n = sim::N as f32;
    let mut report = String::new();
    for (k, (name, p)) in sim::presets().into_iter().enumerate() {
        let terrain = sim::Terrain { relief: sim::Relief::ALL[k % sim::Relief::ALL.len()], ..Default::default() };
        let mut w = sim::World::new(42, &terrain, &p);
        let (wind, _) = w.wind(&p);
        let across = Vec2::new(-wind.y, wind.x);
        let centre = Vec2::splat(n / 2.0);
        w.ignite(centre - wind * n * 0.25, 3.0);
        for s in 0..=200 {
            w.cut(centre + across * n * 0.3 * s as f32 / 200.0, 1.5);
        }
        let start = std::time::Instant::now();
        for _ in 0..ticks {
            w.tick(&p);
        }
        let per_tick = start.elapsed().as_secs_f64() * 1000.0 / ticks.max(1) as f64;
        let slug: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
        let (colors, height) = render::shade(&w, render::ColorMode::Naturel, false);
        image::save_buffer(dir.join(format!("{k}-{slug}-carte.png")), &render::top_down(&colors), sim::N as u32, sim::N as u32, image::ExtendedColorType::Rgb8)?;
        let (colors, height_night) = render::shade(&w, render::ColorMode::Naturel, true);
        let view = render::render_3d(&colors, &height_night, &render::Camera::default(), 960, 560, true, 0.3);
        image::save_buffer(dir.join(format!("{k}-{slug}-3d-nuit.png")), &view, 960, 560, image::ExtendedColorType::Rgb8)?;
        let (colors, _) = render::shade(&w, render::ColorMode::Essences, false);
        let view = render::render_3d(&colors, &height, &render::Camera::default(), 960, 560, false, 0.0);
        image::save_buffer(dir.join(format!("{k}-{slug}-essences.png")), &view, 960, 560, image::ExtendedColorType::Rgb8)?;
        let (level, kmh) = sim::danger(&p);
        let burnt: u32 = w.stats.burnt.iter().sum();
        let by: Vec<String> = sim::Essence::ALL.iter().map(|&e| format!("{} {}/{}", e.name(), w.stats.burnt[e as usize], w.stats.total[e as usize])).collect();
        writeln!(
            report,
            "{name} ({}) : {:.1} h, {per_tick:.3} ms/pas | danger {level} ({kmh:.2} km/h) | parcouru {:.0} ha, en feu {:.0} ha, {:.0} ha/h, {} sautes | humidité moyenne {:.1} %\n    {}",
            terrain.relief.name(),
            w.time / 3600.0,
            burnt as f32 * sim::HA_PER_CELL,
            w.burning() as f32 * sim::HA_PER_CELL,
            w.stats.pace,
            w.stats.embers,
            w.mean_moisture() * 100.0,
            by.join(", ")
        )?;
    }
    std::fs::write(dir.join("rapport.txt"), report)?;
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 3 && args[1] == "--images" {
        let ticks = args.get(3).and_then(|t| t.parse().ok()).unwrap_or(2400);
        return images(Path::new(&args[2]), ticks);
    }
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default().with_inner_size([1360.0, 820.0]).with_min_inner_size([900.0, 560.0]),
        ..Default::default()
    };
    eframe::run_native("Feu de forêt", options, Box::new(|_cc| Ok(Box::new(app::App::new()))))?;
    Ok(())
}
