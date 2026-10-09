//! Simulation : climat, érosion par l'eau, le gel, la chimie, le vent et la glace, plus la végétation.
//!
//! Les hauteurs sont normalisées : 1.0 vaut `H_MAX_M` mètres, et une case mesure `CELL_M` mètres.

use noise::{Fbm, MultiFractal, NoiseFn, Perlin, RidgedMulti};
use rayon::prelude::*;

pub const N: usize = 384;
pub const CELLS: usize = N * N;
pub const H_MAX_M: f32 = 3000.0;
pub const CELL_M: f32 = 40.0;
pub const YEARS_PER_TICK: f64 = 500.0;
/// Épaisseur de glace (normalisée) à partir de laquelle le sol est protégé et affiché blanc.
pub const ICE_COVER: f32 = 0.0006;

const DROPS_PER_TICK: f32 = 1800.0;
const SOIL0: f32 = 0.0006;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Relief {
    Massif,
    Ile,
    Chaine,
    Plateau,
    Collines,
}

impl Relief {
    pub const ALL: [Relief; 5] = [Relief::Massif, Relief::Ile, Relief::Chaine, Relief::Plateau, Relief::Collines];
    pub fn name(self) -> &'static str {
        match self {
            Relief::Massif => "Massif montagneux",
            Relief::Ile => "Île volcanique",
            Relief::Chaine => "Chaîne de montagnes",
            Relief::Plateau => "Haut plateau",
            Relief::Collines => "Collines",
        }
    }
}

#[derive(Clone, PartialEq, Debug)]
pub struct Params {
    // Atmosphère
    pub temperature: f32, // °C au niveau de la mer, avant effet de serre
    pub pressure: f32,    // bar
    pub co2: f32,         // ppm
    pub uv: f32,          // rayonnement UV de l'étoile, Terre = 30
    pub ozone: f32,       // 0..1
    // Eau
    pub rain: f32,         // 1 = climat tempéré humide
    pub storm: f32,        // violence des averses
    pub sea_level: f32,    // m
    pub infiltration: f32, // 0..1
    // Vent
    pub wind_dir: f32,   // degrés, direction vers laquelle il souffle
    pub wind_speed: f32, // m/s
    pub orographic: f32, // 0..1
    // Roche
    pub hardness: f32,         // 0..1
    pub strata: f32,           // contraste entre couches
    pub strata_thickness: f32, // m
    pub repose_deg: f32,       // angle de repos des éboulis
    pub uplift: f32,           // soulèvement tectonique, mm/an
    // Vivant
    pub veg_growth: f32,
    pub veg_max: f32,
    // Planète
    pub gravity: f32, // g
    // Processus actifs
    pub on_water: bool,
    pub on_frost: bool,
    pub on_chem: bool,
    pub on_wind: bool,
    pub on_ice: bool,
    pub on_life: bool,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            temperature: 15.0,
            pressure: 1.0,
            co2: 400.0,
            uv: 30.0,
            ozone: 0.9,
            rain: 1.0,
            storm: 1.0,
            sea_level: 200.0,
            infiltration: 0.3,
            wind_dir: 20.0,
            wind_speed: 6.0,
            orographic: 0.6,
            hardness: 0.45,
            strata: 0.5,
            strata_thickness: 140.0,
            repose_deg: 34.0,
            uplift: 0.0,
            veg_growth: 0.5,
            veg_max: 0.9,
            gravity: 1.0,
            on_water: true,
            on_frost: true,
            on_chem: true,
            on_wind: true,
            on_ice: true,
            on_life: true,
        }
    }
}

