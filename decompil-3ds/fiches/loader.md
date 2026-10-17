# loader, celui qui charge les programmes

`loader` met un programme en mémoire. Quand `pm` veut lancer un titre, il demande à `loader` : celui-ci va chercher la fiche technique du titre (l'exheader), lit son fichier de code, le décompresse, et demande au noyau de fabriquer le processus. Il ne démarre rien lui-même : il rend à `pm` une poignée vers un processus prêt, encore à l'arrêt.

Fiche du 13 octobre 2026, produite avec REA et Ghidra sur le module extrait du FIRM de la console. Les adresses sont celles du module chargé à `0x14000000` (et non `0x00100000` comme les autres modules).

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001302`, rangé dans le NATIVE_FIRM (lu dans l'exheader) |
| Fichier lu | `local/extrait/loader/exefs/code.elf` |
| Taille | 14 488 octets de code, 868 de données en lecture seule, 832 de données, 4 356 de mémoire à zéro |
| Fonctions | 134, dont 92 nommées dans `loader.noms.tsv` |
| Service offert | `Loader` (4 commandes, une seule session à la fois) |
| Services appelés | `fs:LDR`, `fs:REG`, `PxiPM`, plus `srv:` |
| Service autorisé par l'exheader | `fs:LDR` seulement. Les deux autres passent quand même : `sm` ne contrôle pas les modules système (voir la fiche `sm`, partie 4) |
| Fils | un seul |
| Sur cette console | Luma remplace `loader` par le sien au démarrage : ce qui est lu ici est l'original de Nintendo |

## Partie 1 : le démarrage

`entry` (`0x14000000`) appelle six fonctions à la suite, puis saute dans `svcExitProcess` (`0x14001d5c`) :

1. `clear_bss` (`0x14000024`) met à zéro la mémoire de `0x14005340` à `0x14006444`.
2. `init_c_locale` (`0x14000414`) prépare les tables de caractères de la bibliothèque C.
3. `init_runtime_and_srv` (`0x14001984`) appelle `init_runtime` (`0x14000a08`, les verrous et les réserves d'adresses), puis continue directement dans `srv_init` (`0x14001994`), qui se connecte au port `srv:` et s'y déclare (`SRV_RegisterClient`). Si la connexion échoue avec un code d'erreur précis (sans doute « ce port n'existe pas encore »), elle attend 500 000 nanosecondes et recommence.
4. La fonction à `0x1400384c`, écrite en Thumb, appelle les 10 fonctions d'initialisation des objets globaux, par la table de `0x14003870` à `0x14003898`. L'une d'elles, `init_memory_pools` (`0x140035c0`), prépare trois petites réserves de blocs, dont celle des objets « fichier » (partie 5).
5. `run_init_array` (`0x140003e0`) parcourt une seconde table, vide ici.
6. `loader_main` (`0x14000054`, 860 octets) : tout le reste.

## Partie 2 : la boucle de service

`loader_main` fait la mise en place, puis tourne dans une boucle unique, comme `sm`.

**La mise en place :**

1. **Le service.** `SRV_RegisterService` (`0x14000738`) demande à `sm` de créer le service `Loader`, avec une session au plus. Le nom, le nombre de sessions et l'adresse du gestionnaire viennent d'une petite fiche à `0x14004028`.
2. **Le système de fichiers.** `fs_init` (`0x140004a4`) ouvre `fs:LDR`, s'y présente (`FS_InitializeWithSdkVersion`, avec la version `0x0B0502C8`) et règle sa priorité à 0 (`FS_SetPriority`).
3. **Les deux autres services.** `open_pxipm_and_fsreg` (`0x14000540`) ouvre `PxiPM` puis `fs:REG`, et range les deux poignées côte à côte à `0x14005b40`. Ce couple de poignées est le « contexte » que toutes les commandes reçoivent.
4. **L'arrêt.** `register_notification_handler` (`0x140006a8`) inscrit `on_terminate_notification` (`0x1400378c`) pour la notification `0x100`. `get_notification_semaphore` (`0x140005b8`) obtient de `sm` le sémaphore qui prévient de l'arrivée d'une notification.

**La boucle :** `svcReplyAndReceive` (appel système `0x4F`) répond au message précédent et attend le suivant, sur la liste de poignées rangée à `0x14006438` (compteur à `0x14005300`).

| Rang dans la liste | Poignée | Ce que fait la boucle quand elle sonne |
| --- | --- | --- |
| 0 | le sémaphore des notifications | `handle_srv_notification` (`0x140005ec`) lit le numéro par `SRV_ReceiveNotification` et appelle le gestionnaire inscrit |
| 1 | le port `Loader` | `svcAcceptSession` ouvre la session. S'il y en a déjà une, la nouvelle est refermée aussitôt |
| 2 | la session ouverte | appelle `loader_handle_command` (`0x14002c5c`), dont l'adresse est lue dans la fiche du service (`0x14004030`) |

- Une session qui se ferme (résultat `0xC920181A`) est retirée de la liste et sa poignée fermée.
- La notification `0x100` ne fait que lever un drapeau (`0x1400530c`). La boucle s'arrête quand ce drapeau est levé et qu'aucune session n'est ouverte : elle retire alors son service (`SRV_UnregisterService`), ferme son port, quitte `srv:` (`srv_exit`, `0x140007e8`) et ferme le sémaphore.

## Partie 3 : les commandes de `Loader`

`loader_handle_command` (`0x14002c5c`, 452 octets) lit l'en-tête du message dans le tampon du fil (à `+0x80` du stockage local) et compare son numéro de commande, les 16 bits du haut, à 1, 2, 3 puis 4. Les noms et les en-têtes de requête viennent de 3dbrew ; l'adresse et l'en-tête de réponse sont lus dans le code.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| 1 | `0x00010080` | LoadProcess | `loader_LoadProcess` | `0x140022b8` | `0x00010042` |
| 2 | `0x00020200` | RegisterProgram | `loader_RegisterProgram` | `0x14000f80` | `0x000200C0` |
| 3 | `0x00030080` | UnregisterProgram | `loader_UnregisterProgram` | `0x14001e28` | `0x00030040` |
| 4 | `0x00040080` | GetProgramInfo | dans l'aiguillage | `0x14002d98` | `0x00040042` |

- L'aiguillage ne regarde que le numéro : le reste de l'en-tête n'est jamais vérifié. Un numéro inconnu rend `0xD900182F`, avec l'en-tête `0x00000040`.
- Le nombre de mots lus colle aux en-têtes de 3dbrew : 2 pour les commandes 1, 3 et 4, 8 pour la commande 2.

**Ce que chacune reçoit et rend :**

| Commande | Reçoit | Rend |
| --- | --- | --- |
| LoadProcess | le numéro de programme, sur 64 bits | le résultat, le mot `0x10` (« la poignée qui suit est donnée au client »), la poignée du processus |
| RegisterProgram | deux blocs de 16 octets : le titre, et sa mise à jour | le résultat, puis le numéro de programme sur 64 bits |
| UnregisterProgram | le numéro de programme | le résultat |
| GetProgramInfo | le numéro de programme | le résultat, le mot `0x01000002` (« un tampon de 0x400 octets suit »), l'adresse `0x14005340` où l'exheader a été copié |

Le « numéro de programme » est un ticket rendu par RegisterProgram : `pm` enregistre d'abord le titre, reçoit ce numéro, puis s'en sert pour toutes les autres commandes.

**Deux guichets pour la même question.** Trois de ces commandes font suivre la question à un autre service, et choisissent lequel de la même façon : si la moitié haute du numéro vaut `0xFFFF0000`, ou si `fs:REG` reconnaît le numéro (`FSREG_CheckHostLoadId` rend un succès franc), la question va à `fs:REG` ; sinon elle va à `PxiPM`, c'est-à-dire au processeur ARM9, celui qui lit les titres installés et les cartouches.

| Commande | Version `PxiPM` | Version `fs:REG` |
| --- | --- | --- |
| RegisterProgram | `PXIPM_RegisterProgram` | `FSREG_LoadProgram` |
| UnregisterProgram | `PXIPM_UnregisterProgram` | `FSREG_UnloadProgram` |
| lire l'exheader | `PXIPM_GetProgramInfo` | `FSREG_GetProgramInfo` |

Pour RegisterProgram, le test porte sur l'identifiant du titre. Après coup la fonction vérifie que le numéro rendu est bien de la famille attendue, et arrête le module (`break_process`) si ce n'est pas le cas.

**L'exheader gardé en mémoire.** `get_program_info` (`0x14001b70`) remplit un tampon de 0x400 octets à `0x14005740`. Le numéro du programme dont l'exheader s'y trouve est gardé à `0x14005280` : si LoadProcess ou GetProgramInfo redemandent le même, la lecture est sautée. UnregisterProgram efface ce numéro quand c'est celui qu'on retire.

## Partie 4 : LoadProcess, pas à pas

C'est le cœur du module. `loader_LoadProcess` (`0x140022b8`, 1 160 octets) reçoit le contexte, l'endroit où rendre la poignée, et le numéro de programme.

### 1. Obtenir l'exheader

`get_program_info` remplit le tampon `0x14005740`, sauf s'il contient déjà le bon. Tout le reste de la fonction lit dedans.

| Décalage dans l'exheader | Contenu | Ce que loader en fait |
| --- | --- | --- |
| `+0x00` | nom du programme, 8 octets | recopié dans la demande au noyau |
| `+0x0D` | drapeaux | le bit 0 dit que le code est compressé |
| `+0x10`, `+0x18` | adresse et taille de `.text` | |
| `+0x20`, `+0x28` | adresse et taille de `.rodata` | |
| `+0x30`, `+0x38` | adresse et taille de `.data` | |
| `+0x3C` | taille de `.bss` | |
| `+0x200` | identifiant du titre, 64 bits | recopié dans la demande au noyau, et comparé à une liste (étape 3) |
| `+0x36F` | catégorie de limites de ressources | lue à l'étape 3 |
| `+0x370` | 28 descripteurs de droits pour le noyau | parcourus, puis passés tels quels au noyau |

Les nombres de pages écrits dans l'exheader (`+0x14`, `+0x24`, `+0x34`) et la taille de pile (`+0x1C`) ne sont pas lus : loader recalcule les pages à partir des tailles en octets, en arrondissant à 0x1000.

### 2. Trouver dans quelle zone de mémoire le programme vit

La fonction parcourt les descripteurs de `+0x370` jusqu'au premier `0xFFFFFFFF`, 28 au plus, et retient leur nombre. Celui dont les 9 bits du haut valent `0x1FE` porte, dans ses bits 8 à 11, le type de mémoire : `0x100` pour une application, `0x200` pour le système, `0x300` pour la base. S'il n'y en a pas, le résultat est `0xD8E00402`.

### 3. Décider si la mémoire sera réservée dans le désordre

Un drapeau est mis à 1 dans trois cas :

| Type de mémoire | Condition |
| --- | --- |
| `0x100` | la moitié haute de l'identifiant du titre, décalée de 14 bits, vaut `0x10`, et les bits 8 à 27 de l'identifiant sont dans une liste de 34 numéros écrite en dur |
| `0x100` | sinon, un descripteur dont les 7 bits du haut valent `0x7E` (la version du noyau demandée) porte une version d'au moins `0x234` |
| `0x200` | la catégorie de limites de ressources (`+0x36F`) n'est pas 2 |

Les 34 numéros : `0x209`, `0x219`, `0x229`, `0x269`, `0x279`, `0x289`, puis `0x334`, `0x335`, `0x336`, `0x343`, `0x465`, `0x4B3`, `0x7FD`, `0x913`, `0x933`, `0x961`, `0x9FA`, `0xA5D`, `0xA5E`, `0xA5F`, `0xC68`, `0xC81`, `0xD7C`, `0xD7D`, `0xD7E`, `0x11C4`, `0x11C5`, `0x12C1`, `0x136E`, `0x149B`, `0x1744`, `0x1746`, `0x1773`, `0x17C1`.

### 4. Réserver la mémoire, chez loader

`allocate_code_memory` (`0x14002798`) calcule trois nombres de pages (`.text`, `.rodata`, `.data`, sans le `.bss`) et trois adresses qui se suivent **dans l'espace de loader lui-même**, à partir de `0x10000000`. `commit_code_pages` (`0x14002818`) réserve le tout par `svcControlMemory`, avec l'opération `3` (réserver) plus le type de mémoire de l'étape 2, en lecture et écriture.

- Drapeau à 0 : un seul appel, pour tout le bloc.
- Drapeau à 1 : le bloc est découpé en 7 morceaux au plus, chacun de 1 à 15 fois 0x10000 octets, la taille étant tirée au sort par `random_below` (`0x140017f8`), plus un dernier morceau pour le reste. L'ordre des morceaux est ensuite mélangé (le dernier garde sa place quand le nombre de pages n'est pas un multiple de 16), et ils sont réservés un par un dans cet ordre. Les adresses restent les mêmes : seul l'ordre des demandes au noyau change.

### 5. Lire le fichier de code

`load_code_file` (`0x14002a70`) :

1. **Ouvrir.** `open_file_directly` (`0x1400113c`) envoie `FS_OpenFileDirectly` à `fs:LDR`, avec l'archive `0x2345678E`. Le chemin de l'archive est le numéro de programme (8 octets). Le chemin du fichier fait 12 octets : le mot `1`, puis le texte `.code` complété par des zéros. Le fichier est ouvert en lecture.
2. **Mesurer.** `file_get_size` (`0x14002fe0`) envoie `FSFILE_GetSize`. Si le fichier est plus gros que la mémoire réservée, le résultat est `0xC900464F`.
3. **Lire.** `file_read_all` (`0x14001fd0`) lit tout le fichier à `0x10000000`, par `FSFILE_Read`, en recommençant tant qu'il manque des octets.
4. **Fermer.** `file_close` (`0x140018b0`) envoie `FSFILE_Close`.
5. **Décompresser**, si le bit 0 de `+0x0D` est mis : `lzss_decompress_backward` (`0x14000e28`), appelée avec l'adresse de la fin du fichier lu.

### 6. La décompression, sur place et à l'envers

Le fichier compressé est au début de la zone ; le résultat, plus gros, occupe la même zone. Pour ne pas écraser ce qui reste à lire, la fonction travaille de la fin vers le début.

Les 8 derniers octets du fichier la guident :

| Position | Contenu |
| --- | --- |
| fin − 8, bits 0 à 23 | longueur de la partie compressée, comptée depuis la fin |
| fin − 8, bits 24 à 31 | longueur du pied de fichier, à sauter avant de lire |
| fin − 4 | de combien d'octets le résultat dépasse le fichier |

Elle part donc avec un pointeur de lecture (fin − pied) et un pointeur d'écriture (fin + dépassement), qui reculent tous les deux :

1. Lire un octet de drapeaux. Ses 8 bits, du plus fort au plus faible, décrivent les 8 éléments suivants.
2. Bit à 0 : recopier un octet tel quel.
3. Bit à 1 : lire deux octets. Les 4 bits du haut du premier donnent une longueur (ajouter 3), les 12 bits restants une distance (ajouter 3). Recopier ce nombre d'octets depuis ce qui vient d'être écrit, à cette distance au-dessus.
4. S'arrêter quand le pointeur de lecture atteint le début de la partie compressée. Ce qui est avant n'était pas compressé et reste en place.

### 7. Décrire le programme au noyau

La fonction remplit une fiche de 0x40 octets sur sa pile :

| Décalage | Contenu | D'où il vient |
| --- | --- | --- |
| `+0x00` | nom, 8 octets | exheader `+0x00`, copié par `copy_8_bytes` |
| `+0x10` | adresse de `.text` | exheader `+0x10` |
| `+0x14` | pages de `.text` | taille `+0x18`, arrondie |
| `+0x18` | adresse de `.rodata` | exheader `+0x20` |
| `+0x1C` | pages de `.rodata` | taille `+0x28`, arrondie |
| `+0x20` | adresse de `.data` | exheader `+0x30` |
| `+0x24` | pages de `.data` | taille `+0x38`, arrondie |
| `+0x28` | pages de `.text`, une seconde fois | |
| `+0x2C` | pages de `.rodata`, une seconde fois | |
| `+0x30` | pages de `.data` et `.bss` ensemble | tailles `+0x38` et `+0x3C` additionnées, puis arrondies |
| `+0x38` | identifiant du titre | exheader `+0x200` |

Les adresses de cette fiche sont celles où le programme veut vivre (`0x00100000` pour `.text` d'un jeu). Le `.bss` n'existe que comme un nombre de pages : loader ne lui réserve rien.

### 8. Les deux appels au noyau

1. `svcCreateCodeSet` (appel système `0x73`) reçoit la fiche et les trois adresses **chez loader** où se trouvent `.text`, `.rodata` et `.data`. Il rend une poignée vers un « jeu de code ».
2. `svcCreateProcess` (appel système `0x75`) reçoit cette poignée, l'adresse des descripteurs de droits (exheader `+0x370`) et leur nombre, compté à l'étape 2. Il rend la poignée du processus.
3. La poignée du jeu de code est fermée, que le processus ait été créé ou non.

En cas d'échec après l'étape 4, `free_code_memory` (`0x1400276c`) rend la mémoire de `0x10000000` (opération `1`). En cas de succès elle n'est pas rendue.

### L'exemple de Pokémon X

Les mêmes calculs, refaits par un script sur l'exheader du jeu (`local/extrait/exefs/exheader.bin`) :

| | Adresse voulue | Taille | Pages | Adresse chez loader |
| --- | --- | --- | --- | --- |
| `.text` | `0x00100000` | `0x43BEDC` | 1 084 | `0x10000000` |
| `.rodata` | `0x0053C000` | `0x69A44` | 106 | `0x1043C000` |
| `.data` | `0x005A6000` | `0x440C0` | 69 | `0x104A6000` |
| `.bss` | à la suite de `.data` | `0x76858` | 187 avec `.data` | rien |

- Mémoire réservée : 1 259 pages, soit 5 156 864 octets. C'est au octet près la taille du `code.bin` décompressé du jeu.
- Le `.code` compressé fait 2 858 188 octets, et le bit 0 de `+0x0D` est mis.
- Type de mémoire `0x100`, 12 descripteurs de droits, version de noyau demandée `0x223`, numéro `0x55D` absent de la liste : le drapeau de l'étape 3 reste à 0, la mémoire est réservée en un seul appel.

Pour charger le jeu sur PC, il suffit donc de décompresser `.code`, de le couper en trois aux frontières de pages ci-dessus, de poser chaque morceau à son adresse voulue, et de prévoir 187 pages à partir de l'adresse de `.data`, à zéro au-delà des données.

## Partie 5 : les services que loader appelle

Chaque requête a sa petite fonction, qui écrit un en-tête et appelle `SendSyncRequest`. Il y en a 19, autant que d'appels à `SendSyncRequest` dans le code. Les noms viennent de 3dbrew, sauf ceux de `PxiPM` (voir sous le tableau).

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x140052c8` | `0x00010002` | `SRV_RegisterClient` | `0x14000abc` | Se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x14000af8` | Obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x14000738` | Créer le service `Loader` |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x14000794` | Le retirer à l'arrêt |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x1400187c` | Ouvrir les trois services ci-dessous |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x14000b34` | Lire le numéro de la notification arrivée |
| `fs:LDR` | `0x14005298` | `0x08610042` | `FS_InitializeWithSdkVersion` | `0x14000bc4` | Se présenter au système de fichiers |
| | | `0x08620040` | `FS_SetPriority` | `0x14000958` | Régler sa priorité à 0 |
| | | `0x08030204` | `FS_OpenFileDirectly` | `0x1400136c` | Ouvrir le `.code` du programme |
| un fichier ouvert | dans l'objet fichier | `0x080200C2` | `FSFILE_Read` | `0x14001f14` | Lire le `.code` |
| | | `0x08040000` | `FSFILE_GetSize` | `0x14001f98` | Connaître sa taille |
| | | `0x08080000` | `FSFILE_Close` | `0x14001f6c` | Le refermer |
| `fs:REG` | `0x14005b44` | `0x040300C0` | `FSREG_GetProgramInfo` | `0x14001eb4` | Lire l'exheader |
| | | `0x04040100` | `FSREG_LoadProgram` | `0x14001dd8` | Enregistrer un programme, obtenir son numéro |
| | | `0x04050080` | `FSREG_UnloadProgram` | `0x14001e84` | Le retirer |
| | | `0x04060080` | `FSREG_CheckHostLoadId` | `0x140018e4` | Savoir si un numéro est du ressort de `fs:REG` |
| `PxiPM` | `0x14005b40` | `0x00010082` | `PXIPM_GetProgramInfo` | `0x14002ee0` | Lire l'exheader |
| | | `0x00020200` | `PXIPM_RegisterProgram` | `0x14002e48` | Enregistrer un programme, obtenir son numéro |
| | | `0x00030080` | `PXIPM_UnregisterProgram` | `0x14002eb0` | Le retirer |

- La Carte des services n'a pas de table pour `PxiPM`. Les trois noms sont posés d'après ce que le code en fait : les requêtes `0x00020200` et `0x00030080` ont exactement l'en-tête des commandes RegisterProgram et UnregisterProgram de `Loader` et servent au même moment, et `0x00010082` est celle qui remplit le tampon de l'exheader.
- `PXIPM_GetProgramInfo` et `FSREG_GetProgramInfo` reçoivent l'exheader dans le tampon `0x14005740`, par deux moyens différents : la première passe l'adresse dans la requête (mot `0x00040004`), la seconde l'annonce comme tampon de réception du fil (à `+0x180` du stockage local, mot `0x01000002`).
- La seconde poignée de `fs:LDR`, à `0x140052b0`, est une copie de la première : c'est celle dont `FS_OpenFileDirectly` se sert.
- Les chaînes `fs:USER` et `srv:pm` sont dans les données du module, mais aucun pointeur du code ne les vise.

**Un fichier ouvert** est un petit objet de 8 octets pris dans une réserve (`pool_alloc`, `0x140037a0`, sur la réserve `0x14005c28`) : une table de fonctions (`0x14004178`) et la poignée du fichier. S'il n'y a plus de place, `open_file_directly` referme le fichier et rend `0xD8604659`.

| Case de la table | Fonction | Adresse | Requête envoyée |
| --- | --- | --- | --- |
| `+0x00` | `file_read_impl` | `0x14001304` | `FSFILE_Read` |
| `+0x0C` | `file_get_size_impl` | `0x14002fc0` | `FSFILE_GetSize` |
| `+0x30` | `file_close_and_free` | `0x14001294` | `FSFILE_Close`, puis l'objet retourne dans la réserve |
| `+0x34` | `file_close_handle` | `0x14001344` | aucune : ferme la poignée |

## Partie 6 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x14004028` | la fiche du service, 16 octets : pointeur vers le nom `Loader`, nombre de sessions (1), gestionnaire (`0x14002c5c`), puis l'adresse du contexte (`0x14005b40`) |
| `0x14005000`, `0x14005100`, `0x14005200` | les tampons des trois réserves de blocs (celle de `0x14005100` sert aux objets fichier) |
| `0x14005280` | numéro du programme dont l'exheader est en mémoire (64 bits, 0 si aucun) |
| `0x14005288` | état du tirage au sort (64 bits) |
| `0x14005298`, `0x140052b0` | la poignée de `fs:LDR`, et sa copie |
| `0x140052c0`, `0x140052c4`, `0x140052c8` | pour `srv:` : drapeau « prêt », nombre d'ouvertures, poignée de la session |
| `0x140052f4` | l'arbitre d'adresses des verrous |
| `0x14005300` | nombre de poignées attendues par la boucle (2, ou 3 quand une session est ouverte) |
| `0x1400530c` | drapeau d'arrêt |
| `0x14005310` | par session : le rang de son service et un pointeur vers son contexte |
| `0x14005324` | le sémaphore des notifications |
| `0x14005340` | la copie de l'exheader rendue par GetProgramInfo (0x400 octets) |
| `0x14005740` | l'exheader du programme en cours (0x400 octets) ; ses descripteurs de droits tombent à `0x14005ab0` |
| `0x14005b40`, `0x14005b44` | le contexte des commandes : poignées de `PxiPM` et de `fs:REG` |
| `0x14005ec8` | la liste des gestionnaires de notifications |
| `0x14006438` | la liste des poignées surveillées : sémaphore, port, session |

## Partie 7 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x14001960` |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x14000b88` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x14001d5c` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x14000bb8` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x14000b70` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x14001be8` |
| CloseHandle | `0x23` | écrit sur place, à 12 endroits | |
| WaitSynchronization1 | `0x24` | dans une fonction non nommée | `0x140021ac` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x14000ef0` |
| GetSystemTick | `0x28` | dans `random_below` et dans une fonction non nommée | `0x140017f8`, `0x140011f0` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x14000d08` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x14000914` |
| SendSyncRequest | `0x32` | écrit sur place, à 19 endroits | |
| Break | `0x3C` | `svcBreak` | `0x14000e20` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x14000468` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x14000480` |
| CreateCodeSet | `0x73` | `svcCreateCodeSet` | `0x14000ebc` |
| CreateProcess | `0x75` | `svcCreateProcess` | `0x14000ed8` |

`svcControlMemory` n'est appelée que par `commit_code_pages` et `free_code_memory`. Les verrous (`lock_enter` à `0x14001d80`, `lock_leave` à `0x14001db8`) reposent sur `ArbitrateAddress`, comme dans `sm` et `hid`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 4 numéros de commande et leur fonction : le pseudo-code de REA et l'assembleur de l'aiguillage d'un côté ; de l'autre les en-têtes de 3dbrew, qui annoncent le nombre de mots que le code lit (2, 8, 2, 2).
- La chaîne du chargement : `svcCreateProcess` et `svcCreateCodeSet` n'ont qu'un appelant (`loader_LoadProcess`), qui n'en a qu'un (`loader_handle_command`), lequel n'est visé que par la fiche du service à `0x14004030`. Vu par REA et par un script qui relève les sauts dans `code.bin`.
- Les deux appels système de création : l'exheader de `loader` autorise justement les numéros `0x73` et `0x75`.
- **La décompression.** L'algorithme, récrit en Python tel qu'il est lu dans l'assembleur, a été lancé sur le `.code` compressé de Pokémon X et sur celui de sa mise à jour, pris dans les dumps. Les deux résultats sont identiques, octet pour octet, au `code.bin` décompressé par ctrtool (5 156 864 et 5 169 152 octets).
- Le calcul des pages : la somme des trois sections arrondies donne exactement la taille du code décompressé, pour le jeu comme pour sa mise à jour.
- La liste des 34 numéros : calculée à la main sur les comparaisons de l'assembleur, puis relue dans le pseudo-code de Ghidra, qui les présente autrement. Les deux lectures donnent les mêmes.
- Les 19 fonctions de requête correspondent aux 19 appels à `SendSyncRequest`, et chaque en-tête existe dans la Carte des services pour le service visé (sauf `PxiPM`, qui n'y a pas de table).
- La forme de la requête `FS_OpenFileDirectly` : 8 mots ordinaires et 4 mots de tampons, comme l'annonce son en-tête `0x08030204`.

**Interprété à la lecture du code, à relire dans Ghidra**
- Le sens du drapeau de l'étape 3. Le code montre seulement que les morceaux sont réservés dans un ordre tiré au sort ; y voir un moyen de rendre imprévisible l'emplacement physique du code est une interprétation.
- Ce que sont les 34 numéros. Les six premiers ressemblent aux numéros de la boutique eShop dans les six régions (de mémoire, à vérifier dans la liste des titres de 3dbrew). Les 28 autres ne sont pas identifiés.
- Le sens de `0xFFFF0000` et de `CheckHostLoadId` : des programmes qui ne viennent ni de la mémoire interne ni d'une cartouche, mais d'un ordinateur de développement. Le code montre seulement l'aiguillage entre `fs:REG` et `PxiPM`.
- Les trois noms des requêtes à `PxiPM`.
- Le contenu des deux blocs de RegisterProgram. Le code y lit un identifiant sur 64 bits et un octet à `+8` ; y voir « le titre » et « sa mise à jour » vient de 3dbrew, de mémoire.
- Les valeurs passées à `svcControlMemory` (opération `3` pour réserver, `1` pour rendre, types `0x100`, `0x200`, `0x300`) et le sens des descripteurs de droits (`0x1FE` pour le type de mémoire, `0x7E` pour la version du noyau) : lus dans le code, nommés d'après 3dbrew.
- Ce que le noyau fait des pages après `svcCreateCodeSet` : loader ne les rend pas en cas de succès, ce qui laisse penser que le noyau les lui retire pour les donner au nouveau processus. C'est le noyau qui pose chaque section à son adresse voulue, avec ses droits : ce n'est pas dans ce module.
- La fiche de 0x40 octets : les décalages sont lus dans les écritures, les noms des champs viennent de la page de 3dbrew sur `svcCreateCodeSet`.
- Le sens des codes d'erreur `0xD8E00402` (pas de type de mémoire), `0xC900464F` (fichier trop gros) et `0xD8604659` (plus d'objet fichier libre).
- Une temporisation avant chaque lecture de fichier (`0x140011f0`) : elle ne fait rien tant que l'octet `0x140052a0` vaut 0, et aucune écriture de cet octet n'a été trouvée.
- Un défaut probable dans `commit_code_pages` : quand une réservation échoue en mode « désordre », les morceaux déjà réservés sont rendus avec une taille décalée de 12 bits une fois de trop (à `0x14002a14`). À relire.
- `init_c_locale` : nommée d'après la table de classes de caractères à `0x14004244` et le nom de réglage `C` qu'elle compare.

**Pas lu**
- Le détail de `init_runtime` et des réserves d'adresses (`0x14000a2c`, `0x14000a94`).
- Neuf des dix fonctions d'initialisation des objets globaux, lues en diagonale : seule `init_memory_pools` est nommée.
- Les destructeurs (`0x14002150`, `0x140021ac`, `0x14002200`, `0x14003804`) et la fonction à `0x14002058`.
- Les deux entrées de division jamais appelées (`0x1400140c`, `0x1400154c`) : Ghidra n'en fait pas des fonctions, et elles ne sont pas en graines.
- 42 fonctions restent sans nom.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système, nommer leurs enveloppes, trouver les fonctions manquées | `outils/prescan.py`, trois passages | une à deux minutes par passage, relance du pont comprise |
| Décompiler les 134 fonctions | REA, par `prescan.py --dump` | quelques secondes |
| Sortir l'assembleur de chaque fonction, relever les sauts, lister les trous de `.text` | des scripts Python sous `local/analyse/loader/` | immédiat |
| Lire le pseudo-code et l'assembleur, nommer | Claude | le gros du temps |
| Rejouer la décompression sur le vrai `.code` de Pokémon X | un script Python | moins d'une minute |
| Recouper avec la Carte des services et les exheaders | des scripts | immédiat |

**Les pièges rencontrés.**
- **Le pseudo-code perd les arguments des appels système.** Autour d'un `svc`, Ghidra n'affiche pas ce qui est dans les registres : la poignée d'une requête, la taille passée à `svcControlMemory`, les cinq arguments de `svcCreateCodeSet`. Toute la partie 4 a été lue dans l'assembleur.
- **La table d'initialisation est dans le code.** Comme dans `hid`, elle contient des distances et non des adresses. Mais ici elle est rangée dans `.text`, juste après la fonction qui la parcourt, et `prescan.py` ne cherche ces tables que dans les données. Huit fonctions d'initialisation ont été ajoutées en graines à la main, avec deux morceaux atteints seulement par un saut (`0x14000e20` et `0x14002ee0`) : Ghidra est passé de 110 à 124 fonctions avec les graines de prescan, puis à 134.
- **Deux noms faux posés d'office.** Au premier passage, `prescan.py` a nommé `entry` (`0x14000000`) `svcExitProcess`, et un petit bout de code à `0x1400109c` `svcBreak` : dans les deux cas Ghidra avait rattaché à une fonction courte l'instruction `svc` d'une autre, atteinte par un saut. Les vraies enveloppes sont à `0x14001d5c` et `0x14000e20` ; le fichier de noms est corrigé.

**Trois choses à savoir en relisant dans Ghidra.**
- La fonction à `0x1400384c` est en Thumb, et le nom qu'on lui donne dans le fichier de graines ne prend pas. Elle n'a donc pas de ligne dans `loader.noms.tsv` : à nommer à la main (`run_static_initializers`).
- `__aeabi_uidivmod` commence à `0x14001b40`, mais son corps est ailleurs, de `0x14001440` à `0x14001530` : c'est une seconde entrée dans la routine de division de la bibliothèque.
- `init_runtime_and_srv` (`0x14001984`) ne se termine pas par un retour : elle continue dans `srv_init`, la fonction suivante. Ghidra affiche donc le corps de `srv_init` deux fois. De même `loader_UnregisterProgram` continue dans `FSREG_UnloadProgram`, et `get_program_info` saute dans `PXIPM_GetProgramInfo`.

**Pour reprendre.** `loader.noms.tsv` est le fichier de graines : une adresse, `function`, un nom. Les noms en majuscules (`SRV_`, `FS_`, `FSFILE_`, `FSREG_`, `PXIPM_`) sont les requêtes que `loader` envoie ; ceux en `loader_` sont les commandes qu'il reçoit. Le pseudo-code, l'assembleur et les scripts (dont `verif_lzss.py`, qui rejoue la décompression) sont dans `local/analyse/loader/`, non versionné.
