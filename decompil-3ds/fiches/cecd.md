# cecd, le démon StreetPass

`cecd` est le démon de StreetPass (CEC, « Communication Entre Consoles ») : il tient les boîtes aux lettres des jeux (un dossier par jeu dans l'archive `data:/CEC`), s'occupe d'envoyer et de recevoir les messages quand la console passe à portée d'une autre, et sait se taire quand `ndm` le demande. Un jeu lui parle par `cecd:u` pour lire et écrire sa boîte ; `cecd:s` est la même interface avec en plus les commandes des applications système (le module « Spr », l'échange de messages entre consoles) ; `cecd:ndm` est le canal de `ndm`, qui suspend et relance le démon.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, le module est presque tout en Thumb), `outils/emulate_dispatch.py` sur les trois aiguillages (relancé en entier, de 0 à 0xFFFF), et la page CECD_Services de 3dbrew relue par `web.archive.org` (version du 20 juillet 2020 ; la Carte des services, tirée d'une version plus récente, donne de meilleurs noms pour quelques commandes). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002602`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `cecd`, priorité 60 (`0x3C`) |
| Fichier lu | `local/extrait/cecd/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x21EA4` octets de code (`0x22` pages), `0x145C` de données en lecture seule (2 pages), `0x135C` de données (2 pages), `0x94E8` de mémoire à zéro, pile de `0x4000` |
| Fonctions | 1 731 pour Ghidra, dont 1 615 en Thumb et 116 en ARM, plus 38 entrées manquées (`couverture.py entrees cecd` : veneers, cibles du formateur printf, et cinq adresses calculées par `ldr`+`add pc` : `0x1152B8`, `0x1152D8`, `0x115B84`, `0x115BBE`, `0x11FB38`, rappels de sscanf, vsnprintf et fputc), moins 2 qui ne sont pas des fonctions (`0x11B004`, morceau de `cecds_handle_command`, et la réserve `0x105C7C` ; `0x11BA02`, autre morceau, n'entre pas dans le compte) et 10 fonctions mortes (dont le morceau de nettoyage `0x11594A`) : 1 757 ; 236 nommées dans `cecd.noms.tsv` (217 et les 19 haute de ce lot), 1 629 avec `local/analyse/cecd/noms-proposes.tsv` et `noms-proposes-2.tsv` |
| Services offerts | `cecd:u` (4 sessions au plus), `cecd:s` (4), `cecd:ndm` (1) : la table des noms et des nombres de sessions est à `0x122328` |
| Services appelés | lus dans l'exheader : `nwm::CEC`, `fs:USER`, `ptm:s`, `ps:ps`, `cfg:s`, `frd:u` ; ouverts dans le code : `ps:ps` (`0x1222AC`, `ps_open`), `fs:USER` (`0x122437`, `fs_init`), `nwm::CEC` (`0x12244C`, deux sessions par `nwm_cec_open` `0x102700`), `cfg:s` (`0x122F30`, `cfg_s_open` `0x103CB8`), `ptm:s` (`0x122F45`, `ptm_s_open` `0x100660`), `frd:u` (chaîne lue par `frd_u_open` `0x11323C`), `err:f` ; `cfg:u` (`0x122F69`, `cfg_u_open` `0x10A118`, appelé par `ubl_open`), que l'exheader ne déclare pas : son ouverture sur console est supposée ; la session cfg commune `0x125008` reçoit aussi la poignée de `cfg:s`, que `cfg_s_open` y recopie ; le client `cecd` de la bibliothèque (poignées `0x125084` et `0x125088`) est présent mais n'est jamais ouvert |
| Autres noms de services dans le module | `fs:LDR`, `srv:pm`, `ptm:sysm`, `ptm:gets`, `ptm:u`, `ptm:play`, `APT:A`, `gsp::Lcd`, `gsp::Gpu` : listes de noms de la bibliothèque commune (`0x122430`, `0x122F30`) ; `ubl_:` est le nom de montage de l'extdata partagée `0xF000000B` (`ubl_load`, `0x108098`, fichier `ubl_:/ubll.lst`) |
| Appelants connus | `ndm` envoie à `cecd:ndm` ses huit commandes (`fiches/ndm.md`, partie 7) ; Pokémon X envoie seize commandes à `cecd:u` (partie 6) |

## Partie 1 : le démarrage et le serveur

`entry` (`0x100000`) appelle `clear_bss` (`0x100024`), `init_program_args` (`0x10007C`), `init_runtime_and_srv` (`0x1000C8`), `setup_heap` (`0x1000B4`), `run_static_initializers` (`0x117A80`, 72 constructeurs), `run_init_array` (`0x100060`) et `cecd_start` (`0x100048`), qui pose le gestionnaire d'exception (`install_exception_handler`, `0x100114`) puis appelle `cecd_main` (`0x100154`, 686 lignes de pseudo-code : tout le reste).

`cecd_main` fait, dans l'ordre :
1. **Enregistre les trois services.** Une boucle de trois tours lit la table `cecd_service_table` (`0x122328`, des paires nom, nombre de sessions : `cecd:u` 4, `cecd:s` 4, `cecd:ndm` 1) et appelle `SRV_RegisterService` pour chacun (`0x10079C`) ; le port de chaque service est rangé dans un tableau de poignées (`0x12E72C`).
2. **Prépare les composants** : `ptm_s_open` (`0x100660`), trois gestionnaires de notification de `sm` (`register_notification_handler`, `0x113A20`, avec `0x100`, `0x105`, `0x106`), le sémaphore des notifications (`get_notification_semaphore`, `0x1006CC`), l'abonnement à `0x105` et `0x106` (`SRV_Subscribe_thunk`, `0x113A18`), puis `cecd_daemon_init` (`0x1008FC`), qui inscrit quatre autres notifications (`0x104`, `0x107`, `0x304`, `0x303`), monte la sauvegarde et lance les fils du moteur (`cecd_daemon_thread_main` `0x100E0C`, `cec_scheduler_thread_main` `0x101248`). Les sens `0x100` (arrêt), `0x105` et `0x106` (réveil) viennent de `fiches/ptm.md`.
3. **Boucle sur `ReplyAndReceive`** (`svcReplyAndReceive`, `0x11FF94`) avec neuf poignées au plus : le sémaphore des notifications au rang 0, les trois ports, puis les sessions (cinq au plus, à partir du rang 4). Un port réveillé : `svcAcceptSession` (`0x11FF7C`) et on range la nouvelle session avec son service. Une session : on appelle `cecd_handler_table[service]` (`0x122340`) avec l'objet de service pris dans la table `0x12234C` (partie 2). Une session fermée (`0xC920181A`) est retirée par `cecd_remove_session` (`0x100A30`).
4. **À l'arrêt** (un drapeau levé à `0x1251A4` et une liste de sessions réduite à 4) : retire les trois services (`SRV_UnregisterService`, `0x1007F0`), envoie la commande `0x11` (EXIT) au moteur (`cec_run_command`, `0x1139F4`), attend la fin d'un fil (`WaitSynchronization1`, `0x1139EC`) et rend la main.

Le module n'a **qu'un fil de service** : toutes les commandes des trois services sont servies à la suite par ce fil, et chaque gestionnaire prend un verrou récursif (`lock_guard_enter`, `0x113872`, sur un objet à `session + 8`) avant de toucher le moteur. Le moteur tourne dans d'autres fils : `cecd_daemon_thread_main` (`0x100E0C`, les étapes de la machine à états), `cec_scheduler_thread_main` (`0x101248`), `cec_command_completion_thread_main` (`0x1034DC`, lancé par `cec_worker_thread_start` `0x1011C8`, il signale la fin des commandes Start et Stop), `cec_tcp_thread_main` (`0x105080`), `cec_exchange_thread_main` (`0x104A5C`), et les deux fils de la couche TCP du module (`cec_tcp_timeout_thread_main` `0x120218` et `cec_tcp_retransmit_thread_main` `0x1045D0`, lancés par `cec_tcp_start_threads` `0x104368`).

Appels système trouvés (leurs enveloppes sont en `0x11FF7C` et alentour, et dans quelques fonctions isolées de `0x113A00` à `0x113B00`) : 0x01 ControlMemory, 0x02 QueryMemory, 0x03 ExitProcess, 0x08 CreateThread, 0x09 ExitThread, 0x0A SleepThread, 0x13 CreateMutex, 0x14 ReleaseMutex, 0x17 CreateEvent, 0x18 SignalEvent, 0x19 ClearEvent, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x25 WaitSynchronizationN, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest, 0x35 GetProcessId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive. Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les trois aiguillages

`cecd_handler_table` (`0x122340`) contient trois adresses : `cecdu_handle_command` (`0x11A5BC`), `cecds_handle_command` (`0x11AF50`) et `cecdndm_handle_command` (`0x11AD68`). La seconde table (`0x12234C` : `0x129000`, `0x129018`, `0x129024`) donne l'objet de service que `cecd_main` passe en argument au gestionnaire du même rang ; ces objets sont construits par la case `0x11E728` de la table des constructeurs.

Chaque aiguillage lit le numéro dans les 16 bits du haut de l'en-tête (`bitfield_extract`, `0x10D0A4`) et saute à un cas. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F`. Les trois tables ont été exécutées par `emulate_dispatch.py cecd 0x11a5bc=cecd:u 0x11af50=cecd:s 0x11ad68=cecd:ndm` (de 0 à 0xFFFF) :

| Aiguillage | Commandes trouvées | Numéros |
| --- | --- | --- |
| `cecd:u` | 22 | 1 à 0x12 (18, y compris 0xD, 0xF et 0x10), puis 0x1E, 0x1F, 0x20, 0x21 |
| `cecd:s` | 38 | les 22 de `cecd:u`, plus 16 : 0x401, 0x402, 0x40A à 0x417 |
| `cecd:ndm` | 8 | 1 à 8 |

**`cecd:s` a ses propres copies des 22 commandes de `cecd:u`.** Les fonctions sont à d'autres adresses (`0x119090` pour le numéro 1 à la place de `0x11C508`), mais chacune appelle exactement les mêmes fonctions du moteur que son double de `cecd:u` (tableau de la partie 3). La différence visible dans le pseudo-code : `cecd:u` prend son verrou à `session + 8`, `cecd:s` à `session` ; le contrôle (`cec_access_is_blocked` `0x10CFCC` pour `cecd:u`, `cec_access_is_blocked_sys` `0x10D468` pour `cecd:s`) a le même code : il rend 0 seulement quand `cec_get_state` (`0x113068`, l'état courant) et `cec_get_running_state` (`0x112F38`, l'état que `cecd_daemon_thread_main` recopie avant chaque étape) valent tous deux 0xFF (IDLE), sinon 1 (un 1 fait répondre `0xC8A10BF0`, partie 3).

## Partie 3 : les commandes

Les noms sont ceux de la Carte des services (tirés de 3dbrew) ; les en-têtes de requête, les en-têtes de réponse et les fonctions sont ceux de l'émulation. La colonne « Vérifié » dit si l'aiguillage compare l'en-tête de requête en entier (« entier ») ou le numéro seulement. « Moteur » est la fonction du moteur (l'objet global à `+0x2E00`) que le gestionnaire appelle, une fois les verrous et contrôles écartés (lu dans le pseudo-code ; interprété pour le nom).

