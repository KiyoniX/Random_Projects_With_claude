//! Le shader de fragments : les six étages du combinateur TEV, l'échantillonnage des textures, le brouillard et le test
//! alpha, produits en WGSL selon l'état des registres (port de `run_combiner` et `shade_and_merge` de `raster.py`).
//!
//! Ce qui est figé dans le texte (donc dans la clé du cache) : les sources, opérandes, opérations et échelles des étages
//! utilisés, les drapeaux de mise à jour du tampon, le brouillard, le choix des coordonnées de texture. Les couleurs
//! constantes, les modes de bord des textures et le test alpha sont lus dans le bloc `Draw`.
//! L'éclairage par fragment (`lighting.py`) est décodé dans le shader à partir des registres 0x140-0x1FF.

use std::fmt::Write;

use crate::shader::PRELUDE;
use crate::state::GpuState;

pub const STAGE_BASES: [usize; 6] = [0xC0, 0xC8, 0xD0, 0xD8, 0xF0, 0xF8];

pub fn stage_is_default(regs: &[u32], base: usize) -> bool {
    regs[base] == 0x000F_000F && regs[base + 1] == 0 && regs[base + 2] == 0 && regs[base + 4] == 0
}

/// Ce que l'éclairage lit dans les textures : (carte de normales, unité), (ombre, unité), d'après 0x1C3.
fn lighting_texture_reads(state: &GpuState) -> [(bool, u32); 2] {
    let c0 = state.regs[0x1C3];
    [((c0 >> 28) & 3 != 0, (c0 >> 22) & 3), (c0 & 1 != 0, (c0 >> 24) & 3)]
}

/// Les unités de texture lues par les étages utilisés et par l'éclairage (0 à 2).
pub fn used_texture_units(state: &GpuState) -> [bool; 3] {
    let regs = &state.regs;
    let mut used = [false; 3];
    if crate::lighting_on(state) {
        for (active, unit) in lighting_texture_reads(state) {
            if active && unit < 3 {
                used[unit as usize] = true;
            }
        }
    }
    for &base in &STAGE_BASES {
        if stage_is_default(regs, base) {
            continue;
        }
        let w0 = regs[base];
        for i in 0..3 {
            for code in [(w0 >> (4 * i)) & 15, (w0 >> (16 + 4 * i)) & 15] {
                if (3..=5).contains(&code) {
                    used[code as usize - 3] = true;
                }
            }
        }
    }
    used
}

fn color_operand(src: &str, modifier: u32) -> String {
    let (channel, invert) = match modifier {
        0 => (None, false),
        1 => (None, true),
        2 => (Some('w'), false),
        3 => (Some('w'), true),
        4 => (Some('x'), false),
        5 => (Some('x'), true),
        8 => (Some('y'), false),
        9 => (Some('y'), true),
        12 => (Some('z'), false),
        13 => (Some('z'), true),
        _ => (None, false),
    };
    let value = match channel {
        None => format!("{src}.xyz"),
        Some(c) => format!("vec3<f32>({src}.{c})"),
    };
    if invert { format!("(vec3<f32>(1.0) - {value})") } else { value }
}

fn alpha_operand(src: &str, modifier: u32) -> String {
    let (channel, invert) = match modifier {
        0 => ('w', false),
        1 => ('w', true),
        2 => ('x', false),
        3 => ('x', true),
        4 => ('y', false),
        5 => ('y', true),
        6 => ('z', false),
        7 => ('z', true),
        _ => ('w', false),
    };
    if invert { format!("(1.0 - {src}.{channel})") } else { format!("{src}.{channel}") }
}

fn combine_rgb(op: u32, s: [&str; 3]) -> String {
    let (a, b, c) = (s[0], s[1], s[2]);
    match op {
        0 => a.to_string(),
        1 => format!("({a} * {b})"),
        2 => format!("({a} + {b})"),
        3 => format!("({a} + {b} - vec3<f32>(0.5))"),
        4 => format!("({a} * {c} + {b} * (vec3<f32>(1.0) - {c}))"),
        5 => format!("({a} - {b})"),
        6 | 7 => format!("vec3<f32>(4.0 * dot({a} - vec3<f32>(0.5), {b} - vec3<f32>(0.5)))"),
        8 => format!("({a} * {b} + {c})"),
        9 => format!("(min({a} + {b}, vec3<f32>(1.0)) * {c})"),
        _ => a.to_string(),
    }
}

