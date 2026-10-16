# nfc, la communication en champ proche (amiibo)

`nfc` pilote la puce NFC de la New 3DS (titre `0004013020004002`, famille `2000xx02` : l'ancienne 3DS n'a pas ce module) : elle lit et écrit les figurines amiibo et les cartes à puce, et gère la zone de données d'application que les jeux y rangent. La puce est sur un bus I2C (`i2c::NFC`) avec des lignes GPIO (`gpio:NFC`). Six services, un par usage : `nfc:u` (les applications : amiibo), `nfc:m` (le gestionnaire : réglages, administration d'une figurine), `nfc:p` (réservé à l'application de réglages, usage non lu), `nfc:s` (le système), `nfc:r` et `nfc:dev` (accès brut à la puce).

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, module presque tout en Thumb), `outils/emulate_dispatch.py` sur les six aiguillages (de 0 à 0xFFFF) et la Carte des services (tirée de 3dbrew). Adresses du module chargé à `0x00100000`. **Aucune clé n'est reproduite** : le module contient les constantes de dérivation de clés des figurines (deux étiquettes de texte à `0x135584` et `0x1355B0`, et des tables de nombres dans la zone de données) ; la fiche dit où elles sont, pas leur valeur.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020004002`, un titre de la CTRNAND (New 3DS seulement) ; nom interne `nfc`, priorité 54 (`0x36`) |
| Fichier lu | `local/extrait/nfc/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x34A64` octets de code (`0x35` pages), `0x41E0` de données en lecture seule (5 pages), `0x149C` de données (2 pages), `0x2CC00` de mémoire à zéro, pile de `0x8000` |
| Fonctions | 2 389 pour Ghidra, dont 2 316 en Thumb et 73 en ARM ; 197 nommées dans `nfc.noms.tsv`, aucun nom sans fonction |
| Services offerts | `nfc:u`, `nfc:r`, `nfc:p`, `nfc:s`, `nfc:dev`, `nfc:m`, **1 session chacun** : table (nom, nombre de sessions) à `0x13527C`, noms de `0x1352C4` à `0x1352E2` |
| Services appelés | lus dans l'exheader : `cfg:s`, `fs:USER`, `gpio:NFC`, `hid:NFC`, `i2c::NFC`, `nwm::EXT`, `ps:ps`, `ptm:s`. Dans le code, des chaînes pour `i2c::NFC` (`0x135000`), `gpio:NFC` (`0x135009`), `ps:ps` (`0x135560`), `fs:LDR` et `fs:USER` (`0x1360C0`), `nwm::EXT` (`0x1360F0`), `srv:pm` |
| Droits du noyau (exheader) | pas d'interruption, pas de plage d'adresses (la puce est derrière I2C) |
| Appelants connus | `nfc:m` : `cabinet` ; `nfc:p` : `mint` (exheaders) ; `nfc:u`, `nfc:s`, `nfc:r`, `nfc:dev` : aucun exheader extrait. Pokémon X n'ouvre aucun des six |
| Fichier de `data:` | `nfp_backup.dat` (`0x13522E`), format de chemin `%s/%s` (`0x135240`) |

## Partie 1 : le démarrage et le serveur

`nfc_main` (`0x10017C`, un seul fil de service) :

1. Enregistre les six services (`0x1009A4`, en-tête de commande 3) d'après la table `0x13527C` : dans l'ordre `nfc:u`, `nfc:r`, `nfc:p`, `nfc:s`, `nfc:dev`, `nfc:m`, 1 session chacun.
2. Prépare les composants (`0x100870`, `0x11DC0C`, non lus) et s'abonne à des notifications de `sm`.
3. **Boucle** sur `ReplyAndReceive` (`svc_reply_and_receive`, `0x133A10`) avec la notification, les six ports et les sessions. Un port actif : `AcceptSession` (`svc_accept_session`, `0x1339D4`). Une session : `handler_table[service](session)` avec la table de six adresses à `0x1352AC` : `0x12954D` (`nfc:u`), `0x129EA1` (`nfc:r`), `0x12C1ED` (`nfc:p`), `0x12AE01` (`nfc:s`), `0x129AF5` (`nfc:dev`), `0x12A469` (`nfc:m`) ; adresses Thumb.

L'ordre des aiguillages est celui de la table des services. Il est confirmé pour trois services par les nombres de commandes de la Carte : `nfc:u` 33 (34 dans le code), `nfc:p` 19 (19) et `nfc:m` 45 (55, un sur-ensemble de `nfc:u`).

Appels système trouvés : 0x13 CreateMutex, 0x14 ReleaseMutex, 0x17 CreateEvent, 0x18 SignalEvent, 0x19 ClearEvent, 0x1F MapMemoryBlock, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x25 WaitSynchronizationN, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest, 0x35 GetProcessId, et les appels de service (`AcceptSession` `0x1339D4`, `ReplyAndReceive` `0x133A10`) : ni interruption ni DMA. Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les six aiguillages

Chaque aiguillage lit le numéro de commande dans les 16 bits du haut de l'en-tête (`bitfield_extract`, `0x113B78`), saute à un cas par un `switch` (Ghidra ne le reconstruit pas : `emulate_dispatch.py` l'exécute) et vérifie l'en-tête et les descripteurs. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F`. (La fonction `0x12AE00` paraît faire 54 octets dans la liste de Ghidra : son `switch` à 70 cas est hors de sa taille, voir `outils/REA.md`.)

`emulate_dispatch.py nfc 0x12954c=nfc:u 0x129ea0=nfc:r 0x12c1ec=nfc:p 0x12ae00=nfc:s 0x129af4=nfc:dev 0x12a468=nfc:m` :

| Service | Aiguillage | Commandes trouvées | Carte | Numéros |
| --- | --- | --- | --- | --- |
| `nfc:u` | `0x12954C` | 34 | 33 | 1 à 0x22 |
| `nfc:r` | `0x129EA0` | 26 | aucune | 1 à 0x1A |
| `nfc:p` | `0x12C1EC` | 19 | 19 | 1 à 0x13 |
| `nfc:s` | `0x12AE00` | 69 | 3 | 1 à 0x45, sans trou |
| `nfc:dev` | `0x129AF4` | 19 | 2 | 1 à 0x13 |
| `nfc:m` | `0x12A468` | 55 | 45 | les 34 de `nfc:u` plus `0x401` à `0x415` (21) |

