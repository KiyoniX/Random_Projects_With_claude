# fs, les fichiers

`fs` est le guichet par lequel passent toutes les lectures et écritures de fichiers : le romfs d'un jeu, sa sauvegarde, la carte SD, la mémoire interne. Il ne touche lui-même à aucun support. Il vérifie les droits, tient le compte des archives et des fichiers ouverts, puis transmet le travail à Process9, le programme du processeur ARM9 qui tient la carte SD, la NAND et le chiffrement. Quand Pokémon X lit son romfs, la lecture traverse `fs` avant d'arriver à Process9.

Transmettre n'est pas tout, pour deux archives au moins : `fs` lit lui-même l'en-tête `IVFC` du romfs et en contrôle les empreintes, et il gère l'arborescence d'une sauvegarde que Process9 ne voit que comme un seul gros fichier. C'est le [contrat des fichiers](contrat-fs.md) qui l'a établi, en lisant les 43 commandes que Pokémon X envoie des deux côtés ; la partie 6 en reprend l'essentiel.

Fiche du 13 octobre 2026, produite avec REA, Ghidra sans interface et des scripts Python sur le module extrait du FIRM de la console. Les adresses sont celles du module chargé à `0x00100000`. Le module est gros : la fiche donne la carte d'ensemble et un chemin complet, pas tout.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001102` (lu dans l'exheader), rangé dans le NATIVE_FIRM |
| Fichier lu | `local/extrait/fs/exefs/code.elf` |
| Taille | 212 912 octets de code, 6 912 de données en lecture seule, 560 de données, 207 400 de mémoire à zéro |
| Fonctions | 1 995, dont 1 496 en Thumb ; 330 nommées dans `fs.noms.tsv` |
| Services offerts | `fs:USER` (30 sessions au plus), `fs:LDR` (2), `fs:REG` (2), plus une session privée par fichier ou dossier ouvert |
| Services appelés | `srv:`, et les quatre canaux vers Process9 : `PxiFS0`, `PxiFS1`, `PxiFSB`, `PxiFSR` |
| Dépendances déclarées | aucune, et l'exheader ne liste aucun service autorisé |
| Fils | le fil principal, qui accepte les clients, et quatre fils de service qui se partagent toutes les sessions |
| Langage | du C++ : les archives, fichiers et dossiers sont des objets appelés par tables de méthodes |
| Sur cette console | Luma patche `fs` en mémoire sans le remplacer. Ce qui est lu ici est le fichier extrait ; la présence ou non de ces patchs dans l'extrait n'a pas été vérifiée |

## Partie 1 : le démarrage et les fils

`entry` (`0x100000`) appelle six fonctions à la suite, puis `fs_main`, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire sans valeur initiale.
2. Trois fonctions de mise en place non détaillées (`0x123144`, `0x1235c8`, `0x123198`). La deuxième mène à `srv_init`, qui connecte le module au port `srv:`.
3. `run_static_initializers` (`0x100950`) appelle les 18 fonctions d'initialisation des objets globaux, par la table de distances de `0x135ab8` à `0x135b00`. La plus importante est `fsmgr_static_init` (`0x131a14`), qui prépare le grand objet « gestionnaire » décrit en partie 9.
4. `run_init_array` (`0x123110`) parcourt une seconde table, vide dans ce module.
5. `fs_main` (`0x122ad0`, 1 492 octets) : tout le reste.

**Dans `fs_main` :**

1. **La mémoire.** Trois réserves sont préparées (`0x7E000`, `0x10000` et `0x20000` octets).
2. **L'objet serveur.** Il est à `0x14b088`. Ses 128 cases de session sont vidées.
3. **Les quatre fils de service.** `create_thread` (`0x1234d8`), la seule fonction qui appelle `svcCreateThread`, est appelée quatre fois. Chaque fil a une pile de `0x5000` octets prise dans l'objet serveur. L'adresse donnée au noyau est `thread_trampoline` (`0x124d48`), et la fonction du fil est `worker_thread_main` (`0x1238b0`).
4. **Les services du système.** `srv_init` (`0x1235d8`) se connecte au port `srv:` et s'y déclare (`SRV_RegisterClient`) ; déjà appelée avant `fs_main`, elle ne fait ici que compter un utilisateur de plus. `fsmgr_init` (`0x123284`) termine le gestionnaire et appelle `pxi_init_sessions` (`0x1000b4`), qui ouvre les quatre canaux vers Process9 (partie 7).
5. **L'enregistrement.** `SRV_RegisterService` (`0x115904`) crée `fs:USER` avec 30 sessions au plus, puis `fs:LDR` et `fs:REG` avec 2 chacun.
6. **L'attente.** `svcWaitSynchronizationN` attend sur les trois ports. Quand un client arrive, `svcAcceptSession` ouvre la session, et le rang du port décide de l'objet créé :

| Port | Objet créé | Taille | Table de méthodes |
| --- | --- | --- | --- |
| `fs:USER` | une session de type 0, par `fsuser_session_init` (`0x12339c`) | `0x1D8` | `0x1342e4` |
| `fs:LDR` | la même, de type 1 | `0x1D8` | `0x1342e4` |
| `fs:REG` | un objet presque vide | 8 | `0x134300` |

La session est ensuite ajoutée à la liste de l'objet serveur, et un signal (`svcSignalEvent`) prévient les fils de service. S'il y a déjà 128 sessions, elle n'est pas ajoutée.

| Fil | Fonction | Adresse | Ce qu'il fait |
| --- | --- | --- | --- |
| Principal | `fs_main` | `0x122ad0` | Accepte les clients des trois services |
| Service (quatre) | `worker_thread_main` | `0x1238b0` | Attend une commande sur n'importe quelle session, la traite, répond |

## Partie 2 : la boucle de serveur

`fs` n'a ni une boucle unique comme `sm`, ni un fil par client comme `hid`. Quatre fils identiques se partagent toutes les sessions : celles des trois services, et celles des fichiers et dossiers ouverts.

**Les types de session.** Chaque session a un objet, et chaque objet commence par un pointeur vers sa table de méthodes. Les quatre tables ont la même forme :

| Case | Rôle | `fs:USER` et `fs:LDR` (`0x1342e4`) | Fichier (`0x134338`) | Dossier (`0x1342c8`) | `fs:REG` (`0x134300`) |
| --- | --- | --- | --- | --- | --- |
| `+0x04` | fermer la session | `0x12ad6c` | `0x12efac` | `0x126590` | `0x12ae24` |
| `+0x08` | traiter une commande | `fsuser_session_handle_command` (`0x12ad3c`) | `fsfile_dispatch_command` (`0x12ae2c`) | `fsdir_dispatch_command` (`0x12b2a0`) | `fsreg_dispatch_command` (`0x12e09c`) |
| `+0x0C` | donner la priorité de la commande | `fsuser_session_get_priority` (`0x131380`) | `fsfile_session_get_priority` (`0x13145c`) | `fsdir_session_get_priority` (`0x131360`) | `fsreg_session_get_priority` (`0x131358`) |
| `+0x10` | commande Control | `session_control_stub` (`0x12f058`) | la même | la même | la même |

`fsuser_session_handle_command` ne fait que noter la session en cours dans le stockage local du fil, puis appelle le vrai aiguillage, `fsuser_dispatch_command` (`0x12b4fc`).

**Dans `worker_thread_main` :**

1. **Un jeu de tampons.** Le fil prend un des jeux de trois tampons de `0x200` octets rangés dans l'objet serveur et les déclare au noyau (descripteur `0x00800002`, à `+0x180` du stockage local) : c'est là qu'arriveront les chemins de fichiers envoyés par les clients.
2. **L'attente.** `svcReplyAndReceive` (appel système `0x4F`) attend sur une liste : d'abord le signal « la liste a changé », puis toutes les sessions libres. `worker_thread_main` est la seule fonction du module qui appelle `svcReplyAndReceive`.
3. **La session est retirée de la liste.** Dès qu'une commande arrive, le fil enlève cette session de la liste commune et déclenche le signal : les trois autres fils reprennent leur attente sans elle. Une session n'est donc jamais servie par deux fils à la fois.
4. **La session est fermée ?** Si le résultat est `0xC920181A`, le fil appelle la méthode `+0x04` de l'objet et ferme la poignée.
5. **Sinon, la commande est traitée.** `server_process_request` (`0x123eb8`) appelle `server_run_request` (`0x124374`), décrit ci-dessous.
6. **La réponse.** Un second `svcReplyAndReceive`, sans attente, renvoie la réponse. La session est remise dans la liste et le signal est déclenché.

**Les priorités, dans `server_run_request` :**

1. La méthode `+0x0C` de la session rend la priorité de la commande, que `clamp_priority` (`0x11e098`) ramène à cinq valeurs : `-16`, `-8`, `0`, `8` ou `16`. Pour `fs:USER`, les commandes qui portent une poignée d'archive (les numéros `0x802`, `0x804` à `0x80B`, `0x80D`, `0x80E` et `0x812`) prennent la priorité de cette archive ; les autres prennent celle de la session.
2. Une commande de priorité `-16` est traitée tout de suite. Pour les autres, pas plus de trois à la fois : au-delà, la commande est copiée dans un bloc de `0x2C` octets et rangée dans une file d'attente triée par priorité.
3. Le fil change sa propre priorité selon celle de la commande (`svcSetThreadPriority`), range la priorité dans son stockage local, appelle la méthode `+0x08`, puis reprend sa priorité d'origine.

La priorité rangée dans le stockage local sert plus loin : c'est elle qui choisit le canal vers Process9 (partie 7).

## Partie 3 : les commandes de `fs:USER` et de `fs:LDR`

`fsuser_dispatch_command` (`0x12b4fc`, 9 288 octets) lit l'en-tête dans le tampon du fil (à `+0x80` du stockage local) et prend le numéro de commande dans les 16 bits du haut. Ce n'est pas une grande table d'adresses : le compilateur en a fait un arbre de comparaisons, avec quatre petites tables de saut. Pour le suivre sans erreur, un script a exécuté l'aiguillage dans un émulateur pour chaque numéro, et noté la première fonction appelée et l'en-tête de réponse écrit à la sortie.

