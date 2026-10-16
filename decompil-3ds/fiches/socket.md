# socket, la pile réseau de la console

`socket` est le module qui contient toute la pile TCP/IP de la 3DS : les sockets de type BSD, le protocole TCP, UDP, ICMP, l'ARP, un résolveur DNS, le tout écrit dans le module lui-même. Il parle au Wi-Fi par `nwm::SOC` (il échange des trames avec le micrologiciel de la puce) et offre deux services : `soc:U` (les sockets, ceux des jeux) et `soc:P` (le service privilégié, réservé au module `ac`, qui monte la connexion et la configuration de l'adresse). Un jeu ne voit que `soc:U` : il lui donne un bloc de mémoire (le « tampon » de la pile), puis ouvre des sockets avec des commandes qui portent les noms de l'API BSD (`socket`, `bind`, `connect`, `sendto`, `recvfrom`, `poll`...).

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`), `emulate_dispatch.py` et un désassemblage de capstone. Les adresses sont celles du module chargé à `0x00100000`. Presque tout le module est en ARM (807 fonctions sur 829) : seuls 22 morceaux de Thumb, tous dans le démarrage.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002E02`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `socket`, priorité 59 (`0x3B`, dernier octet des attributs du noyau) |
| Fichier lu | `local/extrait/socket/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x31088` octets de code (50 pages), `0x4C8` de données en lecture seule, `0x3A0` de données, `0x9A30` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 829 pour Ghidra, dont 22 en Thumb et 807 en ARM ; 126 nommées dans `socket.noms.tsv` |
| Services offerts | `soc:U` (35 commandes, 18 sessions au plus) et `soc:P` (9 commandes, 3 sessions au plus) |
| Services appelés | lus dans l'exheader : `nwm::SOC` et `ptm:s` ; lus dans le code : les mêmes, plus `srv:` et `err:f` (les deux ports) |
| Dépendances | le Wi-Fi : le module `nwm` (`…2D02`) ; la liste des titres système de 3dbrew |
| Fils | un fil principal, plus un fil par session ouverte : jusqu'à 18 pour `soc:U` et 3 pour `soc:P` |

Les chaînes `soc:U` (`0x132000`), `soc:P` (`0x132006`), `nwm::SOC` (`0x13208c`), `srv:pm` (`0x1320c1`) et `err:f` (`0x1322f9`) sont dans la zone de données en lecture seule (`0x132000`). Le module n'ouvre pas `srv:pm` : la chaîne est celle de la liste des services du module, pas lue plus loin.

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle sept fonctions à la suite, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de zéros du module.
2. `init_program_args` (`0x1007fc`) : remplit deux champs de l'en-tête des arguments (interprété, même rôle que dans `ndm`).
3. `0x11cc6c` : un petit appel (`0x1013c8`, pas lu) avant l'initialisation d'un verrou.
4. `setup_heap` (`0x100a8c`) : `set_heap_size` (`0x100890`) demande `0x41000` octets de tas par `svcControlMemory` (opération 3, lecture et écriture, à partir de `0x08000000`), puis monte l'allocateur du module.
5. `run_init_array_relative` (`0x100234`, Thumb) : la table de distances relatives des constructeurs globaux ; puis `run_init_array` (`0x1007c8`) : la table de pointeurs.
6. `srv_init` (`0x100850`) : prépare un verrou puis se déclare à `sm` par `srv_connect_and_register` (`0x11cc7c`, qui envoie `SRV_RegisterClient`) ; une erreur est signalée à `0x11cda0`.
7. `server_main` (`0x100398`), qui ne revient qu'à l'arrêt.

`server_main` fait ceci, dans l'ordre (lu dans le pseudo-code) :

1. Il bâtit sur sa pile les deux objets serveur. Le premier est celui de `soc:U` : 18 objets de session de `0x2730` octets, fabriqués par l'allocateur et rangés dans une liste de sessions libres. Le second est celui de `soc:P` : 3 objets de `0xAF0` octets. La table de méthodes du premier est à `0x132290` (sa méthode 0 est `socu_session_accept`, `0x130164`), celle du second à `0x132284` (méthode 0 : `socp_session_accept`, `0x12fde8`). Vu dans les données : `0x132290` contient `0x00130164` et `0x132284` contient `0x0012FDE8`.
2. Il enregistre les deux services auprès de `sm` par `SRV_RegisterService` (`0x100a30`, en-tête `0x00030100`) : le nom `soc:U` avec 18 sessions au plus (le dernier argument de l'appel, `0x12`) et le nom `soc:P` avec 3.
3. Il ouvre `nwm::SOC` (`nwm_soc_open`, `0x1031cc` : deux sessions, poignées gardées à `0x1330c4` et `0x1330c8`) et demande à `nwm` la mémoire partagée de trames (`nwm_soc_get_shared_memory`, `0x103258`, qui envoie la commande `0x00090000` de `nwm::SOC`).
4. Il lance la boucle : `server_loop` (`0x100b9c`).
5. À la sortie, `socp_server_destroy` (`0x100e08`) et `socu_server_destroy` (`0x100fd0`) ferment les sessions qui restent, retirent les services (`SRV_UnregisterService`, `0x1016e8`), puis `svcExitProcess`.

## Partie 2 : les serveurs

La boucle de serveur est celle de la bibliothèque du système, avec un fil par session.

**Le fil principal.** `server_loop` (`0x100b9c`) attend par `WaitSynchronizationN` (`0x11cad8`, aide qui rend l'indice de la poignée réveillée) sur : le port d'écoute de chaque serveur, puis deux poignées supplémentaires. Selon l'indice, il appelle la méthode 0 du serveur (`socu_session_accept` ou `socp_session_accept`), ou, pour la poignée de rang N (le sémaphore des notifications de `srv:`), `receive_srv_notification_and_dispatch` (`0x1015f0`, qui envoie `SRV_ReceiveNotification`), ou, pour celle de rang N + 1, un gestionnaire d'événement (`0x1018fc`, qui envoie `PTMS_NotifySleepPreparationComplete` à `ptm:s` et une commande `0x000D0002` à `nwm::SOC` : interprété, c'est le chemin de la mise en veille). Au départ il s'abonne à trois notifications de `srv:` (`subscribe_srv_notifications`, `0x101830`, trois `SRV_Subscribe`, `0x11c3f4`). Les numéros abonnés ne sont pas lus.

**L'acceptation.** `socu_session_accept` (`0x130164`) prend un objet de session libre dans la liste, accepte la session (`accept_session_on_port`, `0x12be74`, qui attend le port puis appelle `svcAcceptSession`, `0x122b34`) et crée un fil de session avec `0x11c730` dont le point d'entrée est `socu_session_thread` (`0x130408`). Pour `soc:P` c'est `socp_session_accept` (`0x12fde8`) et `socp_session_thread` (`0x13006c`). Le fil est donc attaché à une seule session pour toute sa vie, ce qui permet à une commande de bloquer (un `recvfrom` sans donnée, un `poll` avec attente) sans gêner les autres sessions.

**Le fil de session.** `socu_session_thread` appelle `socu_reply_and_receive_loop` (`0x12c88c`) : elle écrit `0xFFFF0000` (« pas de réponse à envoyer ») comme premier mot du tampon, puis boucle sur `svcReplyAndReceive` (`0x122b7c`, la seule fonction du module qui l'appelle, avec l'autre boucle). Un tour : si la poignée réveillée est la session, c'est une requête, traitée par `socu_handle_command` (`0x12cafc`) qui écrit la réponse dans le tampon, et le tour suivant envoie cette réponse en même temps qu'il attend la requête suivante. Si le résultat vaut `0xC920181A` (session fermée), le fil sort : il détruit le contexte de session (`socu_session_context_destroy`, `0x12f388`, qui désenregistre le processus s'il avait été enregistré, partie 5), ferme la poignée et rend l'objet à la liste libre. Toute autre poignée donne le résultat `0xD9001831` et la sortie.

Le contexte d'une session de `soc:U` (le « paramètre 1 » de `socu_handle_command`, à `+0x6D0` de l'objet de session) garde : un tampon de réception de `0x2000` octets (`[0]`), un tampon d'adresse de `0x1C` (`[1]`), le pointeur de la table des clients (`[3]`, partie 5), le résolveur (`[4]` et suivants) et, à `+0x2038` et `+0x203C`, le numéro du processus qui a fait InitializeSockets sur cette session et le drapeau « initialisée ».

**L'aiguillage.** `socu_handle_command` (`0x12cafc`) lit l'en-tête dans le tampon du fil (`+0x80`), prend le numéro dans les 16 bits du haut et saute par un `switch` sur 35 numéros. Une commande vérifie en général l'en-tête en entier (parce qu'il porte le nombre de mots ordinaires et de mots de traduction) et le descripteur `0x20` qui demande au noyau d'écrire le numéro du processus appelant ; certaines vérifient aussi les descripteurs de tampon statique. Un en-tête qui ne va pas rend l'en-tête de réponse `0x00000040` et le résultat `0xD9001830` ; un numéro inconnu rend `0x00000040` et `0xD900182F`. Les commandes ne sont pas toutes en un morceau : l'aiguillage fait lui-même la plupart des écritures de la réponse, et appelle une fonction de travail qui rend la valeur à écrire (le « retour BSD »).

## Partie 3 : les commandes de `soc:U`

Les noms et les en-têtes de requête viennent de 3dbrew ; la fonction, l'adresse, l'en-tête de réponse et ce que le code vérifie sont lus dans le code. La colonne « Vérifié » dit si l'aiguillage compare tout l'en-tête (« entier ») ou seulement le numéro (« numéro »). L'étoile signale une ligne que l'émulation n'a pas pu suivre (elle refuse la requête malgré les descripteurs qu'elle sait poser) et qui est donc établie par le pseudo-code et l'assembleur seuls. L'en-tête de réponse est celui que l'aiguillage écrit (mot 1 : le résultat de la commande ; mot 2 : le retour BSD, négatif en cas d'erreur de la pile).

