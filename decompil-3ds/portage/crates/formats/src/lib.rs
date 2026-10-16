//! Les formats de pixels et le rangement en tuiles du processeur graphique PICA200.
//!
//! Port fidèle de `banc/pica/formats.py`. Un « pixel décodé » est toujours RGBA sur 4 octets.
//!
//! Le rangement en tuiles : l'image est coupée en tuiles de 8 x 8 points, rangées ligne de tuiles par ligne de
//! tuiles ; dans une tuile, les points sont dans l'ordre de Morton (bits de x et de y entrelacés, x en bit de poids
//! faible). La ligne 0 de la sortie est la première ligne de la mémoire.

/// Rang de Morton d'un point (x, y) dans une tuile 8 x 8.
const fn morton(x: usize, y: usize) -> usize {
    (x & 1) | ((y & 1) << 1) | ((x & 2) << 1) | ((y & 2) << 2) | ((x & 4) << 2) | ((y & 4) << 3)
}

/// `MORTON[y][x]` = rang du point dans la tuile.
const MORTON: [[u8; 8]; 8] = {
    let mut table = [[0u8; 8]; 8];
    let mut y = 0;
    while y < 8 {
        let mut x = 0;
        while x < 8 {
            table[y][x] = morton(x, y) as u8;
            x += 1;
        }
        y += 1;
    }
    table
};

/// Formats de couleur (tampons de rendu, écrans, textures 0 à 4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorFormat {
    Rgba8,
    Rgb8,
    Rgb565,
    Rgb5a1,
    Rgba4,
}

impl ColorFormat {
    /// Octets par point.
    pub fn bytes_per_pixel(self) -> usize {
        match self {
            ColorFormat::Rgba8 => 4,
            ColorFormat::Rgb8 => 3,
            _ => 2,
        }
    }

    /// Numérotation des transferts GX et des tampons d'écran (`GX_FORMATS`).
    pub fn from_gx(id: u32) -> Option<Self> {
        Some(match id {
            0 => ColorFormat::Rgba8,
            1 => ColorFormat::Rgb8,
            2 => ColorFormat::Rgb565,
            3 => ColorFormat::Rgb5a1,
            4 => ColorFormat::Rgba4,
            _ => return None,
        })
    }

    /// Numérotation du tampon de couleur du PICA (`COLORBUFFER_FORMATS`).
    pub fn from_color_buffer(id: u32) -> Option<Self> {
        Some(match id {
            0 => ColorFormat::Rgba8,
            1 => ColorFormat::Rgb8,
            2 => ColorFormat::Rgb5a1,
            3 => ColorFormat::Rgb565,
            4 => ColorFormat::Rgba4,
            _ => return None,
        })
    }
}

/// Les 14 formats de texture du PICA (`TEXTURE_FORMATS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextureFormat {
    Rgba8,
    Rgb8,
    Rgb5a1,
    Rgb565,
    Rgba4,
    La8,
    Hilo8,
    L8,
    A8,
    La4,
    L4,
    A4,
    Etc1,
    Etc1a4,
}

impl TextureFormat {
    pub fn from_id(id: u32) -> Option<Self> {
        use TextureFormat::*;
        Some(match id {
            0 => Rgba8,
            1 => Rgb8,
            2 => Rgb5a1,
            3 => Rgb565,
            4 => Rgba4,
            5 => La8,
            6 => Hilo8,
            7 => L8,
            8 => A8,
            9 => La4,
            10 => L4,
            11 => A4,
            12 => Etc1,
            13 => Etc1a4,
            _ => return None,
        })
    }

    /// Bits par point (4 pour les demi-octets et ETC1).
    pub fn bits_per_pixel(self) -> usize {
        use TextureFormat::*;
        match self {
            Rgba8 => 32,
            Rgb8 => 24,
            Rgb5a1 | Rgb565 | Rgba4 | La8 | Hilo8 => 16,
            L8 | A8 | La4 | Etc1a4 => 8,
            L4 | A4 | Etc1 => 4,
        }
    }

    /// Le format de couleur équivalent, pour les textures 0 à 4.
    fn color(self) -> Option<ColorFormat> {
        Some(match self {
            TextureFormat::Rgba8 => ColorFormat::Rgba8,
            TextureFormat::Rgb8 => ColorFormat::Rgb8,
            TextureFormat::Rgb5a1 => ColorFormat::Rgb5a1,
            TextureFormat::Rgb565 => ColorFormat::Rgb565,
            TextureFormat::Rgba4 => ColorFormat::Rgba4,
            _ => return None,
        })
    }
}

