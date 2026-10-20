# friends, la liste d'amis et la présence en ligne

`friends` est le module qui tient le compte d'ami de la console : un identifiant principal et un code d'ami, la liste d'amis (au plus 100), la présence en ligne, le mot de passe du réseau des amis, et les demandes d'authentification que les jeux en ligne lui confient (le serveur d'authentification des jeux, appelé NASC). Un jeu lui parle par `frd:u` : il lui dit sa version de bibliothèque, lui demande sa propre présence, la liste de ses amis, et, pour jouer en ligne, une authentification. `frd:a` est la version « administrateur », réservée aux applets système (créer un compte, ajouter un ami, changer de Mii) ; `frd:n` est réservé à `ndm`, qui s'en sert pour suspendre et relancer la connexion de fond.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, le module est presque entièrement en Thumb), `emulate_dispatch.py` et un désassemblage de capstone. Les adresses sont celles du module chargé à `0x00100000`. Le module est gros (4 666 fonctions) mais surtout fait de bibliothèques : la fiche suit le serveur, ses trois aiguillages et les 74 commandes ; le réseau (NASC, serveur d'amis) et le fichier de sauvegarde du compte ne sont pas lus.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000003202`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `friends`, priorité 60 (`0x3C`), version 21.0.0 d'après l'inventaire de la NAND |
| Fichier lu | `local/extrait/friends/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x56CEC` octets de code (87 pages), `0xAFC0` de données en lecture seule (11 pages), `0x2A90` de données (3 pages), `0xAD9E4` de mémoire à zéro, pile de `0x4000` |
| Fonctions | 4 666 pour Ghidra, dont 4 559 en Thumb et 107 en ARM, plus 43 entrées manquées, moins 15 qui ne sont pas des fonctions (deux sorties d'aiguillage, un bloc d'exception, six tests et six corps de boucles) et 7 fonctions mortes : 4 687 ; 215 nommées dans `friends.noms.tsv`, 1 140 avec `local/analyse/friends/noms-proposes.tsv` |
| Services offerts | `frd:u` (54 commandes), `frd:a` (70 : les 54 de `frd:u` plus 16) et `frd:n` (4) ; 8, 8 et 1 sessions déclarées, mais 9 sessions au plus en tout (partie 2). Ils ne sont pas dans l'exheader : un service offert n'a pas à y figurer |
| Services appelés | lus dans l'exheader : `ac:u`, `soc:U`, `http:C`, `fs:USER`, `cfg:s`, `ptm:s`, `ps:ps`, `ptm:sets`, `APT:U`, `nwm::EXT` ; lus dans le code (une fonction d'ouverture par nom, partie 7) : les dix, plus `srv:` (port), `err:f` (port), `ndm:u`, `APT:S` et `APT:A` (essayés juste avant `APT:U`, voir la partie 7) ; `ptm:sysm`, `ptm:gets`, `ptm:play`, `cfg:u`, `gsp::Lcd` et `gsp::Gpu` ont un nom dans le module mais aucune fonction d'ouverture trouvée |
| Dépendances déclarées | huit titres : `ac` (`…2402`), `cfg` (`…1702`), `http` (`…2902`), `nwm` (`…2D02`), `ps` (`…3102`), `ptm` (`…2202`), les sockets (`…2E02`) et `ssl` (`…2F02`) ; les noms viennent de l'inventaire de la NAND |
| Fils | un seul fil de service (le fil principal) ; `svcCreateThread` n'est appelé que par une fonction de bibliothèque (`create_thread_impl`, `0x1033a8`) dont on n'a pas suivi l'usage |

Deux particularités. D'abord, le module n'a qu'**un seul fil qui sert toutes les sessions** (pas de fils de travail comme `ndm`, pas un fil par client comme `hid`) : une commande en attend une autre, et tous les clients partagent un même tampon de requête et un même tampon de réponse. Ensuite, la logique des trois aiguillages est dupliquée : `frd:a` n'est pas `frd:u` plus un cas, c'est une seconde copie du même code (3,1 ko chacune) avec les commandes `0x401` à `0x410` en plus.

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle six fonctions, puis `main`, puis `svcExitProcess` (`0x125230`, `svc 3`) :

1. `clear_bss` (`0x100024`) met à zéro la mémoire à zéro.
2. `0x100070` : met à jour deux champs de l'en-tête des arguments du programme (même gabarit que dans `ndm` et `ac`, interprété).
3. `0x1000bc` : `init_runtime` (`0x1000c8`), qui appelle six petites fonctions de préparation (verrous, non lues), puis `srv_init` (`0x13596c`).
4. `0x1000a8` : une initialisation gardée par un drapeau (non lue).
5. `run_init_array_relative` (`0x10e49c`) : une table de distances relatives (même astuce que dans `hid` et `ndm`), pour les constructeurs globaux.
6. `run_init_array` (`0x100054`) : la table de pointeurs (`0x100068` à `0x10006c`).
7. `main` (`0x100048`, Thumb) : appelle `service_main`.

`srv_init` compte les ouvertures (compteur à `+4` d'un enregistrement) : la première fois, `srv_connect` (`0x100558`) se connecte au port `srv:` (`svcConnectToPort`, `0x1356bc`, avec la même boucle de nouvel essai que `ndm` quand le port n'existe pas encore) puis envoie `SRV_RegisterClient` (`0x100fac`) ; les suivantes ne font qu'augmenter le compteur. Toutes les fonctions d'ouverture de service (partie 7) passent par là.

`service_main` (`0x100104`, 626 octets), dans l'ordre :

