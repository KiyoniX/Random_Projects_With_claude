# mvd, le décodeur vidéo matériel de la New 3DS

`mvd` (Movie Decoder, d'après le nom du service, `mvd:STD`) pilote le bloc matériel de décodage vidéo que la New 3DS ajoute à la console (il est absent de l'ancienne 3DS : le titre est `0004013020004102`, la famille `2000xx02`). Un programme lui envoie les unités de flux H.264 (les NAL) et récupère des images décodées ; le module lie les interruptions du bloc, lance des transferts DMA entre processus et vide les caches. Quatre services : `mvd:STD` (le décodeur standard), `l2b:u` et `l2b2:u` (deux services de conversion d'image que le module sert par la même fonction, d'après leur nom et leur aiguillage commun) et `y2r2:u` (une seconde version du convertisseur YUV vers RGB de `camera`).

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, module presque tout en Thumb), `outils/emulate_dispatch.py` sur les trois aiguillages (de 0 à 0xFFFF) et la Carte des services (tirée de 3dbrew). Adresses du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020004102`, un titre de la CTRNAND (New 3DS seulement) ; nom interne `mvd`, priorité 55 (`0x37`) |
| Fichier lu | `local/extrait/mvd/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x19F08` octets de code (`0x1A` pages), `0x67E8` de données en lecture seule (7 pages), `0x100` de données (1 page), `0x8CC` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 803 pour Ghidra, dont 745 en Thumb et 58 en ARM ; 110 nommées dans `mvd.noms.tsv`, aucun nom sans fonction |
| Services offerts | `mvd:STD`, `l2b:u`, `l2b2:u`, `y2r2:u`, **1 session chacun** : table (nom, nombre de sessions) à `0x11A02C`, noms à `0x11A06C`, `0x11A074`, `0x11A07A`, `0x11A081` |
| Services appelés | **aucun** : la liste de services de l'exheader est vide (le module n'appelle que `sm` pour s'enregistrer). Seule la chaîne `srv:pm` (`0x11A1FD`) est dans le module |
| Droits du noyau (exheader) | les interruptions `0x4F`, `0x4E`, `0x46` et `0x45` (décodage de l'exheader par `capdec.py`) ; pas de plage d'adresses déclarée |
| Appelants connus | `skater` (les quatre services, exheader). Pokémon X n'en ouvre aucun |

## Partie 1 : le démarrage et le serveur

`mvd_main` (`0x1001A8`, un seul fil de service) :

1. Prépare la mémoire et enregistre les quatre services auprès de `sm` (`0x100630`, en-tête de commande 3, le nombre de sessions 1 pris dans la table `0x11A02C`).
2. Prépare deux contextes de décodeur (deux structures de `0x50` octets d'écart, initialisées par `0x1103D8` avec les indices 0 et 1 : le module peut tenir deux instances du matériel, interprété), puis `0x100724` (lie les interruptions du bloc : `BindInterrupt`, `svc_bind_interrupt`, `0x110218`) et un abonnement à une notification de `sm` (`0x100578` avec `0x100`).
3. **Boucle** sur `ReplyAndReceive` (`svc_reply_and_receive`, `0x119954`) avec neuf poignées au plus : la notification, les quatre ports (rangs 1 à 4) puis les sessions (rangs 5 à 8 : **quatre sessions au plus**). Un port actif : `AcceptSession` (`svc_accept_session`, `0x119918`). Une session : l'aiguillage du service dont l'adresse est dans la table `0x11A04C` (`0x1124E9` pour `mvd:STD`, `0x111E65` pour `l2b:u` **et** `l2b2:u`, `0x11328D` pour `y2r2:u` ; adresses Thumb). Une session fermée est retirée.
4. À l'arrêt : retire les services, délie les interruptions (`svc_unbind_interrupt`, `0x11019C`).

Appels système trouvés : 0x17 CreateEvent, 0x19 ClearEvent, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x27 DuplicateHandle, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest, 0x35 GetProcessId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive, **0x50 BindInterrupt, 0x51 UnbindInterrupt, 0x52 InvalidateProcessDataCache, 0x53 StoreProcessDataCache, 0x54 FlushProcessDataCache, 0x55 StartInterProcessDma, 0x56 StopDma, 0x57 GetDmaState** (le groupe des appels de DMA et de cache n'apparaît dans aucun autre module de cette série). Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les trois aiguillages

Chaque aiguillage lit le numéro de commande dans les 16 bits du haut de l'en-tête, saute à un cas par un `switch` (Ghidra ne le reconstruit pas : `emulate_dispatch.py` l'exécute) et vérifie l'en-tête et les descripteurs. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F`.

