//! Ce que la fenêtre lit elle-même dans les fichiers du jeu pour dessiner les boutons du combat : les noms des capacités
//! (texte 13 de `a/0/7/5`, le français, quelle que soit la langue choisie au lancement du jeu : à suivre si l'on joue dans
//! une autre langue) et leurs données (`a/2/1/2` : type à l'octet 0, catégorie à l'octet 2, voir
//! `mods/modkit/formats/moves.py`). Les formats sont ceux d'`outils/garc.py` et d'`outils/texte.py`, en lecture seule.

const GARC: u32 = 0x4741_5243;
const FATO: u32 = 0x4641_544F;
const FATB: u32 = 0x4641_5442;
const FIMB: u32 = 0x4649_4D42;

fn u16_at(d: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(d.get(o..o + 2)?.try_into().ok()?))
}

fn u32_at(d: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(d.get(o..o + 4)?.try_into().ok()?))
}

/// Le premier sous-fichier de chaque numéro d'un GARC (`None` si ce n'en est pas un).
pub fn garc_files(d: &[u8]) -> Option<Vec<Vec<u8>>> {
    if u32_at(d, 0)? != GARC || u16_at(d, 8)? != 0xFEFF {
        return None;
    }
    let header = u32_at(d, 4)? as usize;
    let data_start = u32_at(d, 0x10)? as usize;
    if u32_at(d, header)? != FATO {
        return None;
    }
    let fato_size = u32_at(d, header + 4)? as usize;
    let count = u16_at(d, header + 8)? as usize;
    let fatb = header + fato_size;
    if u32_at(d, fatb)? != FATB || u32_at(d, fatb + u32_at(d, fatb + 4)? as usize)? != FIMB {
        return None;
    }
    (0..count)
        .map(|i| {
            let mut p = fatb + 0xC + u32_at(d, header + 0xC + 4 * i)? as usize;
            let vector = u32_at(d, p)?;
            p += 4;
            if vector == 0 {
                return Some(Vec::new());
            }
            let (start, length) = (u32_at(d, p)? as usize, u32_at(d, p + 8)? as usize);
            Some(d.get(data_start + start..data_start + start + length)?.to_vec())
        })
        .collect()
}

/// Les lignes d'un fichier de texte, sans leurs commandes (variables, pauses) : ce qu'un bouton montre.
pub fn text_lines(d: &[u8]) -> Option<Vec<String>> {
    let (count, start) = (u16_at(d, 2)? as usize, u32_at(d, 0xC)? as usize);
    (0..count)
        .map(|i| {
            let offset = u32_at(d, start + 4 + 8 * i)? as usize;
            let words = u16_at(d, start + 8 + 8 * i)? as usize;
            let mut key = (0x7C89u32 + 0x2983 * i as u32) as u16;
            let mut plain = Vec::with_capacity(words);
            for k in 0..words {
                plain.push(u16_at(d, start + offset + 2 * k)? ^ key);
                key = key.rotate_left(3);
            }
            let mut out = String::new();
            let mut k = 0;
            while k < plain.len() && plain[k] != 0 {
                if plain[k] == 0x10 {
                    // une commande : 0x10, nombre de mots qui suivent le code, code, arguments
                    k += 2 + plain.get(k + 1).copied().unwrap_or(0) as usize;
                    continue;
                }
                out.push(game_char(plain[k]));
                k += 1;
            }
            Some(out)
        })
        .collect()
}

/// Une capacité telle que la montrent les boutons : nom, type (ordre du jeu), PP de base (octet 5).
pub struct MoveInfo {
    pub name: String,
    pub kind: u8,
    pub pp: u8,
}

/// Un caractère du jeu : l'UTF-16, sauf ses symboles privés.
fn game_char(w: u16) -> char {
    match w {
        0xE08E => '♂',
        0xE08F => '♀',
        0xE08D => '…',
        0xE07F => '\u{202F}',
        w => char::from_u32(w as u32).unwrap_or('?'),
    }
}

/// Le texte `n` du fichier de textes (`a/0/7/5`) : 96 les noms des objets (`local/analyse/DllBattle/sac-natif.md`), 80 ceux
/// des espèces (`equipe-natif.md`).
pub fn game_text(names: &[u8], n: usize) -> Option<Vec<String>> {
    text_lines(garc_files(names)?.get(n)?)
}

/// Ce qu'on lit d'un Pokémon chiffré (format pk6 de PKHeX, comme `outils/pk6.py`) : surnom, œuf, genre (0 mâle, 1 femelle,
/// 2 aucun).
pub struct Pk6 {
    pub nickname: String,
    pub egg: bool,
    pub gender: u8,
}