Les noms et les en-têtes de requête viennent de 3dbrew ; la fonction, l'adresse et l'en-tête de réponse sont lus dans le code. La colonne « Contrôle » dit si le code compare l'en-tête entier à une constante : c'est le cas de 54 commandes, celles qui portent des tampons ou des poignées, et les 54 constantes sont exactement celles de 3dbrew. Les autres ne regardent que le numéro.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse | Contrôle |
| --- | --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x000100C6` | Dummy1 | dans l'aiguillage | `0x12b814` | `0x00010040` | oui |
| `0x0401` | `0x040100C4` | Control | dans l'aiguillage | `0x12b868` | `0x04010044` | oui |
| `0x0801` | `0x08010002` | Initialize | `fsuser_Initialize` | `0x1147c8` | `0x08010040` | oui |
| `0x0802` | `0x080201C2` | OpenFile | `fsuser_OpenFile` | `0x114d10` | `0x08020042` | oui |
| `0x0803` | `0x08030204` | OpenFileDirectly | `fsuser_OpenFileDirectly` | `0x12837c` | `0x08030042` | oui |
| `0x0804` | `0x08040142` | DeleteFile | `fsuser_DeleteFile` | `0x126744` | `0x08040040` | oui |
| `0x0805` | `0x08050244` | RenameFile | `fsuser_RenameFile` | `0x1269d4` | `0x08050040` | oui |
| `0x0806` | `0x08060142` | DeleteDirectory | `fsuser_DeleteDirectory` | `0x127f20` | `0x08060040` | oui |
| `0x0807` | `0x08070142` | DeleteDirectoryRecursively | `fsuser_DeleteDirectoryRecursively` | `0x129cbc` | `0x08070040` | oui |
| `0x0808` | `0x08080202` | CreateFile | `fsuser_CreateFile` | `0x1265fc` | `0x08080040` | oui |
| `0x0809` | `0x08090182` | CreateDirectory | `fsuser_CreateDirectory` | `0x127e7c` | `0x08090040` | oui |
| `0x080A` | `0x080A0244` | RenameDirectory | `fsuser_RenameDirectory` | `0x128094` | `0x080A0040` | oui |
| `0x080B` | `0x080B0102` | OpenDirectory | `fsuser_OpenDirectory` | `0x1276cc` | `0x080B0042` | oui |
| `0x080C` | `0x080C00C2` | OpenArchive | `fsuser_OpenArchive` | `0x126ba4` | `0x080C00C0` | oui |
| `0x080D` | `0x080D0144` | ControlArchive | `fsuser_ControlArchive` | `0x127958` | `0x080D0044` | oui |
| `0x080E` | `0x080E0080` | CloseArchive | `fsuser_CloseArchive` | `0x126db4` | `0x080E0040` |  |
| `0x080F` | `0x080F0180` | Obsoleted_2_0_FormatThisUserSaveData | `fsuser_Obsoleted_2_0_FormatThisUserSaveData` | `0x12a964` | `0x080F0040` |  |
| `0x0810` | `0x08100200` | Obsoleted_3_0_CreateSystemSaveData | `fsuser_Obsoleted_3_0_CreateSystemSaveData` | `0x12a7b4` | `0x08100040` |  |
| `0x0811` | `0x08110040` | Obsoleted_3_0_DeleteSystemSaveData | `fsuser_Obsoleted_3_0_DeleteSystemSaveData` | `0x12a880` | `0x08110040` |  |
| `0x0812` | `0x08120080` | GetFreeBytes | `fsuser_GetFreeBytes` | `0x126dec` | `0x081200C0` |  |
| `0x0813` | `0x08130000` | GetCardType | `fsuser_GetCardType` | `0x126ab4` | `0x08130080` |  |
| `0x0814` | `0x08140000` | GetSdmcArchiveResource | `fsuser_GetSdmcArchiveResource` | `0x1297dc` | `0x08140140` |  |
| `0x0815` | `0x08150000` | GetNandArchiveResource | `fsuser_GetNandArchiveResource` | `0x1296cc` | `0x08150140` |  |
| `0x0816` | `0x08160000` | GetSdmcFatfsError | `fsuser_GetSdmcFatfsError` | `0x128560` | `0x08160080` |  |
| `0x0817` | `0x08170000` | IsSdmcDetected | `fsuser_IsSdmcDetected` | `0x127cb4` | `0x08170080` |  |
| `0x0818` | `0x08180000` | IsSdmcWritable | `fsuser_IsSdmcWritable` | `0x127d18` | `0x08180080` |  |
| `0x0819` | `0x08190042` | GetSdmcCid | `fsuser_GetSdmcCid` | `0x1268d4` | `0x08190042` | oui |
| `0x081A` | `0x081A0042` | GetNandCid | `fsuser_GetNandCid` | `0x1267d4` | `0x081A0042` | oui |
| `0x081B` | `0x081B0000` | GetSdmcSpeedInfo | `fsuser_GetSdmcSpeedInfo` | `0x1282f0` | `0x081B0080` |  |
| `0x081C` | `0x081C0000` | GetNandSpeedInfo | `fsuser_GetNandSpeedInfo` | `0x128264` | `0x081C0080` |  |
| `0x081D` | `0x081D0042` | GetSdmcLog | `fsuser_GetSdmcLog` | `0x126940` | `0x081D0042` | oui |
| `0x081E` | `0x081E0042` | GetNandLog | `fsuser_GetNandLog` | `0x126840` | `0x081E0042` | oui |
| `0x081F` | `0x081F0000` | ClearSdmcLog | `fsuser_ClearSdmcLog` | `0x126d30` | `0x081F0040` |  |
| `0x0820` | `0x08200000` | ClearNandLog | `fsuser_ClearNandLog` | `0x126cac` | `0x08200040` |  |
| `0x0821` | `0x08210000` | CardSlotIsInserted | `fsuser_CardSlotIsInserted` | `0x1287e8` | `0x08210080` |  |
| `0x0822` | `0x08220000` | CardSlotPowerOn | `fsuser_CardSlotPowerOn` | `0x127df0` | `0x08220080` |  |
| `0x0823` | `0x08230000` | CardSlotPowerOff | `fsuser_CardSlotPowerOff` | `0x1281d8` | `0x08230080` |  |
| `0x0824` | `0x08240000` | CardSlotGetCardIFPowerStatus | `fsuser_CardSlotGetCardIFPowerStatus` | `0x129f40` | `0x08240080` |  |
| `0x0825` | `0x08250040` | CardNorDirectCommand | `fsuser_CardNorDirectCommand` | `0x129190` | `0x08250040` |  |
| `0x0826` | `0x08260080` | CardNorDirectCommandWithAddress | `fsuser_CardNorDirectCommandWithAddress` | `0x12a2dc` | `0x08260040` |  |
| `0x0827` | `0x08270082` | CardNorDirectRead | `fsuser_CardNorDirectRead` | `0x128450` | `0x08270042` | oui |
| `0x0828` | `0x082800C2` | CardNorDirectReadWithAddress | `fsuser_CardNorDirectReadWithAddress` | `0x129e9c` | `0x08280042` | oui |
| `0x0829` | `0x08290082` | CardNorDirectWrite | `fsuser_CardNorDirectWrite` | `0x12874c` | `0x08290042` | oui |
| `0x082A` | `0x082A00C2` | CardNorDirectWriteWithAddress | `fsuser_CardNorDirectWriteWithAddress` | `0x12a1cc` | `0x082A0042` | oui |
| `0x082B` | `0x082B00C2` | CardNorDirectRead_4xIO | `fsuser_CardNorDirectRead_4xIO` | `0x129578` | `0x082B0042` | oui |
| `0x082C` | `0x082C0082` | CardNorDirectCpuWriteWithoutVerify | `fsuser_CardNorDirectCpuWriteWithoutVerify` | `0x12a718` | `0x082C0042` | oui |
| `0x082D` | `0x082D0040` | CardNorDirectSectorEraseWithoutVerify | `fsuser_CardNorDirectSectorEraseWithoutVerify` | `0x12ab3c` | `0x082D0040` |  |
| `0x082E` | `0x082E0040` | GetProductInfo | `fsuser_GetProductInfo` | `0x127c58` | `0x082E0180` |  |
| `0x082F` | `0x082F0040` | GetProgramLaunchInfo | `fsuser_GetProgramLaunchInfo` | `0x129354` | `0x082F0140` |  |
| `0x0830` | `0x08300182` | Obsoleted_3_0_CreateExtSaveData | `fsuser_Obsoleted_3_0_CreateExtSaveData` | `0x12a540` | `0x08300042` | oui |
| `0x0831` | `0x08310180` | Obsoleted_3_0_CreateSharedExtSaveData | `fsuser_Obsoleted_3_0_CreateSharedExtSaveData` | `0x12abc8` | `0x08310040` |  |
| `0x0832` | `0x08320102` | Obsoleted_3_0_ReadExtSaveDataIcon | `fsuser_Obsoleted_3_0_ReadExtSaveDataIcon` | `0x12a6d4` | `0x08320082` | oui |
| `0x0833` | `0x08330082` | Obsoleted_3_0_EnumerateExtSaveData | `fsuser_Obsoleted_3_0_EnumerateExtSaveData` | `0x12a930` | `0x08330082` | oui |
| `0x0834` | `0x08340082` | Obsoleted_3_0_EnumerateSharedExtSaveData | `fsuser_Obsoleted_3_0_EnumerateSharedExtSaveData` | `0x12ad04` | `0x08340082` | oui |
| `0x0835` | `0x08350080` | Obsoleted_3_0_DeleteExtSaveData | `fsuser_Obsoleted_3_0_DeleteExtSaveData` | `0x12a590` | `0x08350040` |  |
| `0x0836` | `0x08360080` | Obsoleted_3_0_DeleteSharedExtSaveData | `fsuser_Obsoleted_3_0_DeleteSharedExtSaveData` | `0x12ac2c` | `0x08360040` |  |
| `0x0837` | `0x08370040` | SetCardSpiBaudRate | `fsuser_SetCardSpiBaudRate` | `0x128c48` | `0x08370040` |  |
| `0x0838` | `0x08380040` | SetCardSpiBusMode | `fsuser_SetCardSpiBusMode` | `0x128644` | `0x08380040` |  |
| `0x0839` | `0x08390000` | SendInitializeInfoTo9 | `fsuser_SendInitializeInfoTo9` | `0x129510` | `0x08390040` |  |
| `0x083A` | `0x083A0100` | GetSpecialContentIndex | `fsuser_GetSpecialContentIndex` | `0x129840` | `0x083A0080` |  |
| `0x083B` | `0x083B00C2` | GetLegacyRomHeader | `fsuser_GetLegacyRomHeader` | `0x128a08` | `0x083B0042` | oui |
| `0x083C` | `0x083C00C2` | GetLegacyBannerData | `fsuser_GetLegacyBannerData` | `0x128f20` | `0x083C0042` | oui |
| `0x083D` | `0x083D0100` | CheckAuthorityToAccessExtSaveData | `fsuser_CheckAuthorityToAccessExtSaveData` | `0x12a628` | `0x083D0080` |  |
| `0x083E` | `0x083E00C2` | QueryTotalQuotaSize | `fsuser_QueryTotalQuotaSize` | `0x1290c8` | `0x083E00C2` | oui |
| `0x083F` | `0x083F00C0` | Obsoleted_3_0_GetExtDataBlockSize | `fsuser_Obsoleted_3_0_GetExtDataBlockSize` | `0x12a694` | `0x083F0180` |  |
| `0x0840` | `0x08400040` | AbnegateAccessRight | `fsuser_AbnegateAccessRight` | `0x128ef0` | `0x08400040` |  |
| `0x0841` | `0x08410000` | DeleteSdmcRoot | `fsuser_DeleteSdmcRoot` | `0x1279d0` | `0x08410040` |  |
| `0x0842` | `0x08420040` | DeleteAllExtSaveDataOnNand | `fsuser_DeleteAllExtSaveDataOnNand` | `0x129c58` | `0x08420040` |  |
| `0x0843` | `0x08430000` | InitializeCtrFileSystem | `fsuser_InitializeCtrFileSystem` | `0x129b74` | `0x08430040` |  |
| `0x0844` | `0x08440000` | CreateSeed | `fsuser_CreateSeed` | `0x1266bc` | `0x08440040` |  |
| `0x0845` | `0x084500C2` | GetFormatInfo | `fsuser_GetFormatInfo` | `0x126e78` | `0x08450140` | oui |
| `0x0846` | `0x08460102` | GetLegacyRomHeader2 | `fsuser_GetLegacyRomHeader2` | `0x128fd0` | `0x08460042` | oui |
| `0x0847` | `0x08470180` | Obsoleted_2_0_FormatCtrCardUserSaveData | `fsuser_Obsoleted_2_0_FormatCtrCardUserSaveData` | `0x12ac60` | `0x08470040` |  |
| `0x0848` | `0x08480042` | GetSdmcCtrRootPath | `fsuser_GetSdmcCtrRootPath` | `0x128ab4` | `0x08480042` | oui |
| `0x0849` | `0x08490040` | GetArchiveResource | `fsuser_GetArchiveResource` | `0x128904` | `0x08490140` |  |
| `0x084A` | `0x084A0002` | ExportIntegrityVerificationSeed | `fsuser_ExportIntegrityVerificationSeed` | `0x12a370` | `0x084A0042` | oui |
| `0x084B` | `0x084B0002` | ImportIntegrityVerificationSeed | `fsuser_ImportIntegrityVerificationSeed` | `0x12a4b0` | `0x084B0042` | oui |
| `0x084C` | `0x084C0242` | FormatSaveData | `fsuser_FormatSaveData` | `0x127ab4` | `0x084C0040` | oui |
| `0x084D` | `0x084D0102` | GetLegacySubBannerData | `fsuser_GetLegacySubBannerData` | `0x12961c` | `0x084D0042` | oui |
| `0x084E` | `0x084E0342` | UpdateSha256Context | `fsuser_UpdateSha256Context` | `0x129110` | `0x084E0242` | oui |
| `0x084F` | `0x084F0102` | ReadSpecialFile | `fsuser_ReadSpecialFile` | `0x128028` | `0x084F0082` | oui |
| `0x0850` | `0x08500040` | GetSpecialFileSize | `fsuser_GetSpecialFileSize` | `0x128b50` | `0x085000C0` |  |
| `0x0851` | `0x08510242` | CreateExtSaveData | `fsuser_CreateExtSaveData` | `0x114b94` | `0x08510042` | oui |
| `0x0852` | `0x08520100` | DeleteExtSaveData | `fsuser_DeleteExtSaveData` | `0x114ad8` | `0x08520040` |  |
| `0x0853` | `0x08530142` | ReadExtSaveDataIcon | `fsuser_ReadExtSaveDataIcon` | `0x1149a8` | `0x08530082` | oui |
| `0x0854` | `0x08540100` | GetExtDataBlockSize | `fsuser_GetExtDataBlockSize` | `0x114a40` | `0x08540180` |  |
| `0x0855` | `0x08550102` | EnumerateExtSaveData | `fsuser_EnumerateExtSaveData` | `0x1148f4` | `0x08550082` | oui |
| `0x0856` | `0x08560240` | CreateSystemSaveData | `fsuser_CreateSystemSaveData` | `0x12921c` | `0x08560040` |  |
| `0x0857` | `0x08570080` | DeleteSystemSaveData | `fsuser_DeleteSystemSaveData` | `0x1292c8` | `0x08570040` |  |
| `0x0858` | `0x08580000` | StartDeviceMoveAsSource | `fsuser_StartDeviceMoveAsSource` | `0x129bb8` | `0x08580240` |  |
| `0x0859` | `0x08590200` | StartDeviceMoveAsDestination | `fsuser_StartDeviceMoveAsDestination` | `0x12a09c` | `0x08590040` |  |
| `0x085A` | `0x085A00C0` | SetArchivePriority | `fsuser_SetArchivePriority` | `0x128ba0` | `0x085A0040` |  |
| `0x085B` | `0x085B0080` | GetArchivePriority | `fsuser_GetArchivePriority` | `0x1288d4` | `0x085B0080` |  |
| `0x085C` | `0x085C00C0` | SetCtrCardLatencyParameter | `fsuser_SetCtrCardLatencyParameter` | `0x129d90` | `0x085C0040` |  |
| `0x085D` | `0x085D01C0` | SetFsCompatibilityInfo | `fsuser_SetFsCompatibilityInfo` | `0x1299ac` | `0x085D0040` |  |
| `0x085E` | `0x085E0040` | ResetCardCompatibilityParameter | `fsuser_ResetCardCompatibilityParameter` | `0x12a5c8` | `0x085E0040` |  |
| `0x085F` | `0x085F0040` | SwitchCleanupInvalidSaveData | `fsuser_SwitchCleanupInvalidSaveData` | `0x12a138` | `0x085F0040` |  |
| `0x0860` | `0x08600042` | EnumerateSystemSaveData | `fsuser_EnumerateSystemSaveData` | `0x129b14` | `0x08600082` | oui |
| `0x0861` | `0x08610042` | InitializeWithSdkVersion | `fsuser_Initialize` | `0x1147c8` | `0x08610040` | oui |
| `0x0862` | `0x08620040` | SetPriority | `session_SetPriority` | `0x115150` | `0x08620040` |  |
| `0x0863` | `0x08630000` | GetPriority | `session_GetPriority` | `0x1148e4` | `0x08630080` |  |
| `0x0864` | `0x08640000` | Obsoleted_4_0_GetNandInfo | `fsuser_Obsoleted_4_0_GetNandInfo` | `0x129c4c` | `0x08640200` |  |
| `0x0865` | `0x08650140` | SetSaveDataSecureValue | `fsuser_SetSaveDataSecureValue` | `0x12aa88` | `0x08650040` |  |
| `0x0866` | `0x086600C0` | GetSaveDataSecureValue | `fsuser_GetSaveDataSecureValue` | `0x12a9d8` | `0x08660100` |  |
| `0x0867` | `0x086700C4` | ControlSecureSave | `fsuser_ControlSecureSave` | `0x1284ec` | `0x08670044` | oui |
| `0x0868` | `0x08680000` | GetMediaType | `fsuser_GetMediaType` | `0x126e68` | `0x08680080` |  |
| `0x0869` | `0x08690000` | Obsoleted_4_0_GetNandEraseCount | `fsuser_Obsoleted_4_0_GetNandEraseCount` | `0x12a5bc` | `0x08690140` |  |
| `0x086A` | `0x086A0082` | ReadNandReport | `fsuser_ReadNandReport` | `0x127d7c` | `0x086A0042` | oui |
| `0x086B` | `0x086B00C2` | SetOtherSaveDataSecureValue | `fsuser_SetOtherSaveDataSecureValue` | `0x12a038` | `0x086B0042` | oui |
| `0x086C` | `0x086C00C2` | GetOtherSaveDataSecureValue | `fsuser_GetOtherSaveDataSecureValue` | `0x129fcc` | `0x086C0082` | oui |
| `0x086D` | `0x086D0080` | BeginSaveDataMove | `fsuser_BeginSaveDataMove` | `0x1286d0` | `0x086D0080` |  |
| `0x086E` | `0x086E00C0` | SetThisSaveDataSecureValue | `fsuser_SetThisSaveDataSecureValue` | `0x129df0` | `0x086E0040` |  |
| `0x086F` | `0x086F0040` | GetThisSaveDataSecureValue | `fsuser_GetThisSaveDataSecureValue` | `0x129d4c` | `0x086F0140` |  |
| `0x0870` | `0x087000C2` | CheckArchive | `fsuser_CheckArchive` | `0x126c60` | `0x08700040` | oui |
| `0x0871` | `0x08710140` | TransferSaveDataCMAC | `fsuser_TransferSaveDataCMAC` | `0x12990c` | `0x08710040` |  |
| `0x0872` | `0x08720200` | RegisterTitleContentOverlay | `fsuser_RegisterTitleContentOverlay` | `0x1293b0` | `0x08720040` |  |
| `0x0873` | `0x08730100` | UnregisterTitleContentOverlay | `fsuser_UnregisterTitleContentOverlay` | `0x129aa8` | `0x08730040` |  |
| `0x0874` | `0x08740000` | UnregisterAllTitleContentOverlays | `fsuser_UnregisterAllTitleContentOverlays` | `0x1294ac` | `0x08740040` |  |
| `0x0875` | `0x08750140` | SetSaveArchiveSecureValue | `fsuser_SetSaveArchiveSecureValue` | `0x129a24` | `0x08750040` |  |
| `0x0876` | `0x087600C0` | GetSaveArchiveSecureValue | `fsuser_GetSaveArchiveSecureValue` | `0x12975c` | `0x08760140` |  |
| `0x0877` | `0x08770140` | RegisterSpecialTitleContent | `fsuser_RegisterSpecialTitleContent` | `0x129e28` | `0x08770040` |  |
| `0x0878` | `0x08780100` | UnregisterSpecialTitleContent | `fsuser_UnregisterSpecialTitleContent` | `0x12a270` | `0x08780040` |  |
| `0x0879` | `0x087900C2` | Same | `fsuser_Same` | `0x12a400` | `0x08790042` | oui |
| `0x087A` | `0x087A0180` | AddSeed | `fsuser_AddSeed` | `0x128174` | `0x087A0040` |  |
| `0x087B` | `0x087B0080` | GetSeed | `fsuser_GetSeed` | `0x127fb0` | `0x087B0140` |  |
| `0x087C` | `0x087C0080` | DeleteSeed | `fsuser_DeleteSeed` | `0x128878` | `0x087C0040` |  |
| `0x087D` | `0x087D0000` | GetNumSeeds | `fsuser_GetNumSeeds` | `0x129084` | `0x087D0080` |  |
| `0x087E` | `0x087E0042` | ListSeeds | `fsuser_ListSeeds` | `0x1285ec` | `0x087E0082` | oui |
| `0x087F` | `0x087F0100` | TitleContentHasSeed | `fsuser_TitleContentHasSeed` | `0x127240` | `0x087F0080` |  |
| `0x0880` | `0x08800880` | AddTitleTag | `fsuser_AddTitleTag` | `0x126bfc` | `0x08800040` |  |
| `0x0881` | `0x08810080` | GetTitleTag | `fsuser_GetTitleTag` | `0x126b44` | `0x08810840` |  |
| `0x0882` | `0x08820080` | DeleteTitleTag | `fsuser_DeleteTitleTag` | `0x127a58` | `0x08820040` |  |
| `0x0883` | `0x08830000` | GetNumTitleTags | `fsuser_GetNumTitleTags` | `0x127fe4` | `0x08830080` |  |
| `0x0884` | `0x08840042` | ListTitleTags | `fsuser_ListTitleTags` | `0x127674` | `0x08840082` | oui |
| `0x0885` | `0x088500C0` | CheckTitleSeed | `fsuser_CheckTitleSeed` | `0x128cd4` | `0x08850040` |  |
| `0x0886` | `0x088600C0` | CheckUpdatedDat | `fsuser_CheckUpdatedDat` | `0x129434` | `0x08860080` |  |

- Un numéro inconnu rend `0xD900182F`, un en-tête mal formé `0xD9001830`.
- Dummy1 et Control ne font rien : la première rend toujours `0xE0C046F8`, la seconde passe par `session_control_stub`, qui rend la même valeur.
- Initialize et InitializeWithSdkVersion appellent la même fonction. Elle cherche le processus appelant dans le registre des programmes (partie 4), copie ses informations dans la session et lève le drapeau « initialisée » (`+0x188`). Sans ce drapeau, l'archive `0x00000003` est refusée.
- SetPriority et GetPriority (`session_SetPriority`, `session_GetPriority`) sont les mêmes fonctions pour `fs:USER`, les fichiers et les dossiers : la priorité est au même endroit dans les trois objets, à `+0x04`.
- Les fonctions de commande sont toutes en ARM.
- **GetExtDataBlockSize : `0x08540100`, et non `0x08540010`.** Cette fiche donnait d'abord `0x08540010`, repris de 3dbrew comme toute la colonne. Pokémon X écrit `0x08540100` (sa fonction d'envoi, `0x1e2e38`), ce qui annonce quatre mots ordinaires : c'est la forme de la requête (une structure de 12 octets et un mot nul), et celle de DeleteExtSaveData (`0x08520100`), qui porte la même structure. L'aiguillage ne compare pas l'en-tête de cette commande, seulement son numéro : exécuté avec cinq en-têtes différents (`0x08540100`, `0x08540010`, `0x08540000`, `0x0854FFFF`, `0x08540042`), il appelle chaque fois `fsuser_GetExtDataBlockSize` et répond `0x08540180` ([contrat-fs](contrat-fs.md), partie 6). La table rendue par `emulate_dispatch.py` le dit aussi (« numéro » dans la colonne du contrôle). `0x08540010` est donc une coquille de la source, que la console accepte.

**Et `fs:LDR` ?** Il n'a ni table ni fonction à lui : même objet, même aiguillage, mêmes 136 commandes. La seule différence est un octet de la session (`+0x189`), mis à 1 pour `fs:LDR`. Dans tout le module, il n'est lu qu'à un endroit, `archive_permission_check` (`0x10f024`) : c'est lui qui ouvre le droit à l'archive `0x2345678E` (partie 8).

## Partie 4 : les commandes de `fs:REG`

`fs:REG` est le service par lequel `pm` déclare à `fs` chaque programme qu'il lance : son numéro de processus, son titre, ses droits d'accès. L'aiguillage est `fsreg_dispatch_command` (`0x12e09c`), une table à part.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x000100C6` | Dummy1 | dans l'aiguillage | `0x12e12c` | `0x00010040` |
| `0x0401` | `0x040103C0` | Register | `fsreg_Register` | `0x12adf8` | `0x04010040` |
| `0x0402` | `0x04020040` | Unregister | `fsreg_Unregister` | `0x12ada0` | `0x04020040` |
| `0x0403` | `0x040300C0` | GetProgramInfo | `fsreg_GetProgramInfo` | `0x1262fc` | `0x04030042` |
| `0x0404` | `0x04040100` | LoadProgram | `fsreg_LoadProgram` | `0x12adb0` | `0x040400C0` |
| `0x0405` | `0x04050080` | UnloadProgram | dans l'aiguillage | `0x12e298` | `0x04050040` |
| `0x0406` | `0x04060080` | CheckHostLoadId | `fsreg_CheckHostLoadId` | `0x12add0` | `0x04060040` |

