# Process9 et kernel9, le côté ARM9 du FIRM natif

La 3DS a deux processeurs. Toutes les autres fiches parlent de l'ARM11, où tournent le système et le jeu. Cette fiche parle de l'autre, l'ARM9 (un cœur ARM946E-S, jeu d'instructions ARMv5TE). Il ne fait tourner qu'un seul programme, Process9, au-dessus d'un petit noyau, kernel9. Process9 tient tout ce qui touche au stockage et à la sécurité : la carte SD, la NAND, la cartouche, les moteurs AES, SHA et RSA. Les modules de l'ARM11 (`fs`, `loader`, `am`, `ps`, `ptm`) lui parlent par le PXI, en passant par le module `pxi` (fiche [pxi](pxi.md)).

Pour Pokémon X sur PC, Process9 est la dernière marche : c'est lui qui trouve le contenu du jeu sur la carte SD ou la cartouche, le déchiffre et rend les octets du romfs. Cette fiche décrit ce chemin du côté ARM9 et dit ce qu'il faudra remplacer.

Fiche du 14 octobre 2026, produite avec Ghidra lancé directement sous Ubuntu (WSL), sur le FIRM natif dumpé de la NAND de la console. Ce n'est pas un module ARM11 : il n'y a ni `code.bin` à `0x00100000` ni pont REA. Les adresses sont les vraies adresses de l'ARM9 : kernel9 à partir de `0x08006800`, Process9 à partir de `0x08028000`.

## Carte d'identité

