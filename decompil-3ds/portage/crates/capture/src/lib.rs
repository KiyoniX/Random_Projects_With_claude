//! Le format de capture neutre du GPU PICA200 (`.picacap`) : lecture et écriture.
//!
//! Une capture est une photo de ce que le GPU peut lire (mémoire linéaire et mémoire vidéo), de l'état de ses registres
//! à un instant, suivie de la liste des commandes de la file de gsp à rejouer. Le format est décrit dans le README du
//! portage ; il est écrit par `banc/pica/export_capture.py` (depuis les `.pkl` de `replay.py`) et lu ici. Les captures
//! du vrai jeu restent dans `local/`, jamais versionnées : les tests fabriquent les leurs avec [`Capture::write`].

use std::io::{self, Read, Write};
use std::path::Path;

use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;

pub const MAGIC: &[u8; 8] = b"PICACAP\0";
pub const VERSION: u32 = 1;
pub const REG_COUNT: usize = 0x300;
pub const CODE_WORDS: usize = 4096;
pub const UNIFORM_COUNT: usize = 96;
pub const FOG_ENTRIES: usize = 128;
pub const LUT_COUNT: usize = 24;
pub const LUT_ROWS: usize = 256;

/// Une région de mémoire de la photo, décompressée, à son adresse (celle du jeu, pas la physique).
#[derive(Clone, Debug, PartialEq)]
pub struct Region {
    pub address: u32,
    pub data: Vec<u8>,
}

/// Une commande de la file de gsp : huit mots ; pour la commande 1 (liste de commandes GPU), les octets de la liste.
#[derive(Clone, Debug, PartialEq)]
pub struct Command {
    pub words: [u32; 8],
    pub data: Vec<u8>,
}

impl Command {
    /// Le numéro de commande (octet bas du premier mot) : 0 copie, 1 liste, 2 remplissage, 3 transfert, 4 copie de texture.
    pub fn kind(&self) -> u32 {
        self.words[0] & 0xFF
    }
}

/// Les indices des ports à auto-incrément du GPU (uniformes, code, attributs fixes, brouillard, tables d'éclairage).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PortState {
    pub code_offset: u32,
    pub swizzle_offset: u32,
    pub fixed_index: u32,
    pub uniform_index: u32,
    pub uniform_f32: bool,
    pub fog_row: u32,
    pub lut_which: u32,
    pub lut_row: u32,
    pub fixed_pending: Vec<u32>,
    pub uniform_pending: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Capture {
    pub regs: Vec<u32>,
    /// Un octet par registre : non nul si le jeu l'a déjà écrit (certains registres n'ont de sens qu'alors).
    pub seen: Vec<u8>,
    pub code: Vec<u32>,
    pub swizzle: Vec<u32>,
    pub uniforms: Vec<[f32; 4]>,
    pub fixed: Vec<[f32; 4]>,
    pub ports: PortState,
    pub fog: Vec<[f32; 2]>,
    /// 24 tables x 256 lignes x (valeur, différence).
    pub luts: Vec<f32>,
    pub regions: Vec<Region>,
    pub commands: Vec<Command>,
}

/// Les registres à la mise sous tension que le jeu ne réécrit pas toujours : étages du combinateur sur « précédent »,
/// toutes les couleurs écrites (comme `Gpu.__init__` du banc).
fn power_on_registers() -> Vec<u32> {
    let mut regs = vec![0u32; REG_COUNT];
    for stage in [0xC0usize, 0xC8, 0xD0, 0xD8, 0xF0, 0xF8] {
        regs[stage] = 0x000F_000F;
        regs[stage + 3] = 0xFF00_0000;
    }
    regs[0x107] = 0x0F00;
    regs
}

impl Default for Capture {
    fn default() -> Self {
        Capture {
            regs: power_on_registers(),
            seen: vec![0; REG_COUNT],
            code: vec![0; CODE_WORDS],
            swizzle: vec![0; CODE_WORDS],
            uniforms: vec![[0.0; 4]; UNIFORM_COUNT],
            fixed: vec![[0.0, 0.0, 0.0, 1.0]; 16],
            ports: PortState::default(),
            fog: vec![[0.0; 2]; FOG_ENTRIES],
            luts: vec![0.0; LUT_COUNT * LUT_ROWS * 2],
            regions: Vec::new(),
            commands: Vec::new(),
        }
    }
}

fn bad(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_string())
}

