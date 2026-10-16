# mp, le multijoueur sans fil de bas niveau

`mp` est un pilote de communication sans fil locale (le mode « MP », une communication par trames entre au plus 16 consoles proches), plus bas niveau que l'UDS de `nwm`. Il n'offre qu'un service, `mp:u`, une seule session à la fois. Le module n'est pas, comme les autres, en Thumb : 714 de ses 726 fonctions sont en ARM. Il parle à la puce Wi-Fi par `nwm::EXT` (une commande pour ouvrir l'accès au matériel) et lie lui-même une interruption.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`), `outils/emulate_dispatch.py` sur l'aiguillage (en ARM, de 0 à 0xFFFF) et la Carte des services (tirée de 3dbrew, page MP_Services). Adresses du module chargé à `0x00100000`. Les noms que la Carte donne sont rares : sur 20 commandes, 8 ont un nom (GetHandle, Initialize, Shutdown, Bind, SetBeaconData, SetAppData, RecvDataFrame, SendDataFrame).

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002A02`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `mp`, priorité 39 (`0x27`) |
| Fichier lu | `local/extrait/mp/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x1F724` octets de code (`0x20` pages), `0x96C` de données en lecture seule (1 page), `0xD8` de données (1 page), `0x3D8F4` de mémoire à zéro (la plus grosse part du module : les tampons de trames), pile de `0x1000` |
| Fonctions | 726 pour Ghidra, dont 12 en Thumb et 714 en ARM ; 22 nommées dans `mp.noms.tsv`, aucun nom sans fonction |
| Service offert | `mp:u`, 1 session : table (nom, nombre de sessions) à `0x120030`, nom à `0x120040` |
| Services appelés | lus dans l'exheader : `nwm::EXT`, `cfg:nor`, `ptm:s`. Dans le code, des chaînes pour `nwm::EXT` (`0x120070`), `cfg:nor` (`0x1207A4`), `ptm:s` (`0x1207BB`, dans la liste de la bibliothèque) |
| Droits du noyau (exheader) | l'interruption `0x5F`, et des plages d'adresses matérielles à `0x1EC65000`, `0x1EC66000`, `0x1EC74000`, `0x1EC78000` et `0x1EC79000` (décodage de l'exheader par `capdec.py`, la correspondance avec les périphériques n'est pas lue) |
| Appelants connus | aucun exheader extrait ne déclare `mp:u`. Pokémon X ne l'ouvre pas |
| Chaîne de version | `1.03.00` à `0x1206DC` |

## Partie 1 : le démarrage et le serveur

`mp_main` (`0x100424`, un seul fil de service) :

1. **Prépare le matériel.** `0x113988` (tas), l'enregistrement du service (`0x1012E8`, en-tête de commande 3, avec le nom lu dans la table `0x120030` et le nombre de sessions 1) puis `0x101138`, `0x100A88` (772 octets : initialisation du module), un `SetThreadPriority` (svc `0x0C`), `0x101040`, un envoi (`0x101974`, en-tête `0x00050082`, 2 mots ordinaires et 2 descripteurs, la taille `0x1D8`) à un service dont la poignée n'est pas identifiée ; `nwm::EXT` est le seul autre service que le module peut parler, avec `cfg:nor` et la liaison de l'interruption (`BindInterrupt`, svc `0x50`, enveloppe `0x106058`).
2. S'abonne à quatre notifications de `sm` (numéros `0x100`, `0x104`, `0x103` et `0x302`, passés à `0x1137E8`).
3. **Boucle** sur `ReplyAndReceive` (`0x1009B4`) avec les poignées du module : la notification de `sm`, le port du service, la session (une au plus). Un port actif : `AcceptSession` (`0x100978`) ; une session : `handler(session)` avec la fonction dont l'adresse est à `0x12000C` : `mp_u_dispatch_command` (`0x11D1DC`). Une session fermée est retirée.
4. À l'arrêt : retire le service, arrête les temporisateurs et ferme les poignées (`0x100DA8`, `0x1010C4`, `0x1010E4`, `0x101398`).

Appels système trouvés : 0x0C SetThreadPriority, 0x13 CreateMutex, 0x14 ReleaseMutex, 0x17 CreateEvent, 0x18 SignalEvent, 0x19 ClearEvent, 0x1A CreateTimer, 0x1B SetTimer, 0x1C CancelTimer, 0x1D ClearTimer, 0x1E CreateMemoryBlock, 0x1F MapMemoryBlock, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x25 WaitSynchronizationN, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest, 0x35 GetProcessId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive, **0x50 BindInterrupt, 0x51 UnbindInterrupt** (aucun autre module de cette série ne lie d'interruption, à part `mvd`). Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : l'aiguillage

`mp_u_dispatch_command` (`0x11D1DC`, ARM) lit le numéro dans les 16 bits du haut de l'en-tête (un `switch` à 20 cas que Ghidra reconstruit, contrairement aux modules en Thumb : le pseudo-code est lisible tel quel) et appelle un gestionnaire. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F`.

`emulate_dispatch.py mp 0x11d1dc=mp:u --arm` : **20 commandes, numéros 1 à 0x14**, les mêmes que la Carte. Trois (`0xE`, `0xF`, `0x14`) ont été refusées par l'émulation (descripteurs de tampon) ; leur gestionnaire est lu dans le pseudo-code, où chaque cas est un appel direct : `0xE` -> `0x11D858`, `0xF` -> `0x11DEA4`, `0x14` -> `0x11D714`.

## Partie 3 : les commandes

Les noms et les en-têtes sont ceux de la Carte (3dbrew, qui ne nomme que 8 des 20 commandes). « Source » dit d'où vient l'adresse du gestionnaire. « Vérifié » : l'aiguillage compare l'en-tête en entier ou le numéro seulement.

### `mp:u` (aiguillage `mp_u_dispatch_command` à `0x11d1dc`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010040` | GetHandle | `mp_u_cmd_0001_GetHandle` | `0x11D974` | émulation | numéro | `0x00010042` |
| 0x2 | `0x00020000` | Initialize | `mp_u_cmd_0002_Initialize` | `0x11DCBC` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030000` | Shutdown | `mp_u_cmd_0003_Shutdown` | `0x11D7EC` | émulation | numéro | `0x00030040` |
| 0x4 | `0x000400C0` | Bind | `mp_u_cmd_0004_Bind` | `0x11DBA8` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050042` | SetBeaconData | `mp_u_cmd_0005_SetBeaconData` | `0x11DFBC` | émulation | entier | `0x00050040` |
| 0x6 | `0x00060000` | Inconnue | `mp_u_cmd_0006_Unknown` | `0x11DF2C` | émulation | numéro | `0x00060040` |
| 0x7 | `0x00070042` | SetAppData | `mp_u_cmd_0007_SetAppData` | `0x11DC14` | émulation | entier | `0x00070040` |
| 0x8 | `0x00080040` | Inconnue | `mp_u_cmd_0008_Unknown` | `0x11DA88` | émulation | numéro | `0x00080040` |
| 0x9 | `0x00090040` | Inconnue | `mp_u_cmd_0009_Unknown` | `0x11D98C` | émulation | numéro | `0x00090040` |
| 0xA | `0x000A0000` | Inconnue | `mp_u_cmd_000A_Unknown` | `0x11DC74` | émulation | numéro | `0x000A0080` |
| 0xB | `0x000B0000` | Inconnue | `mp_u_cmd_000B_Unknown` | `0x11DA38` | émulation | numéro | `0x000B0080` |
| 0xC | `0x000C0000` | Inconnue | `mp_u_cmd_000C_Unknown` | `0x11DB68` | émulation | numéro | `0x000C0080` |
| 0xD | `0x000D00C2` | Inconnue | `mp_u_cmd_000D_Unknown` | `0x11DDEC` | émulation | entier | `0x000D0042` |
| 0xE | `0x000E0084` | Inconnue | `mp_u_cmd_000E_Unknown` | `0x11D858` | pseudo-code | entier | `0x00000040` |
| 0xF | `0x000F00C2` | Inconnue | `mp_u_cmd_000F_Unknown` | `0x11DEA4` | pseudo-code | entier | `0x00000040` |
| 0x10 | `0x00100000` | Inconnue | `mp_u_cmd_0010_Unknown` | `0x11DAE8` | émulation | numéro | `0x00100040` |
| 0x11 | `0x00110080` | RecvDataFrame | `mp_u_cmd_0011_RecvDataFrame` | `0x11DD98` | émulation | numéro | `0x00110042` |
| 0x12 | `0x00120082` | Inconnue | `mp_u_cmd_0012_Unknown` | `0x11D908` | émulation | entier | `0x00120040` |
| 0x13 | `0x00130040` | Inconnue | `mp_u_cmd_0013_Unknown` | `0x11D794` | émulation | numéro | `0x00130040` |
| 0x14 | `0x001400C2` | SendDataFrame | `mp_u_cmd_0014_SendDataFrame` | `0x11D714` | pseudo-code | entier | `0x00000040` |


Notes (lues dans les gestionnaires, interprétées pour le sens) :

- **L'état du module.** Chaque gestionnaire commence par lire un entier d'état à `0x121004` (l'adresse est dans un mot de chaque fonction, `0x11D784`, `0x11DC04`...) : 0 = le pilote est prêt (les commandes agissent) ; sinon le gestionnaire rend l'un de deux codes d'erreur selon que l'état vaut 1 ou autre : `0xC9609414` (état 1) et `0xC9609402` (autre état) pour `SendDataFrame`, avec en plus `0xC9609401` quand l'envoi est refusé, `0xC9609403` et `0xC9609407` pour la lecture d'une trame (interprété : « pas initialisé » et « arrêt en cours »). `Initialize` (`0x2`) passe de l'état 2 à 0 et refuse l'état 1 ; `Shutdown` (`0x3`) ramène à 0 et défait les structures.
- **Les nœuds.** `Bind` (`0x4`) refuse un numéro de nœud supérieur à 15 ; `RecvDataFrame` (`0x11`) lit dans la file du nœud de numéro inférieur à 16 (base `0x122C48` + `0x2D6A8`, soit `0x14F2F0`, 0x2C octets par nœud, un anneau de 8 trames de 700 octets au plus) : le module prévoit donc **16 nœuds** et des trames de **700 octets**.
- **Les données d'annonce.** `SetBeaconData` (`0x5`) et `SetAppData` (`0x7`) refusent plus de `0x70` octets (112) : c'est la taille des données d'application que le pilote annonce.
- `GetHandle` (`0x1`) rend une poignée prise dans une table de 16 entrées selon l'indice demandé (`0x1186B4`) : les événements du pilote (par nœud et deux généraux).

## Partie 4 : une opération pas à pas, RecvDataFrame

`mp:u`, commande `0x11` (3dbrew : RecvDataFrame, `0x00110080`) : l'application lit une trame reçue d'un nœud. Un mot ordinaire (le numéro de nœud) et un tampon en écriture. Lu dans `mp_u_cmd_0011_RecvDataFrame` (`0x11DD98`).

1. L'aiguillage (`0x11D1DC`) lit le numéro `0x11`, prépare le tampon de sortie (`0x11DD98` le met à zéro sur 700 octets) et appelle le gestionnaire.
2. Le gestionnaire teste l'état du module : il doit valoir 0 ; sinon il rend un des codes d'erreur.
3. Il refuse un numéro de nœud de 16 ou plus.
4. Il retrouve la file du nœud (base + numéro x `0x2C`), compare le compteur de lecture (`+0x2D6AC`) au compteur d'écriture (`+0x2D6A8`) : s'ils sont égaux, il n'y a rien à lire et il rend un code d'erreur.
5. Sinon il prend la trame à l'indice `lecture & 7`, la copie dans le tampon de l'application (700 octets, `0x10FE90`), range un indicateur dans une table de nœuds (interprété : « une trame a été perdue » quand le compteur d'écriture a dépassé la lecture de plus d'une trame), signale le verrou de la file (`0x112E8C`, `0x1121FC`, `0x112E6C`) et incrémente le compteur de lecture.
6. L'aiguillage répond (`0x00110042`).

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x12000C` | la table du service : `0x11D1DC` (aiguillage), d'autres adresses ARM (`0x11F668`, `0x11F6A4`, `0x11F67C`, `0x1136A4`) à la suite, non lues |
| `0x120030` | table des services : (`mp:u`, 1 session) ; le nom est à `0x120040` |
| `0x120048` à `0x12005C` | six fonctions (`0x11B2D4`, `0x118A60`, `0x112780`, `0x11BCBC`, `0x11B438`, `0x11BCF0`), non lues : probablement les rappels du pilote |
| `0x120070` | le nom `nwm::EXT` |
| `0x1206DC` | `1.03.00` |
| `0x1207A4` à `0x1207D9` | liste de noms de services de la bibliothèque (`cfg:nor`, `err:f`, `ptm:*`, `cfg:u`) |
| `0x14F2F0` (`0x122C48` + `0x2D6A8`) | les files de trames par nœud (0x2C octets par nœud) |
| `0x121004` | l'entier d'état du module (0 : prêt) |

## Partie 6 : ce que Pokémon X envoie

Rien : le jeu n'ouvre pas `mp:u`. Pour le portage PC, `mp` n'a rien à rendre à la place de la console.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- La table de commandes : 20 commandes, numéros 1 à 0x14. Voie 1 : l'émulation de l'aiguillage ARM. Voie 2 : la Carte des services (3dbrew) : mêmes numéros ; mêmes en-têtes pour toutes celles dont le code vérifie l'en-tête en entier.
- Le service unique et sa session unique (table `0x120030`) ; l'usage de `BindInterrupt` ; les tailles 16 (nœuds), 700 (trame) et `0x70` (annonce) lues dans les tests des gestionnaires.

**Interprété** :
- Les noms (12 sur 20 manquent même à 3dbrew).
- Le sens des valeurs de l'état (0, 1, 2), le rôle de `0x100A88`, de l'envoi à `nwm::EXT` et de l'interruption `0x5F`.
- Le déroulement de RecvDataFrame (étape 5).

**Pas lu** :
- Le protocole Wi-Fi lui-même : balises, association, sélection du canal, temporisations, envoi des trames (`SendDataFrame` `0x14` n'est lu que par son premier appel, `0x11B22C`).
- Les fonctions de rappel du pilote (`0x120048` et suivantes) et le gestionnaire de l'interruption.
- Les 12 commandes sans nom.
