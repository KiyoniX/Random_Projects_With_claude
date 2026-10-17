# i2c, les trois bus I2C

`i2c` est le pilote des trois bus I2C de la console, ceux où sont branchés le microcontrôleur (`mcu`), les caméras, les écrans, le gyroscope, le composant infrarouge, la mémoire d'étalonnage, la puce NFC et celle du module QTM. Neuf services, un par famille de client, offrent les mêmes 21 commandes (lire ou écrire un registre d'un appareil, par un identifiant d'appareil de 0 à 17) ; chaque service ne laisse toucher que ses appareils. Pour chaque octet, le module écrit le registre de données du bus, lance le transfert par le registre de contrôle, **dort jusqu'à l'interruption du bus**, puis lit l'accusé de réception ; huit essais au plus par transaction.

C'est la version New 3DS du module (`0004013020001e02`, version 5.0.1 ; la NAND porte aussi `i2c-safe`, la version du mode sans échec, que cette fiche ne lit pas) ; elle accepte l'appareil 17 et les commandes 19 à 21, que 3dbrew réserve à la New 3DS.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), l'aiguillage rejoué par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020001e02`, version 5.0.1, un titre de la CTRNAND (lu dans l'exheader ; nom `i2c`) |
| Fichier lu | `local/extrait/i2c/exefs/code.bin` et `exheader.bin` |
| Taille | 21 396 octets de code (`0x5394`), 636 de données en lecture seule (`0x27c`), 200 de données (`0xc8`), 19 984 de mémoire à zéro (`0x4e10`) ; pile de 4 096 octets ; priorité de départ 9 |
| Fonctions | 212 (194 pour Ghidra et 18 entrées manquées), 8 en Thumb, 204 en ARM |
| Services offerts | neuf, une session au plus chacun : `i2c::MCU`, `i2c::CAM`, `i2c::LCD`, `i2c::DEB`, `i2c::HID`, `i2c::IR`, `i2c::EEP`, `i2c::NFC`, `i2c::QTM` (partie 2) |
| Services appelés | aucun : seulement `srv:` et le port `err:f`. La liste de services de l'exheader est vide |
| Autres accès | trois pages matérielles, `0x1EC61000`, `0x1EC44000`, `0x1EC48000` (descripteurs `0xFFE1EC61`, `0xFFE1EC44`, `0xFFE1EC48`) ; les interruptions `0x54`, `0x55` et `0x5C` |
| Dépendances déclarées | aucune |
| Fils | le fil principal, **un fil par session ouverte** (priorité 11, pile de `0x800` octets, jusqu'à neuf), et un petit fil d'initialisation qui lie deux interruptions (partie 4) |

## Partie 1 : le démarrage

`entry` (`0x100000`) enchaîne `clear_bss`, les constructeurs et `run_init_array`, puis appelle `i2c_main` (`0x10013c`, 1 032 octets). `construct_global_objects` (`0x104d0c`) prépare les trois verrous de bus (`0x10b924`, 12 octets chacun), les trois événements de bus (`0x10b948`) et un objet de durées (`0x107058`) dont deux durées, 1 400 et 5 000 converties en 375 et 1 340 ticks par la constante `0x44A2FA85` (1,4 µs et 5 µs à 268 MHz, unités supposées).

Les bus eux-mêmes ne sont pas initialisés au démarrage : `i2c_init_buses` (`0x10296c`) est appelée la première fois qu'une commande prend un verrou de bus (octet `0x107050`, voir la partie 4).

## Partie 2 : la boucle de serveur

`i2c_main` fait, dans l'ordre :

1. **Se déclarer à `sm`.** `srv_init` (`0x10076c`) puis `SRV_RegisterClient`.
2. **Les noms.** Neuf appels à `SRV_RegisterService` (`0x100a2c`), dans l'ordre de la table de `0x107004`. Chaque service a **1** session au plus.
3. **Les notifications.** Un seul objet, la notification `0x100` (arrêt), par `register_notification_handler` (`0x100980`) ; le gestionnaire est `on_terminate_notification` (`0x103ffc`). Pas de `SRV_Subscribe`.
4. **L'attente.** `svcWaitSynchronizationN` (`0x100618`, sans délai) sur dix poignées : les neuf ports, puis le sémaphore des notifications.
   - Indice 9, le sémaphore : `handle_srv_notification` (`0x1008c4`).
   - Indices 0 à 8, un port : `svcAcceptSession`, puis `create_thread` (`0x1034a8`) lance **un fil pour cette session**, de priorité 11, sur une pile de `0x800` octets prise dans la zone de `0x107110` à `0x10b910`. Le point d'entrée du fil est propre au service (table de `0x107028`) et ne diffère des autres que par l'octet « numéro de service » qu'il passe à la boucle de session. Si le service avait déjà un fil terminé, il est d'abord joint (`join_thread`, `0x103598`). Les fils des services `i2c::CAM`, `i2c::HID` et `i2c::QTM` reçoivent le processeur 3, les autres le processeur par défaut.
5. **Un fil de session.** `i2c_session_thread_<service>` (`0x104fa8` à `0x105324`, neuf petites fonctions de 104 à 116 octets) appelle `i2c_session_loop` (`0x1025ac`) avec le numéro de service (0 à 8) : la boucle règle deux tampons statiques de réception de `0x200` octets (descripteurs aux décalages `0x180` et `0x188` de la zone locale du fil, tous deux pointant sur le même tampon de la pile), puis fait `svcReplyAndReceive` sur la session et appelle `i2c_handle_command` (`0x101f28`) à chaque requête. À la fermeture de la session (`0xC920181A`), le fil ferme la poignée, décrémente le compteur de sessions (`0x107000`) et finit.
6. **La sortie.** Quand la notification `0x100` a mis l'octet `0x10b920` à 1 : le module joint les fils de session, retire les neuf services (`SRV_UnregisterService`), ferme les ports, `srv_exit`, retour.

| N° | Service | Appareils permis (identifiants) | Fil de session | Client (d'après sa fiche) |
| --- | --- | --- | --- | --- |
| 0 | `i2c::MCU` | 0, 3 | `0x104fa8` | [mcu](mcu.md) |
| 1 | `i2c::CAM` | 1, 2, 4 | `0x105014` | [camera](camera.md) |
| 2 | `i2c::LCD` | 5, 6 | `0x105084` | [gsp](gsp.md) |
| 3 | `i2c::DEB` | 7, 8 | `0x1050f4` | (aucun module lu) |
| 4 | `i2c::HID` | 9, 10, 11, 12 | `0x105164` | [hid](hid.md) |
| 5 | `i2c::IR` | 13, 17 | `0x1051d4` | [ir](ir.md) |
| 6 | `i2c::EEP` | 14 | `0x105244` | [cfg](cfg.md) |
| 7 | `i2c::NFC` | 15 | `0x1052b4` | le module NFC (pas encore lu) |
| 8 | `i2c::QTM` | 16 | `0x105324` | le module QTM (pas encore lu) |

`i2c_service_may_access_device` (`0x1030a4`) tient la table des appareils permis, un `switch` sur le numéro de service. Un appareil non permis rend `0xE0A02FEA` (niveau 28, résumé 5, module 11, description 1002), c'est-à-dire le résultat de 3dbrew.

## Partie 3 : les commandes

`i2c_handle_command` (`0x101f28`, 1 452 octets) lit l'en-tête dans le tampon du fil, prend le numéro dans les 16 bits du haut et saute à l'un de 21 cas. Un numéro inconnu rend l'en-tête `0x00000040` et `0xD900182F`. Le code ne compare l'en-tête **entier** que pour les commandes à tampon (4, 8, 11, 12, 14, 17, 18, 20) ; pour les autres, seul le numéro compte. Un en-tête faux rend la réponse `0x00000040` et `0xD9001830`. Tous les services ont les mêmes commandes. Les noms et les en-têtes de requête viennent de 3dbrew (page « I2C Services », version lue le 16 octobre 2026) ; l'adresse et l'en-tête de réponse sont lus dans le code et recoupés par `emulate_dispatch.py`.

Paramètres : `devid` est l'identifiant d'appareil (octet), `regid` le registre (octet, ou mot de 16 bits quand on le dit), `n` le nombre d'octets du tampon.

| N° | En-tête de requête | Commande (3dbrew) | Fonction | Adresse | En-tête de réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010100` | SetRegisterBits8 (devid, regid, regdata, mask) | `i2c_SetRegisterBits8` | `0x103fb4` | `0x00010040` | lit le registre, remplace les bits du masque, réécrit (`i2c_update_bits8`, `0x102b60`) |
| 2 | `0x000200C0` | EnableRegisterBits8 (devid, regid, mask) | `i2c_EnableRegisterBits8` | `0x103f74` | `0x00020040` | même chose, bits du masque mis à 1 |
| 3 | `0x000300C0` | DisableRegisterBits8 | `i2c_DisableRegisterBits8` | `0x103694` | `0x00030040` | même chose, bits du masque mis à 0 |
| 4 | `0x00040102` | MultiSetRegisterBits16 (regid16, regdata16, mask16, n, liste d'appareils) | `i2c_MultiSetRegisterBits16` | `0x103c54` | `0x00040040` | vérifie d'abord que tous les appareils de la liste (tampon statique 0) sont permis, puis fait la même mise à jour sur chacun |
| 5 | `0x000500C0` | WriteRegister8 (devid, regid, regdata) | `i2c_WriteRegister8` | `0x1037b8` | `0x00050040` | écrit un octet dans un registre |
| 6 | `0x00060080` | WriteCommand8 (devid, cmdid) | `i2c_WriteCommand8` | `0x103e9c` | `0x00060040` | n'envoie que l'octet de commande (pas de registre) |
| 7 | `0x000700C0` | WriteRegister16 (devid, regid16, regdata16) | `i2c_WriteRegister16` | `0x103984` | `0x00070040` | registre de 16 bits (poids fort d'abord) puis valeur de 16 bits |
| 8 | `0x000800C2` | MultiWriteRegister16 (regid16, regdata16, n, liste) | `i2c_MultiWriteRegister16` | `0x103d04` | `0x00080040` | idem sur chaque appareil de la liste (tampon statique 0) |
| 9 | `0x00090080` | ReadRegister8 (devid, regid) | `i2c_ReadRegister8` | `0x1036d4` | `0x00090080` | rend 0 et, au mot 2, l'octet lu |
| 10 | `0x000A0080` | ReadRegister16 (devid, regid16) | `i2c_ReadRegister16` | `0x103828` | `0x000A0080` | rend 0 et, au mot 2, la valeur de 16 bits |
| 11 | `0x000B00C2` | WriteRegisterBuffer8 (devid, regid, n, tampon) | `i2c_WriteRegisterBuffer8` | `0x103890` | `0x000B0040` | écrit `n` octets à partir du registre (tampon statique 1) |
| 12 | `0x000C00C2` | WriteRegisterBuffer16 (devid, regid16, n, tampon) | `i2c_WriteRegisterBuffer16` | `0x1039f4` | `0x000C0040` | idem avec un registre de 16 bits et des valeurs de 16 bits |
| 13 | `0x000D00C0` | ReadRegisterBuffer8 (devid, regid, n) | `i2c_ReadRegisterBuffer8` | `0x10373c` | `0x000D0042` | lit `n` octets (au plus `0x200`) et les rend en tampon statique |
| 14 | `0x000E00C2` | WriteRegisterBuffer | `i2c_WriteRegisterBuffer_cmd0e` | `0x103bdc` | `0x000E0040` | même fonction de travail que la commande 11 |
| 15 | `0x000F00C0` | ReadRegisterBuffer | `i2c_ReadRegisterBuffer_cmd0f` | `0x103ae4` | `0x000F0042` | lit `n` octets, avec une pause de 50 µs avant le départ et de 150 µs avant la relecture (`0xC350` et `0x249F0` ns) |
| 16 | `0x001000C0` | ReadEEPROM (devid, blockid, n) | `i2c_ReadEEPROM` | `0x103908` | `0x00100042` | lit `n` mots de 16 bits à partir d'un bloc (`i2c_read_buffer16`, `0x1044a4`) |
| 17 | `0x001100C2` | WriteRegisterBuffer | `i2c_WriteRegisterBuffer_cmd11` | `0x103a6c` | `0x00110042` | même fonction de travail que la 11 ; tampon en lecture (`0xA`) |
| 18 | `0x001200C2` | ReadRegisterBuffer | `i2c_ReadRegisterBuffer_cmd12` | `0x103b60` | `0x00120042` | même fonction de travail que la 13 ; tampon en écriture (`0xC`) |
| 19 | `0x00130040` | ReadDeviceRaw8 (devid) | `i2c_ReadDeviceRaw8` | `0x103dc8` | `0x00130080` | un octet lu sans adresse de registre (`0xE1`, partie 4) |
| 20 | `0x00140082` | WriteDeviceRaw (devid, n, tampon) | `i2c_WriteDeviceRaw` | `0x103f04` | `0x00140040` | écrit `n` octets sans adresse de registre |
| 21 | `0x00150080` | ReadDeviceRaw (devid, n) | `i2c_ReadDeviceRaw` | `0x103e28` | `0x00150042` | lit `n` octets sans adresse de registre (`0xF0` pour les octets intermédiaires, `0xE1` pour le dernier) |

Notes sur les cas :

- **Les erreurs.** Si l'appareil n'est pas permis au service : `0xE0A02FEA`. Si les huit essais de la transaction échouent : `0xF9602FEF` (niveau 31, résumé 11, module 11, description 1007). Pour les commandes 9 et 19, un transfert qui échoue rend l'octet `0xFF` et le résultat 0 : la commande ne signale pas l'échec ; la lecture 10 rend `0xFFFF`.
- **Un appareil au-delà de 17.** Les fonctions de travail ne font rien et rendent un échec (ou `0xFF` pour une lecture d'un octet) ; `i2c_service_may_access_device` l'a déjà refusé, ce cas ne se produit donc jamais par le service.
- **Le verrou de bus.** Chaque commande prend le verrou du bus de son appareil : les commandes 1 à 3 dans `i2c_update_bits8`, la 4 dans `i2c_update_bits16_locked`, toutes les autres autour de leur fonction de travail (`i2c_bus_lock` et `i2c_bus_unlock`, `0x103058` et `0x10300c`). Un verrou par bus (`0x10b924` + 12 fois le numéro de bus) : deux clients qui parlent à des appareils de bus différents ne s'attendent pas.
- **Les commandes 14, 17 et 18** font le même travail que 11 et 13 sous d'autres en-têtes (les anciens et les nouveaux noms de 3dbrew).

## Partie 4 : le matériel

### Les appareils et les bus

La table des 18 appareils est en lecture seule à `0x106068`, cinq octets chacun : le numéro de bus (0 à 2), l'adresse d'écriture de l'appareil, et trois octets nuls. Le numéro de bus indexe la table des trois pages à `0x106050`.

| Bus | Page (virtuelle) | Physique (3dbrew) | Interruption | Appareils |
| --- | --- | --- | --- | --- |
| 0 | `0x1EC61000` | `0x10161000` (I2C1) | `0x54` | 0 (`0x4A`), 1 (`0x7A`), 2 (`0x78`), 16 (`0x40`) |
| 1 | `0x1EC44000` | `0x10144000` (I2C2) | `0x55` | 3 (`0x4A`), 4 (`0x78`), 5 (`0x2C`), 6 (`0x2E`), 7 (`0x40`), 8 (`0x44`), 15 (`0xEE`) |
| 2 | `0x1EC48000` | `0x10148000` (I2C3) | `0x5C` | 9 (`0xD6`), 10 (`0xD0`), 11 (`0xD2`), 12 (`0xA4`), 13 (`0x9A`), 14 (`0xA0`), 17 (`0x54`) |

Les adresses sont celles de la table de 3dbrew (« I2C Registers »), sauf l'appareil 9, que 3dbrew donne à `0xA6` avant 8.0.0-18 et à `0xD6` ensuite : le module lu a `0xD6`. Le numéro d'interruption de chaque bus est celui qui lie l'événement de ce bus : voir plus bas.

### Les registres

Pour chaque bus (noms de 3dbrew) :

| Adresse | Largeur | Nom | Lu ou écrit |
| --- | --- | --- | --- |
| `+0x0` | 8 bits | I2Cn_DATA | écrit (octet à envoyer ou adresse de l'appareil) ; lu (octet reçu) |
| `+0x1` | 8 bits | I2Cn_CNT | écrit à chaque étape (valeurs plus bas) ; lu pour l'accusé de réception (bit 4) |
| `+0x2` | 16 bits | I2Cn_CNTEX | écrit à 2 à l'initialisation |
| `+0x4` | 16 bits | I2Cn_SCL | écrit à `0x500` à l'initialisation |

Les valeurs écrites dans `CNT` (bits de 3dbrew : 0 arrêt, 1 départ, 2 pause, 4 accusé, 5 sens, 6 interruption, 7 occupé) :

| Valeur | Fonction | Rôle |
| --- | --- | --- |
| `0xC2` | `i2c_bus_start_write` (`0x1028e0`) et `i2c_bus_start_read` (`0x1027ec`) | départ : `DATA` reçoit l'adresse de l'appareil (avec le bit 0 pour une lecture), pause `delay_loop(3 × 375)` (`0x10187c`, environ 4,2 µs, supposé), puis `CNT` |
| `0xC0` | `i2c_bus_write_byte` (`0x10287c`) | octet de plus à écrire |
| `0xC1` | `i2c_bus_write_last_byte` (`0x102680`) | dernier octet, avec arrêt |
| `0xC5` | `i2c_bus_abort` (`0x1026e4`) | arrêt avec pause après une erreur ; appelé avant chaque nouvel essai |
| `0xF0` | `i2c_bus_read_byte` (`0x102790`) | octet à lire, suivi d'un octet de plus |
| `0xE1` | `i2c_bus_read_last_byte` (`0x102734`) | dernier octet à lire, avec arrêt, sans accusé (3dbrew donne les mêmes valeurs `0xE1` et `0xF0` pour les commandes 19 à 21) |

Chacune écrit `CNT`, puis appelle `WaitSynchronization1` (`0x24`, sans délai) sur l'événement du bus (`0x10b948` + 4 fois le numéro de bus), puis lit le bit 4 de `CNT`, qu'elle rend. Une transaction (par exemple `i2c_read_reg8`, `0x104288` : départ en écriture, registre, départ en lecture, dernier octet) est refaite jusqu'à huit fois ; un échec dans l'enchaînement appelle `i2c_bus_abort` avant le prochain essai.

### Les interruptions

`i2c_init_buses` (`0x10296c`, 448 octets), appelée par le premier verrou de bus, fait :

1. crée les trois événements de bus (`svcCreateEvent`, `0x17`) et initialise les trois verrous (`0x10b924`) ;
2. crée le fil d'initialisation (priorité 11, pile de `0x400` octets, point d'entrée `0x104618`) : il lie `0x54` à l'événement du bus 0 et `0x5C` à celui du bus 2, avec la priorité 8 et la remise à zéro automatique (`i2c_bind_interrupts_thread_main`, `svcBindInterrupt`) ; l'appelant attend sa fin et le joint ;
3. lie `0x55` (bus 1) dans le fil appelant ;
4. écrit `CNTEX = 2` et `SCL = 0x500` dans chacune des trois pages ;
5. baisse (`ClearEvent`, `0x19`) les trois événements.

La correspondance `0x54` à `0x1EC61000`, `0x55` à `0x1EC44000` et `0x5C` à `0x1EC48000` est celle de l'ordre des événements dans les tables du module ; elle est aussi celle de 3dbrew (interruptions I2C1, I2C2, I2C3). L'exheader déclare une quatrième entrée, `0x7F`, qui est une valeur de remplissage.

## Partie 5 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x106000` | les neuf noms de service (`i2c::MCU` ... `i2c::QTM`), puis `srv:` (`0x1060DC`), `srv:pm` (`0x1060E1`, jamais ouvert), `err:f` (`0x10611C`) |
| `0x106050` | les trois pages de registres (`0x1EC61000`, `0x1EC44000`, `0x1EC48000`) ; `0x10605C`, trois adresses de `CNT` (`+1`) |
| `0x106068` | la table des 18 appareils (cinq octets : numéro de bus, adresse d'écriture, trois zéros) |
| `0x107000` | le nombre de sessions en cours |
| `0x107004` | la table des neuf services : pointeur vers le nom ; `0x107028`, la table des neuf fonctions de fil |
| `0x107050` | octet « bus initialisés » ; `0x107058` l'objet de durées |
| `0x107068` | l'objet du fil d'initialisation |
| `0x1070C8` | les objets des neuf fils de session (8 octets chacun) |
| `0x107110` | les piles des neuf fils de session (`0x800` octets chacune) |
| `0x10B910` | l'objet de notification ; `0x10B920` l'octet d'arrêt |
| `0x10B924` | les trois verrous de bus ; `0x10B948` les trois événements de bus |

## Partie 6 : les services que i2c appelle

Seulement `srv:` et `err:f` ; 6 appels à `svcSendSyncRequest` (`0x32`) : `SRV_RegisterClient` (`0x100e14`), `SRV_EnableNotification` (`0x100e50`), `SRV_RegisterService` (neuf appels, `0x100a2c`), `SRV_UnregisterService` (`0x100a88`), `SRV_ReceiveNotification` (`0x100e8c`), `ERRF_Throw` (`0x101294`). Noms de [sm](sm.md).

## Partie 7 : les appels système utilisés

`ControlMemory` (`0x01`, le tas), `ExitProcess` (`0x03`), `CreateThread` (`0x08`, `svcCreateThread` à `0x100c58`), `ExitThread` (`0x09`), `SleepThread` (`0x0A`), `CreateMutex` (`0x13`, `svcCreateMutex` à `0x1018b4`), `CreateEvent` (`0x17`, `svcCreateEvent` à `0x10189c`), `ClearEvent` (`0x19`, trois fois), `CreateAddressArbiter` (`0x21`), `ArbitrateAddress` (`0x22`), `CloseHandle` (`0x23`, 21 endroits), `WaitSynchronization1` (`0x24`, 17 endroits : un par étape de transfert et dans les attentes de fils), `WaitSynchronizationN` (`0x25`), `DuplicateHandle` (`0x27`), `GetProcessInfo` (`0x2B`), `ConnectToPort` (`0x2D`), `SendSyncRequest` (`0x32`, 6 endroits), `GetProcessId` (`0x35`), `Break` (`0x3C`), `AcceptSession` (`0x4A`), `ReplyAndReceive` (`0x4F`), `BindInterrupt` (`0x50`, une seule fois, dans `svcBindInterrupt`).

## Les désaccords relevés

- **3dbrew, commandes 7 et 10.** La page donne un registre d'un octet (`u8 regid`) à `WriteRegister16` et à `ReadRegister16`. Le code lit un mot de 16 bits (`ushort`) au mot 2 de la requête et envoie deux octets de registre. Les noms de 3dbrew pour les commandes 4, 8 et 12 (`regid` de 16 bits) vont dans le même sens.
- **3dbrew, appareil 9.** `0xA6` avant 8.0.0-18, `0xD6` après : le module lu a `0xD6`.
- **Version New 3DS seulement.** 3dbrew note que les commandes 19 à 21 renvoient une erreur sur le module de l'Old 3DS ; ce module n'a pas de restriction de ce genre (c'est celui de la New 3DS). Le module de l'Old 3DS n'est pas dans la NAND lue.
- **Carte des services.** À vérifier avec `carte-des-services/donnees.js` (voir le rapport).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 21 commandes, leur fonction, leur en-tête de réponse et ceux de requête pour celles à tampon : le pseudo-code de `i2c_handle_command` (`0x101f28`) d'un côté, `emulate_dispatch.py` de l'autre ; les en-têtes de 3dbrew tombent sur les mêmes numéros.
- La table des appareils permis par service : `i2c_service_may_access_device` (le pseudo-code, une `switch` sur le numéro) et la table de 3dbrew (« I2C Service Names »), qui donnent les mêmes neuf listes.
- La table des 18 appareils (bus, adresse) : les cinq octets de `0x106068` et la table de 3dbrew.
- Les neuf noms de service et leur limite d'une session : 3dbrew, la table de `0x107004` et le quatrième argument de `SRV_RegisterService`.
- Les trois pages matérielles : les descripteurs de l'exheader d'un côté, les adresses de `0x106050` et les registres de 3dbrew de l'autre (DATA, CNT, CNTEX, SCL aux décalages 0, 1, 2, 4).
- Les valeurs écrites dans `CNT` (`0xC0`, `0xC1`, `0xC2`, `0xC5`, `0xE1`, `0xF0`) : l'assembleur du module ; 3dbrew donne `0xE1` et `0xF0` pour les commandes 19 à 21 et la table des bits de `CNT`.
- Les trois interruptions `0x54`, `0x55`, `0x5C` : la liste de l'exheader d'un côté, les trois appels à `svcBindInterrupt` du module de l'autre.
- Le fait que le module n'ouvre aucun autre service : liste vide, et six requêtes pour six appels à `svc 0x32`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- L'association de chaque interruption à son bus (`0x54` au bus 0, `0x55` au bus 1, `0x5C` au bus 2) : lue dans l'ordre des deux tables du module et de l'initialisation ; 3dbrew donne les mêmes numéros aux mêmes bus.
- La durée réelle de la pause avant chaque départ (trois fois la première durée de `0x107058`) : le calcul vient de constantes de la bibliothèque que je n'ai pas élucidées.
- Que le processeur 3 des fils `i2c::CAM`, `i2c::HID` et `i2c::QTM` soit un choix délibéré : c'est la valeur passée à `svcCreateThread`.
- Les noms `_cmd0e`, `_cmd0f`, `_cmd11`, `_cmd12` : les fonctions de ces commandes sont identiques en travail à d'autres (les commandes 14 et 17 à `i2c_write_buffer8`, 18 à `i2c_read_buffer8`) ; elles gardent le numéro pour ne pas en choisir une de trop.
- Les noms des fonctions de la bibliothèque, reconnus par l'identité du code avec des fonctions déjà nommées dans d'autres modules.

**Pas lu**
- Le détail de `i2c_update_bits16` (`0x1040dc`) et de `i2c_read_reg16`/`i2c_read_buffer16` jusqu'au dernier bit (l'ordre des deux octets de poids est lu, pas les cas limites de taille).
- Le corps des fonctions de bibliothèque : tas, gestionnaire d'adresses (`reserve_address_range`), thread local, objets de verrous.
- 71 fonctions de Ghidra et 16 entrées manquées n'avaient pas de nom ; toutes en ont un (haute dans la fiche ou moyenne en proposition) ; la plupart viennent de la bibliothèque.
- Ce que les clients envoient : les fiches de `hid`, `gsp`, `ir`, `cfg` donnent leurs commandes (2, 5, 5, 16) ; celles de `mcu`, `camera`, `nfc` et `qtm` restent à lire côté appelant.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 194 fonctions, projet Ghidra | `outils/ghidra_direct.py i2c` | une minute |
| Table des 21 commandes | `outils/emulate_dispatch.py i2c 0x101f28=i2c` | immédiat |
| Assembleur du module | objdump de devkitPro (`code.asm`) | immédiat |
| Exheader (pages, interruptions) | `local/analyse/gpio/exh.py` | immédiat |
| Pseudo-code avec les constantes des tables de littéraux | `local/analyse/gpio/lit.py` | immédiat |
| Noms de la bibliothèque | `local/analyse/gpio/match.py` (code identique aux adresses près dans d'autres modules) | immédiat |
| 3dbrew : « I2C Services » et « I2C Registers » | web.archive.org, capture de 2022 | |

Les scripts et le brut sont dans `local/analyse/i2c/` et `local/analyse/gpio/` (non versionné).

**Pour reprendre.** `i2c.noms.tsv` est le fichier de graines. Les noms en `i2c_` sont les commandes reçues, les fonctions de travail et les étapes de bus (`i2c_bus_*`). Endroits à relire en premier : `i2c_init_buses` et `i2c_update_bits16`.
