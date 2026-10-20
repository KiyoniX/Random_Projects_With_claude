# am, le gestionnaire d'applications

`am` (Application Manager) tient la liste des titres installés (jeux, applications, mises à jour, contenus additionnels), leurs tickets, et installe ou supprime un titre. Il ne fait presque rien lui-même : **c'est un relais**. Chaque commande qu'il reçoit (de `ns`, `nim`, `act`, `dlp`, le menu HOME...) est vérifiée, puis renvoyée sous la forme d'une commande de `pxi:am9`, le service de Process9 (l'ARM9) qui touche vraiment aux fichiers de titres, aux tickets et au chiffrement. Les deux seules choses qu'`am` garde pour lui sont ses propres contrôles (forme de la requête, taille des tampons) et quelques commandes locales (état de l'installation, mutex de mise à jour du système).

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, le module est presque tout en Thumb), `outils/emulate_dispatch.py` sur les quatre aiguillages (de 0 à 0xFFFF), la page Application_Manager_Services de 3dbrew relue par `web.archive.org`, la Carte des services, et la table de `pxi:am9` de `process9.md`. Les adresses sont celles du module chargé à `0x00100000`. **Aucune clé, aucun certificat, aucun identifiant de console n'est écrit ici** : la fiche dit où ces données passent, pas leur valeur.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001502`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `am`, priorité 60 (`0x3C`) |
| Fichier lu | `local/extrait/am/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x11D60` octets de code (`0x12` pages), `0xBD4` de données en lecture seule (1 page), `0x4DC` de données (1 page), `0x4E20` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 1 081 pour Ghidra (1 022 en Thumb, 59 en ARM), plus 74 entrées manquées, moins 248 qui ne sont pas des fonctions (cas des quatre aiguillages, suites que Ghidra coupe après `ipc_set_header`, rangs de la division, morceaux de l'automate d'importation) et 3 fonctions mortes (`__aeabi_memmove` `0x111848`, `__ARM_exceptions_buffer_allocate`/`_free` `0x102096`/`0x1020B0`) : 904 ; code mort hors liste `__aeabi_idivmod` (`0x106E5C`) ; 294 nommées dans `am.noms.tsv` (dont 2 sur des morceaux, `0x106DFC` et `0x10C404`, et 1 sur du code mort), 887 (888 avec `__aeabi_idiv0_return`) avec `local/analyse/am/noms-proposes.tsv` |
| Services offerts | `am:app`, `am:sys`, `am:u`, `am:net` (enregistrés auprès de `sm`), et un cinquième port **sans nom**, `am:pipe` (voir la partie 1) |
| Services appelés | `pxi:am9` (chaîne à `0x112060`, ouvert par `am_connect_pxi_am9`, `0x100534`) et `fs:USER` (chaîne à `0x1123A3`, ouvert par `fs_init`, `0x1005D8`) : les deux entrées de l'exheader ; plus `srv:` (`SRV_RegisterClient`, `SRV_GetServiceHandle`, `SRV_EnableNotification`, `SRV_ReceiveNotification`, `SRV_RegisterService`, `SRV_UnregisterService`) et `err:f` (`ERRF_Throw`), que l'exheader n'énumère pas. La Carte relève `pxi:am9` et `fs:USER` ; `srv:` et `err:f` n'y sont pas |
| Appelants connus | `ns` (`am:u`, 21 commandes, `fiches/ns.md`) ; `nim` et `act` (`am:net`) ; `dlp` (`am:u`) ; `friend`, `menu` et `mint` (`am:sys`) ; `maj` et `skater` (`am:app`) : ces sept d'après leurs exheaders. Pokémon X ne parle pas à `am` (aucune des 408 fonctions d'envoi de `pokemon-x-services.md`) |
| Noms de services dans le module | `fs:LDR`, `srv:pm` (`0x11239C`, `0x1123C9`) : la liste de noms de la bibliothèque commune, pas des sessions ouvertes par `am` |

## Partie 1 : le démarrage et le serveur

`entry` (`0x100000`) appelle les initialiseurs puis `am_main` (`0x100048`, 742 octets). Dans l'ordre :