/// Étend une valeur de `bits` bits à 8 bits en répétant les bits hauts (255 reste 255).
fn expand_bits(value: u32, bits: u32) -> u8 {
    (match bits {
        5 => (value << 3) | (value >> 2),
        6 => (value << 2) | (value >> 4),
        4 => (value << 4) | value,
        1 => value * 255,
        _ => unreachable!("largeur de champ inconnue : {bits}"),
    }) as u8
}

/// Passe d'octets rangés en tuiles à des lignes de `width * unit` octets (sortie `height * width * unit`).
///
/// Les tuiles sont lues entières, puis l'image est recadrée. Contrairement au Python, un `raw` trop court n'est
/// pas une erreur ici : les points manquants restent à zéro (`decode_texture` vérifie la taille avant).
pub fn tiled_to_linear(raw: &[u8], width: usize, height: usize, unit: usize) -> Vec<u8> {
    let tw = width.div_ceil(8);
    let mut out = vec![0u8; height * width * unit];
    for y in 0..height {
        let (ty, iy) = (y / 8, y % 8);
        for x in 0..width {
            let (tx, ix) = (x / 8, x % 8);
            let src = ((ty * tw + tx) * 64 + MORTON[iy][ix] as usize) * unit;
            if let Some(px) = raw.get(src..src + unit) {
                let dst = (y * width + x) * unit;
                out[dst..dst + unit].copy_from_slice(px);
            }
        }
    }
    out
}

/// L'inverse : lignes de `width * unit` octets -> octets en tuiles (largeur et hauteur complétées à 8 par des zéros).
pub fn linear_to_tiled(image: &[u8], width: usize, height: usize, unit: usize) -> Vec<u8> {
    assert!(image.len() >= width * height * unit, "image trop courte");
    let (tw, th) = (width.div_ceil(8), height.div_ceil(8));
    let mut out = vec![0u8; tw * th * 64 * unit];
    for y in 0..height {
        let (ty, iy) = (y / 8, y % 8);
        for x in 0..width {
            let (tx, ix) = (x / 8, x % 8);
            let dst = ((ty * tw + tx) * 64 + MORTON[iy][ix] as usize) * unit;
            let src = (y * width + x) * unit;
            out[dst..dst + unit].copy_from_slice(&image[src..src + unit]);
        }
    }
    out
}

/// Un point d'un format de couleur -> RGBA.
fn decode_one(fmt: ColorFormat, p: &[u8], out: &mut [u8]) {
    match fmt {
        ColorFormat::Rgba8 => out.copy_from_slice(&[p[3], p[2], p[1], p[0]]), // mémoire : A B G R
        ColorFormat::Rgb8 => out.copy_from_slice(&[p[2], p[1], p[0], 255]),   // mémoire : B G R
        _ => {
            let v = p[0] as u32 | (p[1] as u32) << 8;
            let rgba = match fmt {
                ColorFormat::Rgb565 => [
                    expand_bits(v >> 11, 5),
                    expand_bits((v >> 5) & 0x3F, 6),
                    expand_bits(v & 0x1F, 5),
                    255,
                ],
                ColorFormat::Rgb5a1 => [
                    expand_bits(v >> 11, 5),
                    expand_bits((v >> 6) & 0x1F, 5),
                    expand_bits((v >> 1) & 0x1F, 5),
                    ((v & 1) * 255) as u8,
                ],
                _ => [
                    expand_bits(v >> 12, 4),
                    expand_bits((v >> 8) & 0xF, 4),
                    expand_bits((v >> 4) & 0xF, 4),
                    expand_bits(v & 0xF, 4),
                ],
            };
            out.copy_from_slice(&rgba);
        }
    }
}

/// Suite de points (n * unit octets) d'un format de couleur -> RGBA8 (n * 4 octets). Un reste incomplet est ignoré.
pub fn decode_pixels(fmt: ColorFormat, data: &[u8]) -> Vec<u8> {
    let unit = fmt.bytes_per_pixel();
    let n = data.len() / unit;
    let mut out = vec![0u8; n * 4];
    for (p, o) in data.chunks_exact(unit).zip(out.chunks_exact_mut(4)) {
        decode_one(fmt, p, o);
    }
    out
}

