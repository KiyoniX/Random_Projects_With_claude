//! Simulation : relief, essences, humidité du combustible et propagation du feu.
//!
//! Une case mesure `CELL_M` mètres et un pas dure `DT` secondes. Les altitudes sont normalisées : 1.0 vaut `H_MAX_M` mètres.

use glam::Vec2;
use noise::{Fbm, MultiFractal, NoiseFn, Perlin, RidgedMulti};
use std::collections::VecDeque;

pub const N: usize = 384;
pub const CELLS: usize = N * N;
pub const CELL_M: f32 = 20.0;
pub const H_MAX_M: f32 = 1000.0;
pub const DT: f32 = 5.0;
pub const HA_PER_CELL: f32 = CELL_M * CELL_M / 10_000.0;

/// L'humidité, le refroidissement et les mesures ne sont recalculés qu'un pas sur `SLOW_EVERY`.
const SLOW_EVERY: u64 = 8;
/// Sous cette charge une case ne porte plus le feu.
const MIN_FUEL: f32 = 0.02;
/// Distance, en cases, jusqu'où un plan d'eau garde le sol frais.
const WATER_REACH: u8 = 16;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Relief {
    Collines,
    Vallee,
    Massif,
    Littoral,
}

impl Relief {
    pub const ALL: [Relief; 4] = [Relief::Collines, Relief::Vallee, Relief::Massif, Relief::Littoral];
    pub fn name(self) -> &'static str {
        match self {
            Relief::Collines => "Collines",
            Relief::Vallee => "Vallée et rivière",
            Relief::Massif => "Massif",
            Relief::Littoral => "Littoral",
        }
    }
}

/// Réglages qui redessinent le terrain quand on les change.
#[derive(Clone, PartialEq, Debug)]
pub struct Terrain {
    pub relief: Relief,
    pub conifers: f32, // part de résineux, 0..1
    pub density: f32,  // densité du couvert, 0..1
    pub water: f32,    // niveau de l'eau, en altitude normalisée
}

