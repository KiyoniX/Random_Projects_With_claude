//! Les commandes de la file de gsp qui touchent la mémoire : remplissage, transfert vers l'écran, copie de texture
//! (port de `banc/pica/transfer.py` et de `run_command` de `replay.py`).

use formats::{decode_pixels, encode_pixels, linear_to_tiled, tiled_to_linear, ColorFormat};

use crate::memory::Memory;

/// Ce que dit pica quand sa propre mémoire manque (le noyau, lui, donne l'adresse : voir [`check`]).
pub(crate) const OUTSIDE: &str = "hors de la mémoire du GPU";

/// Les formats du transfert vers l'écran et les octets qu'il lit et écrit vraiment (ceux de `banc/pica/transfer.py`) :
/// (entrée, sortie, octets lus, octets écrits).
fn display_sizes(in_dim: u32, out_dim: u32, flags: u32) -> Result<(ColorFormat, ColorFormat, usize, usize), String> {
    let (in_w, in_h) = ((in_dim & 0xFFFF) as usize, (in_dim >> 16) as usize);
    let (out_w, out_h) = ((out_dim & 0xFFFF) as usize, (out_dim >> 16) as usize);
    let in_fmt = ColorFormat::from_gx((flags >> 8) & 7);
    let out_fmt = ColorFormat::from_gx((flags >> 12) & 7);
    let (Some(in_fmt), Some(out_fmt)) = (in_fmt, out_fmt) else { return Err("dimensions ou format illisibles".into()) };
    if in_w == 0 || in_h == 0 || out_w == 0 || out_h == 0 {
        return Err("dimensions ou format illisibles".into());
    }
    let unit = out_fmt.bytes_per_pixel();
    if (flags >> 3) & 1 != 0 {
        return Ok((in_fmt, out_fmt, out_w * out_h * unit, out_w * out_h * unit));
    }
    let scaling = (flags >> 24) & 3;
    let (w, h) = (if scaling != 0 { in_w / 2 } else { in_w }, if scaling == 2 { in_h / 2 } else { in_h });
    let (cw, ch) = (out_w.min(w), out_h.min(h));
    let written = if (flags >> 1) & 1 != 0 { cw.div_ceil(8) * ch.div_ceil(8) * 64 * unit } else { cw * ch * unit };
    Ok((in_fmt, out_fmt, in_w.div_ceil(8) * in_h.div_ceil(8) * 64 * in_fmt.bytes_per_pixel(), written))
}

/// Ce que peut lire et écrire une commande : `access(adresse, longueur, écriture)` rend `Err(texte)` pour une plage
/// refusée (en direct : la mémoire que le noyau a projetée, avec le texte de son exception).
pub type Access<'a> = dyn Fn(u32, usize, bool) -> Result<(), String> + 'a;

/// Le refus que noterait le banc pour une commande 3 ou 4, avant de rien faire : le problème du transfert vers l'écran
/// (textes de `banc/pica/transfer.py`, « refusé (…) » de gsp pour la copie brute), l'exception de la copie de texture
/// (gsp y ajoute « copie de texture refusée »). Le banc écrit ce qui précède la plage refusée ; ici, rien.
pub fn check(words: &[u32; 8], access: &Access) -> Result<(), String> {
    match words[0] & 0xFF {
        3 => {
            let (source, destination, flags) = (words[1], words[2], words[5]);
            let (_, _, read, written) = display_sizes(words[3], words[4], flags)?;
            if (flags >> 3) & 1 != 0 {
                access(source, read, false).and_then(|()| access(destination, written, true)).map_err(|e| format!("refusé ({e})"))
            } else {
                access(source, read, false).map_err(|e| format!("source illisible ({e})"))?;
                access(destination, written, true).map_err(|e| format!("destination refusée ({e})"))
            }
        }
        4 => copy_chunks(words[1], words[2], words[3], words[4], words[5], |source, destination, len| {
            access(source, len, false).and_then(|()| access(destination, len, true))
        }),
        _ => Ok(()),
    }
}

