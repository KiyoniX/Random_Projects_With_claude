# dsp, le processeur de son

La console a un second processeur, réservé au son : le DSP. Il a sa propre mémoire et fait tourner son propre programme, que chaque jeu apporte dans un fichier (le « composant », chez Pokémon X `romfs/sound/dspaudio.cdc`). `dsp` est le seul programme de la console qui touche à ce processeur. Il vérifie le composant, le copie dans la mémoire du DSP, démarre le DSP, puis fait le facteur : il lit et écrit les « tuyaux » par lesquels le jeu et le DSP se parlent, et il prévient le jeu quand le DSP a quelque chose à dire. Tout le son de Pokémon X passe par là.

Fiche du 13 octobre 2026, produite avec REA et Ghidra sur le module dumpé de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001A02` (lu dans l'exheader) |
| Fichier lu | `local/extrait/dsp/exefs/code.elf` |
| Taille | 31 172 octets de code, 956 de données en lecture seule, 608 de données, 16 652 de mémoire à zéro |
| Fonctions | 293 : 280 trouvées par Ghidra et 13 qu'il a manquées ; 192 nommées dans `dsp.noms.tsv` |
| Service offert | `dsp::DSP` (33 numéros de commande, dont 32 servis ; 4 sessions au plus) |
| Services appelés | `pdn:d`, `cdc:DSP`, `ptm:s`, `cfg:s`, `ps:ps`, plus `srv:` et le port `err:f` |
| Fils | le fil principal, un fil pour les interruptions, et un fil par session ouverte, quatre au plus |
| Interruption | `0x4A`, la seule que l'exheader demande au noyau |
| Matériel projeté | la page `0x1ED03000` (les registres du DSP), la page `0x1EC40000` (les registres des blocs de mémoire), et la mémoire du DSP de `0x1FF00000` à `0x1FF80000` |

## Partie 1 : le démarrage et les fils

`entry` (`0x100000`) appelle six fonctions à la suite, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de `0x109260` à `0x10d36c`.
2. Une fonction non lue (`0x100688`).
3. `init_runtime_and_srv` (`0x10476c`) prépare les verrous, se connecte au port `srv:` et s'y déclare (`SRV_RegisterClient`).
4. `run_static_initializers` (`0x100184`), écrite en Thumb, appelle les 25 fonctions d'initialisation des objets globaux, par la table de distances de `0x108358` à `0x1083bc`.
5. Une fonction vide (`0x100654`).
6. `dsp_main` (`0x1001a8`) : tout le reste.

**`dsp_main` fait, dans l'ordre :**

1. `srv_init`, puis `ptm_open` (`0x1008bc`) : ouvre `ptm:s`.
2. Trois gestionnaires de notifications sont inscrits (`register_notification_handler`, `0x104694`) : `0x100`, `0x104` et `0x105`.
3. `get_notification_semaphore` (`0x100924`) demande à `sm` le sémaphore des notifications.
4. `SRV_RegisterService` crée `dsp::DSP` avec 4 sessions au plus. Le nom est pointé par `0x109014`.
5. `SRV_Subscribe` deux fois : notifications `0x104` et `0x105`.
6. `dsp_initialize` (`0x100700`) : voir plus bas.
7. La boucle de la partie 2.
8. À la sortie : le service est retiré, les fils de session attendus, puis `dsp_finalize` (`0x1007a0`), `ptm_close` et `srv_exit`.

**`dsp_initialize` (`0x100700`) :**

| Ordre | Fonction | Adresse | Ce qu'elle fait |
| --- | --- | --- | --- |
| 1 | `lock_init`, deux fois | `0x104408` | Le verrou d'état (`0x109260`) et le verrou des commandes du codec (`0x10926c`) |
| 2 | `dsp_hw_power_init` | `0x101070` | Prépare le verrou des transferts (`0x10cdb8`), puis envoie deux requêtes à `pdn:d` (voir la remarque) |
| 3 | `interrupt_manager_init` | `0x100e04` | Crée trois signaux, lie l'interruption `0x4A`, lance le fil des interruptions (partie 7) |
| 4 | `srv_get_service_handle_by_name` | `0x104240` | Ouvre `pdn:d` |
| 5 | `cdc_open` | `0x100f24` | Ouvre `cdc:DSP` |
| 6 | `mem_block_shadow_init` | `0x100f50` | Relit les 16 registres des blocs de mémoire (partie 5) dans un tableau à `0x10cdc4` |
| 7 | `is_new_3ds` | `0x100ce8` | Demande à `ptm:s` si la console est une New 3DS ; le mot `0x109002` vaut alors 2, sinon 0 |

Remarque sur l'étape 2 : les deux requêtes `PDND_Control` partent avant l'étape 4, donc sur une poignée encore nulle, et leur résultat n'est pas regardé. C'est ce que l'assembleur montre (`0x100714` avant `0x100724`) ; je n'en tire pas de conclusion.

**Les fils.** Tous passent par `create_thread` (`0x104424`), la seule fonction qui appelle `svcCreateThread`, et commencent dans `thread_trampoline` (`0x101898`), qui appelle la vraie fonction du fil puis tombe dans l'enrobage `svcExitThread` (`0x1018dc`).

| Fil | Fonction | Adresse | Créé par | Priorité | Pile | Ce qu'il fait |
| --- | --- | --- | --- | --- | --- | --- |
| Principal | `dsp_main` | `0x1001a8` | le noyau | | `0x1000` (exheader) | Notifications et nouveaux clients |
| Session (quatre au plus) | `dsp_session_thread_main` | `0x107974` | `dsp_main` | `0x18` | `0x800` | Répond aux commandes d'un seul client |
| Interruptions | `interrupt_thread_main` | `0x101730` | `interrupt_manager_start` (`0x1012c4`) | `0x0A` | `0x1000` | Attend le DSP, prévient le jeu, écrit le sémaphore |

Un nombre plus petit veut dire plus prioritaire : le fil des interruptions passe devant les sessions. L'adresse de chacune des deux fonctions de fil n'apparaît qu'une fois dans le module (`0x109018` pour la session, `0x10146c` pour les interruptions).

## Partie 2 : la boucle de serveur

`dsp` donne un fil à chaque client, comme `hid`.

**Dans `dsp_main` :**

1. **L'attente.** `svcWaitSynchronizationN` attend sur deux poignées : le sémaphore des notifications et le port du service.
2. **Le sémaphore.** `handle_srv_notification` (`0x100958`) lit le numéro par `SRV_ReceiveNotification` et appelle le gestionnaire inscrit pour ce numéro (tableau plus bas).
3. **Un client arrive.** La boucle cherche une case libre parmi quatre (les quatre bits de `0x10901c`). S'il n'y en a plus, elle attend qu'un des quatre fils se termine et reprend sa case. Puis `svcAcceptSession` ouvre la session et `create_thread` lance `dsp_session_thread_main` avec la poignée de la session.
4. **La sortie.** Quand l'octet `0x10a788` passe à 1 (notification `0x100`), la boucle s'arrête.

**Dans le fil d'une session :**

`dsp_session_thread_main` (`0x107974`) appelle `dsp_session_receive_loop` (`0x104a4c`). Celle-ci déclare d'abord trois tampons de réception de `0x100` octets (les trois au même endroit, `0x10a438`) pour les commandes qui envoient des données, puis tourne sur `svcReplyAndReceive` avec la seule poignée de son client. C'est la seule fonction du module qui appelle `svcReplyAndReceive`. À chaque commande elle appelle `dsp_handle_command` (`0x104b28`).

Quand le client s'en va (résultat `0xC920181A`), le fil ferme la poignée et appelle `dsp_session_close` (`0x106a4c`). Si ce fil est celui qui avait chargé le composant (son numéro est gardé à `0x10900c`), le composant est déchargé, les six signaux inscrits sont fermés et les tables d'interruptions remises à vide.

Les quatre sessions partagent tout : le même contexte (`0x10a2e8`), les mêmes tampons, le même DSP. Rien ne sépare un client d'un autre, sauf le verrou d'état `0x109260`.

| Notification | Gestionnaire | Ce qu'il fait |
| --- | --- | --- |
| `0x100` | `on_terminate_notification` (`0x106bbc`) | Lève l'octet qui fait sortir la boucle |
| `0x104` | `on_sleep_wake_notification` (`0x1073ec`) | Si un composant est chargé : `dsp_suspend_for_sleep` (`0x106550`) coupe le DSP. Puis `PTMSYSM_NotifySleepPreparationComplete` |
| `0x105` | la même | Si un composant est chargé : `dsp_boot` relance le DSP et remet les réglages d'interruption mis de côté. Puis le même message à `ptm` |

## Partie 3 : les commandes de `dsp::DSP`

`dsp_handle_command` (`0x104b28`) lit l'en-tête dans le tampon du fil (à `+0x80` du stockage local), prend le numéro de commande dans les 16 bits du haut, et saute par une table de 34 adresses rangée à `0x104b48`. Les noms et les en-têtes de requête viennent de 3dbrew ; l'adresse, le contrôle et l'en-tête de réponse sont lus dans le code.

La colonne « E » marque les commandes dont le code vérifie l'en-tête entier (sinon `0xD9001830`). Les autres ne regardent que le numéro.

| N° | En-tête de requête | Commande | Fonction | Adresse | E | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010040` | RecvData | `dsp_RecvData` | `0x1040a8` | | `0x00010080` |
| 2 | `0x00020040` | RecvDataIsReady | `dsp_RecvDataIsReady` | `0x103b4c` | | `0x00020080` |
| 3 | `0x00030080` | SendData | `dsp_SendData` | `0x1040e0` | | `0x00030040` |
| 4 | `0x00040040` | SendDataIsEmpty | `dsp_SendDataIsEmpty` | `0x107320` | | `0x00040080` |
| 5 | `0x000500C2` | SendFifoEx | `dsp_SendFifoEx` | `0x103a50` | E | `0x00050040` |
| 6 | `0x000600C0` | RecvFifoEx | `dsp_RecvFifoEx` | `0x1038d4` | | `0x00060042` |
| 7 | `0x00070040` | SetSemaphore | `dsp_SetSemaphore` | `0x103d4c` | | `0x00070040` |
| 8 | `0x00080000` | GetSemaphore | `dsp_GetSemaphore` | `0x1038b4` | | `0x00080080` |
| 9 | `0x00090040` | ClearSemaphore | `dsp_ClearSemaphore` | `0x1038a0` | | `0x00090040` |
| 10 | `0x000A0040` | MaskSemaphore | `dsp_MaskSemaphore` | `0x10388c` | | `0x000A0040` |
| 11 | `0x000B0000` | CheckSemaphoreRequest | `dsp_CheckSemaphoreRequest` | `0x107344` | | `0x000B0080` |
| 12 | `0x000C0040` | ConvertProcessAddressFromDspDram | `dsp_ConvertProcessAddressFromDspDram` | `0x1069ec` | | `0x000C0080` |
| 13 | `0x000D0082` | WriteProcessPipe | `dsp_WriteProcessPipe` | `0x106794` | E | `0x000D0040` |
| 14 | `0x000E00C0` | ReadPipe | `pipe_load` puis `pipe_read` | `0x1037f0`, `0x103698` | | `0x000E0042` |
| 15 | `0x000F0080` | GetPipeReadableSize | `pipe_load` puis `pipe_get_readable_size` | `0x1037f0`, `0x10366c` | | `0x000F0080` |
| 16 | `0x001000C0` | ReadPipeIfPossible | les trois mêmes | | | `0x00100082` |
| 17 | `0x001100C2` | LoadComponent | `dsp_LoadComponent` | `0x105dc0` | E | `0x00110082` |
| 18 | `0x00120000` | UnloadComponent | `dsp_UnloadComponent` | `0x1060f4` | | `0x00120040` |
| 19 | `0x00130082` | FlushDataCache | `dsp_FlushDataCache` | `0x106038` | E | `0x00130040` |
| 20 | `0x00140082` | InvalidateDCache | `dsp_InvalidateDCache` | `0x1065bc` | E | `0x00140040` |
| 21 | `0x00150082` | RegisterInterruptEvents | `dsp_RegisterInterruptEvents` | `0x106998` | E | `0x00150040` |
| 22 | `0x00160000` | GetSemaphoreEventHandle | `dsp_GetSemaphoreEventHandle` | `0x106984` | | `0x00160042` |
| 23 | `0x00170040` | SetSemaphoreMask | `dsp_SetSemaphoreMask` | `0x106230` | | `0x00170040` |
| 24 | `0x00180040` | GetPhysicalAddress | `dsp_GetPhysicalAddress` | `0x1068b4` | | `0x00180080` |
| 25 | `0x00190040` | GetVirtualAddress | aucune | | | |
| 26 | `0x001A0042` | SetIirFilterI2S1 | `dsp_SetIirFilterI2S1` | `0x1061b0` | E | `0x001A0042` |
| 27 | `0x001B0042` | SetIirFilterI2S2 | `dsp_SetIirFilterI2S2` | `0x1061f0` | E | `0x001B0042` |
| 28 | `0x001C0082` | SetIirFilterEQ | `dsp_SetIirFilterEQ` | `0x106094` | E | `0x001C0042` |
| 29 | `0x001D00C0` | ReadMultiEx_SPI2 | `dsp_ReadMultiEx_SPI2` | `0x106160` | | `0x001D0042` |
| 30 | `0x001E00C2` | WriteMultiEx_SPI2 | `dsp_WriteMultiEx_SPI2` | `0x1062d8` | E | `0x001E0040` |
| 31 | `0x001F0000` | GetHeadphoneStatus | `dsp_GetHeadphoneStatus` | `0x106518` | | `0x001F0080` |
| 32 | `0x00200040` | ForceHeadphoneOut | `dsp_ForceHeadphoneOut` | `0x106244` | | `0x00200040` |
| 33 | `0x00210000` | GetIsDspOccupied | dans l'aiguillage | `0x105438` | | `0x00210080` |

