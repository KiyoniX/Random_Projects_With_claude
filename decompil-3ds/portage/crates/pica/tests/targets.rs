//! Tests de bout en bout des tampons de rendu relus comme textures et des transferts vers l'écran paresseux, avec des
//! captures fabriquées. Se sautent s'il n'y a pas de GPU Vulkan.
//!
//! La scène : un triangle rouge dessiné dans le tampon A (16 x 16, RGBA8), puis un triangle texturé par A dessiné dans
//! le tampon B. Le jeu relit A comme texture RGBA8 de même adresse et de mêmes dimensions.

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

fn write(reg: u32, value: u32) -> (u32, u32) {
    (value, 0x000F_0000 | reg)
}

const A: u32 = 0x1401_0000;
const B: u32 = 0x1403_0000;

fn put_floats(memory: &mut [u8], at: usize, values: &[f32]) {
    for (k, f) in values.iter().enumerate() {
        memory[at + k * 4..at + k * 4 + 4].copy_from_slice(&f.to_le_bytes());
    }
}

/// `sample_uv` : les coordonnées de texture des trois sommets du second triangle.
fn build(sample_uv: [[f32; 2]; 3]) -> Capture {
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
    set(0x4D, f24(-1.0));
    set(0x11D, 0x2001_0000 >> 3);
    set(0x11E, 16 | (15 << 12));
    set(0x228, 3);
    // le programme de sommets : o0 = v0, o1 = v1, o2 = v2
    c.code[0] = (0x13 << 26) | (0 << 21) | (0 << 12);
    c.code[1] = (0x13 << 26) | (1 << 21) | (1 << 12);
    c.code[2] = (0x13 << 26) | (2 << 21) | (2 << 12);
    c.code[3] = 0x22 << 26;
    c.swizzle[0] = 0x36F;
    let mut memory = vec![0u8; 0x3000];
    // le triangle rouge, en bas à gauche
    let red: [[f32; 8]; 3] = [
        [-1.0, -1.0, -0.5, 1.0, 1.0, 0.0, 0.0, 1.0],
        [1.0, -1.0, -0.5, 1.0, 1.0, 0.0, 0.0, 1.0],
        [-1.0, 1.0, -0.5, 1.0, 1.0, 0.0, 0.0, 1.0],
    ];
    for (i, v) in red.iter().enumerate() {
        put_floats(&mut memory, 0x1000 + i * 32, v);
    }
    // le triangle texturé : position, couleur, coordonnées de texture (40 octets par sommet)
    let corners = [[-1.0f32, -1.0], [1.0, -1.0], [-1.0, 1.0]];
    for i in 0..3 {
        let v = [corners[i][0], corners[i][1], -0.5, 1.0, 1.0, 1.0, 1.0, 1.0, sample_uv[i][0], sample_uv[i][1]];
        put_floats(&mut memory, 0x2000 + i * 40, &v);
    }
    c.regions.push(Region { address: 0x1400_0000, data: memory });
    c.regions.push(Region { address: A, data: vec![0u8; 0x1000] });
    c.regions.push(Region { address: B, data: vec![0u8; 0x1000] });
    let mut pairs = vec![write(0x22E, 1), (0, 0)];
    // le second dessin : vers B, trois attributs, la texture 0 lit A, un étage qui prend la texture
    pairs.extend([
        write(0x11D, 0x2003_0000 >> 3),
        write(0x201, 0x7FF),
        write(0x202, 0x2000_0000),
        write(0x203, 0x2000),
        write(0x204, 0x210),
        write(0x205, 0x3028_0000),
        write(0x2BB, 0x210),
        write(0x2BD, 0b111),
        write(0x52, 0x1F1F_0D0C),
        write(0x80, 1),
        write(0x82, (16 << 16) | 16),
        write(0x83, 0),
        write(0x85, 0x2001_0000 >> 3),
        write(0x8E, 0),
        write(0xC0, 0x0003_0003), // couleur et alpha : la texture 0 (les autres sources ne servent pas)
        write(0xC1, 0),
        write(0xC2, 0),
        write(0x22E, 1),
        (0, 0),
    ]);
    c.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: list(&pairs) });
    c
}

fn replay(capture: &Capture, scale: u32, live: bool) -> Option<Pica> {
    let mut pica = Pica::new(capture, scale).ok()?;
    pica.renderer.live_textures = live;
    for command in &capture.commands {
        pica.run_command(command);
    }
    Some(pica)
}

