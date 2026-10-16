# Pokémon X : ce que le jeu peut demander à la console

Cette fiche n'est pas celle d'un module de la console mais celle de leur client : le code de Pokémon X. Elle répond à une question, pour le portage sur PC : à quels guichets le jeu peut-il s'adresser, avec quelles commandes, et dans quel ordre au démarrage.

Fiche du 14 octobre 2026, lue dans le code de la mise à jour du jeu (c'est lui qui tourne, pas celui de la cartouche). Tout est **statique** : on y lit ce que le code *peut* envoyer et d'où, pas ce qu'il envoie *réellement* pendant une partie. Une commande présente ici peut ne jamais partir (un mode en ligne qu'on n'ouvre pas, une branche d'erreur). Ce tri-là ne se fera qu'en regardant le jeu tourner.

Cette fiche ne relève que les en-têtes. Les paramètres de chaque commande et l'usage de chaque réponse, lus côté jeu et côté module, sont dans les cinq contrats : [APT](contrat-apt.md), [`gsp::Gpu`](contrat-gsp.md), [`dsp::DSP`](contrat-dsp.md), [les fichiers](contrat-fs.md) et [les petits services](contrat-petits-services.md) (`srv:`, `hid:USER`, `cfg:u`, `ptm:u`, `err:f`, `ldr:ro`). Ce qu'ils ont corrigé ici est signalé à chaque endroit.

Le tableau complet, une ligne par commande, est dans `pokemon-x-services.tsv` : le service, l'en-tête de la requête, le nom de la commande d'après la Carte, l'adresse de la fonction du jeu qui l'envoie, le nombre d'endroits qui appellent cette fonction, le module de la console qui porte le service, puis deux colonnes de plus, la preuve du service et d'où la fonction est atteinte (partie 3). Les noms donnés aux fonctions sont dans `pokemon-x.noms.tsv` : 920 lignes, les 748 posées par cette fiche (dont les 285 adresses des noms C++ de `static.crs`) et 172 venues des cinq contrats.

## Carte d'identité

| | |
| --- | --- |
| Fichier lu | `local/extrait/maj/exefs/code.bin` (5 169 152 octets) et son `code.elf` |
| Sections | `.text` de 4 451 660 octets à `0x00100000`, `.rodata` de 433 936 octets à `0x53f000`, `.data` de 281 656 octets à `0x5a9000` suivie du `.bss` (767 128 octets en mémoire pour les deux) |
| Fonctions | 23 818 d'après Ghidra seul (dont 487 en Thumb), 23 882 une fois les noms de cette fiche posés ; 24 400 débuts de fonction d'après un second passage indépendant |
| Envois de commandes | 408 instructions `svc 0x32`, toutes en ARM, dans 408 fonctions distinctes |
| Guichets | 23 noms de services demandés à `srv:`, plus deux ports (`srv:` lui-même et `err:f`) |
| Modules à la demande | 133 fichiers `.cro` (7 614 464 octets) et `static.crs`, dans le romfs de la mise à jour |

## Partie 1 : comment le jeu envoie une commande

Dans les modules de la console, une petite fonction `svcSendSyncRequest` fait l'appel système et tout le monde l'appelle. Ici non : la bibliothèque du constructeur écrit le `svc 0x32` **sur place**, dans chaque fonction d'envoi. Il y a donc une fonction par commande, et toutes ont la même forme :

1. lire l'adresse du stockage local du fil (`mrc p15, 0, r4, c13, c0, 3`) ;
2. écrire l'en-tête à `+0x80`, puis les paramètres à la suite ;
3. charger la poignée dans `r0` ;
4. `svc 0x32` ;
5. si le résultat n'est pas une erreur, lire la réponse à `+0x84` et au-delà.

| Ce qu'on compte | Nombre | Comment |
| --- | --- | --- |
| Instructions `svc 0x32` en ARM (`EF000032`) | 408 | recherche du mot dans `.text` |
| Instructions `svc 0x32` en Thumb (`DF32`) | 0 | recherche du demi-mot à toutes les adresses paires |
| Fonctions qui en contiennent une | 408 | une par instruction, jamais deux dans la même |
| En-têtes retrouvés (une constante écrite à `+0x80`) | 408 | suivi des registres du début de la fonction jusqu'au `svc` |
| Fonctions qui lisent la poignée dans une variable fixe | 209 | `ldr r0, =variable` puis `ldr r0, [r0]` |
| Fonctions qui reçoivent dans `r0` l'adresse de la poignée | 198 | `ldr r0, [r0]` sur le premier paramètre |
| Fonction qui la demande à une autre fonction | 1 | `0x2c8eac` appelle `0x1646c4`, qui rend l'adresse de la poignée de `gsp::Gpu` |

Pour les 198 qui la reçoivent, l'en-tête ne dit pas à qui la commande est destinée : il faut remonter chez l'appelant, parfois sur plusieurs étages, pour savoir quelle poignée il passe. C'est tout le travail de la partie 3.

## Partie 2 : comment le jeu ouvre ses services

### Le port `srv:`

`srv_init` (`0x134ad4`) tient un compteur à `0x5e8110`. Au premier appel, il passe le nom `srv:` (à `0x570cc8`) à `srv_connect_and_register` (`0x10f8e0`), qui ouvre le port par `svcConnectToPort` (`0x12353c`, appel système `0x2D`), range la poignée à `0x5e8124`, puis envoie RegisterClient. Aux appels suivants il ne fait qu'augmenter le compteur et rend `0x082067F9`. Chaque bibliothèque de service commence par l'appeler : il a 21 appelants.

### GetServiceHandle

La commande part d'une seule fonction, `srv_GetServiceHandle` (`0x163c10`) : en-tête `0x00050100`, le nom recopié sur 8 octets dans les mots 1 et 2 (par `copy_service_name`, `0x12fdd8`), sa longueur dans le mot 3, un drapeau dans le mot 4. La poignée revient dans le mot 3 de la réponse. C'est la requête décrite pas à pas dans la fiche `sm`, partie 4.

Trois fonctions seulement l'appellent, et tout le reste du code passe par elles :

| Fonction | Adresse | Appels | Ce qu'elle ajoute |
| --- | --- | --- | --- |
| `srv_get_service_handle` | `0x124e28` | 20 | refuse si `srv_init` n'a pas été fait (`0xD8A067F8`) ou si le nom dépasse 8 caractères (`0xD9006405`) |
| `srv_get_service_handle_cstr` | `0x172e90` | 6 | calcule elle-même la longueur du nom |
| `srv_get_service_handle_len` | `0x179bf4` | 1 | reçoit la longueur en paramètre |

Soit **27 endroits** du code qui demandent une poignée. Pour chacun, le suivi des registres donne le nom (une chaîne du fichier) et la case où la poignée sera rangée.

| Nom demandé | Demandé à | Dans la fonction | La poignée va à |
| --- | --- | --- | --- |
| `APT:U` | `0x1104dc`, `0x12592c` | `apt_open_session` (`0x110494`), `apt_lock_and_open_session` (`0x1258c0`) | `0x5db7d8` |
| `ndm:u` | `0x10f3a4` | `0x10f368` | `0x5e8024` |
| `cfg:u` | `0x1188fc` | `cfg_init_user` (`0x118874`) | `0x5e9144` |
| `cfg:s` | `0x1340cc`, appelé de `0x123fd4` | `cfg_init_system` (`0x123fb4`) | `0x5ea4bc`, recopiée à `0x5e9144` |
| `cfg:i` | `0x1340cc`, appelé de `0x124050` | `cfg_init_internal` (`0x124030`) | `0x5ea4b8`, recopiée à `0x5e9144` |
| `ptm:u` | `0x1071bc` | `0x107188` | `0x5e8098` |
| `fs:USER` | `0x10eb0c` | `fs_init` (`0x10eac4`) | `0x5d4094` |
| `hid:USER` | `0x118cdc`, appelé de `0x10f304` | `0x118c70` | `0x5e9648` |
| `gsp::Gpu` | `0x149244`, `0x10fe10` | `0x1491e0`, `gsp_force_lcd_black` (`0x10fdc8`) | `0x5e7f40` |
| `dsp::DSP` | `0x13412c` | `0x1340e8` | `0x5d402c` |
| `frd:u` | `0x1105c8` | `0x110528` | `0x5e7f24` |
| `ldr:ro` | `0x12fec0` | `0x12fe70` | `0x5e80d0` |
| `boss:U` | `0x124ee0` | `boss_open_user_session` (`0x124ea4`) | `0x64c658` |
| `http:C` | `0x163ccc` | `0x163c94` | `0x6420e4` |
| `http:C` | `0x2b8c30` | `http_context_open_session` (`0x2b8ba4`) | champ `+8` d'un objet contexte |
| `soc:U` | `0x16521c` | `0x165204` | `0x5e80f8` |
| `soc:U` | `0x18b8c0` | `session_pool_open_session` (`0x18b898`) | une session de la réserve de l'objet `0x645154` |
| `ssl:C` | `0x2aff84` | `0x2aff2c` | `0x64543c` |
| `ac:u` | `0x1dcadc` | `0x1dca2c` | `0x5db714` |
| `nwm::UDS` | `0x2b1928`, `0x2b1960` | `0x2b18a0` | `0x5d42ac`, `0x5d42a8` |
| `ir:USER` | `0x1e4ea4` | `0x1e4e44` | `0x5e9690` |
| `cecd:u` | `0x1ea810` | `0x1ea7e4` | `0x5e9130` |
| `mic:u` | `0x1ef62c` | `0x1ef5e0` | `0x5e8020` |
| `cam:u` | `0x2ca404`, appelé de `0x395f5c` et `0x395fa8` | `0x2ca3bc` | `0x5d3dbc` |
| `y2r:u` | `0x2b28bc`, appelé de `0x395fc0` | `0x2b2878` | `0x5d42f4` |

Trois de ces noms ne sont pas lus dans une chaîne voisine de l'appel mais par un pointeur : `gsp::Gpu` (pointeur à `0x5e7f34`), `APT:U` (`0x5db788`) et, pour la réserve de sessions, `soc:U` (recopié dans l'objet à `0x164e24`). Les deux premiers pointeurs sont en `.data` : leur valeur de départ ne vaut que parce qu'aucune instruction du code ne les modifie, ce que confirment les références relevées par Ghidra.

### Le recoupement par les noms

Le fichier contient **37** chaînes qui sont des noms de services de la Carte : les 34 de la première lecture, plus `srv:`, `boss:U` et `nwm::UDS`, que cette lecture avait manqués parce qu'un octet lisible les précède (`CWAT` devant `boss:U`, un `2` devant `nwm::UDS`).

| Sort de la chaîne | Nombre | Lesquelles |
| --- | --- | --- |
| Demandée à `srv:` par GetServiceHandle | 23 | celles du tableau ci-dessus |
| Ouverte comme un port, par `svcConnectToPort` | 2 | `srv:`, `err:f` |
| Lue par aucune instruction | 12 | `APT:S`, `gsp::Lcd`, `hid:SPVR`, `fs:LDR`, `srv:pm`, `ptm:s`, `ptm:sysm`, `ptm:play`, `ptm:gets`, `boss:P`, `boss:M`, `cecd:s` |

Les 12 dernières viennent de la bibliothèque : elle range les noms d'une même famille côte à côte, le jeu n'en utilise qu'un. 23 + 2 + 12 = 37, le compte y est.

## Partie 3 : les commandes, service par service

### Comment une commande est attribuée à un service

L'en-tête ne suffit pas : `0x00010002` est RegisterClient dans `srv:` et Initialize dans `ssl:C`, `0x08040000` est GetSize pour un fichier et GetPriority pour un dossier. La preuve est la poignée. Cinq cas se présentent, notés dans la colonne « preuve » du fichier `.tsv` :

| Preuve | Fonctions | Ce que ça veut dire |
| --- | --- | --- |
| directe | 226 | la poignée est lue dans la case même que GetServiceHandle a remplie avec ce nom |
| copie | 74 | elle est lue dans une autre case, et l'instruction qui recopie l'une dans l'autre a été lue (son adresse est dans la note du service) |
| objet | 55 | elle est dans un champ d'un objet (archive, fichier, contexte HTTP, réserve de sessions) : le lien passe par la table virtuelle ou par le champ, pas par une adresse fixe |
| port | 6 | la poignée vient de `svcConnectToPort` |
| jamais ouverte | 47 | la case que lit la fonction n'est remplie nulle part dans le code principal : la commande ne peut pas partir, et le nom du service n'est qu'une déduction (marquée d'un `?`) |

Aucune des 408 n'est restée sans attribution. Mais les 55 « objet » et les 47 « jamais ouverte » reposent sur une lecture, pas sur une chaîne refermée par l'outil : elles sont reprises dans la partie « interprété ».

### Avec ou sans appelants

On s'attendait à trouver des fonctions que personne n'appelle, le code mort de la bibliothèque. Il n'y en a pas : **les 408 ont au moins un appelant** (429 `bl` et 68 sauts de fin de fonction en tout ; aucune n'est appelée par un pointeur, aucune depuis du code Thumb). Compter les appelants directs ne trie donc rien ici : une fonction morte de la bibliothèque est appelée par une autre fonction morte.

Le tri utile est de remonter jusqu'au bout : la fonction est-elle **atteinte depuis le point d'entrée** ? Trois cas :

- **entrée** : on y arrive depuis `0x100000` en suivant les appels, les sauts, et les pointeurs de fonction rangés dans les données (tables virtuelles). C'est une borne haute : toute fonction désignée par une table est comptée comme vivante, même si l'objet n'est jamais créé.
- **`.cro`** : on n'y arrive que par une fonction du code principal qu'un module `.cro` importe (partie 5). Le code principal seul ne l'appelle pas.
- **non** : ni l'un ni l'autre. Il n'y en a aucune.

| Service | Module | Fonctions d'envoi | Atteintes depuis le point d'entrée | Atteintes seulement par une fonction importée par un `.cro` | Jamais atteintes | Preuve du service |
| --- | --- | --- | --- | --- | --- | --- |
| `srv:` | sm | 5 | 5 | 0 | 0 | port (5) |
| `err:f` | errdisp | 1 | 1 | 0 | 0 | port (1) |
| `APT:U` | ns | 29 | 28 | 1 | 0 | directe (29) |
| `fs:USER` | fs | 29 | 28 | 1 | 0 | objet (13), copie (9), directe (7) |
| `FSFile` | fs | 10 | 10 | 0 | 0 | objet (10) |
| `FSDir` | fs | 4 | 4 | 0 | 0 | objet (4) |
| `gsp::Gpu` | gsp | 14 | 13 | 1 | 0 | copie (14) |
| `hid:USER` | hid | 7 | 7 | 0 | 0 | directe (7) |
| `dsp::DSP` | dsp | 13 | 13 | 0 | 0 | copie (13) |
| `cfg:u` | cfg | 4 | 4 | 0 | 0 | directe (4) |
| `ptm:u` | ptm | 1 | 1 | 0 | 0 | directe (1) |
| `ldr:ro` | ro | 4 | 4 | 0 | 0 | directe (4) |
| `ndm:u` | ndm | 9 | 8 | 1 | 0 | directe (9) |
| `ac:u` | ac | 15 | 15 | 0 | 0 | directe (15) |
| `frd:u` | friends | 22 | 16 | 6 | 0 | directe (22) |
| `boss:U` | boss | 28 | 23 | 5 | 0 | copie (28) |
| `boss:P ?` | boss | 30 | 25 | 5 | 0 | jamais ouverte (30) |
| `cecd:u` | cecd | 16 | 16 | 0 | 0 | directe (16) |
| `cecd:s ?` | cecd | 16 | 16 | 0 | 0 | jamais ouverte (16) |
| `http:C` | http | 24 | 24 | 0 | 0 | objet (17), copie (7) |
| `ssl:C` | ssl | 3 | 2 | 1 | 0 | copie (3) |
| `soc:U` | socket | 20 | 20 | 0 | 0 | objet (11), directe (9) |
| `soc:P ?` | socket | 1 | 1 | 0 | 0 | jamais ouverte (1) |
| `nwm::UDS` | nwm | 22 | 22 | 0 | 0 | directe (22) |
| `ir:USER` | ir | 13 | 13 | 0 | 0 | directe (13) |
| `mic:u` | mic | 10 | 10 | 0 | 0 | directe (10) |
| `cam:u` | camera | 36 | 9 | 27 | 0 | directe (36) |
| `y2r:u` | camera | 22 | 12 | 10 | 0 | directe (22) |
| **Total** | | **408** | **350** | **58** | **0** | |

