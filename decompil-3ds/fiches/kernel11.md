# kernel11, le noyau du processeur ARM11

`kernel11` est le noyau du processeur applicatif. Tous les autres programmes de la console, le jeu compris, tournent au-dessus de lui : il crée les processus et les fils, répartit les quatre cœurs, tient la mémoire, transporte chaque requête d'un programme à un service, et sert les 126 appels système (`svc`). Ce n'est pas un module : il n'a ni exheader ni `code.bin`. C'est une image brute qui se recopie en partie et active elle-même la traduction d'adresses au démarrage.

Fiche du 14 octobre 2026, produite avec Ghidra lancé directement sous Ubuntu, sur l'image extraite du NATIVE_FIRM de la console. Ce FIRM est celui de la NAND : Luma3DS le patche au démarrage, en mémoire seulement. Ce qui est lu ici est donc le noyau d'origine de Nintendo. **Les adresses sont celles où le code tourne** : virtuelles (`0xFFFxxxxx`) pour le noyau, physiques (`0x1FFAFxxx`) pour le code de démarrage, qui s'exécute avant la traduction d'adresses.

## Carte d'identité

| | |
| --- | --- |
| Conteneur | `NATIVE_FIRM` de la New 3DS (titre `0004013820000002`), `local/dump/systeme/native.firm`, 999 424 octets |
| Section | n° 1 du FIRM : 212 992 octets (`0x34000`) chargés à `0x1FF80000`, méthode de copie 1 (lu dans l'en-tête du FIRM) |
| Fichier lu | `local/extrait/firm/firm_1_1ff80000.bin` |
| Point d'entrée ARM11 | `0x1FFAF064` (en-tête du FIRM, mot `+0x08`). Le point d'entrée ARM9 est `0x0801B01C` |
| Version | noyau **2.58-0**, écrite par le noyau dans la page de configuration (partie 9). Version du SDK du noyau : `0xF450` |
| Langage | ARM (ARMv6K) partout, sauf une fonction Thumb de démarrage (`0x1FFB0438`) et une petite fonction à `0xFFF149E4` |
| Fonctions | 988 : 39 + 1 Thumb dans le démarrage, 589 + 1 Thumb dans le bas du code, 337 dans le haut, 21 dans la page des vecteurs |
| Fonctions nommées | 359 sur 988 dans `kernel11.noms.tsv`, plus 67 étiquettes de données (tables virtuelles, réserves, variables) |
| Appels système | 126 cases dans la table (`0x00`–`0x7D`) : 97 font quelque chose, 12 rendent « non implémenté » (`0xF8C007F4`), 17 sont vides |
| Objets du noyau | 20 classes nommées dans l'image (`KAutoObject`… `KTimer`), 21 réserves d'objets de taille fixe |
| Cœurs | quatre sur la New 3DS ; le noyau lit leur nombre dans le contrôleur du MPCore (`(mot à 0x17E00004 & 3) + 1`) |

## Partie 1 : l'image et la carte des adresses

La section n'est pas posée en mémoire d'un seul bloc. Le code de démarrage en recopie quatre morceaux ailleurs, puis construit les tables de pages qui donnent à chaque morceau son adresse virtuelle. Le découpage ci-dessous est lu à deux endroits indépendants : les appels de recopie du démarrage (`0x1FFB0100`–`0x1FFB0184` et `0x1FFB00AC`) et les tables de pages elles-mêmes, que `boot_build_page_tables` (`0x1FFAF5A4`) écrit et qu'on a fait construire dans un émulateur (méthode, à la fin).

| Morceau | Position dans la section | Taille | Adresse physique | Adresse virtuelle | Droits |
| --- | --- | --- | --- | --- | --- |
| Code, bas | `0x00000` | `0x20000` | `0x1FF80000` (laissé en place) | `0xFFF00000` | lecture, exécution |
| Code, haut | `0x20000` | `0xE000` | recopié à `0x1FFDE000` | `0xFFF20000` | lecture, exécution |
| Vecteurs d'exception | `0x2E000` | `0x1000` | recopié à `0x1FFF4000` | `0xFFFF0000` | lecture, exécution |
| Démarrage | `0x2F000` | `0x3000` | `0x1FFAF000` (laissé en place) | identité, puis abandonné | lecture, exécution |
| Données en lecture seule | `0x32000` | `0x1000` | recopié à `0x1FFEC000` | `0xFFF2E000` | lecture |
| Données | `0x33000` | `0x180` | recopié à `0x1FFED000` | `0xFFF2F000` | lecture, écriture |
| Données à zéro | — | jusqu'à `0x5000` | `0x1FFED180`–`0x1FFF2000` | `0xFFF2F180`–`0xFFF333B0` | lecture, écriture |

Le reste de la section (`0x33180`–`0x34000`) est du remplissage à `0xFF`. Le démarrage vérifie l'alignement de chaque destination sur une page et s'arrête sur une instruction `bkpt` numérotée `0x57` à `0x5A` s'il est faux.

**Le reste de l'espace du noyau**, lu dans les tables de pages (identiques pour les quatre cœurs, sauf les pages propres à chaque cœur) :

| Adresses virtuelles | Adresses physiques | Contenu |
| --- | --- | --- |
| `0xD8000000`–`0xD8600000` | `0x18000000` | mémoire vidéo (VRAM), sans exécution |
| `0xDF000000`–`0xDF400000` | `0x1F000000` | mémoire supplémentaire de la New 3DS |
| `0xDFF00000`–`0xE0000000` | `0x1FF00000` | mémoire AXI (là où le FIRM a posé les cinq modules, puis la mémoire du noyau) |
| `0xE0000000`–`0xF0000000` | `0x20000000` | toute la FCRAM (256 Mo), en « supersections » de 16 Mo, sans exécution : la vue du noyau sur la mémoire des processus |
| `0xFF400000` et au-dessus | allouées | piles noyau des fils, une page chacune (d'après l'allocateur, partie 7) |
| `0xFFF70000`–`0xFFFAE000` | `0x1FFA0000`–`0x1FFDE000` | réserves des objets du noyau (l'ancien emplacement de l'image, réutilisé) |
| `0xFFFB8000`–`0xFFFC9000` | registres | une page par périphérique : cache L2 de la New 3DS (`0x17E10000`), `0x10144000` (I²C, interprété : le noyau parle au microcontrôleur pour redémarrer), `0x10400000` (GPU), `0x10141000`, `0x10163000` (PXI), `0x10146000` (boutons), `0x10202000` (LCD), `0x10140000` (CFG11), `0x10206000` |
| `0xFFFCA000`–`0xFFFED000` | AXI et mémoire New 3DS | pour chaque cœur n : sa table de pages (`0xFFFCA000 + 0x9000·n`), ses piles d'exception, sa page locale (`0xFFFD1000 + 0x9000·n`) |
| `0xFFFEE000`–`0xFFFF0000` | `0x17E00000` | registres privés du MPCore (contrôleur SCU, minuteries, contrôleur d'interruptions) |
| `0xFFFF0000` | `0x1FFF4000` | vecteurs d'exception (vecteurs « hauts », bit V du registre de contrôle) |
| `0xFFFF2000`, `0xFFFF7000`, `0xFFFF9000` | propres au cœur | **la même adresse virtuelle montre une page différente sur chaque cœur** : sa table de pages, sa pile, et surtout sa page locale |

La page locale du cœur, à `0xFFFF9000`, sert partout : le mot `+0x0` est le fil en cours sur ce cœur (un `KThread`), `+0x4` le processus en cours (un `KProcess`), `+0x8` l'ordonnanceur du cœur. La même page est visible de tous les cœurs à `0xFFFD1000 + 0x9000·n`.

Les tables de pages : une par cœur (`0x1FFF8000`, `0x1FFFC000`, `0x1F3F8000`, `0x1F3FC000`, adresses physiques ; les cœurs 2 et 3, propres à la New 3DS, ont les leurs dans la mémoire supplémentaire). Le registre TTBCR vaut 2 : la moitié basse de l'espace, `0x00000000`–`0x3FFFFFFF`, est traduite par la table du processus en cours, le reste par celle du noyau. Un processus a donc 1 Go d'adresses à lui.

## Partie 2 : le démarrage, pas à pas

Les quatre cœurs entrent ensemble à `0x1FFAF064`, traduction d'adresses coupée.

1. **Remise à plat** (`boot_reset_control_and_caches`, `0x1FFAF474`). Interruptions coupées, registre de contrôle à `0x00054078` (traduction et caches coupés), caches et TLB invalidés, tous les registres à zéro.
2. **Qui suis-je.** Le numéro du cœur vient du registre MPIDR, le nombre de cœurs du SCU. Une table de quatre petites fonctions (`0x1FFAF148`) donne à chaque cœur ses trois piles. Pour le cœur 0 : `0xFFFF3000` pour les piles d'exception, `0x1FFF3000` (physique) pour la pile de démarrage, `0xFFFF7F38` pour la pile du noyau.
3. **Les piles** des modes FIQ, IRQ, abandon, instruction indéfinie et superviseur sont posées. Les modes système et FIQ reçoivent `0xFFFF0000` comme adresse de retour : une erreur à ce stade retomberait dans les vecteurs.
4. **`boot_setup_core_and_enable_mmu`** (`0x1FFAFC78`, avec le numéro du cœur) :
   - sur la New 3DS (bit 1 de `0x10140FFC`), le cœur 0 règle l'horloge du MPCore (`0x10141300` à 3, ou à 5 si le bit 2 est posé) et attend l'interruption qui confirme le changement ;
   - chaque cœur charge sa table de pages (TTBR0 et TTBR1), règle TTBCR à 2 et le domaine 0 en « client », puis construit ses tables (`boot_build_page_tables`, `0x1FFAF5A4`). Le cœur 0 active le SCU ;
   - registre de contrôle auxiliaire `| 0x2F` (mode SMP, entre autres), registre de contrôle `| 0x00C03805` : traduction d'adresses, caches, prédiction de branchement, vecteurs hauts, pages au format ARMv6 ;
   - le cœur 0, sur la New 3DS, règle et active le cache L2 (registres à `0xFFFB8100`…`0xFFFB8F80`), puis recopie les vecteurs, les données, les données en lecture seule et le haut du code (partie 1).
5. **`boot_finish_core_setup`** (`0x1FFAF168`) :
   - accès au coprocesseur flottant ouvert (CPACR) ;
   - le cœur 0 met à zéro les données à zéro (`0xFFF2F180`–`0xFFF333B0`) et appelle les 21 constructeurs de la table à `0x1FFB045C`, par `boot_run_static_constructors` (`0x1FFB0438`, en Thumb) ;
   - il recopie la page des paramètres de lancement du FIRM, que le FIRM précédent a laissée au tout début de la FCRAM, vers `0x1FFA0000`. Si l'information de démarrage (`0x1FFB0414`) le dit, la page est zéro à la place ;
   - il écrit `0x550` dans le registre `0x10140140` de CFG11 ;
   - les autres cœurs attendent une interruption logicielle du cœur 0 (`wfi`), qui les réveille ensuite un par un.
6. **Saut au noyau**, à `kernel_main` (`0xFFF00030`), en adresses virtuelles.

**`kernel_main`, sur chaque cœur :**

7. `init_core_local_region` (`0xFFF015BC`) prépare la page locale du cœur et un fil « de repos » qui y est rangé à `+0x18` ; ce fil devient le fil courant (`0xFFFF9000`).
8. L'ordonnanceur, les minuteries et le contrôleur d'interruptions du cœur sont préparés (`0xFFF02EF8`, `0xFFF01A8C`, `scheduler_init_core` `0xFFF00648`). Entre chaque étape, `all_cores_barrier` (`0xFFF1C124`) fait attendre les quatre cœurs les uns les autres.
9. **Cœur 0 seulement : la mémoire.**
   - `compute_fcram_regions` (`0xFFF010E0`) lit le type de mémoire d'application (`APPMEMTYPE`) dans les paramètres de lancement, si leur CRC32 (`0xFFF033E4`) est bon, et découpe la FCRAM en trois régions :

     | Région | Début | Taille si `APPMEMTYPE` = 7 | Taille sinon |
     | --- | --- | --- | --- |
     | APPLICATION (`0x100`) | `0x20000000` | `0x0B200000` (178 Mo) | `0x07C00000` (124 Mo) |
     | SYSTEM (`0x200`) | à la suite | `0x02E00000` | `0x06400000` |
     | BASE (`0x300`) | à la suite | `0x02000000` (32 Mo) | `0x02000000` |

     Un `APPMEMTYPE` autre que 7 ou 8 est ramené à 6. La réserve « 64 Mo » d'une application de l'ancienne 3DS n'est pas faite ici : la région fait 124 Mo, et c'est la limite de ressources posée par `pm` qui borne l'application (interprété).
   - `memory_manager_init` (`0xFFF028A8`) pose les trois régions dans le gestionnaire de mémoire (`0xFFF328A4`).
   - Le tas des objets du noyau est installé à `0xFFF70000`. Puis 21 réserves d'objets de taille fixe y sont découpées par `slab_heap_init` (`0xFFF14894`), avec leur taille et leur nombre (partie 4).
10. Cœur 1 seulement : `0xFFF01764`, `0xFFF02000`, et `core1_init_timer_interrupts` (`0xFFF00768`), qui lie les interruptions `0x39` et `0x3A` (minuteries, interprété).
11. Chaque cœur démarre un **fil de travail du noyau** (`start_core_work_thread`, `0xFFF00DBC`) : il exécute les tâches que les interruptions lui confient (`core_work_thread_main`, `0xFFF029B0`) puis se rendort. Les interruptions sont ouvertes.
12. **Cœur 0 seulement : les pages partagées et les premiers processus.**
    - Deux pages sont prises dans la région BASE (`allocate_kernel_shared_page`, `0xFFF00B00`) : la future page de configuration et la page partagée. `init_config_memory` (`0xFFF01404`) remplit la première (partie 9).
    - **`create_firm_modules`** (`0xFFF00EA4`) crée les cinq processus du FIRM (ci-dessous).
    - L'état du démarrage (`0xFFF2F0C8`) passe de 1 à 2. `write_slab_heap_info_page` (`0xFFF007FC`) écrit le tableau des réserves (adresse, nombre, taille) dans une page (rôle interprété : une aide au débogage).
13. `switch_to_first_thread` (`0xFFF0201C`) donne au fil de repos la priorité `0x40`, plus basse que toute priorité permise à un programme (0 à `0x3F`), et passe la main. Le fil de repos tourne ensuite dans une boucle `wfi` : un cœur sans travail dort.

**Les cinq processus du FIRM** (`create_firm_modules`, `0xFFF00EA4`). Le FIRM a posé ses cinq modules à `0x1FF00000`, dans la mémoire AXI, sous forme de NCCH (des conteneurs de titre) collés bout à bout. Le noyau les lit à `0xDFF00000` (la même mémoire, vue du noyau), dans leur ordre. Pour chacun :

1. **L'exheader.** `ncch_read_exheader_info` (`0xFFF1B65C`) y lit la priorité (octet `+0x20F`), le cœur idéal (bits 0-1 de `+0x20E`), le masque des cœurs permis (bits 2-3 de `+0x20E`), la taille de la pile (`+0x1C`), et recopie les 28 capacités du noyau (`+0x370`).
2. **Le code.** `load_firm_module_code` (`0xFFF025A8`) prend des pages dans la région BASE et y recopie le fichier `.code` de l'ExeFS. Il le décompresse sur place (`blz_decompress_in_place`, `0xFFF03564`, le format « BLZ » que `loader` décompresse aussi pour les autres titres). Puis il place `.text`, `.rodata` et `.data` chacun dans ses pages et fabrique un `KCodeSet` (`kcode_set_initialize`, `0xFFF06598`).
3. **Le processus.** Un `KProcess` est pris dans sa réserve et initialisé avec ses capacités (`kprocess_initialize`, `0xFFF0CCE8`). Il reçoit le numéro suivant du compteur `0xFFF2F094`, qui part de 0. Puis son masque de cœurs et son cœur idéal sont posés.
4. **Le lancement.** `kprocess_run` (`0xFFF0D1E0`) projette la pile sous `0x10000000` et crée le fil principal. Ce fil part de l'adresse de `.text`, avec la priorité de l'exheader, sur le cœur idéal du processus. Puis `start_thread` (`0xFFF15200`) le rend prêt.

À la fin, la zone `0x1FF00000`–`0x1FF35800` est mise à zéro.

| Ordre | Module | Numéro de processus | Priorité du fil principal | Cœur idéal | Cœurs permis | Pile |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `fs` | 0 | 46 | 1 | 0 et 1 | `0x1000` |
| 2 | `loader` | 1 | 52 | 1 | 0 et 1 | `0x1000` |
| 3 | `pm` | 2 | 52 | 1 | 0 et 1 | `0x1000` |
| 4 | `sm` | 3 | 52 | 1 | 0 et 1 | `0x1000` |
| 5 | `pxi` | 4 | 45 | 1 | 0 et 1 | `0x1000` |

Les cinq fils principaux attendent sur la file du cœur 1, le cœur « système ». Le premier à tourner est celui de plus forte priorité, c'est-à-dire du plus petit nombre : **`pxi` (45), puis `fs` (46)**, puis `loader`, `pm` et `sm` (52) dans leur ordre d'arrivée. Cet ordre est déduit des priorités et de la règle de l'ordonnanceur (partie 7) ; il n'a pas été observé. Dans les faits, chacun se bloque vite : `pxi` et `fs` attendent `srv:`, que seul `sm` crée. Le noyau ne lance rien d'autre : tout processus suivant est créé par `loader` (svc `CreateCodeSet` et `CreateProcess`) à la demande de `pm`, et démarré par `pm` (svc `Run`). C'est ce que décrivent les fiches de ces deux modules.

## Partie 3 : la table des appels système

Une instruction `svc n` fait sauter le processeur au vecteur `0xFFFF0008`, qui mène au gestionnaire `0xFFF021F0`. Celui-ci :

1. sauve l'état du programme sur la pile noyau du fil ;
2. lit le numéro dans l'instruction elle-même, sur 8 bits, en ARM comme en Thumb ;
3. **numéro ≥ `0x80`** : appelle `0xFFF04DF0` (partie 8) ;
4. sinon vérifie que le bit n du **masque des appels permis** est posé. Ce masque de 128 bits est rangé en haut de la pile noyau du fil (16 octets, à `+0x20` de la pile au moment du test). `kthread_initialize` l'y a recopié de `KProcess+0x90`, rempli par les capacités de l'exheader. Bit absent : même chemin que `0xFFF04DF0`, c'est-à-dire la panique (partie 8) ;
5. appelle l'entrée n de la table **`0xFFF0230C`**, interruptions ouvertes. Les arguments sont ceux du programme, dans `r0`–`r7` ;
6. au retour, si un travail est en attente pour ce fil (octet à `+0x30` de la pile), passe par `0xFFF04028` puis `thread_handle_pending` (`0xFFF0CB60`) : fin du fil demandée, suspension par le débogueur, réordonnancement. Si le processus permet le débogage (bit 0 des drapeaux du noyau), les registres `r0`–`r7` sont aussi poussés sur la pile pendant l'appel, pour qu'un débogueur puisse les lire.

Beaucoup d'entrées de la table sont des enveloppes de 24 à 48 octets. Elles rangent les pointeurs de sortie sur la pile et appellent la fonction qui fait le travail : ce sont les deux colonnes ci-dessous. Les noms sont ceux de 3dbrew. La colonne « Pokémon X » compte les instructions `svc` de ce numéro dans le code de la mise à jour du jeu (code ARM seulement). La dernière colonne liste les fiches qui disent le module appelant.

| N° | Nom (3dbrew) | Entrée de la table | Fonction qui fait le travail | Pokémon X | Modules qui l'appellent |
| --- | --- | --- | --- | --- | --- |
| `0x00` | — | vide (0) | — | | |
| `0x01` | ControlMemory | `0xFFF0364C` | `0xFFF082F4` | 1 | sm, fs, loader, hid, gsp, ptm |
| `0x02` | QueryMemory | `0xFFF03AC0` | `0xFFF07BF4` |  | sm, fs, loader, pm, pxi, gsp, ns, dsp, cfg, ptm |
| `0x03` | ExitProcess | `0xFFF043FC` | dans l'entrée | 3 | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x04` | GetProcessAffinityMask | `0xFFF05ED4` | dans l'entrée |  |  |
| `0x05` | SetProcessAffinityMask | `0xFFF05F90` | dans l'entrée |  | pm |
| `0x06` | GetProcessIdealProcessor | `0xFFF03918` | `0xFFF0AD40` |  |  |
| `0x07` | SetProcessIdealProcessor | `0xFFF060A0` | dans l'entrée |  | pm |
| `0x08` | CreateThread | `0xFFF03800` | `0xFFF07C8C` | 1 | fs, pm, pxi, hid, gsp, ns, dsp, ptm |
| `0x09` | ExitThread | `0xFFF042D8` | dans l'entrée | 1 | fs, pm, pxi, hid, gsp, ns, dsp, ptm |
| `0x0A` | SleepThread | `0xFFF044F0` | dans l'entrée | 1 | fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x0B` | GetThreadPriority | `0xFFF03A20` | `0xFFF09FA4` | 1 | fs |
| `0x0C` | SetThreadPriority | `0xFFF053A8` | dans l'entrée | 7 | fs, gsp |
| `0x0D` | GetThreadAffinityMask | `0xFFF05C24` | dans l'entrée |  |  |
| `0x0E` | SetThreadAffinityMask | `0xFFF05E4C` | rend `0xF8C007F4` |  |  |
| `0x0F` | GetThreadIdealProcessor | `0xFFF039C8` | `0xFFF0A9A8` |  |  |
| `0x10` | SetThreadIdealProcessor | `0xFFF06094` | rend `0xF8C007F4` |  |  |
| `0x11` | GetCurrentProcessorNumber | `0xFFF06144` | dans l'entrée |  |  |
| `0x12` | Run | `0xFFF03BE0` | `0xFFF0B6B8` |  | pm |
| `0x13` | CreateMutex | `0xFFF0372C` | `0xFFF07720` | 1 | pxi, hid, ns |
| `0x14` | ReleaseMutex | `0xFFF04534` | dans l'entrée | 2 | pxi, ns |
| `0x15` | CreateSemaphore | `0xFFF037A4` | `0xFFF0948C` |  | sm, pxi |
| `0x16` | ReleaseSemaphore | `0xFFF03B20` | `0xFFF09B24` |  | sm, pxi |
| `0x17` | CreateEvent | `0xFFF036F0` | `0xFFF075A8` | 1 | fs, pm, pxi, hid, gsp, ns, dsp, ptm |
| `0x18` | SignalEvent | `0xFFF04418` | dans l'entrée | 19 | fs, pm, pxi, hid, gsp, ns, dsp, ptm |
| `0x19` | ClearEvent | `0xFFF04128` | dans l'entrée | 23 | pm, hid, gsp, ns, dsp, ptm |
| `0x1A` | CreateTimer | `0xFFF03824` | `0xFFF07890` | 1 | hid, ns, ptm |
| `0x1B` | SetTimer | `0xFFF03C0C` | `0xFFF06EF4` | 1 | hid, ns, ptm |
| `0x1C` | CancelTimer | `0xFFF042F4` | dans l'entrée | 1 | hid, ns, ptm |
| `0x1D` | ClearTimer | `0xFFF04200` | dans l'entrée |  | ns |
| `0x1E` | CreateMemoryBlock | `0xFFF0370C` | `0xFFF09C6C` | 1 | hid, gsp, ns |
| `0x1F` | MapMemoryBlock | `0xFFF04878` | dans l'entrée | 3 | hid, gsp, ns |
| `0x20` | UnmapMemoryBlock | `0xFFF04F20` | dans l'entrée | 2 | hid, gsp, ns |
| `0x21` | CreateAddressArbiter | `0xFFF036B4` | `0xFFF0A700` | 1 | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x22` | ArbitrateAddress | `0xFFF03614` | `0xFFF0979C` | 1 | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x23` | CloseHandle | `0xFFF043CC` | `0xFFF21FA8` | 220 | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x24` | WaitSynchronization1 | `0xFFF059D4` | dans l'entrée | 51 | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x25` | WaitSynchronizationN | `0xFFF03C78` | `0xFFF0A8F0` | 1 | fs, pm, pxi, hid, gsp, ns, dsp |
| `0x26` | SignalAndWait | `0xFFF03C28` | `0xFFF09000` |  |  |
| `0x27` | DuplicateHandle | `0xFFF0385C` | `0xFFF09644` | 1 | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x28` | GetSystemTick | `0xFFF0485C` | `0xFFF1AEF8` | 66 | fs, loader, pm, hid, gsp, ns, cfg, ptm |
| `0x29` | GetHandleInfo | `0xFFF038C0` | `0xFFF08BF0` | 1 |  |
| `0x2A` | GetSystemInfo | `0xFFF0398C` | `0xFFF08D68` |  | sm, pm |
| `0x2B` | GetProcessInfo | `0xFFF03934` | `0xFFF09014` |  | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x2C` | GetThreadInfo | `0xFFF039E4` | `0xFFF08E7C` |  |  |
| `0x2D` | ConnectToPort | `0xFFF03630` | `0xFFF08160` | 1 | fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x2E` | SendSyncRequest1 | `0xFFF04E78` | rend `0xF8C007F4` |  |  |
| `0x2F` | SendSyncRequest2 | `0xFFF04E84` | rend `0xF8C007F4` |  |  |
| `0x30` | SendSyncRequest3 | `0xFFF04E90` | rend `0xF8C007F4` |  |  |
| `0x31` | SendSyncRequest4 | `0xFFF04E9C` | rend `0xF8C007F4` |  |  |
| `0x32` | SendSyncRequest | `0xFFF04B84` | dans l'entrée | 408 | fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x33` | OpenProcess | `0xFFF03A58` | `0xFFF07B64` |  | pm |
| `0x34` | OpenThread | `0xFFF03A74` | `0xFFF071C4` |  |  |
| `0x35` | GetProcessId | `0xFFF038E0` | `0xFFF07FC0` | 1 | sm, pm, hid, gsp, ns, dsp, cfg, ptm |
| `0x36` | GetProcessIdOfThread | `0xFFF038FC` | `0xFFF0A894` |  |  |
| `0x37` | GetThreadId | `0xFFF039AC` | `0xFFF07AF4` | 1 | fs, gsp, dsp |
| `0x38` | GetResourceLimit | `0xFFF03970` | `0xFFF099C4` | 1 |  |
| `0x39` | GetResourceLimitLimitValues | `0xFFF0617C` | dans l'entrée |  | pm |
| `0x3A` | GetResourceLimitCurrentValues | `0xFFF06310` | dans l'entrée | 1 |  |
| `0x3B` | GetThreadContext | `0xFFF04E60` | rend `0xF8C007F4` |  |  |
| `0x3C` | Break | `0xFFF0642C` | dans l'entrée | 1 | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x3D` | OutputDebugString | `0xFFF05184` | dans l'entrée | 1 |  |
| `0x3E` | ControlPerformanceCounter | `0xFFF03670` | `0xFFF0AD90` |  |  |
| `0x3F` | — | vide (0) | — | | |
| `0x40` | — | vide (0) | — | | |
| `0x41` | — | vide (0) | — | | |
| `0x42` | — | vide (0) | — | | |
| `0x43` | — | vide (0) | — | | |
| `0x44` | — | vide (0) | — | | |
| `0x45` | — | vide (0) | — | | |
| `0x46` | — | vide (0) | — | | |
| `0x47` | CreatePort | `0xFFF03748` | `0xFFF06FF4` |  | sm |
| `0x48` | CreateSessionToPort | `0xFFF037E4` | `0xFFF0A4F8` |  | sm |
| `0x49` | CreateSession | `0xFFF037C0` | `0xFFF08A74` |  | fs |
| `0x4A` | AcceptSession | `0xFFF035F8` | `0xFFF08010` |  | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x4B` | ReplyAndReceive1 | `0xFFF03B58` | `0xFFF09C1C`, rend `0xF8C007F4` |  |  |
| `0x4C` | ReplyAndReceive2 | `0xFFF03B74` | `0xFFF09C30`, rend `0xF8C007F4` |  |  |
| `0x4D` | ReplyAndReceive3 | `0xFFF03B90` | `0xFFF09C44`, rend `0xF8C007F4` |  |  |
| `0x4E` | ReplyAndReceive4 | `0xFFF03BAC` | `0xFFF09C58`, rend `0xF8C007F4` |  |  |
| `0x4F` | ReplyAndReceive | `0xFFF03B3C` | `0xFFF09720` |  | sm, fs, loader, pm, pxi, hid, gsp, ns, dsp, cfg, ptm |
| `0x50` | BindInterrupt | `0xFFF04618` | dans l'entrée |  | pxi, gsp, dsp |
| `0x51` | UnbindInterrupt | `0xFFF04C84` | dans l'entrée |  | pxi, gsp, dsp |
| `0x52` | InvalidateProcessDataCache | `0xFFF06150` | `0xFFF0AF94` |  | gsp, dsp |
| `0x53` | StoreProcessDataCache | `0xFFF05E58` | `0xFFF0AF94` |  | fs, gsp |
| `0x54` | FlushProcessDataCache | `0xFFF05B04` | `0xFFF0AF94` |  | fs, gsp, ns, dsp |
| `0x55` | StartInterProcessDma | `0xFFF03C50` | `0xFFF0F3E4` |  | fs, gsp, ns |
| `0x56` | StopDma | `0xFFF04038` | dans l'entrée |  | fs, gsp, ns |
| `0x57` | GetDmaState | `0xFFF038A4` | `0xFFF07A00` |  | fs |
| `0x58` | RestartDma | `0xFFF03BC8` | `0xFFF07460` |  |  |
| `0x59` | SetGpuProt | `0xFFF05AF4` | `0xFFF06EA0` |  | gsp |
| `0x5A` | SetWifiEnabled | `0xFFF04868` | `0xFFF06E80` |  |  |
| `0x5B` | — | vide (0) | — | | |
| `0x5C` | — | vide (0) | — | | |
| `0x5D` | — | vide (0) | — | | |
| `0x5E` | — | vide (0) | — | | |
| `0x5F` | — | vide (0) | — | | |
| `0x60` | DebugActiveProcess | `0xFFF03840` | `0xFFF09FF8` |  | pm |
| `0x61` | BreakDebugProcess | `0xFFF050F0` | dans l'entrée |  |  |
| `0x62` | TerminateDebugProcess | `0xFFF05E84` | dans l'entrée |  |  |
| `0x63` | GetProcessDebugEvent | `0xFFF05724` | dans l'entrée |  |  |
| `0x64` | ContinueDebugEvent | `0xFFF05470` | dans l'entrée |  |  |
| `0x65` | GetProcessList | `0xFFF03954` | `0xFFF09410` |  |  |
| `0x66` | GetThreadList | `0xFFF03A04` | `0xFFF08F84` |  |  |
| `0x67` | GetDebugThreadContext | `0xFFF05B30` | dans l'entrée |  |  |
| `0x68` | SetDebugThreadContext | `0xFFF05CFC` | dans l'entrée |  |  |
| `0x69` | QueryDebugProcessMemory | `0xFFF03A90` | `0xFFF0A9F8` |  |  |
| `0x6A` | ReadProcessMemory | `0xFFF052A8` | dans l'entrée |  |  |
| `0x6B` | WriteProcessMemory | `0xFFF05514` | dans l'entrée |  |  |
| `0x6C` | SetHardwareBreakPoint | `0xFFF05DE8` | dans l'entrée |  |  |
| `0x6D` | GetDebugThreadParam | `0xFFF03878` | `0xFFF0A630` |  |  |
| `0x6E` | — | vide (0) | — | | |
| `0x6F` | — | vide (0) | — | | |
| `0x70` | ControlProcessMemory | `0xFFF03698` | `0xFFF0AAB0` |  |  |
| `0x71` | MapProcessMemory | `0xFFF04A14` | dans l'entrée |  |  |
| `0x72` | UnmapProcessMemory | `0xFFF0503C` | dans l'entrée |  |  |
| `0x73` | CreateCodeSet | `0xFFF036D0` | `0xFFF086A0` |  | loader |
| `0x74` | RandomStub | `0xFFF03A3C` | `0xFFF07B48` |  |  |
| `0x75` | CreateProcess | `0xFFF0376C` | `0xFFF087E4` |  | loader |
| `0x76` | TerminateProcess | `0xFFF04EA8` | dans l'entrée |  | pm |
| `0x77` | SetProcessResourceLimits | `0xFFF05604` | dans l'entrée |  | pm |
| `0x78` | CreateResourceLimit | `0xFFF03788` | `0xFFF0A3E8` |  | pm |
| `0x79` | SetResourceLimitLimitValues | `0xFFF06298` | dans l'entrée |  | pm |
| `0x7A` | AddCodeSegment | `0xFFF04E6C` | rend `0xF8C007F4` |  |  |
| `0x7B` | Backdoor | vide (0) | — | | |
| `0x7C` | KernelSetState | `0xFFF15F10` | `0xFFF15F14` |  | pm, ns, ptm |
| `0x7D` | QueryProcessMemory | `0xFFF03AF0` | `0xFFF0A25C` |  |  |
| `0x7E` | — | hors table | — | | |
| `0x7F` | — | hors table | — | | |

**Vides et réservés :**

- 17 cases valent zéro : `0x00`, `0x3F`–`0x46`, `0x5B`–`0x5F`, `0x6E`–`0x6F`, et **`0x7B` (Backdoor)**. La porte dérobée que 3dbrew décrit n'existe plus dans ce noyau.
- La table s'arrête à `0x7D`. Les numéros `0x7E` et `0x7F` passent pourtant le test « < `0x80` » : leurs « entrées » seraient les premières instructions du gestionnaire d'instruction indéfinie, prises pour des adresses. Seul le masque des appels permis les protège : aucun des quatorze exheaders lus (les treize modules extraits et le jeu) ne va au-delà de `0x7D`.
- Douze appels rendent tout de suite `0xF8C007F4` (« non implémenté ») :
  - 0x0E SetThreadAffinityMask, 0x10 SetThreadIdealProcessor ;
  - 0x2E–0x31 SendSyncRequest1 à 4 ;
  - 0x3B GetThreadContext ;
  - 0x4B–0x4E ReplyAndReceive1 à 4, qui mettent d'abord l'index à 0 ;
  - 0x7A AddCodeSegment.

  Un programme ne peut donc pas changer le cœur d'un fil après sa création.
- 0x7C KernelSetState commence par une instruction vide (`nop`) qui tombe dans la fonction `0xFFF15F14`. Le noyau appelle aussi cette fonction lui-même.

### Ce que vérifient les appels dont le jeu et les modules dépendent

Les codes d'erreur sont lus dans le code. Les plus fréquents :

| Code | Sens |
| --- | --- |
| `0xD8E007F7` (ou `0xD9001BF7`) | poignée invalide ou d'une autre classe |
| `0xE0E01BF5` | adresse invalide |
| `0xE0E01BF1` | adresse mal alignée |
| `0xE0E01BF2` | taille mal alignée |
| `0xE0E01BEE` | valeur hors de la liste permise |
| `0xE0E01BFD` | valeur hors bornes |
| `0xD8E007F6` | pointeur nul |
| `0xD8E007ED` | type d'information inconnu |
| `0xC860180x` | limite de ressources ou réserve d'objets épuisée |
| `0xD86007F3` | plus de mémoire noyau |

Les parties 5 à 7 détaillent IPC, mémoire, fils et attente ; ce tableau couvre les autres appels.

| svc | Fonction | Vérifie, puis rend |
| --- | --- | --- |
| 0x02 QueryMemory | `0xFFF07BF4` | adresse ≥ `0x40000000` : `0xE0E01BF5`. Rend base, taille, droits (`& 3`) et état (`& 0xFF`) du bloc, lus par `page_table_query_info` (`0xFFF1A62C`) |
| 0x03 ExitProcess | dans l'entrée | `terminate_current_process` (`0xFFF14C48`) : le fil qui appelle sort par `thread_exit` (`0xFFF13230`) ; les autres fils passent en priorité `0x3F` et dorment jusqu'à leur destruction |
| 0x09 ExitThread | dans l'entrée | `thread_exit` ; panique si elle revient |
| 0x12 Run | `0xFFF0B6B8` | poignée de processus (`0xD9001BF7`), puis `kprocess_run` avec la priorité et la taille de pile données par `pm` |
| 0x1E CreateMemoryBlock | `0xFFF09C6C` | taille alignée ; droits du créateur et droits des autres de 0 à 3 ; adresse 0 interdite à une application (`0xD92007EA`), sinon adresse dans `0x00100000`–`0x14000000` ; limite de la catégorie 7 (`0xC860180B`) ; réserve vide (`0xC8601802`). Avec l'adresse 0, le noyau prend lui-même les pages, dans la région du processus ou dans BASE |
| 0x1F MapMemoryBlock | `0xFFF066DC` | adresse alignée, droits de 0 à 3, adresse 0 ou dans **`0x08000000`–`0x14000000`** (`0xE0E01BF5`), poignée de `KSharedMemory` (jeton `0xB0`). Un bloc créé à l'adresse 0 dans la mémoire linéaire est projeté à l'adresse linéaire de sa mémoire physique. Les règles fines sur les droits du propriétaire et le nombre de projections (`0xD900182C`, `0xD900182D`, `0xD900182E`) sont interprétées |
| 0x20 UnmapMemoryBlock | `0xFFF069E4` | adresse alignée et dans la même plage, poignée de `KSharedMemory` |
| 0x23 CloseHandle | `0xFFF21FA8` | poignée trouvée dans la table, compteur identique (partie 4), sinon `0xD8E007F7`. Rend l'entrée et la référence |
| 0x27 DuplicateHandle | `0xFFF09644` | accepte `0xFFFF8000` et `0xFFFF8001` ; nouvelle entrée vers le même objet. Table pleine : `0xD8600413` |
| 0x28 GetSystemTick | `0xFFF1AEF8` | aucune vérification (partie 7) |
| 0x2A GetSystemInfo | `0xFFF08D68` | type 0 : mémoire utilisée (paramètre 1 APPLICATION, 2 SYSTEM, 3 BASE, 0 toute la FCRAM) ; type 2 : mémoire prise par le noyau ; type `0x1A` : 5, le nombre de modules du FIRM. **Tout autre type rend 0 sans erreur** |
| 0x2B GetProcessInfo | `0xFFF09014` | poignée de processus ou `0xFFFF8001`. Types lus : 0-3 quantités de mémoire du processus ; 4 poignées ouvertes ; 5 maximum atteint ; 8 nombre de fils ; `0x13` région mémoire ; `0x14` : `0x20000000` − base linéaire, c'est-à-dire le décalage entre une adresse linéaire et son adresse physique. Type inconnu : `0xD8E007ED` |
| 0x2D ConnectToPort | `0xFFF08160` | nom recopié du programme, 11 caractères au plus (`0xE0E0181E`), pointeur invalide `0xD9001814`. Le nom est cherché parmi les ports nommés ; absent : **`0xD88007FA`**. La fiche de `loader` (partie 1) le soupçonne derrière son attente de `srv:` ; cette valeur n'est pas écrite telle quelle dans `loader`, le lien n'est donc pas vérifié. Port plein : `0xD0401834`, d'après la fiche de `sm` |
| 0x35 GetProcessId | `0xFFF07FC0` | rend `KProcess+0xBC` |
| 0x37 GetThreadId | `0xFFF07AF4` | rend `KThread+0x84`, un compteur global (`0xFFF2F0BC`) |
| 0x3C Break | `0xFFF0642C` | raison ≥ 5 : `0xD8E007ED`. **Sur une console du commerce, le processus est terminé, quelle que soit la raison.** Sur une console de développement, un débogueur attaché reçoit un événement. Les raisons 3 et 4 (chargement d'un `.cro`) ne font rien sans débogueur |
| 0x3D OutputDebugString | `0xFFF05184` | taille négative `0xE0E01FFD`, zone hors de l'espace du programme `0xD9001C03`. Sans débogueur, rien ne se passe |
| 0x47 CreatePort | `0xFFF06FF4` | sans nom : rend les poignées des deux bouts. Avec nom : le bout client est inscrit parmi les sept ports nommés (`0xFFF0DD08`) et seule la poignée serveur est rendue |
| 0x48 CreateSessionToPort | `0xFFF0A4F8` | poignée de `KClientPort` (`0x65`), puis ouverture d'une session (`0xFFF0DA54`) |
| 0x49 CreateSession | `0xFFF08A74` | rend la poignée serveur puis la poignée client d'une nouvelle `KSession` (réserve vide : `0xC8601809`) |
| 0x4A AcceptSession | `0xFFF08010` | poignée de `KServerPort` (`0x55`). Aucune session en attente : `0xD8401823` |
| 0x50 BindInterrupt | `0xFFF04618` | objet `KEvent` ou `KSemaphore`. L'interruption doit être dans le masque d'interruptions de l'exheader (`0xD92007EA`) ; déjà liée : `0xD8A007FC` |
| 0x52, 0x53, 0x54 cache | `0xFFF0AF94` | adresse nulle `0xD8E007F6`, plage au-delà de `0x40000000` `0xE0E01BF5`. Opération page par page sur la mémoire physique du processus, ou sur tout le cache au-delà d'un seuil |
| 0x55 StartInterProcessDma | `0xFFF0F3E4` | tailles non nulles, plages sous `0x40000000`, types de transfert 4, 8, 12 et 15 seuls (`0xD8E007ED`) |
| 0x59 SetGpuProt | `0xFFF06EA0` | écrit le registre CFG11 `0x10140140` : `0x560` pour 1, `0x590` ou `0x5F0` (selon `APPMEMTYPE`) pour 0 |
| 0x73 CreateCodeSet | `0xFFF086A0` | les quatre pointeurs non nuls, description de `0x40` octets recopiée, réserve vide `0xD8601402`. Le code est pris dans les pages de l'appelant (`loader`) |
| 0x75 CreateProcess | `0xFFF087E4` | poignée de `KCodeSet` (`0x68`), réserve vide `0xC860180A`, puis `kprocess_initialize` et l'analyse des capacités (ci-dessous) |
| 0x76 TerminateProcess | dans l'entrée | soi-même : comme ExitProcess ; un autre : `0xFFF0D4F4` (pas lu) |
| 0x79 SetResourceLimitLimitValues | `0xFFF06298` | jusqu'à 10 catégories |

Les catégories des limites de ressources sont lues dans les appels de `resource_limit_reserve` (`0xFFF15ACC`) :

| N° | Catégorie | N° | Catégorie |
| --- | --- | --- | --- |
| 0 | priorité la plus forte permise | 5 | sémaphores |
| 1 | mémoire engagée | 6 | minuteries |
| 2 | fils | 7 | blocs de mémoire partagée |
| 3 | événements | 8 | arbitres d'adresses |
| 4 | mutex | 9 | temps processeur sur le cœur 1 |

Les catégories 0, 1, 2, 3, 7, 8 et 9 sont vues dans le code ; 4, 5 et 6 suivent le même schéma, sans vérification une par une.

### Les capacités de l'exheader

`KProcess` reçoit à sa création les 28 descripteurs de capacités de l'exheader (`+0x370`), analysés par `capability_parse` (`0xFFF13FAC`) et rangés à `KProcess+0x90`. Un descripteur se reconnaît à ses bits du haut :

| Motif | Contenu | Refus |
| --- | --- | --- |
| `1110…` | quatre numéros d'interruption de 7 bits (`0x7F` = vide), ajoutés au masque d'interruptions | numéro déjà présent `0xD900140E` ; numéro < `0x0F` `0xD9001412` |
| `11110…` | masque des appels système : 24 bits, numéro de groupe dans les bits 24-26 ; appel = groupe × 24 + bit | les numéros ≥ `0x80` sont ignorés |
| `1111110…` | version du noyau visée (16 bits) | au-delà de **`0x23A`** (2.58, la version de ce noyau) : `0xD9001413` |
| `11111110…` | taille de la table des poignées | |
| `111111110…` | drapeaux du noyau : bit 0 débogage permis, bit 1 débogage forcé, bit 3 page partagée inscriptible, bit 6 mémoire partagée contiguë, bits 8-11 région mémoire, bit 13 droit au cœur 2 (New 3DS) | |
| `11111111100…` | projection statique d'une plage, en deux descripteurs (début, fin). Bit 20 du premier : lecture seule | second descripteur d'un autre type : `0xD9001412` ; page déjà projetée : `0xD9001410` |
| `111111111110…` | une page de registres, lecture et écriture | |
| `0xFFFFFFFF` | rien (remplissage) | |
| autre | | `0xD9001412` |

La borne `0x23A` refuse un programme fait pour un noyau plus récent. C'est une seconde source pour la version 2.58, indépendante de la page de configuration.

## Partie 4 : les objets du noyau

Chaque objet que désigne une poignée est un `KAutoObject` : un pointeur de table virtuelle (`+0x0`) et un compteur de références (`+0x4`, augmenté par `kautoobject_increment_refcount` `0xFFF18B20`). Quand le compteur retombe à 0 (`kautoobject_close`, `0xFFF27494`), la méthode `+0x8` de la table virtuelle détruit l'objet : elle le retire de la liste de sa classe (`object_container_unregister`, `0xFFF1E244`), appelle sa méthode de fin (`+0xC`) et rend sa place à la réserve (`slab_free`, `0xFFF1C820`).

Les objets ne sont jamais pris dans un tas général. Chaque classe a sa **réserve** (« slab heap ») de places de taille fixe, découpée une fois pour toutes au démarrage ; une réserve vide fait échouer la création. Le type d'un objet se lit par la méthode `+0x18` de sa table, qui rend son nom et un **jeton de classe**. Un objet appartient à la classe C si `jeton(objet) | jeton(C) == jeton(objet)` : les bits d'un jeton sont ceux de ses ancêtres. Par exemple, le bit 0 est celui des objets qu'on peut attendre.

| Classe | Jeton | Table virtuelle | Taille | Places | Réserve | Liste de la classe | Créé par |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KAutoObject | `0x00` | `0xFFF2E344` | | | | | |
| KSynchronizationObject | `0x01` | `0xFFF2E5F0` | | | | | |
| KEvent | `0x1F` | `0xFFF2E68C` | `0x28` | 315 | `0xFFF33228` | `0xFFF33210` | svc 0x17 |
| KSemaphore | `0x2F` | `0xFFF2E2EC` | `0x2C` | 83 | `0xFFF33160` | `0xFFF33148` | svc 0x15 |
| KTimer | `0x35` | `0xFFF2E724` | `0x3C` | 60 | `0xFFF33278` | `0xFFF33260` | svc 0x1A |
| KMutex | `0x39` | `0xFFF2E6E4` | `0x2C` | 85 | `0xFFF33250` | `0xFFF33238` | svc 0x13 |
| KDebug | `0x4D` | `0xFFF2E7A8` | `0xA0` | 3 | `0xFFF332A0` | `0xFFF33288` | svc 0x60 |
| KServerPort | `0x55` | `0xFFF2E3D4` | (dans KPort) | | | | |
| KDmaObject | `0x59` | `0xFFF2E294` | `0x18` | 16 | `0xFFF33138` | `0xFFF33120` | svc 0x55 |
| KClientPort | `0x65` | `0xFFF2E36C` | (dans KPort) | | | | |
| KCodeSet | `0x68` | `0xFFF2E878` | `0x64` | 47 | `0xFFF332F0` | `0xFFF332D8` | svc 0x73, démarrage |
| KSession | `0x70` | `0xFFF2E8F0` | `0x4C` | 345 | `0xFFF33340` | `0xFFF33328` | svc 0x2D, 0x48, 0x49 |
| KThread | `0x8D` | `0xFFF2E7FC` | `0xB0` | 300 | `0xFFF332C8` | `0xFFF332B0` | svc 0x08, démarrage |
| KServerSession | `0x95` | `0xFFF2E514` | (dans KSession) | | | | |
| KAddressArbiter | `0x98` | `0xFFF2E554` | `0x14` | 51 | `0xFFF331D8` | `0xFFF331C0` | svc 0x21 |
| KClientSession | `0xA5` | `0xFFF2E474` | (dans KSession) | | | | |
| KPort | `0xA8` | `0xFFF2E664` | `0x48` | 153 | `0xFFF33200` | `0xFFF331E8` | svc 0x47 |
| KSharedMemory | `0xB0` | `0xFFF2E44C` | `0x28` | 63 | `0xFFF33188` | `0xFFF33170` | svc 0x1E |
| KProcess | `0xC5` | `0xFFF2E8A0` | `0x270` | 47 | `0xFFF33318` | `0xFFF33300` | svc 0x75, démarrage |
| KResourceLimit | `0xC8` | `0xFFF2E4EC` | `0x74` | 5 | `0xFFF331B0` | `0xFFF33198` | svc 0x78 |

**Les autres réserves**, sans classe nommée :

| Réserve | Taille | Places | Rôle |
| --- | --- | --- | --- |
| `0xFFF32460` | `0xC` | 4 273 | maillons de liste, utilisés partout (attentes, listes de fils) |
| `0xFFF33350` | `0x8` | 601 | morceaux de mémoire physique (interprété) |
| `0xFFF33380` | `0x14` | 1 723 | descripteurs de blocs de mémoire des processus (interprété) |
| `0xFFF33390` | `0x18` | 64 | pages TLS (partie 6) |
| `0xFFF33370` | `0x10` | 7 | noms des ports nommés (interprété : `srv:`, `err:f`…) |
| `0xFFF333A0` | `0x18` | 127 | pas identifié (ses utilisateurs sont voisins des fonctions du débogueur) |
| `0xFFF33360` | `0x38` | 67 | événements de débogage (interprété) |

Tailles et nombres sont lus deux fois et concordent : dans les appels de `kernel_main` à `slab_heap_init` (taille d'un objet, taille totale) et dans le tableau qu'écrit `write_slab_heap_info_page` (nombre, taille). Le nom de chaque classe vient de sa fonction « type » : elle désigne la chaîne et la table virtuelle qui la contient. Le lien entre une classe et sa réserve vient de deux endroits : la fonction de destruction de la table virtuelle et la fonction de création du svc. Une session est un seul objet `KSession` qui contient ses deux bouts, `KServerSession` et `KClientSession`. De même, un `KPort` contient `KServerPort` et `KClientPort`.

Ces nombres sont des plafonds pour toute la console : 300 fils, 47 processus et 345 sessions au plus.

**Les méthodes des objets qu'on attend** (déplacements dans la table virtuelle). `+0x20` et `+0x24` : un fil commence ou cesse d'attendre. `+0x2C` : l'objet est-il libre pour ce fil. `+0x30` : le prendre. `+0x34` : le remettre à zéro. Le détail par classe est à la partie 7.

**Le `KProcess`** (`0x270` octets), champs lus dans `kprocess_initialize` et ses voisines :

| Déplacement | Contenu |
| --- | --- |
| `+0x1C` | sa table de pages et sa mémoire ; `+0x58` (soit `+0x3C` dans ce bloc) garde la base du tas linéaire |
| `+0x68` | mémoire prise pour ses piles noyau |
| `+0x6C`/`+0x70` | liste de ses pages TLS |
| `+0x7C` | cœur idéal |
| `+0x84` | sa `KResourceLimit` |
| `+0x88` | état (1 une fois lancé) |
| `+0x89` | masque des cœurs permis |
| `+0x90`–`+0x9C` | masque des 128 appels système permis |
| `+0xB0` | drapeaux du noyau de l'exheader (bits 8-11 : région mémoire, 0x100 APPLICATION, 0x200 SYSTEM, 0x300 BASE) |
| `+0xB4` | taille de la table des poignées |
| `+0xB6` | version du noyau visée par l'exheader |
| `+0xB8` | son `KCodeSet` |
| `+0xBC` | numéro du processus |
| `+0xC0` | instant de création (tick) |
| `+0xC8` | fil principal |
| `+0xDC` | **table des poignées** |

**La table des poignées** (`KProcess+0xDC`, préparée par `handle_table_initialize`, `0xFFF0DF00`) :

- **Taille.** Celle de l'exheader : 512 pour Pokémon X et la plupart des modules. Une taille nulle donne 40.
- **Où sont les entrées.** Jusqu'à 40, dans l'objet même ; au-delà, dans des pages prises dans la région BASE.
- **Une entrée** fait 8 octets : un compteur sur 16 bits, le jeton de classe sur 8 bits, le pointeur vers l'objet. Les entrées libres sont chaînées.
- **Une poignée** vaut `index | compteur << 15`. Le compteur de la table part de 1, augmente à chaque ajout et revient à 1 après `0x7FFF`. Une poignée fermée puis réutilisée a donc une autre valeur : la recherche (`handle_table_get_object`, `0xFFF18E80`) vérifie l'index, l'occupation de l'entrée et le compteur.
- **Deux pseudo-poignées**, reconnues sans passer par la table : `0xFFFF8000`, le fil courant, et `0xFFFF8001`, le processus courant. Une poignée dont les bits 30-31 sont posés n'est jamais cherchée dans la table.
- **Erreurs.** Table pleine : `0xD8600413`. Poignée introuvable : la fonction appelante rend `0xD8E007F7` (ou `0xD9001BF7` pour les recherches typées).
- **Ajout** (`handle_table_add`, `0xFFF18F80`) : il range le jeton de classe et prend une référence sur l'objet.
- **Fermeture** (`0xFFF21FA8`) : elle rend l'entrée et la référence.

## Partie 5 : une requête d'un programme à un service, pas à pas

Le jeu ne parle jamais directement à un service. Il écrit sa requête dans le tampon de son fil (stockage local du fil, à `+0x80`), puis fait `svcSendSyncRequest` avec la poignée de sa session. Le service, lui, attend dans `svcReplyAndReceive`. Le noyau copie et **traduit** la requête d'un tampon à l'autre, puis la réponse en sens inverse.

### SendSyncRequest (svc `0x32`), côté client

Enveloppe `0xFFF04B84`, travail dans `send_sync_request` (`0xFFF06A44`) puis `server_session_enqueue_request` (`0xFFF0E7C0`).

1. **La poignée.** Elle est cherchée dans la table du processus et doit être une `KClientSession` (jeton `0xA5`), sinon `0xD8E007F7`.
2. **Le verrou.** Le noyau prend le verrou de l'ordonnanceur (`0xFFF2F0AC`) et efface deux drapeaux du fil : « session fermée » (`+0x35`) et « traduction ratée » (`+0x37`).
3. **Session fermée ?** Si la session n'est plus ouverte des deux côtés (`KSession+0x44` ≠ 1), l'appel rend `0xC920181A`.
4. **La file.** Sinon le fil est mis en pause et rangé en tête de la file de la `KServerSession` (`+0x18`). Le serveur prend les requêtes par la queue (`+0x1C`) : premier arrivé, premier servi.
5. **Le réveil du serveur.** La session serveur est signalée (`sync_object_wake_waiters`, `0xFFF1DE50`), ce qui réveille le fil serveur le plus prioritaire qui l'attend.
6. **L'attente.** Le verrou est rendu, et c'est là que le fil client s'endort, jusqu'à la réponse.
7. **Au réveil**, l'appel rend :
   - `0xC920181A` si le serveur a fermé la session pendant l'attente ;
   - `0xC8A01836` si la traduction de la requête a échoué ;
   - 0 sinon. La réponse est déjà dans le tampon du fil.

   Un fil qu'on détruit pendant l'attente rend `0xE7E3FFFF`.

### ReplyAndReceive (svc `0x4F`), côté service

Enveloppe `0xFFF03B3C`, travail dans `reply_and_receive` (`0xFFF09720`) puis `0xFFF0F978`. Arguments : `r0` = tableau des poignées à surveiller, `r1` = leur nombre, `r2` = la session à qui répondre. L'index de l'objet réveillé revient dans `r1`.

1. **Le tableau.** Tableau nul : `0xD8E007F6`. Nombre ≥ `0x20000000` : `0xE0E01BFD`. Le tableau est recopié dans la pile noyau, **256 poignées au plus**, sinon `0xD86007F3`.
2. **Les poignées.** Chacune est lue chez le programme (adresse invalide : `0xE0E01BF5`) et doit désigner un objet qu'on peut attendre, sinon `0xD8E007F7`.
3. **D'abord la réponse.** Elle n'est envoyée que si deux conditions tiennent : l'en-tête du tampon n'a pas `0xFFFF` dans ses 16 bits du haut, et la poignée de réponse n'est pas 0.
   - La poignée doit alors être une `KServerSession` (jeton `0x95`), sinon `0xD8E007F7`.
   - La réponse part par `server_session_reply` (`0xFFF220F4`).
   - Si elle échoue, l'appel rend l'index −1 et l'erreur, sans attendre.
4. **Ensuite l'attente** que l'un des objets soit signalé (`0xFFF223D4`). Ce peut être une session serveur, un port, un événement…
5. **Une session serveur réveillée.** La requête est reçue dans le tampon du fil (`server_session_receive`, `0xFFF1E96C`). Si la traduction de cette requête a échoué, le client est déjà renvoyé avec `0xC8A01836` et le service se remet à attendre, sans rien voir.
6. **Session fermée.** Si la session a été fermée par l'autre bout, ou si on répond à une session sans requête en cours, l'appel rend `0xC920181A`. Dans le second cas, l'index vaut −1. C'est la valeur que la boucle de `sm` (fiche `sm`, partie 1) traite comme « le client s'en va ».
7. **Un port réveillé.** Le noyau ne rend que son index ; le module appelle ensuite `svcAcceptSession` lui-même, comme le font `sm` et `loader`.

### La traduction du message

Deux fonctions, une par sens : `ipc_translate_request` (`0xFFF238AC`, client vers serveur, appelée à la réception) et `ipc_translate_reply` (`0xFFF22DC0`, serveur vers client, appelée à la réponse).

- **Taille.** Un message tient en `0x40` mots au plus. Si 1 + paramètres normaux (bits 6-11 de l'en-tête) + mots traduits (bits 0-5) dépasse `0x40`, le noyau panique.
- **Ordre.** Les descripteurs traduits d'abord, puis la copie des paramètres normaux, et l'en-tête en dernier.
- **Genre.** Le genre d'un descripteur est `(mot & 0xE) >> 1`.

| Descripteur | Genre | Ce que fait le noyau (requête) |
| --- | --- | --- |
| `0x00 \| (n−1)<<26` | poignées copiées | chacune des n poignées est cherchée chez le client et ajoutée à la table du serveur avec son jeton. `0xFFFF8000` désigne le fil client, `0xFFFF8001` son processus. Introuvable ou table pleine : 0 à la place |
| `0x10 \| (n−1)<<26` | poignées déplacées | pareil, puis la poignée est fermée chez le client |
| `0x20` | numéro de processus | le mot suivant reçoit le numéro du processus client (`KProcess+0xBC`) : c'est ainsi que `sm` sait qui lui parle |
| `0x30` | — | panique |
| `(taille<<14) \| (n<<10) \| 2` | tampon statique | le serveur décrit ses tampons statiques à `+0x180` de son stockage local (paires descripteur, adresse). Le noyau vérifie les droits des deux côtés et copie d'un espace d'adresses à l'autre. Le pointeur devient l'adresse du tampon du serveur. Taille plus grande que le tampon du serveur : panique |
| `(taille<<8) \| (n<<4) \| 4` | tampon pour l'ARM9, lu et écrit | le tampon statique n du serveur doit faire exactement une page alignée. Le noyau y écrit la liste des morceaux de mémoire **physique** du tampon du client : paires (adresse, taille), `0x200` au plus, sinon `0xC8A01836`. Il nettoie le cache sur ces morceaux. Le pointeur devient l'adresse physique de la liste. La requête est notée dans une table de 64 entrées (`0xFFF32550`). C'est le chemin des tampons de `fs` vers Process9 (fiches `fs` et `pxi`) |
| `(taille<<8) \| (n<<4) \| 6` | tampon pour l'ARM9, lu | pareil, droits vérifiés en lecture seulement. Exception : le genre 4 d'une application dont l'exheader vise un noyau antérieur à `0x225` est accepté en lecture seule, et réécrit en 6 |
| `(taille<<4) \| 0xA` | tampon projeté, lu par le service | `ipc_map_buffer_to_server` (`0xFFF26078`) projette le tampon chez le serveur (ci-dessous) |
| `(taille<<4) \| 0xC` | tampon projeté, écrit par le service | même projection, client vérifié en écriture |
| `(taille<<4) \| 0xE` | tampon projeté, lu et écrit | même projection |

**La projection d'un tampon chez le service.**

- **Où.** Le noyau réserve dans l'espace du serveur une plage libre entre **`0x04000000` et `0x08000000`**. Plus de place : `0xD8600609`.
- **Comment.** Les pages entières du tampon sont projetées telles quelles : c'est la même mémoire physique. La première et la dernière page, si le tampon ne les remplit pas, sont des **pages neuves**, prises dans la région BASE ; le noyau y recopie la partie utile. Le service ne voit donc jamais les octets voisins du tampon.
- **Le pointeur** que reçoit le serveur est l'adresse de la plage plus le décalage dans la page.

**La réponse** (`ipc_translate_reply`) fait l'inverse, en deux passes.

1. **Les tampons.**
   - Tampon pour l'ARM9 : le noyau retrouve l'entrée du client dans la table et invalide le cache sur le tampon.
   - Tampon projeté `0xA` : il démappe la plage chez le serveur.
   - Tampons projetés `0xC` et `0xE` : il recopie d'abord les pages partielles de début et de fin vers le tampon du client, puis démappe.
2. **Les descripteurs.** Les poignées et le numéro de processus sont traduits dans l'autre sens. Un tampon statique est copié vers le tampon statique du client.

Ensuite viennent les paramètres normaux et l'en-tête, et le client est relancé.

**Une erreur de traduction ne rend presque jamais de code** : une adresse non projetée ou des droits insuffisants font **paniquer le noyau** (`kernel_panic`, `0xFFF1C848`, partie 8). Seule la liste PXI trop longue rend `0xC8A01836`. Un portage sur PC n'a pas à reproduire ces paniques : il lui suffit de savoir que la console ne les tolère pas.

## Partie 6 : la mémoire d'un processus

### Le plan d'une application

Lu dans les bornes que vérifient `control_memory` (`0xFFF082F4`), la projection des tampons, `kprocess_run` et la création des fils :

| Adresses | Contenu | D'où vient la règle |
| --- | --- | --- |
| `0x00100000`… | le code (`.text`, `.rodata`, `.data`, `.bss`), aux adresses du `KCodeSet` | `loader` (fiche `loader`) ; le fil principal part de `.text` |
| `0x04000000`–`0x08000000` | tampons IPC projetés chez un service | `ipc_map_buffer_to_server` |
| `0x08000000`–`0x10000000` | **le tas** : ControlMemory COMMIT et FREE | `control_memory` |
| juste sous `0x10000000` | la pile du fil principal (taille de l'exheader) | `kprocess_run` : la pile est projetée à `0x10000000 − taille` |
| `0x10000000`–`0x14000000` | mémoire partagée, par convention des bibliothèques | le noyau accepte MapMemoryBlock partout dans `0x08000000`–`0x14000000` (partie 3) |
| `0x14000000`–`0x1C000000` | **le tas linéaire** (mémoire physiquement contiguë, celle que voit le GPU) | `kprocess_get_linear_heap_base` |
| ou `0x30000000`–`0x40000000` | le tas linéaire des titres récents | même fonction |
| `0x1E800000`–`0x1EBE0000` | mémoire supplémentaire de la New 3DS | capacité « projection statique » de l'exheader |
| `0x1EC00000`–`0x1FC00000` | registres d'entrée-sortie (`0x10100000`… en physique) | même capacité |
| `0x1F000000`–`0x1F600000` | **la mémoire vidéo** (`0x18000000` en physique) | même capacité |
| `0x1FF00000`–`0x1FF80000` | mémoire du DSP et AXI | même capacité |
| `0x1FF80000` | page de configuration, en lecture seule | `map_config_and_shared_pages` |
| `0x1FF81000` | page partagée, lecture seule ou lecture-écriture | même fonction |
| `0x1FF82000`… | stockage local des fils : 8 zones de `0x200` par page, au plus `0x7E` pages | `kprocess_allocate_tls_slot` (`0xFFF137A8`) |

**Où commence le tas linéaire.** `kprocess_get_linear_heap_base` (`0xFFF15138`) rend `0x30000000` si le processus est dans la région BASE, ou si son exheader vise une version du noyau postérieure à `0x22B` (2.43). Sinon il rend `0x14000000`. L'exheader de Pokémon X vise `0x223` et sa région est APPLICATION : **son tas linéaire est à `0x14000000`**. Une adresse linéaire se convertit en adresse physique par une simple soustraction : physique = virtuelle − base + `0x20000000` (`fcram_pa_to_user_linear_va`, `0xFFF0F3B8`, fait l'inverse).

**Ce que demande l'exheader de Pokémon X** (mise à jour, lu pour comparaison avec les modules) :

- drapeaux du noyau `0x101` : région APPLICATION et bit 0 ;
- table de 512 poignées ;
- projections statiques de `0x1FF50000`–`0x1FF58000` et `0x1FF70000`–`0x1FF78000` (mémoire du DSP) et de `0x1F000000`–`0x1F600000` (mémoire vidéo) ;
- 51 appels système permis, de `0x01` à `0x3D`, sans aucun des appels de service (`0x47`–`0x4F`) ni de débogage.

### ControlMemory (svc `0x01`), pas à pas

Enveloppe `0xFFF0364C`, vérifications dans `control_memory` (`0xFFF082F4`), travail dans `page_table_control_memory` (`0xFFF10BDC`). Arguments : adresse 0, adresse 1, taille, opération, droits.

1. **Alignement.** Adresses alignées sur une page, sinon `0xE0E01BF1` ; taille alignée, sinon `0xE0E01BF2`.
2. **Opération.** L'octet du bas doit valoir 1 FREE, 3 COMMIT, 4 MAP, 5 UNMAP ou 6 PROTECT, sinon `0xE0E01BEE`.
3. **Les plages permises** (en dehors : `0xE0E01BF5`) :
   - COMMIT avec le drapeau LINEAR (`0x10000`) : l'adresse 0, si elle n'est pas nulle, doit tomber dans le tas linéaire, et l'adresse 1 doit être 0 ;
   - FREE : dans le tas `0x08000000`–`0x10000000` ou dans le tas linéaire ;
   - les autres : l'adresse 0 dans `0x08000000`–`0x14000000`. Une plage qui commence sous `0x0E000000` ne doit pas dépasser `0x0E000000`, sinon `0xE0E01BFD` ;
   - MAP et UNMAP : l'adresse 1 (la source) dans `0x00100000`–`0x14000000`.
4. **Droits.** Hors FREE, de 0 à 3 seulement (aucun, lecture, écriture, les deux) ; pas d'exécution possible, sinon `0xE0E01BEE`.
5. **Région.** La région mémoire est celle du processus. Seul le processus n° 1 (`loader`) peut en imposer une autre dans les bits 8-11 de l'opération.
6. **COMMIT et la limite.** COMMIT réserve la taille dans la limite de ressources du processus (catégorie 1, la mémoire), sauf pour `loader` ; dépassement : `0xC860180A`. Un FREE rend la réserve.
7. **Le travail** (`page_table_control_memory`) :
   - **COMMIT linéaire** : prend des pages physiquement contiguës dans la région (`memory_manager_allocate_contiguous`, `0xFFF1922C`) et calcule l'adresse virtuelle : base + (physique − `0x20000000`). Si l'appelant a donné une adresse différente, ou si la plage dépasse `0x1C000000` avec la base `0x14000000`, les pages sont rendues et l'appel échoue. Sinon la mémoire est mise à zéro, le cache nettoyé, et l'adresse rendue dans le premier argument ;
   - **COMMIT ordinaire** : projette des pages neuves à l'adresse demandée, état « privé » (`0xBB05`) ;
   - **MAP** : crée un alias de l'adresse 1 à l'adresse 0, état `0x1A09` ; **UNMAP** le retire ;
   - **PROTECT** : change les droits de pages déjà là ;
   - **FREE** : vérifie que chaque bloc de la plage est libérable (bit `0x100` de son état), sinon `0xE0A01BF5`.

### Les pages de l'espace du noyau qu'on prête aux programmes

Deux pages sont projetées dans **tous** les processus (`map_config_and_shared_pages`, `0xFFF10F14`, à la création) :

- la page de configuration, à `0x1FF80000`, toujours en lecture seule ;
- la page partagée, à `0x1FF81000`, en lecture seule ou en lecture-écriture selon le bit 3 des drapeaux du noyau de l'exheader (« écriture dans la page partagée »).

Leur contenu est décrit à la partie 9.

## Partie 7 : fils, ordonnancement, attente et ArbitrateAddress

### Créer un fil : CreateThread (svc `0x08`)

Enveloppe `0xFFF03800`, travail dans `create_thread` (`0xFFF07C8C`). Arguments : point d'entrée, argument, haut de la pile, priorité, processeur.

1. **Priorité** < `0x40`, sinon `0xE0E01BFD`. Plus le nombre est petit, plus le fil est prioritaire.
2. **Processeur** entre −2 et (nombre de cœurs − 1), sinon `0xD8E007FD`. −2 veut dire « le cœur idéal du processus », −1 « n'importe lequel ».
3. **Limite de priorité.** La priorité ne doit pas être plus forte que celle de la catégorie 0 de la limite de ressources du processus, sinon `0xD9001BEA`.
4. **Les cœurs de la New 3DS.** Hors de la région BASE (donc pour un jeu), le cœur 3 est refusé. Le cœur 2 n'est permis qu'avec le bit 13 des drapeaux du noyau de l'exheader. Refus : `0xD9001BEA`. Pokémon X n'a pas ce bit.
5. **Les réserves.** Une place dans la limite de fils (catégorie 2) : `0xC860180C` sinon. Un `KThread` dans sa réserve : `0xC8601803` sinon.
6. **La préparation du fil.**
   - `init_user_thread` (`0xFFF0F00C`) prend une page de pile noyau, dans la zone virtuelle qui commence à `0xFF400000`.
   - `kthread_initialize` (`0xFFF15254`) remplit le fil.
   - `init_thread_context` (`0xFFF0F0D4`) prépare le premier retour vers le programme :
     - mode utilisateur, Thumb si l'adresse d'entrée est impaire ;
     - `r0` = l'argument, `sp` = le haut de pile arrondi à 8 ;
     - les autres registres à zéro ;
     - FPSCR à `0x03C00000`.
7. **Le stockage local du fil.** Chaque fil reçoit une zone de `0x200` octets (`kprocess_allocate_tls_slot`, `0xFFF137A8`). Une page de `0x1000` en contient huit ; les pages sont projetées à `0x1FF82000 + n × 0x1000`, avec n < `0x7E`. Le premier fil d'un processus a donc sa zone à `0x1FF82000`, le second à `0x1FF82200`. L'adresse est rangée dans `KThread+0x94`. À chaque changement de fil, le noyau la copie dans le registre CP15 `c13,c0,3` : c'est là qu'un programme la lit, et son tampon de commande est à `+0x80`.
8. **Les appels permis.** En haut de la pile noyau du fil, le noyau copie les 16 octets du masque des appels permis (`KProcess+0x90`) : c'est ce que lit le gestionnaire des svc (partie 3).
9. Le fil reçoit un numéro (compteur `0xFFF2F0BC`), une poignée (jeton `0x8D`) et il est **démarré** (`start_thread`, `0xFFF15200`).

**Deux règles particulières, lues dans `kthread_initialize` :**

- **Le cœur 1 pour une application.** Elle s'applique quand le processus est de région APPLICATION, que le cœur demandé est 1 et que la priorité est ≥ 16.
  - Un seul fil de l'application peut tourner sur le cœur 1 ; un second rend `0xE0A01839`.
  - La priorité de ce fil devient max(limite, priorité − 8).
  - Ce fil n'a qu'une part du cœur, réglée par la catégorie 9 de la limite de ressources (le temps processeur). Si cette part vaut 0, deux cas :
    - un exheader qui vise un noyau postérieur à `0x21E` est refusé ;
    - sinon le noyau fixe lui-même la part à 25 (interprété).
- **Un correctif de compatibilité.** Un fil principal de priorité `0x30` passe en `0x31` pour quatre titres précis : identifiants uniques `0x69F`, `0x7E9`, `0x803`, `0x91E`. Pokémon X (`0x55D`) n'en fait pas partie.

### L'ordonnanceur

Il y a un ordonnanceur par cœur ; son adresse est à `0xFFFF9008`. Disposition, lue dans `scheduler_select_next` (`0xFFF214E4`) et `scheduler_yield` (`0xFFF0D75C`) :

| Déplacement | Contenu |
| --- | --- |
| `+0x08` | état |
| `+0x0C` | « il faut réordonnancer » |
| `+0x10` | numéro du cœur |
| `+0x12` | nombre de fils prêts |
| `+0x14`/`+0x18` | **masque de 64 bits** des priorités qui ont au moins un fil prêt |
| `+0x1C` | le fil de repos du cœur |
| `+0x28 + 8·p` | **64 files**, une par priorité p (tête, queue) |

- **Le choix.** L'instruction CLZ sur le masque donne la priorité la plus forte non vide ; c'est le premier fil de cette file qui tourne. Si ce fil attend un objet tenu par un autre fil prêt du même cœur, c'est le détenteur qui passe : un mutex bloquant fait avancer son propriétaire (interprété).
- **Le changement de fil** (`reschedule`, `0xFFF1A7C0`). Le noyau sauve r4-r11, sp, lr et FPEXC dans la pile noyau du fil qui sort. Si le processus change, il recharge la table de pages et `0xFFFF9004`.
- **La préemption.** Le drapeau `+0x0C` est levé quand un fil plus prioritaire devient prêt. Il est traité en sortie d'interruption et en sortie d'appel système.
- **Les fils de même priorité.** Il n'y a pas de tranche de temps entre eux : seul `svcSleepThread(0)` les fait tourner (aucune minuterie de quantum vue ; interprété).
- **Les fils d'un jeu sur le cœur 1.** Ils sont décomptés sur une fenêtre de `0x6646CC` ticks, soit 25 ms, et coupés quand leur part est épuisée (lecture partielle).

**Les cœurs.** Un fil est placé à son démarrage (`scheduler_place_thread`, `0xFFF0D8DC`), sur son cœur idéal s'il est permis, sinon sur le premier cœur permis.

- SetThreadAffinityMask et SetThreadIdealProcessor ne sont pas implémentés : **un fil ne change jamais de cœur après sa création**.
- SetProcessAffinityMask (`0x05`, réservé à `pm`) retire les cœurs 2 et 3 à tout processus hors de la région BASE.
- GetCurrentProcessorNumber (`0x11`) lit le registre MPIDR.

**Le temps.**

- **GetSystemTick** (`0x28`, `get_system_tick`, `0xFFF1AEF8`). Le noyau lit le compteur du chien de garde privé du cœur 1, dans le MPCore (`0x17E00824`), qui décompte. Il en prend le complément, le double, et ajoute en haut un compte de débordements tenu par lui-même. Le tick tourne à **268 111 856 Hz** : la même valeur que la constante de conversion des nanosecondes (`0x44A2FA85` / 2³²).
- **SleepThread** (`0x0A`, `0xFFF044F0`) :
  - durée négative : retour immédiat ;
  - **durée 0** : le fil se remet en queue de sa file de priorité ;
  - durée positive : le noyau retire 2 466 ns (le coût de l'appel, interprété), convertit en ticks, pose une alarme et endort le fil. Le résultat est toujours 0.

### Priorités et héritage

- **SetThreadPriority** (`0x0C`, `0xFFF053A8`). Mêmes vérifications que la création, puis `thread_set_priority` (`0xFFF1A254`).
- **Deux priorités par fil.** La priorité de base (`KThread+0x3C`) et la priorité effective (`+0x6C`), celle des files.
- **L'héritage.** La priorité effective est la plus forte entre la base et celle des fils qui attendent un mutex que ce fil détient : c'est un **héritage de priorité**. Un changement se propage aux mutex que ce fil attend lui-même.
- **GetThreadPriority** (`0x0B`) rend la priorité effective.

### Attendre : WaitSynchronization1 et N

- **WaitSynchronization1** (`0x24`, `0xFFF059D4`, puis `wait_one` `0xFFF06ACC`).
  - Délai négatif autre que −1 : `0xD8E007FD`. L'objet doit être attendable (bit 0 du jeton), sinon `0xD8E007F7`.
  - Si l'objet est libre, il est pris (méthode `+0x30`) et l'appel rend 0.
  - Avec un délai 0, il rend **`0x09401BFE`** tout de suite : c'est le code « délai écoulé ».
  - Sinon le fil s'inscrit auprès de l'objet et dort, avec `0x09401BFE` préchargé et une alarme si le délai est fini. Il rend 0 s'il est réveillé par l'objet.
  - Un fil qu'on termine pendant l'attente rend `0xD920060D`.
- **WaitSynchronizationN** (`0x25`, `0xFFF0A8F0`). Mêmes règles, **256 poignées au plus** (`0xD86007F3`), et un drapeau « tous » ou « n'importe lequel ».
- **Le réveil** (`sync_object_wake_waiters`, `0xFFF1DE50`). Il sert, parmi les fils pour qui l'objet est libre, celui de plus forte priorité. Il recommence tant que quelqu'un peut être servi. Un fil qui attend « tous » n'est réveillé que si tous ses objets sont libres ensemble.

**Ce que fait chaque objet** (méthodes `+0x2C` « libre ? », `+0x30` « prendre », `+0x34` « remettre à zéro ») :

- **KEvent.** Il a un type de remise à zéro (`+0x22`).
  - ONESHOT : prendre l'événement le remet à zéro.
  - STICKY : il reste signalé jusqu'à ClearEvent.
  - PULSE : il réveille ceux qui attendent, puis se remet à zéro.

  SignalEvent est `0xFFF0B7C4`, ClearEvent `0xFFF0B710`. Un événement lié à une interruption (BindInterrupt) est réarmé par ClearEvent.
- **KSemaphore.** Il a un compte (`+0x20`) et un maximum (`+0x24`). Prendre : décrément si le compte est > 0. ReleaseSemaphore (`0xFFF0DA04`) rend l'ancien compte. Dépasser le maximum rend `0xD8E007FD`.
- **KMutex.** Il est récursif : compte `+0x1C`, propriétaire `+0x20`, plus forte priorité en attente `+0x24`. Il est libre s'il n'a pas de propriétaire ou si le demandeur le détient déjà. ReleaseMutex (`0xFFF0B854`) refuse un fil qui n'est pas propriétaire (`0xD8E0041F`).
- **KTimer.** SetTimer (`0xFFF06EF4`) refuse un délai ou un intervalle négatif (`0xD8E007FD`). Le reste n'est pas lu.

### ArbitrateAddress (svc `0x22`), pas à pas

C'est le mécanisme sur lequel les bibliothèques construisent leurs verrous légers : un fil dort sur une adresse de sa mémoire, un autre le réveille. Enveloppe `0xFFF03614`, travail dans `arbitrate_address` (`0xFFF0979C`). Arguments : poignée de l'arbitre, adresse, type, valeur, délai sur 64 bits.

1. **Les vérifications.** Adresse non alignée sur 4 : `0xD8E007F1`. Poignée qui n'est pas un `KAddressArbiter` (`0x98`) : `0xD8E007F7`. Type > 4 : `0xD8E093ED`.
2. **Type 0, signal** (`arbiter_signal`, `0xFFF0EE34`). Il réveille les fils qui attendent sur cette adresse :
   - valeur négative : **tous** ;
   - valeur positive : au plus « valeur », à chaque fois le plus prioritaire ;
   - valeur 0 : aucun.

   Le résultat est toujours 0. Cas lu sans être compris : si personne n'a été réveillé, que l'appel vient du cœur 0 et que le numéro de priorité de l'appelant dépasse `0x31`, le noyau tourne `0x64E` fois dans une boucle vide avant de rendre la main.
3. **Type 1, attendre si inférieur** (`arbiter_wait`, `0xFFF0E89C`). Le fil s'inscrit d'abord dans la file de l'arbitre, puis lit le mot à l'adresse, par une lecture protégée.
   - Lecture impossible : il se retire, résultat `0xD9001814`.
   - Valeur ≥ argument : il se retire, résultat 0.
   - Sinon il dort jusqu'à un signal.
4. **Type 2, décrémenter et attendre si inférieur.** Le noyau vérifie d'abord la page en écriture, par la traduction d'adresse matérielle. Puis il lit et décrémente le mot de façon atomique (LDREX/STREX), **seulement si la valeur est inférieure** à l'argument.
5. **Types 3 et 4** : les types 1 et 2 avec un délai (`arbiter_wait_timeout`, `0xFFF0EA70`). À l'échéance, le résultat est `0x09401BFE`.
6. **CreateAddressArbiter** (`0x21`, `0xFFF0A700`) prend une place dans la catégorie 8 de la limite et un objet de `0x14` octets.

S'inscrire **avant** de lire la valeur évite qu'un signal arrivé entre la lecture et l'endormissement soit perdu. Un portage qui remplace ce mécanisme (par un futex, par exemple) doit garder cet ordre.

## Partie 8 : exceptions et erreurs

### Les vecteurs

La page `0xFFFF0000` contient huit sauts, puis du code. Chaque saut mène à un petit relais (`0xFFF0060C`…`0xFFF00644`) qui efface le moniteur exclusif (`clrex`) et charge l'adresse du vrai gestionnaire.

| Vecteur | Gestionnaire | Rôle |
| --- | --- | --- |
| `0x00` reset | `0xFFFF0058` | boucle `wfe` : un cœur garé. Le démarrage réel passe par le FIRM, pas par ce vecteur |
| `0x04` instruction indéfinie | `0xFFF02504` | sert surtout la VFP « paresseuse » (ci-dessous) |
| `0x08` svc | `0xFFF021F0` | les appels système (partie 3) |
| `0x0C` abandon de lecture d'instruction | `0xFFF02068` | faute d'exécution |
| `0x10` abandon de données | `0xFFF020B0` | faute d'accès mémoire |
| `0x14` réservé | boucle sur lui-même | |
| `0x18` IRQ | `0xFFF02128` | interruptions |
| `0x1C` FIQ | `0xFFF005E0` | masque le FIQ (CFG11 `0x10140104`) et prévient les cœurs 0 et 1 par l'interruption logicielle 15. Il n'arrive que sur une console de développement (interprété) |

### Ce que le noyau fait d'une faute d'un programme

Une faute venue du mode utilisateur suit toujours le même chemin. Le gestionnaire sauve l'état sur la pile noyau du fil et entre dans `exception_entry_c` (`0xFFF14A30`). Celle-ci appelle le traitant du genre de faute :

| Faute | Traitant |
| --- | --- |
| abandon de lecture d'instruction | `0xFFFF0338` |
| abandon de données | `0xFFFF0260` |
| instruction indéfinie | `0xFFFF040C` |
| exception flottante | `0xFFFF04E0` |

Les quatre traitants décident ainsi :

1. **Console du commerce** (octet `0xFFF2F00A` à 0, c'est-à-dire UNITINFO à 0) : **le processus est terminé tout de suite** (`terminate_current_process`, `0xFFF14C48`). Rien d'autre n'est tenté.
2. Console de développement, avec un débogueur attaché au processus : un événement « exception » lui est envoyé (sous-type 0 instruction indéfinie, 1 abandon d'instruction, 2 abandon de données). S'il répond `0x096007F9`, le fil reprend.
3. Console de développement, avec le drapeau posé par `KernelSetState(6, 1)` : la faute est renvoyée au **gestionnaire d'exception du programme** (`dispatch_user_exception_handler`, `0xFFFF0070`).
   - Son adresse est à `+0x40` du stockage local du fil, sa pile à `+0x44` et son tampon d'information à `+0x48`.
   - Le noyau y recopie les registres et le type de faute : 0 instruction, 1 données, 2 instruction indéfinie, 3 flottant.
   - Puis il relance le fil sur ce gestionnaire.
4. Sinon : fin du processus.

**Pour Pokémon X sur la console de l'utilisateur**, une faute du jeu le termine ; le gestionnaire d'exception du programme n'est jamais appelé par le noyau d'origine. Rendre ces chemins actifs sur une console du commerce est précisément l'un des correctifs que Luma3DS applique au démarrage (interprété, d'après son rôle connu ; le correctif n'est pas lu ici).

**Le noyau ne parle pas à `err:f`.** C'est la bibliothèque du jeu qui envoie l'erreur au service `err:f` (`errf_throw`, fiche `pokemon-x-services`) avant d'appeler `svcBreak` ou `svcExitProcess`. Et `svcBreak` lui-même termine le processus sur une console du commerce (partie 3).

### Les fautes du noyau lui-même

- **Les copies vers et depuis un programme.** `copy_from_user` (`0xFFF156B4`), `copy_to_user` (`0xFFF1579C`) et leurs voisines sont rangées dans la plage `0xFFF156B4`–`0xFFF1589C`. Un abandon de données dans cette plage est **rattrapé** : le noyau pose le drapeau Z, met `r12` à 0 et reprend à l'instruction suivante. La copie rend « échec », et l'appel système rend son code d'adresse invalide. C'est ainsi qu'un mauvais pointeur passé à un svc donne `0xE0E01BF5` ou `0xD9001814`, et non une panique.
- **Ailleurs dans le noyau** (`kernel_fault`, `0xFFF03514`). Une pile noyau à moins de `0x400` octets de sa fin mène à la panique. Sinon le processus en cours est terminé.
- **Une instruction indéfinie en mode noyau** mène à la panique.

### La VFP paresseuse

Le noyau ne sauve pas les registres flottants à chaque changement de fil. La VFP est coupée (FPEXC.EN à 0) pour un fil qui ne l'a pas encore touchée. Sa première instruction flottante provoque une instruction indéfinie ; le gestionnaire reconnaît une instruction de coprocesseur (`0xFFFF05C0`) et rend la VFP au fil, avec ses registres (`0xFFF06D98`). Puis il rejoue l'instruction. Si la VFP était déjà active, c'est une vraie exception flottante, traitée comme une faute.

### La panique

`kernel_panic` (`0xFFF1C848`) est appelée partout où une condition « impossible » est vraie : une réserve d'objets vide là où elle ne doit pas l'être, un compteur de références qui repasse par 0, une traduction IPC qui échoue, un appel système interdit. Elle procède ainsi :

1. Sur une console de développement seulement, elle remplit l'écran du bas d'une couleur unie (registre LCD `0x10202A04`) : rouge, ou jaune si le processus en cours est une application.
2. Elle coupe les interruptions et arrête les autres cœurs (`KernelSetState(5)`).
3. Elle attend que le registre des boutons (`0x10146000`) vaille `0xCF3`, c'est-à-dire L, R, START et SELECT enfoncés ensemble.
4. Elle repart par `KernelSetState(5)`.

**Un appel système interdit ne rend pas d'erreur.** Un numéro ≥ `0x80`, ou absent du masque du processus, passe par `svc_invalid` (`0xFFF04DF0`) :

- `svc 0xFF` est un point d'arrêt pour le débogueur ;
- tout autre numéro envoie un événement au débogueur s'il y en a un, puis **déclenche la panique**.

### KernelSetState (svc `0x7C`)

Réservé à `pm`, `ns` et `ptm` d'après leurs exheaders. Travail dans `kernel_set_state` (`0xFFF15F14`), sous un verrou (`0xFFF2F048`) :

| Type | Ce que fait le noyau |
| --- | --- |
| 0 | lancer un autre FIRM. Identifiant bas 2 et haut 0 donnent `0x20000002`, avec le haut fixé à `0x00040138`. Les autres cœurs sont prévenus par l'interruption logicielle 6 |
| 1 | rien |
| 2, 7 | arrêt ou redémarrage (interprété ; le redémarrage passe par le microcontrôleur, appareil I²C `0x4A`, registre `0x20`, valeur 4) |
| 3 | paramètre 0 : projeter la page des paramètres de lancement du FIRM dans le processus, entre `0x10000000` et `0x14000000`. Paramètre 1 : la recopier au début de la FCRAM, où le FIRM suivant la lira |
| 5, 10 | arrêter les autres cœurs |
| 6 | sur une console de développement : sous-types 1 et 2, poser les drapeaux « gestionnaire d'exception du programme » et « svcBreak arrête la console » ; sous-type 3 : réglage du temps processeur du cœur 1 (interprété) |
| 8 | une vérification matérielle (interprété) |
| 9 | ranger une valeur de 64 bits |
| autres | `0xF8C007F4` |

### Les interruptions

Le gestionnaire d'IRQ (`0xFFF02128`) vérifie qu'il reste `0x300` octets de pile noyau, puis passe l'interruption au gestionnaire d'interruptions du noyau (`irq_dispatch`, `0xFFF0653C`, objet `0xFFF32924`). Un module qui a lié une interruption par BindInterrupt reçoit un signal sur son `KEvent` ou son `KSemaphore`. Au retour, le noyau réordonnance si besoin.

## Partie 9 : la page de configuration et la page partagée

`init_config_memory` (`0xFFF01404`) remplit la page de configuration une fois, au démarrage. Les noms des champs sont ceux de 3dbrew (« Configuration Memory ») ; les valeurs sont lues dans le code.

| Position (à partir de `0x1FF80000`) | Champ (3dbrew) | Ce que le noyau y écrit |
| --- | --- | --- |
| `+0x00`–`+0x03` | KERNEL_UNK, VERSIONREVISION, VERSIONMINOR, VERSIONMAJOR | 0, 0, `0x3A`, 2 : **version 2.58-0** |
| `+0x04` | UPDATEFLAG | 1 si une condition matérielle est remplie (bit 0 d'un registre à zéro et un autre registre à `0xCBE`), sinon 0 (sens non lu) |
| `+0x08` | NSTID | `0x0004013000008002`, l'identifiant de titre de `ns` : le premier programme que `pm` lancera |
| `+0x10` | SYSCOREVER | 2 |
| `+0x14` | ENVINFO | bit 0 si l'octet UNITINFO vaut 0 (console du commerce), bit 1 si le débogage matériel est ouvert (registre de débogage CP14, bit 14) |
| `+0x15` | UNITINFO | recopié de l'information de démarrage |
| `+0x16` | — | recopié de l'information de démarrage |
| `+0x18` | KERNEL_CTRSDKVERSION | `0xF450` |
| `+0x20` | — | mot `+0x400` des paramètres de lancement du FIRM |
| `+0x30` | APPMEMTYPE | le type de mémoire retenu (partie 2) |
| `+0x40` | APPMEMALLOC | taille de la région APPLICATION (`0x7C00000` ou `0xB200000`) |
| `+0x44` | SYSMEMALLOC | `0x10000000` − APPLICATION − BASE |
| `+0x48` | BASEMEMALLOC | `0x2000000` |
| `+0x60`–`+0x68` | FIRM_VERSION…, FIRM_SYSCOREVER, FIRM_CTRSDKVERSION | recopiés des paramètres de lancement s'ils sont valides (marque `0xFFFF` et bit 8 du drapeau), sinon une copie de la version du noyau |

La **page partagée** (`0x1FF81000`) est seulement allouée et projetée par le noyau, qui n'y écrit rien dans les fonctions lues ici. L'heure, l'état du réseau, le curseur 3D et les autres champs y sont écrits par les modules dont l'exheader a le bit « écriture dans la page partagée » (`ptm`, `ns`… d'après 3dbrew ; non vérifié ici). Pour un portage, ce sont donc des valeurs à fournir, pas à calculer comme le noyau.

## Partie 10 : recoupements avec les fiches

Le script `local/analyse/kernel11/crosscheck.py` reprend chaque tableau « appels système » des onze fiches de modules, et les instructions `svc` du code de Pokémon X. Pour chaque appel, il vérifie trois choses :

- qu'il existe dans la table du noyau ;
- que ce n'est pas un de ceux qui rendent « non implémenté » ;
- que le masque des appels permis de l'exheader du module l'accorde.

**Résultat : aucun écart**, sur 293 appels relevés dans les fiches et 34 numéros dans le jeu. Les noms des fiches sont aussi ceux de la table au même numéro.

Ce que les fiches supposent, et ce que le noyau fait :

| Fiche | Ce qu'elle suppose | Dans le noyau |
| --- | --- | --- |
| `sm` | `svcReplyAndReceive` rend `0xC920181A` quand un client ferme sa session | oui : session fermée, ou réponse sans requête en cours (partie 5) |
| `sm` | RegisterClient reçoit le numéro du processus parce que le client écrit `0x20` | oui : descripteur `0x20` remplacé par `KProcess+0xBC` (partie 5) |
| `sm` | les processus « sous un seuil » sont les modules système | les cinq modules du FIRM reçoivent les numéros 0 à 4 (partie 2) |
| `sm`, `loader` | un port qui sonne dans ReplyAndReceive se traite par AcceptSession | oui : le noyau ne rend que l'index du port (partie 5) |
| `loader` | CreateCodeSet (`0x73`), CreateProcess (`0x75`) fabriquent le processus ; `pm` le lance par Run (`0x12`) | entrées `0xFFF036D0` → `0xFFF086A0`, `0xFFF0376C` → `0xFFF087E4`, `0xFFF03BE0` → `0xFFF0B6B8` ; le noyau ne lance lui-même que les cinq modules du FIRM |
| `loader` | `loader` passe à svcControlMemory le type de mémoire lu dans l'exheader (`0x100`, `0x200`, `0x300`) | seul le processus n° 1, `loader`, peut imposer une région ; pour tout autre, ces bits sont remplacés par la région du processus (partie 6) |
| `pm` | SetProcessAffinityMask et SetProcessIdealProcessor ne servent qu'à `pm` | ils sont dans le masque de `pm` seulement ; hors région BASE, les cœurs 2 et 3 sont retirés (partie 7) |
| `fs`, `pxi` | les tampons de `fs` vers Process9 passent en adresses physiques | descripteurs 4 et 6 : liste de morceaux physiques, une page, 0x200 paires au plus (partie 5) |
| `gsp`, `hid`, `dsp` | la mémoire partagée se crée par CreateMemoryBlock et se projette par MapMemoryBlock | entrées `0xFFF0370C` → `0xFFF09C6C`, `0xFFF04878`, `0xFFF04F20` (partie 3) |
| `contrat-gsp` | la fiche laisse ouvert dans laquelle des deux plages de tas linéaire (`0x14000000` ou `0x30000000`) tombent les allocations du jeu | **`0x14000000`** : l'exheader du jeu vise le noyau `0x223`, sous le seuil `0x22B`, et sa région est APPLICATION (partie 6). La conversion de `gsp` (plus `0x0C000000`) est bien la soustraction du noyau |

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- **Le découpage de l'image et les adresses virtuelles.** Ils sont lus dans les appels de recopie du démarrage, et dans les tables de pages construites par le code du noyau lui-même, exécuté dans un émulateur.
- **La table des appels système.** Les 126 entrées sont lues dans l'image. Les noms de 3dbrew tombent sur des fonctions dont le travail correspond : CreateEvent prend un `KEvent`, CreateThread un `KThread`, etc. Aucun des 293 appels des fiches ne tombe sur une case vide ou sur un « non implémenté », et chacun est permis par l'exheader de son module.
- **Les classes d'objets, leur taille et leur nombre.** Le nom et la table virtuelle viennent de la fonction « type ». Taille et nombre sont lus deux fois, à la création des réserves et dans le tableau de débogage. Le lien classe ↔ réserve vient de la fonction de destruction et de la fonction de création.
- **L'ordre et les numéros des cinq modules du FIRM.** Ils sont lus dans `create_firm_modules` et dans les NCCH de la section 0 du FIRM : `fs`, `loader`, `pm`, `sm`, `pxi`.
- **La version 2.58.** Elle est écrite en constantes dans la page de configuration, et c'est la plus haute version que l'analyse des capacités accepte (`0x23A`).
- **La fréquence du tick, 268 111 856 Hz.** Elle se déduit de deux constantes : la lecture du compteur (doublé) et la conversion des nanosecondes.
- **Le tas linéaire de Pokémon X à `0x14000000`.** Le seuil est lu dans le noyau, la version visée dans l'exheader du jeu, et la conversion d'adresse de `gsp` (fiche `contrat-gsp`) est la même.

**Lu dans le code, une seule voie**
- Les vérifications et les codes d'erreur de toutes les parties 3 à 8, le chemin d'une requête et la traduction des descripteurs.
- La zone `0x04000000`–`0x08000000` des tampons projetés.
- ControlMemory, CreateThread, ArbitrateAddress et WaitSynchronization.
- Le sort d'une faute sur une console du commerce et la table des poignées.

**Interprété à la lecture, à relire**
- L'ordre réel dans lequel les cinq modules prennent le processeur au premier instant : il est déduit des priorités.
- Le rôle de cinq réserves sans nom, et de la page écrite par `write_slab_heap_info_page`.
- La limite de 64 Mo d'une application de l'ancienne 3DS, attribuée à `pm`. Le sens d'UPDATEFLAG et des octets `+0x16` et `+0x20` de la page de configuration.
- Dans l'IPC :
  - le sens exact de `KThread+0x94`/`+0x98` (adresses du stockage local côté programme et côté noyau) ;
  - le rôle de `0xFFF223D4` (l'attente « un ou tous ») ;
  - la conversion du code `0xD9400415`.
- Dans l'ordonnancement :
  - le partage du cœur 1 (fenêtre de 25 ms, catégorie 9, part de 25 posée par le noyau) ;
  - le passage au détenteur d'un mutex ;
  - l'absence de tranche de temps ;
  - le FPSCR initial ;
  - le tableau des pages TLS commun à tous les processus ;
  - la boucle de `0x64E` tours d'ArbitrateAddress.
- Dans les exceptions et les appels :
  - le FIQ des consoles de développement ;
  - les types 2, 7, 8 et 6.3 de KernelSetState ;
  - les règles fines de MapMemoryBlock ;
  - le refus de `0x10000000` par CreateMemoryBlock pour les droits des autres, contraire à 3dbrew ;
  - les types 0-3 et `0x15`-`0x17` de GetProcessInfo ;
  - le lien avec le correctif de Luma3DS.

**Pas lu**
- Le cœur de l'attente multiple (`0xFFF223D4`), la vérification des droits de pages (`0xFFF190A8`), la copie entre deux espaces d'adresses (`0xFFF1A83C`), la fermeture du bout client d'une session.
- QueryMemory en détail, les états de mémoire au-delà de ceux cités, la fusion et le découpage des blocs de mémoire d'un processus.
- KTimer, GetThreadAffinityMask, GetThreadIdealProcessor, ExitThread en détail, les fonctions de file de l'ordonnanceur, les minuteries matérielles.
- Le débogueur du noyau (svc `0x60`–`0x6D`, `KDebug`), le DMA au-delà des vérifications d'entrée, SetProcessResourceLimits, GetHandleInfo et GetThreadInfo, la fin d'un autre processus.
- Le haut du code (`0xFFF20000`–`0xFFF2E000`) n'est lu que là où un chemin décrit ici y mène ; il contient surtout les méthodes des objets.

## Comment ce document a été fait

Le noyau n'est pas un module. `ghidra_direct.py` et le pont REA attendent un `code.bin` avec son exheader, et le noyau n'en a pas. Il a donc fallu reconstituer la carte des adresses avant de pouvoir le lire. La méthode est rangée dans `outils/` (`firm.py`, `ghidra_raw.py`, `svc_check.py`, la cible `kernel11` de `raw_targets.toml` ; voir `outils/REA.md`, partie 4 ter). Les scripts de lecture propres à cette fiche sont restés dans `local/analyse/kernel11/`.

| Étape | Outil | Durée |
| --- | --- | --- |
| Lire l'en-tête du FIRM : sections, adresses de chargement, point d'entrée | `outils/firm.py` | immédiat |
| Désassembler toute la section à son adresse physique et lire le point d'entrée jusqu'au saut vers `0xFFF00030` | `arm-none-eabi-objdump` de devkitARM | une demi-heure de lecture |
| Repérer la fonction qui construit les tables de pages (l'appel qui suit l'écriture de TTBR0) et **l'exécuter dans unicorn** : `firm.py map` charge l'image à `0x1FF80000`, appelle `0x1FFAF5A4` pour chaque cœur, puis décode les tables L1 et L2 qu'elle a écrites | unicorn de `local/pylib/` | immédiat |
| Lire les quatre appels de recopie du démarrage et les recouper avec la carte obtenue ; la carte des morceaux est écrite dans `outils/raw_targets.toml` (`[kernel11.firm]`), et `firm.py map` vérifie chaque morceau contre les tables de pages | lecture | quelques minutes |
| Fabriquer un ELF à plusieurs segments, un par morceau à son adresse virtuelle, plus des segments vides pour la mémoire qui n'existe qu'à l'exécution (réserves, registres, FCRAM, pages des cœurs) : `firm.py` écrit `local/extrait/firm/kernel11/kernel11.elf` | Python | immédiat |
| Lancer Ghidra headless sur cet ELF (`ghidra_raw.py kernel11`) avec les scripts de `outils/ghidra_scripts/` : `SeedFunctions.java` reçoit en graines le point d'entrée, les fonctions de démarrage, les six gestionnaires d'exception, les 109 entrées non nulles de la table des svc et la table des constructeurs ; `RecoverFunctions.java` juge les pointeurs vers du code (tables virtuelles surtout) ; `DumpFunctions.java` range le pseudo-code, `DumpListing.java` l'assembleur | Ghidra 12.1.4 sous WSL, 3 Go de tas | 3 minutes |
| Lire la table des svc et la croiser avec les noms de 3dbrew (`svc_table.py`, `mk_svc_md.py`) | Python | immédiat |
| Retrouver les classes : les chaînes `K…` de `.rodata`, la fonction qui les désigne (jeton de classe), la table virtuelle qui contient cette fonction, la réserve que désigne la fonction de destruction (`ktypes.py`, `xref_value.py`) | Python | immédiat |
| Lire `kernel_main`, la création des modules, la mémoire, la page de configuration | Claude, dans le pseudo-code, constantes résolues par `peek.py dat` | le gros du temps |
| Lire en parallèle l'IPC, l'ordonnancement et les exceptions | trois sous-agents sur le même pseudo-code, notes dans `notes_*.md` | un quart d'heure chacun |
| Recouper avec les fiches et les exheaders (`outils/svc_check.py`, aussi lancé par `outils/tests.py`) | Python | immédiat |
| Fabriquer le fichier de noms (`gen_names.py`), le recharger dans Ghidra (`ApplyNames.java`) | Python, Ghidra | 3 minutes |

Pour refaire l'analyse depuis le FIRM dumpé :

```text
python outils/firm.py local/dump/systeme/native.firm
python outils/firm.py map 0 1 2 3
python outils/ghidra_raw.py kernel11
python outils/svc_check.py
```

Le résultat est dans `local/analyse/kernel11/gh/`. Relancé ainsi le 2026-10-14 : les mêmes 988 fonctions, 359 noms posés et 0 nom sans fonction.

Deux pièges rencontrés :

- **Le `;` de `-scriptPath`.** Sous `wsl.exe`, la commande passe par `bash`, qui coupe la liste des dossiers de scripts sur le `;`. Il faut l'entourer d'apostrophes ; `run_headless` (dans `outils/ghidra_direct.py`) protège chaque argument.
- **Les données au milieu du code.** Une ligne `label` du fichier de noms, posée dans un morceau exécutable, est prise par `ApplyNames.java` pour une fonction Thumb à créer. Une table posée dans le code s'écrit en ligne `data` (c'est le cas de la table des svc, `0xFFF0230C`) ; la table des constructeurs (`0x1FFB045C`) et celle des tables de pages (`0x1FFB03D4`) sont seulement citées ici.
