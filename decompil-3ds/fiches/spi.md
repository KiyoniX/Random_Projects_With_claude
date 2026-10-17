# spi, les trois bus SPI

`spi` pilote les bus SPI de la console, ceux de la mémoire flash de configuration (celle que lit `cfg:nor`), de la puce du codec et de l'écran tactile (celle de `codec`). Cinq services offrent les mêmes neuf commandes ; chacune prend un numéro d'appareil (0 à 6), un petit tampon à écrire (quatre octets au plus), et soit lit la réponse, soit écrit un second tampon. Le module n'attend aucune interruption : il **scrute** les registres de contrôle du bus jusqu'à la fin du transfert. Chaque appareil a deux interfaces matérielles possibles, l'ancienne (celle de la DS, un octet à la fois) et la rapide de la 3DS (une FIFO de 32 bits), et le client choisit laquelle par appareil.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), l'aiguillage rejoué par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020002302`, version 4.0.0, un titre de la CTRNAND (lu dans l'exheader ; nom `spi`) ; la NAND porte aussi `spi-safe` (mode sans échec, non lu) |
| Fichier lu | `local/extrait/spi/exefs/code.bin` et `exheader.bin` |
| Taille | 14 112 octets de code (`0x3720`), 484 de données en lecture seule (`0x1e4`), 128 de données (`0x80`), 1 464 de mémoire à zéro (`0x5b8`) ; pile de 4 096 octets ; priorité de départ 9 |
| Fonctions | 160 (143 pour Ghidra et 17 entrées manquées), 8 en Thumb, 152 en ARM |
| Services offerts | cinq, une session au plus chacun : `SPI::NOR`, `SPI::CD2`, `SPI::CS2`, `SPI::CS3`, `SPI::DEF` (partie 2) |
| Services appelés | aucun : seulement `srv:` et le port `err:f`. La liste de services de l'exheader est vide |
| Autres accès | deux pages d'E/S, `0x1EC60000` et `0x1EC42000` (descripteurs `0xFFE1EC60` et `0xFFE1EC42`), et une plage d'une page `0x1EC40000` (descripteurs `0xFF81EC40` et `0xFF81EC41` : début et fin). Interruptions déclarées : `0x56` et `0x57`, **jamais liées** |
| Dépendances déclarées | aucune |
| Fils | le fil principal et **un fil par session ouverte** (pile de `0x1000` octets, jusqu'à cinq) |

## Partie 1 : le démarrage

`entry` (`0x100000`) enchaîne `clear_bss`, les constructeurs et `run_init_array`, puis appelle `spi_main` (`0x100160`, 940 octets). `spi_main` commence par `srv_init`, `register_notification_handler` pour la notification `0x100` (arrêt ; gestionnaire `on_terminate_notification`, `0x1033e8`) et `get_notification_semaphore`.

## Partie 2 : la boucle de serveur

`spi_main`, après l'initialisation :

1. **Les noms.** Cinq `SRV_RegisterService` (`0x100944`) dans l'ordre de la table de `0x105004` : `SPI::NOR`, `SPI::CD2`, `SPI::CS2`, `SPI::CS3`, `SPI::DEF` (numéros 0 à 4). 1 session au plus chacun, **5 au total**, comme dit 3dbrew.
2. **Les bus.** `spi_init_buses` (`0x100724`, une seule fois) crée les trois verrous de bus (`0x1050d0`, 12 octets chacun) et lit `CFG11_SPI_CNT` (`0x1EC401C0`) pour savoir quelle interface chaque bus utilise : bit 0 pour le bus de `0x1EC60000`, bit 1 pour celui de `0x1EC42000`, bit 2 pour le troisième. Les trois valeurs vont dans les octets `0x105019` à `0x10501B`.
3. **L'attente.** `svcWaitSynchronizationN` (`0x1005e0`, sans délai) sur six poignées : les cinq ports, puis le sémaphore des notifications.
   - Indice 5, le sémaphore : `handle_srv_notification` (`0x1007f8`).
   - Indices 0 à 4, un port : `svcAcceptSession`, puis `create_thread_on_heap_stack` lance **un fil pour cette session**, point d'entrée `spi_session_thread_main` (`0x100a9c`), argument le numéro de service. Si le service avait déjà un fil terminé, il est d'abord joint (`join_thread`). Le fil de `SPI::CD2` (numéro 1) a la priorité 15 et le processeur 3 ; les quatre autres ont la priorité 20 et le processeur par défaut (les priorités sont les 0x6c8da50f et 0x6c8da514 passés à `create_thread`, qui valent 15 et 20 après la conversion de la bibliothèque).
   - S'il y a déjà cinq sessions : la nouvelle est refermée.
4. **Un fil de session.** `spi_session_thread_main` appelle `session_receive_loop` (`0x100e34`) : `svcReplyAndReceive` sur la session, puis `spi_handle_command` (`0x10104c`). À la fermeture de la session, le fil ferme la poignée, décrémente le compteur (`0x105000`) et finit.
5. **La sortie.** Quand la notification `0x100` a été reçue : joint les fils, retire les services, `srv_exit`.

| N° | Service | Client (d'après les fiches) |
| --- | --- | --- |
| 0 | `SPI::NOR` | [cfg](cfg.md) (le service `cfg:nor` : lire et écrire la flash) |
| 1 | `SPI::CD2` | [codec](codec.md) |
| 2 | `SPI::CS2` | aucun module lu (le `codec` en contient le nom) |
| 3 | `SPI::CS3` | aucun module lu (le `codec` en contient le nom) |
| 4 | `SPI::DEF` | aucun module lu |

Le module **ne fait aucune différence entre les services** pour les commandes : tout client d'une session peut parler à n'importe quel appareil (de 0 à 6).

## Partie 3 : les commandes

`spi_handle_command` (`0x10104c`) lit l'en-tête dans le tampon du fil, prend le numéro dans les 16 bits du haut et saute à l'un de 9 cas. Un numéro inconnu rend l'en-tête `0x00000040` et `0xD900182F`. Seules les commandes 6 et 7 comparent l'en-tête entier ; pour les sept autres, seul le numéro compte. Un en-tête faux rend la réponse `0x00000040` et `0xD9001830`. Les noms de 3dbrew sont ceux de la page « SPI Services » ; les paramètres et les adresses sont lus dans le code et recoupés par `emulate_dispatch.py`.

Les « mots » sont ceux du tampon du fil : le mot 1 est le premier paramètre.

| N° | En-tête de requête | Commande (3dbrew) | Fonction | Adresse | En-tête de réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | (numéro seul) | SetDeviceState(devid, state) | `spi_SetDeviceState` | `0x1012e8` | `0x00010040` | range l'octet d'état (mot 2) dans la table des appareils et note l'appareil comme réglé (partie 4) |
| 2 | (numéro seul) | (neutre) | dans l'aiguillage | | `0x00020040` | ne fait rien, rend 0 |
| 3 | `0x00030100` | ReadWriteDevice | `spi_ReadWriteDevice` | `0x101510` | `0x00030440` | écrit au plus 4 octets (mot 2 ; mot 3 : leur nombre) puis lit au plus `0x40` octets (mot 4 : leur nombre) ; les octets lus reviennent dans la réponse, à partir du mot 2 |
| 4 | `0x00040500` | ReadWriteDevice2 | `spi_ReadWriteDevice2` | `0x10153c` | `0x00040040` | **deux écritures** sous la même sélection : au plus 4 octets (mot 2 ; mot 3 : nombre), puis au plus `0x40` octets (mots 4 à 19 ; mot 20 : nombre) |
| 5 | (numéro seul) | WriteDevice | `spi_WriteDevice` | `0x101308` | `0x00050040` | écrit au plus 4 octets (mot 2 ; mot 3 : nombre) |
| 6 | `0x00060102` | ReadWriteDeviceArray | `spi_ReadWriteDeviceArray` | `0x10143c` | `0x00060042` | comme 3, mais les octets lus vont dans un tampon du client (descripteur `0xC` : le module écrit chez le client) |
| 7 | `0x00070102` | ReadWriteDevice2Array | `spi_ReadWriteDevice2Array` | `0x10141c` | `0x00070042` | comme 4, mais le second tampon à écrire est un tampon du client (descripteur `0xA` : le module le lit) |
| 8 | (numéro seul) | EnableSpiBus(devid, onoff, state) | `spi_EnableSpiBus` | `0x10145c` | `0x00080040` | choisit l'interface rapide ou l'ancienne pour le bus de l'appareil, et range l'octet d'état |
| 9 | (numéro seul) | EnableTwlSpiBus?(onoff) | `spi_EnableTwlSpiBus` | `0x1014ec` | `0x00090040` | met à 0 ou à 1 le bit 2 de `CFG11_SPI_CNT` |

Notes sur les cas :

- **Les noms de 3dbrew pour 4 et 7.** « ReadWriteDevice2 » est trompeur : le code (partie 4) écrit deux tampons à la suite, il ne lit rien.
- **La taille.** Pour toutes les commandes de transfert, une taille du premier tampon supérieure à 4 donne `0xE0E03FFD` (niveau 28, résumé 7, module 15, description 1021). Pour les commandes 3 et 4, si la taille du second tampon dépasse `0x40`, la fonction revient sans rien faire (le test est dans `spi_ReadWriteDevice` et `spi_ReadWriteDevice2`) ; pour 6 et 7, la taille est celle du descripteur de tampon du client.
- **Appareil non réglé.** Un transfert sur un appareil qui n'a reçu ni `SetDeviceState` ni `EnableSpiBus` rend `0xC8A03FF8` (niveau 25, résumé 5, module 15, description 1016).
- **Le résultat.** Les cinq fonctions de transfert rendent 0 une fois le transfert fini ; une erreur est un des deux codes ci-dessus. Aucun délai : le fil du client attend que le module ait fini.

## Partie 4 : le matériel

### Les appareils

Le numéro d'appareil sert à choisir la page et la sélection de puce. Le module (dans toutes les fonctions de transfert) et 3dbrew (« SPI Registers », table NSPI_CNT) donnent la même table :

| Appareil | Bus (page) | Sélection | Interface rapide (NSPI) | Ancienne interface |
| --- | --- | --- | --- | --- |
| 0, 1, 2 | `0x1EC60000` (3dbrew : bus 3) | 0, 1, 2 | `0x1EC60800` | `0x1EC60000` |
| 3, 4, 5 | `0x1EC42000` (3dbrew : bus 1) | 0, 1, 2 | `0x1EC42800` | `0x1EC42000` |
| 6 | `0x1EC43000` (3dbrew : bus 2) | 0 | `0x1EC43800` | (non gérée) |

La page de l'appareil 6, `0x1EC43000`, n'est pas dans la liste des pages de l'exheader. Ce chemin n'est donc probablement jamais pris ici (interprété).

### L'ancienne interface (octet par octet)

Fonctions `spi_old_write` (`0x102324`), `spi_old_write_read` (`0x1026f8`) et `spi_old_write_write` (`0x1027f0`). Registres de 3dbrew : `SPI_CNT` (16 bits, `+0x0`) et `SPI_DATA` (8 bits, `+0x2`).

1. Valeur du contrôle : `état | (sélection << 8)`, où l'état est l'octet rangé par la commande 1 ou 8 (cadence dans les bits 0 et 1, d'après 3dbrew).
2. Écrit `contrôle | 0x8800` (activé, sélection maintenue), puis, pour chaque octet à écrire : écrit l'octet dans `DATA` et attend que le bit 7 (occupé) retombe.
3. Pour lire : écrit 0 dans `DATA`, attend, lit `DATA`. Pour la seconde écriture de `spi_old_write_write`, écrit l'octet suivant du second tampon.
4. Pour le **dernier octet** : écrit `contrôle | 0x8000` (sélection relâchée) avant l'octet.

### L'interface rapide (NSPI)

Fonctions `spi_nspi_write` (`0x1023d4`), `spi_nspi_write_read` (`0x1028e0`) et `spi_nspi_write_write` (`0x102b30`). Registres de 3dbrew, au décalage `0x800` de la page : `NSPI_CNT` (`+0x800`, 32 bits), `NSPI_DONE` (`+0x804`), `NSPI_BLKLEN` (`+0x808`), `NSPI_FIFO` (`+0x80C`), `NSPI_STATUS` (`+0x810`). Écriture :

1. Attend que le bit 15 de `NSPI_CNT` (occupé) retombe.
2. `BLKLEN` reçoit le nombre d'octets, `CNT` reçoit `cadence | (sélection << 6) | 0xA000` (bit 15 : départ ; bit 13 : écriture). La cadence est l'octet d'état ; la sélection vaut 0 pour les appareils 0, 3 et 6, `0x40` pour 1 et 4, `0x80` pour 2 et 5.
3. Écrit les octets par mots de 32 bits dans `FIFO`, en attendant, toutes les 32 octets, que le bit 0 de `STATUS` (FIFO pleine) retombe.
4. Attend la fin (bit 15). Pour une lecture : `BLKLEN` reçoit le nombre à lire, `CNT` reçoit `... | 0x8000` (sans le bit 13 : lecture), le module lit la `FIFO` par mots en attendant le bit 0 toutes les 32 octets ; pour les lectures de `0x40` octets ou plus, il dort une durée qui dépend de la cadence entre chaque bloc de 32 octets (`svcSleepThread`, de `0x83400` ns pour la cadence 0 à `0x41A0` pour la cadence 5).
5. À la fin : `DONE` reçoit 0 (relâche la sélection).

`spi_nspi_write_write` fait deux écritures de suite (second `BLKLEN`, second départ `0xA000`).

### Les autres registres

- `CFG11_SPI_CNT` (`0x1EC401C0`, 16 bits, dans la page de configuration de la plage `0xFF81EC40`) : le bit 0, 1 ou 2 est mis à 1 par `spi_EnableSpiBus` quand l'interface rapide est choisie pour le bus de l'appareil (bus de `0x1EC60000` : bit 0 ; de `0x1EC42000` : bit 1 ; appareil 6 : bit 2) ; lu à l'initialisation. `spi_EnableTwlSpiBus` met à 0 ou 1 le bit 2 seul.
- Aucune interruption n'est liée (la liste de l'exheader a `0x56` et `0x57`, mais le code n'appelle jamais `svcBindInterrupt`) : toutes les attentes sont des boucles de scrutation. 3dbrew donne `0x56` et `0x57` pour les bus de l'interface rapide.

## Partie 5 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x104058` | les noms des cinq services (`SPI::CD2` ...), puis `err:f` (`0x104085`) |
| `0x105000` | le nombre de sessions en cours |
| `0x105004` | la table des cinq services : pointeurs vers les noms |
| `0x105018` | octet « bus initialisés » ; `0x105019` à `0x10501B` les trois octets « interface rapide » |
| `0x10501C` | l'octet d'état de chaque appareil (6 entrées) ; `0x105022` l'octet « appareil réglé » (6 entrées) |
| `0x1050A8` | les poignées de session, une par service ; `0x1050BC` l'objet de notification |
| `0x1050D0` | les trois verrous de bus (12 octets chacun) |

