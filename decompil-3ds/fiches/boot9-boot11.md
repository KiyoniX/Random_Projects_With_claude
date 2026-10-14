# boot9 et boot11, les deux mémoires de démarrage

Quand on allume la console, les deux processeurs partent chacun de leur mémoire morte : **boot9** sur l'ARM9 (l'ARM946 qui fera tourner Process9), **boot11** sur l'ARM11 (le MPCore qui fera tourner kernel11 et tous les modules des autres fiches). Ensemble, ils trouvent le FIRM dans la NAND, vérifient sa signature RSA et l'empreinte SHA-256 de chaque section, le recopient, préparent le moteur AES, puis sautent chacun à son point d'entrée. Ensuite ils ne servent plus : une partie de chacune des deux mémoires est verrouillée juste avant le saut.

Pour le projet, l'intérêt est de savoir **ce qu'il faudra simuler**. La réponse courte est en partie 5 : ni le chargement ni les vérifications ne sont à refaire pour lancer Pokémon X sur PC, mais le FIRM s'attend à trouver un état précis (registres, caches, zones de mémoire remplies) qu'il faudra fabriquer si l'on fait tourner kernel11 ou Process9 tels quels.

Fiche du 14 octobre 2026, faite avec Ghidra sur les deux images dumpées par boot9strap sur la New 3DS XL de l'utilisateur. Ce ne sont pas des modules : pas d'exheader, pas de services, pas d'appels système. La forme des autres fiches est adaptée en conséquence.

## Ce que ce dump a de sensible

Chaque image a deux moitiés de 32 Ko. La **moitié publique** (les 32 premiers Ko) ne contient que du code. La **moitié protégée** contient du code, et surtout, à la fin, un bloc de données : les clés que partagent toutes les consoles (clés RSA publiques et privées, données des emplacements AES), et dans boot11 des données destinées au mode DS. Ce qui est propre à **cette** console n'est pas dans les mémoires mortes mais dans l'OTP, que boot9 lit et déchiffre au démarrage (partie 3.2).

Cette fiche et ses deux fichiers de noms ne contiennent **aucun octet** de ces données, ni de l'OTP, ni aucune empreinte de clé : seulement des adresses, des tailles, des numéros d'emplacements de clés et des adresses de registres matériels. Les blocs de données ont été rendus non exécutables dans Ghidra avant toute analyse, et les scripts qui écrivent les listings ne lisent jamais ce qu'ils contiennent (partie « Comment ce document a été fait »). Les fichiers d'analyse restent dans `local/analyse/boot/`, jamais versionnés.

## Carte d'identité

