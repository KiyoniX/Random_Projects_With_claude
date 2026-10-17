# codec, le son et l'écran tactile

`codec` pilote la puce qui fait à la fois le convertisseur audio et le contrôleur d'écran tactile de la console. Cette puce est branchée sur le bus SPI (appareil 3, service `SPI::CD2` de [spi](spi.md)) et se règle par des registres rangés en **banques** : on choisit une banque en écrivant son numéro dans le registre 0, puis on lit ou écrit un indice. Le module offre six services, un par famille de client : le tactile et le pad circulaire (`cdc:HID`, utilisé par [hid](hid.md)), le micro (`cdc:MIC`, utilisé par [mic](mic.md)), la sortie du son simple (`cdc:CSN`, pour [csnd](csnd.md)), le DSP (`cdc:DSP`, pour [dsp](dsp.md)), le mode ancien DS et GBA (`cdc:LGY`) et un service de contrôle (`cdc:CHK`). Il surveille aussi la prise casque et remet l'état dans la page partagée.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), six aiguillages rejoués par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`. Aucune valeur de calibration n'est recopiée.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001802`, version 7.0.0 (`v7168`), un titre de la CTRNAND (lu dans l'exheader ; nom `codec`) ; la NAND porte aussi `codec-safe` (`v7169`, mode sans échec, non lu) |
| Fichier lu | `local/extrait/codec/exefs/code.bin` et `exheader.bin` |
| Taille | 29 228 octets de code (`0x722c`), 1 028 de données en lecture seule (`0x404`), 360 de données (`0x168`), 8 968 de mémoire à zéro (`0x2308`) ; pile de 4 096 octets ; priorité de départ 9 |
| Fonctions | 235, dont 147 nommées dans `codec.noms.tsv` (8 en Thumb, 227 en ARM) |
| Services offerts | six, une session au plus chacun : `cdc:HID`, `cdc:MIC`, `cdc:CSN`, `cdc:DSP`, `cdc:LGY`, `cdc:CHK` (partie 2) |
| Services appelés | `pdn:i`, `SPI::CD2` (appareil 3 ; le code sait aussi ouvrir `SPI::NOR`, `SPI::CS2`, `SPI::CS3` et `SPI::DEF` selon l'appareil), `gpio:CDC`, `mcu::CDC`, `cfg:s`, `ptm` ; plus `srv:` et le port `err:f`. L'exheader en déclare neuf : `pdn:i`, `SPI::CD2`, `gpio:CDC`, `mcu::CDC`, `cfg:s`, `ptm:s`, `ptm:sysm`, `ptm:gets`, `ptm:u`, `ptm:play` (les chaînes `ptm:*` sont dans la section en lecture seule) |
| Autres accès | trois pages d'E/S dans l'exheader : `0x1EC41000` (descripteur `0xFFE1EC41`), `0x1EC45000` (`0xFFE1EC45`) et `0x1EC03000` (`0xFFE1EC03`). Aucune interruption déclarée ; le masque d'appels système ne contient pas `BindInterrupt` |
| Dépendances déclarées | aucune |
| Fils | le fil principal, **un fil par session ouverte** (priorité 20, ou 15 sur le processeur 3 pour `cdc:HID` sur une New 3DS ; pile de `0x400` octets), le fil de surveillance de la prise casque (priorité 21) |

## Partie 1 : le démarrage

`entry` (`0x100000`) enchaîne `clear_bss`, les constructeurs et `run_init_array`, puis appelle `codec_main` (`0x100194`, 1 332 octets). Les constructeurs (`0x106c10` et suivants) construisent les cinq objets de notification et leur table de gestionnaires.

`codec_main` :

1. se déclare à `sm` (`srv_init`, `SRV_RegisterClient`) ;
2. enregistre six services (`SRV_RegisterService`, `0x100aa4`), dans l'ordre de la table de `0x109038`, **1 session chacun** ;
3. enregistre cinq gestionnaires de notifications (`register_notification_handler`) : `0x100` (arrêt, `on_terminate_notification`, `0x10492c`) et `0x104`, `0x105`, `0x214`, `0x213` (un seul gestionnaire pour les quatre : `codec_on_notification`, `0x1069d4`) ;
4. appelle `codec_initialize` (`0x100b54`), partie 4 ;
5. s'abonne à `0x104`, `0x105`, `0x213` et `0x214` (`SRV_Subscribe`, `0x103c1c`) : la veille et le réveil de la console, et l'ouverture et la fermeture du couvercle ;
6. lit si la console est une New 3DS (`is_new_3ds`, `0x10089c`, par `PTMSYSM_CheckNew3DS`) et garde l'octet à `0x109030` ;
7. boucle sur `WaitSynchronizationN` de sept poignées (six ports, puis le sémaphore des notifications) : indice 6, `handle_srv_notification` ; indices 0 à 5, `svcAcceptSession` puis un fil de session ; si la session est celle de `cdc:HID` (indice 0) et que la console est une New 3DS, le fil a la priorité 15 et le processeur 3, sinon la priorité 20 et le processeur par défaut ;
8. à la notification `0x100` : `codec_finalize` (`0x100d74`), retrait des six services, `srv_exit`.

## Partie 2 : les services et les fils de session

Même forme que [spi](spi.md) et [mcu](mcu.md) : chaque service a son fil de session (`cdc*_session_thread`), sa boucle (`cdc*_session_loop`, `svcReplyAndReceive`) et son aiguillage.

| N° | Service | Fil | Boucle | Aiguillage | Commandes | Client |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `cdc:HID` | `0x1070cc` | `0x1049fc` | `0x1050c4` | 3 | [hid](hid.md) |
| 1 | `cdc:MIC` | `0x10717c` | `0x104b54` | `0x1052f0` | 5 | [mic](mic.md) |
| 2 | `cdc:CSN` | `0x1071d4` | `0x104c00` | `0x1054cc` | 9 | [csnd](csnd.md) |
| 3 | `cdc:DSP` | `0x107074` | `0x10493c` | `0x104d6c` | 8 | [dsp](dsp.md) |
| 4 | `cdc:LGY` | `0x107124` | `0x104aa8` | `0x1051f0` | 3 | (non lu : le module de la console en mode DS ou GBA) |
| 5 | `cdc:CHK` | `0x10701c` | `0x104cac` | `0x105784` | 7 | (non lu) |

Les 35 commandes sont dans la partie 3. Chaque aiguillage prend un verrou (`0x109168`, `lock_enter` à `0x1038d4`) avant la fonction de travail et le rend après (`0x1038b4`). Tous lisent aussi l'octet « en veille » (`0x109000`) : en veille, les fonctions de travail ne touchent pas à la puce.

## Partie 3 : les commandes

Un numéro inconnu rend `0x00000040` et `0xD900182F`. Pour la plupart, seul le numéro compte ; l'aiguillage compare l'en-tête **entier** pour DSP 1, 2, 3, 5 et CHK 3, 4 (ceux qui prennent un tampon). Les noms de 3dbrew (« Codec Services ») n'existent que pour `cdc:HID`, `cdc:MIC` et `cdc:LGY` ; ceux de DSP viennent de [dsp](dsp.md). Les banques et les indices sont lus dans le pseudo-code (un script lit les constantes passées aux fonctions d'accès, `local/analyse/codec/regs.py`).

Notation : « banque B, indice I » désigne le registre I de la banque B de la puce, appareil 3. `maj` veut dire « remplace les bits du masque ».

### cdc:HID : le tactile et le pad circulaire

| N° | Commande | Fonction | Adresse | Réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- |
| 1 | GetData | `cdchid_GetData` | `0x105bf0` | `0x000100C0` | banque `0x67`, lit l'indice `0x26` : si son bit 1 est levé, ne rend rien (0) ; sinon banque `0xFB`, lit **`0x34` octets** à partir de l'indice 1, remet les mots 16 bits dans l'ordre (cinq coordonnées X et cinq Y de 12 bits, la valeur `0xFFF` voulant dire « pas de contact »), en déduit un état (touché ou non, valeurs valides) rangé dans le mot de sortie, et rend deux mots (interprété) |
| 2 | Initialize | `cdchid_Initialize` | `0x105b84` | `0x00020040` | banque `0x67` : indice `0x26` bit 7 à 1, indice `0x24` bit 7 à 0, indice `0x25` : masque `0x3C`, valeur `0x10` |
| 3 | Finalize | `cdchid_Finalize` | `0x106298` | `0x00030040` | banque `0x67` : indice `0x26` bit 7 à 0 et un second réglage (non lu) |

C'est la séquence que décrit 3dbrew pour le tactile (initialisation `0x26` bit 7, `0x24` bit 7, `0x25` à `0x10` ; lecture de l'indice `0x26` puis de `0x34` octets de coordonnées). Le tactile est l'appareil SPI 3, donc la page `0x10142000` ([spi](spi.md)). 3dbrew donne pour ces trois commandes les en-têtes `0x00010042`, `0x00020042` et `0x00030000` ; le code répond `0x000100C0`, `0x00020040` et `0x00030040` (et la fiche de [hid](hid.md) envoie `0x00010000` et `0x00020000`).