/// Commande 3 : l'image rendue (en tuiles) devient une image affichable (en lignes).
///
/// Dimensions : largeur dans les 16 bits bas, hauteur dans les 16 bits hauts. Drapeaux : bit 0 retourner de haut en bas,
/// bit 1 sortie en tuiles, bit 3 copie brute, bits 8-10 format d'entrée, bits 12-14 format de sortie, bits 24-25
/// réduction (1 en largeur, 2 dans les deux sens). Quand la sortie est plus petite, on prend le coin haut-gauche.
pub fn display_transfer(memory: &mut Memory, source: u32, destination: u32, in_dim: u32, out_dim: u32, flags: u32) -> Result<(), String> {
    let (in_w, in_h) = ((in_dim & 0xFFFF) as usize, (in_dim >> 16) as usize);
    let (out_w, out_h) = ((out_dim & 0xFFFF) as usize, (out_dim >> 16) as usize);
    let flip = flags & 1 != 0;
    let out_tiled = (flags >> 1) & 1 != 0;
    let scaling = (flags >> 24) & 3;
    let (in_fmt, out_fmt, read, _) = display_sizes(in_dim, out_dim, flags)?;
    if (flags >> 3) & 1 != 0 {
        let data = memory.read(source, read).ok_or(format!("refusé ({OUTSIDE})"))?.into_owned();
        return if memory.write(destination, &data) { Ok(()) } else { Err(format!("refusé ({OUTSIDE})")) };
    }
    let unit = in_fmt.bytes_per_pixel();
    let raw = memory.read(source, read).ok_or(format!("source illisible ({OUTSIDE})"))?.into_owned();
    let rgba = decode_pixels(in_fmt, &tiled_to_linear(&raw, in_w, in_h, unit));
    let (image, w, h) = reduce(&rgba, in_w, in_h, scaling);
    let image = crop(&image, w, h, out_w, out_h);
    let (cw, ch) = (out_w.min(w), out_h.min(h));
    let image = if flip { flip_rows(&image, cw, ch) } else { image };
    let encoded = encode_pixels(out_fmt, &image);
    let data = if out_tiled { linear_to_tiled(&encoded, cw, ch, out_fmt.bytes_per_pixel()) } else { encoded };
    if memory.write(destination, &data) { Ok(()) } else { Err(format!("destination refusée ({OUTSIDE})")) }
}

/// La réduction du transfert : 1 moyenne deux points voisins en largeur, 2 aussi en hauteur (arrondi vers le haut).
pub fn reduce(rgba: &[u8], w: usize, h: usize, scaling: u32) -> (Vec<u8>, usize, usize) {
    if scaling == 0 {
        return (rgba.to_vec(), w, h);
    }
    let nw = w / 2;
    let mut wide = vec![0u8; nw * h * 4];
    for y in 0..h {
        for x in 0..nw {
            for c in 0..4 {
                let a = rgba[(y * w + 2 * x) * 4 + c] as u16;
                let b = rgba[(y * w + 2 * x + 1) * 4 + c] as u16;
                wide[(y * nw + x) * 4 + c] = ((a + b + 1) >> 1) as u8;
            }
        }
    }
    if scaling != 2 {
        return (wide, nw, h);
    }
    let nh = h / 2;
    let mut tall = vec![0u8; nw * nh * 4];
    for y in 0..nh {
        for x in 0..nw {
            for c in 0..4 {
                let a = wide[((2 * y) * nw + x) * 4 + c] as u16;
                let b = wide[((2 * y + 1) * nw + x) * 4 + c] as u16;
                tall[(y * nw + x) * 4 + c] = ((a + b + 1) >> 1) as u8;
            }
        }
    }
    (tall, nw, nh)
}