- Dummy1 mise à part, ces commandes n'ont aucun contrôle de format : seul le numéro compte.
- Le registre est une table de 128 entrées de `0x38` octets, dans le gestionnaire (à `0x1446f0`). `fsreg_Unregister` la parcourt à la recherche du numéro de processus.
- UnloadProgram n'appelle rien : elle répond tout de suite par un succès.

## Partie 5 : les commandes d'un fichier et d'un dossier ouverts

OpenFile ne rend pas un numéro de fichier : il crée une paire de sessions (`svcCreateSession`), garde un bout et donne l'autre au jeu. Le jeu envoie ensuite ses lectures sur cette session privée, qui a son propre aiguillage.

**Un fichier ouvert**, `fsfile_dispatch_command` (`0x12ae2c`) :

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse | Contrôle |
| --- | --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x000100C6` | Dummy1 | dans l'aiguillage | `0x12af1c` | `0x00010040` | oui |
| `0x0401` | `0x040100C4` | Control | dans l'aiguillage | `0x12af74` | `0x04010044` | oui |
| `0x0801` | `0x08010100` | OpenSubFile | `fsfile_OpenSubFile` | `0x12e2f8` | `0x08010042` |  |
| `0x0802` | `0x080200C2` | Read | `fsfile_Read` | `0x11541c` | `0x08020082` | oui |
| `0x0803` | `0x08030102` | Write | `fsfile_Write` | `0x12eb4c` | `0x08030082` | oui |
| `0x0804` | `0x08040000` | GetSize | `fsfile_GetSize` | `0x12ee78` | `0x080400C0` |  |
| `0x0805` | `0x08050080` | SetSize | `fsfile_SetSize` | `0x12ef00` | `0x08050040` |  |
| `0x0806` | `0x08060000` | GetAttributes | `fsfile_GetAttributes` | `0x12e9c0` | `0x08060080` |  |
| `0x0807` | `0x08070040` | SetAttributes | `fsfile_SetAttributes` | `0x12ea28` | `0x08070040` |  |
| `0x0808` | `0x08080000` | Close | `fsfile_Close` | `0x1152ac` | `0x08080040` |  |
| `0x0809` | `0x08090000` | Flush | `fsfile_Flush` | `0x12eac0` | `0x08090040` |  |
| `0x080A` | `0x080A0040` | SetPriority | `session_SetPriority` | `0x115150` | `0x080A0040` |  |
| `0x080B` | `0x080B0000` | GetPriority | `session_GetPriority` | `0x1148e4` | `0x080B0080` |  |
| `0x080C` | `0x080C0000` | OpenLinkFile | `fsfile_OpenLinkFile` | `0x12e764` | `0x080C0042` |  |
| `0x0C01` | `0x0C010100` | GetAvailable | `fsfile_GetAvailable` | `0x12ed14` | `0x0C0100C0` |  |

**Un dossier ouvert**, `fsdir_dispatch_command` (`0x12b2a0`) :

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse | Contrôle |
| --- | --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x000100C6` | Dummy1 | dans l'aiguillage | `0x12b320` | `0x00010040` | oui |
| `0x0401` | `0x040100C4` | Control | dans l'aiguillage | `0x12b378` | `0x04010044` | oui |
| `0x0801` | `0x08010042` | Read | `fsdir_Read` | `0x1264e0` | `0x08010082` | oui |
| `0x0802` | `0x08020000` | Close | `fsdir_Close` | `0x126534` | `0x08020040` |  |
| `0x0803` | `0x08030040` | SetPriority | `session_SetPriority` | `0x115150` | `0x08030040` |  |
| `0x0804` | `0x08040000` | GetPriority | `session_GetPriority` | `0x1148e4` | `0x08040080` |  |

