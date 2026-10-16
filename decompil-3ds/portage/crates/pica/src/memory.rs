//! La mémoire que le GPU peut lire : le tas linéaire et la mémoire vidéo, en régions à adresses du jeu.

use std::borrow::Cow;

use capture::Capture;

const PAGE: usize = 0x1000;

pub struct Region {
    pub start: u32,
    pub data: Vec<u8>,
    /// Pour chaque page : la valeur de l'horloge de la mémoire à la dernière écriture (voir [`Memory::stamp`]).
    stamps: Vec<u64>,
}

#[derive(Default)]
pub struct Memory {
    regions: Vec<Region>,
    /// Horloge des écritures : monte à chaque écriture ou ajout de région.
    clock: u64,
}

/// Adresse physique du GPU (déjà multipliée par 8) -> adresse du jeu (mémoire vidéo et tas linéaire), ou `None`.
pub fn translate(address: u32) -> Option<u32> {
    if (0x1800_0000..0x1860_0000).contains(&address) {
        Some(address + 0x0700_0000)
    } else if (0x2000_0000..0x2800_0000).contains(&address) {
        Some(address - 0x0C00_0000)
    } else {
        None
    }
}

impl Memory {
    pub fn from_capture(capture: &Capture) -> Memory {
        let mut memory = Memory::default();
        for region in &capture.regions {
            memory.map(region.address, &region.data);
        }
        memory
    }

    /// Ajoute une région (arrondie à la page, comme le banc, pour que les lectures qui dépassent un peu rendent des zéros).
    pub fn map(&mut self, start: u32, data: &[u8]) {
        let mut padded = data.to_vec();
        padded.resize(data.len().div_ceil(PAGE) * PAGE, 0);
        self.clock += 1;
        let stamps = vec![self.clock; padded.len() / PAGE];
        self.regions.push(Region { start, data: padded, stamps });
    }

    /// Les régions (adresse, octets) : pour écrire un instantané de la mémoire.
    pub fn regions(&self) -> impl Iterator<Item = (u32, &[u8])> {
        self.regions.iter().map(|r| (r.start, r.data.as_slice()))
    }

    /// Une empreinte (CRC32) de tout le contenu : pour comparer deux rejeux octet pour octet.
    pub fn checksum(&self) -> u32 {
        let mut hasher = crc32fast::Hasher::new();
        let mut order: Vec<&Region> = self.regions.iter().collect();
        order.sort_by_key(|r| r.start);
        for r in order {
            hasher.update(&r.start.to_le_bytes());
            hasher.update(&r.data);
        }
        hasher.finalize()
    }

    /// L'horloge des écritures (une valeur de plus à chaque écriture).
    pub fn clock(&self) -> u64 {
        self.clock
    }

    /// Le plus récent des instants d'écriture des pages que couvre la plage : si elle est plus ancienne que l'horloge
    /// relevée à une lecture précédente, rien n'a changé dans la plage depuis (la plage hors mémoire rend `u64::MAX`).
    pub fn stamp(&self, address: u32, len: usize) -> u64 {
        if len == 0 {
            return 0;
        }
        let mut best = 0u64;
        let mut at = address as usize;
        let end = at + len;
        while at < end {
            let Some(region) = self.regions.iter().find(|r| at >= r.start as usize && at < r.start as usize + r.data.len()) else {
                return u64::MAX;
            };
            let offset = at - region.start as usize;
            let stop = (end - region.start as usize).min(region.data.len());
            for page in offset / PAGE..=(stop - 1) / PAGE {
                best = best.max(region.stamps[page]);
            }
            at = region.start as usize + stop;
        }
        best
    }

    fn find(&self, address: u32, len: usize) -> Option<&Region> {
        self.regions.iter().find(|r| {
            address >= r.start && (address as usize - r.start as usize) + len <= r.data.len()
        })
    }

    /// Lit `len` octets ; `None` si la plage n'est pas entièrement dans la mémoire.
    pub fn read(&self, address: u32, len: usize) -> Option<Cow<'_, [u8]>> {
        if len == 0 {
            return Some(Cow::Borrowed(&[]));
        }
        if let Some(region) = self.find(address, len) {
            let offset = (address - region.start) as usize;
            return Some(Cow::Borrowed(&region.data[offset..offset + len]));
        }
        // une plage à cheval sur deux régions voisines
        let mut out = Vec::with_capacity(len);
        let mut at = address as usize;
        while out.len() < len {
            let region = self.regions.iter().find(|r| {
                at >= r.start as usize && at < r.start as usize + r.data.len()
            })?;
            let offset = at - region.start as usize;
            let take = (len - out.len()).min(region.data.len() - offset);
            out.extend_from_slice(&region.data[offset..offset + take]);
            at += take;
        }
        Some(Cow::Owned(out))
    }

    pub fn write(&mut self, address: u32, bytes: &[u8]) -> bool {
        if bytes.is_empty() {
            return true;
        }
        let mut at = address as usize;
        let mut done = 0usize;
        // la plage entière doit exister avant qu'on écrive quoi que ce soit
        if self.read(address, bytes.len()).is_none() {
            return false;
        }
        self.clock += 1;
        let clock = self.clock;
        while done < bytes.len() {
            let region = self
                .regions
                .iter_mut()
                .find(|r| at >= r.start as usize && at < r.start as usize + r.data.len())
                .expect("plage vérifiée");
            let offset = at - region.start as usize;
            let take = (bytes.len() - done).min(region.data.len() - offset);
            region.data[offset..offset + take].copy_from_slice(&bytes[done..done + take]);
            for page in offset / PAGE..=(offset + take - 1) / PAGE {
                region.stamps[page] = clock;
            }
            at += take;
            done += take;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_write_across_regions() {
        let mut m = Memory::default();
        m.map(0x1000_0000, &[1; 0x1000]);
        m.map(0x1000_1000, &[2; 0x1000]);
        assert_eq!(&*m.read(0x1000_0ffe, 4).unwrap(), &[1, 1, 2, 2]);
        assert!(m.write(0x1000_0ffe, &[9, 9, 9, 9]));
        assert_eq!(&*m.read(0x1000_0ffe, 4).unwrap(), &[9, 9, 9, 9]);
        assert!(m.read(0x2000_0000, 1).is_none());
        assert!(!m.write(0x1000_1fff, &[0, 0]));
    }

    #[test]
    fn stamp_follows_writes() {
        let mut m = Memory::default();
        m.map(0x1000_0000, &[0; 0x3000]);
        let before = m.clock();
        assert!(m.stamp(0x1000_0000, 0x3000) <= before);
        m.write(0x1000_1800, &[1, 2]);
        assert!(m.stamp(0x1000_0000, 0x1000) <= before, "la première page n'a pas bougé");
        assert!(m.stamp(0x1000_1000, 0x1000) > before);
        assert!(m.stamp(0x1000_0000, 0x3000) > before);
        assert_eq!(m.stamp(0x2000_0000, 4), u64::MAX);
    }

    #[test]
    fn translate_ranges() {
        assert_eq!(translate(0x1800_0000), Some(0x1F00_0000));
        assert_eq!(translate(0x2000_0000), Some(0x1400_0000));
        assert_eq!(translate(0x3000_0000), None);
    }
}
