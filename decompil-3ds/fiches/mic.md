# mic, le microphone

`mic` pilote le microphone de la console. Un seul client à la fois lui demande de mettre le micro sous tension, de régler son gain, puis de remplir une page de mémoire partagée avec des échantillons de son : le module lit le matériel lui-même, par un registre à `0x1EC62000` et une interruption, convertit les échantillons dans le format demandé et les range dans la page du client. Ni DMA ni second processus de son : tout passe par un fil de lecture du module.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), un aiguillage rejoué par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de la page de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000002002`, un titre de la CTRNAND (lu dans l'exheader ; nom `mic`) |
| Fichier lu | `local/extrait/mic/exefs/code.bin` et `exheader.bin` |
| Taille | 18 600 octets de code (`0x48a8`), 704 de données en lecture seule (`0x2c0`), 228 de données (`0xe4`), 3 828 de mémoire à zéro (`0xef4`) ; pile de 4 096 octets ; priorité de départ 40 |
| Fonctions | 179, dont 117 nommées dans `mic.noms.tsv` (8 en Thumb, 171 en ARM) |
| Services offerts | `mic:u`, une seule session à la fois (voir la partie 2) |
| Services appelés | `cdc:MIC` (le codec du micro), `ptm:s`, plus `srv:` et le port `err:f`. L'exheader en déclare deux, `cdc:MIC` et `ptm:s` ; le code en ouvre bien deux, plus `srv:` qui n'a pas besoin d'être déclaré |
| Autres accès | la page matérielle `0x1EC62000` (descripteur `0xFFE1EC62` de l'exheader) ; l'interruption `0x5A` (la seule déclarée dans l'exheader, et liée par le code) |
| Dépendances déclarées | aucune (la liste de l'exheader est vide) |
| Fils | le fil principal (serveur), un fil de lecture du micro (priorité 8), et un fil de courte durée qui laisse passer une seconde de silence après la mise sous tension (priorité 8) |

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle cinq fonctions, puis `call_mic_main`, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de `0x1060e8` à `0x106fd8`.
2. `0x1001a8` (non nommée) prépare un petit contexte de bibliothèque.
3. `init_runtime_and_srv` (`0x102710`) : `init_runtime` (`0x100aac`, verrous, trois réserves d'adresses virtuelles, enregistrement du processus), puis `srv_init` (`0x102720`) qui se connecte au port `srv:` (en réessayant toutes les 500 000 ns tant que le port n'existe pas) et envoie `SRV_RegisterClient`.
4. `setup_heap` (`0x100208`) réserve un tas à `0x08000000` (de la taille donnée par l'exheader) par `svcControlMemory`.
5. `run_static_initializers` (`0x100110`, Thumb) appelle les constructeurs de la table de distances de `0x100118`.
6. `run_init_array` (`0x100174`), vide ici.
7. `call_mic_main` (`0x100164`) appelle `mic_main` (`0x10034c`, 1 428 octets) : tout le reste. Voir la partie 2.

## Partie 2 : la boucle de serveur

Un seul fil sert les commandes. `mic_main` fait, dans l'ordre :

1. **Les noms.** `SRV_RegisterService` (`0x101040`) crée `mic:u` auprès de `sm`. Le nom est à `0x105120` et le nombre de sessions au plus vaut **1** (octet à `0x10507c`) : c'est le « un seul processus à la fois » de 3dbrew. Le port rendu va dans le deuxième emplacement du tableau de poignées (`0x106fd0`).
2. **`ptm:s`.** `ptm_open` (`0x100eac`) ouvre le service (nom à `0x105135`).
3. **Les notifications.** Six objets de notification sont inscrits par `register_notification_handler` (`0x102540`), un par numéro (`0x214`, `0x213`, `0x100`, `0x104`, `0x105`, `0x106`). Chacun contient un pointeur de fonction membre (adresse et décalage) lu dans la table de `0x10503c`.
4. **Le micro.** `mic_initialize` (`0x100b0c`), partie 4 : événements, liaison de l'interruption, fil de lecture, ouverture de `cdc:MIC`.
5. **L'abonnement.** `SRV_EnableNotification` (`0x1013c4`) rend le sémaphore des notifications (premier emplacement du tableau, `0x106fcc`), puis `SRV_Subscribe` (`0x102508`, en-tête `0x00090040`) pour `0x104`, `0x105`, `0x106`, `0x213` et `0x214`. Le `0x100` n'est pas demandé : il est inscrit mais jamais abonné (`sm` l'envoie à tous).
6. **L'attente.** La boucle appelle `svcReplyAndReceive` (`0x10095c`, seul appelant : `mic_main`) sur le tableau de poignées (2 au départ : le sémaphore et le port ; 3 quand une session est ouverte), avec la poignée de la session pour y répondre.
   - Indice 0, le sémaphore : `handle_srv_notification` (`0x100f48`) lit le numéro (`SRV_ReceiveNotification`, `0x101400`) et appelle le gestionnaire inscrit.
   - Indice 1, le port : `svcAcceptSession` (`0x100944`). S'il y a déjà une session, la nouvelle est refermée aussitôt (c'est ce qui fait respecter la limite de 1) ; sinon elle est rangée avec son type (0) et son contexte (`0x106034`).
   - Indice 2 et plus, une session : l'aiguillage `(*(0x105040 + type*4))(contexte)`, soit `mic_handle_command` (`0x103810`).
7. **La fermeture d'une session** (résultat `0xC920181A`). Le module referme la poignée puis remet tout à l'état de départ : `mic_SetPower(0)`, `mic_SetGain(0x2b)`, l'octet `+6` à 0, `mic_StopSampling`, `mic_SetAllowShellClosed(0)`, `mic_UnmapSharedMem`, et deux octets d'état à leur valeur initiale (`+9` à 1, `+0xa` à 0). Un client qui part sans rien défaire laisse donc le micro éteint.
8. **La sortie.** Quand la notification `0x100` a mis l'octet `0x1060ac` à 1 et qu'il n'y a plus de session : `SRV_UnregisterService`, `mic_finalize` (`0x100cd8`, partie 4), fermeture de `ptm:s` et de `srv:`, retour.

| Notification | Gestionnaire | Adresse | Ce que fait le code |
| --- | --- | --- | --- |
| `0x100` | `on_terminate_notification` | `0x1047f4` | met l'octet d'arrêt `0x1060ac` à 1 |
| `0x104` | `on_sleep_notification` | `0x104838` | envoie `PTMSYSM_NotifySleepPreparationComplete` (`0x04030042`, réponse 0) à `ptm:s` |
| `0x105` | `on_wakeup_notification` | `0x104808` | met l'octet « silence » (`0x106003`) à 1, puis le même message à `ptm:s` |
| `0x106` | `start_power_on_mute` | `0x101efc` (par un `nop` à `0x101ef8`) | lance la seconde de silence (partie 4) |
| `0x213` | `on_shell_opened` | `0x103e44` | si le client n'a pas demandé « couvercle fermé permis », remet l'octet `+7` à 0 et, si le micro enregistrait avant la fermeture (`+6`), le relance au même rythme |
| `0x214` | `on_shell_closed` | `0x103e8c` | mêmes conditions : retient dans `+6` si le micro enregistrait, arrête le matériel, met `+7` à 1 |

Le sens de ces numéros est celui des fiches de [ptm](ptm.md) (`0x104` à `0x106` : la veille et le réveil) et de [hid](hid.md) (`0x213` ouvert, `0x214` fermé) ; ici le code ne fait que les traiter.

## Partie 3 : les commandes

`mic_handle_command` (`0x103810`, 652 octets) lit l'en-tête dans le tampon du fil, prend le numéro dans les 16 bits du haut, et saute à l'un de 16 cas. Un numéro inconnu rend l'en-tête `0x00000040` et `0xD900182F`. Les noms et les en-têtes de requête viennent de 3dbrew ; l'adresse, les vérifications et l'en-tête de réponse sont lus dans le code et recoupés par `emulate_dispatch.py`.

Le code ne compare **l'en-tête entier** que pour deux commandes : la 1 (avec le descripteur « copie de poignée », mot 2 à zéro) et la 12 (avec le descripteur de tampon en lecture, `mot 2 & 0xF == 0xA`). Pour les 14 autres, seul le numéro compte. Un en-tête faux rend la réponse `0x00000040` et `0xD9001830`. Il n'y a **aucune** vérification du type de session : un seul service, un seul type.

| N° | En-tête de requête | Commande (3dbrew) | Fonction | Adresse | En-tête de réponse | Ce que le code vérifie, ce qu'il lit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x00010042` | MapSharedMem | `mic_MapSharedMem` | `0x103d54` | `0x00010040` | déjà projeté : `0xD8208FF9` ; taille impaire : `0xE0E08FF2` ; taille nulle : `0xE0E08FEC` ; taille non multiple de `0x1000` : `0xE0E01BF2` (dans `map_shared_memory`). Mot 1 : taille. Mot 3 : poignée du bloc |
| 2 | `0x00020000` | UnmapSharedMem | `mic_UnmapSharedMem` | `0x1023e4` | `0x00020040` | pas projeté : `0xD8208FF8`. Ne regarde pas si le micro enregistre |
| 3 | `0x00030140` | StartSampling | `mic_StartSampling` | `0x103b84` | `0x00030040` | pas projeté : `0xD8208FF8` ; couvercle fermé (`+7`) : `0xC9408C01` ; décalage + taille plus grand que la page moins 4 : `0xE1008FFD`. Mots 1 à 5 : codage (octet), cadence (octet), décalage, taille, boucle (octet) |
| 4 | `0x00040040` | AdjustSampling | `mic_AdjustSampling` | `0x103cb0` | `0x00040040` | mêmes deux premières erreurs que StartSampling. Mot 1 : cadence (octet) |
| 5 | `0x00050000` | StopSampling | `mic_StopSampling` | `0x102444` | `0x00050040` | aucune ; rend toujours 0 |
| 6 | `0x00060000` | IsSampling | `mic_IsSampling` | `0x103b64` | `0x00060080` | aucune ; rend 0 et, au mot 2, le bit 15 du registre matériel (partie 5) |
| 7 | `0x00070000` | GetEventHandle | `mic_GetEventHandle` | `0x103ed0` | `0x00070042` | aucune ; rend 0, le descripteur `0x00000000` et la poignée de l'événement « tampon plein » (`0x106954`, créé en collant : reste levé jusqu'à ce que `StartSampling` le baisse) |
| 8 | `0x00080040` | SetGain | `mic_SetGain` | `0x102484` | `0x00080040` | aucune ; transmet l'octet à `cdc:MIC` (`0x00010040`), sous le verrou |
| 9 | `0x00090000` | GetGain | `mic_GetGain` | `0x103f08` | `0x00090080` | aucune ; interroge `cdc:MIC` (`0x00020000`) ; rend 0 et, au mot 2, l'octet |
| 10 | `0x000A0040` | SetPower | `mic_SetPower` | `0x1024bc` | `0x000A0040` | aucune ; transmet à `cdc:MIC` (`0x00030040`) ; si la valeur est non nulle et que cela a réussi, lance `start_power_on_mute` |
| 11 | `0x000B0000` | GetPower | `mic_GetPower` | `0x103b2c` | `0x000B0080` | aucune ; interroge `cdc:MIC` (`0x00040000`) ; rend 0 et l'octet |
| 12 | `0x000C0042` | SetIirFilterMic | `mic_SetIirFilterMic` | `0x103e04` | `0x000C0042` | en-tête entier et descripteur de tampon en lecture. Recopie le tampon vers `cdc:MIC` (`0x00050042`) tel quel : le module ne regarde ni sa taille ni son contenu |
| 13 | `0x000D0040` | SetClamp | `mic_SetClamp` | `0x103f80` | `0x000D0040` | aucune ; range l'octet en `0x106004` (« écrêter les échantillons ») |
| 14 | `0x000E0000` | GetClamp | `mic_GetClamp` | `0x103f40` | `0x000E0080` | aucune ; rend 0 et cet octet |
| 15 | `0x000F0040` | SetAllowShellClosed | `mic_SetAllowShellClosed` | `0x102430` | `0x000F0040` | aucune ; range l'octet en `0x106008` |
| 16 | `0x00100040` | sans nom dans la copie lue de 3dbrew (voir plus bas) | `mic_SetClientSDKVersion` | `0x103ee8` | `0x00100040` | aucune ; range en `0x106009` l'octet « la valeur reçue est nulle », soit 1 si le mot 1 vaut 0, 0 sinon |

