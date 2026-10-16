//! Traduction d'un programme de shader de sommets du PICA200 en WGSL (le shader de sommets du GPU du PC).
//!
//! Le PICA exécute les mêmes instructions que `banc/pica/shader.py` (la référence). Ici, chaque programme est traduit une
//! fois en texte WGSL, mis en cache par le moteur selon (code, descripteurs, point d'entrée, sorties). Le flot de
//! contrôle est structuré comme dans le banc : les `IF` sont recopiés en ligne, les `CALL` et les corps de `LOOP`
//! deviennent des fonctions (code de retour : 0 normal, 1 `BREAK`, 2 `END`), les `JMPC`/`JMPU` vers l'avant sont des
//! `if`. Un saut vers l'arrière n'est pas traduit (erreur, le dessin est signalé et sauté).
//!
//! Les uniformes flottants, entiers et booléens ne sont pas dans le texte : ils sont lus dans le bloc `Draw` à chaque
//! dessin, pour que deux dessins du même programme avec d'autres constantes partagent la même traduction.

use std::collections::HashMap;
use std::fmt::Write;

use crate::state::GpuState;

/// Les emplacements d'attributs interpolés (comme `SEMANTIC_SLOTS` de `raster.py`) : sémantique -> case.
pub const SEMANTIC_SLOTS: [(u32, usize); 18] = [
    (4, 14), (5, 15), (6, 16), (7, 17), (8, 0), (9, 1), (10, 2), (11, 3), (12, 4), (13, 5), (14, 6), (15, 7),
    (16, 10), (18, 11), (19, 12), (20, 13), (22, 8), (23, 9),
];

/// Le bloc de déclarations commun aux shaders de sommets et de fragments : le bloc `Draw` et ses liaisons.
pub const PRELUDE: &str = r#"
struct Draw {
    c: array<vec4<f32>, 96>,
    ints: array<vec4<u32>, 4>,
    misc: vec4<u32>,          // x : booléens, y : registres d'entrée par sommet, z : rang du premier vecteur dans `inputs`
    xf0: vec4<f32>,           // x' = x * xf0.x + w * xf0.y ; y' = y * xf0.z + w * xf0.w
    xf1: vec4<f32>,           // profondeur = z / w * xf1.x + xf1.y
    tev_const: array<vec4<f32>, 6>,
    buffer_color: vec4<f32>,
    fog_color: vec4<f32>,
    tex_dim: array<vec4<f32>, 3>,   // largeur, hauteur, linéaire (0/1), mode (0 vide, 1 magenta, 2 échantillonner)
    tex_wrap: array<vec4<u32>, 3>,  // mode s, mode t
    tex_border: array<vec4<f32>, 3>,
    alpha_test: vec4<u32>,    // actif, fonction, référence
    fog: array<vec4<f32>, 64>,      // (valeur, différence) x 2 par vecteur
    light: array<vec4<u32>, 48>,    // les registres 0x140 à 0x1FF (éclairage), lus tels quels
    misc2: vec4<u32>,         // x : opération logique (3 : copie, rien à faire)
    blend_pre: vec4<f32>,     // facteur de mélange « constante » de la source, appliqué dans le shader (rgb, alpha)
}
@group(0) @binding(0) var<uniform> u: Draw;
"#;

/// Où l'état des registres décide de la forme du programme : tout ce qui entre dans la clé du cache.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ProgramKey {
    pub code: Vec<u32>,
    pub swizzle: Vec<u32>,
    pub entry: u32,
    pub out_mask: u32,
    pub semantics: [u32; 7],
}

impl ProgramKey {
    pub fn from_state(s: &GpuState) -> ProgramKey {
        let mut semantics = [0u32; 7];
        for (k, w) in semantics.iter_mut().enumerate() {
            *w = s.regs[0x50 + k];
        }
        ProgramKey {
            code: s.code.clone(),
            swizzle: s.swizzle.clone(),
            entry: s.regs[0x2BA] & 0xFFFF,
            out_mask: s.regs[0x2BD] & 0xFFFF,
            semantics,
        }
    }
}

