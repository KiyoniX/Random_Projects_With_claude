# Le banc d'essai : Pokémon X qui démarre sur PC

Le banc fait tourner le code de la mise à jour de Pokémon X sur le PC, en répondant lui-même à tout ce que le jeu demande à la console. C'est le premier essai de démarrage du jeu hors de la 3DS, et l'outil qui dit, appel par appel, ce que le jeu fait vraiment : les fiches et les contrats étaient statiques, le banc les met à l'épreuve.

## Ce qui est réel, et ce qui n'est qu'un échafaudage

**L'échafaudage : le processeur.** Le code ARM du jeu est exécuté par unicorn, un émulateur d'ARM (dans `local/pylib/`). C'est provisoire : le but est de recompiler ce code pour le PC. Tout ce qui touche à unicorn est dans un seul fichier, `cpu_unicorn.py`, derrière une interface étroite (`cpu.py`) : lire et écrire les registres, garder et reprendre l'état d'un fil, faire avancer le fil jusqu'au prochain appel système. Le jour où le code sera recompilé, ces deux fichiers partent ; le reste reste.

**Ce qui restera : la couche système, écrite en Python d'après les fiches.**

| Fichier | Rôle | D'après |
| --- | --- | --- |
| `memory.py` | l'espace d'adresses : chaque plage est adossée à un bloc de mémoire du PC, deux plages peuvent partager le même (le miroir des `.cro`, la mémoire partagée) | kernel11, partie 6 |
| `kernel.py` | le noyau : objets (événements, mutex, sémaphores, minuteries, arbitres, fils, blocs partagés, sessions), table des poignées, 41 appels système, fils et ordonnancement, horloge | kernel11, parties 3 à 7 |
| `ipc.py` | une requête et sa réponse : descripteurs de poignées, numéro de processus, tampons statiques et projetés ; la classe `Service` | kernel11, partie 5 ; les contrats, partie 1 |
| `romfs.py` | le romfs d'un `.cxi` déchiffré, vu comme le jeu le voit (le niveau 3 de l'IVFC, un seul fichier) | contrat des fichiers, partie 2 |
| `services/` | un fichier par service, voir plus bas | les contrats |
| `pica/` | le processeur graphique : formats et tuiles (`formats.py`), transferts vers l'écran et copies de texture (`transfer.py`), interpréteur des shaders de sommets (`shader.py`), état des registres et listes de commandes (`gpu.py`), dessin (`raster.py`), éclairage par fragment (`lighting.py`), enregistrement et rejeu d'images (`replay.py`) | 3dbrew (registres internes du GPU, jeu d'instructions des shaders) |
| `bench.py` | le montage : la mémoire du programme d'après l'exheader, les pages de configuration, les services, les repères des paliers | pokemon-x-services, partie 4 |
| `journal.py`, `names.py` | le journal, et les noms (fonctions du jeu, appels système, commandes d'après la Carte des services) | `fiches/pokemon-x.noms.tsv`, `../carte-des-services/donnees.js` |
| `run.py` | la ligne de commande, le résumé, les images d'écran | |
| `tests.py` | les tests, avec ou sans dump | |

## Le lancer

```
python banc/run.py                                   # 30 s de console simulée, au plus 20 minutes de PC
python banc/run.py --secondes 25 --appuis "2:A,3:START,4:A,6:A"
python banc/run.py --appels-systeme-rares            # journal plus court
python banc/run.py --secondes 1 --sortie local/analyse/banc-court   # un autre dossier de sortie
python banc/run.py --secondes 25 --dessiner --dessiner-un-sur 6      # l'image : voir « L'image (palier 6) »
python banc/run.py --secondes 12 --dessiner-de 9.5 --dessiner-jusqu-a 11 --images-chaque 0.25
python banc/run.py --mod mods/exemples/marisson-muscle   # avec un mod (répétable) : voir mods/README.md
python banc/run.py --cpu hybride                     # le code du jeu recompilé en C, unicorn pour les .cro (voir plus bas)
python banc/tests.py                                 # aussi lancé par python outils/tests.py
```

Il lit dans `local/` (jamais versionné) : `extrait/maj/exefs/code.bin` et `exheader.bin`, les deux `.cxi` déchiffrés de `dump/` (les romfs), le fichier `config` de `cfg`, la police partagée, la sauvegarde. Il écrit dans `local/analyse/banc/` :

- `journal.txt` : chaque appel système et chaque requête IPC, avec l'heure du banc, le fil, le service, l'en-tête, le nom de la commande, la fonction du jeu qui envoie et celle qui l'appelle, et ce qui a été répondu (`réel`, `simplifié` ou `factice`) ; les fils créés, les modules `.cro` chargés et déchargés, les paliers, et à l'arrêt les registres et la pile ;
- `resume.md` : le palier atteint, la raison de l'arrêt, l'état de chaque fil, les dernières requêtes, les comptes par commande, les fichiers ouverts, les modules, l'affichage, le son, les écarts ;
- `ecran-haut.png`, `ecran-bas.png` : la dernière image annoncée par le jeu, lue en mémoire vidéo, remise à l'endroit (voir « l'image » plus bas) ;
- `images/` (avec `--dessiner`) : `NNN-SSS.SSs-haut.png` et `-bas.png`, une image des deux écrans toutes les `--images-chaque` secondes du banc dans la fenêtre de dessin ;
- `archives/` : la copie de travail de la sauvegarde et des données supplémentaires. L'original de `local/extrait/` n'est jamais touché.

**L'horloge.** Le banc a son propre temps : chaque appel système compte 2 µs, chaque tranche de 200 000 instructions 0,8 ms, et quand plus aucun fil n'est prêt le temps saute à la prochaine échéance (réveil, minuterie, fin d'image). Une exécution est reproductible. Les fins d'image arrivent toutes les 16,7 ms de ce temps-là. Comptez 3 secondes de console par minute de PC pendant la vidéo de l’écran-titre (décodée par le processeur), 8 sur le terrain : unicorn compte les instructions une à une.

**Le processeur.** `--cpu unicorn` (défaut) émule l'ARM11 ; `--cpu natif` fait tourner le code de `code.bin` recompilé en C (`recomp/`, une fibre Windows par fil de la console, `cpu_native.py`), et un saut vers un `.cro` y est une faute ; `--cpu hybride` passe la main à unicorn pour le code non recompilé (les `.cro`), avec les mêmes registres et la même mémoire ; `--cpu verifier` fait la tranche en natif puis la rejoue sous unicorn et s'arrête à la première divergence (très lent : environ 6 min par seconde de banc ; `VERIFIER_DEPUIS=N` saute les N premières tranches, `VERIFY_DUMP=fichier` écrit les entrées de fonction des deux côtés). Prérequis : les DLL de `local/recomp/jeu/build/`, refaites par `python recomp/recomp.py gen --out local/recomp/jeu` puis `python recomp/validate.py build --host` et `--logw` après tout changement de `recomp/`. Le code rencontré sans être recompilé est noté dans `local/recomp/trous.txt`, que la génération suivante relit. Une page du jeu appelée plus de 200 fois depuis unicorn lui est cédée (`HOT_PAGE_CALLS`), pour ne pas traverser sans fin. Le 16/10, l'hybride n'est pas plus rapide qu'unicorn : le temps du jeu est dans les `.cro`.

**L'ordonnanceur.** Le fil prêt le plus prioritaire tourne ; un fil plus prioritaire qui devient prêt passe devant à la sortie de l'appel système suivant ; au bout d'une tranche, le fil qui attend depuis le plus longtemps passe, quelle que soit sa priorité. C'est ce qui tient lieu des deux cœurs : un fil qui calcule longtemps n'arrête pas les autres.

## Les paliers

| Palier | Ce qu'il faut | Repère |
| --- | --- | --- |
| P1 | `entry` tourne, `srv:` et `APT:U` répondent | la réponse à GetLockHandle |
| P2 | les neuf réponses d'APT, `main`, puis `game_init_systems` | crochets sur `0x106138` et `0x107cbc` |
| P3 | le romfs ouvert et lu, `static.crs` et `static.crr` donnés à `ro`, un premier `.cro` chargé et lié | |
| P4 | la boucle principale tourne | trois passages à `0x106710` |
| P5 | des listes de commandes PICA partent par la file de `gsp::Gpu` | la commande 1 de la file |
| P6 | la première image | `--dessiner` : l'écran-titre est reconnaissable (plus bas) |

## Les services, un par un

| Service | Fichier | Ce que fait le banc |
| --- | --- | --- |
| `srv:` | `services/srv.py` | **réel** : RegisterClient, EnableNotification (un vrai sémaphore), GetServiceHandle, Subscribe, ReceiveNotification ; aucune notification publiée |
| `APT:U` | `services/apt.py` | **réel pour le démarrage** (verrou, deux signaux, la boîte aux lettres des paramètres, GlanceParameter, ReceiveParameter, AppletUtility, la police partagée dans un vrai bloc) ; **simplifié** ensuite : HOME, applets, veille et sortie répondent 0 sans rien lancer |
| `fs:USER`, fichier, dossier | `services/fs.py` | **réel** : les deux romfs (chemin 0 : jeu de base, chemin 5 : mise à jour), l'icône de l'exefs, la sauvegarde dans un dossier du PC, les données supplémentaires et la carte SD dans des dossiers vides au départ, toutes les commandes d'un fichier et d'un dossier |
| `gsp::Gpu` | `services/gsp.py` | **simplifié** : la mémoire partagée, la file de commandes vidée à chaque TriggerCmdReqQueue avec l'interruption de fin de chaque commande, les fins d'image (interruptions 2 et 3) toutes les 1/60 s ; remplissages, transferts mémoire, copies de texture et transferts vers l'écran (tuiles, formats, réduction, retournement) **faits pour de bon** ; listes PICA comptées, et exécutées par `pica/` avec `--dessiner` |
| `dsp::DSP` | `services/dsp.py` | **simplifié** : le démarrage du son complet (les 15 adresses dans le tuyau 2, la conversion des adresses), puis une trame vide toutes les 4,9 ms ; le décodeur AAC répond « réussi » sans décoder |
| `hid:USER` | `services/small.py` | **simplifié** : une vraie page partagée, mise à jour à chaque fin d'image ; les boutons viennent de `--appuis` |
| `cfg:u` | `services/small.py` | **réel** : les blocs du fichier `config` de la console, GenHashConsoleUnique calculé comme le module |
| `ptm:u` | `services/small.py` | **réel** pour GetStepHistory (des zéros écrits dans le tampon) |
| `err:f` | `services/small.py` | **réel côté banc** : la fiche d'erreur est décodée et le banc s'arrête |
| `ldr:ro` | `services/ldr_ro.py` | **réel** : Initialize, LoadCRR, LoadExeCRO et UnloadCRO, le travail fait par `outils/cro_loader.py` (classe `Linker`), branché sur la mémoire du jeu (miroir, en-tête converti, mots du code principal remplis) |
| `y2r:u` | `services/stubs.py` | **réel pour la conversion** : les plans Y, U, V (4:2:0 et 4:2:2) lus dans la mémoire du jeu, RGB32, RGB24, RGB15 ou RGB565 écrit à l'adresse de réception (en tuiles de 8 × 8 si demandé), vrai signal de fin de conversion ; l'entrée en un seul plan (YUYV) et la rotation ne sont pas faites |
| `nwm::UDS`, `boss:U`, `boss:M`, `ssl:C`, `cecd:u`, `cam:u`, `mic:u`, `ir:USER`, `ndm:u`, `ac:u`, `frd:u`, `soc:U`, `http:C` | `services/modules.py` | **simplifié** d'après les fiches de leurs modules (16/10) : chaque commande rend l'en-tête de sa fiche (`services/reply_shapes.py`, 441 commandes), avec les états (UDS 3 puis 6, session de boss, liaison infrarouge, état exclusif de ndm) et de vraies poignées d'événement ; **réel** pour les fichiers de boîte de `cecd:u` (`archives/cec/` de la sortie) et l'aléa de `ssl:C` (reproductible avec `options['seed']`). Tout reste hors ligne : ni trames UDS, ni sockets, ni HTTP |
| `y2r:u` et les services sans fiche | `services/stubs.py` | **factice** : 0 et des mots à zéro |

## Ce qui manque

- **Le dessin** est fait par `--dessiner` mais incomplet : voir « L'image (palier 6) » pour ce qui est faux ou manquant (éclairage, brouillard, shaders de géométrie…).
- **Le son.** Les trames sont rendues vides ; le format des voix et le décodeur AAC sont à écrire (contrat de dsp, partie 7, point 5).
- **APT au-delà du démarrage** : le bouton HOME, la veille, les applets (clavier, erreur) ne mènent nulle part.
- **Les données supplémentaires de la console** : le format des fichiers de `local/extrait/sd-…/extdata/` n'est pas relu ; le jeu crée les siennes, vides.
- **L'archive `0x2345678A`** (le contenu d'un autre titre) : refusée. Le jeu le tolère au démarrage.
- **Les entrées** : seulement des boutons à des heures fixées ; ni l'écran tactile, ni le pad circulaire, ni de fenêtre.
- **La vitesse** : de 10 à 20 fois plus lent que la console. C'est le prix d'unicorn ; c'est aussi ce qui disparaîtra avec la recompilation.

## L'image (palier 6)

Ce que le jeu fait pour montrer une image, vu dans le journal : il vide son tampon de rendu (un remplissage), dessine dedans par des listes de commandes PICA (un tampon de 256 × 512 points en RGBA8 rangé en tuiles de 8 × 8), demande un transfert vers l'écran (commande 3 de la file : vers `0x1F300000`, 240 × 400 en RGB8), puis annonce l'image dans la zone des tampons d'écran ; à la fin d'image suivante la console l'affiche.

**Ce qui est fait** (paquet `pica/`, appelé par `services/gsp.py`) :

1. **Les transferts** (`pica/transfer.py`, toujours faits, même sans `--dessiner`) : tuiles de Morton vers lignes, RGBA8, RGB8, RGB565, RGB5A1 et RGBA4 dans les deux sens, réduction 2 × 1 ou 2 × 2, retournement, rognage au coin haut-gauche, sortie en tuiles, copie brute ; la copie de texture se fait par lignes quand le jeu donne largeur et intervalle. Un transfert coûte environ 1,7 ms de PC (3 % de l'exécution normale).
2. **L'exécution des listes** (`pica/gpu.py`, `pica/raster.py`, avec `--dessiner`) : décodage des en-têtes (masque d'octets, écritures consécutives), état des registres, envoi des programmes de shader, des constantes (float24 ou float32) et des attributs fixes, tampons de sommets (octets, octets signés, entiers de 16 bits, flottants, 1 à 4 composantes, remplissage), dessins avec ou sans index (8 ou 16 bits), triangles en liste, en bande et en éventail, découpage au plan proche, élimination des faces, règle du haut et de la gauche, interpolation en perspective, ciseaux, test de profondeur (D16, D24, D24S8), les quatorze formats de texture (RGBA8, RGB8, RGB5A1, RGB565, RGBA4, LA8, HILO8, L8, A8, LA4, L4, A4, ETC1, ETC1A4) en tuiles de Morton, les quatre modes de bord, le filtrage au plus proche et bilinéaire, les six étages du combinateur (les dix opérations, les trois échelles, la mémoire tampon qui se met à jour avec un cran de retard), le test alpha, le mélange alpha (les cinq équations, les quatorze facteurs) et le masque d'écriture des couleurs.
3. **Les shaders de sommets** (`pica/shader.py`) : le jeu d'instructions de 3dbrew (ADD DP3 DP4 DPH DST EX2 LG2 MUL SGE SLT FLR MAX MIN RCP RSQ MOVA MOV, les formes inversées, CMP, MAD, et le contrôle de flot : IFU IFC CALL CALLC CALLU LOOP JMPC JMPU BREAK BREAKC END), l'adressage relatif, les variables booléennes et entières. Tous les sommets d'un ordre passent ensemble dans numpy ; si un branchement dépend d'une comparaison qui n'est pas la même pour tous, on les rejoue un par un. Les sorties d'un même programme avec les mêmes entrées et constantes sont mémorisées (l'interface redessine les mêmes éléments d'une image à l'autre).
4. **y2r:u** : la conversion de la vidéo de l'écran-titre est faite pour de bon (`services/stubs.py`).

**Trois choses que seul le jeu en marche pouvait dire**, et que les documents n'avaient pas :

- Les lignes du tampon de rendu sont rangées **à l'envers** : un point de hauteur y (après le viewport) va à la ligne `hauteur du tampon - 1 - y`. C'est pour cela que le transfert de l'écran du haut part de `0x1F08C800`, 112 lignes (0x1C000 octets) après le début du tampon : il lit les 400 dernières lignes de 512.
- Dans une **texture**, la ligne 0 de la mémoire est le haut de l'image (v = 1).
- Dans une **liste**, quand le bit « consécutif » est levé, la première donnée va au registre de l'en-tête et les suivantes aux registres d'après (+1, +2…). Le code de comptage de `gsp.py` les attribuait à partir du même registre, ce qui ne change rien aux totaux mais fausserait tout état.

**Ce qu'on obtient** (`python banc/run.py --secondes 25 --dessiner --dessiner-un-sur 4 --images-chaque 1 --appuis "14:START,16:A,18:A"`, dans `local/analyse/banc/images/`) : de 9 s à 15 s du banc, l'écran-titre de Pokémon X (la vidéo, le logo, « APPUYEZ SUR START ») ; à 16 s, le menu avec la sauvegarde du joueur (« Continuer », badges, Pokédex, temps de jeu, « Cadeau Mystère », « Compétitions Live ») et l'écran du bas avec « Ver. 1.5 » ; à partir de 19 s, le terrain : l'écran du haut montre le palais Chaydeuvre en entier (façade, grille dorée, lampadaires, un PNJ et le joueur, avec les contours), l'écran du bas le panneau du Système de Perfectionnement Virtuel. Le terrain chaîne ses listes de commandes par les registres de saut du processeur de commandes (0x238-0x23D), jusqu'à 2 180 sauts dans une seule commande, en alternant un tampon d'état et un tampon de dessins ; `services/gsp.py: follow_jumps` les suit (jusqu'à 20 000). Avant le 16/10, le banc ne les suivait pas, puis s'arrêtait à 64 : les journaux plus anciens sont faux pour toute liste qui saute.

**Les options.** `--dessiner` exécute les listes ; l'état des registres est suivi dans ce mode seulement, et les ordres de dessin ne sont rastérisés que dans la fenêtre `--dessiner-de S` / `--dessiner-jusqu-a S` (temps du banc). `--dessiner-un-sur N` ne dessine qu'une image sur N : les autres ne sont ni dessinées ni transférées à l'écran (le jeu refait chaque image de zéro, donc l'image montrée est complète) ; les PNG prennent le dernier transfert fait. `--images-chaque S` règle le rythme des PNG. Sans `--dessiner`, rien n'est rastérisé : l'exécution reste aussi rapide qu'avant, aux transferts près.

