# Le moteur de mods de Pokémon X

Un mod décrit des changements ; il ne contient **aucun octet du jeu**. La construction lit le dump de l'utilisateur
(`local/extrait/romfs/` et `local/extrait/maj/romfs/`, jamais versionnés) et produit deux sorties qui tiennent les mêmes
fichiers :

- la **console** (New 3DS, Luma3DS, LayeredFS) : un dossier `luma/` à copier sur la carte SD ;
- le **PC** : une surcouche que le banc d'essai (`banc/run.py --mod`) superpose au romfs, que le vrai jeu lit.

```
python mods/build.py --console --pc mods/exemples/marisson-muscle   # construit les deux sorties
python mods/build.py --check mod-a mod-b                            # vérifie la pile, liste les conflits, n'écrit rien
python mods/build.py --export personal                              # la table du jeu en TOML, pour partir de là
python banc/run.py --mod mods/exemples/marisson-muscle --sortie local/analyse/mods/   # le jeu lit le mod
python mods/tests.py                                                # les tests (ou : python mods/build.py test)
```

Sorties dans `local/mods-build/` (ignoré par git) : `console/luma/titles/0004000000055D00/romfs/…` (plus `code.ips` si
un mod corrige le code, et `A-LIRE.txt`), et `pc/romfs/…` avec `pc/overlay.json`.

## Le format d'un mod

Un dossier :

```
mon-mod/
  mod.toml            le manifeste (obligatoire)
  personal.toml       statistiques de base, types, talents… des espèces
  moves.toml          données des attaques
  learnset.toml       attaques apprises par niveau
  evolution.toml      évolutions
  eggmoves.toml       attaques d'oeuf
  text.toml           lignes de texte du jeu (noms, descriptions…)
  code.toml           correctifs d'octets dans le code (voir plus bas)
  files/<chemin>      un fichier entier du romfs, qui remplace ou ajoute celui du jeu (files/a/1/8/5)
  garc/<chemin>/N.bin le numéro N d'un GARC remplacé (garc/a/1/8/5/0123.bin, ou 0123-1.bin pour le sous-fichier 1)
```

Tout est facultatif sauf `mod.toml`. `files/` et `garc/` contiennent les fichiers du mod (un modèle, une texture, un
GARC fabriqué…), jamais ceux du jeu. Les tables sont appliquées après les fichiers et les entrées de GARC.

### mod.toml

```toml
[mod]
id = "marisson-muscle"            # lettres, chiffres, - et _
name = "Marisson musclé"
version = "1.0.0"
author = "…"
description = "…"
game = "pokemon-x-eu"             # le jeu visé ; un mod pour un autre jeu est refusé

[dependencies]                    # ce mod exige ces mods (">=1.2", "==1.0", "<2", "*")
autre-mod = ">=1.2"

[conflicts]                       # ce mod refuse de tourner avec ceux-ci
ancien-mod = "*"

[order]
after = ["autre-mod"]             # à charger après lui s'il est là, sans l'exiger
```

### Les tables

Les espèces se désignent par leur numéro (`[species.650]`) ou par leur nom anglais (`[species.Chespin]`) ; les
attaques de même (`"Ember"`). Les numéros viennent de la table du jeu : 1 à 721 les espèces, au-delà les formes.

```toml
# personal.toml : seuls les champs écrits changent
[species.Chespin]
hp = 80
type1 = "grass"            # un numéro ou un nom de type anglais
tm_add = [3, 4]            # ou tm_remove, ou tm_learnable pour tout remplacer (numéros de bits 0 à 127)

# learnset.toml
[species.Chespin]
add = [[1, "Ember"]]       # [niveau, attaque] ; "moves" remplace tout, "remove" retire des attaques

# evolution.toml
[species.Chespin]
evolutions = [{ method = 4, param = 16, species = "Quilladin", level = 0 }]

# moves.toml
[move.Tackle]
power = 60

# text.toml : [<table>.<langue>] "<numéro de ligne>" = "texte"
[species_names.fr]
650 = "Marissonne"
```

Les champs de `personal` sont dans `modkit/formats/personal.py` ; `python mods/build.py --export personal` écrit la table
du jeu de l'utilisateur en TOML pour s'en inspirer (ne pas la redistribuer : ce sont les données du jeu).

Tables de texte : `species_names`, `move_names`, `move_descriptions`, `ability_names`, `item_names`, `trainer_classes`,
`trainer_names`. Langues : `ja_kana`, `ja_kanji`, `en`, `fr`, `it`, `de`, `es`, `ko`, ou `all`. Les commandes du jeu
s'écrivent comme dans `outils/texte.py` (`\n`, `[VAR TRNAME]`, `[WAIT 30]`).

