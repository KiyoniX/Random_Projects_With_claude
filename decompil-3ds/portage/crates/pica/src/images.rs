//! Écrire et comparer les images des écrans (PNG du rejeu, du runtime, du banc).

use std::path::Path;

pub fn save_png(path: &Path, width: usize, height: usize, rgba: &[u8]) -> Result<(), String> {
    image::save_buffer(path, rgba, width as u32, height as u32, image::ColorType::Rgba8).map_err(|e| e.to_string())
}

/// Les chiffres d'une comparaison entre deux images RGB de même taille.
pub struct Diff {
    pub mean_abs: f64,
    pub differing: f64,
    pub big: f64,
    pub max: u8,
    pub image: Vec<u8>,
}

pub fn diff(a_rgba: &[u8], b_rgb: &[u8], b_channels: usize, w: usize, h: usize) -> Diff {
    let mut sum = 0u64;
    let (mut differing, mut big, mut max) = (0usize, 0usize, 0u8);
    let mut image = vec![255u8; w * h * 4];
    for p in 0..w * h {
        let mut worst = 0u8;
        for c in 0..3 {
            let d = a_rgba[p * 4 + c].abs_diff(b_rgb[p * b_channels + c]);
            sum += d as u64;
            worst = worst.max(d);
        }
        if worst > 0 {
            differing += 1;
        }
        if worst > 8 {
            big += 1;
        }
        max = max.max(worst);
        let v = 255 - worst.saturating_mul(8).min(255);
        image[p * 4..p * 4 + 3].copy_from_slice(&[255, v, v]);
        if worst == 0 {
            image[p * 4..p * 4 + 3].copy_from_slice(&[255, 255, 255]);
        }
    }
    let n = (w * h) as f64;
    Diff { mean_abs: sum as f64 / (3.0 * n), differing: 100.0 * differing as f64 / n, big: 100.0 * big as f64 / n, max, image }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_counts() {
        let a = [10u8, 10, 10, 255, 0, 0, 0, 255];
        let b = [10u8, 10, 10, 0, 0, 30];
        let d = diff(&a, &b, 3, 2, 1);
        assert_eq!(d.max, 30);
        assert!((d.differing - 50.0).abs() < 1e-9);
        assert!((d.big - 50.0).abs() < 1e-9);
        assert!((d.mean_abs - 5.0).abs() < 1e-9);
    }
}