**Les temps** (même machine, 25 s de banc, `--appuis "14:START,16:A,18:A"`) : 98 s de PC sans `--dessiner` ; 126 à 135 s avec `--dessiner --dessiner-un-sur 4` (dont 40 s dans les listes PICA, pour 5 340 dessins sur 21 392 et 41 millions de fragments). Dessiner toutes les images multiplie la part PICA par `N`.

**Ce qui est faux ou manquant**, par registre :

| Registres | Ce qui manque |
| --- | --- |
| `0x08F`, `0x1C0`-`0x1D9` (éclairage) | fait le 16/10 d'après le rendu logiciel d'Azahar (tables, modes 0 à 8, spot, Fresnel, relief, ombre), vérifié sur des données fabriquées, et tourne sur les vraies listes du terrain (172 ordres), sans comparaison à une console. Le sens exact de `0x8F` n'est pas vérifié ; les tables sont lues sur 4096 (Azahar : 4095 ?) |
| `0x1E0`-`0x1FF` (gaz) | le gaz (le brouillard est fait) |
| `0x80` bit 10, `0xA8`-`0xAF` (texture 3) | textures procédurales |
| `0x84`, `0x94`, `0x9C` et les niveaux 1 à 5 | niveaux de détail : seul le niveau 0 est lu, le décalage de détail est ignoré |
| `0x8E`, `0x96`, `0x9E` et le type de texture | cubes, projections, ombres : seule la texture à deux dimensions |
| `0x100` bits 0-1 | modes gaz et ombre (mélange alpha, opérations logiques et pochoir sont faits) |
| `0x229`, `0x252`-`0x254`, `0x280`-`0x2AD` | shaders de géométrie : modes point et primitive fixe, EMIT et SETEMIT faits sur données fabriquées seulement (aucune capture du jeu n'a encore `0x229` à 2) ; mode primitive variable non fait. Le mode 3 de `0x25E` sans géométrie est une simple liste de triangles |
| `0x232` index 15 | sommets envoyés un par un par les attributs fixes (mode immédiat) |
| `0x40` | l'élimination des faces : le sens des faces n'est vérifié que sur des aplats ; à contrôler sur un modèle 3D |
| `0x11B` | tampons en blocs de 32 × 32 (le jeu ne les demande pas dans ce qu'on a vu) |
| écran du haut | la 3D relief : seule l'image de gauche existe |
| ensemble | les flottants sont des float32, pas des float24 ; LITP ne fait rien ; une texture introuvable rend du magenta. Faits le 16/10 : découpage aux plans proche et lointain, sens des faces vérifié sur le terrain (mode 2 garde l'antihoraire), texture projetée (type 3 de `0x83`), profondeur relue comme texture |

**Le rejeu.** `PICA_ENREGISTRER=f.pkl PICA_ENREGISTRER_DE=24,28 PICA_ENREGISTRER_IMAGES=N` avec `--dessiner --dessiner-de 9999` : le banc ne dessine rien (donc va vite), mais photographie à chaque instant demandé le tas linéaire, la mémoire vidéo et l'état du GPU, puis note les commandes de gsp pendant N images. `python banc/pica/replay.py f.pkl --sortie DOSSIER` les rejoue en une seconde environ et écrit les deux écrans après chaque transfert. La photo est celle du début de l'enregistrement.

**Vers le portage.** `python banc/pica/export_capture.py fichier.pkl` écrit la même capture au format neutre `.picacap` (décrit dans `portage/README.md`), que le portage Rust rejoue et compare au rendu numpy.

**La mise au point.** Quatre variables d'environnement : `PICA_LISTES=dossier` (les listes de commandes brutes des images dessinées, `PICA_LISTES_N` : combien), `PICA_TRACE=fichier` (les premières écritures de registres, `PICA_TRACE_N` : combien), `PICA_DEBUG=fichier` (une ligne par ordre de dessin : viewport, ciseaux, tampon) et `PICA_CIBLES=dossier` (les tampons de rendu entiers, en PNG, quand ils sont rendus à la mémoire).

**La vidéo de l'écran-titre** passe par `y2r:u` : 422 conversions en 25 s, faites ; on la voit sur les premières images du titre (les éclats de lumière gris, avant le fondu vers le logo noir).
