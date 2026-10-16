# ir, l'infrarouge

`ir` pilote le port infrarouge de la console et, sur New 3DS, lit aussi le petit bâton (le « C-stick ») et les gâchettes ZL et ZR. Il offre trois services : `ir:u` (l'infrarouge brut, des tampons envoyés et reçus tels quels), `ir:USER` (un protocole à paquets par-dessus : connexion, envoi, réception, c'est celui que les jeux utilisent) et `ir:rst` (le matériel de la New 3DS). Pokémon X n'utilise que `ir:USER`, pour les échanges par infrarouge.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), les trois aiguillages rejoués par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de la page « IR Services » de 3dbrew. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000003302`, un titre de la CTRNAND (lu dans l'exheader ; nom `ir`) |
| Fichier lu | `local/extrait/ir/exefs/code.bin` et `exheader.bin` |
| Taille | 67 836 octets de code (`0x108fc`), 5 384 de données en lecture seule (`0x1508`), 1 376 de données (`0x560`), 9 192 de mémoire à zéro (`0x23e8`) ; pile de 4 096 octets ; priorité de départ 27 |
| Fonctions | 455, dont 199 nommées dans `ir.noms.tsv` (12 en Thumb, 443 en ARM) |
| Services offerts | `ir:u` (1 session), `ir:USER` (1 session), `ir:rst` (2 sessions) : trois sessions au plus en tout |
| Services appelés | `i2c::IR` (le composant infrarouge, par bus), `gpio:IR` (sa broche d'interruption), `cfg:s`, `ptm:s`, plus `srv:` et le port `err:f`. Les quatre premiers sont ceux de l'exheader ; `srv:` n'a pas besoin d'y être |
| Dépendances déclarées | `gpio` (`0004013000001B02`) et `i2c` (`0004013000001E02`) |
| Fils | le fil principal (serveur), un fil de communication infrarouge (priorité 16) et, tant qu'une session `ir:rst` est ouverte, un fil qui lit le matériel de la New 3DS (priorité 16) |

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle cinq fonctions puis `call_ir_main`, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`).
2. `0x10020c` (non nommée) : prépare un petit contexte de bibliothèque.
3. `init_runtime_and_srv` (`0x109bf0`) : `init_runtime` (`0x101038` : verrous, trois réserves d'adresses virtuelles, enregistrement du processus), puis `srv_init` (`0x109c00`), qui se connecte au port `srv:` (en réessayant toutes les 500 000 ns tant que le port n'existe pas) et envoie `SRV_RegisterClient`.
4. `setup_heap` (`0x100318`) : fixe la taille du tas (`set_heap_size`, `0x10026c`, par `svcControlMemory` à `0x08000000`) et prépare l'allocateur des piles de fils.
5. `run_static_initializers` (`0x100164`, Thumb), qui appelle les constructeurs de la table de distances : les objets globaux sont construits par `construct_global_objects` (`0x10f7e4`), qui range aussi les deux vtables des services (`ir:u` à `0x11221c`, `ir:USER` à `0x112188`).
6. `run_init_array` (`0x1001d8`).
7. `call_ir_main` (`0x1001c8`) appelle `ir_main` (`0x1003ec`, 1 536 octets) : voir la partie 2.

## Partie 2 : la boucle de serveur

Un seul fil sert les commandes des trois services. `ir_main` fait :

1. **Les trois noms.** Dans l'ordre, `ir:u`, `ir:USER`, `ir:rst` (table de `0x111060` : adresse du nom, nombre de sessions au plus) : `SRV_RegisterService` avec 1, 1 et 2 sessions. Les ports vont dans les emplacements 1 à 3 du tableau de poignées (`0x11592c`).
2. **`ptm:s` et le fil.** `ptm_open` (`0x1011dc`) ouvre `ptm:s`. Le fil de communication est créé (`create_comm_thread`, `0x10105c`, priorité 16) avec `comm_thread_main` (`0x1015c0`).
3. **L'initialisation.** `init_rst_state` (`0x100b68`) prépare l'état de `ir:rst` (sa page de `0x98` octets, ses huit entrées de départ). `init_ir_module_state` (`0x100dcc`) ouvre le composant (`ir_open_devices`, `0x1016f8` : `i2c::IR`, `gpio:IR`, l'événement de l'interruption à `0x11328c`), prépare les huit entrées de `0x1140a8`, et lit le bloc de configuration `0x00040004` (`CFG_GetConfigInfoBlk8`).
4. **Les notifications.** Trois objets de notification : `0x100` (`0x1107ac`), `0x104` (`0x110834`) et `0x105` (`0x1107c0`). `SRV_EnableNotification` rend le sémaphore (emplacement 0), `SRV_Subscribe` pour `0x104` et `0x105`.
5. **L'attente.** `svcReplyAndReceive` (`0x100a94`, un seul appelant : `ir_main`) sur : le sémaphore, les trois ports, puis les sessions ouvertes (3 au plus).
   - Indice 0 : `handle_srv_notification` (`0x101278`) lit le numéro et appelle le gestionnaire.
   - Indice 1 à 3 : `svcAcceptSession`. S'il y a déjà trois sessions, la nouvelle est refermée. Sinon : pour `ir:u` et `ir:USER`, le contexte est un objet unique, fixe (`0x11331c` et `0x113f98`), et l'octet `0x113550` (« service courant », 3 s'il n'y en a pas) prend 0 ou 1 ; pour `ir:rst`, un objet de `0x10c` octets est alloué et construit pour la session (`rst_session_register`, `0x100d7c`). Chaque session garde (type, contexte) dans la table de `0x115850`.
   - Indice 4 et plus : `(*(0x111078 + type*4))(contexte)`, soit `iru_handle_command` (`0x10a170`), `iruser_handle_command` (`0x10a4bc`) ou `rst_handle_command` (`0x10ab4c`).
6. **La fermeture d'une session** (résultat `0xC920181A`) : la poignée est refermée, le destructeur du contexte est appelé (entrée 2 de sa vtable), et pour `ir:u` ou `ir:USER` l'octet `0x113550` repasse à 3 (aucun service courant). Le destructeur de `ir:USER` (`iruser_destroy`, `0x10e110`) appelle `FinalizeIrnop` ; celui de `ir:u` (`iru_destroy`, `0x10bab8`) attend la réception en cours puis appelle `Shutdown`.
7. **La sortie.** Quand la notification `0x100` a levé l'octet `0x113528` et qu'il n'y a plus de session : les trois services sont retirés, le fil de communication est arrêté, `ir_close_devices` (`0x100f58`) referme le composant, `srv:` et `ptm:s` sont fermés.

**Le fil de communication.** `comm_thread_main` (`0x1015c0`) attend un événement (la barrière `0x113328`), puis appelle l'entrée 3 de la vtable du service courant : `iruser_thread_main` (`0x10c7e8`) pour `ir:USER`, `iru_thread_main` (`0x10b684`) pour `ir:u`. `iruser_thread_main` attend sur deux événements (la table de `0x111020` en donne les adresses) : celui de l'interruption du composant (`0x11328c`, que lève aussi chaque envoi) et celui des commandes (`0x1132d4`), avec un délai calculé sur l'horloge du système. À chaque réveil elle traite une commande en attente (octet `+8` de `0x1132c8`) puis fait un pas de l'état courant de la liaison (partie 4).

| Notification | Gestionnaire | Adresse | Ce que fait le code |
| --- | --- | --- | --- |
| `0x100` | `on_terminate_notification` | `0x1107ac` | met l'octet d'arrêt `0x113528` à 1 |
| `0x104` | `on_sleep_notification` | `0x110834` | détache l'interruption de `gpio:IR` (`gpioir_detach_interrupt`), arrête le service courant (`iru_on_sleep`, `0x10b8f4`, ou `iruser_on_sleep`, `0x10547c`), puis `PTMSYSM_NotifySleepPreparationComplete` |
| `0x105` | `on_wakeup_notification` | `0x1107c0` | remet le service courant en route (`iru_on_wake`, `0x10b898`, ou `iruser_on_wake`, `0x1053b0`), rattache l'interruption (`gpioir_attach_interrupt`), puis le même message à `ptm` |

Le sens de ces numéros est celui de la fiche de [ptm](ptm.md) (la veille et le réveil). Pendant le sommeil, l'octet `0x113280` vaut 1 (`mark_asleep`, `0x107200`), ce qui fait refuser presque toutes les commandes de `ir:u` et `ir:USER` avec `0xC8A10C01`.

## Partie 3 : les commandes

Chaque service a son aiguillage, un `switch` sur les 16 bits du haut de l'en-tête. Les numéros inconnus rendent l'en-tête `0x00000040` et `0xD900182F` ; un en-tête qui ne va pas, `0xD9001830`. Il n'y a aucune vérification de session : une session = un service. Les noms et les en-têtes de requête viennent de 3dbrew ; l'adresse, les vérifications et l'en-tête de réponse sont lus dans le code et recoupés par `emulate_dispatch.py`. Quand la colonne « vérifie » dit « entier », le code compare l'en-tête en entier (et les descripteurs) ; « numéro » : seul le numéro compte.

### Les erreurs

La plupart des commandes de `ir:USER` et de `ir:u` commencent par les mêmes deux tests, rendus ici sous le nom de « test commun » :

| Test commun | Octet | Résultat |
| --- | --- | --- |
| le composant a échoué une fois (« verrou ») | `0x113294` | `0xF9610C02` |
| la console est en veille | `0x113280` | `0xC8A10C01` |

D'autres erreurs reviennent : `0xC8A10C0D` (la liaison n'est pas dans le bon état), `0xC8A10C0B` (déjà connecté), `0xC8A10C0C` (déjà en train de se connecter), `0xC8610C0F` (tampon trop petit ou plus de place), `0xC8610C10` (plus de case de paquet), `0xC8810FEF` (rien à lire), `0xE0E10FEC` (taille ou paramètre non valable), `0xD8210FF9` (déjà initialisé), `0xD8210FF8` (pas initialisé). Toutes ont le module 67 (`0x43`) dans leur code ; les niveaux (`0xC8…`, `0xD8…`, `0xE0…`, `0xF9…`) ne sont pas interprétés ici, sauf que le jeu en tolère certains (partie 9).

### `ir:USER` (26 commandes, aiguillage `0x10a4bc`)

L'objet de session est celui de la classe de `ir:USER` : trois commandes (2, 13 et 24) passent par sa vtable à `0x112188`, les autres appellent directement une fonction. « Liaison » est l'octet d'état `0x00` à `0x04` rangé à `+8` de l'en-tête de la mémoire partagée (partie 5) : 0 repos, 1 en train de se connecter, 2 connecté, 3 en train de se déconnecter, 4 erreur (interprété).

| N° | En-tête de requête | Commande (3dbrew) | Fonction | Adresse | Réponse | Ce que le code vérifie |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010182` | InitializeIrnop | `iruser_InitializeIrnop` puis `ir_initialize_common` | `0x10c4ac`, `0x10cec0` | `0x00010040` | entier, mot 7 nul ; partie 4 |
| 2 | `0x00020000` | FinalizeIrnop | `iruser_FinalizeIrnop` (vtable +0x14) | `0x104c78` | `0x00020040` | numéro ; non initialisé : `0xD8210FF8` ; arrête le fil, referme les événements, déprojette la page |
| 3 | `0x00030000` | ClearReceiveBuffer | `iruser_ClearReceiveBuffer` | `0x10c71c` | `0x00030040` | test commun ; liaison 2 sinon `0xC8A10C0D` ; commande 2 au fil |
| 4 | `0x00040000` | ClearSendBuffer | `iruser_ClearSendBuffer` | `0x10c3e4` | `0x00040040` | test commun ; liaison 2 sinon `0xC8A10C0D` ; commande 3 |
| 5 | `0x000500C0` | WaitConnection | `iruser_WaitConnection` | `0x10c2ac` | `0x00050040` | test commun ; les deux tampons existent (plus de 7 octets) sinon `0xC8610C0F` ; liaison pas 1 ni 2 (sinon `0xC8A10C0C`, `0xC8A10C0B`) ; commande 4 |
| 6 | `0x00060040` | RequireConnection | `iruser_RequireConnection` | `0x10c5f0` | `0x00060040` | mêmes vérifications ; commande 5 ; mot 1 (octet) rangé à `+0xC` |
| 7 | `0x000702C0` | AutoConnection | `iruser_AutoConnection` | `0x10c11c` | `0x00070040` | mêmes vérifications ; mot 1 (octet) à `+0xC`, cinq valeurs 64 bits rangées dans `0x1132c8` (`+0x20`, `+0x28` = B − A, `+0x30`, `+0x38` = D − C, `+0x40`) ; commande 6 |
| 8 | `0x00080000` | AnyConnection | `iruser_AnyConnection` | `0x10bf78` | `0x00080040` | test commun ; liaison pas 1 ni 2 ; commande 7 |
| 9 | `0x00090000` | Disconnect | `iruser_Disconnect` | `0x10beb0` | `0x00090040` | test commun ; liaison 1 ou 2 sinon `0xC8A10C0D` ; commande 8 |
| 10 | `0x000A0000` | GetReceiveEvent | `iruser_GetReceiveEvent` | `0x10c494` | `0x000A0042` | aucune ; rend 0, le descripteur `0x00000000` et la poignée de `0x113dc4 + 0x20` |
| 11 | `0x000B0000` | GetSendEvent | `iruser_GetSendEvent` | `0x10bf60` | `0x000B0042` | aucune ; poignée de `0x113dc4 + 0x24` |
| 12 | `0x000C0000` | GetConnectionStatusEvent | `iruser_GetConnectionStatusEvent` | `0x10d2d8` | `0x000C0042` | aucune ; poignée de `0x113dc4 + 0x28` |
| 13 | `0x000D0042` | SendIrnop | dans l'aiguillage, puis `iruser_SendIrnop_virtual` (vtable +0x18) | `0x105c1c` | `0x000D0040` | entier ; mot 2 : tampon statique 0 (`mot 2 & 0x3C0F == 2`) ; taille = mot 2 >> 14 ; partie 4 |
| 14 | `0x000E0042` | SendIrnopLarge | `iruser_SendIrnopLarge` | `0x10c2a0` | `0x000E0042` | entier ; mot 2 : tampon en lecture (`& 0xF == 0xA`) ; appelle la même entrée de vtable |
| 15 | `0x000F0040` | ReceiveIrnop | `iruser_ReceiveIrnop` | `0x107858` | `0x000F00C2` | test commun ; liaison pas 1 sinon `0xC8A10C0D` ; rien : `0xC8810FEF` ; paquet plus grand que la place : `0xC8610C0F` ; taille demandée plafonnée à `0x100`, données dans un tampon statique de l'objet |
| 16 | `0x00100042` | ReceiveIrnopLarge | `iruser_ReceiveIrnopLarge` | `0x10c5dc` | `0x001000C2` | entier ; mot 2 : tampon en écriture (`& 0xF == 0xC`) ; même fonction que la 15 |
| 17 | `0x0011….` | GetLatestReceiveErrorResult | `iruser_GetLatestReceiveErrorResult` | `0x10d42c` | `0x00110080` | verrou : rend 0 et le code d'erreur comme valeur ; sinon rend le mot de `+0` de la mémoire partagée, et le remet à 0 si le mot 1 est non nul |
| 18 | `0x0012….` | GetLatestSendErrorResult | `iruser_GetLatestSendErrorResult` | `0x10d2f0` | `0x00120080` | pareil, avec le mot de `+4` |
| 19 | `0x0013….` | GetConnectionStatus | `iruser_GetConnectionStatus` | `0x10c7cc` | `0x00130080` | aucune ; rend l'octet de liaison (`+8`) |
| 20 | `0x0014….` | GetTryingToConnectStatus | `iruser_GetTryingToConnectStatus` | `0x10d348` | `0x00140080` | si liaison 1 et sous-état (`0x1132cb`) inférieur à 7 : une table de sauts par sous-état ; sinon 0 |
| 21 | `0x0015….` | GetReceiveSizeFreeAndUsed | `iruser_GetReceiveSizeFreeAndUsed` | `0x10d3bc` | `0x00150140` | aucune ; rend 4 mots (partie 5) |
| 22 | `0x0016….` | GetSendSizeFreeAndUsed | `iruser_GetSendSizeFreeAndUsed` | `0x10d1e8` | `0x00160140` | aucune ; rend 4 mots |
| 23 | `0x0017….` | GetConnectionRole | `iruser_GetConnectionRole` | `0x10c564` | `0x00170080` | test commun ; liaison 2 sinon `0xC8A10C0D` ; rend l'octet `+0xA` |
| 24 | `0x00180182` | InitializeIrnopShared | `iruser_InitializeIrnopShared` (vtable +0x10), puis `ir_initialize_shared`, `ir_initialize_common` | `0x105330`, `0x10d1c0`, `0x10cec0` | `0x00180040` | entier, mot 7 nul ; mêmes arguments que la 1 mais la mémoire partagée porte les tampons (partie 4) ; efface le bit « émulation du Circle Pad Pro » (`0x114140`) |
| 25 | `0x00190040` | ReleaseReceivedData | `iruser_ReleaseReceivedData` | `0x10cde8` | `0x00190040` | test commun ; liaison 1 : `0xC8A10C0D` ; rien à rendre : `0xC8A10C0D` (si pas connecté) ou `0xC8810FEF` ; sinon libère le nombre de paquets reçus du mot 1 |
| 26 | `0x001A0040` | SetOwnMachineId | `iruser_SetOwnMachineId` | `0x10c4d4` | `0x001A0040` | liaison pas 1 ni 2 (sinon `0xC8A10C0C`) ; range l'octet à `+0xB` |

Les en-têtes de requête de 17 à 23 sont donnés incomplets par 3dbrew (`0x0011….` etc.) : le code ne les vérifie pas (numéro seul) ; les deux que Pokémon X envoie (`0x00110040` et `0x00160000`) sont lus côté jeu (partie 9). Les noms de 17 à 23 sont ceux de 3dbrew ; la Carte des services ne connaissait pas les commandes 17 et 22.

### `ir:u` (18 commandes, aiguillage `0x10a170`)

Le même schéma, sans liaison : l'état est l'octet `+5` de l'objet `0x11329c` (1 libre, 2 envoi en cours, 3 réception en cours). Pokémon X ne s'en sert pas.

| N° | En-tête de requête | Commande (3dbrew) | Fonction | Adresse | Réponse | Ce que le code vérifie |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010000` | Initialize | `iru_Initialize` | `0x10ae00` | `0x00010040` | verrou : `0xF9610C02` ; déjà initialisé : `0xD8210FF9` ; crée les événements |
| 2 | `0x00020000` | Shutdown | `iru_Shutdown` | `0x107be8` | `0x00020040` | non initialisé : `0xD8210FF8` ; transfert en cours : `0xC8A10FF0` |
| 3 | `0x00030042` | StartSendTransfer | `iru_StartSendTransfer` | `0x10b990` | `0x00030042` | entier, tampon en lecture ; test commun ; taille de 1 à `0x800` sinon `0xE0E10FEC` ; état 1 sinon `0xC8A10FF0` |
| 4 | `0x00040000` | WaitSendTransfer | `iru_WaitSendTransfer` | `0x10ad40` | `0x00040040` | test commun ; pas d'envoi en cours (état différent de 2) : rend le résultat de succès `0x00210CCE` ; sinon attend la fin |
| 5 | `0x000500C2` | StartRecvTransfer | `iru_StartRecvTransfer` | `0x10b494` | `0x00050040` | entier ; test commun ; taille et mot 4 non nuls, `mot 4 <= taille` sinon `0xE0E10FEC` ; réception déjà en cours : `0xE0210CCA` ; état 1 sinon `0xC8A10FF0` |
| 6 | `0x00060000` | WaitRecvTransfer | `iru_WaitRecvTransfer` | `0x107aec` | `0x00060080` | pas de réception : `0xE0210CCB` ; attend la fin, rend le nombre d'octets |
| 7 | `0x00070000` | GetRecvTransferCount | `iru_GetRecvTransferCount` | `0x10b634` | `0x00070080` | rien reçu : `0xC8810FEF` |
| 8 | `0x00080000` | GetSendState | `iru_GetSendState` | `0x10b65c` | `0x00080080` | aucune ; rend « l'état n'est pas 2 » |
| 9 | `0x00090040` | SetBitRate | `iru_SetBitRate` | `0x1079dc` | `0x00090040` | verrou, veille, état 1 ; valeur de 3 à `0x12` sinon `0xE0E10FED` |
| 10 | `0x000A0000` | GetBitRate | `iru_cmd000A` | `0x10afc8` | `0x000A0080` | verrou, veille, état 1 ; lit le composant (nom de 3dbrew non vérifié) |
| 11 | `0x000B0040` | SetIRLEDState | `iru_cmd000B` | `0x10bd78` | `0x000B0040` | verrou, veille, état 1 (nom de 3dbrew non vérifié) |
| 12 | `0x000C0000` | GetIRLEDRecvState | `iru_GetIRLEDRecvState` | `0x10bae4` | `0x000C0080` | verrou, veille, état 1 ; lit la broche par `gpio:IR` |
| 13 | `0x000D0000` | GetSendFinishedEvent | `iru_GetSendFinishedEvent` | `0x10b880` | `0x000D0042` | aucune ; événement à `0x11329c + 0x20` |
| 14 | `0x000E0000` | GetRecvFinishedEvent | `iru_GetRecvFinishedEvent` | `0x10b978` | `0x000E0042` | aucune ; événement à `+0x24` |
| 15 | `0x000F0000` | GetTransferState | `iru_GetTransferState` | `0x10be94` | `0x000F0080` | aucune ; rend l'octet `+5` |
| 16 | `0x00100000` | GetErrorStatus | `iru_GetErrorStatus` | `0x10b61c` | `0x00100080` | aucune ; rend l'octet `+6` |
| 17 | `0x00110040` | SetSleepModeActive | `iru_SetSleepModeActive` | `0x10b85c` | `0x00110040` | état 1 sinon `0xC8A10FF0` ; range l'octet à `+0` |
| 18 | `0x00120040` | SetSleepModeState | `iru_SetSleepModeState` | `0x10bde8` | `0x00120040` | verrou, veille, état 1 ; 0 : active le composant, sinon le réinitialise |

### `ir:rst` (9 commandes, aiguillage `0x10ab4c`)

Le matériel de la New 3DS. Deux sessions au plus (3dbrew : « deux sessions depuis la 8.0.0 »). Le module garde une table de deux sessions (`0x114568`), un état par session (1 ou 2 : pas encore démarrée ou démarrée).

| N° | En-tête de requête | Commande (3dbrew) | Fonction | Adresse | Réponse | Ce que le code vérifie |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010000` | GetHandles | `rst_GetHandles` | `0x104148` | `0x00010043` | rend 0, le descripteur `0x04000000` (deux poignées copiées), la poignée du bloc partagé (`0x114148 + 0x14`) et celle d'un événement (`0x113340 + 8`) |
| 2 | `0x00020080` | Initialize | `rst_Initialize` | `0x1041a8` | `0x00020040` | mot 1 de `10` à `21` sinon `0xE0E10FFD` ; déjà deux sessions démarrées : `0xD8210FF9` ; la première démarre le fil de lecture (`rst_thread_main`, `0x104764`, priorité 16) |
| 3 | `0x00030000` | Shutdown | `rst_Shutdown` | `0x103f5c` | `0x00030040` | tant qu'une autre session reste démarrée, ne fait que marquer la sienne ; la dernière arrête le fil ; rien de démarré : `0xD8210FF8` |
| 4 | `0x00040000` | (octet lu dans le composant) | `rst_cmd0004` | `0x104434` | `0x00040080` | `0xC8A10FF0` si l'émulation du Circle Pad Pro est active ; sinon lit un octet par le bus (`0x106224`) |
| 5 | `0x00050000` | (octet de l'état du module) | `rst_cmd0005` | `0x104184` | `0x00050080` | rend l'octet `0x114134 + 0xB` |
| 6 | `0x00060000` | (deux octets de l'état) | `rst_cmd0006` | `0x10454c` | `0x000600C0` | rend les octets de `0x113332` et `0x113333` |
| 7 | `0x00070080` | (deux octets en entrée) | `rst_cmd0007` | `0x104b68` | `0x00070040` | `0xE0A10FEA` si la console n'a pas ce matériel ; sinon lance le calcul d'étalonnage (`0x1029f0`) avec les deux octets |
| 8 | `0x00080080` (d'après les deux paramètres lus ; non vérifié) | (deux octets en entrée) | `rst_cmd0008` | `0x10463c` | `0x00080040` | `0xE0A10FEA` sans ce matériel ; range les deux octets en `0x113332`, `0x113333` |
| 9 | `0x00090000` | (deux octets de la config) | `rst_cmd0009` | `0x104688` | `0x000900C0` | `0xE0A10FEA` sans ce matériel ; lit le bloc de configuration `0x00040004` (28 octets) et rend ses deux premiers octets |

`cfg_check_cstick_present` (`0x108750`) est le test « ce matériel existe » : sur une console de développement il rend 0 ; sinon il lit le bloc de configuration `0x00130000` (4 octets, par `cfg:u`/`cfg:s`) et en rend un bit (interprété).

## Partie 4 : l'initialisation, puis l'envoi d'un paquet

### InitializeIrnopShared pas à pas

C'est la première commande utile que Pokémon X envoie (la 24). L'arrivée : `iruser_handle_command` vérifie l'en-tête `0x00180182` et que le mot 7 est nul (poignée copiée), puis appelle `iruser_InitializeIrnopShared` (par la vtable), qui prend le verrou `0x11409c`, appelle `ir_initialize_shared` (`0x10d1c0`), qui appelle `ir_initialize_common` (`0x10cec0`) avec le drapeau « partagé » à 1 (pour la commande 1, `0x10c4ac` l'appelle avec 0). Les arguments sont, dans l'ordre des mots de la requête : taille de la page partagée S, taille du tampon de réception R, nombre de paquets de réception Pr, taille du tampon d'envoi E, nombre de paquets d'envoi Pe, vitesse (un octet), puis la poignée de la page.

1. **Verrou.** Si `0x113294` est levé : la poignée est refermée et le résultat est `0xF9610C02`.
2. **Déjà initialisé.** Si l'octet `0x1132c8` vaut 1 : la poignée est refermée, `0xD8210FF9`.
3. **Tailles.** Il faut `R + E + 0x30 <= S` (le `0x30` n'est ajouté qu'en mode partagé), `Pr × 8 <= R` et `Pe × 8 <= E`. Sinon la poignée est refermée et le résultat est `0xE0E10FEC`.
4. **Le composant.** `0x10733c` le remet à zéro, `ir_set_bit_rate` (`0x10738c`) range la vitesse (valeurs de 3 à `0x12` ; le résultat est ignoré par `ir_initialize_common`, une valeur hors de l'intervalle n'est donc pas signalée), `0x108c00` l'allume. Si l'allumage échoue, le verrou `0x113294` est levé et le résultat est `0xF9610C02`.
5. **La page.** `map_shared_memory` (`0x10e424`) projette le bloc (S doit être multiple de `0x1000`, sinon `0xE0E01BF2`) avec les perms 3 (lecture et écriture) pour le module et 1 (lecture) pour le client. L'objet de la page est à `0x113dc4` : poignée à `+0x14`, adresse à `+8`.
6. **L'en-tête et les deux anneaux.** En mode partagé l'en-tête commun est au début de la page (`0x113dc4 + 0x2c` sinon) ; l'anneau de réception commence à `base + 0x10`, de taille `R + 0x10`, celui d'envoi juste après, à `base + 0x20 + R`, de taille `E + 0x10` (`recv_ring_init`, `0x109d8c`, et `send_ring_init`, `0x106604`). Chaque anneau est décrit dans la partie 5.
7. **Les événements.** Trois événements à remise à zéro automatique, rangés à `0x113de4` (`+0x20`, `+0x24`, `+0x28` de l'objet de la page) : réception, envoi, état de la liaison. Plus un quatrième (`0x1132d4`) pour réveiller le fil et un petit verrou (`0x113310`).
8. **L'état de départ.** `srand` (`0x100124`) est amorcé avec l'horloge ; `random_byte` (`0x107ffc`) donne l'identifiant de la machine (`0x1132c8 + 0xB`). Dans l'en-tête partagé : liaison `+8` = 0, `+0xA` = 0, `+0xB` = 0, `+0xE` = 1 (« actif »). Dans `0x1132c8` : `+6` = 0, `+8` = 0 (pas de commande en attente), `+1` = 1 (le fil tourne).
9. **Le fil est réveillé** (barrière `0x113298`, événement `0x1132d4`) et l'octet `0x1132c8` passe à 1. Résultat 0.

### SendIrnop pas à pas

1. **Le choix de la commande.** Le client prend `SendIrnop` pour une taille inférieure à `0xFD`, `SendIrnopLarge` au-delà (Pokémon X : `0x1e6634`). Dans la requête `0x000D0042` : mot 1 = taille, mot 2 = `(taille << 14) | 2` (tampon statique 0), mot 3 = adresse ; `0x000E0042` : mot 2 = `(taille << 4) | 10` (tampon en lecture projeté).
2. **L'aiguillage** (`0x10a4bc`, cas 13 ou 14) vérifie l'en-tête en entier et le descripteur (`mot 2 & 0x3C0F == 2` pour 13, `& 0xF == 10` pour 14), puis appelle l'entrée 6 (`+0x18`) de la vtable de `ir:USER` avec l'adresse et la taille.
3. **`iruser_SendIrnop_virtual`** (`0x105c1c`, 1 440 octets) prend le verrou `0x11409c`. Si le bit 0 de l'octet `0x114140` est à 0 (c'est le cas après `InitializeIrnopShared`), elle appelle `ir_send_packet` ; sinon elle traite le paquet comme une commande de l'émulation du Circle Pad Pro (cas 1 à 5 du premier octet du paquet : partie 8).
4. **`ir_send_packet`** (`0x10e11c`) : verrou `0xF9610C02` ; veille `0xC8A10C01` ; liaison pas 2 : `0xC8A10C0D`. Elle construit l'en-tête de trame : octet 0 = `0xA5`, octet 1 = l'identifiant de la machine (`+0xD` de l'en-tête partagé), octet 2 = la taille sur 6 bits (taille < `0x40`, bit 6 à 0) ou `0x40` plus les 6 bits de poids fort de la taille (octet 3 : l'octet de poids faible) ; le bit 7 de l'octet 2 est mis à 0 (les trames de contrôle l'ont à 1 : l'octet `0x81` est celui de la déconnexion, partie 6). Taille `0x4000` ou plus : `0xE0E10FEC`.
5. **L'anneau d'envoi.** Sous le verrou de l'anneau, `ring_push_packet` (`0x1068a0`) écrit l'en-tête, les données et un octet de contrôle CRC-8 (polynôme `0x07`, table construite par `crc8_build_table`, `0x108574`, mise à jour par `crc8_update`, `0x109824`). Pas assez d'octets libres : `0xC8610C0F` ; plus de case de paquet : `0xC8610C10`. Puis `ring_commit_packet` (`0x10686c`) avance l'index d'écriture.
6. **Le réveil du fil.** `svcSignalEvent(0x11328c)`. Le fil de communication passe dans `iruser_state_connected` (`0x105558`) qui appelle `ir_connected_step` (`0x10d484`) : s'il y a un paquet à envoyer, `ir_transmit_bytes` (`0x106fa0`) le pousse au composant par des écritures de tampon sur le bus (`I2CIR_cmd0011`, composant d'adresse `0xD`), et, une fois fini, lève l'événement d'envoi (le deuxième de `0x113de4`).
7. **Le résultat** rendu au client est 0 dès que le paquet est dans l'anneau (la suite est asynchrone). L'en-tête de réponse est `0x000D0040`.

### La liaison

Le fil traite une commande à la fois (octet `+8` de `0x1132c8`, posé par les fonctions de la partie 3 avant de réveiller le fil) : 1 arrêt, 2 vider la réception, 3 vider l'envoi, 4 WaitConnection, 5 RequireConnection, 6 AutoConnection, 7 AnyConnection, 8 Disconnect. Les commandes 4, 5 et 6 mettent la liaison à 1, la 7 la met directement à 2, la 8 la met à 3 puis, après avoir envoyé une trame de déconnexion (`0xA5`, identifiant, `0x81`) quand elle était à 2, à 0 en levant l'événement d'état. La liaison passe à 4 sur une erreur du composant. Le détail du protocole de connexion est dans `ir_connect_step` (`0x10d914`, 2 012 octets), non lue.

## Partie 5 : la mémoire partagée de `ir:USER`

La page est à l'adresse que le client a lui-même réservée ; le module la lit et l'écrit, le client la lit (perms 1). Disposition (taille de page `S`, tampons `R` et `E`) :

| Décalage | Taille | Contenu |
| --- | --- | --- |
| `0x00` | 4 | dernier résultat d'erreur de réception (`GetLatestReceiveErrorResult`) |
| `0x04` | 4 | dernier résultat d'erreur d'envoi |
| `0x08` | 1 | état de la liaison, de 0 à 4 |
| `0x09` | 1 | (écrit à 1, 2 ou 3 selon la commande de liaison, usage non lu) |
| `0x0A` | 1 | rôle de la connexion (`GetConnectionRole`) |
| `0x0B` | 1 | octet de `SetOwnMachineId` |
| `0x0C` | 1 | octet donné à `WaitConnection`, `RequireConnection` ou `AutoConnection` |
| `0x0D` | 1 | identifiant de la machine, mis dans chaque trame |
| `0x0E` | 1 | 1 quand le module est actif, 0 en veille |
| `0x10` | 16 | en-tête de l'anneau de réception : indice du plus ancien paquet, indice d'écriture, nombre de paquets |
| `0x20` | `Pr × 8` | table des paquets reçus : pour chacun (décalage dans la zone de données, longueur de la trame y compris son en-tête de 3 ou 4 octets et son octet de contrôle) |
| ensuite | `R − Pr × 8` | zone de données de réception, en anneau |
| `0x20 + R` | 16 | en-tête de l'anneau d'envoi (mêmes trois mots) |
| ensuite | `Pe × 8`, puis `E − Pe × 8` | table des paquets envoyés, puis zone de données d'envoi |

Cette disposition est celle que le jeu retrouve : `iruser_open_session` (`0x1e4e44`) construit son lecteur de l'anneau de réception à `base + 0x10`, de taille `R + 0x10`, avec `Pr` cases. Les commandes 21 et 22 rendent quatre mots : octets libres, cases libres, octets utilisés, cases utilisées de chaque anneau.

## Partie 6 : le matériel infrarouge

Le composant n'est pas lu directement : tout passe par `i2c::IR` (le bus) et `gpio:IR` (une broche d'interruption). Le composant est l'appareil d'adresse `0xD` du bus ; sa broche est la `0x40` de `gpio:IR` (`gpioir_attach_interrupt` configure la broche par les commandes 2, 4 et 6, puis la lie à l'événement `0x11328c` avec la priorité 8). La numérotation des commandes de `i2c::IR` est propre à ce service. Rien dans ce module n'indique le sens des registres du composant (interprété).

## Partie 7 : les services que ir appelle

26 appels à `svcSendSyncRequest` (`0x32`) et 26 fonctions de requête (celle de `SRV_GetServiceHandle` est à `0x102250`, partagée par `srv_get_service_handle` et `srv_get_service_handle_by_name`).

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x1133ec` | `0x00010002` | `SRV_RegisterClient` | `0x101350` | se déclarer |
| | | `0x00020000` | `SRV_EnableNotification` | `0x101af4` | sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x10138c` | créer les trois services |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x1013e8` | les retirer |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x102250` | ouvrir `i2c::IR`, `gpio:IR`, `cfg:s`, `ptm:s` |
| | | `0x00090040` | `SRV_Subscribe` | `0x10143c` | s'abonner à `0x104` et `0x105` |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x101b30` | lire le numéro reçu |
| `cfg:s` | `0x1133fc` | `0x04010082` | `CFG_GetConfigInfoBlk8` | `0x102720` | lire des blocs (dont `0x00040004`) |
| | | `0x04020082` | `CFG_SetConfigInfoBlk4` | `0x102770` | écrire un bloc |
| | | `0x04030000` | `CFG_UpdateConfigNANDSavegame` | `0x1027bc` | enregistrer |
| | `0x113400` | `0x00010082` | `CFG_GetConfigInfoBlk2` | `0x10eb8c` | lire un bloc (`0x00130000`) |
| `gpio:IR` | `0x1133b8` | `0x00020080` | `GPIOIR_cmd0002` | `0x108da4` | régler la broche |
| | | `0x00040080` | `GPIOIR_cmd0004` | `0x108aa4` | idem |
| | | `0x00060080` | `GPIOIR_cmd0006` | `0x108a6c` | idem |
| | | `0x00070040` | `GPIOIR_GetGPIOData` | `0x10ef68` | lire la broche |
| | | `0x00080080` | `GPIOIR_cmd0008` | `0x108d60` | régler la broche |
| | | `0x00090082` | `GPIOIR_BindInterrupt` | `0x10295c` | lier l'interruption |
| | | `0x000A0042` | `GPIOIR_UnbindInterrupt` | `0x1029ac` | la délier |
| `i2c::IR` | `0x113284` (copie `0x113288`) | `0x000500C0` | `I2CIR_WriteRegister8` | `0x108af0` | écrire un registre |
| | | `0x00060080` | `I2CIR_cmd0006` | `0x108d04` | (non lue) |
| | | `0x00090080` | `I2CIR_cmd0009` | `0x1089d0` | (non lue) |
| | | `0x00150080` | `I2CIR_cmd0015` | `0x108ca4` | écriture avec un tampon statique |
| | | `0x001100C2` | `I2CIR_cmd0011` | `0x10ee68` | envoi d'un tampon au composant (octets de l'anneau d'envoi) |
| | | `0x001200C2` | `I2CIR_cmd0012` | `0x10eec0` | lecture d'un tampon du composant |
| `ptm:s` | `0x113484` | `0x04030042` | `PTMSYSM_NotifySleepPreparationComplete` | `0x10ef18` | accuser réception de `0x104` et `0x105` |
| `err:f` (port) | connexion faite à chaque erreur | `0x00010800` | `ERRF_Throw` | `0x1027f4` | erreur fatale |

Les noms `GPIOIR_cmd…` et `I2CIR_cmd…` portent le numéro de la commande : ces numéros n'ont pas de nom connu. `GPIOIR_BindInterrupt`, `UnbindInterrupt` et `GetGPIOData` ont les mêmes en-têtes que `GPIOHID_…` de [hid](hid.md) ; `I2CIR_WriteRegister8` a celui de `I2CHID_WriteRegister8`.

## Partie 8 : l'émulation du Circle Pad Pro (New 3DS)

`ir:USER` se fait aussi passer pour un Circle Pad Pro avec le matériel de la New 3DS. Le bit 0 de `0x114140` dit si l'émulation est active. Dans ce cas :

- `iruser_state_connecting` (`0x105a04`) ne passe pas par le composant : quand la commande de liaison demandée porte l'octet `0x0C` à 1 et que le module est sur une New 3DS, elle met tout de suite la liaison à 2 et le rôle à 1, puis à 2, lève l'événement d'état, et prend pour identifiant de machine un nombre au hasard. Pokémon X envoie 0 dans cet octet : l'émulation n'est pas utilisée.
- `iruser_SendIrnop_virtual` (`0x105c1c`) lit le premier octet du paquet : 1 règle la période de lecture (de 10 à 21 ms), 2 et 3 lisent ou écrivent des paquets de 16 octets dans un tableau de 8 entrées, 4 le réinitialise, 5 en rend un.

Le bloc de configuration `0x00040004` est celui des étalonnages (lu par `ir:rst` commande 9). Cette partie n'est pas détaillée (voir « pas lu »).

## Partie 9 : ce que Pokémon X envoie

Les treize lignes d'`ir:USER` de `pokemon-x-services.tsv`. Les fonctions du jeu (`iruser_*`) sont celles de l'inventaire ; la bibliothèque est dans `0x1e4e44`–`0x1e6bdc`, son utilisateur est l'adaptateur `gflnet_IrAdapter` (`0x3fdd9c` et suivants, d'après le nom de fichier gardé dans la chaîne du jeu). Le jeu ouvre `ir:USER` avec `srv_get_service_handle` (drapeau 0).

**À retenir pour un portage sans infrarouge.** Le jeu ne lit pas les paquets reçus par des commandes : il lit la page partagée directement (états de la liaison, anneau de réception) et ne passe par les commandes que pour avancer les index (ReleaseReceivedData), vider (ClearReceiveBuffer) et envoyer. Les erreurs de niveau `0xC8…` (le « niveau 25 » du code de résultat) sont tolérées par le jeu : il les ignore, ainsi que `0xF9610C02`. Toute autre erreur négative est fatale chez lui.

| En-tête | Commande | Fonction du jeu | Fonction du module (adresse) | Ce que le jeu envoie | Ce qu'il faut rendre |
| --- | --- | --- | --- | --- | --- |
| `0x00180182` | InitializeIrnopShared | `iruser_InitializeIrnopShared` (`0x1e6864`), par `iruser_open_session` (`0x1e4e44`) | `iruser_InitializeIrnopShared` (`0x105330`) | S = `0x2000` (page créée par le jeu : perms 1 pour lui, 3 pour le module), R = 602 (`0x25A`), Pr = 2, E = 602, Pe = 2, vitesse 3 | 0 ; projeter la page, écrire l'en-tête de la partie 5 (liaison 0, octet `+0xE` à 1, le reste à 0), deux anneaux vides aux décalages de la partie 5 |
| `0x00020000` | FinalizeIrnop | `iruser_FinalizeIrnop` (`0x1e66f4`), par `0x1e6b78` | `iruser_FinalizeIrnop` (`0x104c78`) | rien | 0 (toute erreur négative est fatale côté jeu) ; le jeu referme ensuite la page et la session |
| `0x00030000` | ClearReceiveBuffer | `iruser_ClearReceiveBuffer` (`0x1e67fc`), par `0x1e5db0` | `iruser_ClearReceiveBuffer` (`0x10c71c`) | rien | 0 ou `0xC8A10C0D` (tolérée) ; vider l'anneau de réception |
| `0x000702C0` | AutoConnection | `iruser_AutoConnection` (`0x1e6724`), par `0x1e509c` | `iruser_AutoConnection` (`0x10c11c`) | octet 0, un délai de `0x2dc6c0` (3 000 000) au mot 2, et quatre valeurs 64 bits calculées par `0x1e62d8` à partir de tableaux du jeu | 0, puis une liaison à 1 tant que l'on cherche un partenaire |
| `0x00090000` | Disconnect | `iruser_Disconnect` (`0x1e6688`), par `0x1e4fe4` | `iruser_Disconnect` (`0x10beb0`) | rien | 0 ou `0xC8A10C0D` ; liaison à 0 et événement d'état levé |
| `0x000A0000` | GetReceiveEvent | `iruser_GetReceiveEvent` (`0x1e67c0`), par `0x1e5d44` | `iruser_GetReceiveEvent` (`0x10c494`) | rien | 0 et une poignée d'événement valide (le jeu la referme plus tard) |
| `0x000B0000` | GetSendEvent | `iruser_GetSendEvent` (`0x1e66b8`), par `0x1e5c30` | `iruser_GetSendEvent` (`0x10bf60`) | rien | idem |
| `0x000C0000` | GetConnectionStatusEvent | `iruser_GetConnectionStatusEvent` (`0x1e691c`), par `0x1e6218` | `iruser_GetConnectionStatusEvent` (`0x10d2d8`) | rien | idem |
| `0x000D0042` | SendIrnop | `iruser_SendIrnop` (`0x1e69a4`), par `0x1e6634` | `iruser_SendIrnop_virtual` (`0x105c1c`) | taille inférieure à `0xFD` | 0 si connecté ; `0xC8A10C0D` (tolérée) sinon |
| `0x000E0042` | SendIrnopLarge | `iruser_SendIrnopLarge` (`0x1e6778`), par `0x1e6634` | `iruser_SendIrnopLarge` (`0x10c2a0`) | taille de `0xFD` ou plus | idem |
| `0x00110040` | GetLatestReceiveErrorResult (3dbrew) ; « inconnue » dans la Carte | `iruser_cmd_00110040` (`0x1e6958`), par `0x1e6284` | `iruser_GetLatestReceiveErrorResult` (`0x10d42c`) | un octet « remettre à zéro » | 0 et une valeur (0 s'il n'y a pas eu d'erreur) |
| `0x00160000` | GetSendSizeFreeAndUsed (3dbrew) ; « inconnue » dans la Carte | `iruser_cmd_00160000` (`0x1e68bc`), par `0x1e61a4` | `iruser_GetSendSizeFreeAndUsed` (`0x10d1e8`) | rien | 0 et quatre mots (octets libres, cases libres, utilisés, utilisées) : 586, 2, 0, 0 à vide |
| `0x00190040` | ReleaseReceivedData | `iruser_ReleaseReceivedData` (`0x1e682c`), 2 appelants | `iruser_ReleaseReceivedData` (`0x10cde8`) | le nombre de paquets lus | 0 ; avec un anneau vide, `0xC8810FEF` ou `0xC8A10C0D` sont tolérées |

Ce que le jeu lit dans la page (`0x1e5e18`, `0x1e69f0`, `0x1e6284`) : l'octet de liaison `+8` (`4` → il rend `0xF9610C02`, c'est l'état d'erreur ; `1` ou `2` ne donnent pas la même suite), l'octet `+0xE` (0 → il rend `0xC8A10C01`), le mot `+0` (dernier résultat d'erreur de réception), puis l'anneau de réception à `base + 0x10`.

