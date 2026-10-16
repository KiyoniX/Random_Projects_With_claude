//! L'espace d'adresses d'un programme 3DS, tenu sur PC (même rôle que `banc/memory.py`).
//!
//! Chaque plage projetée est adossée à une « réserve » (`Backing`) : un bloc de mémoire du PC, à zéro et pris seulement
//! quand on y touche. Deux plages peuvent partager la même réserve : c'est ce qui donne les alias de la console (le miroir
//! des modules .cro que fait ro, `MapMemoryBlock` d'un bloc partagé, `ControlMemory` MAP).
//!
//! Le processeur ne voit cet espace qu'à travers un `PageSink` : la table de pages du C recompilé (page de 4 Kio ->
//! pointeur du PC). Les services lisent et écrivent directement dans les réserves.

use std::fmt;
use std::rc::Rc;

pub const PAGE: u32 = 0x1000;

pub const PERM_R: u32 = 1;
pub const PERM_W: u32 = 2;
pub const PERM_X: u32 = 4;
pub const PERM_RW: u32 = PERM_R | PERM_W;
pub const PERM_RX: u32 = PERM_R | PERM_X;
pub const PERM_RWX: u32 = PERM_R | PERM_W | PERM_X;

/// Accès à une adresse que rien ne projette (ou projection refusée).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemError(pub String);

impl fmt::Display for MemError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for MemError {}

pub type MemResult<T> = Result<T, MemError>;

pub fn align_up(value: u32) -> u32 {
    value.wrapping_add(PAGE - 1) & !(PAGE - 1)
}

pub fn align_down(value: u32) -> u32 {
    value & !(PAGE - 1)
}

/// Un bloc de mémoire du PC, à adresse fixe tant qu'il vit, à zéro au départ.
pub struct Backing {
    ptr: *mut u8,
    pub size: usize,
    pub name: String,
}

#[cfg(windows)]
mod os {
    unsafe extern "system" {
        fn VirtualAlloc(address: *mut u8, size: usize, kind: u32, protect: u32) -> *mut u8;
        fn VirtualFree(address: *mut u8, size: usize, kind: u32) -> i32;
    }
    const MEM_COMMIT_RESERVE: u32 = 0x3000;
    const MEM_RELEASE: u32 = 0x8000;
    const PAGE_READWRITE: u32 = 4;

    /// Pages à zéro prises à la demande (comme le `mmap` anonyme du banc).
    pub fn alloc(size: usize) -> *mut u8 {
        unsafe { VirtualAlloc(std::ptr::null_mut(), size, MEM_COMMIT_RESERVE, PAGE_READWRITE) }
    }

    pub fn free(ptr: *mut u8, _size: usize) {
        unsafe {
            VirtualFree(ptr, 0, MEM_RELEASE);
        }
    }
}

#[cfg(not(windows))]
mod os {
    use std::alloc::{Layout, alloc_zeroed, dealloc};

    pub fn alloc(size: usize) -> *mut u8 {
        unsafe { alloc_zeroed(Layout::from_size_align(size, 4096).unwrap()) }
    }

    pub fn free(ptr: *mut u8, size: usize) {
        unsafe { dealloc(ptr, Layout::from_size_align(size, 4096).unwrap()) }
    }
}

impl Backing {
    pub fn new(size: u32, name: &str) -> Rc<Backing> {
        let size = align_up(size.max(PAGE)) as usize;
        let ptr = os::alloc(size);
        assert!(!ptr.is_null(), "plus de mémoire du PC pour la réserve {name} ({size:#x} octets)");
        Rc::new(Backing { ptr, size, name: name.to_string() })
    }

    /// L'adresse du PC du premier octet.
    pub fn address(&self) -> *mut u8 {
        self.ptr
    }

    pub fn read(&self, offset: usize, len: usize) -> Vec<u8> {
        assert!(offset + len <= self.size);
        let mut out = vec![0u8; len];
        unsafe { std::ptr::copy_nonoverlapping(self.ptr.add(offset), out.as_mut_ptr(), len) };
        out
    }

    pub fn write(&self, offset: usize, data: &[u8]) {
        assert!(offset + data.len() <= self.size);
        unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), self.ptr.add(offset), data.len()) };
    }

    pub fn u8(&self, offset: usize) -> u8 {
        assert!(offset < self.size);
        unsafe { *self.ptr.add(offset) }
    }

    pub fn u32(&self, offset: usize) -> u32 {
        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(&self.read(offset, 4));
        u32::from_le_bytes(bytes)
    }

    pub fn w32(&self, offset: usize, value: u32) {
        self.write(offset, &value.to_le_bytes());
    }
}

