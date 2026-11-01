//! Le shader de géométrie du PICA (registre 0x229 : bits 0-1 égaux à 2). wgpu n'en a pas : le shader de sommets et celui de
//! géométrie tournent ici sur le processeur (port de `banc/pica/shader.py` et de `geometry_stage` dans `raster.py`), et les
//! triangles émis partent vers le GPU par un programme qui recopie ses entrées (`ProgramKey::passthrough`).

use crate::state::GpuState;
use crate::vertex::VertexData;

const MAX_STEPS: u32 = 200_000;

type Registers = [[f32; 4]; 16];

/// Un programme et ses constantes : l'unité des sommets, ou celle de la géométrie.
pub struct Program<'a> {
    pub code: &'a [u32],
    pub swizzle: &'a [u32],
    pub uniforms: &'a [[f32; 4]],
    pub bools: u32,
    pub ints: [[u32; 3]; 4],
    pub entry: u32,
}

#[derive(PartialEq, Clone, Copy)]
enum Flow {
    Next,
    Break,
    End,
}

/// La multiplication du PICA : zéro fois n'importe quoi (même l'infini) donne zéro.
fn multiply(a: f32, b: f32) -> f32 {
    let r = a * b;
    if r.is_nan() { 0.0 } else { r }
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| multiply(*x, *y)).sum()
}

struct Run<'a> {
    program: &'a Program<'a>,
    input: Registers,
    temporary: Registers,
    output: Registers,
    address: [i32; 2],
    loop_counter: i32,
    compare: [bool; 2],
    steps: u32,
    emit_vertex: usize,
    emit_primitive: bool,
    emit_flipped: bool,
    emit_buffer: [Registers; 3],
    /// Les triangles finis, avec « sens inverse » demandé ou non.
    emitted: Vec<([Registers; 3], bool)>,
}

impl<'a> Run<'a> {
    fn new(program: &'a Program<'a>, input: Registers) -> Self {
        Run {
            program,
            input,
            temporary: [[0.0; 4]; 16],
            output: [[0.0; 4]; 16],
            address: [0; 2],
            loop_counter: 0,
            compare: [false; 2],
            steps: 0,
            emit_vertex: 0,
            emit_primitive: false,
            emit_flipped: false,
            emit_buffer: [[[0.0; 4]; 16]; 3],
            emitted: Vec::new(),
        }
    }

    fn offset(&self, register: u32) -> i32 {
        match register {
            0 => 0,
            3 => self.loop_counter,
            r => self.address[r as usize - 1],
        }
    }

    /// Une source : (registre, décalage), puis le sélecteur et la négation du descripteur (`which` : 1, 2 ou 3).
    fn source(&self, index: u32, offset: i32, desc: u32, which: u32) -> [f32; 4] {
        let raw = if index < 0x20 {
            let slot = ((index & 15) as i32 + offset).clamp(0, 15) as usize;
            if index < 0x10 { self.input[slot] } else { self.temporary[slot] }
        } else {
            self.program.uniforms[(index as i32 - 0x20 + offset).clamp(0, 95) as usize]
        };
        let (shift, negate) = match which {
            1 => (5, desc >> 4 & 1),
            2 => (14, desc >> 13 & 1),
            _ => (23, desc >> 22 & 1),
        };
        let pick = |c: u32| raw[(desc >> (shift + 6 - 2 * c) & 3) as usize];
        let value = [pick(0), pick(1), pick(2), pick(3)];
        if negate != 0 { value.map(|v| -v) } else { value }
    }

    fn write(&mut self, dest: u32, mask: u32, value: [f32; 4]) {
        let target = if dest < 0x10 { &mut self.output } else { &mut self.temporary };
        for c in 0..4 {
            if mask & (8 >> c) != 0 {
                target[(dest & 15) as usize][c] = value[c];
            }
        }
    }

