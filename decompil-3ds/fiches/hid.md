# hid, les boutons et les capteurs

`hid` lit les boutons, le pad circulaire, l'écran tactile, l'accéléromètre et le gyroscope, et range ce qu'il lit dans une page de mémoire que les jeux lisent directement. Pour les boutons, un jeu ne lui parle qu'une fois, pour obtenir cette page et cinq signaux « du neuf est arrivé » : ensuite il n'y a plus d'échange de messages, seulement de la lecture.

Fiche du 13 octobre 2026, produite avec REA et Ghidra sur le module dumpé de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001D02`, un titre de la CTRNAND (lu dans l'exheader) |
| Fichier lu | `local/extrait/hid/exefs/code.elf` |
| Taille | 38 068 octets de code, 4 836 de données en lecture seule, 2 836 de données, 3 060 de mémoire à zéro |
| Fonctions | 303 (321 avec les 18 entrées manquées), dont 186 nommées dans `hid.noms.tsv` |
| Services offerts | `hid:SPVR`, `hid:USER`, et sur New 3DS `hid:QTM` et `hid:NFC` : un seul aiguillage de 24 commandes pour les quatre |
| Services appelés | `cdc:HID`, `mcu::HID`, `gpio:HID`, `i2c::HID`, `cfg:s`, `ptm:s`, plus `srv:` et le port `err:f` |
| Dépendances déclarées | `cfg` (`0004013000001702`) et `ptm` (`0004013000002202`) |
| Fils | le fil principal, un fil de lecture des capteurs (trois sur New 3DS), et un fil par session ouverte, sept au plus |

## Partie 1 : le démarrage et les fils

`entry` (`0x100000`) appelle sept fonctions à la suite, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de `0x10cb18` à `0x10d708`.
2. Une fonction non lue (`0x10063c`).
3. `init_runtime_and_srv` (`0x105c50`) prépare les verrous et les réserves d'adresses, se connecte au port `srv:` et s'y déclare (`SRV_RegisterClient`).
4. `setup_heap` (`0x100690`) ouvre `ptm:s`, demande si la console est une New 3DS (`PTMSYSM_CheckNew3DS`), range la réponse à `0x10c088`, et réserve un tas à `0x08000000` : `0x5000` octets sur une ancienne console, `0x9000` sur une New 3DS.
5. La fonction à `0x100128`, écrite en Thumb, appelle les 23 fonctions d'initialisation des objets globaux, par la table de `0x10b288` à `0x10b2e4`.
6. Une fonction vide (`0x100608`).
7. `hid_main` (`0x100180`, 1 100 octets) : tout le reste. Voir la partie 2.

Le module fait tourner plusieurs fils. Tous passent par `create_thread` (`0x102088`), la seule fonction qui appelle `svcCreateThread`, et commencent dans `thread_trampoline` (`0x107cec`), qui appelle la vraie fonction du fil puis `svcExitThread` (`0x107d30`).

| Fil | Fonction | Adresse | Créé par | Ce qu'il fait |
| --- | --- | --- | --- | --- |
| Principal | `hid_main` | `0x100180` | le noyau | Attend les notifications du système et les nouveaux clients |
| Lecture des capteurs | `sampling_thread_main` | `0x1022cc` | `start_sampling` | Attend plusieurs minuteries et signaux à la fois, appelle la fonction de lecture qui correspond |
| Pad (New 3DS seulement) | `pad_thread_main` | `0x102504` | `start_sampling` | Attend la minuterie de 4 ms, appelle `update_pad_and_touch` |
| Gyroscope (New 3DS seulement) | `gyroscope_thread_main` | `0x102550` | `start_sampling` | Attend l'interruption du gyroscope, appelle `update_gyroscope` |
| Session (sept au plus) | `session_thread_main` | `0x1013d4` | `start_session_thread` | Répond aux commandes d'un seul client |

Ce que le fil de lecture attend dépend de la console :

| Console | Ce qui réveille le fil | Fonction appelée | Adresse |
| --- | --- | --- | --- |
| Ancienne | l'interruption du gyroscope (`0x10c058`) | `update_gyroscope` | `0x103bb0` |
| Ancienne | la minuterie du pad, 4 ms (`0x10c048`) | `update_pad_and_touch` | `0x1037d0` |
| Les deux | le signal du microcontrôleur (`0x10c04c`) | `update_accelerometer` | `0x105db8` |
| Les deux | la minuterie du pad de débogage (`0x10c050`) | `update_debug_pad` | `0x1036e8` |
| New 3DS | une minuterie de 4 ms (`0x10c054`) | `rearm_heartbeat_timer` | `0x103b64` |

Sur New 3DS, le pad et le gyroscope ont donc chacun leur fil, et le fil commun ne garde que l'accéléromètre et le pad de débogage.

`start_sampling` (`0x1054d8`) lance ces fils et arme les minuteries ; `stop_sampling` (`0x105114`) les arrête. Les deux sont rappelées quand la console s'endort et se réveille (partie 2).

## Partie 2 : la boucle de serveur

Contrairement à `sm`, il n'y a pas une boucle unique. Le fil principal accepte les clients, et chaque client reçoit son propre fil.

**Dans `hid_main` :**

1. **Les noms.** Quatre noms sont rangés à `0x10d0b0`, dans cet ordre : `hid:SPVR`, `hid:USER`, `hid:QTM`, `hid:NFC`. Le nombre de services à ouvrir (`0x10c098`) vaut 2 sur une ancienne console, 4 sur une New 3DS.
2. **L'enregistrement.** Pour chacun, `SRV_RegisterService` (`0x100fd0`) demande à `sm` de créer le service, avec 7 sessions au plus, et rend un port.
3. **Les notifications.** Cinq gestionnaires sont inscrits par `register_notification_handler` (`0x105b30`), pour les numéros `0x100`, `0x104`, `0x105`, `0x213` et `0x214`. `SRV_EnableNotification` rend le sémaphore qui prévient de leur arrivée.
4. **La mise en route.** `hid_initialize` (`0x100790`) crée la mémoire partagée, ouvre les services du matériel, charge les étalonnages et lance la lecture des capteurs.
5. **L'abonnement.** `SRV_Subscribe` (`0x105af8`) pour `0x213`, `0x214`, `0x104` et `0x105`.
6. **L'attente.** `svcWaitSynchronizationN` attend sur une liste de 3 ou 5 poignées : le sémaphore des notifications, puis un port par service.
   - Le sémaphore : `handle_srv_notification` (`0x100ef8`) lit le numéro par `SRV_ReceiveNotification` et appelle le gestionnaire inscrit.
   - Un port : `svcAcceptSession` ouvre la session, et `start_session_thread` (`0x100a4c`) lui donne une case et un fil. Le rang du port dans la liste donne le type de la session : 0 pour `hid:SPVR`, 1 pour `hid:USER`, 2 pour `hid:QTM`, 3 pour `hid:NFC`. S'il n'y a plus de case libre, la session est refermée aussitôt.
7. **La sortie.** La boucle s'arrête quand l'octet `0x10d0d0` passe à 1, ce que fait le gestionnaire de la notification `0x100`. Le module ferme alors tout dans l'ordre inverse.

**Dans le fil d'une session :**

`session_thread_main` (`0x1013d4`) prépare un petit contexte (le type de la session, sa poignée, deux compteurs) puis appelle `session_receive_loop` (`0x102178`). Celle-ci est la seule fonction du module qui appelle `svcReplyAndReceive`, et elle n'attend que sur une poignée : celle de son client. À chaque commande reçue elle appelle `hid_handle_command` (`0x102fc8`), puis renvoie la réponse et attend la suivante. Quand le client ferme la session (résultat `0xC920181A`), le fil referme ses cinq signaux et sa poignée, annule les activations de capteurs que ce client n'avait pas rendues, et marque sa case comme terminée.

| Notification | Gestionnaire | Adresse | Ce que fait le code |
| --- | --- | --- | --- |
| `0x100` | `on_terminate_notification` | `0x108d7c` | Lève le drapeau d'arrêt de `hid_main` |
| `0x104` | `on_sleep_or_shell_notification` | `0x108da0` | `stop_sampling`, puis `PTMSYSM_NotifySleepPreparationComplete` |
| `0x105` | le même | `0x108da0` | `start_sampling`, puis le même message à `ptm` |
| `0x213` | le même | `0x108da0` | Met l'octet `0x10c006` à 1 |
| `0x214` | le même | `0x108da0` | Met l'octet `0x10c006` à 0 |

Tant que `0x10c006` vaut 0, `update_pad_and_touch` efface le tactile et le pad circulaire et ne garde des boutons que les bits `0x2300`.

## Partie 3 : les commandes

Les quatre services partagent le même aiguillage, `hid_handle_command` (`0x102fc8`, 1 608 octets). Il lit l'en-tête dans le tampon du fil (à `+0x80` du stockage local), prend le numéro de commande dans les 16 bits du haut, et saute par une table de 25 adresses rangée à `0x102fec`. Les noms et les en-têtes de requête viennent de 3dbrew ; l'adresse, le service exigé et l'en-tête de réponse sont lus dans le code.

La colonne « Service » dit ce que le code vérifie : « SPVR » veut dire que la commande est refusée (`0xE0A04FEA`) si la session n'est pas de type 0, « NFC » qu'elle exige le type 3, « tous » qu'aucune vérification n'est faite.

| N° | En-tête de requête | Commande | Fonction | Adresse | Service | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010200` | CallibrateTouch | `hid_CalibrateTouch` | `0x10734c` | SPVR | `0x00010040` |
| 2 | `0x00020000` | UpdateTouchConfig | `hid_UpdateTouchConfig` | `0x1072e4` | SPVR | `0x00020040` |
| 3 | en-tête incomplet sur 3dbrew | sans nom | `hid_cmd0003` | `0x107340` | SPVR | `0x00030040` |
| 4 | `0x000400C0` | sans nom | `hid_cmd0004` | `0x1079dc` | SPVR | `0x00040040` |
| 5 | `0x00050000` | sans nom | `hid_cmd0005` | `0x107874` | SPVR | `0x00050040` |
| 6 | `0x00060000` | sans nom | `hid_cmd0006` | `0x1078fc` | SPVR | `0x00060040` |
| 7 | `0x00070140` | sans nom | `hid_cmd0007` | `0x1072ac` | SPVR | `0x00070040` |
| 8 | `0x00080000` | sans nom | `hid_cmd0008` | `0x1071c0` | SPVR | `0x00080040` |
| 9 | `0x00090000` | sans nom | `load_gyroscope_calibration` | `0x104be8` | SPVR | `0x00090040` |
| 10 | `0x000A0000` | GetIPCHandles | `hid_GetIPCHandles` | `0x1067a8` | tous | `0x000A0047` |
| 11 | `0x000B0000` | StartAnalogStickCalibration | `hid_StartAnalogStickCalibration` | `0x107608` | SPVR | `0x000B0040` |
| 12 | `0x000C0040` | StopAnalogStickCalibration | dans l'aiguillage | `0x103340` | SPVR | `0x000C0040` |
| 13 | `0x000D01C0` | SetAnalogStickCalibrateParam | dans l'aiguillage | `0x103398` | SPVR | `0x000D0040` |
| 14 | `0x000E0000` | GetAnalogStickCalibrateParam | `hid_GetAnalogStickCalibrateParam` | `0x107644` | SPVR | `0x000E0200` |
| 15 | en-tête incomplet sur 3dbrew | sans nom | `hid_cmd000F` | `0x10715c` | SPVR | `0x000F0040` |
| 16 | en-tête incomplet sur 3dbrew | sans nom | `hid_cmd0010` | `0x107138` | SPVR | `0x00100100` |
| 17 | `0x00110000` | EnableAccelerometer | `hid_EnableAccelerometer` | `0x106908` | tous | `0x00110040` |
| 18 | `0x00120000` | DisableAccelerometer | `hid_DisableAccelerometer` | `0x104780` | tous | `0x00120040` |
| 19 | `0x00130000` | EnableGyroscopeLow | `hid_EnableGyroscopeLow` | `0x106800` | tous | `0x00130040` |
| 20 | `0x00140000` | DisableGyroscopeLow | `hid_DisableGyroscopeLow` | `0x1046c8` | tous | `0x00140040` |
| 21 | `0x00150000` | GetGyroscopeLowRawToDpsCoefficient | dans l'aiguillage | `0x10355c` | tous | `0x00150080` |
| 22 | `0x00160000` | GetGyroscopeLowCalibrateParam | `hid_GetGyroscopeLowCalibrateParam` | `0x107258` | tous | `0x00160180` |
| 23 | `0x00170000` | GetSoundVolume | `mcu_get_sound_volume` | `0x1067f0` | tous | `0x00170080` |
| 24 | `0x00180040` | sans nom | dans l'aiguillage | `0x10362c` | NFC | `0x00180040` |

