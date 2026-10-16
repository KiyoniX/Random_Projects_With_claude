# Règles de travail

## Qualité du code (toujours)

- **KISS.** La solution la plus simple qui marche. Pas d'abstraction pour un seul usage, pas d'option que personne n'a demandée.
- **Pas de répétition.** Avant d'écrire une fonction, chercher si elle existe déjà (`grep`) : un lecteur, un décodeur, un utilitaire de chemin ou d'affichage existe sans doute dans `outils/`, `banc/` ou `recomp/`. On réutilise, on n'en recopie pas une variante. Deux blocs presque identiques se factorisent dès la deuxième fois.
- **Coller au code voisin** : identifiants en anglais (variables, fonctions, noms donnés en reverse, nouveaux fichiers de code), textes pour l'utilisateur en français (commentaires, fiches, messages, commits). Même densité de commentaires, mêmes idiomes. Un commentaire dit pourquoi, pas ce que fait la ligne.
- **Prouver avant d'affirmer.** Une affirmation sur le binaire cite sa preuve : adresse, octets, référence croisée, trace du banc ou sortie de REA. Ce qu'on suppose est écrit comme supposé.
- **Tester ce qu'on touche** : `python outils/tests.py`, `python banc/tests.py`, `python recomp/tests.py`, `python mods/tests.py`, `cargo test` dans `decompil-3ds/portage/`. Un résultat qui échoue se rapporte tel quel.
- **Avant de coder, se demander comment un pro l'aurait fait**, et regarder si un projet open source reconnu l'a déjà résolu (voir `decompil-3ds/outils/REFERENCES.md`). On reprend l'idée ou la spec, en respectant la licence.

## Décompil 3DS

- **Ce qui ne sort jamais** : rien du jeu ni de la console n'est versionné (dumps, code, fichiers, textes, pseudo-code recopié, clés, OTP, certificats, identifiants de console). Tout ça vit dans `decompil-3ds/local/`, exclu par le `.gitignore`. Les tests versionnés fabriquent leurs données.
- **Portage natif, pas émulation** : recompilation statique et runtime Rust + wgpu (Vulkan). Les émulateurs (Azahar, zakuro…) sont des références à lire ou des oracles de test, jamais le runtime. Le banc Python reste la référence contre laquelle chaque morceau Rust est vérifié.
- **Reprise sur une autre machine** : `decompil-3ds/REPRISE.md`. La source de vérité de l'avancement est `etat.json`.
- **Commits** : à la fin d'un gros jalon, en français. Pousser seulement sur demande, après un `git fetch` (deux PC).
- **Jamais de capture de l'écran entier** : le bureau de l'utilisateur est privé. Pour prouver ce qu'affiche une fenêtre du portage, utiliser `portage play --screenshot-at T PRÉFIXE`, qui ne lit que sa propre image.
- **Continuer sans attendre** : quand une tâche est finie, enchaîner sur le chantier suivant de `etat.json` ; les décisions qui reviennent à l'utilisateur restent notées dans le rapport sans bloquer le reste.

## Sous-agents

Définis dans `.claude/agents/`. Le modèle suit la difficulté, pas l'habitude :

| Agent | Modèle | Pour quoi |
| --- | --- | --- |
| `reverse` | opus | Lire une fonction, un module ou un service dans Ghidra/REA et en tirer une fiche prouvée |
| `verificateur` | opus | Relire en adversaire une fiche, un correctif ou du code recompilé, et chercher ce qui est faux |
| `chercheur` | sonnet | Documentation et dépôts : 3dbrew, Azahar, Luma3DS, pk3DS, PKHeX, specs de formats |
| `executant` | haiku | Tâches mécaniques et longues : lancer des passes, collecter des journaux, comptages, renommages en masse |

Par défaut on travaille en Opus à l'effort maximal ; Sonnet et Haiku seulement pour ce qui ne demande pas de jugement. Fable n'est pris que si la tâche l'exige vraiment. Les agents qui lisent le même module en parallèle écrivent leurs notes dans `local/analyse/<module>/`, puis un `verificateur` relit avant que rien n'entre dans `fiches/`.