### `cecd:u` (22 commandes)

| N° | En-tête de requête | Commande | Gestionnaire | Adresse | Vérifié | Réponse | Moteur |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x000100C2` | OpenRawFile | `cecdu_0001_OpenRawFile` | `0x11C508` | entier | `0x00010080` | `cec_open_raw_file` `0x11CC0C` |
| 2 | `0x00020042` | ReadRawFile | `cecdu_0002_ReadRawFile` | `0x11C590` | entier | `0x00020082` | `cec_read_raw_file` `0x112064` |
| 3 | `0x00030104` | ReadMessage | `cecdu_0003_ReadMessage` | `0x11C1D0` | entier | `0x00030084` | `cec_read_message` `0x110AF8` |
| 4 | `0x00040106` | ReadMessageWithHMAC | `cecdu_0004_ReadMessageWithHMAC` | `0x11C40C` | entier | `0x00040086` | `cec_read_message_hmac` `0x11CC7C` |
| 5 | `0x00050042` | WriteRawFile | `cecdu_0005_WriteRawFile` | `0x11C678` | entier | `0x00050042` | `cec_write_raw_file` `0x10FAEC` |
| 6 | `0x00060104` | WriteMessage | `cecdu_0006_WriteMessage` | `0x11C23C` | entier | `0x00060044` | `cec_write_message` `0x111684` |
| 7 | `0x00070106` | WriteMessageWithHMAC | `cecdu_0007_WriteMessageWithHMAC` | `0x11C45C` | entier | `0x00070046` | `cec_write_message_hmac` `0x10F7D0` |
| 8 | `0x00080102` | Delete | `cecdu_0008_Delete` | `0x11C6C4` | entier | `0x00080042` | `cec_delete` `0x10EC80` |
| 9 | `0x000900C2` | SetData | `cecdu_0009_SetData` | `0x11C71C` | entier | `0x00090042` | `cec_set_data` `0x1133C4` |
| 0xA | `0x000A00C4` | ReadData | `cecdu_000A_ReadData` | `0x11C7C8` | entier | `0x000A0044` | `cec_read_data` `0x10D1EC` (et `0x10EBEC`) |
| 0xB | `0x000B0040` | Start | `cecdu_000B_Start` | `0x11C634` | numéro | `0x000B0040` | `cec_run_command` `0x1139F4` |
| 0xC | `0x000C0040` | Stop | `cecdu_000C_Stop` | `0x11C5E0` | numéro | `0x000C0040` | `cec_run_command` `0x1139F4` |
| 0xD | `0x000D0082` | GetCecInfoBuffer | `cecdu_000D_GetCecInfoBuffer` | `0x11C314` | entier | `0x000D0042` | `cec_get_info_buffer` `0x11A57C` |
| 0xE | `0x000E0000` | GetCecdState | `cecdu_000E_GetCecdState` | `0x11C21C` | numéro | `0x000E0080` | `cec_get_abbreviated_state` `0x112E08` |
| 0xF | `0x000F0000` | GetCecInfoEventHandle | `cecdu_000F_GetCecInfoEventHandle` | `0x11C4B0` | numéro | `0x000F0042` | `cec_get_info_event_handle` `0x11A590` |
| 0x10 | `0x00100000` | GetChangeStateEventHandle | `cecdu_0010_GetChangeStateEventHandle` | `0x11C4DC` | numéro | `0x00100042` | `cec_get_change_state_event_handle` `0x11A570` |
| 0x11 | `0x00110104` | OpenAndWrite | `cecdu_0011_OpenAndWrite` | `0x11C350` | entier | `0x00110042` | `cec_open_and_write` `0x111614` (avec `cec_prepare_write` `0x11CCE8`) |
| 0x12 | `0x00120104` | OpenAndRead | `cecdu_0012_OpenAndRead` | `0x11C28C` | entier | `0x00120082` | `cec_open_and_read` `0x1136E4` |
| 0x1E | `0x001E0082` | GetEventLog | `cecdu_001E_GetEventLog` | `0x11C1A4` | entier | `0x001E0082` | `cec_get_event_log` `0x11A1A0` |
| 0x1F | numéro seul (3dbrew : `0x001F0000`) | GetEventLogStart | `cecdu_001F_GetEventLogStart` | `0x11C33C` | numéro | `0x001F0080` | `cec_event_log_start` `0x11A23C` |
| 0x20 | numéro seul (3dbrew : `0x0020....`) | GetEventLogEntryCount | `cecdu_0020_GetEventLogEntryCount` | `0x11C3F8` | numéro | `0x00200080` | `0x11A268` |
| 0x21 | numéro seul (absent de 3dbrew et de la Carte) | (sans nom) | `cecdu_0021_WrapEventLogIndex` | `0x11C3E4` | numéro | `0x00210080` | `cec_event_log_wrap_index` `0x11A244` ((r2 + r3) ramené dans [0, 10000)) |

Les noms Start et Stop (0xB et 0xC) sont ceux de la Carte ; dans la version de 3dbrew relue, ce sont RunCommand et RunCommandAlt, et le code s'accorde avec ces derniers (voir plus bas). Les commandes 0x20 et 0x21 n'ont pas de nom dans la version relue de 3dbrew (« ? ») : le nom GetEventLogEntryCount (0x20) est celui de la Carte, et 0x21 n'est dans la Carte que comme en-tête incomplet. Pour les commandes « numéro », le code ne compare que le numéro : leur en-tête de requête complet n'est connu que par 3dbrew et la Carte (`0x000B0040` : un mot ordinaire, la CecCommand).

### `cecd:s` : les 22 de `cecd:u` à d'autres adresses, plus 16

Les 22 commandes ont les mêmes numéros, en-têtes de requête et de réponse que dans `cecd:u`, aux adresses `0x119090` (1), `0x1190F8` (2), `0x118C20` (3), `0x118EFC` (4), `0x1191E4` (5), `0x118CC8` (6), `0x118F7C` (7), `0x119230` (8), `0x119284` (9), `0x11931C` (0xA), `0x1191A0` (0xB), `0x11914C` (0xC), `0x118E00` (0xD), `0x118C80` (0xE), `0x119000` (0xF), `0x119058` (0x10), `0x118E3C` (0x11), `0x118D94` (0x12), `0x118BF4` (0x1E), `0x118E28` (0x1F), `0x118EE8` (0x20), `0x118ED4` (0x21).

Les 16 commandes propres à `cecd:s` :

| N° | En-tête de requête | Nom de la Carte | Gestionnaire | Adresse | Vérifié | Réponse | Appelle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x401 | numéro seul | (absent de la Carte) | `cecds_0401_CreateOrDeleteTestBoxes` | `0x118D74` | numéro | `0x04010040` | `cec_create_or_delete_test_boxes` `0x11C9E4` (boîtes `data:/CEC/test`, CEC_TEST_000 à 006) |
| 0x402 | `0x04020002` | GetCecInfoEventHandleSys | `cecds_0402_GetCecInfoEventHandleSys` | `0x11902C` | entier | `0x04020042` | `0x11A5AC` |
| 0x40A | numéro seul | SprCreate | `cecds_040A_SprCreate` | `0x118D14` | numéro | `0x040A0042` | `0x119764`, `0x11A5A0` |
| 0x40B | numéro seul | SprInitialise | `cecds_040B_SprInitialise` | `0x118F5C` | numéro | `0x040B0040` | `0x119C28` |
| 0x40C | `0x040C0042` | SprGetSendSlotsMetadata | `cecds_040C_SprGetSendSlotsMetadata` | `0x118C70` | entier | `0x040C0082` | `0x1194C8` |
| 0x40D | `0x040D0082` | SprGetSlot | `cecds_040D_SprGetSlot` | `0x118CA8` | entier | `0x040D0042` | `0x119540` |
| 0x40E | numéro seul | SprSetTitleSent | `cecds_040E_SprSetTitleSent` | `0x118D40` | numéro | `0x040E0040` | `0x1197CC` |
| 0x40F | numéro seul | SprFinaliseSend | `cecds_040F_SprFinaliseSend` | `0x118FE0` | numéro | `0x040F0040` | `0x119CF4` |
| 0x410 | numéro seul | SprStartRecv | `cecds_0410_SprStartRecv` | `0x118F6C` | numéro | `0x04100040` | `0x119C90` |
| 0x411 | `0x04110042` | SprSetRecvSlotsMetadata | `cecds_0411_SprSetRecvSlotsMetadata` | `0x118CB8` | entier | `0x04110042` | `0x11960C` |
| 0x412 | `0x041200C2` | SprAddSlot | `cecds_0412_SprAddSlot` | `0x118D50` | entier | `0x04120042` | `0x119838` |
| 0x413 | numéro seul | SprFinaliseRecv | `cecds_0413_SprFinaliseRecv` | `0x118FF0` | numéro | `0x04130040` | `0x119D2C` |
| 0x414 | numéro seul | SprDone | `cecds_0414_SprDone` | `0x118D64` | numéro | `0x04140040` | `0x109124` |
| 0x415 | numéro seul | GenHashConsoleUnique | `cecds_0415_GenHashConsoleUnique` | `0x118C9E` | numéro | `0x041500C0` | `0x11CF60` |
| 0x416 | `0x04160002` | (Carte : « Inconnue ») | `cecds_0416_GetBlockedUserList` | `0x119084` | entier | `0x04160082` | `cec_get_blocked_user_list` `0x11CFA8` (identifiants de `ubl_:/ubll.lst`) |
| 0x417 | numéro seul | (absent de la Carte) | `cecds_0417_GetBlockListMaxTag` | `0x118F50` | numéro | `0x04170080` | `cec_get_block_list_max_tag` `0x11CF84` |

Le module accepte donc sur `cecd:s` **les 22 commandes de `cecd:u`, plus 0x401 et 0x417 que la Carte ne liste pas**, en plus des 14 autres que la Carte nomme (0x416 y est « Inconnue »). Les corps des commandes « Spr » sont nommés d'après leur commande (`cec_spr_create` `0x119764`, `cec_spr_add_slot` `0x119838`, `cec_spr_done` `0x109124`…) ; ils refusent hors de l'état OVER_BOSS (`0xE0A10BEE`). Les commandes 0x401, 0x416 et 0x417 n'existent pas dans 3dbrew.

### `cecd:ndm` (8 commandes)

| N° | En-tête de requête | Commande | Gestionnaire | Adresse | Vérifié | Réponse | Ce que fait la fonction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010000` | Initialize | `cecdndm_0001_Initialize` | `0x11C93E` | numéro | `0x00010042` | crée un événement la première fois (`CreateEvent`, svc 0x17, par `0x111868`), le range dans un emplacement du fil appelant (`0x10FE9C`) et rend sa poignée ; la fois suivante, rend la même |
| 2 | `0x00020000` | Deinitialize | `cecdndm_0002_Deinitialize` | `0x11C962` | numéro | `0x00020040` | ferme cet événement (`CloseHandle`) et vide l'emplacement |
| 3 | `0x00030000` | ResumeDaemon | `cecdndm_0003_ResumeDaemon` | `0x11C982` | numéro | `0x00030040` | **`cec_run_command(7)`**, c'est-à-dire la CecCommand `NDM_RESUME` |
| 4 | `0x00040040` | SuspendDaemon | `cecdndm_0004_SuspendDaemon` | `0x11C8AA` | numéro | `0x00040040` | **`cec_run_command(8)`** (`NDM_SUSPEND`) si le booléen est nul, **`cec_run_command(9)`** (`NDM_SUSPEND_IMMEDIATE`) sinon |
| 5 | `0x00050000` | QueryStatus | `cecdndm_0005_QueryStatus` | `0x11C886` | numéro | `0x00050080` | rend un octet, l'état du démon vu par `ndm` : un nombre de 0 à 3, noms `NDM_STATUS_WORKING`, `IDLE`, `SUSPENDING`, `SUSPENDED` (table à `0x124B08`) |
| 6 | `0x00060042` | GetNZoneInfo | `cecdndm_0006_GetNZoneInfo` | `0x11C916` | entier | `0x00060082` | `0x11CDDC` → `0x11A4E8` : remplit un tampon en écriture et rend un octet |
| 7 | `0x00070042` | SetNZoneSSIDList | `cecdndm_0007_SetNZoneSSIDList` | `0x11C8CE` | entier | `0x00070042` | `0x11CD94` : lit un tampon et range une liste (deux octets, puis la suite) |
| 8 | `0x00080042` | SetNZoneMacFilter | `cecdndm_0008_SetNZoneMacFilter` | `0x11C8F2` | entier | `0x00080042` | `cec_ndm_set_nzone_mac_filter` `0x11CDB8` : recopie le filtre (200 octets) sur la pile et le charge dans l'anneau d'adresses de 32 cases (`mac_ring_load_list_thunk_alt_11d200` `0x11D200`, `mac_ring_load_list` `0x10CA64`) |

