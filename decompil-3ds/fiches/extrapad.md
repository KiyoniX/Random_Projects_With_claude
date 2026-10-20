# extrapad, l'étalonnage du Circle Pad Pro

`extrapad` est l'applet qui étalonne le Circle Pad Pro, l'accessoire qui ajoute un second pad circulaire et deux gâchettes et qui parle à la console par l'infrarouge. Elle se lance comme une application ou comme une applet de bibliothèque appelée par un jeu, dialogue avec l'accessoire par `ir:USER`, dessine par `gsp::Gpu` avec la bibliothèque graphique et la bibliothèque de mise en page des applets, et rend au jeu un bloc de paramètre où elle a écrit son résultat.

Fiche du 20 octobre 2026, tirée du brouillon du 18/10 (`local/analyse/extrapad/`) après relecture adverse. Produite avec Ghidra (`outils/ghidra_direct.py`), `outils/couverture.py` et des lectures du désassemblage. Les adresses sont celles du module chargé à `0x00100000`.

**Les noms.** Un nom sans marque est dans `extrapad.noms.tsv` à cette adresse (confiance haute). Un nom suivi de † n'est que **proposé** (confiance moyenne, `local/analyse/extrapad/noms-proposes.tsv`).

## Carte d'identité

| | |
| --- | --- |
| Titre | `000400300000CD02`, nom `extrapad` (exheader) |
| Fichier lu | `local/extrait/extrapad/exefs/code.bin` et `exheader.bin` |
| Taille | 0x55350 octets de code (`0x100000`), 0x82BC de lecture seule (`0x156000`), 0x5678 de données (`0x15f000`), 0xDC38 de mémoire à zéro ; pile de 0x4000 |
| Fonctions | 1 743 pour Ghidra, plus 111 entrées manquées et un corps de veneer (`0x1000a8`) : 1 855 ; 150 nommées dans `extrapad.noms.tsv`, 577 proposées en moyenne |
| Services permis (exheader) | `$hioFIO`, `$hostio0`, `$hostio1`, `cfg:u`, `fs:USER`, `gsp::Gpu`, `hid:USER`, `ndm:u`, `pxi:dev`, `APT:U`, `csnd:SND`, `ir:USER` |
| Services ouverts par le code | `srv:`, `APT:A` puis `APT:U` en repli, `cfg:u` (et `cfg:s`, `cfg:i` en repli), `fs:USER`, `gsp::Gpu`, `hid:USER`, `ir:USER`, `csnd:SND`, `ndm:u`, et le port `err:f` |
| Dépendances déclarées | 32 titres (exheader) |
| Romfs | un fichier compressé pour les mises en page et leurs animations, un pour les sons, les messages par langue et les nuanceurs |

`ir:rst` n'est pas utilisé : il n'est ni dans l'exheader ni dans les chaînes du binaire. L'accessoire est lu par `ir:USER` seulement.

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle à la suite :

1. `clear_bss` (`0x100024`) : met à zéro de `0x164678` à `0x1722b0`, la fin des données et les 0xDC38 octets de mémoire à zéro de l'exheader.
2. `0x100d64` : les réglages régionaux de la bibliothèque C.
3. `0x13114c` : le moteur d'exécution (arbitre d'adresses, régions `0x10000000` et `0x0E000000`), puis le port `srv:` et `SRV_RegisterClient` (`0x101a14`).
4. `0x100dd8` : le tas linéaire et le tas ordinaire (0xE7000 octets), une première initialisation d'APT (`APT_GetAppletManInfo`, `0x130e68`), puis la priorité du fil d'après `decode_thread_priority` (`0x100eac`).
5. `0x100774` (Thumb) : les 70 constructeurs statiques (poignées remises à zéro, verrous, fabrique de scènes, table du CRC-8, poignée du port `err:f` par `static_init_errf_port` `0x1512a4`).
6. `0x100d30` : la table d'initialisation, vide.
7. `0x100db8` : le fil des notifications de `srv:`, l'initialisation d'APT en application avec `APT_SetScreenCapturePostPermission` (`0x101ab8`), puis `NDMU_OverrideDefaultDaemons` (`0x108a50`) et `NDMU_SuspendDaemons` (`0x108a14`).
8. `extrapad_main`† (`0x100b50`), puis un saut vers l'appel système de fin du processus.

`extrapad_main`† règle ses tas, charge les sons, lit les réglages d'APT, reçoit le paramètre (`0x102398`, partie 3), tourne tant que `0x101354` rend 0, et finit par `extrapad_shutdown`† (`0x102788`).

## Partie 2 : les services, requête par requête

Chaque envoi a été lu dans le désassemblage : l'en-tête écrit à `+0x80` du stockage local, la poignée lue juste avant `svc 0x32`, et la poignée remontée jusqu'à son ouverture, où la chaîne du service est citée. Les noms des commandes viennent de la Carte des services.

