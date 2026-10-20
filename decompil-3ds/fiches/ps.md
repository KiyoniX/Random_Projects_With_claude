# ps, les signatures, l'aléa et l'identité de la console

`ps` (Process Services) est le guichet par lequel les autres modules demandent à Process9 ce qu'ils ne peuvent pas faire eux-mêmes : vérifier une signature RSA, déchiffrer en AES, lire l'identifiant de la console ou de la carte de jeu, tirer des octets aléatoires. Le module ne contient **aucun algorithme de chiffrement** : pour tout ce qui touche aux clés, il relaie la requête à `pxi:ps9` (Process9), qui détient les clés. Même l'aléa passe par Process9 : le module rassemble une graine (ticks du système, heure et ticks de `mcu::PLS`) et la passe à `pxi:ps9` SeedRNG (`0x000C0042`), puis lui demande les octets (GenerateRandomBytes, `0x000D0042`).

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), l'aiguillage rejoué par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`. **Cette fiche ne contient ni clé ni constante cryptographique** : elle dit où les choses sont, jamais leur valeur.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000003102`, version 5.0.0 (`v5120`), un titre de la CTRNAND (lu dans l'exheader ; nom `ps`) ; la NAND porte aussi `ps-safe` (non lu) |
| Fichier lu | `local/extrait/ps/exefs/code.bin` et `exheader.bin` |
| Taille | 17 284 octets de code (`0x4384`), 696 de données en lecture seule (`0x2b8`), 904 de données (`0x388`), 4 536 de mémoire à zéro (`0x11b8`) ; pile de 4 096 octets ; priorité de départ 9 |
| Fonctions | 185 pour Ghidra, plus 19 entrées manquées, moins 9 morceaux de la division : 195 (9 en Thumb, 186 en ARM) ; 85 nommées dans `ps.noms.tsv`, 195 avec `local/analyse/ps/noms-proposes.tsv` |
| Services offerts | `ps:ps`, **9 sessions** au plus (octet à `0x105018`) |
| Services appelés | `pxi:ps9` (Process9), `mcu::PLS` (heure et ticks pour l'aléa), `fs:USER` (infos de lancement d'un programme) ; plus `srv:` et le port `err:f`. Ce sont les trois noms de l'exheader ; les chaînes `fs:LDR` et `srv:pm` sont dans le module et ne sont pas ouvertes |
| Autres accès | **aucun** : pas de page matérielle, pas d'interruption |
| Dépendances déclarées | aucune |
| Fils | un seul : le fil principal (comme [mic](mic.md)) |

## Partie 1 : le démarrage et la boucle

`entry` (`0x100000`) enchaîne les initialisations de bibliothèque, puis `ps_main` (`0x100164`, 920 octets) : `srv_init`, `SRV_RegisterService` de `ps:ps` (table à `0x105014` : nom, 9 sessions), notification `0x100` (arrêt), puis la boucle `svcReplyAndReceive` : indice 0 le sémaphore des notifications, indice 1 le port (`svcAcceptSession`), au-delà les sessions, servies par `ps_handle_command` (`0x102464`, contexte `0x106388`). Les sessions n'ont pas de type : un seul service. Le module ouvre `pxi:ps9`, `fs:USER` et `mcu::PLS` au besoin (poignées dans la zone `0x1062xx`) ; la poignée de `pxi:ps9` est à `0x1062a0`, celle de `srv:` à `0x1062ac`.

Un verrou (`lock_enter` `0x10202c`, `lock_leave` `0x10200c`, objet `0x106aa8`) entoure toutes les opérations : deux clients ne parlent pas à Process9 en même temps.

## Partie 2 : les commandes

`ps_handle_command` lit l'en-tête dans le tampon du fil, prend le numéro dans les 16 bits du haut et saute à l'un de 17 cas. Un numéro inconnu rend `0x00000040` et `0xD900182F`. L'en-tête **entier** est comparé pour les commandes à tampon (1, 2, 4, 5, 13 à 17) ; pour les autres, seul le numéro compte. Un en-tête faux rend `0x00000040` et `0xD9001830`. Les noms sont ceux de 3dbrew (« Process Services ») ; adresses et réponses sont lues dans le code et recoupées par `emulate_dispatch.py`.