| N° | En-tête de requête | Commande | Fonction | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (0x01) | `0x00010044` | InitializeSockets | `socu_0001_InitializeSockets` | `0x12f264` | entier | `0x00010040` |
| 2 (0x02) | `0x000200C2` | socket | `socu_0002_socket` | `0x12e29c` | entier | `0x00020080` |
| 3 (0x03) | `0x00030082` | listen | `socu_0003_listen` | `0x126a74` | entier | `0x00030080` |
| 4 (0x04) | `0x00040082` | accept | `socu_0004_accept` | `0x124178` | entier | `0x00040082` |
| 5 (0x05) | `0x00050084` | bind | `socu_0005_bind` | `0x12488c` | entier | `0x00050080` |
| 6 (0x06) | `0x00060084` | connect | `socu_0006_connect` | `0x1249c8` | entier | `0x00060080` |
| 7 (0x07) | `0x00070104` | recvfrom_other | `socu_0007_0008_recvfrom` | `0x1270b4` | entier | `0x00070084` |
| 8 (0x08) | `0x00080102` | recvfrom | `socu_0007_0008_recvfrom` | `0x1270b4` | entier | `0x000800C4` |
| 9 (0x09) | `0x00090106` | sendto_other | `socu_0009_000A_sendto` | `0x112c64` | entier | `0x00090082` |
| 10 (0x0A) | `0x000A0106` | sendto | `socu_0009_000A_sendto` | `0x112c64` | entier | `0x000A0080` |
| 11 (0x0B) | `0x000B0042` | close | `socu_000B_close` | `0x1249a8` | entier | `0x000B0080` |
| 12 (0x0C) | `0x000C0082` | shutdown | `socu_000C_shutdown` | `0x1278a4` | entier | `0x000C0080` |
| 13 (0x0D) | `0x000D0082` | gethostbyname | `socu_000D_gethostbyname` | `0x12c608` | entier* | `0x000D0082` |
| 14 (0x0E) | `0x000E00C2` | gethostbyaddr | `socu_000E_gethostbyaddr` | `0x12c560` | entier* | `0x000E0082` |
| 15 (0x0F) | `0x000F0106` | getaddrinfo | `socu_000F_getaddrinfo` | `0x12c3b0` | entier* | `0x000F00C2` |
| 16 (0x10) | `0x00100102` | getnameinfo | `socu_0010_getnameinfo` | `0x12c50c` | entier* | `0x00100084` |
| 17 (0x11) | `0x00110102` | getsockopt | `socu_0011_getsockopt` | `0x125c2c` | entier | `0x001100C2` |
| 18 (0x12) | `0x00120104` | setsockopt | `socu_0012_setsockopt` | `0x127598` | entier* | `0x00120080` |
| 19 (0x13) | `0x001300C2` | fcntl | `socu_0013_fcntl` | `0x124da0` | entier | `0x00130080` |
| 20 (0x14) | `0x00140084` | poll | `socu_0014_poll` | `0x126d68` | entier* | `0x00140082` |
| 21 (0x15) | `0x00150042` | sockatmark | `socu_0015_sockatmark` | `0x127998` | entier | `0x00150080` |
| 22 (0x16) | `0x00160000` | gethostid | `socu_0016_gethostid` | `0x12592c` | numéro | `0x00160080` |
| 23 (0x17) | `0x00170082` | getsockname | `socu_0017_getsockname` | `0x125b04` | entier | `0x00170082` |
| 24 (0x18) | `0x00180082` | getpeername | `socu_0018_getpeername` | `0x1259b8` | entier | `0x00180082` |
| 25 (0x19) | `0x00190000` | ShutdownSockets | `socu_0019_ShutdownSockets` | `0x12f2d0` | numéro | `0x00190040` |
| 26 (0x1A) | `0x001A00C0` | GetNetworkOpt | `socu_001A_GetNetworkOpt` | `0x125940` | numéro | `0x001A00C2` |
| 27 (0x1B) | `0x001B0040` | ICMPSocket | `socu_001B_ICMPSocket` | `0x1266cc` | numéro | `0x001B0080` |
| 28 (0x1C) | `0x001C0104` | ICMPPing | `socu_001C_ICMPPing` | `0x126118` | entier* | `0x001C0082` |
| 29 (0x1D) | `0x001D0040` | ICMPCancel | `socu_001D_ICMPCancel` | `0x125ec4` | numéro | `0x001D0080` |
| 30 (0x1E) | `0x001E0040` | ICMPClose | `socu_001E_ICMPClose` | `0x125fd0` | numéro | `0x001E0080` |
| 31 (0x1F) | `0x001F0040` | GetResolverInfo | `socu_001F_GetResolverInfo` | `0x11aa68` | numéro | `0x001F0082` |
| 32 (0x20) | `0x00200146` | SendToMultiple | dans l'aiguillage (boucle sur `socu_0009_000A_sendto`) | `0x12cafc` | entier* | `0x00200080` |
| 33 (0x21) | `0x00210002` | CloseSockets | `socu_0021_CloseSockets` | `0x12f258` | entier | `0x00210040` |
| 34 (0x22) | `0x00220040` | sans nom ; « SetSocketLimit » ici | `socu_0022_SetSocketLimit` | `0x12f304` | numéro | `0x00220040` |
| 35 (0x23) | `0x00230040` | AddGlobalSocket | `socu_0023_AddGlobalSocket` | `0x12f31c` | numéro | `0x00230040` |

Remarques sur la table :

