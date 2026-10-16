# camera, les deux caméras et le convertisseur YUV vers RGB

`camera` pilote les deux capteurs d'image de la console (la caméra extérieure, qui est double, et la caméra intérieure) et le convertisseur de couleurs matériel. Il offre cinq services : `cam:u` pour les jeux, `cam:s` et `cam:c` pour le système (réglage et étalonnage), `cam:q` pour le module de suivi du visage (New 3DS seulement) et `y2r:u` pour la conversion. Un jeu lui demande les images par une copie (DMA) du port de la caméra vers son propre tampon ; il lui fait aussi convertir ces images, ou n'importe quelles autres, du format YUV vers le RGB par `y2r:u`.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`, le module est presque entièrement en Thumb) et recoupée par l'exécution des aiguillages (`outils/emulate_dispatch.py`). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020001602`, un titre de la CTRNAND réservé à la New 3DS (lu dans l'exheader) |
| Fichier lu | `local/extrait/camera/exefs/code.bin` et `exheader.bin` (122 880 octets de fichier) |
| Taille | 82 916 octets de code (`.text`, 21 pages), 32 500 de données en lecture seule, 1 588 de données, 9 996 de mémoire à zéro ; pile de 0x1000 |
| Fonctions | 1 029, dont 945 en Thumb et 84 en ARM ; 287 nommées dans `camera.noms.tsv` |
| Services offerts | `cam:u`, `cam:s`, `cam:c` (même aiguillage, 68 commandes), `y2r:u` (45 commandes), `cam:q` (62 commandes, un fil à part, New 3DS seulement) |
| Services appelés | `i2c::CAM`, `mcu::CAM`, `pdn:c`, `cfg:s`, `csnd:SND`, `ptm:s` (la liste de l'exheader), plus `srv:` et le port `err:f` |
| Dépendance déclarée | un seul titre, `0004013000002702` |
| Pages d'entrées-sorties demandées | `0x1EC20000`, `0x1EC21000`, `0x1EE20000`, `0x1EE21000`, `0x1EC02000`, `0x1EE02000` (descripteurs `0xFFE1EC20`, `…EC21`, `…EE20`, `…EE21`, `…EC02`, `…EE02` de l'exheader) |
| Fils | le fil principal (`camera_main`), un fil « gestionnaire des caméras » (`0x1016a8`), un fil des interruptions des caméras (`0x101c1c`) et, sur New 3DS, le fil de `cam:q` (`0x1012a0`) |

Le module est écrit en C++ avec une bibliothèque d'objets (verrous récursifs, événements, fils) : les 1 029 fonctions sont en grande partie des petites méthodes de cette bibliothèque, et la plupart des commandes sont des gabarits qui diffèrent par la fonction de travail appelée.

## Partie 1 : le démarrage

`entry` (`0x100000`, ARM) appelle, à la suite :

1. `clear_bss` (`0x100024`), qui met à zéro `0x11d638` à `0x11fd40`.
2. Deux fonctions Thumb (`0x100070`, `0x1000b4`) puis `0x1000a8` qui réserve un tas de `0x8000` octets (`ControlMemory`), et le parcours des constructeurs statiques (`0x10fa7c`, table de distances, puis `run_init_array` à `0x100054`). Les constructeurs posent entre autres les identifiants de client à `0x11d37c` (0), `0x11d384` (1), `0x11d38c` (2) et `0x11d394` (3), dans `0x11292c`.
3. `main_trampoline` (`0x100048`), qui appelle `camera_main`.
4. `svcExitProcess` (`0x1130f4`).

`camera_main` (`0x100100`) fait tout le reste. Dans l'ordre :

1. `register_service` (`0x100a22`) déclare, une fois par ligne de la table `0x115068`, les quatre services du fil principal, chacun avec une seule session au plus (le second champ de chaque ligne vaut 1).
2. `open_ptm_session` (`0x1004c4`) ouvre `ptm:s`.
3. `register_notification_handlers` (`0x100784`) inscrit les gestionnaires de `0x214`, `0x213` et `0x10B` (partie 2), pose l'octet « New 3DS » (`is_new3ds`, `0x100928`, qui demande `PTMSYSM_CheckNew3DS` à `ptm:s`), puis appelle `init_driver_state` (`0x100d10`) et `y2r_driver_start` (`0x100c2c`).
4. `init_driver_state` met à zéro la grosse structure d'état du pilote (`0x11d280`), ouvre `i2c::CAM`, `mcu::CAM` et `pdn:c` (noms à `0x115004`, `0x11500a`, `0x115013`) et crée deux fils : le gestionnaire des caméras (`0x1016a8`) et le fil des interruptions (`0x101c1c`). `y2r_driver_start` crée l'événement de fin de conversion et lie l'interruption `0x4B` à cet événement (`BindInterrupt`).
5. `camera_main` inscrit encore les gestionnaires de `0x100`, `0x104` et `0x105`, demande à `srv:` le sémaphore des notifications (`SRV_EnableNotification`), s'abonne à `0x104` et `0x105`, puis `subscribe_notifications_and_start_qtm_thread` (`0x1006c8`) s'abonne à `0x213`, `0x214` et `0x10B` et, sur New 3DS, crée le fil de `cam:q`.
6. La boucle de service (partie 2).
7. À la sortie : `shutdown_services` (`0x100824`) arrête le fil de `cam:q`, `reset_driver_state` (`0x1010a8`) remet l'état à zéro, `y2r_driver_stop` (`0x100c98`) délie l'interruption.

Pendant ce temps, le fil des interruptions (`camera_interrupt_thread_main`, `0x101c1c`) lie les interruptions `0x48` et `0x49` (une par port de caméra) à deux événements, attend l'un ou l'autre, note l'heure de chaque synchro verticale (`GetSystemTick`) dans un anneau de six entrées par port (`0x11db80`, 0x30 octets par port) et signale les événements de synchro et d'erreur de tampon que `cam:u` distribue (commandes 5 et 6).

## Partie 2 : la boucle de service

`camera_main` appelle `svcReplyAndReceive` (`0x10c18c`) sur une liste de poignées (au plus neuf) rangée à `0x11fd1c`. Les indices ont un sens fixe :

| Indice | Poignée |
| --- | --- |
| 0 | le sémaphore des notifications de `srv:` |
| 1 à 4 | les ports des quatre services, dans l'ordre de la table `0x115068` : `cam:u`, `y2r:u`, `cam:s`, `cam:c` |
| 5 à 8 | les sessions ouvertes (quatre au plus) |

Chaque tour :

- Indice 0 : une notification est arrivée. `handle_srv_notification` (`0x10054c`) lit son numéro (`SRV_ReceiveNotification`) et appelle le gestionnaire inscrit.
- Indices 1 à 4 : un client se connecte. `svcAcceptSession` (`0x113238`) donne la poignée de session, qui est rangée à la suite de la liste ; `open_session_context` (`0x100640`) rend le contexte du client (un octet : 0 pour `cam:u`, 1 pour `cam:s`, 2 pour `cam:c`), pose l'octet `0x11d36c` à 1 quand c'est une session `cam:c` (il retombe à 0 à sa fermeture) et, pour `y2r:u`, monte de 1 l'octet `0x11d3a2` (`y2r_PingProcess` le rend). S'il n'y a plus de case, la session est refermée.
- Indice 5 et plus : une commande arrive. Avec chaque session, le module a rangé le numéro du service (0 à 3, l'indice du port moins un) et le contexte du client ; le numéro choisit dans la table `0x115088` le gestionnaire de commande : `cam_handle_command` (`0x111538`) pour `cam:u`, `cam:s` et `cam:c`, `y2r_handle_command` (`0x10feec`) pour `y2r:u`. Le gestionnaire reçoit le contexte du client.
- Une session fermée (résultat `0xC920181A`) : `close_session_slot` (`0x100880`) referme la poignée et libère la case.

Un client `cam:u`, `cam:s` ou `cam:c` ne se distingue des autres que par l'octet de son contexte. Cet octet sert de clé dans la table des caméras possédées (`get_session_camera_mask`) : un client ne touche que les caméras qui lui sont attribuées, et le client numéro 3 (`cam:q`) a priorité sur les autres.

**`cam:q`.** Sur New 3DS, un fil à part (`camq_thread_main`, `0x1012a0`) déclare `cam:q` (nom à `0x115020`, une session), attend une seule connexion puis traite ses commandes dans `camq_receive_loop` (`0x101ee0`) : l'aiguillage est `camq_handle_command` (`0x102c60`, 62 commandes). Pokémon X ne l'utilise pas.

### Les notifications

`register_notification_handlers` (`0x100784`) et `camera_main` inscrivent six gestionnaires. Les numéros sont ceux de `srv:` ; leur sens est celui que les fiches de `hid` et `ptm` donnent aux mêmes numéros.

| Notification | Gestionnaire | Adresse | Ce que fait le code |
| --- | --- | --- | --- |
| `0x100` | `on_terminate_notification` | `0x112f9c` | Met l'octet `0x11d5fc` à 1, appelle `0x10c0bc` et `0x1077e4`, arrête Y2R (`y2r_driver_finalize_impl`) et pose deux drapeaux (`0x11d294`, `0x11d3a3`) : l'arrêt du module |
| `0x104` | `on_sleep_notification` | `0x112ff8` | Met l'octet `0x11d287` à 1, arrête la conversion de Y2R, met les caméras en pause, puis envoie `PTMSYSM_NotifySleepPreparationComplete` à `ptm` |
| `0x105` | `on_wake_notification` | `0x112fc8` | Remet l'octet `0x11d287` à 0, remet les caméras en marche, puis le même message à `ptm` |
| `0x213` | `on_shell_opened_notification` | `0x112318` | Met l'octet `0x11d288` à 0 et remet les caméras en marche (`0x11235c`) ; sans effet tant qu'une session `cam:c` est ouverte (octet `0x11d36c`) |
| `0x214` | `on_shell_closed_notification` | `0x112334` | Met l'octet `0x11d288` à 1 et met les caméras en pause (`0x1123a8`) ; même réserve |
| `0x10B` | `on_notification_10b` | `0x112354` | Appelle `0x111288`, qui libère deux objets (sens non lu) |

`get_unavailable_reason` (`0x10a48c`) lit ces deux octets : 2 si la console est en veille, 1 si le couvercle est fermé, 0 sinon. Presque toutes les commandes qui touchent aux caméras commencent par là : si le résultat est non nul, elles comptent le refus (`count_refused_request`, qui, tous les 64 refus, dort un instant) et rendent **`0xC9405001`**.

## Partie 3 : les commandes de `cam:u`

Les trois services `cam:u`, `cam:s` et `cam:c` partagent un seul aiguillage, `cam_handle_command` (`0x111538`, 2 352 octets). Il lit le numéro dans les 16 bits du haut de l'en-tête et saute par la table d'octets de l'aide de « switch » (69 entrées, de 0 à `0x44`, juste après l'appel à `0x10b978`) ; un numéro inconnu rend `0xD900182F`. Les paramètres et les en-têtes de requête sont ceux de la Carte des services ; l'adresse, l'en-tête de réponse et ce que fait la fonction sont lus dans le module. Les 68 numéros tombent sur les mêmes fonctions par l'exécution de l'aiguillage et par le pseudo-code des blocs `case` (partie « sûr »).

Dans la dernière colonne, **[nom]** signale une ligne dont le sens vient seulement du nom de la Carte et du gabarit de la fonction (partie 4), et **PX** une commande que Pokémon X envoie.

| N° | En-tête de requête (Carte) | Commande (Carte) | Fonction | Adresse | En-tête de réponse | Ce que fait la fonction |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010040` | StartCapture | `cam_StartCapture` | `0x10433c` | `0x00010040` | démarre la capture des ports demandés **PX** |
| 2 | `0x00020040` | StopCapture | `cam_StopCapture` | `0x10405c` | `0x00020040` | arrête la capture **PX** |
| 3 | `0x00030040` | IsBusy | `cam_IsBusy` | `0x105f0c` | `0x00030080` | dit si les ports demandés sont occupés **PX** |
| 4 | `0x00040040` | ClearBuffer | `cam_ClearBuffer` | `0x10a8c0` | `0x00040040` | vide le tampon de réception **PX** |
| 5 | `0x00050040` | GetVsyncInterruptEvent | `cam_GetVsyncInterruptEvent` | `0x1053c0` | `0x00050042` | rend la poignée de l'événement de synchro verticale (port 1 ou 2) **PX** |
| 6 | `0x00060040` | GetBufferErrorInterruptEvent | `cam_GetBufferErrorInterruptEvent` | `0x1055ec` | `0x00060042` | rend la poignée de l'événement d'erreur de tampon (port 1 ou 2) **PX** |
| 7 | `0x00070102` | SetReceiving | `cam_SetReceiving` | `0x1041e0` | `0x00070042` | lance le transfert d'une image vers le tampon du client (DMA), rend l'événement de fin **PX** |
| 8 | `0x00080040` | IsFinishedReceiving | `cam_IsFinishedReceiving` | `0x1050ac` | `0x00080080` | dit si la réception est finie [nom] |
| 9 | `0x00090100` | SetTransferLines | `cam_SetTransferLines` | `0x104ad8` | `0x00090040` | règle le nombre de lignes par transfert [nom] **PX** |
| 10 | `0x000A0080` | GetMaxLines | `cam_GetMaxLines` | `0x10a848` | `0x000A0080` | rend le nombre maximal de lignes par transfert pour une taille d'image **PX** |
| 11 | `0x000B0100` | SetTransferBytes | `cam_SetTransferBytes` | `0x104a7c` | `0x000B0040` | règle le nombre d'octets par transfert [nom] **PX** |
| 12 | `0x000C0040` | GetTransferBytes | `cam_GetTransferBytes` | `0x104a30` | `0x000C0080` | rend le nombre d'octets par transfert [nom] **PX** |
| 13 | `0x000D0080` | GetMaxBytes | `cam_GetMaxBytes` | `0x10a81c` | `0x000D0080` | rend le nombre maximal d'octets par transfert pour une taille d'image [nom] **PX** |
| 14 | `0x000E0080` | SetTrimming | `cam_SetTrimming` | `0x104010` | `0x000E0040` | active ou coupe le recadrage [nom] **PX** |
| 15 | `0x000F0040` | IsTrimming | `cam_IsTrimming` | `0x10a7a8` | `0x000F0080` | dit si le recadrage est actif [nom] |
| 16 | `0x00100140` | SetTrimmingParams | `cam_SetTrimmingParams` | `0x104c34` | `0x00100040` | règle la fenêtre de recadrage [nom] |
| 17 | `0x00110040` | GetTrimmingParams | `cam_GetTrimmingParams` | `0x104b34` | `0x00110140` | rend la fenêtre de recadrage [nom] |
| 18 | `0x00120140` | SetTrimmingParamsCenter | `cam_SetTrimmingParamsCenter` | `0x105454` | `0x00120040` | règle le recadrage par son centre [nom] **PX** |
| 19 | `0x00130040` | Activate | `cam_Activate` | `0x106028` | `0x00130040` | choisit les caméras actives **PX** |
| 20 | `0x00140080` | SwitchContext | `cam_SwitchContext` | `0x104448` | `0x00140040` | change de contexte (A/B) d'une caméra [nom] |
| 21 | `0x00150080` | SetExposure | `cam_SetExposure` | `0x103f70` | `0x00150040` | règle l'exposition [nom] **PX** |
| 22 | `0x00160080` | SetWhiteBalance | `cam_SetWhiteBalance` | `0x104968` | `0x00160040` | règle la balance des blancs [nom] **PX** |
| 23 | `0x00170080` | SetWhiteBalanceWithoutBaseUp | `cam_SetWhiteBalanceWithoutBaseUp` | `0x111364` | `0x00170040` | règle la balance des blancs sans la mise à niveau de base [nom] |
| 24 | `0x00180080` | SetSharpness | `cam_SetSharpness` | `0x10429c` | `0x00180040` | règle la netteté [nom] **PX** |
| 25 | `0x00190080` | SetAutoExposure | `cam_SetAutoExposure` | `0x104810` | `0x00190040` | active ou coupe l'exposition automatique [nom] **PX** |
| 26 | `0x001A0040` | IsAutoExposure | `cam_IsAutoExposure` | `0x1045f8` | `0x001A0080` | dit si l'exposition automatique est active [nom] |
| 27 | `0x001B0080` | SetAutoWhiteBalance | `cam_SetAutoWhiteBalance` | `0x1050ec` | `0x001B0040` | active ou coupe la balance des blancs automatique [nom] **PX** |
| 28 | `0x001C0040` | IsAutoWhiteBalance | `cam_IsAutoWhiteBalance` | `0x104f7c` | `0x001C0080` | dit si la balance des blancs automatique est active [nom] |
| 29 | `0x001D00C0` | FlipImage | `cam_FlipImage` | `0x10628c` | `0x001D0040` | retourne l'image [nom] **PX** |
| 30 | `0x001E0200` | SetDetailSize | `cam_SetDetailSize` | `0x104380` | `0x001E0040` | règle une taille d'image détaillée [nom] |
| 31 | `0x001F00C0` | SetSize | `cam_SetSize` | `0x105f80` | `0x001F0040` | règle la taille d'image [nom] **PX** |
| 32 | `0x00200080` | SetFrameRate | `cam_SetFrameRate` | `0x1040a0` | `0x00200040` | règle la cadence [nom] **PX** |
| 33 | `0x00210080` | SetPhotoMode | `cam_SetPhotoMode` | `0x104140` | `0x00210040` | règle le mode photo [nom] **PX** |
| 34 | `0x002200C0` | SetEffect | `cam_SetEffect` | `0x106334` | `0x00220040` | règle l'effet [nom] **PX** |
| 35 | `0x00230080` | SetContrast | `cam_SetContrast` | `0x10a708` | `0x00230040` | règle le contraste [nom] **PX** |
| 36 | `0x00240080` | SetLensCorrection | `cam_SetLensCorrection` | `0x104b94` | `0x00240040` | règle la correction d'objectif [nom] **PX** |
| 37 | `0x002500C0` | SetOutputFormat | `cam_SetOutputFormat` | `0x1048c0` | `0x00250040` | règle le format de sortie [nom] |
| 38 | `0x00260140` | SetAutoExposureWindow | `cam_SetAutoExposureWindow` | `0x1052b4` | `0x00260040` | règle la fenêtre de l'exposition automatique [nom] **PX** |
| 39 | `0x00270140` | SetAutoWhiteBalanceWindow | `cam_SetAutoWhiteBalanceWindow` | `0x10553c` | `0x00270040` | règle la fenêtre de la balance des blancs automatique [nom] **PX** |
| 40 | `0x00280080` | SetNoiseFilter | `cam_SetNoiseFilter` | `0x1046bc` | `0x00280040` | active ou coupe le filtre de bruit [nom] **PX** |
| 41 | `0x00290080` | SynchronizeVsyncTiming | `cam_SynchronizeVsyncTiming` | `0x105400` | `0x00290040` | synchronise le battement vertical (non lue) [nom] |
| 42 | `0x002A0080` | GetLatestVsyncTiming | `cam_GetLatestVsyncTiming` | `0x1051a4` | `0x002A0042` | rend la dernière mesure du battement vertical [nom] |
| 43 | `0x002B0000` | GetStereoCameraCalibrationData | `cam_GetStereoCameraCalibrationData` | `0x1056c8` | `0x002B0440` | rend les données d'étalonnage stéréo (0x40 octets) [nom] |
| 44 | `0x002C0400` | SetStereoCameraCalibrationData | `cam_SetStereoCameraCalibrationData` | `0x111464` | `0x002C0040` | écrit les données d'étalonnage stéréo [nom] |
| 45 | `0x002D00C0` | WriteRegisterI2c | `cam_WriteRegisterI2c` | `0x110fc0` | `0x002D0040` | écrit un registre I2C d'un capteur [nom] |
| 46 | `0x002E00C0` | WriteMcuVariableI2c | `cam_WriteMcuVariableI2c` | `0x111050` | `0x002E0040` | écrit une variable du microcontrôleur de la caméra [nom] |
| 47 | `0x002F0080` | ReadRegisterI2cExclusive | `cam_ReadRegisterI2cExclusive` | `0x11119c` | `0x002F0080` | lit un registre I2C [nom] |
| 48 | `0x00300080` | ReadMcuVariableI2cExclusive | `cam_ReadMcuVariableI2cExclusive` | `0x1112d4` | `0x00300080` | lit une variable du microcontrôleur de la caméra [nom] |
| 49 | `0x00310180` | SetImageQualityCalibrationData | `cam_SetImageQualityCalibrationData` | `0x111428` | `0x00310040` | écrit les données d'étalonnage de la qualité d'image [nom] |
| 50 | `0x00320000` | GetImageQualityCalibrationData | `cam_GetImageQualityCalibrationData` | `0x111404` | `0x003201C0` | rend les données d'étalonnage de la qualité d'image (0x16 octets) [nom] |
| 51 | `0x003302C0` | SetPackageParameterWithoutContext | `cam_SetPackageParameterWithoutContext` | `0x1058b0` | `0x00330040` | paquet de réglages sans contexte (0x1C octets, non lue) [nom] |
| 52 | `0x00340140` | SetPackageParameterWithContext | `cam_SetPackageParameterWithContext` | `0x1056f4` | `0x00340040` | paquet de réglages avec contexte (non lue) [nom] |
| 53 | `0x003501C0` | SetPackageParameterWithContextDetail | `cam_SetPackageParameterWithContextDetail` | `0x105d88` | `0x00350040` | paquet de réglages détaillé (non lue) [nom] |
| 54 | `0x00360000` | GetSuitableY2rStandardCoefficient | `cam_GetSuitableY2rStandardCoefficient` | `0x105818` | `0x00360080` | rend le coefficient Y2R qui convient (un octet) **PX** |
| 55 | `0x00370202` | PlayShutterSoundWithWave | `cam_PlayShutterSoundWithWave` | `0x10a698` | `0x00370042` | joue le bruit d'obturateur avec une onde fournie par le client (non lue) [nom] |
| 56 | `0x00380040` | PlayShutterSound | `cam_PlayShutterSound` | `0x113378` | `0x00380040` | joue le bruit d'obturateur (par csnd, non lue) [nom] |
| 57 | `0x00390000` | DriverInitialize | `cam_DriverInitialize` | `0x104a0c` | `0x00390040` | initialise le pilote **PX** |
| 58 | `0x003A0000` | DriverFinalize | `cam_DriverFinalize` | `0x1044e8` | `0x003A0040` | arrête le pilote **PX** |
| 59 | `0x003B0000` | GetActivatedCamera | `cam_GetActivatedCamera` | `0x104f00` | `0x003B0080` | rend les caméras activées **PX** |
| 60 | `0x003C0000` | GetSleepCamera | `cam_GetSleepCamera` | `0x10451c` | `0x003C0080` | rend les caméras en veille **PX** |
| 61 | `0x003D0040` | SetSleepCamera | `cam_SetSleepCamera` | `0x10475c` | `0x003D0040` | met des caméras en veille **PX** |
| 62 | `0x003E0040` | SetBrightnessSynchronization | `cam_SetBrightnessSynchronization` | `0x10562c` | `0x003E0040` | synchronise la luminosité (non lue) [nom] |
| 63 | `0x003F0040` | sans nom | `cam_cmd003F` | `0x110f38` | `0x003F0040` | rendue sans rien faire [nom] |
| 64 | `0x004000C0` | sans nom | `cam_cmd0040` | `0x1071dc` | `0x00400040` | même fonction de travail que SetEffect |
| 65 | `0x00410040` | sans nom | `cam_cmd0041` | `0x1110e0` | `0x00410040` | non lue [nom] |
| 66 | `0x00420040` | sans nom | `cam_cmd0042` | `0x111498` | `0x00420040` | non lue [nom] |
| 67 | `0x00430000` | sans nom | `cam_cmd0043` | `0x1110fc` | `0x00430040` | non lue [nom] |
| 68 | `0x00440000` | sans nom | `cam_cmd0044` | `0x11122c` | `0x00440040` | non lue [nom] |

Deux numéros partagent une fonction de travail : la commande `0x40` appelle `0x1071dc` directement, et `SetEffect` (`0x22`) y passe par `cam_SetEffect` (`0x106334`, un simple appel). Sur `cam:q` la même fonction se retrouve à deux numéros.

### cam:q

62 commandes, dont 54 appellent les mêmes fonctions que `cam:u`, dans le même ordre, sans `SetWhiteBalanceWithoutBaseUp` (`cam:u` n° 23) ni les sept commandes `0x2C` à `0x32` de `cam:u` (étalonnage stéréo en écriture, accès I2C, étalonnage de la qualité d'image), ni les commandes `0x3F` à `0x44` : le numéro de `cam:q` est donc celui de `cam:u` moins un, puis moins huit à partir de `SetPackageParameterWithoutContext`. Les huit dernières (`0x37` à `0x3E`) sont propres à `cam:q`.

| N° cam:q | Fonction | En-tête de réponse | Même fonction que cam:u n° |
| --- | --- | --- | --- |
| 1 | `0x10433c` | `0x00010040` | 1 |
| 2 | `0x10405c` | `0x00020040` | 2 |
| 3 | `0x105f0c` | `0x00030080` | 3 |
| 4 | `0x10a8c0` | `0x00040040` | 4 |
| 5 | `0x1053c0` | `0x00050042` | 5 |
| 6 | `0x1055ec` | `0x00060042` | 6 |
| 7 | `0x1041e0` | `0x00070042` | 7 |
| 8 | `0x1050ac` | `0x00080080` | 8 |
| 9 | `0x104ad8` | `0x00090040` | 9 |
| 10 | `0x10a848` | `0x000A0080` | 10 |
| 11 | `0x104a7c` | `0x000B0040` | 11 |
| 12 | `0x104a30` | `0x000C0080` | 12 |
| 13 | `0x10a81c` | `0x000D0080` | 13 |
| 14 | `0x104010` | `0x000E0040` | 14 |
| 15 | `0x10a7a8` | `0x000F0080` | 15 |
| 16 | `0x104c34` | `0x00100040` | 16 |
| 17 | `0x104b34` | `0x00110140` | 17 |
| 18 | `0x105454` | `0x00120040` | 18 |
| 19 | `0x106028` | `0x00130040` | 19 |
| 20 | `0x104448` | `0x00140040` | 20 |
| 21 | `0x103f70` | `0x00150040` | 21 |
| 22 | `0x104968` | `0x00160040` | 22 |
| 23 | `0x10429c` | `0x00170040` | 24 |
| 24 | `0x104810` | `0x00180040` | 25 |
| 25 | `0x1045f8` | `0x00190080` | 26 |
| 26 | `0x1050ec` | `0x001A0040` | 27 |
| 27 | `0x104f7c` | `0x001B0080` | 28 |
| 28 | `0x10628c` | `0x001C0040` | 29 |
| 29 | `0x104380` | `0x001D0040` | 30 |
| 30 | `0x105f80` | `0x001E0040` | 31 |
| 31 | `0x1040a0` | `0x001F0040` | 32 |
| 32 | `0x104140` | `0x00200040` | 33 |
| 33 | `0x106334` | `0x00210040` | 34 |
| 34 | `0x10a708` | `0x00220040` | 35 |
| 35 | `0x104b94` | `0x00230040` | 36 |
| 36 | `0x1048c0` | `0x00240040` | 37 |
| 37 | `0x1052b4` | `0x00250040` | 38 |
| 38 | `0x10553c` | `0x00260040` | 39 |
| 39 | `0x1046bc` | `0x00270040` | 40 |
| 40 | `0x105400` | `0x00280040` | 41 |
| 41 | `0x1051a4` | `0x00290042` | 42 |
| 42 | `0x1056c8` | `0x002A0440` | 43 |
| 43 | `0x1058b0` | `0x002B0040` | 51 |
| 44 | `0x1056f4` | `0x002C0040` | 52 |
| 45 | `0x105d88` | `0x002D0040` | 53 |
| 46 | `0x105818` | `0x002E0080` | 54 |
| 47 | `0x10a698` | `0x002F0042` | 55 |
| 48 | `0x113378` | `0x00300040` | 56 |
| 49 | `0x104a0c` | `0x00310040` | 57 |
| 50 | `0x1044e8` | `0x00320040` | 58 |
| 51 | `0x104f00` | `0x00330080` | 59 |
| 52 | `0x10451c` | `0x00340080` | 60 |
| 53 | `0x10475c` | `0x00350040` | 61 |
| 54 | `0x10562c` | `0x00360040` | 62 |
| 55 | `0x106354` | `0x00370042` | — |
| 56 | `0x1063f4` | `0x00380140` | — |
| 57 | `0x106370` | `0x00390080` | — |
| 58 | `0x106430` | `0x003A0040` | — |
| 59 | `0x1063bc` | `0x003B0080` | — |
| 60 | `0x105218` | `0x003C0040` | — |
| 61 | `0x1045c0` | `0x003D0080` | — |
| 62 | `0x10518c` | `0x003E0040` | — |

## Partie 4 : le gabarit d'une commande de réglage

La plupart des commandes de `cam:u` (celles qui posent un réglage) ont la même forme, relevée dans une quinzaine de fonctions (`cam_SetExposure`, `cam_SetWhiteBalance`, `cam_SetSharpness`, `cam_SetAutoExposure`, `cam_SetFrameRate`, `cam_SetPhotoMode`, `cam_SetContrast`, `cam_SetLensCorrection`, `cam_SetNoiseFilter`, `cam_SetDetailSize`, `cam_SetAutoExposureWindow`, `cam_SetAutoWhiteBalanceWindow`, `cam_FlipImage`, `cam_SetSize`, `cam_SetEffect`…) :

1. Entrer dans le verrou du pilote (`scoped_lock_enter` sur `0x11e56c`).
2. `get_unavailable_reason` : si non nul, `count_refused_request` puis résultat `0xC9405001`.
3. Attendre tant que `get_shell_state` vaut 2 (transition), puis si elle vaut 1 rendre `0xF96053FE`.
4. Calculer les caméras visées : `get_session_camera_mask` donne les caméras du client ; on garde le **ET** avec le masque de la requête.
5. Si ce masque n'est pas vide, appeler la fonction de travail propre à la commande (celle qui écrit dans le capteur par `i2c::CAM`), puis, si elle a réussi, appeler la fonction « enregistrer dans le cache » du client (un double par réglage, dans le cache de session `0x11d62c`).
6. Si l'erreur rendue est de la classe 11 (`(code & 0x3FFFF) >> 10 == 0xB`), signaler l'événement d'erreur du pilote (`0x11d280 + 0xA0`), que le gestionnaire des caméras traite.
7. Quitter le verrou.

Le cache de session sert à restaurer les réglages quand les caméras changent de propriétaire. Il se compose d'un bloc de 0x108 octets par client (`get_session_cache`, `0x10afbc`, cinq blocs) : deux entrées de 0x14 octets par port (`get_port_record`, `0x10a938`, à `+4`) et trois fiches de caméra de 0x3C octets (`get_camera_settings_record`, `0x1097b0`, à `+0x2C` ; la caméra 1, 2 ou 4). `init_session_cache` (`0x10b4cc`) en pose les valeurs de départ, parmi lesquelles `0x100` et `0xC0` d'une part, `0x280` et `0x1E0` de l'autre dans chaque fiche (des tailles d'image, interprété).

### Ce que les fonctions de lecture lisent

- `IsBusy` (`0x105f0c`) : pour le port 1 (bit 1 de la requête) et le port 2 (bit 2), la réponse est le **ET** des états occupés des ports demandés ; un port que le client ne possède pas compte comme libre. L'argument supérieur à 3 est refusé par `check_port_argument` (`0x10a668`).
- `GetVsyncInterruptEvent` (`0x1053c0`) et `GetBufferErrorInterruptEvent` (`0x1055ec`) : pour le port 1 ou 2, la poignée correspondante est lue dans le tableau `0x11d770` (quatre cases : synchro du port 1, erreur du port 1, synchro du port 2, erreur du port 2). Tout autre port rend `0xE0E053ED`. La réponse a la forme `[en-tête, résultat, descripteur 0, poignée]`.
- `GetMaxLines` (`0x10a848` → `0x10cfa6` → `0x10ebfc`) et `GetMaxBytes` (`0x10a81c` → `0x10cf56`) : voir la table « Ce que Pokémon X envoie » pour les formules.
- `GetActivatedCamera` (`0x104f00`), `GetSleepCamera` (`0x10451c`), `SetSleepCamera` (`0x10475c`) : lisent et écrivent les octets `+3` (caméras activées), `+4` (veille posée par le pilote), `+5` et `+6` (veille demandée par un client, et l'indicateur qui dit qu'elle l'a été) de l'état du pilote (`0x11d280`) ; ils retirent des masques rendus les caméras que le client numéro 3 (`cam:q`) possède déjà.

## Partie 5 : SetReceiving pas à pas

`SetReceiving` (`cam_SetReceiving`, `0x1041e0`, commande `0x07`) est la commande qui livre l'image. Requête `0x00070102` : mot 1 l'adresse du tampon du client, mot 2 le port, mot 3 la taille de l'image en octets, mot 4 l'unité de transfert (16 bits), puis un descripteur de poignée (le processus du client) suivi de sa poignée.

1. `cam_handle_command` (cas `0x10c`) vérifie que l'en-tête est bien `0x00070102` (`0x10a890`) et que le descripteur de poignée (mot 5) vaut 0, c'est-à-dire la copie d'une seule poignée ; sinon il répond avec l'en-tête 0 et `0xD9001830`. Il appelle ensuite `cam_SetReceiving` avec la poignée du processus (mot 6), l'adresse du tampon (mot 1) et le port (mot 2).
2. `cam_SetReceiving` entre dans le verrou, calcule les ports du client (`get_session_port_mask`, qui replie les caméras 1 et 2 sur le port 1 et la caméra 4 sur le port 2). Si le port demandé n'appartient pas au client, il rend la poignée de repli `*0x11d2d4` avec un résultat 0, sans rien faire.
3. Sinon `start_camera_receive` (`0x1072e0`) : si l'octet `+0x14` de l'état du pilote est nul (mode « avec matériel »), il appelle `svcInvalidateProcessDataCache` (`0x1138ec`) sur le tampon du client (le DMA va écrire dans la mémoire, le cache doit être vidé), construit un descripteur de DMA (identifiant de périphérique 2 pour le port 1, 3 pour le port 2 ; il cherche la plus grande puissance de deux au plus égale à 0x80 qui divise l'unité de transfert, et la place dans le descripteur), puis `start_dma` (`0x108e9e`) appelle `svcStartInterProcessDma` (`0x114138`) depuis le port de données de la caméra, à **`0x1EE20000`** (port 1) ou **`0x1EE21000`** (port 2), vers le tampon du client. Il attend que `get_dma_state` (`0x108e7c`, `svcGetDmaState`) montre que le DMA a démarré (état au moins 2), puis range la poignée du DMA.
4. La réponse est `[0x00070042, résultat, descripteur 0, poignée du DMA]`. Le client attend sur cette poignée : elle se signale quand le DMA a fini d'écrire l'image.
5. Si le pilote est en veille ou si le couvercle est fermé (`get_unavailable_reason` non nul), ou si l'octet `+0x14` n'est pas nul, `start_camera_receive` rend la poignée déjà rangée à `+0x54` de l'état du pilote, sans lancer de transfert.

## Partie 6 : y2r:u, le convertisseur

`y2r_handle_command` (`0x10feec`, 1 520 octets) reçoit les 45 commandes de `y2r:u`. Les adresses de la table ci-dessous sont les fonctions de commande, qui sont de minces enveloppes autour d'un objet pilote à `0x11d3b8` : son champ `+4` est un décalage de banque (0 pour la première banque de registres, `0x30000` pour la seconde ; le module n'utilise que 0) à ajouter à la base `0x1EC02000`.

| N° | En-tête de requête (Carte) | Commande (Carte) | Fonction | Adresse | En-tête de réponse | Ce que fait la fonction |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010040` | SetInputFormat | `y2r_SetInputFormat` | `0x110828` | `0x00010040` | écrit le format d'entrée (bits 0 à 2 du registre de contrôle) **PX** |
| 2 | `0x00020000` | GetInputFormat | `y2r_GetInputFormat` | `0x110810` | `0x00020080` | lit le format d'entrée |
| 3 | `0x00030040` | SetOutputFormat | `y2r_SetOutputFormat` | `0x11085c` | `0x00030040` | écrit le format de sortie (bits 8 et 9) **PX** |
| 4 | `0x00040000` | GetOutputFormat | `y2r_GetOutputFormat` | `0x110840` | `0x00040080` | lit le format de sortie |
| 5 | `0x00050040` | SetRotation | `y2r_SetRotation` | `0x110548` | `0x00050040` | écrit la rotation (bits 10 et 11) **PX** |
| 6 | `0x00060000` | GetRotation | `y2r_GetRotation` | `0x11051c` | `0x00060080` | lit la rotation |
| 7 | `0x00070040` | SetBlockAlignment | `y2r_SetBlockAlignment` | `0x110960` | `0x00070040` | écrit l'alignement en blocs (bit 12) **PX** |
| 8 | `0x00080000` | GetBlockAlignment | `y2r_GetBlockAlignment` | `0x110934` | `0x00080080` | lit l'alignement en blocs |
| 9 | `0x00090040` | SetSpacialDithering | `y2r_SetSpacialDithering` | `0x110c40` | `0x00090040` | écrit le tramage spatial (bit 16) |
| 10 | `0x000A0000` | GetSpacialDithering | `y2r_GetSpacialDithering` | `0x110b94` | `0x000A0080` | lit le tramage spatial |
| 11 | `0x000B0040` | SetTemporalDithering | `y2r_SetTemporalDithering` | `0x110d7c` | `0x000B0040` | écrit le tramage temporel (bit 17) |
| 12 | `0x000C0000` | GetTemporalDithering | `y2r_GetTemporalDithering` | `0x110cfc` | `0x000C0080` | lit le tramage temporel |
| 13 | `0x000D0040` | SetTransferEndInterrupt | `y2r_SetTransferEndInterrupt` | `0x110dac` | `0x000D0040` | écrit l'interruption de fin de transfert (bit 30) **PX** |
| 14 | `0x000E0000` | GetTransferEndInterrupt | `y2r_GetTransferEndInterrupt` | `0x110d9c` | `0x000E0080` | lit l'interruption de fin de transfert |
| 15 | `0x000F0000` | GetTransferEndEvent | `y2r_GetTransferEndEvent` | `0x110ba4` | `0x000F0042` | rend la poignée de l'événement de fin de transfert **PX** |
| 16 | `0x00100102` | SetSendingY | `y2r_SetSendingY` | `0x1106dc` | `0x00100040` | DMA du plan Y vers le port d'entrée Y **PX** |
| 17 | `0x00110102` | SetSendingU | `y2r_SetSendingU` | `0x11055c` | `0x00110040` | DMA du plan U vers le port d'entrée U **PX** |
| 18 | `0x00120102` | SetSendingV | `y2r_SetSendingV` | `0x11061c` | `0x00120040` | DMA du plan V vers le port d'entrée V **PX** |
| 19 | `0x00130102` | SetSendingYuv | `y2r_SetSendingYuv` | `0x1107e0` | `0x00130040` | DMA du YUV entrelacé vers le port d'entrée YUV **PX** |
| 20 | `0x00140000` | IsFinishedSendingYuv | `y2r_IsFinishedSendingYuv` | `0x110d1c` | `0x00140080` | le DMA du YUV entrelacé est-il fini **PX** |
| 21 | `0x00150000` | IsFinishedSendingY | `y2r_IsFinishedSendingY` | `0x110a78` | `0x00150080` | le DMA du plan Y est-il fini |
| 22 | `0x00160000` | IsFinishedSendingU | `y2r_IsFinishedSendingU` | `0x110a50` | `0x00160080` | le DMA du plan U est-il fini |
| 23 | `0x00170000` | IsFinishedSendingV | `y2r_IsFinishedSendingV` | `0x110a64` | `0x00170080` | le DMA du plan V est-il fini |
| 24 | `0x00180102` | SetReceiving | `y2r_SetReceiving` | `0x110798` | `0x00180040` | DMA du port de sortie vers le tampon du client **PX** |
| 25 | `0x00190000` | IsFinishedReceiving | `y2r_IsFinishedReceiving` | `0x110bb4` | `0x00190080` | le DMA de sortie est-il fini **PX** |
| 26 | `0x001A0040` | SetInputLineWidth | `y2r_SetInputLineWidth` | `0x110974` | `0x001A0040` | écrit la largeur d'une ligne d'entrée (registre +4) **PX** |
| 27 | `0x001B0000` | GetInputLineWidth | `y2r_GetInputLineWidth` | `0x110950` | `0x001B0080` | lit la largeur d'une ligne d'entrée |
| 28 | `0x001C0040` | SetInputLines | `y2r_SetInputLines` | `0x1107d0` | `0x001C0040` | écrit le nombre de lignes d'entrée (registre +6) **PX** |
| 29 | `0x001D0000` | GetInputLines | `y2r_GetInputLines` | `0x1107c0` | `0x001D0080` | lit le nombre de lignes d'entrée |
| 30 | `0x001E0100` | SetCoefficientParams | `y2r_SetCoefficientParams` | `0x110d30` | `0x001E0040` | écrit les huit coefficients de conversion (registres +0x10 à +0x1E) |
| 31 | `0x001F0000` | GetCoefficientParams | `y2r_GetCoefficientParams` | `0x110cec` | `0x001F0140` | lit les coefficients |
| 32 | `0x00200040` | SetStandardCoefficient | `y2r_SetStandardCoefficient` | `0x110d8c` | `0x00200040` | choisit un jeu de coefficients standard (0 à 3) **PX** |
| 33 | `0x00210040` | GetStandardCoefficientParams | `y2r_GetStandardCoefficientParams` | `0x110ed4` | `0x00210140` | rend les coefficients d'un jeu standard |
| 34 | `0x00220040` | SetAlpha | `y2r_SetAlpha` | `0x110f1c` | `0x00220040` | écrit l'alpha de sortie (registre +0x20) **PX** |
| 35 | `0x00230000` | GetAlpha | `y2r_GetAlpha` | `0x110f0c` | `0x00230080` | lit l'alpha |
| 36 | `0x00240200` | SetDitheringWeightParams | `y2r_SetDitheringWeightParams` | `0x110e34` | `0x00240040` | écrit les poids de tramage (0x20 octets) [nom] |
| 37 | `0x00250000` | GetDitheringWeightParams | `y2r_GetDitheringWeightParams` | `0x110dbc` | `0x00250240` | lit les poids de tramage [nom] |
| 38 | `0x00260000` | StartConversion | `y2r_StartConversion` | `0x11086c` | `0x00260040` | lance la conversion (bit 31) **PX** |
| 39 | `0x00270000` | StopConversion | `y2r_StopConversion` | `0x110838` | `0x00270040` | arrête la conversion **PX** |
| 40 | `0x00280000` | IsBusyConversion | `y2r_IsBusyConversion` | `0x11087c` | `0x00280080` | dit si la conversion est en cours **PX** |
| 41 | `0x002901C0` | SetPackageParameter | `y2r_SetPackageParameter` | `0x110bc8` | `0x00290040` | applique d'un coup un paquet de réglages |
| 42 | `0x002A0000` | PingProcess | `y2r_PingProcess` | `0x110538` | `0x002A0080` | rend un octet d'état du pilote |
| 43 | `0x002B0000` | DriverInitialize | `y2r_DriverInitialize` | `0x110874` | `0x002B0040` | initialise le pilote **PX** |
| 44 | `0x002C0000` | DriverFinalize | `y2r_DriverFinalize` | `0x110806` | `0x002C0040` | arrête le pilote **PX** |
| 45 | `0x002D0000` | GetPackageParameter | `y2r_GetPackageParameter` | `0x110a9c` | `0x002D0200` | lit d'un coup tous les réglages |

**Le registre de contrôle (`0x1EC02000`).** Les accesseurs ci-dessus lisent et écrivent ces champs, relevés dans les masques de `y2r_set_*_reg` et `y2r_get_*_reg` :

| Bits | Champ | Écrit par |
| --- | --- | --- |
| 0 à 2 | format d'entrée | `y2r_set_input_format_reg` (`0x10b49c`) |
| 8 et 9 | format de sortie | `y2r_set_output_format_reg` (`0x10b480`) |
| 10 et 11 | rotation | `y2r_set_rotation_reg` (`0x10b464`) |
| 12 | alignement en blocs | `y2r_set_block_alignment_reg` (`0x10b448`) |
| 16 | tramage spatial | `y2r_set_spacial_dithering_reg` (`0x1035bc`) |
| 17 | tramage temporel | `y2r_set_temporal_dithering_reg` (`0x1035dc`) |
| 24 à 28 | drapeaux d'erreur, effacés en y écrivant 1 | `y2r_clear_error_flag_24` à `_28` (`0x10b2b0`, `0x10b294`, `0x10b278`, `0x10b25c`, `0x10b240`) |
| 30 | interruption de fin de transfert | `y2r_set_transfer_end_interrupt_reg` (`0x10b220`) |
| 31 | lancement et occupation | `y2r_set_start_bit` (`0x111f28`), `y2r_clear_start_bit` (`0x10b4b4`), `y2r_get_busy_bit` (`0x111f40`) |

Les autres registres : `+0x04` la largeur d'une ligne d'entrée (de 8 à 0x400 par pas de 8, `0x400` s'écrit 0), `+0x06` le nombre de lignes d'entrée (de 1 à 0x400, `0x400` n'est pas écrit), `+0x10` à `+0x1E` les huit coefficients de conversion (`y2r_set_coefficients_reg`, 16 bits chacun, les cinq premiers masqués à dix bits), `+0x20` l'alpha de sortie.

**Les ports de données (`0x1EE02000`).** Le module envoie les plans par DMA (`svcStartInterProcessDma`) vers : `0x1EE02000` (plan Y), `0x1EE02080` (plan U), `0x1EE02100` (plan V), `0x1EE02180` (YUV entrelacé), et reçoit la sortie par `0x1EE02200`. Avant un envoi, la fonction appelle `svcStoreProcessDataCache` (`0x108238`) sur le tampon du client ; avant une réception, `svcInvalidateProcessDataCache`. Les objets DMA sont dans l'objet global `0x11d3a0` : `+4` la réception, `+8` le plan Y et le YUV entrelacé, `+0xC` le plan U, `+0x10` le plan V ; `is_dma_finished` (`0x109bb8`) attend leur poignée sans délai (`svcWaitSynchronization1`) et rend 0 si elle expire (le DMA court encore), 1 sinon.

**La conversion pas à pas** (l'ordre dans lequel les commandes sont envoyées par un client, et ce que le module fait) :

1. `SetInputFormat`, `SetOutputFormat`, `SetRotation`, `SetBlockAlignment`, `SetInputLineWidth`, `SetInputLines`, `SetStandardCoefficient` (ou `SetCoefficientParams`), `SetAlpha` : chacune écrit son champ ou son registre (table ci-dessus). Le client n'a pas à les envoyer dans un ordre précis.
2. `SetTransferEndInterrupt(1)` puis `GetTransferEndEvent` : la poignée rendue est celle de l'événement lié à l'interruption `0x4B`.
3. `SetSendingYuv` (ou `SetSendingY`, `U`, `V`) : `start_y2r_send_yuv` (`0x110984`) pose un descripteur de DMA et lance la copie du tampon du client vers `0x1EE02180`. `SetReceiving` : `start_y2r_receive` (`0x110888`) lance la copie de `0x1EE02200` vers le tampon du client.
4. `StartConversion` : `y2r_start_conversion_impl` (`0x110c50`) efface les cinq drapeaux d'erreur (bits 24 à 28) puis pose le bit 31 ; refus `0xC9405001` si le pilote est fermé.
5. Le client attend l'événement de l'étape 2 (ou interroge `IsFinishedReceiving` et `IsBusyConversion`). L'interruption `0x4B` signale l'événement quand la conversion a fini.
6. `StopConversion` (`y2r_stop_conversion_impl`, `0x110a8c`) efface le bit 31.

`DriverInitialize` (`y2r_DriverInitialize` → `y2r_driver_initialize_impl`, `0x110cb4`) ne fait que remettre l'objet à ses valeurs de départ : `0x101f54` met tous les réglages à zéro (formats, rotation, alignement, tramage, coefficients), la largeur et le nombre de lignes à `0x400`, l'alpha à 0 et des poids de tramage par défaut, puis `DriverInitialize` efface l'événement de fin. `DriverFinalize` (`0x10bc58`) efface les objets DMA et arrête le convertisseur. Les deux rendent `0xD82053F8` quand le pilote n'a pas été démarré par `camera_main`.

## Partie 7 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x115068` | les quatre services du fil principal : pointeur sur le nom, nombre de sessions (1) |
| `0x115088` | les quatre gestionnaires de commande, un par service |
| `0x115098` | les contextes des clients : `0x11d37c` (`cam:u`), `0x11d39c` (`y2r:u`), `0x11d384` (`cam:s`), `0x11d38c` (`cam:c`) |
| `0x11d280` | l'état du pilote : `+0` pilote prêt, `+3` caméras activées, `+4` à `+6` caméras en veille, `+7` console en veille, `+8` couvercle fermé, `+0x14` mode sans matériel (les commandes de capture ne font rien), `+0x18` compteur de l'état du couvercle, `+0x28` compteur de refus |
| `0x11d62c`, `0x11d630`, `0x11d638` | le cache de session, la table des caméras possédées par client, l'objet pilote des capteurs |
| `0x11d770` | les quatre poignées d'événements des ports (synchro et erreur de tampon) |
| `0x11d3a0` | l'objet pilote de Y2R (`+0` démarré, `+1` fermé, `+2` nombre de sessions `y2r:u`, `+4` à `+0x10` les DMA, `+0x14` l'événement de fin) |
| `0x11db80` | l'anneau des heures de synchro verticale, six entrées de 8 octets par port |
| `0x11e56c`, `0x11e578`, `0x11e410`, `0x11e590` | les verrous récursifs du pilote |

## Partie 8 : les appels système

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x10c14c` |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x113268` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x1130f4` |
| CreateThread | `0x08` | `svcCreateThread` | `0x113334` |
| ExitThread | `0x09` | `svcExitThread` | `0x1138e4` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x113370` |
| CreateMutex | `0x13` | `svcCreateMutex` | `0x114384` |
| ReleaseMutex | `0x14` | `svcReleaseMutex` | `0x108bb0` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x10c0a4` |
| SignalEvent | `0x18` | `svcSignalEvent` | `0x1132c8` |
| ClearEvent | `0x19` | `svcClearEvent` | `0x113598` |
| MapMemoryBlock | `0x1F` | `svcMapMemoryBlock` | `0x114130` |
| UnmapMemoryBlock | `0x20` | `svcUnmapMemoryBlock` | `0x1138f4` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x113250` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x114100` |
| CloseHandle | `0x23` | `svcCloseHandle` | `0x10c184` |
| WaitSynchronization1 | `0x24` | `svcWaitSynchronization1` | `0x10c09c` |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x1135a8` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x11439c` |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x1132c0` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x1132a4` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x11331c` |
| SendSyncRequest | `0x32` | `svcSendSyncRequest` | `0x10bf8c` |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x113358` |
| Break | `0x3C` | `svcBreak` | `0x1138dc` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x113238` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x10c18c` |
| BindInterrupt | `0x50` | `svcBindInterrupt` | `0x10bf68` |
| UnbindInterrupt | `0x51` | `svcUnbindInterrupt` | `0x10bf38` |
| InvalidateProcessDataCache | `0x52` | `svcInvalidateProcessDataCache` | `0x1138ec` |
| StoreProcessDataCache | `0x53` | `svcStoreProcessDataCache` | `0x108238` |
| StartInterProcessDma | `0x55` | `svcStartInterProcessDma` | `0x114138` |
| StopDma | `0x56` | `svcStopDma` | `0x1135a0` |
| GetDmaState | `0x57` | `svcGetDmaState` | `0x114118` |

Il y a 34 enveloppes, une par appel (aucun appel n'est écrit sur place).

## Partie 9 : les services que camera appelle

Chaque requête a sa petite fonction (28 en tout, autant que d'appels à `SendSyncRequest`). La poignée est celle de la variable globale indiquée.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x11d4e8` | `0x00010002` | `SRV_RegisterClient` | `0x100af4` | Se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x100b80` | Obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x100b2c` | Créer les cinq services |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x101604` | Les retirer à l'arrêt |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x10238c` | Ouvrir les six services ci-dessous |
| | | `0x00090040` | `SRV_Subscribe` | `0x100bf4` | S'abonner à une notification |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x100bbc` | Lire le numéro de la notification arrivée |
| `ptm:s` | `0x11d564` | `0x040A0000` | `PTMSYSM_CheckNew3DS` | `0x102338` | Savoir si la console est une New 3DS |
| | | `0x04030042` | `PTMSYSM_NotifySleepPreparationComplete` | `0x10fea0` | Dire à `ptm` que `camera` est prêt pour la veille |
| `cfg:s` | `0x11d578` | `0x04010082` | `CFG_GetConfigInfoBlk8` | `0x103bec` | Lire un bloc de configuration (étalonnage des caméras) |
| | | `0x00010082` | `CFG_GetConfigInfoBlk2` | `0x10c9cc` | Idem, forme à deux paramètres (poignée copiée à `0x11d57c`) |
| | | `0x04020082` | `CFG_SetConfigInfoBlk4` | `0x10fdb0` | Écrire un bloc |
| | | `0x04030000` | `CFG_UpdateConfigNANDSavegame` | `0x10fdf8` | Enregistrer la configuration |
| `csnd:SND` | `0x11d540` | `0x00010140` | `CSND_Initialize` | `0x107128` | Pour le bruit d'obturateur |
| | | `0x00020000` | `CSND_Shutdown` | `0x103f40` | |
| | | `0x00030040` | `CSND_ExecuteCommands` | `0x10ef5c` | |
| | | `0x00040080` | `CSND_cmd0004` | `0x10e6cc` | |
| | | `0x00050000` | `CSND_AcquireSoundChannels` | `0x1070f0` | |
| | | `0x00060000` | `CSND_ReleaseSoundChannels` | `0x103f10` | |
| | | `0x00090082` | `CSND_FlushDataCache` | `0x10ccf8` | |
| `pdn:c` | `0x11d4d4` | `0x00010040` | `PDN_cmd0001` | `0x10e564` | Allumer ou éteindre l'horloge des caméras (sens interprété) |
| | | `0x00020000` | `PDN_cmd0002` | `0x10cb8c` | idem |
| `i2c::CAM` ou `mcu::CAM` (poignée passée en paramètre, non départagé) | param. | `0x00010040` | `CAMDEV_cmd0001` | `0x10ba7c` | (non lue) |
| | | `0x00040102` | `CAMDEV_cmd0004` | `0x10f99a` | écritures et lectures dans les capteurs (interprété) |
| | | `0x000800C2` | `CAMDEV_cmd0008` | `0x10f9f4` | |
| | | `0x000A0080` | `CAMDEV_cmd000A` | `0x10f2c4` | |
| | | `0x000C00C2` | `CAMDEV_cmd000C` | `0x108288` | |
| `err:f` (port) | param. | `0x00010800` | `ERRF_Throw` | `0x103c8c` | Signaler une erreur fatale |

Les noms `CSND_*` viennent des en-têtes de la fiche de 3dbrew pour `csnd:SND` ; les groupes `PDN_*` et `CAMDEV_*` gardent un nom neutre parce que leurs en-têtes ne suffisent pas à les identifier sans lire le service appelé.

## Ce que Pokémon X envoie

Le jeu envoie 36 commandes à `cam:u` et 22 à `y2r:u`. D'après l'inventaire (`pokemon-x-services.md`), presque toutes ne sont atteintes que depuis les modules `.cro` ; aucune ne l'est sur le chemin du démarrage. Ce qu'un programme qui prend la place de la console doit rendre, d'après le module : les réponses ci-dessous sont les successions de mots écrits par `cam_handle_command` et `y2r_handle_command` après l'appel de la fonction de travail. Le mot 0 est l'en-tête de réponse de la colonne « Réponse » et le mot 1 le résultat (0 pour un succès) ; ce qui suit est écrit à la suite.

Tant que le jeu ne fait pas de photo, un portage peut répondre « succès » partout et rendre une image noire, comme le fait déjà la liste de l'inventaire (« l'appareil photo : image noire ») : les commandes qui rendent une poignée doivent rendre une vraie poignée d'événement que le portage signale lui-même.

### `cam:u`

| N° | Commande | Fonction du jeu | Fonction du module | Réponse | Ce que le programme de remplacement doit rendre |
| --- | --- | --- | --- | --- | --- |
| 1 | StartCapture | `0x2cadb4` | `cam_StartCapture` (`0x10433c`) | `0x00010040` | résultat 0, rien d'autre (le module lance la capture des ports demandés) |
| 2 | StopCapture | `0x2cac38` | `cam_StopCapture` (`0x10405c`) | `0x00020040` | résultat 0, rien d'autre |
| 3 | IsBusy | `0x2cb2a4` | `cam_IsBusy` (`0x105f0c`) | `0x00030080` | résultat 0 puis un octet : 1 si tous les ports demandés sont occupés, 0 sinon (un port que la session ne possède pas compte pour « libre ») |
| 4 | ClearBuffer | `0x2caa7c` | `cam_ClearBuffer` (`0x10a8c0`) | `0x00040040` | résultat 0, rien d'autre |
| 5 | GetVsyncInterruptEvent | `0x2cb110` | `cam_GetVsyncInterruptEvent` (`0x1053c0`) | `0x00050042` | résultat 0, descripteur 0, puis la poignée d'un événement (un par port, 1 ou 2) que le module signale à chaque synchro verticale ; pour un autre port, `0xE0E053ED` |
| 6 | GetBufferErrorInterruptEvent | `0x2cb21c` | `cam_GetBufferErrorInterruptEvent` (`0x1055ec`) | `0x00060042` | comme la 5, avec l'événement d'erreur de tampon du port |
| 7 | SetReceiving | `0x2cad04` | `cam_SetReceiving` (`0x1041e0`) | `0x00070042` | résultat 0, descripteur 0, puis une poignée qui se signale quand l'image est écrite dans le tampon du client : c'est la poignée du DMA du module. Si la session ne possède pas les caméras du port, résultat 0 et une poignée de repli, sans transfert |
| 9 | SetTransferLines | `0x2cafc8` | `cam_SetTransferLines` (`0x104ad8`) | `0x00090040` | résultat 0, rien d'autre |
| 10 | GetMaxLines | `0x2cab0c` | `cam_GetMaxLines` (`0x10a848`) | `0x000A0080` | résultat 0 puis un entier de 16 bits : le plus grand nombre de lignes `n` tel que `n × largeur` soit multiple de 128, que `n` divise la hauteur et que `n × largeur × 2 ≤ 0x1400` ; `0xE0E053FD` si la largeur ou la hauteur est nulle ou si `largeur × hauteur` n'est pas multiple de 128 |
| 11 | SetTransferBytes | `0x2caf74` | `cam_SetTransferBytes` (`0x104a7c`) | `0x000B0040` | résultat 0, rien d'autre |
| 12 | GetTransferBytes | `0x2caf28` | `cam_GetTransferBytes` (`0x104a30`) | `0x000C0080` | résultat 0 puis un entier de 16 bits : la valeur gardée pour le port |
| 13 | GetMaxBytes | `0x2caab8` | `cam_GetMaxBytes` (`0x10a81c`) | `0x000D0080` | résultat 0 puis un entier : le plus grand multiple de 0x100 au plus égal à 0x1400 qui divise `2 × largeur × hauteur` ; même refus `0xE0E053FD` que la 10 |
| 14 | SetTrimming | `0x2cabf0` | `cam_SetTrimming` (`0x104010`) | `0x000E0040` | résultat 0, rien d'autre |
| 18 | SetTrimmingParamsCenter | `0x2cb15c` | `cam_SetTrimmingParamsCenter` (`0x105454`) | `0x00120040` | résultat 0, rien d'autre |
| 19 | Activate | `0x126290` | `cam_Activate` (`0x106028`) | `0x00130040` | résultat 0, rien d'autre (choisit les caméras actives) |
| 21 | SetExposure | `0x2caba8` | `cam_SetExposure` (`0x103f70`) | `0x00150040` | résultat 0, rien d'autre |
| 22 | SetWhiteBalance | `0x2caeb0` | `cam_SetWhiteBalance` (`0x104968`) | `0x00160040` | résultat 0, rien d'autre |
| 24 | SetSharpness | `0x2cad6c` | `cam_SetSharpness` (`0x10429c`) | `0x00180040` | résultat 0, rien d'autre |
| 25 | SetAutoExposure | `0x2cae68` | `cam_SetAutoExposure` (`0x104810`) | `0x00190040` | résultat 0, rien d'autre |
| 27 | SetAutoWhiteBalance | `0x2cb068` | `cam_SetAutoWhiteBalance` (`0x1050ec`) | `0x001B0040` | résultat 0, rien d'autre |
| 29 | FlipImage | `0x2cb340` | `cam_FlipImage` (`0x10628c`) | `0x001D0040` | résultat 0, rien d'autre |
| 31 | SetSize | `0x2cb2f0` | `cam_SetSize` (`0x105f80`) | `0x001F0040` | résultat 0, rien d'autre |
| 32 | SetFrameRate | `0x2cac74` | `cam_SetFrameRate` (`0x1040a0`) | `0x00200040` | résultat 0, rien d'autre |
| 33 | SetPhotoMode | `0x2cacbc` | `cam_SetPhotoMode` (`0x104140`) | `0x00210040` | résultat 0, rien d'autre |
| 34 | SetEffect | `0x2cb390` | `cam_SetEffect` (`0x106334`) | `0x00220040` | résultat 0, rien d'autre |
| 35 | SetContrast | `0x2cab60` | `cam_SetContrast` (`0x10a708`) | `0x00230040` | résultat 0, rien d'autre |
| 36 | SetLensCorrection | `0x2cb020` | `cam_SetLensCorrection` (`0x104b94`) | `0x00240040` | résultat 0, rien d'autre |
| 38 | SetAutoExposureWindow | `0x2cb0b0` | `cam_SetAutoExposureWindow` (`0x1052b4`) | `0x00260040` | résultat 0, rien d'autre |
| 39 | SetAutoWhiteBalanceWindow | `0x2cb1bc` | `cam_SetAutoWhiteBalanceWindow` (`0x10553c`) | `0x00270040` | résultat 0, rien d'autre |
| 40 | SetNoiseFilter | `0x2cae20` | `cam_SetNoiseFilter` (`0x1046bc`) | `0x00280040` | résultat 0, rien d'autre |
| 54 | GetSuitableY2rStandardCoefficient | `0x2cb268` | `cam_GetSuitableY2rStandardCoefficient` (`0x105818`) | `0x00360080` | résultat 0 puis un octet valant 1 (le module écrit 1 quel que soit l'état, après avoir interrogé son pilote) |
| 57 | DriverInitialize | `0x2caef8` | `cam_DriverInitialize` (`0x104a0c`) | `0x00390040` | résultat 0, rien d'autre (pilote déjà démarré) ; `0xD82053F8` si le pilote n'est pas démarré |
| 58 | DriverFinalize | `0x2cadf0` | `cam_DriverFinalize` (`0x1044e8`) | `0x003A0040` | résultat 0, rien d'autre |
| 59 | GetActivatedCamera | `0x126254` | `cam_GetActivatedCamera` (`0x104f00`) | `0x003B0080` | résultat 0 puis un octet : le masque des caméras activées (3 bits, 1 / 2 / 4) |
| 60 | GetSleepCamera | `0x1261dc` | `cam_GetSleepCamera` (`0x10451c`) | `0x003C0080` | résultat 0 puis un octet : le masque des caméras en veille |
| 61 | SetSleepCamera | `0x126218` | `cam_SetSleepCamera` (`0x10475c`) | `0x003D0040` | résultat 0, rien d'autre |

### `y2r:u`

| N° | Commande | Fonction du jeu | Fonction du module | Réponse | Ce que le programme de remplacement doit rendre |
| --- | --- | --- | --- | --- | --- |
| 1 | SetInputFormat | `0x2b2ddc` | `y2r_SetInputFormat` (`0x110828`) | `0x00010040` | résultat 0, rien d'autre ; la valeur va dans les bits 0 à 2 du registre de contrôle |
| 3 | SetOutputFormat | `0x2b2e48` | `y2r_SetOutputFormat` (`0x11085c`) | `0x00030040` | résultat 0, rien d'autre ; bits 8 et 9 |
| 5 | SetRotation | `0x2b2b68` | `y2r_SetRotation` (`0x110548`) | `0x00050040` | résultat 0, rien d'autre ; bits 10 et 11 |
| 7 | SetBlockAlignment | `0x2b2f20` | `y2r_SetBlockAlignment` (`0x110960`) | `0x00070040` | résultat 0, rien d'autre ; bit 12 |
| 13 | SetTransferEndInterrupt | `0x2b3088` | `y2r_SetTransferEndInterrupt` (`0x110dac`) | `0x000D0040` | résultat 0, rien d'autre ; bit 30 (l'interruption de fin de transfert) |
| 15 | GetTransferEndEvent | `0x2b2f98` | `y2r_GetTransferEndEvent` (`0x110ba4`) | `0x000F0042` | résultat 0, descripteur 0, puis la poignée de l'événement de fin de conversion (lié à l'interruption `0x4B`) ; l'événement est signalé quand la conversion est finie |
| 16 | SetSendingY | `0x2b2c5c` | `y2r_SetSendingY` (`0x1106dc`) | `0x00100040` | résultat 0, rien d'autre ; la copie du plan Y vers le port d'entrée est déjà lancée au retour |
| 17 | SetSendingU | `0x2b2ba4` | `y2r_SetSendingU` (`0x11055c`) | `0x00110040` | résultat 0, rien d'autre ; idem pour U |
| 18 | SetSendingV | `0x2b2c00` | `y2r_SetSendingV` (`0x11061c`) | `0x00120040` | résultat 0, rien d'autre ; idem pour V |
| 19 | SetSendingYuv | `0x2b2d50` | `y2r_SetSendingYuv` (`0x1107e0`) | `0x00130040` | résultat 0, rien d'autre ; la copie du YUV entrelacé vers le port YUV est lancée au retour |
| 20 | IsFinishedSendingYuv | `0x2b3010` | `y2r_IsFinishedSendingYuv` (`0x110d1c`) | `0x00140080` | résultat 0 puis un octet : 0 tant que la copie du YUV vers le port n'est pas finie, 1 ensuite (et 1 si aucune copie n'a été lancée) |
| 24 | SetReceiving | `0x2b2cb8` | `y2r_SetReceiving` (`0x110798`) | `0x00180040` | résultat 0, rien d'autre ; la copie du port de sortie vers le tampon du client est lancée, elle se termine avec la conversion |
| 25 | IsFinishedReceiving | `0x2b2fd4` | `y2r_IsFinishedReceiving` (`0x110bb4`) | `0x00190080` | résultat 0 puis un octet : même règle pour la copie de sortie |
| 26 | SetInputLineWidth | `0x2b2f5c` | `y2r_SetInputLineWidth` (`0x110974`) | `0x001A0040` | résultat 0, rien d'autre ; largeur 8 à 0x400 par pas de 8 (`0x400` s'écrit 0 dans le registre) ; sinon une erreur de paramètre |
| 28 | SetInputLines | `0x2b2d14` | `y2r_SetInputLines` (`0x1107d0`) | `0x001C0040` | résultat 0, rien d'autre ; de 1 à 0x400 lignes (la valeur `0x400` ne s'écrit pas dans le registre) ; sinon une erreur de paramètre |
| 32 | SetStandardCoefficient | `0x2b304c` | `y2r_SetStandardCoefficient` (`0x110d8c`) | `0x00200040` | résultat 0, rien d'autre ; jeu de 0 à 3 ; sinon une erreur de paramètre |
| 34 | SetAlpha | `0x2b30c4` | `y2r_SetAlpha` (`0x110f1c`) | `0x00220040` | résultat 0, rien d'autre ; la valeur va dans le registre `+0x20` |
| 38 | StartConversion | `0x2b2e84` | `y2r_StartConversion` (`0x11086c`) | `0x00260040` | résultat 0, rien d'autre (`0xC9405001` si le pilote est fermé) ; efface les cinq drapeaux d'erreur puis pose le bit 31 |
| 39 | StopConversion | `0x2b2e18` | `y2r_StopConversion` (`0x110838`) | `0x00270040` | résultat 0, rien d'autre ; efface le bit 31 |
| 40 | IsBusyConversion | `0x2b2ee4` | `y2r_IsBusyConversion` (`0x11087c`) | `0x00280080` | résultat 0 puis un octet : le bit 31 du registre de contrôle |
| 43 | DriverInitialize | `0x2b2eb4` | `y2r_DriverInitialize` (`0x110874`) | `0x002B0040` | résultat 0, rien d'autre ; remet les réglages à leurs valeurs de départ (partie 5) |
| 44 | DriverFinalize | `0x2b2dac` | `y2r_DriverFinalize` (`0x110806`) | `0x002C0040` | résultat 0, rien d'autre ; `0xD82053F8` si le pilote n'est pas démarré |

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 68 numéros de commande de `cam:u`, les 45 de `y2r:u` et leur fonction : l'exécution de l'aiguillage (`emulate_dispatch.py`) d'un côté, de l'autre le pseudo-code des blocs `case` de Ghidra (61 de 68 et 38 de 45 retrouvés par un script, sans écart ; les 7 + 7 autres lus à la main dans les mêmes blocs). Pour `cam:q`, 57 sur 62 retrouvés par le script, sans écart.
- Les en-têtes de réponse de chaque commande : le mot 0 de la réponse après exécution, et les constantes des blocs `case` (`ipc_write_header(…, numéro, mots, descripteurs)`).
- Les quatre services du fil principal, leurs noms, la table `0x115068` et la table des gestionnaires `0x115088` : octets lus dans `code.bin`, et l'exécution des appels depuis `camera_main` dans le pseudo-code.
- Les registres de `y2r:u` (bits du registre de contrôle, registres `+4`, `+6`, `+0x10`, `+0x20`, ports de données `0x1EE02xxx`) : les masques des fonctions `y2r_set_*_reg` et `y2r_get_*_reg` d'une part, les constantes littérales du module d'autre part (les mots `0x1EC02000` à `0x1EC02100` et `0x1EE02000` à `0x1EE02200` apparaissent dans les tables de constantes).
- Le chemin de SetReceiving jusqu'à `svcStartInterProcessDma` : `0x1041e0` → `0x1072e0` → `start_dma` (`0x108e9e`), et `svcStartInterProcessDma` n'a qu'un seul appelant (`start_dma`) ; les ports `0x1EE20000` et `0x1EE21000` sont des constantes de `0x1072e0` et des pages demandées par l'exheader.
- Les interruptions `0x48`, `0x49` (caméras) et `0x4B` (Y2R) : arguments de `svcBindInterrupt` dans `camera_interrupt_thread_main` et `y2r_driver_start`.
- Les six services appelés de l'exheader et les 28 requêtes : `SendSyncRequest` n'a que 28 appelants, tous relevés par `senders.py` avec leur en-tête.
- Les formules de `GetMaxLines` et `GetMaxBytes` : le pseudo-code de `0x10ebfc` et de `0x10cf56`, et l'assembleur qui les appelle.
- Les notifications `0x100`, `0x104`, `0x105`, `0x213`, `0x214` : le code des gestionnaires et la fiche de `hid`/`ptm` pour le sens des numéros.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens du gabarit (partie 4) : « caméras du client », « cache de session », « classe 11 » viennent de la forme des appels, pas d'une documentation. Les formules des fonctions de travail de chaque réglage (`0x10acc8`, `0x10ac80`, `0x10ac3c`, `0x10ba18`, `0x10abf8`, `0x10abb0`, `0x107194`, `0x10ab08`, `0x10ad0c`, `0x10aa34`, `0x10a9f0`, `0x10a99c`, `0x10791c`, `0x10a958`) n'ont pas été lues : une ligne de la partie 3 marquée [nom] ne dit rien de plus que le nom de la Carte.
- Les octets de l'état du pilote (`+3` à `+8`) : leur rôle est déduit des notifications qui les écrivent et des commandes qui les lisent.
- `get_shell_state` (`0x10be4c`, trois valeurs 0, 1 et 2) : je le lis comme un état de transition du couvercle ou de la veille, d'après le compteur `+0x18` et le refus `0xF96053FE`, mais ce qui l'incrémente n'a pas été suivi.
- Le fil `0x1016a8` comme « gestionnaire des caméras » : il attend un événement, lit des demandes sous forme de bits, démarre ou arrête les caméras ; le détail de chaque demande n'a pas été lu.
- Le sens de `is_dma_finished` : le test compare le résultat de `WaitSynchronization1` à celui d'un délai dépassé, avec un délai nul que Ghidra ne montre pas (il vient du registre de l'appelant).
- Les noms `CSND_*` (par les en-têtes de 3dbrew) et le rôle de `pdn:c` : non confirmés dans le module appelé.
- Les valeurs de départ du cache de session et de l'objet Y2R sont données comme elles sont écrites ; leur lien avec les constantes de 3dbrew (tailles, formats) n'a pas été fait.
- La commande `0x40` de `cam:u` comme jumelle de `SetEffect`.

