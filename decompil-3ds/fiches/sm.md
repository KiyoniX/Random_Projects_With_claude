# sm, le registre des services

`sm` tient l'annuaire des services de la console. Quand un jeu veut parler à `fs:USER` ou `hid:USER`, il demande d'abord à `sm` une poignée vers ce service. C'est le premier guichet que visite tout programme.

Fiche d'essai du 13 octobre 2026, produite avec REA et Ghidra sur le module extrait du FIRM de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001002`, rangé dans le NATIVE_FIRM (pas un titre de la CTRNAND) |
| Fichier lu | `local/extrait/sm/exefs/code.elf` |
| Taille | 16 784 octets de code, 584 de données en lecture seule, 80 de données, 20 808 de mémoire à zéro |
| Fonctions | 118 pour Ghidra, 11 entrées manquées, 126 au dénominateur (3 morceaux de la division retirés) ; 74 nommées dans `sm.noms.tsv` |
| Services offerts | `srv:` (14 commandes) et `srv:pm` (4 commandes) |
| Sur cette console | Luma remplace `sm` par le sien au démarrage : ce qui est lu ici est l'original de Nintendo |

## Partie 1 : la boucle de service

Tout le module tient dans une seule grande fonction, `sm_service_loop` (`0x1000a0`, 2 096 octets), qui ne rend jamais la main.

1. **Mise en place.** Elle prépare une réserve de 0xC00 octets découpée en blocs de 0x28 octets, la taille d'un contexte de session (`block_pool_init(0x106050, 0x28, 0x106080, 0xC00, 8, 0)`, appel en `0x100138`).
2. **Le port `srv:`.** `svcCreatePort` crée le port nommé `srv:`, avec 0x40 sessions au plus. Le nom est à `0x105008`.
3. **Le service `srv:pm`.** Elle s'enregistre elle-même par `srv_RegisterService` sous le nom `srv:pm` (à `0x10500d`), 0x40 sessions au plus.
4. **L'attente.** `svcReplyAndReceive` (appel système `0x4F`) répond au message précédent et attend le suivant, sur la liste de poignées rangée à `0x1099a4` (compteur à `0x109d30`).
5. **Le tri de ce qui arrive.**
   - Un client se connecte au port : `svcAcceptSession` ouvre une session et l'ajoute à la liste.
   - Une session envoie une commande : la fonction appelle le gestionnaire de son type, par la table de deux pointeurs à `0x105014`.
   - Une session se ferme (résultat `0xC920181A`) : elle est retirée de la liste et sa poignée fermée.
6. **Les réponses différées.** Si le gestionnaire rend `0xD0406401` ou `0xD0406402`, la commande est mise de côté au lieu de recevoir sa réponse : voir la partie 4.

| Type de session | Gestionnaire | Adresse |
| --- | --- | --- |
| 0 | `srv_handle_command` | `0x103a44` |
| 1 | `srvpm_handle_command` | `0x103930` |

## Partie 2 : les commandes de `srv:`

`srv_handle_command` lit l'en-tête du message dans le tampon du fil (à `+0x80` du stockage local) et fait un aiguillage sur son numéro de commande, les 16 bits du haut. Les noms et les en-têtes de requête viennent de 3dbrew (« Services ») ; l'adresse et l'en-tête de réponse sont lus dans le code.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| 1 | `0x00010002` | RegisterClient | dans l'aiguillage | `0x103a44` | `0x00010040` |
| 2 | `0x00020000` | EnableNotification | `srv_EnableNotification` | `0x103318` | `0x00020042` |
| 3 | `0x00030100` | RegisterService | `srv_RegisterService` | `0x102280` | `0x00030042` |
| 4 | `0x000400C0` | UnregisterService | `srv_UnregisterService` | `0x103238` | `0x00040040` |
| 5 | `0x00050100` | GetServiceHandle | `srv_GetServiceHandle` | `0x102dfc` | `0x00050042` |
| 6 | `0x000600C2` | RegisterPort | `srv_RegisterPort` | `0x102b78` | `0x00060040` |
| 7 | `0x000700C0` | UnregisterPort | `srv_UnregisterPort` | `0x102fb0` | `0x00070040` |
| 8 | `0x00080100` | GetPort | `srv_GetPort` | `0x102aa8` | `0x00080042` |
| 9 | `0x00090040` | Subscribe | `srv_Subscribe` | `0x1037c8` | `0x00090040` |
| 10 | `0x000A0040` | Unsubscribe | `srv_Unsubscribe` | `0x102900` | `0x000A0040` |
| 11 | `0x000B0000` | ReceiveNotification | `srv_ReceiveNotification` | `0x1035d0` | `0x000B0080` |
| 12 | `0x000C0080` | PublishToSubscriber | `srv_PublishToSubscriber` | `0x1034d8` | `0x000C0040` |
| 13 | `0x000D0040` | PublishAndGetSubscriber | `srv_PublishAndGetSubscriber` | `0x1036a8` | `0x000D0F80` |
| 14 | `0x000E00C0` | IsServiceRegistered | `srv_IsServiceRegistered` | `0x103448` | `0x000E0080` |

