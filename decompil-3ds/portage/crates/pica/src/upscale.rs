//! Les filtres de texture : chaque texture du jeu décodée est agrandie 2 fois avant d'aller sur le GPU, comme les filtres
//! des émulateurs. Le shader reçoit la nouvelle taille et la lit à la nouvelle définition (voir `get_texture`).
//!
//! Scale2x : Andrea Mazzoleni (l'algorithme, dit AdvMAME2x). MMPX : Morgan McGuire et Mara Gagiu, JCGT 2021, licence MIT,
//! réécrit d'après l'article. Bicubique : Catmull-Rom. ScaleForce (BreadFish64, MIT) et Anime4K (bloc97, MIT) : réécrits
//! d'après les shaders que Citra et Azahar utilisent, sur le processeur et à la taille 2 fois.

/// Un pixel RGBA8, comparé tel quel.
type Pixel = [u8; 4];

#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub enum TextureFilter {
    #[default]
    None,
    Scale2x,
    Mmpx,
    Bicubic,
    ScaleForce,
    Anime4k,
}

impl TextureFilter {
    pub fn from_name(name: &str) -> Option<TextureFilter> {
        match name {
            "aucun" => Some(TextureFilter::None),
            "scale2x" => Some(TextureFilter::Scale2x),
            "mmpx" => Some(TextureFilter::Mmpx),
            "bicubique" => Some(TextureFilter::Bicubic),
            "scaleforce" => Some(TextureFilter::ScaleForce),
            "anime4k" => Some(TextureFilter::Anime4k),
            _ => None,
        }
    }
}

/// Lit un pixel ; hors de l'image, le bord le plus proche.
struct Source<'a> {
    rgba: &'a [u8],
    width: usize,
    height: usize,
}

impl Source<'_> {
    fn at(&self, x: isize, y: isize) -> Pixel {
        let x = x.clamp(0, self.width as isize - 1) as usize;
        let y = y.clamp(0, self.height as isize - 1) as usize;
        let i = (y * self.width + x) * 4;
        [self.rgba[i], self.rgba[i + 1], self.rgba[i + 2], self.rgba[i + 3]]
    }
}

/// `rgba` agrandie 2 fois : (largeur, hauteur) doublées, 4 octets par point.
pub fn upscale2x(filter: TextureFilter, rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
    let source = Source { rgba, width, height };
    let lines = if filter == TextureFilter::Anime4k { line_map(&source) } else { Vec::new() };
    let mut out = vec![0u8; width * height * 16];
    for y in 0..height {
        for x in 0..width {
            let block = match filter {
                TextureFilter::None => [source.at(x as isize, y as isize); 4],
                TextureFilter::Scale2x => scale2x(&source, x as isize, y as isize),
                TextureFilter::Mmpx => mmpx(&source, x as isize, y as isize),
                TextureFilter::Bicubic => bicubic(&source, x as isize, y as isize),
                TextureFilter::ScaleForce => scale_force(&source, x as isize, y as isize),
                TextureFilter::Anime4k => anime4k(&source, &lines, x as isize, y as isize),
            };
            for (i, pixel) in block.iter().enumerate() {
                let at = ((2 * y + i / 2) * 2 * width + 2 * x + i % 2) * 4;
                out[at..at + 4].copy_from_slice(pixel);
            }
        }
    }
    out
}

fn scale2x(s: &Source, x: isize, y: isize) -> [Pixel; 4] {
    let (b, d, e, f, h) = (s.at(x, y - 1), s.at(x - 1, y), s.at(x, y), s.at(x + 1, y), s.at(x, y + 1));
    if b == h || d == f {
        return [e; 4];
    }
    [if d == b { d } else { e }, if b == f { f } else { e }, if d == h { d } else { e }, if h == f { f } else { e }]
}

fn luma(p: Pixel) -> u32 {
    p[0] as u32 + p[1] as u32 + p[2] as u32
}

fn all3(a: Pixel, b: Pixel, c: Pixel, d: Pixel) -> bool {
    a == b && a == c && a == d
}

fn all4(a: Pixel, b: Pixel, c: Pixel, d: Pixel, e: Pixel) -> bool {
    a == b && a == c && a == d && a == e
}

fn any3(a: Pixel, b: Pixel, c: Pixel, d: Pixel) -> bool {
    a == b || a == c || a == d
}

