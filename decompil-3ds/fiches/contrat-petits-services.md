# Le contrat des petits services : `srv:`, `hid:USER`, `cfg:u`, `ptm:u`, `err:f`, `ldr:ro`

Cette fiche dit, commande par commande, ce que Pokémon X envoie à six guichets de la console, ce que le module en fait, et ce qu'il faut rendre si on répond à sa place. C'est le « contrat » qu'un portage sur PC devra tenir.

Fiche du 14 octobre 2026. Elle prolonge l'inventaire (`pokemon-x-services.md`), qui ne relevait que les en-têtes : ici on lit les paramètres et l'usage des réponses. Chaque commande est lue **des deux côtés** quand le module est dumpé : dans le jeu (la fonction qui envoie) et dans le module (la fonction qui reçoit). Ce sont deux preuves indépendantes, et elles se recoupent. Tout est statique : on lit le code, on ne regarde pas le jeu tourner.

Le vocabulaire (poignée, en-tête, tampon du fil, descripteur) est celui de `sm.md`. Rappel : une requête est une suite de mots de 32 bits écrits dans le tampon du fil ; le mot 0 est l'en-tête, la réponse revient au même endroit, et son mot 1 est le résultat (négatif = erreur).

## Synthèse

22 commandes : 17 lues des deux côtés, 5 d'un seul côté (le jeu), aucune laissée de côté.

| Service | En-tête | Commande | Fonction du jeu | Fonction du module | Lecture |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x00010002` | RegisterClient | `0x119c68` | dans `srv_handle_command` (`0x103a44`) | des deux côtés |
| `srv:` | `0x00020000` | EnableNotification | `0x10f980` | `srv_EnableNotification` (`0x103318`) | des deux côtés |
| `srv:` | `0x00050100` | GetServiceHandle | `0x163c10` | `srv_GetServiceHandle` (`0x102dfc`) | des deux côtés |
| `srv:` | `0x00090040` | Subscribe | `0x10f9bc` | `srv_Subscribe` (`0x1037c8`) | des deux côtés |
| `srv:` | `0x000B0000` | ReceiveNotification | `0x119ca4` | `srv_ReceiveNotification` (`0x1035d0`) | des deux côtés |
| `hid:USER` | `0x000A0000` | GetIPCHandles | `0x1247b8` | `hid_GetIPCHandles` (`0x1067a8`) | des deux côtés |
| `hid:USER` | `0x00110000` | EnableAccelerometer | `0x1ef348` | `hid_EnableAccelerometer` (`0x106908`) | des deux côtés |
| `hid:USER` | `0x00120000` | DisableAccelerometer | `0x1ef378` | `hid_DisableAccelerometer` (`0x104780`) | des deux côtés |
| `hid:USER` | `0x00130000` | EnableGyroscopeLow | `0x1ef2e8` | `hid_EnableGyroscopeLow` (`0x106800`) | des deux côtés |
| `hid:USER` | `0x00140000` | DisableGyroscopeLow | `0x1ef318` | `hid_DisableGyroscopeLow` (`0x1046c8`) | des deux côtés |
| `hid:USER` | `0x00150000` | GetGyroscopeLowRawToDpsCoefficient | `0x1ef404` | dans l'aiguillage (`0x10355c`) | des deux côtés |
| `hid:USER` | `0x00160000` | GetGyroscopeLowCalibrateParam | `0x1ef3a8` | `hid_GetGyroscopeLowCalibrateParam` (`0x107258`) et l'aiguillage (`0x103578`) | des deux côtés |
| `cfg:u` | `0x00010082` | GetConfigInfoBlk2 | `0x1240f8` | `config_get_block_locked` (`0x105fc4`) | des deux côtés |
| `cfg:u` | `0x00020000` | SecureInfoGetRegion | `0x118a24` | `secure_info_get_region` (`0x102c38`) | des deux côtés |
| `cfg:u` | `0x00030040` | GenHashConsoleUnique | `0x1240b0` | `gen_hash_console_unique` (`0x105eac`) | des deux côtés |
| `cfg:u` | `0x00040000` | GetRegionCanadaUSA | `0x146bd4` | `get_region_canada_usa` (`0x1043ac`) | des deux côtés |
| `ptm:u` | `0x000B00C2` | GetStepHistory | `0x124d24` | `ptm_GetStepHistory` (`0x104c3c`) | des deux côtés (le calcul des pas est survolé) |
| `err:f` | `0x00010800` | Throw | `0x124780` | module `errdisp` lu depuis (fiche `errdisp.md`) | jeu seulement ici |
| `ldr:ro` | `0x000100C2` | Initialize | `0x133fa8` | module `ro` lu depuis (fiche `ro.md`) | jeu seulement ici |
| `ldr:ro` | `0x00020082` | LoadCRR | `0x118548` | idem | jeu seulement |
| `ldr:ro` | `0x000402C2` | LoadExeCRO | `0x1e793c` | idem | jeu seulement |
| `ldr:ro` | `0x000500C2` | UnloadCRO | `0x146a0c` | idem | jeu seulement |

Dans toutes les fonctions d'envoi du jeu, la réponse n'est lue que si l'appel système a réussi, et la fonction rend alors le mot 1 (le résultat du service). Ce point ne sera pas répété.

Les noms de fonctions du jeu proposés par ce document sont repris dans la dernière partie ; ils ont été versés depuis dans `pokemon-x.noms.tsv`.

## Partie 1 : `srv:`

Port ouvert par `svcConnectToPort("srv:")` ; poignée du jeu à `0x5e8124`. Module : `sm`.

### RegisterClient (`0x00010002`)

Rôle : le jeu se présente à `sm`, qui retient son numéro de processus pour toutes les commandes suivantes.

| Mot | Requête (jeu, `0x119c68`) | Lu par `sm` |
| --- | --- | --- |
| 0 | `0x00010002` | comparé en entier |
| 1 | `0x20` : « noyau, écris ici mon numéro de processus » | doit valoir `0x20` |
| 2 | rien (le noyau y met le numéro) | rangé dans le contexte de la session |

| Mot | Réponse (`sm`) | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x00010040` | non |
| 1 | 0 | oui |

Erreur : `0xD9001830` si l'en-tête ou le mot 1 ne sont pas ceux attendus.

Quand : une seule fois, dans `srv_connect_and_register` (`0x10f8e0`), au tout début du démarrage. Si le port n'existe pas encore, la fonction attend et réessaie.

Pour répondre à la place de la console : rendre 0. Le numéro de processus n'a pas besoin d'être vrai.

### EnableNotification (`0x00020000`)

Rôle : obtenir le sémaphore que `sm` libère chaque fois qu'une notification arrive pour ce processus.

Requête : l'en-tête seul. `sm` ne regarde que le numéro de commande.

| Mot | Réponse (`sm`) | Lu par le jeu (`0x10f980`) |
| --- | --- | --- |
| 0 | `0x00020042` | non |
| 1 | résultat | oui |
| 2 | 0 : « noyau, copie la poignée qui suit » | non |
| 3 | la poignée du sémaphore | oui, rangée à `0x5e8114` |

Côté module : `srv_EnableNotification` cherche la fiche du processus dans la liste de la session. Elle existe déjà pour un jeu (c'est `pm` qui l'a créée par RegisterProcess). Elle y met l'octet « notifications permises » à 1 et rend le sémaphore de la fiche, créé avec un maximum de 16. Erreur : `0xD8806404` si la fiche n'existe pas et ne peut pas être créée.

Quand : dans `startup_init_srv` (`0x1098ac`), juste après RegisterClient. Si la commande réussit, le jeu crée aussitôt un fil, `srv_notification_thread_main` (`0x10f7c4`), décrit plus bas.

Pour répondre à la place de la console : rendre un sémaphore (ou un objet sur lequel on peut attendre) qui n'est libéré que lorsqu'une notification est vraiment en file. Voir ReceiveNotification pour la raison.

### GetServiceHandle (`0x00050100`)

Rôle : ouvrir une session vers un service nommé. Le déroulement côté `sm` est décrit pas à pas dans `sm.md`, partie 4.

| Mot | Requête (jeu, `0x163c10`) | Lu par `sm` |
| --- | --- | --- |
| 0 | `0x00050100` | le numéro seulement |
| 1, 2 | le nom, 8 octets recopiés tels quels depuis la chaîne | oui |
| 3 | la longueur du nom | oui |
| 4 | un drapeau | oui, le bit 0 |

