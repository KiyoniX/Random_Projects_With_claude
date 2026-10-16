//! L'état des registres du PICA200 et le décodage des listes de commandes (port de `banc/pica/gpu.py`).
//!
//! Une liste est une suite de paires (donnée, en-tête) : l'en-tête dit quel registre écrire (bits 0-15), quels octets
//! de la donnée comptent (bits 16-19), combien de données suivent (bits 20-30) et si le numéro de registre monte à
//! chaque donnée (bit 31). Les écritures de dessin (registres 0x22E et 0x22F) sont rendues à l'appelant.

use capture::Capture;

pub const REG_COUNT: usize = 0x300;

/// Flottant 24 bits du PICA (1 signe, 7 exposant biaisé de 63, 16 mantisse) -> f32.
pub fn f24_to_f32(raw: u32) -> f32 {
    let raw = raw & 0xFF_FFFF;
    let sign = (raw >> 23) & 1;
    let exponent = (raw >> 16) & 0x7F;
    let mantissa = raw & 0xFFFF;
    let bits = if exponent == 0 {
        sign << 31
    } else if exponent == 0x7F {
        (sign << 31) | (0xFF << 23) | if mantissa != 0 { 1 << 22 } else { 0 }
    } else {
        (sign << 31) | ((exponent + 64) << 23) | (mantissa << 7)
    };
    f32::from_bits(bits)
}

/// Trois mots -> quatre flottants 24 bits (rangés x, y, z, w).
pub fn unpack_f24(w: [u32; 3]) -> [f32; 4] {
    [
        f24_to_f32(w[2] & 0xFF_FFFF),
        f24_to_f32(((w[1] & 0xFFFF) << 8) | (w[2] >> 24)),
        f24_to_f32(((w[0] & 0xFF) << 16) | (w[1] >> 16)),
        f24_to_f32(w[0] >> 8),
    ]
}

fn in_stream(reg: usize, from: usize, to: usize) -> bool {
    (from..to).contains(&reg)
}
fn is_uniform(r: usize) -> bool { in_stream(r, 0x2C1, 0x2C9) }
fn is_code(r: usize) -> bool { in_stream(r, 0x2CC, 0x2D4) }
fn is_swizzle(r: usize) -> bool { in_stream(r, 0x2D6, 0x2DE) }
fn is_fixed(r: usize) -> bool { in_stream(r, 0x233, 0x236) }

pub struct GpuState {
    pub regs: [u32; REG_COUNT],
    pub seen: [bool; REG_COUNT],
    pub code: Vec<u32>,
    pub swizzle: Vec<u32>,
    pub uniforms: Vec<[f32; 4]>,
    pub fixed: [[f32; 4]; 16],
    pub fog: Vec<[f32; 2]>,
    pub luts: Vec<f32>,
    fog_row: u32,
    lut_which: u32,
    lut_row: u32,
    fixed_index: u32,
    fixed_pending: Vec<u32>,
    uniform_index: u32,
    uniform_f32: bool,
    uniform_pending: Vec<u32>,
    code_offset: u32,
    swizzle_offset: u32,
    /// Incrémenté à chaque modification du code ou des descripteurs (pour le cache des programmes).
    pub program_version: u64,
    /// Incrémenté à chaque écriture d'une table d'éclairage (pour le tampon des tables du GPU).
    pub lut_version: u64,
    pub draws_requested: u64,
}

impl GpuState {
    pub fn new() -> GpuState {
        let mut regs = [0u32; REG_COUNT];
        for stage in [0xC0usize, 0xC8, 0xD0, 0xD8, 0xF0, 0xF8] {
            regs[stage] = 0x000F_000F; // « précédent » par défaut
            regs[stage + 3] = 0xFF00_0000;
        }
        regs[0x107] = 0x0F00; // toutes les couleurs écrites
        let mut fixed = [[0.0; 4]; 16];
        for f in fixed.iter_mut() {
            f[3] = 1.0;
        }
        GpuState {
            regs,
            seen: [false; REG_COUNT],
            code: vec![0; 4096],
            swizzle: vec![0; 4096],
            uniforms: vec![[0.0; 4]; 96],
            fixed,
            fog: vec![[0.0; 2]; 128],
            luts: vec![0.0; 24 * 256 * 2],
            fog_row: 0,
            lut_which: 0,
            lut_row: 0,
            fixed_index: 0,
            fixed_pending: Vec::new(),
            uniform_index: 0,
            uniform_f32: false,
            uniform_pending: Vec::new(),
            code_offset: 0,
            swizzle_offset: 0,
            program_version: 0,
            lut_version: 1,
            draws_requested: 0,
        }
    }