/// Mondes prêts à l'emploi.
pub fn presets() -> Vec<(&'static str, Params)> {
    let d = Params::default();
    vec![
        ("Terre tempérée", d.clone()),
        ("Désert brûlant", Params { temperature: 41.0, rain: 0.12, storm: 2.6, wind_speed: 17.0, sea_level: 0.0, infiltration: 0.1, ..d.clone() }),
        ("Âge glaciaire", Params { temperature: 7.0, rain: 1.3, co2: 190.0, wind_speed: 9.0, ..d.clone() }),
        ("Jungle de serre", Params { temperature: 27.0, rain: 2.4, co2: 1400.0, storm: 1.4, veg_growth: 1.0, veg_max: 1.0, infiltration: 0.6, ..d.clone() }),
        ("Mars", Params { temperature: -58.0, pressure: 0.006, co2: 950_000.0, uv: 45.0, ozone: 0.0, rain: 0.0, wind_speed: 28.0, sea_level: 0.0, gravity: 0.38, ..d.clone() }),
        ("Vénus", Params { temperature: 430.0, pressure: 9.0, co2: 960_000.0, uv: 55.0, ozone: 0.0, rain: 0.0, wind_speed: 3.0, sea_level: 0.0, gravity: 0.9, ..d.clone() }),
        ("Monde irradié", Params { uv: 90.0, ozone: 0.0, ..d.clone() }),
        ("Air raréfié en CO2", Params { co2: 90.0, ..d }),
    ]
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Sea {
    Liquid,
    Frozen,
    None,
}

/// Grandeurs déduites des paramètres.
#[derive(Clone, Copy, Debug)]
pub struct Climate {
    pub t_eff: f32,
    pub greenhouse: f32,
    pub boil: Option<f32>,
    pub uv_ground: f32,
    pub lapse: f32,
    pub air: f32,
    pub sea: Sea,
}

impl Climate {
    pub fn from(p: &Params) -> Self {
        // Effet de serre : environ 3 °C par doublement du CO2, encore faut-il de l'air pour le retenir
        let greenhouse = 3.0 * (p.co2.max(1.0) / 280.0).log2() * p.pressure.min(1.0);
        let t_eff = p.temperature + greenhouse;
        // Sous le point triple (6,1 mbar), l'eau liquide n'existe pas
        let boil = if p.pressure < 0.0062 { None } else { Some(100.0 + 28.0 * p.pressure.ln()) };
        let uv_ground = p.uv * (1.0 - 0.9 * p.ozone) * (-0.35 * p.pressure).exp();
        let sea = match boil {
            None => Sea::None,
            Some(b) if t_eff >= b => Sea::None,
            Some(_) if t_eff <= -2.0 => Sea::Frozen,
            Some(_) => Sea::Liquid,
        };
        Climate { t_eff, greenhouse, boil, uv_ground, lapse: 6.5 * (p.pressure + 0.15).min(1.0), air: p.pressure.min(5.0), sea }
    }
    pub fn liquid(&self, t: f32) -> bool {
        t > 0.0 && self.boil.is_some_and(|b| t < b)
    }
    pub fn snow(&self, t: f32) -> bool {
        t <= 0.0 && self.boil.is_some()
    }
}

/// Volume déplacé par chaque processus (moyenne glissante, unités arbitraires) et temps écoulé.
#[derive(Clone, Copy, Default, Debug)]
pub struct Stats {
    pub hydraulic: f32,
    pub talus: f32,
    pub frost: f32,
    pub chemical: f32,
    pub wind: f32,
    pub glacial: f32,
    pub ticks: u64,
}

pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    pub fn f32(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
}

pub struct World {
    pub bed: Vec<f32>,
    pub sed: Vec<f32>,
    pub ice: Vec<f32>,
    pub veg: Vec<f32>,
    pub temp: Vec<f32>,
    pub rain: Vec<f32>,
    pub flux: Vec<f32>,
    shape: Vec<f32>,
    scratch: Vec<f32>,
    brush: Vec<(i32, i32, f32)>,
    rng: Rng,
    pub stats: Stats,
}

pub fn generate(seed: u32, relief: Relief) -> Vec<f32> {
    let fbm = Fbm::<Perlin>::new(seed).set_octaves(6);
    let ridged = RidgedMulti::<Perlin>::new(seed.wrapping_add(7)).set_octaves(5);
    let mut out = vec![0.0f32; CELLS];
    for (i, h) in out.iter_mut().enumerate() {
        let x = (i % N) as f64 / N as f64;
        let y = (i / N) as f64 / N as f64;
        let (dx, dy) = (x - 0.5, y - 0.5);
        let r = ((dx * dx + dy * dy).sqrt() * 2.0) as f32;
        let n = fbm.get([x * 3.0, y * 3.0]) as f32;
        let rg = ridged.get([x * 2.5 + 10.0, y * 2.5]) as f32;
        let fall = (1.0 - r.powf(2.2)).clamp(0.0, 1.0);
        let v = match relief {
            Relief::Massif => 0.05 + fall * (0.36 + 0.28 * rg + 0.14 * n),
            Relief::Ile => 0.02 + (1.0 - r * 1.25).max(0.0).powf(1.4) * 0.72 + 0.07 * n * fall,
            Relief::Chaine => {
                let d = (dx as f32 * 0.8 - dy as f32 * 0.6 + 0.08 * n).abs();
                0.09 + (1.0 - d * 4.0).max(0.0) * (0.42 + 0.24 * rg) + 0.05 * n
            }
            Relief::Plateau => {
                let e = ((0.78 - (r + 0.12 * n)) / 0.3).clamp(0.0, 1.0);
                0.1 + e * e * (3.0 - 2.0 * e) * 0.42 + 0.03 * n
            }
            Relief::Collines => 0.17 + 0.12 * n + 0.05 * rg,
        };
        *h = v.max(0.01);
    }
    out
}

#[inline]
fn bilinear(f: &[f32], x: f32, y: f32) -> f32 {
    let x = x.clamp(0.0, (N - 1) as f32 - 0.001);
    let y = y.clamp(0.0, (N - 1) as f32 - 0.001);
    let (xi, yi) = (x as usize, y as usize);
    let (u, v) = (x - xi as f32, y - yi as f32);
    let i = yi * N + xi;
    f[i] * (1.0 - u) * (1.0 - v) + f[i + 1] * u * (1.0 - v) + f[i + N] * (1.0 - u) * v + f[i + N + 1] * u * v
}

/// Dureté locale de la roche : des couches inclinées, alternativement tendres et dures.
#[inline]
pub fn hardness_at(bed: f32, i: usize, p: &Params) -> f32 {
    let tilt = (i % N) as f32 * 0.011 + (i / N) as f32 * 0.004;
    let band = (std::f32::consts::TAU * (bed * H_MAX_M / p.strata_thickness.max(10.0)) + tilt).sin();
    (p.hardness + 0.5 * p.strata * band).clamp(0.0, 0.98)
}

impl World {
    pub fn new(seed: u32, relief: Relief) -> Self {
        let h = generate(seed, relief);
        let top = h.iter().cloned().fold(0.0f32, f32::max).max(1e-6);
        let mut brush = Vec::new();
        let radius = 3i32;
        let mut total = 0.0;
        for oy in -radius..=radius {
            for ox in -radius..=radius {
                let d = ((ox * ox + oy * oy) as f32).sqrt();
                if d < radius as f32 {
                    let w = 1.0 - d / radius as f32;
                    brush.push((ox, oy, w));
                    total += w;
                }
            }
        }
        for b in &mut brush {
            b.2 /= total;
        }
        World {
            shape: h.iter().map(|v| v / top).collect(),
            bed: h.iter().map(|v| v - SOIL0).collect(),
            sed: vec![SOIL0; CELLS],
            ice: vec![0.0; CELLS],
            veg: vec![0.0; CELLS],
            temp: vec![15.0; CELLS],
            rain: vec![1.0; CELLS],
            flux: vec![0.0; CELLS],
            scratch: vec![0.0; CELLS],
            brush,
            rng: Rng::new(seed as u64 + 1),
            stats: Stats::default(),
        }
    }

    pub fn years(&self) -> f64 {
        self.stats.ticks as f64 * YEARS_PER_TICK
    }

    #[inline]
    pub fn surface(&self, i: usize) -> f32 {
        self.bed[i] + self.sed[i] + self.ice[i]
    }

    /// Température et pluie de chaque case : il fait plus froid en altitude, il pleut plus face au vent.
    pub fn update_climate(&mut self, p: &Params, c: &Climate) {
        let sea = p.sea_level / H_MAX_M;
        let dir = p.wind_dir.to_radians();
        let (wx, wy) = (dir.cos(), dir.sin());
        let h: Vec<f32> = (0..CELLS).map(|i| self.bed[i] + self.sed[i]).collect();
        let (t_eff, lapse, oro) = (c.t_eff, c.lapse, p.orographic);
        self.temp.par_iter_mut().zip(self.rain.par_iter_mut()).enumerate().for_each(|(i, (t, r))| {
            let (x, y) = ((i % N) as f32, (i / N) as f32);
            *t = t_eff - lapse * (h[i] - sea).max(0.0) * H_MAX_M / 1000.0;
            let rise = ((h[i] - bilinear(&h, x - wx * 6.0, y - wy * 6.0)) * 28.0).clamp(-0.6, 1.6);
            let mut barrier = 0.0f32;
            for k in 1..=5 {
                let d = 8.0 * k as f32;
                barrier = barrier.max(bilinear(&h, x - wx * d, y - wy * d) - h[i]);
            }
            let shadow = (barrier * 7.0).clamp(0.0, 0.85);
            *r = ((1.0 + oro * rise) * (1.0 - oro * shadow)).clamp(0.05, 3.0);
        });
    }

    fn height_grad(&self, x: f32, y: f32) -> (f32, f32, f32) {
        let (xi, yi) = (x as usize, y as usize);
        let (u, v) = (x - xi as f32, y - yi as f32);
        let i = yi * N + xi;
        let (a, b, c, d) = (self.surface(i), self.surface(i + 1), self.surface(i + N), self.surface(i + N + 1));
        let gx = (b - a) * (1.0 - v) + (d - c) * v;
        let gy = (c - a) * (1.0 - u) + (d - b) * u;
        let h = a * (1.0 - u) * (1.0 - v) + b * u * (1.0 - v) + c * (1.0 - u) * v + d * u * v;
        (h, gx, gy)
    }

    fn deposit(&mut self, x: f32, y: f32, amount: f32) {
        let (xi, yi) = (x as usize, y as usize);
        let (u, v) = (x - xi as f32, y - yi as f32);
        let i = yi * N + xi;
        self.sed[i] += amount * (1.0 - u) * (1.0 - v);
        self.sed[i + 1] += amount * u * (1.0 - v);
        self.sed[i + N] += amount * (1.0 - u) * v;
        self.sed[i + N + 1] += amount * u * v;
    }

    /// Arrache `want` de matière autour d'un point ; renvoie ce qui a vraiment été emporté.
    fn erode(&mut self, xi: usize, yi: usize, want: f32, p: &Params) -> f32 {
        let mut got = 0.0;
        for k in 0..self.brush.len() {
            let (ox, oy, w) = self.brush[k];
            let (x, y) = (xi as i32 + ox, yi as i32 + oy);
            if x < 0 || y < 0 || x >= N as i32 || y >= N as i32 {
                continue;
            }
            let j = y as usize * N + x as usize;
            if self.ice[j] > ICE_COVER {
                continue;
            }
            // Les racines retiennent le sol
            let ask = want * w * (1.0 - 0.85 * self.veg[j]);
            let soft = ask.min(self.sed[j]);
            self.sed[j] -= soft;
            let mut rock = 0.0;
            if ask > soft {
                rock = (ask - soft) * (1.0 - 0.92 * hardness_at(self.bed[j], j, p));
                self.bed[j] -= rock;
            }
            got += soft + rock;
        }
        got
    }

    /// Érosion par l'eau : chaque goutte dévale la pente, creuse quand elle accélère, dépose quand elle ralentit.
    fn droplets(&mut self, p: &Params, c: &Climate) -> f32 {
        let Some(boil) = c.boil else { return 0.0 };
        let sea = if c.sea == Sea::None { -1.0 } else { p.sea_level / H_MAX_M };
        let count = (DROPS_PER_TICK * p.rain / p.storm.max(0.2)) as usize;
        let (inertia, min_cap, gravity) = (0.05f32, 0.01f32, 4.0 * p.gravity);
        let (erode_k, deposit_k, cap_k) = (0.3 * 0.06, 0.3f32, 4.0f32);
        let limit = (N - 2) as f32;
        let mut moved = 0.0;
        for _ in 0..count {
            let mut x = 1.0 + self.rng.f32() * (limit - 1.0);
            let mut y = 1.0 + self.rng.f32() * (limit - 1.0);
            let start = y as usize * N + x as usize;
            // Il pleut inégalement : tirage par rejet sur la carte de pluie
            if self.rng.f32() * 3.0 > self.rain[start] {
                continue;
            }
            let t = self.temp[start];
            if t <= 0.0 || t >= boil {
                continue;
            }
            let evap = 0.012 + 0.05 * p.infiltration * (0.3 + self.veg[start]);
            let (mut dx, mut dy, mut speed, mut water, mut load) = (0.0f32, 0.0f32, 1.0f32, p.storm, 0.0f32);
            for _ in 0..48 {
                let (xi, yi) = (x as usize, y as usize);
                let (h, gx, gy) = self.height_grad(x, y);
                dx = dx * inertia - gx * (1.0 - inertia);
                dy = dy * inertia - gy * (1.0 - inertia);
                let len = (dx * dx + dy * dy).sqrt();
                if len < 1e-12 {
                    break;
                }
                dx /= len;
                dy /= len;
                let (nx, ny) = (x + dx, y + dy);
                if nx < 1.0 || ny < 1.0 || nx >= limit || ny >= limit {
                    load = 0.0; // la goutte quitte la carte avec sa charge
                    break;
                }
                self.flux[yi * N + xi] += water;
                if h < sea {
                    break; // arrivée en mer : tout se dépose, c'est ainsi que naissent les deltas
                }
                let dh = self.height_grad(nx, ny).0 - h;
                let capacity = (-dh * speed * water * cap_k).max(min_cap * 0.02);
                if load > capacity || dh > 0.0 {
                    let amount = if dh > 0.0 { dh.min(load) } else { (load - capacity) * deposit_k };
                    load -= amount;
                    self.deposit(x, y, amount);
                } else {
                    let want = ((capacity - load) * erode_k).min(-dh);
                    let got = self.erode(xi, yi, want, p);
                    load += got;
                    moved += got;
                }
                speed = (speed * speed - dh * gravity).max(0.0).sqrt();
                water *= 1.0 - evap;
                x = nx;
                y = ny;
                if water < 0.02 {
                    break;
                }
            }
            if load > 0.0 {
                self.deposit(x, y, load);
            }
        }
        moved
    }

    /// Éboulements : toute pente plus raide que l'angle de repos s'effondre vers le bas.
    fn talus(&mut self, p: &Params) -> f32 {
        let t_sed = p.repose_deg.to_radians().tan() * CELL_M / H_MAX_M;
        let rate = 0.25 * p.gravity.clamp(0.3, 2.0);
        let mut moved = 0.0;
        let reverse = self.stats.ticks % 2 == 1;
        for n in 0..CELLS {
            let i = if reverse { CELLS - 1 - n } else { n };
            let (x, y) = (i % N, i / N);
            for j in [if x + 1 < N { i + 1 } else { i }, if y + 1 < N { i + N } else { i }] {
                if j == i {
                    continue;
                }
                let d = (self.bed[i] + self.sed[i]) - (self.bed[j] + self.sed[j]);
                let (hi, lo) = if d > 0.0 { (i, j) } else { (j, i) };
                let d = d.abs();
                if d <= t_sed || self.ice[hi] > ICE_COVER {
                    continue;
                }
                let m = ((d - t_sed) * rate).min(self.sed[hi]);
                self.sed[hi] -= m;
                self.sed[lo] += m;
                moved += m;
                // Une falaise trop raide pour sa roche finit par céder
                let hard = hardness_at(self.bed[hi], hi, p);
                let t_rock = t_sed * (1.6 + 5.0 * hard);
                if d > t_rock {
                    let r = (d - t_rock) * 0.2 * (1.0 - hard);
                    self.bed[hi] -= r;
                    self.sed[lo] += r;
                    moved += r;
                }
            }
        }
        moved
    }

    /// Altération de la roche en sol (gel, chimie, chocs thermiques) et croissance de la végétation.
    fn weather_and_grow(&mut self, p: &Params, c: &Climate) -> (f32, f32) {
        let sea = if c.sea == Sea::None { -1.0 } else { p.sea_level / H_MAX_M };
        let c = *c;
        let World { bed, sed, veg, temp, rain, ice, .. } = self;
        let (temp, rain, ice) = (&*temp, &*rain, &*ice);
        let tot: Vec<f32> = (0..CELLS).map(|i| bed[i] + sed[i]).collect();
        let co2 = p.co2;
        let f_co2 = if co2 < 100.0 { 0.0 } else if co2 < 150.0 { (co2 - 100.0) / 50.0 * 0.6 } else { (co2 / 280.0).powf(0.25).min(1.45) };
        let f_uv = (1.0 - (c.uv_ground - 10.0) / 15.0).clamp(0.0, 1.0);
        let f_air = (p.pressure / 0.2).min(1.0);
        bed.par_iter_mut()
            .zip(sed.par_iter_mut())
            .zip(veg.par_iter_mut())
            .enumerate()
            .map(|(i, ((b, s), v))| {
                let t = temp[i];
                let wet = rain[i] * p.rain;
                let under = tot[i] < sea;
                let iced = ice[i] > ICE_COVER;
                let hard = hardness_at(*b, i, p);
                // Plus le sol est épais, moins la roche dessous est attaquée
                let cover = (-*s / 0.0025).exp() * (1.0 - 0.9 * hard);
                let mut frost = 0.0;
                let mut chem = 0.0;
                if !under {
                    if p.on_frost {
                        // Le gel fend la roche surtout autour de 0 °C, quand l'eau gèle et dégèle sans cesse
                        if c.boil.is_some() {
                            frost = 1.2e-5 * (-(t / 5.0) * (t / 5.0)).exp() * wet.min(1.5) * cover;
                        }
                        // Sans air pour amortir, la roche éclate sous les écarts jour-nuit
                        frost += 1.5e-6 / (0.15 + p.pressure) * cover;
                    }
                    if p.on_chem && c.liquid(t) && !iced {
                        // La pluie chargée de CO2 dissout la roche, deux fois plus vite tous les 10 °C
                        chem = 6e-6 * wet.min(2.0) * 2f32.powf((t.min(60.0) - 15.0) / 10.0) * (co2.max(1.0) / 280.0).powf(0.3) * (1.0 + 0.6 * *v) * cover;
                    }
                    let total = frost + chem;
                    *b -= total;
                    *s += total - 0.4 * chem; // une partie part dissoute
                }
                // Végétation
                let target = if !p.on_life || under || iced || !c.liquid(t) {
                    0.0
                } else {
                    let (x, y) = (i % N, i / N);
                    let gx = tot[if x + 1 < N { i + 1 } else { i }] - tot[if x > 0 { i - 1 } else { i }];
                    let gy = tot[if y + 1 < N { i + N } else { i }] - tot[if y > 0 { i - N } else { i }];
                    let slope = (gx * gx + gy * gy).sqrt() * 0.5 * H_MAX_M / CELL_M;
                    let f_t = if t <= -5.0 || t >= 55.0 { 0.0 } else { (-((t - 22.0) / 18.0).powi(2)).exp() };
                    let f_w = 1.0 - (-wet * 1.6).exp();
                    let f_soil = 0.15 + 0.85 * (*s / 0.0008).min(1.0);
                    let f_slope = (1.0 - (slope - 0.9) / 1.2).clamp(0.05, 1.0);
                    (p.veg_max * f_t * f_w * f_soil * f_uv * f_co2 * f_slope * f_air).clamp(0.0, 1.0)
                };
                let k = if target > *v { 0.012 + 0.05 * p.veg_growth } else { 0.06 };
                *v += (target - *v) * k;
                (frost, chem)
            })
            .reduce(|| (0.0, 0.0), |a, b| (a.0 + b.0, a.1 + b.1))
    }

    /// Le vent emporte le sol sec et nu, et le redépose plus loin.
    fn wind(&mut self, p: &Params, c: &Climate) -> f32 {
        if p.pressure < 0.001 || p.wind_speed <= 0.0 {
            return 0.0;
        }
        let sea = if c.sea == Sea::None { -1.0 } else { p.sea_level / H_MAX_M };
        let dir = p.wind_dir.to_radians();
        let (wx, wy) = (dir.cos(), dir.sin());
        let power = 4e-6 * (p.wind_speed / 10.0).powi(2) * c.air / p.gravity.max(0.1);
        self.scratch.fill(0.0);
        let mut moved = 0.0;
        for y in 2..N - 2 {
            for x in 2..N - 2 {
                let i = y * N + x;
                if self.sed[i] <= 0.0 || self.ice[i] > ICE_COVER || self.bed[i] + self.sed[i] < sea {
                    continue;
                }
                let t = self.temp[i];
                let dry = if c.liquid(t) { (1.0 - self.rain[i] * p.rain / 0.6).clamp(0.0, 1.0) } else { 1.0 };
                let bare = (1.0 - self.veg[i]).powi(2);
                let here = self.bed[i] + self.sed[i];
                let upwind = bilinear_sum(&self.bed, &self.sed, x as f32 - wx * 2.0, y as f32 - wy * 2.0);
                let exposure = (0.6 + 60.0 * (here - upwind)).clamp(0.1, 2.0);
                let amount = (power * bare * dry * exposure).min(self.sed[i]);
                if amount <= 0.0 {
                    continue;
                }
                self.sed[i] -= amount;
                // Les grains qui sautent poncent la roche nue
                let scour = amount * 0.05 * (1.0 - hardness_at(self.bed[i], i, p));
                self.bed[i] -= scour;
                let (tx, ty) = (x as f32 + wx * 1.6, y as f32 + wy * 1.6);
                let (xi, yi) = (tx as usize, ty as usize);
                let (u, v) = (tx - xi as f32, ty - yi as f32);
                let j = yi * N + xi;
                let a = amount + scour;
                self.scratch[j] += a * (1.0 - u) * (1.0 - v);
                self.scratch[j + 1] += a * u * (1.0 - v);
                self.scratch[j + N] += a * (1.0 - u) * v;
                self.scratch[j + N + 1] += a * u * v;
                moved += a;
            }
        }
        for i in 0..CELLS {
            self.sed[i] += self.scratch[i];
        }
        moved
    }

    /// Glaciers : la neige s'accumule au froid, la glace s'écoule lentement et rabote la roche.
    fn glaciers(&mut self, p: &Params, c: &Climate) -> f32 {
        let sea = if c.sea == Sea::None { -1.0 } else { p.sea_level / H_MAX_M };
        self.scratch.fill(0.0);
        let mut moved = 0.0;
        for y in 1..N - 1 {
            for x in 1..N - 1 {
                let i = y * N + x;
                let t = self.temp[i];
                if c.snow(t) && self.bed[i] + self.sed[i] >= sea {
                    self.ice[i] += 5e-6 * p.rain * self.rain[i];
                } else if t > 0.0 {
                    self.ice[i] = (self.ice[i] - 6e-6 * t).max(0.0);
                }
                if c.boil.is_none() {
                    self.ice[i] = (self.ice[i] - 2e-6).max(0.0); // sublimation
                }
                let ice = self.ice[i];
                if ice <= 1e-7 {
                    continue;
                }
                let s = self.surface(i);
                let mut out = 0.0;
                for j in [i - 1, i + 1, i - N, i + N] {
                    let d = s - self.surface(j);
                    if d > 0.0 {
                        let f = ice * (d * 25.0).min(0.12) * p.gravity.clamp(0.3, 2.0);
                        self.scratch[j] += f;
                        out += f;
                    }
                }
                self.scratch[i] -= out;
                if ice > ICE_COVER {
                    let scrape = out * 0.03 * (1.0 - 0.8 * hardness_at(self.bed[i], i, p));
                    self.bed[i] -= scrape;
                    self.sed[i] += scrape;
                    moved += scrape;
                }
            }
        }
        for i in 0..CELLS {
            self.ice[i] = (self.ice[i] + self.scratch[i]).max(0.0);
        }
        moved
    }

    /// Avance la simulation d'un pas (environ `YEARS_PER_TICK` ans).
    pub fn tick(&mut self, p: &Params) {
        let c = Climate::from(p);
        if self.stats.ticks % 8 == 0 {
            self.update_climate(p, &c);
        }
        if p.uplift > 0.0 {
            let k = p.uplift * 1e-3 * YEARS_PER_TICK as f32 / H_MAX_M * 0.02;
            for i in 0..CELLS {
                self.bed[i] += k * self.shape[i];
            }
        }
        for f in &mut self.flux {
            *f *= 0.9;
        }
        let hyd = if p.on_water { self.droplets(p, &c) } else { 0.0 };
        let tal = self.talus(p);
        let (frost, chem) = self.weather_and_grow(p, &c);
        let wind = if p.on_wind { self.wind(p, &c) } else { 0.0 };
        let gla = if p.on_ice { self.glaciers(p, &c) } else { 0.0 };
        let s = &mut self.stats;
        let mix = |old: &mut f32, new: f32| *old = *old * 0.95 + new * 0.05;
        mix(&mut s.hydraulic, hyd);
        mix(&mut s.talus, tal);
        mix(&mut s.frost, frost);
        mix(&mut s.chemical, chem);
        mix(&mut s.wind, wind);
        mix(&mut s.glacial, gla);
        s.ticks += 1;
    }

    /// Part de la surface émergée couverte de végétation dense, de glace, et altitude moyenne en mètres.
    pub fn summary(&self, p: &Params) -> (f32, f32, f32) {
        let sea = p.sea_level / H_MAX_M;
        let (mut land, mut green, mut iced, mut alt) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
        for i in 0..CELLS {
            let h = self.bed[i] + self.sed[i];
            if h >= sea {
                land += 1.0;
                green += self.veg[i];
                if self.ice[i] > ICE_COVER {
                    iced += 1.0;
                }
                alt += (h - sea) * H_MAX_M;
            }
        }
        let land = land.max(1.0);
        (green / land, iced / land, alt / land)
    }
}

fn bilinear_sum(a: &[f32], b: &[f32], x: f32, y: f32) -> f32 {
    bilinear(a, x, y) + bilinear(b, x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(p: &Params, ticks: usize) -> World {
        let mut w = World::new(42, Relief::Massif);
        for _ in 0..ticks {
            w.tick(p);
        }
        w
    }
    fn volume(w: &World) -> f64 {
        (0..CELLS).map(|i| (w.bed[i] + w.sed[i]) as f64).sum()
    }

    #[test]
    fn tous_les_mondes_restent_finis() {
        for (name, p) in presets() {
            let w = run(&p, 60);
            let ok = (0..CELLS).all(|i| w.bed[i].is_finite() && w.sed[i].is_finite() && w.sed[i] >= -1e-6 && w.ice[i] >= 0.0 && (0.0..=1.0).contains(&w.veg[i]));
            assert!(ok, "valeurs invalides dans le monde « {name} »");
        }
    }

    #[test]
    fn meme_graine_meme_resultat() {
        let p = Params::default();
        let (a, b) = (run(&p, 25), run(&p, 25));
        assert!(a.bed == b.bed && a.sed == b.sed);
    }

    #[test]
    fn les_eboulis_conservent_la_matiere() {
        let p = Params { on_water: false, on_frost: false, on_chem: false, on_wind: false, on_ice: false, on_life: false, ..Params::default() };
        let mut w = World::new(7, Relief::Chaine);
        let before = volume(&w);
        for _ in 0..40 {
            w.tick(&p);
        }
        assert!(w.stats.talus > 0.0, "aucun éboulement");
        assert!(((volume(&w) - before) / before).abs() < 1e-4);
    }

    #[test]
    fn sans_air_pas_de_pluie_ni_de_plantes() {
        let p = Params { pressure: 0.0, ..Params::default() };
        let w = run(&p, 40);
        assert_eq!(w.stats.hydraulic, 0.0);
        assert_eq!(w.stats.chemical, 0.0);
        assert!(w.veg.iter().all(|v| *v < 1e-6));
    }

    #[test]
    fn la_vegetation_depend_du_co2_et_des_uv() {
        let green = |p: &Params| run(p, 120).summary(p).0;
        let terre = green(&Params::default());
        assert!(terre > 0.25, "la Terre tempérée devrait verdir, obtenu {terre}");
        assert!(green(&Params { co2: 90.0, ..Params::default() }) < 0.01);
        assert!(green(&Params { uv: 90.0, ozone: 0.0, ..Params::default() }) < 0.01);
        assert!(green(&Params { co2: 1200.0, ..Params::default() }) > terre);
    }

    #[test]
    fn la_vegetation_freine_l_erosion() {
        let nu = run(&Params { on_life: false, ..Params::default() }, 150);
        let vert = run(&Params::default(), 150);
        assert!(vert.stats.hydraulic < nu.stats.hydraulic);
    }

    #[test]
    fn le_froid_fait_des_glaciers_et_le_chaud_non() {
        let froid = Params { temperature: -6.0, ..Params::default() };
        assert!(run(&froid, 200).summary(&froid).1 > 0.2);
        let chaud = Params { temperature: 30.0, ..Params::default() };
        assert_eq!(run(&chaud, 200).summary(&chaud).1, 0.0);
    }

    #[test]
    fn le_co2_rechauffe() {
        let a = Climate::from(&Params { co2: 280.0, ..Params::default() });
        let b = Climate::from(&Params { co2: 560.0, ..Params::default() });
        assert!((b.t_eff - a.t_eff - 3.0).abs() < 1e-3);
    }
}