- L'aiguillage ne regarde que le numéro : le reste de l'en-tête n'est jamais vérifié. Un numéro inconnu rend `0xD900182F`.
- `hid:USER` et `hid:QTM` n'ont donc droit qu'aux commandes 10 et 17 à 23, ce qui est exactement la liste que 3dbrew donne pour `hid:USER`. `hid:SPVR` a tout sauf la 24. `hid:NFC` a les mêmes que `hid:USER`, plus la 24.
- Le nombre de paramètres lus par le code colle aux en-têtes de 3dbrew : 8 mots pour la commande 1, 3 pour la 4, 5 pour la 7, 1 pour la 12, 7 pour la 13.
- La commande 21 ne calcule rien : elle rend la constante `0x41660000`, le nombre flottant 14,375.
- La commande 22 ne rend pas l'étalonnage du gyroscope tel qu'il est gardé. `hid_GetGyroscopeLowCalibrateParam` recopie les neuf nombres de 16 bits de `0x10d12e` (pour chaque axe, le zéro puis deux valeurs de référence), mais l'aiguillage, de `0x103580` à `0x1035cc`, les range dans un autre ordre : le premier axe tel quel, puis **l'opposé** du zéro du troisième axe et ses deux valeurs, puis le deuxième axe. En numéros de nombres gardés : 0, 1, 2, −6, 7, 8, 3, 4, 5. Relevé par le [contrat des petits services](contrat-petits-services.md) et relu dans l'assembleur pour cette fiche ; c'est sans doute un changement de repère (interprété).
- La commande 23 ne fait que transmettre la question à `mcu::HID`.
- La commande 24 range un octet à `0x10c008`. Tant qu'il n'est pas nul, `update_pad_and_touch` efface les données de l'écran tactile. L'octet est remis à zéro quand la session `hid:NFC` se ferme.

