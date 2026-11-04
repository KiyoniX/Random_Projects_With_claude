//! Les boutons que la fenêtre dessine elle-même en combat, à la place des morceaux de l'écran du bas : des pastilles
//! arrondies à la couleur du type de la capacité (ou du bouton du menu), l'icône du type à gauche, le nom, les PP à droite.
//! L'image est faite sur le processeur, en RGBA à alpha prémultiplié, et la fenêtre la pose par-dessus le haut ; un clic
//! dans une pastille reste un toucher de l'écran du bas (`Layout::bottom_point`).
//!
//! La police est celle de Windows (Segoe UI semi-gras, sinon Arial gras), lue au lancement. Les icônes des types sont des
//! dessins vectoriels libres (`assets/types/`, licence MIT de partywhale/pokemon-type-icons), pas des fichiers du jeu.

use ab_glyph::{Font, FontVec, PxScale, ScaleFont};
use resvg::{tiny_skia, usvg};

/// Les icônes des dix-huit types, dans l'ordre du jeu.
const TYPE_ICONS: [&str; 18] = [
    include_str!("../../../assets/types/normal.svg"), include_str!("../../../assets/types/fighting.svg"),
    include_str!("../../../assets/types/flying.svg"), include_str!("../../../assets/types/poison.svg"),
    include_str!("../../../assets/types/ground.svg"), include_str!("../../../assets/types/rock.svg"),
    include_str!("../../../assets/types/bug.svg"), include_str!("../../../assets/types/ghost.svg"),
    include_str!("../../../assets/types/steel.svg"), include_str!("../../../assets/types/fire.svg"),
    include_str!("../../../assets/types/water.svg"), include_str!("../../../assets/types/grass.svg"),
    include_str!("../../../assets/types/electric.svg"), include_str!("../../../assets/types/psychic.svg"),
    include_str!("../../../assets/types/ice.svg"), include_str!("../../../assets/types/dragon.svg"),
    include_str!("../../../assets/types/dark.svg"), include_str!("../../../assets/types/fairy.svg"),
];

/// Une pastille : où elle va (dans le repère de la disposition, 400 x 240), sa couleur, ses textes, le type dont elle
/// montre l'icône.
#[derive(Clone, PartialEq, Debug)]
pub struct Pill {
    pub to: [f32; 4],
    pub color: [u8; 3],
    pub label: String,
    pub detail: String,
    pub kind: Option<usize>,
}

/// Les couleurs des dix-huit types, dans l'ordre du jeu (Normal, Combat, Vol, Poison, Sol, Roche, Insecte, Spectre, Acier,
/// Feu, Eau, Plante, Électrik, Psy, Glace, Dragon, Ténèbres, Fée) : celles du fond des icônes.
pub const TYPE_COLORS: [[u8; 3]; 18] = [
    [0x82, 0x82, 0x82], [0xe4, 0x90, 0x21], [0x74, 0xaa, 0xd0], [0x93, 0x54, 0xcb], [0xa4, 0x73, 0x3c], [0xa9, 0xa4, 0x81],
    [0x9f, 0x9f, 0x28], [0x6f, 0x45, 0x70], [0x77, 0xb2, 0xcb], [0xe4, 0x61, 0x3e], [0x3a, 0x9d, 0xe2], [0x43, 0x98, 0x37],
    [0xdf, 0xbc, 0x28], [0xe9, 0x6c, 0x8c], [0x47, 0xc8, 0xc8], [0x57, 0x6f, 0xbc], [0x4f, 0x47, 0x47], [0xe1, 0x8c, 0xe1],
];

pub struct Ui {
    font: FontVec,
    /// Pour les caractères que la police n'a pas (♂, ♀) : Segoe UI Symbol.
    symbols: Option<FontVec>,
    icons: Vec<usvg::Tree>,
}

