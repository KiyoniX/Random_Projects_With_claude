# pxi, le passeur entre les deux processeurs

La 3DS a deux processeurs. L'ARM11 fait tourner le système et les jeux ; l'ARM9 fait tourner Process9, qui tient la carte SD, la NAND et le chiffrement. Ils ne partagent ni noyau ni appels système : ils se parlent par un petit matériel appelé PXI, une file de mots de 32 bits dans chaque sens et une interruption pour se réveiller l'un l'autre.

`pxi` est le seul programme de l'ARM11 qui touche ce matériel. Il offre neuf services ordinaires (`PxiFS0`, `pxi:am9`…). Quand un module comme `fs` y envoie une requête, `pxi` ne la lit pas : il la recopie mot pour mot dans la file, attend la réponse de Process9, et la rend au module. Il n'y a donc pas de tableau de commandes par service dans cette fiche : `pxi` ne connaît que trois commandes (partie 6).

Fiche du 13 octobre 2026, produite avec REA et Ghidra sur le module extrait du FIRM de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001402`, rangé dans le NATIVE_FIRM (lu dans l'exheader) |
| Fichier lu | `local/extrait/pxi/exefs/code.elf` |
| Taille | 14 404 octets de code, 700 de données en lecture seule, 76 de données, 104 152 de mémoire à zéro (jusqu'à `0x11e724`) |
| Fonctions | 152 pour Ghidra, 4 entrées manquées, 156 au dénominateur ; 111 nommées dans `pxi.noms.tsv` |
| Fils | 4 : le fil principal et trois fils créés au démarrage, tous de priorité `0x2D` |
| Services offerts | 9 : `PxiFS0`, `PxiFS1`, `PxiFSB`, `PxiFSR`, `PxiPM`, `pxi:am9`, `pxi:dev`, `pxi:mc`, `pxi:ps9` |
| Services appelés | `srv:` seulement (5 commandes, partie 9) |
| Matériel | la page d'entrées-sorties `0x1EC63000` (les registres PXI) et les interruptions `0x50` à `0x53`, les seuls droits matériels donnés par l'exheader |
| Sur cette console | Luma remplace `pxi` par le sien au démarrage : ce qui est lu ici est l'original de Nintendo |

## Partie 1 : le démarrage et les quatre fils

`entry` (`0x100000`) vide la mémoire à zéro (`clear_bss`, `0x100024`), prépare la bibliothèque C, se connecte une première fois à `srv:` (`init_runtime_and_srv`, `0x10252c`), lance les 9 constructeurs d'objets globaux (`run_static_initializers`, `0x100048`, en Thumb, table de distances à `0x104298`) puis appelle `pxi_main` (`0x1000ac`). Quand `pxi_main` revient, le processus se termine (`svcExitProcess`, enrobage en `0x102768`).

Le constructeur qui compte est `static_init_pxi_objects` (`0x103364`) : il fabrique toutes les tables de la partie 7 avant même `pxi_main`.

`pxi_main` fait, dans l'ordre :

1. **L'évènement d'arrêt.** `svcCreateEvent` crée un évènement qui reste levé une fois signalé ; sa poignée va à `0x105004`. Tous les fils le surveillent.
2. **Le matériel.** `pxi_hw_init` (`0x100a8c`) remet le PXI à zéro, branche l'interruption et fait la poignée de main avec Process9 (partie 5).
3. **`srv:`.** `srv_init` (`0x10253c`) : déjà connecté, il ne fait que compter un utilisateur de plus.
4. **Les neuf services.** Une boucle sur la table à `0x104044` appelle `SRV_RegisterService` (`0x100994`) pour chaque nom. Les neuf ports reçus sont rangés dans une liste de 10 poignées sur la pile, derrière une case laissée libre.
5. **Trois fils**, par `create_thread` (`0x10243c`), priorité `0x2D`, processeur `-2` (celui par défaut du processus) :

   | Fil | Point d'entrée | Fonction qui tourne | Sommet de pile | Rôle |
   | --- | --- | --- | --- | --- |
   | travailleur | `worker_thread_entry` (`0x100dbc`) | `pxi11_worker_loop` (`0x1011ec`) | `0x11e1e0` | exécute les demandes que Process9 adresse à l'ARM11 (partie 6) |
   | récepteur | `receiver_thread_entry` (`0x100dc8`) | `pxi_receiver_loop` (`0x1012d4`) | `0x11c1e0` | réveillé par l'interruption, lit ce que Process9 a écrit dans la file |
   | sessions | `session_thread_entry` (`0x100da8`) | `session_manager_loop` (`0x1013fc`) | `0x11d1e0` | reçoit les requêtes des modules, les envoie, rend les réponses |

6. **L'ordre d'arrêt.** `register_notification_handler` (`0x1008e8`) inscrit un petit objet (à `0x106000`) pour la notification `0x100`, celle par laquelle `pm` demande à un module de s'arrêter. `get_notification_semaphore` (`0x1007f8`) obtient de `srv:` le sémaphore des notifications, qui prend la case libre en tête de la liste de poignées.
7. **Les canaux.** Pour chacun des 9 services, la fiche de son canal (partie 7) reçoit l'objet du canal, le nombre de sessions permises et un jeton à 1 : une seule requête à la fois par canal.
8. **La boucle du fil principal.** `svcWaitSynchronizationN` attend sur les 10 poignées, sans limite de temps.
   - Case 0, le sémaphore : `handle_srv_notification` (`0x10082c`) demande le numéro de la notification (`SRV_ReceiveNotification`) et appelle l'objet inscrit pour ce numéro. Pour `0x100`, `on_terminate_notification` (`0x1032ec`) met l'octet `0x106010` à 1, et la boucle s'arrête (partie 6).
   - Cases 1 à 9, un port : un module vient d'ouvrir le service. `svcAcceptSession` crée la session. Si le service a déjà son compte de sessions, elle est refermée aussitôt. Sinon elle est rangée dans la première fiche de session libre, avec le numéro du canal, et `svcSignalEvent` réveille le fil des sessions.

Le fil principal ne lit donc aucune requête : il accepte les sessions et les confie au fil des sessions.

## Partie 2 : les neuf services et leurs canaux

Dans la file matérielle, chaque message commence par un numéro de canal (3dbrew dit « pxi_id »). La table à `0x104044` (9 entrées de 12 octets) donne la correspondance. Elle est lue telle quelle dans `code.bin` :

| Service | Canal | Sessions permises | Pages gardées par requête | Objet du canal | Qui l'utilise |
| --- | --- | --- | --- | --- | --- |
| `pxi:mc` | 0 | 1 | 0 | `0x11bce4` | `ptm` pour la mise en veille (3dbrew), et `pxi` lui-même à l'arrêt |
| `PxiFS0` | 1 | 1 | 2 | `0x11bcf8` | `fs` (fiche `fs`, partie 7) |
| `PxiFS1` | 2 | 1 | 2 | `0x11bd0c` | `fs` |
| `PxiFSB` | 3 | 1 | 2 | `0x11bd20` | `fs` |
| `PxiFSR` | 4 | 1 | 2 | `0x11bd34` | `fs` |
| `PxiPM` | 5 | 1 | 1 | `0x11bd48` | `loader` (fiche `loader`) |
| `pxi:dev` | 6 | 2 | 4 | `0x11bd5c` | non lu |
| `pxi:am9` | 7 | 1 | 4 | `0x11bd70` | `am` (Carte des services) |
| `pxi:ps9` | 8 | 1 | 4 | `0x11bd84` | `ps` (Carte des services) |
| (aucun) | 9 | | | `0x11bdc4` | Process9, dans l'autre sens (partie 6) |

- Dans la table, les services sont rangés dans l'ordre `PxiFS0`, `PxiFS1`, `PxiFSB`, `PxiFSR`, `PxiPM`, `pxi:am9`, `pxi:dev`, `pxi:mc`, `pxi:ps9` : c'est l'ordre des ports dans la liste du fil principal. Le numéro de canal est un octet de l'entrée, pas le rang.
- Le total des sessions permises est 10, exactement le nombre de fiches de session.
- « Pages gardées par requête » : combien de tampons d'une page le service garde entre l'arrivée d'une requête et sa réponse (partie 4, étape 4).
- Les quatre canaux `PxiFS` sont identiques pour `pxi`. Ce qui les distingue (la priorité `0`, `16` ou `-16`) est une affaire entre `fs` et Process9.

## Partie 3 : le fil des sessions

`session_manager_loop` (`0x1013fc`, jusqu'à `0x101b48`) est la seule fonction qui appelle `svcReplyAndReceive`. Elle travaille sur le gestionnaire de sessions, à `0x11bb00` (partie 7), dont elle garde le verrou sauf pendant l'attente.

Chaque session a une fiche avec un état :

| État | Sens | Qui le pose |
| --- | --- | --- |
| 0 | au repos : la session est écoutée | à l'ouverture, puis quand la réponse est rendue |
| 1 | requête reçue, pas encore envoyée à Process9 | à la réception |
| 2 | envoyée, réponse attendue | à l'envoi |

Un tour de boucle :

1. **Envoyer.** S'il n'y a pas de réponse à rendre, elle parcourt les 10 fiches. Pour chaque session à l'état 1, elle prend le jeton du canal (s'il est pris, la requête attend un tour), note dans le canal quelle session attend, fait pointer le tampon de réception du canal sur le tampon de la session, passe la session à l'état 2 et appelle `pxi_send_message_alt_entry` (`0x101cc4`).
2. **Construire la liste d'attente.** Trois poignées fixes, puis les sessions à l'état 0 : une session dont la requête est en cours n'est plus écoutée.

   | Rang | Poignée | Ce qui se passe quand elle se lève |
   | --- | --- | --- |
   | 0 | l'évènement d'arrêt (`0x105004`) | toutes les sessions sont fermées, le fil se termine |
   | 1 | l'évènement de réveil (`0x11bb04`) | rien de plus : la boucle refait un tour (nouvelle session, ou canal libéré) |
   | 2 | le sémaphore des réponses (`0x11bb08`) | une réponse de Process9 est prête (partie 4, étape 9) |
   | 3 et plus | une session | une requête arrive (partie 4, étape 3) |

3. **Attendre.** `svcReplyAndReceive` rend la réponse à la session désignée (s'il y en a une) et attend. Quand il n'y a rien à rendre, l'en-tête `0xFFFF0000` est posé dans le tampon de message.
4. **Une session fermée.** Si le résultat est `0xC920181A`, la poignée est fermée et sa fiche libérée.

## Partie 4 : une requête pas à pas

L'exemple est celui de la fiche `fs` : `PXIFS_ReadFile`, en-tête `0x00090142`, envoyée par `fs` sur sa session `PxiFS0`. L'en-tête annonce 5 mots ordinaires et 2 mots à traduire : le message fait 8 mots.

**Du module à la file**

1. **`fs` envoie.** `svcSendSyncRequest` sur la session `PxiFS0`. `fs` est bloqué jusqu'à la réponse.
2. **Le noyau traduit.** Les mots 6 et 7 (`taille << 8 | 4`, puis l'adresse du tampon chez `fs`) sont un descripteur de type 4. D'après 3dbrew (page IPC), le noyau ne projette pas ce tampon chez `pxi` : il écrit dans un tampon statique du destinataire la liste des morceaux de mémoire physique qui composent le tampon (adresse physique, taille), et remplace l'adresse par l'adresse physique de cette liste. C'est ce qui permet à l'ARM9, qui ne connaît pas les adresses virtuelles de l'ARM11, de retrouver le tampon. Cette étape se passe dans le noyau : elle n'est pas lue ici.
3. **`pxi` reçoit.** `svcReplyAndReceive` revient avec le rang de la session. La fiche passe à l'état 1.
4. **Les tampons statiques.** Avant chaque attente, `session_manager_loop` a déclaré quatre tampons statiques d'une page (`0x1000` octets) dans le stockage local du fil (`+0x180`, descripteur `0x04000002` puis l'adresse). Les pages viennent d'une réserve de 20 pages, de `0x107000` à `0x11afff`, tenue par un masque de bits (`0x11bb1c`, `0xFFFFF` au départ) ; la page libre de plus haut rang est prise en premier. À la réception, la session garde autant de pages que le dit la table de la partie 2 (2 pour `PxiFS0`) et rend les autres tout de suite ; quatre pages neuves sont prises pour l'attente suivante. Une page épuisée est déclarée avec le descripteur `0x00000002`, de taille nulle.
5. **La copie.** Le message entier est recopié du stockage local (`+0x80`) vers le tampon de la session (`0x11b100 + rang × 0x100`) par `memcpy_words` (`0x102830`). La taille vient de l'en-tête : `(mots ordinaires + mots à traduire + 1) × 4`, et le programme s'arrête si elle dépasse `0x100` octets, soit `0x40` mots. `pxi` ne regarde ni ne modifie aucun des mots : les adresses physiques posées par le noyau partent telles quelles.
6. **L'envoi.** `pxi_send_message` (`0x101cc8`) :
   - prend le mutex d'envoi (`0x105010`), pour que deux fils ne mélangent pas leurs mots dans la file. Le fil des sessions attend en même temps l'évènement d'arrêt ; s'il se lève, l'envoi est abandonné avec `0xD92043FB` ;
   - `pxi_send_word` (`0x101fc4`) écrit le numéro du canal (1 pour `PxiFS0`) dans `PXI_SEND` (`0x1EC63008`), après avoir attendu que la file ne soit plus pleine (bit 1 de `PXI_CNT`, `0x1EC63004`) ;
   - `pxi_trigger_sync_irq` (`0x101c7c`) met à 1 le bit `0x40` de l'octet `0x1EC63003`, c'est-à-dire le bit 30 de `PXI_SYNC` : l'interruption part chez l'ARM9 ;
   - `pxi_send_words` (`0x101c48`) écrit les 8 mots du message dans `PXI_SEND`, en attendant devant chaque mot que la file ne soit plus pleine ;
   - rend le mutex (`svcReleaseMutex`).

   La session passe à l'état 2. Dans la file, Process9 lit donc : `1`, `0x00090142`, puis 7 mots.

**De la file au module**

7. **L'interruption.** Quand Process9 a écrit sa réponse, il déclenche l'interruption `0x50` de l'ARM11. Le noyau signale l'évènement `0x10500c`, que `pxi_receiver_loop` (`0x1012d4`) attend avec l'évènement d'arrêt.
8. **La lecture.** Tant que la file de réception n'est pas vide (bit 8 de `PXI_CNT`), `PxiDispatcher_receive_message` (`0x102a04`) :
   - lit un mot dans `PXI_RECV` (`0x1EC6300C`) par `pxi_recv_word` (`0x101fa8`) : c'est le numéro du canal. Hors de 0 à 9, erreur `0xD90043FA` ;
   - retrouve l'objet du canal dans la table à `0x11bca4`, vérifie qu'il n'est pas déjà occupé, le marque occupé ;
   - lit l'en-tête, vérifie que le message tient en `0x40` mots, lit le reste par `pxi_recv_words` (`0x102e14`) dans le tampon du canal, qui est celui de la session depuis l'étape 1 de la partie 3 ;
   - appelle la première méthode de l'objet. Pour les canaux 1 à 8 c'est `PxiChannel_on_reply` (`0x102f08`) : elle rend le jeton du canal, lève le drapeau « réponse prête » de la session, et relâche le sémaphore des réponses (`svcReleaseSemaphore`). Si le service accepte plusieurs sessions (`pxi:dev`), elle signale aussi l'évènement de réveil, pour qu'une requête en attente du jeton parte.
9. **Le retour.** Le fil des sessions se réveille au rang 2. Il cherche une session à l'état 2 dont le drapeau est levé, la repasse à l'état 0, rend ses pages à la réserve, recopie la réponse du tampon de la session vers le stockage local (`+0x80`) et refait un tour : `svcReplyAndReceive` rend la réponse à cette session. `fs` repart, avec le résultat au mot 1 et le nombre d'octets lus au mot 2.

Process9 a écrit les octets lus directement dans la mémoire de `fs`, par les adresses physiques de l'étape 2 : les données du fichier ne passent ni par `pxi` ni par la file, qui ne transporte que les 8 mots de la requête et les mots de la réponse.

## Partie 5 : le matériel, l'interruption et la poignée de main

**Les registres.** L'exheader donne à `pxi` la page `0x1EC63000`, qui est l'adresse virtuelle du matériel situé à `0x10163000`. Le code y touche quatre registres. Le sens des bits vient de 3dbrew (« PXI Registers ») ; les accès sont lus dans le code.

| Adresse | Registre | Largeur | Ce que `pxi` en fait |
| --- | --- | --- | --- |
| `0x1EC63000` | `PXI_SYNC` | 32 bits | remis à 0 par `pxi_hw_reset` |
| `0x1EC63000` | octet 0 | 8 bits | lu : la valeur que l'ARM9 a posée pour l'ARM11 |
| `0x1EC63001` | octet 1 | 8 bits | écrit : la valeur que l'ARM11 pose pour l'ARM9 (1, puis 2) |
| `0x1EC63003` | octet 3 | 8 bits | bit `0x80` (bit 31) : autoriser l'interruption `0x50` ; bit `0x40` (bit 30) : déclencher l'interruption chez l'ARM9 |
| `0x1EC63004` | `PXI_CNT` | 16 bits | bit 1 lu : file d'envoi pleine ; bit 8 lu : file de réception vide ; bit 2 et bit 10 : interruptions « envoi vide » et « réception non vide » ; bit 3 : vider la file d'envoi ; `0xC008` écrit à la remise à zéro (activer, acquitter l'erreur, vider) |
| `0x1EC63008` | `PXI_SEND` | 32 bits | écrit : un mot vers l'ARM9 |
| `0x1EC6300C` | `PXI_RECV` | 32 bits | lu : un mot venu de l'ARM9 |

Les fonctions qui y touchent, et elles seules : `pxi_hw_reset` (`0x10114c`) et sa copie `pxi_hw_reset_alt_1011a8` (`0x1011a8`, appelée par `pxi_hw_exit`), `pxi_send_fifo_is_full` (`0x101190`), `pxi_send_words` (`0x101c48`), `pxi_trigger_sync_irq` (`0x101c7c`), `pxi_recv_word` (`0x101fa8`), `pxi_send_word` (`0x101fc4`), `pxi_recv_fifo_is_empty` (`0x101fe0`), `pxi_unbind_interrupts` (`0x101ff8`), `pxi_bind_interrupts` (`0x1021a8`), `pxi_recv_words` (`0x102e14`) et `pxi_hw_init` (`0x100a8c`).

Les attentes sur la file (pleine à l'envoi, vide à la lecture) sont des boucles actives : le fil relit `PXI_CNT` sans s'endormir.

**Les interruptions.** `pxi_bind_interrupts` (`0x1021a8`) reçoit jusqu'à trois évènements et les attache par `svcBindInterrupt` :

| Numéro | Nom (3dbrew) | Réglage matériel associé | Usage |
| --- | --- | --- | --- |
| `0x50` | Sync | bit 31 de `PXI_SYNC` | en permanence : c'est elle qui réveille le fil récepteur |
| `0x52` | file d'envoi vide | bit 2 de `PXI_CNT` | seulement pendant le démarrage |
| `0x53` | file de réception non vide | bit 10 de `PXI_CNT` | seulement pendant le démarrage |

L'exheader autorise aussi `0x51`, que le code n'attache jamais. En écrivant dans `PXI_CNT`, le code masque toujours les bits 3 et 14, pour ne pas vider la file ni acquitter une erreur par accident.

**La remise à zéro.** `pxi_hw_reset` écrit 0 dans `PXI_SYNC`, demande le vidage de la file d'envoi (8 dans `PXI_CNT`), lit 16 fois `PXI_RECV` pour vider la file de réception, puis écrit 0 et `0xC008` dans `PXI_CNT`.

**La poignée de main**, dans `pxi_hw_init` (`0x100a8c`) :

1. Remise à zéro, puis création de l'évènement de l'interruption (`0x10500c`) et du mutex d'envoi (`0x105010`). L'évènement est attaché à l'interruption `0x50`.
2. Deux évènements provisoires sont attachés aux interruptions `0x53` et `0x52`.
3. `pxi` remplit la file d'envoi de mots nuls tant qu'elle n'est pas pleine. Quand elle l'est, il attend : si l'interruption « envoi vide » arrive, il remplit de nouveau ; si c'est « réception non vide », Process9 a répondu et la boucle s'arrête.
4. Les deux interruptions provisoires sont détachées.
5. `pxi` écrit 1 dans l'octet `0x1EC63001` et attend que l'octet `0x1EC63000` vaille au moins 1.
6. Il vide la file de réception.
7. Il écrit 2 et attend que l'octet lu vaille au moins 2. Les deux évènements provisoires sont fermés.

À partir de là, la règle est toujours la même dans les deux sens : celui qui parle écrit le numéro de canal, déclenche l'interruption de l'autre, puis écrit l'en-tête et les mots.

## Partie 6 : les trois commandes que pxi connaît

`pxi` relaie tout sans lire, à trois exceptions près.

| Canal | En-tête | Commande (3dbrew) | Sens | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | `0x00010040` | PublishToSubscriber | Process9 vers `pxi` | `pxi11_handle_command` | `0x103134` | `0x00010040` |
| 0 | `0x00010000` | ShutdownPxi | `pxi` vers Process9 | dans `pxi_main` | `0x1000ac` | non lu (toute réponse sur le canal 0 convient) |
| 0 | `0x00050040` | Sleep | un module vers Process9, surveillée au passage | dans `session_manager_loop` | `0x1013fc` | relayée telle quelle |

**Le canal 9 : Process9 appelle l'ARM11.** Quand un message arrive sur le canal 9, la première méthode de son objet (`PxiEndpoint_on_message_deferred`, `0x1031c4`) rend 0 : « pas ici ». `PxiDispatcher_receive_message` met alors l'objet dans la file du fil travailleur (`0x11bd98`) et le réveille. `pxi11_worker_loop` (`0x1011ec`) le sort de la file et appelle `pxi11_handle_command` :

- commande 1 : `pxi11_publish_notification` (`0x1030fc`) envoie à `srv:` la commande `SRV_PublishToSubscriber` (`0x103184`, en-tête `0x000C0080`) avec le numéro de notification reçu au mot 1 et le drapeau 1. La réponse est `0x00010040` avec le résultat au mot 1 ;
- toute autre commande : réponse `0x00000040` avec `0xD900182F`.

Le fil travailleur renvoie ensuite la réponse à Process9 par `pxi_send_message`, sur le canal 9. C'est par là que Process9 prévient l'ARM11 d'un évènement, par exemple une carte insérée (3dbrew). Ce détour par un autre fil évite que le fil récepteur reste bloqué dans un appel à `srv:`.

**La mise en veille (`pxi:mc`, commande 5).** À la réception d'une requête sur le canal 0 dont le numéro de commande est 5, `session_manager_loop` regarde l'octet du mot 1 :

- non nul : le drapeau `0x11bca0` passe à 1. Tant qu'il est levé, les requêtes ordinaires reçues restent à l'état 1 sans partir, et la commande 5 elle-même n'est envoyée que lorsque le compteur des requêtes ordinaires en cours (`0x11bb20`) est retombé à 0 ;
- nul : la commande part, et le drapeau retombe quand sa réponse revient. Les requêtes retenues partent alors.

Le code ne teste que le numéro de commande, 5, et cet octet ; l'en-tête complet `0x00050040` vient de 3dbrew. Le programme s'arrête si la veille est demandée deux fois, ou levée sans avoir été demandée.

**L'arrêt (`pxi:mc`, commande 1).** Quand la notification `0x100` a mis l'octet `0x106010` à 1, `pxi_main` :

1. met l'octet `0x105000` à 1 et envoie lui-même, sur le canal 0, un message d'un seul mot : `0x00010000` ;
2. attend l'évènement d'arrêt. C'est `PxiMcChannel_on_reply` (`0x103228`), la méthode du canal 0, qui le signale : quand l'octet `0x105000` est levé, la première réponse reçue sur le canal 0 signale l'évènement au lieu de réveiller une session ;
3. l'évènement reste levé : le fil des sessions ferme toutes les sessions et sort, le fil récepteur sort. `PxiDispatcher_stop` (`0x102330`) marque le répartiteur arrêté et réveille le fil travailleur, qui sort ;
4. attend la fin des trois fils, ferme le sémaphore et les neuf ports, quitte `srv:` (`srv_exit`, `0x1009f0`), puis `pxi_hw_exit` (`0x100d28`) détache l'interruption `0x50`, ferme le mutex et l'évènement, et remet le matériel à zéro.

## Partie 7 : les tables en mémoire

**Le gestionnaire de sessions, à `0x11bb00`**

| Adresse | Contenu |
| --- | --- |
| `0x11bb00` | l'adresse `0x105004`, où se trouve la poignée de l'évènement d'arrêt |
| `0x11bb04` | l'évènement de réveil |
| `0x11bb08` | le sémaphore des réponses (9 au plus) |
| `0x11bb0c` | le verrou du gestionnaire, 12 octets |
| `0x11bb18` | le début de la réserve de pages, `0x107000` |
| `0x11bb1c` | le masque des pages libres, 20 bits |
| `0x11bb20` | le nombre de requêtes ordinaires en cours chez Process9 |
| `0x11bb24` | 9 fiches de canal de 20 octets, rangées par numéro de canal |
| `0x11bbd8` | 10 fiches de session de 20 octets |
| `0x11bca0` | le drapeau de mise en veille |

| Fiche de canal | Contenu |
| --- | --- |
| `+0x00` | l'objet du canal |
| `+0x04` | le jeton : 1 si le canal est libre, 0 si une requête est en cours |
| `+0x08`, `+0x0A` | deux nombres de 16 bits, 0 et 1 au départ ; le second est le maximum du jeton |
| `+0x0C` | la fiche de la session dont la requête est en cours |
| `+0x10` | le nombre de sessions permises |

| Fiche de session | Contenu |
| --- | --- |
| `+0x00` | son tampon de message, `0x100` octets (`0x11b100 + rang × 0x100`) |
| `+0x04` | la poignée de la session, 0 si la fiche est libre |
| `+0x08` à `+0x0B` | les numéros des pages gardées pour la requête en cours, `0xFF` pour « aucune » |
| `+0x0C` | le numéro du canal |
| `+0x0D` | l'état : 0, 1 ou 2 (partie 3) |
| `+0x0E` | le genre de la requête : 0 ordinaire, 1 demande de veille, 2 fin de veille |
| `+0x0F` | le nombre de pages gardées par requête (table de la partie 2) |
| `+0x10` | le drapeau « réponse prête » |

**Le répartiteur et les objets de canal**

| Adresse | Contenu |
| --- | --- |
| `0x11bca4` | 10 pointeurs : l'objet de chaque canal, de 0 à 9 |
| `0x11bccc` | le répartiteur : l'adresse de cette table, le nombre 10, un octet « arrêté », un verrou |
| `0x11bce4` à `0x11bd97` | les objets des canaux 0 à 8, 20 octets chacun |
| `0x11bd98` | la file du fil travailleur : le répartiteur, la tête et la queue de la file, deux verrous, un signal |
| `0x11bdc4` | l'objet du canal 9, 28 octets |
| `0x11b000` | le tampon de message du canal 9 |

| Objet de canal | Contenu |
| --- | --- |
| `+0x00` | sa table de méthodes |
| `+0x04` | le chaînon pour la file du fil travailleur |
| `+0x08` | la file où le ranger (`0x11bd98` pour le canal 9, 0 pour les autres) |
| `+0x0C` | le tampon où écrire le prochain message reçu |
| `+0x10` | « occupé » : un message est en cours de traitement |
| `+0x11` | le numéro du canal |
| `+0x14`, `+0x18` | canal 9 seulement : la fonction à appeler (`pxi11_handle_command`) et son argument |

| Table de méthodes | Pour | `+0x00` à la réception | `+0x04` sur le fil travailleur |
| --- | --- | --- | --- |
| `0x104120` | canaux 1 à 8 | `PxiChannel_on_reply` (`0x102f08`) | arrêt du programme (`0x102f88`) |
| `0x10413c` | canal 0 | `PxiMcChannel_on_reply` (`0x103228`) | arrêt du programme (`0x102f88`) |
| `0x1040c4` | canal 9 | `PxiEndpoint_on_message_deferred` (`0x1031c4`) | `Pxi11Channel_run_handler` (`0x1032fc`) |
| `0x104158` | la classe de base, remplacée pendant la construction | la même, `0x1031c4` | `__cxa_pure_virtual` (`0x1000a2`, Thumb), qui appelle `pure_virtual_report_stub` (`0x100096`), lequel appelle la fonction vide `0x103318` |

**Les autres adresses**

| Adresse | Contenu |
| --- | --- |
| `0x105000` | octet : l'ordre d'arrêt a été envoyé à Process9 |
| `0x105004` | l'évènement d'arrêt |
| `0x10500c` | l'évènement attaché à l'interruption `0x50` |
| `0x105010` | le mutex d'envoi |
| `0x10502c` et `0x105030` | le compteur d'utilisateurs de `srv:` et la session vers `srv:` |
| `0x105038` | l'arbitre d'adresses, sur lequel reposent les verrous légers |
| `0x106000` | l'objet inscrit pour la notification `0x100` ; son octet `+0x10` (`0x106010`) arrête la boucle principale |
| `0x107000` à `0x11afff` | la réserve de 20 pages pour les tampons statiques |
| `0x11b100` à `0x11baff` | les 10 tampons de message des sessions |
| `0x11e1f8` | la liste des objets inscrits pour une notification |

## Partie 8 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x1027dc` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x102768` |
| CreateThread | `0x08` | `svcCreateThread` | `0x100ebc` |
| ExitThread | `0x09` | `svcExitThread` | `0x102c28` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x102824` |
| CreateMutex | `0x13` | `svcCreateMutex` | `0x100ea4` |
| ReleaseMutex | `0x14` | écrit sur place, deux fois, dans `pxi_send_message` | `0x101cc8` |
| CreateSemaphore | `0x15` | `svcCreateSemaphore` | `0x102e48` |
| ReleaseSemaphore | `0x16` | `svcReleaseSemaphore` | `0x101bb8` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x102728` |
| SignalEvent | `0x18` | écrit sur place, à quatre endroits : `pxi_main`, `PxiChannel_on_reply`, `PxiMcChannel_on_reply` (deux fois) | |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x1027c4` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x101cac` |
| CloseHandle | `0x23` | écrit sur place, à 24 endroits | |
| WaitSynchronization1 | `0x24` | écrit sur place, à 11 endroits | |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x102418` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x102e60` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x102c30` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x100e8c` |
| SendSyncRequest | `0x32` | écrit sur place dans les cinq fonctions `SRV_` | |
| Break | `0x3C` | `svcBreak` | `0x102bdc` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x100770` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x10280c` |
| BindInterrupt | `0x50` | `svcBindInterrupt` | `0x102bcc` |
| UnbindInterrupt | `0x51` | `svcUnbindInterrupt` | `0x102c4c` |

25 numéros, 66 endroits. `svcBindInterrupt` et `svcUnbindInterrupt` reçoivent l'adresse de la poignée et la lisent eux-mêmes avant l'appel (`ldr r1, [r1]`) : le pseudo-code ne le montre pas.

`pxi` n'utilise ni `ControlMemory` ni mémoire partagée : toute sa mémoire est dans son image, y compris les piles des fils et la réserve de pages.

## Partie 9 : les commandes envoyées à srv:

| En-tête | Commande | Fonction | Adresse | Appelée par |
| --- | --- | --- | --- | --- |
| `0x00010002` | RegisterClient | `SRV_RegisterClient` | `0x10108c` | `srv_init` |
| `0x00020000` | EnableNotification | `SRV_EnableNotification` | `0x1010c8` | `get_notification_semaphore` |
| `0x00030100` | RegisterService | `SRV_RegisterService` | `0x100994` | `pxi_main`, neuf fois |
| `0x000B0000` | ReceiveNotification | `SRV_ReceiveNotification` | `0x101104` | `handle_srv_notification` |
| `0x000C0080` | PublishToSubscriber | `SRV_PublishToSubscriber` | `0x103184` | `pxi11_publish_notification` |

`srv_init` (`0x10253c`) se connecte au port `srv:` par `svcConnectToPort` ; si le port n'existe pas encore, elle attend 500 000 nanosecondes et recommence.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les neuf noms de service et leurs numéros de canal : la table lue dans `code.bin` à `0x104044`, et la page « PXI Services » de 3dbrew (0 pour `pxi:mc`, 1 à 4 pour les `PxiFS`, 5, 6, 7, 8, et 9 pour le sens inverse). 3dbrew ne donne pas le détail de 1 à 4 : il vient de la table seule.
- L'adresse des registres : les constantes `0x1EC63000` du code, et l'exheader qui ne donne à `pxi` que cette page d'entrées-sorties. Le sens des bits que le code teste (plein, vide, déclencher, autoriser) colle à la page « PXI Registers » de 3dbrew.
- Les interruptions `0x50`, `0x52` et `0x53` : les constantes passées à `svcBindInterrupt`, la liste de l'exheader (`0x50` à `0x53`), et les noms de 3dbrew.
- L'ordre des mots dans la file (canal, en-tête, mots) et la limite de `0x40` mots : lus dans `pxi_send_message` et `PxiDispatcher_receive_message`, et donnés par 3dbrew.
- Le canal 9 : la commande 1, l'appel à `SRV_PublishToSubscriber` avec le drapeau 1 et la réponse `0x00010040` sont lus dans le code et décrits par 3dbrew.
- Les commandes 1 et 5 de `pxi:mc` : le message `0x00010000` envoyé après la notification `0x100` et le blocage des autres requêtes sur un argument non nul sont lus dans le code ; 3dbrew les nomme ShutdownPxi et Sleep avec les mêmes effets.
- La priorité `0x2D` des trois fils : la constante `0x6C8DA52D` décodée par `create_thread`, et la priorité 45 du fil principal dans l'exheader.
- Qui appelle quoi : `svcReplyAndReceive` n'est appelée que par `session_manager_loop`, `pxi_bind_interrupts` que par `pxi_hw_init`, `PxiDispatcher_receive_message` que par `pxi_receiver_loop`, `pxi_trigger_sync_irq` que par `pxi_send_message`. Vu par REA et recompté dans l'assembleur.
- La réserve de 20 pages : le masque `0xFFFFF`, et le calcul `0x107000 + 20 × 0x1000 = 0x11b000`, qui tombe juste sur le tampon du canal 9.
- Les 25 appels système utilisés font tous partie des 67 que l'exheader autorise.

**Interprété à la lecture, à relire dans Ghidra**
- Les noms donnés aux états d'une session, au « genre » d'une requête et au « jeton » d'un canal. Les valeurs et leurs tests sont lus ; les mots sont les miens.
- Les noms de classes (`PxiEndpoint`, `PxiChannel`, `PxiMcChannel`, `Pxi11Channel`, `PxiDispatcher`) : le code ne porte aucun nom.
- La traduction du tampon par le noyau (partie 4, étape 2) vient de 3dbrew seulement. Ce qui est lu dans `pxi` : il déclare quatre tampons statiques d'une page et ne touche à aucun mot du message.
- Le rôle des verrous légers (`lock_arbitrate_wait` `0x102d30`, `gate_wait` `0x1028a4`, `light_semaphore_release` `0x101bd0`) : reconnus à leur forme (un compteur modifié par `ldrex`/`strex`, puis `svcArbitrateAddress`), pas suivis cas par cas.
- La taille des piles : seuls les sommets sont lus. Si les piles se suivent dans la mémoire, celle du fil récepteur fait `0x400` octets et les deux autres `0x1000`.
- `panic_on_failure` (`0x1026b8`) : elle lit l'octet `0x1FF80014` de la mémoire de configuration et le niveau du code d'erreur pour décider d'arrêter le programme ; les cas exacts ne sont pas démêlés.
- Un point à relire dans la partie 3 : hors veille, le compteur `0x11bb20` est augmenté avant la prise du jeton. Si le jeton est pris (possible seulement pour `pxi:dev`, qui accepte deux sessions), la requête attend un tour et le compteur serait augmenté une seconde fois.
- 3dbrew dit qu'un service PXI n'a qu'une session à la fois ; la table donne 2 pour `pxi:dev`. Le chiffre de la table est lu, et il est aussi celui passé à `SRV_RegisterService`.

**Pas lu**
- Le côté Process9 : ce qu'il fait d'une requête, et comment il écrit sa réponse.
- Le côté noyau : la traduction des descripteurs de type 4 et 6, et le lien entre le bit 29 de `PXI_SYNC` côté ARM9 et l'interruption `0x50`.
- Qui ouvre `pxi:dev`.
- La bibliothèque C et le démarrage : `0x10071c`, `0x100ddc`, `0x100e24` (tables de caractères), `0x100fd8`, `0x100ffc`, `0x101064` (bornes de mémoire, `svcQueryMemory`), `0x1029b0` et `0x102fc4` (cases du stockage local).
- Les destructeurs d'objets globaux (`0x102eac`, `0x102ff8`, `0x103054`, `0x10307c`, `0x1030a4`, `0x103200`), qui ne servent qu'à l'arrêt.
- Une table de 10 poignées à `0x11e408` : elle est mise à zéro au démarrage et fermée à l'arrêt, mais aucune fonction lue n'y écrit.
- 45 fonctions n'ont qu'un nom proposé en moyenne, dont la plupart ne font qu'un `bx lr`.

## Comment cette fiche a été faite

| Étape | Qui |
| --- | --- |
| Repérer les appels système, nommer leurs enveloppes, trouver les fonctions manquées | `prescan.py`, deux passages (111 fonctions, puis 145) |
| Sortir le pseudo-code et l'assembleur | `prescan.py --dump` |
| Lire les tables de `.rodata` (services, méthodes, constructeurs) et l'exheader | des scripts Python sur `code.bin` et `exheader.bin` |
| Lire `pxi_main`, `session_manager_loop` et tout le chemin d'envoi et de réception | Claude, dans l'assembleur surtout |
| Nommer et recharger | `pxi.noms.tsv`, un dernier passage (151 fonctions) |
| Recouper | REA (`procedure_callers`), l'exheader, et cinq pages de 3dbrew lues en ligne le 13 octobre 2026 (PXI Registers, PXI Services, IPC, Development Services PXI, ARM11 Interrupts), par un outil qui en rend un résumé et non le texte exact |

**Les pièges rencontrés**

- **Deux boucles cachées.** `worker_thread_entry` et `receiver_thread_entry` ne font que charger un argument et sauter (`b`, sans retour) vers la vraie boucle. Ghidra avait rangé `0x1011ec` et `0x1012d4` dans le corps des deux points d'entrée, et le pseudo-code était illisible. Deux graines `function` les ont séparées. `prescan.py` ne les signale pas : pour lui, elles étaient déjà « dans une fonction ».
- **Une fausse enveloppe.** `prescan.py` avait nommé `0x103184` `svcSendSyncRequest`, parce que c'est une fonction courte avec un seul `svc`. C'est en fait `SRV_PublishToSubscriber` : elle remplit un message avant l'appel. Dans ce module, `svc 0x32` n'a pas d'enveloppe du tout. Le nom est corrigé dans `pxi.noms.tsv`.
- **Des entrées doubles.** Trois fonctions ont un `nop` devant elles et sont appelées par les deux adresses : `pxi_send_message` (`0x101cc4` et `0x101cc8`), `abort` (`0x102660`, un `mov r0,r0` appelé seulement par `panic_on_failure`, en `0x1026fc` et `0x102710`), qui tombe dans `break_process` (`0x102664`), `init_runtime_and_srv` (`0x10252c`, qui fait d'abord l'initialisation de la bibliothèque, et `0x10253c`). Ghidra en fait deux fonctions à chaque fois.
- **Le Thumb.** Cinq fonctions : `run_static_initializers` (`0x100048`), `destroy_array` (`0x100074`), `pure_virtual_report_stub` (`0x100096`), `__cxa_pure_virtual` (`0x1000a2`) et `construct_array` (`0x102740`), nommées par des lignes `label`, et les noms ont pris. Le pointeur impair signalé par `prescan.py` est `0x1000a3`, dans la table de méthodes de base (`0x104158`).
- **Les sections serrées.** Dans `code.asm`, tout est désassemblé comme du code et seul `.text` est à la bonne adresse. Les tables de `.rodata` (à partir de `0x104000` en mémoire) sont à la position `0x3844` de `code.bin` : elles ont été lues par script.
- **La Carte des services** n'a pas de tableau de commandes pour les services de `pxi`, ni les descripteurs de type 4 et 6. Les pages de 3dbrew ont été lues directement.

**Pour reprendre.** Relancer le pont avec `REA_GHIDRA_SEED_FILE` sur `fiches/pxi.noms.tsv`, puis `prescan.py pxi --dump`. Le pseudo-code brut est dans `local/analyse/pxi/pseudo/`, l'assembleur dans `local/analyse/pxi/code.asm`, non versionnés. Le script qui pose les noms est `local/analyse/pxi/scripts/apply_names.py`. Les sources du `pxi` de Luma sont publiques : elles n'ont pas été consultées pour cette fiche, et seraient une troisième voie pour vérifier les parties 3 à 6.
