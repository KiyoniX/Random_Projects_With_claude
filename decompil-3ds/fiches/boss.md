# boss, le service des téléchargements SpotPass

`boss` est le module qui télécharge en tâche de fond ce que les jeux et le système lui ont demandé (SpotPass) : un jeu **enregistre des tâches** (une adresse, un rythme, des propriétés), `boss` les exécute quand la console est en veille ou en jeu, et le jeu relit ensuite les **données reçues** (les « NsData »). Il offre trois services : `boss:U` (les jeux), `boss:P` (les applications système, « privilégié » : les mêmes commandes plus 88 autres, qui prennent en plus un identifiant de programme) et `boss:M` (la gestion, appelée par `ndm` pour suspendre et relancer le démon). Pokémon X envoie 28 commandes à `boss:U` ; `boss:P` et `boss:M` ne sont jamais ouverts par lui.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py boss`, le module est presque tout en Thumb), `outils/emulate_dispatch.py` sur les trois aiguillages (de 0 à 0xFFFF), et la lecture des 28 gestionnaires du jeu par un sous-agent (notes dans `local/analyse/boss/notes-boss-u.md`, avec des fonctions exécutées sous unicorn). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000003402`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `boss`, priorité 62 (`0x3E`) |
| Fichier lu | `local/extrait/boss/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x43FBC` octets de code (`0x44` pages), `0x4A7C` de données en lecture seule (5 pages, à `0x144000`), `0x27D4` de données (3 pages, à `0x149000`), `0x26D64` de mémoire à zéro, pile de `0x2000` |
| Fonctions | 3 690 pour Ghidra (3 580 en Thumb, 110 en ARM), plus 58 entrées manquées (veneers, cases Thumb, rappels), moins 221 qui ne sont pas des fonctions ou sont du code mort (`boss.hors-compte.tsv`) : 3 527 ; 384 nommées dans `boss.noms.tsv` ; 844 proposées en première passe et 548 en seconde, dans `local/analyse/boss/` (beaucoup de bibliothèques embarquées : HTTP, la pile réseau NEX `NEX_2_4_1_S25`, XML) |
| Services offerts | `boss:U` (2 sessions), `boss:P` (4), `boss:M` (1) : chaînes à `0x14400C`, `0x144013`, `0x14401A`, lues par `boss_service_main` (`0x100884`) |
| Services appelés | lus dans l'exheader : `http:C`, `ac:u`, `ptm:s`, `ptm:play`, `cfg:s`, `fs:USER`, `ps:ps`, `frd:u`, `cecd:s`. Dans le code, des chaînes pour `fs:USER` (`0x144CA7`), `fs:LDR` (`0x144CA0`), `http:C` (`0x144CBC`), `srv:pm`, `cecd:u`, `cecd:s`, `ptm:sysm`, `ptm:s`, `ptm:gets`, `ptm:u`, `ptm:play`, `gsp::Lcd`, `gsp::Gpu` ; `ac:u` est ouvert par `ac_u_open` (`0x100990`, chaîne `0x144C44` elle-même, citée par le mot `0x100A28`) et `frd:u` par `frd_u_open` (`0x127920`, chaîne en `0x1279C0`, lue par `adr` en `0x127952`) ; la chaîne `cecd:u` (`0x144D70`) n'est lue par aucun code |
| Appelants connus | Pokémon X : 28 commandes de `boss:U` (partie 5) ; `ndm` : `boss:M` (`fiches/ndm.md`) |

## Partie 1 : le démarrage et le serveur

`boss_service_main` (`0x100884`) construit trois serveurs (`boss_user_server_new` `0x1011D8` pour `boss:U`, 2 sessions ; `boss_privileged_server_new` `0x101100` pour `boss:P`, 4 ; `boss_ndm_server_new` `0x101020` pour `boss:M`, 1), puis boucle : attente sur les trois serveurs et un événement d'arrêt (`0x100D04`), puis `0x100E6C` qui reçoit la requête et appelle la méthode de requête de la session, qui est l'un des trois aiguillages. L'ordre des chaînes et les nombres de sessions (2, 4, 1) viennent des arguments de ces trois appels.

Appels système trouvés (balayage de toutes les fonctions) : 0x01 ControlMemory, 0x02 QueryMemory, 0x03 ExitProcess, 0x08 CreateThread, 0x09 ExitThread, 0x0A SleepThread, 0x0C, 0x13 CreateMutex, 0x17 CreateEvent, 0x18 SignalEvent, 0x19 ClearEvent, 0x1A, 0x1B, 0x1D, 0x1E, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x25 WaitSynchronizationN, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest, 0x35 GetProcessId, 0x37 GetThreadId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive. Les noms viennent de `fiches/kernel11.md`. Il n'y a ni accès au matériel ni mémoire partagée : tout passe par `fs`, `http:C` et les autres démons.

## Partie 2 : les trois aiguillages

