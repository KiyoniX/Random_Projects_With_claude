# csnd, le son simple

`csnd` est le pilote du « son simple » de la console : trente-deux voies de lecture (échantillons PCM ou ADPCM, ou bruit) et deux unités d'enregistrement, pilotées par des registres à `0x1EC03000` (`0x10103000` en physique). Un client (jusqu'à quatre) lui demande une zone de mémoire partagée, y écrit des **blocs de commandes**, puis envoie `ExecuteCommands` : le module lit les commandes et les traduit en écritures de registres. Il demande aussi au codec (`cdc:CSN`, voir [codec](codec.md)) d'allumer et de régler la sortie, et suit la veille de la console.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), l'aiguillage rejoué par `outils/emulate_dispatch.py --thumb`, l'assembleur de devkitPro (en mode Thumb : `local/analyse/csnd/code-thumb.asm`) et une copie de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002702`, version 5.0.0 (`v5120`), un titre de la CTRNAND (lu dans l'exheader ; nom `csnd`) ; la NAND porte aussi `csnd-safe` (`v5121`, non lu) |
| Fichier lu | `local/extrait/csnd/exefs/code.bin` et `exheader.bin` |
| Taille | 25 140 octets de code (`0x6234`, **surtout du Thumb**), 572 de données en lecture seule (`0x23c`), 268 de données (`0x10c`), 7 260 de mémoire à zéro (`0x1c5c`) ; pile de 4 096 octets ; priorité de départ 9 |
| Fonctions | 457 pour Ghidra (386 en Thumb), plus 2 entrées manquées en ARM (459) ; 115 nommées dans csnd.noms.tsv (les Thumb en label), 459 avec local/analyse/csnd/noms-proposes.tsv |
| Services offerts | `csnd:SND`, 4 sessions au plus (3dbrew et la boucle d'acceptation) |
| Services appelés | `cdc:CSN` (le codec), `ptm` (veille) ; plus `srv:` et le port `err:f`. L'exheader déclare `cdc:CSN` et `ptm:s` ; les chaînes `ptm:sysm`, `ptm:s`, `ptm:gets`, `ptm:u`, `ptm:play` sont dans la section en lecture seule |
| Autres accès | la page matérielle `0x1EC03000` (descripteur `0xFFE1EC03`). Aucune interruption déclarée |
| Dépendances déclarées | aucune |
| Fils | le fil principal, **un fil par session** (priorité 26, pile de `0x400` octets, jusqu'à quatre) |

## Partie 1 : le démarrage et la boucle

`entry` (`0x100000`) enchaîne `clear_bss` et les constructeurs, puis `csnd_main` (`0x100048`, Thumb, 360 octets), qui :

1. se déclare à `sm` (`srv_init`, `0x100374`), ouvre `ptm:s` (`ptm_s_open`, `0x100334`), crée le service `csnd:SND` (`csnd_register_services`, `0x100548`, **4 sessions**) ;
2. active les notifications (`srv_enable_notification`, `0x1003bc`) et s'abonne à `0x103`, `0x104` et `0x105` (`SRV_Subscribe`, `0x1039d0`) ; inscrit aussi `0x100` ;
3. attend sur deux poignées (le port, le sémaphore) par `svcWaitSynchronizationN` (`0x105158`) :
   - sémaphore : notification. `0x100` : arrêt. `0x103` (la veille est acceptée, d'après [ptm](ptm.md)) : `0x100b80` puis `PTMSYSM_NotifySleepPreparationComplete` après `0x1002f4`, qui appelle `0x10086c(1)` ; `0x104` (veille) : `0x100bf8` et `0x100c9c`, puis `0x100368` qui appelle `0x10086c(0)` ; `0x105` (réveil) : `csnd_on_wakeup` (`0x10069c` : `0x100d9c`, `mixer_leave_sleep` `0x105060`), puis `0x100368` ;
   - port : `csnd_accept_session` (`0x10047c`) : cherche une des quatre places libres (objets de `0x108264`, `0x50` octets chacun), crée **un fil de session** (`create_thread`, `0x100f9c`, priorité 26 d'après la constante `0x6c8da51a` de la bibliothèque, processeur par défaut, pile à `0x1083a8` + `0x400` par place). Plus de place : la session est refermée.
4. à la sortie : retire le service, `srv_exit`, ferme `ptm`.

## Partie 2 : les commandes

Le fil de session (`csnd_session_thread_main`, `0x104324`) appelle `csnd_session_loop` (`0x104378`, `svcReplyAndReceive`) qui appelle `csnd_handle_command` (`0x104634`, 492 octets, Thumb ; l'aiguillage passe par l'aide `__ARM_common_switch8`, `0x103414`). Un numéro inconnu rend `0xD9001830` moins 1. Les en-têtes entiers sont comparés pour les commandes 9, 10 et 11 ; pour les autres, seul le numéro compte. Les 12 commandes sont celles de 3dbrew (« CSND Services »).

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- |
| 1 | Initialize | `csnd_Initialize` | `0x104914` | `0x00010043` | crée un mutex et un bloc de mémoire partagée (`CreateMutex`, `CreateMemoryBlock`) ; range quatre déplacements reçus (`+0x24` à `+0x30` de l'objet de session) ; rend deux poignées (mutex, bloc) dans une traduction de deux poignées. |
| 2 | Shutdown | `csnd_Shutdown` | `0x102afc` | `0x00020040` | libère la session si elle est initialisée |
| 3 | ExecuteCommands | `csnd_ExecuteCommands` | `0x104a50` | `0x00030040` | poste la session et le déplacement dans la file `0x108124` (`command_queue_push_pair`, `0x104260`) puis signale le fil de traitement (`0x104280`, `svcSignalEvent` de l'événement `0x10802c`). Déplacement invalide : erreur construite avec résumé 5, module `0x2D`, description `0x3F0` |
| 4 | PlaySoundDirectly | `csnd_PlaySoundDirectly` | `0x104904` | `0x00040040` | `csnd_play_direct` (`0x10445c`) : joue une voix sans passer par la file ; refuse si le module n'est pas prêt (`0xC960B7F8`) ou si la voix est déjà prise (`0xC940B402`) |
| 5 | AcquireSoundChannels | `csnd_AcquireSoundChannels` | `0x1048e8` | `0x00050080` | rend le masque des voix disponibles (`0x10800c`) et l'inscrit dans la session |
| 6 | ReleaseSoundChannels | `csnd_ReleaseSoundChannels` | `0x104872` | `0x00060040` | met à zéro le masque de la session |
| 7 | AcquireCapUnit | `csnd_AcquireCapUnit` | `0x10489c` | `0x00070080` | cherche une des **deux** unités d'enregistrement libres (`0x104214`, masque `0x108004`) ; sinon erreur ; rend son numéro |
| 8 | ReleaseCapUnit | `csnd_ReleaseCapUnit` | `0x10484e` | `0x00080040` | libère l'unité si la session la tenait |
| 9 | FlushDataCache | `csnd_FlushDataCache` | `0x10487a` | `0x00090040` | vérifie que la zone est dans la mémoire linéaire (`0x103578`), puis `svcFlushProcessDataCache` (`0x54`) |
| 10 | StoreDataCache | `csnd_StoreDataCache` | `0x104894` | `0x000A0040` | idem, `svcStoreProcessDataCache` (`0x53`) |
| 11 | InvalidateDataCache | `csnd_InvalidateDataCache` | `0x10499c` | `0x000B0040` | idem, `svcInvalidateProcessDataCache` (`0x52`) |
| 12 | Reset | `csnd_Reset` | `0x104882` | `0x000C0040` | appelle trois fonctions de remise à zéro de l'état (`mixer_reset_entries`, `mixer_reset_channels`, `csnd_mixer_reset_codec_volume`) |

Les adresses des 12 fonctions de travail sont les mêmes dans le pseudo-code et dans l'émulation de l'aiguillage ; 3dbrew donne pour la requête 1 l'en-tête `0x00010140` (cinq paramètres) et pour 9 à 11 `0x00090082`, `0x000A0082`, `0x000B0082`, que le code compare entiers.

## Partie 3 : ExecuteCommands, le travail des commandes

`csnd_process_command_queue` (`0x10105c`, 1 034 octets, Thumb) lit les blocs de commandes dans la mémoire partagée. Chaque commande fait `0x20` octets ; le module en copie une, lit le **numéro de commande** dans le demi-mot d'octet 2 (octet haut : type 0 pour une voix, type 1 pour une unité d'enregistrement) et le **numéro de voix** dans les cinq bits du bas du mot d'octet 8 ; les paramètres sont les mots aux octets `0x0C`, `0x10`, `0x14`, `0x18` et `0x1C`. Chaque commande appelle une fonction d'accès au matériel (partie 4) :

| Type et numéro | Fonction | Registre de la voix touché |
| --- | --- | --- |
| 0, 0 | `csnd_cmd_set_play_state` (pause ou reprise) | état des voix de la session |
| 0, 1 | `csnd_cmd_set_pause_state` | idem, variante qui garde les paramètres |
| 0, 2 | `csnd_hw_channel_set_repeat_mode` | bits 12 et 13 du registre 0 |
| 0, 3 | `csnd_hw_channel_set_loop_buffer` | `+0x14` et `+0x10` |
| 0, 4 | `csnd_hw_channel_set_format` | bits 10 et 11 du registre 0 |
| 0, 5 | `csnd_hw_channel_set_bit7` | bit 7 du registre 0 |
| 0, 6 | `csnd_hw_channel_set_bit6` | bit 6 du registre 0 |
| 0, 7 | `csnd_hw_channel_set_low_bits` | trois bits du bas du registre 0 |
| 0, 8 | `csnd_hw_channel_set_reg2` | `+2` (reçoit l'opposé du paramètre) |
| 0, 9 | `csnd_cmd_set_volume` puis `csnd_hw_channel_set_regs_8_a` | `+8` et `+0xA`, plus le tampon de volumes du module |
| 0, 10 | `csnd_hw_channel_set_buffer` | `+0xC` et `+0x10` (adresse et taille) |
| 0, 11 | `csnd_hw_channel_set_adpcm_state` | `+0x18` et `+0x1C` |
| 0, 12 | `csnd_hw_channel_set_reg1c` | `+0x1C` (bit 31 à 1) |
| 0, 13 | `csnd_hw_channel_set_reg1c_bit31` | bit 31 de `+0x1C` |
| 0, 14 | `csnd_hw_channel_start_sample` (`0x1031ac`) | écrit toute la fiche de voix, **puis le registre 0 en dernier** (c'est lui qui lance la voix) ; le masque de 27 bits de la taille est celui de 3dbrew (`0x7FFFFFF`) |
| 0, 15 | `csnd_hw_channel_start_psg` (`0x10311c`) | une variante qui n'écrit que `+0` à `+0xA` (le bruit et le signal carré, interprété) |
| 1, 0 | `0x1035a8` | bit 15 du registre 0 de l'unité d'enregistrement |
| 1, 3 | `csnd_hw_capture_set_bit2` | bit 2 |

(Le tableau suit les numéros de la table de saut du pseudo-code, lue sur les octets de la table à `0x1010E8` ; la correspondance exacte avec les noms de 3dbrew n'est pas établie ici. Type 1 : 1 `csnd_hw_capture_set_control`, 2 `csnd_hw_capture_set_bit1`, 4 `csnd_hw_capture_set_timer`, 5 `csnd_hw_capture_set_buffer`, 6 `csnd_hw_capture_setup` ; type 2 numéro 0 : registres 0x10 et 0x14 ; type 3 numéro 0 : `csnd_cmd_update_info`.)

## Partie 4 : le matériel

La page `0x1EC03000` (virtuelle ; `0x10103000` en physique) est accédée sous un verrou (`lock_guard_enter` / `lock_guard_leave`, objet `0x1097dc`). Noms et rôles de 3dbrew (« CSND Registers »).

| Zone | Largeur | Ce que fait le module |
| --- | --- | --- |
| `0x1EC03000` | 16 bits | registre général : écrit en entier (`csnd_hw_write_master_reg0`) |
| `0x1EC03002` | 16 bits | bit 0 (`csnd_hw_set_master_bit0`) et bit 14 (`csnd_hw_set_master_bit14`) : l'activation et la coupure du son, d'après leur usage dans la veille (interprété) |
| `0x1EC03010`, `0x1EC03014` | 32 et 8 bits | écrits par `csnd_hw_write_master_reg10` et `csnd_hw_write_master_reg14` ; `0x1EC03010` est aussi lu une fois |
| `0x1EC03400` + `0x20` × voix | | les trente-deux voix : `+0` contrôle (format bits 10-11, mode de répétition bits 12-13, bits 6 et 7, lancement bits 14 et 15), `+2` volume ou reg 2, `+4`, `+6` (relus par `csnd_hw_channel_get_regs_4_6`), `+8`/`+0xA`, `+0xC` adresse du son, `+0x10` taille, `+0x14` adresse du second canal (stéréo), `+0x18`/`+0x1C` état ADPCM |
| `0x1EC03800` + `0x10` × unité | | les deux unités d'enregistrement : `+0` contrôle (bits 0, 2, 15), `+8`, `+0xC` tampon et taille |

Chaque fonction `csnd_hw_*` ne fait que quelques écritures. La séquence complète du lancement d'une voix est dans `csnd_hw_channel_start_sample`. Le module n'attend aucune interruption (aucune liée) ; l'état des voies est recopié dans la mémoire partagée par `csnd_cmd_update_info` (commande 0x300), et `mixer_tick` arrête les voies en fin de fondu.

La routine ARM de 2 236 octets à `0x1052fc`, pleine de calculs en virgule flottante, est `mixer_tick` : le fil de traitement l'appelle à chaque battement de la minuterie `0x108074`, et elle fait les fondus de volume et règle le volume du codec.

## Partie 5 : les services que csnd appelle

| Service | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- |
| `srv:` | `0x00010002`, `0x00020000`, `0x00030100`, `0x000400C0`, `0x00050100`, `0x00090040`, `0x000B0000` | les sept de [sm](sm.md) | `0x100fbc` et suivants | se déclarer, créer `csnd:SND`, notifications, ouvrir `cdc:CSN` et `ptm` |
| `cdc:CSN` | cmd 1 (sans paramètre) | `CDCCSN_cmd0001` | `0x1020da` | allumer la sortie du codec |
| | cmd 2 | `CDCCSN_cmd0002` | `0x103090` | l'éteindre |
| | cmd 3 (deux paramètres) | `CDCCSN_cmd0003` | `0x10209c` | régler une voie (volume, d'après le codec) |
| | cmd 4 (un paramètre) | `CDCCSN_cmd0004` | `0x10205c` | relire ce réglage |
| | cmd 5, 7 (un paramètre) | `CDCCSN_cmd0005`, `0007` | `0x1023be`, `0x1023f6` | bits de la sortie du codec |
| | cmd 9 | `CDCCSN_GetEventHandle` | `0x102106` | l'événement de réveil du codec |
| `ptm` | `0x04030042` | `PTMSYSM_NotifySleepPreparationComplete` | `0x10086c` | accuser réception de la veille |
| `err:f` (port) | `0x00010800` | `ERRF_Throw` | `0x102384` | erreur fatale |

Les numéros de commande de `cdc:CSN` sont ceux de la table de [codec](codec.md) ; je n'ai pas lu les en-têtes entiers, seulement le numéro de commande et le nombre de paramètres écrits par la fonction de construction d'en-tête (`ipc_set_header`, `0x103904`).

## Partie 6 : les appels système utilisés

Enveloppes ARM : `ControlMemory` (`0x01`), `ExitProcess` (`0x03`), `CreateThread` (`0x08`), `ExitThread` (`0x09`), `SleepThread` (`0x0A`), `CreateMutex` (`0x13`), `ReleaseMutex` (`0x14`), `CreateEvent` (`0x17`), `SignalEvent` (`0x18`), `CreateTimer` (`0x1A`), `SetTimer` (`0x1B`), `CancelTimer` (`0x1C`), `CreateMemoryBlock` (`0x1E`), `MapMemoryBlock` (`0x1F`), `UnmapMemoryBlock` (`0x20`), `CreateAddressArbiter` (`0x21`), `ArbitrateAddress` (`0x22`), `CloseHandle` (`0x23`), `WaitSynchronization1` (`0x24`), `WaitSynchronizationN` (`0x25`), `DuplicateHandle` (`0x27`), `GetProcessInfo` (`0x2B`), `ConnectToPort` (`0x2D`), `SendSyncRequest` (`0x32`, **une seule enveloppe** appelée par toutes les requêtes), `GetProcessId` (`0x35`), `Break` (`0x3C`), `AcceptSession` (`0x4A`), `ReplyAndReceive` (`0x4F`), `InvalidateProcessDataCache` (`0x52`), `StoreProcessDataCache` (`0x53`), `FlushProcessDataCache` (`0x54`). **Ni `BindInterrupt` ni `UnbindInterrupt`.**

## Partie 7 : qui appelle csnd

| Client | Pour quoi faire |
| --- | --- |
| [camera](camera.md) | `Initialize` pour le bruit d'obturateur (`CSND_Initialize`, `0x00010140`) |
| [errdisp](errdisp.md) | déclare `csnd:SND` |
| Pokémon X | n'utilise pas `csnd:SND` (aucune ligne dans la Carte des services du jeu) ; son passe par [dsp](dsp.md) |
| les applets | lecture de CWAV (3dbrew) ; non lus |

## Les désaccords relevés

- **3dbrew, nombre de sessions.** « 4 au maximum » : conforme (quatre places de `0x50` octets).
- **3dbrew, `Initialize`.** Requête `0x00010140` ; la réponse `0x00010043` du code donne deux poignées copiées.
- **Carte des services.** À vérifier avec `carte-des-services/donnees.js` (voir le rapport).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 12 commandes, leurs fonctions de travail et leurs en-têtes de réponse : le pseudo-code de `csnd_handle_command` et `emulate_dispatch.py --thumb` ; les 12 noms et numéros sont ceux de 3dbrew.
- La limite de quatre sessions : 3dbrew et la boucle de `csnd_accept_session` (`iVar5 < 4`).
- La page `0x1EC03000` et la disposition des voix (`+0x20` par voix à `0x1EC03400`) et des unités d'enregistrement (`+0x10` par unité à `0x1EC03800`) : les adresses lues dans les fonctions `csnd_hw_*` et la page « CSND Registers » de 3dbrew.
- Les trois appels de cache `0x52`, `0x53`, `0x54` : l'assembleur des enveloppes et les commandes 9 à 11.
- L'absence d'interruption : liste vide, pas de `svc 0x50`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens de chaque numéro de commande de voix (partie 3) : la correspondance numéro, fonction est lue sur la table de saut ; les noms des fonctions disent les registres, pas le nom des commandes de 3dbrew.
- Le rôle des bits 0 et 14 de `0x1EC03002`.
- Le rôle de la routine ARM de `0x1052fc`.
- Les noms `CDCCSN_*` : lus par le numéro de commande et le nombre de paramètres.
- Les noms de bibliothèque, reconnus par l'identité du code avec d'autres modules.

**Pas lu**
- Le corps de `csnd_process_command_queue` au-delà de l'aiguillage, les commandes de type 1 numéros 1 et 2, le fil de traitement, la file des commandes (`0x1033xx`), `csnd_play_direct` en détail.
- Les fonctions de 0x100b80 à 0x100d9c (veille et réveil) et `0x105060`.
- Le détail d'`Initialize` (offsets de la mémoire partagée).
- 349 fonctions sans nom, très petites pour la plupart (accesseurs de classes C++).

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 457 fonctions, projet Ghidra | `outils/ghidra_direct.py csnd` | quelques minutes |
| Table des 12 commandes | `outils/emulate_dispatch.py csnd 0x104634=csnd:SND --thumb` | quelques minutes |
| Assembleur | objdump de devkitPro, en ARM et en Thumb | immédiat |
| Exheader, constantes, noms de bibliothèque | `exh.py`, `lit.py`, `match.py` de `local/analyse/gpio/` | immédiat |
| 3dbrew : « CSND Services » et « CSND Registers » | web.archive.org, capture de 2022 | |

Les scripts et le brut sont dans `local/analyse/csnd/` et `local/analyse/gpio/` (non versionné).

**Pour reprendre.** `csnd.noms.tsv` est le fichier de graines. Les noms en `csnd_` sont les commandes reçues et le travail, `csnd_hw_` l'accès aux registres. Endroits à relire en premier : `csnd_process_command_queue` et `csnd_play_direct`.