/// La place de chaque bloc A, B, C, D pour chacun des 24 mélanges (PKHeX, BlockPosition).
const PK6_PLACES: [u8; 96] = [
    0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2, 2, 0, 1, 3, 3, 0, 1, 2,
    2, 0, 3, 1, 3, 0, 2, 1, 1, 2, 0, 3, 1, 3, 0, 2, 2, 1, 0, 3, 3, 1, 0, 2, 2, 3, 0, 1, 3, 2, 0, 1, 1, 2, 3, 0, 1, 3, 2, 0,
    2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 0,
];

/// Déchiffre les 0xE8 premiers octets d'un pk6 : clé u32 à +0, mots de +8 à +0xE8 XOR les 16 bits hauts du générateur
/// 0x41C64E6D, 0x6073 ; blocs de 0x38 mélangés selon (clé >> 13) & 31 modulo 24. Surnom UTF-16 au bloc B (12 caractères),
/// œuf au bit 30 de l'u32 bloc B + 0x34, genre aux bits 1-2 de l'octet bloc A + 0x15 (`equipe-natif.md`).
pub fn pk6(data: &[u8]) -> Option<Pk6> {
    let key = u32_at(data, 0)?;
    let mut plain = data.get(..0xE8)?.to_vec();
    let mut seed = key;
    for i in (8..0xE8).step_by(2) {
        seed = seed.wrapping_mul(0x41C6_4E6D).wrapping_add(0x6073);
        let w = u16::from_le_bytes([plain[i], plain[i + 1]]) ^ (seed >> 16) as u16;
        plain[i..i + 2].copy_from_slice(&w.to_le_bytes());
    }
    // la somme des mots du corps : un Pokémon mal lu ne donne rien
    let sum = (8..0xE8).step_by(2).fold(0u16, |s, i| s.wrapping_add(u16::from_le_bytes([plain[i], plain[i + 1]])));
    (sum == u16_at(&plain, 6)?).then_some(())?;
    let shuffle = ((key >> 13) & 31) as usize % 24;
    let block = |k: usize| 8 + PK6_PLACES[shuffle * 4 + k] as usize * 0x38;
    let (a, b) = (block(0), block(1));
    let nickname = (0..12).map(|k| u16_at(&plain, b + 2 * k).unwrap_or(0)).take_while(|&w| w != 0).map(game_char).collect();
    let egg = u32_at(&plain, b + 0x34)? >> 30 & 1 == 1;
    Some(Pk6 { nickname, egg, gender: if egg { 2 } else { plain[a + 0x15] >> 1 & 3 } })
}

