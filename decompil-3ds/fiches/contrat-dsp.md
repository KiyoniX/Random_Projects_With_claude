# Contrat de `dsp::DSP` : ce que Pokémon X échange avec le processeur de son

Ce document dit, pour le son, ce qu'il faudra faire à la place de la console le jour où le jeu tournera sur PC. Il a trois objets : les 13 commandes que le jeu envoie au service `dsp::DSP`, la séquence de démarrage du son, et la boucle qui tourne ensuite, où le jeu et le processeur de son (le DSP) se parlent **sans passer par une commande**, par deux tuyaux et une mémoire partagée.

Document du 14 octobre 2026. Chaque commande est lue de deux côtés qui ne se connaissent pas : dans le code du jeu (la fonction qui l'envoie) et dans le module `dsp` de la console (la fonction qui la reçoit). Une troisième voie s'y ajoute pour le démarrage et l'arrêt : le code du jeu a été exécuté dans un émulateur, et les mots qu'il a écrits ont été relevés. Tout reste **statique** : rien n'a été observé sur la console.

À lire d'abord : [sm](sm.md) pour le vocabulaire (poignée, en-tête de commande, tampon du fil), [dsp](dsp.md) pour le module, et la partie `dsp::DSP` de [pokemon-x-services](pokemon-x-services.md). Les adresses en `0x1…` à six chiffres sont celles du code du jeu (mise à jour, chargée à `0x00100000`), sauf quand le texte dit « dans le module ».

## Tableau de synthèse

| En-tête | Commande | Fonction du jeu | Fonction du module | Lecture | Exécutée | Quand le jeu l'envoie |
| --- | --- | --- | --- | --- | --- | --- |
| `0x001100C2` | LoadComponent | `0x1342fc` | `0x105dc0` | des deux côtés | oui | démarrage, retour de veille ou du menu HOME |
| `0x00150082` | RegisterInterruptEvents | `0x160038` | `0x106998` | des deux côtés | oui | démarrage et arrêt, pour le canal 2 (son) et le canal 3 (AAC) |
| `0x00160000` | GetSemaphoreEventHandle | `0x160004` | `0x106984` | des deux côtés | oui | démarrage |
| `0x00170040` | SetSemaphoreMask | `0x15ffcc` | `0x106230` | des deux côtés | oui | démarrage |
| `0x000D0082` | WriteProcessPipe | `0x16f904` | `0x106794` | des deux côtés | oui | démarrage, arrêt, et chaque message au décodeur AAC |
| `0x00070040` | SetSemaphore | `0x16f888` | `0x103d4c` | des deux côtés | oui | deux fois au démarrage |
| `0x001000C0` | ReadPipeIfPossible | `0x16f94c` | `0x1037f0`, `0x10366c`, `0x103698` | des deux côtés | oui | démarrage (deux fois), et chaque réponse du décodeur AAC |
| `0x000C0040` | ConvertProcessAddressFromDspDram | `0x16f9b4` | `0x1069ec` | des deux côtés | oui | trente fois au démarrage |
| `0x00020040` | RecvDataIsReady | `0x16f8c0` | `0x103b4c` | des deux côtés | oui | arrêt |
| `0x00010040` | RecvData | `0x16f9f0` | `0x1040a8` | des deux côtés | oui | arrêt |
| `0x00120000` | UnloadComponent | `0x124148` | `0x1060f4` | des deux côtés | oui | arrêt, veille, menu HOME |
| `0x00130082` | FlushDataCache | `0x17d9ec` | `0x106038` | des deux côtés | oui | avant de donner un tampon au DSP |
| `0x00140082` | InvalidateDCache | `0x1ec658` | `0x1065bc` | des deux côtés | oui | après chaque bloc décodé par le DSP |

Bilan : **13 commandes lues des deux côtés, 0 d'un seul côté, 0 pas lue.** « Exécutée » veut dire que la fonction d'envoi du jeu a tourné dans l'émulateur et que ses mots ont été relevés (`local/analyse/contrat-dsp/emu_start.log`).

Les 20 autres commandes du service (ReadPipe, GetPipeReadableSize, SendData, les réglages du codec…) ne sont envoyées par aucune fonction du jeu, d'après l'inventaire.

**Le fait le plus utile pour le portage.** Une fois le son démarré, la boucle de son n'envoie **aucune** commande. À chaque trame elle attend un signal, lit et écrit dans la mémoire partagée, puis déclenche un autre signal. Répondre aux 13 commandes ne suffit donc pas : il faut aussi tenir le rôle du programme du DSP, c'est-à-dire lire la mémoire partagée, y écrire l'état des voix, et déclencher le signal de fin de trame.

## Partie 1 : qui parle, dans le jeu

Le code du jeu garde les noms de ses classes (ce sont les chaînes qui servent au langage C++ à reconnaître un type). On y lit quatre étages, du plus haut au plus bas :

| Étage | Preuve | Exemples de fonctions | Ce qu'il fait |
| --- | --- | --- | --- |
| Le jeu | les noms `xy_snd::VoicePlayer`, `xy_snd::EnvSEManager`, `xy_snd::SELevelManager`, `xy_snd::BGMLevelManager` | `0x115208` | Choisit les deux fichiers (`rom:/sound/xy_sound.bcsar`, `rom:/sound/dspaudio.cdc`) et crée le système de son |
| La bibliothèque de Game Freak | le nom `gfl::snd::SoundSystem` ; la table de fonctions `0x59b9b8`, que `0x11deb0` pose dans l'objet, porte ce nom | `0x11deb0` (construction), `0x12ac10` (ouverture du DSP), `0x38ed44` (destruction) | Enveloppe la bibliothèque du constructeur |
| La bibliothèque de son du constructeur | une soixantaine de noms `nw::snd::…`, dont `nw::snd::internal::driver::SoundThread` et `nw::snd::aac::internal::AacDecoder` | `0x17f1f0` (le fil de son), `0x31927c` (le décodeur AAC) | Joue les sons de l'archive, fait tourner le fil de son |
| Les fonctions de bas niveau | pas de nom : ce ne sont pas des classes. Reconnues à ce qu'elles font | `0x148a40`, `0x148bc4`, `0x18b504` (la trame) ; `0x1340e8`, `0x1341b4`, `0x15fdf8` à `0x160074` (le service) | Parlent à `dsp::DSP`, tiennent la mémoire partagée |

**La bibliothèque du constructeur commence donc à `nw::snd`.** Au-dessus, `gfl::snd::SoundSystem` appartient au studio, et `0x115208` est le code propre de Pokémon X. C'est `0x115208` qui est appelée au démarrage : `game_init_systems` (`0x107cbc`) appelle `0x10cd5c`, qui l'appelle. Les deux étages du bas viennent du kit de développement ; le code ne dit pas leur nom, je les appelle ici « couche trame » et « couche service ».

Une seconde entrée existe : `0x3f90f4`, qui ouvre le micro (`mic:u`) puis `dsp::DSP` et la couche trame. Elle n'est pas sur le chemin du démarrage et n'a pas été lue plus loin.

**Les variables de la couche service** (toutes relevées dans les fonctions citées) :

| Adresse | Contenu |
| --- | --- |
| `0x5d4018` | 1 quand un retour de veille est attendu |
| `0x5d4019` | 1 quand le composant est chargé : c'est l'octet rendu par LoadComponent. Lu par `0x17d9dc`, appelée de 44 endroits |
| `0x5d401a` | 1 quand le composant a été déchargé pour une veille |
| `0x5d401c`, `0x5d401e` | le masque de programme et le masque de données envoyés à LoadComponent |
| `0x5d4020` | l'adresse où lire la poignée de la session (vaut `0x5d4028`) ; nulle tant que le service n'est pas ouvert |
| `0x5d4024` | un bit par signal inscrit : le bit numéro « type + canal » |
| `0x5d402c`, `0x5d4028` | la poignée de `dsp::DSP` et sa copie |
| `0x5d4030`, `0x5d4034` | l'adresse et la taille du composant, gardées pour le recharger |
| `0x625fc0`, `0x625fe0`, `0x626000` | trois tables de 8 fonctions : à appeler avant un déchargement, après un rechargement, et une troisième dont l'appelant (`0x10f2ac`) n'a pas été lu |

Tant que `0x5d4020` est nul, les enveloppes de la couche service n'envoient rien et rendent `0xC8A0A7F8` (`0xC8A0A7FC` pour celle de LoadComponent, qui refuse aussi quand l'octet `0x5d4019` vaut déjà 1).

