# Contrat APT : ce que Pokémon X demande à `ns`, et ce qu'il faut lui rendre

`APT` est le guichet par lequel un jeu apprend qu'il est au premier plan, qu'on a appuyé sur HOME, que la console s'endort ou qu'il doit se fermer. Ce document reprend les 29 commandes d'`APT:U` que Pokémon X peut envoyer, et dit pour chacune ce que le jeu écrit, ce que le module `ns` en fait, et ce qu'une réimplémentation sur PC doit rendre pour que le jeu continue.

Document du 14 octobre 2026. Chaque commande est lue **des deux côtés**, qui sont deux preuves indépendantes : la fonction d'envoi du jeu (code de la mise à jour, chargé à `0x00100000`) et la fonction de `ns` qui la reçoit (module dumpé, chargé lui aussi à `0x00100000` : les adresses du jeu et celles du module se ressemblent, la colonne dit toujours de quel côté on est). Tout est statique : rien n'a été regardé en train de tourner.

Vocabulaire : celui des fiches `sm` et `ns`. Le **mot 0** est l'en-tête, à `+0x80` du stockage local du fil ; le **mot 1** est à `+0x84`, et ainsi de suite. Dans une réponse, le mot 1 est toujours le code de résultat.

## Synthèse

| N° | En-tête | Commande | Envoi (jeu) | Réception (`ns`) | Lecture | Sert à |
| --- | --- | --- | --- | --- | --- | --- |
| `0x01` | `0x00010040` | GetLockHandle | `0x110388` | `0x1069e8` | des deux côtés | démarrage |
| `0x02` | `0x00020080` | Initialize | `0x110338` | `0x106500` | des deux côtés | démarrage |
| `0x03` | `0x00030040` | Enable | `0x109da8` | `0x1096e0` | des deux côtés | démarrage |
| `0x05` | `0x00050040` | GetAppletManInfo | `0x134f58` | `0x10716c` | des deux côtés | bouton HOME, bouton d'alimentation |
| `0x09` | `0x00090040` | IsRegistered | `0x134d80` | `0x1067cc` | des deux côtés | bouton HOME, sortie |
| `0x0B` | `0x000B0040` | InquireNotification | `0x126078` | `0x108054` | des deux côtés | notifications |
| `0x0C` | `0x000C0104` | SendParameter | `0x134dc4` | `0x106bbc` | des deux côtés | bouton HOME, applets |
| `0x0D` | `0x000D0080` | ReceiveParameter | `0x125fb0` | `0x107268` | des deux côtés | démarrage, retours |
| `0x0E` | `0x000E0080` | GlanceParameter | `0x134ecc` | `0x106e6c` | des deux côtés | démarrage, retours |
| `0x0F` | `0x000F0100` | CancelParameter | `0x134e70` | `0x106dcc` | des deux côtés | applets |
| `0x18` | `0x00180040` | PrepareToStartLibraryApplet | `0x16490c` | `0x1091f4` | des deux côtés | applets |
| `0x19` | `0x00190040` | PrepareToStartSystemApplet | `0x135048` | `0x109014` | des deux côtés | applets |
| `0x1E` | `0x001E0084` | StartLibraryApplet | `0x164870` | `0x107e3c` | des deux côtés | applets |
| `0x1F` | `0x001F0084` | StartSystemApplet | `0x134fc8` | `0x10777c` | des deux côtés, module survolé | applets |
| `0x22` | `0x00220040` | PrepareToCloseApplication | `0x109d6c` | `0x108b04` | des deux côtés | sortie |
| `0x27` | `0x00270044` | CloseApplication | `0x109d18` | `0x106f84` | des deux côtés | sortie |
| `0x2B` | `0x002B0000` | PrepareToJumpToHomeMenu | `0x135018` | `0x108830` | des deux côtés | bouton HOME |
| `0x2C` | `0x002C0044` | JumpToHomeMenu | `0x134e1c` | `0x106c30` | des deux côtés | bouton HOME |
| `0x31` | `0x00310100` | PrepareToDoApplicationJump | `0x110448` | `0x108e34` | des deux côtés | relance du jeu |
| `0x32` | `0x00320084` | DoApplicationJump | `0x1103e4` | `0x1074e0` | des deux côtés | relance du jeu |
| `0x3B` | `0x003B0040` | CancelLibraryApplet | `0x12603c` | `0x107f00` | des deux côtés | applets, sortie |
| `0x3E` | `0x003E0080` | ReplySleepQuery | `0x125f6c` | `0x106eb4` | des deux côtés | veille |
| `0x3F` | `0x003F0040` | ReplySleepNotificationComplete | `0x135080` | `0x109644` | des deux côtés | veille |
| `0x40` | `0x00400042` | SendCaptureBufferInfo | `0x1648c0` | `0x1085c4` | des deux côtés | bouton HOME, applets |
| `0x42` | `0x00420080` | SleepSystem | `0x125e70` | `0x1066f8` | des deux côtés | veille |
| `0x43` | `0x00430040` | NotifyToWait | `0x11b74c` | dans l'aiguillage | des deux côtés | démarrage, retours |
| `0x44` | `0x00440000` | GetSharedFont | `0x125f24` | `0x105bbc` | des deux côtés | démarrage |
| `0x4B` | `0x004B00C2` | AppletUtility | `0x125ea8` | `0x1103e0` | des deux côtés | démarrage, retours |
| `0x4D` | `0x004D0080` | GetAppletProgramInfo | `0x2c9f84` | `0x1081bc` | des deux côtés, module survolé | applets (`.cro`) |

29 commandes : 27 lues des deux côtés, 2 lues côté jeu et seulement survolées côté module, aucune lue d'un seul côté, aucune laissée de côté. « Lu » veut dire : la fonction d'envoi du jeu et son ou ses appelants, puis la case de l'aiguillage de `ns` et la fonction qu'elle appelle. Les fonctions que celle-ci appelle à son tour ne sont suivies que pour le démarrage et les notifications ; la dernière partie dit où la lecture s'arrête.

## Partie 1 : les règles communes

### Une session par commande

Le jeu ne garde pas sa session `APT:U` ouverte. Autour de chaque commande il fait la même chose :

| Ordre | Ce que fait le jeu | Fonction du jeu |
| --- | --- | --- |
| 1 | attend le verrou d'APT sans limite de temps (`svcWaitSynchronization1`, numéro `0x24`, délai `-1`) | `apt_lock_and_open_session` (`0x1258c0`) |
| 2 | demande `APT:U` à `srv:` et range la poignée à `0x5db7d8` | la même |
| 3 | envoie la commande | une des 29 fonctions d'envoi |
| 4 | ferme la session (`svcCloseHandle`, `0x23`) | `apt_close_session_and_unlock` (`0x125c84`) |
| 5 | rend le verrou (`svcReleaseMutex`, `0x14`) | la même |

Le verrou est le mutex rendu par GetLockHandle, rangé à `0x5db790`. Une seule commande part sans lui : GetLockHandle elle-même, envoyée par `apt_open_session` (`0x110494`).

**Pour une réimplémentation.** Il faut accepter un grand nombre d'ouvertures et de fermetures d'`APT:U`, et donner comme verrou un vrai mutex : le fil principal du jeu et son fil d'APT (partie 3) se le disputent.

### Ce que le jeu fait d'une erreur

Trois petites fonctions du jeu décident du sort d'un code de résultat négatif.

| Fonction du jeu | Adresse | Ce qu'elle fait |
| --- | --- | --- |
| lance l'écran d'erreur, sauf pour deux niveaux | `0x124344` | lit le niveau du code (ses 5 bits du haut) ; les niveaux 1 et 25 sont tolérés, tout autre niveau part vers `errf_throw` (`0x118a98`) |
| lance l'écran d'erreur dans tous les cas | `0x124750` | `errf_throw` sans condition |
| arrête le programme | `0x146c14` | `svcBreak` (`0x3C`) |

Les codes d'APT en `0xC8…` sont de niveau 25 : la première fonction les laisse passer. Ceux en `0xE0…` (niveau 28) et `0xD9…` (niveau 27) déclenchent l'écran d'erreur.

### Les trois codes « réessaie »

