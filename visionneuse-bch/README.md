# Visionneuse BCH

Les modèles 3D BCH (ou H3D) du moteur de Game Freak sur 3DS, présentés en vitrine dans le navigateur : maillages, textures, squelette et animations de squelette, rendus en WebGL écrit à la main.

Ouvre `index.html` et glisse dans la vitrine un `.bch`, un GARC qui en contient, ou un paquet de Pokémon (PC, GR, MM…). Aucun fichier de jeu n'est fourni : la page s'ouvre vide. Le bouton « Poser le cube d'essai » montre l'outil sur un petit BCH qu'elle fabrique elle-même.

- **Caméra** : glisser pour tourner, molette pour approcher (centrée sur le curseur), Maj + glisser ou clic du milieu pour déplacer ; « Ensemble », `0` ou `Origine` pour revenir à la vue d'ensemble.
- **Lecteur** : choisis une animation dans la fiche. La manivelle avance d'une image par vingt-quatrième de tour, et un clic dessus (ou `Espace`) lance ou arrête la lecture. Les réglettes donnent l'image et la vitesse, et `←` `→` avancent image par image.
- **Exports** : capture PNG de la vitrine, et OBJ + MTL des maillages visibles dans la pose affichée, avec les textures en PNG, dans une archive ZIP.
- Les GARC et le LZ11 passent par `../explorateur-romfs/formats.js`. Sans lui, la page n'accepte que les `.bch` nus et le dit.

## Ce qui est lu

Le format est porté depuis SPICA et Ohana3DS Rebirth de gdkchan, et depuis 3dbrew pour les registres du GPU. Les fichiers et classes portés sont cités en commentaire dans `bch.js`.

| Partie | Lecture | Confiance |
| --- | --- | --- |
| En-tête, sections, table de relocalisation (versions 5 à 0x23) | complète | haute : c'est le relocateur de SPICA |
| Commandes GPU PICA200, uniformes en 32 et 24 bits, attributs fixes | complète | haute |
| Sommets déduits des registres (format, permutation, taille, échelles, décalage) | complète | haute |
| Sous-maillages, palettes d'os, peau lisse et rigide, triangles, bandes, éventails | complète | haute |
| Textures tuilées en Morton : les 14 formats, dont ETC1 et ETC1A4 | complète | haute |
| Squelette : transformations locales, matrices inverses, compensation d'échelle | complète | haute |
| Animations de squelette à courbes (8 quantifications), par quaternions et par matrices | complète | moyenne, voir ci-dessous |
| Matériaux : textures, enveloppes, transformation des UV, test alpha, mélange | partielle | moyenne |
| Combineurs de texture, éclairage par tables, brouillard, caméras | non lus | — |
| Animations de matériaux, de visibilité, de lumière, de caméra | non lues, signalées | — |

Les courbes d'animation n'ont pas la même mise en page avant la version 0x20 (X/Y) selon SPICA et selon Ohana. La page reconnaît laquelle des deux elle a sous les yeux, et signale le cas d'Ohana dans les observations. Les maillages de silhouette (contours) sont écartés, comme le fait Ohana.

## Ce qui est vérifié

`node tests.js` lance 38 tests, sans navigateur :

- les décodeurs des formats directs et d'ETC1 / ETC1A4, sur des blocs fabriqués dont la réponse est calculée à la main ;
- l'ordre de Morton, contre la table de SPICA ;
- la lecture d'une suite de commandes GPU fabriquée (écritures consécutives, paramètres multiples, remplissage, uniformes en 32 et 24 bits) ;
- les huit quantifications de clés, et l'interpolation en palier, linéaire et d'Hermite (comparée à la formule de Bernstein) ;
- un BCH entier écrit par `fabrique.js`, un cube texturé à un os, en version 7 et en version 0x21 : maillages, attributs, textures RGBA8 et ETC1A4, matériaux, squelette, trois animations (courbes, quantifiées, par images), peau lisse et rigide.

**Ce qui attend un vrai fichier.** L'écrivain et le lecteur sont de la même main : les tests prouvent qu'ils s'accordent avec ma lecture de SPICA, pas que cette lecture colle aux fichiers de Game Freak. Restent donc à confirmer sur un dump : l'emplacement des paramètres de matériau et de leurs commandes (SPICA dit +0xC8, Ohana +0xC0 ; la page essaie les deux), la mise en page des courbes en version 7, le sens des faces (tout est dessiné des deux côtés) et le rendu des textures secondaires, aujourd'hui ignoré. Soleil et Lune rangent leurs modèles de Pokémon dans un autre format (GFModel), que cette page ne lit pas.

## Fichiers

- `bch.js` : lecture et rendu ; pose `window.BCH = { lire, rendre, estBCH }`, que l'explorateur de romfs charge aussi.
- `app.js`, `index.html`, `style.css` : la page.
- `fabrique.js` : l'écrivain du cube d'essai.
- `tests.js` : les tests.
