//! Les boutons que la fenêtre dessine elle-même en combat, à la place des morceaux de l'écran du bas : des pastilles
//! arrondies à la couleur du type de la capacité (ou du bouton du menu), le nom à gauche, les PP à droite, la catégorie
//! dans une pastille ronde. L'image est faite sur le processeur, en RGBA à alpha prémultiplié, et la fenêtre la pose par-
//! dessus le haut ; un clic dans une pastille reste un toucher de l'écran du bas (`Layout::bottom_point`).
//!
//! La police est celle de Windows (Segoe UI semi-gras, sinon Arial gras), lue au lancement : rien n'est embarqué.

use ab_glyph::{Font, FontVec, PxScale, ScaleFont};

/// La catégorie d'une capacité, dans l'ordre des données du jeu (0 statut, 1 physique, 2 spéciale : supposé, voir
/// `local/analyse/DllBattle/boutons-natifs.md`).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Category {
    Status,
    Physical,
    Special,
}

/// Une pastille : où elle va (dans le repère de la disposition, 400 x 240), sa couleur, ses textes.
#[derive(Clone, PartialEq, Debug)]
pub struct Pill {
    pub to: [f32; 4],
    pub color: [u8; 3],
    pub label: String,
    pub detail: String,
    pub category: Option<Category>,
}

/// Les couleurs des dix-huit types, dans l'ordre du jeu (Normal, Combat, Vol, Poison, Sol, Roche, Insecte, Spectre, Acier,
/// Feu, Eau, Plante, Électrik, Psy, Glace, Dragon, Ténèbres, Fée) : les teintes habituelles des jeux.
pub const TYPE_COLORS: [[u8; 3]; 18] = [
    [146, 146, 120], [190, 50, 44], [140, 128, 220], [150, 64, 150], [212, 178, 96], [176, 152, 64],
    [150, 168, 32], [104, 88, 150], [160, 160, 192], [234, 116, 48], [86, 132, 230], [102, 180, 76],
    [232, 192, 40], [236, 82, 128], [120, 200, 200], [104, 56, 236], [100, 80, 68], [226, 140, 200],
];

pub struct Ui {
    font: FontVec,
}

impl Ui {
    /// La police de Windows ; `None` si aucune n'est lisible (la fenêtre garde alors les morceaux de l'écran du bas).
    pub fn new() -> Option<Ui> {
        ["C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"]
            .iter()
            .find_map(|path| std::fs::read(path).ok().and_then(|bytes| FontVec::try_from_vec(bytes).ok()))
            .map(|font| Ui { font })
    }

    /// L'image des pastilles sur `area` (repère de la disposition), à `scale` pixels par unité : (largeur, hauteur, RGBA
    /// prémultiplié).
    pub fn raster(&self, pills: &[Pill], area: [f32; 4], scale: f32) -> (usize, usize, Vec<u8>) {
        let (w, h) = (((area[2] - area[0]) * scale).ceil().max(1.0) as usize, ((area[3] - area[1]) * scale).ceil().max(1.0) as usize);
        let mut image = Image { w, h, rgba: vec![0; w * h * 4] };
        for pill in pills {
            let r = [(pill.to[0] - area[0]) * scale, (pill.to[1] - area[1]) * scale, (pill.to[2] - area[0]) * scale, (pill.to[3] - area[1]) * scale];
            self.pill(&mut image, r, pill);
        }
        (w, h, image.rgba)
    }

    fn pill(&self, image: &mut Image, r: [f32; 4], pill: &Pill) {
        let height = r[3] - r[1];
        // un peu d'air entre deux pastilles voisines
        let r = [r[0] + height * 0.06, r[1] + height * 0.08, r[2] - height * 0.06, r[3] - height * 0.08];
        let height = r[3] - r[1];
        let radius = height / 2.0;
        let [cr, cg, cb] = pill.color;
        // le fond : la couleur, un peu plus claire en haut ; un bord plus sombre
        image.rounded(r, radius, |y| {
            let t = (y - r[1]) / height;
            let k = 1.12 - 0.24 * t;
            [shade(cr, k), shade(cg, k), shade(cb, k), 235]
        });
        image.rounded_ring(r, radius, height * 0.06, [shade(cr, 0.6), shade(cg, 0.6), shade(cb, 0.6), 255]);
        let mut x = r[0] + radius * 0.6;
        if let Some(category) = pill.category {
            // la catégorie : une pastille ronde à gauche
            let d = height * 0.5;
            let c = [x + d / 2.0, (r[1] + r[3]) / 2.0];
            let color = match category {
                Category::Physical => [236, 96, 40, 255],
                Category::Special => [70, 110, 220, 255],
                Category::Status => [150, 150, 150, 255],
            };
            image.rounded([c[0] - d / 2.0, c[1] - d / 2.0, c[0] + d / 2.0, c[1] + d / 2.0], d / 2.0, |_| color);
            image.rounded_ring([c[0] - d / 2.0, c[1] - d / 2.0, c[0] + d / 2.0, c[1] + d / 2.0], d / 2.0, d * 0.12, [255, 255, 255, 230]);
            x += d + radius * 0.35;
        }
        // les PP à droite, en plus petit ; le nom prend la place qui reste, rapetissé s'il le faut
        let small = height * 0.34;
        let mut right = r[2] - radius * 0.5;
        if !pill.detail.is_empty() {
            let width = self.width(&pill.detail, small);
            right -= width + radius * 0.15;
            self.text(image, &pill.detail, right + radius * 0.15, r[1] + height * 0.5 + small * 0.36, small, r[2]);
            right -= radius * 0.25;
        }
        let mut size = height * 0.44;
        let mut width = self.width(&pill.label, size);
        if x + width > right {
            size = (size * (right - x) / width).max(height * 0.28);
            width = self.width(&pill.label, size);
        }
        // un bouton sans PP ni catégorie (le menu, le retour) : le nom au milieu
        if pill.detail.is_empty() && pill.category.is_none() {
            x = ((r[0] + r[2] - width) / 2.0).max(x);
        }
        self.text(image, &pill.label, x, r[1] + height * 0.5 + size * 0.36, size, right);
    }

