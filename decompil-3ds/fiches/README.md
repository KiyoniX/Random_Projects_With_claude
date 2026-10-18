# Les fiches de reverse de la console

Trois sortes de documents. Les **fiches de modules** décrivent chacune un module système de la New 3DS, lu dans le module dumpé de la console. L'**inventaire** fait le chemin inverse : il part du code de Pokémon X et relève tout ce que le jeu peut demander à la console. Les **contrats** relient les deux : pour un service, chaque commande que le jeu envoie est lue des deux côtés, dans le jeu et dans le module, avec ce qu'il faudra rendre à la place de la console sur PC.

Tous suivent la même règle : ce qui est sûr (vérifié par deux voies indépendantes), ce qui est interprété, et ce qui n'est pas lu, séparés à la fin de chaque document. Les parties « interprété » sont à relire dans Ghidra avant de s'appuyer dessus.

## Les fiches des modules

Chaque fiche a la même forme : carte d'identité, structure, tableaux des commandes avec leur fonction et leur adresse, une opération décrite pas à pas, tables en mémoire, appels système, puis ses limites.

À côté de chaque fiche, un fichier `<module>.noms.tsv` : une adresse, `function` (ARM), `label` (Thumb, ou une donnée hors du code) ou `data` (une donnée posée au milieu du code, comme la table des appels système de kernel11 ; lue par `ghidra_direct.py`, pas par REA), un nom en anglais (une ligne sans nom est une simple graine : elle demande à REA une fonction à cette adresse). C'est le fichier de graines que REA recharge (`outils/REA.md`, partie 4 bis) ; les noms sortent alors dans le pseudo-code. Le pseudo-code brut n'est pas versionné, il reste dans `local/analyse/<module>/`.

