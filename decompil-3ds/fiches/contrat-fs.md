# Le contrat des fichiers : `fs:USER`, un fichier ouvert, un dossier ouvert

Pokémon X lit et écrit ses fichiers en envoyant des commandes au module `fs` de la console. Ce document dit, commande par commande, ce que le jeu envoie, ce que le module en fait et ce qu'il répond. Il sert à une chose : le jour où le jeu tournera sur PC, il n'y aura plus de console en face, et il faudra répondre à sa place.

Document du 14 octobre 2026. Il couvre les 43 commandes de fichiers que le jeu sait envoyer d'après l'inventaire (`pokemon-x-services.md`) : 29 sur `fs:USER`, 10 sur la session d'un fichier ouvert, 4 sur celle d'un dossier ouvert. Chaque commande est lue des deux côtés, qui sont deux preuves indépendantes : dans le code du jeu (la fonction qui fabrique la requête) et dans le code du module `fs` (la fonction qui la reçoit). Le vocabulaire est celui de la fiche [sm](sm.md), la carte du module est dans la fiche [fs](fs.md).

Les adresses du jeu sont celles du code de la mise à jour, chargé à `0x00100000` (`local/extrait/maj`) ; celles du module sont celles de `fs` chargé à `0x00100000` (`local/extrait/fs`). Deux programmes différents ont donc des adresses qui se ressemblent : chaque tableau dit de quel côté on est.

## Synthèse

« Deux côtés » veut dire : la requête et la réponse sont relevées mot par mot dans la fonction d'envoi du jeu et dans l'aiguillage du module, et les deux s'accordent. La colonne « Corps du module » dit jusqu'où la fonction de commande a été lue : « entier » quand elle est suivie jusqu'à l'appel de méthode d'un objet ou jusqu'à la requête envoyée à Process9, « contrôles » quand seuls ses contrôles et ses codes d'erreur ont été lus, pas le travail fait derrière.