    fn width(&self, text: &str, size: f32) -> f32 {
        let font = self.font.as_scaled(PxScale::from(size));
        text.chars().map(|c| font.h_advance(font.glyph_id(c))).sum()
    }

    /// Le texte en blanc avec une ombre, coupé à `right`.
    fn text(&self, image: &mut Image, text: &str, x: f32, baseline: f32, size: f32, right: f32) {
        let font = self.font.as_scaled(PxScale::from(size));
        for (dx, dy, color) in [(size * 0.06, size * 0.06, [0u8, 0, 0, 150]), (0.0, 0.0, [255, 255, 255, 255])] {
            let mut pen = x + dx;
            for c in text.chars() {
                let id = font.glyph_id(c);
                let advance = font.h_advance(id);
                if pen + advance > right + dx {
                    break;
                }
                let glyph = id.with_scale_and_position(PxScale::from(size), ab_glyph::point(pen, baseline + dy));
                if let Some(outline) = self.font.outline_glyph(glyph) {
                    let bounds = outline.px_bounds();
                    outline.draw(|gx, gy, coverage| {
                        image.blend(bounds.min.x as i32 + gx as i32, bounds.min.y as i32 + gy as i32, color, coverage);
                    });
                }
                pen += advance;
            }
        }
    }
}

fn shade(c: u8, k: f32) -> u8 {
    (c as f32 * k).clamp(0.0, 255.0) as u8
}

struct Image {
    w: usize,
    h: usize,
    rgba: Vec<u8>,
}

impl Image {
    /// Pose `color` (non prémultiplié) avec la couverture `a` (0..1) par-dessus ce qui est là.
    fn blend(&mut self, x: i32, y: i32, color: [u8; 4], a: f32) {
        if x < 0 || y < 0 || x as usize >= self.w || y as usize >= self.h || a <= 0.0 {
            return;
        }
        let i = (y as usize * self.w + x as usize) * 4;
        let alpha = a.min(1.0) * color[3] as f32 / 255.0;
        for k in 0..3 {
            let dst = self.rgba[i + k] as f32;
            self.rgba[i + k] = (color[k] as f32 * alpha + dst * (1.0 - alpha)).round() as u8;
        }
        self.rgba[i + 3] = (255.0 * alpha + self.rgba[i + 3] as f32 * (1.0 - alpha)).round() as u8;
    }

    /// La couverture d'un point par un rectangle arrondi (distance signée, adoucie sur un pixel).
    fn coverage(r: [f32; 4], radius: f32, px: f32, py: f32) -> f32 {
        let (cx, cy) = ((r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0);
        let (hx, hy) = ((r[2] - r[0]) / 2.0 - radius, (r[3] - r[1]) / 2.0 - radius);
        let (qx, qy) = (((px - cx).abs() - hx).max(0.0), ((py - cy).abs() - hy).max(0.0));
        let d = (qx * qx + qy * qy).sqrt() - radius;
        (0.5 - d).clamp(0.0, 1.0)
    }

    fn rows(&self, r: [f32; 4]) -> (std::ops::Range<i32>, std::ops::Range<i32>) {
        (r[0].floor() as i32..r[2].ceil() as i32 + 1, r[1].floor() as i32..r[3].ceil() as i32 + 1)
    }

    fn rounded(&mut self, r: [f32; 4], radius: f32, color: impl Fn(f32) -> [u8; 4]) {
        let (xs, ys) = self.rows(r);
        for y in ys {
            let c = color(y as f32 + 0.5);
            for x in xs.clone() {
                let a = Self::coverage(r, radius, x as f32 + 0.5, y as f32 + 0.5);
                self.blend(x, y, c, a);
            }
        }
    }

    /// Le bord intérieur, d'épaisseur `width`.
    fn rounded_ring(&mut self, r: [f32; 4], radius: f32, width: f32, color: [u8; 4]) {
        let inner = [r[0] + width, r[1] + width, r[2] - width, r[3] - width];
        let (xs, ys) = self.rows(r);
        for y in ys {
            for x in xs.clone() {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let a = Self::coverage(r, radius, px, py) - Self::coverage(inner, (radius - width).max(0.0), px, py);
                self.blend(x, y, color, a);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pill_is_drawn_inside_its_place_only() {
        let Some(ui) = Ui::new() else { return }; // sans police de Windows : rien à dessiner
        let pill = Pill { to: [10.0, 10.0, 110.0, 40.0], color: TYPE_COLORS[9], label: "Flammèche".into(), detail: "25/25".into(), category: Some(Category::Special) };
        let (w, h, rgba) = ui.raster(&[pill], [0.0, 0.0, 120.0, 50.0], 2.0);
        assert_eq!((w, h), (240, 100));
        let alpha = |x: usize, y: usize| rgba[(y * w + x) * 4 + 3];
        assert_eq!(alpha(2, 2), 0, "hors de la pastille : transparent");
        assert_eq!(alpha(230, 90), 0);
        assert!(alpha(120, 50) > 200, "au milieu : la couleur");
        // du blanc (le texte) quelque part dans la pastille
        assert!((0..w * h).any(|i| rgba[i * 4] > 240 && rgba[i * 4 + 1] > 240 && rgba[i * 4 + 2] > 240));
    }
}