| Mot | Réponse (`sm`) | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x00050042` | non |
| 1 | résultat | oui |
| 2 | `0x10` : « noyau, déplace la poignée qui suit » | non |
| 3 | la poignée de la session | oui, rangée dans la variable du service |

Le drapeau : quand le service a déjà toutes ses sessions prises (`0xD0401834`), `sm` met la demande en attente si le bit 0 vaut 0, et rend l'erreur tout de suite s'il vaut 1. Le jeu passe 0 partout, sauf pour trois services où il passe 1 : `mic:u` (`0x1ef62c`), `y2r:u` (`0x2b28bc`) et `cam:u` (`0x2ca404`). Relevé sur les 27 demandes : 20 passent par `srv_get_service_handle` (17 avec 0, 3 avec 1), les 7 autres par deux variantes qui mettent toujours 0.

Erreurs de `sm` : `0xD9006405` (longueur), `0xD9006407` (zéro dans le nom), `0xD8E06406` (pas le droit). Avant même d'envoyer, le jeu refuse de lui-même si `srv:` n'est pas ouvert (`0xD8A067F8`) ou si le nom dépasse 8 caractères (`0xD9006405`).

Ce que le jeu fait d'un échec dépend du service : pour `hid:USER` il s'arrête net (`svcBreak`), pour `cfg:u` il essaie un autre service (partie 3), pour `ldr:ro` il rend l'erreur à son appelant.

Pour répondre à la place de la console : rendre une poignée différente par nom, et 0. La liste des 23 noms demandés est dans l'inventaire, partie 2.

### Subscribe (`0x00090040`)

Rôle : demander à recevoir une notification donnée.

| Mot | Requête (jeu, `0x10f9bc`) | Lu par `sm` |
| --- | --- | --- |
| 0 | `0x00090040` | le numéro seulement |
| 1 | le numéro de la notification | oui |

Réponse : `0x00090040`, puis le résultat.

Côté module : `srv_Subscribe` retrouve la fiche du processus (il faut qu'EnableNotification soit passé, sinon `0xD8806404`), refuse un numéro déjà inscrit (`0xD9006403`), refuse au-delà de 17 abonnements (`0xD9006405`), sinon ajoute le numéro à la liste.

Le jeu ne s'abonne qu'à **une seule** notification : voir « Les notifications » ci-dessous.

Pour répondre à la place de la console : rendre 0 et retenir le numéro.

### ReceiveNotification (`0x000B0000`)

Rôle : lire le numéro de la notification qui vient d'arriver.

Requête : l'en-tête seul.

| Mot | Réponse (`sm`) | Lu par le jeu (`0x119ca4`) |
| --- | --- | --- |
| 0 | `0x000B0080` | non |
| 1 | résultat | oui |
| 2 | le numéro de la notification | oui |

Côté module : la fiche du processus porte une file de 16 numéros en anneau. `srv_ReceiveNotification` en retire le plus ancien. **S'il n'y en a aucun, elle rend `0xD8806404`.**

Pour répondre à la place de la console : ne jamais libérer le sémaphore sans avoir mis un numéro en file. Le fil du jeu arrête le programme (`svcBreak`) si ReceiveNotification rend une erreur.

### Les notifications : ce que le jeu écoute et ce qu'il en fait

**Le fil.** `srv_notification_thread_main` (`0x10f7c4`) tourne en boucle : il attend le sémaphore de `0x5e8114` sans limite de temps, envoie ReceiveNotification, cherche le numéro reçu dans la liste des gestionnaires du jeu (tête à `0x5e8118`, sous le verrou `0x64521c`), et appelle la première fonction de la table virtuelle du gestionnaire trouvé. Un numéro sans gestionnaire est ignoré.

**Les gestionnaires.** `srv_register_notification_handler` (`0x10f734`) ajoute un objet à la liste et note le numéro à `+0x0C` de l'objet. Elle n'a que deux appelants.

| Notification | Abonnement | Inscrit par | Objet | Fonction appelée | Ce qu'elle fait |
| --- | --- | --- | --- | --- | --- |
| `0x100` | aucun (comme dans les modules : `pm` l'envoie directement au processus) | `startup_init_apt` (`0x106544`) | `0x625f54` | `0x326330` | rien : la fonction revient aussitôt |
| `0x209` | Subscribe, envoyé par `0x10972c` | `0x10972c`, appelée par `game_init_systems` (`0x108108`) | `0x626138` | `0x1e044c` | lance une erreur fatale, code `0xC88044AA` (partie 5) |

**Recoupement des numéros.**

- `0x209` : 3dbrew (« Services », tableau des notifications) la donne comme « SD card removed », écoutée par NS et le menu. `ns.md` montre `ns` inscrire un objet pour `0x209` (et `0x20A`, la cartouche retirée) qui mène lui aussi à une erreur fatale. `ptm.md` ne la publie pas : elle n'est pas dans ses dix notifications. Le sens colle au jeu : la mise à jour tourne depuis la carte SD (`rom2:`), si on retire la carte le jeu ne peut plus continuer.
- `0x100` : « le destinataire doit se terminer » d'après 3dbrew, et les fiches `hid`, `cfg`, `ptm`, `ns` l'utilisent ainsi. Le jeu l'accepte mais n'en fait rien ici : sa fermeture passe par `APT:U`.
- Les notifications de veille (`0x101` à `0x108`) et du couvercle (`0x213`, `0x214`) de `ptm.md` : le jeu ne s'y abonne pas. Il apprend la veille par `APT:U` (`ns` les reçoit et les traduit, voir `ns.md`, partie 6).

Pour un portage : n'envoyer `0x209` que si on veut simuler le retrait de la carte. En pratique, ne jamais rien publier suffit.

## Partie 2 : `hid:USER`

Poignée à `0x5e9648`. Module : `hid`. Le service est ouvert par `hid_open_session` (`0x118c70`), appelée une fois depuis `game_init_systems` (`0x10822c`). Un second appel rendrait `0xE0A04FF9` sans rien envoyer (octet « déjà fait » à `0x5e7f90`).

### GetIPCHandles (`0x000A0000`)

Rôle : recevoir la page de mémoire partagée et cinq signaux.

Requête : l'en-tête seul. Le module ne regarde que le numéro.

| Mot | Réponse (`hid`, voir `hid.md` partie 4) | Lu par le jeu (`0x1247b8`) | Rangé dans l'objet `0x642040` |
| --- | --- | --- | --- |
| 0 | `0x000A0047` | non | |
| 1 | résultat | oui | |
| 2 | `0x14000000` : « six poignées à copier » | non | |
| 3 | la mémoire partagée | oui | projetée, adresse à `+0x34` |
| 4 | signal des boutons | oui | `+0x00` |
| 5 | signal du tactile | oui | `+0x08` |
| 6 | signal de l'accéléromètre | oui | `+0x10` |
| 7 | signal du gyroscope | oui | `+0x1C` |
| 8 | signal du pad de débogage | oui | `+0x24` |

Erreur du module : `0xD8804FEF` si la session n'a pas de case.

Ce que fait le jeu ensuite, dans la même fonction : il projette la mémoire en lecture seule pour 0x2B0 octets (`svcMapMemoryBlock`, à une adresse qu'il choisit lui-même) et calcule cinq pointeurs de section, rangés à côté de chaque signal : la base (`+0x04`), base `+0xA8` (`+0x0C`), base `+0x108` (`+0x14`), base `+0x158` (`+0x20`), base `+0x238` (`+0x28`). **Ce sont exactement les cinq décalages de `hid.md`, partie 5, et la même taille 0x2B0.** Un échec à l'ouverture du service ou à la commande arrête le programme ; le résultat de la projection, lui, n'est pas regardé.

Pour répondre à la place de la console : rendre une page partagée d'au moins 0x2B0 octets, tenue à jour comme décrit plus bas, et cinq poignées valides. Le jeu n'attend sur aucune des cinq (voir plus bas) : elles peuvent ne jamais être déclenchées.

### EnableAccelerometer, DisableAccelerometer (`0x00110000`, `0x00120000`)

Rôle : allumer et éteindre l'accéléromètre. Requête : l'en-tête seul. Réponse : `0x00110040` ou `0x00120040`, puis 0 (le module ne rend jamais d'erreur ici).

Côté module : un compteur commun à tous les clients (`0x10c010`). Le capteur n'est allumé qu'au premier Enable et éteint qu'au dernier Disable ; le module compte aussi les activations de chaque session, pour les annuler si le client se ferme sans prévenir.

Côté jeu : Enable est envoyé par le constructeur d'un lecteur d'accéléromètre (`0x1eef9c`), Disable par son destructeur (`0x1ef024`). Le résultat n'est pas regardé.

Pour répondre à la place de la console : rendre 0. Tant qu'un lecteur existe, tenir à jour la section `0x108`.

### EnableGyroscopeLow, DisableGyroscopeLow (`0x00130000`, `0x00140000`)

Même forme : l'en-tête seul, réponse `0x00130040` ou `0x00140040` puis 0. Côté module : un compteur commun (`0x10c00c`) et un par session ; au premier Enable le gyroscope est mis sous tension, et l'heure est notée dans la case de la session.

Côté jeu : Enable est envoyé par le constructeur d'un lecteur de gyroscope (`0x1ee3ec`), qui construit aussi un lecteur d'accéléromètre : **ouvrir le gyroscope envoie donc EnableAccelerometer puis EnableGyroscopeLow**. Le destructeur (`0x1ee5ec`) envoie DisableGyroscopeLow puis DisableAccelerometer.

### GetGyroscopeLowRawToDpsCoefficient (`0x00150000`)

Rôle : le nombre par lequel diviser une valeur brute du gyroscope pour avoir des degrés par seconde.

Requête : l'en-tête seul.

| Mot | Réponse (`hid`) | Lu par le jeu (`0x1ef404`) |
| --- | --- | --- |
| 0 | `0x00150080` | non |
| 1 | 0 | oui |
| 2 | le nombre flottant `0x41660000`, soit 14,375 | oui, comme flottant |

Le module ne calcule rien : c'est une constante écrite dans l'aiguillage.

### GetGyroscopeLowCalibrateParam (`0x00160000`)

Rôle : l'étalonnage du gyroscope, 18 octets, soit neuf nombres de 16 bits : pour chaque axe le zéro, puis deux valeurs de référence (3dbrew : zéro, « plus », « moins »).

Requête : l'en-tête seul.

| Mot | Réponse (`hid`) | Lu par le jeu (`0x1ef3a8`) |
| --- | --- | --- |
| 0 | `0x00160180` | non |
| 1 | 0 | oui |
| 2 à 5 | 16 octets | oui |
| 6 | 2 octets (la moitié basse du mot) | oui, 2 octets |

Côté module : `hid_GetGyroscopeLowCalibrateParam` recopie les neuf nombres gardés à `0x10d12e` (lus au démarrage dans le bloc de configuration `0x00040002`). Mais l'aiguillage ne les rend pas dans cet ordre : il garde le premier axe tel quel, **échange les deux autres axes, et change le signe du zéro de l'un d'eux**. L'ordre rendu, en numéros de nombres gardés : 0, 1, 2, puis l'opposé du 6, 7, 8, puis 3, 4, 5.

Côté jeu : les deux commandes sont envoyées par la remise à zéro du lecteur de gyroscope (`0x1edbbc`, aux adresses `0x1ed484` et `0x1ed4ec`). Pour chaque axe le jeu garde le zéro, et divise le coefficient par (la seconde valeur moins la troisième) pour obtenir son échelle. **Une erreur à l'une des deux commandes arrête le programme.**

Pour répondre à la place de la console : rendre 14,375 et un étalonnage où, sur chaque axe, les deux valeurs de référence sont différentes (sinon le jeu divise par zéro). Les valeurs d'usine sont dans le bloc `0x00040002` de la console.

### La mémoire partagée : ce que le jeu lit

**Quatre lecteurs, un par section.** Ce sont quatre fonctions voisines de la bibliothèque, toutes de la même forme. Une recherche de leur motif dans tout le code n'en trouve aucune autre.

| Section | Décalage | Lecteur d'anneau | Entrées lues | Champs recopiés par entrée | Appelé par |
| --- | --- | --- | --- | --- | --- |
| boutons | `0x000` | `0x2cd3ec` | 8 de 0x10 octets, à partir de `+0x28` | `+0`, `+4`, `+8` (4 octets chacun), `+0xC`, `+0xE` (2 octets chacun) | `hid_PadReader_ReadLatest` (`0x1ef4b0`) |
| tactile | `0x0A8` | `0x2cd5c0` | 8 de 8 octets, à partir de `+0x20` | `+0`, `+2` (2 octets), `+4` (1 octet) | `hid_TouchPanelReader_ReadLatest` (`0x1ee634`) |
| accéléromètre | `0x108` | `0x2cd8a8` | 8 de 6 octets, à partir de `+0x20` | trois fois 2 octets | `0x1ee86c` et `0x1eebb0` |
| gyroscope | `0x158` | `0x2cd734` | 32 de 6 octets, à partir de `+0x20` | trois fois 2 octets | `0x1edd28` |
| pad de débogage | `0x238` | aucun | | | personne |

Recoupement avec `hid.md`, partie 5, champ par champ : même décalage de chaque section, même taille d'en-tête (0x28 pour les boutons, 0x20 pour les trois autres), même nombre d'entrées (8, 8, 8, 32), même taille d'entrée (0x10, 8, 6, 6), même contenu (boutons tenus, pressés, relâchés puis X et Y du pad circulaire ; X, Y et « touché » ; trois valeurs). Aucun écart. 3dbrew (« HID Shared Memory ») dit la même chose.

**Ce que le jeu fait de l'en-tête de section.** Les quatre lecteurs suivent la même règle :

1. Ils lisent le numéro de la dernière entrée (`+0x10`), l'heure (`+0x00`, 64 bits) et l'heure précédente (`+0x08`).
2. Un numéro négatif veut dire « rien d'écrit » : ils ne rendent rien. C'est l'état que pose `reset_section_header` de `hid` (cinq mots à `0xFFFFFFFF`).
3. Ils comparent l'heure de la section à l'heure et au numéro gardés par l'appelant depuis sa lecture précédente, pour savoir combien d'entrées sont nouvelles : même tour d'anneau (différence des numéros), tour suivant (différence plus la taille de l'anneau), ou plus d'un tour de retard (le maximum demandé).
4. Ils recopient les entrées **de la plus récente à la plus ancienne**, 7 au plus (31 pour le gyroscope).
5. Ils relisent le numéro et les deux heures. Si l'un des trois a changé pendant la copie, ils recommencent tout. C'est ce qui remplace un verrou entre `hid` et le jeu.
6. Ils rendent le nombre d'entrées, et la nouvelle heure et le nouveau numéro à garder.

L'heure n'est donc jamais convertie ni affichée : elle sert de numéro de tour. Les champs propres à la section des boutons (`+0x18` le curseur 3D, `+0x1C` l'état brut, `+0x20` le pad circulaire brut) et la valeur brute des autres sections (`+0x18`) ne sont lus par aucun des quatre lecteurs.

**Boutons et tactile : la dernière entrée seulement.** `hid_PadReader_ReadLatest` et `hid_TouchPanelReader_ReadLatest` demandent une seule entrée, en disant n'avoir jamais rien lu : ils reçoivent la plus récente. Puis, pour les boutons :

- le jeu applique sa propre zone morte au pad circulaire (`0x1ee7d8`) ;
- il efface le bit `0x2000` des boutons tenus ;
- il **recalcule lui-même** « pressés » et « relâchés » en comparant avec sa lecture précédente : les deux champs écrits par `hid` sont recopiés puis écrasés ;
- il traite Select comme Start (`0x2cd318`), sauf si l'octet `0x5e7fc8` est levé ;
- il remet tout à zéro, boutons et tactile, quand l'octet `0x5d3cca` est levé et l'octet `0x5d3ce9` baissé (deux octets rangés avec l'état d'APT : sans doute « le jeu n'est pas au premier plan »), et ne lit rien quand l'octet `0x5ea69b` vaut 4.

D'un portage, le jeu n'utilise donc vraiment que : les boutons tenus (`+0` de l'entrée), le pad circulaire (`+0xC`, `+0xE`), et les trois champs du tactile. Les bits lus ensuite par les objets du jeu (`0x4978b8`, `0x497dc8`) sont ceux de 3dbrew : A `0x1`, B `0x2`, Start `0x8`, droite `0x10`, gauche `0x20`, haut `0x40`, bas `0x80`, R `0x100`, L `0x200`, X `0x400`, Y `0x800`, et les quatre directions du pad circulaire `0x10000000` à `0x80000000`.

**À quel rythme.** Les deux lectures sont faites par `input_manager_update` (`0x358238`), une méthode de l'objet d'entrées du jeu (table virtuelle `0x59ae70`, construit par `0x10a748` depuis `game_init_systems`). Elle n'est appelée que par la table virtuelle : le rythme ne se lit pas statiquement. C'est très probablement une fois par image, et sûrement pas sur un signal : la bibliothèque `hid` du jeu (`0x1ecb00` à `0x1ef5e0`) ne contient aucun appel système d'attente, seulement des fermetures de poignées et des lectures d'horloge.

**Accéléromètre et gyroscope : à la demande.** Leurs lecteurs ne sont pas créés au démarrage. L'objet d'entrées les fabrique quand une partie du jeu les réclame (`0x358784` pour l'accéléromètre, `0x358504` pour le gyroscope) et les détruit quand plus personne n'en veut (`0x358918`, `0x358708`). Ces méthodes ne sont appelées que par la table virtuelle : quel écran les demande n'est pas établi. Eux gardent l'heure et le numéro d'une lecture à l'autre, pour recevoir toutes les mesures arrivées entre-temps.

**Les signaux.** Les cinq poignées sont rangées à l'ouverture et refermées à l'arrêt (`0x1ece2c`, six fermetures : la mémoire et les cinq signaux). Entre les deux, aucune fonction lue n'attend dessus. Le cinquième, celui du pad de débogage, et sa section ne servent à rien dans ce jeu.

Pour un portage : écrire dans la page, à chaque lecture des périphériques, une nouvelle entrée de boutons et une de tactile, puis le numéro de l'entrée ; en repassant à l'entrée 0, recopier l'heure dans « heure précédente » puis noter la nouvelle. L'ordre compte à cause de l'étape 5 ci-dessus. Les 4 ms de la console ne sont pas une obligation : le jeu ne prend que la dernière entrée.

## Partie 3 : `cfg:u`

Poignée à `0x5e9144`. Module : `cfg`. Les quatre commandes existent telles quelles dans `cfg:s` et `cfg:i`.

### GetConfigInfoBlk2 (`0x00010082`)

Rôle : lire un bloc de configuration. Le déroulement côté module est décrit en 12 étapes dans `cfg.md`, partie 4.

| Mot | Requête (jeu, `0x1240f8`) | Lu par `cfg` |
| --- | --- | --- |
| 0 | `0x00010082` | comparé en entier |
| 1 | la taille | non |
| 2 | l'identifiant du bloc | oui |
| 3 | `taille × 16 + 0xC` | oui : le type `0xC` et la taille |
| 4 | l'adresse du tampon | oui |

| Mot | Réponse (`cfg`) | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x00010042` | non |
| 1 | résultat | oui |
| 2, 3 | le descripteur et l'adresse, pour que le noyau rende le tampon | non |