fn tiles(pica: &Pica, address: u32) -> Vec<u8> {
    let raw = pica.memory.read(address, 16 * 16 * 4).unwrap().into_owned();
    formats::decode_pixels(formats::ColorFormat::Rgba8, &formats::tiled_to_linear(&raw, 16, 16, 4))
}

#[test]
fn live_color_target_as_texture_matches_the_memory_path() {
    // les coordonnées varient d'un sommet à l'autre : chaque point de B lit un point différent de A
    let capture = build([[0.05, 0.95], [0.95, 0.95], [0.05, 0.05]]);
    let Some(mut live) = replay(&capture, 1, true) else { return };
    let mut memory_path = replay(&capture, 1, false).unwrap();
    live.finish();
    memory_path.finish();
    assert!(live.renderer.stats.live_textures > 0, "A doit servir de texture sans passer par la mémoire : {:?}", live.renderer.stats);
    assert_eq!(memory_path.renderer.stats.live_textures, 0);
    assert_eq!(tiles(&live, B), tiles(&memory_path, B), "à l'échelle 1 le résultat est celui de la mémoire, octet pour octet");
    // et B n'est pas vide : le rouge de A y est passé
    let b = tiles(&live, B);
    assert!(b.chunks_exact(4).any(|p| p == [255, 0, 0, 255]), "du rouge dans B");
}

#[test]
fn live_color_target_as_texture_is_sharper_when_scaled() {
    let capture = build([[0.05, 0.95], [0.95, 0.95], [0.05, 0.05]]);
    let Some(live) = replay(&capture, 3, true) else { return };
    assert!(live.renderer.stats.live_textures > 0);
    let mut live = live;
    let (image, rows) = live.renderer.color_image(B, 16).expect("B est vivant");
    assert_eq!(rows, 16);
    assert_eq!(image.len(), 48 * 48 * 4);
    // à l'échelle 3 la diagonale de A (16 points) est reprise à la définition de A : plus de marches que sur 16 points
    let edge = |row: usize| (0..48).filter(|&x| image[(row * 48 + x) * 4 + 3] != 0).count();
    let counts: Vec<usize> = (0..48).map(edge).collect();
    assert!(counts.windows(2).filter(|w| w[0] != w[1]).count() > 16, "la diagonale a plus de 16 marches : {counts:?}");
}

#[test]
fn deferred_display_transfer_writes_the_same_memory_as_the_eager_one() {
    // un transfert vers l'écran de A (RGBA8 vers RGB8) après le rendu
    let mut capture = build([[0.05, 0.95], [0.95, 0.95], [0.05, 0.05]]);
    // 16 x 16 vers 16 x 16, format d'entrée RGBA8 (0), de sortie RGB8 (1), sans retournement
    capture.regions.push(Region { address: 0x1405_0000, data: vec![0x55u8; 0x1000] });
    capture.commands.push(Command { words: [3, A, 0x1405_0000, 0x0010_0010, 0x0010_0010, 0x1000, 0, 0], data: Vec::new() });
    let run = |eager: bool, scale: u32| -> Option<(u32, usize, Vec<u8>)> {
        let mut pica = Pica::new(&capture, scale).ok()?;
        pica.eager_transfers = eager;
        let mut image = None;
        for command in &capture.commands {
            if let Some(i) = pica.run_command(command) {
                image = Some(i);
            }
        }
        let deferred = pica.renderer.stats.deferred as usize;
        pica.finish();
        let image = image.expect("une image");
        Some((pica.memory.checksum(), deferred, image.rgba))
    };
    for scale in [1, 2] {
        let Some((lazy_crc, deferred, lazy_image)) = run(false, scale) else { return };
        let (eager_crc, eager_deferred, eager_image) = run(true, scale).unwrap();
        assert_eq!(deferred, 1, "le transfert est remis à plus tard");
        assert_eq!(eager_deferred, 0);
        assert_eq!(lazy_crc, eager_crc, "échelle {scale} : la mémoire finale est la même, octet pour octet");
        assert_eq!(lazy_image, eager_image, "échelle {scale} : l'image de l'écran est la même");
    }
}

