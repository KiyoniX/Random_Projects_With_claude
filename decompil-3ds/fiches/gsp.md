# gsp, l'écran et le processeur graphique

`gsp` est le seul programme de la console qui touche au processeur graphique (le PICA200) et aux deux écrans. Un jeu ne lui écrit jamais dans les registres : il range ses demandes dans une page de mémoire partagée avec `gsp`, le prévient d'un message très court, et attend qu'un signal lui dise « c'est fait ». Tout ce que Pokémon X affiche passe par là.

Fiche du 13 octobre 2026, produite avec REA et Ghidra sur le module dumpé de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020001C02`, la version New 3DS du module (lu dans l'exheader) |
| Fichier lu | `local/extrait/gsp/exefs/code.elf` |
| Taille | 58 112 octets de code, 1 272 de données en lecture seule, 668 de données, 6 988 de mémoire à zéro |
| Fonctions | 431 pour Ghidra, 22 entrées manquées, 452 au dénominateur ; 276 nommées dans `gsp.noms.tsv` |
| Services offerts | `gsp::Gpu` (31 commandes, 4 sessions au plus) et `gsp::Lcd` (21 commandes, 1 session) |
| Services appelés | `pdn:g`, `mcu::GPU`, `i2c::LCD`, `ptm:s`, `cfg:s`, `qtm:sp`, plus `srv:` et le port `err:f` |
| Dépendance déclarée | `qtm` (`0004013020004202`) |
| Fils | le fil principal, un fil pour la file de commandes, un fil pour les interruptions, un fil pour les écrans, et un fil par session `gsp::Gpu` ouverte, quatre au plus |
| Interruptions | `0x28` à `0x2D`, les six du processeur graphique |

## Partie 1 : le démarrage et les fils

`entry` (`0x100000`) appelle sept fonctions à la suite, puis `ExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de `0x1102a0` à `0x111de8`.
2. `init_program_args` (`0x100214`).
3. `init_runtime_and_srv` (`0x108ccc`) prépare les verrous et la réserve d'adresses, se connecte au port `srv:` et s'y déclare (`SRV_RegisterClient`).
4. `setup_heap` (`0x100274`) réserve un tas de `0x600000` octets à `0x08000000`. C'est exactement la taille de la mémoire vidéo : ce tas sert à la mettre de côté (partie 3, commandes 25 et 26).
5. La fonction à `0x10013c`, écrite en Thumb, appelle les 27 fonctions d'initialisation des objets globaux, par la table de `0x10f48c` à `0x10f4f8`.
6. `run_init_array` (`0x1001e0`), sur une table vide (`0x10f4f8`-`0x10f4f8`).
7. `gsp_main` (`0x100168`) : tout le reste.

`gsp_main` fait quatre choses : demander à `sm` le sémaphore des notifications, appeler `gsp_initialize`, s'abonner à huit notifications (`subscribe_notifications`, `0x10052c`), puis entrer dans `gsp_service_loop` (partie 2). À la sortie de la boucle, `gsp_finalize` (`0x1003e4`) défait tout dans l'ordre inverse.

**`gsp_initialize` (`0x100468`) construit les objets du module, dans cet ordre :**

| Ordre | Fonction | Adresse | Objet | Ce qu'elle prépare |
| --- | --- | --- | --- | --- |
| 1 | `create_shared_memory_block` | `0x100c4c` | `0x110f30` | La page de mémoire partagée avec les jeux (partie 5) |
| 2 | `gpu_hw_init` | `0x102308` | `0x110001` | Demande à `pdn:g` d'alimenter le processeur graphique, règle deux registres |
| 3 | `rights_init` | `0x1013b4` | `0x110c78` | Le registre de « qui a le droit d'afficher » |
| 4 | `gpu_service_state_init` | `0x101b68` | `0x1102a0` | Deux drapeaux du service `gsp::Gpu` |
| 5 | `pdc_init` | `0x108ad8` | `0x110002` | Les réglages de balayage des deux écrans |
| 6 | `lcd_init` | `0x102048` | `0x110720` | Les écrans eux-mêmes, et le fil qui s'en occupe |
| 7 | `display_init` | `0x101468` | `0x110bf0` | Le suivi des tampons d'écran, branché sur la mémoire partagée à `+0x200` |
| 8 | `vram_save_init` | `0x101b78` | `0x110b70` | Le découpage du tas en 12 blocs de `0x80000` octets |
| 9 | `interrupt_manager_init` | `0x101c28` | `0x110428` | Les interruptions, et le fil qui les attend (partie 8) |
| 10 | `relay_init` | `0x101558` | `0x110f08` | Le relais vers les jeux, branché sur la mémoire partagée à `+0x000` |
| 11 | `cmd_queue_init` | `0x100f28` | `0x110cd0` | Les files de commandes, branchées à `+0x800`, et le fil qui les lit |
| 12 | `register_interrupt_callbacks` | `0x101a98` | `0x110428` | Les sept fonctions à appeler quand une interruption arrive |
| 13 | `sleep_state_init` | `0x101080` | `0x110bdc` | L'état veille ou réveil |

**Les fils.** Tous passent par `create_thread` (`0x108838`), la seule fonction qui appelle `svcCreateThread`, et commencent dans `thread_trampoline` (`0x1057ac`), qui appelle la vraie fonction du fil puis tombe dans l'enrobage `svcExitThread` (`0x1057f0`).

| Fil | Fonction | Adresse | Créé par | Priorité | Ce qu'il fait |
| --- | --- | --- | --- | --- | --- |
| Principal | `gsp_service_loop` | `0x100588` | le noyau | | Notifications, nouveaux clients, et toutes les commandes de `gsp::Lcd` |
| Session (quatre au plus) | `gpu_session_thread_main` | `0x102340` | `gsp_service_loop` | `0x10` | Répond aux commandes `gsp::Gpu` d'un seul client |
| File de commandes | `cmd_queue_thread_main` | `0x103b14` | `cmd_queue_init` | `0x11` | Lit les commandes que le jeu a rangées dans la mémoire partagée et les exécute |
| Interruptions | `interrupt_thread_main` | `0x104800` | `interrupt_manager_init` | `0x09` | Attend les signaux du matériel, fait le ménage dans les registres, prévient le jeu |
| Écrans | `lcd_thread_main` | `0x104cd0` | `lcd_init` | `0x1E` | Allume et éteint les écrans et le rétroéclairage, sur demande |

Un nombre plus petit veut dire plus prioritaire : le fil des interruptions passe devant tous les autres. Chaque adresse de fil n'apparaît qu'une fois dans le code, dans la fonction qui le crée.

## Partie 2 : la boucle de serveur

Le module mélange les deux façons de faire vues dans `sm` et `hid`. `gsp::Lcd` est servi directement par le fil principal, comme dans `sm`. `gsp::Gpu` donne un fil à chaque client, comme dans `hid`.

**Dans `gsp_service_loop` (`0x100588`) :**

1. **Les services.** `SRV_RegisterService` (`0x100e3c`) crée `gsp::Gpu` avec 4 sessions au plus, puis `gsp::Lcd` avec 1 session. Les deux noms sont pointés par `0x110004` et `0x110008`.
2. **L'attente.** `svcReplyAndReceive` attend sur trois poignées : le sémaphore des notifications, `gsp::Lcd`, `gsp::Gpu`.
3. **Le sémaphore.** `handle_srv_notification` (`0x10110c`) lit le numéro par `SRV_ReceiveNotification` et agit (tableau plus bas).
4. **`gsp::Lcd`.** Au premier client, `svcAcceptSession` ouvre la session, et la poignée de la session prend la place du port dans la liste d'attente : tant que ce client est là, personne d'autre ne peut entrer. Chaque commande passe par `gsplcd_handle_command` (`0x101568`), et la réponse part au tour de boucle suivant. Quand le client s'en va (résultat `0xC920181A`), la poignée est fermée et le port reprend sa place.
5. **`gsp::Gpu`.** La boucle cherche une case libre parmi quatre (les quatre bits de `0x11000c`). S'il n'y en a plus, elle attend qu'un des quatre fils se termine. Puis `svcAcceptSession` ouvre la session et `create_thread` lance `gpu_session_thread_main` avec une pile de `0x200` octets.
6. **La sortie.** Quand la notification `0x100` arrive et qu'aucun client `gsp::Lcd` n'est branché, la boucle attend la fin des fils de session, retire les deux services (`SRV_UnregisterService`) et rend la main.

**Dans le fil d'une session `gsp::Gpu` :**

`gpu_session_thread_main` (`0x102340`) appelle `gpu_session_open` (`0x103e8c`), qui cherche une place libre parmi quatre dans le registre des droits et y note le numéro du fil. Ce rang, de 0 à 3, est le **numéro de client** : il sert ensuite partout, et c'est lui qui désigne la tranche de mémoire partagée du jeu. Il est rangé dans le stockage local du fil, où `tls_slot_get` (`0x107850`) le relit à chaque commande.