fn none4(a: Pixel, b: Pixel, c: Pixel, d: Pixel, e: Pixel) -> bool {
    a != b && a != c && a != d && a != e
}

fn mmpx(s: &Source, x: isize, y: isize) -> [Pixel; 4] {
    let (a, b, c) = (s.at(x - 1, y - 1), s.at(x, y - 1), s.at(x + 1, y - 1));
    let (d, e, f) = (s.at(x - 1, y), s.at(x, y), s.at(x + 1, y));
    let (g, h, i) = (s.at(x - 1, y + 1), s.at(x, y + 1), s.at(x + 1, y + 1));
    let (mut j, mut k, mut l, mut m) = (e, e, e, e);
    if a == e && b == e && c == e && d == e && f == e && g == e && h == e && i == e {
        return [j, k, l, m];
    }
    let (p, q, r, t) = (s.at(x, y - 2), s.at(x - 2, y), s.at(x + 2, y), s.at(x, y + 2));
    let (bl, dl, el, fl, hl) = (luma(b), luma(d), luma(e), luma(f), luma(h));
    // les pentes à 45°
    if d == b && d != h && d != f && (el >= dl || e == a) && any3(e, a, c, g) && (el < dl || a != d || e != p || e != q) {
        j = d;
    }
    if b == f && b != d && b != h && (el >= bl || e == c) && any3(e, a, c, i) && (el < bl || c != b || e != p || e != r) {
        k = b;
    }
    if h == d && h != f && h != b && (el >= hl || e == g) && any3(e, a, g, i) && (el < hl || g != h || e != t || e != q) {
        l = h;
    }
    if f == h && f != b && f != d && (el >= fl || e == i) && any3(e, c, g, i) && (el < fl || i != h || e != r || e != t) {
        m = f;
    }
    // les croisements
    if e != f && all4(e, c, i, d, q) && f == b && f == h && f != s.at(x + 3, y) {
        k = f;
        m = f;
    }
    if e != d && all4(e, a, g, f, r) && d == b && d == h && d != s.at(x - 3, y) {
        j = d;
        l = d;
    }
    if e != h && all4(e, g, i, b, p) && h == d && h == f && h != s.at(x, y + 3) {
        l = h;
        m = h;
    }
    if e != b && all4(e, a, c, h, t) && b == d && b == f && b != s.at(x, y - 3) {
        j = b;
        k = b;
    }
    if bl < el && all4(e, g, h, i, t) && none4(e, a, d, c, f) {
        j = b;
        k = b;
    }
    if hl < el && all4(e, a, b, c, p) && none4(e, d, g, i, f) {
        l = h;
        m = h;
    }
    if fl < el && all4(e, a, d, g, q) && none4(e, b, c, i, h) {
        k = f;
        m = f;
    }
    if dl < el && all4(e, c, f, i, r) && none4(e, b, a, g, h) {
        j = d;
        l = d;
    }
    // les pentes de 2 pour 1
    if h != b {
        if h != a && h != e && h != c {
            if all3(h, g, f, r) && h != d && h != s.at(x + 2, y - 1) {
                l = m;
            }
            if all3(h, i, d, q) && h != f && h != s.at(x - 2, y - 1) {
                m = l;
            }
        }
        if b != i && b != g && b != e {
            if all3(b, a, f, r) && b != d && b != s.at(x + 2, y + 1) {
                j = k;
            }
            if all3(b, c, d, q) && b != f && b != s.at(x - 2, y + 1) {
                k = j;
            }
        }
    }
    if f != d {
        if d != i && d != e && d != c {
            if all3(d, a, h, t) && d != b && d != s.at(x + 1, y + 2) {
                j = l;
            }
            if all3(d, g, b, p) && d != h && d != s.at(x + 1, y - 2) {
                l = j;
            }
        }
        if f != e && f != a && f != g {
            if all3(f, c, h, t) && f != b && f != s.at(x - 1, y + 2) {
                k = m;
            }
            if all3(f, i, b, p) && f != h && f != s.at(x - 1, y - 2) {
                m = k;
            }
        }
    }
    [j, k, l, m]
}

/// Les poids de Catmull-Rom pour une position `t` entre les deux échantillons du milieu.
fn weights(t: f32) -> [f32; 4] {
    let (t2, t3) = (t * t, t * t * t);
    [(-t3 + 2.0 * t2 - t) / 2.0, (3.0 * t3 - 5.0 * t2 + 2.0) / 2.0, (-3.0 * t3 + 4.0 * t2 + t) / 2.0, (t3 - t2) / 2.0]
}

