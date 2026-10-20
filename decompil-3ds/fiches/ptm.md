# ptm, la batterie, le couvercle et la veille

`ptm` répond aux questions « quel est le niveau de la batterie ? », « le chargeur est-il branché ? », « le couvercle est-il ouvert ? ». Il tient aussi le podomètre, le journal du temps de jeu, les alarmes et l'heure du système. Surtout, c'est lui qui conduit la mise en veille, l'extinction et le redémarrage de la console : il prévient les autres modules par des notifications, attend leur accord, puis demande au noyau d'endormir la machine. Il ne touche jamais au matériel lui-même : tout passe par le service `mcu::RTC` du microcontrôleur.

Fiche du 13 octobre 2026, produite avec REA et Ghidra sur le module dumpé de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020002202`, la version New 3DS du module, un titre de la CTRNAND (lu dans l'exheader) |
| Fichier lu | `local/extrait/ptm/exefs/code.elf` |
| Taille | 50 416 octets de code, 2 212 de données en lecture seule, 1 168 de données, 13 596 de mémoire à zéro |
| Jeu d'instructions | Thumb presque partout : 746 fonctions Thumb et 67 ARM (le démarrage, les appels système, les calculs) |
| Fonctions | 813 pour Ghidra lancé avec des graines Thumb (663 par le pont REA seul), plus 2 entrées manquées (815 ; la troisième entrée de couverture.py, 0x105620, est un morceau de la division, dans ptm.hors-compte.tsv) ; 322 nommées dans ptm.noms.tsv, 815 avec local/analyse/ptm/noms-proposes.tsv |
| Services offerts | `ptm:u`, `ptm:sysm`, `ptm:s`, `ptm:play`, `ptm:gets`, `ptm:sets` : cinq aiguillages, 49 commandes au plus |
| Services appelés | `mcu::RTC`, `pdn:s`, `pxi:mc`, `pm:app`, `cfg:s`, `fs:USER`, plus `srv:` et le port `err:f` |
| Dépendances déclarées | `cfg` (`0004013000001702`), `gpio` (`…1B02`), `i2c` (`…1E02`), `mcu` (`…1F02`), `pdn` (`…2102`), `spi` (`…2302`) |
| Fils | le fil principal (toutes les commandes), le fil d'alimentation (veille, extinction, redémarrage), le fil du journal de jeu |
| Fichiers | la sauvegarde système `0x00010022`, montée sous le nom `ptmdb:`, avec `Pedometer.dat` et `PlayHistory.dat` |

## Partie 1 : le démarrage et les fils

`entry` (`0x100000`) appelle sept fonctions à la suite, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de `0x10e490` à `0x1119ac`.
2. `init_program_args` (`0x100070`) : les tables de `_get_lc_ctype` et `_get_lc_numeric`.
3. `init_runtime_and_srv` (`0x1000b4`) prépare les verrous (`init_runtime`, `0x1000c0`), puis `srv_init` (`0x107378`) se connecte au port `srv:` et s'y déclare (`SRV_RegisterClient`).
4. `setup_heap` (`0x1000a8`) réserve un tas de `0x1000` octets à `0x08000000` (`set_heap_size`, `0x1003ec`).
5. `run_static_initializers` (`0x1087b4`) appelle les 29 fonctions d'initialisation des objets globaux, par la table de distances de `0x10d830` à `0x10d8a4`. La plus grosse, `init_globals` (`0x10b110`), remplit la table des services et range les adresses des objets de la partie 8.
6. `run_init_array` (`0x100054`) parcourt une seconde table, vide dans ce module (`0x10d8a4` à `0x10d8a4`).
7. `call_main` (`0x100048`) appelle `ptm_main` (`0x100100`) : tout le reste.

`ptm_main` enregistre les six services, puis appelle `ptm_initialize` (`0x1007ec`), qui fait dans l'ordre :

1. `fs_init` (`0x100db4`) ouvre `fs:USER`, puis la sauvegarde système `0x00010022` est montée sous le nom `ptmdb:`. Si le montage échoue, le code la crée ou la recrée (`create_system_save`, `delete_system_save`) : ce chemin n'est pas détaillé ici.
2. `pmapp_init` (`0x1018c4`) ouvre `pm:app`, puis `pdn:s` et `mcu::RTC` sont ouverts. La poignée de `mcu::RTC` est rangée à `0x10e28c` et recopiée à `0x10e290`.
3. `MCURTC_GetInfoRegisters` lit dix octets ; le premier, passé par une table de sept cas, donne trois octets écrits dans la page partagée à `0x1FF81004`, `0x1FF81005` et `0x1FF81006`. Le bloc de configuration `0x000F0004` est relu et corrigé s'il ne dit pas la même chose.
4. `power_manager_init` (`0x101104`) ouvre `pxi:mc`, crée le fil d'alimentation et inscrit le gestionnaire de la notification `0x179`.
5. `MCURTC_GetPowerEventHandle` rend le signal que le microcontrôleur déclenche pour la batterie, le chargeur et l'alarme (rangé à `0x10e294`).
6. `alarm_manager_init`, `pedometer_init` (qui demande l'état du couvercle au microcontrôleur) et `play_history_init` (qui crée le fil du journal).
7. Trois gestionnaires de notifications sont inscrits : `0x214`, `0x213`, `0x20C` (partie 4).
8. `apply_config_to_mcu` (`0x101bb4`) recopie des réglages de `cfg` dans le microcontrôleur : scintillement des deux écrans (bloc `0x00050000`), correction de l'horloge (bloc `0x00030000`), bornes du curseur de volume (bloc `0x00120000`).
9. Les minuteries d'un jour et de 10 secondes sont créées (celle d'une heure l'a été plus haut, par `start_hourly_timer`, `0x101720`), puis `sync_lgy_lcd_data`, `sync_friend_code_counter` et `sync_uuid_clock_sequence` comparent trois valeurs gardées à la fois dans `cfg` et dans le microcontrôleur.
10. `refresh_adapter_state`, `refresh_charge_state` et `refresh_battery_level` écrivent l'état de la batterie dans la page partagée (partie 6).

Les fils passent par `create_thread_impl` (`0x102e5c`), la seule fonction qui appelle `svcCreateThread`, et commencent dans `thread_trampoline` (`0x1039e4`), qui appelle la vraie fonction du fil puis `svcExitThread`.

| Fil | Fonction | Adresse | Créé par | Ce qu'il fait |
| --- | --- | --- | --- | --- |
| Principal | `ptm_main` | `0x100100` | le noyau | Sert les six services, les notifications et quatre signaux |
| Alimentation | `power_thread_main`, puis `power_thread_loop` | `0x10269a`, `0x103190` | `power_manager_init` | Attend un message : 1 pour la veille, 2 pour l'extinction, 3 pour le redémarrage, 0 pour s'arrêter |
| Journal de jeu | `play_history_thread_main` | `0x102710` | `play_history_init` | Reçoit les événements de jeu par une file et les écrit dans `PlayHistory.dat` |

Le fil d'alimentation existe pour une raison simple : une mise en veille attend les réponses des autres modules, et ces réponses arrivent par des commandes que seul le fil principal peut servir. Le fil principal ne doit donc jamais attendre lui-même.

Les trois minuteries du fil principal :

| Poignée | Période | À chaque battement |
| --- | --- | --- |
| `0x10e298` | 86 400 secondes (la constante `0x4E94914F0000` nanosecondes posée par `init_globals`) | Le podomètre relit les compteurs de pas du microcontrôleur (`0x106bc0`) |
| `0x10e2a4` | 10 secondes | Un compteur avance de 2 ; arrivé à 30, `store_heartbeat_record_in_mcu` range l'heure courante dans les registres libres du microcontrôleur. À chaque fois, `refresh_battery_level` |
| `0x10e4f4` | 3 600 000 millisecondes | `on_hourly_timer` (`0x1029c8`) relit l'horloge du microcontrôleur et, si l'écart avec l'heure du système reste dans les bornes, envoie l'heure à `pxi:mc` |

## Partie 2 : la boucle de service

Comme dans `sm`, une seule boucle sert tout : elle est dans `ptm_main`, la seule fonction qui appelle `svcReplyAndReceive` et `svcAcceptSession`.

1. **Les services.** La table de `0x10e2c8` a six entrées de 8 octets : un pointeur vers le nom et le nombre de sessions permises. Pour chacune, `SRV_RegisterService` (`0x100604`) rend un port, rangé à partir de `0x11191c`.
2. **Les notifications.** `on_terminate_notification` est inscrit pour `0x100`, `srv_enable_notification` (`0x10053c`) obtient le sémaphore des notifications, et `SRV_Subscribe` (`0x10722c`) abonne le module à `0x213`, `0x214` et `0x20C`.
3. **La liste des poignées.** Elle est à `0x111908`, son compteur à `0x10e440`. Elle a 41 cases : 11 fixes, puis 30 sessions au plus.

| Rang | Poignée | Quand elle sonne |
| --- | --- | --- |
| 0 | le sémaphore des notifications | `handle_srv_notification` (`0x100558`) lit le numéro par `SRV_ReceiveNotification` et appelle le gestionnaire inscrit |
| 1 | le signal du microcontrôleur (`0x10e294`) | `handle_main_event` (`0x10069c`), cas 0 : voir plus bas |
| 2 | la minuterie d'un jour (`0x10e298`) | `handle_main_event`, cas 1 |
| 3 | la minuterie de 10 secondes (`0x10e2a4`) | `handle_main_event`, cas 2 |
| 4 | la minuterie d'une heure (`0x10e4f4`) | `handle_main_event`, cas 3 |
| 5 à 10 | les six ports | `svcAcceptSession` ouvre la session ; le rang donne le type : 0 `ptm:sysm`, 1 `ptm:s`, 2 `ptm:u`, 3 `ptm:sets`, 4 `ptm:play`, 5 `ptm:gets` |
| 11 à 40 | les sessions | une commande est arrivée |

4. **Une nouvelle session.** La boucle demande un contexte à l'objet du service (table `0x10d080`, méthode à `+8` de sa table de méthodes) et range le couple « type, contexte » dans la table des sessions (`0x111754`, 8 octets par session). Cinq services partagent la même réserve de contextes (`0x1100a8`, `session_context_alloc`) ; `ptm:sets` a la sienne (`0x10e2c0`) et une seule session. Au-delà de 30 sessions ouvertes, la nouvelle est refermée aussitôt.
5. **Une commande.** La boucle appelle l'aiguillage du type de la session, par la table de six adresses à `0x10d068`, en lui passant le contexte. La réponse part au prochain tour, avec le `svcReplyAndReceive` suivant.
6. **Une session qui se ferme** (résultat `0xC920181A`) : `close_session` (`0x100d1c`) ferme la poignée, rend le contexte et bouche le trou avec la dernière session de la liste.
7. **La sortie.** La notification `0x100` met l'octet `0x10e44c` à 1. Quand il vaut 1 et qu'il ne reste aucune session, la boucle retire les six services (`SRV_UnregisterService`), appelle `ptm_finalize` (`0x100c10`) et `srv_exit`.

**Le signal du microcontrôleur** (rang 1). `handle_main_event` lit par `MCURTC_GetPowerInterruptHistory` (`0x00250000`) les événements arrivés depuis la dernière fois, un bit par événement. Il ne le fait que s'il obtient sans attendre le verrou de l'objet « alimentation » (`+0x1C4`, soit `0x10ea5c`), que `sleep_sequence` tient pendant qu'elle prépare la veille.

| Bit | Ce que fait le code |
| --- | --- |
| 1 | `request_shutdown` avec un délai de 11 secondes |
| 8 ou 9 | `refresh_adapter_state` |
| 10 | `on_rtc_alarm_event` (`0x101258`) |
| 13 | `get_battery_level_class` relit la batterie : à 0 %, `request_shutdown` avec un délai de 14 secondes ; de 1 à 5 %, notification `0x211` ; à 6 % et plus, notification `0x212` |
| 14 ou 15 | `refresh_charge_state` |

Ce sont exactement les sept événements que 3dbrew donne pour ce signal (« MCU notifications 1, 8, 9, 10, 13, 14 and 15 signal this »). Les événements du couvercle n'en font pas partie : `ptm` les apprend par les notifications `0x213` et `0x214`.

## Partie 3 : les commandes

Chaque aiguillage lit l'en-tête dans le tampon du fil (à `+0x80` du stockage local), en tire le numéro de commande (les 16 bits du haut, par `bitfield_extract`) et saute à l'aide d'une petite fonction du compilateur (`0x106ed8`) suivie, dans le code, d'une table d'un octet par cas. Les noms et les en-têtes de requête viennent de 3dbrew ; l'adresse et l'en-tête de réponse sont lus dans le code et retrouvés en faisant tourner chaque aiguillage dans un émulateur.

**Qui a droit à quoi.** Il n'y a pas de contrôle de droits à l'intérieur d'un aiguillage : c'est le service ouvert qui choisit l'aiguillage.

| Service | Type | Aiguillage | Adresse | Commandes |
| --- | --- | --- | --- | --- |
| `ptm:sysm`, `ptm:s` | 0, 1 | `ptmsysm_handle_command` | `0x109d38` | `0x0001` à `0x000F`, `0x0401` à `0x040A`, `0x0801` à `0x0818` |
| `ptm:u` | 2 | `ptmu_handle_command` | `0x109a50` | `0x0001` à `0x000F` |
| `ptm:sets` | 3 | `ptmsets_handle_command` | `0x10a8dc` | `0x0001` seulement, et ce n'est pas la même que celle de `ptm:u` |
| `ptm:play` | 4 | `ptmplay_handle_command` | `0x10a930` | `0x0001` à `0x000F`, `0x0807`, `0x0808`, `0x0809`, `0x080B` |
| `ptm:gets` | 5 | `ptmgets_handle_command` | `0x10a5b0` | `0x0001` à `0x000F`, `0x0401`, qui n'est pas non plus celle de `ptm:sysm` |

C'est la liste que 3dbrew donne pour chaque service, à deux commandes près (`0x0816` et `0x0817`, absentes de son tableau). Un numéro inconnu rend `0xD900182F`, un en-tête mal formé `0xD9001830`, dans une réponse d'en-tête `0x00000040`.

**Les quinze commandes communes** (`ptm:u`, et les mêmes fonctions dans les aiguillages de `ptm:sysm`, `ptm:s`, `ptm:play` et `ptm:gets`). « Vérifié » veut dire que le code compare l'en-tête reçu à cette valeur exacte ; les autres commandes ne regardent que le numéro.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x00010002` (vérifié) | RegisterAlarmClient | `ptm_RegisterAlarmClient` | `0x104d78` | `0x00010040` |
| `0x0002` | `0x00020080` | SetRtcAlarm | `ptm_SetRtcAlarm` | `0x104d6c` | `0x00020040` |
| `0x0003` | `0x00030000` | GetRtcAlarm | `ptm_GetRtcAlarm` | `0x104d64` | `0x000300C0` |
| `0x0004` | `0x00040000` | CancelRtcAlarm | `ptm_CancelRtcAlarm` | `0x104d5c` | `0x00040040` |
| `0x0005` | `0x00050000` | GetAdapterState | `ptm_GetAdapterState` | `0x104d3c` | `0x00050080` |
| `0x0006` | `0x00060000` | GetShellState | `ptm_GetShellState` | `0x104d1c` | `0x00060080` |
| `0x0007` | `0x00070000` | GetBatteryLevel | `ptm_GetBatteryLevel` | `0x104cc0` | `0x00070080` |
| `0x0008` | `0x00080000` | GetBatteryChargeState | `ptm_GetBatteryChargeState` | `0x104ca0` | `0x00080080` |
| `0x0009` | `0x00090000` | GetPedometerState | `ptm_GetPedometerState` | `0x104c8c` | `0x00090080` |
| `0x000A` | `0x000A0042` (vérifié) | GetStepHistoryEntry | `ptm_GetStepHistoryEntry` | `0x104c54` | `0x000A0042` |
| `0x000B` | `0x000B00C2` (vérifié) | GetStepHistory | `ptm_GetStepHistory` | `0x104c3c` | `0x000B0042` |
| `0x000C` | `0x000C0000` | GetTotalStepCount | `ptm_GetTotalStepCount` | `0x104c2c` | `0x000C0080` |
| `0x000D` | `0x000D0040` | SetPedometerRecordingMode | `ptm_SetPedometerRecordingMode` | `0x104e4c` | `0x000D0040` |
| `0x000E` | `0x000E0000` | GetPedometerRecordingMode | `ptm_GetPedometerRecordingMode` | `0x104c24` | `0x000E0080` |
| `0x000F` | `0x000F0084` (vérifié) | GetStepHistoryAll | `ptm_GetStepHistoryAll` | `0x104c10` | `0x000F0044` |