Le fil entre ensuite dans `gpu_session_receive_loop` (`0x102a14`), qui n'attend que sur la poignée de son client et appelle `gspgpu_handle_command` (`0x103f14`) à chaque commande. Au départ du client, `gpu_session_close` (`0x103d54`) retire sa file d'interruptions, rend le droit d'affichage s'il l'avait, et libère sa place.

| Notification | Ce que fait `handle_srv_notification` |
| --- | --- |
| `0x100` | Fait sortir la boucle |
| `0x104` | `prepare_sleep` (`0x1025fc`) : écrans noirs, rétroéclairage coupé, attente que le processeur graphique ait fini, mémoire vidéo mise de côté, `gpu_hw_suspend`, puis `PTMSYSM_NotifySleepPreparationComplete` |
| `0x105` | Le chemin inverse : `gpu_hw_resume`, `pdc_init`, tampons d'écran remis, mémoire vidéo restaurée, même message à `ptm` |
| `0x108` | Demande au fil des écrans de tout éteindre, et attend qu'il l'ait fait |
| `0x109` | Message `0x0E` au fil des écrans (relire les réglages) |
| `0x20D`, `0x20E` | Messages `0x0D` et `0x0C` au fil des écrans |
| `0x213` | Rallume le rétroéclairage si la console est réveillée |
| `0x214` | Coupe le rétroéclairage |

## Partie 3 : les commandes de `gsp::Gpu`

`gspgpu_handle_command` (`0x103f14`) lit l'en-tête dans le tampon du fil (à `+0x80` du stockage local), prend le numéro de commande dans les 16 bits du haut, et saute par une table de 32 adresses rangée à `0x103f34`. Les noms et les en-têtes de requête viennent de 3dbrew ; l'adresse, les contrôles et l'en-tête de réponse sont lus dans le code.

La colonne « Contrôles » dit ce que le code vérifie avant d'agir :
- **E** : l'en-tête entier doit être celui de 3dbrew, sinon `0xD9001830`. Les autres commandes ne regardent que le numéro.
- **D** : le client doit détenir le droit d'affichage, sinon `0xD8202A06`.
- **C** : le fil doit être un client inscrit, sinon `0xD8A02A05`.

