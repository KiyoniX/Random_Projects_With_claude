# pdn, l'alimentation et les horloges

`pdn` (power and domain control) donne accès aux registres d'horloge, de remise à zéro et de réveil du SoC. Il ne pilote aucune puce : cinq services minuscules lisent ou écrivent quelques octets de la page `0x1EC41000` (`0x10141000` en physique), un service par client : la mise en veille et le réveil (`ptm`), le DSP, l'I2S du codec, le GPU, les caméras. C'est le module le plus petit de la famille matérielle : 7 commandes en tout, aucun fil, aucune interruption.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), les cinq aiguillages rejoués par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002102`, version 2.0.0, un titre de la CTRNAND (lu dans l'exheader ; nom `pdn`) |
| Fichier lu | `local/extrait/pdn/exefs/code.bin` et `exheader.bin` |
| Taille | 9 060 octets de code (`0x2364`), 572 de données en lecture seule (`0x23c`), 144 de données (`0x90`), 1 660 de mémoire à zéro (`0x67c`) ; pile de 4 096 octets ; priorité de départ 9 |
| Fonctions | 113 (103 pour Ghidra et 10 entrées manquées), 9 en Thumb, 104 en ARM |
| Services offerts | cinq noms, une session au plus chacun : `pdn:s`, `pdn:d`, `pdn:i`, `pdn:g`, `pdn:c` (partie 2) |
| Services appelés | aucun : seulement `srv:` et le port `err:f`. La liste de services de l'exheader est vide |
| Autres accès | la page matérielle `0x1EC41000` (descripteur `0xFFE1EC41` de l'exheader). Aucune interruption déclarée |
| Dépendances déclarées | aucune |
| Fils | un seul : le fil principal. Pas de `CreateThread` ni de `ControlMemory` : pas de tas |

## Partie 1 : le démarrage

Le même enchaînement que [gpio](gpio.md) : `entry` (`0x100000`) appelle `clear_bss` (`0x100024`), les constructeurs (`run_static_initializers`, `0x100110`), `run_init_array`, puis `pdn_main` (`0x100164`, 912 octets). `construct_global_objects` (`0x101e64`) construit les petits objets globaux de la bibliothèque. Il n'y a pas d'initialisation du matériel : `pdn` ne touche aucun registre avant la première commande.

## Partie 2 : la boucle de serveur

`pdn_main` fait, dans l'ordre :

1. **Se déclarer à `sm`.** `srv_init` (`0x10121c`) : connexion au port `srv:` (en réessayant tant que le port n'existe pas), puis `SRV_RegisterClient`.
2. **Les noms.** Cinq appels à `SRV_RegisterService` (`0x1007cc`), dans l'ordre de la table de `0x103014` (nom, nombre de sessions au plus). Chaque service a **1** session au plus.
3. **Les notifications.** Un seul objet, la notification `0x100` (arrêt), par `register_notification_handler` (`0x10073c`). Pas de `SRV_Subscribe`.
4. **L'attente.** `svcReplyAndReceive` (`0x1005c8`) sur le tableau de poignées (à `0x1046e0`) : le sémaphore des notifications, puis les cinq ports, puis une poignée par session (5 au plus).
   - Indice 0 : `handle_srv_notification` (`0x100680`).
   - Indices 1 à 5, un port : `svcAcceptSession` (`0x1005b0`) ; la session reçoit son numéro de service (0 à 4).
   - Au-delà, une session : l'aiguillage appelle la fonction du service dans la table de `0x10303c`. **Chaque service a sa propre fonction** (contrairement à `gpio`, où une seule fonction sert tous les services).
5. **La fermeture d'une session** (résultat `0xC920181A`) : la poignée est refermée et la place libérée. Rien n'est remis à zéro dans le matériel : une horloge laissée allumée par un client reste allumée.
6. **La sortie.** Quand la notification `0x100` a mis l'octet `0x104064` à 1 et qu'il ne reste plus de session : `SRV_UnregisterService` cinq fois, `srv_exit`, retour.

| Service | Fonction d'aiguillage | Adresse | Registres touchés | Utilisé par |
| --- | --- | --- | --- | --- |
| `pdn:s` | `pdn_s_handle_command` | `0x101bfc` | `0x10141008`, `0x1014100C` | [ptm](ptm.md) |
| `pdn:d` | `pdn_d_handle_command` | `0x101aac` | `0x10141230` | [dsp](dsp.md) |
| `pdn:i` | `pdn_i_handle_command` | `0x101b74` | `0x10141220` | [codec](codec.md) |
| `pdn:g` | `pdn_g_handle_command` | `0x101b10` | `0x10141200` | [gsp](gsp.md) |
| `pdn:c` | `pdn_c_handle_command` | `0x101cb8` | `0x10141224` | [camera](camera.md) |

## Partie 3 : les commandes

Chaque fonction lit l'en-tête dans le tampon du fil, prend le numéro dans les 16 bits du haut et saute au cas. **Aucune ne vérifie l'en-tête entier** : seul le numéro compte, dans les cinq. Un numéro inconnu rend l'en-tête `0x00000040` et `0xD900182F`. Les noms viennent de 3dbrew (page « PDN Services », version du 20 janvier 2021) ; les adresses, les paramètres et les en-têtes de réponse sont lus dans le code et recoupés par `emulate_dispatch.py`.

Les fonctions de commande sont écrites en ligne dans les aiguillages `pdn:s`, `pdn:i` et `pdn:c` (pas de fonction séparée, `emulate_dispatch.py` écrit « dans l'aiguillage »). Elles ne sont donc pas toutes nommées individuellement.

| Service | N° | En-tête de réponse | Commande (3dbrew) | Ce que fait le code |
| --- | --- | --- | --- | --- |
| `pdn:s` | 1 | `0x000100C0` | GetWakeStatus | rend 0, puis `PDN_WAKE_ENABLE` (`0x10141008`) au mot 2 et `PDN_WAKE_REASON` (`0x1014100C`) au mot 3 |
| `pdn:s` | 2 | `0x00020040` | ConfigureWakeEvents(enable, reason) | mot 1 = E, mot 2 = R : `REASON = R & E`, puis `ENABLE = E`, puis `REASON = R & ~E` |
| `pdn:s` | 3 | `0x00030040` | Acknowledge | écrit le mot 1 dans `PDN_WAKE_REASON` |
| `pdn:d` | 1 | `0x00010040` | (enable, reset, deassertResetAfterReset) | `pdn_set_dsp_state` (`0x101d4c`), trois octets dans les mots 1 à 3 |
| `pdn:i` | 1 | `0x00010040` | I2S1 | écrit le bit 0 de `PDN_I2S_CNT` (`0x10141220`) avec l'octet du mot 1 |
| `pdn:i` | 2 | `0x00020040` | I2S2 | écrit le bit 1 de `PDN_I2S_CNT` avec l'octet du mot 1 |
| `pdn:g` | 1 | `0x00010040` | (enableClock, resetEngines, resetRegisters) | `pdn_set_gpu_state` (`0x101d98`), trois octets dans les mots 1 à 3 |
| `pdn:c` | 1 | `0x00010040` | SetCameraClock | écrit le bit 0 de `PDN_CAMERA_CNT` (`0x10141224`) avec l'octet du mot 1 |
| `pdn:c` | 2 | `0x00020080` | GetCameraClock | rend 0 et, au mot 2, le bit 0 de `PDN_CAMERA_CNT` |

En-têtes de requête de 3dbrew, qui tombent sur les mêmes numéros : `pdn:s` `0x00010000`, `0x00020080`, `0x00030040` ; `pdn:d` `0x000100C0` ; `pdn:i` `0x00010040` et `0x00020040` ; `pdn:g` `0x000100C0` ; `pdn:c` `0x00010040` et `0x00020000`.

### Les deux commandes à trois paramètres

Ce sont les deux seules commandes qui font plus qu'un octet.

`pdn_set_dsp_state(enable, reset, deassert)` (`0x101d4c`), registre `PDN_DSP_CNT` (`0x10141230`) :

1. Si `deassert` est vrai alors que `enable` est faux (`deassert & ~enable`), rend 0 : la commande répond alors `0xE0E02401` (niveau 28, résumé 7, module 9, description 1).
2. Sinon écrit `(reset ^ 1) | (enable << 1)` : le bit 0 est à 0 pendant la remise à zéro, le bit 1 allume l'horloge.
3. Si `reset` et `deassert` sont vrais, attend `delay_loop(0x30)` (`0x100e60` : une boucle qui retranche 2 jusqu'à 0, soit 24 tours) puis écrit `(enable << 1) | 1`, c'est-à-dire relâche la remise à zéro. Rend 1 : réponse 0.

`pdn_set_gpu_state(clock, resetEngines, resetRegisters)` (`0x101d98`), registre `PDN_GPU_CNT` (`0x10141200`) :

1. Si `(resetEngines | resetRegisters) & ~clock` n'est pas nul, rend 0 : réponse `0xE0E02401`.
2. Sinon écrit `(clock ? 0x10000 : 0) | (resetRegisters ? 0 : 0x7E) | (resetEngines ^ 1)`.
3. Si `resetEngines` ou `resetRegisters` est vrai : attend `delay_loop(0xC)` (douze unités, ce que 3dbrew appelle « 12 ARM11 cycle delay ») et écrit `(clock ? 0x10000 : 0) | 0x7F`, c'est-à-dire relâche toutes les remises à zéro.

Les bits suivent la table de 3dbrew (page « PDN Registers ») : pour `PDN_GPU_CNT`, bit 0 = bloc principal + VRAM + LCD, bits 1 à 6 = les autres blocs (0 = en remise à zéro), bit 16 = horloge ; pour `PDN_DSP_CNT`, voir 3dbrew (le bit 0 remet à zéro, le bit 1 allume).

## Partie 4 : le matériel

Une seule page, `0x1EC41000` (descripteur `0xFFE1EC41` de l'exheader, `0x10141000` en physique). Noms de 3dbrew :

| Adresse | Largeur | Nom 3dbrew | Lu ou écrit par le module |
| --- | --- | --- | --- |
| `0x1EC41008` | 32 bits | PDN_WAKE_ENABLE | lu (`pdn:s` 1) ; écrit (`pdn:s` 2) |
| `0x1EC4100C` | 32 bits | PDN_WAKE_REASON | lu (`pdn:s` 1) ; écrit (`pdn:s` 2 et 3) |
| `0x1EC41200` | 32 bits | PDN_GPU_CNT | écrit (`pdn:g` 1) |
| `0x1EC41220` | 8 bits | PDN_I2S_CNT | lu et écrit (`pdn:i` 1 et 2), un bit chacun |
| `0x1EC41224` | 8 bits | PDN_CAMERA_CNT | lu et écrit (`pdn:c` 1 et 2), bit 0 |
| `0x1EC41230` | 8 bits | PDN_DSP_CNT | écrit (`pdn:d` 1) |

Rien d'autre n'est lu ni écrit : en particulier pas `PDN_SLEEP_CNT` (`0x10141000`, que seul le noyau écrit), ni les registres « legacy » (mode DS et GBA). Aucune interruption : le réveil lève l'interruption `0x58` d'après 3dbrew, et c'est `ptm` qui l'attend (par un événement du noyau), pas `pdn`.

Les registres `PDN_WAKE_ENABLE` et `PDN_WAKE_REASON` listent les causes de réveil, un bit chacune (3dbrew) : touches (bit 1), couvercle ouvert (3), casque (4), WiFi (8), GPIO du couvercle (19), interruption du MCU (26), écran tactile (30), carte de jeu (31).

## Partie 5 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x103004` | le pointeur de fonction membre du gestionnaire de la notification `0x100` (`on_terminate_notification`, `0x102328`) |
| `0x103014` | la table des cinq services : pointeur vers le nom, nombre de sessions (1) |
| `0x10303C` | la table des fonctions d'aiguillage : `0x101bfc`, `0x101aac`, `0x101b74`, `0x101b10`, `0x101cb8` |
| `0x103050` | la table des contextes (cinq pointeurs vers `0x104000` à `0x104004`, un octet chacun, non lus par les fonctions) |
| `0x103064` | les noms des cinq services (`pdn:s`, `pdn:d`, `pdn:i`, `pdn:g`, `pdn:c`), puis `srv:` (`0x103094`), `srv:pm` (`0x103099`, jamais ouvert), `err:f` (`0x1030dc`) |
| `0x104058` | le nombre de poignées attendues (6 au départ, 11 au plus) |
| `0x104064` | l'octet d'arrêt (notification `0x100`) |
| `0x1045F4` | la table des sessions (numéro de service, contexte), 5 entrées |
| `0x1046E0` | le tableau des poignées attendues (sémaphore, cinq ports, cinq sessions) |

## Partie 6 : les services que pdn appelle

Seulement `srv:` et `err:f` ; les mêmes six requêtes que [gpio](gpio.md) (partie 6) : `SRV_RegisterClient`, `SRV_EnableNotification`, `SRV_RegisterService` (cinq appels), `SRV_UnregisterService`, `SRV_ReceiveNotification` et `ERRF_Throw` (`0x101400`, `svc 0x32` en `0x101424` ; `errf_report_error` `0x100e88` remplit l'en-tête puis saute vers `errf_send_fatal_error` `0x1010a4`). Les noms sont ceux de [sm](sm.md).

## Partie 7 : les appels système utilisés

Les mêmes que `gpio`, moins `BindInterrupt` et `UnbindInterrupt` (le module n'a aucune interruption) : `ExitProcess` (`0x03`), `SleepThread` (`0x0A`), `CreateAddressArbiter` (`0x21`), `ArbitrateAddress` (`0x22`), `CloseHandle` (`0x23`), `WaitSynchronization1` (`0x24`), `DuplicateHandle` (`0x27`), `GetProcessInfo` (`0x2B`), `ConnectToPort` (`0x2D`), `SendSyncRequest` (`0x32`), `GetProcessId` (`0x35`), `Break` (`0x3C`), `AcceptSession` (`0x4A`), `ReplyAndReceive` (`0x4F`). Les verrous reposent sur `ArbitrateAddress`.

## Partie 8 : qui appelle pdn

| Client | Service | Pour quoi faire (d'après leur fiche) |
| --- | --- | --- |
| [ptm](ptm.md) | `pdn:s` | veille et réveil : lit et règle les causes de réveil |
| [dsp](dsp.md) | `pdn:d` | `PDND_Control` (`0x000100C0`) : trois octets envoyés avant l'ouverture du DSP ; la fiche de `dsp` note les valeurs `(1, 1, 1)` puis `(0, 0, 0)` à l'initialisation, sans en donner le sens |
| [codec](codec.md) | `pdn:i` | l'horloge I2S du codec (3dbrew) |
| [gsp](gsp.md) | `pdn:g` | `(enableClock, resetEngines, resetRegisters)`, allumage et extinction du GPU |
| [camera](camera.md) | `pdn:c` | `PDN_cmd0001` : allumer ou éteindre l'horloge des caméras (sens interprété dans la fiche de `camera`) |

Les deux sens interprétés de `camera` et de `dsp` sont maintenant lus des deux côtés : `pdn:c` 1 écrit le bit 0 de `PDN_CAMERA_CNT`, et `pdn:d` 1 est la commande à trois octets de la partie 3.

## Les désaccords relevés

- **3dbrew, pdn:s 2.** La description de 3dbrew est celle de l'ordre exact lu dans le code : `REASON = R & E`, `ENABLE = E`, `REASON = R & ~E`. Aucun désaccord ; l'ordre est noté ici parce que les compilateurs le réordonnent parfois.
- **3dbrew, en-tête `0x000200000`.** La page note l'en-tête du GetCameraClock avec un zéro de trop (`0x000200000`) ; le code reçoit `0x00020000` (la réponse est `0x00020080`).
- **Carte des services.** À vérifier avec `carte-des-services/donnees.js` (voir le rapport).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les neuf commandes (3 + 1 + 2 + 1 + 2), leur en-tête de réponse et le fait que seul le numéro compte : le pseudo-code des cinq aiguillages d'un côté, `emulate_dispatch.py` de l'autre ; 3dbrew donne les mêmes numéros et les mêmes en-têtes de requête.
- Les cinq noms de service et leur limite d'une session : 3dbrew et les tables de `0x103014` et `0x103064`.
- La page matérielle `0x1EC41000` et les six registres touchés : le descripteur `0xFFE1EC41` d'un côté ; les adresses lues dans le code et la liste des registres de 3dbrew de l'autre. Pas d'autre accès.
- L'ordre des écritures de `ConfigureWakeEvents` : le pseudo-code et le texte de 3dbrew.
- Le fait que le module n'a pas d'interruption : la liste d'interruptions de l'exheader est vide, et le code n'appelle jamais `svc 0x50`.
- Le fait que le module n'ouvre aucun autre service : liste de services vide, et six requêtes pour six appels à `svc 0x32`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Les noms des paramètres des deux commandes à trois octets (`enable`, `reset`, `deassert` ; `clock`, `resetEngines`, `resetRegisters`) : ceux de 3dbrew, accordés aux formules lues dans le code.
- Que `delay_loop` soit une attente de quelques dizaines de cycles : la boucle `subs r0, r0, #2` est lue dans l'assembleur ; sa durée réelle dépend du cadencement.
- Que `0xE0E02401` (module 9, description 1) soit « paramètre invalide » : le résumé 7 de ce résultat est celui d'un argument invalide.
- Les noms des fonctions de bibliothèque, reconnus par l'identité du code avec des fonctions déjà nommées dans d'autres modules.

**Pas lu**
- Les cinq octets de contexte à `0x104000` : les fonctions ne les lisent pas ; leur rôle (s'il y en a un) est inconnu.
- Le corps des fonctions de bibliothèque : allocateurs, gestionnaire de réserve d'adresses, thread local.
- 43 fonctions de Ghidra et 10 entrées manquées n'avaient pas de nom ; toutes en ont un, haute dans la fiche ou moyenne dans local/analyse/pdn/noms-proposes.tsv ; la plupart viennent de la bibliothèque.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 103 fonctions, projet Ghidra | `outils/ghidra_direct.py pdn` | une demi-minute |
| Tables des cinq aiguillages | `outils/emulate_dispatch.py pdn 0x101bfc=pdn:s 0x101aac=pdn:d 0x101b74=pdn:i 0x101b10=pdn:g 0x101cb8=pdn:c` | immédiat |
| Assembleur du module | objdump de devkitPro (`code.asm`) | immédiat |
| Exheader | un petit script Python (`local/analyse/gpio/exh.py`) | immédiat |
| Pseudo-code avec les constantes des tables de littéraux | `local/analyse/gpio/lit.py` | immédiat |
| Noms de la bibliothèque | `local/analyse/gpio/match.py` (même code aux adresses près dans d'autres modules) | immédiat |
| 3dbrew : « PDN Services » (version du 20 janvier 2021, `oldid=21442`) et « PDN Registers » | web.archive.org, capture de 2022 | |

Les scripts et le brut sont dans `local/analyse/pdn/` et `local/analyse/gpio/` (non versionné).

**Pour reprendre.** `pdn.noms.tsv` est le fichier de graines. Les deux endroits à relire en premier : `pdn_set_dsp_state` et `pdn_set_gpu_state`, qui sont les seuls à avoir de la logique.