| Fiche | Module | Ce qu'on y trouve | Fonctions nommées |
| --- | --- | --- | --- |
| [sm](sm.md) | le registre des services | la boucle de service, les 18 commandes de `srv:` et `srv:pm`, GetServiceHandle pas à pas | 40 sur 117 |
| [hid](hid.md) | les boutons et les capteurs | un fil par client, l'aiguillage de 24 commandes commun à quatre services, la mémoire partagée où les jeux lisent les boutons | 186 sur 301 |
| [loader](loader.md) | le chargement des programmes | LoadProcess en 8 étapes, la décompression du code vérifiée sur Pokémon X, les pages de chaque section | 92 sur 134 |
| [pm](pm.md) | le lancement des programmes | les 16 commandes de `pm:app` et `pm:dbg`, LaunchTitle en 12 étapes, la fin d'un processus | 127 sur 175 |
| [fs](fs.md) | les fichiers | les 136 commandes de `fs:USER`, celles d'un fichier et d'un dossier ouverts, un chemin complet jusqu'à Process9, les archives | 330 sur 1 995 |
| [gsp](gsp.md) | l'écran et le processeur graphique | les commandes de `gsp::Gpu` et `gsp::Lcd`, la mémoire partagée, la file de commandes graphiques, le relais des interruptions | 265 sur 418 |
| [pxi](pxi.md) | le passage vers Process9 | les neuf services et leur canal, une requête de `fs` suivie jusqu'aux registres PXI et retour | 103 sur 151 |
| [ns](ns.md) | la vie des applications (`APT`) | les 93 commandes d'`APT`, le démarrage d'un jeu pas à pas, le bouton HOME, `ns:s` | 321 sur 919 |
| [dsp](dsp.md) | le processeur de son | les 32 commandes de `dsp::DSP`, LoadComponent en 18 étapes vérifié sur le composant de Pokémon X, les tuyaux, le sémaphore | 189 sur 276 |
| [cfg](cfg.md) | les réglages de la console | 115 commandes sur quatre services, les 65 blocs de configuration, GetConfigInfoBlk2 pas à pas | 440 sur 686 |
| [ptm](ptm.md) | la batterie, le couvercle, la veille | cinq aiguillages, les notifications publiées, la mise en veille en 15 étapes | 317 sur 813 |
| [ro](ro.md) | le chargeur des modules `.cro` | les 9 commandes de `ldr:ro`, LoadExeCRO en 15 étapes, les relocations en formules vérifiées par exécution, la liaison des imports dans les deux sens, le déchargement | 123 sur 180 |
| [camera](camera.md) | les deux caméras et le convertisseur YUV vers RGB | les cinq services (`cam:u`, `cam:s`, `cam:c`, `y2r:u`, `cam:q`), 68 + 45 + 62 commandes, le gabarit des réglages, SetReceiving jusqu'au DMA, les registres de Y2R, la boucle et les notifications | 287 sur 1 029 |
| [mic](mic.md) | le microphone | les 16 commandes de `mic:u`, StartSampling pas à pas, le fil de lecture, la page partagée, le registre `0x1EC62000` | 117 sur 179 |
| [ir](ir.md) | l'infrarouge | `ir:u` (18 commandes), `ir:USER` (26), `ir:rst` (9), l'initialisation, l'envoi d'une trame, la page partagée, le Circle Pad Pro | 199 sur 455 |
| [ndm](ndm.md) | les démons réseau | les 24 commandes de `ndm:u`, EnterExclusiveState, la suspension des démons, les requêtes vers ac, cecd, nim, frd et boss | 223 sur 880 |
| [ac](ac.md) | la connexion Wi-Fi | `ac:u` (65 commandes), `ac:i` (162 de plus, noms de 3dbrew pour 106), la configuration de 0x200 octets | 286 sur 1 575 |
| [errdisp](errdisp.md) | l'écran d'erreur fatale | le port `err:f`, Throw et SetUserString, le classement des genres d'erreur, les notifications de veille ; le dessin n'est pas lu | 34 sur 709 |
| [ssl](ssl.md) | le client TLS | les 32 commandes de `ssl:C`, trois tables de méthodes (session, gestionnaire, contexte), SeedRNG et GenerateRandomData jusqu'à `ps:ps` | 98 sur 2 638 |
| [cecd](cecd.md) | le démon StreetPass | `cecd:u` (22 commandes), `cecd:s` (38), `cecd:ndm` (8), les CecCommands, ReadMessage pas à pas | 236 sur 1 757 |
| [socket](socket.md) | la pile réseau (TCP/IP) | `soc:U` (35 commandes), `soc:P` (9), InitializeSockets pas à pas, la structure de gethostbyname | 126 sur 829 |
| [http](http.md) | le client HTTP et HTTPS | les 66 commandes de `http:C` sur trois étages (session, client, contexte), le chemin d'une requête | 326 sur 739 |
| [friends](friends.md) | la liste d'amis | `frd:u` (54 commandes), `frd:a` (70), `frd:n` (4), GetFriendKeyList pas à pas | 170 sur 4 666 |
| [nwm](nwm.md) | le pilote Wi-Fi et la communication locale | sept services (`nwm::UDS` 35 commandes, INF 16, SOC 13, SAP 44, CEC 30, EXT 9, TST 70), les états de l'UDS, CreateNetwork2 pas à pas, ce qu'une émulation de l'UDS sur le réseau du PC devrait faire | 181 sur 2 812 |
| [boss](boss.md) | les téléchargements SpotPass | `boss:U` (55 commandes), `boss:P` (143), `boss:M` (7), les codes de résultat, RegisterStorageEntry pas à pas, les 28 commandes du jeu | 207 sur 3 690 |
| [gpio](gpio.md) | les broches du processeur | 7 services de même code, 10 commandes, masques de permission, table masque → interruption, registres `0x1EC47000` | 76 sur 118 |
| [pdn](pdn.md) | l'alimentation et les horloges | 5 services, 9 commandes, horloges du GPU, du DSP, de l'I2S et de la caméra, causes de réveil | 60 sur 103 |
| [i2c](i2c.md) | les trois bus I2C | 9 services, 21 commandes, 18 appareils, valeurs de CNT, interruptions des bus | 123 sur 194 |
| [spi](spi.md) | les trois bus SPI | 5 services, 9 commandes, interface ancienne et rapide, appareils et bus | 80 sur 143 |
| [mcu](mcu.md) | le microcontrôleur | 9 services, 161 commandes avec leurs registres, fil d'interruption, notifications, réécriture du micrologiciel | 217 sur 285 |
| [codec](codec.md) | le son et l'écran tactile | 6 services, 35 commandes, banques et indices du codec, tactile, prise casque | 147 sur 235 |
| [csnd](csnd.md) | le son simple | 12 commandes, registres des voix et des unités d'enregistrement, cache | 108 sur 457 |
| [ps](ps.md) | signatures, aléa, identité | 17 commandes, relais vers Process9, aléa ; aucune clé dans le module ni dans la fiche | 83 sur 185 |
| [am](am.md) | le gestionnaire d'applications | `am:app` (13 commandes), `am:sys` (58), `am:u` (83), `am:net` (124), un relais vers `pxi:am9` (88 commandes de Process9 recoupées), GetProgramList pas à pas | 245 sur 1 081 |
| [news](news.md) | les notifications du menu HOME | `news:u` (1 commande), `news:s` (20), AddNotification pas à pas, la base `news.db` | 33 sur 719 |
| [act](act.md) | les comptes Nintendo Network | `act:u` (34 commandes), `act:a` (87), GetAccountDataBlock pas à pas, les en-têtes envoyés au serveur de comptes ; aucun secret recopié | 182 sur 1 860 |
| [dlp](dlp.md) | le Téléchargement Jeu | `dlp:CLNT` (20), `dlp:SRVR` (16), `dlp:FKCL` (17), un fil par session, StartScan pas à pas | 54 sur 1 107 |
| [mp](mp.md) | le multijoueur sans fil de bas niveau | `mp:u` (20 commandes), l'interruption liée, 16 nœuds, RecvDataFrame pas à pas | 22 sur 726 |
| [nfc](nfc.md) | les amiibo (New 3DS) | six services (`nfc:u` 34 commandes, `r` 26, `p` 19, `s` 69, `dev` 19, `m` 55), les trois modes d'`Initialize` | 197 sur 2 389 |
| [mvd](mvd.md) | le décodeur vidéo matériel (New 3DS) | `mvd:STD` (33), `l2b:u` et `l2b2:u` (23), `y2r2:u` (45), interruptions et DMA, ProcessNALUnit pas à pas | 110 sur 803 |
| [nim](nim.md) | l'eShop et les mises à jour | `nim:u` (46), `nim:s` (94), `nim:aoc` (38), `nim:ndm` (5) ; fiche courte | 165 sur 3 361 |
| [qtm](qtm.md) | le suivi du visage pour la 3D stable (New 3DS) | `qtm:u` (6), `qtm:s` (16), `qtm:c` (5), `qtm:sp` (20), les modèles embarqués | 36 sur 647 |