Ce que font les commandes que 3dbrew ne nomme pas, lu dans le code :

| N° | Ce que fait le code |
| --- | --- |
| 3 | Recharge l'étalonnage tactile depuis le bloc de configuration `0x00040000` |
| 4 | Remplace l'étalonnage de l'accéléromètre en mémoire par les trois mots reçus |
| 5 | Écrit l'étalonnage de l'accéléromètre dans le bloc `0x00040003` |
| 6 | Recharge l'étalonnage de l'accéléromètre depuis le bloc `0x00040003` |
| 7 | Remplace l'étalonnage du gyroscope en mémoire (18 octets à `0x10d12e`) |
| 8 | Écrit l'étalonnage du gyroscope dans le bloc `0x00040002` |
| 9 | Recharge l'étalonnage du gyroscope depuis le bloc `0x00040002` |
| 15 | Règle trois paramètres de la conversion du pad circulaire en directions (`0x10c0e0`, `0x10c0e2`, `0x10c0e4`) |
| 16 | Rend ces trois paramètres |

Les commandes qui changent un étalonnage remettent à zéro l'en-tête de la section concernée de la mémoire partagée (`reset_pad_section`, `reset_touch_section`, `reset_accelerometer_section`, `reset_gyroscope_section`).

## Partie 4 : GetIPCHandles, pas à pas

