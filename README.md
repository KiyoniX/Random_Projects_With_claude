# Random Projects With Claude

Petits projets construits avec Claude Code.

| Dossier | Ce que c'est | Pour le lancer |
| --- | --- | --- |
| `dev-tycoon` | Jeu de gestion : on code seul, on recrute des devs, on leur paie des formations, et on surprend ceux qui trichent avec une IA. | Ouvrir `index.html` |
| `mondes` | Trois pages reliées qui construisent un univers à partir d'une graine (voir ci-dessous). | Ouvrir `atlas-des-mondes/index.html` |
| `erosion-rust` | Simulateur d'érosion en Rust : eau, gel, chimie, vent, glaciers et végétation, avec vingt paramètres. | `cargo run --release` |

Les projets web tournent sans installation ni connexion.

## Le dossier `mondes`

Une même graine donne une planète, la langue de son peuple et son histoire. Chaque page a des boutons vers les deux autres.

| Sous-dossier | Ce que c'est |
| --- | --- |
| `atlas-des-mondes` | Générateur de planètes : climat, biomes, espèces adaptées à leur milieu, peuple et cités. |
| `langues-inventees` | Fabrique de langues : sons, grammaire, écriture, traduction du français et évolution sur 2 000 ans. |
| `chroniques` | Mille ans d'histoire du peuple : frise, carte animée, guerres, cités, souverains, racontés dans sa langue. |

Les trois sous-dossiers doivent rester côte à côte : ils partagent leur code.
