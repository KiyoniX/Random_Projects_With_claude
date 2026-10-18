# ac, la connexion Wi-Fi

`ac` est le module qui connecte la console à un point d'accès Wi-Fi. Il garde les réglages réseau de l'utilisateur (trois emplacements), cherche les points d'accès, se connecte et se déconnecte à la demande d'un client, et dit à tous les autres si la console est en ligne. Un jeu lui parle par `ac:u` : il lui demande une configuration par défaut, la règle, lance une connexion asynchrone avec un événement, attend l'événement, puis lit le résultat. `ac:i`, le second service du module, est celui du menu système : il lit et écrit les réglages réseau eux-mêmes.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, le module est presque entièrement en Thumb), `emulate_dispatch.py` et un désassemblage de capstone. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002402`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `ac`, priorité 56 (`0x38`) |
| Fichier lu | `local/extrait/ac/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x1D978` octets de code (30 pages), `0x15B0` de données en lecture seule (2 pages), `0x5CE4` de données (6 pages), `0x1A0B8` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 1 575 pour Ghidra (1 478 en Thumb, 97 en ARM), plus 44 entrées (34 manquées par Ghidra, 10 posées à la main), moins 124 qui ne sont pas des fonctions (cas des deux aiguillages, suites que Ghidra coupe après `ipc_set_header`, boucles, rang de division, bloc d'exception) et 7 fonctions mortes : 1 488 ; 341 nommées dans `ac.noms.tsv`, 1 473 avec `local/analyse/ac/noms-proposes.tsv` |
| Services offerts | `ac:u` (65 commandes) et `ac:i` (227 commandes, dont les 65 de `ac:u`) ; jusqu'à 10 sessions, 11 sur New 3DS, pour les deux ensemble |
| Services appelés | lus dans l'exheader : `ac:u`, `ptm:s`, `ps:ps`, `nwm::INF`, `soc:P`, `soc:U`, `cfg:s`, `cfg:nor`, `http:C`, `fs:USER` ; lus dans le code : `ptm:s`, `cfg:s`, `cfg:nor`, `ps:ps`, `nwm::INF`, `soc:P`, `http:C`, `fs:USER`, plus `srv:` (port) ; `ac:u` (que l'exheader autorise, comme `ndm:u` pour `ndm`) n'a pas été vu ouvert ; `soc:U` n'est jamais ouvert : le secours de gethostid (`SOCU_gethostid` `0x1187A4` sur [`0x125B88`]) lit une poignée que seule la mise à zéro statique (`0x11B5C2`) écrit ; chemin mort, comme `cecd:u` dans boss |
| Dépendances déclarées | six titres : `cfg` (`…1702`), `http` (`…2902`), `nwm` (`…2D02`), `ps` (`…3102`), `ptm` (`…2202`), les sockets (`…2E02`) ; les noms viennent de la liste des titres système de 3dbrew |
| Fils | le fil principal, deux fils de service (un moniteur de lien et un exécuteur de tâches), un fil par session ouverte, et des fils de tâches lancés à la demande |

Le module contient aussi, dans sa section de données (de `0x121700` à `0x125900` environ), une collection de certificats racine publics en DER (Baltimore, GTE, GlobalSign, Thawte, VeriSign, Verizon, GeoTrust), et dans ses données en lecture seule une URL de test de connexion HTTP, six URL de serveurs d'authentification du réseau et deux chaînes de 24 caractères d'usage non lu, rangées à côté des URL. Ni les URL ni ces deux chaînes ne sont recopiées ici : un programme qui prend la place de la console n'en a pas besoin.

## Partie 1 : le démarrage et les fils

`entry` (`0x100000`) appelle six fonctions à la suite, puis `svcExitProcess` (dans `0x11c2a4`, `svc 3`) :

1. `clear_bss` (`0x100024`).
2. `0x100198` : met à jour deux champs du bloc des arguments du programme (même gabarit que dans `ndm`).
3. `0x1001e8` : appelle `0x100318` puis `srv_init` (`0x111148`), qui ouvre le port `srv:` (`srv_connect`, `0x100b04`, avec la même boucle de nouvel essai toutes les 500 ms que dans `ndm`) et se déclare (`SRV_RegisterClient`, `0x101610`).
4. `0x1001d0` : fixe la taille du tas à `0x11000` octets (interprété, trois petites fonctions non lues en détail).
5. `run_init_array_relative` (`0x114270`) et `run_init_array` (`0x10017c`) : les constructeurs globaux (une table de distances et une table d'adresses vide).
6. `ac_main` (`0x100048`, Thumb) : tout le reste.

`ac_main` fait dans l'ordre (lu dans le pseudo-code et l'assembleur de `0x100048`) :