| Service | Poignée et ouverture | Requêtes nommées dans la fiche |
| --- | --- | --- |
| `srv:` | `[0x1641d4]`, connexion au port « srv: » | `SRV_RegisterClient`, `SRV_EnableNotification`, `SRV_GetServiceHandle`, `SRV_ReceiveNotification`, `SRV_PublishToSubscriber` (`0x12ddc4`) |
| `APT:A` / `APT:U` | `[0x163fb4]` ; « APT:A » d'abord, « APT:U » si refus ; chaque requête sous le verrou rendu par `APT_GetLockHandle` (`0x1050c4`) | 31 requêtes (`APT_*`), jusqu'à `APT_CheckNew3DS` (`0x143df4`) |
| `cfg:u` (repli `cfg:s`, `cfg:i`) | `[0x164128]` ; `[0x164124]` et `[0x164120]` pour les replis | `CFG_GetConfigInfoBlk2` (blocs `0x00070001`, `0x000B0000`, `0x000A0002`, `0x00130000`, `0x00050005`), `CFG_SecureInfoGetRegion`, `CFG_GetSystemModel` (`0x10409c`) |
| `fs:USER` | `[0x164074]` | `FSUSER_GetPriority`, `FSUSER_OpenFileDirectly` ; les autres envois de `fs:USER` et ceux d'un fichier ouvert sont seulement proposés |
| `gsp::Gpu` | `[0x1640b0]`, recopiée en `[0x1640b4]` | `GSPGPU_AcquireRight`, `GSPGPU_SetLcdForceBlack`, `GSPGPU_WriteHWRegsWithMask`, `GSPGPU_ImportDisplayCaptureInfo`, `GSPGPU_RegisterInterruptRelayQueue`, `GSPGPU_UnregisterInterruptRelayQueue` ; sept autres seulement proposés (poignée reçue par pointeur) |
| `hid:USER` | `[0x1643f0]` | `HIDUSER_GetIPCHandles` |
| `ir:USER` | `[0x16460c]`, ouverte par `ir_initialize`† (`0x140d7c`) | 12 requêtes : `IRUSER_InitializeIrnopShared`, `IRUSER_FinalizeIrnop`, `IRUSER_ClearReceiveBuffer`, `IRUSER_ClearSendBuffer`, `IRUSER_RequireConnection`, `IRUSER_Disconnect`, `IRUSER_GetReceiveEvent`, `IRUSER_GetSendEvent`, `IRUSER_GetConnectionStatusEvent`, `IRUSER_SendIrnop`, `IRUSER_SendIrnopLarge`, `IRUSER_ReleaseReceivedData` |
| `csnd:SND` | `[0x1643dc]` | `CSND_Initialize`, `CSND_Shutdown`, `CSND_ExecuteCommands`, `CSND_AcquireSoundChannels`, `CSND_ReleaseSoundChannels`, `CSND_FlushDataCache` |
| `ndm:u` | `[0x16440c]` | `NDMU_SuspendDaemons`, `NDMU_OverrideDefaultDaemons` |
| `err:f` (port) | `[0x16406c]`, connexion au port « err:f » | `ERRF_Throw` (`0x132b30`) |

69 envois sont nommés dans `extrapad.noms.tsv`.

Trois groupes d'envois sont liés mais jamais servis : leur poignée n'est écrite que par la remise à zéro d'un constructeur statique, et leur service n'est pas déclaré dans l'exheader. Ce sont des morceaux de la bibliothèque des applets qui gèrent la veille de la caméra (quatre envois de la forme de `cam:u`, poignée `[0x16411c]`), du DSP (trois envois, aucune chaîne « dsp::DSP ») et de l'heure (un envoi de la forme de `ptm:gets`, poignée `[0x164420]`). Leurs noms restent proposés.

## Partie 3 : le paramètre reçu et ce qui est rendu

`0x102398` distingue deux lancements selon le mot `[0x164a78+8]` (relu en assembleur) :

- **Applet de bibliothèque** (le mot vaut 1) : `APT_FinishPreloadingLibraryApplet` par `0x104ff0`, puis `0x12f204` reçoit le paramètre : l'identifiant de l'expéditeur en `0x164a78+4`, le bloc dans `0x164b00` (de la taille rangée en `[0x164a78+0x2c]`) et la poignée jointe ; si l'expéditeur vaut 0x101, l'octet `0x1636b0+2` est levé. Puis `APT_ReceiveCaptureBufferInfo` (0x20 octets).
- **Application** : selon l'octet `[0x164a78+0x22]`, attente d'un réveil.

Le bloc de `0x164b00`, lu par les fonctions de scène :

| Décalage | Taille | Rôle |
| --- | --- | --- |
| +0x00 | octet | lu à l'ouverture de la scène et par `0x120f4c` (sens non lu) |
| +0x01 | octet | recopié dans le bloc de configuration de l'applet par `0x14e924` (sens non lu) |
| +0x40 | mot signé | le résultat : -1 à l'ouverture de la scène (`0x14e98c`), puis écrit par `0x121428` (valeur passée par la scène) ou par `0x14eee0` (une valeur de la scène si elle est positive) |