    pub fn from_capture(c: &Capture) -> GpuState {
        let mut s = GpuState::new();
        for i in 0..REG_COUNT.min(c.regs.len()) {
            s.regs[i] = c.regs[i];
            s.seen[i] = c.seen.get(i).copied().unwrap_or(0) != 0;
        }
        s.code = c.code.clone();
        s.swizzle = c.swizzle.clone();
        s.uniforms = c.uniforms.clone();
        for (i, f) in c.fixed.iter().enumerate().take(16) {
            s.fixed[i] = *f;
        }
        s.fog = c.fog.clone();
        s.luts = c.luts.clone();
        let p = &c.ports;
        s.code_offset = p.code_offset;
        s.swizzle_offset = p.swizzle_offset;
        s.fixed_index = p.fixed_index;
        s.uniform_index = p.uniform_index;
        s.uniform_f32 = p.uniform_f32;
        s.fog_row = p.fog_row;
        s.lut_which = p.lut_which;
        s.lut_row = p.lut_row;
        s.fixed_pending = p.fixed_pending.clone();
        s.uniform_pending = p.uniform_pending.clone();
        s.program_version = 1;
        s
    }

    pub fn reg(&self, r: usize) -> u32 {
        self.regs[r]
    }

    /// Exécute une liste de commandes ; `draw(état, indexé)` est appelé à chaque ordre de dessin.
    pub fn process_list<F: FnMut(&GpuState, bool)>(&mut self, data: &[u8], mut draw: F) {
        let words: Vec<u32> = data.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
        let count = words.len();
        let mut i = 0usize;
        while i + 1 < count {
            let header = words[i + 1];
            let reg = (header & 0xFFFF) as usize;
            let extra = ((header >> 20) & 0x7FF) as usize;
            let mask = (header >> 16) & 0xF;
            let consecutive = header >> 31 != 0;
            let end = i + 2 + extra;
            let step = 2 + extra + (extra & 1);
            if end > count {
                break; // paquet coupé par la fin de la liste : on s'arrête, comme le banc
            }
            if reg >= REG_COUNT {
                i += step;
                continue;
            }
            if !consecutive && mask == 0xF && extra > 0 && (is_uniform(reg) || is_code(reg) || is_swizzle(reg) || is_fixed(reg)) {
                let mut values = vec![words[i]];
                values.extend_from_slice(&words[i + 2..end]);
                self.stream(reg, &values);
            } else {
                if let Some(ix) = self.write(reg, words[i], mask) {
                    draw(self, ix);
                }
                for k in 0..extra {
                    let Some(&value) = words.get(i + 2 + k) else { break };
                    let target = if consecutive { reg + k + 1 } else { reg };
                    if let Some(ix) = self.write(target, value, mask) {
                        draw(self, ix);
                    }
                }
            }
            i += step;
        }
    }

    /// Écrit un registre ; rend `Some(indexé)` si cela déclenche un dessin.
    pub fn write(&mut self, reg: usize, value: u32, mask: u32) -> Option<bool> {
        if reg >= REG_COUNT {
            return None;
        }
        let mut value = value;
        if mask != 0xF {
            let old = self.regs[reg];
            let mut merged = 0u32;
            for b in 0..4 {
                let src = if mask >> b & 1 != 0 { value } else { old };
                merged |= src & (0xFF << (8 * b));
            }
            value = merged;
        }
        self.regs[reg] = value;
        self.seen[reg] = true;
        if reg < 0x22E {
            if reg == 0xE6 {
                self.fog_row = value & 0x7F;
            } else if (0xE8..=0xEF).contains(&reg) {
                // bits 13-23 la valeur, bits 0-12 la différence signée (lecture du banc, relevée sur la table du jeu)
                let diff = value & 0x1FFF;
                let diff = if diff & 0x1000 != 0 { diff as i32 - 0x2000 } else { diff as i32 };
                self.fog[(self.fog_row & 0x7F) as usize] = [((value >> 13) & 0x7FF) as f32 / 2048.0, diff as f32 / 2048.0];
                self.fog_row += 1;
            } else if reg == 0x1C5 {
                self.lut_row = value & 0xFF;
                self.lut_which = (value >> 8) & 0x1F;
            } else if (0x1C8..=0x1CF).contains(&reg) {
                if self.lut_which < 24 && self.lut_row < 256 {
                    let v = value & 0xFFF;
                    let mut d = ((value >> 12) & 0xFFF) as i32;
                    if d & 0x800 != 0 {
                        d -= 0x1000;
                    }
                    let at = (self.lut_which as usize * 256 + self.lut_row as usize) * 2;
                    self.luts[at] = v as f32 / 4096.0;
                    self.luts[at + 1] = d as f32 / 4096.0;
                    self.lut_version += 1;
                }
                self.lut_row += 1;
            }
            return None;
        }
        if reg == 0x22E || reg == 0x22F {
            self.draws_requested += 1;
            return Some(reg == 0x22F);
        }
        if is_uniform(reg) || is_code(reg) || is_swizzle(reg) || is_fixed(reg) {
            self.stream(reg, &[value]);
        } else if reg == 0x2C0 {
            self.uniform_index = value & 0x7F;
            self.uniform_f32 = value >> 31 != 0;
            self.uniform_pending.clear();
        } else if reg == 0x2CB {
            self.code_offset = value & 0xFFFF;
        } else if reg == 0x2D5 {
            self.swizzle_offset = value & 0xFFFF;
        } else if reg == 0x232 {
            self.fixed_index = value & 0xF;
            self.fixed_pending.clear();
        }
        None
    }

