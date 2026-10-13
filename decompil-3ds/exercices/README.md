# Exercices à vérité connue

Chaque exercice est un petit homebrew dont on a le code. On le compile, on jette le code des yeux, et on retrouve ce qu'il fait à partir du binaire. Comme on connaît la réponse, on apprend à reconnaître les formes. Les questions et les corrections sont dans la page du carnet (`../index.html`, section « Exercices »).

## Préparer

1. Installer devkitPro : <https://devkitpro.org/wiki/Getting_Started>, en cochant « 3DS Development » dans l'installateur (ou, après coup, dans son terminal MSYS2 : `pacman -S 3ds-dev`).
2. Ouvrir le terminal MSYS2 de devkitPro (menu Démarrer, dossier devkitPro) pour que `DEVKITPRO` et `DEVKITARM` soient définis.
3. Dans un exercice, depuis ce terminal : `make`. On obtient :
   - `exNN.elf` : avec les symboles, c'est le corrigé. À ouvrir dans Ghidra quand on est bloqué.
   - `exNN.bin` : le code nu, sans symboles, comme le `code.bin` d'un jeu. C'est le vrai exercice.
   - `exNN.3dsx` : à copier dans `3ds/` sur la carte SD et à lancer depuis le Homebrew Launcher.

## Ouvrir le code nu dans Ghidra

Fichier, Import File, choisir `exNN.bin`. Format « Raw Binary », langage « ARM v6 little endian » (ARM:LE:32:v6). Dans Options, adresse de base `0x00100000`, comme un vrai jeu. Puis lancer l'analyse automatique. Les scripts du dossier `local/outils/ghidra-scripts/` s'ajoutent par le Script Manager (icône de dossier, « Manage Script Directories »).

## Les exercices

| | Ce qu'on apprend à reconnaître |
| --- | --- |
| `01-boucle` | Le prologue et l'épilogue d'une fonction, la boucle principale, les appels de services par leurs enveloppes libctru, les chaînes de caractères et comment remonter de la chaîne à la fonction qui l'emploie. |
| `02-aiguillage` | Un `switch` et ce qu'il devient en `-O2` : une table de sauts. Et une table de pointeurs vers des chaînes. |
| `03-sauvegarde` | Une structure sérialisée : retrouver ses champs et leurs décalages, et l'algorithme de la somme de contrôle à partir du désassemblage. |

Refaire chaque exercice avec `make OPT=-O2` : les mêmes programmes, méconnaissables. C'est l'état dans lequel un jeu est livré. Le Makefile retient le dernier niveau d'optimisation dans `.opt` et recompile tout seul quand il change ; `make` tout court revient à `-O0`.