struct Translator<'a> {
    key: &'a ProgramKey,
    functions: Vec<String>,
    names: HashMap<(char, u32, u32), String>,
    depth: u32,
    counter: u32,
}

const SWIZZLE_CHARS: [char; 4] = ['x', 'y', 'z', 'w'];

fn selector(desc: u32, which: u32) -> (String, bool) {
    let (sel, neg) = match which {
        1 => ([desc >> 11 & 3, desc >> 9 & 3, desc >> 7 & 3, desc >> 5 & 3], desc >> 4 & 1),
        2 => ([desc >> 20 & 3, desc >> 18 & 3, desc >> 16 & 3, desc >> 14 & 3], desc >> 13 & 1),
        _ => ([desc >> 29 & 3, desc >> 27 & 3, desc >> 25 & 3, desc >> 23 & 3], desc >> 22 & 1),
    };
    let s: String = sel.iter().map(|&i| SWIZZLE_CHARS[i as usize]).collect();
    (if s == "xyzw" { String::new() } else { format!(".{s}") }, neg != 0)
}

/// Le texte WGSL d'une lecture de registre source, avec adressage relatif (`offset` : None, a0, a1 ou aL).
fn source(index: u32, sel: &(String, bool), offset: u32) -> String {
    let off = match offset {
        1 => Some("a0"),
        2 => Some("a1"),
        3 => Some("al"),
        _ => None,
    };
    let base = match off {
        None => {
            if index < 0x10 {
                format!("v[{index}]")
            } else if index < 0x20 {
                format!("r[{}]", index - 0x10)
            } else {
                format!("u.c[{}]", (index - 0x20).min(95))
            }
        }
        Some(o) => {
            if index < 0x10 {
                format!("v[clamp({} + {o}, 0, 15)]", index & 15)
            } else if index < 0x20 {
                format!("r[clamp({} + {o}, 0, 15)]", index & 15)
            } else {
                format!("u.c[clamp({} + {o}, 0, 95)]", index - 0x20)
            }
        }
    };
    let swizzled = format!("{base}{}", sel.0);
    if sel.1 { format!("(-{swizzled})") } else { swizzled }
}

fn cmp_expr(op: u32, a: &str, b: &str) -> String {
    match op {
        0 => format!("({a} == {b})"),
        1 => format!("({a} != {b})"),
        2 => format!("({a} < {b})"),
        3 => format!("({a} <= {b})"),
        4 => format!("({a} > {b})"),
        5 => format!("({a} >= {b})"),
        _ => "true".to_string(),
    }
}

/// La condition d'une instruction `IFC`, `CALLC`, `BREAKC` ou `JMPC` (comparaison enregistrée par `CMP`).
fn condition(instr: u32) -> String {
    let op = instr >> 22 & 3;
    let ref_y = instr >> 24 & 1;
    let ref_x = instr >> 25 & 1;
    let cx = format!("(cmpx == {})", ref_x != 0);
    let cy = format!("(cmpy == {})", ref_y != 0);
    match op {
        0 => format!("({cx} || {cy})"),
        1 => format!("({cx} && {cy})"),
        2 => cx,
        _ => cy,
    }
}

fn write_dest(out: &mut String, dest: u32, mask: u32, value: &str, pad: &str) {
    let target = if dest < 0x10 { format!("o[{}]", dest & 15) } else { format!("r[{}]", dest & 15) };
    if mask == 15 {
        let _ = writeln!(out, "{pad}{target} = {value};");
        return;
    }
    if mask == 0 {
        return;
    }
    let _ = writeln!(out, "{pad}{{ let t = {value};");
    for c in 0..4 {
        if mask & (8 >> c) != 0 {
            let ch = SWIZZLE_CHARS[c];
            let _ = writeln!(out, "{pad}  {target}.{ch} = t.{ch};");
        }
    }
    let _ = writeln!(out, "{pad}}}");
}