/// Le pixel au point (px, py), en coordonnées où les centres des pixels sont entiers, par quatre colonnes et quatre lignes.
fn resample(s: &Source, px: f32, py: f32, weights: fn(f32) -> [f32; 4]) -> Pixel {
    let (fx, fy) = (px.floor(), py.floor());
    let (wx, wy) = (weights(px - fx), weights(py - fy));
    let mut sum = [0f32; 4];
    for n in 0..4 {
        for k in 0..4 {
            let p = s.at(fx as isize + k as isize - 1, fy as isize + n as isize - 1);
            for c in 0..4 {
                sum[c] += p[c] as f32 * wx[k] * wy[n];
            }
        }
    }
    sum.map(|v| (v + 0.5).clamp(0.0, 255.0) as u8)
}

/// Chaque point du bloc tombe un quart de pixel de part et d'autre du centre.
const QUARTERS: [(f32, f32); 4] = [(-0.25, -0.25), (0.25, -0.25), (-0.25, 0.25), (0.25, 0.25)];

fn bicubic(s: &Source, x: isize, y: isize) -> [Pixel; 4] {
    QUARTERS.map(|(dx, dy)| resample(s, x as f32 + dx, y as f32 + dy, weights))
}

/// La spline cubique de ScaleForce (qui lisse, là où Catmull-Rom accentue).
fn spline_weights(t: f32) -> [f32; 4] {
    let n = [1.0 - t, 2.0 - t, 3.0 - t].map(|v| v * v * v);
    let (a, b, c) = (n[0], n[1] - 4.0 * n[0], n[2] - 4.0 * n[1] + 6.0 * n[0]);
    [a / 6.0, b / 6.0, c / 6.0, (6.0 - a - b - c) / 6.0]
}

/// L'écart de `other` à `center` selon ScaleForce : la somme des composantes YCbCr, pondérée par les alphas.
fn color_distance(center: Pixel, other: Pixel) -> f32 {
    const K: [f32; 3] = [0.2627, 0.6780, 0.0593];
    const LUMINANCE: f32 = 0.6;
    let columns = [
        [K[0] * LUMINANCE, K[1] * LUMINANCE, K[2] * LUMINANCE],
        [-0.5 * K[0] / (1.0 - K[2]), -0.5 * K[1] / (1.0 - K[2]), 0.5],
        [0.5, -0.5 * K[1] / (1.0 - K[0]), -0.5 * K[2] / (1.0 - K[0])],
    ];
    let unit = |v: u8| v as f32 / 255.0;
    let sum: f32 = (0..3).map(|c| (unit(other[c]) - unit(center[c])) * columns[c].iter().sum::<f32>()).sum();
    let (a, b) = (unit(center[3]), unit(other[3]));
    ((sum * sum + (a - b).abs()) * a * b).sqrt()
}

fn scale_force(s: &Source, x: isize, y: isize) -> [Pixel; 4] {
    let center = s.at(x, y);
    let distance = |dx: isize, dy: isize| color_distance(center, s.at(x + dx, y + dy));
    let top = [distance(-1, 1), distance(0, 1), distance(1, 1), distance(1, 0)];
    let bottom = [distance(1, -1), distance(0, -1), distance(-1, -1), distance(-1, 0)];
    let total: f32 = top.iter().chain(&bottom).sum();
    if total == 0.0 {
        return [center; 4];
    }
    let d: [f32; 4] = std::array::from_fn(|i| top[i] - bottom[i]);
    let (ox, oy) = (d[3] + d[2] - d[0], d[1] + d[2] + d[0]);
    // un point fin dont tous les voisins diffèrent : le décalage atteindrait du vide, on le borne
    let limit = (ox * ox + oy * oy).sqrt() / total;
    let (ox, oy) = (ox.clamp(-limit, limit), oy.clamp(-limit, limit));
    QUARTERS.map(|(dx, dy)| resample(s, x as f32 + dx - ox, y as f32 + dy - oy, spline_weights))
}

