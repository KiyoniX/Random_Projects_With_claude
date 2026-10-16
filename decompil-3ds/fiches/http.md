# http, le client HTTP et HTTPS

`http` fait les requêtes HTTP et HTTPS des jeux et des modules système (la liste d'amis, la mise à jour, les services en ligne de Nintendo). Un client lui confie une URL et une méthode, il ouvre la connexion lui-même (sockets de `soc:U`, TLS de `ssl:C`), envoie les en-têtes et le corps, puis rend l'état, les en-têtes de réponse et les données par morceaux. Il tient une table de « contextes » (une requête = un contexte, désigné par une poignée entière que le module invente), des chaînes de certificats racines et des certificats client (que `ssl:C` fournit), un contexte TLS par connexion HTTPS, et des fils de travail qui font la connexion pendant que le client attend. Un jeu ne lui parle que par un seul service, `http:C`, et c'est le seul service que ce module offre.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, le module est presque entièrement en ARM), `emulate_dispatch.py` et le pseudo-code de la mise à jour de Pokémon X. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002902`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `http`, priorité 58 (`0x3A`, octet `0x20F`) |
| Fichier lu | `local/extrait/http/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x1AA6C` octets de code (27 pages, de `0x100000`), `0xB8C` de données en lecture seule à `0x11B000`, `0x3F0` de données à `0x11C000`, `0x565C` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 739 pour Ghidra, dont 727 en ARM et 12 en Thumb ; 326 nommées dans `http.noms.tsv` |
| Service offert | `http:C` seul (la chaîne est à `0x11B008`), 66 commandes |
| Services appelés | lus dans l'exheader : `ptm:s`, `soc:U`, `ssl:C` ; lus dans le code : les mêmes trois, plus `srv:` (port) et `err:f` (port) |
| Dépendances déclarées | deux titres : `…2E02` (les sockets) et `…2F02` (`ssl`) ; les noms viennent de la liste des titres système de 3dbrew |
| Appels système | 29 numéros différents, partie 8 |

Deux choses à savoir avant de lire la suite.

**Le module démarre soc:U et ssl:C pour lui-même, une fois.** `module_start` (`0x101430`) appelle `socket_layer_init` (`0x102208`, qui envoie `SOCU_InitializeSockets` par `socu_init`, `0x103754`, avec un bloc de mémoire partagée) puis `server_start` (`0x1017ac`), qui initialise `ssl:C` (`ssl_init`, `0x1048f0`, `SSLC_Initialize`). Un client de `http:C` ne déclenche donc ni l'un ni l'autre : ce n'est pas `Initialize` qui ouvre le réseau (partie 7).

**Un client a une session principale et une session par contexte.** Comme `ssl:C`, `http:C` demande à son client de rouvrir le service pour chaque contexte : la session « principale » (celle d'`Initialize`) gère les contextes, et chaque contexte a sa propre session, sur laquelle les commandes de requête sont envoyées. Les deux sortes de sessions n'acceptent pas les mêmes commandes (partie 3).

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle `0x100024` (une préparation), `0x100254` (qui range deux champs de l'en-tête des arguments, comme dans `ndm`), `0x10FAF4`, les constructeurs globaux par une table de distances relatives (`0x100124`) et par une table de pointeurs (`0x100220`), puis `main` (`0x100168`), puis `svcExitProcess` (`0x119DBC`).

`main` fait, dans l'ordre :

1. `srv_connect` (`0x100430`) ouvre le port `srv:` ; un résultat négatif donne `throw_fatal_error` (`0x1003BC`).
2. `is_new_3ds` (`0x100360`) lit une seule fois si la console est une New 3DS, par `ptms_check_new3ds` (`0x100C40`, qui envoie `PTMS_CheckNew3DS` à `ptm:s`). La réponse choisit deux constantes écrites dans un enregistrement global : `0x30000` sur une 3DS ordinaire, `0x50000` sur une New 3DS (interprété : le code réserve ensuite de la mémoire à partir de cette taille ; l'emploi n'est pas suivi plus loin).
3. Trois préparations non lues (`0x1002B4`, `0x1006B4`, `0x100404`), puis `run_module` (`0x100498`), qui fait `module_start` (`0x101430`), `server_run` (`0x100D78`) et, à la sortie, `module_stop` (`0x1015BC`, qui arrête les sockets par `socu_shutdown`, `0x103704`).

`module_start` met en route le réseau du module : `socket_layer_init` (`0x102208`, qui prépare un bloc de mémoire partagée et appelle `socu_init`), puis `server_start` (`0x1017AC`), qui prépare les objets de synchronisation et les listes de travail (trois nombres en entrée, deux plafonnés à `0x20` avec les valeurs par défaut 4 et 8, le troisième à 4 : leur sens n'est pas lu) et initialise `ssl:C` (`ssl_init`, `0x1048F0`).

`server_run` (`0x100D78`) fait le reste :

1. enregistre le service : `0x101DA4` envoie `SRV_RegisterService` (`0x1030C0`) avec le nom `http:C` (chaîne à `0x11B008`) et un nombre de sessions de `0x1F` plus un si l'octet `+0x11` du descripteur est nul, soit 32 au plus (interprété : l'octet n'est pas lu à son initialisation) ;
2. s'abonne aux notifications (`0x101E08`, `SRV_EnableNotification`) ;
3. crée **quatre fils de travail** (une boucle de quatre tours sur `0x10EF98`, la seule fonction qui appelle `svcCreateThread`, `0x104AE4`) ;
4. fait tourner la boucle de réception (`server_receive_loop`) dans le fil principal, jusqu'à l'arrêt ; à la sortie il retire le service (`SRV_UnregisterService`).

## Partie 2 : la boucle de serveur

C'est le même moule que `ndm` et `ssl` : un fil qui reçoit, des fils de travail qui exécutent.

**La réception.** `server_receive_loop` (`0x10E6D8`) rassemble les poignées (les sessions ouvertes et les poignées d'écoute) et appelle `svcReplyAndReceive` (`0x10E0B0`, seule fonction à contenir ce `svc`). Une nouvelle session est acceptée par `svcAcceptSession` (`0x10381C`, par `0x102FE8`) ; l'objet de session est fabriqué par la méthode `+0` du descripteur du port. Pour une requête, la méthode `+0xC` de la session donne un numéro de file : `-1` veut dire « exécute-la tout de suite dans ce fil », `0` ou `1` veut dire « mets-la dans cette file de travail ».

**Les fils de travail.** Il y en a quatre ; la file 0 est servie par trois d'entre eux et la file 1 par le quatrième (deux octets de l'enregistrement du serveur, `3` et `1`, partagent les quatre fils entre les deux files ; lu dans `server_worker_loop`, la répartition est interprétée). `server_worker_loop` (`0x102460`) prend une tâche dans sa file, recopie les `0x100` octets de la requête dans son propre tampon, appelle la méthode `+8` de la session (`httpc_dispatch_command`, `0x114BA8`) puis répond par un `svcReplyAndReceive` sans aucune poignée à attendre.

**Quelles commandes vont en file.** `httpc_session_queue_index` (`0x119DC4`) rend `-1` pour toute commande hors de la liste suivante, et regarde l'objet derrière la session pour celles qui y sont : CloseContext (3), BeginRequest (9), ReceiveData (11), ReceiveDataTimeout (12), les quatre `SendPostData` avec ou sans délai (22 à 25), SendPostDataRaw et sa version à délai (26, 27), GetResponseHeader et son délai (30, 31), GetResponseData et son délai (32, 33), GetResponseStatusCode et son délai (34, 35). Ce sont exactement les commandes qui peuvent attendre le réseau. Pour celles-là, la méthode `+0x104` de l'objet derrière la session décide de la file : pour un contexte, `context_queue_index` (`0x117C60`) rend 0 quand l'état de l'objet de contexte (octet `+0xC`) est l'un de 3, 4, 5, 6, 9, 10 et que l'octet `+0xE` est nul, 1 sinon ; la session rend la file 1 quand ce nombre est nul et la file 0 sinon (la file 1, servie par un seul fil, est donc celle des contextes en cours de requête : interprété, le sens des deux files n'est pas lu). Pour une session sans objet, la file est 1.

**L'objet de session** (créé à l'acceptation, détruit par `httpc_session_destroy_and_free`, `0x119C20`, qui appelle `httpc_session_release`, `0x119AA0`) :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | table de méthodes `0x11B854` : `+4` destructeur et libération, `+8` exécuter la requête, `+0xC` numéro de file, `+0x10` et `+0x14` vides, puis les 66 commandes à partir de `+0x18` (dans un ordre qui n'est pas celui des numéros) |
| `+0x04` et `+0x08` | liens de la liste globale des sessions |
| `+0x0C` | type : 0 pas encore initialisée, 1 session principale (après `Initialize`), 2 session de contexte (après `InitializeConnectionSession`) |
| `+0x10` | l'objet derrière la session : le **client** pour une session principale, le **contexte** pour une session de contexte |

À la destruction : pour une session principale, retirer la session de la liste globale, fermer le client (`0x10B3B8`) et le libérer ; pour une session de contexte, lâcher le contexte (le contexte lui-même reste au client tant que celui-ci n'a pas reçu CloseContext).

**Les trois étages d'une commande.** Une commande traverse trois niveaux, que les tableaux de la partie 3 nomment :

1. la **méthode de session** (`httpc_<numéro>_<Commande>`) : elle ne fait presque rien, elle appelle une méthode de l'objet derrière la session ;
2. la **méthode du client** (`httpc_client_…`) ou la **méthode du contexte** (`httpc_ctx_…`) selon le type de session. Le client et le contexte ont chacun leur table de méthodes (`0x11B5DC` et `0x11B744`) et **les mêmes emplacements** : une commande qu'un type de session n'accepte pas tombe sur une méthode qui rend toujours `0xD960A3F4` (« mauvais type de session ») ; il y en a 41 de ce genre côté client et 16 côté contexte ;
3. le **cœur de contexte** (`context_core_…`) : l'enregistrement de requête de `0x870` octets (partie 5), retrouvé par sa poignée entière (`context_core_from_id`, `0x10F4A8`). Les méthodes du contexte qui travaillent avec l'événement de fin et l'état de l'objet (ReceiveData, BeginRequest, GetResponseHeader…) sont nommées `request_…` ; elles appellent ensuite le cœur.

Les résultats négatifs internes du cœur de contexte sont de la forme `0xFFFFE0nn`. `result_from_internal_code` (`0x10B178`) les convertit : le résultat vaut `0` si les dix bits bas sont nuls, `0xD8E0A002` s'ils valent 2, et sinon `0xD8A0A000` plus ces dix bits. C'est ainsi qu'on retrouve les codes de 3dbrew (`0xD8A0A066` pour une poignée de contexte inconnue, venu de `0x66`).

## Partie 3 : les commandes de `http:C`

Les noms et les en-têtes de requête viennent de 3dbrew pour les 66 commandes ; la fonction, l'adresse, l'en-tête de réponse et ce que le code vérifie sont lus dans le code. La colonne « Vérifié » dit si l'aiguillage compare tout l'en-tête (« entier ») ou seulement le numéro (« numéro »). Pour les 9 commandes dont la comparaison complète est refusée par l'émulation (elles portent deux tampons, `entier (code seul)`), l'en-tête et la réponse sont ceux des constantes lues dans le pseudo-code. Tous les en-têtes de réponse portent le résultat au mot 1. Un en-tête qui ne va pas rend `0x00000040` et `0xD9001830` ; un numéro inconnu `0x00000040` et `0xD900182F`.

Les noms de fonctions suivent la convention de `ndm.md` : `httpc_<numéro en hexadécimal>_<Commande de 3dbrew>`. Deux exceptions : 0x2A, que 3dbrew nomme `GetSSLError ?` (nommée `GetSslError`), et 0x37 et 0x3A, deux `SetKeepAlive` de 3dbrew que le code distingue (partie 9).

| N° | En-tête de requête | Commande | Fonction de session | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010044` | Initialize | `httpc_0001_Initialize` | `0x11962c` | entier | `0x00010040` |
| 2 | `0x00020082` | CreateContext | `httpc_0002_CreateContext` | `0x1191c8` | entier | `0x00020082` |
| 3 | `0x00030040` | CloseContext | `httpc_0003_CloseContext` | `0x119294` | numéro | `0x00030040` |
| 4 | `0x00040040` | CancelConnection | `httpc_0004_CancelConnection` | `0x119164` | numéro | `0x00040040` |
| 5 | `0x00050040` | GetRequestState | `httpc_0005_GetRequestState` | `0x11938c` | numéro | `0x00050080` |
| 6 | `0x00060040` | GetDownloadSizeState | `httpc_0006_GetDownloadSizeState` | `0x119458` | numéro | `0x000600C0` |
| 7 | `0x00070040` | GetRequestError | `httpc_0007_GetRequestError` | `0x119334` | numéro | `0x00070080` |
| 8 | `0x00080042` | InitializeConnectionSession | `httpc_0008_InitializeConnectionSession` | `0x119958` | entier | `0x00080040` |
| 9 | `0x00090040` | BeginRequest | `httpc_0009_BeginRequest` | `0x1190e8` | numéro | `0x00090040` |
| 10 | `0x000A0040` | BeginRequestAsync | `httpc_000A_BeginRequestAsync` | `0x119434` | numéro | `0x000A0040` |
| 11 | `0x000B0082` | ReceiveData | `httpc_000B_ReceiveData` | `0x119b94` | entier | `0x000B0042` |
| 12 | `0x000C0102` | ReceiveDataTimeout | `httpc_000C_ReceiveDataTimeout` | `0x1193b0` | entier | `0x000C0042` |
| 13 | `0x000D0146` | SetProxy | `httpc_000D_SetProxy` | `0x119bb8` | entier | `0x000D0040` |
| 14 | `0x000E0040` | SetProxyDefault | `httpc_000E_SetProxyDefault` | `0x1190a0` | numéro | `0x000E0040` |
| 15 | `0x000F00C4` | SetBasicAuthorization | `httpc_000F_SetBasicAuthorization` | `0x1194c4` | entier | `0x000F0040` |
| 16 | `0x00100080` | SetSocketBufferSize | `httpc_0010_SetSocketBufferSize` | `0x119410` | numéro | `0x00100040` |
| 17 | `0x001100C4` | AddRequestHeader | `httpc_0011_AddRequestHeader` | `0x118e60` | entier (code seul) | `0x00110042` |
| 18 | `0x001200C4` | AddPostDataAscii | `httpc_0012_AddPostDataAscii` | `0x11913c` | entier (code seul) | `0x00120042` |
| 19 | `0x001300C4` | AddPostDataBinary | `httpc_0013_AddPostDataBinary` | `0x11923c` | entier (code seul) | `0x00130042` |
| 20 | `0x00140082` | AddPostDataRaw | `httpc_0014_AddPostDataRaw` | `0x118e88` | entier | `0x00140042` |
| 21 | `0x00150080` | SetPostDataType | `httpc_0015_SetPostDataType` | `0x119510` | numéro | `0x00150040` |
| 22 | `0x001600C4` | SendPostDataAscii | `httpc_0016_SendPostDataAscii` | `0x1192b8` | entier (code seul) | `0x00160042` |
| 23 | `0x00170144` | SendPostDataAsciiTimeout | `httpc_0017_SendPostDataAsciiTimeout` | `0x1199b4` | entier (code seul) | `0x00170042` |
| 24 | `0x001800C4` | SendPostDataBinary | `httpc_0018_SendPostDataBinary` | `0x119358` | entier (code seul) | `0x00180042` |
| 25 | `0x00190144` | SendPostDataBinaryTimeout | `httpc_0019_SendPostDataBinaryTimeout` | `0x1199f4` | entier (code seul) | `0x00190042` |
| 26 | `0x001A0082` | SendPostDataRaw | `httpc_001A_SendPostDataRaw` | `0x119014` | entier | `0x001A0042` |
| 27 | `0x001B0102` | SendPOSTDataTimeout | `httpc_001B_SendPOSTDataTimeout` | `0x1198e8` | entier | `0x001B0042` |
| 28 | `0x001C0080` | SetPostDataEncoding | `httpc_001C_SetPostDataEncoding` | `0x1193ec` | numéro | `0x001C0040` |
| 29 | `0x001D0040` | NotifyFinishSendPostData | `httpc_001D_NotifyFinishSendPostData` | `0x119648` | numéro | `0x001D0040` |
| 30 | `0x001E00C4` | GetResponseHeader | `httpc_001E_GetResponseHeader` | `0x118f24` | entier (code seul) | `0x001E0082` |
| 31 | `0x001F0144` | GetResponseHeaderTimeout | `httpc_001F_GetResponseHeaderTimeout` | `0x1197a0` | entier (code seul) | `0x001F0082` |
| 32 | `0x00200082` | GetResponseData | `httpc_0020_GetResponseData` | `0x118dc8` | entier | `0x00200082` |
| 33 | `0x00210102` | GetResponseDataTimeout | `httpc_0021_GetResponseDataTimeout` | `0x119534` | entier | `0x00210082` |
| 34 | `0x00220040` | GetResponseStatusCode | `httpc_0022_GetResponseStatusCode` | `0x118dfc` | numéro | `0x00220080` |
| 35 | `0x002300C0` | GetResponseStatusCodeTimeout | `httpc_0023_GetResponseStatusCodeTimeout` | `0x1195f0` | numéro | `0x00230080` |
| 36 | `0x00240082` | AddTrustedRootCA | `httpc_0024_AddTrustedRootCA` | `0x119bfc` | entier | `0x00240042` |
| 37 | `0x00250080` | AddDefaultCert | `httpc_0025_AddDefaultCert` | `0x1192e0` | numéro | `0x00250040` |
| 38 | `0x00260080` | SelectRootCertChain | `httpc_0026_SelectRootCertChain` | `0x118f8c` | numéro | `0x00260040` |
| 39 | `0x002700C4` | SetClientCert | `httpc_0027_SetClientCert` | `0x118e20` | entier | `0x00270044` |
| 40 | `0x00280080` | SetClientCertDefault | `httpc_0028_SetClientCertDefault` | `0x1194ec` | numéro | `0x00280040` |
| 41 | `0x00290080` | SetClientCertContext | `httpc_0029_SetClientCertContext` | `0x119038` | numéro | `0x00290040` |
| 42 | `0x002A0040` | sans nom (3dbrew : GetSSLError ?) | `httpc_002A_GetSslError` | `0x11947c` | numéro | `0x002A0080` |
| 43 | `0x002B0080` | SetSSLOpt | `httpc_002B_SetSSLOpt` | `0x1190c4` | numéro | `0x002B0040` |
| 44 | `0x002C0080` | SetSSLClearOpt | `httpc_002C_SetSSLClearOpt` | `0x119924` | numéro | `0x002C0040` |
| 45 | `0x002D0000` | CreateRootCertChain | `httpc_002D_CreateRootCertChain` | `0x118fcc` | numéro | `0x002D0080` |
| 46 | `0x002E0040` | DestroyRootCertChain | `httpc_002E_DestroyRootCertChain` | `0x1191f4` | numéro | `0x002E0040` |
| 47 | `0x002F0082` | RootCertChainAddCert | `httpc_002F_RootCertChainAddCert` | `0x119304` | entier | `0x002F0082` |
| 48 | `0x00300080` | RootCertChainAddDefaultCert | `httpc_0030_RootCertChainAddDefaultCert` | `0x1198c4` | numéro | `0x00300080` |
| 49 | `0x00310080` | RootCertChainRemoveCert | `httpc_0031_RootCertChainRemoveCert` | `0x11957c` | numéro | `0x00310040` |
| 50 | `0x00320084` | OpenClientCertContext | `httpc_0032_OpenClientCertContext` | `0x119188` | entier | `0x00320084` |
| 51 | `0x00330040` | OpenDefaultClientCertContext | `httpc_0033_OpenDefaultClientCertContext` | `0x1195c4` | numéro | `0x00330080` |
| 52 | `0x00340040` | CloseClientCertContext | `httpc_0034_CloseClientCertContext` | `0x119270` | numéro | `0x00340040` |
| 53 | `0x00350186` | SetDefaultProxy | `httpc_0035_SetDefaultProxy` | `0x11905c` | entier | `0x00350046` |
| 54 | `0x00360000` | ClearDNSCache | `httpc_0036_ClearDNSCache` | `0x118eac` | numéro | `0x00360040` |
| 55 | `0x00370080` | SetKeepAlive | `httpc_0037_SetKeepAliveWord` | `0x11966c` | numéro | `0x00370040` |
| 56 | `0x003800C0` | SetPostDataTypeSize | `httpc_0038_SetPostDataTypeSize` | `0x119a40` | numéro | `0x00380040` |
| 57 | `0x00390000` | Finalize | `httpc_0039_Finalize` | `0x118f00` | numéro | `0x00390040` |
| 58 | `0x003A0080` | SetKeepAlive | `httpc_003A_SetKeepAliveBool` | `0x119218` | numéro | `0x003A0040` |
| 59 | `0x003B0082` | SetCrl | `httpc_003B_SetCrl` | `0x119a7c` | entier | `0x003B0042` |
| 60 | `0x003C0080` | SetInternalCrl | `httpc_003C_SetInternalCrl` | `0x118f68` | numéro | `0x003C0040` |
| 61 | `0x003D0080` | SetCrlStore | `httpc_003D_SetCrlStore` | `0x118da4` | numéro | `0x003D0040` |
| 62 | `0x003E0000` | CreateCrlStore | `httpc_003E_CreateCrlStore` | `0x118edc` | numéro | `0x003E0080` |
| 63 | `0x003F0040` | DestroyCrlStore | `httpc_003F_DestroyCrlStore` | `0x118ff0` | numéro | `0x003F0040` |
| 64 | `0x00400082` | AddCrlToCrlStore | `httpc_0040_AddCrlToCrlStore` | `0x11910c` | entier | `0x00400082` |
| 65 | `0x00410080` | AddInternalCrl | `httpc_0041_AddInternalCrl` | `0x1195a0` | numéro | `0x00410080` |
| 66 | `0x00420040` | RemoveCrlFromCrlStore | `httpc_0042_RemoveCrlFromCrlStore` | `0x1194a0` | numéro | `0x00420040` |

Le dernier numéro est `0x42` (66). Les 66 numéros de 3dbrew sont tous là, et aucun autre : l'aiguillage de `0x114BA8` a 66 cas.

**Derrière la session.** Chaque ligne donne l'emplacement de la méthode dans la table du client ou du contexte (deux tables, mêmes emplacements) et la méthode qui s'y trouve selon le type de session. « Refuse » veut dire une méthode qui ne fait que rendre `0xD960A3F4`.

| N° | Commande | Emplacement | Méthode du client (après Initialize) | Méthode du contexte (après InitializeConnectionSession) |
| --- | --- | --- | --- | --- |
| 1 | Initialize | | fait dans la session | fait dans la session |
| 2 | CreateContext | `+0x8` | `httpc_client_0002_CreateContext` (`0x116a80`) | `httpc_ctx_0002_CreateContext_unsupported` (`0x118108`) (refuse : `0xD960A3F4`) |
| 3 | CloseContext | `+0xc` | `httpc_client_0003_CloseContext` (`0x116e3c`) | `httpc_ctx_0003_CloseContext` (`0x118240`) |
| 4 | CancelConnection | `+0x10` | `httpc_client_0004_CancelConnection` (`0x11685c`) | `httpc_ctx_0004_CancelConnection` (`0x117ffc`) |
| 5 | GetRequestState | `+0x14` | `httpc_client_0005_GetRequestState` (`0x116f88`) | `httpc_ctx_0005_GetRequestState` (`0x118420`) |
| 6 | GetDownloadSizeState | `+0x18` | `httpc_client_0006_GetDownloadSizeState` (`0x116ff4`) | `httpc_ctx_0006_GetDownloadSizeState` (`0x118618`) |
| 7 | GetRequestError | `+0x1c` | `httpc_client_0007_GetRequestError` (`0x116f40`) | `httpc_ctx_0007_GetRequestError` (`0x118390`) |
| 8 | InitializeConnectionSession | | fait dans la session | fait dans la session |
| 9 | BeginRequest | `+0x60` | `httpc_client_0009_BeginRequest_unsupported` (`0x116804`) (refuse : `0xD960A3F4`) | `httpc_ctx_0009_BeginRequest` (`0x117ef4`) |
| 10 | BeginRequestAsync | `+0x64` | `httpc_client_000A_BeginRequestAsync_unsupported` (`0x116fe8`) (refuse : `0xD960A3F4`) | `httpc_ctx_000A_BeginRequestAsync` (`0x1185f8`) |
| 11 | ReceiveData | `+0x68` | `httpc_client_000B_ReceiveData_unsupported` (`0x1174d0`) (refuse : `0xD960A3F4`) | `httpc_ctx_000B_ReceiveData` (`0x118b70`) |
| 12 | ReceiveDataTimeout | `+0x6c` | `httpc_client_000C_ReceiveDataTimeout_unsupported` (`0x116fc4`) (refuse : `0xD960A3F4`) | `httpc_ctx_000C_ReceiveDataTimeout` (`0x11858c`) |
| 13 | SetProxy | `+0x70` | `httpc_client_000D_SetProxy_unsupported` (`0x1174dc`) (refuse : `0xD960A3F4`) | `httpc_ctx_000D_SetProxy` (`0x118b98`) |
| 14 | SetProxyDefault | `+0x74` | `httpc_client_000E_SetProxyDefault_unsupported` (`0x1167ec`) (refuse : `0xD960A3F4`) | `httpc_ctx_000E_SetProxyDefault` (`0x117dd4`) |
| 15 | SetBasicAuthorization | `+0x78` | `httpc_client_000F_SetBasicAuthorization_unsupported` (`0x1170a4`) (refuse : `0xD960A3F4`) | `httpc_ctx_000F_SetBasicAuthorization` (`0x11869c`) |
| 16 | SetSocketBufferSize | `+0x7c` | `httpc_client_0010_SetSocketBufferSize_unsupported` (`0x116fdc`) (refuse : `0xD960A3F4`) | `httpc_ctx_0010_SetSocketBufferSize` (`0x1185e0`) |
| 17 | AddRequestHeader | `+0x80` | `httpc_client_0011_AddRequestHeader_unsupported` (`0x1161f8`) (refuse : `0xD960A3F4`) | `httpc_ctx_0011_AddRequestHeader` (`0x117b00`) |
| 18 | AddPostDataAscii | `+0x84` | `httpc_client_0012_AddPostDataAscii_unsupported` (`0x116850`) (refuse : `0xD960A3F4`) | `httpc_ctx_0012_AddPostDataAscii` (`0x117f20`) |
| 19 | AddPostDataBinary | `+0x88` | `httpc_client_0013_AddPostDataBinary_unsupported` (`0x116d0c`) (refuse : `0xD960A3F4`) | `httpc_ctx_0013_AddPostDataBinary` (`0x118150`) |
| 20 | AddPostDataRaw | `+0x8c` | `httpc_client_0014_AddPostDataRaw_unsupported` (`0x116204`) (refuse : `0xD960A3F4`) | `httpc_ctx_0014_AddPostDataRaw` (`0x117b30`) |
| 21 | SetPostDataType | `+0x90` | `httpc_client_0015_SetPostDataType_unsupported` (`0x117204`) (refuse : `0xD960A3F4`) | `httpc_ctx_0015_SetPostDataType` (`0x1186f4`) |
| 22 | SendPostDataAscii | `+0x94` | `httpc_client_0016_SendPostDataAscii_unsupported` (`0x116ee8`) (refuse : `0xD960A3F4`) | `httpc_ctx_0016_SendPostDataAscii` (`0x118308`) |
| 23 | SendPostDataAsciiTimeout | `+0x98` | `httpc_client_0017_SendPostDataAsciiTimeout_unsupported` (`0x1174a0`) (refuse : `0xD960A3F4`) | `httpc_ctx_0017_SendPostDataAsciiTimeout` (`0x118a28`) |
| 24 | SendPostDataBinary | `+0x9c` | `httpc_client_0018_SendPostDataBinary_unsupported` (`0x116f7c`) (refuse : `0xD960A3F4`) | `httpc_ctx_0018_SendPostDataBinary` (`0x1183d4`) |
| 25 | SendPostDataBinaryTimeout | `+0xa0` | `httpc_client_0019_SendPostDataBinaryTimeout_unsupported` (`0x1174ac`) (refuse : `0xD960A3F4`) | `httpc_ctx_0019_SendPostDataBinaryTimeout` (`0x118a84`) |
| 26 | SendPostDataRaw | `+0xa4` | `httpc_client_001A_SendPostDataRaw_unsupported` (`0x1166c0`) (refuse : `0xD960A3F4`) | `httpc_ctx_001A_SendPostDataRaw` (`0x117d2c`) |
| 27 | SendPOSTDataTimeout | `+0xa8` | `httpc_client_001B_SendPOSTDataTimeout_unsupported` (`0x117488`) (refuse : `0xD960A3F4`) | `httpc_ctx_001B_SendPOSTDataTimeout` (`0x1189b0`) |
| 28 | SetPostDataEncoding | `+0xac` | `httpc_client_001C_SetPostDataEncoding_unsupported` (`0x116fd0`) (refuse : `0xD960A3F4`) | `httpc_ctx_001C_SetPostDataEncoding` (`0x1185b8`) |
| 29 | NotifyFinishSendPostData | `+0xb0` | `httpc_client_001D_NotifyFinishSendPostData_unsupported` (`0x11742c`) (refuse : `0xD960A3F4`) | `httpc_ctx_001D_NotifyFinishSendPostData` (`0x118840`) |
| 30 | GetResponseHeader | `+0xb4` | `httpc_client_001E_GetResponseHeader_unsupported` (`0x1163e4`) (refuse : `0xD960A3F4`) | `httpc_ctx_001E_GetResponseHeader` (`0x117bec`) |
| 31 | GetResponseHeaderTimeout | `+0xb8` | `httpc_client_001F_GetResponseHeaderTimeout_unsupported` (`0x117444`) (refuse : `0xD960A3F4`) | `httpc_ctx_001F_GetResponseHeaderTimeout` (`0x118934`) |
| 32 | GetResponseData | `+0xbc` | `httpc_client_0020_GetResponseData_unsupported` (`0x1161d4`) (refuse : `0xD960A3F4`) | `httpc_ctx_0020_GetResponseData` (`0x1179f8`) |
| 33 | GetResponseDataTimeout | `+0xc0` | `httpc_client_0021_GetResponseDataTimeout_unsupported` (`0x117210`) (refuse : `0xD960A3F4`) | `httpc_ctx_0021_GetResponseDataTimeout` (`0x11875c`) |
| 34 | GetResponseStatusCode | `+0xc4` | `httpc_client_0022_GetResponseStatusCode_unsupported` (`0x1161e0`) (refuse : `0xD960A3F4`) | `httpc_ctx_0022_GetResponseStatusCode` (`0x117a64`) |
| 35 | GetResponseStatusCodeTimeout | `+0xc8` | `httpc_client_0023_GetResponseStatusCodeTimeout_unsupported` (`0x117420`) (refuse : `0xD960A3F4`) | `httpc_ctx_0023_GetResponseStatusCodeTimeout` (`0x1187e8`) |
| 36 | AddTrustedRootCA | `+0xcc` | `httpc_client_0024_AddTrustedRootCA_unsupported` (`0x1174e8`) (refuse : `0xD960A3F4`) | `httpc_ctx_0024_AddTrustedRootCA` (`0x118bd8`) |
| 37 | AddDefaultCert | `+0xd0` | `httpc_client_0025_AddDefaultCert_unsupported` (`0x116ef4`) (refuse : `0xD960A3F4`) | `httpc_ctx_0025_AddDefaultCert` (`0x11835c`) |
| 38 | SelectRootCertChain | `+0xec` | `httpc_client_0026_SelectRootCertChain_unsupported` (`0x116470`) (refuse : `0xD960A3F4`) | `httpc_ctx_0026_SelectRootCertChain` (`0x117cc4`) |
| 39 | SetClientCert | `+0xd4` | `httpc_client_0027_SetClientCert_unsupported` (`0x1161ec`) (refuse : `0xD960A3F4`) | `httpc_ctx_0027_SetClientCert` (`0x117ac0`) |
| 40 | SetClientCertDefault | `+0xd8` | `httpc_client_0028_SetClientCertDefault_unsupported` (`0x1170b0`) (refuse : `0xD960A3F4`) | `httpc_ctx_0028_SetClientCertDefault` (`0x1186cc`) |
| 41 | SetClientCertContext | `+0xf0` | `httpc_client_0029_SetClientCertContext_unsupported` (`0x1166cc`) (refuse : `0xD960A3F4`) | `httpc_ctx_0029_SetClientCertContext` (`0x117d78`) |
| 42 | sans nom (3dbrew : GetSSLError ?) | `+0x20` | `httpc_client_002A_GetSslError` (`0x117038`) | `httpc_ctx_002A_GetSslError` (`0x118648`) |
| 43 | SetSSLOpt | `+0xe4` | `httpc_client_002B_SetSSLOpt_unsupported` (`0x1167f8`) (refuse : `0xD960A3F4`) | `httpc_ctx_002B_SetSSLOpt` (`0x117ecc`) |
| 44 | SetSSLClearOpt | `+0xe8` | `httpc_client_002C_SetSSLClearOpt_unsupported` (`0x117494`) (refuse : `0xD960A3F4`) | `httpc_ctx_002C_SetSSLClearOpt` (`0x118a00`) |
| 45 | CreateRootCertChain | `+0x24` | `httpc_client_002D_CreateRootCertChain` (`0x11647c`) | `httpc_ctx_002D_CreateRootCertChain_unsupported` (`0x117d14`) (refuse : `0xD960A3F4`) |
| 46 | DestroyRootCertChain | `+0x28` | `httpc_client_002E_DestroyRootCertChain` (`0x116c10`) | `httpc_ctx_002E_DestroyRootCertChain_unsupported` (`0x118114`) (refuse : `0xD960A3F4`) |
| 47 | RootCertChainAddCert | `+0x2c` | `httpc_client_002F_RootCertChainAddCert` (`0x116f00`) | `httpc_ctx_002F_RootCertChainAddCert_unsupported` (`0x118384`) (refuse : `0xD960A3F4`) |
| 48 | RootCertChainAddDefaultCert | `+0x30` | `httpc_client_0030_RootCertChainAddDefaultCert` (`0x117450`) | `httpc_ctx_0030_RootCertChainAddDefaultCert_unsupported` (`0x1189a4`) (refuse : `0xD960A3F4`) |
| 49 | RootCertChainRemoveCert | `+0x34` | `httpc_client_0031_RootCertChainRemoveCert` (`0x11721c`) | `httpc_ctx_0031_RootCertChainRemoveCert_unsupported` (`0x1187c4`) (refuse : `0xD960A3F4`) |
| 50 | OpenClientCertContext | `+0x38` | `httpc_client_0032_OpenClientCertContext` (`0x1168c4`) | `httpc_ctx_0032_OpenClientCertContext_unsupported` (`0x1180fc`) (refuse : `0xD960A3F4`) |
| 51 | OpenDefaultClientCertContext | `+0x3c` | `httpc_client_0033_OpenDefaultClientCertContext` (`0x117284`) | `httpc_ctx_0033_OpenDefaultClientCertContext_unsupported` (`0x1187dc`) (refuse : `0xD960A3F4`) |
| 52 | CloseClientCertContext | `+0x40` | `httpc_client_0034_CloseClientCertContext` (`0x116d18`) | `httpc_ctx_0034_CloseClientCertContext_unsupported` (`0x118234`) (refuse : `0xD960A3F4`) |
| 53 | SetDefaultProxy | `+0x58` | `httpc_client_0035_SetDefaultProxy` (`0x1166d8`) | `httpc_ctx_0035_SetDefaultProxy_unsupported` (`0x117dc8`) (refuse : `0xD960A3F4`) |
| 54 | ClearDNSCache | | fait dans la session | fait dans la session |
| 55 | SetKeepAlive | `+0xf8` | `httpc_client_0037_SetKeepAliveWord_unsupported` (`0x117438`) (refuse : `0xD960A3F4`) | `httpc_ctx_0037_SetKeepAliveWord` (`0x11890c`) |
| 56 | SetPostDataTypeSize | `+0x100` | `httpc_client_0038_SetPostDataTypeSize_unsupported` (`0x1174b8`) (refuse : `0xD960A3F4`) | `httpc_ctx_0038_SetPostDataTypeSize` (`0x118ad8`) |
| 57 | Finalize | `+0x5c` | `httpc_client_0039_Finalize` (`0x1163a4`) | `httpc_ctx_0039_Finalize_unsupported` (`0x117be0`) (refuse : `0xD960A3F4`) |
| 58 | SetKeepAlive | `+0xfc` | `httpc_client_003A_SetKeepAliveBool_unsupported` (`0x116d00`) (refuse : `0xD960A3F4`) | `httpc_ctx_003A_SetKeepAliveBool` (`0x118120`) |
| 59 | SetCrl | `+0xdc` | `httpc_client_003B_SetCrl_unsupported` (`0x1174c4`) (refuse : `0xD960A3F4`) | `httpc_ctx_003B_SetCrl` (`0x118b40`) |
| 60 | SetInternalCrl | `+0xe0` | `httpc_client_003C_SetInternalCrl_unsupported` (`0x116464`) (refuse : `0xD960A3F4`) | `httpc_ctx_003C_SetInternalCrl` (`0x117c9c`) |
| 61 | SetCrlStore | `+0xf4` | `httpc_client_003D_SetCrlStore_unsupported` (`0x1161c8`) (refuse : `0xD960A3F4`) | `httpc_ctx_003D_SetCrlStore` (`0x1179a8`) |
| 62 | CreateCrlStore | `+0x44` | `httpc_client_003E_CreateCrlStore` (`0x116210`) | `httpc_ctx_003E_CreateCrlStore_unsupported` (`0x117bd4`) (refuse : `0xD960A3F4`) |
| 63 | DestroyCrlStore | `+0x48` | `httpc_client_003F_DestroyCrlStore` (`0x11660c`) | `httpc_ctx_003F_DestroyCrlStore_unsupported` (`0x117d20`) (refuse : `0xD960A3F4`) |
| 64 | AddCrlToCrlStore | `+0x4c` | `httpc_client_0040_AddCrlToCrlStore` (`0x116810`) | `httpc_ctx_0040_AddCrlToCrlStore_unsupported` (`0x117f14`) (refuse : `0xD960A3F4`) |
| 65 | AddInternalCrl | `+0x50` | `httpc_client_0041_AddInternalCrl` (`0x11724c`) | `httpc_ctx_0041_AddInternalCrl_unsupported` (`0x1187d0`) (refuse : `0xD960A3F4`) |
| 66 | RemoveCrlFromCrlStore | `+0x54` | `httpc_client_0042_RemoveCrlFromCrlStore` (`0x117074`) | `httpc_ctx_0042_RemoveCrlFromCrlStore_unsupported` (`0x118690`) (refuse : `0xD960A3F4`) |

Ce qu'il faut retenir du tableau :

- **Six commandes marchent des deux côtés** : CloseContext (3), CancelConnection (4), GetRequestState (5), GetDownloadSizeState (6), GetRequestError (7) et GetSslError (0x2A). Elles prennent une poignée de contexte. Côté client, la poignée est cherchée dans la liste des contextes (`client_find_context`, `0x10B940`) ; côté contexte, la méthode vérifie que la poignée est celle de son propre contexte (`*(contexte+0x18) == poignée`), et sinon rend `0xD8A0A066` pour celles qui le prévoient, ou ne fait rien (le résultat est alors ce que le compilateur laisse dans le registre : non lu).
- **Principale seulement** (16) : CreateContext (2), les chaînes de certificats racines (0x2D à 0x31), les contextes de certificat client (0x32 à 0x34), SetDefaultProxy (0x35), Finalize (0x39) et les magasins de CRL (0x3E à 0x42).
- **Contexte seulement** (41) : 0x09 à 0x29, 0x2B, 0x2C, 0x37, 0x38 et 0x3A à 0x3D, dont presque tout ce que Pokémon X envoie.
- **Dans la session même** (les trois lignes sans méthode) : Initialize (1), InitializeConnectionSession (8) et ClearDNSCache (0x36, qui appelle `0x112814` sans passer par l'objet). 16 + 41 + 6 + 3 = 66.

## Partie 4 : deux commandes pas à pas

### Initialize (commande 1)

`httpc_0001_Initialize` (`0x11962C`). Le mot 1 est la taille du bloc de mémoire partagée, le mot 2 le descripteur `0x20` (le noyau écrit le numéro du processus appelant au mot 3), le mot 4 le descripteur de poignée copiée et le mot 5 la poignée du bloc.

1. Si la session a déjà un objet derrière elle (`+0x10` non nul), le résultat est `0xD8A0A066`.
2. Si un compteur global (lu par pointeur à `0x119788`) vaut 16 ou plus, le résultat est `0xD8A0A067` (interprété : c'est le nombre de clients, que `client_init` augmente).
3. Un client de `0xBC` octets est alloué par le tas du module et construit par `client_ctor` (`0x1174F4`) ; une allocation qui rate donne `0xD860A003`.
4. `client_init` (`0x116150`) range le numéro du processus à `+0xC` du client. Si le bloc a une taille et une poignée, `shared_memory_map` (`0x114264`) le mappe : la taille doit être un multiple de `0x1000`, sinon `0xE0E01BF2` ; le mappage utilise `svcMapMemoryBlock` (`0x1F`) avec le droit 3. À la fermeture, `shared_memory_unmap` (`0x10DB8C`, `svcUnmapMemoryBlock`, `0x20`) le rend. Un client dont le mappage échoue est détruit.
5. La session devient principale (`+0xC` à 1), s'inscrit dans la liste globale (`0x11979C`, sous un verrou), et la commande rend `0`.

La taille du bloc est ce que 3dbrew appelle la « POST buffer size » : le module le mappe mais n'en fait rien de visible dans `Initialize` (son emploi n'est pas lu).

### Du contexte à la requête

Le chemin d'une requête de Pokémon X, d'une commande à l'autre :

1. **CreateContext** (2, session principale). La méthode de session passe l'adresse de l'URL, la méthode et le pointeur de sortie ; **elle ne passe pas la taille de l'URL** (mot 1), le module lit la chaîne jusqu'au zéro. `httpc_client_0002_CreateContext` (`0x116A80`) compte les contextes déjà ouverts (huit au plus, sinon `0xD8A0A01A`), puis demande à `context_core_create` (`0x112834`) un enregistrement de `0x870` octets (mis à zéro, avec deux objets de synchronisation), y range l'URL et la méthode (`0x1141BC`) et le met à l'état 1. La méthode est un octet : 1 GET, 2 POST, 3 HEAD, 4 PUT, 5 DELETE, 6 POST et 7 PUT (même table que 3dbrew ; les chaînes `GET `, `POST `, `HEAD `, `PUT `, `DELETE ` sont choisies par `request_write_head`, `0x1054C4`, avec 6 comme 2 et 7 comme 4). Le client range ensuite deux valeurs par défaut dans l'enregistrement (`+0x854` : une valeur globale ; `+0x858` : `0x3FC0` ; leur sens n'est pas lu, ce pourrait être la taille des tampons de socket de la commande 0x10), puis `client_add_context` (`0x1170BC`) crée l'objet de contexte de `0x70` octets (la poignée est à `+0x18`) et l'accroche à la liste du client. La poignée entière est la réponse (mot 2).
2. **L'appelant ouvre une nouvelle session `http:C`** (par `SRV_GetServiceHandle`, c'est le client qui le fait, pas le module) **et lui envoie InitializeConnectionSession** (8) avec la poignée. `httpc_0008_InitializeConnectionSession` (`0x119958`) exige une session libre (sinon `0xD8A0A066`) et appelle `session_attach_context` (`0x1197E8`) : celle-ci parcourt **toutes** les sessions principales, retient celles dont le numéro de processus est celui de l'appelant et cherche la poignée dans leur liste (`client_find_context`). Trouvée, la session devient une session de contexte (`+0xC` à 2) et son objet est le contexte ; sinon le résultat est `0xD8A0A064`. **Un contexte ne peut donc être pris que par une session du même processus que celui qui l'a créé.**
3. Les commandes de réglage (AddRequestHeader, AddDefaultCert, SetPostDataType…) arrivent sur cette session de contexte. Le contexte vérifie que la poignée est la sienne, puis appelle le cœur de contexte, qui range le réglage dans l'enregistrement (partie 5).
4. **BeginRequestAsync** (10) passe par `request_begin` (`0x10A854`), qui travaille sur l'état de l'**objet** de contexte (octet `+0xC`) : l'état 3 passe à 9 et l'état 4 (posé par SetPostDataType) à 5, l'événement de fin est créé au premier appel (`svcCreateEvent`, `0x104AB0`), puis le cœur passe à l'état 2 et l'enregistrement est poussé dans la file des fils de requête. BeginRequest (9) appelle `request_begin(objet, 0)` et pousse avec `context_core_queue_blocking` (`0x113600`, qui attend de la place, par `job_queue_push_blocking`, `0x11A828`) ; **BeginRequestAsync (10) appelle `request_begin(objet, 1)` et pousse sans attendre** (`context_core_queue_nonblocking`, `0x113688`, par `job_queue_push`, `0x10F35C`) : si la file est pleine, l'état du cœur revient à 1 et le résultat interne est `0xFFFFE00A`, soit `0xD8A0A00A`. Si la mise en file échoue, l'état de l'objet revient à 1.
5. Un fil de requête (`http_request_worker`, `0x10384C`) prend l'enregistrement et fait, en réglant à chaque pas l'état du cœur : 3 (pris), 5 puis `request_connect` (`0x104B08`), 6 puis `request_write_head` (`0x1054C4`, la ligne de requête, `Host:`, les en-têtes, la fin de ligne), 7 puis `request_send_body` (`0x1052D4`), 8 puis `request_read_response` (`0x104E40`, `1164` octets : la ligne d'état, les en-têtes, `Content-Length`, `Transfer-Encoding: chunked`, `Connection: Keep-Alive`), 9 (données prêtes), 10 (terminée ou en échec). Le sens exact des états est interprété ; l'ordre est lu.
6. **GetDownloadSizeState** (6) lit deux champs du cœur (`context_core_get_download_size`, `0x112AB8`) : le nombre d'octets reçus (`+0x7BC`) et la taille totale (`+0x364`, ou 0 tant qu'elle n'est pas connue : l'indicateur est à `+0x360`).
7. **GetResponseStatusCode** (34) et **GetResponseHeader** (30) commencent par `request_wait_event` (`0x10B280`) : si l'objet est fermé (`+0x10`), `0xD8A0A018` ; si son état est inférieur à 9, `0xD8A0A016` (« pas prêt ») ; sinon elle attend l'événement de fin (sans délai pour la version sans délai, avec délai pour l'autre : `0xD820A069` si le temps est écoulé). Ensuite le code d'état HTTP est lu dans le cœur (`+0x368`, `request_get_status_code`, `0x10AE68`, qui exige l'état du cœur supérieur à 7), ou l'en-tête demandé est cherché par son nom dans le tampon du cœur (`+0x36C`, `request_get_response_header`, `0x10ABFC`).
8. **ReceiveData** (11) passe par `request_receive_data` (`0x10A4C8`) : l'état de l'objet doit être 9 ou 12 (`0xC`) ; la commande range l'adresse et la taille du tampon de sortie dans l'objet (`+0x58` et `+0x5C`), passe l'état à 10 ou 11, signale l'événement du fil de requête et attend. Quand elle se réveille : l'état 12 donne `0xD840A02B` (« téléchargement en cours » : il reste des données, le client rappelle) et tout autre état rend le résultat final de la requête. La version à délai (12) rend `0xD820A069` si le temps est écoulé.
9. **CloseContext** (3) retire le contexte de la liste du client et détruit l'objet (la méthode `+4` du contexte) ; il rend 0 même si la poignée n'existe pas.

## Partie 5 : les deux enregistrements d'un contexte

Un contexte a deux enregistrements. L'**objet de contexte** (`0x70` octets, créé par `client_add_context`, `0x1170BC`, table de méthodes `0x11B744`) est ce que la session de contexte tient ; le **cœur** (`0x870` octets, créé par `context_core_create`, `0x112834`) est la requête elle-même, retrouvée par sa poignée entière (`context_core_from_id`, `0x10F4A8`, qui compare l'identifiant écrit à `+0` à la poignée). Les champs ci-dessous sont ceux que les commandes lues touchent (décalages en octets depuis le début de l'enregistrement) ; leurs noms sont du texte de la fiche, pas posés dans Ghidra, et tout est interprété à partir des lectures.

**L'objet de contexte**

| Décalage | Contenu |
| --- | --- |
| `+0x04` et `+0x08` | liens de la liste des contextes du client |
| `+0x0C` | état de l'objet (octet) : 1 créé ou revenu d'un échec, 3 puis 9 pour une requête sans corps à envoyer, 4 puis 5 après SetPostDataType, 6 et 8 pendant l'envoi du corps, 9 et 12 quand les données sont prêtes à être lues, 10 et 11 pendant une lecture |
| `+0x0E` | indicateur qui oriente la file de travail (partie 2) |
| `+0x10` | indicateur « fermé » (`0xD8A0A018` quand il est levé) |
| `+0x18` | la poignée entière du contexte, c'est-à-dire l'identifiant du cœur ; **c'est elle que chaque commande compare à la poignée reçue** |
| `+0x2C`, `+0x30` | l'événement de fin : indicateur « créé » et poignée |
| `+0x34` | second événement (signalé quand l'état change) |
| `+0x4C` | verrou de l'objet |
| `+0x58`, `+0x5C` | adresse et taille du tampon de ReceiveData |

**Le cœur**

| Décalage | Contenu |
| --- | --- |
| `+0x000` | identifiant (la poignée entière rendue au client) |
| `+0x004` | état de la requête : 0 libre, 1 créé, 2 en file, 3 pris par un fil, 5 connexion, 6 envoi de la ligne de requête et des en-têtes, 7 envoi du corps, 8 lecture de la réponse, 9 réponse reçue, 10 terminé ou en échec (l'ordre est lu dans `http_request_worker`, le sens est interprété) |
| `+0x00C` | indicateur « annulé » (les fils de requête le regardent à chaque pas) |
| `+0x010` | l'URL et la méthode (rangées à la création par `0x1141BC`) |
| `+0x29C` | la liste des en-têtes de requête ajoutés (`context_core_add_request_header`, `0x11238C`) |
| `+0x2A0` à `+0x2C4` | l'état des données POST : le type (ASCII, binaire ou brut, `request_set_post_type`, `0x10A3A4`), refusé s'il y a déjà des données (`+0x2A4`, `+0x2BC`) |
| `+0x2D0`, `+0x2D4` | l'objet de chaîne de certificats racines et son indicateur (créé au premier ajout par `context_core_add_default_cert_impl`, `0x113E78`) |
| `+0x2D8`, `+0x2DC` | l'objet de certificat client par défaut (`context_core_set_client_cert_default_impl`, `0x113D80`), refusé s'il existe déjà |
| `+0x358` | le mot de la commande 0x37 |
| `+0x35C` | l'octet de la commande 0x3A (0 ou 1) |
| `+0x360`, `+0x364` | indicateur « taille connue » et taille totale du corps |
| `+0x368` | le code d'état HTTP |
| `+0x36C` | les en-têtes de réponse |
| `+0x7BC` | le nombre d'octets reçus |
| `+0x814` | la valeur que rend la commande 0x2A (GetSslError) |
| `+0x854`, `+0x858` | deux valeurs par défaut rangées à la création (partie 4) |
| `+0x868` | un verrou récursif pris par chaque commande qui change l'enregistrement |

## Partie 6 : les services que `http` appelle

Chaque requête envoyée a sa petite fonction (un seul `svcSendSyncRequest` en ligne, 45 fonctions d'envoi relevées dans le pseudo-code de Ghidra). La poignée est une variable globale pour `srv:` (`0x11C30C`) et `ptm:s` (`0x11C348`), et un paramètre pour les autres. Le service de chaque envoi est reconnu à son en-tête, comparé aux tables de 3dbrew de chaque service (Socket Services, SSL Services), aux chaînes `soc:U` et `ssl:C` du module et aux appels (par exemple `tls_create_context_session`, `0x108D44`, ouvre `ssl:C` par `SRV_GetServiceHandle`, puis envoie `SSLC_InitializeConnectionSession`).

| Service | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- |
| `srv:` (port) | `0x00010002` | `SRV_RegisterClient` | `0x100CA0` | se déclarer à `sm` |
| | `0x00020000` | `SRV_EnableNotification` | `0x10311C` | obtenir le sémaphore des notifications |
| | `0x00030100` | `SRV_RegisterService` | `0x1030C0` | créer `http:C` |
| | `0x000400C0` | `SRV_UnregisterService` | `0x1020E0` | le retirer à l'arrêt |
| | `0x00050100` | `SRV_GetServiceHandle` | `0x10F87C` | ouvrir `ssl:C`, `soc:U` et `ptm:s` |
| | `0x000B0000` | `SRV_ReceiveNotification` | `0x103158` | lire une notification |
| `err:f` (port) | `0x00010800` | `ERRF_Throw` | `0x1046C0` | signaler une erreur fatale |
| `ptm:s` | `0x040A0000` | `PTMS_CheckNew3DS` | `0x101D64` | savoir si la console est une New 3DS (la Carte nomme cette commande CheckNew3DS pour `ptm:s`) |
| `soc:U` | `0x00010044` | `SOCU_InitializeSockets` | `0x1049D4` | une fois, au démarrage (partie 1) |
| | `0x000200C2` | `SOCU_socket` | `0x111498` | créer un socket (AF_INET ou AF_INET6 selon le contexte, par `socket_create_for_request`, `0x1069C0`) |
| | `0x00060084` | `SOCU_connect` | `0x1114E4` | se connecter |
| | `0x00080102` | `SOCU_recvfrom` | `0x1113F4` | lire |
| | `0x00070104` | `SOCU_recvfrom_other` | `0x1121CC` | lire (variante) |
| | `0x000A0106` | `SOCU_sendto` | `0x112094` | écrire |
| | `0x00090106` | `SOCU_sendto_other` | `0x112148` | écrire (variante) |
| | `0x000B0042` | `SOCU_close` | `0x109924` | fermer |
| | `0x000C0082` | `SOCU_shutdown` | `0x107A3C` | couper une connexion |
| | `0x000F0106` | `SOCU_getaddrinfo` | `0x111FCC` | résoudre un nom |
| | `0x00120104` | `SOCU_setsockopt` | `0x11138C` | régler un socket (tailles de tampons) |
| | `0x00190000` | `SOCU_ShutdownSockets` | `0x104A18` | à l'arrêt du module |
| | `0x00230040` | `SOCU_AddGlobalSocket` | `0x112118` | (nom de 3dbrew) |
| `ssl:C` | `0x00010002` | `SSLC_Initialize` | `0x105D4C` | une fois, au démarrage |
| | `0x000200C2` | `SSLC_CreateContext` | `0x1109C0` | un contexte TLS par connexion |
| | `0x00120042` | `SSLC_InitializeConnectionSession` | `0x110988` | attacher une session à ce contexte |
| | `0x00130040` | `SSLC_StartConnection` | `0x108E54` | la poignée de main TLS |
| | `0x00150082` / `0x00170082` | `SSLC_Read` / `SSLC_Write` | `0x112250` / `0x1122A0` | lire et écrire en clair |
| | `0x00180080` | `SSLC_ContextSetRootCertChain` | `0x108EC8` | choisir la chaîne de racines |
| | `0x00190080` | `SSLC_ContextSetClientCert` | `0x108EA0` | choisir le certificat client |
| | `0x001A0080` | `SSLC_SetCrlStore` | `0x108E78` | choisir le magasin de CRL |
| | `0x001B0080` | `SSLC_ContextClearOpt` | `0x108EF0` | retirer des options de vérification |
| | `0x001E0040` | `SSLC_DestroyContext` | `0x1079B0` | fermer le contexte TLS |
| | `0x00030000`, `0x00040040`, `0x00050082`, `0x00060080` | `SSLC_CreateRootCertChain`, `SSLC_DestroyRootCertChain`, `SSLC_AddTrustedRootCA`, `SSLC_RootCertChainAddDefaultCert` | `0x114798`, `0x108F8C`, `0x11487C`, `0x1149C0` | les chaînes de racines (commandes 0x2D, 0x2E, 0x2F, 0x30 de `http:C`) |
| | `0x00080000`, `0x00090040`, `0x000A0082`, `0x000B0080`, `0x000C0080` | `SSLC_CreateCrlStore`, `SSLC_DestroyCrlStore`, `SSLC_AddCrlToCrlStore`, `SSLC_AddInternalCrlToCrlStore`, `SSLC_RemoveCrlFromCrlStore` | `0x114764`, `0x108F5C`, `0x1147CC`, `0x114934`, `0x1148CC` | les magasins de CRL (commandes 0x3E à 0x42) |
| | `0x000D0084`, `0x000E0040`, `0x000F0040` | `SSLC_OpenClientCertContext`, `SSLC_OpenDefaultClientCertContext`, `SSLC_CloseClientCertContext` | `0x11481C`, `0x11497C`, `0x108FBC` | les certificats client (commandes 0x32 à 0x34) |

`SSLC_RemoveCertFromRootChain` (`0x00070080`) est envoyée en ligne par `httpc_client_0031_RootCertChainRemoveCert` (`0x11721C`), qui n'a donc pas de fonction d'envoi à part.

Le côté `ssl` de ces échanges est dans [ssl](ssl.md).

## Partie 7 : ce que `http` fait seul

- **Au démarrage** : `soc:U` et `ssl:C` sont initialisés avant toute session (partie 1). Un client qui fait `Initialize` n'ouvre donc pas de réseau. Le résultat `0xD8A0A046` que 3dbrew attribue à `Initialize` quand « il n'y a pas de connexion » n'est écrit nulle part dans les trois fonctions d'`Initialize` (`0x11962C`, `0x116150`, `0x1174F4`) : s'il existe, il vient d'une étape plus loin (la résolution d'un nom au moment de la connexion). Voir la partie 9.
- **La connexion** : `request_connect` (`0x104B08`) regarde si la connexion précédente du fil peut servir (même hôte, `Keep-Alive` : interprété), sinon crée un socket (`0x1069C0` : AF_INET, ou AF_INET6 selon l'octet `+0x216` du contexte) et le règle puis le connecte (`socket_setup_and_connect`, `0x1066FC` : options de socket par `SOCU_setsockopt`, puis `connect`). Pour une URL en `https`, `tls_start_connection` (`0x1065CC`) ouvre une session `ssl:C` (`tls_create_context_session`, `0x108D44`), règle la chaîne de racines, le certificat client, le magasin de CRL, puis `SSLC_StartConnection`.
- **Les certificats** : AddDefaultCert (37) demande une racine par son numéro (`context_core_add_default_cert`, `0x113124`), qui passe par une chaîne de racines propre au contexte (objet à `+0x2D0`, créé au premier ajout) ; SetClientCertDefault (40) ouvre le certificat client par défaut (objet à `+0x2D8`). Le module **ne contient pas de certificat** : ce sont les archives de la NAND (`certificats-ca`, `clcerta`) que `ssl:C` lit. La correspondance entre le numéro et la racine est dans `ssl`, pas lue ici.
- **Le serveur mandataire** : SetProxyDefault (14) copie dans le contexte (`request_set_proxy`, `0x10A9B0`) la configuration par défaut du module, **si elle existe** (un indicateur global à `+4` de l'enregistrement de `0x117EC8`) ; sinon il rend `0` sans rien faire. La configuration par défaut est celle qu'écrit SetDefaultProxy (53), que Pokémon X n'envoie pas.

## Partie 8 : les appels système utilisés

29 numéros, relevés dans le pseudo-code de Ghidra. `svcSendSyncRequest` est écrit en ligne dans les 45 fonctions d'envoi ; `svcCloseHandle`, `svcWaitSynchronization1`, `svcSignalEvent` et `svcClearEvent` sont en ligne dans plusieurs fonctions (nombre entre parenthèses).

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x100770` |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x10177C` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x119DBC` (et `entry`) |
| CreateThread | `0x08` | `svcCreateThread` | `0x104AE4` |
| ExitThread | `0x09` | en ligne | `0x106490` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x10DF48` (aussi `0x10DF4C`, `0x10E190`) |
| CreateSemaphore | `0x15` | `svcCreateSemaphore` | `0x101764` |
| ReleaseSemaphore | `0x16` | `svcReleaseSemaphore` | `0x10E6C0` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x104AB0` |
| SignalEvent | `0x18` | en ligne (8 fonctions) | par exemple `0x10F294` |
| ClearEvent | `0x19` | en ligne (3 fonctions) | par exemple `0x10F504` |
| CreateMemoryBlock | `0x1E` | `svcCreateMemoryBlock` | `0x104AC8` |
| MapMemoryBlock | `0x1F` | en ligne | `0x114264` |
| UnmapMemoryBlock | `0x20` | en ligne | `0x10DB8C` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x10174C` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x10D2AC` |
| CloseHandle | `0x23` | en ligne (47 fonctions) | par exemple `0x104698` |
| WaitSynchronization1 | `0x24` | en ligne (13 fonctions) | par exemple `0x102460` |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x107B10` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x1122F0` |
| GetSystemTick | `0x28` | en ligne (2 fonctions) | `0x10A4C8` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x1027D0` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x1027B8` |
| SendSyncRequest | `0x32` | en ligne (45 fonctions) | `0x100CA0` et les autres envois |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x103834` |
| GetThreadId | `0x37` | `svcGetThreadId` | `0x1027EC` |
| Break | `0x3C` | `svcBreak` | `0x10FA2C` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x10381C` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x10E0B0` |

Ils n'ont pas été comparés au masque d'appels système de l'exheader (l'exheader de `http` n'a pas été décodé jusque-là).

## Partie 9 : désaccords avec 3dbrew et la Carte des services

Ces écarts sont à reporter dans `carte-des-services/corrections.js`. Les numéros sont ceux de la colonne « N° » des tableaux de la partie 3.

1. **SetKeepAlive, deux commandes différentes (0x37 et 0x3A).** 3dbrew nomme `0x00370080` « SetKeepAlive (bool) » et `0x003A0080` « SetKeepAlive? ». Le code les distingue : la commande 0x37 (`httpc_ctx_0037_SetKeepAliveWord`, `0x11890C`) range un **mot sans vérification** à `+0x358` du cœur de contexte ; la commande 0x3A (`httpc_ctx_003A_SetKeepAliveBool`, `0x118120`) range un **octet** à `+0x35C` et **refuse toute valeur de 2 ou plus** (`0xFFFFE002` en interne, donc `0xD8E0A002`). Le booléen est donc 0x3A, et 0x37 est un mot à autre usage (une durée, un compteur ? non lu). Le sens des deux champs n'est pas suivi dans `request_read_response`.
2. **Le type de session.** 3dbrew ne marque « Main-only » que CreateContext et les commandes 0x2D à 0x35, et « Context-only » que 0x10, 0x28, 0x29, 0x2B et 0x2C (plus « All » pour 3 et 0x2A). Le code range **toutes** les commandes dans un type : principale seulement, CreateContext, 0x2D à 0x35, **et en plus Finalize (0x39) et les magasins de CRL (0x3E à 0x42)** ; contexte seulement, 0x09 à 0x29, 0x2B, 0x2C, 0x37, 0x38 et 0x3A à 0x3D (**en plus de** 0x10, 0x28, 0x29, 0x2B et 0x2C de 3dbrew) ; les deux types, 3 à 7 et 0x2A (**3dbrew ne marque « All » que 3 et 0x2A** : 4 à 7 marchent aussi des deux côtés) ; ni l'un ni l'autre (dans la session même), Initialize, InitializeConnectionSession et ClearDNSCache. Le résultat d'une commande sur le mauvais type de session est `0xD960A3F4` (partie 2) ; 3dbrew donne `0xD960BBF4` sur la page de `ssl:C` mais n'a pas ce code sur la page de `http:C`.
3. **Qui appelle `http:C`.** La Carte donne pour `http:C` les appelants `friends` et `nim`. Pokémon X appelle `http:C` lui-même (24 commandes dans `pokemon-x-services.tsv`, `jeu` vrai déjà dans la Carte). Les appels de `friends` et `nim` ne sont pas lus ici ; `ac` déclare `http` parmi ses dépendances (`ac.md`, Carte d'identité), sans que ses appels à `http:C` aient été relevés. Rien à retirer, rien de certain à ajouter.
4. **Les services que `http` appelle.** La Carte donne `soc:U` pour `http` (juste). Elle ne donne pas `ssl:C` ni `ptm:s` : le module envoie 24 commandes différentes à `ssl:C` et une (`0x040A0000`, `CheckNew3DS`) à `ptm:s`. À ajouter à la liste des appelants de `ssl:C` et de `ptm:s`, et `srv:` et `err:f` comme pour les autres modules.
5. **Initialize et le réseau.** 3dbrew écrit que `HTTPC:Initialize` rend `0xD8A0A046` quand la console n'a pas de connexion. Dans le module, `Initialize` n'ouvre pas de réseau et n'a pas ce code (partie 7) ; les sockets sont initialisés au démarrage du module. La ligne de 3dbrew n'est ni confirmée ni contredite, elle n'est simplement pas dans cette fonction.
6. **Les codes d'erreur de 3dbrew** (`0xD8A0A066`, `0xD820A069`) sont bien dans le code : `0xD8A0A066` pour une poignée de contexte inconnue (et pour une session déjà initialisée), `0xD820A069` pour un délai écoulé. Rien à corriger. Quatre codes du code ne sont pas sur la page de 3dbrew : `0xD8A0A064` (InitializeConnectionSession ne trouve pas le contexte dans une session du même processus), `0xD8A0A067` (déjà 16 clients), `0xD8A0A01A` (déjà 8 contextes pour ce client) et `0xD840A02B` (téléchargement en cours : ReceiveData n'a pas tout rendu), plus `0xD8A0A016` (« pas prêt ») et `0xD8A0A018` (contexte fermé).
7. **La méthode de requête** de CreateContext : la table de 3dbrew (1 GET, 2 POST, 3 HEAD, 4 PUT, 5 DELETE, 6 POST, 7 PUT) est exactement celle du code, qui traite 6 comme 2 et 7 comme 4 pour la ligne de requête (`GET`, `POST`, `HEAD`, `PUT`, `DELETE`) ; la différence entre 2 et 6, entre 4 et 7, est dans la suite du traitement (non lue). Rien à corriger.

Les en-têtes de requête de 3dbrew sont tous retrouvés dans le code : les 28 comparaisons d'en-tête entier de l'aiguillage (dont les 9 que seul le pseudo-code donne) donnent les mêmes 28 valeurs que 3dbrew, et les 66 numéros sont les mêmes.

## Partie 10 : ce que Pokémon X envoie

Les 24 lignes de `pokemon-x-services.tsv` pour `http:C`. La poignée générale du jeu est à `0x6420E4`, recopiée à `0x6420E8` (`http_open_session`, `0x163C94`), et chaque contexte rouvre `http:C` (`http_context_open_session`, `0x2B8BA4`) et garde sa poignée dans un champ de l'objet. Les paramètres et les appelants sont lus dans le pseudo-code du jeu (`local/analyse/maj/gh/pseudo/`) ; l'ordre d'un appel complet est reconstitué de `0x23E1DC` (ouverture) et `0x23E3D4` (réglages, envoi). Les URL, les serveurs et les en-têtes réellement envoyés ne sont pas lus : ce sont des chaînes que d'autres fonctions préparent.

La suite qu'un jeu parcourt pour une requête :

1. `Initialize` une fois, au démarrage, avec un bloc partagé de `0x2000` octets (appelant `0x12CAF0`, `FUN_0013BA48(…, 0x2000)`) ;
2. pour chaque requête : `CreateContext` (URL, méthode), ouverture d'une session, `InitializeConnectionSession`, `SetProxyDefault` si l'appelant le demande ;
3. les réglages : `AddDefaultCert` pour les numéros 1 à 10 (dix appels l'un après l'autre ; un échec sort de la série), `SetClientCertDefault` avec le numéro `0x40` si l'indicateur correspondant est levé, `SetPostDataType`/`SetPostDataTypeSize` et un `Content-Type: multipart/form-data; boundary=…` pour un envoi en plusieurs parties, `AddRequestHeader` et `AddPostDataAscii`/`AddPostDataBinary`/`AddPostDataRaw` ;
4. `BeginRequestAsync`, puis la scrutation : `GetDownloadSizeState`, `GetResponseStatusCode`, `GetResponseHeader` par son nom, `ReceiveData` par morceaux (ou `SendPostDataRaw`/`NotifyFinishSendPostData` pour une requête dont le corps part par morceaux) ;
5. `CloseContext` (ou `CancelConnection` puis `CloseContext`) ; `Finalize` à la fin de la session.

| En-tête | Commande | Fonction du jeu | Appelants | Fonction du module (session, puis contexte ou client) | Ce qu'il faut rendre |
| --- | --- | --- | --- | --- | --- |
| `0x00010044` | Initialize | `0x172F00` | 1 : `http_open_session` (`0x163C94`), par `0x13BA48` | `httpc_0001_Initialize` (`0x11962C`) | résultat 0 (`0x00010040`). La taille doit être un multiple de `0x1000` (le jeu donne `0x2000`). Le bloc partagé peut rester **factice** : le jeu n'en lit rien. C'est la première commande, sans elle les suivantes n'ont pas de client |
| `0x00020082` | CreateContext | `0x2B9394` | 1 : `http_context_open_session` (`0x2B8BA4`) | `httpc_0002_CreateContext` (`0x1191C8`), `httpc_client_0002_CreateContext` (`0x116A80`) | résultat 0 et, au mot 2, une **poignée de contexte non nulle et distincte** de celles déjà ouvertes (le jeu la renvoie dans chaque commande). Huit contextes au plus par client, sinon `0xD8A0A01A` |
| `0x00030040` | CloseContext | `0x2B944C` | 3 : `0x2B8FC0`, `0x2B9088`, `0x2B90E8` | `httpc_0003_CloseContext` (`0x119294`), `httpc_ctx_0003_CloseContext` (`0x118240`) | résultat 0, même pour une poignée inconnue ; libère le contexte |
| `0x00040040` | CancelConnection | `0x2B9364` | 1 : `0x2B8F84` | `httpc_0004_CancelConnection` (`0x119164`), `httpc_ctx_0004_CancelConnection` (`0x117FFC`) | résultat 0 ; arrête la requête en cours (un indicateur « annulé » que les fils regardent) |
| `0x00060040` | GetDownloadSizeState | `0x2B94E0` | 1 : `0x483514` | `httpc_0006_GetDownloadSizeState` (`0x119458`), `httpc_ctx_0006_GetDownloadSizeState` (`0x118618`) | résultat 0 et deux mots : **octets déjà reçus**, **taille totale ou 0** tant qu'elle n'est pas connue. Doit être **vrai** : c'est ce que le jeu scrute pour suivre le téléchargement (l'usage exact des deux mots n'est pas lu) |
| `0x00080042` | InitializeConnectionSession | `0x2B9604` | 1 : `0x2B8BA4` | `httpc_0008_InitializeConnectionSession` (`0x119958`), `session_attach_context` (`0x1197E8`) | résultat 0 si la poignée existe pour ce processus, `0xD8A0A064` sinon |
| `0x000A0040` | BeginRequestAsync | `0x2B94B0` | 1 : `0x2B8CCC` | `httpc_000A_BeginRequestAsync` (`0x119434`), `httpc_ctx_000A_BeginRequestAsync` (`0x1185F8`) | résultat 0 tout de suite (ou `0xD8A0A00A` si la file des requêtes est pleine) ; la requête se fait ensuite **sans bloquer** le jeu (il scrute). C'est **ici** que se décide si le jeu voit un réseau ou pas |
| `0x000B0082` | ReceiveData | `0x2B967C` | 1 : `0x2B8F44` | `httpc_000B_ReceiveData` (`0x119B94`), `httpc_ctx_000B_ReceiveData` (`0x118B70`) | **bloque** jusqu'à ce que le tampon soit plein ou que tout soit reçu. Résultat 0 si c'est fini, **`0xD840A02B` s'il en reste** (le jeu rappelle) |
| `0x000E0040` | SetProxyDefault | `0x2B92D4` | 1 : `0x2B8BA4`, si l'appelant le demande | `httpc_000E_SetProxyDefault` (`0x1190A0`), `httpc_ctx_000E_SetProxyDefault` (`0x117DD4`) | résultat 0 ; **factice** (aucun mandataire sur PC) |
| `0x001100C4` | AddRequestHeader | `0x2B9180` | 1 : `0x2B8D10` | `httpc_0011_AddRequestHeader` (`0x118E60`), `httpc_ctx_0011_AddRequestHeader` (`0x117B00`) | résultat 0 ; garder le couple (nom, valeur) pour une vraie requête, ignorer sinon |
| `0x001200C4` | AddPostDataAscii | `0x2B9304` | 1 : `0x2B8DF8` | `httpc_0012_AddPostDataAscii` (`0x11913C`), `httpc_ctx_0012_AddPostDataAscii` (`0x117F20`) | résultat 0 (même remarque) |
| `0x001300C4` | AddPostDataBinary | `0x2B93EC` | 1 : `0x2B8E68` | `httpc_0013_AddPostDataBinary` (`0x11923C`), `httpc_ctx_0013_AddPostDataBinary` (`0x118150`) | résultat 0 (même remarque) |
| `0x00140082` | AddPostDataRaw | `0x2B91E0` | 1 : `0x2B8D80` | `httpc_0014_AddPostDataRaw` (`0x118E88`), `httpc_ctx_0014_AddPostDataRaw` (`0x117B30`) | résultat 0 (même remarque) |
| `0x00150080` | SetPostDataType | `0x2B9598` | 1 : `0x2B8ED0` | `httpc_0015_SetPostDataType` (`0x119510`), `httpc_ctx_0015_SetPostDataType` (`0x1186F4`) | résultat 0 ; `0xD8A0A032` si des données POST sont déjà ajoutées, `0xD8A0A016` si la requête n'est plus à l'état « créé » |
| `0x001A0082` | SendPostDataRaw | `0x2B9290` | 1 : `0x2B8DBC` | `httpc_001A_SendPostDataRaw` (`0x119014`), `httpc_ctx_001A_SendPostDataRaw` (`0x117D2C`) | **bloque** puis résultat 0 (le jeu s'en sert pour un corps envoyé par morceaux) |
| `0x001D0040` | NotifyFinishSendPostData | `0x2B95D4` | 1 : `0x2B8F24` | `httpc_001D_NotifyFinishSendPostData` (`0x119648`), `httpc_ctx_001D_NotifyFinishSendPostData` (`0x118840`) | résultat 0 (signale la fin du corps) |
| `0x001E00C4` | GetResponseHeader | `0x2B9224` | 1 : `0x4835FC` | `httpc_001E_GetResponseHeader` (`0x118F24`), `httpc_ctx_001E_GetResponseHeader` (`0x117BEC`) | **bloque** jusqu'à ce que les en-têtes soient reçus, puis rend la valeur de l'en-tête demandé et sa taille (mot 2). Un en-tête absent est une erreur que le jeu gère (lecture du jeu non suivie) |
| `0x00220040` | GetResponseStatusCode | `0x2B9144` | 1 : `0x4835C4` | `httpc_0022_GetResponseStatusCode` (`0x118DFC`), `httpc_ctx_0022_GetResponseStatusCode` (`0x117A64`) | **bloque** jusqu'à ce que les en-têtes soient reçus, puis le code HTTP (200, 404, …) au mot 2 |
| `0x00240082` | AddTrustedRootCA | `0x2B96C0` | 1 : `0x2B901C` | `httpc_0024_AddTrustedRootCA` (`0x119BFC`), `httpc_ctx_0024_AddTrustedRootCA` (`0x118BD8`) | résultat 0 ; **factice** |
| `0x00250080` | AddDefaultCert | `0x2B947C` | 1 : `0x2B9048` (10 sites, numéros 1 à 10) | `httpc_0025_AddDefaultCert` (`0x1192E0`), `httpc_ctx_0025_AddDefaultCert` (`0x11835C`) | résultat 0 pour les numéros 1 à 10 ; **factice** si on fait confiance au système, **à brancher** sur des racines si on veut contrôler la confiance |
| `0x00280080` | SetClientCertDefault | `0x2B9564` | 1 : `0x2B8CEC`, avec `0x40` | `httpc_0028_SetClientCertDefault` (`0x1194EC`), `httpc_ctx_0028_SetClientCertDefault` (`0x1186CC`) | résultat 0 ; **factice** (le certificat client de la console n'existe pas sur PC) |
| `0x002A0040` | GetSslError (3dbrew : inconnue) | `0x2B9528` | 1 : `0x483570`, par `0x23F308` | `httpc_002A_GetSslError` (`0x11947C`), `httpc_ctx_002A_GetSslError` (`0x118648`) | résultat 0 et un mot (0 s'il n'y a pas eu d'erreur de TLS) |
| `0x003800C0` | SetPostDataTypeSize | `0x2B963C` | 1 : `0x2B8ED0`, avec le type 2 (brut) | `httpc_0038_SetPostDataTypeSize` (`0x119A40`), `httpc_ctx_0038_SetPostDataTypeSize` (`0x118AD8`) | résultat 0 |
| `0x00390000` | Finalize | `0x163C6C` | 1 : `0x148F78`, à la fin | `httpc_0039_Finalize` (`0x118F00`), `httpc_client_0039_Finalize` (`0x1163A4`) | résultat 0 ; ne s'exécute que sur la session principale |

**Ce qui doit être vrai.** La machine à contextes : des poignées distinctes, une session par contexte, les commandes d'un contexte qui ne marchent que sur la bonne session, le comportement bloquant de ReceiveData, GetResponseHeader et GetResponseStatusCode, et `0xD840A02B` tant qu'il reste des données. Sans cela le jeu boucle ou plante, quelle que soit la réponse du serveur.

**Ce qui peut rester factice.** Le bloc partagé d'`Initialize` (lu par personne côté jeu), les certificats (`AddDefaultCert`, `SetClientCertDefault`, `AddTrustedRootCA`), le mandataire (`SetProxyDefault`), `SetPostDataType` et sa variante, `GetSslError`, `NotifyFinishSendPostData` : un résultat 0 suffit. Les en-têtes et le corps POST peuvent être accumulés ou jetés.

**Ce qui dépend du but.**

- **Refuser le réseau** (le choix proposé par l'inventaire, `pokemon-x-services.md` partie 4 : « le jeu en ligne : refuser la connexion »). Faire réussir `Initialize`, `CreateContext`, `InitializeConnectionSession` et les réglages, puis faire échouer la requête avec un résultat du module de `http` que le jeu traite comme un échec réseau : la forme est celle de 3dbrew (`0xD8A0A049`, un délai de connexion, ou `0xD8A0A046`, pas de connexion). `BeginRequestAsync` peut rendre `0` et les scrutations suivantes (`GetResponseStatusCode`, `GetDownloadSizeState`, `ReceiveData`) rendre l'erreur. Ce que le jeu fait de chaque erreur n'est **pas lu** : il faut le vérifier au banc avant de choisir le code.
- **Faire de vraies requêtes** (pour un serveur de fans ou un portage en ligne). Alors il faut vraiment : la méthode et l'URL de CreateContext, les en-têtes, les corps POST des trois sortes, le statut, les en-têtes de réponse (surtout `Content-Length`, que le jeu lit par `GetDownloadSizeState`), les données par morceaux. Les certificats de Nintendo (numéros 1 à 10 et le certificat client `0x40`) n'ont d'intérêt que si le serveur visé les exige : un serveur de fans en HTTP ou avec ses propres certificats fait réussir les appels sans les utiliser.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 66 numéros de commande de `http:C`, leur méthode de session et leur emplacement dans la table : le pseudo-code de Ghidra de l'aiguillage `httpc_dispatch_command` (`0x114BA8`) d'un côté, et de l'autre `emulate_dispatch.py`, qui exécute l'aiguillage pour chaque numéro. 57 commandes sont retrouvées des deux côtés avec le même emplacement ; les 9 restantes (11, 12, 13, 16 à 19, 1E, 1F en hexadécimal) portent deux tampons que l'émulation ne sait pas fabriquer : leur emplacement et leur en-tête sont lus dans le pseudo-code et dans les constantes de la table de données, **une seule voie**.
- Les 66 en-têtes de réponse : écrits par le pseudo-code (constantes lues dans la table de données) et rendus par l'émulation, pour les 57 acceptées ; les 9 autres, pseudo-code seul.
- La liste des 66 numéros et les 28 en-têtes de requête entiers : identiques à 3dbrew (`local/analyse/http/cmp3dbrew.py`).
- La table de méthodes de session (`0x11B854`) lue dans la mémoire du module, la table du client (`0x11B5DC`) et celle du contexte (`0x11B744`) : la même méthode se retrouve par le pseudo-code (l'appel d'emplacement dans la méthode de session) et par la lecture directe de la table.
- Le type de session de chaque commande (principale ou contexte) : lu dans les deux tables ; les 41 méthodes du client et les 16 du contexte qui rendent `0xD960A3F4` sont celles dont le corps n'est que `return` d'une constante.
- Les trois services appelés : l'exheader (`ptm:s`, `soc:U`, `ssl:C`) et le code (les chaînes `soc:U` et `ssl:C` à `0x11B2B8` et `0x11B448`, passées à `SRV_GetServiceHandle`).
- Les 66 cas de l'aiguillage (comptés dans le pseudo-code et dans l'émulation).
- Les noms de méthode de requête : GET, POST, HEAD, PUT, DELETE sont dans la table de chaînes (`0x11B190` à `0x11B1B0`) et dans le pseudo-code de `request_write_head`, et la table de 3dbrew pour CreateContext est identique.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Les limites : 16 clients (`0xD8A0A067`), 8 contextes par client (`0xD8A0A01A`) : constantes lues dans le pseudo-code et la table de données, une seule voie.
- Les 29 appels système (relevés dans le pseudo-code de Ghidra, pas dans l'assembleur) et les 45 fonctions d'envoi.
- Les quatre fils de travail et la répartition 3 + 1 entre les deux files.
- Le sens des états de requête (1 à 10) et des deux files de travail.
- Les noms `context_core_…`, `request_…`, `socket_…`, `tls_…` : le rôle vient des appels (ce qu'ils envoient à `soc:U` et `ssl:C`) et des champs que les commandes lisent, pas d'une lecture complète.
- Les décalages de l'enregistrement de contexte (partie 5), sauf ceux de GetDownloadSizeState, GetResponseStatusCode, GetSslError et des commandes 0x37 et 0x3A, lus de bout en bout.
- Que la deuxième moitié de `AddPostDataAscii/Binary/Raw` (`0x1124E0`, `0x1125B8`, `0x11264C`) fait bien ce que son nom dit : le nom est donné par la correspondance avec la commande.
- La taille du tas selon la New 3DS (`0x30000` ou `0x50000`).
- La signification des limites de `server_start` (4, 8, `0x20`).
- Les nombres de fils et de connexions.

**Pas lu**
- Le corps des fils de requête au-delà de l'ordre des étapes : `request_connect`, `request_write_head` (lu en partie), `request_send_body`, `request_read_response` (1164 octets), la gestion de `Transfer-Encoding: chunked` et de `Connection: Keep-Alive`, la réutilisation des connexions.
- La résolution des noms (`getaddrinfo`) et les erreurs qu'elle donne ; où naissent `0xD8A0A046`, `0xD8A0A049` et le code de vérification de certificat `0xD8A0A03C` de 3dbrew.
- Le mandataire (`request_set_proxy`) et SetBasicAuthorization.
- Les commandes avec délai, GetResponseData, les magasins de CRL (0x3B à 0x42) et les chaînes de racines (0x2D à 0x31), les contextes de certificat client (0x32 à 0x34) : seuls leurs noms, leurs en-têtes et leur type de session sont établis, pas leur corps.
- La table des erreurs et le détail de chaque code de retour interne.
- 413 fonctions sans nom, dont une grande partie de C++ (listes, verrous, constructeurs, fonctions de chaînes, une pile de gestion de tampons).
- Ce que le jeu fait d'une erreur à chaque appel de la partie 10, et les URL et en-têtes qu'il envoie.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Fonctions, pseudo-code, références | `python outils/ghidra_direct.py http` | 30 secondes (puis une fois de plus avec les noms) |
| Table des commandes de l'aiguillage `0x114BA8` | `python outils/emulate_dispatch.py http 0x114ba8=http:C` | quelques secondes |
| Les deux étages sous la session : emplacement, méthode du client, méthode du contexte | `local/analyse/http/vt.py`, `vt3.py`, `stubs.py` (lecture de la mémoire du module et du pseudo-code) | immédiat |
| En-têtes des neuf commandes refusées par l'émulation | `local/analyse/http/refused.py` (constantes du pseudo-code) | immédiat |
| Envois à `srv:`, `soc:U`, `ssl:C`, `ptm:s`, `err:f` | `local/analyse/http/sends.py` | immédiat |
| Noms des commandes, des types et des codes d'erreur | 3dbrew, par `web.archive.org` (HTTP Services, SSL Services, Socket Services, HTTPC:CreateContext, HTTPC:Initialize…) | |
| Le côté du jeu | le pseudo-code de la mise à jour (`local/analyse/maj/gh/pseudo/`) | |

**Pour reprendre.** `http.noms.tsv` est le fichier de graines : une adresse, `function` (ARM) ou `label` (Thumb), un nom. Les noms en `httpc_<numéro>_<Commande>` sont les 66 méthodes de session ; `httpc_client_…` et `httpc_ctx_…` sont les méthodes des deux types d'objet, avec le suffixe `_unsupported` quand elles ne font que refuser ; ceux en majuscules (`SRV_`, `SOCU_`, `SSLC_`, `PTMS_`, `ERRF_`) sont les requêtes que `http` envoie à un autre service ; `svc…` sont les enveloppes d'appels système. `local/analyse/http/mknames.py` regénère le fichier de noms (sa liste manuelle est en tête), `gen_tables.py` les deux grands tableaux. Le pseudo-code brut et les scripts sont dans `local/analyse/http/`, non versionné.