`emulate_dispatch.py mvd 0x1124e8=mvd:STD 0x111e64=l2b:u 0x11328c=y2r2:u` :

| Service | Aiguillage | Commandes trouvées | Numéros |
| --- | --- | --- | --- |
| `mvd:STD` | `mvd_std_dispatch_command` `0x1124E8` | 33 | 1 à 0x21 |
| `l2b:u` et `l2b2:u` | `mvd_l2b_u_dispatch_command` `0x111E64` | 23 | 1 à 0x17 |
| `y2r2:u` | `mvd_y2r2_u_dispatch_command` `0x11328C` | 45 | 1 à 0x2D |

Les trois tables sont **identiques à celles de la Carte** (33, 23, 45) en nombre, en numéros et en en-têtes complets quand le code les vérifie. `l2b:u` et `l2b2:u` partagent la même fonction : la différence entre les deux services (3dbrew les distingue) n'est pas dans l'aiguillage.

## Partie 3 : les commandes

Les noms et les en-têtes de requête sont ceux de la Carte (3dbrew). « Inconnue » : la Carte n'a pas de nom. « Vérifié » : l'aiguillage compare l'en-tête de requête en entier ou le numéro seulement.

### `mvd:STD` (aiguillage `mvd_std_dispatch_command` à `0x1124e8`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010082` | Initialize | `mvd_std_cmd_0001_Initialize` | `0x112D88` | émulation | entier | `0x00010040` |
| 0x2 | `0x00020000` | Shutdown | `mvd_std_cmd_0002_Shutdown` | `0x112CBC` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030300` | CalculateWorkBufSize | `mvd_std_cmd_0003_CalculateWorkBufSize` | `0x11307C` | émulation | numéro | `0x00030080` |
| 0x4 | `0x000400C0` | CalculateImageSize | `mvd_std_cmd_0004_CalculateImageSize` | `0x1130B2` | émulation | numéro | `0x00040080` |
| 0x5 | `0x00050100` | Inconnue | `mvd_std_cmd_0005_Unknown` | `0x113150` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | Inconnue | `mvd_std_cmd_0006_Unknown` | `0x112CA8` | émulation | numéro | `0x00060040` |
| 0x7 | `0x00070000` | Inconnue | `mvd_std_cmd_0007_Unknown` | `0x112D16` | émulation | numéro | `0x00070040` |
| 0x8 | `0x00080142` | ProcessNALUnit | `mvd_std_cmd_0008_ProcessNALUnit` | `0x112C04` | émulation | entier | `0x00080100` |
| 0x9 | `0x00090042` | ControlFrameRendering | `mvd_std_cmd_0009_ControlFrameRendering` | `0x112EC0` | émulation | entier | `0x00090440` |
| 0xA | `0x000A0000` | GetStatus | `mvd_std_cmd_000A_GetStatus` | `0x112CE0` | émulation | numéro | `0x000A0440` |
| 0xB | `0x000B0000` | GetStatus | `mvd_std_cmd_000B_GetStatus` | `0x113164` | émulation | numéro | `0x000B0440` |
| 0xC | `0x000C0100` | Inconnue | `mvd_std_cmd_000C_Unknown` | `0x113118` | émulation | numéro | `0x000C0040` |
| 0xD | `0x000D0000` | Inconnue | `mvd_std_cmd_000D_Unknown` | `0x112C9C` | émulation | numéro | `0x000D0040` |
| 0xE | `0x000E0202` | Inconnue | `mvd_std_cmd_000E_Unknown` | `0x1131E0` | émulation | entier | `0x000E0080` |
| 0xF | `0x000F0042` | Inconnue | `mvd_std_cmd_000F_Unknown` | `0x112E8C` | émulation | entier | `0x000F0440` |
| 0x10 | `0x00100000` | Inconnue | `mvd_std_cmd_0010_Unknown` | `0x112C7E` | émulation | numéro | `0x001002C0` |
| 0x11 | `0x00110000` | Inconnue | `mvd_std_cmd_0011_Unknown` | `0x11313E` | émulation | numéro | `0x00110440` |
| 0x12 | `0x001200C0` | Inconnue | `mvd_std_cmd_0012_Unknown` | `0x113108` | émulation | numéro | `0x00120040` |
| 0x13 | `0x00130000` | Inconnue | `mvd_std_cmd_0013_Unknown` | `0x112C90` | émulation | numéro | `0x00130040` |
| 0x14 | `0x001400C2` | Inconnue | `mvd_std_cmd_0014_Unknown` | `0x113178` | émulation | entier | `0x00140080` |
| 0x15 | `0x00150042` | Inconnue | `mvd_std_cmd_0015_Unknown` | `0x112E58` | émulation | entier | `0x00150280` |
| 0x16 | `0x00160000` | Inconnue | `mvd_std_cmd_0016_Unknown` | `0x112C6C` | émulation | numéro | `0x00160280` |
| 0x17 | `0x00170000` | Inconnue | `mvd_std_cmd_0017_Unknown` | `0x11312C` | émulation | numéro | `0x00170280` |
| 0x18 | `0x00180000` | Inconnue | `mvd_std_cmd_0018_Unknown` | `0x1130C8` | émulation | numéro | `0x00180040` |
| 0x19 | `0x00190000` | Inconnue | `mvd_std_cmd_0019_Unknown` | `0x113248` | émulation | numéro | `0x00190040` |
| 0x1A | `0x001A0000` | Inconnue | `mvd_std_cmd_001A_Unknown` | `0x112D04` | émulation | numéro | `0x001A0040` |
| 0x1B | `0x001B0040` | Inconnue | `mvd_std_cmd_001B_Unknown` | `0x112FB4` | émulation | numéro | `0x001B0040` |
| 0x1C | `0x001C0000` | Inconnue | `mvd_std_cmd_001C_Unknown` | `0x112FCA` | émulation | numéro | `0x001C0040` |
| 0x1D | `0x001D0042` | GetConfig | `mvd_std_cmd_001D_GetConfig` | `0x112CF2` | émulation | entier | `0x001D0042` |
| 0x1E | `0x001E0044` | SetConfig | `mvd_std_cmd_001E_SetConfig` | `0x112D24` | émulation | entier | `0x001E0042` |
| 0x1F | `0x001F0902` | SetupOutputBuffers | `mvd_std_cmd_001F_SetupOutputBuffers` | `0x112EF4` | émulation | entier | `0x001F0040` |
| 0x20 | `0x00200002` | Inconnue | `mvd_std_cmd_0020_Unknown` | `0x112DE8` | émulation | entier | `0x002000C0` |
| 0x21 | `0x00210100` | OverrideOutputBuffers | `mvd_std_cmd_0021_OverrideOutputBuffers` | `0x112FE0` | émulation | numéro | `0x00210040` |

### `l2b:u` (aiguillage `mvd_l2b_u_dispatch_command` à `0x111e64`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010040` | SetInputFormat | `mvd_l2b_u_cmd_0001_SetInputFormat` | `0x112290` | émulation | numéro | `0x00010040` |
| 0x2 | `0x00020080` | GetInputFormat | `mvd_l2b_u_cmd_0002_GetInputFormat` | `0x11227C` | émulation | numéro | `0x00020080` |
| 0x3 | `0x00030040` | SetOutputFormat | `mvd_l2b_u_cmd_0003_SetOutputFormat` | `0x1122BA` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040080` | GetOutputFormat | `mvd_l2b_u_cmd_0004_GetOutputFormat` | `0x1122A4` | émulation | numéro | `0x00040080` |
| 0x5 | `0x00050040` | SetTransferEndInterrupt | `mvd_l2b_u_cmd_0005_SetTransferEndInterrupt` | `0x1124AE` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060080` | GetTransferEndInterrupt | `mvd_l2b_u_cmd_0006_GetTransferEndInterrupt` | `0x1124A4` | émulation | numéro | `0x00060080` |
| 0x7 | `0x00070080` | GetL2BEndEvent | `mvd_l2b_u_cmd_0007_GetL2BEndEvent` | `0x112444` | émulation | numéro | `0x00070042` |
| 0x8 | `0x00080102` | Inconnue | `mvd_l2b_u_cmd_0008_Unknown` | `0x11216C` | émulation | entier | `0x00080040` |
| 0x9 | `0x00090080` | Inconnue | `mvd_l2b_u_cmd_0009_Unknown` | `0x1123DE` | émulation | numéro | `0x00090080` |
| 0xA | `0x000A0102` | MaybeSetRecieving | `mvd_l2b_u_cmd_000A_MaybeSetRecieving` | `0x112242` | émulation | entier | `0x000A0040` |
| 0xB | `0x000B0080` | isDoneRecieving | `mvd_l2b_u_cmd_000B_isDoneRecieving` | `0x11244C` | émulation | numéro | `0x000B0080` |
| 0xC | `0x000C0040` | SetInputLineWidth | `mvd_l2b_u_cmd_000C_SetInputLineWidth` | `0x1123EE` | émulation | numéro | `0x000C0040` |
| 0xD | `0x000D0080` | GetInputLineWidth | `mvd_l2b_u_cmd_000D_GetInputLineWidth` | `0x1123D4` | émulation | numéro | `0x000D0080` |
| 0xE | `0x000E0040` | SetInputLines | `mvd_l2b_u_cmd_000E_SetInputLines` | `0x112272` | émulation | numéro | `0x000E0040` |
| 0xF | `0x000F0080` | GetInputLines | `mvd_l2b_u_cmd_000F_GetInputLines` | `0x112268` | émulation | numéro | `0x000F0080` |
| 0x10 | `0x00100040` | MaybeSetAlpha | `mvd_l2b_u_cmd_0010_MaybeSetAlpha` | `0x1124C2` | émulation | numéro | `0x00100040` |
| 0x11 | `0x00110080` | MaybeGetAlpha | `mvd_l2b_u_cmd_0011_MaybeGetAlpha` | `0x1124B8` | émulation | numéro | `0x00110080` |
| 0x12 | `0x00120040` | StartConversion | `mvd_l2b_u_cmd_0012_StartConversion` | `0x1122C8` | émulation | numéro | `0x00120040` |
| 0x13 | `0x00130040` | StopConversion | `mvd_l2b_u_cmd_0013_StopConversion` | `0x11229A` | émulation | numéro | `0x00130040` |
| 0x14 | `0x00140080` | isBusyConversion | `mvd_l2b_u_cmd_0014_isBusyConversion` | `0x11230C` | émulation | numéro | `0x00140080` |
| 0x15 | `0x00150040` | SetPackageParameter | `mvd_l2b_u_cmd_0015_SetPackageParameter` | `0x11245C` | émulation | numéro | `0x00150040` |
| 0x16 | `0x00160080` | GetPackageParameter | `mvd_l2b_u_cmd_0016_GetPackageParameter` | `0x1123F8` | émulation | numéro | `0x00160140` |
| 0x17 | `0x00170080` | PingProcess | `mvd_l2b_u_cmd_0017_PingProcess` | `0x112238` | émulation | numéro | `0x00170080` |