#[test]
fn deferred_display_transfer_is_written_before_the_game_reads_it() {
    let mut capture = build([[0.05, 0.95], [0.95, 0.95], [0.05, 0.05]]);
    capture.regions.push(Region { address: 0x1405_0000, data: vec![0x55u8; 0x1000] });
    capture.regions.push(Region { address: 0x1406_0000, data: vec![0u8; 0x1000] });
    capture.commands.push(Command { words: [3, A, 0x1405_0000, 0x0010_0010, 0x0010_0010, 0x1000, 0, 0], data: Vec::new() });
    // commande 0 : copie de la destination du transfert ailleurs (elle lit la mémoire que le transfert écrit)
    capture.commands.push(Command { words: [0, 0x1405_0000, 0x1406_0000, 16 * 16 * 3, 0, 0, 0, 0], data: Vec::new() });
    let Some(mut pica) = replay(&capture, 2, true) else { return };
    pica.finish();
    let copied = pica.memory.read(0x1406_0000, 16 * 16 * 3).unwrap().into_owned();
    assert!(copied.iter().any(|&b| b != 0 && b != 0x55), "la copie lit l'image du transfert, pas l'ancien contenu : {:?}", &copied[..12]);
    assert!(pica.renderer.stats.materialized >= 1);
}

#[test]
fn live_depth_as_rgba_texture_matches_the_memory_path() {
    // le premier dessin écrit la profondeur 0,5 dans un tampon D24S8 de 16 x 16 ; le second lit ce tampon comme une
    // texture RGBA8 de mêmes dimensions (le jeu s'en sert pour ses ombres)
    let mut capture = build([[0.05, 0.95], [0.95, 0.95], [0.05, 0.05]]);
    capture.regs[0x11C] = 0x2002_0000 >> 3;
    capture.seen[0x11C] = 1;
    capture.regs[0x116] = 3;
    capture.seen[0x116] = 1;
    capture.regs[0x107] = 0x1F11; // test toujours vrai, écriture de la profondeur, couleurs écrites
    capture.seen[0x107] = 1;
    capture.regions.push(Region { address: 0x1402_0000, data: vec![0u8; 0x1000] });
    let mut pairs = vec![write(0x22E, 1), (0, 0)];
    pairs.extend([
        write(0x11C, 0),
        write(0x11D, 0x2003_0000 >> 3),
        write(0x201, 0x7FF),
        write(0x202, 0x2000_0000),
        write(0x203, 0x2000),
        write(0x204, 0x210),
        write(0x205, 0x3028_0000),
        write(0x2BB, 0x210),
        write(0x2BD, 0b111),
        write(0x52, 0x1F1F_0D0C),
        write(0x80, 1),
        write(0x82, (16 << 16) | 16),
        write(0x83, 0),
        write(0x85, 0x2002_0000 >> 3),
        write(0x8E, 0),
        write(0xC0, 0x0003_0003),
        write(0xC1, 0),
        write(0xC2, 0),
        write(0x22E, 1),
        (0, 0),
    ]);
    capture.commands[0].data = list(&pairs);
    let Some(mut live) = replay(&capture, 1, true) else { return };
    let mut memory_path = replay(&capture, 1, false).unwrap();
    live.finish();
    memory_path.finish();
    assert!(memory_path.renderer.notes.keys().all(|k| !k.contains("introuvable")), "{:?}", memory_path.renderer.notes);
    assert_eq!(tiles(&live, B), tiles(&memory_path, B), "notes : {:?}", live.renderer.notes);
    // 0,5 en 24 bits : 0x800000, soit les octets de profondeur 00 00 80 et un pochoir nul ; vu comme RGBA8 : (0, 128, 0, 0)
    let b = tiles(&live, B);
    assert!(b.chunks_exact(4).any(|p| p[1] == 0x80), "la profondeur est lue : {:?}", &b[..16]);
    if live.renderer.stats.live_textures == 0 {
        eprintln!("(pas de Depth32FloatStencil8 : la conversion sur le GPU n'a pas servi)");
    }
}

