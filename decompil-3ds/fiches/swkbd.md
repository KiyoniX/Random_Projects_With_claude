# swkbd, le clavier logiciel

`swkbd` est l'applet de bibliothèque qui fait saisir un texte. Une application la lance par APT avec un bloc de paramètre de 0x400 octets (type de clavier, longueur maximale, textes des boutons, invite, filtres, dictionnaire…) et, le plus souvent, une mémoire partagée qui porte le texte initial et où sera rendu le texte saisi. L'applet contrôle le paramètre, dessine ses claviers (qwerty, pavé numérique, kana, cellulaire, grille) avec la bibliothèque graphique et la bibliothèque de mise en page des applets, lit les boutons et l'écran tactile, consulte ses dictionnaires et la liste des mots interdits, puis rend le bloc à l'appelant.

Fiche du 20 octobre 2026, tirée du brouillon du 18/10 (`local/analyse/swkbd/`) après relecture adverse. Produite avec Ghidra (`outils/ghidra_direct.py`), `outils/couverture.py` et des lectures du désassemblage. Les adresses sont celles du module chargé à `0x00100000`. Le cadre de l'applet est en grande partie le même code qu'[error](error.md) : 1 266 fonctions d'empreinte unique sont communes aux deux.

**Les noms.** Un nom sans marque est dans `swkbd.noms.tsv` à cette adresse (confiance haute). Un nom suivi de † n'est que **proposé** (confiance moyenne, `local/analyse/swkbd/noms-proposes.tsv`).

## Carte d'identité

| | |
| --- | --- |
| Titre | `000400300000D002`, nom `swkbd` (exheader) |
| Fichier lu | `local/extrait/swkbd/exefs/code.bin` et `exheader.bin` |
| Taille | 0x9F074 octets de code (`0x100000`), 0x12964 de lecture seule (`0x1a0000`), 0x8C84 de données (`0x1b3000`), 0x90A4 de mémoire à zéro ; pile de 0x4000 |
| Fonctions | 2 434 pour Ghidra, plus 120 entrées manquées et un corps de veneer (`0x1002bc`), moins quatre fausses entrées et trois codes morts (`swkbd.hors-compte.tsv`) : 2 548 ; 131 nommées dans `swkbd.noms.tsv`, 518 proposées en moyenne |
| Services permis (exheader) | `$hioFIO`, `$hostio0`, `$hostio1`, `cfg:u`, `fs:USER`, `gsp::Gpu`, `hid:USER`, `ndm:u`, `pxi:dev`, `APT:U`, `csnd:SND` |
| Services ouverts par le code | `srv:`, `APT:A` puis `APT:U` en repli, `fs:USER`, `gsp::Gpu`, `hid:USER`, `ndm:u`, `csnd:SND`, `cfg:u`, et le port `err:f` |
| Identifiant d'applet | 0x401, à +0 du bloc de configuration de l'applet que remplit `swkbd_main`† (`0x100d38`) |
| Paramètre | 0x400 octets, reçu en `0x1bc3a8` |
| Dépendances déclarées | 14 titres (exheader) |
| Fils | le fil principal ; ceux des notifications de `srv:` (`0x1023f0`), des événements d'APT (`0x106b70`), du relais des interruptions de `gsp` (`0x12f5d0`) ; un fil créé par `0x1117bc` (rôle non lu) |

## Partie 1 : le démarrage

