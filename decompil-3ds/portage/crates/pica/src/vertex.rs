//! Lecture des tampons de sommets et assemblage des triangles (port de `raster.py` : `fetch_indices`, `load_vertices`,
//! `assemble`). Les attributs sont décodés sur le processeur et rangés dans les registres d'entrée du shader.

use crate::memory::{translate, Memory};
use crate::state::GpuState;

pub struct VertexData {
    /// Nombre de registres d'entrée rangés par sommet (le plus haut registre utilisé + 1).
    pub stride: usize,
    /// `sommets uniques * stride` vecteurs, valeur par défaut (0, 0, 0, 1).
    pub inputs: Vec<[f32; 4]>,
    /// Triangles, trois indices de sommet unique chacun.
    pub triangles: Vec<u32>,
    pub notes: Vec<&'static str>,
}

fn fetch_indices(state: &GpuState, memory: &Memory, indexed: bool) -> Vec<u32> {
    let regs = &state.regs;
    let count = regs[0x228] as usize;
    if !indexed {
        let first = regs[0x22A];
        return (first..first + count as u32).collect();
    }
    let base = (regs[0x200] & 0x1FFF_FFFF) << 3;
    let info = regs[0x227];
    let Some(address) = translate(base.wrapping_add(info & 0x0FFF_FFFF)) else { return Vec::new() };
    let wide = info >> 31 != 0;
    let Some(raw) = memory.read(address, count * if wide { 2 } else { 1 }) else { return Vec::new() };
    if wide {
        raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]]) as u32).collect()
    } else {
        raw.iter().map(|&b| b as u32).collect()
    }
}

/// Les triangles d'une suite d'indices, selon le mode : 0 liste, 1 bande, 2 éventail, 3 liste.
pub fn assemble(topology: u32, index: &[u32]) -> Vec<u32> {
    let n = index.len();
    let mut out = Vec::new();
    match topology {
        1 => {
            for i in 0..n.saturating_sub(2) {
                let (a, b, c) = (index[i], index[i + 1], index[i + 2]);
                if i & 1 == 1 {
                    out.extend_from_slice(&[b, a, c]);
                } else {
                    out.extend_from_slice(&[a, b, c]);
                }
            }
        }
        2 => {
            for i in 1..n.saturating_sub(1) {
                out.extend_from_slice(&[index[0], index[i], index[i + 1]]);
            }
        }
        _ => out.extend_from_slice(&index[..n / 3 * 3]),
    }
    out
}

/// Les plages de mémoire qu'un dessin va lire (indices, puis un tampon par attribut) : le moteur y rend d'abord les
/// tampons de rendu qui les recouvrent.
pub fn read_ranges(state: &GpuState, memory: &Memory, indexed: bool) -> Vec<(u32, usize)> {
    let regs = &state.regs;
    let mut out = Vec::new();
    if indexed {
        let base = (regs[0x200] & 0x1FFF_FFFF) << 3;
        if let Some(address) = translate(base.wrapping_add(regs[0x227] & 0x0FFF_FFFF)) {
            out.push((address, regs[0x228] as usize * if regs[0x227] >> 31 != 0 { 2 } else { 1 }));
        }
    }
    let ids = fetch_indices(state, memory, indexed);
    let (Some(&lo), Some(&hi)) = (ids.iter().min(), ids.iter().max()) else { return out };
    let base = (regs[0x200] & 0x1FFF_FFFF) << 3;
    for i in 0..12usize {
        let (offset, w2) = (regs[0x203 + 3 * i], regs[0x205 + 3 * i]);
        let (components, stride) = ((w2 >> 28) as usize, ((w2 >> 16) & 0xFF) as usize);
        if components == 0 || stride == 0 {
            continue;
        }
        if let Some(address) = translate(base.wrapping_add(offset).wrapping_add(lo.wrapping_mul(stride as u32))) {
            out.push((address, (hi - lo + 1) as usize * stride));
        }
    }
    out
}