#[test]
fn changed_vertex_memory_is_decoded_again() {
    // dessin, puis réécriture des couleurs des sommets par une copie, puis le même dessin : l'image doit suivre la mémoire
    let mut capture = build([[0.0, 0.0]; 3]);
    capture.commands.clear();
    let draw = list(&[write(0x22E, 1), (0, 0)]);
    capture.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: draw.clone() });
    // trois sommets verts de 32 octets à 0x14002800 (copie dans le tampon de sommets, à 0x14001000)
    let mut green = vec![0u8; 96];
    for i in 0..3 {
        let v = [if i == 1 { 1.0f32 } else { -1.0 }, if i == 2 { 1.0 } else { -1.0 }, -0.5, 1.0, 0.0, 1.0, 0.0, 1.0];
        put_floats(&mut green, i * 32, &v);
    }
    capture.regions.push(Region { address: 0x1400_5000, data: green });
    capture.commands.push(Command { words: [0, 0x1400_5000, 0x1400_1000, 96, 0, 0, 0, 0], data: Vec::new() });
    capture.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: draw });
    // le premier dessin lit les sommets rouges du tampon 0x14001000 (le décalage 0x1000 de `build`)
    let Some(mut pica) = replay(&capture, 1, true) else { return };
    pica.finish();
    assert_eq!(pica.renderer.stats.draws, 2);
    assert_eq!(pica.renderer.stats.mesh_hits, 0, "la mémoire a changé : pas de réutilisation");
    let at = (14 * 16 + 1) * 4;
    assert_eq!(&tiles(&pica, A)[at..at + 4], &[0, 255, 0, 255], "le second dessin est vert");
}

#[test]
fn identical_redraw_reuses_the_decoded_vertices() {
    let mut capture = build([[0.0, 0.0]; 3]);
    capture.commands.clear();
    let draw = list(&[write(0x22E, 1), (0, 0)]);
    capture.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: draw.clone() });
    capture.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: draw });
    let Some(mut pica) = replay(&capture, 1, true) else { return };
    pica.finish();
    assert_eq!(pica.renderer.stats.draws, 2);
    assert_eq!(pica.renderer.stats.mesh_hits, 1);
}

#[test]
fn second_transfer_to_the_same_destination_replaces_the_first() {
    let mut capture = build([[0.05, 0.95], [0.95, 0.95], [0.05, 0.05]]);
    capture.regions.push(Region { address: 0x1405_0000, data: vec![0x55u8; 0x1000] });
    for _ in 0..2 {
        capture.commands.push(Command { words: [3, A, 0x1405_0000, 0x0010_0010, 0x0010_0010, 0x1000, 0, 0], data: Vec::new() });
    }
    let Some(mut pica) = replay(&capture, 1, true) else { return };
    assert_eq!(pica.renderer.stats.deferred, 2);
    assert_eq!(pica.renderer.stats.dropped, 1, "le premier transfert n'a jamais été lu : il est abandonné");
    pica.finish();
    assert_eq!(pica.renderer.stats.materialized, 1);
}

#[test]
fn many_draws_with_tiny_buffers_give_the_same_image() {
    // beaucoup de dessins identiques : les grands tampons se remplissent, l'envoi part, ils repartent de zéro, et le
    // tampon des sommets est agrandi (un dessin de 96 octets dans un tampon de 64)
    let mut capture = build([[0.0, 0.0]; 3]);
    capture.commands.clear();
    let draw = list(&[write(0x22E, 1), (0, 0)]);
    for _ in 0..40 {
        capture.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: draw.clone() });
    }
    let Some(mut normal) = replay(&capture, 1, true) else { return };
    normal.finish();
    let mut tiny = Pica::new(&capture, 1).unwrap();
    tiny.renderer.set_arena_sizes(0, 64, 4);
    for command in &capture.commands {
        tiny.run_command(command);
    }
    tiny.finish();
    assert_eq!(tiny.renderer.stats.draws, 40);
    assert_eq!(tiles(&tiny, A), tiles(&normal, A));
    assert_eq!(tiny.memory.checksum(), normal.memory.checksum());
}