/// Le coin haut-gauche `out_w x out_h` d'une image (plus petite si elle l'est).
pub fn crop(rgba: &[u8], w: usize, h: usize, out_w: usize, out_h: usize) -> Vec<u8> {
    let (cw, ch) = (out_w.min(w), out_h.min(h));
    let mut out = Vec::with_capacity(cw * ch * 4);
    for y in 0..ch {
        out.extend_from_slice(&rgba[y * w * 4..(y * w + cw) * 4]);
    }
    out
}

pub fn flip_rows(rgba: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len());
    for y in (0..h).rev() {
        out.extend_from_slice(&rgba[y * w * 4..(y + 1) * w * 4]);
    }
    out
}

/// L'image d'un écran de la console : la mémoire range 400 (ou 320) colonnes de 240 points ; `rows` x `cols` est la
/// forme de ce tableau (rows = nombre de colonnes de l'écran). Rend (largeur, hauteur, RGBA) de l'écran à l'endroit.
pub fn rotate_screen(rgba: &[u8], rows: usize, cols: usize) -> (usize, usize, Vec<u8>) {
    let (width, height) = (rows, cols);
    let mut out = vec![255u8; width * height * 4];
    for y in 0..height {
        for x in 0..width {
            let src = (x * cols + (cols - 1 - y)) * 4;
            let dst = (y * width + x) * 4;
            out[dst..dst + 3].copy_from_slice(&rgba[src..src + 3]);
        }
    }
    (width, height, out)
}

/// Agrandit une image RGBA d'un facteur entier, sans lissage.
pub fn upscale_nearest(rgba: &[u8], w: usize, h: usize, s: usize) -> (usize, usize, Vec<u8>) {
    let mut out = vec![0u8; w * s * h * s * 4];
    for y in 0..h * s {
        for x in 0..w * s {
            let src = ((y / s) * w + x / s) * 4;
            let dst = (y * w * s + x) * 4;
            out[dst..dst + 4].copy_from_slice(&rgba[src..src + 4]);
        }
    }
    (w * s, h * s, out)
}

/// L'image d'un écran lue en mémoire : `rows` colonnes de l'écran de `cols` points au format `fmt`, l'une tous les
/// `stride` octets (au moins `cols` points), agrandie sans lissage à l'échelle `scale`. Rend (largeur, hauteur, RGBA).
pub fn screen_from_memory(raw: &[u8], fmt: ColorFormat, rows: usize, cols: usize, stride: usize, scale: usize) -> (usize, usize, Vec<u8>) {
    let column = cols * fmt.bytes_per_pixel();
    let packed: Vec<u8> = raw.chunks(stride).take(rows).flat_map(|c| &c[..column]).copied().collect();
    let (width, height, rgba) = rotate_screen(&decode_pixels(fmt, &packed), rows, cols);
    if scale > 1 { upscale_nearest(&rgba, width, height, scale) } else { (width, height, rgba) }
}

/// Les plages de mémoire que touche le transfert vers l'écran : (lue, écrite), en surestimant l'écrite.
pub fn display_ranges(source: u32, destination: u32, in_dim: u32, out_dim: u32, flags: u32) -> ((u32, usize), (u32, usize)) {
    let (in_w, in_h) = ((in_dim & 0xFFFF) as usize, (in_dim >> 16) as usize);
    let (out_w, out_h) = ((out_dim & 0xFFFF) as usize, (out_dim >> 16) as usize);
    let in_unit = ColorFormat::from_gx((flags >> 8) & 7).map(|f| f.bytes_per_pixel()).unwrap_or(4);
    let out_unit = ColorFormat::from_gx((flags >> 12) & 7).map(|f| f.bytes_per_pixel()).unwrap_or(4);
    let written = out_w.div_ceil(8) * 8 * out_h.div_ceil(8) * 8 * out_unit;
    if (flags >> 3) & 1 != 0 {
        return ((source, out_w * out_h * out_unit), (destination, out_w * out_h * out_unit));
    }
    ((source, in_w.div_ceil(8) * in_h.div_ceil(8) * 64 * in_unit), (destination, written))
}