**Pas lu**
- Les corps de toutes les fonctions de travail des réglages (partie 3, lignes [nom]), de l'étalonnage stéréo, des paquets de réglages (`SetPackageParameter*`) et des accès I2C aux capteurs.
- Les tables des registres des capteurs (`Default Registers - Out Camera`, `In Camera`, présentes dans les chaînes à `0x11aaea` et suivantes), les tables de gamma et de balance des blancs.
- Le fil `cam:q` au-delà de la table de commandes (les huit commandes propres).
- Le bruit d'obturateur (`PlayShutterSound*`, `csnd:SND`).
- 742 fonctions restent sans nom, pour la plupart des méthodes de la bibliothèque d'objets du module et les fonctions de travail ci-dessus.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Découper le module (1 029 fonctions, 945 en Thumb, 24 tables de switch) | `outils/ghidra_direct.py camera` | 45 secondes |
| Lire les tables de commandes de `cam:u/s/c`, `y2r:u` et `cam:q` | `outils/emulate_dispatch.py camera 0x111538=cam 0x10feec=y2r:u 0x102c60=cam:q` | 2 minutes |
| Recouper avec le pseudo-code des blocs `case` | `local/analyse/camera/crosscheck.py` | immédiat |
| Lire les gabarits, Y2R, SetReceiving, les formules, le démarrage | Claude, sur le pseudo-code avec les constantes déroulées (`pcv.py`) et l'assembleur de `capstone` (`dis.py`) | le gros du temps |
| Relever les requêtes envoyées à d'autres services | `senders.py` | immédiat |
| Écrire `camera.noms.tsv`, puis relancer `ghidra_direct.py` pour que les noms sortent | `mknames.py` | une minute |

**Pièges rencontrés.**
- Le pseudo-code d'une fonction Thumb perd souvent les arguments passés dans les registres et les remplace par `in_r3` ou des paramètres fantômes : les en-têtes de réponse lus dans `ipc_write_header(…, numéro, mots, descripteurs)` sont fiables, les arguments des petites fonctions d'enveloppe (comme `cam_SetEffect`) ne le sont pas, il faut lire l'assembleur.
- `emulate_dispatch.py` rend « la fonction appelée » ; quand deux commandes ont la même, il faut lire le contexte (la commande `0x40`).
- Les appels dont le nom est long sont coupés en deux lignes dans le pseudo-code une fois nommés : un script qui cherche `nom(` doit accepter un retour à la ligne avant la parenthèse.

**Pour reprendre.** `camera.noms.tsv` est le fichier de graines : une adresse, `function` (ARM) ou `label` (Thumb), un nom. Les préfixes `cam_` et `y2r_` sont les commandes reçues par `cam:u` et `y2r:u`, `camq_` celles de `cam:q`, les noms en majuscules (`SRV_`, `CFG_`, `CSND_`…) des requêtes envoyées à un autre service. Le pseudo-code brut, les outils de lecture et les tables générées sont dans `local/analyse/camera/`, non versionnés.