impl Drop for Backing {
    fn drop(&mut self) {
        os::free(self.ptr, self.size);
    }
}

impl fmt::Debug for Backing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "<Backing {} {:#x}>", self.name, self.size)
    }
}

#[derive(Clone)]
pub struct Region {
    pub start: u32,
    pub size: u32,
    pub perms: u32,
    pub backing: Rc<Backing>,
    pub offset: usize,
    pub name: Rc<str>,
}

impl Region {
    pub fn end(&self) -> u64 {
        self.start as u64 + self.size as u64
    }

    pub fn host_pointer(&self) -> *mut u8 {
        unsafe { self.backing.address().add(self.offset) }
    }
}

/// Ce que le processeur fournit pour suivre les projections : la table de pages (`rt_map` du C recompilé).
pub trait PageSink {
    /// Branche `pages` pages à partir de `first_page` sur le bloc `host` (NULL pour débrancher). `perms` : 1 lecture,
    /// 2 écriture.
    fn map_pages(&mut self, first_page: u32, pages: u32, host: *mut u8, perms: u32);
}

#[derive(Default)]
pub struct AddressSpace {
    /// Triées par adresse, sans chevauchement.
    pub regions: Vec<Region>,
    sink: Option<Box<dyn PageSink>>,
}

impl AddressSpace {
    pub fn new() -> AddressSpace {
        AddressSpace::default()
    }

    pub fn set_sink(&mut self, sink: Box<dyn PageSink>) {
        self.sink = Some(sink);
        let regions = self.regions.clone();
        for region in &regions {
            self.sink_map(region.start, region.size, region);
        }
    }

    fn sink_map(&mut self, start: u32, size: u32, region: &Region) {
        if let Some(sink) = self.sink.as_mut() {
            let host = unsafe { region.host_pointer().add((start - region.start) as usize) };
            sink.map_pages(start >> 12, size >> 12, host, region.perms & 3);
        }
    }

    fn sink_clear(&mut self, start: u32, size: u32) {
        if let Some(sink) = self.sink.as_mut() {
            sink.map_pages(start >> 12, size >> 12, std::ptr::null_mut(), 0);
        }
    }

    // --- projection ---

    /// Projette `[start, start+size)`. Sans réserve donnée, une réserve neuve à zéro est créée.
    pub fn map(&mut self, start: u32, size: u32, perms: u32, name: &str, backing: Option<(&Rc<Backing>, usize)>)
        -> MemResult<Region> {
        if start % PAGE != 0 || size % PAGE != 0 || size == 0 {
            return Err(MemError(format!("projection mal alignée : {start:#x} + {size:#x}")));
        }
        if self.overlaps(start, size) {
            let other = self.find(start).or_else(|| self.find(start + size - 1));
            return Err(MemError(format!("projection {name} {start:#x} + {size:#x} : la plage est déjà prise ({})",
                other.map(|r| r.name.to_string()).unwrap_or_default())));
        }
        let (backing, offset) = match backing {
            Some((b, o)) => (b.clone(), o),
            None => (Backing::new(size, name), 0),
        };
        if offset + size as usize > backing.size {
            return Err(MemError(format!("projection {name} : la réserve {} est trop petite", backing.name)));
        }
        let region = Region { start, size, perms, backing, offset, name: Rc::from(name) };
        self.regions.push(region.clone());
        self.regions.sort_by_key(|r| r.start);
        self.sink_map(start, size, &region);
        Ok(region)
    }

    /// Retire `[start, start+size)` ; une plage coupée en deux garde ses deux morceaux.
    pub fn unmap(&mut self, start: u32, size: u32) {
        let end = start as u64 + size as u64;
        let mut kept = Vec::new();
        for region in &self.regions {
            if region.end() <= start as u64 || region.start as u64 >= end {
                kept.push(region.clone());
                continue;
            }
            if region.start < start {
                let mut head = region.clone();
                head.size = start - region.start;
                kept.push(head);
            }
            if region.end() > end {
                let mut tail = region.clone();
                tail.start = end as u32;
                tail.size = (region.end() - end) as u32;
                tail.offset = region.offset + (end as u32 - region.start) as usize;
                kept.push(tail);
            }
        }
        kept.sort_by_key(|r| r.start);
        self.regions = kept;
        self.sink_clear(start, size);
    }