Les treize dernières fiches (camera, mic, ir, ndm, ac, errdisp, ssl, cecd, socket, http, friends, nwm, boss) ont chacune une section « Ce que Pokémon X envoie » : chaque commande du jeu, la fonction du module qui la reçoit et ce qu'un remplaçant de la console doit rendre. Ce ne sont pas des contrats complets : les paramètres côté jeu n'y sont pas toujours lus. Tous les modules que le jeu appelle ont maintenant une fiche (22 le 16/10/2026). Les huit modules proches du matériel (gpio, pdn, i2c, spi, mcu, codec, csnd, ps) ont aussi la leur. Les 23 variantes « safe » de la NAND (le mode sans échec) sont comparées à leur module normal dans [safe](safe.md) : version, part du code identique fonction par fonction, exheader, commandes en plus ou en moins ; quatre sont identiques à 100 %, huit à 97-99 %, et `nim-safe` est un autre code (3 % de commun), que la fiche de nim ne couvre pas. Les neuf derniers modules système (am, news, act, dlp, mp, nfc, mvd, nim, qtm) ont la leur depuis le 16/10 : **tous les modules système de la NAND ont maintenant une fiche**. Pour aller vers la console entière, restent les corps des gestionnaires non lus (chaque fiche dit lesquels), `nim-safe`, et les 22 applets. Piège d'`emulate_dispatch.py` relevé sur dlp : une petite fonction qui extrait le numéro de commande peut être prise pour une fonction de travail, et l'aiguillage paraît vide ; relancer avec `--helper <adresse>`. `cro/<Module>.noms.tsv` : un fichier par module `.cro` (133), positions dans le fichier du module comme dans le journal du banc (le banc charge DllField à `0x6a9000`), noms préfixés par le module ; écrits par `outils/name_pass.py`, et à la main pour DllField.