### cdc:MIC : le micro

| N° | Commande | Fonction | Adresse | Réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- |
| 1 | SetGain | `cdcmic_SetGain` | `0x102db8` | `0x00010040` | banque 1, indice `0x2F` reçoit les sept bits du bas du paramètre |
| 2 | GetGain | `cdcmic_GetGain` | `0x1066a4` | `0x00020080` | banque 1, lit l'indice `0x2F`, sept bits |
| 3 | SetPower | `cdcmic_SetPower` | `0x1025ec` | `0x00030040` | allumer : banque 0 indice `0x51` bit 7 à 1, puis attente (au plus 100 fois 1 ms) que le bit 6 de l'indice `0x24` se lève ; banque 1 indice `0x2E` reçoit une valeur ; banque 0 indice `0x52` bit 7 à 0. Éteindre : indice `0x52` bit 7 à 1, indice `0x51` bit 7 à 0, banque 1 indice `0x2E` à 0 |
| 4 | GetPower | `cdcmic_GetPower` | `0x105aec` | `0x00040080` | banque 1, lit l'indice `0x2E` ; non nul = allumé |
| 5 | SetIirFilterMic | `cdcmic_SetIirFilterMic` | `0x106358` | `0x00050042` | filtre de 50 octets en tampon : banque 4 indice `0x0E` (`0x32` octets), plus les bits d'activation des indices `0x51` et `0x52` de la banque 0 |