C'est la commande qu'un jeu envoie en premier, et souvent la seule. Elle ne prend aucun paramètre.

1. **Six poignées vides.** L'aiguillage (à `0x103270`) prépare six emplacements, tous à zéro.
2. **La mémoire partagée.** `hid_GetIPCHandles` (`0x1067a8`) copie dans le premier la poignée du bloc de mémoire partagée, lue à `0x10cf44`.
3. **La case de la session.** `find_session_events` (`0x107fe0`) prend le verrou `0x10cb24` et parcourt les sept cases de `0x10cf50` à la recherche de celle qui est active et qui porte la poignée de cette session.
4. **Les cinq signaux.** Elle copie les cinq poignées rangées dans la case, de `+0x1C` à `+0x2C`, et rend le verrou. Si aucune case ne correspond, le résultat est `0xD8804FEF`.
5. **La réponse.** L'aiguillage écrit l'en-tête `0x000A0047`, le résultat, puis le mot `0x14000000`, qui dit au noyau « les six mots qui suivent sont des poignées à copier chez le client », puis les six poignées.

| Mot de la réponse | Contenu | Signalé par |
| --- | --- | --- |
| 0 | `0x000A0047` | |
| 1 | résultat | |
| 2 | `0x14000000` | |
| 3 | la mémoire partagée | |
| 4 | signal de la case à `+0x1C` | `update_pad_and_touch` |
| 5 | signal de la case à `+0x20` | `update_pad_and_touch` |
| 6 | signal de la case à `+0x24` | `update_accelerometer` |
| 7 | signal de la case à `+0x28` | `update_gyroscope` |
| 8 | signal de la case à `+0x2C` | `update_debug_pad` |

Les cinq signaux sont créés par `start_session_thread` à l'ouverture de la session, donc chaque client a les siens. Une session `hid:NFC` n'en reçoit pas : ses cinq emplacements restent à zéro.

Le jeu range ensuite la mémoire partagée dans son propre espace d'adresses et lit. Cette fiche disait qu'il « attend un des signaux » : c'est vrai d'un client en général, pas de Pokémon X. Le [contrat des petits services](contrat-petits-services.md) (partie 2) montre qu'il range les cinq signaux à l'ouverture et les referme à l'arrêt sans jamais attendre dessus : il lit la mémoire partagée à son propre rythme, et ne prend que la dernière entrée des boutons et du tactile. La bibliothèque `hid` du jeu (`0x1ecb00` à `0x1ef5e0`) ne contient aucun appel système d'attente : relu pour cette fiche, on n'y trouve que des `svc 0x23` (fermeture de poignée), `0x28` (lecture de l'horloge) et `0x32` (envoi de commande).

## Partie 5 : la mémoire partagée

**La création.** `init_shared_memory` (`0x1014ec`) appelle `create_shared_memory_block` (`0x101fa0`), la seule fonction qui appelle `svcCreateMemoryBlock`. Elle demande 0x2B0 octets, arrondis à une page de 0x1000, en lecture et écriture pour `hid` et en lecture seule pour les autres. `map_shared_memory` (`0x102e94`) projette ensuite le bloc dans `hid` lui-même, à une adresse prise entre `0x10000000` et `0x14000000`. L'objet qui décrit le bloc est à `0x10cf30` : l'adresse projetée à `+0x08`, la poignée à `+0x14`.

**La disposition.** `init_shared_memory` découpe le bloc en cinq sections et range un pointeur vers chacune.

| Décalage | Section | Pointeur | En-tête | Entrées | Écrite par |
| --- | --- | --- | --- | --- | --- |
| `0x000` | boutons et pad circulaire | `0x10c01c` | 0x28 octets | 8 de 0x10 octets | `write_pad_entry` (`0x106aa8`) |
| `0x0A8` | écran tactile | `0x10c020` | 0x20 octets | 8 de 8 octets | `write_touch_entry` (`0x106d4c`) |
| `0x108` | accéléromètre | `0x10c024` | 0x20 octets | 8 de 6 octets | `write_accelerometer_entry` (`0x106f58`) |
| `0x158` | gyroscope | `0x10c028` | 0x20 octets | 32 de 6 octets | `write_gyroscope_entry` (`0x106e50`) |
| `0x238` | pad de débogage | `0x10c02c` | 0x18 octets | 8 de 12 octets | `write_debug_pad_entry` (`0x106bd4`) |

Le total fait bien 0x2B0. Chaque section est un anneau : la fonction d'écriture avance d'une entrée à chaque lecture du capteur et revient à la première après la dernière.

**Le début commun à chaque section :**