Neuf endroits du jeu rejouent leur commande toutes les 10 millisecondes tant que `ns` répond l'un de ces trois codes. Ce sont exactement les trois refus que les fonctions « Prepare… » de `ns` rendent quand elles sont occupées.

| Code | Rendu par `ns` quand | Lu dans `ns` |
| --- | --- | --- |
| `0xC8A0CC02` | un paramètre attend déjà dans la boîte aux lettres | `parameter_is_pending`, `send_parameter` (`0x10f408`) |
| `0xC8A0CFF0` | une opération est déjà préparée | `has_prepared_operation` |
| `0xE0A0CC08` | les drapeaux d'occupation n'ont pas pu être levés | `busy_flags_try_set` (`0x1101fc`) |

Les commandes rejouées ainsi : PrepareToJumpToHomeMenu, PrepareToStartLibraryApplet, PrepareToStartSystemApplet, StartLibraryApplet, StartSystemApplet, CancelLibraryApplet, PrepareToCloseApplication, CloseApplication, PrepareToDoApplicationJump, DoApplicationJump. SendParameter n'est rejouée que sur `0xC8A0CC02`.

### Les autres codes d'erreur de ce lot

| Code | Sens dans `ns` |
| --- | --- |
| `0xC8A0CFFC` | la case du programme est déjà inscrite (Initialize), ou l'applet demandé tourne déjà |
| `0xC8A0CC04` | les attributs ne désignent aucune case, ou le demandeur n'est pas le programme actif |
| `0xC880CFFA` | le programme nommé n'est pas inscrit, ou le paramètre est pour quelqu'un d'autre |
| `0xC8A0CFEF` | la boîte aux lettres est vide |
| `0xD9001830` | requête mal formée : en-tête ou descripteur de traduction inattendu. L'en-tête de la réponse est alors `0x00000040` |
| `0xD900182F` | numéro de commande inconnu, même en-tête de réponse `0x00000040` |

### L'état que le jeu tient

Toute la logique d'APT du jeu repose sur quelques octets. Les noms sont proposés ici, ils ne sont pas dans `pokemon-x.noms.tsv`.

| Adresse (jeu) | Contenu | Écrit par |
| --- | --- | --- |
| `0x5d3ce9` | **1 quand le jeu se considère au premier plan** | mis à 1 après un réveil, à 0 avant chaque attente et après chaque saut |
| `0x5d3cea` | bouton HOME reçu, pas encore trié : 1 ou 2 | notifications 1 et 2 |
| `0x5d3ceb` | étape de la veille : 1 question, 2 endormissement, 3 réveil, 4 annulation | notifications 3, 5, 6, 4 |
| `0x5d3cec` | 1 après la notification 7 | notification 7 |
| `0x5d3ced` | état du bouton d'alimentation | bit 0 du mot 3 de GetLockHandle, notifications 8 (1) et 9 (0) |
| `0x5d3cee` | **fermeture demandée** | bit 1 du mot 3 de GetLockHandle, notifications 7 et 11 |
| `0x5d3cef`, `0x5d3cf0` | notification 8, notification 7, à signaler une fois au crochet | notifications 8 et 7 |
| `0x5d3cf1` | fermeture demandée par le menu HOME | paramètre de commande `0x0C` |
| `0x5d3cf2` | ce que le jeu s'apprête à attendre : `0x62` au démarrage, `0x0E` saut vers le menu HOME, 3, 4, 5 pour les applets, 9 pour la sortie | chaque fonction avant d'envoyer sa commande |
| `0x5d3cf4` | appui sur HOME à traiter par la boucle principale : 1 ou 2 | le crochet du fil d'APT |
| `0x5d3cf8` | raison du réveil du fil principal quand ce n'est pas un paramètre : 6 ou 7 | notifications 1 et 2 |
| `0x5d3cfc` | l'identifiant du jeu, `0x300` | `apt_init` |
| `0x5d3d00` | ses attributs, tels que GetLockHandle les a rendus | `apt_init` |
| `0x640f28`, `0x640f2c`, `0x640f30` | les trois signaux qu'attend le fil d'APT : notifications, paramètres, et un troisième créé par le jeu que rien ne lève | `apt_start_event_thread` (`0x110180`) |
| `0x5db76c` | le signal léger qui réveille le fil principal | le fil d'APT |
| `0x5d3d18` | la table des fonctions de rappel du jeu ; son premier octet vaut 1 quand la veille est permise | `main` |

## Partie 2 : le dialogue de démarrage, vu du jeu

La fiche `ns`, partie 4, raconte ces étapes côté module. Les voici côté jeu, avec ce que le jeu fait de chaque réponse.

### Les fonctions du jeu

| Nom proposé | Adresse | Rôle |
| --- | --- | --- |
| `startup_init_apt` | `0x106518` | appelle `apt_init(0x300, 0, 0xF)` |
| `apt_init` | `0x109ac8` | GetLockHandle, Initialize, création du fil d'APT |
| `apt_start_event_thread` | `0x110180` | range les deux signaux, crée le fil |
| `apt_event_thread_main` | `0x11a958` | **le fil d'APT** : attend les trois signaux |
| `apt_event_hook` | `0x11a458` | le crochet appelé par ce fil après presque chaque signal |
| `apt_enable_and_wait` | `0x1073ac` | Enable, puis attente du premier plan |
| `apt_wait_for_wakeup` | `0x11b074` | NotifyToWait, attente, ReceiveParameter, remise en route |
| `apt_receive_parameter_wait` | `0x1350b8` et `0x11acb0` (la seconde est `apt_receive_parameter_wait_2` dans `pokemon-x.noms.tsv`, où ces noms ont été versés depuis) | attend le signal léger, puis ReceiveParameter |
| `apt_glance_parameter` | `0x1260bc` | GlanceParameter sous le verrou |
| `apt_applet_utility` | `0x11ade4` | AppletUtility sous le verrou |

### Les étapes

| Ordre | Fil | Ce que fait le jeu | Commande envoyée |
| --- | --- | --- | --- |
| 1 | principal | `apt_init` ouvre `APT:U` sans verrou | **GetLockHandle**, attributs 0 |
| 2 | principal | range le verrou (`0x5db790`), les attributs rendus (`0x5d3d00`), les deux bits du mot 3 (`0x5d3ced`, `0x5d3cee`), l'identifiant `0x300` (`0x5d3cfc`) ; ferme la session | |
| 3 | principal | si la position des attributs rendus vaut 6, s'arrête là. Sinon prend le verrou | **Initialize**, `0x300` et les attributs rendus |
| 4 | principal | range le mot 3 à `0x640f28` (notifications) et le mot 4 à `0x640f2c` (paramètres), crée un troisième signal, installe le crochet `0x11a458`, crée le fil `0x11a958`, rend le verrou | |
| 5 | principal | `main` inscrit deux fonctions de rappel (`0x10747c` pour la question de veille, `0x107458` pour le réveil), puis appelle `apt_enable_and_wait(1)` | **Enable**, les attributs |
| 6 | principal | si la position est 0 et que le bit `0x20` des attributs est nul : note `0x62` à `0x5d3cf2` et entre dans `apt_wait_for_wakeup` avec un tampon de 0x1000 octets (`0x640f34`) | **NotifyToWait**, `0x300` |
| 7 | principal | met `0x5d3ce9` à 0 et **s'endort sur le signal léger `0x5db76c`**, sans limite de temps | |
| 8 | APT | `svcWaitSynchronizationN` (`0x25`) sur les trois signaux, un seul suffit, sans limite de temps. Le signal des paramètres sonne (rang 1) : `svcClearEvent` (`0x19`), puis le crochet | **GlanceParameter**, `0x300`, 0x1000 octets dans le tampon `0x5aa000` |
| 9 | APT | la commande lue n'est ni 2, ni 5, ni 8, ni 9 : le crochet rend 1, le fil lève le signal léger | |
| 10 | principal | réveillé ; `0x5d3cf8` est nul, donc c'est un paramètre | **ReceiveParameter**, `0x300`, 0x1000 octets |
| 11 | principal | la commande reçue est 1 : **`0x5d3ce9` passe à 1, le jeu se considère au premier plan** | |
| 12 | principal | baisse le drapeau d'occupation `0x10` | **AppletUtility**, opération 7, 4 octets d'entrée valant `0x10` |
| 13 | principal | fait revérifier la veille | **AppletUtility**, opération 4 |
| 14 | principal | `apt_enable_and_wait` range l'expéditeur (`0x5db7bc`), la taille reçue (`0x5db7c0`) et un drapeau (`0x5db7b8`), puis rend la main à `main` | |

