# gpio, les broches du processeur

`gpio` donne aux autres modules l'accès aux broches du processeur ARM11 : direction (entrée ou sortie), niveau, front qui déclenche une interruption, interruption autorisée ou non. Il n'y a pas de pilote derrière : chaque commande lit ou écrit un registre de la page `0x1EC47000` (`0x10147000` en physique), et le module sert surtout de **douane** : sept services de même code, chacun avec la liste des broches qu'il a le droit de toucher. Une dernière paire de commandes lie une interruption du noyau à un événement du client, sans que le module voie jamais l'interruption lui-même.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), l'aiguillage rejoué par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001b02`, version 3.0.1, un titre de la CTRNAND (lu dans l'exheader ; nom `gpio`) |
| Fichier lu | `local/extrait/gpio/exefs/code.bin` et `exheader.bin` |
| Taille | 11 880 octets de code (`0x2e68`), 700 de données en lecture seule (`0x2bc`), 176 de données (`0xb0`), 1 836 de mémoire à zéro (`0x72c`) ; pile de 4 096 octets ; priorité de départ 9 |
| Fonctions | 118, dont 76 nommées dans `gpio.noms.tsv` (8 en Thumb, 110 en ARM) |
| Services offerts | sept noms, une session au plus chacun : `gpio:CDC`, `gpio:MCU`, `gpio:HID`, `gpio:NWM`, `gpio:IR`, `gpio:NFC`, `gpio:QTM` (partie 2) |
| Services appelés | aucun : seulement `srv:` et le port `err:f`. La liste de services de l'exheader est vide |
| Autres accès | la page matérielle `0x1EC47000` (descripteur `0xFFE1EC47` de l'exheader) ; 17 interruptions déclarées (voir la partie 5) |
| Dépendances déclarées | aucune |
| Fils | un seul : le fil principal. Le module ne contient ni `CreateThread` ni `ControlMemory` : pas de tas |

## Partie 1 : le démarrage

`entry` (`0x100000`) enchaîne les initialisations de bibliothèque habituelles (`clear_bss` à `0x100024`, les constructeurs `run_static_initializers` à `0x100110`, `run_init_array`), puis appelle `gpio_main` (`0x10016c`). Les constructeurs recopient (`construct_global_objects`, `0x1028d0`) les sept masques de permission de `0x103030` vers la mémoire `0x104004`, puis construisent les petits objets globaux de la bibliothèque.

## Partie 2 : la boucle de serveur

`gpio_main` (`0x10016c`, 936 octets) fait, dans l'ordre :

1. **Le matériel.** `gpio_hw_init` (`0x1009e0`), une seule fois : met la broche 7 du port GPIO3 en sortie (bit 23 de `0x1EC47020`) puis son niveau à 0 (bit 7). Dans la table de 3dbrew, c'est la sortie « NFC 2 » (interprété).
2. **Se déclarer à `sm`.** `srv_init` (`0x10197c`) : connexion au port `srv:` (en réessayant toutes les 500 000 ns, `0x7a120`, tant que le port n'existe pas) puis `SRV_RegisterClient`.
3. **Les noms.** Sept appels à `SRV_RegisterService` (`0x1007ec`), dans l'ordre de la table de `0x10304c` (nom, nombre de sessions au plus). Chaque service a **1** session au plus : un seul client à la fois par service.
4. **Les notifications.** Un seul objet, pour la notification `0x100` (arrêt), par `register_notification_handler` (`0x10075c`). Le module ne s'abonne à rien (pas de `SRV_Subscribe`) : `sm` envoie le `0x100` à tout le monde. Le gestionnaire est `on_terminate_notification` (`0x102e2c`).
5. **L'attente.** `svcReplyAndReceive` (`0x1005e8`) sur le tableau de poignées : la poignée 0 est le sémaphore des notifications, les poignées 1 à 7 sont les sept ports, puis une poignée par session ouverte (7 au plus).
   - Indice 0, le sémaphore : `handle_srv_notification` (`0x1006a0`).
   - Indices 1 à 7, un port : `svcAcceptSession`, la session est rangée avec son numéro de service (0 à 6) et un pointeur vers le masque de permission du service.
   - Au-delà, une session : l'aiguillage appelle `gpio_handle_command` (`0x101dd8`) pour **tous** les services. La table de fonctions (`0x103084`) contient sept fois la même adresse. Le contexte passé à la fonction est le pointeur vers le masque de permission (`0x104004` + 4 fois le numéro de service).
6. **La fermeture d'une session** (résultat `0xC920181A`) : `gpio_release_session_irqs` (`0x100938`) retire de la liste des interruptions liées celles que le service pouvait lier (`gpio_mark_unbound`), puis, pour chacune des 31 positions de la liste liée (`0x104000`) que le service a le droit de lier et qui est liée, appelle `svcUnbindInterrupt` (`0x51`) et ferme l'événement du client. Un client qui part sans délier ne laisse donc pas d'interruption accrochée.
7. **La sortie.** Quand la notification `0x100` a mis l'octet `0x104084` à 1 et qu'il ne reste que les sept ports : `SRV_UnregisterService` sept fois, `srv_exit`, retour.

| Service | Masque de permission | Broches (bits du masque, partie 4) | Utilisé par |
| --- | --- | --- | --- |
| `gpio:CDC` | `0x00048` | 3 et 6 | [codec](codec.md) |
| `gpio:MCU` | `0x48020` | 5, 15 et 18 | [mcu](mcu.md) |
| `gpio:HID` | `0x04301` | 0, 8, 9 et 14 | [hid](hid.md) |
| `gpio:NWM` | `0x40020` | 5 et 18 | [nwm](nwm.md) (3dbrew ; sa fiche ne le trouve pas dans l'exheader) |
| `gpio:IR` | `0x00EC0` | 6, 7, 9, 10 et 11 | [ir](ir.md) |
| `gpio:NFC` | `0x13000` | 12, 13 et 16 | le module NFC (pas encore lu) |
| `gpio:QTM` | `0x20000` | 17 | le module QTM, New 3DS (pas encore lu) |

Les sept masques sont dans la section en lecture seule, à `0x103000`, dans l'ordre du tableau ci-dessus, et recopiés en mémoire à `0x104004` ; ils sont identiques à ceux de 3dbrew.

## Partie 3 : les commandes

`gpio_handle_command` (`0x101dd8`, 424 octets) lit l'en-tête dans le tampon du fil, prend le numéro dans les 16 bits du haut et saute à l'un de 10 cas. Un numéro inconnu rend l'en-tête `0x00000040` et `0xD900182F`. Le code ne compare l'en-tête **entier** que pour les deux dernières commandes (9 et 10) ; pour les huit autres, seul le numéro compte. Dans toutes, les paramètres sont lus dans les mots 1 et 2 du tampon (`mot 1` = premier paramètre).

Les noms de 3dbrew (`GetRegPart1`...) ne disent pas quel registre est touché ; les noms de ce fichier de noms disent le registre (voir la partie 4). Les adresses et les en-têtes de réponse sont lus dans le code et recoupés par `emulate_dispatch.py`.

| N° | En-tête de requête | Nom 3dbrew | Fonction | Adresse | En-tête de réponse | Ce que le code fait |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010040` | GetRegPart1(mask) | `gpio_GetDirection` | `0x101fe0` | `0x00010080` | rend la direction (0 entrée, 1 sortie) des broches du masque |
| 2 | `0x00020080` | SetRegPart1(value, mask) | `gpio_SetDirection` | `0x10208c` | `0x00020040` | écrit la direction des broches du masque |
| 3 | `0x00030040` | GetRegPart2(mask) | `gpio_GetEdge` | `0x1023bc` | `0x00030080` | rend le front (0 descendant, 1 montant) |
| 4 | `0x00040080` | SetRegPart2(value, mask) | `gpio_SetEdge` | `0x102468` | `0x00040040` | écrit le front |
| 5 | `0x00050040` | GetInterruptMask(mask) | `gpio_GetInterruptEnable` | `0x1024e8` | `0x00050080` | rend l'autorisation d'interruption (1 autorisée) |
| 6 | `0x00060080` | SetInterruptMask(value, mask) | `gpio_SetInterruptEnable` | `0x102594` | `0x00060040` | écrit l'autorisation |
| 7 | `0x00070040` | GetGPIOData(mask) | `gpio_GetData` | `0x102618` | `0x00070080` | rend le niveau des broches du masque |
| 8 | `0x00080080` | SetGPIOData(value, mask) | `gpio_SetData` | `0x102750` | `0x00080040` | écrit le niveau |
| 9 | `0x00090082` | BindInterrupt | `gpio_BindInterrupt` | `0x102110` | `0x00090040` | lie l'interruption du noyau d'une broche à un événement |
| 10 | `0x000A0042` | UnbindInterrupt | `gpio_UnbindInterrupt` | `0x102254` | `0x000A0040` | défait la liaison |

Ce que vérifient les commandes 1 à 8 (même schéma) :

- Si le masque a un bit en dehors de la permission du service (`mask & ~permission`), la réponse est le résultat `0xE0E033EA` (niveau 28, résumé 7, module 12, description 1002).
- Commandes 1 à 6 : si le masque touche les bits 0, 1, 2, 5 ou 18 et plus (`mask & 0xFFFC0027`), résultat `0xE0E033FA`. Ces commandes ne portent que sur les broches des bits 3, 4 et 6 à 17 (celles qui ont une direction, un front et une autorisation dans le matériel).
- Commande 7 (lecture des niveaux) : accepte les bits 0 à 18 (`mask >> 19` doit être nul), sinon `0xE0E033FA`.
- Commande 8 (écriture des niveaux) : n'accepte que les bits 3 à 18 (`mask & ~0x7FFF8`), sinon `0xE0E033FA`. Les trois premières broches (bits 0 à 2) ne s'écrivent donc jamais ; elles sont en lecture seule dans le matériel.
- Une valeur rendue ne contient que des bits du masque.

Commandes 9 et 10 : le mot 1 est le masque d'**une seule** broche. `gpio_mask_to_irq` (`0x101700`) le convertit en numéro d'interruption (partie 4) ; un masque à plusieurs bits ou une broche sans interruption rend `0xE0E033FA`.

## Partie 4 : le matériel

### Les registres

Le module touche la page `0x1EC47000` (virtuelle, `0x10147000` en physique, une seule page projetée par le descripteur `0xFFE1EC47`). Les noms des registres sont ceux de 3dbrew (page « GPIO Registers »).

| Adresse | Largeur | Nom 3dbrew | Lu ou écrit par le module |
| --- | --- | --- | --- |
| `0x1EC47000` | 16 bits | GPIO1_DATA | lu par `gpio_GetData` (bits 0 à 2 du masque). Jamais écrit |
| `0x1EC47010` | 32 bits | GPIO2 : DATA (octet 0), DIR (octet 1), INTCFG (octet 2), INTEN (octet 3) | lu et écrit en 32 bits par les huit commandes de registre, un champ à la fois (décalages 0, 8, 16, 24 : voir plus bas) |
| `0x1EC47014` | 16 bits | GPIO2_DATA2 | lu et écrit par les commandes 7 et 8 (bit 5 du masque) |
| `0x1EC47020` | 32 bits | GPIO3_DATA (bits 0 à 15), GPIO3_DIR (bits 16 à 31) | lu et écrit par les commandes 1, 2, 7, 8 ; écrit à l'initialisation |
| `0x1EC47024` | 32 bits | GPIO3_INTCFG (bits 0 à 15), GPIO3_INTEN (bits 16 à 31) | lu et écrit par les commandes 3 à 6 |
| `0x1EC47028` | 16 bits | GPIO3_DATA2 | lu et écrit par les commandes 7 et 8 (bit 18 du masque) |

Les écritures de champ passent toutes par `hw_update_reg32` (`0x101278`, 32 bits) ou `hw_update_reg16` (`0x1011ec`, 16 bits) : elles prennent le verrou de la bibliothèque (`0x104130`), lisent le registre, remplacent les bits du masque et réécrivent. Deux clients ne peuvent donc pas se faire perdre une écriture sur le même registre.

### Les bits du masque et les broches

Le masque d'une commande a 19 bits. Il est réparti sur les registres ainsi (formules lues dans le code, noms des broches repris de 3dbrew) :

| Bits du masque | Registre | Bits du registre | Broche (3dbrew) |
| --- | --- | --- | --- |
| 0 à 2 (`0x7`) | `0x10147000` | 0 à 2 | bouton de déverminage, écran tactile (active à 0, IRQ `0x63`), couvercle fermé (IRQ `0x60` et `0x62`) |
| 3 à 4 (`0x18`) | `0x10147010` | 0 et 1 de chaque champ | prise casque insérée (IRQ `0x64`), circuit TWL anti-bruit (IRQ `0x66`) |
| 5 (`0x20`) | `0x10147014` | 0 | choix du mode WiFi (0 CTR, 1 MP) |
| 6 à 17 (`0x3FFC0`) | `0x10147020` / `0x10147024` | 0 à 11 de chaque champ | GPIO3 : stick C (IRQ `0x68`), IrDA (`0x69`), gyroscope (`0x6A`), arrêt du stick C (`0x6B`), émission IrDA (`0x6C`), réception IrDA (`0x6D`), NFC (`0x6E`, `0x6F`), bouton du casque (`0x70`), MCU (`0x71`), NFC (`0x72`), QTM (`0x73`) |
| 18 (`0x40000`) | `0x10147028` | 0 | WiFi activé (1 oui) |

Les décalages des champs, lus dans les formules des commandes 1 à 6, sont ceux de 3dbrew : les bits 3 et 4 du masque correspondent aux bits 0 et 1 de l'octet DATA, DIR, INTCFG ou INTEN de `0x10147010` (décalage 0, 8, 16 ou 24 dans le registre). Les bits 6 à 17 correspondent aux douze premiers bits du champ bas ou haut de `0x10147020` et `0x10147024`.

### Les interruptions

Le noyau relaie les interruptions matérielles aux événements que les clients lient. Le module ne les voit jamais : `gpio_BindInterrupt` appelle `svcBindInterrupt` (`0x50`) avec le numéro d'interruption, l'événement du client, la priorité donnée par le client (mot 2 de la requête) et le mode « remise à zéro automatique » (0). Les correspondances de `gpio_mask_to_irq` (`0x101700`), lues dans le code et recoupées par la table de 3dbrew :

| Bit du masque | Interruption | Bit du masque | Interruption |
| --- | --- | --- | --- |
| 1 (`0x2`) | `0x63` | 9 (`0x200`) | `0x6B` |
| 2 (`0x4`) | `0x60` | 10 (`0x400`) | `0x6C` |
| 3 (`0x8`) | `0x64` | 11 (`0x800`) | `0x6D` |
| 4 (`0x10`) | `0x66` | 12 (`0x1000`) | `0x6E` |
| 6 (`0x40`) | `0x68` | 13 (`0x2000`) | `0x6F` |
| 7 (`0x80`) | `0x69` | 14 (`0x4000`) | `0x70` |
| 8 (`0x100`) | `0x6A` | 15 (`0x8000`) | `0x71` |
| | | 16 (`0x10000`) | `0x72` |
| | | 17 (`0x20000`) | `0x73` |

Les bits 0 (`0x1`), 5 (`0x20`) et 18 (`0x40000`) n'ont pas d'interruption : `0xE0E033FA`. L'exheader déclare 17 interruptions : les 16 ci-dessus plus `0x62` (le front montant du couvercle). **Aucune commande n'accroche `0x62`** : la déclaration n'est pas utilisée par le code (voir « interprété »).

### BindInterrupt pas à pas

`gpio_BindInterrupt` (`0x102110`), pour un client du service de permission P, un masque M, un événement E (poignée copiée dans la requête) et une priorité N :

1. Vérifie l'en-tête entier (`0x00090082`) et que le descripteur du mot 3 est nul (copie de poignée) ; sinon réponse `0x40` et `0xD9001830`.
2. `gpio_mask_is_free` (`0x101238`) : si M recoupe une interruption déjà liée (masque `0x104028`, tous services confondus), ferme E et rend `0xE0E033F0` (description 1008 : « déjà liée »).
3. Si M a un bit hors de P, ferme E et rend `0xE0E033EA`.
4. `gpio_mask_to_irq` : numéro d'interruption, ou `0xE0E033FA`.
5. `svcBindInterrupt(irq, E, N, 0)` ; une erreur du noyau déclenche `throw_fatal_error`.
6. `gpio_mark_bound` (`0x102824`) : ajoute M au masque `0x104028`. L'indice de la broche (position du bit de M) sert à ranger E dans la table `0x1040B0` (32 poignées : `construct_array(0x1040B0, handle_clear, 4, 0x20)`) et à lever le même bit dans le mot `0x104000`.

`gpio_UnbindInterrupt` (`0x102254`) fait l'inverse : vérifie que M est lié (sinon `0xE0E033F0`), appelle `svcUnbindInterrupt` (`0x51`), efface M de `0x104028` et du mot `0x104000`, ferme l'événement rangé et l'événement reçu dans la requête.

## Partie 5 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x103000` | les sept masques de permission (lecture seule) |
| `0x10304C` | la table des sept services : pointeur vers le nom, nombre de sessions (1) |
| `0x103084` | la table des fonctions d'aiguillage : sept fois `0x101dd8` |
| `0x1030A0` | la table des contextes : sept pointeurs vers `0x104004` + 4 fois le numéro |
| `0x1030BC` | les noms des sept services, puis `srv:` (`0x10310C`), `srv:pm` (`0x103111`, jamais ouvert), `err:f` (`0x103154`) |
| `0x104000` | les interruptions liées, un bit par position de broche |
| `0x104004` | les sept masques de permission en mémoire |
| `0x104024` | octet « matériel initialisé » ; `0x104028` le masque des interruptions liées |
| `0x1040B0` | les poignées d'événement liées, une par position de broche (32) |
| `0x104084` | octet d'arrêt (notification `0x100`) |
| `0x104130` | le verrou récursif qui protège les écritures de registres |
| `0x1047A0` | la table des poignées attendues (sémaphore, sept ports, sessions) |

## Partie 6 : les services que gpio appelle

Seulement `srv:` et `err:f` ; 6 appels à `svcSendSyncRequest` (`0x32`) dans le code.

| Service | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- |
| `srv:` | `0x00010002` | `SRV_RegisterClient` | `0x100c38` | se déclarer à `sm` |
| | `0x00020000` | `SRV_EnableNotification` | `0x100c74` | obtenir le sémaphore des notifications |
| | `0x00030100` | `SRV_RegisterService` | `0x1007ec` | créer un des sept services (7 appels) |
| | `0x000400C0` | `SRV_UnregisterService` | `0x100848` | les retirer à la sortie |
| | `0x000B0000` | `SRV_ReceiveNotification` | `0x100cb0` | lire le numéro reçu |
| `err:f` (port) | `0x00010800` | `ERRF_Throw` | `0x100f9c` | signaler une erreur fatale (`throw_fatal_error` à `0x10193c`, `errf_report_error` à `0x1014c0`) |

Les noms des commandes de `srv:` sont ceux de [sm](sm.md).

## Partie 7 : les appels système utilisés

| Appel | Numéro | Où |
| --- | --- | --- |
| ExitProcess | `0x03` | `svcExitProcess` (`0x101AA0`, atteint par `b` depuis `entry`) |
| SleepThread | `0x0A` | `svcSleepThread` (`0x100fd4`) |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` (`0x100cec`) |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` (`0x1014a8`) |
| CloseHandle | `0x23` | écrit sur place, 19 endroits |
| WaitSynchronization1 | `0x24` | un endroit |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` (`0x101cac`) |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` (`0x100e14`) |
| ConnectToPort | `0x2D` | `svcConnectToPort` (`0x101894`) |
| SendSyncRequest | `0x32` | écrit sur place, 6 endroits |
| GetProcessId | `0x35` | `svcGetProcessId` (`0x100e34`) |
| Break | `0x3C` | `svcBreak` (`0x101B0C`, atteint par `b` depuis `break_process` ; `0x101CA0` est `get_eh_globals_slot`, corrigé le 17/10) |
| AcceptSession | `0x4A` | `svcAcceptSession` (`0x1005d0`) |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` (`0x1005e8`) |
| BindInterrupt | `0x50` | dans `gpio_BindInterrupt` |
| UnbindInterrupt | `0x51` | dans `gpio_UnbindInterrupt` et `gpio_release_session_irqs` |

Les verrous (`lock_enter` à `0x1018cc`, `lock_leave` à `0x1018ac`, `lock_arbitrate_wait` à `0x101054`) reposent sur `ArbitrateAddress`, comme dans [mic](mic.md) et [hid](hid.md).

## Les désaccords relevés

- **3dbrew, permissions.** La page dit « le masque est comparé à la permission, une erreur est rendue si le résultat est non nul ». Le code teste `mask & ~permission` : l'erreur vient d'un bit en trop, pas d'un bit présent. Les sept valeurs de masque sont les mêmes.
- **3dbrew, noms des commandes 1 à 6.** `RegPart1`, `RegPart2` et `InterruptMask` sont, d'après les décalages lus dans le code et les registres de 3dbrew, la direction, le front et l'autorisation d'interruption ; 3dbrew ne les nomme pas ainsi.
- **3dbrew, commande 8 (SetGPIOData).** La page note « Handled with GPIO:SetGPIOData : No » pour les bits 0 à 2 ; le code les refuse en effet (`0xE0E033FA`).
- **L'interruption `0x62`.** Déclarée dans l'exheader, absente de `gpio_mask_to_irq`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 10 commandes, leur fonction et leur en-tête de réponse : le pseudo-code de `gpio_handle_command` (`0x101dd8`) d'un côté, `emulate_dispatch.py` de l'autre. Les en-têtes de requête de 3dbrew tombent sur les mêmes numéros.
- Les deux commandes qui vérifient l'en-tête entier (9 et 10) : le pseudo-code et `emulate_dispatch.py` (colonne « entier »).
- Les sept noms de service, leurs sept masques de permission et leur limite d'une session : 3dbrew d'un côté, les tables de la section en lecture seule de l'autre (`0x10304C`, `0x103000`).
- La page matérielle `0x1EC47000` et les six adresses de registre : le descripteur `0xFFE1EC47` de l'exheader d'un côté, les adresses lues dans les fonctions de l'autre ; la liste des registres de 3dbrew donne les mêmes six.
- La table masque vers interruption : le code de `gpio_mask_to_irq` et la table de 3dbrew (« GPIO pins »), qui donnent les mêmes numéros pour toutes les broches avec interruption.
- Le fait que le module n'ouvre aucun autre service : l'exheader n'en liste aucun, et le code ne contient que les six requêtes de la partie 6 pour six appels à `svc 0x32`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Que les champs des commandes 1 à 6 sont la direction, le front et l'autorisation : déduit des décalages (8, 16, 24 dans `0x10147010` ; 16 dans `0x10147020` et `0x10147024`) et des noms de 3dbrew pour ces octets, pas d'une documentation du module.
- Que la broche 7 de GPIO3 initialisée par `gpio_hw_init` est la sortie NFC 2 : d'après la table de 3dbrew ; le but de la mise à 0 est inconnu.
- Que `0x62` est inutilisée : aucune des commandes lues ne la produit, mais d'autres chemins de code (dans le noyau) peuvent la lier à la place du module.
- Les noms des fonctions de la bibliothèque (verrous, tas, `srv_init`...), reconnus par l'identité du code avec les mêmes fonctions déjà nommées dans d'autres modules (voir ci-dessous).
- Que la priorité du mot 2 de BindInterrupt est celle de `svcBindInterrupt` : lu dans l'assembleur de `0x102110` (le registre `r2` de `svc 0x50` est le mot 2 de la requête).

**Pas lu**
- Le corps des fonctions de bibliothèque : les allocateurs de blocs (`heap_find_block`, `0x101b18`, `heap_split_block`, `0x1012c4`), les gestionnaires de réserve d'adresses (`0x100c10`), l'initialisation du thread local (`0x100d50`), `errf_report_error` (`0x1014c0`) en détail.
- 42 fonctions restent sans nom, presque toutes de la bibliothèque.
- Les clients précis : quelles commandes envoient `codec`, `mcu` et `nwm` (les fiches de `hid` et `ir` donnent les leurs : la commande 2 pour `gpio:HID` et `gpio:IR`).

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 118 fonctions, projet Ghidra | `outils/ghidra_direct.py gpio` | une demi-minute |
| Table des 10 commandes | `outils/emulate_dispatch.py gpio 0x101dd8=gpio` | immédiat |
| Assembleur du module | objdump de devkitPro (`code.asm`) | immédiat |
| Exheader (pages, interruptions, appels système) | un petit script Python (`local/analyse/gpio/exh.py`) | immédiat |
| Pseudo-code avec les constantes des tables de littéraux | un script Python (`lit.py`) qui lit le mot de chaque `DAT_` dans `code.bin` | immédiat |
| Noms de la bibliothèque | un script Python (`match.py`) qui compare le code aux fonctions déjà nommées des autres modules (même code aux adresses près) | immédiat |
| Lecture, nommage | Claude | le gros du temps |
| 3dbrew : « GPIO Services » (version du 4 mai 2021, `oldid=21518`) et « GPIO Registers » | web.archive.org, capture de 2022 | |

Les scripts et le brut sont dans `local/analyse/gpio/` (non versionné).

**Pour reprendre.** `gpio.noms.tsv` est le fichier de graines. Les noms en `gpio_` sont les commandes reçues ; `hw_` les accès aux registres. Les endroits à relire en premier : `gpio_handle_command` pour les paramètres (mots 1 et 2), et `gpio_release_session_irqs`.