| Décalage | Contenu |
| --- | --- |
| `+0x00` | l'heure du système (64 bits), notée quand l'écriture revient à l'entrée 0 |
| `+0x08` | l'heure précédente |
| `+0x10` | le numéro de la dernière entrée écrite |

`reset_section_header` (`0x104ef0`) met ces cinq mots à `0xFFFFFFFF`.

**La section des boutons, en plus :**

| Décalage | Contenu |
| --- | --- |
| `+0x18` | un nombre flottant, le même que celui écrit à `0x1FF81080` (la position du curseur 3D) |
| `+0x1C` | l'état brut des boutons |
| `+0x20`, `+0x22` | la position brute du pad circulaire, X puis Y |
| `+0x28` | les 8 entrées : boutons tenus, boutons qui viennent d'être pressés, boutons relâchés (4 octets chacun), puis X et Y du pad circulaire (2 octets chacun) |

Les autres sections gardent à `+0x18` la dernière valeur brute du capteur. Une entrée tactile contient X, Y (2 octets chacun) et un octet « touché ». Une entrée d'accéléromètre ou de gyroscope contient trois valeurs de 2 octets.

**Recoupé de l'autre côté.** Le [contrat des petits services](contrat-petits-services.md) (partie 2) a lu les quatre lecteurs de Pokémon X (`hid_read_pad_ring`, `hid_read_touch_ring`, `hid_read_accelerometer_ring`, `hid_read_gyroscope_ring`, de `0x2cd3ec` à `0x2cd8a8` dans le jeu). Ils retrouvent exactement ce tableau : les cinq décalages, les tailles d'en-tête, le nombre et la taille des entrées, et un numéro négatif qui veut dire « rien d'écrit », l'état que pose `reset_section_header`. Ils se servent de l'heure et du numéro de l'en-tête comme d'un numéro de tour, et recommencent leur copie si l'un des trois a changé pendant qu'ils lisaient : c'est ce qui tient lieu de verrou entre `hid` et le jeu. Aucun ne lit les champs propres à la section des boutons (`+0x18`, `+0x1C`, `+0x20`), et rien ne lit la section du pad de débogage.

**Qui écrit l'état des boutons.** `update_pad_and_touch` (`0x1037d0`, 872 octets), toutes les 4 ms :

1. `CDCHID_GetData` (`0x106a74`) rend deux mots : le tactile brut et le pad circulaire brut.
2. La minuterie est réarmée pour 4 ms.
3. `convert_touch_position` (`0x1073dc`) et `convert_circle_pad` (`0x1076c8`) appliquent les étalonnages.
4. `read_buttons` (`0x107a24`) lit le registre matériel `0x1EC46000` (12 boutons, inversés), y ajoute deux bits venus de `GPIOHID_GetData`, puis `add_circle_pad_directions` (`0x104958`) ajoute les quatre bits du haut quand le pad circulaire est poussé. Elle en tire les trois mots de l'entrée : tenus, pressés, relâchés.
5. Une fois sur trois, `MCUHID_GetRaw3DSliderPosition` lit le curseur 3D, `update_3d_slider` (`0x107060`) le convertit, et le résultat est écrit à `0x1FF81080`.
6. `write_touch_entry` puis `write_pad_entry` écrivent dans la mémoire partagée.
7. Sous le verrou `0x10cb24`, les deux premiers signaux de chaque session active sont déclenchés.

## Partie 6 : les services que hid appelle

