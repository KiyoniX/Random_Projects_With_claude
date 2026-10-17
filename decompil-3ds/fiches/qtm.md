# qtm, le suivi du visage pour la 3D stable

`qtm` (le nom vient de 3dbrew : « Qtm ») ne se trouve que sur la New 3DS (titre `2000xx02`, `0004013020004202`). Il suit la position du visage de l'utilisateur avec la caméra intérieure (par `cam:q`, un service réservé) et règle en conséquence la barrière de parallaxe de l'écran supérieur, ce qui garde la 3D nette quand la tête bouge. Il tient aussi la diode infrarouge et ses réglages, et tient un état (« QtmStatus ») que `gsp` et `ns` mettent à jour. Quatre services : `qtm:u` (pour les applications : lire les données de suivi), `qtm:s` (le système : barrière, luminance, étalonnage), `qtm:sp` (le système privilégié : `qtm:s` plus les notifications de l'écran supérieur) et `qtm:c` (l'étalonnage).

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, module presque tout en ARM), `outils/emulate_dispatch.py --arm` sur les quatre aiguillages (de 0 à 0xFFFF) et la Carte des services (tirée de 3dbrew). Adresses du module chargé à `0x00100000`. Les sections de données sont énormes : `0x85E48` octets de lecture seule (les modèles du suivi, voir la partie 5).

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020004202`, un titre de la CTRNAND (New 3DS seulement) ; nom interne `qtm`, priorité 17 (`0x11`), la plus haute du groupe |
| Fichier lu | `local/extrait/qtm/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x24B78` octets de code (`0x25` pages), `0x85E48` de données en lecture seule (`0x86` pages), `0x8` de données (1 page), `0x30` de mémoire à zéro, pile de `0x1000` |
| Fonctions | 647 pour Ghidra (18 en Thumb, 629 en ARM), plus 39 entrées manquées et 31 constructeurs statiques que l'outil ne voit pas (table de distances en mémoire QTM, `0x1EB6338C`), moins 15 qui ne sont pas des débuts de fonction et 2 de code mort : 700 ; 71 nommées dans `qtm.noms.tsv`, 681 avec `local/analyse/qtm/noms-proposes.tsv` |
| Services offerts | `qtm:c`, `qtm:sp`, `qtm:s`, `qtm:u`, **3 sessions chacun** (noms à `0x1AA8A4`, `0x1AA8AA`, `0x1AA8B1`, `0x1AA8B7`) |
| Services appelés | lus dans l'exheader : `cam:q`, `cfg:s`, `gpio:QTM`, `hid:QTM`, `i2c::QTM`, `ptm:s`. Dans le code, des chaînes pour `cfg:s` (`0x1AA8BD`), `hid:QTM`, `hid:NFC`, `hid:USER`, `hid:SPVR` (la famille `hid` de la bibliothèque) et `cfg:u` ; `cam:q`, `gpio:QTM` et `i2c::QTM` sont dans la zone `0x125064` |
| Droits du noyau (exheader) | pas d'interruption ; deux plages d'adresses matérielles à `0x1EA00000` et `0x1EB80000` (décodage de l'exheader par `capdec.py`) |
| Appelants connus | `qtm:sp` : `gsp` et `ns` ; `qtm:s` : `gsp-safe` et `ns-safe` (exheaders) ; `qtm:u` et `qtm:c` : aucun exheader extrait. Pokémon X n'ouvre aucun des quatre |

## Partie 1 : le démarrage et le serveur

`qtm_main` (`0x100214`) :

1. Se connecte à `srv:` (`srv_init`, `0x115A68`) puis prend le sémaphore des notifications (`get_notification_semaphore`, `0x1014F0`).
2. **Enregistre les quatre services** : une boucle de quatre tours lit le nom (`strlen`, `0x1159B0`) et appelle `SRV_RegisterService` (`0x101524`, en-tête de commande 3, quatre mots : le nom, sa longueur, le nombre de sessions, ici 3). Les littéraux sont des adresses absolues de la mémoire QTM (`0x1EADD800` et au-delà) : l'image des données est recopiée du fichier vers cette mémoire au démarrage par `copy_qtm_ram_image` (`0x1007A8`) ; le code n'est pas indépendant de la position.
3. Prépare les composants : `qtm_open_services` (`0x101234`), `notification_state_init` (`0x10094C`), `subscribe_srv_notifications` (`0x100C28`), `qtm_initialize` (`0x100C60`).
4. **Un fil par session.** Quatre fonctions de boucle, une par service, appellent chacune `svcReplyAndReceive` (`0x115928`) sur une session et l'aiguillage du service : `0x102004` -> `0x103464` (`qtm:u`), `0x1020C0` -> `0x1035C4` (`qtm:s`), `0x10216C` -> `0x103918` (`qtm:c`), `0x102218` -> `0x1039F8` (`qtm:sp`) ; chaque session acceptée (`svcAcceptSession`, `0x115740`) prend l'une des trois places de fil (`session_thread_slot_acquire`) et tourne dans `qtm_u_session_thread`, `qtm_s_session_thread`, `qtm_c_session_thread` ou `qtm_sp_session_thread`.

L'appariement boucle - service vient des nombres de commandes (6, 16, 5 et 20), qui sont exactement ceux de la Carte pour `qtm:u`, `qtm:s`, `qtm:c` et `qtm:sp` ; l'ordre des noms dans la table (`c`, `sp`, `s`, `u`) ne suffit pas à le dire.

Appels système trouvés : 0x01 ControlMemory, 0x02 QueryMemory, 0x03 ExitProcess, 0x08 CreateThread, 0x09 ExitThread, 0x0A SleepThread, 0x13 CreateMutex, 0x17 CreateEvent, 0x18 SignalEvent, 0x1F MapMemoryBlock, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x25 WaitSynchronizationN, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest, 0x35 GetProcessId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive. Pas de `BindInterrupt` : le module n'a pas d'interruption, il attend sans doute les événements de `cam:q`, `hid:QTM` et `gpio:QTM` (interprété). Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les quatre aiguillages

Chaque aiguillage est une fonction ARM à `switch` (lisible dans le pseudo-code) qui lit le numéro dans les 16 bits du haut de l'en-tête. Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F`.