/// A -> X par un transfert de copie (RGBA8 vers RGB565, en tuiles, retourné), puis un dessin lit X comme texture RGB565.
fn render_to_texture_capture() -> Capture {
    let mut capture = build([[0.05, 0.95], [0.95, 0.95], [0.05, 0.05]]);
    let x = 0x1405_0000u32;
    capture.regions.push(Region { address: x, data: vec![0x55u8; 0x1000] });
    let data = capture.commands[0].data.clone();
    let (first, rest) = data.split_at(16); // le premier dessin, puis la préparation du second
    let mut rest = rest.to_vec();
    // la texture 0 lit X, au format RGB565 (3), au lieu de A au format RGBA8
    let mut pairs = Vec::new();
    for pair in rest.chunks_exact(8) {
        let (value, header) = (u32::from_le_bytes(pair[..4].try_into().unwrap()), u32::from_le_bytes(pair[4..].try_into().unwrap()));
        pairs.push(match header & 0xFFFF {
            0x85 => write(0x85, (x + 0x0C00_0000) >> 3),
            0x8E => write(0x8E, 3),
            _ => (value, header),
        });
    }
    rest = list(&pairs);
    capture.commands.clear();
    capture.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: first.to_vec() });
    capture.commands.push(Command { words: [3, A, x, 0x0010_0010, 0x0010_0010, 0x2003, 0, 0], data: Vec::new() });
    capture.commands.push(Command { words: [1, 0, 0, 0, 0, 0, 0, 0], data: rest });
    capture
}

#[test]
fn render_to_texture_through_a_copy_transfer_matches_the_memory_path() {
    let capture = render_to_texture_capture();
    let play = |scale: u32, live: bool, eager: bool| -> Option<Pica> {
        let mut pica = Pica::new(&capture, scale).ok()?;
        pica.renderer.live_textures = live;
        pica.eager_transfers = eager;
        pica.readback = false; // comme un affichage en direct : l'image d'un transfert en tuiles n'a pas besoin d'être lue
        for command in &capture.commands {
            pica.run_command(command);
        }
        Some(pica)
    };
    let Some(mut lazy) = play(1, true, false) else { return };
    let mut memory_path = play(1, false, true).unwrap();
    assert_eq!(lazy.renderer.stats.live_textures, 1, "le résultat du transfert sert de texture : {:?}", lazy.renderer.stats);
    assert_eq!(lazy.renderer.stats.materialized, 0, "et la mémoire n'est pas écrite pour autant");
    lazy.finish();
    memory_path.finish();
    assert_eq!(tiles(&lazy, B), tiles(&memory_path, B), "à l'échelle 1 le résultat est celui de la mémoire (RGB565 retourné), octet pour octet");
    assert_eq!(lazy.memory.checksum(), memory_path.memory.checksum());
    assert!(tiles(&lazy, B).chunks_exact(4).any(|p| p[0] > 200 && p[1] == 0), "du rouge dans B");
    // à l'échelle 3, la texture est à la définition de l'échelle
    let Some(mut hd) = play(3, true, false) else { return };
    assert_eq!(hd.renderer.stats.live_textures, 1);
    hd.finish();
}

#[test]
fn display_transfer_images_follow_the_memory_path_for_every_output_format() {
    // formats de sortie (RGBA8, RGB8, RGB565, RGB5A1, RGBA4), avec et sans retournement, linéaire ou en tuiles
    for flags in [0x0000u32, 0x1000, 0x2000, 0x3000, 0x4000, 0x2001, 0x3003, 0x4002] {
        let mut capture = build([[0.05, 0.95], [0.95, 0.95], [0.05, 0.05]]);
        capture.regions.push(Region { address: 0x1405_0000, data: vec![0x55u8; 0x2000] });
        capture.commands.push(Command { words: [3, A, 0x1405_0000, 0x0010_0010, 0x0010_0010, flags, 0, 0], data: Vec::new() });
        let run = |eager: bool| -> Option<(u32, Vec<u8>)> {
            let mut pica = Pica::new(&capture, 1).ok()?;
            pica.eager_transfers = eager;
            let mut image = None;
            for command in &capture.commands {
                if let Some(i) = pica.run_command(command) {
                    image = Some(i);
                }
            }
            let deferred = pica.renderer.stats.deferred;
            pica.finish();
            // une sortie en tuiles (bit 1) n'est pas une image d'écran : à l'échelle 1 elle passe par la mémoire
            assert_eq!(deferred, if eager || flags & 2 != 0 { 0 } else { 1 }, "drapeaux {flags:#x}");
            Some((pica.memory.checksum(), image.expect("une image").rgba))
        };
        let Some((lazy_crc, lazy_image)) = run(false) else { return };
        let (eager_crc, eager_image) = run(true).unwrap();
        assert_eq!(lazy_image, eager_image, "drapeaux {flags:#x} : image");
        assert_eq!(lazy_crc, eager_crc, "drapeaux {flags:#x} : mémoire");
    }
}
