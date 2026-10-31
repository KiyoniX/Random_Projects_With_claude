//! Ce que le DSP fait des octets de son : les décoder (PCM, ADPCM, AAC) pour que les voix de `dsp` les mixent.
//! N'est utilisé que si une sortie est demandée (`BenchState::audio`) : sans elle, le banc et le portage restent identiques.
//!
//! Formats d'après Azahar (`audio_core/codec.cpp`) ; AAC par symphonia (MPL-2.0).

use symphonia_codec_aac::AacDecoder;
use symphonia_core::audio::layouts::{CHANNEL_LAYOUT_MONO, CHANNEL_LAYOUT_STEREO};
use symphonia_core::codecs::audio::well_known::CODEC_ID_AAC;
use symphonia_core::codecs::audio::{AudioCodecParameters, AudioDecoder, AudioDecoderOptions};
use symphonia_core::packet::PacketRef;

pub const FORMAT_PCM8: u8 = 0;
pub const FORMAT_PCM16: u8 = 1;
pub const FORMAT_ADPCM: u8 = 2;

const ADPCM_FRAME_BYTES: usize = 8;
const ADPCM_FRAME_SAMPLES: usize = 14;

/// Les derniers échantillons de l'ADPCM, gardés d'un tampon au suivant.
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct AdpcmState {
    pub y1: i16,
    pub y2: i16,
}

/// Combien d'octets occupe `length` échantillons.
pub fn encoded_size(format: u8, stereo: bool, length: u32) -> u32 {
    let channels = if stereo { 2 } else { 1 };
    match format {
        FORMAT_PCM8 => length * channels,
        FORMAT_PCM16 => length * 2 * channels,
        _ => (length as usize).div_ceil(ADPCM_FRAME_SAMPLES) as u32 * ADPCM_FRAME_BYTES as u32,
    }
}

pub fn decode_pcm8(data: &[u8], stereo: bool) -> Vec<[i16; 2]> {
    let sample = |b: u8| (b as i16) << 8;
    if stereo {
        data.chunks_exact(2).map(|c| [sample(c[0]), sample(c[1])]).collect()
    } else {
        data.iter().map(|&b| [sample(b); 2]).collect()
    }
}

pub fn decode_pcm16(data: &[u8], stereo: bool) -> Vec<[i16; 2]> {
    let sample = |c: &[u8]| i16::from_le_bytes([c[0], c[1]]);
    if stereo {
        data.chunks_exact(4).map(|c| [sample(&c[0..2]), sample(&c[2..4])]).collect()
    } else {
        data.chunks_exact(2).map(|c| [sample(c); 2]).collect()
    }
}

/// GC-ADPCM : 8 octets par trame, un en-tête (l'échelle en bas, le numéro de la paire de coefficients en haut) et 14
/// échantillons de 4 bits. `coefficients` : 8 paires, avec 11 bits après la virgule.
pub fn decode_adpcm(data: &[u8], length: usize, coefficients: &[i16; 16], state: &mut AdpcmState) -> Vec<[i16; 2]> {
    let mut out = Vec::with_capacity(length);
    for frame in data.chunks(ADPCM_FRAME_BYTES) {
        let scale = 1i32 << (frame[0] & 0xF);
        let index = ((frame[0] >> 4) & 7) as usize;
        let (c1, c2) = (coefficients[2 * index] as i32, coefficients[2 * index + 1] as i32);
        for &byte in &frame[1..] {
            for nibble in [byte >> 4, byte & 0xF] {
                if out.len() == length {
                    return out;
                }
                let signed = if nibble < 8 { nibble as i32 } else { nibble as i32 - 16 };
                let value = ((signed * scale * 2048 + 1024 + c1 * state.y1 as i32 + c2 * state.y2 as i32) >> 11)
                    .clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                state.y2 = state.y1;
                state.y1 = value;
                out.push([value; 2]);
            }
        }
    }
    out
}

const ADTS_RATES: [u32; 12] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];

