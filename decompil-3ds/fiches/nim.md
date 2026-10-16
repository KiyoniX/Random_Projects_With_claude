# nim, l'eShop et les mises à jour

`nim` (Network Installation Manager) est le module qui parle aux serveurs d'achat et de mise à jour de Nintendo : il interroge la boutique (services web SOAP « ECommerce » et « NetUpdate »), tient la liste des tâches de téléchargement et des mises à jour système, et installe ce qu'il télécharge par `am:net`. Quatre services : `nim:u` (46 commandes, pour les applications), `nim:s` (94 dans le code, le système), `nim:aoc` (38 dans le code, les contenus additionnels) et `nim:ndm` (5, le canal de `ndm` qui suspend et relance le démon).

Fiche du 16 octobre 2026, **fiche courte** : arrêt demandé en cours de route. Produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, module presque tout en Thumb), `outils/emulate_dispatch.py` sur les quatre aiguillages (de 0 à 0xFFFF) et la Carte des services (tirée de 3dbrew). Adresses du module chargé à `0x00100000`. **Aucune clé, aucun certificat ni identifiant de console n'est reproduit** : les fichiers de la base `nimdb:` (comptes, identifiants d'achat) sont nommés, pas lus.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002C02`, un titre de la CTRNAND ; nom interne `nim`, priorité 61 (`0x3D`) |
| Fichier lu | `local/extrait/nim/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x5017C` octets de code (`0x51` pages), `0x4020` de données en lecture seule (5 pages), `0x9A8` de données (1 page), `0x1302C8` de mémoire à zéro (1,2 Mo : tampons des requêtes), pile de `0x1000` |
| Fonctions | 3 361 pour Ghidra, dont 3 241 en Thumb et 120 en ARM ; 165 nommées dans `nim.noms.tsv`, aucun nom sans fonction |
| Services offerts | `nim:u`, `nim:s`, `nim:ndm`, `nim:aoc` (table de quatre pointeurs de noms à `0x15629C`, noms de `0x15133C` à `0x151350`) |
| Services appelés | lus dans l'exheader : `fs:USER`, `am:net`, `ac:u`, `http:C`, `cfg:s`, `ptm:s`, `ptm:gets`. Dans le code, des chaînes pour `am:net` (`0x151912`), `http:C` (`0x1519E4`, `0x1519EB`), `fs:USER` (`0x1519CF`) |
| Appelants connus | `nim:u` : `menu` et `news` ; `nim:s` : `mint` ; `nim:aoc` : `maj`, `menu`, `skater` ; `nim:ndm` : `ndm` (exheaders et `fiches/ndm.md`). Pokémon X n'ouvre aucun des quatre |
| Fichiers de `nimdb:` | `account.dat`, `purchase_aoc.flg`, `autodbg.dat`, `dbgtasks.dat`, `cc.dat`, `dtl.xml`, `hash.dat`, `initacc.dat`, `ivs.dat`, `tsl.xml`, `tsl.xml.tmp`, `task.dat`, `tax.dat` (chaînes de `0x151070` à `0x151878`) |
| Serveurs | trois adresses https : le service de commerce (`ecs`), celui de solde (`ninja`) et celui de mise à jour (`nus`), chaînes à `0x1511BC`, `0x1514B0`, `0x1514F4` et `0x151533` |

## Partie 1 : le démarrage et le serveur

`nim_main` (`0x100CAC`) attend sur cinq poignées (les quatre ports et une notification, attente multiple `0x14ED88`) ; un port actif : `AcceptSession` (`svc_accept_session`, `0x14ED28`) puis `0x101310` démarre **un fil par session** avec l'indice du service. Chaque fil exécute la boucle de son service, qui prépare des tampons statiques de réception (`*_setup_static_buffers`) puis boucle sur `ReplyAndReceive` (`svc_reply_and_receive`, `0x12FD54`) et appelle l'aiguillage :

| Service | Boucle | Tampons statiques | Aiguillage | Commandes (émulées) |
| --- | --- | --- | --- | --- |
| `nim:u` | `0x102E68` | `0x105540` | `nim_u_dispatch_command` `0x107F78` | 46 |
| `nim:s` | `0x102DF0` | `0x103904` | `nim_s_dispatch_command` `0x10557C` | 94 |
| `nim:aoc` | `0x102D04` | `0x103870` | `nim_aoc_dispatch_command` `0x1039C4` | 38 |
| `nim:ndm` | `0x102D7C` | (aucun) | `nim_ndm_dispatch_command` `0x105470` | 5 |

L'appariement vient de la comparaison avec la Carte : `0x107F78` retrouve les 46 numéros et les 12 en-têtes complets de `nim:u` (12 sur 12) ; `0x10557C` couvre les 36 numéros de `nim:s` (20 en-têtes égaux sur 52 comparés) ; `0x105470` est `nim:ndm` (5 sur 5) ; `0x1039C4` reste, avec les 8 numéros de `nim:aoc` (**par élimination**, 4 en-têtes égaux sur 27). L'ordre des fils dans le code vient du pseudo-code (chaque boucle appelle ses deux fonctions).

## Partie 2 : les commandes

Les noms et les en-têtes sont ceux de la Carte (3dbrew). **La Carte ne connaît que 46, 36, 8 et 5 commandes** ; le code en a 46, 94, 38 et 5 : `nim:s` et `nim:aoc` ont donc 58 et 30 commandes sans nom. Pour les 17 commandes de `nim:s` et les 15 de `nim:aoc` que l'émulation a refusées (descripteurs), le gestionnaire n'est pas localisé (le `switch` n'est pas reconstruit dans le pseudo-code) : « non émulée ».

### `nim:u` (aiguillage `nim_u_dispatch_command` à `0x107f78`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010000` | StartNetworkUpdate | `nim_u_cmd_0001_StartNetworkUpdate` | `0x1097BC` | émulation | numéro | `0x00010040` |
| 0x2 | `0x00020000` | GetProgress | `nim_u_cmd_0002_GetProgress` | `0x1094FC` | émulation | numéro | `0x00020340` |
| 0x3 | `0x00030000` | Cancel | `nim_u_cmd_0003_Cancel` | `0x109B48` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | CommitSystemTitles | `nim_u_cmd_0004_CommitSystemTitles` | `0x109784` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050000` | GetBackgroundEventForMenu | `nim_u_cmd_0005_GetBackgroundEventForMenu` | `0x1098F4` | émulation | numéro | `0x00050042` |
| 0x6 | `0x00060000` | GetBackgroundEventForNews | `nim_u_cmd_0006_GetBackgroundEventForNews` | `0x109918` | émulation | numéro | `0x00060042` |
| 0x7 | `0x00070000` | FormatSaveData | `nim_u_cmd_0007_FormatSaveData` | `0x109694` | émulation | numéro | `0x00070040` |
| 0x8 | `0x00080000` | GetCustomerSupportCode | `nim_u_cmd_0008_GetCustomerSupportCode` | `0x109874` | émulation | numéro | `0x00080080` |
| 0x9 | `0x00090000` | IsCommittableAllSystemTitles | `nim_u_cmd_0009_IsCommittableAllSystemTitles` | `0x109998` | émulation | numéro | `0x00090080` |
| 0xA | `0x000A0000` | GetBackgroundProgress | `nim_u_cmd_000A_GetBackgroundProgress` | `0x1097F0` | émulation | numéro | `0x000A0340` |
| 0xB | `0x000B0000` | GetSavedHash | `nim_u_cmd_000B_GetSavedHash` | `0x1095A4` | émulation | numéro | `0x000B0280` |
| 0xC | `0x000C0082` | UnregisterTask | `nim_u_cmd_000C_UnregisterTask` | `0x1096BC` | émulation | entier | `0x000C0040` |
| 0xD | `0x000D0080` | IsRegistered | `nim_u_cmd_000D_IsRegistered` | `0x109610` | émulation | numéro | `0x000D0080` |
| 0xE | `0x000E0080` | FindTaskInfo | `nim_u_cmd_000E_FindTaskInfo` | `0x109548` | émulation | numéro | `0x000E0042` |
| 0xF | `0x000F0042` | GetTaskInfos | `nim_u_cmd_000F_GetTaskInfos` | `0x1095CC` | émulation | entier | `0x000F0082` |
| 0x10 | `0x00100000` | DeleteUnmanagedContexts | `nim_u_cmd_0010_DeleteUnmanagedContexts` | `0x1098B4` | émulation | numéro | `0x00100040` |
| 0x11 | `0x00110000` | UpdateAutoTitleDownloadTasksAsync | `nim_u_cmd_0011_UpdateAutoTitleDownloadTasksAsync` | `0x109AD8` | émulation | numéro | `0x00110042` |
| 0x12 | `0x00120000` | StartPendingAutoTitleDownloadTasksAsync | `nim_u_cmd_0012_StartPendingAutoTitleDownloadTasksAsync` | `0x109B10` | émulation | numéro | `0x00120042` |
| 0x13 | `0x00130000` | GetAsyncResult | `nim_u_cmd_0013_GetAsyncResult` | `0x109708` | émulation | numéro | `0x001300C0` |
| 0x14 | `0x00140000` | CancelAsyncCall | `nim_u_cmd_0014_CancelAsyncCall` | `0x10966C` | émulation | numéro | `0x00140040` |
| 0x15 | `0x00150000` | IsPendingAutoTitleDownloadTasks | `nim_u_cmd_0015_IsPendingAutoTitleDownloadTasks` | `0x109AC8` | émulation | numéro | `0x00150080` |
| 0x16 | `0x00160000` | GetNumAutoTitleDownloadTasks | `nim_u_cmd_0016_GetNumAutoTitleDownloadTasks` | `0x109974` | émulation | numéro | `0x00160080` |
| 0x17 | `0x00170042` | GetAutoTitleDownloadTaskInfos | `nim_u_cmd_0017_GetAutoTitleDownloadTaskInfos` | `0x10993C` | émulation | entier | `0x00170082` |
| 0x18 | `0x00180080` | CancelAutoTitleDownloadTask | `nim_u_cmd_0018_CancelAutoTitleDownloadTask` | `0x109A52` | émulation | numéro | `0x00180040` |
| 0x19 | `0x00190002` | SetAutoDbgDat | `nim_u_cmd_0019_SetAutoDbgDat` | `0x109A66` | émulation | entier | `0x00190042` |
| 0x1A | `0x001A0002` | GetAutoDbgDat | `nim_u_cmd_001A_GetAutoDbgDat` | `0x109A40` | émulation | entier | `0x001A0042` |
| 0x1B | `0x001B0042` | SetDbgTasks | `nim_u_cmd_001B_SetDbgTasks` | `0x1099E4` | émulation | entier | `0x001B0042` |
| 0x1C | `0x001C0042` | GetDbgTasks | `nim_u_cmd_001C_GetDbgTasks` | `0x1099CC` | émulation | entier | `0x001C0082` |
| 0x1D | `0x001D0000` | DeleteDbgData | `nim_u_cmd_001D_DeleteDbgData` | `0x109A76` | émulation | numéro | `0x001D0040` |
| 0x1E | `0x001E0042` | SetTslXml | `nim_u_cmd_001E_SetTslXml` | `0x109984` | émulation | entier | `0x001E0042` |
| 0x1F | `0x001F0000` | GetTslXmlSize | `nim_u_cmd_001F_GetTslXmlSize` | `0x1099BC` | émulation | numéro | `0x001F00C0` |
| 0x20 | `0x00200042` | GetTslXml | `nim_u_cmd_0020_GetTslXml` | `0x109960` | émulation | entier | `0x00200042` |
| 0x21 | `0x00210000` | DeleteTslXml | `nim_u_cmd_0021_DeleteTslXml` | `0x109954` | émulation | numéro | `0x00210040` |
| 0x22 | `0x00220042` | SetDtlXml | `nim_u_cmd_0022_SetDtlXml` | `0x1098A0` | émulation | entier | `0x00220042` |
| 0x23 | `0x00230000` | GetDtlXmlSize | `nim_u_cmd_0023_GetDtlXmlSize` | `0x1098E2` | émulation | numéro | `0x002300C0` |
| 0x24 | `0x00240042` | GetDtlXml | `nim_u_cmd_0024_GetDtlXml` | `0x109860` | émulation | entier | `0x00240042` |
| 0x25 | `0x00250000` | UpdateAccountStatus | `nim_u_cmd_0025_UpdateAccountStatus` | `0x109680` | émulation | numéro | `0x002500C0` |
| 0x26 | `0x00260180` | StartTitleDownload | `nim_u_cmd_0026_StartTitleDownload` | `0x1097A8` | émulation | numéro | `0x00260040` |
| 0x27 | `0x00270000` | StopTitleDownload | `nim_u_cmd_0027_StopTitleDownload` | `0x1097E0` | émulation | numéro | `0x00270040` |
| 0x28 | `0x00280000` | GetTitleDownloadProgress | `nim_u_cmd_0028_GetTitleDownloadProgress` | `0x109724` | émulation | numéro | `0x00280240` |
| 0x29 | `0x00290246` | RegisterTask | `nim_u_cmd_0029_RegisterTask` | `0x109654` | émulation | entier | `0x00290040` |
| 0x2A | `0x002A0000` | IsSystemUpdateAvailable | `nim_u_cmd_002A_IsSystemUpdateAvailable` | `0x109738` | émulation | numéro | `0x002A0100` |
| 0x2B | `0x002B0000` | Inconnue | `nim_u_cmd_002B_Unknown` | `0x109ABC` | émulation | numéro | `0x002B0040` |
| 0x2C | `0x002C0000` | UpdateTickets | `nim_u_cmd_002C_UpdateTickets` | `0x109534` | émulation | numéro | `0x002C00C0` |
| 0x2D | `0x002D00C0` | DownloadTitleSeedAsync | `nim_u_cmd_002D_DownloadTitleSeedAsync` | `0x1099F8` | émulation | numéro | `0x002D0042` |
| 0x2E | `0x002E0000` | DownloadMissingTitleSeedsAsync | `nim_u_cmd_002E_DownloadMissingTitleSeedsAsync` | `0x109A84` | émulation | numéro | `0x002E0042` |

### `nim:s` (aiguillage `nim_s_dispatch_command` à `0x10557c`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010200` | StartDownloadSimple | `nim_s_cmd_0001_StartDownloadSimple` | `0x10CF3E` | émulation | numéro | `0x00010040` |
| 0x2 | `0x00020000` | CancelDownload | `nim_s_cmd_0002_CancelDownload` | `0x10CF58` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030000` | GetProgress | `nim_s_cmd_0003_GetProgress` | `0x10C67C` | émulation | numéro | `0x00030240` |
| 0x5 | `0x00050082` | UnregisterTask | `nim_s_cmd_0005_UnregisterTask` | `0x10D330` | émulation | entier | `0x00050040` |
| 0x6 | `0x00060080` | IsTaskRegistered | `nim_s_cmd_0006_IsTaskRegistered` | `0x10CC14` | émulation | numéro | `0x00060080` |
| 0x7 | `0x00070080` | GetTaskInfoFromTitleId | `nim_s_cmd_0007_GetTaskInfoFromTitleId` | `0x10CA50` | émulation | numéro | `0x00070042` |
| 0x8 | `0x00080042` | GetTaskList | `nim_s_cmd_0008_GetTaskList` | `0x10CBBC` | émulation | entier | `0x00080082` |
| 0x9 | `` | (absente de la Carte) | dans l'aiguillage |  | émulation | numéro | `0x00090040` |
| 0xA | `0x000A0000` | CheckSysupdateAvailableSOAP | `nim_s_cmd_000A_CheckSysupdateAvailableSOAP` | `0x10E014` | émulation | numéro | `0x000A0080` |
| 0xB | `0x000B0084` | SetAttribute | `nim_s_cmd_000B_SetAttribute` | `0x1114DC` | émulation | entier | `0x000B0040` |
| 0xC | `0x000C0082` | SetAttributeInt32 | `nim_s_cmd_000C_SetAttributeInt32` | `0x10D250` | émulation | entier | `0x000C0040` |
| 0xD | `0x000D0082` | Connect | `nim_s_cmd_000D_Connect` | `0x10FB30` | émulation | entier | `0x000D0082` |
| 0xE | `0x000E0000` | UnregisterSOAP | `nim_s_cmd_000E_UnregisterSOAP` | `0x10C534` | émulation | numéro | `0x000E0040` |
| 0xF | `0x000F0042` | SetCountrySOAP | `nim_s_cmd_000F_SetCountrySOAP` | `0x10C45C` | émulation | entier | `0x000F0040` |
| 0x10 | `0x00100080` | Inconnue | `nim_s_cmd_0010_Unknown` | `0x10FC38` | émulation | numéro | `0x00100040` |
| 0x11 | `0x001100C4` | Inconnue | `nim_s_cmd_0011_Unknown` | `0x10FC30` | émulation | entier | `0x00110082` |
| 0x12 | `0x00120084` | SetExternalAccountSOAP | `nim_s_cmd_0012_SetExternalAccountSOAP` | `0x10E46C` | émulation | entier | `0x00120040` |
| 0x13 | `0x00130042` | DeleteExternalAccountSOAP | `nim_s_cmd_0013_DeleteExternalAccountSOAP` | `0x10EB00` | émulation | entier | `0x00130040` |
| 0x14 | `0x00140000` | DeleteSavedCardSOAP | `nim_s_cmd_0014_DeleteSavedCardSOAP` | `0x10EB90` | émulation | numéro | `0x00140040` |
| 0x15 | `0x00150082` | ListCashReplenishAmountsSOAP | `nim_s_cmd_0015_ListCashReplenishAmountsSOAP` | `0x10F2F8` | émulation | entier | `0x00150082` |
| 0x16 | `0x0016020A` | ListTitles | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x17 | `0x0017020A` | ListContentSetsExSOAP | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x18 | `0x0018020A` | ListItemsSOAP | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x19 | `0x0019028C` | ListContentSetGroupsSOAP | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x1A | `0x001A0704` | (absente de la Carte) | `nim_s_cmd_001A_Unknown` | `0x10DD20` | émulation | entier | `0x001A08C2` |
| 0x1B | `0x001B090E` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x1C | `0x001C06D0` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x1D | `0x001D07D4` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x1E | `0x001E0104` | GetTaxesSOAP | `nim_s_cmd_001E_GetTaxesSOAP` | `0x10CAC0` | émulation | entier | `0x001E0082` |
| 0x1F | `0x001F0106` | GetTaxLocationSOAP | `nim_s_cmd_001F_GetTaxLocationSOAP` | `0x10D674` | émulation | entier | `0x001F0082` |
| 0x20 | `0x00200808` | (absente de la Carte) | `nim_s_cmd_0020_Unknown` | `0x10D518` | émulation | entier | `0x00200082` |
| 0x21 | `0x0021060A` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x22 | `0x00220080` | AccountDeleteTitleETicketsSOAP | `nim_s_cmd_0022_AccountDeleteTitleETicketsSOAP` | `0x10E834` | émulation | numéro | `0x00220040` |
| 0x23 | `0x00230106` | (absente de la Carte) | `nim_s_cmd_0023_Unknown` | `0x10C048` | émulation | entier | `0x00230082` |
| 0x24 | `0x0024024C` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x25 | `0x002504C4` | (absente de la Carte) | `nim_s_cmd_0025_Unknown` | `0x10C328` | émulation | entier | `0x00250882` |
| 0x26 | `0x002601C6` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x27 | `0x002701C6` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x28 | `0x0028024A` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x29 | `0x00290000` | AccountCheckBalanceSOAP | `nim_s_cmd_0029_AccountCheckBalanceSOAP` | `0x10C16C` | émulation | numéro | `0x00290440` |
| 0x2A | `0x002A0082` | (absente de la Carte) | `nim_s_cmd_002A_Unknown` | `0x10CC6C` | émulation | entier | `0x002A0082` |
| 0x2B | `0x002B0082` | (absente de la Carte) | `nim_s_cmd_002B_Unknown` | `0x10EFB0` | émulation | entier | `0x002B0082` |
| 0x2C | `0x002C00C4` | (absente de la Carte) | `nim_s_cmd_002C_Unknown` | `0x10DF1C` | émulation | entier | `0x002C0084` |
| 0x2D | `0x002D0042` | DownloadTickets | `nim_s_cmd_002D_DownloadTickets` | `0x10D390` | émulation | entier | `0x002D0040` |
| 0x2E | `0x002E0184` | (absente de la Carte) | `nim_s_cmd_002E_Unknown` | `0x10EC04` | émulation | entier | `0x002E0102` |
| 0x2F | `0x002F01CA` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x30 | `` | (absente de la Carte) | `nim_s_cmd_0030_Unknown` | `0x10CD8C` | émulation | numéro | `0x003000C0` |
| 0x31 | `` | (absente de la Carte) | `nim_s_cmd_0031_Unknown` | `0x10EE58` | émulation | numéro | `0x00310080` |
| 0x32 | `0x00320002` | (absente de la Carte) | `nim_s_cmd_0032_Unknown` | `0x10D4AC` | émulation | entier | `0x00320042` |
| 0x33 | `` | (absente de la Carte) | `nim_s_cmd_0033_Unknown` | `0x10CF94` | émulation | numéro | `0x00330080` |
| 0x34 | `` | (absente de la Carte) | `nim_s_cmd_0034_Unknown` | `0x10DA98` | émulation | numéro | `0x003400C0` |
| 0x35 | `` | (absente de la Carte) | `nim_s_cmd_0035_Unknown` | `0x10F404` | émulation | numéro | `0x003500C0` |
| 0x36 | `` | (absente de la Carte) | dans l'aiguillage |  | émulation | numéro | `0x00360040` |
| 0x37 | `` | (absente de la Carte) | dans l'aiguillage |  | émulation | numéro | `0x00370040` |
| 0x38 | `0x00380044` | (absente de la Carte) | `nim_s_cmd_0038_Unknown` | `0x10CE04` | émulation | entier | `0x00380042` |
| 0x39 | `` | (absente de la Carte) | `nim_s_cmd_0039_Unknown` | `0x10CF7C` | émulation | numéro | `0x00390040` |
| 0x3A | `0x003A0082` | (absente de la Carte) | `nim_s_cmd_003A_Unknown` | `0x10DE9C` | émulation | entier | `0x003A0042` |
| 0x3B | `0x003B00C2` | (absente de la Carte) | `nim_s_cmd_003B_Unknown` | `0x10ED18` | émulation | entier | `0x003B0042` |
| 0x3C | `0x003C0002` | RegisterSelf | `nim_s_cmd_003C_RegisterSelf` | `0x10DD68` | émulation | entier | `0x003C0040` |
| 0x3D | `` | (absente de la Carte) | `nim_s_cmd_003D_Unknown` | `0x10D200` | émulation | numéro | `0x003D0040` |
| 0x3E | `` | (absente de la Carte) | `nim_s_cmd_003E_Unknown` | `0x10D158` | émulation | numéro | `0x003E0140` |
| 0x3F | `0x003F0000` | GetInitializeResult | `nim_s_cmd_003F_GetInitializeResult` | `0x10E514` | émulation | numéro | `0x003F0040` |
| 0x40 | `` | (absente de la Carte) | `nim_s_cmd_0040_Unknown` | `0x10F480` | émulation | numéro | `0x00400040` |
| 0x41 | `` | (absente de la Carte) | `nim_s_cmd_0041_Unknown` | `0x10FB04` | émulation | numéro | `0x00410080` |
| 0x42 | `0x00420240` | StartDownload | `nim_s_cmd_0042_StartDownload` | `0x1119D4` | émulation | numéro | `0x00420040` |
| 0x43 | `0x00430242` | (absente de la Carte) | `nim_s_cmd_0043_Unknown` | `0x10EE24` | émulation | entier | `0x00430040` |
| 0x44 | `` | (absente de la Carte) | `nim_s_cmd_0044_Unknown` | `0x10F7D4` | émulation | numéro | `0x004400C0` |
| 0x45 | `0x00450242` | (absente de la Carte) | `nim_s_cmd_0045_Unknown` | `0x10F6A0` | émulation | entier | `0x004500C2` |
| 0x46 | `0x00460184` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x47 | `` | (absente de la Carte) | `nim_s_cmd_0047_Unknown` | `0x10D00C` | émulation | numéro | `0x00470040` |
| 0x48 | `` | (absente de la Carte) | `nim_s_cmd_0048_Unknown` | `0x10ED9C` | émulation | numéro | `0x00480080` |
| 0x49 | `0x00490042` | (absente de la Carte) | `nim_s_cmd_0049_Unknown` | `0x10DA54` | émulation | entier | `0x004900C0` |
| 0x4A | `0x004A0210` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x4B | `0x004B0082` | (absente de la Carte) | `nim_s_cmd_004B_Unknown` | `0x10E8AC` | émulation | entier | `0x004B0102` |
| 0x4C | `0x004C04C6` | (absente de la Carte) | `nim_s_cmd_004C_Unknown` | `0x10E180` | émulation | entier | `0x004C08C4` |
| 0x4D | `0x004D06D0` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x4E | `` | (absente de la Carte) | `nim_s_cmd_004E_Unknown` | `0x10FA48` | émulation | numéro | `0x004E0040` |
| 0x4F | `` | (absente de la Carte) | `nim_s_cmd_004F_Unknown` | `0x10FAC4` | émulation | numéro | `0x004F0140` |
| 0x50 | `` | (absente de la Carte) | `nim_s_cmd_0050_Unknown` | `0x10FA88` | émulation | numéro | `0x00500040` |
| 0x51 | `` | (absente de la Carte) | `nim_s_cmd_0051_Unknown` | `0x10EE74` | émulation | numéro | `0x00510140` |
| 0x52 | `` | (absente de la Carte) | `nim_s_cmd_0052_Unknown` | `0x10EEFC` | émulation | numéro | `0x00520040` |
| 0x53 | `` | (absente de la Carte) | `nim_s_cmd_0053_Unknown` | `0x10EF40` | émulation | numéro | `0x00530500` |
| 0x54 | `0x005400C4` | (absente de la Carte) | `nim_s_cmd_0054_Unknown` | `0x10F6DC` | émulation | entier | `0x00540102` |
| 0x55 | `0x00550246` | RegisterTask | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x56 | `0x00560002` | (absente de la Carte) | `nim_s_cmd_0056_Unknown` | `0x10D430` | émulation | entier | `0x00560442` |
| 0x57 | `0x00570082` | ConnectNoTicketDownload | `nim_s_cmd_0057_ConnectNoTicketDownload` | `0x10F0A4` | émulation | entier | `0x00570082` |
| 0x58 | `0x00580082` | (absente de la Carte) | `nim_s_cmd_0058_Unknown` | `0x10C918` | émulation | entier | `0x00580042` |
| 0x59 | `` | (absente de la Carte) | `nim_s_cmd_0059_Unknown` | `0x10F3F4` | émulation | numéro | `0x00590040` |
| 0x5A | `` | (absente de la Carte) | `nim_s_cmd_005A_Unknown` | `0x10F3E4` | émulation | numéro | `0x005A0240` |
| 0x5B | `0x005B0000` | DeleteInitAccSavedData | `nim_s_cmd_005B_DeleteInitAccSavedData` | `0x111A38` | émulation | numéro | `0x005B0040` |
| 0x5C | `0x005C0000` | DeleteAccountSavedData | `nim_s_cmd_005C_DeleteAccountSavedData` | `0x111A1C` | émulation | numéro | `0x005C0040` |
| 0x5D | `` | (absente de la Carte) | `nim_s_cmd_005D_Unknown` | `0x10F68E` | émulation | numéro | `0x005D0040` |
| 0x5E | `` | (absente de la Carte) | `nim_s_cmd_005E_Unknown` | `0x10F65C` | émulation | numéro | `0x005E00C0` |
| 0x5F | `0x005F00C0` | DownloadTitleSeed | `nim_s_cmd_005F_DownloadTitleSeed` | `0x10E1CA` | émulation | numéro | `0x005F00C0` |

### `nim:aoc` (aiguillage `nim_aoc_dispatch_command` à `0x1039c4`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `` | (absente de la Carte) | `nim_aoc_cmd_0001_Unknown` | `0x10B248` | émulation | numéro | `0x00010080` |
| 0x2 | `0x00020002` | (absente de la Carte) | `nim_aoc_cmd_0002_Unknown` | `0x10BC18` | émulation | entier | `0x00020040` |
| 0x3 | `0x00030042` | SetApplicationId | `nim_aoc_cmd_0003_SetApplicationId` | `0x10AF20` | émulation | entier | `0x00030040` |
| 0x4 | `0x00040042` | SetTin | `nim_aoc_cmd_0004_SetTin` | `0x10BE2C` | émulation | entier | `0x00040040` |
| 0x5 | `` | (absente de la Carte) | `nim_aoc_cmd_0005_Unknown` | `0x10BDF4` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060082` | (absente de la Carte) | `nim_aoc_cmd_0006_Unknown` | `0x10BEAC` | émulation | entier | `0x00060082` |
| 0x7 | `0x0007020A` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x8 | `0x0008020A` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x9 | `0x000902D0` | ListContentSetsEx | dans l'aiguillage |  | émulation | entier | non émulée |
| 0xA | `0x000A020A` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0xB | `0x000B02D0` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0xC | `0x000C05C6` | (absente de la Carte) | `nim_aoc_cmd_000C_Unknown` | `0x10BA8C` | émulation | entier | `0x000C0084` |
| 0xD | `0x000D090E` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0xE | `0x000E090E` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0xF | `0x000F0A12` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x10 | `0x00100104` | (absente de la Carte) | `nim_aoc_cmd_0010_Unknown` | `0x10A158` | émulation | entier | `0x00100082` |
| 0x11 | `0x00110106` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x12 | `0x00120106` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x13 | `0x0013024C` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x14 | `0x00140312` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x15 | `0x001501C6` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x16 | `0x001601C6` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x17 | `0x0017024A` | (absente de la Carte) | dans l'aiguillage |  | émulation | entier | non émulée |
| 0x18 | `0x00180000` | GetBalance | `nim_aoc_cmd_0018_GetBalance` | `0x109E6C` | émulation | numéro | `0x00180440` |
| 0x19 | `0x00190182` | (absente de la Carte) | `nim_aoc_cmd_0019_Unknown` | `0x10B7C4` | émulation | entier | `0x001900C2` |
| 0x1A | `` | (absente de la Carte) | `nim_aoc_cmd_001A_Unknown` | `0x10BC94` | émulation | numéro | `0x001A0080` |
| 0x1B | `0x001B0104` | (absente de la Carte) | `nim_aoc_cmd_001B_Unknown` | `0x10AF9C` | émulation | entier | `0x001B0044` |
| 0x1C | `` | (absente de la Carte) | `nim_aoc_cmd_001C_Unknown` | `0x10A254` | émulation | numéro | `0x001C00C0` |
| 0x1D | `0x001D0000` | GetCustomerSupportCode | `nim_aoc_cmd_001D_GetCustomerSupportCode` | `0x10BD68` | émulation | numéro | `0x001D0080` |
| 0x1E | `0x001E0002` | (absente de la Carte) | `nim_aoc_cmd_001E_Unknown` | `0x10A7B0` | émulation | entier | `0x001E0042` |
| 0x1F | `` | (absente de la Carte) | `nim_aoc_cmd_001F_Unknown` | `0x10A544` | émulation | numéro | `0x001F0080` |
| 0x20 | `` | (absente de la Carte) | `nim_aoc_cmd_0020_Unknown` | `0x10ABE8` | émulation | numéro | `0x002000C0` |
| 0x21 | `0x00210000` | Initialize | `nim_aoc_cmd_0021_Initialize` | `0x109ED0` | émulation | numéro | `0x00210040` |
| 0x22 | `0x00220042` | (absente de la Carte) | `nim_aoc_cmd_0022_Unknown` | `0x10A700` | émulation | entier | `0x00220040` |
| 0x23 | `0x00230282` | (absente de la Carte) | `nim_aoc_cmd_0023_Unknown` | `0x10BD34` | émulation | entier | `0x00230040` |
| 0x24 | `0x00240282` | CalculateContentsRequiredSize | `nim_aoc_cmd_0024_CalculateContentsRequiredSize` | `0x10BD8C` | émulation | entier | `0x002400C2` |
| 0x25 | `0x00250000` | RefreshServerTime | `nim_aoc_cmd_0025_RefreshServerTime` | `0x10B3B4` | émulation | numéro | `0x002500C0` |
| 0x26 | `` | (absente de la Carte) | `nim_aoc_cmd_0026_Unknown` | `0x10BDC8` | émulation | numéro | `0x00260080` |