- Les fonctions `session_SetPriority` et `session_GetPriority` sont celles de `fs:USER`.
- La colonne « Contrôle » a le même sens qu'en partie 3.
- La réponse de Read (fichier) : `0x08020082`, le résultat, le nombre d'octets lus, puis le descripteur du tampon rendu au client.
- `fsfile_OpenSubFile` et `fsfile_OpenLinkFile` posent la même table de méthodes (`0x134338`) que `fsuser_OpenFile` : elles créent donc elles aussi une session de fichier. D'après 3dbrew, la première ouvre une fenêtre du même fichier ; cela colle au décalage de base et à la taille que la lecture applique (partie 6). Leur corps a été lu depuis, par le [contrat des fichiers](contrat-fs.md), partie 4 : OpenSubFile refuse une session qui est déjà une fenêtre (`0xE0C046F8`), une position ou une taille négative, et une fenêtre qui dépasse la fin du fichier (`0xE0E046C1`) ; OpenLinkFile demande au gestionnaire un double du fichier (méthode `+0x4C` de l'archive d'origine) et rend une session sur le fichier entier, avec le même mode d'ouverture.

Ce que le contrat des fichiers a lu en plus dans ces aiguillages, en suivant les commandes de Pokémon X :

- **Le mode d'ouverture** (octet `+0x09` de la session) n'est contrôlé que si son bit 3 est levé : Read est refusée (`0xD9004676`) quand le bit 0 est à 0 et le bit 3 à 1, Write et SetSize quand le bit 1 est à 0 et le bit 3 à 1, GetAvailable quand les bits 0 et 3 sont tous deux à 0. Un fichier ouvert sans le bit 3 se lit et s'écrit quel que soit son mode. Lu dans l'assembleur des quatre fonctions.
- **Les tailles ne sont jamais prises dans les mots ordinaires.** Read, Write, la lecture d'un dossier et les chemins de `fs:USER` portent un mot « taille » que l'aiguillage ne lit pas : la taille vient du descripteur du tampon. Pour la lecture d'un dossier, le nombre d'entrées est recalculé en divisant la taille du tampon par `0x228`.
- **Write a une option** (mot 4). Si son bit 24 est levé, elle est passée avec les données ; sinon les données sont écrites sans elle, puis un second appel de taille 0 la porte, et c'est lui qui force l'écriture sur le support. Le jeu s'en sert comme d'un « vider » : un Write de taille 0 et d'option `0x10001`.
- **GetAvailable lit réellement les données**, par morceaux de `0x10000` octets au plus, jusqu'à la taille demandée ou à une lecture vide : pour un romfs, toute la tranche passe par le contrôle des empreintes.
- **Un booléen de réponse est écrit sur un seul octet** ; les trois autres gardent ce que contenait la requête.

## Partie 6 : ouvrir un fichier et le lire, pas à pas

Le chemin suivi est celui d'un jeu qui ouvre un fichier par OpenFileDirectly (`0x08030204`), puis lit dedans.

**L'ouverture**

1. **Le contrôle du message.** Le bloc de l'aiguillage (à `0x12b9ac`) compare l'en-tête à `0x08030204` et vérifie les deux descripteurs de tampons : le chemin de l'archive (masque `0x3C0F`, valeur `0x802`) et le chemin du fichier (valeur `2`).
2. **`fsuser_OpenFileDirectly`** (`0x12837c`) enchaîne trois appels.
3. **Ouvrir l'archive.** `session_open_archive` (`0x115684`) :
   - `check_archive_access` (`0x118ccc`) trie l'identifiant d'archive, refuse ceux qu'il ne connaît pas (`0xE0E046BE`), puis demande à `archive_permission_check` (`0x10f024`) si ce programme y a droit.
   - `fsmgr_open_archive` (`0x1189b8`) trie une seconde fois sur l'identifiant et appelle la fonction d'ouverture qui correspond (partie 8). Elle rend une poignée d'archive de 64 bits.
   - La poignée est rangée dans la première case libre de la table de la session : 32 cases de 12 octets (la poignée, puis la priorité).
4. **Ouvrir le fichier.** `fsuser_OpenFile` (`0x114d10`), la même fonction que pour la commande OpenFile :
   - `session_has_archive` (`0x11575c`) vérifie que la poignée d'archive appartient bien à cette session.
   - `fsmgr_open_file` (`0x115454`) retrouve l'objet « archive » d'après la poignée et appelle sa méthode `+0x0C`. Pour une archive tenue par Process9, c'est `PxiArchive_OpenFile` (`0x106020`).
   - `PxiArchive_OpenFile` prend un canal (`guard_acquire`, partie 7) et envoie la requête `PXIFS_OpenFile` (`0x130958`, en-tête `0x000101C2`). Process9 rend une poignée de fichier de 64 bits, que la fonction range dans un petit objet « fichier » de `0x14` octets (table de méthodes `0x134b00`).
   - De retour dans `fsuser_OpenFile` : `svcCreateSession` crée la paire de sessions. Un objet de `0x28` octets (table de méthodes `0x134338`) est créé pour le bout gardé, ajouté à la liste de l'objet serveur, et le signal réveille les fils de service.
5. **Rendre l'archive.** `session_close_archive` (`0x11561c`) retire l'archive de la table de la session : elle n'a servi que le temps de l'ouverture.
6. **La réponse.** `0x08030042`, le résultat, le mot `0x10` (« le mot suivant est une poignée à donner au client »), puis la poignée de la session du fichier.

**La lecture**

Le jeu envoie Read (`0x080200C2`) sur la session du fichier : un décalage de 64 bits, une taille, et un tampon à lui que le noyau rend visible dans `fs`.