Ce que dit ce tableau : les services du cœur (`fs`, `gsp`, `hid`, `dsp`, `cfg`, `APT`) sont entièrement atteints depuis le point d'entrée. L'appareil photo (`cam:u`, `y2r:u`) ne l'est presque que par les `.cro`. Et 47 fonctions visent une session qui n'est jamais ouverte.

### `srv:`

Poignée à `0x5e8124`. Ce n'est pas un service mais le port nommé `srv:` : la poignée vient de `svcConnectToPort` (`0x12353c`), appelé par `srv_connect_and_register` (`0x10f8e0`).

**Atteintes depuis le point d'entrée (5)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010002` | RegisterClient | `srv_RegisterClient` | `0x119c68` | 1 |
| `0x00020000` | EnableNotification | `srv_EnableNotification` | `0x10f980` | 1 |
| `0x00050100` | GetServiceHandle | `srv_GetServiceHandle` | `0x163c10` | 3 |
| `0x00090040` | Subscribe | `srv_Subscribe` | `0x10f9bc` | 1 |
| `0x000B0000` | ReceiveNotification | `srv_ReceiveNotification` | `0x119ca4` | 1 |

Le jeu ne s'abonne qu'à une notification, `0x209` (le retrait de la carte SD), qui lui fait lancer une erreur fatale ; un fil à lui, `srv_notification_thread_main` (`0x10f7c4`), attend le sémaphore rendu par EnableNotification. Détail dans le [contrat des petits services](contrat-petits-services.md), partie 1.

### `err:f`

Port lui aussi. Poignée à `0x5d4048`, ouverte par `svcConnectToPort` dans `errf_throw` (`0x118a98`) au moment d'une erreur fatale, puis refermée. Le nom est lu par le pointeur `0x560328`.

**Atteintes depuis le point d'entrée (1)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010800` | Throw | `errf_Throw` | `0x124780` | 1 |

### `APT:U`

Poignée à `0x5db7d8`. La session n'est pas gardée ouverte : `apt_lock_and_open_session` (`0x1258c0`, 33 appelants) attend le verrou d'APT puis redemande `APT:U`, et `apt_close_session_and_unlock` (`0x125c84`) la referme, autour de chaque commande. Le nom vient d'un pointeur rangé en `.data` (`0x5db788`, recopié à `0x5db78c`) que le code ne modifie jamais ; la chaîne `APT:S`, elle, n'est lue par personne.

**Atteintes depuis le point d'entrée (28)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010040` | GetLockHandle | `apt_GetLockHandle` | `0x110388` | 1 |
| `0x00020080` | Initialize | `apt_Initialize` | `0x110338` | 1 |
| `0x00030040` | Enable | `apt_Enable` | `0x109da8` | 1 |
| `0x00050040` | GetAppletManInfo | `apt_GetAppletManInfo` | `0x134f58` | 2 |
| `0x00090040` | IsRegistered | `apt_IsRegistered` | `0x134d80` | 4 |
| `0x000B0040` | InquireNotification | `apt_InquireNotification` | `0x126078` | 1 |
| `0x000C0104` | SendParameter | `apt_SendParameter` | `0x134dc4` | 1 |
| `0x000D0080` | ReceiveParameter | `apt_ReceiveParameter` | `0x125fb0` | 2 |
| `0x000E0080` | GlanceParameter | `apt_GlanceParameter` | `0x134ecc` | 1 |
| `0x000F0100` | CancelParameter | `apt_CancelParameter` | `0x134e70` | 1 |
| `0x00180040` | PrepareToStartLibraryApplet | `apt_PrepareToStartLibraryApplet` | `0x16490c` | 1 |
| `0x00190040` | PrepareToStartSystemApplet | `apt_PrepareToStartSystemApplet` | `0x135048` | 1 |
| `0x001E0084` | StartLibraryApplet | `apt_StartLibraryApplet` | `0x164870` | 1 |
| `0x001F0084` | StartSystemApplet | `apt_StartSystemApplet` | `0x134fc8` | 1 |
| `0x00220040` | PrepareToCloseApplication | `apt_PrepareToCloseApplication` | `0x109d6c` | 1 |
| `0x00270044` | CloseApplication | `apt_CloseApplication` | `0x109d18` | 1 |
| `0x002B0000` | PrepareToJumpToHomeMenu | `apt_PrepareToJumpToHomeMenu` | `0x135018` | 1 |
| `0x002C0044` | JumpToHomeMenu | `apt_JumpToHomeMenu` | `0x134e1c` | 1 |
| `0x00310100` | PrepareToDoApplicationJump | `apt_PrepareToDoApplicationJump` | `0x110448` | 1 |
| `0x00320084` | DoApplicationJump | `apt_DoApplicationJump` | `0x1103e4` | 1 |
| `0x003B0040` | CancelLibraryApplet | `apt_CancelLibraryApplet` | `0x12603c` | 1 |
| `0x003E0080` | ReplySleepQuery | `apt_ReplySleepQuery` | `0x125f6c` | 1 |
| `0x003F0040` | ReplySleepNotificationComplete | `apt_ReplySleepNotificationComplete` | `0x135080` | 1 |
| `0x00400042` | SendCaptureBufferInfo | `apt_SendCaptureBufferInfo` | `0x1648c0` | 1 |
| `0x00420080` | SleepSystem | `apt_SleepSystem` | `0x125e70` | 1 |
| `0x00430040` | NotifyToWait | `apt_NotifyToWait` | `0x11b74c` | 1 |
| `0x00440000` | GetSharedFont | `apt_GetSharedFont` | `0x125f24` | 1 |
| `0x004B00C2` | AppletUtility | `apt_AppletUtility` | `0x125ea8` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (1)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x004D0080` | GetAppletProgramInfo | `apt_GetAppletProgramInfo` | `0x2c9f84` | 1 |

Les 29 sont lues des deux côtés dans le [contrat APT](contrat-apt.md) : neuf réponses suffisent au démarrage, et le jeu rejoue toutes les 10 millisecondes les commandes « Prepare… » et « Start… » tant que `ns` rend l'un de ses trois codes « occupé ».

### `fs:USER`

Poignée à `0x5d4094`, recopiée à `0x5d40b0` par `fs_set_session_and_sdk_version` (`0x1181cc`). 7 fonctions lisent la première, 9 la copie, et 13 sont des méthodes d'un objet « archive » (table virtuelle `0x592194`) qui garde une troisième copie à `+4` : les trois endroits qui fabriquent cet objet (`0x1e19ac`, `0x1e264c`, `0x1e2704`) y rangent le contenu de `0x5d40b0`.

**Atteintes depuis le point d'entrée (28)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x080201C2` | OpenFile | `fsuser_OpenFile` | `0x1e2f4c` | 1 |
| `0x08030204` | OpenFileDirectly | `fsuser_OpenFileDirectly` | `0x1239f0` | 3 |
| `0x08040142` | DeleteFile | `fsuser_DeleteFile` | `0x1e27d8` | 1 |
| `0x08050244` | RenameFile | `fsuser_RenameFile` | `0x1e2828` | 1 |
| `0x08060142` | DeleteDirectory | `fsuser_DeleteDirectory` | `0x1e2bfc` | 1 |
| `0x08070142` | DeleteDirectoryRecursively | `fsuser_DeleteDirectoryRecursively` | `0x1e2ea4` | 1 |
| `0x08080202` | CreateFile | `fsuser_CreateFile` | `0x1e277c` | 1 |
| `0x08090182` | CreateDirectory | `fsuser_CreateDirectory` | `0x1e2ba8` | 1 |
| `0x080A0244` | RenameDirectory | `fsuser_RenameDirectory` | `0x1e2c4c` | 1 |
| `0x080B0102` | OpenDirectory | `fsuser_OpenDirectory` | `0x1e2a10` | 1 |
| `0x080C00C2` | OpenArchive | `fsuser_OpenArchive` | `0x1e28b8` | 4 |
| `0x080D0144` | ControlArchive | `fsuser_ControlArchive` | `0x1e2a74` | 1 |
| `0x080E0080` | CloseArchive | `fsuser_CloseArchive` | `0x1e2918` | 11 |
| `0x08120080` | GetFreeBytes | `fsuser_GetFreeBytes` | `0x1e2948` | 1 |
| `0x08170000` | IsSdmcDetected | `fsuser_IsSdmcDetected` | `0x1e2b38` | 1 |
| `0x084500C2` | GetFormatInfo | `fsuser_GetFormatInfo` | `0x1e2984` | 2 |
| `0x08490040` | GetArchiveResource | `fsuser_GetArchiveResource` | `0x1e2db0` | 1 |
| `0x084C0242` | FormatSaveData | `fsuser_FormatSaveData` | `0x1e2ae0` | 1 |
| `0x08510242` | CreateExtSaveData | `fsuser_CreateExtSaveData` | `0x1e2cdc` | 1 |
| `0x08520100` | DeleteExtSaveData | `fsuser_DeleteExtSaveData` | `0x1e2d38` | 1 |
| `0x08540100` | GetExtDataBlockSize (la Carte donne `0x08540010`, une coquille ; le module ne vérifie que le numéro) | `fsuser_GetExtDataBlockSize` | `0x1e2e38` | 1 |
| `0x085A00C0` | SetArchivePriority | `fsuser_SetArchivePriority` | `0x1e2e00` | 1 |
| `0x085B0080` | GetArchivePriority | `fsuser_GetArchivePriority` | `0x1e2d74` | 1 |
| `0x08610042` | InitializeWithSdkVersion | `fsuser_InitializeWithSdkVersion` | `0x123a90` | 1 |
| `0x08620040` | SetPriority | `fsuser_SetPriority` | `0x118368` | 2 |
| `0x08630000` | GetPriority | `fsuser_GetPriority` | `0x1468ec` | 1 |
| `0x086E00C0` | SetThisSaveDataSecureValue | `fsuser_SetThisSaveDataSecureValue` | `0x118398` | 1 |
| `0x086F0040` | GetThisSaveDataSecureValue | `fsuser_GetThisSaveDataSecureValue` | `0x1e2ef4` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (1)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x08180000` | IsSdmcWritable | `fsuser_IsSdmcWritable` | `0x1e2b70` | 1 |

Ces 29 commandes, les 10 d'un fichier et les 4 d'un dossier sont lues des deux côtés dans le [contrat des fichiers](contrat-fs.md). L'essentiel : le jeu ne demande jamais un fichier du romfs par son nom ; il ouvre **le romfs entier comme un seul fichier** (OpenFileDirectly, archive `0x00000003`, chemin binaire de 12 octets à zéro, ou commençant par 5 pour `rom2:`), lit lui-même ses tables, puis ne fait plus que des Read à une position calculée. Pour GetExtDataBlockSize, la console accepte les deux en-têtes : l'aiguillage de `fs` ne regarde que le numéro `0x0854` (contrat des fichiers, partie 6), et `0x08540100`, celui du jeu, est la forme juste.

### `FSFile`

**Classée à part.** Ces commandes ne partent pas vers `fs:USER` mais vers la session d'un fichier ouvert : la poignée est celle que `OpenFile` ou `OpenFileDirectly` vient de rendre, rangée à `+4` d'un objet « fichier » (table virtuelle `0x592130`, posée à `0x1e21fc`, `0x1180d8` et `0x1334f4`, chaque fois juste après l'envoi d'une ouverture). Les en-têtes ressemblent à ceux de `fs:USER` (`0x0802…`, `0x0803…`) : c'est la poignée qui les distingue. Côté console, voir la fiche `fs`, partie 5.

**Atteintes depuis le point d'entrée (10)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x08010100` | OpenSubFile | `fsfile_OpenSubFile` | `0x1e2ff8` | 1 |
| `0x080200C2` | Read | `fsfile_Read` | `0x1e30ac` | 1 |
| `0x08030102` | Write | `fsfile_Write` | `0x1e3130` | 2 |
| `0x08040000` | GetSize | `fsfile_GetSize` | `0x1e31dc` | 1 |
| `0x08050080` | SetSize | `fsfile_SetSize` | `0x1e3214` | 1 |
| `0x08080000` | Close | `fsfile_Close` | `0x1e3104` | 1 |
| `0x080A0040` | SetPriority | `fsfile_SetPriority` | `0x1e3044` | 1 |
| `0x080B0000` | GetPriority | `fsfile_GetPriority` | `0x1e2fc0` | 1 |
| `0x080C0000` | OpenLinkFile | `fsfile_OpenLinkFile` | `0x1e3074` | 1 |
| `0x0C010100` | GetAvailable | `fsfile_GetAvailable` | `0x1e3190` | 1 |

### `FSDir`

**Classée à part**, comme les fichiers : session d'un dossier ouvert, objet de table virtuelle `0x592174`, posée à `0x1e1c30` dans la méthode qui vient d'envoyer `OpenDirectory`. Que la poignée rangée soit bien celle de la réponse est interprété, pas suivi registre par registre.

**Atteintes depuis le point d'entrée (4)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x08010042` | Read | `fsdir_Read` | `0x1e32ac` | 1 |
| `0x08020000` | Close | `fsdir_Close` | `0x1e3300` | 1 |
| `0x08030040` | SetPriority | `fsdir_SetPriority` | `0x1e327c` | 1 |
| `0x08040000` | GetPriority | `fsdir_GetPriority` | `0x1e3244` | 1 |

### `gsp::Gpu`

Poignée à `0x5e7f40`, ouverte par nom, puis recopiée à `0x5e7f44` (`0x14924c`) : les 14 fonctions lisent toutes la copie. Le nom vient du pointeur `0x5e7f34` en `.data`, jamais modifié. Son voisin `0x5e7f38` pointe sur `gsp::Lcd` et n'est lu par personne. `gsp_force_lcd_black` (`0x10fdc8`), sur le chemin de sortie du jeu, envoie SetLcdForceBlack ; si la session n'est plus ouverte, il la rouvre le temps de cet envoi et la referme.

**Atteintes depuis le point d'entrée (13)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010082` | WriteHWRegs | `gspgpu_WriteHWRegs` | `0x1645b0` | 1 |
| `0x00020084` | WriteHWRegsWithMask | `gspgpu_WriteHWRegsWithMask` | `0x164634` | 1 |
| `0x00040080` | ReadHWRegs | `gspgpu_ReadHWRegs` | `0x16455c` | 1 |
| `0x00080082` | FlushDataCache | `gspgpu_FlushDataCache` | `0x1645f8` | 1 |
| `0x000B0040` | SetLcdForceBlack | `gspgpu_SetLcdForceBlack` | `0x125674` | 3 |
| `0x000C0000` | TriggerCmdReqQueue | `gspgpu_TriggerCmdReqQueue` | `0x179dbc` | 1 |
| `0x00130042` | RegisterInterruptRelayQueue | `gspgpu_RegisterInterruptRelayQueue` | `0x173478` | 1 |
| `0x00140000` | UnregisterInterruptRelayQueue | `gspgpu_UnregisterInterruptRelayQueue` | `0x179de4` | 1 |
| `0x00160042` | AcquireRight | `gspgpu_AcquireRight` | `0x134b9c` | 2 |
| `0x00170000` | ReleaseRight | `gspgpu_ReleaseRight` | `0x12564c` | 1 |
| `0x00180000` | ImportDisplayCaptureInfo | `gspgpu_ImportDisplayCaptureInfo` | `0x173428` | 1 |
| `0x00190000` | SaveVramSysArea | `gspgpu_SaveVramSysArea` | `0x1494c8` | 1 |
| `0x001A0000` | RestoreVramSysArea | `gspgpu_RestoreVramSysArea` | `0x1256ac` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (1)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00100040` | SetAxiConfigQoSMode | `gspgpu_SetAxiConfigQoSMode` | `0x2c8eac` | 1 |

Lues des deux côtés, avec les six commandes de la file graphique, dans le [contrat de `gsp::Gpu`](contrat-gsp.md). Le jeu n'envoie jamais SetBufferSwap ni aucune des commandes de service qui portent un nom d'opération graphique : il annonce ses images et range ses demandes par la mémoire partagée seulement. WriteHWRegs et WriteHWRegsWithMask ne partent que si RegisterInterruptRelayQueue rend `0x2A07` (le jeu se croit alors le premier client et programme lui-même les écrans) ; une réponse 0 les évite.

### `hid:USER`

Poignée à `0x5e9648`. Le nom arrive en paramètre de la fonction d'ouverture (`0x118c70`), qui n'a qu'un appelant (`0x10f304`) : il passe `hid:USER`. La chaîne `hid:SPVR` n'est lue par personne.

**Atteintes depuis le point d'entrée (7)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x000A0000` | GetIPCHandles | `hid_GetIPCHandles` | `0x1247b8` | 1 |
| `0x00110000` | EnableAccelerometer | `hid_EnableAccelerometer` | `0x1ef348` | 1 |
| `0x00120000` | DisableAccelerometer | `hid_DisableAccelerometer` | `0x1ef378` | 1 |
| `0x00130000` | EnableGyroscopeLow | `hid_EnableGyroscopeLow` | `0x1ef2e8` | 1 |
| `0x00140000` | DisableGyroscopeLow | `hid_DisableGyroscopeLow` | `0x1ef318` | 1 |
| `0x00150000` | GetGyroscopeLowRawToDpsCoefficient | `hid_GetGyroscopeLowRawToDpsCoefficient` | `0x1ef404` | 1 |
| `0x00160000` | GetGyroscopeLowCalibrateParam | `hid_GetGyroscopeLowCalibrateParam` | `0x1ef3a8` | 1 |

