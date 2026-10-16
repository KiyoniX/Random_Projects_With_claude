# nwm, le pilote Wi-Fi

`nwm` est le module qui pilote la puce Wi-Fi de la console. Il offre sept services : `nwm::UDS` (la communication locale sans fil entre consoles, celle des échanges et des combats de Pokémon X), `nwm::INF` (se connecter à un point d'accès, l'internet), `nwm::SOC` (l'envoi de trames pour le module `socket`), `nwm::CEC` (StreetPass, pour `cecd`), `nwm::EXT` (allumer et éteindre le Wi-Fi, pour `ns` et `ndm`), `nwm::SAP` et `nwm::TST` (jamais appelés par un jeu). Pokémon X n'en appelle qu'un : `nwm::UDS`, avec 22 commandes.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py nwm`, le module est presque tout en Thumb), `outils/emulate_dispatch.py` sur les sept aiguillages, la page NWM_Services de 3dbrew et ses pages NWMUDS:* relues par `web.archive.org` (version de 2024, copies de `local/analyse/nwm/web/`), et le journal du banc (`local/analyse/banc-terrain*/journal.txt`) pour ce que le jeu envoie en vrai. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002D02`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `nwm`, priorité 38 (`0x26`) |
| Fichier lu | `local/extrait/nwm/exefs/code.bin` (et `code.elf`), avec `exheader.bin` |
| Taille | `0x3CB74` octets de code (`0x3D` pages), `0x169F4` de données en lecture seule (`0x17` pages, à `0x13D000`), `0xBD0` de données (1 page, à `0x154000`), `0xAF38` de mémoire à zéro, pile de `0x2000` |
| Fonctions | 2 812 pour Ghidra, dont 2 677 en Thumb et 135 en ARM ; 181 nommées dans `nwm.noms.tsv` (les aiguillages, leurs gestionnaires, une vingtaine de fonctions de travail de `nwm::UDS`), aucune étiquette de données, aucun nom sans fonction |
| Services offerts | sept, dans un tableau de pointeurs à `0x154298` (ordre : `nwm::INF`, `nwm::SOC`, `nwm::SAP`, `nwm::CEC`, `nwm::EXT`, `nwm::UDS`, `nwm::TST`), les noms à `0x13D120` ; sessions au plus, tableau à `0x13D104` : INF 2, SOC 4, SAP 2, CEC 4, EXT 6, UDS 2, TST 1 |
| Services appelés | lus dans l'exheader : `cfg:u`, `mcu::NWM`, `ps:ps`, `ptm:s` ; la chaîne `mcu::NWM` est à `0x13D4F4`. La Carte donne en plus `gpio:NWM` et `cfg:s` (3dbrew) : aucun des deux n'est dans l'exheader de ce module |
| Matériel | l'exheader demande quatre pages d'entrées-sorties : `0x1EC22000-0x1EC23FFF` et `0x1EE22000-0x1EE23FFF` (3dbrew : registres WIFI à `0x1EC22000`, PDN à `0x1EC40000`, SDIO du Wi-Fi à `0x1EE22000`), et le module utilise `BindInterrupt` (svc `0x50`), `StartInterProcessDma` (`0x55`), `StopDma` (`0x56`), `GetDmaState`... et `SetWifiEnabled` (`0x5A`) |
| Appelants connus | Pokémon X (`nwm::UDS`, partie 6), `cecd` (`nwm::CEC`), `socket` (`nwm::SOC`), `ac` (`nwm::INF`), `ns` et `ndm` (`nwm::EXT`) |

## Partie 1 : le démarrage et le serveur

`entry` (`0x100000`) puis le programme principal appelle `nwm_server_loop` (`0x1016F8`, par `0x100FE4`), une boucle de `ReplyAndReceive` (svc `0x4F`, enveloppe `0x123394`) sur au plus 7 ports d'écoute (un par service), un événement d'arrêt (rang 7) et les sessions ouvertes (rang 8 et suivants). Un port qui s'éveille donne `AcceptSession` (svc `0x4A`) si le service n'a pas atteint sa limite de sessions (tableau `0x13D104`) ; une session qui s'éveille est servie par la fonction que rend `nwm_service_handler_for_index` (`0x12334C`) pour le rang du service. Cette fonction est un `switch` d'octets (table à `0x123355`) :

| Rang | Service | Aiguillage rendu |
| --- | --- | --- |
| 0 | `nwm::INF` | `0x105B00` |
| 1 | `nwm::SOC` | `0x105E68` |
| 2 | `nwm::SAP` | `0x1051E0` |
| 3 | `nwm::CEC` | `0x1049CC` |
| 4 | `nwm::EXT` | `0x10508C` |
| 5 | `nwm::UDS` | rien (0) : traité à part |
| 6 | `nwm::TST` | `0x106158` |

`nwm::UDS` n'a pas d'aiguillage dans cette fonction : sa session est confiée à `nwm_uds_session_thread` (`0x102428`), qui lance `nwm_uds_session_loop` (`0x10759C`), une seconde boucle de `ReplyAndReceive` qui appelle `uds_handle_command` (`0x109580`) pour chaque requête. C'est cohérent avec les **deux sessions** que le jeu ouvre (deux poignées `nwm::UDS`, la seconde ne servant qu'à PullPacket, d'après `pokemon-x-services.md`) et avec la limite de 2 du tableau. Que chaque session UDS ait son propre fil est **interprété** (un seul `CreateThread` et la boucle propre à `0x10759C`).

Appels système trouvés (balayage de toutes les fonctions, `svc` ARM et Thumb) : 0x01 ControlMemory, 0x02 QueryMemory, 0x03 ExitProcess, 0x08 CreateThread, 0x09 ExitThread, 0x0A SleepThread, 0x13 CreateMutex, 0x17 CreateEvent, 0x18 SignalEvent, 0x19 ClearEvent, 0x1A (créer un temporisateur), 0x1B, 0x1C, 0x1E, 0x1F MapMemoryBlock, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x25 WaitSynchronizationN, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest, 0x35 GetProcessId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive, 0x50 BindInterrupt, 0x51 UnbindInterrupt, 0x52 InvalidateProcessDataCache, 0x53 StoreProcessDataCache, 0x55 StartInterProcessDma, 0x56 StopDma, 0x57 GetDmaState, 0x58 RestartDma, 0x5A SetWifiEnabled. Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les sept aiguillages

Chaque aiguillage lit le numéro de commande dans les 16 bits du haut de l'en-tête (`FUN_001224ca`, ici sans nom) et saute par un `switch` de `__ARM_common_switch8`. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F` ; un en-tête mal formé (mauvais nombre de mots ou de descripteurs) rend `0xD9001830`. Les sept ont été exécutés par `emulate_dispatch.py nwm 0x109580 0x105b00 0x105e68 0x1051e0 0x1049cc 0x10508c 0x106158` (de 0 à 0xFFFF, `0x10508C` de 0 à 0xFF) :

| Service | Aiguillage | Commandes | Comment il est identifié (deux voies) |
| --- | --- | --- | --- |
| `nwm::UDS` | `0x109580` | 35 (1 à 0x23) | rang 5 du tableau des noms ; les en-têtes complets de l'émulation (`0x000F0404`, `0x001B0302`, `0x001D0044`, `0x00220402`...) sont ceux de 3dbrew ; 35 commandes comme dans 3dbrew |
| `nwm::INF` | `0x105B00` | 16 (1 à 0x10) | rang 0 ; en-têtes `0x000603C4`, `0x00070742`, `0x00080302` identiques à 3dbrew |
| `nwm::SOC` | `0x105E68` | 13 (1 à 0xD) | rang 1 ; 13 commandes et `0x000D0002` comme 3dbrew |
| `nwm::SAP` | `0x1051E0` | 44 (1 à 0x2C) | rang 2 par la table d'octets ; 3dbrew n'a aucune commande pour ce service |
| `nwm::CEC` | `0x1049CC` | 30 (1 à 0x1E) | rang 3 ; en-têtes `0x00060002` et `0x000D0082` comme 3dbrew (qui n'en connaît que deux) |
| `nwm::EXT` | `0x10508C` | 9 (1 à 9) | rang 4 ; 9 commandes, `0x00050002` et `0x00080040` comme 3dbrew |
| `nwm::TST` | `0x106158` | 70 (1 à 0x46) | rang 6 par la table d'octets ; aucune commande dans 3dbrew |

SAP et TST sont attribués par leur rang dans la table d'octets, pas par une chaîne ou un appelant : **interprété**.

## Partie 3 : les commandes de `nwm::UDS`

Les noms sont ceux de la Carte (tirés de 3dbrew). Les gestionnaires sont ceux de l'émulation ; quatre commandes (0xE, 0x10, 0x17, 0x1F) sont traitées dans l'aiguillage lui-même et leur gestionnaire est lu dans le pseudo-code de `0x109580`. « Vérifié » dit si le code compare l'en-tête en entier ou seulement le numéro. Les réponses sont les en-têtes que l'aiguillage écrit (nombre de mots ordinaires, puis descripteurs).

### nwm::UDS (aiguillage 0x109580, 35 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `0x000102c2` | InitializeWithVersion | `0x10afe4` | entier | `0x00010042` |
| 0x2 | `(numéro seul)` | Scrap | `0x10b1ac` | numéro | `0x00020040` |
| 0x3 | `(numéro seul)` | Finalize | `0x109dd0` | numéro | `0x00030040` |
| 0x4 | `0x00040402` | CreateNetwork | `0x10aba0` | entier | `0x00040040` |
| 0x5 | `(numéro seul)` | EjectClient | `0x10ab60` | numéro | `0x00050040` |
| 0x6 | `(numéro seul)` | EjectSpectator | `0x10acbc` | numéro | `0x00060040` |
| 0x7 | `(numéro seul)` | UpdateNetworkAttribute | `0x10b0b0` | numéro | `0x00070040` |
| 0x8 | `(numéro seul)` | DestroyNetwork | `0x10ac8c` | numéro | `0x00080040` |
| 0x9 | `0x00090442` | ConnectNetwork | `0x10ac0c` | entier | `0x00090040` |
| 0xA | `(numéro seul)` | DisconnectNetwork | `0x10ae74` | numéro | `0x000a0040` |
| 0xB | `(numéro seul)` | GetConnectionStatus | `0x10af70` | numéro | `0x000b0340` |
| 0xC | `(numéro seul)` | (sans nom) | `0x10afa8` | numéro | `0x000c0280` |
| 0xD | `(numéro seul)` | GetNodeInformation | `0x10af00` | numéro | `0x000d02c0` |
| 0xE | `0x000e0006` | (sans nom) | `0x10b07c` | entier | `0x000e0042` |
| 0xF | `0x000f0404` | StartScan | `0x10b254` | entier | `0x000f0042` |
| 0x10 | `0x00100042` | SetApplicationData | `0x10af38` | entier | `0x00100040` |
| 0x11 | `(numéro seul)` | GetApplicationData | `0x10aec8` | numéro | `0x00110082` |
| 0x12 | `(numéro seul)` | Bind | `0x10b12c` | numéro | `0x00120042` |
| 0x13 | `(numéro seul)` | Unbind | `0x10b238` | numéro | `0x00130140` |
| 0x14 | `(numéro seul)` | PullPacket | `0x10ab20` | numéro | `0x001400c2` |
| 0x15 | `(numéro seul)` | SetMaxSendDelay | `0x10ad50` | numéro | `0x00150040` |
| 0x16 | `(numéro seul)` | (sans nom) | `0x10ae14` | numéro | `0x00160040` |
| 0x17 | `0x00170182` | SendTo | `0x10b1dc` | entier | `0x00170040` |
| 0x18 | `(numéro seul)` | (sans nom) | `0x10aea4` | numéro | `0x00180040` |
| 0x19 | `(numéro seul)` | (sans nom) | `0x10ad30` | numéro | `0x00190040` |
| 0x1A | `(numéro seul)` | GetChannel | `0x10aaf0` | numéro | `0x001a0080` |
| 0x1B | `0x001b0302` | InitializeWithVersion | `0x10afe4` | entier | `0x001b0042` |
| 0x1C | `(numéro seul)` | (sans nom) | `0x10abdc` | numéro | `0x001c0040` |
| 0x1D | `0x001d0044` | CreateNetwork2 | `0x10ac50` | entier | `0x001d0040` |
| 0x1E | `0x001e0084` | ConnectNetwork2 | `0x10acec` | entier | `0x001e0040` |
| 0x1F | `0x001f0006` | GetNodeInformationList | `0x10b0e8` | entier | `0x001f0042` |
| 0x20 | `(numéro seul)` | Flush | `0x10b16c` | numéro | `0x00200040` |
| 0x21 | `(numéro seul)` | SetProbeResponseParam | `0x10b064` | numéro | `0x00210040` |
| 0x22 | `0x00220402` | ScanOnConnection | `0x10add0` | entier | `0x00220042` |
| 0x23 | `(numéro seul)` | (sans nom) | `0x10b11c` | numéro | `0x00230080` |


**Écarts avec la Carte.** La Carte donne `0x000E0006` et `0x001F0006` comme deux noms de GetNodeInformationList ; le code montre que les deux appellent la même fonction (`uds_decrypt_beacon_data`, `0x12022C`) : elle prend le réseau annoncé et deux tampons de balises et rend **0x280 octets, seize NodeInfo de 0x28**, après un déchiffrement AES dont la clé de 16 octets est dans le module à `0x13D546` (non recopiée ici). C'est ce que d'autres documents appellent DecryptBeaconData. `Unbind` (0x13) répond avec **quatre mots** de plus que le résultat (en-tête `0x00130140`), la Carte n'en connaît pas. `Bind` (0x12) répond avec une poignée d'événement (`0x00120042`). `GetChannel` (0x1A) rend un octet. Les commandes 0x16, 0x18, 0x19, 0x1C (« unknown, not used by sub-wars ») stockent un octet, un u16 (`valeur × 1000 >> 10`, entre 0x400 et 0xC400 sinon `0xE10113FD`), un u32 (moins de `0x20000`, sinon `0xE10113FD`) dans l'objet ; 0x15 (SetMaxSendDelay) range un u64.

### Les états et les codes de résultat

L'objet global de l'UDS (rendu par `uds_get_state_object`, `0x1204D4` ; l'octet d'état, `uds_get_state`, `0x1204C0`, est à l'offset 8 de cet objet) prend ces valeurs, **lues dans le code** : 3 après Initialize ou après la fin d'un réseau (le seul état où StartScan, CreateNetwork, SetProbeResponseParam et les commandes 0x18 et 0x19 sont permis) ; 4 pendant la création du réseau ; 6 hôte ; 9 client ; 10 spectateur. Les autres états (5, 0x10, 0x11) sont ceux de la machine d'état interne partagée avec `nwm::INF` et ne sont pas lus. Ces valeurs sont aussi celles que 3dbrew donne pour le « status » de GetConnectionStatus (3, 6, 9, 10).

Un octet global (`0x1546C2`) filtre toutes les commandes sauf Bind, Unbind et GetConnectionStatus : à 1 elles répondent `0xC9411002`, à toute autre valeur non nulle `0xC8A113EA` (Scrap, la commande 2, l'écrit à 2). GetConnectionStatus, dans ce cas, rend le statut 0xB et 3 en second mot.

| Résultat | Quand | Sûr ? |
| --- | --- | --- |
| `0xC9411002` | octet global à 1 (après arrêt du Wi-Fi ?) | lu ; la cause n'est pas lue |
| `0xC8A113EA` | commande hors de son état : tout ce qui demande un réseau quand l'état n'est pas 6, 9 ou 10 (PullPacket, SendTo, GetApplicationData), quand il n'est pas 6 (EjectClient, DestroyNetwork, UpdateNetworkAttribute, SetApplicationData), quand il n'est pas 3 (StartScan, CreateNetwork, ConnectNetwork) | lu ; 3dbrew : « la commande n'est pas permise » |
| `0xE10113FD` | argument hors limites (commandes 0x16, 0x18, 0x19) | lu |
| `0xE10113E9` | taille trop grande (SendTo plus de `0x5C6`, SetApplicationData plus de `0xC8`) | lu et 3dbrew |
| `0xE10113EA` | Bind : canal nul ou pas de tampon ; PullPacket : pas de Bind valide | lu ; 3dbrew : canal de données nul |
| `0xC90113FA` | GetNodeInformation : l'identifiant n'est dans aucune des 16 cases | lu et 3dbrew |
| `0xC86113F3` | plus de mémoire ou plus de place (Initialize, Bind : 16 Bind au plus) | lu |
| `0xD900182F` / `0xD9001830` | numéro inconnu / en-tête mal formé | lu |

### Ce que contient l'objet (offsets lus dans les gestionnaires)

| Offset | Contenu |
| --- | --- |
| `+0x08` | l'état (octet) |
| `+0x20` | début de la liste des nœuds : 16 cases de `0x28` octets (NodeInfo) à `+0x4A0`, l'identifiant de nœud (u16) à `+0x20` de chaque case, 0 pour une case vide ; `+0x90` et `+0x91` : deux octets rendus par GetConnectionStatus (3dbrew : nombre de nœuds et nombre maximal) ; `+0x98` : masque des nœuds changés, remis à zéro à chaque GetConnectionStatus |
| `+0x8B0` | le NodeInfo du joueur lui-même, copié d'Initialize (0x28 octets) |
| `+0x8D0` | l'identifiant de réseau du nœud local (u16), rendu en `+8` par GetConnectionStatus |
| `+0x8D8` | la structure du réseau, **0x108 octets** (copiée de CreateNetwork ; l'attribut u16 est à `+0x16` de cette structure, en gros-boutiste, comme le dit 3dbrew) |
| `+0x9E0` | le délai fixé par la commande 0x19 (10 par défaut) |
| `+0x9EC` | un octet (second mot de GetConnectionStatus, valeurs 0, 1 ou autre d'après 3dbrew) |
| `+0xF08`, `+0xF70` | les files de trames : les 16 Bind (cases de `0x34` octets, un octet « utilisé » à `+0x30`) et les deux files d'envoi |

Les noms de champs sont ceux de 3dbrew, **interprétés** ; les offsets sont lus.

## Partie 4 : les autres services

Ces tables suivent la même forme (numéro, en-tête exigé, nom de la Carte, gestionnaire, vérification, réponse). Aucun jeu n'en envoie une seule commande, sauf par les modules `cecd`, `socket`, `ac`, `ns`, `ndm`. Les gestionnaires sont nommés dans `nwm.noms.tsv` par `<service>_cmd_<numéro>_<nom de la Carte>`. Les gestionnaires qui apparaissent dans plusieurs tables (`0x122450`, `0x122476`, `0x1223FC`, `0x12232C`...) sont des fonctions communes : par exemple `0x122450` rend l'octet d'état du service Wi-Fi interne (INF 2, SAP 2, CEC 2, EXT 1) et `0x12232C` enregistre un processus (« numéro de processus » dans l'en-tête de requête : `0x000E0002`, `0x001E0002`, `0x00050002`).

### nwm::INF (aiguillage 0x105B00, 16 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `(numéro seul)` | (sans nom) | `0x122476` | numéro | `0x00010040` |
| 0x2 | `(numéro seul)` | (sans nom) | `0x122450` | numéro | `0x00020080` |
| 0x3 | `(numéro seul)` | (sans nom) | `0x109384` | numéro | `0x00030040` |
| 0x4 | `(numéro seul)` | (sans nom) | `0x10947c` | numéro | `0x00040040` |
| 0x5 | `(numéro seul)` | (sans nom) | `0x1223fc` | numéro | `0x000500c0` |
| 0x6 | `0x000603c4` | RecvBeaconBroadcastData | `0x1220a8` | entier | `0x00060042` |
| 0x7 | `0x00070742` | ConnectToEncryptedAP | `0x109240` | entier | `0x00070040` |
| 0x8 | `0x00080302` | ConnectToAP | `0x109038` | entier | `0x00080040` |
| 0x9 | `(numéro seul)` | (sans nom) | `0x1090f4` | numéro | `0x00090040` |
| 0xA | `(numéro seul)` | (sans nom) | `0x12188c` | numéro | `0x000a0180` |
| 0xB | `(numéro seul)` | (sans nom) | `0x1217e0` | numéro | `0x000b0042` |
| 0xC | `(numéro seul)` | (sans nom) | `0x1091d8` | numéro | `0x000c0040` |
| 0xD | `(numéro seul)` | (sans nom) | `0x1091d0` | numéro | `0x000d0080` |
| 0xE | `0x000e0002` | (sans nom) | `0x12232c` | entier | `0x000e0040` |
| 0xF | `0x000f0082` | (sans nom) | `0x1092f0` | entier | `0x000f0040` |
| 0x10 | `(numéro seul)` | (sans nom) | `0x109144` | numéro | `0x00100040` |

### nwm::SOC (aiguillage 0x105E68, 13 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010042` | (sans nom) | `0x121636` | entier | `0x00010040` |
| 0x2 | `(numéro seul)` | (sans nom) | `0x12160a` | numéro | `0x00020082` |
| 0x3 | `0x00030082` | (sans nom) | `0x1078fa` | entier | `0x00030040` |
| 0x4 | `0x00040082` | (sans nom) | `0x1215fa` | entier | `0x00040080` |
| 0x5 | `(numéro seul)` | (sans nom) | `0x1215f0` | numéro | `0x00050040` |
| 0x6 | `(numéro seul)` | (sans nom) | `0x107916` | numéro | `0x00060040` |
| 0x7 | `(numéro seul)` | (sans nom) | `0x107934` | numéro | `0x00070080` |
| 0x8 | `(numéro seul)` | GetMACAddress | `0x1215dc` | numéro | `0x00080042` |
| 0x9 | `(numéro seul)` | (sans nom) | `0x107924` | numéro | `0x00090083` |
| 0xA | `(numéro seul)` | (sans nom) | `0x10797a` | numéro | `0x000a0040` |
| 0xB | `(numéro seul)` | (sans nom) | `0x10794a` | numéro | `0x000b0080` |
| 0xC | `(numéro seul)` | (sans nom) | `0x107940` | numéro | `0x000c0040` |
| 0xD | `0x000d0002` | (sans nom) | `0x12232c` | entier | `0x000d0040` |

### nwm::CEC (aiguillage 0x1049CC, 30 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `(numéro seul)` |  | `0x122476` | numéro | `0x00010040` |
| 0x2 | `(numéro seul)` |  | `0x122450` | numéro | `0x00020080` |
| 0x3 | `(numéro seul)` |  | `0x10866c` | numéro | `0x00030040` |
| 0x4 | `(numéro seul)` |  | `0x108758` | numéro | `0x00040040` |
| 0x5 | `(numéro seul)` |  | `0x1223fc` | numéro | `0x000500c0` |
| 0x6 | `0x00060002` | (sans nom) | `0x108430` | entier | `0x00060040` |
| 0x7 | `0x00070502` |  | `0x10812c` | entier | `0x00070040` |
| 0x8 | `0x00080502` |  | `0x108084` | entier | `0x00080040` |
| 0x9 | `(numéro seul)` |  | `0x107e14` | numéro | `0x00090040` |
| 0xA | `(numéro seul)` |  | `0x107f7c` | numéro | `0x000a0040` |
| 0xB | `0x000b0042` |  | `0x1083e0` | entier | `0x000b0042` |
| 0xC | `0x000c0042` |  | `0x1082d0` | entier | `0x000c0042` |
| 0xD | `0x000d0082` | SendProbeRequest | `0x1081f0` | entier | `0x000d0042` |
| 0xE | `(numéro seul)` |  | `0x108390` | numéro | `0x000e0040` |
| 0xF | `(numéro seul)` |  | `0x107fc8` | numéro | `0x000f0040` |
| 0x10 | `(numéro seul)` |  | `0x1085f8` | numéro | `0x00100040` |
| 0x11 | `(numéro seul)` |  | `0x108244` | numéro | `0x00110040` |
| 0x12 | `(numéro seul)` |  | `0x107f00` | numéro | `0x00120040` |
| 0x13 | `(numéro seul)` |  | `0x108030` | numéro | `0x00130040` |
| 0x14 | `0x00140042` |  | `0x108298` | entier | `0x00140042` |
| 0x15 | `0x00150082` |  | `0x107ea4` | entier | `0x00150042` |
| 0x16 | `0x00160042` |  | `0x1084b8` | entier | `0x00160042` |
| 0x17 | `0x00170042` |  | `0x10852c` | entier | `0x00170042` |
| 0x18 | `0x00180042` |  | `0x107e8a` | entier | `0x00180040` |
| 0x19 | `(numéro seul)` |  | `0x107e68` | numéro | `0x001900c2` |
| 0x1A | `0x001a0082` |  | `0x107f54` | entier | `0x001a0082` |
| 0x1B | `(numéro seul)` |  | `0x107f70` | numéro | `0x001b0040` |
| 0x1C | `0x001c0042` |  | `0x108320` | entier | `0x001c0042` |
| 0x1D | `(numéro seul)` |  | `0x1085a0` | numéro | `0x001d0042` |
| 0x1E | `0x001e0002` |  | `0x12232c` | entier | `0x001e0040` |

### nwm::EXT (aiguillage 0x10508C, 9 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `(numéro seul)` | (sans nom) | `0x122450` | numéro | `0x00010080` |
| 0x2 | `(numéro seul)` | (sans nom) | `0x1087a8` | numéro | `0x00020040` |
| 0x3 | `(numéro seul)` | (sans nom) | `0x108864` | numéro | `0x00030040` |
| 0x4 | `(numéro seul)` | (sans nom) | `0x108950` | numéro | `0x00040040` |
| 0x5 | `0x00050002` | (sans nom) | `0x12232c` | entier | `0x00050040` |
| 0x6 | `(numéro seul)` | (sans nom) | `0x108904` | numéro | `0x00060240` |
| 0x7 | `(numéro seul)` | (sans nom) | `0x1088c4` | numéro | `0x00070200` |
| 0x8 | `(numéro seul)` | ControlWirelessEnabled | `0x1089b4` | numéro | `0x00080040` |
| 0x9 | `(numéro seul)` | (sans nom) | `0x10895c` | numéro | `0x00090040` |

### nwm::SAP (aiguillage 0x1051E0, 44 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `(numéro seul)` |  | `0x122476` | numéro | `0x00010040` |
| 0x2 | `(numéro seul)` |  | `0x122450` | numéro | `0x00020080` |
| 0x3 | `(numéro seul)` |  | `0x12221c` | numéro | `0x00030040` |
| 0x4 | `(numéro seul)` |  | `0x1221cc` | numéro | `0x00040040` |
| 0x5 | `(numéro seul)` |  | `0x1223fc` | numéro | `0x000500c0` |
| 0x6 | `0x000603c6` |  | `0x1220a8` | entier | `0x00060042` |
| 0x7 | `0x00070082` |  | `0x121ffc` | entier | `0x00070180` |
| 0x8 | `0x00080082` |  | `0x121f80` | entier | `0x000800c0` |
| 0x9 | `0x000907c2` |  | `0x121ed0` | entier | `0x00090040` |
| 0xA | `0x000a07c2` |  | `0x121e20` | entier | `0x000a0040` |
| 0xB | `(numéro seul)` |  | `0x121d80` | numéro | `0x000b0040` |
| 0xC | `(numéro seul)` |  | `0x121cb4` | numéro | `0x000c0040` |
| 0xD | `(numéro seul)` |  | `0x121c64` | numéro | `0x000d0040` |
| 0xE | `0x000e00c2` |  | `0x121bec` | entier | `0x000e0040` |
| 0xF | `(numéro seul)` |  | `0x121b8e` | numéro | `0x000f0040` |
| 0x10 | `(numéro seul)` |  | `0x121b34` | numéro | `0x00100040` |
| 0x11 | `(numéro seul)` |  | `0x121aa8` | numéro | `0x00110040` |
| 0x12 | `(numéro seul)` |  | `0x121a4a` | numéro | `0x00120040` |
| 0x13 | `(numéro seul)` |  | `0x1219ec` | numéro | `0x00130040` |
| 0x14 | `(numéro seul)` |  | `0x12199e` | numéro | `0x00140040` |
| 0x15 | `(numéro seul)` |  | `0x108de4` | numéro | `0x00150040` |
| 0x16 | `(numéro seul)` |  | `0x108a30` | numéro | `0x00160040` |
| 0x17 | `(numéro seul)` |  | `0x121942` | numéro | `0x00170040` |
| 0x18 | `(numéro seul)` |  | `0x108ad6` | numéro | `0x00180040` |
| 0x19 | `(numéro seul)` |  | `0x108b80` | numéro | `0x00190042` |
| 0x1A | `(numéro seul)` |  | `0x108be2` | numéro | `0x001a0700` |
| 0x1B | `(numéro seul)` |  | `0x108fe4` | numéro | `0x001b0500` |
| 0x1C | `(numéro seul)` |  | `0x108d1c` | numéro | `0x001c0040` |
| 0x1D | `(numéro seul)` |  | `0x108eb0` | numéro | `0x001d0040` |
| 0x1E | `(numéro seul)` |  | `0x108b32` | numéro | `0x001e0040` |
| 0x1F | `(numéro seul)` |  | `0x12188c` | numéro | `0x001f0180` |
| 0x20 | `(numéro seul)` |  | `0x108c68` | numéro | `0x00200f80` |
| 0x21 | `(numéro seul)` |  | `0x108d7c` | numéro | `0x00210082` |
| 0x22 | `(numéro seul)` |  | `0x1217e0` | numéro | `0x00220042` |
| 0x23 | `(numéro seul)` |  | `0x108f6c` | numéro | `0x00230042` |
| 0x24 | `(numéro seul)` |  | `0x108efc` | numéro | `0x00240042` |
| 0x25 | `(numéro seul)` |  | `0x108e34` | numéro | `0x00250042` |
| 0x26 | `0x00260082` |  | `0x108aba` | entier | `0x00260040` |
| 0x27 | `(numéro seul)` |  | `0x108a8a` | numéro | `0x002700c2` |
| 0x28 | `0x00280082` |  | `-` | entier | `0x00000040` |
| 0x29 | `(numéro seul)` |  | `0x1217a8` | numéro | `0x00290040` |
| 0x2A | `0x002a0002` |  | `0x12232c` | entier | `0x002a0040` |
| 0x2B | `0x002b0384` |  | `0x1216b4` | entier | `0x002b0042` |
| 0x2C | `(numéro seul)` |  | `0x12164e` | numéro | `0x002c0040` |

### nwm::TST (aiguillage 0x106158, 70 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `(numéro seul)` |  | `0x107a2c` | numéro | `0x00010040` |
| 0x2 | `0x00020042` |  | `0x107c18` | entier | `0x00020040` |
| 0x3 | `(numéro seul)` |  | `0x107b10` | numéro | `0x00030040` |
| 0x4 | `(numéro seul)` |  | `0x122450` | numéro | `0x00040080` |
| 0x5 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00050040` |
| 0x6 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00060040` |
| 0x7 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00070040` |
| 0x8 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00080040` |
| 0x9 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00090040` |
| 0xA | `(numéro seul)` |  | `0x12324c` | numéro | `0x000a0040` |
| 0xB | `(numéro seul)` |  | `0x12324c` | numéro | `0x000b0040` |
| 0xC | `(numéro seul)` |  | `0x12324c` | numéro | `0x000c0040` |
| 0xD | `0x000d0382` |  | `0x107c7a` | entier | `0x000d0040` |
| 0xE | `(numéro seul)` |  | `0x107c6c` | numéro | `0x000e0040` |
| 0xF | `(numéro seul)` |  | `0x12188c` | numéro | `0x000f0180` |
| 0x10 | `(numéro seul)` |  | `0x1079a0` | numéro | `0x00100040` |
| 0x11 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00110040` |
| 0x12 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00120040` |
| 0x13 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00130040` |
| 0x14 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00140040` |
| 0x15 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00150040` |
| 0x16 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00160040` |
| 0x17 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00170040` |
| 0x18 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00180040` |
| 0x19 | `0x001900c2` |  | `0x1215cc` | entier | `0x00190042` |
| 0x1A | `(numéro seul)` |  | `0x1215cc` | numéro | `0x001a0040` |
| 0x1B | `(numéro seul)` |  | `0x1215cc` | numéro | `0x001b0040` |
| 0x1C | `0x001c0042` |  | `0x1215cc` | entier | `0x001c0082` |
| 0x1D | `(numéro seul)` |  | `0x1215cc` | numéro | `0x001d0040` |
| 0x1E | `0x001e0082` |  | `0x1215cc` | entier | `0x001e0042` |
| 0x1F | `(numéro seul)` |  | `0x1215cc` | numéro | `0x001f0040` |
| 0x20 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00200040` |
| 0x21 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00210040` |
| 0x22 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00220040` |
| 0x23 | `0x00230042` |  | `0x1215cc` | entier | `0x00230042` |
| 0x24 | `0x00240042` |  | `0x1215cc` | entier | `0x00240042` |
| 0x25 | `0x00250082` |  | `0x1215cc` | entier | `0x00250042` |
| 0x26 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00260040` |
| 0x27 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00270040` |
| 0x28 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00280040` |
| 0x29 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00290040` |
| 0x2A | `0x002a0042` |  | `0x1215cc` | entier | `0x002a0042` |
| 0x2B | `0x002b0042` |  | `0x121636` | entier | `0x002b0040` |
| 0x2C | `(numéro seul)` |  | `0x12160a` | numéro | `0x002c0082` |
| 0x2D | `0x002d0082` |  | `0x1215fa` | entier | `0x002d0080` |
| 0x2E | `(numéro seul)` |  | `0x1215f0` | numéro | `0x002e0040` |
| 0x2F | `0x002f0082` |  | `0x12324c` | entier | `0x002f0042` |
| 0x30 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00300080` |
| 0x31 | `0x00310082` |  | `0x121576` | entier | `0x00310042` |
| 0x32 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00320040` |
| 0x33 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00330080` |
| 0x34 | `0x00340042` |  | `0x12324c` | entier | `0x00340042` |
| 0x35 | `(numéro seul)` |  | `-` | numéro | `0x00350080` |
| 0x36 | `0x00360084` |  | `0x107b78` | entier | `0x00360044` |
| 0x37 | `0x00370002` |  | `0x12232c` | entier | `0x00370040` |
| 0x38 | `(numéro seul)` |  | `0x1215cc` | numéro | `0x00380040` |
| 0x39 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00390040` |
| 0x3A | `0x003a00c2` |  | `0x12324c` | entier | `0x003a0042` |
| 0x3B | `(numéro seul)` |  | `0x12324c` | numéro | `0x003b0040` |
| 0x3C | `(numéro seul)` |  | `0x12324c` | numéro | `0x003c0040` |
| 0x3D | `0x003d0042` |  | `0x121560` | entier | `0x003d0042` |
| 0x3E | `(numéro seul)` |  | `0x12324c` | numéro | `0x003e0040` |
| 0x3F | `(numéro seul)` |  | `0x12324c` | numéro | `0x003f0080` |
| 0x40 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00400040` |
| 0x41 | `(numéro seul)` |  | `0x1079ae` | numéro | `0x00410040` |
| 0x42 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00420080` |
| 0x43 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00430040` |
| 0x44 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00440040` |
| 0x45 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00450040` |
| 0x46 | `(numéro seul)` |  | `0x12324c` | numéro | `0x00460040` |


Contenu lu des commandes de `nwm::INF`, `nwm::EXT` : `nwm::INF` 6 (RecvBeaconBroadcastData) est la même fonction (`0x1220A8`) que StartScan de l'UDS : elle met la demande dans la machine d'état Wi-Fi (commande interne 5 si l'état est 3, 10 si l'état est 6) et attend la fin du balayage. `nwm::EXT` 8 est ControlWirelessEnabled ; 7 rend `0x1C` octets d'état (3dbrew). Le reste n'est pas lu.

## Partie 5 : une opération pas à pas, CreateNetwork2

`uds_cmd_001D_CreateNetwork2` (`0x10AC50`), appelée par `0x109580` pour l'en-tête `0x001D0044` (un mot ordinaire, deux tampons statiques : la structure du réseau, **0x108 octets**, et la phrase de passe) :

1. Le contrôle commun : octet global à 1 donne `0xC9411002`, autre valeur non nulle `0xC8A113EA`.
2. `uds_create_network_impl` (`0x10BB70`) exige l'état 3 (sinon `0xC8A113EA`), copie les `0x108` octets dans l'objet (`+0x8D8`), passe l'état à 4.
3. Elle demande à la machine d'état Wi-Fi (`0x12039C`) d'entrer en mode point d'accès ; en cas d'échec, l'état revient à 3 et l'erreur remonte.
4. Le canal : l'octet de canal de la structure (offset 6) ; s'il vaut 0 et qu'aucun canal n'est mémorisé, le module en choisit un en sondant l'air (fonction `0x121F80` : `0x110003`, `0x1FA`...). Sinon le canal donné est utilisé.
5. Elle tire l'identifiant de réseau au hasard (`+0x0C` de l'objet puis `+0x18` de la structure, comme 3dbrew) si la dernière création est plus vieille qu'un certain délai (`0x3C`), sinon le garde.
6. Elle prépare la clé CCMP à partir de la phrase de passe (`0x10E6E0`, 0x44 octets) et la liste des nœuds : le nœud 1 est l'hôte, avec le NodeInfo d'Initialize ; le nombre de nœuds vaut 1 ; le maximum vient de la structure.
7. Elle démarre l'émission des balises (`0x10EAEC`), met l'état à 6, signale l'événement d'Initialize (`0x10E2AC`) et rend 0.

La clé CCMP et le chiffrement des balises sont ceux de 3dbrew (partie « Local-WLAN ») ; leur lecture n'a pas été faite ici (voir « Pas lu »).

## Partie 6 : ce que Pokémon X envoie

Le jeu envoie **22 commandes** à `nwm::UDS` (`pokemon-x-services.tsv`), par une bibliothèque UDS qui a une fonction par commande à `0x2B1F78-0x2B25E8` (`uds_*` dans `pokemon-x.noms.tsv`). Le jeu ouvre deux sessions (poignées `0x5D42AC` pour 21 commandes et `0x5D42A8` pour PullPacket). Le journal du banc montre l'ordre au démarrage : InitializeWithVersion (une fois ; le nom du joueur est dans les mots 2 à 11 de la requête, d'après le journal), puis, en boucle, StartScan (tampon de sortie de `0x4000` octets, un événement tout neuf créé à chaque appel par la bibliothèque et fermé après), puis SetProbeResponseParam (`0x00321F00`, 0), CreateNetwork2 (un mot `0x0D`, structure de `0x108` octets, phrase de passe de 13 octets) et DestroyNetwork, et à la fin Finalize.

La fonction du jeu qui appelle CreateNetwork2 (`0x2B0678`) vérifie avant l'envoi : nombre maximal de nœuds de 2 à 16, phrase de passe d'au moins 8 octets et d'au plus 0xFF, un état propre à la bibliothèque (0, 1, 6 ou 0xB), canal 1, 6 ou 11 ou 0, puis appelle `0x10EF6C` (un test local), SetProbeResponseParam, CreateNetwork2.

| Commande du jeu | En-tête | Fonction du jeu | Gestionnaire de nwm | Ce que le remplaçant doit rendre |
| --- | --- | --- | --- | --- |
| InitializeWithVersion | `0x001B0302` | `0x2B2314` | `uds_cmd_0001_InitializeWithVersion_shared` `0x10AFE4` (`uds_initialize_impl` `0x10CA18`) | résultat 0 et, **en troisième mot (après un descripteur `0x00000000`), une vraie poignée d'événement** : l'en-tête de réponse est `0x001B0042` (un mot ordinaire, deux de descripteur). Le banc rend aujourd'hui `0x001B0140` et une poignée 0 : le jeu n'a aucun événement à attendre. L'état devient 3. Conserver le NodeInfo reçu (0x28 octets) ; accepter le tampon partagé (poignée en dernier mot) sans le lire ; version au plus `0x400` |
| Finalize | `0x00030000` | `0x2B25C0` | `uds_cmd_0003_Finalize` `0x109DD0` | 0 ; défait tout, ferme l'événement. Après lui, Initialize est de nouveau permis |
| SetProbeResponseParam | `0x00210080` | `0x2B2388` | `uds_cmd_0021_SetProbeResponseParam` `0x10B064` (`0x10C724`) | 0 si l'état est 3 (sinon `0xC8A113EA`) ; range l'OUI et l'octet. Peut rester sans effet |
| CreateNetwork2 | `0x001D0044` | `0x2B2050` | `uds_cmd_001D_CreateNetwork2` `0x10AC50` | 0 ; l'état passe à 6, le nœud 1 est l'hôte (1 nœud sur le maximum de la structure), **l'événement d'Initialize est signalé** |
| DestroyNetwork | `0x00080000` | `0x2B20A4` | `uds_cmd_0008_DestroyNetwork` `0x10AC8C` | 0 si l'état est 6 ; l'état revient à 3 (le module attend jusqu'à dix fois qu'il le soit) ; l'événement n'est pas signalé (3dbrew). `0xC8A113EA` si l'état n'est pas 6 |
| StartScan | `0x000F0404` | `0x2B25E8` | `uds_cmd_000F_StartScan` `0x10B254` | seulement si l'état est 3. **Écrire dans le tampon de sortie l'en-tête vide** : taille maximale (mot 0), `0x0C` (mot 1), 0 entrée (mot 2). Le vrai module bloque jusqu'à la fin du balayage (la même file interne que `nwm::INF` 6) ; un remplaçant doit aussi bloquer un temps (de l'ordre d'une fraction de seconde), sinon le jeu boucle à toute vitesse (82 appels en 35 s de banc). Le filtre est : balise Nintendo `00:1F:32`, type `0x15`, wlancommID (4 octets) et id8 |
| GetConnectionStatus | `0x000B0000` | `0x2B22C4` | `uds_cmd_000B_GetConnectionStatus` `0x10AF70` (`0x10C694`) | une structure de `0x30` octets (réponse `0x000B0340`) : statut (3 juste après Initialize, tout le reste à 0 ; 6 hôte ; 9 client ; 10 spectateur), le masque des nœuds changés, les 16 identifiants de nœud, le nombre de nœuds et le maximum, et le masque des nœuds présents |
| GetNodeInformation | `0x000D0040` | `0x2B2230` | `uds_cmd_000D_GetNodeInformation` `0x10AF00` | le NodeInfo de `0x28` octets du nœud demandé ; `0xC90113FA` s'il n'existe pas |
| GetNodeInformationList | `0x001F0006` | `0x2B2410` | `0x10B0E8` (`uds_decrypt_beacon_data` `0x12022C`) | 0x280 octets : 16 NodeInfo de la balise. Jamais appelée tant que StartScan ne rend aucune entrée |
| GetApplicationData | `0x00110040` | `0x2B21D0` | `uds_cmd_0011_GetApplicationData` `0x10AEC8` (`0x10C898`) | la taille réelle (jusqu'à `0x300`) et les données de la balise ; 0 octet si l'état n'est pas 6, 9 ou 10 |
| SetApplicationData | `0x00100042` | `0x2B2280` | `uds_cmd_0010_SetApplicationData` `0x10AF38` (`0x10C7F4`) | 0 (hôte seulement) ; plus de `0xC8` octets donne `0xE10113E9` |
| UpdateNetworkAttribute | `0x00070080` | `0x2B23D0` | `uds_cmd_0007_UpdateNetworkAttribute` `0x10B0B0` (`0x10E768`) | 0 ; range (flag non nul) ou efface (flag nul) le masque dans l'attribut u16 de la structure ; le bit `0x4` est effacé s'il n'est pas dans le masque |
| EjectClient | `0x00050040` | `0x2B2018` | `uds_cmd_0005_EjectClient` `0x10AB60` (`0x10F718`) | 0 si l'état est 6 ; `0xFFFF` éjecte tous les clients |
| DisconnectNetwork | `0x000A0000` | `0x2B21A8` | `uds_cmd_000A_DisconnectNetwork` `0x10AE74` (`0x10C634`) | 0 ; l'état revient à 3 (dix essais au plus) ; pas d'événement |
| Bind | `0x00120100` | `0x2B24B8` | `uds_cmd_0012_Bind` `0x10B12C` (`0x10C934`) | une poignée d'événement (réponse `0x00120042`), signalée à chaque trame reçue du canal ; échec `0xE10113EA` si le canal est 0 ou le tampon nul ; 16 Bind au plus |
| Unbind | `0x00130040` | `0x2B2578` | `uds_cmd_0013_Unbind` `0x10B238` (`0x10CCF4`) | 0 et quatre mots à zéro (réponse `0x00130140`) |
| PullPacket | `0x001400C0` | `0x2B1FAC` | `uds_cmd_0014_PullPacket` `0x10AB20` (`0x10C8E8`) | la taille de la trame, le nœud source (u16) et les données ; l'état doit être 6, 9 ou 10 (sinon `0xC8A113EA`) ; `0xE10113E9` si le tampon est plus petit que la trame |
| SendTo | `0x00170182` | `0x2B2504` | `uds_cmd_0017_SendTo` `0x10B1DC` (`uds_send_frame` `0x1200B0`) | 0 ; taille au plus `0x5C6` ; destinataire `0xFFFF` pour tous ; l'état 6 ou 9 |
| GetChannel | `0x001A0000` | `0x2B1F78` | `uds_cmd_001A_GetChannel` `0x10AAF0` (`0x10BB30`) | un octet : le canal du réseau (0 hors réseau) |
| ConnectNetwork2 | `0x001E0084` | `0x2B20CC` | `uds_cmd_001E_ConnectNetwork2` `0x10ACEC` (`uds_connect_network_impl` `0x10BFA8`) | 0 si l'état est 3 et que le réseau existe ; l'état passe à 9 (client) ou 10 (spectateur, mot 1 = 2) ; événement signalé |
| ScanOnConnection | `0x00220402` | `0x2B2130` | `uds_cmd_0022_ScanOnConnection` `0x10ADD0` (`0x10C3A8`) | seulement client ou spectateur (état 9 ou 10) ; sinon `0xC8A113EA` ; écrit le même tampon que StartScan |
| Inconnue | `0x00230000` | `0x2B2484` | `uds_cmd_0023` `0x10B11C` | un u16 en deuxième mot de réponse (réponse `0x00230080`) : 0 convient |

Le jeu n'envoie ni EjectSpectator, ni Scrap, ni les commandes 0x15 à 0x1C, ni Flush, ni les deux anciennes (Initialize `0x000102C2`, CreateNetwork `0x00040402`, ConnectNetwork `0x00090442`).

**La réponse minimale qui ne bloque pas le jeu, avec zéro voisin** (interprétée à partir du code de nwm, pas encore éprouvée au banc) : (1) Initialize rend une vraie poignée d'événement ; (2) GetConnectionStatus rend le statut 3 avant tout réseau ; (3) StartScan écrit `{max, 0x0C, 0}` dans son tampon et ne rend qu'après un court délai ; (4) CreateNetwork2 rend 0, passe l'état à 6 et signale l'événement ; (5) GetConnectionStatus rend alors le statut 6 avec le nœud 1 ; (6) DestroyNetwork rend 0 et revient à 3. Les réponses actuelles du banc (zéro partout, poignée 0) ne satisfont ni (1) ni (2) ni (4).

## Partie 7 : rendre `nwm::UDS` vrai sur le réseau du PC

Une émulation doit tenir **un seul objet réseau global** (comme nwm) avec : l'état (3, 4, 6, 9, 10), la structure du réseau (0x108 octets), les 16 cases de NodeInfo, les 16 Bind (canal de données, identifiant de nœud, file de trames reçues, événement), l'événement d'état et le NodeInfo local.

- **Réseau.** Les trames 802.11 n'existent pas sur un PC. Une voie simple : une diffusion UDP sur le réseau local (ou un groupe multicast) qui transporte, au choix du remplaçant, des **balises** (périodiques, à la place des balises Wi-Fi), des **demandes de connexion** (à la place de l'authentification et de l'association), des **trames de données** et des **trames de service**.
- **Hôte** (CreateNetwork2) : envoyer à intervalle régulier une balise portant la structure du réseau (wlancommID, id8, identifiant de réseau tiré au hasard, nombre de nœuds et maximum, données d'application, attributs), la liste des nœuds et les données d'application. Répondre aux demandes de connexion : attribuer l'identifiant de nœud le plus bas libre (2 pour le premier client, l'hôte est 1), mettre à jour la liste, **rediffuser la liste sur le canal de données 0x101** et signaler l'événement d'état. Refuser (`0xC92113FB` côté client) si l'attribut `0x2` (clients) ou `0x1` (spectateurs) l'interdit, ou s'il n'y a plus de place (16 nœuds au plus).
- **Balayage** (StartScan, ScanOnConnection) : écouter les balises un court instant, filtrées par wlancommID (4 octets) et id8, puis rendre la `BeaconDataReply` de 3dbrew (`max`, taille écrite, nombre d'entrées, puis pour chaque balise : taille, canal, adresse MAC de l'hôte, taille de l'entête `0x1C` et la balise). La balise doit contenir les étiquettes de 3dbrew (type `0x14`, `0x15` avec la structure du réseau et la somme SHA-1, `0x18` et `0x19` avec la liste des nœuds) puisque le jeu les analyse lui-même. Comme c'est `GetNodeInformationList` qui déchiffre la liste des nœuds, le remplaçant peut les écrire en clair dans son propre format, tant que les deux commandes s'accordent ; il n'a pas besoin de la clé AES du module.
- **Connexion** (ConnectNetwork2) : envoyer la demande au MAC de l'hôte choisi, attendre l'attribution d'un identifiant, passer à l'état 9 (ou 10 pour un spectateur, qui ne reçoit que les diffusions). Le jeu transmet la structure du réseau d'une balise vue, la phrase de passe (au moins 8 octets) et le type (1 client, 2 spectateur).
- **Données** : SendTo envoie une trame (canal de données, nœud de destination, `0xFFFF` pour tous, au plus `0x5C6` octets) ; l'hôte relaie vers le destinataire ou diffuse (3dbrew : les clients émettent toujours vers l'hôte). PullPacket rend une trame par appel, avec le nœud source ; chaque trame reçue **signale l'événement du Bind** du canal. L'en-tête de 14 octets (taille, canal, séquence, destination, source, en gros-boutiste) est celui de 3dbrew ; sur le PC il n'a pas à ressembler à la réalité, mais le jeu ne le voit pas.
- **Événements** : celui d'Initialize est signalé à la création et à la connexion du réseau, quand un nœud arrive ou part (le masque des nœuds changés de GetConnectionStatus dit lesquels) ; **pas** à DestroyNetwork ni à DisconnectNetwork. Un Bind est signalé par chaque trame reçue.
- **Temps** : les opérations réelles prennent du temps (balayage : bloquant ; destruction : jusqu'à dix attentes) ; un remplaçant instantané peut faire boucler le jeu.
- **Ce qui peut rester factice** : tous les services autres que l'UDS, SetProbeResponseParam, les commandes inconnues, la clé et la phrase de passe réelles (à condition que les deux consoles du PC s'accordent), le canal Wi-Fi (renvoyer 1, 6 ou 11 : le jeu n'accepte que ces valeurs ou 0), la qualité du signal.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies) : les sept aiguillages et leurs 35, 16, 13, 44, 30, 9 et 70 commandes (émulation et pseudo-code de Ghidra ; pour l'UDS, aussi 3dbrew avec les mêmes en-têtes) ; les noms de service, les limites de sessions (2 pour l'UDS, qui est aussi le nombre de poignées du jeu) ; les valeurs d'état 3, 6, 9, 10 (code et 3dbrew) ; la taille 0x108 de la structure du réseau, 0x28 du NodeInfo, 16 nœuds, 16 Bind ; les codes de résultat listés ; la correspondance des gestionnaires aux 22 commandes du jeu (adresses de `pokemon-x-services.tsv`).

**Interprété** : le rang SAP et TST ; le fil propre à chaque session UDS ; les noms des champs de l'objet (de 3dbrew) ; les réponses minimales de la partie 6 et tout ce qui est dit du bouclage du jeu ; la nature de l'octet global `0x1546C2`.

**Pas lu** : le chiffrement des balises et la dérivation de la clé CCMP ; la machine d'état Wi-Fi interne (`0x12039C`, `0x1211F8`, états 5, 0x10, 0x11) et le pilote du matériel (SDIO, interruptions, DMA) ; la création de chaque événement (type de réinitialisation de celui d'Initialize) ; les corps de `nwm::INF`, `nwm::SOC`, `nwm::SAP`, `nwm::CEC`, `nwm::EXT` et `nwm::TST` (seules les tables sont établies) ; la durée réelle d'un balayage ; ce que le jeu fait des réponses au-delà de ses fonctions d'enveloppe (la boucle StartScan / CreateNetwork / DestroyNetwork vient de la bibliothèque UDS du jeu, que je n'ai lue que jusqu'à `0x2B0678`).