impl Default for Terrain {
    fn default() -> Self {
        Terrain { relief: Relief::Collines, conifers: 0.5, density: 0.85, water: 0.1 }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Essence {
    Nu,
    Prairie,
    Garrigue,
    Pinede,
    Chenaie,
    Hetraie,
    Eucalyptus,
}

/// Comportement au feu d'une essence.
pub struct Fuel {
    pub ros: f32,    // vitesse du front sans vent, à plat et à sec, m/s
    pub burn_s: f32, // durée de combustion d'une case, s
    pub mx: f32,     // humidité d'extinction : au-dessus, le feu ne prend pas
    pub wet: f32,    // humidité que l'essence garde en plus de l'air ambiant
    pub spot: f32,   // propension à projeter des brandons, 0..1
    pub heat: f32,   // puissance du feu, 1 = pinède
}

impl Essence {
    pub const ALL: [Essence; 7] = [Essence::Nu, Essence::Prairie, Essence::Garrigue, Essence::Pinede, Essence::Chenaie, Essence::Hetraie, Essence::Eucalyptus];
    pub fn name(self) -> &'static str {
        match self {
            Essence::Nu => "Roche et sol nu",
            Essence::Prairie => "Prairie sèche",
            Essence::Garrigue => "Garrigue",
            Essence::Pinede => "Pinède",
            Essence::Chenaie => "Chênaie",
            Essence::Hetraie => "Hêtraie",
            Essence::Eucalyptus => "Eucalyptus",
        }
    }
    pub fn note(self) -> &'static str {
        match self {
            Essence::Nu => "ne brûle pas",
            Essence::Prairie => "s'embrase vite, s'éteint vite",
            Essence::Garrigue => "feu rapide et nerveux",
            Essence::Pinede => "brûle longtemps, projette des brandons",
            Essence::Chenaie => "feu lent, garde l'humidité",
            Essence::Hetraie => "ne brûle qu'en grande sécheresse",
            Essence::Eucalyptus => "explosif, brandons à longue portée",
        }
    }
    pub fn fuel(self) -> Fuel {
        let f = |ros, burn_s, mx, wet, spot, heat| Fuel { ros, burn_s, mx, wet, spot, heat };
        match self {
            Essence::Nu => f(0.0, 1.0, 0.01, 0.0, 0.0, 0.0),
            Essence::Prairie => f(0.10, 70.0, 0.18, -0.02, 0.05, 0.45),
            Essence::Garrigue => f(0.07, 260.0, 0.26, -0.01, 0.35, 0.85),
            Essence::Pinede => f(0.05, 620.0, 0.30, 0.0, 0.9, 1.0),
            Essence::Chenaie => f(0.028, 700.0, 0.24, 0.05, 0.25, 0.7),
            Essence::Hetraie => f(0.014, 640.0, 0.22, 0.10, 0.1, 0.5),
            Essence::Eucalyptus => f(0.075, 520.0, 0.32, 0.0, 1.0, 1.2),
        }
    }
    /// Hauteur du couvert, en mètres, pour l'affichage.
    pub fn canopy_m(self) -> f32 {
        match self {
            Essence::Nu | Essence::Prairie => 0.0,
            Essence::Garrigue => 2.0,
            Essence::Pinede => 16.0,
            Essence::Chenaie => 14.0,
            Essence::Hetraie => 20.0,
            Essence::Eucalyptus => 24.0,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum State {
    Intact,
    Feu,
    Cendre,
    PareFeu,
    Eau,
}

#[derive(Clone, PartialEq, Debug)]
pub struct Params {
    // Vent
    pub wind_dir: f32, // degrés, direction vers laquelle il souffle : 0 = nord, 90 = est
    pub wind_kmh: f32,
    pub gusts: f32, // 0..1 : rafales et sautes de direction
    // Air
    pub humidity: f32,    // %
    pub temperature: f32, // °C
    pub drought: f32,     // jours sans pluie
    pub rain: f32,        // mm/h
    // Feu
    pub spread: f32,   // multiplie la vitesse de propagation
    pub slope: f32,    // poids de la pente
    pub spotting: f32, // fréquence des sautes de feu
}

impl Default for Params {
    fn default() -> Self {
        Params { wind_dir: 120.0, wind_kmh: 20.0, gusts: 0.3, humidity: 40.0, temperature: 28.0, drought: 15.0, rain: 0.0, spread: 1.0, slope: 1.0, spotting: 1.0 }
    }
}

/// Météos prêtes à l'emploi.
pub fn presets() -> Vec<(&'static str, Params)> {
    let d = Params::default();
    vec![
        ("Été ordinaire", d.clone()),
        ("Canicule et mistral", Params { wind_dir: 160.0, wind_kmh: 70.0, gusts: 0.6, humidity: 15.0, temperature: 38.0, drought: 45.0, ..d.clone() }),
        ("Sécheresse sans vent", Params { wind_kmh: 3.0, gusts: 0.1, humidity: 20.0, temperature: 34.0, drought: 60.0, ..d.clone() }),
        ("Soir humide", Params { wind_kmh: 10.0, humidity: 75.0, temperature: 16.0, drought: 5.0, ..d.clone() }),
        ("Orage", Params { wind_dir: 60.0, wind_kmh: 35.0, gusts: 1.0, humidity: 85.0, temperature: 22.0, rain: 3.0, ..d }),
    ]
}

/// Humidité du combustible mort à l'équilibre avec l'air.
pub fn dead_moisture(p: &Params) -> f32 {
    (0.02 + 0.30 * (p.humidity / 100.0).powf(1.2) - 0.0015 * (p.temperature - 20.0) - 0.03 * p.drought / 60.0).max(0.015)
}

/// Part de l'humidité propre au lieu et à l'essence qui survit à la sécheresse.
fn reserve(p: &Params) -> f32 {
    1.0 - p.drought / 60.0 * 0.8
}

/// Frein de l'humidité sur le feu (Rothermel) : 1 à sec, 0 à l'humidité d'extinction.
#[inline]
fn damp(r: f32) -> f32 {
    if r >= 1.0 { 0.0 } else { (1.0 - 2.59 * r + 5.11 * r * r - 3.52 * r * r * r).max(0.0) }
}

/// Effet du vent selon `c`, cosinus de l'angle entre le vent et la direction de propagation.
#[inline]
fn wind_factor(speed: f32, c: f32) -> f32 {
    if c > 0.0 { 1.0 + 0.6 * speed.powf(1.2) * c * c } else { 1.0 / (1.0 + 0.12 * speed * -c) }
}

/// Niveau de danger et vitesse attendue d'un front de garrigue poussé par le vent, en km/h.
pub fn danger(p: &Params) -> (&'static str, f32) {
    let f = Essence::Garrigue.fuel();
    let m = dead_moisture(p) + f.wet * reserve(p) + 0.07 * p.rain;
    let kmh = f.ros * wind_factor(p.wind_kmh / 3.6, 1.0) * damp(m / f.mx) * p.spread * 3.6;
    let name = match kmh {
        k if k < 0.05 => "faible",
        k if k < 0.3 => "modéré",
        k if k < 1.0 => "sévère",
        k if k < 2.5 => "très sévère",
        _ => "extrême",
    };
    (name, kmh)
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Stats {
    pub ticks: u64,
    /// Cases parcourues par le feu, par essence.
    pub burnt: [u32; 7],
    /// Cases de chaque essence au départ.
    pub total: [u32; 7],
    pub embers: u32,
    pub cut: u32,
    /// Progression récente, en hectares par heure.
    pub pace: f32,
}

struct Rng(u64);

impl Rng {
    fn f32(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
}

pub struct World {
    pub height: Vec<f32>,
    pub level: f32,
    pub essence: Vec<Essence>,
    /// Charge de combustible au départ, 0..1.
    pub cover: Vec<f32>,
    /// Charge restante.
    pub fuel: Vec<f32>,
    pub moist: Vec<f32>,
    pub state: Vec<State>,
    /// Heure d'arrivée du feu en secondes, négative si la case n'a jamais brûlé.
    pub arrival: Vec<f32>,
    /// Chaleur reçue : la case s'enflamme à 1.
    ign: Vec<f32>,
    /// Heure du dernier allumage de la case.
    lit: Vec<f32>,
    /// Fraîcheur du lieu : ubac, fond de vallon, bord de l'eau.
    site: Vec<f32>,
    pub jitter: Vec<f32>,
    /// Cases qui propagent le feu : celles qui flambent, puis leurs braises tant qu'elles couvent.
    burning: Vec<u32>,
    flaming: usize,
    pub time: f64,
    rng: Rng,
    last_total: u32,
    pub stats: Stats,
}

fn generate(seed: u32, relief: Relief) -> Vec<f32> {
    let fbm = Fbm::<Perlin>::new(seed).set_octaves(6);
    let ridged = RidgedMulti::<Perlin>::new(seed.wrapping_add(7)).set_octaves(5);
    let mut out = vec![0.0f32; CELLS];
    for (i, h) in out.iter_mut().enumerate() {
        let x = (i % N) as f64 / N as f64;
        let y = (i / N) as f64 / N as f64;
        let (dx, dy) = ((x - 0.5) as f32, (y - 0.5) as f32);
        let r = (dx * dx + dy * dy).sqrt() * 2.0;
        let n = fbm.get([x * 3.0, y * 3.0]) as f32;
        let rg = ridged.get([x * 2.5 + 10.0, y * 2.5]) as f32;
        let v = match relief {
            Relief::Collines => 0.17 + 0.16 * n + 0.06 * rg,
            Relief::Vallee => {
                // Une rivière en diagonale, qui serpente, entre deux versants
                let d = ((dx - dy) * 0.707 + 0.05 * (r * 7.0).sin() + 0.07 * n).abs();
                if d < 0.012 { 0.02 } else { 0.11 + (d * 2.2).min(1.0).powf(1.3) * (0.4 + 0.2 * rg) + 0.04 * n }
            }
            Relief::Massif => 0.09 + (1.0 - r.powf(2.2)).clamp(0.0, 1.0) * (0.3 + 0.3 * rg + 0.14 * n),
            Relief::Littoral => {
                // La mer au sud, les collines qui montent vers l'intérieur
                let inland = 0.18 - dy + 0.09 * n;
                0.1 + inland * 0.5 + 0.1 * rg * (inland * 3.0).clamp(0.0, 1.0) + 0.03 * n
            }
        };
        *h = v.max(0.0);
    }
    out
}

impl World {
    pub fn new(seed: u32, t: &Terrain, p: &Params) -> Self {
        let height = generate(seed, t.relief);
        let level = t.water;
        let top = height.iter().cloned().fold(0.0f32, f32::max).max(level + 0.05);
        let water: Vec<bool> = height.iter().map(|&h| h < level).collect();
        let wet = |i: usize| water[i];

        // Distance à l'eau la plus proche, par propagation depuis les rives
        let mut dist = vec![u8::MAX; CELLS];
        let mut queue: VecDeque<usize> = (0..CELLS).filter(|&i| wet(i)).collect();
        for &i in &queue {
            dist[i] = 0;
        }
        while let Some(i) = queue.pop_front() {
            if dist[i] >= WATER_REACH {
                continue;
            }
            let (x, y) = (i % N, i / N);
            for j in [(x > 0).then(|| i - 1), (x + 1 < N).then(|| i + 1), (y > 0).then(|| i - N), (y + 1 < N).then(|| i + N)].into_iter().flatten() {
                if dist[j] == u8::MAX {
                    dist[j] = dist[i] + 1;
                    queue.push_back(j);
                }
            }
        }

        let clearing = Fbm::<Perlin>::new(seed.wrapping_add(11)).set_octaves(4);
        let humid = Fbm::<Perlin>::new(seed.wrapping_add(23)).set_octaves(3);
        let kind = Fbm::<Perlin>::new(seed.wrapping_add(37)).set_octaves(3);
        let dense = Fbm::<Perlin>::new(seed.wrapping_add(53)).set_octaves(5);
        let planted = Fbm::<Perlin>::new(seed.wrapping_add(71)).set_octaves(2);
        let mut rng = Rng(seed as u64 * 2_654_435_761 + 88_172_645_463_325_252);

        let mut w = World {
            level,
            essence: vec![Essence::Nu; CELLS],
            cover: vec![0.0; CELLS],
            fuel: vec![0.0; CELLS],
            moist: vec![0.1; CELLS],
            state: vec![State::Intact; CELLS],
            arrival: vec![-1.0; CELLS],
            ign: vec![0.0; CELLS],
            lit: vec![0.0; CELLS],
            site: vec![0.0; CELLS],
            jitter: (0..CELLS).map(|_| 0.7 + 0.6 * rng.f32()).collect(),
            burning: Vec::new(),
            flaming: 0,
            time: 0.0,
            rng,
            last_total: 0,
            stats: Stats::default(),
            height,
        };
        let at = |x: usize, y: usize| w.height[y * N + x];
        for i in 0..CELLS {
            if wet(i) {
                w.state[i] = State::Eau;
                continue;
            }
            let (x, y) = (i % N, i / N);
            let (fx, fy) = (x as f64 / N as f64, y as f64 / N as f64);
            let k = H_MAX_M / (2.0 * CELL_M);
            let gx = (at((x + 1).min(N - 1), y) - at(x.saturating_sub(1), y)) * k;
            let gy = (at(x, (y + 1).min(N - 1)) - at(x, y.saturating_sub(1))) * k;
            let steep = (gx * gx + gy * gy).sqrt();
            // Creux du terrain : moyenne des alentours moins l'altitude de la case
            let around = (at((x + 5).min(N - 1), y) + at(x.saturating_sub(5), y) + at(x, (y + 5).min(N - 1)) + at(x, y.saturating_sub(5))) / 4.0;
            let hollow = ((around - w.height[i]) * H_MAX_M / (5.0 * CELL_M) * 6.0).clamp(-1.0, 1.0);
            let near = (1.0 - dist[i].min(WATER_REACH) as f32 / WATER_REACH as f32).max(0.0);
            // Le nord est en haut de la carte : un versant qui monte vers le sud regarde le nord et reste à l'ombre
            let site = 0.55 * near + 0.25 * (gy * 1.5).clamp(-1.0, 1.0) + 0.2 * hollow;
            w.site[i] = site;

            let alt = (w.height[i] - level) / (top - level);
            let fresh = site + 0.5 * humid.get([fx * 4.0, fy * 4.0]) as f32;
            let resin = (kind.get([fx * 5.0, fy * 5.0]) as f32 * 1.4 + 0.5).clamp(0.0, 1.0);
            let open = clearing.get([fx * 7.0, fy * 7.0]) as f32;
            let e = if steep > 0.9 || alt > 0.93 {
                Essence::Nu
            } else if open > 0.22 || alt > 0.8 {
                Essence::Prairie
            } else if fresh > 0.45 {
                Essence::Hetraie
            } else if fresh > 0.12 {
                if resin < t.conifers * 0.6 { Essence::Pinede } else { Essence::Chenaie }
            } else if resin < t.conifers {
                Essence::Pinede
            } else if alt < 0.35 && planted.get([fx * 6.0, fy * 6.0]) as f32 > 0.25 {
                Essence::Eucalyptus
            } else {
                Essence::Garrigue
            };
            let d = (dense.get([fx * 9.0, fy * 9.0]) as f32 + 0.5).clamp(0.0, 1.0);
            w.essence[i] = e;
            w.cover[i] = match e {
                Essence::Nu => 0.0,
                Essence::Prairie => 0.35 + 0.25 * d,
                _ => (0.45 + 0.55 * d) * t.density,
            };
            w.fuel[i] = w.cover[i];
            w.stats.total[e as usize] += 1;
        }
        for i in 0..CELLS {
            w.moist[i] = w.equilibrium(i, p);
        }
        w
    }

    /// Humidité vers laquelle tend le combustible d'une case.
    fn equilibrium(&self, i: usize, p: &Params) -> f32 {
        let f = self.essence[i].fuel();
        (dead_moisture(p) + (0.07 * self.site[i] + f.wet) * reserve(p) + 0.07 * p.rain).clamp(0.015, 0.6)
    }

    /// Vent du moment : direction (vecteur unitaire sur la carte) et vitesse en m/s, rafales comprises.
    pub fn wind(&self, p: &Params) -> (Vec2, f32) {
        let t = self.time as f32;
        let swing = (t / 470.0).sin() * 0.6 + (t / 173.0).sin() * 0.3 + (t / 61.0).sin() * 0.1;
        let pulse = (t / 97.0).sin() * 0.5 + (t / 31.0).sin() * 0.5;
        let a = (p.wind_dir + p.gusts * 35.0 * swing).to_radians();
        (Vec2::new(a.sin(), -a.cos()), p.wind_kmh / 3.6 * (1.0 + p.gusts * 0.45 * pulse).max(0.0))
    }

    /// Nombre de cases en flammes.
    pub fn burning(&self) -> usize {
        self.flaming
    }

    fn light(&mut self, i: usize) {
        self.state[i] = State::Feu;
        self.lit[i] = self.time as f32;
        if self.arrival[i] < 0.0 {
            self.arrival[i] = self.time as f32;
            self.stats.burnt[self.essence[i] as usize] += 1;
        }
        self.burning.push(i as u32);
    }

    /// Ni l'eau ni un pare-feu ne laissent passer les flammes.
    #[inline]
    fn blocked(&self, i: usize) -> bool {
        matches!(self.state[i], State::Eau | State::PareFeu)
    }

    pub fn tick(&mut self, p: &Params) {
        let (wind, speed) = self.wind(p);
        let across = Vec2::new(-wind.y, wind.x);
        let burning = std::mem::take(&mut self.burning);
        let mut still = Vec::with_capacity(burning.len());
        self.flaming = 0;
        for &iu in &burning {
            let i = iu as usize;
            if !matches!(self.state[i], State::Feu | State::Cendre) {
                continue;
            }
            let f = self.essence[i].fuel();
            let eta = damp(self.moist[i] / f.mx);
            if eta <= 0.0 {
                // Noyée par la pluie ou un largage : la case s'éteint avec ce qui lui reste
                self.state[i] = if self.fuel[i] > 0.1 * self.cover[i] { State::Intact } else { State::Cendre };
                self.ign[i] = 0.0;
                continue;
            }
            let left = self.fuel[i] / self.cover[i].max(1e-3);
            let power = f.heat * self.cover[i] * left.sqrt().max(0.5) * (0.5 + 0.5 * eta);
            if self.state[i] == State::Feu {
                self.fuel[i] -= self.cover[i] * DT / f.burn_s;
                if self.fuel[i] <= 0.0 {
                    self.fuel[i] = 0.0;
                    self.state[i] = State::Cendre;
                } else {
                    self.flaming += 1;
                }
            }
            // Les flammes passées, les braises couvent le temps qu'un feu rampant mettrait à traverser la case
            let creep = (1.3 * CELL_M / (f.ros * p.spread * eta * 0.5).max(1e-4)).min(1800.0);
            if self.time as f32 - self.lit[i] < f.burn_s + creep {
                still.push(iu);
            }

            let (x, y) = ((i % N) as i32, (i / N) as i32);
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= N as i32 || ny >= N as i32 {
                    continue;
                }
                let j = ny as usize * N + nx as usize;
                if self.state[j] != State::Intact || self.fuel[j] <= MIN_FUEL {
                    continue;
                }
                // En diagonale, le feu ne se faufile pas entre deux cases coupées qui se touchent par le coin
                if dx != 0 && dy != 0 && self.blocked(y as usize * N + nx as usize) && self.blocked(ny as usize * N + x as usize) {
                    continue;
                }
                let step = Vec2::new(dx as f32, dy as f32);
                let len = step.length();
                let wf = wind_factor(speed, step.dot(wind) / len);
                // Le rayonnement du front sèche ce qu'il va brûler
                self.moist[j] = (self.moist[j] - 0.0003 * power * wf.min(3.0)).max(0.012);
                let fj = self.essence[j].fuel();
                let eta_j = damp(self.moist[j] / fj.mx);
                if eta_j <= 0.0 {
                    continue;
                }
                let tan = (self.height[j] - self.height[i]) * H_MAX_M / (len * CELL_M);
                let sf = (3.0 * p.slope * tan).clamp(-1.2, 2.2).exp();
                let ros = fj.ros * p.spread * wf * sf * eta_j * (0.35 + 0.65 * power.min(1.3)) * (0.5 + 0.5 * self.cover[j]) * self.jitter[j];
                self.ign[j] += ros * DT / (len * CELL_M);
                if self.ign[j] >= 1.0 {
                    self.light(j);
                }
            }

            // Sautes de feu : le front projette des brandons sous le vent
            if left > 0.55 && speed > 2.0 && self.rng.f32() < 0.0004 * f.spot * power * (speed / 10.0) * p.spotting {
                let reach = speed * 0.9 * (0.5 + f.spot);
                let d = 2.0 - self.rng.f32().max(1e-4).ln() * reach * 0.5;
                let land = Vec2::new(x as f32, y as f32) + wind * d + across * (self.rng.f32() - 0.5) * d * 0.4;
                if land.x >= 0.0 && land.y >= 0.0 && land.x < N as f32 && land.y < N as f32 {
                    let j = land.y as usize * N + land.x as usize;
                    if self.state[j] == State::Intact && self.fuel[j] > MIN_FUEL && self.rng.f32() < damp(self.moist[j] / self.essence[j].fuel().mx) {
                        self.light(j);
                        self.stats.embers += 1;
                    }
                }
            }
        }
        self.burning.extend(still);
        self.time += DT as f64;
        self.stats.ticks += 1;
        if self.stats.ticks % SLOW_EVERY == 0 {
            self.slow(p);
        }
    }

    /// Ce qui évolue lentement : l'humidité rejoint son équilibre, la chaleur reçue se dissipe.
    fn slow(&mut self, p: &Params) {
        let dt = DT * SLOW_EVERY as f32;
        let k = (dt / 2400.0 * (1.0 + 4.0 * p.rain)).min(1.0);
        for i in 0..CELLS {
            if self.blocked(i) {
                continue;
            }
            self.moist[i] += (self.equilibrium(i, p) - self.moist[i]) * k;
            self.ign[i] *= 0.98;
        }
        let total: u32 = self.stats.burnt.iter().sum();
        let rate = (total - self.last_total) as f32 * HA_PER_CELL / (dt / 3600.0);
        self.stats.pace = self.stats.pace * 0.9 + rate * 0.1;
        self.last_total = total;
    }

    /// Applique `f` aux cases situées à moins de `r` cases de `c`.
    fn brush(&mut self, c: Vec2, r: f32, mut f: impl FnMut(&mut World, usize)) {
        let reach = r.ceil() as i32;
        let (cx, cy) = (c.x.round() as i32, c.y.round() as i32);
        for y in (cy - reach).max(0)..=(cy + reach).min(N as i32 - 1) {
            for x in (cx - reach).max(0)..=(cx + reach).min(N as i32 - 1) {
                if (Vec2::new(x as f32, y as f32) - c).length_squared() <= r * r {
                    f(self, y as usize * N + x as usize);
                }
            }
        }
    }

    /// Met le feu autour de `c` (en cases).
    pub fn ignite(&mut self, c: Vec2, r: f32) {
        self.brush(c, r, |w, i| {
            if w.state[i] == State::Intact && w.fuel[i] > MIN_FUEL {
                w.light(i);
            }
        });
    }

    /// Trace un pare-feu : la végétation est rasée jusqu'au sol. Les engins n'entrent pas dans les flammes.
    pub fn cut(&mut self, c: Vec2, r: f32) {
        self.brush(c, r, |w, i| {
            if matches!(w.state[i], State::Intact | State::Cendre) {
                w.state[i] = State::PareFeu;
                w.fuel[i] = 0.0;
                w.ign[i] = 0.0;
                w.stats.cut += 1;
            }
        });
    }

    /// Largue de l'eau : le combustible est trempé, puis sèche peu à peu.
    pub fn douse(&mut self, c: Vec2, r: f32) {
        self.brush(c, r, |w, i| {
            if !w.blocked(i) {
                w.moist[i] = (w.moist[i] + 0.35).min(0.7);
                w.ign[i] = 0.0;
            }
        });
    }

    /// Humidité moyenne du combustible encore sur pied.
    pub fn mean_moisture(&self) -> f32 {
        let (mut sum, mut n) = (0.0f32, 0u32);
        for i in 0..CELLS {
            if self.state[i] == State::Intact && self.fuel[i] > MIN_FUEL {
                sum += self.moist[i];
                n += 1;
            }
        }
        sum / n.max(1) as f32
    }
}
