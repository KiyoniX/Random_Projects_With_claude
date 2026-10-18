# act, les comptes Nintendo Network

`act` (Account) tient les comptes de la console : le compte « console » (un identifiant local, une fiche par utilisateur de la console), son lien éventuel avec un compte Nintendo Network (NNID) sur le serveur, et les jetons que les services en ligne demandent (service NEX pour les jeux, services indépendants pour les applications système). Les jeux lui parlent par `act:u` pour savoir quel compte est actif et obtenir un jeton ; l'application de réglages (`mint`) passe par `act:a`, qui ajoute la création, la liaison et la suppression des comptes. Les comptes sont rangés dans la sauvegarde propre au module (archive `data:`), les échanges avec le serveur passent par `http:C`.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, module presque tout en Thumb), `outils/emulate_dispatch.py` sur les deux aiguillages (de 0 à 0xFFFF) et la Carte des services (tirée de 3dbrew). Adresses du module chargé à `0x00100000`. **Aucune clé, aucun identifiant de client, aucun identifiant de console n'est reproduit ici** : la fiche dit où `act` les prend et où il les envoie, pas leur valeur.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000003802`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `act`, priorité 60 (`0x3C`) |
| Fichier lu | `local/extrait/act/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x25A50` octets de code (`0x26` pages), `0x1E0C` de données en lecture seule (2 pages), `0x6B8` de données (1 page), `0x183F0` de mémoire à zéro, pile de `0x16000` (la plus grande des modules lus : les requêtes HTTP et le XML sont dans la pile) |
| Fonctions | 1 862 pour Ghidra, dont 1 796 en Thumb et 66 en ARM ; 88 nommées dans `act.noms.tsv`, aucun nom sans fonction |
| Services offerts | `act:u` et `act:a`, 3 sessions chacun : table à `0x126024` (nom, nombre de sessions) |
| Services appelés | lus dans l'exheader : `am:net`, `cfg:s`, `fs:USER`, `http:C`, `ptm:s`, `frd:u`. Dans le code, des chaînes pour `am:net` (`0x1268A2`, la référence à `0x101C6C`), `fs:USER` (`0x1268FB`, `0x101280`), `http:C` (`0x126910` et `0x126917`, `0x101B10` et `0x121D0C`). `cfg:s` et `ptm:s` sont dans la liste de noms de la bibliothèque (`0x127BBF` et suivantes), `frd:u` n'est écrit nulle part |
| Appelants connus | `act:u` : `menu`, `mint`, `olv` (Miiverse), `solv3` ; `act:a` : `mint` (réglages) ; d'après leurs exheaders. `act` et `nim` sont les deux clients d'`am:net` (exheaders). Pokémon X n'ouvre aucun des deux : `act` n'est pas parmi les 37 noms de services que le jeu contient (`pokemon-x-services.md`) |
| Fichiers de `data:` | `uuid.dat`, `common.dat`, `persisid.dat`, `transid.dat` (formats `data://...` à `0x102080`, `0x10217C`, `0x1024FC`, `0x102540`), `account.dat` (`0x102A34`, `0x104130`), `miiimg%02u.dat` (`0x1040DC`) et un dossier par compte `data://%08x/%ls` (`0x126434`, `0x12644C`) |

## Partie 1 : le démarrage et le serveur

`act_main` (`0x10010C`, un seul fil de service) :

1. Enregistre les deux services (`0x100764`, en-tête de commande 3, quatre mots) d'après la table `0x126024` : `act:u`, 3 sessions, `act:a`, 3 sessions.
2. Prépare des objets globaux (initialisations gardées par des indicateurs de première utilisation) et s'abonne à trois notifications de `sm` (`0x100`, `0x104` et `0x105`, par `0x115698`) : l'arrêt, puis la veille et le réveil d'après `fiches/ptm.md` ; interprété.
3. **Boucle** sur `ReplyAndReceive` (enveloppe `0x124C70`) avec neuf poignées au plus : rang 0 la notification de `sm`, rangs 1 et 2 les deux ports, puis les sessions (rangs 3 à 8 : **six sessions au plus à la fois**). Rang 1 ou 2 : `AcceptSession` (`0x124C58`), la session est rangée avec le numéro de son service. Rang de 3 ou plus : une commande ; le module appelle `handler_table[service](session)` avec la table de deux adresses de `0x128288` : `act_u_dispatch_command` (`0x10A898`) et `act_a_dispatch_command` (`0x10B20C`). Une session fermée (`0xC920181A`, constante lue à `0x1003B4`) est retirée (`0x100890`).
4. À l'arrêt : ferme les services et rend la main.