### `y2r2:u` (aiguillage `mvd_y2r2_u_dispatch_command` à `0x11328c`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010040` | SetInputFormat | `mvd_y2r2_u_cmd_0001_SetInputFormat` | `0x113BB8` | émulation | numéro | `0x00010040` |
| 0x2 | `0x00020000` | GetInputFormat | `mvd_y2r2_u_cmd_0002_GetInputFormat` | `0x113BA0` | émulation | numéro | `0x00020080` |
| 0x3 | `0x00030040` | SetOutputFormat | `mvd_y2r2_u_cmd_0003_SetOutputFormat` | `0x113BF4` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | GetOutputFormat | `mvd_y2r2_u_cmd_0004_GetOutputFormat` | `0x113BD8` | émulation | numéro | `0x00040080` |
| 0x5 | `0x00050040` | SetRotation | `mvd_y2r2_u_cmd_0005_SetRotation` | `0x1138DC` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | GetRotation | `mvd_y2r2_u_cmd_0006_GetRotation` | `0x1138B0` | émulation | numéro | `0x00060080` |
| 0x7 | `0x00070040` | SetBlockAlignment | `mvd_y2r2_u_cmd_0007_SetBlockAlignment` | `0x113D74` | émulation | numéro | `0x00070040` |
| 0x8 | `0x00080000` | GetBlockAlignment | `mvd_y2r2_u_cmd_0008_GetBlockAlignment` | `0x113D48` | émulation | numéro | `0x00080080` |
| 0x9 | `0x00090040` | SetSpacialDithering | `mvd_y2r2_u_cmd_0009_SetSpacialDithering` | `0x114044` | émulation | numéro | `0x00090040` |
| 0xA | `0x000A0000` | GetSpacialDithering | `mvd_y2r2_u_cmd_000A_GetSpacialDithering` | `0x113F98` | émulation | numéro | `0x000A0080` |
| 0xB | `0x000B0040` | SetTemporalDithering | `mvd_y2r2_u_cmd_000B_SetTemporalDithering` | `0x1140D4` | émulation | numéro | `0x000B0040` |
| 0xC | `0x000C0000` | GetTemporalDithering | `mvd_y2r2_u_cmd_000C_GetTemporalDithering` | `0x114064` | émulation | numéro | `0x000C0080` |
| 0xD | `0x000D0040` | SetTransferEndInterrupt | `mvd_y2r2_u_cmd_000D_SetTransferEndInterrupt` | `0x114104` | émulation | numéro | `0x000D0040` |
| 0xE | `0x000E0000` | GetTransferEndInterrupt | `mvd_y2r2_u_cmd_000E_GetTransferEndInterrupt` | `0x1140F4` | émulation | numéro | `0x000E0080` |
| 0xF | `0x000F0000` | GetTransferEndEvent | `mvd_y2r2_u_cmd_000F_GetTransferEndEvent` | `0x113FA8` | émulation | numéro | `0x000F0042` |
| 0x10 | `0x00100102` | SetSendingY | `mvd_y2r2_u_cmd_0010_SetSendingY` | `0x113A70` | émulation | entier | `0x00100040` |
| 0x11 | `0x00110102` | SetSendingU | `mvd_y2r2_u_cmd_0011_SetSendingU` | `0x1138F0` | émulation | entier | `0x00110040` |
| 0x12 | `0x00120102` | SetSendingV | `mvd_y2r2_u_cmd_0012_SetSendingV` | `0x1139B0` | émulation | entier | `0x00120040` |
| 0x13 | `0x00130102` | SetSendingYuv | `mvd_y2r2_u_cmd_0013_SetSendingYuv` | `0x113B78` | émulation | entier | `0x00130040` |
| 0x14 | `0x00140000` | IsFinishedSendingYuv | `mvd_y2r2_u_cmd_0014_IsFinishedSendingYuv` | `0x114074` | émulation | numéro | `0x00140080` |
| 0x15 | `0x00150000` | IsFinishedSendingY | `mvd_y2r2_u_cmd_0015_IsFinishedSendingY` | `0x113E8C` | émulation | numéro | `0x00150080` |
| 0x16 | `0x00160000` | IsFinishedSendingU | `mvd_y2r2_u_cmd_0016_IsFinishedSendingU` | `0x113E64` | émulation | numéro | `0x00160080` |
| 0x17 | `0x00170000` | IsFinishedSendingV | `mvd_y2r2_u_cmd_0017_IsFinishedSendingV` | `0x113E78` | émulation | numéro | `0x00170080` |
| 0x18 | `0x00180102` | SetReceiving | `mvd_y2r2_u_cmd_0018_SetReceiving` | `0x113B30` | émulation | entier | `0x00180040` |
| 0x19 | `0x00190000` | IsFinishedReceiving | `mvd_y2r2_u_cmd_0019_IsFinishedReceiving` | `0x113FB8` | émulation | numéro | `0x00190080` |
| 0x1A | `0x001A0040` | SetInputLineWidth | `mvd_y2r2_u_cmd_001A_SetInputLineWidth` | `0x113D88` | émulation | numéro | `0x001A0040` |
| 0x1B | `0x001B0000` | GetInputLineWidth | `mvd_y2r2_u_cmd_001B_GetInputLineWidth` | `0x113D64` | émulation | numéro | `0x001B0080` |
| 0x1C | `0x001C0040` | SetInputLines | `mvd_y2r2_u_cmd_001C_SetInputLines` | `0x113B68` | émulation | numéro | `0x001C0040` |
| 0x1D | `0x001D0000` | GetInputLines | `mvd_y2r2_u_cmd_001D_GetInputLines` | `0x113B58` | émulation | numéro | `0x001D0080` |
| 0x1E | `0x001E0100` | SetCoefficientParams | `mvd_y2r2_u_cmd_001E_SetCoefficientParams` | `0x114088` | émulation | numéro | `0x001E0040` |
| 0x1F | `0x001F0000` | GetCoefficientParams | `mvd_y2r2_u_cmd_001F_GetCoefficientParams` | `0x114054` | émulation | numéro | `0x001F0140` |
| 0x20 | `0x00200040` | SetStandardCoefficient | `mvd_y2r2_u_cmd_0020_SetStandardCoefficient` | `0x1140E4` | émulation | numéro | `0x00200040` |
| 0x21 | `0x00210040` | GetStandardCoefficientParams | `mvd_y2r2_u_cmd_0021_GetStandardCoefficientParams` | `0x11422C` | émulation | numéro | `0x00210140` |
| 0x22 | `0x00220040` | SetAlpha | `mvd_y2r2_u_cmd_0022_SetAlpha` | `0x11424C` | émulation | numéro | `0x00220040` |
| 0x23 | `0x00230000` | GetAlpha | `mvd_y2r2_u_cmd_0023_GetAlpha` | `0x11423C` | émulation | numéro | `0x00230080` |
| 0x24 | `0x00240200` | SetDitheringWeightParams | `mvd_y2r2_u_cmd_0024_SetDitheringWeightParams` | `0x11418C` | émulation | numéro | `0x00240040` |
| 0x25 | `0x00250000` | GetDitheringWeightParams | `mvd_y2r2_u_cmd_0025_GetDitheringWeightParams` | `0x114114` | émulation | numéro | `0x00250240` |
| 0x26 | `0x00260000` | StartConversion | `mvd_y2r2_u_cmd_0026_StartConversion` | `0x113C04` | émulation | numéro | `0x00260040` |
| 0x27 | `0x00270000` | StopConversion | `mvd_y2r2_u_cmd_0027_StopConversion` | `0x113BC8` | émulation | numéro | `0x00270040` |
| 0x28 | `0x00280000` | IsBusyConversion | `mvd_y2r2_u_cmd_0028_IsBusyConversion` | `0x113C8C` | émulation | numéro | `0x00280080` |
| 0x29 | `0x002901C0` | SetPackageParameter | `mvd_y2r2_u_cmd_0029_SetPackageParameter` | `0x113FCC` | émulation | numéro | `0x00290040` |
| 0x2A | `0x002A0000` | PingProcess | `mvd_y2r2_u_cmd_002A_PingProcess` | `0x1138CC` | émulation | numéro | `0x002A0080` |
| 0x2B | `0x002B0000` | DriverInitialize | `mvd_y2r2_u_cmd_002B_DriverInitialize` | `0x113C68` | émulation | numéro | `0x002B0040` |
| 0x2C | `0x002C0000` | DriverFinalize | `mvd_y2r2_u_cmd_002C_DriverFinalize` | `0x10FEF0` | émulation | numéro | `0x002C0040` |
| 0x2D | `0x002D0000` | GetPackageParameter | `mvd_y2r2_u_cmd_002D_GetPackageParameter` | `0x113EA0` | émulation | numéro | `0x002D0200` |