- Les quatre commandes d'état (5 à 8) ne gardent rien en mémoire : chacune pose la question au microcontrôleur au moment où on la lui pose (partie 6).
- RegisterAlarmClient range dans le contexte de la session le signal que le client fournit (`alarm_client_set_event`, `0x101704`). Les alarmes sont tenues dans une liste triée par heure (`alarm_set`, `alarm_get`, `alarm_cancel`).
- SetPedometerRecordingMode tient un compteur de clients qui veulent le podomètre en marche (`pedometer_add_recording_client`, `pedometer_remove_recording_client`) et un octet par session. Une valeur autre que 0 ou 1 rend `0xE0E0D7FD`.
- GetStepHistory (`0x000B00C2`) est la seule commande que Pokémon X envoie à `ptm:u`. Le [contrat des petits services](contrat-petits-services.md) (partie 4) l'a lue des deux côtés. **Le nombre d'heures n'est pas pris dans le mot 1** (3dbrew l'y met) mais dans la taille du tampon, divisée par 2. Si le podomètre n'est pas en service, la fonction rend 0 sans toucher au tampon ; sinon elle vérifie la date (`0xE0E0D7FD` si le début ou la fin de la période dépasse une borne fixée à l'an 2100), met le tampon à zéro, relit l'historique gardé par le microcontrôleur (168 heures), recopie les heures qui tombent dans la période et plafonne chaque valeur à 18 000 (`0x4650`). Le jeu demande les 24 heures de la journée en cours et arrête tout si la commande échoue.

