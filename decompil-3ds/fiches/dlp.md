# dlp, le Téléchargement Jeu (Download Play)

`dlp` est le module du Téléchargement Jeu : une console « serveur » qui possède un jeu l'envoie par le réseau sans fil local à des consoles « clientes » qui n'ont pas la cartouche. Il fait le travail de bas niveau : annoncer le jeu, accepter des clients, découvrir les serveurs voisins, envoyer ou recevoir le jeu (un fichier CIA, installé par `am`), puis relancer la console sur le jeu reçu. Le sans-fil lui-même passe par `nwm::UDS` (communication locale). Trois services : `dlp:SRVR` (le serveur), `dlp:CLNT` (le client) et `dlp:FKCL` (un faux client, d'après son nom : une session factice qui ne fait que la découverte).

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, module presque tout en Thumb), `outils/emulate_dispatch.py` sur les trois aiguillages (de 0 à 0xFFFF) et la Carte des services (tirée de 3dbrew). Adresses du module chargé à `0x00100000`. Le module contient une phrase de passe réseau (17 caractères, répétée à `0x112000`, `0x112018` et `0x1120D8`) : elle n'est pas recopiée ici.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002802`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `dlp`, priorité 56 (`0x38`) |
| Fichier lu | `local/extrait/dlp/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x11D1C` octets de code (`0x12` pages), `0xA30` de données en lecture seule (1 page), `0x1848` de données (2 pages), `0x9538` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 1 107 pour Ghidra, dont 1 033 en Thumb et 74 en ARM ; 54 nommées dans `dlp.noms.tsv`, aucun nom sans fonction |
| Services offerts | `dlp:CLNT`, `dlp:SRVR` et `dlp:FKCL`, **1 session chacun** (table des noms à `0x114594`, noms à `0x1127D8`, `0x1127E1`, `0x1127EA`) |
| Services appelés | lus dans l'exheader : `fs:USER`, `am:u`, `cfg:u`, `nwm::UDS`, `ps:ps`, `ptm:s`. Dans le code, des chaînes pour `ps:ps` (`0x11202A`), `nwm::UDS` (`0x1121CE`, précédé d'un `2`), `am:net` (`0x112169`, dans la liste de la bibliothèque : le droit déclaré est `am:u`), `fs:USER` (`0x112187`) ; `cfg:u` et `ptm:s` sont dans les listes de noms (`0x112820`, `0x112802`) |
| Appelants connus | `dlp:SRVR` et `dlp:FKCL` : l'application `maj` (exheader) ; `dlp:CLNT` : aucun exheader extrait ne le déclare. Pokémon X n'ouvre aucun des trois (`pokemon-x-services.md`) |
| Chemin d'un CIA | le format `%s:/%016llx.cia` est à `0x112060` (archive, identifiant de titre sur 16 chiffres hexadécimaux) : le jeu reçu est rangé en fichier CIA avant l'installation par `am:u` |

## Partie 1 : le démarrage et le serveur

`dlp_main` (`0x100168`) est court : après trois préparations (`0x10AC6C`, `0x10051C`, `0x1005E0`, non relues) il enregistre les trois services auprès de `sm` (`0x1006AC`, en-tête de commande 3, avec le nombre de sessions 1) d'après la table `0x114594` (CLNT, SRVR, FKCL) et rend la main : le service tourne dans des fils. Puis :

1. **Le fil d'acceptation** (`dlp_accept_thread`, `0x1001F8`) attend (`0x10AB66`, attente multiple) sur quatre poignées : les trois ports et une notification de `sm`. Un port actif : `AcceptSession` (`svc_accept_session`, `0x110FFC`), puis **un fil par session** (`0x10AB0C`, entrée prise dans un objet par service).
2. **La session** est servie par une fonction d'ouverture propre au service (`0x10F37C` pour CLNT, `0x10F444` pour SRVR, `0x10F4A0` pour FKCL) qui construit l'objet du service (par exemple un bloc de `0x2680` octets pour le client) puis lance la boucle de service : `ReplyAndReceive` (`svc_reply_and_receive`, `0x107D98`) et l'aiguillage du service.
3. À l'arrêt, ferme les sessions et les services.