/// Les capacités du jeu, par numéro.
pub fn moves(names: &[u8], data: &[u8]) -> Option<Vec<MoveInfo>> {
    let names = text_lines(garc_files(names)?.get(13)?)?;
    let data = garc_files(data)?;
    Some(
        names
            .into_iter()
            .enumerate()
            .map(|(i, name)| {
                let byte = |at: usize| data.get(i).and_then(|e| e.get(at)).copied().unwrap_or(0);
                MoveInfo { name, kind: byte(0), pp: byte(5) }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un GARC fabriqué : un sous-fichier par numéro (vide si `None`).
    fn garc(files: &[Option<&[u8]>]) -> Vec<u8> {
        let header = 0x1C;
        let mut fato = Vec::new();
        let mut fatb = Vec::new();
        let mut data = Vec::new();
        for f in files {
            fato.extend((fatb.len() as u32).to_le_bytes());
            match f {
                Some(bytes) => {
                    fatb.extend(1u32.to_le_bytes());
                    for v in [data.len() as u32, (data.len() + bytes.len()) as u32, bytes.len() as u32] {
                        fatb.extend(v.to_le_bytes());
                    }
                    data.extend_from_slice(bytes);
                }
                None => fatb.extend(0u32.to_le_bytes()),
            }
        }
        let fato_size = 0xC + fato.len();
        let fatb_size = 0xC + fatb.len();
        let data_start = header + fato_size + fatb_size + 0xC;
        let mut out = Vec::new();
        out.extend(GARC.to_le_bytes());
        out.extend((header as u32).to_le_bytes());
        out.extend(0xFEFFu16.to_le_bytes());
        out.extend(0x0400u16.to_le_bytes());
        out.extend(4u32.to_le_bytes());
        out.extend((data_start as u32).to_le_bytes());
        out.extend(((data_start + data.len()) as u32).to_le_bytes());
        out.extend(0u32.to_le_bytes());
        out.extend(FATO.to_le_bytes());
        out.extend((fato_size as u32).to_le_bytes());
        out.extend((files.len() as u16).to_le_bytes());
        out.extend(0xFFFFu16.to_le_bytes());
        out.extend(fato);
        out.extend(FATB.to_le_bytes());
        out.extend((fatb_size as u32).to_le_bytes());
        out.extend((files.len() as u32).to_le_bytes());
        out.extend(fatb);
        out.extend(FIMB.to_le_bytes());
        out.extend(0xCu32.to_le_bytes());
        out.extend((data.len() as u32).to_le_bytes());
        out.extend(data);
        out
    }

    /// Un fichier de texte fabriqué, chiffré comme le jeu (clé de ligne, rotation de 3 bits).
    fn text(lines: &[&[u16]]) -> Vec<u8> {
        let mut table = Vec::new();
        let mut body = Vec::new();
        let body_start = 4 + 8 * lines.len();
        for (i, words) in lines.iter().enumerate() {
            let mut key = (0x7C89u32 + 0x2983 * i as u32) as u16;
            let mut raw = Vec::new();
            for &w in words.iter().chain(&[0]) {
                raw.extend((w ^ key).to_le_bytes());
                key = key.rotate_left(3);
            }
            table.extend(((body_start + body.len()) as u32).to_le_bytes());
            table.extend(((raw.len() / 2) as u16).to_le_bytes());
            table.extend(0u16.to_le_bytes());
            body.extend(raw);
        }
        let length = 4 + table.len() + body.len();
        let mut out = Vec::new();
        out.extend(1u16.to_le_bytes());
        out.extend((lines.len() as u16).to_le_bytes());
        out.extend((length as u32).to_le_bytes());
        out.extend(0u32.to_le_bytes());
        out.extend(0x10u32.to_le_bytes());
        out.extend((length as u32).to_le_bytes());
        out.extend(table);
        out.extend(body);
        out
    }

    #[test]
    fn names_and_data_of_the_moves() {
        let word = |s: &str| s.encode_utf16().collect::<Vec<_>>();
        let (empty, charge, flame) = (word("—"), word("Charge"), word("Flammèche"));
        // une variable au milieu (0x10, 1 mot après le code, code 0x0107) : sautée
        let mut odd = word("A");
        odd.extend([0x10, 1, 0x0107]);
        odd.extend(word("B♀").iter().map(|&w| if w == '♀' as u16 { 0xE08F } else { w }));
        let names = text(&[&empty, &charge, &flame, &odd]);
        let items = text(&[&empty, &word("Potion")]);
        let mut texts: Vec<Option<&[u8]>> = vec![None; 97];
        texts[13] = Some(&names);
        texts[96] = Some(&items);
        let names_garc = garc(&texts);
        let data_garc = garc(&[Some(&[0; 36]), Some(&[0, 0, 1, 40, 100, 35]), Some(&[9, 0, 2, 40, 100, 25]), None]);
        let moves = moves(&names_garc, &data_garc).unwrap();
        assert_eq!(moves.len(), 4);
        assert_eq!((moves[1].name.as_str(), moves[1].kind), ("Charge", 0));
        assert_eq!((moves[2].name.as_str(), moves[2].kind, moves[2].pp), ("Flammèche", 9, 25));
        assert_eq!(moves[3].name, "AB♀");
        assert_eq!(game_text(&names_garc, 96).unwrap()[1], "Potion");
        assert!(garc_files(b"pas un GARC").is_none());
    }

    #[test]
    fn a_pk6_gives_its_nickname() {
        // un Pokémon fabriqué en clair (mélange 5 : B est le quatrième bloc), puis chiffré comme le jeu
        let key: u32 = 5 << 13;
        let mut plain = vec![0u8; 0xE8];
        plain[..4].copy_from_slice(&key.to_le_bytes());
        let b = 8 + PK6_PLACES[5 * 4 + 1] as usize * 0x38;
        let a = 8 + PK6_PLACES[5 * 4] as usize * 0x38;
        for (k, w) in "Goat".encode_utf16().enumerate() {
            plain[b + 2 * k..b + 2 * k + 2].copy_from_slice(&w.to_le_bytes());
        }
        plain[a + 0x15] = 1 << 1;
        let sum = (8..0xE8).step_by(2).fold(0u16, |s, i| s.wrapping_add(u16::from_le_bytes([plain[i], plain[i + 1]])));
        plain[6..8].copy_from_slice(&sum.to_le_bytes());
        let mut data = plain.clone();
        let mut seed = key;
        for i in (8..0xE8).step_by(2) {
            seed = seed.wrapping_mul(0x41C6_4E6D).wrapping_add(0x6073);
            let w = u16::from_le_bytes([plain[i], plain[i + 1]]) ^ (seed >> 16) as u16;
            data[i..i + 2].copy_from_slice(&w.to_le_bytes());
        }
        let p = pk6(&data).unwrap();
        assert_eq!((p.nickname.as_str(), p.egg, p.gender), ("Goat", false, 1));
        data[0x20] ^= 1;
        assert!(pk6(&data).is_none(), "la somme ne tombe plus juste");
    }
}