**Les commandes de `ptm:sysm` et `ptm:s`** en plus des quinze :

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| `0x0401` | `0x040100C0` | SetRtcAlarmEx | `ptmsysm_SetRtcAlarmEx` | `0x1095a6` | `0x04010040` |
| `0x0402` | `0x04020042` (vérifié) | ReplySleepQuery | dans l'aiguillage, puis `remove_pending_subscriber` | `0x104b9e` | `0x04020040` |
| `0x0403` | `0x04030042` (vérifié) | NotifySleepPreparationComplete | dans l'aiguillage, puis `remove_pending_subscriber` | `0x104b9e` | `0x04030040` |
| `0x0404` | `0x04040102` (vérifié) | SetWakeupTrigger | `set_wakeup_trigger` | `0x104f80` | `0x04040040` |
| `0x0405` | `0x04050000` | GetAwakeReason | `get_awake_reason` | `0x106568` | `0x04050140` |
| `0x0406` | `0x04060000` | RequestSleep | `ptmsysm_RequestSleep` | `0x1099e0` | `0x04060040` |
| `0x0407` | `0x040700C0` | ShutdownAsync | `ptmsysm_ShutdownAsync` | `0x1099f0` | `0x04070040` |
| `0x0408` | `0x04080000` | Awake | `set_awake_flag` | `0x106560` | `0x04080040` |
| `0x0409` | `0x04090080` | RebootAsync | `request_reboot` | `0x1095fe` | `0x04090040` |
| `0x040A` | `0x040A0000` | CheckNew3DS | `ptmsysm_CheckNew3DS` | `0x109a00` | `0x040A0080` |
| `0x0801` | `0x08010640` | SetInfoLEDPattern | `ptmsysm_SetInfoLEDPattern` | `0x109910` | `0x08010040` |
| `0x0802` | `0x08020040` | SetInfoLEDPatternHeader | `ptmsysm_SetInfoLEDPatternHeader` | `0x109974` | `0x08020040` |
| `0x0803` | `0x08030000` | GetInfoLEDStatus | `ptmsysm_GetInfoLEDStatus` | `0x1098dc` | `0x08030080` |
| `0x0804` | `0x08040040` | SetBatteryEmptyLEDPattern | `ptmsysm_SetBatteryEmptyLEDPattern` | `0x109984` | `0x08040040` |
| `0x0805` | `0x08050000` | ClearStepHistory | `ptmsysm_ClearStepHistory` | `0x1098cc` | `0x08050040` |
| `0x0806` | `0x080600C2` (vérifié) | SetStepHistory | `ptmsysm_SetStepHistory` | `0x109888` | `0x08060042` |
| `0x0807` | `0x08070082` (vérifié) | GetPlayHistory | `ptmsysm_GetPlayHistory` | `0x109860` | `0x08070082` |
| `0x0808` | `0x08080000` | GetPlayHistoryStart | `ptmsysm_GetPlayHistoryStart` | `0x109934` | `0x08080080` |
| `0x0809` | `0x08090000` | GetPlayHistoryLength | `ptmsysm_GetPlayHistoryLength` | `0x109954` | `0x08090080` |
| `0x080A` | `0x080A0000` | ClearPlayHistory | `ptmsysm_ClearPlayHistory` | `0x1098bc` | `0x080A0040` |
| `0x080B` | `0x080B0080` | CalcPlayHistoryStart | `ptmsysm_CalcPlayHistoryStart` | `0x109944` | `0x080B0080` |
| `0x080C` | `0x080C0080` | SetUserTime | `ptmsysm_SetUserTime` | `0x109798` | `0x080C0040` |
| `0x080D` | `0x080D0000` | InvalidateSystemTime | `ptmsysm_InvalidateSystemTime` | `0x109964` | `0x080D0040` |
| `0x080E` | `0x080E0140` | NotifyPlayEvent | `ptmsysm_NotifyPlayEvent` | `0x1098a0` | `0x080E0040` |
| `0x080F` | `0x080F0000` | GetSoftwareClosedFlag | `ptmsysm_GetSoftwareClosedFlag` | `0x1098ec` | `0x080F0080` |
| `0x0810` | `0x08100000` | ClearSoftwareClosedFlag | `ptmsysm_ClearSoftwareClosedFlag` | `0x109920` | `0x08100040` |
| `0x0811` | `0x08110000` | GetShellStatus | `ptmsysm_GetShellStatus` | `0x109874` | `0x08110080` |
| `0x0812` | `0x08120000` | IsShutdownByBatteryEmpty | dans l'aiguillage | | `0x08120080` |
| `0x0813` | `0x08130000` | FormatSavedata | `ptmsysm_FormatSavedata` | `0x1097c8` | `0x08130040` |
| `0x0814` | `0x08140000` | GetLegacyJumpProhibitedFlag | `ptmsysm_GetLegacyJumpProhibitedFlag` | `0x109994` | `0x08140080` |
| `0x0815` | `0x08150040` | SetPlayHistoryRecordingMode | `ptmsysm_SetPlayHistoryRecordingMode` | `0x1099a8` | `0x08150040` |
| `0x0816` | en-tête incomplet sur 3dbrew | sans nom | `ptmsysm_GetRtcTime` | `0x1099b8` | `0x081600C0` |
| `0x0817` | en-tête incomplet sur 3dbrew | sans nom | `ptmsysm_SetRtcTime` | `0x1099d0` | `0x08170040` |
| `0x0818` | `0x08180040` | ConfigureNew3DSCPU | `ptmsysm_ConfigureNew3DSCPU` | `0x1097a8` | `0x08180040` |

- CheckNew3DS ne calcule rien : elle rend toujours 1. C'est normal, ce module est la version New 3DS ; `hid` lui pose cette question au démarrage (voir `hid.md`).
- IsShutdownByBatteryEmpty rend toujours 0.
- GetShellStatus envoie la même requête au microcontrôleur que GetShellState.
- ConfigureNew3DSCPU passe son octet au noyau : `svcKernelSetState(10, valeur)` (`configure_new3ds_cpu`, `0x109634`).
- Les deux commandes sans nom : `0x0816` lit l'horloge du microcontrôleur (`read_rtc_time`, donc `MCURTC_GetRTC`) et rend un nombre de 64 bits ; `0x0817` découpe une heure en six champs et les envoie par `MCURTC_SetRTC`. Leurs noms ici (`ptmsysm_GetRtcTime`, `ptmsysm_SetRtcTime`) décrivent ce que fait le code, ils ne viennent pas de 3dbrew.
- FormatSavedata appelle les fonctions de ClearPlayHistory et de ClearStepHistory (`play_history_clear`, `0x104de4`, et `pedometer_clear_history`, `0x104e96`), celles de SetUserTime et d'InvalidateSystemTime, puis avance deux compteurs gardés dans le microcontrôleur (`MCURTC_SetLocalFriendCodeCounter`, `MCURTC_SetUUIDClockSequence`).
- Les cinq commandes de veille (`0x0402`, `0x0403`, `0x0404`, `0x0406`, `0x0408`) sont décrites dans la partie 5.

**`ptm:play`**, en plus des quinze, relit le journal de jeu par quatre petites fonctions à lui :

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| `0x0807` | `0x08070082` (vérifié) | GetPlayHistory | `ptmplay_GetPlayHistory` | `0x109a0c` | `0x08070082` |
| `0x0808` | `0x08080000` | GetPlayHistoryStart | `ptmplay_GetPlayHistoryStart` | `0x109a20` | `0x08080080` |
| `0x0809` | `0x08090000` | GetPlayHistoryLength | `ptmplay_GetPlayHistoryLength` | `0x109a40` | `0x08090080` |
| `0x080B` | `0x080B0080` | CalcPlayHistoryStart | `ptmplay_CalcPlayHistoryStart` | `0x109a30` | `0x080B0080` |

**`ptm:gets` et `ptm:sets`** :

| Service | N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| `ptm:gets` | `0x0401` | `0x04010000` | GetSystemTime | `ptmgets_GetSystemTime` | `0x1097b8` | `0x040100C0` |
| `ptm:sets` | `0x0001` | `0x00010080` | SetSystemTime | `ptmsets_SetSystemTime` | `0x10ad98` | `0x00010040` |

## Partie 4 : les notifications

Une notification est un simple numéro que `sm` distribue aux processus qui s'y sont abonnés (voir `sm.md`, commandes 9 à 13 de `srv:`). `ptm` en publie dix et en écoute cinq.

**Celles que `ptm` publie.** Il y a deux façons de publier, chacune dans une seule fonction :