fn combine_alpha(op: u32, s: [&str; 3]) -> String {
    let (a, b, c) = (s[0], s[1], s[2]);
    match op {
        0 | 6 | 7 => a.to_string(), // le point dot3 n'existe pas pour l'alpha : le banc prend l'opérande 0
        1 => format!("({a} * {b})"),
        2 => format!("({a} + {b})"),
        3 => format!("({a} + {b} - 0.5)"),
        4 => format!("({a} * {c} + {b} * (1.0 - {c}))"),
        5 => format!("({a} - {b})"),
        8 => format!("({a} * {b} + {c})"),
        9 => format!("(min({a} + {b}, 1.0) * {c})"),
        _ => a.to_string(),
    }
}

/// La clé du cache des shaders de fragments : exactement ce que lit [`generate`] (les étages, les unités de texture
/// actives, la texture projetée, la mise à jour du tampon et le brouillard, l'éclairage), sans fabriquer le texte.
pub fn cache_key(state: &GpuState, logic: bool, depth_out: bool) -> [u32; 30] {
    let regs = &state.regs;
    let mut key = [0u32; 30];
    key[0] = regs[0x80] & 0x7;
    key[1] = (regs[0x80] >> 13) & 1;
    key[2] = (regs[0x83] >> 28) & 7;
    key[3] = regs[0xE0];
    for (k, &base) in STAGE_BASES.iter().enumerate() {
        let at = 4 + 4 * k;
        if stage_is_default(regs, base) {
            continue; // un étage par défaut ne change pas le texte
        }
        key[at] = regs[base];
        key[at + 1] = regs[base + 1];
        key[at + 2] = regs[base + 2];
        key[at + 3] = regs[base + 4];
    }
    key[28] = crate::lighting_on(state) as u32 | (logic as u32) << 1 | (depth_out as u32) << 2;
    // ces lectures décident quelles textures le texte échantillonne
    for (i, (active, unit)) in lighting_texture_reads(state).into_iter().enumerate() {
        key[28] |= (active as u32 | unit << 1) << (3 + 3 * i);
    }
    key
}