### Correctifs de code (`code.toml`)

```toml
[[patch]]
address = 0x1234A8                 # adresse virtuelle dans le code de la mise à jour (code.bin chargé en 0x100000)
hex = "00F020E3"
expect_sha1 = "…"                  # facultatif : sha1 des octets d'origine, vérifié sur local/extrait/maj/exefs/code.bin
```

Sur la console, `code.ips` ; sur le PC, **pas encore branché** (le banc charge `code.bin` tel quel).

## Plusieurs mods

`build.py mod-a mod-b` les empile dans cet ordre, modifié seulement par les dépendances et les `after`. Les conflits sont
**signalés**, pas bloquants : deux mods qui donnent des valeurs différentes au même champ, ou un qui remplace un fichier
qu'un autre édite, sont listés (`!` dans la sortie) et le dernier chargé l'emporte. Sont refusés : une dépendance absente
ou trop ancienne, une incompatibilité déclarée, un cycle, un mod visant un autre jeu.

## Ce que fait la console (LayeredFS) — lu dans le code de Luma3DS

Source : `sysmodules/loader/source/patcher.c` et `romfsredir.s` (branche master, lus pour comprendre).

- Le dossier est `/luma/titles/<id du programme>/romfs/` ; l'id est celui du programme, **`0004000000055D00`**, aussi dans
  l'exheader de la mise à jour (octet 0x200), pas `0004000E00055D00`. Interprété d'après ce code, non essayé sur console.
- Luma accroche l'ouverture des fichiers du SDK : tout chemin `rom:/…` (et le point de montage du romfs de mise à jour,
  qu'il cherche dans le code) est cherché d'abord dans ce dossier, puis dans le romfs d'origine. Un seul dossier couvre
  donc le jeu de base **et** la mise à jour ; un fichier entier remplace l'original (aucun correctif partiel).
- Le jeu lit dans la mise à jour les fichiers qu'elle contient (relevé dans les journaux du banc : `a/0/1/2`, `a/0/3/6`,
  `a/0/7/0` à `a/0/7/9`, `a/2/2/5`, `static.crs`, `.crr/static.crr`, les `.cro`) et dans le jeu de base le reste. Le
  moteur applique donc un mod sur la vue « mise à jour par-dessus la base ».
- `code.ips` (`/luma/titles/<id>/code.ips`) et `code.bin`/`code.bps` : décalages relatifs au `.code` décompressé.
- Il faut activer **« Enable game patching »** dans le menu de Luma3DS (Select au démarrage) pour LayeredFS et les IPS.
- Les noms de fichiers sont ceux de la FAT de la carte SD (sans distinction de casse).

## Ce que fait le PC

`banc/romfs.py: overlay_romfs` lit l'arbre du niveau 3 du romfs réel, y remplace ou ajoute les fichiers de `pc/romfs/`,
refabrique les tables (`modkit/romfs3.py`, identiques octet pour octet à l'original quand rien ne change) et sert les
données à la volée, depuis le dump ou depuis le fichier du mod. Le jeu parse lui-même l'arbre qu'on lui rend, exactement
comme il le ferait de l'arbre original. Le journal marque les lectures qui tombent dans un fichier de mod
(`FICHIER DE MOD a/2/1/8+0x10680, … le premier en a/2/1/8+0x1a900 : origine 38 3d 41, servi 50 5f 46`).

## Le contrat avec le portage PC (Rust, `portage/`)

Le portage PC en Rust (`portage/`, ouvert le 16/10/2026) et le banc Python lisent les mods **de la même façon, et
seulement ainsi** : par le dossier que produit `mods/build.py --pc` (`local/mods-build/pc/` : `overlay.json` et
`romfs/`). Ni l'un ni l'autre ne lit un `mod.toml` ou un TOML de tables. Les règles, pour que le moteur de mods et le
portage avancent sans se casser l'un l'autre :

1. **Le moteur de mods ne connaît pas le portage.** Il produit deux sorties, console et PC, et ne sait rien de qui les
   lit. Le portage ne connaît pas les formats du jeu édités par les mods : il sert un romfs dont certains fichiers
   viennent de `romfs/`, comme le fait `banc/romfs.py: overlay_romfs`.
2. **`overlay.json` est un format versionné.** Tout champ ajouté l'est sans casser les lecteurs existants ; un
   changement incompatible augmente un numéro de version et les deux lecteurs (banc et portage) le vérifient. Les tests
   du moteur (`mods/tests.py`) et ceux du portage lisent le même `overlay.json` fabriqué.
3. **Un mod marche d'abord sur la console.** Les ajouts propres au PC (textures en haute définition, modèles
   remplacés, réglages de rendu) iront dans un dossier `pc/` du mod, recopié dans une partie à part de la sortie PC et
   annoncé dans `overlay.json` ; la sortie console les ignore, et un mod doit rester jouable sans eux. Rien de cela
   n'existe encore : le format sera fixé quand le rendu du portage saura remplacer une texture.