1. Un fil de service reçoit la commande. La session est un fichier, donc `fsfile_dispatch_command` (`0x12ae2c`) est appelé. Le bloc de Read compare l'en-tête à `0x080200C2` et vérifie que le descripteur de tampon est du type « à écrire » (`0xC`).
2. `fsfile_Read` (`0x11541c`) regarde les droits d'ouverture du fichier (l'octet `+0x09` de la session), puis appelle `file_session_read` (`0x1144f8`).
3. `file_session_read` prend le verrou du fichier, limite la taille à la fenêtre de la session, et ajoute le décalage de base de la session (`+0x18`) au décalage demandé. Si le tampon et le décalage ne sont pas alignés de la même façon sur 4 octets, la lecture est faite en deux morceaux, le premier par un tampon de `0x20` octets.
4. `fsmgr_read_file` (`0x114458`) retrouve l'objet « fichier » d'après sa poignée et appelle sa méthode `+0x08`. Pour un fichier tenu par Process9, c'est `PxiFile_Read` (`0x105df4`).
5. `PxiFile_Read` découpe la lecture en morceaux. Pour chacun : `guard_acquire` (`0x11e2cc`) prend un canal, `PXIFS_ReadFile` (`0x1309cc`) envoie la requête, `guard_release` (`0x11e2ba`) rend le canal. Elle additionne les octets lus et s'arrête quand Process9 en rend zéro.

La requête construite par `PXIFS_ReadFile`, puis envoyée par `svcSendSyncRequest` :

| Mot | Contenu |
| --- | --- |
| 0 | `0x00090142` |
| 1, 2 | la poignée de fichier donnée par Process9 (64 bits) |
| 3, 4 | le décalage dans le fichier (64 bits) |
| 5 | la taille à lire |
| 6 | `taille << 8 \| 4` : « le mot suivant est un tampon où écrire » |
| 7 | l'adresse du tampon |

La réponse porte le résultat au mot 1 et le nombre d'octets lus au mot 2.

**Par quel canal ?** `guard_acquire` appelle la méthode `+0x00` de l'objet « canaux », `pxi_acquire_session` (`0x10c574`). Elle lit la priorité de la commande en cours, rangée dans le stockage local par `server_run_request` (partie 2), et choisit : `PxiFSR` pour `-16`, `PxiFSB` pour `8` et `16`, `PxiFS0` ou `PxiFS1` pour le reste. Une session neuve a la priorité `0` : un jeu qui n'a jamais appelé SetPriority lit donc par `PxiFS0` ou `PxiFS1`, ou par `PxiFSB` quand les deux sont pris.

**Et le romfs de Pokémon X ?** L'archive `0x00000003` n'est pas ouverte directement chez Process9. `open_self_ncch_archive` (`0x10d2a4`) fabrique un objet intermédiaire de `0x58` octets (table de méthodes `0x135610`) posé sur une archive de Process9. Sa méthode d'ouverture (`0x11ec5c`, puis `0x10cd44`) exige un chemin binaire de 12 octets et appelle à son tour la méthode `+0x0C` de l'archive du dessous. Le chemin ci-dessus reste donc vrai, avec un étage de plus.

Cet étage a été lu par le [contrat des fichiers](contrat-fs.md), partie 2, et il fait plus qu'on ne le croyait :

1. **L'archive du dessous est `0x2345678E`**, ouverte par `0x119384` puis `pxi_open_archive` avec un chemin binaire de 8 octets : la poignée de programme que `pm` a donnée à `fs` pour ce jeu, recopiée dans la session par Initialize (à `+0x1C0`). Sans Initialize, pas de poignée, et l'archive est refusée. La constante `0x2345678E` est bien dans le module, à `0x1193b4`, au milieu de `0x119384`. Pour un client, cette archive reste réservée à `fs:LDR` (partie 8) ; `fs` l'utilise pour lui-même.
2. **Le premier octet du chemin de fichier choisit ce qu'on ouvre** (`0x10cd04`, table de saut décodée à la main) : 0 et 5, un lecteur de romfs ; 2, un petit lecteur (le jeu s'en sert pour l'icône de l'exefs) ; 1 est refusé par `0xD9004676`, 3 et 6 et plus par `0xE0E046BE`, 4 par `0xF9604784`, un code qui arrête le module. Pokémon X envoie 0 (`rom:`), 5 (`rom2:`) et 2.
3. `fs` envoie à Process9 une requête de contrôle sur l'archive, `PxiArchive_Control` avec l'action `0x789D` (en-tête `0x00560102`), les 12 octets du chemin en entrée et 16 en sortie ; il en tire 16 autres octets par une table à lui (`0x119540`), puis ouvre le fichier chez Process9 (`PXIFS_OpenFile`) avec un chemin de `0x1C` octets : les 12 du jeu et ces 16-là.
4. **Le lecteur de romfs** (objet de `0x1C4` octets, table `0x134f58`) lit à sa création `0x5C` octets à la position 0 et exige la marque `IVFC` (la constante est dans le module à `0x107710` et `0x107890`) ; sinon `0xC8A04554`. Il monte trois étages, un par niveau du romfs, chacun avec son cache, et n'expose que **le dernier niveau** : la position 0 du fichier vu par le jeu est l'en-tête de `0x28` octets de ce niveau. Les empreintes de chaque bloc sont contrôlées dans `fs`, qui a sa propre fonction SHA-256 ; une lecture qui rend `0xD9004586` est refaite une fois.