- `publish_notification` (`0x107090`) envoie `SRV_PublishToSubscriber` (`0x000C0080`) : la notification part, personne ne répond.
- `publish_and_expect_replies` (`0x10542a`) envoie `SRV_PublishAndGetSubscriber` (`0x000D0040`) : `sm` rend en plus la liste des processus abonnés, 60 au plus, que `ptm` garde pour attendre la réponse de chacun.

| Notification | Publiée par | Appel à | Réponse attendue | À quelle occasion |
| --- | --- | --- | --- | --- |
| `0x101` | `sleep_sequence` | `0x103f96` | 3, par ReplySleepQuery | Quelqu'un a demandé la veille : qui s'y oppose ? |
| `0x102` | `sleep_sequence` | `0x1040ae` | aucune | La veille est refusée |
| `0x103` | `sleep_sequence` | `0x103fb8` | 1 | La veille est acceptée |
| `0x104` | `sleep_sequence` | `0x103ff8` | 0 | La console va s'endormir : rangez tout |
| `0x105` | `sleep_sequence` | `0x104230` | 0 | La console se réveille : remettez tout en route |
| `0x106` | `sleep_sequence` | `0x104264` | aucune | La console est tout à fait réveillée |
| `0x107` | `sleep_sequence` | `0x104292` | 2 | Réveil partiel, la console va se rendormir |
| `0x108` | `shutdown_sequence` | `0x1043d6` | aucune | La console va s'éteindre |
| `0x211` | `handle_main_event` | `0x100726` | aucune | Batterie de 1 à 5 % |
| `0x212` | `handle_main_event` | `0x100726` | aucune | Événement de batterie du microcontrôleur, avec 6 % ou plus |

La « réponse attendue » est le nombre que chaque abonné doit renvoyer par NotifySleepPreparationComplete (`0x0403`) pour être rayé de la liste. `hid` et `gsp` font exactement cela après `0x104` et `0x105` (voir leurs fiches).

**Celles que `ptm` reçoit.** `register_notification_handler` (`0x107264`) ajoute un gestionnaire à la liste de `0x111228`.

| Notification | Abonnement | Gestionnaire | Adresse | Ce que fait le code |
| --- | --- | --- | --- | --- |
| `0x100` | aucun, elle est envoyée à un processus précis | `on_terminate_notification` | `0x10b92c` | Lève le drapeau d'arrêt de `ptm_main` (`0x10e44c`) |
| `0x179` | aucun, même raison | `on_all_terminated_notification` | `0x10ba00` | Déclenche le signal qu'attend `prepare_power_off` |
| `0x20C` | `SRV_Subscribe` | `on_notification_20c` | `0x10af54` | Lance une erreur fatale, code `0xF960D407` |
| `0x213` | `SRV_Subscribe` | `on_shell_opened_notification` | `0x10aeac` | Rouvre le signal `0x10e300`. Sauf si c'est la toute première notification du couvercle : dit au podomètre que le couvercle est ouvert (état 1) et note l'événement 9 dans le journal de jeu |
| `0x214` | `SRV_Subscribe` | `on_shell_closed_notification` | `0x10af00` | Dit au podomètre que le couvercle est fermé (état 0), note l'événement 8, et baisse le signal `0x10e300` sauf pendant une extinction |

Trois choses à retenir :

- **`ptm` ne publie ni `0x213` ni `0x214`.** Il les reçoit, comme `hid` et `gsp`. Celui qui les publie n'est pas dans ce module. `ns.md`, écrite en même temps que cette fiche, montre `ns` publier `0x214` ; pour `0x213`, rien n'est établi.
- **`ptm` ne décide pas de la veille quand le couvercle se ferme.** `0x214` ne fait que tenir ses comptes. La veille commence quand un client envoie la commande RequestSleep (partie 5).
- Le sens « ouvert » et « fermé » se recoupe dans le code : l'octet que `0x213` met à 1 et que `0x214` met à 0 est le même que celui que `pedometer_init` remplit au démarrage avec la réponse de `MCURTC_GetShellState`. Le podomètre demande au microcontrôleur d'arrêter de compter les pas quand cet octet vaut 1 et qu'aucun client n'a demandé l'enregistrement (`pedometer_update_recording`, `0x1063f4`).

## Partie 5 : la mise en veille, pas à pas

Tout se passe dans l'objet « alimentation » à `0x10e898` et dans `sleep_sequence` (`0x103f78`), exécutée par le fil d'alimentation. Un octet de cet objet (`+0x0B`) dit à quelle étape on est ; il est noté entre parenthèses.

**Avant : le couvercle se ferme.** Le microcontrôleur le voit. `ptm` reçoit la notification `0x214`, et rien d'autre ne se passe chez lui. Un autre module, client de `ptm:sysm` ou `ptm:s`, envoie alors RequestSleep : lequel, ce module ne le dit pas. `ns.md` montre `ns` envoyer cette commande (`0x04060000`), écouter les notifications `0x101` à `0x106`, et appeler SetWakeupTrigger quand il reçoit `0x104`, ce qui colle à l'étape 6 ci-dessous. À recouper quand cette fiche sera relue.

1. **La demande.** `ptmsysm_RequestSleep` appelle `request_sleep` (`0x10961e`) : si aucune veille n'est déjà en cours (octet `+0x09`), elle poste le message 1 dans la file du fil d'alimentation. La commande répond tout de suite ; la suite se passe dans l'autre fil.
2. **La question (étape 1).** L'octet « veille permise » (`+0x08`) est mis à 1, et la notification `0x101` est publiée. `wait_all_replies` (`0x105404`) attend le signal `+0x18`. Chaque abonné répond par ReplySleepQuery : l'aiguillage vérifie que le noyau a bien écrit son numéro de processus (mot 2 égal à `0x20`), le raye de la liste (`remove_pending_subscriber`), et si l'octet du mot 1 de la requête n'est pas nul, remet « veille permise » à 0. Quand la liste est vide, `signal_if_all_replied` (`0x104b84`) déclenche le signal.
3. **Refus.** Si quelqu'un s'est opposé, la notification `0x102` est publiée, l'étape revient à 0 et c'est fini.
4. **Accord (étape 2).** La notification `0x103` est publiée, et les réponses attendues (valeur 1).
5. **Le gel.** `svcKernelSetState(5, 1, 0, 0)`.
6. **La préparation (étape 3).** La liste des réveils demandés est vidée (`+0x1D8`), puis la notification `0x104` est publiée. C'est à ce moment que `hid` arrête de lire les capteurs et que `gsp` éteint les écrans. Pendant qu'ils travaillent, `sleep_cb_going_to_sleep` (`0x101a1c`) règle la luminosité du voyant à `0x32`, met le voyant en mode 2 et arrête la minuterie d'un jour. Les modules peuvent aussi déclarer par SetWakeupTrigger ce qui doit réveiller la console : la commande n'est acceptée qu'aux étapes 3 et 7 (sinon `0xC8A0D405`).
7. **Tout le monde est prêt (étape 4).** Quand chaque abonné a répondu (valeur 0), `sleep_cb_before_sleep_loop` (`0x101e10`) programme une alarme, `MCURTC_EnterExclusiveInterruptMode` est envoyé, et `MCURTC_GetPowerInterruptHistory` relève les événements déjà arrivés.
8. **Les réveils.** S'il n'y a aucun événement en attente, `PXIMC_Sleep(1)` est envoyé. La fonction réunit ensuite les masques de tous les réveils déclarés : un masque « réveil complet » et un masque « réveil partiel », chacun en deux moitiés de 32 bits, l'une pour `pdn`, l'autre pour le microcontrôleur. `PDNS_ConfigureWakeEvents` reçoit la moitié `pdn`, avec le bit 26 en plus si un événement du microcontrôleur est attendu. `check_events_already_true` (`0x107908`) regarde si un événement attendu est déjà vrai : couvercle, chargeur, charge.
9. **Le sommeil (étape 5).** Si rien n'est en attente ni déjà vrai : sauvegarde du masque d'interruptions du microcontrôleur, nouveau masque réglé sur les réveils attendus, `MCURTC_cmd_0x0035`, puis **`svcKernelSetState(2, 0, 0, 0)`**. C'est cet appel qui endort la console. Il ne revient qu'au réveil.
10. **Le réveil (étape 6).** `pdn_get_wake_status` (`PDNS_GetWakeStatus`) dit ce qui a réveillé la machine. Le masque du microcontrôleur est remis. Si c'est le microcontrôleur (bit 26), `collect_mcu_wake_events` (`0x1053ac`) acquitte `pdn` et lit l'événement par `MCURTC_ReadInterrupt`. Si `PXIMC_Sleep(1)` avait été envoyé, `PXIMC_Sleep(0)` l'est maintenant.
11. **Le tri (étape 7).** Le premier événement qui tombe dans le masque « réveil complet » devient la raison du réveil (`+0x60`) et on passe à l'étape 13. Sinon, le premier qui tombe dans le masque « réveil partiel » est noté à `+0x68`. S'il n'y en a aucun, la console se rendort (retour à l'étape 8).
12. **Le réveil partiel.** `sleep_cb_half_awake_begin`, puis la notification `0x107`, puis `sleep_cb_half_awake` (qui demande un réveil complet si c'est la batterie qui a réveillé la console et qu'elle est à 0 %). La fonction attend les réponses (valeur 2) par tranches de 50 millisecondes, en relisant à chaque fois ce qui a pu arriver. Si entre-temps quelqu'un a envoyé la commande Awake (octet `+0x0A`), ou si un événement de réveil complet arrive, on passe à l'étape 13. Sinon la console se rendort.
13. **La sortie de veille (étape 8).** Les réveils de `pdn` sont remis à zéro, `MCURTC_ExitExclusiveInterruptMode`, `sleep_cb_leaving_sleep`, puis la notification `0x105` : `hid` relance ses capteurs, `gsp` remet les écrans en route. `sleep_cb_waking_up` (`0x101990`) remet la luminosité du voyant à `0xFF`, le voyant en mode 0, relance la minuterie d'un jour et relit la batterie.
14. **Le dégel.** Quand chacun a répondu (valeur 0) : `svcKernelSetState(5, 2, 0, 0)`.
15. **Fin (étape 0).** La notification `0x106` est publiée, et `power_thread_loop` remet l'octet `+0x09` à 0 : une nouvelle veille peut être demandée.