Le jeu lit les boutons et le tactile dans la mémoire partagée, à son propre rythme, sans jamais attendre l'un des cinq signaux que GetIPCHandles lui donne ([contrat des petits services](contrat-petits-services.md), partie 2). L'accéléromètre et le gyroscope ne sont allumés qu'à la demande d'un écran.

### `dsp::DSP`

Poignée à `0x5d402c`, recopiée à `0x5d4028` (`0x134148`) ; les fonctions d'envoi passent par le pointeur `0x5d4020`, qui vaut `0x5d4028` (`0x13413c`).

**Atteintes depuis le point d'entrée (13)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010040` | RecvData | `dsp_RecvData` | `0x16f9f0` | 1 |
| `0x00020040` | RecvDataIsReady | `dsp_RecvDataIsReady` | `0x16f8c0` | 1 |
| `0x00070040` | SetSemaphore | `dsp_SetSemaphore` | `0x16f888` | 1 |
| `0x000C0040` | ConvertProcessAddressFromDspDram | `dsp_ConvertProcessAddressFromDspDram` | `0x16f9b4` | 1 |
| `0x000D0082` | WriteProcessPipe | `dsp_WriteProcessPipe` | `0x16f904` | 1 |
| `0x001000C0` | ReadPipeIfPossible | `dsp_ReadPipeIfPossible` | `0x16f94c` | 1 |
| `0x001100C2` | LoadComponent | `dsp_LoadComponent` | `0x1342fc` | 4 |
| `0x00120000` | UnloadComponent | `dsp_UnloadComponent` | `0x124148` | 3 |
| `0x00130082` | FlushDataCache | `dsp_FlushDataCache` | `0x17d9ec` | 1 |
| `0x00140082` | InvalidateDCache | `dsp_InvalidateDCache` | `0x1ec658` | 1 |
| `0x00150082` | RegisterInterruptEvents | `dsp_RegisterInterruptEvents` | `0x160038` | 2 |
| `0x00160000` | GetSemaphoreEventHandle | `dsp_GetSemaphoreEventHandle` | `0x160004` | 1 |
| `0x00170040` | SetSemaphoreMask | `dsp_SetSemaphoreMask` | `0x15ffcc` | 1 |

Lues des deux côtés et exécutées dans un émulateur dans le [contrat de `dsp::DSP`](contrat-dsp.md). Une fois le son démarré, la boucle de son n'envoie plus aucune commande : elle échange avec le DSP par deux signaux et la mémoire partagée.

### `cfg:u`

Poignée à `0x5e9144`. `cfg_init_any` (`0x1189bc`) demande d'abord `cfg:u` ; si la console refuse, il demande `cfg:s` puis `cfg:i` et recopie leur poignée dans la même variable (`0x123ff4`, `0x124070`). Les quatre commandes existent dans les trois services.

**Correction.** Cette fiche ajoutait « sur une console de série c'est `cfg:u` qui répond », comme si ce repli servait à chaque démarrage. Il ne sert jamais sur une console du commerce : `cfg_init_any` n'a que deux appelants, `cfg_get_debug_flag` (`0x10ef6c`) et `cfg_get_debug_value` (`0x10f21c`), qui commencent par tester le bit 0 de l'octet `0x1FF80014` et reviennent sans rien envoyer quand il est levé, ce qui est le cas d'une console du commerce. Relevé par le [contrat des petits services](contrat-petits-services.md) (partie 3) et relu dans l'assembleur pour cette fiche. Tout le reste du jeu passe par `cfg_init_user`, qui n'ouvre que `cfg:u`.

**Atteintes depuis le point d'entrée (4)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010082` | GetConfigInfoBlk2 | `cfg_GetConfigInfoBlk2` | `0x1240f8` | 23 |
| `0x00020000` | SecureInfoGetRegion | `cfg_SecureInfoGetRegion` | `0x118a24` | 1 |
| `0x00030040` | GenHashConsoleUnique | `cfg_GenHashConsoleUnique` | `0x1240b0` | 1 |
| `0x00040000` | GetRegionCanadaUSA | `cfg_GetRegionCanadaUSA` | `0x146bd4` | 2 |

### `ptm:u`

Poignée à `0x5e8098`. Une seule commande. Les quatre autres noms de `ptm` présents dans le code ne sont lus par personne.

**Atteintes depuis le point d'entrée (1)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x000B00C2` | GetStepHistory | `ptm_GetStepHistory` | `0x124d24` | 1 |

Le jeu demande les 24 heures du jour et arrête tout si la commande échoue. Le tampon est sur sa pile, non initialisé : une réponse doit y écrire des zéros, pas seulement rendre 0 ([contrat des petits services](contrat-petits-services.md), partie 4).

### `ldr:ro`

Poignée à `0x5e80d0`. C'est le service du module `ro`, qui charge les `.cro` : voir la partie 5.

**Atteintes depuis le point d'entrée (4)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x000100C2` | Initialize | `ldrro_Initialize` | `0x133fa8` | 1 |
| `0x00020082` | LoadCRR | `ldrro_LoadCRR` | `0x118548` | 1 |
| `0x000402C2` | LoadExeCRO | `ldrro_LoadExeCRO` | `0x1e793c` | 1 |
| `0x000500C2` | UnloadCRO | `ldrro_UnloadCRO` | `0x146a0c` | 1 |

Ces quatre commandes, et le gestionnaire de modules du jeu qui les envoie, sont lus côté jeu dans le [contrat des petits services](contrat-petits-services.md) (partie 6) ; le côté de `ro` ne l'était pas encore quand il a été écrit. Cela corrige la partie 5 ci-dessous sur deux points.

### `ndm:u`

Poignée à `0x5e8024`.

**Atteintes depuis le point d'entrée (8)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010042` | EnterExclusiveState | `ndm_EnterExclusiveState` | `0x1efc74` | 4 |
| `0x00020002` | LeaveExclusiveState | `ndm_LeaveExclusiveState` | `0x16fc78` | 7 |
| `0x00060040` | SuspendDaemons | `ndm_SuspendDaemons` | `0x118e38` | 1 |
| `0x00070040` | ResumeDaemons | `ndm_ResumeDaemons` | `0x118dfc` | 1 |
| `0x00080040` | SuspendScheduler | `ndm_SuspendScheduler` | `0x1efbf8` | 1 |
| `0x00090000` | ResumeScheduler | `ndm_ResumeScheduler` | `0x1efbc4` | 1 |
| `0x00140040` | OverrideDefaultDaemons | `ndm_OverrideDefaultDaemons` | `0x118e70` | 1 |
| `0x00170000` | ClearHalfAwakeMacFilter | `ndm_ClearHalfAwakeMacFilter` | `0x1efcb8` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (1)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00030000` | QueryExclusiveMode | `ndm_QueryExclusiveMode` | `0x1efc38` | 1 |

### `ac:u`

Poignée à `0x5db714`.

**Atteintes depuis le point d'entrée (15)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010000` | CreateDefaultConfig | `ac_CreateDefaultConfig` | `0x1dd0b0` | 1 |
| `0x00040006` | ConnectAsync | `ac_ConnectAsync` | `0x1dceb8` | 1 |
| `0x00050002` | GetConnectResult | `ac_GetConnectResult` | `0x1dcfe4` | 1 |
| `0x00080004` | CloseAsync | `ac_CloseAsync` | `0x15f30c` | 1 |
| `0x00090002` | GetCloseResult | `ac_GetCloseResult` | `0x15f354` | 1 |
| `0x000A0000` | GetLastErrorCode | `ac_GetLastErrorCode` | `0x11800c` | 1 |
| `0x000D0000` | GetWifiStatus | `ac_GetWifiStatus` | `0x1dd100` | 1 |
| `0x000E0042` | GetCurrentAPInfo | `ac_GetCurrentAPInfo` | `0x1dd1f4` | 1 |
| `0x001D0042` | ScanAPs | `ac_ScanAPs` | `0x1dcf70` | 1 |
| `0x00240042` | AddDenyApType | `ac_AddDenyApType` | `0x1dcf10` | 1 |
| `0x00270002` | GetInfraPriority | `ac_GetInfraPriority` | `0x1dd020` | 1 |
| `0x002D0082` | SetRequestEulaVersion | `ac_SetRequestEulaVersion` | `0x1dd13c` | 1 |
| `0x00300004` | RegisterDisconnectEvent | `ac_RegisterDisconnectEvent` | `0x1dd1ac` | 1 |
| `0x003E0042` | IsConnected | `ac_IsConnected` | `0x117fc0` | 1 |
| `0x00400042` | SetClientVersion | `ac_SetClientVersion` | `0x1dd070` | 1 |

### `frd:u`

Poignée à `0x5e7f24`.

**Atteintes depuis le point d'entrée (16)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010000` | HasLoggedIn | `frd_HasLoggedIn` | `0x173870` | 3 |
| `0x00030002` | Login | `frd_Login` | `0x1654f0` | 1 |
| `0x00040000` | Logout | `frd_Logout` | `0x165530` | 1 |
| `0x00050000` | GetMyFriendKey | `frd_GetMyFriendKey` | `0x13547c` | 2 |
| `0x00080000` | GetMyPresence | `frd_GetMyPresence` | `0x11b7c4` | 1 |
| `0x00100040` | GetMyPassword | `frd_GetMyPassword` | `0x2d23d8` | 1 |
| `0x00110080` | GetFriendKeyList | `frd_GetFriendKeyList` | `0x11b814` | 1 |
| `0x00170042` | GetFriendAttributeFlags | `frd_GetFriendAttributeFlags` | `0x11b8bc` | 1 |
| `0x001C0042` | UnscrambleLocalFriendCode | `frd_UnscrambleLocalFriendCode` | `0x2d287c` | 1 |
| `0x00230000` | GetLastResponseResult | `frd_GetLastResponseResult` | `0x2d265c` | 1 |
| `0x00270040` | ResultToErrorCode | `frd_ResultToErrorCode` | `0x2d24cc` | 1 |
| `0x00280244` | RequestGameAuthentication | `frd_RequestGameAuthentication` | `0x2d27ec` | 2 |
| `0x00290000` | GetGameAuthenticationData | `frd_GetGameAuthenticationData` | `0x2d279c` | 1 |
| `0x002A0204` | RequestServiceLocator | `frd_RequestServiceLocator` | `0x2d2718` | 2 |
| `0x002B0000` | GetServiceLocatorData | `frd_GetServiceLocatorData` | `0x2d26c8` | 1 |
| `0x00320042` | SetClientSdkVersion | `frd_SetClientSdkVersion` | `0x11b87c` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (6)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00060000` | GetMyPreference | `frd_GetMyPreference` | `0x2d2434` | 1 |
| `0x00090000` | GetMyScreenName | `frd_GetMyScreenName` | `0x2d2488` | 1 |
| `0x00130142` | GetFriendScreenName | `frd_GetFriendScreenName` | `0x2d2510` | 1 |
| `0x002E0000` | GetServerTimeDifference | `frd_GetServerTimeDifference` | `0x2d268c` | 1 |
| `0x00330000` | GetMyApproachContext | `frd_GetMyApproachContext` | `0x2d25a8` | 1 |
| `0x00340046` | AddFriendWithApproach | `frd_AddFriendWithApproach` | `0x2d25f8` | 1 |

### `boss:U`

Poignée à `0x64c658` (champ `+8` de l'objet `0x64c650`), recopiée à `0x64c664` (`+0x14`, à `0x124ef4`) : c'est la copie que lisent les 28 fonctions. Chaque fonction de la bibliothèque existe en double : elle essaie d'abord la session « privilégiée » (tableau suivant), et prend celle-ci quand l'autre n'est pas ouverte.

**Atteintes depuis le point d'entrée (23)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010082` | InitializeSession | `boss_user_InitializeSession` | `0x134b3c` | 1 |
| `0x00030000` | UnregisterStorage | `boss_user_UnregisterStorage` | `0x119ed4` | 1 |
| `0x000B00C2` | RegisterTask | `boss_user_RegisterTask` | `0x2b6fcc` | 1 |
| `0x000C0082` | UnregisterTask | `boss_user_UnregisterTask` | `0x2b71a8` | 1 |
| `0x00120102` | GetNsDataIdList2 | `boss_user_GetNsDataIdList2` | `0x2b7484` | 1 |
| `0x00140082` | SendProperty | `boss_user_SendProperty` | `0x2b7020` | 1 |
| `0x00150042` | SendPropertyHandle | `boss_user_SendPropertyHandle` | `0x2b7298` | 1 |
| `0x00160082` | ReceiveProperty | `boss_user_ReceiveProperty` | `0x2b71f4` | 1 |
| `0x001D0042` | StartTaskImmediate | `boss_user_StartTaskImmediate` | `0x2b72dc` | 1 |
| `0x001E0042` | CancelTask | `boss_user_CancelTask` | `0x2b6ddc` | 1 |
| `0x001F0000` | GetTaskFinishHandle | `boss_user_GetTaskFinishHandle` | `0x2b7370` | 2 |
| `0x00200082` | GetTaskState | `boss_user_GetTaskState` | `0x2b6f64` | 1 |
| `0x00210042` | GetTaskResult | `boss_user_GetTaskResult` | `0x2b70e8` | 1 |
| `0x002300C2` | GetTaskStatus | `boss_user_GetTaskStatus` | `0x2b7148` | 1 |
| `0x00240082` | GetTaskError | `boss_user_GetTaskError` | `0x2b6f10` | 1 |
| `0x00260040` | DeleteNsData | `boss_user_DeleteNsData` | `0x119ea4` | 1 |
| `0x002700C2` | GetNsDataHeaderInfo | `boss_user_GetNsDataHeaderInfo` | `0x2b731c` | 2 |
| `0x00280102` | ReadNsData | `boss_user_ReadNsData` | `0x2b6e1c` | 1 |
| `0x002F0140` | RegisterStorageEntry | `boss_user_RegisterStorageEntry` | `0x119f3c` | 1 |
| `0x00300000` | GetStorageEntryInfo | `boss_user_GetStorageEntryInfo` | `0x119efc` | 1 |
| `0x00330042` | StartBgImmediate | `boss_user_StartBgImmediate` | `0x2b73f0` | 1 |
| `0x003500C2` | RegisterImmediateTask | `boss_user_RegisterImmediateTask` | `0x2b7430` | 1 |
| `0x00360084` | SetTaskQuery | `boss_user_SetTaskQuery` | `0x2b706c` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (5)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x000D0082` | ReconfigureTask | `boss_user_ReconfigureTask` | `0x2b724c` | 1 |
| `0x000E0000` | GetTaskIdList | `boss_user_GetTaskIdList` | `0x2b70c0` | 1 |
| `0x001B0042` | GetTaskServiceStatus | `boss_user_GetTaskServiceStatus` | `0x2b73a4` | 1 |
| `0x00250082` | GetTaskInfo | `boss_user_GetTaskInfo` | `0x2b6e80` | 1 |
| `0x002E0040` | GetErrorCode | `boss_user_GetErrorCode` | `0x2b6ecc` | 1 |

### `boss:P ?`

**Session jamais ouverte.** Ces 30 fonctions lisent `0x64c668` (champ `+0x18` de l'objet `0x64c650`), gardé par le drapeau `0x64c655`. Dans tout le code principal, la seule écriture de ces deux cases est leur mise à zéro au démarrage (`0x4c8618`) : `boss_get_privileged_session` (`0x119e70`) rend donc toujours une erreur, et le jeu retombe sur `boss:U`. Le nom `boss:P` est une déduction (la chaîne est dans le code sans que personne la lise, et trois en-têtes en `0x04…` n'existent que là), pas une preuve.

**Atteintes depuis le point d'entrée (25)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00030000` | UnregisterStorage | `boss_privileged_UnregisterStorage` | `0x119d3c` | 1 |
| `0x000B00C2` | RegisterTask | `boss_privileged_RegisterTask` | `0x2b5760` | 1 |
| `0x000C0082` | UnregisterTask | `boss_privileged_UnregisterTask` | `0x2b593c` | 1 |
| `0x00120102` | GetNsDataIdList2 | `boss_privileged_GetNsDataIdList2` | `0x2b5c8c` | 1 |
| `0x00140082` | SendProperty | `boss_privileged_SendProperty` | `0x2b57b4` | 1 |
| `0x00150042` | SendPropertyHandle | `boss_privileged_SendPropertyHandle` | `0x2b5a2c` | 1 |
| `0x00160082` | ReceiveProperty | `boss_privileged_ReceiveProperty` | `0x2b5988` | 1 |
| `0x001D0042` | StartTaskImmediate | `boss_privileged_StartTaskImmediate` | `0x2b5a70` | 1 |
| `0x001E0042` | CancelTask | `boss_privileged_CancelTask` | `0x2b5570` | 1 |
| `0x001F0000` | GetTaskFinishHandle | `boss_privileged_GetTaskFinishHandle` | `0x2b5b04` | 2 |
| `0x00200082` | GetTaskState | `boss_privileged_GetTaskState` | `0x2b56f8` | 1 |
| `0x00210042` | GetTaskResult | `boss_privileged_GetTaskResult` | `0x2b587c` | 1 |
| `0x002300C2` | GetTaskStatus | `boss_privileged_GetTaskStatus` | `0x2b58dc` | 1 |
| `0x00240082` | GetTaskError | `boss_privileged_GetTaskError` | `0x2b56a4` | 1 |
| `0x00260040` | DeleteNsData | `boss_privileged_DeleteNsData` | `0x119d0c` | 1 |
| `0x002700C2` | GetNsDataHeaderInfo | `boss_privileged_GetNsDataHeaderInfo` | `0x2b5ab0` | 2 |
| `0x00280102` | ReadNsData | `boss_privileged_ReadNsData` | `0x2b55b0` | 1 |
| `0x002F0140` | RegisterStorageEntry | `boss_privileged_RegisterStorageEntry` | `0x119da4` | 1 |
| `0x00300000` | GetStorageEntryInfo | `boss_privileged_GetStorageEntryInfo` | `0x119d64` | 1 |
| `0x00330042` | StartBgImmediate | `boss_privileged_StartBgImmediate` | `0x2b5bf8` | 1 |
| `0x003500C2` | RegisterImmediateTask | `boss_privileged_RegisterImmediateTask` | `0x2b5c38` | 1 |
| `0x00360084` | SetTaskQuery | `boss_privileged_SetTaskQuery` | `0x2b5800` | 1 |
| `0x041500C0` | DeleteNsDataPrivileged | `boss_privileged_DeleteNsDataPrivileged` | `0x119dec` | 1 |
| `0x04160142` | GetNsDataHeaderInfoPrivileged | `boss_privileged_GetNsDataHeaderInfoPrivileged` | `0x2b5cf8` | 2 |
| `0x04170182` | ReadNsDataPrivileged | `boss_privileged_ReadNsDataPrivileged` | `0x2b5b84` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (5)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x000D0082` | ReconfigureTask | `boss_privileged_ReconfigureTask` | `0x2b59e0` | 1 |
| `0x000E0000` | GetTaskIdList | `boss_privileged_GetTaskIdList` | `0x2b5854` | 1 |
| `0x001B0042` | GetTaskServiceStatus | `boss_privileged_GetTaskServiceStatus` | `0x2b5b38` | 1 |
| `0x00250082` | GetTaskInfo | `boss_privileged_GetTaskInfo` | `0x2b5614` | 1 |
| `0x002E0040` | GetErrorCode | `boss_privileged_GetErrorCode` | `0x2b5660` | 1 |

### `cecd:u`

Poignée à `0x5e9130`.

**Atteintes depuis le point d'entrée (16)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x000100C2` | OpenRawFile | `cecd_OpenRawFile` | `0x1eac08` | 1 |
| `0x00020042` | ReadRawFile | `cecd_ReadRawFile` | `0x1eac58` | 1 |
| `0x00030104` | ReadMessage | `cecd_ReadMessage` | `0x1ea8c4` | 1 |
| `0x00040106` | ReadMessageWithHMAC | `cecd_ReadMessageWithHMAC` | `0x1eaab8` | 1 |
| `0x00050042` | WriteRawFile | `cecd_WriteRawFile` | `0x1ead18` | 1 |
| `0x00060104` | WriteMessage | `cecd_WriteMessage` | `0x1ea980` | 1 |
| `0x00070106` | WriteMessageWithHMAC | `cecd_WriteMessageWithHMAC` | `0x1eab4c` | 1 |
| `0x00080102` | Delete | `cecd_Delete` | `0x1ead60` | 1 |
| `0x000900C2` | SetData | `cecd_SetData` | `0x1eadbc` | 1 |
| `0x000A00C4` | ReadData | `cecd_ReadData` | `0x1eae04` | 1 |
| `0x000B0040` | Start | `cecd_Start` | `0x1eace0` | 1 |
| `0x000C0040` | Stop | `cecd_Stop` | `0x1eaca8` | 1 |
| `0x000E0000` | GetCecdState | `cecd_GetCecdState` | `0x1ea944` | 1 |
| `0x00100000` | GetChangeStateEventHandle | `cecd_GetChangeStateEventHandle` | `0x1eabcc` | 1 |
| `0x00110104` | OpenAndWrite | `cecd_OpenAndWrite` | `0x1eaa60` | 1 |
| `0x00120104` | OpenAndRead | `cecd_OpenAndRead` | `0x1ea9f0` | 1 |