Le tableau s'allongera à mesure que d'autres parties du système seront lues.

Plusieurs modules sont presque entièrement en Thumb (`fs`, `cfg`, `ptm`, `camera`, `ndm`, `ac`, `cecd`, `ssl`, `nwm`, `boss`) : par le pont REA on n'en voit qu'une partie, et leurs fichiers de noms contiennent des lignes `label`. Pour les ouvrir en entier : `python outils/ghidra_direct.py <module>` lance Ghidra directement, crée les fonctions Thumb, pose les noms et range le pseudo-code dans `local/analyse/<module>/gh/` ; `python outils/emulate_dispatch.py <module> <adresse>` redonne la table de commandes d'un aiguillage en l'exécutant (`outils/REA.md`, partie 4 bis). Les fiches de `fs`, `cfg` et `ptm` renvoient encore aux scripts d'origine de leurs auteurs, que ces deux outils remplacent.

Les fiches se recoupent entre elles, et ces recoupements sont notés dans chacune : les requêtes que `pm` envoie à `loader`, celles que `ns` envoie à `pm`, la requête de lecture de `fs` reprise par `pxi`, les blocs d'étalonnage de `cfg` lus par `hid`, les notifications de veille publiées par `ptm` et reçues par `hid`.

## Ce qui n'est pas un module : le noyau, l'ARM9, les mémoires de démarrage

Ces binaires n'ont ni exheader ni code.elf : ce sont des images brutes, chargées à leur adresse dans Ghidra (sous WSL), parfois après une recopie ou un déchiffrement qu'il faut d'abord refaire. Chaque document a la forme d'une fiche (sûr, interprété, pas lu, et comment il a été fait), mais suit le binaire plutôt qu'une liste de commandes. Aucune clé ni donnée propre à la console n'y figure.

| Document | Binaire | Ce qu'on y trouve | Fonctions nommées |
| --- | --- | --- | --- |
| [kernel11](kernel11.md) | le noyau ARM11 (version 2.58-0) | la carte des adresses reconstituée, le démarrage jusqu'aux cinq modules du FIRM, les 126 appels système, les 20 classes d'objets, une requête IPC, ControlMemory et ArbitrateAddress pas à pas | 359 sur 988 |
| [process9](process9.md) | l'ARM9 : kernel9 et Process9 | la section ARM9 du FIRM découpée, kernel9 et ses 40 appels, le PXI vu de l'ARM9, 222 commandes sur six services, le romfs du jeu (archive `0x2345678E`) pas à pas jusqu'au déchiffrement AES | 385 sur 4 797 (et 46 sur 497 pour kernel9) |
| [boot9-boot11](boot9-boot11.md) | les deux mémoires de démarrage | le démarrage pas à pas jusqu'au saut dans le FIRM, la signature RSA et les empreintes des sections, ce que kernel11 et Process9 trouvent en mémoire en arrivant | 258 sur 564 (boot9), 109 sur 227 (boot11) |

## Le jeu : ce que Pokémon X peut demander

| Document | Ce qu'on y trouve |
| --- | --- |
| [pokemon-x-services](pokemon-x-services.md) | les 408 fonctions d'envoi du code de la mise à jour, une par commande, rangées par service (23 services et deux ports) ; comment le jeu ouvre ses services ; la séquence de démarrage, du point d'entrée à la boucle principale ; les modules `.cro` (133 fichiers et `static.crs`) et leur format ; le bilan pour le portage, service par service |
| `pokemon-x-services.tsv` | le tableau complet, une ligne par commande : service, en-tête, nom de la commande d'après la Carte des services, fonction du jeu, nombre d'appelants, module, preuve du service, d'où la fonction est atteinte |
| `pokemon-x.noms.tsv` | les noms de fonctions du jeu, au format des fichiers de noms des modules : 1 239 lignes le 16/10/2026, dont les 285 noms C++ que le jeu a gardés dans `static.crs`, les 408 fonctions d'envoi des services, 172 noms venus des contrats, et ce qu'a ajouté `outils/name_pass.py` (enrobages d'appels système, bibliothèque standard reconnue en l'exécutant, destructeurs lus dans les tables virtuelles). `python outils/ghidra_direct.py maj` les pose dans le pseudo-code |