- Seules les commandes 1 et 6 vérifient l'en-tête entier. Les autres ne regardent que le numéro.
- RegisterClient n'appelle rien : elle vérifie que le mot suivant vaut `0x20` (le noyau y a écrit le numéro du processus appelant) et range ce numéro dans la session. Toutes les autres commandes le repassent ensuite en argument.
- Un numéro inconnu rend `0xD900182F`, un en-tête mal formé `0xD9001830`.

Les cinq commandes que Pokémon X envoie (1, 2, 5, 9, 11) ont été lues des deux côtés dans le [contrat des petits services](contrat-petits-services.md), partie 1. Ce qu'il a lu en plus dans ce module :

- **EnableNotification** cherche la fiche du processus dans la session (pour un jeu, `pm` l'a créée par RegisterProcess), y met l'octet « notifications permises » à 1 et rend son sémaphore, créé avec un maximum de 16. Fiche introuvable et impossible à créer : `0xD8806404`.
- **Subscribe** exige qu'EnableNotification soit passé (`0xD8806404`), refuse un numéro déjà inscrit (`0xD9006403`) et plus de 17 abonnements (`0xD9006405`). Pokémon X ne s'abonne qu'à `0x209`, le retrait de la carte SD.
- **ReceiveNotification** retire le plus ancien numéro d'une file de 16 en anneau, et rend `0xD8806404` si la file est vide. Le jeu s'arrête (`svcBreak`) sur cette erreur : on ne doit jamais libérer le sémaphore sans numéro en file.
- **GetServiceHandle**, mot 4 : seul le bit 0 est lu (« ne pas attendre »). Pokémon X le met à 1 pour trois services seulement : `mic:u`, `y2r:u` et `cam:u`.

## Partie 3 : les commandes de `srv:pm`

Ce service est réservé au module `pm`, qui lance les programmes.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| 1 | `0x00010042` | PublishToProcess | `srvpm_PublishToProcess` | `0x102eec` | `0x00010040` |
| 2 | `0x00020040` | PublishToAll | `srvpm_PublishToAll` | `0x102a1c` | `0x00020040` |
| 3 | `0x00030082` | RegisterProcess | `srvpm_RegisterProcess` | `0x102cdc` | `0x00030040` |
| 4 | `0x00040040` | UnregisterProcess | `srvpm_UnregisterProcess` | `0x103090` | `0x00040040` |

RegisterProcess est la commande par laquelle `pm` donne à `sm` la liste des services qu'un programme a le droit d'ouvrir. C'est cette liste que GetServiceHandle consulte.

## Partie 4 : GetServiceHandle, pas à pas

C'est la commande que Pokémon X envoie pour chaque service qu'il ouvre. `srv_GetServiceHandle` (`0x102dfc`) reçoit le nom du service, sa longueur et un drapeau.

1. **Le nom est-il valide ?** `validate_service_name` (`0x10213c`) exige 1 à 8 caractères sans zéro au milieu. Sinon `0xD9006405` (longueur) ou `0xD9006407` (zéro dans le nom).
2. **Le programme a-t-il le droit ?** `process_can_access_service` (`0x10189c`) laisse passer les processus dont le numéro est sous un seuil (les modules système), et cherche pour les autres le nom dans la liste donnée par `pm`. Refus : `0xD8E06406`.
3. **Verrou.** `lock_enter` (`0x102104`).
4. **Le service existe-t-il ?** `find_service` (`0x102030`) parcourt la table des services. Absent : `0xD0406401`, et la boucle garde la demande en attente jusqu'à ce que le service s'enregistre.
5. **Ouvrir la session.** `svcCreateSessionToPort` sur le port du service. Si le service est plein (`0xD0401834`) et que le drapeau ne dit pas « ne pas attendre », le résultat devient `0xD0406402` et la boucle attend qu'une place se libère.
6. **Verrou rendu.** `lock_leave` (`0x101efc`).

Le réveil des demandes en attente se voit dans `srv_RegisterService` : après avoir créé le port du nouveau service, elle parcourt la liste d'attente (à `0x10abf8`) et libère un sémaphore pour chaque demande qui portait ce nom.

## Partie 5 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x109f68` | nombre de services enregistrés, 160 au plus (`0xA0`) |
| `0x109f70` | table des services, 20 octets par entrée : numéro du processus propriétaire, port client, nom sur 8 octets, un drapeau |
| `0x1099a4` | liste des poignées surveillées par la boucle (les trois premières sont fixes : un sémaphore, le port `srv:`, le port `srv:pm`) |
| `0x109d30` et `0x109d34` | nombre de poignées et nombre de sessions |
| `0x109d38` | par session : son type (0 ou 1) et un pointeur vers son contexte |
| `0x10abf0` et `0x10abf8` | nombre et liste des demandes en attente d'un service |

Le découpage des 20 octets d'une entrée est lu dans les écritures de `srv_RegisterService` ; l'ordre exact des champs reste à confirmer.

## Partie 6 : les appels système utilisés

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| ControlMemory | `0x01` | `svcControlMemory` | `0x10222c` |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x1010cc` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x100098` |
| CreateSemaphore | `0x15` | `svcCreateSemaphore` | `0x1021f8` |
| ReleaseSemaphore | `0x16` | `svcReleaseSemaphore` | `0x101f1c` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x1010b4` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x101c34` |
| CloseHandle | `0x23` | écrit sur place, à onze endroits | |
| WaitSynchronization1 | `0x24` | dans `main_thread_dtor` | `0x101788` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x1015f4` |
| GetSystemInfo | `0x2A` | `svcGetSystemInfo` | `0x100ee8` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x10131c` |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x10241c` |
| Break | `0x3C` | `svcBreak` | `0x1014d8` |
| CreatePort | `0x47` | `svcCreatePort` | `0x102434` |
| CreateSessionToPort | `0x48` | `svcCreateSessionToPort` | `0x1015dc` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x1009a4` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x1009bc` |

`sm` n'appelle aucun autre service : il n'utilise que le noyau.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 18 numéros de commande et leur fonction : l'aiguillage lu par REA, et les en-têtes de 3dbrew qui tombent sur les mêmes numéros.
- `srv_GetServiceHandle` est la seule fonction qui appelle `svcCreateSessionToPort`.
- `srv_RegisterService` est, avec la boucle, la seule qui appelle `svcCreatePort`.
- `srvpm_PublishToProcess` appelle `svcGetProcessId`, ce qui colle à une commande qui reçoit une poignée de processus.
- Les cinq commandes de `srv:` que Pokémon X envoie : les mots écrits par le jeu et ceux que lit ce module s'emboîtent ([contrat des petits services](contrat-petits-services.md), partie 1).

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le rôle des cinq fonctions d'aide de la partie 4.
- Le sens des résultats `0xD0406401` et `0xD0406402` (mise en attente).
- Le contenu des tables de la partie 5.

**Pas lu**
- Le corps de 11 des 18 commandes : seuls GetServiceHandle, RegisterService, EnableNotification, PublishToProcess et RegisterProcess ont été décompilés ici, et Subscribe et ReceiveNotification par le contrat des petits services. PublishToSubscriber, qui fait entrer une notification dans la file d'un processus, n'est pas lue.
- Les 52 fonctions qui n'ont qu'un nom proposé en moyenne (`local/analyse/sm/noms-proposes.tsv`), dont la gestion de la mémoire et le démarrage.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système dans le code | un script, par motif d'octets | immédiat |
| Trouver la fonction qui contient chacun | REA | 15 s par question |
| Trouver la boucle (qui appelle `ReplyAndReceive`) | REA | 15 s |
| Trouver les gestionnaires dans la table de pointeurs | un script, puis une graine pour REA | voir ci-dessous |
| Lire l'aiguillage et nommer les commandes | REA pour le pseudo-code, la Carte des services pour les noms | 1 minute |
| Rédiger et recouper | Claude | le reste |

**Le piège rencontré.** Ghidra n'avait pas vu `srv_handle_command` comme une fonction : elle n'est appelée que par la table de pointeurs à `0x105014`, jamais directement. Huit fonctions étaient dans ce cas. Il a fallu chercher dans les données tous les pointeurs vers du code, vérifier lesquels ne tombaient dans aucune fonction, et les donner à REA dans un fichier de graines. Ghidra est passé de 102 à 110 fonctions. Ce sera pareil dans tous les modules : c'est une étape à faire d'office.

**Mise à jour du même jour.** Repassé plus tard avec `prescan.py` corrigé, `sm` compte 117 fonctions et non 110 : il restait sept fonctions d'initialisation des objets globaux, atteintes seulement par une table de distances que le premier essai ne décodait pas. L'une d'elles, à `0x103f38`, met le compteur `0x109f68` à zéro et prépare 0xA0 entrées de 0x14 octets à `0x109f70` : c'est la table des services de la partie 5, avec la taille d'entrée et le maximum de 160 lus ailleurs. Le reste de la fiche n'a pas changé.

**Pour reprendre.** `sm.noms.tsv` est le fichier de graines : une adresse, `function`, un nom. REA le recharge par la variable `REA_GHIDRA_SEED_FILE`, et toutes les fonctions sortent alors avec leur nom. Depuis, les deux étapes automatiques sont rangées dans `outils/` : `rea_bridge.py` tient REA ouvert, `prescan.py <module>` repère les appels système, nomme leurs enveloppes et trouve les fonctions manquées. Le pseudo-code brut rendu par REA est dans `local/analyse/sm/`, non versionné.