/// Plus grand remplissage accepté, comme gsp : au-delà, la commande est refusée (une fin avant le début aussi).
const MAX_FILL: u32 = 0x2000_0000;

/// Les zones (début, longueur, valeur, contrôle) de la commande 2 qui sont vraiment remplies.
fn fill_zones(words: &[u32; 8]) -> impl Iterator<Item = (u32, usize, u32, u32)> {
    [(words[1], words[2], words[3], words[7] & 0xFFFF), (words[4], words[5], words[6], words[7] >> 16)]
        .into_iter()
        .filter(|&(start, _, end, _)| start != 0 && end > start && end - start <= MAX_FILL)
        .map(|(start, value, end, control)| (start, (end - start) as usize, value, control))
}

/// Les plages (début, longueur) que remplit la commande 2.
pub fn fill_ranges(words: &[u32; 8]) -> Vec<(u32, usize)> {
    fill_zones(words).map(|(start, size, _, _)| (start, size)).collect()
}

/// La plage (lue ou écrite, la même pour les deux, en surestimant) que parcourt la commande 4 pour `size` octets utiles.
pub fn copy_span(size: u32, dim: u32) -> usize {
    let (line, skip) = ((dim & 0xFFFF) as usize * 16, (dim >> 16) as usize * 16);
    if line == 0 {
        return size as usize;
    }
    size as usize + (size as usize / line + 1) * skip
}

/// Commande 2 : remplissages de mémoire.
pub fn memory_fill(memory: &mut Memory, words: &[u32; 8]) {
    for (start, size, value, control) in fill_zones(words) {
        let width = ((control >> 8) & 3).min(2) as usize;
        let pattern = &value.to_le_bytes()[..[2usize, 3, 4][width]];
        // le motif répété : on le recopie par doublement (bien plus vite qu'un octet à la fois)
        let mut data: Vec<u8> = Vec::with_capacity(size + 4);
        data.extend_from_slice(pattern);
        while data.len() < size {
            let n = data.len().min(size - data.len());
            data.extend_from_within(..n);
        }
        data.truncate(size);
        memory.write(start, &data);
    }
}

/// Les morceaux (source, destination, longueur) de la commande 4, dans l'ordre : `size` octets d'un coup, ou par lignes
/// si les largeurs sont données (paquets de 16 octets, un intervalle sauté après chaque ligne). S'arrête au premier
/// morceau que `step` refuse.
fn copy_chunks(source: u32, destination: u32, size: u32, in_dim: u32, out_dim: u32,
               mut step: impl FnMut(u32, u32, usize) -> Result<(), String>) -> Result<(), String> {
    let (in_line, in_skip) = ((in_dim & 0xFFFF) as usize * 16, (in_dim >> 16) as usize * 16);
    let (out_line, out_skip) = ((out_dim & 0xFFFF) as usize * 16, (out_dim >> 16) as usize * 16);
    if in_line == 0 || out_line == 0 {
        return step(source, destination, size as usize);
    }
    let (mut source, mut destination) = (source as usize, destination as usize);
    let (mut left_in, mut left_out) = (in_line, out_line);
    let mut remaining = size as usize;
    while remaining > 0 {
        let chunk = left_in.min(left_out).min(remaining);
        step(source as u32, destination as u32, chunk)?;
        source += chunk;
        destination += chunk;
        remaining -= chunk;
        left_in -= chunk;
        left_out -= chunk;
        if left_in == 0 {
            source += in_skip;
            left_in = in_line;
        }
        if left_out == 0 {
            destination += out_skip;
            left_out = out_line;
        }
    }
    Ok(())
}