Notes :

- Sur les 33 commandes de `mvd:STD`, la Carte en nomme 12 (Initialize, Shutdown, CalculateWorkBufSize, CalculateImageSize, ProcessNALUnit, ControlFrameRendering, GetStatus deux fois, GetConfig, SetConfig, SetupOutputBuffers, OverrideOutputBuffers) ; les 21 autres n'ont pas de nom. `l2b:u` n'a aucun nom ; `y2r2:u` reprend les noms de `y2r:u` de `camera`.
- `y2r2:u` : la Carte lui donne les mêmes noms qu'à `y2r:u` (`SetInputFormat` 1, `GetInputFormat` 2... comme dans `fiches/camera.md`), mais ses gestionnaires sont ceux de `mvd`, aux adresses ci-dessus : le convertisseur de la New 3DS est piloté par `mvd`, pas par `camera`.

## Partie 4 : une opération pas à pas, ProcessNALUnit

`mvd:STD`, commande 8 (3dbrew : ProcessNALUnit, `0x00080142`, réponse `0x00080100`) : le client envoie une unité de flux H.264 à décoder. Lu dans `mvd_std_cmd_0008_ProcessNALUnit` (`0x112C04`), les rôles sont interprétés.

1. L'aiguillage `0x1124E8` lit le numéro 8, vérifie l'en-tête en entier (`0x00080142` : 5 mots ordinaires, 1 descripteur) et appelle le gestionnaire.
2. Le gestionnaire vide le cache de la zone de données du client (`0x10B80C`).
3. Il alloue un tampon de la taille de l'unité (`0x10F82C`) ; s'il n'y en a pas, il rend un code d'erreur (constante `DAT_00112C68`).
4. Il copie l'unité dans ce tampon (`0x10F474`), la donne au décodeur (`0x102F2C`, qui pilote le bloc matériel : dépôt dans la file d'entrée, démarrage), puis libère le tampon (`0x10F500`).
5. Il vide encore le cache (`0x10B80C`) et rend le résultat du décodeur converti en code de retour (`0x10B608`).
6. L'aiguillage répond `0x00080100`.