4. **Les correctifs de code** (`code.toml`, `code_patches` dans `overlay.json`) : sur la console, Luma les applique au
   chargement. Sur PC, le code du jeu est recompilé en C à l'avance (`recomp/`) : un correctif de code demandera de
   recompiler le `code.bin` corrigé (le recompilateur est déterministe), ou de laisser passer les fonctions touchées
   par l'émulateur. Ce choix est à faire quand le premier vrai correctif de code existera.

## Les formats lus et réécrits (octet pour octet sur tout le dump)

| Format | Fichier | Contenu |
|---|---|---|
| GARC v4 | `outils/garc.py` | 283 fichiers du romfs, relus et réécrits à l'identique (voir « Correction ») |
| Textes | `a/0/7/*`, `a/0/8/*` | 5 808 fichiers de texte, 8 langues ; ligne = mots + drapeaux + queue gardés |
| personal | `a/2/1/8` | 799 entrées de 64 octets + la table entière, recoupées |
| attaques apprises | `a/2/1/4` | 799 fichiers |
| évolutions | `a/2/1/5` | 799 fichiers de 6 emplacements |
| attaques d'oeuf | `a/2/1/3` | 722 fichiers |
| attaques | `a/2/1/2` | 618 fichiers de 36 octets (8 octets nommés, le reste brut) |
| niveau 3 du romfs | `.cxi` | arbre + tables de hachage refabriqués, identiques aux deux romfs |

Les tests (`python mods/tests.py`) fabriquent leurs données pour les cas simples et relisent le vrai dump pour les
allers-retours ; ils se sautent si `local/extrait/` est absent. Exporter les cinq tables en TOML puis les réappliquer
comme un mod ne change aucun octet.

**Correction dans `outils/garc.py`** : `lire` ne rendait que les sous-fichiers présents, donc 18 GARC dont les numéros
ont des emplacements creux (vecteur 0x1BD…) ne se réécrivaient pas à l'identique. Ajout de `lire_vecteurs` et du paramètre
`vecteurs` de `ecrire` (rétrocompatible).

## Sûr, interprété, pas lu

**Sûr** (deux voies) : tout ce qui est dans le tableau ci-dessus pour la forme des octets (aller-retour sur le dump) ;
les valeurs de Bulbizarre et de Charge (noms, statistiques) recoupées avec la documentation de la communauté ; l'indice
des fichiers de texte (80 : noms des espèces, 14 : noms des attaques) lu dans le contenu.

**Interprété** : la signification des champs de `personal` autres que les statistiques, types, talents, objets, expérience
(pk3DS) ; l'ordre des langues (anglais, français, italien, allemand, espagnol vérifiés par le contenu ; japonais x2 et
coréen par élimination) ; les index de `species_names`, `move_names`, `ability_names`, `item_names`, `trainer_*` (lus sur
le contenu, un seul recoupement) ; le comportement de Luma (lu dans son code, non essayé).

**Pas lu** : les 28 derniers octets d'une attaque (effets, drapeaux), le sens des numéros de méthode d'évolution, le
second mot de la table des lignes de texte (gardé tel quel), `unknown_1b` et `unknown_3c` de `personal`, les autres GARC
(modèles, textures, cartes, rencontres, dresseurs, objets).

## Reste à faire

- **Nouveaux modèles 3D, textures, animations** : `files/` et `garc/` savent déjà *poser* un fichier, mais fabriquer un BCH,
  un modèle de combat ou une icône demande un lecteur et un écrivain de ces formats (palier 4 : « Afficher un modèle BCH »).
- **Nouvelles espèces au-delà des 721** : les tables ont 799 entrées (formes comprises) et le code de l'ARM11 borne les
  numéros d'espèce ; en ajouter demande de toucher au code (correctifs `code.toml`) ou, sur PC, au code recompilé.
- **Les autres données** : rencontres sauvages, dresseurs, objets, cartes, scripts d'événements, boutiques, talents.
- **Correctifs de code sur le PC** : lire `code.toml` dans le banc (et le code recompilé).
- Un **moteur d'ajout** (nouveaux fichiers de texte, nouvelles lignes au-delà de la fin d'un fichier) : aujourd'hui une ligne
  se modifie, elle ne s'ajoute pas.
- Un **format d'échange** pour distribuer un mod (archive zip d'un dossier) et son installation.