**`nfc:m` contient `nfc:u`**, aux mêmes adresses (`0x113B24` pour `Initialize`, etc.), avec 21 commandes de plus, `0x401` à `0x415` (l'administration d'une figurine : `GetAdminInfo`, `GetEmptyRegisterInfo`, `SetRegisterInfo`, `DeleteRegisterInfo`, `DeleteApplicationArea`, `ExistsApplicationArea`...). La Carte compte 45 pour `nfc:m` ; le code en a 10 de plus, dont `0x0E` (aussi dans `nfc:u`, absente de la Carte), `0x409`, `0x40A`, `0x40B`, `0x410` à `0x415`.

## Partie 3 : les commandes

Les noms et les en-têtes sont ceux de la Carte (3dbrew). « Inconnue » : la Carte n'a pas de nom ; `?` : la commande n'est pas dans la Carte. « Source » : d'où vient l'adresse du gestionnaire. « Vérifié » : l'aiguillage compare l'en-tête de requête en entier ou le numéro seulement.

### `nfc:u` (aiguillage `nfc_u_dispatch_command` à `0x12954c`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010040` | Initialize | `nfc_cmd_0001_Initialize` | `0x113B24` | émulation | numéro | `0x00010040` |
| 0x2 | `0x00020040` | Shutdown | `nfc_cmd_0002_Shutdown` | `0x121488` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030000` | StartCommunication | `nfc_cmd_0003_StartCommunication` | `0x1213EC` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | StopCommunication | `nfc_cmd_0004_StopCommunication` | `0x113B00` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050040` | StartTagScanning | `nfc_cmd_0005_StartTagScanning` | `0x113AC0` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | StopTagScanning | `nfc_cmd_0006_StopTagScanning` | `0x113A80` | émulation | numéro | `0x00060040` |
| 0x7 | `0x00070000` | LoadAmiiboData | `nfc_cmd_0007_LoadAmiiboData` | `0x1213BC` | émulation | numéro | `0x00070040` |
| 0x8 | `0x00080000` | ResetTagScanState | `nfc_cmd_0008_ResetTagScanState` | `0x121458` | émulation | numéro | `0x00080040` |
| 0x9 | `0x00090002` | UpdateStoredAmiiboData | `nfc_cmd_0009_UpdateStoredAmiiboData` | `0x121388` | émulation | entier | `0x00090040` |
| 0xA | `0x000A0000` | Inconnue | `nfc_cmd_000A_Unknown` | `0x121428` | émulation | numéro | `0x000A0040` |
| 0xB | `0x000B0000` | GetTagInRangeEvent | `nfc_cmd_000B_GetTagInRangeEvent` | `0x113A24` | émulation | numéro | `0x000B0042` |
| 0xC | `0x000C0000` | GetTagOutOfRangeEvent | `nfc_cmd_000C_GetTagOutOfRangeEvent` | `0x1139FC` | émulation | numéro | `0x000C0042` |
| 0xD | `0x000D0000` | GetTagState | `nfc_cmd_000D_GetTagState` | `0x121524` | émulation | numéro | `0x000D0080` |
| 0xE | `` | (absente de la Carte) | `nfc_cmd_000E_Unknown` | `0x1139D8` | émulation | numéro | `0x000E0080` |
| 0xF | `0x000F0000` | CommunicationGetStatus | `nfc_cmd_000F_CommunicationGetStatus` | `0x121314` | émulation | numéro | `0x000F0080` |
| 0x10 | `0x00100000` | GetTagInfo2 | `nfc_cmd_0010_GetTagInfo2` | `0x11396C` | émulation | numéro | `0x00100640` |
| 0x11 | `0x00110000` | GetTagInfo | `nfc_cmd_0011_GetTagInfo` | `0x113944` | émulation | numéro | `0x00110300` |
| 0x12 | `0x00120000` | CommunicationGetResult | `nfc_cmd_0012_CommunicationGetResult` | `0x11391C` | émulation | numéro | `0x00120080` |
| 0x13 | `0x00130040` | OpenAppData | `nfc_cmd_0013_OpenAppData` | `0x1138F8` | émulation | numéro | `0x00130040` |
| 0x14 | `0x00140384` | InitializeWriteAppData | `nfc_cmd_0014_InitializeWriteAppData` | `0x113878` | émulation | entier | `0x00140040` |
| 0x15 | `0x00150040` | ReadAppData | `nfc_cmd_0015_ReadAppData` | `0x113850` | émulation | numéro | `0x00150042` |
| 0x16 | `0x00160242` | WriteAppData | `nfc_cmd_0016_WriteAppData` | `0x113824` | émulation | entier | `0x00160040` |
| 0x17 | `0x00170000` | GetRegisterInfo | `nfc_cmd_0017_GetRegisterInfo` | `0x113800` | émulation | numéro | `0x00170AC0` |
| 0x18 | `0x00180000` | GetCommonInfo | `nfc_cmd_0018_GetCommonInfo` | `0x1137DC` | émulation | numéro | `0x00180440` |
| 0x19 | `0x00190000` | GetAppDataInitStruct | `nfc_cmd_0019_GetAppDataInitStruct` | `0x1137B8` | émulation | numéro | `0x00190400` |
| 0x1A | `0x001A0000` | Inconnue | `nfc_cmd_001A_Unknown` | `0x1214DC` | émulation | numéro | `0x001A0040` |
| 0x1B | `0x001B0000` | GetModelInfo | `nfc_cmd_001B_GetModelInfo` | `0x113794` | émulation | numéro | `0x001B03C0` |
| 0x1C | `0x001C0040` | Inconnue | `nfc_cmd_001C_Unknown` | `0x121338` | émulation | numéro | `0x001C0040` |
| 0x1D | `0x001D0040` | Inconnue | `nfc_cmd_001D_Unknown` | `0x113770` | émulation | numéro | `0x001D0040` |
| 0x1E | `0x001E0040` | Inconnue | `nfc_cmd_001E_Unknown` | `0x1212EC` | émulation | numéro | `0x001E0080` |
| 0x1F | `0x001F0080` | StartOtherTagScanning | `nfc_cmd_001F_StartOtherTagScanning` | `0x12135C` | émulation | numéro | `0x001F0040` |
| 0x20 | `0x00200102` | SendTagCommand | `nfc_cmd_0020_SendTagCommand` | `0x113734` | émulation | entier | `0x00200082` |
| 0x21 | `0x00210000` | Inconnue | `nfc_cmd_0021_Unknown` | `0x113714` | émulation | numéro | `0x00210040` |
| 0x22 | `0x00220000` | Inconnue | `nfc_cmd_0022_Unknown` | `0x1136F4` | émulation | numéro | `0x00220040` |