GetAwakeReason (`0x0405`) rend les deux raisons, `+0x60` et `+0x68`.

**L'extinction et le redémarrage** suivent le même principe, en plus court.

| Étape | Extinction, `shutdown_sequence` (`0x1043c8`) | Redémarrage, `reboot_sequence` (`0x104384`) |
| --- | --- | --- |
| 1 | Notification `0x108` | |
| 2 | `prepare_power_off` (`0x10533c`) | `prepare_power_off` |
| 3 | `svcKernelSetState(8, 0, 0, 0)` | `svcKernelSetState(3, 1, 0, 0)` |
| 4 | `MCURTC_PowerOff` | `svcKernelSetState(8, 0, 0, 0)` |
| 5 | `svcKernelSetState(5, 0, 0, 0)` | `svcKernelSetState(7, 0, 0, 0)` |

`prepare_power_off` envoie `PMAPP_PrepareForReboot` avec le délai reçu, appelle `power_cb_shutdown` (`0x101a3c`, qui arrête le podomètre et le fil du journal de jeu), attend le signal `+0x90`, puis `svcKernelSetState(1, 0, 0, 0)`. Ce signal est déclenché par la notification `0x179`, que `pm` envoie à l'appelant de PrepareForReboot quand tous les autres processus sont arrêtés : c'est ce que dit `pm.md`, vu ici de l'autre côté.

L'extinction peut venir de trois endroits : la commande ShutdownAsync, le bit 1 du signal du microcontrôleur, ou la batterie à 0 %. Les trois passent par `request_shutdown` (`0x107050`), qui poste le message 2.

## Partie 6 : GetShellState et GetBatteryLevel, pas à pas

Un jeu ouvre `ptm:u` et envoie `0x00060000`.

1. **La boucle.** `svcReplyAndReceive` rend le rang de la session. `ptm_main` lit dans la table des sessions son type (2) et son contexte, et appelle `ptmu_handle_command`.
2. **L'aiguillage.** Le numéro 6 mène au morceau `0x109b32`, qui appelle `ptm_GetShellState` (`0x104d1c`) avec l'adresse d'un octet à remplir.
3. **Le chemin vers le microcontrôleur.** La fonction lit `0x10e48c`, qui contient l'adresse de l'objet `0x10e4f0` ; le premier mot de cet objet pointe sur `0x10e290`, où est la poignée de `mcu::RTC`.
4. **La question.** `MCURTC_GetShellState` (`0x106a36`) écrit l'en-tête `0x002A0000` dans le tampon du fil et appelle `svcSendSyncRequest`. La réponse est dans l'octet du mot 2. D'après 3dbrew, c'est le bit 1 du registre `0x0F` du microcontrôleur.
5. **La réponse.** L'aiguillage écrit l'en-tête `0x00060080`, le résultat, puis l'octet.

Rien n'est gardé en mémoire : chaque GetShellState coûte un aller-retour avec le module `mcu`.

GetBatteryLevel (`ptm_GetBatteryLevel`, `0x104cc0`) suit le même chemin avec `MCURTC_GetBatteryLevel` (`0x002D0000`), qui rend un pourcentage. La fonction le range ensuite dans une des six cases que connaissent les jeux :

| Pourcentage | Niveau rendu |
| --- | --- |
| plus de 60 | 5 |
| 31 à 60 | 4 |
| 11 à 30 | 3 |
| 6 à 10 | 2 |
| 1 à 5 | 1 |
| 0 | 0 |

**La page partagée.** `ptm` écrit aussi l'état de la batterie dans un octet que tous les programmes peuvent lire sans rien demander, à `0x1FF81085` :

| Bits | Contenu | Écrit par |
| --- | --- | --- |
| 0 | la réponse de `MCURTC_GetAdapterState` | `refresh_adapter_state` (`0x10711c`) |
| 1 | la réponse de `MCURTC_GetBatteryChargeState` | `refresh_charge_state` (`0x1070e4`) |
| 2 à 4 | le niveau de 0 à 5, même calcul que ci-dessus | `refresh_battery_level` (`0x106f38`) |

Ces trois fonctions sont appelées au démarrage, au réveil, et quand le signal du microcontrôleur annonce un changement ; le niveau l'est aussi toutes les 10 secondes.

## Partie 7 : les services que ptm appelle

Chaque requête envoyée à un autre service a sa petite fonction, qui écrit un en-tête et appelle `svcSendSyncRequest`. Il y en a 90, autant que d'appelants de `svcSendSyncRequest`. Les noms viennent de 3dbrew quand la commande y est nommée. La dernière colonne est déduite de l'endroit d'où la fonction est appelée.

**`srv:`** (poignée à `0x10e3e8`)

| En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- |
| `0x00010002` | `SRV_RegisterClient` | `0x1017bc` | Se déclarer à `sm` |
| `0x00020000` | `SRV_EnableNotification` | `0x1017f4` | Obtenir le sémaphore des notifications |
| `0x00030100` | `SRV_RegisterService` | `0x100604` | Créer les six services |
| `0x000400C0` | `SRV_UnregisterService` | `0x100658` | Les retirer à l'arrêt |
| `0x00050100` | `SRV_GetServiceHandle` | `0x1045b4` | Ouvrir les six services ci-dessous |
| `0x00090040` | `SRV_Subscribe` | `0x10722c` | S'abonner à `0x213`, `0x214`, `0x20C` |
| `0x000B0000` | `SRV_ReceiveNotification` | `0x101830` | Lire le numéro de la notification arrivée |
| `0x000C0080` | `SRV_PublishToSubscriber` | `0x104608` | Publier sans attendre de réponse |
| `0x000D0040` | `SRV_PublishAndGetSubscriber` | `0x108374` | Publier et recevoir la liste des abonnés |