/// RGBA8 -> points du format de couleur (mêmes troncatures que le Python : pas d'arrondi).
pub fn encode_pixels(fmt: ColorFormat, rgba: &[u8]) -> Vec<u8> {
    let unit = fmt.bytes_per_pixel();
    let n = rgba.len() / 4;
    let mut out = vec![0u8; n * unit];
    for (p, o) in rgba.chunks_exact(4).zip(out.chunks_exact_mut(unit)) {
        let (r, g, b, a) = (p[0] as u32, p[1] as u32, p[2] as u32, p[3] as u32);
        let value = match fmt {
            ColorFormat::Rgba8 => {
                o.copy_from_slice(&[p[3], p[2], p[1], p[0]]);
                continue;
            }
            ColorFormat::Rgb8 => {
                o.copy_from_slice(&[p[2], p[1], p[0]]);
                continue;
            }
            ColorFormat::Rgb565 => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3),
            ColorFormat::Rgb5a1 => ((r >> 3) << 11) | ((g >> 3) << 6) | ((b >> 3) << 1) | (a >> 7),
            ColorFormat::Rgba4 => ((r >> 4) << 12) | ((g >> 4) << 8) | ((b >> 4) << 4) | (a >> 4),
        };
        o[0] = (value & 0xFF) as u8;
        o[1] = (value >> 8) as u8;
    }
    out
}

// --- les textures ---

/// Tables de modificateurs d'intensité d'ETC1 : (petit, grand).
const ETC1_TABLES: [[i32; 2]; 8] = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];

/// Décode un bloc ETC1 de 4 x 4 (8 octets, mot de 64 bits petit-boutiste comme la 3DS les range) en RGB, `[y][x]`.
fn decode_etc1_block(block: &[u8]) -> [[[u8; 3]; 4]; 4] {
    // dans l'ordre standard : en-tête (octets 0 à 3) puis index des pixels (octets 4 à 7)
    let std = |i: usize| block[7 - i] as i32;
    let flags = std(3);
    let diff = (flags >> 1) & 1 == 1;
    let flip = flags & 1 == 1;
    let tables = [ETC1_TABLES[((flags >> 5) & 7) as usize], ETC1_TABLES[((flags >> 2) & 7) as usize]];
    let mut base = [[0i32; 3]; 2];
    for c in 0..3 {
        let byte = std(c);
        if diff {
            // 5 bits et un delta signé de 3 bits
            let d1 = byte >> 3;
            let delta = byte & 7;
            let delta = if delta >= 4 { delta - 8 } else { delta };
            let d2 = (d1 + delta).clamp(0, 31);
            base[0][c] = (d1 << 3) | (d1 >> 2);
            base[1][c] = (d2 << 3) | (d2 >> 2);
        } else {
            // deux fois 4 bits
            base[0][c] = (byte >> 4) * 17;
            base[1][c] = (byte & 15) * 17;
        }
    }
    let bits = (std(4) as u32) << 24 | (std(5) as u32) << 16 | (std(6) as u32) << 8 | std(7) as u32;
    let mut out = [[[0u8; 3]; 4]; 4];
    for (y, row) in out.iter_mut().enumerate() {
        for (x, px) in row.iter_mut().enumerate() {
            let k = x * 4 + y;
            let msb = (bits >> (k + 16)) & 1;
            let lsb = (bits >> k) & 1;
            let second = if flip { y >= 2 } else { x >= 2 } as usize;
            let magnitude = tables[second][lsb as usize];
            let modifier = if msb == 1 { -magnitude } else { magnitude };
            for c in 0..3 {
                px[c] = (base[second][c] + modifier).clamp(0, 255) as u8;
            }
        }
    }
    out
}

/// Taille en octets du niveau 0, largeur et hauteur arrondies à 8.
pub fn texture_size(fmt: TextureFormat, width: usize, height: usize) -> usize {
    width.div_ceil(8) * height.div_ceil(8) * 64 * fmt.bits_per_pixel() / 8
}