/// Un curseur sur le contenu d'un bloc.
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn bytes(&mut self, n: usize) -> io::Result<&'a [u8]> {
        let end = self.pos.checked_add(n).filter(|&e| e <= self.data.len()).ok_or_else(|| bad("bloc trop court"))?;
        let out = &self.data[self.pos..end];
        self.pos = end;
        Ok(out)
    }
    fn u32(&mut self) -> io::Result<u32> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    fn u32s(&mut self, n: usize) -> io::Result<Vec<u32>> {
        Ok(self.bytes(n * 4)?.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect())
    }
    fn f32s(&mut self, n: usize) -> io::Result<Vec<f32>> {
        Ok(self.bytes(n * 4)?.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect())
    }
    fn rest(&mut self) -> &'a [u8] {
        let out = &self.data[self.pos..];
        self.pos = self.data.len();
        out
    }
}

fn pairs4(values: Vec<f32>) -> Vec<[f32; 4]> {
    values.chunks_exact(4).map(|c| [c[0], c[1], c[2], c[3]]).collect()
}

impl Capture {
    pub fn load(path: &Path) -> io::Result<Capture> {
        Capture::parse(&std::fs::read(path)?)
    }

    pub fn parse(bytes: &[u8]) -> io::Result<Capture> {
        if bytes.len() < 16 || &bytes[..8] != MAGIC {
            return Err(bad("pas une capture PICACAP"));
        }
        let version = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        if version != VERSION {
            return Err(bad(&format!("version de capture {version} non lue (cette version lit la {VERSION})")));
        }
        let count = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
        let mut capture = Capture::default();
        let mut pos = 16usize;
        for _ in 0..count {
            if pos + 8 > bytes.len() {
                return Err(bad("capture tronquée"));
            }
            let tag: [u8; 4] = bytes[pos..pos + 4].try_into().unwrap();
            let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
            pos += 8;
            let payload = bytes.get(pos..pos + len).ok_or_else(|| bad("capture tronquée"))?;
            pos += len;
            let mut r = Reader { data: payload, pos: 0 };
            match &tag {
                b"REGS" => {
                    let n = r.u32()? as usize;
                    capture.regs = r.u32s(n)?;
                    capture.seen = r.bytes(n)?.to_vec();
                    capture.regs.resize(REG_COUNT, 0);
                    capture.seen.resize(REG_COUNT, 0);
                }
                b"SHDR" => {
                    capture.code = r.u32s(CODE_WORDS)?;
                    capture.swizzle = r.u32s(CODE_WORDS)?;
                    capture.uniforms = pairs4(r.f32s(UNIFORM_COUNT * 4)?);
                    capture.fixed = pairs4(r.f32s(16 * 4)?);
                }
                b"GSTA" => {
                    let s = r.u32s(10)?;
                    let p = &mut capture.ports;
                    p.code_offset = s[0];
                    p.swizzle_offset = s[1];
                    p.fixed_index = s[2];
                    p.uniform_index = s[3];
                    p.uniform_f32 = s[4] != 0;
                    p.fog_row = s[5];
                    p.lut_which = s[6];
                    p.lut_row = s[7];
                    p.fixed_pending = r.u32s(s[8] as usize)?;
                    p.uniform_pending = r.u32s(s[9] as usize)?;
                }
                b"FOGT" => {
                    let v = r.f32s(FOG_ENTRIES * 2)?;
                    capture.fog = v.chunks_exact(2).map(|c| [c[0], c[1]]).collect();
                }
                b"LUTS" => capture.luts = r.f32s(LUT_COUNT * LUT_ROWS * 2)?,
                b"MEMR" => {
                    let address = r.u32()?;
                    let size = r.u32()? as usize;
                    let codec = r.u32()?;
                    let stored = r.rest();
                    let data = match codec {
                        0 => stored.to_vec(),
                        1 => {
                            let mut out = Vec::with_capacity(size);
                            ZlibDecoder::new(stored).read_to_end(&mut out)?;
                            out
                        }
                        _ => return Err(bad("codec de région inconnu")),
                    };
                    if data.len() != size {
                        return Err(bad("taille de région incohérente"));
                    }
                    capture.regions.push(Region { address, data });
                }
                b"CMDW" => {
                    let mut words = [0u32; 8];
                    words.copy_from_slice(&r.u32s(8)?);
                    let len = r.u32()? as usize;
                    capture.commands.push(Command { words, data: r.bytes(len)?.to_vec() });
                }
                _ => {} // bloc inconnu : ignoré (les versions futures peuvent en ajouter)
            }
        }
        Ok(capture)
    }

