//! La mémoire que le GPU peut lire : le tas linéaire et la mémoire vidéo, en régions à adresses du jeu.

use std::any::Any;
use std::borrow::Cow;
use std::rc::Rc;

use capture::Capture;

const PAGE: usize = 0x1000;

pub struct Region {
    pub start: u32,
    data: Bytes,
    /// Pour chaque page : la valeur de l'horloge de la mémoire à la dernière écriture (voir [`Memory::stamp`]).
    stamps: Vec<u64>,
}

/// Les octets d'une région : à elle, ou tenus ailleurs (voir [`Memory::map_external`]).
enum Bytes {
    Owned(Vec<u8>),
    /// `_owner` garde en vie le propriétaire des octets (la réserve du noyau) aussi longtemps que la région.
    External { ptr: *mut u8, len: usize, _owner: Rc<dyn Any> },
}

impl Bytes {
    fn as_slice(&self) -> &[u8] {
        match self {
            Bytes::Owned(v) => v,
            // SAFETY : voir `Memory::map_external` ; l'emprunt rendu ne vit pas plus longtemps que `&self`.
            Bytes::External { ptr, len, .. } => unsafe { std::slice::from_raw_parts(*ptr, *len) },
        }
    }

    fn as_mut_slice(&mut self) -> &mut [u8] {
        match self {
            Bytes::Owned(v) => v,
            // SAFETY : voir `Memory::map_external` ; `&mut self` exclut toute autre tranche prêtée par `Memory`, et
            // personne d'autre n'écrit ces octets pendant l'appel (un seul fil).
            Bytes::External { ptr, len, .. } => unsafe { std::slice::from_raw_parts_mut(*ptr, *len) },
        }
    }
}