impl Ui {
    /// La police de Windows ; `None` si aucune n'est lisible (la fenêtre garde alors les morceaux de l'écran du bas).
    pub fn new() -> Option<Ui> {
        ["C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"]
            .iter()
            .find_map(|path| std::fs::read(path).ok().and_then(|bytes| FontVec::try_from_vec(bytes).ok()))
            .map(|font| Ui {
                font,
                symbols: std::fs::read("C:/Windows/Fonts/seguisym.ttf").ok().and_then(|bytes| FontVec::try_from_vec(bytes).ok()),
                icons: TYPE_ICONS.iter().map(|svg| usvg::Tree::from_str(svg, &usvg::Options::default()).expect("icône de type lisible")).collect(),
            })
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
        let mut x = r[0] + radius * 0.35;
        if let Some(tree) = pill.kind.and_then(|k| self.icons.get(k)) {
            // l'icône du type, ronde, à gauche, cerclée de blanc
            let d = height * 0.72;
            let (ix, iy) = (x, (r[1] + r[3] - d) / 2.0);
            image.icon(tree, ix, iy, d);
            image.rounded_ring([ix, iy, ix + d, iy + d], d / 2.0, d * 0.07, [255, 255, 255, 220]);
            x += d + radius * 0.3;
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
        if pill.detail.is_empty() && pill.kind.is_none() {
            x = ((r[0] + r[2] - width) / 2.0).max(x);
        }
        self.text(image, &pill.label, x, r[1] + height * 0.5 + size * 0.36, size, right);
    }

    /// La police qui a ce caractère : la principale, sinon celle des symboles.
    fn font_for(&self, c: char) -> &FontVec {
        match &self.symbols {
            Some(symbols) if self.font.glyph_id(c).0 == 0 && symbols.glyph_id(c).0 != 0 => symbols,
            _ => &self.font,
        }
    }

    fn width(&self, text: &str, size: f32) -> f32 {
        text.chars().map(|c| {
            let font = self.font_for(c).as_scaled(PxScale::from(size));
            font.h_advance(font.glyph_id(c))
        }).sum()
    }

    /// Le texte en blanc avec une ombre, coupé à `right`.
    fn text(&self, image: &mut Image, text: &str, x: f32, baseline: f32, size: f32, right: f32) {
        for (dx, dy, color) in [(size * 0.06, size * 0.06, [0u8, 0, 0, 150]), (0.0, 0.0, [255, 255, 255, 255])] {
            let mut pen = x + dx;
            for c in text.chars() {
                let base = self.font_for(c);
                let font = base.as_scaled(PxScale::from(size));
                let id = font.glyph_id(c);
                let advance = font.h_advance(id);
                if pen + advance > right + dx {
                    break;
                }
                let glyph = id.with_scale_and_position(PxScale::from(size), ab_glyph::point(pen, baseline + dy));
                if let Some(outline) = base.outline_glyph(glyph) {
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

    /// Une icône vectorielle dans le carré de côté `d` en (`x`, `y`), par-dessus ce qui est là.
    fn icon(&mut self, tree: &usvg::Tree, x: f32, y: f32, d: f32) {
        let (px, py) = (x.floor(), y.floor());
        let side = (d + 2.0).ceil() as u32;
        let Some(mut pixmap) = tiny_skia::Pixmap::new(side, side) else { return };
        let size = tree.size();
        let transform = tiny_skia::Transform::from_translate(x - px, y - py).pre_scale(d / size.width(), d / size.height());
        resvg::render(tree, transform, &mut pixmap.as_mut());
        // tiny-skia est déjà en alpha prémultiplié : source par-dessus
        for (i, src) in pixmap.data().chunks_exact(4).enumerate() {
            let (dx, dy) = (px as i32 + (i as u32 % side) as i32, py as i32 + (i as u32 / side) as i32);
            if src[3] == 0 || dx < 0 || dy < 0 || dx as usize >= self.w || dy as usize >= self.h {
                continue;
            }
            let at = (dy as usize * self.w + dx as usize) * 4;
            let keep = 1.0 - src[3] as f32 / 255.0;
            for k in 0..4 {
                self.rgba[at + k] = (src[k] as f32 + self.rgba[at + k] as f32 * keep).round().min(255.0) as u8;
            }
        }
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
        let pill = Pill { to: [10.0, 10.0, 110.0, 40.0], color: TYPE_COLORS[9], label: "Flammèche".into(), detail: "25/25".into(), kind: Some(9) };
        let (w, h, rgba) = ui.raster(&[pill], [0.0, 0.0, 120.0, 50.0], 2.0);
        assert_eq!((w, h), (240, 100));
        let alpha = |x: usize, y: usize| rgba[(y * w + x) * 4 + 3];
        assert_eq!(alpha(2, 2), 0, "hors de la pastille : transparent");
        assert_eq!(alpha(230, 90), 0);
        assert!(alpha(120, 50) > 200, "au milieu : la couleur");
        // du blanc (le texte) quelque part dans la pastille
        assert!((0..w * h).any(|i| rgba[i * 4] > 240 && rgba[i * 4 + 1] > 240 && rgba[i * 4 + 2] > 240));
        // les dix-huit icônes se lisent et tiennent dans leur carré
        assert_eq!(ui.icons.len(), 18);
        assert!(ui.icons.iter().all(|t| t.size().width() > 0.0));
    }
}