Les deux côtés s'accordent mot pour mot. La donnée ne passe pas par le tampon de commande : le noyau projette le tampon du jeu chez `cfg`, qui écrit dedans.

Erreurs du module : `0xD9001830` (en-tête ou descripteur), `0xD90103EC` (taille nulle, trop grande, ou différente de celle du bloc), `0xD90103FA` (bloc inconnu), `0xD90103EA` (bloc sans le droit 2).

Pour répondre à la place de la console : recopier dans le tampon la valeur du bloc demandé, à la taille exacte, et rendre 0. La liste complète des blocs suit.

### Les blocs que le jeu demande

23 appels à `cfg_GetConfigInfoBlk2`, dans 19 fonctions, pour **16 blocs différents**. Chaque identifiant et chaque taille sont des constantes écrites juste avant l'appel.

| Bloc | Taille demandée | Fonction du jeu | Contenu (3dbrew) | Ce que le jeu en fait | Si la lecture échoue |
| --- | --- | --- | --- | --- | --- |
| `0x00030001` | 8 | `0x1185f0` | décalage de l'horloge de l'utilisateur | le rend à l'appelant, 64 bits | erreur fatale |
| `0x00050005` | 0x20 | `0x149110` | réglages de l'écran 3D (huit flottants) | lu une fois, gardé à `0x6267fc`, pour le calcul de la vue en relief | `svcBreak` |
| `0x00070001` | 1 | `0x10f1f0`, `0x1348f8` | sortie du son : 0 mono, 1 stéréo, 2 surround | règle la sortie du son au démarrage | erreur fatale dans `0x10f1f0` ; `0x1348f8` continue en stéréo (1), comme pour toute valeur autre que 0, 1 ou 2 |
| `0x00070002` | 8 | `0x1ec138` | réglages d'annulation d'écho du micro | recopié dans le tampon de l'appelant | toléré si le bloc manque (`0xD90103FA`), erreur fatale sinon |
| `0x00090000` | 8 | `0x1ec170` | code ami local de la console | rendu à l'appelant ; sert à l'ouverture du sans-fil local (`uds_open_session`) | erreur fatale |
| `0x000A0000` | 0x1C | `0x1ebcc4` | nom d'utilisateur (UTF-16) et deux champs de contrôle | les 0x18 premiers octets sont rendus ; sert à l'ouverture du sans-fil local | erreur fatale |
| `0x000A0001` | 2 | `0x1ebc78` | date de naissance : mois, jour | deux octets rendus | erreur fatale |
| `0x000A0002` | 1 | `0x10ef30` | langue | voir « la langue » ci-dessous | erreur fatale |
| `0x000B0000` | 4 | `0x109840`, `0x123d94` | pays : code de la province à l'octet 2, code du pays à l'octet 3 | rendu à l'appelant | erreur fatale |
| `0x000B0001` | 0x800 | `0x123d94` | nom du pays en 16 langues | rangé à `+4` d'une structure | erreur fatale |
| `0x000B0002` | 0x800 | `0x123d94` | nom de la région en 16 langues | rangé à `+0x804` | erreur fatale |
| `0x000B0003` | 4 | `0x123d94` | latitude et longitude, deux nombres de 16 bits | rangés à `+0x1004` et `+0x1006` | erreur fatale |
| `0x000C0000` | 0xC0 | `0x123e50`, `0x1ec100`, `0x1ec1ac`, `0x1ec1e4`, `0x1ec21c` | contrôle parental | seul le premier mot sert : un bit par fonction | erreur fatale |
| `0x000C0001` | 0x14 | `0x123e50` | restriction COPPACS | les deux premiers octets | erreur fatale |
| `0x000D0000` | 4 | `0x1ebcfc` | version des conditions d'utilisation acceptée | comparée à la version exigée ; trop ancienne, l'appelant (`0x1dd258`) rend `0xC9209F84` | erreur fatale |
| `0x00130000` | 4 | `0x10ef6c`, `0x10f21c` | mode de débogage | **jamais lu sur une console du commerce**, voir plus bas | erreur fatale |

