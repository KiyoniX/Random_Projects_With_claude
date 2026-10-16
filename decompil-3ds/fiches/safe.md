# Les variantes « safe » des modules système

La NAND contient, pour 23 modules, une seconde copie destinée au mode sans échec (`local/extrait/<module>-safe/`, titre `00040130 2000xx03` au lieu de `00040130 0000xx02`). Cette fiche compare chaque copie à son module normal : version, taille, part du code identique, services de l'exheader, commandes. Les fiches des modules normaux valent pour les variantes quand la conclusion le dit.

Fiche du 16 octobre 2026. Aucun octet du jeu ou de la console n'est recopié : seulement des adresses, des nombres et des noms. Les adresses sont celles du module chargé à `0x00100000`.

## Méthode

- **Code identique « aux adresses près ».** `local/analyse/safe/align.py` normalise chaque mot du code : un branchement perd son déplacement ; un `ldr` de littéral perd son déplacement mais garde la **valeur** du littéral, sauf si elle tombe dans l'espace d'adresses du module (elle devient « adresse ») ; les mots de table de littéraux ne comptent pas deux fois. Fonction par fonction (liste `gh/funcs.tsv` du module normal), il cherche dans le safe la même suite de mots : *identique* (tout retrouvé), *constante* (identique sauf la valeur d'un littéral, typiquement le numéro de ligne de `ERRF_Throw`), *proche* (au moins 85 % des mots retrouvés), *modifiée* (50 à 85 %), *absente*. Pour `dsp`, `gsp`, `ns` et `nim`, qui n'ont pas de liste de fonctions, seule la **couverture par blocs** est donnée : part des mots du texte qui appartiennent à une suite de 8 mots normalisés présente aussi dans l'autre module.
- **Exheader** : lu par le même script (services, interruptions, pages, appels système, priorité, pile). **Noms de services** : chaînes terminées par un zéro dans `code.bin` (`names.py`).
- **Commandes** : `dispatch.py` retrouve l'aiguillage dans le safe (par `funcs_map.tsv`, puis, pour les aiguillages ARM à table de saut, par `switches.py`), le fait rejouer par `outils/emulate_dispatch.py <module>-safe`, et compare au tableau du normal : numéros en plus ou en moins, en-tête de réponse, vérification de l'en-tête, et code de la fonction de chaque commande.
- Scripts et sorties : `local/analyse/safe/` (non versionné).

## Le tableau

« Texte » est la taille de `.text` (octets). « Fonctions » : identiques / total (puis nombre de *constante*, *proche*, *modifiée*, *absente*). « Octets » : part des octets de fonctions identiques ou ne différant que par une constante. « Blocs » : couverture du texte normal / du texte safe.

| Module | Version normal | Version safe | Texte normal / safe | Fonctions | Octets | Blocs |
| --- | --- | --- | --- | --- | --- | --- |
| codec | 7.0.0 | 7.0.1 | 29 228 / 29 228 | 231/235 (4 cst) | 100 % | 100 % / 100 % |
| spi | 4.0.0 | 4.0.1 | 14 112 / 14 112 | 141/143 (2 cst) | 100 % | 100 % / 100 % |
| pdn | 2.0.0 | 3.0.1 | 9 060 / 9 060 | 101/103 (2 cst) | 100 % | 100 % / 100 % |
| friends | 21.0.0 | 8.0.1 | 355 564 / 355 564 | 4 651/4 666 (13 cst, 2 prc) | 100 % | 100 % / 100 % |
| gpio | 3.0.1 | 3.0.1 | 11 880 / 11 784 | 115/118 (2 cst, 1 mod) | 96,9 % | 99,8 % / 99,5 % |
| csnd | 5.0.0 | 5.0.1 | 25 140 / 25 072 | 446/457 (4 cst, 3 prc, 2 mod, 2 abs) | 98,2 % | 99,1 % / 99,4 % |
| ssl | 9.0.1 | 8.0.2 | 285 864 / 285 616 | 2 547/2 638 (13 cst, 55 prc, 13 mod, 10 abs) | 95,6 % | 99,5 % / 99,5 % |
| ptm | 11.0.0 | 10.0.1 | 50 416 / 49 968 | 796/813 (5 cst, 6 prc, 1 mod, 5 abs) | 91,0 % | 99,0 % / 99,5 % |
| ps | 5.0.0 | 5.0.1 | 17 284 / 17 272 | 175/185 (6 cst, 3 prc, 1 abs) | 89,5 % | 98,7 % / 98,7 % |
| socket | 8.0.0 | 7.0.1 | 200 840 / 200 624 | 786/829 (9 cst, 23 prc, 6 mod, 5 abs) | 81,5 % | 99,1 % / 99,2 % |
| nwm | 11.0.0 | 10.0.1 | 248 692 / 247 844 | 2 525/2 812 (13 cst, 230 prc, 28 mod, 16 abs) | 79,3 % | 98,7 % / 98,9 % |
| mcu | 9.0.0 | 9.0.1 | 33 580 / 33 360 | 266/285 (6 cst, 9 prc, 4 abs) | 60,0 % | 97,4 % / 98,1 % |
| ac | 9.0.0 | 8.0.1 | 121 208 / 120 672 | 1 442/1 575 (14 cst, 96 prc, 16 mod, 7 abs) | 69,4 % | 98,0 % / 97,8 % |
| http | 14.0.0 | 10.0.1 | 109 164 / 104 448 | 599/739 (21 cst, 94 prc, 16 mod, 9 abs) | 72,3 % | 96,2 % / 97,3 % |
| hid | 10.0.0 | 8.0.1 | 38 068 / 37 556 | 273/303 (5 cst, 14 prc, 7 mod, 4 abs) | 76,5 % | 94,5 % / 95,7 % |
| cfg | 15.0.0 | 11.0.1 | 43 616 / 43 572 | 659/689 (5 cst, 12 prc, 5 mod, 8 abs) | 77,0 % | 94,9 % / 95,2 % |
| dsp | 7.0.1 | 6.0.1 | 31 172 / 30 688 | (pas de liste) | | 96,5 % / 98,0 % |
| gsp | 14.0.0 | 9.0.1 | 58 112 / 56 280 | (pas de liste) | | 94,0 % / 96,5 % |
| am | 10.0.5 | 7.0.1 | 73 056 / 72 616 | 1 015/1 081 (6 cst, 18 prc, 30 mod, 12 abs) | 78,8 % | 83,6 % / 83,9 % |
| ns | 23.0.1 | 13.0.1 | 129 596 / 119 536 | (pas de liste) | | 83,6 % / 89,6 % |
| ir | 13.0.1 | 7.0.1 | 67 836 / 64 296 | 390/455 (6 cst, 11 prc, 18 mod, 30 abs) | 73,8 % | 88,0 % / 92,0 % |
| i2c | 5.0.1 | 4.0.1 | 21 396 / 22 948 | 162/194 (2 cst, 3 prc, 7 mod, 20 abs) | 66,3 % | 80,7 % / 76,5 % |
| nim | 14.0.5 | 9.0.1 | 328 060 / 370 912 | 235/3 361 (6 cst, 11 prc, 3 mod, 3 106 abs) | 3,0 % | 5,0 % / 4,3 % |

Les versions sont celles de l'inventaire de la NAND : **la variante safe n'a presque jamais la même version que le normal**, et elle est le plus souvent plus ancienne (sauf codec, spi, pdn, mcu, csnd, ps, gpio : à une révision près). Le titre du safe porte `0x20` dans la partie haute de l'identifiant et se termine par `03`.

Remarque sur les « octets » : ils sont plus bas que les « blocs » quand une grosse fonction (un aiguillage, `*_main`) diffère d'un détail : elle est alors *proche*, pas *identique*, mais ses mots sont presque tous retrouvés. Les fonctions *constante* ne diffèrent que par la valeur d'un littéral, dans tous les modules le numéro de ligne passé à `ERRF_Throw` (par exemple `0xE158` contre `0xE247`).

## Exheader et services

Mêmes services, mêmes interruptions, mêmes pages, même priorité et même pile dans les 23 paires, **sauf** :

| Module | Différence |
| --- | --- |
| gsp | `qtm:sp` (normal) contre `qtm:s` (safe) ; l'appel système 89 (`SetGpuProt`, 3dbrew : depuis 11.3.0) n'est pas autorisé dans le safe |
| ns | `qtm:sp` contre `qtm:s` ; la chaîne `cam:s` n'est pas dans le code du safe (l'exheader l'autorise encore) |
| nwm | l'appel système 90 (`SetWifiEnabled`, 3dbrew : depuis 11.4.0) n'est pas autorisé dans le safe ; deux descripteurs de noyau de plus dans le safe (`0xFF...` : 4286704704 et 4286704705, pages ou interruptions non décodées) |
| hid | la chaîne `hid:NFC` n'est pas dans le code du safe (la commande 24, propre à NFC, n'y est pas non plus) |