Ce sont les cinq commandes que [mic](mic.md) envoie sous les noms `CDCMIC_*` : mêmes en-têtes (`0x00010040`, `0x00020000`, `0x00030040`, `0x00040000`, `0x00050042`), mêmes arguments. 3dbrew donne `0x00020080` et `0x00040080` aux réponses de Get, ce que le code rend.

### cdc:CSN : la sortie du son simple

3dbrew n'a pas de noms pour ces neuf commandes. Les noms du module sont neutres ; les registres sont ceux du code.

| N° | Fonction | Adresse | Réponse | Ce que fait le code |
| --- | --- | --- | --- | --- |
| 1 | `cdccsn_cmd0001` | `0x1065c0` | `0x00010040` | banque 0, indice `0x39` : bits `0x66` à 0 ; banque `0x64`, indice `0x31` : bit 5 à 1 |
| 2 | `cdccsn_cmd0002` | `0x106218` | `0x00020040` | l'inverse : banque `0x64`, indice `0x31` bit 5 à 0 ; banque 0, indice `0x39` bits `0x66` à 1 |
| 3 | `cdccsn_cmd0003` | `0x1025a0` | `0x00030040` | banque `0x64` : écrit le second paramètre dans l'indice `0x7A` (premier paramètre 0) ou `0x78` (premier paramètre non nul) : un réglage par voie, probablement le volume (interprété) |
| 4 | `cdccsn_cmd0004` | `0x105b1c` | `0x00040080` | banque `0x64` : relit l'indice `0x7A` (paramètre 0) ou `0x78` (paramètre 1) ; rend 0 pour tout autre paramètre |
| 5 | `cdccsn_cmd0005` | `0x106264` | `0x00050040` | banque 0, indice `0x39` : bits `0x66` mis ou remis selon le paramètre |
| 6 | `cdccsn_cmd0006` | `0x106564` | `0x00060080` | banque 0, indice `0x39` : vrai si les bits `0x66` sont à 0 |
| 7 | `cdccsn_cmd0007` | `0x10660c` | `0x00070040` | banque `0x64`, indice `0x31`, bit 5 mis ou remis |
| 8 | `cdccsn_cmd0008` | `0x10666c` | `0x00080080` | banque `0x64`, indice `0x31`, bit 5 : vrai s'il est à 1 |
| 9 | (dans l'aiguillage) | | `0x00090042` | rend la poignée de l'événement `0x109028` (levé au réveil, voir la partie 5) |

La commande 3 est aussi la commande 7 de `cdc:CHK` (même fonction).

### cdc:DSP : le DSP

| N° | Commande | Fonction | Adresse | Réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- |
| 1 | SetIirFilterI2S1 | `cdcdsp_SetIirFilterI2S1` | `0x102bd0` | `0x00010042` | tampon en lecture : règle une série de registres des banques `0x64`, 8 et 9 (coefficients du filtre) |
| 2 | SetIirFilterI2S2 | `cdcdsp_SetIirFilterI2S2` | `0x102a64` | `0x00020042` | idem, banques `0x64` et 10 |
| 3 | SetIirFilterEQ | `cdcdsp_SetIirFilterEQ` | `0x106150` | `0x00030042` | tampon en lecture : banques `0x64`, 11 et 12 (égaliseur) |
| 4 | ReadMultiEx_SPI2 | dans l'aiguillage | | `0x00040042` | choisit une banque puis lit des registres (`codec_select_bank`, `codec_read_regs`) |
| 5 | WriteMultiEx_SPI2 | dans l'aiguillage | | `0x00050040` | choisit une banque puis écrit des registres (`codec_write_regs`) |
| 6 | GetHeadphoneStatus | `cdcdsp_GetHeadphoneStatus` | `0x1037e8` | `0x00060080` | rend l'octet « casque branché » (`0x109071`) |
| 7 | (volume I2S1) | `cdcdsp_SetI2S1Volume` | `0x10612c` | `0x00070040` | si le paramètre est au plus `0x20`, le range dans les six bits du bas de `I2S1_CNT` (`0x1EC45000`) |
| 8 | ForceHeadphoneOut | dans l'aiguillage | | `0x00080040` | (non lu en détail) |

Les noms viennent de [dsp](dsp.md), qui relaie ses commandes 26 à 32 vers celles-ci. 3dbrew donne « DSP volume » pour les bits 0 à 5 de `I2S1_CNT`, ce qui est la commande 7 ici.

### cdc:LGY : le mode ancien

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Ce que fait le code |
| --- | --- | --- | --- | --- | --- |
| 1 | « allume l'ADC du micro, efface banque 3 idx 3 puis banque `0xFF` idx 5 » | `cdclgy_cmd0001` | `0x1068d8` | `0x00010040` | appelle l'allumage du micro (`cdcmic_SetPower(1)`), puis banque 3 indice 3 à 0 (le numéro de banque est perdu dans le pseudo-code ; 3dbrew dit 3), banque 0 indice `0x52` bit 7 à 1 et indice `0x51` bit 7 à 0, banque `0xFF` indice 5 à 0 |
| 2 | « règle des bits CONFIG11, écrit `0x40` en banque `0x67` idx `0x25` » | `cdclgy_cmd0002` | `0x103308` | `0x00020040` | paramètre non nul : bit 1 de `0x1EC41114` et de `0x1EC41116` mis à 1 (`LGY_GPIOEMU_MASK` et `LGY_GPIOEMU_DATA`) puis banque `0x67` indice `0x25` bit 6 à 1 ; nul : l'inverse |
| 3 | « modifie le bit 5 en banque `0x65` idx `0x33` » | `cdclgy_cmd0003` | `0x106514` | `0x00030040` | banque `0x65` indice `0x33`, bits `0x30` : `0x10` ou 0 selon le paramètre |

### cdc:CHK : le service de contrôle

| N° | Fonction | Adresse | Réponse | Ce que fait le code |
| --- | --- | --- | --- | --- |
| 1 | (dans l'aiguillage) | | `0x00010042` | choisit une banque, lit des registres (`codec_select_bank`, `codec_read_regs`) |
| 2 | (dans l'aiguillage) | | `0x00020042` | idem |
| 3 | (dans l'aiguillage) | | `0x00030040` | choisit une banque, écrit des registres (`codec_write_regs`) |
| 4 | (dans l'aiguillage) | | `0x00040040` | idem |
| 5 | `cdcchk_ReadSpiDevice0` | `0x106960` | `0x00050080` | lit un registre de l'appareil SPI 0 (`indice | 0x80`) |
| 6 | `cdcchk_WriteSpiDevice0` | `0x106998` | `0x00060040` | écrit un registre de l'appareil SPI 0 |
| 7 | `cdccsn_cmd0003` | `0x1025a0` | `0x00070040` | la commande 3 de `cdc:CSN` |

3dbrew nomme `ReadSPI` (en-tête `0x000100C0`) et `WriteSPI` (`0x000300C2`) ; les réponses lues ici sont `0x00010042` et `0x00030040`.

## Partie 4 : l'initialisation du codec

`codec_initialize` (`0x100b54`) :

1. prépare le verrou `0x109168`, ouvre `pdn:i` (poignée `0x1090c0`), puis le service SPI de l'appareil 3 (`codec_open_spi`, `0x1012d4`) : la table de `0x1090cc` donne `SPI::NOR` pour l'appareil 1, `SPI::CD2` pour le 3, `SPI::CS2` pour le 4, `SPI::CS3` pour le 5 et `SPI::DEF` pour les autres ; ouvre `gpio:CDC` (`0x109094`) et `mcu::CDC` (`0x109018`) ;
2. lit **le bloc `0x00020000` de `cfg:s`** (`CFG_GetConfigInfoBlk8`, `0x101750`), `0x134` octets, dans le tampon `0x109174` ; c'est le bloc d'étalonnage d'usine (« HWCAL, élément 5 » dans [cfg](cfg.md)). Il est passé à `codec_init_hardware` ;
3. prend le verrou, appelle **`codec_init_hardware`** (`0x10146c`, 2 236 octets), rend le verrou ;
4. `MCUCDC_SetRegister26hBit4` : demande à `mcu::CDC` de mettre à 1 le bit 4 du registre `0x26` du microcontrôleur ([mcu](mcu.md)) ;
5. crée le fil de surveillance de la prise casque (partie 5).

`codec_init_hardware` fait, dans l'ordre : règle les appareils SPI (`SPI_SetDeviceState`, `SPI_EnableSpiBus`), demande à `pdn:i` d'activer l'horloge I2S2 (`PDNI_SetI2S2Enable(1)`), lance la séquence de mise sous tension de la puce (une centaine d'écritures par `codec_select_bank`, `codec_write_reg` et `codec_update_bits`, avec des pauses de 40 ms, 30 ms et 1 ms), règle la broche casque (`gpio:CDC`, partie 5), programme **les coefficients des filtres** à partir du bloc d'étalonnage (écritures de 6 et 0x38 octets dans les banques 4 et 5 ; mots permutés octet par octet), puis les registres `I2S1_CNT` et `I2S2_CNT` (partie 6). Le détail des écritures n'est pas recopié.

## Partie 5 : la prise casque et la veille

**La prise casque.** La broche `0x8` de `gpio:CDC` (interruption `0x64`, « casque branché » d'après [gpio](gpio.md)) est réglée en entrée (`GPIOCDC_SetDirection(0, 8)`), avec le front `1` (`GPIOCDC_SetEdge(1, 8)`), puis son interruption est autorisée (`GPIOCDC_SetInterruptEnable(8)`) et liée à un événement (`GPIOCDC_BindInterrupt(8, événement)`, poignée `0x109078`).

`codec_headphone_thread_main` (`0x1013e8`, priorité 21) attend un **minuteur de 16 ms** (`0xF42400` ns, `0x10901c`) : à chaque tour, il appelle `codec_poll_headphones` (`0x1018c8`) puis range l'état du casque dans l'octet `0x1FF810C0` de la page partagée de la console. `codec_poll_headphones` :

1. consulte l'événement de la broche sans attendre ; s'il est levé, le baisse et pulse le bit 7 de la banque `0x64`, indice `0x43` ;
2. lit la broche (`GPIOCDC_GetData(8)`) ;
3. compare à l'état mémorisé (`0x109071`) : s'ils sont égaux, remet le compteur (`0x109070`) à 0 ; sinon l'incrémente, et à la **cinquième différence d'affilée** (80 ms) adopte le nouvel état et, si la sortie n'est pas forcée (`0x109072`), programme la banque `0x64`, indice `0x45`, bits `0x30` (`0x20 | état << 4`).

**La veille.** `codec_on_notification` (`0x1069d4`) :
- `0x104` (veille) : met l'octet `0x109000` à 1, éteint la puce (`codec_power_down`, `0x1035c8` : arrête les horloges I2S, `PDNI_SetI2S2Enable(0)`) puis envoie `PTMSYSM_NotifySleepPreparationComplete` (`0x04030042`, `0x1048e4`) ;
- `0x105` (réveil) : rallume (`codec_power_up`, `0x1066d0`), remet l'octet à 0, envoie la même requête et **lève l'événement `0x109028`** (celui que rend `cdc:CSN` 9) ;
- `0x213` (couvercle ouvert) : si la sortie est forcée (`codec_get_output_route`, `0x10665c`), la remet à 0 (`codec_set_output_route(0)`, `0x102518`) ;
- `0x214` (couvercle fermé) : si l'octet `0x10902c` est non nul, force la sortie à 1.

Le sens exact de la sortie forcée est interprété : c'est l'octet qui sert aussi à `ForceHeadphoneOut` de `cdc:DSP`.

## Partie 6 : le matériel

| Adresse | Largeur | Nom (3dbrew) | Lu ou écrit par le module |
| --- | --- | --- | --- |
| `0x1EC45000` | 16 bits | `I2S1_CNT` | écrit à l'initialisation (bit 15 à 0, puis `0x800`, `0x4000`, `0x8000` : valeur `0xC800`, « utilisée par le DSP et le micro » d'après 3dbrew) ; les six bits du bas par `cdcdsp_SetI2S1Volume` ; le bit 15 remis à 0 par `codec_power_down` |
| `0x1EC45002` | 16 bits | `I2S2_CNT` | écrit à l'initialisation (`0xE000` : « utilisé par CSND ») ; le bit 15 remis à 0 par `codec_power_down` |
| `0x1EC41114` | 16 bits | `LGY_GPIOEMU_MASK` (physique `0x10141114`) | écrit par `cdclgy_cmd0002` (bit 1) |
| `0x1EC41116` | 16 bits | `LGY_GPIOEMU_DATA` (physique `0x10141116`) | écrit par `cdclgy_cmd0002` (bit 1) |
| `0x1EC03000` | | CSND (physique `0x10103000`) | mappée par l'exheader, **aucun accès vu dans le code** |

Le reste passe par d'autres services : les registres du codec par SPI, l'horloge I2S2 par `pdn:i`, la broche casque par `gpio:CDC`. Aucune interruption n'est liée par le module lui-même (`BindInterrupt` n'est pas dans son masque d'appels système).

## Partie 7 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x108000` | `pdn:i`, `gpio:CDC`, `mcu::CDC`, les six noms `cdc:*` (`0x108018` à `0x108040`), `cfg:s`, `err:f`, les cinq chaînes `ptm:*`, `SPI::CD2`, `SPI::CS2`, `SPI::CS3`, `SPI::NOR`, `SPI::DEF`, `cfg:u` |
| `0x109000` | octet « en veille » ; `0x109004` à `0x109018` des objets (verrou ; la poignée `mcu::CDC` en `0x109014`, passée en `0x100BD0` et `0x100C38`, et sa copie en `0x109018`) ; `0x10901C` le minuteur de 16 ms ; `0x109020` l'objet du fil casque ; `0x109028` l'événement de réveil |
| `0x109030` | octet « New 3DS » |
| `0x109038` | la table des six services ; `0x109050` celle des six fonctions de fil |
| `0x109070` | l'état de la puce : compteur de débounce (+0), casque branché (+1), sortie forcée (+2), (+3) et (+4) deux états sauvegardés par `codec_power_down` ; `0x10907C` le pointeur vers la poignée SPI (`0x10900C`) |
| `0x10908E`, `0x10908F` | la banque courante de la puce (appareils autres que 3 et appareil 3) |
| `0x109094` | la poignée de `gpio:CDC` ; `0x109078` l'événement de la broche |
| `0x1090C0` | la poignée de `pdn:i` ; `0x1090CC` la table des cinq noms SPI |
| `0x1090E8` | la poignée de `srv:` ; `0x1090EC` celle de `cfg:s` ; `0x109140` celle de `ptm` |
| `0x109168` | le verrou des accès à la puce ; `0x109174` le bloc d'étalonnage (`0x134` octets) |
| `0x1096A8` | les objets des six fils de session ; `0x1096D8` leurs piles |
| `0x10AED8` à `0x10AF1C` | les cinq objets de notification |

## Partie 8 : les services que codec appelle

| Service | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- |
| `srv:` | `0x00010002`, `0x00020000`, `0x00030100`, `0x000400C0`, `0x000B0000`, `0x00090040`, `0x00050100` | les sept de [sm](sm.md) | `0x101334`, `0x101370`, `0x100aa4`, `0x100b00`, `0x1013ac`, `0x103c1c`, `0x103938` et `0x10390c` | se déclarer, créer et retirer les six services, notifications (dont `Subscribe`), ouvrir les autres services |
| `pdn:i` | `0x00020040` | `PDNI_SetI2S2Enable` | `0x103180` | l'horloge I2S2 (commande 2 de [pdn](pdn.md)) |
| `SPI::CD2` | `0x00030100` | `SPI_ReadWriteDevice` | `0x1027ac` | lire des registres de la puce |
| | `0x00040500` | `SPI_ReadWriteDevice2` | `0x10274c` | écrire (deux écritures sous la même sélection : l'adresse du registre, puis les données) |
| | `0x00010080` | `SPI_SetDeviceState` | `0x1037a8` | régler l'état d'un appareil |
| | `0x000800C0` | `SPI_EnableSpiBus` | `0x1017e0` | choisir l'interface du bus |
| | `0x00020040` | `SPI_cmd0002` | `0x103590` | la commande neutre |
| `gpio:CDC` | `0x00090082`, `0x000A0042`, `0x00040080`, `0x00060080`, `0x00080080`, `0x00020080`, `0x00070040` | `GPIOCDC_*` | `0x10231c`, `0x101884`, `0x102360`, `0x102398`, `0x10281c`, `0x102f04`, `0x1030f4` | la broche casque et la broche `0x40` (partie 5) |
| `mcu::CDC` | `0x00010000` | `MCUCDC_SetRegister26hBit4` | `0x101210` | un bit du microcontrôleur |
| `cfg:s` | `0x04010082` | `CFG_GetConfigInfoBlk8` | `0x101750` | le bloc d'étalonnage |
| | `0x00050000` | `CFG_GetSystemModel` | `0x1040dc` | le modèle de la console |
| `ptm` | `0x040A0000` | `PTMSYSM_CheckNew3DS` | `0x1017a0` | New 3DS ou non |
| | `0x04030042` | `PTMSYSM_NotifySleepPreparationComplete` | `0x1048e4` | accuser réception de `0x104` et `0x105` |
| `err:f` (port) | `0x00010800` | `ERRF_Throw` | `0x103f38` | signaler une erreur fatale |

Les noms `SPI_*`, `GPIOCDC_*`, `PDNI_*` et `MCUCDC_*` sont ceux de ce fichier ; les en-têtes sont ceux des fiches de [spi](spi.md), [gpio](gpio.md), [pdn](pdn.md) et [mcu](mcu.md), qui les reçoivent. L'appareil 3 de `SPI::CD2` (appareil SPI de la puce) passe par la page `0x10142000` (bus 1 de 3dbrew).

## Partie 9 : les appels système utilisés

`ControlMemory` (`0x01`), `ExitProcess` (`0x03`), `CreateThread` (`0x08`), `ExitThread` (`0x09`), `SleepThread` (`0x0A`, pour les pauses de 40 ms de l'initialisation, `0x103f78`), `CreateEvent` (`0x17`), `SignalEvent` (`0x18`, le réveil), `ClearEvent` (`0x19`), `CreateTimer` (`0x1A`, le minuteur de 16 ms), `SetTimer` (`0x1B`), `CreateAddressArbiter` (`0x21`), `ArbitrateAddress` (`0x22`), `CloseHandle` (`0x23`, 24 endroits), `WaitSynchronization1` (`0x24`, 7), `WaitSynchronizationN` (`0x25`), `DuplicateHandle` (`0x27`), `GetProcessInfo` (`0x2B`), `ConnectToPort` (`0x2D`), `SendSyncRequest` (`0x32`, 26 endroits), `GetProcessId` (`0x35`), `Break` (`0x3C`), `AcceptSession` (`0x4A`), `ReplyAndReceive` (`0x4F`). **Ni `BindInterrupt` ni `UnbindInterrupt`** dans le code (l'exheader les autorise).

## Les désaccords relevés

- **3dbrew, `cdc:HID`.** Les en-têtes `0x00010042`, `0x00020042`, `0x00030000` : le code répond `0x000100C0`, `0x00020040`, `0x00030040`, et reçoit des requêtes à numéro seul.
- **3dbrew, `cdc:CSN` (9 commandes) et `cdc:DSP` (8) :** « ? » partout ; les commandes de `cdc:CSN` sont décrites ci-dessus par leurs registres.
- **3dbrew, `cdc:CHK`.** `ReadSPI` `0x000100C0` et `WriteSPI` `0x000300C2` ; réponses lues `0x00010042` et `0x00030040`, 7 commandes au lieu des 4 de la page.
- **Carte des services.** À vérifier avec `carte-des-services/donnees.js` (voir le rapport).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 35 commandes (3, 5, 9, 8, 3, 7), leurs fonctions de travail ou leurs aiguillages en ligne et leurs en-têtes de réponse : le pseudo-code des six aiguillages d'un côté, `emulate_dispatch.py` de l'autre. Les nombres de commandes sont ceux de 3dbrew pour `cdc:MIC` (5), `cdc:LGY` (3), `cdc:HID` (3) et `cdc:DSP` (8, par la fiche de `dsp`).
- La séquence du tactile (`cdc:HID`) : le pseudo-code et le texte de 3dbrew donnent les mêmes appels (banque `0x67`, indices `0x26`, `0x24`, `0x25`, banque `0xFB`, `0x34` octets).
- Les cinq commandes du micro : le pseudo-code et la fiche de `mic` (mêmes en-têtes envoyés).
- Le choix du service SPI par appareil : la table de `0x1090CC` et le code de `codec_open_spi` ; l'appareil 3 est `SPI::CD2`, comme dit 3dbrew.
- `LGY` 2 : les adresses `0x1EC41114` et `0x1EC41116` et le texte de 3dbrew (`LGY_GPIOEMU_MASK` et `_DATA`).
- Les valeurs de `I2S1_CNT` et `I2S2_CNT` : le code et 3dbrew (« usually 0xC800 », « usually 0xE000 »).
- Les services appelés : les en-têtes des 26 requêtes envoyées, rapprochés des fiches des modules qui les reçoivent (SPI, gpio, pdn, mcu, cfg, ptm).
- L'absence d'interruption liée par le module : l'exheader n'en déclare aucune, le masque d'appels système ne contient pas `BindInterrupt`, et le code n'appelle pas `svc 0x50`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Les rôles des commandes de `cdc:CSN`, des banques `0x64`, `0x65`, 0, 1, 4, 5, 8 à 12 : la puce n'est pas documentée ici, je donne les accès.
- Que l'octet « sortie forcée » (`0x109072`) soit celui de `ForceHeadphoneOut` et ce que `0x213` et `0x214` en font.
- Que les coefficients écrits aux banques 4 et 5 soient des filtres tirés du bloc `0x00020000` : la forme (6 octets, puis `0x38` octets deux fois) et les permutations d'octets sont lues ; le sens ne l'est pas.
- La page `0x1EC03000` (CSND) : déclarée dans l'exheader, jamais atteinte dans le code que j'ai lu.
- Que la priorité 15 sur le processeur 3 pour `cdc:HID` sur New 3DS soit voulue : c'est ce que fait `codec_main`.
- Les noms des fonctions de la bibliothèque, reconnus par l'identité du code avec des fonctions déjà nommées dans d'autres modules.

**Pas lu**
- Les 88 fonctions sans nom, dont `codec_power_up` en détail, les fonctions d'écriture des filtres (`0x1028DC`, `0x102854`, `0x102BD0` jusqu'au dernier registre), la séquence complète de `codec_init_hardware` (2 236 octets).
- Les valeurs écrites aux registres du codec (hors celles citées) : la puce n'est pas documentée dans ce dépôt.
- L'en-tête de DSP 8 et LGY 1 : lus à la surface.
- Le corps des fonctions de bibliothèque : tas, gestionnaire d'adresses, thread local.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 235 fonctions, projet Ghidra | `outils/ghidra_direct.py codec` | une minute |
| Tables des six aiguillages | `outils/emulate_dispatch.py codec 0x1050c4=cdc:HID 0x1052f0=cdc:MIC 0x1054cc=cdc:CSN 0x104d6c=cdc:DSP 0x1051f0=cdc:LGY 0x105784=cdc:CHK` | quelques minutes |
| Assembleur du module | objdump de devkitPro (`code.asm`) | immédiat |
| Banques et indices de chaque commande | `local/analyse/codec/regs.py` | immédiat |
| Exheader | `local/analyse/gpio/exh.py` | immédiat |
| Pseudo-code avec les constantes des tables de littéraux | `local/analyse/gpio/lit.py` | immédiat |
| Noms de la bibliothèque | `local/analyse/gpio/match.py` | immédiat |
| 3dbrew : « Codec Services » et « Codec Registers » | web.archive.org, capture de 2022 | |

Les scripts et le brut sont dans `local/analyse/codec/` et `local/analyse/gpio/` (non versionné).

**Pour reprendre.** `codec.noms.tsv` est le fichier de graines. Les noms en `cdc<service>_` sont les commandes reçues, `codec_` la puce et le module, `SPI_`, `GPIOCDC_`, `PDNI_`, `MCUCDC_`, `CFG_`, `PTMSYSM_` les requêtes envoyées. Endroits à relire en premier : `codec_init_hardware`, `codec_power_up` et `cdcdsp_SetIirFilterI2S1`.