/// La carte d'Anime4K, de la taille de l'image : 1 - la norme du gradient de Sobel de la luminance.
fn line_map(s: &Source) -> Vec<f32> {
    let luma = |x: isize, y: isize| {
        let p = s.at(x, y);
        (0.2627 * p[0] as f32 + 0.6780 * p[1] as f32 + 0.0593 * p[2] as f32) / 255.0
    };
    let mut out = Vec::with_capacity(s.width * s.height);
    for y in 0..s.height as isize {
        for x in 0..s.width as isize {
            let across = |y: isize| (luma(x + 1, y) - luma(x - 1, y), luma(x - 1, y) + 2.0 * luma(x, y) + luma(x + 1, y));
            let (top, center, bottom) = (across(y + 1), across(y), across(y - 1));
            let (gx, gy) = (top.0 + 2.0 * center.0 + bottom.0, bottom.1 - top.1);
            out.push(1.0 - (gx * gx + gy * gy).sqrt());
        }
    }
    out
}

fn bilinear(corners: [[f32; 4]; 4], tx: f32, ty: f32) -> [f32; 4] {
    let [a, b, c, d] = corners;
    std::array::from_fn(|i| (a[i] * (1.0 - tx) + b[i] * tx) * (1.0 - ty) + (c[i] * (1.0 - tx) + d[i] * tx) * ty)
}

/// Les huit noyaux d'Anime4K : les voisins sombres et les clairs d'un trait. Le centre compte toujours parmi les sombres.
/// Si le plus sombre des clairs dépasse tous les sombres, le point tire vers les clairs.
const KERNELS: [([(isize, isize); 3], [(isize, isize); 3]); 8] = [
    ([(1, 1), (0, 1), (-1, 1)], [(-1, -1), (0, -1), (1, -1)]),
    ([(-1, -1), (0, -1), (1, -1)], [(1, 1), (0, 1), (-1, 1)]),
    ([(0, 0), (-1, 0), (0, 1)], [(1, 0), (0, -1), (1, -1)]),
    ([(0, 0), (1, 0), (0, -1)], [(-1, 1), (-1, 0), (0, 1)]),
    ([(-1, 0), (-1, -1), (-1, 1)], [(1, 0), (1, 1), (1, -1)]),
    ([(1, 0), (1, 1), (1, -1)], [(-1, 0), (-1, -1), (-1, 1)]),
    ([(0, 0), (-1, 0), (0, -1)], [(1, 0), (1, 1), (0, 1)]),
    ([(0, 0), (1, 0), (0, 1)], [(0, -1), (-1, 0), (-1, -1)]),
];