| Service | Ouverture de session | Boucle de service | Aiguillage | Commandes (émulées) |
| --- | --- | --- | --- | --- |
| `dlp:CLNT` | `0x10F37C` | `0x10B0C4` | `dlp_clnt_dispatch_command` `0x10B8E0` | 20 |
| `dlp:SRVR` | `0x10F444` | `0x10B138` | `dlp_srvr_dispatch_command` `0x10BC6C` | 16 |
| `dlp:FKCL` | `0x10F4A0` | `0x10B480` | `dlp_fkcl_dispatch_command` `0x10C058` | 17 |

Le rapprochement service - aiguillage est lu dans le pseudo-code (chaque fonction d'ouverture appelle sa boucle, chaque boucle appelle son aiguillage), confirmé par le nombre de commandes de la Carte (20, 16, 17).

Appels système trouvés : 0x14 ReleaseMutex, 0x17 CreateEvent, 0x18 SignalEvent, 0x1A CreateTimer, 0x1B SetTimer, 0x1C CancelTimer, 0x1E CreateMemoryBlock, 0x1F MapMemoryBlock, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x25 WaitSynchronizationN, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x29 GetHandleInfo, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest (`0x10A960`), 0x35 GetProcessId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive. Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les trois aiguillages

Chaque aiguillage lit le numéro de commande dans les 16 bits du haut de l'en-tête (`bitfield_extract`, `0x103858`), saute à un cas par un `switch` (Ghidra ne le reconstruit pas : `emulate_dispatch.py` l'exécute) et vérifie l'en-tête et les descripteurs. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F`.

`emulate_dispatch.py dlp 0x10b8e0=dlp:CLNT 0x10bc6c=dlp:SRVR 0x10c058=dlp:FKCL` : 20, 16 et 17 commandes, numéros 1 à 0x14, 1 à 0x10, 1 à 0x11, **exactement celles de la Carte**, avec les mêmes en-têtes pour toutes les commandes dont le code vérifie l'en-tête en entier. Deux pièges de l'émulation : `bitfield_extract` n'est appelée que de deux endroits du module, et l'outil l'a prise pour une fonction de travail (zéro commande trouvée) ; il a fallu la déclarer aide (`--helper 0x103858`). Et les trois « Initialize » (et `InitializeWithName`, et le `0x11` du faux client) ont été refusés par l'émulation, qui ne sait pas fabriquer leurs descripteurs : leur gestionnaire est lu dans le pseudo-code.

**Les gestionnaires sont partagés entre les services**, par exemple `GetEventDesc` (`0x107D20`) sert `CLNT` 3, `SRVR` 4 et `FKCL` 3 : c'est le même objet d'état réseau (`StartScan`, `GetServerInfo`, `GetTitleInfo`, `GetMyStatus`, `GetNodeInfo`... sont communs au client et au faux client). La fonction porte le nom du premier service où elle est apparue.

## Partie 3 : les commandes

Les noms et les en-têtes de requête sont ceux de la Carte (3dbrew). « Source » dit d'où vient l'adresse du gestionnaire. « Vérifié » : l'aiguillage compare l'en-tête en entier ou le numéro seulement.

