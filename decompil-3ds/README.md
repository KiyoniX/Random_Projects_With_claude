# Décompil 3DS

Un carnet de rétro-ingénierie. La console : une New 3DS XL avec Luma3DS. Le but, à long terme : faire tourner Pokémon X nativement sur PC, sans émulateur.

Ouvre `index.html` : la page montre la feuille de route en sept paliers, l'avancement, les outils présents ou absents, la carte du système et les exercices. Les scripts Python sont dans `outils/` et n'ont besoin que de Python 3.

## Mise en garde

Tu travailles uniquement sur ta propre cartouche, dumpée avec ta propre console. Rien de ce qui en sort n'est versionné ni distribué : ni le dump, ni le code du jeu, ni ses fichiers, ni ses textes. Tout ça vit dans `local/`, que le `.gitignore` du dépôt exclut. Le dépôt ne contient que nos outils et nos notes.

## La marche à suivre

1. **Dumper.** Sur la console, démarre GodMode9 (Start au démarrage). Ouvre la cartouche et copie-la vers `0:/gm9/out`. Puis, sur le fichier, « NCSD image options », « Decrypt file ».
2. **Inspecter.** Copie le `.3ds` déchiffré dans `local/dump/`, puis : `python outils/inspecter.py local/dump/pokemon-x.3ds`. Le script dit si le dump est bien déchiffré et donne son empreinte SHA-256, à noter dans le journal.
3. **Installer les outils.** Pose les zips de ctrtool, makerom et Ghidra dans `local/telechargements/` (les liens sont sur la page), puis : `python outils/installer.py`. Il les déballe dans `local/outils/` et clone les scripts Ghidra 3DS.
4. **Extraire.** `python outils/extraire.py local/dump/pokemon-x.3ds`. Le code va dans `local/extrait/exefs/code.bin`, les fichiers dans `local/extrait/romfs/`, et la liste des GARC dans `local/extrait/inventaire.txt`.
5. **Faire les exercices.** Installe devkitPro avec « 3DS Development », puis suis `exercices/README.md`. On compile de petits programmes dont on connaît le code, et on apprend à les reconnaître dans Ghidra.
6. **Ouvrir le jeu dans Ghidra.** `python outils/elfer.py local/extrait/exefs/code.bin` enveloppe le code dans un ELF chargé à `0x00100000` ; importe-le en ARM v6 little-endian, puis lance les quatre scripts 3DS dans l'ordre. Tout est détaillé dans `outils/GHIDRA.md`.
7. **REA.** C'est l'outil qu'on veut utiliser au quotidien : Claude Code pilote Ghidra à travers lui et doit fournir les preuves de ce qu'il affirme. Il est branché, mais sa version Windows n'ouvre que des exécutables PE x86 : pour l'ARM de la 3DS, il faut le faire tourner sous WSL. `outils/REA.md` explique ce qui est fait, ce qui bloque, et comment lever le blocage.

## Les scripts

| Script | Ce qu'il fait |
| --- | --- |
| `outils/inspecter.py` | Lit l'en-tête d'un dump `.3ds` : titre, code produit, chiffré ou non, empreinte. |
| `outils/installer.py` | Déballe ctrtool, makerom et Ghidra dans `local/outils/`, installe l'extension Jython de Ghidra, clone les scripts Ghidra 3DS et leur pose l'en-tête `@runtime Jython`. |
| `outils/extraire.py` | Sépare le dump en exefs et romfs avec ctrtool, puis inventorie les GARC. |
| `outils/elfer.py` | Enveloppe `code.bin` dans un ELF ARM chargé à `0x00100000`, en trois segments si `exheader.bin` est à côté, pour Ghidra et REA. |
| `outils/garc.py` | Lit, liste, extrait et fabrique les conteneurs GARC des jeux Pokémon. |
| `outils/lz11.py` | Décompresse le LZ10 et le LZ11 de Nintendo, et compresse en LZ11. |
| `outils/texte.py` | Décode et encode les fichiers de texte de X/Y (clé tournante par ligne, variables). |
| `outils/tests.py` | Lance les tests de tous les lecteurs. |
| `outils/verifier.py` | Mesure ce qui est installé et fait, met `etat.json` à jour, écrit `etat.js` pour la page. |
| `outils/REA.md` | Brancher REA à Claude Code, lui désigner notre Ghidra, ce qu'il sait faire et ce qui bloque sous Windows. |
| `outils/GHIDRA.md` | Ghidra pas à pas pour la 3DS : import, scripts, ligne de commande, et le débogueur GDB de Rosalina sur la console. |

Chaque lecteur de format a une sous-commande `test` (par exemple `python outils/texte.py test`). Ils sont testés sur des données fabriquées ; ils restent à valider sur le vrai romfs.

## Le dossier

```
decompil-3ds/
  index.html, style.css, app.js   la page du carnet
  etat.json                       l'état du carnet, à éditer à la main
  etat.js                         écrit par verifier.py, à ne pas éditer
  outils/                         les scripts Python, et les procédures REA.md et GHIDRA.md
  exercices/                      les homebrews à vérité connue, avec leur Makefile
  local/                          jamais versionné
    dump/                         le .3ds de ta cartouche
    extrait/                      exefs, romfs, inventaire
    telechargements/              les zips des outils
    outils/                       les outils déballés (ctrtool, makerom, Ghidra, scripts)
```

## Mettre la page à jour

1. Édite `etat.json` : coche les tâches faites, ajoute une ligne au journal, change la prochaine action.
2. Lance `python outils/verifier.py`. Il regarde ce qui est installé, le dump et l'extraction, coche ce qu'il sait mesurer, et réécrit `etat.js`.
3. Recharge `index.html`.

La page lit `etat.js` et pas `etat.json`, parce qu'une page ouverte en `file://` ne peut pas charger un `.json`.