1. `srv_init` ; `ptm_s_open` (`0x100a68`) ouvre `ptm:s` (le nom vient de la table à `0x11e340`, rang 2).
2. `0x100358` : demande à `ptm` si la console est une New 3DS (`PTMSYSM_CheckNew3DS`, `0x1015c0`, commande `0x040A0000`, comme `hid`). Si oui, le nombre de sessions passe de 10 (valeur du module, `0x121624`) à 11.
3. `0x1003b8` : `SRV_EnableNotification` (`0x100b60`), qui rend le sémaphore des notifications, rangé à `0x121670`.
4. `0x111134`, appelé cinq fois : `SRV_Subscribe` (`0x100b9c`) aux notifications `0x104`, `0x103`, `0x105`, `0x106` et `0x302`.
5. `0x10028c` : charge les réglages réseau (`load_network_settings_slots`, `0x10076c`, qui lit trois emplacements de `0xC00` octets) et ouvre `fs:USER` (`fs_init`, `0x10130c`).
6. `0x1002cc` : ouvre `soc:P` (`soc_p_open`, `0x100c88`) et `nwm::INF` (`nwm_inf_open`, `0x100A14`, qui appelle `service_session_open`, `0x101554`, l'ouvreur générique de session : même code que `service_session_open` de `ndm`).
7. `0x1001fc`, `0x10024c` (la file des tâches `0x1271a8`), puis la création de verrous et d'événements (`0x111124`, `0x1110f4`, `0x1110d0`, `0x11108c`) et `0x1003f4`, qui range une poignée à `0x12163c` : non lus en détail.
8. `server_main_loop` (`0x100418`) : la boucle de service, jamais quittée avant l'arrêt.

Les fils :

| Fil | Fonction | Adresse | Créé par | Ce qu'il fait |
| --- | --- | --- | --- | --- |
| Principal | `server_main_loop` | `0x100418` | le noyau | attend les notifications et les nouvelles sessions |
| Moniteur de lien | (non nommée) | `0x100cc8` | `start_helper_thread` (`0x100f38`) | attend deux signaux (`0x1013c0`), lit l'état du lien (`0x1014f0`) et, quand il passe à un état particulier, annule toutes les tâches en cours (`job_queue_cancel_all`, `0x1109b0`) ; interprété |
| Exécuteur de tâches | `job_thread_main` | `0x100d48` | `start_helper_thread` | attend trois signaux ; sur le premier, exécute la tâche suivante (`run_next_job`, `0x101160`) |
| Session `ac:u` | `acu_session_thread_main` | `0x100db8` | `start_session_thread` (`0x100f88`) | répond aux commandes d'un seul client |
| Session `ac:i` | `aci_session_thread_main` | `0x100ebc` | `start_session_thread` | idem pour `ac:i` |
| Balayage USB | `thread_entry_tail_call` | `0x105f3c` | `job_begin_scan_usb` (`0x105ca4`) | lancé par la tâche de type 9, BeginScanUsbAccessPoint ; `0x105f3c` n'est qu'un `bx r0` vers la fonction donnée, le vrai `thread_trampoline` est `0x107a6a` |

Tous passent par `create_thread` (`0x11071a`), qui appelle `create_thread_impl` (`0x105f40`), la seule fonction qui appelle `svcCreateThread` (`0x11c474`). Chaque fil de session a une pile de `0xC00` octets rangée à `0x129C60 +` rang `× 0xC00` ; son contexte (partie 6) est posé en bas de cette pile.

## Partie 2 : la boucle de serveur

C'est le schéma de `hid` : le fil principal accepte les sessions, chaque session a son fil.

**Dans `server_main_loop`** (`0x100418`) :

1. **Les noms.** La table `0x12165c` porte les deux noms, `ac:u` (`+4`, chaîne à `0x11e004`) et `ac:i` (`+8`, chaîne à `0x11e009`), et le sémaphore des notifications (`+0x14`).
2. **L'enregistrement.** `SRV_RegisterService` (`0x101648`, par `0x100ad4`, en-tête `0x00030100`) pour chaque nom, avec le nombre de sessions `0x121624` (10 ou 11).
3. **Deux fils de service.** `start_helper_thread` (`0x100f38`) lance le moniteur de lien (pile `0x133060`) et l'exécuteur de tâches (pile `0x132060`).
4. **L'attente.** `svcWaitSynchronizationN` (`0x11c3c0`) sur trois poignées : le sémaphore des notifications, le port `ac:u`, le port `ac:i`.
   - Le sémaphore : `0x10061c` traite la notification ; quand elle rend non nul, la boucle se termine et le module referme tout (interprété : c'est l'arrêt du système ; le numéro n'est pas lu).
   - Un port : `find_free_session_slot` (`0x100e1c`) cherche une case libre parmi `0x121624` (un masque de bits à `0x12166c`) ; s'il n'y en a pas, il attend la fin d'un fil de session. `svcAcceptSession` (`0x11c36c`) ouvre la session, puis `start_session_thread` lance le fil de la case, avec l'entrée `0x100db9` (`ac:u`) ou `0x100ebd` (`ac:i`).

**Dans le fil d'une session** : `acu_session_thread_main` (`0x100db8`) prépare le contexte (partie 6) puis appelle `acu_session_loop` (`0x10100c`) : une boucle qui appelle `svcReplyAndReceive` (`0x11c40c`, seule fonction du module à l'appeler) sur la poignée de sa session, puis `acu_handle_command` (`0x1020b0`) pour la requête reçue. Quand la session est fermée (résultat `0xC920181A`), le fil ferme la poignée et se termine. Pour `ac:i`, c'est `aci_session_loop` (`0x1010e8`) et `aci_handle_command` (`0x103330`). Le code de ces deux boucles est coupé par Ghidra en deux fonctions chacune (`0x10100c` et `0x101038`, `0x1010e8` et `0x101114`) ; l'assembleur les montre d'un seul tenant.

**Les notifications de `sm`.** Cinq abonnements (partie 1) : `0x103`, `0x104`, `0x105`, `0x106`, `0x302`. Les gestionnaires ne sont pas lus. `0x104` et `0x105` sont la veille et le réveil (voir `hid`, `ptm`) ; `ac` répond à `ptm` avec `PTMS_NotifySleepPreparationComplete` (`0x107c78`, en-tête `0x04030042`). `ac` publie lui-même des notifications par `SRV_PublishToSubscriber` (`0x109ea0`, en-tête `0x000C0080`), avec les numéros `0x300` (au premier raccordement, lu dans `0x106f0c`), `0x301` (lu dans `0x10d410`) et `0x305` (lu dans `0x107190`) : `ndm` s'abonne à `0x300` à `0x304` ([ndm](ndm.md)).

## Partie 3 : les commandes

Les noms et les en-têtes de requête viennent de 3dbrew quand la commande y est ; la fonction, l'adresse, l'en-tête de réponse et ce que le code vérifie sont lus dans le code et recoupés par `emulate_dispatch.py`. La colonne « Vérifié » dit si l'aiguillage compare tout l'en-tête (« entier ») ou seulement le numéro. Un en-tête entre parenthèses est celui de 3dbrew, quand le code ne compare que le numéro. Tous les en-têtes de réponse portent le résultat au mot 1.

### `ac:u`, 65 commandes

| N° | En-tête de requête | Commande | Fonction | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 0x0001 | `(0x00010000)` | CreateDefaultConfig | `acu_0001_CreateDefaultConfig` | `0x10fb38` | numéro | `0x00010042` |
| 0x0002 | `0x00020042` | DebugSetApType | `acu_0002_DebugSetApType` | `0x10fad0` | entier | `0x00020042` |
| 0x0003 | `0x00030042` | DebugSetNetworkArea | `acu_0003_DebugSetNetworkArea` | `0x10faa8` | entier | `0x00030042` |
| 0x0004 | `0x00040006` | ConnectAsync | `acu_0004_ConnectAsync` | `0x10f9b0` | entier | `0x00040040` |
| 0x0005 | `0x00050002` | GetConnectResult | `acu_0005_GetConnectResult` | `0x10f9a6` | entier | `0x00050040` |
| 0x0006 | `0x000600C6` | DebugSetNetworkSetting1 | `acu_0006_DebugSetNetworkSetting1` | `0x10f85c` | entier | `0x00060040` |
| 0x0007 | `0x00070002` | CancelConnectAsync | `acu_0007_CancelConnectAsync` | `0x10f84c` | entier | `0x00070040` |
| 0x0008 | `0x00080004` | CloseAsync | `acu_0008_CloseAsync` | `0x10f810` | entier | `0x00080040` |
| 0x0009 | `0x00090002` | GetCloseResult | `acu_0009_GetCloseResult` | `0x10f804` | entier | `0x00090040` |
| 0x000A | `(0x000A0000)` | GetLastErrorCode | `acu_000A_GetLastErrorCode` | `0x10777c` | numéro | `0x000A0080` |
| 0x000B | `(0x000B0000)` | GetLastDetailErrorCode | `acu_000B_GetLastDetailErrorCode` | `0x107790` | numéro | `0x000B0080` |
| 0x000C | `(0x000C0000)` | GetStatus | `acu_000C_GetStatus` | `0x10f7e8` | numéro | `0x000C0080` |
| 0x000D | `(0x000D0000)` | GetWifiStatus | `acu_000D_GetWifiStatus` | `0x10f7c0` | numéro | `0x000D0080` |
| 0x000E | `0x000E0042` | GetCurrentAPInfo | `acu_000E_GetCurrentAPInfo` | `0x10f77c` | entier | `0x000E0042` |
| 0x000F | `(0x000F0000)` | GetConnectingInfraPriority | `acu_000F_GetConnectingInfraPriority` | `0x10f73c` | numéro | `0x000F0080` |
| 0x0010 | `0x00100042` | GetCurrentNZoneInfo | `acu_0010_GetCurrentNZoneInfo` | `0x10f6f8` | entier | `0x00100042` |
| 0x0011 | `0x00110042` | GetNZoneApNumService | `acu_0011_GetNZoneApNumService` | `0x10f6a8` | entier | `0x00110042` |
| 0x0012 | `0x00120042` | GetConnectingHotspot | `acu_0012_GetConnectingHotspot` | `0x10f660` | entier | `0x00120042` |
| 0x0013 | `0x00130042` | GetConnectingHotspotSubset | `acu_0013_GetConnectingHotspotSubset` | `0x10f60c` | entier | `0x00130042` |
| 0x0014 | `0x00140002` | GetConnectingLocation | `acu_0014_GetConnectingLocation` | `0x10f554` | entier | `0x00140042` |
| 0x0015 | `0x00150004` | ExclusiveAsync | `acu_0015_ExclusiveAsync` | `0x10f4e4` | entier | `0x00150040` |
| 0x0016 | `0x00160002` | GetExclusiveResult | `acu_0016_GetExclusiveResult` | `0x10f4d8` | entier | `0x00160040` |
| 0x0017 | `0x00170004` | UnExclusiveAsync | `acu_0017_UnExclusiveAsync` | `0x10f49c` | entier | `0x00170040` |
| 0x0018 | `0x00180002` | GetUnExcusiveResult | `acu_0018_GetUnExcusiveResult` | `0x10f490` | entier | `0x00180040` |
| 0x0019 | `0x00190004` | CloseAllASync | `acu_0019_CloseAllASync` | `0x10f418` | entier | `0x00190040` |
| 0x001A | `0x001A0002` | GetCloseAllResult | `acu_001A_GetCloseAllResult` | `0x10f40c` | entier | `0x001A0040` |
| 0x001B | `0x001B0004` | LogoutHotspotAsync | `acu_001B_LogoutHotspotAsync` | `0x10f3a0` | entier | `0x001B0040` |
| 0x001C | `0x001C0002` | GetLogoutHotspotResult | `acu_001C_GetLogoutHotspotResult` | `0x10f394` | entier | `0x001C0040` |
| 0x001D | `0x001D0042` | ScanAPs | `acu_001D_ScanAPs` | `0x10f2c4` | entier | `0x001D0082` |
| 0x001E | `0x001E0042` | ScanNintendoZone | `acu_001E_ScanNintendoZone` | `0x10f200` | entier | `0x001E0082` |
| 0x001F | `0x001F0042` | ScanNintendoZoneSubset | `acu_001F_ScanNintendoZoneSubset` | `0x10f13c` | entier | `0x001F0082` |
| 0x0020 | `0x00200005` | BeginScanUsbAccessPoint | `acu_0020_BeginScanUsbAccessPoint` | `0x10f050` | entier | `0x00200040` |
| 0x0021 | `0x00210002` | EndScanUsbAccessPoint | `acu_0021_EndScanUsbAccessPoint` | `0x110530` | entier | `0x00210040` |
| 0x0022 | `0x00220042` | SetAllowApType | `acu_0022_SetAllowApType` | `0x10f028` | entier | `0x00220042` |
| 0x0023 | `0x00230042` | AddAllowApType | `acu_0023_AddAllowApType` | `0x10effc` | entier | `0x00230042` |
| 0x0024 | `0x00240042` | AddDenyApType | `acu_0024_AddDenyApType` | `0x10efd0` | entier | `0x00240042` |
| 0x0025 | `0x00250042` | SetNetworkArea | `acu_0025_SetNetworkArea` | `0x10efac` | entier | `0x00250042` |
| 0x0026 | `0x00260042` | SetInfraPriority | `acu_0026_SetInfraPriority` | `0x10ef84` | entier | `0x00260042` |
| 0x0027 | `0x00270002` | GetInfraPriority | `acu_0027_GetInfraPriority` | `0x10ef70` | entier | `0x00270080` |
| 0x0028 | `0x00280042` | SetPowerSaveMode | `acu_0028_SetPowerSaveMode` | `0x10ef48` | entier | `0x00280042` |
| 0x0029 | `0x00290002` | GetPowerSaveMode | `acu_0029_GetPowerSaveMode` | `0x10ef34` | entier | `0x00290080` |
| 0x002A | `0x002A0004` | SetBssidFilter | `acu_002A_SetBssidFilter` | `0x10ef04` | entier | - |
| 0x002B | `0x002B0004` | SetApNumFilter | `acu_002B_SetApNumFilter` | `0x10eed0` | entier | - |
| 0x002C | `0x002C0042` | SetFromApplication | `acu_002C_SetFromApplication` | `0x10eea8` | entier | `0x002C0042` |
| 0x002D | `0x002D0082` | SetRequestEulaVersion | `acu_002D_SetRequestEulaVersion` | `0x10ee80` | entier | `0x002D0042` |
| 0x002E | `0x002E00C4` | ConvertPassphraseToPsk | `acu_002E_ConvertPassphraseToPsk` | `0x10ee2c` | entier | `0x002E0042` |
| 0x002F | `0x002F0004` | GetNZoneBeaconNotFoundEvent | `acu_002F_GetNZoneBeaconNotFoundEvent` | `0x10edf8` | entier | `0x002F0040` |
| 0x0030 | `0x00300004` | RegisterDisconnectEvent | `acu_0030_RegisterDisconnectEvent` | `0x10edc8` | entier | `0x00300040` |
| 0x0031 | `0x00310002` | GetStatusChangeEvent | `acu_0031_GetStatusChangeEvent` | `0x10edac` | entier | `0x00310042` |
| 0x0032 | `0x00320042` | SetAuthServerType | `acu_0032_SetAuthServerType` | `0x10ed94` | entier | `0x00320040` |
| 0x0033 | `(0x00330000)` | GetConnectingSecurityMode | `acu_0033_GetConnectingSecurityMode` | `0x10ed64` | numéro | `0x00330080` |
| 0x0034 | `(0x00340000)` | GetConnectingSsid | `acu_0034_GetConnectingSsid` | `0x10ed30` | numéro | `0x00340042` |
| 0x0035 | `(0x00350000)` | GetConnectingSsidLength | `acu_0035_GetConnectingSsidLength` | `0x10ed00` | numéro | `0x00350080` |
| 0x0036 | `(0x00360000)` | GetConnectingProxyEnable | `acu_0036_GetConnectingProxyEnable` | `0x10ec98` | numéro | `0x00360080` |
| 0x0037 | `(0x00370000)` | GetConnectingProxyAuthType | `acu_0037_GetConnectingProxyAuthType` | `0x10ec68` | numéro | `0x00370080` |
| 0x0038 | `(0x00380000)` | GetConnectingProxyPort | `acu_0038_GetConnectingProxyPort` | `0x10ec38` | numéro | `0x00380080` |
| 0x0039 | `(0x00390000)` | GetConnectingProxyHost | `acu_0039_GetConnectingProxyHost` | `0x10ec04` | numéro | `0x00390042` |
| 0x003A | `(0x003A0000)` | GetConnectingProxyUserName | `acu_003A_GetConnectingProxyUserName` | `0x10ebd0` | numéro | `0x003A0042` |
| 0x003B | `(0x003B0000)` | GetConnectingProxyPassword | `acu_003B_GetConnectingProxyPassword` | `0x10eb9c` | numéro | `0x003B0042` |
| 0x003C | `0x003C0042` | GetAPSSIDList | `acu_003C_GetAPSSIDList` | `0x10ea30` | entier | `0x003C0042` |
| 0x003D | `0x003D0042` | SetZoneMacFilter | `acu_003D_SetZoneMacFilter` | `0x10ea10` | entier | - |
| 0x003E | `0x003E0042` | IsConnected | `acu_003E_IsConnected` | `0x10e9e4` | entier | `0x003E0080` |
| 0x003F | `(0x003F0040)` | GetNotAwakeMacFilter | `acu_003F_GetNotAwakeMacFilter` | `0x10e9b4` | numéro | `0x003F0082` |
| 0x0040 | `0x00400042` | SetClientVersion | `acu_0040_SetClientVersion` | `0x10e990` | entier | `0x00400040` |
| 0x0041 | `0x004100C6` | SetTemporaryNetworkSettings | `acu_0041_SetTemporaryNetworkSettings` | `0x10e8a0` | entier | `0x00410042` |

Les sept commandes dont l'émulation n'a pas retrouvé la fonction (`0x06`, `0x20`, `0x2A`, `0x2B`, `0x2E`, `0x3D`, `0x41`) ont leur appel dans le corps de l'aiguillage, deux tampons statiques de plus que ce que l'émulateur essaie ; les fonctions ont été lues dans le pseudo-code de `acu_handle_command`. Leurs en-têtes de réponse sont écrits à la fin du cas : `0x00060040` (`0x06`), `0x00200040` (`0x20`), `0x002E0042` (`0x2E`), `0x00410042` (`0x41`) ; pour `0x2A`, `0x2B` et `0x3D`, l'en-tête n'a pas été relevé.

L'aiguillage lit l'en-tête dans le tampon du fil (`get_tls`, `0x110ce8`, puis `+0x80`), prend le numéro dans les 16 bits du haut, et saute par une table. Il compare ensuite l'en-tête et les descripteurs avec quatre petites fonctions : `check_header` (`0x10fb18`, numéro, nombre de mots ordinaires, nombre de mots de traduction), `check_pid_descriptor` (`0x10fa96`, le descripteur `0x20`), `check_handle_descriptor` (`0x10fa7c`, la poignée copiée) et `check_static_buffer_descriptor` (`0x10faf8`, le tampon statique). Un numéro inconnu rend l'en-tête de réponse `0x00000040` et le résultat `0xD900182F`, un en-tête qui ne va pas `0x00000040` et `0xD9001830`.

### Ce que les commandes d'`ac:u` font de la configuration

Le jeu manipule une **configuration** de `0x200` octets, qu'il garde lui-même : `ac` la reçoit dans un tampon statique, la modifie ou la lit, puis la rend. Les écritures des commandes disent ce que contient chaque octet (lu dans les fonctions de réglage) :

| Décalage | Contenu | Commande qui l'écrit | Contrôle |
| --- | --- | --- | --- |
| `+0x00` | masque des types de point d'accès autorisés | SetAllowApType (`0x22`, `0x10f028`), AddAllowApType (`0x23`, `0x10effc`), AddDenyApType (`0x24`, `0x10efd0`, retire les bits donnés) | le masque doit être inférieur à `0x80000000` |
| `+0x04` | zone réseau | SetNetworkArea (`0x25`, `0x10efac`) | ConnectAsync exige moins de 3 |
| `+0x05` | économie d'énergie | SetPowerSaveMode (`0x28`, `0x10ef48`) | moins de 2 |
| `+0x06` | priorité d'infrastructure | SetInfraPriority (`0x26`, `0x10ef84`) ; GetInfraPriority (`0x27`, `0x10ef70`) la lit | moins de 3 |
| `+0x07` | origine de la demande | SetFromApplication (`0x2C`, `0x10eea8`) | moins de 7 |
| `+0x1A`, `+0x1B` | version demandée du contrat d'utilisation | SetRequestEulaVersion (`0x2D`, `0x10ee80`) | |

Les commandes de réglage copient d'abord la configuration reçue dans la configuration rendue si ce ne sont pas le même tampon. CreateDefaultConfig (`0x01`, `0x10fb38`) écrit une configuration neuve : tout à zéro, puis `+0` vaut `0xBF`, les six octets de `+8` à `+0xD` valent `0xFF`. Si le pointeur de sortie est nul, le résultat est `0xE0409FFF` (argument invalide), comme pour tous les réglages.

### `ac:i`, 162 commandes de plus

`ac:i` répond aux mêmes commandes qu'`ac:u` avec les mêmes fonctions aux mêmes adresses (le tableau ci-dessus ; seule la `0x3C` est refusée par l'émulation dans l'aiguillage d'`ac:i`, non tranché) et à 162 commandes qui lui sont propres, de `0x0401` à `0x04A2` (en tout 227 commandes). C'est le service du menu système : il charge, lit, écrit et enregistre les trois emplacements de réglages réseau (identifiant du réseau, mode de sécurité, adresse IP, serveur DNS, proxy, etc.). Dans le tableau, les noms sont ceux de 3dbrew : 106 des 162 commandes en ont un, 56 n'en ont pas (46 absentes de 3dbrew, 10 notées « ? »). Un en-tête entre parenthèses est celui de 3dbrew, quand le code ne compare que le numéro ; « numéro seul » veut dire que 3dbrew n'a pas de ligne pour cette commande. Les 22 lignes « dans l'aiguillage » sont celles que l'émulation n'a pas pu suivre : leur en-tête de requête est celui que le code compare quand il est connu, et leur réponse n'est pas relevée. La commande `0x3C` (GetAPSSIDList) n'est pas dans ce tableau : l'émulation la refuse dans l'aiguillage d'`ac:i`, alors qu'elle la suit dans celui d'`ac:u`.

