# ssl, le client TLS

`ssl` fait les connexions chiffrées (TLS) à la place des programmes : un jeu lui donne un socket déjà connecté, `ssl` y fait la poignée de main TLS, vérifie le certificat du serveur contre une liste de racines de confiance, puis lit et écrit les données déchiffrées. Il ne contient qu'un seul service, `ssl:C`, de 32 commandes. Le module embarque une bibliothèque du commerce, RSA BSAFE SSL-C (les chemins de compilation de la bibliothèque sont dans le binaire), avec ses certificats racines. Une session de service a trois états : vide, « principale » (elle gère les listes de certificats), ou « de contexte » (elle ne parle plus que d'une connexion).

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, le module est en Thumb), `outils/emulate_dispatch.py` sur l'aiguillage, la lecture des trois tables de méthodes dans `code.bin` (`local/analyse/ssl/vt3.py`, `vtscan.py`) et la page SSL_Services de 3dbrew relue par `web.archive.org`. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002F02`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `ssl`, priorité 58 (`0x3A`) |
| Fichier lu | `local/extrait/ssl/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x45CA8` octets de code (`0x46` pages), `0x6E50` de données en lecture seule (`0x7` pages), `0x9668` de données (`0xA` pages), `0x9E1C` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 2 638 pour Ghidra, dont 2 532 en Thumb et 106 en ARM (la bibliothèque BSAFE en fait l'essentiel), plus 32 entrées manquées, moins 4 qui ne sont pas des fonctions (`0x11D608` et `0x131030`, mots de réserve ; `0x134148`, étiquette interne ; `0x1293EC`, rang de division) et 3 fonctions mortes : 2 663 ; 149 nommées dans `ssl.noms.tsv` (plus 3 étiquettes de données, les trois tables de méthodes), 760 avec `local/analyse/ssl/noms-proposes.tsv` |
| Service offert | `ssl:C` seul |
| Services appelés | lus dans l'exheader : `soc:U`, `ps:ps`, `fs:USER` ; dans le code : les mêmes trois (chaînes `soc:U` à `0x147188`, `ps:ps` à `0x1460B6`, `fs:USER` à `0x1460D3`), plus `srv:` et le port `err:f` |
| Dépendances | `ssl` embarque le client de `soc:U` (initialisation à `0x100B28`, partie 1), comme `ndm` embarque `ac` : il fait lui-même les lectures et écritures sur le socket que le jeu lui a confié |

## Partie 1 : le démarrage et le serveur

`entry` (`0x100000`) appelle `clear_bss` (`0x100024`), `init_program_args` (`0x10009C`), `setup_heap` (`0x1000D4`), `init_runtime_and_srv` (`0x100100`), les constructeurs globaux (`run_init_array_relative`, `0x104338`, table relative `0x14CDF4`-`0x14CE50`), `run_init_array` (`0x100080`, table vide), puis `ssl_main` (`0x100048`, Thumb) qui construit le contexte du serveur (`ssl_server_ctor`, `0x1001AC`), le démarre (`ssl_server_start`, `0x10016C`) et le démonte (`ssl_server_stop`, `0x1001DC`). `ssl_server_start` appelle `ssl_server_init` (`0x100594`), crée le magasin des certificats intégrés (`ssl_create_default_cert_store`, `0x100610`), sert (`server_run`, `0x10041C`) puis le détruit (`ssl_destroy_default_cert_store`, `0x1005F0`). `ssl_server_init` ouvre `ps:ps` (`ps_ps_open`, `0x1008C8`, chaîne `0x1460B6`) et `fs:USER` (`fs_init`, `0x100704`, chaîne `0x1460D3`), initialise la bibliothèque socket (`ssl_init_socket_library`, `0x100B28` : `soc_start_session`, `0x1015E4`, la session principale, puis `soc_u_open`, `0x101590`, le réservoir de sessions de `soc:U`) et enregistre le service (`ssl_register_services`, `0x100A98`, qui appelle `SRV_RegisterService` par `0x100F54`).

Le service est déclaré par `sslc_service_descriptor_init` (`0x1148B4`) : il écrit la chaîne `ssl:C` (9 octets copiés) dans le descripteur, pose le descripteur dans l'objet du serveur (à `+0x5C20`) et fixe les tables du service. Le serveur est celui de la bibliothèque commune du système : un objet de plus de `0x5C00` octets, une boucle `server_receive_loop` (`0x1016CC`) qui attend les sessions par `ReplyAndReceive` (le seul appelant de son enveloppe, `0x141618`), `AcceptSession` pour une nouvelle session (enveloppe `0x1415B8` ; interprété) et des fils de travail créés par `create_thread_impl` (`0x101170`). (Corrigé le 17/10 : `0x101220` n'est pas le point de départ des fils mais `report_fatal_error` : aucune référence de donnée vers lui, un seul appel direct depuis `0x10037a`, et le même corps, instruction pour instruction, que `report_fatal_error` de cfg : `errf_connect`, `svcGetProcessId`, `ERRF_Throw`, `errf_close`, nouvel essai après une pause.)

