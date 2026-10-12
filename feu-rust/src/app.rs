//! Fenêtre : réglages et outils à gauche, terrain au centre, mesures à droite.

use crate::render::{self, Camera, ColorMode};
use crate::sim::{self, CELL_M, Essence, HA_PER_CELL, N, Params, Relief, Terrain, World};
use eframe::egui::{self, Color32, ColorImage, PointerButton, Rect, Sense, Slider, Stroke, TextureHandle, TextureOptions, pos2, vec2};
use glam::Vec2;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq)]
enum Tool {
    Allumer,
    PareFeu,
    Eau,
}

pub struct App {
    world: World,
    params: Params,
    terrain: Terrain,
    seed: u32,
    cam: Camera,
    mode: ColorMode,
    view_3d: bool,
    night: bool,
    paused: bool,
    speed: usize,
    tool: Tool,
    /// Largeur du pare-feu ou du largage, en mètres.
    width_m: f32,
    /// Dernière case touchée pendant que le bouton est enfoncé, pour tracer un trait continu.
    last: Option<Vec2>,
    texture: Option<TextureHandle>,
    tick_ms: f32,
}

fn compass(deg: f32) -> &'static str {
    ["le nord", "le nord-est", "l'est", "le sud-est", "le sud", "le sud-ouest", "l'ouest", "le nord-ouest"][((deg.rem_euclid(360.0) + 22.5) / 45.0) as usize % 8]
}

impl App {
    pub fn new() -> Self {
        let (params, terrain) = (Params::default(), Terrain::default());
        App {
            world: World::new(42, &terrain, &params),
            params,
            terrain,
            seed: 42,
            cam: Camera::default(),
            mode: ColorMode::Naturel,
            view_3d: true,
            night: false,
            paused: false,
            speed: 4,
            tool: Tool::Allumer,
            width_m: 60.0,
            last: None,
            texture: None,
            tick_ms: 0.0,
        }
    }

    fn reset(&mut self) {
        self.world = World::new(self.seed, &self.terrain, &self.params);
    }