Chaque aiguillage lit le numéro dans les 16 bits du haut de l'en-tête (`bitfield_extract(en-tête, 16, 16)`, `0x11B156`, le même code qu'am) et saute par un `switch`. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F` ; une requête mal formée `0xD9001830`. Exécutés par `emulate_dispatch.py boss 0x130d3c 0x131c30 0x130c00` :

| Service | Aiguillage | Commandes | Comment il est identifié |
| --- | --- | --- | --- |
| `boss:U` | `0x130D3C` | 55 (1 à 0x37) | 55 commandes comme la Carte et 3dbrew, mêmes en-têtes complets (`0x000B00C2`...) |
| `boss:P` | `0x131C30` | 143 (1 à 0x37 et 0x401 à 0x458) | 143 = les 55 de `boss:U` plus 88 ; les en-têtes `0x041500C0`, `0x04160142`, `0x04170182` sont ceux que le jeu a pour `boss:P` |
| `boss:M` | `0x130C00` | 7 (1 à 7) | 7 commandes comme la Carte ; en-tête `0x00010002` |

L'attribution (U, P, M) repose sur le nombre de commandes et les en-têtes, et sur l'ordre des chaînes dans `boss_service_main` ; elle n'a pas été vérifiée en suivant la session de chaque service jusqu'à son aiguillage : **interprétée** (très probable).

**`boss:P` a ses propres copies des 55 commandes de `boss:U`** (autres adresses de gestionnaires, même forme que `cecd:s`), plus ses 88 commandes privilégiées. Pour 9 d'entre elles (0x421 à 0x424, 0x435, 0x436, 0x43A, 0x43B, 0x448), l'émulation ne trouve pas de gestionnaire distinct (`-` dans le tableau) : elles sont traitées dans l'aiguillage lui-même ou renvoient à une fonction que le tri a prise pour une aide. Pour les cas 0x1 et 0x401, l'émulation a pris pour gestionnaire le contrôle du descripteur d'identifiant de processus (`0x11B0BA`) : les vrais gestionnaires sont `0x12FE54` et `0x130808` (bl en `0x131E10` et `0x132C7E`).

## Partie 3 : les commandes

Les noms sont ceux de la Carte (tirés de 3dbrew). Les en-têtes de requête (« entier » : le code compare l'en-tête en entier ; « numéro » : seulement le numéro), les gestionnaires et les en-têtes de réponse sont ceux de l'émulation. Un gestionnaire de `boss:U` appelle, après le contrôle de session, une méthode de l'objet central (`*0x14A6D0`) ; l'adresse de cette méthode est dans la partie 5 pour les 28 commandes du jeu.

### boss:U (aiguillage 0x130D3C, 55 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010082` | InitializeSession | `0x1398f4` | entier | `0x00010040` |
| 0x2 | `(numéro seul)` | SetStorageInfo | `0x13976c` | numéro | `0x00020040` |
| 0x3 | `(numéro seul)` | UnregisterStorage | `0x139934` | numéro | `0x00030040` |
| 0x4 | `(numéro seul)` | GetStorageInfo | `0x139234` | numéro | `0x00040080` |
| 0x5 | `0x00050042` | RegisterPrivateRootCa | `0x139c68` | entier | `0x00050042` |
| 0x6 | `0x00060084` | RegisterPrivateClientCert | `0x139dd0` | entier | `0x00060044` |
| 0x7 | `(numéro seul)` | GetNewArrivalFlag | `0x1398c8` | numéro | `0x00070080` |
| 0x8 | `0x00080002` | RegisterNewArrivalEvent | `0x139d0c` | entier | `0x00080040` |
| 0x9 | `(numéro seul)` | SetOptoutFlag | `0x139208` | numéro | `0x00090040` |
| 0xA | `(numéro seul)` | GetOptoutFlag | `0x1390f4` | numéro | `0x000a0080` |
| 0xB | `0x000b00c2` | RegisterTask | `0x138c30` | entier | `0x000b0042` |
| 0xC | `0x000c0082` | UnregisterTask | `0x139264` | entier | `0x000c0042` |
| 0xD | `0x000d0082` | ReconfigureTask | `0x139734` | entier | `0x000d0042` |
| 0xE | `(numéro seul)` | GetTaskIdList | `0x139154` | numéro | `0x000e0040` |
| 0xF | `0x000f0042` | GetStepIdList | `0x139120` | entier | `0x000f0042` |
| 0x10 | `0x00100102` | GetNsDataIdList | `0x139298` | entier | `0x001000c2` |
| 0x11 | `0x00110102` | GetNsDataIdList1 | `0x139958` | entier | `0x001100c2` |
| 0x12 | `0x00120102` | GetNsDataIdList2 | `0x139c98` | entier | `0x001200c2` |
| 0x13 | `0x00130102` | GetNsDataIdList3 | `0x139d8c` | entier | `0x001300c2` |
| 0x14 | `0x00140082` | SendProperty | `0x138c9c` | entier | `0x00140042` |
| 0x15 | `0x00150042` | SendPropertyHandle | `0x13999c` | entier | `0x00150040` |
| 0x16 | `0x00160082` | ReceiveProperty | `0x139310` | entier | `0x00160082` |
| 0x17 | `0x00170082` | UpdateTaskInterval | `0x1399dc` | entier | `0x00170042` |
| 0x18 | `0x00180082` | UpdateTaskCount | `0x1397d0` | entier | `0x00180042` |
| 0x19 | `0x00190042` | GetTaskInterval | `0x1392dc` | entier | `0x00190082` |
| 0x1A | `0x001a0042` | GetTaskCount | `0x138b4c` | entier | `0x001a0082` |
| 0x1B | `0x001b0042` | GetTaskServiceStatus | `0x139b08` | entier | `0x001b0082` |
| 0x1C | `0x001c0042` | StartTask | `0x139e04` | entier | `0x001c0042` |
| 0x1D | `0x001d0042` | StartTaskImmediate | `0x1399b0` | entier | `0x001d0042` |
| 0x1E | `0x001e0042` | CancelTask | `0x138a60` | entier | `0x001e0042` |
| 0x1F | `(numéro seul)` | GetTaskFinishHandle | `0x139a70` | numéro | `0x001f0042` |
| 0x20 | `0x00200082` | GetTaskState | `0x138bf0` | entier | `0x00200102` |
| 0x21 | `0x00210042` | GetTaskResult | `0x139188` | entier | `0x00210102` |
| 0x22 | `0x00220042` | GetTaskCommErrorCode | `0x139acc` | entier | `0x00220102` |
| 0x23 | `0x002300c2` | GetTaskStatus | `0x1391c4` | entier | `0x00230082` |
| 0x24 | `0x00240082` | GetTaskError | `0x138b80` | entier | `0x00240082` |
| 0x25 | `0x00250082` | GetTaskInfo | `0x138ad0` | entier | `0x00250042` |
| 0x26 | `(numéro seul)` | DeleteNsData | `0x138b10` | numéro | `0x00260040` |
| 0x27 | `0x002700c2` | GetNsDataHeaderInfo | `0x139a0c` | entier | `0x00270042` |
| 0x28 | `0x00280102` | ReadNsData | `0x138a8c` | entier | `0x002800c2` |
| 0x29 | `(numéro seul)` | SetNsDataAdditionalInfo | `0x139d5c` | numéro | `0x00290040` |
| 0x2A | `(numéro seul)` | GetNsDataAdditionalInfo | `0x139cdc` | numéro | `0x002a0080` |
| 0x2B | `(numéro seul)` | SetNsDataNewFlag | `0x139864` | numéro | `0x002b0040` |
| 0x2C | `(numéro seul)` | GetNsDataNewFlag | `0x139800` | numéro | `0x002c0080` |
| 0x2D | `(numéro seul)` | GetNsDataLastUpdate | `0x139a9c` | numéro | `0x002d00c0` |
| 0x2E | `(numéro seul)` | GetErrorCode | `0x138b3c` | numéro | `0x002e0080` |
| 0x2F | `(numéro seul)` | RegisterStorageEntry | `0x139b3c` | numéro | `0x002f0040` |
| 0x30 | `(numéro seul)` | GetStorageEntryInfo | `0x139a40` | numéro | `0x003000c0` |
| 0x31 | `(numéro seul)` | SetStorageOption | `0x139894` | numéro | `0x00310040` |
| 0x32 | `(numéro seul)` | GetStorageOption | `0x139830` | numéro | `0x00320140` |
| 0x33 | `0x00330042` | StartBgImmediate | `0x139ba0` | entier | `0x00330042` |
| 0x34 | `0x00340042` | GetTaskPriority | `0x139bcc` | entier | `0x00340082` |
| 0x35 | `0x003500c2` | RegisterImmediateTask | `0x139bfc` | entier | `0x00350042` |
| 0x36 | `0x00360084` | SetTaskQuery | `0x1390c0` | entier | `0x00360044` |
| 0x37 | `0x00370084` | GetTaskQuery | `0x138bbc` | entier | `0x00370044` |

