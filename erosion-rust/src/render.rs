//! Rendu sur processeur : couleurs du terrain, carte vue du dessus et vue 3D.

use crate::sim::{CELL_M, CELLS, Climate, H_MAX_M, ICE_COVER, N, Params, Sea, World, hardness_at};
use glam::{Vec2, Vec3};
use rayon::prelude::*;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ColorMode {
    Naturel,
    Altitude,
    Sediments,
    Vegetation,
    Temperature,
    Pluie,
    Eau,
    Durete,
}

impl ColorMode {
    pub const ALL: [ColorMode; 8] = [
        ColorMode::Naturel,
        ColorMode::Altitude,
        ColorMode::Sediments,
        ColorMode::Vegetation,
        ColorMode::Temperature,
        ColorMode::Pluie,
        ColorMode::Eau,
        ColorMode::Durete,
    ];
    pub fn name(self) -> &'static str {
        match self {
            ColorMode::Naturel => "Naturel",
            ColorMode::Altitude => "Altitude",
            ColorMode::Sediments => "Sédiments",
            ColorMode::Vegetation => "Végétation",
            ColorMode::Temperature => "Température",
            ColorMode::Pluie => "Pluie",
            ColorMode::Eau => "Ruissellement",
            ColorMode::Durete => "Dureté de la roche",
        }
    }
}

pub struct Camera {
    pub yaw: f32,
    pub pitch: f32,
    pub dist: f32,
    pub exaggeration: f32,
}