Plus tard, dans `game_init_systems`, vient **GetSharedFont** (rubrique `0x44`). C'est la seule autre commande d'APT que la séquence de démarrage de `pokemon-x-services.md` relève avant la boucle principale.

### Ce que le jeu fait de l'expéditeur et de la commande

- **L'expéditeur n'est pas regardé.** Il est rangé à `0x5db7bc`, et cette adresse n'a aucun lecteur : une recherche de tous les mots du fichier qui pointent sur la zone `0x5db7b8` à `0x5db7c4` ne trouve que les quatre petites fonctions qui y écrivent et une mise à zéro. N'importe quel identifiant convient ; `ns` enverrait celui du menu HOME, `0x101`.
- **La commande décide de tout.** `apt_wait_for_wakeup` ne sort de son attente que pour dix valeurs. Toute autre valeur le renvoie attendre le signal suivant.

| Commande reçue | Le jeu rend à son appelant | Ce qu'il fait en plus |
| --- | --- | --- |
| 1 | 1 | rien : c'est le réveil du démarrage |
| `0x0A` | 2 | |
| `0x0B` | 3 | c'est le retour du menu HOME |
| `0x0C` | 4 | note la fermeture demandée (`0x5d3cf1`) |
| `0x0D` | 5 | |
| `0x0E` | 6 | |
| `0x0F` | 7 | note un appui sur HOME à traiter, puis AppletUtility opération 5 |
| `0x11` | 9 | |
| `0x40`, `0x41` | la même valeur | |

Pour toutes sauf 1 et `0x0C`, une application reprend d'abord le droit d'affichage (`gsp`) et restaure sa mémoire vidéo. Après chacune sauf `0x0F`, le jeu renvoie AppletUtility 7 puis 4, comme aux étapes 12 et 13.

Quatre autres commandes ne réveillent jamais le fil principal : le crochet du fil d'APT les traite lui-même après son GlanceParameter.

| Commande vue par GlanceParameter | Ce que fait le crochet |
| --- | --- |
| 2 | CancelParameter (retire le paramètre), puis SendParameter de la commande 3 à l'expéditeur : une réponse |
| 5 | CancelParameter, puis une fonction de rappel si le jeu en a inscrit une |
| 8 | met le son en sommeil (les fonctions de `dsp::DSP`) |
| 9 | réveille le son |

### La plus petite suite de réponses

Pour amener le jeu de son point d'entrée à la suite de `main`, côté `APT` :

| Ordre | Requête du jeu | Réponse à rendre |
| --- | --- | --- |
| 1 | GetLockHandle | résultat 0, mot 2 = 0, mot 3 = 0, mot 4 = 0, mot 5 = un mutex libre |
| 2 | Initialize | résultat 0, mot 2 = `0x04000000`, mots 3 et 4 = deux signaux distincts |
| 3 | Enable | résultat 0 |
| 4 | NotifyToWait | résultat 0 |
| | | **lever le signal du mot 4 d'Initialize**, une fois |
| 5 | GlanceParameter | résultat 0, expéditeur `0x101`, commande 1, taille 0, poignée 0 |
| 6 | ReceiveParameter | la même chose |
| 7 | AppletUtility (7) | résultat 0 |
| 8 | AppletUtility (4) | résultat 0 |
| 9 | GetSharedFont | résultat 0, une adresse et un bloc de mémoire partagée (rubrique `0x44`) |

Trois pièges :

- Le mot 3 de GetLockHandle doit valoir 0. Son bit 1 met le drapeau « fermeture demandée », que `main` teste juste après `apt_enable_and_wait` pour partir vers la sortie.
- Ne jamais lever le premier signal (notifications) sans notification à rendre : InquireNotification qui répond 0 arrête le jeu par `svcBreak` (partie 3).
- Le signal des paramètres doit rester levé jusqu'à ce que le fil d'APT le lise. Le jeu l'efface lui-même (`svcClearEvent`).

## Partie 3 : la boucle des notifications

### Qui attend quoi

Le fil d'APT (`apt_event_thread_main`, `0x11a958`) tourne tant que l'octet `0x5db758` est nul. À chaque tour :

1. Il attend l'un des trois signaux de `0x640f28` par `svcWaitSynchronizationN`.
2. Si le fil principal n'a pas encore traité le réveil précédent (le signal léger `0x5db76c` est encore levé), il dort 10 millisecondes, **relève lui-même le signal qui vient de sonner** (`svcSignalEvent`, `0x18`) et recommence. Rien n'est perdu.
3. Sinon il efface le signal (`svcClearEvent`) et trie selon son rang.

| Rang | Signal | Ce que fait le fil |
| --- | --- | --- |
| 0 | notifications | prend le verrou, envoie **InquireNotification** avec `0x300`, rend le verrou, puis trie la valeur (tableau suivant). Une erreur de la commande est ignorée |
| 1 | paramètres | appelle le crochet ; s'il rend autre chose que 0, lève le signal léger du fil principal |
| 2 | le troisième | note 12 comme raison de réveil et lève le signal léger. Aucune instruction trouvée ne lève ce signal : branche sans doute morte |

C'est donc bien InquireNotification, et elle seule, qui dit au jeu ce qui se passe.

### Chaque valeur, et ce que le jeu répond

L'aiguillage est une table de saut à 12 cases (`0x11aae4`), lue dans l'assembleur.

| Valeur | Ce que le jeu fait | Commande renvoyée à `ns` | Sens |
| --- | --- | --- | --- |
| 0, ou 12 et plus | `svcBreak` | | ne doit pas arriver |
| 1 | note 1 à `0x5d3cea` s'il n'y a rien, appelle le crochet, qui note l'appui à `0x5d3cf4` pour la boucle principale si le jeu est au premier plan | plus tard, voir ci-dessous | bouton HOME |
| 2 | de même, avec la valeur 2 | de même | seconde forme du bouton HOME |
| 3 | étape de veille 1 ; le crochet appelle la fonction de rappel du jeu (`0x10747c`) | **ReplySleepQuery** avec 1 (accepte) ou 0 (refuse) ; aucune réponse si le rappel rend 2 | la console demande si elle peut dormir |
| 4 | étape de veille 4 ; rappel éventuel | aucune | la mise en veille est annulée |
| 5 | étape de veille 2 ; le crochet appelle les fonctions inscrites pour l'endormissement | **ReplySleepNotificationComplete** | la console s'endort |
| 6 | étape de veille 3 ; le crochet recharge le composant du son (`dsp_LoadComponent`) et appelle le rappel du réveil (`0x107458`) | aucune | la console se réveille |
| 7 | met `0x5d3cf0`, `0x5d3cec` et **le drapeau « fermeture demandée »** à 1, appelle le crochet | la sortie, voir ci-dessous | arrêt de la console |
| 8 | met `0x5d3cef` et l'état du bouton d'alimentation à 1, appelle le crochet | le saut vers le menu HOME, voir ci-dessous | bouton d'alimentation |
| 9 | remet l'état du bouton d'alimentation à 0 | aucune | bouton d'alimentation annulé |
| 10 | | **SleepSystem** avec les mots 0 et `0x40` | `ns` demande au jeu de lancer la veille |
| 11 | met le drapeau « fermeture demandée » à 1, sans crochet ni réveil | la sortie, voir ci-dessous | fermeture demandée |

**La question de veille (3)**, en détail. Le rappel du jeu rend 0, 1 ou 2. Si la veille n'est pas permise (premier octet de `0x5d3d18` nul) alors que le jeu est au premier plan, la réponse est forcée à 0. Si une fermeture est déjà demandée, la réponse est 0 sans appeler le rappel.

**Le bouton HOME (1 et 2).** La notification ne fait que poser un drapeau. C'est la boucle principale qui agit, par deux chemins :