### boss:P (aiguillage 0x131C30, 143 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010082` | InitializeSession | `0x12fe54` | entier (puis `ipc_is_pid_desc` `0x11B0BA` sur le mot 3) | `0x00010040` (supposé : l'émulation s'arrêtait au contrôle) |
| 0x2 | `(numéro seul)` | SetStorageInfo | `0x12fc8c` | numéro | `0x00020040` |
| 0x3 | `(numéro seul)` | UnregisterStorage | `0x12fea0` | numéro | `0x00030040` |
| 0x4 | `(numéro seul)` | GetStorageInfo | `0x12fb54` | numéro | `0x00040080` |
| 0x5 | `0x00050042` | RegisterPrivateRootCa | `0x130298` | entier | `0x00050042` |
| 0x6 | `0x00060084` | RegisterPrivateClientCert | `0x1306a0` | entier | `0x00060044` |
| 0x7 | `(numéro seul)` | GetNewArrivalFlag | `0x12fe18` | numéro | `0x00070080` |
| 0x8 | `0x00080002` | RegisterNewArrivalEvent | `0x11b16c` | entier | `0x00080040` |
| 0x9 | `(numéro seul)` | SetOptoutFlag | `0x12fac4` | numéro | `0x00090040` |
| 0xA | `(numéro seul)` | GetOptoutFlag | `0x12f98c` | numéro | `0x000a0080` |
| 0xB | `0x000b00c2` | RegisterTask | `0x12f8f0` | entier | `0x000b0042` |
| 0xC | `0x000c0082` | UnregisterTask | `0x12fba8` | entier | `0x000c0042` |
| 0xD | `0x000d0082` | ReconfigureTask | `0x12fc54` | entier | `0x000d0042` |
| 0xE | `(numéro seul)` | GetTaskIdList | `0x12f9fc` | numéro | `0x000e0040` |
| 0xF | `0x000f0042` | GetStepIdList | `0x12f9c8` | entier | `0x000f0042` |
| 0x10 | `0x00100102` | GetNsDataIdList | `0x12fbdc` | entier | `0x001000c2` |
| 0x11 | `0x00110102` | GetNsDataIdList1 | `0x12fec4` | entier | `0x001100c2` |
| 0x12 | `0x00120102` | GetNsDataIdList2 | `0x1302e0` | entier | `0x001200c2` |
| 0x13 | `0x00130102` | GetNsDataIdList3 | `0x130628` | entier | `0x001300c2` |
| 0x14 | `0x00140082` | SendProperty | `0x11b7e4` | entier | `0x00140042` |
| 0x15 | `0x00150042` | SendPropertyHandle | `0x12ff18` | entier | `0x00150040` |
| 0x16 | `0x00160082` | ReceiveProperty | `0x11b214` | entier | `0x00160082` |
| 0x17 | `0x00170082` | UpdateTaskInterval | `0x12ff68` | entier | `0x00170042` |
| 0x18 | `0x00180082` | UpdateTaskCount | `0x12fcf0` | entier | `0x00180042` |
| 0x19 | `0x00190042` | GetTaskInterval | `0x12fc20` | entier | `0x00190082` |
| 0x1A | `0x001a0042` | GetTaskCount | `0x12f80c` | entier | `0x001a0082` |
| 0x1B | `0x001b0042` | GetTaskServiceStatus | `0x1300d8` | entier | `0x001b0082` |
| 0x1C | `0x001c0042` | StartTask | `0x130a8c` | entier | `0x001c0042` |
| 0x1D | `0x001d0042` | StartTaskImmediate | `0x12ff3c` | entier | `0x001d0042` |
| 0x1E | `0x001e0042` | CancelTask | `0x12f6e4` | entier | `0x001e0042` |
| 0x1F | `(numéro seul)` | GetTaskFinishHandle | `0x12fffc` | numéro | `0x001f0042` |
| 0x20 | `0x00200082` | GetTaskState | `0x12f8b0` | entier | `0x00200102` |
| 0x21 | `0x00210042` | GetTaskResult | `0x12fa30` | entier | `0x00210102` |
| 0x22 | `0x00220042` | GetTaskCommErrorCode | `0x13009c` | entier | `0x00220102` |
| 0x23 | `0x002300c2` | GetTaskStatus | `0x12fa6c` | entier | `0x00230082` |
| 0x24 | `0x00240082` | GetTaskError | `0x12f840` | entier | `0x00240082` |
| 0x25 | `0x00250082` | GetTaskInfo | `0x12f754` | entier | `0x00250042` |
| 0x26 | `(numéro seul)` | DeleteNsData | `0x12f7b4` | numéro | `0x00260040` |
| 0x27 | `0x002700c2` | GetNsDataHeaderInfo | `0x12ff98` | entier | `0x00270042` |
| 0x28 | `0x00280102` | ReadNsData | `0x12f710` | entier | `0x002800c2` |
| 0x29 | `(numéro seul)` | SetNsDataAdditionalInfo | `0x130528` | numéro | `0x00290040` |
| 0x2A | `(numéro seul)` | GetNsDataAdditionalInfo | `0x130414` | numéro | `0x002a0080` |
| 0x2B | `(numéro seul)` | SetNsDataNewFlag | `0x12fda4` | numéro | `0x002b0040` |
| 0x2C | `(numéro seul)` | GetNsDataNewFlag | `0x12fd30` | numéro | `0x002c0080` |
| 0x2D | `(numéro seul)` | GetNsDataLastUpdate | `0x13006c` | numéro | `0x002d00c0` |
| 0x2E | `(numéro seul)` | GetErrorCode | `0x12f7fc` | numéro | `0x002e0080` |
| 0x2F | `(numéro seul)` | RegisterStorageEntry | `0x130140` | numéro | `0x002f0040` |
| 0x30 | `(numéro seul)` | GetStorageEntryInfo | `0x12ffcc` | numéro | `0x003000c0` |
| 0x31 | `(numéro seul)` | SetStorageOption | `0x12fde4` | numéro | `0x00310040` |
| 0x32 | `(numéro seul)` | GetStorageOption | `0x12fd70` | numéro | `0x00320140` |
| 0x33 | `0x00330042` | StartBgImmediate | `0x1301bc` | entier | `0x00330042` |
| 0x34 | `0x00340042` | GetTaskPriority | `0x1301e8` | entier | `0x00340082` |
| 0x35 | `0x003500c2` | RegisterImmediateTask | `0x130244` | entier | `0x00350042` |
| 0x36 | `0x00360084` | SetTaskQuery | `0x12f944` | entier | `0x00360044` |
| 0x37 | `0x00370084` | GetTaskQuery | `0x12f87c` | entier | `0x00370044` |
| 0x401 | `0x04010082` | InitializeSessionPrivileged | `0x130808` | entier (puis `ipc_is_pid_desc` sur le mot 3) | `0x04010040` (supposé) |
| 0x402 | `(numéro seul)` | (sans nom) | `0x12fab0` | numéro | `0x04020040` |
| 0x403 | `(numéro seul)` | (sans nom) | `0x12fb84` | numéro | `0x04030040` |
| 0x404 | `(numéro seul)` | GetAppNewFlag | `0x1307f0` | numéro | `0x04040080` |
| 0x405 | `(numéro seul)` | SetAppNewFlag | `0x130858` | numéro | `0x04050040` |
| 0x406 | `(numéro seul)` | SetOptoutFlagPrivileged | `0x130558` | numéro | `0x04060040` |
| 0x407 | `(numéro seul)` | GetOptoutFlagPrivileged | `0x130444` | numéro | `0x04070080` |
| 0x408 | `(numéro seul)` | (sans nom) | `0x130760` | numéro | `0x04080040` |
| 0x409 | `0x04090102` | UnregisterTaskPrivileged | `0x1305d8` | entier | `0x04090042` |
| 0x40A | `(numéro seul)` | GetAppIdList | `0x12f7e0` | numéro | `0x040a0040` |
| 0x40B | `(numéro seul)` | GetTaskIdListPrivileged | `0x1304a8` | numéro | `0x040b0040` |
| 0x40C | `0x040c00c2` | GetStepIdListPrivileged | `0x130488` | entier | `0x040c0042` |
| 0x40D | `0x040d0182` | GetNsDataIdListPrivileged | `0x1305f8` | entier | `0x040d00c2` |
| 0x40E | `0x040e0182` | GetNsDataIdListPrivileged1 | `0x1309e0` | entier | `0x040e00c2` |
| 0x40F | `0x040f0102` | GetTaskInfoPrivileged | `0x130218` | entier | `0x040f0042` |
| 0x410 | `0x04100102` | GetTaskStatusPrivileged1 | `0x1304ec` | entier | `0x04100082` |
| 0x411 | `0x04110102` | GetTaskErrorPrivileged | `0x130340` | entier | `0x04110082` |
| 0x412 | `(numéro seul)` | (sans nom) | `0x130a78` | numéro | `0x04120040` |
| 0x413 | `0x04130082` | SendPropertyPrivileged | `0x1303ec` | entier | `0x04130042` |
| 0x414 | `0x04140082` | ReceivePropertyPrivileged | `0x130694` | entier | `0x04140082` |
| 0x415 | `(numéro seul)` | DeleteNsDataPrivileged | `0x1302c8` | numéro | `0x04150040` |
| 0x416 | `0x04160142` | GetNsDataHeaderInfoPrivileged | `0x1308e4` | entier | `0x04160042` |
| 0x417 | `0x04170182` | ReadNsDataPrivileged | `0x13010c` | entier | `0x041700c2` |
| 0x418 | `(numéro seul)` | SetNsDataAdditionalInfoPrivileged | `0x130a5c` | numéro | `0x04180040` |
| 0x419 | `(numéro seul)` | GetNsDataAdditionalInfoPrivileged | `0x130a20` | numéro | `0x04190080` |
| 0x41A | `(numéro seul)` | SetNsDataNewFlagPrivileged | `0x1307d4` | numéro | `0x041a0040` |
| 0x41B | `(numéro seul)` | GetNsDataNewFlagPrivileged | `0x130724` | numéro | `0x041b0080` |
| 0x41C | `(numéro seul)` | GetNsDataLastUpdatePrivileged | `0x130920` | numéro | `0x041c00c0` |
| 0x41D | `(numéro seul)` | (sans nom) | `0x1306fc` | numéro | `0x041d0040` |
| 0x41E | `(numéro seul)` | (sans nom) | `0x13066c` | numéro | `0x041e0080` |
| 0x41F | `(numéro seul)` | SetTestModeAvailability | `0x130570` | numéro | `0x041f0040` |
| 0x420 | `(numéro seul)` | GetTestModeAvailability | `0x13051c` | numéro | `0x04200080` |
| 0x421 | `(numéro seul)` |  | `-` | numéro | `0x04210040` |
| 0x422 | `(numéro seul)` | (sans nom) | `-` | numéro | `0x04220080` |
| 0x423 | `(numéro seul)` |  | `-` | numéro | `0x04230040` |
| 0x424 | `(numéro seul)` | (sans nom) | `-` | numéro | `0x04240080` |
| 0x425 | `0x04250042` | SetPolicyListEnvId | `0x12ff2c` | entier | `0x04250042` |
| 0x426 | `0x04260042` | GetPolicyListEnvId | `0x12ff08` | entier | `0x04260042` |
| 0x427 | `0x04270042` | SetPolicyListUrl | `0x12fdd4` | entier | `0x04270042` |
| 0x428 | `0x04280042` | GetPolicyListUrl | `0x12fd60` | entier | `0x04280042` |
| 0x429 | `0x04290002` | (sans nom) | `0x13097c` | entier | `0x04290040` |
| 0x42A | `(numéro seul)` | (sans nom) | `0x130a10` | numéro | `0x042a0040` |
| 0x42B | `(numéro seul)` | (sans nom) | `0x12fb00` | numéro | `0x042b0080` |
| 0x42C | `0x042c0042` | (sans nom) | `0x12f978` | entier | `0x042c00c2` |
| 0x42D | `(numéro seul)` | (sans nom) | `0x12fe44` | numéro | `0x042d0080` |
| 0x42E | `0x042e00c2` | StartTaskPrivileged | `0x130028` | entier | `0x042e0042` |
| 0x42F | `0x042f00c2` | StartTaskImmediatePrivileged | `0x1308b4` | entier | `0x042f0042` |
| 0x430 | `0x043000c2` | CancelTaskPrivileged | `0x13003c` | entier | `0x04300042` |
| 0x431 | `(numéro seul)` | (sans nom) | `0x1305cc` | numéro | `0x04310040` |
| 0x432 | `(numéro seul)` | (sans nom) | `0x130598` | numéro | `0x04320080` |
| 0x433 | `(numéro seul)` | GetStorageOptionPrivileged | `0x130740` | numéro | `0x04330140` |
| 0x434 | `0x043400c2` | StartBgImmediatePrivileged | `0x1309b0` | entier | `0x04340042` |
| 0x435 | `0x04350042` | (sans nom) | `-` | entier | `0x04350042` |
| 0x436 | `0x04360042` | (sans nom) | `-` | entier | `0x04360042` |
| 0x437 | `0x043700c2` | GetTaskPriorityPrivileged | `0x1309c4` | entier | `0x04370082` |
| 0x438 | `(numéro seul)` | (sans nom) | `0x1305a8` | numéro | `0x04380040` |
| 0x439 | `0x04390104` | GetTaskQueryPrivileged | `0x13036c` | entier | `0x04390044` |
| 0x43A | `0x043a0082` | (sans nom) | `-` | entier | `0x043a0042` |
| 0x43B | `0x043b0082` | (sans nom) | `-` | entier | `0x043b0042` |
| 0x43C | `(numéro seul)` | (sans nom) | `0x12f794` | numéro | `0x043c0040` |
| 0x43D | `(numéro seul)` | (sans nom) | `0x12f7a4` | numéro | `0x043d0040` |
| 0x43E | `0x043e0042` | SetSprelayUrl | `0x12faf0` | entier | `0x043e0042` |
| 0x43F | `0x043f0042` | GetSprelayUrl | `0x12f9b8` | entier | `0x043f0042` |
| 0x440 | `(numéro seul)` | SetSprelayInterval | `0x12fb98` | numéro | `0x04400040` |
| 0x441 | `(numéro seul)` | GetSprelayInterval | `0x12fb44` | numéro | `0x044100c0` |
| 0x442 | `(numéro seul)` | (sans nom) | `0x12fd20` | numéro | `0x04420040` |
| 0x443 | `0x04430042` | (sans nom) | `0x12fb18` | entier | `0x04430042` |
| 0x444 | `0x04440042` | (sans nom) | `0x13045c` | entier | `0x04440042` |
| 0x445 | `(numéro seul)` | (sans nom) | `0x1301a4` | numéro | `0x04450040` |
| 0x446 | `(numéro seul)` | (sans nom) | `0x130050` | numéro | `0x04460080` |
| 0x447 | `0x04470002` | RegisterNewArrivalEventPrivileged | `0x130a3c` | entier | `0x04470040` |
| 0x448 | `(numéro seul)` |  | `-` | numéro | `0x04480040` |
| 0x449 | `0x04490142` | RegisterTaskPrivileged | `0x1303b0` | entier | `0x04490042` |
| 0x44A | `(numéro seul)` | SetStorageInfoPrivileged | `0x1306d4` | numéro | `0x044a0040` |
| 0x44B | `(numéro seul)` | RegisterStorageEntryPrivileged | `0x13098c` | numéro | `0x044b0040` |
| 0x44C | `(numéro seul)` | UnregisterStoragePrivileged | `0x130870` | numéro | `0x044c0040` |
| 0x44D | `(numéro seul)` | GetStorageInfoPrivileged | `0x13057c` | numéro | `0x044d0080` |
| 0x44E | `(numéro seul)` | GetStorageEntryInfoPrivileged | `0x130904` | numéro | `0x044e00c0` |
| 0x44F | `0x044f0102` | UpdateTaskIntervalPrivileged | `0x1308c8` | entier | `0x044f0042` |
| 0x450 | `0x04500102` | UpdateTaskCountPrivileged | `0x130708` | entier | `0x04500042` |
| 0x451 | `0x045100c2` | GetTaskIntervalPrivileged | `0x130678` | entier | `0x04510082` |
| 0x452 | `0x045200c2` | GetTaskCountPrivileged | `0x130324` | entier | `0x04520082` |
| 0x453 | `0x045300c2` | GetTaskServiceStatusPrivileged | `0x130960` | entier | `0x04530082` |
| 0x454 | `0x04540102` | GetTaskStatePrivileged | `0x13038c` | entier | `0x04540102` |
| 0x455 | `0x045500c2` | GetTaskResultPrivileged | `0x1304c8` | entier | `0x04550102` |
| 0x456 | `0x045600c2` | GetTaskCommErrorCodePrivileged | `0x13093c` | entier | `0x04560102` |
| 0x457 | `0x04570142` | GetTaskStatusPrivileged | `0x130884` | entier | `0x04570082` |
| 0x458 | `0x04580104` | SetTaskQueryPrivileged | `0x1303f4` | entier | `0x04580044` |