1. Pour chacun des trois services de la table à `0x157518` (nom, nombre de sessions) : `strlen` puis `SRV_RegisterService` (`0x1005b4`, en-tête `0x00030100`). La poignée du port est rangée à `0x212430` + rang (le rang 0 est réservé).
2. `ptm_s_open` (`0x100494`) ouvre `ptm:s`.
3. `register_notification_handlers_104_301` (`0x100aec`) inscrit des gestionnaires pour les notifications `0x104` et `0x301` ; puis `service_main` en inscrit pour `0x100`, `0x105` et `0x302` (`register_notification_handler`, `0x135880`), dont les fonctions sont à `0x157268`, `0x157270` et `0x157278` (voir « interprété »).
4. `SRV_EnableNotification` (`0x100fe4`, en-tête `0x00020000`) rend l'événement des notifications ; il va au rang 0 de la liste des poignées.
5. `SRV_Subscribe` (`0x135848`, en-tête `0x00090040`) à `0x105` et `0x302` (les abonnements aux autres numéros n'ont pas été trouvés : voir « interprété »).
6. `0x10078c` (690 octets, pas lue en détail) : elle appelle, par `0x101360`, `friend_manager_ctor`, le constructeur de l'objet principal ; c'est donc là, avant la boucle, que le compte est mis en place.
7. La boucle (partie 2). À la sortie, `SRV_UnregisterService` (`0x100608`, en-tête `0x000400C0`) pour les trois noms, puis `service_shutdown` (`0x100b38`, qui libère deux listes de neuf objets de session), la fermeture de `ptm:s` (`0x100460`) et la sortie de `srv:` (`0x10064c`).

## Partie 2 : la boucle de service

C'est un serveur à un seul fil. La liste des poignées attendues est à `0x212430` : le rang 0 est l'événement des notifications de `srv:`, les rangs 1 à 3 sont les ports des trois services (dans l'ordre de la table : `frd:u`, `frd:a`, `frd:n`), les rangs 4 à 12 sont les sessions ouvertes. Chaque tour appelle `svcReplyAndReceive` (`0x15558c`) avec, comme cible de réponse, la poignée de la session qui vient d'être servie. Selon le rang rendu (lu dans le pseudo-code de `0x100104`) :

- rang 0 : une notification. `handle_srv_notification` (`0x10051c`) lit le numéro (`SRV_ReceiveNotification`, `0x101020`, en-tête `0x000B0000`), cherche le gestionnaire (`find_notification_handler`, `0x100f68`) et l'appelle ;
- rang 1 à 3 : un client se connecte au port. `svcAcceptSession` (`0x155574`), puis `create_session_object` (`0x1006a8`) fabrique un objet de session de 800 octets (`0x320`) selon le service. Il y a au plus 9 sessions en tout, quel que soit le service : au-delà, la nouvelle poignée est fermée tout de suite ;
- rang 4 et plus : une requête. La fonction à l'indice du service dans la table de `0x1642c8` est appelée avec l'objet de session : `frdu_handle_command` (`0x14164c`), `frda_handle_command` (`0x1424b0`) ou `frdn_handle_command` (`0x1414d4`) ;
- poignée fermée par le client (résultat `0xC920181A`) : `remove_session` (`0x100bf8`) ferme la poignée et libère l'objet (`destroy_session_object`, `0x101180`).

**Les tampons.** L'objet de session fixe ses tampons statiques de réception (`setup_frdu_static_buffers`, `0x101212`, et `setup_frda_static_buffers`, `0x101286`, identiques) : les identifiants 0, 1 et 2 prennent la taille de l'objet à `+0x310` (`0x800`) et l'adresse `+0x314`, l'identifiant 3 prend `0x200` octets, l'identifiant 4 prend le reste (`0x600`). Les trois pointent dans la même zone. Les réponses qui renvoient un tampon (liste d'amis, noms, Mii) l'écrivent dans la zone de réponse à `+0x31c`, de `+0x318` octets (`0x1800`). Le même objet serveur (`0x21042c`) fournit ces deux zones à toutes les sessions.

**L'objet de session** (800 octets ; les commandes qui parlent de la session reçoivent `objet + 8`) : `+8` numéro du processus client et `+0xC` version de bibliothèque du client (écrits par SetClientSdkVersion), `+0x1C` dernier résultat de la session (rendu par GetLastResponseResult), `+0x20` drapeau « Login fait » (lu par HasLoggedIn), `+0x21` et `+0x22` drapeaux « données d'authentification prêtes » et « données du localisateur prêtes », suivis de ces données : `+0x30`, `0x138` octets (GetGameAuthenticationData) et `+0x168`, `0x198` octets (GetServiceLocatorData), `+0x308` masque de notifications (écrit par SetNotificationMask), `+0x310` à `+0x31C` la taille et l'adresse de la zone de requête (`0x800`) et de la zone de réponse (`0x1800`). Les données d'authentification sont donc **propres à chaque session**, pas à l'objet principal.

**L'aiguillage.** `frdu_handle_command` lit l'en-tête (`get_tls`, `0x135840`, puis `+0x80`), prend le numéro dans les 16 bits du haut (`bitfield_extract`, `0x127ab0`) et saute par une table (un numéro de `0x37` ou plus est refusé : `cmp #0x37` à `0x141672`). `frda_handle_command` fait de même avec deux tables de saut : une pour les numéros de 1 à `0x36`, une pour `0x401` à `0x410`. `frdn_handle_command` est une suite de comparaisons (4 numéros). Les commandes qui reçoivent une poignée, un tampon ou un numéro de processus vérifient les mots de traduction avec de petites fonctions (`ipc_check_header`, `0x127a5a`, compare l'en-tête entier ; `ipc_check_static_buffer_descriptor`, `0x1274d8` ; `ipc_is_write_buffer_desc`, `0x1272e8` ; `ipc_is_pid_desc`, `0x126998`, mot égal à `0x20`). Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F` ; un en-tête qui ne va pas, `0x00000040` et `0xD9001830` (émulation).

**Les notifications de `srv:`.** Cinq gestionnaires sont inscrits (`0x100`, `0x104`, `0x105`, `0x301`, `0x302`). Les trois dont on a l'adresse : `on_notification_100` (`0x14a9e0`) lève deux drapeaux, dont le premier fait sortir `service_main` de sa boucle dès qu'il ne reste plus de session (probablement l'arrêt du système, par analogie avec `ndm`) ; `on_notification_105` (`0x14a9f4`) appelle une méthode de l'objet principal (`0x1442c8`) et s'arrête sur une erreur ; `on_notification_302` (`0x14aa0a`) appelle `0x1445fc`. Le sens de `0x104`, `0x301` et `0x302` n'est pas établi.

## Partie 3 : les commandes

Les noms et les en-têtes de requête viennent de 3dbrew (la page Friend_Services, lue par la Carte des services) ; la fonction, l'adresse et l'en-tête de réponse sont lus dans le code. La colonne « Vérifié » dit si l'aiguillage compare tout l'en-tête de requête (« entier ») ou seulement le numéro. Les fonctions de travail sont les mêmes pour `frd:u` et `frd:a` ; leur nom commence par `frd_`, celles de `frd:a` seul par `frda_` et celles de `frd:n` par `frdn_`.

### `frd:u` et `frd:a` (les 54 premières)

| N° | En-tête de requête | Commande | Fonction | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 0x01 | `0x00010000` | HasLoggedIn | `frd_0001_HasLoggedIn` | `0x127a94` | numéro | `0x00010080` |
| 0x02 | `0x00020000` | IsOnline | `frd_0002_IsOnline` | `0x127a7c` | numéro | `0x00020080` |
| 0x03 | `0x00030002` | Login | `frd_0003_Login` | `0x127a2c` | entier | `0x00030040` |
| 0x04 | `0x00040000` | Logout | `frd_0004_Logout` | `0x1280f6` | numéro | `0x00040040` |
| 0x05 | `0x00050000` | GetMyFriendKey | `frd_0005_GetMyFriendKey` | `0x1279d0` | numéro | `0x00050140` |
| 0x06 | `0x00060000` | GetMyPreference | `frd_0006_GetMyPreference` | `0x127968` | numéro | `0x00060100` |
| 0x07 | `0x00070000` | GetMyProfile | `frd_0007_GetMyProfile` | `0x127910` | numéro | `0x000700C0` |
| 0x08 | `0x00080000` | GetMyPresence | `frd_0008_GetMyPresence` | `0x1278a8` | numéro | `0x00080042` |
| 0x09 | `0x00090000` | GetMyScreenName | `frd_0009_GetMyScreenName` | `0x12784c` | numéro | `0x000901C0` |
| 0x0A | `0x000A0000` | GetMyMii | `frd_000A_GetMyMii` | `0x1277f4` | numéro | `0x000A0640` |
| 0x0B | `0x000B0000` | GetMyLocalAccountId | `frd_000B_GetMyLocalAccountId` | `0x1277a0` | numéro | `0x000B0080` |
| 0x0C | `0x000C0000` | GetMyPlayingGame | `frd_000C_GetMyPlayingGame` | `0x127744` | numéro | `0x000C0140` |
| 0x0D | `0x000D0000` | GetMyFavoriteGame | `frd_000D_GetMyFavoriteGame` | `0x1276ec` | numéro | `0x000D0140` |
| 0x0E | `0x000E0000` | GetMyNcPrincipalId | `frd_000E_GetMyNcPrincipalId` | `0x127680` | numéro | `0x000E0080` |
| 0x0F | `0x000F0000` | GetMyComment | `frd_000F_GetMyComment` | `0x127624` | numéro | `0x000F0280` |
| 0x10 | `0x00100040` | GetMyPassword | `frd_0010_GetMyPassword` | `0x1275ac` | numéro | `0x00100042` |
| 0x11 | `0x00110080` | GetFriendKeyList | `frd_0011_GetFriendKeyList` | `0x1274f8` | numéro | `0x00110082` |
| 0x12 | `0x00120042` | GetFriendPresence | `frd_0012_GetFriendPresence` | `0x127410` | entier | `0x00120042` |
| 0x13 | `0x00130142` | GetFriendScreenName | `frd_0013_GetFriendScreenName` | `0x127300` | entier | `0x00130044` |
| 0x14 | `0x00140044` | GetFriendMii | `frd_0014_GetFriendMii` | `0x127240` | entier | `0x00140042` |
| 0x15 | `0x00150042` | GetFriendProfile | `frd_0015_GetFriendProfile` | `0x127198` | entier | `0x00150042` |
| 0x16 | `0x00160042` | GetFriendRelationship | `frd_0016_GetFriendRelationship` | `0x12710c` | entier | `0x00160042` |
| 0x17 | `0x00170042` | GetFriendAttributeFlags | `frd_0017_GetFriendAttributeFlags` | `0x127090` | entier | `0x00170042` |
| 0x18 | `0x00180044` | GetFriendPlayingGame | `frd_0018_GetFriendPlayingGame` | `0x126fd8` | entier | `0x00180042` |
| 0x19 | `0x00190042` | GetFriendFavoriteGame | `frd_0019_GetFriendFavoriteGame` | `0x126f2c` | entier | `0x00190042` |
| 0x1A | `0x001A00C4` | GetFriendInfo | `frd_001A_GetFriendInfo` | `0x126e8c` | entier | `0x001A0042` |
| 0x1B | `0x001B0080` | IsIncludedInFriendList | `frd_001B_IsIncludedInFriendList` | `0x126e30` | numéro | `0x001B0080` |
| 0x1C | `0x001C0042` | UnscrambleLocalFriendCode | `frd_001C_UnscrambleLocalFriendCode` | `0x126dac` | entier | `0x001C0042` |
| 0x1D | `0x001D0002` | UpdateGameModeDescription | `frd_001D_UpdateGameModeDescription` | `0x126cb8` | entier | `0x001D0040` |
| 0x1E | `0x001E02C2` | UpdateMyPresence | `frd_001E_UpdateMyPresence` | `0x126ba4` | entier | `0x001E0040` |
| 0x1F | `0x001F0042` | SendInvitation | `frd_001F_SendInvitation` | `0x126a88` | entier | `0x001F0040` |
| 0x20 | `0x00200002` | AttachToEventNotification | `frd_0020_AttachToEventNotification` | `0x126a5c` | entier | `0x00200040` |
| 0x21 | `0x00210040` | SetNotificationMask | dans l'aiguillage | - | numéro | `0x00210040` |
| 0x22 | `0x00220040` | GetEventNotification | `frd_0022_GetEventNotification` | `0x126a34` | numéro | `0x002200C2` |
| 0x23 | `0x00230000` | GetLastResponseResult | dans l'aiguillage | - | numéro | `0x00230040` |
| 0x24 | `0x00240040` | PrincipalIdToFriendCode | dans l'aiguillage | - | numéro | `0x002400C0` |
| 0x25 | `0x00250080` | FriendCodeToPrincipalId | `frd_0025_FriendCodeToPrincipalId` | `0x126a24` | numéro | `0x00250080` |
| 0x26 | `0x00260080` | IsValidFriendCode | dans l'aiguillage | - | numéro | `0x00260080` |
| 0x27 | `0x00270040` | ResultToErrorCode | `frd_0027_ResultToErrorCode` | `0x1269ac` | numéro | `0x00270080` |
| 0x28 | `0x00280244` | RequestGameAuthentication | `frd_0028_RequestGameAuthentication` | `0x126890` | entier | `0x00280040` |
| 0x29 | `0x00290000` | GetGameAuthenticationData | `frd_0029_GetGameAuthenticationData` | `0x126864` | numéro | `0x00290042` |
| 0x2A | `0x002A0204` | RequestServiceLocator | `frd_002A_RequestServiceLocator` | `0x126748` | entier | `0x002A0040` |
| 0x2B | `0x002B0000` | GetServiceLocatorData | `frd_002B_GetServiceLocatorData` | `0x12671c` | numéro | `0x002B0042` |
| 0x2C | `0x002C0002` | DetectNatProperties | `frd_002C_DetectNatProperties` | `0x12666c` | entier | `0x002C0040` |
| 0x2D | `0x002D0000` | GetNatProperties | `frd_002D_GetNatProperties` | `0x1265f8` | numéro | `0x002D00C0` |
| 0x2E | `0x002E0000` | GetServerTimeDifference | `frd_002E_GetServerTimeDifference` | `0x12659c` | numéro | `0x002E00C0` |
| 0x2F | `0x002F0040` | AllowHalfAwake | `frd_002F_AllowHalfAwake` | `0x127ef4` | numéro | `0x002F0040` |
| 0x30 | `0x00300000` | GetServerTypes | `frd_0030_GetServerTypes` | `0x126534` | numéro | `0x00300100` |
| 0x31 | `0x00310082` | GetFriendComment | `frd_0031_GetFriendComment` | `0x126488` | entier | `0x00310042` |
| 0x32 | `0x00320042` | SetClientSdkVersion | dans l'aiguillage | - | entier | `0x00320040` |
| 0x33 | `0x00330000` | GetMyApproachContext | `frd_0033_GetMyApproachContext` | `0x1263dc` | numéro | `0x00330042` |
| 0x34 | `0x00340046` | AddFriendWithApproach | `frd_0034_AddFriendWithApproach` | `0x12626c` | refusé par l'émulation (voir plus bas) | `0x00340040` (pseudo-code) |
| 0x35 | `0x00350082` | DecryptApproachContext | `frd_0035_DecryptApproachContext` | `0x12622c` | refusé par l'émulation (voir plus bas) | `0x00350042` (pseudo-code) |
| 0x36 | `0x00360000` | GetExtendedNatProperties | `frd_002D_GetNatProperties` | `0x1265f8` | numéro | `0x00360100` |

Remarques sur le tableau :
- **Cinq commandes n'ont pas de fonction à elles** : SetNotificationMask (écrit le mot dans `+0x308` de la session), GetLastResponseResult (rend `+0x1C` de la session), PrincipalIdToFriendCode, IsValidFriendCode et SetClientSdkVersion (écrit la version dans `+0xC` et le numéro de processus dans `+8`) sont écrites dans l'aiguillage. `0x24` appelle `principal_id_to_friend_code` (`0x128134`) et rend `0xE0E0C4EB` quand le code obtenu est nul (identifiant principal nul) ; `0x26` appelle `friend_code_is_valid` (`0x128106`) ; `0x25` appelle `frd_0025_FriendCodeToPrincipalId`, qui passe par la même validation, et rend `0xE0E0C401` pour un code invalide (ces deux résultats sont ceux que l'émulation obtient sur un état vide).
- **Deux commandes sont refusées par l'émulation** : `0x34` et `0x35` vérifient des mots de traduction que `emulate_dispatch.py` ne sait pas fabriquer (« refusé malgré les descripteurs essayés »). Leur fonction et leurs en-têtes (requête `0x00340046`, `0x00350082` ; réponse `0x00340040`, `0x00350042`) sont lus dans le pseudo-code de l'aiguillage seulement : appels `frd_0034_AddFriendWithApproach` et `frd_0035_DecryptApproachContext`, `ipc_check_header` avec `0x34, 1, 6` et `0x35, 2, 2`, `ipc_set_header` avec `0x34, 1, 0` et `0x35, 1, 2`. C'est la seule voie, d'où leur place dans « interprété ».
- **Les numéros `0x2D` et `0x36` partagent une fonction** (`frd_002D_GetNatProperties`, `0x1265f8`, qui rend trois valeurs) : `0x2D` n'en rend que deux, `0x36` les trois.
- Le pseudo-code de `0x14164c` mélange par endroits des blocs de `0x1424b0` (la table de saut de `0x1424de`) : c'est un défaut de la reconstruction de Ghidra, pas un second aiguillage. L'émulation, qui exécute le code, est la voie fiable pour `frd:u` et `frd:a`.

### `frd:a` seul

| N° | En-tête de requête | Commande | Fonction | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 0x401 | `0x04010100` | CreateLocalAccount | `frda_0401_CreateLocalAccount` | `0x141134` | numéro | `0x04010040` |
| 0x402 | `0x04020040` | DeleteLocalAccount | `frda_0402_DeleteLocalAccount` | `0x141164` | numéro | `0x04020040` |
| 0x403 | `0x04030040` | LoadLocalAccount | `frda_0403_LoadLocalAccount` | `0x141110` | numéro | `0x04030040` |
| 0x404 | `0x04040000` | UnloadLocalAccount | `frda_0404_UnloadLocalAccount` | `0x141188` | numéro | `0x04040040` |
| 0x405 | `0x04050000` | SaveLocalAccountData | `frda_0405_SaveLocalAccountData` | `0x1261cc` | numéro | `0x04050040` |
| 0x406 | `0x04060042` | AddFriendOnline | `frda_0406_AddFriendOnline` | `0x144898` | entier | `0x04060040` |
| 0x407 | `0x04070D80` | AddFriendOffline | `frda_0407_AddFriendOffline` | `0x12600c` | numéro | `0x04070040` |
| 0x408 | `0x040802C0` | UpdateFriendScreenName | `frda_0408_UpdateFriendScreenName` | `0x1446a4` | numéro | `0x04080040` |
| 0x409 | `0x04090100` | RemoveFriend | `frda_0409_RemoveFriend` | `0x143b24` | numéro | `0x04090040` |
| 0x40A | `0x040A0100` | UpdatePlayingGame | `frda_040A_UpdatePlayingGame` | `0x1440fc` | numéro | `0x040A0040` |
| 0x40B | `0x040B00C0` | UpdatePreference | `frda_040B_UpdatePreference` | `0x143f7c` | numéro | `0x040B0040` |
| 0x40C | `0x040C0800` | UpdateMii | `frda_040C_UpdateMii` | `0x144980` | numéro | `0x040C0040` |
| 0x40D | `0x040D0100` | UpdateFavoriteGame | `frda_040D_UpdateFavoriteGame` | `0x144368` | numéro | `0x040D0040` |
| 0x40E | `0x040E0040` | SetNcPrincipalId | `frda_040E_SetNcPrincipalId` | `0x144402` | numéro | `0x040E0040` |
| 0x40F | `0x040F0240` | UpdateComment | `frda_040F_UpdateComment` | `0x143c90` | numéro | `0x040F0040` |
| 0x410 | `0x04100000` | IncrementMoveCount | `frda_0410_IncrementMoveCount` | `0x144248` | numéro | `0x04100040` |

Seule AddFriendOnline (`0x406`) a son en-tête vérifié en entier. Les autres en-têtes de requête de ce tableau sont ceux de 3dbrew ; le pseudo-code de `frda_handle_command` lit des arguments qui leur correspondent mot pour mot : `0x401` quatre mots (un octet, deux mots, un octet), `0x402` et `0x403` un octet, `0x407` les trois blocs à `+4`, `+0x14` et `+0x74` d'une requête de 54 mots, `0x408` une clé d'ami à `+4`, un nom à `+0x14` et un octet à `+0x2C`, `0x409` une clé d'ami à `+4`, `0x40A` et `0x40D` un identifiant de jeu de 16 octets, `0x40B` trois octets, `0x40C` un Mii (`+4`, `+0x64`) et deux octets, `0x40E` un mot, `0x40F` un commentaire de 36 octets.

### `frd:n`

| N° | En-tête de requête | Commande | Fonction | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 0x01 | `0x00010000` | GetHandleOfNdmStatusChangedEvent | dans l'aiguillage | - | numéro | `0x00010042` |
| 0x02 | `0x00020000` | Resume | `frdn_0002_Resume` | `0x127c36` | numéro | `0x00020040` |
| 0x03 | `0x00030040` | SuspendAsync | `frdn_0003_SuspendAsync` | `0x143ba4` | numéro | `0x00030040` |
| 0x04 | `0x00040000` | QueryStatus | `frdn_0004_QueryStatus` | `0x127bec` | numéro | `0x00040080` |

Ce que fait chaque commande (lu dans le pseudo-code) :
- 1 rend l'événement gardé dans l'objet principal à `+0x5C0`, en poignée copiée (en-tête `0x00010042`, mot 2 nul, mot 3 la poignée) ;
- 2 pose l'état demandé `+0x5B8` à 2 et, si l'état de connexion `+0x5B6` est 0 et que `+0x5B9` aussi, lit un réglage (`0xD0000`, un octet) et, s'il est non nul, lance la connexion (`0x125980`) ; sinon, si l'ancien état demandé n'était pas 2, signale l'événement de `+0x5C0` ;
- 3 pose `+0x5B8` à (octet de la requête) xor 1 ; si l'état de connexion est 2, arrête la connexion (`0x125b74`) ; sinon, si l'ancien état demandé était 2, signale l'événement ;
- 4 rend un octet de 0 à 3 : 2 si l'état demandé est 0 ou 1 et que la connexion existe (états 1 à 3), 1 si l'état demandé est 2 et la connexion absente, 0 si l'état demandé est 2 et la connexion existe, 3 sinon.

Ces quatre commandes sont celles que `ndm` envoie à `frd:n` (`FRDN_GetHandleOfNdmStatusChangedEvent` à `FRDN_QueryStatus` dans `ndm.noms.tsv` : mêmes en-têtes). Le sens des états est interprété.

## Partie 4 : GetFriendKeyList, pas à pas

C'est la commande `0x11`, que Pokémon X envoie à l'ouverture de `frd:u`.

1. **L'aiguillage.** `frdu_handle_command` lit le décalage (mot 1) et le nombre maximal d'entrées (mot 2). Le nombre est ramené au plus petit de lui-même et de la taille de la zone de réponse divisée par 16 (`min_u32`, `0x130524`).
2. **Le compte chargé.** `frd_0011_GetFriendKeyList` (`0x1274f8`) vérifie ses pointeurs (sinon `0xE0E0C7F6`), puis appelle `check_local_account_loaded` (`0x134d10`) avec l'état du compte à `+0x1A8` de l'objet principal. Si aucun compte local n'est chargé, `translate_internal_error` (`0x134f64`) transforme le code interne en résultat du module et la commande s'arrête là.
3. **La liste.** La liste d'amis est un vecteur d'entrées de 600 octets (`0x258`) à `+0x2B4`. Le décalage est ramené à la taille de la liste, puis `min(taille - décalage, maximum)` entrées sont copiées.
4. **La copie.** Pour chaque entrée, la clé d'ami (16 octets, de `+4` à `+0x14` de l'entrée : identifiant principal, remplissage, code d'ami) est écrite dans la zone de réponse.
5. **La réponse.** En-tête `0x00110082` : le résultat, le nombre d'entrées lues, puis le descripteur d'un tampon statique (identifiant 0) de `nombre × 16` octets.

Un compte sans ami donne donc : résultat 0, nombre 0, tampon vide. Le jeu limite lui-même sa demande à 100 entrées (`0x1106b8` refuse un nombre de `0x65` ou plus et un pointeur nul).

## Partie 5 : les codes d'ami, les codes d'erreur

**Le code d'ami** (`principal_id_to_friend_code`, `0x128134`, et `friend_code_is_valid`, `0x128106`). Le code d'ami est un mot de 64 bits : l'identifiant principal en bas, et en haut le premier octet de l'empreinte SHA-1 de l'identifiant (écrit sur 4 octets, petit boutiste) décalé d'un bit vers la droite. L'empreinte est `sha1_hash` (`0x140338`, avec `sha1_init` `0x140090`, `sha1_update` `0x140304`, `sha1_final` `0x14030c`) : les constantes d'initialisation et de tour de SHA-1 sont dans le module (`0x67452301` à `0x13fd70`, `0xC3D2E1F0` à `0x1400b8`, `0x5A827999` à `0x1402f4`, `0x6ED9EBA1`, `0x8F1BBCDC`, `0xCA62C1D6` à la suite). `friend_code_is_valid` rend vrai si le code n'est pas nul, si la partie haute vaut au plus `0x7F` et si le recalcul redonne le code : c'est la description de 3dbrew.

**ResultToErrorCode** (`frd_0027_ResultToErrorCode`, `0x1269ac`, lu dans l'assembleur et le pseudo-code). Le résultat reçu est découpé en module (bits 10 à 17), description (bits 0 à 9) et signe :
- si le module n'est pas `0x31` (49, celui de `friends`), l'erreur rendue est 0 et le résultat de la commande est `0xE0E0C403` ;
- si le module est `0x31` et que le résultat n'est pas négatif, l'erreur est 0 et le résultat 0 ;
- sinon, si la description vaut `0x101` (257) : `20000 + n` quand le champ `+0x56C` de l'objet principal vaut 200 (`n` vient de `0x143f58`, non lue), `23000` sinon ;
- sinon, avec `q = description >> 5` et `r = description & 0x1F` : si `q` vaut 0 ou `0x1F`, l'erreur est 0, sinon `10000 + 100 × q + r`.

Les trois constantes (10000, 20000, 23000) sont dans une petite table à `0x164284`. C'est ce que 3dbrew décrit (« XXX-YYYY en nombre ») ; la formule est la seule chose qu'un remplaçant doit réimplémenter pour que les codes d'erreur d'un jeu s'affichent comme sur la console.

## Partie 6 : l'état en mémoire

L'objet principal (`get_friend_manager`, `0x135494`, rend le pointeur gardé dans une variable globale ; construit par `friend_manager_ctor`, `0x101fc4`, interprété) est le même pour toutes les sessions. Les champs lus par les commandes :

| Décalage | Contenu (d'après la commande qui le lit) |
| --- | --- |
| `+0x05` | octet « en ligne » (IsOnline) |
| `+0x1A8` | état du compte local (vérifié par `check_local_account_loaded` avant presque toutes les commandes de lecture) |
| `+0x1AC` | numéro du compte local (GetMyLocalAccountId) |
| `+0x1B0`, `+0x1B8` | identifiant principal, puis code d'ami sur 8 octets (GetMyFriendKey) |
| `+0x1C0` | NcPrincipalId (GetMyNcPrincipalId) |
| `+0x1C8` | chaîne du mot de passe du réseau (GetMyPassword) |
| `+0x1D8` à `+0x1DA` | les trois octets de GetServerTypes |
| `+0x1E0` à `+0x1E2` | les trois booléens de GetMyPreference |
| `+0x1E8` | le jeu favori, 16 octets (GetMyFavoriteGame) |
| `+0x204` | le commentaire, 17 caractères UTF-16 (GetMyComment) |
| `+0x240` | le Mii, `0x60` octets (GetMyMii) |
| `+0x248` | pointeur vers le nom d'écran, 11 caractères UTF-16 (GetMyScreenName) |
| `+0x260`, `+0x284` | la présence, puis un pointeur vers la description du mode de jeu de 128 caractères (GetMyPresence, `0x12C` octets au total avec la présence de `0x2C`) |
| `+0x268` | le jeu en cours, 16 octets (GetMyPlayingGame) : il tombe à l'intérieur de la zone de la présence |
| `+0x2B0` | la liste d'amis (vecteur à `+0x2B4`, entrées de 600 octets), suivie d'une entrée de remplacement à `+0x2C8` pour les clés inconnues |
| `+0x560` | deux mots qui servent à GetServerTimeDifference |
| `+0x56C` | un entier qui vaut 200 ou non (ResultToErrorCode) |
| `+0x5B5`, `+0x5B6`, `+0x5B8`, `+0x5B9` | états de connexion et de suspension (Login, `frd:n`) |
| `+0x5C0` | l'événement de `frd:n` |
| `+0x11E0`, `+0x1204` | requêtes en cours (authentification, localisateur de service) |
| `+0x1220`, `+0x1225` | `+0x1220` est lu par GetFriendInfo ; `+0x1225` est un octet fixé à la construction (`0x102dfc`) et lu par GetFriendScreenName |

La relation d'un ami (`frd_0016_GetFriendRelationship`) donne ses attributs (`frd_0017_GetFriendAttributeFlags`) par une table de six mots à `0x1571E4` : relation 0 donne 0, 1 donne 3, 2 donne 0, 3 donne 1, 4 donne 1, 5 donne 0, et une relation de 6 ou plus donne 0. Une clé absente de la liste prend l'entrée de remplacement, dont la relation est 2 : ses attributs sont donc 0 (comme 3dbrew le dit).

Résultats d'erreur que les commandes rendent (valeurs lues dans les constantes des fonctions ; toutes sont du module 49 ; le sens est interprété d'après la condition qui les produit) :
- `0xE0E0C7F6` : pointeur de sortie nul (presque toutes les commandes) ;
- `0xD8A0C402` : session non connectée (GetServerTimeDifference ; RequestGameAuthentication et RequestServiceLocator quand la version de bibliothèque donnée par SetClientSdkVersion, dans `+0xC` de la session, est inférieure à `0x03010000`) ;
- `0xC8A0C7F0` : une demande d'authentification ou de localisateur est déjà en cours (`+0x11E0` de l'objet principal non nul) ;
- `0xC8A0C7EF` : GetGameAuthenticationData et GetServiceLocatorData avant que la demande ait abouti (le résultat est fabriqué par `0x133800` avec `5` et `0x3EF` : valeur calculée, pas lue) ;
- `0xC8A0C7EA` : AddFriendWithApproach refusé à cause de l'état de la session ;
- `0xD8A0C4FA` : l'option « historique affiché » (IsShowPlayedMode, `+0x1E2`) est activée ; `0xD8A0C4F8` : pas de Mii personnel ; `0xE0E0C4E9` : Mii invalide dans le contexte reçu (AddFriendWithApproach, d'accord avec 3dbrew) ; les deux premiers sont aussi rendus par GetMyApproachContext, avec `0xD860C4F2` quand la liste compte déjà 100 amis ;
- `0xE0E0C4EB` et `0xE0E0C401` : PrincipalIdToFriendCode et FriendCodeToPrincipalId sur un identifiant ou un code nul ou invalide.

## Partie 7 : les services que `friends` appelle

Chaque service a une fonction d'ouverture, qui appelle `srv_init` puis `srv_get_service_handle` (`0x13528c`, ou `get_service_handle_by_name`, `0x135702`, qui passe par `strlen`) et donc `SRV_GetServiceHandle` (`0x102948`, en-tête `0x00050100`) : le nom du service est dans une chaîne du module (ou une table de pointeurs de noms, `0x158874` pour `cfg:s`, `0x1588f8` à `0x15890C` pour les `ptm:*`, `0x1645CC` pour `APT:S` et `APT:U`), et la fonction est repérée par ses références à cette chaîne.

| Service | Fonction d'ouverture | Adresse |
| --- | --- | --- |
| `ac:u` | `ac_u_open` | `0x100c74` |
| `fs:USER` | `fs_init` (ouvre `fs:USER` puis initialise la session du système de fichiers) | `0x100d4c` |
| `nwm::EXT` | `nwm_ext_open` | `0x100f30` |
| `http:C` | `http_c_open` | `0x101a14` |
| `soc:U` | `soc_u_open` | `0x101be0` |
| `ps:ps` | `ps_ps_open`, `ps_ps_open_second` | `0x1038c0`, `0x113190` |
| `cfg:s` | `cfg_s_open` | `0x1043e0` |
| `err:f` | `errf_connect` | `0x103544` |
| `ptm:s` | `ptm_s_open` | `0x100494` |
| `ptm:sets` | `ptm_sets_open` | `0x13f36c` |
| `APT:S`, `APT:U`, `APT:A` (nom par défaut en `[0x1645F4]`) | `apt_choose_service_s`, `apt_choose_service_u` choisissent le nom ; `apt_open_session` ouvre la session avec le nom choisi, `APT:A` si aucun ne l'est | `0x102a0c`, `0x103d38`, `0x104c68` |
| `ndm:u` | `ndm_u_open` | `0x1107f8` |

Le serveur d'authentification des jeux (NASC) est joint par `http:C` : le module contient trois adresses `https` (production, test, développement), et d'après 3dbrew il ajoute les certificats par défaut 1, 2 et 3 (non vérifié dans le code). Le module contient aussi la chaîne `data:` (à `0x161220`, neuf références, sans doute le point de montage de son fichier de sauvegarde ; usage non lu).

`0x102a0c` et `0x103d38` ne font que choisir le nom `APT:S` ou `APT:U` (`0x133a14`, s'il n'est pas déjà choisi) ; `0x104c68` ouvre la session `[0x16461C]` avec le nom choisi (`APT:A`, `[0x1645F4]`, si aucun ne l'a été), et `0x104cd0` (`apt_connect`) réessaie avec `APT:U` si le premier essai échoue : la bibliothèque essaie d'abord la variante privilégiée, puis `APT:U`, la seule que l'exheader autorise (même mécanisme que `boss` côté jeu).

Ce que ces services font pour `friends` n'est pas lu, hors l'ouverture : voir « pas lu ».

## Partie 8 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ExitProcess | `0x03` | `svcExitProcess` | `0x125230` |
| CreateThread | `0x08` | `svcCreateThread` | `0x155600` |
| ExitThread | `0x09` | `svcExitThread` | `0x155810` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x132694` |
| SetThreadPriority | `0x0C` | `svcSetThreadPriority` | `0x155afc` |
| CreateMutex | `0x13` | `svcCreateMutex` | `0x156650` |
| ReleaseMutex | `0x14` | `svcReleaseMutex` | `0x155908` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x135100` |
| SignalEvent | `0x18` | `svcSignalEvent` | `0x155818` |
| ClearEvent | `0x19` | `svcClearEvent` | `0x15574c` |
| CreateMemoryBlock | `0x1E` | `svcCreateMemoryBlock` | `0x1555e4` |
| UnmapMemoryBlock | `0x20` | `svcUnmapMemoryBlock` | `0x155624` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x1555a4` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x1557f8` |
| CloseHandle | `0x23` | `svcCloseHandle` | `0x135830` |
| WaitSynchronization1 | `0x24` | `svcWaitSynchronization1` | `0x132c08` |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x155958` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x156668` |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x131db8` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x1555c8` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x1356bc` |
| SendSyncRequest | `0x32` | `svcSendSyncRequest` | `0x135680` |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x134070` |
| GetThreadId | `0x37` | `svcGetThreadId` | `0x131764` |
| Break | `0x3C` | `svcBreak` | `0x155744` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x155574` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x15558c` |

Ces 27 appels sont tous dans le masque d'appels système de l'exheader, lu avec un décodage des capacités du noyau qui n'a pas été recoupé. Un bloc de 288 octets à `0x1554b4` (ARM) contient aussi quatre `svc` (`0x21`, `0x2B`, `0x4A`, `0x4F`) : c'est probablement un paquet d'enveloppes que Ghidra a fondues en une fonction ; les enveloppes isolées ci-dessus sont celles qu'appelle le code. ControlMemory (`0x01`) n'apparaît pas : le module n'agrandit pas son tas par cet appel.

## Partie 9 : ce que Pokémon X envoie

Les 22 lignes de `pokemon-x-services.tsv` pour `frd:u`. Le jeu ouvre `frd:u` par `frd_open_session` (`0x110528`, compteur d'ouvertures, poignée à `0x5e7f24`) ; il n'ouvre ni `frd:a` ni `frd:n`. Ce qu'il fait à l'ouverture (lu dans le pseudo-code du jeu, `local/analyse/maj/gh/pseudo/`) : ouvrir le service, envoyer **SetClientSdkVersion** avec la valeur `0x050200C8` (le résultat n'est pas regardé), puis **GetMyPresence** dans un tampon de 300 octets (`0x12C` : la présence et la description) et, si le résultat n'est pas négatif, ranger le mot du déplacement 8 de la présence (l'identifiant de partie à rejoindre, d'après 3dbrew) dans un champ de sa bibliothèque. Si le service n'existe pas, `frd_open_session` rend l'erreur et rien d'autre n'est tenté.

Seize commandes sont atteintes depuis le point d'entrée du jeu et six seulement par un `.cro` (colonne « Atteinte »). Un programme qui prend la place de la console a trois niveaux de réponse possibles : **vrai** (que le jeu puisse en tirer ce qu'il attend), **neutre** (des zéros et un résultat 0) et **échec** (un résultat négatif, que la bibliothèque du jeu traduit en erreur ou en valeur par défaut).

| En-tête | Commande | Fonction du jeu | Appelants du jeu | Fonction du module | Ce qu'il faut rendre |
| --- | --- | --- | --- | --- | --- |
| `0x00320042` | SetClientSdkVersion | `0x11b87c` | 1 : `frd_open_session` | dans `frdu_handle_command` | résultat 0 (`0x00320040`) ; garder le numéro de version par session n'est utile qu'à une imitation fidèle |
| `0x00080000` | GetMyPresence | `0x11b7c4` | 1 : `frd_open_session` | `frd_0008_GetMyPresence` (`0x1278a8`) | résultat 0 (`0x00080042`) et un tampon statique (identifiant 0) de 300 octets, **neutre** : des zéros (aucune partie à rejoindre). Le jeu n'en garde qu'un mot |
| `0x00010000` | HasLoggedIn | `0x173870` | 3 : `0x165424`, `0x2d1fb0`, `0x2d2144` | `frd_0001_HasLoggedIn` (`0x127a94`) | résultat 0 et, au mot 2, un octet : 1 seulement si la session a fait Login (`+0x20` de la session) et que le module est en ligne (`+5` de l'objet principal). Un remplaçant sans réseau rend **0** (en-tête `0x00010080`) |
| `0x00030002` | Login | `0x1654f0` | 1 : `0x14a438`, dans `0x14a3bc` (qui vérifie un drapeau d'initialisation et que la poignée de l'événement n'est pas nulle) | `frd_0003_Login` (`0x127a2c`) | le jeu donne un événement à signaler quand la connexion est finie. **À choisir** : soit résultat 0 et signaler l'événement tout de suite (la connexion « finit » hors ligne, HasLoggedIn rend 0), soit un résultat négatif. Ce que le jeu fait en attendant l'événement n'est pas lu : signaler l'événement évite qu'il attende |
| `0x00040000` | Logout | `0x165530` | 1 : `0x14a508` | `frd_0004_Logout` (`0x1280f6`) | résultat 0 (`0x00040040`), sans condition |
| `0x00050000` | GetMyFriendKey | `0x13547c` | 2 : `0x1654cc` (dans `0x165484`, qui rend l'identifiant principal du résultat, **0 en cas d'échec**, et a cinq appelants) et `0x2d1be8` | `frd_0005_GetMyFriendKey` (`0x1279d0`) | **vrai** : résultat 0 et, aux mots 2 à 5, l'identifiant principal (non nul), un mot de remplissage, puis le code d'ami sur 8 octets calculé par la formule de la partie 5 à partir de l'identifiant. Un échec donne 0 au jeu. Ce que le jeu fait de l'identifiant n'est pas lu |
| `0x00100040` | GetMyPassword | `0x2d23d8` | 1 : `0x2d189c` | `frd_0010_GetMyPassword` (`0x1275ac`) | le mot de passe du réseau des amis, propre à la console : un remplaçant rend **une chaîne vide** (un tampon statique rempli de zéros, en-tête `0x00100042`). La demande donne la taille du tampon (au plus `0x800`) |
| `0x00110080` | GetFriendKeyList | `0x11b814` | 1 : `0x11073c` (dans `0x1106b8`) | `frd_0011_GetFriendKeyList` (`0x1274f8`) | **neutre** : une liste vide, résultat 0, nombre 0 (partie 4). Un décalage et un nombre sont donnés ; le jeu demande au plus 100 entrées |
| `0x00170042` | GetFriendAttributeFlags | `0x11b8bc` | 1 : `0x1107e4` (dans `0x12c34c`) | `frd_0017_GetFriendAttributeFlags` (`0x127090`) | résultat 0 et un tableau d'un mot par clé reçue (le jeu y met les clés qu'il a tirées de GetFriendKeyList ; sans ami il n'y en a sans doute aucune, ce que le jeu fait dans ce cas n'est pas lu) : **0 pour chaque clé**, ce qui est ce que la console rend pour une clé absente |
| `0x001C0042` | UnscrambleLocalFriendCode | `0x2d287c` | 1 : `0x2d2234` | `frd_001C_UnscrambleLocalFriendCode` (`0x126dac`) | résultat 0 et un code de 8 octets par code brouillé reçu (12 octets chacun) : **0 pour chaque code** (le module écrit 0 quand `0x125296`, non lue, rend 0 pour le code décodé ; l'algorithme de décodage, `0x13f5ea`, n'est pas lu non plus) |
| `0x00230000` | GetLastResponseResult | `0x2d265c` | 1 : `0x2d1e14` | dans `frdu_handle_command` | en-tête `0x00230040` : le mot du résultat (mot 1) contient lui-même le dernier résultat de la session (`+0x1C`) ; **neutre** : 0 si rien n'a échoué, sinon le résultat de la dernière demande |
| `0x00270040` | ResultToErrorCode | `0x2d24cc` | 1 : `0x2d1980` | `frd_0027_ResultToErrorCode` (`0x1269ac`) | **vrai** : la formule de la partie 5 (en-tête `0x00270080`, le résultat de la commande puis le code d'erreur) |
| `0x00280244` | RequestGameAuthentication | `0x2d27ec` | 2 : `0x2d2190`, `0x2d23b8` | `frd_0028_RequestGameAuthentication` (`0x126890`) | le jeu donne l'identifiant du serveur, la chaîne d'identification, les versions, un numéro de processus et un événement. **Échec** : un résultat négatif (le module lui-même en rend un si une demande est déjà en cours, `0xC8A0C7F0`) ; si le remplaçant rend 0, il doit signaler l'événement et rendre ensuite des données d'authentification dont le premier mot (résultat de NASC) est un échec. Pas lu : ce que le jeu fait d'un échec |
| `0x00290000` | GetGameAuthenticationData | `0x2d279c` | 1 : `0x2d2090` | `frd_0029_GetGameAuthenticationData` (`0x126864`) | les `0x138` octets de la structure d'authentification (3dbrew : 0x130 plus l'heure du serveur sur 8 octets) ; le module rend `0xC8A0C7EF` tant que la demande de la session n'a pas fini (drapeau `+0x21` de la session). **Échec** |
| `0x002A0204` | RequestServiceLocator | `0x2d2718` | 2 : `0x2d2004`, `0x2d22f8` | `frd_002A_RequestServiceLocator` (`0x126748`) | comme RequestGameAuthentication (demande « SVCLOC » de NASC). **Échec** |
| `0x002B0000` | GetServiceLocatorData | `0x2d26c8` | 1 : `0x2d1ef8` | `frd_002B_GetServiceLocatorData` (`0x12671c`) | les `0x198` octets de la structure (drapeau `+0x22` de la session). **Échec** |
| `0x00060000` | GetMyPreference | `0x2d2434` | 1, par un `.cro` | `frd_0006_GetMyPreference` (`0x127968`) | trois octets (publique, jeu affiché, historique affiché) : **neutre**, des zéros, en-tête `0x00060100` |
| `0x00090000` | GetMyScreenName | `0x2d2488` | 1, par un `.cro` | `frd_0009_GetMyScreenName` (`0x12784c`) | **vrai** : le nom d'écran du Mii, 11 caractères UTF-16 dont le dernier est nul, dans 6 mots (en-tête `0x000901C0`, pas `0x00090240` comme le laisse croire la Carte : voir les désaccords) |
| `0x00130142` | GetFriendScreenName | `0x2d2510` | 1, par un `.cro` | `frd_0013_GetFriendScreenName` (`0x127300`) | les noms d'écran des amis demandés (11 caractères chacun) et un octet de jeu de caractères par ami : **neutre** : sans ami, aucune clé n'est donnée |
| `0x002E0000` | GetServerTimeDifference | `0x2d268c` | 1, par un `.cro` | `frd_002E_GetServerTimeDifference` (`0x12659c`) | résultat 0 et une différence de 64 bits : **neutre**, 0 ; le module rend `0xD8A0C402` quand la session n'est pas connectée |
| `0x00330000` | GetMyApproachContext | `0x2d25a8` | 1, par un `.cro` | `frd_0033_GetMyApproachContext` (`0x1263dc`) | un tampon de `0x200` octets chiffré par la console : **échec** (il ne peut pas être fabriqué sans les clés de la console) |
| `0x00340046` | AddFriendWithApproach | `0x2d25f8` | 1, par un `.cro` | `frd_0034_AddFriendWithApproach` (`0x12626c`) | **échec** : un jeu qui l'envoie veut ajouter un ami local, ce qu'un remplaçant à liste vide refuse (le module lui-même refuse sous plusieurs conditions : compte mal réglé, liste pleine à 100) |

Ce qu'un remplaçant doit garder vrai, en une phrase : **l'identité locale** (identifiant principal non nul et code d'ami cohérent avec la formule de la partie 5, qui servent à GetMyFriendKey), **la formule des codes d'erreur** (ResultToErrorCode) et **les en-têtes de réponse du tableau** (une réponse qui ne respecte pas le nombre de mots fait échouer la bibliothèque du jeu). Tout le reste peut rester factice : liste d'amis vide (GetFriendKeyList, GetFriendAttributeFlags, GetFriendScreenName), présence nulle (GetMyPresence), pas connecté (HasLoggedIn rend 0), mot de passe vide, et un échec pour tout ce qui touche le serveur (RequestGameAuthentication, RequestServiceLocator et leurs lectures). Le Mii n'est pas demandé par le jeu (GetMyMii n'est pas dans ses 22 commandes) ; seul le nom d'écran l'est, par un `.cro`.

Ce qu'on n'a pas vérifié : la réaction de Pokémon X à un identifiant principal de 0 ou à un échec de Login ; les cinq appelants de `0x165484` ; et si le jeu attend l'événement de Login avant de poursuivre. Le contrat complet de `frd:u` (la lecture côté jeu de chaque commande) n'est pas fait.

## Les désaccords relevés

| Quoi | 3dbrew / Carte | Le code | Ligne de la fiche |
| --- | --- | --- | --- |
| GetMyScreenName (`0x00090000`), mots de réponse | « 2-9 », huit mots de nom (donc une réponse `0x00090240`) | la réponse est `0x000901C0` : six mots (`0x12784c` copie 11 caractères = 22 octets) ; confirmé par l'émulation et par le pseudo-code de l'aiguillage (`ipc_set_header` avec `9` et `7`) | partie 3 (tableau, ligne `0x09`) et partie 9 |
| `frd:n`, les quatre commandes | 3dbrew les nomme sans détail ; la Carte les marque « non lues » | `0x00010042` (un événement), `0x00020040`, `0x00030040` (un octet), `0x00040080` (un octet de 0 à 3) | partie 3, `frd:n` |
| `ndm.md` partie 7 et `ndm.noms.tsv` | `FRDN_GetHandleOfNdmStatusChangedEvent` à `FRDN_QueryStatus` « non nommées sur 3dbrew » | ce sont GetHandleOfNdmStatusChangedEvent, Resume, SuspendAsync et QueryStatus (3dbrew les nomme) | partie 3, `frd:n` |
| `frd:a` `0x401` à `0x410` | 3dbrew donne les en-têtes de requête sans détail | les arguments des 16 commandes sont lus (partie 3) ; les réponses sont toutes un résultat seul (`0x040X0040`) | partie 3, `frd:a` seul |
| GetFriendPresence, GetFriendInfo, GetFriendPlayingGame, GetFriendScreenName | 3dbrew ne donne pas la taille d'une entrée de réponse | présence : `0x30` octets par ami (la présence de `0x2C` plus trois octets, dont « trouvé ») ; informations : `0xE0` ; jeu en cours : `0x110` ; Mii : `0x60` ; jeu favori : `0x10` ; profil : `8` ; nom d'écran : 11 caractères (`0x16` octets) ; code d'ami décodé : 8 octets (pour 12 octets de code brouillé) | partie 3 (pseudo-code des cas `0x12`, `0x14`, `0x18`, `0x19`, `0x1A`) |
| Services de l'exheader | `frd:u`, `frd:a`, `frd:n` ne sont pas dans la liste des services appelés | normal : ce sont des services offerts. Mais `ndm:u`, que le code ouvre (`ndm_u_open`, `0x1107f8`), n'est pas non plus dans la liste (comme `ac:u` pour `ac`) : sm refuserait ; à relire | carte d'identité et partie 7 |

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les noms et le nombre de sessions des trois services (`frd:u` 8, `frd:a` 8, `frd:n` 1) : la table de `0x157518` (octets du module) et le pseudo-code de `service_main` (`strlen` puis `SRV_RegisterService` à chaque tour, en-tête `0x00030100`). L'ordre `frd:u`, `frd:a`, `frd:n` est celui de la table des aiguillages `0x1642c8`.
- Les trois aiguillages (`0x14164c`, `0x1424b0`, `0x1414d4`) et leur lien avec le service : la table `0x1642c8` (octets) et la boucle de `service_main` (pseudo-code : rang rendu moins un, puis appel indirect). Le nombre de commandes : 54, 70 et 4, par l'émulation de `0x00000000` à `0xFFFF`.
- Les 74 couples numéro/fonction (`python outils/emulate_dispatch.py friends 0x14164c=frd:u 0x1424b0=frd:a 0x1414d4=frd:n`) : l'émulation d'un côté, et de l'autre le pseudo-code des aiguillages, où **chaque** adresse de fonction de travail apparaît comme cible d'appel ; la lecture cas par cas a de plus confirmé les cas 1 à 6, `0x10`, `0x11`, `0x1D` à `0x1F`, `0x23`, `0x27`, `0x28`, `0x2C` à `0x36` de `frd:u` et les 16 cas `0x401` à `0x410` de `frd:a`.
- Les en-têtes de requête de 3dbrew : pour les 22 commandes de `frd:u` dont l'en-tête est vérifié en entier (dont `0x34` et `0x35`, dont l'émulation a trouvé l'en-tête attendu avant de se faire refuser), l'en-tête exigé par le code est exactement celui de 3dbrew ; de même pour AddFriendOnline de `frd:a`. Les en-têtes de réponse : sur les 54 commandes de `frd:u`, 51 réponses émulées retombent sur l'en-tête que donne la liste de mots de la Carte (nombre de mots ordinaires et de traduction recompté) ; les trois autres sont GetMyScreenName (désaccord ci-dessus) et `0x34` et `0x35` (refusées par l'émulation ; le pseudo-code écrit bien `0x00340040` et `0x00350042`, comme la Carte).
- La formule du code d'ami et celle de ResultToErrorCode : le pseudo-code de Ghidra et l'assembleur de capstone, et pour la première, la description de 3dbrew.
- Le jeu : `frd_open_session` (SetClientSdkVersion, puis GetMyPresence) et les adresses des 22 fonctions d'envoi, lues dans `pokemon-x-services.tsv` et dans le pseudo-code du jeu.
- Les 27 appels système : relevés dans l'assembleur de toutes les fonctions (`svc` par capstone) et dans les références de Ghidra.
- La structure de la boucle : un seul `svcReplyAndReceive` côté serveur (`0x15558c`) ; un seul `svcAcceptSession` (`0x155574`) ; un seul `svcCreateThread` (`0x155600`, appelé par `create_thread_impl`).

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Les noms des fonctions de travail : ils viennent de 3dbrew. Les trois nombres de mots de réponse et les tailles lus dans l'aiguillage sont d'accord, mais le corps de beaucoup de fonctions (surtout GetMyApproachContext, DecryptApproachContext, AddFriendOffline, RequestGameAuthentication, RequestServiceLocator) n'a pas été lu en entier.
- Le rôle de `0x101fc4` comme constructeur de l'objet principal (il met à zéro des champs `+0x5B5` et `+0x5B6` et initialise des listes) et celui des champs de la partie 6 (déduits de la commande qui les lit) ; le recouvrement de `+0x260` et `+0x268` fait penser que la présence interne n'a pas la disposition de 3dbrew.
- Le sens des états `+0x5B5`, `+0x5B6`, `+0x5B8`, `+0x5B9` : ceux de `frd:n` sont décrits dans la partie 3 d'après leurs usages, pas d'après un nom.
- Le sens des notifications `0x100`, `0x104`, `0x105`, `0x301`, `0x302`, et les abonnements : seuls `0x105` et `0x302` sont envoyés par `SRV_Subscribe` dans `service_main` ; `0x100`, `0x104` et `0x301` ont un gestionnaire mais pas d'abonnement trouvé (il peut venir d'une fonction non suivie).
- Les cinq commandes écrites dans l'aiguillage : lues dans le pseudo-code (une seule voie) ; l'émulation confirme leurs en-têtes de réponse.
- `0x34` et `0x35` : une seule voie (pseudo-code).
- Les noms de services de `ptm:sysm`, `ptm:gets`, `ptm:play`, `APT:S`, `APT:A`, `cfg:u`, `gsp::Lcd` et `gsp::Gpu` : ils sont dans des tables de noms de la bibliothèque, mais l'exheader n'autorise ni `cfg:u`, `APT:S`, `APT:A`, `ptm:sysm`, `ptm:gets`, `ptm:play`, `gsp::Lcd` ni `gsp::Gpu` ; `ptm:s`, `ptm:sets`, `APT:U`, `cfg:s`, `ps:ps` et `err:f` ont une fonction d'ouverture qui référence leur nom. L'usage des autres n'est pas établi.
- Que `0x140338` soit un SHA-1 complet : par ses constantes et son usage (le code d'ami de 3dbrew), pas lu ligne à ligne.
- L'effet de Login selon l'état `+0x5B5` (0 : demande réelle ; 1 : enregistrer l'événement ; 2 ou 3 : terminé) : lu dans `0x127fa4`, sans nom.

**Pas lu**
- Le réseau : les requêtes NASC (`http:C`), la connexion au serveur d'amis, la détection du NAT (`DetectNatProperties` et `GetNatProperties` ne sont lues que dans leur lecture d'état), l'utilisation de `ac:u`, de `soc:U` et de `nwm::EXT`.
- Le fichier de sauvegarde du compte (monté sous `data:`), sa structure et son chiffrement ; la création, le chargement et le déchiffrement du compte local (`frda_0401` à `frda_0405`).
- Les notifications d'amis (`GetEventNotification`, les 128 entrées internes, l'événement donné par `AttachToEventNotification`) et leur envoi.
- Le calcul de `0x13f5ea` (décodage d'un code d'ami brouillé), de `0x143f58` (utilisé par ResultToErrorCode), de `0x125296`, des corps de GetMyApproachContext (chiffrement par `APT:Wrap` d'après 3dbrew) et des commandes de mise à jour de `frd:a`.
- Les corps des fonctions de bibliothèque (`0x13xxxx`, `0x14xxxx`, `0x15xxxx` : conteneurs, chaînes, SHA-1, démarrage du runtime C++) et la plupart des 4 496 fonctions sans nom.
- L'usage de `ps:ps`, `cfg:s`, `ptm:sets`, `APT:*` par le module (ils ne sont qu'ouverts).
- Le fil : un seul fil de service est lu ; les fils créés par `create_thread_impl` (appelé par `0x135504`) ne sont pas suivis.
- Pour le portage : ce que Pokémon X fait de chaque réponse (identifiant principal à 0, échec de Login, attente de l'événement), seul le côté envoi est lu.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Fonctions, pseudo-code, références, tables de saut | `python outils/ghidra_direct.py friends` | environ 1 min 30 (deux fois, avec les noms) |
| Table des commandes de chaque aiguillage | `python outils/emulate_dispatch.py friends 0x14164c=frd:u 0x1424b0=frd:a 0x1414d4=frd:n` | quelques secondes |
| Les trois noms de service, l'ordre, les sessions | une recherche de chaînes dans `code.bin`, les références de Ghidra et la lecture de `service_main` | immédiat |
| Appels système | un script Python avec capstone, qui désassemble chaque fonction de `funcs.tsv` | immédiat |
| Noms et en-têtes des commandes | la Carte des services (`carte-des-services/donnees.js`, tirée de 3dbrew : Friend_Services) ; la page n'était pas disponible directement, je l'ai relue par `web.archive.org` sous le nom `Friend_Services` (le nom `FRD_Services` n'est pas archivé) | |
| Comparaison des en-têtes de réponse avec la Carte | un script qui déduit les mots ordinaires et de traduction de la liste « réponse » de la Carte | immédiat |
| Le côté du jeu | `pokemon-x-services.tsv` et le pseudo-code de la mise à jour (`local/analyse/maj/gh/`) | |

**Pour reprendre.** `friends.noms.tsv` est le fichier de graines : une adresse, `function` (ARM) ou `label` (Thumb), un nom. Les noms `frd_<numéro>_<Commande>` sont les commandes reçues par `frd:u` et `frd:a` (`frda_` pour `frd:a` seul, `frdn_` pour `frd:n`) ; ceux en majuscules (`SRV_…`) sont les requêtes que `friends` envoie à `srv:` ; les noms `svc…` sont des enveloppes d'appels système. Le pseudo-code brut et les tableaux de l'émulation sont dans `local/analyse/friends/`, non versionné.