Recoupement avec la table de `cfg.md`, partie 5 : les 16 blocs y sont, **chacun avec la taille que le jeu demande** (le module refuse toute autre taille) **et les droits `0xE`**, donc lisibles par les jeux. Aucun écart. Le jeu ne demande aucun bloc réservé au système.

**La langue.** `0x10ef30` est appelée 13 fois. Au démarrage (`game_init_systems`, `0x108164`), la valeur passe par `0x10a100`, qui la convertit en code de langue du jeu : 0 (japonais) donne 1, 1 (anglais) donne 2, 2 (français) 3, 3 (allemand) 5, 4 (italien) 4, 5 (espagnol) 7, 7 (coréen) 8 ; toutes les autres (chinois, néerlandais, portugais, russe, taïwanais) donnent 2, l'anglais. Un aiguillage à neuf cas (`0x10817c`) en tire ensuite un numéro de 0 à 7.

**Le contrôle parental.** Quatre petites fonctions rendent chacune un bit du premier mot du bloc `0x000C0000`, sans regarder le bit 0 (« contrôle parental actif ») :

| Fonction | Bit | Restriction (3dbrew) | Appels |
| --- | --- | --- | --- |
| `0x1ec21c` | 3 (`0x08`) | partage d'images, de sons, de vidéos | 9 |
| `0x1ec1e4` | 4 (`0x10`) | échanges en ligne | 1 |
| `0x1ec100` | 5 (`0x20`) | StreetPass | 4 |
| `0x1ec1ac` | 6 (`0x40`) | ajout d'amis | 5 |

`0x123e50` rend un état à trois valeurs pour COPPACS : 0 si le premier octet du bloc `0x000C0001` est nul ou si GetRegionCanadaUSA rend 0 ; sinon 1 si le contrôle parental est actif et que le second octet n'est pas nul, 2 dans les autres cas.

**Le bloc de débogage.** Les deux fonctions qui lisent `0x00130000` commencent par regarder le bit 0 de l'octet `0x1FF80014` de la page de configuration du noyau. 3dbrew (« Configuration Memory », ENVINFO) : ce bit est levé sur une console du commerce. S'il est levé, la fonction rend 0 **sans rien envoyer**. Sur une console de développement, elle rend l'octet 1 (`0x10ef6c`, son bit 0) ou l'octet 2 (`0x10f21c`) de la valeur.

**Pour un portage, la liste exacte des réglages à fournir** est donc : les 15 premiers blocs du tableau, plus le bit 0 de `0x1FF80014` à 1. Des valeurs raisonnables : langue 2 (français), sortie du son 1, pays et région cohérents avec SecureInfoGetRegion, contrôle parental à zéro, conditions d'utilisation acceptées (une version acceptée élevée, `0xFFFF` dans les deux premiers octets du bloc `0x000D0000`, passe la comparaison), les huit flottants d'usine de l'écran 3D (62, 289, 76,8, 46,08, 10, 5, 55,58, 21,57 d'après 3dbrew).

### SecureInfoGetRegion (`0x00020000`)

Rôle : la région de la console (0 Japon, 1 Amérique, 2 Europe, 3 Australie, 4 Chine, 5 Corée, 6 Taïwan).

Requête : l'en-tête seul.

| Mot | Réponse (`cfg`) | Lu par le jeu (`0x118a24`) |
| --- | --- | --- |
| 0 | `0x00020080` | non |
| 1 | résultat | oui, mais ignoré par l'appelant |
| 2 | la région, sur un octet | oui, un octet |

Côté module : l'octet `0x100` du fichier `SecureInfo`, si sa signature est bonne. Erreurs : `0xD8A103F8` (fichier pas chargé), `0xD8A10001` (signature refusée).

Côté jeu : une seule fonction l'appelle, `0x10f28c`, qui prépare 0 et **ne regarde pas le résultat** : en cas d'erreur le jeu se croit japonais. Elle a dix appelants. Au démarrage (`0x1082a0`), les régions 4, 5 et 6 changent le paramètre passé au chargement de la police partagée (`0x1088fc`).

Pour répondre à la place de la console : rendre 0 et la région du jeu (2 pour une cartouche européenne).

### GenHashConsoleUnique (`0x00030040`)

Rôle : un identifiant de 64 bits propre à la console et à l'application.

| Mot | Requête (jeu, `0x1240b0`) | Lu par `cfg` |
| --- | --- | --- |
| 0 | `0x00030040` | le numéro seulement |
| 1 | un sel | oui, ses 20 bits du bas |