### `cecd:s ?`

**Session jamais ouverte.** Seconde poignée à `0x5e9134`, que seul un initialiseur met à zéro (`0x4c2578`). Chaque fonction de la bibliothèque (`0x1ea734`, par exemple) teste d'abord cette seconde case : remplie, elle envoie par elle ; vide, elle prend la poignée de `cecd:u`. Les 16 en-têtes sont exactement ceux de `cecd:u` ; le nom `cecd:s` est une déduction (chaîne présente, jamais lue).

**Atteintes depuis le point d'entrée (16)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x000100C2` | OpenRawFile (nom lu sous cecd:u) | `cecd_second_OpenRawFile` | `0x1eb2d0` | 1 |
| `0x00020042` | ReadRawFile (nom lu sous cecd:u) | `cecd_second_ReadRawFile` | `0x1eb320` | 1 |
| `0x00030104` | ReadMessage (nom lu sous cecd:u) | `cecd_second_ReadMessage` | `0x1eaf8c` | 1 |
| `0x00040106` | ReadMessageWithHMAC (nom lu sous cecd:u) | `cecd_second_ReadMessageWithHMAC` | `0x1eb180` | 1 |
| `0x00050042` | WriteRawFile (nom lu sous cecd:u) | `cecd_second_WriteRawFile` | `0x1eb3e0` | 1 |
| `0x00060104` | WriteMessage (nom lu sous cecd:u) | `cecd_second_WriteMessage` | `0x1eb048` | 1 |
| `0x00070106` | WriteMessageWithHMAC (nom lu sous cecd:u) | `cecd_second_WriteMessageWithHMAC` | `0x1eb214` | 1 |
| `0x00080102` | Delete (nom lu sous cecd:u) | `cecd_second_Delete` | `0x1eb428` | 1 |
| `0x000900C2` | SetData (nom lu sous cecd:u) | `cecd_second_SetData` | `0x1eb484` | 1 |
| `0x000A00C4` | ReadData (nom lu sous cecd:u) | `cecd_second_ReadData` | `0x1eb4cc` | 1 |
| `0x000B0040` | Start (nom lu sous cecd:u) | `cecd_second_Start` | `0x1eb3a8` | 1 |
| `0x000C0040` | Stop (nom lu sous cecd:u) | `cecd_second_Stop` | `0x1eb370` | 1 |
| `0x000E0000` | GetCecdState (nom lu sous cecd:u) | `cecd_second_GetCecdState` | `0x1eb00c` | 1 |
| `0x00100000` | GetChangeStateEventHandle (nom lu sous cecd:u) | `cecd_second_GetChangeStateEventHandle` | `0x1eb294` | 1 |
| `0x00110104` | OpenAndWrite (nom lu sous cecd:u) | `cecd_second_OpenAndWrite` | `0x1eb128` | 1 |
| `0x00120104` | OpenAndRead (nom lu sous cecd:u) | `cecd_second_OpenAndRead` | `0x1eb0b8` | 1 |

### `http:C`

Deux sortes de sessions. La session générale : poignée à `0x6420e4`, recopiée à `0x6420e8` (`0x163ce8`), 7 fonctions. Et une session **par contexte HTTP** : `http_context_open_session` (`0x2b8ba4`) redemande `http:C` pour chaque contexte, range la poignée à `+8` de l'objet contexte et la recopie à `+0xC` (`0x2b8c44`) ; 17 fonctions lisent ce champ. Pour celles-là le lien est fait par le champ de l'objet, pas par une variable fixe.

**Atteintes depuis le point d'entrée (24)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010044` | Initialize | `http_Initialize` | `0x172f00` | 1 |
| `0x00020082` | CreateContext | `http_CreateContext` | `0x2b9394` | 1 |
| `0x00030040` | CloseContext | `http_CloseContext` | `0x2b944c` | 3 |
| `0x00040040` | CancelConnection | `http_CancelConnection` | `0x2b9364` | 1 |
| `0x00060040` | GetDownloadSizeState | `http_GetDownloadSizeState` | `0x2b94e0` | 1 |
| `0x00080042` | InitializeConnectionSession | `http_InitializeConnectionSession` | `0x2b9604` | 1 |
| `0x000A0040` | BeginRequestAsync | `http_BeginRequestAsync` | `0x2b94b0` | 1 |
| `0x000B0082` | ReceiveData | `http_ReceiveData` | `0x2b967c` | 1 |
| `0x000E0040` | SetProxyDefault | `http_SetProxyDefault` | `0x2b92d4` | 1 |
| `0x001100C4` | AddRequestHeader | `http_AddRequestHeader` | `0x2b9180` | 1 |
| `0x001200C4` | AddPostDataAscii | `http_AddPostDataAscii` | `0x2b9304` | 1 |
| `0x001300C4` | AddPostDataBinary | `http_AddPostDataBinary` | `0x2b93ec` | 1 |
| `0x00140082` | AddPostDataRaw | `http_AddPostDataRaw` | `0x2b91e0` | 1 |
| `0x00150080` | SetPostDataType | `http_SetPostDataType` | `0x2b9598` | 1 |
| `0x001A0082` | SendPostDataRaw | `http_SendPostDataRaw` | `0x2b9290` | 1 |
| `0x001D0040` | NotifyFinishSendPostData | `http_NotifyFinishSendPostData` | `0x2b95d4` | 1 |
| `0x001E00C4` | GetResponseHeader | `http_GetResponseHeader` | `0x2b9224` | 1 |
| `0x00220040` | GetResponseStatusCode | `http_GetResponseStatusCode` | `0x2b9144` | 1 |
| `0x00240082` | AddTrustedRootCA | `http_AddTrustedRootCA` | `0x2b96c0` | 1 |
| `0x00250080` | AddDefaultCert | `http_AddDefaultCert` | `0x2b947c` | 1 |
| `0x00280080` | SetClientCertDefault | `http_SetClientCertDefault` | `0x2b9564` | 1 |
| `0x002A0040` | Inconnue | `http_cmd_002A0040` | `0x2b9528` | 1 |
| `0x003800C0` | SetPostDataTypeSize | `http_SetPostDataTypeSize` | `0x2b963c` | 1 |
| `0x00390000` | Finalize | `http_Finalize` | `0x163c6c` | 1 |

### `ssl:C`

Poignée à `0x64543c`, recopiée à `0x645440` (`0x2aff98`). Parmi les trois commandes figure un `0x00010002` (RegisterClient dans `srv:`) : ici c'est la commande 1 de `ssl:C`, Initialize, qui a le même en-tête.

**Atteintes depuis le point d'entrée (2)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00100000` | SeedRNG | `ssl_SeedRNG` | `0x2afffc` | 1 |
| `0x00110042` | GenerateRandomData | `ssl_GenerateRandomData` | `0x2b0024` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (1)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010002` | Initialize | `ssl_Initialize` | `0x2b0064` | 1 |

### `soc:U`

Deux sortes de sessions. La poignée générale à `0x5e80f8` (9 fonctions). Et une réserve de sessions tenue par l'objet `0x645154` : `session_pool_open_session` (`0x18b898`) ouvre une session au nom gardé dans l'objet à `+0x38`, où `0x164e24` a recopié `soc:U`. Les 11 fonctions concernées sont appelées par des fonctions qui viennent de prendre une session dans cette réserve.

**Atteintes depuis le point d'entrée (20)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010044` | InitializeSockets | `soc_InitializeSockets` | `0x17372c` | 1 |
| `0x000200C2` | socket | `soc_socket` | `0x2cfc04` | 1 |
| `0x00050084` | bind | `soc_bind` | `0x2cfa04` | 1 |
| `0x00060084` | connect | `soc_connect` | `0x2cfc50` | 1 |
| `0x00070104` | recvfrom_other | `soc_recvfrom_other` | `0x2cfcb0` | 1 |
| `0x00080102` | recvfrom | `soc_recvfrom` | `0x2cf8e8` | 1 |
| `0x00090106` | sendto_other | `soc_sendto_other` | `0x2cfb80` | 1 |
| `0x000A0106` | sendto | `soc_sendto` | `0x2cf864` | 1 |
| `0x000B0042` | close | `soc_close` | `0x2cfaf0` | 1 |
| `0x000C0082` | shutdown | `soc_shutdown` | `0x2cfd34` | 1 |
| `0x000D0082` | gethostbyname | `soc_gethostbyname` | `0x1937e8` | 1 |
| `0x00120104` | setsockopt | `soc_setsockopt` | `0x2cf790` | 1 |
| `0x001300C2` | fcntl | `soc_fcntl` | `0x2cfb34` | 1 |
| `0x00140084` | poll | `soc_poll` | `0x2cfa64` | 1 |
| `0x00160000` | gethostid | `soc_gethostid` | `0x2cfd78` | 1 |
| `0x00170082` | getsockname | `soc_getsockname` | `0x2cf7f8` | 1 |
| `0x00190000` | ShutdownSockets | `soc_ShutdownSockets` | `0x173770` | 1 |
| `0x001A00C0` | GetNetworkOpt | `soc_GetNetworkOpt` | `0x173798` | 1 |
| `0x001F0040` | GetResolverInfo | `soc_GetResolverInfo` | `0x173814` | 1 |
| `0x00200146` | SendToMultiple | `soc_SendToMultiple` | `0x2cf98c` | 1 |

### `soc:P ?`

**Session jamais ouverte.** Poignée à `0x5e80fc`, jamais remplie. `0x2d1614` l'essaie avant de retomber sur `soc:U` (commande gethostid). L'en-tête `0x00060000` est celui de gethostid dans `soc:P` d'après la Carte : c'est ce qui donne le nom, sans preuve.

**Atteintes depuis le point d'entrée (1)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00060000` | gethostid | `socp_gethostid` | `0x2cde08` | 1 |

### `nwm::UDS`

Deux poignées, toutes deux demandées sous le nom `nwm::UDS` dans `0x2b18a0` : `0x5d42ac` (21 fonctions) et `0x5d42a8` (une seule, PullPacket).