    fn controls(&mut self, ui: &mut egui::Ui) {
        ui.heading("Outils");
        ui.radio_value(&mut self.tool, Tool::Allumer, "Allumer un feu");
        ui.radio_value(&mut self.tool, Tool::PareFeu, "Tracer un pare-feu");
        ui.radio_value(&mut self.tool, Tool::Eau, "Larguer de l'eau");
        ui.add(Slider::new(&mut self.width_m, 40.0..=240.0).text("Largeur").suffix(" m")).on_hover_text("Un pare-feu étroit arrête les flammes, pas les brandons que le vent emporte par-dessus.");
        ui.weak("Clic gauche sur le terrain, en maintenant pour tracer.");

        ui.separator();
        ui.heading("Météo");
        ui.horizontal_wrapped(|ui| {
            for (name, preset) in sim::presets() {
                if ui.selectable_label(self.params == preset, name).clicked() {
                    self.params = preset;
                }
            }
        });
        let p = &mut self.params;
        egui::CollapsingHeader::new("Vent").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.wind_dir, 0.0..=360.0).text("Direction").suffix("°")).on_hover_text("Direction vers laquelle le vent souffle : 0° = nord, 90° = est.");
            ui.add(Slider::new(&mut p.wind_kmh, 0.0..=100.0).text("Vitesse").suffix(" km/h")).on_hover_text("Le vent couche les flammes vers l'avant : le front s'allonge et accélère.");
            ui.add(Slider::new(&mut p.gusts, 0.0..=1.0).text("Rafales")).on_hover_text("Le vent forcit, mollit et tourne jusqu'à 35° de part et d'autre.");
        });
        egui::CollapsingHeader::new("Air").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.humidity, 5.0..=100.0).text("Humidité de l'air").suffix(" %")).on_hover_text("Le bois mort se met à l'équilibre avec l'air en une petite heure.");
            ui.add(Slider::new(&mut p.temperature, 0.0..=45.0).text("Température").suffix(" °C"));
            ui.add(Slider::new(&mut p.drought, 0.0..=60.0).text("Jours sans pluie")).on_hover_text("La sécheresse vide les réserves des ubacs, des vallons et des feuillus.");
            ui.add(Slider::new(&mut p.rain, 0.0..=10.0).text("Pluie").suffix(" mm/h")).on_hover_text("Trempe le combustible : au-delà de l'humidité d'extinction, le feu meurt.");
        });
        egui::CollapsingHeader::new("Feu").default_open(true).show(ui, |ui| {
            ui.add(Slider::new(&mut p.spread, 0.2..=3.0).text("Vitesse de propagation"));
            ui.add(Slider::new(&mut p.slope, 0.0..=2.0).text("Effet de la pente")).on_hover_text("Un feu monte bien plus vite qu'il ne descend.");
            ui.add(Slider::new(&mut p.spotting, 0.0..=3.0).text("Sautes de feu")).on_hover_text("Brandons emportés par le vent, qui allument des foyers au-delà du front.");
        });

        ui.separator();
        ui.heading("Terrain");
        let before = self.terrain.clone();
        egui::ComboBox::from_label("Relief").selected_text(self.terrain.relief.name()).show_ui(ui, |ui| {
            for r in Relief::ALL {
                ui.selectable_value(&mut self.terrain.relief, r, r.name());
            }
        });
        ui.add(Slider::new(&mut self.terrain.conifers, 0.0..=1.0).text("Part de résineux"));
        ui.add(Slider::new(&mut self.terrain.density, 0.3..=1.0).text("Densité du couvert"));
        ui.add(Slider::new(&mut self.terrain.water, 0.0..=0.25).text("Niveau de l'eau"));
        if self.terrain != before {
            self.reset();
        }
        ui.horizontal(|ui| {
            ui.label("Graine");
            if ui.add(egui::DragValue::new(&mut self.seed)).changed() {
                self.reset();
            }
            if ui.button("Nouveau terrain").clicked() {
                self.seed = self.seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223) % 100_000;
                self.reset();
            }
            if ui.button("Recommencer").clicked() {
                self.reset();
            }
        });
    }

    /// Clavier : ZQSD, WASD ou flèches pour se déplacer, Maj + flèches pour tourner, Page préc./suiv. pour le zoom.
    fn keyboard(&mut self, ctx: &egui::Context) {
        if ctx.egui_wants_keyboard_input() {
            return;
        }
        use egui::Key;
        let (dt, shift, ahead, side, zoom, recentre, pause) = ctx.input(|i| {
            let axis = |plus: &[Key], minus: &[Key]| {
                let held = |keys: &[Key]| keys.iter().any(|k| i.key_down(*k)) as i32 as f32;
                held(plus) - held(minus)
            };
            (
                i.stable_dt.min(0.1),
                i.modifiers.shift,
                axis(&[Key::ArrowUp, Key::W, Key::Z], &[Key::ArrowDown, Key::S]),
                axis(&[Key::ArrowRight, Key::D], &[Key::ArrowLeft, Key::A, Key::Q]),
                axis(&[Key::PageDown, Key::Minus], &[Key::PageUp, Key::Plus, Key::Equals]),
                i.key_pressed(Key::R),
                i.key_pressed(Key::Space),
            )
        });
        if self.view_3d {
            if shift {
                self.cam.yaw += side * dt * 1.4;
                self.cam.pitch = (self.cam.pitch + ahead * dt * 0.8).clamp(0.25, 1.25);
            } else {
                // Plus on est loin, plus on avance vite : la traversée de l'image prend le même temps
                let speed = self.cam.dist * 0.6 * dt;
                self.cam.pan(ahead * speed, side * speed);
            }
            self.cam.dist = (self.cam.dist * (1.0 + zoom * dt * 1.2)).clamp(180.0, 1300.0);
            if recentre {
                self.cam = Camera { exaggeration: self.cam.exaggeration, ..Camera::default() };
            }
        }
        if pause {
            self.paused = !self.paused;
        }
    }

    /// Applique l'outil choisi le long du trait qui va de `from` à `to` (en cases).
    fn apply(&mut self, from: Vec2, to: Vec2) {
        let r = self.width_m / 2.0 / CELL_M;
        let steps = ((to - from).length() / 0.5).ceil().max(1.0) as usize;
        for s in 0..=steps {
            let c = from.lerp(to, s as f32 / steps as f32);
            match self.tool {
                Tool::Allumer => self.world.ignite(c, 1.2),
                Tool::PareFeu => self.world.cut(c, r),
                Tool::Eau => self.world.douse(c, r),
            }
        }
    }

    fn readouts(&mut self, ui: &mut egui::Ui) {
        let p = &self.params;
        let s = self.world.stats;
        ui.heading("Mesures");
        let minutes = (self.world.time / 60.0) as u64;
        ui.label(format!("Temps écoulé : {} h {:02}", minutes / 60, minutes % 60));
        ui.label(format!("Calcul : {:.2} ms par pas de {} s", self.tick_ms, sim::DT));
        ui.separator();
        let (level, kmh) = sim::danger(p);
        ui.label(format!("Danger : {level}")).on_hover_text(format!("Un front de garrigue poussé par ce vent avancerait à {kmh:.2} km/h à plat."));
        let (_, speed) = self.world.wind(p);
        ui.label(format!("Vent du moment : {:.0} km/h", speed * 3.6));
        ui.label(format!("Bois mort : {:.0} % d'humidité", sim::dead_moisture(p) * 100.0));
        ui.label(format!("Végétation sur pied : {:.0} % en moyenne", self.world.mean_moisture() * 100.0));
        ui.separator();
        let burnt: u32 = s.burnt.iter().sum();
        let burnable: u32 = s.total.iter().skip(1).sum();
        ui.label(format!("Surface parcourue : {:.0} ha ({:.0} %)", burnt as f32 * HA_PER_CELL, burnt as f32 / burnable.max(1) as f32 * 100.0));
        ui.label(format!("En feu : {:.0} ha", self.world.burning() as f32 * HA_PER_CELL));
        ui.label(format!("Progression : {:.0} ha/h", s.pace));
        ui.label(format!("Sautes de feu : {}", s.embers));
        ui.label(format!("Pare-feu tracés : {:.1} ha", s.cut as f32 * HA_PER_CELL));
        ui.separator();
        ui.label("Ce qui a brûlé, par essence");
        for e in Essence::ALL.into_iter().skip(1) {
            let (done, all) = (s.burnt[e as usize], s.total[e as usize]);
            if all == 0 {
                continue;
            }
            let [r, g, b] = render::essence_color(e);
            ui.horizontal(|ui| {
                ui.colored_label(Color32::from_rgb(r, g, b), "■");
                ui.add(egui::ProgressBar::new(done as f32 / all as f32).text(format!("{}  {:.0} %", e.name(), done as f32 / all as f32 * 100.0))).on_hover_text(e.note());
            });
        }
    }
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.keyboard(ui.ctx());

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
                ui.add(Slider::new(&mut self.speed, 1..=30).text("Vitesse"));
                ui.separator();
                ui.selectable_value(&mut self.view_3d, true, "Vue 3D");
                ui.selectable_value(&mut self.view_3d, false, "Carte");
                egui::ComboBox::from_id_salt("couleurs").selected_text(self.mode.name()).show_ui(ui, |ui| {
                    for m in ColorMode::ALL {
                        ui.selectable_value(&mut self.mode, m, m.name());
                    }
                });
                ui.checkbox(&mut self.night, "Nuit");
                if self.view_3d {
                    ui.add(Slider::new(&mut self.cam.exaggeration, 0.5..=4.0).text("Relief exagéré"));
                    ui.weak("Clic droit glissé : tourner · molette : zoom · ZQSD ou flèches : se déplacer · R : recentrer · Espace : pause");
                }
            });
        });

        egui::CentralPanel::default().show(ui, |ui| {
            let avail = ui.available_size();
            let (colors, height) = render::shade(&self.world, self.mode, self.night);
            // La fumée d'un grand feu voile le ciel
            let smoke = (self.world.burning() as f32 / 6000.0).min(0.7);
            let (size, bytes, draw) = if self.view_3d {
                // Même proportion que la zone d'affichage, sans dépasser une taille raisonnable à calculer
                let k = (1100.0 / avail.x).min(760.0 / avail.y).min(1.0);
                let (w, h) = (((avail.x * k) as usize).max(160), ((avail.y * k) as usize).max(120));
                ([w, h], render::render_3d(&colors, &height, &self.cam, w, h, self.night, smoke), avail)
            } else {
                let side = avail.x.min(avail.y);
                ([N, N], render::top_down(&colors), vec2(side, side))
            };
            let image = ColorImage::from_rgb(size, &bytes);
            let texture = match &mut self.texture {
                Some(t) => {
                    t.set(image, TextureOptions::LINEAR);
                    t.clone()
                }
                None => self.texture.insert(ui.ctx().load_texture("terrain", image, TextureOptions::LINEAR)).clone(),
            };
            let (rect, response) = ui.allocate_exact_size(draw, Sense::click_and_drag());
            ui.painter().image(texture.id(), rect, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), Color32::WHITE);

            // Case du terrain sous le pointeur
            let cell = response.interact_pointer_pos().or(response.hover_pos()).and_then(|pos| {
                let (u, v) = ((pos.x - rect.min.x) / rect.width(), (pos.y - rect.min.y) / rect.height());
                if self.view_3d {
                    render::pick_3d(&height, &self.cam, size[0], size[1], u * size[0] as f32, v * size[1] as f32)
                } else {
                    Some(Vec2::new(u, v) * N as f32 - 0.5)
                }
            });
            let pressing = response.is_pointer_button_down_on() && ui.input(|i| i.pointer.primary_down());
            match (pressing, cell) {
                (true, Some(c)) => {
                    self.apply(self.last.unwrap_or(c), c);
                    self.last = Some(c);
                }
                (true, None) => {}
                (false, _) => self.last = None,
            }
            if self.view_3d {
                // Clic droit glissé pour tourner autour du terrain, molette pour s'approcher
                if response.dragged_by(PointerButton::Secondary) {
                    let d = response.drag_delta();
                    self.cam.yaw -= d.x * 0.006;
                    self.cam.pitch = (self.cam.pitch + d.y * 0.004).clamp(0.25, 1.25);
                }
                if response.hovered() {
                    let scroll = ui.input(|i| i.smooth_scroll_delta.y);
                    self.cam.dist = (self.cam.dist * (1.0 - scroll * 0.0015)).clamp(180.0, 1300.0);
                }
            } else if let Some(pos) = response.hover_pos() {
                let r = if self.tool == Tool::Allumer { 1.2 } else { self.width_m / 2.0 / CELL_M };
                ui.painter().circle_stroke(pos, r * rect.width() / N as f32, Stroke::new(1.5, Color32::WHITE));
            }

            // Flèche du vent, dans le repère de la vue
            let (wind, speed) = self.world.wind(&self.params);
            let dir = if self.view_3d { self.cam.on_screen(wind) } else { wind };
            let origin = rect.left_bottom() + vec2(54.0, -54.0);
            let arrow = vec2(dir.x, dir.y) * (14.0 + speed * 3.6 * 0.4).min(44.0);
            ui.painter().circle_filled(origin, 46.0, Color32::from_black_alpha(110));
            ui.painter().arrow(origin - arrow * 0.5, arrow, Stroke::new(2.5, Color32::WHITE));
            ui.painter().text(
                rect.left_bottom() + vec2(110.0, -46.0),
                egui::Align2::LEFT_CENTER,
                format!("Vent {:.0} km/h vers {}", speed * 3.6, compass(self.params.wind_dir)),
                egui::FontId::proportional(14.0),
                Color32::WHITE,
            );
        });

        ui.ctx().request_repaint();
    }
}
