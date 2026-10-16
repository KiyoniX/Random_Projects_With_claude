# news, les notifications du menu HOME

`news` tient la base des notifications du menu HOME (la pastille « Notifications » : messages de Nintendo, de StreetPass, de SpotPass, de l'eShop), sur la sauvegarde propre au module (archive `data:`). Chaque notification se compose d'un en-tête de `0x70` octets, d'un message (texte) et d'une image (une photo 3D au format MPO). Un jeu ou une application peut en ajouter une par `news:u` (une seule commande) ; le menu HOME et la liste des notifications (`newslist`) lisent la base par `news:s`, qui a 20 commandes. `news` allume aussi la diode de notification à l'arrivée d'un message, par `ptm:sysm`.

Fiche du 16 octobre 2026, produite avec Ghidra sans le pont REA (`outils/ghidra_direct.py`, module presque tout en Thumb), `outils/emulate_dispatch.py` sur les deux aiguillages (de 0 à 0xFFFF), et la Carte des services (tirée de 3dbrew, News_Services). Adresses du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000003502`, un titre de la CTRNAND (lu dans l'exheader) ; nom interne `news`, priorité 60 (`0x3C`) |
| Fichier lu | `local/extrait/news/exefs/code.bin`, avec `exheader.bin` |
| Taille | `0x9568` octets de code (`0xA` pages), `0xBE8` de données en lecture seule (1 page), `0x500` de données (1 page), `0x26DB0` de mémoire à zéro, pile de `0x2000` |
| Fonctions | 719 pour Ghidra, dont 666 en Thumb et 53 en ARM ; 33 nommées dans `news.noms.tsv`, aucun nom sans fonction |
| Services offerts | `news:u` (1 session) et `news:s` (2 sessions) : la table des noms est à `0x10A4F4` |
| Services appelés | lus dans l'exheader : `boss:P`, `cecd:s`, `frd:u`, `fs:USER`, `ndm:u`, `nim:u`, `ptm:sysm`. Dans le code, des chaînes de nom pour `boss:P` (`0x102CFC`), `cecd:s` (`0x102764`), `ndm:u` (`0x104E04`), `nim:u` (`0x101304`), `fs:USER` (`0x1058A0`) ; `ptm:sysm` est dans la liste de noms `0x10A560` ; `frd:u` n'est écrit nulle part (le droit est déclaré, comme pour `cecd`) |
| Appelants connus | `news:u` : l'applet `maj` (exheader) ; `news:s` : `menu` (le menu HOME) et `newslist` (exheaders). Pokémon X n'ouvre aucun des deux |
| Fichiers | `data:` puis `news.db` (la base), `news%03d.txt` (le message, UTF-16), `news%03d.mpo` (l'image) : chaînes UTF-16 à `0x10A9B2`, `0x10A9DC` et `0x10A9C2`, format `%s/%ls` à `0x10A9A4` |

## Partie 1 : le démarrage et le serveur

`news_main` (`0x10014C`, 820 octets) est un seul fil de service :

1. Enregistre les deux services auprès de `sm` (`news_srv_register_service`, `0x10072C`, en-tête de commande 3) : la table `0x10A4F4` donne pour chacun son nom et le nombre de sessions (`news:u` 1, `news:s` 2).
2. Prépare cinq objets globaux (initialisations gardées par des indicateurs de première utilisation, `0x105458` et ses voisines) et s'abonne à quatre notifications de `sm` (numéros `0x100`, `0x104`, `0x106`, `0x107` passés à `0x10530C` ; leur sens n'est pas relu).
3. **Boucle** sur `ReplyAndReceive` (`svc_reply_and_receive`, `0x108DF8`) avec dix poignées au plus : six poignées d'événements et de notifications (rangs 0 à 5), les deux ports (rangs 6 et 7), puis les sessions ouvertes (rangs 8 et 9 : **deux sessions ouvertes au plus à la fois**, tous services confondus). Rang 6 ou 7 : `AcceptSession` (`svc_accept_session`, `0x108DE0`), la session est rangée avec le numéro de son service. Rang de 8 ou plus : une commande ; le module appelle `handler_table[service](session)` avec la table de deux adresses de `0x10A4D4` (`news_u_dispatch_command` `0x1078C8`, `news_s_dispatch_command` `0x1079D0`). Quand `ReplyAndReceive` rend `0xC920181A` (constante lue à `0x1004BC`, session fermée), la session est retirée (`news_close_session`, `0x1009AC`). Rangs 1 à 5 : un événement, traité par cinq paires de fonctions (`0x100830`, `0x100C54` et leurs voisines) que je n'ai pas lues.
4. À l'arrêt (indicateur à `0x10B498` levé, plus aucune session ouverte) : ferme les services et rend la main.

Appels système trouvés : 0x17 CreateEvent, 0x20 UnmapMemoryBlock, 0x21 CreateAddressArbiter, 0x22 ArbitrateAddress, 0x23 CloseHandle, 0x24 WaitSynchronization1, 0x27 DuplicateHandle, 0x28 GetSystemTick, 0x2B GetProcessInfo, 0x2D ConnectToPort, 0x32 SendSyncRequest (`0x105048`), 0x35 GetProcessId, 0x3C Break, 0x4A AcceptSession, 0x4F ReplyAndReceive. Les noms viennent de `fiches/kernel11.md`.

## Partie 2 : les deux aiguillages

Chaque aiguillage lit le numéro de commande dans les 16 bits du haut de l'en-tête (`bitfield_extract`, `0x1038E8`), saute à un cas par une table de `switch` (Ghidra ne la reconstruit pas ; `emulate_dispatch.py` l'exécute) et vérifie l'en-tête et les descripteurs (`ipc_check_header`, `0x1038A0`). Un numéro inconnu rend l'en-tête `0x00000040` et le résultat `0xD900182F`, comme les autres modules.

Les deux tables ont été exécutées par `emulate_dispatch.py news 0x1078c8=news:u 0x1079d0=news:s` :

| Aiguillage | Commandes trouvées | Numéros |
| --- | --- | --- |
| `news:u` | 1 | 1 |
| `news:s` | 20 | 1 à 0x14 |

## Partie 3 : les commandes

Les noms et les en-têtes de requête sont ceux de la Carte (3dbrew). « Vérifié » dit si l'aiguillage compare l'en-tête de requête en entier ou le numéro seulement. Pour toutes les commandes que la Carte nomme (1 pour `news:u`, 18 pour `news:s`), l'en-tête de la Carte est celui que vérifie le code.

### `news:u`

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x000100C8` | AddNotification | `news_u_cmd_0001_AddNotification` | `0x108084` | entier | `0x00010046` |

### `news:s`

| N° | En-tête (Carte) | Commande (Carte) | Gestionnaire | Adresse | Vérifié | Réponse |
| --- | --- | --- | --- | --- | --- | --- |
| 0x1 | `0x000100C6` | AddNotification | `news_s_cmd_0001_AddNotification` | `0x107658` | entier | `0x00010046` |
| 0x2 | `` | (sans nom) | inline dans l'aiguillage (répond succès) |  | numéro | `0x00020040` |
| 0x3 | `` | (sans nom) | inline dans l'aiguillage (répond succès) |  | numéro | `0x00030040` |
| 0x4 | `0x00040000` | ResetNotifications | `news_s_cmd_0004_ResetNotifications` | `0x1075F8` | numéro | `0x00040040` |
| 0x5 | `0x00050000` | GetTotalNotifications | `news_s_cmd_0005_GetTotalNotifications` | `0x107458` | numéro | `0x00050080` |
| 0x6 | `0x00060042` | SetNewsDBHeader | `news_s_cmd_0006_SetNewsDBHeader` | `0x1074E6` | entier | `0x00060042` |
| 0x7 | `0x00070082` | SetNotificationHeader | `news_s_cmd_0007_SetNotificationHeader` | `0x1074FA` | entier | `0x00070042` |
| 0x8 | `0x00080082` | SetNotificationMessage | `news_s_cmd_0008_SetNotificationMessage` | `0x10756C` | entier | `0x00080042` |
| 0x9 | `0x00090082` | SetNotificationImage | `news_s_cmd_0009_SetNotificationImage` | `0x107584` | entier | `0x00090042` |
| 0xA | `0x000A0042` | GetNewsDBHeader | `news_s_cmd_000A_GetNewsDBHeader` | `0x10748A` | entier | `0x000A0082` |
| 0xB | `0x000B0082` | GetNotificationHeader | `news_s_cmd_000B_GetNotificationHeader` | `0x1074A2` | entier | `0x000B0082` |
| 0xC | `0x000C0082` | GetNotificationMessage | `news_s_cmd_000C_GetNotificationMessage` | `0x107534` | entier | `0x000C0082` |
| 0xD | `0x000D0082` | GetNotificationImage | `news_s_cmd_000D_GetNotificationImage` | `0x107550` | entier | `0x000D0082` |
| 0xE | `0x000E0040` | SetInfoLEDPattern | `news_s_cmd_000E_SetInfoLEDPattern` | `0x107614` | numéro | `0x000E0040` |
| 0xF | `0x000F0000` | SyncArrivedNotifications | `news_s_cmd_000F_SyncArrivedNotifications` | `0x107604` | numéro | `0x000F0040` |
| 0x10 | `0x00100040` | SyncOneArrivedNotification | `news_s_cmd_0010_SyncOneArrivedNotification` | `0x10747A` | numéro | `0x00100040` |
| 0x11 | `0x00110040` | SetAutomaticSyncFlag | `news_s_cmd_0011_SetAutomaticSyncFlag` | `0x107468` | numéro | `0x00110040` |
| 0x12 | `0x00120082` | SetNotificationHeaderOther | `news_s_cmd_0012_SetNotificationHeaderOther` | `0x1075BE` | entier | `0x00120042` |
| 0x13 | `0x00130000` | WriteNewsDBSavedata | `news_s_cmd_0013_WriteNewsDBSavedata` | `0x10759C` | numéro | `0x00130040` |
| 0x14 | `0x00140000` | GetTotalArrivedNotifications | `news_s_cmd_0014_GetTotalArrivedNotifications` | `0x1075AE` | numéro | `0x00140080` |


Notes :

- **`news:s` 0x2 et 0x3 sont des commandes vides.** Le code les accepte (numéro seul), sans lire de paramètre ni appeler de fonction : le cas répond directement succès (résultat 0, réponses `0x00020040` et `0x00030040`). La Carte les avait déjà, en en-têtes incomplets avec la note de 3dbrew « Stubbed, only returns 0 » : le code confirme 3dbrew. (Corrigé le 17/10 : la première version de cette fiche les disait absentes de la Carte.)
- `news:u` AddNotification a un en-tête différent de celui de `news:s` : `0x000100C8` contre `0x000100C6`. D'après l'émulation, la version pour les jeux contient un descripteur de numéro de processus (rempli par le noyau) : le service des jeux **prend l'identité de l'appelant par son numéro de processus**, celui du menu la reçoit dans la requête.
- Les gestionnaires sont de fines enveloppes : chacun prend l'objet global de la base (`0x105298`, un singleton) et appelle une méthode. `SetInfoLEDPattern` (0xE) ne touche pas à la base : elle appelle la fonction qui envoie la commande à `ptm:sysm` (`0x104E48`, qui sert aussi à la fin d'AddNotification avec le motif 2).