**Atteintes depuis le point d'entrée (22)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00030000` | Finalize | `uds_Finalize` | `0x2b25c0` | 1 |
| `0x00050040` | EjectClient | `uds_EjectClient` | `0x2b2018` | 1 |
| `0x00070080` | UpdateNetworkAttribute | `uds_UpdateNetworkAttribute` | `0x2b23d0` | 2 |
| `0x00080000` | DestroyNetwork | `uds_DestroyNetwork` | `0x2b20a4` | 1 |
| `0x000A0000` | DisconnectNetwork | `uds_DisconnectNetwork` | `0x2b21a8` | 1 |
| `0x000B0000` | GetConnectionStatus | `uds_GetConnectionStatus` | `0x2b22c4` | 1 |
| `0x000D0040` | GetNodeInformation | `uds_GetNodeInformation` | `0x2b2230` | 1 |
| `0x000F0404` | StartScan | `uds_StartScan` | `0x2b25e8` | 2 |
| `0x00100042` | SetApplicationData | `uds_SetApplicationData` | `0x2b2280` | 1 |
| `0x00110040` | GetApplicationData | `uds_GetApplicationData` | `0x2b21d0` | 1 |
| `0x00120100` | Bind | `uds_Bind` | `0x2b24b8` | 1 |
| `0x00130040` | Unbind | `uds_Unbind` | `0x2b2578` | 1 |
| `0x001400C0` | PullPacket | `uds_PullPacket` | `0x2b1fac` | 1 |
| `0x00170182` | SendTo | `uds_SendTo` | `0x2b2504` | 1 |
| `0x001A0000` | GetChannel | `uds_GetChannel` | `0x2b1f78` | 1 |
| `0x001B0302` | InitializeWithVersion | `uds_InitializeWithVersion` | `0x2b2314` | 1 |
| `0x001D0044` | CreateNetwork2 | `uds_CreateNetwork2` | `0x2b2050` | 1 |
| `0x001E0084` | ConnectNetwork2 | `uds_ConnectNetwork2` | `0x2b20cc` | 1 |
| `0x001F0006` | GetNodeInformationList | `uds_GetNodeInformationList` | `0x2b2410` | 1 |
| `0x00210080` | SetProbeResponseParam | `uds_SetProbeResponseParam` | `0x2b2388` | 1 |
| `0x00220402` | ScanOnConnection | `uds_ScanOnConnection` | `0x2b2130` | 1 |
| `0x00230000` | Inconnue | `uds_cmd_00230000` | `0x2b2484` | 2 |

### `ir:USER`

Poignée à `0x5e9690`. Deux en-têtes ne sont pas dans la Carte.

**Atteintes depuis le point d'entrée (13)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00020000` | FinalizeIrnop | `iruser_FinalizeIrnop` | `0x1e66f4` | 1 |
| `0x00030000` | ClearReceiveBuffer | `iruser_ClearReceiveBuffer` | `0x1e67fc` | 1 |
| `0x000702C0` | AutoConnection | `iruser_AutoConnection` | `0x1e6724` | 1 |
| `0x00090000` | Disconnect | `iruser_Disconnect` | `0x1e6688` | 1 |
| `0x000A0000` | GetReceiveEvent | `iruser_GetReceiveEvent` | `0x1e67c0` | 1 |
| `0x000B0000` | GetSendEvent | `iruser_GetSendEvent` | `0x1e66b8` | 1 |
| `0x000C0000` | GetConnectionStatusEvent | `iruser_GetConnectionStatusEvent` | `0x1e691c` | 1 |
| `0x000D0042` | SendIrnop | `iruser_SendIrnop` | `0x1e69a4` | 1 |
| `0x000E0042` | SendIrnopLarge | `iruser_SendIrnopLarge` | `0x1e6778` | 1 |
| `0x00110040` | inconnue de la Carte | `iruser_cmd_00110040` | `0x1e6958` | 1 |
| `0x00160000` | inconnue de la Carte | `iruser_cmd_00160000` | `0x1e68bc` | 1 |
| `0x00180182` | InitializeIrnopShared | `iruser_InitializeIrnopShared` | `0x1e6864` | 1 |
| `0x00190040` | ReleaseReceivedData | `iruser_ReleaseReceivedData` | `0x1e682c` | 2 |

### `mic:u`

Poignée à `0x5e8020`. Trois de ces fonctions (`0x1ef880`, `0x1efa0c`, `0x1efa4c`) sont importées directement par un `.cro`.

**Atteintes depuis le point d'entrée (10)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010042` | MapSharedMem | `mic_MapSharedMem` | `0x1ef948` | 1 |
| `0x00020000` | UnmapSharedMem | `mic_UnmapSharedMem` | `0x1ef814` | 2 |
| `0x00030140` | StartSampling | `mic_StartSampling` | `0x1ef8f4` | 1 |
| `0x00050000` | StopSampling | `mic_StopSampling` | `0x1ef8c4` | 1 |
| `0x00060000` | IsSampling | `mic_IsSampling` | `0x1ef844` | 2 |
| `0x00080040` | SetGain | `mic_SetGain` | `0x1efa4c` | 2 |
| `0x00090000` | GetGain | `mic_GetGain` | `0x1efa0c` | 1 |
| `0x000A0040` | SetPower | `mic_SetPower` | `0x1ef880` | 2 |
| `0x000C0042` | SetIirFilterMic | `mic_SetIirFilterMic` | `0x1ef98c` | 1 |
| `0x00100040` | Inconnue | `mic_cmd_00100040` | `0x1ef9d4` | 1 |

### `cam:u`

Poignée à `0x5d3dbc`. Les trois quarts de ces fonctions ne sont atteintes que par des fonctions qu'un `.cro` importe.

**Atteintes depuis le point d'entrée (9)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010040` | StartCapture | `cam_StartCapture` | `0x2cadb4` | 1 |
| `0x00020040` | StopCapture | `cam_StopCapture` | `0x2cac38` | 1 |
| `0x00030040` | IsBusy | `cam_IsBusy` | `0x2cb2a4` | 1 |
| `0x00070102` | SetReceiving | `cam_SetReceiving` | `0x2cad04` | 1 |
| `0x00130040` | Activate | `cam_Activate` | `0x126290` | 3 |
| `0x003A0000` | DriverFinalize | `cam_DriverFinalize` | `0x2cadf0` | 1 |
| `0x003B0000` | GetActivatedCamera | `cam_GetActivatedCamera` | `0x126254` | 1 |
| `0x003C0000` | GetSleepCamera | `cam_GetSleepCamera` | `0x1261dc` | 1 |
| `0x003D0040` | SetSleepCamera | `cam_SetSleepCamera` | `0x126218` | 2 |

**Atteintes seulement par une fonction qu'un `.cro` importe (27)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00040040` | ClearBuffer | `cam_ClearBuffer` | `0x2caa7c` | 1 |
| `0x00050040` | GetVsyncInterruptEvent | `cam_GetVsyncInterruptEvent` | `0x2cb110` | 1 |
| `0x00060040` | GetBufferErrorInterruptEvent | `cam_GetBufferErrorInterruptEvent` | `0x2cb21c` | 1 |
| `0x00090100` | SetTransferLines | `cam_SetTransferLines` | `0x2cafc8` | 1 |
| `0x000A0080` | GetMaxLines | `cam_GetMaxLines` | `0x2cab0c` | 1 |
| `0x000B0100` | SetTransferBytes | `cam_SetTransferBytes` | `0x2caf74` | 1 |
| `0x000C0040` | GetTransferBytes | `cam_GetTransferBytes` | `0x2caf28` | 1 |
| `0x000D0080` | GetMaxBytes | `cam_GetMaxBytes` | `0x2caab8` | 1 |
| `0x000E0080` | SetTrimming | `cam_SetTrimming` | `0x2cabf0` | 1 |
| `0x00120140` | SetTrimmingParamsCenter | `cam_SetTrimmingParamsCenter` | `0x2cb15c` | 1 |
| `0x00150080` | SetExposure | `cam_SetExposure` | `0x2caba8` | 1 |
| `0x00160080` | SetWhiteBalance | `cam_SetWhiteBalance` | `0x2caeb0` | 1 |
| `0x00180080` | SetSharpness | `cam_SetSharpness` | `0x2cad6c` | 1 |
| `0x00190080` | SetAutoExposure | `cam_SetAutoExposure` | `0x2cae68` | 1 |
| `0x001B0080` | SetAutoWhiteBalance | `cam_SetAutoWhiteBalance` | `0x2cb068` | 1 |
| `0x001D00C0` | FlipImage | `cam_FlipImage` | `0x2cb340` | 1 |
| `0x001F00C0` | SetSize | `cam_SetSize` | `0x2cb2f0` | 1 |
| `0x00200080` | SetFrameRate | `cam_SetFrameRate` | `0x2cac74` | 1 |
| `0x00210080` | SetPhotoMode | `cam_SetPhotoMode` | `0x2cacbc` | 1 |
| `0x002200C0` | SetEffect | `cam_SetEffect` | `0x2cb390` | 1 |
| `0x00230080` | SetContrast | `cam_SetContrast` | `0x2cab60` | 1 |
| `0x00240080` | SetLensCorrection | `cam_SetLensCorrection` | `0x2cb020` | 1 |
| `0x00260140` | SetAutoExposureWindow | `cam_SetAutoExposureWindow` | `0x2cb0b0` | 1 |
| `0x00270140` | SetAutoWhiteBalanceWindow | `cam_SetAutoWhiteBalanceWindow` | `0x2cb1bc` | 1 |
| `0x00280080` | SetNoiseFilter | `cam_SetNoiseFilter` | `0x2cae20` | 1 |
| `0x00360000` | GetSuitableY2rStandardCoefficient | `cam_GetSuitableY2rStandardCoefficient` | `0x2cb268` | 1 |
| `0x00390000` | DriverInitialize | `cam_DriverInitialize` | `0x2caef8` | 1 |

### `y2r:u`

Poignée à `0x5d42f4`.

**Atteintes depuis le point d'entrée (12)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00030040` | SetOutputFormat | `y2r_SetOutputFormat` | `0x2b2e48` | 1 |
| `0x00050040` | SetRotation | `y2r_SetRotation` | `0x2b2b68` | 1 |
| `0x00070040` | SetBlockAlignment | `y2r_SetBlockAlignment` | `0x2b2f20` | 1 |
| `0x00130102` | SetSendingYuv | `y2r_SetSendingYuv` | `0x2b2d50` | 1 |
| `0x00180102` | SetReceiving | `y2r_SetReceiving` | `0x2b2cb8` | 1 |
| `0x001A0040` | SetInputLineWidth | `y2r_SetInputLineWidth` | `0x2b2f5c` | 1 |
| `0x001C0040` | SetInputLines | `y2r_SetInputLines` | `0x2b2d14` | 1 |
| `0x00220040` | SetAlpha | `y2r_SetAlpha` | `0x2b30c4` | 1 |
| `0x00260000` | StartConversion | `y2r_StartConversion` | `0x2b2e84` | 1 |
| `0x00270000` | StopConversion | `y2r_StopConversion` | `0x2b2e18` | 1 |
| `0x00280000` | IsBusyConversion | `y2r_IsBusyConversion` | `0x2b2ee4` | 1 |
| `0x002C0000` | DriverFinalize | `y2r_DriverFinalize` | `0x2b2dac` | 1 |

**Atteintes seulement par une fonction qu'un `.cro` importe (10)**

| En-tête | Commande | Fonction du jeu | Adresse | Appelants |
| --- | --- | --- | --- | --- |
| `0x00010040` | SetInputFormat | `y2r_SetInputFormat` | `0x2b2ddc` | 1 |
| `0x000D0040` | SetTransferEndInterrupt | `y2r_SetTransferEndInterrupt` | `0x2b3088` | 1 |
| `0x000F0000` | GetTransferEndEvent | `y2r_GetTransferEndEvent` | `0x2b2f98` | 1 |
| `0x00100102` | SetSendingY | `y2r_SetSendingY` | `0x2b2c5c` | 1 |
| `0x00110102` | SetSendingU | `y2r_SetSendingU` | `0x2b2ba4` | 1 |
| `0x00120102` | SetSendingV | `y2r_SetSendingV` | `0x2b2c00` | 1 |
| `0x00140000` | IsFinishedSendingYuv | `y2r_IsFinishedSendingYuv` | `0x2b3010` | 1 |
| `0x00190000` | IsFinishedReceiving | `y2r_IsFinishedReceiving` | `0x2b2fd4` | 1 |
| `0x00200040` | SetStandardCoefficient | `y2r_SetStandardCoefficient` | `0x2b304c` | 1 |
| `0x002B0000` | DriverInitialize | `y2r_DriverInitialize` | `0x2b2eb4` | 1 |

## Partie 4 : la séquence de démarrage

Elle est lue en partant du point d'entrée et en suivant les appels directs. À l'intérieur d'une fonction, les envois sont donnés **dans l'ordre des adresses** : c'est l'ordre d'exécution tant que la fonction va tout droit, et chaque fonction citée a été relue pour repérer ses branches. Ce qui dépend d'un test est signalé.

### Le point d'entrée

`entry` (`0x100000`) enchaîne neuf appels :

| Appel | Vers | Ce qu'il fait |
| --- | --- | --- |
| `0x100000` | `clear_bss` (`0x100024`) | met à zéro la mémoire de `0x5edc38` à `0x664498` |
| `0x100004`, `0x100008`, `0x10000c` | `0x1063dc`, `0x106f7c`, `0x106450` | aucun envoi en dessous ; pas lues |
| `0x100010` | `0x102f00` (Thumb) | aucun envoi en dessous ; pas lue |
| `0x100014` | `call_init_array` (`0x1063a8`) | appelle les fonctions d'une table qui est vide (`0x5a8f10` à `0x5a8f10`) |
| `0x100018` | `startup_init_srv_apt_ndm` (`0x106430`) | les trois premiers guichets : étape 1 |
| `0x10001c` | `main` (`0x106138`) | tout le reste : étapes 2 à 5 |
| `0x100020` | `0x106130` | `svcExitProcess` |

### Étape 1 : `srv:`, `APT:U`, `ndm:u`

`startup_init_srv_apt_ndm` (`0x106430`) appelle quatre fonctions à la suite, sans test.