## Partie 2 : la séquence de démarrage du son

Voici, dans l'ordre, tout ce qui part vers `dsp::DSP` entre l'ouverture du service et le moment où le son tourne. La colonne « Mots de la requête » vient de l'émulation, avec un composant factice de `0x35378` octets placé à `0x14000000`.

| N° | Qui | Ce qui se passe | Mots de la requête |
| --- | --- | --- | --- |
| 1 | `0x1340e8` | Ouvre `dsp::DSP` par `srv:`, range la poignée, vide les trois tables de fonctions | (GetServiceHandle, voir l'inventaire) |
| 2 | `0x12ac10` | Ouvre `rom:/sound/dspaudio.cdc`, demande sa taille, réserve un tampon, lit le fichier entier | (commandes de `fs`) |
| 3 | `0x1341b4` | **LoadComponent**, masques `0xFF` et `0xFF` | `001100C2 00035378 000000FF 000000FF 0035378A 14000000` |
| 4 | `0x148a40` | Crée un signal (`svcCreateEvent`, type 1) : ce sera le signal de fin de trame | |
| 5 | `0x15fef4` | **RegisterInterruptEvents**, type 2, canal 2, avec ce signal | `00150082 00000002 00000002 00000000` puis la poignée |
| 6 | `0x146c98` | **GetSemaphoreEventHandle** : le jeu reçoit le signal par lequel il rendra la main au DSP | `00160000` |
| 7 | `0x146c6c` | **SetSemaphoreMask**, valeur `0x2000` | `00170040 00002000` |
| 8 | `0x148bc4` | **WriteProcessPipe**, canal 2, 4 octets : le mot `0x0000`, « démarre » | `000D0082 00000002 00000004 00010402` puis l'adresse du tampon |
| 9 | `0x148bc4` | **SetSemaphore**, valeur `0x4000` | `00070040 00004000` |
| 10 | `0x148bc4` | Attend le signal de l'étape 4, sans limite de temps, puis l'efface | (`svcWaitSynchronization1`, `svcClearEvent`) |
| 11 | `0x148bc4` | **ReadPipeIfPossible**, canal 2, sens 0, 2 octets : un nombre *N* | `001000C0 00000002 00000000 ….0002` |
| 12 | `0x148bc4` | **ReadPipeIfPossible**, canal 2, sens 0, *N* × 2 octets : *N* adresses | `001000C0 00000002 00000000 0000001E` (pour *N* = 15) |
| 13 | `0x148bc4` | **ConvertProcessAddressFromDspDram**, deux fois par adresse : l'adresse, puis l'adresse plus `0x10000` | `000C0040 0000BFFF`, `000C0040 0001BFFF`, etc. |
| 14 | `0x148bc4` | **SetSemaphore**, valeur `0x4000`, une seconde fois | `00070040 00004000` |
| 15 | `0x148bc4` | Écrit le mot 4 dans le compteur de trame de la première zone, puis déclenche le signal reçu à l'étape 6 | (`svcSignalEvent`) |
| 16 | `0x124d70` | Fait les premiers réglages du DSP dans la mémoire partagée, puis inscrit ses trois fonctions de veille dans les tables | aucune commande |

Le fil de son démarre ensuite (partie 3) et le décodeur AAC ouvre le canal 3 quand une musique est lancée (partie 5).

### D'où vient le composant

Le jeu a **trois** composants à sa portée, et n'en charge qu'un :

| Composant | Où | Taille | Segments | Signature | Chargé par le jeu ? |
| --- | --- | --- | --- | --- | --- |
| `rom:/sound/dspaudio.cdc` | le romfs de la cartouche | `0x35378` | 6, dont 3 de programme | vérifiée dans [dsp](dsp.md) | **oui** |
| le composant par défaut | dans le code du jeu, à `0x5dbc88` | `0xC288` | 5, dont 2 de programme | bonne (même clé, même contrôle) | non |
| `rom:/m/dps.cdc` | le romfs, à côté des vidéos | `0x34DB4` | 6, dont 3 de programme | bonne | aucun nom ne le désigne, ni dans le code ni dans les `.cro` |

Le choix se lit dans `0x115208` : elle pose 1 dans l'octet `+0x18` de sa fiche de réglages et l'adresse de la chaîne `rom:/sound/dspaudio.cdc` (`0x551af4`) dans le mot `+0x1C`. `0x12ac10` teste cet octet : à 1 elle lit le fichier, à 0 elle saute à `0x13422c`, qui envoie le composant de `0x5dbc88`. Dans les deux cas les masques sont `0xFF` et `0xFF`.

Les trois composants contiennent la même liste de 15 adresses (plus bas) : ils rangent leur mémoire partagée au même endroit.

### Ce que le jeu écrit dans le tuyau 2 au démarrage

Quatre octets, par WriteProcessPipe :

| Octets | Qui les écrit | Contenu |
| --- | --- | --- |
| 0 et 1 | le jeu | un mot : 0 « démarre », 2 « redémarre après une veille », 1 « arrête », 3 « arrête pour une veille » |
| 2 et 3 | **personne dans le jeu** | ce qui traînait sur la pile. Le module `dsp` y écrit au passage son mot `0x109002` : 2 sur une New 3DS, 0 sinon ([dsp](dsp.md), partie 6) |

L'émulation le montre : à l'arrêt, les octets 2 et 3 partis du jeu contenaient un reste de poignée (`3A 5E`).

### Ce que le jeu attend d'y lire

Sur la console, c'est le programme du DSP qui répond. Le jeu attend d'abord le signal de l'étape 4, puis lit sans vérifier combien d'octets sont arrivés :

1. un mot de 16 bits : le nombre d'adresses, *N* ;
2. *N* mots de 16 bits : des adresses dans la mémoire de données du DSP, comptées en mots.

Le jeu a de la place pour **15** adresses : son tableau de destinations a 15 cases, le tampon où il lit les adresses a 16 mots. Avec *N* plus grand que 15, il lirait des destinations au hasard ; avec *N* plus petit, les dernières zones resteraient sans adresse.

Pour chaque adresse il envoie deux ConvertProcessAddressFromDspDram : une avec l'adresse, une avec l'adresse plus `0x10000`. Il obtient ainsi **deux** adresses par zone, une dans chaque moitié de la mémoire partagée (« zone A » et « zone B » dans la suite).

**La liste que le composant envoie.** Elle se trouve telle quelle dans le premier segment de programme du composant (à l'adresse `0x84` mots dans `dspaudio.cdc`, `0x20` dans le composant par défaut, `0x5C` dans `dps.cdc`) : quinze mots à la suite, tous entre `0x8000` et `0xBFFF`, les mêmes dans les trois fichiers. Le nombre 15 lui-même n'a pas été retrouvé dans le composant : il vient du tableau du jeu et de 3dbrew, qui compte 15 structures.

| Rang | Adresse (mots) | Zone A | Zone B | Place jusqu'à la zone suivante | Nom chez 3dbrew |
| --- | --- | --- | --- | --- | --- |
| 0 | `0xBFFF` | `0x1FF57FFE` | `0x1FF77FFE` | 2 | Frame count |
| 1 | `0x9E92` | `0x1FF53D24` | `0x1FF73D24` | `0x1200` | Input configurations |
| 2 | `0x8680` | `0x1FF50D00` | `0x1FF70D00` | `0x120` | Input status |
| 3 | `0xA792` | `0x1FF54F24` | `0x1FF74F24` | `0x300` | Input ADPCM coefficients |
| 4 | `0x9430` | `0x1FF52860` | `0x1FF72860` | `0xC4` | DSP configuration |
| 5 | `0x8400` | `0x1FF50800` | `0x1FF70800` | `0x20` | DSP status |
| 6 | `0x8540` | `0x1FF50A80` | `0x1FF70A80` | `0x280` | Output samples |
| 7 | `0x9492` | `0x1FF52924` | `0x1FF72924` | `0x1400` | Intermediate mix samples |
| 8 | `0x8710` | `0x1FF50E20` | `0x1FF70E20` | `0x1A40` | Compressor table |
| 9 | `0x8410` | `0x1FF50820` | `0x1FF70820` | `0x260` | DSP debug statistics |
| 10 | `0xA912` | `0x1FF55224` | `0x1FF75224` | `0x200` | Unknown coefficients |
| 11 | `0xAA12` | `0x1FF55424` | `0x1FF75424` | `0x180` | Unknown coefficients |
| 12 | `0xAAD2` | `0x1FF555A4` | `0x1FF755A4` | `0x300` | Unknown coefficients |
| 13 | `0xAC52` | `0x1FF558A4` | `0x1FF758A4` | `0x14` | Surround sound biquad filter 1 |
| 14 | `0xAC5C` | `0x1FF558B8` | `0x1FF758B8` | (dernière) | Surround sound biquad filter 2 |

Les adresses des colonnes A et B sont celles que rend la formule de la commande 12 quand chaque bloc est à sa place (`0x1FF40000` + adresse × 2). 3dbrew donne les deux moitiés à `0x1FF50000` et `0x1FF70000`, `0x8000` octets chacune : toutes les adresses du tableau y tombent.

**Pour un portage**, la réponse à produire sur le tuyau 2 est donc, en octets : `0F 00`, puis `FF BF 92 9E 80 86 92 A7 30 94 00 84 40 85 92 94 10 87 10 84 12 A9 12 AA D2 AA 52 AC 5C AC`. Le portage est libre de mettre ses zones ailleurs : le jeu ne connaît que ce que ConvertProcessAddressFromDspDram lui rend. Ce qui compte est que les zones aient la taille attendue et que le signal de l'étape 4 soit déclenché une fois la réponse prête.

### Ce que le jeu fait des adresses

Il les range dans son état de la couche trame, à `0x6424f4` (positions relevées dans `0x148bc4` et confirmées par l'émulation) :

| Position | Contenu |
| --- | --- |
| `+0x0000` | la poignée du signal de fin de trame (créé par le jeu) |
| `+0x0004` | la poignée du signal du sémaphore (reçue du module) |
| `+0x0008` | un verrou |
| `+0x0018` | `0x1080` octets : la copie de sauvegarde pour la veille |
| `+0x1098` | compteur de trame : adresse en zone A, adresse en zone B |
| `+0x10A0` | réglages du DSP : A, B |
| `+0x10A8` | état du DSP : A, B |
| `+0x10B0` | réglages des voix : 24 adresses en zone A (une tous les `0xC0` octets), puis 24 en zone B |
| `+0x1170` | état des voix : 24 + 24 adresses, une tous les `0x0C` octets |
| `+0x1230` | coefficients ADPCM : 24 + 24 adresses, une tous les `0x20` octets |
| `+0x12F0` | mixage intermédiaire : A, A + `0xA00`, B, B + `0xA00` |
| `+0x1300`, `+0x1308`, `+0x1310` | échantillons de sortie, table du compresseur, statistiques : A et B chacun |
| `+0x1318` | 1 quand le son tourne |
| `+0x131A` | le compteur de trame du jeu (16 bits) |
| `+0x131C`, `+0x131E` | la zone où lire et la zone où écrire : 0 pour A, 1 pour B |
| `+0x1584` à `+0x15A8` | les zones 10 à 14 : A et B chacune |

La fin de la séquence (étape 15) laisse le compteur du jeu à 5, les deux numéros de zone à 1, et le mot 4 dans le compteur de la zone A. 3dbrew dit la même chose : « The DSP firmware only responds if the first frame count is 4 ».

## Partie 3 : la boucle de son

### Le fil

Le fil de son est celui de la bibliothèque `nw::snd`. Son entrée est `0x17f1d8`, qui se prolonge dans la boucle `0x17f1f0` ; il est créé par `0x172ae4`. Sa priorité est 4 et sa pile fait `0x4000` octets : ce sont les valeurs que `0x115208` et `0x11deb0` posent dans les réglages et que la chaîne `0x1268bc`, `0x1372f8`, `0x1486e4`, `0x16383c` transmet. Je les ai suivies à la lecture, pas observées.

Un tour de boucle :

| Ordre | Fonction | Ce qu'elle fait |
| --- | --- | --- |
| 1 | `0x186150` (ou `0x18b2a4`) | Attend le signal de fin de trame : `0x18b7cc` attend sans limite, `0x18b744` attend au plus 9 776 000 nanosecondes. Puis efface le signal |
| 2 | `0x18b63c` | Relit la mémoire partagée (tableau plus bas) |
| 3 | les fonctions inscrites aux mots `+0x28` et `+0x20` de l'objet du fil | Le travail de la bibliothèque pour cette trame : avancer les séquences, régler les voix. Elles écrivent directement dans la mémoire partagée |
| 4 | `0x186270` | Lit l'octet `0x1FF810C0` de la page partagée de la console et le range dans les réglages du DSP (`0x172ad4`), puis appelle `0x18b504`. Je le lis comme « casque branché ou non », sans l'avoir recoupé |
| 5 | `0x18b504` | Applique les réglages des 24 voix encore en attente, traite le mixage intermédiaire, écrit le compteur de trame, **déclenche le signal du sémaphore** |

Aucune de ces étapes n'envoie de commande à `dsp::DSP`.

### Ce que le jeu écrit

Il n'y a pas de grande copie à chaque trame. Chaque réglage est une petite fonction qui écrit un champ dans la zone d'écriture courante et lève un bit dans un mot « à relire » en tête de la structure. Deux exemples lus : `0x1796e0` écrit le mot `+0x34` des réglages d'une voix et lève le bit `0x40000` de son mot `+0x00` (3dbrew met à la position 52 le « Rate multiplier », et à la position 0 les « Dirty flags ») ; `0x172ad4` écrit le mot de 16 bits `+0x1A` des réglages du DSP et lève le bit `0x10000000`.

| Zone | Taille d'après le code du jeu | Sens | Ce que le jeu en fait |
| --- | --- | --- | --- |
| 0, compteur de trame | 2 octets | écrit et relu | Écrit son compteur à chaque trame, dans une zone puis dans l'autre |
| 1, réglages des voix | 24 × `0xC0` = `0x1200` | écrit | Un champ à la fois, plus le mot « à relire » |
| 2, état des voix | 24 × `0x0C` = `0x120` | lu | Lu à chaque trame par `0x18f69c` |
| 3, coefficients ADPCM | 24 × `0x20` = `0x300` | écrit | Pas lu en détail |
| 4, réglages du DSP | au moins `0xC4` (le dernier champ écrit est un mot à `+0xC0`) | écrit | Un champ à la fois, plus deux mots « à relire » (`+0x00` et `+0xC0`) |
| 5, état du DSP | le jeu lit le mot `+2` ; il sauvegarde `0x1080` octets à partir d'ici | lu | Le mot `+2` est ajouté à un compteur (3dbrew : « Number of dropped frames ») |
| 6, échantillons de sortie | `0x280` | lu | Recopiés par `0x18d898` si une capture est demandée |
| 7, mixage intermédiaire | 2 × `0xA00` = `0x1400` | lu et écrit | Chaque moitié est passée aux effets comme 4 tampons de `0x280` octets |
| 8, table du compresseur | adresse rangée | | Usage pas lu |
| 9, statistiques | `0x260` | lu | Recopiées à `+0x1324` de l'état, à chaque trame |
| 10 à 14 | adresses rangées | | Usage pas lu |

Ces tailles concordent avec la colonne « place jusqu'à la zone suivante » du tableau des adresses, qui vient, elle, du composant : `0x1200`, `0x120`, `0x300`, `0xC4`, `0x280`, `0x1400`, `0x260`. Et avec 3dbrew là où il donne une taille : 192 octets × 24, 12 × 24, 32 × 24, 640, 5 120.

Le format du contenu (les champs d'une voix, les tampons de son, les effets) n'est pas traité ici : c'est le lot suivant.

### Ce que le jeu relit

`0x18b63c`, à chaque trame, dans cet ordre :

1. le compteur de trame de la zone qu'il a écrite au tour précédent. S'il vaut 0, rien d'autre n'est lu. Sinon le compteur du jeu devient cette valeur plus 1 (ou 2 si elle valait `0xFFFF`), et le numéro de la zone à lire devient son bit 0 ;
2. l'état des 24 voix, dans la zone à lire ;
3. les `0x260` octets de statistiques ;
4. les échantillons de sortie, si une capture est demandée ;
5. le mot `+2` de l'état du DSP.

**La bascule entre A et B.** Le jeu écrit son compteur dans la zone dont le numéro est le bit 0 du compteur, puis ajoute 1. La zone A reçoit donc les valeurs paires et la zone B les impaires, ce que demande 3dbrew (« The frame count of the first region must be even and the frame count of the second region must be odd »). Et le jeu lit toujours **l'autre** zone que celle qu'il vient d'écrire : il écrit 5 en B, puis au tour suivant lit en A, y écrit ses réglages, y écrit 6, et ainsi de suite. Le programme du DSP doit donc prendre ses ordres dans la zone au compteur le plus haut (c'est la « current region » de 3dbrew) et rendre l'état des voix dans l'autre.

### Comment il rend la main au DSP

Par un signal, pas par une commande. `0x18b504` écrit le compteur, puis appelle `svcSignalEvent` sur la poignée reçue de GetSemaphoreEventHandle (à `0x18b604` ; la première fois à `0x148e3c`). Dans le module, c'est le fil des interruptions qui se réveille et fait le SetSemaphore à la place du jeu, avec la valeur donnée une fois pour toutes par SetSemaphoreMask : `0x2000` ([dsp](dsp.md), partie 7).

Le jeu n'envoie lui-même SetSemaphore que deux fois, au démarrage, avec `0x4000`. 3dbrew décrit le même geste à la page de WriteProcessPipe : écrire dans le tuyau, SetSemaphore avec `0x4000`, attendre le signal.

### Le signal de fin de trame

C'est le signal créé à l'étape 4 et inscrit pour le type 2, canal 2. D'après [dsp](dsp.md), le module le déclenche chaque fois que le DSP annonce avoir écrit dans le tuyau 2, sens 0. Le même signal sert donc deux fois : au démarrage pour dire « la liste d'adresses est dans le tuyau », ensuite pour dire « la trame est finie ». Une trame fait 160 échantillons d'après 3dbrew ; le jeu, lui, dort 4 888 000 nanosecondes entre deux essais à l'arrêt et attend au plus le double dans la boucle, ce qui donne l'ordre de grandeur.

## Partie 4 : l'arrêt, la veille, le retour

**L'arrêt du son** (`0x148e70`, avec 0 pour un arrêt, 1 pour une veille) :

1. **WriteProcessPipe**, canal 2, 4 octets : le mot 1, ou 3 pour une veille.
2. En boucle : **RecvDataIsReady** sur le registre 0 ; s'il est prêt, **RecvData** sur le registre 0. La boucle s'arrête quand le mot lu vaut 1 ; sinon elle dort 4 888 000 nanosecondes et recommence.
3. Pour une veille : copie de `0x1080` octets, de la zone 5 côté A (`0x1FF50800`) vers `+0x18` de l'état.
4. Ferme son signal de fin de trame, puis **RegisterInterruptEvents** type 2, canal 2, poignée nulle : c'est la désinscription.
5. Ferme la poignée du signal du sémaphore.

Les `0x1080` octets couvrent, d'après le tableau des adresses, l'état du DSP, les statistiques, les échantillons de sortie, l'état des voix, et le début de la table du compresseur (`0xA60` octets).

**Le déchargement.** `0x12422c` appelle les fonctions de la table `0x625fc0` (l'arrêt du son ci-dessus, celui du décodeur AAC), puis envoie **UnloadComponent**. Elle est appelée avant le menu HOME (`0x11af2c`, qui envoie JumpToHomeMenu), avant un applet système (`0x125a6c`, StartSystemApplet), par `0x11aedc` (que je lis comme la mise en veille), et par une quatrième fonction du même genre à `0x109990`, que Ghidra n'a pas isolée.

**Le retour.** `0x124294` et `0x124170` renvoient **LoadComponent** avec l'adresse, la taille et les masques gardés depuis le premier chargement, puis appellent les fonctions de la table `0x625fe0`. Celle du son (`0x134a6c`) refait toute la séquence de la partie 2 à partir de l'étape 4, avec deux différences : avant d'écrire dans le tuyau elle recopie les `0x1080` octets sauvegardés vers la zone 5, et le mot écrit dans le tuyau est 2 au lieu de 0. Le composant n'est pas relu sur la cartouche.

Si LoadComponent échoue à ce moment-là, le jeu appelle `0x124344` avec le code d'erreur : la fonction des erreurs fatales, d'après la façon dont tout le code s'en sert ; elle n'a pas été relue ici.

## Partie 5 : le canal 3, le décodeur AAC

Les musiques du jeu sont des fichiers `.aac` (`romfs/sound/bgm_xy_….aac`). C'est le DSP qui les décode, sur demande, par le canal 3. Les fonctions sont appelées par la classe `nw::snd::aac::internal::AacDecoder` (ses fonctions `0x31927c` et `0x3193d8` sont dans la table qui porte ce nom, à `0x599900`).

| Fonction | Ce qu'elle fait |
| --- | --- |
| `0x2c9434` | Crée un signal, **RegisterInterruptEvents** type 2, canal 3, inscrit ses fonctions de veille, puis envoie le message d'ouverture |
| `0x2c9704` | Le message d'ouverture, puis attend la réponse |
| `0x2c993c` | Le message « décode ce bloc » : vérifie l'en-tête du bloc (douze bits à 1 au début), puis envoie trois adresses |
| `0x2c9dc8` | Attend le signal du canal 3, l'efface, **ReadPipeIfPossible** de `0x20` octets ; recommence tant que la taille rendue est sous `0x20`. Puis **InvalidateDCache** sur les deux tampons de sortie, `0x800` octets chacun |
| `0x2c9c8c` | Le message de fermeture, puis désinscription du signal |
| `0x2c9848`, `0x2c9b24` | Les fonctions de veille et de retour |

**Un message fait toujours `0x20` octets**, dans les deux sens :

| Octets | Contenu | Remarque |
| --- | --- | --- |
| 0 et 1 | 1 | toujours (3dbrew : « Codec enum ») |
| 2 et 3 | la demande : 0 ouvrir, 1 décoder, 2 fermer, 3 et 4 autour d'une veille | 3dbrew : « Codec Command » |
| 4 à 7 | à l'aller : rien d'écrit par le jeu ; le module `dsp` écrit son mot `0x109002` aux octets 6 et 7. Au retour : le résultat | le jeu lit les octets 4 et 5 de la réponse ; 0 veut dire réussi |
| 8 à `0x1F` | les arguments | au retour, le jeu garde les 20 octets de 8 à `0x1B` |

Les arguments relevés : à l'ouverture 1, `0xFFFFFFFF`, 1, 0 (les quatre paramètres de `0x2c9434`) ; pour un bloc à décoder, l'adresse du bloc, sa taille (`0x600` au plus), et les adresses de deux tampons de sortie. **Ces trois adresses sont des adresses physiques** : le jeu ajoute `0x0C000000` à ses adresses, après avoir vérifié qu'elles sont dans le tas linéaire. Le bloc à décoder passe avant par **FlushDataCache**.

Le détail des demandes 3 et 4 et le contenu de la réponse n'ont pas été lus. Pour un portage, il y a deux voies : décoder l'AAC à la place du DSP en répondant à ces messages, ou couper plus haut, dans `AacDecoder`.

## Partie 6 : les treize commandes, une par une

**Comment lire les tableaux.** Le « mot *n* » est le mot numéro *n* du tampon du fil, à `+0x80 + 4 × n` du stockage local. Le mot 0 est l'en-tête. « 16 bits » veut dire que le jeu n'écrit que la moitié basse du mot : la moitié haute garde ce qui s'y trouvait. L'émulation l'a montré sur ReadPipeIfPossible, dont le mot 3 est parti avec `0x0001` en haut. Le module ne lit que 16 bits dans ces cas-là ; **un portage doit faire de même**.

Deux réponses d'erreur valent pour tout le service : `0xD900182F` pour un numéro inconnu, `0xD9001830` pour un en-tête ou un descripteur refusé, toutes deux avec l'en-tête de réponse `0x00000040`.

### LoadComponent (`0x001100C2`)

Rôle : donner au module le programme du DSP ; le module le vérifie, le copie et démarre le DSP ([dsp](dsp.md), partie 4).

| Mot | Ce que le jeu écrit (`0x1342fc`) | Ce que le module en fait (`0x105dc0`) |
| --- | --- | --- |
| 0 | `0x001100C2` | vérifié en entier |
| 1 | la taille du composant | **pas lu** : le module prend la taille dans le mot 4 |
| 2 | le masque de programme, 16 bits (`0xFF`) | rangé dans le contexte ; rien ne s'en sert |
| 3 | le masque de données, 16 bits (`0xFF`) | pareil |
| 4 | taille × 16 + `0xA` | les 4 bits du bas doivent valoir `0xA` ; la taille est le reste |
| 5 | l'adresse du composant | la zone que le noyau projette dans le module |

| Mot | Ce que le module écrit | Ce que le jeu lit |
| --- | --- | --- |
| 0 | `0x00110082` | |
| 1 | le résultat | rendu à l'appelant |
| 2 | un octet : 1 si le composant vient d'être chargé | rangé à `0x5d4019` |
| 3, 4 | les mots 4 et 5 de la requête | pas lus |

Erreurs : `0xD8E0A7EA` (signature, en-tête ou segment refusé), `0xD8E0A7EE` (bloc de mémoire non obtenu). Si un composant est déjà chargé, le résultat est 0 et **l'octet vaut 0**.

Pour répondre à la place de la console : résultat 0, octet 1. Le jeu ne regarde le résultat qu'au retour de veille ; au premier chargement il ne lit que l'octet, par `0x17d9dc`, et si l'octet vaut 0 le démarrage du son rend `0xC8A0A801` sans rien envoyer d'autre. Le composant n'a pas besoin d'être exécuté ; il peut servir à retrouver la liste des 15 adresses.

### RegisterInterruptEvents (`0x00150082`)

Rôle : confier au module un signal créé par le jeu, à déclencher quand le DSP écrit dans un tuyau.

| Mot | Ce que le jeu écrit (`0x160038`) | Ce que le module en fait (`0x106998`) |
| --- | --- | --- |
| 0 | `0x00150082` | vérifié en entier |
| 1 | le type : toujours 2 | l'octet bas : 0 et 1 pour les registres de réponse, 2 pour un tuyau |
| 2 | le canal : 2 (son) ou 3 (AAC) | ajouté à 2 pour donner un rang |
| 3 | 0 | doit valoir 0 (c'est l'annonce d'une poignée) |
| 4 | la poignée du signal, ou 0 pour désinscrire | rangée dans une des six cases ; 0 libère la case et ferme le signal |

| Mot | Ce que le module écrit | Ce que le jeu lit |
| --- | --- | --- |
| 0 | `0x00150040` | |
| 1 | le résultat | s'il est négatif au démarrage, le jeu ferme son signal et abandonne |

Erreurs : `0xC860A7FF` quand les six cases sont prises ou que le type et le canal sont hors limites.

Le jeu filtre avant d'envoyer (`0x15fef4`) : il tient un bit par inscription à `0x5d4024` et n'envoie ni une seconde inscription, ni une désinscription de ce qui n'est pas inscrit ; il rend alors `0xC8A0A7F8`.

Pour répondre : garder la poignée par canal, rendre 0. C'est ce signal qu'il faudra déclencher à chaque fin de trame (canal 2) et à chaque réponse du décodeur (canal 3).

### GetSemaphoreEventHandle (`0x00160000`)

Rôle : donner au jeu le signal par lequel il dira « j'ai fini d'écrire cette trame ».

| Mot | Ce que le jeu écrit (`0x160004`) | Ce que le module en fait (`0x106984`) |
| --- | --- | --- |
| 0 | `0x00160000` | seul le numéro compte |

| Mot | Ce que le module écrit | Ce que le jeu lit |
| --- | --- | --- |
| 0 | `0x00160042` | |
| 1 | 0 | rendu à l'appelant |
| 2 | 0 (l'annonce d'une poignée) | |
| 3 | la poignée de son signal `0x109290` | rangée à `+4` de l'état |

Erreurs : aucune côté module. Côté jeu, un résultat négatif ou une poignée nulle arrête le démarrage du son, sans erreur affichée.

Pour répondre : créer un signal, rendre sa poignée (non nulle), et faire tourner une trame de son chaque fois que le jeu le déclenche.

### SetSemaphoreMask (`0x00170040`)

Rôle : dire au module quelle valeur écrire dans le sémaphore du DSP quand le jeu déclenche le signal ci-dessus.

| Mot | Ce que le jeu écrit (`0x15ffcc`) | Ce que le module en fait (`0x106230`) |
| --- | --- | --- |
| 0 | `0x00170040` | seul le numéro compte |
| 1 | la valeur, 16 bits : `0x2000` | rangée à `0x109294`, sans toucher au matériel |

Réponse : mot 0 `0x00170040`, mot 1 toujours 0. Le jeu ne regarde pas le résultat.

Pour répondre : rendre 0 ; la valeur ne sert qu'au matériel.

### WriteProcessPipe (`0x000D0082`)

Rôle : écrire des octets dans un tuyau, du jeu vers le DSP.

| Mot | Ce que le jeu écrit (`0x16f904`) | Ce que le module en fait (aiguillage, puis `0x106794`) |
| --- | --- | --- |
| 0 | `0x000D0082` | vérifié en entier |
| 1 | le canal : 2 ou 3 | choisit le tuyau, sens 1 |
| 2 | la taille : 4 (canal 2) ou `0x20` (canal 3) | **pas lue** |
| 3 | taille × `0x4000` + `0x402` | les bits `0x3C0F` doivent valoir `0x402` ; la taille écrite est ce mot divisé par `0x4000` |
| 4 | l'adresse des octets | le noyau les a recopiés dans le tampon `0x10a438` du module |

Réponse : mot 0 `0x000D0040`, mot 1 toujours 0. Le jeu rend le mot 1 à l'appelant, qui ne le regarde pas.

Au passage, le module retouche les octets reçus : octets 2 et 3 pour le canal 2, octets 6 et 7 pour le canal 3, avec son mot `0x109002`. Il attend si le tuyau est plein ou si le DSP n'a pas encore donné l'adresse de ses tuyaux.

Pour répondre : rendre 0 et traiter le message tout de suite. Canal 2 : le mot des octets 0 et 1 (0 ou 2 : préparer la liste d'adresses et déclencher le signal du canal 2 ; 1 ou 3 : faire rendre 1 au registre 0). Canal 3 : voir la partie 5.

### SetSemaphore (`0x00070040`)

Rôle : écrire une valeur dans le sémaphore du DSP, pour le réveiller.

| Mot | Ce que le jeu écrit (`0x16f888`) | Ce que le module en fait (`0x103d4c`) |
| --- | --- | --- |
| 0 | `0x00070040` | seul le numéro compte |
| 1 | la valeur, 16 bits : toujours `0x4000` | attend que le registre `0x1ED03010` relise 0, puis y écrit la valeur |

Réponse : mot 0 `0x00070040`, mot 1 toujours 0.

Pour répondre : rendre 0. Dans la séquence du jeu, le premier SetSemaphore suit l'écriture dans le tuyau et précède l'attente du signal : c'est le bon moment pour déclencher ce signal si ce n'est pas déjà fait.

### ReadPipeIfPossible (`0x001000C0`)

Rôle : lire des octets dans un tuyau, sans attendre.

| Mot | Ce que le jeu écrit (`0x16f94c`) | Ce que le module en fait |
| --- | --- | --- |
| 0 | `0x001000C0` | seul le numéro compte |
| 1 | le canal : 2 ou 3 | 0 à 7, sinon rien n'est lu |
| 2 | le sens : toujours 0 (depuis le DSP) | 0 ou 1 |
| 3 | la taille, 16 bits : 2, 30 ou `0x20` | plafonnée à `0x200` |

Le jeu prépare aussi **où recevoir les octets**, hors du tampon de la commande : à `+0x180` du stockage local il écrit taille × `0x4000` + 2, et à `+0x184` l'adresse de son tampon. Il remet les anciennes valeurs après l'appel. 3dbrew le décrit de la même façon (« 0x100 byte after the Request header »).

| Mot | Ce que le module écrit | Ce que le jeu lit |
| --- | --- | --- |
| 0 | `0x00100082` | |
| 1 | 0 | rendu à l'appelant |
| 2 | 16 bits : la taille lue, ou 0 | rangé chez l'appelant |
| 3 | taille demandée × `0x4000` + 2 | |
| 4 | l'adresse du tampon `0x10a538` du module | le noyau recopie ces octets dans le tampon du jeu |

Le module lit tout ou rien : si le tuyau contient moins que la taille demandée, il rend 0. Mais les mots 3 et 4 portent quand même la taille demandée : le tampon du jeu reçoit alors ce qui restait dans le tampon du module.

Côté jeu, la taille lue n'est vérifiée que pour le canal 3 (`0x2c9dc8` recommence tant qu'elle est sous `0x20`). Au démarrage, `0x148bc4` ne la regarde pas.

Pour répondre : copier les octets à l'adresse lue à `+0x184` du stockage local, rendre la taille. Avoir la réponse complète prête **avant** de déclencher le signal du canal.

### ConvertProcessAddressFromDspDram (`0x000C0040`)

Rôle : traduire une adresse de la mémoire de données du DSP en une adresse que le jeu peut lire et écrire.

| Mot | Ce que le jeu écrit (`0x16f9b4`) | Ce que le module en fait (`0x1069ec`) |
| --- | --- | --- |
| 0 | `0x000C0040` | seul le numéro compte |
| 1 | l'adresse, en mots de 16 bits ; `0x10000` de plus pour la zone B | appliquée à la formule de [dsp](dsp.md), partie 5 |

| Mot | Ce que le module écrit | Ce que le jeu lit |
| --- | --- | --- |
| 0 | `0x000C0080` | |
| 1 | 0 | |
| 2 | `0x1FF40000` + adresse × 2 (avec le composant du jeu), ou 0 si aucun composant ne tourne | rangé dans l'état |

Avant l'appel, l'enveloppe du jeu (`0x15ff8c`) met `0xFFFFFFFF` dans la case de destination.

Pour répondre : rendre une adresse où le jeu peut lire et écrire. Le plus simple est de réserver `0x40000` octets à `0x1FF40000` et d'appliquer la formule : les 30 adresses tombent alors où le tableau de la partie 2 les met.

### RecvDataIsReady (`0x00020040`) et RecvData (`0x00010040`)

Rôle : savoir si le DSP a déposé un mot dans un de ses trois registres de réponse, puis le lire.

| Mot | Ce que le jeu écrit (`0x16f8c0`, `0x16f9f0`) | Ce que le module en fait (`0x103b4c`, `0x1040a8`) |
| --- | --- | --- |
| 0 | `0x00020040` ou `0x00010040` | seul le numéro compte |
| 1 | le registre, 16 bits : toujours 0 | RecvDataIsReady rend le bit 10 + registre de `0x1ED0300C` ; RecvData attend ce bit, puis lit `0x1ED03024` + registre × 8 |

| Mot | RecvDataIsReady | RecvData |
| --- | --- | --- |
| 0 | `0x00020080` | `0x00010080` |
| 1 | 0 | 0 |
| 2 | un octet : 1 si un mot attend | 16 bits : le mot |

RecvData attend sans fin si rien n'arrive ; le jeu ne l'appelle qu'après un RecvDataIsReady qui a rendu 1.

Pour répondre : après un message 1 ou 3 sur le tuyau 2, rendre « prêt », puis le mot 1.

### UnloadComponent (`0x00120000`)

Rôle : arrêter le DSP.

Le jeu (`0x124148`) n'écrit que l'en-tête. Le module (`0x1060f4`) ne fait rien si aucun composant n'est chargé ; sinon il arrête le DSP et prévient le codec. Réponse : mot 0 `0x00120040`, mot 1 toujours 0. Le jeu remet `0x5d4019` à 0 sans regarder le résultat.

Pour répondre : rendre 0, arrêter la production de trames, oublier les inscriptions du canal.

### FlushDataCache (`0x00130082`) et InvalidateDCache (`0x00140082`)

Rôle : le DSP lit et écrit certains tampons du jeu directement en mémoire physique. Avant qu'il lise, le jeu fait écrire en mémoire ce que son processeur garde en cache (FlushDataCache) ; après qu'il a écrit, le jeu fait oublier à son cache l'ancien contenu (InvalidateDCache).

| Mot | Ce que le jeu écrit (`0x17d9ec`, `0x1ec658`) | Ce que le module en fait (`0x106038`, `0x1065bc`) |
| --- | --- | --- |
| 0 | `0x00130082` ou `0x00140082` | vérifié en entier |
| 1 | l'adresse | doit être dans le tas linéaire (`0x14000000` à `0x1C000000`, ou `0x30000000` à `0x40000000`) ; la commande `0x14` accepte aussi la mémoire du DSP |
| 2 | la taille | |
| 3 | 0 | doit valoir 0 |
| 4 | `0xFFFF8001`, « mon propre processus » (lu à `0x56030c`) | le noyau le remplace par une vraie poignée, que le module referme après usage |

Réponse : mot 0 `0x00130040` ou `0x00140040`, mot 1 le résultat. Erreur : `0xE0E3FFF6` si l'adresse est ailleurs.

Qui les envoie : FlushDataCache par `0x17d9a0`, depuis `0x185ae4` et `0x185d30` (que je lis comme la mise en place des tampons de travail des effets) et, par l'entrée voisine `0x17d99c`, pour chaque bloc AAC à décoder ; InvalidateDCache par `0x1ec55c`, sur les deux tampons de sortie du décodeur.

Pour répondre : rendre 0. Sur PC il n'y a pas de cache à vider.

## Partie 7 : pour répondre à la place de la console, en résumé

1. **Une mémoire de `0x40000` octets à `0x1FF40000`**, ou ailleurs si ConvertProcessAddressFromDspDram rend les adresses qui vont avec.
2. **LoadComponent** : rendre 0 et l'octet 1. Garder le composant si l'on veut y relire la liste d'adresses.
3. **Deux signaux** : celui que le jeu inscrit pour le canal 2 (à déclencher), celui que rend GetSemaphoreEventHandle (à écouter).
4. **Le tuyau 2** : sur le mot 0 ou 2, mettre dans le tuyau `000F` et les 15 adresses, puis déclencher le signal du canal 2. Sur le mot 1 ou 3, faire rendre 1 au registre de réponse 0.
5. **La trame** : à chaque déclenchement du signal du sémaphore, lire les compteurs des deux zones, prendre les ordres dans celle au compteur le plus haut, écrire l'état des 24 voix (et le reste des sorties) dans l'autre, puis déclencher le signal du canal 2. Le premier déclenchement arrive à la fin du démarrage, avec 4 dans le compteur de la zone A.
6. **Le tuyau 3**, si l'on garde le décodeur AAC du jeu : répondre `0x20` octets à chaque message, résultat 0, et déclencher le signal du canal 3.
7. **Le reste** (SetSemaphore, SetSemaphoreMask, les deux commandes de cache, UnloadComponent) : rendre 0.

Le point 5 est la partie difficile, et c'est le lot suivant : il demande le format des voix.

## Les désaccords relevés

| Sujet | Ce que dit l'un | Ce que dit l'autre | Verdict |
| --- | --- | --- | --- |
| Le message du tuyau 2 | 3dbrew (WriteProcessPipe) : position 0 « Unknown », position 2 « Change DSP state » | Le jeu écrit son mot d'état à la position 0 et rien à la position 2 ; le module écrit la position 2 | Le code du jeu et celui du module s'accordent contre 3dbrew |
| L'état du DSP (zone 5) | 3dbrew : 32 octets | Le jeu sauvegarde `0x1080` octets à partir de cette adresse | Pas contradictoire : les zones 5, 9, 6, 2 et 8 se suivent, et la sauvegarde les prend d'un bloc |
| Le mixage intermédiaire | 3dbrew : 160 échantillons de 4 valeurs entrelacées | Le jeu passe aux effets 4 adresses espacées de `0x280` octets, soit 4 tampons de 160 valeurs à la suite | À trancher avec le format des voix |
| Les bits 10 à 12 du registre d'état | 3dbrew (DSP_Registers) : « 0=Was Written by DSP, 1=No » | Le module rend « prêt » quand le bit vaut 1, et la page RecvDataIsReady de 3dbrew dit « 1 = ready » | Le module et le jeu vont dans le même sens ; la page des registres de 3dbrew semble inversée |
| Le composant du jeu | [dsp](dsp.md) : `romfs/sound/dspaudio.cdc` | Le jeu en contient un autre dans son code (`0x5dbc88`) et le romfs un troisième (`m/dps.cdc`) | La fiche a raison ; les deux autres ne sont pas chargés par le chemin lu |
| Une lecture de tuyau de plus de 32 octets | [dsp](dsp.md) : elle ferait s'arrêter le module, à relire | Le jeu ne lit jamais plus de `0x20` octets d'un coup (2, 30, `0x20`) | Le jeu reste juste à la limite ; la question ne se pose pas pour lui |
| Le sémaphore | [dsp](dsp.md) : le signal est déclenché par le jeu | Le jeu : `svcSignalEvent` à `0x148e3c` et `0x18b604`, sur la poignée reçue | Confirmé |
| Les masques de LoadComponent | 3dbrew : « observed 0x00FF » ; [dsp](dsp.md) : rien ne s'en sert | Le jeu envoie `0xFF` et `0xFF` | Les trois s'accordent |
| ReadPipe | [dsp](dsp.md) : ReadPipe bloque, ReadPipeIfPossible non | Le jeu n'envoie que ReadPipeIfPossible, toujours après avoir attendu le signal | Le jeu ne dépend pas de la lecture bloquante |

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes ou plus**

- Les mots de requête des 13 commandes : lus dans le pseudo-code et l'assembleur des fonctions d'envoi, puis relevés dans l'émulateur en faisant tourner ces fonctions ; pour les en-têtes vérifiés en entier, le module exige les mêmes valeurs.
- Les mots de réponse : écrits par l'aiguillage du module, lus aux mêmes places par le jeu (mot 2 en octet pour LoadComponent et RecvDataIsReady, en 16 bits pour RecvData et ReadPipeIfPossible, mot 3 pour GetSemaphoreEventHandle).
- L'ordre de la séquence de démarrage : lu dans `0x148a40` et `0x148bc4`, puis obtenu tel quel dans l'émulateur ; l'inventaire donnait déjà la même liste de commandes pour cet appel.
- Le composant chargé : la chaîne `rom:/sound/dspaudio.cdc` et l'octet à 1 dans `0x115208`, le test de cet octet dans `0x12ac10`, et le fichier présent dans le romfs avec la taille que la fiche du module avait vérifiée.
- Les masques `0xFF` : dans l'assembleur de `0x12ad98` et de `0x134248`, dans l'émulateur, et sur 3dbrew.
- Les 15 adresses : le tableau de 15 destinations du jeu, les 15 structures de 3dbrew, et quinze mots à la suite dans chacun des trois composants.
- Les tailles des zones 1, 2, 3, 6, 7 et 9 : le pas ou la longueur dans le code du jeu, et l'écart entre deux adresses de la liste du composant ; pour 1, 2, 3, 6 et 7, 3dbrew donne la même taille.
- La règle « pair en A, impair en B » et le compteur à 4 au départ : le code du jeu, l'émulation, 3dbrew.
- Le signal du sémaphore déclenché par le jeu : deux `svcSignalEvent` dans le jeu, et le fil du module qui attend ce signal.
- Les valeurs `0x4000` (SetSemaphore) et `0x2000` (SetSemaphoreMask) : dans l'assembleur et dans l'émulateur ; 3dbrew cite `0x4000`.
- Les étages du code : les noms de classes dans le fichier, et la table de fonctions `0x59b9b8` que `0x11deb0` installe.
- La sauvegarde de `0x1080` octets : lue dans `0x148e70` et `0x148bc4`, puis vue dans l'émulateur (copie à l'arrêt pour veille, restitution au redémarrage).

**Interprété**

- La réponse du DSP sur le tuyau 2. La liste est dans le composant et le jeu en attend 15 ; que le programme du DSP envoie bien `000F` suivi de cette liste dans cet ordre n'a pas été vu. L'émulation prouve seulement que le jeu s'en contente.
- Le sens des valeurs `0x4000` et `0x2000` du sémaphore, et le fait que le DSP annonce le tuyau 2 une fois par trame : cela relève du programme du DSP, pas lu.
- « Le DSP lit la zone au compteur le plus haut et écrit dans l'autre » : déduit de ce que le jeu lit et écrit, et de la phrase de 3dbrew sur la « current region ».
- Le sens des mots 0, 1, 2, 3 écrits dans le tuyau 2 (démarrer, arrêter, veille) : déduit des fonctions qui les envoient.
- Les noms des zones : ceux de 3dbrew, posés sur les rangs. Pour les zones 8 et 10 à 14, le jeu range l'adresse et je n'ai pas lu ce qu'il en fait.
- La priorité 4 et la pile de `0x4000` du fil de son : suivies de fonction en fonction.
- Les messages du canal 3 : les octets écrits sont sûrs (émulation), leur sens vient de 3dbrew et de la forme du code.
- Les noms « couche trame » et « couche service », et tous les noms de fonctions proposés : ils décrivent un rôle.
- Les codes `0xC8A0A7F8`, `0xC8A0A7FC` et `0xC8A0A801` rendus par le jeu sans rien envoyer : je donne les valeurs et le moment, pas un sens officiel.

**Pas lu**

- Le format des zones : champs d'une voix, tampons de son, effets, réglages du DSP.
- Le programme du DSP lui-même.
- Le travail de trame de `nw::snd` (les fonctions appelées à l'étape 3 de la boucle), le mixage intermédiaire (`0x18b140`, `0x18d7f8`), les 24 voix (`0x186334`, `0x18f8a8`).
- Les demandes 3 et 4 du décodeur AAC, le contenu de ses réponses, et la fonction `0x2c96b4`.
- L'entrée par le micro (`0x3f90f4`).
- La troisième table de fonctions (`0x626000`) et son appelant `0x10f2ac`.
- Qui pourrait charger `m/dps.cdc`.
- Rien n'a été regardé sur la console : l'ordre réel, le rythme, et les commandes qui partent vraiment restent à observer.

**Où ce travail s'arrête.** La séquence de démarrage, la boucle, l'arrêt et la veille, puis les 13 commandes sont faits. Le canal 3 est décrit dans sa forme, pas dans son détail. Le format des voix n'est pas commencé.

## Comment ce document a été fait

| Étape | Qui | Durée |
| --- | --- | --- |
| Lire les fiches, filtrer l'inventaire sur `dsp::DSP` | Claude | court |
| Lire les 13 fonctions d'envoi et remonter leurs appelants | le pseudo-code de `local/analyse/maj/gh/`, les références de Ghidra (`refs.tsv`) | le gros du temps |
| Relire les arguments perdus autour des appels système | l'assembleur, par `capstone` | immédiat |
| Lire le côté module | le pseudo-code de `local/analyse/dsp/pseudo/` et `code.asm` | court |
| Retrouver les noms de classes derrière les tables de fonctions | un script | immédiat |
| Chercher le composant dans le code du jeu, relire les trois composants | des scripts, plus `check_component.py` et `check_signature.py` de la fiche du module | immédiat |
| Chercher la liste d'adresses dans les composants | un script | immédiat |
| Faire tourner le démarrage, l'arrêt et les enveloppes du jeu | `unicorn`, avec les appels système remplacés par les réponses de ce contrat | quelques secondes |
| Lire 3dbrew | le texte brut des pages, par `index.php?title=…&action=raw` | court |

Pages de 3dbrew lues : DSP_Services, DSP_Memory_Region, DSP_Registers, et les pages DSP:LoadComponent, RegisterInterruptEvents, WriteProcessPipe, ReadPipeIfPossible, ConvertProcessAddressFromDspDram, SetSemaphore, SetSemaphoreMask, GetSemaphoreEventHandle, RecvData, RecvDataIsReady, FlushDataCache, InvalidateDCache, UnloadComponent.

Les analyses n'ont pas été relancées : ni `ghidra_direct.py`, ni le pont REA.

**Les pièges rencontrés.**

- **Une fonction sans appelant n'est pas forcément du code mort.** La boucle du fil de son (`0x17f1f0`) n'a aucune référence. On y entre en tombant de la fonction du dessus (`0x17f1d8`), qui n'a pas de retour : c'est cette adresse-là que la création du fil reçoit.
- **Ghidra colle deux fonctions quand la première finit par un saut.** Le chargement du composant par défaut (`0x13422c`) apparaît comme la fin de `0x12ac10`. Sans l'assembleur, on croit que les deux branches sont dans la même fonction.
- **Le pseudo-code perd des arguments** autour d'un appel système et devant un appel en fin de fonction : le troisième argument de `0x15fef4` (le canal) et le quatrième de `0x1341b4` (le masque de données) n'y sont pas.
- **`refs.tsv` attribue parfois une référence à une fonction lointaine**, quand Ghidra a fait une seule grosse fonction de plusieurs.
- **Dans l'émulateur, écrire le registre d'état avant le pointeur de pile.** Dans l'autre ordre, le changement de mode fait perdre la pile et tout s'arrête à la première instruction.
- **L'outil de lecture de pages web résume et refuse de recopier.** Pour des tableaux de mots, il faut le texte brut de la page.

**Pour reprendre.** Les scripts sont dans `local/analyse/contrat-dsp/` (non versionné) : `f.py` (pseudo-code, appelants, assembleur d'une adresse), `rtti.py` (nom de classe d'une table de fonctions), `find_component.py` et `dump_embedded.py` (le composant dans le code), `find_table.py` (la liste d'adresses dans un composant), `emu_start.py` (l'émulation ; sa sortie est `emu_start.log`), `findword.py`, `findbranch.py`, `svcscan.py`, `strings.py`. Le texte des pages de 3dbrew est dans le sous-dossier `3dbrew/`. La suite logique est le format des voix : partir de `0x1796e0` et de ses voisines (`0x179600` à `0x179b00`), qui écrivent chacune un champ, et de `0x18f69c`, qui lit l'état d'une voix.