impl Region {
    fn data(&self) -> &[u8] {
        self.data.as_slice()
    }
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
        self.push(start, Bytes::Owned(padded));
    }

    /// Ajoute une région dont les octets restent à quelqu'un d'autre : la réserve du tas linéaire du noyau
    /// (`linear_backing`, à 0x14000000) ou celle de la mémoire vidéo (0x1F000000), sans copie. Ce qui est écrit d'un
    /// côté est vu de l'autre ; comme l'horloge ne voit pas les écritures du jeu, appeler [`Memory::touch_all`] avant
    /// de lire ce que le jeu a pu changer. `owner` (le `Rc<Backing>` du noyau) est gardé avec la région, qui ne peut
    /// donc pas lui survivre. `len` est un multiple de la page, comme une région de [`Memory::map`] : deux mémoires
    /// de même contenu ont la même empreinte ([`Memory::checksum`]).
    ///
    /// # Safety
    /// `ptr` doit être valide en lecture et en écriture sur `len` octets tant que `owner` vit. Les tranches que
    /// `Memory` prête (`read`, `regions`) supposent que personne d'autre n'écrit ces octets pendant qu'elles vivent :
    /// c'est le cas tant que le C recompilé, le noyau et pica tournent sur le même fil, car le jeu ne s'exécute pas
    /// pendant une commande de gsp et aucune tranche ne survit à l'appel qui l'a prise. Règle pour qui tient aussi le
    /// noyau (le GPU branché sur gsp reçoit `&mut Kernel`) : ne jamais écrire par `k.memory` tant qu'une tranche prise
    /// à pica est vivante.
    pub unsafe fn map_external(&mut self, start: u32, ptr: *mut u8, len: usize, owner: Rc<dyn Any>) {
        assert!(len % PAGE == 0, "région externe de {len:#x} octets : pas un multiple de la page");
        self.push(start, Bytes::External { ptr, len, _owner: owner });
    }

    fn push(&mut self, start: u32, data: Bytes) {
        self.clock += 1;
        let stamps = vec![self.clock; data.as_slice().len().div_ceil(PAGE)];
        self.regions.push(Region { start, data, stamps });
    }

    /// Vieillit toutes les pages d'un coup : les caches (textures, sommets) relisent tout ce qu'ils utilisent ensuite.
    /// Pour la mémoire que le jeu écrit sans passer par ici.
    pub fn touch_all(&mut self) {
        self.clock += 1;
        for region in &mut self.regions {
            region.stamps.fill(self.clock);
        }
    }

    /// Les régions (adresse, octets) : pour écrire un instantané de la mémoire.
    pub fn regions(&self) -> impl Iterator<Item = (u32, &[u8])> {
        self.regions.iter().map(|r| (r.start, r.data()))
    }

    /// Une empreinte (CRC32) de tout le contenu : pour comparer deux rejeux octet pour octet.
    pub fn checksum(&self) -> u32 {
        let mut hasher = crc32fast::Hasher::new();
        let mut order: Vec<&Region> = self.regions.iter().collect();
        order.sort_by_key(|r| r.start);
        for r in order {
            hasher.update(&r.start.to_le_bytes());
            hasher.update(r.data());
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
            let Some(region) = self.regions.iter().find(|r| at >= r.start as usize && at < r.start as usize + r.data().len()) else {
                return u64::MAX;
            };
            let offset = at - region.start as usize;
            let stop = (end - region.start as usize).min(region.data().len());
            for page in offset / PAGE..=(stop - 1) / PAGE {
                best = best.max(region.stamps[page]);
            }
            at = region.start as usize + stop;
        }
        best
    }

    fn find(&self, address: u32, len: usize) -> Option<&Region> {
        self.regions.iter().find(|r| {
            address >= r.start && (address as usize - r.start as usize) + len <= r.data().len()
        })
    }

    /// Lit `len` octets ; `None` si la plage n'est pas entièrement dans la mémoire.
    pub fn read(&self, address: u32, len: usize) -> Option<Cow<'_, [u8]>> {
        if len == 0 {
            return Some(Cow::Borrowed(&[]));
        }
        if let Some(region) = self.find(address, len) {
            let offset = (address - region.start) as usize;
            return Some(Cow::Borrowed(&region.data()[offset..offset + len]));
        }
        // une plage à cheval sur deux régions voisines
        let mut out = Vec::with_capacity(len);
        let mut at = address as usize;
        while out.len() < len {
            let region = self.regions.iter().find(|r| {
                at >= r.start as usize && at < r.start as usize + r.data().len()
            })?;
            let offset = at - region.start as usize;
            let take = (len - out.len()).min(region.data().len() - offset);
            out.extend_from_slice(&region.data()[offset..offset + take]);
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
                .find(|r| at >= r.start as usize && at < r.start as usize + r.data().len())
                .expect("plage vérifiée");
            let offset = at - region.start as usize;
            let take = (bytes.len() - done).min(region.data().len() - offset);
            region.data.as_mut_slice()[offset..offset + take].copy_from_slice(&bytes[done..done + take]);
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
    use std::cell::RefCell;

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
    fn external_region_shares_its_bytes() {
        // la réserve d'un autre (ici un tableau du test) : pica la lit et l'écrit sans copie
        let backing = Rc::new(RefCell::new(vec![0u8; 0x2000]));
        let ptr = backing.borrow_mut().as_mut_ptr();
        let mut m = Memory::default();
        unsafe { m.map_external(0x1400_0000, ptr, 0x2000, backing.clone()) };
        m.map(0x1400_2000, &[7; 0x1000]);
        assert!(m.write(0x1400_1ffe, &[1, 2, 3, 4]), "écriture à cheval sur la région externe et la région à soi");
        assert_eq!(&*m.read(0x1400_1ffe, 4).unwrap(), &[1, 2, 3, 4]);
        // ce que l'autre écrit est vu de pica
        unsafe { *ptr.add(0x10) = 0xAB };
        assert_eq!(&*m.read(0x1400_0010, 1).unwrap(), &[0xAB]);
        assert!(m.read(0x1400_3000, 1).is_none());
        assert_eq!(Rc::strong_count(&backing), 2, "la région garde la réserve en vie");
        drop(m);
        assert_eq!(Rc::strong_count(&backing), 1);
        assert_eq!(&backing.borrow()[0x1ffe..], &[1, 2]);
    }

    #[test]
    fn touch_all_ages_every_page() {
        let backing = Rc::new(RefCell::new(vec![0u8; 0x2000]));
        let ptr = backing.borrow_mut().as_mut_ptr();
        let mut m = Memory::default();
        unsafe { m.map_external(0x1400_0000, ptr, 0x2000, backing.clone()) };
        m.map(0x1F00_0000, &[0; 0x1000]);
        let seen = m.clock();
        // une écriture du jeu, invisible pour l'horloge
        unsafe { *ptr.add(0x1800) = 1 };
        assert!(m.stamp(0x1400_0000, 0x2000) <= seen);
        m.touch_all();
        assert!(m.stamp(0x1400_0000, 0x1000) > seen);
        assert!(m.stamp(0x1400_1000, 0x1000) > seen);
        assert!(m.stamp(0x1F00_0000, 0x1000) > seen, "toutes les régions, pas seulement les externes");
        assert!(m.clock() > seen);
    }

    #[test]
    fn translate_ranges() {
        assert_eq!(translate(0x1800_0000), Some(0x1F00_0000));
        assert_eq!(translate(0x2000_0000), Some(0x1400_0000));
        assert_eq!(translate(0x3000_0000), None);
    }
}