Appels système trouvés : 0x18 SignalEvent, 0x1E CreateMemoryBlock, 0x1F MapMemoryBlock (le bloc partagé d'`Initialize`), 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest (`0x115374`), 0x35 GetProcessId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive. Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les deux aiguillages

Chaque aiguillage lit le numéro de commande dans les 16 bits du haut de l'en-tête, saute à un cas par un `switch` (que Ghidra ne reconstruit pas : `emulate_dispatch.py` l'exécute), et vérifie l'en-tête et les descripteurs. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F`.

Les deux tables ont été exécutées par `emulate_dispatch.py act 0x10a898=act:u 0x10b20c=act:a` (de 0 à 0xFFFF) :

| Aiguillage | Commandes trouvées | Numéros |
| --- | --- | --- |
| `act:u` | 34 | `0x01` à `0x22` |
| `act:a` | 87 | les 34 de `act:u`, plus `0x401` à `0x435` (53) |

**`act:a` a toutes les commandes d'`act:u`**, aux mêmes adresses (vérifié : mêmes numéros, mêmes gestionnaires). La Carte compte 30 commandes pour `act:u` et 83 pour `act:a` (30 + 53) : **le code en accepte 4 de plus** dans les deux services, `0x0A`, `0x20`, `0x21` et `0x22` (voir les notes).

## Partie 3 : les commandes

