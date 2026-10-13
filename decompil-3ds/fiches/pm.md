# pm, le lanceur de programmes

`pm` lance et arrête les programmes. Quand le menu veut démarrer Pokémon X, c'est à `pm` qu'il le demande : `pm` fait charger le titre par `loader`, déclare le nouveau processus à `sm` et à `fs`, règle ses limites, puis dit au noyau de le démarrer. Ensuite il surveille tous les processus qu'il connaît et fait le ménage quand l'un d'eux se termine.

Fiche du 13 octobre 2026, produite avec REA et Ghidra sur le module dumpé de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001202`, rangé dans le NATIVE_FIRM (lu dans l'exheader) |
| Fichier lu | `local/extrait/pm/exefs/code.elf` |
| Taille | 25 108 octets de code, 924 de données en lecture seule, 472 de données, 14 340 de mémoire à zéro |
| Fonctions | 175, dont 127 nommées dans `pm.noms.tsv` |
| Services offerts | `pm:app` (13 commandes, 3 sessions au plus) et `pm:dbg` (3 commandes, 1 session au plus) |
| Services appelés | `Loader`, `fs:REG`, `srv:pm`, et le port `srv:` |
| Dépendances déclarées | aucune |
| Fils | trois : le fil principal, un fil qui surveille la fin des processus, un fil de travail |
| Sur cette console | Luma remplace `pm` par le sien au démarrage : ce qui est lu ici est l'original de Nintendo |

## Partie 1 : le démarrage et les fils

`entry` (`0x100000`) appelle six fonctions à la suite, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de `0x1081d8` à `0x10b9dc`.
2. Une petite fonction de la bibliothèque C (`0x100494`), sans nom ici.
3. `init_runtime` (`0x100a48`) crée l'arbitre d'adresses dont se servent tous les verrous, et prépare deux réserves d'adresses.
4. La fonction à `0x100048`, écrite en Thumb, appelle les 11 fonctions d'initialisation des objets globaux, par la table de `0x107370` à `0x10739c`.
5. Une fonction vide (`0x100460`).
6. `pm_main` (`0x100084`, 932 octets) : tout le reste.

`pm_main` commence par cinq préparatifs, puis entre dans la boucle de la partie 2 :

1. `srvpm_init` (`0x100b5c`) se connecte au port `srv:`, s'y déclare (`SRV_RegisterClient`) et ouvre le service `srv:pm`.
2. `SRV_RegisterService` (`0x100c5c`) crée `pm:app` puis `pm:dbg`. Les deux noms et leur nombre de sessions sont dans la table à `0x107028`.
3. `pm_initialize` (`0x100524`) met en place tout l'état du module : voir ci-dessous.
4. Un gestionnaire est inscrit pour la notification `0x100`, et `SRV_EnableNotification` rend le sémaphore qui prévient de son arrivée.
5. `launch_boot_title` (`0x1009d0`) lit un numéro de titre dans la mémoire de configuration du noyau (`0x1FF80008`) et, s'il n'est pas nul, lance ce titre avec ses dépendances. C'est le premier programme que `pm` démarre.

**Ce que fait `pm_initialize`, dans l'ordre :**

1. Deux signaux sont créés : un pour prévenir que la liste des processus a changé (`0x108008`), un pour prévenir que les arrêts demandés sont finis (dans l'état, à `+0x30`).
2. Deux quantités de mémoire sont lues dans la mémoire de configuration du noyau, à `0x1FF80040` et `0x1FF80044`, et servent à remplir la colonne « mémoire » de la table des limites (partie 8). La première est celle des applications.
3. Deux réserves sont préparées : 64 fiches de processus de 0x24 octets (`process_pool_init`, `0x101330`) et 6 tampons de 0x400 octets pour lire les exheaders (`block_pool_init`, `0x101ba8`).
4. Quatre jeux de limites sont créés dans le noyau (`svcCreateResourceLimit`) et remplis de 10 valeurs chacun (`svcSetResourceLimitLimitValues`). Chaque processus lancé sera rattaché à l'un des quatre.
5. Les sessions vers `Loader` et `fs:REG` sont ouvertes.
6. **Les processus déjà là.** `svcGetSystemInfo` (type `0x1A`) rend un nombre ; pour chaque numéro de processus de 0 à ce nombre moins un, `svcOpenProcess` ouvre une poignée, une fiche est créée avec le drapeau « lancé par le noyau » et le numéro de titre fixe `0004000100001000`, et le processus est rattaché au quatrième jeu de limites. Ce sont les modules qui tournaient avant `pm`.
7. `svcKernelSetState` de type 3 reçoit l'adresse `0x12000000` : c'est la page où `pm` lit et écrit ensuite les paramètres de redémarrage (commandes 2, 7 et 9).
8. Les deux fils sont créés.

Tous les fils passent par `create_thread` (`0x100fcc`), la seule fonction qui appelle `svcCreateThread`, et commencent dans `thread_trampoline` (`0x1038f0`), qui appelle la vraie fonction du fil puis `ExitThread`.

| Fil | Fonction | Adresse | Pile | Ce qu'il fait |
| --- | --- | --- | --- | --- |
| Principal | `pm_main` | `0x100084` | celle du processus, 0x1000 octets | Reçoit les commandes de `pm:app` et `pm:dbg` |
| Surveillance | `exit_monitor_thread_main` | `0x101478` | se termine à `0x10ab58` | Attend la fin de n'importe quel processus connu (partie 6) |
| Travail | `worker_thread_main` | `0x101368` | se termine à `0x10b358` | Exécute les travaux longs que le fil principal lui confie |

**Le fil de travail.** Lancer une application ou attendre qu'un programme s'arrête peut prendre du temps, et pendant ce temps `pm` ne répondrait plus à personne. Les commandes longues déposent donc un « travail » dans une case unique (`0x10b388`) : la fonction à appeler et ses arguments. Le fil de travail attend le signal « un travail est posé » (`0x10b3a4`), appelle la fonction, puis lève le signal « je suis libre » (`0x10b39c`). La commande, elle, répond tout de suite au client avec le résultat 0, sans attendre la fin du travail.

| Travail | Adresse | Posé par |
| --- | --- | --- |
| `job_launch_application` | `0x10515c` | LaunchTitle et LaunchTitleUpdate, pour une application |
| `job_launch_firm` | `0x103ec4` | LaunchFIRM |
| `job_terminate_title` | `0x104a8c` | TerminateTitle |
| `job_terminate_process` | `0x104900` | TerminateProcess |
| `job_prepare_for_reboot` | `0x10501c` | PrepareForReboot |

Ces cinq adresses sont rangées, avec trois petites fonctions de lecture d'une fiche, dans la table de `0x107064` à `0x1070a0`.

## Partie 2 : la boucle de service

Comme dans `sm`, une seule boucle sert tous les clients, dans `pm_main`.

1. **La liste des poignées.** Elle est à `0x10b9c0`, son compteur à `0x1081a0`. Les trois premières sont fixes : le sémaphore des notifications, le port `pm:app`, le port `pm:dbg`. Les quatre suivantes sont les sessions ouvertes.
2. **L'attente.** `svcReplyAndReceive` répond au message précédent et attend le suivant sur toute la liste. Quand il n'y a rien à répondre, le code écrit `0xFFFF0000` à la place de l'en-tête.
3. **Le tri de ce qui arrive**, d'après le rang de la poignée qui a sonné :
   - rang 0, le sémaphore : `handle_srv_notification` (`0x100aa0`) lit le numéro par `SRV_ReceiveNotification` et appelle le gestionnaire inscrit ;
   - rang 1 ou 2, un port : `svcAcceptSession` ouvre la session. S'il y en a déjà quatre, elle est refermée aussitôt. Sinon son type (0 pour `pm:app`, 1 pour `pm:dbg`) est noté dans la table à `0x10b8dc` ;
   - rang 3 ou plus, une session : le gestionnaire de son type est appelé, par la table de deux pointeurs à `0x107010`.
4. **Une session se ferme** (résultat `0xC920181A`) : sa poignée est fermée et la dernière session de la liste prend sa place.
5. **La sortie.** La notification `0x100` met l'octet `0x1081ac` à 1 (`on_terminate_notification`, `0x1061b8`). La boucle s'arrête quand cet octet vaut 1 et qu'aucune session n'est ouverte. Le module retire alors ses deux services et ferme ses poignées.

| Type de session | Service | Gestionnaire | Adresse |
| --- | --- | --- | --- |
| 0 | `pm:app` | `pmapp_handle_command` | `0x105884` |
| 1 | `pm:dbg` | `pmdbg_handle_command` | `0x105770` |

Les deux gestionnaires reçoivent le même argument : l'adresse de l'état du module, `0x1081d8` (table à `0x107018`).

## Partie 3 : les commandes de `pm:app`

`pmapp_handle_command` (`0x105884`, 772 octets) lit l'en-tête dans le tampon du fil (à `+0x80` du stockage local), prend le numéro de commande dans les 16 bits du haut, et saute par une table de 14 adresses rangée à `0x1058a4`. Les noms et les en-têtes de requête viennent de 3dbrew ; la fonction, l'adresse et l'en-tête de réponse sont lus dans le code.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse | Où le travail est fait |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010140` | LaunchTitle | `pmapp_LaunchTitle` | `0x103f50` | `0x00010080` | fil de travail pour une application, sur place sinon ou si la mise en attente est demandée |
| 2 | `0x00020082` | LaunchFIRM | `pmapp_LaunchFIRM` | `0x10526c` | `0x00020042` | fil de travail |
| 3 | `0x00030080` | TerminateApplication | `pmapp_TerminateApplication` | `0x10486c` | `0x00030040` | sur place |
| 4 | `0x00040100` | TerminateTitle | `pmapp_TerminateTitle` | `0x104d6c` | `0x00040040` | fil de travail |
| 5 | `0x000500C0` | TerminateProcess | `pmapp_TerminateProcess` | `0x104c40` | `0x00050040` | fil de travail |
| 6 | `0x00060082` | PrepareForReboot | `pmapp_PrepareForReboot` | `0x105054` | `0x00060040` | fil de travail |
| 7 | `0x00070042` | GetFIRMLaunchParams | `pmapp_GetFIRMLaunchParams` | `0x103f1c` | `0x00070042` | sur place |
| 8 | `0x00080100` | GetTitleExheaderFlags | `pmapp_GetTitleExheaderFlags` | `0x104394` | `0x00080140` | sur place |
| 9 | `0x00090042` | SetFIRMLaunchParams | `pmapp_SetFIRMLaunchParams` | `0x104190` | `0x00090042` | sur place |
| 10 | `0x000A0140` | SetAppResourceLimit | `pmapp_SetAppResourceLimit` | `0x1053d0` | `0x000A0040` | sur place |
| 11 | `0x000B0140` | GetAppResourceLimit | `pmapp_GetAppResourceLimit` | `0x1052e4` | `0x000B00C0` | sur place |
| 12 | `0x000C0080` | UnregisterProcess | `pmapp_UnregisterProcess` | `0x1041d8` | `0x000C0040` | sur place |
| 13 | `0x000D0240` | LaunchTitleUpdate | `pmapp_LaunchTitleUpdate` | `0x10517c` | `0x000D0040` | fil de travail, ou sur place si la mise en attente est demandée |