L'inventaire ne relève que les en-têtes. Les paramètres et les réponses sont dans les contrats, qui ont aussi corrigé l'inventaire (l'ordre du démarrage d'APT, le repli de `cfg`, ce que `ro` doit faire) ; chaque correction y est signalée là où elle s'applique.

## Les contrats : chaque commande lue des deux côtés

Un contrat prend un service, et pour chaque commande que Pokémon X envoie, met en face la fonction d'envoi du jeu et la fonction du module qui la reçoit : deux preuves indépendantes. Il dit ce que le jeu écrit, ce que le module en fait, ce que le jeu fait de la réponse, et ce qu'un programme qui prend la place de la console doit rendre. Chacun se termine par les désaccords trouvés (entre le jeu, le module, 3dbrew, la Carte et les fiches), puis par ses limites.

| Contrat | Service | Ce qu'on y trouve | Commandes lues des deux côtés |
| --- | --- | --- | --- |
| [contrat-apt](contrat-apt.md) | `APT:U` (module `ns`) | une session par commande sous un verrou ; le dialogue de démarrage en neuf réponses ; le fil d'APT du jeu et ses notifications ; le bouton HOME vu du jeu | 27 sur 29 ; les 2 autres lues côté jeu, survolées côté module |
| [contrat-gsp](contrat-gsp.md) | `gsp::Gpu` | la séquence jusqu'à la première image ; la file de commandes graphiques et les interruptions relayées ; les tampons d'écran ; les 68 écritures de registres du chemin `0x2A07` | 14 sur 14, et les 6 commandes de la file |
| [contrat-dsp](contrat-dsp.md) | `dsp::DSP` | le démarrage du son, rejoué dans un émulateur ; les 15 adresses de la mémoire partagée ; la boucle de son, qui n'envoie aucune commande ; le décodeur AAC | 13 sur 13 |
| [contrat-fs](contrat-fs.md) | `fs:USER`, un fichier ouvert, un dossier ouvert | le romfs ouvert comme un seul fichier et lu par le jeu lui-même ; ce que `fs` fait de l'archive `0x00000003` ; la sauvegarde et les données étendues ; l'écart sur GetExtDataBlockSize | 43 sur 43 (le corps du module lu en entier pour 36) |
| [contrat-petits-services](contrat-petits-services.md) | `srv:`, `hid:USER`, `cfg:u`, `ptm:u`, `err:f`, `ldr:ro` | les notifications que le jeu écoute ; ce qu'il lit dans la mémoire de `hid` ; les 16 blocs de configuration qu'il demande ; l'écran d'erreur ; le gestionnaire de modules `.cro` | 17 sur 22 ; `err:f` et `ldr:ro` lus côté jeu seulement (le côté `ro` est lu depuis dans sa fiche) |

Les noms de fonctions que les contrats proposent sont versés dans `pokemon-x.noms.tsv` (côté jeu) et dans les fichiers de noms des modules (côté module).

## Ordre de lecture

Pour la console seule : `sm` (le plus court, il pose le vocabulaire), `hid`, puis `loader` et `pm` ensemble (ils se répondent), puis `fs` et `pxi` (la seconde prolonge la première), `gsp`, et `ns`, `dsp` et `cfg`, les services qu'un jeu appelle dès son démarrage. `ptm` complète `hid` et `ns` sur la veille.

Pour le portage de Pokémon X : l'inventaire d'abord (`pokemon-x-services`, parties 2 et 4 au moins), puis les contrats dans l'ordre du démarrage du jeu : `contrat-petits-services` (`srv:` est le premier guichet ouvert, et `cfg`, `hid`, `ptm` suivent), `contrat-apt`, `contrat-fs`, `contrat-gsp`, `contrat-dsp`. Chaque contrat renvoie à la fiche du module quand il faut le détail d'une fonction.

## Un module à 100 %