| Chemin | Fonction du jeu | Commandes, dans l'ordre |
| --- | --- | --- |
| le jeu refuse | `0x11b4a8`, appelée par `0x110adc` | AppletUtility 7 avec la valeur 1 (baisse le drapeau d'occupation du bouton HOME), AppletUtility 4 |
| le jeu accepte | `0x109de0`, appelée par `main_loop` à `0x106998`, puis `0x1100a8` et `0x11af2c` | IsRegistered(`0x400`) ; PrepareToJumpToHomeMenu ; GetAppletManInfo(`0xFF`) ; IsRegistered(menu HOME) jusqu'à 1 ; SendParameter commande `0x10` au menu HOME, 0x20 octets ; GlanceParameter et ReceiveParameter jusqu'à recevoir la commande 3 du menu HOME ; SendCaptureBufferInfo, 0x20 octets ; JumpToHomeMenu ; NotifyToWait ; AppletUtility 4 ; attente ; GlanceParameter ; ReceiveParameter (commande `0x0B`) ; AppletUtility 7 (`0x10`) et 4 ; AppletUtility 7 (1) et 4 |

Entre ces commandes le jeu sauve sa mémoire vidéo (`gspgpu_SaveVramSysArea`), rend puis reprend le droit d'affichage, endort et réveille le son et l'appareil photo.

**Le bouton d'alimentation (8).** La boucle principale (`0x110adc`) lit l'état à `0x5d3ced`. S'il est levé elle envoie GetAppletManInfo(2), puis part vers le menu HOME (PrepareToJumpToHomeMenu, JumpToHomeMenu) ou, si un autre applet système est inscrit à sa place, vers lui (PrepareToStartSystemApplet, StartSystemApplet).

**La fermeture (7, 11, ou paramètre `0x0C`).** `main` et la boucle principale lisent les drapeaux `0x5d3cee` et `0x5d3cf1`. La sortie (`0x107200`) envoie IsRegistered(`0x400`), PrepareToCloseApplication avec 1, CloseApplication, puis `svcExitProcess`.

### Recoupement avec la fiche `ns`

La fiche `ns` donnait le sens des numéros de mémoire, d'après libctru. Le code du jeu le confirme ou le complète.

| Notification | D'après `ns.md` | D'après le code du jeu | Verdict |
| --- | --- | --- | --- |
| 1 | bouton HOME | pose le drapeau qui mène à PrepareToJumpToHomeMenu | confirmé |
| 2 | jamais déposée par `ns` | traitée comme 1, à une valeur près | le jeu la connaît, `ns` ne l'envoie pas |
| 3 à 6 | la veille, sans détail | 3 question, 4 annulation, 5 endormissement, 6 réveil : chaque valeur a sa réponse | confirmé et précisé |
| 7 | l'arrêt | fermeture demandée | confirmé |
| 8 | bouton d'alimentation | état du bouton levé, saut vers le menu HOME | confirmé |
| 9 | déposée après l'opération 0 d'AppletUtility | baisse l'état du bouton d'alimentation | précisé : `ns` remet à zéro son propre état (`0x1241bc`) au même moment |
| 10 | jamais déposée par `ns` | le jeu répond par SleepSystem | le jeu la connaît, `ns` ne l'envoie pas |
| 11 | la fermeture | fermeture demandée | confirmé |

Aucune correction : les numéros de la fiche `ns` étaient justes. Ce qui manquait est le sens de 2, 4, 9 et 10, et le fait que 0 arrête le jeu.

## Partie 4 : les rubriques

Les mots de requête sont ceux que la fonction d'envoi du jeu écrit ; les mots de réponse, ceux que l'aiguillage de `ns` (`apt_handle_command`, `0x103e6c`) écrit. La colonne « lu par le jeu » dit ce que la fonction d'envoi recopie pour son appelant.

### `0x01` GetLockHandle

Rend le verrou commun à tous les clients d'APT.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00010040` | |
| 1 | attributs | 0 : `startup_init_apt` efface les trois bits du bas d'un paramètre qui vaut 0 |

| Mot de la réponse | Contenu écrit par `ns` | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x000100C2` | non |
| 1 | résultat | oui |
| 2 | les attributs, tels quels pour une application | oui : gardés à `0x5d3d00` et renvoyés dans Initialize et Enable |
| 3 | **0, toujours** | oui : bit 0 vers l'état du bouton d'alimentation, bit 1 vers « fermeture demandée » |
| 4 | 0 : une poignée copiée | non |
| 5 | le mutex d'APT (`0x123584` dans `ns`) | oui : c'est le verrou |

- **Côté module.** Trois pointeurs nuls arrêtent `ns`. Pour une position 1, 3 ou 5, la position est réécrite ; pour 0, rien ne change.
- **Erreurs.** Aucune : la fonction rend toujours 0.
- **Désaccord.** 3dbrew décrit le mot 3 comme l'état d'APT (bit 0 le bouton d'alimentation, bit 1 l'ordre de fermeture), et le jeu le lit exactement ainsi. Le module de cette console y écrit 0 dans tous les cas : ces deux états arrivent par les notifications 8, 7 et 11, que Enable dépose.
- **Pour répondre à la place de la console.** Résultat 0, mot 2 égal au mot 1 reçu, mot 3 nul, un mutex que personne ne tient.

### `0x02` Initialize

Inscrit le jeu et lui remet ses deux signaux.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00020080` | |
| 1 | identifiant du programme | `0x300` |
| 2 | attributs | ceux rendus par GetLockHandle |

| Mot de la réponse | Contenu écrit par `ns` | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x00020043` | non |
| 1 | résultat | oui |
| 2 | `0x04000000` : deux poignées copiées | non |
| 3 | le signal des notifications de la case | oui : rang 0 du fil d'APT |
| 4 | le signal des paramètres de la case | oui : rang 1 du fil d'APT |

- **Côté module.** `slot_from_attributes` (`0x10f99c`) choisit la case ; une position de 6 ou 7 arrête `ns`. La case reçoit l'identifiant et les attributs, sa notification en attente est effacée. Si un programme est déjà actif, la commande s'arrête là.
- **Erreurs.** `0xC8A0CFFC` si la case est déjà inscrite. Le jeu la tolère (niveau 25) et continue avec deux poignées nulles.
- **Remarque.** 3dbrew dit que la position ne doit pas dépasser 6. Dans ce module, 6 arrête déjà `ns` ; le jeu, lui, n'envoie pas Initialize quand la position rendue par GetLockHandle vaut 6.
- **Pour répondre.** Résultat 0, deux signaux distincts. Le jeu ferme lui-même ces poignées à l'arrêt de son fil.

### `0x03` Enable

Rend le jeu visible : à partir de là `ns` peut lui envoyer son réveil.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00030040` | |
| 1 | attributs | ceux de `0x5d3d00` |

Réponse : en-tête `0x00030040`, mot 1 le résultat, seul mot lu.

- **Côté module.** L'octet « inscrit » de la case passe à 1. Si un arrêt, une fermeture ou un appui sur le bouton d'alimentation est en cours, la notification 7, 11 ou 8 est déposée tout de suite. C'est ce qui remplace le mot 3 de GetLockHandle.
- **Erreurs.** `0xC8A0CC04` si les attributs ne désignent aucune case. Tolérée par le jeu.
- **Pour répondre.** Résultat 0, puis lever le signal des paramètres avec le paramètre de commande 1 prêt.

### `0x05` GetAppletManInfo

Dit quel programme est actif et où est le menu HOME.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00050040` | |
| 1 | position demandée, un octet | `0xFF` avant un saut vers le menu HOME (`0x11af2c`), 2 pour le bouton d'alimentation (`0x11a384`) |

| Mot de la réponse | Contenu écrit par `ns` | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x00050140` | non |
| 1 | résultat | oui |
| 2 | position du programme actif (un octet), `0xFF` s'il n'y en a pas | oui, pas utilisé |
| 3 | identifiant du programme inscrit à la position demandée, 0 sinon | oui : avec 2, sert à savoir si un applet système autre que le menu occupe la place |
| 4 | identifiant du menu HOME (`0x1240e8`, `0x101` au départ) | oui : c'est le destinataire des envois qui suivent |
| 5 | identifiant du programme actif | oui, pas utilisé |

- **Côté module.** La position est traduite en identifiant générique par la fonction à `0x1103a0` : 0 donne `0x300`, 1 `0x400`, 2 `0x100`, 3 `0x200`. Toute autre valeur donne 0 dans le mot 3.
- **Erreurs.** Aucune.
- **Pour répondre.** Résultat 0, position 0, mot 3 nul (ou `0x300` pour la position 0), mot 4 `0x101`, mot 5 `0x300`.

### `0x09` IsRegistered

Dit si un programme est inscrit.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00090040` | |
| 1 | identifiant | `0x400` et `0x200` (un applet de bibliothèque est-il ouvert), l'identifiant du menu HOME, ou celui d'un applet à lancer |

Réponse : en-tête `0x00090080`, mot 1 le résultat, mot 2 un octet, 1 si inscrit. Le jeu lit les deux.

- **Côté module.** `slot_from_applet_id` (`0x10f630`) retrouve la case, et la réponse est son octet « inscrit », celui que Enable met à 1. C'est ce que dit 3dbrew.
- **Erreurs.** Aucune.
- **Pour répondre.** 0 pour `0x400` et `0x200` : le jeu en conclut qu'aucun applet n'est à fermer et n'envoie pas CancelLibraryApplet. Pour le menu HOME, attention : le jeu boucle toutes les 10 millisecondes jusqu'à lire 1.

### `0x0B` InquireNotification

Rend la notification en attente et l'efface.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x000B0040` | |
| 1 | identifiant | `0x300` |

Réponse : en-tête `0x000B0080`, mot 1 le résultat, mot 2 la notification sur un octet. Le jeu lit les deux.

- **Côté module.** L'octet `+0x10` de la case est rendu puis remis à 0.
- **Erreurs.** `0xC880CFFA` si le programme n'est pas inscrit. Le jeu ignore toute erreur de cette commande.
- **Pour répondre.** Voir la partie 3. Ne jamais rendre 0 avec un résultat nul. Une réimplémentation qui ne lève jamais le signal des notifications ne recevra jamais cette commande.

### `0x0C` SendParameter

Dépose un paramètre pour un autre programme.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x000C0104` | |
| 1 | expéditeur | `0x300` |
| 2 | destinataire | le menu HOME, un applet, ou l'expéditeur d'une commande 2 |
| 3 | commande | `0x10` (informations de capture d'écran), 2 (requête à un applet de bibliothèque), 3 (réponse), 5 (message, depuis un `.cro`) |
| 4 | taille | 0x20 pour les commandes `0x10` et 2 |
| 5 | 0 | |
| 6 | poignée jointe | le contenu de `0x5d3cd0` pour les commandes `0x10` et 2 |
| 7 | (taille << 14) \| 2 | |
| 8 | adresse des données | |

Réponse : en-tête `0x000C0040`, mot 1 le résultat.

- **Côté module.** L'en-tête entier est vérifié, le mot 5 doit être nul et le mot 7 un descripteur de tampon. **La taille prise est celle du descripteur (mot 7), le mot 4 n'est pas lu.** `send_parameter` (`0x10f408`) range le paramètre et lève le signal des paramètres du destinataire.
- **La commande `0x10` est à part.** `ns` ne la transmet pas : il garde les données pour lui et dépose aussitôt, **pour l'expéditeur**, un paramètre de commande 3 venant du destinataire. Le jeu attend précisément ce retour avant d'envoyer JumpToHomeMenu.
- **Le bit `0x10000` de la commande** désinscrit l'expéditeur après l'envoi. Les deux côtés s'accordent : `ns` vide la case, et le jeu arrête son fil d'APT et ferme ses signaux.
- **Erreurs.** `0xC8A0CC02` (boîte pleine : le jeu réessaie toutes les 10 millisecondes), `0xC880CFFA` (destinataire non inscrit), `0xD9001830`.
- **Pour répondre.** Résultat 0. Pour la commande `0x10`, tenir prêt le paramètre « expéditeur = le destinataire nommé, commande 3 » et lever le signal des paramètres.

### `0x0D` ReceiveParameter

Lit le paramètre en attente et vide la boîte.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x000D0080` | |
| 1 | identifiant du demandeur | `0x300` |
| 2 | taille du tampon | 0x1000 au démarrage, 0 quand le jeu n'attend pas de données |

Avant l'appel, le jeu déclare où recevoir les données : à `+0x180` du stockage local il écrit (taille << 14) \| 2, à `+0x184` l'adresse de son tampon. Il remet les deux anciens mots en place après l'appel.

| Mot de la réponse | Contenu écrit par `ns` | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x000D0104` | non |
| 1 | résultat | oui |
| 2 | expéditeur | oui |
| 3 | commande | oui |
| 4 | nombre d'octets copiés | oui |
| 5 | `0x10` : une poignée qui change de propriétaire | non |
| 6 | la poignée jointe, ou 0 | oui : fermée par le jeu quand l'appelant n'en veut pas |
| 7 | (taille << 14) \| 2 | non |
| 8 | adresse des données chez `ns` | non |

- **Côté module.** La taille demandée est ramenée à 0x1000. `receive_parameter` (`0x10eff8`) copie au plus la taille du paramètre, puis `parameter_clear` vide la boîte.
- **Erreurs.** `0xC8A0CFEF` si la boîte est vide : le jeu reconnaît ce code à ses 10 bits du bas (`0x3EF`) et rend `-1` à son appelant. `0xC880CFFA` si le paramètre est pour un autre.
- **Désaccord.** 3dbrew donne pour le mot 7 la taille réellement copiée. Le module y met la taille demandée, plafonnée. Le jeu ne lit pas ce mot.
- **Pour répondre.** Les mots 1 à 4 et 6, et recopier les données dans le tampon déclaré à `+0x184`. Pour le démarrage : commande 1, taille 0, poignée 0.

### `0x0E` GlanceParameter

Regarde le paramètre en attente sans le retirer.

Requête et réponse : les mêmes que ReceiveParameter, avec les en-têtes `0x000E0080` et `0x000E0104`, et un mot 5 qui vaut 0 (la poignée est copiée, pas déplacée). Le jeu demande toujours 0x1000 octets dans le tampon `0x5aa000` et ferme la poignée reçue.

- **Côté module.** La même fonction, sans vider la boîte, sauf pour les commandes 8 et 9 qui sont retirées quand même. C'est ce que dit 3dbrew, et c'est cohérent avec le jeu, qui traite 8 et 9 sans jamais envoyer ReceiveParameter derrière.
- **Erreurs.** Les mêmes. Le jeu tolère `0xC8A0CFEF` mais lit alors une commande qu'il n'a pas reçue : à éviter.
- **Pour répondre.** La même réponse que le ReceiveParameter qui suivra. Au démarrage, GlanceParameter arrive **avant** ReceiveParameter, depuis le fil d'APT.

### `0x0F` CancelParameter

Retire le paramètre en attente s'il correspond.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x000F0100` | |
| 1 | vérifier l'expéditeur, un octet | 1 |
| 2 | expéditeur attendu | celui que GlanceParameter vient de rendre |
| 3 | vérifier le destinataire, un octet | 0 |
| 4 | destinataire attendu | non rempli par l'appelant |

Réponse : en-tête `0x000F0080`, mot 1 le résultat, mot 2 un octet, 1 si un paramètre a été retiré.

- **Côté module.** Sous le verrou de la boîte : boîte pleine, et chaque champ demandé égal à celui du paramètre. La poignée jointe est fermée.
- **Erreurs.** Aucune.
- **Pour répondre.** Résultat 0, mot 2 à 1. Ne sert qu'après un paramètre de commande 2 ou 5, donc pas sans applet.

### `0x18` PrepareToStartLibraryApplet

Annonce le lancement d'un applet de bibliothèque.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00180040` | |
| 1 | identifiant de l'applet | `0x401` (`0x2c9230`), `0x406` (`0x1353ec`), ou un identifiant reçu en paramètre (`0x2cdbf4`) |

Réponse : en-tête `0x00180040`, mot 1 le résultat.

- **Côté module.** Le programme actif doit être l'application ou un applet système. La case active est notée (`0x124104`), le drapeau d'occupation `0x20` est levé, l'octet « opération préparée » passe à 5, et l'applet est lancé par `launch_applet_title` s'il ne tourne pas.
- **Erreurs.** `0xC8A0CC04`, les trois codes « réessaie », `0xC8A0CFFC` si l'applet est déjà inscrit (le jeu la traite comme un succès), ou l'erreur du lancement.
- **Pour répondre.** Sans applets sur PC, cette commande ne doit pas arriver : c'est le jeu qui décide d'ouvrir le clavier ou l'écran d'erreur. Répondre 0 engage à jouer toute la suite (SendParameter 2, réponse 3, StartLibraryApplet, puis un paramètre de retour).

### `0x19` PrepareToStartSystemApplet

Annonce le lancement d'un applet système.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00190040` | |
| 1 | identifiant | `0x114` (`0x2d16c8`), ou l'applet système trouvé par GetAppletManInfo(2) |

Réponse : en-tête `0x00190040`, mot 1 le résultat.

- **Côté module.** Depuis une application, seuls `0x114`, `0x117`, `0x118` et `0x119` sont acceptés. Drapeau d'occupation `0x40`, opération préparée 7, identifiant gardé à `0x12413c`.
- **Erreurs.** `0xC8A0CC04`, les trois codes « réessaie ». Le jeu transforme `0xC8A0CFFC` en succès.
- **Pour répondre.** Comme la précédente.

### `0x1E` StartLibraryApplet

Passe la main à l'applet de bibliothèque préparé.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x001E0084` | |
| 1 | identifiant de l'applet | le même qu'à la préparation |
| 2 | taille des données | 0x400, 0xF80 ou 0x920 selon l'applet |
| 3 | 0 | |
| 4 | poignée jointe | fournie par l'appelant ; le contenu de `0x5d3cd0` pour `0x406` |
| 5 | (taille << 14) \| 2 | |
| 6 | adresse des données | |

Réponse : en-tête `0x001E0040`, mot 1 le résultat.

- **Côté module.** L'applet doit être inscrit et être celui de la case 3, sinon `0xC8A0CFF0`. La case 3 devient active et l'applet reçoit le paramètre de commande 1 avec les données.
- **Erreurs.** `0xC8A0CFF0`, celles de `send_parameter`, `0xD9001830`. Hors des trois codes « réessaie », toute erreur mène à l'écran d'erreur.
- **Pour répondre.** Comme la précédente.

### `0x1F` StartSystemApplet

Passe la main à l'applet système préparé. Module survolé.

Requête : la même forme que StartLibraryApplet, en-tête `0x001F0084` ; le jeu envoie `0x114` avec 0x400 octets. Réponse : en-tête `0x001F0040`, mot 1 le résultat.

- **Côté module.** L'identifiant doit être celui gardé par la préparation, sinon `ns` s'arrête. Depuis une application : si l'applet est déjà inscrit, il reçoit tout de suite le paramètre de commande `0x0B` ; sinon un travail est déposé pour le fil ouvrier, qui le lance. Les trois fonctions de travail (`0x10b604`, `0x10d9a0`, `0x10b684`) ne sont pas lues.
- **Erreurs.** Aucune vue dans la fonction elle-même.
- **Pour répondre.** Comme la précédente.

### `0x22` PrepareToCloseApplication

Annonce que le jeu va se fermer.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00220040` | |
| 1 | un octet (« annuler le préchargement », d'après 3dbrew) | 1 |

Réponse : en-tête `0x00220040`, mot 1 le résultat.

- **Côté module.** Si une fermeture est déjà en cours, rend 0 sans rien faire. Sinon le programme actif doit être l'application ; `ns` choisit qui reprendra la main (l'applet système ou le menu HOME) et lève le drapeau d'occupation `0x40`.
- **Erreurs.** `0xC8A0CC04`, les trois codes « réessaie ». Toute autre erreur mène à l'écran d'erreur.
- **Pour répondre.** Résultat 0.

### `0x27` CloseApplication

Ferme le jeu et rend la main.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00270044` | |
| 1 | taille des données | fournie par l'appelant de la sortie (`0x107200`) |
| 2 | 0 | |
| 3 | poignée jointe | de même |
| 4 | (taille << 14) \| 2 | |
| 5 | adresse des données | de même |

Réponse : en-tête `0x00270040`, mot 1 le résultat.

- **Côté module.** La case de l'application est vidée, et le programme qui reprend la main reçoit le paramètre de commande `0x0A` avec les données (ou `0x0C`, sans données, quand une fermeture générale est en cours).
- **Erreurs.** `0xC8A0CFF0` quand le programme qui devait reprendre la main n'est pas inscrit ; le jeu réessaie. `0xD9001830`.
- **Pour répondre.** Résultat 0. L'instruction suivante du jeu est `svcExitProcess` : il n'attend rien d'autre.

### `0x2B` PrepareToJumpToHomeMenu

Annonce un saut vers le menu HOME.

Requête : l'en-tête `0x002B0000` seul. Réponse : en-tête `0x002B0040`, mot 1 le résultat.

- **Côté module.** Refuse si un paramètre attend ou si une opération est préparée. Sinon note la case active (`0x124139`), met l'opération préparée à `0x0E`, et lance le menu HOME s'il ne tourne pas.
- **Erreurs.** `0xC8A0CC04` s'il n'y a pas de programme actif, `0xC8A0CC02`, `0xC8A0CFF0`. Le jeu réessaie sur les trois codes et ne regarde pas les autres.
- **Pour répondre.** Résultat 0. Une réimplémentation sans menu HOME a plus simple : ne jamais déposer la notification 1.

### `0x2C` JumpToHomeMenu

Passe la main au menu HOME.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x002C0044` | |
| 1 | taille des données | 0 |
| 2 | 0 | |
| 3 | poignée jointe | le contenu de `0x5d3cd0` |
| 4 | (taille << 14) \| 2 | |
| 5 | adresse des données | 0 |

Réponse : en-tête `0x002C0040`, mot 1 le résultat.

- **Côté module.** Pour une application : le menu HOME devient actif et reçoit le paramètre « expéditeur `0x300`, commande `0x0B` ».
- **Erreurs.** `0xD9001830` ; la fonction elle-même rend toujours 0.
- **Pour répondre.** Résultat 0. Le jeu envoie ensuite NotifyToWait et AppletUtility 4, puis attend un paramètre : pour le faire repartir, déposer la commande `0x0B` et lever le signal des paramètres.

### `0x31` PrepareToDoApplicationJump

Annonce que le jeu va en lancer un autre, ou se relancer.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00310100` | |
| 1 | drapeaux, un octet | 2 |
| 2, 3 | numéro de titre, 64 bits | `0xFFFFFFFF` et `0xFFFFFFFF` |
| 4 | support, un octet | 0 |

Réponse : en-tête `0x00310040`, mot 1 le résultat.

- **Côté module.** Le programme actif doit être l'application. Drapeau d'occupation 8, opération préparée `0x11`. La fonction à `0x10b0a4` choisit la cible d'après les drapeaux : 0, le titre des mots 2 et 3 ; 1, un titre déjà gardé par `ns` ; 2, **le titre de l'application en cours**, sans regarder les mots 2 et 3 ; toute autre valeur arrête `ns`.
- **Erreurs.** `0xC8A0CC04`, `0xC8A0CFF0`, `0xE0A0CC08`, `0xC880CFFA`.
- **Pour répondre.** Résultat 0. Le jeu ne passe par là que pour se relancer.

### `0x32` DoApplicationJump

Fait le saut préparé.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00320084` | |
| 1 | taille du paramètre | ramenée à 0x300 par le jeu |
| 2 | taille de la signature | ramenée à 0x20 par le jeu |
| 3 | (taille << 14) \| 2 | |
| 4 | adresse du paramètre | |
| 5 | (taille << 14) \| `0x802` | |
| 6 | adresse de la signature | |

Réponse : en-tête `0x00320040`, mot 1 le résultat.

- **Côté module.** Si le menu HOME n'est pas inscrit : `0xC8A0CFF0`. Sinon la case de l'application est vidée, les deux tampons sont gardés (`apt_SendDeliverArg`), et le menu HOME reçoit le paramètre de commande `0x11`.
- **Erreurs.** `0xC8A0CFF0` (le jeu réessaie), `0xD9001830`.
- **Pour répondre.** Résultat 0 ; le jeu s'attend à être arrêté.

### `0x3B` CancelLibraryApplet

Demande à l'applet de bibliothèque ouvert de se fermer.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x003B0040` | |
| 1 | un octet (« l'application se ferme », d'après 3dbrew) | 0 dans les quatre appels vus |

Réponse : en-tête `0x003B0040`, mot 1 le résultat.

- **Côté module.** La fonction ne lit pas son paramètre. L'applet doit avoir été lancé par le programme actif ; il reçoit le paramètre de commande `0x0C`.
- **Erreurs.** `0xC8A0CC04`, les trois codes « réessaie ».
- **Pour répondre.** Le jeu ne l'envoie qu'après un IsRegistered(`0x400`) qui répond 1. En répondant 0 à celui-ci, elle n'arrive jamais.

### `0x3E` ReplySleepQuery

Répond à la question « puis-je dormir ? ».

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x003E0080` | |
| 1 | identifiant | `0x300` |
| 2 | réponse, un octet | 1 pour accepter, 0 pour refuser |

Réponse : en-tête `0x003E0040`, mot 1 le résultat.

- **Côté module.** Une réponse nulle range la case parmi les refus (`0x124118`). Dans tous les cas la case est rangée parmi celles qui ont répondu (`0x124114`), et quand toutes les cases interrogées ont répondu, un signal léger (`0x124124`) réveille la mise en veille. Les deux côtés s'accordent sur le sens : 0 refuse.
- **Erreurs.** `0xC880CFFA` si le programme n'est pas inscrit.
- **Pour répondre.** Résultat 0. N'arrive qu'après la notification 3.

### `0x3F` ReplySleepNotificationComplete

Dit que le jeu est prêt à dormir.

Requête : en-tête `0x003F0040`, mot 1 l'identifiant `0x300`. Réponse : en-tête `0x003F0040`, mot 1 le résultat.

- **Côté module.** Même mécanique : un masque des cases prêtes (`0x124120`), et un signal léger (`0x12412c`) quand toutes le sont.
- **Erreurs.** `0xC880CFFA`.
- **Pour répondre.** Résultat 0. N'arrive qu'après la notification 5.

### `0x40` SendCaptureBufferInfo

Confie à `ns` la description des images d'écran sauvées.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00400042` | |
| 1 | taille | 0x20 |
| 2 | (taille << 14) \| 2 | |
| 3 | adresse | `0x625f64` |

Réponse : en-tête `0x00400040`, mot 1 le résultat.

- **Côté module.** La taille est prise dans le descripteur, ramenée à 0x20, et les octets copiés à `0x124630` ; la taille gardée va à `0x124150`. C'est ce que dit 3dbrew.
- **Erreurs.** `0xD9001830`.
- **Pour répondre.** Résultat 0, rien à garder.

### `0x42` SleepSystem

Demande la mise en veille.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x00420080` | |
| 1, 2 | un nombre de 64 bits | 0 et `0x40` |

Réponse : en-tête `0x00420040`, mot 1 le résultat.

- **Côté module.** Le mot 1 est masqué par `0x40000002`, le mot 2 par `0x64`, les deux sont gardés (`0x124208`, `0x12420c`), puis `ns` envoie `PTMSYSM_RequestSleep`. Si une veille est déjà demandée : `0xC8A0CFF0`.
- **Désaccord.** 3dbrew propose « une durée ? ». Un nombre dont on ne garde que cinq bits épars n'est pas une durée : c'est un masque. Son sens n'est pas lu (il part vers `ptm`).
- **Erreurs.** `0xC8A0CFF0`, tolérée par le jeu.
- **Pour répondre.** Résultat 0. N'arrive qu'après la notification 10, que `ns` ne dépose jamais.

### `0x43` NotifyToWait

Prévient que le jeu se met en attente.

Requête : en-tête `0x00430040`, mot 1 l'identifiant `0x300`. Réponse : en-tête `0x00430040`, mot 1 le résultat.

- **Côté module.** Rien : l'aiguillage répond 0 sans appeler de fonction et sans lire le mot 1. 3dbrew dit la même chose.
- **Pour répondre.** Résultat 0. Elle sert de repère : le jeu l'envoie juste avant chaque attente d'un paramètre.

### `0x44` GetSharedFont

Rend la police du système, rangée dans une mémoire partagée.

Requête : l'en-tête `0x00440000` seul.

| Mot de la réponse | Contenu écrit par `ns` | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x00440082` | non |
| 1 | résultat | oui |
| 2 | l'adresse du bloc (`0x1241d4`) | oui : gardée à `0x5d4270` |
| 3 | 0 : une poignée copiée | non |
| 4 | la poignée du bloc de mémoire partagée (`0x1241d8`) | oui : gardée à `0x5d4274` |

- **Côté module.** Attend d'abord la fin du fil qui charge la police. Le bloc fait 0x332000 octets ; son premier mot vaut 1 à la création, **2 quand la police est chargée**, 3 en cas d'échec.
- **Côté jeu** (`0x10ee44`, appelée de `0x1088fc`). Il projette le bloc par `svcMapMemoryBlock` (`0x1F`) avec une adresse nulle et le droit de lecture, puis relit le premier mot toutes les 10 millisecondes : 2 le fait continuer, 3 l'arrête par `svcBreak`. La police elle-même est lue à `+0x80` du bloc. Un échec de la commande ou de la projection arrête aussi le jeu.
- **Erreurs.** Aucune.
- **Pour répondre.** C'est la commande la plus exigeante du démarrage : il faut un vrai bloc de mémoire partagée, son adresse dans le mot 2, un premier mot à 2, et la police du système à `+0x80`. Le format de la police n'est pas lu ici.

### `0x4B` AppletUtility

Un fourre-tout : une opération choisie par un numéro.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x004B00C2` | |
| 1 | numéro de l'opération | 4, 5 ou 7 |
| 2 | taille de l'entrée | 1 (opération 4), 8 (opération 5), 4 (opération 7) |
| 3 | taille de la sortie | 1 |
| 4 | (taille de l'entrée << 14) \| `0x402` | |
| 5 | adresse de l'entrée | |

Le jeu déclare aussi un tampon de sortie à `+0x180` et `+0x184`, comme pour ReceiveParameter.

| Mot de la réponse | Contenu écrit par `ns` | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x004B0082` | non |
| 1 | résultat | oui |
| 2 | résultat de l'opération | oui, puis ignoré par les trois appelants |
| 3 | (taille de la sortie << 14) \| 2 | non |
| 4 | adresse de la sortie chez `ns` | non |

| Opération | Entrée du jeu | Ce que fait `ns` | Envoyée par |
| --- | --- | --- | --- |
| 4 | un octet nul | si aucun drapeau d'occupation n'est levé et que la console est en train de s'endormir, relance la demande de veille | `0x11b4c4` |
| 5 | un mot à 1, puis un octet à 1 | remplace les drapeaux d'occupation (lecture des arguments incertaine) | `0x110064` |
| 7 | un mot : `0x10` pour une application, `0x20`, `0x40` ou `0x80` selon la position, ou 1 | baisse les drapeaux d'occupation : si l'un des bits donnés est levé, tous sont remis à zéro | `0x11b46c` |

- **Côté module.** En-tête entier et descripteur vérifiés. Onze autres opérations existent (0 à 3, 6, 10 à 12, 16 à 18), que le jeu n'envoie pas.
- **Erreurs.** `0xD9001830`. La fonction rend toujours 0.
- **Pour répondre.** Résultat 0, mot 2 nul. Rien à faire tant qu'on ne tient pas de drapeaux d'occupation.

### `0x4D` GetAppletProgramInfo

Donne la version d'un applet installé. Atteinte seulement par une fonction qu'un `.cro` importe. Module survolé.

| Mot de la requête | Contenu | Valeur envoyée par le jeu |
| --- | --- | --- |
| 0 | `0x004D0080` | |
| 1 | identifiant | `0x114` |
| 2 | drapeaux | `0x11` |

Réponse : en-tête `0x004D0080`, mot 1 le résultat, mot 2 la version sur 16 bits. Le jeu lit les deux.

- **Côté module.** Le bit `0x10` dit que le mot 1 est un identifiant d'applet, traduit en numéro de titre par la table de la fiche `ns` ; les bits 1, 2 et 4 choisissent où chercher. La version rendue est masquée par `0xFC00`. Les appels à `am` qui la trouvent ne sont pas lus.
- **Côté jeu.** `0x2d1820` s'en sert pour savoir si l'applet `0x114` existe : elle rend 1 quand le résultat n'est pas négatif. `0x2d16c8` la renvoie juste avant de lancer l'applet, et là une erreur mène à l'écran d'erreur avec le code `0xE0A13C02`.
- **Erreurs.** `0xC880CFFA`, `0xC8A0CC04`, ou une erreur d'`am`.
- **Pour répondre.** Une erreur dit « cet applet n'est pas installé » à la première fonction. Que le jeu teste toujours avant de lancer n'est pas vérifié : les appelants sont dans des `.cro`.

## Partie 5 : les désaccords

| Sujet | Ce que dit l'un | Ce que dit l'autre |
| --- | --- | --- |
| Mot 3 de GetLockHandle | 3dbrew et le jeu : deux bits d'état | le module : toujours 0 |
| Mot 7 de ReceiveParameter et GlanceParameter | 3dbrew : la taille copiée | le module : la taille demandée, plafonnée à 0x1000 |
| Taille de SendParameter | 3dbrew et le jeu donnent le mot 4 | le module ne lit que le descripteur du mot 7 |
| SleepSystem | 3dbrew : « une durée ? » | le module : un masque de 64 bits |
| Paramètre de CancelLibraryApplet | 3dbrew : un octet « l'application se ferme » | le module ne le lit pas |
| Position 6 dans Initialize | 3dbrew : permise | le module s'arrête dès 6 |
| Ordre sous `apt_enable_and_wait` | `pokemon-x-services.md`, étape 2 : AppletUtility puis Enable (ordre des adresses) | l'exécution : Enable, NotifyToWait, GlanceParameter, ReceiveParameter, AppletUtility 7, AppletUtility 4. L'appel placé avant Enable reçoit 0 et n'envoie rien |
| Premier lancement | `pokemon-x-services.md` trouve sous `0x11b074` des envois à `gsp`, `dsp` et `cam`, « pas forcément ceux d'un premier lancement » | précision : avec la commande 1 aucun ne part, ils sont réservés aux retours (`0x0A`, `0x0B` et suivantes) |
| Réponses minimales du démarrage | `ns.md`, partie 4 : GetLockHandle, Initialize, Enable et un paramètre | le jeu envoie aussi NotifyToWait, GlanceParameter avant ReceiveParameter, deux AppletUtility, puis GetSharedFont |
| Bouton HOME | `ns.md`, partie 6 : InquireNotification, PrepareToJumpToHomeMenu, JumpToHomeMenu (ordre de libctru) | le jeu intercale IsRegistered, GetAppletManInfo, SendParameter `0x10`, l'attente de la commande 3 et SendCaptureBufferInfo |

Aucun de ces écarts n'empêche de répondre : pour chacun la rubrique dit quoi rendre.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les mots de requête et de réponse des 29 commandes : écrits par la fonction d'envoi du jeu, lus par l'aiguillage de `ns`, et inversement. Les deux lectures tombent sur les mêmes positions, et sur celles de 3dbrew, aux écarts près de la partie 5.
- Les trois codes « réessaie » : comparés en dur à neuf endroits du jeu, et rendus par les fonctions de `ns` correspondantes.
- L'ordre des deux signaux d'Initialize : `ns` écrit le signal des notifications dans le mot 3, et le jeu envoie InquireNotification quand c'est le rang 0, celui du mot 3, qui sonne.
- Le sens de ReplySleepQuery (0 refuse) et les deux particularités de la boîte aux lettres (commandes 8 et 9 retirées par GlanceParameter, bit `0x10000` qui désinscrit).
- Le premier mot du bloc de la police : `ns` y écrit 2 ou 3, le jeu attend 2 et s'arrête sur 3.
- L'aiguillage des notifications : le pseudo-code et la table de saut de l'assembleur donnent les mêmes 12 cases.
- L'expéditeur du premier paramètre n'est lu par personne : références de Ghidra et recherche de mots dans le fichier.

**Interprété à la lecture, à relire dans Ghidra**
- Les noms donnés aux octets d'état du jeu et aux fonctions du jeu.
- Le sens des notifications : le code montre ce que le jeu fait de chaque valeur, les mots « question », « endormissement », « réveil », « annulation » sont déduits de la réponse qu'il renvoie.
- Le chemin du bouton HOME dans la boucle principale : les fonctions qui envoient les commandes sont lues, la condition qui choisit entre accepter et refuser ne l'est pas.
- Le lien entre les drapeaux « fermeture demandée » et la sortie de la boucle principale.
- Les arguments de trois appels de `ns` que le pseudo-code a perdus (opération 5 d'AppletUtility, `launch_applet_title`, le remplacement des drapeaux).
- Les noms des applets : `0x401`, `0x406` et `0x114` ne sont pas nommés dans le code.
- Le niveau d'un code de résultat (5 bits du haut) : c'est le calcul que fait le jeu, les noms des niveaux ne sont pas dans le code.

**Pas lu**
- Côté module : les fonctions de travail du fil ouvrier derrière StartSystemApplet, les appels à `am` de GetAppletProgramInfo, `apt_SendDeliverArg`, `parameter_store`, `launch_applet_title`, la caméra autour du menu HOME, et toute la mise en veille après les deux réponses du jeu.
- Côté jeu : ce que contiennent les données envoyées aux applets et les 0x20 octets de capture d'écran ; les fonctions qui décident d'ouvrir un applet ; la boucle principale au-delà des appels cités ; les onze opérations d'AppletUtility que le jeu n'envoie pas.
- Le format de la police partagée.
- Rien n'a été exécuté : ni le jeu, ni le module. Une commande décrite ici peut ne jamais partir pendant une partie.

## Comment ce document a été fait

| Étape | Qui | Durée |
| --- | --- | --- |
| Lire le pseudo-code du jeu (`local/analyse/maj/gh/`) et du module (`local/analyse/ns/pseudo/`), déjà produits | Claude | le gros du temps |
| Remonter les appelants des 29 fonctions d'envoi | un script sur les références de Ghidra (`refs.tsv`) | immédiat |
| Remplacer dans le pseudo-code du jeu les constantes de fin de fonction par leur valeur | un script | immédiat |
| Relire dans l'assembleur ce que le pseudo-code perd | un script autour de `capstone`, et l'objdump du module laissé par la fiche `ns` | à la demande |
| Chercher qui lit une adresse | les références de Ghidra, puis une recherche de mots dans le fichier entier | immédiat |
| Lire ce que 3dbrew dit de chaque commande | la Carte des services | immédiat |

Aucune analyse n'a été relancée, aucun pont REA ouvert. Les scripts et les extraits de pseudo-code sont dans `local/analyse/contrat-apt/`, non versionné.

**Les pièges rencontrés.**
- Le pseudo-code du jeu perd souvent les arguments d'un appel : Enable, NotifyToWait et AppletUtility y apparaissent sans paramètre. Les valeurs de ce document viennent de l'assembleur.
- Les constantes du jeu sont affichées sous le nom de leur case (`DAT_…`) et non par leur valeur. Sans remplacement, les octets d'état sont illisibles.
- Le pseudo-code du module, lui, montre directement les adresses de données. Appliquer le même remplacement aux deux donne des valeurs fausses pour `ns`.
- Les paramètres passés par la pile apparaissent dans l'aiguillage de `ns` comme des affectations à des variables locales juste avant l'appel : il faut les compter pour retrouver l'ordre des arguments.
- Les adresses du jeu et celles du module commencent toutes deux à `0x100000`, et plusieurs se ressemblent (`0x1103e4` est une fonction d'envoi du jeu, `0x1103e0` la fonction d'AppletUtility de `ns`).

**Pour reprendre.** La suite utile est de regarder le jeu tourner, pour savoir si les réponses de la partie 2 suffisent vraiment, puis de lire le format de la police partagée, seule donnée lourde du démarrage. Côté module, les fonctions de travail du fil ouvrier restent le grand trou d'`APT`.