/// Octets d'une texture (niveau 0) -> RGBA8 (`height * width * 4`), ligne 0 = première ligne de la mémoire.
pub fn decode_texture(fmt: TextureFormat, raw: &[u8], width: usize, height: usize) -> Result<Vec<u8>, String> {
    let need = texture_size(fmt, width, height);
    if raw.len() < need {
        return Err(format!(
            "texture {fmt:?} {width}x{height} : {} octets fournis, {need} attendus",
            raw.len()
        ));
    }
    if let Some(color) = fmt.color() {
        let linear = tiled_to_linear(raw, width, height, color.bytes_per_pixel());
        return Ok(decode_pixels(color, &linear));
    }
    use TextureFormat::*;
    let mut out = vec![0u8; height * width * 4];
    match fmt {
        La8 | Hilo8 => {
            let data = tiled_to_linear(raw, width, height, 2);
            for (p, o) in data.chunks_exact(2).zip(out.chunks_exact_mut(4)) {
                let (lo, hi) = (p[1], p[0]);
                o.copy_from_slice(&if fmt == La8 { [lo, lo, lo, hi] } else { [lo, hi, 0, 255] });
            }
        }
        L8 | A8 | La4 => {
            let data = tiled_to_linear(raw, width, height, 1);
            for (&v, o) in data.iter().zip(out.chunks_exact_mut(4)) {
                let rgba = match fmt {
                    L8 => [v, v, v, 255],
                    A8 => [0, 0, 0, v],
                    _ => {
                        let l = expand_bits((v >> 4) as u32, 4);
                        [l, l, l, expand_bits((v & 15) as u32, 4)]
                    }
                };
                o.copy_from_slice(&rgba);
            }
        }
        L4 | A4 => {
            // demi-octets, octet bas d'abord
            let packed = &raw[..width.div_ceil(8) * height.div_ceil(8) * 32];
            let mut nibbles = Vec::with_capacity(packed.len() * 2);
            for &b in packed {
                nibbles.push(b & 15);
                nibbles.push(b >> 4);
            }
            let data = tiled_to_linear(&nibbles, width, height, 1);
            for (&v, o) in data.iter().zip(out.chunks_exact_mut(4)) {
                let e = expand_bits(v as u32, 4);
                o.copy_from_slice(&if fmt == L4 { [e, e, e, 255] } else { [0, 0, 0, e] });
            }
        }
        Etc1 | Etc1a4 => {
            let (tw, th) = (width.div_ceil(8), height.div_ceil(8));
            let size = if fmt == Etc1 { 8 } else { 16 };
            for ty in 0..th {
                for tx in 0..tw {
                    // 4 blocs par tuile dans l'ordre (0,0) (1,0) (0,1) (1,1) : rang bit 0 = x du bloc, bit 1 = y
                    for b in 0..4 {
                        let off = ((ty * tw + tx) * 4 + b) * size;
                        let data = &raw[off..off + size];
                        let (alpha, color) = if fmt == Etc1a4 { (Some(&data[..8]), &data[8..]) } else { (None, data) };
                        let rgb = decode_etc1_block(color);
                        let alpha_word = alpha.map(|a| u64::from_le_bytes(a.try_into().unwrap()));
                        let (bx, by) = (b & 1, b >> 1);
                        for y in 0..4 {
                            let py = ty * 8 + by * 4 + y;
                            if py >= height {
                                break;
                            }
                            for x in 0..4 {
                                let px = tx * 8 + bx * 4 + x;
                                if px >= width {
                                    break;
                                }
                                let a = match alpha_word {
                                    Some(w) => expand_bits(((w >> (4 * (x * 4 + y))) & 15) as u32, 4),
                                    None => 255,
                                };
                                let [r, g, bl] = rgb[y][x];
                                let o = (py * width + px) * 4;
                                out[o..o + 4].copy_from_slice(&[r, g, bl, a]);
                            }
                        }
                    }
                }
            }
        }
        _ => unreachable!(),
    }
    Ok(out)
}

#[cfg(test)]
mod reference;

#[cfg(test)]
mod tests {
    use super::reference::REFERENCES;
    use super::*;

    /// Générateur maison à graine fixe (splitmix64), reproduit à l'identique côté Python.
    fn random_bytes(seed: u64, n: usize) -> Vec<u8> {
        let mut state = seed;
        (0..n)
            .map(|_| {
                state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
                let mut z = state;
                z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
                ((z ^ (z >> 31)) >> 24) as u8
            })
            .collect()
    }

    /// Hachage FNV-1a 64 bits.
    fn fnv1a(data: &[u8]) -> u64 {
        data.iter().fold(0xCBF2_9CE4_8422_2325u64, |h, &b| (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01B3))
    }

    #[test]
    fn tiled_round_trip_non_multiple_of_8() {
        for &(w, h, unit) in &[(13, 10, 1), (8, 8, 3), (17, 5, 4), (1, 1, 2), (9, 25, 2), (64, 16, 1)] {
            let image = random_bytes(7 + w as u64, w * h * unit);
            let tiled = linear_to_tiled(&image, w, h, unit);
            assert_eq!(tiled.len(), w.div_ceil(8) * h.div_ceil(8) * 64 * unit);
            assert_eq!(tiled_to_linear(&tiled, w, h, unit), image, "{w}x{h}x{unit}");
        }
    }