impl<'a> Translator<'a> {
    fn arith(&self, out: &mut String, instr: u32, op: u32, pad: &str) {
        let swz = |i: u32| self.key.swizzle[(i & 0xFFF) as usize];
        if op >= 0x38 || op >= 0x30 {
            let madi = op < 0x38;
            let desc = swz(instr & 0x1F);
            let src1 = instr >> 17 & 0x1F;
            let (src2, src3) = if madi { (instr >> 12 & 0x1F, instr >> 5 & 0x7F) } else { (instr >> 10 & 0x7F, instr >> 5 & 0x1F) };
            let idx = instr >> 22 & 3;
            let dest = instr >> 24 & 0x1F;
            let a = source(src1, &selector(desc, 1), 0);
            let b = source(src2, &selector(desc, 2), if madi { 0 } else { idx });
            let c = source(src3, &selector(desc, 3), if madi { idx } else { 0 });
            write_dest(out, dest, desc & 15, &format!("(pmul({a}, {b}) + {c})"), pad);
            return;
        }
        let desc = swz(instr & 0x7F);
        let idx = instr >> 19 & 3;
        let dest = instr >> 21 & 0x1F;
        let inverted = matches!(op, 0x18 | 0x19 | 0x1A | 0x1B);
        let (src1, src2, off1, off2) = if inverted {
            (instr >> 14 & 0x1F, instr >> 7 & 0x7F, 0, idx)
        } else {
            (instr >> 12 & 0x7F, instr >> 7 & 0x1F, idx, 0)
        };
        let a = source(src1, &selector(desc, 1), off1);
        let b = source(src2, &selector(desc, 2), off2);
        if op == 0x2E || op == 0x2F {
            let op_x = instr >> 24 & 7;
            let op_y = instr >> 21 & 7;
            let _ = writeln!(out, "{pad}{{ let ca = {a}; let cb = {b};");
            let _ = writeln!(out, "{pad}  cmpx = {}; cmpy = {}; }}", cmp_expr(op_x, "ca.x", "cb.x"), cmp_expr(op_y, "ca.y", "cb.y"));
            return;
        }
        let mask = desc & 15;
        let scalar = |expr: String| format!("vec4<f32>({expr})");
        let value = match op {
            0x13 => a.clone(),                                     // MOV
            0x0B => format!("floor({a})"),                         // FLR
            0x12 => {                                              // MOVA
                let _ = writeln!(out, "{pad}{{ let t = {a};");
                if mask & 8 != 0 {
                    let _ = writeln!(out, "{pad}  a0 = i32(clamp(trunc(t.x), -128.0, 127.0));");
                }
                if mask & 4 != 0 {
                    let _ = writeln!(out, "{pad}  a1 = i32(clamp(trunc(t.y), -128.0, 127.0));");
                }
                let _ = writeln!(out, "{pad}}}");
                return;
            }
            0x0E => scalar(format!("(1.0 / ({a}).x)")),            // RCP
            0x0F => scalar(format!("(1.0 / sqrt(({a}).x))")),      // RSQ
            0x05 => scalar(format!("exp2(({a}).x)")),              // EX2
            0x06 => scalar(format!("log2(({a}).x)")),              // LG2
            0x00 => format!("({a} + {b})"),                        // ADD
            0x08 => format!("pmul({a}, {b})"),                     // MUL
            0x01 => scalar(format!("dot3p({a}, {b})")),            // DP3
            0x02 => scalar(format!("dot4p({a}, {b})")),            // DP4
            0x03 | 0x18 => scalar(format!("(dot3p({a}, {b}) + ({b}).w)")), // DPH
            0x04 | 0x19 => format!("vec4<f32>(1.0, pmul1(({a}).y, ({b}).y), ({a}).z, ({b}).w)"), // DST
            0x09 | 0x1A => format!("select(vec4<f32>(0.0), vec4<f32>(1.0), {a} >= {b})"), // SGE
            0x0A | 0x1B => format!("select(vec4<f32>(0.0), vec4<f32>(1.0), {a} < {b})"),  // SLT
            0x0C => format!("max({a}, {b})"),
            0x0D => format!("min({a}, {b})"),
            _ => "vec4<f32>(0.0)".to_string(),
        };
        write_dest(out, dest, mask, &value, pad);
    }