| N° | En-tête de requête | Commande | Fonction | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 0x0401 | `(0x04010040)` | LoadNetworkSetting | `aci_0401_LoadNetworkSetting` | `0x106410` | numéro | `0x04010040` |
| 0x0402 | `(0x04020040)` | UpdateNetworkSetting | `aci_0402_UpdateNetworkSetting` | `0x106468` | numéro | `0x04020040` |
| 0x0403 | `(0x04030040)` | RemoveNetworkSetting | `aci_0403_RemoveNetworkSetting` | `0x106440` | numéro | `0x04030040` |
| 0x0404 | `(0x04040000)` | FlushNetworkSetting | `aci_0404_FlushNetworkSetting` | `0x106428` | numéro | `0x04040040` |
| 0x0405 | `0x04050084` | ConvertNetworkSettingNdsTo3ds | dans l'aiguillage | - | entier | `0x00000040` |
| 0x0406 | `(0x04060040)` | InitializeNetworkSetting | dans l'aiguillage | - | numéro | `0x04060040` |
| 0x0407 | `(0x04070000)` | GetNetworkSettingVersion | `aci_0407_GetNetworkSettingVersion` | `0x1064a4` | numéro | `0x04070080` |
| 0x0408 | `(0x04080040)` | SetNetworkSettingVersion | `aci_0408_SetNetworkSettingVersion` | `0x1064b4` | numéro | `0x04080040` |
| 0x0409 | `(0x04090000)` | GetNetworkSetting_Crc | `aci_0409_GetNetworkSetting_Crc` | `0x106488` | numéro | `0x04090080` |
| 0x040A | `(0x040A0040)` | SetNetworkSetting_Crc | `aci_040A_SetNetworkSetting_Crc` | `0x106498` | numéro | `0x040A0040` |
| 0x040B | `(0x040B0000)` | GetNetworkWirelessEnable | `aci_040B_GetNetworkWirelessEnable` | `0x10667c` | numéro | `0x040B0080` |
| 0x040C | `(0x040C0040)` | SetNetworkWirelessEnable | `aci_040C_SetNetworkWirelessEnable` | `0x10669c` | numéro | `0x040C0040` |
| 0x040D | `(0x040D0000)` | GetNetworkWirelessEditableEssidSecurity | `aci_040D_GetNetworkWirelessEditableEssidSecurity` | `0x1068b8` | numéro | `0x040D0080` |
| 0x040E | `(0x040E0040)` | SetNetworkWirelessEditableEssidSecurity | `aci_040E_SetNetworkWirelessEditableEssidSecurity` | `0x1068c8` | numéro | `0x040E0040` |
| 0x040F | `(0x040F0000)` | GetNetworkWirelessEssidSecuritySsid | `aci_040F_GetNetworkWirelessEssidSecuritySsid` | `0x106874` | numéro | `0x040F0042` |
| 0x0410 | `0x04100002` | SetNetworkWirelessEssidSecuritySsid | `aci_0410_SetNetworkWirelessEssidSecuritySsid` | `0x106888` | entier | `0x04100040` |
| 0x0411 | `(0x04110000)` | GetNetworkWireleesEssidSsidLength | `aci_0411_GetNetworkWireleesEssidSsidLength` | `0x106a60` | numéro | `0x04110080` |
| 0x0412 | `(0x04120040)` | SetNetworkWirelessEssidSsidLength | `aci_0412_SetNetworkWirelessEssidSsidLength` | `0x106a84` | numéro | `0x04120040` |
| 0x0413 | `(0x04130000)` | GetNetworkWirelessEssidSecurityMode | `aci_0413_GetNetworkWirelessEssidSecurityMode` | `0x106aa0` | numéro | `0x04130080` |
| 0x0414 | `(0x04140040)` | SetNetworkWirelessEssidSecurityMode | `aci_0414_SetNetworkWirelessEssidSecurityMode` | `0x106ab0` | numéro | `0x04140040` |
| 0x0415 | `(0x04150000)` | GetNetworkWirelessEssidPassphrase | `aci_0415_GetNetworkWirelessEssidPassphrase` | `0x106a4c` | numéro | `0x04150042` |
| 0x0416 | `0x04160002` | SetNetworkWirelessEssidPassphrase | dans l'aiguillage | - | entier | - |
| 0x0417 | numéro seul | GetNetworkWirelessEssidSecurityKey | `aci_0417_GetNetworkWirelessEssidSecurityKey` | `0x10682c` | numéro | `0x04170042` |
| 0x0418 | `0x04180002` | SetNetworkWirelessEssidSecurityKey | dans l'aiguillage | - | entier | - |
| 0x0419 | `(0x04190000)` | GetNetworkMultiSSIDEnable(bool) | `aci_0419_GetNetworkMultiSSIDEnable` | `0x106800` | numéro | `0x04190080` |
| 0x041A | `(0x041A0040)` | SetNetworkMultiSSIDEnable | `aci_041A_SetNetworkMultiSSIDEnable` | `0x106810` | numéro | `0x041A0040` |
| 0x041B | `(0x041B0000)` | GetNetworkWirelesMultiSsidMultiSsidType | `aci_041B_GetNetworkWirelesMultiSsidMultiSsidType` | `0x106990` | numéro | `0x041B0080` |
| 0x041C | `(0x041C0040)` | SetNetworkWirelesMultiSsidMultiSsidType | `aci_041C_SetNetworkWirelesMultiSsidMultiSsidType` | `0x1069f0` | numéro | `0x041C0040` |
| 0x041D | `(0x041D0000)` | GetNetworkWirelessMultiSsidSettingNum | `aci_041D_GetNetworkWirelessMultiSsidSettingNum` | `0x10689c` | numéro | `0x041D0080` |
| 0x041E | `(0x041E0040)` | SetNetworkWirelessMultiSsidSettingNum | `aci_041E_SetNetworkWirelessMultiSsidSettingNum` | `0x1068ac` | numéro | `0x041E0040` |
| 0x041F | `(0x041F0000)` | GetNetworkWirelessMultiSsidSetting0Ssid | `aci_041F_GetNetworkWirelessMultiSsidSetting0Ssid` | `0x1069a0` | numéro | `0x041F0042` |
| 0x0420 | `0x04200002` | SetNetworkWirelessMultiSsidSetting0Ssid | `aci_0420_SetNetworkWirelessMultiSsidSetting0Ssid` | `0x1069fc` | entier | `0x04200040` |
| 0x0421 | `(0x04210000)` | GetNetworkWirelessMultiSsidSetting0SsidLength | `aci_0421_GetNetworkWirelessMultiSsidSetting0SsidLength` | `0x106b20` | numéro | `0x04210080` |
| 0x0422 | `(0x04220040)` | (sans nom) | `aci_0422` | `0x106bb0` | numéro | `0x04220040` |
| 0x0423 | numéro seul | (sans nom) | `aci_0423` | `0x106c4c` | numéro | `0x04230080` |
| 0x0424 | `(0x04240040)` | (sans nom) | `aci_0424` | `0x106c98` | numéro | `0x04240040` |
| 0x0425 | `(0x04250000)` | GetNetworkWirelessMultiSsidSetting0PassPhrase | `aci_0425_GetNetworkWirelessMultiSsidSetting0PassPhrase` | `0x106b0c` | numéro | `0x04250042` |
| 0x0426 | `0x04260002` | (sans nom) | dans l'aiguillage | - | entier | - |
| 0x0427 | `(0x04270000)` | GetNetworkWirelessMultiSsidSetting0Key | `aci_0427_GetNetworkWirelessMultiSsidSetting0Key` | `0x1068e4` | numéro | `0x04270042` |
| 0x0428 | `0x04280002` | SetNetworkWirelessMultiSsidSetting0Key | dans l'aiguillage | - | entier | - |
| 0x0429 | `(0x04290000)` | GetNetworkMultiSsidSetting1Ssid | `aci_0429_GetNetworkMultiSsidSetting1Ssid` | `0x1069b4` | numéro | `0x04290042` |
| 0x042A | `0x042A0002` | SetNetworkMultiSsidSetting1Ssid | `aci_042A_SetNetworkMultiSsidSetting1Ssid` | `0x106a10` | entier | `0x042A0040` |
| 0x042B | `(0x042B0000)` | GetNetworkMultiSsidSetting1SsidLength | `aci_042B_GetNetworkMultiSsidSetting1SsidLength` | `0x106b44` | numéro | `0x042B0080` |
| 0x042C | `(0x042C0040)` | (sans nom) | `aci_042C` | `0x106bd0` | numéro | `0x042C0040` |
| 0x042D | numéro seul | (sans nom) | `aci_042D` | `0x106c5c` | numéro | `0x042D0080` |
| 0x042E | `(0x042E0040)` | (sans nom) | `aci_042E` | `0x106ca4` | numéro | `0x042E0040` |
| 0x042F | numéro seul | GetNetworkWirelessMultiSsidSetting1PassPhrase | `aci_042F_GetNetworkWirelessMultiSsidSetting1PassPhrase` | `0x106b30` | numéro | `0x042F0042` |
| 0x0430 | `0x04300002` | (sans nom) | dans l'aiguillage | - | entier | - |
| 0x0431 | `(0x04310000)` | GetNetworkWirelessMultiSsidSetting1Key | `aci_0431_GetNetworkWirelessMultiSsidSetting1Key` | `0x1068f8` | numéro | `0x04310042` |
| 0x0432 | `0x04320002` | SetNetworkWirelessMultiSsidSetting1Key | dans l'aiguillage | - | entier | - |
| 0x0433 | `(0x04330000)` | GetNetworkWirelessMultiSsidSetting2Ssid | `aci_0433_GetNetworkWirelessMultiSsidSetting2Ssid` | `0x1069c8` | numéro | `0x04330042` |
| 0x0434 | `0x04340002` | SetNetworkWirelessMultiSsidSetting2Ssid | `aci_0434_SetNetworkWirelessMultiSsidSetting2Ssid` | `0x106a24` | entier | `0x04340040` |
| 0x0435 | numéro seul | (sans nom) | `aci_0435` | `0x106b68` | numéro | `0x04350080` |
| 0x0436 | `(0x04360040)` | (sans nom) | `aci_0436` | `0x106bf0` | numéro | `0x04360040` |
| 0x0437 | numéro seul | (sans nom) | `aci_0437` | `0x106c6c` | numéro | `0x04370080` |
| 0x0438 | `(0x04380040)` | (sans nom) | `aci_0438` | `0x106cb0` | numéro | `0x04380040` |
| 0x0439 | `(0x04390000)` | GetNetworkWirelessMultiSsidSetting2Passphrase | `aci_0439_GetNetworkWirelessMultiSsidSetting2Passphrase` | `0x106b54` | numéro | `0x04390042` |
| 0x043A | `0x043A0002` | (sans nom) | dans l'aiguillage | - | entier | - |
| 0x043B | `(0x043B0000)` | GetNetworkWirelessMultiSsidSetting2Key | `aci_043B_GetNetworkWirelessMultiSsidSetting2Key` | `0x10690c` | numéro | `0x043B0042` |
| 0x043C | `0x043C0002` | SetNetworkWirelessMultiSsidSetting2Key | dans l'aiguillage | - | entier | - |
| 0x043D | `(0x043D0000)` | GetNetworkWirelessMultiSsidSetting3Ssid | `aci_043D_GetNetworkWirelessMultiSsidSetting3Ssid` | `0x1069dc` | numéro | `0x043D0042` |
| 0x043E | `0x043E0002` | SetNetworkWirelessMultiSsidSetting3Ssid | `aci_043E_SetNetworkWirelessMultiSsidSetting3Ssid` | `0x106a38` | entier | `0x043E0040` |
| 0x043F | numéro seul | (sans nom) | `aci_043F` | `0x106b8c` | numéro | `0x043F0080` |
| 0x0440 | numéro seul | (sans nom) | `aci_0440` | `0x106c10` | numéro | `0x04400040` |
| 0x0441 | numéro seul | (sans nom) | `aci_0441` | `0x106c7c` | numéro | `0x04410080` |
| 0x0442 | numéro seul | (sans nom) | `aci_0442` | `0x106cbc` | numéro | `0x04420040` |
| 0x0443 | numéro seul | (sans nom) | `aci_0443` | `0x106b78` | numéro | `0x04430042` |
| 0x0444 | `0x04440002` | (sans nom) | dans l'aiguillage | - | entier | - |
| 0x0445 | `(0x04450000)` | GetNetworkWirelessMultiSsidSetting3Key | `aci_0445_GetNetworkWirelessMultiSsidSetting3Key` | `0x106920` | numéro | `0x04450042` |
| 0x0446 | `0x04460002` | SetNetworkWirelessMultiSsidSetting3Key | dans l'aiguillage | - | entier | - |
| 0x0447 | `(0x04470000)` | GetNetworkIpEnableDHCP | `aci_0447_GetNetworkIpEnableDHCP` | `0x1065c4` | numéro | `0x04470080` |
| 0x0448 | `(0x04480040)` | SetNetworkIpEnableDHCP | `aci_0448_SetNetworkIpEnableDHCP` | `0x1065e4` | numéro | `0x04480040` |
| 0x0449 | `(0x04490000)` | GetNetworkAutoDNSSetting | `aci_0449_GetNetworkAutoDNSSetting` | `0x1066e8` | numéro | `0x04490080` |
| 0x044A | `(0x044A0040)` | SetNetworkAutoDNSSetting | `aci_044A_SetNetworkAutoDNSSetting` | `0x106708` | numéro | `0x044A0040` |
| 0x044B | `(0x044B0000)` | GetNetworkIpAddress | `aci_044B_GetNetworkIpAddress` | `0x106578` | numéro | `0x044B0042` |
| 0x044C | `0x044C0002` | SetNetworkIpAddress | dans l'aiguillage | - | entier | - |
| 0x044D | `(0x044D0000)` | GetNetworkDefaultGateway | `aci_044D_GetNetworkDefaultGateway` | `0x1066f8` | numéro | `0x044D0042` |
| 0x044E | `0x044E0002` | SetNetworkDefaultGateway | dans l'aiguillage | - | entier | - |
| 0x044F | `(0x044F0000)` | GetNetworkIpNetmask | `aci_044F_GetNetworkIpNetmask` | `0x106514` | numéro | `0x044F0042` |
| 0x0450 | `0x04500002` | SetNetworkIpNetMask | dans l'aiguillage | - | entier | - |
| 0x0451 | `(0x04510000)` | GetNetworkIpPrimaryDNS | `aci_0451_GetNetworkIpPrimaryDNS` | `0x1065d4` | numéro | `0x04510042` |
| 0x0452 | `0x04520002` | SetNetworkIpPrimaryDNS | dans l'aiguillage | - | entier | - |
| 0x0453 | `(0x04530000)` | GetNetworkIpSecondaryDNS | `aci_0453_GetNetworkIpSecondaryDNS` | `0x10666c` | numéro | `0x04530042` |
| 0x0454 | `0x04540002` | SetNetworkIpSecondaryDNS | dans l'aiguillage | - | entier | - |
| 0x0455 | `(0x04550000)` | GetNetworkIpScanlessConnectHasConnected | `aci_0455_GetNetworkIpScanlessConnectHasConnected` | `0x1068d4` | numéro | `0x04550080` |
| 0x0456 | `(0x04560040)` | SetNetworkIpScanlessConnectHasConnected | `aci_0456_SetNetworkIpScanlessConnectHasConnected` | `0x106934` | numéro | `0x04560040` |
| 0x0457 | numéro seul | (sans nom) | `aci_0457` | `0x106d28` | numéro | `0x04570042` |
| 0x0458 | `0x04580002` | (sans nom) | dans l'aiguillage | - | entier | - |
| 0x0459 | numéro seul | GetNetworkIpScanlessConnectLastConnectedBssid | `aci_0459_GetNetworkIpScanlessConnectLastConnectedBssid` | `0x106ae4` | numéro | `0x04590042` |
| 0x045A | `0x045A0002` | SetNetworkIpScanlessConnectLastConnectedBssid | dans l'aiguillage | - | entier | - |
| 0x045B | numéro seul | (sans nom) | `aci_045B` | `0x106c3c` | numéro | `0x045B0080` |
| 0x045C | numéro seul | (sans nom) | `aci_045C` | `0x106c8c` | numéro | `0x045C0040` |
| 0x045D | numéro seul | (sans nom) | `aci_045D` | `0x106e80` | numéro | `0x045D0080` |
| 0x045E | numéro seul | (sans nom) | `aci_045E` | `0x106e90` | numéro | `0x045E0040` |
| 0x045F | `(0x045F0000)` | GetNetworkProxyEnable | `aci_045F_GetNetworkProxyEnable` | `0x106588` | numéro | `0x045F0080` |
| 0x0460 | `(0x04600040)` | SetNetworkProxyEnable | `aci_0460_SetNetworkProxyEnable` | `0x1065a8` | numéro | `0x04600040` |
| 0x0461 | `(0x04610000)` | GetNetworkProxyAuthType | `aci_0461_GetNetworkProxyAuthType` | `0x106600` | numéro | `0x04610080` |
| 0x0462 | `(0x04620040)` | SetNetworkProxyAuthType | `aci_0462_SetNetworkProxyAuthType` | `0x106638` | numéro | `0x04620040` |
| 0x0463 | `(0x04630000)` | GetNetworkProxyPort | `aci_0463_GetNetworkProxyPort` | `0x106538` | numéro | `0x04630080` |
| 0x0464 | `(0x04640040)` | SetNetworkProxyPort | `aci_0464_SetNetworkProxyPort` | `0x10656c` | numéro | `0x04640040` |
| 0x0465 | `(0x04650000)` | GetNetworkProxyHost | `aci_0465_GetNetworkProxyHost` | `0x106524` | numéro | `0x04650042` |
| 0x0466 | `0x04660002` | SetNetworkProxyHost | dans l'aiguillage | - | entier | - |
| 0x0467 | `(0x04670000)` | GetNetworkSettingProxyUserName | `aci_0467_GetNetworkSettingProxyUserName` | `0x106624` | numéro | `0x04670042` |
| 0x0468 | `0x04680002` | SetNetworkSettingProxyUserName | dans l'aiguillage | - | entier | - |
| 0x0469 | `(0x04690000)` | GetNetworkSettingProxyPassword | `aci_0469_GetNetworkSettingProxyPassword` | `0x106610` | numéro | `0x04690042` |
| 0x046A | `0x046A0002` | SetNetworkSettingProxyPassword | dans l'aiguillage | - | entier | - |
| 0x046B | `(0x046B0000)` | GetNetworkEnableUPnP | `aci_046B_GetNetworkEnableUPnP` | `0x1066a8` | numéro | `0x046B0080` |
| 0x046C | `(0x046C0040)` | SetNetworkEnableUPnP | `aci_046C_SetNetworkEnableUPnP` | `0x1066b8` | numéro | `0x046C0040` |
| 0x046D | `(0x046D0000)` | GetNetworkOtherMtu | `aci_046D_GetNetworkOtherMtu` | `0x1064f8` | numéro | `0x046D0080` |
| 0x046E | `(0x046E0040)` | SetNetworkOtherMtu | `aci_046E_SetNetworkOtherMtu` | `0x106508` | numéro | `0x046E0040` |
| 0x046F | `(0x046F0000)` | GetConnectingNetworkSettingVersion(?) | `aci_046F_GetConnectingNetworkSettingVersion` | `0x1066c4` | numéro | `0x046F0080` |
| 0x0470 | `(0x04700000)` | GetConnectingNetworkCrc | `aci_0470_GetConnectingNetworkCrc` | `0x1065b4` | numéro | `0x04700080` |
| 0x0471 | `(0x04710000)` | GetConnectingNetworkWirelessEnable | `aci_0471_GetConnectingNetworkWirelessEnable` | `0x1067f0` | numéro | `0x04710080` |
| 0x0472 | numéro seul | (sans nom) | `aci_0472` | `0x106c2c` | numéro | `0x04720080` |
| 0x0473 | `(0x04730000)` | GetConnectingNetworkWirelessEssidSsid | `aci_0473_GetConnectingNetworkWirelessEssidSsid` | `0x106ad0` | numéro | `0x04730042` |
| 0x0474 | numéro seul | (sans nom) | `aci_0474` | `0x106dbc` | numéro | `0x04740080` |
| 0x0475 | numéro seul | (sans nom) | `aci_0475` | `0x106dcc` | numéro | `0x04750080` |
| 0x0476 | numéro seul | (sans nom) | `aci_0476` | `0x106da8` | numéro | `0x04760042` |
| 0x0477 | `(0x04770000)` | GetConnectingNetworkWirelessEssidSecurityKey | `aci_0477_GetConnectingNetworkWirelessEssidSecurityKey` | `0x106abc` | numéro | `0x04770042` |
| 0x0478 | `(0x04780000)` | GetConnectingNetworkMultiSsidEnable | `aci_0478_GetConnectingNetworkMultiSsidEnable` | `0x106a90` | numéro | `0x04780080` |
| 0x0479 | numéro seul | (sans nom) | `aci_0479` | `0x106d48` | numéro | `0x04790080` |
| 0x047A | numéro seul | (sans nom) | `aci_047A` | `0x106c1c` | numéro | `0x047A0080` |
| 0x047B | numéro seul | (sans nom) | `aci_047B` | `0x106d58` | numéro | `0x047B0042` |
| 0x047C | numéro seul | (sans nom) | `aci_047C` | `0x106e04` | numéro | `0x047C0080` |
| 0x047D | numéro seul | (sans nom) | `aci_047D` | `0x106eac` | numéro | `0x047D0080` |
| 0x047E | numéro seul | (sans nom) | `aci_047E` | `0x106df0` | numéro | `0x047E0042` |
| 0x047F | numéro seul | (sans nom) | `aci_047F` | `0x106cd8` | numéro | `0x047F0042` |
| 0x0480 | numéro seul | (sans nom) | `aci_0480` | `0x106d6c` | numéro | `0x04800042` |
| 0x0481 | numéro seul | (sans nom) | `aci_0481` | `0x106e28` | numéro | `0x04810080` |
| 0x0482 | numéro seul | (sans nom) | `aci_0482` | `0x106ebc` | numéro | `0x04820080` |
| 0x0483 | numéro seul | (sans nom) | `aci_0483` | `0x106e14` | numéro | `0x04830042` |
| 0x0484 | numéro seul | (sans nom) | `aci_0484` | `0x106cec` | numéro | `0x04840042` |
| 0x0485 | numéro seul | (sans nom) | `aci_0485` | `0x106d80` | numéro | `0x04850042` |
| 0x0486 | numéro seul | (sans nom) | `aci_0486` | `0x106e4c` | numéro | `0x04860080` |
| 0x0487 | numéro seul | (sans nom) | `aci_0487` | `0x106ecc` | numéro | `0x04870080` |
| 0x0488 | numéro seul | (sans nom) | `aci_0488` | `0x106e38` | numéro | `0x04880042` |
| 0x0489 | numéro seul | (sans nom) | `aci_0489` | `0x106d00` | numéro | `0x04890042` |
| 0x048A | numéro seul | (sans nom) | `aci_048A` | `0x106d94` | numéro | `0x048A0042` |
| 0x048B | numéro seul | (sans nom) | `aci_048B` | `0x106e70` | numéro | `0x048B0080` |
| 0x048C | numéro seul | (sans nom) | `aci_048C` | `0x106edc` | numéro | `0x048C0080` |
| 0x048D | numéro seul | (sans nom) | `aci_048D` | `0x106e5c` | numéro | `0x048D0042` |
| 0x048E | numéro seul | (sans nom) | `aci_048E` | `0x106d14` | numéro | `0x048E0042` |
| 0x048F | `(0x048F0000)` | GetConnectingNetworkEnableDHCP(bool) | `aci_048F_GetConnectingNetworkEnableDHCP` | `0x106788` | numéro | `0x048F0080` |
| 0x0490 | `(0x04900000)` | GetConnectingNetworkIpAutoDNSSetting | `aci_0490_GetConnectingNetworkIpAutoDNSSetting` | `0x106854` | numéro | `0x04900080` |
| 0x0491 | `(0x04910000)` | GetConnectingNetworkIpAddress | `aci_0491_GetConnectingNetworkIpAddress` | `0x106768` | numéro | `0x04910042` |
| 0x0492 | `(0x04920000)` | GetConnectingNetworkIpDefaultGateway | `aci_0492_GetConnectingNetworkIpDefaultGateway` | `0x106864` | numéro | `0x04920042` |
| 0x0493 | `(0x04930000)` | GetConnectingNetworkIpNetmask | `aci_0493_GetConnectingNetworkIpNetmask` | `0x106734` | numéro | `0x04930042` |
| 0x0494 | `(0x04940000)` | GetConnectingNetworkPrimaryDNS | `aci_0494_GetConnectingNetworkPrimaryDNS` | `0x106798` | numéro | `0x04940042` |
| 0x0495 | `(0x04950000)` | GetConnectingNetworkSecondaryDNS | `aci_0495_GetConnectingNetworkSecondaryDNS` | `0x1067e0` | numéro | `0x04950042` |
| 0x0496 | numéro seul | (sans nom) | `aci_0496` | `0x106cc8` | numéro | `0x04960080` |
| 0x0497 | numéro seul | (sans nom) | `aci_0497` | `0x106eec` | numéro | `0x04970042` |
| 0x0498 | numéro seul | (sans nom) | `aci_0498` | `0x106ddc` | numéro | `0x04980042` |
| 0x0499 | numéro seul | (sans nom) | `aci_0499` | `0x106e9c` | numéro | `0x04990080` |
| 0x049A | numéro seul | (sans nom) | `aci_049A` | `0x106efc` | numéro | `0x049A0080` |
| 0x049B | `(0x049B0000)` | GetConnectingNetworkProxyEnable(bool) | `aci_049B_GetConnectingNetworkProxyEnable` | `0x106778` | numéro | `0x049B0080` |
| 0x049C | `(0x049C0000)` | GetConnectingNetworkProxyAuthType | `aci_049C_GetConnectingNetworkProxyAuthType` | `0x1067a8` | numéro | `0x049C0080` |
| 0x049D | `(0x049D0000)` | GetConnectingNetworkProxyPort | `aci_049D_GetConnectingNetworkProxyPort` | `0x106758` | numéro | `0x049D0080` |
| 0x049E | `(0x049E0000)` | GetConnectingNetworkProxyHost | `aci_049E_GetConnectingNetworkProxyHost` | `0x106744` | numéro | `0x049E0042` |
| 0x049F | `(0x049F0000)` | GetConnectingNetworkProxyUserName | `aci_049F_GetConnectingNetworkProxyUserName` | `0x1067cc` | numéro | `0x049F0042` |
| 0x04A0 | `(0x04A00000)` | GetConnectingNetworkProxyPassword | `aci_04A0_GetConnectingNetworkProxyPassword` | `0x1067b8` | numéro | `0x04A00042` |
| 0x04A1 | `(0x04A10000)` | GetConnectingNetworkEnableUPnP(bool) | `aci_04A1_GetConnectingNetworkEnableUPnP` | `0x10681c` | numéro | `0x04A10080` |
| 0x04A2 | `(0x04A20000)` | GetConnectingNetworkMtu | `aci_04A2_GetConnectingNetworkMtu` | `0x106724` | numéro | `0x04A20080` |