1. `startup_init_srv` (`0x1098ac`) : `srv_init`, donc `svcConnectToPort("srv:")` puis **RegisterClient** (`0x00010002`, avec le mot `0x20` qui demande au noyau d'écrire le numéro du processus). Ensuite **EnableNotification** (`0x00020000`), qui rend le sémaphore des notifications.
2. `0x107178`, avec `0` : aucun envoi.
3. `startup_init_apt` (`0x106518`) appelle `apt_init` (`0x109ac8`) avec le numéro d'application `0x300` :
   - GetServiceHandle `APT:U` ;
   - **GetLockHandle** (`0x00010040`), puis la session est refermée ;
   - GetServiceHandle `APT:U` à nouveau, sous le verrou ;
   - **Initialize** (`0x00020080`), puis fermeture.
4. `startup_init_ndm` (`0x109868`) : GetServiceHandle `ndm:u`, puis **OverrideDefaultDaemons** (`0x00140040`).

C'est le début du démarrage d'une application tel que le décrit la fiche `ns`, partie 4, vu de l'autre côté.

### Étape 2 : `main` avant les fichiers

`main` (`0x106138`), dans l'ordre :

1. `0x16f860` : `cfg_init_user`, GetServiceHandle `cfg:u`.
2. `0x107188` : GetServiceHandle `ptm:u`.
3. Trois appels sans envoi ; deux d'entre eux reçoivent l'adresse d'une fonction (`0x10747c`, `0x107458`), sans doute des fonctions de rappel.
4. `apt_enable_and_wait` (`0x1073ac`), avec `1`. Cette fiche donnait d'abord AppletUtility puis Enable, dans l'ordre des adresses. **L'ordre réel est Enable, NotifyToWait, GlanceParameter, ReceiveParameter, AppletUtility (opération 7), AppletUtility (opération 4)** ([contrat APT](contrat-apt.md), partie 2, relu dans l'assembleur pour cette fiche) :
   - l'appel placé avant Enable (`0x1256f0`, à `0x1073bc`) reçoit 0 : il note seulement un octet et revient, sans rien envoyer ;
   - **Enable** (`0x00030040`) part à `0x1073c8`, sous le verrou ;
   - si le jeu doit attendre son tour, il note `0x62` et entre dans `apt_wait_for_wakeup` (`0x11b074`), qui envoie **NotifyToWait** (par `0x125c60`) puis s'endort ;
   - le fil d'APT du jeu, réveillé par le signal des paramètres, envoie **GlanceParameter** ; le fil principal, réveillé à son tour, envoie **ReceiveParameter** ;
   - la commande reçue est 1 : `apt_wait_for_wakeup` saute les envois du retour au premier plan (droit d'affichage, mémoire vidéo : branche à `0x11b25c`) et le rechargement du son, qui n'a lieu que si le son a été déchargé avant (`0x11aedc`) ; puis **AppletUtility** opération 7 et opération 4.

   Les envois à `gsp::Gpu`, `dsp::DSP` et `cam:u` que l'on trouve sous `0x11b074` sont donc réservés aux retours (commandes `0x0A`, `0x0B` et suivantes), jamais au premier lancement.
5. Deux tests (`0x110170`, `0x10ffe4`) qui peuvent envoyer directement à la sortie (étape 5).

### Étape 3 : `game_init_systems`

`game_init_systems` (`0x107cbc`) est la grande fonction d'installation, appelée par `main` à `0x1061a8`. Elle contient un aiguillage à neuf cas (`0x10817c`) et plusieurs tests : l'ordre ci-dessous est celui des adresses des appels, et un pas peut être sauté.

| Appel à | Vers | Guichet ouvert | Premières commandes |
| --- | --- | --- | --- |
| `0x1080a4` | `0x10a1a0` | `fs:USER` | InitializeWithSdkVersion (`0x08610042`), SetPriority (`0x08620040`), OpenFileDirectly (`0x08030204`), GetPriority (`0x08630000`) ; dans l'ordre réel : Initialize, SetPriority, OpenFileDirectly, Read et Close du fichier, OpenFileDirectly à nouveau, six Read, GetPriority ([contrat des fichiers](contrat-fs.md), partie 2) |
| `0x1080cc` | `0x1096ac` | sur une console du commerce, aucun : voir la note de `cfg:u` | GetConfigInfoBlk2 (`0x00010082`) du bloc de débogage `0x00130000`, seulement sur une console de développement |
| `0x108108` | `0x10972c` | | Subscribe de `srv:` (`0x00090040`) |
| `0x10822c` | `0x10f2f4` | `hid:USER` | GetIPCHandles (`0x000A0000`) |
| `0x1082a0` | `0x10f28c` | | SecureInfoGetRegion de `cfg:u` (`0x00020000`) |
| `0x1082c4` | `0x1088fc` | `APT:U` | GetSharedFont (`0x00440000`) |
| `0x108318` | `0x10d6f8` | `gsp::Gpu` | AcquireRight (`0x00160042`), RegisterInterruptRelayQueue (`0x00130042`), ReadHWRegs, WriteHWRegs, TriggerCmdReqQueue, SetLcdForceBlack, FlushDataCache. Sur le chemin suivi par le [contrat de `gsp::Gpu`](contrat-gsp.md) (partie 2) : AcquireRight, RegisterInterruptRelayQueue, les 68 écritures de registres seulement si la réponse vaut `0x2A07`, des commandes de file avec TriggerCmdReqQueue, puis SetLcdForceBlack(0). ReadHWRegs et FlushDataCache sont sous cette fonction mais pas sur ce chemin |
| `0x10833c` | `0x10cd5c` | `dsp::DSP` | LoadComponent (`0x001100C2`), RegisterInterruptEvents, GetSemaphoreEventHandle, SetSemaphoreMask, WriteProcessPipe, SetSemaphore, ReadPipeIfPossible (deux fois), ConvertProcessAddressFromDspDram (trente fois), SetSemaphore : l'ordre exact, obtenu en exécutant ces fonctions ([contrat de `dsp::DSP`](contrat-dsp.md), partie 2) |
| `0x1083c8` | `0x10cad8` | | GenHashConsoleUnique de `cfg:u` (`0x00030040`) |
| `0x108400` | `0x10a9a8` | | OpenFileDirectly |
| `0x108450`, `0x10845c` | `0x10c710`, `0x12c34c` | `frd:u` | SetClientSdkVersion (`0x00320042`), GetMyPresence, GetFriendKeyList, GetFriendAttributeFlags |
| `0x1084b8` | `0x10bda0` | `ndm:u` | (déjà ouvert à l'étape 1) |
| `0x108598` | `0x10c0ac` | `boss:U` | InitializeSession (`0x00010082`) à l'ouverture, par `0x10f9f4` puis `boss_open_user_session` ; ResumeDaemons et SuspendDaemons de `ndm:u` ; GetStorageEntryInfo, UnregisterStorage, RegisterStorageEntry de `boss` |
| `0x1086fc` | `0x10a518` | `ldr:ro` | Initialize (`0x000100C2`), LoadCRR (`0x00020082`), envoyées par `ro_manager_initialize` |

Deux remarques. Chaque commande de `boss` existe en double : la fonction essaie la session privilégiée, qui n'est jamais ouverte (partie 3), puis celle de `boss:U`. Et la dernière ligne est celle qui compte pour les `.cro` : le jeu donne `static.crs` puis `.crr/static.crr` au module `ro` avant de charger le moindre module.

### Étape 4 : les derniers préparatifs, puis la boucle

Après `game_init_systems`, `main` appelle encore, dans l'ordre :

| Appel à | Vers | Envois trouvés en dessous |
| --- | --- | --- |
| `0x1061cc` | `0x10dc1c` | GetConfigInfoBlk2, SecureInfoGetRegion (`cfg:u`) |
| `0x106204` | `0x106ae8` | GenHashConsoleUnique, GetConfigInfoBlk2, GetRegionCanadaUSA (`cfg:u`), GetMyFriendKey (`frd:u`), GetStepHistory (`ptm:u`) |
| `0x10626c` | `0x107520` | OpenFileDirectly (`fs:USER`) |
| `0x106284` | `main_loop` (`0x1066ec`) | la boucle |

`main_loop` (`0x1066ec`) est **la boucle principale**. Son début de tour est à `0x106710` : deux branches y reviennent (`0x1068b4` et `0x1068f0`), et elle en sort notamment quand `0x108b24` rend zéro (`0x10684c`). À chaque tour elle appelle entre autres `0x113fc0` (sous laquelle on trouve le stockage de `boss`), `0x15fae4` et `0x12c1b8` (l'état de `ac:u`), `0x11187c` (TriggerCmdReqQueue et FlushDataCache de `gsp::Gpu` : l'affichage), `0x108b24` (celle dont le résultat arrête la boucle) et `0x110adc` (la mise en veille et le bouton HOME, par `APT:U`). C'est sous cette boucle, par `0x1201dc`, que s'ouvrent `http:C` et `soc:U`.

Les autres guichets (`ac:u`, `ir:USER`, `cecd:u`, `mic:u`, `ssl:C`, `nwm::UDS`, `cam:u`, `y2r:u`, et les sessions HTTP par contexte) ne sont sur **aucun chemin d'appels directs** depuis le point d'entrée : leurs fonctions d'ouverture ne sont atteintes que par une table virtuelle ou par un `.cro`. On ne peut donc pas dire statiquement à quel moment ils s'ouvrent, seulement que ce n'est pas avant la boucle.

### Étape 5 : la sortie

Quand la boucle rend la main, `main` envoie SetThisSaveDataSecureValue (`0x086E00C0`, sous `0x106570`), démonte `rom2:`, `rom:` et l'archive des données, puis finit par l'une de deux fonctions : `0x107200` (PrepareToCloseApplication `0x00220040`, CloseApplication `0x00270044`) ou `0x107360` (PrepareToDoApplicationJump, SetLcdForceBlack, DoApplicationJump : le jeu se relance).

## Partie 5 : les modules `.cro`

### Ils n'envoient rien eux-mêmes

| Ce qu'on cherche dans le code des 133 `.cro` | Trouvé | Remarque |
| --- | --- | --- |
| `svc 0x32` en ARM | 0 | |
| un `svc` quelconque en ARM | 0 | 157 mots ont la forme d'un `svc 0` : ce sont les nombres 0,5 (`0x3F000000`, 151 fois) et −0,5 (`0xBF000000`, 6 fois) |
| `svc 0x32` en Thumb (`DF32`) | 0 | un seul demi-mot `DF32`, dans `DllGift` : c'est la moitié du mot ARM `0xEBFFDF32`, un `bl` |
| lecture du stockage local du fil (`mrc p15, 0, rX, c13, c0, 3`) | 0 | sans elle, impossible d'écrire dans le tampon de commande |

Les modules ne font donc **aucun appel système** et ne touchent jamais au tampon de commande : tout ce qu'ils demandent à la console passe par une fonction du code principal. Pour le portage, c'est la bonne nouvelle de cette fiche : la liste de la partie 3 est complète, les `.cro` n'y ajoutent rien.

### Ce qu'ils prennent au code principal

| | |
| --- | --- |
| Modules qui importent du code principal | 106 sur 133 (les 27 autres sont des modules d'essai : `DllTest…`, `DllDebug…`, `DllFieldDebug`, `DllPokeViewer`) |
| Adresses du code principal importées | 5 076 distinctes : 4 958 dans `.text`, 118 dans les données |
| Corrections à appliquer pour ces imports | 20 826, toutes du même type : écrire l'adresse entière dans un mot (`R_ARM_ABS32`) |
| Fonctions d'envoi importées directement | 3, toutes de `mic:u` (`0x1ef880`, `0x1efa0c`, `0x1efa4c`) |
| Fonctions d'envoi atteintes seulement grâce à ces imports | 58 (colonne « `.cro` » de la partie 3) |

Les imports se font **par adresse**, jamais par nom : un module dit « segment 0 du module `|static|`, plus tant ». Aucun des 133 modules n'a d'import par nom ni par numéro. Sur les 4 958 adresses de `.text`, Ghidra en connaissait 3 875 comme débuts de fonction, et 892 n'étaient connues d'aucun des deux passages : ce sont des fonctions que rien n'appelle dans le code principal, gardées pour les modules. Une fois ces imports donnés comme points de départ au second passage, 4 937 sont des débuts de fonction.

### La forme d'un fichier `.cro`

Lue dans les 134 fichiers (133 `.cro` et `static.crs`, même format, marque `CRO0`) ; les noms des champs suivent 3dbrew. Les décalages et les tailles ont été contrôlés contre la taille de chaque fichier, sans une erreur.

**L'en-tête.**

| Décalage | Contenu | Vérifié |
| --- | --- | --- |
| `0x000` | SHA-256 de l'en-tête (`0x80` à `0x180`) | recalculé, 134 sur 134 |
| `0x020` | SHA-256 du code (le décalage et la taille donnés à `0x0B0`) | 134 sur 134 |
| `0x040` | SHA-256 des tables (du nom du module jusqu'aux données) | 134 sur 134 |
| `0x060` | SHA-256 des données | 134 sur 134 |
| `0x080` | la marque `CRO0` | 134 sur 134 |
| `0x084` | décalage du nom | |
| `0x088`, `0x08C` | module suivant, module précédent : à zéro dans le fichier, remplis par `ro` | |
| `0x090` | taille du fichier | égale à la taille réelle, 134 sur 134 |
| `0x094` | taille du `.bss` | |
| `0x0A0` | où est `nnroControlObject_` (`0xFFFFFFFF` dans `static.crs`) | |
| `0x0A4`, `0x0A8`, `0x0AC` | fonctions à appeler au chargement, au déchargement, sur un symbole manquant | présentes dans 5 modules seulement (`DllGts`, `DllStartMenu`, `DllTownmap`, `DllTradelist`, `DllVSDemo`) |
| `0x0B0`, `0x0B4` | décalage et taille du code | |
| `0x0B8`, `0x0BC` | décalage et taille des données | |
| `0x0C0`, `0x0C4` | décalage et taille du nom du module | |
| `0x0C8` à `0x134` | quatorze couples (décalage, nombre) : une table chacun | voir ci-dessous |

**Les tables**, dans l'ordre de l'en-tête.

| En-tête | Table | Taille d'une case | Contenu d'une case |
| --- | --- | --- | --- |
| `0x0C8` | segments | 12 | décalage dans le fichier, taille, genre (0 `.text`, 1 `.rodata`, 2 `.data`, 3 `.bss`). Six cases dans chaque `.cro` : les quatre sections, puis deux vides. Pas dans `static.crs`, dont les cases 3 et 4 portent des adresses (`0x665000`, taille 0, et `0x4000000`, taille `0x1f4`) : relevé par `outils/cro_loader.py` |
| `0x0D0` | exports par nom | 8 | décalage du nom, adresse étiquetée |
| `0x0D8` | exports par numéro | 4 | adresse étiquetée. Vide partout |
| `0x0E0` | noms des exports | | les chaînes |
| `0x0E8` | arbre de recherche des exports | 8 | l'arbre où `ro` cherche un nom : décrit dans [ro](ro.md), refait par `outils/cro_loader.py`, qui retrouve par lui les 640 exports par nom |
| `0x0F0` | modules dont on importe | 20 | décalage du nom du module, début et nombre de ses imports par numéro, début et nombre de ses imports par adresse |
| `0x0F8` | corrections des imports | 12 | voir plus bas |
| `0x100` | imports par nom | 8 | vide partout |
| `0x108` | imports par numéro | 8 | vide partout |
| `0x110` | imports par adresse | 8 | adresse étiquetée **dans le module visé**, décalage de la première correction |
| `0x118` | noms des modules importés | | les chaînes |
| `0x128` | corrections internes | 12 | ce que le module doit corriger en lui-même une fois placé en mémoire |

Une **adresse étiquetée** tient en 32 bits : les 4 bits du bas donnent le numéro du segment, les 28 du haut le décalage dans ce segment.

Une **correction** (12 octets) : l'adresse étiquetée du mot à corriger, un octet de type (toujours 2 pour les imports), un octet qui marque la dernière correction d'une liste, deux octets, puis une valeur à ajouter. Le premier de ces deux octets (`+6`) n'est pas inutile : le jeu y lit « résolue », dans `ro_Module_IsAllSymbolResolved` (`0x1e7c48`), une vérification qu'aucun appel ne demande ([contrat des petits services](contrat-petits-services.md), partie 6 ; la lecture de l'octet `+6` a été revue dans l'assembleur pour cette fiche). Les corrections d'un même symbole se suivent jusqu'à celle qui porte la marque de fin.

**En chiffres**, sur les 133 modules : de 8 192 à 1 302 528 octets ; 179 exports par nom (tous exportent `nnroControlObject_`, 46 en exportent un second) ; 17 959 imports par adresse depuis le code principal ; 44 151 corrections internes ; 35 modules sont importés par d'autres modules, `DllField` en tête (28 modules s'en servent).

### `static.crs` et `static.crr`

`static.crs` est la fiche d'identité du **code principal** au même format : son nom de module est `|static|`, et sa table de segments ne donne pas des décalages dans le fichier mais les adresses en mémoire (`0x100000`, `0x53f000`, `0x5a9000`, les trois sections de `code.bin`). C'est grâce à elle que « segment 0 de `|static|`, plus `0x5ebd0` » devient `0x15ebd0`.

- Il exporte **461 symboles par nom**, avec leur nom C++ complet (presque tous de la bibliothèque standard, en Thumb). Les 285 adresses distinctes sont reprises dans `pokemon-x.noms.tsv` : c'est la seule table de symboles que le jeu ait gardée.
- Il **importe** 328 adresses de 78 modules (331 corrections) : ce sont des mots du code principal à remplir avec l'adresse d'une fonction d'un module quand il se charge. Le mot `0x19aa88`, par exemple, reçoit l'adresse « segment 0 de `DllBoxSearch`, plus `0x4f98` ». C'est le chemin du code principal vers les modules.

`static.crr` (8 192 octets, marque `CRR0`) contient la liste de ce qui a le droit d'être chargé : à `0x350` le décalage d'une table (`0x360`) et à `0x354` son nombre de cases (`0x85`, soit 133), des empreintes SHA-256 de 32 octets rangées par ordre croissant. Chacune est l'empreinte des `0x80` premiers octets d'un `.cro` (ses quatre empreintes à lui) : les 133 `.cro` y sont, vérifié un par un. Le début du fichier, qui porte la signature, n'a pas été lu.

### Ce que `ro` devra faire

D'après ces tables (une lecture du format, faite avant que `ro` soit dumpé ; le module est lu depuis dans sa [fiche](ro.md), qui confirme ces quatre points et donne le détail de chacun) :

1. **Initialize** (`0x000100C2`) reçoit `static.crs` : retenir les adresses des segments du code principal et ses 461 exports.
2. **LoadCRR** (`0x00020082`) reçoit `static.crr` : retenir les 133 empreintes.
3. **LoadExeCRO** (`0x000402C2`) reçoit un `.cro` déjà lu en mémoire : contrôler ses empreintes, placer ses segments, appliquer ses corrections internes, écrire les adresses de ses imports (code principal et autres modules déjà chargés), puis remplir dans le code principal les mots que `static.crs` réserve à ce module.
4. **UnloadCRO** (`0x000500C2`) défait le tout.

Le jeu n'envoie que ces quatre commandes à `ldr:ro`.

**Deux corrections**, venues de la lecture du jeu autour de ces commandes ([contrat des petits services](contrat-petits-services.md), partie 6). Cette liste disait que `ro` réserve le `.bss` et installe les segments. En fait :

- **ce n'est pas `ro` qui réserve le `.bss`** : le jeu fournit lui-même un second tampon pour `.data` et `.bss` (mots 4 et 7 de LoadExeCRO), et c'est lui qui **met le `.bss` à zéro** après la réponse (`ro_LoadModule`, `0x1e7604`, appelle à `0x1e771c` une fonction de remise à zéro, `0x15ebd0`) ;
- **ce n'est pas `ro` qui installe `.data` dans ce tampon** : le jeu l'y recopie lui-même après la réponse (deux copies, à `0x1e76f8` et `0x1e7710`), en lisant les champs de l'en-tête que `ro` a convertis en adresses.

`ro` doit donc laisser `.data`, une fois corrigé, à sa place dans l'image, et convertir en adresses les décalages de l'en-tête que le jeu lit (`0xB0`, `0xB8`, `0xC8`, `0xF8` au moins). La liste complète des contraintes vues du jeu est à la fin de la partie 6 du contrat.

## Partie 6 : bilan pour le portage

### À implémenter vraiment

Ce sont les services dont une fiche existe : on sait ce que la console fait de chaque commande. Le tableau renvoie à la ligne de la table des commandes dans la fiche du module.

| Service | En-tête | Commande | Fiche | Ligne de la fiche | Fonction du module | Atteinte |
| --- | --- | --- | --- | --- | --- | --- |
| `srv:` | `0x00010002` | RegisterClient | [sm](sm.md) | 43 |  | entrée |
| `srv:` | `0x00020000` | EnableNotification | [sm](sm.md) | 44 | `srv_EnableNotification` | entrée |
| `srv:` | `0x00050100` | GetServiceHandle | [sm](sm.md) | 47 | `srv_GetServiceHandle` | entrée |
| `srv:` | `0x00090040` | Subscribe | [sm](sm.md) | 51 | `srv_Subscribe` | entrée |
| `srv:` | `0x000B0000` | ReceiveNotification | [sm](sm.md) | 53 | `srv_ReceiveNotification` | entrée |
| `APT:U` | `0x00010040` | GetLockHandle | [ns](ns.md) | 98 | `apt_GetLockHandle` | entrée |
| `APT:U` | `0x00020080` | Initialize | [ns](ns.md) | 99 | `apt_Initialize` | entrée |
| `APT:U` | `0x00030040` | Enable | [ns](ns.md) | 100 | `apt_Enable` | entrée |
| `APT:U` | `0x00050040` | GetAppletManInfo | [ns](ns.md) | 102 | `apt_GetAppletManInfo` | entrée |
| `APT:U` | `0x00090040` | IsRegistered | [ns](ns.md) | 106 | `apt_IsRegistered` | entrée |
| `APT:U` | `0x000B0040` | InquireNotification | [ns](ns.md) | 108 | `apt_InquireNotification` | entrée |
| `APT:U` | `0x000C0104` | SendParameter | [ns](ns.md) | 109 | `apt_SendParameter` | entrée |
| `APT:U` | `0x000D0080` | ReceiveParameter | [ns](ns.md) | 110 | `apt_ReceiveParameter` | entrée |
| `APT:U` | `0x000E0080` | GlanceParameter | [ns](ns.md) | 111 | `apt_GlanceParameter` | entrée |
| `APT:U` | `0x000F0100` | CancelParameter | [ns](ns.md) | 112 | `apt_CancelParameter` | entrée |
| `APT:U` | `0x00180040` | PrepareToStartLibraryApplet | [ns](ns.md) | 121 | `apt_PrepareToStartLibraryApplet` | entrée |
| `APT:U` | `0x00190040` | PrepareToStartSystemApplet | [ns](ns.md) | 122 | `apt_PrepareToStartSystemApplet` | entrée |
| `APT:U` | `0x001E0084` | StartLibraryApplet | [ns](ns.md) | 127 | `apt_StartLibraryApplet` | entrée |
| `APT:U` | `0x001F0084` | StartSystemApplet | [ns](ns.md) | 128 | `apt_StartSystemApplet` | entrée |
| `APT:U` | `0x00220040` | PrepareToCloseApplication | [ns](ns.md) | 131 | `apt_PrepareToCloseApplication` | entrée |
| `APT:U` | `0x00270044` | CloseApplication | [ns](ns.md) | 136 | `apt_CloseApplication` | entrée |
| `APT:U` | `0x002B0000` | PrepareToJumpToHomeMenu | [ns](ns.md) | 140 | `apt_PrepareToJumpToHomeMenu` | entrée |
| `APT:U` | `0x002C0044` | JumpToHomeMenu | [ns](ns.md) | 141 | `apt_JumpToHomeMenu` | entrée |
| `APT:U` | `0x00310100` | PrepareToDoApplicationJump | [ns](ns.md) | 146 | `apt_PrepareToDoApplicationJump` | entrée |
| `APT:U` | `0x00320084` | DoApplicationJump | [ns](ns.md) | 147 | `apt_DoApplicationJump` | entrée |
| `APT:U` | `0x003B0040` | CancelLibraryApplet | [ns](ns.md) | 156 | `apt_CancelLibraryApplet` | entrée |
| `APT:U` | `0x003E0080` | ReplySleepQuery | [ns](ns.md) | 159 | `apt_ReplySleepQuery` | entrée |
| `APT:U` | `0x003F0040` | ReplySleepNotificationComplete | [ns](ns.md) | 160 | `apt_ReplySleepNotificationComplete` | entrée |
| `APT:U` | `0x00400042` | SendCaptureBufferInfo | [ns](ns.md) | 161 | `apt_SendCaptureBufferInfo` | entrée |
| `APT:U` | `0x00420080` | SleepSystem | [ns](ns.md) | 163 | `apt_SleepSystem` | entrée |
| `APT:U` | `0x00430040` | NotifyToWait | [ns](ns.md) | 164 |  | entrée |
| `APT:U` | `0x00440000` | GetSharedFont | [ns](ns.md) | 165 | `apt_GetSharedFont` | entrée |
| `APT:U` | `0x004B00C2` | AppletUtility | [ns](ns.md) | 172 | `apt_AppletUtility` | entrée |
| `APT:U` | `0x004D0080` | GetAppletProgramInfo | [ns](ns.md) | 174 | `apt_GetAppletProgramInfo` | .cro |
| `fs:USER` | `0x080201C2` | OpenFile | [fs](fs.md) | 99 | `fsuser_OpenFile` | entrée |
| `fs:USER` | `0x08030204` | OpenFileDirectly | [fs](fs.md) | 100 | `fsuser_OpenFileDirectly` | entrée |
| `fs:USER` | `0x08040142` | DeleteFile | [fs](fs.md) | 101 | `fsuser_DeleteFile` | entrée |
| `fs:USER` | `0x08050244` | RenameFile | [fs](fs.md) | 102 | `fsuser_RenameFile` | entrée |
| `fs:USER` | `0x08060142` | DeleteDirectory | [fs](fs.md) | 103 | `fsuser_DeleteDirectory` | entrée |
| `fs:USER` | `0x08070142` | DeleteDirectoryRecursively | [fs](fs.md) | 104 | `fsuser_DeleteDirectoryRecursively` | entrée |
| `fs:USER` | `0x08080202` | CreateFile | [fs](fs.md) | 105 | `fsuser_CreateFile` | entrée |
| `fs:USER` | `0x08090182` | CreateDirectory | [fs](fs.md) | 106 | `fsuser_CreateDirectory` | entrée |
| `fs:USER` | `0x080A0244` | RenameDirectory | [fs](fs.md) | 107 | `fsuser_RenameDirectory` | entrée |
| `fs:USER` | `0x080B0102` | OpenDirectory | [fs](fs.md) | 108 | `fsuser_OpenDirectory` | entrée |
| `fs:USER` | `0x080C00C2` | OpenArchive | [fs](fs.md) | 109 | `fsuser_OpenArchive` | entrée |
| `fs:USER` | `0x080D0144` | ControlArchive | [fs](fs.md) | 110 | `fsuser_ControlArchive` | entrée |
| `fs:USER` | `0x080E0080` | CloseArchive | [fs](fs.md) | 111 | `fsuser_CloseArchive` | entrée |
| `fs:USER` | `0x08120080` | GetFreeBytes | [fs](fs.md) | 115 | `fsuser_GetFreeBytes` | entrée |
| `fs:USER` | `0x08170000` | IsSdmcDetected | [fs](fs.md) | 120 | `fsuser_IsSdmcDetected` | entrée |
| `fs:USER` | `0x08180000` | IsSdmcWritable | [fs](fs.md) | 121 | `fsuser_IsSdmcWritable` | .cro |
| `fs:USER` | `0x084500C2` | GetFormatInfo | [fs](fs.md) | 166 | `fsuser_GetFormatInfo` | entrée |
| `fs:USER` | `0x08490040` | GetArchiveResource | [fs](fs.md) | 170 | `fsuser_GetArchiveResource` | entrée |
| `fs:USER` | `0x084C0242` | FormatSaveData | [fs](fs.md) | 173 | `fsuser_FormatSaveData` | entrée |
| `fs:USER` | `0x08510242` | CreateExtSaveData | [fs](fs.md) | 178 | `fsuser_CreateExtSaveData` | entrée |
| `fs:USER` | `0x08520100` | DeleteExtSaveData | [fs](fs.md) | 179 | `fsuser_DeleteExtSaveData` | entrée |
| `fs:USER` | `0x08540100` | GetExtDataBlockSize | [fs](fs.md) | 181 | `fsuser_GetExtDataBlockSize` | entrée |
| `fs:USER` | `0x085A00C0` | SetArchivePriority | [fs](fs.md) | 187 | `fsuser_SetArchivePriority` | entrée |
| `fs:USER` | `0x085B0080` | GetArchivePriority | [fs](fs.md) | 188 | `fsuser_GetArchivePriority` | entrée |
| `fs:USER` | `0x08610042` | InitializeWithSdkVersion | [fs](fs.md) | 194 | `fsuser_Initialize` | entrée |
| `fs:USER` | `0x08620040` | SetPriority | [fs](fs.md) | 195 | `session_SetPriority` | entrée |
| `fs:USER` | `0x08630000` | GetPriority | [fs](fs.md) | 196 | `session_GetPriority` | entrée |
| `fs:USER` | `0x086E00C0` | SetThisSaveDataSecureValue | [fs](fs.md) | 207 | `fsuser_SetThisSaveDataSecureValue` | entrée |
| `fs:USER` | `0x086F0040` | GetThisSaveDataSecureValue | [fs](fs.md) | 208 | `fsuser_GetThisSaveDataSecureValue` | entrée |
| `FSFile` | `0x08010100` | OpenSubFile | [fs](fs.md) | 270 | `fsfile_OpenSubFile` | entrée |
| `FSFile` | `0x080200C2` | Read | [fs](fs.md) | 271 | `fsfile_Read` | entrée |
| `FSFile` | `0x08030102` | Write | [fs](fs.md) | 272 | `fsfile_Write` | entrée |
| `FSFile` | `0x08040000` | GetSize | [fs](fs.md) | 273 | `fsfile_GetSize` | entrée |
| `FSFile` | `0x08050080` | SetSize | [fs](fs.md) | 274 | `fsfile_SetSize` | entrée |
| `FSFile` | `0x08080000` | Close | [fs](fs.md) | 277 | `fsfile_Close` | entrée |
| `FSFile` | `0x080A0040` | SetPriority | [fs](fs.md) | 279 | `session_SetPriority` | entrée |
| `FSFile` | `0x080B0000` | GetPriority | [fs](fs.md) | 280 | `session_GetPriority` | entrée |
| `FSFile` | `0x080C0000` | OpenLinkFile | [fs](fs.md) | 281 | `fsfile_OpenLinkFile` | entrée |
| `FSFile` | `0x0C010100` | GetAvailable | [fs](fs.md) | 282 | `fsfile_GetAvailable` | entrée |
| `FSDir` | `0x08010042` | Read | [fs](fs.md) | 290 | `fsdir_Read` | entrée |
| `FSDir` | `0x08020000` | Close | [fs](fs.md) | 291 | `fsdir_Close` | entrée |
| `FSDir` | `0x08030040` | SetPriority | [fs](fs.md) | 292 | `session_SetPriority` | entrée |
| `FSDir` | `0x08040000` | GetPriority | [fs](fs.md) | 293 | `session_GetPriority` | entrée |
| `gsp::Gpu` | `0x00010082` | WriteHWRegs | [gsp](gsp.md) | 106 | `write_hw_regs` | entrée |
| `gsp::Gpu` | `0x00020084` | WriteHWRegsWithMask | [gsp](gsp.md) | 107 | `gspgpu_WriteHWRegsWithMask` | entrée |
| `gsp::Gpu` | `0x00040080` | ReadHWRegs | [gsp](gsp.md) | 109 | `read_hw_regs` | entrée |
| `gsp::Gpu` | `0x00080082` | FlushDataCache | [gsp](gsp.md) | 113 | `gspgpu_FlushDataCache` | entrée |
| `gsp::Gpu` | `0x000B0040` | SetLcdForceBlack | [gsp](gsp.md) | 116 | `gspgpu_SetLcdForceBlack` | entrée |
| `gsp::Gpu` | `0x000C0000` | TriggerCmdReqQueue | [gsp](gsp.md) | 117 | `gspgpu_TriggerCmdReqQueue` | entrée |
| `gsp::Gpu` | `0x00100040` | SetAxiConfigQoSMode | [gsp](gsp.md) | 121 | `gspgpu_SetAxiConfigQoSMode` | .cro |
| `gsp::Gpu` | `0x00130042` | RegisterInterruptRelayQueue | [gsp](gsp.md) | 124 | `gspgpu_RegisterInterruptRelayQueue` | entrée |
| `gsp::Gpu` | `0x00140000` | UnregisterInterruptRelayQueue | [gsp](gsp.md) | 125 | `gspgpu_UnregisterInterruptRelayQueue` | entrée |
| `gsp::Gpu` | `0x00160042` | AcquireRight | [gsp](gsp.md) | 127 | `gspgpu_AcquireRight` | entrée |
| `gsp::Gpu` | `0x00170000` | ReleaseRight | [gsp](gsp.md) | 128 | `gspgpu_ReleaseRight` | entrée |
| `gsp::Gpu` | `0x00180000` | ImportDisplayCaptureInfo | [gsp](gsp.md) | 129 | `gspgpu_ImportDisplayCaptureInfo` | entrée |
| `gsp::Gpu` | `0x00190000` | SaveVramSysArea | [gsp](gsp.md) | 130 | `gspgpu_SaveVramSysArea` | entrée |
| `gsp::Gpu` | `0x001A0000` | RestoreVramSysArea | [gsp](gsp.md) | 131 | `gspgpu_RestoreVramSysArea` | entrée |
| `hid:USER` | `0x000A0000` | GetIPCHandles | [hid](hid.md) | 103 | `hid_GetIPCHandles` | entrée |
| `hid:USER` | `0x00110000` | EnableAccelerometer | [hid](hid.md) | 110 | `hid_EnableAccelerometer` | entrée |
| `hid:USER` | `0x00120000` | DisableAccelerometer | [hid](hid.md) | 111 | `hid_DisableAccelerometer` | entrée |
| `hid:USER` | `0x00130000` | EnableGyroscopeLow | [hid](hid.md) | 112 | `hid_EnableGyroscopeLow` | entrée |
| `hid:USER` | `0x00140000` | DisableGyroscopeLow | [hid](hid.md) | 113 | `hid_DisableGyroscopeLow` | entrée |
| `hid:USER` | `0x00150000` | GetGyroscopeLowRawToDpsCoefficient | [hid](hid.md) | 114 |  | entrée |
| `hid:USER` | `0x00160000` | GetGyroscopeLowCalibrateParam | [hid](hid.md) | 115 | `hid_GetGyroscopeLowCalibrateParam` | entrée |
| `dsp::DSP` | `0x00010040` | RecvData | [dsp](dsp.md) | 100 | `dsp_RecvData` | entrée |
| `dsp::DSP` | `0x00020040` | RecvDataIsReady | [dsp](dsp.md) | 101 | `dsp_RecvDataIsReady` | entrée |
| `dsp::DSP` | `0x00070040` | SetSemaphore | [dsp](dsp.md) | 106 | `dsp_SetSemaphore` | entrée |
| `dsp::DSP` | `0x000C0040` | ConvertProcessAddressFromDspDram | [dsp](dsp.md) | 111 | `dsp_ConvertProcessAddressFromDspDram` | entrée |
| `dsp::DSP` | `0x000D0082` | WriteProcessPipe | [dsp](dsp.md) | 112 | `dsp_WriteProcessPipe` | entrée |
| `dsp::DSP` | `0x001000C0` | ReadPipeIfPossible | [dsp](dsp.md) | 115 |  | entrée |
| `dsp::DSP` | `0x001100C2` | LoadComponent | [dsp](dsp.md) | 116 | `dsp_LoadComponent` | entrée |
| `dsp::DSP` | `0x00120000` | UnloadComponent | [dsp](dsp.md) | 117 | `dsp_UnloadComponent` | entrée |
| `dsp::DSP` | `0x00130082` | FlushDataCache | [dsp](dsp.md) | 118 | `dsp_FlushDataCache` | entrée |
| `dsp::DSP` | `0x00140082` | InvalidateDCache | [dsp](dsp.md) | 119 | `dsp_InvalidateDCache` | entrée |
| `dsp::DSP` | `0x00150082` | RegisterInterruptEvents | [dsp](dsp.md) | 120 | `dsp_RegisterInterruptEvents` | entrée |
| `dsp::DSP` | `0x00160000` | GetSemaphoreEventHandle | [dsp](dsp.md) | 121 | `dsp_GetSemaphoreEventHandle` | entrée |
| `dsp::DSP` | `0x00170040` | SetSemaphoreMask | [dsp](dsp.md) | 122 | `dsp_SetSemaphoreMask` | entrée |
| `cfg:u` | `0x00010082` | GetConfigInfoBlk2 | [cfg](cfg.md) | 84 | `config_get_block_locked` (`0x105fc4`) | entrée |
| `cfg:u` | `0x00020000` | SecureInfoGetRegion | [cfg](cfg.md) | 85 | `secure_info_get_region_locked` (`0x104e58`) | entrée |
| `cfg:u` | `0x00030040` | GenHashConsoleUnique | [cfg](cfg.md) | 86 | `gen_hash_console_unique` (`0x105eac`) | entrée |
| `cfg:u` | `0x00040000` | GetRegionCanadaUSA | [cfg](cfg.md) | 87 | `get_region_canada_usa` (`0x1043ac`) | entrée |
| `ptm:u` | `0x000B00C2` | GetStepHistory | [ptm](ptm.md) | 130 | `ptm_GetStepHistory` | entrée |

La ligne de GetExtDataBlockSize (`0x08540100`) n'avait pas de correspondant dans la fiche `fs`, qui donnait comme la Carte l'en-tête `0x08540010`. L'écart est tranché ([contrat des fichiers](contrat-fs.md), partie 6) : l'aiguillage de `fs` ne compare que le numéro `0x0854`, les deux en-têtes passent, et `0x08540100`, que le jeu écrit (`0x1e2e38`), est la forme juste ; `0x08540010` est une coquille de 3dbrew. La fiche `fs` est corrigée, la Carte reste à corriger.

Les lignes `FSFile` et `FSDir` renvoient à la partie 5 de la fiche `fs` (les commandes d'un fichier et d'un dossier ouverts). Reste le port `err:f` (fiche [errdisp](errdisp.md), ajoutée le 16/10), où le jeu n'envoie que Throw (`0x00010800`) pour afficher une erreur fatale.

### Une réponse factice suffira sans doute

| Service | Module | Fonctions | Pourquoi une réponse simple devrait suffire |
| --- | --- | --- | --- |
| `ndm:u` | ndm | 9 | suspendre et relancer les tâches réseau de fond : répondre « fait » |
| `ac:u` | ac | 15 | l'état de la connexion : répondre « pas connecté » |
| `frd:u` | friends | 22 | la liste d'amis : une liste vide. Quatre commandes partent dès le démarrage (étape 3) |
| `boss:U` | boss | 28 | SpotPass : aucun contenu en attente |
| `cecd:u` | cecd | 16 | StreetPass : boîte vide |
| `http:C`, `ssl:C`, `soc:U` | http, ssl, socket | 24, 3, 20 | le jeu en ligne : refuser la connexion |
| `nwm::UDS` | nwm | 22 | le jeu en local sans fil : aucun voisin |
| `ir:USER` | ir | 13 | l'infrarouge : aucun appareil |
| `mic:u` | mic | 10 | le micro : silence. Utilisé par `DllKawaigari` (la Poké Récré) |
| `cam:u`, `y2r:u` | camera | 36, 22 | l'appareil photo : image noire. Presque tout n'est atteint que par les `.cro` |
| `ptm:u` | ptm | 1 | GetStepHistory, l'historique du podomètre : des zéros, écrits dans le tampon (il n'est pas initialisé par le jeu). La fiche `ptm` existe si on veut mieux |

« Sans doute » : ce que le jeu fait d'une réponse vide n'a pas été lu. `frd:u` et `ndm:u` sont les deux à surveiller, parce qu'ils sont appelés avant la boucle principale.

### Jamais envoyées

47 fonctions visent une session que rien n'ouvre (`boss:P ?`, `cecd:s ?`, `soc:P ?`). Elles n'ont pas besoin de réponse tant qu'aucun `.cro` ne remplit ces cases, ce qu'il ne pourrait faire qu'en important leur adresse : aucune des 118 adresses de données importées ne tombe dans ces objets. (Deux variables de poignée sont bien importées par des `.cro`, celles de `cam:u` à `0x5d3dbc` et de `y2r:u` à `0x5d42f4` : les modules peuvent les lire, pas s'en servir pour un appel système.)

### Les modules qui manquent de fiche

| Module | Services que le jeu ouvre | État |
| --- | --- | --- |
| `ro` | `ldr:ro` | **fait** : [fiche `ro`](ro.md) (9 commandes, les relocations en formules). Sur PC, `outils/cro_loader.py` le remplace : les 133 modules se lient sans import manquant, et le résultat est identique, octet pour octet, à celui du code de `ro` exécuté sur cinq modules |
| `errdisp` | `err:f` | extrait de la NAND (`local/extrait/errdisp/`, applet `0004003000008A02`, par `outils/nand.py`), fiche [errdisp](errdisp.md) depuis le 16/10 ; un écran d'erreur à afficher |
| `ndm`, `ac`, `ir`, `mic`, `camera` | voir le tableau précédent | extraits de la NAND (`outils/nand.py`) ; une fiche chacun depuis le 16/10 (`ndm.md`, `ac.md`, `ir.md`, `mic.md`, `camera.md`), avec ce que le jeu envoie et ce qu'il faut rendre ; réponses encore factices dans le banc |
| `friends`, `cecd`, `http`, `ssl`, `socket` | voir le tableau précédent | extraits de la NAND (`outils/nand.py`) ; une fiche chacun depuis le 16/10, avec ce que le jeu envoie et ce qu'il faut rendre ; réponses encore factices dans le banc |
| `boss` | voir le tableau précédent | extrait de la NAND (`outils/nand.py`) ; fiche `boss.md` depuis le 16/10 ; réponses factices |
| `nwm` | `nwm::UDS` | extrait (`local/extrait/nwm`) ; fiche `nwm.md` depuis le 16/10, avec la réponse minimale de chaque commande et ce qu'une émulation sur le réseau du PC devrait faire |

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Le nombre d'envois : 408 mots `EF000032` dans `.text`, et 408 fonctions dont le suivi des registres trouve un en-tête constant. Aucun `DF32`.
- Les débuts de fonction : Ghidra et le second passage ont été faits séparément. Sur les 408 fonctions d'envoi, Ghidra en connaît 356 comme fonctions ; les 52 autres, il les a fondues dans leur unique appelant parce qu'on y entre par un saut de fin de fonction.
- Le nombre d'appelants de chaque fonction d'envoi : compté par le second passage et par les références de Ghidra, il est le même pour 404 des 408. Les quatre écarts (`0x1239f0`, `0x2c8eac`, `0x2caf28`, `0x2b30c4`) sont des appels situés dans du code que Ghidra n'a pas désassemblé.
- Les noms demandés : 27 appels, 23 noms, et le compte des 37 chaînes tombe juste (23 + 2 + 12).
- Les variables de poignée : pour chacune, la liste des écritures relevées par Ghidra a été relue. En dehors de l'ouverture, de la fermeture et de la mise à zéro du démarrage, les seules écritures sont les copies citées dans les notes (et le repli de `cfg:u` vers `cfg:s` et `cfg:i`).
- Les 300 attributions « directe » et « copie », et les 6 « port ».
- Les `.cro` : les quatre empreintes de chaque fichier recalculées, les 133 empreintes de `static.crr` retrouvées, aucun décalage hors du fichier.
- L'absence d'appel système dans les `.cro` : recherche d'octets, sans désassemblage.
- Les paramètres et les réponses des commandes des services du cœur (`srv:`, `APT:U`, `fs:USER` et ses fichiers et dossiers, `gsp::Gpu`, `hid:USER`, `dsp::DSP`, `cfg:u`, `ptm:u`) : lus côté jeu et côté module dans les cinq contrats. `err:f` et `ldr:ro` ne le sont que côté jeu.
- L'ordre sous `apt_enable_and_wait` (Enable, NotifyToWait, GlanceParameter, ReceiveParameter, AppletUtility 7 puis 4) : le contrat APT, et l'assembleur du jeu relu pour cette fiche (`0x1073ac`, `0x1256f0`, `0x11b074`).
- Le repli de `cfg:u` vers `cfg:s` et `cfg:i` n'a lieu que sur une console de développement : le test du bit 0 de `0x1FF80014` relu dans l'assembleur à `0x10ef6c`, et les deux seuls appelants de `cfg_init_any`.
- GetExtDataBlockSize : l'aiguillage de `fs` ne regarde que le numéro (contrat des fichiers, et table d'`emulate_dispatch.py`).