- Les commandes 3 à 12, 18, 19, 21 et 35 (et chaque tour de la boucle de 32) passent leur socket par un contrôle commun, `client_check_socket_owner` (`0x113010`, partie 5) avant la fonction de travail ; si le contrôle échoue, l'aiguillage rend son résultat d'erreur sans la lancer. Les autres commandes qui prennent un descripteur (17, 20, 23, 24) le contrôlent dans leur fonction de travail (par la pile : `-8`, `-0x27`) et non par ce contrôle de propriétaire.
- `recvfrom_other` / `recvfrom` (7, 8) partagent `socu_0007_0008_recvfrom` ; `sendto_other` / `sendto` (9, 10) partagent `socu_0009_000A_sendto`. Les deux paires diffèrent par la façon de passer les données (partie 4). `SendToMultiple` (32) appelle `socu_0009_000A_sendto` en boucle, une fois par adresse (le nombre d'adresses est la taille du tampon d'adresses divisée par la taille d'une adresse, et la division doit tomber juste).
- Les commandes 26 (`GetNetworkOpt`), 27, 29, 30, 31, 34 et 35, et 22 et 25, ne comparent que le numéro : leur en-tête de requête vient de 3dbrew et le nombre de mots que le code lit colle à l'en-tête (un mot pour 27, 29, 30, 31, 34 et 35 : `0x…0040` ; trois mots pour 26 : `0x…00C0` ; aucun pour 22 et 25).
- La commande 22 (gethostid) ne regarde pas non plus le numéro de processus : elle rend l'adresse IPv4 de la console (quatre octets copiés à `+0xBB1` du contexte de la pile par `stack_copy_ip_address`, `0x1182b0`) ou 0 s'il n'y en a pas.

Ce que fait chaque commande, lu dans le code. Le « retour BSD » est le mot 2 de la réponse ; les valeurs négatives sont des codes d'erreur de la pile, du genre errno : `-0x27` (-39) quand la pile n'est pas démarrée, `-8` descripteur inconnu, `-5` famille d'adresses refusée, `-0x1c` argument invalide, `-0x31` plus de mémoire, `-0x21` plus de sockets, `-0x44` protocole refusé.

| N° | Ce que le code fait |
| --- | --- |
| 1 | Voir la partie 5 |
| 2 | Voir la partie 6 |
| 3 | Après le contrôle du propriétaire, appelle `0x126a74(fd, backlog)` |
| 4 | Contrôle du propriétaire ; `0x124178(fd, tampon d'adresse)` rend le nouveau descripteur et remplit l'adresse ; la taille d'adresse acceptée est limitée à `0x1C` ; la réponse rend le descripteur (mot 2) et l'adresse par un tampon statique |
| 5, 6 | Contrôle du propriétaire ; l'adresse est dans le tampon statique 0 ; `bind` (`0x12488c`) et `connect` (`0x1249c8`) |
| 7, 8 | Voir la partie 6 |
| 9, 10 | Voir la partie 6 |
| 11 | `close` : `0x1249a8(fd)` ne fait rien si la pile n'est pas démarrée ; sinon elle ferme le descripteur (`0x106dfc`) |
| 12 | `shutdown(fd, how)` : `how` 0, 1 ou 2, sinon `-0x1C` ; vaut pour un socket TCP ou UDP, sinon `-8` |
| 13 | Le nom (jusqu'à 255 caractères, tampon statique 3) est copié, mis à zéro final, résolu par `0x125774`, et la réponse est une structure de `0x1A88` octets, partie 6 |
| 17 | `getsockopt` : rend les options selon le niveau ; pas lue en détail |
| 18 | `setsockopt(fd, niveau, option, valeur, longueur)` : valeur dans le tampon statique 9. Au niveau `0xFFFF` (SOL_SOCKET) : les options `0x1001` et `0x1002` (taille de tampon d'envoi et de réception, au moins `0x218`) sont traitées ici ; les autres options vont à la couche TCP (`0x1287b4`) ou UDP (`0x128ea8`) |
| 19 | `fcntl(fd, commande, valeur)` : la commande 3 rend un octet gardé à `+9` de l'enregistrement du socket, la commande 4 le range tel quel (sans contrôle) ; toute autre commande rend `-0x1C` ; vaut pour TCP et UDP |
| 20 | `poll` : partie 6 |
| 21 | `sockatmark(fd)` : `0x127998` |
| 22 | Voir plus haut |
| 23, 24 | `getsockname` et `getpeername` : l'adresse est rendue dans un tampon statique ; la taille demandée est limitée à `0x1C` ; refus (`-0x1C`) si le premier octet de l'adresse (sa taille totale) est inférieur à 8 pour la famille 2 ou à `0x1C` pour la famille `0x17` |
| 25 | Voir la partie 5 |
| 26 | `GetNetworkOpt(niveau, option, longueur)` : le niveau doit valoir `0xFFFE`, sinon refus ; rend un bloc dans un tampon statique, jusqu'à `0x2000` octets. Les options relevées dans `stack_get_config_option` (`0x12a050`) : `0x1001`, `0x1002`, `0x1003` (4 octets chacune), `0x1004` (6 octets, l'adresse MAC), `0x1005` (4 octets, un booléen), `0x1006` (`0x38` octets), `0x1007`, `0x3002` (la table ARP, `0x10` octets par entrée), `0x8001`, et d'autres jusqu'à `0x4006` ; pas toutes lues |
| 27 à 30 | Les quatre commandes ICMP (`ICMPSocket`, `ICMPPing` avec un délai converti en ticks, `ICMPCancel`, `ICMPClose`) travaillent sur un numéro de socket ICMP propre ; pas lues au-delà |
| 31 | `GetResolverInfo` : copie `0x150` octets de l'état du résolveur (à `+0x30` du contexte de la pile) dans un tampon statique, après contrôle ; refus `-0x1C` si le contexte est nul |
| 33 | `CloseSockets(pid)` : ferme tous les sockets du processus (la table des clients, partie 5), `0xD8E07006` s'il n'est pas enregistré |
| 34 | Le mot 1 est rangé à `+0x18` de l'enregistrement du client (partie 5). C'est la limite du nombre de sockets de ce processus : `socket` refuse (`0xD860700C`) dès que le nombre ouvert (`+0x14`) l'atteint, et InitializeSockets la fixe à 16 (`0x10`) |
| 35 | `AddGlobalSocket(fd)` : contrôle du propriétaire, puis met à zéro l'octet `+0x10` de l'enregistrement du socket. Cet octet dit « réservé à son propriétaire » ; `socket_owner_matches` (`0x12f3fc`) laisse passer tout processus quand il est nul, donc le socket devient utilisable par n'importe quel processus |

## Partie 4 : les tampons statiques et la mémoire

Les adresses et les données longues ne passent pas dans les mots ordinaires : elles passent dans des « tampons statiques » (descripteur `taille << 14 | numéro << 10 | 2`), ou dans des tampons mappés (type `0xA` en lecture, `0xC` en écriture). Table relevée dans les masques de l'aiguillage (`descripteur & 0x3C0F`) et dans les envois du jeu :

| Numéro | Utilisé par | Contenu |
| --- | --- | --- |
| 0 | bind, connect (en entrée) ; recvfrom, GetNetworkOpt, GetResolverInfo, poll, getsockname, accept (en sortie) | l'adresse du socket, ou le bloc rendu |
| 1 | sendto, sendto_other (en entrée) ; recvfrom (en sortie) | l'adresse |
| 2 | sendto | les données |
| 3 | gethostbyname | le nom |
| 4 | gethostbyaddr | l'adresse |
| 5, 6, 7 | getaddrinfo | le nœud, le service, les indications |
| 8 | getnameinfo | l'adresse |
| 9 | setsockopt | la valeur de l'option |
| 10 | poll | le tableau des `pollfd` en entrée |
| 11 | ICMPPing | les données |
| 12, 13 | SendToMultiple | les données, le tableau des adresses |

Les numéros 3, 4, 11, 12 et 13 ne sont pas dans la liste de 3dbrew (qui s'arrête à 10 avec des trous). Une adresse est un tampon dont le premier octet est la taille totale et le second la famille : `2` pour IPv4 (taille 8), `0x17` pour IPv6 (taille `0x1C`) ; la taille maximale qu'accepte le module est `0x1C`. Un tampon de réception est posé par l'appelant dans son propre tampon de fil, à `+0x180` (numéro 0) et `+0x188` (numéro 1), et le module répond par un descripteur de même forme.

## Partie 5 : InitializeSockets et la table des clients, pas à pas

C'est la commande 1. La requête est `0x00010044` : un mot ordinaire (la taille du bloc de mémoire), puis quatre mots de traduction : le descripteur `0x20` suivi du numéro du processus (écrit par le noyau), le descripteur `0x0` suivi de la poignée du bloc de mémoire (copiée).

1. **L'aiguillage.** Il vérifie l'en-tête entier, le descripteur `0x20` au mot 2 et le descripteur `0x0` au mot 4, puis appelle `socu_0001_InitializeSockets` (`0x12f264`) avec le contexte de session, le numéro de processus (mot 3), la poignée (mot 5) et la taille (mot 1).
2. **Une seule fois par session.** Si le contexte de la session a déjà un processus (`+0x2038` non nul), la poignée reçue est fermée et le résultat est `0xC8A07004`.
3. **L'enregistrement.** `client_register` (`0x12e5c4`) prend le verrou de la table des clients (une table de 16 listes, indexée par le numéro de processus modulo 16, dont le nombre d'entrées est à `+0x4C`). Si le processus est déjà dans la table : `0xC8A0700B` (« numéro déjà utilisé »). Si la table compte 32 clients ou plus : `0xD860700A` (« table pleine »). Ces deux codes sont les deux erreurs que 3dbrew donne pour InitializeSockets. Sinon un enregistrement de client de `0x94` octets est fabriqué et inscrit.
4. **La mémoire partagée.** `client_setup_memory` (`0x12e818`) range le numéro de processus dans l'enregistrement (`+0x10`) puis : si la poignée et la taille sont toutes deux nulles, le client n'a pas de bloc ; sinon il faut que la taille soit au moins `0x10000` et un multiple de la page, et le module projette le bloc par `map_memory_block` (`0x12bd20`, `svcMapMemoryBlock`, droits de lecture et d'écriture). Il le découpe alors (interprété) en morceaux de `0x40` octets chaînés dans une réserve et en paquets par puissances de deux pour la pile ; une taille qui ne va pas rend `0xD8E073EC` (« argument invalide »). L'enregistrement prend aussi la limite de sockets du client : 16 (`+0x18 = 0x10`, compteur d'ouvertures à `+0x14`).
5. **Le retour.** Le contexte de session garde le numéro de processus et le drapeau « initialisée » (`+0x203C = 1`). Le résultat 0 est écrit dans la réponse `0x00010040`.

Le contrôle commun des autres commandes, `client_check_socket_owner` (`0x113010`, avec le numéro de processus que le noyau a écrit) :

1. cherche le client par son numéro (`client_find_by_pid`, `0x112af4`) : absent, `0xD8E07006` (le processus n'a pas fait InitializeSockets) ;
2. demande à la pile le propriétaire du socket (`socket_get_owner`, `0x125e68`) : `0xC8A07009` si la pile n'est pas démarrée, `0xD8E07007` si le descripteur n'existe pas, `0xC96073FF` pour toute autre erreur ;
3. `socket_owner_matches` (`0x12f3fc`) : le socket doit être global (octet `+0x10` nul) ou appartenir à ce client ; sinon `0xC8A07004`.

Un client enregistré par une session reste utilisable par toutes les autres sessions qui envoient son numéro de processus (c'est le noyau qui le met, le jeu ne peut pas le falsifier) : Pokémon X ouvre une réserve de 4 sessions `soc:U` et ne fait InitializeSockets que sur la première (partie 11). `ShutdownSockets` (`socu_0019_ShutdownSockets`, `0x12f2d0`) et la fermeture de la session ne désenregistrent le client que si c'est la session qui l'a enregistré (`client_unregister`, `0x12e714` : ferme tous ses sockets par `client_close_all_sockets`, `0x12ea5c`, retire l'enregistrement, décrémente le nombre de clients).

## Partie 6 : les commandes de socket

**socket (2).** Requête `0x000200C2` : domaine (mot 1), type (mot 2), protocole (mot 3), puis le numéro de processus. `socu_0002_socket` cherche le client (`0xD8E07006` s'il manque), refuse (`0xC8A07004`) si l'enregistrement n'est pas marqué utilisable (`+0x90`), refuse (`0xD860700C`) si la limite de sockets est atteinte, réserve un enregistrement (`0xD86073F3` s'il n'y a plus de mémoire) puis appelle `socket_create` (`0x127a4c`). Celle-ci ne connaît que la famille `2` (sinon `-5`), exige que le protocole soit nul (sinon `-0x44`), et crée un socket TCP pour le type 1 ou UDP pour le type 2 (l'octet `+8` de l'enregistrement du socket vaut alors 6 ou `0x11`). Le module garde au plus `0x40` sockets en tout (`-0x21` au-delà). Le descripteur rendu (mot 2) est un compteur global qui augmente de 1 à chaque socket (de `+0x30` du contexte de la pile, remis à zéro à `0x7FFFFFFF`).

**sendto (10) et sendto_other (9).** Requête `0x000A0106` : descripteur du socket (mot 1), longueur des données (mot 2), drapeaux (mot 3), longueur de l'adresse (mot 4), `0x20` et le numéro de processus, puis deux tampons statiques : l'adresse (numéro 1, `0x402`) et les données (numéro 2, `0x802`). `sendto_other` (`0x00090106`) passe les données par un tampon mappé en lecture (type `0xA`) à la place du tampon statique 2. Les deux ouvrent `socu_0009_000A_sendto` (`0x112c64`) avec : refus `-0x1C` si les données manquent, `-0x26` si la pile n'est pas démarrée, `-8` pour un descripteur inconnu. Pour un socket TCP, seuls les bits 1 et 4 des drapeaux sont permis (`(drapeaux & ~5) == 0`) ; le bit 4, « ne pas bloquer », est ajouté automatiquement quand l'octet de `fcntl` du socket a son bit 4. Le retour BSD est le nombre d'octets envoyés.

**recvfrom (8) et recvfrom_other (7).** Requête `0x00080102` : descripteur, longueur demandée, drapeaux, taille du tampon d'adresse, puis `0x20` et le numéro de processus. Le module limite la longueur à `0x2000` (`recvfrom` : les données reviennent par le tampon statique 0, posé par l'appelant) et la taille d'adresse à `0x1C`. Réponse `0x000800C4` : résultat, retour BSD (le nombre d'octets reçus), nombre d'octets placés dans le tampon statique de données (le plus petit de la longueur demandée et du retour, mot 3), puis deux descripteurs de tampon statique (données, adresse). La taille réelle de l'adresse est écrite par le module dans le premier octet du tampon d'adresse. `recvfrom_other` (`0x00070104`) reçoit dans un tampon mappé en écriture (type `0xC`) et rend `0x00070084`. Sans donnée et sans le bit « non bloquant » le fil de session **attend** dans la pile : c'est pour cela qu'il y a un fil par session.

**poll (20).** Requête `0x00140084` : le nombre d'éléments (mot 1), le délai en millisecondes (mot 2, `-1` pour attendre sans fin), puis `0x20` et le numéro de processus, puis le tableau d'entrée dans le tampon statique 10 (taille nfds × 12). Le jeu pose aussi le tampon de réception statique 0 (même taille). `socu_0014_poll` (`0x126d68`) refuse plus de `0x40` éléments. Un élément de 12 octets : le descripteur (mot 0), les événements demandés (mot 1, octet bas et deuxième octet ; la pile ajoute toujours `0xE0`, les conditions d'erreur), les événements obtenus (mot 2). Un descripteur inconnu donne `0x20` (POLLNVAL) dans les événements obtenus et compte pour un événement. Sinon l'état du socket TCP ou UDP est lu (`0x12b09c`, `0x12b5d8`). Si aucun descripteur n'est prêt, le fil dort sur une file d'attente jusqu'à ce qu'un événement se produise ou que le délai soit écoulé. Retour BSD : le nombre de descripteurs prêts. Les `pollfd` obtenus reviennent par le tampon statique 0.

**gethostbyname (13).** Requête `0x000D0082` : longueur du nom (mot 1), taille du tampon de réponse (mot 2), le nom dans le tampon statique 3. La taille de la réponse doit valoir exactement `0x1A88`, la longueur du nom au plus 255 (sinon `0xD8E07005`). Le module résout par `0x125774` (résolveur DNS de la pile, sur ses propres sockets UDP) ; si le nom n'existe pas le retour BSD vaut `-1` et le résultat 0. Le résultat remplit la structure suivante (écrite par `hostent_serialize`, `0x12c6c4` ; un `hostent` de C mis à plat) :

| Décalage | Taille | Contenu |
| --- | --- | --- |
| `+0x000` | 2 | la famille (`2`) |
| `+0x002` | 2 | la longueur d'une adresse (4) |
| `+0x004` | 2 | le nombre d'adresses (au plus `0x18`) |
| `+0x006` | 2 | le nombre d'alias (au plus `0x18`) |
| `+0x008` | `0x100` | le nom officiel, terminé par zéro |
| `+0x108` | `0x100` × alias | les alias, un par `0x100` octets |
| `+0x1908` | `0x10` × adresses | les adresses, une par 16 octets (seuls les premiers octets servent) |

C'est ce que lisent les `.cro` du jeu ; le total, `0x1908 + 0x18 × 0x10`, tombe sur `0x1A88` (interprété à la lecture de la fonction, non rejoué).

## Partie 7 : `soc:P`

Un seul client connu : `ac` (voir [ac](ac.md)), qui s'en sert pour donner à la pile sa configuration réseau. Pokémon X n'ouvre jamais `soc:P` : il essaie (`0x2d1614`) mais la poignée n'est jamais remplie et il retombe sur `soc:U` (gethostid). L'aiguillage est `socp_handle_command` (`0x12dd58`), 9 commandes.

| N° | En-tête de requête | Commande (3dbrew) | Fonction | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010084` | InitializeSockets | `socp_0001_InitializeSockets` | `0x12c848` | entier | `0x00010040` |
| 2 | `0x00020000` | FinalizeSockets | `socp_0002_FinalizeSockets` | `0x12c820` | numéro | `0x00020040` |
| 3 | `0x000300C2` | SetNetworkOpt | `socp_0003_SetNetworkOpt` | `0x12c788` | entier | `0x00030080` |
| 4 | `0x00040040` | CloseSocketsForProcess | `socp_0004_CloseSocketsForProcess` | `0x12c814` | numéro | `0x00040040` |
| 5 | `0x000500C0` | sans nom | `socp_0005_GetStackInfo` | `0x12f024` | numéro | `0x00050042` |
| 6 | `0x00060000` | gethostid | `socp_0006_gethostid` | `0x12c870` | numéro | `0x00060080` |
| 7 | `0x00070000` | sans nom | `socp_0007_GetHandle` | `0x12c7fc` | numéro | `0x00070042` |
| 8 | `0x00080000` | sans nom | `socp_0008_GetValue` | `0x12c7e0` | numéro | `0x00080080` |
| 9 | `0x00090000` | StopInitializeSockets | `socp_0009_StopInitializeSockets` | `0x12efe8` | numéro | `0x00090040` |

Ce que le code en fait (interprété, à relire) :

- **1.** Deux tampons statiques : le numéro 0 (au plus `0x168` octets : la configuration de la pile, rangée par `0x12efa8`) et le numéro 1 (au plus `0x20` octets, optionnel : huit mots recopiés et validés par `0x12ed80`, avec un champ du module). Au-delà, `0xD8E07005`. Si la pile est déjà démarrée : `0xD8E07002`.
- **2.** Arrête la couche réseau de la pile (`0x11c3d8`, `0x12e07c` : notification de veille à `ptm:s`, commande `0x000D0002` à `nwm::SOC`, minuterie) ; rend 0 si `0x11c3d8` a réussi.
- **4.** Ferme tous les sockets d'un processus dont le numéro est au mot 1 (la même fonction que la commande 33 de `soc:U`, mais avec le numéro dans un mot ordinaire).
- **3.** `SetNetworkOpt(niveau, option, valeur)` : rien pour les options `0x1001` et `0x1002` (refus `0xC96073FF`), sinon passe à `0x127550`.
- **5.** `(octet genre de 0 à 2, mot, taille)` : remplit un tampon statique d'au plus `0x200` octets avec une table interne de la pile, de `0x2C`, `0x2D0` ou `0x38` octets selon le genre (`0x128bd8`, `0x128c28`, `0x128c80`) ; la table n'est pas identifiée.
- **7.** Rend une poignée (descripteur de copie `0x0` suivi d'une poignée) gardée dans une variable globale : probablement le sémaphore ou l'événement que la pile signale (pas lu).
- **8.** Rend un mot de la pile, sans autre lecture.
- **9.** Arrête la pile : vide ses listes de connexions (`0x123e50`).

## Partie 8 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x1330c4`, `0x1330c8` | les deux poignées de session de `nwm::SOC` |
| `0x133268` | la poignée de `ptm:s` |
| `0x1334f8` | l'état des notifications de `srv:` (octet `+10` : « arrêt demandé ») |
| `0x1339d4` | la table des clients (16 listes à `+0xC`, nombre à `+0x4C`) |
| `0x132000` | le nom `soc:U` (le nom de `soc:P` est à `0x132006`) |

Un enregistrement de client (interprété, par les fonctions qui le lisent) :

| Décalage | Contenu |
| --- | --- |
| `+0x00`, `+0x04` | liens de la liste |
| `+0x08` | pointeur vers la table (dans le client, pas relu) |
| `+0x10` | numéro de processus |
| `+0x14` | nombre de sockets ouverts |
| `+0x18` | limite du nombre de sockets (16 au départ, commande 34) |
| `+0x1C` à `+0x43` | le bloc de mémoire projeté : poignée, adresse, taille, indicateur |
| `+0x3C`, `+0x40` | listes de sockets du client |
| `+0x90` | le client est utilisable |

Un enregistrement de socket (interprété) : `+8` la famille (2), `+9` l'octet de `fcntl` (bit 4 : non bloquant) et le type de protocole (6 TCP, `0x11` UDP, d'après `socket_create`), `+0x10` « réservé à son propriétaire » (nul : global), `+0x24` le descripteur, `+0x28` le numéro du processus propriétaire. Pas relus avec assez de soin pour poser les noms de champ : ce sont les décalages que les fonctions de ce tableau lisent.

## Partie 9 : les services que `socket` appelle

Chaque requête a sa petite fonction (un seul `svcSendSyncRequest`, `0x32`, dans chacune des 17 fonctions d'envoi relevées). Les noms sont ceux de 3dbrew quand la commande y est nommée.

| Service | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- |
| `srv:` | `0x00010002` | `SRV_RegisterClient` | `0x1016ac` | se déclarer à `sm` |
| | `0x00020000` | `SRV_EnableNotification` | `0x103354` | obtenir le sémaphore des notifications |
| | `0x00030100` | `SRV_RegisterService` | `0x100a30` | créer `soc:U` et `soc:P` |
| | `0x000400C0` | `SRV_UnregisterService` | `0x1016e8` | les retirer à l'arrêt |
| | `0x00050100` | `SRV_GetServiceHandle` | `0x1056d0` | ouvrir `nwm::SOC` |
| | `0x00090040` | `SRV_Subscribe` | `0x11c3f4` | s'abonner à trois notifications |
| | `0x000B0000` | `SRV_ReceiveNotification` | `0x101e24` | lire le numéro de la notification |
| `err:f` | `0x00010800` | `ERRF_Throw` | `0x10547c` | erreur fatale (`0x115568` l'appelle) |
| `nwm::SOC` | `0x00040082` | `NWMSOC_cmd0004` | `0x12c2b8` | (3dbrew : `0x00040042`) deux mots et un tampon statique : envoi d'une trame |
| | `0x00050040` | `NWMSOC_cmd0005` | `0x109890` | un mot |
| | `0x00080040` | `NWMSOC_GetMACAddress` | `0x1098c0` | lire l'adresse MAC |
| | `0x00090000` | `NWMSOC_cmd0009` | `0x105684` | rend la taille, la poignée de la mémoire partagée et celle d'un événement (3dbrew confirme) |
| | `0x000A0040` | `NWMSOC_cmd000A` | `0x12c380` | un mot |
| | `0x000B0040` | `NWMSOC_cmd000B` | `0x12c344` | un mot, rend un mot |
| | `0x000C0040` | `NWMSOC_cmd000C` | `0x12c314` | un mot |
| | `0x000D0002` | `NWMSOC_cmd000D` | `0x1032a4` | le numéro de processus (descripteur `0x20`) : 3dbrew dit que `socket` est le seul module à l'utiliser |
| `ptm:s` | `0x04030042` | `PTMS_NotifySleepPreparationComplete` | `0x1032d8` | dire à `ptm` que le module est prêt pour la veille |

Les quatre commandes `0x00040082`, `0x000A0040`, `0x000B0040` et `0x000C0040` sont envoyées par `0x12c1b4` à `0x12c27c` avec la poignée `0x1330c4`, c'est-à-dire à `nwm::SOC` (interprété : les fonctions du dessus, qui forment la couche réseau de la pile, ne sont pas lues).

## Partie 10 : les appels système utilisés

28 numéros d'appels système (relevés dans l'assembleur, tous autorisés par le masque de l'exheader, 59 appels autorisés au total) :

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x1011c4` |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x101b24` |
| CreateThread | `0x08` | `svcCreateThread` | `0x10204c` |
| ExitThread | `0x09` | dans `0x105810` | `0x105854` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x1156fc` |
| GetThreadPriority | `0x0B` | `svcGetThreadPriority` | `0x122b64` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x109a64` |
| SignalEvent, ClearEvent | `0x18`, `0x19` | dans `0x113bf0`, `0x11a30c`... | |
| CreateTimer, SetTimer, CancelTimer | `0x1A`, `0x1B`, `0x1C` | `svcCreateTimer` (`0x101b0c`), `svcSetTimer` (`0x11a484`), dans `0x11c25c` | |
| MapMemoryBlock | `0x1F` | dans `map_memory_block` | `0x12bd84` |
| UnmapMemoryBlock | `0x20` | dans `unmap_memory_block` | `0x12bdf4` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x101af4` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x116ac4` |
| CloseHandle | `0x23` | (40 sites) | |
| WaitSynchronization1 | `0x24` | (15 sites) | |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x10dc38` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x122b4c` |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x112684` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x102070` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x102034` |
| SendSyncRequest | `0x32` | (17 fonctions d'envoi) | |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x103488` |
| Break | `0x3C` | dans `0x105798` | `0x105808` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x122b34` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x122b7c` |

Les minuteries (`0x1A` à `0x1C`) et l'arbitre d'adresse servent la pile TCP (retransmissions, attentes dans `poll`) : interprété, par le nom des appels et leur place dans les fonctions de TCP.

## Partie 11 : ce que Pokémon X envoie

Les 20 lignes de `pokemon-x-services.tsv` pour `soc:U`. Le jeu ne parle qu'à `soc:U` : la ligne `soc:P` n'est jamais ouverte. Les paramètres sont lus dans le pseudo-code du jeu (`local/analyse/maj/gh/pseudo/`) et dans les fonctions d'envoi.

**Comment le jeu ouvre la pile.** `soc_open_session` (`0x165204`) : il ouvre `soc:U` par `srv:` (`GetServiceHandle`), crée un bloc de mémoire partagée de `0x20000` octets (128 Kio, aligné sur la page ; l'adresse et la taille se terminent par `000` sur 12 bits, contrôlé par `0x16f6f0`), puis envoie InitializeSockets avec la taille `0x20000`, le descripteur `0x20` (que le noyau remplit) et la poignée du bloc. Il le fait depuis `0x149e4c`, appelée par `0x13bcd8` (qui alloue un tampon d'au moins `0x40000` pour l'ensemble, dont le bloc ne prend que `0x20000`). Il ouvre ensuite sa **réserve de sessions** (`0x164d7c`, 4 sessions, `session_pool_open_session` à `0x18b898`) : chaque fonction d'envoi qui n'est pas InitializeSockets prend une session de la réserve avec `soc:U` ouvert par `srv:`, sans nouveau InitializeSockets. Le bloc de mémoire n'est jamais lu ni écrit par le jeu après l'envoi : seul le module s'en sert.

| En-tête | Commande | Fonction du jeu | Fonction du module | Ce que le jeu met, ce qu'il faut rendre |
| --- | --- | --- | --- | --- |
| `0x00010044` | InitializeSockets | `soc_InitializeSockets` (`0x17372c`) | `socu_0001_InitializeSockets` (`0x12f264`) | mot 1 `0x20000`, mots 2 et 3 : `0x20` et le numéro de processus, mots 4 et 5 : `0` et la poignée du bloc. Rendre le résultat 0 (`0x00010040`) et **fermer la poignée** du bloc (le module la projette ; un remplaçant n'en a pas besoin). Un résultat négatif fait refermer la session et renoncer le réseau |
| `0x000200C2` | socket | `soc_socket` (`0x2cfc04`), via `0x2d0754` | `socu_0002_socket` (`0x12e29c`) | domaine 2 ; type 2 (UDP) avec protocole 0, ou type 1 (TCP) avec protocole **6** (appelant `0x25a3e4`). Rendre au mot 2 le descripteur (un nombre positif, il augmente de 1 à chaque socket) ; le jeu traite un descripteur négatif comme un échec et lit ensuite `FUN_00164ad8` pour la raison |
| `0x00050084` | bind | `soc_bind` (`0x2cfa04`) | `socu_0005_bind` (`0x12488c`) | mot 1 le descripteur, mot 2 la taille de l'adresse, l'adresse dans le tampon statique 0 (`sockaddr` de 8 ou `0x1C` octets). Rendre 0 |
| `0x00060084` | connect | `soc_connect` (`0x2cfc50`) | `socu_0006_connect` (`0x1249c8`) | même disposition que bind |
| `0x00070104` | recvfrom_other | `soc_recvfrom_other` (`0x2cfcb0`) | `socu_0007_0008_recvfrom` (`0x1270b4`) | reçoit dans un tampon mappé en écriture |
| `0x00080102` | recvfrom | `soc_recvfrom` (`0x2cf8e8`) | `socu_0007_0008_recvfrom` (`0x1270b4`) | descripteur, longueur (au plus `0x2000`), drapeaux, taille du tampon d'adresse ; les données et l'adresse reviennent par les tampons statiques 0 et 1 du jeu. Retour BSD (mot 2) : le nombre d'octets reçus ; mot 3 : le nombre d'octets placés dans le tampon statique de données ; la taille réelle de l'adresse est dans son premier octet |
| `0x00090106` | sendto_other | `soc_sendto_other` (`0x2cfb80`) | `socu_0009_000A_sendto` (`0x112c64`) | descripteur, longueur, drapeaux, taille d'adresse ; l'adresse dans le tampon statique 1, les données par un tampon mappé en lecture |
| `0x000A0106` | sendto | `soc_sendto` (`0x2cf864`) | `socu_0009_000A_sendto` (`0x112c64`) | même chose, les données dans le tampon statique 2. Retour BSD : le nombre d'octets envoyés |
| `0x000B0042` | close | `soc_close` (`0x2cfaf0`) | `socu_000B_close` (`0x1249a8`) | mot 1 le descripteur ; rendre 0 |
| `0x000C0082` | shutdown | `soc_shutdown` (`0x2cfd34`) | `socu_000C_shutdown` (`0x1278a4`) | descripteur, et 0, 1 ou 2 |
| `0x000D0082` | gethostbyname | `soc_gethostbyname` (`0x1937e8`) | `socu_000D_gethostbyname` (`0x12c608`) | longueur du nom, taille de la réponse (`0x1A88`), nom dans le tampon statique 3. Rendre la structure de la partie 6, ou un retour BSD de `-1` |
| `0x00120104` | setsockopt | `soc_setsockopt` (`0x2cf790`) | `socu_0012_setsockopt` (`0x127598`) | descripteur, niveau 0, option 8, valeur de 4 octets (un booléen) dans le tampon statique 9, longueur 4 (appelant `0x25a898`, niveau « protocole IP » d'après le module, qui ne traite en propre que le niveau `0xFFFF`) |
| `0x001300C2` | fcntl | `soc_fcntl` (`0x2cfb34`) | `socu_0013_fcntl` (`0x124da0`) | descripteur, commande 3 (lire), puis commande 4 (poser) avec la valeur lue moins le bit 4 (`& ~4`) : le jeu met chaque socket en mode bloquant juste après sa création (`0x25a3e4`). Il faut rendre le même octet qu'on a reçu |
| `0x00140084` | poll | `soc_poll` (`0x2cfa64`) | `socu_0014_poll` (`0x126d68`) | nombre d'éléments, délai en millisecondes, tableau de `pollfd` de 12 octets |
| `0x00160000` | gethostid | `soc_gethostid` (`0x2cfd78`) | `socu_0016_gethostid` (`0x12592c`) | aucun paramètre ; le jeu essaie `soc:P` d'abord (`0x2d1614`) puis `soc:U`. Rendre l'adresse IPv4 locale au mot 2 |
| `0x00170082` | getsockname | `soc_getsockname` (`0x2cf7f8`) | `socu_0017_getsockname` (`0x125b04`) | descripteur, taille du tampon d'adresse ; l'adresse revient par le tampon statique 0 |
| `0x00190000` | ShutdownSockets | `soc_ShutdownSockets` (`0x173770`) | `socu_0019_ShutdownSockets` (`0x12f2d0`) | rien ; rendre 0 |
| `0x001A00C0` | GetNetworkOpt | `soc_GetNetworkOpt` (`0x173798`), via `0x164a2c` | `socu_001A_GetNetworkOpt` (`0x125940`) | niveau `0xFFFE`, option `0x4003` (appelant `0x14a20c`, 12 octets : à la lecture de la taille, l'adresse IP et deux autres mots, le masque et la diffusion), options `0x4005` (un nombre) puis `0x4006` (un tableau d'entrées de `0x18` octets) par `0x14a074` : interprété, 3 options lues côté jeu |
| `0x001F0040` | GetResolverInfo | `soc_GetResolverInfo` (`0x173814`), via `0x164a90` | `socu_001F_GetResolverInfo` (`0x11aa68`) | taille demandée `0x150` ; rend `0x150` octets d'état du résolveur (les serveurs DNS) |
| `0x00200146` | SendToMultiple | `soc_SendToMultiple` (`0x2cf98c`) | dans `socu_handle_command` (`0x12cafc`) | descripteur, longueur, drapeaux, taille d'une adresse, taille du tampon d'adresses ; données dans le tampon statique 12, adresses dans le 13 |

Le jeu ne regarde que le signe du résultat de la commande (mot 1) et, pour les appels qui rendent une valeur, le mot 2 : un mot 2 négatif est traité comme un échec (`FUN_00164ad8` en fait un code d'erreur).

**Ce qu'un remplaçant de la console sur PC doit rendre.** La pile elle-même, avec ses 800 fonctions, n'a pas à être refaite : le PC a la sienne. Le remplaçant doit offrir les 20 commandes ci-dessus, et pour chacune une vraie réponse ou une réponse factice :

- **Doit être vrai si le jeu va en ligne** : `socket` (avec de vrais sockets du système, UDP et TCP, et une table descripteur → socket propre à chaque processus, des entiers positifs qui augmentent), `bind`, `connect`, `sendto`, `recvfrom`, `close`, `shutdown`, `fcntl` (l'octet des drapeaux gardé tel quel, le bit 4 = non bloquant), `poll` (des vrais `poll` ou `select` avec le délai en millisecondes, et un `revents` à `0x20` pour un descripteur inconnu), `getsockname`, `gethostbyname` (un vrai DNS et la structure de `0x1A88` octets de la partie 6), `setsockopt` (au moins ne pas échouer, et idéalement appliquer ce qu'on peut). Les sockets qui bloquent doivent bloquer le fil de la session seulement : un `recvfrom` en attente ne doit pas empêcher un `poll` ou un `sendto` d'une autre session. Il faut donc un fil par session `soc:U` ouverte (le jeu en ouvre au plus 4).
- **Peut rester factice** : InitializeSockets (rendre 0, ignorer la taille et la poignée du bloc de mémoire, qui est inutile sur PC), ShutdownSockets (0), `gethostid` et `GetNetworkOpt` (une adresse IP locale, un masque, une adresse de diffusion plausibles, par exemple celles de l'interface du PC ; pour `0x4005` un nombre d'entrées de table nul), `GetResolverInfo` (`0x150` octets de zéros ou les serveurs DNS du PC), `SendToMultiple` (une boucle sur `sendto`).
- **Hors ligne** : si on refuse le réseau, la bonne façon est de rendre un descripteur négatif à `socket` (retour BSD de `-0x27`, « pile non démarrée »), ce que le jeu traite déjà comme un échec, plutôt que de refuser InitializeSockets (un résultat négatif y fait refermer la session et renoncer, ce qui marche aussi).
- **Les codes d'erreur** que le jeu verra dans le mot 2 sont ceux de la pile de la console (partie 3). Il faut en rendre les mêmes pour « rien à lire en mode non bloquant » : ce code n'est pas relevé dans ce que le jeu envoie, et n'est pas lu.

## Écarts avec 3dbrew

| Service | N° | En-tête | 3dbrew / la Carte | Le code | Ligne de cette fiche |
| --- | --- | --- | --- | --- | --- |
| `soc:U` | 0x22 | `0x00220040` | « `(int sockfd)` Might be the inverse of `0x00230040` » | le mot 1 est rangé à `+0x18` de l'enregistrement du client, la limite du nombre de sockets de ce processus (que `socket` compare au nombre ouvert, `+0x14`, et qu'InitializeSockets met à 16) ; ce n'est pas un descripteur ; nom proposé : SetSocketLimit | partie 3, table, ligne 34 |
| `soc:U` | 0x1001, 0x1003, 0x1005, 0x1007 | `0x100100C0`, `0x10030142`, `0x10050084`, `0x10070102` | quatre commandes marquées « ? » | absentes : l'aiguillage coupe sur les 16 bits du haut, et `0x1001`... n'est dans aucun cas (il rend `0xD900182F`) ; ces en-têtes ne sont pas des commandes de ce module, ou d'une autre version | partie 2 |
| `soc:U` | 13, 14, 28, 32 | `0x000D0082`, `0x000E00C2`, `0x001C0104`, `0x00200146` | liste des tampons statiques : bind/connect 0, sendto 1 et 2, getaddrinfo 5 à 7, getnameinfo 8, setsockopt 9, poll 10 | en plus : gethostbyname 3, gethostbyaddr 4, ICMPPing 11, SendToMultiple 12 et 13 | partie 4 |
| `soc:P` | 5 | `0x000500C0` | sans nom | lit trois mots (un octet de genre de 0 à 2, un mot, la taille) et remplit un tampon statique de `0x200` octets au plus avec une table interne (`0x2C`, `0x2D0` ou `0x38` octets) ; réponse `0x00050042` | partie 7 |
| `soc:P` | 7 | `0x00070000` | sans nom | rend une poignée (descripteur de copie `0x0` suivi de la poignée) : la réponse est `0x00070042` | partie 7 |
| `soc:P` | 8 | `0x00080000` | sans nom | rend un mot (réponse `0x00080080`) | partie 7 |
| `soc:P` | 9 | `0x00090000` | StopInitializeSockets | accord pour le numéro et l'en-tête ; elle arrête la pile (vide les listes de connexions) | partie 7 |
| `nwm::SOC` | 4 | `0x00040042` | « `(u32 size, u32 unk, <static_buffer id 1>, addr)` », en-tête `0x00040042` | le module envoie `0x00040082` : deux mots ordinaires, un tampon statique ; l'en-tête de 3dbrew est incohérent avec sa propre description | partie 9 |
| `soc:U` (jeu et module) | 2 | `0x000200C2` | | le jeu envoie, pour un socket TCP, le protocole `6` ; `socket_create` (`0x127a4c`) refuse tout protocole non nul (`-0x44`) : désaccord à lever (soit la branche TCP du jeu n'est jamais prise en ligne, soit une couche entre les deux convertit) | partie 6 et partie 11 |

Rien d'autre ne différe : les 35 numéros et leurs 35 en-têtes de `soc:U`, les deux codes d'erreur d'InitializeSockets (`0xC8A0700B` et `0xD860700A`), la limite de 32 processus, et la taille d'adresse de `0x1C` sont tous ceux de 3dbrew. Les noms de fonction `socu_…` et `socp_…` sont posés ici ; la Carte des services donne les mêmes noms de commande que 3dbrew.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 35 numéros de commande de `soc:U` et les 9 de `soc:P`, leur en-tête de réponse et leur fonction : le pseudo-code de Ghidra de `socu_handle_command` et de `socp_handle_command`, et l'exécution de l'aiguillage par `emulate_dispatch.py`, qui retrouve 27 des 35 commandes de `soc:U` (les 8 qu'elle refuse sont celles marquées d'une étoile) et les 9 de `soc:P`. Pour les 27 commandes suivies par l'émulation, la fonction, l'en-tête de réponse et la vérification de l'en-tête (entier ou numéro) sont les mêmes des deux côtés.
- Les en-têtes de requête : 3dbrew et les mots de la table des constantes de l'aiguillage (`0x12da94`...), qui tombent sur les 35 numéros pour `soc:U` ; les en-têtes des commandes qui comparent l'en-tête entier sont prouvés par la comparaison ; les autres sont les en-têtes de 3dbrew, dont le nombre de mots lus par le code est cohérent.
- Le serveur : `svcReplyAndReceive` n'a que deux appelants (`socu_reply_and_receive_loop`, `socp_reply_and_receive_loop`), chacun appelé par une seule fonction de fil ; les tables de méthodes des deux serveurs (`0x132290` et `0x132284`) contiennent bien les fonctions d'acceptation.
- Le nom et la capacité des services : les chaînes `soc:U` et `soc:P` (`0x132000`, `0x132006`) et le dernier argument de `SRV_RegisterService` : 18 et 3.
- Les 28 appels système : relevés dans l'assembleur de tout le module et tous autorisés par le masque de l'exheader (59 autorisés).
- Les deux erreurs d'InitializeSockets (`0xC8A0700B`, `0xD860700A`) et la limite de 32 clients : lues dans `client_register`, et les mêmes valeurs que 3dbrew.
- Les requêtes envoyées à `nwm::SOC` et `ptm:s` : 17 fonctions d'envoi, leurs en-têtes lus dans les constantes.
- La disposition des requêtes de Pokémon X : lue dans le pseudo-code des 20 fonctions d'envoi du jeu, et en regard des lectures du côté module (mêmes numéros de mots, mêmes descripteurs).

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Tout ce qui touche à l'intérieur de la pile : le sens des champs de l'enregistrement de client et de socket, la découpe de la mémoire partagée, le rôle des minuteries, la structure du contexte de la pile.
- Le nom `SetSocketLimit` pour la commande 34 : le comportement est lu (écriture de `+0x18` et lecture de ce champ par `socket`), le nom est le mien.
- Le sens des options de `GetNetworkOpt` (`0x4003` = adresse IP, masque, diffusion, d'après le nom de libctru et la taille de 12 octets ; `0x4005` et `0x4006` : nombre d'entrées de table et table de `0x18` octets) et de l'option 8 de niveau 0 de `setsockopt`.
- Les rôles de `soc:P` 5, 7 et 8.
- La structure `hostent` de la partie 6 : lue dans `hostent_serialize`, pas rejouée.
- Le comportement de `poll` quand rien n'est prêt (le fil dort sur une file d'attente).

**Pas lu**
- La pile TCP/IP elle-même : TCP (`0x10afdc`, `0x1287b4`...), UDP (`0x128ea8`, `0x12b5d8`...), ICMP, ARP, DHCP éventuel, le résolveur (`0x125774`), les sockets internes et leurs minuteries : environ 650 fonctions sans nom.
- Les 8 commandes marquées d'une étoile sont lues dans le pseudo-code et recoupées avec 3dbrew, mais pas par l'émulation.
- Le détail de `getsockopt`, `getaddrinfo`, `getnameinfo`, `gethostbyaddr`, les quatre commandes ICMP et `SendToMultiple` au-delà de la boucle.
- Les numéros des trois notifications de `srv:` auxquelles le module s'abonne, et le rôle des gestionnaires.
- Les corps des fils de la couche réseau qui parlent à `nwm::SOC` (envoi et réception des trames) ; la découpe exacte de la mémoire partagée donnée par `nwm`.
- Les valeurs de code d'erreur BSD (`-0x27`, `-8`, `-0x1C`...) ne sont pas rapprochées d'une table de noms (EBADF, EINVAL...) : seul leur emploi est lu.
- L'allocateur du module (`0x11a894` et suivantes), la gestion des erreurs fatales (`0x11cda0`).

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Fonctions, pseudo-code, références | `python outils/ghidra_direct.py socket` | 37 secondes (deux fois, avec les noms) |
| Désassemblage de chaque fonction avec capstone, appels système, tables de constantes | `local/analyse/socket/mkasm.py`, `findwords.py`, `w.py`, `senders.py` | immédiat |
| Table des commandes de `soc:U` et de `soc:P` | `python outils/emulate_dispatch.py socket 0x12cafc=soc:U 0x12dd58=soc:P` | quelques secondes |
| Noms des commandes, de la structure `sockaddr`, des erreurs et de `nwm::SOC` | 3dbrew, par `web.archive.org` (Socket Services, NWM Services, instantané de 2023 : le 2026 est bloqué par un anti-spam) | |
| Le côté du jeu | le pseudo-code de la mise à jour (`local/analyse/maj/gh/`) | |

**Pour reprendre.** `socket.noms.tsv` est le fichier de graines : une adresse, `function` (ARM) ou `label` (Thumb), un nom. Les noms en `socu_<numéro>_<Commande>` sont les fonctions qui reçoivent les commandes de `soc:U`, ceux en `socp_<numéro>_<Commande>` celles de `soc:P` ; ceux en majuscules (`SRV_`, `NWMSOC_`, `PTMS_`, `ERRF_`) sont les requêtes que `socket` envoie à un autre service ; les noms `svc…` sont des enveloppes d'appels système. Le pseudo-code brut et les scripts sont dans `local/analyse/socket/`, non versionné.
