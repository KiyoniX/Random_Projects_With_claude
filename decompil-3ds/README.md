# Décompil 3DS

Un carnet de rétro-ingénierie. La console : une New 3DS XL avec Luma3DS. Le but, à long terme : faire tourner Pokémon X nativement sur PC, sans émulateur.

Ouvre `index.html` : l'avancement brut (une carte des fonctions par binaire, les tableaux par groupe, par binaire, par palier) et le journal des commits, lus dans `etat.js`. Les scripts Python sont dans `outils/` et n'ont besoin que de Python 3.

## Mise en garde

Tu travailles uniquement sur ton propre jeu, acheté et installé sur ta propre console, dumpé par elle. Rien de ce qui en sort n'est versionné ni distribué : ni le dump, ni le code du jeu, ni ses fichiers, ni ses textes. Tout ça vit dans `local/`, que le `.gitignore` du dépôt exclut. Le dépôt ne contient que nos outils et nos notes.

## La journée du 14 octobre

`JOURNEE.md` est le programme de la première journée consacrée à la console elle-même : ce qu'il faut préparer la veille, les fichiers à sortir de la 3DS (NAND, ROM de démarrage, FIRM, modules système, Pokémon X), dans quel ordre les ouvrir, et quoi lire en premier dans Ghidra.

## La marche à suivre

1. **Dumper.** Le jeu est une copie numérique (la cartouche est morte). Sur la console, démarre GodMode9 (Start au démarrage), appuie sur HOME, choisis « Title manager » puis `[A:] SD CARD`. Sélectionne Pokémon X, A, « Manage Title... », « Dump CXI/NDS file » : le fichier `.cxi`, déjà déchiffré, arrive dans `0:/gm9/out`. Si une mise à jour du jeu est installée, dumpe-la aussi : c'est elle qui porte le code qui tourne vraiment.
2. **Inspecter.** Copie le `.cxi` dans `local/dump/`, puis : `python outils/inspecter.py local/dump/pokemon-x.cxi`. Le script dit si le dump est bien déchiffré et donne son empreinte SHA-256, à noter dans le journal. Une image de cartouche `.3ds` marche aussi.
3. **Installer les outils.** Pose les zips de ctrtool, makerom et Ghidra dans `local/telechargements/` (les liens sont sur la page), puis : `python outils/installer.py`. Il les déballe dans `local/outils/` et clone les scripts Ghidra 3DS.
4. **Extraire.** `python outils/extraire.py local/dump/pokemon-x.cxi`. Le code va dans `local/extrait/exefs/code.bin`, l'en-tête étendu dans `local/extrait/exefs/exheader.bin`, les fichiers dans `local/extrait/romfs/`, et la liste des GARC dans `local/extrait/inventaire.txt`.
5. **Faire les exercices.** Installe devkitPro avec « 3DS Development », puis suis `exercices/README.md`. On compile de petits programmes dont on connaît le code, et on apprend à les reconnaître dans Ghidra.
6. **Ouvrir le jeu dans Ghidra.** `python outils/elfer.py local/extrait/exefs/code.bin` enveloppe le code dans un ELF chargé à `0x00100000` ; importe-le en ARM v6 little-endian, puis lance les quatre scripts 3DS dans l'ordre. Tout est détaillé dans `outils/GHIDRA.md`.
7. **REA.** C'est l'outil qu'on veut utiliser au quotidien : Claude Code pilote Ghidra à travers lui et doit fournir les preuves de ce qu'il affirme. Il est branché, mais sa version Windows n'ouvre que des exécutables PE x86 : pour l'ARM de la 3DS, il faut le faire tourner sous WSL. `outils/REA.md` explique ce qui est fait, ce qui bloque, et comment lever le blocage.

## Les outils voisins sur le site

Trois projets du dépôt accompagnent le carnet, dans l'étagère « La 3DS ouverte » du portail : `explorateur-romfs` parcourt le romfs extrait dans le navigateur (GARC, LZ11, textes, images, modèles), `visionneuse-bch` rend les modèles 3D de Game Freak, et `carte-des-services` donne les modules, services, commandes IPC et SVC de la console d'après 3dbrew.

## Les scripts