## Partie 4 : une opération pas à pas, AddNotification

Un jeu ajoute une notification par `news:u` (commande 1, `0x000100C8`). Lu dans `news_u_cmd_0001_AddNotification` (`0x108084`) et la fonction qu'elle appelle (`0x107688`) ; les rôles sont interprétés.

1. `news_u_dispatch_command` (`0x1078C8`) vérifie l'en-tête en entier et les descripteurs (le numéro de processus, puis les tampons en lecture : l'en-tête de notification, le message, l'image), appelle le gestionnaire et répond `0x00010046`.
2. Le gestionnaire s'assure que le singleton de la base est initialisé (garde de première utilisation) puis appelle `0x107688`.
3. `0x107688` copie les `0x70` octets de l'en-tête dans un tampon local (`0x104504`, `0x104FB8`), **résout le numéro de processus en identifiant de titre** (`0x1068B2`), range celui-ci dans l'en-tête, lit une seconde valeur (`0x10716C`, interprété comme l'heure) et la range.
4. Elle écrit la notification dans la base par la méthode `0x104520` (taille `0x70` pour l'en-tête, et les tailles des tampons du message et de l'image ; ce qu'elle fait de `news.db`, `news%03d.txt` et `news%03d.mpo` n'est pas relu).
5. Elle relit l'en-tête de la base (`0x10` octets, `0x104C8E`), lève le bit 0 de son quatrième octet s'il ne l'était pas (interprété : « il y a des notifications non lues ») et le réécrit (`0x104C6C`).
6. Elle règle la diode de notification sur le motif 2 (`0x104E48` : `ptm:sysm`, `SetInfoLEDPattern`, comme la Carte le note) et rend 0.

## Partie 5 : tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x10A4D4` | table des aiguillages : `0x1078C9`, `0x1079D1` (adresses Thumb) |
| `0x10A4F4` | table des services : (nom, nombre de sessions) `news:u` 1, `news:s` 2 |
| `0x10A504` | les noms `news:u` et `news:s` |
| `0x10A512` à `0x10A99A` | la liste de noms de services de la bibliothèque commune (`nim:u`, `fs:LDR`, `fs:USER`, `ndm:u`, `srv:pm`, `boss:U/P/M`, `cecd:u/s`, `data:`, `err:f`, `ptm:*`, `APT:A`, `gsp::*`) : pas des sessions ouvertes par `news` |
| `0x10A9A4` à `0x10A9DC` | `%s/%ls`, `news.db`, `news%03d.mpo`, `news%03d.txt` (chaînes UTF-16) |
| `0x10B280` à `0x10B290` | les pointeurs vers `data:`, `%s/%ls`, `news.db`, `news%03d.txt`, `news%03d.mpo` |
| `0x1004BC` | la constante `0xC920181A` du résultat « session fermée » |

## Partie 6 : ce que Pokémon X envoie

Rien : le jeu n'ouvre ni `news:u` ni `news:s`. Pour le portage PC, `news` n'a rien à rendre à la place de la console.

## Ce qui est sûr, interprété, pas lu

**Sûr** (deux voies indépendantes) :
- Les deux tables de commandes : 1 pour `news:u`, 20 pour `news:s`. Voie 1 : l'émulation des deux aiguillages. Voie 2 : la Carte des services (3dbrew) : mêmes numéros et mêmes en-têtes pour les 19 commandes qu'elle nomme ; 0x2 et 0x3 y sont en en-têtes incomplets (« Stubbed »), et le pseudo-code de l'aiguillage confirme qu'ils répondent succès sans rien faire.
- Les noms des deux services et leurs nombres de sessions (1 et 2) : table `0x10A4F4` et appel de `news_srv_register_service`.
- Les noms de fichiers de la base, lus dans les chaînes du module.

**Interprété** :
- Les noms des gestionnaires (de la Carte) et des aides.
- Le déroulement d'AddNotification (étapes 3 à 6), le sens du bit levé dans l'en-tête de la base, le motif 2 de la diode.
- Que le singleton à `0x105298` est la base de notifications ; que les deux sessions sont un total pour les deux services ; que les six premières poignées sont des événements et des notifications de `sm`.

**Pas lu** :
- Le format de `news.db`, de l'en-tête de `0x70` octets et des fichiers de message et d'image : la lecture et l'écriture disque.
- Pourquoi `news` appelle `boss:P`, `cecd:s`, `nim:u`, `ndm:u` (probablement pour recevoir les notifications venues de SpotPass, StreetPass et de l'eShop, et pour s'écarter pendant les mises à jour de `ndm`) : leurs appels n'ont pas été suivis.
- Les cinq paires de fonctions qui répondent aux événements de la boucle.
- La synchronisation (`SyncArrivedNotifications`, `SyncOneArrivedNotification`, `SetAutomaticSyncFlag`) : seuls les gestionnaires d'entrée ont été lus.