| | boot9 | boot11 |
| --- | --- | --- |
| Processeur | ARM946E-S (ARMv5TE), langage Ghidra `ARM:LE:32:v5t` | ARM11 MPCore (ARMv6K), `ARM:LE:32:v6` |
| Fichier | `local/dump/systeme/boot9.bin`, 65 536 octets | `local/dump/systeme/boot11.bin`, 65 536 octets |
| Adresse | `0xFFFF0000`-`0xFFFFFFFF` (vecteurs hauts de l'ARM9) | `0x00000000`-`0x0000FFFF`, copie à `0x00010000`-`0x0001FFFF`. Le code s'exécute à la copie : ses pointeurs visent `0x0001xxxx`. Les adresses de cette fiche sont celles de la copie |
| Moitié publique | `0xFFFF0000`-`0xFFFF7FFF` : code jusqu'à `0xFFFF5D30`, puis des zéros | `0x00010000`-`0x00017FFF` : vecteurs et petit amorçage jusqu'à `0x000100F0`, code de `0x00011000` à `0x00013BA0`, puis des zéros |
| Moitié protégée | `0xFFFF8000`-`0xFFFFFFFF` : code jusqu'à `0xFFFFB088`, données de `0xFFFFB088` à `0xFFFFE290`, puis des zéros | `0x00018000`-`0x0001FFFF` : code jusqu'à `0x00019400` (avec une petite image de police à `0x0001817C`-`0x000181F4`), données jusqu'à `0x0001D198` |
| Verrou de la moitié protégée | `CFG9_SYSPROT9` (`0x10000000`) bit 0 | `CFG9_SYSPROT11` (`0x10000001`) bit 0, écrit **par boot9** |
| Fonctions | 564, dont 469 en Thumb ; 258 nommées dans `boot9.noms.tsv` (160 sur 402 dans la moitié publique, 98 sur 162 dans la protégée) | 227, dont 153 en Thumb ; 109 nommées dans `boot11.noms.tsv` (88 sur 163, 21 sur 64) |
| Point d'entrée | vecteur de reset `0xFFFF0000`, qui saute à `0xFFFF0030` puis à `crt0_start` (`0xFFFF8000`, moitié protégée) | vecteur de reset `0x00000000` (et `0x00010000`), qui saute à `reset_handler` (`0x00010028`) ; le cœur 0 continue à `0x00018000` puis `crt0_start` (`0x00018004`) |
| Fonction principale | `main` (`0xFFFF8228`, Thumb) | `main` (`0x000182A4`, Thumb) |

### Les vecteurs d'exception

Les deux mémoires renvoient les exceptions vers une table en mémoire vive, que le FIRM remplira.

| Exception | boot9 : vecteur, relais, destination | boot11 : vecteur, relais, destination |
| --- | --- | --- |
| Reset | `0xFFFF0000` → `0xFFFF0030` → `0xFFFF8000` | `0x00010000` → `0x00010028` |
| Instruction indéfinie | `0xFFFF0004` → `0xFFFF009C` → `0x08000018` | `0x00010004` → `0x00011068` → `0x1FFFFFB8` |
| SVC | `0xFFFF0008` → `0xFFFF0094` → `0x08000010` | `0x00010008` → `0x00011060` → `0x1FFFFFB0` |
| Abandon de préchargement | `0xFFFF000C` → `0xFFFF00A4` → `0x08000020` | `0x0001000C` → `0x00011070` → `0x1FFFFFC0` |
| Abandon de données | `0xFFFF0010` → `0xFFFF00AC` → `0x08000028` | `0x00010010` → `0x00011078` → `0x1FFFFFC8` |
| Réservé | `0xFFFF0014`, boucle sur lui-même | `0x00010014`, boucle sur lui-même |
| IRQ | `0xFFFF0018` → `0xFFFF0088` → `0x08000000` | `0x00010018` → `0x00011054` → `0x1FFFFFA0` |
| FIQ | `0xFFFF001C` → `0xFFFF008C` → `0x08000008` | `0x0001001C` → `0x00011058` → `0x1FFFFFA8` |

Chaque destination est une case de 8 octets : une instruction « charger pc depuis le mot suivant », puis une adresse. Au démarrage, `install_ram_exception_vectors` remplit les six cases (`0x08000000`-`0x0800002F` sur l'ARM9, `0x1FFFFFA0`-`0x1FFFFFCF` sur l'ARM11) à partir d'une petite table de la moitié publique :

| Case | boot9 | boot11 |
| --- | --- | --- |
| SVC | `svc_handler` (`0xFFFF00DC`) | `svc_handler` (`0x000110A8`) |
| Instruction indéfinie | boucle (`0xFFFF0078`) | `undefined_instruction_handler` (`0x0001114C`), qui reconnaît les instructions de coprocesseur (VFP) |
| Abandon de préchargement | boucle (`prefetch_abort_loop`, `0xFFFF0080`) | boucle (`0x0001104C`) |
| IRQ, FIQ, abandon de données | boucle (`0xFFFF0078`) | boucle (`0x00011044`) |

boot11 remplace ensuite l'adresse de la case IRQ par son propre gestionnaire, `irq_dispatch` (`0x00011D90`, écrit par `gic_init` à `0x1FFFFFA4`). boot9 fait de même : `irq_init` (`0xFFFF2028`) écrit l'adresse de son `irq_dispatch` (`0xFFFF0C78`) en `0x08000004`, et ce gestionnaire appelle une table de 30 fonctions rangée en DTCM (`0xFFF001B4`).

## Partie 1 : boot9, du reset à main

`crt0_start` (`0xFFFF8000`, ARM) :

1. Remet à 0 le bit 0 de `CFG9_RST11` (`0x10000002`) : d'après 3dbrew, c'est ce qui laisse partir l'ARM11. boot11 démarre donc un instant après boot9.
2. Pose une pile par mode, interruptions masquées : superviseur `0xFFF04000`, IRQ `0xFFF03F00`, système `0xFFF03B00`. La suite tourne en mode système, IRQ et FIQ masquées ; `irq_init` (`0xFFFF2028`) démasquera les IRQ dans `main`, et `firm_boot` les masquera de nouveau pour de bon. Les trois piles sont dans la DTCM (`0xFFF00000`, 16 Ko).
3. `mpu_init` (`0xFFFF80CC`) coupe le MPU et les caches, les vide, puis décrit huit régions : la FCRAM (`0x20000000`), les registres d'entrées-sorties (`0x10000000`), la mémoire vive ARM9 (`0x08000000`, 1 Mo) et à part sa première page (les vecteurs), la DTCM (`0xFFF00000`, 16 Ko), l'ITCM (`0x07FF8000`, 32 Ko), la mémoire morte elle-même (`0xFFFF0000`, 64 Ko) et le haut de l'AXI WRAM (`0x1FFFE000`, 8 Ko, la zone d'échange avec l'ARM11). La TCM d'instructions est placée en `0x00000000` sur 128 Mo (ses copies remplissent l'espace, dont `0x01FF8000` et `0x07FF8000`), celle de données en `0xFFF00000`. Le MPU et les caches sont ensuite rallumés.
4. `install_ram_exception_vectors` (`0xFFFF0038`), puis remise à zéro de `0x08000030`-`0x0800003F`.
5. Remise à zéro de toute la DTCM, puis `dtcm_init` (`0xFFFFAF00`) y recopie l'image initiale de `0x230` octets rangée dans la moitié protégée (`0xFFFFE060`), et remet à zéro `0xFFF00230`-`0xFFF01AC0`. Cette image contient surtout des pointeurs vers les blocs de clés : c'est par elle que le code trouve les clés « console de vente » ou « console de développement ».
6. Saut en Thumb dans `main` (`0xFFFF8228`), avec pour adresse de retour une boucle infinie (`main_return_trap`, `0xFFFF8068`).

## Partie 2 : boot11, du reset à main, et les quatre cœurs

Les quatre cœurs de la New 3DS (deux sur l'ancienne) partent tous de `reset_handler` (`0x00010028`) :

1. Lecture d'un mot de la moitié protégée (`0x00018004`). S'il vaut 0 ou `0xFFFFFFFF`, la moitié protégée est déjà verrouillée (redémarrage à chaud) : le cœur tourne en rond sur place.
2. Lecture du numéro de cœur (registre CP15 `MPIDR`).
3. **Cœur 0** : saut à `0x00018000`, puis `crt0_start` (`0x00018004`).
4. **Cœur 1** : masque les interruptions, active l'interface processeur du contrôleur d'interruptions (`0x17E00100`) et le distributeur (`0x17E01000`), efface toutes les interruptions en attente (`0x17E01280`), puis dort (`wfi`) jusqu'à ce que son bit soit en attente dans ce même registre, c'est-à-dire jusqu'à ce qu'un autre cœur lui envoie une interruption logicielle. Il saute alors à l'adresse rangée en **`0x1FFFFFDC`**. boot11 n'écrit jamais cette case (il la remet à zéro au démarrage) : c'est kernel11 qui la remplit puis réveille le cœur 1.
5. **Cœurs 2 et 3** : dorment pour toujours (`wfi` en boucle). Ce n'est pas boot11 qui les lancera.

`crt0_start` du cœur 0 (`0x00018004`, ARM) :

1. Piles : superviseur `0x1FFF4000`, IRQ `0x1FFF3F00`, système `0x1FFF3000`, dans l'AXI WRAM.
2. `install_ram_exception_vectors` (`0x00011000`), puis `mmu_cache_disable_crt0` (`0x000180B0`).
3. `mmu_build_page_tables` (`0x000191CC`) : table de premier niveau à `0x1FFF4000` (16 Ko), tables de second niveau à `0x1FFF8000`-`0x1FFFA000`. Sont décrits : la mémoire morte (`0x00000000`-`0x0001FFFF`), les registres (`0x10000000`-`0x10FFFFFF`), la zone privée du MPCore (`0x17E00000`), la mémoire vidéo (`0x18000000`-`0x185FFFFF`), l'AXI WRAM et la page des vecteurs hauts. Les adresses sont identiques aux adresses physiques.
4. `mmu_cache_enable_crt0` (`0x000180EC`) active le contrôleur de cohérence (SCU, `0x17E00000`), puis la MMU et les caches.
5. Remise à zéro de `0x1FFFE000`-`0x1FFFFF9F` et de `0x1FFFFFD0`-`0x1FFFFFFF` : la zone d'échange avec boot9 et la case du cœur 1. Les six cases de vecteurs (`0x1FFFFFA0`-`0x1FFFFFCF`) sont épargnées.
6. `data_init` (`0x00019390`) : recopie de `0x120` octets de données initiales (rangées à la fin de la moitié protégée) vers `0x1FFE8000`, remise à zéro du reste jusqu'à `0x1FFE8E60`.
7. Saut en Thumb dans `main` (`0x000182A4`).

## Partie 3 : la séquence de démarrage, pas à pas

### 3.1 Les deux `main` côte à côte

| Étape | boot9 (`main`, `0xFFFF8228`) | boot11 (`main`, `0x000182A4`) |
| --- | --- | --- |
| Matériel | `hw_init_once` (`0xFFFF1FF8`) : minuteries (`0x10003000`), interruptions (`0x10001000`), moteurs DMA (`ndma_init`, `xdma_init`), et un relevé des boutons (`hid_take_boot_snapshot`, `0xFFFF4F64`) | `hw_init_once` (`0x0001263C`) : minuteries du MPCore et chien de garde coupé (`watchdog_disable`), contrôleur d'interruptions (`gic_init`, `0x0001267C`), compteurs de performance recopiés en `0x1FFFE000`-`0x1FFFE00B`, bus I2C, relevé des boutons, deux sorties GPIO |
| Données pour l'ARM9 | | `copy_ntrcard_table_to_axi_wram` (`0x000182D0`) : `0x1000` octets de la moitié protégée de boot11 vers `0x1FFFD000`, lus plus tard par boot9 pour la cartouche DS |
| Couvercle | | `read_shell_state` (`0x00013944`) : lit le registre `0x0F` du microcontrôleur par I2C (à défaut, le GPIO `0x10147000`) et écrit le résultat en `0x1FFFE00F` : 2 si le microcontrôleur dit le couvercle fermé, 0 sinon ; à défaut de réponse, le bit 2 du GPIO (1 si fermé, d'après 3dbrew) |
| Rendez-vous PXI | `pxi_init` (`0xFFFF2220`) : envoie l'octet 9, attend 11 | `pxi_init` (`0x00012E14`) : envoie 11, attend 9 |
| Suite | crypto, clés, recherche du FIRM (3.2 à 3.6) | `set_firm_boot_callback` (`0x00012220`) range `firm_boot_callback` (`0x000181F4`) en `0x1FFE8028`, puis `firm_boot` (`0x00012454`) : attente du point d'entrée ARM11 (3.8) |

Les octets de synchronisation passent par `PXI_SYNC9` (`0x10008000`) et `PXI_SYNC11` (`0x10163000`) : chaque côté écrit un octet que l'autre lit. Le rendez-vous 9 / 11 garantit aussi que boot11 a écrit l'état du couvercle avant que boot9 le lise.

### 3.2 Les moteurs de chiffrement et les clés (boot9)

Dans cet ordre, dans `main` :

1. `rsa_init` (`0xFFFFA850`), puis `rsa_init_public_keyslots` (`0xFFFF8594`) : trois emplacements du moteur RSA (`0x1000B000`) reçoivent un module de 2048 bits et l'exposant public, lus dans la moitié protégée : **emplacement 3** pour l'en-tête NCSD de la NAND, **1** pour les FIRM de la NAND, **2** pour les FIRM venus d'ailleurs (carte SPI, cartouche). L'emplacement 0 reste vide. Le jeu « vente » ou « développement » est choisi par `CFG9_UNITINFO` (`0x10010010`, 0 sur une console de vente).
2. `crypto_init` (`0xFFFFACF8`) : moteur SHA (`0x1000A000`) et routage DMA. `aes_reset` (`0xFFFF89E4`) : moteur AES (`0x10009000`).
3. **Emplacement AES `0x3F`** : clé normale et vecteur d'initialisation lus dans la moitié protégée (`aes_set_normal_key`, `aes_set_ctr`), toujours selon `CFG9_UNITINFO`.
4. **L'OTP** : `otp_decrypt` (`0xFFFFAC00`) déchiffre les `0x100` octets de l'OTP (`0x10012000`) en AES-CBC avec l'emplacement `0x3F`, dans un tampon sur la pile ; `otp_verify_hash` (`0xFFFFAC34`) compare le SHA-256 des `0xE0` premiers octets aux `0x20` suivants ; `copy_otp_to_itcm` (`0xFFFFABD8`) recopie les `0x90` premiers octets déchiffrés en ITCM, à **`0x07FFB800`**, et met à zéro les `0x70` suivants.
5. `init_aes_keyslots` (`0xFFFF9014` → `0xFFFF9038`) remplit presque tout le moteur AES. Sa source est un mélange de `0x70` octets de l'OTP déchiffré (pris à partir de `+0x90`) et d'un bloc de `0x400` octets de la moitié protégée. Si le déchiffrement ou la vérification de l'OTP échoue, il lit l'OTP brut à `0x10012000` à la place. Il procède en quatre tours : chaque tour prend `0x1C` octets de l'OTP, les complète à `0x40` avec des données de la mémoire morte et en fait un SHA-256 ; les deux moitiés de l'empreinte deviennent la clé X et la clé Y de l'emplacement `0x3F`, avec lequel il chiffre ensuite `0x40` octets de la mémoire morte : cela donne quatre blocs de 16 octets, posés comme clés X.

   | Emplacements | Ce qui est posé | D'où |
   | --- | --- | --- |
   | `0x04`-`0x0F`, `0x10` | clé X | tour 1 : propre à la console |
   | `0x14`-`0x17` | clé X | tour 2 : propre à la console |
   | `0x18`-`0x23`, `0x24` | clé X | tour 3 : propre à la console |
   | `0x28`-`0x2B` | clé X | tour 4 : propre à la console |
   | `0x2C`-`0x3F` | clé X | mémoire morte : commune à toutes les consoles |
   | `0x04`-`0x0B` | clé Y | mémoire morte |
   | `0x0C`-`0x3F` | clé normale | mémoire morte |

   Les emplacements `0x10`, `0x24` et `0x38` sont écrits quatre fois de suite avec la même valeur, et `0x28` et `0x3C` reçoivent la même clé normale que `0x24` et `0x38` : on le voit au code, la cause n'est pas connue. Les emplacements `0x00`-`0x03` (ceux du mode DS) ne sont pas touchés. À la fin, la clé normale définitive de `0x3F` est gardée en DTCM (`0xFFF00618`), pour la remettre si un démarrage hors NAND échoue (`restore_keyslot_3f_normal_key`, `0xFFFF95A8`).
6. Le tampon de l'OTP sur la pile est remis à zéro.

### 3.3 Le choix du support

`main` essaie trois supports, dans cet ordre. Chaque essai écrit un octet d'état en `0x1FFFE00C`-`0x1FFFE00E` (0 pour un succès, négatif sinon), que boot11 affichera en cas d'échec.

| Ordre | Support | Condition pour essayer | Fonctions | Octet d'état |
| --- | --- | --- | --- | --- |
| 1 | cartouche DS (« ntrboot ») | **exactement** X + Start + Select enfoncés (masque `0x40C` sur les 12 bits des boutons, `0x10146000`), couvercle fermé (`0x1FFFE00F` non nul), et cartouche présente (`CFG9_CARDSTATUS`, `0x10000010`, bit 0 à 0) | `ntrcard_init` (`0xFFFFA5D0`), `boot_device_setup_ntrcard` (`0xFFFF8F60`), `read_firm_header_and_load` (`0xFFFF95D8`) | `0x1FFFE00D` |
| 2 | NAND (eMMC) | toujours, sauf si la cartouche a réussi | `sdmmc_controller_init` (`0xFFFF56C8`), `sdmmc_nand_init` (`0xFFFF5774`, périphérique `0x201`), `boot_device_setup_nand` (`0xFFFF8F14`), `nand_find_and_load_firm` (`0xFFFF8D50`) | `0x1FFFE00C`, plus un octet par partition en `0x1FFFE010`-`0x1FFFE017` |
| 3 | mémoire flash SPI du module wifi | si la NAND a échoué, et si l'octet d'état de la flash (`spi_flash_read_status`, `0xFFFF3668`, registres `0x10160000`) a son bit 0 à 0 | `boot_device_setup_spi_flash` (`0xFFFF8F9C`), `read_firm_header_and_load` | `0x1FFFE00E` |

Après la NAND, boot9 range aussi les deux mots d'erreur du pilote SD en `0x1FFFE018` et `0x1FFFE01C` (`sdmmc_get_error_status`, `0xFFFF5690`), puis éteint le contrôleur (`sdmmc_deinit`). Après un échec de la cartouche ou de la flash, la clé normale de `0x3F` est remise (3.2, point 5).

Un **support** est une petite table de cinq fonctions en DTCM (`0xFFF000C8`, posée par `boot_device_set_callbacks`, `0xFFFF8FC0`) : lire un secteur brut, lire un secteur déchiffré, puis copier une section par NDMA, par XDMA ou par le processeur. La case `+0x14` de la même table garde l'adresse de l'en-tête du FIRM retenu.

| Support | Lecture brute | Lecture d'en-tête | Copie NDMA | Copie XDMA | Copie processeur |
| --- | --- | --- | --- | --- | --- |
| NAND | `0xFFFFA4A8` | `0xFFFFA3A8` (déchiffrée) | `0xFFFFA1AC` | `0xFFFFA26C` | `0xFFFFA0F0` |
| flash SPI | aucune | `0xFFFFA3C4` | `0xFFFFA1C8` | `0xFFFFA288` | `0xFFFFA10C` |
| cartouche | aucune | `0xFFFFA3E6` | `0xFFFFA21A` | `0xFFFFA318` | `0xFFFFA15C` |

**Le chiffrement de la NAND.** `boot_device_setup_nand` lit l'identifiant de la puce (CID, `sdmmc_get_nand_cid`) et en garde le SHA-256 en DTCM (`0xFFF00608`) : c'est le compteur AES-CTR de la NAND, avec l'**emplacement `0x06`**, choisi juste avant la lecture des partitions. Les lectures « déchiffrées » passent par le moteur AES ; la lecture brute ne sert qu'au secteur 0 (l'en-tête NCSD n'est pas chiffré).

**Le chiffrement hors NAND.** Pour la flash SPI et la cartouche, l'en-tête du FIRM est lu en clair, mais chaque section est déchiffrée en AES-CBC avec l'**emplacement `0x3F`**, dont la clé normale est remplacée par une clé de la moitié protégée (`aes_setup_spi_firm_section`, `0xFFFFA050` ; `aes_setup_ntrcard_firm_section`, `0xFFFFA0A0`). Le vecteur d'initialisation est fait de la position de la section dans l'image, de son adresse de chargement et deux fois de sa taille (3dbrew, Bootloader ; les quatre mots se voient dans ces deux fonctions). Sur la flash SPI, le FIRM commence à l'octet `0x400`.

### 3.4 La NAND : l'en-tête NCSD et le choix de la partition

`nand_find_and_load_firm` (`0xFFFF8D50`, 432 octets) :

1. Les 8 états de partition (`0xFFF005E8`) valent -1.
2. Lecture brute du secteur 0 dans l'ITCM, à **`0x07FFB900`** (`0x200` octets).
3. `ncsd_header_verify_signature` (`0xFFFFA4C4`) : le mot « NCSD » doit être à `+0x100`, et la signature RSA de `+0x000` doit couvrir le SHA-256 de `+0x100`-`+0x1FF`, avec l'**emplacement RSA 3**. Échec : état -18 (`0xEE`), -17 si la lecture elle-même échoue.
4. Pour chacune des 8 partitions de l'en-tête : si son type de système de fichiers (`+0x110 + n`) vaut 3 et son type de chiffrement (`+0x118 + n`) vaut 2, c'est une partition FIRM. Son début est le décalage de `+0x120 + 8n`, multiplié par la taille d'unité (`0x200` décalé de l'octet `+0x18E`). L'emplacement AES `0x06` est choisi, et le premier secteur est lu **déchiffré** à **`0x07FFBB00`**. Le mot « FIRM » doit y être (sinon état -8, `0xF8`), et le mot `+0x04` de l'en-tête (la priorité) est noté.
5. Tant qu'il reste une partition candidate : celle de plus forte priorité (à égalité, la première) est relue à `0x07FFBB00`, sa signature vérifiée (3.5, **emplacement RSA 1**), ses sections chargées (3.6). En cas d'échec, la partition est écartée avec l'état -33 (`0xDF`, lecture), -34 (`0xDE`, signature) ou -49 (`0xCF`, sections), et la suivante est essayée. Les partitions écartées parce qu'une autre de priorité supérieure ou égale a été choisie reçoivent -9 (`0xF7`). Celles qui ne sont pas des FIRM restent à -1 (`0xFF`).
6. Au premier succès, l'adresse `0x07FFBB00` est rangée en `0xFFF000DC` (la case `+0x14` de la table du support).

Sur une console normale, les FIRM ont la priorité 0 : la partition `firm0` passe d'abord, `firm1` sert de secours.

`read_firm_header_and_load` (`0xFFFF95D8`) fait la même chose pour un support sans NCSD : lecture de l'en-tête à `0x07FFBB00` au décalage demandé (0 ; la flash SPI ajoute elle-même `0x400`), mot « FIRM », signature avec l'**emplacement RSA 2**, sections. Mêmes états -33, -8, -34, -49.

### 3.5 La vérification RSA de l'en-tête

`firm_header_verify_signature` (`0xFFFF8C8C`, 146 octets ; sa jumelle pour le NCSD est `0xFFFFA4C4`) :

1. Le mot « FIRM » doit être à `+0x000`.
2. `rsa_set_input` (`0xFFFFAB50`) charge la signature, les `0x100` octets de `+0x100`, dans le moteur RSA (`0x1000B800`), en ordre inverse des octets.
3. `rsa_start_with_keyslot` (`0xFFFFA900`) choisit l'emplacement (1, 2 ou 3) et lance le calcul (signature puissance exposant public, modulo le module de l'emplacement).
4. Pendant ce temps, `sha256_start_and_feed` (`0xFFFFAC60`) calcule le SHA-256 des `0x100` premiers octets de l'en-tête (de `+0x000` à `+0x0FF` : le mot magique, la priorité, les deux points d'entrée, les quatre descriptions de section avec leurs empreintes), et `sha_read_hash` (`0xFFFFACEC`) le relit.
5. `rsa_wait_done` puis `rsa_read_result` (`0xFFFFA818`) : les `0x100` octets du résultat.
6. `pkcs1_strip_padding` (`0xFFFFA7E0`) attend un octet 0, puis un type 1 ou 2. Pour le type 1, il saute les octets `0xFF` ; pour le type 2, tout octet non nul ; il s'arrête au premier 0. Il ne vérifie pas que le bourrage a une longueur minimale.
7. `pkcs1_find_digest` (`0xFFFFA784`) lit la structure ASN.1 qui suit : une séquence, une seconde séquence (l'identifiant d'algorithme) dont il saute le contenu sans le comparer à celui de SHA-256, puis l'élément suivant, dont il renvoie l'adresse. Les longueurs lues (`asn1_read_tag_and_length`, `0xFFFFA73C`) ne sont pas comparées à la taille du bloc.
8. Les 32 octets trouvés sont comparés à l'empreinte calculée.

Les points 6 et 7 sont souples : c'est cette souplesse que la faille publique « sighax » exploite pour fabriquer une signature acceptée sans la clé privée, et c'est elle qui permet à boot9strap d'être lancé par boot9 lui-même. Les clés publiques ne sont lues que dans la moitié protégée et ne sont recopiées nulle part.

### 3.6 Les sections : liste noire, copie, empreinte

`firm_load_sections` (`0xFFFFA408`), pour chacune des 4 descriptions de section (`+0x40 + 0x30 × n`) dont la taille (`+0x08`) n'est pas nulle :

1. **Liste noire.** L'adresse de chargement (`+0x04`) et l'adresse de fin (chargement plus taille) sont comparées à 7 plages rangées au début des données de la moitié protégée (`0xFFFFB088`, `0x38` octets). Si l'une des deux tombe dans une plage, tout échoue. Seules les deux extrémités sont testées : une section qui couvre une plage entière sans commencer ni finir dedans n'est pas arrêtée.
2. `sha_dma_init` (`0xFFFFAD18`) prépare le moteur SHA à recevoir les données qui vont passer.
3. **Copie** selon la méthode (`+0x0C`) : 0 par NDMA, 1 par XDMA, 2 par le processeur, avec la fonction correspondante du support, depuis le début de l'image plus le décalage de la section (`+0x00`). Avec une autre valeur, rien n'est copié.
4. `sha_compare_hash` (`0xFFFFAC56`) compare l'empreinte (`+0x10`, 32 octets) à celle que le moteur SHA a calculée pendant la copie. Avec une méthode inconnue, c'est donc l'empreinte restée dans le moteur qui est comparée (3dbrew le signale aussi).

Une seule section fausse fait échouer tout le FIRM (état -49), sans retour en arrière sur les sections déjà copiées.

### 3.7 La fin de `main`, réussite ou échec

- **Réussite** (un support a rendu 0) : `firm_get_arm11_entry` (`0xFFFF8D40`) et `firm_get_arm9_entry` (`0xFFFF8D30`) lisent `+0x08` et `+0x0C` de l'en-tête retenu ; si l'un vaut 0, c'est un échec. Sinon `rsa_init_private_keyslots_and_itcm` (`0xFFFF8608`) remplace le contenu des 4 emplacements RSA par 4 paires module / exposant privé de la moitié protégée, recopie les 4 modules en ITCM à **`0x07FFBD00`** (`0x400` octets) et 4 blocs de `0x200` octets à **`0x07FFC100`** (`0x800` octets).
- **Échec** : l'ITCM est remise à zéro de `0x07FFB800` à `0x07FFF470` (`0x3C70` octets), ce qui efface l'OTP déchiffré.

Dans les deux cas, `main` appelle `firm_boot` (`0xFFFF1E20`), qui ne revient pas (sinon `panic`, `0xFFFF2214`).

### 3.8 Le saut vers le FIRM, des deux côtés

Tout ce qui suit est dans la **moitié publique** des deux mémoires (sauf `firm_boot_callback` de boot11).

| | boot9 | boot11 |
| --- | --- | --- |
| 1 | `firm_boot_send_arm11_entry` (`0xFFFF1710`) : envoie le point d'entrée ARM11 (un mot, 0 en cas d'échec) par la file PXI (`pxi_send_words`, `0xFFFF2274`), puis lève l'interruption de l'ARM11 (bit 29 de `PXI_SYNC9`) | `firm_boot_receive_arm11_entry` (`0x000120AE`) : active l'interruption `0x50` (PXI), dort jusqu'à elle, lit le mot dans la file PXI |
| 2 | un crochet facultatif en DTCM (`0xFFF00058`), appelé avec le point d'entrée ARM9 s'il n'est pas nul | `firm_boot_callback` (`0x000181F4`), rangé en `0x1FFE8028` (crochet du même genre) |
| 3 | | **point d'entrée reçu** : `copy_boot11_data_to_axi_wram` (`0x000182F4`) recopie des données de sa moitié protégée vers `0x1FFFA000` (`0x2470` octets, données du mode DS) et `0x1FFFD000` (8 modules RSA, `0x800` octets). **Point d'entrée nul** : allume les écrans et affiche l'écran d'erreur « BOOTROM », « ERRCODE » avec les mots de `0x1FFFE00C`-`0x1FFFE01F` (`error_screen_init`, `error_screen_printf`) |
| 4 | `firm_boot_finish` (`0xFFFF15D0`) : envoie 1, attend 1, attend 14 | `firm_boot_finish` (`0x00011FFC`) : envoie 1, attend 1, envoie 14, attend 14 |
| 5 | `copy_boot11_data_to_itcm` (`0xFFFF1618`) : `0x2470` octets de `0x1FFFA000` vers l'ITCM **`0x07FFD000`** ; `0x400` octets (4 modules : `0x1FFFD000` sur une console de vente, `0x1FFFD400` sur une console de développement) vers **`0x07FFC900`** ; puis `copy_keydata_to_itcm` (`0xFFFF8FD0`) : `0x80` octets de la moitié protégée vers **`0x07FFCD00`**. Envoie 14 | |
| 6 | `disable_caches_and_irqs` (`0xFFFF16D4`) : coupe et vide le cache de données, coupe et invalide le cache d'instructions, **met à zéro le contenu et les étiquettes des deux caches** par l'interface de test du CP15, coupe toutes les interruptions (`0x10001000` à 0), puis `cp15_set_firm_entry_state` : MPU coupé, caches coupés, TCM actives, vecteurs hauts | `clear_boot11_data_in_axi_wram` (`0x000121FC`) : remet à zéro `0x1FFFA000`-`0x1FFFCFFF` et `0x1FFFD000`-`0x1FFFDFFF`. `disable_caches_mmu_and_irqs` (`0x0001207C`) : coupe et vide les caches, désactive toutes les interruptions au distributeur (`0x17E01180`), coupe la MMU, invalide le prédicteur de branchement |
| 7 | second crochet facultatif (`0xFFF0005C`) | second crochet facultatif (`0x1FFE802C`) |
| 8 | `clear_dtcm_data` (`0xFFFF01B0`) : remet à zéro `0xFFF00000`-`0xFFF01ABF` (pointeurs vers les clés, copie de la clé `0x3F`, compteur de la NAND, état des pilotes) | `clear_data_section` (`0x00011510`) : remet à zéro `0x1FFE8000`-`0x1FFE8E5F` |
| 9 | `run_lock_stub_from_itcm` (`0xFFFF1748`) recopie `lock_protected_bootroms` (`0xFFFF0258`, `0x100` octets) à `0x07FFB700` et l'exécute : envoie 1, attend 1, met `CFG9_SYSPROT9` à 1 (la moitié protégée de boot9 disparaît), puis `CFG9_SYSPROT11` à 1 (celle de boot11 aussi) | `run_lock_stub_from_stack` (`0x000120E0`) recopie `wait_protected_bootrom_locked` (`0x000115B4`) sur sa pile et l'exécute : envoie 1, attend 1, puis relit `0x00018000` jusqu'à n'y trouver que des zéros |
| 10 | `jump_to_firm_arm9_entry` (`0xFFFF01D4`) : remet à zéro `0xFFF03000`-`0xFFF03FFF`, envoie 0, attend 0, charge **tous les registres** depuis cette zone nulle (r0 à r12 et sp valent 0), puis saute au point d'entrée ARM9. S'il est nul : `wfi` pour toujours | `jump_to_firm_arm11_entry` (`0x00011534`) : remet à zéro `0x1FFF0000`-`0x1FFF3FFF`, envoie 0, attend 0, même chargement de registres nuls, saut au point d'entrée ARM11, ou `wfi` pour toujours |