`emulate_dispatch.py qtm 0x103464=qtm:u 0x1035c4=qtm:s 0x103918=qtm:c 0x1039f8=qtm:sp --arm` :

| Aiguillage | Commandes trouvées | Numéros |
| --- | --- | --- |
| `qtm:u` | 6 | 1 à 6 |
| `qtm:s` | 16 | 1 à 6, `0x401` à `0x40A` |
| `qtm:c` | 5 | 1 à 5 |
| `qtm:sp` | 20 | 1 à 6, `0x401` à `0x40A`, `0x801` à `0x804` |

**Chaque service contient celui d'avant** pour `qtm:u`, `qtm:s`, `qtm:sp` : les six commandes de `qtm:u`, plus les dix de `0x4xx` pour `qtm:s`, plus les quatre de `0x8xx` pour `qtm:sp`, aux mêmes adresses (vérifié sur les tables). `qtm:c` a ses propres cinq commandes. Les tables de la Carte (6, 16, 5, 20) sont retrouvées en nombre, en numéros et en en-têtes complets.

## Partie 3 : les commandes

Les noms et les en-têtes sont ceux de la Carte (3dbrew). « Source » : d'où vient l'adresse du gestionnaire. « Vérifié » : l'aiguillage compare l'en-tête de requête en entier ou le numéro seulement.

