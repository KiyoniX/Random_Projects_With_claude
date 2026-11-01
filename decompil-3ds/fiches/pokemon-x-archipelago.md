# Pokémon X : ce qu'il faut à Archipelago

Le sac, les drapeaux, l'argent, les badges et l'équipe, pour une intégration Archipelago. Lot `local/analyse/pokemon-x-ap/`, relu par un vérificateur le 1/11/2026 dans les octets, la RTTI, les tables de natifs des scripts et la sauvegarde. Les noms sont dans `pokemon-x.noms.tsv`.

## Ce qui est sûr

**Les pointeurs.** `[0x5eda08]` → `+0x1c` → `+0` donne le `SaveData` à l'exécution ; `[GameData+0x14]` donne l'équipe, où `GameData` est la valeur de `+0x1c`. Le chemin a été vu dans le champ, à 35, 45 et 60 s du même rejeu : il faut le suivre plutôt que garder ses valeurs. Les noms « GameManager » et « GameData » sont une lecture de rôle, sans chaîne ni RTTI.

Les blocs de `SaveData`, recoupés par leur vtable (RTTI) et par la sauvegarde :

| `SaveData+` | Classe | Dans `main` | Contenu |
| --- | --- | --- | --- |
| `0x2d4`, données à `+4` | `savedata::MYITEM` | `0x400`, `0xb88` octets | le sac |
| `0x3410` | `savedata::Misc` | argent `0x4208`, badges `0x420c` | argent `+0x10`, badges `+0x14` |
| `0x13148`, works à `+4` | `field::EventWork` | `0x14a00` | works 16 bits, id `0x4000` à `0x4177` |
| `0x13148 + 0x2f4` | même objet | `0x14cf0`, `0x1a0` octets | les drapeaux, id < `0xd00` |
| `0x1ef38` | `savedata::BoxPokemon` | | les boîtes |

**Le sac.** Des entrées `{u16 objet, u16 quantité}`, en cinq poches :

| Poche | N° | Pointeur à `MYITEM+` | Capacité |
| --- | --- | --- | --- |
| Objets | 0 | `0xb8c` | 400 |
| Soins | 1 | `0xb98` | 64 |
| CT et CS | 2 | `0xb94` | 106 |
| Baies | 3 | `0xb9c` | 72 |
| Rares | 4 | `0xb90` | 96 |

**Les fonctions.**

| Adresse | Nom | Rôle et pièges |
| --- | --- | --- |
| `0x4362fc` | `myitem_add_item` | `r0 = SaveData+0x2d4`, `r1` objet, `r2` quantité ; rend 1 ou 0. Plafond 999. Déjà à 999 : rend 0 sans écrire. La somme est tronquée à 16 bits avant le plafond (500 + 65100 donne 64). Un objet > `0x2cd` va en poche 0 ; l'objet 0 compte sur la première case vide |
| `0x436378` | `myitem_sub_item` | retire |
| `0x4b1328` | `myitem_can_add` | une case vide rend 1 quelle que soit la quantité |
| `0x4b10c4` | `myitem_get_count` | |
| `0x140474` | `eventwork_get_flag` | `(EventWork, id)` |
| `0x3e4a1c` | `eventwork_set_flag` | |
| `0x11f370` | `eventwork_clear_flag` | |
| `0x3de330`, `0x3de3dc` | `script_work_get`, `script_work_set` | works |
| `0x4b0fe8`, `0x435838`, `0x4357f0`, `0x435854` | `misc_get_money`, `misc_set_money`, `misc_add_money`, `misc_sub_money` | plafond 9 999 999 |
| `0x4b0e54`, `0x4353d8`, `0x4b0e9c` | `misc_get_badge`, `misc_set_badge`, `misc_get_badge_count` | |
| `0x39fa78` | `pokeparty_add` | `r0` équipe, `r1` un `PokemonParam` déjà fabriqué ; refuse si l'équipe a 6 membres |
| `0x42f1ac` | `box_add_pokemon` | |

`myitem_add_item` a 15 appelants, dont la boutique : y accrocher un contrôle compterait aussi les achats. Pour remplacer des récompenses, il faut viser les scripts.

**Savoir ce qui a été pris ou battu : lire un bit.**

| Contrôle | Drapeau | Preuve |
| --- | --- | --- |
| Objet au sol | `0x51a + n` | 207 entités de zone sur 207, aucune écriture constante dans cette bande sur 419 scripts |
| Objet caché | `0x44d + (script - 8000)` | script commun 26, table `0x547118`, `0x4ad2dc` |
| Dresseur | `0x6cc + id` | scripts, natif `0x4a80a8`, 33 drapeaux posés sur 33 ont une entité ; non posé si le joueur perd |

**Trois pièges pour un générateur.**
- **Les objets cachés reviennent.** `0x3c84a8` efface ces drapeaux au hasard par `eventwork_clear_flag` : 30 entrées sur 151 ont un taux non nul. Il faut mémoriser le contrôle ou neutraliser ces 30.
- **Les dresseurs se comptent par id** : 245 entités pour 231 id. Le script 52 et les zones 329 à 333 touchent aussi cette bande (id 0 et 189 à 279).
- **Il y a aussi des objets hors de ces règles** : les poubelles du script 39 passent `n = -1` et n'ont pas de drapeau ; 136 zones appellent `ItemAdd` dans leur propre script, avec leurs propres drapeaux : cadeaux et badges sont à relever zone par zone.

## Ce qui reste supposé

- Le ramassage complet d'un objet au sol n'a pas été exécuté : la chaîne script → `ItemAdd` → `myitem_add_item` est lue, pas tracée. Un appel direct depuis le runtime ajoute bien l'objet, puis le fil d'essai s'arrête au retour : il faut prévoir une vraie adresse de retour.
- Écrire à la main dans le sac, l'argent et un drapeau pendant le jeu : le jeu continue et ces valeurs se retrouvent dans sa sauvegarde suivante (essayé une fois, sur une copie du portage).
- La valeur de `[0x5eda08]` avant le chargement du champ et en combat.
- Que le modèle `0x2001` soit celui des CT (26 entités) : déduit des numéros d'objets.
- Ce qui déclenche `0x3c84a8`, et l'effet à l'écran d'un drapeau posé sur un objet déjà chargé.
- Donner un Pokémon : le natif `PokePartyAdd` prend un indice < `0x13` dans une table de `DllField`, pas une espèce, et fabrique le `PokemonParam` dans `DllField` : ce chemin n'est sûr que dans le champ.

## Ce qui n'est pas lu

Les positions des objets cachés sur la carte, `HideItemInit` (`0x4ad47c`), l'interpréteur des scripts AMX (les opcodes au-dessus de 137 sont déduits de l'usage), le natif en `DllField+0x9f220`, et la cible de victoire d'une partie.
