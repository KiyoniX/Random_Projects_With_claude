# ndm, le gestionnaire des démons réseau

`ndm` décide quand les tâches réseau de fond de la console (StreetPass, SpotPass, mises à jour, liste d'amis) ont le droit de tourner. Il tient un état « exclusif » (infrastructure, communication locale, StreetPass) qui fait taire les démons incompatibles, un compteur de suspension par démon et par client, un ordonnanceur qui relance les démons à intervalle régulier, et une machine à états du Wi-Fi qu'il pilote par `ac:u`. Un jeu ne lui parle que par un seul service, `ndm:u`, et surtout pour dire « je vais utiliser le Wi-Fi, laissez-moi la place » avant de se connecter, puis « j'ai fini » après.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, le module est presque entièrement en Thumb), `emulate_dispatch.py` et un désassemblage de capstone. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002B02`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `ndm`, priorité 48 (`0x30`) |
| Fichier lu | `local/extrait/ndm/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x9C40` octets de code (10 pages), `0xDAC` de données en lecture seule, `0x404` de données, `0x3804` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 880 pour Ghidra, dont 812 en Thumb et 68 en ARM ; 223 nommées dans `ndm.noms.tsv` |
| Service offert | `ndm:u` seul, 24 commandes, 6 sessions au plus |
| Services appelés | lus dans l'exheader : `ac:u`, `ptm:s`, `nwm::EXT`, `nim:ndm`, `ndm:u`, `cecd:ndm`, `frd:n`, `boss:M` ; lus dans le code : les mêmes huit, plus `srv:` (port) et `err:f` (port) |
| Dépendances déclarées | sept titres : `ac` (`…2402`), `cecd` (`…2602`), `nim` (`…2C02`), `nwm` (`…2D02`), `ptm` (`…2202`), `friends` (`…3202`), `boss` (`…3402`) ; les noms viennent de la liste des titres système de 3dbrew |
| Fils | six : le fil principal, trois fils de travail qui exécutent les commandes, et deux fils lancés par les composants (la machine à états du Wi-Fi et l'ordonnanceur) |

Une particularité : `ndm` est client de son propre service. L'exheader autorise `ndm:u` parmi les services qu'il peut ouvrir, et le code l'ouvre (`ndmu_client_open`, `0x105f94`) pour envoyer EnterExclusiveState et LeaveExclusiveState à lui-même. La raison est visible dans `ac_connect` (`0x102d70`) : c'est la même suite d'appels que la fonction de connexion Wi-Fi de la bibliothèque du système que Pokémon X contient aussi (partie 7). `ndm` embarque donc les bibliothèques clientes `ac` et `ndm` du système, et s'en sert telles quelles.

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle neuf fonctions à la suite, puis `svcExitProcess` (`0x10918c`) :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de `0x10b404` à `0x10ec08`.
2. `0x100088` : met à jour deux champs de l'en-tête des arguments du programme (interprété, par comparaison avec `ac`). Non nommée, pas lue plus loin.
3. `0x100104` : appelle deux fonctions (`0x100110` et `srv_init`, `0x105dcc`), celles-ci préparent des verrous puis ouvrent `srv:` ; voir la partie 2.
4. `setup_heap` (`0x1000d0`) : à la première fois, pose la taille du tas à `0x9000` (valeur gardée à `0x10b2ac`), appelle `init_heap` (`0x10012c`) puis un pool de `0x4000` octets (`0x1002ac`). `set_heap_size` (`0x1003a8`) refuse une taille qui n'est pas un multiple de la page (résultat `0xE0E01BF2`) et appelle `svcControlMemory` (`0x1092d0`) : opération 3 (réservation) en lecture et écriture à partir de `0x08000000 +` taille courante pour grandir, opération 1 (libération) pour rétrécir.
5. `run_init_array_relative` (`0x102b84`) : une table de distances relatives (la même astuce que dans `hid`), appelée pour les constructeurs globaux.
6. `run_init_array` (`0x10006c`) : la table de pointeurs de `0x10adac`, vide ou presque.
7. `0x1000c0` : `srv_init` encore, avec arrêt du processus si le résultat est négatif.
8. `ndm_main` (`0x100048`, Thumb) : tout le reste.
9. `svcExitProcess`.

`ndm_main` fait cinq choses : une initialisation gardée (`0x100150`), `server_register_service` (`0x100358`) qui enregistre `ndm:u` auprès de `sm`, un appel (`0x105e14`), `server_run` (`0x100170`, 272 octets) qui fait tourner le serveur, puis `0x1002cc` qui le démonte.

`server_register_service` lit le descripteur du service (`build_ndm_service_descriptor`, `0x108b6c` le construit : la chaîne `ndm:u` est copiée dedans) et appelle `register_service_by_name` (`0x1007e0`) : longueur du nom par `strlen` (`0x105878`), puis `SRV_RegisterService` (`0x100fb4`, en-tête `0x00030100`) avec un nombre de sessions qui vaut 6 (l'octet `+0x11` du descripteur est nul, et le code ajoute 5 puis 1 s'il est nul ; lu dans l'assembleur de `0x100358`).

`server_run` construit sur sa pile le paquet de composants (`init_components`, `0x100518`, appelle leurs démarreurs) :

| Composant | Constructeur | Adresse | Pointeur global | Ce qu'il est |
| --- | --- | --- | --- | --- |
| Machine à états du Wi-Fi | `network_machine_ctor` | `0x1005d0` | `0x10b3e4` | l'état courant (`+0x1C`) et l'état visé (`+0x1D`) rendus par GetCurrentState et GetTargetState ; elle a son fil (`network_machine_start`, `0x100b80`) |
| Ordonnanceur | `scheduler_ctor` | `0x100580` | `0x10b400` | le compteur de suspension de l'ordonnanceur (`+0x40`), l'intervalle de relance (`+0x58`), l'intervalle de nouvel essai (`+0x44`) ; il a son fil (`scheduler_start`, `0x100b00`) |
| Machine à états exclusifs | `exclusive_state_ctor` | `0x100768` | `0x10b3f4` | l'état exclusif courant (`+4`) et visé (`+5`) ; pas de fil à elle |
| Gestionnaire des démons | `0x1013a4`, `0x100c6c` | | `0x10b3e0` | les quatre démons et le masque par défaut (`+4`) |
| Concentrateur de notifications | `0x1006c0` | | `0x10b3f0` | les gestionnaires inscrits auprès de `sm`, un drapeau « endormi » (`+0xBD`) |

Puis `server_run` lance les trois fils de travail (boucle de trois tours, `create_thread` à `0x101218`, pile de `0x800` octets chacune), enregistre les gestionnaires de notifications (`register_notification_handlers`, `0x100ca8`), se met à servir (`server_notification_loop`, `0x1004e0`), et à la sortie démonte les composants (`shutdown_components`, `0x100554`).

Tous les fils passent par `create_thread_impl` (`0x1018e0`), la seule fonction qui appelle `svcCreateThread` (`0x1093dc`), et commencent dans `thread_trampoline` (`0x101e22`), qui appelle la fonction du fil puis `svcExitThread`. Le point d'entrée de chaque fil des composants est la méthode virtuelle `+0x10` de leur objet : pas suivie plus loin.

## Partie 2 : la boucle de serveur

C'est un serveur à fils de travail, pas un fil par client comme `hid`. Le fil principal ne fait que recevoir ; les trois fils de travail exécutent les commandes.

**Le fil principal.** `server_notification_loop` (`0x1004e0`) appelle `server_main_loop` (`0x105bec`) en lui donnant le sémaphore des notifications de `srv:` (celui qu'a rendu `SRV_EnableNotification`) comme poignée supplémentaire, et à chaque réveil `0x100e18`, qui lit les notifications (`handle_srv_notification`, `0x1014d4`). La première fois, `0x100e18` appelle d'abord `0x1056b4`, qui ouvre `nwm::EXT` (`nwm_ext_open`, `0x101bc8`) et `ptm:s` (`ptm_s_open`, `0x101c10`), et lève l'octet `+0xBC` du concentrateur. `server_main_loop` rassemble les poignées (un sémaphore de fin de travail en rang 0, puis les sessions ouvertes, puis les poignées supplémentaires : le sémaphore des notifications de `srv:` et le port d'écoute) et appelle `server_receive_loop` (`0x101598`), la seule fonction qui appelle `svcReplyAndReceive` pour recevoir (`0x109394`). Les cas, lus dans le pseudo-code de `0x101598` et `0x105bec` :

- rang 0, le sémaphore de fin de travail (`svcReleaseSemaphore`, `0x10937c`, libéré par `0x105b70` quand un fil de travail a terminé) : le fil principal remet dans sa liste de poignées attendues (`0x1053f0`) les sessions dont la tâche est terminée. Une session n'est donc attendue que pendant qu'aucun fil de travail ne s'en occupe ;
- le port d'écoute : `server_main_loop` appelle `accept_session` (`0x101206`, qui fait `svcAcceptSession`, `0x1093ac`, dans la fonction `0x10187e`), puis la méthode virtuelle `+0` du descripteur du port (`ndmu_session_create`, `0x109170`, qui fabrique l'objet de session de `0x20` octets avec `ndmu_session_ctor`, `0x106e84`), et inscrit la nouvelle session dans la liste des poignées ;
- une session avec une requête : la session est retirée de la liste (`0x10521a`), la méthode virtuelle `+0xC` de l'objet est appelée avec le tampon du fil ; si elle rend -1 la requête est exécutée tout de suite par le fil principal (`handle_request_and_reply`), sinon son résultat est un numéro de file de travail. Pour `ndm:u` c'est `ndmu_session_queue_index` (`0x108908`), qui rend toujours 0 : toute requête va dans la file 0, et `server_receive_loop` recopie les `0x100` octets du tampon dans une tâche placée dans la file ;
- une session fermée (résultat négatif de `svcReplyAndReceive`) : `0x105448` ferme la poignée (`svcCloseHandle`) et détruit l'objet par sa méthode `+4` (`ndmu_session_destroy_and_free`, `0x106ea8`, qui appelle `ndmu_session_destroy`, `0x106eb4`, partie 6).

**Les fils de travail.** `worker_thread_main` (`0x1009a0`) cherche lequel des trois il est (il compare l'identifiant de son fil, `svcGetThreadId`, `0x10930c`, avec ceux de la liste) puis appelle `worker_loop` (`0x10110c`). Celle-ci prend une tâche dans sa file (`0x105b0e`), recopie la requête dans le tampon de son propre fil, et appelle `handle_request_and_reply` (`0x105484`) : la méthode virtuelle `+8` de la session, qui est `ndmu_session_handle_request` (`0x106e50`, 8 octets), qui saute à l'aiguillage `ndmu_handle_command` (`0x1075e4`). Puis `handle_request_and_reply` envoie la réponse par un second `svcReplyAndReceive` sans aucune poignée à attendre (`0x109394`, appelé de `0x10549a`).

Résumé : la même fonction du système (`svcReplyAndReceive`) est appelée à deux endroits (`0x10164a` pour recevoir, `0x10549a` pour répondre), et l'aiguillage n'a qu'un appelant (`ndmu_session_handle_request`, relevé dans la table des références de Ghidra).

**L'aiguillage.** `ndmu_handle_command` lit l'en-tête dans le tampon du fil (`get_tls`, `0x105abc`, puis `+0x80`), prend le numéro dans les 16 bits du haut, et saute par une table d'octets (`0x1075fd`) à 25 cas. Cinq commandes vérifient l'en-tête en entier (1, 2, 4, 5 et 0x18, partie 3) ; les autres ne regardent que le numéro. Un en-tête qui ne va pas rend l'en-tête de réponse `0x00000040` et le résultat `0xD9001830` ; un numéro inconnu rend `0x00000040` et `0xD900182F`.

**Les notifications de `sm`.** `register_notification_handlers` (`0x100ca8`) inscrit onze gestionnaires par `register_notification_handler` (`0x105658`) et s'abonne aux onze numéros par `subscribe_notification` (`0x105650`, qui envoie `SRV_Subscribe`) :

| Numéro | Ce qui est connu ailleurs | Gestionnaire |
| --- | --- | --- |
| `0x100` | arrêt du système (voir `hid`, `ptm`) | un gestionnaire à `+0xA8` de l'objet, pas lu |
| `0x104` | entrée en veille | `on_sleep_wake_notification` (`0x107520`) |
| `0x105` | réveil | le même |
| `0x107` | non identifié | le même (appelle `0x10499c`, qui lève un drapeau sur la machine du Wi-Fi) |
| `0x213` | couvercle ouvert (d'après `hid`) | pas lu |
| `0x214` | couvercle fermé (d'après `hid`) | pas lu |
| `0x300` et `0x301` | non identifiés | `on_notification_300_301` (`0x10742c`) |
| `0x302`, `0x303`, `0x304` | non identifiés | pas lus |

Ce que fait `on_sleep_wake_notification` pour `0x104` (lu dans le pseudo-code) : lever le drapeau « endormi » du concentrateur (`+0xBD`), suspendre l'ordonnanceur (`0x1074fc`), poser un drapeau (`0x10b298` + 1 et + 2), demander à la machine du Wi-Fi l'événement 9, puis dire à `ptm` que `ndm` est prêt (`PTMS_NotifySleepPreparationComplete`, `0x108284`, appelé de `0x108236`). Pour `0x105` : l'inverse (drapeau baissé, ordonnanceur relancé, démons remis en route).

## Partie 3 : les commandes de `ndm:u`

Les noms et les en-têtes de requête viennent de 3dbrew ; la fonction, l'adresse, l'en-tête de réponse et ce que le code vérifie sont lus dans le code et recoupés par `emulate_dispatch.py` (voir « Ce qui est sûr »). La colonne « Vérifié » dit si l'aiguillage compare tout l'en-tête (« entier ») ou seulement le numéro. Tous les en-têtes de réponse portent le résultat au mot 1.

| N° | En-tête de requête | Commande | Fonction | Adresse | Vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010042` | EnterExclusiveState | `ndmu_0001_EnterExclusiveState` | `0x106cbc` | entier | `0x00010040` |
| 2 | `0x00020002` | LeaveExclusiveState | `ndmu_0002_LeaveExclusiveState` | `0x1044e0` | entier | `0x00020040` |
| 3 | `0x00030000` | QueryExclusiveMode | `ndmu_0003_QueryExclusiveMode` | `0x106cac` | numéro | `0x00030080` |
| 4 | `0x00040002` | LockState | `ndmu_0004_LockState` | `0x106e58` | entier | `0x00040040` |
| 5 | `0x00050002` | UnlockState | `ndmu_0005_UnlockState` | `0x106a3c` | entier | `0x00050040` |
| 6 | `0x00060040` | SuspendDaemons | `ndmu_0006_SuspendDaemons` | `0x106b20` | numéro | `0x00060040` |
| 7 | `0x00070040` | ResumeDaemons | `ndmu_0007_ResumeDaemons` | `0x106a68` | numéro | `0x00070040` |
| 8 | `0x00080040` | SuspendScheduler | `ndmu_0008_SuspendScheduler` | `0x106c20` | numéro | `0x00080040` |
| 9 | `0x00090000` | ResumeScheduler | `ndmu_0009_ResumeScheduler` | `0x104490` | numéro | `0x00090040` |
| 10 | `0x000A0000` | GetCurrentState | `ndmu_000A_GetCurrentState` | `0x106bc8` | numéro | `0x000A0080` |
| 11 | `0x000B0000` | GetTargetState | `ndmu_000B_GetTargetState` | `0x106b10` | numéro | `0x000B0080` |
| 12 | `0x000C0000` | non implémentée (3dbrew) | `ndmu_000C_NotImplemented` | `0x106cec` | numéro | `0x000C0042` |
| 13 | `0x000D0040` | QueryStatus | `ndmu_000D_QueryStatus` | `0x106a14` | numéro | `0x000D0080` |
| 14 | `0x000E0040` | GetDaemonDisableCount | `ndmu_000E_GetDaemonDisableCount` | `0x106cf4` | numéro | `0x000E00C0` |
| 15 | `0x000F0000` | GetSchedulerDisableCount | `ndmu_000F_GetSchedulerDisableCount` | `0x106df4` | numéro | `0x000F00C0` |
| 16 | `0x00100040` | SetScanInterval | `ndmu_0010_SetScanInterval` | `0x106be8` | numéro | `0x00100040` |
| 17 | `0x00110000` | GetScanInterval | `ndmu_0011_GetScanInterval` | `0x106bd8` | numéro | `0x00110080` |
| 18 | `0x00120040` | SetRetryInterval | `ndmu_0012_SetRetryInterval` | `0x106c0c` | numéro | `0x00120040` |
| 19 | `0x00130000` | GetRetryInterval | `ndmu_0013_GetRetryInterval` | `0x106bfc` | numéro | `0x00130080` |
| 20 | `0x00140040` | OverrideDefaultDaemons | `ndmu_0014_OverrideDefaultDaemons` | `0x106d44` | numéro | `0x00140040` |
| 21 | `0x00150000` | ResetDefaultDaemons | `ndmu_0015_ResetDefaultDaemons` | `0x106cd4` | numéro | `0x00150040` |
| 22 | `0x00160000` | GetDefaultDaemons | `ndmu_0016_GetDefaultDaemons` | `0x10887c` | numéro | `0x00160080` |
| 23 | `0x00170000` | ClearHalfAwakeMacFilter | `ndmu_0017_ClearHalfAwakeMacFilter` | `0x106d9c` | numéro | `0x00170040` |
| 24 | `0x00180004` (absent de 3dbrew) | sans nom | `ndmu_0018` | `0x106e20` | entier | `0x00180040` |

Le dernier numéro de 3dbrew est `0x17` : la commande 24 (`0x18`) n'y est pas.

Ce que fait chaque commande, lu dans le code (les trois adresses de la table de la partie 6 entre parenthèses) :

| N° | Ce que le code vérifie et fait | Résultat en cas d'échec |
| --- | --- | --- |
| 1 | Le mot 2 est le descripteur `0x20` (numéro du processus appelant, que le noyau écrit). L'état demandé est l'octet bas du mot 1. L'état 0 est refusé. Sinon `exclusive_state_request` (partie 4) | `0xD8E06BED` (état 0) ; autres, voir la partie 4 |
| 2 | Même chose avec l'état visé 0 | |
| 3 | Rend l'octet `+4` de la machine à états exclusifs, c'est-à-dire l'état exclusif courant | |
| 4 | `lock_acquire` (`0x106034`) : prend le verrou global de `0x10b290` (propriétaire, compteur) ; il est récursif pour un même processus | `0xC8A0680A` si un autre processus le tient |
| 5 | `lock_release` (`0x105ff0`) | `0xC8A0680B` si le verrou n'est pas pris ; `0xC8A0680A` si c'est un autre processus qui le tient |
| 6 | Le masque est de 1 à 15 ; pour chaque bit, le compteur de la session doit être inférieur à 100. Partie 5 | `0xD8E06BED` (masque), `0xC8A0680E` (compteur à 100) |
| 7 | Même masque ; pour chaque bit le compteur de la session doit être au moins 1. Partie 5 | `0xD8E06BED`, `0xC8A0680D` |
| 8 | Un octet. Compteur de la session limité à 100 ; au premier, tous les démons sont suspendus et l'ordonnanceur arrêté, puis, si la console n'est pas endormie, la machine du Wi-Fi reçoit l'événement 1 (octet nul) ou une variante (octet non nul) | `0xC8A0680E` |
| 9 | Compteur de la session moins un ; à zéro, les démons sont relancés et l'ordonnanceur aussi | `0xC8A0680D` si le compteur est déjà nul |
| 10 | Rend l'octet `+0x1C` de la machine du Wi-Fi | |
| 11 | Rend l'octet `+0x1D` | |
| 12 | Rend un résultat constant | `0xE0C06BF4`, et le mot 3 de la réponse, qui est une poignée, vaut 0 |
| 13 | Un octet, l'identifiant du démon (0 à 3) ; rend son état (partie 5) | `0xD8E06BED` si l'identifiant est de 4 ou plus |
| 14 | Même identifiant ; rend deux mots : le compteur de suspension de la session pour ce démon, puis celui du démon (global) | `0xD8E06BED` |
| 15 | Rend deux mots : le compteur de suspension de l'ordonnanceur pour la session, puis le global (`+0x40`) | |
| 16 | Écrit le mot dans `+0x58` de l'ordonnanceur et lève l'octet `+0x1D` de la session (pour remettre la valeur par défaut à la fermeture) | |
| 17 | Rend `+0x58` | |
| 18 | Écrit dans `+0x44`, lève aussi `+0x1D` | |
| 19 | Rend `+0x44` | |
| 20 | Octet = masque par défaut. Si aucune autre session ne l'a déjà changé, garde l'ancien masque (`0x10b288`, octet 0), lève l'octet 1 du même enregistrement, lève l'octet `+0x1E` de la session, et applique le nouveau (`set_default_daemon_mask`, `0x105160`) | `0xC8A06809` si une autre session l'a déjà changé |
| 21 | Rend le masque d'origine (`reset_default_daemons`, `0x1044ec`) si cette session l'avait changé | `0xC8A0680E` sinon |
| 22 | Rend l'octet `+4` du gestionnaire des démons | |
| 23 | Appelle `0x107a14` sur le gestionnaire des démons ; vide le filtre d'adresses MAC du démon 0 (interprété) | |
| 24 | Descripteur `0x20` (processus) puis descripteur de poignée copiée dont le mot vaut 0 ; `scheduler_replace_handle` (`0x107c1c`) remplace la poignée gardée à `+0x88` de l'ordonnanceur (et ferme l'ancienne) | `0xC8A06809` si la poignée est nulle |

Tous les résultats d'erreur du module ont le même module 26 (`0x1A`) dans leur code, sauf `0xD8E06BED` (module 26 aussi, description 1005, « argument invalide »). Les valeurs par défaut de l'ordonnanceur, posées à la fermeture d'une session qui les avait changées : intervalle de relance 30 (`+0x58 = 0x1E`) et de nouvel essai 10 (`+0x44 = 10`).

## Partie 4 : EnterExclusiveState, pas à pas

C'est la commande 1. Elle ne répond qu'une fois que la machine à états exclusifs est arrivée à l'état demandé.

1. **L'aiguillage.** L'en-tête doit valoir `0x00010042` en entier, et le mot 2 doit être le descripteur `0x20`. L'état est l'octet bas du mot 1. `ndmu_0001_EnterExclusiveState` (`0x106cbc`) range le numéro de processus dans la session (`+4`). Si l'état est nul, il rend `0xD8E06BED` ; sinon il appelle `exclusive_state_request` (`0x104518`).
2. **Le verrou du module.** `exclusive_state_request` prend le grand verrou `0x10c228` (`mutex_guard_init`, `0x10597a`) que toutes les commandes se partagent.
3. **Le propriétaire.** L'enregistrement `0x10b288` garde en `+4` le numéro du processus qui est déjà entré en état exclusif. Pour une entrée, si ce numéro est celui de l'appelant, le résultat est `0xC8A06811` (« déjà fait »). Pour une sortie (commande 2, état 0), si ce numéro est celui d'un autre processus, le résultat est `0xC8A06810`. Dans les autres cas on continue.
4. **Le verrou d'état.** `lock_check` (`0x10601c`) regarde le verrou de LockState (`0x10b290`) : s'il est tenu par un autre processus, `0xC8A0680A`.
5. **L'état visé.** `exclusive_state_set_target` (`0x107014`) range l'état visé dans l'octet `+5` de la machine (`0x10b3f4`).
6. **La boucle.** `exclusive_state_run` (`0x106fec`) appelle la méthode virtuelle `+0x1C` de la machine, `exclusive_state_step` (`0x1070b4`), tant que l'état courant (`+4`) n'est pas l'état visé (`+5`) ; si le pas échoue, l'erreur est donnée à la méthode `+0x30`, qui ne fait rien.
7. **Un pas.** `exclusive_state_step` regarde l'état courant : 2 (communication locale) ne peut aller qu'à 0, et tout autre état visé donne `0xC8A0680E` ; 0, 1, 3 et 4 peuvent aller à n'importe quel état visé ; 5 et plus ne font rien. Il appelle `exclusive_state_transition` (`0x109054`).
8. **La transition.** `exclusive_state_transition(machine, visé)` : si l'état courant est déjà l'état visé, rien ; sinon la méthode `+0x24` (`exclusive_state_leave_hook`, `0x107044`) pour l'état qu'on quitte, la méthode `+0x20` (`exclusive_state_enter_hook`, `0x106f50`) pour celui qu'on prend, l'état courant prend la valeur visée, et si l'état courant égale l'état visé, la méthode `+0x2C` (`exclusive_state_reached_hook`, `0x107024`), qui lève un événement sur l'ordonnanceur.
9. **Ce qui change pour les démons.** Les deux méthodes ne touchent qu'aux compteurs de suspension des démons. Les indices de démon sont ceux de 3dbrew (0 `CEC`, 1 `BOSS`, 2 `NIM`, 3 `FRIENDS`) ; la correspondance entre l'indice et le service (`cecd:ndm`, `boss:M`, `nim:ndm`, `frd:n`) est tirée de 3dbrew et n'est pas lue dans le code (voir « interprété »).

| Entrer dans | Ce que fait `exclusive_state_enter_hook` |
| --- | --- |
| 0 (aucun) | si le compteur de l'ordonnanceur est positif : demande l'événement 1 à la machine du Wi-Fi (`network_post_event_if_awake`, `0x104464`) |
| 1 (infrastructure) | suspend le démon 0 (`daemon_disable`, `0x104f70`, avec le drapeau 1) |
| 2 (communication locale) | suspend les quatre démons, puis arrête l'ordonnanceur (`scheduler_disable`, `0x105cc0`) |
| 3 et 4 (StreetPass) | suspend les démons 1 et 2, puis le 3 |

| Quitter | Ce que fait `exclusive_state_leave_hook` (`daemon_enable`, `0x104fa8`, est l'inverse) |
| --- | --- |
| 1 | relance le démon 0 |
| 2 | relance les quatre démons, puis l'ordonnanceur (`scheduler_enable`, `0x105cf4`) |
| 3 et 4 | relance les démons 1, 2 et 3 |

10. **Le retour.** Si tout a réussi : pour une entrée, `exclusive_state_request` range le numéro du processus à `0x10b28c` ; pour une sortie, il y met 0. Le résultat 0 est écrit au mot 1 de la réponse `0x00010040`.

À la fermeture d'une session (partie 6), si son processus est le propriétaire, `leave_exclusive_if_owner` (`0x106d24`) fait la commande 2 à sa place : un jeu qui plante ne laisse donc pas l'état exclusif levé.

## Partie 5 : la suspension des démons, pas à pas

Il y a trois niveaux de compteurs : par session (`+8` à `+0x14` de l'objet de session, un par démon), par démon (`+0x18` de l'objet du démon, rendu par la commande 14), et de l'ordonnanceur (`+0x40`, avec `+0x18` de l'objet de session).

**SuspendDaemons (commande 6).** `ndmu_0006_SuspendDaemons` (`0x106b20`) :

1. Prend le grand verrou. Lit le gestionnaire des démons (`0x10b3e0`) et l'ordonnanceur (`0x10b400`).
2. Vérifie le masque (`check_daemon_mask`, `0x1045b8` : de 1 à 15, sinon `0xD8E06BED`).
3. Premier balayage, sans rien changer : si pour un bit du masque le compteur de la session vaut déjà 100 ou plus, le résultat est `0xC8A0680E`.
4. Second balayage : pour chaque bit du masque, le compteur de la session augmente de 1 ; si c'est le premier, `daemon_disable_by_index` (`0x106630`) augmente le compteur du démon. `daemon_disable` (`0x104f70`) l'augmente ; si l'ancien valait 0, que le démon est démarré (`+0x1E`) et n'est pas verrouillé (`+0x1D` nul), il demande la suspension (`daemon_request_suspend`, `0x104e9a`, qui appelle la méthode virtuelle `+0xC` du client du démon avec l'argument 1).
5. Si un des démons vient de passer à un compteur de 1, l'événement de l'ordonnanceur est signalé (`0x10596a`, qui abaisse son drapeau `+0x3C` puis `svcSignalEvent`), pour qu'il tienne compte du changement.
6. Réponse `0x00060040` avec le résultat 0.

**ResumeDaemons (commande 7).** Le même chemin à l'envers : le compteur de la session doit valoir au moins 1 pour chaque bit (sinon `0xC8A0680D`), il baisse de 1, et au passage à zéro `daemon_enable_by_index` (`0x1045ac`) fait baisser le compteur du démon. `daemon_enable` (`0x104fa8`) rend `0xC8A0680E` si le compteur du démon était déjà nul ; quand il tombe à zéro, il lit l'état du démon (`daemon_get_status`, `0x104ee6`, qui attend et rend l'octet d'état : 0 occupé, 1 inactif, 2 en suspension, 3 suspendu, comme dans 3dbrew) et, si le démon n'est ni occupé ni inactif et qu'il est configuré pour repartir (`+0x1C`), demande la reprise (`daemon_request_resume`, `0x104ebe`, méthode virtuelle `+8` du client).

**Les clients des démons.** Le module envoie lui-même la suspension à chaque démon par le service qui lui correspond (partie 7) : `CECDNDM_SuspendDaemon` (`0x103b0c`) et `CECDNDM_ResumeDaemon` (`0x103c80`) pour `cecd:ndm`, `NIMNDM_SetDaemonToSuspendedState` (`0x1080f0`) et `NIMNDM_SetDaemonToWorkingState` (`0x108194`) pour `nim:ndm`. Pour `frd:n` et `boss:M`, les commandes sont envoyées par des fonctions sans nom (`FRDN_cmd…`, `BOSSM_cmd…`).

**SuspendScheduler (commande 8).** `ndmu_0008_SuspendScheduler` (`0x106c20`), compteur de session `+0x18` (100 au plus) :

1. Au premier appel (compteur à 1) : `disable_all_daemons` (`0x10669e`) suspend les quatre démons.
2. `scheduler_disable` (`0x105cc0`) augmente le compteur de l'ordonnanceur (`+0x40`) et demande l'arrêt de son fil.
3. Si ce compteur était à zéro et que la console n'est pas endormie (`+0xBD` du concentrateur) : la machine du Wi-Fi reçoit l'événement 1 par `network_machine_post_event` (`0x1050da`) si l'octet passé vaut 0, par une variante (`0x1065da`) sinon.

**ResumeScheduler (commande 9).** `ndmu_0009_ResumeScheduler` (`0x104490`) : le compteur de la session baisse ; s'il tombe à zéro, `enable_all_daemons` (`0x106660`) puis `scheduler_enable` (`0x105cf4`).

## Partie 6 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x10b288` | octet 0 : masque par défaut sauvegardé par OverrideDefaultDaemons ; octet 1 : une session a changé le masque ; `+4` : numéro du processus qui est en état exclusif ; `+8` et `+0xC` : propriétaire et compteur du verrou de LockState |
| `0x10b298` | octets : `+1` ordonnanceur arrêté pour la veille, `+2` copie de l'état visé du Wi-Fi |
| `0x10b2b0` | enregistrement de la session `ac:u` (octet 0 et compteur d'ouvertures à `+4`) |
| `0x10b2c4`, `0x10b328`, `0x10b32c`, `0x10b334`, `0x10b350` | les poignées de `nim:ndm`, `cecd:ndm`, `frd:n`, `nwm::EXT`, `ptm:s` |
| `0x10b310` | enregistrement de `srv:` (compteur d'ouvertures à `+4`) ; sa poignée est à `0x10b318` |
| `0x10b31c` | la poignée de `ac:u` |
| `0x10b3b0` | la poignée de `ndm:u` ouverte par `ndm` pour lui-même, compteur à `0x10b330` |
| `0x10b3dc` | pointeur vers le paquet de composants que `server_run` bâtit sur sa pile |
| `0x10b3e0`, `0x10b3e4`, `0x10b3f0`, `0x10b3f4`, `0x10b400` | pointeurs vers le gestionnaire des démons, la machine du Wi-Fi, le concentrateur de notifications, la machine à états exclusifs, l'ordonnanceur |
| `0x10b404` | cache de quatre pointeurs de démon, rempli par `get_daemon` (`0x104fe4`) |
| `0x10c228` | le grand verrou pris par toutes les commandes |
| `0x10c238` | le descripteur du service `ndm:u` |
| `0x10c250` | l'objet serveur (liste de poignées à `+0x1868`, nombre de sessions à `+0x1E08`, descripteur à `+0x1E58`, drapeau « enregistré » à `+0x1E5C`) |

Le gestionnaire des démons (`get_daemon`, `0x104fe4`) range les quatre démons à `+0x08`, `+0x2E8`, `+0x310` et `+0x334` de son objet.

Un objet de session (créé à l'acceptation, détruit par `ndmu_session_destroy`, `0x106eb4`) :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | table de méthodes de la session : `+0` destructeur, `+4` destructeur et libération, `+8` exécuter la requête (`0x106e50`), `+0xC` numéro de file de travail (`0x108908`) |
| `+0x04` | numéro du processus du client (écrit par les commandes 1, 2, 4, 5) |
| `+0x08` à `+0x14` | compteurs de suspension de la session, un par démon |
| `+0x18` | compteur de suspension de l'ordonnanceur |
| `+0x1D` | la session a changé les intervalles |
| `+0x1E` | la session a changé le masque par défaut |

À la fermeture, `ndmu_session_destroy` fait dans l'ordre : `release_session_daemon_suspensions` (`0x106db0`, rend tous les démons que la session avait suspendus), la libération du verrou de LockState si la session en était propriétaire, `release_session_scheduler_suspension` (`0x106e08`), la remise à 30 et 10 des intervalles si `+0x1D`, `reset_default_daemons` (`0x1044ec`), `leave_exclusive_if_owner` (`0x106d24`), puis un signal à l'ordonnanceur si quelque chose a changé.

## Partie 7 : les services que `ndm` appelle

Chaque requête envoyée a sa petite fonction (un seul `svcSendSyncRequest`, `0x10558c`, appelé par 62 fonctions d'envoi relevées dans les références de Ghidra). Les en-têtes sont écrits par `ipc_write_header` (`0x105594`) à partir de `ipc_make_header` (`0x10505e`, numéro dans les 16 bits du haut, paramètres ordinaires dans les bits 6 à 11, mots de traduction dans les bits 0 à 5). Les noms sont ceux de 3dbrew quand la commande y est nommée.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` (port) | `0x10b318` | `0x00010002` | `SRV_RegisterClient` | `0x100f7c` | se déclarer à `sm` (par `connect_to_srv`, `0x100824`, qui réessaie toutes les 500 ms tant que le port n'existe pas) |
| | | `0x00020000` | `SRV_EnableNotification` | `0x101c88` | obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x100fb4` | créer `ndm:u` |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x101008` | le retirer à l'arrêt (par `server_unregister_service`, `0x100916`) |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x10242c` | ouvrir les services ci-dessous |
| | | `0x00090040` | `SRV_Subscribe` | `0x101cfc` | s'abonner à onze notifications |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x101cc4` | lire le numéro de la notification arrivée |
| `err:f` (port) | dans l'objet | `0x00010800` | `ERRF_Throw` | `0x1019a0` | signaler une erreur fatale |
| `ac:u` | `0x10b31c` | `0x00010000`…`0x00400042` | 25 fonctions `AC_…` | `0x102e44` à `0x1035f0` | la connexion Wi-Fi ; liste ci-dessous |
| `cecd:ndm` | `0x10b328` | `0x00010000` | `CECDNDM_Initialize` | `0x103c18` | au démarrage du démon |
| | | `0x00020000` | `CECDNDM_Deinitialize` | `0x103c50` | |
| | | `0x00030000` | `CECDNDM_ResumeDaemon` | `0x103c80` | relancer le démon |
| | | `0x00040040` | `CECDNDM_SuspendDaemon` | `0x103b0c` | le suspendre |
| | | `0x00050000` | `CECDNDM_QueryStatus` | `0x103ad4` | lire son état |
| | | `0x00060042` | `CECDNDM_GetNZoneInfo` | `0x103bd0` | |
| | | `0x00070042` | `CECDNDM_SetNZoneSSIDList` | `0x103b48` | |
| | | `0x00080042` | `CECDNDM_SetNZoneMacFilter` | `0x103b8c` | |
| `nim:ndm` | `0x10b2c4` | `0x00010000` | `NIMNDM_GetDaemonEventHandle` | `0x10812c` | |
| | | `0x00020000` | `NIMNDM_cmd0002` | `0x108164` | (3dbrew : ne fait rien) |
| | | `0x00030000` | `NIMNDM_SetDaemonToWorkingState` | `0x108194` | relancer le démon |
| | | `0x00040040` | `NIMNDM_SetDaemonToSuspendedState` | `0x1080f0` | le suspendre |
| | | `0x00050000` | `NIMNDM_GetDaemonState` | `0x1080b8` | lire son état |
| `frd:n` | `0x10b32c` | `0x00010000`, `0x00020000`, `0x00030040`, `0x00040000` | `FRDN_cmd0001` à `FRDN_cmd0004` | `0x1087fc`, `0x108834`, `0x1087c0`, `0x108788` | non nommées sur 3dbrew |
| `boss:M` | dans l'objet | `0x00010002` (avec `0x20`), `0x00020000`, `0x00030040`, `0x00040000`, `0x00050000`, `0x00060000`, `0x00070000` | `BOSSM_cmd0001` à `BOSSM_cmd0007` | `0x108500`, `0x1085ce`, `0x1085fa`, `0x108566`, `0x1084cc`, `0x108532`, `0x10859a` | non nommées sur 3dbrew |
| `nwm::EXT` | `0x10b334` | `0x00050002` (avec `0x20`) | `NWMEXT_cmd0005` | `0x1081cc` | (3dbrew : `?`) |
| `ptm:s` | `0x10b350` | `0x04050000` | `PTMS_GetAwakeReason` | `0x108240` | pourquoi la console s'est réveillée |
| | | `0x04030042` | `PTMS_NotifySleepPreparationComplete` | `0x108284` | dire à `ptm` que `ndm` est prêt pour la veille |
| `ndm:u` (lui-même) | `0x10b3b0` | `0x00010042` | `NDMU_EnterExclusiveState` | `0x107930` | entrer en état exclusif pour se connecter |
| | | `0x00020002` | `NDMU_LeaveExclusiveState` | `0x107970` | en sortir |

Les 25 requêtes envoyées à `ac:u` (poignée `0x10b31c`) : CreateDefaultConfig (`0x00010000`, `0x10333c`), ConnectAsync (`0x00040006`, `0x102ed4`), GetConnectResult (`0x00050002`, `0x103064`), CancelConnectAsync (`0x00070002`, `0x103290`), CloseAsync (`0x00080004`, `0x102e44`), GetCloseResult (`0x00090002`, `0x10302c`), GetStatus (`0x000C0000`, `0x1035f0`), GetWifiStatus (`0x000D0000`, `0x103390`), GetCurrentAPInfo (`0x000E0042`, `0x1034f0`), GetConnectingInfraPriority (`0x000F0000`, `0x103554`), GetCurrentNZoneInfo (`0x00100042`, `0x10358c`), CloseAllAsync (`0x00190004`, `0x102fa4`), GetCloseAllResult (`0x001A0002`, `0x103258`), AddDenyApType (`0x00240042`, `0x102f30`), SetInfraPriority (`0x00260042`, `0x103128`), GetInfraPriority (`0x00270002`, `0x10309c`), SetPowerSaveMode (`0x00280042`, `0x10319c`), SetFromApplication (`0x002C0042`, `0x1032c8`), SetRequestEulaVersion (`0x002D0082`, `0x10342c`), RegisterDisconnectEvent (`0x00300004`, `0x1034a8`), SetZoneMacFilter (`0x003D0042`, `0x103210`), IsConnected (`0x003E0042`, `0x102e8c`), GetNotAwakeMacFilter (`0x003F0040`, `0x1033c8`), SetClientVersion (`0x00400042`, `0x1030e8`) et GetAPSSIDList (`0x003C0042`, `0x102fec`). Tous les noms et numéros tombent sur 3dbrew. `ac_session_open` (`0x102bd0`) ouvre `ac:u`, puis envoie SetClientVersion avec la valeur `0x0A0001C8`.

Le jeu de requêtes `ac:u` envoyées par le module est celui que le module `ac` reçoit : le côté `ac` est dans [ac](ac.md).

## Partie 8 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x1092d0` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x10918c` |
| CreateThread | `0x08` | `svcCreateThread` | `0x1093dc` |
| ExitThread | `0x09` | `svcExitThread` | `0x1094d0` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x109400` |
| CreateMutex | `0x13` | `svcCreateMutex` | `0x109b14` |
| CreateSemaphore | `0x15` | `svcCreateSemaphore` | `0x109330` |
| ReleaseSemaphore | `0x16` | `svcReleaseSemaphore` | `0x10937c` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x10592c` |
| SignalEvent | `0x18` | `svcSignalEvent` | `0x104f2c` |
| ClearEvent | `0x19` | `svcClearEvent` | `0x104e28` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x1092f4` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x109610` |
| CloseHandle | `0x23` | `svcCloseHandle` | `0x1053e8` |
| WaitSynchronization1 | `0x24` | `svcWaitSynchronization1` | `0x1051e0` |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x109b44` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x109b2c` |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x10970c` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x109348` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x1093c4` |
| SendSyncRequest | `0x32` | `svcSendSyncRequest` | `0x10558c` |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x109364` |
| GetThreadId | `0x37` | `svcGetThreadId` | `0x10930c` |
| Break | `0x3C` | `svcBreak` | `0x1094c8` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x1093ac` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x109394` |

Ces 26 appels sont tous dans le masque d'appels système de l'exheader (59 autorisés). Les verrous reposent sur `ArbitrateAddress` (`mutex_lock`, `0x105372`, et `mutex_unlock`, `0x105208`).

## Partie 9 : ce que Pokémon X envoie

Les neuf lignes de `pokemon-x-services.tsv` pour `ndm:u`. La poignée du jeu est à `0x5e8024` et il l'ouvre par `ndm_open_session` (`0x10f368`, compteur d'ouvertures). Les paramètres et les appelants sont lus dans le pseudo-code du jeu (`local/analyse/maj/gh/pseudo/`). Le module n'envoie jamais de poignée dans ses réponses, sauf la commande 12, que le jeu n'envoie pas : un programme qui prend la place de la console n'a donc **aucun événement à créer** pour `ndm:u`.

| En-tête | Commande | Fonction du jeu | Appelants | Fonction du module | Ce qu'il faut rendre |
| --- | --- | --- | --- | --- | --- |
| `0x00010042` | EnterExclusiveState | `0x1efc74` | 4 : `0x1dcb80` et `0x1dcd88` avec l'état 1 (avant `ac_ScanAPs`, `ac_SetRequestEulaVersion` et `ac_ConnectAsync`), `0x2b0254` et `0x2b0318` avec l'état 2 (avant l'ouverture de `nwm::UDS`) | `ndmu_0001_EnterExclusiveState` (`0x106cbc`) | résultat 0 (en-tête `0x00010040`). Si le jeu reçoit un résultat négatif, il referme sa session `ndm:u` et renonce ; le module rend `0xC8A06811` si le même processus entre deux fois de suite, donc un remplaçant qui garde l'état et refuse la seconde entrée imite la console, mais le jeu appelle toujours Leave entre deux Enter (voir la ligne suivante) |
| `0x00020002` | LeaveExclusiveState | `0x16fc78` | 7 : `0x145b60` (fermeture du Wi-Fi), `0x1dcb80`, `0x1dccf8`, `0x1dcd20`, `0x2b02f0`, `0x2b03b4`, `0x2b26b0` | `ndmu_0002_LeaveExclusiveState` (`0x1044e0`) | résultat 0 (`0x00020040`), même si aucun état n'est tenu |
| `0x00030000` | QueryExclusiveMode | `0x1efc38` | 1 : `0x1efb9c`, atteinte seulement par un `.cro` | `ndmu_0003_QueryExclusiveMode` (`0x106cac`) | résultat 0 et, au mot 2, l'état exclusif courant (0 si aucun Enter n'est actif, sinon la valeur donnée à Enter) ; en-tête `0x00030080`. Le jeu n'en garde que l'octet bas |
| `0x00060040` | SuspendDaemons | `0x118e38` | 1 : `0x10f414`, avec `1 << n` pour `n` de 0 à 3 | `ndmu_0006_SuspendDaemons` (`0x106b20`) | résultat 0 (`0x00060040`) ; un masque de 1 à 15 sinon `0xD8E06BED` |
| `0x00070040` | ResumeDaemons | `0x118dfc` | 1 : `0x10f3f4`, même masque | `ndmu_0007_ResumeDaemons` (`0x106a68`) | résultat 0 (`0x00070040`) ; le module rend `0xC8A0680D` si la session n'a pas suspendu ce démon |
| `0x00080040` | SuspendScheduler | `0x1efbf8` | 1 : `0x420d4c`, avec l'octet 0 | `ndmu_0008_SuspendScheduler` (`0x106c20`) | résultat 0 (`0x00080040`) |
| `0x00090000` | ResumeScheduler | `0x1efbc4` | 1 : `0x420e74` | `ndmu_0009_ResumeScheduler` (`0x104490`) | résultat 0 (`0x00090040`) ; `0xC8A0680D` si rien n'est suspendu |
| `0x00140040` | OverrideDefaultDaemons | `0x118e70` | 1 : `startup_init_ndm` (`0x109868`), au démarrage, avec le masque `0xF` | `ndmu_0014_OverrideDefaultDaemons` (`0x106d44`) | résultat 0 (`0x00140040`) ; la console garde le masque d'origine pour le rendre à la fermeture de la session |
| `0x00170000` | ClearHalfAwakeMacFilter | `0x1efcb8` | 1 : `0x2b4af0`, avant de lancer une tâche de fond de `boss` | `ndmu_0017_ClearHalfAwakeMacFilter` (`0x106d9c`) | résultat 0 (`0x00170040`) |

Le jeu regarde les résultats ainsi : à l'entrée (états 1 et 2), un résultat négatif arrête l'opération et ferme la session ; pour les autres commandes, il ne regarde rien d'autre que le signe. Un programme qui rend toujours 0, avec les en-têtes de réponse du tableau, suffit donc, et l'état exclusif n'a besoin d'être gardé que pour QueryExclusiveMode (atteinte par un `.cro`, jamais par le point d'entrée). Ce que le jeu fait avec l'octet de QueryExclusiveMode n'est pas lu.

La suite qu'un jeu parcourt pour se connecter (lue dans `0x1dcb80`, `0x1dcd88` et `0x1dd258`) : EnterExclusiveState(1) ; ac:u GetInfraPriority ; si la réponse est 0, ac:u SetRequestEulaVersion, sinon AddDenyApType ; ac:u ConnectAsync ; LeaveExclusiveState ; ac:u GetConnectResult. Le détail du côté d'`ac` est dans [ac](ac.md).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 24 numéros de commande de `ndm:u`, leur fonction et leur en-tête de réponse : le pseudo-code de Ghidra de `ndmu_handle_command` d'un côté, et de l'autre `emulate_dispatch.py`, qui exécute l'aiguillage pour chaque numéro (24 commandes, un numéro inconnu rend `0xD900182F`). Les fonctions et les en-têtes de réponse tombent à l'identique : les en-têtes de réponse que le pseudo-code écrit (`ipc_write_header` avec le numéro, le nombre de mots ordinaires et de mots de traduction) sont les mêmes que ceux de l'émulation pour les 24 commandes, et les cinq comparaisons d'en-tête entier du pseudo-code (`1, 1, 2`, `2, 0, 2`, `4, 0, 2`, `5, 0, 2`, `0x18, 0, 4`) donnent les cinq en-têtes de l'émulation.
- Les en-têtes de requête : 3dbrew pour les numéros 1 à `0x17` ; l'émulation retrouve tout l'en-tête de `0x00010042`, `0x00020002`, `0x00040002`, `0x00050002` et `0x00180004`, et le nombre de mots lus par le code pour les autres colle à 3dbrew.
- La table des 24 commandes est complétée par la lecture du corps de chaque fonction : le pseudo-code de Ghidra, et pour `ndmu_000C_NotImplemented`, `ndmu_0003_QueryExclusiveMode` et `ndmu_0001_EnterExclusiveState`, l'assembleur de capstone.
- Les services appelés : l'exheader autorise huit noms (`ac:u`, `ptm:s`, `nwm::EXT`, `nim:ndm`, `ndm:u`, `cecd:ndm`, `frd:n`, `boss:M`), et ce sont les huit que le code ouvre ; les sept titres des dépendances sont ceux des sept autres services (liste des titres de 3dbrew).
- Le serveur : `svcReplyAndReceive` n'a que deux appelants (`server_receive_loop` et `handle_request_and_reply`), `ndmu_session_handle_request` n'a qu'un appelant dans la table, et `svcCreateThread` n'en a qu'un (`create_thread_impl`). Vus dans les références de Ghidra et dans l'assembleur.
- Le nom `ndm:u` et ses six sessions : la chaîne dans le descripteur construit en `0x108b6c` et l'assembleur de `server_register_service`.
- Les 26 appels système : relevés dans l'assembleur et tous autorisés par le masque de l'exheader.
- La structure d'une requête de `ac:u` envoyée : les 25 en-têtes envoyés par le module sont des commandes de `ac:u` de 3dbrew, avec les mêmes noms (partie 7).

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- La correspondance entre les quatre indices de démon et les services : 3dbrew donne CEC 0, BOSS 1, NIM 2, FRIENDS 3 ; le code ne fait que traiter quatre objets à des décalages différents (la taille du premier, `0x2E0` octets, colle à `cecd`, qui garde des listes de zones).
- Le sens des états exclusifs : 3dbrew nomme 0 aucun, 1 infrastructure, 2 communication locale, 3 StreetPass, 4 données StreetPass ; le code traite 3 et 4 de la même façon, et un état de 5 ou plus est accepté puis ignoré.
- Que les neuf commandes sans effet de suspension (10 à 19, 22) ne font que lire ou écrire un champ : lu, pas rejoué.
- Les noms `network_machine_…` et `scheduler_…` : le rôle de la machine du Wi-Fi (états 0 à 11 de 3dbrew) et de l'ordonnanceur (intervalles) vient des champs que les commandes lisent, pas de la lecture des fils eux-mêmes.
- Que la commande 23 vide le filtre du démon 0 (appel de `0x107a14` sur son objet).
- Le sens des notifications `0x107`, `0x300` à `0x304`.
- Le sens du mot passé à `ndmu_0018` et son usage : elle remplace une poignée gardée dans l'ordonnanceur ; aucun client connu.
- La taille du tas (`0x9000`) et du pool (`0x4000`).

**Pas lu**
- Les corps des fils de la machine du Wi-Fi et de l'ordonnanceur (méthode virtuelle `+0x10` de leur objet), et les autres états et événements de la machine du Wi-Fi.
- Le détail des clients de `frd:n` et de `boss:M` (les commandes sont envoyées, mais ce qu'elles font n'est pas lu).
- Le calcul de chaque transition d'état du Wi-Fi (événements 1 et 9 seulement vus).
- La table de messages d'erreur (`0x103e50` renvoie des codes selon un numéro : lu pour les valeurs, pas pour leur emploi).
- 657 fonctions sans nom, dont presque toutes sont de petites fonctions de C++ (listes chaînées, constructeurs, fonctions virtuelles triviales).

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Fonctions, pseudo-code, références, tables de saut | `python outils/ghidra_direct.py ndm` | 3 minutes (deux fois, avec les noms) |
| Désassemblage de chaque fonction avec les mots de la table de constantes résolus, et les constantes remises dans le pseudo-code | un script Python avec capstone | immédiat |
| Table des commandes de l'aiguillage `0x1075e4` | `python outils/emulate_dispatch.py ndm 0x1075e4=ndm:u` | quelques secondes |
| Noms des commandes, des types et des énumérations | 3dbrew, par `web.archive.org` (NDM Services, CECD Services, NIM Services, liste des titres) | |
| Le côté du jeu | le pseudo-code de la mise à jour (`local/analyse/maj/gh/`) | |

**Pour reprendre.** `ndm.noms.tsv` est le fichier de graines : une adresse, `function` (ARM) ou `label` (Thumb), un nom. Les noms en `ndmu_<numéro>_<Commande>` sont les commandes reçues ; ceux en majuscules (`SRV_`, `AC_`, `CECDNDM_`, `NIMNDM_`, `NDMU_`…) sont les requêtes que `ndm` envoie à un autre service. Les noms `svc…` sont des enveloppes d'appels système. Le pseudo-code brut et les scripts sont dans `local/analyse/ndm/`, non versionné.
