//! Test de bout en bout avec une capture fabriquée : un triangle rouge dessiné par un vrai shader de sommets PICA
//! (`mov o0, v0 ; mov o1, v1 ; end`), puis relu dans la mémoire du jeu. Se saute s'il n'y a pas de GPU Vulkan.

use capture::{Capture, Command, Region};
use pica::Pica;

fn f24(value: f32) -> u32 {
    // seuls les cas utilisés ici : puissances de deux
    let bits = value.to_bits();
    let exponent = ((bits >> 23) & 0xFF) as i32 - 64;
    ((bits >> 31) << 23) | ((exponent as u32) << 16) | ((bits >> 7) & 0xFFFF)
}

fn list(pairs: &[(u32, u32)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (value, header) in pairs {
        out.extend_from_slice(&value.to_le_bytes());
        out.extend_from_slice(&header.to_le_bytes());
    }
    out
}

fn build() -> Capture {
    build_with(&[])
}

/// La capture de base ; `extra` : registres de plus à écrire.
fn build_with(extra: &[(usize, u32)]) -> Capture {
    let mut c = Capture::default();
    let mut set = |reg: usize, value: u32| {
        c.regs[reg] = value;
        c.seen[reg] = 1;
    };
    set(0x200, 0x2000_0000 >> 3);
    set(0x201, 0xFF);
    set(0x202, 0x1000_0000);
    set(0x203, 0x1000);
    set(0x204, 0x10);
    set(0x205, 0x2020_0000);
    set(0x2BB, 0x10);
    set(0x2BD, 0b11);
    set(0x50, 0x0302_0100);
    set(0x51, 0x0B0A_0908);
    set(0x41, f24(8.0));
    set(0x43, f24(8.0));
    set(0x4D, f24(-1.0)); // profondeur = -z / w : z = -0.5 donne 0,5
    set(0x11D, 0x2001_0000 >> 3);
    set(0x11E, 16 | (15 << 12));
    set(0x228, 3);
    for &(reg, value) in extra {
        c.regs[reg] = value;
        c.seen[reg] = 1;
    }
    c.code[0] = (0x13 << 26) | (0 << 21) | (0 << 12);
    c.code[1] = (0x13 << 26) | (1 << 21) | (1 << 12);
    c.code[2] = 0x22 << 26;
    c.swizzle[0] = 0x36F;
    let mut memory = vec![0u8; 0x1000 + 96];
    let vertices: [[f32; 8]; 3] = [
        [-1.0, -1.0, -0.5, 1.0, 1.0, 0.0, 0.0, 1.0],
        [1.0, -1.0, -0.5, 1.0, 1.0, 0.0, 0.0, 1.0],
        [-1.0, 1.0, -0.5, 1.0, 1.0, 0.0, 0.0, 1.0],
    ];
    for (i, v) in vertices.iter().enumerate() {
        for (k, f) in v.iter().enumerate() {
            let at = 0x1000 + i * 32 + k * 4;
            memory[at..at + 4].copy_from_slice(&f.to_le_bytes());
        }
    }
    c.regions.push(Region { address: 0x1400_0000, data: memory });
    c.regions.push(Region { address: 0x1401_0000, data: vec![0u8; 0x1000] });
    c.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: list(&[(1, 0x000F_0000 | 0x22E), (0, 0)]) });
    c
}

fn run(capture: &Capture) -> Option<Pica> {
    let mut pica = Pica::new(capture, 1).ok()?;
    for command in &capture.commands {
        pica.run_command(command).unwrap();
    }
    pica.finish();
    Some(pica)
}

fn pixel(pica: &Pica, x: usize, y: usize) -> [u8; 4] {
    let raw = pica.memory.read(0x1401_0000, 16 * 16 * 4).unwrap().into_owned();
    let linear = formats::tiled_to_linear(&raw, 16, 16, 4);
    let rgba = formats::decode_pixels(formats::ColorFormat::Rgba8, &linear);
    let at = (y * 16 + x) * 4;
    [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]]
}

#[test]
fn triangle_is_drawn_and_written_back() {
    let capture = build();
    let mut pica = match Pica::new(&capture, 1) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("test sauté : pas de GPU Vulkan ({e})");
            return;
        }
    };
    for command in &capture.commands {
        pica.run_command(command).unwrap();
    }
    pica.finish();
    assert_eq!(pica.renderer.stats.draws, 1, "notes : {:?}", pica.renderer.notes);
    assert_eq!(pixel(&pica, 1, 14), [255, 0, 0, 255], "bas gauche : dans le triangle");
    assert_eq!(pixel(&pica, 14, 1), [0, 0, 0, 0], "haut droite : hors du triangle");
}