Process9 ne fait donc que déchiffrer et rendre des blocs bruts. Une lecture du jeu peut donner plusieurs requêtes `PXIFS_ReadFile` (blocs d'empreintes et de données), ou aucune si tout est en cache. La sauvegarde (archive `0x00000004`) suit le même principe : `0x10e03c` rouvre l'archive `0x2345678E`, y ouvre un seul fichier dont le chemin commence par 3, en lecture et écriture, et pose dessus un objet de `0xCDC` octets (table `0x1356a4`) qui tient l'arborescence. Cet objet n'est pas lu.

## Partie 7 : les canaux vers Process9

**Les quatre canaux.** `pxi_init_sessions` (`0x1000b4`) appelle quatre fois `pxi_open_session` (`0x11e520`), qui demande le service à `sm` (`SRV_GetServiceHandle`) puis envoie tout de suite à Process9 la requête `PXIFS_SetPriority` (`0x00500040`) avec une valeur fixe :

| Canal | Poignée | Valeur envoyée | Réserve |
| --- | --- | --- | --- |
| `PxiFS0` | `0x143748` | `0` | commune à `PxiFS0` et `PxiFS1`, à `0x14379c` |
| `PxiFS1` | `0x143750` | `0` | la même |
| `PxiFSR` | `0x143758` | `-16` | à `0x143768`, un seul canal |
| `PxiFSB` | `0x143760` | `16` | à `0x1437d0`, un seul canal |

**Le choix.** `pxi_acquire_session` (`0x10c574`) prend un canal libre dans la réserve qui correspond à la priorité de la commande, et attend s'il n'y en a pas. Pour les priorités `0` et `-8`, elle essaie d'abord `PxiFS0` et `PxiFS1`, puis `PxiFSB`, sans attendre, et n'attend qu'ensuite sur les deux premiers. Si la priorité de la commande n'est pas celle que le canal a reçue la dernière fois, elle renvoie `PXIFS_SetPriority`. `pxi_release_session` (`0x10c5f0`) remet le canal dans sa réserve par `pool_put` (`0x1251f0`).

Il n'y a donc jamais plus de quatre requêtes en cours chez Process9, et une seule de priorité `-16`.

**Les objets posés sur Process9.** Les archives, fichiers et dossiers ont chacun une forme commune (une table de méthodes), que plusieurs classes remplissent. Voici celles qui parlent directement à Process9 :

| Table | Case | Fonction | Adresse | Requête envoyée |
| --- | --- | --- | --- | --- |
| archive, `0x134b58` | `+0x00` | `PxiArchive_destroy` | `0x10616c` | `0x00160080` |
| | `+0x0C` | `PxiArchive_OpenFile` | `0x106020` | `0x000101C2` |
| | `+0x14` | `PxiArchive_Control` | `0x105f2c` | `0x004800C2`, `0x001500C0` ou `0x00560102` |
| | `+0x18` | `PxiArchive_OpenDirectory` | `0x1056a0` | `0x00080102` |
| | `+0x20` | `PxiArchive_DeleteFile` | `0x10559c` | `0x00020142` |
| | `+0x24` | `PxiArchive_DeleteDirectory` | `0x1057e8` | `0x00040142` |
| | `+0x34` | `PxiArchive_CreateFile` | `0x105558` | `0x00050202` |
| | `+0x38` | `PxiArchive_CreateDirectory` | `0x1057ac` | `0x00060182` |
| | `+0x3C` | `PxiArchive_RenameFile` | `0x1055d4` | `0x00030244` |
| | `+0x40` | `PxiArchive_RenameDirectory` | `0x105820` | `0x00070244` |
| fichier, `0x134b00` | `+0x00` | `PxiFile_destroy` | `0x105ed8` | `0x000F0080` |
| | `+0x08` | `PxiFile_Read` | `0x105df4` | `0x00090142` |
| | `+0x0C` | `PxiFile_Write` | `0x105918` | `0x000B0182` |
| | `+0x10` | `PxiFile_GetSize` | `0x105d8c` | `0x000D0080` |
| | `+0x14` | `PxiFile_SetSize` | `0x105dbc` | `0x000E0100` |
| dossier, `0x134b40` | `+0x00` | `PxiDirectory_destroy` | `0x106114` | `0x00110080` |
| | `+0x08` | `PxiDirectory_Read` | `0x1060c8` | `0x001000C2` |

La table d'archive a 17 cases et celle de fichier 14 : les autres n'ont pas été lues.

**Toutes les requêtes.** Chaque requête envoyée à Process9 a sa petite fonction en ARM, qui écrit un en-tête et appelle `svcSendSyncRequest`. Il y en a 83. La Carte des services n'a pas de table pour les canaux `PxiFS` : les noms ci-dessous ne viennent donc pas de 3dbrew. Une fonction porte le nom d'une commande quand la preuve est dans le code (colonne « Nom donné d'après ») : soit sa seule appelante est la fonction d'une commande de `fs:USER`, dont elle reprend le nom, soit elle est appelée par une méthode du tableau précédent ou par `pxi_open_archive`. Les autres gardent leur numéro.

| N° | En-tête | Fonction | Adresse | Appelée par | Nom donné d'après |
| --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x000101C2` | `PXIFS_OpenFile` | `0x130958` | `PxiArchive_OpenFile` (`0x106020`) | la fonction qui l'appelle |
| `0x0002` | `0x00020142` | `PXIFS_DeleteFile` | `0x12f494` | `PxiArchive_DeleteFile` (`0x10559c`) | la fonction qui l'appelle |
| `0x0003` | `0x00030244` | `PXIFS_RenameFile` | `0x12f5f4` | `PxiArchive_RenameFile` (`0x1055d4`) | la fonction qui l'appelle |
| `0x0004` | `0x00040142` | `PXIFS_DeleteDirectory` | `0x12fb50` | `PxiArchive_DeleteDirectory` (`0x1057e8`) | la fonction qui l'appelle |
| `0x0005` | `0x00050202` | `PXIFS_CreateFile` | `0x12f410` | `PxiArchive_CreateFile` (`0x105558`) | la fonction qui l'appelle |
| `0x0006` | `0x00060182` | `PXIFS_CreateDirectory` | `0x12fafc` | `PxiArchive_CreateDirectory` (`0x1057ac`) | la fonction qui l'appelle |
| `0x0007` | `0x00070244` | `PXIFS_RenameDirectory` | `0x12fc00` | `PxiArchive_RenameDirectory` (`0x105820`) | la fonction qui l'appelle |
| `0x0008` | `0x00080102` | `PXIFS_OpenDirectory` | `0x12f86c` | `PxiArchive_OpenDirectory` (`0x1056a0`) | la fonction qui l'appelle |
| `0x0009` | `0x00090142` | `PXIFS_ReadFile` | `0x1309cc` | `PxiFile_Read` (`0x105df4`) | la fonction qui l'appelle |
| `0x000A` | `0x000A00C2` | `PXIFS_cmd000A` | `0x12fd28` | `0x105be0` |  |
| `0x000B` | `0x000B0182` | `PXIFS_WriteFile` | `0x130a5c` | `PxiFile_Write` (`0x105918`) | la fonction qui l'appelle |
| `0x000C` | `0x000C0104` | `PXIFS_cmd000C` | `0x12fe08` | `0x105c16` |  |
| `0x000D` | `0x000D0080` | `PXIFS_GetFileSize` | `0x12f6b4` | `PxiFile_GetSize` (`0x105d8c`) | la fonction qui l'appelle |
| `0x000E` | `0x000E0100` | `PXIFS_SetFileSize` | `0x12f6f0` | `PxiFile_SetSize` (`0x105dbc`) | la fonction qui l'appelle |
| `0x000F` | `0x000F0080` | `PXIFS_CloseFile` | `0x130a2c` | `PxiFile_destroy` (`0x105ed8`) | la fonction qui l'appelle |
| `0x0010` | `0x001000C2` | `PXIFS_ReadDirectory` | `0x12f8cc` | `PxiDirectory_Read` (`0x1060c8`) | la fonction qui l'appelle |
| `0x0011` | `0x00110080` | `PXIFS_CloseDirectory` | `0x12f930` | `PxiDirectory_destroy` (`0x106114`) | la fonction qui l'appelle |
| `0x0012` | `0x001200C2` | `PXIFS_OpenArchive` | `0x12514c` | `pxi_open_archive` (`0x11e32c`) | la fonction qui l'appelle |
| `0x0013` | `0x00130102` | `PXIFS_cmd0013` | `0x1308f8` | `0x105fe8` |  |
| `0x0014` | `0x00140102` | `PXIFS_cmd0014` | `0x12f80c` | `0x10563a` |  |
| `0x0015` | `0x001500C0` | `PXIFS_cmd0015` | `0x12f960` | `PxiArchive_Control` (`0x105f2c`) |  |
| `0x0016` | `0x00160080` | `PXIFS_CloseArchive` | `0x12f780` | `PxiArchive_destroy` (`0x10616c`) | la fonction qui l'appelle |
| `0x0017` | `0x00170080` | `PXIFS_cmd0017` | `0x1300c8` | `0x110fc0` |  |
| `0x0018` | `0x00180000` | `PXIFS_GetCardType` | `0x12f680` | `fsuser_GetCardType` (`0x126ab4`) | la commande de `fs:USER` |
| `0x0019` | `0x00190000` | `PXIFS_GetSdmcArchiveResource` | `0x130480` | `fsuser_GetSdmcArchiveResource` (`0x1297dc`) | la commande de `fs:USER` |
| `0x001A` | `0x001A0000` | `PXIFS_GetNandArchiveResource` | `0x130440` | `fsuser_GetNandArchiveResource` (`0x1296cc`) | la commande de `fs:USER` |
| `0x001B` | `0x001B0000` | `PXIFS_GetSdmcFatfsError` | `0x12ff3c` | `fsuser_GetSdmcFatfsError` (`0x128560`) | la commande de `fs:USER` |
| `0x001C` | `0x001C0000` | `PXIFS_IsSdmcDetected` | `0x12fa1c` | `fsuser_IsSdmcDetected` (`0x127cb4`) | la commande de `fs:USER` |
| `0x001D` | `0x001D0000` | `PXIFS_IsSdmcWritable` | `0x12fa50` | `fsuser_IsSdmcWritable` (`0x127d18`) | la commande de `fs:USER` |
| `0x001E` | `0x001E0042` | `PXIFS_GetSdmcCid` | `0x12f56c` | `fsuser_GetSdmcCid` (`0x1268d4`) | la commande de `fs:USER` |
| `0x001F` | `0x001F0042` | `PXIFS_GetNandCid` | `0x12f4e4` | `fsuser_GetNandCid` (`0x1267d4`) | la commande de `fs:USER` |
| `0x0020` | `0x00200000` | `PXIFS_GetSdmcSpeedInfo` | `0x12fcf4` | `fsuser_GetSdmcSpeedInfo` (`0x1282f0`) | la commande de `fs:USER` |
| `0x0021` | `0x00210000` | `PXIFS_GetNandSpeedInfo` | `0x12fcc0` | `fsuser_GetNandSpeedInfo` (`0x128264`) | la commande de `fs:USER` |
| `0x0022` | `0x00220042` | `PXIFS_GetSdmcLog` | `0x12f5b0` | `fsuser_GetSdmcLog` (`0x126940`) | la commande de `fs:USER` |
| `0x0023` | `0x00230042` | `PXIFS_GetNandLog` | `0x12f528` | `fsuser_GetNandLog` (`0x126840`) | la commande de `fs:USER` |
| `0x0024` | `0x00240000` | `PXIFS_ClearSdmcLog` | `0x12f758` | `fsuser_ClearSdmcLog` (`0x126d30`) | la commande de `fs:USER` |
| `0x0025` | `0x00250000` | `PXIFS_ClearNandLog` | `0x12f730` | `fsuser_ClearNandLog` (`0x126cac`) | la commande de `fs:USER` |
| `0x0026` | `0x00260000` | `PXIFS_CardSlotIsInserted` | `0x130094` | `fsuser_CardSlotIsInserted` (`0x1287e8`) | la commande de `fs:USER` |
| `0x0027` | `0x00270000` | `PXIFS_CardSlotPowerOn` | `0x12fac8` | `fsuser_CardSlotPowerOn` (`0x127df0`) | la commande de `fs:USER` |
| `0x0028` | `0x00280000` | `PXIFS_CardSlotPowerOff` | `0x12fc8c` | `fsuser_CardSlotPowerOff` (`0x1281d8`) | la commande de `fs:USER` |
| `0x0029` | `0x00290000` | `PXIFS_CardSlotGetCardIFPowerStatus` | `0x130658` | `fsuser_CardSlotGetCardIFPowerStatus` (`0x129f40`) | la commande de `fs:USER` |
| `0x002A` | `0x002A0040` | `PXIFS_CardNorDirectCommand` | `0x1302b8` | `fsuser_CardNorDirectCommand` (`0x129190`) | la commande de `fs:USER` |
| `0x002B` | `0x002B0080` | `PXIFS_CardNorDirectCommandWithAddress` | `0x1307d0` | `fsuser_CardNorDirectCommandWithAddress` (`0x12a2dc`) | la commande de `fs:USER` |
| `0x002C` | `0x002C0082` | `PXIFS_CardNorDirectRead` | `0x12fe74` | `fsuser_CardNorDirectRead` (`0x128450`) | la commande de `fs:USER` |
| `0x002D` | `0x002D00C2` | `PXIFS_CardNorDirectReadWithAddress` | `0x130600` | `fsuser_CardNorDirectReadWithAddress` (`0x129e9c`) | la commande de `fs:USER` |
| `0x002E` | `0x002E0082` | `PXIFS_CardNorDirectWrite` | `0x130048` | `fsuser_CardNorDirectWrite` (`0x12874c`) | la commande de `fs:USER` |
| `0x002F` | `0x002F00C2` | `PXIFS_CardNorDirectWriteWithAddress` | `0x13070c` | `fsuser_CardNorDirectWriteWithAddress` (`0x12a1cc`) | la commande de `fs:USER` |
| `0x0030` | `0x003000C2` | `PXIFS_CardNorDirectRead_4xIO` | `0x130388` | `fsuser_CardNorDirectRead_4xIO` (`0x129578`) | la commande de `fs:USER` |
| `0x0031` | `0x00310082` | `PXIFS_CardNorDirectCpuWriteWithoutVerify` | `0x130884` | `fsuser_CardNorDirectCpuWriteWithoutVerify` (`0x12a718`) | la commande de `fs:USER` |
| `0x0032` | `0x00320040` | `PXIFS_CardNorDirectSectorEraseWithoutVerify` | `0x1308c8` | `fsuser_CardNorDirectSectorEraseWithoutVerify` (`0x12ab3c`) | la commande de `fs:USER` |
| `0x0033` | `0x00330080` | `PXIFS_cmd0033` | `0x12f9c0` | `0x10d132` |  |
| `0x0034` | `0x00340040` | `PXIFS_SetCardSpiBaudRate` | `0x130228` | `fsuser_SetCardSpiBaudRate` (`0x128c48`) | la commande de `fs:USER` |
| `0x0035` | `0x00350040` | `PXIFS_SetCardSpiBusMode` | `0x12ff70` | `fsuser_SetCardSpiBusMode` (`0x128644`) | la commande de `fs:USER` |
| `0x0036` | `0x00360040` | `PXIFS_SendInitializeInfoTo9` | `0x130358` | `fsuser_SendInitializeInfoTo9` (`0x129510`) | la commande de `fs:USER` |
| `0x0037` | `0x00370100` | `PXIFS_cmd0037` | `0x12fec4` | `0x10c6c0` |  |
| `0x0038` | `0x00380100` | `PXIFS_cmd0038` | `0x12ff00` | `0x10c6e0` |  |
| `0x0039` | `0x00390102` | `PXIFS_cmd0039` | `0x1302f0` | `0x10c700` |  |
| `0x003A` | `0x003A0100` | `PXIFS_cmd003A` | `0x1304c0` | `fsuser_TitleContentHasSeed` (`0x127240`), `fsuser_GetSpecialContentIndex` (`0x129840`) |  |
| `0x003B` | `0x003B00C2` | `PXIFS_cmd003B` | `0x130154` | `fsuser_GetLegacyRomHeader` (`0x128a08`), `fsuser_GetLegacyRomHeader2` (`0x128fd0`) |  |
| `0x003C` | `0x003C0102` | `PXIFS_cmd003C` | `0x130260` | `fsuser_GetLegacyBannerData` (`0x128f20`), `fsuser_Same` (`0x12a400`) |  |
| `0x003E` | `0x003E0000` | `PXIFS_DeleteSdmcRoot` | `0x12f998` | `fsuser_DeleteSdmcRoot` (`0x1279d0`) | la commande de `fs:USER` |
| `0x003F` | `0x003F0040` | `PXIFS_cmd003F` | `0x1305a8` | `0x10c738` |  |
| `0x0040` | `0x00400000` | `PXIFS_InitializeCtrFileSystem` | `0x1305d8` | `fsuser_InitializeCtrFileSystem` (`0x129b74`) | la commande de `fs:USER` |
| `0x0041` | `0x00410000` | `PXIFS_CreateSeed` | `0x12f46c` | `fsuser_CreateSeed` (`0x1266bc`) | la commande de `fs:USER` |
| `0x0042` | `0x00420042` | `PXIFS_GetSdmcCtrRootPath` | `0x1301a4` | `fsuser_GetSdmcCtrRootPath` (`0x128ab4`) | la commande de `fs:USER` |
| `0x0043` | `0x00430040` | `PXIFS_GetArchiveResource` | `0x130104` | `fsuser_GetArchiveResource` (`0x128904`) | la commande de `fs:USER` |
| `0x0044` | `0x00440002` | `PXIFS_ExportIntegrityVerificationSeed` | `0x13080c` | `fsuser_ExportIntegrityVerificationSeed` (`0x12a370`) | la commande de `fs:USER` |
| `0x0045` | `0x00450002` | `PXIFS_ImportIntegrityVerificationSeed` | `0x130848` | `fsuser_ImportIntegrityVerificationSeed` (`0x12a4b0`) | la commande de `fs:USER` |
| `0x0046` | `0x00460102` | `PXIFS_GetLegacySubBannerData` | `0x1303e0` | `fsuser_GetLegacySubBannerData` (`0x12961c`) | la commande de `fs:USER` |
| `0x0047` | `0x00470042` | `PXIFS_cmd0047` | `0x124ce4` | `0x10c674`, `0x123ed0` |  |
| `0x0048` | `0x004800C2` | `PXIFS_cmd0048` | `0x12f7b0` | `PxiArchive_Control` (`0x105f2c`) |  |
| `0x0049` | `0x00490102` | `PXIFS_cmd0049` | `0x12fba0` | `0x10c624` |  |
| `0x004A` | `0x004A0040` | `PXIFS_cmd004A` | `0x1301e8` | `0x10c650` |  |
| `0x004B` | `0x004B0000` | `PXIFS_StartDeviceMoveAsSource` | `0x13056c` | `fsuser_StartDeviceMoveAsSource` (`0x129bb8`) | la commande de `fs:USER` |
| `0x004C` | `0x004C0240` | `PXIFS_StartDeviceMoveAsDestination` | `0x13068c` | `fsuser_StartDeviceMoveAsDestination` (`0x12a09c`) | la commande de `fs:USER` |
| `0x004D` | `0x004D01C4` | `PXIFS_cmd004D` | `0x12fd78` | `0x105a8c` |  |
| `0x004E` | `0x004E0204` | `PXIFS_cmd004E` | `0x12ffa8` | `0x105c54` |  |
| `0x004F` | `0x004F0080` | `PXIFS_cmd004F` | `0x125450` | `0x11e25c` |  |
| `0x0050` | `0x00500040` | `PXIFS_SetPriority` | `0x1254f4` | `0x1004ca` | son usage (interprété) |
| `0x0051` | `0x00510040` | `PXIFS_SwitchCleanupInvalidSaveData` | `0x1306d4` | `fsuser_SwitchCleanupInvalidSaveData` (`0x12a138`) | la commande de `fs:USER` |
| `0x0052` | `0x00520042` | `PXIFS_cmd0052` | `0x13051c` | `0x10c698` |  |
| `0x0055` | `0x00550082` | `PXIFS_ReadNandReport` | `0x12fa84` | `fsuser_ReadNandReport` (`0x127d7c`) | la commande de `fs:USER` |
| `0x0056` | `0x00560102` | `PXIFS_cmd0056` | `0x130764` | `PxiArchive_Control` (`0x105f2c`) |  |

Trois requêtes vont à `sm` et non à Process9 : `SRV_RegisterClient` (`0x1242b0`, en-tête `0x00010002`), `SRV_RegisterService` (`0x115904`, `0x00030100`) et `SRV_GetServiceHandle` (`0x1251a8`, `0x00050100`).

## Partie 8 : les types d'archives

Une archive est désignée par un identifiant de 32 bits. Deux fonctions trient dessus, et il faut passer les deux :

- `check_archive_access` (`0x118ccc`) dit si l'identifiant est connu, puis si le programme y a droit.
- `fsmgr_open_archive` (`0x1189b8`) choisit la fonction d'ouverture, après avoir vérifié la forme du chemin d'archive.

Les deux sont en Thumb et trient par un arbre de comparaisons et des tables de saut d'un octet par case (pour la seconde : à `0x1189e4`, `0x1189f8` et `0x118a38`). Ghidra lit mal ces tables. Le tableau vient d'un script qui a exécuté les deux fonctions dans un émulateur pour chaque identifiant ; pour `fsmgr_open_archive`, il est recoupé avec les trois tables décodées à la main. La colonne « Nom » n'est pas lue dans le code et n'est pas dans la Carte des services : elle reprend 3dbrew de mémoire, à vérifier.

| Identifiant | Nom (de mémoire) | Chemin d'archive exigé | Ouverte par | Adresse |
| --- | --- | --- | --- | --- |
| `0x00000003` | le programme lui-même (romfs, exefs) | vide | `open_self_ncch_archive`, si la session est initialisée ; posée sur l'archive `0x2345678E` (partie 6) | `0x10d2a4` |
| `0x00000004` | sauvegarde du programme | vide | fonction non nommée ; un seul fichier de l'archive `0x2345678E` (partie 6) | `0x10e03c` |
| `0x00000005` | | | accepté au premier tri, inconnu au second (`0xC8804464`) | |
| `0x00000006` | données étendues | binaire, 12 octets | fonction non nommée | `0x119b08` |
| `0x00000007` | données étendues partagées | binaire, 12 octets | fonction non nommée | `0x10fd80` |
| `0x00000008` | sauvegarde système | binaire, 8 octets | fonction non nommée, si le premier octet vaut 0 ; sinon `0xE0C046F8` | `0x119a6c` |
| `0x00000009` | carte SD | n'importe lequel | `pxi_open_archive`, directement | `0x11e32c` |
| `0x0000000A` | carte SD, écriture seule | n'importe lequel | fonction non nommée | `0x10c364` |
| `0x12345678` | données étendues (BOSS) | binaire, 12 octets | la même que `0x00000006` | `0x119b08` |
| `0x12345679` | mémoire de la cartouche | n'importe lequel | `pxi_open_archive`, directement | `0x11e32c` |
| `0x1234567D`, `0x1234567E`, `0x1234567F` | NAND | n'importe lequel | `pxi_open_archive`, directement | `0x11e32c` |
| `0x12345680` | | n'importe lequel | `pxi_open_archive`, directement | `0x11e32c` |
| `0x12345681` | | binaire, 4 octets | fonction non nommée | `0x10e3c4` |
| `0x12345682` | | binaire, 12 octets | deux fonctions non nommées | `0x10ddb4`, `0x10c29c` |
| `0x2345678A` | contenu d'un titre désigné par son numéro | binaire, 16 octets | fonction non nommée | `0x10c758` |
| `0x2345678E` | | binaire, 8 octets | fonction non nommée ; réservée à `fs:LDR` | `0x10d1b0` |
| `0x567890AB` à `0x567890AF` | NAND (zones CTR et TWL) | n'importe lequel | `pxi_open_archive`, directement | `0x11e32c` |
| `0x567890B1` | | vide | fonction non nommée | `0x119960` |
| `0x567890B2` | | binaire, 12 octets | la même | `0x119960` |
| `0x567890B4` | | binaire, 12 octets | fonction non nommée | `0x10dd34` |

- Cela fait 25 identifiants ouverts, plus `0x00000005`. Tout autre identifiant est refusé dès le premier tri.
- « Directement » veut dire que `fs` ne fabrique rien : `pxi_open_archive` envoie `PXIFS_OpenArchive` (`0x001200C2`) avec l'identifiant et le chemin tels quels, et pose un objet `PxiArchive` sur la poignée rendue. C'est le cas de 11 identifiants, dont la carte SD.
- `pxi_open_archive` a 26 appelantes : les autres fonctions d'ouverture finissent presque toutes par ouvrir elles aussi une archive chez Process9, sous un autre identifiant, et posent un objet à elles par-dessus. `0x10c758`, par exemple, ouvre l'archive `0x2345678A`.
- `pxi_open_archive` garde les archives déjà ouvertes : une seconde ouverture avec le même identifiant et le même chemin rend la même poignée sans rien demander à Process9.

## Partie 9 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x14b088` | l'objet serveur |
| `0x13db30` | le gestionnaire : archives, fichiers et dossiers ouverts, registre des programmes, canaux |
| `0x143730` | l'objet « canaux » (le gestionnaire à `+0x5C00`) ; ses quatre poignées et ses trois réserves sont en partie 7 |
| `0x1446f0` | le registre des programmes (le gestionnaire à `+0x6BC0`) : 128 entrées de `0x38` octets |
| `0x13609c` | la poignée de la session avec `srv:` |
| `0x136010` et `0x13602c` | les numéros de deux cases du stockage local des fils : la session en cours, la priorité de la commande en cours |

L'objet serveur :

| Décalage | Contenu |
| --- | --- |
| `+0x00000` | les jeux de tampons libres, un bit par jeu |
| `+0x00018` | les jeux de trois tampons de `0x200` octets |
| `+0x06018` | les piles des quatre fils de service, `0x5000` octets chacune ; le bas de chacune est marqué `0xDEADBEEF` |
| `+0x1A018` | les quatre fils |
| `+0x1A038` | le signal « la liste a changé » |
| `+0x1A048` | le verrou de la liste |
| `+0x1A054` | la liste donnée à `svcReplyAndReceive` : le signal, puis jusqu'à 128 poignées de session |
| `+0x1A25C` | pour chaque session de la liste, un pointeur vers son objet |
| `+0x1A45C` | le nombre de sessions dans la liste |
| `+0x1A460` | le drapeau d'arrêt des fils de service |
| `+0x1A464` et `+0x1A468` | la file des commandes en attente et son verrou |
| `+0x1A474` | le nombre de commandes en cours de traitement |

Une session `fs:USER` ou `fs:LDR` (`0x1D8` octets) :

| Décalage | Contenu |
| --- | --- |
| `+0x000` | la table de méthodes (`0x1342e4`) |
| `+0x004` | la priorité de la session |
| `+0x008` | 32 cases de 12 octets : une poignée d'archive (64 bits) et sa priorité |
| `+0x188` | 1 après Initialize |
| `+0x189` | 0 pour `fs:USER`, 1 pour `fs:LDR` |
| `+0x190` à `+0x1C7` | les informations du programme, copiées du registre par Initialize |
| `+0x1C8` | un pointeur vers le gestionnaire |

La session d'un fichier ouvert (`0x28` octets) :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | la table de méthodes (`0x134338`) |
| `+0x04` | la priorité |
| `+0x09` | les droits demandés à l'ouverture |
| `+0x14` | un pointeur vers un bloc de `0x18` octets partagé entre les sessions du même fichier : la poignée du fichier (64 bits), un compteur, un verrou |
| `+0x18` | le décalage de base de la fenêtre (64 bits), 0 pour le fichier entier |
| `+0x20` | la taille de la fenêtre (64 bits), `-1` pour le fichier entier |

## Partie 10 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x123d9c` |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x124338` |
| ExitProcess | `0x03` | à la fin de `entry` | `0x122ac8` |
| CreateThread | `0x08` | `svcCreateThread` | `0x123dc0` |
| ExitThread | `0x09` | dans `thread_trampoline` | `0x124d48` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x124368` |
| GetThreadPriority | `0x0B` | `svcGetThreadPriority` | `0x124db0` |
| SetThreadPriority | `0x0C` | `svcSetThreadPriority`, et écrit sur place à 2 autres endroits | `0x125fa4` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x125f4c` |
| SignalEvent | `0x18` | écrit sur place, à 6 endroits |  |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x124320` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x11daa0` |
| CloseHandle | `0x23` | `svcCloseHandle`, et écrit sur place à 24 autres endroits | `0x12f288` |
| WaitSynchronization1 | `0x24` | `svcWaitSynchronization1`, et écrit sur place à 1 autre endroit | `0x126334` |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x123254` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x125f64` |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x125f9c` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x124d94` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x123d84` |
| SendSyncRequest | `0x32` | écrit sur place, à 86 endroits |  |
| GetThreadId | `0x37` | `svcGetThreadId` | `0x12323c` |
| Break | `0x3C` | dans `panic` | `0x11e1a8` |
| CreateSession | `0x49` | `svcCreateSession` | `0x11515c` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x123224` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x123de4` |
| StoreProcessDataCache | `0x53` | dans une fonction non nommée | `0x130c08` |
| FlushProcessDataCache | `0x54` | `svcFlushProcessDataCache` | `0x125f7c` |
| StartInterProcessDma | `0x55` | `svcStartInterProcessDma` | `0x125fac` |
| StopDma | `0x56` | dans une fonction non nommée | `0x1263f0` |
| GetDmaState | `0x57` | `svcGetDmaState` | `0x125f84` |

Les trois appels « Dma » servent à copier des données d'un processus à l'autre sans passer par un message : c'est le sens de leur nom, leurs appelantes n'ont pas été lues. Les verrous du module (`lock_enter` à `0x11e2e0`, `lock_leave` à `0x11dce8`) reposent sur `ArbitrateAddress`, comme dans `sm` et `hid`. `panic` (`0x11e1a8`) appelle `Break`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 136 commandes de `fs:USER`, les 15 d'un fichier, les 6 d'un dossier et les 7 de `fs:REG` : leur fonction et leur en-tête de réponse viennent de l'exécution de chaque aiguillage dans un émulateur ; dans les plages de numéros essayées (`0x0000` à `0x001F`, `0x0400` à `0x041F`, `0x0800` à `0x08FF`, `0x0C00` à `0x0C0F`), le code répond à toutes les commandes de 3dbrew et à aucune autre. Pour 54 commandes de `fs:USER`, 4 d'un fichier et 3 d'un dossier, l'en-tête que le code compare est exactement celui de 3dbrew.
- Le nom des fonctions de commande repose sur cette seule preuve : la position dans l'aiguillage et l'en-tête de 3dbrew. Leur corps n'a pas été lu, sauf pour celles de la partie 6.
- La chaîne du serveur : `svcReplyAndReceive` n'a qu'une appelante, `worker_thread_main`, et `svcCreateThread` n'est atteint que par `create_thread`, appelée de `fs_main` seulement. Vu dans le pseudo-code et dans le relevé des références.
- Les quatre tables de méthodes de session : lues dans les données, et recoupées par les fonctions qui les posent (`fs_main`, `fsuser_session_init`, `fsuser_OpenFile`, `fsuser_OpenDirectory`).
- Les 83 requêtes vers Process9 : l'en-tête de chacune vient de l'exécution de la fonction dans un émulateur jusqu'à son `svcSendSyncRequest`, et leur nombre colle au relevé des appels système (86 appels à `SendSyncRequest`, dont trois vers `sm`).
- Les méthodes des objets `PxiArchive`, `PxiFile` et `PxiDirectory` : la case de la table lue dans les données, et de l'autre côté la case que la commande de `fs:USER` du même nom finit par appeler (`+0x08` pour une lecture, `+0x0C` pour une écriture, `+0x20` pour DeleteFile, et ainsi de suite).
- Les identifiants d'archive que `fsmgr_open_archive` sait ouvrir : l'émulation et les trois tables de saut décodées à la main donnent la même liste. La liste de `check_archive_access` ne vient que de l'émulation ; elle contient les mêmes identifiants, plus `0x00000005`.
- `fs:LDR` partage tout avec `fs:USER` : un seul appel à `fsuser_session_init` avec le type en paramètre, et l'octet `+0x189` n'est lu que dans `archive_permission_check`.
- Les 43 commandes que Pokémon X envoie (29 de `fs:USER`, 10 d'un fichier, 4 d'un dossier) : la requête fabriquée par le jeu et la réponse écrite par l'aiguillage, mot par mot, chaque côté exécuté dans un émulateur. Le corps de la fonction de commande est lu en entier pour 36 d'entre elles ([contrat-fs](contrat-fs.md)).
- GetExtDataBlockSize : l'aiguillage ne regarde que le numéro `0x0854` (exécution avec cinq en-têtes dans le contrat, et colonne « numéro » de la table d'`emulate_dispatch.py`). L'en-tête de la requête est `0x08540100`, celui que le jeu écrit (partie 3).
- L'archive `0x00000003` posée sur `0x2345678E`, et la marque `IVFC` exigée par le lecteur de romfs : lues par le contrat, et les deux constantes retrouvées dans le module (`0x1193b4`, `0x107710`, `0x107890`).

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Tout le fonctionnement de `server_run_request` : la limite de trois commandes à la fois, la file d'attente, le changement de priorité du fil.
- Le rôle des champs de l'objet serveur et des deux objets de session (partie 9), et celui des trois réserves de mémoire de `fs_main`.
- Le choix du canal dans `pxi_acquire_session`, et le sens des valeurs `-16`, `0` et `16` vues comme « temps réel », « normal » et « arrière-plan ». Le nom `PXIFS_SetPriority` vient de là.
- Le découpage de la lecture en morceaux dans `PxiFile_Read` et le traitement de l'alignement dans `file_session_read`.
- Le rôle de `session_close_archive` à la fin d'OpenFileDirectly, et le fait que `pxi_open_archive` réutilise une archive déjà ouverte.
- L'étage intermédiaire de l'archive `0x00000003`, lu par le contrat des fichiers : le rôle des 16 octets ajoutés au chemin envoyé à Process9 est supposé (le fichier `/SEEDDB` est une piste), les trois étages du lecteur de romfs sont déduits des arguments de `0x107240`, et le contrôle des empreintes dans `fs` repose sur les constantes SHA-256 du module et sur la seconde lecture après `0xD9004586`, pas sur l'appel suivi.
- La sauvegarde vue comme un seul fichier chez Process9 et une arborescence dans `fs` : déduit de `0x10e03c` et de `0x118ed0`, quelques lignes chacune.
- Ce que font les commandes de `fs:REG`, déduit de quelques lignes chacune.
- Le sens des codes d'erreur : `0xE0E046BE` (archive inconnue ou chemin de la mauvaise forme), `0xC8804464` (archive inconnue au second tri), `0xE0C046F8` (pas fait), `0xE0A046DA` (session non initialisée).
- Les noms de la partie 8, repris de 3dbrew de mémoire.

**Pas lu**
- Le corps de presque toutes les commandes de `fs:USER` : seules OpenFileDirectly, OpenFile, OpenArchive et Initialize ont été lues ici, et les commandes que Pokémon X envoie dans le contrat des fichiers. Pour sept de celles-ci (GetFormatInfo, FormatSaveData, CreateExtSaveData, DeleteExtSaveData, GetExtDataBlockSize, et les deux SecureValue), seuls les contrôles sont lus, pas le travail fait derrière (`0x10e134`, `0x1150c0`, `0x10f830`, `0x10f2cc`, `0x118532`, `0x10f85c`, `0x11984c`, `0x1198cc`).
- L'objet « sauvegarde » (`0xCDC` octets, table `0x1356a4`) et ceux des données étendues : les codes d'erreur d'un fichier absent ou déjà présent ne sont donc pas connus.
- Les fonctions d'ouverture d'archive autres que `pxi_open_archive`, et les classes d'archive que `fs` fabrique lui-même : sauvegardes, données étendues, le fichier `/Quota.dat`, les fichiers `/SEEDDB` et `/TITLETAG` dont les noms sont dans les données.
- Les règles de `archive_permission_check` : quels droits de l'exheader ouvrent quelle archive.
- Les deux fonctions qui prennent un canal dans une réserve (`0x131dac` sans attendre, `0x100988` en attendant) : leur rôle est déduit de l'endroit où elles sont appelées.
- Les 17 autres fonctions d'initialisation des objets globaux, la gestion de la mémoire, les trois appels système de copie entre processus.
- Les priorités des fils : le code passe des constantes codées (`0x6C8DA519` à la création des fils de service) qui n'ont pas été décodées.
- 1 665 fonctions restent sans nom.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système, nommer leurs enveloppes, trouver les fonctions ARM manquées | `outils/prescan.py`, par le pont REA | 46 secondes par passage, deux passages |
| Trouver les fonctions Thumb manquées et les donner à Ghidra | un script Python, puis Ghidra sans interface avec deux scripts à lui | 50 secondes par passage |
| Décompiler les 1 995 fonctions et relever toutes les références | le même passage de Ghidra | compris |
| Suivre les quatre aiguillages, les 83 requêtes et le tri des archives | trois scripts qui exécutent le code dans un émulateur | quelques secondes |
| Lire le pseudo-code du chemin de la partie 6 et nommer | Claude | le gros du temps |
| Recouper avec la Carte des services | un script | immédiat |

**Le piège principal : le Thumb.** Les trois quarts de `fs` sont en Thumb, le jeu d'instructions court de l'ARM, et presque toutes les méthodes des objets ne sont appelées que par une table. Le fichier contient près de 600 pointeurs vers du code Thumb. Par le pont REA, Ghidra ne trouvait que 1 637 fonctions : il en manquait 358, dont `PxiFile_Read`. Le fichier de graines ne peut pas les lui donner, parce qu'une ligne `function` y est toujours désassemblée en ARM. Deux contournements :

- Pour l'analyse, Ghidra a été lancé directement, sans REA, avec un script qui pose chaque graine dans le bon mode. Tout est dans `local/analyse/fs/ghidra/` (`run.sh`, `FsPre.java`, `FsDump.java`) ; le pseudo-code est dans `local/analyse/fs/gh/pseudo/`.
- Pour les noms, les fonctions Thumb sont dans `fs.noms.tsv` en lignes `label` et non `function` : une étiquette ne force aucun désassemblage, et quand Ghidra crée la fonction à cet endroit, elle prend le nom. Vérifié par le pont REA : 320 noms sur 330 s'appliquent. Les 10 autres restent de simples étiquettes sur des fonctions que REA ne voit pas.

**Attention : ne pas repasser `prescan.py` sur `fs` tel quel.** Il réécrit toutes les lignes de `fs.noms.tsv` en `function`. Les 37 fonctions Thumb nommées seraient alors désassemblées en ARM, et le pseudo-code serait faux sans aucun message.

**Trois autres choses à savoir en relisant dans Ghidra.**
- Pour créer à la main une fonction Thumb : se placer sur l'adresse, touche F12 (désassembler en Thumb), puis F. Les adresses des fonctions Thumb sont paires dans cette fiche ; dans les tables de méthodes elles sont rangées avec un bit de plus (`0x105df5` pour `0x105df4`).
- `__ARM_common_switch8` (`0x11a60c`) n'est pas une fonction ordinaire : c'est l'aide que le compilateur appelle pour chaque « switch » en Thumb, suivie d'une table d'un octet par case. Tant que Ghidra la prend pour un appel, il perd tout le code qui suit. Il faut lui donner le réglage « Call Fixup » `switch8_r3` (dans la fenêtre d'édition de la fonction). Le nom seul ne suffit pas, c'est `FsPre.java` qui le pose. Même ainsi, `fsmgr_open_archive` et `check_archive_access` sortent mal : pour elles, se fier au tableau de la partie 8.
- Au premier passage, `prescan.py` a proposé une fausse graine, `0x12100c` : un nombre rangé dans le code ressemblait à une adresse et tombait au milieu d'une fonction Thumb. Elle a été retirée à la main. Il a aussi nommé `entry` « svcExitProcess », parce que c'est une fonction courte avec un seul appel système.

**Pour reprendre.** `fs.noms.tsv` porte 330 noms. Ceux en `fsuser_`, `fsfile_`, `fsdir_` et `fsreg_` sont les commandes reçues ; ceux en `PXIFS_` les requêtes envoyées à Process9 ; ceux en `SRV_` les requêtes envoyées à `sm` ; ceux en `PxiArchive_`, `PxiFile_` et `PxiDirectory_` les méthodes des objets posés sur Process9. Les scripts sont dans `local/analyse/fs/`, non versionné : `dispatch.py` (les aiguillages), `stubs.py` (les requêtes), `archives.py` (le tri des archives), `vt.py` (les tables de méthodes), `q.py` (qui appelle qui), `names.py` (qui fabrique le fichier de noms), `mkfiche.py` (qui remplit les tableaux de cette fiche). `capstone` et `unicorn`, le désassembleur et l'émulateur dont ils se servent, sont installés dans `local/analyse/fs/pylib/` et nulle part ailleurs.
