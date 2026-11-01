//! Lire et écrire l'état du jeu en mémoire, pour Archipelago et les mods : le sac, les drapeaux, l'argent, les badges.
//! Adresses et preuves dans `fiches/pokemon-x-archipelago.md`.
//!
//! Les écritures reprennent ce que font les fonctions du jeu (`myitem_add_item`, `eventwork_set_flag`…) sans les appeler :
//! le code recompilé ne se lance pas de l'extérieur entre deux tranches. À faire entre deux tranches du jeu, jamais pendant.

use kernel::memory::AddressSpace;

/// `[GAME_MANAGER] + 0x1c` : les données de jeu ; leur premier mot : `SaveData`.
const GAME_MANAGER: u32 = 0x5EDA08;
const MY_ITEM: u32 = 0x2D4;
const MISC: u32 = 0x3410;
const EVENT_WORK: u32 = 0x13148;
const FLAGS: u32 = 0x2F4;
const FLAG_COUNT: u32 = 0xD00;
const MONEY: u32 = 0x10;
const BADGES: u32 = 0x14;
const MONEY_MAX: u32 = 9_999_999;
const ITEM_COUNT_MAX: u32 = 999;
/// Le plus grand numéro d'objet qui ait une poche à lui (`item_get_pocket_id`).
const LAST_ITEM: u32 = 0x2CD;
/// Le pointeur vers la table de `item_get_pocket_id` : un quartet par objet.
const POCKET_TABLE: u32 = 0x5D4B28;
/// Pour chaque poche, par numéro : le décalage dans `MYITEM` du pointeur vers ses cases, et son nombre de cases.
const POCKETS: [(u32, u32); 5] = [(0xB8C, 400), (0xB98, 64), (0xB94, 106), (0xB9C, 72), (0xB90, 96)];

fn word(memory: &AddressSpace, address: u32) -> Option<u32> {
    memory.read(address, 4).ok().map(|d| u32::from_le_bytes([d[0], d[1], d[2], d[3]]))
}

/// La sauvegarde en mémoire. Elle n'existe que dans une partie chargée : tant qu'on n'y est pas, tout rend `None`.
pub struct GameState<'a> {
    memory: &'a AddressSpace,
    save: u32,
}

