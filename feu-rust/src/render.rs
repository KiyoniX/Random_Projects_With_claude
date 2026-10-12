//! Rendu sur processeur : couleurs du terrain, carte vue du dessus et vue 3D.

use crate::sim::{CELL_M, CELLS, Essence, H_MAX_M, N, State, World};
use glam::{Vec2, Vec3};
use rayon::prelude::*;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ColorMode {
    Naturel,
    Essences,
    Humidite,
    Combustible,
    Arrivee,
    Altitude,
}

impl ColorMode {
    pub const ALL: [ColorMode; 6] = [ColorMode::Naturel, ColorMode::Essences, ColorMode::Humidite, ColorMode::Combustible, ColorMode::Arrivee, ColorMode::Altitude];
    pub fn name(self) -> &'static str {
        match self {
            ColorMode::Naturel => "Naturel",
            ColorMode::Essences => "Essences",
            ColorMode::Humidite => "Humidité du combustible",
            ColorMode::Combustible => "Combustible restant",
            ColorMode::Arrivee => "Heure d'arrivée du feu",
            ColorMode::Altitude => "Altitude",
        }
    }
}

pub struct Camera {
    /// Point du sol regardé, en cases.
    pub target: Vec2,
    pub yaw: f32,
    pub pitch: f32,
    pub dist: f32,
    pub exaggeration: f32,
}

impl Default for Camera {
    fn default() -> Self {
        Camera { target: Vec2::splat(N as f32 / 2.0), yaw: 0.9, pitch: 0.74, dist: 590.0, exaggeration: 2.4 }
    }
}

impl Camera {
    /// Déplace le point regardé : `ahead` vers le fond de l'image, `side` vers la droite.
    pub fn pan(&mut self, ahead: f32, side: f32) {
        let forward = Vec2::new(self.yaw.cos(), self.yaw.sin());
        let right = Vec2::new(-forward.y, forward.x);
        self.target = (self.target + forward * ahead + right * side).clamp(Vec2::ZERO, Vec2::splat((N - 1) as f32));
    }
    /// Direction à l'écran (x vers la droite, y vers le bas) d'un vecteur de la carte.
    pub fn on_screen(&self, v: Vec2) -> Vec2 {
        let forward = Vec2::new(self.yaw.cos(), self.yaw.sin());
        Vec2::new(v.dot(Vec2::new(-forward.y, forward.x)), -v.dot(forward))
    }
}

fn mix(a: Vec3, b: Vec3, t: f32) -> Vec3 {
    a + (b - a) * t.clamp(0.0, 1.0)
}
fn rgb(r: f32, g: f32, b: f32) -> Vec3 {
    Vec3::new(r, g, b) / 255.0
}
fn ramp(stops: &[(f32, Vec3)], v: f32) -> Vec3 {
    for w in stops.windows(2) {
        if v <= w[1].0 {
            return mix(w[0].1, w[1].1, (v - w[0].0) / (w[1].0 - w[0].0));
        }
    }
    stops[stops.len() - 1].1
}
fn bytes(c: Vec3) -> [u8; 3] {
    [(c.x.clamp(0.0, 1.0) * 255.0) as u8, (c.y.clamp(0.0, 1.0) * 255.0) as u8, (c.z.clamp(0.0, 1.0) * 255.0) as u8]
}

/// Couleur d'une essence sur la carte et dans la légende.
pub fn essence_color(e: Essence) -> [u8; 3] {
    match e {
        Essence::Nu => [152, 142, 130],
        Essence::Prairie => [204, 190, 108],
        Essence::Garrigue => [146, 148, 82],
        Essence::Pinede => [40, 92, 60],
        Essence::Chenaie => [82, 128, 54],
        Essence::Hetraie => [46, 134, 96],
        Essence::Eucalyptus => [118, 158, 142],
    }
}