/// Commande 4 : copie d'octets, par lignes si les largeurs sont données (paquets de 16 octets).
pub fn texture_copy(memory: &mut Memory, source: u32, destination: u32, size: u32, in_dim: u32, out_dim: u32) -> Result<(), String> {
    copy_chunks(source, destination, size, in_dim, out_dim, |source, destination, len| {
        let data = memory.read(source, len).ok_or(OUTSIDE)?.into_owned();
        if memory.write(destination, &data) { Ok(()) } else { Err(OUTSIDE.into()) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotate_screen_orientation() {
        // 2 colonnes de 3 points : dec[col][row] ; le point (colonne 0, rang 2) arrive en haut à gauche
        let mut img = vec![0u8; 2 * 3 * 4];
        img[(0 * 3 + 2) * 4] = 77;
        let (w, h, out) = rotate_screen(&img, 2, 3);
        assert_eq!((w, h), (2, 3));
        assert_eq!(out[0], 77);
    }

    #[test]
    fn transfer_linear_copy_and_flip() {
        let mut m = Memory::default();
        m.map(0x1400_0000, &vec![0u8; 0x4000]);
        m.map(0x1400_8000, &vec![0u8; 0x4000]);
        // 8x8 RGBA8 en tuiles : on met un point rouge opaque en (0, 0) (octets A B G R, rang de Morton 0)
        m.write(0x1400_0000, &[255, 0, 0, 255]);
        // sortie RGB8, linéaire, 8x8, sans retournement puis avec
        display_transfer(&mut m, 0x1400_0000, 0x1400_8000, 0x0008_0008, 0x0008_0008, 0x1000).unwrap();
        assert_eq!(&*m.read(0x1400_8000, 3).unwrap(), &[0, 0, 255]); // B G R
        display_transfer(&mut m, 0x1400_0000, 0x1400_8000, 0x0008_0008, 0x0008_0008, 0x1001).unwrap();
        assert_eq!(&*m.read(0x1400_8000 + 7 * 8 * 3, 3).unwrap(), &[0, 0, 255]);
    }

    #[test]
    fn fill_and_copy() {
        let mut m = Memory::default();
        m.map(0x1400_0000, &vec![0u8; 0x1000]);
        memory_fill(&mut m, &[2, 0x1400_0000, 0x1122_3344, 0x1400_0008, 0, 0, 0, 0x0200]);
        assert_eq!(&*m.read(0x1400_0000, 8).unwrap(), &[0x44, 0x33, 0x22, 0x11, 0x44, 0x33, 0x22, 0x11]);
        texture_copy(&mut m, 0x1400_0000, 0x1400_0100, 8, 0, 0).unwrap();
        assert_eq!(texture_copy(&mut m, 0x1400_0000, 0x1400_0ff8, 0x10, 0, 0), Err(OUTSIDE.to_string()));
        assert_eq!(&*m.read(0x1400_0100, 4).unwrap(), &[0x44, 0x33, 0x22, 0x11]);
    }

    #[test]
    fn bad_fills_are_refused() {
        // fin avant le début (sinon ~4 Go à remplir), fin égale au début, taille au-delà de 0x20000000
        for words in [[2, 0x1400_0010, 0xFF, 0x1400_0000, 0, 0, 0, 0x200],
                      [2, 0x1400_0010, 0xFF, 0x1400_0010, 0, 0, 0, 0x200],
                      [2, 0x1400_0000, 0xFF, 0x3400_0001, 0, 0, 0, 0x200]] {
            assert!(fill_ranges(&words).is_empty());
        }
        let mut m = Memory::default();
        m.map(0x1400_0000, &vec![0u8; 0x1000]);
        memory_fill(&mut m, &[2, 0x1400_0010, 0xFF, 0x1400_0000, 0x1400_0020, 0xFF, 0x1400_0022, 0x200 << 16]);
        assert_eq!(&*m.read(0x1400_0000, 0x24).unwrap(), &[[0; 0x20].as_slice(), &[0xFF, 0, 0, 0]].concat()[..]);
        assert_eq!(fill_ranges(&[2, 0x1400_0010, 0xFF, 0x1400_0000, 0x1400_0020, 0xFF, 0x1400_0022, 0]), vec![(0x1400_0020, 2)]);
    }
}