Défini le 17/10/2026 sur `gpio` et `codec`, les premiers à l'atteindre. Un module est à 100 % quand :

1. **le dénominateur est juste** : la liste de Ghidra est complétée par tous les points d'entrée réellement atteints (cible d'un `b`, `bl` ou `blx`, y compris au milieu d'une fonction de Ghidra ; mot de données qui pointe dans le code ; case d'une table de constructeurs ou d'une table virtuelle ; veneer ARM vers Thumb et son corps), et purgée de ce qui n'est pas du code, chaque retrait prouvé. Le code que rien n'atteint est listé à part et ne compte pas. Ghidra en manquait 11 dans `gpio` et 16 dans `codec` ;
2. **chaque fonction a un nom** dans `<module>.noms.tsv`, en anglais, unique dans le binaire, selon les règles de nommage (`svcXxx` pour un appel système nu, le nom de la bibliothèque pour la bibliothèque, `<préfixe>_<Commande>` pour une commande de service), et **le même nom que dans les autres fiches quand le code est le même** ;
3. **chaque nom a une confiance et une preuve d'une ligne** (adresses, constantes, appelants, empreinte) : haute = deux voies indépendantes, moyenne = une seule. Les noms haute entrent dans la fiche ; les moyens restent dans `local/analyse/<module>/noms-proposes.tsv` jusqu'à leur seconde voie ;
4. **un vérificateur a relu** les propositions avant leur entrée dans la fiche.

**Ce qui est un nom.** Un nom énonce une action ou un rôle que sa preuve établit ; une adresse ou une place ne suffit pas (règle du 17/10, après le lot de Process9) :
- `<domaine>_internal_<adresse>`, `<classe>_vfNN`, `class_method_<adresse>`, `method_<adresse>` ne sont pas des noms : la fonction reste sans nom et compte comme telle ; le domaine ou la case peut rester en annotation dans `local/` ;
- une case de table virtuelle n'est nommée que si son rôle est prouvé chez un appelant de l'interface, ou si c'est un destructeur au motif lu ; un bouchon dit ce qu'il fait (`_unsupported`, `_nop`) ;
- `_wrapper` et `_thunk` sont réservés à un corps qui ne fait que transmettre (arguments, un seul appel, retour), sans suffixes en chaîne ; sinon on nomme d'après l'effet ;
- `_alt_<adresse>` reste le nom d'un code identique à une fonction déjà nommée ; la réserve de littéraux peut ne différer que par l'adresse d'une donnée (un constructeur statique par unité de compilation), jamais par une instruction ni par une fonction appelée (décision du 18/10, lots de news, mp et boss).
- deux cases de tables virtuelles différentes, de code identique (un accesseur, un `bx lr`), dont le rôle est prouvé chacune chez un appelant de son interface, gardent chacune leur nom de rôle : `_alt_` ne vaut que pour deux copies du même rôle (décision du 18/10, lot de cecd).
- une méthode dont le rôle est prouvé chez un appelant de l'interface, sur une classe dont on ne sait pas encore nommer le rôle, s'écrit `<famille>_<adresse de la table>_<méthode>` (par exemple `file_134530_read`) : l'action est prouvée, l'adresse ne fait que distinguer la classe ; confiance moyenne au plus, et le nom de la classe remplace l'adresse dès qu'il est lu (décision du 17/10, lot de fs).
- un émetteur dont tout le corps envoie la requête N sur un canal prouvé (en-tête et poignée remontée jusqu'au nom du service, ou numéro écrit dans le bloc d'un pilote) peut s'appeler `<SERVICE>_cmd_0xNNNN` ou `driver_request_0xNNNN`, en confiance moyenne tant que la Carte dit « Inconnue » : l'action est lue en entier, le numéro en est l'objet. Un gestionnaire nommé seulement par sa case (`wl_req_0xNNNN`, `<module>_cmd_NNNN_impl`) n'a pas de nom, comme `_vfNN` : il se nomme par son effet ou par la commande de la Carte (décision du 17/10, lots de news et mp).

« 100 % » veut dire « tout est nommé et justifié », pas « tout est sûr » : `outils/couverture.py mesure` affiche le compte des noms de confiance moyenne à côté.