/// Couleur de chaque case, et hauteur à afficher (sol, cime des arbres ou surface de l'eau).
pub fn shade(w: &World, mode: ColorMode, night: bool) -> (Vec<[u8; 3]>, Vec<f32>) {
    let height: Vec<f32> = (0..CELLS)
        .map(|i| match w.state[i] {
            State::Eau => w.level,
            _ => w.height[i] + w.essence[i].canopy_m() * w.fuel[i] / H_MAX_M,
        })
        .collect();
    let sun = Vec3::new(-0.55, -0.45, 0.7).normalize();
    let now = (w.time as f32).max(1.0);
    let flick = (w.stats.ticks / 2) as u32;
    let colors = (0..CELLS)
        .into_par_iter()
        .map(|i| {
            let (x, y) = (i % N, i / N);
            let e = w.essence[i];
            let [r, g, b] = essence_color(e);
            let kind = rgb(r as f32, g as f32, b as f32);
            let left = w.fuel[i] / w.cover[i].max(1e-3);
            let ash = mix(rgb(34.0, 30.0, 28.0), rgb(104.0, 98.0, 92.0), (w.jitter[i] - 0.7) / 0.6 * 0.22);
            if w.state[i] == State::Feu {
                // Les flammes éclairent d'elles-mêmes : jaune vif à l'allumage, braises rouges à la fin
                let h = (i as u32 ^ flick.wrapping_mul(0x9E37_79B9)).wrapping_mul(0x85EB_CA6B);
                let flicker = 0.8 + 0.2 * ((h >> 16) & 255) as f32 / 255.0;
                return bytes(ramp(&[(0.0, rgb(120.0, 22.0, 8.0)), (0.35, rgb(226.0, 70.0, 14.0)), (0.7, rgb(255.0, 150.0, 30.0)), (1.0, rgb(255.0, 236.0, 150.0))], left) * flicker);
            }
            let mut col = match (w.state[i], mode) {
                (State::Eau, _) => mix(rgb(70.0, 140.0, 186.0), rgb(20.0, 60.0, 120.0), (w.level - w.height[i]) / 0.08),
                (State::PareFeu, _) => rgb(196.0, 168.0, 124.0),
                (_, ColorMode::Arrivee) => {
                    if w.arrival[i] >= 0.0 {
                        ramp(&[(0.0, rgb(60.0, 20.0, 110.0)), (0.35, rgb(190.0, 40.0, 90.0)), (0.7, rgb(250.0, 140.0, 40.0)), (1.0, rgb(255.0, 240.0, 150.0))], w.arrival[i] / now)
                    } else {
                        rgb(118.0, 122.0, 116.0)
                    }
                }
                (_, ColorMode::Altitude) => ramp(
                    &[(0.0, rgb(70.0, 130.0, 70.0)), (0.2, rgb(160.0, 180.0, 96.0)), (0.45, rgb(206.0, 188.0, 120.0)), (0.7, rgb(150.0, 108.0, 80.0)), (1.0, rgb(240.0, 240.0, 244.0))],
                    (w.height[i] - w.level) / 0.6,
                ),
                (State::Cendre, _) => ash,
                (_, ColorMode::Essences) => kind,
                (_, ColorMode::Humidite) => {
                    if w.cover[i] > 0.0 {
                        ramp(&[(0.02, rgb(150.0, 40.0, 30.0)), (0.08, rgb(232.0, 150.0, 60.0)), (0.15, rgb(236.0, 220.0, 120.0)), (0.25, rgb(110.0, 176.0, 104.0)), (0.45, rgb(40.0, 90.0, 170.0))], w.moist[i])
                    } else {
                        rgb(118.0, 122.0, 116.0)
                    }
                }
                (_, ColorMode::Combustible) => ramp(&[(0.0, rgb(60.0, 54.0, 52.0)), (0.3, rgb(170.0, 150.0, 90.0)), (0.65, rgb(96.0, 150.0, 70.0)), (1.0, rgb(20.0, 86.0, 44.0))], w.fuel[i]),
                (_, ColorMode::Naturel) => {
                    // Un couvert clair laisse voir le sol ; un combustible sec jaunit
                    let mut col = mix(rgb(176.0, 158.0, 122.0), kind, 0.3 + 0.7 * w.cover[i]);
                    if e != Essence::Nu {
                        col = mix(col, rgb(214.0, 196.0, 120.0), (1.0 - w.moist[i] / 0.2) * 0.3);
                        // Une case éteinte en cours de route garde la trace de ce qui a brûlé
                        col = mix(col, ash, (1.0 - left) * 0.9);
                    }
                    col
                }
            };
            // Ombrage par la pente
            let l = height[if x > 0 { i - 1 } else { i }];
            let r = height[if x + 1 < N { i + 1 } else { i }];
            let u = height[if y > 0 { i - N } else { i }];
            let d = height[if y + 1 < N { i + N } else { i }];
            let k = H_MAX_M / CELL_M * 0.5;
            let n = Vec3::new((l - r) * k, (u - d) * k, 1.0).normalize();
            col *= 0.36 + 0.78 * n.dot(sun).max(0.0);
            if night {
                col *= Vec3::new(0.24, 0.29, 0.42);
            }
            bytes(col)
        })
        .collect();
    (colors, height)
}

/// Carte vue du dessus, en octets RGB de `N` × `N`.
pub fn top_down(colors: &[[u8; 3]]) -> Vec<u8> {
    colors.iter().flat_map(|c| c.iter().copied()).collect()
}

/// Couleur du ciel, de `v` = 0 en haut à 1 sur l'horizon. La fumée le roussit.
fn sky(night: bool, smoke: f32, v: f32) -> Vec3 {
    let (top, low) = if night { (rgb(5.0, 7.0, 16.0), rgb(22.0, 26.0, 44.0)) } else { (rgb(36.0, 74.0, 150.0), rgb(176.0, 208.0, 236.0)) };
    let glow = if night { rgb(120.0, 46.0, 16.0) } else { rgb(206.0, 150.0, 104.0) };
    mix(mix(top, low, v), glow, smoke * (0.25 + 0.75 * v))
}

/// Rayons de la vue 3D : un par colonne de l'écran, qui avance sur la carte.
struct Rays {
    eye: Vec2,
    forward: Vec2,
    right: Vec2,
    width: f32,
    focal: f32,
    horizon: f32,
    cam_z: f32,
    scale: f32,
    far: f32,
}