    fn condition(&self, instruction: u32) -> bool {
        let x = self.compare[0] == (instruction >> 25 & 1 != 0);
        let y = self.compare[1] == (instruction >> 24 & 1 != 0);
        match instruction >> 22 & 3 {
            0 => x || y,
            1 => x && y,
            2 => x,
            _ => y,
        }
    }

    fn bool_uniform(&self, instruction: u32) -> bool {
        self.program.bools >> (instruction >> 22 & 15) & 1 != 0
    }

    fn block(&mut self, mut pc: u32, end: u32) -> Flow {
        while pc < end && pc < 4096 {
            self.steps += 1;
            if self.steps > MAX_STEPS {
                return Flow::End;
            }
            let instruction = self.program.code[pc as usize];
            let op = instruction >> 26;
            if !(0x20..0x2E).contains(&op) {
                self.arithmetic(instruction, op);
                pc += 1;
                continue;
            }
            let dest = instruction >> 10 & 0xFFF;
            let count = instruction & 0xFF;
            match op {
                0x20 => return Flow::Break,
                0x22 => return Flow::End,
                0x23 if self.condition(instruction) => return Flow::Break,
                0x24..=0x26 => {
                    let taken = op == 0x24 || (op == 0x25 && self.condition(instruction)) || (op == 0x26 && self.bool_uniform(instruction));
                    if taken && self.block(dest, dest + count) == Flow::End {
                        return Flow::End;
                    }
                }
                0x27 | 0x28 => {
                    let taken = if op == 0x27 { self.bool_uniform(instruction) } else { self.condition(instruction) };
                    let flow = if taken { self.block(pc + 1, dest) } else { self.block(dest, dest + count) };
                    if flow != Flow::Next {
                        return flow;
                    }
                    pc = dest + count;
                    continue;
                }
                0x29 => {
                    let [x, y, z] = self.program.ints[(instruction >> 22 & 3) as usize];
                    for i in 0..=x {
                        self.loop_counter = (y + i * z & 0xFF) as i32;
                        match self.block(pc + 1, dest + 1) {
                            Flow::End => return Flow::End,
                            Flow::Break => break,
                            Flow::Next => {}
                        }
                    }
                    pc = dest + 1;
                    continue;
                }
                0x2A => self.emit(),
                0x2B => {
                    // bits lus sur le programme des particules : sommets 0, 1, 2 puis 0 (deux triangles, le second inversé)
                    self.emit_flipped = instruction >> 22 & 1 != 0;
                    self.emit_primitive = instruction >> 23 & 1 != 0;
                    self.emit_vertex = (instruction >> 24 & 3) as usize;
                }
                0x2C if self.condition(instruction) => {
                    pc = dest;
                    continue;
                }
                0x2D if self.bool_uniform(instruction) == (count & 1 == 0) => {
                    pc = dest;
                    continue;
                }
                _ => {}
            }
            pc += 1;
        }
        Flow::Next
    }

    /// EMIT : les registres de sortie vont dans le sommet choisi par le dernier SETEMIT.
    fn emit(&mut self) {
        if self.emit_vertex > 2 {
            return;
        }
        self.emit_buffer[self.emit_vertex] = self.output;
        if self.emit_primitive {
            self.emitted.push((self.emit_buffer, self.emit_flipped));
        }
    }