**Interprété à la lecture, à relire dans Ghidra**
- Les 55 attributions « objet » : archives et fichiers de `fs` par leur table virtuelle, sessions HTTP par contexte, réserve de sessions de `soc:U`. Le lien est lu dans le code des fabriques, pas refermé par l'outil.
- Les noms `boss:P`, `cecd:s` et `soc:P` donnés aux trois sessions jamais ouvertes.
- « Atteinte depuis le point d'entrée » est une borne haute (toute fonction désignée par une table de données est comptée) ; « atteinte par un `.cro` » suppose que le module appelle bien la fonction qu'il importe.
- L'ordre des envois à l'intérieur de `game_init_systems` : ordre des adresses, avec des tests non suivis un par un. Les contrats l'ont refait service par service pour `fs`, `gsp` et `dsp` (étape 3), en lisant les fonctions dans l'ordre d'exécution ; l'ordre entre services reste celui des adresses.
- Le rôle des fonctions appelées par la boucle principale, donné d'après les commandes trouvées en dessous.
- La partie « ce que `ro` devra faire », déduite du format des fichiers, et corrigée sur deux points par la lecture du jeu (`.bss` et `.data`, partie 5). Ce que fait `ro` lui-même n'est pas lu.
- Les noms des commandes : ils viennent de la Carte. Pour 17 lignes le nom est repris d'un service voisin ou d'un en-tête légèrement différent, et le `.tsv` le dit ; 2 lignes n'ont pas de nom.