| Script | Ce qu'il fait |
| --- | --- |
| `outils/inspecter.py` | Lit l'en-tête d'un dump, `.cxi` de titre installé ou `.3ds` de cartouche : titre, code produit, chiffré ou non, empreinte. |
| `outils/installer.py` | Déballe ctrtool, makerom et Ghidra dans `local/outils/`, installe l'extension Jython de Ghidra, clone les scripts Ghidra 3DS et leur pose l'en-tête `@runtime Jython`. |
| `outils/extraire.py` | Sépare le dump en exefs et romfs avec ctrtool, puis inventorie les GARC. |
| `outils/nand.py` | Lit la sauvegarde NAND sur PC (clés tirées à l'exécution de boot9 et de l'OTP, par pyctr) : liste les titres de la CTRNAND, en sort les modules et archives système déchiffrés, la police partagée et la configuration de `cfg`. Mode d'emploi dans `outils/REA.md`, partie 4 quater. |
| `outils/elfer.py` | Enveloppe `code.bin` dans un ELF ARM chargé à `0x00100000`, en trois segments si `exheader.bin` est à côté, pour Ghidra et REA. |
| `outils/garc.py` | Lit, liste, extrait et fabrique les conteneurs GARC des jeux Pokémon. |
| `outils/lz11.py` | Décompresse le LZ10 et le LZ11 de Nintendo, et compresse en LZ11. |
| `outils/texte.py` | Décode et encode les fichiers de texte de X/Y (clé tournante par ligne, variables). |
| `outils/tests.py` | Lance les tests de tous les lecteurs. |
| `banc/run.py` | Le banc d'essai : fait démarrer Pokémon X sur PC (processeur émulé pour l'instant, couche système écrite d'après les fiches), et écrit le journal de chaque appel dans `local/analyse/banc/`. Mode d'emploi dans `banc/README.md`. Avec `--dessiner`, il dessine aussi les images du jeu dans `local/analyse/banc/images/`. |
| `recomp/recomp.py` | Traduit le code ARM et Thumb de `code.bin` en C, que clang compile pour le PC ; `recomp/validate.py` compare chaque fonction à unicorn. Le C produit reste dans `local/recomp/`. Mode d'emploi dans `recomp/README.md`. `recomp/cro_recomp.py` fait de même pour les 133 modules `.cro`, en C relogeable (la base du module est lue à l'exécution). |
| `portage/` | Le portage PC en Rust + wgpu (Vulkan). Le rendu (`pica`) rejoue les images du GPU de la 3DS sur la carte graphique à 60 images/s, à la résolution native ou en 2×, 3× et 4×, comparées pixel par pixel au banc. Le runtime (`kernel`, `services`, `hostcpu`, `cro`, `romfs`, `runtime`) fait tourner le code du jeu recompilé, avec un journal identique à celui du banc (`runtime run`, `runtime compare`). Les mods passent par `overlay.json`. Mode d'emploi dans `portage/README.md`, `cargo test` dans ce dossier. |
| `mods/build.py` | Le moteur de mods (romhacks, fangames) : un mod décrit ses changements en TOML sans octet du jeu, et la construction produit le dossier LayeredFS pour Luma3DS sur la console et la surcouche du romfs pour le PC (`banc/run.py --mod`). Mode d'emploi dans `mods/README.md`, tests par `python mods/tests.py`. |
| `outils/name_pass.py` | La passe de nommage du code du jeu, qu'on peut relancer : `run` propose des noms (services, symboles des `.cro`, enrobages d'appels système, bibliothèque standard reconnue en l'exécutant, destructeurs lus dans les tables virtuelles, fichiers source cités) avec leur source et leur confiance dans `local/analyse/names/` ; `apply` verse ceux de confiance haute dans `fiches/`. |
| `REPRISE.md` | Reprendre le chantier sur une autre machine : remonter `local/` depuis les zips (`outils/pack_local.py`, `outils/reassembler.py`), quoi installer et régénérer, où on en est, et les directives de travail. |
| `outils/verifier.py` | Mesure ce qui est installé et fait, met `etat.json` à jour, écrit `etat.js` pour la page. |
| `outils/REA.md` | Brancher REA à Claude Code, lui désigner notre Ghidra, ce qu'il sait faire et ce qui bloque sous Windows. |
| `outils/GHIDRA.md` | Ghidra pas à pas pour la 3DS : import, scripts, ligne de commande, et le débogueur GDB de Rosalina sur la console. |

Chaque lecteur de format a une sous-commande `test` (par exemple `python outils/texte.py test`). Ils sont testés sur des données fabriquées ; ils restent à valider sur le vrai romfs.

## Le dossier

```
decompil-3ds/
  index.html                     la page : avancement et journal, lus dans etat.js
  etat.json                       l'état du carnet, à éditer à la main
  etat.js                         écrit par verifier.py, à ne pas éditer
  outils/                         les scripts Python, et les procédures REA.md et GHIDRA.md
  banc/                           le banc d'essai : le jeu qui démarre sur PC (voir banc/README.md)
  recomp/                         la recompilation du code ARM du jeu en C (voir recomp/README.md)
  exercices/                      les homebrews à vérité connue, avec leur Makefile
  local/                          jamais versionné
    dump/                         le .cxi de ton jeu installé
    extrait/                      exefs, romfs, inventaire
    telechargements/              les zips des outils
    outils/                       les outils déballés (ctrtool, makerom, Ghidra, scripts)
```

## Mettre la page à jour

1. Édite `etat.json` : coche les tâches faites, ajoute une ligne au journal, change la prochaine action.
2. Lance `python outils/verifier.py`. Il regarde ce qui est installé, le dump et l'extraction, coche ce qu'il sait mesurer, et réécrit `etat.js`.
3. Recharge `index.html`.

La page lit `etat.js` et pas `etat.json`, parce qu'une page ouverte en `file://` ne peut pas charger un `.json`.
