# ro, le chargeur des modules `.cro`

`ro` fait d'un fichier `.cro` déjà lu en mémoire par un jeu un morceau de programme exécutable, branché sur le code principal et sur les autres modules. Le jeu lit lui-même le fichier dans son tas ; `ro` vérifie qu'il est autorisé, le fait apparaître à une seconde adresse, convertit ses décalages en adresses, applique ses relocations, résout ses imports dans les deux sens, puis le fige en lecture et exécution. Pokémon X s'en sert pour ses 133 modules (`Dll….cro`).

Fiche du 14 octobre 2026, produite avec REA et Ghidra sur le module dumpé de la console. Les adresses sont celles du module chargé à `0x14000000`, comme `loader`. Elle complète la partie 6 du [contrat des petits services](contrat-petits-services.md), qui décrit le même dialogue vu du jeu, et la partie 5 de [Pokémon X, services](pokemon-x-services.md), qui décrit le format des fichiers. Elle est écrite pour qu'un chargeur de `.cro` sur PC puisse être vérifié règle par règle.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000003702`, installé dans la mémoire de la console (pas dans le NATIVE_FIRM) |
| Fichier lu | `local/extrait/ro/exefs/code.elf` |
| Taille | 33 636 octets de code, 616 de données en lecture seule, 1 000 de données, 5 016 de mémoire à zéro |
| Code | ARM, sauf deux petites fonctions Thumb du démarrage (`construct_array`, `run_static_initializers`). Un seul pointeur impair dans tout le fichier, celui du `blx` vers la seconde |
| Fonctions | 180, dont 123 nommées dans `ro.noms.tsv` |
| Service offert | `ldr:ro`, 9 commandes, deux sessions au plus |
| Services appelés | `fs:USER` (trois commandes), `ps:ps` (une), plus `srv:` |
| Services autorisés par l'exheader | `fs:USER` et `ps:ps`, exactement ceux qu'il ouvre |
| Fils | un seul |
| Sur cette console | le fichier lu est l'original de Nintendo. Luma peut retoucher `ro` au chargement (non vérifié ici) |

## Partie 1 : le démarrage et la boucle