### `dlp:CLNT` (aiguillage `dlp_clnt_dispatch_command` à `0x10b8e0`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x000100C3` | Initialize | `dlp_clnt_cmd_0001_Initialize` | `0x104774` | pseudo-code | entier | non émulée |
| 0x2 | `0x00020000` | Finalize | `dlp_clnt_cmd_0002_Finalize` | `0x107D2C` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030000` | GetEventDesc | `dlp_cmd_0003_GetEventDesc` | `0x107D20` | émulation | numéro | `0x00030200` |
| 0x4 | `0x00040000` | GetChannel | `dlp_cmd_0004_GetChannel` | `0x107D14` | émulation | numéro | `0x00040080` |
| 0x5 | `0x00050180` | StartScan | `dlp_cmd_0005_StartScan` | `0x107C9C` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | StopScan | `dlp_cmd_0006_StopScan` | `0x107EB8` | émulation | numéro | `0x00060040` |
| 0x7 | `0x00070080` | GetServerInfo | `dlp_cmd_0007_GetServerInfo` | `0x107C1C` | émulation | numéro | `0x00070042` |
| 0x8 | `0x00080100` | GetTitleInfo | `dlp_cmd_0008_GetTitleInfo` | `0x107B98` | émulation | numéro | `0x00080042` |
| 0x9 | `0x00090040` | GetTitleInfoInOrder | `dlp_cmd_0009_GetTitleInfoInOrder` | `0x107B28` | émulation | numéro | `0x00090042` |
| 0xA | `0x000A0080` | DeleteScanInfo | `dlp_cmd_000A_DeleteScanInfo` | `0x107AE4` | émulation | numéro | `0x000A0040` |
| 0xB | `0x000B0100` | PrepareForSystemDownload | `dlp_clnt_cmd_000B_PrepareForSystemDownload` | `0x104B90` | émulation | numéro | `0x000B0080` |
| 0xC | `0x000C0000` | StartSystemDownload | `dlp_clnt_cmd_000C_StartSystemDownload` | `0x104A58` | émulation | numéro | `0x000C0040` |
| 0xD | `0x000D0100` | StartTitleDownload | `dlp_clnt_cmd_000D_StartTitleDownload` | `0x1048E0` | émulation | numéro | `0x000D0040` |
| 0xE | `0x000E0000` | GetMyStatus | `dlp_cmd_000E_GetMyStatus` | `0x107A70` | émulation | numéro | `0x000E0180` |
| 0xF | `0x000F0040` | GetConnectingNodes | `dlp_cmd_000F_GetConnectingNodes` | `0x107A04` | émulation | numéro | `0x000F0082` |
| 0x10 | `0x00100040` | GetNodeInfo | `dlp_cmd_0010_GetNodeInfo` | `0x107988` | émulation | numéro | `0x001002C0` |
| 0x11 | `0x00110000` | GetWirelessRebootPassphrase | `dlp_cmd_0011_GetWirelessRebootPassphrase` | `0x10793C` | émulation | numéro | `0x00110100` |
| 0x12 | `0x00120000` | StopSession | `dlp_cmd_0012_StopSession` | `0x107F18` | émulation | numéro | `0x00120040` |
| 0x13 | `0x00130100` | GetCupVersion | `dlp_clnt_cmd_0013_GetCupVersion` | `0x106D54` | émulation | numéro | `0x001300C0` |
| 0x14 | `0x00140100` | GetDupAvailability | `dlp_clnt_cmd_0014_GetDupAvailability` | `0x10485C` | émulation | numéro | `0x00140080` |

### `dlp:SRVR` (aiguillage `dlp_srvr_dispatch_command` à `0x10bc6c`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010183` | Initialize | `dlp_srvr_cmd_0001_Initialize` | `0x104F5C` | pseudo-code | entier | non émulée |
| 0x2 | `0x00020000` | Finalize | `dlp_srvr_cmd_0002_Finalize` | `0x105FA4` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030000` | GetServerState | `dlp_srvr_cmd_0003_GetServerState` | `0x106058` | émulation | numéro | `0x00030080` |
| 0x4 | `0x00040000` | GetEventDescription | `dlp_cmd_0003_GetEventDesc` | `0x107D20` | émulation | numéro | `0x00040200` |
| 0x5 | `0x00050080` | StartAccepting | `dlp_srvr_cmd_0005_StartAccepting` | `0x104D9C` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | EndAccepting | `dlp_srvr_cmd_0006_EndAccepting` | `0x104EEC` | émulation | numéro | `0x00060040` |
| 0x7 | `0x00070000` | StartDistribution | `dlp_srvr_cmd_0007_StartDistribution` | `0x105308` | émulation | numéro | `0x00070040` |
| 0x8 | `0x000800C0` | SendWirelessRebootPassphrase | `dlp_srvr_cmd_0008_SendWirelessRebootPassphrase` | `0x1054A4` | émulation | numéro | `0x00080040` |
| 0x9 | `0x00090040` | AcceptClient | `dlp_srvr_cmd_0009_AcceptClient` | `0x104D34` | émulation | numéro | `0x00090040` |
| 0xA | `0x000A0040` | DisconnectClient | `dlp_srvr_cmd_000A_DisconnectClient` | `0x1053E8` | émulation | numéro | `0x000A0040` |
| 0xB | `0x000B0042` | GetConnectingClients | `dlp_srvr_cmd_000B_GetConnectingClients` | `0x105700` | émulation | entier | `0x000B0082` |
| 0xC | `0x000C0040` | GetClientInfo | `dlp_srvr_cmd_000C_GetClientInfo` | `0x104EF8` | émulation | numéro | `0x000C02C0` |
| 0xD | `0x000D0040` | GetClientState | `dlp_srvr_cmd_000D_GetClientState` | `0x10528C` | émulation | numéro | `0x000D0180` |
| 0xE | `0x000E0040` | IsChild | `dlp_srvr_cmd_000E_IsChild` | `0x105D18` | émulation | numéro | `0x000E0080` |
| 0xF | `0x000F0303` | InitializeWithName | `dlp_srvr_cmd_0001_Initialize` | `0x104F5C` | pseudo-code | entier | non émulée |
| 0x10 | `0x00100000` | GetDupNoticeNeed | `dlp_srvr_cmd_0010_GetDupNoticeNeed` | `0x105454` | émulation | numéro | `0x00100080` |

### `dlp:FKCL` (aiguillage `dlp_fkcl_dispatch_command` à `0x10c058`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010083` | Initialize | `dlp_fkcl_cmd_0001_Initialize` | `0x1078AC` | pseudo-code | entier | non émulée |
| 0x2 | `0x00020000` | Finalize | `dlp_fkcl_cmd_0002_Finalize` | `0x108DC0` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030000` | GetEventDesc | `dlp_cmd_0003_GetEventDesc` | `0x107D20` | émulation | numéro | `0x00030200` |
| 0x4 | `0x00040000` | GetChannels | `dlp_cmd_0004_GetChannel` | `0x107D14` | émulation | numéro | `0x00040080` |
| 0x5 | `0x00050180` | StartScan | `dlp_cmd_0005_StartScan` | `0x107C9C` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | StopScan | `dlp_cmd_0006_StopScan` | `0x107EB8` | émulation | numéro | `0x00060040` |
| 0x7 | `0x00070080` | GetServerInfo | `dlp_cmd_0007_GetServerInfo` | `0x107C1C` | émulation | numéro | `0x00070042` |
| 0x8 | `0x00080100` | GetTitleInfo | `dlp_cmd_0008_GetTitleInfo` | `0x107B98` | émulation | numéro | `0x00080042` |
| 0x9 | `0x00090040` | GetTitleInfoInOrder | `dlp_cmd_0009_GetTitleInfoInOrder` | `0x107B28` | émulation | numéro | `0x00090042` |
| 0xA | `0x000A0080` | DeleteScanInfo | `dlp_cmd_000A_DeleteScanInfo` | `0x107AE4` | émulation | numéro | `0x000A0040` |
| 0xB | `0x000B0100` | StartFakeSession | `dlp_fkcl_cmd_000B_StartFakeSession` | `0x10AD94` | émulation | numéro | `0x000B0040` |
| 0xC | `0x000C0000` | GetMyStatus | `dlp_cmd_000E_GetMyStatus` | `0x107A70` | émulation | numéro | `0x000C0180` |
| 0xD | `0x000D0040` | GetConnectingNodes | `dlp_cmd_000F_GetConnectingNodes` | `0x107A04` | émulation | numéro | `0x000D0082` |
| 0xE | `0x000E0040` | GetNodeInfo | `dlp_cmd_0010_GetNodeInfo` | `0x107988` | émulation | numéro | `0x000E02C0` |
| 0xF | `0x000F0000` | GetWirelessRebootPassphrase | `dlp_cmd_0011_GetWirelessRebootPassphrase` | `0x10793C` | émulation | numéro | `0x000F0100` |
| 0x10 | `0x00100000` | Inconnue | `dlp_cmd_0012_StopSession` | `0x107F18` | émulation | numéro | `0x00100040` |
| 0x11 | `0x00110203` | Inconnue | `dlp_fkcl_cmd_0001_Initialize` | `0x1078AC` | pseudo-code | entier | non émulée |


Notes :

- Les cinq commandes lues dans le pseudo-code : `CLNT` 1 (`0x104774`), `FKCL` 1 et `0x11` (la même fonction `0x1078AC`) et `SRVR` 1 et `0xF` (la même fonction `0x104F5C`). Pour le serveur, les deux cas du pseudo-code appellent `0x104F5C` ; `InitializeWithName` se distingue par son en-tête (`0x000F0303` contre `0x00010183`).
- `GetWirelessRebootPassphrase` (client `0x11`, faux client `0xF`) et `SendWirelessRebootPassphrase` (serveur `0x8`) échangent la phrase de passe du réseau de redémarrage sans fil : la commande rend trois mots dans sa réponse (`0x00110100` : le résultat et trois mots). Sa valeur est produite à l'exécution et n'est pas dans le module.
- `GetCupVersion` (`0x13`) et `GetDupAvailability` (`0x14`) sont des commandes du client seul.

## Partie 4 : une opération pas à pas, StartScan

Le client commence à chercher des serveurs (`dlp:CLNT`, commande 5, `0x00050180` : six mots ordinaires dont un masque de canaux et une adresse MAC de 6 octets). Lu dans `dlp_clnt_cmd_0005_StartScan` (`0x107C9C`).

1. `dlp_clnt_dispatch_command` (`0x10B8E0`) lit le numéro 5, vérifie le numéro (pas l'en-tête en entier) et appelle le gestionnaire avec l'objet client.
2. Le gestionnaire prend le verrou de l'objet (`0x10A9B8`, relâché à la fin par `0x10A9AA`).
3. Il lit l'octet d'état à `+0x1FF8` de l'objet : la scrutation n'est permise que s'il vaut 1 (« initialisé »). Il teste aussi le masque de canaux contre une constante (interprété : un bit hors des canaux permis fait refuser).
4. S'il est bon, il copie l'adresse MAC filtre (6 octets, `0x108B8C`), appelle la fonction qui lance la scrutation (`0x10CC6C`, avec le masque), passe l'état à 2 (« en scrutation ») et rend 0.
5. Sinon il rend un code d'erreur (constantes `DAT_00107D08`/`DAT_00107D10`, un pour « mauvais état » et un pour « canal interdit » ; leurs valeurs ne sont pas relevées).
6. L'aiguillage répond `0x00050040`.

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x114594` | table des noms de services : `dlp:CLNT` (`0x1127EA`), `dlp:SRVR` (`0x1127E1`), `dlp:FKCL` (`0x1127D8`) |
| `0x1145A0` | les trois fonctions d'ouverture de session : `0x10F37D`, `0x10F445`, `0x10F4A1` (Thumb) |
| `0x112000` | la phrase de passe réseau, répétée (non reproduite) |
| `0x112060` | le format du chemin d'un CIA : `%s:/%016llx.cia` |
| objet client, `+0x1FF8` | l'octet d'état du client : 1 initialisé, 2 en scrutation (d'après `StartScan`) |
| `0x112169` à `0x1121CE` | noms de services de la bibliothèque (`am:net`, `fs:LDR`, `fs:USER`, `srv:pm`, `nwm::UDS`) |

## Partie 6 : ce que Pokémon X envoie

Rien : le jeu n'ouvre aucun service de `dlp`. Pour le portage PC, `dlp` n'a rien à rendre à la place de la console. (Un jeu qui voudrait offrir le Téléchargement Jeu l'enverrait à `dlp:SRVR`.)

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les trois tables de commandes : 20, 16, 17. Voie 1 : l'émulation des trois aiguillages. Voie 2 : la Carte des services (3dbrew) : mêmes numéros ; mêmes en-têtes pour toutes les commandes dont le code vérifie l'en-tête en entier.
- Les noms des trois services, leur nombre de sessions (1) et la table des fonctions d'ouverture.
- L'architecture d'un fil par session, un objet par service.

**Interprété** :
- Les noms des gestionnaires (de la Carte), le rôle du faux client, l'octet d'état à `+0x1FF8` et ses valeurs, le masque de canaux de `StartScan`.
- Les cinq commandes lues dans le pseudo-code plutôt que par l'émulation.
- Que les trois aiguillages appartiennent aux services dans l'ordre CLNT, SRVR, FKCL (lu dans les appels, confirmé par le nombre de commandes).

**Pas lu** :
- Le protocole réseau : l'annonce du serveur, la négociation, le transfert du CIA par morceaux, les temporisations (`CreateTimer`).
- Les appels à `am:u` (installation du jeu reçu) et à `ps:ps` (chiffrement des trames) : leurs commandes n'ont pas été suivies.
- Les corps de presque tous les gestionnaires.