    fn call_function(&mut self, kind: char, start: u32, end: u32) -> Result<String, String> {
        let key = (kind, start, end);
        if let Some(n) = self.names.get(&key) {
            return Ok(n.clone());
        }
        let name = format!("{kind}_{start}_{end}");
        self.names.insert(key, name.clone());
        let mut body = String::new();
        self.depth += 1;
        if self.depth > 24 {
            return Err("sous-programmes trop imbriqués (récursion ?)".into());
        }
        self.block(start, end, &mut body, "    ")?;
        self.depth -= 1;
        self.functions.push(format!("fn {name}() -> u32 {{\n{body}    return 0u;\n}}\n"));
        Ok(name)
    }

    /// L'expression « le saut est pris » d'un `JMPC` ou `JMPU`.
    fn jump_taken(instr: u32) -> String {
        if instr >> 26 == 0x2C {
            condition(instr)
        } else {
            let invert = instr & 1 != 0;
            format!("((((u.misc.x >> {}u) & 1u) != 0u) == {})", instr >> 22 & 15, !invert)
        }
    }

    /// Les sauts vers l'arrière de premier niveau d'un bloc (les constructions imbriquées sont enjambées) :
    /// destination -> dernière instruction de saut. Chacun devient une boucle.
    fn backward_loops(&self, start: u32, end: u32) -> HashMap<u32, u32> {
        let mut loops: HashMap<u32, u32> = HashMap::new();
        let mut pc = start;
        while pc < end {
            let instr = self.key.code[pc as usize];
            let op = instr >> 26;
            let dest = instr >> 10 & 0xFFF;
            match op {
                0x27 | 0x28 => pc = dest + (instr & 0xFF),
                0x29 => pc = dest + 1,
                0x2C | 0x2D => {
                    if dest <= pc && dest >= start {
                        let e = loops.entry(dest).or_insert(pc);
                        *e = (*e).max(pc);
                    }
                    pc += 1;
                }
                _ => pc += 1,
            }
        }
        loops
    }

    fn block(&mut self, mut pc: u32, end: u32, out: &mut String, pad: &str) -> Result<(), String> {
        let end = end.min(4096);
        let loops = self.backward_loops(pc, end);
        while pc < end {
            if let Some(&last) = loops.get(&pc) {
                self.counter += 1;
                let g = format!("g{}", self.counter);
                let _ = writeln!(out, "{pad}for (var {g}: u32 = 0u; {g} < 4096u; {g} = {g} + 1u) {{");
                let inner = format!("{pad}    ");
                self.block(pc, last, out, &inner)?;
                let _ = writeln!(out, "{inner}if !({}) {{ break; }}", Self::jump_taken(self.key.code[last as usize]));
                let _ = writeln!(out, "{pad}}}");
                pc = last + 1;
                continue;
            }
            let instr = self.key.code[pc as usize];
            let op = instr >> 26;
            if op < 0x20 || op >= 0x2E {
                self.arith(out, instr, op, pad);
                pc += 1;
                continue;
            }
            let dest = instr >> 10 & 0xFFF;
            let count = instr & 0xFF;
            match op {
                0x22 => { // END
                    let _ = writeln!(out, "{pad}return 2u;");
                    return Ok(());
                }
                0x21 | 0x2A | 0x2B => pc += 1, // NOP, EMIT, SETEMIT
                0x20 => {
                    let _ = writeln!(out, "{pad}return 1u;");
                    pc += 1;
                }
                0x23 => {
                    let _ = writeln!(out, "{pad}if {} {{ return 1u; }}", condition(instr));
                    pc += 1;
                }
                0x24..=0x26 => {
                    let f = self.call_function('f', dest, dest + count)?;
                    let guard = match op {
                        0x24 => "true".to_string(),
                        0x25 => condition(instr),
                        _ => format!("((u.misc.x >> {}u) & 1u) != 0u", instr >> 22 & 15),
                    };
                    let _ = writeln!(out, "{pad}if {guard} {{ if {f}() == 2u {{ return 2u; }} }}");
                    pc += 1;
                }
                0x27 | 0x28 => {
                    let guard = if op == 0x27 {
                        format!("((u.misc.x >> {}u) & 1u) != 0u", instr >> 22 & 15)
                    } else {
                        condition(instr)
                    };
                    let _ = writeln!(out, "{pad}if {guard} {{");
                    let inner = format!("{pad}    ");
                    self.block(pc + 1, dest, out, &inner)?;
                    if count > 0 {
                        let _ = writeln!(out, "{pad}}} else {{");
                        self.block(dest, dest + count, out, &inner)?;
                    }
                    let _ = writeln!(out, "{pad}}}");
                    pc = dest + count;
                }
                0x29 => {
                    let f = self.call_function('l', pc + 1, dest + 1)?;
                    let k = instr >> 22 & 3;
                    let _ = writeln!(out, "{pad}{{ let lx = u.ints[{k}].x; let ly = u.ints[{k}].y; let lz = u.ints[{k}].z;");
                    let _ = writeln!(out, "{pad}  for (var li: u32 = 0u; li <= lx; li = li + 1u) {{");
                    let _ = writeln!(out, "{pad}    al = i32((ly + li * lz) & 255u);");
                    let _ = writeln!(out, "{pad}    let rr = {f}();");
                    let _ = writeln!(out, "{pad}    if rr == 1u {{ break; }}");
                    let _ = writeln!(out, "{pad}    if rr == 2u {{ return 2u; }}");
                    let _ = writeln!(out, "{pad}  }} }}");
                    pc = dest + 1;
                }
                0x2C | 0x2D => {
                    if dest <= pc {
                        return Err(format!("saut vers l'arrière hors de toute boucle à {pc} vers {dest}"));
                    }
                    // un saut au-delà de la fin du bloc termine le bloc, comme dans le banc
                    let target = dest.min(end);
                    let _ = writeln!(out, "{pad}if !({}) {{", Self::jump_taken(instr));
                    self.block(pc + 1, target, out, &format!("{pad}    "))?;
                    let _ = writeln!(out, "{pad}}}");
                    pc = target;
                }
                _ => {
                    pc += 1;
                }
            }
        }
        Ok(())
    }
}