impl Default for Camera {
    fn default() -> Self {
        Camera { yaw: 0.9, pitch: 0.6, dist: 720.0, exaggeration: 1.6 }
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

/// Couleur ombrée de chaque case, et hauteur à afficher (terrain, glace ou surface de la mer).
pub fn shade(w: &World, p: &Params, mode: ColorMode) -> (Vec<[u8; 3]>, Vec<f32>) {
    let c = Climate::from(p);
    let sea = if c.sea == Sea::None { -1.0 } else { p.sea_level / H_MAX_M };
    let height: Vec<f32> = (0..CELLS).map(|i| w.surface(i).max(sea)).collect();
    let sun = Vec3::new(-0.55, -0.45, 0.7).normalize();
    let flux_ref = 16.0 * p.storm.max(0.2);
    let colors = (0..CELLS)
        .into_par_iter()
        .map(|i| {
            let (x, y) = (i % N, i / N);
            let ground = w.bed[i] + w.sed[i];
            let under = ground < sea;
            let t = w.temp[i];
            let wet = w.rain[i] * p.rain;
            let hard = hardness_at(w.bed[i], i, p);
            let mut col = match mode {
                ColorMode::Naturel => {
                    // Roche : couches tendres claires, couches dures sombres et rougeâtres
                    let mut col = mix(rgb(176.0, 158.0, 134.0), rgb(104.0, 78.0, 70.0), hard);
                    let soil = (w.sed[i] / 0.0012).min(1.0);
                    let earth = if c.liquid(t) { mix(rgb(214.0, 190.0, 140.0), rgb(112.0, 92.0, 66.0), wet) } else { rgb(196.0, 172.0, 140.0) };
                    col = mix(col, earth, soil * 0.9);
                    let veg = w.veg[i];
                    col = mix(col, mix(rgb(128.0, 152.0, 72.0), rgb(38.0, 88.0, 42.0), veg), (veg * 1.4).min(0.96));
                    if c.snow(t) && p.rain > 0.0 {
                        col = mix(col, rgb(236.0, 240.0, 246.0), 0.55 * wet.min(1.0));
                    }
                    if c.liquid(t) && !under {
                        let river = (w.flux[i] / flux_ref).min(1.0);
                        if river > 0.22 {
                            col = mix(col, rgb(58.0, 118.0, 190.0), (river - 0.22) * 2.2);
                        }
                    }
                    col = mix(col, rgb(226.0, 238.0, 247.0), w.ice[i] / (ICE_COVER * 2.5));
                    if under {
                        col = match c.sea {
                            Sea::Frozen => rgb(208.0, 226.0, 238.0),
                            _ => mix(rgb(72.0, 146.0, 186.0), rgb(12.0, 38.0, 88.0), (sea - ground) / 0.07),
                        };
                    }
                    if c.t_eff > 250.0 {
                        col = mix(col, rgb(190.0, 96.0, 44.0), 0.35);
                    }
                    col
                }
                ColorMode::Altitude => {
                    if under {
                        mix(rgb(70.0, 140.0, 190.0), rgb(10.0, 30.0, 80.0), (sea - ground) / 0.07)
                    } else {
                        ramp(
                            &[(0.0, rgb(70.0, 130.0, 70.0)), (0.12, rgb(160.0, 180.0, 96.0)), (0.3, rgb(206.0, 188.0, 120.0)), (0.5, rgb(150.0, 108.0, 80.0)), (0.75, rgb(122.0, 106.0, 100.0)), (1.0, rgb(246.0, 246.0, 250.0))],
                            (ground - sea.max(0.0)) / 0.75,
                        )
                    }
                }
                ColorMode::Sediments => ramp(&[(0.0, rgb(52.0, 48.0, 56.0)), (0.25, rgb(140.0, 96.0, 60.0)), (0.6, rgb(226.0, 190.0, 110.0)), (1.0, rgb(255.0, 250.0, 220.0))], w.sed[i] / 0.012),
                ColorMode::Vegetation => ramp(&[(0.0, rgb(92.0, 80.0, 70.0)), (0.3, rgb(170.0, 170.0, 90.0)), (0.65, rgb(90.0, 150.0, 70.0)), (1.0, rgb(20.0, 92.0, 44.0))], w.veg[i]),
                ColorMode::Temperature => ramp(
                    &[(-80.0, rgb(40.0, 20.0, 110.0)), (-30.0, rgb(50.0, 90.0, 200.0)), (-5.0, rgb(130.0, 200.0, 235.0)), (5.0, rgb(235.0, 245.0, 230.0)), (18.0, rgb(140.0, 205.0, 110.0)), (30.0, rgb(245.0, 215.0, 80.0)), (50.0, rgb(235.0, 120.0, 50.0)), (150.0, rgb(170.0, 30.0, 40.0)), (500.0, rgb(70.0, 10.0, 30.0))],
                    t,
                ),
                ColorMode::Pluie => ramp(&[(0.0, rgb(206.0, 172.0, 116.0)), (0.5, rgb(200.0, 196.0, 122.0)), (1.0, rgb(110.0, 176.0, 104.0)), (1.8, rgb(44.0, 130.0, 150.0)), (3.0, rgb(30.0, 66.0, 160.0))], wet),
                ColorMode::Eau => ramp(&[(0.0, rgb(30.0, 28.0, 34.0)), (0.15, rgb(40.0, 70.0, 120.0)), (0.5, rgb(60.0, 150.0, 220.0)), (1.0, rgb(220.0, 245.0, 255.0))], (w.flux[i] / flux_ref).powf(0.6)),
                ColorMode::Durete => mix(rgb(232.0, 214.0, 170.0), rgb(70.0, 40.0, 44.0), hard),
            };
            // Ombrage par la pente
            let l = height[if x > 0 { i - 1 } else { i }];
            let r = height[if x + 1 < N { i + 1 } else { i }];
            let u = height[if y > 0 { i - N } else { i }];
            let d = height[if y + 1 < N { i + N } else { i }];
            let k = H_MAX_M / CELL_M * 0.5;
            let n = Vec3::new((l - r) * k, (u - d) * k, 1.0).normalize();
            let light = 0.32 + 0.82 * n.dot(sun).max(0.0);
            col *= light;
            [(col.x.clamp(0.0, 1.0) * 255.0) as u8, (col.y.clamp(0.0, 1.0) * 255.0) as u8, (col.z.clamp(0.0, 1.0) * 255.0) as u8]
        })
        .collect();
    (colors, height)
}

/// Carte vue du dessus, en octets RGB de `N` × `N`.
pub fn top_down(colors: &[[u8; 3]]) -> Vec<u8> {
    colors.iter().flat_map(|c| c.iter().copied()).collect()
}

fn sky(p: &Params, c: &Climate, v: f32) -> Vec3 {
    // Sans air le ciel est noir ; un air chaud et dense le rend orangé
    let air = (p.pressure / 0.6).min(1.0);
    let (top, low) = if c.t_eff > 150.0 { (rgb(120.0, 70.0, 30.0), rgb(236.0, 176.0, 96.0)) } else if p.pressure < 0.05 { (rgb(70.0, 50.0, 40.0), rgb(190.0, 150.0, 120.0)) } else { (rgb(36.0, 74.0, 150.0), rgb(176.0, 208.0, 236.0)) };
    mix(rgb(4.0, 5.0, 10.0), mix(top, low, v), 0.12 + 0.88 * air)
}

/// Vue 3D en perspective : pour chaque colonne de l'écran, un rayon avance sur la carte et empile les reliefs rencontrés.
pub fn render_3d(p: &Params, colors: &[[u8; 3]], height: &[f32], cam: &Camera, width: usize, h_px: usize) -> Vec<u8> {
    let c = Climate::from(p);
    let centre = Vec2::splat(N as f32 / 2.0);
    let ground_dist = cam.dist * cam.pitch.cos();
    let cam_z = cam.dist * cam.pitch.sin();
    let forward = Vec2::new(cam.yaw.cos(), cam.yaw.sin());
    let right = Vec2::new(-forward.y, forward.x);
    let eye = centre - forward * ground_dist;
    let focal = (width as f32).min(h_px as f32 * 1.75) * 0.55;
    // Le centre de la carte tombe un peu sous le milieu de l'image
    let horizon = h_px as f32 * 0.56 - cam.pitch.tan() * focal;
    let scale = H_MAX_M / CELL_M * cam.exaggeration;
    let far = ground_dist + N as f32;
    let haze = (p.pressure / 3.0).min(0.5);
    let fog = sky(p, &c, 1.0);

    let columns: Vec<Vec<[u8; 3]>> = (0..width)
        .into_par_iter()
        .map(|sx| {
            let mut col = vec![[0u8; 3]; h_px];
            for (sy, px) in col.iter_mut().enumerate() {
                let s = sky(p, &c, sy as f32 / h_px as f32);
                *px = [(s.x * 255.0) as u8, (s.y * 255.0) as u8, (s.z * 255.0) as u8];
            }
            let dir = forward + right * ((sx as f32 - width as f32 * 0.5) / focal);
            let mut ybuf = h_px as f32;
            let mut inside = false;
            let mut t = 4.0f32;
            while t < far && ybuf > 0.0 {
                let pos = eye + dir * t;
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
                let hgt = (height[i] * (1.0 - u) * (1.0 - v) + height[i + 1] * u * (1.0 - v) + height[i + N] * (1.0 - u) * v + height[i + N + 1] * u * v) * scale;
                let y_top = horizon + (cam_z - hgt) / t * focal;
                let fade = haze * (t / far).powi(2);
                let paint = |col: &mut Vec<[u8; 3]>, from: f32, to: f32, rgb8: [u8; 3], dim: f32| {
                    let (a, b) = (from.max(0.0) as usize, (to.min(h_px as f32)) as usize);
                    let base = Vec3::new(rgb8[0] as f32, rgb8[1] as f32, rgb8[2] as f32) / 255.0 * dim;
                    let v = mix(base, fog, fade);
                    let px = [(v.x * 255.0) as u8, (v.y * 255.0) as u8, (v.z * 255.0) as u8];
                    for row in col.iter_mut().take(b).skip(a) {
                        *row = px;
                    }
                };
                if !inside {
                    // Tranche du bloc de terrain, là où le rayon entre dans la carte
                    inside = true;
                    let y_base = horizon + (cam_z + 6.0) / t * focal;
                    paint(&mut col, y_top, y_base.min(ybuf), colors[i], 0.45);
                    ybuf = ybuf.min(y_top);
                } else if y_top < ybuf {
                    paint(&mut col, y_top, ybuf, colors[i], 1.0);
                    ybuf = y_top;
                }
                t += step;
            }
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