### `nim:ndm` (aiguillage `nim_ndm_dispatch_command` à `0x105470`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010000` | GetDaemonEventHandle | `nim_ndm_cmd_0001_GetDaemonEventHandle` | `0x10C018` | émulation | numéro | `0x00010042` |
| 0x2 | `0x00020000` | Inconnue | `nim_ndm_cmd_0002_Unknown` | `0x10C028` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030000` | SetDaemonToWorkingState | `nim_ndm_cmd_0003_SetDaemonToWorkingState` | `0x10C038` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040040` | SetDaemonToSuspendedState | `nim_ndm_cmd_0004_SetDaemonToSuspendedState` | `0x10C008` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050000` | GetDaemonState | `nim_ndm_cmd_0005_GetDaemonState` | `0x10BFF8` | émulation | numéro | `0x00050080` |


## Partie 3 : une opération, nim:ndm GetDaemonState

`ndm` demande l'état du démon `nim` (`nim:ndm`, commande 5, `0x00050000`, réponse `0x00050080`). Lu avec `fiches/ndm.md` (`NIMNDM_GetDaemonState`, côté client) : l'aiguillage `0x105470` lit le numéro 5, appelle `nim_ndm_cmd_0005_GetDaemonState` (`0x10BFF8`) qui rend l'état courant du démon (travail, suspendu...), et répond un mot. Les quatre autres commandes sont dans la même fonction de client de `ndm` : `GetDaemonEventHandle` (1), la commande vide 2 (« ne fait rien » d'après 3dbrew), `SetDaemonToWorkingState` (3), `SetDaemonToSuspendedState` (4). Les cinq adresses de gestionnaire sont consécutives (`0x10BFF8` à `0x10C038`). Le corps de ces gestionnaires n'est pas lu.

## Partie 4 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x15629C` | table des quatre pointeurs de noms de services (`nim:u`, `nim:s`, `nim:ndm`, `nim:aoc`) |
| `0x151070` à `0x151878` | les noms des fichiers de `nimdb:` |
| `0x1511BC` à `0x151533` | les adresses https des trois serveurs |
| `0x151BB7` à `0x151DC5` | le gabarit des requêtes SOAP (enveloppe XML) |
| `0x151B08`, `0x151B58` | deux messages de débogage (« the nup/ec debug message can not be read ... ») |
| `0x151A3C` | la table de l'alphabet base 64 |
| `0x151F08`, `0x151EFC` | `autoTitleDelivery`, `taskList` |

## Partie 5 : ce que Pokémon X envoie

Rien : le jeu n'ouvre aucun service de `nim`. Pour le portage PC, `nim` n'a rien à rendre à la place de la console.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les tables de `nim:u` (46 commandes) et `nim:ndm` (5) : voie 1, l'émulation ; voie 2, la Carte (3dbrew), mêmes numéros ; en-têtes complets égaux pour `nim:u` (12 sur 12).
- Les quatre services, les fichiers de `nimdb:` et les adresses de serveurs (chaînes du module).

**Interprété** :
- L'appariement de `0x10557C` à `nim:s` (36 numéros sur 36 retrouvés, mais seulement 20 en-têtes sur 52) et de `0x1039C4` à `nim:aoc` (par élimination).
- Le rôle des fichiers de `nimdb:`, les noms des gestionnaires, l'usage de `nim:ndm`.

**Pas lu** :
- Tout le travail du module : les requêtes SOAP, l'authentification, les tâches de téléchargement, l'installation par `am:net`, la base `nimdb:`.
- Les 17 et 15 commandes non localisées de `nim:s` et `nim:aoc`, et les 58 + 30 commandes sans nom.
- Le nombre de sessions de chaque service.