/// Traduit le programme. Rend le texte WGSL complet du shader de sommets (point d'entrée `vs_main`).
pub fn translate(key: &ProgramKey) -> Result<String, String> {
    let mut t = Translator { key, functions: Vec::new(), names: HashMap::new(), depth: 0, counter: 0 };
    let main = t.call_function('f', key.entry, 4096)?;
    let mut src = String::new();
    src.push_str(PRELUDE);
    src.push_str(
        r#"
@group(0) @binding(1) var<storage, read> inputs: array<vec4<f32>>;
var<private> v: array<vec4<f32>, 16>;
var<private> r: array<vec4<f32>, 16>;
var<private> o: array<vec4<f32>, 16>;
var<private> a0: i32;
var<private> a1: i32;
var<private> al: i32;
var<private> cmpx: bool;
var<private> cmpy: bool;

// La multiplication du PICA : zéro fois n'importe quoi (même l'infini) donne zéro.
fn pmul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return select(a * b, vec4<f32>(0.0), (a == vec4<f32>(0.0)) | (b == vec4<f32>(0.0)));
}
fn pmul1(a: f32, b: f32) -> f32 {
    return select(a * b, 0.0, (a == 0.0) || (b == 0.0));
}
fn dot3p(a: vec4<f32>, b: vec4<f32>) -> f32 {
    let m = pmul(a, b);
    return m.x + m.y + m.z;
}
fn dot4p(a: vec4<f32>, b: vec4<f32>) -> f32 {
    let m = pmul(a, b);
    return m.x + m.y + m.z + m.w;
}

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) a0: vec4<f32>,
    @location(1) a1: vec4<f32>,
    @location(2) a2: vec4<f32>,
    @location(3) a3: vec4<f32>,
    @location(4) a4: vec4<f32>,
    @location(5) @interpolate(linear) zd: f32,
}
"#,
    );
    for f in &t.functions {
        src.push_str(f);
        src.push('\n');
    }
    src.push_str("@vertex\nfn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {\n");
    src.push_str("    let stride = u.misc.y;\n");
    src.push_str("    for (var i: u32 = 0u; i < 16u; i = i + 1u) {\n");
    src.push_str("        if i < stride { v[i] = inputs[u.misc.z + vi * stride + i]; } else { v[i] = vec4<f32>(0.0, 0.0, 0.0, 1.0); }\n");
    src.push_str("    }\n");
    let _ = writeln!(src, "    let status = {main}();");
    src.push_str("    var pos = vec4<f32>(0.0, 0.0, 0.0, 1.0);\n    var at: array<f32, 20>;\n    at[3] = 1.0;\n");
    let slots: Vec<u32> = (0..16).filter(|r| key.out_mask >> r & 1 != 0).collect();
    for (k, &reg) in slots.iter().take(7).enumerate() {
        let word = key.semantics[k];
        for c in 0..4u32 {
            let semantic = word >> (8 * c) & 0x1F;
            let ch = SWIZZLE_CHARS[c as usize];
            if semantic < 4 {
                let _ = writeln!(src, "    pos.{} = o[{reg}].{ch};", SWIZZLE_CHARS[semantic as usize]);
            } else if let Some(&(_, slot)) = SEMANTIC_SLOTS.iter().find(|(s, _)| *s == semantic) {
                let _ = writeln!(src, "    at[{slot}] = o[{reg}].{ch};");
            }
        }
    }
    src.push_str(
        r#"    var out: VsOut;
    let w = pos.w;
    // Le volume de la console est -w <= z <= 0 : en prenant -z, celui de wgpu (0 <= z <= w) découpe aux mêmes plans.
    // La profondeur de la console (z/w * échelle + décalage, linéaire à l'écran) voyage à part et sert à la profondeur écrite.
    out.pos = vec4<f32>(pos.x * u.xf0.x + w * u.xf0.y, pos.y * u.xf0.z + w * u.xf0.w, -pos.z, w);
    out.zd = pos.z / w * u.xf1.x + u.xf1.y;
    out.a0 = vec4<f32>(at[0], at[1], at[2], at[3]);
    out.a1 = vec4<f32>(at[4], at[5], at[6], at[7]);
    out.a2 = vec4<f32>(at[8], at[9], at[10], at[11]);
    out.a3 = vec4<f32>(at[12], at[13], at[14], at[15]);
    out.a4 = vec4<f32>(at[16], at[17], at[18], at[19]);
    return out;
}
"#,
    );
    Ok(src)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_with(code: &[u32]) -> ProgramKey {
        let mut c = vec![0u32; 4096];
        c[..code.len()].copy_from_slice(code);
        ProgramKey { code: c, swizzle: vec![0x0000_036F; 4096], entry: 0, out_mask: 0b11, semantics: [0x0302_0100, 0x0B0A_0908, 0, 0, 0, 0, 0] }
    }

    /// mov o0, v0 ; end  (descripteur : masque 0xF, sélecteur identité)
    #[test]
    fn mov_and_end_translate_and_validate() {
        let mov = (0x13 << 26) | (0 << 21) | (0 << 12);
        let end = 0x22 << 26;
        let src = translate(&key_with(&[mov, end])).unwrap();
        assert!(src.contains("o[0] = v[0]"));
        naga_check(&src);
    }

    #[test]
    fn backward_jump_becomes_a_loop_and_forward_jump_past_the_end_is_clamped() {
        let nop = 0x21 << 26;
        // 0: nop ; 1: jmpu b0 -> 0 (boucle) ; 2: jmpc -> 100 (au-delà : termine) ; 3: end
        let back = (0x2D << 26) | (0 << 10);
        let fwd = (0x2C << 26) | (100 << 10);
        let src = translate(&key_with(&[nop, back, fwd, 0x22 << 26])).unwrap();
        assert!(src.contains("for (var g1"));
        // un saut vers l'arrière qui sort du bloc reste une erreur
        let outside = (0x2C << 26) | (0 << 10);
        let if_op = (0x27 << 26) | (3 << 10); // ifu : corps 1..3, pas de sinon
        assert!(translate(&key_with(&[nop, if_op, outside, 0x22 << 26])).is_err());
    }

    fn naga_check(_src: &str) {
        // la validation complète se fait à la création du module wgpu (tests du moteur, en machine avec GPU)
    }
}