Les deux tables d'appareils ont six entrées chacune alors que les numéros vont de 0 à 6 : l'octet d'état de l'appareil 6 tombe sur l'octet « réglé » de l'appareil 0 (interprété, à relire dans Ghidra).

## Partie 6 : les services que spi appelle

Seulement `srv:` et `err:f` ; 6 appels à `svcSendSyncRequest` (`0x32`) : `SRV_RegisterClient` (`0x100ee0`), `SRV_EnableNotification` (`0x100f1c`), `SRV_RegisterService` (cinq appels), `SRV_UnregisterService` (`0x1009a0`), `SRV_ReceiveNotification` (`0x100f58`), `ERRF_Throw` (`0x1022ec`). Noms de [sm](sm.md).

## Partie 7 : les appels système utilisés

`ControlMemory` (`0x01`, `svcControlMemory` à `0x101da4`), `ExitProcess` (`0x03`), `CreateThread` (`0x08`, `svcCreateThread` à `0x100fbc`), `ExitThread` (`0x09`), `SleepThread` (`0x0A`, `svcSleepThread` à `0x102530`), `CreateMutex` (`0x13`, `0x102e7c`), `CreateAddressArbiter` (`0x21`), `ArbitrateAddress` (`0x22`), `CloseHandle` (`0x23`, 11 endroits), `WaitSynchronization1` (`0x24`, 5 endroits), `WaitSynchronizationN` (`0x25`), `DuplicateHandle` (`0x27`), `GetProcessInfo` (`0x2B`), `ConnectToPort` (`0x2D`), `SendSyncRequest` (`0x32`, 6 endroits), `GetProcessId` (`0x35`), `Break` (`0x3C`), `AcceptSession` (`0x4A`), `ReplyAndReceive` (`0x4F`). **Ni `BindInterrupt` ni `UnbindInterrupt`.**

