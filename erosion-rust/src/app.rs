//! Fenêtre : réglages à gauche, relief au centre, mesures à droite.

use crate::render::{self, Camera, ColorMode};
use crate::sim::{self, Climate, N, Params, Relief, Sea, World};
use eframe::egui::{self, Color32, ColorImage, Rect, Sense, Slider, TextureHandle, TextureOptions, pos2};
use std::time::{Duration, Instant};

pub struct App {
    world: World,
    params: Params,
    relief: Relief,
    seed: u32,
    cam: Camera,
    mode: ColorMode,
    view_3d: bool,
    paused: bool,
    speed: usize,
    texture: Option<TextureHandle>,
    tick_ms: f32,
}

impl App {
    pub fn new() -> Self {
        App {
            world: World::new(42, Relief::Massif),
            params: Params::default(),
            relief: Relief::Massif,
            seed: 42,
            cam: Camera::default(),
            mode: ColorMode::Naturel,
            view_3d: true,
            paused: false,
            speed: 2,
            texture: None,
            tick_ms: 0.0,
        }
    }

    fn reset(&mut self) {
        self.world = World::new(self.seed, self.relief);
    }

    fn controls(&mut self, ui: &mut egui::Ui) {
        ui.heading("Monde");
        ui.horizontal_wrapped(|ui| {
            for (name, preset) in sim::presets() {
                if ui.selectable_label(self.params == preset, name).clicked() {
                    self.params = preset;
                }
            }
        });
        ui.add_space(6.0);
        egui::ComboBox::from_label("Relief de départ").selected_text(self.relief.name()).show_ui(ui, |ui| {
            for r in Relief::ALL {
                if ui.selectable_value(&mut self.relief, r, r.name()).clicked() {
                    self.world = World::new(self.seed, r);
                }
            }
        });
        ui.horizontal(|ui| {
            ui.label("Graine");
            ui.add(egui::DragValue::new(&mut self.seed));
            if ui.button("Nouveau relief").clicked() {
                self.seed = self.seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223) % 100_000;
                self.reset();
            }
            if ui.button("Recommencer").clicked() {
                self.reset();
            }
        });