    #[test]
    fn morton_order() {
        // premier point (1,0) en rang 1, (0,1) en rang 2, (7,7) en rang 63
        assert_eq!((MORTON[0][1], MORTON[1][0], MORTON[7][7], MORTON[0][2]), (1, 2, 63, 4));
        let mut seen = [false; 64];
        for row in MORTON {
            for r in row {
                seen[r as usize] = true;
            }
        }
        assert!(seen.iter().all(|&s| s));
    }

    #[test]
    fn color_formats_round_trip() {
        use ColorFormat::*;
        for fmt in [Rgba8, Rgb8, Rgb565, Rgb5a1, Rgba4] {
            let unit = fmt.bytes_per_pixel();
            let data = random_bytes(99, 40 * unit);
            let rgba = decode_pixels(fmt, &data);
            assert_eq!(rgba.len(), 160);
            let mut again = encode_pixels(fmt, &rgba);
            // les bits non utilisés n'existent pas : décoder puis réencoder redonne les mêmes octets
            assert_eq!(again.len(), data.len());
            assert_eq!(decode_pixels(fmt, &again), rgba, "{fmt:?}");
            if matches!(fmt, Rgba8 | Rgb8) {
                assert_eq!(again, data);
            }
            again.clear();
        }
        // arrondis : 31 -> 255, 1 bit -> 0 ou 255
        assert_eq!(decode_pixels(Rgb565, &[0xFF, 0xFF]), [255, 255, 255, 255]);
        assert_eq!(decode_pixels(Rgb5a1, &[0x01, 0x00]), [0, 0, 0, 255]);
        assert_eq!(decode_pixels(Rgba4, &[0x5A, 0x31]), [0x33, 0x11, 0x55, 0xAA]);
        assert_eq!(decode_pixels(Rgba8, &[1, 2, 3, 4]), [4, 3, 2, 1]);
        assert_eq!(encode_pixels(Rgb8, &[1, 2, 3, 4]), [3, 2, 1]);
    }

    #[test]
    fn format_ids() {
        assert_eq!(ColorFormat::from_gx(2), Some(ColorFormat::Rgb565));
        assert_eq!(ColorFormat::from_color_buffer(2), Some(ColorFormat::Rgb5a1));
        assert_eq!(ColorFormat::from_gx(5), None);
        assert_eq!(TextureFormat::from_id(13), Some(TextureFormat::Etc1a4));
        assert_eq!(TextureFormat::from_id(14), None);
    }

    #[test]
    fn short_input_is_an_error() {
        assert!(decode_texture(TextureFormat::Etc1, &[0; 31], 8, 8).is_err());
        assert!(decode_texture(TextureFormat::L4, &[0; 31], 8, 8).is_err());
        assert!(decode_texture(TextureFormat::Etc1, &[0; 32], 8, 8).is_ok());
    }

    /// Chaque format, trois tailles, contre les vecteurs calculés par `banc/pica/formats.py`.
    #[test]
    fn textures_match_python_reference() {
        let mut formats_seen = [false; 14];
        for r in REFERENCES {
            let fmt = TextureFormat::from_id(r.format).unwrap();
            formats_seen[r.format as usize] = true;
            let raw = random_bytes(r.seed, texture_size(fmt, r.width, r.height));
            let out = decode_texture(fmt, &raw, r.width, r.height).unwrap();
            assert_eq!(out.len(), r.width * r.height * 4);
            for &(index, px) in r.pixels {
                assert_eq!(out[index * 4..index * 4 + 4], px, "{fmt:?} {}x{} pixel {index}", r.width, r.height);
            }
            assert_eq!(fnv1a(&out), r.hash, "{fmt:?} {}x{}", r.width, r.height);
        }
        assert!(formats_seen.iter().all(|&s| s));
    }

    #[test]
    #[ignore = "mesure, à lancer en release"]
    fn etc1_speed() {
        let raw = random_bytes(1, texture_size(TextureFormat::Etc1, 1024, 1024));
        let t = std::time::Instant::now();
        let out = decode_texture(TextureFormat::Etc1, &raw, 1024, 1024).unwrap();
        eprintln!("ETC1 1024x1024 : {:?} ({})", t.elapsed(), out.len());
    }
}