`Initialize` (commande 1, `0x112D88`) suit le même style : si l'indicateur d'état est déjà levé il rend une erreur (« déjà initialisé »), sinon il vide le cache sur la zone partagée du client, prépare le tampon de travail (`0x114350`) et lève l'indicateur.

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x11A02C` | table des services : quatre paires (nom, nombre de sessions 1) : `mvd:STD`, `l2b:u`, `l2b2:u`, `y2r2:u` |
| `0x11A04C` | table des aiguillages : `0x1124E9`, `0x111E65`, `0x111E65`, `0x11328D` (adresses Thumb) |
| `0x11A06C` à `0x11A081` | les quatre noms |
| `0x11A1FD` | la chaîne `srv:pm` (liste de la bibliothèque) |
| `0x11CCB8` à `0x11D1AA` | des tables d'octets de quantification et de balayage (le décodeur) : lues comme données, non interprétées |
| `0x121000` | les données du module (`0x100` octets) |

## Partie 6 : ce que Pokémon X envoie

Rien : le jeu n'ouvre aucun service de `mvd` (le module n'existe que sur la New 3DS). Pour le portage PC, `mvd` n'a rien à rendre à la place de la console.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les trois tables de commandes : 33, 23 et 45. Voie 1 : l'émulation des trois aiguillages. Voie 2 : la Carte des services (3dbrew) : mêmes numéros et mêmes en-têtes pour toutes les commandes dont le code vérifie l'en-tête en entier.
- Les quatre services, leurs nombres de sessions (1), le partage de l'aiguillage entre `l2b:u` et `l2b2:u`, l'absence de service appelé, les appels système de DMA, de cache et d'interruption.

**Interprété** :
- Les noms (de la Carte ; 21 commandes sur 33 de `mvd:STD` n'en ont pas).
- Le sens des deux contextes de décodeur, de l'indicateur d'initialisation et des étapes de ProcessNALUnit (le rôle des fonctions `0x10B80C`, `0x10F82C`, `0x102F2C`).
- Que `l2b:u` et `l2b2:u` sont deux services de conversion d'image (rien dans le module ne le dit).

**Pas lu** :
- Le décodeur lui-même : la programmation du bloc matériel, la file d'entrée, les interruptions, la sortie des images (`GetStatus`, `ControlFrameRendering`).
- Le convertisseur `y2r2` et `l2b` : leurs registres et leurs transferts.
- La partie « Initialize » au-delà des premiers appels, et les tables de quantification.