### `qtm:u` (aiguillage `qtm_u_dispatch_command` à `0x103464`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010080` | GetRawTrackingDataEx | `qtm_cmd_0001_GetRawTrackingDataEx` | `0x113A38` | émulation | numéro | `0x00010340` |
| 0x2 | `0x00020080` | GetTrackingDataEx | `qtm_cmd_0002_GetTrackingDataEx` | `0x1137E0` | émulation | numéro | `0x00020440` |
| 0x3 | `0x00030000` | EnableManualIrLedControl | `qtm_cmd_0003_EnableManualIrLedControl` | `0x11378C` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | DisableManualIrLedControl | `qtm_cmd_0004_DisableManualIrLedControl` | `0x113738` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050040` | SetIrLedStatus | `qtm_cmd_0005_SetIrLedStatus` | `0x1136AC` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | IsCurrentAppBlacklisted | `qtm_cmd_0006_IsCurrentAppBlacklisted` | `0x113694` | émulation | numéro | `0x00060080` |

### `qtm:s` (aiguillage `qtm_s_dispatch_command` à `0x1035c4`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010080` | GetRawTrackingDataEx | `qtm_cmd_0001_GetRawTrackingDataEx` | `0x113A38` | émulation | numéro | `0x00010340` |
| 0x2 | `0x00020080` | GetTrackingDataEx | `qtm_cmd_0002_GetTrackingDataEx` | `0x1137E0` | émulation | numéro | `0x00020440` |
| 0x3 | `0x00030000` | EnableManualIrLedControl | `qtm_cmd_0003_EnableManualIrLedControl` | `0x11378C` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | DisableManualIrLedControl | `qtm_cmd_0004_DisableManualIrLedControl` | `0x113738` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050040` | SetIrLedStatus | `qtm_cmd_0005_SetIrLedStatus` | `0x1136AC` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | IsCurrentAppBlacklisted | `qtm_cmd_0006_IsCurrentAppBlacklisted` | `0x113694` | émulation | numéro | `0x00060080` |
| 0x401 | `0x04010040` | SetCentralBarrierPosition | `qtm_cmd_0401_SetCentralBarrierPosition` | `0x107430` | émulation | numéro | `0x04010040` |
| 0x402 | `0x04020000` | GetCameraLuminance | `qtm_cmd_0402_GetCameraLuminance` | `0x1070E8` | émulation | numéro | `0x04020080` |
| 0x403 | `0x04030000` | EnableAutoBarrierControl | `qtm_cmd_0403_EnableAutoBarrierControl` | `0x114C38` | émulation | numéro | `0x04030040` |
| 0x404 | `0x04040000` | DisableAutoBarrierControl | `qtm_cmd_0404_DisableAutoBarrierControl` | `0x11366C` | émulation | numéro | `0x04040040` |
| 0x405 | `0x04050040` | SetBarrierPosition | `qtm_cmd_0405_SetBarrierPosition` | `0x113630` | émulation | numéro | `0x04050040` |
| 0x406 | `0x04060000` | GetCurrentBarrierPosition | `qtm_cmd_0406_GetCurrentBarrierPosition` | `0x113604` | émulation | numéro | `0x04060080` |
| 0x407 | `0x04070040` | SetIrLedStatusOverride | `qtm_cmd_0407_SetIrLedStatusOverride` | `0x11238C` | émulation | numéro | `0x04070040` |
| 0x408 | `0x040801C0` | SetCalibrationData | `qtm_cmd_0408_SetCalibrationData` | `0x1134D4` | émulation | numéro | `0x04080040` |
| 0x409 | `0x04090000` | GetQtmStatus | `qtm_cmd_0409_GetQtmStatus` | `0x1072EC` | émulation | numéro | `0x04090080` |
| 0x40A | `0x040A0040` | SetQtmStatus | `qtm_cmd_040A_SetQtmStatus` | `0x11349C` | émulation | numéro | `0x040A0040` |

### `qtm:c` (aiguillage `qtm_c_dispatch_command` à `0x103918`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010000` | StartHardwareCheck | `qtm_c_cmd_0001_StartHardwareCheck` | `0x105A90` | émulation | numéro | `0x00010040` |
| 0x2 | `0x00020000` | StopHardwareCheck | `qtm_c_cmd_0002_StopHardwareCheck` | `0x105A5C` | émulation | numéro | `0x00020040` |
| 0x3 | `0x00030040` | SetBarrierPattern | `qtm_c_cmd_0003_SetBarrierPattern` | `0x105A30` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | WaitAndCheckExpanderWorking | `qtm_c_cmd_0004_WaitAndCheckExpanderWorking` | `0x10599C` | émulation | numéro | `0x00040080` |
| 0x5 | `0x00050040` | SetIrLedStatusOverride | `qtm_c_cmd_0005_SetIrLedStatusOverride` | `0x105A0C` | émulation | numéro | `0x00050040` |