- Seules les commandes 2, 6, 7 et 9 vérifient l'en-tête entier, parce qu'elles reçoivent un tampon ou un numéro de processus écrit par le noyau. Les autres ne regardent que le numéro.
- Un numéro inconnu rend `0xD900182F`, un en-tête mal formé `0xD9001830`.
- Le nombre de mots lus par le code colle aux en-têtes de 3dbrew pour les neuf autres : 5 mots pour la commande 1, 2 pour la 3, 4 pour la 4, 3 pour la 5, 4 pour la 8, 5 pour la 10 et la 11, 2 pour la 12, 9 pour la 13.

Ce que fait chaque commande, lu dans le code :

| N° | Ce que fait le code |
| --- | --- |
| 1 | Voir la partie 5. Rend le numéro du processus, sauf pour une application |
| 2 | Copie au plus 0x1000 octets à `0x12000000`, puis confie au fil de travail : arrêter tout (partie 6), et `svcKernelSetState` de type 0 avec le numéro du FIRM à lancer |
| 3 | Demande à l'application en cours de s'arrêter et attend, au plus le délai reçu |
| 4 | Pareil pour tous les processus qui portent le numéro de titre reçu |
| 5 | Pareil pour le processus dont le numéro est reçu |
| 6 | Lève le drapeau d'arrêt de la console (`+0x35` de l'état), puis arrête tout sauf l'appelant et ses dépendances, et lui envoie la notification `0x179` |
| 7 | Copie au plus 0x1000 octets de `0x12000000` vers le tampon du client |
| 8 | Fait lire l'exheader du titre par `loader` et en rend deux morceaux de 8 octets |
| 9 | Copie le tampon du client à `0x12000000` et met le reste de la page à zéro |
| 10 | Change le temps de processeur permis à l'application, s'il ne dépasse pas le maximum noté au lancement (`+0x36` de l'état) |
| 11 | Rend ce temps, lu par `svcGetResourceLimitLimitValues` |
| 12 | Retire de la liste la fiche du titre reçu, ferme sa poignée, rend la fiche à la réserve |
| 13 | Comme la 1, avec un second titre (la mise à jour) et le drapeau `0x10000` ajouté. Refuse (`0xD8E05802`) si ce n'est pas une application |

Après PrepareForReboot, les commandes 4 et 5 n'acceptent plus qu'un délai nul, et détruisent alors le processus sur place (`svcTerminateProcess`) sans passer par le fil de travail.

Trois refus reviennent dans plusieurs commandes : `0xC8A05801` quand PrepareForReboot est déjà passé, `0xC8A05BF0` quand une application tourne déjà, `0xD8E05BF4` quand les paramètres des commandes 10 et 11 ne sont pas exactement ceux attendus (type 9, le reste à zéro).

## Partie 4 : les commandes de `pm:dbg`

`pmdbg_handle_command` (`0x105770`, 256 octets) compare le numéro à 1, 2 et 3. Ce service sert au débogueur.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| 1 | `0x00010140` | LaunchAppDebug | `pmdbg_LaunchAppDebug` | `0x1042d8` | `0x00010042` |
| 2 | `0x00020140` | LaunchApp | `pmdbg_LaunchApp` | `0x104bcc` | `0x00020040` |
| 3 | `0x00030000` | RunQueuedProcess | `pmdbg_RunQueuedProcess` | `0x104e6c` | `0x00030042` |

- La 1 lance une application et s'y attache comme débogueur (`svcDebugActiveProcess`) avant qu'elle démarre. Si une application attend déjà (voir le drapeau `0x8` de la partie 5), elle fait la même chose que la 3.
- La 2 passe par `pmapp_LaunchTitle` en ajoutant les drapeaux `0x1` et `0x2`.
- La 3 prend l'application mise en attente, s'y attache, puis la démarre. S'il n'y en a pas : `0xD8A05804`.
- Les réponses des commandes 1 et 3 contiennent le mot `0x10` suivi de la poignée de débogage : le noyau la déplace chez le client.

## Partie 5 : LaunchTitle, pas à pas

La commande reçoit 16 octets qui désignent le titre (son numéro sur 8 octets, puis un octet qui dit sur quel support il est rangé) et un mot de drapeaux.

**Les drapeaux**, d'après ce que le code en fait :

| Bit | Ce que le code fait quand il est mis |
| --- | --- |
| `0x1` | Le titre est une application. Il ne peut y en avoir qu'une à la fois, et le lancement est confié au fil de travail |
| `0x2` | Les titres dont il dépend sont lancés aussi |
| `0x4` | Une notification `0x110 + n` sera publiée quand le processus se terminera |
| `0x8` | Le processus est créé mais pas démarré : sa poignée est gardée pour `pm:dbg` |
| `0xF0` | Le nombre `n` de la notification ci-dessus |
| `0x100`, `0x200` | Sur New 3DS, forcent la quantité de mémoire d'une ancienne console |
| `0x10000` | Le second titre reçu (la mise à jour) est transmis à `loader` |

**Dans `pmapp_LaunchTitle` (`0x103f50`) :**

1. Si PrepareForReboot est déjà passé : `0xC8A05801`.
2. **Pour une application** (bit `0x1`) : si une autre tourne déjà (`+0x00` de l'état non nul), `0xC8A05BF0`. Sinon le titre et les drapeaux sont déposés dans la case du fil de travail avec `job_launch_application`, et la commande répond 0 tout de suite. Le numéro de processus de la réponse n'est pas rempli.
3. **Pour tout autre titre** (un module système, par exemple) : la liste des processus est parcourue. Si le titre tourne déjà, son numéro de processus est rendu et rien n'est lancé. Sinon `launch_program` (`0x103364`) fait sur place les mêmes étapes que ci-dessous, sauf la 4 et la 11.

**Dans le fil de travail, `launch_application` (`0x1027e8`, 816 octets) :**

1. **Un tampon.** `block_pool_acquire` (`0x1034a4`) prend un des six tampons de 0x400 octets, et attend s'il n'y en a plus.
2. **Déclarer le titre à `loader`.** `register_program` (`0x103204`) envoie `LOADER_RegisterProgram` et reçoit un numéro de programme sur 8 octets. Elle essaie d'abord la variante New 3DS du titre (les 4 bits du haut de la moitié basse mis à 2), et si `loader` refuse, la variante normale (ces 4 bits à 0).
3. **Lire son exheader.** `LOADER_GetProgramInfo` (`0x1031ac`) fait remplir le tampon par `loader`. En cas d'échec, le titre est retiré (`LOADER_UnregisterProgram`).
4. **Vérifications.** La version du système notée dans l'exheader (`+0x208`) doit être celle du noyau (`0x1FF80010`), sinon `0xC8A05800`. Sur New 3DS, la mémoire permise aux applications est ajustée d'après l'exheader et les drapeaux `0x100` et `0x200`.
5. **Trier ses droits.** `filter_service_access_list` (`0x101cf0`) retire `http:C` et `soc:U` de la liste des services permis, pour trois titres précis (partie 8).
6. **Créer le processus.** `launch_with_dependencies` (`0x101694`) appelle `create_process` (`0x1020a0`, 912 octets) :
   - `LOADER_LoadProcess` (`0x103c7c`) : `pm` envoie le numéro de programme et reçoit la poignée d'un processus tout neuf. Ce que `loader` fait pour le créer est dans sa fiche ;
   - `svcGetProcessId` donne son numéro ;
   - `process_entry_alloc` (`0x103694`) prend une fiche et la remplit : poignée, numéro, titre, numéro de programme, drapeaux ;
   - `register_process_with_services` (`0x103954`) fait les cinq déclarations de l'étape 7 ;
   - pour une application, le temps de processeur permis est réglé d'après l'exheader (`+0x210`) ;
   - la fiche est ajoutée à la liste, sous verrou ;
   - `svcSignalEvent` sur `0x108008` réveille le fil de surveillance, qui ajoute la nouvelle poignée à celles qu'il attend.
7. **Les cinq déclarations**, dans `register_process_with_services` :

   | Ordre | À qui | Requête ou appel | Ce qui est transmis |
   | --- | --- | --- | --- |
   | 1 | `fs` | `FSREG_Register` (`0x103cc0`) | numéro du processus, numéro de programme, titre et support, et les 0x20 octets de l'exheader qui décrivent ses droits sur les fichiers (`+0x230`) |
   | 2 | `sm` | `SRVPM_RegisterProcess` (`0x103d5c`) | numéro du processus et la liste des services qu'il a le droit d'ouvrir (`+0x250`, 34 noms de 8 octets au plus) |
   | 3 | noyau | `svcSetProcessResourceLimits` | un des quatre jeux de limites, choisi par l'octet `+0x36F` de l'exheader |
   | 4 | noyau | `svcSetProcessAffinityMask` | les processeurs permis (bits 2 et 3 de l'octet `+0x20E`) |
   | 5 | noyau | `svcSetProcessIdealProcessor` | le processeur préféré (bits 0 et 1 du même octet) |

   Si une étape échoue, les précédentes sont défaites : `SRVPM_UnregisterProcess`, puis `FSREG_Unregister`.
8. **Le débogueur.** Si une poignée de débogage est demandée (`pm:dbg`), `svcDebugActiveProcess` s'attache au processus.
9. **Les dépendances** (bit `0x2`). L'exheader en liste jusqu'à 48 (`+0x40`). Pour chacune : si elle tourne déjà, son compteur d'usage monte ; sinon elle est lancée par `launch_program`, et ses propres dépendances rejoignent la liste à traiter.
10. **Démarrer.** `svcRun` reçoit la poignée du processus, la priorité de son fil principal (`+0x20F` de l'exheader) et la taille de sa pile (`+0x1C`). Si le noyau refuse, le processus est détruit (`svcTerminateProcess`).
11. **Noter et prévenir.** La fiche devient « l'application en cours » (`+0x00` de l'état), et `SRV_PublishToSubscriber` publie la notification `0x10C`.
12. **Le tampon est rendu** (`block_pool_release`, `0x103318`).

Avec le bit `0x8`, les étapes 10 et 11 sont remplacées par une seule : la poignée du processus est rangée à `+0x38` de l'état, et le processus attend `RunQueuedProcess`. S'il y en a déjà une, `0xD8A05805`.

Le résultat de `launch_application` n'est rendu à personne quand elle tourne dans le fil de travail : le client qui a envoyé LaunchTitle a déjà reçu 0.

## Partie 6 : quand un processus se termine

**Le fil de surveillance**, `exit_monitor_thread_main` (`0x101478`), tourne en boucle :

1. Il dresse une liste de poignées : d'abord le signal « la liste a changé » (`0x108008`), puis la poignée de chaque processus dont la fiche n'est pas à l'état « terminé ». Il y a de la place pour 65 poignées, soit le signal et les 64 fiches.
2. Si un arrêt est en cours (`+0x34` de l'état) et que plus aucune fiche n'est à l'état « arrêt demandé », il lève le signal « les arrêts sont finis » (`+0x30`).
3. `svcWaitSynchronizationN` attend qu'une des poignées sonne. Une poignée de processus sonne quand le processus se termine.
4. Si c'est le signal de rang 0, il recommence au début, pour reconstruire sa liste.
5. Sinon il retrouve la fiche qui porte cette poignée. Si la fin de ce processus doit être notifiée (drapeau `0x01`), il lui ajoute le drapeau `0x10`. Une fiche qui porte `0x10` reste dans la liste ; les autres en sont retirées.
6. Il appelle `on_process_exit` (`0x101ecc`).
7. Si la fiche a été retirée, la poignée est fermée et la fiche rendue à la réserve (`process_entry_free`, `0x102e14`).

**Dans `on_process_exit` :**

1. **Les dépendances.** Si la fiche en avait (drapeau `0x04`), l'exheader est relu par `LOADER_GetProgramInfo` et `release_dependencies` (`0x103a60`) baisse le compteur de chaque dépendance. Celles qui tombent à zéro reçoivent la notification `0x100`, qui leur demande de s'arrêter.
2. **Défaire les déclarations**, sauf pour un processus lancé par le noyau : `SRVPM_UnregisterProcess` à `sm`, `FSREG_Unregister` à `fs`, `LOADER_UnregisterProgram` à `loader`.
3. **L'application en cours.** Si c'était elle, `+0x00` de l'état repasse à zéro, et sur New 3DS la mémoire permise aux applications revient à sa valeur de départ.
4. **L'état** de la fiche passe à 3, « terminé ».
5. **Prévenir.** Si le drapeau `0x01` est encore mis, `SRV_PublishToSubscriber` publie `0x110 + n`.

La fiche d'un processus à notifier reste donc dans la liste, à l'état « terminé », jusqu'à ce qu'un client envoie UnregisterProcess (commande 12 de `pm:app`).

**Les arrêts demandés.** Les commandes 3, 4 et 5 suivent le même chemin :

1. `request_termination` (`0x1026cc`) envoie la notification `0x100` au processus, par `SRVPM_PublishToProcess`. La fiche passe à l'état 1 si l'envoi a réussi, 2 sinon.
2. `wait_for_terminations` (`0x102588`) détruit tout de suite les processus à l'état 2 (`svcTerminateProcess`), puis attend le signal « les arrêts sont finis », au plus le délai reçu.
3. Si le délai est dépassé, les processus encore à l'état 1 sont détruits de force, et l'attente reprend, sans limite cette fois.

Un processus a donc une chance de s'arrêter proprement avant d'être tué.

Quand l'arrêt est demandé par les commandes 4 ou 5 à un processus à notifier, le travail lui retire le drapeau `0x01` et lui met `0x10` : ce n'est alors plus le fil de surveillance qui publie `0x110 + n`, mais le travail lui-même, une fois l'attente finie.

**Tout arrêter.** `terminate_all_except` (`0x104440`) sert à PrepareForReboot et à LaunchFIRM. Elle demande l'arrêt de l'application en cours et de tous les processus qui ne sont ni lancés par le noyau, ni le processus à épargner, ni une de ses dépendances. Après l'attente, elle demande aussi l'arrêt du processus numéro 4, qui fait pourtant partie des processus lancés par le noyau, et attend encore.

| Notification | Sens | Qui l'envoie | À qui |
| --- | --- | --- | --- |
| `0x100` | « arrête-toi » | `pm`, par `SRVPM_PublishToProcess` | un processus précis |
| `0x100` | la même, reçue par `pm` | | `pm` quitte sa boucle |
| `0x10C` | une application vient de démarrer | `pm`, par `SRV_PublishToSubscriber` | les abonnés |
| `0x110` à `0x11F` | un processus lancé avec le bit `0x4` s'est terminé | `pm`, par `SRV_PublishToSubscriber` | les abonnés |
| `0x179` | tout est arrêté | `pm`, par `SRVPM_PublishToProcess` | l'appelant de PrepareForReboot |

## Partie 7 : les services que pm appelle

Chaque requête a sa petite fonction, qui écrit un en-tête et appelle `SendSyncRequest`. Il y en a 16, autant que d'appels à `SendSyncRequest` dans le code. Les noms viennent de 3dbrew.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` (port) | `0x108180` | `0x00010002` | `SRV_RegisterClient` | `0x101c58` | Se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x1012b8` | Obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x100c5c` | Créer `pm:app` et `pm:dbg` |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x100cb8` | Les retirer à l'arrêt |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x103720` | Ouvrir les trois services ci-dessous |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x1012f4` | Lire le numéro de la notification arrivée |
| | | `0x000C0080` | `SRV_PublishToSubscriber` | `0x102c40` | Publier `0x10C` et `0x110 + n` |
| `srv:pm` | `0x10818c` | `0x00010042` | `SRVPM_PublishToProcess` | `0x103dac` | Envoyer `0x100` ou `0x179` à un processus |
| | | `0x00030082` | `SRVPM_RegisterProcess` | `0x103d5c` | Donner à `sm` la liste des services permis au nouveau processus |
| | | `0x00040040` | `SRVPM_UnregisterProcess` | `0x103d14` | La retirer à sa fin |
| `Loader` | `0x10815c` | `0x00010080` | `LOADER_LoadProcess` | `0x103c7c` | Faire créer le processus |
| | | `0x00020200` | `LOADER_RegisterProgram` | `0x102c7c` | Déclarer un titre, recevoir un numéro de programme |
| | | `0x00030080` | `LOADER_UnregisterProgram` | `0x103174` | Le retirer |
| | | `0x00040080` | `LOADER_GetProgramInfo` | `0x1031ac` | Recevoir 0x400 octets d'exheader |
| `fs:REG` | `0x1081dc` | `0x040103C0` | `FSREG_Register` | `0x103cc0` | Déclarer le processus à `fs` |
| | | `0x04020040` | `FSREG_Unregister` | `0x103b68` | Le retirer |

- Les trois en-têtes envoyés à `srv:pm` sont ceux que donne la fiche de `sm` (partie 3). `pm` n'envoie jamais la quatrième commande de ce service, PublishToAll (`0x00020040`).
- `LOADER_GetProgramInfo` range, avant d'appeler, le mot `0x01000002` et l'adresse du tampon à `+0x180` du stockage local : c'est la façon de dire au noyau « écris la réponse de 0x400 octets ici ».
- `publish_to_process` (`0x102c10`) entoure `SRVPM_PublishToProcess` : si `sm` répond `0xD8606408`, le module s'arrête par `svcBreak`. Le code fait la même chose après chaque `SRV_PublishToSubscriber`.

## Partie 8 : les tables en mémoire

**L'état du module**, à `0x1081d8`, long de 0x3180 octets :

| Décalage | Adresse | Contenu |
| --- | --- | --- |
| `+0x00` | `0x1081d8` | la fiche de l'application en cours, ou zéro |
| `+0x04` | `0x1081dc` | la session `fs:REG` |
| `+0x08` | `0x1081e0` | **la liste des processus** : un pointeur vers une fiche, les fiches se suivent en anneau |
| `+0x0C` | `0x1081e4` | le verrou qui protège la liste |
| `+0x18` | `0x1081f0` | le fil de surveillance |
| `+0x20` | `0x1081f8` | les quatre jeux de limites du noyau |
| `+0x30` | `0x108208` | le signal « les arrêts sont finis » |
| `+0x34` | `0x10820c` | 1 pendant qu'un arrêt est en cours |
| `+0x35` | `0x10820d` | 1 après PrepareForReboot |
| `+0x36` | `0x10820e` | le temps de processeur maximal de l'application |
| `+0x37` | `0x10820f` | une correction ajoutée à ce temps pour trois titres |
| `+0x38` | `0x108210` | la poignée de l'application mise en attente pour le débogueur |
| `+0x3C` | `0x108214` | la réserve des tampons d'exheader |
| `+0x80` | `0x108258` | les 6 tampons de 0x400 octets |
| `+0x1880` | `0x109a58` | les 64 fiches de 0x24 octets |
| `+0x2180` | `0x10a358` | les piles des deux fils, 0x800 octets chacune |

**Une fiche de processus**, 0x24 octets :

| Décalage | Contenu |
| --- | --- |
| `+0x00`, `+0x04` | les deux liens de l'anneau |
| `+0x08` | la poignée du processus |
| `+0x0C` | son numéro |
| `+0x10` | son numéro de titre, 8 octets, pris dans l'exheader (`+0x200`) |
| `+0x18` | son numéro de programme chez `loader`, 8 octets |
| `+0x20` | les drapeaux, 2 octets (tableau suivant) |
| `+0x22` | l'état : 0 en marche, 1 arrêt demandé, 2 arrêt demandé mais la notification n'est pas partie, 3 terminé |
| `+0x23` | le compteur d'usage, pour une dépendance |

| Drapeau de la fiche | Sens |
| --- | --- |
| `0x0001` | la fin du processus doit être notifiée (bit `0x4` du lancement) |
| `0x0002` | processus lancé par le noyau, trouvé au démarrage |
| `0x0004` | a des dépendances à relâcher à sa fin |
| `0x0008` | lancé comme dépendance d'un autre |
| `0x0010` | la fiche reste dans la liste après la fin du processus |
| `0xF000` | le nombre `n` de la notification `0x110 + n` |

**Les autres adresses :**

| Adresse | Contenu |
| --- | --- |
| `0x108008` | le signal « la liste des processus a changé » |
| `0x10800c` et `0x108010` | la mémoire permise aux applications : valeur de départ et valeur en cours |
| `0x108018` | la table des limites, 4 jeux de 10 valeurs de 8 octets |
| `0x10815c`, `0x108180`, `0x10818c` | les sessions `Loader`, `srv:` et `srv:pm` |
| `0x108174` | l'arbitre d'adresses des verrous |
| `0x1081a0` | le nombre de poignées de la boucle |
| `0x1081ac` | le drapeau d'arrêt de `pm_main` |
| `0x1081bc` | le sémaphore des notifications |
| `0x10b358` | la réserve des fiches (la première fiche libre est à `0x10b37c`) |
| `0x10b388` | la case du fil de travail : état à `+0x08`, fonction à `+0x0C`, signaux à `+0x14` et `+0x1C`, arguments à `+0x24` |
| `0x10b3f0` | la liste des gestionnaires de notifications |
| `0x10b8dc` | par session : son type et son argument |
| `0x10b9c0` | les 7 poignées de la boucle |

**Les quatre jeux de limites.** L'ordre des colonnes est celui de la liste de numéros lue à `0x1070ac` : 1, 0, 2, 3, 4, 5, 6, 7, 8, 9. Le numéro 9 est le temps de processeur d'après 3dbrew ; les neuf autres noms de colonnes sont donnés de mémoire et restent à vérifier sur la page KResourceLimit. La mémoire est calculée au démarrage, les neuf autres valeurs sont dans le fichier.

| Jeu | Mémoire | Priorité | Fils | Signaux | Mutex | Sémaphores | Minuteries | Mémoires partagées | Arbitres | Temps de processeur |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | celle des applications | `0x18` | 32 | 32 | 32 | 8 | 8 | 16 | 2 | 0 |
| 1 | calculée | 4 | 29 | 11 | 8 | 4 | 4 | 8 | 3 | 10 000 |
| 2 | calculée | 4 | 14 | 8 | 8 | 4 | 4 | 8 | 1 | 10 000 |
| 3 | calculée | 4 | 225 | 264 | 37 | 67 | 44 | 31 | 45 | 1 000 |

Le jeu 0 est celui dont le code change la mémoire et le temps de processeur à chaque lancement d'application ; le jeu 3 est celui des processus trouvés au démarrage.

**Trois listes de titres écrites en dur.** Le code en tire un nombre de 20 bits, les bits 8 à 27 du numéro de titre.

- `filter_service_access_list` : les titres `0x343`, `0x465` et `0x4B3` perdent `http:C` et `soc:U` (les deux noms sont à `0x107158`).
- `create_process` : quand l'exheader d'une application ne donne pas de temps de processeur, 16 titres en reçoivent un par la table à `0x1070d4`. `0x334`, `0x335` et `0x336` reçoivent 30 ; `0x205`, `0x215`, `0x225`, `0x304`, `0x32E`, `0x348`, `0x349`, `0x368`, `0x370`, `0x389`, `0x490`, `0x491` et `0x562` reçoivent 10 000. Les autres reçoivent 0.
- Trois titres, `0x1201`, `0x1523` et `0x1524`, mettent 10 à `+0x37` de l'état.

## Partie 9 : les appels système utilisés

34 appels différents, à 98 endroits du code. Dans toute la fiche, un nom en `svc…` désigne l'appel système lui-même : seuls ceux qui ont une adresse dans ce tableau sont des fonctions du fichier de noms.

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x101448` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x100078` |
| SetProcessAffinityMask | `0x05` | dans `register_process_with_services` | `0x103954` |
| SetProcessIdealProcessor | `0x07` | dans `register_process_with_services` | `0x103954` |
| CreateThread | `0x08` | `svcCreateThread` | `0x101424` |
| ExitThread | `0x09` | dans `thread_trampoline` | `0x1038f0` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x101e9c` |
| Run | `0x12` | `svcRun` | `0x103150` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x100e38` |
| SignalEvent | `0x18` | écrit sur place, à 2 endroits | |
| ClearEvent | `0x19` | écrit sur place, à 5 endroits | |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x10140c` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x102ce8` |
| CloseHandle | `0x23` | écrit sur place, à 16 endroits | |
| WaitSynchronization1 | `0x24` | écrit sur place, à 4 endroits | |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x101ea8` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x103df8` |
| GetSystemTick | `0x28` | écrit sur place, à 3 endroits | |
| GetSystemInfo | `0x2A` | `svcGetSystemInfo` | `0x100e68` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x101e80` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x1013f4` |
| SendSyncRequest | `0x32` | écrit sur place, à 16 endroits | |
| OpenProcess | `0x33` | `svcOpenProcess` | `0x100e84` |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x10393c` |
| GetResourceLimitLimitValues | `0x39` | dans `pmapp_GetAppResourceLimit` | `0x1052e4` |
| Break | `0x3C` | une seule fois, dans `break_process` | `0x103874` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x1004e8` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x100500` |
| DebugActiveProcess | `0x60` | `svcDebugActiveProcess` | `0x101e68` |
| TerminateProcess | `0x76` | écrit sur place, à 9 endroits | |
| SetProcessResourceLimits | `0x77` | écrit sur place, à 2 endroits | |
| CreateResourceLimit | `0x78` | `svcCreateResourceLimit` | `0x100e50` |
| SetResourceLimitLimitValues | `0x79` | écrit sur place, à 11 endroits | |
| KernelSetState | `0x7C` | `svcKernelSetState`, et écrit sur place à 5 endroits | `0x103df0` |

Les six derniers, à partir de `0x60`, et `Run` agissent sur d'autres processus que celui qui les appelle : ce sont eux qui font de `pm` le maître des processus. `svcKernelSetState` est appelé de trois façons : type 3 avec `0x12000000` au démarrage, type 6 avec 3 puis 0 ou 1 au lancement d'une application, type 0 avec le numéro du FIRM pour redémarrer.

Les verrous du module (`recursive_lock_enter` à `0x1036e8`, `recursive_lock_leave` à `0x103674`) reposent sur `ArbitrateAddress`, comme dans `sm` et `hid`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 16 numéros de commande et leur fonction : le pseudo-code de REA d'un côté ; de l'autre la table de 14 adresses lue à la main à `0x1058a4`, les trois comparaisons de `pmdbg_handle_command` lues dans le désassemblage, et les en-têtes de réponse rangés en constantes à la fin des deux fonctions. Les en-têtes de 3dbrew tombent sur les mêmes numéros, et le nombre de mots lus colle.
- Qui appelle qui, pour 35 fonctions clés (les requêtes, les enveloppes d'appels système, toute la chaîne du lancement et de l'arrêt) : la réponse de REA et un relevé des sauts fait par un script sur le désassemblage de `objdump` donnent les mêmes listes.
- `svcReplyAndReceive` et `svcAcceptSession` ne sont appelés que par `pm_main` ; `svcWaitSynchronizationN` que par le fil de surveillance ; `LOADER_LoadProcess`, `FSREG_Register` et `SRVPM_RegisterProcess` n'ont chacune qu'un appelant, sur le seul chemin `create_process`.
- Les arguments des appels système écrits sur place (les jeux de limites, `svcRun`, `svcKernelSetState`, l'affinité) : lus dans le désassemblage, registre par registre, parce que le pseudo-code de Ghidra ne les montre pas.
- Les 34 appels système utilisés font tous partie des 72 que l'exheader de `pm` autorise.
- Les services appelés : les 16 en-têtes envoyés sont tous dans la Carte des services, sous les noms `srv:`, `srv:pm`, `Loader` et `fs:REG`, et les trois de `srv:pm` sont ceux que la fiche de `sm` a lus de l'autre côté.
- Les positions dans l'exheader (`+0x1C`, `+0x200`, `+0x20F`, `+0x250`, `+0x36F`) : l'exheader de `pm` lui-même, lu aux mêmes positions, donne une taille de pile de 0x1000, son propre numéro de titre, une priorité, le nom `fs:REG` et le jeu de limites 3.
- Ce que 3dbrew dit de chaque commande de `pm:app` (les refus `0xC8A05801`, `0xC8A05BF0`, `0xD8E05802`, `0xD8E05BF4`, la page de 0x1000 octets, le processus numéro 4, la notification `0x179`) : retrouvé dans le code sans exception.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens des drapeaux de lancement et des drapeaux d'une fiche : le code montre ce qu'il en fait, les mots employés ici sont les miens.
- Les quatre états d'une fiche.
- Le sens des champs de la mémoire de configuration du noyau : `0x1FF80008` (le titre du premier programme, celui du module `ns`), `0x1FF80010` (la version du système), `0x1FF80030` (le réglage de mémoire, 6 sur une New 3DS), `0x1FF80040` et `0x1FF80044` (les quantités de mémoire). Ils sont donnés de mémoire d'après 3dbrew et ne sont pas dans la Carte des services. Partout où cette fiche dit « sur New 3DS », le code teste en fait que l'octet `0x1FF80030` vaut 6.
- Les processus trouvés au démarrage vus comme les modules du FIRM, et le sens du type `0x1A` de `svcGetSystemInfo`. Seul le numéro 4, `pxi`, est nommé par 3dbrew.
- Le rôle de `svcKernelSetState` : le type 3 pour rendre accessible la page des paramètres de redémarrage (3dbrew dit ailleurs que ce type touche au tampon de ces paramètres), le type 6 pour choisir un mode de partage du processeur entre le système et l'application. Seuls les nombres passés sont sûrs.
- Les quatre jeux de limites vus comme des catégories de programmes (application, applets, le reste), et le calcul de leur mémoire.
- Le réglage de la mémoire sur New 3DS : le code choisit 64, 96 ou 80 Mo d'après un nombre de l'exheader (`+0x20E`, 4 bits du haut : 0, 2 ou 3), et 0 pour toute autre valeur. Ce dernier cas est à relire.
- La valeur passée pour la mémoire à `svcSetResourceLimitLimitValues` : le même nombre est écrit dans les deux moitiés des 8 octets.
- Les trois titres privés de `http:C` et `soc:U` : sans doute les trois régions d'un même jeu, mais rien dans le code ne le dit.
- La correction de 10 à `+0x37` de l'état et la table des 16 titres : ce qu'elles compensent n'est pas dans le module.
- Les piles des deux fils : le code ne donne que leur sommet (`0x10ab58` et `0x10b358`). Leur taille de 0x800 octets est déduite de l'écart entre les deux et de la fin de la zone des fiches.
- Les priorités des deux fils : le code passe la constante codée `0x6C8DA517`, qu'une soustraction ramène à `0x17`, comme dans `hid`.
- Les conversions de délais (nanosecondes en tics d'horloge et retour) dans `terminate_all_except` : Ghidra ne montre pas la valeur que rend `GetSystemTick`. Le délai de LaunchFIRM, 4 000 000 000 nanosecondes, est lu en clair.

**Pas lu**
- Le détail de `launch_with_dependencies` quand le lancement d'une dépendance échoue, et ce que devient alors le processus déjà créé.
- Les 11 fonctions d'initialisation des objets globaux, sauf `static_init_pm_globals` (`0x105c88`), et les 10 fonctions de fermeture qui vont avec (les 8 de `0x105510` à `0x10570c`, puis `0x10618c` et `0x1061cc`).
- Le démarrage de la bibliothèque C (`0x100494`, `0x100518`, `0x100da8`, `0x100df0`), les deux réserves d'adresses (`0x1010bc`, `0x101124`), les six petites fonctions passées à `create_thread` (`0x1013b4` à `0x1013f0`), le stockage local des fils (`0x101e40`, `0x10245c`, `0x1024a8`, `0x1038c8`, `0x1038dc`).
- 48 fonctions n'ont pas de nom dans `pm.noms.tsv`. Les fonctions de calcul et de copie nommées (`memcpy`, `memclr`, `strlen`, `strcmp`, `udivmod`) le sont d'après leur forme, sans avoir été relues ligne à ligne.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système, nommer leurs enveloppes, trouver les fonctions manquées | `outils/prescan.py`, relancé après chaque rechargement | 10 secondes le dernier passage, décompilation des 175 fonctions comprise |
| Désassembler tout le code par une autre voie | `arm-none-eabi-objdump` de devkitPro, sur le code brut | immédiat |
| Calculer qui appelle qui, lire les tables | des scripts Python sur `code.bin` et sur la sortie d'`objdump` | immédiat |
| Lire le pseudo-code, puis le désassemblage de chaque appel système écrit sur place | Claude | le gros du temps |
| Recharger les noms dans Ghidra | arrêt et relance du pont REA | trois fois |
| Recouper avec la Carte des services et l'exheader | des scripts | immédiat |

**Les pièges rencontrés.**
- Au premier passage Ghidra ne voyait que 146 fonctions. Il lui manquait entre autres `pmapp_handle_command`, `worker_thread_main`, `job_launch_application` et 9 des 11 fonctions d'initialisation : rien de tout cela n'est appelé directement. Avec les graines de `prescan` et deux débuts trouvés à la main (voir plus bas), 188 fonctions.
- Sur ces 188, 14 étaient fausses. La table de l'aiguillage de `pm:app` (`0x1058a4`) contient des adresses de code, et `prescan` les a prises pour des débuts de fonction : ce sont les 14 branches de l'aiguillage. Elles ont été retirées de `pm.noms.tsv`. Une fois `pmapp_handle_command` connue de Ghidra, `prescan` ne les propose plus.
- `exit_monitor_thread_main` (`0x101478`) n'a pas de début reconnaissable : elle ne revient jamais, donc ne sauve aucun registre. L'enveloppe `svcWaitSynchronizationN` (`0x101ea8`), qu'elle est seule à appeler, était du coup invisible aussi. `prescan` signalait leurs appels système « hors de toute fonction » ; leurs débuts ont été trouvés à la main dans le désassemblage. `svcKernelSetState` (`0x103df0`), atteinte par un saut et non par un appel, a été ajoutée de la même façon. Total final : 188, moins les 14 fausses, plus celle-ci, soit 175 fonctions.
- `prescan` avait nommé `entry` « svcExitProcess », parce que Ghidra rattachait d'abord l'appel système de `0x10007c` à la fonction de `0x100000`. Corrigé à la main.
- `prescan` ne compte que les appels système sans condition. Trois `TerminateProcess` s'exécutent sous condition (`0x103b34`, `0x104ce0`, `0x104ddc`) et lui échappent : il en annonce 6, il y en a 9. Les chiffres de la partie 9 viennent du désassemblage d'`objdump`.

**Trois choses à savoir en relisant dans Ghidra.**
- La fonction de départ du fil de surveillance n'est pas `0x101478` mais `0x100f58`, une instruction isolée qui appelle `0x101478` et ne revient jamais. `prescan` l'écarte et elle n'a pas de ligne dans `pm.noms.tsv` : dans `hid`, une graine posée sur une instruction isolée de ce genre faisait afficher deux fois la fonction suivante.
- La fonction à `0x100048` est en Thumb, et le nom qu'on lui donne dans le fichier de graines ne prend pas. À nommer à la main (`run_static_initializers`).
- Ghidra écrit `software_interrupt(0x79)` sans arguments pour un appel système placé au milieu d'une fonction. Pour savoir ce qui est passé au noyau, il faut lire les quatre ou cinq instructions qui précèdent dans le désassemblage.

**Pour reprendre.** `pm.noms.tsv` est le fichier de graines : une adresse, `function`, un nom. Les noms en majuscules (`SRV_`, `SRVPM_`, `LOADER_`, `FSREG_`) sont les requêtes que `pm` envoie à un autre service ; ceux en `pmapp_` et `pmdbg_` sont les commandes qu'il reçoit ; ceux en `job_` sont les travaux du fil de travail. Le pseudo-code brut, le désassemblage d'`objdump` et les scripts de recoupement sont dans `local/analyse/pm/`, non versionné.