| Service | En-tête | Commande | Envoi, dans le jeu | Réception, dans `fs` | État | Corps du module | Au démarrage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fs:USER` | `0x08610042` | InitializeWithSdkVersion | `0x123a90` | `fsuser_Initialize` `0x1147c8` | deux côtés | entier | 1 |
| `fs:USER` | `0x08620040` | SetPriority | `0x118368` | `session_SetPriority` `0x115150` | deux côtés | entier | 2 |
| `fs:USER` | `0x08030204` | OpenFileDirectly | `0x1239f0` | `fsuser_OpenFileDirectly` `0x12837c` | deux côtés | entier | 3 |
| `fs:USER` | `0x08630000` | GetPriority | `0x1468ec` | `session_GetPriority` `0x1148e4` | deux côtés | entier | 6 |
| `fs:USER` | `0x080C00C2` | OpenArchive | `0x1e28b8` | `fsuser_OpenArchive` `0x126ba4` | deux côtés | entier | |
| `fs:USER` | `0x080E0080` | CloseArchive | `0x1e2918` | `fsuser_CloseArchive` `0x126db4` | deux côtés | entier | |
| `fs:USER` | `0x080201C2` | OpenFile | `0x1e2f4c` | `fsuser_OpenFile` `0x114d10` | deux côtés | entier | |
| `fs:USER` | `0x080B0102` | OpenDirectory | `0x1e2a10` | `fsuser_OpenDirectory` `0x1276cc` | deux côtés | entier | |
| `fs:USER` | `0x08040142` | DeleteFile | `0x1e27d8` | `fsuser_DeleteFile` `0x126744` | deux côtés | entier | |
| `fs:USER` | `0x08050244` | RenameFile | `0x1e2828` | `fsuser_RenameFile` `0x1269d4` | deux côtés | entier | |
| `fs:USER` | `0x08060142` | DeleteDirectory | `0x1e2bfc` | `fsuser_DeleteDirectory` `0x127f20` | deux côtés | entier | |
| `fs:USER` | `0x08070142` | DeleteDirectoryRecursively | `0x1e2ea4` | `fsuser_DeleteDirectoryRecursively` `0x129cbc` | deux côtés | entier | |
| `fs:USER` | `0x08080202` | CreateFile | `0x1e277c` | `fsuser_CreateFile` `0x1265fc` | deux côtés | entier | |
| `fs:USER` | `0x08090182` | CreateDirectory | `0x1e2ba8` | `fsuser_CreateDirectory` `0x127e7c` | deux côtés | entier | |
| `fs:USER` | `0x080A0244` | RenameDirectory | `0x1e2c4c` | `fsuser_RenameDirectory` `0x128094` | deux côtés | entier | |
| `fs:USER` | `0x080D0144` | ControlArchive | `0x1e2a74` | `fsuser_ControlArchive` `0x127958` | deux côtés | entier | |
| `fs:USER` | `0x08120080` | GetFreeBytes | `0x1e2948` | `fsuser_GetFreeBytes` `0x126dec` | deux côtés | entier | |
| `fs:USER` | `0x085A00C0` | SetArchivePriority | `0x1e2e00` | `fsuser_SetArchivePriority` `0x128ba0` | deux côtés | entier | |
| `fs:USER` | `0x085B0080` | GetArchivePriority | `0x1e2d74` | `fsuser_GetArchivePriority` `0x1288d4` | deux côtés | entier | |
| `fs:USER` | `0x08170000` | IsSdmcDetected | `0x1e2b38` | `fsuser_IsSdmcDetected` `0x127cb4` | deux côtés | entier | |
| `fs:USER` | `0x08180000` | IsSdmcWritable | `0x1e2b70` | `fsuser_IsSdmcWritable` `0x127d18` | deux côtés | entier | |
| `fs:USER` | `0x08490040` | GetArchiveResource | `0x1e2db0` | `fsuser_GetArchiveResource` `0x128904` | deux côtés | entier | |
| `fs:USER` | `0x084500C2` | GetFormatInfo | `0x1e2984` | `fsuser_GetFormatInfo` `0x126e78` | deux côtés | contrôles | |
| `fs:USER` | `0x084C0242` | FormatSaveData | `0x1e2ae0` | `fsuser_FormatSaveData` `0x127ab4` | deux côtés | contrôles | |
| `fs:USER` | `0x08510242` | CreateExtSaveData | `0x1e2cdc` | `fsuser_CreateExtSaveData` `0x114b94` | deux côtés | contrôles | |
| `fs:USER` | `0x08520100` | DeleteExtSaveData | `0x1e2d38` | `fsuser_DeleteExtSaveData` `0x114ad8` | deux côtés | contrôles | |
| `fs:USER` | `0x08540100` | GetExtDataBlockSize | `0x1e2e38` | `fsuser_GetExtDataBlockSize` `0x114a40` | deux côtés | contrôles | |
| `fs:USER` | `0x086E00C0` | SetThisSaveDataSecureValue | `0x118398` | `fsuser_SetThisSaveDataSecureValue` `0x129df0` | deux côtés | contrôles | |
| `fs:USER` | `0x086F0040` | GetThisSaveDataSecureValue | `0x1e2ef4` | `fsuser_GetThisSaveDataSecureValue` `0x129d4c` | deux côtés | contrôles | |
| fichier | `0x080200C2` | Read | `0x1e30ac` | `fsfile_Read` `0x11541c` | deux côtés | entier | 4 |
| fichier | `0x08080000` | Close | `0x1e3104` | `fsfile_Close` `0x1152ac` | deux côtés | entier | 5 |
| fichier | `0x080C0000` | OpenLinkFile | `0x1e3074` | `fsfile_OpenLinkFile` `0x12e764` | deux côtés | entier | plus tard |
| fichier | `0x080A0040` | SetPriority | `0x1e3044` | `session_SetPriority` `0x115150` | deux côtés | entier | plus tard |
| fichier | `0x080B0000` | GetPriority | `0x1e2fc0` | `session_GetPriority` `0x1148e4` | deux côtés | entier | |
| fichier | `0x08040000` | GetSize | `0x1e31dc` | `fsfile_GetSize` `0x12ee78` | deux côtés | entier | |
| fichier | `0x08010100` | OpenSubFile | `0x1e2ff8` | `fsfile_OpenSubFile` `0x12e2f8` | deux côtés | entier | |
| fichier | `0x0C010100` | GetAvailable | `0x1e3190` | `fsfile_GetAvailable` `0x12ed14` | deux côtés | entier | |
| fichier | `0x08030102` | Write | `0x1e3130` | `fsfile_Write` `0x12eb4c` | deux côtés | entier | |
| fichier | `0x08050080` | SetSize | `0x1e3214` | `fsfile_SetSize` `0x12ef00` | deux côtés | entier | |
| dossier | `0x08010042` | Read | `0x1e32ac` | `fsdir_Read` `0x1264e0` | deux côtés | entier | |
| dossier | `0x08020000` | Close | `0x1e3300` | `fsdir_Close` `0x126534` | deux côtés | entier | |
| dossier | `0x08030040` | SetPriority | `0x1e327c` | `session_SetPriority` `0x115150` | deux côtés | entier | |
| dossier | `0x08040000` | GetPriority | `0x1e3244` | `session_GetPriority` `0x1148e4` | deux côtés | entier | |

Total : 43 commandes lues des deux côtés pour ce qui est du message (requête et réponse), aucune d'un seul côté, aucune non lue. Pour 36 d'entre elles le corps de la fonction du module est lu en entier, pour 7 seuls ses contrôles le sont. Ce qui n'est pas lu est plus bas : le travail que font les objets « sauvegarde » et « données supplémentaires » à l'intérieur de `fs`, et ce que le jeu fait des réponses au-dessus de ses fonctions d'envoi, sauf sur le chemin du démarrage.

## Partie 1 : ce qui vaut pour toutes les commandes

**Les mots.** Une commande est une suite de mots de 32 bits dans le tampon du fil, à `+0x80` du stockage local du fil. Le mot 0 est l'en-tête : numéro de commande dans les 16 bits du haut, nombre de mots ordinaires dans les bits 6 à 11, nombre de mots de traduction dans les bits 0 à 5. `0x080201C2` se lit donc : commande `0x0802`, 7 mots ordinaires, 2 mots de traduction. La réponse revient au même endroit.

**Les mots de traduction** vont par deux : un descripteur, puis une valeur que le noyau transforme en chemin.

| Descripteur | Sens | Ce que le noyau fait |
| --- | --- | --- |
| `0x20` | numéro du processus | il écrit le numéro du processus appelant dans le mot suivant |
| `taille << 14 \| n << 10 \| 2` | tampon statique n° `n` | il recopie les octets dans le tampon n° `n` du serveur et remplace l'adresse |
| `taille << 4 \| 0xA` | tampon que le serveur lira | il rend la mémoire du jeu visible dans le serveur |
| `taille << 4 \| 0xC` | tampon où le serveur écrira | pareil, en écriture |
| `0x10` | une poignée à donner | il transfère la poignée et écrit sa nouvelle valeur |

Ce tableau vient de 3dbrew (« IPC ») ; les valeurs `2`, `0x402`, `0x802`, `0xA`, `0xC`, `0x10` et `0x20` sont bien celles que le jeu écrit et que le module vérifie. Les tampons statiques de `fs` font `0x200` octets (fiche `fs`, partie 2) : c'est pourquoi le jeu refuse lui-même un chemin de plus de `0x200` octets, avec le code `0xE0E046BF` (`0x1e217c`).

**Côté jeu, les 43 fonctions d'envoi ont la même forme.** Vérifié en les exécutant toutes dans un émulateur :

1. Elles écrivent l'en-tête et les paramètres, prennent la poignée de session à l'adresse reçue en premier argument, et font l'appel système `0x32` (SendSyncRequest).
2. Si l'appel système lui-même échoue, elles rendent son code sans lire la réponse.
3. Sinon elles recopient les mots de sortie chez l'appelant **même quand le mot 1 est une erreur**, puis rendent le mot 1.
4. Elles ne lisent jamais le mot 0 de la réponse, ni le mot `0x10` qui précède une poignée : elles prennent la poignée directement au mot 3.

Conséquence pour une réimplémentation : le mot 1 doit être juste, les mots de sortie aussi, et l'en-tête de réponse n'est pas regardé par ce jeu. Autant le rendre exact quand même, il est donné dans chaque rubrique.

**Les poignées du jeu.** La session `fs:USER` est à `0x5d4094`, recopiée à `0x5d40b0`. Une archive ouverte devient un objet (table de méthodes `0x592194`) qui garde la session à `+4` et la poignée d'archive de 64 bits à `+8`. Un fichier ouvert devient un objet (table `0x592130`) qui garde à `+4` la poignée de sa session privée ; un dossier, un objet de table `0x592174`. Les 13 commandes d'archive, les 10 de fichier et les 4 de dossier sont envoyées par les méthodes de ces objets :

| Objet du jeu | Méthodes, dans l'ordre de la table |
| --- | --- |
| archive (`0x592194`) | OpenFile, OpenDirectory, DeleteFile, RenameFile, DeleteDirectory, DeleteDirectoryRecursively, CreateFile, CreateDirectory, RenameDirectory, SetArchivePriority, GetArchivePriority, GetFreeBytes, puis fermeture (CloseArchive) |
| fichier (`0x592130`) | Read, Write, GetAvailable, GetSize, SetSize, « vider » (un Write de taille 0), SetPriority, GetPriority, OpenSubFile, OpenLinkFile, deux non lues, fermeture (Close) |
| dossier (`0x592174`) | Read, fermeture (Close), SetPriority, GetPriority |

Dans les méthodes d'archive, le premier mot de la requête (« transaction » chez 3dbrew) vaut toujours 0, et les attributs aussi.

**Côté module, les trois aiguillages ont la même forme.** `fsuser_dispatch_command` (`0x12b4fc`), `fsfile_dispatch_command` (`0x12ae2c`) et `fsdir_dispatch_command` (`0x12b2a0`) :

1. Ils lisent le numéro dans l'en-tête. Numéro inconnu : en-tête de réponse `0x00000040`, mot 1 `0xD900182F`.
2. Pour les commandes qui portent des mots de traduction, ils comparent l'en-tête entier à une constante et vérifient le genre de chaque descripteur (masque `0x3C0F` pour un tampon statique, `0xF` pour les autres). En cas d'écart : `0x00000040` et `0xD9001830`. Pour les autres commandes, seul le numéro compte : les 16 bits du bas de l'en-tête peuvent valoir n'importe quoi.
3. Ils appellent la fonction de commande, écrivent l'en-tête de réponse, mettent au mot 1 ce que la fonction a rendu, et recopient les valeurs de sortie. Ils le font **que la fonction ait réussi ou non** : après une erreur, les mots de sortie contiennent ce qu'il y avait dans les variables de l'aiguillage. Pour une poignée, cette variable est mise à 0 avant l'appel.

Deux habitudes du module, lues dans l'aiguillage et qui ne sont pas dans 3dbrew :

- **Le mot « taille du chemin » n'est jamais lu.** La taille d'un chemin est prise dans le descripteur du tampon statique (`descripteur >> 14`), pas dans le mot ordinaire que le jeu envoie en plus. Pareil pour les tailles de Read, Write, ControlArchive et CreateExtSaveData (`descripteur >> 4`), et pour le nombre d'entrées d'une lecture de dossier.
- **Un booléen de réponse est écrit sur un seul octet.** Les trois octets du haut du mot gardent ce qui s'y trouvait à l'arrivée de la requête. Le jeu, lui, ne lit bien qu'un octet. C'est le cas de IsSdmcDetected, IsSdmcWritable, du mot 5 de GetFormatInfo et des mots 2 et 3 de GetThisSaveDataSecureValue.

**Un chemin**, pour le module, c'est trois valeurs : un type, une adresse, une taille. Les types envoyés par le jeu sont 1 (vide, un octet quelconque), 2 (binaire : une petite structure) et ceux des chemins de texte, que ses méthodes d'archive passent tels qu'on les leur donne.

**Les codes d'erreur.** Valeurs lues dans le code ; le sens est celui de l'endroit où le code est rendu.

| Code | Où il est rendu |
| --- | --- |
| `0xD900182F` | aiguillage : numéro de commande inconnu |
| `0xD9001830` | aiguillage : en-tête ou descripteur qui ne colle pas |
| `0xC8804465` | la poignée d'archive n'est pas dans la table de la session ; ou, pour Initialize, le processus n'est pas dans le registre des programmes |
| `0xC8A044DC` | le gestionnaire ne trouve pas l'objet (archive, fichier, dossier) derrière la poignée |
| `0xD8604658` | il y a déjà 128 sessions dans la liste du serveur |
| `0xD8604659` | plus de mémoire, ou plus de case libre dans la table des 32 archives de la session |
| `0xD9004676` | droit refusé : mode d'ouverture du fichier, ou droits du programme |
| `0xE0E046BE` | archive inconnue, chemin de la mauvaise forme, type de chemin refusé |
| `0xE0E046BC` | taille refusée (taille de fichier négative dans CreateFile) |
| `0xE0E046C1` | fenêtre hors du fichier (OpenSubFile) |
| `0xE0C046F8` | pas pris en charge par cet objet |
| `0xF9604784` | type de chemin 4 de l'archive `0x00000003` ; aussi dans GetFormatInfo |
| `0xC8A04554` | l'en-tête « IVFC » d'un romfs n'est pas reconnu |
| `0xD9004586` | rendu par la lecture d'un romfs ; elle est alors refaite une fois |
| `0xE7E3FFFF` | FormatSaveData et GetFormatInfo, archive `0x567890B2` avec un chemin de la mauvaise forme |
| `0xE0E046BF` | **dans le jeu**, pas dans le module : chemin de plus de `0x200` octets |
| `0xC8A04554` | **dans le jeu** aussi : l'en-tête du romfs lu ne fait pas `0x28` octets |

Après presque chaque appel, la fonction de commande regarde les 5 bits du haut du résultat : s'ils valent tous 1 (un code à partir de `0xF8000000`), elle appelle `0x11e1a4`, qui fait l'appel système Break. Un tel code arrête le module.

## Partie 2 : le chemin du romfs

Le jeu range presque toutes ses données dans un romfs (les fichiers `a/0/0/0`…). Il ne demande jamais « ouvre-moi `a/0/0/0` » à la console. Il ouvre **le romfs entier comme un seul fichier**, en lit lui-même les tables, et ensuite ne fait plus que des lectures à une position calculée. La recherche d'un nom de fichier se fait dans le jeu, sans aucune commande.

### Côté jeu : les commandes, dans l'ordre

Tout part de `0x10a1a0`, appelée par `game_init_systems` à `0x1080a4`.

| N° | Fonction du jeu | Commande | Ce qui est envoyé |
| --- | --- | --- | --- |
| 1 | `fs_init` (`0x10eac4`), puis `fs_set_session_and_sdk_version` (`0x1181cc`) | InitializeWithSdkVersion | version `0x050200C8` |
| 2 | `fs_init` | SetPriority | priorité 0 |
| 3 | `0x10ebd4`, puis `0x118048` | OpenFileDirectly | archive `0x00000003`, chemin d'archive vide, chemin de fichier binaire de 12 octets à zéro, ouverture en lecture |
| 4 | `0x118048` | Read (fichier) | position 0, `0x28` octets |
| 5 | `0x118048` | Close (fichier), puis fermeture de la poignée | |
| 3 bis | `0x10ed5c` (qui donne le nom `rom:`), `0x1183dc`, `0x1181f8` | OpenFileDirectly | la même requête qu'en 3 |
| 4 bis | `0x132fdc` | Read (fichier), six fois | l'en-tête deux fois (position 0, `0x28` octets), puis les quatre tables à la suite, à partir de la position `0x28` |
| 6 | `0x132fbc`, appelée par `0x132fdc` | GetPriority (`fs:USER`) | |

- **Pourquoi deux ouvertures.** La première (`0x118048`) sert à calculer la mémoire à réserver : `0x80` fichiers × `0x20` + `0x10` dossiers × `0x18` + la somme des quatre tailles de tables lues dans l'en-tête. Le fichier est refermé aussitôt. La seconde est la vraie.
- **L'en-tête de `0x28` octets.** Le jeu vérifie que le premier mot vaut `0x28`. Il prend ensuite quatre tailles aux décalages `+0x08`, `+0x10`, `+0x18` et `+0x20`, et la position des données des fichiers à `+0x24`. C'est l'en-tête du niveau 3 d'un romfs : table de hachage des dossiers, table des dossiers, table de hachage des fichiers, table des fichiers. Les tables sont lues l'une derrière l'autre, chaque lecture partant de la fin de la précédente : le jeu suppose qu'elles se suivent sans trou.
- **Tout échec est fatal.** Si l'une de ces commandes rend une erreur, `0x118048` et `0x1183dc` appellent `0x124750`, qui envoie l'erreur à `err:f` : l'écran d'erreur de la console. Deux exceptions : InitializeWithSdkVersion, dont `fs_set_session_and_sdk_version` ne regarde pas le résultat, et Close.
- **Le second romfs.** Plus loin dans `game_init_systems` (`0x1085c4` et `0x1085fc`), la même suite 3, 4, 5, 3 bis, 4 bis est refaite avec un chemin de fichier qui commence par 5 au lieu de 0, et le nom `rom2:`. C'est de `rom2:` que le jeu charge `static.crs` et `.crr/static.crr`, donc ses modules `.cro`. Les deux extraits (`local/extrait/romfs` et `local/extrait/maj/romfs`) contiennent un `static.crs` : ce document ne prouve pas lequel des deux est derrière le chemin 5. Comme le code qui tourne est celui de la mise à jour et qu'il ne peut charger que ses propres `.cro`, `rom2:` est très probablement le romfs de la mise à jour, et `rom:` celui du jeu d'origine. À confirmer en regardant le jeu tourner.

**Ensuite, lire un fichier du romfs.**

1. L'ouverture (`0x1e0ce0`, méthode de l'objet `rom:`) cherche le nom dans les tables en mémoire. Aucune commande.
2. La lecture (`0x1e0c28`) limite la taille à la fin du fichier, ajoute la position du fichier dans le romfs, et envoie **Read** sur la poignée du romfs.
3. Il n'y a pas une poignée mais jusqu'à cinq, une par classe de priorité (moins de -8, de -8 à -1, 0, de 1 à 8, plus de 8). La première vient de l'ouverture, rangée dans la classe que GetPriority a rendue. Quand un fichier reçoit une autre priorité (`0x1e0a78`), le jeu envoie **OpenLinkFile** sur la poignée du romfs pour en obtenir une seconde, puis **SetPriority** sur celle-ci.

OpenSubFile et GetAvailable existent dans l'objet fichier du jeu, mais ne sont pas sur ce chemin.

**Les autres ouvertures par l'archive `0x00000003`.** `0x1e0460` ouvre l'archive par OpenArchive, puis OpenFile avec le chemin binaire `{2, "icon", 0}`, lit `0x36C0` octets et referme tout : c'est l'icône du programme, dans son exefs. Et `0x1333e8` envoie OpenFileDirectly sur l'archive `0x2345678A` (le contenu d'un autre titre) avec un chemin d'archive de 16 octets et un chemin de fichier de 20 octets ; ses quatre appelantes (`0x10efe4`, `0x1198fc`, `0x1ebd7c`, `0x200bdc`) n'ont pas été lues.

### Côté module : ce que `fs` fait de l'archive `0x00000003`

**L'ouverture de l'archive** (`open_self_ncch_archive`, `0x10d2a4`). `fs` n'ouvre pas chez Process9 une archive « 3 ». Il ouvre l'archive `0x2345678E`, par `0x119384` puis `pxi_open_archive`, avec un chemin binaire de 8 octets : la poignée de programme que `pm` a donnée à `fs` en déclarant le jeu (elle est dans le registre des programmes, et Initialize l'a recopiée dans la session à `+0x1C0`). Par-dessus, il pose un objet de `0x58` octets (table de méthodes `0x135610`). Sans Initialize, pas de poignée de programme : l'archive est refusée.

**L'ouverture du fichier** (méthode `+0x0C` de cet objet, `0x11ec5c`, puis `0x10cd44`) :

1. Le chemin doit être binaire et faire 12 octets (`0x1166f6`), sinon `0xE0E046BE`.
2. Le premier octet du chemin choisit ce qu'on ouvre (`0x10cd04`, table de saut décodée à la main) :

| Premier octet | Accepté ? | Lecteur posé sur le fichier (`0x10ce90`) |
| --- | --- | --- |
| 0 | oui | lecteur de romfs |
| 1 | non, `0xD9004676` | (petit lecteur) |
| 2 | oui | petit lecteur |
| 3 | non, `0xE0E046BE` | (petit lecteur) |
| 4 | non, `0xF9604784` | aucun |
| 5 | oui | lecteur de romfs |
| 6 et plus | non, `0xE0E046BE` | aucun |

   Le jeu envoie 0 (`rom:`), 5 (`rom2:`) et 2 (l'icône). Pour `fs`, 0 et 5 sont traités de la même façon : la différence est faite chez Process9. Le tableau vaut tant que l'octet `+0x50` de l'objet archive est à 0, ce qu'il est à sa création ; s'il est levé, seul le type 1 est accepté. Le code du type 4 est de ceux qui arrêtent le module (fin de la partie 1) : `fsuser_OpenFile` fait ce contrôle juste après l'ouverture. Le jeu n'envoie jamais ce type.

3. `fs` envoie à Process9, sur l'archive `0x2345678E`, une requête de contrôle : `PxiArchive_Control` avec l'action `0x789D`, qui part sous l'en-tête `0x00560102`, avec les 12 octets du chemin en entrée et 16 octets en sortie.
4. Avec ces 16 octets, il interroge une table à lui (`0x119540`) et obtient 16 autres octets. Leur rôle n'est pas lu ; le fichier `/SEEDDB` cité dans la fiche `fs` est une piste.
5. Il ouvre le fichier chez Process9 (`PXIFS_OpenFile`, `0x000101C2`) avec un chemin binaire de `0x1C` octets : les 12 octets du jeu, puis les 16 de l'étape 4.
6. Il enveloppe le fichier rendu dans un objet de `0x14` octets (table `0x135578`), qui choisit son lecteur d'après le premier octet du chemin.

**Le lecteur de romfs** (objet de `0x1C4` octets, table `0x134f58`). C'est ici que la lecture reste dans `fs` :

- À la création (`0x1070b4`, puis `0x107814`), il lit `0x5C` octets à la position 0 du fichier de Process9 et vérifie qu'ils commencent par `IVFC` et que le mot suivant, décalé de 16 bits, vaut 1. Sinon `0xC8A04554`. Le fichier que rend Process9 est donc le romfs brut du programme, avec son en-tête de contrôle.
- Il monte ensuite trois étages (`0x107240`), un par niveau du romfs, chacun avec sa taille de bloc lue dans l'en-tête et son cache.
- La taille qu'il annonce (`0x1071b0`) et les positions qu'il accepte sont celles du **dernier niveau seul**. C'est ce qui s'accorde avec le jeu, qui trouve l'en-tête de `0x28` octets à la position 0.
- La lecture (`0x1071cc`) traverse les trois étages. `fs` contient sa propre fonction SHA-256 (ses constantes sont à `0x1360f0` et `0x100ccc`) : le contrôle des empreintes de chaque bloc se fait dans `fs`, pas chez Process9. Si la lecture rend `0xD9004586`, elle est refaite une fois.

**La frontière.** Process9 fait le déchiffrement et rend des blocs bruts du romfs, par `PXIFS_ReadFile` (`0x00090142`, détaillée dans la fiche `fs`, partie 6, et suivie jusqu'au matériel dans la fiche [pxi](pxi.md)). `fs` fait tout le reste : le contrôle des droits, l'en-tête `IVFC`, les empreintes, le cache, le décalage vers le dernier niveau. Une lecture du jeu peut donc donner plusieurs requêtes vers Process9 (des blocs d'empreintes et des blocs de données), ou aucune si tout est en cache.

**Pour répondre à la place de la console.** Rien de tout cela n'est à refaire. Il suffit de rendre, pour l'archive `0x00000003` et un chemin `{0, 0, 0}` ou `{5, 0, 0}`, une poignée de fichier dont le contenu est le dernier niveau du romfs voulu : dans un romfs extrait, ce qui commence par le mot `0x28`. Ni empreintes, ni chiffrement. Pour `{2, "icon", 0}`, le fichier `icon` de l'exefs.

### La sauvegarde (archive `0x00000004`)

**Côté jeu.** `0x1dfaf4` envoie OpenArchive avec l'identifiant 4 et un chemin vide (par `0x1e2698`), une seule fois : si la sauvegarde est déjà montée elle rend `0xC92044E7` sans rien envoyer. Les fichiers sont ensuite ouverts par OpenFile sur cette archive, lus et écrits par Read et Write, et la sauvegarde est validée par ControlArchive, action 0 (`0x1dfb70`). FormatSaveData (`0x1dfbcc`) est envoyée avec l'archive 4, un chemin vide et des blocs de `0x200` octets. Le jeu interroge aussi GetFormatInfo sur la même archive (`0x1e01bc`). Ces fonctions sont les étapes d'une machine à états (`0x12438c`) dont l'ordre n'a pas été suivi. À la sortie du jeu, `main` envoie SetThisSaveDataSecureValue.

**Côté module.** `0x10e03c` rouvre la même archive `0x2345678E` que pour le romfs, y ouvre chez Process9 un fichier dont le chemin binaire commence par 3, en lecture et écriture, et pose dessus un objet de `0xCDC` octets (table `0x1356a4`). Process9 ne voit donc qu'un seul gros fichier : l'arborescence de la sauvegarde, ses fichiers et ses dossiers sont gérés dans `fs`. Le contenu de cet objet n'a pas été lu.

**Pour répondre.** Un dossier du PC fait une archive `0x00000004` très convenable : OpenArchive rend une poignée, OpenFile, CreateFile, DeleteFile et les autres deviennent des opérations sur ce dossier, ControlArchive rend 0. Le format du fichier de sauvegarde de la console n'a pas à être reproduit, sauf pour relire une sauvegarde venue d'une vraie console.

### Les données supplémentaires et la carte SD

| Archive | Ouverte par | Chemin d'archive | Côté module |
| --- | --- | --- | --- |
| `0x00000006` | `0x1e193c` (appelée par `0x1dff30`) | binaire, 12 octets | `0x119b08` : ouvre l'archive `0x1234567B` chez Process9 et pose plusieurs objets dessus |
| `0x12345678` | `0x1e193c`, autre branche | binaire, 12 octets | la même fonction ; elle vérifie en plus qu'un dossier `/boss` existe |
| `0x00000007` | `0x1e25e4` (appelée par `0x1e0220`) | binaire, 12 octets | `0x10fd80`, qui saute à `0x119b08` |
| `0x00000009` | `0x1e3554` | vide | `pxi_open_archive`, directement |
| `0x567890AC` | `0x1e00d0` | vide | `pxi_open_archive`, directement |

Les 12 octets sont une structure « ExtSaveDataInfo » : le support (un octet, 1 pour la carte SD), puis l'identifiant de 64 bits. Le jeu envoie aussi CreateExtSaveData, DeleteExtSaveData et GetExtDataBlockSize. Les fonctions qui ouvrent `0x00000007`, `0x00000009` et `0x567890AC` ne sont atteintes que par une table de données : on ne sait pas quand elles servent.

## Partie 3 : les commandes de `fs:USER`

Dans les tableaux, « le jeu écrit » vient de la fonction d'envoi et, quand c'est précisé, de l'appelant ; « le module en fait » vient de l'aiguillage `fsuser_dispatch_command` et de la fonction de commande. Un mot noté « pas lu » est écrit par le jeu et ignoré par le module.

### InitializeWithSdkVersion (`0x08610042`)

Présente le programme à `fs` : sans elle, l'archive `0x00000003` est refusée.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08610042` | comparé en entier |
| 1 | `0x050200C8`, la version de son kit de développement | passé à `fsuser_Initialize` |
| 2 | `0x20` | doit valoir `0x20` |
| 3 | rien (le noyau y met le numéro du processus) | le numéro du processus, cherché dans le registre des programmes |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08610040` | |
| 1 | résultat | lu, puis ignoré par l'appelant |

- **Module.** `fsuser_Initialize` (`0x1147c8`) cherche trois fois le processus dans le registre (`0x1446f0`) : sa poignée de programme, ses informations, ses droits. Introuvable : `0xC8804465`. Sinon elle recopie le tout dans la session (`+0x190` à `+0x1C7`) et lève le drapeau `+0x188`. Si le programme est celui que le gestionnaire a noté à part (comparaison à `+0x1E28`), la priorité de la session passe à -8.
- **Pour répondre.** `0x08610040`, 0. Retenir que la session est initialisée.

### SetPriority (`0x08620040`) et GetPriority (`0x08630000`)

Règlent et relisent la priorité de la session, qui choisit le canal vers Process9 (fiche `fs`, partie 7).

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08620040` ou `0x08630000` | seul le numéro compte |
| 1 (SetPriority) | la priorité : 0 au démarrage (`fs_init`) ; une valeur reçue en argument dans `0x10eb80` | rangée à `+4` de la session |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08620040` ou `0x08630080` | |
| 1 | 0, toujours | une erreur de SetPriority au démarrage est fatale |
| 2 (GetPriority) | la priorité | choisit la classe où ranger la poignée du romfs |

- **Module.** `session_SetPriority` (`0x115150`) et `session_GetPriority` (`0x1148e4`) font une écriture et une lecture, sans aucun contrôle.
- **Pour répondre.** Garder la valeur et la rendre. Sur PC elle ne sert à rien d'autre, mais le jeu range sa poignée d'après elle : rendre 0 tant que rien n'a été réglé.

### OpenFileDirectly (`0x08030204`)

Ouvre une archive, y ouvre un fichier, referme l'archive, et rend la session du fichier.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08030204` | comparé en entier |
| 1 | 0 | passé à l'ouverture du fichier |
| 2 | l'identifiant d'archive : `0x00000003` ou `0x2345678A` | passé à `session_open_archive` |
| 3 | type du chemin d'archive : 1 (vide) ou 2 | type du chemin d'archive |
| 4 | taille du chemin d'archive : 1 ou `0x10` | pas lu |
| 5 | type du chemin de fichier : 2 (binaire) | type du chemin de fichier |
| 6 | taille du chemin de fichier : `0xC` ou `0x14` | pas lu |
| 7 | mode d'ouverture : 1 (lecture) | mode d'ouverture ; « vaut 1 » est aussi passé au contrôle des droits |
| 8 | attributs : 0 | attributs |
| 9 | `taille << 14 \| 0x802` | doit être un tampon statique n° 2 ; la taille du chemin d'archive est prise ici |
| 10 | adresse du chemin d'archive | adresse du chemin d'archive |
| 11 | `taille << 14 \| 2` | doit être un tampon statique n° 0 ; la taille du chemin de fichier est prise ici |
| 12 | adresse du chemin de fichier | adresse du chemin de fichier |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08030042` | |
| 1 | résultat | rendu à l'appelant ; négatif, c'est l'écran d'erreur pour le romfs |
| 2 | `0x10` | pas lu |
| 3 | la poignée de la session du fichier | rangée à `+4` d'un objet fichier |

- **Module.** `fsuser_OpenFileDirectly` (`0x12837c`) enchaîne `session_open_archive`, `fsuser_OpenFile` et `session_close_archive` (fiche `fs`, partie 6). Le résultat rendu est celui de l'ouverture du fichier.
- **Erreurs.** Celles d'OpenArchive et d'OpenFile.
- **Pour répondre.** Pour l'archive `0x00000003`, voir la partie 2 : le fichier est le dernier niveau d'un romfs, ou l'icône. Rendre `0x08030042`, 0, `0x10`, une poignée neuve. Cette poignée recevra ensuite les commandes de la partie 4.

### OpenArchive (`0x080C00C2`)

Ouvre une archive et rend sa poignée de 64 bits.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x080C00C2` | comparé en entier |
| 1 | l'identifiant : 3, 4, 6, 7, 9, `0x12345678` ou `0x567890AC` | passé à `session_open_archive` |
| 2 | type du chemin : 1 (vide) ou 2 (binaire) | type du chemin |
| 3 | taille du chemin : 1 ou `0xC` | pas lu |
| 4 | `taille << 14 \| 2` | doit être un tampon statique n° 0 ; la taille est prise ici |
| 5 | adresse du chemin | adresse du chemin |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x080C00C0` | |
| 1 | résultat | rendu à l'appelant |
| 2, 3 | la poignée d'archive | rangée à `+8` et `+0xC` d'un objet archive |

- **Module.** `fsuser_OpenArchive` (`0x126ba4`) appelle `session_open_archive` (`0x115684`) : `check_archive_access`, puis `fsmgr_open_archive`, puis rangement de la poignée dans la première case libre des 32 de la session, avec la priorité en cours. Pas de case libre : l'archive est refermée et le code est `0xD8604659`.
- **Erreurs.** `0xE0E046BE` (identifiant inconnu ou chemin de la mauvaise forme), les refus de droits, `0xD8604659`.
- **Pour répondre.** `0x080C00C0`, 0, et une poignée de 64 bits non nulle, à retenir avec son identifiant. Le jeu ne lui demande rien d'autre que d'être rendue telle quelle dans les commandes suivantes.

### CloseArchive (`0x080E0080`)

Referme une archive.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x080E0080` | seul le numéro compte |
| 1, 2 | la poignée d'archive | cherchée dans la table de la session |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x080E0040` | |
| 1 | résultat | rendu à l'appelant |

