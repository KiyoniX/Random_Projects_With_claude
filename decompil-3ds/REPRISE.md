# Reprendre le chantier sur une autre machine

Ce fichier s'adresse à la session Claude Code qui reprend `decompil-3ds` sur le PC fixe de l'utilisateur, après la journée du 16 octobre 2026 faite sur son portable. La mémoire de travail de Claude reste sur la machine où elle a été écrite : tout ce qu'il faut savoir est donc ici, dans `etat.json` et dans les README.

## 1. Le code : `git pull`

Tout ce qui est versionné est sur `main` (commit `00fb221` et suivants). Ce qui ne l'est pas, c'est `decompil-3ds/local/` (le dump du jeu et de la console, les extraits, les outils déballés, les sorties générées). Il ne doit **jamais** entrer dans git, ni être distribué.

## 2. Remonter `local/` à partir des zips

L'utilisateur transfère `local/` en plusieurs zips de 950 Mo au plus, faits sur le portable par `python outils/pack_local.py` :
- `decompil-local-001.zip`, `decompil-local-002.zip`… ;
- `manifeste.json`, qui donne le SHA-256 de chaque fichier ;
- `reassembler.py` (le même que `outils/reassembler.py`).

Les trois fichiers de plus de 900 Mo (`dump/nand.bin`, `dump/pokemon-x.cxi`, `extrait/romfs/a/0/0/7`) sont coupés en morceaux `.part001`, `.part002`…

1. Mettre **tous** les zips, `manifeste.json` et `reassembler.py` dans un même dossier.
2. Lancer `python reassembler.py <chemin du dépôt>\decompil-3ds`. Le script extrait tout dans `decompil-3ds/local/`, recolle les morceaux, les efface, puis vérifie la taille et le SHA-256 de chaque fichier. Il doit finir par « N fichiers vérifiés, 0 erreurs ». S'il signale une erreur, un zip manque ou est abîmé : le redemander.

Ce que contiennent les zips : `dump`, `extrait`, `outils` (Ghidra 12.1.4, llvm-mingw, ctrtool, makerom, scripts Ghidra 3DS), `telechargements`, `pylib` (pyctr, unicorn, capstone, pycryptodomex), `sd`, `sauvegarde-sd`, `mods-build`, `recomp/trous.txt` et `trous-cro.txt`, et les captures du GPU (`analyse/pica/*.pkl`, `analyse/terrain/rec2/`, `portage/captures`).

Ce qui n'y est pas, parce que ça se refait : `portage/target*`, le reste de `analyse/` et le code recompilé (`local/recomp/jeu/`).

## 3. Installer ce qui n'est pas dans `local/`

- **Python 3.12** avec `numpy`, `capstone`, `unicorn` (2.1.x), `pillow`. Les outils trouvent aussi `pyctr` et les autres dans `local/pylib/`.
- **Rust** (1.94 ou plus récent, cible MSVC) pour `portage/`. Le rendu force le backend **Vulkan** : il faut un pilote Vulkan (`vulkaninfo --summary`).
- **Node.js** pour les tests de `carte-des-services/` (`node tests.js`, `node corrections.js --check`).
- Facultatif :
  - **devkitPro** (`C:\devkitPro`, paquet 3ds-dev). Son installateur ne marche pas en silencieux. Pour compiler, lancer `C:\devkitPro\msys2\usr\bin\bash.exe -l <script>` avec le script dans un fichier.
  - **WSL Ubuntu** avec Ghidra dans `/opt/ghidra` pour le serveur MCP `rea-wsl` (REA, paquet npm `rea-agents`). Voir `outils/REA.md`. Les outils `outils/ghidra_direct.py` et `outils/emulate_dispatch.py` n'en ont pas besoin : ils utilisent le Ghidra de `local/outils/`.

## 4. Régénérer ce qui se refait

Depuis `decompil-3ds/` :

```
python outils/verifier.py                              # mesure l'état, réécrit etat.js
python outils/ghidra_direct.py maj                     # seulement si local/analyse/maj/gh/funcs.tsv manque (zips d'avant le 16/10 au soir)
python recomp/recomp.py gen --out local/recomp/jeu     # code.bin en C (relit local/recomp/trous.txt)
python recomp/cro_recomp.py gen                        # les 133 modules .cro en C relogeable
python recomp/validate.py build --host                 # jeu-hote.dll (environ 214 Mo)
python recomp/validate.py build --logw                 # jeu-journal.dll, pour --cpu verifier
cd portage && cargo build --release && cargo test      # le portage Rust
cd .. && python outils/tests.py                        # tous les tests Python (lecteurs, banc, recomp, mods)
```

Vérification rapide que tout marche :
- `python banc/run.py --secondes 3 --cpu hybride` doit atteindre P5 ;
- `portage/target/release/runtime run --seconds 3` puis `runtime compare` contre le journal du banc doit dire « aucun écart » ;
- `portage/target/release/portage replay local/portage/captures/terrain2.picacap --scale 2` doit écrire le palais Chaydeuvre en PNG.

