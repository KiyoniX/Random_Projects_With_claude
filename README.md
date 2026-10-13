# Random Projects With Claude

Petits projets construits avec Claude Code.

Pour tout parcourir, ouvrir `index.html` à la racine : c'est un portail qui présente chaque projet, avec un aperçu vivant au survol et une graine commune qui suit d'un projet à l'autre.

| Dossier | Ce que c'est | Pour le lancer |
| --- | --- | --- |
| `dev-tycoon` | Jeu de gestion : on code seul, on recrute des devs, on leur paie des formations, et on surprend ceux qui trichent avec une IA. | Ouvrir `index.html` |
| `cartes-et-cachots` | Roguelike en ASCII : trois étages générés à explorer, des combats de cartes, un dragon au fond. Une partie dure une dizaine de minutes. Sert aussi de catacombes aux villes de `plans-de-ville`. | Ouvrir `index.html` |
| `plans-de-ville` | Générateur de plans de ville médiévale : remparts, portes, quartiers, parcelles et champs, avec export SVG et PNG. Chaque ville a ses catacombes, son siège et sa rivière, et les cités de l'Atlas des mondes s'y ouvrent. | Ouvrir `index.html` |
| `siege` | Tower defense sur le plan d'une ville générée : les assaillants arrivent par les routes, un front par porte, quatorze vagues. | Ouvrir `index.html` |
| `riviere` | Un fleuve traverse la ville du plan : poser ponts, moulins, digues et quais pour moudre le plus possible sans inonder de quartier, sur une vraie simulation de fluide. | Ouvrir `index.html` |
| `defense-ascii` | Tower defense en ASCII : carte générée, cinq tours améliorables, sept types d'ennemis, vingt vagues puis un mode sans fin. | Ouvrir `index.html` |
| `enquete` | « Nuit blanche au manoir » : un crime généré par graine, des dépositions à recouper, des indices à trouver, une seule solution logique. | Ouvrir `index.html` |
| `flux` | Jeu de réflexion sur une vraie simulation de fluide : dix niveaux où l'on creuse ou pose des parois pour obtenir le meilleur débit, plus un bac à sable. | Ouvrir `index.html` |
| `visite` | La ville d'un plan montée en 3D, à parcourir à pied : maisons à toits, rempart, portes, église et château, avec le plan en parchemin comme carte. | Ouvrir `index.html` |
| `usine` | Jeu d'automatisation : tapis roulants, séparateurs, ponts, filtres et machines à recettes, quatorze niveaux notés sur le débit, le coût et l'emprise, plus un bac à sable. | Ouvrir `index.html` |
| `atelier-pixel` | Éditeur de pixel-art animé : outils de dessin, sélection, calques, frise d'images, pelure d'oignon, export PNG, planche et GIF. | Ouvrir `index.html` |
| `pantin` | Animateur de sprites découpés : on détache les membres d'un dessin, on les épingle les uns aux autres, on pose quelques clés et les images entre deux se calculent. Rotation soignée qui garde les pixels nets, export planche, GIF et vers Atelier Pixel pour la retouche. | Ouvrir `index.html` |
| `textures` | Générateur de textures en pixel-art qui se répètent sans couture : vingt matières réglables, boucles animées, export PNG et vers Atelier Pixel. | Ouvrir `index.html` |
| `palettes` | Générateur de palettes pour le pixel-art : extraction depuis une image, rampes et harmonies, contrastes et daltonisme, export vers Atelier Pixel et Textures. | Ouvrir `index.html` |
| `tuiles` | Éditeur de cartes en tuiles : calques, collisions, objets, raccords automatiques, mode d'essai, export JSON et Tiled. Reprend les tuiles de Textures et les sprites d'Atelier Pixel. | Ouvrir `index.html` |
| `police-pixel` | Éditeur de polices en pixels, accents français compris, qui exporte de vrais fichiers TTF et WOFF. | Ouvrir `index.html` |
| `chiptune` | « La Puce à l'oreille » : séquenceur 8 bits à cinq voix, atelier de bruitages, export WAV, et un `lecteur.js` que les jeux peuvent charger pour avoir du son. | Ouvrir `index.html` |
| `mondes` | Quatre pages reliées qui construisent un univers à partir d'une graine, présentées comme les quatre chapitres d'un guide de voyage (voir ci-dessous). | Ouvrir `atlas-des-mondes/index.html` |
| `ville-a-regles` | Ville qui pousse seule : rues, ménages, emplois, loyers, budget et circulation voiture par voiture. On ne règle que ses lois (tracé, zonage, loyers, bus, impôt). | Ouvrir `index.html` |
| `backrooms` | Dix paliers en vue subjective façon Backrooms : bureaux, parking, piscine et hôtel oublient chacun à leur manière, cinq créatures obéissent chacune à sa règle, et la sortie ne se trouve qu'à l'oreille. | Ouvrir `index.html` |
| `bureau-des-reclamations` | Jeu de guichet façon Papers, Please : sept jours à approuver, refuser ou transmettre des réclamations absurdes, selon un règlement qui change chaque matin. | Ouvrir `index.html` |
| `phare` | Gardien de phare en vue subjective : dix heures de nuit à tenir le feu allumé pour les navires, entre pannes, brume et orages, avec un journal de bord qui s'écrit seul. | Ouvrir `index.html` |
| `erosion-rust` | Simulateur d'érosion en Rust : eau, gel, chimie, vent, glaciers et végétation, avec vingt paramètres. | `cargo run --release` |
| `feu-rust` | Simulateur de feu de forêt en Rust : vent, rafales, humidité, pente et sept essences qui brûlent chacune à leur façon. On allume, on trace des pare-feu, on largue de l'eau. | `cargo run --release` |

Les projets web tournent sans installation ni connexion.

Chaque projet a sa propre identité visuelle, tirée de son sujet. Le principe, les couleurs et les polices de chacun, et la marche à suivre pour en ajouter un sont décrits dans [`DIRECTION-ARTISTIQUE.md`](DIRECTION-ARTISTIQUE.md).

Plusieurs projets se renvoient l'un à l'autre et partagent du code, ils doivent donc rester côte à côte : une cité de l'atlas (`mondes`) ouvre son plan (`plans-de-ville`), et un plan ouvre ses catacombes (`cartes-et-cachots`), son siège (`siege`), sa rivière (`riviere`) et sa visite à pied (`visite`). `textures` et `palettes` exportent vers `atelier-pixel` ; `pantin` ouvre ses projets, lui renvoie ses animations et charge son encodeur GIF ; `palettes` et `tuiles` chargent le moteur de `textures`. Le dossier `portail` contient la page d'accueil.

## Le dossier `mondes`

Une même graine donne une planète, la langue de son peuple, son histoire et les stèles qui la racontent. Les quatre pages sont les chapitres d'un même guide de voyage : des onglets sur la tranche mènent de l'un à l'autre.

| Sous-dossier | Ce que c'est |
| --- | --- |
| `atlas-des-mondes` | Générateur de planètes : climat, biomes, espèces adaptées à leur milieu, peuple et cités. |
| `langues-inventees` | Fabrique de langues : sons, grammaire, écriture, traduction du français et évolution sur 2 000 ans. |
| `chroniques` | Mille ans d'histoire du peuple : frise, carte animée, guerres, cités, souverains, racontés dans sa langue. |
| `steles` | Jeu de déchiffrement : on fouille les cités, on lit l'écriture à partir des noms connus, on retrouve le sens des mots et on reconstitue la chronique. |

Les quatre sous-dossiers doivent rester côte à côte : ils partagent leur code.