### boss:M (aiguillage 0x130C00, 7 commandes)

| N° | En-tête de requête | Commande (Carte) | Gestionnaire | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010002` | (sans nom) : range l'identifiant de processus du descripteur `0x20` et marque la session | `0x1389a0` | entier | `0x00010040` |
| 0x2 | `(numéro seul)` | (sans nom) : reprise du démon (état 0, `boss_core_request_resume`) | `0x1389f4` | numéro | `0x00020040` |
| 0x3 | `(numéro seul)` | (sans nom) : suspension du démon (état 2, attente si l'octet du mot 1 est non nul) | `0x1389fc` | numéro | `0x00030040` |
| 0x4 | `(numéro seul)` | (sans nom) : rend la poignée d'événement de changement d'état du démon | `0x1389bc` | numéro | `0x00040042` |
| 0x5 | `(numéro seul)` | (sans nom) : état du démon (octet +0 du cœur) | `0x138990` | numéro | `0x00050080` |
| 0x6 | `(numéro seul)` | (sans nom) : minutes avant la prochaine tâche (au moins 30) | `0x1389ac` | numéro | `0x00060080` |
| 0x7 | `(numéro seul)` | (sans nom) : rend puis efface l'octet « alarme reçue » (+0x1104) | `0x1389d4` | numéro | `0x00070080` |


**Écarts avec la Carte.** La Carte donne `0x00030040` pour la commande 3 de `boss:M` ; le code n'en compare que le numéro. La commande 0x1F de `boss:U` (GetTaskFinishHandle) rend une poignée (réponse `0x001F0042`) ; 0x15 (SendPropertyHandle) en reçoit une. La commande 0x16 (ReceiveProperty) rend en plus un mot (`0x00160082`).

### Codes de résultat

Le module n'utilise qu'une famille de codes, celle du module `0x3E` (`0x...F8xx`), plus ceux de `fs` et `http` repliés. `boss_error_code_for_index` (`0x126494`, exécutée sous unicorn) traduit un index interne en code :

| Index | Code | Quand |
| --- | --- | --- |
| `0x2B` | `0xC8A0F82B` | session pas initialisée (toute commande hors SendPropertyHandle avant InitializeSession) |
| `0x31` | `0xC8A0F831` | fichier NsData trop court ou en-tête invalide |
| `0x32` | `0xC8A0F832` | programme ou stockage inconnu |
| `0x33` | `0xC8A0F833` | tâche inconnue |
| `0x34` | `0xC8A0F834` | étape inconnue |
| `0x3C` | `0xC8A0F83C` | lecture NsData impossible |
| `0x3F` | `0xC8A0F83F` | type d'information inconnu |
| `0x40` | `0xC8A0F840` | `fs:USER` refuse l'accès à l'extdata |
| `0x42` | `0xC8A0F842` | entrée de stockage absente |
| `0x43` | `0xC8A0F843` | DeleteNsData : l'entrée n'est pas un fichier |
| `0x44` | `0xC960F844` | mauvaise taille de tampon |
| `0x46` | `0xD840F846` | la liste de NsData a changé entre deux appels (jeton de reprise périmé) |
| `0x4A` / `0x4D` | `0xC960F84A` / `0xC960F84D` | erreur de `fs` ou fatfs / toute autre erreur (`boss_fold_error_code`, `0x126AB6`) |
| (autre) | `0xD8E0F802` | RegisterTask : propriété `0x06` de la session à 6, 7, 8, 9 ou 0xD |

Les index 1 à 0x4D donnent les classes `0xD8E0F8xx` (argument), `0xC8A0F8xx` (état), `0xD860F8xx` (ressources), `0xD840F8xx` (bloquerait), `0xC960F8xx` (interne) : table complète dans les notes.

## Partie 4 : une opération pas à pas, RegisterStorageEntry (0x2F)

Requête `0x002F0140` (5 mots ordinaires : identifiant d'extdata u64 aux mots 1-2, taille au mot 3, un u16 au mot 4, type de média au mot 5). Le gestionnaire (`0x139B3C`) :

1. Contrôle de session (`boss_user_get_session_program`, `0x11A61A`) : l'octet « initialisé » (session `+0xE10`) à 0 donne `0xC8A0F82B` ; sinon l'identifiant de programme (u64, session `+0xE18`) est pris.
2. Sous le verrou général du cœur, il appelle `fs:USER` `CheckAuthorityToAccessExtSaveData` (`0x083D0100` : média, identifiant d'extdata en deux mots, identifiant de processus de la session). Un refus ou un échec donne `0xC8A0F840`.
3. Il cherche dans le gestionnaire de stockages l'enregistrement du programme (clé = identifiant de programme) et en écrit un de `0x120` octets (`0x134b36`, sous le verrou `+0x39c`) : identifiant de programme (+0, +4), statut (+8 : 1, ou 2 si le programme est déjà dans la liste des 8 programmes qui ont ouvert une session `boss:P`, `boss_storage_has_session_program` `0x134696`, liste remplie par InitializeSessionPrivileged via `0x134564`), validité (+0x10 = 1), type (+0x11), u16 (+0x12), taille (+0x14), extdata (+0x18, +0x1C) ; il ne réécrit que si l'enregistrement change.
4. Il rend 0.

Dépendance : un `boss` réel a besoin que `fs` réponde « vrai » à CheckAuthority pour l'extdata du jeu ; **un remplaçant de `boss` n'a pas à appeler `fs`**, mais doit refléter ce résultat (rendre 0).

## Partie 5 : ce que Pokémon X envoie

Le jeu envoie **28 commandes** à `boss:U` (`pokemon-x-services.tsv`) : chaque fonction de sa bibliothèque existe en deux exemplaires, un pour la session privilégiée (`boss:P`, jamais ouverte) et un pour la session `boss:U`, que le jeu prend quand l'autre n'est pas là (`pokemon-x-services.md`). Le jeu ouvre sa session par `boss_open_user_session` (`0x124EA4`) et envoie InitializeSession en premier. Je n'ai **pas lu** ce que le jeu fait de chaque réponse (comment il réagit à `0xC8A0F832` ou à une liste vide) : la colonne « rendre » dit ce que le code de `boss` rend et ce que ses contrôles acceptent.

| Commande du jeu | En-tête | Fonction du jeu | Gestionnaire `boss:U` et méthode | Ce que le remplaçant doit rendre |
| --- | --- | --- | --- | --- |
| InitializeSession | `0x00010082` | `0x134B3C` | `0x1398F4` -> `0x11C154` | 0. Requête : mot 3 = descripteur d'identifiant de processus (`0x20`), mot 4 = identifiant. Le vrai appelle `fs:USER GetProgramLaunchInfo` (`0x082F0040`) |
| UnregisterStorage | `0x00030000` | `0x119ED4` | `0x139934` -> `0x11C11C` | 0 (ou `0xC8A0F842` si jamais enregistré) |
| RegisterTask | `0x000B00C2` | `0x2B6FCC` | `0x138C30` -> `0x126B60` | 0 et le descripteur recopié. Le vrai refuse (`0xD8E0F802`) si la propriété `0x06` envoyée avant est 6, 7, 8, 9 ou 0xD ; il crée la page de tâche (`0xC00` octets) dans les fichiers `BOSS_SV/SS/A.db` |
| UnregisterTask | `0x000C0082` | `0x2B71A8` | `0x139264` -> `0x11C590` | 0 ; le vrai rend `0xC8A0F832` ou `33` si la tâche n'existe pas |
| ReconfigureTask | `0x000D0082` | `0x2B724C` | `0x139734` -> `0x11C468` | 0 |
| GetTaskIdList | `0x000E0000` | `0x2B70C0` | `0x139154` -> `0x11C88C` | 0 ; les identifiants se lisent ensuite par ReceiveProperty `0x35` (compteur u16) et `0x36` (8 octets par identifiant) : compteur 0 |
| GetNsDataIdList2 | `0x00120102` | `0x2B7484` | `0x139C98` -> `0x11BC08` | 0 avec 0 identifiant (deux u16 en sortie : nombre écrit, index de reprise 0) |
| SendProperty | `0x00140082` | `0x2B7020` | `0x138C9C` | 0 : copie la valeur dans le bloc de propriétés de la session (table plus bas) ; id inconnu : `0xC960F84D` |
| SendPropertyHandle | `0x00150042` | `0x2B7298` | `0x13999C` | 0 ; seule commande qui n'exige pas de session ; id 0x0C seulement, sinon `0xC960F84D` |
| ReceiveProperty | `0x00160082` | `0x2B71F4` | `0x139310` | 0 et le bloc relu (zéros si rien n'a été envoyé) ; id inconnu : `0xC960F84D` |
| GetTaskServiceStatus | `0x001B0042` | `0x2B73A4` | `0x139B08` -> `0x11BE28` | 0 et un octet de 0 à 2 (2 si la lecture échoue) |
| StartTaskImmediate | `0x001D0042` | `0x2B72DC` | `0x1399B0` -> `0x11C030` | 0 |
| CancelTask | `0x001E0042` | `0x2B6DDC` | `0x138A60` -> `0x11CDA0` | 0 |
| GetTaskFinishHandle | `0x001F0000` | `0x2B7370` | `0x139A70` | 0 et **une vraie poignée d'événement** (réponse `0x001F0042` : descripteur `0x00000000` puis la poignée). Le vrai rend celle du cœur (`core + 0x1110`), signalée à la fin d'une tâche |
| GetTaskState | `0x00200082` | `0x2B6F64` | `0x138BF0` -> `0x11CA10` | 0 : octet d'état (7 si l'enregistrement est illisible), un u32, un octet ; réponse `0x00200102` |
| GetTaskResult | `0x00210042` | `0x2B70E8` | `0x139188` -> `0x11C804` | 0 et zéros (octet 3 si la lecture échoue) ; réponse `0x00210102` |
| GetTaskStatus | `0x002300C2` | `0x2B7148` | `0x1391C4` -> `0x11C704` | 0 et un octet 0 |
| GetTaskError | `0x00240082` | `0x2B6F10` | `0x138B80` -> `0x11CBA0` | 0 et un octet 0 |
| GetTaskInfo | `0x00250082` | `0x2B6E80` | `0x138AD0` -> `0x11CCEC` | 0 ; remplit les propriétés de sortie (ReceiveProperty `0x1D` à `0x2F`) : zéros |
| DeleteNsData | `0x00260040` | `0x119EA4` | `0x138B10` -> `0x11CCB0` | 0 (le vrai rend `0xC8A0F843` si l'entrée n'est pas un fichier) |
| GetNsDataHeaderInfo | `0x002700C2` | `0x2B731C` | `0x139A0C` -> `0x11BF44` | selon le type d'information (0 : 8 octets, 1 à 5 : 4 octets, 6 : 32 octets) ; une mauvaise taille donne `0xC960F844`, un type inconnu `0xC8A0F83F`. Sans NsData : `0xC8A0F832` |
| ReadNsData | `0x00280102` | `0x2B6E1C` | `0x138A8C` -> `0x11CD70` | 0 avec 0 octet lu et le descripteur recopié (réponse `0x002800C2`) ; erreur de position `0xC8A0F83C` |
| GetErrorCode | `0x002E0040` | `0x2B6ECC` | `0x138B3C` -> `0x11CC44` | **fonction pure, rend toujours 0** : un u32 tiré d'une table de 0x6C paires (octet, u32) à `0x14434C`, `0xB3B1` si absent |
| RegisterStorageEntry | `0x002F0140` | `0x119F3C` | `0x139B3C` -> `0x11C444` | 0 (partie 4) |
| GetStorageEntryInfo | `0x00300000` | `0x119EFC` | `0x139A40` -> `0x11C664` | 0, un u32 (taille) et un u16 ; `0xC8A0F842` si absent |
| StartBgImmediate | `0x00330042` | `0x2B73F0` | `0x139BA0` -> `0x11BDA8` | 0 |
| RegisterImmediateTask | `0x003500C2` | `0x2B7430` | `0x139BFC` -> `0x11BC9C` | 0 (mêmes refus que RegisterTask) |
| SetTaskQuery | `0x00360084` | `0x2B706C` | `0x1390C0` -> `0x11C944` | 0 ; la requête doit faire `0x60` octets sinon `0xC960F84D` |

**La réponse minimale qui ne bloque pas le jeu** : le code de chaque gestionnaire accepte « résultat 0 et des zéros ». Les conditions dures sont : (1) toute commande autre que SendPropertyHandle rend `0xC8A0F82B` tant qu'InitializeSession n'est pas passée ; (2) une vraie poignée d'événement pour GetTaskFinishHandle ; (3) la propriété `0x06` ne doit pas valoir 6, 7, 8, 9 ou 0xD avant RegisterTask. Les commandes « zéro » correspondent à des tâches qui n'existent pas, pour lesquelles le vrai module rendrait `0xC8A0F832` ou `33` : si le jeu réagit à ces codes (non lu), mieux vaut les rendre. Aucun téléchargement n'est nécessaire : une console sans tâche reçue rend des listes vides.

### Les propriétés (SendProperty / ReceiveProperty)

Les propriétés sont un bloc de la session ; SendProperty, ids acceptés -> (décalage, taille max) : 00 -> 0xC/1, 01 -> 0xD/1, 02 -> 0x10/4, 03 -> 0x14/4, 04 -> 0x18/4, 05 -> 0xE/1, 06 -> 0x1C/1, 07 -> 0x234/512, 08 -> 0x28/4, 09 -> 0x20/1, 0A -> 0x34/256, 0B -> 0x34/512, 0C -> 0x30/4, 0D -> 0x434/864, 0E -> 0x7A0/4, 0F -> 0x794/12, 10 -> 0x1E/1, 11 -> 0x1D/1, 12 -> 0x1F/1, 13 -> 0x7A4/4, 14 -> 0x7A8/4, 15 -> 0x7B0/64, 16 -> 0x24/4, 18 -> 0/1, 19 -> 1/1, 1A -> 2/1, 1B -> 4/4, 1C -> 8/4, 3B -> 0x2C/4, 3E -> 0x34/512, 3F -> 0x21/1. ReceiveProperty accepte les mêmes plus 1D à 38 (état de tâche, listes de tâches à `0x8F8` et d'étapes à `0xD00`), table complète dans les notes (obtenue en exécutant les gestionnaires : **sûre** pour les décalages, **interprétée** pour le sens des propriétés).

## Partie 6 : tables et stockage

| Où | Quoi |
| --- | --- |
| `*0x14A6D0` | l'objet central : base de tâches (`+0x84`), gestionnaire de stockages (`+0x8C`), événement de réveil du planificateur (`+0x88`, `+0xA0`), mutex (`+0x94`), verrou général (`+0x1144`), poignée rendue par GetTaskFinishHandle (`+0x1110`) |
| objet de session | `+0x000..0xD83` bloc de propriétés ; `+0xD84` identifiant de processus ; `+0xD88..` propriétés de sortie ; `+0xE10` octet « initialisé » ; `+0xE14` poignée de RegisterNewArrivalEvent ; `+0xE18/E1C` identifiant de programme (u64) |
| `bossdb:` | archive montée par `boss_mount_archive` (`0x127598`, argument `0x10034`) : **probablement** la sauvegarde système d'identifiant `0x00010034` (déduction) ; fichiers `BOSS_PH_FILE.db`, `BOSS_PH_INFO.db`, `BOSS_SP_INFO.db`, `BOSS_PM_INFO.db`, `BOSS_SV.db`, `BOSS_SS.db`, `BOSS_A.db` (pages de `0xC00` pour SV et SS, `0x800` pour A), et par programme `%s_CA%d`, `%s_CL`, `%s_CLK` (certificats privés). Un NsData est un fichier à nom hexadécimal dans un dossier par programme, avec un en-tête de `0x34` octets |
| `0x14434C` | table de 0x6C paires (octet, u32) de GetErrorCode |
| Adresses | `https://nppl.c.app.nintendowifi.net` (liste de politiques), `https://service.spr.app.nintendo.net/relay/0`, `https://npvk.app.nintendo.net/reports`, `npdl.cdn.nintendowifi.net`, en-têtes `X-BOSS-*`, priorités `EXPEDITE1-8`, `MEDIUM`, `LOWEST1-8`, `STOPPED` |

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies) : les trois tables de commandes (55, 143, 7), par l'émulation et le pseudo-code de Ghidra (les cas du `switch` de `0x130D3C`) ; pour `boss:U`, aussi le nombre et les en-têtes de la Carte et de 3dbrew ; les 28 commandes du jeu et leurs gestionnaires (adresses de `pokemon-x-services.tsv` croisées avec les en-têtes émulés) ; le contrôle de session et le code `0xC8A0F82B` ; l'appel de `CheckAuthorityToAccessExtSaveData` ; la table de conversion des codes d'erreur (exécutée) et celle des propriétés (exécutée).

**Interprété** : l'attribution de `0x131C30` à `boss:P` et de `0x130C00` à `boss:M` ; `bossdb:` comme la sauvegarde système `0x00010034` ; les noms des structures (base de tâches, gestionnaire de stockages) ; le sens des propriétés ; les réponses minimales (le code les accepte, mais la réaction du jeu n'est pas lue).

**Pas lu** : la pile NEX, les mises à jour réelles ; le sens des octets d'état d'étape ; GetNsDataIdList (variantes 0x10, 0x11, 0x13) et ReadNsData en détail ; les 27 commandes de `boss:U` que le jeu n'envoie pas (une ligne chacune dans les notes) ; la réaction du jeu aux codes d'erreur. Le planificateur, le transfert HTTP, la liste de politiques (XML) et les 7 commandes de `boss:M` sont lus dans `local/analyse/boss/notes-100-2.md` (non relu).