**Pas lu**
- Ce que le jeu met dans les paramètres de chaque commande, et ce qu'il fait des réponses, pour les services qui ne sont pas dans les contrats : le réseau et les accessoires (`ndm:u`, `ac:u`, `frd:u`, `boss:U`, `cecd:u`, `http:C`, `ssl:C`, `soc:U`, `nwm::UDS`, `ir:USER`, `mic:u`, `cam:u`, `y2r:u`). Seuls leurs en-têtes sont relevés.
- Les quatre premières fonctions appelées par `entry`, dont celle en Thumb.
- Le code Thumb en général (487 fonctions) : aucune n'envoie de commande ni n'appelle une fonction d'envoi, c'est tout ce qui a été vérifié.
- Le code des `.cro` lui-même : seuls leurs en-têtes, leurs tables et la recherche d'appels système.
- Deux commandes d'`ir:USER` (`0x00110040`, `0x00160000`) que la Carte ne connaît pas.
- L'arbre de recherche des exports d'un `.cro`, et le début signé de `static.crr`.
- Les autres appels système du jeu (mémoire, fils, événements) : 228 `svcCloseHandle`, 66 `svcGetSystemTick`, 51 `svcWaitSynchronization1` et une trentaine d'autres numéros, relevés mais pas étudiés.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Compter les `svc` dans `.text` | un script, par motif d'octets | immédiat |
| Analyser le code entier | `outils/ghidra_direct.py maj`, Ghidra sous Ubuntu | 10 minutes, pseudo-code de toutes les fonctions compris ; fait deux fois, sans les noms puis avec |
| Second passage indépendant : débuts de fonction, appels, sauts | un script Python (parcours du code ARM depuis le point d'entrée, les pointeurs et les imports des `.cro`) | quelques secondes |
| Suivre les registres jusqu'à chaque `svc` et jusqu'à chaque GetServiceHandle | un petit interpréteur d'instructions ARM, le long d'un chemin réel de la fonction | quelques secondes |
| Remonter les poignées passées en paramètre chez les appelants | le même, sur cinq étages au plus | compris |
| Relire les écritures de chaque variable de poignée | les références de Ghidra (`refs.tsv`) | à la main |
| Lire les `.cro` | un lecteur du format écrit pour l'occasion | quelques secondes |
| Nommer les commandes | la Carte des services | automatique |
| Suivre le démarrage, rédiger, recouper | Claude | le reste |

Les scripts sont dans `local/analyse/maj/scripts/` (non versionné, comme le pseudo-code), numérotés dans l'ordre où ils se lancent ; `step6_build.py` écrit le `.tsv`, `step12_outputs.py` le fichier de noms.

**Les pièges rencontrés.** Ils valent pour tout gros programme, pas pour les petits modules de la console.

- **Un en-tête de commande ressemble à une adresse.** `.text` va de `0x00100000` à `0x0053ED4C` : les en-têtes des commandes `0x10` à `0x53` (`0x00160000`, `0x002B0080`…) tombent dedans. Chercher « les mots qui pointent vers du code » ramène donc de fausses fonctions, posées au milieu des vraies. Il a fallu n'accepter un pointeur que s'il tombe sur un `push {…, lr}`, juste après un retour, ou sur une fonction de Ghidra.
- **Une table de saut sans son `cmp`.** À `0x108174`, le compilateur a glissé une instruction entre le `cmp` et le `ldrlo pc, [pc, r0, lsl #2]`. Le repérage des tables de saut de `prescan.py` et de `ghidra_direct.py` veut les deux collés : il a manqué la table, et ses cases ont été prises pour des fonctions. La moitié de `game_init_systems` s'est retrouvée détachée, sans appelant, et quatre services semblaient ne s'ouvrir nulle part. Ghidra, lui, avait vu juste.
- **`bl` vers l'instruction suivante.** À `0x117c08` : c'est ce que l'éditeur de liens laisse pour un appel à une fonction facultative que personne ne fournit. Ce n'est pas un appel, et sa cible n'est pas une fonction.
- **Des sauts qui sortent de leur fonction.** Un `b` ne vise pas toujours la fonction où il se trouve. Certains tombent sur une fonction minuscule que rien n'appelle (`ldr r0, =objet` puis `b méthode`, comme `0x119e30` devant l'ouverture de `boss:U`) ; 227 autres atterrissent au milieu d'une fonction, l'éditeur de liens ayant fusionné des fins identiques. `0x10eed4` saute ainsi sur la dernière instruction de `0x117984` pour arriver à l'ouverture de `ldr:ro`. Tant que ces sauts étaient pris pour des sauts internes, Initialize de `ldr:ro` passait pour du code mort.
- **Ghidra fond une fonction dans son appelant** quand on n'y entre que par un saut : 52 fonctions d'envoi n'apparaissent pas dans `funcs.tsv`. La liste des fonctions de Ghidra ne suffit pas à compter les envois.

**Pour reprendre.** `python outils/ghidra_direct.py maj` relance l'analyse et pose les noms de `pokemon-x.noms.tsv` (le dossier s'appelle `maj`, le fichier de noms `pokemon-x` : c'est la seule chose changée dans l'outil). Il annonce « une à trois minutes » ; sur ce programme il en faut dix, avec la mémoire par défaut. Au second passage il a posé les 748 noms et créé 64 fonctions que l'analyse seule n'avait pas, dont les fonctions d'envoi fondues dans leur appelant. Le résultat est dans `local/analyse/maj/gh/` ; celui du premier passage, sans les noms, qui a servi aux recoupements de cette fiche, est gardé dans `local/analyse/maj/gh_sans_noms/`. La suite logique est de dumper le module `ro`, puis de regarder le jeu tourner pour savoir lesquelles de ces 408 commandes partent vraiment.