Appels système trouvés dans le module (leurs enveloppes sont dans `0x12B144` à `0x12B29C` et `0x141384` à `0x141838`) : 0x01 ControlMemory, 0x02 QueryMemory, 0x03 ExitProcess, 0x08 CreateThread, 0x09 ExitThread, 0x0A SleepThread, 0x15 CreateSemaphore, 0x16 ReleaseSemaphore, 0x1E CreateMemoryBlock, 0x1F MapMemoryBlock, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest, 0x35 GetProcessId, 0x37 GetThreadId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive. Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : l'aiguillage et les trois tables de méthodes

**L'aiguillage.** `sslc_handle_command` (`0x111730`) est appelé par le thunk `sslc_session_handle_request` (`0x1131EC`), qui est la méthode `+8` de la table de la session. Il lit le tampon du fil (`+0x80`), prend le numéro dans les 16 bits du haut de l'en-tête et saute par une table d'octets à `0x111753` (36 entrées, 33 numéros valables, de 1 à 0x20). Chaque cas vérifie l'en-tête (en entier pour les commandes qui portent des descripteurs, sur le numéro pour les autres), appelle **un emplacement de la table de méthodes de la session** (`this->vtable[n]`), et fabrique la réponse. Un numéro inconnu ou un en-tête faux rend l'en-tête de réponse `0x00000040` et le résultat `0xD900182F` (inconnu) ou `0xD9001830` (en-tête faux).

**Qui décide de la file.** La méthode `+0xC` de la session, `sslc_session_queue_index` (`0x1144AA`), rend 0 pour les commandes 0x13, 0x14, 0x15, 0x17 et 0x1E (StartConnection, StartConnectionGetOut, Read, Write, DestroyContext) et -1 pour toutes les autres. Rendre 0 met la requête dans la file de travail : un fil de travail l'exécute pendant que le fil principal sert les autres sessions. Rendre -1 l'exécute tout de suite. Une lecture ou une écriture TLS qui bloque ne bloque donc pas les autres commandes ; ReadPeek (0x16) n'est pas dans la liste et s'exécute sur le fil principal.

**Les trois tables.** Chaque emplacement de la session ne fait presque que transmettre à l'objet que la session tient à `+0x10`. Cet objet n'est pas toujours le même :