**`mcu::RTC`** (poignée à `0x10e28c`, recopiée à `0x10e290` et dans l'objet « alimentation » à `+0x04`) : 55 requêtes.

| En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- |
| `0x00010080` | `MCURTC_SetRTC` | `0x10956a` | Régler l'horloge (commande `0x0817`) |
| `0x00020000` | `MCURTC_GetRTC` | `0x10783e` | Lire l'horloge (`read_rtc_time`) |
| `0x00110040` | `MCURTC_SetRTCLeapYearCounter` | `0x102428` | Au démarrage, avec le bloc de configuration `0x00030000` |
| `0x00130080` | `MCURTC_SetRTCAlarm` | `0x108172` | Programmer la prochaine alarme |
| `0x00140000` | `MCURTC_GetRTCAlarm` | `0x108138` | La relire |
| `0x001F0040` | `MCURTC_SetPedometerRecordingMode` | `0x103e68` | Mettre le podomètre en marche ou à l'arrêt |
| `0x00200000` | `MCURTC_GetPedometerRecordingMode` | `0x1093f8` | Répondre à GetPedometerState |
| `0x00210000` | `MCURTC_GetStepCount` | `0x103ea0` | Lire le nombre de pas |
| `0x00220042` | `MCURTC_ReadRegister4Fh` | `0x103ed4` | Lire l'historique des pas |
| `0x00230000` | `MCURTC_cmd_0x0023` | `0x1030fe` | Envoyé avec les deux précédentes |
| `0x00240000` | `MCURTC_GetPowerEventHandle` | `0x100fe6` | Obtenir le signal du rang 1 de la boucle |
| `0x00250000` | `MCURTC_GetPowerInterruptHistory` | `0x1030ca` | Savoir pourquoi il a sonné |
| `0x00260000`, `0x00280000` | `MCURTC_CheckRegister02hBit0`, `…Bit1` | `0x102354`, `0x102388` | Au démarrage |
| `0x00270000`, `0x00290000` | `MCURTC_ClearRegister02hBit0`, `…Bit1` | `0x102498`, `0x1024c4` | Au démarrage |
| `0x002A0000` | `MCURTC_GetShellState` | `0x106a36` | L'état du couvercle |
| `0x002B0000` | `MCURTC_GetAdapterState` | `0x1064ec` | Le chargeur |
| `0x002C0000` | `MCURTC_GetBatteryChargeState` | `0x106464` | La charge en cours |
| `0x002D0000` | `MCURTC_GetBatteryLevel` | `0x1064b8` | Le pourcentage de batterie |
| `0x002E0040` | `MCURTC_SetPowerModeIndicatorState` | `0x1023f0` | Le voyant : 2 à l'endormissement, 0 au réveil |
| `0x00300040` | `MCURTC_SetLEDBrightness` | `0x10255c` | `0x32` à l'endormissement, `0xFF` au réveil |
| `0x00320000` | `MCURTC_PowerOff` | `0x107812` | Couper le courant |
| `0x00350000` | `MCURTC_cmd_0x0035` | `0x10775c` | Juste avant de dormir |
| `0x00360040` | `MCURTC_SetWatchdogTimer` | `0x10231c` | Au démarrage |
| `0x00380042` | `MCURTC_GetInfoRegisters` | `0x10101a` | Au démarrage, dix octets |
| `0x00390082` | `MCURTC_SetPlayCountRegisters` | `0x1068e4` | Écrire dans les registres libres |
| `0x003A0082` | `MCURTC_GetPlayCountRegisters` | `0x10312a` | Les relire au démarrage |
| `0x003B0640`, `0x003C0040`, `0x003D0000`, `0x00420040` | `MCURTC_SetInfoLEDPattern`, `…SetInfoLEDPatternHeader`, `…GetInfoLEDStatus`, `…SetBatteryEmptyLEDPattern` | `0x109460`, `0x10949a`, `0x10942c`, `0x109500` | Les commandes `0x0801` à `0x0804` |
| `0x003E0040`, `0x00400040` | `MCURTC_WriteRegister50h`, `…51h` | `0x1081de`, `0x108216` | Le podomètre |
| `0x00430040`, `0x00450040` | `MCURTC_SetScreenFlickerTop`, `…Bottom` | `0x102240`, `0x102278` | Au démarrage, avec le bloc `0x00050000` |
| `0x00470080` | `MCURTC_SetVolumeSliderBounds` | `0x102594` | Au démarrage, avec le bloc `0x00120000` |
| `0x00490040`, `0x004A0000` | `MCURTC_SetInterruptMask`, `…GetInterruptMask` | `0x107788`, `0x107728` | Autour du sommeil |
| `0x004B0000`, `0x004C0000` | `MCURTC_ExitExclusiveInterruptMode`, `…Enter…` | `0x1077ba`, `0x1077e6` | Autour de la veille |
| `0x004D0000` | `MCURTC_ReadInterrupt` | `0x1081aa` | Lire l'événement qui a réveillé la console |
| `0x004E0040` | `MCURTC_TriggerInterrupt` | `0x108106` | Dans `clear_pending_wake_events` |
| `0x004F0040`, `0x00500000` | `MCURTC_SetMCUFirmUpdated`, `…IsMCUFirmUpdated` | `0x102460`, `0x1023bc` | Au démarrage |
| `0x00510040`, `0x00520000` | `MCURTC_SetSoftwareClosedFlag`, `…Get…` | `0x109532`, `0x1094cc` | Les commandes `0x080F` et `0x0810` |
| `0x00530040`, `0x00540000` | `MCURTC_SetLgyLcdData`, `…Get…` | `0x1022e4`, `0x1022b0` | `sync_lgy_lcd_data`, avec le bloc `0x00050001` |
| `0x00570040`, `0x00580000` | `MCURTC_SetLocalFriendCodeCounter`, `…Get…` | `0x102524`, `0x1024f0` | `sync_friend_code_counter`, avec les blocs `0x00090001` et `0x00090002` |
| `0x00590040`, `0x005A0000` | `MCURTC_SetLegacyJumpProhibitedFlag`, `…Get…` | `0x10108e`, `0x10105a` | Au démarrage |
| `0x005B0040`, `0x005C0000` | `MCURTC_SetUUIDClockSequence`, `…Get…` | `0x102606`, `0x1025d2` | `sync_uuid_clock_sequence` |

**Les autres services**

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `pdn:s` | `0x10e3c0` | `0x00010000` | `PDNS_GetWakeStatus` | `0x108250` | Ce qui a réveillé la console |
| | | `0x00020080` | `PDNS_ConfigureWakeEvents` | `0x107888` | Ce qui a le droit de la réveiller |
| | | `0x00030040` | `PDNS_Acknowledge` | `0x108290` | Acquitter un réveil |
| `pxi:mc` | objet « alimentation », `+0x00` | `0x00050040` | `PXIMC_Sleep` | `0x107ce2` | 1 avant de dormir, 0 après |
| | | `0x000A00C0` | `PXIMC_cmd_0x000A` | `0x1036b0` | Envoyer l'heure, au démarrage et toutes les heures |
| `pm:app` | `0x10e40c` | `0x00060082` | `PMAPP_PrepareForReboot` | `0x1085dc` | Faire arrêter tous les processus |
| `cfg:s` | `0x10e3f8` | `0x04010082` | `CFG_GetConfigInfoBlk8` | `0x102170` | Lire un bloc de configuration |
| | | `0x04020082` | `CFG_SetConfigInfoBlk4` | `0x1021bc` | En écrire un |
| | | `0x04030000` | `CFG_UpdateConfigNANDSavegame` | `0x102204` | Enregistrer la configuration |
| | | `0x040D0040` | `CFG_SetUUIDClockSequence` | `0x102fec` | `sync_uuid_clock_sequence` |
| | | `0x040E0000` | `CFG_GetUUIDClockSequence` | `0x1092f8` | FormatSavedata |
| `fs:USER` | | `0x08610042` | `FSUSER_InitializeWithSdkVersion` | `0x103988` | Au démarrage |
| | | `0x08390000` | `FSUSER_SendInitializeInfoTo9` | `0x101fb4` | Au démarrage |
| | | `0x08620040` | `FSUSER_SetPriority` | `0x102d14` | Au démarrage et à l'arrêt |
| | | `0x080C00C2` | `FSUSER_OpenArchive` | `0x1038f0` | Monter `ptmdb:` |
| | | `0x080E0080` | `FSUSER_CloseArchive` | `0x10394c` | |
| | | `0x080D0144` | `FSUSER_ControlArchive` | `0x107e78` | |
| | | `0x08560240` | `FSUSER_CreateSystemSaveData` | `0x102d4c` | Créer la sauvegarde `0x00010022` |
| | | `0x08570080` | `FSUSER_DeleteSystemSaveData` | `0x102da4` | La supprimer |
| | | `0x080201C2` | `FSUSER_OpenFile` | `0x108bbc` | Ouvrir `Pedometer.dat` ou `PlayHistory.dat` |
| un fichier ouvert | | `0x080200C2` | `FSFILE_Read` | `0x108c28` | |
| | | `0x08030102` | `FSFILE_Write` | `0x108cb0` | |
| | | `0x08040000` | `FSFILE_GetSize` | `0x108d0c` | |
| | | `0x08050080` | `FSFILE_SetSize` | `0x108d48` | |
| | | `0x08080000` | `FSFILE_Close` | `0x108c80` | |
| `err:f` (port) | | `0x00010800` | `ERRF_Throw` | `0x103d90` | Signaler une erreur fatale (`report_fatal_error`, `0x10302c`) |

Deux écarts avec la Carte des services, à vérifier :
- Elle donne `0x002E0000` pour la commande `0x2E` de `mcu::RTC` ; le code envoie `0x002E0040`, avec un octet.
- Elle donne `0x00210080` pour la commande `0x21` ; le code envoie `0x00210000`.

Les blocs de configuration lus : `0x000F0004` (4 octets), `0x00030000` (1), `0x00030001` (8), `0x00030002` (8), `0x00050000` (2), `0x00050001` (2), `0x00090001` (8), `0x00090002` (4), `0x00120000` (8). Le bloc `0x00120000` est celui que `hid` lit pour le curseur 3D.

## Partie 8 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x10e2c8` | les six services, 8 octets chacun : pointeur vers le nom, sessions permises (29, sauf `ptm:sets` : 1) |
| `0x10d068` | les six aiguillages, un par type de session |
| `0x10d080` | pour chaque service, l'objet qui fournit les contextes de session (`0x1100a8` ou `0x10e2c0`) |
| `0x111908`, `0x10e440` | la liste des 41 poignées de la boucle et son compteur |
| `0x111754` | la table des sessions, 8 octets chacune : type, contexte |
| `0x10e44c` | drapeau d'arrêt de `ptm_main` |
| `0x111228`, `0x11122c` | la liste des gestionnaires de notifications et son verrou |
| `0x10e280` | un octet « une notification du couvercle a déjà été vue », un octet « extinction en cours » à `+1`, le compteur de la minuterie de 10 secondes à `+4` |
| `0x10e28c`, `0x10e290`, `0x10e294` | la poignée de `mcu::RTC`, sa copie, le signal du microcontrôleur |
| `0x10e298`, `0x10e2a4`, `0x10e4f4` | les trois minuteries |
| `0x10e300` | un signal baissé quand le couvercle se ferme, que le fil du journal de jeu attend avant d'écrire |
| `0x110e14` | un verrou pris pendant toute la veille, que le fil du journal prend pour écrire |
| `0x10e3c0`, `0x10e3e8`, `0x10e3f8`, `0x10e40c` | les poignées de `pdn:s`, `srv:`, `cfg:s`, `pm:app` |
| `0x1FF81085` | l'octet de la batterie dans la page partagée (partie 6) |

Les objets du module. `init_globals` range l'adresse de chacun dans un pointeur ; c'est par ces pointeurs que les commandes les atteignent.

| Pointeur | Objet | Ce que c'est |
| --- | --- | --- |
| `0x10e480` | `0x10e898` | l'alimentation : veille, extinction, redémarrage |
| `0x10e47c` | `0x10e518` | le podomètre |
| `0x10e484` | `0x10e860` | les alarmes |
| `0x10e488` | `0x110078` | le journal de jeu |
| `0x10e48c` | `0x10e4f0` | l'horloge et l'accès au microcontrôleur |

L'objet « alimentation » :

| Décalage | Contenu |
| --- | --- |
| `+0x00`, `+0x04` | les poignées de `pxi:mc` et de `mcu::RTC` |
| `+0x08` | « veille permise », remis à 0 par un ReplySleepQuery qui s'oppose |
| `+0x09` | une veille est demandée ou en cours |
| `+0x0A` | quelqu'un a envoyé la commande Awake |
| `+0x0B` | l'étape de la veille, de 0 à 8 |
| `+0x0C` | le verrou de la liste des abonnés |
| `+0x18` | le signal « tous les abonnés ont répondu » |
| `+0x24` | la file de messages du fil d'alimentation |
| `+0x5D` | une extinction ou un redémarrage est demandé |
| `+0x60`, `+0x68` | la raison du réveil complet, celle du réveil partiel (64 bits chacune) |
| `+0x70` | le délai passé à PrepareForReboot |
| `+0x78` | la réponse attendue pour la notification en cours, ou `-1` |
| `+0x7C` | le gestionnaire de la notification `0x179` |
| `+0x90` | le signal « tous les processus sont arrêtés » |
| `+0x98`, `+0x9C` | le nombre d'abonnés qui n'ont pas répondu, et leurs numéros de processus |
| `+0x58`, `+0x1AC` à `+0x1C0` | sept fonctions appelées aux étapes de la veille et à l'extinction |
| `+0x1C4` | le verrou que `handle_main_event` essaie de prendre |
| `+0x1D0` | les événements de réveil en attente (64 bits) |
| `+0x1D8`, `+0x1E0` | le nombre de réveils déclarés et leur table, `0x18` octets chacun : numéro de processus, masque de réveil complet, masque de réveil partiel |

## Partie 9 : les appels système utilisés

Chaque appel système n'apparaît qu'une fois dans le code, dans sa petite enveloppe en ARM.

| Appel | Numéro | Fonction | Adresse | Appelée par |
| --- | --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x10bb9c` | `set_heap_size` |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x10bbd8` | `init_vm_region_0e000000` (`0x100498`) |
| ExitProcess | `0x03` | `svcExitProcess` | `0x10ba28` | `entry` et `default_exit_handler` (`0x10af64`) |
| CreateThread | `0x08` | `svcCreateThread` | `0x10bc8c` | `create_thread_impl` |
| ExitThread | `0x09` | `svcExitThread` | `0x10be74` | `thread_trampoline` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x10bcb0` | `sleep_thread` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x10bc14` | `ptm_initialize`, `power_manager_init` |
| SignalEvent | `0x18` | `svcSignalEvent` | `0x10be7c` | `signal_if_all_replied`, `alarm_fire` (`0x107ccc`) |
| ClearEvent | `0x19` | `svcClearEvent` | `0x10be6c` | `publish_and_expect_replies` |
| CreateTimer | `0x1A` | `svcCreateTimer` | `0x10bc2c` | `start_hourly_timer`, `timer_create` |
| SetTimer | `0x1B` | `svcSetTimer` | `0x106610` | `start_hourly_timer`, `timer_set`, `pedometer_get_step_history_all_impl` (`0x109088`) |
| CancelTimer | `0x1C` | `svcCancelTimer` | `0x10bc6c` | `timer_cancel` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x10bbc0` | `create_address_arbiter` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x10c424` | `light_semaphore_acquire` (`0x104874`), `arbitrate_address` (`0x1055d4`) |
| CloseHandle | `0x23` | `svcCloseHandle` | `0x107204` | 11 fonctions |
| WaitSynchronization1 | `0x24` | `svcWaitSynchronization1` | `0x1065fc` | `sleep_cb_half_awake`, `wait_handle_timeout`, `play_history_stop_thread` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x10c4d8` | `main_thread_handle_ctor` (`0x10900c`) |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x10be04` | `shared_page_read_time` (`0x104508`), `fs_throttle` (`0x108970`) |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x10bc44` | `init_linear_address_offset` (`0x100f34`) |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x10bc74` | `srv_connect`, `errf_connect` |
| SendSyncRequest | `0x32` | `svcSendSyncRequest` | `0x10715c` | les 90 fonctions de la partie 7 |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x10bdec` | `report_fatal_error`, `alarm_update_wakeup_trigger` (`0x107b98`) |
| Break | `0x3C` | `svcBreak` | `0x10be64` | `break_process` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x10bacc` | `ptm_main` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x10bae4` | `ptm_main` |
| KernelSetState | `0x7C` | `svcKernelSetState` | `0x1053fc` | `sleep_sequence`, `shutdown_sequence`, `reboot_sequence`, `prepare_power_off`, `configure_new3ds_cpu` |

`svcKernelSetState` est l'appel propre à ce module. Les valeurs passées :

| Arguments | Où | À quel moment |
| --- | --- | --- |
| `5, 1` | `sleep_sequence` | Après l'accord, avant la notification `0x104` |
| `2, 0` | `sleep_sequence` | Le sommeil lui-même |
| `5, 2` | `sleep_sequence` | Après les réponses à `0x105` |
| `1, 0` | `prepare_power_off` | Quand tous les processus sont arrêtés |
| `8, 0` | `shutdown_sequence`, `reboot_sequence` | Juste avant de couper ou de redémarrer |
| `5, 0` | `shutdown_sequence` | Après `MCURTC_PowerOff` |
| `3, 1` puis `7, 0` | `reboot_sequence` | Le redémarrage |
| `10, octet` | `configure_new3ds_cpu` | La commande ConfigureNew3DSCPU |

Les verrous du module (`lock_enter` à `0x106da4`, `lock_leave` à `0x10703e`) et ses signaux légers (`light_event_signal`, `light_event_clear`, `light_event_wait`) reposent sur `ArbitrateAddress`, comme dans `sm` et `hid`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les numéros de commande, leur fonction et leur en-tête de réponse, pour les cinq aiguillages : le pseudo-code de Ghidra d'un côté ; de l'autre l'émulation de chaque aiguillage, numéro par numéro, qui note la fonction appelée et lit l'en-tête écrit dans le tampon. Les sept tables de saut ont aussi été décodées par un script, à partir des octets.
- Les en-têtes de requête de 3dbrew : le code en compare neuf à leur valeur exacte (`0x00010002`, `0x000A0042`, `0x000B00C2`, `0x000F0084`, `0x04020042`, `0x04030042`, `0x04040102`, `0x080600C2`, `0x08070082`), et tous tombent juste.
- Le partage des commandes entre services : la table de six aiguillages à `0x10d068` et l'ordre des noms dans `init_globals`, et les listes de 3dbrew service par service.
- La liste des notifications publiées : les deux fonctions de publication n'ont que trois appelants en tout (`sleep_sequence`, `shutdown_sequence`, `handle_main_event`), et les dix numéros sont lus dans l'assembleur à chacun des neuf appels. Aucun `0x213` ni `0x214` n'y figure.
- La chaîne de la veille avec les autres fiches : `hid.md` et `gsp.md` montrent ces modules envoyer `0x04030042` après `0x104` et `0x105` ; ici c'est la commande qui raye un abonné de la liste d'attente.
- La chaîne de l'extinction avec `pm.md` : `ptm` envoie `0x00060082` à `pm:app` et attend `0x179` ; `pm.md` décrit PrepareForReboot qui arrête tout puis envoie `0x179` à son appelant.
- `SRV_PublishAndGetSubscriber` : `ptm` recopie 60 mots de la réponse, et `sm.md` donne `0x000D0F80` comme en-tête de réponse, soit 62 mots dont le résultat et le nombre d'abonnés.
- Les services appelés : l'exheader autorise six noms (`mcu::RTC`, `fs:USER`, `cfg:s`, `pxi:mc`, `pm:app`, `pdn:s`), et ce sont les six que le code ouvre. Sur les 55 requêtes à `mcu::RTC`, 53 ont exactement l'en-tête de 3dbrew.
- Les sept événements du signal du microcontrôleur : les bits testés par `handle_main_event` sont ceux que 3dbrew donne pour `GetPowerEventHandle`.
- `svcReplyAndReceive`, `svcAcceptSession` et `svcCreateThread` n'ont chacun qu'un appelant.
- GetStepHistory : la requête que Pokémon X fabrique (`0x124d24` dans le jeu) et ce que l'aiguillage de `ptm:u` en lit (cas à `0x109bf2`), mot pour mot ([contrat des petits services](contrat-petits-services.md), partie 4). Le mot 1 n'est pas lu par le module.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens en clair des notifications (`0x101` à `0x108`, `0x211`, `0x212`) : le code montre l'ordre, les occasions et les réponses attendues, pas les noms. Ils sont absents de la Carte des services ; les mots de la partie 4 sont les miens.
- Le sens des bits du signal du microcontrôleur (1 pour le bouton d'alimentation tenu, 8 et 9 pour le chargeur, 10 pour l'alarme, 13 pour la batterie, 14 et 15 pour la charge) : déduit de ce que le code fait de chacun.
- Le sens des types de `svcKernelSetState` : seuls les arguments et le moment sont lus. « 5, 1 gèle les processus » et « 2 endort » sont des déductions.
- Qui envoie RequestSleep quand le couvercle se ferme, et qui publie `0x213` et `0x214` : ce n'est pas `ptm`, et ce module ne dit pas qui c'est. `ns.md` désigne `ns` pour RequestSleep et pour `0x214` ; les deux fiches ont été écrites séparément et ce point n'a pas été relu des deux côtés. Pour `0x213`, pas de candidat établi.
- Le masque d'interruptions du microcontrôleur pendant le sommeil : le code y écrit la réunion des réveils demandés ; le sens exact de chaque bit est dans le module `mcu`.
- Le rôle des deux requêtes à `pxi:mc`, des requêtes `0x23` et `0x35` à `mcu::RTC`, et de l'événement 8, 9 ou 10 du journal de jeu.
- Ce que font les sept fonctions appelées aux étapes de la veille (`sleep_cb_…`, `power_cb_shutdown`) : seuls leurs appels au microcontrôleur et aux minuteries sont sûrs. « Programme une alarme » et « range l'heure courante dans les registres libres » sont des lectures rapides.
- Les priorités des fils : le code passe les constantes `0x6C8DA504` (alimentation) et `0x6C8DA53E` (journal), que `thread_priority_convert` (`0x103a10`) ramène à 4 et à `0x3E`.
- Le découpage de l'objet « alimentation » et la disposition d'un réveil déclaré.
- Les trois octets écrits à `0x1FF81004` au démarrage, et le bloc `0x000F0004`.
- Le drapeau de l'exheader `0xFF000388` : ses bits 3 et 7 donneraient à `ptm` le droit d'écrire dans la page partagée et de continuer à tourner pendant la veille. Lu de mémoire dans 3dbrew, pas vérifié ici.
- `on_hourly_timer` vu comme un contrôle de la dérive de l'horloge.

**Pas lu**
- Le podomètre : la lecture de l'historique des pas (`0x106a6a`, `0x105afc`, `0x10491c`), le fichier `Pedometer.dat`, les commandes `0x0009` à `0x000C` et `0x000F` au-delà de leur première fonction. Seul le chemin de GetStepHistory a été suivi depuis, par le contrat des petits services, et le calcul des dates (`0x105afc`) n'y est que survolé.
- Le journal de jeu : le format d'une entrée, le fichier `PlayHistory.dat`, la relecture des registres du microcontrôleur au démarrage (`0x101368`), les commandes `0x0807` à `0x080B`.
- Les alarmes au-delà de leur liste triée : `0x1031d8`, `0x10692a`, `0x107a0c`, `on_rtc_alarm_event`.
- L'heure : les conversions (`0x105fb8`, `0x106800`, `0x10331c`), SetUserTime, GetSystemTime, SetSystemTime, InvalidateSystemTime.
- Les voyants : les quatre commandes `0x0801` à `0x0804` ne font que transmettre au microcontrôleur, leurs paramètres ne sont pas décrits.
- La couche de fichiers (`0x108964` à `0x109000`) et la création de la sauvegarde.
- 28 des 29 fonctions d'initialisation des objets globaux, la réserve de mémoire, les fonctions de calcul en ARM à la fin du code.
- aucune ; 458 noms restent de confiance moyenne.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système et nommer leurs enveloppes | `outils/prescan.py` | une minute |
| Trouver les fonctions Thumb que personne n'appelle directement | un script : pointeurs impairs, table de distances | immédiat |
| Analyser avec ces graines Thumb, décompiler les 813 fonctions | Ghidra lancé directement sous WSL, quatre scripts | 20 secondes par passage |
| Décoder les sept tables de saut et les imposer au décompilateur | un script Python, puis un script Ghidra | immédiat |
| Émuler les cinq aiguillages, numéro par numéro | un script Python avec unicorn | quelques secondes |
| Relever les 90 requêtes envoyées et leurs en-têtes | un script Python sur l'assembleur | immédiat |
| Lire le pseudo-code et l'assembleur, nommer | Claude | le gros du temps |
| Recouper avec la Carte des services, l'exheader et les autres fiches | des scripts, puis à la main | court |

**Le piège rencontré : ce module est en Thumb.** Les six premiers modules étaient surtout en ARM. Ici, presque tout est en Thumb, et le pont REA ne sait poser que des graines ARM. Sans aide, Ghidra ne voit ni les cinq aiguillages de commandes, ni les gestionnaires de notifications, ni les fonctions de la veille appelées par pointeur : environ 9 000 octets de code sur 50 416 restaient hors de toute fonction, dont un bloc de 4 804 octets qui contient tous les aiguillages. `prescan.py` annonçait « aucune fonction manquée » et « 160 pointeurs impairs » : c'est le second message qu'il fallait lire. La solution reprend celle de `fs` : Ghidra lancé directement, avec un script qui pose 97 graines (64 cibles de pointeurs impairs, les 29 fonctions de la table d'initialisation, trois trous, une enveloppe ARM).

**Trois autres choses à savoir en relisant dans Ghidra.**
- **Les « switch ».** Chaque aiguillage saute par `0x106ed8`, une aide du compilateur écrite en ARM et appelée depuis du Thumb, suivie d'une table d'octets : le nombre de cas, puis un octet par cas et un pour le cas par défaut ; la cible est l'adresse de retour plus deux fois l'octet. Ghidra reconnaît l'aide mais ne retrouve pas les cibles (« Could not recover jumptable »). Il faut les lui donner : c'est ce que fait `PtmSwitch.java` à partir de `switches.tsv`.
- **Ne pas nommer `0x106ed8` dans le fichier de graines.** Une graine `function` à cette adresse crée la fonction avant l'analyse, Ghidra ne la reconnaît plus comme aide de saut, et tout ce qui suit un « switch » est perdu : REA tombait de 660 à 629 fonctions. Elle a donc une ligne `label`, et non `function`, dans `ptm.noms.tsv` (`__ARM_common_switch8`) : par le pont REA une ligne `label` ne pose pas de graine, et `ghidra_direct.py`, qui reconnaît l'aide à son code avant l'analyse, ne fait que la renommer.
- **Par le pont REA seul**, 56 des 317 noms restent de simples étiquettes sans fonction derrière : les cinq aiguillages, les commandes de `ptm:sysm`, cinq des sept fonctions de la veille, quatre gestionnaires de notifications. Pour les voir en pseudo-code, lancer `local/analyse/ptm/ghidra/run.sh` sous WSL, qui range tout dans `local/analyse/ptm/gh/`. Dans l'interface de Ghidra : se placer sur l'adresse, F12 pour désassembler en Thumb, F pour créer la fonction.

**Pour reprendre.** `ptm.noms.tsv` est le fichier de graines : une adresse, `function` pour les 29 fonctions ARM ou `label` pour les 288 fonctions Thumb, un nom. Les noms en majuscules (`SRV_`, `MCURTC_`, `PDNS_`, `CFG_`…) sont les requêtes que `ptm` envoie à un autre service ; ceux en `ptm_`, `ptmsysm_`, `ptmplay_`, `ptmgets_` et `ptmsets_` sont les commandes qu'il reçoit. Dans `local/analyse/ptm/`, non versionné : `names.txt` et `names.py` (les noms et la fabrication du fichier de graines), `ghidra/` (les quatre scripts et `run.sh`), `gh/` (pseudo-code, assembleur annoté, références), `emu.py` (l'émulation des aiguillages), `switches.py`, `stubs.py`, `mktables.py`.