impl<'a> GameState<'a> {
    pub fn find(memory: &'a AddressSpace) -> Option<GameState<'a>> {
        let save = word(memory, word(memory, word(memory, GAME_MANAGER)? + 0x1C)?)?;
        (save != 0).then_some(GameState { memory, save })
    }

    /// `eventwork_get_flag`, pour un drapeau de sauvegarde (id de 1 à 0xCFF).
    pub fn flag(&self, id: u32) -> Option<bool> {
        if id == 0 || id >= FLAG_COUNT {
            return None;
        }
        let byte = self.memory.read(self.save + EVENT_WORK + FLAGS + id / 8, 1).ok()?[0];
        Some(byte >> (id % 8) & 1 != 0)
    }

    /// `eventwork_set_flag`.
    pub fn set_flag(&self, id: u32) -> Option<()> {
        if id == 0 || id >= FLAG_COUNT {
            return None;
        }
        let address = self.save + EVENT_WORK + FLAGS + id / 8;
        let byte = self.memory.read(address, 1).ok()?[0];
        self.memory.write(address, &[byte | 1 << (id % 8)]).ok()
    }

    pub fn money(&self) -> Option<u32> {
        word(self.memory, self.save + MISC + MONEY)
    }

    /// `misc_add_money` : plafonné comme dans le jeu.
    pub fn add_money(&self, amount: u32) -> Option<()> {
        let value = self.money()?.saturating_add(amount).min(MONEY_MAX);
        self.memory.write(self.save + MISC + MONEY, &value.to_le_bytes()).ok()
    }

    pub fn badges(&self) -> Option<u32> {
        Some((word(self.memory, self.save + MISC + BADGES)? & 0xFF).count_ones())
    }

    /// `misc_set_badge`.
    pub fn set_badge(&self, badge: u32) -> Option<()> {
        if badge >= 8 {
            return None;
        }
        let bits = word(self.memory, self.save + MISC + BADGES)? | 1 << badge;
        self.memory.write(self.save + MISC + BADGES, &bits.to_le_bytes()).ok()
    }

    /// Les cases `{u16 objet, u16 quantité}` de la poche de cet objet : (adresse, nombre de cases).
    fn pocket(&self, item: u32) -> Option<(u32, u32)> {
        let index = if item > LAST_ITEM {
            0
        } else {
            let nibble = self.memory.read(word(self.memory, POCKET_TABLE)? + item / 2, 1).ok()?[0];
            (if item % 2 == 0 { nibble >> 4 } else { nibble & 0xF }) as usize // pair : le quartet haut (0x3a0d94)
        };
        let (pointer, slots) = *POCKETS.get(index)?;
        Some((word(self.memory, self.save + MY_ITEM + pointer)?, slots))
    }

    /// La quantité de cet objet dans le sac.
    pub fn item_count(&self, item: u32) -> Option<u32> {
        let (pocket, slots) = self.pocket(item)?;
        for slot in 0..slots {
            let entry = word(self.memory, pocket + 4 * slot)?;
            if entry & 0xFFFF == item {
                return Some(entry >> 16);
            }
        }
        Some(0)
    }

    /// `myitem_add_item` : ajoute à la case de l'objet, sinon à la première vide. `false` si la poche est pleine, ou si
    /// l'objet a déjà sa quantité maximale ; dans ce cas, rien ne change, on peut réessayer plus tard.
    pub fn add_item(&self, item: u32, quantity: u32) -> Option<bool> {
        if item == 0 || quantity == 0 {
            return Some(false);
        }
        let (pocket, slots) = self.pocket(item)?;
        let mut empty = None;
        for slot in 0..slots {
            let at = pocket + 4 * slot;
            let entry = word(self.memory, at)?;
            let (id, count) = (entry & 0xFFFF, entry >> 16);
            if id == item {
                if count >= ITEM_COUNT_MAX {
                    return Some(false);
                }
                return Some(self.write_slot(at, item, (count + quantity).min(ITEM_COUNT_MAX)).is_some());
            }
            if id == 0 && empty.is_none() {
                empty = Some(at);
            }
        }
        match empty {
            Some(at) => Some(self.write_slot(at, item, quantity.min(ITEM_COUNT_MAX)).is_some()),
            None => Some(false),
        }
    }

    fn write_slot(&self, at: u32, item: u32, count: u32) -> Option<()> {
        self.memory.write(at, &(item | count << 16).to_le_bytes()).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel::memory::PERM_RW;

    const HEAP: u32 = 0x0800_0000;
    const SAVE: u32 = HEAP + 0x1000;
    const GAME_DATA: u32 = HEAP + 0x100;
    const MANAGER: u32 = HEAP + 0x200;
    /// Les cases de la poche 1.
    const SLOTS: u32 = HEAP + 0x4_0000;

    fn memory() -> AddressSpace {
        let mut m = AddressSpace::new();
        m.map(0x5D_0000, 0x2_0000, PERM_RW, "données", None).unwrap();
        m.map(HEAP, 0x8_0000, PERM_RW, "tas", None).unwrap();
        m.write(GAME_MANAGER, &MANAGER.to_le_bytes()).unwrap();
        m.write(MANAGER + 0x1C, &GAME_DATA.to_le_bytes()).unwrap();
        m.write(GAME_DATA, &SAVE.to_le_bytes()).unwrap();
        m.write(POCKET_TABLE, &(HEAP + 0x300).to_le_bytes()).unwrap();
        m.write(HEAP + 0x300 + 2, &[0x01]).unwrap(); // l'objet 4 en poche 0, l'objet 5 en poche 1
        m.write(SAVE + MY_ITEM + 0xB98, &SLOTS.to_le_bytes()).unwrap();
        m.write(SAVE + MY_ITEM + 0xB8C, &(SLOTS + 0x1000).to_le_bytes()).unwrap();
        m
    }

    #[test]
    fn no_game_no_state() {
        let mut m = AddressSpace::new();
        assert!(GameState::find(&m).is_none(), "rien en mémoire");
        m.map(0x5D_0000, 0x2_0000, PERM_RW, "données", None).unwrap();
        assert!(GameState::find(&m).is_none(), "pointeur encore nul");
    }

    #[test]
    fn flags_money_badges() {
        let m = memory();
        let g = GameState::find(&m).unwrap();
        assert_eq!(g.flag(0x51A), Some(false));
        g.set_flag(0x51A).unwrap();
        assert_eq!(g.flag(0x51A), Some(true));
        assert_eq!(g.flag(0x51B), Some(false));
        assert_eq!(m.read(SAVE + EVENT_WORK + FLAGS + 0x51A / 8, 1).unwrap()[0], 1 << (0x51A % 8));
        assert_eq!((g.flag(0), g.flag(FLAG_COUNT), g.set_flag(FLAG_COUNT)), (None, None, None));
        g.add_money(5).unwrap();
        g.add_money(MONEY_MAX).unwrap();
        assert_eq!(g.money(), Some(MONEY_MAX), "plafonné");
        g.set_badge(3).unwrap();
        g.set_badge(3).unwrap();
        g.set_badge(0).unwrap();
        assert_eq!(g.badges(), Some(2));
        assert_eq!(g.set_badge(8), None);
    }

    #[test]
    fn items_go_to_their_pocket_and_stack() {
        let m = memory();
        let g = GameState::find(&m).unwrap();
        assert_eq!(g.item_count(5), Some(0));
        assert_eq!(g.add_item(5, 3), Some(true));
        assert_eq!(word(&m, SLOTS), Some(5 | 3 << 16), "poche 1");
        assert_eq!(g.add_item(5, 2), Some(true));
        assert_eq!(g.item_count(5), Some(5), "même case");
        assert_eq!(g.add_item(4, 1), Some(true));
        assert_eq!(word(&m, SLOTS + 0x1000), Some(4 | 1 << 16), "poche 0");
        assert_eq!(g.add_item(5, 2000), Some(true));
        assert_eq!(g.item_count(5), Some(ITEM_COUNT_MAX), "plafond");
        assert_eq!(g.add_item(5, 1), Some(false), "déjà au plafond : refusé, rien ne bouge");
        assert_eq!(g.add_item(0, 1), Some(false));
        assert_eq!(word(&m, SLOTS + 4), Some(0));
    }

    #[test]
    fn a_full_pocket_refuses() {
        let m = memory();
        let g = GameState::find(&m).unwrap();
        for slot in 0..64 {
            m.write(SLOTS + 4 * slot, &(100 + slot | 1 << 16).to_le_bytes()).unwrap();
        }
        assert_eq!(g.add_item(5, 1), Some(false));
        assert_eq!(g.add_item(100, 1), Some(true), "un objet déjà là s'ajoute encore");
    }
}