Les listes de services de l'exheader des autres modules sont identiques. Les noms de services du code sont les mêmes partout, aux exceptions ci-dessus. Les tailles de segments diffèrent légèrement (texte, données), ce qui est attendu pour une autre version.

## Les commandes

Aiguillages rejoués dans le safe (adresse du safe trouvée par le code) et comparés au normal :

| Module | Résultat |
| --- | --- |
| codec, spi, pdn, ptm, mcu, socket, ssl, friends, csnd, ps, i2c | Mêmes numéros, mêmes en-têtes de réponse, même vérification d'en-tête dans tous les aiguillages ; le code des fonctions de commande est identique (ou ne diffère que par une constante). Pour i2c, l'aiguillage lui-même est *proche* mais les 21 commandes sont les mêmes ; ce sont les fonctions de bas niveau (`i2c_bus_*`, lectures et écritures de registres) qui sont écrites autrement dans le safe |
| gpio | 10 commandes identiques ; la commande 10 (`UnbindInterrupt`) a un code différent (`gpio_UnbindInterrupt`, 0x102254 : ressemblance 0,56) |
| cfg | **La commande `0x000B` (`IsFangateSupported`) manque** dans `cfg:s`, `cfg:i` et `cfg:u` (25, 57 et 10 commandes au lieu de 26, 58 et 11) ; `cfg:nor` (20) est identique |
| http | `http:C` a 58 commandes au lieu de 66 : **les huit commandes `0x3B` à `0x42` manquent** (SetCrl, SetInternalCrl, SetCrlStore, CreateCrlStore, DestroyCrlStore, AddCrlToCrlStore, AddInternalCrl, RemoveCrlFromCrlStore) ; les 58 autres sont identiques |
| hid | 23 commandes au lieu de 24 : **la commande `0x18`** (propre à NFC) manque ; les commandes 19 et 20 (`EnableGyroscopeLow` et `DisableGyroscopeLow`) ont un code *proche* |
| ir | `ir:u` (18) identique ; `ir:USER` (26) : la commande 20 (`GetTryingToConnectStatus`) est réécrite ; **`ir:rst` a 7 commandes au lieu de 9** (`0x08` et `0x09`, celles du bloc d'étalonnage de la New 3DS, manquent) et ses commandes 1 à 3 (`GetHandles`, `Initialize`, `Shutdown`) sont réécrites |
| am | `am:sys`, `am:u` et `am:net` : **la commande `0x2D` (`CheckContentRightsIgnorePlatform`) manque** ; dans `am:net`, **`0x827` (`DeleteAllDemoLaunchInfos`) et `0x829` (`ExportTicketWrapped`) manquent**, et `0x817` (`Verify`) est écrit autrement ; `am:app` (13) est identique. Les cas `0x418` et `0x419` d'`am:u` sont un artefact de l'émulation (voir `am.md`) |
| ac | `ac:u` (65 numéros) et `ac:i` (227) ont les mêmes numéros ; les commandes `0x21` et `0x30` ont un code *proche* (ressemblance 0,97 et 0,89), la `0x467` d'`ac:i` *modifiée* (0,75) |
| nwm | Tous les aiguillages ont les mêmes numéros ; quelques commandes ont un code *proche* ou *modifié* (nwm:a 3, 16 et 22 ; nwm::EXT 3 ; nwm:b 34 ; nwm:c 11 ; nwm:d 2 ; nwm:e 44) |
| dsp | 32 commandes de part et d'autre ; les commandes 14 à 16 passent par une fonction commune dont le code est *modifié* (ressemblance 0,71) |
| gsp | `gsp::Gpu` (31 commandes) : les commandes 20 et 21 ont un code différent ; `gsp::Lcd` (21) : les commandes 3, 10 et 20 aussi |
| ns | `ns:s` (22), `ns:c` (2), `ns:p` (2) : mêmes numéros, huit commandes d'`ns:s` et les deux de `ns:c` ont un code différent ; l'aiguillage APT a **un numéro en moins (`0x105`)** et 14 commandes au code différent. Les ressemblances très basses (0,2 à 0,3) viennent aussi de la taille des fonctions, estimée faute de liste |

## Conclusions par variante

- **codec-safe, spi-safe, pdn-safe, friends-safe** : même code à 100 % près (aux constantes de ligne d'erreur et aux données). La fiche du normal vaut telle quelle. (friends : texte identique mot pour mot malgré des versions 21.0.0 et 8.0.1 ; seule la section en lecture seule diffère de 28 octets.)
- **gpio-safe, csnd-safe, ssl-safe, ptm-safe, ps-safe, socket-safe, nwm-safe, mcu-safe** : même code à 97 à 99 % près (blocs de 8 mots), mêmes commandes, même exheader (sauf nwm : appel système 90 absent). La fiche du normal vaut. Écarts à retenir : gpio `UnbindInterrupt` réécrit ; mcu : le micrologiciel de 16 387 octets n'est pas dans la section en lecture seule mais dans celle des données (tailles de segments permutées) ; nwm : `SetWifiEnabled` non autorisé.
- **cfg-safe** : 95 % près ; **moins la commande `0x0B`** sur trois services ; `config_upgrade`, `create_default_setting_blocks` et les trois aiguillages sont retouchés (autres blocs par défaut). La fiche vaut, avec cet écart.
- **hid-safe** : 95 % près ; **moins la commande 24 et `hid:NFC`**. La fiche vaut avec cet écart.
- **http-safe** : 96 % près ; **moins les huit commandes de CRL (`0x3B` à `0x42`)**. La fiche vaut avec cet écart.
- **ac-safe** : 98 % près, mêmes commandes ; beaucoup de fonctions *proches* (96), le plus souvent un petit ajout au début. La fiche vaut.
- **dsp-safe** : 96,5 % ; mêmes 32 commandes, fonction commune des commandes 14 à 16 retouchée. La fiche vaut.
- **gsp-safe** : 94 % ; `qtm:s` au lieu de `qtm:sp`, appel système 89 absent, cinq commandes retouchées (Gpu 20 et 21, Lcd 3, 10, 20). Plus ancien (9.0.1) : à relire côté file de commandes avant d'en tirer une règle.
- **ir-safe** : 88 % ; **`ir:rst` sans les commandes 8 et 9**, et `Initialize`, `Shutdown`, `GetHandles` réécrites ; machine d'états de `ir:USER` retouchée (`iruser_state_*`). La fiche vaut pour `ir:u` et `ir:USER` ; pour `ir:rst`, la liste des écarts ci-dessus.
- **am-safe** : 84 % ; plus ancien (7.0.1 contre 10.0.5), **moins `0x2D`, `0x827` et `0x829`**, `Verify` réécrit. Section propre à lire d'après `am.md`.
- **ns-safe** : 84 % ; 13.0.1 contre 23.0.1, texte plus petit de 10 060 octets ; `qtm:s`, APT sans `0x105`, 14 commandes d'APT et 10 de `ns:s`/`ns:c` retouchées. À relire, pas à reprendre telle quelle.
- **i2c-safe** : 81 % ; même interface (21 commandes, mêmes appareils permis par service d'après l'aiguillage) mais **tout le bas niveau du bus est écrit autrement** (7 fonctions `i2c_bus_*` absentes, `i2c_init_buses`, lectures et écritures de registres, `i2c_service_may_access_device` modifiés) ; le texte est plus gros (22 948 contre 21 396). Le comportement vu des clients est le même ; le détail des transactions est à relire sur le safe si on s'y intéresse.

### nim-safe, à part

`nim` (14.0.5) et `nim-safe` (9.0.1) n'ont presque rien en commun : 235 fonctions sur 3 361 retrouvées (3 % des octets), 5 % du texte couvert. Le fichier de la NAND est plus petit pour le safe (224 Ko contre 269 Ko pour le titre compressé), mais le **code décompressé du safe est plus gros** : 370 912 octets de texte contre 328 060, et 1 624 036 octets de mémoire à zéro contre 1 245 896. L'exheader est le même (`fs:USER`, `am:net`, `ac:u`, `http:C`, `cfg:s`, `ptm:s`, `ptm:gets`), les noms de services du code aussi. Le safe porte la chaîne de version d'une bibliothèque de 2012 que le normal n'a pas (`EC 4.6.0 Mar 14 2012`) : il a été compilé avec une autre chaîne d'outils, d'où une autre génération de code partout. Les 235 fonctions communes sont de la bibliothèque. La fiche de `nim` ne vaut donc pas pour `nim-safe` ; une lecture à part est nécessaire (aiguillages non rejoués ici : le normal n'a pas de tableau).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Sûr (deux voies indépendantes)**
- Versions et tailles : l'inventaire de la NAND et les en-têtes des fichiers extraits.
- Identité du code de codec, spi, pdn, friends : la comparaison mot à mot normalisée et la couverture par blocs donnent 100 % ; pour pdn et codec, une comparaison directe des octets montre 4 octets de différence (les littéraux de numéro de ligne d'`ERRF_Throw`).
- Les différences d'exheader : lues dans les deux `exheader.bin` ; l'appel système 89 et 90 correspondent aux noms de 3dbrew (`SetGpuProt`, `SetWifiEnabled`).
- Les commandes manquantes de cfg, http, hid, ir:rst et am : l'aiguillage du safe rejoué dans l'émulateur, et, pour http, cfg et am, la table de saut (nombre de cas 59 contre 67 pour http) ; pour am et hid, le nom vient de la fiche du normal.

**Interprété**
- « Plus ancien » : déduit du numéro de version de l'inventaire et des appels système absents (89 et 90), pas d'une notice.
- Que *constante* ne soit que le numéro de ligne d'`ERRF_Throw` : vu en détail pour pdn, gpio, codec, ps ; pour les autres fonctions *constante*, seule la forme (littéral seul différent) est établie.
- L'adresse de l'aiguillage dans le safe quand le code de l'aiguillage est *proche* (ARM : table de saut ; Thumb : alignement) ; les tableaux sont ceux de l'émulation, avec ses hypothèses (mémoire factice).
- Les écarts de code des commandes (ressemblance) : la taille de la fonction vient de `funcs.tsv` du normal, ou, pour dsp, gsp et ns, d'une estimation (jusqu'au prochain `push {..., lr}`) ; une ressemblance très basse peut venir de là.
- Les huit commandes de CRL, `IsFangateSupported`, etc. « absentes » : le module les refuse comme numéro inconnu dans l'émulation ; que le safe n'ait pas du tout le code correspondant n'est pas vérifié partout.

**Pas lu**
- Les sections en lecture seule et de données (hors la taille et le micrologiciel de mcu), les tables de littéraux hors fonctions.
- Le détail des fonctions *proches*, *modifiées* ou *absentes* (leur sens) : seuls leur nom et leur taille sont relevés (`local/analyse/safe/<module>/funcs_map.tsv`).
- Les aiguillages de nim, et ceux des modules sans tableau pour lesquels l'émulation n'a pas été lancée.
- Les noyaux d'`am` (autres versions), `news`, `act`, `dlp`, `mp`, `nfc`, `mvd`, `qtm` : pas de variante safe dans la NAND lue pour la plupart ; non comparés.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Comparaison fonction par fonction et par blocs | `local/analyse/safe/align.py` | une minute pour les 23 paires |
| Exheader, noms de services | `align.py`, `names.py` | immédiat |
| Aiguillages du safe | `dispatch.py` (appelle `outils/emulate_dispatch.py <module>-safe`), `switches.py` | de quelques secondes à quelques minutes par module |
| Lecture, rédaction | Claude | le gros du temps |

Les scripts et le brut sont dans `local/analyse/safe/` (non versionné).