Les huit en-têtes de requête sont exactement ceux que `ndm` envoie (`CECDNDM_Initialize` `0x103C18` à `CECDNDM_SetNZoneMacFilter` `0x103B8C`, `fiches/ndm.md` partie 7) : le client et le serveur s'accordent. Le lien SuspendDaemon, ResumeDaemon et les commandes 7, 8 et 9 est une **preuve de plus** que la liste des CecCommands de 3dbrew est bien l'énumération du module (voir plus bas).

### Ce que fait chaque commande de `cecd:u`, lu dans le code

- **Les verrous et les contrôles.** La plupart des gestionnaires prennent le verrou de la session (`lock_guard_enter`) ; les douze qui touchent aux fichiers ou aux données (1 à 0xA, 0x11, 0x12) testent `cec_access_is_blocked` (`cec_access_is_blocked_sys` dans `cecd:s`, qui a le même code) ; s'il rend 1, le gestionnaire rend le résultat `0xC8A10BF0` (constante lue à `0x11C584` et dans les gestionnaires voisins) sans toucher aux fichiers. 0xC8A10BF0 est le seul code d'erreur propre à `cecd` que j'ai trouvé dans les gestionnaires.
- **Lecture d'un message (3).** `cec_read_message` (`0x110AF8`) construit le chemin `"%s/%s/%s/_%s"` avec `data:/CEC`, l'identifiant de la boîte, `InBox___` (si l'argument de boîte est nul) ou `OutBox__`, et l'identifiant du message ; il lit au plus la taille donnée (la taille réelle du fichier si elle est plus petite) et rend la taille lue au mot 2 de la réponse. C'est le pas à pas de la partie 4.
- **Suppression (8).** `cec_delete` (`0x10EC80`) prend un type de chemin ; pour les messages (types 6 et 7, `InBox` et `OutBox`) il en fait le chemin avec l'identifiant du message, pour les dossiers il détruit le dossier (`0x113308`), pour les fichiers le fichier (`0x1126D2`) ; il remet à zéro un champ du moteur (`+8`) au passage.
- **Ouverture, lecture, écriture d'un fichier brut (1, 2, 5, 0x11, 0x12).** Les types de chemin sont ceux de 3dbrew (`CecDataPathType`). `cec_open_raw_file` (`0x11CC0C`) passe par `cec_open_raw_path` (`0x112188`), qui crée au besoin `data:/CEC` et le dossier de la boîte, rend la taille du fichier et retient type, boîte et drapeaux pour ReadRawFile et WriteRawFile ; quand le type est 0xB (dossier de la boîte) avec le drapeau de création, ou 0x96 (un fichier `MBoxData.050`) avec le drapeau suivant, il écrit 8 octets (`0x1180BC` puis `cec_write_raw_file`) dans un fichier de type 0x96. Pour `OpenRawFile` (1) et `OpenAndRead` (0x12), quand le type est 2 (`MBoxInfo`) et que le bit 1 des drapeaux est levé, le gestionnaire lève l'octet `+0x40` d'un objet global (voir Stop) ; `OpenAndWrite` (0x11), pour le type 2 et le bit 2, appelle d'abord `cec_prepare_write` puis, si l'écriture réussit, `cec_set_boxes_changed(1)` (`0x1137B0`, octet `[0x124298]+5`), que Delete et WriteMessageWithHMAC posent aussi : `cec_step_wireless_param_setup` ne reconstruit la donnée de balises (`cec_build_beacon_tags` `0x103718`) que si cet octet est levé. Le sens de l'octet `+0x40` n'est pas lu.
- **Start (0xB).** Le mot du message est une `CecCommand` de 3dbrew. Si l'octet testé par `cec_is_busy` (`0x112DAC`, qui lit un octet à `+1` d'un objet global) est non nul, le résultat est `0xC8A10BF0`. Sinon, pour la commande `0xE` (`RESET_FILTER`), le gestionnaire fait lui-même deux choses (`cec_set_boxes_changed(1)` et `cec_reset_filters(1)` `0x111494`, qui lève un octet à `+4` puis vide l'anneau d'adresses (`mac_ring_reset_thunk` `0x10570C`), remet le filtre (`cec_reset_mac_filter` `0x10777C`), sauvegarde l'adresse et l'anneau (`cec_save_mac_state` `0x1096B0`) et valide la sauvegarde (`cec_commit_save_data` `0x11253C`)) et rend 0 ; pour toutes les autres, il appelle `cec_run_command` (`0x1139F4`), qui appelle `cec_run_command_impl` (`0x102D78`) : un gros `switch` sur la commande, qui commence par `0xC8A10BF0` si l'octet `+0x3F` du moteur est nul (le moteur n'est pas démarré).
- **Stop (0xC).** Même appel, avec une condition qui change pour les commandes `0x12`, `0x13` et `0x14` (`OVER_BOSS`, `OVER_BOSS_FORCE`, `OVER_BOSS_FORCE_WAIT`). Pour les autres commandes, le gestionnaire refuse (`0xC8A10BF0`) quand `cec_is_busy` rend un nombre non nul, exactement comme Start. Pour ces trois-là, il refuse quand le drapeau `+0x40` posé plus haut est levé **et** que `cec_is_busy` rend 0 ; sinon la commande passe. Ce n'est pas un « arrêt » mais une seconde porte vers la même fonction : 3dbrew l'appelle RunCommandAlt et note « seems to be the same as RunCommand besides some extra checks ».
- **Les états.** `GetCecdState` (0xE) rend `cec_get_abbreviated_state` (`0x112E08`, qui regarde l'état courant du moteur à `0x104D38`) : c'est la valeur abrégée de 3dbrew (1 inactif, 2 « inactive », 3 balayage, 4 « WLREADY? », 5 autre).
- **Les événements.** `GetCecInfoEventHandle` (0xF) et `GetChangeStateEventHandle` (0x10) rendent chacun une poignée d'événement (mot 3 de la réponse, descripteur de poignée copiée) ; `GetCecInfoEventHandleSys` (0x402) fait de même pour `cecd:s`. L'événement de changement d'état est signalé par `cec_command_completion_thread_main` (`0x1034DC`) quand l'état visé par Start ou Stop est atteint (`cec_change_state_event_signal`), et le même fil signale l'événement du moteur `+0x3218` quand la classe d'état (`cec_state_to_daemon_status`) change (lien avec la poignée de GetCecInfoEventHandle non suivi) ; les enregistrements d'information (`cec_info_add_entry` `0x1053E4`, 24 de 0x18 octets) sont ajoutés à la réception des messages.

## Partie 4 : une opération pas à pas, ReadMessage

Lecture d'un message de la boîte d'entrée par un jeu (`cecd:u`, commande 3, `0x00030104`).

1. Le jeu envoie quatre mots ordinaires (d'après le pseudo-code, l'identifiant de la boîte et un mot qui choisit entre la boîte d'entrée, s'il est nul, et la boîte de sortie, puis la taille du tampon) et deux tampons : au mot 5 un tampon en lecture (`0xA`, l'identifiant du message, 8 octets d'après 3dbrew) et au mot 7 un tampon en écriture (`0xC`, où la lecture se range). C'est l'émulation qui donne la place des tampons ; le sens des quatre mots ordinaires est lu dans l'appel de `cec_read_message` et reste interprété.
2. `cecdu_handle_command` (`0x11A5BC`) vérifie l'en-tête en entier et saute à `cecdu_0003_ReadMessage` (`0x11C1D0`).
3. Le gestionnaire prend le verrou de la session (`session + 8`), vérifie l'accès (`cec_access_is_blocked`) ; refusé : `0xC8A10BF0`.
4. Il appelle `cec_read_message` (`0x110AF8`) sur l'objet moteur (`*0x...  + 0x2E00`).
5. `cec_read_message` met à zéro deux tampons locaux (`0x80` et `0x40` octets), convertit l'identifiant du message en texte (`u64_copy_or_zero_alt_10f6c2` `0x10F6C2`, `cec_message_id_to_string` `0x111DB4`), l'identifiant de boîte en texte aussi (`cec_box_id_to_string` `0x111D94`), et fabrique le chemin `data:/CEC/<boîte>/InBox___/_<message>` (ou `OutBox__`) par `sprintf` (`0x112770`) ; le convertit en chemin UTF-16 de l'archive (`mbs_to_utf16`, `0x11271E`).
6. Ouvre le fichier (`0x111D08`, qui range un objet de fichier dans une variable globale pour que `fs` ait un contexte d'erreur), lit sa taille (`0x10F254`), la plafonne à celle du tampon du jeu, lit (`0x111CB0`), ferme (`0x1126AE`) et écrit la taille lue à l'adresse de sortie.
7. Rend le résultat. Le gestionnaire libère le verrou et l'aiguillage écrit l'en-tête de réponse `0x00030084` : 2 mots ordinaires (le résultat et la taille lue) et 4 mots de traduction (les descripteurs des deux tampons, rendus au jeu).

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x122328` | table des services : trois paires (nom, nombre de sessions) : `cecd:u` 4, `cecd:s` 4, `cecd:ndm` 1 |
| `0x122340` | table des aiguillages : `0x11A5BD`, `0x11AF51`, `0x11AD69` (adresses Thumb) |
| `0x12234C` | les trois objets de service (`0x129000`, `0x129018`, `0x129024`) passés au gestionnaire du même rang par `cecd_main` |
| `0x122358` | les trois noms de service : `cecd:u`, `cecd:s`, `cecd:ndm` |
| `0x124708` | table des états du moteur, 0x24 octets par entrée (valeur sur 4 octets puis nom) : NONE 0, INIT 1, WIRELESS_PARAM_SETUP 2, WIRELESS_READY 3, WIRELESS_START_CONFIG 4, SCAN 0x10, SCANNING 0x11, CONNECT 0x12, CONNECTING 0x13, CONNECTED 0x14, CONNECT_TCP 0x15, CONNECTING_TCP 0x16, CONNECTED_TCP 0x17, NEGOTIATION 0x20, SEND_RECV_START 0x30, SEND_RECV_INIT 0x31, SEND_READY 0x32, SEND 0x33, RECEIVE_READY 0x34, RECEIVE 0x35, CONNECTION_FINISH_TCP 0x36, CONNECTION_FINISH 0x37, SEND_POST 0x38, RECEIVE_POST 0x39, FINISHING 0x3F, FINISH 0x40, OVER_BOSS 0x50, IDLE 0xFF ; ce sont les valeurs sur lesquelles `cecd_daemon_thread_main` aiguille ses 22 étapes `cec_step_*` |
| `0x124B08` | les quatre états de `ndm` : `NDM_STATUS_WORKING`, `NDM_STATUS_IDLE`, `NDM_STATUS_SUSPENDING`, `NDM_STATUS_SUSPENDED` |
| `0x124BA4` | les noms des 22 `CecCommand` (36 octets par entrée), dans l'ordre exact de 3dbrew : `NONE` 0, `START` 1, `RESET_START` 2, `READYSCAN` 3, `READYSCANWAIT` 4, `STARTSCAN` 5, `RESCAN` 6, `NDM_RESUME` 7, `NDM_SUSPEND` 8, `NDM_SUSPEND_IMMEDIATE` 9, `STOPWAIT` 0xA, `STOP` 0xB, `STOP_FORCE` 0xC, `STOP_FORCE_WAIT` 0xD, `RESET_FILTER` 0xE, `DAEMON_STOP` 0xF, `DAEMON_START` 0x10, `EXIT` 0x11, `OVER_BOSS` 0x12, `OVER_BOSS_FORCE` 0x13, `OVER_BOSS_FORCE_WAIT` 0x14, `END` 0x15 |
| `0x107B08`, `0x107B20`, `0x10C7D4` | les fichiers `data:/CEC/SessionId___`, `data:/CEC/MacFilter___`, `data:/CEC/MBoxList____` ; `data:/CEC/TMP` (fichiers temporaires) à `0x100D24` et ailleurs |
| `0x1243B9` et suite | des chaînes `CEC_TEST_000` à `CEC_TEST_006` (identifiants de boîtes de test, intégrés dans le module) |

Les chemins de boîte aux lettres sont ceux de 3dbrew : `data:/CEC/MBoxList____`, `data:/CEC/<id>/MBoxInfo____`, `InBox___/BoxInfo_____`, `OutBox__/OBIndex_____`, `InBox___/_<message>`, `OutBox__/_<message>`, `MBoxData.001` à `.199`. Le module écrit les chaînes `InBox___`, `OutBox__` et `%s/%s/%s/_%s` ; je n'ai pas relevé les autres dans le code.

Le moteur : l'objet `0x1254B0` (`cec_get_engine`, `0x10FE9C`, rangé en `0x124508` par `cec_mbox_ctor`) dont les gestionnaires prennent l'adresse `+ 0x2E00` (le gestionnaire de boîtes) ; l'état de la machine est le mot +0 de l'objet `[0x1251E4]` (`cec_get_state`, `cec_state_transition`). Les deux octets qui conditionnent les commandes sont à `+0x3F` (moteur démarré) et `+0x40` (boîte créée).

## Partie 6 : ce que Pokémon X envoie

Pokémon X envoie **seize** commandes à `cecd:u` et ne lit aucune réponse de `cecd:s` : sa seconde poignée (`0x5E9134`) ne reçoit que si un initialiseur la remplit, et d'après `pokemon-x-services.md` « jamais ouverte » (les seize en-têtes sont les mêmes que ceux de `cecd:u`, la bibliothèque du jeu prend la poignée de `cecd:u` quand la seconde est vide). Il n'envoie ni 0xD, ni 0xF, ni 0x1E à 0x21, ni aucune commande de `cecd:s` ou de `cecd:ndm`.

| Commande du jeu | En-tête | Fonction du jeu | Gestionnaire de `cecd:u` | Ce que le remplaçant doit rendre |
| --- | --- | --- | --- | --- |
| OpenRawFile | `0x000100C2` | `0x1EAC08` | `cecdu_0001_OpenRawFile` | un fichier qui existe vraiment : son contenu est rendu ensuite par ReadRawFile. Réponse `0x00010080` (un mot) |
| ReadRawFile | `0x00020042` | `0x1EAC58` | `cecdu_0002_ReadRawFile` | les octets du fichier ouvert et leur nombre. Réponse `0x00020082` |
| ReadMessage | `0x00030104` | `0x1EA8C4` | `cecdu_0003_ReadMessage` | le message demandé de la boîte d'entrée ou de sortie, et sa taille ; un message absent doit donner une erreur, pas des zéros |
| ReadMessageWithHMAC | `0x00040106` | `0x1EAAB8` | `cecdu_0004_ReadMessageWithHMAC` | idem, avec l'empreinte HMAC en plus |
| WriteRawFile | `0x00050042` | `0x1EAD18` | `cecdu_0005_WriteRawFile` | écrire dans le fichier ouvert |
| WriteMessage | `0x00060104` | `0x1EA980` | `cecdu_0006_WriteMessage` | ranger un message dans la boîte |
| WriteMessageWithHMAC | `0x00070106` | `0x1EAB4C` | `cecdu_0007_WriteMessageWithHMAC` | idem |
| Delete | `0x00080102` | `0x1EAD60` | `cecdu_0008_Delete` | effacer un message ou un dossier |
| SetData | `0x000900C2` | `0x1EADBC` | `cecdu_0009_SetData` | accepter la liste d'identifiants de messages ; peut rester sans effet |
| ReadData | `0x000A00C4` | `0x1EAE04` | `cecdu_000A_ReadData` | un tampon d'informations système (3dbrew : GetSystemInfo) |
| Start | `0x000B0040` | `0x1EACE0` | `cecdu_000B_Start` | succès (0) ; la commande est une CecCommand que le jeu envoie pour démarrer le démon |
| Stop | `0x000C0040` | `0x1EACA8` | `cecdu_000C_Stop` | succès (0) |
| GetCecdState | `0x000E0000` | `0x1EA944` | `cecdu_000E_GetCecdState` | un état abrégé : **1 (inactif)** convient pour « le démon est là, il ne fait rien » |
| GetChangeStateEventHandle | `0x00100000` | `0x1EABCC` | `cecdu_0010_GetChangeStateEventHandle` | une poignée d'événement valable (que le jeu pourra attendre) ; elle n'est jamais signalée si rien ne change |
| OpenAndWrite | `0x00110104` | `0x1EAA60` | `cecdu_0011_OpenAndWrite` | ouvrir (en créant), écrire, fermer |
| OpenAndRead | `0x00120104` | `0x1EA9F0` | `cecdu_0012_OpenAndRead` | ouvrir, lire, fermer |

Pour le portage PC, ce qui peut rester factice et ce qui doit être vrai :

- **Factice :** la réception. Aucune console ne passe à portée : les boîtes d'entrée restent vides, `GetCecdState` rend « inactif » (1), `Start` et `Stop` rendent 0, l'événement de changement d'état n'est jamais signalé. `cecd:s` et `cecd:ndm` ne sont pas utilisés par le jeu : inutile de les offrir (un jeu qui les demande reçoit `0xD88007FA`, port inconnu).
- **Doit être vrai :** le système de fichiers. Le jeu **écrit** sa boîte (OpenAndWrite, WriteRawFile, WriteMessage, SetData) et **relit** ensuite (OpenAndRead, ReadRawFile, ReadMessage). Le remplaçant doit donc garder ces fichiers sur disque, par boîte (un dossier par `cecId`), avec les types de chemin de 3dbrew (`MBoxList____`, `MBoxInfo____`, `BoxInfo_____`, `OBIndex_____`, messages), et rendre à la lecture ce qui a été écrit. Une écriture qui n'est pas relue (renvoyer toujours des zéros), ou un fichier absent traité comme une réussite, ferait croire au jeu que la boîte est corrompue ou vide d'une façon qu'il ne gère peut-être pas ; ce que le jeu fait d'une boîte absente n'est pas lu.
- **Pas lu :** les paramètres exacts de chaque commande côté jeu (le contrat n'a pas été fait pour `cecd:u`), la taille et le contenu de `MBoxInfo` et des messages, ce que le jeu fait des résultats.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les trois tables de commandes : 22 pour `cecd:u`, 38 pour `cecd:s` (les 22, plus 0x401, 0x402, 0x40A à 0x417), 8 pour `cecd:ndm`. Voie 1 : l'émulation des trois aiguillages. Voie 2 : le pseudo-code des gestionnaires, qui appellent les mêmes fonctions du moteur ; pour `cecd:ndm`, les huit commandes sont aussi celles que `ndm` envoie, avec les mêmes en-têtes.
- Les 22 CecCommands : l'énumération de 3dbrew et la table de noms du module (`0x124BA4`) ont les mêmes noms dans le même ordre ; `SuspendDaemon` envoie 8 ou 9, `ResumeDaemon` envoie 7, et `ndm` les envoie.
- Les chemins `data:/CEC/<boîte>/InBox___` et `OutBox__` et `_<message>` : formatés par `0x110AF8`, comme dans la page de 3dbrew.
- Le fait que `cecd:s` a des copies séparées des 22 commandes de `cecd:u`.

**Interprété** :
- Les noms des fonctions du moteur (`cec_*`) : donnés d'après la commande qui les appelle et, pour la lecture d'un message, d'après le chemin qu'elles construisent.
- Le rôle des octets `+0x3F` (moteur démarré) et `+0x40` (boîte créée), et de `cec_is_busy`.
- Les paramètres de chaque commande (identifiant de boîte, type de chemin, drapeaux, taille) : les en-têtes disent le nombre de mots, 3dbrew et les noms de chemins donnent l'idée, je n'ai pas relu chaque gestionnaire champ par champ.
- Que le serveur n'a qu'un fil de service.
- Les trois numéros de notification (`0x100`, `0x105`, `0x106`).

**Pas lu** :
- Le protocole de StreetPass, en partie : les phases de la négociation (0x10, 0x20, 0x30, 0x40, 0xF0), la liste d'échange 0x6565, la couche TCP (marque 0x5959, en-tête LLC/SNAP) et le format des balises sont lus (`local/analyse/cecd/notes-100-2.md`) ; restent le sens des statuts d'échange et des drapeaux de segment, l'en-tête supplémentaire de type 1 et les corps d'écriture `0x109984` et `0x10BF94`.
- Les champs exacts des commandes `Spr` (métadonnées des emplacements).
- Les deux listes de noms de services à `0x122430` et `0x122F30` (liste de la bibliothèque).
- Le rôle de `frd:u` : `frd_u_open` ouvre la session et lit la présence, l'usage par le moteur n'est pas suivi.