## Les désaccords relevés

- **3dbrew, commande 4 et 7.** La page les appelle « ReadWriteDevice2 » et « ReadWriteDevice2Array ». Le code lu écrit **deux fois** et ne lit pas. La deuxième écriture est une donnée du client, pas une lecture.
- **3dbrew, commande 2.** « Stubbed, only returns zero » : conforme au code (réponse `0x00020040`, résultat 0).
- **3dbrew, interruptions.** La page dit que `0x56`/`0x57` sont déclenchées par l'interface rapide ; le module n'en lie aucune (il scrute).
- **Carte des services.** À vérifier avec `carte-des-services/donnees.js` (voir le rapport).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 9 commandes, leur fonction et leur en-tête de réponse : le pseudo-code de `spi_handle_command` d'un côté, `emulate_dispatch.py` de l'autre ; 3dbrew donne les mêmes en-têtes de requête (`0x00030100`, `0x00040500`, `0x00060102`, `0x00070102`) pour les cinq commandes qui en ont un.
- Les cinq noms de service et la limite d'une session chacun : 3dbrew et la table de `0x105004`.
- La correspondance appareil, bus et sélection : le code (les trois `switch` des fonctions de transfert) et la table de 3dbrew (NSPI_CNT).
- Les registres de l'interface rapide (`CNT`, `DONE`, `BLKLEN`, `FIFO`, `STATUS` aux décalages `0x800`, `0x804`, `0x808`, `0x80C`, `0x810`) et de l'ancienne (`CNT`, `DATA`) : les adresses lues dans les fonctions et la table de 3dbrew.
- L'absence d'interruption liée : la liste de l'exheader d'un côté, l'absence de `svc 0x50` dans l'assembleur de l'autre.
- Le fait que le module n'ouvre aucun autre service : liste vide, six requêtes pour six appels à `svc 0x32`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens du bit 2 de `CFG11_SPI_CNT` et de la commande 9 : le nom `EnableTwlSpiBus?` est celui de 3dbrew avec son point d'interrogation ; le code fait seulement un ET ou un OU avec 4.
- La plage `0xFF81EC40`..`0xFF81EC41` : j'y lis une plage d'une page (`0x1EC40000`), ce qui contient `0x1EC401C0`.
- Que l'appareil 6 ne soit jamais joignable ici (page absente de l'exheader).
- Les durées de sommeil (`0x83400` ... `0x41A0`) comme temps d'un bloc de 32 octets selon la cadence : c'est ce que fait leur choix par `switch` sur la cadence, pas une mesure.
- Le recouvrement des deux petites tables d'appareils pour l'appareil 6.
- Les noms des fonctions de la bibliothèque, reconnus par l'identité du code avec des fonctions déjà nommées dans d'autres modules.