| Mot | Réponse (`cfg`) | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x000300C0` | non |
| 1 | résultat | oui |
| 2, 3 | l'identifiant | oui, 64 bits |

Côté module : les 8 derniers octets du SHA-256 de 12 octets, le bloc `0x00090001` puis le sel réduit à 20 bits. Si le bloc ne se lit pas, la réponse est zéro avec l'erreur de la lecture.

Côté jeu : une seule fonction l'appelle, `0x1779bc` (erreur fatale si la commande échoue), qui a sept appelants. Au démarrage (`0x10cad8`) le sel est `0x55D`, le numéro de Pokémon X dans son identifiant de titre.

Pour répondre à la place de la console : rendre 0 et un nombre fixe, le même à chaque lancement pour un même sel. Il sert à lier des données à la console ; une valeur qui change d'un lancement à l'autre risque de faire rejeter des données enregistrées (interprété).

### GetRegionCanadaUSA (`0x00040000`)

Rôle : la console est-elle réglée sur le Canada ou les États-Unis ?

Requête : l'en-tête seul. Réponse : `0x00040080`, le résultat, puis un octet, 0 ou 1.

Côté module : 1 si la région vaut 1 et si l'octet de poids fort du bloc `0x000B0000` vaut `0x12` (Canada) ou `0x31` (États-Unis).

Côté jeu : deux appelants, `0x123e30` (rend l'octet) et `0x123e50` (l'état COPPACS ci-dessus). Erreur fatale si la commande échoue.

Pour répondre à la place de la console : rendre 0 et l'octet 0.

### Le repli sur `cfg:s` et `cfg:i`

Trois fonctions ouvrent chacune un service et tiennent un compteur d'ouvertures :

| Fonction | Adresse | Service | Poignée | Ce qu'elle fait de la poignée |
| --- | --- | --- | --- | --- |
| `cfg_init_user` | `0x118874` | `cfg:u` | `0x5e9144` | la laisse là |
| `cfg_init_system` | `0x123fb4` | `cfg:s` | `0x5ea4bc` | la recopie à `0x5e9144` |
| `cfg_init_internal` | `0x124030` | `cfg:i` | `0x5ea4b8` | la recopie à `0x5e9144` |

`cfg_init_any` (`0x1189bc`) les essaie dans cet ordre et note laquelle a marché (0, 1 ou 2), pour appeler ensuite la fermeture qui va avec. Si les trois échouent elle rend `0xD90103EA`. Les quatre fonctions d'envoi lisent toutes la poignée de `0x5e9144` : elles ne savent pas à quel service elles parlent, et n'ont pas à le savoir, puisque les quatre commandes ont le même numéro dans les trois.

Deux précisions, par rapport à ce que laisse entendre l'inventaire :

- `cfg_init_any` n'a que **deux appelants**, les deux fonctions du bloc de débogage (`0x10ef6c`, `0x10f21c`). Or ces deux fonctions reviennent avant de l'appeler sur une console du commerce. **Le repli ne s'exécute donc jamais en dehors d'une console de développement.** Il sert sans doute aux outils de mise au point, qui n'ont pas `cfg:u` dans leurs droits (interprété).
- Tout le reste du jeu passe par `cfg_init_user` seul. `main` l'appelle une fois au démarrage (`0x16f860`) et garde la session ouverte ; les autres appels ne font que monter et descendre le compteur. Si `cfg:u` refuse à ce moment-là, le programme s'arrête.

Pour un portage : seul `cfg:u` est à fournir.

## Partie 4 : `ptm:u`

Poignée à `0x5e8098`, ouverte par `ptm_open_session` (`0x107188`) au début de `main`. Module : `ptm`.

### GetStepHistory (`0x000B00C2`)

Rôle : le nombre de pas comptés par le podomètre, heure par heure, à partir d'une date.

| Mot | Requête (jeu, `0x124d24`) | Lu par `ptm` |
| --- | --- | --- |
| 0 | `0x000B00C2` | comparé en entier |
| 1 | le nombre d'heures | **non** |
| 2, 3 | la date de départ, 64 bits | oui |
| 4 | `heures × 32 + 0xC`, soit un tampon de 2 octets par heure | oui : le type `0xC` et la taille |
| 5 | l'adresse du tampon | oui |

| Mot | Réponse (`ptm`) | Lu par le jeu |
| --- | --- | --- |
| 0 | `0x000B0042` | non |
| 1 | résultat | oui |
| 2, 3 | le descripteur (taille arrondie à un nombre pair) et l'adresse | non |

Côté module (`ptmu_handle_command`, cas à `0x109bf2`, puis `ptm_GetStepHistory` et le podomètre à `0x1091ee`) : le nombre d'heures n'est pas pris dans le mot 1 mais dans la taille du tampon, divisée par 2. Si le podomètre n'est pas en service (un octet de son objet), la fonction rend 0 **sans toucher au tampon**. Sinon elle vérifie la date (`0xE0E0D7FD` si le départ ou la fin de la période dépasse une borne fixée à l'an 2100), met le tampon à zéro, relit l'historique gardé par le microcontrôleur (168 heures, soit sept jours), y recopie les heures qui tombent dans la période, et plafonne chaque valeur à 18 000 (`0x4650`). Le détail du calcul des dates est survolé. Erreur d'aiguillage : `0xD9001830`.

Côté jeu : un seul appelant, `0x11852c`, qui **arrête le programme si la commande échoue**, lui-même appelé par `0x11fea4`. Celle-ci demande les 24 heures de la journée en cours (date du jour, heure zéro), additionne les 24 valeurs et rend un niveau : 0 jusqu'à 2 000 pas, 1 jusqu'à 3 000, 2 jusqu'à 4 000, 3 au-delà. L'inventaire la place dans les derniers préparatifs avant la boucle principale. À quoi sert ce niveau dans le jeu n'est pas lu.

Pour répondre à la place de la console : **écrire des zéros dans le tampon** (24 valeurs de 16 bits) et rendre 0. Ne rien écrire ne suffit pas : le tampon du jeu est sur sa pile, non initialisé. C'est la seule commande que le jeu envoie à `ptm:u` ; il ne demande ni la batterie ni le couvercle (GetShellState et GetBatteryLevel de `ptm.md` ne partent jamais).

## Partie 5 : le port `err:f`

Ce n'est pas un service mais un port, ouvert par `svcConnectToPort("err:f")` au moment de l'erreur. Poignée à `0x5d4048`. Le module qui l'écoute, `errdisp`, n'était pas dumpé quand ce contrat a été écrit ; il l'est depuis, et sa fiche [errdisp](errdisp.md) lit le côté module. Tout ce qui suit est lu dans le jeu, avec les noms de champs de 3dbrew (« ERR:Throw »).

### Throw (`0x00010800`)

Rôle : afficher l'écran d'erreur fatale de la console.

| Mot | Requête (jeu, `0x124780`) |
| --- | --- |
| 0 | `0x00010800` |
| 1 à 32 | 0x80 octets recopiés depuis la fiche d'erreur |

Réponse : seul le mot 1 est lu, et l'appelant n'en fait rien.

La fiche d'erreur du jeu est à `0x626038` :

| Décalage | Taille | Contenu (3dbrew) | Valeur écrite par le jeu |
| --- | --- | --- | --- |
| `0x00` | 1 | genre d'erreur | 0 dans `errf_throw_result` (`0x124750`) ; un paramètre dans `0x118a60` |
| `0x01` | 1 | révision, partie haute | 0 |
| `0x02` | 2 | révision, partie basse | `0xC8E1` |
| `0x04` | 4 | le code de résultat | celui de la commande qui a échoué |
| `0x08` | 4 | l'adresse du code | celle de l'appel |
| `0x0C` | 4 | le numéro du processus | rempli par `svcGetProcessId` juste avant l'envoi |
| `0x10` et suite | | titre, données | ce qui se trouve déjà dans la fiche |

**Quand.** `errf_throw` (`0x118a98`) a trois entrées. La principale, `errf_throw_result` (`0x124750`), est appelée de **164 endroits** : c'est le « si cette commande a échoué, erreur fatale » qu'on retrouve après presque chaque appel de ce document. `0x118a60` sert au contrôle des résultats d'appels système (`0x15fb94`). La troisième (`0x124344`) n'est pas lue.

**Ce que fait le jeu autour de l'envoi.** Il ouvre le port ; si le port est plein (`0xD0401834`) et que l'erreur est du genre 2, il attend et réessaie. Il envoie Throw, referme le port, puis, sauf pour les genres 2 et 5, **endort le fil pour toujours** sur un signal que personne ne déclenche (interprété : le signal est créé sur place et n'est donné à personne). Il ne revient donc pas d'une erreur fatale ordinaire.

Pour répondre à la place de la console : accepter la connexion, lire les 0x80 octets, afficher ou noter le code de résultat (`+0x04`) et l'adresse (`+0x08`), rendre 0. Ces deux nombres disent quelle commande du jeu a échoué : c'est le meilleur outil de mise au point d'un portage. Le jeu ne continuera pas ; à charge du portage de l'arrêter.

## Partie 6 : `ldr:ro`

Poignée à `0x5e80d0`. Le module `ro` n'était **pas dumpé** quand ce contrat a été écrit ; il l'est depuis, et la fiche [ro](ro.md) lit le côté module. Tout ce contrat est lu côté jeu. Les noms des paramètres viennent de 3dbrew (« RO Services », « RO:Initialize », « RO:LoadCRR », « RO:LoadExeCRO », « RO:UnloadCRO », « CRO0 », « CRR0 ») ; ce que fait `ro` de son côté est dit à chaque fois avec la mention « d'après 3dbrew ». Le format des fichiers est décrit dans l'inventaire, partie 5.

Dans les quatre commandes, le dernier mot est une poignée vers le processus du jeu lui-même (`0xFFFF8001`, lue à `0x564f14`), précédée d'un mot à 0 qui dit au noyau de la copier : c'est ce qui donne à `ro` le droit de modifier la mémoire du jeu.

### L'adresse « miroir »

Le jeu lit ses fichiers dans son tas, à partir de `0x08000000`. Mais un module doit s'exécuter près du code principal. Pour chaque tampon, le jeu calcule donc une seconde adresse :

- en dessous de `0x08000000`, la même ;
- sinon, l'adresse moins `0x0799B000`.

`0x0799B000`, c'est `0x08000000` moins `0x00665000`, et `0x665000` est la première page libre après le programme (la fin de `.data` et `.bss`, `0x664498`, arrondie). Le tas `0x08000000` se retrouve donc à `0x665000`, juste derrière le programme. La même règle est écrite dans 3dbrew. Le jeu ne crée pas ce miroir lui-même : il donne les deux adresses à `ro`, qui le fait (d'après 3dbrew). La fonction inverse existe aussi dans le jeu (`0x146ad4`).

### Initialize (`0x000100C2`)

Rôle : donner à `ro` la description du programme principal, `static.crs`.

| Mot | Requête (jeu, `0x133fa8`) | Valeur |
| --- | --- | --- |
| 0 | `0x000100C2` | |
| 1 | l'adresse du tampon où le fichier a été lu | dans le tas |
| 2 | sa taille | celle du fichier : 36 864 octets |
| 3 | l'adresse miroir | calculée comme ci-dessus |
| 4 | 0 | |
| 5 | la poignée du processus | |

Réponse : le mot 1 seulement.

Côté jeu : `ldrro_open_session` (`0x12fe70`) refuse si la session est déjà ouverte (`0xE0A12FF9`), demande `ldr:ro` à `srv:`, envoie Initialize. En cas de succès elle garde l'adresse miroir à `0x5d4288` ; sinon elle referme la session et rend l'erreur.

### LoadCRR (`0x00020082`)

Rôle : donner à `ro` la liste des modules autorisés, `static.crr` (133 empreintes, voir l'inventaire).

| Mot | Requête (jeu, `0x118548`) | Valeur |
| --- | --- | --- |
| 0 | `0x00020082` | |
| 1 | l'adresse du tampon | dans le tas, **sans miroir** |
| 2 | sa taille | 8 192 octets |
| 3 | 0 | |
| 4 | la poignée du processus | |

Réponse : le mot 1 seulement.

Côté jeu : `0x10eedc`. En cas de succès elle garde l'adresse du fichier à `0x5d428c`. Elle regarde ensuite le mot `0x14` du fichier (la taille des informations de mise au point, d'après 3dbrew) : il vaut 0 dans le `static.crr` du jeu, donc l'octet `0x5e80cc` reste à 0 et la branche qui prévient un débogueur à chaque chargement (`0x1e7ca0`, `0x146af0`) ne s'exécute jamais.

D'après 3dbrew, `ro` passe ce tampon en lecture seule avant de le vérifier. Le jeu n'y écrit plus ensuite.

### Qui envoie ces deux commandes, et quand

Un gestionnaire de modules, dans le code principal. Son objet est désigné par le pointeur `0x5eda68` (`ro_manager_get_instance`, `0x12b2d0`).

`ro_manager_initialize` (`0x10a518`) est appelée une fois, à la fin de `game_init_systems` (`0x1086fc`), avec les chemins `rom2:/static.crs` et `rom2:/.crr/static.crr` et un maximum de **32 modules** chargés à la fois. Elle :

1. lit chaque fichier en entier dans un tampon du tas aligné sur une page (`0x110eac`) ;
2. envoie Initialize, puis LoadCRR ;
3. réserve trois tableaux de 32 cases : les modules chargés (`+0x0C` de l'objet), leurs tampons de données (`+0x10`), leurs tampons de fichier (`+0x14`). Le nombre de modules chargés est à `+0x20`, le maximum à `+0x1C`.

Si un fichier manque ou si LoadCRR échoue, elle tourne en rond sur une fonction d'alerte : le jeu ne démarre pas. Le résultat d'Initialize, lui, n'est pas regardé.

### LoadExeCRO (`0x000402C2`)

Rôle : faire d'un fichier `.cro` déjà lu en mémoire un module prêt à s'exécuter.

| Mot | Requête (jeu, `0x1e793c`) | Valeur passée par `ro_LoadModule` (`0x1e7604`) |
| --- | --- | --- |
| 0 | `0x000402C2` | |
| 1 | l'adresse du tampon où le fichier a été lu | dans le tas |
| 2 | l'adresse où le module doit apparaître | l'adresse miroir |
| 3 | la taille du fichier | |
| 4 | l'adresse d'un tampon pour `.data` | le début d'un second tampon, réservé par le jeu |
| 5 | 0 | |
| 6 | la taille de `.data` | le champ `0xBC` de l'en-tête, arrondi à 4 |
| 7 | l'adresse d'un tampon pour `.bss` | dans le même second tampon, juste après `.data` |
| 8 | la taille du tampon de `.bss` | ce qui reste du second tampon |
| 9 | « à lier automatiquement », un octet | 1 |
| 10 | le niveau de finition | 1 partout (les 123 appels) |
| 11 | 0 | |
| 12 | 0 | |
| 13 | la poignée du processus | |

| Mot | Réponse | Lu par le jeu |
| --- | --- | --- |
| 1 | résultat | oui |
| 2 | la taille du module après finition (d'après 3dbrew) | oui |

L'ordre et le sens des treize mots collent à 3dbrew, mot pour mot.

**Avant l'envoi**, `ro_LoadModule` vérifie la marque `CRO0` à `0x80` du fichier ; sans elle, elle rend 0 sans rien envoyer. Le second tampon a été réservé par l'appelant à la taille que donne `ro_GetSizeInfo` (`0x1e7760`) : la taille de `.data` arrondie à 8, plus la taille de `.bss` (champ `0x94`).

**Après une réponse sans erreur**, la fonction travaille sur le module **à son adresse miroir**, et c'est là qu'on voit ce que `ro` a dû faire :

1. **Elle recopie `.data` elle-même** dans le second tampon. Pour savoir d'où, elle lit dans l'en-tête miroir le champ `0xB8`, qu'elle traite comme une adresse (dans le fichier c'est un décalage : `ro` l'a donc converti). La partie de `.data` qui tient dans la « taille après finition » est prise dans le miroir ; le reste est pris dans le tampon d'origine du tas.
2. **Elle met `.bss` à zéro elle-même** (`0x15ebd0`).
3. Elle appelle l'objet de contrôle du module (voir plus bas) avec l'opération 1 (`0x1e7d84`), sur l'adresse qui suit `.bss`. Pas compris.
4. Elle inscrit la plage de code du module (champ `0xB0`, et `0xB0` plus `0xB4`) dans une liste du jeu à `0x5e80c4` (`0x1e7804`). Cette liste sert à retrouver à quel module appartient une adresse (`0x12fdec`).
5. Elle rend l'adresse miroir : **c'est la valeur que le jeu appelle « le module »** dans toute la suite.

Si la réponse est une erreur, elle rend 0 et le gestionnaire tourne en rond sur l'alerte.

**Ce que le jeu lit dans un module chargé.** Tous ces champs sont lus dans l'en-tête à l'adresse miroir, et tous ceux qui sont des décalages dans le fichier sont utilisés comme des **adresses** :

| En-tête | Champ | Utilisé par |
| --- | --- | --- |
| `0x80` | la marque | chargement, déchargement |
| `0xA0` | où est l'objet de contrôle (segment et décalage) | `ro_call_control_object` (`0x15fc68`) |
| `0xA4` | fonction à appeler au chargement | `ro_Module_DoInitialize` (`0x1e7878`) |
| `0xA8` | fonction à appeler au déchargement | `ro_Module_DoFinalize` (`0x146978`) |
| `0xB0`, `0xB4` | le code : adresse, taille | la liste des plages de code |
| `0xB8`, `0xBC` | `.data` : adresse, taille | la recopie de `.data` |
| `0xC8`, `0xCC` | la table des segments : adresse, nombre | partout où une « adresse étiquetée » est résolue |
| `0xF8`, `0xFC` | les corrections d'imports : adresse, nombre | `0x1e7c48`, qui regarde l'octet `+6` de chaque correction (« résolue ») |

Et dans la table des segments, le premier mot de chaque case est lui aussi lu comme une adresse : celle du second tampon pour `.data` et pour `.bss`.

### Comment le jeu se sert d'un module chargé

**Il ne cherche jamais un export par son nom.** Trois chemins mènent du code principal à un module.

**1. L'objet de contrôle.** Chaque module exporte `nnroControlObject_`, et l'en-tête donne sa position à `0xA0`. Le jeu le traite comme **une fonction** : `ro_call_control_object` (`0x15fc68`) résout l'adresse par la table des segments et l'appelle avec deux arguments, une adresse de sortie et un numéro d'opération. S'il n'y en a pas, elle rend `0xD8E12C04`.

| Opération | Demandée par | Ce que le jeu fait de la réponse |
| --- | --- | --- |
| 0 | `0x1e7804`, `0x146a50` | un maillon de liste dans le module, pour la liste des plages de code |
| 1 | `0x1e7d84`, `0x133e5c` | pas compris |
| 2 | `ro_Module_DoFinalize` | la liste des fonctions à appeler à la sortie |
| 3, puis 4 | `ro_Module_DoInitialize` | deux listes de fonctions (début, fin), appelées une par une |

**2. La mise en route.** `ro_Module_DoInitialize` (`0x1e7878`) appelle les fonctions de la liste 3, puis celles de la liste 4 (les constructeurs des objets globaux du module), puis la fonction désignée par `0xA4` s'il y en a une. D'après l'inventaire, cinq modules seulement en ont une.

**3. Les mots du code principal que `ro` remplit.** C'est le chemin de tous les jours. `static.crs` demande que 331 mots du programme principal reçoivent une adresse prise dans un module, pour 78 modules. Relu ici dans le fichier : **les 331 sont dans `.text`** (ce sont des constantes rangées à la fin des fonctions), tous du même genre (l'adresse entière). Avant le chargement, chacun contient `0x4d7bc0`, l'adresse que l'en-tête de `static.crs` donne à `0xAC` : la fonction « symbole non résolu », qui arrête le programme.

L'exemple de l'écran-titre, `0x3506fc` : la fonction charge et met en route `rom2:/DllTitle.cro`, réserve un objet de 0x54 octets dans le tas du jeu, et écrit dans son premier mot la constante rangée à `0x35078c`. `static.crs` dit que ce mot reçoit « segment 1 de `DllTitle`, plus `0x1308`, plus 8 » : c'est **une table virtuelle rangée dans le `.rodata` du module**. L'objet est ensuite confié au gestionnaire de procédures du jeu (`0x394e6c`), qui appelle ses méthodes : ce sont des fonctions du module. Le premier appel dans un module est donc un appel de méthode virtuelle, sur un objet créé par le code principal. Pour `DllBoxSearch`, le mot (`0x19aa88`) reçoit directement l'adresse d'une fonction.

Conséquence pour un portage : `ro` doit pouvoir **écrire dans le `.text` du programme principal**, au chargement de chaque module, et y remettre `0x4d7bc0` au déchargement (ce second point d'après le rôle du champ `0xAC`, pas lu).

### Qui décide de charger quoi

Pas de table centrale : chaque écran du jeu a sa fonction de création, qui charge les modules dont il a besoin, par leur nom écrit en clair.

| Fonction du gestionnaire | Adresse | Ce qu'elle fait | Appels |
| --- | --- | --- | --- |
| `ro_manager_load_module` | `0x357a54` | lit le fichier, réserve le second tampon, envoie LoadExeCRO, range les trois adresses dans les tableaux | 41, dans 19 fonctions |
| `ro_manager_start_module` | `0x357b8c` | met en route un module chargé (`ro_Module_DoInitialize`) | 40, dans 18 fonctions |
| `ro_manager_load_and_start_module` | `0x357960` | les deux à la suite | 82, dans 60 fonctions |
| `ro_manager_unload_module` | `0x128744` | arrête, décharge, libère les deux tampons, tasse les tableaux | 8, dans 7 fonctions |

- La première sert quand un écran a besoin de plusieurs modules qui s'utilisent entre eux : on les charge tous, puis on les met en route. `0x3507e8` en charge trois, puis en met trois en route.
- Les appels sont presque tous entre `0x3503e0` et `0x3534d8`, dans les fonctions de création des écrans. Elles sont appelées par les « procédures » du jeu, des machines à états rangées dans des tables virtuelles : `0x3f83c0`, par exemple, est une méthode à douze états qui enchaîne le choix de la langue et l'écran-titre.
- **84 noms de modules** sont écrits en entier dans le code principal (`rom2:/Dll….cro`). Les 49 autres fichiers : 27 modules d'essai que rien ne nomme, et les 22 `DllUS…` (les mécanismes des arènes et des lieux), dont les noms sont dans `DllField.cro`. `DllField` importe justement `ro_manager_load_and_start_module` et une enveloppe du déchargement (`0x12872c`) : **le module du terrain charge lui-même d'autres modules**, en passant par le gestionnaire du code principal. Sept modules importent le déchargement.
- La mise en route peut vérifier que tous les imports du module sont résolus (`0x1e7c48`) ; les 40 appels demandent de ne pas le faire.

### UnloadCRO (`0x000500C2`)

Rôle : défaire un chargement.

| Mot | Requête (jeu, `0x146a0c`) | Valeur passée par `ro_UnloadModule` (`0x133e5c`) |
| --- | --- | --- |
| 0 | `0x000500C2` | |
| 1 | l'adresse du module | l'adresse miroir |
| 2 | 0 | |
| 3 | l'adresse d'origine | celle du tampon du tas, recalculée par `0x146ad4` |
| 4 | 0 | |
| 5 | la poignée du processus | |

Réponse : le mot 1 seulement.

Dans l'ordre, côté jeu : `ro_Module_DoFinalize` (la fonction de `0xA8` si elle existe, puis les fonctions de sortie de la liste 2, de la dernière à la première) ; retrait de la plage de code ; opération 1 de l'objet de contrôle ; l'envoi ; puis, si la réponse est bonne, le jeu **retouche le tampon d'origine dans le tas** : il remet dans la table des segments le décalage de `.data` et un zéro pour `.bss`. Pour trouver cette table il lit le champ `0xC8` du tampon d'origine comme un **décalage** : il s'attend donc à retrouver, après le déchargement, le fichier à son adresse d'origine avec son en-tête remis dans l'état du fichier. Enfin le gestionnaire libère les deux tampons.

Une branche recopie d'abord `.data` du second tampon vers le tampon d'origine. Elle exige que la marque du module soit encore `CRO0`. D'après 3dbrew, `ro` remplace la marque par `FIXD` dès que le niveau de finition n'est pas 0 ; le jeu charge tout au niveau 1 : cette branche ne devrait donc jamais s'exécuter (interprété, dépend d'un comportement de `ro` qui n'a pas été lu).

### Ce qu'un remplaçant de `ro` doit faire, vu du jeu

C'est une liste de contraintes tirées du code du jeu, pas une description de `ro`.

1. **Initialize** : retenir `static.crs` (adresses des trois sections du programme, ses 461 exports, ses 331 mots à remplir).
2. **LoadCRR** : retenir les empreintes. Les vérifier n'est pas nécessaire au jeu.
3. **LoadExeCRO** :
   - faire apparaître le fichier à l'adresse du mot 2 ;
   - y convertir en adresses les décalages de l'en-tête que le jeu lit (`0xB0`, `0xB8`, `0xC8`, `0xF8` au moins) et le premier mot de chaque case de la table des segments, avec le tampon du mot 4 pour `.data` et celui du mot 7 pour `.bss` ;
   - appliquer les corrections internes et les imports ; **laisser le contenu de `.data`, une fois corrigé, à sa place dans l'image** : c'est le jeu qui le recopie dans le second tampon ;
   - ne pas compter sur un `.bss` à zéro avant la réponse : c'est le jeu qui l'efface après ;
   - remplir dans le `.text` du programme principal les mots que `static.crs` réserve à ce module ;
   - rendre au mot 2 une taille. Le plus simple pour un portage : garder le fichier entier visible aux deux adresses et rendre sa taille, de sorte que les deux moitiés de la recopie de `.data` lisent les bons octets.
4. **UnloadCRO** : défaire les imports, remettre `0x4d7bc0` dans les mots du programme principal, et rendre le tampon d'origine lisible et modifiable, avec les décalages de son en-tête comme dans le fichier.

Deux corrections à ce que l'inventaire (partie 5, « Ce que `ro` devra faire ») déduisait du seul format : ce n'est pas `ro` qui réserve `.bss`, c'est le jeu qui fournit le tampon et l'efface ; et ce n'est pas `ro` qui installe `.data` dans son tampon, c'est le jeu qui l'y recopie.

## Les désaccords relevés

| Entre | Sujet | Ce que dit le code |
| --- | --- | --- |
| l'inventaire et le jeu | « `0x1096ac` : `cfg:u` (sinon `cfg:s`, sinon `cfg:i`), GetConfigInfoBlk2 » au démarrage | sur une console du commerce cette étape n'envoie rien : le bit 0 de `0x1FF80014` fait revenir avant l'ouverture et avant la commande. Le repli n'existe que sur ce chemin |
| `cfg.md` et le jeu | l'introduction dit qu'un jeu comme Pokémon X demande « la langue, la région et le modèle » | le jeu ne demande jamais le modèle : GetSystemModel (`0x00050000`) ne fait pas partie de ses quatre commandes |
| `hid.md` et le jeu | « le jeu […] attend un des signaux, et lit » | Pokémon X n'attend sur aucun des cinq signaux : il lit à son propre rythme |
| `hid.md` et le module | la commande 22 est donnée comme rendant l'étalonnage du gyroscope | elle le rend avec deux axes échangés et un signe changé, par l'aiguillage. La fiche ne le dit pas |
| l'inventaire et le jeu | « ce que `ro` devra faire » : réserver `.bss`, placer les segments | le jeu fournit et efface `.bss`, et recopie `.data` lui-même |
| l'inventaire et le jeu | une correction d'import a « deux octets non lus » | l'octet `+6` est lu par le jeu (« résolue »), dans une vérification qu'aucun appel ne demande |
| 3dbrew et le module | GetStepHistory : le mot 1 est le nombre d'heures | `ptm` ne lit pas ce mot : il prend le nombre dans la taille du tampon |
| 3dbrew et le module | GetRegionCanadaUSA lit d'abord la région | `cfg` lit d'abord le bloc du pays, puis la région. Le résultat est le même |
| Ghidra et le code | les appelants d'une fonction (`refs.tsv`) | il en manque : les trois appels à `0x123d94`, un à `0x10f1f0`, deux à `0x10f28c` sont dans du code que Ghidra n'a pas désassemblé |

Aucun désaccord entre le jeu et les modules sur la forme d'une requête ou d'une réponse : les 17 commandes lues des deux côtés s'emboîtent mot pour mot.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**

- La forme des 17 commandes lues des deux côtés : les mots écrits par la fonction d'envoi du jeu, lus dans l'assembleur, et les mots lus par l'aiguillage du module, lus dans son pseudo-code et son assembleur. Pour `cfg:u` et `ptm:u`, l'en-tête exigé et le descripteur sont aussi ceux que rend `emulate_dispatch.py`.
- La disposition de la mémoire partagée de `hid` : les cinq décalages, les tailles d'en-tête, le nombre et la taille des entrées, lus dans les fonctions d'écriture du module (`hid.md`) et dans les quatre lecteurs du jeu. 3dbrew donne les mêmes.
- Les 16 blocs de configuration : l'identifiant et la taille écrits par le jeu avant chaque appel, et la table des blocs du module (`cfg.md`), qui a les mêmes tailles et les droits `0xE` pour les seize.
- Le nombre d'appelants de chaque fonction citée : les références de Ghidra et un balayage de tous les sauts du code fait pour ce document. Quand les deux diffèrent, c'est le balayage qui est donné.
- La seule notification à laquelle le jeu s'abonne : Subscribe n'a qu'un appelant, qui passe la constante `0x209`.
- La forme des quatre commandes de `ldr:ro` : l'assembleur du jeu d'un côté, les pages de 3dbrew de l'autre, mot pour mot.
- Les 331 mots du programme principal à remplir, tous dans `.text` : relus dans `static.crs`, et l'un d'eux (`0x35078c`) suivi dans le code jusqu'à son usage.

**Interprété à la lecture, à relire dans Ghidra**

- Les noms donnés aux fonctions du jeu (lecteurs de `hid`, gestionnaire de modules, accès aux réglages) : ils décrivent ce que fait le code, le jeu n'a gardé aucun symbole pour eux.
- « Le jeu n'attend sur aucun signal de `hid` » : aucun appel d'attente dans la bibliothèque `hid` du jeu ; une attente ailleurs, à travers un lecteur, n'est pas exclue.
- « Le lecteur du pad de débogage n'existe pas » : par la recherche du motif commun aux quatre lecteurs.
- Le rythme de lecture des boutons (« une fois par image »).
- Le sens des champs de l'étalonnage du gyroscope, et l'échange d'axes vu comme un changement de repère.
- Le rôle de l'heure dans l'en-tête de section : compris d'après les comparaisons, pas exécuté.
- Le sens des blocs de configuration : il vient de 3dbrew, le code ne montre que la taille et l'usage.
- Le repli de `cfg` vu comme un reste pour les outils de mise au point.
- Tout ce que `ro` fait de son côté : aucune ligne de `ro` n'a été lue. Les contraintes de la partie 6 sont celles que le jeu impose ; `ro` peut en faire plus.
- Le sens des opérations 0, 2, 3 et 4 de l'objet de contrôle, d'après ce que le jeu fait de la réponse.
- L'usage de GenHashConsoleUnique et du niveau de pas : non suivis au-delà de la fonction qui les lit.

**Pas lu**

- Les modules `ro` et `errdisp` côté module : lus depuis dans leurs fiches (`ro.md`, `errdisp.md`), pas recoupés ici.
- Les appelants des accès aux réglages au-delà du premier étage : on sait quelle fonction lit le bloc et ce qu'elle rend, pas toujours quel écran s'en sert. Les trois appelants de `0x123d94` (noms du pays et de la région) ne sont pas lus.
- Le code des `.cro` : en particulier ce que fait l'objet de contrôle à l'intérieur d'un module, et l'opération 1.
- Quel écran du jeu réclame l'accéléromètre et le gyroscope.
- Le calcul des dates dans GetStepHistory côté module (`0x105afc`), et à quoi sert le niveau de pas côté jeu.
- La troisième entrée de l'erreur fatale (`0x124344`), et les genres d'erreur autres que 0.
- Les deux segments supplémentaires de `static.crs` (un vide à `0x665000`, un de 0x1F4 octets à `0x04000000`).
- Le corps de `srv_PublishToSubscriber` dans `sm` : comment une notification entre dans la file du jeu.

## Comment ce document a été fait

| Étape | Qui | Durée |
| --- | --- | --- |
| Filtrer l'inventaire sur le lot, relire les fiches `sm`, `hid`, `cfg`, `ptm` | Claude | le début |
| Désassembler chaque fonction d'envoi du jeu et ses appelants | un script Python sur `code.bin`, avec capstone, qui résout les constantes et nomme les cibles | immédiat |
| Retrouver tous les appelants d'une fonction | un second script : balayage de tous les sauts ARM et de tous les mots du fichier | 3 secondes par question |
| Lire le pseudo-code du jeu et des modules | les sorties déjà rangées de `ghidra_direct.py` (`local/analyse/<module>/gh/`) ; rien n'a été relancé | à la main |
| Relire `static.crs` et `static.crr` | le lecteur de `.cro` de l'inventaire, repris tel quel | immédiat |
| Recouper avec 3dbrew | le texte brut de 16 pages (`action=raw`), gardé dans `local/` | une minute |
| Rédiger et recouper | Claude | le reste |

Les scripts et les pages de 3dbrew sont dans `local/analyse/contrat-petits/` (non versionné). Aucun pont REA n'a été lancé : le pseudo-code existant suffisait, et l'assembleur a servi partout où il fallait les registres autour d'un appel système.

**Les pièges rencontrés.**

- **Les références de Ghidra ne sont pas complètes.** `refs.tsv` ne connaît aucun appelant à `0x123d94`, qui en a trois. Les appels manquants sont dans du code que Ghidra n'a pas désassemblé. Pour compter des appelants, balayer les sauts du fichier.
- **Ghidra range mal les fins de fonction partagées.** Les deux commandes du gyroscope partent de `0x1ed484` et `0x1ed4ec`, que Ghidra rattache à une fonction qui commence à `0x1edbbc` : c'est un morceau de celle-ci rangé plus haut. Et l'ouverture de `ldr:ro` s'atteint par un saut au milieu d'une autre fonction (déjà noté dans l'inventaire).
- **Un mot à remplir par `ro` trompe le décompilateur.** À `0x35078c`, le fichier contient l'adresse de la fonction d'arrêt. Ghidra en déduit que le code « appelle la fonction d'arrêt si l'allocation réussit », ce qui n'a pas de sens : le code range ce mot dans un objet, comme table virtuelle. Devant un appel absurde à `0x4d7bc0`, vérifier dans `static.crs` si le mot est dans la liste des imports.
- **Les fonctions d'envoi ne lisent pas la réponse en cas d'échec de l'appel système**, mais beaucoup d'appelants ne regardent pas non plus le résultat du service (`0x10f28c` pour la région). Il faut lire l'appelant pour savoir si une erreur est fatale.
- **`grep -P` ne marche pas** dans le Git Bash de ce poste (réglage de langue), et un script nommé `dis.py` masque le module `dis` de Python dont capstone a besoin.

**Pour reprendre.** Les deux suites utiles : dumper `ro` et `errdisp` pour lire l'autre côté des cinq commandes restantes, et regarder le jeu tourner pour savoir quels blocs de configuration sont vraiment lus avant le premier écran.

## Fonctions du jeu identifiées dans ce document

Ces noms ont été versés dans `pokemon-x.noms.tsv` après la rédaction de ce document. Chaque nom est justifié dans la partie citée.

| Adresse | Nom proposé | Partie |
| --- | --- | --- |
| `0x10f7c4` | `srv_notification_thread_main` | 1 |
| `0x10f734` | `srv_register_notification_handler` | 1 |
| `0x10972c` | `subscribe_sd_removed_notification` | 1 |
| `0x1e044c` | `on_sd_removed_notification` | 1 |
| `0x124750` | `errf_throw_result` | 5 |
| `0x118a60` | `errf_throw_typed` | 5 |
| `0x2cd3ec`, `0x2cd5c0`, `0x2cd734`, `0x2cd8a8` | `hid_read_pad_ring`, `hid_read_touch_ring`, `hid_read_gyroscope_ring`, `hid_read_accelerometer_ring` | 2 |
| `0x1ef4b0`, `0x1ee634` | `hid_PadReader_ReadLatest`, `hid_TouchPanelReader_ReadLatest` | 2 |
| `0x1eef9c`, `0x1ef024` | `hid_AccelerometerReader_ctor`, `hid_AccelerometerReader_dtor` | 2 |
| `0x1ee3ec`, `0x1ee5ec`, `0x1edbbc` | `hid_GyroscopeReader_ctor`, `hid_GyroscopeReader_dtor`, `hid_GyroscopeReader_reset` | 2 |
| `0x2cd318` | `hid_fold_select_into_start` | 2 |
| `0x10a748`, `0x358238` | `input_manager_ctor`, `input_manager_update` | 2 |
| `0x358784`, `0x358918`, `0x358504`, `0x358708` | `input_manager_boot_accelerometer`, `input_manager_stop_accelerometer`, `input_manager_boot_gyroscope`, `input_manager_stop_gyroscope` | 2 |
| `0x15fd88` | `cfg_exit` | 3 |
| `0x10ef30`, `0x10a100` | `cfg_get_language`, `language_from_cfg` | 3 |
| `0x10f28c` | `cfg_get_region` | 3 |
| `0x1779bc` | `cfg_gen_hash_console_unique` | 3 |
| `0x109840`, `0x123d94` | `cfg_get_country_info`, `cfg_get_country_names` | 3 |
| `0x10f1f0` | `cfg_get_sound_output_mode` | 3 |
| `0x10ef6c`, `0x10f21c` | `cfg_get_debug_flag`, `cfg_get_debug_value` | 3 |
| `0x1185f0` | `cfg_get_user_time_offset` | 3 |
| `0x149110` | `cfg_load_stereo_display_settings` | 3 |
| `0x1ebc78`, `0x1ebcc4`, `0x1ebcfc` | `cfg_get_birthday`, `cfg_get_user_name`, `cfg_is_eula_agreed` | 3 |
| `0x1ec138`, `0x1ec170` | `cfg_get_mic_echo_params`, `cfg_get_local_friend_code` | 3 |
| `0x1ec21c`, `0x1ec1e4`, `0x1ec100`, `0x1ec1ac` | `cfg_is_data_sharing_restricted`, `cfg_is_online_interaction_restricted`, `cfg_is_streetpass_restricted`, `cfg_is_friend_registration_restricted` | 3 |
| `0x123e30`, `0x123e50` | `cfg_is_canada_or_usa`, `cfg_get_coppacs_state` | 3 |
| `0x107188` | `ptm_open_session` (déjà posé par l'analyse) | 4 |
| `0x11852c`, `0x11fea4` | `ptm_get_step_history_or_break`, `get_today_step_level` | 4 |
| `0x12b2d0` | `ro_manager_get_instance` | 6 |
| `0x10a518`, `0x110eac` | `ro_manager_initialize`, `ro_manager_read_file` | 6 |
| `0x357a54`, `0x357b8c`, `0x357960`, `0x128744` | `ro_manager_load_module`, `ro_manager_start_module`, `ro_manager_load_and_start_module`, `ro_manager_unload_module` | 6 |
| `0x10eedc` | `ro_register_crr` | 6 |
| `0x1e7604`, `0x133e5c`, `0x1e7760` | `ro_LoadModule`, `ro_UnloadModule`, `ro_GetSizeInfo` | 6 |
| `0x1e7878`, `0x146978`, `0x1e7c48` | `ro_Module_DoInitialize`, `ro_Module_DoFinalize`, `ro_Module_IsAllSymbolResolved` | 6 |
| `0x15fc68` | `ro_call_control_object` | 6 |
| `0x1e7804`, `0x146a50` | `ro_register_code_range`, `ro_unregister_code_range` | 6 |
| `0x146ad4` | `ro_mirror_to_heap_address` | 6 |
| `0x3506fc` | `create_title_proc` | 6 |