- **Module.** `fsuser_CloseArchive` (`0x126db4`) appelle `session_close_archive` (`0x11561c`), qui vide la case et rend l'archive au gestionnaire. Poignée absente de la table : `0xC8804465`.
- **Pour répondre.** `0x080E0040`, 0. Onze endroits du jeu l'appellent.

### OpenFile (`0x080201C2`)

Ouvre un fichier dans une archive déjà ouverte.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x080201C2` | comparé en entier |
| 1 | 0 | passé à la méthode d'ouverture de l'archive |
| 2, 3 | la poignée d'archive | doit être dans la table de la session |
| 4 | type du chemin | type du chemin |
| 5 | taille du chemin (`0x200` au plus, contrôlé par le jeu) | pas lu |
| 6 | mode d'ouverture, donné par l'appelant | passé à l'archive, et gardé dans la session du fichier (octet `+9`) |
| 7 | 0 | attributs |
| 8 | `taille << 14 \| 2` | doit être un tampon statique n° 0 ; la taille est prise ici |
| 9 | adresse du chemin | adresse du chemin |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08020042` | |
| 1 | résultat | rendu à l'appelant |
| 2 | `0x10` | pas lu |
| 3 | la poignée de la session du fichier | rangée à `+4` d'un objet fichier |

- **Module.** `fsuser_OpenFile` (`0x114d10`) : `session_get_archive_priority` (`0x11517c`), `fsmgr_open_file` (`0x115454`) qui appelle la méthode `+0x0C` de l'objet archive, `svcCreateSession`, création de l'objet de session de `0x28` octets, qui reçoit la priorité de l'archive, ajout à la liste du serveur.
- **Erreurs.** `0xC8804465`, `0xC8A044DC`, `0xD8604658`, et ce que rend l'archive (pour l'archive `0x00000003`, voir la partie 2).
- **Pour répondre.** `0x08020042`, 0, `0x10`, une poignée neuve. D'où viennent les octets dépend de l'archive : un dossier du PC pour la sauvegarde, l'exefs pour `{2, "icon", 0}`.