    pub fn protect(&mut self, start: u32, size: u32, perms: u32) {
        let end = start as u64 + size as u64;
        let mut out = Vec::new();
        for region in &self.regions {
            if region.end() <= start as u64 || region.start as u64 >= end {
                out.push(region.clone());
                continue;
            }
            if region.start < start {
                let mut head = region.clone();
                head.size = start - region.start;
                out.push(head);
            }
            let lo = region.start.max(start);
            let hi = region.end().min(end) as u32;
            let mut mid = region.clone();
            mid.start = lo;
            mid.size = hi - lo;
            mid.perms = perms;
            mid.offset = region.offset + (lo - region.start) as usize;
            out.push(mid);
            if region.end() > end {
                let mut tail = region.clone();
                tail.start = end as u32;
                tail.size = (region.end() - end) as u32;
                tail.offset = region.offset + (end as u32 - region.start) as usize;
                out.push(tail);
            }
        }
        out.sort_by_key(|r| r.start);
        self.regions = out;
        // Comme `NativeCpu.on_protect` : on débranche la plage, puis on rebranche ce qui la recouvre.
        self.sink_clear(start, size);
        let regions = self.regions.clone();
        for region in &regions {
            let lo = region.start.max(start);
            let hi = region.end().min(end) as u32;
            if lo < hi {
                let host = unsafe { region.host_pointer().add((lo - region.start) as usize) };
                if let Some(sink) = self.sink.as_mut() {
                    sink.map_pages(lo >> 12, (hi - lo) >> 12, host, region.perms & 3);
                }
            }
        }
    }

    pub fn overlaps(&self, start: u32, size: u32) -> bool {
        let end = start as u64 + size as u64;
        self.regions.iter().any(|r| (r.start as u64) < end && (start as u64) < r.end())
    }

    pub fn find(&self, address: u32) -> Option<&Region> {
        // Les plages sont triées : recherche dichotomique.
        let index = self.regions.partition_point(|r| r.start <= address);
        if index == 0 {
            return None;
        }
        let region = &self.regions[index - 1];
        if (address as u64) < region.end() { Some(region) } else { None }
    }

    pub fn is_mapped(&self, mut address: u32, mut size: u32) -> bool {
        while size > 0 {
            let Some(region) = self.find(address) else { return false };
            let step = (size as u64).min(region.end() - address as u64) as u32;
            address = address.wrapping_add(step);
            size -= step;
        }
        true
    }

    /// La première plage libre de cette taille entre `low` et `high`, ou `None`.
    pub fn find_free(&self, low: u32, high: u32, size: u32) -> Option<u32> {
        let mut cursor = align_up(low) as u64;
        for region in &self.regions {
            if region.end() <= cursor {
                continue;
            }
            if region.start >= high {
                break;
            }
            if (region.start as u64) - cursor >= size as u64 {
                return Some(cursor as u32);
            }
            cursor = cursor.max(align_up(region.end() as u32) as u64);
        }
        if cursor + size as u64 <= high as u64 { Some(cursor as u32) } else { None }
    }

    /// (réserve, décalage) derrière une adresse.
    pub fn backing_at(&self, address: u32) -> Option<(Rc<Backing>, usize)> {
        let region = self.find(address)?;
        Some((region.backing.clone(), region.offset + (address - region.start) as usize))
    }

    // --- lecture et écriture depuis Rust ---

    pub fn read(&self, mut address: u32, size: u32) -> MemResult<Vec<u8>> {
        let mut out = Vec::with_capacity(size as usize);
        let mut left = size;
        while left > 0 {
            let region = self.find(address).ok_or_else(|| MemError(format!("lecture hors mémoire à {address:#010x}")))?;
            let at = region.offset + (address - region.start) as usize;
            let step = (left as u64).min(region.end() - address as u64) as u32;
            out.extend_from_slice(&region.backing.read(at, step as usize));
            address = address.wrapping_add(step);
            left -= step;
        }
        Ok(out)
    }

    pub fn write(&self, mut address: u32, data: &[u8]) -> MemResult<()> {
        let mut pos = 0usize;
        while pos < data.len() {
            let region = self.find(address).ok_or_else(|| MemError(format!("écriture hors mémoire à {address:#010x}")))?;
            let at = region.offset + (address - region.start) as usize;
            let step = ((data.len() - pos) as u64).min(region.end() - address as u64) as usize;
            region.backing.write(at, &data[pos..pos + step]);
            address = address.wrapping_add(step as u32);
            pos += step;
        }
        Ok(())
    }

    pub fn fill(&self, address: u32, size: u32, byte: u8) -> MemResult<()> {
        self.write(address, &vec![byte; size as usize])
    }

    pub fn u8(&self, address: u32) -> MemResult<u8> {
        Ok(self.read(address, 1)?[0])
    }