### `nfc:r` (aiguillage `nfc_r_dispatch_command` à `0x129ea0`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `` | (absente de la Carte) | `nfc_r_cmd_0001_Unknown` | `0x1227CA` | émulation | numéro | `0x00010040` |
| 0x2 | `` | (absente de la Carte) | `nfc_r_cmd_0002_Unknown` | `0x1229C0` | émulation | numéro | `0x00020040` |
| 0x3 | `` | (absente de la Carte) | `nfc_r_cmd_0003_Unknown` | `0x122868` | émulation | numéro | `0x00030040` |
| 0x4 | `` | (absente de la Carte) | `nfc_r_cmd_0004_Unknown` | `0x1227F6` | émulation | numéro | `0x00040040` |
| 0x5 | `` | (absente de la Carte) | `nfc_r_cmd_0005_Unknown` | `0x12298A` | émulation | numéro | `0x00050042` |
| 0x6 | `` | (absente de la Carte) | `nfc_r_cmd_0006_Unknown` | `0x122810` | émulation | numéro | `0x00060042` |
| 0x7 | `` | (absente de la Carte) | `nfc_r_cmd_0007_Unknown` | `0x12295E` | émulation | numéro | `0x00070042` |
| 0x8 | `` | (absente de la Carte) | `nfc_r_cmd_0008_Unknown` | `0x12282C` | émulation | numéro | `0x00080042` |
| 0x9 | `` | (absente de la Carte) | `nfc_r_cmd_0009_Unknown` | `0x122848` | émulation | numéro | `0x00090042` |
| 0xA | `0x000A0042` | (absente de la Carte) | `nfc_r_cmd_000A_Unknown` | `0x1229AC` | émulation | entier | `0x000A0040` |
| 0xB | `0x000B00C2` | (absente de la Carte) | `nfc_r_cmd_000B_Unknown` | `0x1228C0` | émulation | entier | `0x000B0040` |
| 0xC | `0x000C00C2` | (absente de la Carte) | `nfc_r_cmd_000C_Unknown` | `0x1228DC` | émulation | entier | `0x000C0040` |
| 0xD | `0x000D0142` | (absente de la Carte) | `nfc_r_cmd_000D_Unknown` | `0x1228F8` | émulation | entier | `0x000D0040` |
| 0xE | `` | (absente de la Carte) | `nfc_r_cmd_000E_Unknown` | `0x1228B0` | émulation | numéro | `0x000E0300` |
| 0xF | `` | (absente de la Carte) | `nfc_r_cmd_000F_Unknown` | `0x1229DA` | émulation | numéro | `0x000F0040` |
| 0x10 | `0x00100184` | (absente de la Carte) | `nfc_r_cmd_0010_Unknown` | `0x122918` | émulation | entier | `0x00100040` |
| 0x11 | `` | (absente de la Carte) | `nfc_r_cmd_0011_Unknown` | `0x122890` | émulation | numéro | `0x00110040` |
| 0x12 | `` | (absente de la Carte) | `nfc_r_cmd_0012_Unknown` | `0x122878` | émulation | numéro | `0x00120082` |
| 0x13 | `` | (absente de la Carte) | `nfc_r_cmd_0013_Unknown` | `0x1229E6` | émulation | numéro | `0x00130080` |
| 0x14 | `` | (absente de la Carte) | `nfc_r_cmd_0014_Unknown` | `0x122940` | émulation | numéro | `0x00140042` |
| 0x15 | `` | (absente de la Carte) | `nfc_r_cmd_0015_Unknown` | `0x12297A` | émulation | numéro | `0x00150042` |
| 0x16 | `` | (absente de la Carte) | `nfc_r_cmd_0016_Unknown` | `0x1227E6` | émulation | numéro | `0x00160042` |
| 0x17 | `` | (absente de la Carte) | `nfc_r_cmd_0017_Unknown` | `0x1227D6` | émulation | numéro | `0x00170080` |
| 0x18 | `` | (absente de la Carte) | `nfc_r_cmd_0018_Unknown` | `0x1229F8` | émulation | numéro | `0x00180080` |
| 0x19 | `` | (absente de la Carte) | `nfc_r_cmd_0019_Unknown` | `0x12289C` | émulation | numéro | `0x001902C0` |
| 0x1A | `` | (absente de la Carte) | `nfc_r_cmd_001A_Unknown` | `0x122A08` | émulation | numéro | `0x001A0040` |