| | |
| --- | --- |
| Fichier lu | `local/dump/systeme/native.firm` (999 424 octets), section ARM9 extraite dans `local/extrait/firm/firm_2_08006000.bin` (566 272 octets, chargée à `0x08006000`) |
| Point d'entrée ARM9 | `0x0801B01C` d'après l'en-tête du FIRM : l'entrée de kernel9 (partie 1) |
| Chiffrement | la section est **déjà en clair** dans le dump ; l'en-tête de `0x800` octets qui la précède garde ses champs de clé chiffrés (partie 1) |
| Chargeur New 3DS | version `K9L2` (lue à `+0x50` de l'en-tête), code en clair à `0x0808A900`, 23 296 octets |
| kernel9 | `0x08006800` à `0x0801C100`, 88 320 octets ; 516 fonctions (497 pour Ghidra, plus 37 entrées qu'il a manquées et 16 trouvées à la main, moins 23 mots de données et les 11 relais de la table de vecteurs morte `0x0800E800`), nommées dans `kernel9.noms.tsv` (les noms de confiance moyenne restent en proposition) ; 40 appels système |
| Process9 | titre `0004013000003000`, NCCH de 452 608 octets à `0x0801C100` ; code non compressé, chargé à `0x08028000` |
| Taille de Process9 | 418 704 octets de code, 27 004 de données en lecture seule, 3 400 de données, 529 964 de mémoire à zéro (jusqu'à `0x08117080`) |
| Fonctions | 4 797 pour Ghidra (4 596 en Thumb, 201 en ARM), dont 385 nommées dans `process9.noms.tsv` |
| Fils de Process9 | 8 : le fil principal (il écoute le PXI), 4 fils de service, 2 fils d'interruptions, 1 fil d'appels différés (partie 3) |
| Services PXI | 9 canaux servis par 6 fonctions de service, 222 commandes ; un dixième canal pour parler à l'ARM11 (parties 4 et 5) |
| Matériel piloté | PXI, AES, SHA, RSA, NDMA, contrôleurs SD/MMC, cartouche (CTRCARD, NTRCARD, SPICARD), PRNG, registres de configuration (partie 9) |

## Partie 1 : la section ARM9 découpée

L'en-tête du FIRM (`native.firm`, 0x200 octets) donne trois sections. La troisième, à l'octet `0x69A00` du fichier, fait `0x8A400` octets et se charge à `0x08006000` : c'est celle de l'ARM9. Le point d'entrée ARM9 écrit dans l'en-tête est `0x0801B01C`.

Elle se découpe ainsi (lu par `outils/firm.py`, qui range les morceaux dans `local/extrait/firm/arm9/`) :

| Adresse | Taille | Morceau | Comment on le sait |
| --- | --- | --- | --- |
| `0x08006000` | `0x800` | en-tête du binaire ARM9 du New 3DS | champs de clé, compteur, taille en texte décimal à `+0x30` (`540928`), version `K9L2` à `+0x50` |
| `0x08006800` | `0x15900` | kernel9 | du code ARM dès `0x08006800` ; son point d'entrée `0x0801B01C` est celui de l'en-tête |
| `0x0801C100` | `0x6E800` | le NCCH de Process9 | le mot `NCCH` à `+0x100`, l'exheader nommé `Process9`, un exefs qui ne contient que `.code` |
| `0x0808A900` | `0x5B00` | le chargeur du New 3DS (« kernel9loader ») | du code Thumb et ARM qui touche les registres AES, SHA et SD/MMC, l'OTP (`0x10012000`, `0x10012100`), `CFG9_SYSPROT9` (`0x10000000`) et `0x10010010`/`0x10010014` |

Le binaire ARM9 annoncé par l'en-tête fait `0x84100` octets à partir de `0x08006800` : il finit pile à `0x0808A900`, à la fin du NCCH de Process9. kernel9 et Process9 sont donc la partie chiffrée sur la console ; le chargeur, derrière, est en clair.

**Chiffré ou en clair ?** Dans ce dump, kernel9 et Process9 sont lisibles tels quels : du code ARM et Thumb, des chaînes, l'en-tête `NCCH` de Process9. Sur la console, d'après 3dbrew (page FIRM, « New_3DS FIRM »), ce binaire est chiffré en AES-CTR, et c'est le chargeur qui le déchiffre au démarrage. Pour le chiffrement `K9L2`, la clé est tirée d'un secteur de la NAND (le secteur `0x96`, déchiffré avec une clé propre à la console issue de l'OTP) puis d'un bloc de l'en-tête ; le résultat va dans l'emplacement de clé `0x16`. Ces mécanismes ne sont décrits ici que de nom : aucune valeur n'est recopiée. Trois indices disent que c'est l'outil de dump qui a déchiffré :

- l'empreinte SHA-256 de la section, dans l'en-tête du FIRM, correspond aux octets **en clair** : l'outil a recalculé les empreintes ;
- le mot `+0x04` de l'en-tête du FIRM vaut `DEC` en ASCII ;
- `etat.json` note que la section ARM9 a été déchiffrée par GodMode9.

Le point d'entrée `0x0801B01C` de l'en-tête est donc probablement celui que l'outil a réécrit : sur la console, l'ARM9 entre d'abord dans le chargeur, qui se termine en sautant à une adresse rangée dans ses données (le mot à `0x08090234` vaut `0x0801B01C`). L'entrée d'origine du chargeur est probablement `0x0808AA3C` (supposé : aucune référence dans l'image) : c'est la seule routine qui masque les interruptions, pose les piles, appelle `0x0808AEC8` (régions et caches), `0x0808B004` (bss et constructeurs) et `0x0808AAD0` (le corps du chargeur), puis passe par `0x0808B024`, qui ne saute à l'adresse rendue (le mot `0x08090234`) que si elle est dans [`0x08006800`, `0x0808A900`).

**La version.** Le NCCH de Process9 porte la version 2 de son format et le titre `0004013000003000`. Le numéro de version du FIRM lui-même n'est pas dans la section ARM9 ; il est écrit par kernel11 dans la page de configuration (fiche de kernel11).

## Partie 2 : kernel9 en résumé

kernel9 est un noyau à part entière, plus petit que celui de l'ARM11 : pas de mémoire virtuelle (l'ARM946 n'a qu'une unité de protection), un seul processus, pas d'IPC par ports.

**Le démarrage.** `kernel9_entry` (`0x0801B01C`) masque les interruptions, règle le cache, met à zéro les registres, puis pose la pile de chaque mode du processeur. Les adresses de piles viennent d'une petite fonction en tête de la zone (`0x0801B000`) : `0x08002800`, `0x08002000`, `0x08001FC0`, dans la mémoire interne de l'ARM9. La fonction à `0x0801B144` lit `0x10000004`, `0x10010000` et `0x10010010`, écrit deux octets en `0x1FFFFFF1`/`0x1FFFFFF2`, pose le bit 0 de `0x10000200`, se synchronise avec l'ARM11 sur l'octet `0x1FFFFFF0`, puis règle l'unité de protection (huit régions de 12 octets lues dans la table `0x0801B3A0`), les mémoires rapides (c9 = `0x0A` et `0x20`) et le contrôle (c1 = `0x4307D`, vecteurs hauts). `kernel9_clear_bss_and_init` (`0x0801B114`) vide `0x10B4` octets en `0x08019600`, met à zéro les deux mots de `0x0817FFE0` et lance les 13 constructeurs statiques de la table `0x0801B424`, puis la suite saute à `kernel9_main` (`0x08006830`). Tout ce code de démarrage est placé à `0x0801B000`, et kernel9 réutilise ensuite cette zone : `kernel9_main` confie la mémoire de `0x0801B000` à `0x08028000` à un gestionnaire de mémoire (`0x0800F154`). Interprété : c'est le tas du noyau.

**`kernel9_main`** prépare les réserves d'objets du noyau (quinze appels à `slab_heap_init` `0x0800EEA8` : neuf pour les types d'objets, une pour les nœuds de liste `0x0801A250`, une pour les blocs de pages `0x0801A664` et quatre de rôle non identifié, `0x0801A514`, `0x0801A654`, `0x0801A4C4` et `0x0801A694`), les interruptions et les minuteries, puis crée Process9 :

1. `kernel9_move_process9_ncch` (`0x08007080`) recopie les `0x6E800` octets du NCCH de Process9 de `0x0801C100` vers `0x081117E0`, tout en haut de la mémoire étendue de l'ARM9 du New 3DS (elle finit à `0x08180000`). Il faut le déplacer : Process9 se charge à `0x08028000`, au milieu de l'endroit où son NCCH se trouve.
2. `kernel9_create_firm_processes` (`0x080070AC`) lit ce NCCH, crée un processus et son fil, et charge le code à `0x08028000`. La boucle est écrite pour plusieurs processus mais tourne une seule fois.
3. La zone de départ n'est effacée que si le NCCH n'a pas été déplacé, ce qui n'arrive pas ici.

**Les appels système.** `kernel9_svc_handler` (`0x08007874`) prend le numéro dans l'instruction `svc` et appelle la fonction de la table à `0x08007934` (126 cases, 40 remplies). Les 40 numéros remplis sont exactement ceux que 3dbrew marque « NF ARM9 » dans sa page SVC :

| Famille | Numéros |
| --- | --- |
| Fils | `0x08` CreateThread, `0x09` ExitThread, `0x0A` SleepThread, `0x0B` GetThreadPriority, `0x0C` SetThreadPriority, `0x37` GetThreadId |
| Synchronisation | `0x13` CreateMutex, `0x14` ReleaseMutex, `0x15` CreateSemaphore, `0x16` ReleaseSemaphore, `0x17` CreateEvent, `0x18` SignalEvent, `0x19` ClearEvent, `0x21` CreateAddressArbiter, `0x22` ArbitrateAddress, `0x24` WaitSynchronization1, `0x25` WaitSynchronizationN |
| Minuteries | `0x1A` CreateTimer, `0x1B` SetTimer, `0x1C` CancelTimer, `0x1D` ClearTimer, `0x28` GetSystemTick |
| Poignées et informations | `0x23` CloseHandle, `0x27` DuplicateHandle, `0x2A` GetSystemInfo, `0x2B` GetProcessInfo, `0x2C` GetThreadInfo |
| Interruptions | `0x50` BindInterrupt, `0x51` UnbindInterrupt |
| Cache | `0x52` InvalidateProcessDataCache, `0x53` StoreProcessDataCache, `0x54` FlushProcessDataCache |
| DMA | `0x55` StartInterProcessDma, `0x56` StopDma, `0x57` GetDmaState, `0x58` RestartDma |
| Divers | `0x3C` Break, `0x3D` OutputDebugString, `0x7B` Backdoor, `0x7C` KernelSetState |

Les trois appels de cache (`0x52` à `0x54`) n'acceptent que trois plages d'adresses physiques, lues dans leur code : la FCRAM (`0x20000000` à `0x30000000`), la mémoire de l'ARM9 (`0x08000000` à `0x08180000`) et la mémoire AXI (`0x1FF00000` à `0x1FF80000`). C'est la carte de ce que Process9 a le droit de toucher par DMA.

**Les fils du noyau.** Avant de créer Process9, `kernel9_main` crée trois fils du noyau : le fil de travail du cœur (`start_core_work_thread` `0x08006F98`, entrée `0x08008310`) et deux fils de gestionnaire de tâches (`worker_task_manager_initialize` `0x08006D70`, sur `0x0801A40C` et `0x0801A420`, entrée `0x08008294`). `kernel9_create_firm_processes` crée ensuite le fil principal de Process9 (`kprocess_run`). Le fil de démarrage passe enfin à la priorité `0x40` (`thread_become_idle` `0x080075C0`) et boucle sur l'attente d'interruption : c'est le fil inactif. Process9 crée tous les autres (partie 3).

## Partie 3 : le démarrage de Process9, jusqu'à l'écoute du PXI

`process9_entry` (`0x08028000`, en ARM) appelle cinq fonctions et ne revient jamais :

1. `clear_bss` (`0x08028020`) met à zéro la mémoire de `0x08095A54` à `0x08117080`.
2. `runtime_init_main_thread_info` (`0x08084D40`) remplit la fiche du fil principal.
3. `install_high_blob_and_heap` (`0x080858E0`) recopie un petit programme de `0xB1C` octets, rangé dans les données en lecture seule à `0x080941F0`, vers `0x0817F000` (`copy_high_blob_to_0817f000`, `0x0808556C`), puis prépare le tas. Ce petit programme vit tout en haut de la mémoire de l'ARM9, là où rien d'autre ne l'écrase. Il contient les fonctions qui écrivent dans les emplacements de clés de l'AES (keyY à `0x0817F388`, clé normale à `0x0817F410`), une lecture du registre `CFG9_UNITINFO` (`0x0817F400`, console de développement ou non) et la fin du lancement d'un autre FIRM (`0x0817F57C`). C'est le « binaire près de la fin de la mémoire de l'ARM9 » dont parle 3dbrew.
4. `run_static_initializers` (`0x0808E29C`) appelle les constructeurs d'objets globaux par une table de distances. L'un d'eux est `static_init_pxi_objects` (`0x0808CF38`), qui fabrique tout le PXI (partie 4).
5. `process9_main` (`0x08084C70`).

**`process9_main`**, dans l'ordre :

1. `memory_pools_init` (`0x08085698`) : deux réserves de blocs de `0x200` octets.
2. `start_deferred_call_thread` (`0x0802816C`) : un fil d'appels différés, priorité `0x30`.
3. `start_interrupt_event_threads` (`0x080280C4`) : deux fils, de priorité `0x07` (la plus haute de Process9) et `0x17`. Chacun tourne dans `interrupt_event_thread_loop` (`0x08028530`) : il attend une liste d'évènements liés à des interruptions et appelle la fonction inscrite pour celui qui s'est levé. C'est par eux que passent l'insertion d'une carte ou d'une cartouche.
4. Si le bit 0 de `CFG9_BOOTENV` (`0x10010000`) est levé, un drapeau est posé dans le petit programme du haut de la mémoire (`set_high_blob_flag`, `0x0804D3C4`). Le sens exact n'est pas lu ; 3dbrew dit que ce registre distingue un démarrage à froid d'un relancement de FIRM.
5. `hardware_init_once` (`0x08054CC4`) : la mise en route des périphériques, une seule fois.
6. `n3ds_keyslot_init` (`0x08085780`) : la préparation des clés propres au New 3DS. 3dbrew décrit ce que fait cette fonction : une clé de l'emplacement `0x05` (la NAND du New 3DS) est posée à partir d'un bloc des données de Process9, et ce bloc est effacé aussitôt. Le code lu pose bien un keyY dans l'emplacement 5 puis met le bloc à zéro, et fait ensuite des calculs RSA et SHA non suivis.
7. Un réglage dans `CFG9` (`0x08028270`) et un autre à `0x0805BCB4`, non lus.
8. Par `call_with_saved_context` (`0x0804CBEC`), qui garde les registres puis appelle une fonction : `storage_init_step` (`0x08028044`), la mise en route du stockage.
9. **`pxi_init` (`0x08028208`)** : le PXI est prêt et la poignée de main faite avec l'ARM11 (partie 4).
10. Une mise en route à `0x08028070`, non lue.
11. `aes_keyslots_setup_step` (`0x080854D4`) : un évènement, puis des keyY posés dans plusieurs emplacements à partir d'une valeur des données. Interprété : la préparation des clés de la NAND et du mode DS.
12. **`start_pxi_workers_and_listen` (`0x08085588`)** crée les quatre fils de service puis, sur le fil principal, entre dans `pxi_receiver_loop` (`0x08028638`). À partir de là, Process9 écoute.
13. Quand cette boucle se termine (l'ordre d'arrêt, partie 4), `wait_pxi_workers_then_firm_launch` (`0x0808543C`) attend la fin des fils de service, et `firm_launch_handler` (`0x08084D80`) prend la suite : il attend de l'ARM11 le numéro du FIRM à lancer (une suite de mots convenue dans la file PXI), le lit dans la NAND (chemin `exe:/%016llx/.firm`), vérifie sa signature RSA et que ses sections tombent dans des zones permises, efface des emplacements de clés et saute dans le petit programme du haut de la mémoire.

| Fil | Entrée | Priorité | Rôle |
| --- | --- | --- | --- |
| principal | `process9_entry` | (fixée par kernel9) | démarrage, puis `pxi_receiver_loop` : lit la file PXI |
| service A | `pxi_worker_thread_entry` (`0x08085B44`) | `0x2A` | file A : `pxi:mc` et `PxiFSR` |
| service B1, B2, B3 | `pxi_worker_thread_entry` | `0x2D` | file B : `PxiFS0`, `PxiFS1`, `PxiFSB`, `PxiPM`, `pxi:dev`, `pxi:am9`, `pxi:ps9` |
| interruptions ×2 | `interrupt_event_thread_loop` (`0x08028530`) | `0x07` et `0x17` | appellent la fonction inscrite pour chaque interruption |
| appels différés | `deferred_call_thread_entry` (`0x080282CC`) | `0x30` | non lu |

Les priorités viennent du dernier octet des constantes `0x6C8DA5xx` passées à `thread_start` (`0x08052F10`), comme dans `pxi` côté ARM11. Les piles des quatre fils de service font `0x2000` octets chacune, de `0x080DB3E0` à `0x080E33E0`.

## Partie 4 : le côté ARM9 du PXI

C'est le miroir exact de la fiche [pxi](pxi.md) : même découpage en canaux, même répartiteur, mêmes objets avec une table de méthodes. Les deux côtés utilisent visiblement la même bibliothèque.

**Les registres.** Côté ARM9, le PXI est à `0x10008000`. Les bits viennent de 3dbrew (« PXI Registers ») ; les accès sont lus dans le code.

| Adresse | Registre | Ce que Process9 en fait | Fonctions |
| --- | --- | --- | --- |
| `0x10008000` | `PXI_SYNC9`, octet 0 | lu : la valeur posée par l'ARM11 (poignée de main) | `pxi_sync_handshake_step` (`0x0802907C`) |
| `0x10008001` | octet 1 | écrit : la valeur pour l'ARM11 (1, puis 2) | la même |
| `0x10008003` | octet 3 | bit `0x80` (bit 31) : autoriser l'interruption locale ; bit `0x20` (bit 29) : déclencher l'interruption chez l'ARM11 | `pxi_sync_irq_set_bits` (`0x0802EC68`), `pxi_sync_irq_clear_bits` (`0x08029E10`), `pxi_trigger_arm11_irq` (`0x08031B8C`) |
| `0x10008004` | `PXI_CNT9` | bit 1 : file d'envoi pleine ; bit 8 : file de réception vide ; bits 2 et 10 : interruptions ; bit 3 : vider la file d'envoi | `pxi_send_fifo_is_full` (`0x08028EB0`), `pxi_recv_fifo_is_empty` (`0x08028F10`), `pxi_cnt_set_bits` (`0x08028F20`), `pxi_cnt_clear_bits` (`0x0804DFD8`) |
| `0x10008008` | `PXI_SEND9` | un mot vers l'ARM11 | `pxi_send_word` (`0x08058380`), `pxi_send_words` (`0x08031B98`) |
| `0x1000800C` | `PXI_RECV9` | un mot venu de l'ARM11 | `pxi_recv_word` (`0x08054244`), `pxi_recv_words` (`0x0802B134`) |

La fiche `pxi` laissait ouverte une question : comment l'interruption `0x50` de l'ARM11 est-elle déclenchée ? Réponse lue ici : Process9 lève le bit 29 de son `PXI_SYNC9` (le bit `0x20` de l'octet 3), juste après avoir écrit le numéro de canal (`pxi_send_channel_and_irq`, `0x08030C08`).

**Les interruptions.** `pxi_bind_interrupts` (`0x08028E1C`) attache trois évènements par `svcBindInterrupt` : l'interruption 12 de l'ARM9 (`PXI_SYNC`, avec le bit 31 de `PXI_SYNC9`), 13 (file d'envoi vide, bit 2 de `PXI_CNT9`) et 14 (file de réception non vide, bit 10). Les deux dernières ne servent que pendant la poignée de main.

**La poignée de main**, dans `pxi_init` (`0x08028208`) puis `pxi_handshake` (`0x0802868C`) : remise à zéro du matériel (`pxi_hw_reset`, `0x080285D4`, qui vide la file de réception en 16 lectures), puis le même ballet que côté ARM11, vu de l'autre côté. Process9 remplit la file d'envoi de zéros tant qu'elle n'est pas pleine et attend qu'un mot arrive ; il écrit 1 dans l'octet de synchronisation et attend que l'ARM11 en ait écrit au moins 1 ; il vide la file de réception ; il écrit 2 et attend 2.

**La réception**, sur le fil principal. `pxi_receiver_loop` (`0x08028638`) attend deux poignées par `svcWaitSynchronizationN` : l'évènement de l'interruption 12, et l'évènement d'arrêt (`0x08094D28`). Pour l'interruption, tant que la file n'est pas vide, `pxi_dispatcher_receive_message` (`0x08028FE6`) :

1. lit un mot, le numéro de canal (`pxi_recv_channel`, `0x08029E6C`) ; hors de 0 à 9, erreur ;
2. retrouve l'objet du canal dans la table du répartiteur (`0x080E3448`), vérifie qu'il n'est pas occupé, le marque occupé ;
3. lit l'en-tête puis le reste du message dans le tampon du canal (`pxi_recv_message_body`, `0x08029E3C`) ; le programme s'arrête si le message dépasse `0x40` mots ;
4. appelle la première méthode de l'objet. Si elle rend 1, le message est traité sur place. Sinon l'objet est mis dans la file de son fil de service, qui est réveillé.

**Le traitement.** `pxi_worker_loop` (`0x08028F56`) sort un objet de sa file et appelle sa deuxième méthode, `pxi_channel_run_handler` (`0x0808CDFC`). Celle-ci change la priorité du fil pour celle de la requête, appelle la fonction de service du canal avec le tampon du message, puis remet la priorité. Le fil envoie ensuite la réponse (`pxi_send_reply`, `0x0802B150`) : le numéro de canal, l'interruption chez l'ARM11, puis l'en-tête et les mots, dans le même tampon que la requête. C'est la troisième méthode qui est appelée en dernier.

**Les objets des canaux**, tous construits par `static_init_pxi_objects` (`0x0808CF38`) avec `pxi_channel_construct` (`0x0804CB9E`), qui range l'objet dans la table du répartiteur à la case de son numéro :

| Canal | Service ARM11 | Objet | File | Fonction de service | Argument | Table de méthodes |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `pxi:mc` | `0x080E34C4` | A | `pximc_dispatch_command` (`0x0808A270`) | `0x080DB3BC` | `0x0808E5B4` |
| 1 | `PxiFS0` | `0x080E350C` | B | `pxifs_dispatch_command` (`0x08087798`) | `0x08094D2C` | `0x0808E564` |
| 2 | `PxiFS1` | `0x080E352C` | B | `pxifs_dispatch_command` | `0x08094D30` | `0x0808E564` |
| 3 | `PxiFSB` | `0x080E354C` | B | `pxifs_dispatch_command` | `0x08094D34` | `0x0808E564` |
| 4 | `PxiFSR` | `0x080E34A4` | A | `pxifs_dispatch_command` | `0x08094D38` | `0x0808E564` |
| 5 | `PxiPM` | `0x080E356C` | B | `pxipm_dispatch_command` (`0x0808A42C`) | `0x080DB3C8` | `0x0808E540` |
| 6 | `pxi:dev` | `0x080E3588` | B | `pxidev_dispatch_command` (`0x08085FA0`) | `0x08094D20` | `0x0808E540` |
| 7 | `pxi:am9` | `0x080E35A4` | B | `pxiam_dispatch_command` (`0x0808AA78`) | `0x08094D3C` | `0x0808E58C` |
| 8 | `pxi:ps9` | `0x080E35C4` | B | `pxips_dispatch_command` (`0x0808A62C`) | `0x08094D21` | `0x0808E540` |
| 9 | (vers l'ARM11) | `0x080E3460` | aucune | réponse attendue à une requête de Process9 | | `0x0808E5D8` |

- Les numéros de canal sont ceux de la fiche `pxi` (table à `0x104044` de `pxi`), recoupés un à un : les deux côtés s'accordent sur les dix.
- Le tampon de message du canal `n` est à `0x080DAABC + n × 0x100`.
- Les quatre canaux `PxiFS` partagent la même fonction de service ; seul leur argument change (un mot par canal, à `0x08094D2C` à `0x08094D38`, qui pointe sur le contexte du système de fichiers).
- **Les deux files.** La file A (`0x080E3478`, un seul fil, priorité `0x2A`) sert `pxi:mc` et `PxiFSR` ; la file B (`0x080E34E0`, trois fils, priorité `0x2D`) sert tout le reste. Une requête de veille et les lectures « temps réel » de `fs` ne peuvent donc jamais attendre derrière une installation de titre ou une lecture ordinaire.
- **La priorité des requêtes de fichiers.** La table `0x0808E564` des canaux `PxiFS` a deux particularités. Sa première méthode (`pxi_channel_on_receive_with_fast_path`, `0x0808CEAC`) traite **SetPriority** (`0x0050`) sur place, sans passer par une file : la valeur reçue est rangée dans l'objet du canal et la réponse part aussitôt. Ensuite, quand un fil de service traite une requête du canal, sa priorité vient de cette valeur (`pxifs_channel_apply_priority`, `0x0808CF20`) : `-16` donne `0x20`, de `-8` à `-1` donne `0x2E`, `0` donne `0x2F`, de 1 à 8 donne `0x33`, au-delà `0x34`. Côté ARM11, `fs` envoie `-16` sur `PxiFSR` et `16` sur `PxiFSB` (fiche `fs`, partie 7) : `PxiFSR` passe avant tout, `PxiFSB` après tout. Les autres canaux ont une priorité fixe, `0x2D`.
- **Le canal 9**, dans l'autre sens. Quand Process9 a quelque chose à annoncer, `pxi_publish_notification_to_arm11` (`0x0805FF48`) envoie sur le canal 9 la commande `0x00010040` avec un numéro de notification, puis attend la réponse. C'est la commande que `pxi` relaie à `srv:` (fiche `pxi`, partie 6). Les numéros envoyés sont `0x207`, `0x208`, `0x209`, `0x20A` et `0x20B`, depuis cinq fonctions (`0x0802A560`, `0x08075944`, `0x08075984`, `0x08077198`, `0x080771E0`) qui ne sont pas lues ; leur sens non plus.
- **L'arrêt.** La commande 1 de `pxi:mc` (`pximc_shutdown_pxi`, `0x08086AD0`) signale l'évènement d'arrêt : la boucle de réception s'arrête et Process9 passe au lancement du FIRM suivant (partie 3, étape 13).
- **La veille.** Après chaque commande de `pxi:mc`, la troisième méthode de sa table (`pximc_channel_after_handler`, `0x08086B14`) lit l'état de veille posé par la commande 5 (`pximc_sleep`, `0x08086B50`) et, s'il le faut, appelle `svcKernelSetState`.

**Les tampons venus de l'ARM11.** Un message ne transporte jamais de données, seulement des descripteurs. Côté ARM11, le noyau a remplacé l'adresse virtuelle d'un tampon par une liste de morceaux de mémoire physique (fiche `pxi`, partie 4, étape 2). Process9 reçoit l'adresse physique de cette liste :

- `pxi_buffer_map` (`0x0804CF70`) recopie la liste dans un tampon à lui (au plus `0x200` octets) ;
- `phys_buffer_create` (`0x0805086C`) en fait un objet qu'on lit et écrit comme un fichier ; `phys_buffer_write` (`0x0804D280`) y écrit en vérifiant, pour chaque morceau, qu'il tombe dans la FCRAM (`0x20000000` à `0x30000000`) ; sinon Process9 s'arrête ;
- `pxi_buffer_unmap` (`0x0804CF30`) rend le tampon.

Les octets d'un fichier vont donc de Process9 directement dans la mémoire du module ARM11, par adresse physique.

## Partie 5 : les tables de commandes

Chaque fonction de service commence de la même façon : elle prend la moitié haute du premier mot (le numéro de commande) et saute par une table de saut ARM. Les tables ont été lues dans le code par `local/analyse/process9/tables.py`, puis recoupées par `crosscheck.py` avec la Carte des services (3dbrew) et avec la fiche `fs`.

Comment lire les colonnes :

- **En-tête vérifié** : l'en-tête complet que le code compare au premier mot avant de traiter. Process9 ne le vérifie que pour les commandes qui portent des descripteurs de tampon ; pour les autres, seul le numéro compte, et la colonne est vide.
- **Cas** : l'adresse où saute la table, à l'intérieur de la fonction de service (ce n'est pas une fonction à part).
- **Fonction appelée** : la première fonction appelée par le cas qui n'est pas un outil commun (projection des tampons, copie, verrous). Son nom est celui de la commande quand elle n'est appelée que par ce cas ; il est donc interprété.

**Bilan des recoupements**

| Service | Commandes dans Process9 | Dans 3dbrew | Concordent | Seulement dans Process9 | Seulement dans 3dbrew |
| --- | --- | --- | --- | --- | --- |
| `PxiFS0`, `PxiFS1`, `PxiFSB`, `PxiFSR` | 86 (`0x01` à `0x56`, une seule table) | 86 | 86 | 0 | 0 |
| `PxiPM` | 3 | 3 | 3 | 0 | 0 |
| `pxi:mc` | 12 (`0x01` à `0x0C`) | 4 | 4 | 8 | 0 |
| `pxi:dev` | 15 | 15 | 15 | 0 | 0 |
| `pxi:am9` | 93 (table de 110 cases, 17 renvoient « commande inconnue ») | 94 | 93 | 0 | 1 (`0x3A`) |
| `pxi:ps9` | 13 | 17 | 13 | 0 | 4 (`0x0401` à `0x0404`, l'amiibo) |
| **Total** | **222** | | | | |

- « Concordent » : même numéro, et même en-tête complet quand le code le vérifie. Les en-têtes vérifiés dans le code : 41 pour les fichiers, 9 pour `pxi:dev`, 43 pour `pxi:am9`, 7 pour `pxi:ps9` ; tous égaux à ceux de 3dbrew.
- **Avec la fiche `fs`** : `fs` envoie 83 requêtes à Process9 (fiche `fs`, partie 7). Les 83 existent dans la table, et pour les 41 dont Process9 vérifie l'en-tête, il est identique à celui que `fs` écrit. Trois commandes de Process9 ne sont jamais envoyées par `fs` : `0x3D` (FormatCardNorDevice), `0x53` et `0x54`.
- **Avec la fiche `loader`** : les trois en-têtes `PxiPM` que `loader` envoie (`0x00010082`, `0x00020200`, `0x00030080`) sont les trois commandes de `pxipm_dispatch_command`.
- **Avec la fiche `pxi`** : les commandes 1 (`ShutdownPxi`) et 5 (`Sleep`) de `pxi:mc`, les deux que `pxi` surveille au passage, sont bien celles qui arrêtent Process9 et règlent la veille.
- Les noms des commandes de fichiers sans nom dans la fiche `fs` (`PXIFS_cmd000A`, `PXIFS_cmd0015`…) peuvent maintenant être posés d'après 3dbrew, puisque les numéros concordent : par exemple `0x0A` CalculateFileHashSHA256, `0x15` CommitSaveData, `0x48` GetFileLastModified.

### `PxiFS0`, `PxiFS1`, `PxiFSB`, `PxiFSR` : `pxifs_dispatch_command` (`0x08087798`)

Une seule fonction ARM, de `0x08087798` à `0x0808A270` (environ 11 000 octets) ; table de saut à `0x080877BC`, 87 cases (la case 0 et tout numéro au-delà de `0x56` rendent l'en-tête `0x00000040` avec une erreur). Les commandes qui portent sur une archive ou un fichier ouvert retrouvent l'objet par sa poignée de 64 bits et appellent l'une de ses méthodes.

| N° | En-tête vérifié | Commande (3dbrew) | Cas | Fonction appelée | Envoyée par `fs` |
| --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x000101C2` | OpenFile | `0x08087930` | `pxifs_open_file` (`0x08031E14`) | `PXIFS_OpenFile` (`0x130958`) |
| `0x0002` | `0x00020142` | DeleteFile | `0x08087A50` | `pxifs_delete_file` (`0x08074310`) | `PXIFS_DeleteFile` (`0x12f494`) |
| `0x0003` | `0x00030244` | RenameFile | `0x08087B48` | `pxifs_rename_file` (`0x08074350`) | `PXIFS_RenameFile` (`0x12f5f4`) |
| `0x0004` | `0x00040142` | DeleteDirectory | `0x08087CFC` | `pxifs_delete_directory` (`0x0807444C`) | `PXIFS_DeleteDirectory` (`0x12fb50`) |
| `0x0005` | `0x00050202` | CreateFile | `0x08087DF4` | `pxifs_create_file` (`0x080742C4`) | `PXIFS_CreateFile` (`0x12f410`) |
| `0x0006` | `0x00060182` | CreateDirectory | `0x08087F0C` | `pxifs_create_directory` (`0x08074408`) | `PXIFS_CreateDirectory` (`0x12fafc`) |
| `0x0007` | `0x00070244` | RenameDirectory | `0x08088010` | `pxifs_rename_directory` (`0x0807448C`) | `PXIFS_RenameDirectory` (`0x12fc00`) |
| `0x0008` | `0x00080102` | OpenDirectory | `0x080881C4` | `pxifs_open_directory` (`0x08073F7C`) | `PXIFS_OpenDirectory` (`0x12f86c`) |
| `0x0009` | `0x00090142` | ReadFile | `0x080882CC` | `pxifs_read_file` (`0x08053B08`) | `PXIFS_ReadFile` (`0x1309cc`) |
| `0x000A` | `0x000A00C2` | CalculateFileHashSHA256 | `0x08088378` | `pxifs_calculate_file_hash_sha256` (`0x080746C8`) | `PXIFS_cmd000A` (`0x12fd28`) |
| `0x000B` | `0x000B0182` | WriteFile | `0x08088404` | `pxifs_write_file` (`0x08053048`) | `PXIFS_WriteFile` (`0x130a5c`) |
| `0x000C` | `0x000C0104` | CalcSavegameMAC | `0x080884D8` | `pxifs_calc_savegame_mac` (`0x08074504`) | `PXIFS_cmd000C` (`0x12fe08`) |
| `0x000D` |  | GetFileSize | `0x080885DC` | `pxifs_get_file_size` (`0x0805ABC4`) | `PXIFS_GetFileSize` (`0x12f6b4`) |
| `0x000E` |  | SetFileSize | `0x08088610` | `pxifs_set_file_size` (`0x08031EB8`) | `PXIFS_SetFileSize` (`0x12f6f0`) |
| `0x000F` |  | CloseFile | `0x0808864C` | `pxifs_close_file` (`0x0805D984`) | `PXIFS_CloseFile` (`0x130a2c`) |
| `0x0010` | `0x001000C2` | ReadDirectory | `0x08088680` | `pxifs_read_directory` (`0x08074600`) | `PXIFS_ReadDirectory` (`0x12f8cc`) |
| `0x0011` |  | CloseDirectory | `0x08088724` | `pxifs_close_directory` (`0x08074064`) | `PXIFS_CloseDirectory` (`0x12f930`) |
| `0x0012` | `0x001200C2` | OpenArchive | `0x08088758` | `archive_manager_open` (`0x0805AD1C`) | `PXIFS_OpenArchive` (`0x12514c`) |
| `0x0013` | `0x00130102` | HasFile | `0x080888E8` | `pxifs_has_file` (`0x0807454C`) | `PXIFS_cmd0013` (`0x1308f8`) |
| `0x0014` | `0x00140102` | HasDirectory | `0x080889EC` | `pxifs_has_directory` (`0x080743C8`) | `PXIFS_cmd0014` (`0x12f80c`) |
| `0x0015` |  | CommitSaveData | `0x08088AF8` | `archive_control` (`0x0804CEB4`) | `PXIFS_cmd0015` (`0x12f960`) |
| `0x0016` |  | CloseArchive | `0x08088B44` | `pxifs_close_archive` (`0x08059B88`) | `PXIFS_CloseArchive` (`0x12f780`) |
| `0x0017` |  | LockArchive | `0x08088B70` |  | `PXIFS_cmd0017` (`0x1300c8`) |
| `0x0018` |  | GetCardType | `0x08088C1C` | `pxifs_get_card_type` (`0x08075EF4`) | `PXIFS_GetCardType` (`0x12f680`) |
| `0x0019` |  | GetSdmcArchiveResource | `0x08088C48` | `pxifs_get_sdmc_archive_resource` (`0x08076514`) | `PXIFS_GetSdmcArchiveResource` (`0x130480`) |
| `0x001A` |  | GetNandArchiveResource | `0x08088C78` | `pxifs_get_nand_archive_resource` (`0x08076506`) | `PXIFS_GetNandArchiveResource` (`0x130440`) |
| `0x001B` |  | GetSdmcFatFsError | `0x08088CA8` | `pxifs_get_sdmc_fat_fs_error` (`0x08076360`) | `PXIFS_GetSdmcFatfsError` (`0x12ff3c`) |
| `0x001C` |  | IsSdmcDetected | `0x08088CCC` | `pxifs_is_sdmc_detected` (`0x0802F054`) | `PXIFS_IsSdmcDetected` (`0x12fa1c`) |
| `0x001D` |  | IsSdmcWritable | `0x08088CF8` | `pxifs_is_sdmc_writable` (`0x08031030`) | `PXIFS_IsSdmcWritable` (`0x12fa50`) |
| `0x001E` | `0x001E0042` | GetSdmcCid | `0x08088D24` | `pxifs_get_sdmc_cid` (`0x08074F02`) | `PXIFS_GetSdmcCid` (`0x12f56c`) |
| `0x001F` | `0x001F0042` | GetNandCid | `0x08088D84` | `pxifs_get_nand_cid` (`0x08074EB4`) | `PXIFS_GetNandCid` (`0x12f4e4`) |
| `0x0020` |  | GetSdmcSpeedInfo | `0x08088DE4` | `pxifs_get_sdmc_speed_info` (`0x08076350`) | `PXIFS_GetSdmcSpeedInfo` (`0x12fcf4`) |
| `0x0021` |  | GetNandSpeedInfo | `0x08088E18` | `pxifs_get_nand_speed_info` (`0x08076346`) | `PXIFS_GetNandSpeedInfo` (`0x12fcc0`) |
| `0x0022` | `0x00220042` | GetSdmcLog | `0x08088E4C` | `pxifs_get_sdmc_log` (`0x08074F28`) | `PXIFS_GetSdmcLog` (`0x12f5b0`) |
| `0x0023` | `0x00230042` | GetNandLog | `0x08088EAC` | `pxifs_get_nand_log` (`0x08074EDA`) | `PXIFS_GetNandLog` (`0x12f528`) |
| `0x0024` |  | ClearSdmcLog | `0x08088F0C` | `pxifs_clear_sdmc_log` (`0x08075FA2`) | `PXIFS_ClearSdmcLog` (`0x12f758`) |
| `0x0025` |  | ClearNandLog | `0x08088F2C` | `pxifs_clear_nand_log` (`0x08075F98`) | `PXIFS_ClearNandLog` (`0x12f730`) |
| `0x0026` |  | CardSlotIsInserted | `0x08088F4C` | `pxifs_card_slot_is_inserted` (`0x080763F0`) | `PXIFS_CardSlotIsInserted` (`0x130094`) |
| `0x0027` |  | CardSlotPowerOn | `0x08088F78` | `pxifs_card_slot_power_on` (`0x08076264`) | `PXIFS_CardSlotPowerOn` (`0x12fac8`) |
| `0x0028` |  | CardSlotPowerOff | `0x08088FA4` | `pxifs_card_slot_power_off` (`0x08076338`) | `PXIFS_CardSlotPowerOff` (`0x12fc8c`) |
| `0x0029` |  | CardSlotGetIFPowerStatus | `0x08088FD0` | `pxifs_card_slot_get_if_power_status` (`0x080764F8`) | `PXIFS_CardSlotGetCardIFPowerStatus` (`0x130658`) |
| `0x002A` |  | CardNorDirectCommand | `0x08088FFC` | `pxifs_card_nor_direct_command` (`0x0805DAF0`) | `PXIFS_CardNorDirectCommand` (`0x1302b8`) |
| `0x002B` |  | CardNorDirectCommandWithAddress | `0x08089020` | `pxifs_card_nor_direct_command_with_address` (`0x0807B53C`) | `PXIFS_CardNorDirectCommandWithAddress` (`0x1307d0`) |
| `0x002C` | `0x002C0082` | CardNorDirectRead | `0x08089048` | `pxifs_card_nor_direct_read` (`0x0807B430`) | `PXIFS_CardNorDirectRead` (`0x12fe74`) |
| `0x002D` | `0x002D00C2` | CardNorDirectReadWithAddress | `0x080890CC` | `pxifs_card_nor_direct_read_with_address` (`0x08052D4E`) | `PXIFS_CardNorDirectReadWithAddress` (`0x130600`) |
| `0x002E` | `0x002E0082` | CardNorDirectWrite | `0x08089158` |  | `PXIFS_CardNorDirectWrite` (`0x130048`) |
| `0x002F` | `0x002F00C2` | CardNorDirectWriteWithAddress | `0x080891A4` | `pxifs_card_nor_direct_write_with_address` (`0x0807B4E0`) | `PXIFS_CardNorDirectWriteWithAddress` (`0x13070c`) |
| `0x0030` | `0x003000C2` | CardNorDirectRead_4xIO | `0x0808924C` | `pxifs_card_nor_direct_read_4x_io` (`0x0807B592`) | `PXIFS_CardNorDirectRead_4xIO` (`0x130388`) |
| `0x0031` | `0x00310082` | CardNorDirectCpuWriteWithoutVerify | `0x080892C8` | `pxifs_card_nor_direct_cpu_write_without_verify` (`0x0807B2A4`) | `PXIFS_CardNorDirectCpuWriteWithoutVerify` (`0x130884`) |
| `0x0032` |  | CardNorDirectSectorEraseWithoutVerify | `0x08089354` | `pxifs_card_nor_direct_sector_erase_without_verify` (`0x08052A70`) | `PXIFS_CardNorDirectSectorEraseWithoutVerify` (`0x1308c8`) |
| `0x0033` |  | GetProductInfo | `0x08089374` | `pxifs_get_product_info` (`0x08076934`) | `PXIFS_cmd0033` (`0x12f9c0`) |
| `0x0034` |  | SetCardSpiBaudrate | `0x080893AC` | `pxifs_set_card_spi_baudrate` (`0x0807A25C`) | `PXIFS_SetCardSpiBaudRate` (`0x130228`) |
| `0x0035` |  | SetCardSpiBusMode | `0x080893C8` | `pxifs_set_card_spi_bus_mode` (`0x0807A22C`) | `PXIFS_SetCardSpiBusMode` (`0x12ff70`) |
| `0x0036` |  | SendInitializeInfoTo9 | `0x080893E4` | `pxifs_send_initialize_info_to9` (`0x0807B3C0`) | `PXIFS_SendInitializeInfoTo9` (`0x130358`) |
| `0x0037` |  | CreateExtSaveData | `0x08089404` | `pxifs_create_ext_save_data` (`0x08077454`) | `PXIFS_cmd0037` (`0x12fec4`) |
| `0x0038` |  | DeleteExtSaveData | `0x08089450` | `pxifs_delete_ext_save_data` (`0x08077474`) | `PXIFS_cmd0038` (`0x12ff00`) |
| `0x0039` | `0x00390102` | EnumerateExtSaveData | `0x0808949C` | `pxifs_enumerate_ext_save_data` (`0x0807748C`) | `PXIFS_cmd0039` (`0x1302f0`) |
| `0x003A` |  | GetSpecialContentIndex | `0x08089528` | `pxifs_get_special_content_index` (`0x08042094`) | `PXIFS_cmd003A` (`0x1304c0`) |
| `0x003B` | `0x003B00C2` | GetLegacyRomHeader | `0x08089560` | `pxifs_get_legacy_rom_header` (`0x08074F8C`) | `PXIFS_cmd003B` (`0x130154`) |
| `0x003C` | `0x003C0102` | GetLegacyBannerData | `0x080895C8` | `pxifs_get_legacy_banner_data` (`0x08075000`) | `PXIFS_cmd003C` (`0x130260`) |
| `0x003D` |  | FormatCardNorDevice | `0x08089628` | `pxifs_format_card_nor_device` (`0x0807643C`) | non |
| `0x003E` |  | DeleteSdmcRoot | `0x08089750` | `pxifs_delete_sdmc_root` (`0x0807562C`) | `PXIFS_DeleteSdmcRoot` (`0x12f998`) |
| `0x003F` |  | DeleteAllExtSaveDataOnNand | `0x08089774` | `pxifs_delete_all_ext_save_data_on_nand` (`0x08077710`) | `PXIFS_cmd003F` (`0x1305a8`) |
| `0x0040` |  | InitializeCtrFilesystem | `0x08089798` | `pxifs_initialize_ctr_filesystem` (`0x08074C78`) | `PXIFS_InitializeCtrFileSystem` (`0x1305d8`) |
| `0x0041` |  | CreateSeed | `0x080897B8` | `pxifs_create_seed` (`0x08075994`) | `PXIFS_CreateSeed` (`0x12f46c`) |
| `0x0042` | `0x00420042` | GetSdmcCtrRootPath | `0x080897DC` | `pxifs_get_sdmc_ctr_root_path` (`0x08075850`) | `PXIFS_GetSdmcCtrRootPath` (`0x1301a4`) |
| `0x0043` |  | GetArchiveResource | `0x08089844` | `pxifs_get_archive_resource` (`0x08076400`) | `PXIFS_GetArchiveResource` (`0x130104`) |
| `0x0044` | `0x00440002` | ExportIntegrityVerificationSeed | `0x08089878` | `pxifs_export_integrity_verification_seed` (`0x08075A70`) | `PXIFS_ExportIntegrityVerificationSeed` (`0x13080c`) |
| `0x0045` | `0x00450002` | ImportIntegrityVerificationSeed | `0x080898FC` | `pxifs_import_integrity_verification_seed` (`0x08075AD0`) | `PXIFS_ImportIntegrityVerificationSeed` (`0x130848`) |
| `0x0046` | `0x00460102` | GetLegacySubBannerData | `0x08089A9C` | `pxifs_get_legacy_sub_banner_data` (`0x080750CC`) | `PXIFS_GetLegacySubBannerData` (`0x1303e0`) |
| `0x0047` | `0x00470042` | GenerateRandomBytes | `0x08089B0C` | `pxifs_generate_random_bytes` (`0x0804D0CC`) | `PXIFS_cmd0047` (`0x124ce4`) |
| `0x0048` | `0x004800C2` | GetFileLastModified | `0x08089B58` | `archive_control` (`0x0804CEB4`) | `PXIFS_cmd0048` (`0x12f7b0`) |
| `0x0049` | `0x00490102` | ReadSpecialFile | `0x08089C18` | `pxifs_read_special_file` (`0x0807469C`) | `PXIFS_cmd0049` (`0x12fba0`) |
| `0x004A` |  | GetSpecialFileSize | `0x08089CA8` | `pxifs_get_special_file_size` (`0x08074B80`) | `PXIFS_cmd004A` (`0x1301e8`) |
| `0x004B` |  | StartDeviceMoveAsSource | `0x08089CD8` | `pxifs_start_device_move_as_source` (`0x080751DC`) | `PXIFS_StartDeviceMoveAsSource` (`0x13056c`) |
| `0x004C` |  | StartDeviceMoveAsDestination | `0x08089D10` | `pxifs_start_device_move_as_destination` (`0x080753A4`) | `PXIFS_StartDeviceMoveAsDestination` (`0x13068c`) |
| `0x004D` | `0x004D01C4` | ReadFileSHA256 | `0x08089D58` | `pxifs_read_file_sha256` (`0x08074738`) | `PXIFS_cmd004D` (`0x12fd78`) |
| `0x004E` | `0x004E0204` | WriteFileSHA256 | `0x08089E58` | `pxifs_write_file_sha256` (`0x08074A00`) | `PXIFS_cmd004E` (`0x12ffa8`) |
| `0x004F` |  | SetCtrCardLatencyParameter | `0x08089F7C` | `pxifs_set_ctr_card_latency_parameter` (`0x08076524`) | `PXIFS_cmd004F` (`0x125450`) |
| `0x0050` |  | SetPriority | `0x08089FA0` |  | `PXIFS_SetPriority` (`0x1254f4`) |
| `0x0051` |  | SwitchCleanupInvalidSaveData | `0x08089FB4` | `pxifs_switch_cleanup_invalid_save_data` (`0x080754D0`) | `PXIFS_SwitchCleanupInvalidSaveData` (`0x1306d4`) |
| `0x0052` | `0x00520042` | EnumerateSystemSaveData | `0x08089FD4` | `pxifs_enumerate_system_save_data` (`0x08077218`) | `PXIFS_cmd0052` (`0x13051c`) |
| `0x0053` |  | (sans nom) | `0x0808A04C` |  | non |
| `0x0054` |  | (sans nom) | `0x0808A078` |  | non |
| `0x0055` | `0x00550082` | ReadNandReport | `0x0808A098` | `pxifs_read_nand_report` (`0x08074F50`) | `PXIFS_ReadNandReport` (`0x12fa84`) |
| `0x0056` | `0x00560102` | (sans nom) | `0x0808A100` | `archive_control` (`0x0804CEB4`) | `PXIFS_cmd0056` (`0x130764`) |

### `PxiPM` : `pxipm_dispatch_command` (`0x0808A42C`)

Pas de table de saut : trois tests.

| N° | En-tête vérifié | Commande (3dbrew) | Fonction | Ce qu'elle fait |
| --- | --- | --- | --- | --- |
| `0x0001` | `0x00010082` | GetProgramInfo | `pxipm_get_program_info` (`0x0803E730`) | retrouve le programme par sa poignée de 64 bits et écrit ses `0x400` octets d'exheader dans le tampon de l'ARM11 ; réponse `0x00010041` |
| `0x0002` | (numéro seul) | RegisterProgram | `pxipm_register_program` (`0x0803E50C`) | enregistre un programme (titre et support, plus le titre de mise à jour) et rend une poignée de 64 bits ; réponse `0x000200C0` |
| `0x0003` | (numéro seul) | UnregisterProgram | `pxipm_unregister_program` (`0x0803E6C8`) | retire le programme ; réponse `0x00030040` |

Avant d'enregistrer, la commande 2 regarde le numéro de titre : si c'est un titre de la console (moitié haute `0x0004xxxx`) qui n'est pas dans une courte liste fixe (une application, la catégorie `0x10`, huit modules système), `set_high_blob_flag` (`0x0804D3C4`) pose un drapeau dans le petit programme du haut de la mémoire. Le sens de ce drapeau et de la liste n'est pas lu.

### `pxi:mc` : `pximc_dispatch_command` (`0x0808A270`)

Table de saut à `0x0808A294`, 13 cases. Aucun en-tête n'est vérifié. Huit commandes n'existent pas dans 3dbrew ; la plupart rendent seulement « succès ».

| N° | En-tête vérifié | Commande (3dbrew) | Cas | Fonction appelée |
| --- | --- | --- | --- | --- |
| `0x0001` |  | ShutdownPxi | `0x0808A2C8` | `pximc_shutdown_pxi` (`0x08086AD0`) |
| `0x0002` |  | (absente de 3dbrew) | `0x0808A2E4` |  |
| `0x0003` |  | (absente de 3dbrew) | `0x0808A2F8` |  |
| `0x0004` |  | (absente de 3dbrew) | `0x0808A314` |  |
| `0x0005` |  | Sleep | `0x0808A328` | `pximc_sleep` (`0x08086B50`) |
| `0x0006` |  | (absente de 3dbrew) | `0x0808A348` |  |
| `0x0007` |  | (sans nom) | `0x0808A35C` |  |
| `0x0008` |  | (absente de 3dbrew) | `0x0808A374` |  |
| `0x0009` |  | (absente de 3dbrew) | `0x0808A380` |  |
| `0x000A` |  | (sans nom) | `0x0808A38C` | `pximc_store_cmd0a_data` (`0x0803E354`) |
| `0x000B` |  | (absente de 3dbrew) | `0x0808A3B4` |  |
| `0x000C` |  | (absente de 3dbrew) | `0x0808A3C8` |  |

### `pxi:dev` : `pxidev_dispatch_command` (`0x08085FA0`)

Table de saut à `0x08085FC0`, 16 cases. Les commandes de communication avec un ordinateur de développement (« host IO ») et le MIDI ; personne ne les utilise sur une console de vente.

| N° | En-tête vérifié | Commande (3dbrew) | Cas | Fonction appelée |
| --- | --- | --- | --- | --- |
| `0x0001` | `0x000101C2` | ReadHostIO | `0x08086018` | `pxidev_read_host_io` (`0x080865E0`) |
| `0x0002` | `0x000201C2` | WriteHostIO | `0x08086074` | `pxidev_write_host_io` (`0x080866C0`) |
| `0x0003` | `0x00030102` | ReadHostEx | `0x080860D0` | `pxidev_read_host_ex` (`0x08086650`) |
| `0x0004` | `0x00040102` | WriteHostEx | `0x08086128` | `pxidev_write_host_ex` (`0x08086730`) |
| `0x0005` | `0x00050102` | WriteHostExStart | `0x08086180` |  |
| `0x0006` | `0x00060102` | WriteHostExChunk | `0x080861BC` |  |
| `0x0007` |  | WriteHostExEnd | `0x080861F8` |  |
| `0x0008` |  | InitializeMIDI | `0x0808620C` | `pxidev_initialize_midi` (`0x08077B34`) |
| `0x0009` |  | FinalizeMIDI | `0x08086218` | `pxidev_finalize_midi` (`0x08077C78`) |
| `0x000A` |  | GetMIDIInfo | `0x08086228` | `pxidev_get_midi_info` (`0x080779C8`) |
| `0x000B` |  | GetMIDIBufferSize | `0x0808625C` | `pxidev_get_midi_buffer_size` (`0x08077A70`) |
| `0x000C` | `0x000C0042` | ReadMIDI | `0x08086278` | `pxidev_read_midi` (`0x08077BD4`) |
| `0x000D` | `0x000D0688` | SPIMultiWriteRead | `0x080862CC` | `pxidev_spi_multi_write_read` (`0x08086888`) |
| `0x000E` | `0x000E0284` | SPIWriteRead | `0x0808647C` | `pxidev_spi_write_read` (`0x080867A0`) |
| `0x000F` |  | GetCardDevice | `0x0808653C` | `pxidev_get_card_device` (`0x08086A28`) |

### `pxi:am9` : `pxiam_dispatch_command` (`0x0808AA78`)

Table de saut à `0x0808AA9C`, 110 cases. Les numéros `0x2B` à `0x38`, `0x3A` et `0x66` renvoient vers le cas « commande inconnue » (`0x0808CC94`). C'est le gestionnaire des titres installés : tickets, TMD, contenus, base de titres. Il n'est pas sur le chemin du jeu ; ses fonctions sont nommées mais pas lues.

| N° | En-tête vérifié | Commande (3dbrew) | Cas | Fonction appelée |
| --- | --- | --- | --- | --- |
| `0x0001` |  | GetTitleCount | `0x0808AC6C` | `pxiam_get_title_count` (`0x08041B70`) |
| `0x0002` | `0x00020082` | GetTitleList | `0x0808AC98` | `pxiam_get_title_list` (`0x08041C48`) |
| `0x0003` | `0x00030084` | GetTitleInfo | `0x0808AD04` | `pxiam_get_title_info` (`0x08041D54`) |
| `0x0004` |  | DeleteTitle | `0x0808AD8C` | `pxiam_delete_title` (`0x08056EAC`) |
| `0x0005` |  | GetTitleProductCode | `0x0808ADB8` | `pxiam_get_title_product_code` (`0x08041BD8`) |
| `0x0006` |  | GetTitleExtDataId | `0x0808ADFC` | `pxiam_get_title_ext_data_id` (`0x08041A48`) |
| `0x0007` |  | DeletePendingTitles | `0x0808AE30` | `pxiam_delete_pending_titles` (`0x080467B4`) |
| `0x0008` |  | InstallFIRM | `0x0808AE5C` | `pxiam_install_firm` (`0x08043FD0`) |
| `0x0009` |  | InstallTikBegin | `0x0808AE80` | `pxiam_install_tik_begin` (`0x080411F0`) |
| `0x000A` | `0x000A0042` | InstallTikWrite | `0x0808AEA4` | `pxiam_install_tik_write` (`0x08041190`) |
| `0x000B` |  | InstallTikAbort | `0x0808B014` | `pxiam_install_tik_abort` (`0x080412AC`) |
| `0x000C` |  | InstallTikFinish | `0x0808B038` | `pxiam_install_tik_finish` (`0x08040FDC`) |
| `0x000D` |  | DeleteTicket | `0x0808B05C` | `pxiam_delete_ticket` (`0x08040DAC`) |
| `0x000E` |  | GetTicketCount | `0x0808B088` | `pxiam_get_ticket_count` (`0x08040E3C`) |
| `0x000F` | `0x000F0082` | GetTicketList | `0x0808B0B0` | `pxiam_get_ticket_list` (`0x08040E5C`) |
| `0x0010` |  | InstallTitleBegin | `0x0808B11C` | `pxiam_install_title_begin` (`0x08047ED4`) |
| `0x0011` |  | InstallTitleStop | `0x0808B148` | `pxiam_install_title_stop` (`0x08047F1C`) |
| `0x0012` |  | InstallTitleResume | `0x0808B164` | `pxiam_install_title_resume` (`0x080482CC`) |
| `0x0013` |  | InstallTmdBegin | `0x0808B188` | `pxiam_install_tmd_begin` (`0x08047D30`) |
| `0x0014` | `0x00140042` | InstallTmdWrite | `0x0808B1A4` | `pxiam_install_tmd_write` (`0x08047C30`) |
| `0x0015` |  | InstallTmdAbort | `0x0808B1F0` | `pxiam_install_tmd_abort` (`0x08047EEC`) |
| `0x0016` |  | InstallTmdFinish | `0x0808B20C` | `pxiam_install_tmd_finish` (`0x080478A4`) |
| `0x0017` |  | InstallContentBegin | `0x0808B22C` | `pxiam_install_content_begin` (`0x080484A8`) |
| `0x0018` | `0x00180042` | InstallContentWrite | `0x0808B24C` | `pxiam_install_content_write` (`0x080480D8`) |
| `0x0019` |  | InstallContentStop | `0x0808B298` | `pxiam_install_content_stop` (`0x0804D4D0`) |
| `0x001A` |  | InstallContentAbort | `0x0808B2B4` | `pxiam_install_content_abort` (`0x08048564`) |
| `0x001B` |  | InstallContentResume | `0x0808B2D0` | `pxiam_install_content_resume` (`0x080485A0`) |
| `0x001C` |  | InstallContentFinish | `0x0808B2FC` | `pxiam_install_content_finish` (`0x08047FD8`) |
| `0x001D` |  | GetPendingTitleCount | `0x0808B318` | `pxiam_get_pending_title_count` (`0x0804696A`) |
| `0x001E` | `0x001E00C2` | GetPendingTitleList | `0x0808B348` | `pxiam_get_pending_title_list` (`0x08046944`) |
| `0x001F` | `0x001F0084` | GetPendingTitleInfo | `0x0808B3B8` | `pxiam_get_pending_title_info` (`0x08046794`) |
| `0x0020` |  | DeletePendingTitle | `0x0808B440` | `pxiam_delete_pending_title` (`0x08046878`) |
| `0x0021` |  | GetNumImportContentContexts | `0x0808B46C` | `pxiam_get_num_import_content_contexts` (`0x08046AC8`) |
| `0x0022` | `0x00220102` | GetImportContentContextList | `0x0808B4A0` | `pxiam_get_import_content_context_list` (`0x08046A7C`) |
| `0x0023` | `0x00230104` | GetImportContentContexts | `0x0808B514` | `pxiam_get_import_content_contexts` (`0x080468F8`) |
| `0x0024` | `0x00240102` | DeleteImportContentContexts | `0x0808B5B0` | `pxiam_delete_import_content_contexts` (`0x08046984`) |
| `0x0025` |  | GetNumCurrentImportContentContexts | `0x0808B618` | `pxiam_get_num_current_import_content_contexts` (`0x08046FA4`) |
| `0x0026` | `0x00260042` | GetCurrentImportContentContextList | `0x0808B640` | `pxiam_get_current_import_content_context_list` (`0x08046F54`) |
| `0x0027` | `0x00270044` | GetCurrentImportContentContexts | `0x0808B6A0` | `pxiam_get_current_import_content_contexts` (`0x08046D18`) |
| `0x0028` |  | InstallTitleAbort | `0x0808B720` | `pxiam_install_title_abort` (`0x0804D5AC`) |
| `0x0029` |  | InstallTitleFinish | `0x0808B73C` | `pxiam_install_title_finish` (`0x08047DA8`) |
| `0x002A` | `0x002A00C2` | CommitImportPrograms | `0x0808B758` | `pxiam_commit_import_programs` (`0x0804847C`) |
| `0x0039` | `0x00390146` | Sign | `0x0808B7AC` | `pxiam_sign` (`0x08048D40`) |
| `0x003B` | `0x003B0042` | GetCTCert | `0x0808B854` | `pxiam_get_ct_cert` (`0x08047BE8`) |
| `0x003C` |  | GetDeviceID | `0x0808B9AC` | `pxiam_get_device_id` (`0x0804788C`) |
| `0x003D` | `0x003D0108` | SetCertificates | `0x0808B9D8` | `0x08045A78` |
| `0x003E` | `0x003E0042` | SetCertificate | `0x0808BA8C` | `0x08045A78` |
| `0x003F` |  | IsImportDatabaseInitialized | `0x0808BAFC` | `pxiam_is_import_database_initialized` (`0x08047B04`) |
| `0x0040` |  | DoCleanup | `0x0808BB28` | `pxiam_do_cleanup` (`0x08057420`) |
| `0x0041` |  | DeleteAllTemporaryPrograms | `0x0808BB48` | `pxiam_delete_all_temporary_programs` (`0x080424F0`) |
| `0x0042` | `0x00420142` | InstallTitlesFinishFIRM | `0x0808BB6C` | `pxiam_install_titles_finish_firm` (`0x08048C64`) |
| `0x0043` | `0x004301C8` | VerifyDSiWareFooter | `0x0808BBD0` | `pxiam_verify_d_si_ware_footer` (`0x08044574`) |
| `0x0044` | `0x004400C4` | (sans nom) | `0x0808BC8C` | `0x08045704` |
| `0x0045` | `0x00450108` | DecryptDSiWareData | `0x0808BD00` | `pxiam_decrypt_d_si_ware_data` (`0x08045728`) |
| `0x0046` | `0x00460182` | WriteTWLSavedata | `0x0808BDBC` | `pxiam_write_twl_savedata` (`0x08045104`) |
| `0x0047` |  | InitializeTitleDatabase | `0x0808BE2C` | `pxiam_initialize_title_database` (`0x0803F894`) |
| `0x0048` |  | ReloadDBS | `0x0808BE58` | `pxiam_reload_dbs` (`0x0803FB7C`) |
| `0x0049` |  | GetNumTicketIds | `0x0808BE8C` | `pxiam_get_num_ticket_ids` (`0x08040F5C`) |
| `0x004A` | `0x004A0102` | GetTicketIdList | `0x0808BEBC` | `pxiam_get_ticket_id_list` (`0x08040F7C`) |
| `0x004B` |  | DeleteTicketId | `0x0808BF24` | `pxiam_delete_ticket_id` (`0x08040E8C`) |
| `0x004C` | `0x004C0042` | GetPersonalizedTicketInfoList | `0x0808BF5C` | `pxiam_get_personalized_ticket_info_list` (`0x080413EC`) |
| `0x004D` | `0x004D0144` | ExportDSiWare | `0x0808BFC8` | `pxiam_export_d_si_ware` (`0x080447C4`) |
| `0x004E` |  | BeginInstallDSiWareExport | `0x0808C04C` | `pxiam_begin_install_d_si_ware_export` (`0x080455FC`) |
| `0x004F` |  | GetDSiWareExportSize | `0x0808C080` | `pxiam_get_d_si_ware_export_size` (`0x080449F0`) |
| `0x0050` | `0x00500044` | GetTwlProgramListForReboot | `0x0808C0B8` | `pxiam_get_twl_program_list_for_reboot` (`0x0804255C`) |
| `0x0051` |  | DeleteAllTwlUserPrograms | `0x0808C134` | `pxiam_delete_all_twl_user_programs` (`0x08042188`) |
| `0x0052` |  | DeleteAllExpiredUserPrograms | `0x0808C158` | `pxiam_delete_all_expired_user_programs` (`0x0804258C`) |
| `0x0053` | `0x00530084` | ValidateDSiWareMovableSedHash | `0x0808C180` | `pxiam_validate_d_si_ware_movable_sed_hash` (`0x08044A58`) |
| `0x0054` |  | GetTWLPartitionInfo | `0x0808C1F0` | `pxiam_get_twl_partition_info` (`0x08042384`) |
| `0x0055` | `0x005500C4` | ValidateDSiWareSectionMAC | `0x0808C234` | `pxiam_validate_d_si_ware_section_mac` (`0x0804568C`) |
| `0x0056` |  | CheckContentRights | `0x0808C2A8` | `pxiam_check_content_rights` (`0x0804125C`) |
| `0x0057` | `0x00570042` | CreateImportContentContexts | `0x0808C2E0` | `pxiam_create_import_content_contexts` (`0x080486A0`) |
| `0x0058` |  | GetNumContentInfos | `0x0808C324` | `pxiam_get_num_content_infos` (`0x0804374E`) |
| `0x0059` | `0x00590104` | FindContentInfos | `0x0808C358` | `pxiam_find_content_infos` (`0x080436A4`) |
| `0x005A` | `0x005A0142` | ListContentInfos | `0x0808C3F0` | `pxiam_list_content_infos` (`0x080436EA`) |
| `0x005B` |  | GetNumCurrentContentInfos | `0x0808C47C` | `pxiam_get_num_current_content_infos` (`0x08043E40`) |
| `0x005C` | `0x005C0044` | FindCurrentContentInfos | `0x0808C4A4` | `pxiam_find_current_content_infos` (`0x08043AD8`) |
| `0x005D` | `0x005D0082` | ListCurrentContentInfos | `0x0808C524` | `pxiam_list_current_content_infos` (`0x08043BA0`) |
| `0x005E` | `0x005E0102` | DeleteContents | `0x0808C598` | `pxiam_delete_contents` (`0x0804345C`) |
| `0x005F` |  | GetNumTicketsOfProgram | `0x0808C5F0` | `pxiam_get_num_tickets_of_program` (`0x08041358`) |
| `0x0060` | `0x00600102` | ListDataTitleTicketInfos | `0x0808C620` | `pxiam_list_data_title_ticket_infos` (`0x0804110C`) |
| `0x0061` | `0x00610142` | ExportLicenseTicket | `0x0808C6FC` | `pxiam_export_license_ticket` (`0x08041374`) |
| `0x0062` | `0x00620044` | GetTicketLimitInfos | `0x0808C778` | `pxiam_get_ticket_limit_infos` (`0x080412D0`) |
| `0x0063` | `0x00630042` | UpdateImportContentContexts | `0x0808C7E4` | `pxiam_update_import_content_contexts` (`0x0808778C`) |
| `0x0064` |  | GetInternalTitleLocationInfo | `0x0808C928` |  |
| `0x0065` |  | MigrateAGBtoSAV | `0x0808C97C` | `pxiam_migrate_ag_bto_sav` (`0x08048668`) |
| `0x0067` | `0x00670082` | DeleteProgramsAtomically | `0x0808C994` | `pxiam_delete_programs_atomically` (`0x0804222C`) |
| `0x0068` | `0x006801C2` | GetItemRights | `0x0808C9E4` | `pxiam_get_item_rights` (`0x08040DE4`) |
| `0x0069` |  | IsDataTitleInUse | `0x0808CAD4` | `pxiam_is_data_title_in_use` (`0x08043404`) |
| `0x006A` |  | GetNumExistingContentInfos | `0x0808CB10` | `pxiam_get_num_existing_content_infos` (`0x08043EA4`) |
| `0x006B` | `0x006B0142` | ListExistingContentInfos | `0x0808CB44` | `pxiam_list_existing_content_infos` (`0x08043C10`) |
| `0x006C` |  | InstallTitleBeginForOverwrite | `0x0808CBD0` | `pxiam_install_title_begin_for_overwrite` (`0x080488A0`) |
| `0x006D` | `0x006D0184` | ExportTicketWrapped | `0x0808CBEC` | `pxiam_export_ticket_wrapped` (`0x08041318`) |

### `pxi:ps9` : `pxips_dispatch_command` (`0x0808A62C`)

Table de saut à `0x0808A64C`, 14 cases. Les quatre commandes amiibo de 3dbrew (`0x04010084` à `0x04040044`) ne sont pas dans cette table : un tel numéro tombe dans le cas par défaut, qui rend l'erreur `0xD900182F`.

| N° | En-tête vérifié | Commande (3dbrew) | Cas | Fonction appelée |
| --- | --- | --- | --- | --- |
| `0x0001` | `0x000100C6` | (sans nom) | `0x0808A69C` | `0x080870D0` |
| `0x0002` | `0x00020284` | SignRsaSha256 | `0x0808A724` | `pxips_sign_rsa_sha256` (`0x08086C50`) |
| `0x0003` | `0x00030284` | VerifyRsaSha256 | `0x0808A77C` | `pxips_verify_rsa_sha256` (`0x08086D74`) |
| `0x0004` | `0x000401C4` | EncryptDecryptAes | `0x0808A7D4` | `pxips_encrypt_decrypt_aes` (`0x08086E58`) |
| `0x0005` | `0x00050284` | EncryptSignDecryptVerifyAesCcm | `0x0808A854` | `pxips_encrypt_sign_decrypt_verify_aes_ccm` (`0x08087298`) |
| `0x0006` |  | GetRomId | `0x0808A8DC` | `pxips_get_rom_id` (`0x080876A4`) |
| `0x0007` |  | GetRomId2 | `0x0808A8EC` | `pxips_get_rom_id2` (`0x080876E4`) |
| `0x0008` |  | GetCTRCardAutoStartupBit | `0x0808A900` | `pxips_get_ctr_card_auto_startup_bit` (`0x0808721C`) |
| `0x0009` |  | GetRomMakerCode | `0x0808A924` | `pxips_get_rom_maker_code` (`0x08086D44`) |
| `0x000A` |  | GetLocalFriendCodeSeed | `0x0808A948` | `pxips_get_local_friend_code_seed` (`0x0802D2E4`) |
| `0x000B` |  | GetDeviceId | `0x0808A964` | `pxips_get_device_id` (`0x08078B84`) |
| `0x000C` | `0x000C0042` | SeedRNG | `0x0808A980` | `pxips_seed_rng` (`0x08086BD0`) |
| `0x000D` | `0x000D0042` | GenerateRandomBytes | `0x0808A9C8` | `pxips_generate_random_bytes` (`0x0804D0D8`) |

## Partie 6 : le romfs pas à pas (archive `0x2345678E`)

Le point de départ est la fiche [contrat-fs](contrat-fs.md), partie 2 : le jeu ouvre l'archive `0x00000003`, et `fs` ouvre à sa place, chez Process9, l'archive `0x2345678E` avec un chemin binaire de 8 octets, la poignée de programme. Voici ce qui se passe de l'autre côté.

**0. Avant le jeu : le programme est enregistré.** Quand `pm` lance le jeu, `loader` envoie `PxiPM` RegisterProgram (fiche `loader`). Process9 (`pxipm_register_program`, puis `program_registry_register`, `0x08076B24`, et `program_registry_add`, `0x080769FC`) :

1. ouvre le contenu du titre de base, et celui du titre de mise à jour s'il est différent, par `title_content_archive_open` (`0x08060374`), qui trie sur le support : 0 et 1 (NAND et carte SD) vont à `title_content_archive_open_nand_sd` (`0x0802CF90`), 2 (cartouche) à un autre chemin. Process9 contient les chaînes `nand:/title/%08x/%08x/content/%08x.tmd` et `.app`, et `title_build_content_path` (`0x0806C658`) assemble des chemins avec `/title`, `/content`, `.tmd`, `.app` et `.sav` : interprété, c'est ainsi que le fichier du contenu est trouvé, par le TMD du titre. Ce chemin n'est pas suivi jusqu'au bout ;
2. fabrique un objet « programme » de `0x14` octets (`program_object_construct`, `0x08076F68`, table de méthodes `0x08092F00`) qui tient l'archive du titre de base, celle du titre de mise à jour et le numéro du contenu ;
3. le range dans une table de 64 programmes et rend une poignée de 64 bits.

C'est cette poignée que `pm` donne ensuite à `fs`, et que `fs` renvoie à Process9 dans le chemin de l'archive `0x2345678E`.

**1. OpenArchive (`0x001200C2`).** Le cas `0x08088758` vérifie l'en-tête et le descripteur, projette le chemin, et appelle `archive_manager_open` (`0x0805AD1C`). Cette fonction trie sur l'identifiant d'archive ; pour `0x2345678E` elle exige un chemin binaire de 8 octets et appelle `open_program_archive_2345678e` (`0x0802B418`) :

1. le programme est retrouvé dans la table par sa poignée (`handle_table_lookup`, `0x08061C8C`) ; s'il n'existe pas, erreur ;
2. un petit objet de 8 octets est créé (table de méthodes `0x0809225C`) : chacune de ses méthodes ne fait que passer l'appel à l'objet « programme » ;
3. il reçoit une poignée d'archive de 64 bits (`handle_table_register`, `0x0805FB0C`), rendue à `fs` avec la réponse `0x001200C1`.

Le tri des identifiants dans `archive_manager_open` donne au passage la liste des archives que Process9 connaît lui-même : `0x00000009` (carte SD), `0x12345679`, `0x1234567B` à `0x12345681`, `0x2345678A` à `0x2345678E`, `0x567890AB` à `0x567890B0`. On y retrouve les identifiants que `fs` passe « directement » (fiche `fs`, partie 8) et ceux que `fs` ouvre par-dessous (`0x1234567B` pour les données étendues, `0x2345678A`, `0x2345678E`).

**2. ControlArchive, action `0x789D` (`0x00560102`).** `fs` envoie 12 octets (le chemin de fichier du jeu) et attend 16 octets. Le cas `0x0808A100` appelle `archive_control` (`0x0804CEB4`), qui retrouve l'archive et appelle sa méthode `+0x10`, ici `program_control` (`0x08076E88`). Pour l'action `0x789D` avec 12 octets en entrée et 16 en sortie, `program_get_seed_query_info` (`0x08076E30`) répond. Interprété : ce sont les informations dont `fs` a besoin pour chercher la « graine » du titre dans sa base (`/SEEDDB`), puisque `fs` s'en sert aussitôt pour interroger sa table et en tirer 16 autres octets (fiche `contrat-fs`, étape 4).

**3. OpenFile (`0x000101C2`).** Le chemin fait maintenant `0x1C` octets : les 12 du jeu, puis les 16 octets de la graine. Le cas `0x08087930` appelle `pxifs_open_file` (`0x08031E14`), qui retrouve l'archive et appelle sa méthode `+0x08`, ici `program_open_file` (`0x08076EC0`) :

1. le chemin doit être binaire et faire `0x1C` octets ;
2. `program_open_file_by_path_type` (`0x08076C1C`) choisit d'après le premier octet du chemin :

   | Premier octet | Ce qui est ouvert | Dans quel titre |
   | --- | --- | --- |
   | 0 | le romfs | le titre de base |
   | 1 | le fichier `.code` de l'exefs | le titre de mise à jour |
   | 2 | un fichier de l'exefs nommé dans le chemin (`icon`, `banner` ou `logo`) | le titre de base |
   | 3 | interprété : la sauvegarde (sous-chemin de type 1, partie 7) | le titre de base |
   | 4 | interprété : un contenu désigné par un numéro pris dans le chemin | le titre de base |
   | 5 | le romfs | le titre de mise à jour |
   | 6 et plus | refusé | |

   C'est la clé de l'énigme laissée par la fiche `contrat-fs` : `rom:` (premier octet 0) est le romfs du jeu d'origine, `rom2:` (premier octet 5) celui de la mise à jour. `fs` ne fait pas la différence ; Process9, si.
3. le fichier est ouvert dans l'archive du titre choisi, puis enveloppé dans un objet de `0x0C` octets (table de méthodes `0x08092EA8`) ;
4. pour les types 0 et 5 seulement, les 16 octets de graine (à `+0x0C` du chemin) sont donnés à l'archive du titre par sa méthode `+0x7C`. Interprété : elle les range dans l'objet NCCH, à `+0x180`, là où `ncch_get_crypto_params` lit la graine (étape 5).

La poignée de fichier de 64 bits part dans la réponse `0x000100C1`.

**4. Le NCCH est lu et vérifié.** Les objets qui lisent le contenu d'un titre passent par `ncch_read_and_verify_header` (`0x0806FDCC`). Ce lien est interprété : ses appelants sont des méthodes d'objets, atteintes par des pointeurs. Ce qu'elle fait :

1. elle lit les `0x200` premiers octets du contenu (la signature et l'en-tête) et vérifie le mot `NCCH` ;
2. elle garde les 16 premiers octets de la signature (à `+0x170` de l'objet) : ils servent de keyY (étape 5) ;
3. elle choisit la clé publique qui vérifiera l'en-tête, selon le résultat de `0x0807BB24` (non lu) : soit une clé fixe de Process9, soit la clé contenue dans le « descripteur d'accès », la seconde moitié de l'exheader. Dans ce second cas, `exheader_verify_access_descriptor` (`0x08070240`) lit d'abord les `0x400` octets du descripteur et vérifie sa signature RSA-2048 (sur ses `0x300` derniers octets) avec une clé fixe de Process9 ;
4. la signature de l'en-tête NCCH est vérifiée avec la clé choisie (`rsa_verify_pkcs1_sha256`, `0x0805C62C`) ;
5. l'unité de taille des sections est tirée de l'octet `+0x18E` de l'en-tête (`0x200` décalé de cet octet).

**5. La section romfs et son déchiffrement.** `ncch_open_romfs_section` (`0x08070070`) :

1. demande les paramètres de chiffrement à `ncch_get_crypto_params` (`0x0805C0EC`) pour le type de section 3 (romfs), avec la clé secondaire ;
2. prend la position et la taille du romfs dans l'en-tête (`+0x1B0` et `+0x1B4`, en unités) ;
3. pose un filtre de déchiffrement sur cette portion du contenu (`0x0805C1F4`).

`ncch_get_crypto_params` lit les drapeaux de l'en-tête (octets `+0x18B` et `+0x18F`) et rend :

| Cas | Condition | Clé |
| --- | --- | --- |
| pas de chiffrement | bit 2 de `+0x18F` levé | aucune |
| clé fixe | bit 0 de `+0x18F` levé | une clé fixe : nulle, ou une clé système rangée dans Process9 pour certains titres système |
| cas ordinaire | sinon | keyY = les 16 premiers octets de la signature de l'en-tête |

- **Le compteur** : les 8 octets de l'identifiant de partition (`+0x108` de l'en-tête), à l'envers, puis le type de section (1 exheader, 2 exefs, 3 romfs), puis des zéros.
- **L'emplacement de clé** (`ncch_get_keyslot`, `0x08085E50`) : `0x2C` pour la clé principale ; pour la clé secondaire (le romfs, et l'exefs sauf `.code`), il dépend de l'octet `+0x18B` : 0 donne `0x2C`, 1 donne `0x25`, `0x0A` donne `0x18`, `0x0B` donne `0x1B`.
- **La graine** : si le bit 5 de `+0x18F` est levé et que la clé secondaire est demandée, le keyY devient les 16 premiers octets du SHA-256 de (keyY, graine) ; la graine est celle reçue à l'étape 3.

Ce tableau est exactement ce que 3dbrew décrit pour le chiffrement NCCH ; ici il est lu dans le code. Les clés elles-mêmes (keyX des emplacements) sont posées par le démarrage et ne sont pas dans cette fiche.

**6. ReadFile (`0x00090142`).** Le cas `0x080882CC` vérifie l'en-tête et le descripteur (taille `<< 8 | 4`), fabrique l'objet tampon physique (`phys_buffer_create`) et appelle `pxifs_read_file` (`0x08053B08`) avec la poignée de fichier, la position de 64 bits et la taille :

1. le fichier est retrouvé par sa poignée ;
2. si le tampon de destination est aligné sur 4 octets, la méthode de lecture `+0x38` du fichier écrit directement dans le tampon physique ; sinon, la lecture se fait par morceaux d'au plus `0x200` octets dans un tampon sur la pile, recopiés ensuite ;
3. la lecture traverse l'objet du titre et arrive au filtre de déchiffrement : l'une des deux entrées du filtre (`aes_ctr_filter_entry_a`, `0x080705AE`, ou `aes_ctr_filter_entry_b`, `0x08070606`) puis `aes_ctr_filter_crypt` (`0x08070528`) calculent le compteur pour la position demandée (compteur de la section + position / 16) et `aes_ctr_crypt_buffer` (`0x080709D8`) fait passer les données par le moteur AES, par DMA (`aes_dma_crypt_blocks`, `0x08070660`) pour les blocs entiers et par le processeur pour un début ou une fin de bloc (`aes_crypt_partial_block`, `0x080706E8`) ;
4. la réponse `0x00090081` porte le résultat et le nombre d'octets lus.

Ce que `fs` reçoit est donc le romfs **déchiffré mais brut** : avec son en-tête `IVFC` et ses niveaux d'empreintes. Le contrôle des empreintes SHA-256 de chaque bloc se fait dans `fs`, pas dans Process9 (fiche `contrat-fs`), ce qui concorde : rien, dans le chemin de lecture de Process9, ne vérifie d'empreinte de bloc.

**Pour répondre à la place de la console.** Rien de cette partie n'est à refaire si l'on remplace `fs:USER` (fiche `contrat-fs`). Si l'on voulait au contraire remplacer Process9 sous un `fs` d'origine, il faudrait : un registre de programmes (RegisterProgram rend une poignée, GetProgramInfo rend l'exheader), une archive `0x2345678E` qui ouvre, pour le premier octet 0 ou 5, le romfs déchiffré du titre de base ou de mise à jour, et ReadFile qui recopie les octets demandés. Les signatures et le chiffrement peuvent être ignorés si l'on part d'un romfs déjà extrait.

## Partie 7 : la sauvegarde et les données étendues

**La sauvegarde (archive `0x00000004` du jeu).** D'après la fiche `contrat-fs`, `fs` ouvre la même archive `0x2345678E` et y ouvre un fichier dont le chemin commence par 3. Dans `program_open_file_by_path_type`, le type 3 ouvre, dans l'archive du titre de base, un fichier de sous-type 1. Interprété : c'est le fichier de sauvegarde du titre sur son support. Pour un titre de la carte SD, le constructeur de chemins `title_build_content_path` connaît `/data` et `.sav`, ce qui donne le fichier `/title/<titre>/data/00000001.sav` que décrit 3dbrew ; pour une cartouche, ce serait la mémoire de sauvegarde de la cartouche. Process9 ne voit qu'un gros fichier : l'arborescence de la sauvegarde est gérée par `fs`. Le chemin exact jusqu'au fichier n'est pas suivi.

**Les données étendues (archives `0x00000006` et `0x00000007`).** `fs` ouvre chez Process9 l'archive `0x1234567B` (fiche `contrat-fs`). Dans `archive_manager_open`, cet identifiant exige un chemin binaire de 12 octets (support, puis identifiant de 64 bits non nul) et appelle `open_extdata_archive` (`0x0802BBA8`). Celle-ci fait construire le chemin du dossier par `extdata_build_path` (`0x0805F8A0`, qui utilise la chaîne `/extdata`), ouvre ce dossier comme une archive brute sur la carte SD ou la NAND, et pose un objet de `0x1C` octets dessus. Le format des fichiers à l'intérieur est l'affaire de `fs`.

**Le chiffrement de la carte SD.** Tout ce que la console range dans `Nintendo 3DS/` sur la carte SD est chiffré. Process9 prépare les clés une fois, dans `movable_sed_load_and_set_keys` (`0x0802B254`) : il ouvre une archive de la NAND, y lit le fichier `movable.sed` (la chaîne `/private/movable.sed` est dans Process9) et le contrôle (`0x0805F400`, qui reconnaît le mot `SEED` et appelle une vérification RSA), le fabrique s'il manque à partir de la graine de code ami (`pxips_get_local_friend_code_seed`) et d'une autre valeur, calcule le SHA-256 de 16 octets qui en sont tirés (d'après 3dbrew, c'est ce qui donne le nom du premier dossier sous `Nintendo 3DS/`), et pose ces mêmes 16 octets comme keyY dans les emplacements `0x30`, `0x34` et `0x3A`. 3dbrew dit que l'emplacement `0x34` chiffre les fichiers de la carte SD, avec un compteur tiré du chemin du fichier ; le calcul de ce compteur n'est pas lu ici. Aucune valeur n'est donnée.

## Partie 8 : signatures et empreintes

**Ce que demandent les modules de l'ARM11.** Les modules (`cfg`, `dsp`, et d'après 3dbrew `ro` pour les fichiers `.crr`) vérifient leurs signatures par `ps:ps` VerifyRsaSha256 ; `ps` le transmet à Process9 comme `pxi:ps9` commande 3. Process9 fait alors, dans `pxips_verify_rsa_sha256` (`0x08086D74`) :

1. il projette les deux tampons de l'ARM11 : le « contexte RSA » (`0x208` octets : le module, jusqu'à `0x200` octets, puis sa taille en bits) et la signature ;
2. il s'arrête si la clé dépasse 2 048 bits (taille au-delà de `0x800`) ;
3. il pose la clé (`rsa_context_set_key`, `0x0805C440`) ;
4. `rsa_verify_pkcs1_sha256` (`0x0805C62C`) fait faire l'élévation à la puissance au moteur RSA, vérifie le bourrage PKCS #1 v1.5 (`00 01`, une suite de `FF`, `00`), lit l'en-tête ASN.1 de l'empreinte, et compare les 32 octets à l'empreinte SHA-256 que l'ARM11 a mise dans la requête.

L'empreinte est donc calculée côté ARM11 : Process9 ne reçoit que les 32 octets. La commande 2, `pxips_sign_rsa_sha256` (`0x08086C50`), fait l'inverse avec une clé privée fournie de la même façon.

**Ce que demande `loader`.** `loader` n'envoie aucune demande de signature : il demande GetProgramInfo (l'exheader). Les vérifications sont faites par Process9 quand il ouvre le contenu du titre (partie 6, étape 4) : la signature de l'en-tête NCCH, avec une clé fixe ou avec la clé du descripteur d'accès de l'exheader, lui-même signé par une clé fixe. Le lien entre RegisterProgram et `ncch_read_and_verify_header` passe par des appels de méthodes d'objets, que l'analyse statique ne suit pas : il est interprété.

**Les autres usages.** `sha256_then_rsa_verify` (`0x0805C4B4`) sert aussi au contrôle de `movable.sed` (`0x0805F400`) et à `rsa_verify_signed_block` (`0x0802F330`), qui vérifie un bloc reconnu à un mot magique (non suivi) ; `firm_launch_handler` vérifie la signature du FIRM à lancer avec la même fonction. `sha256_compute` (`0x08061240`) est le calcul SHA-256 commun, appuyé sur le moteur SHA. Les commandes `pxifs_calculate_file_hash_sha256` (`0x0A`), `pxifs_read_file_sha256` (`0x4D`), `pxifs_write_file_sha256` (`0x4E`) et `pxifs_calc_savegame_mac` (`0x0C`) calculent des empreintes et des codes d'authentification pour `fs`, qui s'en sert pour les sauvegardes.

## Partie 9 : les périphériques

Process9 est le seul programme qui touche ces blocs. Les adresses sont physiques (l'ARM9 n'a pas de mémoire virtuelle). Les rôles viennent de 3dbrew (« IO Registers ») ; les fonctions sont celles dont le code charge l'adresse du bloc.

| Bloc | Adresse | Rôle | Fonctions qui y touchent (exemples) |
| --- | --- | --- | --- |
| `CFG9` | `0x10000000` | configuration de l'ARM9 : accès aux autres blocs par DMA (`CFG9_XDMA_CNT`), cartouche, SD/MMC | `cfg9_enable_xdma_devices` (`0x0805D324`), `0x08028270` |
| `CFG9` (2) | `0x10010000` | `CFG9_BOOTENV` (démarrage à froid ou relancement), `CFG9_UNITINFO` (console de développement) | `process9_main`, `firm_launch_handler`, le petit programme du haut de la mémoire |
| `IRQ` | `0x10001000` | les interruptions de l'ARM9 | kernel9 seulement |
| `NDMA` | `0x10002000` | le DMA de l'ARM9, utilisé pour faire passer les données dans l'AES et le SHA | neuf petites fonctions, dont `0x0803D5A0` et `0x0805800C` |
| `TIMER` | `0x10003000` | les minuteries | kernel9 seulement |
| `CTRCARD` | `0x10004000`, `0x10005000` | la cartouche 3DS (lecture du contenu, des en-têtes, de l'identifiant de la cartouche) | une trentaine de fonctions de `0x0802ED74` à `0x0807CAAC` |
| `SD/MMC` | `0x10006000`, `0x10007000` | le contrôleur SD 1 (`0x10006000`), qui sert la carte SD et la NAND (eMMC), et le contrôleur 3 (`0x10007000`), d'ordinaire laissé à l'ARM11 (3dbrew) ; les fonctions de Process9 reçoivent le numéro du contrôleur et choisissent l'adresse | `sdmmc_controller_init` (`0x0802F39C`), `sdmmc_register_address` (`0x080605F4`) et huit autres |
| `PXI` | `0x10008000` | la file vers l'ARM11 | partie 4 |
| `AES` | `0x10009000` | le chiffrement : emplacements de clés, CTR, CBC, CCM, ECB ; données par les files d'entrée et de sortie | `aes_set_keyx` (`0x08056680`), `aes_set_keyy` (`0x08056660`), `aes_set_ccm_nonce` (`0x0804D6C8`), `aes_set_mac` (`0x0805B488`), `aes_is_busy` (`0x08051F28`) ; plus les fonctions du petit programme du haut de la mémoire |
| `SHA` | `0x1000A000` | SHA-256 (et SHA-1) | `sha_start` (`0x0802CD14`), `sha_set_mode_and_state` (`0x0804E5BC`), `sha_read_hash` (`0x08070D04`) |
| `RSA` | `0x1000B000` | l'élévation à la puissance modulaire, quatre emplacements de clé | `rsa_load_key_into_slot` (`0x0802D7B0`), `rsa_write_message` (`0x08028898`), `rsa_start_with_slot` (`0x0802884C`), `rsa_read_result` (`0x080287F0`), `rsa_is_busy` (`0x08057054`) |
| `SPICARD` | `0x1000D800` | le bus SPI de la cartouche : la mémoire de sauvegarde d'une cartouche | treize fonctions, dont `0x080341E8` |
| `PRNG` | `0x10011000` | une source d'aléa | `0x0803F814`, `0x08085A88` |
| `NTRCARD` | `0x10164000` | le bus de cartouche hérité de la DS, par lequel passe aussi le début du dialogue avec une cartouche 3DS (3dbrew) | dix-sept fonctions, dont `0x0802EE04` |

Le moteur AES vu par le code :

- **Les clés.** Pour un emplacement de 0 à 3 (ceux du DSi), la clé est écrite directement dans les registres `AES_KEY0` à `AES_KEY3` ; pour 4 à `0x3F`, l'emplacement est choisi dans `AES_KEYCNT` puis la clé passe par la file `AES_KEYFIFO`, `AES_KEYXFIFO` ou `AES_KEYYFIFO`. Le plus souvent Process9 écrit un keyX ou un keyY, et le matériel fabrique la clé normale à partir des deux ; Process9 ne fait jamais ce calcul lui-même. Il écrit aussi, parfois, une clé normale (par la fonction à `0x0817F410`).
- **Les données.** Elles passent par DMA (NDMA, descripteurs `aes_wrfifo_dma_descriptor`, `0x0804FF80`, et `aes_rdfifo_dma_descriptor`, `0x0804FF94`), par blocs de 16 octets.
- **Les emplacements vus dans le code** : `0x05` (la NAND du New 3DS, au démarrage), `0x15`, `0x18` à `0x1F` (effacés avant un lancement de FIRM), `0x2C`, `0x25`, `0x18`, `0x1B` (le NCCH), `0x30`, `0x34`, `0x3A` (la carte SD, keyY tiré du `movable.sed`). Le rôle de chaque emplacement vient de 3dbrew ; leur usage est lu dans le code.

## Partie 10 : les appels système de Process9

Process9 utilise 31 des 40 appels de kernel9. Leurs enveloppes, une par appel, sont nommées dans `process9.noms.tsv` (`svcCreateThread` à `0x08085C90`, `svcWaitSynchronizationN` à `0x08085CBC`, `svcBindInterrupt` à `0x08085D24`, etc.). Quelques appels sont aussi écrits sur place, hors de leur enveloppe : `svcSignalEvent` (4 endroits, dans `pximc_shutdown_pxi`, `pximc_sleep` et `pxi_arm11_channel_on_reply`), `svcCloseHandle` (2), `svcWaitSynchronization1` (2, dans `wait_pxi_workers_then_firm_launch`), `svcSetThreadPriority` (2, dans `pxi_channel_run_handler`), `svcKernelSetState` (dans `pximc_channel_after_handler` et `firm_launch_handler`) et `svcBackdoor` (`0x7B`, dans `firm_launch_handler` seulement). Ne sont jamais appelés : `CreateSemaphore`, `ReleaseSemaphore`, `ClearTimer`, `GetSystemInfo`, `GetProcessInfo`, `GetThreadInfo`, `OutputDebugString`, `StoreProcessDataCache`, `RestartDma`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Le découpage de la section ARM9 : les tailles de l'en-tête (`540928`), du NCCH (`0x6E800`) et la fin du binaire à `0x0808A900` se recoupent au octet près ; 3dbrew décrit le même en-tête (page FIRM).
- La table des appels système de kernel9 : 40 numéros remplis à `0x08007934`, exactement la colonne « NF ARM9 » de 3dbrew.
- Les dix canaux PXI : construits dans `static_init_pxi_objects`, et identiques à la table de `pxi` côté ARM11 (fiche `pxi`, partie 2).
- Le protocole de la file (canal, interruption, en-tête, mots ; `0x40` mots au plus ; poignée de main 1 puis 2) : lu ici et dans la fiche `pxi`.
- Le bit 29 de `PXI_SYNC9` qui déclenche l'interruption de l'ARM11 : lu ici, décrit par 3dbrew, et c'est l'interruption `0x50` attendue par `pxi`.
- Les tables de commandes : 86 commandes de fichiers identiques à 3dbrew ; les 83 requêtes de `fs` toutes présentes, les 41 en-têtes vérifiés égaux ; 3 commandes `PxiPM` identiques à celles de `loader` ; `pxi:dev` 15 sur 15, `pxi:am9` 93 sur 94, `pxi:ps9` 13 sur 17 avec 3dbrew.
- Le traitement immédiat de SetPriority et la correspondance entre priorité de requête et priorité de fil : lus dans le code, et cohérents avec les valeurs `-16` et `16` que `fs` envoie.
- Les règles de chiffrement du NCCH (emplacements `0x2C`, `0x25`, `0x18`, `0x1B` ; keyY tiré de la signature ; compteur ; graine) : lues dans `ncch_get_crypto_params` et `ncch_get_keyslot`, et décrites par 3dbrew.
- Le sens des premiers octets 0 et 5 du chemin (romfs de base, romfs de mise à jour) : lu dans `program_open_file_by_path_type`, et cohérent avec l'usage de `rom:` et `rom2:` par le jeu (fiche `contrat-fs`).

**Interprété à la lecture, à relire dans Ghidra**
- Que l'outil de dump (GodMode9) a déchiffré la section et réécrit le point d'entrée : déduit des empreintes recalculées, du mot `DEC` et de `etat.json`, pas observé sur la console.
- Les noms des 193 fonctions appelées par les cas des commandes : tirés de la commande qui les appelle, pas de la lecture de leur corps (sauf celles du chemin du romfs, du PXI et de `pxi:ps9` 2 et 3).
- Le rôle de l'action `0x789D` (les informations pour la graine), et le type 3 du chemin comme sauvegarde.
- Le lien entre l'enregistrement d'un programme et la vérification des signatures du NCCH : il passe par des méthodes d'objets que l'analyse statique ne suit pas.
- Les rôles des étapes `n3ds_keyslot_init`, `aes_keyslots_setup_step` et `set_high_blob_flag`, appuyés sur 3dbrew pour la première.
- Les noms des fonctions des pilotes (SHA, RSA, SD/MMC) : déduits des registres touchés.

**Pas lu**
- Le pilote SD/MMC du chargeur du New 3DS instruction par instruction (`0x0808C34C`, `0x0808DA18`) ; ses 193 fonctions (185 pour Ghidra dans `local/analyse/arm9loader/gh/`, plus 8 entrées) sont nommées, et son entrée d'origine `0x0808AA3C` reste supposée.
- kernel9 : le compilateur de programmes DMA (`dma_node_*`, `dma_transfer_*`, nommés en moyenne) et le rôle de quatre réserves d'objets sans type.
- Le corps des 93 commandes de `pxi:am9`, des commandes de cartouche et de NAND de `PxiFS`, et des commandes de `pxi:mc` hors 1 et 5.
- Le compteur des fichiers de la carte SD, la lecture d'une cartouche, le format des contenus `.app` et du TMD côté Process9.
- Le petit programme copié à `0x0817F000` au-delà des quatre fonctions citées.
- Le sens des notifications `0x207` à `0x20B`.
- Quatre mille fonctions sans nom, surtout dans les pilotes et la gestion des titres.

## Comment ce document a été fait

| Étape | Outil |
| --- | --- |
| Lire l'en-tête du FIRM et de la section ARM9, découper kernel9, le NCCH de Process9 (exheader, `.code`) et le chargeur | `outils/firm.py`, qui écrit dans `local/extrait/firm/arm9/` (au départ `local/analyse/process9/split_arm9.py`) |
| Charger Process9 (ELF construit par `outils/elfer.py` depuis l'exheader, base `0x08028000`), kernel9 (binaire brut à `0x08006800`) et le chargeur (`0x0808A900`) dans Ghidra, langage `ARM:LE:32:v5t`, sans interface, `GHIDRA_HEADLESS_MAXMEM=3G` | `outils/ghidra_raw.py`, avec `process9`, `kernel9` ou `arm9loader` (cibles de `outils/raw_targets.toml`), qui partage avec `outils/ghidra_direct.py` la recherche des graines et les scripts Java ; au départ `local/analyse/process9/ghidra_p9.py` |
| Interroger le résultat : fonction d'une adresse, appelants, appelés, littéraux, pseudo-code | `q.py`, et `disasm_p9.py` (capstone, depuis `local/pylib/`) |
| Lire les tables de saut des six fonctions de service, distinguer en-tête vérifié et en-tête de réponse, trouver la fonction appelée par chaque cas | `tables.py`, `services.py` |
| Recouper avec 3dbrew (extrait de `carte-des-services/donnees.js` dans `dbrew_pxi.json`) et avec `fiches/fs.md` | `crosscheck.py` |
| Lire à la main le démarrage, le PXI, l'archive `0x2345678E`, le NCCH, l'AES | Claude, dans le pseudo-code et l'assembleur |
| Écrire les noms, les recharger dans Ghidra (385 noms posés pour Process9, 46 pour kernel9, aucun refusé) | `make_names.py`, puis `outils/ghidra_raw.py process9` et `kernel9` de nouveau (au départ `ghidra_p9.py`) |
| Fabriquer les grands tableaux de cette fiche | `gen_doc.py` (depuis `doc/process9.template.md`) |
| Pages de 3dbrew lues le 14 octobre 2026 par la Wayback Machine : FIRM, SVC, PXI Registers, AES Registers, IO Registers, CONFIG9 Registers, Process Services PXI | `web/fetch.py` |

**Les pièges rencontrés**

- **Ce n'est pas un module ARM11.** Il n'y a pas de `code.bin` à `0x00100000` : `outils/ghidra_direct.py` lit `local/extrait/<module>/exefs/code.bin` et utilise le langage `v6`. `outils/ghidra_raw.py` reprend ses fonctions (graines Thumb, aide de switch, tables de distances, trous) avec le fichier, l'adresse et le langage `v5t` de chaque cible.
- **Les fausses fonctions de kernel9.** Lancé tel quel, Ghidra trouvait 1 767 fonctions dans kernel9, dont 1 255 « fonctions Thumb » dans les zéros de sa zone de données, créées à partir de suites de mots pris pour des tables de distances. La cible `kernel9` limite les candidats à ses deux zones de code et n'y prend aucune table de distances ; `MarkDataBlocks.java` rend le reste non exécutable avant l'analyse : il en reste 497. La seconde zone, d'abord arrêtée à `0x0801B6C0`, va jusqu'à `0x0801C080` (la fonction `0x0801B6E0` y était coupée) ; le compte ne change pas.
- **Les cas ne sont pas des fonctions.** Les commandes sont des cas d'une seule grande fonction ARM. Les mettre dans le fichier de noms ferait créer par `ApplyNames.java` une fonction à chaque cas et découperait l'aiguillage : ils sont dans les tableaux de cette fiche, pas dans `process9.noms.tsv`.
- **L'en-tête vérifié.** Le premier littéral comparé au mot 0 est l'en-tête de la requête ; les autres littéraux du cas sont des en-têtes de réponse. `tables.py` ne compte comme « vérifié » qu'un littéral suivi d'une comparaison.
- **Le nom `dis.py`** masque le module `dis` de Python et casse `capstone` : le désassembleur s'appelle `disasm_p9.py`.
- **Les pages de 3dbrew** arrivent compressées par la Wayback Machine : `curl --compressed`.

**Ce qui a été rangé dans `outils/`, et ce qui ne l'a pas été.** Le découpage du FIRM est dans `firm.py`, le lancement de Ghidra sur une image brute ou un ELF dans `ghidra_raw.py`, ses réglages dans `raw_targets.toml` (voir `outils/REA.md`, partie 4 ter). Relancés le 2026-10-14 : Process9 4 797 fonctions, 385 noms posés ; kernel9 497 fonctions, 46 noms ; le chargeur 185 fonctions ; aucun nom sans fonction. La lecture des aiguillages ARM par table de saut (`tables.py`, `services.py`) reste dans `local/analyse/process9/`. (au 17/10 : 49 fonctions et 1 étiquette dans la fiche, puis les noms relus du lot du 17/10)

**Pour reprendre.** Relancer `python outils/firm.py local/dump/systeme/native.firm`, puis `python outils/ghidra_raw.py process9` et `python outils/ghidra_raw.py kernel9` (environ trois minutes chacun) : les morceaux découpés vont dans `local/extrait/firm/arm9/`, les projets Ghidra, le pseudo-code et l'assembleur de chaque fonction dans `local/analyse/process9/gh/` et `local/analyse/kernel9/gh/`. Les scripts de lecture de `local/analyse/process9/` (`q.py`, `tables.py`, `services.py`, `crosscheck.py`, `make_names.py`, `gen_doc.py`), non versionnés, lisent encore les premiers projets (`p9/gh/`, `k9/gh/`), qui ont les mêmes fonctions ; on y trouve aussi les tables (`tables/*.txt`, `services.tsv`, `crosscheck.tsv`) et les pages de 3dbrew (`web/`).
