# error, l'applet des messages d'erreur et de l'EULA

`error` est une applet de bibliothèque : une application la lance par APT quand elle doit afficher un code d'erreur, un texte d'erreur, ou faire lire et accepter le contrat de licence (EULA). L'applet reçoit un bloc de paramètre de 0xF80 octets, dessine son écran avec la bibliothèque graphique et la bibliothèque de mise en page des applets, lit les boutons et l'écran tactile, joue ses sons, puis rend le même bloc à l'appelant avec le bouton choisi et, pour l'EULA, la version acceptée. Ce n'est pas [errdisp](errdisp.md), l'écran d'erreur fatale du port `err:f` : `error` est au contraire un client de ce port.

Fiche du 20 octobre 2026, tirée du brouillon du 18/10 (`local/analyse/error/`) après relecture adverse. Produite avec Ghidra (`outils/ghidra_direct.py`), `outils/couverture.py` et des lectures du désassemblage. Les adresses sont celles du module chargé à `0x00100000`.

**Les noms.** Un nom sans marque est dans `error.noms.tsv` à cette adresse (confiance haute). Un nom suivi de † n'est que **proposé** (confiance moyenne, `local/analyse/error/noms-proposes.tsv`) : il dit ce qu'on croit, pas ce qui est prouvé.

## Carte d'identité

| | |
| --- | --- |
| Titre | `000400300000C502`, nom `error` (exheader) |
| Fichier lu | `local/extrait/error/exefs/code.bin` et `exheader.bin` |
| Taille | 0x55B8C octets de code (`0x100000`), 0x7D18 de lecture seule (`0x156000`), 0x55DC de données (`0x15e000`), 0xCE44 de mémoire à zéro ; pile de 0x4000 |
| Fonctions | 1 674 pour Ghidra, plus 104 entrées manquées et un corps de veneer (`0x1000d0`), moins une fausse entrée et trois codes morts (`error.hors-compte.tsv`) : 1 775 ; 150 nommées dans `error.noms.tsv`, 624 proposées en moyenne |
| Services permis (exheader) | `$hioFIO`, `$hostio0`, `$hostio1`, `fs:USER`, `gsp::Gpu`, `hid:USER`, `ndm:u`, `pxi:dev`, `APT:U`, `csnd:SND`, `cfg:s` |
| Services ouverts par le code | `srv:`, `APT:A` puis `APT:U` en repli, `fs:USER`, `gsp::Gpu`, `hid:USER`, `ndm:u`, `csnd:SND`, `cfg:s`, `cfg:u`, et le port `err:f` |
| Identifiant d'applet | 0x406, à +0 du bloc de configuration de l'applet que `error_main`† (`0x100bf4`) passe à `applet_config_set`† (`0x101124`) ; APT est initialisé avec 0x300 (`0x100f08`) |
| Paramètre | 0xF80 octets (+0x2C du même bloc de configuration), reçu en `0x163a60` |
| Dépendances déclarées | 31 titres (exheader) |
| Fils | le fil principal ; celui des notifications de `srv:` (`0x1017ec`) ; celui des événements d'APT (`0x1049ac`) ; celui du relais des interruptions de `gsp` (`0x138c78`) ; un fil créé par `0x146f24` (rôle non lu) |

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle huit fonctions, puis saute à `svcExitProcess` (`0x100bec`) :