## Partie 4 : ConnectAsync, pas à pas

C'est la commande `0x04`. Elle rend aussitôt, et le résultat vient plus tard, avec un signal sur l'événement que le client a donné.

1. **La requête.** `acu_handle_command` demande l'en-tête `0x00040006` en entier : le mot 1 est le descripteur `0x20` (numéro du processus), le mot 3 un descripteur de poignée copiée (l'événement), le mot 5 un tampon statique (la configuration de `0x200` octets).
2. **Les contrôles.** `acu_0004_ConnectAsync` (`0x10f9b0`) refuse (résultat `0xE0409FFF`) un tampon nul, un masque de types à `0x80000000` ou plus, un octet `+4` de 3 ou plus, un octet `+6` de 3 ou plus, un octet `+7` de 7 ou plus.
3. **L'état du lien.** Si l'octet `+6` de la configuration est nul (priorité 0) et que l'objet d'état `0x121648` n'est pas dans l'état attendu (`0x10de00`), la poignée de l'événement est refermée et le résultat est `0xC9209FFB`. Le sens de cet état n'est pas lu (interprété : le Wi-Fi est coupé).
4. **Une seule connexion par session.** Si la tâche de connexion de la session est déjà active (octet `+0x418` du contexte), la poignée est refermée et le résultat est `0xE0A09FFC`.
5. **La tâche.** Sinon `ac` range dans le contexte le numéro de processus (`+0x498`), la configuration (copiée à `+0x4E0`), la poignée de l'événement (`+0x4A0`), met l'octet `+0x418` à 1 (tâche active), et pose dans le champ « résultat » (`+0x4BC`) la valeur d'attente `0xE1209C46` (écrite par `job_queue_push`, `0x10de20`). Il la place dans la file des tâches (`0x1271a8`) et rend 0. La réponse est `0x00040040`.
6. **L'exécution.** L'exécuteur de tâches (`job_thread_main`, `0x100d48`) se réveille ; `run_next_job` (`0x101160`) prend la première tâche, vérifie le numéro de processus, et saute selon le type de la tâche (octet `+1` de la tâche, table à `0x1011c3`). Le type de ConnectAsync est 0 ; la table complète est ci-dessous.
7. **La connexion.** Pour le type 0, si l'octet `+7` de la configuration vaut 3, `0x105a74` enchaîne `connect_to_ap` (`0x1102bc`), `job_exclusive` (`0x1100b4`), `job_logout_hotspot` (`0x1100f0`) et `job_unexclusive` (`0x110068`) (interprété : les noms sont ceux des types de tâche, le sens de l'enchaînement n'est pas lu) ; sinon `0x1102bc` seule. `connect_to_ap` (`0x1102bc`) dépend de l'état global du lien (`0x121610`, de 1 à 3) : elle appelle les fonctions qui parlent à `nwm::INF` (`0x106fa0`, `0x107190`, `0x10d574`). Ce que ces fonctions envoient à `nwm` n'est pas lu en détail.
8. **La fin.** `run_next_job` écrit le résultat dans le champ `+0x4BC` (`**(tâche + 0xC) = résultat`), puis signale l'événement du client (`SignalEvent`, `0x110f5c`), le referme si la tâche l'avait en propre, remet à zéro les octets d'état de la tâche et la retire de la file.
9. **Le résultat.** Le client lit le résultat par GetConnectResult (`0x05`), `acu_0005_GetConnectResult` (`0x10f9a6`) : il rend ce champ tel quel, donc `0xE1209C46` tant que la tâche n'est pas finie.

