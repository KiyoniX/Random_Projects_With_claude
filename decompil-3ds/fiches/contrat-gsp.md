# Contrat de `gsp::Gpu` : ce que Pokémon X demande à l'affichage, et ce qu'il faut lui rendre

Ce document n'est pas une fiche de module. C'est un **contrat** : commande par commande, ce que le jeu envoie, ce que le module `gsp` en fait, et ce qu'un programme qui prend la place de la console doit rendre pour que le jeu continue. Il prolonge la fiche [gsp](gsp.md) (le module) et l'inventaire [pokemon-x-services](pokemon-x-services.md) (le client), dont il reprend le vocabulaire.

Fiche du 14 octobre 2026. Chaque commande est lue **des deux côtés**, qui sont deux preuves indépendantes : le code du jeu (mise à jour de Pokémon X, `local/extrait/maj/exefs/code.bin`, chargé à `0x00100000`) et le code du module (`local/extrait/gsp/exefs/code.bin`, chargé lui aussi à `0x00100000`). Une adresse est toujours précédée de « jeu » ou « `gsp` » quand le doute est possible. Tout est statique : rien n'a été regardé en train de tourner.

Les noms de fonctions du jeu donnés ici ont été proposés par ce document et versés depuis dans `pokemon-x.noms.tsv`. Dans le pseudo-code de `local/analyse/maj/gh/`, tant que `ghidra_direct.py maj` n'a pas été relancé, ces fonctions s'appellent encore `FUN_…`.

## Synthèse

**Les commandes du service** (14 envoyées par le jeu, sur les 31 que `gsp` connaît) :