        let p = &mut self.params;
        ui.separator();
        egui::CollapsingHeader::new("Atmosphère").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.temperature, -120.0..=500.0).text("Température").suffix(" °C")).on_hover_text("Au niveau de la mer, avant effet de serre. Décide si l'eau gèle, coule ou bout.");
            ui.add(Slider::new(&mut p.pressure, 0.0..=10.0).logarithmic(true).smallest_positive(0.001).text("Pression").suffix(" bar")).on_hover_text("Sous 0,006 bar l'eau liquide n'existe pas. Un air dense porte mieux le sable.");
            ui.add(Slider::new(&mut p.co2, 1.0..=1_000_000.0).logarithmic(true).text("CO2").suffix(" ppm")).on_hover_text("Réchauffe (3 °C par doublement), rend la pluie plus acide, nourrit les plantes. Sous 100 ppm elles meurent.");
            ui.add(Slider::new(&mut p.uv, 0.0..=100.0).text("UV de l'étoile")).on_hover_text("Terre = 30. Trop d'UV au sol stérilise la végétation.");
            ui.add(Slider::new(&mut p.ozone, 0.0..=1.0).text("Couche d'ozone")).on_hover_text("Arrête jusqu'à 90 % des UV.");
        });
        egui::CollapsingHeader::new("Eau").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.rain, 0.0..=3.0).text("Précipitations")).on_hover_text("1 = climat tempéré humide.");
            ui.add(Slider::new(&mut p.storm, 0.3..=4.0).text("Violence des averses")).on_hover_text("Peu de grosses averses creusent plus que beaucoup de bruine.");
            ui.add(Slider::new(&mut p.sea_level, 0.0..=1500.0).text("Niveau de la mer").suffix(" m"));
            ui.add(Slider::new(&mut p.infiltration, 0.0..=1.0).text("Infiltration")).on_hover_text("Part de l'eau qui s'enfonce dans le sol au lieu de ruisseler.");
        });
        egui::CollapsingHeader::new("Vent").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.wind_dir, 0.0..=360.0).text("Direction").suffix("°"));
            ui.add(Slider::new(&mut p.wind_speed, 0.0..=40.0).text("Vitesse").suffix(" m/s"));
            ui.add(Slider::new(&mut p.orographic, 0.0..=1.0).text("Effet du relief sur la pluie")).on_hover_text("Il pleut plus face au vent, moins derrière les montagnes.");
        });
        egui::CollapsingHeader::new("Roche").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.hardness, 0.0..=1.0).text("Dureté"));
            ui.add(Slider::new(&mut p.strata, 0.0..=1.0).text("Contraste des couches")).on_hover_text("Couches dures et tendres alternées : falaises, gradins, canyons.");
            ui.add(Slider::new(&mut p.strata_thickness, 30.0..=500.0).text("Épaisseur des couches").suffix(" m"));
            ui.add(Slider::new(&mut p.repose_deg, 15.0..=55.0).text("Angle de repos").suffix("°")).on_hover_text("Pente maximale d'un tas d'éboulis.");
            ui.add(Slider::new(&mut p.uplift, 0.0..=5.0).text("Soulèvement").suffix(" mm/an")).on_hover_text("La tectonique fait remonter le massif pendant que l'érosion l'use.");
        });
        egui::CollapsingHeader::new("Vivant").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.veg_growth, 0.0..=1.0).text("Taux de végétation")).on_hover_text("Vitesse à laquelle les plantes colonisent le sol.");
            ui.add(Slider::new(&mut p.veg_max, 0.0..=1.0).text("Couverture maximale"));
        });
        egui::CollapsingHeader::new("Planète").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.gravity, 0.2..=3.0).text("Gravité").suffix(" g")).on_hover_text("Accélère l'eau et les éboulis, alourdit le sable face au vent.");
        });
        egui::CollapsingHeader::new("Processus actifs").default_open(false).show(ui, |ui| {
            ui.checkbox(&mut p.on_water, "Eau courante");
            ui.checkbox(&mut p.on_frost, "Gel et chocs thermiques");
            ui.checkbox(&mut p.on_chem, "Altération chimique");
            ui.checkbox(&mut p.on_wind, "Vent");
            ui.checkbox(&mut p.on_ice, "Glaciers");
            ui.checkbox(&mut p.on_life, "Végétation");
        });
    }

    fn readouts(&mut self, ui: &mut egui::Ui) {
        let p = &self.params;
        let c = Climate::from(p);
        ui.heading("Mesures");
        let years = self.world.years();
        ui.label(if years >= 1e6 { format!("Temps écoulé : {:.2} millions d'années", years / 1e6) } else { format!("Temps écoulé : {:.0} ans", years) });
        ui.label(format!("Calcul : {:.1} ms par pas de {} ans", self.tick_ms, sim::YEARS_PER_TICK));
        ui.separator();
        ui.label(format!("Température effective : {:.0} °C ({:+.1} °C dus au CO2)", c.t_eff, c.greenhouse));
        ui.label(match c.boil {
            Some(b) => format!("L'eau bout à {b:.0} °C"),
            None => "Pression trop faible : pas d'eau liquide".to_owned(),
        });
        ui.label(match c.sea {
            Sea::Liquid => "Mer : liquide",
            Sea::Frozen => "Mer : gelée",
            Sea::None => "Mer : évaporée ou absente",
        });
        ui.label(format!("UV au sol : {:.1} {}", c.uv_ground, if c.uv_ground > 25.0 { "(stérilisant)" } else if c.uv_ground > 10.0 { "(nocif pour les plantes)" } else { "(supportable)" }));
        let (green, iced, alt) = self.world.summary(p);
        ui.label(format!("Végétation : {:.0} % des terres", green * 100.0));
        ui.label(format!("Glace : {:.0} % des terres", iced * 100.0));
        ui.label(format!("Altitude moyenne : {alt:.0} m"));
        ui.separator();
        ui.label("Qui déplace la matière en ce moment");
        let s = self.world.stats;
        let rows = [("Eau courante", s.hydraulic), ("Éboulements", s.talus), ("Gel", s.frost), ("Chimie", s.chemical), ("Vent", s.wind), ("Glaciers", s.glacial)];
        let top = rows.iter().map(|r| r.1).fold(1e-9f32, f32::max);
        for (name, v) in rows {
            ui.add(egui::ProgressBar::new(v / top).text(format!("{name}  {:.0} %", v / top * 100.0)));
        }
    }
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        // Simulation : autant de pas que demandé, sans dépasser le temps d'une image
        if !self.paused {
            let start = Instant::now();
            let mut done = 0;
            while done < self.speed && (done == 0 || start.elapsed() < Duration::from_millis(22)) {
                self.world.tick(&self.params);
                done += 1;
            }
            self.tick_ms = self.tick_ms * 0.9 + start.elapsed().as_secs_f32() * 1000.0 / done as f32 * 0.1;
        }

        egui::Panel::left("reglages").default_size(330.0).show(ui, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| self.controls(ui));
        });
        egui::Panel::right("mesures").default_size(290.0).show(ui, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| self.readouts(ui));
        });
        egui::Panel::top("vue").show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                if ui.button(if self.paused { "▶ Reprendre" } else { "⏸ Pause" }).clicked() {
                    self.paused = !self.paused;
                }
                ui.add(Slider::new(&mut self.speed, 1..=12).text("Vitesse"));
                ui.separator();
                ui.selectable_value(&mut self.view_3d, true, "Vue 3D");
                ui.selectable_value(&mut self.view_3d, false, "Carte");
                egui::ComboBox::from_id_salt("couleurs").selected_text(self.mode.name()).show_ui(ui, |ui| {
                    for m in ColorMode::ALL {
                        ui.selectable_value(&mut self.mode, m, m.name());
                    }
                });
                if self.view_3d {
                    ui.add(Slider::new(&mut self.cam.exaggeration, 0.3..=2.5).text("Relief exagéré"));
                }
            });
        });

        egui::CentralPanel::default().show(ui, |ui| {
            let avail = ui.available_size();
            let (colors, height) = render::shade(&self.world, &self.params, self.mode);
            let (size, bytes, draw) = if self.view_3d {
                // Même proportion que la zone d'affichage, sans dépasser une taille raisonnable à calculer
                let k = (1100.0 / avail.x).min(760.0 / avail.y).min(1.0);
                let (w, h) = (((avail.x * k) as usize).max(160), ((avail.y * k) as usize).max(120));
                ([w, h], render::render_3d(&self.params, &colors, &height, &self.cam, w, h), avail)
            } else {
                let side = avail.x.min(avail.y);
                ([N, N], render::top_down(&colors), egui::vec2(side, side))
            };
            let image = ColorImage::from_rgb(size, &bytes);
            let texture = match &mut self.texture {
                Some(t) => {
                    t.set(image, TextureOptions::LINEAR);
                    t.clone()
                }
                None => self.texture.insert(ui.ctx().load_texture("relief", image, TextureOptions::LINEAR)).clone(),
            };
            let (rect, response) = ui.allocate_exact_size(draw, Sense::drag());
            ui.painter().image(texture.id(), rect, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), Color32::WHITE);
            if self.view_3d {
                // Glisser pour tourner autour du relief, molette pour s'approcher
                let d = response.drag_delta();
                self.cam.yaw -= d.x * 0.006;
                self.cam.pitch = (self.cam.pitch + d.y * 0.004).clamp(0.25, 1.25);
                if response.hovered() {
                    let scroll = ui.input(|i| i.smooth_scroll_delta.y);
                    self.cam.dist = (self.cam.dist * (1.0 - scroll * 0.0015)).clamp(300.0, 1300.0);
                }
            }
        });

        ui.ctx().request_repaint();
    }
}