### `qtm:sp` (aiguillage `qtm_sp_dispatch_command` à `0x1039f8`)

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Source | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x00010080` | GetRawTrackingDataEx | `qtm_cmd_0001_GetRawTrackingDataEx` | `0x113A38` | émulation | numéro | `0x00010340` |
| 0x2 | `0x00020080` | GetTrackingDataEx | `qtm_cmd_0002_GetTrackingDataEx` | `0x1137E0` | émulation | numéro | `0x00020440` |
| 0x3 | `0x00030000` | EnableManualIrLedControl | `qtm_cmd_0003_EnableManualIrLedControl` | `0x11378C` | émulation | numéro | `0x00030040` |
| 0x4 | `0x00040000` | DisableManualIrLedControl | `qtm_cmd_0004_DisableManualIrLedControl` | `0x113738` | émulation | numéro | `0x00040040` |
| 0x5 | `0x00050040` | SetIrLedStatus | `qtm_cmd_0005_SetIrLedStatus` | `0x1136AC` | émulation | numéro | `0x00050040` |
| 0x6 | `0x00060000` | IsCurrentAppBlacklisted | `qtm_cmd_0006_IsCurrentAppBlacklisted` | `0x113694` | émulation | numéro | `0x00060080` |
| 0x401 | `0x04010040` | SetCentralBarrierPosition | `qtm_cmd_0401_SetCentralBarrierPosition` | `0x107430` | émulation | numéro | `0x04010040` |
| 0x402 | `0x04020000` | GetCameraLuminance | `qtm_cmd_0402_GetCameraLuminance` | `0x1070E8` | émulation | numéro | `0x04020080` |
| 0x403 | `0x04030000` | EnableAutoBarrierControl | `qtm_cmd_0403_EnableAutoBarrierControl` | `0x114C38` | émulation | numéro | `0x04030040` |
| 0x404 | `0x04040000` | DisableAutoBarrierControl | `qtm_cmd_0404_DisableAutoBarrierControl` | `0x11366C` | émulation | numéro | `0x04040040` |
| 0x405 | `0x04050040` | SetBarrierPosition | `qtm_cmd_0405_SetBarrierPosition` | `0x113630` | émulation | numéro | `0x04050040` |
| 0x406 | `0x04060000` | GetCurrentBarrierPosition | `qtm_cmd_0406_GetCurrentBarrierPosition` | `0x113604` | émulation | numéro | `0x04060080` |
| 0x407 | `0x04070040` | SetIrLedStatusOverride | `qtm_cmd_0407_SetIrLedStatusOverride` | `0x11238C` | émulation | numéro | `0x04070040` |
| 0x408 | `0x040801C0` | SetCalibrationData | `qtm_cmd_0408_SetCalibrationData` | `0x1134D4` | émulation | numéro | `0x04080040` |
| 0x409 | `0x04090000` | GetQtmStatus | `qtm_cmd_0409_GetQtmStatus` | `0x1072EC` | émulation | numéro | `0x04090080` |
| 0x40A | `0x040A0040` | SetQtmStatus | `qtm_cmd_040A_SetQtmStatus` | `0x11349C` | émulation | numéro | `0x040A0040` |
| 0x801 | `0x08010040` | NotifyTopLcdModeChange | `qtm_sp_cmd_0801_NotifyTopLcdModeChange` | `0x105AC8` | émulation | numéro | `0x08010040` |
| 0x802 | `0x08020000` | NotifyTopLcdPowerOn | `qtm_sp_cmd_0802_NotifyTopLcdPowerOn` | `0x105ADC` | émulation | numéro | `0x08020040` |
| 0x803 | `0x08030000` | IsExpanderInUse | `qtm_sp_cmd_0803_IsExpanderInUse` | `0x115338` | émulation | numéro | `0x08030080` |
| 0x804 | `0x08040000` | NotifyTopLcdPowerOff | `qtm_sp_cmd_0804_NotifyTopLcdPowerOff` | `0x105AEC` | émulation | numéro | `0x08040040` |


Notes :

- Les six commandes de `qtm:u` sont aussi dans `qtm:s` et `qtm:sp` ; leur gestionnaire est le même. Pour les voir une fois, lire `qtm:sp` (les 20) et `qtm:c` (les 5, uniques).
- Les gestionnaires ne sont pas des enveloppes : ils lisent ou écrivent directement dans les structures globales du module (par exemple `IsCurrentAppBlacklisted` est un seul octet recopié depuis la structure d'état à `+0x11`).

## Partie 4 : une opération pas à pas, GetRawTrackingDataEx

`qtm:u` commande 1 (3dbrew : `0x00010080`, réponse `0x00010340` : treize mots ordinaires, soit le résultat et une structure de 12 mots, 48 octets, de suivi). Lu dans le pseudo-code de `qtm_cmd_0001_GetRawTrackingDataEx` (`0x113A38`), les rôles sont interprétés.

1. L'aiguillage `0x103464` lit le numéro 1 et appelle le gestionnaire avec un tampon de sortie de 12 mots et le mot du paramètre.
2. Le gestionnaire teste deux indicateurs de l'état : octet à `+0xC` de la structure d'état (« le suivi est démarré ») et octet à `+7` d'une seconde structure (« une application a le droit de lire »). Si l'un est nul, il rend un code d'erreur sans toucher au tampon.
3. Il demande à `camera_status_flag0_get` (`0x114574`) si l'indicateur 0 d'état de la caméra est posé. Si oui, il copie 12 mots par défaut dans le tampon de sortie et rend `0xC8A18008`.
4. Sinon il prend le verrou `0x1EB6374C` (`lock_enter`, `0x115284`), recopie le bloc publié par `tracker_process_frame` et convertit les yeux en pixels par la méthode +0x14 de l'objet de suivi du visage (`face_tracker_eyes_to_pixels`, `0x10B3C0`).
5. L'aiguillage répond `0x00010340`.

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x1AA8A4` | les noms des services : `qtm:c`, `qtm:sp`, `qtm:s`, `qtm:u` |
| `0x1AA01E` à `0x1AA528` | les noms des fichiers de modèles du suivi, dans la zone de données en fin de module : `face_SVD.lbp`, `face_SVD_SNFF_TOP.lbp`, `face_SVD_SNFF_GEOM.lbp`, `face_SVD_SNFF_TOP_GEOM.lbp`, `face_SIRL_SVD_SNFF_TOP.lbp`, `face_SIRL_SVD_SNFF_TOP_GEOM.lbp` (interprété : détecteurs de visage), `sdm_SVD.sdm`, `sdm_SVD_SG.sdm`, `sdm_SVD_SNG.sdm`, `sdm_SIRL_SVD_SLFL_SG.sdm`, `sdm_SIRL_SVD_SLFR_SG.sdm`, `sdm_SVD_SLFL_SLFR_SG.sdm` et leurs variantes `SNG` (interprété : modèles de points du visage) |
| `0x1AA912` à `0x1AA9BD` | les noms `sdm_*.sdm` une seconde fois, sans suffixe : la liste utilisée à l'exécution (interprété) |
| `0x1AA8BD` à `0x1AA9D6` | liste de noms de services de la bibliothèque (`cfg:s`, `err:f`, `hid:*`, `ptm:*`, `cfg:u`) |
| `0x125064` | les noms `cam:q`, `gpio:QTM`, `i2c::QTM` |
| `0x12503C` à `0x1AAE48` | l'image initiale des données de la mémoire QTM (`0x85E0C` octets), recopiée à `0x1EADD800` par `copy_qtm_ram_image` : vtables (`0x1AA618`…), table des constructeurs statiques (`0x1AABC8`), archive ZIP des modèles `.lbp` / `.sdm` (`0x12628C`–`0x1AA565`) ; les `0x3C` premiers octets de la zone en lecture seule (`0x125000`–`0x12503B`, tables I2C de la barrière lues en place à `0x125000`, `0x125002`, `0x125004`, `0x125020`) ne sont pas recopiés |