/// Texte WGSL du shader de fragments (point d'entrée `fs_main`).
/// `logic` : le dessin applique une opération logique (le shader lit alors le tampon de couleur d'avant).
pub fn generate(state: &GpuState, logic: bool, depth_out: bool) -> String {
    let regs = &state.regs;
    let mut s = String::new();
    s.push_str(PRELUDE);
    s.push_str(
        r#"
@group(0) @binding(2) var tex0: texture_2d<f32>;
@group(0) @binding(3) var tex1: texture_2d<f32>;
@group(0) @binding(4) var tex2: texture_2d<f32>;
@group(0) @binding(5) var dst_tex: texture_2d<f32>;           // le tampon de couleur avant le dessin (opérations logiques)
@group(0) @binding(6) var<storage, read> luts: array<vec2<f32>>;   // 24 tables x 256 lignes (valeur, différence)

struct FsOut {
    @location(0) color: vec4<f32>,
    //DEPTH//
}

struct FsIn {
    @builtin(position) pos: vec4<f32>,
    @location(0) a0: vec4<f32>,
    @location(1) a1: vec4<f32>,
    @location(2) a2: vec4<f32>,
    @location(3) a3: vec4<f32>,
    @location(4) a4: vec4<f32>,
    @location(5) @interpolate(linear) zd: f32,
}

fn wrap_index(i: i32, size: i32, mode: u32) -> vec2<i32> {
    // x : indice, y : 1 si le point est valide (hors bordure)
    // 4, 5 et 6 redisent 0, 1 et 2 ; 7 répète
    var m = mode & 3u;
    if mode == 7u { m = 2u; }
    if m == 0u {
        return vec2<i32>(clamp(i, 0, size - 1), 1);
    }
    if m == 1u {
        let ok = select(0, 1, i >= 0 && i < size);
        return vec2<i32>(clamp(i, 0, size - 1), ok);
    }
    if m == 2u {
        return vec2<i32>(((i % size) + size) % size, 1);
    }
    let md = ((i % (2 * size)) + 2 * size) % (2 * size);
    return vec2<i32>(select(md, 2 * size - 1 - md, md >= size), 1);
}

fn fetch_texel(unit: u32, ix: vec2<i32>, iy: vec2<i32>, level: i32) -> vec4<f32> {
    var texel: vec4<f32>;
    let p = vec2<i32>(ix.x, iy.x);
    if unit == 0u { texel = textureLoad(tex0, p, level); }
    else if unit == 1u { texel = textureLoad(tex1, p, level); }
    else { texel = textureLoad(tex2, p, level); }
    if ix.y == 0 || iy.y == 0 { texel = u.tex_border[unit]; }
    return texel;
}

// Le niveau voulu d'après la réduction à l'écran : `getLod` d'Azahar, en points de la texture stockée (log2 de 0 : -inf, écrêté ensuite).
fn texture_lod(unit: u32, uv: vec2<f32>) -> f32 {
    let size = u.tex_dim[unit].xy;
    let dx = abs(dpdx(uv)) * size;
    let dy = abs(dpdy(uv)) * size;
    return log2(max(max(dx.x, dx.y), max(dy.x, dy.y)));
}

// Échantillonnage fait à la main, comme le banc : la ligne 0 de la mémoire est le haut de l'image (v = 1).
fn sample_unit(unit: u32, uv: vec2<f32>, raw_lod: f32) -> vec4<f32> {
    let d = u.tex_dim[unit];
    if d.w < 0.5 { return vec4<f32>(0.0); }
    let l = u.tex_lod[unit];
    let lod = clamp(raw_lod + l.x, l.y, l.z);
    // réduite : le filtre de réduction, sinon celui d'agrandissement
    var mode = d.z;
    if lod > 0.0 && l.w >= 0.0 { mode = select(0.0, max(d.z, 1.0), l.w > 0.5); }
    if u.tex_wrap[unit].z != 0u {
        let low = floor(lod);
        let part = lod - low;
        if part > 0.0 && low < l.z {
            return mix(sample_level(unit, uv, i32(low), mode), sample_level(unit, uv, i32(low) + 1, mode), part);
        }
    }
    return sample_level(unit, uv, i32(floor(lod + 0.5)), mode);
}

fn sample_level(unit: u32, uv: vec2<f32>, level: i32, mode: f32) -> vec4<f32> {
    let d = u.tex_dim[unit];
    let size = max(vec2<i32>(i32(d.x), i32(d.y)) >> vec2<u32>(u32(level)), vec2<i32>(1));
    var x = uv.x * f32(size.x);
    var y = f32(size.y) - uv.y * f32(size.y);
    let ws = u.tex_wrap[unit].x;
    let wt = u.tex_wrap[unit].y;
    if mode < 0.5 {
        return fetch_texel(unit, wrap_index(i32(floor(x)), size.x, ws), wrap_index(i32(floor(y)), size.y, wt), level);
    }
    x = x - 0.5;
    y = y - 0.5;
    let x0 = floor(x);
    let y0 = floor(y);
    let fx = x - x0;
    let fy = y - y0;
    var ix0 = wrap_index(i32(x0), size.x, ws);
    var ix1 = wrap_index(i32(x0) + 1, size.x, ws);
    var iy0 = wrap_index(i32(y0), size.y, wt);
    var iy1 = wrap_index(i32(y0) + 1, size.y, wt);
    // Le jeu voulait le point le plus proche, le lissage vient de nous : ne pas mélanger par-dessus le bord de la texture, où le
    // morceau d'à côté (l'autre bord) n'a rien à voir. Sur un modèle symétrique, c'est la ligne au milieu du corps.
    if d.w > 2.5 {
        if ix1.x != ix0.x + 1 && ix1.x != ix0.x {
            if fx < 0.5 { ix1 = ix0; } else { ix0 = ix1; }
        }
        if iy1.x != iy0.x + 1 && iy1.x != iy0.x {
            if fy < 0.5 { iy1 = iy0; } else { iy0 = iy1; }
        }
    }
    let c00 = fetch_texel(unit, ix0, iy0, level);
    let c10 = fetch_texel(unit, ix1, iy0, level);
    let c01 = fetch_texel(unit, ix0, iy1, level);
    let c11 = fetch_texel(unit, ix1, iy1, level);
    let w00 = (1.0 - fx) * (1.0 - fy);
    let w10 = fx * (1.0 - fy);
    let w01 = (1.0 - fx) * fy;
    let w11 = fx * fy;
    let plain = c00 * w00 + c10 * w10 + c01 * w01 + c11 * w11;
    // découpe en haute définition : les points nuls comptent pour la forme, et ne déteignent pas sur ce qui reste
    if mode > 1.5 {
        let m00 = w00 * select(0.0, 1.0, c00.w > 0.0);
        let m10 = w10 * select(0.0, 1.0, c10.w > 0.0);
        let m01 = w01 * select(0.0, 1.0, c01.w > 0.0);
        let m11 = w11 * select(0.0, 1.0, c11.w > 0.0);
        let covered = m00 + m10 + m01 + m11;
        if covered < 0.5 { return vec4<f32>(plain.xyz, 0.0); }
        return (c00 * m00 + c10 * m10 + c01 * m01 + c11 * m11) / covered;
    }
    return plain;
}


//LIGHT_BEGIN//
// --- l'éclairage par fragment (port de `lighting.py`) ---
fn lr(r: u32) -> u32 { let i = r - 0x140u; return u.light[i >> 2u][i & 3u]; }
fn f20(bits: u32) -> f32 {
    let sign = (bits >> 19u) & 1u;
    let exponent = (bits >> 12u) & 0x7Fu;
    let mantissa = bits & 0xFFFu;
    if exponent == 0u { return select(0.0, -0.0, sign != 0u); }
    return bitcast<f32>((sign << 31u) | ((exponent + 64u) << 23u) | (mantissa << 11u));
}
fn sbits(v: u32, bits: u32) -> f32 {
    let x = v & ((1u << bits) - 1u);
    if (x >> (bits - 1u)) != 0u { return f32(i32(x) - i32(1u << bits)); }
    return f32(x);
}
fn color10(w: u32) -> vec3<f32> {
    return vec3<f32>(f32((w >> 20u) & 0x3FFu), f32((w >> 10u) & 0x3FFu), f32(w & 0x3FFu)) / 255.0;
}
fn nrm(v: vec3<f32>) -> vec3<f32> {
    let l = length(v);
    return v / select(1.0, l, l > 1e-12);
}
fn qrot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    let inner = cross(q.xyz, v) + q.w * v;
    return v + 2.0 * cross(q.xyz, inner);
}
fn lut_lookup(which: u32, x: f32, is_signed: bool, two_sided: bool) -> f32 {
    var scaled: f32;
    var row: f32;
    var index: u32;
    if is_signed {
        scaled = x * 128.0;
        row = clamp(floor(scaled), -128.0, 127.0);
        index = u32(i32(row)) & 255u;
    } else {
        let xa = select(max(x, 0.0), abs(x), two_sided);
        scaled = xa * 256.0;
        row = clamp(floor(scaled), 0.0, 255.0);
        index = u32(row);
    }
    let e = luts[which * 256u + index];
    return e.x + e.y * (scaled - row);
}
fn lut_supported(mode: u32, base: u32) -> bool {
    switch base {
        case 0u: { return mode != 1u; }
        case 1u: { return !(mode == 0u || mode == 1u || mode == 5u); }
        case 8u: { return !(mode == 2u || mode == 3u); }
        case 3u: { return !(mode == 0u || mode == 2u || mode == 4u); }
        case 6u: { return mode != 3u; }
        default: { return mode == 4u || mode == 5u || mode == 8u; }
    }
}
// (valeur, 1) si la table existe et est allumée dans ce mode, sinon (0, 0)
fn lut_table(which: u32, c1: u32, mode: u32, ins: array<f32, 6>, two_sided: bool) -> vec2<f32> {
    let base = select(which, 8u, which >= 8u);
    if !lut_supported(mode, base) { return vec2<f32>(0.0, 0.0); }
    var disable = 99u;
    var slot = 0u;
    switch base {
        case 0u: { disable = 16u; slot = 0u; }
        case 1u: { disable = 17u; slot = 1u; }
        case 8u: { slot = 2u; }
        case 3u: { disable = 19u; slot = 3u; }
        case 4u: { disable = 22u; slot = 4u; }
        case 5u: { disable = 21u; slot = 5u; }
        default: { disable = 20u; slot = 6u; }
    }
    if disable < 32u && ((c1 >> disable) & 1u) != 0u { return vec2<f32>(0.0, 0.0); }
    let rank = 4u * slot;
    let entry = (lr(0x1D1u) >> rank) & 7u;
    var input = ins[0];
    if entry <= 5u { input = ins[entry]; }
    let is_signed = ((lr(0x1D0u) >> (rank + 1u)) & 1u) != 0u;
    var scales = array<f32, 8>(1.0, 2.0, 4.0, 8.0, 1.0, 1.0, 0.25, 0.5);
    let scale = scales[(lr(0x1D2u) >> rank) & 7u];
    return vec2<f32>(scale * lut_lookup(which, input, is_signed, two_sided), 1.0);
}
struct Lit { p: vec4<f32>, s: vec4<f32> }
fn light_shade(quat_in: vec4<f32>, view: vec3<f32>, tx: array<vec4<f32>, 4>) -> Lit {
    let q = quat_in / max(length(quat_in), 1e-12);
    let c0 = lr(0x1C3u);
    let c1 = lr(0x1C4u);
    let mode = (c0 >> 4u) & 15u;
    var sn = vec3<f32>(0.0, 0.0, 1.0);
    var st = vec3<f32>(1.0, 0.0, 0.0);
    let bump = (c0 >> 28u) & 3u;
    if bump != 0u {
        var pert = tx[(c0 >> 22u) & 3u].xyz * 255.0 / 127.5 - vec3<f32>(1.0);
        if bump == 1u {
            if ((c0 >> 30u) & 1u) == 0u { pert.z = sqrt(max(1.0 - (pert.x * pert.x + pert.y * pert.y), 0.0)); }
            sn = pert;
        } else {
            st = pert;
        }
    }
    let normal = qrot(q, sn);
    let tangent = qrot(q, st);
    let view_n = nrm(view);
    var shadow = vec4<f32>(1.0);
    if (c0 & 1u) != 0u {
        shadow = tx[(c0 >> 24u) & 3u];
        if ((c0 >> 18u) & 1u) != 0u { shadow = vec4<f32>(1.0) - shadow; }
    }
    var diffuse_sum = vec3<f32>(0.0);
    var specular_sum = vec3<f32>(0.0);
    var alpha_p = 1.0;
    var alpha_s = 1.0;
    let last = lr(0x1C2u) & 7u;
    for (var slot = 0u; slot <= last; slot = slot + 1u) {
        let light_id = (lr(0x1D9u) >> (4u * slot)) & 7u;
        let b = 0x140u + 0x10u * light_id;
        let position = vec3<f32>(unpack2x16float(lr(b + 4u)).x, unpack2x16float(lr(b + 4u)).y, unpack2x16float(lr(b + 5u)).x);
        let lcfg = lr(b + 9u);
        let two_sided = ((lcfg >> 1u) & 1u) != 0u;
        var light = position + view;
        if (lcfg & 1u) != 0u { light = position; }
        let len = length(light);
        let light_n = nrm(light);
        let half_v = view_n + light_n;
        let half_n = nrm(half_v);
        let spot_dir = vec3<f32>(sbits(lr(b + 6u), 13u), sbits(lr(b + 6u) >> 16u, 13u), sbits(lr(b + 7u), 13u)) / 2047.0;
        var ins = array<f32, 6>(dot(normal, half_n), dot(view_n, half_n), dot(normal, view_n), dot(light_n, normal), dot(light_n, spot_dir), 0.0);
        if mode == 8u { ins[5] = dot(half_n - normal * dot(normal, half_n), tangent); }
        var distance = 1.0;
        if ((c1 >> (24u + light_id)) & 1u) == 0u {
            let smp = clamp(len * f20(lr(b + 11u)) + f20(lr(b + 10u)), 0.0, 1.0);
            distance = lut_lookup(16u + light_id, smp, false, false);
        }
        var spot = 1.0;
        if ((c1 >> (8u + light_id)) & 1u) == 0u {
            let t = lut_table(8u + light_id, c1, mode, ins, two_sided);
            if t.y > 0.5 { spot = t.x; }
        }
        let d0 = lut_table(0u, c1, mode, ins, two_sided);
        let d1 = lut_table(1u, c1, mode, ins, two_sided);
        let red = lut_table(6u, c1, mode, ins, two_sided);
        var refl = vec3<f32>(1.0);
        if red.y > 0.5 { refl = vec3<f32>(red.x); }
        let green = lut_table(5u, c1, mode, ins, two_sided);
        if green.y > 0.5 { refl.y = green.x; }
        let blue = lut_table(4u, c1, mode, ins, two_sided);
        if blue.y > 0.5 { refl.z = blue.x; }
        var spec0 = color10(lr(b)) * select(1.0, d0.x, d0.y > 0.5);
        var spec1 = color10(lr(b + 1u)) * select(1.0, d1.x, d1.y > 0.5) * refl;
        if slot == last {
            let fr = lut_table(3u, c1, mode, ins, two_sided);
            if fr.y > 0.5 {
                let f = clamp(fr.x, 0.0, 1.0);
                if ((c0 >> 2u) & 1u) != 0u { alpha_p = f; }
                if ((c0 >> 3u) & 1u) != 0u { alpha_s = f; }
            }
        }
        var dot_ln = dot(light_n, normal);
        dot_ln = select(max(dot_ln, 0.0), abs(dot_ln), two_sided);
        var clamp_ = 1.0;
        if ((c0 >> 27u) & 1u) != 0u { clamp_ = select(1.0, 0.0, dot_ln == 0.0); }
        if (lcfg & 12u) != 0u {
            let hl2 = dot(half_v, half_v);
            let geo = select(min(dot_ln / max(hl2, 1e-30), 1.0), 0.0, hl2 == 0.0);
            if ((lcfg >> 2u) & 1u) != 0u { spec0 = spec0 * geo; }
            if ((lcfg >> 3u) & 1u) != 0u { spec1 = spec1 * geo; }
        }
        let shadowed = ((c1 >> light_id) & 1u) == 0u;
        var shadow_p = vec3<f32>(1.0);
        var shadow_s = vec3<f32>(1.0);
        if ((c0 >> 16u) & 1u) != 0u && shadowed { shadow_p = shadow.xyz; }
        if ((c0 >> 17u) & 1u) != 0u && shadowed { shadow_s = shadow.xyz; }
        let attenuation = distance * spot;
        diffuse_sum = diffuse_sum + (color10(lr(b + 2u)) * dot_ln * shadow_p + color10(lr(b + 3u))) * attenuation;
        specular_sum = specular_sum + (spec0 + spec1) * clamp_ * attenuation * shadow_s;
    }
    if ((c0 >> 19u) & 1u) != 0u {
        if ((c0 >> 2u) & 1u) != 0u { alpha_p = alpha_p * shadow.w; }
        if ((c0 >> 3u) & 1u) != 0u { alpha_s = alpha_s * shadow.w; }
    }
    diffuse_sum = diffuse_sum + color10(lr(0x1C0u));
    var out: Lit;
    out.p = vec4<f32>(clamp(diffuse_sum, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(alpha_p, 0.0, 1.0));
    out.s = vec4<f32>(clamp(specular_sum, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(alpha_s, 0.0, 1.0));
    return out;
}
//LIGHT_END//

//LOGIC_BEGIN//
fn logic4(op: u32, s: vec4<u32>, d: vec4<u32>) -> vec4<u32> {
    var r: vec4<u32>;
    switch op {
        case 0u: { r = vec4<u32>(0u); }
        case 1u: { r = s & d; }
        case 2u: { r = s & ~d; }
        case 3u: { r = s; }
        case 4u: { r = vec4<u32>(255u); }
        case 5u: { r = ~s; }
        case 6u: { r = d; }
        case 7u: { r = ~d; }
        case 8u: { r = ~(s & d); }
        case 9u: { r = s | d; }
        case 10u: { r = ~(s | d); }
        case 11u: { r = s ^ d; }
        case 12u: { r = ~(s ^ d); }
        case 13u: { r = ~s & d; }
        case 14u: { r = s | ~d; }
        default: { r = ~s | d; }
    }
    return r & vec4<u32>(255u);
}
//LOGIC_END//

fn compare_u(func: u32, a: u32, b: u32) -> bool {
    switch func {
        case 0u: { return false; }
        case 1u: { return true; }
        case 2u: { return a == b; }
        case 3u: { return a != b; }
        case 4u: { return a < b; }
        case 5u: { return a <= b; }
        case 6u: { return a > b; }
        default: { return a >= b; }
    }
}

@fragment
fn fs_main(in: FsIn) -> FsOut {
    var at: array<f32, 20>;
    at[0] = in.a0.x; at[1] = in.a0.y; at[2] = in.a0.z; at[3] = in.a0.w;
    at[4] = in.a1.x; at[5] = in.a1.y; at[6] = in.a1.z; at[7] = in.a1.w;
    at[8] = in.a2.x; at[9] = in.a2.y; at[10] = in.a2.z; at[11] = in.a2.w;
    at[12] = in.a3.x; at[13] = in.a3.y; at[14] = in.a3.z; at[15] = in.a3.w;
    at[16] = in.a4.x; at[17] = in.a4.y; at[18] = in.a4.z; at[19] = in.a4.w;
    let primary = clamp(vec4<f32>(at[0], at[1], at[2], at[3]), vec4<f32>(0.0), vec4<f32>(1.0));
    let zero4 = vec4<f32>(0.0);
"#,
    );
    // les textures
    let used = used_texture_units(state);
    let enable = regs[0x80];
    for unit in 0..3usize {
        // la texture 0 de type 5 est éteinte : elle lit zéro (`glsl_fs_shader_gen.cpp` d'Azahar)
        let disabled = unit == 0 && (regs[0x83] >> 28) & 7 == 5;
        if used[unit] && (enable >> unit) & 1 != 0 && !disabled {
            let (u, v) = match unit {
                0 => (4, 5),
                1 => (6, 7),
                _ if (enable >> 13) & 1 != 0 => (6, 7),
                _ => (8, 9),
            };
            if unit == 0 && (regs[0x83] >> 28) & 7 == 3 {
                // texture projetée : coordonnées divisées par le w de la texture 0 (case 10), zéro si w est nul
                let _ = writeln!(s, "    let pw = at[10];");
                let _ = writeln!(s, "    let uv0 = select(vec2<f32>(at[{u}], at[{v}]) / pw, vec2<f32>(0.0), pw == 0.0);");
                let _ = writeln!(s, "    let t0 = sample_unit(0u, uv0, texture_lod(0u, uv0));");
            } else {
                let _ = writeln!(s, "    let uv{unit} = vec2<f32>(at[{u}], at[{v}]);");
                let _ = writeln!(s, "    let t{unit} = sample_unit({unit}u, uv{unit}, texture_lod({unit}u, uv{unit}));");
            }
        } else {
            let _ = writeln!(s, "    let t{unit} = zero4;");
        }
    }
    if crate::lighting_on(state) {
        s.push_str("    let lit = light_shade(vec4<f32>(at[14], at[15], at[16], at[17]), vec3<f32>(at[11], at[12], at[13]), array<vec4<f32>, 4>(t0, t1, t2, zero4));\n");
        s.push_str("    let frag_primary = lit.p;\n    let frag_secondary = lit.s;\n");
    } else {
        s.push_str("    let frag_primary = zero4;\n    let frag_secondary = zero4;\n");
    }
    s.push_str("    var buffer = zero4;\n    var next_buffer = u.buffer_color;\n    var previous = zero4;\n");
    let update = regs[0xE0];
    let mut any_stage = false;
    for (k, &base) in STAGE_BASES.iter().enumerate() {
        if stage_is_default(regs, base) {
            continue;
        }
        any_stage = true;
        let (w0, w1, w2, w4) = (regs[base], regs[base + 1], regs[base + 2], regs[base + 4]);
        let fetch = |code: u32| -> String {
            match code {
                0xF => "previous".into(),
                0xD => "buffer".into(),
                0xE => format!("u.tev_const[{k}]"),
                0 => "primary".into(),
                1 => "frag_primary".into(), // avec l'éclairage : la couleur des lumières, sinon zéro (comme Azahar)
                2 => "frag_secondary".into(),
                3 => "t0".into(),
                4 => "t1".into(),
                5 => "t2".into(),
                _ => "zero4".into(),
            }
        };
        let c: Vec<String> = (0..3).map(|i| color_operand(&fetch((w0 >> (4 * i)) & 15), (w1 >> (4 * i)) & 15)).collect();
        let a: Vec<String> = (0..3).map(|i| alpha_operand(&fetch((w0 >> (16 + 4 * i)) & 15), (w1 >> (12 + 4 * i)) & 7)).collect();
        let color_op = w2 & 15;
        let alpha_op = (w2 >> 16) & 15;
        let rgb_scale = [1.0, 2.0, 4.0, 1.0][(w4 & 3) as usize];
        let alpha_scale = [1.0, 2.0, 4.0, 1.0][((w4 >> 16) & 3) as usize];
        let rgb = combine_rgb(color_op, [&c[0], &c[1], &c[2]]);
        let alpha = if color_op == 7 { format!("({rgb}).x") } else { combine_alpha(alpha_op, [&a[0], &a[1], &a[2]]) };
        let _ = writeln!(s, "    {{");
        let _ = writeln!(s, "        let rgb = clamp({rgb} * {rgb_scale:?}, vec3<f32>(0.0), vec3<f32>(1.0));");
        let _ = writeln!(s, "        let al = clamp(({alpha}) * {alpha_scale:?}, 0.0, 1.0);");
        let _ = writeln!(s, "        previous = vec4<f32>(rgb, al);");
        let _ = writeln!(s, "        buffer = next_buffer;");
        if k < 4 {
            if (update >> (8 + k)) & 1 != 0 {
                let _ = writeln!(s, "        next_buffer = vec4<f32>(rgb, next_buffer.w);");
            }
            if (update >> (12 + k)) & 1 != 0 {
                let _ = writeln!(s, "        next_buffer = vec4<f32>(next_buffer.xyz, al);");
            }
        }
        let _ = writeln!(s, "    }}");
    }
    // aucun étage réglé (jamais vu dans le jeu) : la couleur du sommet, ce qui donne quelque chose à voir en test
    if !any_stage {
        s.push_str("    previous = primary;\n");
    }
    s.push_str("    var color = previous;\n");
    if regs[0xE0] & 7 == 5 {
        let invert = (regs[0xE0] >> 16) & 1 != 0;
        s.push_str("    {\n        var depth = clamp(in.zd, 0.0, 1.0);\n");
        if invert {
            s.push_str("        depth = 1.0 - depth;\n");
        }
        s.push_str(
            "        let p = depth * 127.999;\n        let idx = u32(p);\n        let e = u.fog[idx / 2u];\n        \
             let entry = select(e.xy, e.zw, (idx & 1u) == 1u);\n        \
             let factor = clamp(entry.x + entry.y * (p - f32(idx)), 0.0, 1.0);\n        \
             color = vec4<f32>(color.xyz * factor + u.fog_color.xyz * (1.0 - factor), color.w);\n    }\n",
        );
    }
    s.push_str(
        "    if u.alpha_test.x != 0u {\n        let alpha = u32(color.w * 255.0 + 0.5);\n        \
         if !compare_u(u.alpha_test.y, alpha, u.alpha_test.z) { discard; }\n    }\n",
    );
    s.push_str("    color = vec4<f32>(color.xyz * u.blend_pre.xyz, color.w * u.blend_pre.w);\n");
    if logic {
        s.push_str(
            "    if u.misc2.x != 3u {\n        let sb = vec4<u32>(clamp(color * 255.0 + vec4<f32>(0.5), vec4<f32>(0.0), vec4<f32>(255.0)));\n        \
             let db = vec4<u32>(textureLoad(dst_tex, vec2<i32>(in.pos.xy), 0) * 255.0 + vec4<f32>(0.5));\n        \
             color = vec4<f32>(logic4(u.misc2.x, sb, db)) / 255.0;\n    }\n",
        );
    }
    s.push_str("    var out: FsOut;\n    out.color = color;\n");
    if depth_out {
        s.push_str("    out.depth = clamp(in.zd, 0.0, 1.0);\n");
    }
    s.push_str("    return out;\n}\n");
    let s = s.replace("    //DEPTH//\n", if depth_out { "    @builtin(frag_depth) depth: f32,\n" } else { "" });
    // le code de l'éclairage et des opérations logiques n'est dans le texte que s'il sert : les shaders sans éclairage
    // se compilent bien plus vite
    let s = strip_block(&s, "//LIGHT_BEGIN//", "//LIGHT_END//", crate::lighting_on(state));
    strip_block(&s, "//LOGIC_BEGIN//", "//LOGIC_END//", logic)
}

/// Retire (ou garde) le bloc de texte entre deux marqueurs ; les marqueurs eux-mêmes disparaissent.
fn strip_block(text: &str, begin: &str, end: &str, keep: bool) -> String {
    let (Some(a), Some(b)) = (text.find(begin), text.find(end)) else { return text.to_string() };
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..a]);
    if keep {
        out.push_str(&text[a + begin.len()..b]);
    }
    out.push_str(&text[b + end.len()..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_uses_primary_only() {
        let s = GpuState::new();
        let src = generate(&s, false, true);
        assert!(src.contains("previous = primary;"));
        assert_eq!(used_texture_units(&s), [false; 3]);
    }

    #[test]
    fn texture_unit_detection() {
        let mut s = GpuState::new();
        // étage 0 : source 0 = texture 0 (code 3), les autres « précédent »
        s.regs[0xC0] = 0x000F_FFF3 & 0x000F_FFFF | (0xF << 16);
        s.regs[0xC2] = 1;
        assert!(used_texture_units(&s)[0]);
        s.regs[0x83] = 5 << 28;
        assert!(generate(&s, false, true).contains("let t0 = zero4;"), "texture 0 éteinte");
        s.regs[0x83] = 0;
        // une carte de normales lue par l'éclairage seul : son unité est liée, et le texte l'échantillonne
        let mut lit = GpuState::new();
        lit.write(0x1C6, 0, 0xF);
        lit.regs[0x80] = 7;
        lit.regs[0x1C3] = 1 << 28 | 2 << 22;
        assert_eq!(used_texture_units(&lit), [false, false, true]);
        assert!(generate(&lit, false, true).contains("let t2 = sample_unit(2u"));
        lit.regs[0x1C3] = 0;
        assert_eq!(used_texture_units(&lit), [false; 3]);
    }
}