    /// Écrit la capture ; `compress` range les régions en zlib (comme l'exporteur Python).
    pub fn write(&self, out: &mut impl Write, compress: bool) -> io::Result<()> {
        fn put(out: &mut Vec<u8>, tag: &[u8; 4], payload: &[u8]) {
            out.extend_from_slice(tag);
            out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            out.extend_from_slice(payload);
        }
        fn w32(buf: &mut Vec<u8>, values: &[u32]) {
            for v in values {
                buf.extend_from_slice(&v.to_le_bytes());
            }
        }
        fn wf(buf: &mut Vec<u8>, values: &[f32]) {
            for v in values {
                buf.extend_from_slice(&v.to_le_bytes());
            }
        }
        let mut body = Vec::new();
        let mut count = 0u32;
        let mut p = Vec::new();
        w32(&mut p, &[self.regs.len() as u32]);
        w32(&mut p, &self.regs);
        p.extend_from_slice(&self.seen);
        put(&mut body, b"REGS", &p);
        let mut p = Vec::new();
        w32(&mut p, &self.code);
        w32(&mut p, &self.swizzle);
        for u in self.uniforms.iter().chain(self.fixed.iter()) {
            wf(&mut p, u);
        }
        put(&mut body, b"SHDR", &p);
        let s = &self.ports;
        let mut p = Vec::new();
        w32(&mut p, &[s.code_offset, s.swizzle_offset, s.fixed_index, s.uniform_index, s.uniform_f32 as u32, s.fog_row,
                      s.lut_which, s.lut_row, s.fixed_pending.len() as u32, s.uniform_pending.len() as u32]);
        w32(&mut p, &s.fixed_pending);
        w32(&mut p, &s.uniform_pending);
        put(&mut body, b"GSTA", &p);
        let mut p = Vec::new();
        for f in &self.fog {
            wf(&mut p, f);
        }
        put(&mut body, b"FOGT", &p);
        let mut p = Vec::new();
        wf(&mut p, &self.luts);
        put(&mut body, b"LUTS", &p);
        count += 5;
        for region in &self.regions {
            let mut p = Vec::new();
            w32(&mut p, &[region.address, region.data.len() as u32, compress as u32]);
            if compress {
                let mut enc = ZlibEncoder::new(Vec::new(), Compression::fast());
                enc.write_all(&region.data)?;
                p.extend_from_slice(&enc.finish()?);
            } else {
                p.extend_from_slice(&region.data);
            }
            put(&mut body, b"MEMR", &p);
            count += 1;
        }
        for command in &self.commands {
            let mut p = Vec::new();
            w32(&mut p, &command.words);
            w32(&mut p, &[command.data.len() as u32]);
            p.extend_from_slice(&command.data);
            put(&mut body, b"CMDW", &p);
            count += 1;
        }
        out.write_all(MAGIC)?;
        out.write_all(&VERSION.to_le_bytes())?;
        out.write_all(&count.to_le_bytes())?;
        out.write_all(&body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Capture {
        let mut c = Capture::default();
        c.regs[0x41] = 0x123456;
        c.seen[0x41] = 1;
        c.code[7] = 0xDEADBEEF;
        c.uniforms[3] = [1.0, 2.0, 3.0, 4.0];
        c.ports.uniform_pending = vec![9, 8];
        c.ports.uniform_f32 = true;
        c.fog[5] = [0.5, -0.25];
        c.luts[100] = 0.75;
        c.regions.push(Region { address: 0x1400_0000, data: (0..5000u32).map(|i| (i * 7) as u8).collect() });
        c.commands.push(Command { words: [1, 2, 3, 4, 5, 6, 7, 8], data: vec![1, 2, 3, 4, 5, 6, 7, 8] });
        c
    }

    #[test]
    fn round_trip_raw_and_zlib() {
        for compress in [false, true] {
            let c = sample();
            let mut bytes = Vec::new();
            c.write(&mut bytes, compress).unwrap();
            let back = Capture::parse(&bytes).unwrap();
            assert!(back.regs == c.regs && back.seen == c.seen, "registres");
            assert!(back.code == c.code && back.swizzle == c.swizzle, "code");
            assert!(back.uniforms == c.uniforms && back.fixed == c.fixed, "uniformes");
            assert!(back.ports == c.ports, "ports");
            assert!(back.fog == c.fog && back.luts == c.luts, "tables");
            assert!(back.regions == c.regions && back.commands == c.commands, "mémoire et commandes");
        }
    }

    #[test]
    fn rejects_garbage_and_future_versions() {
        assert!(Capture::parse(b"nope").is_err());
        let mut bytes = Vec::new();
        sample().write(&mut bytes, false).unwrap();
        bytes[8] = 2;
        assert!(Capture::parse(&bytes).is_err());
        bytes[8] = 1;
        assert!(Capture::parse(&bytes[..bytes.len() - 5]).is_err());
    }
}