1. `clear_bss` (`0x100024`) met à zéro de `0x1635dc` à `0x170420` : la fin des données (`0x15e000 + 0x55DC`) et les 0xCE44 octets de mémoire à zéro de l'exheader.
2. `0x100e04` : arguments du programme et réglages régionaux de la bibliothèque C.
3. `0x131e9c` : le moteur d'exécution (arbitre d'adresses, régions d'adresses `0x10000000` et `0x0E000000`), puis la connexion au port `srv:`.
4. `0x100e78` : tas linéaire et tas ordinaire, puis la priorité du fil courant d'après `decode_thread_priority` (`0x100f4c`).
5. `0x100850` (Thumb) : les 57 constructeurs statiques (poignées de service remises à zéro, verrous, objets d'APT et du son).
6. `0x100dd0` : la table d'initialisation, vide.
7. `0x100e58` : le fil des notifications de `srv:`, l'initialisation d'APT en application, puis `NDMU_OverrideDefaultDaemons` (`0x10c8c4`) et `NDMU_SuspendDaemons` (`0x10c888`).
8. `error_main`† (`0x100bf4`).

`error_main`† range cinq tailles de tas (de 0x40000 à 0x600000) dans la table `0x163918`, inscrit deux archives de messages, « error » (rang 0) et « eula » (rang 1), remplit le bloc de configuration de l'applet (0x406, paramètre de 0xF80 octets), prépare le son et les messages, reçoit le paramètre (`0x1021b8`, partie 3), applique la langue demandée, puis tourne une boucle de trois appels (une étape `0x101294`, qui rend non nul à la fin ; un compteur d'images ; l'affichage `0x101148`) et finit par `0x1025a8` (partie 5).

## Partie 2 : les services utilisés

Chaque envoi écrit son en-tête à `+0x80` du stockage local du fil, puis fait `svc 0x32`. La poignée est suivie jusqu'à son ouverture, par `SRV_GetServiceHandle` (`0x111ac8`) ou par `svcConnectToPort` (`0x110f68`) avec la chaîne du nom du service.

| Service | Poignée | Requêtes nommées dans la fiche |
| --- | --- | --- |
| `srv:` (port) | `[0x163194]` | `SRV_RegisterClient`, `SRV_EnableNotification`, `SRV_ReceiveNotification`, `SRV_GetServiceHandle` |
| `APT:A`, puis `APT:U` | `[0x162f3c]`, ouverte sous verrou ; la chaîne « APT:A » (`0x15d7dc`) d'abord, « APT:U » (`0x15d7d6`) si le premier est refusé | 30 requêtes : `APT_GetLockHandle`, `APT_Initialize`, `APT_Enable`, `APT_Finalize`, `APT_GetAppletManInfo`, `APT_IsRegistered`, `APT_InquireNotification`, `APT_SendParameter`, `APT_ReceiveParameter`, `APT_GlanceParameter`, `APT_CancelParameter`, `APT_PrepareToCloseLibraryApplet`, `APT_CloseLibraryApplet`, `APT_CancelLibraryApplet`, `APT_FinishPreloadingLibraryApplet`, `APT_SleepSystem`, `APT_ReplySleepQuery`, `APT_ReplySleepNotificationComplete`, `APT_NotifyToWait`, `APT_PrepareToJumpToHomeMenu`, `APT_JumpToHomeMenu`, `APT_PrepareToCloseApplication`, `APT_CloseApplication`, `APT_PrepareToStartSystemApplet`, `APT_StartSystemApplet`, `APT_GetSharedFont`, `APT_AppletUtility`, `APT_SendCaptureBufferInfo`, `APT_ReceiveCaptureBufferInfo`, `APT_SetScreenCapturePostPermission` |
| `fs:USER` | `[0x163010]` | `FSUSER_SetPriority`, `FSUSER_GetPriority`, `FSUSER_OpenArchive`, `FSUSER_OpenFileDirectly`, `FSUSER_CreateSystemSaveData`, `FSUSER_DeleteSystemSaveData` ; les autres envois de fichiers et d'archives sont seulement proposés (poignée de session non suivie) |
| `gsp::Gpu` | `[0x163048]`, recopiée en `[0x16304c]` | 13 requêtes : `GSPGPU_AcquireRight`, `GSPGPU_ReleaseRight`, `GSPGPU_RegisterInterruptRelayQueue`, `GSPGPU_UnregisterInterruptRelayQueue`, `GSPGPU_WriteHWRegs`, `GSPGPU_WriteHWRegsWithMask`, `GSPGPU_FlushDataCache`, `GSPGPU_StoreDataCache`, `GSPGPU_TriggerCmdReqQueue`, `GSPGPU_SaveVramSysArea`, `GSPGPU_RestoreVramSysArea`, `GSPGPU_ImportDisplayCaptureInfo`, `GSPGPU_SetLcdForceBlack` |
| `hid:USER` | `[0x163374]` | `HIDUSER_GetIPCHandles`, puis lecture de la mémoire partagée |
| `ndm:u` | `[0x163378]` | `NDMU_SuspendDaemons`, `NDMU_OverrideDefaultDaemons` |
| `csnd:SND` | `[0x163360]` | `CSND_Initialize`, `CSND_Shutdown`, `CSND_AcquireSoundChannels`, `CSND_ReleaseSoundChannels`, `CSND_ExecuteCommands`, `CSND_FlushDataCache` |
| `cfg:s` | `[0x162fdc]`, par `service_open` (`0x1267b8`) | `CFG_GetConfigInfoBlk8`, `CFG_SetConfigInfoBlk4`, `CFG_UpdateConfigNANDSavegame` |
| `cfg:u` (ou copie de `cfg:s`) | `[0x162fe0]` | `CFG_GetConfigInfoBlk2`, `CFG_SecureInfoGetRegion` |
| `err:f` (port) | `[0x163008]`, par `svcConnectToPort` | `ERRF_Throw` |

68 envois sont nommés dans `error.noms.tsv`. Blocs de configuration lus ou écrits : `0x000B0000` (pays), `0x00070001` (mode de sortie du son), `0x000A0002`, `0x00130000`, `0x000D0000` (lu, puis écrit pour l'EULA) et `0x00100000` (écrit pour l'EULA, 2 octets) ; le sens des numéros vient de [cfg](cfg.md).

Du code est présent sans canal prouvé : trois envois de la forme de `dsp::DSP` (aucune chaîne « dsp::DSP » dans le binaire, service absent de l'exheader : code de bibliothèque jamais servi), et quatre envois sur `[0x163124]`, une poignée qui n'est jamais ouverte (seulement remise à zéro par un constructeur statique). Ils restent hors de la fiche.

## Partie 3 : le paramètre reçu

`0x1021b8` attend le paramètre de lancement : `APT_FinishPreloadingLibraryApplet`, puis `APT_ReceiveParameter` répété jusqu'à l'échéance, dans `0x163a60`, avec la taille du bloc de configuration (0xF80), puis `APT_ReceiveCaptureBufferInfo` (0x20 octets en `0x165aac`). Champs que le code lit ou écrit :

| Décalage | Taille | Ce que le code en fait |
| --- | --- | --- |
| +0x00 | mot | octet bas : le genre d'écran (aiguillage en `0x14f3fc`, table de cinq cases en `0x14f404`) ; bit 0x100 : utiliser la langue de +0x0A (lu par `error_main`†) ; bit 0x200 : passe la boîte de texte en mode à retour à la ligne |
| +0x04 | mot | le code d'erreur, rangé dans la scène pour les genres 0 et 1 ; affiché en deux nombres (code / 10 000 et code % 10 000) et cherché par plages dans un fichier de messages choisi par la tranche code / 10 000, avec un repli sur la tranche 60 000 |
| +0x0A | demi-mot | la langue, quand le bit 0x100 est mis |
| +0x0C | texte UTF-16 | le texte à afficher (genre 1) ; un nul est écrit en +0xEE2, ce qui le borne à 1 899 caractères |
| +0xEE4 | octet | nul : `0x149bc0(1)` à l'ouverture de la scène (rôle non lu) |
| +0xEE5 | octet | recopié dans l'octet +0x20 du bloc de configuration de l'applet |
| +0xEE6 | octet | la scène range (+0xEE6 == 0) en +0xBE |
| +0xF70 | mot | le code de retour : -1 à l'ouverture de la scène (`0x14f3c8`), puis le bouton ou l'issue (partie 5) |
| +0xF74 | demi-mot | la version d'EULA acceptée |

L'aiguillage sur le genre (relu en assembleur, `0x14f3f0` à `0x14f458`) : 0 et 1 rangent le code d'erreur et donnent l'état 0 de la scène, 1 levant en plus l'octet +0xBE ; 2 et 3 donnent l'état 2 ; 4 l'état 5 ; 5 et au-delà l'état 1.

## Partie 4 : ce qui est affiché

- **Messages** : pour chaque archive inscrite (« error », « eula »), les fichiers de messages MSBT de la langue (`local/extrait/error/romfs/message/<langue>/`), plus ceux des codes d'erreur.
- **Polices** : la police partagée d'APT (`APT_GetSharedFont`, puis projection en mémoire), attendue jusqu'à ce qu'elle soit prête, puis une police de ressource BCFNT.
- **Mise en page** : les fichiers CLYT de la bibliothèque de mise en page (volets, images, textes, fenêtres, bornes) et leurs animations ; nuanceurs dans `local/extrait/error/romfs/shaders/`.
- **Son** : un fichier de sons compressé du romfs, joué par `csnd:SND` ; le séquenceur n'est pas lu.
- **Entrées** : les boutons (tenus, appuyés, relâchés, pad circulaire) et l'écran tactile, lus dans la mémoire partagée de `hid`.

## Partie 5 : ce que l'applet rend à l'appelant

- **Le code de retour en +0xF70.** `0x12176c` y range son second argument (s'il est positif ou nul) quand la scène est dans l'état 2 ; `0x121898` y range 1 (et la version d'EULA en +0xF74) ou 2 selon l'état et la touche ; `0x122360` y range une valeur de la scène si elle est positive.
- **L'EULA.** `0x12203c` écrit la configuration de la console : bloc `0x000D0000` (la version acceptée, ou 0), bloc `0x00100000`, puis `CFG_UpdateConfigNANDSavegame` (`0x140fb8`).
- **La fin.** `0x1025a8` appelle les finaliseurs, puis, en applet de bibliothèque, `APT_CloseLibraryApplet` (`0x10dd04`) avec le bloc de `0x163a60`, sa taille 0xF80 et la poignée reçue, ferme la session et termine le processus. Le bloc rendu est donc le bloc reçu, tel que l'applet l'a modifié.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 68 envois nommés dans `error.noms.tsv` : en-tête écrit à `+0x80` du stockage local, nom de la commande d'après la Carte des services, et poignée remontée jusqu'à la chaîne du service à son ouverture.
- Le démarrage et les bornes de la mémoire : `entry` lu en assembleur, et les bornes de `clear_bss` égales à la fin des données et à la taille de mémoire à zéro de l'exheader.
- Les fonctions de bibliothèque de la fiche (`snprintf`, `vsnprintf`, `strstr`, `wcsstr`, `wcslen`…) : lecture, et vecteurs exécutés sous unicorn (`outils/oracles.py`).
- Le bloc de configuration (0x406 à +0, 0xF80 à +0x2C, `0x100cec` à `0x100cf8`), l'aiguillage du genre et le -1 initial en +0xF70 : pseudo-code de Ghidra, puis désassemblage relu pour cette fiche.

**Interprété, à relire dans Ghidra**
- Les noms suivis de † et le rôle de la plupart des fonctions citées par leur seule adresse : une voie (lecture, ou jumeau d'empreinte égale dans [errdisp](errdisp.md) ou une autre fiche).
- Le sens des genres 2 à 4 (EULA, premier démarrage, affichage seul d'après libctru) : les états de la scène sont lus, l'écran qu'ils donnent ne l'est pas.
- Le sens du code de retour (bouton choisi, succès, refus) : les écritures sont lues, les valeurs de libctru ne sont pas toutes retrouvées.
- Le sens des blocs de configuration `0x000A0002` et `0x00130000`.

**Pas lu**
- Le séquenceur de son, l'essentiel de la bibliothèque de mise en page, la logique des scènes (`0x14a000` à `0x150000`), les accesseurs d'état d'APT.
- Le rôle du fil créé par `0x146f24` et des octets +0xEE4 à +0xEE6.
- Les 1 001 fonctions qui n'ont aucun nom, et les 624 qui n'ont qu'un nom proposé.

## Comment cette fiche a été faite

| Étape | Qui |
| --- | --- |
| Découper le module (1 674 fonctions) et compléter le dénominateur | `outils/ghidra_direct.py error`, `outils/couverture.py entrees error` |
| Nommer les envois, les jumeaux, la bibliothèque | scripts jetables décrits dans `local/analyse/error/notes-100.md` ; Carte des services pour les en-têtes |
| Vérifier la bibliothèque C par exécution | `outils/oracles.py error swkbd` |
| Relire le brouillon, contrôler chaque nom contre `error.noms.tsv` | relecture adverse du 20/10 |

**Pour reprendre.** `error.noms.tsv` est le fichier de graines. Les propositions et leurs preuves sont dans `local/analyse/error/noms-proposes.tsv`, le pseudo-code brut dans `local/analyse/error/gh/`, non versionnés.