| Type | Commande qui crée la tâche | Fonction qui l'exécute |
| --- | --- | --- |
| 0 | ConnectAsync (`0x04`) | `0x105a74` ou `connect_to_ap` (`0x1102bc`) |
| 1 | CloseAsync (`0x08`) | `job_close` (`0x10ffd0`) |
| 2 | CloseAllAsync (`0x19`) | `0x11029c` |
| 3 | LogoutHotspotAsync (`0x1B`) | `job_logout_hotspot` (`0x1100f0`) |
| 4 | ExclusiveAsync (`0x15`) | `job_exclusive` (`0x1100b4`) |
| 5 | UnExclusiveAsync (`0x17`) | `job_unexclusive` (`0x110068`) |
| 6 | ScanAPs (`0x1D`) | `job_scan_aps` (`0x105848`, une entrée de `0x34` octets par point d'accès) |
| 7 | ScanNintendoZone (`0x1E`) | `job_scan_nintendo_zone` (`0x105948`, entrées de `0xA4` octets) |
| 8 | ScanNintendoZoneSubset (`0x1F`) | `job_scan_nintendo_zone_subset` (`0x105b5c`, entrées de `0x24` octets) |
| 9 | BeginScanUsbAccessPoint (`0x20`) | `job_begin_scan_usb` (`0x105ca4`, qui lance un fil) |
| 10 | EndScanUsbAccessPoint (`0x21`) | `job_end_scan_usb` (`0x105af0`) |

Les types viennent de l'octet que chaque commande écrit dans la tâche (`+0x401` pour les balayages, `+0x419` pour ConnectAsync, `+0x431` pour CloseAsync, `+0x449` pour les deux exclusivités, `+0x461` pour LogoutHotspot) ; le saut de `run_next_job` est lu dans la table d'octets de `0x1011c3` (14, 36, 38, 43, 48, 53, 58, 70, 82, 94, 102, 26, 0, 104, chacun doublé).

**CloseAsync (`0x08`) et GetCloseResult (`0x09`)** font la même chose avec la tâche de type 1 ; le champ « résultat » est à `+0x4C0` (`close_request_push`, `0x110640`) et la poignée à `+0x4A4`. **ScanAPs (`0x1D`)** est synchrone : `acu_001D_ScanAPs` (`0x10f2c4`) crée un événement, pousse la tâche de type 6, attend, puis rend l'octet du nombre de points d'accès trouvés (réponse `0x001D0082`) ; si la version du client est inférieure à `0x03010000`, les erreurs sont remplacées par 0.

## Partie 5 : GetWifiStatus, pas à pas

Commande `0x0D`, la plus courte des lectures d'état.

1. `acu_session_loop` reçoit la requête sur la poignée de la session. L'en-tête n'est pas comparé en entier : l'aiguillage ne regarde que le numéro `0x0D`.
2. `acu_handle_command` appelle `acu_000D_GetWifiStatus` (`0x10f7c0`) avec l'adresse d'un mot de sortie.
3. La fonction lit le mot global `0x121614`. S'il n'est pas nul, elle le recopie dans la sortie et rend 0. S'il est nul, elle rend `0xE0A09D2E` (description 302) et la sortie n'est pas écrite.
4. L'aiguillage écrit la réponse par `ipc_set_header` (`0x110bd8`) : commande 13, deux mots ordinaires, aucun mot de traduction, soit `0x000D0080`, suivi du résultat et de la valeur. La session rend la main à `svcReplyAndReceive`.

Le mot `0x121614` est le **type** de lien (un masque) et `0x121610` (un mot de 16 bits, rendu par GetStatus, commande `0x0C`) son **état** de 0 à 3 : ce partage est lu dans `connect_to_ap`, où l'état de 1 à 3 mène à trois chemins, et où le masque est comparé à `0x10` et `0x20` ; le sens de chaque bit n'est pas lu.

## Partie 6 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x12165c` | table des services : `+4` et `+8` pointent les noms `ac:u` et `ac:i`, `+0x10` le masque des cases de session prises, `+0x14` le sémaphore des notifications |
| `0x121624` | nombre de sessions au plus : 10, ou 11 sur New 3DS |
| `0x12163c` | une poignée attendue par l'exécuteur de tâches (rangée par `0x1003f4`) |
| `0x121610`, `0x121614` | état (16 bits) et type (32 bits) du lien |
| `0x1292a4` | les `0x34` octets que rend GetCurrentAPInfo (le point d'accès courant) |
| `0x1271a8` | la file des tâches ; le vecteur est à `+0x608`, `+0x60C` et `+0x610` |
| `0x129C60` | les piles des fils de session, `0xC00` octets chacune, avec le contexte de la session |
| `0x134060` | les poignées des fils de session, 8 octets par case |
| `0x1340b8` | l'objet d'état de la connexion (lu par IsConnected et GetConnectingInfraPriority) |
| `0x125b94` | enregistrement de `srv:` (compteur d'ouvertures à `+4`) ; sa poignée est à `0x125b9c` |
| `0x125b78`, `0x125ba0`, `0x125ba4`, `0x125ba8`, `0x125be4`, `0x125c00`, `0x125b8c`, `0x125b14` | les poignées de `ps:ps`, `cfg:nor`, `cfg:s` (deux copies) , `nwm::INF`, `ptm:s`, `soc:P` (deux), `fs:USER` |

Le contexte d'une session (au bas de sa pile, `0x6F4` octets ; seuls les champs lus) :

| Décalage | Contenu |
| --- | --- |
| `+0x100` | zone de travail (reçoit la configuration par défaut) |
| `+0x400` à `+0x417` | la tâche de balayage (octet `+0x400` : active ; `+0x401` : type) |
| `+0x418` à `+0x42F` | la tâche de connexion |
| `+0x430` à `+0x447` | la tâche de fermeture |
| `+0x448` à `+0x45F` | la tâche d'exclusivité |
| `+0x460` à `+0x477` | la tâche de déconnexion d'un hotspot |
| `+0x478` | la configuration de la tâche de connexion (pointeur) |
| `+0x498` | numéro de processus du client |
| `+0x49C` | version du client (SetClientVersion) |
| `+0x4A0` | poignée de l'événement de ConnectAsync |
| `+0x4BC`, `+0x4C0` | résultat de ConnectAsync, résultat de CloseAsync |
| `+0x4CC` | l'événement de RegisterDisconnectEvent |
| `+0x4D0` | le bloc d'erreur : `+0x4D8` le code rendu par GetLastErrorCode, `+0x4DC` celui de GetLastDetailErrorCode |
| `+0x4E0` | la copie de la configuration de ConnectAsync |

## Partie 7 : les services que `ac` appelle

`ac` envoie ses requêtes par `svcSendSyncRequest` (`0x110bd0`), en-tête écrit par `ipc_set_header` (`0x110bd8`, le même gabarit que dans `ndm` : numéro dans les 16 bits du haut, mots ordinaires bits 6 à 11, mots de traduction bits 0 à 5). Les fonctions d'envoi sont relevées une à une dans `noms-proposes.tsv` (FSUSER_, FSFILE_, HTTPC_, SOCP_, SOCU_, PSPS_, CFG_, NWMINF_, SRV_, ERRF_) ; les 31 dont la poignée est une variable globale connue (relevées par un script sur l'assembleur et le pseudo-code) sont classées ci-dessous, les autres vont à des poignées rangées dans des objets (surtout `http:C`, `soc:P` et `fs:USER`) et ne sont pas classées. Les noms viennent de 3dbrew ou des fiches de `cfg` et `ptm` quand la commande y est nommée.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` (port) | `0x125b9c` | `0x00010002` | `SRV_RegisterClient` | `0x101610` | se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x100b60` | obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x101648` | créer `ac:u` et `ac:i` |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x107df8` | ouvrir les services ci-dessous |
| | | `0x00090040` | `SRV_Subscribe` | `0x100b9c` | s'abonner à cinq notifications |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x10169c` | lire le numéro d'une notification |
| | | `0x000C0080` | `SRV_PublishToSubscriber` | `0x109ea0` | publier `0x300`, `0x301`, `0x305` |
| `ptm:s` | `0x125c00` | `0x040A0000` | `PTMSYSM_CheckNew3DS` | `0x1015c0` | choisir le nombre de sessions |
| | | `0x04030042` | `PTMS_NotifySleepPreparationComplete` | `0x107c78` | répondre à la veille |
| `cfg:s` | `0x125ba4` | `0x04010082` | `CFG_GetConfigInfoBlk8` | `0x106088` | lire un bloc de configuration |
| | | `0x04020082` | `CFG_SetConfigInfoBlk4` | `0x116d88` | en écrire un |
| | | `0x04030000` | `CFG_UpdateConfigNANDSavegame` | `0x116dd0` | enregistrer |
| | | `0x04040042` | `CFG_GetLocalFriendCodeSeedData` | `0x116e4c` | (nom de la fiche `cfg`) |
| | | `0x04060000` | `CFG_SecureInfoGetRegion` | `0x116d4c` | lire la région |
| `cfg:nor` | `0x125ba0` | `0x00010040` | `CFGNOR_Initialize` | `0x116f58` | ouvrir la mémoire flash |
| | | `0x00050082`… | `CFGNOR_ReadData` | `0x116f94` | lire |
| | | `0x00060082`… | `CFGNOR_WriteData` | `0x116fdc` | écrire |
| | | `0x00020000` | `CFGNOR_Shutdown` | `0x117024` | refermer |
| `ps:ps` | `0x125b78` | `0x00060040`, `0x00080040` | `PS_GetRomId`, `PS_GetRomMakerCode` | `0x116cd8`, `0x116c98` | Carte ps:ps |
| `nwm::INF` | `0x125be4` | `0x00070742` | `NWMINF_ConnectToEncryptedAP` | `0x1175d0` | se connecter à un point d'accès chiffré |
| | | `0x000603C4` | `NWMINF_RecvBeaconBroadcastData` | `0x1176a4` | balayage |
| | | numéros 3, 4, 5, 9, 10, 11, 12, 14 | `NWMINF_cmd0003`, `0004`, `0005`, `0009`, `000A`, `000B`, `000C`, `000E` | `0x117644`, `0x117674`, `0x11751c`, `0x1174ec`, `0x1061e8`, `0x117598`, `0x11755c`, `0x107c28` | `?` dans 3dbrew (la 11 « rend un événement ») |

Pour `cfg:nor`, le nombre de mots de ReadData et WriteData envoyés par `ac` n'est pas relevé ; les en-têtes `…0082` sont ceux de la fiche `cfg`, avec les mêmes numéros. Deux autres fonctions d'envoi de `cfg:s` : `0x116e04`, en-tête `0x04080042` (`CFG_SecureInfoGetSerialNo`, sur [0x125ba4]), et `0x116e94`, en-tête `0x00010082` (`CFG_GetConfigInfoBlk2`, sur la copie [0x125ba8]).

## Partie 8 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x11c384` |
| ExitProcess | `0x03` | dans `0x11c2a4` | `0x11c364` |
| CreateThread | `0x08` | `svcCreateThread` | `0x11c474` |
| ExitThread | `0x09` | `svcExitThread` | `0x11c690` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x11c4f0` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x110cf0` |
| SignalEvent | `0x18` | `svcSignalEvent` | `0x110f5c` |
| ClearEvent | `0x19` | `svcClearEvent` | `0x11c450` |
| CreateMemoryBlock | `0x1E` | `svcCreateMemoryBlock` | `0x11c458` |
| UnmapMemoryBlock | `0x20` | `svcUnmapMemoryBlock` | `0x11c4f8` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x11c3a8` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x11c72c` |
| CloseHandle | `0x23` | `svcCloseHandle` | `0x110904` |
| WaitSynchronization1 | `0x24` | `svcWaitSynchronization1` | `0x10e778` |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x11c3c0` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x11d7a8` |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x11c698` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x11c3f0` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x11c4c0` |
| SendSyncRequest | `0x32` | `svcSendSyncRequest` | `0x110bd0` |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x11c4d8` |
| Break | `0x3C` | `svcBreak` | `0x11c688` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x11c36c` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x11c40c` |

Ces 24 appels sont tous dans le masque d'appels système de l'exheader (59 autorisés). Le code contient aussi des octets que le désassembleur prend pour des `svc` dans des données (`0x10b05c`, par exemple) : ils ne sont pas dans cette liste.

## Partie 9 : ce que Pokémon X envoie

Les quinze lignes de `pokemon-x-services.tsv` pour `ac:u`. La poignée du jeu est à `0x5db714`, ouverte par `ac_open_session` (`0x1dca2c`, compteur d'ouvertures), qui envoie aussitôt SetClientVersion. Les paramètres, les appelants et ce que le jeu fait des réponses sont lus dans le pseudo-code du jeu (`local/analyse/maj/gh/pseudo/`). Trois commandes (ConnectAsync, CloseAsync, RegisterDisconnectEvent) reçoivent un événement que le module doit signaler plus tard : un programme qui prend la place de la console doit donc **signaler l'événement copié** que le jeu lui passe, au bon moment ; le jeu les crée avec la fonction `0x15fc04` et le type 0.

| En-tête | Commande | Fonction du jeu | Appelants | Fonction du module | Ce qu'il faut rendre |
| --- | --- | --- | --- | --- | --- |
| `0x00400042` | SetClientVersion | `0x1dd070` | 1 : `ac_open_session` (`0x1dca2c`), avec la valeur `0x050200C8` | `acu_0040_SetClientVersion` (`0x10e990`) | résultat 0 (`0x00400040`). Le module range la version (`+0x49C`) ; au-delà de `0x03010000`, il pose aussi la valeur `0x8597` dans le champ d'erreur de la session |
| `0x00010000` | CreateDefaultConfig | `0x1dd0b0` | 1 : `0x1dcd58`, appelée par `0x40c7bc` et `0x40c9a8` | `acu_0001_CreateDefaultConfig` (`0x10fb38`) | résultat 0 et, dans le tampon de sortie de `0x200` octets (descripteur du jeu `0x00800002`), la configuration par défaut de la partie 3 ; en-tête `0x00010042` |
| `0x00270002` | GetInfraPriority | `0x1dd020` | 1 : `0x1dcd88` | `acu_0027_GetInfraPriority` (`0x10ef70`) | résultat 0 et, au mot 2, l'octet `+6` de la configuration reçue ; `0x00270080` |
| `0x002D0082` | SetRequestEulaVersion | `0x1dd13c` | 1 : `0x1dcd88`, si la priorité vaut 0, avec une version nulle | `acu_002D_SetRequestEulaVersion` (`0x10ee80`) | résultat 0 et la configuration reçue, copiée dans le tampon de sortie, avec `+0x1B` et `+0x1A` écrits ; `0x002D0042` |
| `0x00240042` | AddDenyApType | `0x1dcf10` | 1 : `0x1dcd88`, si la priorité n'est pas 0 | `acu_0024_AddDenyApType` (`0x10efd0`) | résultat 0 et la configuration copiée, `+0` privé des bits donnés ; `0x00240042` |
| `0x00040006` | ConnectAsync | `0x1dceb8` | 1 : `0x1dcd88` (la connexion, partie suivante) | `acu_0004_ConnectAsync` (`0x10f9b0`) | résultat 0 aussitôt (`0x00040040`), puis signaler l'événement ; voir la partie 4. Les mots de la requête du jeu : `0x20`, le numéro de processus, un descripteur de poignée copiée (`0`), l'événement, le tampon statique `0x00800402` de la configuration |
| `0x00050002` | GetConnectResult | `0x1dcfe4` | 1 : `0x1dd258`, après l'attente de l'événement | `acu_0005_GetConnectResult` (`0x10f9a6`) | le résultat de la connexion au mot 1 (`0x00050040`) : 0 si le jeu doit se croire en ligne, sinon un code négatif. Le module rend `0xE1209C46` tant que la connexion dure |
| `0x00080004` | CloseAsync | `0x15f30c` | 1 : `0x145a9c` | `acu_0008_CloseAsync` (`0x10f810`) | 0 (`0x00080040`), puis signaler l'événement |
| `0x00090002` | GetCloseResult | `0x15f354` | 1 : `0x145a9c` | `acu_0009_GetCloseResult` (`0x10f804`) | le résultat de la fermeture (`0x00090040`), 0 |
| `0x000A0000` | GetLastErrorCode | `0x11800c` | 1 : `0x10eaac`, appelée de 12 endroits | `acu_000A_GetLastErrorCode` (`0x10777c`) | résultat 0 et un code d'erreur au mot 2 (`0x000A0080`) : celui de la dernière erreur de la session ; 0 convient hors ligne |
| `0x000D0000` | GetWifiStatus | `0x1dd100` | 1 : `0x1dcd70`, appelée de 4 endroits | `acu_000D_GetWifiStatus` (`0x10f7c0`) | `0x000D0080` ; si le jeu doit se croire hors ligne : résultat `0xE0A09D2E` ; en ligne : résultat 0 et le type de lien (non nul) au mot 2 |
| `0x000E0042` | GetCurrentAPInfo | `0x1dd1f4` | 1 : `0x1dce70`, avec la taille `0x34` | `acu_000E_GetCurrentAPInfo` (`0x10f77c`) | hors ligne : `0xE0A09D2E` ; en ligne : 0 et une entrée de `0x34` octets dans le tampon (`0x000E0042`). Si la taille donnée est inférieure à `0x34`, le module rend `0xE0409FFF` |
| `0x001D0042` | ScanAPs | `0x1dcf70` | 1 : `0x1dcb80`, dans un état exclusif d'infrastructure | `acu_001D_ScanAPs` (`0x10f2c4`) | `0x001D0082`, résultat 0 et, au mot 2, le nombre de points d'accès (0 convient) ; le tampon de sortie reçoit autant d'entrées de `0x34` octets |
| `0x00300004` | RegisterDisconnectEvent | `0x1dd1ac` | 1 : `0x1dce50`, appelée par `0x40c7fc` et `0x40ca48` | `acu_0030_RegisterDisconnectEvent` (`0x10edc8`) | 0 (`0x00300040`) ; garder l'événement et le signaler si le lien tombe |
| `0x003E0042` | IsConnected | `0x117fc0` | 1 : `0x15f2ac`, appelée de 10 endroits | `acu_003E_IsConnected` (`0x10e9e4`) | `0x003E0080`, résultat 0 et un octet au mot 2 : 1 si connecté, 0 sinon. Le jeu l'appelle avec le paramètre 0 ; le module l'évalue sur l'objet d'état de la connexion (`0x10de9c`) |

La suite que le jeu parcourt pour se connecter (lue dans `0x1dcd88` et `0x1dd258`) : SetClientVersion à l'ouverture ; EnterExclusiveState(1) de `ndm:u` ([ndm](ndm.md)) ; GetInfraPriority ; si la réponse est 0, SetRequestEulaVersion, sinon AddDenyApType ; ConnectAsync avec un événement neuf ; attente de l'événement ; LeaveExclusiveState ; GetConnectResult. Pour se déconnecter (`0x145a9c`) : CloseAsync avec un événement neuf, attente, GetCloseResult. L'état de la connexion est interrogé ailleurs par IsConnected (10 endroits) et GetWifiStatus (4 endroits). Le jeu a donc besoin, pour fonctionner **hors ligne**, de : un résultat 0 aux réglages ; une connexion qui se termine (événement signalé) avec un résultat d'échec et sans point d'accès ; IsConnected à 0 ; GetWifiStatus et GetCurrentAPInfo en `0xE0A09D2E`. Ce que le jeu fait de l'échec d'une connexion n'a pas été lu en entier : c'est la première chose à vérifier en jouant.

Le balayage (`0x1dcb80`) est appelé depuis `0x420c18` (la fonction qui prépare une session réseau avec SuspendScheduler de `ndm:u` avant et ResumeScheduler après).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 65 numéros de commande d'`ac:u`, leur fonction et leur en-tête de réponse : le pseudo-code de Ghidra de `acu_handle_command` d'un côté ; de l'autre `emulate_dispatch.py`, qui exécute l'aiguillage pour chaque numéro. Sur les 49 commandes dont l'émulation relève l'en-tête entier, 46 se retrouvent à l'identique dans les appels de `check_header` du pseudo-code (numéro, mots ordinaires, mots de traduction) ; les 3 autres (`0x02`, `0x06`, `0x2D`) n'ont pas la même forme d'appel et n'ont pas été comparées. Aucun écart sur les 46.
- Les noms des 65 commandes d'`ac:u` et les en-têtes : 3dbrew donne un nom aux 65 numéros ; 48 des 49 en-têtes complets sont identiques à ceux de 3dbrew (l'écart est la commande `0x15`, partie « désaccords »).
- Les deux services du module : les chaînes `ac:u` et `ac:i` rangées dans la table `0x12165c`, les deux ports attendus par `server_main_loop`, et les deux aiguillages qu'atteignent les deux boucles de session (`0x1020b0` et `0x103330`, appelés l'un depuis `acu_session_loop`, l'autre depuis `aci_session_loop`). Vus dans l'assembleur et dans la table des références.
- Le schéma des fils : `svcCreateThread` n'a qu'un appelant (`create_thread_impl`), qui n'en a qu'un (`create_thread`), appelé de trois endroits ; `svcReplyAndReceive` n'est appelé que depuis les boucles de session.
- Les services appelés : les noms de l'exheader contiennent tous ceux que le code ouvre ; les six dépendances déclarées correspondent aux services `cfg`, `http`, `nwm`, `ps`, `ptm` et sockets de la liste des titres de 3dbrew.
- Les 24 appels système : relevés dans l'assembleur et tous autorisés par le masque de l'exheader.
- La configuration de `0x200` octets : les contrôles de ConnectAsync (`+0`, `+4`, `+6`, `+7`) et les octets que les réglages écrivent (`+0`, `+4`, `+5`, `+6`, `+7`) tombent sur les mêmes décalages, lus dans deux fonctions indépendantes ; et 3dbrew donne les mêmes noms aux réglages.
- La cohérence des noms avec la forme des réponses sur `ac:i` : pour celles des 162 commandes propres à `ac:i` dont la réponse est relevée, tout nom de 3dbrew qui commence par Get a une réponse qui porte une donnée (`…80`, `…42`) et tout nom qui commence par Set une réponse d'un seul mot (`…40`), sans exception.
- Ce que le jeu envoie pour `ac:u` : les 15 requêtes lues dans le jeu (mots écrits, tampons statiques, appelants) et l'aiguillage du module les accepte avec ces en-têtes (`0x00040006` : 0x20, poignée, tampon `0x00800402`, etc.).

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Les 162 commandes propres à `ac:i` : les numéros, les fonctions et les en-têtes de réponse sont relevés par l'émulation, mais le détail de chaque fonction n'a pas été lu. Les noms (106 sur 162) viennent de 3dbrew, aucune autre voie : ils sont plausibles (les Get rendent des données, les Set un résultat) mais pas confirmés.
- Le sens de l'état du lien (`0x121610`) et du type (`0x121614`) : seul le nombre de valeurs et les comparaisons sont lus.
- Le rôle des fils « moniteur de lien » (`0x100cc8`) et du sémaphore de la boucle principale.
- Le sens des notifications 0x103, 0x106, 0x302 (abonnées) et 0x300, 0x301, 0x305 (publiées) : seuls les numéros sont lus. `ndm` s'abonne à 0x300 à 0x304.
- Le sens de la valeur `0x8597` posée dans le champ d'erreur par SetClientVersion.
- Les noms des types de tâche des commandes `0x15` à `0x21` : les types sont relevés, les fonctions qui les exécutent le sont par la table de saut, leur contenu n'est pas lu en détail (sauf l'entrée de `0x34` octets de `job_scan_aps`).
- Le chemin de `0x105a74` (connexion à un point d'accès de type 3).
- Pour le stand-in : que le jeu accepte une connexion qui échoue (voir la partie 9).

**Pas lu**
- `connect_to_ap` (`0x1102bc`) et ses sous-fonctions (`0x106fa0`, `0x107190`, `0x10d574`, `0x10d338`), c'est-à-dire ce que `ac` envoie à `nwm` pour se connecter, y compris le protocole du test de connexion HTTP et de l'authentification (`http:C`, `soc:P`).
- Les commandes `0x405` (gestionnaire `0x1064c0`, non lu) et `0x406` (traitée dans l'aiguillage même) d'`ac:i` ; les autres sont retrouvées par `emu2.py` (descripteurs de tampon statique de plusieurs numéros et tailles), voir `noms-proposes.tsv`.
- Le chargement des trois réglages réseau (`load_network_settings_slots`, `0x10076c`, seulement l'ossature : trois tampons de `0xC00` octets, une somme de contrôle) et leur écriture.
- La moitié des fonctions d'envoi vers les objets (`http:C`, `soc:P`, `fs:USER`).
- Environ 1 300 fonctions sans nom, dont la bibliothèque standard C++ (les chaînes `locale`, `ios` et `bad_alloc` en sont les traces), les certificats et le code de chiffrement qui les lit.

## Désaccords avec 3dbrew et la Carte des services

- **ExclusiveAsync.** 3dbrew donne l'en-tête `0x00015004` ; le module n'accepte que `0x00150004` (numéro `0x15`, quatre mots de traduction : le processus et la poignée copiée) : c'est une coquille de 3dbrew.
- **Commande `0x043A` d'`ac:i`.** 3dbrew : `0x043A0040` (nom `?`) ; module : `0x043A0002` en entier (un tampon statique de traduction).
- **Entrées mal écrites sur 3dbrew.** Quatre entrées d'`ac:i` ont un en-tête mal recopié : `0x0459000` et `0x045A002` (7 chiffres) pour les commandes `0x0459` et `0x045A`, `0x41700000` pour `0x0417` et `0x42F00000` pour `0x042F`. Les noms sont repris pour ces quatre numéros. La commande `0x045A` du module exige l'en-tête `0x045A0002`, et `0x0458` l'en-tête `0x04580002`.
- **ac:i.** 46 commandes du module (sur 162) n'ont aucune entrée dans 3dbrew (et 10 autres y sont notées « ? ») : `0x0423`, `0x042D`, `0x0435`, `0x0437`, `0x043F` à `0x0443`, `0x0457`, `0x0458`, `0x045B` à `0x045E`, `0x0472`, `0x0474` à `0x0476`, `0x0479` à `0x048E`, `0x0496` à `0x049A`.
- **La Carte des services** (les noms de `pokemon-x-services.tsv`) donne pour `ac:u` quinze noms qui tombent sur les quinze numéros du module.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Fonctions, pseudo-code, références, tables de saut | `python outils/ghidra_direct.py ac` | 3 minutes (deux fois, avec les noms) |
| Désassemblage de chaque fonction avec les mots de la table de constantes résolus, et les constantes remises dans le pseudo-code | un script Python avec capstone | immédiat |
| Tables de commandes des deux aiguillages `0x1020b0` et `0x103330` | `python outils/emulate_dispatch.py ac 0x1020b0=ac:u 0x103330=ac:i` | quelques secondes |
| Noms des commandes d'`ac:u` et d'`ac:i` | 3dbrew, par `web.archive.org` (AC Services, NWM Services, liste des titres) | |
| Fonctions d'envoi vers les autres services | un script sur l'assembleur (arguments de `ipc_write_header`, poignée avant `svcSendSyncRequest`) joint au pseudo-code | |
| Le côté du jeu | le pseudo-code de la mise à jour (`local/analyse/maj/gh/`) | |

**Pièges rencontrés.**
- Ghidra croit que `ipc_set_header` (`0x110bd8`) ne revient jamais : il supprime le code qui suit chaque envoi (la poignée, `svcSendSyncRequest`, la lecture de la réponse). Les en-têtes et les poignées de `ac` se lisent dans l'assembleur, pas dans le pseudo-code.
- Les boucles de session sont coupées en deux fonctions par Ghidra (`0x10100c` et `0x101038`, `0x1010e8` et `0x101114`).
- L'émulateur ne retrouve pas les commandes qui reçoivent deux tampons statiques ou plus : sept dans `ac:u` (lues à la main), vingt-deux dans `ac:i` (pas lues).

**Pour reprendre.** `ac.noms.tsv` est le fichier de graines : une adresse, `function` (ARM) ou `label` (Thumb), un nom. Les noms `acu_<numéro>_<Commande>` sont les commandes reçues par `ac:u`, `aci_<numéro>_<Commande>` celles qui ne sont qu'à `ac:i` ; ceux en majuscules (`SRV_`, `PTMS_`, `CFG_`, `CFGNOR_`, `NWMINF_`, `PSPS_`) sont les requêtes que `ac` envoie à un autre service. Le pseudo-code brut, l'assembleur et les scripts sont dans `local/analyse/ac/`, non versionné.