1. **Prépare** le tas et une file de travail (`am_create_work_queue`, `0x100438`, sur une réserve de cinq éléments de `0x1C` octets, `am_work_item_pool_init` `0x100574` : cinq fils de session au plus en même temps), ouvre `pxi:am9` (`am_connect_pxi_am9`, `0x100534`), ouvre `fs:USER` (`fs_init`, `0x1005D8`), ouvre la base « amsa » (`am_database_open`, `0x10087C`), et inscrit l'objet `0x113568` pour la notification `0x100` (`register_notification_handler`, `0x1006F0`) ; la case 0 de sa table `0x112900`, `am_on_terminate_notification` (`0x10F214`), lève l'indicateur d'arrêt `0x113578`.
2. **Enregistre les services.** Une boucle sur la table de pointeurs de noms `0x113290` (cinq entrées : `am:app` `0x112258`, `am:sys` `0x11225F`, `am:u` `0x112266`, `am:net` `0x11226B`, `am:pipe` `0x112272`) envoie à `sm` `RegisterService` (`SRV_RegisterService`, `0x100760`, en-tête `0x00030100`, dernier mot 5 : le nombre maximal de sessions d'après 3dbrew) **pour les quatre premiers seulement**. Le cinquième port est créé par `CreatePort` (`svcCreatePort`, `0x110F18`) sans nom. Cela s'accorde avec 3dbrew : « la chaîne `am:pipe` n'est en fait pas utilisée ».
3. **Boucle** sur six poignées (`svc_wait_synchronization`, `0x10A958`) : les cinq ports puis le sémaphore des notifications (`get_notification_semaphore`). Port 0 à 3 : `AcceptSession` (`svcAcceptSession`, `0x110F00`), puis `am_start_service_worker` (`0x100494`) prend un élément de la file (`am_work_queue_take`, `0x100A24`) et lance **un fil par session** (`am_create_worker_thread`, `0x100AB8`, pile de `0x1000`, entrée prise dans la table `0x1122F0`) ; à la fin de la session, `am_session_thread_body` (`0x10D66C`) rend l'élément (`am_work_queue_release`, `0x103392`). Port 4 (`am:pipe`) : un fil à part (`am_pipe_thread_main`, `0x1003E0`) qui sert la session du fichier d'importation (`am_pipe_serve_session` `0x1010B4`, `am_pipe_dispatch_command` `0x1016E8`, partie 3). Notification : `handle_srv_notification` appelle `am_on_terminate_notification`, qui lève l'indicateur d'arrêt (`0x113578`).
4. À l'arrêt : retire les services, ferme les sessions, rend la main.

Chaque fil de session fait la même chose : son entrée appelle `am_session_thread_body_thunk` (`0x106FD8`), qui mène à `am_session_thread_body` (`0x10D66C`) : celle-ci lit la poignée `pxi:am9` (`am_get_pxi_am9_handle`) et appelle la boucle du service (`am_<service>_service_loop`) : `svcReplyAndReceive` (`0x10A18C`) sur sa session, puis l'aiguillage de son service avec l'adresse de la poignée `pxi:am9` en premier argument. La table des entrées de fils (`0x1122F0`) est dans l'ordre des ports :

| Port | Service | Entrée du fil | Boucle de service | Aiguillage | Commandes (émulées) |
| --- | --- | --- | --- | --- | --- |
| 0 | `am:app` | `0x110C34` | `0x103C8C` | `am_app_dispatch_command` `0x105008` | 13 |
| 1 | `am:sys` | `0x110C24` | `0x103C18` | `am_sys_dispatch_command` `0x103DE8` | 58 |
| 2 | `am:u` | `0x110C44` | `0x103D00` | `am_u_dispatch_command` `0x105540` | 83 |
| 3 | `am:net` | `0x110C54` | `0x103D74` | `am_net_dispatch_command` `0x10AA54` | 124 |

Le rapprochement port - aiguillage vient du pseudo-code (chaque entrée de fil appelle sa boucle, chaque boucle appelle son aiguillage) et des ensembles de commandes, qui sont ceux de 3dbrew : `am:app` n'a que les `0x10xx`, `am:sys` y ajoute les `0x00xx`, `am:u` les `0x04xx`, `am:net` les `0x08xx`.

Appels système trouvés (leurs enveloppes sont en `0x10A1xx`, `0x10A6xx`, `0x10A7xx`, `0x10A9xx` et `0x110Exx` à `0x111Cxx`) : 0x01 ControlMemory, 0x02 QueryMemory, 0x03 ExitProcess (`0x110EF8`), 0x08 CreateThread (`0x111274`), 0x09 ExitThread (`0x111364`), 0x0A SleepThread (`0x1112F0`), 0x13 CreateMutex, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x25 WaitSynchronizationN, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest (`0x10A61C`), 0x35 GetProcessId, 0x37 GetThreadId, 0x3C Break, 0x47 CreatePort, 0x48 CreateSessionToPort, 0x4A AcceptSession, 0x4F ReplyAndReceive (`0x10A18C`). La création de fils passe par `create_thread_wrapper` (`0x10A8A0`), `create_thread` (`0x101274`) et `create_thread_impl` (`0x101B30`), qui prépare le haut de pile et appelle `svcCreateThread` avec `thread_trampoline`. Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les quatre aiguillages

Chaque aiguillage lit le numéro dans les 16 bits du haut de l'en-tête (`bitfield_extract`, `0x109EE0`, bits 16 à 31), saute à un cas, vérifie l'en-tête et les descripteurs de tampon (`ipc_check_header` `0x109EA8`, `ipc_is_read_buffer_desc` `0x109E60`, `ipc_is_write_buffer_desc` `0x109E4A`), appelle le gestionnaire, puis fabrique l'en-tête de réponse (`ipc_set_header`, `0x10A638`). Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F` (celui des autres modules). Les aiguillages sont plus longs que ce que Ghidra a vu : leurs cas, atteints par des b ou par des bl employés comme sauts longs, sont listés « pas une fonction » dans `local/analyse/am/noms-proposes.tsv`.

Les quatre aiguillages ont été exécutés par `emulate_dispatch.py am 0x105008=app 0x103de8=sys 0x105540=u 0x10aa54=net` (de 0 à 0xFFFF ; 9 minutes pour les quatre) :

| Aiguillage | Commandes trouvées | Numéros |
| --- | --- | --- |
| `am:app` | 13 | `0x1001` à `0x100D` |
| `am:sys` | 58 | `0x0001` à `0x002D` (45), plus les 13 de `am:app` |
| `am:u` | 83 | `sys` plus `0x0401` à `0x0419` (25) |
| `am:net` | 124 | `u` plus `0x0801` à `0x0829` (41) |

**Chaque service contient les commandes du précédent.** Les gestionnaires sont les mêmes d'un service à l'autre : un numéro donné mène à la même adresse dans les trois ou quatre aiguillages qui l'ont (vérifié par comparaison des tables émulées ; la seule différence apparente, `0x0418` et `0x0419` dans `am:u`, vient de l'émulation, voir plus bas). Les 13 commandes de `am:app` sont donc aussi atteignables par `am:sys`, `am:u` et `am:net`, ce que la Carte ne note que pour `am:sys` (« 58 commandes » = 45 + 13) ; pour `am:u` elle compte 70 (45 + 25) et pour `am:net` 111 (45 + 25 + 41) : **le code en accepte 83 et 124**. 3dbrew dit pourtant que seul `am:sys` « a accès aux commandes `0x00XX` et à celles d'`am:app` » : la phrase décrit ce que `am:sys` n'a pas en plus, pas ce que `am:u` et `am:net` n'ont pas.

## Partie 3 : les commandes