### `nfc:p` (aiguillage `nfc_p_dispatch_command` à `0x12c1ec`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010000` | Initialize | `nfc_p_cmd_0001_Initialize` | `0x128CF8` | émulation | numéro | `0x00010040` |
| 0x2 | `0x00020000` | Shutdown | `nfc_p_cmd_0002_Shutdown` | `0x128E4E` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030080` | Inconnue | `nfc_p_cmd_0003_Unknown` | `0x128E16` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | Inconnue | `nfc_p_cmd_0004_Unknown` | `0x128E2A` | émulation | numéro | `0x00040040` |
| 0x5 | `0x000500C2` | SendTagCommand | `nfc_p_cmd_0005_SendTagCommand` | `0x128D14` | émulation | entier | `0x00050082` |
| 0x6 | `0x00060000` | GetTagInfo | `nfc_p_cmd_0006_GetTagInfo` | `0x128D34` | émulation | numéro | `0x00060300` |
| 0x7 | `0x00070000` | GetTagState | `nfc_p_cmd_0007_GetTagState` | `0x128E68` | émulation | numéro | `0x00070080` |
| 0x8 | `0x00080000` | Inconnue | `nfc_p_cmd_0008_Unknown` | `0x128D7E` | émulation | numéro | `0x00080042` |
| 0x9 | `0x00090000` | Inconnue | `nfc_p_cmd_0009_Unknown` | `0x128DA6` | émulation | numéro | `0x00090042` |
| 0xA | `0x000A0000` | Inconnue | `nfc_p_cmd_000A_Unknown` | `0x128D04` | émulation | numéro | `0x000A0080` |
| 0xB | `0x000B0000` | Inconnue | `nfc_p_cmd_000B_Unknown` | `0x128DB6` | émulation | numéro | `0x000B0340` |
| 0xC | `0x000C0040` | Inconnue | `nfc_p_cmd_000C_Unknown` | `0x128DEE` | émulation | numéro | `0x000C0042` |
| 0xD | `0x000D0040` | Inconnue | `nfc_p_cmd_000D_Unknown` | `0x128E02` | émulation | numéro | `0x000D0042` |
| 0xE | `0x000E0080` | Inconnue | `nfc_p_cmd_000E_Unknown` | `0x128D66` | émulation | numéro | `0x000E0042` |
| 0xF | `0x000F0040` | Inconnue | `nfc_p_cmd_000F_Unknown` | `0x128D52` | émulation | numéro | `0x000F0042` |
| 0x10 | `0x00100000` | Inconnue | `nfc_p_cmd_0010_Unknown` | `0x128E36` | émulation | numéro | `0x00100040` |
| 0x11 | `0x00110000` | Inconnue | `nfc_p_cmd_0011_Unknown` | `0x128CEE` | émulation | numéro | `0x00110040` |
| 0x12 | `0x00120000` | Inconnue | `nfc_p_cmd_0012_Unknown` | `0x128DE4` | émulation | numéro | `0x00120080` |
| 0x13 | `0x00130000` | Inconnue | `nfc_p_cmd_0013_Unknown` | `0x128D8E` | émulation | numéro | `0x00130080` |

### `nfc:s` (aiguillage `nfc_s_dispatch_command` à `0x12ae00`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `` | (absente de la Carte) | `nfc_s_cmd_0001_Unknown` | `0x124DBC` | émulation | numéro | `0x00010042` |
| 0x2 | `` | (absente de la Carte) | `nfc_s_cmd_0002_Unknown` | `0x12543C` | émulation | numéro | `0x00020042` |
| 0x3 | `` | (absente de la Carte) | `nfc_s_cmd_0003_Unknown` | `0x1253FE` | émulation | numéro | `0x00030082` |
| 0x4 | `` | (absente de la Carte) | `nfc_s_cmd_0004_Unknown` | `0x125420` | émulation | numéro | `0x00040042` |
| 0x5 | `` | (absente de la Carte) | `nfc_s_cmd_0005_Unknown` | `0x1251A2` | émulation | numéro | `0x00050042` |
| 0x6 | `` | (absente de la Carte) | `nfc_s_cmd_0006_Unknown` | `0x12514C` | émulation | numéro | `0x00060042` |
| 0x7 | `` | (absente de la Carte) | `nfc_s_cmd_0007_Unknown` | `0x124EF0` | émulation | numéro | `0x00070044` |
| 0x8 | `0x000800C2` | (absente de la Carte) | `nfc_s_cmd_0008_Unknown` | `0x124F5A` | émulation | entier | `0x00080042` |
| 0x9 | `` | (absente de la Carte) | `nfc_s_cmd_0009_Unknown` | `0x124E44` | émulation | numéro | `0x00090042` |
| 0xA | `` | (absente de la Carte) | `nfc_s_cmd_000A_Unknown` | `0x124FF8` | émulation | numéro | `0x000A0042` |
| 0xB | `` | (absente de la Carte) | `nfc_s_cmd_000B_Unknown` | `0x125234` | émulation | numéro | `0x000B0044` |
| 0xC | `` | (absente de la Carte) | `nfc_s_cmd_000C_Unknown` | `0x125104` | émulation | numéro | `0x000C0040` |
| 0xD | `` | (absente de la Carte) | `nfc_s_cmd_000D_Unknown` | `0x125314` | émulation | numéro | `0x000D0042` |
| 0xE | `` | (absente de la Carte) | `nfc_s_cmd_000E_Unknown` | `0x1252FC` | émulation | numéro | `0x000E0042` |
| 0xF | `` | (absente de la Carte) | `nfc_s_cmd_000F_Unknown` | `0x124FB4` | émulation | numéro | `0x000F0040` |
| 0x10 | `` | (absente de la Carte) | `nfc_s_cmd_0010_Unknown` | `0x125386` | émulation | numéro | `0x00100040` |
| 0x11 | `` | (absente de la Carte) | `nfc_s_cmd_0011_Unknown` | `0x125376` | émulation | numéro | `0x00110040` |
| 0x12 | `` | (absente de la Carte) | `nfc_s_cmd_0012_Unknown` | `0x1252AA` | émulation | numéro | `0x00120044` |
| 0x13 | `0x00130102` | SendTagCommand | `nfc_s_cmd_0013_SendTagCommand` | `0x125286` | émulation | entier | `0x00130082` |
| 0x14 | `` | (absente de la Carte) | `nfc_s_cmd_0014_Unknown` | `0x12526E` | émulation | numéro | `0x00140042` |
| 0x15 | `` | (absente de la Carte) | `nfc_s_cmd_0015_Unknown` | `0x12532C` | émulation | numéro | `0x00150040` |
| 0x16 | `` | (absente de la Carte) | `nfc_s_cmd_0016_Unknown` | `0x1251FC` | émulation | numéro | `0x00160042` |
| 0x17 | `0x00170082` | (absente de la Carte) | `nfc_s_cmd_0017_Unknown` | `0x124ED8` | émulation | entier | `0x00170040` |
| 0x18 | `` | (absente de la Carte) | `nfc_s_cmd_0018_Unknown` | `0x124F4A` | émulation | numéro | `0x00180040` |
| 0x19 | `` | (absente de la Carte) | `nfc_s_cmd_0019_Unknown` | `0x12504C` | émulation | numéro | `0x00190042` |
| 0x1A | `` | (absente de la Carte) | `nfc_s_cmd_001A_Unknown` | `0x125094` | émulation | numéro | `0x001A0040` |
| 0x1B | `` | (absente de la Carte) | `nfc_s_cmd_001B_Unknown` | `0x125084` | émulation | numéro | `0x001B0040` |
| 0x1C | `` | (absente de la Carte) | `nfc_s_cmd_001C_Unknown` | `0x124FD4` | émulation | numéro | `0x001C0042` |
| 0x1D | `` | (absente de la Carte) | `nfc_s_cmd_001D_Unknown` | `0x1251BE` | émulation | numéro | `0x001D0042` |
| 0x1E | `` | (absente de la Carte) | `nfc_s_cmd_001E_Unknown` | `0x125256` | émulation | numéro | `0x001E0042` |
| 0x1F | `` | (absente de la Carte) | `nfc_s_cmd_001F_Unknown` | `0x1252E4` | émulation | numéro | `0x001F0042` |
| 0x20 | `` | (absente de la Carte) | `nfc_s_cmd_0020_Unknown` | `0x124E34` | émulation | numéro | `0x00200040` |
| 0x21 | `` | (absente de la Carte) | `nfc_s_cmd_0021_Unknown` | `0x124E08` | émulation | numéro | `0x00210040` |
| 0x22 | `` | (absente de la Carte) | `nfc_s_cmd_0022_Unknown` | `0x1250E4` | émulation | numéro | `0x00220040` |
| 0x23 | `0x00230000` | Inconnue | `nfc_s_cmd_0023_Unknown` | `0x124FEC` | émulation | numéro | `0x00230040` |
| 0x24 | `0x00240000` | Inconnue | `nfc_s_cmd_0024_Unknown` | `0x124FA8` | émulation | numéro | `0x00240040` |
| 0x25 | `` | (absente de la Carte) | `nfc_s_cmd_0025_Unknown` | `0x125064` | émulation | numéro | `0x00250042` |
| 0x26 | `` | (absente de la Carte) | `nfc_s_cmd_0026_Unknown` | `0x1251D6` | émulation | numéro | `0x00260042` |
| 0x27 | `` | (absente de la Carte) | `nfc_s_cmd_0027_Unknown` | `0x124F7C` | émulation | numéro | `0x00270042` |
| 0x28 | `` | (absente de la Carte) | `nfc_s_cmd_0028_Unknown` | `0x124F12` | émulation | numéro | `0x00280042` |
| 0x29 | `` | (absente de la Carte) | `nfc_s_cmd_0029_Unknown` | `0x12539A` | émulation | numéro | `0x00290042` |
| 0x2A | `` | (absente de la Carte) | `nfc_s_cmd_002A_Unknown` | `0x12535E` | émulation | numéro | `0x002A0042` |
| 0x2B | `0x002B00C2` | (absente de la Carte) | `nfc_s_cmd_002B_Unknown` | `0x125180` | émulation | entier | `0x002B0042` |
| 0x2C | `` | (absente de la Carte) | `nfc_s_cmd_002C_Unknown` | `0x125010` | émulation | numéro | `0x002C0044` |
| 0x2D | `` | (absente de la Carte) | `nfc_s_cmd_002D_Unknown` | `0x124F2A` | émulation | numéro | `0x002D0044` |
| 0x2E | `0x002E0102` | (absente de la Carte) | `nfc_s_cmd_002E_Unknown` | `0x1250A4` | émulation | entier | `0x002E0042` |
| 0x2F | `` | (absente de la Carte) | `nfc_s_cmd_002F_Unknown` | `0x125030` | émulation | numéro | `0x002F0042` |
| 0x30 | `0x00300102` | (absente de la Carte) | `nfc_s_cmd_0030_Unknown` | `0x1250C4` | émulation | entier | `0x00300042` |
| 0x31 | `` | (absente de la Carte) | `nfc_s_cmd_0031_Unknown` | `0x124E14` | émulation | numéro | `0x00310042` |
| 0x32 | `0x00320182` | (absente de la Carte) | `nfc_s_cmd_0032_Unknown` | `0x124E5C` | émulation | entier | `0x00320042` |
| 0x33 | `0x00330184` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x34 | `` | (absente de la Carte) | `nfc_s_cmd_0034_Unknown` | `0x124DD0` | émulation | numéro | `0x00340040` |
| 0x35 | `` | (absente de la Carte) | `nfc_s_cmd_0035_Unknown` | `0x125118` | émulation | numéro | `0x00350082` |
| 0x36 | `0x003600C2` | (absente de la Carte) | `nfc_s_cmd_0036_Unknown` | `0x1253B2` | émulation | entier | `0x00360040` |
| 0x37 | `0x00370104` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x38 | `` | (absente de la Carte) | `nfc_s_cmd_0038_Unknown` | `0x124EAC` | émulation | numéro | `0x00380040` |
| 0x39 | `` | (absente de la Carte) | `nfc_s_cmd_0039_Unknown` | `0x1253CE` | émulation | numéro | `0x00390042` |
| 0x3A | `` | (absente de la Carte) | `nfc_s_cmd_003A_Unknown` | `0x1253E6` | émulation | numéro | `0x003A0042` |
| 0x3B | `` | (absente de la Carte) | `nfc_s_cmd_003B_Unknown` | `0x125164` | émulation | numéro | `0x003B0042` |
| 0x3C | `` | (absente de la Carte) | `nfc_s_cmd_003C_Unknown` | `0x125134` | émulation | numéro | `0x003C0042` |
| 0x3D | `` | (absente de la Carte) | `nfc_s_cmd_003D_Unknown` | `0x12533C` | émulation | numéro | `0x003D0042` |
| 0x3E | `0x003E0002` | (absente de la Carte) | `nfc_s_cmd_003E_Unknown` | `0x124FC4` | émulation | entier | `0x003E0040` |
| 0x3F | `` | (absente de la Carte) | `nfc_s_cmd_003F_Unknown` | `0x1252CC` | émulation | numéro | `0x003F0042` |
| 0x40 | `` | (absente de la Carte) | `nfc_s_cmd_0040_Unknown` | `0x12521C` | émulation | numéro | `0x00400042` |
| 0x41 | `` | (absente de la Carte) | `nfc_s_cmd_0041_Unknown` | `0x124E94` | émulation | numéro | `0x00410042` |
| 0x42 | `` | (absente de la Carte) | `nfc_s_cmd_0042_Unknown` | `0x124E84` | émulation | numéro | `0x00420042` |
| 0x43 | `` | (absente de la Carte) | `nfc_s_cmd_0043_Unknown` | `0x124F98` | émulation | numéro | `0x00430042` |
| 0x44 | `` | (absente de la Carte) | `nfc_s_cmd_0044_Unknown` | `0x1250F4` | émulation | numéro | `0x00440042` |
| 0x45 | `` | (absente de la Carte) | `nfc_s_cmd_0045_Unknown` | `0x124EC8` | émulation | numéro | `0x00450042` |

### `nfc:dev` (aiguillage `nfc_dev_dispatch_command` à `0x129af4`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `` | (absente de la Carte) | `nfc_dev_cmd_0001_Unknown` | `0x122646` | émulation | numéro | `0x00010040` |
| 0x2 | `` | (absente de la Carte) | `nfc_dev_cmd_0002_Unknown` | `0x1227A8` | émulation | numéro | `0x00020040` |
| 0x3 | `` | (absente de la Carte) | `nfc_dev_cmd_0003_Unknown` | `0x12277C` | émulation | numéro | `0x00030080` |
| 0x4 | `` | (absente de la Carte) | `nfc_dev_cmd_0004_Unknown` | `0x122794` | émulation | numéro | `0x00040040` |
| 0x5 | `` | (absente de la Carte) | `nfc_dev_cmd_0005_Unknown` | `0x12273C` | émulation | numéro | `0x00050040` |
| 0x6 | `` | (absente de la Carte) | `nfc_dev_cmd_0006_Unknown` | `0x122700` | émulation | numéro | `0x00060040` |
| 0x7 | `` | (absente de la Carte) | `nfc_dev_cmd_0007_Unknown` | `0x122674` | émulation | numéro | `0x00070042` |
| 0x8 | `` | (absente de la Carte) | `nfc_dev_cmd_0008_Unknown` | `0x1226B4` | émulation | numéro | `0x00080040` |
| 0x9 | `` | (absente de la Carte) | `nfc_dev_cmd_0009_Unknown` | `0x122764` | émulation | numéro | `0x00090042` |
| 0xA | `0x000A00C2` | (absente de la Carte) | `nfc_dev_cmd_000A_Unknown` | `0x1226D4` | émulation | entier | `0x000A0040` |
| 0xB | `` | (absente de la Carte) | `nfc_dev_cmd_000B_Unknown` | `0x1227B4` | émulation | numéro | `0x000B0040` |
| 0xC | `0x000C0084` | (absente de la Carte) | `nfc_dev_cmd_000C_Unknown` | `0x122710` | émulation | entier | `0x000C0040` |
| 0xD | `` | (absente de la Carte) | `nfc_dev_cmd_000D_Unknown` | `0x12268C` | émulation | numéro | `0x000D0042` |
| 0xE | `` | (absente de la Carte) | `nfc_dev_cmd_000E_Unknown` | `0x1226F0` | émulation | numéro | `0x000E0042` |
| 0xF | `` | (absente de la Carte) | `nfc_dev_cmd_000F_Unknown` | `0x122750` | émulation | numéro | `0x000F0040` |
| 0x10 | `` | (absente de la Carte) | `nfc_dev_cmd_0010_Unknown` | `0x12272C` | émulation | numéro | `0x00100040` |
| 0x11 | `0x00110100` | ReadRawPages | `nfc_dev_cmd_0011_ReadRawPages` | `0x122652` | émulation | numéro | `0x00110042` |
| 0x12 | `0x001200C0` | WriteRawPage | `nfc_dev_cmd_0012_WriteRawPage` | `0x12269C` | émulation | numéro | `0x00120040` |
| 0x13 | `` | (absente de la Carte) | `nfc_dev_cmd_0013_Unknown` | `0x1226C4` | émulation | numéro | `0x00130300` |

### `nfc:m` (aiguillage `nfc_m_dispatch_command` à `0x12a468`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010040` | Initialize | `nfc_cmd_0001_Initialize` | `0x113B24` | émulation | numéro | `0x00010040` |
| 0x2 | `0x00020040` | Shutdown | `nfc_cmd_0002_Shutdown` | `0x121488` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030000` | StartCommunication | `nfc_cmd_0003_StartCommunication` | `0x1213EC` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | StopCommunication | `nfc_cmd_0004_StopCommunication` | `0x113B00` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050040` | StartTagScanning | `nfc_cmd_0005_StartTagScanning` | `0x113AC0` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | StopTagScanning | `nfc_cmd_0006_StopTagScanning` | `0x113A80` | émulation | numéro | `0x00060040` |
| 0x7 | `0x00070000` | LoadAmiiboData | `nfc_cmd_0007_LoadAmiiboData` | `0x1213BC` | émulation | numéro | `0x00070040` |
| 0x8 | `0x00080000` | ResetTagScanState | `nfc_cmd_0008_ResetTagScanState` | `0x121458` | émulation | numéro | `0x00080040` |
| 0x9 | `0x00090002` | UpdateStoredAmiiboData | `nfc_cmd_0009_UpdateStoredAmiiboData` | `0x121388` | émulation | entier | `0x00090040` |
| 0xA | `0x000A0000` | Inconnue | `nfc_cmd_000A_Unknown` | `0x121428` | émulation | numéro | `0x000A0040` |
| 0xB | `0x000B0000` | GetTagInRangeEvent | `nfc_cmd_000B_GetTagInRangeEvent` | `0x113A24` | émulation | numéro | `0x000B0042` |
| 0xC | `0x000C0000` | GetTagOutOfRangeEvent | `nfc_cmd_000C_GetTagOutOfRangeEvent` | `0x1139FC` | émulation | numéro | `0x000C0042` |
| 0xD | `0x000D0000` | GetTagState | `nfc_cmd_000D_GetTagState` | `0x121524` | émulation | numéro | `0x000D0080` |
| 0xE | `` | (absente de la Carte) | `nfc_cmd_000E_Unknown` | `0x1139D8` | émulation | numéro | `0x000E0080` |
| 0xF | `0x000F0000` | CommunicationGetStatus | `nfc_cmd_000F_CommunicationGetStatus` | `0x121314` | émulation | numéro | `0x000F0080` |
| 0x10 | `0x00100000` | GetTagInfo2 | `nfc_cmd_0010_GetTagInfo2` | `0x11396C` | émulation | numéro | `0x00100640` |
| 0x11 | `0x00110000` | GetTagInfo | `nfc_cmd_0011_GetTagInfo` | `0x113944` | émulation | numéro | `0x00110300` |
| 0x12 | `0x00120000` | CommunicationGetResult | `nfc_cmd_0012_CommunicationGetResult` | `0x11391C` | émulation | numéro | `0x00120080` |
| 0x13 | `0x00130040` | OpenAppData | `nfc_cmd_0013_OpenAppData` | `0x1138F8` | émulation | numéro | `0x00130040` |
| 0x14 | `0x00140384` | InitializeWriteAppData | `nfc_cmd_0014_InitializeWriteAppData` | `0x113878` | émulation | entier | `0x00140040` |
| 0x15 | `0x00150040` | ReadAppData | `nfc_cmd_0015_ReadAppData` | `0x113850` | émulation | numéro | `0x00150042` |
| 0x16 | `0x00160242` | WriteAppData | `nfc_cmd_0016_WriteAppData` | `0x113824` | émulation | entier | `0x00160040` |
| 0x17 | `0x00170000` | GetRegisterInfo | `nfc_cmd_0017_GetRegisterInfo` | `0x113800` | émulation | numéro | `0x00170AC0` |
| 0x18 | `0x00180000` | GetCommonInfo | `nfc_cmd_0018_GetCommonInfo` | `0x1137DC` | émulation | numéro | `0x00180440` |
| 0x19 | `0x00190000` | GetAppDataInitStruct | `nfc_cmd_0019_GetAppDataInitStruct` | `0x1137B8` | émulation | numéro | `0x00190400` |
| 0x1A | `0x001A0000` | Inconnue | `nfc_cmd_001A_Unknown` | `0x1214DC` | émulation | numéro | `0x001A0040` |
| 0x1B | `0x001B0000` | GetModelInfo | `nfc_cmd_001B_GetModelInfo` | `0x113794` | émulation | numéro | `0x001B03C0` |
| 0x1C | `0x001C0040` | Inconnue | `nfc_cmd_001C_Unknown` | `0x121338` | émulation | numéro | `0x001C0040` |
| 0x1D | `0x001D0040` | Inconnue | `nfc_cmd_001D_Unknown` | `0x113770` | émulation | numéro | `0x001D0040` |
| 0x1E | `0x001E0040` | Inconnue | `nfc_cmd_001E_Unknown` | `0x1212EC` | émulation | numéro | `0x001E0080` |
| 0x1F | `0x001F0080` | StartOtherTagScanning | `nfc_cmd_001F_StartOtherTagScanning` | `0x12135C` | émulation | numéro | `0x001F0040` |
| 0x20 | `0x00200102` | SendTagCommand | `nfc_cmd_0020_SendTagCommand` | `0x113734` | émulation | entier | `0x00200082` |
| 0x21 | `0x00210000` | Inconnue | `nfc_cmd_0021_Unknown` | `0x113714` | émulation | numéro | `0x00210040` |
| 0x22 | `0x00220000` | Inconnue | `nfc_cmd_0022_Unknown` | `0x1136F4` | émulation | numéro | `0x00220040` |
| 0x401 | `0x040100C2` | Inconnue | `nfc_m_cmd_0401_Unknown` | `0x124D3C` | émulation | entier | `0x04010040` |
| 0x402 | `0x04020000` | GetAdminInfo | `nfc_m_cmd_0402_GetAdminInfo` | `0x124AF0` | émulation | numéro | `0x04020440` |
| 0x403 | `0x04030000` | GetEmptyRegisterInfo | `nfc_m_cmd_0403_GetEmptyRegisterInfo` | `0x124D18` | émulation | numéro | `0x04030A80` |
| 0x404 | `0x04040A40` | SetRegisterInfo | `nfc_m_cmd_0404_SetRegisterInfo` | `0x124B34` | émulation | numéro | `0x04040040` |
| 0x405 | `0x04050000` | DeleteRegisterInfo | `nfc_m_cmd_0405_DeleteRegisterInfo` | `0x124BB8` | émulation | numéro | `0x04050040` |
| 0x406 | `0x04060000` | DeleteApplicationArea | `nfc_m_cmd_0406_DeleteApplicationArea` | `0x124B98` | émulation | numéro | `0x04060040` |
| 0x407 | `0x04070000` | ExistsApplicationArea | `nfc_m_cmd_0407_ExistsApplicationArea` | `0x124C20` | émulation | numéro | `0x04070080` |
| 0x408 | `0x04080000` | Inconnue | `nfc_m_cmd_0408_Unknown` | `0x124BD8` | émulation | numéro | `0x04080080` |
| 0x409 | `0x04090042` | (absente de la Carte) | `nfc_m_cmd_0409_Unknown` | `0x124BF4` | émulation | entier | `0x04090040` |
| 0x40A | `0x040A0042` | (absente de la Carte) | `nfc_m_cmd_040A_Unknown` | `0x124CE4` | émulation | entier | `0x040A03C0` |
| 0x40B | `0x040B00C2` | (absente de la Carte) | `nfc_m_cmd_040B_Unknown` | `0x124C9C` | émulation | entier | `0x040B0042` |
| 0x40C | `0x040C0000` | Inconnue | `nfc_m_cmd_040C_Unknown` | `0x124B64` | émulation | numéro | `0x040C0040` |
| 0x40D | `0x040D0000` | Inconnue | `nfc_m_cmd_040D_Unknown` | `0x124B28` | émulation | numéro | `0x040D0040` |
| 0x40E | `0x040E0000` | Inconnue | `nfc_m_cmd_040E_Unknown` | `0x124B88` | émulation | numéro | `0x040E0042` |
| 0x40F | `0x040F0000` | Inconnue | `nfc_m_cmd_040F_Unknown` | `0x124B14` | émulation | numéro | `0x040F00C0` |
| 0x410 | `` | (absente de la Carte) | `nfc_m_cmd_0410_Unknown` | `0x124B58` | émulation | numéro | `0x04100040` |
| 0x411 | `` | (absente de la Carte) | `nfc_m_cmd_0411_Unknown` | `0x124D58` | émulation | numéro | `0x04110042` |
| 0x412 | `0x04120042` | (absente de la Carte) | `nfc_m_cmd_0412_Unknown` | `0x124D9C` | émulation | entier | `0x04120040` |
| 0x413 | `` | (absente de la Carte) | `nfc_m_cmd_0413_Unknown` | `0x124ACC` | émulation | numéro | `0x04130040` |
| 0x414 | `0x04140042` | (absente de la Carte) | `nfc_m_cmd_0414_Unknown` | `0x124C44` | émulation | entier | `0x04140040` |
| 0x415 | `` | (absente de la Carte) | `nfc_m_cmd_0415_Unknown` | `0x124D78` | émulation | numéro | `0x04150040` |