pub fn load(state: &GpuState, memory: &Memory, indexed: bool) -> Option<VertexData> {
    let regs = &state.regs;
    let ids = fetch_indices(state, memory, indexed);
    if ids.is_empty() {
        return None;
    }
    let mut unique: Vec<u32> = ids.clone();
    unique.sort_unstable();
    unique.dedup();
    let n = unique.len();
    let (lo, hi) = (unique[0], *unique.last().unwrap());
    let base = (regs[0x200] & 0x1FFF_FFFF) << 3;
    let (fmt_low, fmt_high) = (regs[0x201], regs[0x202]);
    let count = ((fmt_high >> 28) + 1) as usize;
    let fixed_mask = (fmt_high >> 16) & 0xFFF;
    let mut kinds = [(0u32, 0usize); 12];
    for (a, slot) in kinds.iter_mut().enumerate() {
        let nib = if a < 8 { (fmt_low >> (4 * a)) & 15 } else { (fmt_high >> (4 * (a - 8))) & 15 };
        *slot = (nib & 3, ((nib >> 2) + 1) as usize);
    }
    let mut notes = Vec::new();
    // valeurs décodées par attribut (n, 4)
    let mut values: [Option<Vec<[f32; 4]>>; 12] = Default::default();
    for i in 0..12usize {
        let (offset, w1, w2) = (regs[0x203 + 3 * i], regs[0x204 + 3 * i], regs[0x205 + 3 * i]);
        let components = (w2 >> 28) as usize;
        let stride = ((w2 >> 16) & 0xFF) as usize;
        if components == 0 || stride == 0 {
            continue;
        }
        let ids_c: Vec<u32> = (0..8).map(|k| (w1 >> (4 * k)) & 15).chain((0..4).map(|k| (w2 >> (4 * k)) & 15)).collect();
        let Some(address) = translate(base.wrapping_add(offset).wrapping_add(lo.wrapping_mul(stride as u32))) else {
            notes.push("tampon de sommets hors mémoire");
            continue;
        };
        let Some(raw) = memory.read(address, (hi - lo + 1) as usize * stride) else {
            notes.push("tampon de sommets illisible");
            continue;
        };
        let mut position = 0usize;
        for &comp in ids_c.iter().take(components) {
            if comp >= 12 {
                position += 4 * (comp as usize - 11);
                continue;
            }
            let (kind, size) = kinds[comp as usize];
            let width = [1usize, 1, 2, 4][kind as usize];
            position = position.div_ceil(width) * width;
            let span = width * size;
            if position + span > stride {
                break;
            }
            let mut out = vec![[0.0, 0.0, 0.0, 1.0]; n];
            for (k, &id) in unique.iter().enumerate() {
                let row = (id - lo) as usize * stride + position;
                for c in 0..size {
                    let at = row + c * width;
                    out[k][c] = match kind {
                        0 => raw[at] as i8 as f32,
                        1 => raw[at] as f32,
                        2 => i16::from_le_bytes([raw[at], raw[at + 1]]) as f32,
                        _ => f32::from_le_bytes([raw[at], raw[at + 1], raw[at + 2], raw[at + 3]]),
                    };
                }
            }
            values[comp as usize] = Some(out);
            position += span;
        }
    }
    for a in 0..12usize {
        if fixed_mask >> a & 1 != 0 {
            values[a] = Some(vec![state.fixed[a]; n]);
        }
    }
    let permutation = regs[0x2BB] as u64 | ((regs[0x2BC] as u64) << 32);
    let mut stride = 1usize;
    let mut placed = Vec::new();
    for a in 0..count.min(12) {
        let register = ((permutation >> (4 * a)) & 15) as usize;
        if values[a].is_some() {
            stride = stride.max(register + 1);
            placed.push((a, register));
        }
    }
    let mut inputs = vec![[0.0, 0.0, 0.0, 1.0]; n * stride];
    for (a, register) in placed {
        let v = values[a].as_ref().unwrap();
        for k in 0..n {
            inputs[k * stride + register] = v[k];
        }
    }
    let topology = (regs[0x25E] >> 8) & 3;
    let inverse: Vec<u32> = ids.iter().map(|id| unique.binary_search(id).unwrap() as u32).collect();
    let triangles = assemble(topology, &inverse);
    Some(VertexData { stride, inputs, triangles, notes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assemble_modes() {
        let idx = [0, 1, 2, 3, 4];
        assert_eq!(assemble(0, &idx), vec![0, 1, 2]);
        assert_eq!(assemble(1, &idx), vec![0, 1, 2, 2, 1, 3, 2, 3, 4]);
        assert_eq!(assemble(2, &idx), vec![0, 1, 2, 0, 2, 3, 0, 3, 4]);
        assert!(assemble(1, &[0, 1]).is_empty());
    }
}
