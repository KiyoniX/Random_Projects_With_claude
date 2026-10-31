//! La sortie du son : ce que le DSP mixe, à 32 728 Hz, va vers la carte son. Le jeu avance avec le temps réel : on garde
//! un peu d'avance dans la file et on jette le surplus plutôt que de laisser le son prendre du retard sur l'image.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

const SOURCE_RATE: f64 = 32728.0;
/// Au-delà de cette file (échantillons stéréo), le son a pris du retard : on revient à `QUEUE_TARGET`.
const QUEUE_LIMIT: usize = (SOURCE_RATE * 2.0 * 0.20) as usize;
const QUEUE_TARGET: usize = (SOURCE_RATE * 2.0 * 0.08) as usize;

/// Ce qui passe de la file à la sortie : rééchantillonne au plus proche de la carte son, par interpolation linéaire.
struct Resampler {
    step: f64,
    phase: f64,
    previous: [f32; 2],
    next: [f32; 2],
    gain: f32,
}

impl Resampler {
    fn new(device_rate: f64, gain: f32) -> Resampler {
        Resampler { step: SOURCE_RATE / device_rate, phase: 1.0, previous: [0.0; 2], next: [0.0; 2], gain }
    }

    /// Un échantillon stéréo de sortie, entre -1 et 1.
    fn frame(&mut self, queue: &mut VecDeque<i16>) -> [f32; 2] {
        if queue.len() > QUEUE_LIMIT {
            let extra = (queue.len() - QUEUE_TARGET) & !1;
            queue.drain(..extra);
        }
        while self.phase >= 1.0 {
            self.phase -= 1.0;
            self.previous = self.next;
            // file vide : on tient le dernier échantillon, ce qui s'entend moins qu'un retour à zéro
            if queue.len() >= 2 {
                let (left, right) = (queue.pop_front().unwrap_or(0), queue.pop_front().unwrap_or(0));
                self.next = [left as f32 / 32768.0, right as f32 / 32768.0];
            }
        }
        let t = self.phase as f32;
        self.phase += self.step;
        [0, 1].map(|c| (self.previous[c] + (self.next[c] - self.previous[c]) * t) * self.gain)
    }
}

/// Ouvre la sortie par défaut. Rend `None` (et le dit) s'il n'y en a pas : le jeu tourne alors sans son.
pub fn start(queue: Arc<Mutex<VecDeque<i16>>>, volume: f32) -> Option<cpal::Stream> {
    let opened = (|| -> Result<cpal::Stream, String> {
        let device = cpal::default_host().default_output_device().ok_or("aucune sortie audio")?;
        let supported = device.default_output_config().map_err(|e| e.to_string())?;
        if supported.sample_format() != cpal::SampleFormat::F32 {
            return Err(format!("format de sortie {:?} non pris en charge", supported.sample_format()));
        }
        let config = supported.config();
        let channels = config.channels as usize;
        let mut resampler = Resampler::new(config.sample_rate as f64, volume);
        let stream = device
            .build_output_stream(
                config,
                move |out: &mut [f32], _| {
                    let Ok(mut queue) = queue.lock() else { return };
                    for frame in out.chunks_mut(channels) {
                        let [left, right] = resampler.frame(&mut queue);
                        for (i, sample) in frame.iter_mut().enumerate() {
                            *sample = if i % 2 == 0 { left } else { right };
                        }
                    }
                },
                |e| eprintln!("sortie audio : {e}"),
                None,
            )
            .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(stream)
    })();
    match opened {
        Ok(stream) => Some(stream),
        Err(e) => {
            eprintln!("pas de son : {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampler_follows_the_queue_and_holds_when_empty() {
        // même fréquence : chaque sortie reprend une entrée, avec une entrée de retard
        let mut r = Resampler::new(SOURCE_RATE, 1.0);
        let mut queue: VecDeque<i16> = VecDeque::from([16384, -16384, 8192, -8192]);
        assert_eq!(r.frame(&mut queue), [0.0, 0.0]);
        assert_eq!(r.frame(&mut queue), [0.5, -0.5]);
        assert_eq!(r.frame(&mut queue), [0.25, -0.25]);
        assert_eq!(r.frame(&mut queue), [0.25, -0.25], "file vide : le dernier échantillon");
    }

    #[test]
    fn resampler_drops_the_excess_and_applies_the_volume() {
        let mut r = Resampler::new(SOURCE_RATE, 0.5);
        let mut queue: VecDeque<i16> = VecDeque::from(vec![16384; QUEUE_LIMIT + 2]);
        r.frame(&mut queue);
        assert!(queue.len() <= QUEUE_TARGET, "{}", queue.len());
        assert_eq!(r.frame(&mut queue), [0.25, 0.25]);
    }
}