### OpenDirectory (`0x080B0102`)

Ouvre un dossier d'une archive pour en lister le contenu.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x080B0102` | comparé en entier |
| 1, 2 | la poignée d'archive | doit être dans la table de la session |
| 3 | type du chemin | type du chemin |
| 4 | taille du chemin | pas lu |
| 5 | `taille << 14 \| 2` | doit être un tampon statique n° 0 ; la taille est prise ici |
| 6 | adresse du chemin | adresse du chemin |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x080B0042` | |
| 1 | résultat | rendu à l'appelant |
| 2 | `0x10` | pas lu |
| 3 | la poignée de la session du dossier | rangée dans un objet dossier |

- **Module.** `fsuser_OpenDirectory` (`0x1276cc`) fait comme OpenFile : `0x10ba88` appelle la méthode `+0x18` de l'archive, puis une session de `0x14` octets (table `0x1342c8`) est créée, avec la poignée du dossier à `+0xC`.
- **Erreurs.** Les mêmes que pour OpenFile.
- **Pour répondre.** `0x080B0042`, 0, `0x10`, une poignée neuve, qui recevra les commandes de la partie 5.

### DeleteFile (`0x08040142`), DeleteDirectory (`0x08060142`), DeleteDirectoryRecursively (`0x08070142`)

Suppriment un fichier, un dossier vide, un dossier et tout ce qu'il contient. Les trois requêtes ont la même forme.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | l'en-tête | comparé en entier |
| 1 | 0 | passé à la méthode de l'archive |
| 2, 3 | la poignée d'archive | doit être dans la table de la session |
| 4 | type du chemin | type du chemin |
| 5 | taille du chemin | pas lu |
| 6 | `taille << 14 \| 2` | doit être un tampon statique n° 0 ; la taille est prise ici |
| 7 | adresse du chemin | adresse du chemin |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08040040`, `0x08060040` ou `0x08070040` | |
| 1 | résultat | rendu à l'appelant |