| N° | En-tête de requête | Commande | Fonction | Adresse | Contrôles | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010082` | WriteHWRegs | `write_hw_regs` | `0x107540` | E, D | `0x00010040` |
| 2 | `0x00020084` | WriteHWRegsWithMask | `gspgpu_WriteHWRegsWithMask` | `0x10967c` | E, D | `0x00020040` |
| 3 | `0x00030082` | WriteHWRegRepeat | `write_hw_reg_repeat` | `0x109b84` | E, D | `0x00030040` |
| 4 | `0x00040080` | ReadHWRegs | `read_hw_regs` | `0x109864` | D | `0x00040042` |
| 5 | `0x00050200` | SetBufferSwap | `gspgpu_SetBufferSwap` | `0x109184` | D | `0x00050040` |
| 6 | `0x00060082` | SetCommandList | `gspgpu_SetCommandList` | `0x109360` | E | `0x00060040` |
| 7 | `0x000700C2` | RequestDma | `gspgpu_RequestDma` | `0x109258` | E | `0x00070040` |
| 8 | `0x00080082` | FlushDataCache | `gspgpu_FlushDataCache` | `0x1092f4` | E | `0x00080040` |
| 9 | `0x00090082` | InvalidateDataCache | `gspgpu_InvalidateDataCache` | `0x1095e0` | E | `0x00090040` |
| 10 | `0x000A0044` | RegisterInterruptEvents | `gspgpu_RegisterInterruptEvents` | `0x109764` | E | `0x000A0040` |
| 11 | `0x000B0040` | SetLcdForceBlack | `gspgpu_SetLcdForceBlack` | `0x109514` | voir plus bas | `0x000B0040` |
| 12 | `0x000C0000` | TriggerCmdReqQueue | `gspgpu_TriggerCmdReqQueue` | `0x1095c0` | aucun | `0x000C0040` |
| 13 | `0x000D0140` | SetDisplayTransfer | `gspgpu_SetDisplayTransfer` | `0x1095b4` | | `0x000D0040` |
| 14 | `0x000E0180` | SetTextureCopy | `gspgpu_SetTextureCopy` | `0x1093b0` | | `0x000E0040` |
| 15 | `0x000F0200` | SetMemoryFill | `gspgpu_SetMemoryFill` | `0x1092e8` | | `0x000F0040` |
| 16 | `0x00100040` | SetAxiConfigQoSMode | `gspgpu_SetAxiConfigQoSMode` | `0x10b8a4` | C | `0x00100040` |
| 17 | `0x00110040` | SetPerfLogMode | `gspgpu_SetPerfLogMode` | `0x109384` | | `0x00110040` |
| 18 | `0x00120000` | GetPerfLog | `gspgpu_GetPerfLog` | `0x10923c` | | `0x001203C0` |
| 19 | `0x00130042` | RegisterInterruptRelayQueue | `gspgpu_RegisterInterruptRelayQueue` | `0x10978c` | E, C | `0x00130082` |
| 20 | `0x00140000` | UnregisterInterruptRelayQueue | `gspgpu_UnregisterInterruptRelayQueue` | `0x109808` | C | `0x00140040` |
| 21 | `0x00150002` | TryAcquireRight | `gspgpu_TryAcquireRight` | `0x10b7ec` | E, C | `0x00150040` |
| 22 | `0x00160042` | AcquireRight | `gspgpu_AcquireRight` | `0x109260` | E, C | `0x00160040` |
| 23 | `0x00170000` | ReleaseRight | `gspgpu_ReleaseRight` | `0x10b728` | C | `0x00170040` |
| 24 | `0x00180000` | ImportDisplayCaptureInfo | `gspgpu_ImportDisplayCaptureInfo` | `0x109770` | | `0x00180240` |
| 25 | `0x00190000` | SaveVramSysArea | `gspgpu_SaveVramSysArea` | `0x109428` | voir plus bas | `0x00190040` |
| 26 | `0x001A0000` | RestoreVramSysArea | `gspgpu_RestoreVramSysArea` | `0x109570` | voir plus bas | `0x001A0040` |
| 27 | `0x001B0000` | ResetGpuCore | `gspgpu_ResetGpuCore` | `0x1092b0` | D | `0x001B0040` |
| 28 | `0x001C0040` | SetLedForceOff | `gspgpu_SetLedForceOff` | `0x109368` | | `0x001C0040` |
| 29 | `0x001D0040` | SetTestCommand | `gspgpu_SetTestCommand` | `0x1093a4` | | `0x001D0040` |
| 30 | `0x001E0080` | SetInternalPriorities | `gspgpu_SetInternalPriorities` | `0x1096fc` | C | `0x001E0040` |
| 31 | `0x001F0082` | StoreDataCache | `gspgpu_StoreDataCache` | `0x1093bc` | E | `0x001F0040` |

Un numéro inconnu rend `0xD900182F`.

**Les commandes qui ne font rien.** Cinq rendent toujours `0xE0C02BF4` sans rien toucher : 10, 13, 14, 15 et 29. Deux autres, 6 et 7, ne font que refermer la poignée de processus reçue. Ce sont justement les commandes que 3dbrew marque « Stubbed », plus les trois qui portent le nom d'une opération graphique (transfert d'affichage, copie de texture, remplissage) : ces opérations ne passent pas par un message, mais par la file de la mémoire partagée (partie 6).

**Les registres (1 à 4).** L'adresse reçue est un décalage, auquel le code ajoute `0x1EB00000`. Il doit être multiple de 4 et inférieur à `0x420000` (sinon `0xE0E02A01`) ; la taille doit valoir au plus `0x80` octets (sinon `0xE0E02BEC`) et être multiple de 4 (sinon `0xE0E02BF2`). Les données arrivent dans un tampon de `0x80` octets rangé à `0x1102a0` ; ce que lit ReadHWRegs repart par un autre, à `0x1103a0`. La commande 2 fait un cas à part du décalage `0x400424` avec une taille de `0x50` : elle appelle alors une fonction non lue (`0x10b96c`) au lieu d'écrire.

**Le droit d'affichage (21 à 23).** Un seul client à la fois peut écrire dans les registres et faire lire sa file. AcquireRight reçoit un octet et la poignée du processus du jeu. `rights_acquire` (`0x10b504`) attend son tour sur un compteur, puis `rights_grant` (`0x105fa4`) inscrit le numéro du client à trois endroits (le registre des droits, le relais des interruptions, la file de commandes), garde la poignée de son processus, appelle `SetGpuProt`, puis règle la priorité du fil de la file et deux registres (`set_axi_qos`) d'après ce que ce client avait demandé par les commandes 16 et 30. TryAcquireRight fait la même chose sans attendre : si le droit est pris, elle rend `0xC8402BF0`. Demander un droit qu'on a déjà rend `0x2BEB`. Si l'octet d'AcquireRight n'est pas nul, la demande passe en force : le droit est retiré à celui qui l'avait, et la première fois le processeur graphique est remis à zéro (`gpu_reset_core`, `0x106060`).

**SetBufferSwap (5).** Elle reçoit le numéro de l'écran (0 ou 1) et six mots qui décrivent l'image à montrer (les six premiers de la description de la partie 5). `gspgpu_SetBufferSwap` les range dans l'objet `0x110bf0`, puis les applique tout de suite ou au prochain balayage, selon un compteur lu dans le matériel (`0x1EF00454` ou `0x1EF00554`, comparé à `0x52`).

**Le cache (8, 9, 31).** Elles vérifient que la zone est dans le tas linéaire (`0x14000000` à `0x1C000000`, ou `0x30000000` à `0x40000000`) ou dans la mémoire supplémentaire de la New 3DS (`0x1E800000` à `0x1EC00000`), sinon `0xE0E02BF5`. Puis elles appellent `FlushProcessDataCache`, `InvalidateProcessDataCache` ou `StoreProcessDataCache` sur le processus du client, et referment sa poignée. La commande 9 accepte en plus la mémoire vidéo.

**SetLcdForceBlack (11).** Elle range l'octet reçu à deux endroits de l'objet des écrans et appelle `lcd_update_force_black` (`0x107c94`), qui écrit `0x01000000` (noir) ou 0 dans `0x1ED02204` et `0x1ED02A04`. Le droit n'est exigé que pour lever le noir, et seulement après cette remise à zéro (l'octet `0x110422` s'en souvient).

**La sauvegarde de la mémoire vidéo (25, 26).** Elles ne servent qu'à un client qui avait mis le bit 0 dans les drapeaux de la commande 19 (sinon `0xD8202A06`). Elles copient la mémoire vidéo vers le tas de `gsp`, ou l'inverse, par blocs de `0x80000` octets et par DMA. La commande 25 attend d'abord, jusqu'à 33 millisecondes, que le processeur graphique ait fini.

**SetInternalPriorities (30).** Deux priorités : la première (de `0x10` à `0x3F`) pour le fil de session lui-même, la seconde (de `0x11` à `0x3F`) pour le fil de la file de commandes quand ce client aura le droit. Hors de ces bornes : `0xE0E02BE8`.

## Partie 4 : les commandes de `gsp::Lcd`

`gsplcd_handle_command` (`0x101568`) fait le même aiguillage, par une table de 22 adresses rangée à `0x101588`. Il ne vérifie jamais l'en-tête entier. Presque toutes les commandes reçoivent en premier un masque d'écrans : bit 0 pour l'un, bit 1 pour l'autre. Les registres du premier sont en `0x1ED022xx`, ceux du second en `0x1ED02Axx`.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| 1 | `0x00010040` | EnableABL | `gsplcd_EnableABL` | `0x1034c4` | `0x00010040` |
| 2 | `0x00020040` | DisableABL | `gsplcd_DisableABL` | `0x108400` | `0x00020040` |
| 3 | `0x00030080` | SetRSLut | `gsplcd_SetRSLut` | `0x103540` | `0x00030040` |
| 4 | `0x000400C0` | SetRSParams | `gsplcd_SetRSParams` | `0x10318c` | `0x00040040` |
| 5 | `0x00050140` | SetABLArea | `gsplcd_SetABLArea` | `0x103270` | `0x00050040` |
| 6 | `0x00060140` | sans nom | `gsplcd_cmd0006` | `0x1033c4` | `0x00060040` |
| 7 | `0x00070080` | SetInertia | `gsplcd_SetInertia` | `0x103168` | `0x00070040` |
| 8 | `0x000800C0` | SetDitherMode | `gsplcd_SetDitherMode` | `0x1031ec` | `0x00080040` |
| 9 | `0x00090140` | SetDitherParams | `gsplcd_SetDitherParams` | `0x1032e0` | `0x00090040` |
| 10 | `0x000A0080` | SetBrightnessRaw | `gsplcd_SetBrightnessRaw` | `0x1070f4` | `0x000A0040` |
| 11 | `0x000B0080` | SetBrightness | `gsplcd_SetBrightness` | `0x103424` | `0x000B0040` |
| 12 | `0x000C0040` | ReloadConfig | `lcd_apply_config` | `0x107f34` | `0x000C0040` |
| 13 | `0x000D0040` | RestoreConfig | `lcd_apply_config` | `0x107f34` | `0x000D0040` |
| 14 | `0x000E0000` | GetPowerState | dans l'aiguillage | `0x10187c` | `0x000E0080` |
| 15 | `0x000F0000` | PowerOnAllBacklights | `lcd_post_message` | `0x1086cc` | `0x000F0040` |
| 16 | `0x00100000` | PowerOffAllBacklights | `lcd_post_message` | `0x1086cc` | `0x00100040` |
| 17 | `0x00110040` | PowerOnBacklight | `lcd_post_message` | `0x1086cc` | `0x00110040` |
| 18 | `0x00120040` | PowerOffBacklight | `lcd_post_message` | `0x1086cc` | `0x00120040` |
| 19 | `0x00130040` | SetLedForceOff | `gsplcd_SetLedForceOff` | `0x1029b8` | `0x00130040` |
| 20 | `0x00140000` | GetVendor | `gsplcd_GetVendor` | `0x102dfc` | `0x00140080` |
| 21 | `0x00150040` | GetBrightness | `gsplcd_GetBrightness` | `0x1031c4` | `0x00150080` |

- Les commandes 12 et 13 appellent la même fonction, avec 1 ou 0 en dernier argument.
- Les commandes 15 à 18 ne touchent à rien elles-mêmes : elles déposent un message dans la file du fil des écrans (8 places, à `0x110ae0`). Messages 0 et 4 pour tout allumer et tout éteindre ; 1, 2, 3 pour allumer selon le paramètre ; 5, 6, 7 pour éteindre. Un paramètre autre que 1, 2 ou 3 rend `0xE0E02BE8`, une file pleine `0xD0402BF0`.
- La commande 20 interroge les deux écrans par `i2c::LCD` (périphériques 5 et 6, registre `0x40`) et rend un octet : quatre bits par écran.
- La commande 19 écrit l'octet reçu à `0x1FF81084`, dans la page que tous les programmes peuvent lire.
- La commande 6, que 3dbrew ne nomme pas, écrit quatre valeurs dans `0x1ED02220` à `0x1ED0222C`.

## Partie 5 : la mémoire partagée

**La création.** `create_shared_memory_block` (`0x100c4c`) est la seule fonction qui appelle `svcCreateMemoryBlock`. Elle demande `0x1000` octets, en lecture et écriture pour `gsp` comme pour les autres. `map_shared_memory` (`0x102434`) projette ensuite le bloc dans `gsp` lui-même, à une adresse prise entre `0x10000000` et `0x14000000`. L'objet qui décrit le bloc est à `0x110f30` : l'adresse projetée à `+0x08`, la poignée à `+0x14`. C'est cette poignée que reçoit le jeu en réponse à la commande 19.

**La disposition.** Trois fonctions d'initialisation découpent la page, chacune en quatre tranches, une par numéro de client.

| Décalage | Zone | Taille par client | Branchée par | Qui écrit |
| --- | --- | --- | --- | --- |
| `0x000` | les interruptions relayées | `0x40` | `relay_init`, `relay_register` | `gsp` écrit, le jeu lit |
| `0x200` | les tampons d'écran à montrer | `0x80` | `display_init` | le jeu écrit, `gsp` lit |
| `0x800` | la file de commandes | `0x200` | `cmd_queue_init` | le jeu écrit, `gsp` lit |

Le client numéro *n* a donc sa file d'interruptions à `n × 0x40`, ses tampons d'écran à `0x200 + n × 0x80` et sa file de commandes à `0x800 + n × 0x200`. Les zones `0x100` à `0x1FF` et `0x400` à `0x7FF` ne sont touchées par aucune fonction lue.

Les deux côtés écrivent dans la même page sans verrou commun. Le code modifie donc toujours le premier mot d'une zone par une écriture atomique (il relit, calcule, et ne range que si personne n'a écrit entre-temps).

**La zone des interruptions (`0x40` octets).**

| Décalage | Contenu |
| --- | --- |
| `+0x00` | le rang de la plus ancienne interruption non lue |
| `+0x01` | le nombre d'interruptions en attente |
| `+0x02` | mis à 1 par `gsp` quand la file est pleine et qu'une interruption est perdue |
| `+0x03` | écrit par le jeu : le bit 0 dit « ne me relaie pas les fins d'image » |
| `+0x04`, `+0x08` | deux compteurs de fins d'image non relayées, un par écran |
| `+0x0C` | 52 octets (`0x34`), un par interruption, en anneau |

`relay_push_interrupt` (`0x107a40`) écrit l'octet à la place `(rang + nombre) modulo 0x34`, puis ajoute 1 au nombre. Les fins d'image ne sont ajoutées que s'il y a moins de `0x20` interruptions en attente ; au-delà, elles sont seulement comptées.

**La zone des tampons d'écran (`0x80` octets, soit `0x40` par écran).**

| Décalage | Contenu |
| --- | --- |
| `+0x00` | laquelle des deux descriptions utiliser (0 ou 1) |
| `+0x01` | mis à autre chose que 0 par le jeu : « j'ai une nouvelle image » ; remis à 0 par `gsp` |
| `+0x04` | première description, 7 mots |
| `+0x20` | seconde description, 7 mots |

Une description : dans lequel des deux emplacements du matériel ranger l'adresse (0 ou 1), l'adresse de l'image, l'adresse d'une seconde image (si elle est nulle, la première sert deux fois), la largeur d'une ligne en octets, le format, l'emplacement à montrer, et un septième mot dont je n'ai pas vu l'usage. À chaque fin d'image, `display_on_vblank` (`0x10797c`) regarde l'octet `+0x01` du client qui a le droit : s'il est levé, `display_take_framebuffer_info` (`0x106d94`) copie la description et `pdc_set_framebuffer` (`0x10c5b4`) l'écrit dans les registres. Un jeu peut donc changer d'image sans envoyer un seul message.

**La file de commandes (`0x200` octets).**

| Décalage | Contenu |
| --- | --- |
| `+0x00` | le rang de la prochaine commande à exécuter |
| `+0x01` | le nombre de commandes en attente |
| `+0x02` | l'état : 1 = arrêtée, `0x80` = la dernière commande a échoué |
| `+0x03` | écrit par le jeu : le bit 0 demande l'arrêt de la file |
| `+0x04` | le code d'erreur de la commande qui a échoué |
| `+0x20` | 15 commandes de `0x20` octets, en anneau |

`0x20 + 15 × 0x20` fait bien `0x200`. Une commande, ce sont 8 mots :

| Position | Contenu |
| --- | --- |
| mot 0, octet 0 | l'identifiant de la commande (0 à 5) |
| mot 0, octet 2 | s'il n'est pas nul, la file s'arrête après cette commande |
| mot 0, octet 3 | s'il n'est pas nul, la commande attend que le processeur graphique n'ait plus rien en cours |
| mots 1 à 7 | les paramètres |

## Partie 6 : les commandes de la file

`cmd_queue_thread_main` (`0x103b14`) dort jusqu'à ce qu'on le réveille, puis vide la file du client qui a le droit d'affichage, et de lui seul. Pour chaque commande :

1. `cmd_queue_peek_status` (`0x106e2c`) regarde si le matériel dont la commande a besoin est libre. Sinon le fil se rendort : c'est la fin de l'opération en cours qui le réveillera.
2. La commande est retirée de la file : le rang avance d'un cran (modulo 15), le nombre baisse de 1.
3. `gx_execute_command` (`0x108e00`) l'exécute. Si la console se met en veille, elle attend d'abord le réveil. Elle aiguille sur l'identifiant par une table de 6 adresses rangée à `0x108e64`.
4. En cas d'échec, le code d'erreur va dans le mot `+0x04` de la file et l'état passe à `0x80`.

« Occupé » est un mot de bits rangé à `0x11047c`, que la commande lève en partant et que le fil des interruptions baisse à l'arrivée.

| Id | Commande | Fonction | Adresse | Bit « occupé » | Interruption qui la termine |
| --- | --- | --- | --- | --- | --- |
| 0 | demande de transfert mémoire (DMA) | `gx_request_dma` | `0x10c1c8` | `0x40` | la fin du DMA |
| 1 | traitement d'une liste de commandes | `gx_process_command_list` | `0x10c26c` | `0x20` | `0x2D` |
| 2 | remplissage | `gx_memory_fill` | `0x10bf74` | `0x01` | `0x28` et `0x29` |
| 3 | transfert d'affichage | `gx_display_transfer` | `0x10c360` | `0x10` | `0x2C` |
| 4 | copie de texture | `gx_texture_copy` | `0x10c0b8` | `0x10` | `0x2C` |
| 5 | vidage de cache | dans `gx_execute_command` | `0x1090e8` | aucun | aucune |

Un identifiant au-delà de 5 rend `0xE0C02BF4`.

**Ce que chaque commande lit dans ses paramètres et écrit dans le matériel :**

| Id | Paramètres (mots 1 à 7) | Registres écrits |
| --- | --- | --- |
| 0 | source, destination, taille ; mot 7 : vider le cache avant | aucun : `svcStartInterProcessDma` |
| 1 | adresse de la liste, taille, un drapeau (bit 0) ; mot 7 : vider le cache avant | `0x1EF018E0` = taille ÷ 8, `0x1EF018E8` = adresse ÷ 8, `0x1EF018F0` = 1 |
| 2 | début, valeur, fin de la première zone ; début, valeur, fin de la seconde ; mot 7 : deux réglages de 16 bits | `0x1EF00010` à `0x1EF0001C` pour la première, `0x1EF00020` à `0x1EF0002C` pour la seconde |
| 3 | adresse d'entrée, adresse de sortie, dimensions d'entrée, dimensions de sortie, drapeaux | `0x1EF00C00` à `0x1EF00C14`, puis `0x1EF00C18` = 1 |
| 4 | adresse d'entrée, adresse de sortie, taille, deux mots de dimensions, drapeaux | `0x1EF00C00`, `0x1EF00C04`, `0x1EF00C10`, `0x1EF00C20` à `0x1EF00C28`, puis le bit 0 de `0x1EF00C18` |
| 5 | jusqu'à trois couples adresse et taille | aucun : `FlushProcessDataCache` sur chacun |

**La traduction des adresses.** Le jeu donne des adresses de son propre espace, le matériel veut des adresses physiques divisées par 8. Chaque commande passe donc par la même suite de trois essais :

| Adresse du jeu | Ce que c'est | Adresse physique | Fonction |
| --- | --- | --- | --- |
| `0x14000000` à `0x1C000000` | l'ancien tas linéaire | plus `0x0C000000` | `linear_vaddr_to_paddr` (`0x106594`) |
| `0x30000000` à `0x40000000` | le tas linéaire | moins `0x10000000` | la même |
| `0x1F000000` à `0x1F600000` | la mémoire vidéo | moins `0x07000000` | écrit sur place dans chaque commande |
| `0x1E800000` à `0x1EC00000` | la mémoire supplémentaire de la New 3DS | plus `0x00800000` | `n3ds_extra_vaddr_to_paddr` (`0x106564`) |

Une adresse hors de ces quatre zones fait échouer le remplissage avec `0xE0E02BF5`.

**Le DMA.** `dma_start` (`0x1075f0`) ne laisse passer qu'un transfert à la fois (compteur à `0x110018`). Si la destination est dans la mémoire vidéo, le processus de destination est `gsp` lui-même, sinon c'est celui du jeu.

## Partie 7 : RegisterInterruptRelayQueue puis TriggerCmdReqQueue, pas à pas

C'est le chemin que suit un jeu pour faire dessiner une image. Il commence par AcquireRight (commande 22) : sans le droit, sa file n'est jamais lue.

**Première commande : `0x00130042`.** Le jeu envoie des drapeaux et la poignée d'un signal qu'il a créé.

1. **L'aiguillage** (cas 19, à `0x104460`) vérifie l'en-tête entier et que le mot 2 vaut 0.
2. **Le numéro de client.** `gspgpu_RegisterInterruptRelayQueue` (`0x10978c`) le relit dans le stockage local du fil.
3. **Les drapeaux.** `rights_set_client_flags` (`0x10b7bc`) les range dans la fiche du client.
4. **Le signal et la file.** `relay_register` (`0x10bd6c`) range la poignée du signal dans la case du client (`0x110f08 + n × 8`), calcule l'adresse de sa file (`n × 0x40` dans la mémoire partagée), met ses trois premiers mots à zéro, puis range cette adresse à côté de la poignée. C'est ce pointeur non nul qui dit « ce client écoute ».
5. **La mémoire partagée.** `get_shared_memory_handle` (`0x10bd94`) rend la poignée du bloc.
6. **La réponse.** En-tête `0x00130082`, le résultat, le numéro de client, un mot à zéro, la poignée de la mémoire partagée. Le résultat vaut `0x2A07` la toute première fois depuis le démarrage de `gsp` (un octet à `0x110421` s'en souvient), 0 ensuite.

Ce que le jeu fait de `0x2A07`, la lecture du jeu l'a dit depuis ([contrat de `gsp::Gpu`](contrat-gsp.md), partie 2) : il compare le résultat à `0x2A07` (à `0x164394` dans le jeu, relu pour cette fiche) et, s'il est égal, note qu'il est le premier inscrit. Il programme alors lui-même les écrans, par 64 WriteHWRegs, 4 WriteHWRegsWithMask et un transfert d'essai. Sur une console, le menu s'inscrit avant tout jeu, qui reçoit donc 0 (interprété) ; un portage qui rend 0 s'épargne ces 68 écritures.

Le jeu projette alors la page chez lui et range une commande dans sa file. Cette fiche disait qu'il « écrit une commande d'identifiant 1 à `0x800 + n × 0x200 + 0x20` et met 1 dans l'octet `+0x01` » : c'est le cas d'une file vide, pas la règle. Le contrat, et l'assembleur de `gx_queue_push` (`0x1730ec` dans le jeu) relu pour cette fiche, donnent la règle : le jeu écrit à la case (rang + nombre) modulo 15, c'est-à-dire à `0x20 + case × 0x20` dans sa file, augmente le nombre de 1 par une écriture atomique, et n'envoie TriggerCmdReqQueue **que quand le nombre vient de passer de 0 à 1**. Et la commande 1 est presque toujours précédée d'une commande 5 (vidage de cache) sur la même liste, le jeu laissant à zéro le mot 7 de la commande 1.

**Seconde commande : `0x000C0000`.** Elle n'a aucun paramètre.

7. **Le réveil.** `gspgpu_TriggerCmdReqQueue` (`0x1095c0`) met à 1 l'octet `0x110cf9` et signale l'événement interne `0x110ce0`. La réponse `0x000C0040` part aussitôt, avant que rien ne soit dessiné.
8. **Le fil de la file** se réveille dans `cmd_queue_thread_main`, prend le verrou `0x110ce8`, et lit le numéro du client qui a le droit (`0x110cf4`).
9. **Le matériel est-il libre ?** `cmd_queue_peek_status` regarde le bit `0x20` du mot « occupé ».
10. **La commande sort de la file**, copiée sur la pile du fil.
11. **L'aiguillage.** `gx_execute_command` saute au cas 1 (à `0x108f44`) et appelle `gx_process_command_list` (`0x10c26c`) avec la poignée du processus du jeu.
12. **Le cache.** Si le mot 7 n'est pas nul, `FlushProcessDataCache` sur la liste.
13. **Occupé.** Le bit `0x20` est levé.
14. **L'ancienne interruption est effacée** (sauf pour la toute première liste) : `0x1EF01000` reçoit 0, le code attend que le bit 31 de `0x1EF00034` retombe, et vide le signal de l'interruption `0x2D`.
15. **L'écriture dans le matériel.** `p3d_submit_command_list` (`0x10d444`) traduit l'adresse, puis écrit la taille divisée par 8 dans `0x1EF018E0`, l'adresse physique divisée par 8 dans `0x1EF018E8`, et 1 dans `0x1EF018F0`. C'est cette dernière écriture qui lance le processeur graphique.
16. **Le fil des interruptions est prévenu** par le signal `0x110474` : « une liste est partie, attends maintenant l'interruption `0x2D` ».

**Le retour.** Quand le processeur graphique a fini :

17. Le noyau déclenche le signal lié à l'interruption `0x2D`. `interrupt_thread_main` se réveille, baisse le bit `0x20`, et appelle `on_p3d_interrupt` (`0x102ae0`).
18. `relay_push_interrupt` écrit l'octet 5 dans la file d'interruptions du jeu et déclenche son signal.
19. Comme l'octet `0x110cf9` vaut 1, le fil de la file est réveillé à son tour, pour la commande suivante.

Personne ne remet cet octet à zéro : après le premier TriggerCmdReqQueue, chaque fin d'opération relance la lecture de la file.

## Partie 8 : le relais des interruptions

**La liaison avec le noyau.** `interrupt_manager_init` (`0x101c28`) crée six signaux et les lie chacun à une interruption par `svcBindInterrupt`, avec la priorité 4. C'est le seul endroit du module qui appelle cet appel système. L'exheader demande au noyau exactement ces six numéros.

| Interruption | Signal | Octet relayé au jeu | Ce que fait le fil avant de prévenir | Fonction appelée |
| --- | --- | --- | --- | --- |
| `0x28` | `0x110454` | 0 | Baisse le bit 1 de `0x1EF0001C`, attend le bit 26 de `0x1EF00034` | `on_psc0_interrupt` (`0x102bd8`) |
| `0x29` | `0x110458` | 1 | Baisse le bit 1 de `0x1EF0002C`, attend le bit 27 | `on_psc1_interrupt` (`0x102c44`) |
| `0x2A` | `0x11045c` | 2 | Lève trois bits (`0x70000`) dans `0x1EF00478` | `on_pdc0_interrupt` (`0x10786c`) |
| `0x2B` | `0x110460` | 3 | La même chose dans `0x1EF00578` | `on_pdc1_interrupt` (`0x102bb8`) |
| `0x2C` | `0x110464` | 4 | Baisse le bit 8 de `0x1EF00C18`, attend le bit 30 | `on_ppf_interrupt` (`0x102b4c`) |
| `0x2D` | `0x110468` | 5 | Rien dans les registres, sauf un calcul sur `0x1EF01394` si la liste l'avait demandé | `on_p3d_interrupt` (`0x102ae0`) |
| fin d'un DMA | la poignée du DMA | 6 | `dma_release` | `on_dma_interrupt` (`0x102cb0`) |

Les noms courts (`psc`, `pdc`, `ppf`, `p3d`) sont ceux que 3dbrew donne à ces interruptions : deux remplissages, la fin d'image de chaque écran, le transfert, le rendu.

**Le fil.** `interrupt_thread_main` (`0x104800`) attend sur huit poignées à la fois et aiguille sur celle qui a sonné, par une table de 8 adresses rangée à `0x1048d0`. Deux subtilités :

- L'interruption `0x2D` n'est pas attendue en permanence. La sixième place de la liste est d'abord tenue par le signal « une liste est partie » ; quand il sonne, le fil y met le signal de l'interruption, et l'inverse après. Même jeu à la septième place entre « un DMA est parti » et la poignée du DMA.
- Quand un remplissage vise deux zones à la fois, le jeu ne reçoit qu'une interruption : le fil attend les deux fins (`0x28` et `0x29`) et ne prévient qu'à la seconde, avec l'octet 0.

La huitième poignée sert à arrêter le fil ou à tout remettre à plat après ResetGpuCore.

**Qui reçoit quoi.**

- Les interruptions 0, 1, 4, 5 et 6 ne vont qu'au client qui a le droit d'affichage. `relay_push_interrupt` écrit dans sa file et déclenche son signal. File pleine (52 en attente) : l'octet `+0x02` passe à 1 et l'interruption est perdue.
- Les fins d'image (2 et 3) vont aux quatre clients inscrits, qu'ils aient le droit ou non, sauf à ceux qui ont mis le bit 0 de l'octet `+0x03` de leur file. Avant de les relayer, `display_on_vblank` applique le changement de tampon d'écran en attente.
- Après chacune de ces cinq-là, si la console attend de se mettre en veille et que plus rien n'est en cours, le fil qui attend dans `prepare_sleep` est libéré.

**Comment `gsp` apprend qu'une image est finie.** C'est donc l'interruption `0x2A` pour un écran, `0x2B` pour l'autre : le noyau déclenche le signal, le fil se réveille, et chaque jeu inscrit trouve un octet 2 ou 3 dans sa file et son signal déclenché.

## Partie 9 : les registres du matériel

Le code ne touche à aucun registre en `0x1EC0…`. Tout est en `0x1ED02…` (les écrans), `0x1ED0F4…` (deux registres) et `0x1EF0…` (le processeur graphique). L'exheader demande justement la projection de la page `0x1ED02000`, de la page `0x1ED0F000`, de la plage `0x1EF00000` à `0x1EF20000`, et de la mémoire vidéo de `0x1F000000` à `0x1F600000`.

**Le processeur graphique :**

| Registres | Qui y touche | Ce que le code en fait |
| --- | --- | --- |
| `0x1EF00000` | `set_axi_qos`, `cfg_load_lcd_settings` | Lu seulement : le bit 2 change des réglages |
| `0x1EF00004` | `gpu_hw_init`, `gpu_hw_resume`, `gpu_hw_reset` | Bit 8 levé au démarrage ; `0x70100` au réveil et à la remise à zéro |
| `0x1EF00010` à `0x1EF0001C` | `gx_memory_fill` | Premier remplissage : début ÷ 8, fin ÷ 8, valeur, réglage |
| `0x1EF00020` à `0x1EF0002C` | `gx_memory_fill` | Second remplissage, même forme |
| `0x1EF00030` | `gpu_hw_init`, `gpu_hw_resume`, `gpu_hw_suspend` | Bits 8 à 11 baissés en marche, levés en veille |
| `0x1EF00034` | `interrupt_thread_main`, `gx_process_command_list` | Lu : bits 26, 27, 30 et 31, « encore occupé » pour chaque opération |
| `0x1EF00050`, `0x1EF00054` | `gpu_hw_resume`, `gpu_hw_reset` | `0x22221200` et `0xFF2` |
| `0x1EF00400` à `0x1EF0049F` | `pdc_load_screen_config` | Les réglages de balayage du premier écran, copiés d'une table de `0x64` octets |
| `0x1EF00468`, `0x1EF0046C` | `pdc_set_framebuffer` | Les deux emplacements d'adresse d'image du premier écran ; le premier mot de la description choisit lequel |
| `0x1EF00494`, `0x1EF00498` | `pdc_set_framebuffer` | Les deux emplacements de la seconde image (pour l'autre œil, voir « interprété ») |
| `0x1EF00490`, `0x1EF00470`, `0x1EF00478` | `pdc_set_framebuffer` | Largeur de ligne, format (16 bits du bas), emplacement à montrer |
| `0x1EF00474` | `pdc_init` | `0x10501` |
| `0x1EF00480`, `0x1EF00484` | `pdc_load_screen_config` | Une table de 256 valeurs, de `0x000000` à `0xFFFFFF` par pas de `0x010101` |
| `0x1EF00454`, `0x1EF00554` | `gspgpu_SetBufferSwap` | Lu : un compteur comparé à `0x52` |
| `0x1EF005xx` | les mêmes fonctions | Le second écran, mêmes registres `0x100` plus loin |
| `0x1EF00C00` à `0x1EF00C28` | `gx_display_transfer`, `gx_texture_copy` | Entrée, sortie, dimensions, drapeaux, départ |
| `0x1EF01000` | `gx_process_command_list`, `gpu_hw_reset` | Mis à 0 avant chaque liste |
| `0x1EF01080`, `0x1EF010C0`, `0x1EF010D0` | `gpu_hw_reset` | `0x12345678`, `0xFFFFFFF0`, 1 |
| `0x1EF01394`, `0x1EF01494` | fonction sans nom (`0x109ac4`) | Lit l'un, écrit dans l'autre un nombre recalculé |
| `0x1EF018E0`, `0x1EF018E8`, `0x1EF018F0` | `p3d_submit_command_list` | Taille, adresse et départ d'une liste de commandes |

Les trois tables de réglages du premier écran sont à `0x110020`, `0x110084` et `0x1100e8` ; `pdc_set_top_screen_mode` (`0x10c754`) choisit entre elles. Celle du second écran est à `0x11014c`.

**Les écrans** (un jeu de registres en `0x1ED022xx`, l'autre en `0x1ED02Axx`) :

| Registres | Qui y touche | Ce que le code en fait |
| --- | --- | --- |
| `0x1ED02000` | `lcd_thread_main`, `lcd_init` | `0x10001` ou 0, sur les messages 10 et 11 |
| `0x1ED02004`, `0x1ED0200C`, `0x1ED02014` | `lcd_init` et les fonctions d'allumage | Mise sous tension des écrans |
| `0x1ED02200` | commandes 1, 2 et 8 de `gsp::Lcd` | Bit 0 : réglage automatique de la luminosité ; bits 8 et 9 : tramage |
| `0x1ED02204` | `lcd_update_force_black` | `0x01000000` = écran noir |
| `0x1ED02210` à `0x1ED0221C` | commande 5 | Un rectangle : début et fin sur un axe, puis début et fin sur l'autre |
| `0x1ED02220` à `0x1ED0222C` | commande 6 | Quatre valeurs |
| `0x1ED02230` | commande 7 | Une valeur |
| `0x1ED02238`, `0x1ED0223C` | commande 4 | Deux valeurs |
| `0x1ED02240` | commandes 10, 11 et 21 | La luminosité du rétroéclairage |
| `0x1ED02260` à `0x1ED02278` | commande 9 | Quatre mots faits de 16 octets |
| `0x1ED02280` et suivants | commande 3 | Une table de 9 valeurs, choisie parmi 6 |
| `0x1ED0F400`, `0x1ED0F404` | `set_axi_qos` | Deux morceaux de la valeur de la commande 16 de `gsp::Gpu` : les 3 bits du bas, puis l'octet suivant |

**Les pages que tout le monde lit.** `gsp` écrit l'octet `0x1FF81084` (commande 19 de `gsp::Lcd`) et lit `0x1FF81080`, la position du curseur 3D que `hid` y range.

**Ce qu'un jeu peut atteindre.** Par les commandes 1 à 4, un jeu qui a le droit d'affichage peut lire et écrire de `0x1EB00000` à `0x1EF1FFFF`. Le contrôle est donc plus large que ce que `gsp` a de projeté.

## Partie 10 : les services que gsp appelle

Chaque requête a sa petite fonction, qui écrit un en-tête et appelle `SendSyncRequest`. Il y en a 29, autant que d'appels à `SendSyncRequest` dans le code. Les noms viennent de 3dbrew.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x1101f4` | `0x00010002` | `SRV_RegisterClient` | `0x100e00` | Se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x100eec` | Obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x100e3c` | Créer ses deux services |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x100e98` | Les retirer à l'arrêt |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x10b458` | Ouvrir les six services ci-dessous (l'enrobage `srv_get_service_handle` est `0x106f64`) |
| | | `0x00090040` | `SRV_Subscribe` | `0x108aa0` | S'abonner à huit notifications |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x1025c0` | Lire le numéro de la notification arrivée |
| `pdn:g` | `0x110244` | `0x000100C0` | `PDNG_Control` | `0x103a64` | Alimenter ou couper le processeur graphique |
| `mcu::GPU` | `0x110b18` | `0x00010000` | `MCUGPU_GetLcdPowerState` | `0x10b2a8` | Savoir si les écrans sont allumés |
| | | `0x00020080` | `MCUGPU_SetLcdPowerState` | `0x10b268` | Les allumer ou les éteindre |
| | | `0x00030000` | `MCUGPU_GetGpuLcdInterfaceState` | `0x10b234` | État du lien entre processeur graphique et écrans |
| | | `0x00040040` | `MCUGPU_SetGpuLcdInterfaceState` | `0x10b2e8` | Ouvrir ou fermer ce lien |
| | | `0x00090000` | `MCUGPU_GetMcuFwVerHigh` | `0x105b34` | Version du microcontrôleur, au démarrage du fil des écrans |
| | | `0x000A0000` | `MCUGPU_GetMcuFwVerLow` | `0x105b68` | idem |
| | | `0x000B0040` | `MCUGPU_Set3dLedState` | `0x105b9c` | Allumer ou éteindre le voyant 3D (messages 8 et 9) |
| | | `0x000D0000` | `MCUGPU_GetMcuGpuEventHandle` | `0x10b200` | Obtenir le signal du microcontrôleur |
| | | `0x000E0000` | `MCUGPU_GetMcuGpuEventReason` | `0x106378` | Savoir pourquoi il a sonné |
| `i2c::LCD` | `0x110238` | `0x000500C0` | `I2CLCD_WriteRegister8` | `0x106888` | Régler les écrans (périphériques 5 et 6) |
| | | `0x000D00C0` | `I2CLCD_ReadRegisterBuffer8` | `0x10681c` | Lire leur identité |
| `ptm:s` | `0x110258` | `0x040A0000` | `PTMSYSM_CheckNew3DS` | `0x105be8` | Savoir si la console est une New 3DS |
| | | `0x04030042` | `PTMSYSM_NotifySleepPreparationComplete` | `0x105c28` | Dire à `ptm` que `gsp` est prêt pour la veille |
| `cfg:s` | `0x110274` | `0x00050000` | `CFG_GetSystemModel` | `0x10d0b4` | Connaître le modèle de la console |
| | | `0x04010082` | `CFG_GetConfigInfoBlk8` | `0x10d0f4` | Lire les réglages des écrans |
| `qtm:sp` | `0x110294` | `0x04020000` | `QTMSP_GetCameraLuminance` | `0x10d340` | Lire la lumière ambiante |
| | | `0x08010040` | `QTMSP_NotifyTopLcdModeChange` | `0x10b380` | Prévenir du passage en 3D ou en 2D |
| | | `0x08020000` | `QTMSP_NotifyTopLcdPowerOn` | `0x10b3bc` | Prévenir que l'écran du haut s'allume |
| | | `0x08030000` | `QTMSP_IsExpanderInUse` | `0x10d2cc` | Appelée par `lcd_power_off` (`0x10a518`) |
| | | `0x08040000` | `QTMSP_NotifyTopLcdPowerOff` | `0x10d30c` | Prévenir que l'écran du haut s'éteint |
| `err:f` (port) | `0x1101b0` | `0x00010800` | `ERRF_Throw` | `0x105afc` | Signaler une erreur fatale |

`qtm:sp` n'est ouvert que sur une New 3DS. La poignée de `mcu::GPU` est rangée dans l'objet des écrans (`0x110720 + 0x3F8`).

Les blocs de configuration lus par `cfg_load_lcd_settings` (`0x1098c8`), chacun avec des valeurs de secours si la lecture échoue :

| Bloc | Taille |
| --- | --- |
| `0x00050001` | 2 |
| `0x00050002` | `0x38` |
| `0x00050003` | `0x20` |
| `0x00050006` | 2 |
| `0x00050008` | `0x10C` |
| `0x00050009` | 8 |

Les deux derniers ne sont lus que si le bit 2 de `0x1EF00000` est levé.

Un écart avec la Carte des services : elle ne compte pas `cfg:s` parmi les services que `gsp` appelle. Le code l'ouvre, et l'exheader l'autorise.

## Partie 11 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x110004`, `0x110008` | les pointeurs vers les noms `gsp::Gpu` et `gsp::Lcd` |
| `0x11000c` | les quatre cases de fils de session, un bit chacune |
| `0x110010` | le sémaphore des notifications |
| `0x110018` | le compteur « un seul DMA à la fois » |
| `0x110020`, `0x110084`, `0x1100e8`, `0x11014c` | les quatre tables de réglages de balayage, `0x64` octets chacune |
| `0x1102a0` | l'état du service `gsp::Gpu` : deux tampons de réception de `0x80` octets, un tampon de lecture à `+0x100`, trois octets à `+0x180` |
| `0x110428` | le gestionnaire d'interruptions (détail plus bas) |
| `0x110720` | l'objet des écrans : son fil, ses réglages à `+0x208`, sa file de messages à `+0x3C0` |
| `0x110b70` | la sauvegarde de la mémoire vidéo : 12 blocs |
| `0x110bdc` | l'état de veille : deux compteurs d'attente et trois octets |
| `0x110bf0` | l'affichage : la description en cours de chaque écran (`0x1C` octets), les pointeurs vers la mémoire partagée à `+0x38`, le client propriétaire à `+0x58` |
| `0x110c78` | le registre des droits (détail plus bas) |
| `0x110cd0` | la file de commandes (détail plus bas) |
| `0x110f08` | le relais : quatre couples poignée du signal et adresse de la file, puis l'adresse de la mémoire partagée à `+0x20` et le client propriétaire à `+0x24` |
| `0x110f30` | le bloc de mémoire partagée (adresse à `+0x08`, poignée à `+0x14`) |
| `0x110f50` à `0x111750` | les piles des quatre fils de session, `0x200` octets chacune |
| `0x111750` | les quatre fils de session, 8 octets chacun |
| `0x1118fc` | la réserve d'adresses pour projeter la mémoire partagée |

Le gestionnaire d'interruptions (`0x110428`) :

| Décalage | Contenu |
| --- | --- |
| `+0x10` à `+0x28` | les sept fonctions à appeler, une par octet relayé |
| `+0x2C` à `+0x40` | les six signaux liés aux interruptions `0x28` à `0x2D` |
| `+0x44`, `+0x4C` | les signaux « un DMA est parti » et « une liste est partie » |
| `+0x48` | le signal d'arrêt et de remise à plat |
| `+0x50` | 1 tant qu'aucune liste n'a été lancée |
| `+0x52` | le mode du journal de performances (commande 17) |
| `+0x54` | le mot « occupé » : bits `0x01`, `0x10`, `0x20`, `0x40` |
| `+0x58` | quels remplissages restent à attendre |
| `+0x5C` | l'objet DMA |
| `+0x88` | le journal de performances : sept couples de mots, ce que rend la commande 18 |
| `+0xF0` | le fil |

Le registre des droits (`0x110c78`) :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | quatre fiches de client de 12 octets : les drapeaux de la commande 19, la valeur de la commande 16 (`0x205` par défaut), la priorité de la commande 30 (`0x11` par défaut) |
| `+0x30` | les numéros des quatre fils de session, `0xFFFFFFFF` pour une place libre |
| `+0x40` | le client qui a le droit, `0xFFFFFFFF` si personne |
| `+0x44` | la poignée de son processus |
| `+0x48` | le compteur d'attente du droit |
| `+0x50` | le numéro de la case du stockage local où chaque fil garde son numéro de client |

La file de commandes (`0x110cd0`) :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | quatre pointeurs vers les files de la mémoire partagée |
| `+0x10` | l'événement qui réveille le fil |
| `+0x18` | le verrou |
| `+0x24` | le client dont la file est lue |
| `+0x28` | drapeau d'arrêt du fil |
| `+0x29` | mis à 1 par TriggerCmdReqQueue |
| `+0x2C` | la priorité du fil |
| `+0x30` | le fil |

## Partie 12 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x100b30` |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x1023ec` |
| ExitProcess | `0x03` | `svcExitProcess`, cible du `b` de `entry` | `0x100160` |
| CreateThread | `0x08` | `svcCreateThread` | `0x103764` |
| ExitThread | `0x09` | `svcExitThread`, chute de `thread_trampoline` | `0x1057f0` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x10ab88` |
| SetThreadPriority | `0x0C` | écrit sur place, à quatre endroits | |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x107f10` |
| SignalEvent | `0x18` | `svcSignalEvent` (`0x10d4a8`), et sur place à cinq endroits | |
| ClearEvent | `0x19` | six fois dans `interrupt_thread_main`, une dans `gx_process_command_list` | |
| CreateMemoryBlock | `0x1E` | `svcCreateMemoryBlock` | `0x1023d0` |
| MapMemoryBlock | `0x1F` | dans `map_shared_memory` | `0x102434` |
| UnmapMemoryBlock | `0x20` | dans `unmap_shared_memory` | `0x100ce0` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x1023b8` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x107c7c` |
| CloseHandle | `0x23` | écrit sur place à 53 endroits, plus l'enrobage `svcCloseHandle` (pdn_close, gspgpu_RequestDma, gspgpu_SetCommandList) | `0x106fa0` |
| WaitSynchronization1 | `0x24` | sur place à 13 endroits, et dans `wait_handle_forever` (`0x1075c0` : handle lu dans un objet, délai infini ; pas une enveloppe nue) | |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x1089d0` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x10d86c` |
| GetSystemTick | `0x28` | écrit sur place, à 12 endroits | |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x10ab6c` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x10374c` |
| SendSyncRequest | `0x32` | écrit sur place, à 29 endroits | |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x1057f8` |
| GetThreadId | `0x37` | `svcGetThreadId` | `0x105810` |
| Break | `0x3C` | `svcBreak`, cible du `b` de `break_process` | `0x10ab64` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x100b18` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x10241c` |
| BindInterrupt | `0x50` | `svcBindInterrupt` | `0x10373c` |
| UnbindInterrupt | `0x51` | `svcUnbindInterrupt` | `0x103788` |
| InvalidateProcessDataCache | `0x52` | écrit sur place, à 10 endroits | |
| StoreProcessDataCache | `0x53` | dans `gspgpu_StoreDataCache` | `0x1093bc` |
| FlushProcessDataCache | `0x54` | écrit sur place, à six endroits | |
| StartInterProcessDma | `0x55` | `svcStartInterProcessDma` | `0x10ce30` |
| StopDma | `0x56` | `svcStopDma` (`0x10ae84`), et dans `dma_close` (`0x1064ec`) | |
| SetGpuProt | `0x59` | dans `rights_grant` | `0x105fa4` |

Les 36 appels sont tous autorisés par l'exheader. Les huit derniers du tableau sont le cœur du métier de `gsp` : lier des interruptions, vider le cache d'un autre processus, lancer un DMA.

Les verrous (`lock_enter` à `0x108c4c`, `lock_leave` à `0x108bd4`) et les événements internes (`gate_wait` à `0x107e48`, `light_event_signal` à `0x10871c`) reposent sur `ArbitrateAddress`, comme dans `sm` et `hid`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 31 numéros de `gsp::Gpu` et les 21 de `gsp::Lcd`, leur fonction et leur en-tête de réponse : le pseudo-code de REA d'un côté ; de l'autre les tables d'adresses lues à la main à `0x103f34` et `0x101588`, les appels relevés par un script dans chaque morceau, et les constantes de chaque morceau.
- Les 12 en-têtes de requête que le code vérifie en entier sont ceux de 3dbrew.
- Les six identifiants de la file : le pseudo-code, et la table de 6 adresses lue à la main à `0x108e64`.
- Les six interruptions `0x28` à `0x2D` : les six appels à `svcBindInterrupt`, et les six numéros que l'exheader demande au noyau.
- La chaîne du serveur : `svcReplyAndReceive` n'a que deux appelants (la boucle principale et la boucle de session), `gspgpu_handle_command`, `gx_execute_command`, `p3d_submit_command_list` et `relay_register` n'en ont qu'un chacun. Vu par REA et par le script qui relève les sauts.
- Les cinq sortes de fils : `svcCreateThread` n'est appelé qu'à un endroit, `create_thread` à quatre, et l'adresse de chaque fonction de fil n'apparaît qu'une fois dans le code.
- Les sept fonctions de rappel : lues dans `register_interrupt_callbacks`, et retrouvées dans ses constantes, dans l'ordre.
- La taille des zones de la mémoire partagée : les pas que font les fonctions d'initialisation (`0x40`, `0x80`, `0x200`), et les anneaux tels que le code les parcourt (12 octets d'en-tête plus 52 font `0x40` ; `0x20` plus 15 fois `0x20` font `0x200`).
- La traduction des adresses : les quatre calculs du code tombent sur les adresses physiques que donne la Carte des services (mémoire principale à `0x20000000`, mémoire vidéo à `0x18000000`, mémoire supplémentaire à `0x1F000000`).
- Les services appelés : l'exheader autorise six noms, et ce sont les six que le code ouvre. Les 29 fonctions de requête correspondent aux 29 appels à `SendSyncRequest`.
- Les pages de registres : toutes les adresses relevées dans le code tombent dans les plages que l'exheader fait projeter.
- Les 36 appels système sont dans la liste que l'exheader autorise.
- Les 14 commandes de `gsp::Gpu` que Pokémon X envoie et les six commandes de file : la fonction du jeu qui écrit chaque mot, et la place où ce module le relit ([contrat de `gsp::Gpu`](contrat-gsp.md)). Les quatre adresses de zones que le jeu calcule à l'inscription, les sept mots d'une description de tampon d'écran et les octets d'interruption sont ceux des parties 5 et 8, vus de l'autre côté.
- La façon dont le jeu remplit sa file (partie 7) : le contrat, et l'assembleur de `gx_queue_push` dans le jeu.
- Le jeu n'envoie jamais SetBufferSwap : il annonce ses images par la mémoire partagée seulement. Le moment où ce module prend une description, à chaque fin d'image (`display_on_vblank`), est confirmé contre le résumé de 3dbrew qui le plaçait après un transfert.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens des octets d'en-tête des trois zones de la mémoire partagée. Le code montre ce qu'il lit et écrit ; les mots « arrêtée », « perdue », « nouvelle image » sont les miens.
- Le sens des paramètres des six commandes de la file. Je les ai nommés d'après le registre où ils finissent et d'après l'usage, pas d'après une documentation.
- Le sens des registres. Le tableau de la partie 9 dit ce que le code écrit, pas ce que le matériel en fait. 3dbrew décrit ces registres par leur adresse physique ; je n'ai pas fait le recoupement registre par registre.
- La seconde image (`0x1EF00494`, `0x1EF00498`) vue comme celle de l'autre œil : le code ne l'écrit que pour le premier écran, celui pour lequel il surveille aussi le curseur 3D (`0x1FF81080`).
- Le sens des notifications : `0x104` et `0x105` pour la veille et le réveil, `0x213` et `0x214` pour le couvercle. Elles font ici ce qu'elles font dans `hid`.
- Le sens des codes d'erreur : `0xD8202A06` (pas le droit), `0xD8A02A05` (fil non inscrit), `0xE0C02BF4` (commande vide), `0xC8402BF0` (occupé), `0x2A07` (première inscription). Pour `0x2A07`, le jeu en fait bien cet usage (partie 7) ; que le jeu ne le reçoive jamais sur une console suppose que le menu s'inscrit toujours avant lui.
- L'octet 3 du premier mot d'une commande de file : quand il n'est pas nul, le fil de la file se rendort et réessaie, `0xC8402BF0` ne sort jamais vers le client. 3dbrew dit que la commande échoue. Le jeu y met toujours 1 pour les commandes 0 à 4 (contrat, partie 4).
- Les priorités des fils. Le code passe des constantes codées (`0x6C8DA510` pour une session) qu'une addition ramène à `0x10`.
- Le rôle de `SetGpuProt` : `rights_grant` lui passe 0 ou 1 selon une information demandée au noyau sur le processus du jeu (type `0x13`).
- Les 22 messages du fil des écrans. Je n'ai suivi que ceux que les commandes de `gsp::Lcd` et les notifications envoient.
- Le découpage des objets de la partie 11.
- `QTMSP_GetCameraLuminance` : l'en-tête `0x04020000` part bien sur la poignée de `qtm:sp`, et le nom est celui de la Carte des services ; je n'ai pas vérifié que le résultat est une luminosité.

**Pas lu**
- Le fil des écrans dans le détail : l'allumage et l'extinction (`0x109ed4`, `0x10a0ec`, `0x10a2cc`, `0x10a518`), le réglage automatique de la luminosité (`0x109be8`, `0x107248`, `0x1060e0`), les réglages envoyés par `i2c::LCD` (`0x10c7b8`, `0x10c928`).
- Les trois quarts de `lcd_apply_config` et les calculs de `gsplcd_GetBrightness`.
- La copie de la mémoire vidéo pour la mise en veille (`0x10b978`, `0x106214`, `0x10626c`, `0x10a6b4`).
- Le cas particulier de la commande 2 (`0x10b96c`) et la fonction qui recalcule `0x1EF01394` (`0x109ac4`).
- La réserve d'adresses (`0x1037e4`) ; `0x10b010` est `light_semaphore_wait_timeout`, `0x10ab94` et `0x1070c4` sont nommées (`__aeabi_uldivmod`, `__aeabi_uidivmod`).
- Le détail des 27 fonctions d'initialisation des objets globaux. C'est l'une d'elles qui attribue la case du stockage local où va le numéro de client.
- Plus aucune fonction sans nom (176 nommées dans ce lot : 155 de funcs.tsv et 21 entrées manquées).

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système, nommer leurs enveloppes, trouver les fonctions manquées | `outils/prescan.py`, deux passages | une minute par passage |
| Décompiler les 431 fonctions d'un coup | `prescan.py --dump` | quelques secondes |
| Calculer qui appelle qui, lire les tables d'aiguillage, relever les constantes | des scripts Python sur `code.bin` | immédiat |
| Lire le pseudo-code et nommer | Claude | le gros du temps |
| Recharger les noms dans Ghidra | arrêt et relance du pont REA | une à deux minutes, trois fois |
| Recouper avec la Carte des services et l'exheader | un script | immédiat |

**Les pièges rencontrés.**
- Ghidra avait manqué 48 fonctions : il est passé de 370 à 418. Ce sont les fonctions de fil, les gestionnaires appelés par pointeur, et les 27 fonctions d'initialisation, rangées dans une table de distances. `prescan.py` les a toutes trouvées, sauf `svcDuplicateHandle` (`0x10d86c`), qu'il a fallu ajouter à la main. Il en manquait encore 22 (couverture.py entrees).
- `prescan.py` avait nommé `entry` « `svcExitProcess` » : la fonction est courte et ne contient qu'un appel système, il l'a prise pour une enveloppe. Corrigé dans le fichier de noms.
- Quand une fonction fait un appel système sur place, Ghidra ne montre pas ce qu'il rend. Il affiche à la place « rend le deuxième argument ». Les commandes 6 à 9 et 31 se lisent mal pour cette raison : il faut regarder l'assembleur.
- Les aiguillages ne sont pas des suites de sauts comme on pourrait l'attendre, mais une instruction qui charge l'adresse dans une table posée juste après elle, au milieu du code. La taille que Ghidra donne à ces fonctions ne compte pas la table.

**Trois choses à savoir en relisant dans Ghidra.**
- La fonction à `0x10013c` est en Thumb, et le nom qu'on lui donne dans le fichier de graines ne prend pas. Elle n'a donc pas de ligne dans `gsp.noms.tsv` : à nommer à la main (`run_static_initializers`).
- Les fonctions `get_…` (`get_rights_manager`, `get_cmd_queue`, `get_display`…) ne font que rendre l'adresse d'un objet global. Dans le pseudo-code, un objet se reconnaît à la fonction `get_…` appelée juste avant.
- `0x1039f4`, juste avant `errf_report_error`, est `main_thread_terminate_handler` (adresse rangée par init_thread_eh_globals, mot `0x1039f0`).

**Pour reprendre.** `gsp.noms.tsv` est le fichier de graines : une adresse, `function`, un nom. Les noms en `gspgpu_` et `gsplcd_` sont les commandes que `gsp` reçoit ; ceux en `gx_` les commandes de la file ; ceux en majuscules (`SRV_`, `MCUGPU_`, `QTMSP_`…) les requêtes qu'il envoie à un autre service ; ceux en `on_…_interrupt` les fonctions appelées par le fil des interruptions. Le pseudo-code brut et les scripts de recoupement (`idx.py`, `switches.py`, `headers.py`, `make_tsv.py`) sont dans `local/analyse/gsp/`, non versionné.