    pub fn u16(&self, address: u32) -> MemResult<u16> {
        let b = self.read(address, 2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    pub fn u32(&self, address: u32) -> MemResult<u32> {
        let b = self.read(address, 4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub fn u64(&self, address: u32) -> MemResult<u64> {
        let b = self.read(address, 8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(&b);
        Ok(u64::from_le_bytes(a))
    }

    pub fn w8(&self, address: u32, value: u32) -> MemResult<()> {
        self.write(address, &[value as u8])
    }

    pub fn w16(&self, address: u32, value: u32) -> MemResult<()> {
        self.write(address, &(value as u16).to_le_bytes())
    }

    pub fn w32(&self, address: u32, value: u32) -> MemResult<()> {
        self.write(address, &value.to_le_bytes())
    }

    pub fn w64(&self, address: u32, value: u64) -> MemResult<()> {
        self.write(address, &value.to_le_bytes())
    }

    pub fn words(&self, address: u32, count: usize) -> MemResult<Vec<u32>> {
        let raw = self.read(address, (count * 4) as u32)?;
        Ok(raw.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
    }

    /// Une chaîne C (octets lus comme Latin-1), au plus `limit` octets ; s'arrête à la fin de la mémoire projetée.
    pub fn cstring(&self, address: u32, limit: u32) -> String {
        let mut out = String::new();
        for i in 0..limit {
            match self.u8(address.wrapping_add(i)) {
                Ok(0) | Err(_) => break,
                Ok(byte) => out.push(byte as char),
            }
        }
        out
    }

    pub fn describe(&self) -> Vec<String> {
        self.regions
            .iter()
            .map(|r| {
                format!("{:#010x}-{:#010x} {}{}{} {}", r.start, r.end(), if r.perms & 1 != 0 { 'r' } else { '-' },
                    if r.perms & 2 != 0 { 'w' } else { '-' }, if r.perms & 4 != 0 { 'x' } else { '-' }, r.name)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_read_write_and_alias() {
        let mut space = AddressSpace::new();
        let region = space.map(0x1000_0000, 0x2000, PERM_RW, "a", None).unwrap();
        space.write(0x1000_0ffe, &[1, 2, 3, 4]).unwrap(); // à cheval sur deux pages
        assert_eq!(space.read(0x1000_0ffe, 4).unwrap(), vec![1, 2, 3, 4]);
        assert_eq!(space.u32(0x1000_0ffe).unwrap(), 0x0403_0201);
        // alias : la même réserve à une autre adresse
        space.map(0x2000_0000, 0x1000, PERM_RW, "alias", Some((&region.backing, 0x1000))).unwrap();
        assert_eq!(space.u8(0x2000_0000).unwrap(), 3);
        space.w8(0x2000_0001, 9).unwrap();
        assert_eq!(space.u8(0x1000_1001).unwrap(), 9);
        assert!(space.map(0x1000_1000, 0x1000, PERM_R, "chevauche", None).is_err());
        assert!(space.read(0x3000_0000, 1).is_err());
    }

    #[test]
    fn unmap_splits_and_protect() {
        let mut space = AddressSpace::new();
        space.map(0x1000_0000, 0x4000, PERM_RW, "a", None).unwrap();
        space.write(0x1000_3000, &[7]).unwrap();
        space.unmap(0x1000_1000, 0x1000);
        assert!(space.is_mapped(0x1000_0000, 0x1000));
        assert!(!space.is_mapped(0x1000_1000, 1));
        assert_eq!(space.u8(0x1000_3000).unwrap(), 7);
        space.protect(0x1000_2000, 0x1000, PERM_R);
        assert_eq!(space.find(0x1000_2000).unwrap().perms, PERM_R);
        assert_eq!(space.find(0x1000_3000).unwrap().perms, PERM_RW);
        assert_eq!(space.u8(0x1000_3000).unwrap(), 7);
    }

    #[test]
    fn find_free_skips_regions() {
        let mut space = AddressSpace::new();
        space.map(0x1400_0000, 0x1000, PERM_RW, "a", None).unwrap();
        space.map(0x1400_3000, 0x1000, PERM_RW, "b", None).unwrap();
        assert_eq!(space.find_free(0x1400_0000, 0x1500_0000, 0x1000), Some(0x1400_1000));
        assert_eq!(space.find_free(0x1400_0000, 0x1500_0000, 0x3000), Some(0x1400_4000));
        assert_eq!(space.find_free(0x1400_0000, 0x1400_5000, 0x3000), None);
    }
}