- **Module.** `fsuser_DeleteFile` (`0x126744`), `fsuser_DeleteDirectory` (`0x127f20`) et `fsuser_DeleteDirectoryRecursively` (`0x129cbc`) vérifient la poignée, puis `0x10be28`, `0x10c038` et `0x10c16c` appellent les méthodes `+0x20`, `+0x24` et `+0x28` de l'objet archive.
- **Erreurs.** `0xC8804465`, `0xC8A044DC`, et ce que rend l'archive.
- **Pour répondre.** L'en-tête de réponse, 0, et l'opération sur le dossier du PC qui tient lieu d'archive. Le code à rendre pour un fichier absent n'a pas été lu : il vient de l'objet « sauvegarde ».

### CreateFile (`0x08080202`)

Crée un fichier d'une taille donnée.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08080202` | comparé en entier |
| 1 | 0 | passé à la méthode de l'archive |
| 2, 3 | la poignée d'archive | doit être dans la table de la session |
| 4 | type du chemin | type du chemin |
| 5 | taille du chemin | pas lu |
| 6 | 0 | attributs |
| 7, 8 | la taille du fichier, 64 bits | taille ; si le mot 8 est négatif, `0xE0E046BC` |
| 9 | `taille << 14 \| 2` | doit être un tampon statique n° 0 ; la taille du chemin est prise ici |
| 10 | adresse du chemin | adresse du chemin |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08080040` | |
| 1 | résultat | rendu à l'appelant |

- **Module.** `fsuser_CreateFile` (`0x1265fc`), puis `0x10bddc`, qui appelle la méthode `+0x34` de l'archive.
- **Pour répondre.** `0x08080040`, 0, et un fichier de cette taille créé sur le PC.

### CreateDirectory (`0x08090182`)

Crée un dossier.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08090182` | comparé en entier |
| 1 | 0 | passé à la méthode de l'archive |
| 2, 3 | la poignée d'archive | doit être dans la table de la session |
| 4 | type du chemin | type du chemin |
| 5 | taille du chemin | pas lu |
| 6 | 0 | attributs |
| 7 | `taille << 14 \| 2` | doit être un tampon statique n° 0 ; la taille est prise ici |
| 8 | adresse du chemin | adresse du chemin |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08090040` | |
| 1 | résultat | rendu à l'appelant |

- **Module.** `fsuser_CreateDirectory` (`0x127e7c`), puis `0x10bff4`, méthode `+0x38` de l'archive.
- **Pour répondre.** `0x08090040`, 0.

### RenameFile (`0x08050244`) et RenameDirectory (`0x080A0244`)

Renomment ou déplacent un fichier, un dossier, à l'intérieur d'une même archive.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | l'en-tête | comparé en entier |
| 1 | 0 | passé à la méthode de l'archive |
| 2, 3 | la poignée de l'archive de départ | doit être dans la table de la session |
| 4 | type du chemin de départ | type du chemin de départ |
| 5 | taille du chemin de départ | pas lu |
| 6, 7 | la poignée de l'archive d'arrivée : le jeu remet la même | doit être dans la table, et désigner la même archive |
| 8 | type du chemin d'arrivée | type du chemin d'arrivée |
| 9 | taille du chemin d'arrivée | pas lu |
| 10 | `taille << 14 \| 0x402` | doit être un tampon statique n° 1 ; taille du chemin de départ |
| 11 | adresse du chemin de départ | adresse |
| 12 | `taille << 14 \| 0x802` | doit être un tampon statique n° 2 ; taille du chemin d'arrivée |
| 13 | adresse du chemin d'arrivée | adresse |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08050040` ou `0x080A0040` | |
| 1 | résultat | rendu à l'appelant |

- **Module.** `fsuser_RenameFile` (`0x1269d4`) et `fsuser_RenameDirectory` (`0x128094`) vérifient les deux poignées, puis `0x10be68` et `0x10c078` refusent une poignée nulle (`0xE0E046BE`) et deux archives différentes (`0xE0C046F8`), et appellent les méthodes `+0x3C` et `+0x40`.
- **Pour répondre.** L'en-tête de réponse, 0, et un renommage sur le PC.

### ControlArchive (`0x080D0144`)

Demande une action particulière à une archive. Le jeu ne l'envoie qu'avec l'action 0 sur la sauvegarde : valider ce qui a été écrit.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x080D0144` | comparé en entier |
| 1, 2 | la poignée d'archive | doit être dans la table de la session |
| 3 | l'action : 0 | passée à la méthode `+0x14` de l'archive |
| 4 | taille d'entrée : 1 | pas lu |
| 5 | taille de sortie : 1 | pas lu |
| 6 | `taille << 4 \| 0xA` | doit être un tampon à lire ; la taille d'entrée est prise ici |
| 7 | adresse du tampon d'entrée | adresse |
| 8 | `taille << 4 \| 0xC` | doit être un tampon à écrire ; la taille de sortie est prise ici |
| 9 | adresse du tampon de sortie | adresse |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x080D0044` | |
| 1 | résultat | rendu à l'appelant |
| 2 à 5 | les mots 6 à 9 de la requête, recopiés | pas lus |

- **Module.** `fsuser_ControlArchive` (`0x127958`), puis `0x10c24c`, méthode `+0x14`. Pour une archive tenue par Process9, `PxiArchive_Control` (`0x105f2c`) ne connaît que l'action 1 (sortie de 8 octets, requête `0x004800C2`), l'action `0x789D` (entrée de 12 octets, sortie de 16, requête `0x00560102`) et, pour toute autre action, la requête `0x001500C0`, à condition qu'aucun tampon ne soit donné, sinon `0xE0C046F8`. La sauvegarde n'est pas une archive de ce genre : son action 0 est traitée par l'objet de `0xCDC` octets, non lu.
- **Pour répondre.** `0x080D0044`, 0, et les quatre mots recopiés. Sur PC, « valider » revient à s'assurer que les fichiers sont écrits sur le disque.

### GetFreeBytes (`0x08120080`)

Demande la place libre d'une archive.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08120080` | seul le numéro compte |
| 1, 2 | la poignée d'archive | doit être dans la table de la session |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x081200C0` | |
| 1 | résultat | rendu à l'appelant |
| 2, 3 | la place libre, 64 bits | recopiée chez l'appelant |

- **Module.** `fsuser_GetFreeBytes` (`0x126dec`), puis `0x10bf60`, méthode `+0x50` de l'archive.
- **Pour répondre.** `0x081200C0`, 0, un nombre d'octets confortable. L'unité (octets) vient du nom de la commande, pas du code.

### SetArchivePriority (`0x085A00C0`) et GetArchivePriority (`0x085B0080`)

Règlent et relisent la priorité d'une archive ouverte.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x085A00C0` ou `0x085B0080` | seul le numéro compte |
| 1, 2 | la poignée d'archive | cherchée dans la table de la session |
| 3 (Set) | la priorité | rangée dans la case de l'archive |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x085A0040` ou `0x085B0080` | |
| 1 | résultat | rendu à l'appelant |
| 2 (Get) | la priorité | recopiée chez l'appelant |

- **Module.** `fsuser_SetArchivePriority` (`0x128ba0`) et `fsuser_GetArchivePriority` (`0x1288d4`) ne font qu'une recherche dans la table. Poignée absente : `0xC8804465`. Les fichiers et dossiers ouverts ensuite dans l'archive héritent de cette priorité.
- **Pour répondre.** Garder la valeur par archive et la rendre.

### IsSdmcDetected (`0x08170000`) et IsSdmcWritable (`0x08180000`)

Disent si une carte SD est présente, et si on peut y écrire.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08170000` ou `0x08180000` | seul le numéro compte |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08170080` ou `0x08180080` | |
| 1 | résultat | IsSdmcDetected : négatif, c'est l'écran d'erreur (`0x1dfc48`) |
| 2 | un octet, 0 ou 1 ; les trois autres octets ne sont pas écrits | lu sur un octet |

- **Module.** `fsuser_IsSdmcDetected` (`0x127cb4`) et `fsuser_IsSdmcWritable` (`0x127d18`) prennent un canal, envoient à Process9 `PXIFS_IsSdmcDetected` (`0x001C0000`) ou `PXIFS_IsSdmcWritable` (`0x001D0000`), et rendent le canal. Aucun contrôle de droits.
- **Pour répondre.** 0 et l'octet 1 : il y a une carte, on peut y écrire. IsSdmcWritable n'est atteinte que par une fonction qu'un `.cro` importe.

### GetArchiveResource (`0x08490040`)