| Table | Adresse | Entrées | Ce qu'elle gère |
| --- | --- | --- | --- |
| Session | `0x14A990` | 38 (`+0x18` à `+0x94`, les six premières sont le destructeur, l'aiguillage, la file) | un emplacement par commande, `sslc_NNNN_<Nom>` ; ils testent `this+0x10` (nul : résultat `0xD8A0B834`) puis appellent la méthode du même rang dans l'objet |
| Gestionnaire | `0x14A840` | 30 | l'objet « principal » (`sslmgr_*`) : listes de certificats racines, listes de révocation, certificats de client, création des contextes ; les emplacements de connexion (`+0x40` à `+0x74`) y rendent `0xD960BBF4` sans rien faire, sauf `+0x6C` (`sslmgr_DestroyContext`, `0x112688`, qui détruit le contexte du gestionnaire) |
| Contexte | `0x14A910` | 30 | l'objet « de contexte » (`sslctx_*`) : une connexion TLS ; les emplacements des listes (`+8` à `+0x3C`) y rendent `0xD960BBF4` |

`0xD960BBF4` est « commande faite avec le mauvais type de session » ; 3dbrew le dit aussi, avec ces mots. Le rang d'un emplacement n'est pas le numéro de commande : dans la session comme dans le gestionnaire, les trois commandes de certificat de client (0xD, 0xE, 0xF) viennent avant les listes de révocation (0x8 à 0xC) : session `+0x34` à `+0x3C` puis `+0x40` à `+0x50`, gestionnaire `+0x20` à `+0x28` puis `+0x2C` à `+0x3C` (table d'octets de l'aiguillage à `0x111752`). Les commandes 0x13 à 0x20 sont aux décalages `+0x40` à `+0x74` du gestionnaire et du contexte, et `+0x60` à `+0x94` de la session. Le tableau de la partie 3 donne les adresses réelles.

**Les états d'une session.** L'octet `this+0xC` : 0 au départ, 1 après Initialize (`this+0x10` est un gestionnaire), 2 après InitializeConnectionSession (`this+0x10` est un contexte).
- **Initialize** (`sslc_0001_Initialize`, `0x113038`) refuse si `this+0x10` est déjà pris (résultat `0xD8A0B834`). Sinon `sslc_manager_create` (`0x113050`) alloue un objet de `0x20` octets (`sslc_manager_ctor`, `0x112714`, vtable `0x14A840`) qui garde le numéro de processus de l'appelant à `+0xC` et quatre têtes de listes (`+0x10` les contextes, `+0x14` les listes de certificats racines, `+0x18` les certificats de client, `+0x1C` les listes de révocation ; lu dans les méthodes qui y ajoutent), met l'état à 1 et range la session dans la liste globale des sessions (`sslc_session_list_add`, `0x1141EC`).
- **InitializeConnectionSession** (`sslc_0012_InitializeConnectionSession`, `0x113100`) reçoit un numéro de processus et une poignée de contexte. `sslc_session_find_owner` (`0x11428C`) parcourt la liste globale des sessions et cherche une session d'état 1 dont le gestionnaire appartient au même processus (`sslc_session_match_owner`, `0x11314C`) et possède ce contexte (`sslc_manager_find_context`, `0x114480`) ; si elle en trouve une, la nouvelle session prend le contexte comme `this+0x10` et passe à l'état 2. Sinon : `0xD8A0B832`. Le contexte est donc rattaché à la session qui le sert, dans la limite du même processus : un autre processus ne peut pas utiliser le contexte.

## Partie 3 : les commandes de `ssl:C`

Les noms et les en-têtes de requête viennent de 3dbrew (et de la Carte, qui les a tirés de 3dbrew) ; l'aiguillage a été exécuté par `emulate_dispatch.py` pour les en-têtes de requête et de réponse (« Vérifié ») ; les adresses des fonctions viennent des trois tables. « Niveau » dit où la commande est valable : P pour la session principale (état 1), C pour la session de contexte (état 2), T pour les deux. Les réponses portent le résultat au mot 1.

| N° | En-tête de requête | Commande | Session | Niveau | Fonction de la table | Réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010002` | Initialize | `0x113038` | (aucune session) | crée le gestionnaire | `0x00010040` |
| 2 | `0x000200C2` | CreateContext | `0x113220` | P | `sslmgr_CreateContext` `0x1126B4` | `0x00020082` (poignée au mot 2) |
| 3 | `0x00030000` | CreateRootCertChain | `0x112EC0` | P | `sslmgr_CreateRootCertChain` `0x111F22` | `0x00030080` |
| 4 | `0x00040040` | DestroyRootCertChain | `0x112F24` | P | `sslmgr_DestroyRootCertChain` `0x1120CE` | `0x00040040` |
| 5 | `0x00050082` | AddTrustedRootCA | `0x112F4C` | P | `sslmgr_AddTrustedRootCA` `0x112140` | `0x00050082` |
| 6 | `0x00060080` | RootCertChainAddDefaultCert | `0x1130D0` | P | `sslmgr_RootCertChainAddDefaultCert` `0x1123B4` | `0x00060080` |
| 7 | `0x00070080` | RootCertChainRemoveCert | `0x112FF4` | P | `sslmgr_RootCertChainRemoveCert` `0x1122FC` | `0x00070040` |
| 8 | `0x00080000` | CreateCrlStore | `0x112EAC` | P | `sslmgr_CreateCrlStore` `0x111ECC` | `0x00080080` |
| 9 | `0x00090040` | DestroyCrlStore | `0x112ED4` | P | `sslmgr_DestroyCrlStore` `0x111F82` | `0x00090040` |
| 0xA | `0x000A0082` | AddCrlToCrlStore | `0x112EE8` | P | `sslmgr_AddCrlToCrlStore` `0x111FC0` | `0x000A0082` |
| 0xB | `0x000B0080` | AddInternalCrlToCrlStore | `0x113008` | P | `sslmgr_AddInternalCrlToCrlStore` `0x112334` | `0x000B0080` |
| 0xC | `0x000C0080` | RemoveCrlFromCrlStore | `0x112FE0` | P | `sslmgr_RemoveCrlFromCrlStore` `0x1121F0` | `0x000C0040` |
| 0xD | `0x000D0084` | OpenClientCertContext | `0x112F04` | P | `sslmgr_OpenClientCertContext` `0x112098` | `0x000D0084` |
| 0xE | `0x000E0040` | OpenDefaultClientCertContext | `0x113024` | P | `sslmgr_OpenDefaultClientCertContext` `0x112384` | `0x000E0080` |
| 0xF | `0x000F0040` | CloseClientCertContext | `0x112F38` | P | `sslmgr_CloseClientCertContext` `0x11210A` | `0x000F0040` |
| 0x10 | `0x00100000` | SeedRNG | `0x112F7C` | T | **`ps:ps` commande 0xC** | `0x00100040` |
| 0x11 | `0x00110042` | GenerateRandomData | `0x112F94` | T | **`ps:ps` commande 0xD** | `0x00110042` |
| 0x12 | `0x00120042` | InitializeConnectionSession | `0x113100` | (état 1 requis) | passe la session à l'état 2 | `0x00120040` |
| 0x13 | `0x00130040` | StartConnection | `0x112E30` | C | `sslctx_StartConnection` `0x112AC8` | `0x00130040` |
| 0x14 | `0x00140040` | StartConnectionGetOut | `0x113174` | C | `sslctx_StartConnectionGetOut` `0x112C94` | `0x001400C0` (deux mots) |
| 0x15 | `0x00150082` | Read | `0x1131AC` | C | `sslctx_Read` `0x112CE4` | `0x00150082` |
| 0x16 | `0x00160082` | ReadPeek | `0x113190` | C | `sslctx_ReadPeek` `0x112CB4` | `0x00160082` |
| 0x17 | `0x00170082` | Write | `0x1131CC` | C | `sslctx_Write` `0x112D44` | `0x00170082` |
| 0x18 | `0x00180080` | ContextSetRootCertChain | `0x112F68` | C | `sslctx_ContextSetRootCertChain` `0x112BDC` | `0x00180040` |
| 0x19 | `0x00190080` | ContextSetClientCert | `0x112E98` | C | `sslctx_ContextSetClientCert` `0x112B80` | `0x00190040` |
| 0x1A | `0x001A0080` | SetCrlStore | `0x112E44` | C | `sslctx_SetCrlStore` `0x112AE4` | `0x001A0040` |
| 0x1B | `0x001B0080` | ContextClearOpt | `0x1130EC` | C | `sslctx_ContextClearOpt` `0x112C78` | `0x001B0040` |
| 0x1C | `0x001C00C4` | ContextGetProtocolCipher | `0x112E70` | C | `sslctx_ContextGetProtocolCipher` `0x112B1C` | `0x001C00C4` |
| 0x1D | `0x001D0040` | GetCertVerificationErrors | `0x112FB0` | C | `sslctx_GetCertVerificationErrors` `0x112BF8` | `0x001D0080` |
| 0x1E | `0x001E0040` | DestroyContext | `0x11320C` | T | `sslmgr_DestroyContext` `0x112688` (P) ou `sslctx_DestroyContext` `0x112D74` (C) | `0x001E0040` |
| 0x1F | `0x001F0082` | ContextInitSharedmem | `0x112FC4` | C | `sslctx_ContextInitSharedmem` `0x112C14` | `0x001F0040` |
| 0x20 | `0x00200082` | AddEVPolicyID | `0x112E5C` | C | `sslctx_AddEVPolicyID` `0x112B00` | `0x00200042` |

Les 32 numéros de 1 à 0x20 existent ; 0 et 0x21 à 0x30 rendent « inconnu » à l'émulation. Les noms sont ceux de 3dbrew et de la Carte. Pour les 13 commandes dont le code compare l'en-tête en entier (1, 2, 5, 0xA, 0xD, 0x11, 0x12, 0x15, 0x16, 0x17, 0x1C, 0x1F, 0x20), l'émulation redonne exactement l'en-tête de 3dbrew ; pour les 19 autres, le code ne regarde que le numéro, et l'en-tête de requête n'est connu que par 3dbrew. Les en-têtes de réponse sont ceux que le code écrit (`0x12B1DC`, la fonction qui fabrique les en-têtes, avec le numéro, le nombre de mots ordinaires et de mots de traduction).

Les emplacements 0x0 (destructeur), 0x4 (destructeur et libération), 0x8 (traitement), 0xC (file), 0x10 et 0x14 de la session : `0x113268` (`sslc_session_dtor`), `0x113250` (`sslc_session_dtor_and_free`), `0x1131EC`, `0x1144AA`, `0x112E58`, `0x112E2C` ; les deux derniers sont des `bx lr` : `0x10` est appelé par le serveur quand il accepte la session (`server_main_loop`, `0x100D64`), `0x14` quand il la ferme (`server_close_session`, `0x12A65C`).

Le sens des paramètres, quand le code le montre (lu dans le pseudo-code de `0x111730`) :

- **Initialize** : un descripteur `0x20` au mot 1 (« numéro de processus », que le noyau remplit) et le numéro lui-même au mot 2. Le gestionnaire le garde.
- **CreateContext** : trois mots ordinaires, un tampon en lecture (`0xA`, le nom d'hôte, de moins de 256 octets : `sslc_lib_create_context`, `0x106430`, refuse le reste). Les deux premiers mots sont le socket du jeu et les options (SSLOpt de 3dbrew). Le contexte rendu est un numéro pris dans la bibliothèque, rangé ensuite dans la liste du gestionnaire (`sslc_manager_register_context`, `0x112220`, qui alloue un enregistrement de `0x3C` octets). C'est l'interprétation ; elle s'accorde avec la signature de `ctrulib`, que je n'ai pas relue ici.
- **InitializeConnectionSession** : un descripteur `0x20` au mot 2, le numéro de processus au mot 3, la poignée du contexte au mot 1. L'émulation affiche pour cette ligne (comme pour Initialize) le résultat `0xD9001830` : `ipc_is_pid_desc` (`0x110F80`) a été prise pour une fonction de travail qui rend 0, donc le chemin de succès n'est pas suivi ; le pseudo-code montre l'appel de l'emplacement et la réponse `0x00120040`.
- **Read, ReadPeek, Write** : un mot ordinaire (poignée du contexte), un mot (taille), un tampon (`0xC` en écriture pour Read et ReadPeek, `0xA` en lecture pour Write) ; la réponse porte le nombre d'octets au mot 2. `sslctx_Read` (`0x112CE4`) boucle sur la bibliothèque (`0x106568`) tant qu'il reste de la place, et s'arrête au premier appel qui ne rend rien ; ReadPeek (`0x1064D8`) lit sans consommer ; Write (`0x1068E4`).
- **ContextGetProtocolCipher** : `0x112B1C` copie dans les deux tampons de sortie (`0xC` chacun, mots 4 et 6) la chaîne du protocole et celle de la suite de chiffrement, tronquées à la taille donnée et terminées par un zéro (`0x126BCC`). La bibliothèque les fournit par `0x10632C`.
- **ContextInitSharedmem** : un descripteur de poignée au mot 3 (le bloc de mémoire partagée du client), la taille au mot 4 ; `0x112C14` appelle `0x110EB8` pour projeter le bloc (types 1 et 3) puis `0x106748` avec la base projetée et la taille.

**Les erreurs propres au module**, lues comme constantes dans les emplacements : `0xD8A0B834` (contexte absent ou numéro qui ne correspond pas à celui de la session ; session sans objet à `this+0x10`), `0xD960BBF4` (mauvais type de session), `0xD8A0B836` (liste de certificats racines introuvable, AddTrustedRootCA, RootCertChainAddDefaultCert, RootCertChainRemoveCert, comme 3dbrew), `0xD8A0B837` (liste de révocation introuvable, AddCrlToCrlStore, AddInternalCrlToCrlStore), `0xD8A0B832` (InitializeConnectionSession ne trouve aucune session principale du même processus), `0xD8E0B839` (pointeur de sortie nul, CreateContext). 3dbrew donne aussi `0xD8A0B801`, `0xD840B802`, `0xD840B803`, `0xD840B807`, `0xD8A0B805`, `0xD8A0B806` et `0xD8A0B814` (RootCA non fiable) : ils sortent de la bibliothèque, par `0x12B19A` qui convertit son code interne en code de la console. Je n'ai pas suivi cette conversion.

## Partie 4 : une opération pas à pas, SeedRNG et GenerateRandomData

Ces deux commandes sont les seules que Pokémon X envoie à coup sûr et les seules qui ne touchent à aucun objet de TLS : elles transmettent à `ps:ps`.

1. Le jeu envoie `0x00110042` : un mot (le nombre d'octets voulu), puis un descripteur de tampon en écriture (`size << 4 | 0xC`) et un pointeur.
2. `sslc_handle_command` vérifie l'en-tête en entier (`0x12B1DC` recompose `0x00110042`) et que le descripteur est bien un tampon en écriture (`0x125E10`), puis appelle `this->vtable[0x58]` avec le pointeur et la taille.
3. `sslc_0011_GenerateRandomData` (`0x112F94`) refuse si `this+0x10` est nul (`0xD8A0B834`) : il faut un Initialize avant. Sinon il appelle `0x111118`.
4. `0x111118` écrit dans le tampon de message du fil (`+0x80`) l'en-tête `0x000D0042` (commande 0xD de `ps:ps`, 1 mot ordinaire, 2 de traduction), la taille au mot 1, le descripteur et le pointeur du tampon (`0x125E7C` pose le descripteur de tampon en écriture), puis `SendSyncRequest` (`0x12B1D4`, svc 0x32) sur la poignée de `ps:ps` (une variable globale, `*DAT_00111158`).
5. `ps:ps` remplit le tampon. `0x111118` rend le résultat du mot 1 de la réponse si la requête a réussi. Le gestionnaire renvoie au jeu `0x00110042` avec ce résultat.

`SeedRNG` (`0x112F7C` → `0x111064`) fait de même avec `0x000C0000`, sans paramètre ; 3dbrew donne `ps:ps` 0xC comme `SeedRNG`, 0xD comme `GenerateRandomBytes` avec les en-têtes `0x000C0000` et `0x000D0042` : ce sont exactement ceux qu'écrivent `0x111064` et `0x111118`. **Preuve par deux voies** : le code de `ssl`, la page `Process_Services` de la Carte.

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x111753` | table d'octets de l'aiguillage : 36 octets, numéro de commande vers numéro de cas (le cas vaut `octet * 2`) |
| `0x14A840` | table de méthodes du gestionnaire (30 entrées) |
| `0x14A910` | table de méthodes du contexte (30 entrées) |
| `0x14A990` | table de méthodes de la session (38 entrées) |
| `0x14AA80` | chaîne `err:f` |
| `0x146060`, `0x146069`, `0x146088` | chaînes `ClCertA:`, `ClCertA:/ctr-common-1-cert.bin`, `ClCertA:/ctr-common-1-key.bin` : le certificat client par défaut est lu dans une archive de la NAND (`load_default_client_cert`, `0x1135F0`, qui monte l'archive par `fs:USER`, lit les deux fichiers, déchiffre la clé par AES avec `ps:ps` ou le moteur de la bibliothèque : le déchiffrement n'est pas suivi) |
| `0x146368`, `0x146F20`, `0x147038` | listes de suites de chiffrement, `EDH-RSA-AES256-SHA:AES256-SHA:EDH-RSA-AES128-SHA:AES128-SHA:EDH-RSA-DES-CBC3-SHA` et ses variantes DSS |
| `0x10D624` | `TLSv11/TLSv1/SSLv3` : les protocoles que la bibliothèque connaît ; 3dbrew dit que le plus récent utilisable est TLS 1.1 |
| `0x150000` et suite | les certificats racines intégrés (le module nomme des autorités du commerce : COMODO, USERTrust, DigiCert...) ; c'est ce que RootCertChainAddDefaultCert pioche |

## Partie 6 : ce que Pokémon X envoie

Le jeu envoie **trois** commandes de `ssl:C` : `0x00010002` (Initialize), `0x00100000` (SeedRNG), `0x00110042` (GenerateRandomData). Elles sont dans le code du jeu comme une copie de la bibliothèque cliente du système (la colonne « preuve » de `pokemon-x-services.tsv` dit « copie » pour les trois). Initialize n'est atteint que par un `.cro` ; les deux autres le sont depuis le point d'entrée.

| Commande du jeu | En-tête | Fonction du jeu | Fonction du module | Ce que le remplaçant doit rendre |
| --- | --- | --- | --- | --- |
| Initialize | `0x00010002` | `0x2B0064` | `sslc_0001_Initialize` (`0x113038`) | succès (0). Le jeu n'utilise pas les poignées, Initialize n'a pas à créer d'objet. Réponse `0x00010040` |
| SeedRNG | `0x00100000` | `0x2AFFFC` | `sslc_0010_SeedRNG` (`0x112F7C`) | succès (0). La commande peut ne rien faire : le remplaçant n'a pas à graîner un générateur système. Réponse `0x00100040` |
| GenerateRandomData | `0x00110042` | `0x2B0024` | `sslc_0011_GenerateRandomData` (`0x112F94`) | remplir le tampon avec `size` octets ; réponse `0x00110042` avec le résultat 0. **Doit être vrai** dans le sens où il faut des octets réellement variables d'un appel à l'autre : un générateur de l'ordinateur (CSPRNG du système) suffit. Des zéros ou une suite constante feraient répéter tout ce que le jeu en tire (graine, jetons). Ce que le jeu en fait n'est pas lu |

Pour le portage PC : **tout le reste de `ssl` peut rester factice**. Le jeu n'envoie ni CreateContext, ni StartConnection, ni Read/Write : il ne fait pas de TLS lui-même par `ssl:C` dans ce qui a été lu (d'après 3dbrew, le module `http` est le client habituel de `ssl` ; si un jour on veut l'en ligne, c'est `http`, pas le jeu, qui demanderait les commandes 2 à 0x20). Une implémentation minimale de `ssl:C` répond à Initialize, SeedRNG, GenerateRandomData et rend l'erreur « commande inconnue » `0xD900182F` pour le reste. Si on veut un jour de vrais échanges TLS, la correspondance est directe : un contexte = une connexion TLS de l'ordinateur sur le socket donné, la liste de certificats racines = le magasin de certificats de l'ordinateur, Read/Write/ReadPeek/StartConnection avec les mêmes codes `EWOULDBLOCK` (`0xD840B802`, `0xD840B803`, `0xD840B807`) que 3dbrew nomme.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes : code du module et émulation ou 3dbrew) :
- Les 32 commandes (1 à 0x20) et leurs en-têtes de réponse : l'aiguillage exécuté (`emulate_dispatch.py ssl 0x111730=ssl:C`) et le pseudo-code de `0x111730` s'accordent ; les en-têtes de requête sont ceux de 3dbrew pour les 13 commandes qui les vérifient en entier. Le lien entre un numéro et sa méthode vient de la table d'octets et du pseudo-code seuls ; l'émulation, qui ne fait pas tourner les emplacements, ne le montre pas.
- L'existence de trois tables de méthodes et l'état de session à deux niveaux, d'abord relevés dans le code (octet `this+0xC`, résultats `0xD960BBF4` et `0xD8A0B834`), ensuite confirmés mot à mot par 3dbrew (« Internally there's a separate object vtable used with the above SSLC commands, for the main session ... and context sessions ... Error 0xD960BBF4 will be returned if a command was used with the wrong session type »).
- SeedRNG et GenerateRandomData transmettent à `ps:ps` (commandes 0xC et 0xD, en-têtes `0x000C0000` et `0x000D0042`), confirmés par la page `Process_Services` de la Carte.
- Les commandes qui passent par la file de travail (0x13, 0x14, 0x15, 0x17, 0x1E) : lu dans `0x1144AA`.