    fn arithmetic(&mut self, instruction: u32, op: u32) {
        if op >= 0x30 {
            // MAD et MADI : le deuxième ou le troisième opérande est le grand, et prend le décalage
            let desc = self.program.swizzle[(instruction & 0x1F) as usize];
            let src1 = instruction >> 17 & 0x1F;
            let offset = self.offset(instruction >> 22 & 3);
            let (src2, off2, src3, off3) = if op >= 0x38 {
                (instruction >> 10 & 0x7F, offset, instruction >> 5 & 0x1F, 0)
            } else {
                (instruction >> 12 & 0x1F, 0, instruction >> 5 & 0x7F, offset)
            };
            let (a, b, c) = (self.source(src1, 0, desc, 1), self.source(src2, off2, desc, 2), self.source(src3, off3, desc, 3));
            let value = std::array::from_fn(|i| multiply(a[i], b[i]) + c[i]);
            self.write(instruction >> 24 & 0x1F, desc & 15, value);
            return;
        }
        let desc = self.program.swizzle[(instruction & 0x7F) as usize];
        let offset = self.offset(instruction >> 19 & 3);
        let dest = instruction >> 21 & 0x1F;
        let mask = desc & 15;
        let (src1, off1, src2, off2) = if (0x18..=0x1B).contains(&op) {
            (instruction >> 14 & 0x1F, 0, instruction >> 7 & 0x7F, offset)
        } else {
            (instruction >> 12 & 0x7F, offset, instruction >> 7 & 0x1F, 0)
        };
        let a = self.source(src1, off1, desc, 1);
        let b = self.source(src2, off2, desc, 2);
        let each = |f: &dyn Fn(f32, f32) -> f32| -> [f32; 4] { std::array::from_fn(|i| f(a[i], b[i])) };
        let step = |taken: bool| if taken { 1.0 } else { 0.0 };
        let value = match op {
            0x00 => each(&|x, y| x + y),
            0x01 => [dot(&a[..3], &b[..3]); 4],
            0x02 => [dot(&a, &b); 4],
            0x03 | 0x18 => [dot(&a[..3], &b[..3]) + b[3]; 4],
            0x04 | 0x19 => [1.0, multiply(a[1], b[1]), a[2], b[3]],
            0x05 => [a[0].exp2(); 4],
            0x06 => [a[0].log2(); 4],
            0x08 => each(&multiply),
            0x09 | 0x1A => each(&|x, y| step(x >= y)),
            0x0A | 0x1B => each(&|x, y| step(x < y)),
            0x0B => a.map(f32::floor),
            0x0C => each(&f32::max),
            0x0D => each(&f32::min),
            0x0E => [1.0 / a[0]; 4],
            0x0F => [1.0 / a[0].sqrt(); 4],
            0x13 => a,
            0x12 => {
                for c in 0..2 {
                    if mask & (8 >> c) != 0 {
                        self.address[c] = (if a[c].is_nan() { 0.0 } else { a[c] }).trunc().clamp(-128.0, 127.0) as i32;
                    }
                }
                return;
            }
            0x2E | 0x2F => {
                let compare = |function: u32, x: f32, y: f32| match function {
                    0 => x == y,
                    1 => x != y,
                    2 => x < y,
                    3 => x <= y,
                    4 => x > y,
                    5 => x >= y,
                    _ => true,
                };
                self.compare = [compare(instruction >> 24 & 7, a[0], b[0]), compare(instruction >> 21 & 7, a[1], b[1])];
                return;
            }
            _ => return,
        };
        self.write(dest, mask, value);
    }
}

fn int_registers(regs: &[u32], base: usize) -> [[u32; 3]; 4] {
    std::array::from_fn(|k| {
        let w = regs[base + k];
        [w & 0xFF, w >> 8 & 0xFF, w >> 16 & 0xFF]
    })
}

/// Les registres de sortie allumés d'un masque.
fn slots(mask: u32) -> Vec<usize> {
    (0..16).filter(|r| mask >> r & 1 != 0).collect()
}