| En-tête | Commande | Fonction d'envoi du jeu | Fonction de `gsp` | Lecture | Au démarrage |
| --- | --- | --- | --- | --- | --- |
| `0x00160042` | AcquireRight | `0x134b9c` | `0x109260` | des deux côtés | oui, la première |
| `0x00130042` | RegisterInterruptRelayQueue | `0x173478` | `0x10978c` | des deux côtés | oui, la deuxième |
| `0x00010082` | WriteHWRegs | `0x1645b0` | `0x107540` | des deux côtés | seulement si la réponse précédente vaut `0x2A07` |
| `0x00020084` | WriteHWRegsWithMask | `0x164634` | `0x10967c` | des deux côtés | idem |
| `0x000C0000` | TriggerCmdReqQueue | `0x179dbc` | `0x1095c0` | des deux côtés | oui |
| `0x000B0040` | SetLcdForceBlack | `0x125674` | `0x109514` | des deux côtés | oui, la dernière |
| `0x00080082` | FlushDataCache | `0x1645f8` | `0x1092f4` | des deux côtés | pas sur le chemin suivi |
| `0x00040080` | ReadHWRegs | `0x16455c` | `0x109864` | des deux côtés | pas sur le chemin suivi |
| `0x00170000` | ReleaseRight | `0x12564c` | `0x10b728` | des deux côtés | non (mise en attente) |
| `0x00180000` | ImportDisplayCaptureInfo | `0x173428` | `0x109770` | des deux côtés | non |
| `0x00190000` | SaveVramSysArea | `0x1494c8` | `0x109428` | des deux côtés, sauf la copie elle-même dans `gsp` | non |
| `0x001A0000` | RestoreVramSysArea | `0x1256ac` | `0x109570` | des deux côtés, sauf la copie elle-même dans `gsp` | non |
| `0x00140000` | UnregisterInterruptRelayQueue | `0x179de4` | `0x109808` | des deux côtés | non (sortie) |
| `0x00100040` | SetAxiConfigQoSMode | `0x2c8eac` | `0x10b8a4` | des deux côtés, sauf la valeur envoyée (elle vient d'un `.cro`) | non |

**Les commandes de la file** (mémoire partagée, pas de message) :

| Id | Commande | Fonction du jeu qui la range | Fonction de `gsp` | Lecture | Interruption attendue en retour |
| --- | --- | --- | --- | --- | --- |
| 0 | demande de transfert mémoire (RequestDma) | `0x163fe4` | `0x10c1c8` | des deux côtés | 6 |
| 1 | traitement d'une liste de commandes (ProcessCommandList) | `0x1640d4` | `0x10c26c` | des deux côtés | 5 |
| 2 | remplissage de mémoire (MemoryFill) | `0x164064` | `0x10bf74` | des deux côtés | 0 ou 1, une seule |
| 3 | transfert vers l'écran (DisplayTransfer) | `0x16447c` | `0x10c360` | des deux côtés | 4 |
| 4 | copie de texture (TextureCopy) | `0x1641a4` | `0x10c0b8` | des deux côtés | 4 |
| 5 | vidage de cache (FlushCacheRegions) | `0x1640d4` (première moitié) | `0x1090e8` | des deux côtés | aucune |

**Le reste de la mémoire partagée** : la zone des interruptions et la zone des tampons d'écran sont lues des deux côtés. La commande SetBufferSwap (`0x00050200`) n'est **pas** envoyée par le jeu : il annonce ses images par la mémoire partagée uniquement.

Bilan : 14 commandes du service sur 14 et 6 commandes de file sur 6 lues des deux côtés. Aucune lue d'un seul côté, aucune pas lue. Les trous sont à l'intérieur de trois d'entre elles et sont notés dans le tableau.

## Partie 1 : la forme d'un échange

Le jeu écrit sa requête dans le tampon du fil (à `+0x80` du stockage local), fait `svc 0x32`, puis relit la réponse au même endroit. « Mot 0 » est l'en-tête, « mot 1 » le mot à `+0x84`, et ainsi de suite.

Toutes les fonctions d'envoi du jeu finissent de la même façon : si l'appel système lui-même échoue, elles rendent son code ; sinon elles rendent le **mot 1 de la réponse**. Trois seulement lisent plus loin (RegisterInterruptRelayQueue, ImportDisplayCaptureInfo, ReadHWRegs).

La poignée de la session est rangée par le jeu à `0x5e7f40` puis recopiée à `0x5e7f44` ; une petite fonction (`gsp_get_session_handle_ptr`, jeu `0x1646c4`) rend l'adresse de cette copie, et treize endroits l'appellent juste avant un envoi.

Côté module, `gspgpu_handle_command` (`gsp` `0x103f14`) lit les mêmes mots. Trois contrôles reviennent (fiche `gsp`, partie 3) :

- **E** : l'en-tête entier doit être le bon, sinon `0xD9001830` ;
- **D** : le client doit détenir le droit d'affichage, sinon `0xD8202A06` ;
- **C** : le fil doit être un client inscrit, sinon `0xD8A02A05`.

## Partie 2 : la séquence de démarrage de l'affichage, vue du jeu

C'est la liste de ce qu'un portage doit accepter pour voir le premier écran.

**D'où elle part.** `game_init_systems` (jeu `0x107cbc`) appelle `0x10d6f8`, qui appelle `0x111aa8`, qui appelle `graphics_system_init` (jeu `0x11d074`). Celle-ci appelle `gx_initialize` (jeu `0x13037c`), la fonction d'initialisation de la bibliothèque graphique du constructeur. Ghidra a coupé `gx_initialize` en trois morceaux (`0x13037c`, une zone sans fonction, puis `0x130800`) : il faut la lire en assembleur d'un seul tenant, de `0x13037c` à `0x13101c`.

| Ordre | Qui (jeu) | Ce qui part | Ce qu'il faut rendre |
| --- | --- | --- | --- |
| 1 | `gsp_client_init` `0x1491e0`, appelée à `0x1305b8` | GetServiceHandle `gsp::Gpu` à `srv:` | une poignée de session |
| 2 | la même, à `0x149260` | **AcquireRight** : drapeau 0, poignée `0xFFFF8001` (le jeu lui-même) | résultat 0 |
| 3 | `gsp_client_register_relay` `0x164244` | `svcCreateEvent` (`svc 0x17`, type 0) : le signal des interruptions | (noyau) |
| 4 | la même, à `0x16431c` | **RegisterInterruptRelayQueue** : drapeaux 1, la poignée du signal | résultat 0 ou `0x2A07`, le numéro de client, la poignée du bloc de mémoire partagée |
| 5 | la même, à `0x16433c` | `svcMapMemoryBlock` (`svc 0x1F`) : `0x1000` octets, lecture et écriture | (noyau) la page partagée, visible des deux côtés |
| 6 | la même | calcul des quatre pointeurs du client, remise à zéro de l'en-tête de sa file de commandes | rien : c'est une écriture en mémoire partagée |
| 7 | la même, à `0x1643f8` | création du fil des interruptions (`gsp_interrupt_thread_main`, jeu `0x1731e4`) | (noyau) |
| 8 | `gx_initialize`, de `0x1305d8` à `0x130628` | pose de 7 fonctions de rappel, une par type d'interruption | rien |
| 9 | `gx_initialize`, de `0x130638` à `0x130c3c`, **seulement si l'étape 4 a rendu `0x2A07`** | 64 **WriteHWRegs** et 4 **WriteHWRegsWithMask** (partie 7) | résultat 0 à chacune |
| 10 | `gx_flush_command_list` `0x1434d4`, appelée à `0x130c48` ou `0x130ea8` | la première liste de commandes : file, commande **5** (et **TriggerCmdReqQueue** aussitôt, la file étant vide), puis commande **1** | résultat 0 ; puis l'interruption 5 quand la liste est « exécutée » |
| 11 | `gx_initialize`, de `0x130c4c` à `0x130d00`, seulement après `0x2A07` | un transfert d'essai : file, commande **3**, 128 × 128, de `0x1F5F8000` vers un tampon du jeu | l'interruption 4 |
| 12 | `gx_initialize`, boucle à `0x130f20` | attente : le jeu dort tant que ses demandes ne sont pas toutes finies | les interruptions des étapes 10 et 11 |
| 13 | `graphics_system_init`, à `0x11d2a0` puis `0x11d32c` | choix du mode d'affichage (`0x702`, relief, ou `0x700`), puis création d'une demande de **remplissage** des deux moitiés de la mémoire vidéo par zéro. Rien ne part encore : la liste de demandes n'est pas en marche | rien |
| 14 | `0x11d3c8` (appelée à `0x11d338`), qui met la liste en marche par `gx_run_requests` `0x131020` ; puis `0x11d56c` (à `0x11d344`), qui attend | la demande de l'étape 13 part : file, commande **2**, puis **TriggerCmdReqQueue** | résultat 0, puis une interruption 0 (une seule) |
| 15 | `gx_swap_buffers` `0x1310c8`, appelée à `0x11d35c` avec `0x402` (les deux écrans) | **écriture des deux zones de tampons d'écran** (partie 5) | rien tout de suite : à la fin d'image suivante, montrer ces images |
| 16 | `gx_wait_vblank` `0x122cdc`, avec `0x402` | attente d'une fin d'image **de chaque écran** | les interruptions 2 **et** 3 |
| 17 | `gsp_unforce_lcd_black` `0x1255e4`, appelée à `0x11d374` | **SetLcdForceBlack** avec 0 : lever le noir | résultat 0, et afficher |

Trois points à retenir pour un portage :

- **Le résultat `0x2A07` change tout.** Sur la console, `gsp` le rend au tout premier client inscrit depuis son démarrage, et ce n'est jamais un jeu (le menu passe avant). Le jeu qui le reçoit en déduit qu'il doit programmer lui-même les écrans : 68 écritures de registres et un transfert d'essai. **Rendre 0 évite tout cela** ; rendre `0x2A07` oblige à accepter les étapes 9 et 11.
- **Le jeu ne continue que sur des interruptions.** Aux étapes 12, 14 et 16 il attend. Un délai de garde existe dans le code (deux mots à `0x625da8 + 0x178`, et une fonction à appeler à `+0x170`), mais il n'est armé que si ces mots ne sont pas nuls, et l'initialisation les met à zéro. Une commande de file acceptée mais jamais « terminée » par une interruption bloque donc le démarrage.
- **L'étape 16 exige les deux écrans.** La fonction ne sort que lorsque le compteur de fins d'image de l'écran du haut **et** celui du bas ont bougé.

**Une demande ne part que si sa liste est « en marche ».** `gx_initialize` met la sienne en marche pour les étapes 10 à 12, puis l'arrête. Ensuite une demande créée attend, dans le tableau du jeu, que `gx_run_requests` (jeu `0x131020`) soit appelée : c'est pourquoi le remplissage de l'étape 13 ne part qu'à l'étape 14.

Ce qui n'est pas dans ce tableau : entre les étapes 12 et 13, `graphics_system_init` appelle une fonction (`0x128cd4`, à `0x11d274`) qui prépare les tampons d'image ; je ne l'ai pas suivie. Elle peut créer des demandes, qui partiraient alors à l'étape 14 avec le remplissage.

## Partie 3 : les commandes du service, une par une

### AcquireRight (`0x00160042`)

**Rôle.** Demander le droit d'afficher. Sans lui, `gsp` ne lit jamais la file du jeu.

| Mot | Ce que le jeu écrit (`0x134b9c`) | Ce que `gsp` lit |
| --- | --- | --- |
| 0 | `0x00160042` | vérifié en entier (E) |
| 1 | un octet : l'octet `0x5e7f32` du jeu, qui vaut 0 et qu'aucune instruction ne modifie | le drapeau « passer en force » |
| 2 | 0 | doit valoir 0 (c'est le descripteur « poignée à recopier »), sinon `0xD9001830` |
| 3 | `0xFFFF8001`, lu à `0x5705c0` : la fausse poignée qui veut dire « mon propre processus » | une vraie poignée vers le processus du jeu, que le noyau a fabriquée au passage |

| Mot de réponse | Contenu | Ce que le jeu en fait |
| --- | --- | --- |
| 0 | `0x00160040` | rien |
| 1 | le résultat | le rend à l'appelant, qui ne le regarde pas au démarrage |

**Ce que fait `gsp`.** `rights_acquire` (`0x10b504`) attend que le droit soit libre, puis `rights_grant` (`0x105fa4`) inscrit le client comme propriétaire à quatre endroits : le registre des droits, le relais des interruptions, la file de commandes, et l'affichage. Ce dernier point compte : `display_set_owner` (`0x10d7b4`) **remet à zéro l'octet « nouvelle image »** des deux zones de tampons d'écran du client. Une image annoncée avant AcquireRight est donc oubliée.

**Erreurs.** `0xD8A02A05` (fil non inscrit), `0x2BEB` (le droit est déjà à ce client, ce n'est pas un échec), `0x01202A08` (le droit a été repris de force pendant l'attente).

**Qui l'envoie.** Deux endroits : `gsp_client_init` au démarrage, et `gsp_reacquire_right` (jeu `0x11a2a0`) au retour au premier plan.

**Pour répondre à la place de la console.** Rendre `0x00160040` et 0. Noter que ce client est propriétaire, et garder de quoi lire sa mémoire : toutes les adresses qu'il donnera ensuite sont des adresses de son espace.

### RegisterInterruptRelayQueue (`0x00130042`)

**Rôle.** Donner à `gsp` le signal à déclencher quand une interruption arrive, et recevoir en échange la mémoire partagée et un numéro de client.

| Mot | Ce que le jeu écrit (`0x173478`) | Ce que `gsp` lit |
| --- | --- | --- |
| 0 | `0x00130042` | vérifié en entier (E) |
| 1 | les drapeaux : 1 ou 2, plus 4 si l'octet `0x5e7f32` n'est pas nul (il l'est toujours) | rangés dans la fiche du client ; le bit 0 autorise Save et RestoreVramSysArea |
| 2 | 0 | doit valoir 0 |
| 3 | la poignée du signal créé à l'étape 3 | rangée dans la case du client |

Le choix entre 1 et 2 dépend de l'octet `0x5e7f31` du jeu, que `apt_init` met à 1 quand les trois bits du bas d'une valeur reçue d'`APT` ne sont pas nuls (`0x125748`). Pour une application ordinaire je m'attends à 1, mais je n'ai pas suivi cette valeur jusqu'au bout.

| Mot de réponse | Contenu écrit par `gsp` | Ce que le jeu en fait |
| --- | --- | --- |
| 0 | `0x00130082` | rien |
| 1 | `0x2A07` au premier inscrit depuis le démarrage de `gsp`, 0 ensuite | comparé à `0x2A07` : s'il est égal, l'octet « première inscription » de l'objet client passe à 1 (étape 9 de la partie 2) |
| 2 | le numéro de client, de 0 à 3 | gardé : il sert à calculer les quatre adresses ci-dessous |
| 3 | 0 (descripteur de poignée) | rien |
| 4 | la poignée du bloc de mémoire partagée | passée à `svcMapMemoryBlock` |

**Ce que le jeu fait ensuite** (`gsp_client_register_relay`, jeu `0x164244`). Il projette le bloc (`0x1000` octets) à une adresse qu'il choisit lui-même, appelée ici *base*, puis calcule, avec *n* le numéro de client :

| Pointeur du jeu | Valeur | Zone |
| --- | --- | --- |
| objet `+0x34` | base + *n* × `0x40` | les interruptions relayées |
| objet `+0x58` | base + `0x800` + *n* × `0x200` | la file de commandes |
| objet `+0x5c` | base + `0x200` + *n* × `0x80` | les tampons d'écran, écran du haut |
| objet `+0x60` | la précédente + `0x40` | les tampons d'écran, écran du bas |

L'« objet » est l'état du client `gsp` du jeu, à `0x5afc40` (son adresse est rangée à `0x5e7f4c`). Ces quatre calculs sont exactement ceux de la fiche `gsp`, partie 5, lus de l'autre côté.

**Erreurs.** `0xD8A02A05`. Le jeu arrête tout (`0x15fb94`) si la création du signal ou celle du fil échoue, mais il ne teste pas le résultat de la commande elle-même.

**Pour répondre à la place de la console.** Fournir une page de `0x1000` octets que les deux côtés voient, rendre 0 (voir la partie 2 pour `0x2A07`), le numéro 0, et la poignée de la page. Mettre à zéro les trois premiers mots de la zone d'interruptions du client, comme `relay_register` (`gsp` `0x10bd6c`).

### TriggerCmdReqQueue (`0x000C0000`)

**Rôle.** Dire à `gsp` « regarde ma file ». Aucun paramètre.

| Mot | Requête | Réponse |
| --- | --- | --- |
| 0 | `0x000C0000` | `0x000C0040` |
| 1 | | 0, toujours |

**Côté jeu.** Un seul appelant : `gx_queue_push` (jeu `0x1730ec`), et seulement **quand le nombre de commandes en attente vient de passer de 0 à 1**. Une commande ajoutée à une file non vide ne provoque aucun message.

**Côté `gsp`.** `gspgpu_TriggerCmdReqQueue` (`0x1095c0`) lève l'octet `+0x29` de l'objet file et réveille le fil de la file. Aucun contrôle, aucune erreur. À partir de là, chaque fin d'opération réveille de nouveau ce fil.

**Pour répondre à la place de la console.** Rendre 0, puis vider la file (partie 4). Comme le jeu ne prévient pas pour les commandes suivantes, il faut **relire la file après chaque commande terminée**, pas seulement à la réception du message.

### SetLcdForceBlack (`0x000B0040`)

**Rôle.** Mettre les deux écrans au noir, ou lever ce noir.

| Mot | Ce que le jeu écrit (`0x125674`) | Ce que `gsp` lit |
| --- | --- | --- |
| 0 | `0x000B0040` | seul le numéro compte |
| 1 | un octet : 0 ou 1 | un octet signé |

Réponse : `0x000B0040`, puis le résultat.

**Qui l'envoie.** Avec 0 : `gsp_unforce_lcd_black` (jeu `0x1255e4`), à la fin de l'installation de l'affichage et à un autre endroit (`0x10a008`). Avec 1 : `gsp_force_lcd_black` (jeu `0x10fdc8`), à la sortie du jeu ; si la session est fermée, elle la rouvre le temps de l'envoi.

**Côté `gsp`.** L'octet est rangé à deux endroits de l'objet des écrans, puis `lcd_update_force_black` (`0x107c94`) écrit `0x01000000` ou 0 dans `0x1ED02204` et `0x1ED02A04`. Erreur possible : `0xD8202A06`, seulement pour lever le noir, sans le droit, et après une remise à zéro forcée du processeur graphique. Le jeu n'en provoque jamais (il envoie 0 comme drapeau d'AcquireRight).

**Pour répondre à la place de la console.** Rendre 0. Avec 0, c'est le moment où l'image doit devenir visible.

### WriteHWRegs (`0x00010082`)

**Rôle.** Écrire directement dans des registres du matériel.

| Mot | Ce que le jeu écrit (`0x1645b0`) | Ce que `gsp` lit |
| --- | --- | --- |
| 0 | `0x00010082` | vérifié en entier (E) |
| 1 | le décalage du registre, à ajouter à `0x1EB00000` | le décalage |
| 2 | la taille en octets | **pas lu** |
| 3 | (taille × `0x4000`) + 2 : le descripteur d'un tampon fixe, numéro 0 | vérifié (`& 0x3C0F` doit valoir 2) ; **la taille est prise ici**, dans les bits du haut |
| 4 | l'adresse des données chez le jeu | l'adresse où le noyau a recopié ces données chez `gsp` |

Réponse : `0x00010040`, puis le résultat.

**Contrôles et erreurs dans `gsp`.** Le droit d'affichage (D). Le décalage multiple de 4 et inférieur à `0x420000`, sinon `0xE0E02A01`. La taille au plus `0x80`, sinon `0xE0E02BEC`, et multiple de 4, sinon `0xE0E02BF2`.

**Côté jeu.** Une seule fonction intermédiaire (`gsp_write_hw_regs`, jeu `0x149314`), appelée 64 fois, toutes dans `gx_initialize`, toutes avec une taille de 4. Elles ne partent que sur le chemin `0x2A07` (partie 7).

**Pour répondre à la place de la console.** Rendre 0. Le contenu n'a d'intérêt que si le portage imite les registres des écrans.

### WriteHWRegsWithMask (`0x00020084`)

**Rôle.** La même chose, en ne changeant que certains bits : registre = (registre sans les bits du masque) + (donnée limitée au masque).

| Mot | Ce que le jeu écrit (`0x164634`) | Ce que `gsp` lit |
| --- | --- | --- |
| 0 | `0x00020084` | vérifié en entier (E) |
| 1 | le décalage | le décalage |
| 2 | la taille | pas lu |
| 3 | (taille × `0x4000`) + 2 | vérifié, donne la taille |
| 4 | l'adresse des données | les données |
| 5 | (taille × `0x4000`) + `0x402` : tampon fixe numéro 1 | vérifié (`& 0x3C0F` doit valoir `0x402`) |
| 6 | l'adresse du masque | le masque |

Réponse : `0x00020040`, puis le résultat. Mêmes contrôles et mêmes erreurs que WriteHWRegs. Quatre appels dans le jeu, tous dans `gx_initialize`.

### ReadHWRegs (`0x00040080`)

**Rôle.** Lire des registres du matériel.

| Mot | Ce que le jeu écrit (`0x16455c`) | Ce que `gsp` lit |
| --- | --- | --- |
| 0 | `0x00040080` | seul le numéro compte |
| 1 | le décalage | le décalage |
| 2 | la taille | la taille, ramenée à `0x80` si elle dépasse |

Avant l'appel, le jeu range à `+0x180` et `+0x184` de son stockage local le descripteur (taille × `0x4000`) + 2 et l'adresse où il veut le résultat : c'est là qu'on déclare un tampon de réception. Il remet les anciennes valeurs après l'appel.

| Mot de réponse | Contenu écrit par `gsp` | Ce que le jeu en fait |
| --- | --- | --- |
| 0 | `0x00040042` | rien |
| 1 | le résultat | rendu à l'appelant |
| 2 | (taille × `0x4000`) + 2 | rien : c'est le noyau qui s'en sert |
| 3 | l'adresse du tampon de `gsp` | rien : le noyau a déjà recopié les octets à l'adresse déclarée |

**Côté jeu.** Un seul appelant : une fonction de consultation à 15 cas (jeu `0x130154`), cas `0x20E`, qui lit 4 octets au décalage `0x400058`, soit `0x1EF00058`. Je n'ai pas trouvé ce registre dans ce que j'ai lu de 3dbrew, et je n'ai pas cherché ce que les appelants font de la valeur.

**Erreurs.** Les mêmes que WriteHWRegs, plus `0xD8202A06` sans le droit.

**Pour répondre à la place de la console.** Écrire 4 octets à l'adresse que le jeu a rangée à `+0x184` de son stockage local, rendre 0. Quelle valeur y mettre reste à trouver.

### FlushDataCache (`0x00080082`)

**Rôle.** Faire écrire en mémoire ce qui traîne encore dans le cache du processeur, pour une zone que le processeur graphique va lire.

| Mot | Ce que le jeu écrit (`0x1645f8`) | Ce que `gsp` lit |
| --- | --- | --- |
| 0 | `0x00080082` | vérifié en entier (E) |
| 1 | l'adresse | l'adresse |
| 2 | la taille en octets | la taille |
| 3 | 0 | doit valoir 0 |
| 4 | `0xFFFF8001`, lu à `0x5705c8` | la poignée du processus du jeu |

Réponse : `0x00080040`, puis le résultat.

**Côté `gsp`.** La zone doit être dans le tas linéaire ou dans la mémoire supplémentaire de la New 3DS (partie 6), sinon `0xE0E02BF5`. Puis `svcFlushProcessDataCache` (`svc 0x54`) avec la poignée, l'adresse et la taille, et la poignée est refermée dans tous les cas.

**Côté jeu.** Une fonction intermédiaire (`gsp_flush_data_cache`, jeu `0x1493ec`) qu'on atteint par un saut (`0x143754`), depuis 19 endroits du moteur : c'est ce que le jeu appelle après avoir rempli une texture ou un tampon de sommets.

**Pour répondre à la place de la console.** Rendre 0 sans rien faire : sur PC il n'y a pas de cache à vider.

### ReleaseRight (`0x00170000`) et le retour par AcquireRight

**Rôle.** Rendre le droit d'afficher, quand le jeu passe à l'arrière-plan.

Requête : l'en-tête seul. Réponse : `0x00170040`, puis le résultat.

**Côté `gsp`** (`0x10b728`). Si le client avait le droit : plus de propriétaire au registre des droits, au relais, à la file et à l'affichage ; la poignée du processus est refermée ; le suivant dans l'attente est libéré. S'il ne l'avait pas, rien, et 0 quand même. Erreur : `0xD8A02A05`.

**Côté jeu.** `gsp_release_right` (jeu `0x11a308`), puis au retour `gsp_reacquire_right` (jeu `0x11a2a0`), toutes deux appelées par `0x125848`. Quand l'octet `0x5e7f31` est levé, elles touchent aussi à la mémoire partagée : après ReleaseRight, le bit 0 de l'octet `+0x03` de la zone d'interruptions passe à 1 (« ne me relaie plus les fins d'image ») ; après AcquireRight il repasse à 0 (`gsp_set_skip_vblank_flag`, jeu `0x125610`).

**Pour répondre à la place de la console.** Rendre 0. Tant qu'il n'y a qu'un programme, ces commandes n'ont rien à faire.

### SaveVramSysArea (`0x00190000`) et RestoreVramSysArea (`0x001A0000`)

**Rôle.** Mettre de côté le contenu de la mémoire vidéo avant de céder l'écran, et le remettre ensuite.

Requête : l'en-tête seul. Réponse : `0x00190040` ou `0x001A0040`, puis le résultat.

**Côté `gsp`.** Il faut que le client ait mis le bit 0 dans les drapeaux de RegisterInterruptRelayQueue, sinon `0xD8202A06`. La sauvegarde attend d'abord, par pas d'une milliseconde et 33 fois au plus, que la file soit vide et que plus rien ne soit en cours. La copie elle-même (`0x10b978`, `0x106214`) n'est pas lue.

**Côté jeu.** `gsp_save_vram` (jeu `0x134b74`, trois appelants : `0x11af2c`, `0x125a6c`, `0x1497b0`) et `gsp_restore_vram` (jeu `0x110148`, appelée par `0x11b074`). La seconde ne part que si un octet du jeu dit qu'une sauvegarde a eu lieu. Ce sont les chemins de la mise en attente (bouton HOME, veille), pas du démarrage.

**Pour répondre à la place de la console.** Rendre 0. La mémoire vidéo d'un portage n'est disputée par personne.

### ImportDisplayCaptureInfo (`0x00180000`)

**Rôle.** Demander quelles images sont à l'écran, pour en faire une capture (le menu HOME en montre une).

Requête : l'en-tête seul.

| Mot de réponse | Contenu écrit par `gsp` (`0x10bcb8`) | Ce que le jeu en fait (`0x173428`, puis `0x1644e8`) |
| --- | --- | --- |
| 0 | `0x00180240` | rien |
| 1 | 0, toujours | rendu |
| 2 | écran du haut : l'adresse de l'image de gauche | gardée ; si elle est nulle, le format devient −1 |
| 3 | écran du haut : l'adresse de l'image de droite | remplacée par celle de gauche si le bit 5 du format est baissé (pas de relief) ; si elle reste nulle, le format devient −1 |
| 4 | écran du haut : le mot de format | si les bits 4 à 6 sont tous nuls, −1 ; sinon seuls les 3 bits du bas sont gardés |
| 5 | écran du haut : la largeur de ligne | gardée |
| 6 | écran du bas : l'adresse de l'image | gardée ; si elle est nulle, le format devient −1 |
| 7 | écran du bas : la seconde adresse | remplacée par la première |
| 8 | écran du bas : le mot de format | seuls les 3 bits du bas sont gardés |
| 9 | écran du bas : la largeur de ligne | gardée |

Avant de répondre, `gsp` prend en compte une image annoncée dans la mémoire partagée et pas encore affichée. Les adresses rendues sont celles que le jeu avait données : des adresses de son espace, pas des adresses physiques.

**Pour répondre à la place de la console.** Rendre les derniers mots 1, 2, 4 et 3 de la description de chaque écran (partie 5), dans cet ordre.

### UnregisterInterruptRelayQueue (`0x00140000`)

**Rôle.** Se désinscrire, à l'arrêt.

Requête : l'en-tête seul. Réponse : `0x00140040`, puis le résultat. `gsp` (`0x109808`, puis `relay_unregister` `0x107814`) oublie la file du client et referme la poignée de son signal. Erreur : `0xD8A02A05`.

**Côté jeu.** `gsp_client_unregister_relay` (jeu `0x17333c`), appelée par `gsp_client_exit` (jeu `0x1646d0`). Avant l'envoi, elle lève l'octet d'arrêt de son fil d'interruptions, déclenche elle-même le signal pour le réveiller, attend sa fin, puis referme le signal et retire la mémoire partagée.

### SetAxiConfigQoSMode (`0x00100040`)

**Rôle.** Régler la priorité d'accès à la mémoire entre les composants de la console.

| Mot | Ce que le jeu écrit (`0x2c8eac`) | Ce que `gsp` lit |
| --- | --- | --- |
| 0 | `0x00100040` | seul le numéro compte |
| 1 | la valeur reçue en paramètre | la valeur |

Réponse : `0x00100040`, puis le résultat. `gsp` range la valeur dans la fiche du client et, s'il a le droit, l'écrit en deux morceaux dans `0x1ED0F400` et `0x1ED0F404` (`set_axi_qos`, `0x10d824`). Erreur : `0xD8A02A05`.

La fonction du jeu n'est appelée par personne dans le code principal : seul un module `.cro` peut l'appeler, et la valeur vient de lui. Je ne l'ai pas cherchée.

**Pour répondre à la place de la console.** Rendre 0.

## Partie 4 : la file de commandes graphiques

C'est par là que passe tout le dessin. Le jeu n'envoie aucune des commandes du service qui portent un nom d'opération graphique (SetDisplayTransfer, SetTextureCopy, SetMemoryFill, SetCommandList, RequestDma) : comme l'annonçait la fiche `gsp`, elles ne font rien dans le module, et le jeu ne les a même pas.

### Deux étages dans le jeu

Le jeu ne remplit pas la file de `gsp` directement. Il tient d'abord sa propre liste de **demandes**, puis les traduit une à une.

| Étage | Où | Forme |
| --- | --- | --- |
| les demandes du jeu | un tableau de cases de `0x1C` octets, dans l'objet « liste de commandes » courant (son adresse est à `0x625da8 + 0x9c`) | octet 0 : le type, de 0 à 4 ; les mots suivants : les paramètres, dans un codage propre à la bibliothèque |
| la file de `gsp` | la mémoire partagée | des cases de `0x20` octets, décrites plus bas |

`gx_dispatch_pending_requests` (jeu `0x15d8d4`) fait la traduction : elle prend la prochaine demande, aiguille sur son type par cinq cas, et appelle la fonction qui range la commande correspondante. Elle n'en range **qu'une à la fois** : la suivante ne part que lorsque l'interruption de fin de la précédente est arrivée (partie 5). La file de `gsp` ne contient donc presque jamais plus d'une ou deux commandes.

Dans l'objet « liste de commandes » : le tableau des demandes est à `+0x18`, le nombre de demandes à `+0x20`, la prochaine à envoyer à `+0x24`, la prochaine à voir finie à `+0x28`.

### L'en-tête de la file

| Octet | Rôle | Ce que fait le jeu | Ce que fait `gsp` |
| --- | --- | --- | --- |
| `+0x00` | le rang de la plus ancienne commande | mis à 0 à l'inscription s'il dépasse 14 ; sinon seulement lu | avancé d'un cran, modulo 15, à chaque commande prise |
| `+0x01` | le nombre de commandes en attente | mis à 0 à l'inscription ; augmenté de 1 après chaque écriture | diminué de 1 à chaque commande prise |
| `+0x02` | l'état | mis à 0 à l'inscription | 1 = arrêtée ; `0x80` = la dernière commande a échoué |
| `+0x03` | les demandes du jeu | mis à 0 à l'inscription | bit 0 : arrêter la file |
| `+0x04` (un mot) | le code d'erreur | pas lu sur les chemins suivis | écrit quand une commande échoue |

Le premier mot est toujours modifié par une écriture atomique, des deux côtés (`ldrex` et `strex`), parce qu'il n'y a pas de verrou commun.

`gx_queue_attach` (jeu `0x17308c`) fait la remise à zéro de l'inscription. `gx_queue_push` (jeu `0x1730ec`) range une commande :

1. si le pointeur de file est nul, rendre `0xD8A02BF8` ; si le nombre vaut déjà 15, rendre `0xD8A02A02` ;
2. calculer la case : (rang + nombre) modulo 15, à l'adresse file + `0x20` + case × `0x20` ;
3. y recopier les 8 mots ;
4. augmenter le nombre de 1 ;
5. si le nombre vaut maintenant 1, envoyer TriggerCmdReqQueue.

De l'autre côté, `cmd_queue_thread_main` (`gsp` `0x103b14`) fait le chemin inverse : il regarde le nombre, lit la case de rang `+0x00`, avance le rang et baisse le nombre. Les deux calculs se répondent : `0x20 + 15 × 0x20 = 0x200`, la taille de la zone.

### Le premier mot d'une commande

| Octet | Ce que le jeu écrit | Ce que `gsp` en fait |
| --- | --- | --- |
| 0 | l'identifiant, de 0 à 5 | l'aiguillage ; au-delà de 5 : `0xE0C02BF4` |
| 1 | **1**, toujours | **pas lu** |
| 2 | 0, toujours | s'il n'est pas nul, la file passe à l'état « arrêtée » après cette commande |
| 3 | **1** pour les commandes 0 à 4, **0** pour la commande 5 | s'il n'est pas nul, la commande attend que **plus rien** ne soit en cours ; sinon elle n'attend que le matériel dont elle a besoin |

Les octets 1 et 2 viennent d'un modèle de 8 mots rangé dans les données du jeu (`0x577cbc`, premier mot `0x01000100`, les sept autres à zéro), et l'octet 3 d'un octet voisin (`0x5e9630`, qui vaut 1). Aucune instruction ne modifie ces deux endroits. **Les mots qu'une commande ne remplit pas elle-même sont recopiés de ce modèle : ils valent donc zéro.**

Conséquence : pour les commandes 0 à 4, le jeu demande toujours l'attente la plus stricte. `gsp` ne lance jamais deux opérations du jeu en même temps.

### Commande 0 : demande de transfert mémoire

Une copie de mémoire à mémoire, par le contrôleur DMA.

| Mot | Vu du jeu (`0x163fe4`) | Vu de `gsp` (`gx_request_dma`, `0x10c1c8`) | D'après 3dbrew |
| --- | --- | --- | --- |
| 1 | la source (adresse du jeu) | la source | adresse source |
| 2 | la destination (adresse du jeu) | la destination | adresse de destination |
| 3 | la taille en octets | la taille | taille |
| 4 à 6 | 0 | pas lus | inutilisés |
| 7 | 1 pour vider le cache de la source avant ; le jeu met 1 sauf si le bit 0 du mot `+0x10` de sa demande est levé | s'il n'est pas nul et que la source n'est pas dans la mémoire vidéo, `svcFlushProcessDataCache` sur la source | vider la source (0 ou 1) |

**Unités.** Des adresses de l'espace du jeu et des octets. Aucune traduction ici : `gsp` passe les adresses telles quelles à `svcStartInterProcessDma`. Si la destination est dans la mémoire vidéo (`0x1F000000` à `0x1F600000`), le processus de destination est `gsp` lui-même, sinon celui du jeu.

**Un garde-fou du jeu.** La fonction qui range cette commande refuse, **sans erreur et sans rien ranger**, une destination hors de la mémoire vidéo. Le jeu ne copie par DMA que vers la mémoire vidéo.

**Erreurs.** `0xC8402BF0` si un autre DMA est en cours (un seul à la fois). **Fin** : l'interruption 6.

**Qui crée la demande.** Type 0 : `0x16c62c`, `0x16d984`, `0x4d6f24`.

### Commande 1 : traitement d'une liste de commandes

Donner au processeur graphique une liste de commandes à exécuter. C'est la commande du dessin proprement dit.

| Mot | Vu du jeu (`0x1640d4`) | Vu de `gsp` (`gx_process_command_list`, `0x10c26c`) | D'après 3dbrew |
| --- | --- | --- | --- |
| 1 | l'adresse de la liste (adresse du jeu) | traduite en adresse physique, divisée par 8, écrite dans `0x1EF018E8` | adresse du tampon |
| 2 | la taille de la liste en octets | divisée par 8, écrite dans `0x1EF018E0` | taille du tampon |
| 3 | 0 ou 1 : le bit 0 du mot `+0x0c` de la demande | le bit 0 est gardé dans l'objet des interruptions (`+0x51`) ; à la fin de la liste, s'il est levé, un calcul sur `0x1EF01394` | mettre à jour les résultats du mélange additif du gaz |
| 4 à 6 | 0 | pas lus | inutilisés |
| 7 | **0, toujours** | s'il n'est pas nul, `svcFlushProcessDataCache` sur la liste avant de la lancer | vider le tampon (0 ou 1) |

**Unités.** Une adresse du jeu, une taille en octets. Les deux doivent être multiples de 8, puisque `gsp` les divise par 8 sans vérifier. Après les deux écritures, `gsp` met 1 dans `0x1EF018F0` : c'est le départ.

**Le jeu vide le cache autrement.** Il laisse le mot 7 à zéro et range, juste avant, une **commande 5** sur la même zone. Il le fait sauf si le bit 2 du mot `+0x0c` de sa demande est levé. La séquence ordinaire est donc : commande 5, puis commande 1.

**Erreurs.** Celle du vidage de cache, s'il y en a un. **Fin** : l'interruption 5.

**Qui crée la demande.** Type 1 : `gx_flush_command_list` (jeu `0x1434d4`) et six autres fonctions (`0x157f98`, `0x16d8a4`, `0x359e50`, `0x4d6fe4`, `0x4d71a0`, `0x4d7530`). **C'est là que le jeu fabrique ses listes** : `gx_flush_command_list` ferme le tampon en cours en y ajoutant trois couples de mots (`0x000F0111`, `0x000F0110`, puis `0x12345678` avec `0x000F0010`), précédés d'un couple de remplissage (`0x0008025E`) si la taille n'est pas multiple de 16. Le pointeur d'écriture du tampon est à `0x5db3c8` et sa limite à `0x5db3cc`. Le contenu de ces listes est hors de ce document.

### Commande 2 : remplissage de mémoire

Remplir une ou deux zones avec une valeur. Sert à effacer l'image et le tampon de profondeur.

| Mot | Vu du jeu (`0x164064`) | Vu de `gsp` (`gx_memory_fill`, `0x10bf74`) | D'après 3dbrew |
| --- | --- | --- | --- |
| 1 | début de la première zone (adresse du jeu) | traduit, divisé par 8, écrit dans `0x1EF00010` | début du tampon 0 |
| 2 | valeur de remplissage | écrite dans `0x1EF00018` | valeur du tampon 0 |
| 3 | **fin** de la première zone : début + taille | traduite, divisée par 8, écrite dans `0x1EF00014` | fin du tampon 0 |
| 4 | début de la seconde zone | `0x1EF00020` | début du tampon 1 |
| 5 | valeur | `0x1EF00028` | valeur du tampon 1 |
| 6 | fin de la seconde zone | `0x1EF00024` | fin du tampon 1 |
| 7 | 16 bits du bas : réglage de la première zone ; 16 bits du haut : réglage de la seconde | chaque moitié remplace les 16 bits du bas de `0x1EF0001C` et de `0x1EF0002C` | réglage 0 + réglage 1 × `0x10000` |

**Unités.** Des adresses du jeu ; le mot 3 est une adresse de **fin**, pas une taille. La taille tient sur 23 bits dans la demande du jeu, soit moins de `0x800000` octets.

**Le réglage**, tel que le jeu le fabrique : le bit 0 toujours levé (c'est le départ), et les bits 8 et 9 pour la largeur de la valeur.

| Largeur demandée par le jeu | Bits 8 et 9 | Réglage | D'après 3dbrew |
| --- | --- | --- | --- |
| 16 bits | 0 | `0x0001` | 16 bits |
| 24 bits | 1 | `0x0101` | 24 bits |
| 32 bits | 2 | `0x0201` | 32 bits |

**Contrôles dans `gsp`.** Un début nul veut dire « pas de zone ». Sinon la fin doit être plus grande que le début et l'adresse doit se traduire, faute de quoi `0xE0E02BF5`. Si la seconde zone manque, la commande réussit quand même ; si c'est la première qui manque, tout dépend de la seconde.

**Fin : une seule interruption.** `gsp` attend les deux fins quand il y a deux zones, et ne prévient qu'une fois, par l'octet 0. Avec une seule zone, l'octet relayé est 0 pour la première et 1 pour la seconde. Le jeu, lui, traite les octets 0 et 1 de la même façon : « une demande est finie ». **Relayer deux interruptions pour un seul remplissage ferait croire au jeu que deux demandes sont finies.**

**Qui crée la demande.** Type 2 : `gx_request_memory_fill` (jeu `0x1318dc`) et `0x4cd334`. Au démarrage (partie 2, étape 13), la commande rangée est : mot 1 `0x1F000000`, mot 2 zéro, mot 3 `0x1F300000`, mot 4 `0x1F300000`, mot 5 zéro, mot 6 `0x1F600000`, mot 7 `0x02010201`.

### Commande 3 : transfert vers l'écran

Convertir une image rendue (rangée en tuiles) en image affichable (rangée en lignes), avec changement de format et réduction éventuels.

| Mot | Vu du jeu (`0x16447c`) | Vu de `gsp` (`gx_display_transfer`, `0x10c360`) | D'après 3dbrew |
| --- | --- | --- | --- |
| 1 | adresse d'entrée (adresse du jeu) | traduite, divisée par 8, écrite dans `0x1EF00C00` | adresse source |
| 2 | adresse de sortie | traduite, divisée par 8, écrite dans `0x1EF00C04` | adresse de destination |
| 3 | largeur d'entrée + hauteur d'entrée × `0x10000` | écrit dans `0x1EF00C0C` | dimensions de la source |
| 4 | largeur de sortie + hauteur de sortie × `0x10000` | écrit dans `0x1EF00C08` | dimensions de la sortie |
| 5 | les drapeaux | écrit dans `0x1EF00C10` | drapeaux |
| 6, 7 | 0 | pas lus | inutilisés |

Puis `gsp` met 0 dans `0x1EF00C14` et 1 dans `0x1EF00C18` (le départ). **Aucun contrôle** : une adresse qui ne se traduit pas donne une adresse physique nulle, sans erreur.

**Unités.** Des adresses du jeu ; des dimensions en points.

**Les drapeaux**, tels que le jeu les fabrique à partir du mot `+0x14` de sa demande :

| Bits du mot 5 | Sens d'après 3dbrew | D'où le jeu les tire |
| --- | --- | --- |
| 0 | retourner l'image de haut en bas | bit 6 de la demande |
| 1 | de lignes vers tuiles | bit 10 |
| 2 | à lever quand la sortie est plus étroite que l'entrée (rognage) | calculé : levé si la largeur de sortie est plus petite que celle d'entrée, ou la hauteur de sortie plus petite que celle d'entrée |
| 5 | de tuiles vers tuiles | bit 11 |
| 8 à 10 | format d'entrée | bits 0 à 2 |
| 12 à 14 | format de sortie | bits 3 à 5 |
| 16 | tuiles de 32 × 32 au lieu de 8 × 8 | bit 9 |
| 24, 25 | réduction : 0 aucune, 1 en largeur, 2 dans les deux sens | bits 7 et 8 |

Le bit 3 (copie de texture) n'est jamais levé ici. Les formats sont ceux des tampons d'écran (partie 5).

**Fin** : l'interruption 4.

**Qui crée la demande.** Type 3 : `0x15d55c` (la plus générale : elle reçoit un format, des dimensions et un facteur de réduction), `0x176aa4`, `0x4d7530`, `0x4f1494`, `0x4f1634`, et le transfert d'essai de `gx_initialize`.

### Commande 4 : copie de texture

Une copie brute de mémoire vidéo à mémoire vidéo ou depuis le tas, ligne par ligne, sans conversion.

| Mot | Vu du jeu (`0x1641a4`) | Vu de `gsp` (`gx_texture_copy`, `0x10c0b8`) | D'après 3dbrew |
| --- | --- | --- | --- |
| 1 | adresse d'entrée (adresse du jeu) | traduite, divisée par 8, écrite dans `0x1EF00C00` | adresse source |
| 2 | adresse de sortie | traduite, divisée par 8, écrite dans `0x1EF00C04` | adresse de destination |
| 3 | la taille totale en octets | écrite dans `0x1EF00C20` | taille |
| 4 | largeur de ligne d'entrée + intervalle d'entrée × `0x10000` | écrit dans `0x1EF00C24` | largeur de ligne + intervalle × `0x10000` |
| 5 | la même chose pour la sortie | écrit dans `0x1EF00C28` | idem pour la destination |
| 6 | les drapeaux : 8, ou `0xC` si l'un des deux intervalles n'est pas nul | écrit dans `0x1EF00C10` | drapeaux |
| 7 | 0 | pas lu | inutilisé |

Puis `gsp` lève le bit 0 de `0x1EF00C18`.

**Unités.** Le mot 3 est en octets. Les largeurs et les intervalles des mots 4 et 5 sont **en paquets de 16 octets** : la fonction qui crée la demande (jeu `0x157be0`) divise par 16 les valeurs en octets qu'elle reçoit. 3dbrew dit la même chose pour les registres `0x1EF00C24` et `0x1EF00C28`.

**Les drapeaux.** Le bit 3 est « mode copie de texture » ; le bit 2 est le même bit de rognage que pour le transfert. `gsp` ne vérifie pas que le bit 3 est levé.

**Fin** : l'interruption 4, la même que pour le transfert.

**Qui crée la demande.** Type 4 : `0x157be0` seulement.

### Commande 5 : vidage de cache

| Mot | Vu du jeu (`0x1640d4`) | Vu de `gsp` (dans `gx_execute_command`, `0x1090e8`) | D'après 3dbrew |
| --- | --- | --- | --- |
| 1 | l'adresse de la liste de commandes | adresse de la première zone | adresse du tampon 0 |
| 2 | sa taille en octets | taille de la première zone | taille du tampon 0 |
| 3, 4 | 0 | adresse et taille de la deuxième zone | tampon 1 |
| 5, 6 | 0 | adresse et taille de la troisième zone | tampon 2 |
| 7 | 0 | pas lu | inutilisé |

`gsp` appelle `svcFlushProcessDataCache` sur le processus du client pour la première zone, puis pour la deuxième si sa taille n'est pas nulle, puis pour la troisième de même. Une taille nulle arrête la série : la troisième zone n'est regardée que si la deuxième existe. Erreur : `0xD8202A06` si aucun client n'a le droit.

**Aucune interruption en retour**, et aucune attente : c'est la seule commande que le jeu range avec l'octet 3 à zéro. Le jeu ne s'en sert que devant une commande 1.

### Pour répondre à la place de la console

1. À TriggerCmdReqQueue, et **après chaque commande terminée**, lire l'en-tête de la file du client propriétaire.
2. Tant que le nombre n'est pas nul : lire la case de rang `+0x00`, puis, par une écriture atomique, avancer le rang (modulo 15) et baisser le nombre.
3. Exécuter la commande. Les adresses sont celles du jeu : les traduire selon la partie 6, ou plus simplement y lire directement si l'on tient la mémoire du jeu.
4. Ranger l'octet de l'interruption de fin dans la zone des interruptions et déclencher le signal du jeu (partie 5). Rien pour la commande 5. **Une seule** pour la commande 2.
5. Ne jamais laisser une commande sans réponse : le jeu n'envoie la demande suivante qu'à l'arrivée de l'interruption.

## Partie 5 : les interruptions relayées et les tampons d'écran

### La zone des interruptions

`0x40` octets, à base + *n* × `0x40`.

| Octet | Rôle | `gsp` | Le jeu |
| --- | --- | --- | --- |
| `+0x00` | le rang de la plus ancienne interruption non lue | lu | avancé d'un cran, modulo `0x34`, à chaque lecture |
| `+0x01` | le nombre d'interruptions en attente | augmenté de 1 à chaque dépôt | diminué de 1 à chaque lecture |
| `+0x02` | « une interruption a été perdue » | mis à 1 quand la file est pleine (`0x34` en attente) | lu après chaque lecture, mais sans effet (voir plus bas) |
| `+0x03` | bit 0 : « ne me relaie pas les fins d'image » | lu avant de déposer une fin d'image | écrit autour de ReleaseRight et d'AcquireRight (partie 3) |
| `+0x04`, `+0x08` | compteurs de fins d'image non relayées | augmentés quand il y a déjà `0x20` interruptions en attente | pas lus sur les chemins suivis |
| `+0x0C` | 52 octets (`0x34`), en anneau | écrit à la place (rang + nombre) modulo `0x34` | lu à la place « rang » |

Là encore le premier mot est modifié par des écritures atomiques des deux côtés. `relay_register` (`gsp` `0x10bd6c`) met à zéro les trois premiers mots à l'inscription.

### Le fil du jeu qui attend

`gsp_interrupt_thread_main` (jeu `0x1731e4`) est créé à l'inscription, avec une pile de `0x1000` octets prise dans l'objet client. Sa priorité sort d'une constante codée (`0x5109D502`) à laquelle la fonction de création (jeu `0x17d890`) ajoute `0xAEF62B00` puis `0x18` : cela ferait `0x1A`, si le mot calculé est bien celui que reçoit `svcCreateThread`, ce que je n'ai pas suivi.

Sa boucle :

1. `svcWaitSynchronization1` (`svc 0x24`) sur le signal, sans limite de temps ;
2. `svcClearEvent` (`svc 0x19`) ;
3. si l'octet d'arrêt de l'objet (`+0x77`) est levé, sortir ;
4. tant que le nombre d'interruptions n'est pas nul : lire l'octet de rang `+0x00`, avancer le rang et baisser le nombre, prendre le verrou de l'objet, appeler la fonction de rappel rangée à objet `+0x10` + octet × 4 si elle n'est pas nulle, réveiller un éventuel fil en attente (l'octet `+0x76` et l'événement à `+0x64`), rendre le verrou ;
5. revenir en 1.

Un seul déclenchement du signal peut donc servir plusieurs interruptions : le fil vide la zone avant de se rendormir. À l'étape 4, si l'octet `+0x02` vaut 1, le code prépare la valeur `0xD8A02A02` mais ne la regarde que pour savoir s'il reste quelque chose à lire : une interruption perdue n'est signalée à personne.

`gsp_wait_interrupt` (jeu `0x149340`) est l'autre moitié : c'est la fonction que le reste du jeu appelle pour dormir jusqu'à la prochaine interruption traitée. `gx_wait_requests_done` (jeu `0x143758`, 10 appelants) et `gx_wait_vblank` (jeu `0x122cdc`) sont bâties dessus.

### Ce que le jeu fait de chaque type

Les sept fonctions de rappel sont posées par `gx_initialize` avec `gsp_set_interrupt_handler` (jeu `0x149468`), dans cet ordre :

| Octet | Sens (noms de 3dbrew) | Fonction du jeu | Ce qu'elle fait |
| --- | --- | --- | --- |
| 0 | PSC0, fin du premier remplissage | `0x1438e4`, un saut vers `gx_on_request_done` | la demande en cours est finie |
| 1 | PSC1, fin du second remplissage | `0x1438e8`, le même saut | la même chose |
| 2 | PDC0, fin d'image de l'écran du haut | `gx_on_vblank_top` `0x143854` | appelle la fonction de rappel de l'application avec `0x400` si elle existe (`0x625da8 + 0x15c`), puis ajoute 1 au compteur `0x625da8 + 0x154` |
| 3 | PDC1, fin d'image de l'écran du bas | `gx_on_vblank_bottom` `0x143898` | la même chose avec `0x401`, la fonction `+0x160` et le compteur `+0x158` |
| 4 | PPF, fin d'un transfert ou d'une copie | `0x1438e0`, le même saut | la demande en cours est finie |
| 5 | P3D, fin d'une liste de commandes | `gx_on_p3d_done` `0x143814` | ajoute la taille de la liste au total exécuté (sauf si le bit 1 du mot `+0x0c` de la demande est levé), puis « la demande en cours est finie » |
| 6 | fin d'un DMA | `0x15d804`, qui tombe dans `gx_on_request_done` | la demande en cours est finie |

`gx_on_request_done` (jeu `0x15d808`) avance le compteur des demandes finies, puis : s'il reste des demandes, elle appelle `gx_dispatch_pending_requests`, qui range la suivante dans la file ; sinon elle baisse l'octet « occupé » (`0x625da8 + 0x11`), ce qui libère les fils qui attendent dans `gx_wait_requests_done`. Elle appelle aussi, si elle existe, une fonction de rappel de l'application (`+0x38` de l'objet liste).

**Le jeu ne regarde jamais quel octet a fini quelle demande.** Cinq des sept types font avancer le même compteur. C'est ce qui rend l'ordre et le nombre des interruptions si importants : une de trop ou une de moins décale tout.

### Les tampons d'écran

Le jeu annonce l'image à montrer **uniquement par la mémoire partagée**. Deux zones de `0x40` octets par client : l'écran du haut à base + `0x200` + *n* × `0x80`, celui du bas `0x40` plus loin.

| Octet | Rôle | Le jeu | `gsp` |
| --- | --- | --- | --- |
| `+0x00` | laquelle des deux descriptions est la bonne (0 ou 1) | écrit | lu |
| `+0x01` | « j'ai une nouvelle image » | mis à 1 | remis à 0 quand la description est prise |
| `+0x04` | première description, 7 mots (`0x1C` octets) | écrit | lu |
| `+0x20` | seconde description, 7 mots | écrit | lu |

Une description :

| Mot | Ce que le jeu écrit | Ce que `gsp` en fait (`pdc_set_framebuffer`, `0x10c5b4`) | D'après 3dbrew |
| --- | --- | --- | --- |
| 0 | 0 ou 1, en alternance à chaque image | choisit lequel des deux registres d'adresse reçoit l'image : `0x1EF00468` ou `0x1EF0046C` (haut), `0x1EF00568` ou `0x1EF0056C` (bas) | tampon actif |
| 1 | l'adresse de l'image de gauche (adresse du jeu) | traduite en adresse physique, **non divisée**, écrite dans ce registre | adresse du tampon de gauche |
| 2 | l'adresse de l'image de droite, ou 0 hors du relief ; toujours 0 pour l'écran du bas | écran du haut seulement : écrite dans `0x1EF00494` ou `0x1EF00498` ; si elle est nulle, l'adresse de gauche y va à sa place | adresse du tampon de droite |
| 3 | la largeur d'une ligne en octets : largeur du tampon × octets par point | écrite dans `0x1EF00490` ou `0x1EF00590` | largeur de ligne |
| 4 | le mot de format | ses 16 bits du bas remplacent ceux de `0x1EF00470` ou `0x1EF00570` | format |
| 5 | la même valeur que le mot 0 | son octet du bas va dans `0x1EF00478` ou `0x1EF00578` | sélection du tampon |
| 6 | 0 | pas lu | « attribut », inconnu |

**L'écriture, côté jeu.** `gsp_write_framebuffer_info` (jeu `0x149354`) remplit **l'autre** description (celle de rang 1 − octet `+0x00`), puis, par une écriture atomique, range ce rang dans l'octet `+0x00` et 1 dans l'octet `+0x01`. Elle refuse un numéro d'écran autre que 0 ou 1.

**Le mot de format**, fabriqué par `gx_swap_buffers` (jeu `0x1310c8`) :

| Bits | Valeur | D'où elle vient | D'après 3dbrew |
| --- | --- | --- | --- |
| 0 à 2 | le format des points (tableau suivant) | le format du tampon | format de couleur |
| 5 | 1 en relief (mode `0x702`), écran du haut seulement | le mode d'affichage | entrelacement des deux images (bits 4 et 5) |
| 6 | 1 en mode `0x700` et par défaut, écran du haut seulement ; 0 en mode `0x701` | le mode d'affichage | sortie modifiée : lignes doublées sur l'écran du haut |
| 8, 9 | 1 si le tampon est dans le tas (zone `0x10000`), 3 sinon | la zone mémoire du tampon | taille des rafales de lecture |

Dans `gsp`, ce sont les bits 4 à 6 du mot de l'écran du haut qui décident du mode de l'écran : `0x20` fait passer en relief, autre chose en à-plat (`display_apply_framebuffer`, `0x107b34`).

| Format des points (constante du jeu) | Code écrit | Octets par point |
| --- | --- | --- |
| `0x8058` | 0 | 4 |
| `0x8051` | 1 | 3 |
| `0x8D62` | 2 | 2 |
| `0x8057` | 3 | 2 |
| `0x8056` | 4 | 2 |

Les cinq codes et leur taille sont ceux que 3dbrew donne pour le registre de format (RGBA8, RGB8, RGB565, RGB5A1, RGBA4).

**L'adresse** n'est pas le début du tampon : le jeu y ajoute un décalage calculé avec la largeur, la hauteur et la position de la zone affichée. Je n'ai pas vérifié ce calcul terme à terme.

**Quand `gsp` s'en sert.** À chaque fin d'image d'un écran, `display_on_vblank` (`gsp` `0x10797c`) regarde l'octet `+0x01` du client propriétaire ; s'il est levé, la description est recopiée et appliquée aux registres. C'est donc **à la fin d'image suivante** que l'image change. ImportDisplayCaptureInfo fait la même prise en compte, sans attendre.

**Pour répondre à la place de la console.** À chaque image, pour chaque écran : si l'octet `+0x01` vaut 1, lire la description de rang `+0x00`, remettre l'octet `+0x01` à 0, et montrer désormais l'image à l'adresse du mot 1, avec la largeur de ligne du mot 3 et le format des 3 bits du bas du mot 4. Puis déposer l'octet 2 (écran du haut) ou 3 (écran du bas) dans la zone des interruptions et déclencher le signal.

## Partie 6 : la traduction des adresses

Le jeu ne donne à `gsp` que des adresses **de son propre espace** : dans la file, dans les descriptions de tampons d'écran, dans FlushDataCache. C'est `gsp` qui les convertit en adresses physiques. La seule exception est le chemin `0x2A07`, où le jeu écrit lui-même une adresse physique dans des registres (partie 7).

| Adresse du jeu | Ce que c'est | Conversion par `gsp` | Fonction de `gsp` |
| --- | --- | --- | --- |
| `0x14000000` à `0x1C000000` | l'ancien tas linéaire | plus `0x0C000000` | `linear_vaddr_to_paddr` `0x106594` |
| `0x30000000` à `0x40000000` | le tas linéaire | moins `0x10000000` | la même |
| `0x1F000000` à `0x1F600000` | la mémoire vidéo | moins `0x07000000` | écrit sur place dans chaque commande |
| `0x1E800000` à `0x1EC00000` | la mémoire supplémentaire de la New 3DS | plus `0x00800000` | `n3ds_extra_vaddr_to_paddr` `0x106564` |

L'ordre des essais est toujours le même : tas linéaire, puis mémoire vidéo, puis mémoire supplémentaire. Le début **et** la fin de la zone doivent tomber dans la même plage.

Ce que chaque commande en fait :

| Où | Divisée par 8 ? | Si l'adresse ne se traduit pas |
| --- | --- | --- |
| commande 1 (liste) | oui | adresse physique nulle, sans erreur |
| commande 2 (remplissage) | oui, début et fin | `0xE0E02BF5` |
| commandes 3 et 4 (transfert, copie) | oui | adresse physique nulle, sans erreur |
| commande 0 (DMA) | pas de traduction du tout | (le noyau juge) |
| description d'un tampon d'écran | non | `0xE0E02BF5`, et rien n'est écrit |
| FlushDataCache et commande 5 | pas de traduction : seulement le contrôle de plage pour la première | `0xE0E02BF5` pour FlushDataCache |

**Les adresses que le jeu donne, d'après ce qui a été lu :**

- La mémoire vidéo est coupée en deux moitiés que la bibliothèque connaît par un code : `0x20000` commence à `0x1F000000` et `0x30000` à `0x1F300000`, chacune de `0x300000` octets (`0x13032c` et `0x122c94`). Quand l'octet `0x5e7f31` est levé, les deux moitiés rétrécissent : `0x1F180000` sur `0x180000` octets, et `0x1F380000` sur `0x280000`.
- Le code `0x10000` désigne la mémoire ordinaire, obtenue par une fonction d'allocation que l'application fournit à `gx_initialize`. Les tampons de listes de commandes et le tampon du transfert d'essai en viennent.
- Je n'ai **pas** établi dans laquelle des deux plages de tas linéaire tombent ces allocations, ni dans quelle zone le jeu range ses tampons d'écran. Le mot de format le dit à chaque image (bits 8 et 9, partie 5), mais seulement à l'exécution.

**Pour un portage** qui tient la mémoire du jeu, la traduction devient inutile : il suffit de lire à l'adresse donnée. Il faut seulement que les quatre plages existent dans l'espace du jeu.

## Partie 7 : les registres que le jeu écrit lui-même

Quand RegisterInterruptRelayQueue rend `0x2A07`, `gx_initialize` programme le matériel par 68 commandes, de `0x130648` à `0x130c3c`. Les valeurs ci-dessous sortent d'une exécution de ce tronçon de code dans un émulateur de processeur, où chaque appel à `gsp_write_hw_regs` et à `gsp_write_hw_regs_with_mask` est relevé. Le décalage envoyé s'ajoute à `0x1EB00000`.

| Ordre | Décalage | Registre | Valeur | Ce que c'est d'après 3dbrew |
| --- | --- | --- | --- | --- |
| 1 | `0x401000` | `0x1EF01000` | 0 | inconnu ; mis à 0 à l'initialisation |
| 2 | `0x401080` | `0x1EF01080` | `0x12345678` | inconnu |
| 3 | `0x4010C0` | `0x1EF010C0` | `0xFFFFFFF0` | inconnu |
| 4 | `0x4010D0` | `0x1EF010D0` | 1 | inconnu |
| 5 à 23 | `0x400400` à `0x400448` | `0x1EF00400` à `0x1EF00448` | 19 valeurs | les réglages de balayage de l'écran du haut |
| 24 à 26 | `0x40045C`, `0x400460`, `0x400464` | | `0x019000F0`, `0x01C100D1`, `0x01920002` | largeur de l'image, début et fin de l'image, hauteur totale |
| 27 | `0x400470` | `0x1EF00470` | `0x00080340` | format de l'écran du haut |
| 28 | `0x40049C` | `0x1EF0049C` | 0 | non décrit |
| 29 à 47 | `0x400500` à `0x400548` | `0x1EF00500` à `0x1EF00548` | 19 valeurs | les réglages de balayage de l'écran du bas |
| 48 à 50 | `0x40055C`, `0x400560`, `0x400564` | | `0x014000F0`, `0x01C100D1`, `0x01920052` | les mêmes pour l'écran du bas |
| 51 | `0x400570` | `0x1EF00570` | `0x00080300` | format de l'écran du bas |
| 52 | `0x40059C` | `0x1EF0059C` | 0 | non décrit |
| 53 à 58 | `0x400468`, `0x40046C`, `0x400568`, `0x40056C`, `0x400494`, `0x400498` | | `0x18300000` les six | les six adresses d'image : une **adresse physique**, celle de `0x1F300000` |
| 59, 60 | `0x400478`, `0x400578` | | 1 | sélection du tampon |
| 61 | `0x400C18`, avec masque `0x0000FF00` | `0x1EF00C18` | 0 | bit 8 du transfert : « terminé » |
| 62 | `0x400004` | `0x1EF00004` | `0x00070100` | inconnu |
| 63, 64 | `0x40001C`, `0x40002C`, avec masque `0x000000FF` | | 0 | les réglages des deux remplissages |
| 65 | `0x400050` | `0x1EF00050` | `0x22221200` | inconnu ; cette valeur à l'initialisation |
| 66 | `0x400054`, avec masque `0x0000FFFF` | `0x1EF00054` | `0x00000FF2` | inconnu ; cette valeur à l'initialisation |
| 67, 68 | `0x400474`, `0x400574` | | `0x00010501` | commande du contrôleur d'écran : marche, interruptions |

Le détail des 68 lignes est dans `local/analyse/contrat-gsp/hwregs_init.txt`.

Deux recoupements. Les valeurs des lignes 1 à 4, 62, 65 et 66 sont celles que `gsp` écrit lui-même dans les mêmes registres à sa remise à zéro (fiche `gsp`, partie 9, `gpu_hw_reset`) : le jeu refait le travail du module. Et la ligne 67 porte la valeur `0x10501` que `pdc_init` de `gsp` écrit dans `0x1EF00474`.

Toutes ces écritures ont une taille de 4 et un décalage sous `0x420000` : aucune ne peut être refusée par les contrôles de `gsp`.

## Partie 8 : les désaccords relevés

| Sujet | Ce que dit une source | Ce que dit le code |
| --- | --- | --- |
| Quand `gsp` prend la description d'un tampon d'écran | le résumé obtenu de 3dbrew : après la fin d'une commande 3 ou 4 | `gsp` : à chaque fin d'image (`display_on_vblank`), et dans ImportDisplayCaptureInfo et SetBufferSwap ; les fonctions de fin de transfert n'y touchent pas. La fiche `gsp` avait raison |
| L'octet 3 du premier mot d'une commande | 3dbrew : la commande **échoue** si `gsp` est occupé | `gsp` : le fil de la file se rendort et réessaie ; `0xC8402BF0` ne sort jamais vers le jeu |
| L'octet 1 du premier mot d'une commande | 3dbrew : inutilisé | le jeu y met toujours 1 ; `gsp` ne le lit pas. Pas de contradiction, mais ce n'est pas zéro |
| Les zones de taille nulle de la commande 5 | 3dbrew : elles sont sautées | `gsp` : une taille nulle arrête la série, la troisième zone n'est pas regardée |
| Le mot 2 de WriteHWRegs | la Carte : la taille | `gsp` ne lit pas ce mot : il prend la taille dans le descripteur du mot 3. Le jeu met la même valeur aux deux endroits |
| La zone acceptée par FlushDataCache | la Carte : le tas linéaire | `gsp` accepte aussi la mémoire supplémentaire de la New 3DS (déjà noté dans la fiche `gsp`) |
| Le chemin du jeu vers l'écriture dans la file | la fiche `gsp`, partie 7 : le jeu écrit une commande 1 à la première case et met 1 dans le nombre | le jeu écrit à la case (rang + nombre) modulo 15, augmente le nombre, et fait précéder la commande 1 d'une commande 5 |
| Le résultat `0x2A07` | la fiche `gsp` : rendu la première fois, sens inconnu | le jeu s'en sert : il décide là de programmer lui-même les écrans |
| WriteHWRegs au démarrage | l'inventaire la range parmi les commandes de l'installation de l'affichage | exact, mais seulement sur le chemin `0x2A07` |

Les sept mots d'une description de tampon d'écran, les paramètres des six commandes de la file et les calculs d'adresses de zones de la fiche `gsp` sont **confirmés** par la lecture du jeu : les deux côtés rangent et relisent les mêmes mots aux mêmes places.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**

- Les mots de requête et de réponse des 14 commandes : l'assembleur des 14 fonctions d'envoi du jeu d'un côté, l'aiguillage de `gsp` de l'autre. Les places, les descripteurs et les en-têtes de réponse concordent partout.
- La disposition de la mémoire partagée : les quatre adresses que le jeu calcule à l'inscription sont celles que les trois fonctions d'initialisation de `gsp` découpent.
- La file : le jeu écrit à (rang + nombre) modulo 15 et augmente le nombre ; `gsp` lit au rang, l'avance modulo 15 et baisse le nombre. Même chose, à l'envers, pour la zone des interruptions avec le modulo `0x34`.
- Les paramètres des six commandes de la file : la place de chaque mot dans la fonction du jeu qui range la commande, la place où `gsp` le relit, et le registre où il finit. Les registres sont ceux que 3dbrew décrit à la même adresse, pour le même usage.
- Les sept octets d'interruption : l'ordre dans lequel le jeu pose ses sept fonctions de rappel, et l'octet que chaque fonction de `gsp` dépose.
- Les sept mots d'une description de tampon d'écran : l'écriture par le jeu, la lecture par `gsp`, et la structure donnée par 3dbrew.
- Les cinq codes de format et leur taille en octets : la table du jeu et celle de 3dbrew.
- Les 68 écritures de registres : 64 et 4 appels relevés par les références de Ghidra, 68 appels relevés par l'exécution dans l'émulateur.
- Les unités de la copie de texture (paquets de 16 octets) : la division par 16 dans le jeu, et 3dbrew.

**Interprété à la lecture, à relire dans Ghidra**

- L'ordre des étapes 10 à 17 de la séquence de démarrage : c'est l'ordre des appels dans `gx_initialize` et `graphics_system_init`, avec des tests que je n'ai pas tous suivis.
- La priorité `0x1A` du fil des interruptions du jeu.
- Les valeurs des 68 écritures de registres supposent l'état des registres à l'entrée du tronçon émulé (`r5` = 0, `r7` = 1, `r8` = 2), lu dans l'assembleur qui précède.
- Que le jeu reçoive 0 et non `0x2A07` sur une vraie console : cela découle de ce que `gsp` ne le rend qu'une fois, et de l'idée que le menu s'inscrit avant tout jeu. Rien dans le code lu ne prouve la seconde moitié.
- La valeur 1 des drapeaux de RegisterInterruptRelayQueue pour une application.
- Le sens des bits du mot de format (relief, sortie modifiée, rafales) : les places sont lues dans le code, les noms viennent de 3dbrew.
- Le sens des modes `0x700`, `0x701`, `0x702` et des codes de zone `0x10000`, `0x20000`, `0x30000`.
- Les noms donnés aux fonctions du jeu, et à l'ensemble « bibliothèque graphique du constructeur ».
- Les textes de 3dbrew : l'outil de lecture rend un résumé, pas la page. Les nombres cités ont été redemandés, mais une tournure peut avoir été déformée, notamment celle sur le moment où la description d'écran est prise.

**Pas lu**

- La fonction `0x128cd4`, entre l'initialisation et le premier remplissage : elle prépare les tampons d'image et peut ajouter des demandes.
- Où le jeu range ses tampons d'écran, et dans quelle plage de tas linéaire tombent ses allocations.
- Le calcul du décalage ajouté à l'adresse d'un tampon d'écran.
- Le registre `0x1EF00058` lu par ReadHWRegs, et l'usage de la valeur.
- La valeur que le `.cro` passe à SetAxiConfigQoSMode.
- La copie de la mémoire vidéo dans `gsp` (Save et RestoreVramSysArea).
- Ce que le jeu fait de l'état et du code d'erreur de la file (`+0x02`, `+0x04`), et des compteurs de fins d'image manquées. La fonction qui détache la file à l'arrêt (jeu `0x179d5c`) n'est pas lue.
- Les chemins de la mise en attente (bouton HOME, veille) : seules leurs commandes sont décrites, pas leur ordre.
- Le contenu des listes de commandes du processeur graphique : hors de ce document. Elles sont fabriquées par les fonctions qui écrivent derrière le pointeur `0x5db3c8`, et fermées par `gx_flush_command_list` (jeu `0x1434d4`).
- Tout ce qui se passe à l'exécution : quelles commandes partent vraiment, à quel rythme, avec quelles adresses.

**Où je me suis arrêté.** La séquence de démarrage et la file sont traitées en entier, sauf le trou de `0x128cd4`. Les 14 commandes ont leur rubrique. Les chemins de mise en attente et de sortie ne sont décrits que commande par commande.

## Comment ce document a été fait

| Étape | Avec quoi | Durée |
| --- | --- | --- |
| Lire les 14 fonctions d'envoi du jeu en assembleur | un petit désassembleur écrit pour l'occasion (`armdis.py`, sur `capstone`) | immédiat |
| Remonter aux appelants | les références de Ghidra (`local/analyse/maj/gh/refs.tsv`), par un script (`refs.py`) | immédiat |
| Lire le pseudo-code du jeu et de `gsp` | `local/analyse/maj/gh/pseudo/` et `local/analyse/gsp/pseudo/`, déjà produits | le gros du temps |
| Relire en assembleur ce que le pseudo-code brouille | `armdis.py`, sur le jeu et sur `gsp` | une trentaine de fonctions |
| Relever les 68 écritures de registres | l'exécution du tronçon `0x130638` à `0x130c40` dans `unicorn` (`emu_hwregs.py`) | quelques secondes |
| Lire les valeurs de départ des données du jeu | `peek.py` | immédiat |
| Recouper avec la Carte des services | `carte_details.py` | immédiat |
| Recouper avec 3dbrew | trois pages : `GSP_Shared_Memory`, `GPU/External_Registers`, `GSPGPU:TriggerCmdReqQueue` | trois lectures |

Aucun pont REA n'a été lancé et aucune analyse Ghidra n'a été relancée : tout repose sur les sorties existantes et sur les deux fichiers `code.bin`. Les scripts et leurs sorties sont dans `local/analyse/contrat-gsp/`, non versionné.

**Les pièges rencontrés.**

- **Une grande fonction coupée en trois.** Ghidra donne 72 octets à `0x13037c`, ne range le milieu dans aucune fonction, et fait commencer une « fonction » à `0x130800`, au milieu d'une suite d'appels. Les 20 premiers appels à WriteHWRegs apparaissent « sans fonction » dans les références. Il faut lire le tout en assembleur.
- **Le pseudo-code perd l'ordre des mots sur la pile.** Les fonctions qui rangent une commande dans la file construisent les 8 mots sur la pile, et Ghidra les présente comme des variables séparées, dans un ordre qui n'est pas celui de la mémoire. La place de chaque mot n'est sûre qu'en assembleur.
- **Des mots qui semblent ne pas être écrits.** Ces mêmes fonctions ne remplissent pas toute la case : le reste est recopié d'un modèle rangé dans les données. Sans aller lire ce modèle, on croit que le jeu laisse traîner des valeurs de pile.
- **Sept fonctions de rappel, trois adresses.** Quatre d'entre elles sont de simples sauts vers la même fonction, et Ghidra affiche le même pseudo-code quatre fois sous le même nom.
- **Un script nommé `dis.py` casse `capstone`** : le nom masque un module de Python que `capstone` charge. Renommé en `armdis.py`.
- **3dbrew par l'outil de lecture** : il ne rend jamais la page telle quelle, même en demandant le texte brut. Il faut poser des questions fermées, registre par registre.

**Pour reprendre.** La suite utile est de regarder le jeu tourner : quelle valeur rend réellement RegisterInterruptRelayQueue, dans quelle zone sont les tampons d'écran, et dans quel ordre arrivent les premières commandes de la file. Côté lecture, il reste `0x128cd4` et les chemins de mise en attente.