impl Rays {
    fn new(cam: &Camera, width: usize, h_px: usize) -> Self {
        let ground_dist = cam.dist * cam.pitch.cos();
        let forward = Vec2::new(cam.yaw.cos(), cam.yaw.sin());
        let focal = (width as f32).min(h_px as f32 * 1.75) * 0.55;
        Rays {
            eye: cam.target - forward * ground_dist,
            forward,
            right: Vec2::new(-forward.y, forward.x),
            width: width as f32,
            focal,
            // Le point regardé tombe un peu sous le milieu de l'image
            horizon: h_px as f32 * 0.56 - cam.pitch.tan() * focal,
            cam_z: cam.dist * cam.pitch.sin(),
            scale: H_MAX_M / CELL_M * cam.exaggeration,
            // Assez loin pour traverser la carte en diagonale, où que soit le point regardé
            far: ground_dist + N as f32 * 1.5,
        }
    }

    /// Parcourt la colonne `sx` du plus proche au plus lointain. `visit` reçoit la distance, la position sur la carte,
    /// la ligne d'écran du sommet du terrain et un drapeau pour le premier point ; il renvoie `false` pour arrêter.
    fn march(&self, height: &[f32], sx: f32, mut visit: impl FnMut(f32, Vec2, f32, bool) -> bool) {
        let dir = self.forward + self.right * ((sx - self.width * 0.5) / self.focal);
        let mut inside = false;
        let mut t = 4.0f32;
        while t < self.far {
            let pos = self.eye + dir * t;
            let step = 0.45 + t * 0.0022;
            if pos.x < 0.0 || pos.y < 0.0 || pos.x >= (N - 1) as f32 || pos.y >= (N - 1) as f32 {
                if inside {
                    break;
                }
                t += step;
                continue;
            }
            let (xi, yi) = (pos.x as usize, pos.y as usize);
            let (u, v) = (pos.x - xi as f32, pos.y - yi as f32);
            let i = yi * N + xi;
            let hgt = (height[i] * (1.0 - u) * (1.0 - v) + height[i + 1] * u * (1.0 - v) + height[i + N] * (1.0 - u) * v + height[i + N + 1] * u * v) * self.scale;
            let y_top = self.horizon + (self.cam_z - hgt) / t * self.focal;
            if !visit(t, pos, y_top, !inside) {
                break;
            }
            inside = true;
            t += step;
        }
    }
}

/// Vue 3D en perspective : chaque colonne empile les reliefs rencontrés, du plus proche au plus lointain.
pub fn render_3d(colors: &[[u8; 3]], height: &[f32], cam: &Camera, width: usize, h_px: usize, night: bool, smoke: f32) -> Vec<u8> {
    let rays = Rays::new(cam, width, h_px);
    let haze = 0.25 + 0.3 * smoke;
    let fog = sky(night, smoke, 1.0);

    let columns: Vec<Vec<[u8; 3]>> = (0..width)
        .into_par_iter()
        .map(|sx| {
            let mut col: Vec<[u8; 3]> = (0..h_px).map(|sy| bytes(sky(night, smoke, sy as f32 / h_px as f32))).collect();
            let mut ybuf = h_px as f32;
            rays.march(height, sx as f32, |t, pos, y_top, first| {
                let rgb8 = colors[pos.y as usize * N + pos.x as usize];
                let fade = haze * (t / rays.far).powi(2);
                let mut paint = |from: f32, to: f32, dim: f32| {
                    let (a, b) = (from.max(0.0) as usize, (to.min(h_px as f32)) as usize);
                    let px = bytes(mix(Vec3::new(rgb8[0] as f32, rgb8[1] as f32, rgb8[2] as f32) / 255.0 * dim, fog, fade));
                    for row in col.iter_mut().take(b).skip(a) {
                        *row = px;
                    }
                };
                if first {
                    // Tranche du bloc de terrain, là où le rayon entre dans la carte
                    let y_base = rays.horizon + (rays.cam_z + 6.0) / t * rays.focal;
                    paint(y_top, y_base.min(ybuf), 0.45);
                    ybuf = ybuf.min(y_top);
                } else if y_top < ybuf {
                    paint(y_top, ybuf, 1.0);
                    ybuf = y_top;
                }
                ybuf > 0.0
            });
            col
        })
        .collect();

    let mut out = vec![0u8; width * h_px * 3];
    for (sx, col) in columns.iter().enumerate() {
        for (sy, px) in col.iter().enumerate() {
            let o = (sy * width + sx) * 3;
            out[o..o + 3].copy_from_slice(px);
        }
    }
    out
}

/// Case du terrain visible sous le pixel (`sx`, `sy`) de la vue 3D, ou rien si c'est le ciel.
pub fn pick_3d(height: &[f32], cam: &Camera, width: usize, h_px: usize, sx: f32, sy: f32) -> Option<Vec2> {
    let mut hit = None;
    Rays::new(cam, width, h_px).march(height, sx, |_, pos, y_top, _| {
        if y_top <= sy {
            hit = Some(pos);
        }
        hit.is_none()
    });
    hit
}