**Interprété** :
- Les paramètres de CreateContext (socket, options, nom d'hôte), de ContextInitSharedmem et le rôle exact des enregistrements de `0x3C` octets.
- Que `ssl` utilise `soc:U` pour les lectures et écritures du socket du jeu : l'exheader l'autorise, l'initialisation du client est dans le code, mais je n'ai pas suivi un seul envoi de la bibliothèque jusqu'à `soc:U`.
- Le serveur : la structure de boucle (ReplyAndReceive, AcceptSession, fils de travail) est celle des autres modules du système ; je ne l'ai pas relue fonction par fonction comme celle de `ndm`.
- Les noms `sslmgr_*` et `sslctx_*` : donnés d'après la position dans la table et le nom 3dbrew de la commande qui y mène.

**Pas lu** :
- La bibliothèque RSA BSAFE SSL-C elle-même (la plus grande partie des 2 638 fonctions) : poignée de main, vérification des chaînes de certificats, X.509, CRL.
- Le déchiffrement de la clé du certificat client par défaut, et la liste complète des certificats racines intégrés.
- La conversion de l'erreur de la bibliothèque en code de la console (`0x12B19A`).
- La méthode `+0x4` du gestionnaire est `sslmgr_dtor_and_free` ; les emplacements `+0x10` et `+0x14` de la session sont lus (ligne 88).