Les noms et les en-têtes de requête sont ceux de la Carte (3dbrew ; « Inconnue » : la Carte n'a pas de nom). « Source » dit d'où vient l'adresse du gestionnaire. « Vérifié » : l'aiguillage compare l'en-tête de requête en entier ou le numéro seulement. « Réponse » est l'en-tête de réponse de l'émulation.

### `act:u` (aiguillage `act_u_dispatch_command` à `0x10a898`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010084` | Initialize | `act_cmd_0001_Initialize` | `0x1123F8` | émulation | entier | `0x00010040` |
| 0x2 | `0x00020040` | GetErrorCode | `act_cmd_0002_GetErrorCode` | `0x111874` | émulation | numéro | `0x00020080` |
| 0x3 | `0x00030000` | GetLastResponseCode | dans l'aiguillage |  | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | Inconnue | sans nom | `0x11183C` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050082` | GetCommonInfo | `act_cmd_0005_GetCommonInfo` | `0x111640` | émulation | entier | `0x00050042` |
| 0x6 | `0x000600C2` | GetAccountDataBlock | `act_cmd_0006_GetAccountDataBlock` | `0x111184` | émulation | entier | `0x00060042` |
| 0x7 | `0x00070082` | GetResultAsync | dans l'aiguillage |  | émulation | entier | `0x00070082` |
| 0x8 | `0x000800C2` | GetMiiImageData | `act_cmd_0008_GetMiiImageData` | `0x111120` | émulation | entier | `0x00080082` |
| 0x9 | `0x00090180` | SetNfsPassword | `act_cmd_0009_SetNfsPassword` | `0x11106C` | émulation | numéro | `0x00090040` |
| 0xA | `` | (absente de la Carte) | sans nom | `0x110FE8` | émulation | numéro | `0x000A0040` |
| 0xB | `0x000B0042` | AcquireEulaList | `act_cmd_000B_AcquireEulaList` | `0x110FD8` | émulation | entier | `0x000B0040` |
| 0xC | `0x000C0082` | AcquireTimeZoneList | `act_cmd_000C_AcquireTimeZoneList` | `0x110ED8` | émulation | entier | `0x000C0040` |
| 0xD | `0x000D0040` | GenerateUuid | `act_cmd_000D_GenerateUuid` | `0x110E48` | émulation | numéro | `0x000D0140` |
| 0xE | `0x000E0080` | Inconnue | sans nom | `0x110D68` | émulation | numéro | `0x000E0140` |
| 0xF | `0x000F0140` | FindSlotNoByUuid | `act_cmd_000F_FindSlotNoByUuid` | `0x110C9C` | émulation | numéro | `0x000F0080` |
| 0x10 | `0x00100000` | Inconnue | sans nom | `0x110C88` | émulation | numéro | `0x00100040` |
| 0x11 | `0x00110080` | GetTransferableId | `act_cmd_0011_GetTransferableId` | `0x110C00` | émulation | numéro | `0x001100C0` |
| 0x12 | `0x00120102` | AcquireNexServiceToken | `act_cmd_0012_AcquireNexServiceToken` | `0x110AFC` | émulation | entier | `0x00120040` |
| 0x13 | `0x00130002` | GetNexServiceToken | `act_cmd_0013_GetNexServiceToken` | `0x110AAC` | émulation | entier | `0x00130042` |
| 0x14 | `0x00140382` | AcquireIndependentServiceToken | `act_cmd_0014_AcquireIndependentServiceToken` | `0x110988` | émulation | entier | `0x00140040` |
| 0x15 | `0x00150002` | GetIndependentServiceToken | `act_cmd_0015_GetIndependentServiceToken` | `0x110934` | émulation | entier | `0x00150042` |
| 0x16 | `0x00160082` | AcquireAccountInfo | `act_cmd_0016_AcquireAccountInfo` | `0x110860` | émulation | entier | `0x00160040` |
| 0x17 | `0x00170084` | AcquireAccountIdByPrincipalId | `act_cmd_0017_AcquireAccountIdByPrincipalId` | `0x1106C8` | émulation | entier | `0x00170040` |
| 0x18 | `0x00180044` | AcquirePrincipalIdByAccountId | `act_cmd_0018_AcquirePrincipalIdByAccountId` | `0x110568` | émulation | entier | `0x00180040` |
| 0x19 | `0x00190044` | AcquireMii | `act_cmd_0019_AcquireMii` | `0x110468` | émulation | entier | `0x00190040` |
| 0x1A | `0x001A0042` | AcquireAccountInfoEx | `act_cmd_001A_AcquireAccountInfoEx` | `0x110374` | émulation | entier | `0x001A0040` |
| 0x1B | `0x001B0084` | AcquireOtherTypePrincipalID | `act_cmd_001B_AcquireOtherTypePrincipalID` | `0x110360` | émulation | entier | `0x001B0040` |
| 0x1C | `0x001C0342` | Inconnue | sans nom | `0x11025C` | émulation | entier | `0x001C0042` |
| 0x1D | `0x001D0004` | InquireMailAddress | `act_cmd_001D_InquireMailAddress` | `0x11014C` | émulation | entier | `0x001D0042` |
| 0x1E | `0x001E0082` | AcquireEula | `act_cmd_001E_AcquireEula` | `0x110014` | émulation | entier | `0x001E0040` |
| 0x1F | `0x001F0082` (code : `0x001F0042`) | AcquireEulaLanguageList | `act_cmd_001F_AcquireEulaLanguageList` | `0x10FEE4` | émulation | entier | `0x001F0040` |
| 0x20 | `0x00200382` | (absente de la Carte) | sans nom | `0x10FDC0` | émulation | entier | `0x00200040` |
| 0x21 | `0x00210002` | (absente de la Carte) | sans nom | `0x10FD6C` | émulation | entier | `0x00210042` |
| 0x22 | `0x00220342` | (absente de la Carte) | sans nom | `0x10FC68` | émulation | entier | `0x00220042` |

### `act:a` (aiguillage `act_a_dispatch_command` à `0x10b20c`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010084` | Initialize | `act_cmd_0001_Initialize` | `0x1123F8` | émulation | entier | `0x00010040` |
| 0x2 | `0x00020040` | GetErrorCode | `act_cmd_0002_GetErrorCode` | `0x111874` | émulation | numéro | `0x00020080` |
| 0x3 | `0x00030000` | GetLastResponseCode | dans l'aiguillage |  | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | Inconnue | sans nom | `0x11183C` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050082` | GetCommonInfo | `act_cmd_0005_GetCommonInfo` | `0x111640` | émulation | entier | `0x00050042` |
| 0x6 | `0x000600C2` | GetAccountDataBlock | `act_cmd_0006_GetAccountDataBlock` | `0x111184` | émulation | entier | `0x00060042` |
| 0x7 | `0x00070082` | GetResultAsync | dans l'aiguillage |  | émulation | entier | `0x00070082` |
| 0x8 | `0x000800C2` | GetMiiImageData | `act_cmd_0008_GetMiiImageData` | `0x111120` | émulation | entier | `0x00080082` |
| 0x9 | `0x00090180` | SetNfsPassword | `act_cmd_0009_SetNfsPassword` | `0x11106C` | émulation | numéro | `0x00090040` |
| 0xA | `` | (absente de la Carte) | sans nom | `0x110FE8` | émulation | numéro | `0x000A0040` |
| 0xB | `0x000B0042` | AcquireEulaList | `act_cmd_000B_AcquireEulaList` | `0x110FD8` | émulation | entier | `0x000B0040` |
| 0xC | `0x000C0082` | AcquireTimeZoneList | `act_cmd_000C_AcquireTimeZoneList` | `0x110ED8` | émulation | entier | `0x000C0040` |
| 0xD | `0x000D0040` | GenerateUuid | `act_cmd_000D_GenerateUuid` | `0x110E48` | émulation | numéro | `0x000D0140` |
| 0xE | `0x000E0080` | Inconnue | sans nom | `0x110D68` | émulation | numéro | `0x000E0140` |
| 0xF | `0x000F0140` | FindSlotNoByUuid | `act_cmd_000F_FindSlotNoByUuid` | `0x110C9C` | émulation | numéro | `0x000F0080` |
| 0x10 | `0x00100000` | Inconnue | sans nom | `0x110C88` | émulation | numéro | `0x00100040` |
| 0x11 | `0x00110080` | GetTransferableId | `act_cmd_0011_GetTransferableId` | `0x110C00` | émulation | numéro | `0x001100C0` |
| 0x12 | `0x00120102` | AcquireNexServiceToken | `act_cmd_0012_AcquireNexServiceToken` | `0x110AFC` | émulation | entier | `0x00120040` |
| 0x13 | `0x00130002` | GetNexServiceToken | `act_cmd_0013_GetNexServiceToken` | `0x110AAC` | émulation | entier | `0x00130042` |
| 0x14 | `0x00140382` | AcquireIndependentServiceToken | `act_cmd_0014_AcquireIndependentServiceToken` | `0x110988` | émulation | entier | `0x00140040` |
| 0x15 | `0x00150002` | GetIndependentServiceToken | `act_cmd_0015_GetIndependentServiceToken` | `0x110934` | émulation | entier | `0x00150042` |
| 0x16 | `0x00160082` | AcquireAccountInfo | `act_cmd_0016_AcquireAccountInfo` | `0x110860` | émulation | entier | `0x00160040` |
| 0x17 | `0x00170084` | AcquireAccountIdByPrincipalId | `act_cmd_0017_AcquireAccountIdByPrincipalId` | `0x1106C8` | émulation | entier | `0x00170040` |
| 0x18 | `0x00180044` | AcquirePrincipalIdByAccountId | `act_cmd_0018_AcquirePrincipalIdByAccountId` | `0x110568` | émulation | entier | `0x00180040` |
| 0x19 | `0x00190044` | AcquireMii | `act_cmd_0019_AcquireMii` | `0x110468` | émulation | entier | `0x00190040` |
| 0x1A | `0x001A0042` | AcquireAccountInfoEx | `act_cmd_001A_AcquireAccountInfoEx` | `0x110374` | émulation | entier | `0x001A0040` |
| 0x1B | `0x001B0084` | AcquireOtherTypePrincipalID | `act_cmd_001B_AcquireOtherTypePrincipalID` | `0x110360` | émulation | entier | `0x001B0040` |
| 0x1C | `0x001C0342` | Inconnue | sans nom | `0x11025C` | émulation | entier | `0x001C0042` |
| 0x1D | `0x001D0004` | InquireMailAddress | `act_cmd_001D_InquireMailAddress` | `0x11014C` | émulation | entier | `0x001D0042` |
| 0x1E | `0x001E0082` | AcquireEula | `act_cmd_001E_AcquireEula` | `0x110014` | émulation | entier | `0x001E0040` |
| 0x1F | `0x001F0082` (code : `0x001F0042`) | AcquireEulaLanguageList | `act_cmd_001F_AcquireEulaLanguageList` | `0x10FEE4` | émulation | entier | `0x001F0040` |
| 0x20 | `0x00200382` | (absente de la Carte) | sans nom | `0x10FDC0` | émulation | entier | `0x00200040` |
| 0x21 | `0x00210002` | (absente de la Carte) | sans nom | `0x10FD6C` | émulation | entier | `0x00210042` |
| 0x22 | `0x00220342` | (absente de la Carte) | sans nom | `0x10FC68` | émulation | entier | `0x00220042` |
| 0x401 | `0x04010080` | Inconnue | sans nom | `0x108048` | émulation | numéro | `0x04010040` |
| 0x402 | `0x04020000` | CreateConsoleAccount | `act_a_cmd_0402_CreateConsoleAccount` | `0x108FC8` | émulation | numéro | `0x04020040` |
| 0x403 | `0x04030040` | CommitConsoleAccount | `act_a_cmd_0403_CommitConsoleAccount` | `0x108F38` | émulation | numéro | `0x04030040` |
| 0x404 | `0x04040080` | UnbindServerAccount | `act_a_cmd_0404_UnbindServerAccount` | `0x108DC0` | émulation | numéro | `0x04040040` |
| 0x405 | `0x04050040` | DeleteConsoleAccount | `act_a_cmd_0405_DeleteConsoleAccount` | `0x108FDC` | émulation | numéro | `0x04050040` |
| 0x406 | `0x04060240` | Inconnue | sans nom | `0x108A28` | émulation | numéro | `0x04060040` |
| 0x407 | `0x04070000` | Inconnue | sans nom | `0x1090C4` | émulation | numéro | `0x04070040` |
| 0x408 | `0x04080080` | EnableAccountPasswordCache | `act_a_cmd_0408_EnableAccountPasswordCache` | `0x109CD0` | émulation | numéro | `0x04080040` |
| 0x409 | `0x04090040` | SetDefaultAccount | `act_a_cmd_0409_SetDefaultAccount` | `0x108954` | émulation | numéro | `0x04090040` |
| 0x40A | `0x040A0040` | ReplaceAccountId | `act_a_cmd_040A_ReplaceAccountId` | `0x108688` | émulation | numéro | `0x040A0040` |
| 0x40B | `0x040B0040` | GetSupportContext | `act_a_cmd_040B_GetSupportContext` | `0x108750` | émulation | numéro | `0x040B0240` |
| 0x40C | `0x040C0100` | Inconnue | sans nom | `0x109228` | émulation | numéro | `0x040C0040` |
| 0x40D | `0x040D00C0` | Inconnue | sans nom | `0x10A24C` | émulation | numéro | `0x040D0040` |
| 0x40E | `0x040E02C0` | Inconnue | sans nom | `0x109A64` | émulation | numéro | `0x040E0040` |
| 0x40F | `0x040F0280` | Inconnue | sans nom | `0x10A3A4` | émulation | numéro | `0x040F0040` |
| 0x410 | `0x04100040` | Inconnue | sans nom | `0x108D3C` | émulation | numéro | `0x04100040` |
| 0x411 | `0x04110040` | Inconnue | sans nom | `0x109B3C` | émulation | numéro | `0x04110040` |
| 0x412 | `0x041207C0` | UpdateMii | `act_a_cmd_0412_UpdateMii` | `0x108058` | émulation | numéro | `0x04120040` |
| 0x413 | `0x041300C2` | UpdateMiiImage | `act_a_cmd_0413_UpdateMiiImage` | `0x108328` | émulation | entier | `0x04130042` |
| 0x414 | `0x04140182` | InquireAccountIdAvailability | `act_a_cmd_0414_InquireAccountIdAvailability` | `0x10A074` | émulation | entier | `0x04140040` |
| 0x415 | `0x04150EC4` | BindToNewServerAccount | `act_a_cmd_0415_BindToNewServerAccount` | `0x1093D4` | émulation | entier | `0x04150042` |
| 0x416 | `0x041602C4` | BindToExistentServerAccount | `act_a_cmd_0416_BindToExistentServerAccount` | `0x109E84` | émulation | entier | `0x04160042` |
| 0x417 | `0x041702C4` | InquireBindingToExistentServerAccount | `act_a_cmd_0417_InquireBindingToExistentServerAccount` | `0x10A508` | émulation | entier | `0x04170042` |
| 0x418 | `0x04180042` | Inconnue | sans nom | `0x108B58` | émulation | entier | `0x04180040` |
| 0x419 | `0x04190042` | Inconnue | sans nom | `0x108A48` | émulation | entier | `0x04190040` |
| 0x41A | `0x041A01C2` | AcquireAccountTokenEx | `act_a_cmd_041A_AcquireAccountTokenEx` | `0x10914C` | émulation | entier | `0x041A0040` |
| 0x41B | `0x041B0142` | AgreeEula | `act_a_cmd_041B_AgreeEula` | `0x10A620` | émulation | entier | `0x041B0040` |
| 0x41C | `0x041C0042` | SyncAccountInfo | `act_a_cmd_041C_SyncAccountInfo` | `0x1084F8` | émulation | entier | `0x041C0040` |
| 0x41D | `0x041D0080` | Inconnue | sans nom | `0x1094E8` | émulation | numéro | `0x041D0040` |
| 0x41E | `0x041E0182` | UpdateAccountPassword | `act_a_cmd_041E_UpdateAccountPassword` | `0x1092E8` | émulation | entier | `0x041E0040` |
| 0x41F | `0x041F0042` | ReissueAccountPassword | `act_a_cmd_041F_ReissueAccountPassword` | `0x1095B4` | émulation | entier | `0x041F0040` |
| 0x420 | `0x04200180` | SetAccountPasswordInput | `act_a_cmd_0420_SetAccountPasswordInput` | `0x109984` | émulation | numéro | `0x04200040` |
| 0x421 | `0x04210042` | UploadMii | `act_a_cmd_0421_UploadMii` | `0x10A718` | émulation | entier | `0x04210040` |
| 0x422 | `0x04220042` | Inconnue | sans nom | `0x109F9C` | émulation | entier | `0x04220040` |
| 0x423 | `0x04230082` | ValidateMailAddress | `act_a_cmd_0423_ValidateMailAddress` | `0x108E50` | émulation | entier | `0x04230040` |
| 0x424 | `0x04240044` | Inconnue | sans nom | `0x10986C` | émulation | entier | `0x04240042` |
| 0x425 | `0x04250042` | SendConfirmationMail | `act_a_cmd_0425_SendConfirmationMail` | `0x108FEC` | émulation | entier | `0x04250040` |
| 0x426 | `0x04260044` | Inconnue | sans nom | `0x109D6C` | émulation | entier | `0x04260042` |
| 0x427 | `0x04270084` | Inconnue | sans nom | `0x109770` | émulation | entier | `0x04270042` |
| 0x428 | `0x04280044` | ApproveByCreditCard | `act_a_cmd_0428_ApproveByCreditCard` | `0x108A5C` | émulation | entier | `0x04280040` |
| 0x429 | `0x04290082` | SendCoppaCodeMail | `act_a_cmd_0429_SendCoppaCodeMail` | `0x108854` | émulation | entier | `0x04290040` |
| 0x42A | `0x042A0080` | Inconnue | sans nom | `0x108468` | émulation | numéro | `0x042A0040` |
| 0x42B | `0x042B01C4` | Inconnue | sans nom | `0x10838C` | émulation | entier | `0x042B0042` |
| 0x42C | `0x042C0042` | Inconnue | sans nom | `0x1085D0` | émulation | entier | `0x042C0040` |
| 0x42D | `0x042D0042` | Inconnue | sans nom | `0x10A43C` | émulation | entier | `0x042D0040` |
| 0x42E | `0x042E0080` | Inconnue | sans nom | `0x1082D8` | émulation | numéro | `0x042E0040` |
| 0x42F | `0x042F0084` | UpdateAccountInfoEx | `act_a_cmd_042F_UpdateAccountInfoEx` | `0x108964` | émulation | entier | `0x042F0042` |
| 0x430 | `0x04300044` | UpdateAccountMailAddress | `act_a_cmd_0430_UpdateAccountMailAddress` | `0x109BC4` | émulation | entier | `0x04300042` |
| 0x431 | `0x04310042` | Inconnue | sans nom | `0x10968C` | émulation | entier | `0x04310040` |
| 0x432 | `0x04320042` | Inconnue | sans nom | `0x10A2CC` | émulation | entier | `0x04320040` |
| 0x433 | `0x04330042` | Inconnue | sans nom | `0x10815C` | émulation | entier | `0x04330040` |
| 0x434 | `0x04340003` | Inconnue | sans nom | `0x108C30` | pseudo-code | entier | non émulée |
| 0x435 | `0x04350042` | DeleteServerAccount | `act_a_cmd_0435_DeleteServerAccount` | `0x10A174` | émulation | entier | `0x04350040` |


Notes :

- **Quatre commandes absentes de la Carte** (`act:u` et `act:a`) : `0x0A` (numéro seul, réponse `0x000A0040`), `0x20` (`0x00200382`, réponse `0x00200040`), `0x21` (`0x00210002`, réponse `0x00210042`) et `0x22` (`0x00220342`, réponse `0x00220042`). Leurs en-têtes de requête sont ceux du code, vérifiés en entier pour les trois dernières. Leurs gestionnaires (sans nom, sans nom...) sont aux adresses de la table ; ce qu'elles font n'est pas lu.
- **`0x1F` AcquireEulaLanguageList** : l'aiguillage vérifie l'en-tête `0x001F0042` (1 mot ordinaire, 1 descripteur), la Carte donne `0x001F0082`. L'émulation trouve que l'aiguillage compare l'en-tête de la requête à `0x001F0042` et répond `0x001F0040`. L'écart vient de la Carte ou de la version de 3dbrew relue ; le code prime.
- **`0x03` GetLastResponseCode, `0x07` GetResultAsync** : leurs cas sont dans le corps de l'aiguillage (pas de gestionnaire séparé). `0x07` vérifie l'en-tête `0x00070082`.
- **`act:a` `0x434`** : l'émulation a refusé la requête (descripteurs). L'adresse `0x108C30` est la seule fonction que l'aiguillage appelle sans qu'une commande de l'émulation y mène : c'est le gestionnaire, par élimination (pseudo-code, interprété).
- Les gestionnaires qui parlent au serveur (`AcquireNexServiceToken` `0x12`, `AcquireIndependentServiceToken` `0x14`, `AcquireAccountInfo` `0x16`, `AcquireMii` `0x19`, tous les `0x4xx` de la création et de la liaison d'un compte) passent par la couche HTTP de la partie 5.

## Partie 4 : une opération pas à pas, GetAccountDataBlock

`act:u`, commande `0x06` (`0x000600C2`) : un jeu ou une application lit un champ de la fiche d'un compte (3dbrew : « GetAccountDataBlock »). Trois mots ordinaires (le numéro de compte, la taille du tampon, l'identifiant du bloc) et un tampon en écriture. Lu dans `act_cmd_0006_GetAccountDataBlock` (`0x111184`).

1. L'aiguillage vérifie l'en-tête en entier (`0x000600C2`) et le descripteur du tampon, appelle le gestionnaire et répond `0x00060042`.
2. Le gestionnaire prend le numéro de compte : `0xFE` désigne le compte courant (le compte par défaut), les valeurs 1 à 8 sont des emplacements de compte ; `0x114FCC` retrouve la fiche d'un emplacement (rend 0 si l'emplacement est vide : le gestionnaire rend alors un code d'erreur).
3. Un `switch` sur l'identifiant du bloc (`param_5 - 5`, des octets dans une table à `0x1111DC`) choisit **le champ à copier et la taille minimale du tampon** : un octet (par exemple le fanion à `+0x20`, `+0x9A`, `+0xB6`, `+0xB7`, `+0x268`, `+0x377`), 4 octets (`+4`, `+0xB2`, `+0x33C`), 8 octets (`+8` et `+0x100`, deux mots), `0x11`, `0x15` et `0x41` octets pour des chaînes (`+0xA0`, `+0x84`, `+0xC0`, `+0x114`, `+0x340`), et `0x60` octets pour la fiche Mii (`+0x24`). Un tampon trop petit rend un code d'erreur sans rien copier.
4. Les données sont copiées dans le tampon du client (`0x114AFC`) ; pour certains blocs une transformation passe d'abord (`0x1126DC` sur le Mii, `0x120F44` sur le pays, `0x121960` sur la date de naissance).
5. Le gestionnaire rend 0 ; l'aiguillage répond (`0x00060042`, résultat et descripteur du tampon).

Les décalages sont ceux de la fiche d'un compte en mémoire ; ce que chacun contient se lit dans la liste des attributs du module (partie 5), non reliée champ par champ aux décalages.

## Partie 5 : tables en mémoire et réseau

| Adresse | Contenu |
| --- | --- |
| `0x126024` | table des services : (`act:u` 3), (`act:a` 3) ; noms à `0x1278A6` et `0x1278A0` |
| `0x128288` | table des aiguillages : `0x10A899`, `0x10B20D` (adresses Thumb) |
| `0x1003B4` (constante) | `0xC920181A` : session fermée |
| `0x1260F0` | le format d'un UUID en texte (`%02x%02x%02x%02x-%02x%02x-...`) |
| `0x1268A2` à `0x126949` | liste de noms de services (`am:net`, `fs:LDR`, `fs:USER`, `http:C`, `srv:pm`) |
| `0x127B66` à `0x127B85` | les préfixes d'environnement des adresses du serveur : `staging.`, `game-dev.`, `system-dev.`, `library-dev.` |
| `0x1278AC` à `0x127B5D` | les noms des attributs de la fiche d'un compte (`MiiData`, `TimeZoneId`, `AssignedPrincipalId`, `SimpleAddressId`, `AssignedAccountId`, `FpLocalAccountId`, `IsPasswordCacheEnabled`, `IsMailAddressValidated`, `IsServerAccountDeleted`, `IsCommitted`, `NfsPassword`, `AccountPasswordCache`, `AccountPasswordHash`, `MiiName`, `MiiImageUrl`, `BirthMonth`/`BirthYear`/`BirthDay`, `Gender`, `UtcOffset`, `Country`, `LastAuthenticationResult`, `DefaultAccountPersistentId`, `CommonUuid`, `PersistentIdList`, `ClockSequence`, `LastTime`...) : ce sont les clés du format de `account.dat` et de `common.dat` |

**Le réseau.** Les requêtes vers le serveur de comptes sont construites dans `act` : une adresse de la forme `https://%s%saccount.nintendo.net/v%u/api/` (`0x10E564`, avec un préfixe d'environnement), des en-têtes d'authentification (`Basic`, `HashedBasic`, `Bearer`, `0x10DEF4` et `0x10E1CC`), et une série d'en-têtes `X-Nintendo-*` qui présentent la console et le titre : `Platform-ID`, `Device-Type`, `Device-ID`, `Serial-Number`, `System-Version`, `Region`, `Country`, `Client-ID`, `Client-Secret`, `API-Version`, `FPD-Version`, `Environment`, `Title-ID`, `Unique-ID`, `Application-Version`, `Device-Model`, `Device-Cert`, `Date` (de `0x10E4E0` à `0x117874`). Les services déclarés laissent penser que les valeurs viennent d'`am:net` (certificat de l'appareil, par `GetDeviceCert`, `am_cmd_0818_GetDeviceCert` côté `am`), de `cfg:s` (numéro de série, région, pays) et de constantes du module (interprété, les appels ne sont pas suivis) : **deux chaînes de 32 caractères hexadécimaux, à `0x126858` et `0x12687C`, sont l'identifiant et le secret du client** (`Client-ID`, `Client-Secret`). Elles ne sont pas recopiées ici. Le certificat de la console, le numéro de série et les identifiants d'appareil sont lus à l'exécution et ne sont dans aucun fichier du dépôt.

## Partie 6 : ce que Pokémon X envoie

Rien : le jeu n'ouvre ni `act:u` ni `act:a`. Pour le portage PC, `act` n'a rien à rendre à la place de la console.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les deux tables de commandes : 34 pour `act:u`, 87 pour `act:a`. Voie 1 : l'émulation des deux aiguillages. Voie 2 : la Carte des services (3dbrew) : mêmes numéros, mêmes en-têtes quand le code les vérifie, sauf les écarts de la partie 3 (4 commandes de plus dans le code, `0x1F` d'en-tête différent).
- Les noms des services et leurs nombres de sessions (3 et 3), le nombre maximal de sessions (6), la table des deux aiguillages.
- L'existence de l'appel au serveur `account.nintendo.net` et des en-têtes `X-Nintendo-*` (chaînes du module).
- Les noms de fichiers de `data:` et les noms des attributs d'un compte.

**Interprété** :
- Les noms des gestionnaires (de la Carte, `Unknown` sinon), le rôle des quatre commandes ajoutées, le gestionnaire `0x108C30` de `0x434`.
- Le déroulement de GetAccountDataBlock (étapes 2 à 4) : les décalages sont lus, leur sens non.
- Les numéros des trois notifications de `sm`.
- D'où `act` prend chaque valeur des en-têtes `X-Nintendo-*` (`am:net`, `cfg:s`) : déduit des services déclarés et de la Carte, pas suivi appel par appel.

**Pas lu** :
- Le format de `account.dat`, `common.dat`, `uuid.dat`, `persisid.dat`, `transid.dat` et des fichiers de Mii.
- La construction des requêtes (XML), la gestion des réponses, le calcul des jetons et des mots de passe de compte (hachés), le cache de mot de passe.
- Les corps des commandes `0x0A`, `0x20` à `0x22` et de la quasi-totalité des `0x4xx`.
- Le fil de l'état « asynchrone » (`GetResultAsync`).