fn anime4k(s: &Source, lines: &[f32], x: isize, y: isize) -> [Pixel; 4] {
    const LINE_THRESHOLD: f32 = 0.4;
    const STRENGTH: f32 = 0.6;
    QUARTERS.map(|(qx, qy)| {
        let (fx, fy) = ((x as f32 + qx).floor(), (y as f32 + qy).floor());
        let (tx, ty) = (x as f32 + qx - fx, y as f32 + qy - fy);
        let (fx, fy) = (fx as isize, fy as isize);
        let around = |dx: isize, dy: isize, at: &dyn Fn(isize, isize) -> [f32; 4]| {
            let (x, y) = (fx + dx, fy + dy);
            bilinear([at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)], tx, ty)
        };
        let line_at = |x: isize, y: isize| {
            let (x, y) = (x.clamp(0, s.width as isize - 1) as usize, y.clamp(0, s.height as isize - 1) as usize);
            [lines[y * s.width + x]; 4]
        };
        let line = |dx: isize, dy: isize| around(dx, dy, &line_at)[0];
        let color = |dx: isize, dy: isize| around(dx, dy, &|x, y| s.at(x, y).map(|v| v as f32));
        let center = color(0, 0);
        let kernel = if line(0, 0) > LINE_THRESHOLD {
            None
        } else {
            KERNELS.iter().find(|(dark, light)| {
                let darkest_light = light.iter().map(|&(a, b)| line(a, b)).fold(f32::MAX, f32::min);
                darkest_light > line(0, 0) && dark.iter().all(|&(a, b)| darkest_light > line(a, b))
            })
        };
        let out = match kernel {
            None => center,
            Some((_, light)) => {
                let sum = light.iter().fold([0f32; 4], |sum, &(a, b)| {
                    let c = color(a, b);
                    std::array::from_fn(|i| sum[i] + c[i] / 3.0)
                });
                std::array::from_fn(|i| center[i] * (1.0 - STRENGTH) + sum[i] * STRENGTH)
            }
        };
        out.map(|v| (v + 0.5).clamp(0.0, 255.0) as u8)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: Pixel = [255, 255, 255, 255];
    const K: Pixel = [0, 0, 0, 255];

    fn image(pixels: &[Pixel]) -> Vec<u8> {
        pixels.iter().flatten().copied().collect()
    }

    fn pixel(out: &[u8], width: usize, x: usize, y: usize) -> Pixel {
        let i = (y * width + x) * 4;
        [out[i], out[i + 1], out[i + 2], out[i + 3]]
    }

    #[test]
    fn new_filters_keep_flat_colours_and_the_size() {
        let flat = image(&[W; 16]);
        for filter in [TextureFilter::ScaleForce, TextureFilter::Anime4k] {
            let out = upscale2x(filter, &flat, 4, 4);
            assert_eq!(out.len(), 64 * 4);
            assert!(out.chunks(4).all(|p| p == W), "{filter:?}");
        }
    }

    #[test]
    fn new_filters_keep_the_two_sides_of_an_edge() {
        let mut pixels = Vec::new();
        for _ in 0..8 {
            pixels.extend_from_slice(&[K, K, K, K, W, W, W, W]);
        }
        for filter in [TextureFilter::ScaleForce, TextureFilter::Anime4k] {
            let out = upscale2x(filter, &image(&pixels), 8, 8);
            assert_eq!(pixel(&out, 16, 1, 8), K, "{filter:?}");
            assert_eq!(pixel(&out, 16, 14, 8), W, "{filter:?}");
        }
    }

    #[test]
    fn a_flat_image_stays_flat_with_every_filter() {
        let flat = image(&[[10, 20, 30, 40]; 16]);
        for filter in [TextureFilter::None, TextureFilter::Scale2x, TextureFilter::Mmpx, TextureFilter::Bicubic] {
            let out = upscale2x(filter, &flat, 4, 4);
            assert_eq!(out.len(), 8 * 8 * 4);
            assert!(out.chunks_exact(4).all(|p| p == [10, 20, 30, 40]), "{filter:?}");
        }
    }

    #[test]
    fn no_filter_doubles_each_pixel() {
        let out = upscale2x(TextureFilter::None, &image(&[W, K]), 2, 1);
        assert_eq!((pixel(&out, 4, 1, 1), pixel(&out, 4, 2, 0)), (W, K));
    }

    #[test]
    fn scale2x_rounds_a_corner() {
        // E (blanc) a du noir en haut et à gauche : son coin haut gauche passe au noir, le reste non
        let source = image(&[K, K, W, K, W, W, W, W, W]);
        let out = upscale2x(TextureFilter::Scale2x, &source, 3, 3);
        assert_eq!(pixel(&out, 6, 2, 2), K);
        assert_eq!(pixel(&out, 6, 3, 3), W);
    }

    #[test]
    fn mmpx_keeps_colors_and_rounds_a_stair() {
        // un escalier noir sur blanc : aucune couleur nouvelle, et le coin intérieur s'adoucit
        #[rustfmt::skip]
        let source = image(&[
            K, W, W, W, W,
            K, K, W, W, W,
            K, K, K, W, W,
            K, K, K, K, W,
            K, K, K, K, K,
        ]);
        let out = upscale2x(TextureFilter::Mmpx, &source, 5, 5);
        assert!(out.chunks_exact(4).all(|p| p == W || p == K));
        assert_eq!(pixel(&out, 10, 6, 5), K, "le coin de la marche prend le noir de sa diagonale");
    }

    #[test]
    fn bicubic_interpolates_between_two_columns() {
        let source = image(&[K, K, W, W, K, K, W, W]);
        let out = upscale2x(TextureFilter::Bicubic, &source, 4, 2);
        // entre le noir et le blanc, de façon croissante
        let row: Vec<u8> = (0..8).map(|x| pixel(&out, 8, x, 1)[0]).collect();
        assert!(row[3] < row[4], "{row:?}");
        assert!(row[3] > 0 && row[4] < 255, "{row:?}");
    }

    #[test]
    fn names_are_known() {
        assert_eq!(TextureFilter::from_name("mmpx"), Some(TextureFilter::Mmpx));
        assert_eq!(TextureFilter::from_name("xyz"), None);
    }
}
