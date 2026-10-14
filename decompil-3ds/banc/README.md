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
python banc/tests.py                                 # aussi lancé par python outils/tests.py
```

Il lit dans `local/` (jamais versionné) : `extrait/maj/exefs/code.bin` et `exheader.bin`, les deux `.cxi` déchiffrés de `dump/` (les romfs), le fichier `config` de `cfg`, la police partagée, la sauvegarde. Il écrit dans `local/analyse/banc/` :

- `journal.txt` : chaque appel système et chaque requête IPC, avec l'heure du banc, le fil, le service, l'en-tête, le nom de la commande, la fonction du jeu qui envoie et celle qui l'appelle, et ce qui a été répondu (`réel`, `simplifié` ou `factice`) ; les fils créés, les modules `.cro` chargés et déchargés, les paliers, et à l'arrêt les registres et la pile ;
- `resume.md` : le palier atteint, la raison de l'arrêt, l'état de chaque fil, les dernières requêtes, les comptes par commande, les fichiers ouverts, les modules, l'affichage, le son, les écarts ;
- `ecran-haut.png`, `ecran-bas.png` : la dernière image annoncée par le jeu, lue telle quelle en mémoire vidéo (voir « l'image » plus bas) ;
- `archives/` : la copie de travail de la sauvegarde et des données supplémentaires. L'original de `local/extrait/` n'est jamais touché.

**L'horloge.** Le banc a son propre temps : chaque appel système compte 2 µs, chaque tranche de 200 000 instructions 0,8 ms, et quand plus aucun fil n'est prêt le temps saute à la prochaine échéance (réveil, minuterie, fin d'image). Une exécution est reproductible. Les fins d'image arrivent toutes les 16,7 ms de ce temps-là. Comptez 3 secondes de console par minute de PC pendant la vidéo de l’écran-titre (décodée par le processeur), 8 sur le terrain : unicorn compte les instructions une à une.

**L'ordonnanceur.** Le fil prêt le plus prioritaire tourne ; un fil plus prioritaire qui devient prêt passe devant à la sortie de l'appel système suivant ; au bout d'une tranche, le fil qui attend depuis le plus longtemps passe, quelle que soit sa priorité. C'est ce qui tient lieu des deux cœurs : un fil qui calcule longtemps n'arrête pas les autres.

## Les paliers

| Palier | Ce qu'il faut | Repère |
| --- | --- | --- |
| P1 | `entry` tourne, `srv:` et `APT:U` répondent | la réponse à GetLockHandle |
| P2 | les neuf réponses d'APT, `main`, puis `game_init_systems` | crochets sur `0x106138` et `0x107cbc` |
| P3 | le romfs ouvert et lu, `static.crs` et `static.crr` donnés à `ro`, un premier `.cro` chargé et lié | |
| P4 | la boucle principale tourne | trois passages à `0x106710` |
| P5 | des listes de commandes PICA partent par la file de `gsp::Gpu` | la commande 1 de la file |
| P6 | la première image | décrit plus bas, pas fait |

## Les services, un par un

| Service | Fichier | Ce que fait le banc |
| --- | --- | --- |
| `srv:` | `services/srv.py` | **réel** : RegisterClient, EnableNotification (un vrai sémaphore), GetServiceHandle, Subscribe, ReceiveNotification ; aucune notification publiée |
| `APT:U` | `services/apt.py` | **réel pour le démarrage** (verrou, deux signaux, la boîte aux lettres des paramètres, GlanceParameter, ReceiveParameter, AppletUtility, la police partagée dans un vrai bloc) ; **simplifié** ensuite : HOME, applets, veille et sortie répondent 0 sans rien lancer |
| `fs:USER`, fichier, dossier | `services/fs.py` | **réel** : les deux romfs (chemin 0 : jeu de base, chemin 5 : mise à jour), l'icône de l'exefs, la sauvegarde dans un dossier du PC, les données supplémentaires et la carte SD dans des dossiers vides au départ, toutes les commandes d'un fichier et d'un dossier |
| `gsp::Gpu` | `services/gsp.py` | **simplifié** : la mémoire partagée, la file de commandes vidée à chaque TriggerCmdReqQueue avec l'interruption de fin de chaque commande, les fins d'image (interruptions 2 et 3) toutes les 1/60 s ; remplissages, transferts mémoire et copies faits pour de bon ; listes PICA lues et comptées, pas exécutées ; transferts vers l'écran notés, pas faits |
| `dsp::DSP` | `services/dsp.py` | **simplifié** : le démarrage du son complet (les 15 adresses dans le tuyau 2, la conversion des adresses), puis une trame vide toutes les 4,9 ms ; le décodeur AAC répond « réussi » sans décoder |
| `hid:USER` | `services/small.py` | **simplifié** : une vraie page partagée, mise à jour à chaque fin d'image ; les boutons viennent de `--appuis` |
| `cfg:u` | `services/small.py` | **réel** : les blocs du fichier `config` de la console, GenHashConsoleUnique calculé comme le module |
| `ptm:u` | `services/small.py` | **réel** pour GetStepHistory (des zéros écrits dans le tampon) |
| `err:f` | `services/small.py` | **réel côté banc** : la fiche d'erreur est décodée et le banc s'arrête |
| `ldr:ro` | `services/ldr_ro.py` | **réel** : Initialize, LoadCRR, LoadExeCRO et UnloadCRO, le travail fait par `outils/cro_loader.py` (classe `Linker`), branché sur la mémoire du jeu (miroir, en-tête converti, mots du code principal remplis) |
| `y2r:u` | `services/stubs.py` | **factice** avec un vrai signal de fin de conversion (l'écran-titre en dépend) ; rien n'est converti |
| `ndm:u`, `frd:u`, `boss:U`, `ac:u`, `cecd:u`, `http:C`, `ssl:C`, `soc:U`, `ir:USER`, `mic:u`, `cam:u`, `nwm::UDS` | `services/stubs.py` | **factice** : 0 et des mots à zéro (liste d'amis vide, pas de réseau) |

## Ce qui manque

- **Le dessin.** Le banc ne fait pas le travail du processeur graphique : les listes de commandes PICA sont comptées, pas exécutées. Voir plus bas ce qu'il faudrait pour la première image.
- **Le son.** Les trames sont rendues vides ; le format des voix et le décodeur AAC sont à écrire (contrat de dsp, partie 7, point 5).
- **APT au-delà du démarrage** : le bouton HOME, la veille, les applets (clavier, erreur) ne mènent nulle part.
- **Les données supplémentaires de la console** : le format des fichiers de `local/extrait/sd-…/extdata/` n'est pas relu ; le jeu crée les siennes, vides.
- **L'archive `0x2345678A`** (le contenu d'un autre titre) : refusée. Le jeu le tolère au démarrage.
- **Les entrées** : seulement des boutons à des heures fixées ; ni l'écran tactile, ni le pad circulaire, ni de fenêtre.
- **La vitesse** : de 10 à 20 fois plus lent que la console. C'est le prix d'unicorn ; c'est aussi ce qui disparaîtra avec la recompilation.

## L'image (palier 6), sans moteur graphique

Ce que le jeu fait pour montrer une image, vu dans le journal : il dessine dans un tampon de rendu en tuiles (par exemple `0x1F08C800`, 256 × 512 en RGBA8) par des listes de commandes PICA, demande un transfert vers l'écran (commande 3 de la file : vers `0x1F300000`, 240 × 400 en RGB8), puis annonce l'image dans la zone des tampons d'écran ; à la fin d'image suivante la console l'affiche. Pour voir la première image, il faudrait dans l'ordre :

1. **Exécuter les listes de commandes PICA** : décoder les écritures de registres (déjà fait pour les compter), tenir l'état du processeur graphique (tampons de couleur et de profondeur, attributs de sommets, textures, combinateurs de textures, mélange), faire tourner les programmes de sommets du PICA, et rastériser les triangles dans le tampon de rendu. C'est le gros morceau : un moteur de rendu, ou une traduction vers une API du PC.
2. **Faire les transferts vers l'écran** (commande 3) : passer des tuiles 8 × 8 rangées en ordre de Morton à des lignes, convertir le format (RGBA8 vers RGB8 ici), réduire si demandé. C'est quelques dizaines de lignes.
3. **Présenter** : à chaque fin d'image, prendre l'adresse, la largeur de ligne et le format annoncés (déjà fait par `services/gsp.py`), tourner l'image d'un quart de tour, l'envoyer à une fenêtre. `run.py` le fait déjà sous forme de fichier PNG ; tant que 1 et 2 manquent, on n'y voit que ce que les remplissages ont laissé.
4. **La vidéo de l'écran-titre** passe en plus par `y2r:u` (YUV vers RGB) : à écrire pour la voir.