**Sans partenaire infrarouge** (le cas du PC), le comportement le plus simple est : `InitializeIrnopShared` réussit, `AutoConnection` réussit et laisse la liaison à 1, rien n'arrive jamais dans l'anneau de réception, `Disconnect` remet la liaison à 0 et lève l'événement d'état. Le jeu laisse son propre écran d'attente et son annulation faire le reste (interprété : pas vérifié en lançant le jeu).

## Les désaccords relevés

- **Carte des services.** Elle ne connaît pas les commandes 17 (`0x00110040`) et 22 (`0x00160000`) de `ir:USER`, que 3dbrew nomme `GetLatestReceiveErrorResult` et `GetSendSizeFreeAndUsed`. Le code les reçoit avec ces réponses : un résultat et une valeur pour la 17, un résultat et quatre mots pour la 22.
- **3dbrew, `ir:USER`.** La page donne le seuil `0xFC` pour choisir entre `SendIrnop` et `SendIrnopLarge`, et le jeu coupe à `0xFD` (`< 0xFD`, donc `<= 0xFC`) : accord. Le module, lui, coupe son en-tête de trame à `0x40` octets de données, ce qui n'a rien à voir avec ce choix.
- **3dbrew, `ir:rst`.** Les commandes 7 et 8 sont données avec `(u8 unk0, u8 unk1)` (l'en-tête de la 8 est `0x00080000` dans la copie lue, alors que le code lit deux paramètres) ; le code les lit comme des paires d'octets, la 7 en lançant le calcul de l'étalonnage, la 8 en rangeant en mémoire. La commande 6 y est « deux octets de l'état » et la 9 « deux octets » d'une fonction d'étalonnage : les noms de cette fiche sont neutres.
- **3dbrew, `ir:u`.** Les noms de 10 (`GetBitRate`) et 11 (`SetIRLEDState`) vont avec des en-têtes qui concordent mais la lecture des fonctions n'a pas permis de confirmer le détail.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les trois services, leur nom et leur nombre de sessions (1, 1, 2) : la table de la section en lecture seule (`0x111060`) et l'appel à `SRV_RegisterService` dans `ir_main` d'un côté ; 3dbrew de l'autre (« une session, deux depuis la 8.0.0 »). La poignée `ir:USER` rendue au jeu par `sm` (inventaire) est le même nom.
- Les 18, 26 et 9 commandes des trois aiguillages, leur fonction et leur en-tête de réponse : le pseudo-code de Ghidra de `iru_handle_command`, `iruser_handle_command` et `rst_handle_command` d'un côté ; `emulate_dispatch.py` de l'autre. Les en-têtes de 3dbrew tombent sur les mêmes numéros pour `ir:u` (18) et `ir:USER` (26).
- Les vérifications d'en-tête entier : les cinq cas de `ir:USER` (1, 13, 14, 16, 24) et les deux de `ir:u` (3, 5) : pseudo-code et `emulate_dispatch.py` d'accord.
- Les services appelés : l'exheader déclare `cfg:s`, `gpio:IR`, `i2c::IR` et `ptm:s`, et ce sont les noms que le code ouvre (chaînes à `0x111000`, `0x111008`, `0x11230c`, `0x112321`). Les 26 fonctions de requête correspondent aux 26 `svc 0x32`.
- Les arguments de `InitializeIrnopShared` et leurs vérifications (tailles, `+0x30`, 8 octets par case) : le pseudo-code et l'assembleur de `0x10cec0`, `0x10c4ac` et `0x10d1c0` (le drapeau « partagé » est posé à la main par les deux enveloppes) d'un côté ; de l'autre l'envoi du jeu (`0x1e6864`) et son propre lecteur d'anneau construit avec les mêmes décalages (`0x1e4e44`).
- La disposition de la page partagée (en-tête de 16 octets, anneau de réception à `+0x10`, anneau d'envoi après) : le code des deux initialisations d'anneau (`recv_ring_init`, `send_ring_init`) et la lecture du jeu.
- Le format de trame (`0xA5`, identifiant, taille sur 6 ou 14 bits, données, CRC-8) : l'assembleur de `ir_send_packet` et le décodage symétrique de `ring_push_packet` et de `iruser_ReceiveIrnop` (qui relit la taille de la même façon).
- La liaison à 4 chiffres, côté module (les commandes qui la lisent) et côté jeu (qui compare l'octet `+8` aux mêmes valeurs 1, 2, 4).
- Les événements : les trois poignées sont créées à la suite à `0x113de4` et rendues par les trois commandes 10, 11, 12 ; elles sont levées aux endroits décrits (réception, envoi, état).
- Les notifications `0x100`, `0x104`, `0x105` et le message envoyé à `ptm:s` : pseudo-code ; la fiche de [ptm](ptm.md) donne la même chaîne pour les autres modules.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens des valeurs de la liaison (0 à 4) et des codes de commande du fil (1 à 8) : déduit de ce que les fonctions de la partie 3 écrivent et de ce que le fil en fait ; seule la liaison 4 est confirmée par le jeu comme « erreur ».
- Les cinq valeurs 64 bits d'`AutoConnection` : le module en retient les différences, le sens de chacune (délais en nanosecondes ?) n'est pas démontré.
- Le rôle de chaque test de verrou : `0x113294` levé dès qu'un appel au composant échoue (reconnaissable : toutes les fonctions qui touchent au matériel le lèvent et rendent `0xF9610C02`).
- Les 16 valeurs de vitesse de `ir_set_bit_rate` (3 à `0x12`) : ce sont des constantes envoyées au composant ; le lien avec une vitesse réelle n'est pas lu.
- Le sens de `0x113550` (service courant), de l'octet `+5` d'`ir:u` et de la barrière `0x113310` : usage lu, pas nommé par le code.
- `ir:rst` : ses commandes 4 à 9 (étalonnage, deux octets de l'état), le contenu de sa page de `0x98` octets (en-tête de `0x18` octets puis 8 entrées de 16 octets, d'après les constructeurs), son fil de lecture.
- L'émulation du Circle Pad Pro (partie 8) : la lecture suit les cas du premier octet d'un paquet mais pas les calculs.
- La suite de l'envoi d'un paquet (étape 6 de SendIrnop) : `ir_connected_step` et `ir_transmit_bytes` ont été lus en gros (les écritures sur le bus, l'événement d'envoi), pas ligne à ligne.
- Le comportement de Pokémon X sans partenaire (fin de la partie 9) : déduit des tolérances d'erreur ; non essayé.
- Le nom de 3dbrew de la commande 10 d'`ir:u` (`GetBitRate`) et de la 11 (`SetIRLEDState`).

**Pas lu**
- `ir_connect_step` (`0x10d914`, 2 012 octets), `ir_connected_step` au-delà de l'envoi (`0x10d484`), `ir_receive_bytes` (`0x106bfc`) : le protocole de connexion, la réception, la reprise sur erreur.
- `iru_thread_main` (`0x10b684`) et `0x10b068` : le fil d'`ir:u`.
- L'initialisation du composant (`0x10253c`, `0x102344`, `0x1088dc`, `0x1033cc`) : les écritures de registres.
- `rst_thread_main` (`0x104764`), le calcul d'étalonnage (`0x1029f0`, 924 octets), `0x10a030`, `0x10f208`, `0x10f30c` (le calcul des valeurs du pad).
- La bibliothèque de flottants (`0x1034d4` : un reste de division flottante, `0x103ac8`), les gestionnaires de tas (`0x1030cc`, `0x10362c`, `0x1033cc`).
- 256 fonctions restent sans nom, en grande partie la bibliothèque et les petits accesseurs des anneaux.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 455 fonctions, projet Ghidra | `outils/ghidra_direct.py ir` | une demi-minute |
| Tables des trois aiguillages | `outils/emulate_dispatch.py ir 0x10a170=ir:u 0x10a4bc=ir:USER 0x10ab4c=ir:rst` | quelques secondes |
| Assembleur du module | objdump de devkitPro (`code.asm`) | immédiat |
| Exheader (services, dépendances) | un petit script Python | immédiat |
| Pseudo-code avec les constantes des tables de littéraux remplacées, côté module et côté jeu | un script Python (`pc.py`), qui lit la valeur des mots dans `code.bin` | immédiat |
| Lecture, nommage | Claude | le gros du temps |
| 3dbrew : « IR Services » (version du 4 juillet 2017, `oldid=20136`) | web.archive.org, capture de 2022 (la capture la plus récente rendait une erreur 503) | |

Les scripts et le brut sont dans `local/analyse/ir/` et `local/analyse/` (non versionné).

**Pour reprendre.** `ir.noms.tsv` est le fichier de graines. Les noms `SRV_`, `CFG_`, `GPIOIR_`, `I2CIR_`, `PTMSYSM_`, `ERRF_` sont les requêtes envoyées à d'autres services ; `iruser_`, `iru_` et `rst_` sont les commandes reçues de chaque service (avec `_handle_command` pour les aiguillages et `_thread_main` pour les fils). Les trois fonctions à relire en premier : `ir_connect_step`, `ir_connected_step`, `ir_receive_bytes`.