Notes sur les cas :

- **Écrêtage (13, 14).** L'octet `+4` (valeur de départ 1) fait que le fil de lecture ramène chaque échantillon dans l'intervalle de −25 663 à 25 647 (`0x642f` en haut ; le bas est la constante `0xFFFF9BC1`). Mis à zéro, les échantillons passent tels quels.
- **Couvercle (15).** Tant que l'octet `+8` vaut 1, les notifications `0x213` et `0x214` ne font rien : le micro continue de s'enregistrer couvercle fermé. Sinon, couvercle fermé = le micro s'arrête et `StartSampling` refuse (`0xC9408C01`).
- **La commande 16.** La copie de 3dbrew lue (version du 17 mars 2018) décrit son effet (« si la valeur est 0, 1 est écrit dans un octet d'état, sinon 0 ») sans lui donner de nom. Le nom `SetClientSDKVersion` de ce fichier de noms est une proposition : le jeu l'envoie avec `0x050200c8`, qui a bien la forme d'un numéro de version du SDK (5.2.0). Voir « interprété ».
- **Le cas 12 est le seul** où le module lit un tampon que le client lui prête : le descripteur est transmis tel quel à `cdc:MIC`, c'est lui qui le lit.

Les résultats d'erreur propres au micro ont le module 35 (`0x23`) dans leur code ; `0xD900182F`, `0xD9001830`, `0xC920181A` et les trois que rend `map_shared_memory` (`0xE0E01BF2`, `0x08A01BF9`, `0xD8601837`) sont du module 6 (le noyau et ses interfaces de commandes).

## Partie 4 : StartSampling pas à pas, du bloc partagé à l'échantillon

C'est la séquence que fait Pokémon X (voir la partie 9) : ouvrir, projeter une page de `0x2000` octets, allumer, enregistrer.

**A. MapSharedMem.** Le client a créé un bloc de mémoire (perms lecture et écriture des deux côtés) et envoie sa taille S et la poignée.

1. `mic_MapSharedMem` (`0x103d54`) vérifie que rien n'est projeté (octet `+5` à `0x106005`), que S est paire et non nulle.
2. `map_shared_memory` (`0x10362c`) vérifie que S est un multiple de `0x1000`, demande à `vm_region_alloc` (`0x1037cc`) une adresse libre de la taille voulue dans la réserve d'adresses, et appelle `svcMapMemoryBlock` (`0x1f`) avec les perms 3 (lecture et écriture) des deux côtés.
3. Si la projection a réussi, l'objet à `0x106938` reçoit : taille du tampon `S − 4` (`+0x14`), adresse de base (`+4`), adresse du **mot de fin** (`+0`) égale à la base plus `S − 4`. Ce mot est mis à 0, et l'octet `+5` passe à 1.

**B. Allumer.** `SetGain` et `SetPower(1)` passent à `cdc:MIC`. Pour une valeur non nulle, `start_power_on_mute` (`0x101efc`) met l'octet `+3` à 1 (« silence »), arme un minuteur d'une seconde (`1 000 000 000` ns, constante `0x3b9aca00`) et crée un petit fil (`mute_timer_thread_main`, `0x1028b4`) qui attend ce minuteur puis remet `+3` à 0. Tant que `+3` vaut 1, `write_samples_to_buffer` écrit du silence au lieu du son (le zéro du codage : `0x80`, `0x8000` ou `0`). Le micro met donc une seconde à parler après sa mise sous tension.

**C. StartSampling** (`mic_StartSampling`, `0x103b84`) :

1. Vérifie la projection, puis que le couvercle n'est pas fermé (`+7`), puis `décalage + taille <= S − 4`.
2. Range dans l'objet `0x106938` : codage (`+0x19`), cadence (`+0x1a`), décalage de départ (`+0xc`), taille (`+0x10`), boucle (`+0x18`), curseur d'écriture à zéro (`+8`).
3. Baisse l'événement « tampon plein » (`svcClearEvent`), met le mot de fin à zéro.
4. Si `+9` (voir la commande 16) et le codage vaut 3 et la cadence 1 et la taille `0x5ffc`, lève `+0xa` : le chemin de lecture « ancien » avec correction de la dérive (partie 5).
5. **Poignée de main avec le fil de lecture.** L'octet `+2` (« arrêté ») passe à 1, l'événement du fil (`0x106018`) est signalé, `light_event_wait` (`0x101da8`) attend que le fil ait accusé réception (il le fait en arrêtant le matériel puis en ouvrant la barrière `0x10601c`, `light_event_signal`). Si le curseur est impair, il est reculé d'un.
6. `+2` repasse à 0 ; `light_event_clear` (`0x101a2c`) referme la barrière.
7. `mic_hw_start_sampling` (`0x101964`), qui est la seule écriture qui allume le matériel : le registre 16 bits à `0x1EC62000` est mis à `0xF002 | (cadence << 2)`, après avoir passé par `(reg & 0x1fff) | 0x1000`. Une cadence supérieure à 3 est refusée (le résultat `0xE0E003ED` est rendu à la fonction appelante, qui l'ignore). La fonction note aussi l'heure (`svcGetSystemTick`) et remet à zéro le compteur d'échantillons de l'objet matériel (`0x1060e8`).

**D. Le fil de lecture** (`sampling_thread_main`, `0x1011f8`, priorité 8) attend l'événement `0x106018`, que le noyau lève à chaque interruption `0x5A` (liée dans `mic_initialize` par `svcBindInterrupt(0x5a, événement, priorité 8, 0)`) et que `StartSampling` lève aussi pour la poignée de main. À chaque réveil :

1. S'il doit sortir (`+1`), il sort.
2. Si `+2` vaut 1 (arrêt demandé), il arrête le matériel (`mic_hw_stop_sampling`, `0x101d0c` : `(reg & 0x1fff) | 0x1000`), met `+6` à 0, baisse l'événement, ouvre la barrière.
3. Sinon il lit au plus 32 échantillons dans le FIFO du matériel et pas plus que ce qui reste dans le tampon. Il y a trois lecteurs : `read_fifo` (`0x102c40`), `read_fifo_legacy` (`0x102948`) et `read_fifo_legacy_timed` (`0x102a3c`). Le choix dépend de l'octet `+9` (valeur 0 : `read_fifo` ; valeur 1 : l'un des deux autres, selon `+0xa`). Pokémon X envoie une version non nulle, donc `+9` vaut 0 et c'est `read_fifo` qui travaille.
4. Si `+4` : écrêtage de chaque échantillon.
5. `write_samples_to_buffer` (`0x101564`) convertit et range.
6. S'il reste du travail (le lecteur a atteint son maximum), il boucle sans attendre.

**E. La conversion et le tampon** (`write_samples_to_buffer`, `0x101564`). Le matériel donne des échantillons de 16 bits signés. Selon le codage, l'octet ou le mot écrit à `base + décalage + curseur` est :

| Codage | Nom (3dbrew) | Octets par échantillon | Valeur écrite |
| --- | --- | --- | --- |
| 0 | PCM8 | 1 | `(s >> 8) ^ 0x80` |
| 1 | PCM16 | 2 | `s ^ 0x8000` |
| 2 | PCM8 signé | 1 | `s >> 8` |
| 3 | PCM16 signé | 2 | `s` |

(`s` est l'échantillon du matériel.) Le curseur avance du nombre d'octets écrits. Puis le **mot de fin**, quatre octets à `base + S − 4`, est mis à jour : le décalage (depuis la base de la page) du **dernier échantillon écrit**, c'est-à-dire `décalage + curseur − 1` pour un codage 8 bits, `décalage + curseur − 2` pour un codage 16 bits. Quand le curseur atteint la taille, le mot de fin désigne le dernier échantillon de l'anneau, l'événement « tampon plein » est signalé (`svcSignalEvent`), et :

- si `boucle` vaut 1, le curseur revient à 0 et l'enregistrement continue ;
- sinon `write_samples_to_buffer` rend 1 et le fil arrête le matériel (étape D2 sans passer par `StopSampling`).

C'est ce que 3dbrew appelle la fin « de l'audio actuel » : la page contient les échantillons de `0` à `S − 5`, suivis du mot de fin.

**F. Le format du tampon partagé** (page de `S` octets, projetée chez le client) :

| Décalage | Taille | Contenu |
| --- | --- | --- |
| `0x0000` | `S − 4` | échantillons, au codage de StartSampling, à partir de `décalage` et sur `taille` octets |
| `S − 4` | 4 | entier de 32 bits : décalage du dernier échantillon écrit (0 avant le premier) |

**G. StopSampling** met `+2` à 1, signale l'événement du fil, attend la barrière : le fil arrête le matériel et accuse réception. **AdjustSampling** fait la même poignée de main, change l'octet de cadence, puis rallume le matériel avec la nouvelle cadence. La cadence réelle est `(16 756 991 / 512) / (cadence + 1)` hertz, soit 32 730, 16 365, 10 910 ou 8 182 pour les valeurs 0 à 3 (formule de 3dbrew ; le code n'en retient que les deux bits à insérer dans le registre).

## Partie 5 : le matériel

Le module parle au micro par une page matérielle (`0x1EC62000`, projetée par le descripteur `0xFFE1EC62` de l'exheader) et l'interruption `0x5A`.

| Adresse | Largeur | Lu ou écrit par le module |
| --- | --- | --- |
| `0x1EC62000` | 16 bits | contrôle. Bit 15 : lu par `IsSampling` (`mic_hw_is_sampling`, `0x1019dc`). Bit 8 : tant qu'il est à 0, les lecteurs prennent un mot. Bit 11 : relevé dans les lecteurs, qui rallument alors l'enregistrement (`(reg & 0x7fff) | 0x9000`) ou l'arrêtent (`(reg & 0x1fff) | 0x1000`). Écritures : `0xF002 | cadence << 2` au départ, `(reg & 0x1fff) | 0x1000` à l'arrêt |
| `0x1EC62004` | 32 bits | FIFO : chaque lecture donne deux échantillons de 16 bits, le premier dans le mot de poids faible |

Le sens des bits est tiré de ce que fait le code (interprété, voir plus bas).

Le registre ne passe pas par `cdc:MIC` : `cdc:MIC` ne sert qu'à configurer le codec (gain, alimentation, filtre IIR). À l'initialisation, le module :

- ouvre `cdc:MIC` (`0x100b0c`, nom à `0x105000`) ;
- à la fermeture (`mic_finalize`, `0x100cd8`), il éteint (`SetPower(0)`), remet le gain à `0x2b` et renvoie à `cdc:MIC` un filtre IIR de 50 octets (`0x32`) pris dans la section en lecture seule à `0x105008`, que cette fiche ne recopie pas.

## Partie 6 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x106000` | l'état du module, un octet chacun : `+0` initialisé ; `+1` en cours de sortie ; `+2` arrêté (départ 1) ; `+3` silence (départ 1) ; `+4` écrêtage (départ 1) ; `+5` page projetée ; `+6` enregistrait avant la fermeture du couvercle ; `+7` couvercle fermé ; `+8` couvercle fermé permis ; `+9` commande 16 (départ 1) ; `+0xa` chemin « ancien » |
| `0x10600c`, `0x106010` | la poignée de `cdc:MIC` (deux copies) |
| `0x106014` | le minuteur de la seconde de silence |
| `0x106018` | l'événement lié à l'interruption `0x5A` (à remise à zéro automatique) |
| `0x10601c` | la barrière de poignée de main entre le serveur et le fil de lecture |
| `0x106024`, `0x10602c` | l'objet du fil de lecture, celui du fil de silence |
| `0x106034` | le contexte de session (un seul) |
| `0x106070` | la poignée de `srv:` |
| `0x10608c` | la poignée de `ptm:s` |
| `0x1060a0` | le nombre de poignées attendues (2 ou 3) ; `0x1060b0` leur table de contexte |
| `0x1060ac` | l'octet d'arrêt (notification `0x100`) |
| `0x1060e8` | l'objet « matériel » : heure de départ (`+8`, 64 bits), compteur d'échantillons (`+0x10`, 64 bits), mot en attente (`+0x18`) et son drapeau (`+0x1c`) |
| `0x106108` | le verrou récursif qui protège les commandes envoyées à `cdc:MIC` |
| `0x106918` | l'objet « mémoire partagée » : poignée à `+0x14`, adresse projetée à `+8`, booléen « projetée » à `+0x18` |
| `0x106938` | l'objet « tampon » : mot de fin (`+0`), base (`+4`), curseur (`+8`), décalage (`+0xc`), taille (`+0x10`), taille de la page moins 4 (`+0x14`), boucle (`+0x18`), codage (`+0x19`), cadence (`+0x1a`), événement « tampon plein » (`+0x1c`) |
| `0x106958`, `0x106974`, `0x106ed0`, `0x106eec`, `0x106f78`, `0x106f94` | les six objets de notification (`0x214`, `0x213`, `0x100`, `0x106`, `0x105`, `0x104`) |
| `0x106fcc` | le tableau des poignées attendues |
| `0x10503c` | la table des fonctions membres des gestionnaires ; `0x105040` celle de l'aiguillage de session (`0x103810` et son contexte `0x106034`) |
| `0x105000` | `cdc:MIC` ; `0x105120` `mic:u` ; `0x105126` `err:f` ; `0x105135` `ptm:s` |

## Partie 7 : les services que mic appelle

Chaque requête a sa petite fonction qui écrit un en-tête et appelle `SendSyncRequest`. Il y a 14 appels à `svcSendSyncRequest` (`0x32`) dans le code et 14 fonctions de requête.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x106070` | `0x00010002` | `SRV_RegisterClient` | `0x101004` | se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x1013c4` | obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x101040` | créer `mic:u` (1 session) |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x10109c` | le retirer à la sortie |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x101ca0` | ouvrir `cdc:MIC` et `ptm:s` |
| | | `0x00090040` | `SRV_Subscribe` | `0x102508` | s'abonner à cinq notifications |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x101400` | lire le numéro reçu |
| `cdc:MIC` | `0x106010` | `0x00010040` | `CDCMIC_SetGain` | `0x101d70` | réglage du gain |
| | | `0x00020000` | `CDCMIC_GetGain` | `0x104038` | lecture du gain |
| | | `0x00030040` | `CDCMIC_SetPower` | `0x1020a4` | alimentation du micro |
| | | `0x00040000` | `CDCMIC_GetPower` | `0x104004` | lecture de l'alimentation |
| | | `0x00050042` | `CDCMIC_SetIirFilterMic` | `0x101d30` | filtre du micro (tampon en lecture) |
| `ptm:s` | `0x10608c` | `0x04030042` | `PTMSYSM_NotifySleepPreparationComplete` | `0x103fb4` | accuser réception de `0x104` et `0x105` (réponse 0, avec le numéro de processus) |
| `err:f` (port) | `0x10603c` | `0x00010800` | `ERRF_Throw` | `0x102df8` | signaler une erreur fatale (`errf_report_error`, `0x1019f4`) |

Les noms `CDCMIC_…` sont ceux de ce fichier ; l'exheader appelle le service `cdc:MIC` et les cinq commandes ont le même ordre et les mêmes arguments que `SetGain`, `GetGain`, `SetPower`, `GetPower` et `SetIirFilterMic` de `mic:u`. Les noms des commandes de `srv:` et de `ptm:s` sont ceux de [sm](sm.md) et de [ptm](ptm.md).

## Partie 8 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x1026ec` |
| ExitProcess | `0x03` | `svcExitProcess` (graine posée à la main, Ghidra ne l'avait pas vue) | `0x102844` |
| CreateThread | `0x08` | `svcCreateThread` | `0x10144c` |
| ExitThread, SleepThread | `0x09`, `0x0A` | dans `thread_trampoline` | `0x102e40` |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x10230c` |
| SignalEvent | `0x18` | écrit sur place, à 5 endroits | |
| ClearEvent | `0x19` | écrit sur place, à 2 endroits | |
| CreateTimer | `0x1A` | `svcCreateTimer` | `0x101470` |
| SetTimer | `0x1B` | `svcSetTimer` | `0x101afc` |
| MapMemoryBlock | `0x1F` | dans `map_shared_memory` | `0x10362c` |
| UnmapMemoryBlock | `0x20` | dans `unmap_shared_memory` | `0x102324` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x10118c` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x101ae4` |
| CloseHandle | `0x23` | écrit sur place, à 22 endroits | |
| WaitSynchronization1 | `0x24` | écrit sur place, à 5 endroits | |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x103428` |
| GetSystemTick | `0x28` | écrit sur place, à 2 endroits | |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x101488` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x102db0` |
| SendSyncRequest | `0x32` | écrit sur place, à 14 endroits | |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x102dc8` |
| Break | `0x3C` | dans `get_eh_globals_slot` | `0x103230` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x100944` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x10095c` |
| BindInterrupt | `0x50` | dans `mic_initialize` | `0x100be8` |
| UnbindInterrupt | `0x51` | dans `mic_finalize` | `0x100dbc` |

Les verrous (`lock_enter` à `0x1020dc`, `lock_leave` à `0x101ed8`, `lock_arbitrate_wait` à `0x102f04`) reposent sur `ArbitrateAddress`, comme dans [hid](hid.md) et [sm](sm.md).

## Partie 9 : ce que Pokémon X envoie

Les dix lignes de `mic:u` de `pokemon-x-services.tsv`, avec la fonction du module qui reçoit la commande et ce qu'un programme qui prend la place de la console doit rendre. Les fonctions du jeu (adresses dans le code de la mise à jour) ont été relues pour cette fiche : le jeu ouvre `mic:u` dans `0x1ef5e0`, l'enregistrement commence dans `0x3f90f4`, le fil d'enregistrement est `0x3f97a0`, la fermeture est `0x3f9c24`. Le jeu ne l'utilise que pour la Poké Récré (`DllKawaigari`, d'après l'inventaire).

**Ouverture** (`0x1ef5e0`). Le jeu appelle `srv_get_service_handle("mic:u", drapeau 1)`. Le drapeau 1 veut dire « ne pas faire attendre si la session est prise » : si `sm` répond `0xD0401834` (plus de sessions), le jeu rend l'erreur `0xC8A08FF9` sans rien faire. Sinon il envoie la commande 16, puis note que le micro est ouvert.

| En-tête | Commande | Fonction du jeu (adresse) | Fonction du module (adresse) | Ce que le jeu envoie | Ce qu'il faut rendre |
| --- | --- | --- | --- | --- | --- |
| `0x00100040` | commande 16 | `mic_cmd_00100040` (`0x1ef9d4`) | `mic_SetClientSDKVersion` (`0x103ee8`) | `0x050200c8` au mot 1, une fois à l'ouverture | 0. Aucun effet à reproduire, sauf si l'on veut le chemin « ancien » (il n'est pas pris, la valeur est non nulle) |
| `0x00010042` | MapSharedMem | `mic_MapSharedMem` (`0x1ef948`), par `0x1efb0c` | `mic_MapSharedMem` (`0x103d54`) | taille `0x2000`, poignée d'un bloc que le jeu vient de créer (perms 3 et 3), page alignée à `0x1000` | 0, et fournir une page de `0x2000` octets partagée avec le jeu, dont le dernier mot (`0x1ffc`) vaut 0 au départ |
| `0x00090000` | GetGain | `mic_GetGain` (`0x1efa0c`) | `mic_GetGain` (`0x103f08`) | rien | 0 et un octet de gain. Le jeu le garde pour le rétablir à la fermeture (`SetGain(ancien)`), donc toute valeur convient, mais elle doit être stable |
| `0x00080040` | SetGain | `mic_SetGain` (`0x1efa4c`), 2 appels | `mic_SetGain` (`0x102484`) | un octet de gain, tiré d'un paramètre de l'appelant (non lu) | 0 |
| `0x000A0040` | SetPower | `mic_SetPower` (`0x1ef880`), 2 appels | `mic_SetPower` (`0x1024bc`) | 1 à l'ouverture, 0 à la fermeture | 0. Ne pas oublier que la console met une seconde à parler après SetPower(1) ; le jeu n'en tient pas compte |
| `0x00030140` | StartSampling | `mic_StartSampling` (`0x1ef8f4`), par le fil `0x3f97a0` | `mic_StartSampling` (`0x103b84`) | codage 3 (PCM16 signé), cadence 3 (8 182 Hz), décalage 0, taille égale à deux fois une longueur lue dans le jeu (au plus `0x1ffc`, sinon la console répond `0xE1008FFD`), boucle 1 | 0, puis écrire dans la page, à partir du début et en anneau, des échantillons de 16 bits signés à 8 182 Hz (16 364 octets par seconde), et mettre à jour le mot de fin après chaque paquet : décalage du dernier échantillon écrit, en octets depuis le début de la page |
| `0x00060000` | IsSampling | `mic_IsSampling` (`0x1ef844`), 2 appels | `mic_IsSampling` (`0x103b64`) | rien | 0 et un octet : 1 si l'enregistrement est en cours. Le jeu ne referme la page que si cet octet vaut 0 |
| `0x00050000` | StopSampling | `mic_StopSampling` (`0x1ef8c4`) | `mic_StopSampling` (`0x102444`) | rien | 0, et ne plus écrire dans la page |
| `0x00020000` | UnmapSharedMem | `mic_UnmapSharedMem` (`0x1ef814`), 2 appels | `mic_UnmapSharedMem` (`0x1023e4`) | rien | 0, puis la page n'est plus lue |
| `0x000C0042` | SetIirFilterMic | `mic_SetIirFilterMic` (`0x1ef98c`) | `mic_SetIirFilterMic` (`0x103e04`) | 50 octets pris dans une table du jeu, indexés par la cadence, **mais seulement si un octet du jeu est non nul** | 0 si jamais envoyée. L'octet (`0x5d4242`) n'est jamais écrit dans le code principal du jeu : la commande ne part donc probablement jamais (interprété) |

Ce que le jeu fait de la page :

- il lit le mot de fin (`0x1ef7d4` : `*(base + S − 4) + base`, donc l'adresse du dernier échantillon écrit) ;
- il compare cette adresse à la position qu'il a lue la dernière fois et copie les échantillons 16 bits jusqu'à `fin + 2`, avec le tour du tampon quand la fin repasse en dessous du début ; il dort entre deux lectures (`0x133e2c`, un `svcSleepThread` de `0x00b71b00` ns, soit 12 ms) ;
- il ne demande jamais l'événement « tampon plein » (`GetEventHandle` n'est pas dans la liste du jeu), ne règle pas l'écrêtage, ne demande ni `AdjustSampling`, ni `GetPower`.

Pour un portage : fournir `mic:u` de façon à ce que l'ouverture réussisse une fois ; remplir la page d'échantillons nuls (le zéro d'un PCM16 signé est 0) à 8 182 Hz est suffisant et suffit à faire marcher la Poké Récré sans son ; relier à un vrai microphone se fait en remplaçant ces zéros par les échantillons de l'hôte, ramenés à 8 182 Hz, en 16 bits signés, en gardant le mot de fin cohérent.

## Les désaccords relevés

- **3dbrew, commande 16.** La copie lue ne lui donne pas de nom ; le fichier de noms propose `mic_SetClientSDKVersion`, que l'on ne peut pas confirmer ici.
- **Carte des services (le tsv).** Elle nomme cette commande « Inconnue », et ne cite pas les six commandes que le jeu n'envoie pas (4, 7, 11, 13, 14, 15). Les en-têtes et les noms sont bons pour les dix autres. Aucune autre différence.
- **3dbrew, AdjustSampling et GetEventHandle.** Le code les reçoit avec les mêmes en-têtes et les mêmes réponses que 3dbrew ; c'est la seule source de leur nom.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 16 numéros de commande, leur fonction, leur en-tête de réponse : le pseudo-code de Ghidra de `mic_handle_command` (`0x103810`) d'un côté, et de l'autre `emulate_dispatch.py`, qui exécute l'aiguillage. Les deux donnent les mêmes 16 lignes. Les en-têtes de requête de 3dbrew tombent sur les mêmes numéros.
- Les deux seuls cas qui vérifient l'en-tête entier (1 et 12) : le pseudo-code et `emulate_dispatch.py` (colonne « entier » pour ces deux lignes, « numéro » pour les 14 autres).
- Le service offert et les services appelés : l'exheader autorise `cdc:MIC` et `ptm:s`, et ce sont les deux noms qu'on retrouve dans la section en lecture seule du code (`0x105000`, `0x105135`) et ouverts par `mic_initialize` et `ptm_open`.
- La limite d'une session : 3dbrew le dit ; le code l'impose deux fois (le maximum de 1 passé à `SRV_RegisterService`, et la nouvelle session refermée dans `mic_main` quand il y en a déjà une).
- La page matérielle `0x1EC62000` et l'interruption `0x5A` : le descripteur `0xFFE1EC62` de l'exheader et la liste d'interruptions (la seule : `0x5A`) d'un côté ; de l'autre le code qui lit et écrit cette adresse et lie l'interruption `0x5A` (l'assembleur de `0x100be8`).
- Le format du tampon partagé (échantillons, puis un mot de 32 bits en fin de page) et les quatre codages : 3dbrew (page « MIC Shared Memory » et énumération) d'un côté, de l'autre `write_samples_to_buffer` et `mic_StartSampling`. La lecture du mot de fin par le jeu (`0x1ef7d4`) lit le même mot à `base + S − 4` : troisième accord.
- Les cadences : 3dbrew (formule) et le code (les valeurs 0 à 3 seulement, insérées en bits 2 et 3 du registre).
- La séquence d'ouverture de Pokémon X (commande 16, MapSharedMem de `0x2000`, GetGain, SetGain, SetPower(1), StartSampling 3, 3, 0, taille, 1) : l'assembleur du jeu et les vérifications du module (`décalage + taille <= S − 4`, taille paire, `S` multiple de `0x1000`) se recoupent.
- Les en-têtes des 14 requêtes envoyées : 14 fonctions pour 14 appels à `svc 0x32`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens des bits du registre `0x1EC62000` (15 : en marche ; 8 : FIFO vide ; 11 : trop-plein ; 12 : remise à zéro) : déduit de l'usage dans les lecteurs, pas d'une documentation.
- La seconde de silence après SetPower(1) et après le réveil (octet `+3`, minuteur de `1 000 000 000` ns) : tout le mécanisme se lit, mais son but (laisser le codec se stabiliser) est une interprétation.
- Les trois lecteurs de FIFO et le choix par `+9` et `+0xa` : le chemin `read_fifo_legacy_timed` corrige une dérive à partir de l'horloge du système (constantes `0xffd70a3b`, `0x110` non élucidées) ; `read_fifo` et `read_fifo_legacy` ne diffèrent que par la manière dont ils gèrent un nombre impair d'échantillons.
- Le nom `SetClientSDKVersion`, et le fait que `+9` serve de « compatibilité avec les anciens SDK ».
- Le sens des notifications `0x104` à `0x106`, `0x213` et `0x214` (repris de [ptm](ptm.md) et de [hid](hid.md)).
- Le rôle exact de `light_event_wait`, `light_event_signal`, `light_event_init` et `light_event_clear` : une barrière à deux états dont l'usage se lit dans `StartSampling` et le fil de lecture, mais dont les états internes (`-1`, `-2`, 0, 1) n'ont pas tous été suivis.
- Les piles des fils (`0x106118` à `0x106918`, 1 024 octets chacune) : lues dans les arguments de `create_thread`.
- Que les 50 octets du filtre IIR sont un filtre par défaut du module (`mic_finalize` les rend à `cdc:MIC`).
- Que le jeu n'envoie jamais `SetIirFilterMic` (l'octet de son état n'est écrit nulle part dans le code principal ; un `.cro` pourrait l'écrire).

**Pas lu**
- Le corps des fonctions de bibliothèque : le tas (`heap_alloc_unlocked`, `0x1030a8`, `0x103244`), `memcpy`, la gestion des réserves d'adresses au-delà de l'allocation (`vm_region_alloc`, `vm_region_free`), les petites fonctions de construction des objets globaux (`construct_global_objects`, `0x1031f0` à `0x103448`, `0x104698` à `0x1047e0`).
- Les valeurs de gain admises (le module ne les vérifie pas ; `cdc:MIC` peut les refuser).
- Ce que `cdc:MIC` fait de ses cinq commandes (il faudrait lire le module `codec`).
- 62 fonctions restent sans nom, presque toutes de la bibliothèque (destructeurs, petits accesseurs).

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 179 fonctions, projet Ghidra | `outils/ghidra_direct.py mic` | une demi-minute |
| Table des 16 commandes | `outils/emulate_dispatch.py mic 0x103810=mic:u` | immédiat |
| Assembleur du module | objdump de devkitPro (`code.asm`) | immédiat |
| Exheader (services, pages, interruptions) | un petit script Python sur `exheader.bin` | immédiat |
| Pseudo-code avec les constantes des tables de littéraux remplacées | un script Python (`pc.py`) : Ghidra n'affiche pas les valeurs des mots lus par `ldr =`, leur valeur est lue dans `code.bin` | immédiat |
| Lecture, nommage, côté jeu | Claude | le gros du temps |
| 3dbrew : « MIC Services » (version du 17 mars 2018, `oldid=20657`) et « MIC Shared Memory » (version du 9 octobre 2015, `oldid=13555`) | web.archive.org, capture de 2022 (la capture la plus récente rendait une erreur 503) | |

Les scripts et le brut sont dans `local/analyse/mic/` et `local/analyse/` (non versionné).

**Pour reprendre.** `mic.noms.tsv` est le fichier de graines. Les noms en `CDCMIC_`, `SRV_` et `PTMSYSM_` sont les requêtes envoyées à d'autres services ; ceux en `mic_` sont les commandes reçues, plus `mic_hw_…` pour le matériel. Les trois lecteurs du FIFO et la barrière sont les endroits à relire en premier.