`entry` (`0x14000000`) enchaîne `clear_bss` (`0x14000024`), `init_c_locale` (`0x14000644`), `init_runtime_and_srv` (`0x140007e8`, qui se connecte au port `srv:` et s'y déclare), les initialiseurs des objets globaux (`run_static_initializers`, `0x14008300`, en Thumb, seize entrées de `0x14008324` à `0x14008364`), puis `ro_main` (`0x14000174`), et sort par `svcExitProcess`.

`ro_main` fait la mise en place, puis tourne dans une seule boucle, sur le même modèle que `loader` :

1. **Le service.** `SRV_RegisterService` (`0x14000ab8`) crée `ldr:ro` avec **deux sessions au plus**. Le nom, ce nombre et l'adresse du gestionnaire sont dans une petite fiche à `0x14009020`.
2. **Les contextes de session.** `init_session_pool` (`0x140006d4`) prépare une réserve de deux contextes de `0x348` octets à `0x1400aaa8`. Chaque session ouverte reçoit le sien : c'est là que vit tout l'état d'un processus client (partie 11).
3. **L'arrêt.** `register_notification_handler` (`0x14000a0c`) inscrit `on_terminate_notification` (`0x140082a4`) pour la notification `0x100`, qui ne fait que lever un drapeau (`0x1400a27c`).
4. **`fs:USER`.** `fs_init` (`0x14000794`) ouvre le service et l'initialise (`0x08010002`). `ps:ps` n'est ouvert qu'au moment de vérifier une signature, et refermé aussitôt.

**La boucle :** `svcReplyAndReceive` sur la liste de poignées de `0x1400b770` (compteur à `0x1400a270`). Rang 0 : le sémaphore des notifications. Rang 1 : le port `ldr:ro` ; une troisième session est refermée aussitôt. Rangs suivants : les sessions, dont le gestionnaire est appelé avec le contexte de la session. Quand une session se ferme (`0xC920181A`), son contexte est rendu à la réserve **sans rien défaire dans le processus client** : pas de déchargement, pas de levée des projections. La boucle s'arrête quand le drapeau d'arrêt est levé et qu'aucune session n'est ouverte : elle retire `ldr:ro`, ferme `fs:USER` et quitte `srv:`.

## Partie 2 : les commandes de `ldr:ro`

`ldrro_handle_command` (`0x14005c2c`) lit l'en-tête dans le tampon du fil (`+0x80` du stockage local) et fait un aiguillage sur les 16 bits du haut. **Les neuf commandes vérifient l'en-tête entier, et le mot qui précède la poignée de processus doit valoir 0** (c'est le descripteur « copier une poignée »). Sinon : en-tête `0x00000040` et `0xD9001830`. Un numéro inconnu rend `0xD900182F`. Noms et en-têtes de requête : 3dbrew ; fonction, mots lus, en-tête de réponse : le code, confirmés par `emulate_dispatch.py`.

| N° | Requête | Commande | Fonction | Adresse | Réponse |
| --- | --- | --- | --- | --- | --- |
| 1 | `0x000100C2` | Initialize | `ldrro_Initialize` | `0x14003894` | `0x00010040` |
| 2 | `0x00020082` | LoadCRR | `ldrro_LoadCRR` | `0x140025b8` | `0x00020040` |
| 3 | `0x00030042` | UnloadCRR | `ldrro_UnloadCRR` | `0x14002808` | `0x00030040` |
| 4 | `0x000402C2` | LoadExeCRO | `ldrro_LoadExeCRO` | `0x14002b6c` | `0x00040080` |
| 5 | `0x000500C2` | UnloadCRO | `ldrro_UnloadCRO` | `0x14003554` | `0x00050040` |
| 6 | `0x00060042` | LinkCRO | `ldrro_LinkCRO` | `0x14002a4c` | `0x00060040` |
| 7 | `0x00070042` | UnlinkCRO | `ldrro_UnlinkCRO` | `0x14003434` | `0x00070040` |
| 8 | `0x00080042` | Shutdown | `ldrro_Shutdown` | `0x14003788` | `0x00080040` |
| 9 | `0x000902C2` | LoadCRO_New | `ldrro_LoadCRO_New` | `0x14002fd0` | `0x00090080` |

Pokémon X n'envoie que 1, 2, 4 et 5.

**Les mots lus par chaque commande** (le mot 0 est l'en-tête, « poignée » est la poignée du processus client) :

| Commande | Mots de la requête, dans l'ordre | Doit valoir 0 |
| --- | --- | --- |
| Initialize | 1 tampon où est lu `static.crs`, 2 sa taille, 3 l'adresse où le projeter, 5 poignée | mot 4 |
| LoadCRR | 1 tampon du `.crr`, 2 sa taille, 4 poignée | mot 3 |
| UnloadCRR | 1 adresse du `.crr` chargé, 3 poignée | mot 2 |
| LoadExeCRO et LoadCRO_New | 1 tampon du `.cro`, 2 adresse où le projeter, 3 taille du fichier, 4 tampon de `.data`, 5 **doit être 0** (sinon `0xE1612C1D`), 6 taille du tampon de `.data`, 7 tampon de `.bss`, 8 taille du tampon de `.bss`, 9 un octet « liaison automatique », 10 niveau de finition, 11 **adresse d'un `.crr` chargé contre lequel vérifier, 0 pour tous**, 13 poignée | mot 12 |
| UnloadCRO | 1 adresse du module projeté, 2 **ignoré**, 3 adresse du tampon d'origine, 5 poignée | mot 4 |
| LinkCRO, UnlinkCRO | 1 adresse du module projeté, 3 poignée | mot 2 |
| Shutdown | 1 adresse du tampon d'origine de `static.crs`, 3 poignée | mot 2 |

Toutes les réponses n'ont que le résultat, sauf LoadExeCRO et LoadCRO_New qui ajoutent au mot 2 la taille du module après finition. En cas d'échec, ce mot 2 n'est pas écrit par la fonction : il contient ce qui traînait dans la pile (lu dans le code, à ne pas utiliser).

**Les contrôles communs**, dans l'ordre où les commandes les font :

| Résultat | Cas |
| --- | --- |
| `0xD9612FF9` | Initialize alors que la session a déjà un `static.crs` |
| `0xD9612FF8` | toute autre commande avant Initialize |
| `0xE1612FF7` | poignée de processus nulle |
| `0xE0E12C1F` | taille de fichier trop petite : moins de `0x138` pour un `.crs` ou un `.cro`, moins de `0x360` pour un `.crr` |
| `0xD9012FF1` | une adresse de tampon ou de projection n'est pas un multiple de `0x1000` |
| `0xD9012FF2` | la taille n'est pas un multiple de `0x1000` |
| `0xD8A12C08` | le tampon source n'est pas un seul bloc de mémoire privée en lecture-écriture, tout entier entre `0x00100000` et `0x0E000000` (`check_private_rw_block`, `0x14004eac`, par `svcQueryProcessMemory`) |
| `0xE1612C0F` | la projection ne tient pas entre `0x00100000` et `0x04000000` (début au moins `0x00100000`, fin au plus `0x04000000`, sans débordement) |
| `0xD8612FF3` | LoadExeCRO : plus de case libre, **64 modules au plus par processus** |
| `0xD8A12C0D` | UnloadCRR, UnloadCRO, LinkCRO, UnlinkCRO : l'objet désigné n'est pas un `.crr` ou un module chargé, ou sa projection n'a pas les droits attendus (partie 9) |

## Partie 3 : comment `ro` voit et modifie la mémoire du jeu

**La fenêtre.** Au début de chaque commande qui touche à la mémoire du client, `ro` appelle `svcMapProcessMemory(poignée, 0x00100000, 0x0DF00000)` : toute la plage `0x00100000`–`0x0E000000` du processus client apparaît **aux mêmes adresses** dans `ro`, en lecture-écriture, quels que soient les droits du client. Une adresse du jeu est donc directement utilisable par `ro`, et `ro` peut écrire dans le `.text` du programme principal. `svcUnmapProcessMemory` referme la fenêtre en fin de commande. Les dix-huit sites de ces deux appels (neuf chacun) ont tous les mêmes arguments (lu dans l'assembleur : le pseudo-code de Ghidra perd les registres autour de ces `svc` écrits sur place).

**Les projections dans le processus client**, toutes par `svcControlProcessMemory` (`0x14004fa8`) :

| Objet | Opération à la mise en place | Droits | Défaite par |
| --- | --- | --- | --- |
| `static.crs` | MAP (4) du tampon vers l'adresse du mot 3 | lecture | Shutdown : UNMAP (5), le tampon redevient lecture-écriture |
| un `.crr` | MAP (4) **sur lui-même** (même adresse source et destination) | lecture ; l'état devient « alias de code » | UnloadCRR : UNMAP (5) sur lui-même, lecture-écriture |
| un `.cro` | MAP (4) du tampon vers l'adresse du mot 2, taille du fichier | lecture | UnloadCRO (partie 9) |
| la fin d'un `.cro` après finition | UNMAP (5) de la fin de la projection, de la fin finie (arrondie à la page) à la fin du fichier | les pages du tampon d'origine correspondantes redeviennent lecture-écriture | |
| le code d'un `.cro` | PROTECT (6) des pages du premier segment de code non vide (début arrondi à la page inférieure, fin à la page supérieure) | lecture et exécution | UnloadCRO : PROTECT (6) en lecture seule |

Le code d'un module commence à `0x180` dans le fichier : la page arrondie inclut donc l'en-tête, qui se retrouve en lecture et exécution. Le contrôle des modules chargés (`cro_check_mapped`, `0x14004c60`) l'exige d'ailleurs : la projection doit être un bloc « alias de code » en lecture-exécution allant exactement du début du module au début du premier segment `.rodata`, suivi d'un bloc « alias de code » en lecture seule qui couvre le reste de la taille finie.

**Une conséquence pour un portage.** Ce que `ro` écrit dans la projection, il l'écrit dans les pages physiques du tampon d'origine. Quand la fin de la projection est rendue, ces pages reviennent au tas du jeu **avec les corrections déjà faites**. C'est pour cela que le jeu peut prendre la fin de `.data` dans son tampon d'origine (contrat, partie 6).

## Partie 4 : Initialize, pas à pas

`ldrro_Initialize` (`0x14003894`) :

1. Les contrôles de la partie 2 (déjà initialisé, poignée, taille au moins `0x138`, alignements, bloc privé, plage de projection).
2. MAP du tampon vers l'adresse du mot 3, en lecture.
3. Ouverture de la fenêtre ; l'adresse projetée est rangée dans le contexte (`+0x08`) : c'est elle qui dira, pour toutes les autres commandes, que la session est initialisée.
4. `crs_initialize` (`0x14006390`) vide les deux listes de modules, met à 0 les champs `0x88` et `0x8C` de `static.crs`, puis lui applique `cro_rebase_and_relocate` (partie 6, étapes 4 à 10) **en sautant la conversion des segments et la table `0x120`** : les segments de `static.crs` donnent déjà des adresses (`0x100000`, `0x53F000`, `0x5A9000`…), seul leur contrôle de plage est fait. Ce passage convertit l'en-tête de `static.crs` en adresses, contrôle ses tables, et surtout **remplit ses 331 corrections d'import avec sa fonction « symbole non résolu »** : c'est-à-dire écrit `0x4D7BC0` plus l'addend dans les 331 mots du `.text` du programme principal. Seize de ces corrections ont un addend de 8 : leurs mots passent de `0x4D7BC0` à `0x4D7BC8` dès Initialize (vérifié en exécutant le code de `ro`, partie 14).
5. Fermeture de la fenêtre.
6. `get_process_unique_id` (`0x140056fc`) : `svcGetProcessId` sur la poignée, puis `FS_GetProgramLaunchInfo` (`0x082F0040`) donne le numéro de titre ; `ro` en garde les bits `0x0FFFFF00` du mot bas dans le contexte (`+0x314`). Pour Pokémon X : `0x00055D00`. C'est la valeur que LoadCRR comparera au champ `0x340` du `.crr`.
7. En cas d'échec à l'étape 4 ou 6 : le contexte est remis à « non initialisé » et la projection défaite (UNMAP, lecture-écriture).

`static.crs` n'est ni vérifié contre un `.crr`, ni fini (sa marque reste `CRO0`), ni passé en exécution.

## Partie 5 : LoadCRR et UnloadCRR

### LoadCRR, pas à pas

`ldrro_LoadCRR` (`0x140025b8`) :

1. Les contrôles de la partie 2, avec une taille minimale de `0x360`.
2. MAP du tampon sur lui-même, en lecture : le jeu ne peut plus y écrire.
3. Ouverture de la fenêtre, puis `crr_verify_and_register` (`0x1400592c`) :
   1. **L'en-tête** (`crr_check_header`, `0x14005f40`). Refus `0xD9012C06` si l'un de ces points manque : marque `CRR0` ; mots `0x08` et `0x0C` à 0 ; mot `0x340` égal à la valeur gardée par Initialize ; mot `0x344` égal à la taille donnée ; table des empreintes (décalage `0x350`, nombre `0x354`) avec `0x360` ≤ décalage < taille, nombre × 32 < taille et décalage + nombre × 32 < taille ; mot `0x358` au moins égal à la fin de la table et au moins `0x360`, et strictement inférieur à la taille ; mot `0x35C` inférieur à la taille, et `0x358` + `0x35C` strictement inférieur à la taille.
   2. **La première signature.** Clé publique de Nintendo rangée dans `ro` : celle de `0x1400A000` si le bit 0 de l'octet `0x1FF80014` est levé (console du commerce), sinon celle de `0x1400A100` ; exposant 65 537, 2 048 bits. Données signées : `0x120` octets à partir de `0x20` (donc le masque, le motif et la clé du fichier). Signature : `0x140`. `ro` calcule le SHA-256 lui-même et demande la vérification RSA à `ps:ps` (`PS_VerifyRsaSha256`, `0x00020244`). Échec : `0xD9012C24`.
   3. **Le programme.** Le mot `0x20` (masque) appliqué au mot `0x340` doit donner le mot `0x24` (motif). Sinon `0xD9012FEA`. Pour Pokémon X : masque `0xF00000FF`, motif 0.
   4. **La seconde signature**, avec la clé contenue dans le fichier (`0x40`, `0x100` octets) : données de `0x340` jusqu'au décalage donné par le mot `0x358`, signature à `0x240`. Échec : `0xD9012C24`.
   5. **L'inscription.** Le `.crr` est ajouté au bout d'une liste doublement chaînée tenue dans le contexte (`+0x30C` premier, `+0x310` dernier) ; ses mots `0x08` et `0x0C` deviennent ses liens suivant et précédent.
4. Fermeture de la fenêtre. En cas d'échec : UNMAP sur lui-même, lecture-écriture.

**Aucune limite à un seul `.crr`** : rien dans le code ne refuse un second LoadCRR, contrairement à ce que dit 3dbrew. Les champs `0x10` et `0x14` (informations de mise au point) ne sont pas lus par `ro`.

Les deux signatures du `static.crr` de Pokémon X ont été recalculées hors de la console avec ces règles : la première se vérifie avec la clé de `0x1400A000` et pas avec l'autre, la seconde avec la clé du fichier sur `0x340`–`0x1400`. À `0x1400` finit justement la table des 133 empreintes : le mot `0x358`, que 3dbrew appelle « décalage de la zone en clair », sert à `ro` de fin de la zone signée.

### Comment une empreinte est cherchée

`crr_find_hash` (`0x140057b8`) : l'empreinte d'un module est le SHA-256 de ses `0x80` premiers octets. Si le mot 11 de LoadExeCRO vaut 0, `ro` cherche dans chaque `.crr` de la liste, dans l'ordre ; sinon ce `.crr` doit être dans la liste (`0xD8E12C0E`) et seul lui est consulté. La recherche est **dichotomique** sur 32 octets comparés comme des octets non signés : la table doit être rangée par ordre croissant. Absente partout : `0xD8E12C1C`.

### UnloadCRR

`ldrro_UnloadCRR` (`0x14002808`) exige que l'adresse soit un bloc « alias de code » en lecture seule dans le client et visible dans la fenêtre, marqué `CRR0`, de la taille de son mot `0x344` (sinon `0xD8A12C0D`) ; il revérifie l'en-tête (`0xD9012C06`), retire le `.crr` de la liste (`crr_unregister`, `0x14005758`) et défait la projection. Les modules déjà chargés ne sont pas touchés.

## Partie 6 : LoadExeCRO, pas à pas

C'est le cœur du module. `ldrro_LoadExeCRO` (`0x14002b6c`) ; LoadCRO_New ne diffère qu'à l'étape 11 (partie 10).

**1. Les contrôles de la requête** (partie 2) : session initialisée, poignée, taille au moins `0x138`, mots 1 et 2 alignés sur la page, taille alignée, tampon source privé et en lecture-écriture, projection dans `0x00100000`–`0x04000000`, mot 5 nul, une case libre parmi 64. Aucun contrôle n'est fait sur les tampons de `.data` et de `.bss` : `ro` ne regarde que leurs tailles (étape 5).

**2. La projection.** MAP du tampon vers l'adresse du mot 2, toute la taille, en lecture. Puis ouverture de la fenêtre. Dans la suite, « le module » est l'image à l'adresse projetée, et « la base » cette adresse.

**3. Les empreintes** (`cro_verify_hashes`, `0x14005b64`), sur le fichier encore intact :

1. SHA-256 des `0x80` premiers octets, cherché dans le ou les `.crr` (partie 5).
2. Le décalage du code (`0xB0`) doit dépasser `0x138` (sinon `0xE0E12C20`).
3. SHA-256 de `0x80` jusqu'au code, comparé à l'empreinte de `0x00` ; du code jusqu'au nom du module (`0xC0`), comparé à `0x20` ; du nom du module jusqu'aux données (`0xB8`), comparé à `0x40`. Différence : `0xD8E12C03`. Une plage qui sort du fichier : `0xE0E12C0C`. **L'empreinte des données (`0x60`) n'est pas vérifiée.** Au-delà de `0x2221` octets, le calcul est confié à `fs:USER` (`FS_UpdateSha256Context`, `0x084E0342`) ; en dessous, `ro` le fait lui-même.

**4. L'en-tête** (`cro_validate_and_rebase_header`, `0x14006e80`). Refus global `0xD9012C11`.

- Marque `CRO0` ; mots `0x88`, `0x8C` et `0x98` à 0 ; taille (`0x90`) et taille du `.bss` (`0x94`) inférieures à `0x10000000`.
- Les décalages doivent se suivre, chacun au moins égal au précédent : `0x138` ≤ code (`0xB0`) ≤ nom du module (`0xC0`) ≤ segments (`0xC8`) ≤ exports par nom (`0xD0`) ≤ **arbre des exports (`0xE8`)** ≤ exports par numéro (`0xD8`) ≤ noms des exports (`0xE0`) ≤ modules importés (`0xF0`) ≤ corrections d'import (`0xF8`) ≤ imports par nom (`0x100`) ≤ imports par numéro (`0x108`) ≤ imports anonymes (`0x110`) ≤ noms des imports (`0x118`) ≤ table `0x120` ≤ corrections internes (`0x128`) ≤ table `0x130` ≤ données (`0xB8`) ≤ taille du fichier (`0x90`). Noter l'arbre rangé avant les exports par numéro. Les 134 fichiers de Pokémon X respectent cet ordre.
- **Ces dix-huit champs deviennent des adresses** : `0x84`, `0xB0`, `0xB8`, `0xC0`, `0xC8`, `0xD0`, `0xD8`, `0xE0`, `0xE8`, `0xF0`, `0xF8`, `0x100`, `0x108`, `0x110`, `0x118`, `0x120`, `0x128`, `0x130`. Pour chacun : s'il vaut 0 il reste 0, sinon on lui ajoute la base, et le résultat doit tomber entre la base et la base plus la taille (bornes comprises). Les champs `0xA0` à `0xAC` (adresses étiquetées) ne sont pas convertis.
- Chaque table doit finir dans le fichier : décalage + nombre × taille d'une case ≤ base + taille, avec 12 octets par segment, 8 par export par nom, 4 par export par numéro, 8 par nœud de l'arbre, 20 par module importé, 12 par correction, 8 par import (nom, numéro, anonyme), 8 pour la table `0x120`, 12 pour la table `0x130` ; et code, données, nom, chaînes : décalage + taille.

« La taille » est partout celle de la requête (mot 3) : rien n'exige qu'elle soit égale au champ `0x90`, qui doit seulement être au moins le décalage des données.

Le nom du module doit finir par un octet nul si sa taille n'est pas nulle (`0xD9012C0B`).

**5. La table des segments** (sauf pour `static.crs`). Chaque case : adresse, taille, genre (0 code, 1 lecture seule, 2 données, 3 `.bss`).

- Genre 2 de taille non nulle : sa taille doit tenir dans le tampon du mot 6 (sinon `0xE0E12C1F`) ; **son adresse devient celle du tampon du mot 4**. `ro` garde l'ancien décalage : « l'image de `.data` » est la base plus ce décalage.
- Genre 3 de taille non nulle : sa taille doit tenir dans le mot 8 (`0xE0E12C1F`) ; **son adresse devient celle du tampon du mot 7**.
- Genres 0 et 1 : si le décalage n'est pas nul, on lui ajoute la base, et le résultat doit rester dans le fichier (`0xD9012C19`).
- Un segment de taille nulle garde sa valeur. Plusieurs segments du même genre 2 ou 3 iraient tous au même tampon : rien ne les compte.

Puis pour tous les segments de taille non nulle, `static.crs` compris : l'adresse doit être au moins `0x00100000`, la fin au plus `0x0E000000`, sans débordement (`0xD9012C19`).

**6. Les tables d'export et d'import.** Pour chaque table, l'adresse doit tomber dans `0x00100000`–`0x0E000000`, puis :

| Table | Converti en adresse (si non nul) | Doit pointer dans | Erreur |
| --- | --- | --- | --- |
| exports par nom | le nom | les noms des exports (bornes comprises) | `0xD9012C11` |
| arbre des exports | rien | les numéros de nœud gauche et droit (15 bits) doivent être inférieurs au nombre de nœuds | `0xD9012C11` |
| noms des exports | | dernier octet nul si la taille n'est pas nulle | `0xD9012C0B` |
| modules importés | le nom, le début des imports par numéro, le début des imports anonymes | les noms des imports ; la table des imports par numéro ; celle des imports anonymes | `0xD9012C18` |
| corrections d'import | rien | la dernière doit porter la marque « dernière » (octet `+5`) | `0xD9012C12` |
| imports par nom | le nom, la tête de liste | les noms des imports ; les corrections d'import | `0xD9012C1B` |
| imports par numéro | la tête de liste (pas le numéro) | les corrections d'import | `0xD9012C14` |
| imports anonymes | la tête de liste (pas l'adresse étiquetée) | les corrections d'import | `0xD9012C17` |
| noms des imports | | dernier octet nul si la taille n'est pas nulle | `0xD9012C0B` |

**7. Toutes les corrections d'import reçoivent d'abord « non résolu »** (`import_relocs_fill_unresolved`, `0x14007ae8`). La valeur S est l'adresse de la fonction « symbole non résolu » du module (champ `0xAC`, résolu par sa table de segments), ou 0 s'il n'en a pas. Chaque correction est appliquée avec cette valeur (partie 7) ; une cible invalide rend `0xD9012C12`. L'octet `+6` de la première correction de chaque liste est mis à 0 (« non résolue »).

**8. La table `0x120`** (sauf pour `static.crs`). Chaque case de 8 octets : une adresse étiquetée dans **ce** module, puis le décalage d'une liste de corrections dans la table `0x130` (sinon `0xD9012C16`). La liste est appliquée avec, pour cibles, des adresses étiquetées résolues dans les segments **de `static.crs`**, et pour valeur S l'adresse dans ce module. C'est un chemin par lequel un module corrige le programme principal. Vide dans les 134 fichiers de Pokémon X.

**9. Les corrections internes** (`apply_internal_relocation`, `0x140077c8`), une par une. Voir la partie 7 pour la cible, la valeur et l'endroit écrit. Erreur `0xD9012C15` si la cible ou le segment désigné est invalide.

**10. `__aeabi_atexit`.** Si le module importe par nom `__aeabi_atexit`, `ro` cherche dans `static.crs` puis dans les modules de la liste automatique un export nommé `nnroAeabiAtexit_`, et y branche la liste de corrections (absent partout : `0xD8E12C02`). Seul le premier import de ce nom est traité. Dans Pokémon X, aucun module n'importe par nom, et c'est `static.crs` qui exporte `nnroAeabiAtexit_`.

**11. La liaison** (`cro_link`, `0x140063d4`), décrite en partie 8. Faite **quelle que soit la valeur du mot 9**.

**12. L'inscription** (`cro_list_insert`, `0x14006dac`) dans l'une des deux listes du contexte, selon le mot 9 (partie 11).

**13. La finition** (`cro_fix`, `0x14007bd4`), selon le mot 10. `ro` calcule quatre fins (`cro_compute_fix_ends`, `0x14005fd4`), chacune le maximum des fins de tables du groupe et des groupes plus profonds :

| Niveau | Fin retenue : le maximum de | Tables vidées (adresse = fin, nombre = 0) |
| --- | --- | --- |
| 0 | tout, y compris `0x120`, corrections internes, `0x130` | aucune ; la marque reste `CRO0` |
| 1 | `0x138`, code, nom du module, segments, exports, arbre, noms des exports, modules importés, corrections d'import, trois tables d'import, noms des imports | `0x120`, `0x128`, `0x130` ; marque `FIXD` |
| 2 | le niveau 3 plus segments, exports par nom et par numéro, noms des exports, arbre | en plus : `0xF0` à `0x118` (tout ce qui sert aux imports) |
| 3 | `0x138`, code, nom du module | en plus : `0xD0` à `0xE8` (tout ce qui sert aux exports) |
| 4 et plus | comme 0 | comme 3, avec la marque `FIXD` |

Deux détails lus dans l'assembleur : la fin de la table des modules importés est calculée avec **8 octets par case et non 20** (sans effet, la table des corrections d'import qui la suit est comptée aussi) ; la fin est arrondie à la page supérieure. **La taille finie est cette fin moins la base** : elle est rendue au mot 2 de la réponse et écrite au champ `0x98`. Pokémon X charge tout au niveau 1 : pour 43 de ses 133 modules, la coupure tombe avant `.data`, pour les 90 autres après la fin de `.data`.

**14. Les droits.** Fermeture de la fenêtre ; si la taille finie est plus petite que le fichier, UNMAP de la fin ; puis PROTECT en lecture-exécution des pages du premier segment de code non vide.

**15. En cas d'erreur** à n'importe quelle étape après la projection : le module est retiré de sa liste s'il y était entré, sa case est rendue, et toute la projection est défaite (UNMAP, lecture-écriture). Les écritures déjà faites ne sont pas annulées : les corrections déjà appliquées dans le tampon d'origine, et les mots des autres modules ou du programme principal déjà branchés sur lui, restent.

## Partie 7 : les relocations

### L'entrée

Une correction fait 12 octets : une adresse étiquetée (la cible), un octet de genre, un octet `+5`, un octet `+6`, un octet `+7` jamais lu, puis l'addend sur 32 bits.

| Octet | Correction d'import | Correction interne |
| --- | --- | --- |
| `+5` | non nul pour la dernière correction d'une liste | numéro du segment où se trouve la valeur |
| `+6` | sur la première correction d'une liste : 1 si la liste est branchée sur un vrai symbole, 0 sinon | jamais lu ni écrit |

**Une adresse étiquetée** se résout ainsi, partout dans `ro` : segment = les 4 bits du bas, décalage = les 28 bits du haut ; elle n'est valable que si le numéro est inférieur au nombre de segments **et le décalage strictement inférieur à la taille du segment** ; l'adresse est alors l'adresse du segment (déjà convertie, partie 6, étape 5) plus le décalage. Sinon elle vaut 0. Pour une cible, il faut en plus qu'elle soit non nulle et comprise dans `0x00100000`–`0x0E000000`.

### Les trois valeurs

Pour chaque correction, `apply_relocation` (`0x14004050`) reçoit l'endroit où écrire (W), l'addend (A), la valeur du symbole (S) et la position (P) qui sert aux calculs relatifs.

| Correction | W, l'endroit écrit | P, la position | S, la valeur |
| --- | --- | --- | --- |
| interne, cible dans un segment de genre 0, 1 ou 3 | la cible | la cible | l'adresse du segment désigné par l'octet `+5` |
| interne, cible dans un segment de genre 2 | **l'image de `.data`** : base + ancien décalage de `.data` + décalage de la cible | **la cible dans le tampon de `.data`** | idem |
| d'import | la cible, résolue dans les segments du module qui importe | la même | l'adresse de l'export (partie 8) |
| « non résolu » (étape 7) | la cible | la même | l'adresse « symbole non résolu » de l'importeur, ou 0 |

- Pour une correction interne, l'adresse du segment désigné doit être non nulle (sinon `0xD9012C15`). Pour un segment de genre 2 ou 3, c'est le tampon fourni par le jeu.
- Une correction d'import dont la cible est dans `.data` est donc écrite **dans le tampon de `.data`**, que le jeu écrase ensuite par sa recopie : voir la partie 10. Pokémon X n'en a aucune.

### Les formules

On note X = S + A − P (sur 32 bits) et d = P − S (signé). Les tests de portée portent sur **d**, sans l'addend. Le bit 0 de S dit si la cible est en Thumb.

| Genre | Nom | Ce qui est écrit en W | Refus |
| --- | --- | --- | --- |
| 0 | R_ARM_NONE | rien | |
| 2 | R_ARM_ABS32 | le mot S + A | |
| 3 | R_ARM_REL32 | le mot X | |
| 10 | R_ARM_THM_CALL (« THM_PC22 ») | deux demi-mots, voir ci-dessous | `0xD9012C23` si d n'est pas strictement compris entre −`0x400000` et `0x400000` |
| 28 | R_ARM_CALL | si S est pair : `0xEB000000` + les bits 2 à 25 de X ; si S est impair : `0xFA000000` + le bit 1 de X placé au bit 24 + les bits 2 à 25 de X | `0xD9012C23` si d n'est pas strictement compris entre −`0x2000000` et `0x2000000` |
| 29 | R_ARM_JUMP24 | l'octet du haut du mot déjà présent en W, gardé tel quel, + les bits 2 à 25 de X | `0xD9012C23` hors portée (comme 28) **ou si S est impair** |
| 38 | R_ARM_TARGET1 | le mot S + A | |
| 42 | R_ARM_PREL31 | le mot A + S′ − P, où S′ est S dont le bit 31 est remplacé par une copie du bit 30 ; les 32 bits sont écrits | |
| autre | | rien | `0xD9012C22` |

**R_ARM_THM_CALL.** Si S est impair (cible Thumb) : premier demi-mot, à l'adresse W, `0xF000` + les bits 12 à 22 de X ; second demi-mot, à W + 2, `0xF800` + les bits 1 à 11 de X (un BL). Si S est pair (cible ARM) : d'abord, si le bit 1 de X est levé, on ajoute 2 à X ; puis le premier demi-mot est `0xF000` + les bits 12 à 22 de X et le second `0xE800` + les bits 1 à 11 de X (un BLX).

Ces formules ont été comparées à la fonction de `ro` exécutée dans un émulateur sur 4 000 cas tirés au hasard, tous genres confondus, portées et refus compris : aucune différence. Dans Pokémon X, les 21 888 corrections d'import (dont celles de `static.crs`) et les 44 151 corrections internes sont toutes du genre 2.

### Défaire une correction

Au déchargement d'un module encore au niveau 0 (marque `CRO0`), `ro` remet à zéro ce que ses corrections ont écrit (`import_relocs_clear`, `internal_reloc_clear`) : le mot entier pour les genres 2, 3, 28, 38 et 42 ; les deux demi-mots pour 10 ; seulement les 24 bits du bas pour 29. Un module fini (`FIXD`) n'est pas « dérelogé ».

## Partie 8 : la résolution des imports

### Qui est cherché, et dans quel ordre

Les modules visibles sont **`static.crs`, puis les modules de la liste automatique dans leur ordre de chargement** (mot 9 non nul). Les modules chargés avec le mot 9 à 0 ne sont jamais cherchés par les autres. Le module en cours de chargement n'est pas encore dans la liste. Pour chaque import, c'est **le premier** module qui convient qui est retenu.

**Trouver un export par son nom** (`cro_find_named_export`, `0x14004fc0`). Si le module n'a pas d'arbre (nombre de nœuds nul) : pas trouvé. Sinon, partir du nœud désigné par l'enfant gauche du nœud 0. Tant que le nœud courant n'est pas une feuille (bit 15 de la référence suivie) : le nœud a pour drapeaux un numéro de caractère (bits 3 à 15) et un numéro de bit (bits 0 à 2) ; si le numéro de caractère est inférieur à la longueur du nom cherché et que ce bit de ce caractère vaut 1, suivre l'enfant droit, sinon le gauche. Arrivé sur une feuille : son champ `+6`, lu comme un nombre signé de 16 bits, est un numéro d'export par nom, qui doit être compris entre 0 et le nombre d'exports exclu. Le nom de cet export doit être exactement le nom cherché. Le résultat est l'adresse étiquetée de l'export résolue dans les segments de l'exportateur ; **si elle est invalide, l'export est « trouvé » avec l'adresse 0**, et l'application de la liste échoue alors (`0xD9012C10`).

**Trouver un module par son nom** : comparaison exacte entre le nom d'une case de la table des modules importés et le champ `0x84` de chaque module visible (identique au champ `0xC0` dans les 134 fichiers ; `|static|` pour `static.crs`).

### Le module qui arrive importe (première moitié de `cro_link`)

1. **Imports par nom**, seulement ceux dont la liste est encore « non résolue » (octet `+6` de la tête à 0) : chercher l'export dans chaque module visible ; au premier trouvé, appliquer la liste avec S = l'adresse de l'export. Une erreur arrête le chargement.
2. **Imports par module** : pour chaque case de la table des modules importés, trouver le module visible de ce nom, puis :
   - **par numéro** (`link_indexed_imports`, `0x14003f00`) : chaque import donne un numéro d'export, qui doit être compris entre 0 et le nombre d'exports par numéro de l'exportateur, exclu (sinon `0xD9012C14`) ; S = l'adresse étiquetée de cette case, résolue dans les segments de l'exportateur ;
   - **anonymes** (`link_anonymous_imports`, `0x14003fc0`) : chaque import donne directement une adresse étiquetée **dans l'exportateur** ; S = cette adresse résolue dans ses segments. C'est le seul genre d'import de Pokémon X : « segment 0 de `|static|`, plus tant ».
   
   Ces deux-là sont appliqués sans regarder l'octet `+6`. Une erreur arrête le chargement. Si aucun module visible ne porte ce nom, rien n'est fait et rien n'est signalé : les corrections gardent la valeur « non résolu » jusqu'à l'arrivée du module (seconde moitié).
3. Appliquer une liste (`reloc_list_apply`, `0x1400519c`) : la tête doit être dans `0x00100000`–`0x0E000000` et S non nul (sinon `0xD9012C10`) ; les corrections sont appliquées une par une jusqu'à celle qui porte la marque « dernière » ; les cibles sont résolues dans les segments **du module qui importe**. Si tout va bien, l'octet `+6` de la tête passe à 1.

### Les autres importent du module qui arrive (seconde moitié de `cro_link`)

Pour chaque module visible (`static.crs` d'abord, puis la liste automatique) :

1. ses imports par nom encore non résolus que le module qui arrive exporte : appliqués avec l'adresse de cet export ;
2. sa première case de module importé dont le nom est celui du module qui arrive : tous ses imports par numéro et anonymes sont appliqués.

**C'est ici que `ro` écrit dans le `.text` du programme principal** : les 331 mots que `static.crs` réserve à ses 78 modules reçoivent l'adresse voulue au chargement du module correspondant.

Un défaut lu dans l'assembleur : dans cette seconde moitié, le résultat des imports par numéro et anonymes **n'est pas regardé** (le code teste une variable restée de l'étape précédente). Une erreur à ce moment est ignorée, et le chargement réussit quand même.

### Ce que `ro` ne fait pas

- Il ne cherche jamais dans les modules hors de la liste automatique, ni dans le module lui-même.
- Il ne vérifie pas qu'un module n'est pas déjà chargé.
- Il n'appelle **aucune** fonction du module : ni `nnroControlObject_` (`0xA0`), ni la fonction de chargement (`0xA4`), ni celle de déchargement (`0xA8`). Ces trois champs ne sont lus nulle part dans `ro`. Seul `0xAC` (« symbole non résolu ») est lu, comme valeur à écrire. Les constructeurs et `OnLoad` sont appelés par le jeu (contrat, partie 6).
- Il ne prévient aucun débogueur (pas de `svcBreak` « LOAD_CRO » : son seul `svcBreak`, à `0x14001420`, sert à s'arrêter sur une erreur interne).

## Partie 9 : UnloadCRO, LinkCRO, UnlinkCRO, Shutdown

### UnloadCRO, pas à pas

`ldrro_UnloadCRO` (`0x14003554`) :

1. Contrôles : session initialisée, poignée, adresse du module alignée sur la page.
2. Ouverture de la fenêtre. `cro_check_mapped` (`0x14004c60`) : la projection doit avoir les droits de la partie 3, la marque être `CRO0` ou `FIXD`, et la taille finie (`0x98`) tenir dans la fenêtre. Puis la case du module est cherchée dans les deux listes (`cro_list_find`, `0x14004e5c`). Échec de l'un ou l'autre : `0xD8A12C0D`.
3. Le module est retiré de sa liste (`cro_list_remove`, `0x14004a68`, qui refuse `static.crs` par `0xD9012C1E`) et sa case rendue.
4. `ro` retient la taille finie et la plage du code.
5. `cro_unload_undo` (`0x14006ccc`) :
   1. **Défaire les liens** (`cro_unlink`, `0x140069d8`). D'un côté, toutes les listes d'import du module (par nom, par numéro, anonymes) reçoivent l'adresse « symbole non résolu » **du module lui-même** (ou 0), et l'octet `+6` de leur tête repasse à 0. De l'autre, pour chaque module visible : ses imports par nom marqués résolus dont le nom est exporté par le module qui part, et tous les imports de sa première case de module importé qui porte le nom du module qui part, reçoivent l'adresse « symbole non résolu » **de ce module visible**, plus l'addend. Pour `static.crs`, c'est `0x4D7BC0` + addend : `0x4D7BC0` pour 315 des 331 mots, `0x4D7BC8` pour les 16 autres.
   2. Si la marque est encore `CRO0` (niveau 0) : les corrections du module sont remises à zéro (partie 7).
   3. **L'en-tête repasse en décalages** (`cro_restore_header`, `0x1400749c`) : les dix-huit champs de la partie 6 et les champs convertis des tables (noms des exports, noms et têtes des imports, trois champs des modules importés) perdent la base ; `0x88`, `0x8C` et `0x98` repassent à 0. **La table des segments** : `.bss` reprend l'adresse 0, et les autres perdent la base ; pour `.data`, cela donne l'adresse du tampon de `.data` moins la base, **un nombre sans rapport avec le fichier**, que le jeu réécrit lui-même. La marque `FIXD` reste ; les tables vidées par la finition gardent la fin de finition moins la base, avec un nombre de 0.
6. Fermeture de la fenêtre ; PROTECT du code en lecture seule ; UNMAP de la projection (taille finie), qui rend le tampon d'origine au jeu en lecture-écriture.

Le mot 2 de la requête n'est pas lu. Le mot 3 (tampon d'origine) ne sert qu'à l'UNMAP. Si l'étape 5 échoue, les droits ne sont pas rendus, alors que la case est déjà libérée.

### LinkCRO et UnlinkCRO

`ldrro_LinkCRO` (`0x14002a4c`) : le module doit être dans une des deux listes et bien projeté (`0xD8A12C0D`) ; `ro` refait les deux moitiés de la liaison (partie 8), sans le changer de liste. `ldrro_UnlinkCRO` (`0x14003434`) fait la même vérification puis seulement l'étape 5.1 de UnloadCRO.

### Shutdown

`ldrro_Shutdown` (`0x14003788`) remet l'en-tête de `static.crs` en décalages (sans toucher à sa table de segments, `crs_shutdown_restore`, `0x14007bbc`), défait sa projection (taille : son champ `0x90`) vers l'adresse du mot 1, et remet la session à « non initialisée ». Il ne décharge ni les modules ni les `.crr`.

## Partie 10 : `.data`, `.bss`, et la différence entre les commandes 4 et 9

**Ce que `ro` fait de `.data` :** il remplace l'adresse du segment par le tampon du mot 4 (après avoir vérifié la taille contre le mot 6), écrit les corrections internes qui visent `.data` **dans l'image de `.data` à l'intérieur du module** (avec des calculs relatifs faits comme si elle était déjà dans le tampon), et ne copie rien. Toute correction interne dont la valeur est dans `.data` reçoit l'adresse dans le tampon. C'est bien le jeu qui recopie `.data` après la réponse.

**Ce que `ro` fait de `.bss` :** il remplace l'adresse du segment par le tampon du mot 7 (taille vérifiée contre le mot 8), et c'est tout. Il n'efface rien ; le jeu le fait.

`ro` n'écrit jamais dans les tampons de `.data` et `.bss`, **sauf** pour les corrections d'import dont la cible est dans `.data` : elles sont résolues dans la table de segments, qui pointe alors vers le tampon. Avec LoadExeCRO (commande 4), elles y sont écrites au chargement, puis écrasées par la recopie du jeu ; c'est sans doute ce défaut que LoadCRO_New (commande 9, ajoutée en 7.2.0 d'après 3dbrew) vient corriger (interprété). Seule différence entre les deux fonctions : pendant la première moitié de la liaison, `cro_link_data_in_image` (`0x140066a4`, appelée par `cro_prepare_and_link_new`, `0x14006980`) remplace provisoirement l'adresse du **segment numéro 2** par l'image de `.data`, puis la remet. Les corrections d'import du module qui arrive qui visent `.data` sont alors écrites dans l'image, comme les corrections internes. Cela suppose que le segment 2 est `.data`, ce qui est vrai dans les 133 modules. Pokémon X utilise la commande 4 et n'a aucune correction d'import dans `.data` : il ne voit pas la différence.

## Partie 11 : les tables en mémoire

**Le contexte d'une session** (`0x348` octets, deux au plus, réserve à `0x1400aaa8`, construit par `session_ctor`, `0x14005658`) :

| Décalage | Contenu |
| --- | --- |
| `+0x000` | tête de la liste automatique (une case) |
| `+0x004` | tête de l'autre liste |
| `+0x008` | adresse projetée de `static.crs` ; 0 = session non initialisée |
| `+0x00C` | 64 cases de 12 octets : suivant, précédent, adresse du module |
| `+0x30C`, `+0x310` | premier et dernier `.crr` chargé |
| `+0x314` | l'identifiant du programme (bits `0x0FFFFF00` du numéro de titre), `0xFFFFFFFF` avant Initialize |
| `+0x318` | la réserve des 64 cases ; case libre suivante à `+0x33C`, nombre de cases prises à `+0x344` |

Les deux premiers mots et le troisième ont la forme d'une case : le contexte sert lui-même de case pour `static.crs`, d'où le parcours « `static.crs` puis la liste automatique ».

**Les listes de modules.** Chaque liste est une chaîne de cases. Le champ « suivant » du dernier est nul ; **le champ « précédent » du premier pointe sur le dernier**. Les en-têtes des modules suivent les mêmes liens : `0x88` = module suivant, `0x8C` = module précédent (pour le premier : le dernier). Dans l'en-tête de `static.crs`, `0x88` désigne le premier module de la liste automatique et `0x8C` le premier de l'autre liste. Un module retiré a ses deux champs remis à 0.

**Les `.crr`** : liste doublement chaînée par leurs mots `0x08` (suivant) et `0x0C` (précédent), sans tête dans le fichier.

**Les données du module `ro`** :

| Adresse | Contenu |
| --- | --- |
| `0x14009020` | fiche du service : nom `ldr:ro`, deux sessions, gestionnaire `0x14005c2c` |
| `0x1400A000` | clé publique RSA des `.crr` des consoles du commerce, 256 octets |
| `0x1400A100` | l'autre clé (bit 0 de `0x1FF80014` à 0) |
| `0x1400A200` | poignée de `fs:USER` |
| `0x1400A224`, `0x1400A228` | `ps:ps` ouvert ou non, sa poignée |
| `0x1400A270` | nombre de poignées surveillées |
| `0x1400A27C` | drapeau d'arrêt |
| `0x1400A28C` | sémaphore des notifications |
| `0x1400B69C` | par session : son type et son contexte |
| `0x1400B770` | liste des poignées surveillées |

## Partie 12 : les appels système et les services appelés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x140021d8` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x14000168` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x14001428` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x14000e54` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x14003ed4` |
| CloseHandle | `0x23` | `svcCloseHandle`, et 70 fois écrit sur place | `0x140023d8` |
| WaitSynchronization1 | `0x24` | sur place | `0x140023a8` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x140021c0` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x14001084` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x1400106c` |
| SendSyncRequest | `0x32` | sur place, dans chacune des 11 fonctions de requête | |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x14001230` |
| Break | `0x3C` | appelé par `panic_break` | `0x14001420` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x14000698` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x140006b0` |
| ControlProcessMemory | `0x70` | `svcControlProcessMemory` | `0x14004fa8` |
| MapProcessMemory | `0x71` | sur place, 9 fois | |
| UnmapProcessMemory | `0x72` | sur place, 9 fois | |
| QueryProcessMemory | `0x7D` | `svcQueryProcessMemory` | `0x1400526c` |

Les 19 sont dans la liste que l'exheader autorise.

| Service | Commande | En-tête | Fonction | Pour quoi |
| --- | --- | --- | --- | --- |
| `srv:` | RegisterClient, EnableNotification, RegisterService, UnregisterService, GetServiceHandle, ReceiveNotification | `0x00010002`, `0x00020000`, `0x00030100`, `0x000400C0`, `0x00050100`, `0x000B0000` | `0x14000da0`, `0x14000ddc`, `0x14000ab8`, `0x14000b14`, `0x14000d6c`, `0x14000e18` | la vie du service |
| `fs:USER` | Initialize | `0x08010002` | dans `fs_init` | |
| `fs:USER` | GetProgramLaunchInfo | `0x082F0040` | `FS_GetProgramLaunchInfo`, `0x140022a8` | le numéro de titre du client (Initialize) |
| `fs:USER` | UpdateSha256Context | `0x084E0342` | `FS_UpdateSha256Context`, `0x14002224` | le SHA-256 des grandes plages d'un `.cro` |
| `ps:ps` | VerifyRsaSha256 | `0x00020244` | `PS_VerifyRsaSha256`, `0x140024d4` | les deux signatures d'un `.crr` |
| `err:f` | Throw | `0x00010800` | `ERRF_Throw`, `0x140013e8` | une erreur fatale de `ro` lui-même |

## Partie 13 : ce qu'un chargeur de `.cro` sur PC doit reproduire

Résumé des règles précédentes, pour Pokémon X (commande 4, liaison automatique, niveau 1, aucun import par nom ni par numéro, une seule sorte de relocation) :

1. À Initialize : convertir l'en-tête de `static.crs`, et écrire dans les 331 mots du programme principal l'adresse « symbole non résolu » (`0x4D7BC0`) plus l'addend.
2. Pour chaque module, dans l'ordre de chargement : convertir l'en-tête (dix-huit champs, plus les champs des tables), remplacer les adresses des segments (base + décalage pour le code et les données en lecture seule, tampons du jeu pour `.data` et `.bss`), remplir toutes les corrections d'import avec sa propre adresse « non résolu » ou 0, appliquer les corrections internes (écrites dans l'image de `.data` quand la cible est dans `.data`), puis résoudre ses imports contre `static.crs` et les modules déjà chargés, puis brancher les imports de `static.crs` et des modules déjà chargés sur lui.
3. Le finir au niveau 1 : marque `FIXD`, tables `0x120` à `0x134` vidées, taille finie rendue et écrite en `0x98`.
4. Au déchargement : rebrancher sur « non résolu » tout ce qui pointait vers lui et tout ce qu'il importait, remettre l'en-tête en décalages comme en partie 9.

Des images de référence, produites en exécutant le code même de `ro` sur des modules de Pokémon X, permettent de comparer un chargeur octet par octet (partie 14).

## Partie 14 : recoupements

### Avec le côté jeu ([contrat des petits services](contrat-petits-services.md), partie 6)

**Ce qui s'accorde :**

- **La forme des quatre commandes**, mot pour mot : les mots que l'aiguillage lit sont ceux que le jeu écrit, avec les zéros aux mêmes places. Le mot 9 est bien lu comme un octet et le mot 10 comme le niveau de finition.
- **`.data` et `.bss` sont l'affaire du jeu.** `ro` ne recopie pas `.data` et n'efface pas `.bss` ; il laisse `.data` corrigé dans l'image (partie 10). La correction que le contrat apportait à l'inventaire est confirmée.
- **Les champs que le jeu lit comme des adresses** (`0xB0`, `0xB8`, `0xC8`, `0xF8`, et le premier mot de chaque segment) sont bien convertis par `ro`, avec le tampon du mot 4 pour `.data` et celui du mot 7 pour `.bss`.
- **La taille rendue au mot 2** est la taille finie, celle que le jeu utilise pour couper sa recopie de `.data` entre le miroir et le tampon d'origine ; et les pages coupées reviennent bien au tas avec leurs corrections (partie 3).
- **`FIXD`** : `ro` remplace la marque dès que le niveau n'est pas 0. La branche du jeu qui exige `CRO0` au déchargement ne s'exécute donc jamais, comme le contrat le supposait.
- **Au déchargement**, `ro` remet l'en-tête en décalages et `.bss` à 0, mais laisse pour `.data` un nombre sans rapport : le jeu réécrit justement le décalage de `.data` lui-même. Les deux côtés s'emboîtent.
- **L'octet `+6`** d'une correction d'import est bien le drapeau « résolue » lu par `ro_Module_IsAllSymbolResolved`.
- **L'objet de contrôle, OnLoad, OnExit** : `ro` ne les lit pas ; c'est bien le jeu qui les appelle.
- **LoadCRR** : `ro` passe bien le tampon en lecture seule. Il ne lit pas les informations de mise au point (`0x10`, `0x14`) : c'est bien le jeu qui prévient un débogueur.
- **Les mots du `.text` principal** : `ro` les écrit au chargement de chaque module et les remet à « symbole non résolu » au déchargement. Le contrat demandait qu'un remplaçant puisse écrire dans le `.text` principal : `ro` le fait par sa fenêtre.

**Ce qui précise ou corrige le contrat :**

| Le contrat dit | Le module montre |
| --- | --- |
| « avant le chargement, chacun [des 331 mots] contient `0x4D7BC0` », et un remplaçant doit « remettre `0x4D7BC0` » au déchargement | c'est `0x4D7BC0` **plus l'addend** : 16 des 331 corrections ont un addend de 8, et leurs mots valent `0x4D7BC8` dès Initialize et après chaque déchargement. Vérifié en exécutant `ro` |
| mot 5 de LoadExeCRO : « 0 » | doit être 0, sinon `0xE1612C1D` |
| mot 11 : « 0 » | adresse d'un `.crr` chargé contre lequel vérifier ; 0 = tous |
| UnloadCRO, mot 2 : « 0 » | n'est pas lu |
| « refuse si la session est déjà ouverte (`0xE0A12FF9`) » | c'est le contrôle du jeu ; `ro`, lui, rend `0xD9612FF9` si Initialize est envoyé deux fois sur la même session |
| un remplaçant doit « remplir dans le `.text` du programme principal les mots que `static.crs` réserve à ce module » | oui, et plus largement brancher **tous** les modules déjà chargés qui importent celui-ci (seconde moitié de la liaison), même si Pokémon X n'a que des imports vers `|static|` et entre ses modules par adresse |
| « garder le fichier entier visible aux deux adresses » | `ro` ne garde visible au miroir que la taille finie ; le reste n'est visible que dans le tampon d'origine. Le conseil du contrat reste valable pour un portage : le jeu lit chaque octet au bon endroit dans les deux cas |

### Avec le format ([Pokémon X, services](pokemon-x-services.md), partie 5)

- Les empreintes : `0x00` couvre `0x80` jusqu'au code (`0x180` dans tous les fichiers, d'où le « `0x80` à `0x180` » de l'inventaire) ; `0x40` du nom du module jusqu'aux données ; `0x60` n'est pas vérifiée par `ro`.
- « Ce que `ro` devra faire » (réserver `.bss`, placer les segments) : déjà corrigé par le contrat, confirmé ici.
- Les 134 fichiers passent tous les contrôles de la partie 6 recalculés hors de la console : ordre des décalages, tables dans le fichier, champs `0x88`, `0x8C`, `0x98` à 0, empreintes, présence dans `static.crr`, nœuds de l'arbre dans les bornes, dernière correction d'import marquée.

### Avec 3dbrew (« RO Services », « CRO0 », « CRR0 »)

| 3dbrew | Le module |
| --- | --- |
| le code de la relocation R_ARM_THM_PC22 écrit `0xF000…` dans le demi-mot du haut et `0xF800…` dans celui du bas, sans masque | `ro` écrit `0xF000` + 11 bits **à l'adresse W** et `0xF800` (ou `0xE800`) + 11 bits à W + 2, chaque champ masqué à 11 bits. Le code de 3dbrew est faux sur ce point |
| R_ARM_PREL31 : `(base << 1) >> 1` | décalage arithmétique : le bit 30 de S est recopié dans le bit 31 |
| « only one CRR can be loaded at a time » | `ro` tient une liste, sans limite visible |
| CRR `0x358` : « offset to the plain region » | `ro` s'en sert comme fin de la zone signée (`0x1400` dans `static.crr`, la fin de la table) |
| `E0A12FF9` : « Service is already Initialized » | `ro` rend `0xD9612FF9` |
| LoadExeCRO, mots 5 et 11 : « Usually zero? » | mot 5 obligatoirement 0 ; mot 11 = un `.crr` précis |
| « RO expects only one of executable, read/write and zero-initialized segments » | rien ne compte les segments : plusieurs segments `.data` iraient tous au même tampon ; seul le premier segment de code est passé en exécution |
| le reste des pages « RO Services » et « CRO0 » (ordre des mots, sens des octets d'une correction, arbre des exports, `nnroAeabiAtexit_`, `FIXD`) | conforme |

### Avec les autres fiches

- [loader](loader.md) : même adresse de chargement (`0x14000000`) et même démarrage (`clear_bss`, `init_runtime_and_srv`, initialiseurs en Thumb, boucle à sémaphore de notifications, port et sessions).
- [sm](sm.md) : `ro` déclare `ldr:ro` par RegisterService avec deux sessions ; il ouvre `fs:USER` et `ps:ps`, les deux seuls noms autorisés par son exheader.
- [fs](fs.md) : GetProgramLaunchInfo (`0x082F0040`, réponse `0x082F0140`, quatre mots lus par `ro`) et UpdateSha256Context (`0x084E0342`) sont dans la table de `fs:USER`.
- [cfg](cfg.md) et [dsp](dsp.md) : même façon de vérifier une signature (SHA-256 calculé sur place, RSA confié à `ps:ps`) et, comme `cfg`, choix de la clé publique par le bit 0 de `0x1FF80014`.

### Vérifications faites en exécutant le code de `ro`

Le code de `ro` lui-même (sans les appels système ni les contrôles IPC) a été exécuté dans un émulateur sur la mémoire de Pokémon X reconstituée : programme principal à `0x100000`, `static.crs` projeté, puis DllTitle, DllZukan, DllBackGround et DllTownmap chargés au niveau 1 avec liaison automatique, puis DllTownmap déchargé ; et un second lot (DllBackGround, DllTownmap, DllZukan, DllBattle, DllCaptureRegister). Tous les appels réussissent. On y voit : les 16 mots `0x4D7BC0` → `0x4D7BC8` à Initialize ; `0x35078C` qui reçoit `0x0111E310`, soit « segment 1 de DllTitle plus `0x1308` plus 8 » comme le dit le contrat ; DllZukan branché sur DllTownmap par la seconde moitié de la liaison quand DllTownmap arrive après lui (44 mots), puis rebranché sur 0 quand il part (DllZukan n'a pas de fonction « non résolu ») ; l'en-tête de DllTownmap remis en décalages, avec `FIXD`, et `.data` à « tampon moins base ».

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 9 commandes, leur fonction, leur en-tête de requête exigé et leur en-tête de réponse : le pseudo-code de l'aiguillage d'un côté, `emulate_dispatch.py` de l'autre ; les en-têtes de requête sont ceux de 3dbrew.
- Les formules de relocation : lues dans l'assembleur de `apply_relocation`, puis comparées à la fonction exécutée sur 4 000 cas.
- Les contrôles de l'en-tête et la vérification des empreintes : lus dans le code, puis recalculés sur les 134 fichiers de Pokémon X, qui passent tous.
- La vérification d'un `.crr` : clé choisie, exposant, plages signées, recalculées hors de la console sur `static.crr` (les deux signatures se vérifient, la seconde clé échoue).
- Le traitement d'un module (conversion, segments, corrections, liaison dans les deux sens, finition, déchargement) : lu dans le pseudo-code, puis observé en exécutant ce même code sur deux lots de modules de Pokémon X. Les valeurs obtenues collent à ce que le jeu attend (contrat, partie 6).
- La fenêtre `0x00100000`–`0x0E000000` : les mêmes arguments aux 18 sites de `svcMapProcessMemory` et `svcUnmapProcessMemory`, relevés dans l'assembleur.
- Les droits posés par `svcControlProcessMemory` : arguments relevés dans l'assembleur aux 16 appels, et attendus de nouveau par `cro_check_mapped`.
- `ro` ne lit jamais `0xA0`, `0xA4`, `0xA8` : aucun accès à ces décalages dans tout l'assembleur.

**Interprété à la lecture, à relire dans Ghidra**
- Le sens des genres de mémoire et de droits rendus par `svcQueryProcessMemory` (« privée », « alias de code ») : d'après la numérotation habituelle du noyau, pas d'après ce module.
- Le choix de clé « console du commerce » pour le bit 0 de `0x1FF80014` : la clé de `0x1400A000` vérifie bien le fichier de la console, l'étiquette vient de `cfg`.
- Le rôle de la table `0x120`/`0x130` (« un module corrige le programme principal ») : lu dans le code, jamais vu en action, vide dans Pokémon X.
- Ce que deviennent les pages du tampon d'origine pendant qu'elles sont projetées (inaccessibles au jeu) : comportement du noyau, pas de `ro`.
- Le défaut de la seconde moitié de la liaison (résultat ignoré) : lu dans l'assembleur, pas provoqué.
- Les niveaux de finition 2 et plus, et le niveau 4 et au-delà : lus, jamais exécutés.

**Pas lu**
- Le détail de la bibliothèque de démarrage : tas (`heap_alloc` et ses aides), verrous légers (`0x14001248` à `0x14001434`), gestion des erreurs fatales (`handle_fatal_result`, `throw_fatal_error`).
- Le corps des trois fonctions de copie (`0x14001a9c`, `0x1400529c`, `0x14005324`) et du calcul SHA-256 logiciel : nommés ou non d'après leurs appelants.
- Les fonctions d'initialisation des objets globaux (`0x14007cc4` à `0x140082d8`), sauf celle des contextes.
- Le comportement exact sur une console de développement (seconde clé).
- Les retouches que Luma fait peut-être à `ro` au chargement.
- 57 fonctions restent sans nom.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Appels système, enveloppes, fonctions manquées | `outils/prescan.py`, deux passages (147 puis 180 fonctions, « aucune » au second) | quelques secondes par passage, pont ouvert |
| Pseudo-code de toutes les fonctions, assembleur du module | `prescan.py --dump` | quelques secondes |
| Table des commandes, second avis | `outils/emulate_dispatch.py ro 0x14005c2c=ldr:ro` | une minute |
| Lire le pseudo-code et l'assembleur, nommer | Claude, avec un petit désassembleur qui résout les constantes et cherche les appelants | le gros du temps |
| Recalculer les contrôles sur les 134 fichiers, vérifier les signatures du `.crr` | deux scripts Python | immédiat |
| Comparer les formules de relocation à la fonction exécutée | un script, avec unicorn | une minute |
| Exécuter le chargement de modules réels avec le code de `ro` | un script, avec unicorn | une minute par lot |
| Recharger les noms dans REA et vérifier qu'ils sortent | relance du pont, troisième passage de prescan | deux minutes |
| Rédiger et recouper avec le contrat, l'inventaire, 3dbrew | Claude | le reste |

Les scripts sont dans `local/analyse/ro/` (non versionnés) : `disasm.py`, `check_cros.py`, `check_crr.py`, `check_reloc.py`, `emulate_load.py`. Le dernier range dans `local/analyse/ro/reference/` les images des modules après chargement et après déchargement, et la liste des mots du programme principal modifiés à chaque étape : ce sont les références à comparer avec un chargeur sur PC. Les pages de 3dbrew sont celles déjà gardées dans `local/analyse/contrat-petits/3dbrew/`.

**Les pièges rencontrés.**

- **Le pont ne démarrait pas avec les graines depuis Git Bash** : la variable `REA_GHIDRA_SEED_FILE=/mnt/c/…` passée en argument est réécrite en chemin Windows par la couche MSYS ; REA refuse alors de démarrer (« must be absolute ») et le pont plante sur un `OSError` sans dire pourquoi. Lancé depuis PowerShell, il démarre.
- **Les appels système écrits sur place** (`MapProcessMemory`, `UnmapProcessMemory`, `CloseHandle`) perdent leurs arguments dans le pseudo-code : tout ce qui touche à la fenêtre a été relu dans l'assembleur.
- **Le pseudo-code ment sur les retours** de `cro_fix` et `cro_unload_undo` (déclarées sans valeur, alors que l'appelant utilise `r0`) et sur le test d'erreur de la seconde moitié de la liaison. Ces trois points ont été relus dans l'assembleur.

**Pour reprendre.** `ro.noms.tsv` se recharge par `REA_GHIDRA_SEED_FILE` ; les deux fonctions Thumb y sont en lignes `label` et prennent leur nom. Les suites utiles : lancer un chargeur sur PC contre les images de référence, et rejouer `emulate_load.py` sur l'ordre de chargement réel des écrans du jeu.
