# errdisp, l'écran d'erreur fatale de la console

`errdisp` est le programme qui affiche les écrans d'erreur de la console (« Une erreur est survenue… » avec un code et un bouton pour éteindre). Un jeu ne lui parle qu'au moment d'une erreur, par un port nommé `err:f` : il lui envoie une fiche d'erreur de 0x80 octets (commande `Throw`) et ne revient pas. Le module écoute ce port, retient la première erreur, puis dessine l'écran par le processeur graphique. Il tient aussi le rôle d'une application ordinaire : il écoute les notifications de veille et le bouton HOME.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`) et l'exécution de l'aiguillage (`outils/emulate_dispatch.py`). Les adresses sont celles du module chargé à `0x00100000`. La partie port et commandes est lue en détail ; la partie affichage (bibliothèque graphique, police, rédacteur de texte, environ 600 fonctions) est nommée fonction par fonction dans `local/analyse/errdisp/noms-proposes.tsv`, la plupart en confiance moyenne.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004003000008A02`, un titre de la CTRNAND (lu dans l'exheader) ; `ns` le lance au démarrage par `PMAPP_LaunchTitle`, avant le menu HOME ([ns](ns.md), partie 1) |
| Fichier lu | `local/extrait/errdisp/exefs/code.bin` et `exheader.bin` |
| Taille | 198 884 octets de code (49 pages), 36 584 de données en lecture seule, 16 000 de données, 10 816 de mémoire à zéro ; pile de 0x4000 |
| Fonctions | 709 pour Ghidra, plus 46 entrées manquées, moins 9 morceaux de la division et 1 code mort (`0x12bec0`) : 745 (11 en Thumb, 734 en ARM) ; 66 nommées dans `errdisp.noms.tsv`, 745 avec `local/analyse/errdisp/noms-proposes.tsv` |
| Service offert | le **port** `err:f` (créé par `svcCreatePort`, pas par `srv:`), 2 commandes |
| Services appelés (exheader) | `$hioFIO`, `$hostio0`, `$hostio1`, `fs:USER`, `gsp::Gpu`, `hid:USER`, `ndm:u`, `pxi:dev`, `APT:U`, `csnd:SND`, `gpio:NWM`, `ns:s`, `ptm:s`, `cfg:s` ; le code ouvre aussi `srv:` |
| Dépendances déclarées | aucune |
| Fils | le fil principal, et quatre fils créés par `create_thread` (`0x11e710`, seul appelant de `svcCreateThread` `0x1233a8`) : `errdisp_wait_flag` (`errdisp_suspend_application`), `ndm_suspend_thread_main` (`errdisp_quiet_system`), `apt_event_thread_main` (`apt_start_event_thread`) et `gsp_interrupt_thread_main` (`gsp_client_register_relay`) |

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle `clear_bss` (`0x100024`), `init_program_args` (`0x1001d8`), `init_runtime_and_srv` (`0x11f9a0`), `setup_heap` (`0x100780` : tas linéaire de 0x20000 octets, tas ordinaire rendu), `run_static_initializers` (`0x100110`, Thumb, 45 constructeurs) et `run_init_array` (`0x1001a4`), puis `errdisp_main` (`0x100174`), puis `svcExitProcess` (`0x10016c`).

`errdisp_main` :

1. `errdisp_init_system_info` (`0x100238`) ouvre cfg (`cfg_initialize`), range la région (`cfg_get_system_region`) et la langue (`cfg_get_language`) en `0x13d2f8+1` et `+2` (juste devant la table des messages `0x13d2fc`), puis referme cfg (`cfg_finalize`).
2. `create_errf_port` (`0x100910`) prépare l'état global (`0x13dfe0`), range l'adresse de la fonction qui dessine, `0x100260`, à `+0x49c`, puis appelle **`svcCreatePort`** (`0x100fa8`, appel système `0x47`) avec le nom `err:f` (chaîne à `0x139caa`, pointeur à `0x13db3c`) et **une** session au plus (dernier paramètre `1`).
3. `errdisp_serve` (`0x100984`) : la boucle (partie 2).
4. À la sortie : fermeture de la poignée du port (`+0x498`), nettoyage, retour.

## Partie 2 : la boucle

`errdisp_serve` (1 344 octets) attend avec `svcWaitSynchronizationN` (`0x11f168`) sur deux poignées : le **port** `err:f` (indice 0) et le **sémaphore des notifications** de `srv:` (indice 1, obtenu par `SRV_EnableNotification`, `0x1039b8`).

- **Indice 0.** `svcAcceptSession` (`0x100f90`) ouvre la session, puis `errf_session_receive_loop` (`0x102310`) la sert avec `svcReplyAndReceive` (`0x10345c`), une commande à la fois, sur une seule poignée. Avant de recevoir, il pose dans le stockage local un descripteur de tampon statique (`0x00400002` : tampon n° 0, 0x100 octets) qui pointe sur `ctx + 0x80`, et l'en-tête de réponse vide `0xFFFF0000`. Chaque commande passe par `errf_handle_command` (`0x103798`).
- **Indice 1.** `SRV_ReceiveNotification` (`0x1024e0`, en-tête `0x000B0000`) donne le numéro de la notification.

Le contexte `ctx` (`auStack_1c8` dans `errdisp_serve`, un peu plus de 0x1C8 octets sur la pile) a la disposition suivante, relevée dans `errf_handle_command` et `process_error_info` :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | la fiche d'erreur, 0x80 octets recopiés de la requête : genre (octet 0), code de résultat (`+4`), nombre (`+0xC`), et le reste de la fiche de 3dbrew |
| `+0x80` | la chaîne de l'utilisateur (`SetUserString`), reçue directement par le noyau dans le tampon statique, 0x100 octets |
| `+0x181` | drapeau « erreur générale à afficher » |
| `+0x182` | drapeau « carte retirée » |
| `+0x183` | « une erreur est à afficher » |
| `+0x184` | bit 31 du code de résultat (bit d'échec) |
| `+0x185` | drapeau de reprise (voir `process_error_info`) |

### Les notifications

`errdisp_serve` s'abonne (`SRV_Subscribe`, `0x11f18c`) à `0x101`, `0x103` et `0x106`, plus `0x204` une fois qu'une erreur a été retenue ; il traite aussi `0x100`. Les sens sont ceux que [ptm](ptm.md) et [ns](ns.md) donnent à ces numéros.

| Notification | Ce que fait le module |
| --- | --- |
| `0x100` | Lève l'octet d'arrêt (`+0x4A0` de l'état global) : la boucle se termine |
| `0x101` | Quelqu'un demande la veille : répond `PTMSYSM_ReplySleepQuery` (`0x1038f4`, en-tête `0x04020042`) avec l'octet `+0x4A3` de l'état global. Cet octet passe à 1 quand l'erreur a été dessinée : ensuite `errdisp` **s'oppose** à la veille |
| `0x103` | La veille est acceptée : pose l'octet `0x13DB38` (« en veille ») à 1 et envoie `PTMSYSM_NotifySleepPreparationComplete(1)` (`0x10393c`, en-tête `0x04030042`) |
| `0x106` | Le réveil est fini : remet cet octet à 0 et dort 0x1F78A40 ns (33 ms) |
| `0x204` | Le bouton HOME (d'après [ns](ns.md)) : si l'erreur est affichée, lance `0x10332c` et lève deux drapeaux (`+0x4A1`, `+0x4A4`) (interprété) |

## Partie 3 : les commandes d'`err:f`

`errf_handle_command` (`0x103798`, 240 octets) lit le numéro dans les 16 bits du haut de l'en-tête. L'exécution de l'aiguillage et le pseudo-code de Ghidra donnent les mêmes deux commandes :

| N° | En-tête de requête | Commande | Fonction | En-tête de réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- |
| 1 | `0x00010800` | Throw | `process_error_info` (`0x108208`) | `0x00010040` | Recopie les 0x80 octets de la requête dans le contexte, si aucune erreur n'est déjà retenue (`+0x181` et `+0x182` à 0) ou si le drapeau de reprise (`+0x185`) est levé ; sinon rien. Répond toujours résultat 0 |
| 2 | `0x00020042` | SetUserString | dans l'aiguillage | `0x00020040` | Vérifie l'en-tête (`0x00020042`) et que le descripteur de tampon statique porte le n° 0 (masque `0x3C0F` égal à 2). La chaîne a déjà été déposée dans `ctx + 0x80` par le noyau ; la commande n'y touche pas. Résultat 0 |

Un autre numéro, ou un en-tête incorrect, rend `0xD900182F` (numéro inconnu) ou `0xD9001830` (en-tête mauvais pour SetUserString) avec l'en-tête de réponse `0x00000040`. Ces deux valeurs sont des constantes lues à `0x103880` et `0x103884`.

### Throw pas à pas : `process_error_info` (`0x108208`)

Le registre `+4` de la fiche est le code de résultat ; ses champs sont : description (bits 0 à 9), module (bits 10 à 17), niveau et résumé (bits 21 à 31).

1. **Corriger le genre.** Si le module vaut `0x11` (le module des fichiers, d'après 3dbrew) et la description `0x399`, le genre devient **1** (mémoire corrompue).
2. **Réécrire certains codes.** Si le module est `0x11` et la description tombe dans `0x8C` à `0xA9` ou `0x122` à `0x13F`, ou, plus bas, dans `0xAA` à `0xB3`, le genre devient **2** (carte retirée), le code est réécrit (module `0x3B`, ou `0x3D` pour la dernière plage) et le drapeau de reprise `+0x185` est levé. Ce sont les erreurs de carte de jeu.
3. **Les drapeaux** selon le genre (octet 0) :

   | Genre | `+0x181` | `+0x182` | `+0x183` | `+0x184` |
   | --- | --- | --- | --- | --- |
   | 1 | 1 | 0 | 1 | 0 |
   | 2 | 0 | 1 | 1 | 0 |
   | 5 | 0 | 0 | 0 | 0 |
   | autre (0, 3, 4…) | 1 | 0 | 1 | bit 31 du code |

   Pour les genres « autres », si le module du code vaut `0x11`, le drapeau de reprise `+0x185` est aussi levé.

   Les genres de 3dbrew sont : 0 général, 1 mémoire corrompue, 2 carte retirée, 3 exception, 4 échec de résultat, 5 trace seulement.
4. **Les identifiants des programmes.** Si le numéro de processus (`+0xC`) est inférieur à 5 (un module du FIRM), le module range `+0xC << 8` à `+0x10` et une constante à `+0x14` ; sinon `fs_get_program_launch_info` (`0x114358`, FSUSER_GetProgramLaunchInfo) rend l'identifiant du programme fautif, rangé à `+0x10/+0x14` (le « PID » de l'écran), puis `apt_get_applet_info` (`0x114f8c`, APT_GetAppletInfo de l'applet 0x300, l'application) rend celui de l'application en cours, rangé à `+0x18/+0x1C` (l'« AID »).
5. **Genre 5 (trace).** Le module n'affiche rien : `errlog_write_entry` (`0x10851c`) écrit une entrée de 0x180 octets, horodatée et préfixée « [MP] », dans un fichier de l'archive montée sous « nandrw: » (`errlog_open`, `errlog_append`, `errlog_unmount`), et rend la main.

Ensuite `errdisp_serve` constate que `+0x183` est levé et, si la console n'est pas en veille, appelle la fonction qui dessine (`0x100260`, rangée à `+0x49c` de l'état global). Une fois dessinée, il lève `+0x4A3` (voir la notification `0x101`).

## Ce que Pokémon X envoie

Le jeu envoie **une** commande à `err:f` ([contrat des petits services](contrat-petits-services.md), partie 5) :

| Commande | Fonction du jeu | Fonction du module | Réponse | Ce que le programme de remplacement doit rendre |
| --- | --- | --- | --- | --- |
| Throw `0x00010800` | `0x124780` | `process_error_info` (`0x108208`) via `errf_handle_command` (`0x103798`) | `0x00010040`, résultat 0 | Accepter la connexion à `err:f`, lire les 0x80 octets, journaliser le code de résultat (`+4`), l'adresse (`+8`) et le genre (octet 0) ; répondre résultat 0. Le jeu n'attend rien d'autre et ne revient pas |

Les deux voies se recoupent sur trois points : le genre 2 (carte retirée) est bien le seul pour lequel le jeu réessaie quand le port est plein (le module accepte une seule session à la fois, et une session `err:f` est refermée par le jeu après l'envoi) ; le genre 5 est celui que le jeu n'attend pas (le module n'affiche rien) ; et l'en-tête et le nombre de mots (0x80 octets) sont les mêmes des deux côtés.

## Partie 4 : les appels système

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x11f350` |
| ExitProcess | `0x03` | `svcExitProcess` (cible du `b` final d'`entry`, octets `ef000003 e12fff1e`) | `0x10016c` |
| CreateThread | `0x08` | `svcCreateThread` | `0x1233a8` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x115c3c` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x1177d0` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x103444` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x1178f4` |
| CloseHandle | `0x23` | `svcCloseHandle` (octets `ef000023 e12fff1e`, cible des `b` de `errdisp_quiet_system` et `nss_close_session`) | `0x10343c` |
| WaitSynchronization1 | `0x24` | écrit sur place (`apt_lock_and_open_session` `0x11d448`, `join_thread` …) | |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x11f168` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x129c6c` |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x115c30` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x108024` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x114340` |
| SendSyncRequest | `0x32` | écrit sur place, à 59 endroits | |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x115c18` |
| Break | `0x3C` | `svcBreak` (octets `ef00003c e12fff1e`, cible du `b` final de `break_process` `0x11f240`) | `0x115c10` |
| CreatePort | `0x47` | `svcCreatePort` | `0x100fa8` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x100f90` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x10345c` |

Les 59 `SendSyncRequest` sont écrits sur place, un par fonction de requête ; chacune est nommée d'après l'en-tête, la Carte et la poignée (ouverte sous le nom du service) : srv: (`SRV_*`), ns:s (`NSS_ShutdownAsync`, `NSS_RebootSystem`, `NSS_SetApplicationCpuTimeLimit`), ptm (`PTMSYSM_*`), APT (`APT_GetSharedFont`, `APT_SetFatalErrDispMode`, `APT_Initialize`, `APT_Finalize`, `APT_GetLockHandle`, `APT_GetAppletInfo`, `APT_InquireNotification`, `APT_SleepSystem`, `APT_SendParameter`, `APT_CancelParameter`, `APT_GlanceParameter`, `APT_ReplySleepQuery`, `APT_ReplySleepNotificationComplete`), csnd:SND (`CSND_Initialize`, `CSND_Shutdown`, `CSND_ExecuteCommands`, `CSND_AcquireSoundChannels`, `CSND_ReleaseSoundChannels`, `CSND_Reset`), cfg (`CFG_GetConfigInfoBlk2`, `CFG_SecureInfoGetRegion`), ndm:u (`NDMU_SuspendScheduler`), gpio:NWM (`GPIONWM_SetData`), gsp::Gpu (`GSPGPU_*`), fs:USER et les fichiers (`FSUSER_*`, `FSFILE_*`), err:f (`ERRF_Throw`) et dsp::DSP (`DSP_*`, code de bibliothèque).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les deux commandes d'`err:f`, leurs en-têtes de réponse (`0x00010040`, `0x00020040`) et la fonction de `Throw` : l'exécution de l'aiguillage (`emulate_dispatch.py`, qui lit aussi `0x20000281` et `0x20000282`, les drapeaux `+0x181` et `+0x182`) et le pseudo-code de `errf_handle_command`.
- Le port : `svcCreatePort` (`0x47`) n'est appelé que par `0x100fa8`, qui n'a qu'un appelant (`create_errf_port`), et le nom `err:f` est la chaîne à `0x139caa`.
- Les genres et le contenu de `ctx` : les drapeaux se retrouvent dans `process_error_info` (pseudo-code) et dans les variables de `errdisp_serve` (`local_47` à `local_43`, à `ctx + 0x181` à `ctx + 0x185`), et les genres sont ceux de 3dbrew.
- Le tampon statique de `SetUserString` : descripteur `0x00400002` (lu à `0x1023c4`, tampon n° 0, 0x100 octets) et pointeur `ctx + 0x80`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens de la notification `0x204` (bouton HOME) et de l'opposition à la veille une fois l'erreur dessinée (octet `+0x4A3`) : déduit de l'ordre des appels et de [ptm](ptm.md) (réponse non nulle à `ReplySleepQuery` = veille refusée).
- Le module `0x11` comme le module des fichiers, et les plages de description : les nombres sont lus, la nature « erreurs de carte » vient de 3dbrew et du genre 2 qu'elles produisent.
- La fonction `errdisp_draw_error_screen` (`0x100260`) dessine : elle est passée à `create_errf_port`, appelée avec le contexte, et ses appels mènent aux textes « FATAL ERROR », « RESULT FAILURE » et aux registres d'exception selon le genre (chaînes lues).
- La durée de sommeil du réveil (0x1F78A40 ns, 33 ms), prise dans une constante.

**Pas lu**
- Le détail des fonctions de la bibliothèque graphique (validation d'état, uniformes, textures) : nommées par leur rôle apparent, non suivies ligne à ligne.
- Le contenu de la table de messages `0x13d2fc` et le chemin exact du fichier du journal.
- Le sens des vingt-huit accesseurs d'état d'APT (`apt_state_*`).
- Restent sans nom les accesseurs d'état d'APT nommés seulement d'après leur décalage (24 sur 28 ; quatre sont devenus `apt_get_app_id`, `apt_set_app_id`, `apt_get_app_attributes`, `apt_set_app_attributes`) ; 586 noms moyens (`local/analyse/errdisp/noms-proposes.tsv`).

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Découper le module (709 fonctions) | `outils/ghidra_direct.py errdisp` | 1 minute |
| Lire la table des commandes d'`err:f` | `outils/emulate_dispatch.py errdisp 0x103798=err:f --range 0-8` | 30 secondes |
| Lire le démarrage, la boucle, `Throw` | Claude, sur le pseudo-code avec les constantes déroulées | le gros du temps |

**Pour reprendre.** `errdisp.noms.tsv` est le fichier de graines : une adresse, `function` (ARM), un nom. Le pseudo-code brut est dans `local/analyse/errdisp/gh/`, non versionné.