    fn stream(&mut self, reg: usize, words: &[u32]) {
        if is_code(reg) {
            for &w in words {
                self.code[(self.code_offset & 0xFFF) as usize] = w;
                self.code_offset += 1;
            }
            self.program_version += 1;
        } else if is_swizzle(reg) {
            for &w in words {
                self.swizzle[(self.swizzle_offset & 0xFFF) as usize] = w;
                self.swizzle_offset += 1;
            }
            self.program_version += 1;
        } else if is_uniform(reg) {
            self.uniform_pending.extend_from_slice(words);
            let need = if self.uniform_f32 { 4 } else { 3 };
            let groups = self.uniform_pending.len() / need;
            for g in 0..groups {
                let chunk = &self.uniform_pending[g * need..(g + 1) * need];
                let value = if self.uniform_f32 {
                    [f32::from_bits(chunk[3]), f32::from_bits(chunk[2]), f32::from_bits(chunk[1]), f32::from_bits(chunk[0])]
                } else {
                    unpack_f24([chunk[0], chunk[1], chunk[2]])
                };
                let at = self.uniform_index as usize + g;
                if at < 96 {
                    self.uniforms[at] = value;
                }
            }
            self.uniform_pending.drain(..groups * need);
            self.uniform_index += groups as u32;
        } else {
            self.fixed_pending.extend_from_slice(words);
            while self.fixed_pending.len() >= 3 {
                let v = unpack_f24([self.fixed_pending[0], self.fixed_pending[1], self.fixed_pending[2]]);
                self.fixed[(self.fixed_index & 0xF) as usize] = v;
                self.fixed_index += 1;
                self.fixed_pending.drain(..3);
            }
        }
        self.regs[reg] = *words.last().unwrap();
        self.seen[reg] = true;
    }
}

impl Default for GpuState {
    fn default() -> Self {
        GpuState::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(pairs: &[(u32, u32)]) -> Vec<u8> {
        let mut out = Vec::new();
        for (value, header) in pairs {
            out.extend_from_slice(&value.to_le_bytes());
            out.extend_from_slice(&header.to_le_bytes());
        }
        out
    }

    #[test]
    fn f24_known_values() {
        // 1.0 : exposant 63 -> 0x3F, mantisse 0
        assert_eq!(f24_to_f32(0x3F_0000), 1.0);
        assert_eq!(f24_to_f32(0xBF_0000), -1.0);
        assert_eq!(f24_to_f32(0), 0.0);
    }

    #[test]
    fn writes_masks_and_draws() {
        let mut s = GpuState::new();
        let mut draws = Vec::new();
        // registre 0x100 <- 0x12345678, masque 0x3 ; puis deux dessins
        let data = list(&[(0xAABBCCDD, 0x0003_0000 | 0x100), (1, 0x000F_0000 | 0x22E), (1, 0x000F_0000 | 0x22F)]);
        s.process_list(&data, |_, ix| draws.push(ix));
        assert_eq!(s.regs[0x100], 0x0000_CCDD);
        assert_eq!(draws, vec![false, true]);
    }

    #[test]
    fn consecutive_writes() {
        let mut s = GpuState::new();
        // 0x80 puis 0x81, 0x82 en consécutif : un mot + 2 supplémentaires (liste complétée à une longueur paire)
        let mut data = list(&[(10, 0x8000_0000 | (2 << 20) | 0xF0000 | 0x80), (11, 12)]);
        data.truncate(16);
        s.process_list(&data, |_, _| {});
        assert_eq!((s.regs[0x80], s.regs[0x81], s.regs[0x82]), (10, 11, 12));
    }

    #[test]
    fn uniform_stream_f32() {
        let mut s = GpuState::new();
        s.write(0x2C0, (1 << 31) | 5, 0xF);
        let one = 1.0f32.to_bits();
        let two = 2.0f32.to_bits();
        s.stream(0x2C1, &[two, one, 0, 0]);
        assert_eq!(s.uniforms[5], [0.0, 0.0, 1.0, 2.0]);
    }
}