#[test]
fn scaled_rendering_gives_a_bigger_image() {
    let capture = build();
    let Ok(mut pica) = Pica::new(&capture, 3) else { return };
    for command in &capture.commands {
        pica.run_command(command).unwrap();
    }
    let (data, rows) = pica.renderer.color_image(0x1401_0000, 16).expect("tampon vivant");
    assert_eq!(rows, 16);
    assert_eq!(data.len(), 48 * 48 * 4);
    let at = (45 * 48 + 2) * 4; // bas gauche à l'échelle 3
    assert_eq!(&data[at..at + 4], &[255, 0, 0, 255]);
    let at = (2 * 48 + 45) * 4; // haut droite
    assert_eq!(&data[at..at + 4], &[0, 0, 0, 0]);
}

#[test]
fn logic_op_xor_reads_the_buffer_before() {
    // opération 11 (xor), sans mélange : rouge opaque xor le tampon d'avant (0x0F partout)
    let mut capture = build_with(&[(0x102, 11)]);
    capture.regions[1].data = vec![0x0F; 0x1000];
    let Some(pica) = run(&capture) else { return };
    // RGBA8 en mémoire : A B G R ; le tampon d'avant vaut R=G=B=A=0x0F
    assert_eq!(pixel(&pica, 1, 14), [255 ^ 0x0F, 0x0F, 0x0F, 255 ^ 0x0F], "notes : {:?}", pica.renderer.notes);
    assert_eq!(pixel(&pica, 14, 1), [0x0F; 4], "hors du triangle : inchangé");
}

fn with_stencil(reference: u32) -> Capture {
    // tampon D24S8 de 16 x 16 à 0x14020000, pochoir 1 partout ; test « égal » avec la référence donnée
    let mut capture = build_with(&[
        (0x11C, 0x2002_0000 >> 3),
        (0x116, 3),
        (0x105, 1 | (2 << 4) | (reference << 16) | (0xFF << 24)),
        (0x106, 0),
    ]);
    let mut depth = vec![0u8; 0x1000];
    for p in 0..256 {
        depth[p * 4..p * 4 + 4].copy_from_slice(&[0xFF, 0xFF, 0xFF, 0x01]);
    }
    capture.regions.push(Region { address: 0x1402_0000, data: depth });
    capture
}

#[test]
fn stencil_test_passes_and_fails() {
    let Some(pass) = run(&with_stencil(1)) else { return };
    if !pass.renderer.notes.is_empty() && pass.renderer.notes.keys().any(|k| k.contains("pochoir demandé")) {
        eprintln!("test sauté : pas de Depth32FloatStencil8");
        return;
    }
    assert_eq!(pixel(&pass, 1, 14), [255, 0, 0, 255], "référence 1 : le pochoir passe");
    let fail = run(&with_stencil(2)).unwrap();
    assert_eq!(pixel(&fail, 1, 14), [0, 0, 0, 0], "référence 2 : le pochoir échoue");
}

#[test]
fn constant_blend_factor_is_exact_for_alpha_and_color() {
    // source * couleur constante + destination * (1 - alpha constant) ; constante = (0.5, 0, 0, 0.5)
    // blend 0x100 bit 8 ; équation ajout ; facteurs : source 10 (constante), destination 13 (1 - alpha constant)
    let config = (13u32 << 20) | (10 << 16) | (13 << 28) | (10 << 24);
    let mut capture = build_with(&[(0x100, 1 << 8), (0x101, config), (0x103, 0x8000_0080)]);
    capture.regions[1].data = vec![0x80; 0x1000]; // destination 0x80 partout
    let Some(pica) = run(&capture) else { return };
    let p = pixel(&pica, 1, 14);
    // source rouge (1, 0, 0, 1) : r = 1*0.502 + 0.502*(1-0.502) = 0.753 ; g = 0 + 0.502*0.498 = 0.25 ; a = 1*0.502 + 0.502*0.498 = 0.753
    let near = |a: u8, b: f32| (a as f32 - b * 255.0).abs() <= 2.0;
    assert!(near(p[0], 0.7530) && near(p[1], 0.2500) && near(p[2], 0.2500) && near(p[3], 0.7530), "{p:?}");
}