**Pas lu**
- Le sens précis des bits de cadence de l'octet d'état (2-6 ajoutés avec la 3DS, d'après 3dbrew).
- Le corps des fonctions de bibliothèque : tas, gestionnaire d'adresses, thread local.
- 63 fonctions de Ghidra et 16 entrées manquées n'avaient pas de nom ; toutes en ont un (haute dans la fiche ou moyenne en proposition) ; la plupart viennent de la bibliothèque.
- Ce que `codec` envoie : la fiche de `codec` est à relire de ce côté. La fiche de `cfg` note trois commandes de `SPI::NOR` : `0x00010080` (commande 1, deux paramètres : `SetDeviceState`), `0x00020040` (commande 2, qui ne fait rien ici) et `0x000500C0` (commande 5, trois paramètres : `WriteDevice`). Elles tombent sur des commandes de ce module ; `cfg` appelle donc la commande 2 pour rien.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 143 fonctions, projet Ghidra | `outils/ghidra_direct.py spi` | une demi-minute |
| Table des 9 commandes | `outils/emulate_dispatch.py spi 0x10104c=spi` | immédiat |
| Assembleur du module | objdump de devkitPro (`code.asm`) | immédiat |
| Exheader (pages, interruptions) | `local/analyse/gpio/exh.py` | immédiat |
| Pseudo-code avec les constantes des tables de littéraux | `local/analyse/gpio/lit.py` | immédiat |
| Noms de la bibliothèque | `local/analyse/gpio/match.py` | immédiat |
| 3dbrew : « SPI Services » et « SPI Registers » | web.archive.org, capture de 2022 | |

Les scripts et le brut sont dans `local/analyse/spi/` et `local/analyse/gpio/` (non versionné).

**Pour reprendre.** `spi.noms.tsv` est le fichier de graines. Les noms en `spi_` sont les commandes reçues et les fonctions de transfert (`spi_old_*` pour l'ancienne interface, `spi_nspi_*` pour la rapide). Endroits à relire en premier : `spi_nspi_write_read` et `spi_init_buses`.