- **La commande 25 n'existe pas dans ce module.** Sa case de la table pointe au même endroit que la case 0 et que les numéros au-delà de 33 : la réponse est `0xD900182F`, « commande inconnue ».
- Les commandes qui reçoivent un tampon (5, 13, 30) exigent chacune un tampon d'un rang précis : 0, 1 et 2. Les commandes 17, 26, 27 et 28 exigent une zone de mémoire projetée.
- Les commandes 19, 20 et 21 exigent en plus que le mot 3 soit nul (c'est l'annonce d'une poignée).

**Les registres de dialogue (1 à 4).** Le DSP et l'ARM11 se passent des mots de 16 bits par trois paires de registres, numérotées 0, 1 et 2 : un registre « commande » que l'ARM11 écrit, un registre « réponse » qu'il lit.

| Commande | Ce que le code fait |
| --- | --- |
| RecvData(n) | Attend en boucle que le bit `10 + n` de `0x1ED0300C` soit levé, puis lit le mot à `0x1ED03024 + n × 8`. Efface au passage le bit `16 + n` du mot `0x10903c` (partie 7) |
| RecvDataIsReady(n) | Rend ce même bit `10 + n` |
| SendData(n, valeur) | Attend en boucle que le bit `13 + n` de `0x1ED0300C` soit retombé, puis écrit le mot à `0x1ED03020 + n × 8` |
| SendDataIsEmpty(n) | Rend 1 si ce bit `13 + n` est retombé |

Ces attentes sont des boucles sans sommeil ni limite de temps, verrou d'état pris : si le DSP ne répond pas, le fil de la session y reste.

**Les transferts directs (5 et 6).** Le jeu peut lire et écrire lui-même dans la mémoire du DSP, mot par mot (partie 5). La commande 5 envoie le contenu de son tampon ; le nombre de mots est la taille du tampon divisée par 2. La commande 6 lit au plus `0x100` mots, selon le contrôle de l'aiguillage ; mais `dsp_RecvFifoEx` appelle `break_process` dès qu'on lui demande plus de 16 mots (`0x103928`).

**Le sémaphore (7 à 11).** Cinq registres de 16 bits, un par commande : voir la partie 7.

**Le cache (19, 20).** Elles reçoivent une adresse, une taille et la poignée du processus du jeu. `linear_vaddr_to_paddr` (`0x103148`) vérifie que la zone est dans le tas linéaire (`0x14000000` à `0x1C000000`, ou `0x30000000` à `0x40000000`) ; puis `FlushProcessDataCache` ou `InvalidateProcessDataCache` sur le processus du jeu. La commande 20 accepte en plus une adresse de la mémoire du DSP (`0x1FF00000` à `0x1FF80000`) : l'appel est alors fait sur `dsp` lui-même. Autre adresse : `0xE0E3FFF6`. Dans tous les cas la poignée reçue est refermée.

**Le codec (26 à 32).** Ces commandes ne touchent pas au DSP. Elles prennent le verrou `0x10926c` et relaient la demande à `cdc:DSP` (partie 9). ForceHeadphoneOut rend `0xC8A0A401` si aucun composant n'est chargé.

**GetIsDspOccupied (33)** rend l'octet `0x109001` : 1 depuis LoadComponent jusqu'à UnloadComponent.

## Partie 4 : LoadComponent, pas à pas

C'est la première commande utile qu'envoie un jeu : `0x001100C2`. Elle porte la taille du composant, deux masques de 16 bits, et le composant lui-même dans une zone de mémoire projetée.

1. **L'aiguillage** (cas 17, à `0x1050c0`) vérifie l'en-tête entier et que la zone est bien une zone projetée. La taille utilisée ensuite est celle de la zone, pas le premier paramètre.
2. **Déjà chargé ?** `dsp_LoadComponent` (`0x105dc0`) prend le verrou d'état. Si l'octet `0x109000` vaut déjà 1, elle ne fait rien et répond « résultat 0, composant non chargé ».
3. **Le contexte.** `process_context_init` (`0x1068f4`) met à zéro les `0x150` octets du contexte (`0x10a2e8`), y écrit le nom `synthe`, et marque « aucun bloc » dans ses deux tableaux de blocs.
4. **Les tuyaux.** `component_load_and_boot` (`0x106328`) appelle `pipes_init` (`0x106aec`) : l'adresse de la table des tuyaux est oubliée (`0x109020` = 0), les huit fonctions de rappel sont retirées, sauf celle du tuyau 0.
5. **L'en-tête est mis de côté.** `component_verify_and_copy` (`0x105528`) copie les `0x300` premiers octets du composant à `0x10cab8`. Tous les contrôles se font sur cette copie.
6. **La signature.** Les `0x100` premiers octets sont une signature RSA de 2 048 bits. La clé publique est dans le module, à `0x10812c` (`0x100` octets), avec l'exposant `0x10001`. `verify_rsa_sha256_signature` (`0x102d34`) calcule le SHA-256 des `0x200` octets suivants, ouvre `ps:ps`, et lui demande la vérification (`PS_VerifyRsaSha256`, `0x00020244`). `dsp` ne fait pas le calcul RSA lui-même.
7. **L'en-tête.** Trois contrôles : les quatre lettres `DSP1`, la taille annoncée égale à la taille reçue et inférieure à `0x100000`, et un nombre de segments entre 1 et 10. Tout échec des étapes 6 et 7 rend `0xD8E0A7EA`.
8. **Les blocs de mémoire.** Le mot `+0x108` de l'en-tête dit quels blocs de `0x8000` octets le composant occupe : bits 0 à 7 pour la mémoire de programme, bits 8 à 15 pour la mémoire de données. Pour chaque bit levé, le propriétaire du bloc est mis à 0 (`mem_block_set_owner`, `0x1035b4`), son registre reçoit sa place, et ses `0x8000` octets sont mis à zéro.
9. **Les segments.** Pour chacun : sa position et sa taille doivent tenir dans le fichier, son adresse et sa taille dans la mémoire visée (`component_check_segment_range`, `0x103548`). Puis il est copié dans la mémoire du DSP, par morceaux qui s'arrêtent à chaque frontière de bloc. Un SHA-256 est calculé sur ce qui vient d'être écrit, relu dans la mémoire du DSP, et comparé aux 32 octets rangés dans l'en-tête. Différence : `0xD8E0A7EA`.
10. **Le segment spécial.** Si le bit 1 des drapeaux est levé, `cfg_read_block_70000` (`0x1062ac`) lit le bloc de configuration `0x00070000` (`0x214` octets) par `cfg:s`. Si la lecture échoue, ce sont `0x214` zéros. Le résultat est copié à l'adresse et sur la longueur que donne l'en-tête.
11. **Le cache.** `FlushProcessDataCache` sur les deux mémoires, `0x40000` octets chacune.
12. **Les blocs changent de main.** Pour chaque bloc pris, `mem_block_set_owner` met son propriétaire à 1 et son registre reçoit à nouveau sa place. Échec : `0xD8E0A7EE`. Je lis ces deux étapes comme « l'ARM11 prend les blocs pour y écrire, puis les donne au DSP » : voir « interprété ».
13. **Le démarrage.** Le contexte est ajouté à la liste `0x109030`, puis `dsp_boot` (`0x10303c`) :
    - `dsp_hw_power_up_and_reset` (`0x10735c`) envoie trois requêtes à `pdn:d`, puis lève le bit 0 de `0x1ED03008` et attend que le bit 2 de `0x1ED0300C` retombe ;
    - `dsp_hw_release_reset` (`0x107294`) baisse les bits 9 à 11 de `0x1ED03008`, met `0x1ED03010` à 0 et `0x1ED03018` à `0xFFFF`, puis baisse le bit 0 de `0x1ED03008` : le DSP part ;
    - `dsp_MaskSemaphore` écrit `0xFFFF` dans `0x1ED03014` (rien n'est encore écouté) ;
    - si le bit 0 des drapeaux de l'en-tête est levé, le code lit les registres de réponse 0, 1 et 2, chacun jusqu'à y trouver la valeur 1 ;
    - un premier tour du tri des sources de la partie 7, recopié sur place dans `dsp_boot`.
14. **L'écoute.** `process_set_irq_hook` (`0x10410c`) branche `pipe_interrupt_hook` sur les sources `0x48000` : le bit 15 du sémaphore et le registre de réponse 2. Dans le matériel, cela lève le bit 11 de `0x1ED03008` et baisse le bit 15 de `0x1ED03014`.
15. **Le codec.** `CDCDSP_cmd0007` avec 1, puis `CDCDSP_cmd0008` avec 1.
16. **Les rappels des tuyaux 1 à 7** deviennent `pipe_signal_client_event` (partie 7). Les octets `0x109000` et `0x109001` passent à 1.
17. **Le propriétaire.** Le numéro du fil est rangé à `0x10900c`, que le chargement ait réussi ou non.
18. **La réponse.** En-tête `0x00110082`, le résultat, l'octet « chargé » (1), puis la zone rendue au jeu.

**L'en-tête d'un composant, tel que le code le lit :**

| Position | Taille | Contenu |
| --- | --- | --- |
| `0x000` | `0x100` | la signature RSA |
| `0x100` | 4 | les lettres `DSP1` |
| `0x104` | 4 | la taille du fichier |
| `0x108` | 2 | les blocs occupés : octet bas pour le programme, octet haut pour les données |
| `0x10A` | 3 | pas lus par le code |
| `0x10D` | 1 | le type de mémoire du segment spécial |
| `0x10E` | 1 | le nombre de segments, de 1 à 10 |
| `0x10F` | 1 | drapeaux : bit 0 « attendre trois réponses au démarrage », bit 1 « il y a un segment spécial » |
| `0x110` | 4 | l'adresse du segment spécial, en mots |
| `0x114` | 4 | sa taille en octets |
| `0x118` | 8 | pas lus par le code |
| `0x120` | 10 × `0x30` | les segments |

**Un segment (`0x30` octets) :**

| Position | Taille | Contenu |
| --- | --- | --- |
| `+0x00` | 4 | où il commence dans le fichier |
| `+0x04` | 4 | son adresse dans la mémoire du DSP, en mots de 16 bits |
| `+0x08` | 4 | sa taille en octets |
| `+0x0C` | 3 | pas lus par le code |
| `+0x0F` | 1 | son type de mémoire |
| `+0x10` | `0x20` | son SHA-256 |

**Où va un segment.** Le type choisit la mémoire et un décalage ; l'adresse est en mots, donc multipliée par 2.

| Type | Mémoire | Adresse du premier octet vue de l'ARM11 | Limite contrôlée |
| --- | --- | --- | --- |
| 0 | programme | `0x1FF00000` + adresse × 2 | adresse et fin sous `0x20000` mots |
| 1 | programme | `0x1FF00000` + (adresse + `0x10000`) × 2 | adresse et fin sous `0x10000` mots |
| 2 | données | `0x1FF40000` + adresse × 2 | adresse et fin sous `0x10000` mots |
| 3 | données | `0x1FF40000` + (adresse + `0x10000`) × 2 | la même |

Ces adresses valent quand chaque bloc est à sa place naturelle (bloc *n* à la place *n*), ce que fait ce code. Le calcul complet passe par le tableau des blocs du contexte : partie 5. Un type au-delà de 3 est refusé. La taille d'un segment doit aussi être plus petite que le fichier entier.

**Vérifié sur le composant de Pokémon X.** Le script `local/analyse/dsp/check_component.py` relit `dspaudio.cdc` avec cette disposition : lettres `DSP1`, taille annoncée `0x35378` égale à celle du fichier, masque `0xFFFF`, drapeaux `0x03`, 6 segments dont les six SHA-256 retombent juste, et un segment spécial de `0x214` octets, exactement la taille du bloc de configuration que le code va lire. `check_signature.py` refait la vérification RSA avec la clé de `0x10812c` : le bloc déchiffré se termine bien par le SHA-256 des octets `0x100` à `0x300`.

| Segment | Dans le fichier | Adresse (mots) | Taille | Type | Copié en |
| --- | --- | --- | --- | --- | --- |
| 0 | `0x00300` | `0x00000` | `0x00D4A` | 0 | `0x1FF00000` |
| 1 | `0x0104A` | `0x02900` | `0x1A93E` | 0 | `0x1FF05200` |
| 2 | `0x1B988` | `0x10000` | `0x18568` | 0 | `0x1FF20000` |
| 3 | `0x33EF0` | `0x03C8C` | `0x00C10` | 2 | `0x1FF47918` |
| 4 | `0x34B00` | `0x04C00` | `0x00854` | 2 | `0x1FF49800` |
| 5 | `0x35354` | `0x0C298` | `0x00024` | 2 | `0x1FF58530` |

Son segment spécial est de type 2, à l'adresse `0xEF29` mots.

**Les deux masques envoyés par le jeu** sont rangés dans le contexte (`+0x18` et `+0x1A`), et le code y efface les bits des blocs qu'il prend. Dans ce que j'ai lu, rien ne s'en sert pour choisir les blocs : c'est le mot `+0x108` du composant qui décide.

**UnloadComponent** (`0x1060f4`) défait tout par `component_unload` (`0x104330`) : l'écoute est retirée, `0x8000` est écrit dans le registre de commande 2 et le code attend une réponse dans le registre 2, puis le DSP est remis à l'arrêt (bit 0 de `0x1ED03008`) et deux requêtes partent à `pdn:d`. Ensuite `CDCDSP_cmd0007` avec 0 et `CDCDSP_cmd0008` avec 1.

## Partie 5 : la mémoire du DSP vue depuis l'ARM11

**Deux mémoires de huit blocs.** Le DSP compte en mots de 16 bits. Il a une mémoire de programme et une mémoire de données, chacune découpée en 8 blocs de `0x8000` octets (`0x4000` mots). L'exheader fait projeter le tout dans `dsp`, de `0x1FF00000` à `0x1FF80000`.

| Mémoire | Adresse dans `dsp` | Taille | Registres des blocs | Tableau des blocs dans le contexte | Rang |
| --- | --- | --- | --- | --- | --- |
| programme | `0x1FF00000` (`program_mem_base`, `0x1073d4`) | `0x40000` | `0x1EC40000` à `0x1EC40007` | `+0x28`, 8 mots | 1 |
| données | `0x1FF40000` (`data_mem_base`, `0x1073e0`) | `0x40000` | `0x1EC40008` à `0x1EC4000F` | `+0x48`, 8 mots | 2 |

Le rang est le premier argument de `mem_block_set_owner` et de `mem_region_base` (`0x1035a4`). Un rang 0 existe aussi (`0x1FF80000`, fonctions vides) : aucun appel lu ne s'en sert.

**Un registre par bloc**, d'un octet :

| Bits | Ce que le code y écrit |
| --- | --- |
| 0 | le propriétaire : 0 avant la copie du composant, 1 avant le démarrage du DSP |
| 2 à 4 | la place du bloc, de 0 à 7 |
| 7 | 1 à chaque changement de propriétaire |

**ConvertProcessAddressFromDspDram (commande 12).** Le jeu donne une adresse de la mémoire de données du DSP, en mots, et reçoit l'adresse où `dsp` la voit :

`0x1FF40000 + bloc[adresse ÷ 0x4000] × 0x8000 + (adresse modulo 0x4000) × 2`

Avec le composant de Pokémon X, le bloc *n* est à la place *n*, et la formule se réduit à `0x1FF40000 + adresse × 2`. Si aucun composant ne tourne (octet `0x109000` à 0), la commande rend 0.

C'est avec cette adresse que le jeu trouve la zone où il décrit ses voix. Le module, lui, n'y va jamais : les seules fonctions qui calculent une adresse dans la plage `0x1FF00000` à `0x1FF7FFFF` sont le chargement du composant (`component_verify_and_copy`, `component_load_and_boot`) et cette commande, qui se contente de rendre l'adresse.

**L'accès mot par mot.** Pour tout le reste, et d'abord pour les tuyaux, `dsp` passe par trois registres : une adresse, une donnée, un réglage.

| Fonction | Adresse | Ce qu'elle fait |
| --- | --- | --- |
| `dsp_SendFifoEx` | `0x103a50` | Écrit l'adresse dans `0x1ED03004`, règle `0x1ED03008`, puis pour chaque mot attend que le bit 7 de `0x1ED0300C` retombe et écrit le mot dans `0x1ED03000`. À la fin, attend le bit 8 levé et le bit 1 retombé |
| `dsp_RecvFifoEx` | `0x1038d4` | Règle `0x1ED03008`, écrit l'adresse, lève le bit 4, puis pour chaque mot attend le bit 6 de `0x1ED0300C` et lit `0x1ED03000`. Lit ensuite des mots pour rien jusqu'à 8 ou 16, puis baisse le bit 4 |
| `dsp_mem_read_bytes` | `0x10331c` | Lit une suite d'octets à une adresse en octets : divise l'adresse par 2, gère un début ou une fin impairs |
| `dsp_mem_write_bytes` | `0x10321c` | La même chose en écriture ; un octet isolé passe par `dsp_mem_write_byte` (`0x102f24`), qui lit le mot, change un octet et le réécrit |

`dsp_RecvFifoEx` ne sait lire que 1 mot, 2 à 8 mots ou 9 à 16 mots par appel ; au-delà elle appelle `break_process`. Or `dsp_mem_read_bytes` lui passe la longueur demandée sans la découper : une lecture de plus de 32 octets d'un seul tenant dans un tuyau arrive à ce cas. À relire dans Ghidra avant d'en dépendre.

Le premier argument de ces deux fonctions va dans les bits 12 à 15 de `0x1ED03008`. Tous les appels du module y mettent 0.

**GetPhysicalAddress (commande 24)** est à part. Elle rend l'adresse telle quelle si elle est dans la mémoire du DSP, lui retire `0x08000000` si elle est entre `0x08000000` et `0x0E000000`, et rend 0 sinon. Une première branche, par une plage dont je n'ai trouvé nulle part l'initialisation (`0x1090e8`, `0x1090ec`), ajoute un décalage demandé au noyau au démarrage (`svcGetProcessInfo`, type `0x14`).

## Partie 6 : les tuyaux

Un tuyau est un tampon tournant rangé dans la mémoire de données du DSP. Il y en a 8 (les « canaux » 0 à 7), chacun en deux sens : sens 0 du DSP vers l'ARM11, sens 1 de l'ARM11 vers le DSP. 3dbrew donne l'usage des premiers : 0 pour le débogage, 1 pour le DMA, 2 pour le son, 3 pour le binaire.

**Où sont les tuyaux.** Le module ne le sait pas d'avance : c'est le DSP qui le lui dit. Après le démarrage, le premier mot que le DSP dépose dans le registre de réponse 2 est l'adresse de la table des tuyaux, en mots. `pipe_interrupt_hook` la multiplie par 2 et la range à `0x109020`. Tant qu'elle vaut 0, toute commande de tuyau attend dans `pipe_load`.

**La table**, à cette adresse de la mémoire de données : 16 fiches de 10 octets. La fiche du canal *c*, sens *s*, est à `table + c × 0x14 + s × 0x0A`.

| Décalage | Taille | Contenu |
| --- | --- | --- |
| `+0` | 2 | l'adresse du tampon, en mots |
| `+2` | 2 | sa longueur, en octets |
| `+4` | 2 | la position de lecture |
| `+6` | 2 | la position d'écriture |
| `+8` | 2 | dans l'octet bas : `c × 2 + s` |

Une position, ce sont 15 bits de décalage en octets, plus le bit 15 qui change d'état à chaque retour au début du tampon. Le tuyau est vide quand les deux positions sont égales, plein quand elles ne diffèrent que par le bit 15.

**Tout passe par les registres.** Les fiches et les tampons sont lus et écrits par `dsp_mem_read_bytes` et `dsp_mem_write_bytes` (partie 5), jamais par la mémoire projetée.

**Lire : `pipe_read` (`0x103698`).** ReadPipe reçoit le canal, le sens et une taille, plafonnée à `0x200` octets.

1. `pipe_load` (`0x1037f0`) attend que la table soit connue, puis lit les 10 octets de la fiche. Canal au-delà de 7 ou sens au-delà de 1 : rien n'est lu.
2. Si les deux positions sont égales, le tuyau est vide : le fil s'endort sur l'événement interne `0x109024`, que `pipe_interrupt_hook` déclenche à chaque message du DSP, puis relit la fiche. **ReadPipe ne rend donc la main que quand tout est arrivé.**
3. Sinon, il lit d'un seul tenant jusqu'à la position d'écriture, ou jusqu'à la fin du tampon si l'écriture a déjà fait le tour. L'adresse lue est `adresse du tampon × 2 + position`.
4. La position de lecture avance ; arrivée au bout, elle revient à 0 et son bit 15 change.
5. Quand la demande est servie (ou avant de s'endormir), `pipe_commit_position` (`0x1031bc`) écrit la nouvelle position de lecture dans la fiche (2 octets à `+4`), puis écrit `c × 2 + s` dans le registre de commande 2 : c'est le message « j'ai touché à ce tuyau » pour le DSP.
6. La réponse `0x000E0042` porte les octets dans un tampon fixe du module (`0x10a538`).

**GetPipeReadableSize** lit la fiche et calcule `(écriture − lecture) modulo 0x8000`, en ajoutant la longueur du tampon si les deux bits 15 diffèrent (`pipe_get_readable_size`, `0x10366c`).

**ReadPipeIfPossible** fait ce calcul d'abord. S'il y a au moins la taille demandée, elle lit et rend cette taille ; sinon elle rend 0 sans attendre. C'est la seule lecture qui ne bloque pas.

**Écrire : `pipe_write` (`0x105ed8`).** WriteProcessPipe (`0x000D0082`) reçoit le canal et les données dans un tampon de `0x100` octets au plus. La longueur écrite est celle du tampon, pas le paramètre « taille ».

1. `dsp_WriteProcessPipe` (`0x106794`) charge la fiche du canal, sens 1.
2. Si le tuyau est plein, le fil s'endort sur le même événement interne et relit la fiche.
3. Sinon il écrit d'un seul tenant jusqu'à la fin du tampon, ou jusqu'à la position de lecture si l'écriture a déjà fait le tour.
4. La position d'écriture avance de la même façon, puis `pipe_commit_position` l'écrit dans la fiche (2 octets à `+6`) et prévient le DSP par le registre de commande 2.

**Une retouche au passage.** Avant d'écrire, l'aiguillage (`0x104f50`) modifie les données du jeu : pour le canal 2, il écrit le mot `0x109002` aux octets 2 et 3 du tampon ; pour le canal 3, aux octets 6 et 7. Ce mot vaut 2 sur une New 3DS, 0 sinon.

Le [contrat de `dsp::DSP`](contrat-dsp.md) a lu l'autre côté. Sur le canal 2, Pokémon X envoie 4 octets : un mot d'état aux octets 0 et 1 (0 « démarre », 1 « arrête », 2 « redémarre après une veille », 3 « arrête pour une veille ») et **rien** aux octets 2 et 3, qui gardent ce qui traînait sur sa pile ; c'est ce module qui les remplit. 3dbrew place l'ordre de changement d'état à la position 2 : le jeu et le module s'accordent contre lui. Sur le canal 3, les messages du décodeur AAC font `0x20` octets dans les deux sens, et le jeu n'écrit rien aux octets 4 à 7. Le jeu ne lit jamais plus de `0x20` octets d'un coup (2, 30 ou `0x20`) : la limite de `dsp_RecvFifoEx` (partie 5) ne le touche pas. Il n'envoie que ReadPipeIfPossible, jamais ReadPipe, et toujours après avoir attendu le signal du canal.

**Le tuyau 0** a un traitement à part : à chaque message du DSP à son sujet, `pipe0_drain_callback` (`0x1067c8`) le vide par paquets de `0x80` octets et jette ce qu'il a lu.

## Partie 7 : les interruptions et le sémaphore

**La liaison avec le noyau.** `interrupt_manager_start` (`0x1012c4`) crée trois signaux, lie le premier à l'interruption `0x4A` par `svcBindInterrupt` (priorité 4), et lance `interrupt_thread_main`. C'est le seul appel à `svcBindInterrupt` du module, et `0x4A` est le seul numéro que l'exheader demande.

**Le fil** (`interrupt_thread_main`, `0x101730`) attend sur les trois signaux :

| Rang | Signal | Qui le déclenche | Ce que fait le fil |
| --- | --- | --- | --- |
| 0 | `0x109288` | le noyau, à chaque interruption `0x4A` | Prend le verrou `0x109278`, appelle `dsp_irq_dispatch`, puis efface le signal |
| 1 | `0x109290` | **le jeu** | Efface le signal, puis `dsp_SetSemaphore` avec le masque rangé à `0x109294` |
| 2 | `0x10928c` | `interrupt_manager_stop`, à l'arrêt du module | Efface le signal et termine le fil |

**Ce que le DSP peut signaler.** `dsp_irq_dispatch` (`0x10117c`) fabrique un mot de 19 sources :

- les bits 0 à 15 sont le registre `0x1ED0301C` (le sémaphore que le DSP lève) ;
- les bits 16 à 18 sont les bits 10 à 12 de `0x1ED0300C` : « le registre de réponse 0, 1 ou 2 contient un mot ».

Il n'en garde que les sources écoutées (le mot `+0x68` du contexte), retire celles déjà annoncées (`0x10903c`), et appelle pour chacune la fonction inscrite dans le contexte. Il recommence tant qu'il reste quelque chose.

| Source | Fonction appelée | Adresse | Branchée par |
| --- | --- | --- | --- |
| bit 15 (sémaphore) et bit 18 (réponse 2) | `pipe_interrupt_hook` | `0x106648` | LoadComponent, toujours |
| bit 16 (réponse 0) | `on_reply0_interrupt` | `0x105ca0` | RegisterInterruptEvents, type 0 |
| bit 17 (réponse 1) | `on_reply1_interrupt` | `0x105ce4` | RegisterInterruptEvents, type 1 |

Brancher une source (`process_set_irq_hook`, `0x10410c`) change aussi le matériel : les bits 16 à 18 lèvent les bits 9 à 11 de `0x1ED03008`, les bits 0 à 15 baissent les mêmes bits de `0x1ED03014`.

Les sources 16 et 17 ne sont annoncées qu'une fois : leur bit reste dans `0x10903c` jusqu'à ce que le jeu lise le registre par RecvData.

**RegisterInterruptEvents (commande 21)** reçoit un type, un canal et la poignée d'un signal créé par le jeu. `interrupt_event_register` (`0x105bb8`) :

- calcule un rang : 0 pour le type 0, 1 pour le type 1, `2 + canal` pour le type 2 ;
- prend la première case libre parmi **six** (les poignées sont à `0x10a2d0`, les cases prises dans les bits de `0x109010`) et note à `0x10a2a8 + rang × 4` quelle case sert ce rang ;
- plus de case libre : `0xC860A7FF` ;
- poignée nulle : la case de ce rang est libérée et son signal fermé.

Pour les types 0 et 1, `reply_irq_set_hook` (`0x10685c`) branche ou débranche en plus la source 16 ou 17, mais seulement si un composant est déjà chargé. Pour le type 2, rien d'autre : l'écoute des tuyaux est déjà en place.

**Le chemin d'un message du DSP jusqu'au jeu**, pour un tuyau :

1. Le DSP dépose `canal × 2 + sens` dans le registre de réponse 2 et lève l'interruption.
2. Le noyau déclenche le signal `0x109288` ; le fil se réveille et appelle `dsp_irq_dispatch`.
3. La source 18 est levée : `pipe_interrupt_hook` écrit `0x8000` dans `0x1ED03018`, puis lit le registre de réponse 2 tant qu'il contient un mot.
4. Le tout premier mot après le démarrage est l'adresse de la table des tuyaux (partie 6). Les suivants désignent un tuyau.
5. Pour les canaux 1 à 7, `pipe_signal_client_event` (`0x105b68`) regarde si le jeu a inscrit un signal pour ce canal ; si oui, et si le sens vaut 0, `svcSignalEvent`.
6. Dans tous les cas, l'événement interne `0x109024` est déclenché : les fils endormis dans `pipe_read` ou `pipe_write` repartent.

Les signaux des jeux ne sont déclenchés qu'à trois endroits du module : `pipe_signal_client_event`, `on_reply0_interrupt` et `on_reply1_interrupt`.

**Comment `dsp` apprend que le DSP a fini une trame.** Le module ne sait pas ce qu'est une trame. Il sait seulement que le DSP a écrit le numéro d'un tuyau dans le registre de réponse 2. Si le jeu a inscrit un signal pour le canal 2, type 2, ce signal se déclenche chaque fois que le DSP annonce avoir écrit dans le tuyau 2. Que le DSP le fasse une fois par trame de son relève du composant, pas de `dsp`.

**Le sémaphore**, c'est le chemin inverse : de quoi réveiller le DSP.

| Commande | Ce que le code fait |
| --- | --- |
| SetSemaphore (7) | Attend en boucle que `0x1ED03010` relise 0, puis y écrit la valeur |
| GetSemaphore (8) | Lit `0x1ED0301C` |
| ClearSemaphore (9) | Écrit le masque dans `0x1ED03018` |
| MaskSemaphore (10) | Écrit le masque dans `0x1ED03014` |
| CheckSemaphoreRequest (11) | Rend le bit 9 de `0x1ED0300C` |
| GetSemaphoreEventHandle (22) | Rend la poignée du signal `0x109290` |
| SetSemaphoreMask (23) | Range 16 bits à `0x109294`, sans toucher au matériel |

Le jeu demande donc une fois le signal (22), donne une fois le masque (23), puis à chaque fois qu'il veut réveiller le DSP il déclenche lui-même le signal, sans envoyer de message. Le fil des interruptions fait alors le SetSemaphore à sa place. C'est le même tour que dans `gsp` : un signal coûte moins cher qu'une commande.

## Partie 8 : les registres du matériel

Le code ne touche qu'à deux pages de registres, celles que l'exheader fait projeter. Les noms courts de la première colonne sont les miens.

**Le DSP, page `0x1ED03000`** (mots de 16 bits) :

| Registre | Nom | Qui y touche | Ce que le code en fait |
| --- | --- | --- | --- |
| `0x1ED03000` | donnée | `dsp_SendFifoEx`, `dsp_RecvFifoEx` | Le mot transféré |
| `0x1ED03004` | adresse | les deux mêmes | L'adresse en mots, avant un transfert |
| `0x1ED03008` | réglage | presque toutes | Bit 0 : levé pour arrêter le DSP, baissé pour le lancer. Bit 1 : choisi par les drapeaux d'un transfert. Bits 2 et 3 : longueur d'une lecture (0, 1 ou 2). Bit 4 : levé pendant une lecture. Bits 9 à 11 : écoute des registres de réponse 0 à 2. Bits 12 à 15 : premier argument d'un transfert |
| `0x1ED0300C` | état | lu seulement | Bit 1 et bit 8 : attendus à la fin d'une écriture. Bit 2 : attendu après un arrêt. Bit 6 : un mot est prêt à lire. Bit 7 : l'écriture doit attendre. Bit 9 : CheckSemaphoreRequest. Bits 10 à 12 : réponse 0 à 2 pleine. Bits 13 à 15 : commande 0 à 2 pas encore lue |
| `0x1ED03010` | sémaphore vers le DSP | `dsp_SetSemaphore`, `dsp_hw_release_reset` | La valeur de SetSemaphore ; 0 au démarrage |
| `0x1ED03014` | masque | `dsp_MaskSemaphore`, `process_set_irq_hook`, `dsp_boot` | Un bit baissé par source de sémaphore écoutée |
| `0x1ED03018` | effacement | `dsp_ClearSemaphore`, `dsp_hw_release_reset` | `0xFFFF` au démarrage, `0x8000` à chaque message de tuyau |
| `0x1ED0301C` | sémaphore venu du DSP | `dsp_GetSemaphore`, `dsp_irq_dispatch` | Lu seulement |
| `0x1ED03020`, `0x1ED03028`, `0x1ED03030` | commande 0, 1, 2 | `dsp_SendData` | Écrits |
| `0x1ED03024`, `0x1ED0302C`, `0x1ED03034` | réponse 0, 1, 2 | `dsp_RecvData` | Lus |

Après la plupart des écritures dans cette page, le code appelle `delay_loop` (`0x103e68`) avec `0x60` : une boucle vide.

**Les blocs de mémoire, page `0x1EC40000`** (octets) : `0x1EC40000` à `0x1EC40007` pour le programme, `0x1EC40008` à `0x1EC4000F` pour les données. Les bits sont décrits dans la partie 5.

**Une page que tout le monde lit.** `panic_on_failure` (`0x10454c`) lit le bit 0 de `0x1FF80014` pour décider s'il s'arrête sur une erreur.

## Partie 9 : les services que dsp appelle

Chaque requête a sa petite fonction, qui écrit un en-tête et appelle `SendSyncRequest`. Il y en a 21, autant que d'appels à `SendSyncRequest` dans le code. Les noms viennent de 3dbrew quand il en donne.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x1090bc` | `0x00010002` | `SRV_RegisterClient` | `0x100e68` | Se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x100ea4` | Obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x100a14` | Créer `dsp::DSP` |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x100a70` | Le retirer à l'arrêt |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x101268` | Ouvrir les cinq services ci-dessous |
| | | `0x00090040` | `SRV_Subscribe` | `0x1045e0` | S'abonner à `0x104` et `0x105` |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x100ee0` | Lire le numéro de la notification arrivée |
| `pdn:d` | `0x1090a0` | `0x000100C0` | `PDND_Control` | `0x103ef0` | Trois octets ; voir plus bas |
| `cdc:DSP` | `0x109004` | `0x00010042` | `CDCDSP_cmd0001` | `0x106c80` | Relais de SetIirFilterI2S1 |
| | | `0x00020042` | `CDCDSP_cmd0002` | `0x106cc0` | Relais de SetIirFilterI2S2 |
| | | `0x00030082` | `CDCDSP_cmd0003` | `0x106bcc` | Relais de SetIirFilterEQ |
| | | `0x000400C0` | `CDCDSP_cmd0004` | `0x106c18` | Relais de ReadMultiEx_SPI2 (`0x40` octets au plus) |
| | | `0x000500C2` | `CDCDSP_cmd0005` | `0x106d00` | Relais de WriteMultiEx_SPI2 |
| | | `0x00060000` | `CDCDSP_cmd0006` | `0x106d5c` | Relais de GetHeadphoneStatus |
| | | `0x00070040` | `CDCDSP_cmd0007` | `0x1042f8` | 1 au chargement du composant, 0 au déchargement |
| | | `0x00080040` | `CDCDSP_cmd0008` | `0x1042c0` | Relais de ForceHeadphoneOut ; 1 au chargement et au déchargement |
| `ptm:s` | `0x10910c` | `0x040A0000` | `PTMSYSM_CheckNew3DS` | `0x1016e4` | Savoir si la console est une New 3DS |
| | | `0x04030042` | `PTMSYSM_NotifySleepPreparationComplete` | `0x106b7c` | Dire à `ptm` que `dsp` est prêt pour la veille ou réveillé |
| `cfg:s` | `0x1090cc` | `0x04010082` | `CFG_GetConfigInfoBlk8` | `0x1048cc` | Lire le bloc `0x00070000` pour le segment spécial |
| `ps:ps` | `0x1090a8` | `0x00020244` | `PS_VerifyRsaSha256` | `0x102e08` | Vérifier la signature du composant |
| `err:f` (port) | `0x109078` | `0x00010800` | `ERRF_Throw` | `0x101adc` | Signaler une erreur fatale |

`cfg:s` et `ps:ps` ne sont ouverts que le temps de LoadComponent, puis refermés.

**Les trois octets de `PDND_Control`**, dans l'ordre où le code les envoie :

| Moment | Fonction | Requêtes |
| --- | --- | --- |
| Initialisation du module | `dsp_hw_power_init` (`0x101070`) | (1, 1, 1) puis (0, 0, 0), avant l'ouverture de `pdn:d` |
| Démarrage du DSP | `dsp_hw_power_up_and_reset` (`0x10735c`) | (0, 1, 0), (1, 1, 0), (1, 1, 1) |
| Arrêt du DSP | `dsp_hw_power_down` (`0x103ec8`) | (1, 1, 0) puis (0, 1, 0) |

**Deux écarts avec la Carte des services.**
- Elle ne compte que `cdc:DSP` et `pdn:d` parmi les services que `dsp` appelle. Le code ouvre aussi `ptm:s`, `cfg:s` et `ps:ps`, et l'exheader autorise exactement ces cinq noms.
- Pour `cdc:DSP`, elle donne `0x00040042` et `0x00060080` aux commandes 4 et 6. Le code envoie `0x000400C0` et `0x00060000`.

## Partie 10 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x109000` | 1 quand le DSP tourne (0 pendant la veille) |
| `0x109001` | 1 quand un composant est chargé : ce que rend GetIsDspOccupied |
| `0x109002` | 2 sur une New 3DS, 0 sinon |
| `0x109004`, `0x109008` | la poignée de `cdc:DSP`, en deux exemplaires |
| `0x10900c` | le numéro du fil qui a chargé le composant, `0xFFFFFFFF` si personne |
| `0x109010` | les six cases de signaux, un bit chacune |
| `0x109014`, `0x109018` | le pointeur vers le nom `dsp::DSP` et l'adresse de `dsp_session_thread_main` |
| `0x10901c` | les quatre cases de fils de session, un bit chacune |
| `0x109020` | l'adresse de la table des tuyaux, en octets ; 0 tant que le DSP ne l'a pas donnée |
| `0x109024` | l'événement interne « le DSP a parlé d'un tuyau » |
| `0x10902c`, `0x10902e` | `0x1ED03008` et `0x1ED03014` mis de côté pendant la veille |
| `0x109030` | la liste des contextes chargés (un seul en pratique) |
| `0x109034` | le mot des sources écoutées, mis de côté pendant la veille |
| `0x10903c` | les sources 16 et 17 déjà annoncées |
| `0x109054`, `0x109060`, `0x10906c` | trois tables de trois fonctions, par rang de mémoire : adresse de base, propriétaire d'un bloc, mise en service d'un bloc |
| `0x109260`, `0x10926c` | le verrou d'état et le verrou des commandes du codec |
| `0x109278` | le gestionnaire d'interruptions (détail plus bas) |
| `0x10a2a8` | pour chaque rang (type 0, type 1, canaux 0 à 7), la case de signal qui le sert, `0xFFFFFFFF` si aucune |
| `0x10a2d0` | les six poignées de signaux des jeux |
| `0x10a2e8` | le contexte du composant (détail plus bas) |
| `0x10a438` | le tampon de réception des commandes 5, 13 et 30, `0x100` octets |
| `0x10a538` | le tampon de réponse des commandes 6, 14 et 16, `0x200` octets |
| `0x10a738` | le tampon de réponse de la commande 29, `0x40` octets |
| `0x10a778`, `0x10a78c`, `0x10a79c` | les trois gestionnaires de notifications |
| `0x10a7ac` | les quatre fils de session, 8 octets chacun |
| `0x10a7d0` à `0x10c7d0` | les piles des quatre fils de session, `0x800` octets chacune |
| `0x10c7d0`, `0x10c7f0` | pour chaque canal, la fonction de rappel et son argument |
| `0x10c810` | une copie des 16 fiches de tuyaux, `0xA0` octets |
| `0x10c8b0` | la clé RSA en cours de vérification : module, exposant, nombre de bits à `+0x200` |
| `0x10cab8` | la copie des `0x300` premiers octets du composant |
| `0x10cdb8` | le verrou des transferts mot par mot |
| `0x10cdc4` | l'état connu des blocs de mémoire : 3 rangs de 8 mots de 16 bits |

Le contexte du composant (`0x10a2e8`, `0x150` octets) :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | le contexte suivant dans la liste |
| `+0x04` | le nom, `synthe` |
| `+0x14` | pendant le chargement, le pointeur vers le composant reçu |
| `+0x18`, `+0x1A` | les deux masques envoyés par le jeu |
| `+0x1C` | bit 0 : attendre trois réponses au démarrage |
| `+0x20`, `+0x24` | les blocs pris, programme puis données, un bit chacun |
| `+0x28`, `+0x48` | pour chaque place, le numéro du bloc qui l'occupe (programme, données) |
| `+0x68` | le mot des sources écoutées |
| `+0x6C` | 19 fonctions, une par source |
| `+0xB8` | 19 arguments |
| `+0x104` | 19 masques : les sources servies par la même fonction |

Le gestionnaire d'interruptions (`0x109278`) :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | son verrou |
| `+0x0C` | la fonction à appeler à chaque interruption : `dsp_irq_dispatch` |
| `+0x10` | le signal lié à l'interruption `0x4A` |
| `+0x14` | le signal d'arrêt |
| `+0x18` | le signal du sémaphore, celui que reçoit le jeu |
| `+0x1C` | le masque du sémaphore |
| `+0x20` | le fil |
| `+0x28` | sa pile, `0x1000` octets |
| `+0x1028` | 1 quand le gestionnaire est en marche |

## Partie 11 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x101108` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x1048c4` |
| CreateThread | `0x08` | `svcCreateThread` | `0x1015f4` |
| ExitThread | `0x09` | `svcExitThread` | `0x1018dc` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x101b48` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x103e78` |
| SignalEvent | `0x18` | sur place, à quatre endroits : les trois fonctions de la partie 7 et `interrupt_manager_stop` | |
| ClearEvent | `0x19` | trois fois dans `interrupt_thread_main` | `0x101730` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x1010f0` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x103d34` |
| CloseHandle | `0x23` | écrit sur place, à 27 endroits | |
| WaitSynchronization1 | `0x24` | écrit sur place, à six endroits | |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x1045bc` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x1029ac` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x101618` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x104228` |
| SendSyncRequest | `0x32` | écrit sur place, à 21 endroits | |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x1018e4` |
| GetThreadId | `0x37` | `svcGetThreadId` | `0x1031a4` |
| Break | `0x3C` | une seule fois, à `0x101b40`, atteint par `break_process` (`0x1041c0`) | |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x1006dc` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x1029c4` |
| BindInterrupt | `0x50` | `svcBindInterrupt` | `0x101888` |
| UnbindInterrupt | `0x51` | `svcUnbindInterrupt` | `0x1018fc` |
| InvalidateProcessDataCache | `0x52` | deux fois dans `dsp_InvalidateDCache` | `0x1065bc` |
| FlushProcessDataCache | `0x54` | dans `dsp_FlushDataCache`, et deux fois dans `component_load_and_boot` | |

Les 26 appels sont tous autorisés par l'exheader. `dsp` n'a ni tas ni mémoire partagée : ni `ControlMemory`, ni `CreateMemoryBlock`. Tout ce qu'il partage avec le jeu passe par la mémoire du DSP elle-même.

Les verrous (`lock_enter` à `0x1043d0`, `lock_leave` à `0x1042a0`) et les événements internes (`gate_wait` à `0x103d6c`, `light_event_signal` à `0x102abc`) reposent sur `ArbitrateAddress`, comme dans les autres modules.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 32 commandes servies, leur fonction et leur en-tête de réponse : le pseudo-code de REA d'un côté ; de l'autre la table de 34 adresses lue à la main à `0x104b48` et les constantes rangées après l'aiguillage (`0x105468` à `0x105524`).
- Les 10 en-têtes de requête que le code vérifie en entier sont ceux de 3dbrew.
- L'absence de la commande 25 : le pseudo-code n'a pas de cas 25, et la case 25 de la table vaut `0x105458`, comme la case 0.
- La disposition de l'en-tête d'un composant : lue dans `component_verify_and_copy`, puis appliquée au `dspaudio.cdc` de Pokémon X, où la taille, le nombre de segments et les six SHA-256 retombent juste.
- La clé publique à `0x10812c`, l'exposant `0x10001` et la plage signée (`0x100` à `0x300`) : lus dans le code, puis vérifiés par le calcul sur la signature du même fichier.
- La taille du segment spécial : `0x214` dans l'appel à `cfg:s`, `0x214` dans l'en-tête du composant de Pokémon X.
- L'interruption `0x4A` : le seul appel à `svcBindInterrupt`, et le seul numéro de l'exheader.
- Les pages de registres et la mémoire du DSP : toutes les adresses relevées dans le code tombent dans les trois plages que l'exheader fait projeter.
- La formule de la commande 12 : avec le bloc *n* à la place *n*, elle donne le « (adresse × 2) + `0x1FF40000` » de 3dbrew.
- Les six cases de signaux : la boucle de `interrupt_event_register` s'arrête à 6, et 3dbrew dit que `dsp` tient six inscriptions au plus.
- Le sens des tuyaux : le sens 0 fait avancer la position de lecture et le sens 1 celle d'écriture dans `pipe_commit_position` ; 3dbrew dit « 0 = depuis le DSP, 1 = depuis l'ARM ».
- Le cache : seule la commande 20 accepte la mémoire du DSP, dans le code comme sur 3dbrew.
- Le relais vers `cdc:DSP` : les commandes 26 à 32 appellent les requêtes 1 à 6 et 8, ce que disent aussi les notes de 3dbrew.
- Les services appelés : l'exheader autorise cinq noms, et ce sont les cinq que le code ouvre. Les 21 fonctions de requête correspondent aux 21 appels à `SendSyncRequest`.
- Les fils : `svcCreateThread` n'est appelé qu'à un endroit, `create_thread` à deux, et l'adresse de chaque fonction de fil n'apparaît qu'une fois dans le module.
- Les 26 appels système sont dans la liste que l'exheader autorise.
- Le nom `synthe` : dans le code à `0x105ec8`, et cité par 3dbrew à propos de LoadComponent.
- Les 13 commandes que Pokémon X envoie : la fonction d'envoi du jeu, l'aiguillage de ce module, et les mots relevés en exécutant les fonctions du jeu dans un émulateur ([contrat de `dsp::DSP`](contrat-dsp.md)). Le jeu charge bien `rom:/sound/dspaudio.cdc`, avec les masques `0xFF` et `0xFF` ; il garde dans son code un second composant, à `0x5dbc88`, que le chemin lu n'envoie pas.
- Le signal du rang 1 est déclenché par le jeu : deux `svcSignalEvent` sur la poignée reçue de GetSemaphoreEventHandle (`0x148e3c` et `0x18b604` dans le jeu). Une fois le son démarré, la boucle de son du jeu n'envoie plus aucune commande : tout passe par ce signal, celui du canal 2 et la mémoire partagée.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens des registres. La partie 8 dit ce que le code lit et écrit ; les mots « arrêter », « lancer », « écoute », « un mot est prêt » sont les miens. Je n'ai pas recoupé ces registres avec une documentation du matériel.
- Le bit 0 d'un registre de bloc vu comme « propriétaire » : le code le met à 0 avant de copier et à 1 avant de démarrer le DSP, rien de plus.
- Le découpage du contexte et du gestionnaire d'interruptions (partie 10).
- La mécanique des positions d'un tuyau (15 bits et un bit de tour). Elle est lue dans le code, mais sur des fonctions où Ghidra mélange les variables : à relire.
- « Une trame de son » : le module relaie un message du DSP sur le tuyau 2, je n'ai rien lu qui dise à quel rythme il arrive.
- Le sens des trois octets de `PDND_Control` et celui des requêtes 7 et 8 de `cdc:DSP`. Je donne les valeurs envoyées, pas ce qu'elles commandent.
- La retouche des données des canaux 2 et 3 par le mot `0x109002`. Je vois l'écriture, pas ce que le DSP en fait.
- Le sens des codes d'erreur : `0xD8E0A7EA` (composant refusé), `0xD8E0A7EE` (bloc non obtenu), `0xC860A7FF` (plus de case de signal), `0xC8A0A401` (pas de composant), `0xE0E3FFF6` (adresse hors du tas linéaire).
- Les priorités des fils. Le code passe des constantes codées (`0x6C8DA518` pour une session, `0x6C8DA50A` pour les interruptions) qu'une addition ramène à `0x18` et `0x0A`.
- Les deux requêtes à `pdn:d` envoyées avant l'ouverture du service.
- Le réveil après une veille : `on_sleep_wake_notification` relance le DSP par `dsp_boot` sans recopier le composant.
- La limite de 16 mots de `dsp_RecvFifoEx` et ce qu'elle implique pour une lecture de tuyau de plus de 32 octets. Pokémon X ne lit jamais plus de 32 octets à la fois : pour lui la question ne se pose pas.
- Les bits 10 à 12 de `0x1ED0300C` : ce module rend « prêt » quand le bit vaut 1, comme le dit la page RecvDataIsReady de 3dbrew ; sa page des registres dit l'inverse et semble se tromper (contrat de `dsp::DSP`, désaccords).
- `interrupt_event_register` accepte un rang de 0 à 10, alors que la table des rangs n'a que 10 cases : le rang 10 (type 2, canal 8) tombe sur la première poignée de signal.
- GetPhysicalAddress.

**Pas lu**
- La réserve de mémoire (`0x101c38`, `0x101c9c`, `0x101dd8`, `0x101f6c`) et les deux plages d'adresses préparées au démarrage (`0x100d68`, `0x100dd0`).
- La fonction `0x100688` et ses deux aides (`0x100b60`, `0x100ba8`), les fonctions `0x100048` et `0x1000c0`.
- Le corps des fonctions de copie (`memcpy`, `memcpy_words`, `memcpy_unaligned`) et de `sha256_transform` : nommées d'après leur début et d'après ce que leurs appelants en font.
- Le chemin lent des verrous (`0x101b54`) et l'attente sur plus de dix poignées (`0x101d00`, `0x101b14`).
- Le détail des 25 fonctions d'initialisation des objets globaux : parcourues, pas nommées.
- 88 fonctions de Ghidra restent sans nom, plus les 13 qu'il a manquées.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système, nommer leurs enveloppes, trouver les fonctions manquées | `outils/prescan.py`, deux passages | une à deux minutes par passage |
| Décompiler toutes les fonctions d'un coup | `prescan.py --dump` | quelques secondes |
| Calculer qui appelle qui, lire la table d'aiguillage, relever les constantes | des scripts Python sur `code.bin` | immédiat |
| Lire le pseudo-code et l'assembleur, nommer | Claude | le gros du temps |
| Recharger les noms dans Ghidra | arrêt et relance du pont REA | une à deux minutes, deux fois |
| Recouper avec la Carte des services et l'exheader | un script | immédiat |
| Relire le composant de Pokémon X et sa signature | deux scripts | immédiat |

**Les pièges rencontrés.**
- Ghidra avait manqué 58 fonctions : il est passé de 216 à 274. Ce sont les fonctions de fil, les fonctions de rappel des tuyaux et des interruptions, et les 25 fonctions d'initialisation.
- Deux morceaux de code ne sont atteints que par un saut depuis une fonction très courte : le vrai corps de `SRV_GetServiceHandle` (`0x101268`) et celui de l'arrêt des interruptions (`0x101480`). Ghidra les collait à la fonction qui saute. Je les ai ajoutés à la main dans le fichier de noms : 276 fonctions.
- `prescan.py` avait nommé `SRV_Subscribe` « `svcSendSyncRequest` » : la fonction est courte et ne contient qu'un appel système, il l'a prise pour une enveloppe. Corrigé dans le fichier de noms. Ici `svcExitProcess` est par contre une vraie enveloppe.
- Quand une fonction fait un appel système sur place, Ghidra perd les registres. Les commandes 19 et 20, les deux `FlushProcessDataCache` du chargement et les arguments de `PDND_Control` ont été lus dans l'assembleur.
- Le pseudo-code de `dsp_handle_command` ne montre pas la retouche des canaux 2 et 3 comme une étape à part, et réduit `dsp_WriteProcessPipe` à un appel sans arguments : là aussi, l'assembleur (`0x104f18`).

**Trois choses à savoir en relisant dans Ghidra.**
- `run_static_initializers` (`0x100184`) est en Thumb. Sa ligne du fichier de noms est une ligne `label`, et le nom a pris.
- Ghidra crée parfois deux fonctions pour une seule, quand une entrée tombe quelques octets après l'autre : `0x106fdc` et `0x106fe0` (`sha256_update`), `0x1041bc` et `0x1041c0` (`break_process`), `0x10476c` et `0x10477c` (`init_runtime_and_srv` continue dans `srv_init`).
- Les fonctions en `dsp_` suivies d'un nom de 3dbrew sont le travail d'une commande, mais plusieurs servent aussi à l'intérieur du module : `dsp_RecvData` et `dsp_SendData` sont appelées par le démarrage, par l'arrêt et par les tuyaux.

**Pour reprendre.** `dsp.noms.tsv` est le fichier de graines : une adresse, `function` ou `label`, un nom. Les noms en `dsp_` suivis d'une majuscule sont les commandes que `dsp` reçoit ; ceux en `pipe_` les tuyaux ; ceux en `component_` et `process_` le chargement ; ceux en `dsp_hw_` les gestes sur le matériel ; ceux en majuscules (`SRV_`, `PDND_`, `CDCDSP_`…) les requêtes qu'il envoie à un autre service. Le pseudo-code brut et les scripts (`idx.py`, `svc.py`, `make_tsv.py`, `check_component.py`, `check_signature.py`) sont dans `local/analyse/dsp/`, non versionné.