Le verrouillage (ligne 9) se fait depuis l'ITCM et depuis la pile, pas depuis la mémoire morte : le code qui écrit les verrous ne s'exécute donc pas dans une zone qui disparaît sous lui. boot11 ne verrouille rien lui-même : il attend que boot9 l'ait fait pour lui.

## Partie 4 : les tables et zones de travail

| Adresse | Qui | Contenu |
| --- | --- | --- |
| `0xFFF00000`-`0xFFF0022F` | boot9 | image initiale de la DTCM : pointeurs vers les blocs de clés, choisis selon `CFG9_UNITINFO` |
| `0xFFF00058`, `0xFFF0005C` | boot9 | les deux crochets facultatifs de `firm_boot` (nuls dans l'image initiale, jamais écrits) |
| `0xFFF000C8`-`0xFFF000DF` | boot9 | la table du support : 5 fonctions et l'adresse de l'en-tête retenu |
| `0xFFF001B4` | boot9 | table des gestionnaires d'interruptions, 30 cases |
| `0xFFF005E8` | boot9 | les 8 états des partitions NCSD |
| `0xFFF00608` | boot9 | compteur AES de la NAND (SHA-256 du CID) |
| `0xFFF00618` | boot9 | copie de la clé normale de l'emplacement `0x3F` |
| `0xFFFFB088` (`0x38` octets) | boot9, moitié protégée | les 7 plages interdites aux sections |
| `0x1FFE8000`-`0x1FFE8E5F` | boot11 | données et variables ; `0x1FFE8028` et `0x1FFE802C` sont les deux crochets |
| `0x1FFF4000`-`0x1FFF9FFF` | boot11 | tables de pages |
| `0x1FFFA000`-`0x1FFFDFFF` | boot11 → boot9 | boîte aux lettres des données de boot11 (remise à zéro avant le saut) |
| `0x1FFFE000`-`0x1FFFE01F` | les deux | zone d'échange : compteurs de performance de boot11 (`+0x00`-`+0x0B`), états des supports (`+0x0C` NAND, `+0x0D` cartouche, `+0x0E` flash SPI), couvercle (`+0x0F`), états des 8 partitions (`+0x10`-`+0x17`), erreurs du pilote SD (`+0x18`, `+0x1C`) |

**Les codes d'état** (octets signés) : 0 succès ; -1 (`0xFF`) partition qui n'est pas un FIRM ; -2 (`0xFE`) support absent ou en panne ; -3 (`0xFD`) contrôleur SD impossible à préparer ; -4 (`0xFC`) support sans fonction de lecture ; -8 (`0xF8`) pas de mot « FIRM » ; -9 (`0xF7`) écartée pour une priorité plus forte ; -17 (`0xEF`) lecture du NCSD impossible ; -18 (`0xEE`) NCSD invalide ; -33 (`0xDF`) lecture de l'en-tête impossible ; -34 (`0xDE`) en-tête invalide ou signature refusée ; -49 (`0xCF`) section refusée. Tous lus dans le code ; tous sauf -4 figurent dans la table de 3dbrew, avec le même sens.

## Partie 5 : ce que le FIRM trouve en arrivant

C'est la partie qui compte pour le projet : l'état exact que kernel11 et le noyau ARM9 (puis Process9) supposent.

### Sur l'ARM9 (point d'entrée du NATIVE_FIRM de cette console : `0x0801B01C`)

| | État |
| --- | --- |
| Registres | r0 à r12 et sp à 0, lr = point d'entrée, mode système, IRQ et FIQ masquées, jeu ARM |
| CP15 | MPU coupé, caches coupés **et vidés jusqu'à leurs étiquettes**, DTCM à `0xFFF00000` et ITCM à `0x00000000` actives, vecteurs hauts (`0xFFFF0000` → table à `0x08000000`) |
| Interruptions | toutes coupées (`0x10001000` à 0) ; la case IRQ de la table de `0x08000000` pointe encore sur `irq_dispatch` de boot9 (`0xFFFF0C78`, moitié publique), les autres sur des boucles ou sur `svc_handler` |
| Mémoire morte | moitié publique toujours lisible (les vecteurs y passent), moitié protégée invisible jusqu'au prochain redémarrage à froid |
| OTP | toujours lisible à `0x10012000` (c'est le FIRM qui le verrouillera, `CFG9_SYSPROT9` bit 1) |
| Moteur AES | emplacements `0x04`-`0x3F` remplis (3.2) ; après un démarrage sur NAND, emplacement `0x06` sélectionné. Après un démarrage hors NAND, `0x3F` garde la clé de déchiffrement des sections |
| Moteur RSA | les 4 emplacements contiennent les paires module / exposant privé de la moitié protégée (3.7) |
| Moteur SHA | contient encore l'empreinte de la dernière section |
| Sections du FIRM | copiées à leurs adresses : ici `0x1FF00000` (`0x35800` octets, par XDMA), `0x1FF80000` (`0x34000`, XDMA), `0x08006000` (`0x8A400`, NDMA) |
| DTCM | remise à zéro de `0xFFF00000` à `0xFFF01ABF` et de `0xFFF03000` à `0xFFF03FFF` ; le reste avait été mis à zéro au démarrage et n'a servi que de fond de pile |

**L'ITCM, ce que boot9 laisse à Process9** (adresses de la copie `0x07FF8000` ; la même mémoire se lit aussi à `0x01FF8000`) :

| Adresse | Taille | Contenu |
| --- | --- | --- |
| `0x07FFB700` | `0x100` | la petite routine de verrouillage (n'est plus utile) |
| `0x07FFB800` | `0x90` | **l'OTP déchiffré**, propre à la console (puis `0x70` octets à zéro) |
| `0x07FFB900` | `0x200` | l'en-tête NCSD de la NAND (démarrage NAND seulement) |
| `0x07FFBB00` | `0x200` | l'en-tête du FIRM lancé |
| `0x07FFBD00` | `0x400` | les 4 modules RSA chargés dans le moteur |
| `0x07FFC100` | `0x800` | 4 paires module / exposant privé, que boot9 lui-même n'utilise pas |
| `0x07FFC900` | `0x400` | 4 modules RSA venus de boot11 |
| `0x07FFCD00` | `0x80` | un bloc de clés de la moitié protégée de boot9 |
| `0x07FFCD80` | `0x64` puis deux mots | l'état du pilote NAND (identifiants de la puce et réglages), recopié par `save_nand_state_to_itcm` (`0xFFFF40EC`) |
| `0x07FFD000` | `0x2470` | données du mode DS venues de boot11 (dont les tables Blowfish des cartouches, d'après 3dbrew) |

En cas d'échec, toute la zone `0x07FFB800`-`0x07FFF46F` est à zéro, mais il n'y a alors pas de FIRM pour la lire.

### Sur l'ARM11 (point d'entrée : `0x1FFAF064`)

| | État |
| --- | --- |
| Cœur 0 | r0 à r12 et sp à 0, lr = point d'entrée, mode système, IRQ et FIQ masquées, jeu ARM, MMU coupée, caches coupés |
| Cœur 1 | dort dans `reset_handler`, en attente d'une interruption logicielle, puis saute à l'adresse rangée en `0x1FFFFFDC` (à 0 tant que kernel11 ne l'a pas écrite) |
| Cœurs 2 et 3 (New 3DS) | dorment pour toujours dans `reset_handler` |
| Contrôleur d'interruptions | distributeur et interface processeur activés, toutes les sources désactivées |
| SCU | activé (`0x17E00000` bit 0), jamais coupé |
| Vecteurs | vecteurs bas (le bit V du registre de contrôle n'est jamais mis par boot11), donc `0x00000000` → table à `0x1FFFFFA0` ; la case IRQ pointe encore sur le gestionnaire de boot11 (`0x00011D90`, moitié publique, toujours lisible), SVC et instruction indéfinie sur ceux de boot11, les autres sur des boucles |
| AXI WRAM | `0x1FFFE000`-`0x1FFFE01F` : la zone d'échange, conservée ; `0x1FFF4000`-`0x1FFF9FFF` : les anciennes tables de pages, non effacées ; `0x1FFE8000`-`0x1FFE8E5F`, `0x1FFF0000`-`0x1FFF3FFF` et `0x1FFFA000`-`0x1FFFDFFF` : à zéro |
| Écrans | pas initialisés par boot11 sur un démarrage réussi : seul le chemin d'erreur appelle l'initialisation des écrans (`error_screen_init`, `lcd_framebuffers_init`) |

### Pour le projet

- **Rien à simuler pour Pokémon X sur PC** dans le chemin normal : le jeu ne voit jamais boot9 ni boot11. Le chargement, les signatures et les empreintes ne protègent que l'intégrité du FIRM.
- **Si l'on fait tourner kernel11 et Process9 dans un émulateur** sans boot9, il faut fabriquer l'état ci-dessus : registres nuls, MMU et MPU coupés, sections du FIRM à leurs adresses, et surtout l'ITCM remplie (l'OTP à `0x01FFB800`, les modules RSA, les données du mode DS) et le moteur AES déjà chargé. Ces données-là viennent des moitiés protégées et de l'OTP de la console : elles ne peuvent pas être inventées, il faudra les prendre dans les dumps locaux au moment du lancement, sans jamais les ranger dans le dépôt.
- **Le cœur 1** n'a besoin que d'une adresse en `0x1FFFFFDC` et d'une interruption logicielle : c'est le contrat entre kernel11 et boot11, à recouper dans la fiche de kernel11.

## Partie 6 : liens avec les autres binaires

**Aucune table d'exports.** Ni boot9 ni boot11 n'ont de table de fonctions destinée à d'autres programmes. Une recherche de mots entre `0xFFFF0000` et `0xFFFF7FFF` dans les trois sections du NATIVE_FIRM (`local/extrait/firm/`) ne trouve aucun pointeur vers une fonction de boot9 : dans la section ARM9, seulement des constantes `0xFFFF0000` (dans le noyau ARM9, à `0x08018F60`, `0x0801B0FC`-`0x0801B10C` et `0x0801B3A8`, sans doute des régions du MPU) et `0xFFFF0010` (dans les données de Process9, à `0x0802D714`) ; les mêmes motifs lus par le pseudo-code de Process9 sont des masques ; dans les sections ARM11, quelques mots `0xFFFFxxxx` qui ne peuvent pas viser boot9 (invisible de l'ARM11) et qui n'ont pas été lus ici. Aucune recherche de pointeurs vers boot11 (`0x0001xxxx`, trop fréquents comme petits nombres) n'a été faite.

Ce qui relie vraiment le FIRM aux mémoires de démarrage, ce sont :

- les **vecteurs d'exception**, qui passent toujours par la moitié publique (`0xFFFF0000` → `0x08000000` sur l'ARM9, `0x00000000` → `0x1FFFFFA0` sur l'ARM11 tant que le FIRM garde les vecteurs bas) : le FIRM n'a qu'à remplir les tables en mémoire vive ;
- les **données laissées** en ITCM, en AXI WRAM et dans les moteurs AES et RSA (partie 5) ;
- le **contrat du cœur 1** (`0x1FFFFFDC`).

## Le NATIVE_FIRM de cette console, vu par boot9

Lu dans `local/dump/systeme/native.firm` : mot « FIRM », points d'entrée ARM11 `0x1FFAF064` et ARM9 `0x0801B01C`, trois sections (`0x1FF00000`, `0x1FF80000`, `0x08006000`) dont les trois empreintes SHA-256 correspondent bien au contenu du fichier. En revanche, le mot de priorité `+0x04` vaut `0x00434544` (les lettres « DEC ») et la section ARM9 est en clair : ce fichier a été déchiffré et marqué par l'outil qui l'a dumpé. Ce n'est donc pas l'image exacte de la partition `firm0` ; sa signature RSA ne peut plus être acceptée par boot9. Ça ne change rien pour l'analyse des sections.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Le chemin du reset jusqu'au saut, dans les deux mémoires : lu dans l'assembleur et dans le pseudo-code de Ghidra, et conforme à la description publique de 3dbrew (page Bootloader) pour toutes les adresses que celle-ci donne (`0xFFFF56C8`, `0xFFFF5774`, `0xFFFF8228`, `0x00012220`, `0x00012454`, `0x00013944`, `0x000181F4`, etc.).
- Les numéros d'emplacements RSA (3 pour le NCSD, 1 pour les FIRM de la NAND, 2 pour les autres) : lus aux appels, et conformes à 3dbrew.
- L'emplacement AES `0x06` pour la NAND et `0x3F` pour l'OTP et les FIRM hors NAND : lus aux appels, conformes à 3dbrew.
- Les codes d'état et l'adresse de chacun dans `0x1FFFE000` : lus dans le code, conformes à la table de 3dbrew.
- Les adresses ITCM `0x07FFB800`, `0x07FFBD00`, `0x07FFC100`, `0x07FFC900`, `0x07FFCD00`, `0x07FFD000` et la taille `0x3C70` : lues dans le code, conformes à 3dbrew.
- La forme de l'en-tête FIRM utilisée par `firm_load_sections` : vérifiée sur le `native.firm` dumpé, dont les trois empreintes se recalculent à l'identique.
- La poignée de main PXI des deux côtés (9 / 11, puis 1, 14, 1, 0) : lue dans les deux mémoires, qui se répondent octet pour octet.

**Interprété à la lecture du code, à relire dans Ghidra**
- Le rôle de `CFG9_RST11` (laisser partir l'ARM11) vient de 3dbrew ; le code montre seulement l'écriture.
- Le découpage des emplacements AES par tour (3.2) est lu dans le pseudo-code d'une fonction de 1 342 octets ; le nombre exact d'octets de l'OTP par tour et le rôle du chiffrement de chaque tour sont à relire dans l'assembleur. Le caractère « propre à la console » des clés X des quatre premiers tours se déduit de leur source (l'OTP).
- La remarque sur les clés écrites quatre fois (`0x10`, `0x24`, `0x38`) et sur `0x28` et `0x3C` : lue dans le pseudo-code, pas encore dans l'assembleur.
- Le sens des sections hors NAND et le vecteur d'initialisation : la forme vient de 3dbrew, les fonctions qui le posent sont repérées mais pas lues en détail.
- Les rôles des fonctions du pilote SD : les numéros de commande (`sd_cmd18_read_multiple` et les autres) sont tirés des valeurs passées au contrôleur, sans relecture du pilote entier.
- Le contenu exact des `0x64` octets recopiés à `0x07FFCD80` (identifiants et réglages de la puce NAND) : déduit de la structure du pilote.
- `copy_ntrcard_table_to_axi_wram` : le bloc de `0x1000` octets est lu par une fonction de la cartouche DS de boot9 (`ntrcard_derive_from_boot11_table`, `0xFFFF98E8`) ; son rôle exact n'est pas lu.
- Les deux crochets facultatifs de chaque côté (`0xFFF00058`, `0xFFF0005C`, `0x1FFE8028`, `0x1FFE802C`) : tous les quatre valent 0 dans les images initiales de la DTCM (`0xFFFFE060`) et des données de boot11 (`0x0001D078`) — testé par un script qui ne lit que ces quatre mots et n'affiche que « nul » ou « non nul » — et seul `0x1FFE8028` est écrit par le code. Les trois autres sont donc toujours nuls ; à quoi ils étaient destinés n'est pas connu.
- `svc_handler` (boot9 `0xFFFF00DC`, boot11 `0x000110A8`) et `undefined_instruction_handler` (boot11 `0x0001114C`) : leur place dans la table des vecteurs est sûre, leur nom vient de ce qu'ils font (numéro de SVC lu sous lr, instruction de coprocesseur décodée) ; aucun appel SVC n'a été cherché dans le reste du code.
- `read_socinfo_bit0` (`0x000121EC`) lit `0x10140FFC` ; les deux sorties GPIO de l'initialisation n'en dépendent. Le sens de ce bit n'est pas vérifié.
- Les deux constantes `0xFFFF0000` du noyau ARM9 vues comme des régions du MPU : non relues dans la fiche du noyau ARM9.

**Pas lu**
- Le détail des moteurs DMA (NDMA, XDMA et son microcode, `xdma_build_program`), du pilote de la cartouche DS et de la flash SPI, et la plus grande partie du pilote SD. En tout, 314 fonctions de boot9 et 120 de boot11 restent sans nom.
- L'initialisation des écrans et l'écran d'erreur de boot11 (environ 40 fonctions), et le pilote I2C du microcontrôleur au-delà de la lecture du couvercle.
- Les 30 fonctions que la recherche automatique a créées dans des trous collés à la fin d'une autre (signalées « à relire » dans le journal de Ghidra).
- Une table de `switch` dans boot9 (`0xFFFF1098`) : son aide (`switch8_helper`, `0xFFFF0CDC`) est une variante que `ghidra_direct.py` ne connaît pas, et la table qui suit l'appel est désassemblée comme du code.
- Ce que kernel11, le noyau ARM9 et Process9 font exactement des données laissées en ITCM : c'est aux fiches de ces trois binaires de le dire.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les vecteurs, mesurer l'entropie par blocs de `0x400` octets pour séparer code et données, sans afficher un octet de la moitié protégée | `local/analyse/boot/survey.py` | immédiat |
| Trouver l'adresse d'exécution de boot11 | décompte des pointeurs du code : ils visent `0x0001xxxx`, pas `0x0000xxxx` | immédiat |
| Importer chaque image brute à son adresse, rendre les données non exécutables, semer les points d'entrée, analyser, reprendre les fonctions manquées, poser les noms, sortir pseudo-code, assembleur et références | `outils/ghidra_raw.py boot9|boot11` (au départ `local/analyse/boot/boot_ghidra.py`), Ghidra 12.1.4 sans interface sous WSL (`GHIDRA_HEADLESS_MAXMEM=3G`) | une à deux minutes par image |
| Parcourir l'arbre des appels, le profil de chaque fonction (registres matériels touchés, appelants, appelés), lire une plage d'adresses | `tree.py`, `profile.py`, `show.py` dans le même dossier | immédiat |
| Lire, nommer, recouper avec 3dbrew (pages Bootloader, FIRM, CONFIG9 Registers, via `web.archive.org`) | Claude | le gros du temps |
| Écrire les fichiers de noms, avec le jeu d'instructions repris de l'analyse | `build_names.py` | immédiat |
| Vérifier le `native.firm` dumpé (points d'entrée, empreintes des sections) | un script Python | immédiat |

**La méthode, pour la refaire.**
1. `python local/analyse/boot/survey.py` : vecteurs et carte de l'entropie.
2. `python outils/ghidra_raw.py boot9` puis `boot11`. L'outil prend les bornes du code dans `outils/raw_targets.toml` (cibles `boot9` et `boot11`, avec l'adresse de chargement, le langage et les deux entrées données à la main, chacune avec sa raison), passe tout le reste de l'image à `MarkDataBlocks.java` (qui le découpe en blocs non exécutables), sème les cibles des vecteurs et les pointeurs impairs vers un `push` Thumb lus dans le code seulement, puis enchaîne les scripts de `outils/ghidra_scripts/` : `SeedFunctions.java`, `RecoverFunctions.java`, `ApplyNames.java` (avec `fiches/boot9.noms.tsv` ou `boot11.noms.tsv`), `DumpFunctions.java` et `DumpListing.java`, qui écrit l'assembleur. Tout sort dans `local/analyse/boot9/gh/` ou `local/analyse/boot11/gh/`. Relancé ainsi le 2026-10-14 : 564 fonctions pour boot9 et 227 pour boot11, avec les mêmes 258 et 109 noms et aucun nom sans fonction. L'écart avec la première analyse (572 et 229) vient de l'aide de switch, une variante (`0xFFFF0CDC`, `0x0001841C`) que l'outil reconnaît maintenant : ses tables sont imposées, et les cas qui passaient pour des fonctions à part (huit de `0xFFFF10B4` à `0xFFFF10D6`, puis `0x000184E4` et `0x000188FC`, aucune nommée) rentrent dans leur fonction.
3. Lire avec `tree.py <image> <adresse>`, `profile.py <image>`, `show.py <image> <début> <fin>` ou `show.py <image> pseudo <adresse>`, restés dans `local/analyse/boot/` : ils lisent la première analyse, `local/analyse/boot/<image>/gh/`.

**Les pièges rencontrés.**
- **Les données de la moitié protégée doivent être retirées avant l'analyse**, pas après : sinon la recherche des fonctions « dans les trous » de `RecoverFunctions.java` les prend pour du code, et `DumpListing.java` irait y lire des valeurs. `MarkDataBlocks.java` les met dans des blocs non exécutables dès l'import, et `DumpListing.java` ne lit une valeur que si elle est dans un bloc exécutable. Les pointeurs ne sont cherchés que dans les plages de code (`pointer_sources = "code"`).
- **boot11 s'exécute à `0x00010000`**, pas à `0x00000000` : chargé à 0, aucun pointeur du code ne tombe juste.
- **Le premier mot du code protégé de boot11** (`0x00018004`) est aussi lu comme une donnée par le reset (le test « moitié protégée lisible »). Ghidra en fait une donnée et ne désassemble jamais la suite : il faut le semer comme code avant l'analyse.
- **Le retour de `main` dans boot9** est une instruction ARM (`0xFFFF8068`), mais Ghidra la décode en Thumb après le saut en Thumb, invente un appel et coupe en deux `init_aes_keyslots_impl`. Elle est semée en ARM.
- **Les points-virgules dans la ligne de commande de WSL** : `wsl.exe -- …` passe la ligne à un shell, et le `;` qui sépare deux dossiers dans `-scriptPath` coupe la commande en deux (Ghidra importe, puis aucun script ne tourne). Il faut l'entourer d'apostrophes ; `run_headless` (dans `outils/ghidra_direct.py`) protège chaque argument.
- **Le pseudo-code ne montre pas les arguments passés en registres** autour de certains appels (les copies de clés, les numéros d'emplacement passés par la pile) : la liste des emplacements AES a été lue dans le pseudo-code, celle des emplacements RSA dans l'assembleur.

**Pour reprendre.** `boot9.noms.tsv` et `boot11.noms.tsv` sont les fichiers de graines : une adresse, `function` (ARM) ou `label` (Thumb), un nom. Les adresses de boot11 sont celles de la copie à `0x00010000`. Le pseudo-code et l'assembleur sont dans `local/analyse/boot9/gh/` et `local/analyse/boot11/gh/`, les scripts de lecture dans `local/analyse/boot/`, non versionnés.