/// Une musique en cours : les blocs AAC que le jeu envoie un par un. Le décodeur se crée au premier bloc, d'après son en-tête.
#[derive(Default)]
pub struct AacStream {
    decoder: Option<AacDecoder>,
    planes: Vec<Vec<i16>>,
}

impl AacStream {
    /// Décode un bloc ADTS : les échantillons des deux canaux (le même deux fois pour du mono), ou rien en cas d'échec.
    pub fn decode(&mut self, block: &[u8]) -> Option<(&[i16], &[i16])> {
        if block.len() < 7 || block[0] != 0xFF || block[1] & 0xF0 != 0xF0 {
            return None;
        }
        if self.decoder.is_none() {
            let rate = *ADTS_RATES.get((block[2] >> 2 & 0xF) as usize)?;
            let channels = (block[2] & 1) << 2 | block[3] >> 6;
            let mut parameters = AudioCodecParameters::new();
            parameters.for_codec(CODEC_ID_AAC).with_sample_rate(rate);
            parameters.with_channels(if channels == 1 { CHANNEL_LAYOUT_MONO } else { CHANNEL_LAYOUT_STEREO });
            self.decoder = Some(AacDecoder::try_new(&parameters, &AudioDecoderOptions::default()).ok()?);
        }
        let header = if block[1] & 1 == 0 { 9 } else { 7 }; // 2 octets de plus quand un CRC suit
        let payload = block.get(header..)?;
        let decoded = self.decoder.as_mut()?.decode_ref(&PacketRef::new(0, Default::default(), Default::default(), payload)).ok()?;
        decoded.copy_to_vecs_planar::<i16>(&mut self.planes);
        let first = self.planes.first()?;
        Some((first, self.planes.get(1).unwrap_or(first)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm_mono_and_stereo() {
        assert_eq!(decode_pcm8(&[0x01, 0xFF], false), [[0x0100; 2], [-256; 2]]);
        assert_eq!(decode_pcm8(&[0x01, 0xFF], true), [[0x0100, -256]]);
        assert_eq!(decode_pcm16(&[0x34, 0x12, 0xFF, 0xFF], false), [[0x1234; 2], [-1; 2]]);
        assert_eq!(decode_pcm16(&[0x34, 0x12, 0xFF, 0xFF], true), [[0x1234, -1]]);
    }

    #[test]
    fn sizes_by_format() {
        assert_eq!(encoded_size(FORMAT_PCM8, true, 10), 20);
        assert_eq!(encoded_size(FORMAT_PCM16, false, 10), 20);
        assert_eq!(encoded_size(FORMAT_ADPCM, false, 14), 8);
        assert_eq!(encoded_size(FORMAT_ADPCM, false, 15), 16);
    }

    #[test]
    fn adpcm_follows_the_filter() {
        // échelle 2^2 ; paire 1 : c1 = 2048 (1,0), c2 = 0 : chaque échantillon ajoute x × 4 au précédent (arrondi au plus proche)
        let mut coefficients = [0i16; 16];
        coefficients[2] = 2048;
        let mut state = AdpcmState { y1: 10, y2: 0 };
        let frame = [0x12, 0x1F, 0x70, 0, 0, 0, 0, 0];
        let out = decode_adpcm(&frame, 4, &coefficients, &mut state);
        assert_eq!(out, [[14; 2], [10; 2], [38; 2], [38; 2]], "x = 1, -1, 7, 0");
        assert_eq!(state, AdpcmState { y1: 38, y2: 38 });
        // limité à 16 bits, et arrêté au nombre d'échantillons demandé
        let mut state = AdpcmState { y1: 32760, y2: 0 };
        assert_eq!(decode_adpcm(&[0x1F, 0x70, 0, 0, 0, 0, 0, 0], 1, &coefficients, &mut state), [[32767; 2]]);
    }

    #[test]
    fn aac_refuses_what_is_not_adts() {
        let mut stream = AacStream::default();
        assert!(stream.decode(&[0x12; 16]).is_none());
        assert!(stream.decode(&[]).is_none());
    }
}