Notes :

- **`nfc:s` `0x33` et `0x37`** (en-têtes `0x00330184` et `0x00370104`) : l'émulation les a refusés (descripteurs) et le pseudo-code ne montre pas leur cas (le `switch` n'est pas reconstruit). Leur gestionnaire n'est pas localisé.
- **`nfc:r`, `nfc:s`, `nfc:dev`** : la Carte en connaît très peu (0, 3, 2). Le code en a 26, 69 et 19. Ce sont des commandes d'accès à la puce sans nom ; leurs gestionnaires (adresses `0x1226xx` à `0x1229xx` pour `r` et `dev`, `0x124Dxx` à `0x1254xx` pour `s`) appartiennent à la couche basse commune du module. `nfc:dev` `0x11` ReadRawPages et `0x12` WriteRawPage (noms de la Carte) lisent et écrivent des pages brutes de la puce.
- Plusieurs services partagent leurs gestionnaires (le tableau nomme chaque fonction d'après le premier service où elle est apparue) : tous ceux de `nfc:u` sont aussi ceux de `nfc:m`.
- **Les trois modes de `Initialize`** : `nfc:u` `Initialize` (`0x113B24`, `0x00010040`) prend un mot, 1, 2 ou 3, et range ce mode dans l'octet `+0x220` de la session après avoir appelé l'initialiseur du mode (`0x1232BC` pour 1, `0x1215B8` pour 2, `0x1241F8` pour 3) ; tout autre mode est refusé. Les commandes ultérieures (`StartTagScanning`, `GetTagState`...) regardent cet octet et appellent la variante qui correspond (trois implémentations parallèles de la couche haute). Le sens de chaque mode n'est pas lu.

## Partie 4 : une opération pas à pas, StartTagScanning

`nfc:u`, commande 5 (`0x00050040`, un mot ordinaire : une durée d'attente). Lu dans `nfc_cmd_0005_StartTagScanning` (`0x113AC0`).

1. L'aiguillage `0x12954C` lit le numéro 5 et appelle le gestionnaire avec l'objet de la session.
2. Le gestionnaire lit le mode de la session (`+0x220`, posé par `Initialize`).
3. Mode 1 : il prend l'objet du mode 1 (`0x11D710`) et lance la recherche (`0x1233E8`, avec le mot reçu et le drapeau 1).
4. Mode 2 : il prend l'objet du mode 2 (`0x127B70`/`0x11D5CC`), appelle `0x127BDC` avec le drapeau 1, puis la recherche du mode 2 (`0x12162A`).
5. Tout autre mode (y compris 0, « non initialisé ») : il rend un code d'erreur (constante `DAT_00113AFC`).
6. L'aiguillage répond `0x00050040`.

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x13527C` | table des services : six paires (nom, nombre de sessions 1) |
| `0x1352AC` | table des aiguillages : `0x12954D`, `0x129EA1`, `0x12C1ED`, `0x12AE01`, `0x129AF5`, `0x12A469` |
| `0x1352C4` à `0x1352E2` | les noms `nfc:u`, `nfc:m`, `nfc:s`, `nfc:r`, `nfc:p`, `nfc:dev` |
| `0x135000`, `0x135009` | `i2c::NFC`, `gpio:NFC` |
| `0x135228`, `0x13522E`, `0x135240` | `data:`, `nfp_backup.dat`, `%s/%s` |
| `0x135584`, `0x1355B0` | deux étiquettes de texte de la dérivation des clés (non reproduites) |
| `0x135800` à `0x136100` | des tables de nombres (le chiffrement ; les valeurs ne sont pas reproduites) |
| session, `+0x220` | le mode de la session (1, 2 ou 3) |

Où sont les données sensibles : les clés de figurine (« amiibo ») sont des constantes du module et ne sont pas dans les fichiers de cette série. La sauvegarde `nfp_backup.dat` est dans l'archive `data:` du module ; le contenu d'une figurine passe par le tampon que le client donne.

## Partie 6 : ce que Pokémon X envoie

Rien : le jeu n'ouvre aucun service de `nfc` (le module n'existe que sur la New 3DS). Pour le portage PC, `nfc` n'a rien à rendre à la place de la console.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les tables de commandes de `nfc:u` (34), `nfc:p` (19) et `nfc:m` (55) : voie 1, l'émulation des aiguillages ; voie 2, la Carte (3dbrew) : mêmes numéros et mêmes en-têtes pour toutes les commandes qu'elle nomme, sauf celles qu'elle ne connaît pas (10 de plus dans `nfc:m`, 1 dans `nfc:u`).
- Les six services et leurs nombres de sessions (1), la table des six aiguillages.
- L'inclusion de `nfc:u` dans `nfc:m`, aux mêmes adresses.

**Interprété** :
- Les tables de `nfc:r` (26), `nfc:s` (69) et `nfc:dev` (19) : une seule voie (l'émulation) puisque la Carte ne les connaît pas ; l'appariement de ces trois aiguillages à leur service repose sur l'ordre de la table des services, confirmé pour les trois autres.
- Les noms, le sens du mode de `Initialize`.
- Que la couche haute a trois variantes.

**Pas lu** :
- Le protocole de la puce (I2C), la détection de figurine, la lecture et l'écriture de pages, le chiffrement et la vérification des données d'une figurine, la sauvegarde `nfp_backup.dat`.
- Les gestionnaires `0x33` et `0x37` de `nfc:s`.
- Presque tous les corps de gestionnaires.