À la fin, `extrapad_shutdown`† (`0x102788`) : en applet de bibliothèque, `unmap_shared_memory` (`0x12e888`), `APT_PrepareToCloseLibraryApplet` en boucle, puis `APT_CloseLibraryApplet` (`0x10a174`) avec le bloc de `0x164b00`, sa taille et la poignée reçue : **le bloc reçu est rendu tel que l'applet l'a modifié**. En application, `APT_PrepareToCloseApplication` puis `APT_CloseApplication` (`0x112adc`).

## Partie 4 : le dialogue avec le Circle Pad Pro

La bibliothèque de l'accessoire (`0x140d7c` à `0x143d78`, et `0x123a78` à `0x123d88`) passe tout par `ir:USER` :

1. **La connexion** (`extrapad_connect`†, `0x141ee0`) : chargement de l'étalonnage, création de la mémoire partagée de l'infrarouge et `IRUSER_InitializeIrnopShared` (`0x143434`), puis `IRUSER_RequireConnection` (`0x1433c0`) et l'attente de l'événement d'état, puis le lancement du fil de scrutation.
2. **Les paquets** suivent le format de la fiche [ir](ir.md) (partie 4) : en-tête, identifiant, taille sur 6 ou 14 bits, puis un octet de CRC-8 de polynôme 7 (la table de 256 octets est construite par `0x143d78`, relu en assembleur). Le premier octet de la charge choisit la requête, comme dans l'émulation du Circle Pad Pro de la fiche ir (partie 8) : 2 lit la mémoire de l'accessoire (adresse et taille sur 16 bits, par morceaux de 0x40), 3 écrit, 4 réinitialise ; une requête périodique de 3 octets est envoyée par la boucle de scrutation.
3. **L'étalonnage** est lu dans la mémoire de l'accessoire : quatre enregistrements de 16 octets à l'adresse 0, et une recherche à partir de 0x400 d'un enregistrement marqué ; chacun est validé par son CRC-8 (dernier octet). Centres par défaut 0x800.
4. **Le filtrage** : un écart de 5 ou moins par rapport à la valeur retenue est ignoré (`0x142b4c`, relu en assembleur), puis les valeurs sont mises à l'échelle.

## Partie 5 : le dessin

`extrapad` dessine avec une bibliothèque graphique de la forme de GL ES et son interface d'affichage : écrans du haut et du bas, tampons d'affichage de 240 lignes, programme de nuanceur chargé en binaire, attributs et uniformes nommés. Les mises en page et animations sont jouées par la bibliothèque de mise en page des applets, la police par une police de ressource BCFNT (format de 3dbrew). Les noms de ces fonctions sont proposés d'après les constantes Khronos qu'elles reçoivent et leur usage, pas d'après un symbole.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 69 envois nommés dans `extrapad.noms.tsv` : en-tête, Carte des services, et poignée globale remontée jusqu'à la chaîne de son service.
- Le démarrage et les bornes de `clear_bss` (lecture, et tailles de l'exheader) ; l'absence d'`ir:rst` (exheader et chaînes).
- Le bloc rendu au jeu est le bloc reçu (`0x164b00`), renvoyé par `APT_CloseLibraryApplet` ; le -1 initial en +0x40 : pseudo-code, puis désassemblage relu pour cette fiche.

**Interprété, à relire dans Ghidra**
- Les noms suivis de †, et la plupart des fonctions citées par leur seule adresse.
- Le sens des champs +0x00 et +0x01 du bloc, et celui des valeurs écrites en +0x40.
- Le rôle des requêtes 2, 3 et 4 de l'accessoire : repris de la fiche ir (émulation), pas vu du côté de l'accessoire.
- Les noms de la bibliothèque graphique, choisis d'après les constantes et l'usage.
- Le sens des blocs de configuration (`0x00070001` mode du son, `0x000B0000` pays) : [cfg](cfg.md) et 3dbrew.

**Pas lu**
- La logique des scènes (fabrique et objets de `0x14c000` à `0x150000`), le calcul de l'étalonnage lui-même (`0x142130`, `0x1422bc`, `0x143014`), les messages affichés.
- L'essentiel de la bibliothèque de mise en page, de la police, et l'intérieur de la bibliothèque graphique (`0x10b514`).
- Les 1 128 fonctions qui n'ont aucun nom, et les 577 qui n'ont qu'un nom proposé.

## Comment cette fiche a été faite

`couverture.py entrees extrapad` pour le dénominateur ; chaque `svc 0x32` lu avec son en-tête et sa poignée ; Carte des services pour les noms des commandes ; jumeaux d'empreinte égale dans les autres fiches pour la bibliothèque. Détail et compte dans `local/analyse/extrapad/notes-100.md`. La relecture du 20/10 a contrôlé chaque nom contre `extrapad.noms.tsv`.

**Pour reprendre.** `extrapad.noms.tsv` est le fichier de graines ; propositions dans `local/analyse/extrapad/noms-proposes.tsv`, pseudo-code dans `local/analyse/extrapad/gh/`, non versionnés.