Même chaîne qu'[error](error.md) : le point d'entrée (`0x100000`), `clear_bss` (`0x100024`, de `0x1bbc84` à `0x1c4d28` : fin des données et mémoire à zéro de l'exheader), les arguments du programme, le moteur d'exécution et `srv:` (`0x15c308`), les tas et la priorité du fil (`0x1011b0`, avec `decode_thread_priority` `0x1012c4`), les 69 constructeurs statiques (`0x100974`, Thumb), une table d'initialisation vide, les services de départ (`0x101190` : notifications de `srv:`, APT, `NDMU_OverrideDefaultDaemons` `0x10f434` et `NDMU_SuspendDaemons` `0x10f3f8`), `swkbd_main`† (`0x100d38`), puis `svcExitProcess` (`0x100d30`).

`swkbd_main`† ouvre `cfg:u` (l'échec est fatal), choisit les tailles des tas selon la région (plus grandes pour les régions 1 et 2), charge les parties communes du romfs, inscrit l'archive de messages « swkbd », charge les sons, remplit le bloc de configuration (0x401, paramètre de 0x400 octets), initialise le reste, reçoit le paramètre (`0x103cec`), le contrôle (`swkbd_parameter_validate_and_init`†, `0x1015d8`), tourne sa boucle, appelle les finaliseurs, puis rend le bloc (partie 4).

Fichiers du romfs (`local/extrait/swkbd/romfs/`) : un fichier compressé par disposition de clavier (cinq), un pour la conversion, les parties communes, les sons, les messages et les nuanceurs.

## Partie 2 : les services utilisés

Même méthode que pour [error](error.md) : l'en-tête écrit à `+0x80` du stockage local, `svc 0x32`, et la poignée remontée jusqu'à la chaîne du service à son ouverture.

| Service | Poignée | Requêtes nommées dans la fiche |
| --- | --- | --- |
| `srv:` (port) | `[0x1b84c8]` | `SRV_RegisterClient`, `SRV_EnableNotification`, `SRV_ReceiveNotification`, `SRV_GetServiceHandle` |
| `APT:A`, puis `APT:U` | `[0x1b8144]` ; « APT:A » (`0x1b07c8`) d'abord, « APT:U » (`0x1b07c2`) en repli | 28 requêtes (`APT_*`), dont `APT_ReceiveParameter` (`0x12a5c8`), `APT_PrepareToCloseLibraryApplet` (`0x11066c`), `APT_CloseLibraryApplet` (`0x1105b0`) |
| `fs:USER` | `[0x1b8244]` | `FSUSER_SetPriority`, `FSUSER_GetPriority`, `FSUSER_OpenFileDirectly` ; les envois sur un fichier ouvert sont seulement proposés |
| `gsp::Gpu` | `[0x1b8280]`, recopiée en `[0x1b8284]` | 12 requêtes (`GSPGPU_*`) |
| `hid:USER` | `[0x1b86b0]` | `HIDUSER_GetIPCHandles` |
| `ndm:u` | `[0x1b86c0]` | `NDMU_SuspendDaemons`, `NDMU_OverrideDefaultDaemons` |
| `csnd:SND` | `[0x1b86a8]` | `CSND_Initialize`, `CSND_Shutdown`, `CSND_AcquireSoundChannels`, `CSND_ReleaseSoundChannels`, `CSND_ExecuteCommands`, `CSND_FlushDataCache` |
| `cfg:u` | `[0x1b81e0]` | `CFG_GetConfigInfoBlk2`, `CFG_SecureInfoGetRegion` |
| `err:f` (port) | `[0x1b823c]` | `ERRF_Throw` |

59 envois sont nommés dans `swkbd.noms.tsv`. Comme dans `error`, trois envois de la forme de `dsp::DSP` n'ont pas de canal (aucune chaîne « dsp::DSP », service absent de l'exheader), et quatre envois portent sur `[0x1b8474]`, une poignée jamais ouverte.

**Les mots interdits et les dictionnaires.** `ngword_mount`† (`0x174530`) monte l'archive « ngword: » depuis le romfs du titre `000400DB00010302`, avec un tampon de 0x800 octets ; `ngword_unmount`† (`0x1747c4`) la démonte. Les dictionnaires sont montés sous « dict: ».

## Partie 3 : le paramètre reçu

`0x103cec` reçoit 0x400 octets en `0x1bc3a8` ; `swkbd_main`† les recopie, puis `swkbd_parameter_validate_and_init`† (`0x1015d8`) les recopie en `0x1bd414` et les contrôle. Tout refus range -2 en +0x138 et rend 0 (`0x101a50`). Les champs, relus en assembleur pour cette fiche ; entre parenthèses, le rôle du champ dans la structure `SwkbdState` de libctru, qui a la même disposition à tous ces décalages :

| Décalage | Taille | Ce que le code en fait |
| --- | --- | --- |
| +0x000 | mot | aiguillage sur la valeur, refus si 6 ou plus ; forcé à 2 quand +0x010 est non nul (type de clavier) |
| +0x004 | mot | refus si 3 ou plus ; forcé à 1 ou 2 avec +0x010 (nombre de boutons moins un) |
| +0x008 | mot | refus si 5 ou plus (saisie valide) |
| +0x00C | mot | refus si 3 ou plus (mot de passe) |
| +0x010 | mot | refus si 3 ou plus. Non nul : type 2, longueur 4, filtres, dictionnaire et décalages de la mémoire partagée effacés, +0x114 levé ; à 2, les trois textes de boutons et +0x11A, +0x11B effacés ; à 1, deux textes de boutons et +0x11A effacés, +0x11C levé (écran du contrôle parental, d'après libctru) |
| +0x018 | mot | bit 1 : ajoute « @ » et sa forme pleine chasse à une table de caractères (`0x1bd854`) ; bit 2 : « % » ; bit 3 : « \ » ; bit 4 : longueur bornée à 0x40 et +0x113 effacé ; bit 5 : installe un rappel (filtres) |
| +0x01C | mot | bits 0 et 1 : réserver l'état (0x44 octets) et l'apprentissage (0xA46C octets) dans la mémoire partagée (drapeaux de sauvegarde) |
| +0x020 | demi-mot | longueur maximale : bornée à 0x20 si +0x114, à 0x40 si le bit 4 de +0x018, sinon à 2 000 quand +0x018 est non nul (aucune borne dans cette fonction quand +0x018 est nul) |
| +0x022 | demi-mot | nombre de mots du dictionnaire ; chaque entrée fait 0xA6 octets, deux textes UTF-16 de 41 caractères dont chacun doit finir par un nul |
| +0x026 | 3 × 0x22 | textes des trois boutons, 17 caractères UTF-16 chacun ; refus si un texte utilisé n'a pas de nul dans ses 17 caractères |
| +0x08C | 2 demi-mots | deux caractères (touches du pavé numérique) : **refus s'ils valent 1 à 0x1F** ; 0 ou 0x20 et plus sont acceptés |
| +0x090 | 65 caractères | l'invite, 64 caractères au plus suivis d'un nul |
| +0x112 | octet | nul : un drapeau global est baissé (saisie prédictive, d'après libctru) |
| +0x113 | octet | effacé par +0x114 et par le bit 4 de +0x018 (multiligne) |
| +0x114 | octet | longueur bornée à 0x20 (largeur fixe) |
| +0x117 | octet | nul : `0x103e2c(1)` (rôle non lu) |
| +0x119 | octet | non nul : le mot +4 de l'état par défaut est mis à 0 (seulement quand aucun état initial n'est donné) |
| +0x120 | mot | décalage du texte initial dans la mémoire partagée (-1 : aucun) ; les caractères 9, 0xC et 0xD y sont remplacés |
| +0x124 | mot | décalage du dictionnaire |
| +0x128 | mot | décalage de l'état initial ; 0x40 octets en sont recopiés, à partir de son +4, en `0x1bd814` |
| +0x12C | mot | décalage de l'apprentissage |
| +0x130 | mot | taille de la mémoire partagée : refus si elle est plus petite que `swkbd_shared_memory_required_size`† |
| +0x138 | mot | le résultat : -1 au départ, -2 si le paramètre est refusé, -3 si une allocation échoue |
| +0x13C à +0x144 | 3 mots | remis à -1 (décalages de l'état, de l'apprentissage et du texte rendus, d'après libctru) |
| +0x148 | demi-mot | remis à 0 (longueur du texte rendu) |
| +0x14C | mot | remis à 0 (résultat du rappel) |
| +0x150 | 0x202 octets | effacé (message du rappel) |

`swkbd_shared_memory_required_size`† (`0x1024f4`) : quand +0x010 est non nul, 0 (ou -1 s'il vaut 3 ou plus). Sinon, le plus grand de deux totaux, arrondi à 0x1000 : le texte `(longueur × 2 + 5) & ~3`, plus le dictionnaire `(mots × 0xA6 + 3) & ~3`, plus 0x44 si un état est donné et 0xA46C si un apprentissage est donné ; ou le texte plus 0x44 et 0xA46C selon les bits 0 et 1 de +0x01C.

## Partie 4 : ce que l'applet rend à l'appelant

En fin de `swkbd_main`†, la mémoire partagée est rendue, puis `APT_CloseLibraryApplet` (`0x1105b0`) renvoie le bloc de `0x1bc3a8` avec sa taille 0x400 et la poignée reçue, et le processus se termine. Le texte saisi, sa longueur et le bouton choisi sont écrits par le moteur du clavier, qui n'est pas lu : seules les valeurs de départ (+0x138 à +0x150) sont prouvées.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 59 envois nommés dans `swkbd.noms.tsv` : en-tête, Carte des services, et poignée remontée jusqu'à la chaîne du service.
- `clear_bss` et `svcExitProcess` : lecture, et bornes égales aux tailles de l'exheader.
- Les contrôles du paramètre (partie 3) et le calcul de la taille de la mémoire partagée : pseudo-code de Ghidra, puis désassemblage relu pour cette fiche (`0x1015d8` à `0x101b90`, `0x1024f4` à `0x10258c`).

**Interprété, à relire dans Ghidra**
- Les rôles des champs donnés entre parenthèses : noms de libctru, qui s'accordent avec les bornes et les décalages lus.
- Les noms suivis de †, et le titre de la liste des mots interdits (3dbrew).

**Pas lu**
- Le moteur de saisie et de conversion (`0x170000` à `0x198000`), l'écriture du résultat, le contenu de la mémoire partagée au-delà de sa taille.
- Le rôle du fil créé par `0x1117bc`, de `0x103e2c` et du message de +0x150.
- Les 1 899 fonctions qui n'ont aucun nom, et les 518 qui n'ont qu'un nom proposé.

## Comment cette fiche a été faite

Comme celle d'[error](error.md). Les noms communs aux deux applets viennent d'`error` par empreinte ou par la suite des fonctions appelées ; détail et compte dans `local/analyse/swkbd/notes-100.md`. La relecture du 20/10 a contrôlé chaque nom contre `swkbd.noms.tsv` et relu les contrôles du paramètre en assembleur.

**Pour reprendre.** `swkbd.noms.tsv` est le fichier de graines ; propositions dans `local/analyse/swkbd/noms-proposes.tsv`, pseudo-code dans `local/analyse/swkbd/gh/`, non versionnés.