/// Les triangles d'un dessin passé par le shader de géométrie, ou la raison pour laquelle il n'y en a pas. Les sommets rendus
/// ont 16 registres, ceux de sortie du shader de géométrie.
pub fn run(state: &GpuState, vertices: &VertexData) -> Result<VertexData, &'static str> {
    let regs = &state.regs;
    let vertex_program = Program {
        code: &state.code,
        swizzle: &state.swizzle,
        uniforms: &state.uniforms,
        bools: regs[0x2B0] & 0xFFFF,
        ints: int_registers(regs, 0x2B1),
        entry: regs[0x2BA] & 0xFFFF,
    };
    let unique = vertices.inputs.len() / vertices.stride.max(1);
    let outputs: Vec<Registers> = (0..unique)
        .map(|k| {
            let mut input = [[0.0, 0.0, 0.0, 1.0]; 16];
            input[..vertices.stride].copy_from_slice(&vertices.inputs[k * vertices.stride..(k + 1) * vertices.stride]);
            let mut run = Run::new(&vertex_program, input);
            run.block(vertex_program.entry, 4096);
            run.output
        })
        .collect();

    // les sorties des sommets, tassées selon 0x2BD, puis groupées selon le mode (0x252)
    let packed = slots(regs[0x2BD] & 0xFFFF);
    let mode = regs[0x252] & 0xFF;
    let (group, per_vertex) = match mode {
        0 => (1, packed.len()),
        2 => (((regs[0x252] >> 8 & 15) + 1) as usize, ((regs[0x252] >> 12 & 15) + 1) as usize),
        _ => return Err("shader de géométrie en mode primitive variable : dessin sauté"),
    };
    let per_vertex = per_vertex.min(packed.len());
    let separate = regs[0x244] & 1 != 0;
    let geometry_program = Program {
        code: if separate { &state.geometry.code } else { &state.code },
        swizzle: if separate { &state.geometry.swizzle } else { &state.swizzle },
        uniforms: if separate { &state.geometry.uniforms } else { &state.uniforms },
        bools: if separate { regs[0x280] & 0xFFFF } else { regs[0x2B0] & 0xFFFF },
        ints: if separate { int_registers(regs, 0x281) } else { int_registers(regs, 0x2B1) },
        entry: regs[0x28A] & 0xFFFF,
    };
    let permutation = regs[0x28B] as u64 | (regs[0x28C] as u64) << 32;
    let wanted = (regs[0x289] & 15) as usize + 1;
    let mut inputs = Vec::new();
    let mut triangles = Vec::new();
    for vertices_of_group in vertices.order.chunks_exact(group) {
        let (packed, outputs) = (&packed, &outputs);
        let attributes = vertices_of_group.iter().flat_map(|&v| packed[..per_vertex].iter().map(move |&slot| outputs[v as usize][slot]));
        let mut input = [[0.0, 0.0, 0.0, 1.0]; 16];
        for (a, value) in attributes.take(wanted).enumerate() {
            input[(permutation >> (4 * a) & 15) as usize] = value;
        }
        let mut run = Run::new(&geometry_program, input);
        run.block(geometry_program.entry, 4096);
        for (triangle, flipped) in &run.emitted {
            let first = (inputs.len() / 16) as u32;
            inputs.extend(triangle.iter().flatten().copied());
            let order = if *flipped { [first + 1, first, first + 2] } else { [first, first + 1, first + 2] };
            triangles.extend_from_slice(&order);
        }
    }
    Ok(VertexData { stride: 16, order: Vec::new(), inputs, triangles, notes: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOV: u32 = 0x13 << 26;
    const END: u32 = 0x22 << 26;
    /// Masque complet, et les trois sources sans sélecteur ni négation.
    const IDENTITY: u32 = 0xF | 0x1B << 5 | 0x1B << 14 | 0x1B << 23;

    fn mov(dest: u32, source: u32) -> u32 {
        MOV | dest << 21 | source << 12
    }

    fn setemit(vertex: u32, primitive: bool, flipped: bool) -> u32 {
        0x2B << 26 | vertex << 24 | (primitive as u32) << 23 | (flipped as u32) << 22
    }

    const EMIT: u32 = 0x2A << 26;

    fn execute(code: &[u32], uniforms: &[[f32; 4]], input: Registers) -> Registers {
        let mut full = vec![0; 4096];
        full[..code.len()].copy_from_slice(code);
        let mut swizzle = vec![0; 4096];
        swizzle[0] = IDENTITY;
        let mut all = vec![[0.0; 4]; 96];
        all[..uniforms.len()].copy_from_slice(uniforms);
        let program = Program { code: &full, swizzle: &swizzle, uniforms: &all, bools: 0, ints: [[0; 3]; 4], entry: 0 };
        let mut run = Run::new(&program, input);
        run.block(0, 4096);
        run.output
    }

    #[test]
    fn mov_add_and_mad_compute() {
        let mut input = [[0.0; 4]; 16];
        input[0] = [1.0, 2.0, 3.0, 4.0];
        let out = execute(&[mov(0, 0), END], &[], input);
        assert_eq!(out[0], [1.0, 2.0, 3.0, 4.0]);
        // mad o1, v0, c0, v0 : (décodage du format long, src2 = c0 = 0x20)
        let mad = 0x38 << 26 | 1 << 24 | 0 << 17 | 0x20 << 10 | 0 << 5;
        let out = execute(&[mad, END], &[[2.0, 2.0, 2.0, 2.0]], input);
        assert_eq!(out[1], [3.0, 6.0, 9.0, 12.0]);
    }

    #[test]
    fn zero_times_infinity_is_zero() {
        assert_eq!(multiply(0.0, f32::INFINITY), 0.0);
    }

    fn state_with_shader(vertex_outputs: u32) -> GpuState {
        let mut state = GpuState::new();
        state.swizzle[0] = IDENTITY;
        // le programme des sommets à 0, celui de géométrie à 8, dans l'unité partagée (0x244 bit 0 nul)
        let code = [mov(0, 0), END];
        state.code[..2].copy_from_slice(&code);
        state.regs[0x2BD] = vertex_outputs;
        state.regs[0x28A] = 8;
        state.regs[0x28B] = 0x10;
        state
    }

    #[test]
    fn one_input_makes_a_quad_of_two_triangles() {
        let mut state = state_with_shader(1);
        let body = [
            mov(0, 0),
            setemit(0, false, false),
            EMIT,
            setemit(1, false, false),
            EMIT,
            setemit(2, true, false),
            EMIT,
            setemit(0, true, true),
            EMIT,
            END,
        ];
        state.code[8..8 + body.len()].copy_from_slice(&body);
        state.regs[0x252] = 0; // une exécution par sommet
        let vertices = VertexData { stride: 1, inputs: vec![[5.0, 6.0, 7.0, 8.0]], order: vec![0], triangles: Vec::new(), notes: Vec::new() };
        let out = run(&state, &vertices).unwrap();
        assert_eq!(out.stride, 16);
        assert_eq!(out.triangles, vec![0, 1, 2, 4, 3, 5]);
        assert_eq!(out.inputs.len(), 6 * 16);
        assert_eq!(out.inputs[0], [5.0, 6.0, 7.0, 8.0]);
    }

    #[test]
    fn fixed_primitive_gives_all_vertices_of_the_group_to_one_run() {
        let mut state = state_with_shader(1);
        // le shader recopie la deuxième entrée (v1) : le deuxième sommet du groupe
        let body = [mov(0, 1), setemit(0, false, false), EMIT, setemit(1, false, false), EMIT, setemit(2, true, false), EMIT, END];
        state.code[8..8 + body.len()].copy_from_slice(&body);
        state.regs[0x252] = 2 | 1 << 8; // 2 sommets par groupe, 1 attribut par sommet
        state.regs[0x289] = 1; // deux entrées
        let vertices = VertexData {
            stride: 1,
            inputs: vec![[1.0; 4], [2.0; 4], [3.0; 4], [4.0; 4]],
            order: vec![0, 1, 2, 3],
            triangles: Vec::new(),
            notes: Vec::new(),
        };
        let out = run(&state, &vertices).unwrap();
        assert_eq!(out.triangles.len(), 6, "une exécution par groupe");
        assert_eq!(out.inputs[0], [2.0; 4]);
        assert_eq!(out.inputs[3 * 16], [4.0; 4]);
    }

    #[test]
    fn variable_primitive_is_reported() {
        let mut state = state_with_shader(1);
        state.regs[0x252] = 1;
        let vertices = VertexData { stride: 1, inputs: vec![[1.0; 4]], order: vec![0], triangles: Vec::new(), notes: Vec::new() };
        assert!(run(&state, &vertices).is_err());
    }
}