Demande la taille et la place libre d'un support.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08490040` | seul le numéro compte |
| 1 | le support : 2 (`0x1e0138`) | 0, 1, 2 ou 3 ; autre valeur : `0xE0C046F8` |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08490140` | |
| 1 | résultat | rendu à l'appelant |
| 2 à 5 | quatre mots rendus par Process9 | le jeu multiplie le mot 3 par le mot 4, puis par le mot 5, et rend les deux produits de 64 bits |

- **Module.** `fsuser_GetArchiveResource` (`0x128904`) compare les droits du programme (session `+0x1B8`) à un masque qui dépend du support : `0x121007` pour 0, `0x2004` pour 1, aucun contrôle pour 2, `0x1024` pour 3. Sans le droit : `0xD9004676`. Puis `PXIFS_GetArchiveResource` (`0x00430040`).
- **Pour répondre.** D'après l'usage qu'en fait le jeu, le mot 3 est une taille d'unité et les mots 4 et 5 des nombres d'unités : très probablement le total, puis le libre. Rendre par exemple `0x200`, `0x1000`, un total et un libre. Le sens du mot 2 n'est pas lu.

### GetFormatInfo (`0x084500C2`)

Demande avec quels réglages une archive a été formatée.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x084500C2` | comparé en entier |
| 1 | l'identifiant d'archive : 4 (`0x1e01bc`) ou 6 (`0x1e0290`) | choisit la branche |
| 2 | type du chemin : 1 pour l'archive 4, 2 pour l'archive 6 | doit valoir 1 pour l'archive 4, 2 pour 6, 7 et 8 |
| 3 | taille du chemin : 1 ou `0xC` | pas lu |
| 4 | `taille << 14 \| 2` | doit être un tampon statique n° 0 ; la taille est prise ici (`0xC` exigé pour 6 et 7, 8 pour l'archive 8) |
| 5 | adresse du chemin | adresse |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08450140` | |
| 1 | résultat ; tout résultat positif est ramené à 0 | rendu à l'appelant |
| 2 | taille totale | recopié |
| 3 | nombre de dossiers | recopié |
| 4 | nombre de fichiers | recopié |
| 5 | un octet (données en double ou non) ; les trois autres octets ne sont pas écrits | lu sur un octet |

- **Module.** `fsuser_GetFormatInfo` (`0x126e78`) trie sur l'identifiant : 4, 6, 7, 8, `0x567890B1`, `0x567890B2`. Les fonctions appelées ensuite (`0x10e134` pour la sauvegarde, `0x10fc80` et `0x10fd74` pour les données supplémentaires) ne sont pas lues. Le nom des mots 2 à 5 vient de 3dbrew.
- **Erreurs.** `0xE0E046BE`, `0xD9004676`, `0xE0C046F8`, `0xF9604784`, `0xE7E3FFFF`.
- **Pour répondre.** Les valeurs données au formatage. Ce que le jeu fait d'une erreur ici (formater ?) n'a pas été suivi.

### FormatSaveData (`0x084C0242`)

Efface et recrée la sauvegarde du jeu.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x084C0242` | comparé en entier |
| 1 | l'identifiant d'archive : 4 | 4 ou `0x567890B2`, sinon `0xE0E046BE` |
| 2 | type du chemin : 1 (vide) | doit valoir 1 pour l'archive 4 |
| 3 | taille du chemin : 1 | pas lu |
| 4 | taille d'un bloc : `0x200` | passé au formatage |
| 5 | nombre de dossiers, donné par l'appelant | passé |
| 6 | nombre de fichiers, donné par l'appelant | passé |
| 7 | nombre de cases de la table de hachage des dossiers, calculé par le jeu | passé |
| 8 | la même chose pour les fichiers | passé |
| 9 | un octet : garder les données en double | passé sous la forme « différent de 0 » |
| 10 | `taille << 14 \| 2` | doit être un tampon statique n° 0 |
| 11 | adresse du chemin | adresse |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x084C0040` | |
| 1 | résultat ; tout résultat positif est ramené à 0 | rendu à l'appelant |

- **Module.** `fsuser_FormatSaveData` (`0x127ab4`) appelle `0x1150c0` pour l'archive 4. Non lue.
- **Pour répondre.** Vider le dossier qui tient lieu de sauvegarde, retenir les réglages pour GetFormatInfo, rendre 0.

### CreateExtSaveData (`0x08510242`)

Crée un espace de données supplémentaires, avec son icône.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08510242` | comparé en entier |
| 1 à 3 | une structure de 12 octets : le support, l'identifiant de 64 bits | recopiée, passée par adresse |
| 4 | 0 | pas lu |
| 5 | nombre de dossiers | passé |
| 6 | nombre de fichiers | passé |
| 7, 8 | la taille maximale : `0xFFFFFFFF`, `0xFFFFFFFF` | passés |
| 9 | taille de l'icône | pas lu |
| 10 | `taille << 4 \| 0xA` | doit être un tampon à lire ; la taille de l'icône est prise ici |
| 11 | adresse de l'icône | adresse |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08510042` | |
| 1 | résultat | rendu à l'appelant |
| 2, 3 | les mots 10 et 11 de la requête, recopiés | pas lus |

- **Module.** `fsuser_CreateExtSaveData` (`0x114b94`) a deux branches. Si le mot 3 vaut `0x48000` (la moitié haute des identifiants de données partagées, d'après 3dbrew), il faut un des droits `0x101005`. Sinon le support doit être différent de 0, et le programme doit être propriétaire de l'identifiant (`0x1154f8`) ou avoir un des droits `0xC`. Dans tous les autres cas : `0xD9004676`. Le travail est fait par `0x10f830` ou `0x10f2cc`, non lues.
- **Pour répondre.** Créer un dossier, y ranger l'icône, rendre 0 et les deux mots recopiés.

### DeleteExtSaveData (`0x08520100`)

Supprime un espace de données supplémentaires.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08520100` | seul le numéro compte |
| 1 à 3 | la structure de 12 octets ; le jeu met 1 (carte SD) dans le support | recopiée, passée par adresse |
| 4 | 0 | pas lu |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08520040` | |
| 1 | résultat | rendu à l'appelant |

- **Module.** `fsuser_DeleteExtSaveData` (`0x114ad8`) : mêmes contrôles de droits (masques `0x101005` et `0x10100D`), puis `0x118532`, non lue.
- **Pour répondre.** `0x08520040`, 0.

### GetExtDataBlockSize (`0x08540100`)

Demande la taille, en blocs, d'un espace de données supplémentaires. L'écart d'en-tête est traité en partie 6.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08540100` | seul le numéro compte |
| 1 à 3 | la structure de 12 octets ; dans `0x1e0330`, le mot 3 vaut `0x00048000` | recopiée, passée par adresse |
| 4 | 0 | pas lu |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08540180` | |
| 1 | résultat | rendu à l'appelant |
| 2, 3 | nombre total de blocs, 64 bits | recopié |
| 4, 5 | nombre de blocs libres, 64 bits | recopié |
| 6 | taille d'un bloc | recopié |

- **Module.** `fsuser_GetExtDataBlockSize` (`0x114a40`) : le programme doit être propriétaire ou avoir un des droits `0x10100D`, sinon `0xD9004676`. Puis `0x10f85c`, non lue. Le nom des trois valeurs vient de 3dbrew ; leur place dans la réponse est lue dans l'aiguillage.
- **Pour répondre.** `0x08540180`, 0, et trois valeurs cohérentes.

### SetThisSaveDataSecureValue (`0x086E00C0`) et GetThisSaveDataSecureValue (`0x086F0040`)

Écrivent et relisent une valeur de 64 bits rangée hors de la sauvegarde, qui sert à détecter une sauvegarde remise en arrière.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x086E00C0` ou `0x086F0040` | seul le numéro compte |
| 1 | le numéro de case : `0x1000` | passé |
| 2, 3 (Set) | la valeur, 64 bits | passée |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x086E0040` ou `0x086F0140` | |
| 1 | résultat | négatif : le jeu appelle `0x146c14`, qui ne revient pas |
| 2 (Get) | un octet : une valeur existe | lu sur un octet |
| 3 (Get) | un octet : le programme est sur une cartouche | lu sur un octet |
| 4, 5 (Get) | la valeur | comparée à celle que le jeu attend |

- **Module.** `fsuser_SetThisSaveDataSecureValue` (`0x129df0`) et `fsuser_GetThisSaveDataSecureValue` (`0x129d4c`) passent le support et l'identifiant du programme (pris dans la session) à `0x11984c` et `0x1198cc`. L'octet du mot 3 est mis à 1 quand le support du programme vaut 2. Sur une cartouche, un échec de lecture donne « pas de valeur » et un résultat 0. Où la valeur est rangée n'est pas lu.
- **Côté jeu.** `0x1e03a0` rend « faux » dans un seul cas : pas sur cartouche, une valeur existe, et elle diffère de celle attendue.
- **Pour répondre.** Garder la valeur dans un fichier à côté de la sauvegarde. Pour une première fois : 0, octet 0 (pas de valeur), octet 0.

## Partie 4 : les commandes d'un fichier ouvert

Elles sont envoyées sur la poignée rendue par OpenFile, OpenFileDirectly, OpenSubFile ou OpenLinkFile. Côté module, l'aiguillage est `fsfile_dispatch_command` (`0x12ae2c`) et la session un objet de `0x28` octets (fiche `fs`, partie 9) : le mode d'ouverture à `+9`, un bloc partagé à `+0x14` (la poignée du fichier chez le gestionnaire, un compteur d'utilisateurs, un verrou), la position de départ de la fenêtre à `+0x18` et sa taille à `+0x20` (-1 pour le fichier entier).

**Le mode d'ouverture** est contrôlé d'une façon inattendue, lue dans l'assembleur des quatre fonctions. Le bit 0 est la lecture, le bit 1 l'écriture ; le bit 3 n'est pas décrit par la Carte.

| Commande | Refusée (`0xD9004676`) quand |
| --- | --- |
| Read | le bit 0 est à 0 **et** le bit 3 à 1 |
| Write, SetSize | le bit 1 est à 0 **et** le bit 3 à 1 |
| GetAvailable | le bit 0 est à 0 **et** le bit 3 à 0 |

Un fichier ouvert sans le bit 3 se lit et s'écrit donc quel que soit son mode. Le jeu ouvre son romfs avec le mode 1 : tout passe.

### Read (`0x080200C2`)

Lit des octets à une position.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x080200C2` | comparé en entier |
| 1, 2 | la position, 64 bits | position dans la fenêtre |
| 3 | la taille | pas lu |
| 4 | `taille << 4 \| 0xC` | doit être un tampon à écrire ; la taille est prise ici |
| 5 | adresse du tampon | adresse où écrire |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08020082` | |
| 1 | résultat | rendu à l'appelant |
| 2 | nombre d'octets lus | recopié chez l'appelant ; pour l'en-tête du romfs, il doit valoir `0x28` |
| 3, 4 | les mots 4 et 5 de la requête, recopiés | pas lus |

- **Module.** `fsfile_Read` (`0x11541c`) contrôle le mode, puis `file_session_read` (`0x1144f8`) prend le verrou, ramène la taille à celle de la fenêtre si elle la dépasse (la position n'entre pas dans ce calcul), ajoute la position de départ de la fenêtre, et appelle `fsmgr_read_file` (`0x114458`), qui appelle la méthode `+0x08` de l'objet fichier. Une taille de 0 rend 0 octet sans rien appeler. Si le tampon et la position ne sont pas alignés de la même façon sur 4 octets et que la taille dépasse `0x100`, la lecture est faite en deux morceaux.
- **Erreurs.** `0xD9004676`, `0xC8A044DC`, et ce que rend le lecteur (`0xD9004586` pour un romfs).
- **Pour répondre.** `0x08020082`, 0, le nombre d'octets copiés dans le tampon, et les deux mots recopiés. Lire au-delà de la fin doit rendre moins d'octets que demandé, pas une erreur : c'est ce que suppose GetAvailable, qui s'arrête quand une lecture rend 0.

### Close (`0x08080000`)

Referme le fichier.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08080000` | seul le numéro compte |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08080040` | |
| 1 | 0, toujours | pas regardé par la méthode de fermeture |

- **Module.** `fsfile_Close` (`0x1152ac`) : si la session n'est pas déjà marquée fermée (octet `+8`), elle rend le fichier au gestionnaire quand elle en est la dernière utilisatrice (`0x119cdc`), sinon elle décompte. La session elle-même n'est détruite que plus tard (`0x12efac`), quand le jeu ferme sa poignée et que le fil de service le voit.
- **Côté jeu.** La méthode de fermeture (`0x1e1f18`) envoie Close, puis ferme la poignée par l'appel système CloseHandle.
- **Pour répondre.** `0x08080040`, 0, et libérer le fichier quand la poignée est fermée.

### OpenLinkFile (`0x080C0000`)

Rend une seconde session sur le même fichier. Le jeu s'en sert pour avoir une poignée du romfs par classe de priorité.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x080C0000` | seul le numéro compte |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x080C0042` | |
| 1 | résultat | rendu à l'appelant |
| 2 | `0x10` | pas lu |
| 3 | la poignée de la nouvelle session | rangée dans un objet fichier |

- **Module.** `fsfile_OpenLinkFile` (`0x12e764`) demande au gestionnaire un double du fichier (`0x10b870`, qui appelle la méthode `+0x4C` de l'archive d'origine), crée une paire de sessions et un objet de `0x28` octets avec le même mode d'ouverture, sur le fichier entier. La nouvelle session garde aussi un lien vers le bloc de la première (`+0x10`).
- **Erreurs.** `0xC8A044DC`, `0xD8604658`.
- **Pour répondre.** `0x080C0042`, 0, `0x10`, une poignée neuve qui lit le même contenu.

### SetPriority (`0x080A0040`) et GetPriority (`0x080B0000`)

Comme sur `fs:USER`, pour ce seul fichier.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x080A0040` ou `0x080B0000` | seul le numéro compte |
| 1 (Set) | la priorité | rangée à `+4` de la session |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x080A0040` ou `0x080B0080` | |
| 1 | 0, toujours | rendu à l'appelant |
| 2 (Get) | la priorité | recopiée |

- **Module.** `session_SetPriority` et `session_GetPriority`, les mêmes fonctions que pour `fs:USER`. À l'ouverture, un fichier reçoit la priorité de son archive.
- **Pour répondre.** Garder la valeur, rendre 0.

### GetSize (`0x08040000`)

Demande la taille du fichier.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08040000` | seul le numéro compte |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x080400C0` | |
| 1 | résultat | rendu à l'appelant |
| 2, 3 | la taille, 64 bits | recopiée |

- **Module.** `fsfile_GetSize` (`0x12ee78`) : pour une fenêtre, la taille de la fenêtre ; pour un fichier entier, `0x10bee0`, qui appelle la méthode `+0x10` de l'objet fichier (pour un romfs, la taille du dernier niveau).
- **Pour répondre.** `0x080400C0`, 0, la taille.

### OpenSubFile (`0x08010100`)

Rend une session limitée à une tranche du fichier.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08010100` | seul le numéro compte |
| 1, 2 | la position de départ, 64 bits | début de la fenêtre |
| 3, 4 | la taille, 64 bits | taille de la fenêtre |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08010042` | |
| 1 | résultat | rendu à l'appelant |
| 2 | `0x10` | pas lu |
| 3 | la poignée de la nouvelle session | recopiée |

- **Module.** `fsfile_OpenSubFile` (`0x12e2f8`) refuse une session qui est déjà une fenêtre (`0xE0C046F8`), une position ou une taille négative, et une fenêtre qui dépasse la fin du fichier (`0xE0E046C1`). La nouvelle session partage le fichier de la première.
- **Pour répondre.** `0x08010042`, 0, `0x10`, une poignée dont les lectures sont décalées de la position de départ.

### GetAvailable (`0x0C010100`)

Dit combien d'octets sont lisibles à partir d'une position, dans la limite d'une taille.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x0C010100` | seul le numéro compte |
| 1, 2 | la position, 64 bits | position de départ |
| 3, 4 | la taille, 64 bits | nombre d'octets à essayer |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x0C0100C0` | |
| 1 | résultat | rendu à l'appelant |
| 2, 3 | le nombre d'octets lisibles, 64 bits | recopié |

- **Module.** `fsfile_GetAvailable` (`0x12ed14`) **lit réellement les données** : elle prend un tampon de travail (`0x10000` octets, ou la moitié tant que la mémoire manque, jusqu'à `0x1000`) et appelle `file_session_read` en boucle jusqu'à la taille demandée ou jusqu'à une lecture vide, en additionnant. Pour un romfs, cela fait donc passer toute la tranche par le contrôle des empreintes.
- **Erreurs.** `0xD9004676` (voir le tableau du mode d'ouverture), `0xD8604659`.
- **Pour répondre.** `0x0C0100C0`, 0, et le plus petit de « taille demandée » et « taille du fichier moins position ».

### Write (`0x08030102`)

Écrit des octets à une position.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08030102` | comparé en entier |
| 1, 2 | la position, 64 bits | position |
| 3 | la taille | pas lu |
| 4 | une option : l'octet reçu, recopié aussi dans les bits 16 à 23 ; `0x10001` pour « vider » | voir ci-dessous |
| 5 | `taille << 4 \| 0xA` | doit être un tampon à lire ; la taille est prise ici |
| 6 | adresse des données | adresse |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08030082` | |
| 1 | résultat ; tout résultat positif est ramené à 0 | rendu à l'appelant |
| 2 | nombre d'octets écrits | recopié |
| 3, 4 | les mots 5 et 6 de la requête, recopiés | pas lus |

- **Module.** `fsfile_Write` (`0x12eb4c`) contrôle le mode, refuse une fenêtre (`0xE0C046F8`), puis appelle `0x1144a8`, méthode `+0x0C` de l'objet fichier. Si le bit 24 de l'option est à 1, l'option est passée telle quelle avec les données. Sinon les données sont écrites sans option, puis, si l'octet du bas ou l'octet des bits 16 à 23 n'est pas nul, un second appel de taille 0 porte l'option : c'est ce second appel qui force l'écriture sur le support.
- **Côté jeu.** Deux méthodes : l'écriture (`0x1e2050`) et « vider » (`0x1e1fc8`), un Write de taille 0 et d'option `0x10001`. Les deux côtés s'accordent sur ce sens.
- **Pour répondre.** `0x08030082`, 0, la taille écrite, les deux mots recopiés.

### SetSize (`0x08050080`)

Change la taille du fichier.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08050080` | seul le numéro compte |
| 1, 2 | la nouvelle taille, 64 bits | passée à l'objet fichier |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08050040` | |
| 1 | résultat | rendu à l'appelant |

- **Module.** `fsfile_SetSize` (`0x12ef00`) : contrôle du mode comme pour l'écriture, refus d'une fenêtre (`0xE0C046F8`), puis `0x10bf1c`, méthode `+0x14` de l'objet fichier. Un fichier de l'archive `0x00000003` rend `0xE0C046F8` (`0x10cfd0`).
- **Pour répondre.** `0x08050040`, 0.

## Partie 5 : les commandes d'un dossier ouvert

Elles sont envoyées sur la poignée rendue par OpenDirectory. Aiguillage : `fsdir_dispatch_command` (`0x12b2a0`). La session fait `0x14` octets, avec la poignée du dossier à `+0xC`.

### Read (`0x08010042`)

Lit les entrées suivantes du dossier.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | `0x08010042` | comparé en entier |
| 1 | le nombre d'entrées voulu | pas lu |
| 2 | `nombre × 0x228 << 4 \| 0xC` | doit être un tampon à écrire ; le nombre d'entrées est recalculé ici : taille divisée par `0x228` |
| 3 | adresse du tampon | adresse |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08010082` | |
| 1 | résultat | rendu à l'appelant |
| 2 | nombre d'entrées écrites | recopié |
| 3 | `nombre calculé × 0x228 << 4 \| 0xC` | pas lu |
| 4 | le mot 3 de la requête | pas lu |

- **Module.** `fsdir_Read` (`0x1264e0`), puis `0x10bf9c`, qui appelle la méthode `+0x08` de l'objet dossier (pour un dossier tenu par Process9 : `PxiDirectory_Read`, requête `0x001000C2`).
- **Pour répondre.** Les deux côtés s'accordent sur une entrée de `0x228` octets ; son contenu n'est lu ni dans le jeu ni dans le module. La Carte renvoie à 3dbrew pour sa forme. Rendre moins d'entrées que demandé, puis 0, quand le dossier est épuisé.

### Close (`0x08020000`), SetPriority (`0x08030040`), GetPriority (`0x08040000`)

Referment le dossier, règlent et relisent sa priorité.

| Mot | Le jeu écrit | Le module en fait |
| --- | --- | --- |
| 0 | l'en-tête | seul le numéro compte |
| 1 (SetPriority) | la priorité | rangée à `+4` de la session |

| Mot | Le module écrit | Le jeu en fait |
| --- | --- | --- |
| 0 | `0x08020040`, `0x08030040` ou `0x08040080` | |
| 1 | résultat | rendu à l'appelant |
| 2 (GetPriority) | la priorité | recopiée |

- **Module.** `fsdir_Close` (`0x126534`) rend le dossier au gestionnaire (`0x119c70`) et met sa poignée à zéro ; un second Close rend 0 sans rien faire. La session est détruite par `0x126590` quand le jeu ferme sa poignée.
- **Pour répondre.** L'en-tête de réponse et 0.

## Partie 6 : l'écart sur GetExtDataBlockSize

La Carte des services et la fiche `fs` donnent l'en-tête `0x08540010`. Le jeu écrit `0x08540100` (`0x1e2e38`). Les deux portent le numéro `0x0854`.

**Ce que le module vérifie : le numéro, et rien d'autre.** L'aiguillage a été exécuté avec cinq en-têtes (`0x08540100`, `0x08540010`, `0x08540000`, `0x0854FFFF`, `0x08540042`) : dans les cinq cas il appelle `fsuser_GetExtDataBlockSize` (`0x114a40`) avec les mêmes arguments et répond `0x08540180`. Il lit les mots 1, 2 et 3 de la requête, les recopie dans une structure de 12 octets, et ne touche pas au mot 4.

**Lequel est juste ?** Un en-tête dit combien de mots suivent : `0x08540100` annonce 4 mots ordinaires, `0x08540010` annonce 0 mot ordinaire et 16 mots de traduction. La Carte décrit elle-même la requête comme « mots 1 à 4 : ExtSaveDataInfo », ce qui correspond à `0x08540100`. La commande voisine DeleteExtSaveData, qui porte la même structure, a l'en-tête `0x08520100` dans la Carte comme dans le jeu. Tout indique donc que `0x08540010` est une coquille de la source, recopiée dans la fiche `fs` (dont la colonne « En-tête de requête » vient de 3dbrew, pas du code). La console, elle, accepte les deux. Ce document ne corrige ni la Carte ni la fiche `fs`.

## Les désaccords trouvés

| Sujet | Ce que dit l'un | Ce que dit l'autre |
| --- | --- | --- |
| En-tête de GetExtDataBlockSize | Carte et fiche `fs` : `0x08540010` | jeu : `0x08540100` ; module : ne regarde que le numéro (partie 6) |
| Taille des chemins | Carte : un mot « taille du chemin » fait partie de la requête | module : ce mot n'est jamais lu, la taille vient du descripteur |
| Nombre d'entrées d'un dossier | Carte : le mot 1 de Read est le nombre d'entrées | module : il recalcule ce nombre d'après la taille du tampon |
| ExtSaveDataInfo | Carte : 4 mots | module : 3 mots recopiés ; jeu : le quatrième vaut toujours 0 |
| Rôle de `fs` | fiche `fs`, introduction : « il ne touche lui-même à aucun support », il vérifie les droits et transmet | pour le romfs, `fs` lit l'en-tête `IVFC` et contrôle les empreintes ; pour la sauvegarde, il pose son propre objet sur un seul fichier de Process9 |
| Archive `0x00000003` | fiche `fs`, partie 6 : « posé sur une archive de Process9 », sans dire laquelle | c'est l'archive `0x2345678E`, ouverte avec la poignée de programme ; la fiche la classe « réservée à `fs:LDR` » pour les clients, ce qui reste vrai |
| Booléens de réponse | Carte : un octet | module : il n'écrit qu'un octet, les trois autres gardent un reste de la requête ; le jeu ne lit qu'un octet. Pas de contradiction, mais un mot entier comparé à 1 serait faux |
| Table de commandes rendue par l'outil | `emulate_dispatch.py`, fichier `local/analyse/fs/emulate_dispatch_0x12b4fc.txt` : `0x0801` et `0x0861` « dans l'aiguillage », refusées | pseudo-code de l'aiguillage et exécution avec la requête du jeu : les deux appellent `fsuser_Initialize`, comme le dit la fiche `fs` |

Aucun désaccord entre le jeu et le module sur la forme d'un message : la requête que le jeu fabrique est acceptée telle quelle par l'aiguillage pour les 43 commandes.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les mots de chaque requête : relevés dans les 43 fonctions d'envoi du jeu, exécutées dans un émulateur avec un argument changé à la fois, puis donnés tels quels à l'aiguillage de `fs` exécuté de la même façon. L'aiguillage les accepte tous et appelle la fonction que donne la fiche `fs`.
- Les mots de chaque réponse : écrits par l'aiguillage (résultat, sorties de la fonction, mots recopiés), et relus par le jeu aux mêmes places.
- Les valeurs réelles de la partie 2 et des rubriques (identifiants d'archive, chemins, modes) : relevées en exécutant la fonction appelante du jeu jusqu'à son appel système, et relues dans le pseudo-code ou l'assembleur de cette fonction.
- L'en-tête de `0x28` octets : le jeu l'exige à la position 0 de ce qu'il lit, et le lecteur de `fs` n'expose que le dernier niveau du romfs.
- L'écriture de taille 0 qui force l'écriture sur le support : vue dans la méthode « vider » du jeu et dans `fsfile_Write`.
- La limite de `0x200` octets d'un chemin : contrôlée dans le jeu, et taille des tampons de `fs` d'après sa fiche.
- La réponse sur GetExtDataBlockSize : pseudo-code de l'aiguillage (aucune comparaison de l'en-tête) et exécution avec cinq en-têtes.
- Les tables de saut du type de chemin de l'archive `0x00000003` : décodées à la main sur les octets, et cohérentes avec le pseudo-code de Ghidra.

**Interprété à la lecture, à relire dans Ghidra**
- Tout le corps des fonctions du module décrit en une phrase : il vient du pseudo-code de Ghidra, lu une fois. Les seuls passages recoupés avec l'assembleur sont le contrôle du mode d'ouverture (Read, Write, SetSize, GetAvailable) et la limite de taille dans Read.
- Le sens de chaque code d'erreur, donné d'après l'endroit où il est rendu.
- Le lecteur de romfs : les trois étages et leurs caches sont déduits des arguments de `0x107240`. Que les empreintes soient calculées dans `fs` repose sur la présence des constantes SHA-256 dans le module et sur le code `0xD9004586` qui déclenche une seconde lecture ; l'appel de la fonction de hachage depuis ces étages n'a pas été suivi.
- Les 16 octets ajoutés au chemin envoyé à Process9 (étape 4 de l'ouverture) : leur rôle est supposé.
- « `rom2:` est le romfs de la mise à jour, `rom:` celui du jeu d'origine » : une déduction, pas une preuve.
- La sauvegarde vue comme « un seul fichier chez Process9 et une arborescence dans `fs` » : déduit de `0x10e03c` et de `0x118ed0`, quelques lignes chacune.
- Le sens des quatre mots de GetArchiveResource : « une taille d'unité et deux nombres d'unités » est déduit des multiplications du jeu, « total puis libre » est supposé.
- Les noms des valeurs de réponse de GetFormatInfo et de GetExtDataBlockSize, repris de la Carte.
- Les conseils « pour répondre » : ce sont des propositions. Aucune n'a été essayée.

**Pas lu**
- Ce que font, dans `fs`, l'objet « sauvegarde » (`0xCDC` octets, table `0x1356a4`) et les objets des données supplémentaires : ouverture d'un fichier, création, suppression, validation, formatage. Les codes d'erreur d'un fichier absent ou d'un fichier déjà présent ne sont donc pas connus, alors que le jeu peut en dépendre.
- Les fonctions du module derrière les 7 commandes marquées « contrôles » : `0x10e134`, `0x1150c0`, `0x10f830`, `0x10f2cc`, `0x118532`, `0x10f85c`, `0x11984c`, `0x1198cc`.
- `check_archive_access` et `archive_permission_check` : quels droits du programme ouvrent quelle archive. Les masques relevés dans les rubriques (`0x121007`, `0x10100D`…) ne sont pas décodés.
- Côté jeu, ce qui se passe au-dessus des fonctions d'envoi en dehors du démarrage : la machine à états de la sauvegarde (`0x12438c`), les appelantes de `0x1333e8` (archive `0x2345678A`), l'usage des dossiers, et tout ce qui n'est atteint que par une table ou par un `.cro`.
- La forme d'une entrée de dossier (`0x228` octets) et celle de la structure de 16 octets du chemin de l'archive `0x2345678A`.
- Deux méthodes de l'objet fichier du jeu (`0x1e1e80`, `0x1e1f0c`).
- Le découpage des lectures en morceaux vers Process9 (`PxiFile_Read`) et le choix du canal : voir la fiche `fs`.
- Rien n'a été observé sur une console ou dans un émulateur de 3DS : l'ordre réel des commandes au-delà du démarrage reste à voir en regardant le jeu tourner.

## Comment ce document a été fait

| Étape | Qui | Durée |
| --- | --- | --- |
| Relever les mots de chaque requête et l'usage de chaque réponse, côté jeu | `trace_senders.py` : chaque fonction d'envoi exécutée dans unicorn, un argument changé à la fois | quelques secondes |
| Relever ce que l'aiguillage du module fait de chaque mot | `trace_dispatch.py` : la requête du jeu donnée à l'aiguillage de `fs`, arrêt à l'entrée de la fonction de commande, retour simulé avec des marques dans les sorties | une minute |
| Relever les valeurs réelles aux endroits d'appel du jeu | `callsite.py` : la fonction appelante exécutée jusqu'à l'appel système, les autres appels sautés | quelques secondes par endroit |
| Trouver les appelants et les méthodes des objets du jeu | `callers.py` et `vt_scan.py`, sur `refs.tsv` de Ghidra et un balayage des `bl` | immédiat |
| Lire le corps des fonctions | Claude, sur le pseudo-code déjà produit (`local/analyse/fs/gh/` et `local/analyse/maj/gh/`), avec `show.py` qui remplace chaque constante par sa valeur | le gros du temps |
| Lire l'assembleur là où le pseudo-code ne suffit pas | l'objdump de devkitPro, en ARM et en Thumb | à la demande |
| Comparer à 3dbrew | `carte3.py`, sur `donnees.js` de la Carte des services | immédiat |

Aucune analyse n'a été relancée : ni `ghidra_direct.py`, ni le pont REA. Tous les scripts et leurs sorties sont dans `local/analyse/contrat-fs/` (non versionné) : `senders.txt` (côté jeu), `dispatch.txt` (côté module), `carte.txt` (ce que dit la Carte), `check_854.py` (l'essai des cinq en-têtes).

**Les pièges rencontrés.**

- **Le pseudo-code perd les arguments passés sur la pile.** Dans l'aiguillage de `fs`, une commande comme OpenFile passe sept valeurs sur la pile : Ghidra n'en montre que quatre. Exécuter l'aiguillage et lire la pile à l'entrée de la fonction donne la correspondance sans ambiguïté.
- **Une valeur de 64 bits décale les arguments.** Quand une poignée d'archive suit un seul mot, le compilateur saute un registre pour l'aligner : le registre sauté contient un reste, qui ressemble à un argument et n'en est pas un.
- **Un marqueur dont l'octet du bas vaut 0 cache les écritures d'un octet.** C'est en changeant les marques de sortie que les booléens écrits sur un seul octet sont apparus.
- **Une garde locale arrête l'émulation avant l'envoi.** Les méthodes d'archive du jeu refusent un chemin de plus de `0x200` octets ; avec des marques en guise de taille, aucune requête ne partait. Il a fallu poser une taille plausible en mémoire (`callsite.py --poke`).
- **Ghidra fond certaines fonctions du jeu dans leur appelant** (`0x13368c`, par exemple) : pas de pseudo-code, il faut l'assembleur.
- **`emulate_dispatch.py` ne trouve pas Initialize ni InitializeWithSdkVersion** sur l'aiguillage de `fs` : ces deux commandes exigent le descripteur `0x20` juste après l'en-tête ou après un mot, et l'outil les classe « refusées ». Le pseudo-code de l'aiguillage tranche.

**Pour reprendre.** La suite utile est l'objet « sauvegarde » de `fs` (table `0x1356a4`, créé dans `0x118ed0`) : c'est lui qui décide des codes d'erreur que le jeu reçoit quand il ouvre un fichier de sauvegarde absent, et le jeu choisit sans doute de formater ou non d'après eux. Ensuite, la machine à états du jeu à `0x12438c`. Et, dès qu'une trace d'exécution existe, vérifier l'ordre de la partie 2 et le sens des chemins 0 et 5.