Les noms et les en-têtes sont ceux de la Carte des services (tirés de 3dbrew). « Source » dit d'où vient l'adresse du gestionnaire : `émulation` (`emulate_dispatch.py`), `pseudo-code` (le gestionnaire est appelé par un cas lisible dans le pseudo-code de l'aiguillage ; l'émulation refusait ces douze commandes parce qu'elles exigent des descripteurs de tampon qu'elle n'a pas su fabriquer), `interprété`. La dernière colonne est la **seconde voie** : la ou les commandes de `pxi:am9` que le gestionnaire (et ses sous-fonctions, trois niveaux) fabrique avec `ipc_make_header`, avec le nom de `process9.md`.

#### 0x0001 à 0x002D : `am:sys`, `am:u`, `am:net`

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Envoie à `pxi:am9` |
| --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010040` | GetNumPrograms | `am_cmd_0001_GetNumPrograms` | `0x108334` | émulation | 0x1 GetTitleCount |
| 0x2 | `0x00020082` | GetProgramList | `am_cmd_0002_GetProgramList` | `0x108322` | émulation | 0x2 GetTitleList |
| 0x3 | `0x00030084` | GetProgramInfos | `am_cmd_0003_GetProgramInfos` | `0x10830C` | interprété | 0x3 GetTitleInfo |
| 0x4 | `0x000400C0` | DeleteUserProgram | `am_cmd_0004_DeleteUserProgram` | `0x1082D8` | émulation | 0x4 DeleteTitle |
| 0x5 | `0x000500C0` | GetProductCode | `am_cmd_0005_GetProductCode` | `0x1082B8` | émulation | 0x5 GetTitleProductCode |
| 0x6 | `0x000600C0` | GetStorageId | `am_cmd_0006_GetStorageId` | `0x10829A` | émulation | 0x6 GetTitleExtDataId |
| 0x7 | `0x00070080` | DeleteTicket | `am_cmd_0007_DeleteTicket` | `0x10828E` | émulation | 0xD DeleteTicket |
| 0x8 | `0x00080000` | GetNumTickets | `am_cmd_0008_GetNumTickets` | `0x108282` | émulation | 0xE GetTicketCount |
| 0x9 | `0x00090082` | GetTicketList | `am_cmd_0009_GetTicketList` | `0x108272` | émulation | 0xF GetTicketList |
| 0xA | `0x000A0000` | GetDeviceId | `am_cmd_000A_GetDeviceId` | `0x108266` | émulation | 0x3C GetDeviceID |
| 0xB | `0x000B0040` | GetNumImportTitleContexts | `am_cmd_000B_GetNumImportTitleContexts` | `0x10825A` | émulation | 0x1D GetPendingTitleCount |
| 0xC | `0x000C0082` | GetImportTitleContextList | `am_cmd_000C_GetImportTitleContextList` | `0x108248` | émulation | 0x1E GetPendingTitleList |
| 0xD | `0x000D0084` | GetImportTitleContexts | `am_cmd_000D_GetImportTitleContexts` | `0x108728` | pseudo-code | 0x1F GetPendingTitleInfo |
| 0xE | `0x000E00C0` | DeleteImportTitleContext | `am_cmd_000E_DeleteImportTitleContext` | `0x108238` | émulation | 0x20 DeletePendingTitle |
| 0xF | `0x000F00C0` | GetNumImportContentContexts | `am_cmd_000F_GetNumImportContentContexts` | `0x10821A` | émulation | 0x21 GetNumImportContentContexts |
| 0x10 | `0x00100102` | GetImportContentContextList | `am_cmd_0010_GetImportContentContextList` | `0x1081FA` | émulation | 0x22 GetImportContentContextList |
| 0x11 | `0x00110104` | GetImportContentContexts | `am_cmd_0011_GetImportContentContexts` | `0x1081DA` | pseudo-code | 0x23 GetImportContentContexts |
| 0x12 | `0x00120102` | DeleteImportContentContexts | `am_cmd_0012_DeleteImportContentContexts` | `0x1081BC` | émulation | 0x24 DeleteImportContentContexts |
| 0x13 | `0x00130040` | NeedsCleanup | `am_cmd_0013_NeedsCleanup` | `0x1081AC` | émulation | 0x3F IsImportDatabaseInitialized |
| 0x14 | `0x00140040` | DoCleanup | `am_cmd_0014_DoCleanup` | `0x10819C` | émulation | 0x40 DoCleanup |
| 0x15 | `0x00150040` | DeleteAllImportContexts | `am_cmd_0015_DeleteAllImportContexts` | `0x108190` | émulation | 0x7 DeletePendingTitles |
| 0x16 | `0x00160000` | DeleteAllTemporaryPrograms | `am_cmd_0016_DeleteAllTemporaryPrograms` | `0x108184` | émulation | 0x41 DeleteAllTemporaryPrograms |
| 0x17 | `0x00170044` | ImportTwlBackupLegacy | dans l'aiguillage | | émulation | |
| 0x18 | `0x00180080` | InitializeTitleDatabase | `am_cmd_0018_InitializeTitleDatabase` | `0x108156` | émulation | 0x47 InitializeTitleDatabase |
| 0x19 | `0x00190040` | QueryAvailableTitleDatabase | `am_cmd_0019_QueryAvailableTitleDatabase` | `0x108668` | émulation | 0x48 ReloadDBS |
| 0x1A | `0x001A00C0` | CalcTwlBackupSize | `am_cmd_001A_CalcTwlBackupSize` | `0x10814A` | émulation | 0x4F GetDSiWareExportSize |
| 0x1B | `0x001B0144` | ExportTwlBackup | `am_cmd_001B_ExportTwlBackup` | `0x108134` | émulation | 0x4D ExportDSiWare |
| 0x1C | `0x001C0084` | ImportTwlBackup | `am_cmd_001C_ImportTwlBackup` | `0x107D48` | émulation | 0x53 ValidateDSiWareMovableSedHash, 0x43 VerifyDSiWareFooter, 0x2A CommitImportPrograms ... |
| 0x1D | `0x001D0000` | DeleteAllTwlUserPrograms | `am_cmd_001D_DeleteAllTwlUserPrograms` | `0x107D3A` | émulation | 0x51 DeleteAllTwlUserPrograms |
| 0x1E | `0x001E00C8` | ReadTwlBackupInfo | `am_cmd_001E_ReadTwlBackupInfo` | `0x107D14` | émulation | aucun (local) |
| 0x1F | `0x001F0040` | DeleteAllExpiredUserPrograms | `am_cmd_001F_DeleteAllExpiredUserPrograms` | `0x107D04` | émulation | 0x52 DeleteAllExpiredUserPrograms |
| 0x20 | `0x00200000` | GetTwlArchiveResourceInfo | `am_cmd_0020_GetTwlArchiveResourceInfo` | `0x107CF6` | émulation | 0x54 GetTWLPartitionInfo |
| 0x21 | `0x00210042` | GetPersonalizedTicketInfoList | `am_cmd_0021_GetPersonalizedTicketInfoList` | `0x107CEA` | émulation | 0x4C GetPersonalizedTicketInfoList |
| 0x22 | `0x00220080` | DeleteAllImportContextsFiltered | `am_cmd_0022_DeleteAllImportContextsFiltered` | `0x108884` | émulation | 0x7 DeletePendingTitles |
| 0x23 | `0x00230080` | GetNumImportTitleContextsFiltered | `am_cmd_0023_GetNumImportTitleContextsFiltered` | `0x108782` | émulation | 0x1D GetPendingTitleCount |
| 0x24 | `0x002400C2` | GetImportTitleContextListFiltered | `am_cmd_0024_GetImportTitleContextListFiltered` | `0x108792` | émulation | 0x1E GetPendingTitleList |
| 0x25 | `0x002500C0` | CheckContentRights | `am_cmd_0025_CheckContentRights` | `0x107CDA` | émulation | 0x56 CheckContentRights |
| 0x26 | `0x00260044` | GetTicketLimitInfos | `am_cmd_0026_GetTicketLimitInfos` | `0x1088F8` | pseudo-code | 0x62 GetTicketLimitInfos |
| 0x27 | `0x00270044` | GetDemoLaunchInfos | `am_cmd_0027_GetDemoLaunchInfos` | `0x1088E8` | pseudo-code | aucun (local) |
| 0x28 | `0x00280108` | ReadTwlBackupInfoEx | `am_cmd_0028_ReadTwlBackupInfoEx` | `0x107CB4` | émulation | aucun (local) |
| 0x29 | `0x00290082` | DeleteUserProgramsAtomically | `am_cmd_0029_DeleteUserProgramsAtomically` | `0x107C74` | émulation | 0x67 DeleteProgramsAtomically |
| 0x2A | `0x002A00C0` | GetNumExistingContentInfos | `am_cmd_002A_GetNumExistingContentInfos` | `0x107C54` | émulation | 0x6A GetNumExistingContentInfos |
| 0x2B | `0x002B0142` | ListExistingContentInfos | `am_cmd_002B_ListExistingContentInfos` | `0x107C30` | émulation | 0x6B ListExistingContentInfos |
| 0x2C | `0x002C0084` | GetProgramInfosIgnorePlatform | `am_cmd_002C_GetProgramInfosIgnorePlatform` | `0x107B94` | pseudo-code | 0x3 GetTitleInfo |
| 0x2D | `0x002D00C0` | CheckContentRightsIgnorePlatform | `am_cmd_002D_CheckContentRightsIgnorePlatform` | `0x107B38` | émulation | 0x56 CheckContentRights |

#### 0x0401 à 0x0419 : `am:u`, `am:net`

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Envoie à `pxi:am9` |
| --- | --- | --- | --- | --- | --- | --- |
| 0x401 | `0x04010080` | UpdateFirmwareTo | `am_cmd_0401_UpdateFirmwareTo` | `0x107B2C` | émulation | 0x8 InstallFIRM |
| 0x402 | `0x04020040` | BeginImportProgram | `am_cmd_0402_BeginImportProgram` | `0x107B06` | émulation | aucun (local) |
| 0x403 | `0x04030000` | BeginImportProgramTemporarily | `am_cmd_0403_BeginImportProgramTemporarily` | `0x107AE4` | émulation | aucun (local) |
| 0x404 | `0x04040002` | CancelImportProgram | `am_cmd_0404_CancelImportProgram` | `0x107AA8` | émulation | aucun (local) |
| 0x405 | `0x04050002` | EndImportProgram | `am_cmd_0405_EndImportProgram` | `0x107A44` | émulation | 0x29 InstallTitleFinish, 0x2A CommitImportPrograms |
| 0x406 | `0x04060002` | EndImportProgramWithoutCommit | `am_cmd_0406_EndImportProgramWithoutCommit` | `0x108E20` | émulation | 0x29 InstallTitleFinish |
| 0x407 | `0x040700C2` | CommitImportPrograms | `am_cmd_0407_CommitImportPrograms` | `0x108E08` | émulation | 0x2A CommitImportPrograms |
| 0x408 | `0x04080042` | GetProgramInfoFromCia | `am_cmd_0408_GetProgramInfoFromCia` | `0x1079C6` | émulation | aucun (local) |
| 0x409 | `0x04090004` | GetSystemMenuDataFromCia | `am_cmd_0409_GetSystemMenuDataFromCia` | `0x10794A` | émulation | aucun (local) |
| 0x40A | `0x040A0002` | GetDependencyListFromCia | `am_cmd_040A_GetDependencyListFromCia` | `0x1078CE` | émulation | aucun (local) |
| 0x40B | `0x040B0002` | GetTransferSizeFromCia | `am_cmd_040B_GetTransferSizeFromCia` | `0x107852` | émulation | aucun (local) |
| 0x40C | `0x040C0002` | GetCoreVersionFromCia | `am_cmd_040C_GetCoreVersionFromCia` | `0x1077D6` | émulation | aucun (local) |
| 0x40D | `0x040D0042` | GetRequiredSizeFromCia | `am_cmd_040D_GetRequiredSizeFromCia` | `0x107778` | émulation | aucun (local) |
| 0x40E | `0x040E00C2` | CommitImportProgramsAndUpdateFirmwareAuto | `am_cmd_040E_CommitImportProgramsAndUpdateFirmwareAuto` | `0x107768` | émulation | 0x2A CommitImportPrograms, 0x42 InstallTitlesFinishFIRM |
| 0x40F | `0x040F0000` | UpdateFirmwareAuto | `am_cmd_040F_UpdateFirmwareAuto` | `0x107738` | émulation | 0x8 InstallFIRM, 0x3 GetTitleInfo, 0x2 GetTitleList ... |
| 0x410 | `0x041000C0` | DeleteProgram | `am_cmd_0410_DeleteProgram` | `0x107728` | émulation | 0x4 DeleteTitle |
| 0x411 | `0x04110044` | GetTwlProgramListForReboot | `am_cmd_0411_GetTwlProgramListForReboot` | `0x107718` | pseudo-code | 0x50 GetTwlProgramListForReboot |
| 0x412 | `0x04120000` | GetSystemUpdaterMutex | `am_cmd_0412_GetSystemUpdaterMutex` | `0x107708` | émulation | aucun (local) |
| 0x413 | `0x04130002` | GetMetaSizeFromCia | `am_cmd_0413_GetMetaSizeFromCia` | `0x10768E` | émulation | aucun (local) |
| 0x414 | `0x04140044` | GetMetaDataFromCia | `am_cmd_0414_GetMetaDataFromCia` | `0x10760C` | émulation | aucun (local) |
| 0x415 | `0x04150080` | CheckDemoLaunchRights | `am_cmd_0415_CheckDemoLaunchRights` | `0x107598` | émulation | 0x62 GetTicketLimitInfos |
| 0x416 | `0x041600C0` | GetInternalTitleLocationInfo | `am_cmd_0416_GetInternalTitleLocationInfo` | `0x107588` | émulation | 0x64 GetInternalTitleLocationInfo |
| 0x417 | `0x041700C0` | PerpetuateAgbSaveData | `am_cmd_0417_PerpetuateAgbSaveData` | `0x107580` | émulation | 0x65 MigrateAGBtoSAV |
| 0x418 | `0x04180040` | BeginImportProgramForOverWrite | `am_cmd_0418_BeginImportProgramForOverWrite` | `0x107558` | émulation (am:net), asm (am:u : cas dans l'aiguillage) | aucun (local) |
| 0x419 | `0x04190000` | BeginImportSystemProgram | `am_cmd_0419_BeginImportSystemProgram` | `0x107534` | émulation (am:net), asm (am:u : cas dans l'aiguillage) | aucun (local) |

#### 0x0801 à 0x0829 : `am:net`

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Envoie à `pxi:am9` |
| --- | --- | --- | --- | --- | --- | --- |
| 0x801 | `0x08010000` | BeginImportTicket | `am_cmd_0801_BeginImportTicket` | `0x103618` | émulation (le cas `0x10C404` de l'aiguillage, bl en `0x10C40C`) | 0x9 InstallTikBegin, puis `am_ticket_import_file_create` |
| 0x802 | `0x08020002` | CancelImportTicket | `am_cmd_0802_CancelImportTicket` | `0x10370C` | émulation | 0xB InstallTikAbort |
| 0x803 | `0x08030002` | EndImportTicket | `am_cmd_0803_EndImportTicket` | `0x103540` | émulation | 0xC InstallTikFinish |
| 0x804 | `0x08040100` | BeginImportTitle | `am_cmd_0804_BeginImportTitle` | `0x1035B8` | émulation | 0x10 InstallTitleBegin |
| 0x805 | `0x08050000` | StopImportTitle | `am_cmd_0805_StopImportTitle` | `0x10358C` | émulation | 0x11 InstallTitleStop |
| 0x806 | `0x080600C0` | ResumeImportTitle | `am_cmd_0806_ResumeImportTitle` | `0x103674` | émulation | 0x12 InstallTitleResume |
| 0x807 | `0x08070000` | CancelImportTitle | `am_cmd_0807_CancelImportTitle` | `0x10363C` | émulation | 0x28 InstallTitleAbort |
| 0x808 | `0x08080000` | EndImportTitle | `am_cmd_0808_EndImportTitle` | `0x1034F0` | émulation | 0x29 InstallTitleFinish |
| 0x809 | `0x080900C2` | CommitImportTitles | `am_cmd_0809_CommitImportTitles` | `0x103724` | émulation | 0x2A CommitImportPrograms |
| 0x80A | `0x080A0000` | BeginImportTmd | `am_cmd_080A_BeginImportTmd` | `0x1034A0` | émulation | 0x13 InstallTmdBegin |
| 0x80B | `0x080B0002` | CancelImportTmd | `am_cmd_080B_CancelImportTmd` | `0x103514` | émulation | 0x15 InstallTmdAbort |
| 0x80C | `0x080C0042` | EndImportTmd | `am_cmd_080C_EndImportTmd` | `0x103464` | émulation | 0x16 InstallTmdFinish |
| 0x80D | `0x080D0042` | CreateImportContentContexts | `am_cmd_080D_CreateImportContentContexts` | `0x1038F4` | émulation | 0x57 CreateImportContentContexts |
| 0x80E | `0x080E0040` | BeginImportContent | `am_cmd_080E_BeginImportContent` | `0x1036D0` | émulation | 0x17 InstallContentBegin |
| 0x80F | `0x080F0002` | StopImportContent | `am_cmd_080F_StopImportContent` | `0x1036A4` | émulation | 0x19 InstallContentStop |
| 0x810 | `0x08100040` | ResumeImportContent | `am_cmd_0810_ResumeImportContent` | `0x103784` | émulation | 0x1B InstallContentResume |
| 0x811 | `0x08110002` | CancelImportContent | `am_cmd_0811_CancelImportContent` | `0x103758` | émulation | 0x1A InstallContentAbort |
| 0x812 | `0x08120002` | EndImportContent | `am_cmd_0812_EndImportContent` | `0x1035EC` | émulation | 0x1C InstallContentFinish |
| 0x813 | `0x08130000` | GetNumCurrentImportContentContexts | `am_cmd_0813_GetNumCurrentImportContentContexts` | `0x103BBC` | émulation | 0x25 GetNumCurrentImportContentContexts |
| 0x814 | `0x08140042` | GetCurrentImportContentContextList | `am_cmd_0814_GetCurrentImportContentContextList` | `0x103B9C` | émulation | 0x26 GetCurrentImportContentContextList |
| 0x815 | `0x08150044` | GetCurrentImportContentContexts | `am_cmd_0815_GetCurrentImportContentContexts` | `0x103B7C` | pseudo-code | 0x27 GetCurrentImportContentContexts |
| 0x816 | `0x08160146` | Sign | `am_cmd_0816_Sign` | `0x103BEC` | émulation | 0x39 Sign |
| 0x817 | `0x08170146` | Verify | `am_cmd_0817_Verify` | `0x103C10` | émulation | aucun (local) |
| 0x818 | `0x08180042` | GetDeviceCert | `am_cmd_0818_GetDeviceCert` | `0x103494` | émulation | 0x3B GetCTCert |
| 0x819 | `0x08190108` | ImportCertificates | `am_cmd_0819_ImportCertificates` | `0x10373A` | émulation | 0x3D SetCertificates |
| 0x81A | `0x081A0042` | ImportCertificate | `am_cmd_081A_ImportCertificate` | `0x103668` | émulation | 0x3E SetCertificate |
| 0x81B | `0x081B00C2` | CommitImportTitlesAndUpdateFirmwareAuto | `am_cmd_081B_CommitImportTitlesAndUpdateFirmwareAuto` | `0x103BDC` | émulation | 0x2A CommitImportPrograms, 0x42 InstallTitlesFinishFIRM |
| 0x81C | `0x081C0100` | DeleteTicketId | `am_cmd_081C_DeleteTicketId` | `0x1034DC` | émulation | 0x4B DeleteTicketId |
| 0x81D | `0x081D0080` | GetNumTicketIds | `am_cmd_081D_GetNumTicketIds` | `0x103558` | émulation | 0x49 GetNumTicketIds |
| 0x81E | `0x081E0102` | GetTicketIdList | `am_cmd_081E_GetTicketIdList` | `0x103564` | émulation | 0x4A GetTicketIdList |
| 0x81F | `0x081F0080` | GetNumTicketsOfProgram | `am_cmd_081F_GetNumTicketsOfProgram` | `0x10382C` | émulation | 0x5F GetNumTicketsOfProgram |
| 0x820 | `0x08200102` | ListTicketInfos | `am_cmd_0820_ListTicketInfos` | `0x103578` | émulation | 0x60 ListDataTitleTicketInfos |
| 0x821 | `0x08210142` | ExportLicenseTicket | `am_cmd_0821_ExportLicenseTicket` | `0x103848` | émulation | 0x61 ExportLicenseTicket |
| 0x822 | `0x08220000` | GetNumCurrentContentInfos | `am_cmd_0822_GetNumCurrentContentInfos` | `0x1038E4` | émulation | 0x5B GetNumCurrentContentInfos |
| 0x823 | `0x08230044` | FindCurrentContentInfos | `am_cmd_0823_FindCurrentContentInfos` | `0x103838` | pseudo-code | 0x5C FindCurrentContentInfos |
| 0x824 | `0x08240082` | ListCurrentContentInfos | `am_cmd_0824_ListCurrentContentInfos` | `0x103862` | émulation | 0x5D ListCurrentContentInfos |
| 0x825 | `0x08250102` | CalculateContextRequiredSize | `am_cmd_0825_CalculateContextRequiredSize` | `0x103A24` | émulation | 0x59 FindContentInfos, 0x58 GetNumContentInfos, 0x5A ListContentInfos |
| 0x826 | `0x08260042` | UpdateImportContentContexts | `am_cmd_0826_UpdateImportContentContexts` | `0x1039D4` | émulation | 0x63 UpdateImportContentContexts |
| 0x827 | `0x08270000` | DeleteAllDemoLaunchInfos | `am_cmd_0827_DeleteAllDemoLaunchInfos` | `0x103878` | émulation | aucun (local) |
| 0x828 | `0x082800C0` | BeginImportTitleForOverWrite | `am_cmd_0828_BeginImportTitleForOverWrite` | `0x1039F4` | émulation | 0x6C InstallTitleBeginForOverwrite |
| 0x829 | `0x08290184` | ExportTicketWrapped | `am_cmd_0829_ExportTicketWrapped` | `0x1037C4` | émulation | 0x6D ExportTicketWrapped |

#### 0x1001 à 0x100D : les quatre services

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Envoie à `pxi:am9` |
| --- | --- | --- | --- | --- | --- | --- |
| 0x1001 | `0x100100C0` | GetDLCContentInfoCount | `am_cmd_1001_GetDLCContentInfoCount` | `0x1085CC` | émulation | 0x58 GetNumContentInfos |
| 0x1002 | `0x10020104` | FindDLCContentInfos | `am_cmd_1002_FindDLCContentInfos` | `0x108598` | pseudo-code | 0x59 FindContentInfos |
| 0x1003 | `0x10030142` | ListDLCContentInfos | `am_cmd_1003_ListDLCContentInfos` | `0x108560` | émulation | 0x5A ListContentInfos |
| 0x1004 | `0x10040102` | DeleteDLCContents | `am_cmd_1004_DeleteDLCContents` | `0x108524` | émulation | 0x5E DeleteContents |
| 0x1005 | `0x10050084` | GetDLCTitleInfos | `am_cmd_1005_GetDLCTitleInfos` | `0x1084E0` | pseudo-code | 0x3 GetTitleInfo |
| 0x1006 | `0x10060080` | GetDLCOrLicenseNumTickets | `am_cmd_1006_GetDLCOrLicenseNumTickets` | `0x1084B0` | émulation | 0x5F GetNumTicketsOfProgram |
| 0x1007 | `0x10070102` | ListDLCOrLicenseTicketInfos | `am_cmd_1007_ListDLCOrLicenseTicketInfos` | `0x10847C` | émulation | 0x60 ListDataTitleTicketInfos |
| 0x1008 | `0x100801C2` | GetDLCOrLicenseItemRights | `am_cmd_1008_GetDLCOrLicenseItemRights` | `0x108440` | émulation | 0x68 GetItemRights |
| 0x1009 | `0x100900C0` | IsDLCTitleInUse | `am_cmd_1009_IsDLCTitleInUse` | `0x108408` | émulation | 0x69 IsDataTitleInUse |
| 0x100A | `0x100A0000` | ReloadSDTitleDatabase | `am_cmd_100A_ReloadSDTitleDatabase` | `0x1083FC` | émulation | 0x48 ReloadDBS |
| 0x100B | `0x100B00C0` | GetNumDLCExistingContentInfos | `am_cmd_100B_GetNumDLCExistingContentInfos` | `0x1083C8` | émulation | 0x6A GetNumExistingContentInfos |
| 0x100C | `0x100C0142` | ListDLCExistingContentInfos | `am_cmd_100C_ListDLCExistingContentInfos` | `0x108390` | émulation | 0x6B ListExistingContentInfos |
| 0x100D | `0x100D0084` | GetPatchTitleInfos | `am_cmd_100D_GetPatchTitleInfos` | `0x108344` | pseudo-code | 0x3 GetTitleInfo |


Notes sur le tableau :

- `0x0017` ImportTwlBackupLegacy est traitée dans le corps de l'aiguillage (réponse `0x00170042`, un descripteur de poignée déplacée), pas par un gestionnaire séparé.
- **`0x0003` GetProgramInfos : interprété.** La fonction `0x10830C` n'est appelée de nulle part (les cas `0x01` à `0x1E` de l'aiguillage sont un `switch` à table de demi-mots que Ghidra ne reconstruit pas : aucun des gestionnaires de ces cas n'a d'appelant dans les références) : elle est retenue parce qu'elle appelle la même enveloppe de `pxi:am9` `0x3` (`GetTitleInfo`, en-tête `0x00030084`, celui de la Carte) et qu'elle est rangée entre les gestionnaires de `0x02` et de `0x04`. Les autres cas non émulés (`0x0D`, `0x11`, `0x26`, `0x27`, `0x2C`, `0x0411`, `0x0815`, `0x0823`, `0x1002`, `0x1005`, `0x100D`) ont un appel direct dans le pseudo-code de l'aiguillage ou de son fragment (références de `refs.tsv`).
- **`0x0418` et `0x0419` dans `am:u`.** L'émulation de `am:u` donnait `0x0418` à `0x106DFC` avec une réponse `0x002A0080`, et `0x0419` en commande inconnue : c'est un artefact. Dans `am:u` ces deux cas sont écrits dans le corps de l'aiguillage (`0x106DFC` et `0x106E1A`), qui appellent `0x107558` et `0x107534` (les mêmes que dans `am:net`) puis fabriquent la réponse (`0x0418`, 1 mot, 2 descripteurs ; lu dans l'assembleur). `am:u` accepte donc bien les 25 commandes `0x04xx` de la Carte.
- **`0x0817` Verify** : la fonction `0x103C10` tient en deux instructions et rend la constante d'erreur `0xF8C083F4` (lue à `0x103C14`) : la commande existe dans l'aiguillage, **elle n'est pas implémentée** (3dbrew ne la signale pas comme non implémentée).
- Les gestionnaires sans envoi direct à `pxi:am9` (aucun) sont des commandes locales : la base des lancements de démos dans « amsa:/database.bin » (`0x0027`, `0x0827`, via `am_demo_db_*`), le mutex de mise à jour du système (`0x0412`, créé par `static_init_system_updater_mutex`), la lecture d'un CIA fourni par le client (`0x0408`, `0x0409`, `0x040A` à `0x040D`, `0x0413`, `0x0414`, via `am_cia_reader_*` et le lecteur de TMD), et l'ouverture d'une importation (`0x0402`, `0x0403`, `0x0418`, `0x0419` : `am_cia_import_create` puis une session vers le port `am:pipe`). Les données d'un CIA écrites ensuite par le client sur cette session sont découpées par `am_cia_import_process` et relayées à `pxi:am9` (InstallTikBegin/Write, InstallTmd…, InstallContent…). `0x0415` lit d'abord les limites du ticket (0x62).
- Les correspondances de noms sont frappantes : sur les commandes dont le nom existe des deux côtés, la commande d'`am` s'appelle comme celle de Process9 à `Title`/`Program` près (`GetProgramList` -> `GetTitleList`, `GetNumTickets` -> `GetTicketCount`, `GetCurrentImportContentContexts` -> son homonyme `0x27`, `GetTicketLimitInfos` -> `GetTicketLimitInfos`, `GetTwlProgramListForReboot` -> son homonyme `0x50`). Aucune des correspondances vérifiées n'est contredite.

### Le service de fichier `am:pipe`

3dbrew décrit un service de type fichier (`Control` `0x040100C4`, `OpenSubFile` `0x08010100`, `Read`, `Write`, `GetSize`, `Close`, `Flush`...) derrière un port privé. Ce port existe (partie 1, port 4) : `am_pipe_dispatch_command` (`0x1016E8`) traite les commandes `0x801` à `0x80C` et `0x401` en appelant les cases `+0x8` à `+0x30` du fichier d'importation attaché à la session (`am_import_file_open_session`, `0x109A50`, une importation à la fois). Les cinq tables de fichiers (base `0x112430`, CIA `0x112478`, TMD `0x1124C0`, ticket `0x11251C`, contenu `0x112564`) refusent la lecture, la taille et les attributs (`0xD8C08008`) ; seule l'écriture est propre à chacune et relaie à `pxi:am9`. La fonction `0x10D270` (morceaux de `0x20000` octets, SHA-256 et DecryptDSiWareData) est `am_twl_backup_import_section` : elle sert l'importation d'une sauvegarde DSiWare (`0x001C`), pas la lecture d'un CIA ; les clés et le chiffrement restent dans Process9.

## Partie 4 : une opération pas à pas, GetProgramList

`am:u`, commande `0x0002` (3dbrew : `0x00020082`), appelée par `ns` pour lister les titres d'un support. Deux mots ordinaires (le nombre d'identifiants voulus, le type de support) et un tampon en écriture (les identifiants de titres, 8 octets chacun).

1. `ns` envoie la requête sur sa session `am:u`. La boucle de session du fil (`am_u_service_loop`, `0x103D00`) reçoit (`ReplyAndReceive`) et appelle `am_u_dispatch_command` (`0x105540`).
2. L'aiguillage extrait le numéro `0x0002`, vérifie l'en-tête en entier (`ipc_check_header`, `0x00020082`), que le mot de descripteur est bien un tampon en écriture (type `0xC`), et que la taille du tampon est cohérente avec le nombre demandé.
3. Il appelle `am_cmd_0002_GetProgramList` (`0x108322`), qui appelle `am_pxi_send_02_GetTitleList` (`0x109242`).
4. Celle-ci écrit dans le tampon de commande du fil un en-tête de commande `2`, 2 mots ordinaires et 2 mots de traduction (`ipc_set_header(.., 2, 2, 2)`), le nombre d'identifiants et le type de support, puis un descripteur de tampon de Process9 (`pxi_put_buffer_desc`, `0x107394` : taille dans les bits 8 et plus, numéro dans les bits 4 à 7, valeur 4 dans les bits bas ; sa taille est le nombre d'identifiants fois 8) et enchaîne `SendSyncRequest` (`svcSendSyncRequest`, `0x10A61C`) sur la session `pxi:am9`.
5. `pxi` recopie la requête à Process9 (`fiches/pxi.md`) ; la commande `0x0002` y est `pxiam_get_title_list` (`0x08041C48`, `process9.md`), dont l'en-tête vérifié est le même, `0x00020082`.
6. Au retour, si le résultat n'est pas négatif, `0x109242` copie le mot 2 de la réponse (le nombre d'identifiants écrits) vers la sortie du gestionnaire et rend le mot 1 (le résultat).
7. `am_check_result_bits` (`0x109374`) examine ce résultat : si le **module** du code (bits 10 à 17) n'est ni AM (`0x20`) ni FS (`0x11`) (`am_result_module_is_am_or_fs`, `0x109A3A`), ou s'il vaut FS alors que la sortie est vide, il appelle `fatal_if_failed` (`0x10A686`), qui n'agit que si le résultat est un échec (bit 31) : il mène par `fatal_error` et `fatal_error_impl` à `report_fatal_error` (ERRF_Throw vers `err:f`), pas à `Break`. Sinon le résultat part tel quel.
8. L'aiguillage fabrique la réponse `0x00020082` (le résultat, le nombre écrit, le descripteur du tampon rendu) et la boucle de session répond.

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x112250` | `0xFFFF8000`, puis à `0x112254` quatre octets `0 1 2 3` : l'indice du fil à lancer pour chaque port (l'identité) |
| `0x112258` | les cinq noms : `am:app`, `am:sys`, `am:u`, `am:net`, `am:pipe` |
| `0x1122F0` | la table des entrées de fils : `0x110C35`, `0x110C25`, `0x110C45`, `0x110C55` (adresses Thumb ; port 0 = `am:app`, 1 = `am:sys`, 2 = `am:u`, 3 = `am:net`) |
| `0x113290` | la table des pointeurs vers ces noms (cinq mots) |
| `0x113568` | l'objet de la notification `0x100` (table `0x112900`, construit par `static_init_terminate_handler`) : sa case 0 `am_on_terminate_notification` pose l'indicateur d'arrêt `+0x10` (`0x113578`) ; les `0x8C` octets juste avant sont la réserve des cinq éléments de la file de travail (`am_work_item_pool_init`) |
| `0x112060` | la chaîne `pxi:am9` |

