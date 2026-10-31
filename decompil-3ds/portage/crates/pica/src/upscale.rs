//! Les filtres de texture : chaque texture du jeu décodée est agrandie 2 fois avant d'aller sur le GPU, comme les filtres
//! des émulateurs. Le shader reçoit la nouvelle taille et la lit à la nouvelle définition (voir `get_texture`).
//!
//! Scale2x : Andrea Mazzoleni (l'algorithme, dit AdvMAME2x). MMPX : Morgan McGuire et Mara Gagiu, JCGT 2021, licence MIT,
//! réécrit d'après l'article. Bicubique : Catmull-Rom.

/// Un pixel RGBA8, comparé tel quel.
type Pixel = [u8; 4];

#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub enum TextureFilter {
    #[default]
    None,
    Scale2x,
    Mmpx,
    Bicubic,
}

impl TextureFilter {
    pub fn from_name(name: &str) -> Option<TextureFilter> {
        match name {
            "aucun" => Some(TextureFilter::None),
            "scale2x" => Some(TextureFilter::Scale2x),
            "mmpx" => Some(TextureFilter::Mmpx),
            "bicubique" => Some(TextureFilter::Bicubic),
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
    let mut out = vec![0u8; width * height * 16];
    for y in 0..height {
        for x in 0..width {
            let block = match filter {
                TextureFilter::None => [source.at(x as isize, y as isize); 4],
                TextureFilter::Scale2x => scale2x(&source, x as isize, y as isize),
                TextureFilter::Mmpx => mmpx(&source, x as isize, y as isize),
                TextureFilter::Bicubic => bicubic(&source, x as isize, y as isize),
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

fn bicubic(s: &Source, x: isize, y: isize) -> [Pixel; 4] {
    // chaque point du bloc tombe un quart de pixel de part et d'autre du centre
    const OFFSETS: [(f32, isize); 2] = [(0.75, -1), (0.25, 0)];
    let mut out = [[0u8; 4]; 4];
    for (row, &(ty, oy)) in OFFSETS.iter().enumerate() {
        let wy = weights(ty);
        for (column, &(tx, ox)) in OFFSETS.iter().enumerate() {
            let wx = weights(tx);
            let mut sum = [0f32; 4];
            for n in 0..4 {
                for k in 0..4 {
                    let p = s.at(x + ox + k as isize - 1, y + oy + n as isize - 1);
                    for c in 0..4 {
                        sum[c] += p[c] as f32 * wx[k] * wy[n];
                    }
                }
            }
            out[row * 2 + column] = sum.map(|v| (v + 0.5).clamp(0.0, 255.0) as u8);
        }
    }
    out
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