Chaque requête envoyée à un autre service a sa petite fonction, qui écrit un en-tête et appelle `SendSyncRequest`. Il y en a 35, autant que d'appels à `SendSyncRequest` dans le code. Les noms viennent de 3dbrew quand la commande y est nommée. La dernière colonne est déduite de l'endroit d'où la fonction est appelée.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x10c140` | `0x00010002` | `SRV_RegisterClient` | `0x1018a4` | Se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x1018e0` | Obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x100fd0` | Créer ses propres services |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x10102c` | Les retirer à l'arrêt |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x1025dc` | Ouvrir les six services ci-dessous |
| | | `0x00090040` | `SRV_Subscribe` | `0x105af8` | S'abonner à quatre notifications |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x10191c` | Lire le numéro de la notification arrivée |
| `ptm:s` | `0x10cae0` | `0x040A0000` | `PTMSYSM_CheckNew3DS` | `0x10259c` | Savoir si la console est une New 3DS |
| | | `0x04030042` | `PTMSYSM_NotifySleepPreparationComplete` | `0x108d3c` (enrobage `ptm_notify_sleep_preparation_complete`, `0x108d34`) | Dire à `ptm` que `hid` est prêt pour la veille |
| `cfg:s` | `0x10caf0` | `0x04010082` | `CFG_GetConfigInfoBlk8` | `0x106720` | Lire les étalonnages |
| | | `0x04020082` | `CFG_SetConfigInfoBlk4` | `0x10845c` | Écrire un étalonnage |
| | | `0x04030000` | `CFG_UpdateConfigNANDSavegame` | `0x1084a8` | Enregistrer la configuration |
| `cdc:HID` | `0x10c030` | `0x00010000` | `CDCHID_GetData` | `0x106a74` | Lire le tactile et le pad circulaire |
| | | `0x00020000` | `CDCHID_Initialize` | `0x104ec8` | Au début de la lecture |
| | | `0x00030000` | `CDCHID_Finalize` | `0x102784` | À l'arrêt de la lecture |
| `mcu::HID` | `0x10c038` | `0x00010040` | `MCUHID_cmd0001` | `0x105468` | Envoyé avec 1 au démarrage, 0 à l'arrêt |
| | | `0x00060000` | `MCUHID_cmd0006` | `0x10693c` | Lire les trois valeurs de l'accéléromètre |
| | | `0x00070000` | `MCUHID_GetRaw3DSliderPosition` | `0x1069a8` | Lire le curseur 3D |
| | | `0x000C0000` | `MCUHID_GetMcuHidEventHandle` | `0x1017dc` | Obtenir le signal du microcontrôleur |
| | | `0x000D0000` | `MCUHID_GetMcuHidEventReason` | `0x106974` | Savoir pourquoi il a sonné |
| | | `0x000E0000` | `MCUHID_GetSoundVolume` | `0x1080fc` | Répondre à la commande 23 |
| | | `0x000F0040` | `MCUHID_EnableAccelerometerInterrupt` | `0x1054a0` | Allumer ou éteindre l'accéléromètre |
| `gpio:HID` | `0x10c104` | `0x00020080` | `GPIOHID_SetDirection` | `0x102638` | Préparer la broche du gyroscope |
| | | `0x00040080` | `GPIOHID_SetEdge` | `0x102714` | idem |
| | | `0x00060080` | `GPIOHID_SetInterruptEnable` | `0x10274c` | idem |
| | | `0x00070040` | `GPIOHID_GetData` | `0x104a5c` | Lire deux bits ajoutés aux boutons |
| | | `0x00090082` | `GPIOHID_BindInterrupt` | `0x102670` | Lier l'interruption du gyroscope à un signal |
| | | `0x000A0042` | `GPIOHID_UnbindInterrupt` | `0x1026c4` | La délier à l'arrêt |
| `i2c::HID` | `0x10c040` | `0x000200C0` | `I2CHID_EnableRegisterBits8` | `0x1048c8` | Régler le gyroscope |
| | | `0x000300C0` | `I2CHID_DisableRegisterBits8` | `0x104910` | idem |
| | | `0x000500C0` | `I2CHID_WriteRegister8` | `0x103fbc` | idem |
| | | `0x000D00C0` | `I2CHID_ReadRegisterBuffer8` | `0x108090` | Lire les 6 octets du gyroscope |
| | | `0x000E00C2` | `I2CHID_WriteRegisterBuffer` | `0x104004` | Mettre en route le pad de débogage |
| | | `0x000F00C0` | `I2CHID_ReadRegisterBuffer` | `0x105f20` | Lire le pad de débogage |
| `err:f` (port) | `0x10c100` | `0x00010800` | `ERRF_Throw` | `0x106770` | Signaler une erreur fatale |

Deux écarts avec la Carte des services, à vérifier :
- Elle donne `0x00010042` et `0x00020042` pour les deux premières commandes de `cdc:HID` ; le code envoie `0x00010000` et `0x00020000`.
- Elle nomme la commande `0x00060000` de `mcu::HID` « ReadGyroscopeValues » ; ici son résultat va dans la section de l'accéléromètre, et le gyroscope est lu par `i2c::HID`. Elle garde donc le nom neutre `MCUHID_cmd0006`.

Les blocs de configuration lus au démarrage :

| Bloc | Taille | Fonction | Adresse | Contenu |
| --- | --- | --- | --- | --- |
| `0x00040000` | 0x10 | `load_touch_calibration` | `0x104b44` | étalonnage tactile |
| `0x00040001` | 0x1C | `load_analog_stick_calibration` | `0x101ab4` | étalonnage du pad circulaire |
| `0x00040002` | 0x12 | `load_gyroscope_calibration` | `0x104be8` | étalonnage du gyroscope |
| `0x00040003` | 0x0C | `init_accelerometer_calibration` | `0x101c58` | étalonnage de l'accéléromètre |
| `0x00120000` | 8 | `load_3d_slider_bounds` | `0x10198c` | bornes du curseur 3D |

Chacune a des valeurs de secours si la lecture échoue.

## Partie 7 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x10c088` | 1 si la console est une New 3DS |
| `0x10c098` et `0x10c09c` | nombre de services (2 ou 4) et nombre de poignées attendues par `hid_main` (3 ou 5) |
| `0x10d0b0` | les quatre pointeurs vers les noms de services |
| `0x10d0d0` | drapeau d'arrêt de `hid_main` |
| `0x10cf30` | l'objet « mémoire partagée » (adresse à `+0x08`, poignée à `+0x14`) |
| `0x10c01c` à `0x10c02c` | les cinq pointeurs vers les sections |
| `0x10cf50` | les 7 cases de session, 0x30 octets chacune |
| `0x10cb24` | le verrou qui protège ces cases |
| `0x10c048`, `0x10c050`, `0x10c054` | les minuteries : pad, pad de débogage, battement (New 3DS) |
| `0x10c04c`, `0x10c058` | les signaux : microcontrôleur, interruption du gyroscope |
| `0x10c064`, `0x10c06c`, `0x10c074` | les trois fils de lecture |
| `0x10c010`, `0x10c00c` | combien de fois l'accéléromètre et le gyroscope ont été activés |
| `0x10c006`, `0x10c008` | les deux octets qui font effacer des données (notifications `0x213` et `0x214`, commande 24) |
| `0x10d0a0` | l'objet « gyroscope » |
| `0x10d228` | la liste des gestionnaires de notifications |