Où sont les données sensibles : les tickets, les certificats de la console et les clés ne sont **pas** dans `am`. Il ne les voit que comme des tampons qu'il fait passer à Process9 (`Sign` `0x0816` -> `pxi:am9` `0x39`, `GetDeviceCert` `0x0818` -> `0x3B`, `ImportCertificates` `0x0819` -> `0x3D`, `ImportCertificate` `0x081A` -> `0x3E`, les commandes de tickets `0x0801` à `0x0803`, `0x081C` à `0x0821`, `0x0829`). Les identifiants et certificats de la console restent dans Process9 et sur la NAND (`process9.md`).

## Partie 6 : ce que Pokémon X envoie

Rien. Pokémon X n'ouvre aucun des services d'`am` : ni dans l'inventaire des 408 fonctions d'envoi, ni dans la liste des services de l'exheader du jeu. Pour le portage PC, `am` n'a donc rien à rendre à la place de la console ; `ns` l'appelle (21 commandes, `fiches/ns.md`) pendant le démarrage d'une application (lecture de la fiche d'un titre, vérification des droits) : un remplaçant de `ns` n'en a pas besoin non plus tant qu'il ne relit pas ces informations.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les quatre tables de commandes : 13, 58, 83 et 124 commandes. Voie 1 : l'émulation des quatre aiguillages. Voie 2 : la Carte des services (3dbrew) : les 13 commandes d'`am:app` et les 45 de `0x00xx` sont identiques en nombre, en numéros et en en-têtes complets (quand le code les vérifie) ; les `0x04xx` et les `0x08xx` aussi ; l'écart est dit dans la partie 2.
- Qu'`am` relaie à `pxi:am9` : 88 commandes `pxi:am9` distinctes fabriquées par les gestionnaires (en-tête de commande, nombre de mots ordinaires et de traduction), dont 38 ont leur en-tête complet vérifié dans le code de Process9 (`process9.md`) et **aucune ne diverge** ; les 50 autres n'y sont vérifiées que par leur numéro. Voie 1 : le pseudo-code et l'assembleur des enveloppes d'envoi. Voie 2 : l'aiguillage `pxiam_dispatch_command` de Process9.
- Les noms de service et leur ordre, l'ouverture de `pxi:am9` et de `fs:USER`, le port privé `am:pipe` créé par `CreatePort` sans nom.

**Interprété** :
- Les noms des gestionnaires (`am_cmd_*`, tirés de la Carte), des enveloppes d'envoi (`am_pxi_send_*`, tirés de `process9.md`) et des aides IPC (`ipc_*`, lus dans l'assembleur).
- `0x10830C` pour `GetProgramInfos` (le cas `0x03` est dans la table de demi-mots que Ghidra ne reconstruit pas).
- Que chaque gestionnaire « relaie » ce que son nom de `pxi:am9` dit : le nom et l'en-tête sont lus, la sémantique est celle de 3dbrew.

**Pas lu** :
- Le détail des états de l'automate `am_cia_import_process` (onze états) et du lecteur de ticket ; ce que rendent `0x10FE90` et `0x110300` dans le lecteur de TMD.
- La disposition exacte des sections d'une sauvegarde DSiWare (`am_twl_backup_compute_layout`, `0x109126`, `0x109158`, `0x10D13C`, `0x10D15C`).
- Le détail des 124 commandes au-delà de l'envoi à Process9 : paramètres champ par champ, vérifications de taille de chaque aiguillage.
- 16 fonctions restent sans nom et 534 noms nouveaux restent de confiance moyenne (`local/analyse/am/noms-proposes.tsv`, `local/analyse/am/notes-100.md`).
- `fs:USER` ne sert qu'à la sauvegarde système `0x00010015` (« amsa: », la base des lancements de démos) ; les bases de titres de la carte SD et de la NAND sont tenues par Process9.
