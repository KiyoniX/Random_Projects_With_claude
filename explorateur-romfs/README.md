# Explorateur de romfs

Le romfs d'un jeu 3DS, extrait sur le PC, parcouru dans le navigateur comme la réserve d'un musée : les dossiers sont des tiroirs de chêne, les GARC des boîtes de conservation, chaque fichier a sa fiche, et un tampon dit ce qu'il est.

Ouvre `index.html` (en local ou sur le site) et glisse le dossier `romfs/` sur la page, ou clique « Ouvrir un dossier ». Un GARC seul ou quelques fichiers isolés marchent aussi. Le romfs sort de `python outils/extraire.py` dans le carnet [`decompil-3ds`](../decompil-3ds/README.md), qui le pose dans `local/extrait/romfs/`. **Aucun fichier de jeu n'est fourni ni versionné, et rien ne quitte le navigateur** : les fichiers sont lus sur place par l'API File.

## Ce que fait la page

- **Inventaire** : l'arbre complet est posé tout de suite ; de chaque fichier, on ne lit que les 64 premiers octets et les 0x28 derniers pour le reconnaître à son magic. Le contenu n'est lu qu'à l'ouverture.
- **GARC** (version 4 de X/Y, version 6 de ROSA) : ouverts comme des boîtes, en numéros et sous-numéros.
- **LZ10 et LZ11** : décompressés à l'ouverture ; les pièces compressées d'une boîte ouverte sont décompressées en fond, par petites tranches, pour savoir ce qu'elles contiennent.
- **Textes de X/Y** : lignes numérotées, variables et commandes visibles sous la forme de pk3DS (`[VAR TRNAME]`, `[WAIT 30]`, `\n`). Pour a/0/7/2 à 9 et a/0/8/0 à 7, un menu passe au même texte dans les autres langues.
- **Images** : BCLIM et BFLIM, et n'importe quel fichier lu à la main comme texture (format, largeur, hauteur, décalage), dans les quatorze formats du GPU. Zoom à la molette centré sur le curseur, glisser pour déplacer, `0` pour la vue d'ensemble.
- **Modèles BCH** : rendus par le moteur de [`visionneuse-bch`](../visionneuse-bch/). S'il n'est pas là, ou s'il ne sait pas lire le fichier, la page le dit et montre l'en-tête.
- **Paquets « mini »** de Game Freak (deux lettres, comme « PC ») : ouverts comme des boîtes.
- **Hexadécimal** avec adresses pour tout le reste.
- **Recherche** dans tous les textes reconnus, sans figer la page ; en cochant « GARC fermés aussi », elle lit chaque GARC fermé pour y trouver des textes.
- **Export** : le sous-fichier courant décompressé (ou tel quel), le texte en `.txt`, l'image en PNG, et un GARC entier éclaté en zip (zip sans compression écrit dans `formats.js`).
- **Filtres** par nom ou chemin et par nature.

## Les fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css`, `app.js` | La page. |
| `formats.js` | Les formats, sans dépendance : pose `window.FORMATS3DS`, que `visionneuse-bch` charge aussi. Marche sous Node. |
| `tests.js`, `tests.html` | Les tests des formats : `node tests.js` ou `tests.html` dans le navigateur. |

`window.FORMATS3DS` :

```js
garc:    { lire(octets) -> { version: 4|6, entrees: [[Uint8Array, ...], ...] }, ecrire(entrees, version) -> Uint8Array }
lz11:    { estCompresse(octets[, tailleTotale]) -> bool, decompresser(octets) -> Uint8Array, compresser(octets) -> Uint8Array }
texte:   { decoder(octets[, { symboles }]) -> [string], encoder(lignes[, { symboles }]) -> Uint8Array, estPlausible(tete, tailleTotale) }
texture: { decoder(octets, format, largeur, hauteur) -> Uint8ClampedArray RGBA, encoder(rgba, format, largeur, hauteur), taille, FORMATS_PICA, FORMATS_CLIM, BPP }
bclim:   { lire(octets) -> { largeur, hauteur, format, rgba, ... }, ecrire(rgba, largeur, hauteur, format), pied(octets) }
mini:    { lire(octets) -> { magic, fichiers }, ecrire(magic, fichiers), entete(tete, tailleTotale) }
zip:     { ecrire([{ nom, octets }]) -> [Uint8Array], crc32(octets) }
nature(octets, nom[, tailleTotale[, pied]]) -> { type, libelle, ... }
```

`type` vaut `garc`, `lz11`, `texte`, `bch`, `bclim`, `mini`, `connu` (magic reconnu, pas ouvert ici : CGFX, CWAV, SARC…), `inconnu` ou `vide`. Les erreurs sont des `Error` en français.

## Ce qui est validé, ce qui attend le vrai romfs

**Validé, sur des données fabriquées** (`node tests.js`, 112 vérifications, et les mêmes dans `tests.html`) :

- GARC, LZ11 et textes sont des portages des scripts Python de `decompil-3ds/outils/`. Les deux versions ont été croisées : pour les mêmes entrées, le GARC (v4 et v6), le flux LZ11 et le fichier de texte écrits par le JavaScript sont identiques, octet pour octet, à ceux du Python, et chacun relit ceux de l'autre. Le zip produit est accepté par `zipfile` de Python.
- Textures : l'ordre de Morton dans les tuiles de 8 × 8, l'ordre des octets de chaque format, les allers-retours des formats simples ; ETC1 et ETC1A4 sur des blocs calculés à la main (mode individuel, mode différentiel, retournement, alpha).
- La page elle-même, dans Chrome sans tête, sur un faux romfs : chargement par le vrai champ de dossier, ouverture des boîtes, textes, images en RGBA8, RGB565, RGBA4, LA8 compressé, ETC1, ETC1A4 et RGBA5551, modèle BCH fabriqué par `visionneuse-bch/fabrique.js`, recherche, exports, clavier, pièces abîmées.

**Attend le vrai romfs de Pokémon X** :

- Le décodage des textes sur de vrais fichiers (décoder les noms des Pokémon, réencoder, comparer à l'octet), et l'ordre des langues dans a/0/7/2 à 9 et a/0/8/0 à 7 (le menu dit « supposé »).
- ETC1 et ETC1A4 sur de vraies images, et le sens des lignes des BCLIM (une case « retourner » est là au cas où).
- Le paquet « mini », écrit de mémoire d'après pk3DS.
- La fluidité sur des milliers de fichiers et des centaines de Mo : l'arbre ne dessine que les lignes visibles et ne lit que les en-têtes, mais seul le faux romfs (42 fichiers, un GARC de 1 500 numéros) a été essayé.

## Sources

- pk3DS de kwsch, https://github.com/kwsch/pk3DS : `TextFile.cs`, `TextVariableCode.cs`, `GARCReference.cs`, et le format mini, par l'intermédiaire de `decompil-3ds/outils/`.
- SPICA de gdkchan, https://github.com/gdkchan/SPICA : `PICA/Converters/TextureConverter.cs` (tuiles, ordre de Morton, octets de chaque format) et `TextureCompression.cs` (ETC1, ETC1A4).
- Ohana3DS-Rebirth de gdkchan, https://github.com/gdkchan/Ohana3DS-Rebirth : `Ohana/Textures/BCLIM.cs` (pied de page CLIM, table des formats).
- Citra, `video_core/texture` : disposition des bits d'un bloc ETC1 lu en petit-boutiste.
- 3dbrew, pages « CLIM » et « GPU/Textures ».
- PKWARE, APPNOTE.TXT, pour le zip.