Une case de session :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | état : 0 libre, 1 active, 2 terminée (son fil reste à récupérer) |
| `+0x01` | type de la session (0 à 3) |
| `+0x04` | le fil de la session |
| `+0x0C` | la poignée de la session |
| `+0x18` | combien de fois ce client a activé le gyroscope |
| `+0x1C` à `+0x2C` | les cinq signaux |

Les compteurs expliquent les commandes 17 à 20 : le capteur n'est allumé qu'au premier Enable et éteint qu'au dernier Disable, tous clients confondus.

## Partie 8 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x1011ac` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x100178` |
| CreateThread | `0x08` | `svcCreateThread` | `0x102d2c` |
| `svcExitThread` (`0x107d30`) | `0x09` | dans `thread_trampoline` | `0x107cec` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x107d38` |
| CreateMutex | `0x13` | `svcCreateMutex` | `0x108860` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x101f88` |
| SignalEvent | `0x18` | écrit sur place, à six endroits | |
| ClearEvent | `0x19` | dans `hid_DisableGyroscopeLow` | `0x1046c8` |
| CreateTimer | `0x1A` | `svcCreateTimer` | `0x1057d0` |
| SetTimer | `0x1B` | `svcSetTimer` | `0x104eb0` |
| CancelTimer | `0x1C` | trois fois dans `stop_sampling` | `0x105114` |
| CreateMemoryBlock | `0x1E` | `svcCreateMemoryBlock` | `0x102d10` |
| MapMemoryBlock | `0x1F` | dans `map_shared_memory` | `0x102e94` |
| UnmapMemoryBlock | `0x20` | dans `unmap_shared_memory` | `0x1012c8` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x101f70` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x103fa4` |
| CloseHandle | `0x23` | écrit sur place, à 38 endroits | |
| WaitSynchronization1 | `0x24` | écrit sur place, à 12 endroits | |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x105ad4` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x108878` |
| GetSystemTick | `0x28` | écrit sur place, à 14 endroits | |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x102d50` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x102cf8` |
| SendSyncRequest | `0x32` | écrit sur place, à 35 endroits | |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x10625c` |
| Break | `0x3C` | `svcBreak`, atteint par le `b` de `break_process` (`0x1050dc`) | `0x107ce4` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x1006c0` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x102d6c` |

Les verrous du module (`lock_enter` à `0x105430`, `lock_leave` à `0x10533c`) reposent sur `ArbitrateAddress`, comme dans `sm`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 24 numéros de commande, leur fonction et leur en-tête de réponse : le pseudo-code de REA d'un côté ; de l'autre la table de 25 adresses lue à la main à `0x102fec`, les sauts relevés par un script dans chaque morceau, et les constantes rangées à la fin de la fonction.
- Les en-têtes de requête de 3dbrew tombent sur les mêmes numéros, et le nombre de paramètres que le code lit colle à cinq d'entre eux.
- La chaîne du serveur : `svcReplyAndReceive` n'a qu'un appelant (`session_receive_loop`), qui n'en a qu'un (`session_thread_main`), et `hid_handle_command` n'a qu'un appelant. Vu par REA et par le script qui relève les sauts.
- La chaîne de la mémoire partagée : `svcCreateMemoryBlock`, `create_shared_memory_block` et `init_shared_memory` n'ont chacune qu'un appelant.
- La taille 0x2B0 : c'est l'argument passé à la création, et c'est la somme des cinq sections telles que les fonctions d'écriture les parcourent.
- Les services appelés : l'exheader autorise six noms (`gpio:HID`, `cdc:HID`, `mcu::HID`, `i2c::HID`, `cfg:s`, `ptm:s`), et ce sont les six que le code ouvre. Les 35 fonctions de requête correspondent aux 35 appels à `SendSyncRequest`.
- Le registre `0x1EC46000` : lu dans `read_buttons`, et l'exheader demande justement au noyau de projeter cette page (descripteur `0xFFE1EC46`).
- Les quatre sortes de fils : `svcCreateThread` n'est appelé qu'à un endroit, et les fonctions au-dessus n'ont en tout que quatre appels.
- Les sept commandes de `hid:USER` que Pokémon X envoie (10, 17 à 22) : requête et réponse lues dans le jeu et dans l'aiguillage ([contrat des petits services](contrat-petits-services.md), partie 2). Les mots s'emboîtent ; la disposition de la mémoire partagée est la même vue des deux côtés (partie 5).
- L'ordre dans lequel l'aiguillage rend l'étalonnage du gyroscope (commande 22) : le contrat, et l'assembleur de `0x103580` à `0x1035cc`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens des notifications : `0x104` et `0x105` pour la veille et le réveil, `0x213` et `0x214` pour le couvercle. Depuis, la fiche de `ptm` confirme les deux premières (c'est `ptm` qui les publie, à l'entrée en veille et au réveil, et qui attend la réponse de chaque abonné) et le sens des deux autres (ouvert pour `0x213`, fermé pour `0x214`) ; ce n'est pas `ptm` qui publie ces deux-là, et la fiche de `ns` montre `ns` publier `0x214`. Le code montre seulement ce qu'il en fait ; ces numéros ne sont pas dans la Carte des services.
- Le contenu des en-têtes de section (heure, numéro d'entrée) : Ghidra ne montre pas la valeur que rend `GetSystemTick`, seulement que l'appel est juste avant l'écriture.
- Le nombre flottant de la section des boutons vu comme la position du curseur 3D.
- Ce que font les neuf commandes sans nom, et la commande 24 de `hid:NFC`.
- L'échange d'axes de la commande 22 vu comme un changement de repère entre le capteur et le client.
- « Pokémon X n'attend sur aucun des cinq signaux » : aucun appel d'attente dans sa bibliothèque `hid` ; une attente ailleurs, à travers un lecteur, n'est pas exclue.
- Les priorités des fils. Le code passe des constantes codées (`0x6C8DA514` pour une session) qu'une soustraction ramène à `0x14` ; `0x15` pour le fil de lecture, `0x0E` et `0x0F` pour les deux fils de la New 3DS, `0x0E` pour une session `hid:QTM`. Ces trois derniers sont demandés sur le processeur 3.
- Le tas de `0x5000` ou `0x9000` octets vu comme la réserve des piles de fils, de `0x1000` octets chacune.
- Le gyroscope : `gyroscope_init` (`0x101e08`) essaie trois modèles, sur les périphériques 10, 11 puis 9 du bus. Le pad de débogage est le périphérique 12.
- Le rôle de la minuterie de battement de la New 3DS : le fil de lecture surveille à chaque réveil que le gyroscope répond encore.
- Le sens des codes d'erreur `0xE0A04FEA` (mauvais service), `0xD8804FEF` (session introuvable) et `0xE0E04FEE` (étalonnage tactile refusé).
- La disposition d'une case de session.

**Pas lu**
- Deux fonctions du pad de débogage (`0x102834`, appelée à sa mise en route, et `0x106070`, appelée à chaque lecture) et la remise en route du gyroscope (`0x1060d8`, `0x107ad8`, `0x108290`).
- Le calcul de l'étalonnage de l'accéléromètre (`0x108130`, `0x108228`).
- Les fonctions de calcul (`0x104060`, `0x104698`) et la réserve de mémoire (`0x107f7c`, `0x1083b8`, `0x1084e0`, `0x10867c`).
- Le détail des 22 petites fonctions d'initialisation des objets globaux : seules celles qui touchent aux tables de la partie 7 ont été regardées.
- 113 fonctions de `funcs.tsv` sans nom, plus 18 manquées.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système et nommer leurs enveloppes | `outils/prescan.py` | déjà fait |
| Décompiler les 303 (321 avec les 18 entrées manquées) fonctions d'un coup | REA, outil `batch_decompile` | 5 secondes |
| Calculer qui appelle qui, lire la table de l'aiguillage, relever les sauts | des scripts Python sur `code.bin` | immédiat |
| Lire le pseudo-code et nommer | Claude | le gros du temps |
| Recharger les noms dans Ghidra | arrêt et relance du pont REA | une à deux minutes, deux fois |
| Recouper avec la Carte des services et l'exheader | un script | immédiat |

**Le piège rencontré.** Ghidra n'avait pas vu 22 des 23 fonctions d'initialisation des objets globaux. La table qui les appelle (`0x10b288`) ne contient pas des adresses mais des distances : chaque case dit « la fonction est à tant d'octets de moi ». Le balayage des pointeurs fait pour `sm` ne peut donc pas les trouver. Il a fallu décoder la table à la main et donner les 22 adresses en graines. Avec trois autres morceaux de code orphelins (`svcDuplicateHandle` à `0x108878`, une fin de fonction partagée à `0x1025dc`, un saut à `0x108890`), Ghidra est passé de 276 à 301 fonctions.

**Deux autres choses à savoir en relisant dans Ghidra.**
- La graine `0x102fc4`, juste avant l'aiguillage, n'est pas le début de l'aiguillage : c'est une instruction isolée qui appelle `break_process` et ne revient jamais. Ghidra croit qu'elle continue dans la fonction suivante et affiche deux fois le même pseudo-code. Le vrai début est `0x102fc8`.
- La fonction à `0x100128` est en Thumb, et le nom qu'on lui donne dans le fichier de graines ne prend pas. Elle n'a donc pas de ligne dans `hid.noms.tsv` : à nommer à la main (`run_static_initializers`).

**Pour reprendre.** `hid.noms.tsv` est le fichier de graines : une adresse, `function`, un nom. Les noms en majuscules (`SRV_`, `MCUHID_`, `CFG_`…) sont les requêtes que `hid` envoie à un autre service ; ceux en `hid_` sont les commandes qu'il reçoit. Le pseudo-code brut et les scripts de recoupement sont dans `local/analyse/hid/`, non versionné.