## 5. Où on en est, et quoi faire ensuite

La source de vérité est **`etat.json`** : lire d'abord `objectif`, `prochaine_action`, puis les dernières entrées du `journal` et les tâches non faites des paliers (surtout le palier 7). En résumé, au soir du 16/10/2026 :
- **Fiches** : les 59 modules système de la NAND, plus kernel11, Process9 et les bootroms, ont chacun une fiche (`fiches/README.md`). `fiches/safe.md` couvre les variantes du mode sans échec.
- **Banc** : Pokémon X tourne jusqu'au terrain, qui s'affiche en entier. Le code du jeu y tourne en C recompilé (`--cpu hybride`), `.cro` compris.
- **Portage Rust + wgpu (Vulkan)** : le rendu tient 60 images/s au terrain en 1×, 2× et 4×. Le runtime Rust (noyau, IPC, services, code recompilé) donne le même journal que le banc sur 3 s.
- **Moteur de mods** (`mods/`) : sorties pour Luma et pour le PC. Le contrat entre le moteur et le portage est décrit dans `mods/README.md`.
- **Nommage** : 1 239 fonctions du jeu nommées (`outils/name_pass.py`).

Prochains chantiers, dans l'ordre proposé :
1. brancher le rendu `pica` sur les transferts de gsp dans le runtime Rust, pour voir le jeu en direct dans une fenêtre ;
2. finir le cycle des trous de `code.bin` (banc → `trous.txt` → régénération) pour que l'hybride devienne vraiment rapide ;
3. reporter dans la Carte des services les écarts des neuf dernières fiches (am, news, act, dlp, mp, nfc, mvd, nim, qtm) ;
4. compléter `nim`, relancer `emulate_dispatch.py --helper` sur nfc, nim et mvd ;
5. le son, les entrées réelles, puis les applets.

## 6. Les directives de l'utilisateur (elles étaient dans la mémoire du portable)

- **Le but, en trois parties** : la 3DS décompilée à 100 % ; Pokémon X porté nativement sur PC, mieux rendu et plus rapide ; un moteur de mods pour des romhacks et des fangames. Chaque mod doit tourner à la fois sur la console (LayeredFS de Luma) et sur le PC.
- **Le portage PC est en Rust + wgpu sous Vulkan.** Le banc Python reste l'outil d'enquête et la référence : chaque morceau Rust est vérifié contre lui. Le portage ne lit les mods que par la sortie `mods/build.py --pc` (`overlay.json`, format 1).
- **Identifiants en anglais** (variables, fonctions, noms donnés en reverse, nouveaux fichiers de code). **Textes pour l'utilisateur en français** (commentaires, fiches, messages, commits).
- **Sous-agents** (directive du 16/10 au soir, qui remplace l'ancienne « sonnet par défaut ») : Opus à l'effort maximal par défaut, Sonnet pour la recherche documentaire, Haiku pour les tâches mécaniques bien cadrées, Fable seulement si la tâche l'exige. Les agents sont définis dans `.claude/agents/` et les règles de qualité (KISS, pas de répétition, « comment un pro ferait ») dans `CLAUDE.md` à la racine. Peu d'agents à la fois. Préparer soi-même ce qui est partagé, donner à chacun un périmètre de fichiers, et vérifier ses résultats dans les octets avant de les intégrer : rejouer une table par `emulate_dispatch.py`, regarder les images, relancer les tests. Les briefs donnés le 16/10 reprenaient les règles de ce fichier.
- **Commits** : seulement à la fin d'un gros jalon. Ne pousser que si l'utilisateur le demande. Messages en français. Avant de pousser, faire `git fetch` : l'utilisateur travaille sur deux PC.
- **Continuer sans attendre** : si toutes les tâches sont finies et que l'utilisateur ne répond pas, enchaîner de soi-même sur le chantier suivant de `etat.json`. Les décisions qui lui reviennent restent en attente dans le rapport, sans bloquer le reste.
- **Jamais dans un fichier versionné** : un octet du jeu ou de la console, une clé, un OTP, un certificat, un identifiant de console. Les tests versionnés fabriquent leurs données.
- **Chaque fiche** sépare ce qui est sûr (deux voies indépendantes), ce qui est interprété, et ce qui n'est pas lu.
- **Pièges connus** :
  - un heredoc Bash qui contient du Python perd ses barres obliques inverses : écrire les scripts avec l'outil Write ;
  - `3dbrew.org` peut être bloqué par le pare-feu : passer par `web.archive.org` ;
  - le port USB de la console ne fait que charger : les échanges passent par ftpd sur la console, piloté par `curl` (l'adresse IP change d'un jour à l'autre).
