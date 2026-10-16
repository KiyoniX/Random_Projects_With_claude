# Projets de référence

Relevé du 16/10/2026 (API GitHub et recherche web). Les chiffres annoncés par les projets eux-mêmes sont notés « selon eux » tant qu'on ne les a pas refaits. La licence dit ce qu'on peut faire : **lire** toujours, **reprendre du code** seulement si elle le permet (MIT, CC0, Unlicense, Apache, 0BSD ; GPL-3 seulement dans un composant lui-même GPL).

## Les plus proches de nos buts : à lire avant d'écrire

| Projet | Licence | Ce qu'on en tire |
| --- | --- | --- |
| [fearkov/3dsrecomp](https://github.com/fearkov/3dsrecomp) | `license = "MIT"` dans les `Cargo.toml` mais pas de fichier LICENSE : lecture seule tant que l'auteur ne l'a pas ajouté | Recompilateur ARM, Thumb et VFP vers C, en Rust. Découverte des fonctions (point d'entrée, appels, exports et relocations des CRO, pointeurs dans les données, imports entre modules, balayage du reste), CRO en C relogeable, comparaison fonction par fonction avec l'interpréteur, boucle « où ai-je dû interpréter » réinjectée au build suivant, surcharges en C. Selon eux, 99,8 % des instructions exécutées viennent du code recompilé sur Pokémon Y et ORAS. |
| [fearkov/zakuro](https://github.com/fearkov/zakuro) | MIT | Émulateur 3DS HLE en Rust, qui interprète ce que 3dsrecomp n'a pas couvert. Second oracle possible à côté du banc. Attention : le dépôt entier tire `recomp-abi` de 3dsrecomp par git ; seule la crate `zakuro-cpu` (interpréteur ARM11, sans dépendance à 3dsrecomp) se reprend proprement. Comparaison détaillée avec notre chaîne : `local/analyse/comparaison-3dsrecomp.md`. |
| [CyrixJD115/PokeXYZ-RDComp](https://github.com/CyrixJD115/PokeXYZ-RDComp) | MIT | Monorepo Pokémon X/Y bâti sur les deux précédents, 3DS-Decomp-Pipeline et objdiff. Selon `docs/general/findings.md` : 71 163 fonctions (exécutable et CRO), 134 binaires redécoupés et reliés à l'identique au SHA-256, tailles et empreintes de `code.bin` en v1.0 et v1.5. Repères à croiser avec nos chiffres. |

## Recompilation statique

- [N64Recomp](https://github.com/N64Recomp/N64Recomp) (MIT) : tables de saut détectées puis listées en TOML, overlays relogeables (l'analogue des CRO), et le système de mods de N64ModernRuntime (hooks de fonctions, mods compilés à part), modèle pour nos mods côté PC.
- [XenonRecomp](https://github.com/hedge-dev/XenonRecomp) (MIT) : analyse des `switch`, hooks « mid-asm » déclarés en configuration.
- [ps3recomp](https://github.com/sp00nznet/ps3recomp) (MIT) : bibliothèque HLE qui remplace les modules système, l'analogue de nos services.
- [Geiger3DS](https://github.com/LiquidFenrir/Geiger3DS) (licence floue, idées seulement) : heuristiques ARM, `switch` en `cmp` puis `ldrls pc`, pools de constantes.

## Émulateurs 3DS, référence par domaine

- [Azahar](https://github.com/azahar-emu/azahar) (GPL-3) : chargeur CRO (`core/hle/service/ldr_ro/cro_helper.cpp`), services IPC (`core/hle/service/`), PICA200 (`video_core`, son rasteriseur logiciel sert d'oracle image par image pour `pica`), DSP HLE (`audio_core/hle`).
- [Panda3DS](https://github.com/wheremyfoodat/Panda3DS) (GPL-3) : le noyau et les services les plus lisibles.
- [mikage-dev](https://github.com/mikage-emu/mikage-dev) : noyau fidèle, modules système exécutés en LLE ; la référence pour décompiler les modules eux-mêmes.
- [dynarmic](https://github.com/azahar-emu/dynarmic) (0BSD) : sémantique ARMv6K (LDREX/STREX, SIMD sur octets et demi-mots), oracle pour `armdec` et `thumbdec`.
- [teakra](https://github.com/wwylele/teakra) (MIT) : le DSP en LLE, pour un son exact.

## Pokémon de 6e génération

- [pk3DS](https://github.com/kwsch/pk3DS) : `CTR/GARC.cs`, `mini.cs`, `TextFile.cs`, et surtout `CTR/CRO.cs`, qui reconstruit les CRO et leurs hash (nécessaire pour des CRO moddés en LayeredFS).
- [PKHeX](https://github.com/kwsch/PKHeX) : structures PK6 et SAV6, vecteurs de test pour la sauvegarde.
- [SPICA](https://github.com/gdkchan/SPICA) (Unlicense) et [Ohana3DS-Rebirth](https://github.com/gdkchan/Ohana3DS-Rebirth) : la spec lisible de BCH (H3D), textures et animations.
- [pokemon-showdown](https://github.com/smogon/pokemon-showdown) (MIT) : oracle de comportement pour le moteur de combat.

## Ghidra et nommage

- [3ds-Ghidra-Scripts-Java](https://github.com/AlgebraManiacABC/3ds-Ghidra-Scripts-Java) : fork Java de nos scripts, avec `ExportSymbols.java` qui alimente le découpage ci-dessous.
- Pas de chargeur CRO maintenu pour Ghidra ; la logique du plugin IDA [wwylele/IDA_plugin_CRO](https://github.com/wwylele/IDA_plugin_CRO) est transposable.
- Pas de base FID publique pour le SDK `nn::`. Ordre conseillé : svc, IPC, RTTI et chaînes d'assert d'abord (ce que fait `name_pass.py`), puis BSim depuis d'autres jeux 3DS nommés, FID seulement pour un même armcc.
- [acnl-decomp](https://github.com/RedShyGuy/acnl-decomp) (CC0) : réécriture de `nn::` (ac, fs, gx, ro, snd, svc, os…), référence libre pour les en-têtes et la sémantique du SDK.

## Décompilation à l'identique

- [objdiff](https://github.com/encounter/objdiff) (Apache-2.0) : comparaison d'objets, gère l'ARMv6K.
- [3DS-Decomp-Pipeline](https://github.com/AlgebraManiacABC/3DS-Decomp-Pipeline) (aucune licence) : découpe `code.bin` et les CRO en objets à partir des exports de Ghidra, recompare en masquant les relocations, reconstruit les CRO au SHA-256.
- armcc, le compilateur du CTR-SDK, est propriétaire. [albw-decomp-ai](https://github.com/7akeem0/albw-decomp-ai) utilise armcc 4.1 b1049 ; PokeXYZ annonce armcc 5.04u5 pour X/Y, sans preuve trouvée. La correspondance octet pour octet n'a de sens qu'avec une copie détenue légalement.
