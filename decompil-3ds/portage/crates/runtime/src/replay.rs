//! Refaire une partie d'après son journal (`runtime run --rejouer`, `portage play --rejouer`).

/// Le début de la ligne du journal qui donne le dossier du mod de la partie.
pub const MOD_NOTE: &str = "mod : ";

/// Le mod d'une partie, si son journal en donne un.
pub fn parse_mod(text: &str) -> Option<&str> {
    text.lines().find_map(|line| line.split_once(" ms] ")?.1.strip_prefix(MOD_NOTE))
}

/// Le début de la ligne du journal qui donne l'heure de la console au démarrage, en millisecondes depuis 1900.
pub const CLOCK_NOTE: &str = "horloge au départ : ";

/// L'heure de la console au démarrage d'une partie, si son journal la donne.
pub fn parse_clock(text: &str) -> Option<u64> {
    text.lines().find_map(|line| line.split_once(" ms] ")?.1.strip_prefix(CLOCK_NOTE)?.trim().parse().ok())
}

/// Ce qu'un joueur a fait d'une partie : (début en s, durée en s, valeur) pour chaque entrée.
#[derive(Default)]
pub struct Inputs {
    pub presses: Vec<(f64, f64, u32)>,
    pub touches: Vec<(f64, f64, u16, u16)>,
    pub circles: Vec<(f64, f64, i16, i16)>,
    pub gyros: Vec<(f64, f64, [i16; 3])>,
}

/// Les entrées relevées dans le journal d'une partie (`portage play`). Le journal note la fin d'image où elles changent,
/// arrondie à la microseconde : on avance d'une milliseconde pour que le changement tombe sur cette même image.
pub fn parse_replay(text: &str) -> Inputs {
    let Inputs { mut presses, mut touches, mut circles, mut gyros } = Inputs::default();
    let mut pushed: Option<(f64, i16, i16)> = None;
    let mut turning: Option<(f64, [i16; 3])> = None;
    let (mut held, mut stylus): (Option<(f64, u32)>, Option<(f64, u16, u16)>) = (None, None);
    for line in text.lines() {
        let Some((stamp, rest)) = line.strip_prefix('[').and_then(|l| l.split_once(" ms] ")) else { continue };
        let Ok(ms) = stamp.trim().parse::<f64>() else { continue };
        let at = ms / 1e3 - 0.001;
        if let Some(mask) = rest.strip_prefix("hid : boutons tenus 0x") {
            if let Some((start, bits)) = held.take() {
                presses.push((start, at - start, bits));
            }
            let bits = u32::from_str_radix(mask.trim(), 16).unwrap_or(0);
            if bits != 0 {
                held = Some((at, bits));
            }
        } else if let Some(point) = rest.strip_prefix("hid : pad circulaire ") {
            if let Some((start, x, y)) = pushed.take() {
                circles.push((start, at - start, x, y));
            }
            let mut numbers = point.trim_matches(['(', ')']).split(", ").filter_map(|n| n.parse::<i16>().ok());
            if let (Some(x), Some(y)) = (numbers.next(), numbers.next()) {
                if (x, y) != (0, 0) {
                    pushed = Some((at, x, y));
                }
            }
        } else if let Some(axes) = rest.strip_prefix("hid : gyroscope ") {
            if let Some((start, value)) = turning.take() {
                gyros.push((start, at - start, value));
            }
            let numbers: Vec<i16> = axes.trim_matches(['[', ']']).split(", ").filter_map(|n| n.parse().ok()).collect();
            if let Ok(value) = <[i16; 3]>::try_from(numbers) {
                if value != [0; 3] {
                    turning = Some((at, value));
                }
            }
        } else if let Some(point) = rest.strip_prefix("hid : stylet ") {
            if let Some((start, x, y)) = stylus.take() {
                touches.push((start, at - start, x, y));
            }
            let mut numbers = point.split(|c: char| !c.is_ascii_digit()).filter_map(|n| n.parse::<u16>().ok());
            if let (Some(x), Some(y)) = (numbers.next(), numbers.next()) {
                stylus = Some((at, x, y));
            }
        }
    }
    if let Some((start, bits)) = held {
        presses.push((start, f64::INFINITY, bits));
    }
    if let Some((start, x, y)) = stylus {
        touches.push((start, f64::INFINITY, x, y));
    }
    if let Some((start, x, y)) = pushed {
        circles.push((start, f64::INFINITY, x, y));
    }
    if let Some((start, value)) = turning {
        gyros.push((start, f64::INFINITY, value));
    }
    Inputs { presses, touches, circles, gyros }
}

#[cfg(test)]
mod tests {
    use super::{Inputs, parse_clock, parse_mod, parse_replay};

    #[test]
    fn replay_reads_the_starting_clock() {
        let none = "[     0.000 ms] fil créé\n";
        assert_eq!(parse_clock(&format!("{none}[     0.000 ms] horloge au départ : 3970000000000\n")), Some(3970000000000));
        assert_eq!(parse_clock(none), None);
        assert_eq!(parse_mod(&format!("{none}[     0.000 ms] mod : D:\\mods\\pc\n")), Some("D:\\mods\\pc"));
        assert_eq!(parse_mod(none), None);
    }

    #[test]
    fn replay_reads_buttons_and_stylus_from_the_journal() {
        let journal = "[  1000.000 ms] hid : boutons tenus 0x2\n[  1500.000 ms] hid : boutons tenus 0x0\n\
            [  2000.000 ms] hid : stylet Some((127, 225))\n[  2250.000 ms] hid : stylet None\n\
            [  3000.000 ms] hid : boutons tenus 0x1\n[  3100.000 ms] f40 autre ligne\n\
            [  4000.000 ms] hid : pad circulaire (-156, 110)\n[  4500.000 ms] hid : pad circulaire (0, 0)\n\
            [  5000.000 ms] hid : gyroscope [-3, 0, 700]\n[  5016.000 ms] hid : gyroscope [0, 0, 0]\n";
        let Inputs { presses, touches, circles, gyros } = parse_replay(journal);
        assert_eq!(gyros.len(), 1);
        assert!((gyros[0].1 - 0.016).abs() < 1e-9 && gyros[0].2 == [-3, 0, 700]);
        assert_eq!(circles.len(), 1);
        assert!((circles[0].1 - 0.5).abs() < 1e-9 && circles[0].2 == -156 && circles[0].3 == 110);
        assert_eq!(presses.len(), 2);
        assert!((presses[0].0 - 0.999).abs() < 1e-9 && (presses[0].1 - 0.5).abs() < 1e-9 && presses[0].2 == 2);
        assert!(presses[1].1.is_infinite() && presses[1].2 == 1, "un bouton jamais relâché reste tenu");
        assert_eq!(touches.len(), 1);
        assert!((touches[0].1 - 0.25).abs() < 1e-9 && touches[0].2 == 127 && touches[0].3 == 225);
    }
}