| N° | En-tête de requête | Commande (3dbrew) | Fonction | Adresse | Relais Process9 | Réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010244` | SignRsaSha256 | `ps_SignRsaSha256` | `0x102bd8` | `0x103164` | `0x00010042` | tampon statique en entrée, tampon du client en écriture ; envoie à `pxi:ps9` avec la taille tirée du champ de longueur de la structure de clé (`+0x200`, divisé par 8) |
| 2 | `0x00020244` | VerifyRsaSha256 | `ps_VerifyRsaSha256` | `0x102ccc` | `0x103224` | `0x00020042` | idem en lecture ; c'est la commande qu'utilisent [cfg](cfg.md) et [dsp](dsp.md) |
| 3 | (numéro seul) | SetAesKey | dans l'aiguillage | | | `0x00030040` | rend `0xD8C107F4` sans rien faire (3dbrew : « just returns error 0xD8C107F4 ») |
| 4 | `0x00040204` | EncryptDecryptAes | `ps_EncryptDecryptAes` | `0x102d0c` | `0x103270` | `0x00040144` | deux tampons (lecture, écriture), paramètres de mode et de clé passés tels quels |
| 5 | `0x00050284` | EncryptSignDecryptVerifyAesCcm | `ps_EncryptSignDecryptVerifyAesCcm` | `0x102ed8` | `0x103394` | `0x00050044` | idem pour l'AES-CCM |
| 6 | (numéro seul) | GetRomId (processID) | `ps_GetRomId` | `0x102f70` | `0x103430` | `0x00060140` | |
| 7 | (numéro seul) | GetRomId2 (processID) | `ps_GetRomId2` | `0x102fec` | `0x103460` | `0x00070180` | |
| 8 | (numéro seul) | GetRomMakerCode (processID) | `ps_GetRomMakerCode` | `0x102c60` | `0x1031ec` | `0x00080080` | rend un octet |
| 9 | (numéro seul) | GetCTRCardAutoStartupBit | `ps_GetCTRCardAutoStartupBit` | `0x102eac` | `0x10335c` | `0x00090080` | rend un octet |
| 10 | (numéro seul) | GetLocalFriendCodeSeed | `ps_GetLocalFriendCodeSeed` | `0x102e40` | `0x1032f4` | `0x000A00C0` | rend 64 bits (que [cfg](cfg.md) range) |
| 11 | (numéro seul) | GetDeviceId | `ps_GetDeviceId` | `0x102ae4` | `0x1030fc` | `0x000B0080` | rend un mot de 32 bits |
| 12 | (numéro seul) | SeedRNG | `ps_SeedRNG` | `0x102b50` | `0x1017e8` (`ps_relay_SeedRNG` → `PXIPS9_SeedRNG` `0x10356c`, `0x000C0042`) | `0x000C0040` | partie 3 |
| 13 | `0x000D0042` | GenerateRandomBytes | `ps_GenerateRandomBytes` | `0x102d94` | `0x1017e8`, puis `0x1032c0` (`ps_relay_GenerateRandomBytes` → `PXIPS9_GenerateRandomBytes` `0x1037dc`, `0x000D0042`) | `0x000D0042` | partie 3 ; utilisée par [ssl](ssl.md) (commandes `SeedRNG` et `GenerateRandomData` du service `ssl:`) |
| 14 | `0x000E0082` | (New 3DS, interface de PXI `0x04010084`) | `ps_cmd000E` | `0x102c18` | `0x1031b0` | `0x000E0042` | au plus `0x20` octets rendus dans un tampon statique ; utilisée par le module NFC |
| 15 | `0x000F0082` | (PXI `0x04020082`) | `ps_cmd000F` | `0x102b10` | `0x103134` | `0x000F0040` | |
| 16 | `0x00100042` | (PXI `0x04030044`) | `ps_cmd0010` | `0x102e6c` | `0x10332c` | `0x00100042` | au plus `0x400` octets |
| 17 | `0x00110042` | (PXI `0x04040044`) | `ps_cmd0011` | `0x102aa4` | `0x1030cc` | `0x00110042` | au plus `0x400` octets |

Les commandes 14 à 17 sont acceptées par le module sur toutes les consoles ; sur une Old 3DS c'est Process9 qui répond « en-tête invalide » (3dbrew). Pour 6 à 8, 3dbrew dit que le module interroge `fs:USER` (`GetProgramLaunchInfo`) avec le numéro de processus, puis, si le support est la carte de jeu, `pxi:ps9` ; erreur `0xC90107FA` si `fs` échoue. Le module ouvre bien `fs:USER` (en-têtes `0x08610042`, `0x08620040`, `0x082F0040` vus dans le code) ; le détail n'est pas lu.

## Partie 3 : le générateur d'aléa

Le module ne calcule pas l'aléa : il prépare la graine et relaie les deux commandes à Process9.

- **SeedRNG** (`ps_SeedRNG`, `0x102b50`) : lit le compteur de ticks du système (`svcGetSystemTick`), la date et l'heure du microcontrôleur (`MCUPLS_GetDatetime`, `mcu::PLS` commande 1, `0x10186c`) et le compteur de ticks du microcontrôleur (`MCUPLS_GetTickCounter`, commande 9, `0x101838`), les assemble en un bloc de `0x14` octets et l'envoie, sous le verrou, à `ps_relay_SeedRNG` (`0x1017e8`), qui la passe à `PXIPS9_SeedRNG` (`0x10356c`).
- **GenerateRandomBytes** (`ps_GenerateRandomBytes`, `0x102d94`) : refait la même mise en graine, puis demande à `ps_relay_GenerateRandomBytes` (`0x1032c0`), donc à `PXIPS9_GenerateRandomBytes` (`0x1037dc`), de remplir le tampon du client. Chaque appel remet donc de l'entropie avant de tirer.

Le générateur et son état sont chez Process9 : `ps_rng_seed` et `ps_rng_generate` de la première version de cette fiche sont deux relais `pxi:ps9`.

## Partie 4 : où sont les clés et les constantes

- **Dans ce module** : rien de cryptographique n'est utilisé par les commandes 1 à 11, qui passent les tampons du client à Process9. Les structures de clé RSA arrivent **du client** (la commande 1 lit la longueur du module RSA dans la structure `+0x200` qu'il envoie, `0x208` octets en tout).
- **Dans le module aussi** : la section de données (`0x106000`, 904 octets) contient les tables de la bibliothèque et les objets globaux (poignées, verrous, réserves) ; je n'y ai pas cherché de constante.
- **Chez Process9** : les clés AES et RSA, l'identifiant de la console (OTP) et la graine du code ami y sont ; voir [process9](process9.md) et [pxi](pxi.md).

## Partie 5 : les services que ps appelle

| Service | En-tête | Pour quoi faire |
| --- | --- | --- |
| `pxi:ps9` (`0x1062A0`) | `0x00020284`, `0x00030284`, `0x00050284`, `0x000401C4`, `0x00060000`, `0x00070000`, `0x00080000`, `0x00090000`, `0x000A0000`, `0x000B0000`, `0x000C0042`, `0x000D0042`, `0x04010084`, `0x04020082`, `0x04030044`, `0x04040044` | les relais des commandes 1 à 11 et 14 à 17 ; les numéros de commande sont ceux du protocole PXI de 3dbrew (« Process Services PXI ») ; les noms exacts des fonctions de relais ne sont pas tous posés |
| `mcu::PLS` | `0x00010000`, `0x00090000` | l'heure et les ticks du microcontrôleur ([mcu](mcu.md)) |
| `fs:USER` | `0x08610042`, `0x08620040`, `0x082F0040` | informations de lancement d'un programme (commandes 6 à 8) |
| `srv:` | `0x00010002`, `0x00020000`, `0x00030100`, `0x000400C0`, `0x000B0000` | les cinq de [sm](sm.md) |
| `err:f` (port) | `0x00010800` | erreur fatale (`ERRF_Throw`, `0x101110`) |

## Partie 6 : qui appelle ps

| Client | Commandes (d'après sa fiche) |
| --- | --- |
| [cfg](cfg.md) | 2 (VerifyRsaSha256) pour les deux fichiers signés ; 10 (graine du code ami) |
| [dsp](dsp.md) | 2 : la signature RSA du composant chargé |
| [ac](ac.md) | 6 et 8 (identifiants de la carte, nommés `PS_GetRomId`, `PS_GetRomMakerCode` dans sa fiche) |
| [ssl](ssl.md) | 12 et 13 : l'aléa de TLS |
| [cecd](cecd.md), [boss](boss.md), [nwm](nwm.md), [friends](friends.md) | déclarent `ps:ps` (non détaillé) |

## Les désaccords relevés

- **3dbrew, commande 3.** Conforme au code : rend `0xD8C107F4`.
- **3dbrew, commandes 14 à 17.** La page ne dit pas les tailles maximales (`0x20` pour 14, `0x400` pour 16 et 17), que le code impose.
- **Carte des services.** À vérifier avec `carte-des-services/donnees.js` (voir le rapport).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 17 commandes, leur fonction et leur en-tête de réponse : le pseudo-code de `ps_handle_command` d'un côté, `emulate_dispatch.py` de l'autre ; les en-têtes de requête de 3dbrew tombent sur les mêmes numéros (dix-sept dans la page).
- Le nom du service offert, ses 9 sessions : la table de `0x105014` et le code de `ps_main`. 3dbrew ne donne pas le nombre.
- Les services appelés : l'exheader autorise `pxi:ps9`, `mcu::PLS` et `fs:USER`, et les en-têtes des 28 requêtes envoyées sont ceux des services correspondants.
- Les clients de `SeedRNG` et `GenerateRandomBytes` : la fiche de `ssl` lit les mêmes numéros (12, 13) et les mêmes en-têtes.
- L'absence de matériel : liste de pages et d'interruptions vide.
- La graine de `0x14` octets : +0 `svcGetSystemTick` (64 bits), +8 la date et l'heure (7 octets, `copy_datetime`), +0xF les 16 bits bas de `MCUPLS_GetTickCounter` ; les octets +0x11 à +0x13 ne sont pas écrits (pile). Process9 tient les gestionnaires ([process9](process9.md) lignes 468-469).
- Les relais `0x1030fc` à `0x103460` : chacun appelle une requête `PXIPS9_*` (`0x103490` à `0x1039b4`) dont l'en-tête est celui de la commande que dit le tableau (Carte des services).

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Les rôles des quatre commandes New 3DS (14 à 17) : leurs noms viennent du numéro de commande PXI de 3dbrew.

**Pas lu**
- Le traitement des commandes 6 à 8 avec `fs:USER`.
- 100 fonctions de Ghidra et 19 entrées manquées restaient sans nom ; toutes ont une proposition (`local/analyse/ps/noms-proposes.tsv`), presque toutes de la bibliothèque.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 185 fonctions, projet Ghidra | `outils/ghidra_direct.py ps` | une minute |
| Table des 17 commandes | `outils/emulate_dispatch.py ps 0x102464=ps:ps` | quelques minutes |
| Assembleur et exheader | objdump de devkitPro, `local/analyse/gpio/exh.py` | immédiat |
| Pseudo-code avec les constantes des tables de littéraux, noms de la bibliothèque | `lit.py`, `match.py` | immédiat |
| 3dbrew : « Process Services » | web.archive.org, capture de 2022 | |

Les scripts et le brut sont dans `local/analyse/ps/` et `local/analyse/gpio/` (non versionné).

**Pour reprendre.** `ps.noms.tsv` est le fichier de graines. Les noms en `ps_` sont les commandes reçues, `ps_relay_` les relais vers Process9. Endroits à relire en premier : le traitement de `fs:USER` pour les commandes 6 à 8 (`fs_get_program_launch_info`, `0x1017c0`).