Le fichier `data-00010702` de la NAND (`qtm_black_list`, `key.bin`, `value.bin`, `ctr_backup_black_list`) est la liste des applications pour lesquelles le suivi est interdit (`IsCurrentAppBlacklisted`, `qtm:u` 6) : sa lecture par `qtm` n'est pas suivie.

## Partie 6 : ce que Pokémon X envoie

Rien : le jeu n'ouvre aucun service de `qtm`. Pour le portage PC, `qtm` n'a rien à rendre à la place de la console : la 3D stable n'existe que sur la New 3DS, le rendu stéréoscopique d'un portage n'en a pas besoin.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les quatre tables de commandes : 6, 16, 5 et 20. Voie 1 : l'émulation des quatre aiguillages ARM. Voie 2 : la Carte des services (3dbrew) : mêmes numéros et mêmes en-têtes pour toutes les commandes dont le code vérifie l'en-tête en entier.
- Les noms des quatre services, leur nombre de sessions (3, lu dans l'appel d'enregistrement), l'absence d'interruption.
- Les noms des fichiers de modèles dans le module.

**Interprété** :
- L'appariement de chaque boucle et de chaque aiguillage à son service (par le nombre de commandes).
- Les noms des gestionnaires (de la Carte), les rôles des indicateurs de l'état dans GetRawTrackingDataEx, le sens de « lbp » et « sdm ».
- Que chaque session acceptée a son fil, pris parmi trois places partagées par les quatre services (`session_thread_slot_acquire`).

**Pas lu** :
- Le suivi lui-même est nommé dans `local/analyse/qtm/noms-proposes.tsv` (capture `cam:q`, cascade LBP, pyramide, formes 2D/3D, régression SDM, barrière, diode infrarouge) ; restent sans rôle 18 étapes internes du suivi et de la régression (voir `local/analyse/qtm/notes-100.md`).
- L'étalonnage (`qtm:c`, `SetCalibrationData`) et sa lecture dans `cfg:s`.
- Le code qui lit la liste noire.
- Les quatre fonctions de préparation sont nommées : `qtm_open_services` (`0x101234`), `notification_state_init` (`0x10094C`), `subscribe_srv_notifications` (`0x100C28`), `qtm_initialize` (`0x100C60`).
