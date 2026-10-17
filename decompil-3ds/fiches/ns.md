# ns, le chef d'orchestre des programmes

`ns` décide quel programme est au premier plan. Il porte les services `APT`, par lesquels une application, le menu HOME et les applets (clavier, navigateur, liste d'amis…) se passent la main, et les services `ns:`, par lesquels le système lance un titre ou redémarre la console. C'est le premier service qu'un jeu appelle après `srv:` : tant que `ns` ne lui a pas dit « tu es au premier plan », le jeu attend.

Fiche du 13 octobre 2026, produite avec REA et Ghidra sur le module dumpé de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000008002` (lu dans l'exheader) |
| Fichier lu | `local/extrait/ns/exefs/code.elf` |
| Taille | 129 596 octets de code, 5 544 de données en lecture seule, 9 376 de données, 995 764 de mémoire à zéro |
| Fonctions | 919, dont 321 nommées dans `ns.noms.tsv` (309 à l'écriture de la fiche, 12 de plus venus du contrat APT) |
| Services offerts | `APT:A`, `APT:U`, `APT:S` (les mêmes 93 commandes, une session à la fois) ; `ns:s` (22 commandes, 3 sessions), `ns:p` (2 commandes, 1 session), `ns:c` (2 commandes, 1 session) |
| Services appelés | `srv:`, `pm:app`, `am:u`, `fs:USER`, `ptm:sysm`, `cfg:s`, `ps:ps`, `cam:s`, `qtm:sp`, `nwm::EXT`, et le port `err:f` |
| Dépendances déclarées | `ptm` (`0004013000002202`) et `cfg` (`0004013000001702`) |
| Fils | le fil principal, plus six qu'il crée ou fait créer (partie 1) |
| Code Thumb | presque rien : le début du fichier, de `0x100048` à `0x10022c`, qui vient de la bibliothèque du compilateur |

## Partie 1 : le démarrage et les fils

`entry` (`0x100000`) appelle à la suite : `clear_bss` (`0x100024`), qui met à zéro la mémoire de `0x1244a0` à `0x217654` ; une fonction de la bibliothèque (`0x10027c`) ; une fonction de préparation (`0x112820`), qui continue dans `srv_init` ; le petit morceau en Thumb à `0x1001ec`, qui appelle les 64 fonctions d'initialisation des objets globaux par la table de `0x1214a8` à `0x1215a8` ; puis `ns_main` (`0x100318`) et enfin `svcExitProcess`.

**Ce que fait `ns_main` avant sa boucle, dans l'ordre :**

1. `srv_init` (`0x112830`) se connecte au port `srv:` et s'y déclare (`SRV_RegisterClient`).
2. `SRV_RegisterService` crée `ns:s`, `ns:p` et `ns:c`. Les noms et le nombre de sessions (3, 1, 1) sont dans la table à `0x120188`.
3. Les sessions vers les autres modules sont ouvertes : `pm:app`, `ps:ps`, `cfg:s`, `ptm:sysm`, puis `fs:USER` (suivi de `FSUSER_InitializeWithSdkVersion` et `FSUSER_SetPriority`).
4. `job_queue_start_thread` (`0x103410`) lance un fil qui exécute une file de travaux.
5. Une minuterie est créée (`0x124204`), un gestionnaire est inscrit pour la notification `0x100`, et `SRV_EnableNotification` rend le sémaphore des notifications (`0x124484`).
6. `PMAPP_GetFIRMLaunchParams` copie à `0x215000` la page de 0x1000 octets des paramètres de redémarrage (voir la fiche de `pm`).
7. Deux fonctions de rattrapage, dont une cite le fichier `ns_Workaround.cpp`, peuvent redémarrer la console tout de suite. Pas lues en détail.
8. `start_shared_font_thread` (`0x101540`) crée un bloc de mémoire partagée de 0x332000 octets et le fil qui y charge la police du système.
9. Les titres du système sont lancés par `PMAPP_LaunchTitle` : `0004003000008A02`, puis le menu HOME, dont le numéro vient de la table de la partie 5 (identifiant `0x101`).
10. `start_apt_thread` (`0x101dc4`) appelle `apt_init` (`0x10287c`) puis crée le fil qui sert `APT`.
11. `subscribe_system_notifications` (`0x1011a0`) abonne `ns` à 16 notifications (partie 7).

**Les fils.** Tous passent par `create_thread` (`0x111ab8`), la seule fonction qui appelle `svcCreateThread`, et commencent dans `thread_trampoline` (`0x10bc90`).

| Fil | Fonction | Adresse | Créé par | Ce qu'il fait |
| --- | --- | --- | --- | --- |
| Principal | `ns_main` | `0x100318` | le noyau | Sert `ns:s`, `ns:p`, `ns:c` et reçoit les notifications |
| Service d'APT | `apt_thread_main` | `0x102978` | `start_apt_thread` | Sert `APT:A`, `APT:U`, `APT:S` (partie 2) |
| Ouvrier d'APT | `apt_worker_thread_main` | `0x109944` | `start_apt_worker_thread` (`0x1056c0`), depuis `apt_init` | Fait les passages de main qui prennent du temps (partie 4) |
| Police | `shared_font_thread_main` | `0x1020a4` | `start_shared_font_thread` | Charge la police dans la mémoire partagée, puis se termine |
| File de travaux | `job_queue_thread_main` | `0x105c8c` | `job_queue_start_thread` | Exécute les travaux qu'on lui dépose, un par un |
| Bouton HOME | `home_button_thread_main` | `0x118de8` | `on_notification_204`, à chaque appui | Prévient les programmes, puis se termine (partie 6) |
| Erreur | la fonction à `0x118780` | `0x118780` | les objets des notifications `0x209` et `0x20A` (`0x1183f0`, `0x118320`) | Envoie une erreur fatale à `err:f`. Pas lu |

**La boucle de `ns_main`.**

1. **La liste des poignées** est à `0x217630`, son compteur à `0x124468`. Les cinq premières sont fixes : le sémaphore des notifications, la minuterie, puis les ports `ns:s`, `ns:p` et `ns:c`. Les sessions ouvertes viennent ensuite, quatre au plus.
2. **L'attente.** `svcReplyAndReceive` répond au message précédent et attend le suivant. Quand il n'y a rien à répondre, le code écrit `0xFFFF0000` à la place de l'en-tête.
3. **Le tri**, d'après le rang de la poignée qui a sonné :
   - rang 0 : `handle_srv_notification` (`0x102608`) lit le numéro par `SRV_ReceiveNotification` et appelle le gestionnaire inscrit pour ce numéro ;
   - rang 1 : la minuterie, traitée par la fonction à `0x1124d0` (elle fait avancer l'état de mise en veille) ;
   - rang 2 à 4 : un port. `svcAcceptSession` ouvre la session ; s'il y en a déjà quatre, elle est refermée aussitôt. Son type (0, 1 ou 2) et son contexte sont notés dans la table à `0x21754c` ;
   - rang 5 et plus : une session. Le gestionnaire de son type est appelé, par la table de trois pointeurs à `0x1201a0`.
4. **Une session se ferme** (résultat `0xC920181A`) : sa poignée est fermée et la dernière session de la liste prend sa place.
5. **La sortie.** La notification `0x100` met l'octet `0x124474` à 1 (`on_notification_100`, `0x11e520`). La boucle s'arrête quand cet octet vaut 1 et qu'aucune session n'est ouverte.

| Type de session | Service | Gestionnaire | Adresse |
| --- | --- | --- | --- |
| 0 | `ns:s` | `nss_handle_command` | `0x116e68` |
| 1 | `ns:p` | `nsp_handle_command` | `0x116dec` |
| 2 | `ns:c` | `nsc_handle_command` | `0x117320` |

## Partie 2 : comment APT est servi

`APT` a son propre fil et sa propre boucle, dans `apt_thread_main` (`0x102978`). Elle ne ressemble pas à celle de `ns_main` sur un point : **elle ne sert qu'un client à la fois.**

1. **Les trois ports.** `SRV_RegisterService` crée `APT:A`, `APT:U` et `APT:S`, dans cet ordre, avec une seule session permise chacun. Les trois noms sont dans la table à `0x124180`.
2. **La liste des poignées** est sur la pile du fil : un signal d'arrêt (`0x124164`), une minuterie (`0x2103b4`), puis les trois ports.
3. **Un client se connecte.** `svcAcceptSession` ouvre la session, qui prend dans la liste la place des trois ports. `apt_set_session_service` (`0x103bc4`) note à `0x1241c2` par quel port le client est entré : 0 pour `APT:A`, 1 pour `APT:U`, 2 pour `APT:S`. À partir de là le fil n'attend plus que trois poignées : le signal, la minuterie et cette session. Personne d'autre ne peut entrer.
4. **Chaque commande** est traitée par `apt_handle_command` (`0x103e6c`), le même pour les trois services.
5. **Le client ferme sa session** (résultat `0xC920181A`) : les trois ports reprennent leur place, et le fil attend le client suivant.

C'est ce qui explique la première commande d'un jeu, `GetLockHandle` : elle rend un verrou commun à tous les clients. Un programme le prend, ouvre une session `APT`, envoie ses commandes, ferme la session, puis rend le verrou. Sans cette discipline, deux programmes se bloqueraient à la porte. Cette façon de faire du côté du client n'est pas dans `ns` : elle est connue par libctru, la bibliothèque libre des programmes amateurs.

**Ce qui distingue `APT:A`, `APT:U` et `APT:S`.** Il n'y a ni table à part ni aiguillage à part : les trois services partagent tout. La seule différence est l'octet `0x1241c2`, que deux petites fonctions consultent. Quand le service ne convient pas, elles n'envoient pas de code d'erreur : elles arrêtent `ns` par `panic` (`0x112724`, qui finit sur `svcBreak`).

| Fonction | Adresse | Exige | Appelée par |
| --- | --- | --- | --- |
| `require_apt_s` | `0x10f980` | `APT:S` | `apt_Initialize` (seulement pour inscrire le menu HOME), `apt_PrepareToStartApplication`, `apt_OrderToCloseApplication`, `apt_GetProgramInfo`, `apt_Reboot` |
| `require_not_apt_a` | `0x10b1b0` | `APT:U` ou `APT:S` | `apt_GetAppletInfo`, seulement quand on lui demande le numéro de titre de l'application |

Les quatre commandes réservées à `APT:S` sont exactement les quatre que 3dbrew liste pour `APT:S` et pas pour `APT:U`. L'ordre des trois services est donc un ordre de droits : `APT:A` en a le moins, `APT:S` le plus.

**Les tampons.** `apt_setup_static_buffers` (`0x103d00`) prépare, sur la pile du fil, un tampon de 0x1000 octets pour les données qui accompagnent une commande, et 0x20 octets de plus à sa suite. C'est ce tampon que `apt_handle_command` reçoit en argument.

## Partie 3 : les commandes d'APT

`apt_handle_command` lit l'en-tête dans le tampon du fil (à `+0x80` du stockage local), prend le numéro de commande dans les 16 bits du haut, et le cherche par une suite de comparaisons et de tables de saut. Les noms et les en-têtes de requête viennent de 3dbrew ; la fonction, l'adresse et l'en-tête de réponse sont lus dans le code.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| `0x01` | `0x00010040` | GetLockHandle | `apt_GetLockHandle` | `0x1069e8` | `0x000100C2` |
| `0x02` | `0x00020080` | Initialize | `apt_Initialize` | `0x106500` | `0x00020043` |
| `0x03` | `0x00030040` | Enable | `apt_Enable` | `0x1096e0` | `0x00030040` |
| `0x04` | `0x00040040` | Finalize | `apt_Finalize` | `0x109828` | `0x00040040` |
| `0x05` | `0x00050040` | GetAppletManInfo | `apt_GetAppletManInfo` | `0x10716c` | `0x00050140` |
| `0x06` | `0x00060040` | GetAppletInfo | `apt_GetAppletInfo` | `0x1068e4` | `0x000601C0` |
| `0x07` | `0x00070000` | GetLastSignaledAppletId | `apt_GetLastSignaledAppletId` | `0x1086dc` | `0x00070080` |
| `0x08` | `0x00080000` | CountRegisteredApplet | `apt_CountRegisteredApplet` | `0x108590` | `0x00080080` |
| `0x09` | `0x00090040` | IsRegistered | `apt_IsRegistered` | `0x1067cc` | `0x00090080` |
| `0x0A` | `0x000A0040` | GetAttribute | `apt_GetAttribute` | `0x10671c` | `0x000A0080` |
| `0x0B` | `0x000B0040` | InquireNotification | `apt_InquireNotification` | `0x108054` | `0x000B0080` |
| `0x0C` | `0x000C0104` | SendParameter | `apt_SendParameter` | `0x106bbc` | `0x000C0040` |
| `0x0D` | `0x000D0080` | ReceiveParameter | `apt_ReceiveParameter` | `0x107268` | `0x000D0104` |
| `0x0E` | `0x000E0080` | GlanceParameter | `apt_GlanceParameter` | `0x106e6c` | `0x000E0104` |
| `0x0F` | `0x000F0100` | CancelParameter | `apt_CancelParameter` | `0x106dcc` | `0x000F0080` |
| `0x10` | `0x001000C2` | DebugFunc | `apt_DebugFunc` | `0x1098ac` | `0x00100082` |
| `0x11` | `0x001100C0` | MapProgramIdForDebug | dans l'aiguillage | | `0x00110040` |
| `0x12` | `0x00120040` | SetHomeMenuAppletIdForDebug | dans l'aiguillage | | `0x00120040` |
| `0x13` | `0x00130000` | GetPreparationState | `apt_GetPreparationState` | `0x108034` | `0x00130080` |
| `0x14` | `0x00140040` | SetPreparationState | `apt_SetPreparationState` | `0x1080f4` | `0x00140040` |
| `0x15` | `0x00150140` | PrepareToStartApplication | `apt_PrepareToStartApplication` | `0x108cac` | `0x00150040` |
| `0x16` | `0x00160040` | PreloadLibraryApplet | `apt_PreloadLibraryApplet` | `0x108490` | `0x00160040` |
| `0x17` | `0x00170040` | FinishPreloadingLibraryApplet | `apt_FinishPreloadingLibraryApplet` | `0x109548` | `0x00170040` |
| `0x18` | `0x00180040` | PrepareToStartLibraryApplet | `apt_PrepareToStartLibraryApplet` | `0x1091f4` | `0x00180040` |
| `0x19` | `0x00190040` | PrepareToStartSystemApplet | `apt_PrepareToStartSystemApplet` | `0x109014` | `0x00190040` |
| `0x1A` | `0x001A0000` | PrepareToStartNewestHomeMenu | `apt_PrepareToStartNewestHomeMenu` | `0x109478` | `0x001A0040` |
| `0x1B` | `0x001B00C4` | StartApplication | `apt_StartApplication` | `0x1072b0` | `0x001B0040` |
| `0x1C` | `0x001C0000` | WakeupApplication | `apt_WakeupApplication` | `0x107ae4` | `0x001C0040` |
| `0x1D` | `0x001D0000` | CancelApplication | `apt_CancelApplication` | `0x107354` | `0x001D0040` |
| `0x1E` | `0x001E0084` | StartLibraryApplet | `apt_StartLibraryApplet` | `0x107e3c` | `0x001E0040` |
| `0x1F` | `0x001F0084` | StartSystemApplet | `apt_StartSystemApplet` | `0x10777c` | `0x001F0040` |
| `0x20` | `0x00200044` | StartNewestHomeMenu | `apt_StartNewestHomeMenu` | `0x108108` | `0x00200040` |
| `0x21` | `0x00210000` | OrderToCloseApplication | `apt_OrderToCloseApplication` | `0x108718` | `0x00210040` |
| `0x22` | `0x00220040` | PrepareToCloseApplication | `apt_PrepareToCloseApplication` | `0x108b04` | `0x00220040` |
| `0x23` | `0x00230040` | PrepareToJumpToApplication | `apt_PrepareToJumpToApplication` | `0x108f4c` | `0x00230040` |
| `0x24` | `0x00240044` | JumpToApplication | `apt_JumpToApplication` | `0x1075c8` | `0x00240040` |
| `0x25` | `0x002500C0` | PrepareToCloseLibraryApplet | `apt_PrepareToCloseLibraryApplet` | `0x1090f8` | `0x00250040` |
| `0x26` | `0x00260000` | PrepareToCloseSystemApplet | `apt_PrepareToCloseSystemApplet` | `0x108d38` | `0x00260040` |
| `0x27` | `0x00270044` | CloseApplication | `apt_CloseApplication` | `0x106f84` | `0x00270040` |
| `0x28` | `0x00280044` | CloseLibraryApplet | `apt_CloseLibraryApplet` | `0x107b70` | `0x00280040` |
| `0x29` | `0x00290044` | CloseSystemApplet | `apt_CloseSystemApplet` | `0x107434` | `0x00290040` |
| `0x2A` | `0x002A0000` | OrderToCloseSystemApplet | `apt_OrderToCloseSystemApplet` | `0x1088e4` | `0x002A0040` |
| `0x2B` | `0x002B0000` | PrepareToJumpToHomeMenu | `apt_PrepareToJumpToHomeMenu` | `0x108830` | `0x002B0040` |
| `0x2C` | `0x002C0044` | JumpToHomeMenu | `apt_JumpToHomeMenu` | `0x106c30` | `0x002C0040` |
| `0x2D` | `0x002D0000` | PrepareToLeaveHomeMenu | `apt_PrepareToLeaveHomeMenu` | `0x10865c` | `0x002D0040` |
| `0x2E` | `0x002E0044` | LeaveHomeMenu | `apt_LeaveHomeMenu` | `0x106a7c` | `0x002E0040` |
| `0x2F` | `0x002F0040` | PrepareToLeaveResidentApplet | dans l'aiguillage | | `0x002F0040` |
| `0x30` | `0x00300044` | LeaveResidentApplet | dans l'aiguillage | | `0x00300040` |
| `0x31` | `0x00310100` | PrepareToDoApplicationJump | `apt_PrepareToDoApplicationJump` | `0x108e34` | `0x00310040` |
| `0x32` | `0x00320084` | DoApplicationJump | `apt_DoApplicationJump` | `0x1074e0` | `0x00320040` |
| `0x33` | `0x00330000` | GetProgramIdOnApplicationJump | `apt_GetProgramIdOnApplicationJump` | `0x1095d0` | `0x003301C0` |
| `0x34` | `0x00340084` | SendDeliverArg | `apt_SendDeliverArg` | `0x110698` | `0x00340040` |
| `0x35` | `0x00350080` | ReceiveDeliverArg | `apt_ReceiveDeliverArg` | `0x107720` | `0x00350104` |
| `0x36` | `0x00360040` | LoadSysMenuArg | `apt_LoadSysMenuArg` | `0x106db4` | `0x00360042` |
| `0x37` | `0x00370042` | StoreSysMenuArg | `apt_StoreSysMenuArg` | `0x106f6c` | `0x00370040` |
| `0x38` | `0x00380040` | PreloadResidentApplet | dans l'aiguillage | | `0x00380040` |
| `0x39` | `0x00390040` | PrepareToStartResidentApplet | dans l'aiguillage | | `0x00390040` |
| `0x3A` | `0x003A0044` | StartResidentApplet | dans l'aiguillage | | `0x003A0040` |
| `0x3B` | `0x003B0040` | CancelLibraryApplet | `apt_CancelLibraryApplet` | `0x107f00` | `0x003B0040` |
| `0x3C` | `0x003C0042` | SendDspSleep | `apt_SendDspSleep` | `0x106814` | `0x003C0040` |
| `0x3D` | `0x003D0042` | SendDspWakeUp | `apt_SendDspWakeUp` | `0x106ae8` | `0x003D0040` |
| `0x3E` | `0x003E0080` | ReplySleepQuery | `apt_ReplySleepQuery` | `0x106eb4` | `0x003E0040` |
| `0x3F` | `0x003F0040` | ReplySleepNotificationComplete | `apt_ReplySleepNotificationComplete` | `0x109644` | `0x003F0040` |
| `0x40` | `0x00400042` | SendCaptureBufferInfo | `apt_SendCaptureBufferInfo` | `0x1085c4` | `0x00400040` |
| `0x41` | `0x00410040` | ReceiveCaptureBufferInfo | `apt_ReceiveCaptureBufferInfo` | `0x108a30` | `0x00410082` |
| `0x42` | `0x00420080` | SleepSystem | `apt_SleepSystem` | `0x1066f8` | `0x00420040` |
| `0x43` | `0x00430040` | NotifyToWait | dans l'aiguillage | | `0x00430040` |
| `0x44` | `0x00440000` | GetSharedFont | `apt_GetSharedFont` | `0x105bbc` | `0x00440082` |
| `0x45` | `0x00450040` | GetWirelessRebootInfo | `apt_GetWirelessRebootInfo` | `0x1085ac` | `0x00450042` |
| `0x46` | `0x00460104` | Wrap | `apt_Wrap` | `0x105f60` | `0x00460044` |
| `0x47` | `0x00470104` | Unwrap | `apt_Unwrap` | `0x10601c` | `0x00470044` |
| `0x48` | `0x00480100` | GetProgramInfo | `apt_GetProgramInfo` | `0x11154c` | `0x004800C0` |
| `0x49` | `0x00490180` | Reboot | `apt_Reboot` | `0x1097d0` | `0x00490040` |
| `0x4A` | `0x004A0040` | GetCaptureInfo | `apt_GetCaptureInfo` | `0x106bf8` | `0x004A0042` |
| `0x4B` | `0x004B00C2` | AppletUtility | `apt_AppletUtility` | `0x1103e0` | `0x004B0082` |
| `0x4C` | `0x004C0000` | SetFatalErrDispMode | `apt_SetFatalErrDispMode` | `0x1080c0` | `0x004C0040` |
| `0x4D` | `0x004D0080` | GetAppletProgramInfo | `apt_GetAppletProgramInfo` | `0x1081bc` | `0x004D0080` |
| `0x4E` | `0x004E0000` | HardwareResetAsync | `apt_HardwareResetAsync` | `0x111e90` | `0x004E0040` |
| `0x4F` | `0x004F0080` | SetApplicationCpuTimeLimit | `apt_SetApplicationCpuTimeLimit` | `0x109cb8` | `0x004F0040` |
| `0x50` | `0x00500040` | GetApplicationCpuTimeLimit | `apt_GetApplicationCpuTimeLimit` | `0x109c3c` | `0x00500080` |
| `0x51` | `0x00510080` | GetStartupArgument | `apt_GetStartupArgument` | `0x107d18` | `0x00510082` |
| `0x52` | `0x00520104` | Wrap1 | `apt_Wrap1` | `0x105df8` | `0x00520044` |
| `0x53` | `0x00530104` | Unwrap1 | `apt_Unwrap1` | `0x105eb4` | `0x00530044` |
| `0x54` | `0x00540040` | sans nom sur 3dbrew | `apt_cmd_0x54` | `0x109324` | `0x00540080` |
| `0x55` | `0x00550040` | SetScreenCapturePostPermission | `apt_SetScreenCapturePostPermission` | `0x1096cc` | `0x00550040` |
| `0x56` | `0x00560000` | GetScreenCapturePostPermission | `apt_GetScreenCapturePostPermission` | `0x109624` | `0x00560080` |
| `0x57` | `0x00570044` | WakeupApplication2 | `apt_WakeupApplication2` | `0x108138` | `0x00570040` |
| `0x58` | `0x00580002` | GetProgramID | `apt_GetProgramID` | `0x106780` | `0x005800C0` |
| `0x101` | `0x01010000` | GetTargetPlatform | `apt_GetTargetPlatform` | `0x1075b0` | `0x01010080` |
| `0x102` | `0x01020000` | CheckNew3DS | `apt_CheckNew3DS` | `0x108d20` | `0x01020080` |
| `0x103` | `0x01030000` | GetApplicationRunningMode | `apt_GetApplicationRunningMode` | `0x108a8c` | `0x01030080` |
| `0x104` | `0x01040000` | IsStandardMemoryLayout | `apt_IsStandardMemoryLayout` | `0x108604` | `0x01040080` |
| `0x105` | `0x01050100` | IsTitleAllowed | `apt_IsTitleAllowed` | `0x1086f4` | `0x01050080` |

- 93 commandes : les numéros `0x01` à `0x58` sans trou, puis `0x101` à `0x105`. Tout autre numéro rend `0xD900182F`.
- 85 ont une fonction à elles. Les 8 marquées « dans l'aiguillage » n'en ont pas : le code répond 0 sans rien faire. Ce sont les deux commandes de débogage, les cinq qui concernent les « applets résidents » et `NotifyToWait`.
- 27 commandes vérifient l'en-tête entier : celles qui reçoivent une poignée, un tampon ou un numéro de processus. Une requête mal formée rend `0xD9001830`. Les autres ne regardent que le numéro.
- `apt_HardwareResetAsync` (`0x111e90`) tient en trois instructions et continue dans `reboot_with_firm_params` (`0x111e98`) : Ghidra montre deux fonctions qui se recouvrent.

**Les 29 commandes que Pokémon X envoie** ont été relues des deux côtés, la fonction d'envoi du jeu en face de la fonction de cette table, dans le [contrat APT](contrat-apt.md) (partie 4, une rubrique par commande). Ce qu'il a établi côté module, et qui précise 3dbrew :

| Commande | Ce que fait `ns` | Ce que dit 3dbrew |
| --- | --- | --- |
| GetLockHandle | le mot 3 de la réponse vaut **toujours 0** ; le jeu en lit pourtant les bits 0 (bouton d'alimentation) et 1 (fermeture demandée). Ces deux états arrivent par les notifications 8, 7 et 11, que Enable dépose (partie 4, étape 3) | le mot 3 porte l'état d'APT |
| SendParameter | la taille est prise dans le descripteur du mot 7, le mot 4 n'est pas lu. **La commande `0x10` n'est pas transmise** : `send_parameter` garde ses données et dépose aussitôt, pour l'expéditeur, un paramètre de commande 3 qui vient du destinataire (branche à `0x10f59c`, `parameter_store` avec 3 à `0x10f5d0`). Le bit `0x10000` de la commande désinscrit l'expéditeur après l'envoi | le mot 4 est la taille |
| ReceiveParameter, GlanceParameter | le mot 7 de la réponse porte la taille demandée, plafonnée à 0x1000 | la taille copiée |
| CancelLibraryApplet | le paramètre n'est pas lu | un octet « l'application se ferme » |
| SleepSystem | le mot 1 est masqué par `0x40000002`, le mot 2 par `0x64`, puis `PTMSYSM_RequestSleep` : un masque, pas une durée | « une durée ? » |
| NotifyToWait | l'aiguillage répond 0 sans lire le mot 1 | la même chose |

Les trois refus que les fonctions « Prepare… » rendent quand elles sont occupées (`0xC8A0CC02`, `0xC8A0CFF0`, `0xE0A0CC08`) sont exactement les trois codes sur lesquels le jeu réessaie toutes les 10 millisecondes.

## Partie 4 : le démarrage d'une application, pas à pas

C'est la séquence que Pokémon X envoie juste après avoir obtenu sa session `APT:U`. Elle s'appuie sur deux tables décrites dans la partie 5 : les quatre **cases** des programmes inscrits, et le **paramètre en attente**, une boîte aux lettres à une seule place.

### Avant le jeu : ce que fait le menu HOME

Quand on touche l'icône du jeu, le menu HOME envoie deux commandes par `APT:S`.

1. **PrepareToStartApplication** (`apt_PrepareToStartApplication`, `0x108cac`). Le programme actif doit être un applet système, aucune opération ne doit être déjà préparée (sinon `0xC8A0CFF0`) et la case de l'application doit être libre. Le numéro de titre reçu est rangé dans la table des titres, à la ligne de l'identifiant `0x300`, et l'octet « opération préparée » (`0x123580`) passe à 1.
2. **StartApplication** (`apt_StartApplication`, `0x1072b0`). `start_application_title` (`0x110834`) fait lancer le titre par `pm` : `launch_application_process` (`0x10e23c`) règle d'abord le temps de processeur à 0 (`PMAPP_SetAppResourceLimit`), lit les drapeaux de l'exheader (`PMAPP_GetTitleExheaderFlags`), puis envoie `PMAPP_LaunchTitle` avec les drapeaux 7 : « application », « avec ses dépendances » et « prévenir à la fin ». La suite est dans la fiche de `pm`, partie 5. Le troisième paramètre de la commande, un octet, décide de la suite : nul, `schedule_application_wakeup` (`0x110704`) prépare tout de suite le réveil de l'étape 4 ; non nul, l'application reste en pause jusqu'à `WakeupApplication`, qui appelle la même fonction.

`schedule_application_wakeup` dépose un travail pour le fil ouvrier : « envoyer à `0x300` le paramètre numéro 1, de la part du programme actif ». Le fil ouvrier le prend, et attend. Il regarde toutes les 10 millisecondes si la case de l'application est inscrite.

### Étape 1 : GetLockHandle

`apt_GetLockHandle` (`0x1069e8`) reçoit un mot d'attributs et rend trois choses.

| Mot de la réponse | Contenu |
| --- | --- |
| 1 | le résultat, 0 |
| 2 | les attributs, renvoyés tels quels pour une application |
| 3 | 0, toujours. Pokémon X y lit deux bits (bouton d'alimentation, fermeture demandée) : ils doivent rester nuls, sinon `main` part vers la sortie ([contrat APT](contrat-apt.md), partie 2) |
| 4 | 0, ce qui annonce au noyau « une poignée à copier » |
| 5 | **le verrou d'APT**, un mutex créé par `apt_init` et rangé à `0x123584` |

Rien n'est inscrit à ce stade. Pour un applet de bibliothèque (position 1, 3 ou 5 dans les attributs), la position est réécrite d'après l'octet `0x124104`.

### Étape 2 : Initialize

`apt_Initialize` (`0x106500`) reçoit l'identifiant du programme (`0x300` pour une application) et ses attributs.

1. `slot_from_attributes` (`0x10f99c`) choisit la case d'après les trois bits du bas des attributs : position 0, case 0, celle de l'application.
2. Si la case est déjà inscrite : `0xC8A0CFFC`.
3. `slot_register` (`0x10adf0`) écrit dans la case l'identifiant et les attributs, efface la notification en attente, et rend les deux signaux de la case.
4. Un programme est déjà actif (le menu HOME) : la commande s'arrête là, avec le résultat 0.

| Mot de la réponse | Contenu |
| --- | --- |
| 1 | le résultat |
| 2 | `0x04000000`, ce qui annonce « deux poignées à copier » |
| 3 | **le signal des notifications** de la case (`+0x00`) |
| 4 | **le signal des paramètres** de la case (`+0x04`), celui qui réveille le jeu |

Les deux signaux ne sont pas créés pour l'occasion : `applet_slots_init` (`0x103ac8`) les crée tous les huit au démarrage de `ns`, deux par case. Tous les programmes qui passent par la case 0 reçoivent les mêmes.

Si aucun programme n'est encore actif (`0x1240ec` vaut `0xFF`), c'est le tout premier inscrit, en pratique le menu HOME au démarrage de la console : `apt_Initialize` marque la case inscrite et dépose lui-même un travail de réveil (`job_wakeup_first_applet`, `0x10b56c`).

### Étape 3 : Enable

`apt_Enable` (`0x1096e0`) reçoit les attributs.

1. La case est retrouvée comme à l'étape 2. Attributs sans case : `0xC8A0CC04`.
2. **L'octet « inscrit » de la case (`+0x12`) passe à 1.** C'est le moment où le jeu devient visible pour le reste de `ns`.
3. Au tout premier `Enable` reçu depuis le démarrage de `ns`, une fonction regarde l'état du couvercle par `ptm` (pas lue en détail).
4. Si un arrêt de la console, une demande de fermeture ou un appui sur le bouton d'alimentation est déjà en cours, la notification correspondante (7, 11 ou 8) est déposée tout de suite dans la case.
5. L'octet « prêt » de la case (`+0x13`) passe à 1.

### Étape 4 : le signal « tu es au premier plan »

Le fil ouvrier, qui attendait depuis `StartApplication`, voit l'octet « inscrit » à 1. Dans `job_wakeup_application` (`0x1134c0`) :

1. `set_active_slot` (`0x110390`) : la case 0 devient la case active (`0x1240ec`).
2. `job_deliver_parameter` (`0x10d8f4`) appelle `send_parameter` (`0x10f408`), et recommence toutes les millisecondes tant qu'elle refuse.
3. `send_parameter` range dans la boîte aux lettres : expéditeur le programme qui était actif au moment de `StartApplication`, donc le menu HOME ; destinataire `0x300` ; **commande 1** ; et les données s'il y en a (0x1000 octets au plus).
4. `slot_signal_parameter_event` (`0x10e1d0`) règle le processeur par `PTMSYSM_ConfigureNew3DSCPU`, **lève le signal des paramètres de la case 0** (`svcSignalEvent`), et note `0x300` comme programme actif (`0x1240f0`).

Le jeu, qui attendait sur ce signal, est réveillé. Côté Pokémon X, ce n'est pas le fil principal qui attend ce signal mais un fil à lui, le fil d'APT (`apt_event_thread_main`, `0x11a958` dans le jeu) : il envoie d'abord GlanceParameter, et ne réveille le fil principal, qui enverra ReceiveParameter, que si la commande lue n'est ni 2, ni 5, ni 8, ni 9 ([contrat APT](contrat-apt.md), partie 2).

### Étape 5 : ReceiveParameter ou GlanceParameter

Les deux commandes passent par `receive_parameter` (`0x10eff8`). Elles reçoivent l'identifiant du demandeur et la taille de son tampon.

1. Boîte vide : `0xC8A0CFEF`.
2. Le paramètre est pour quelqu'un d'autre : `0xC880CFFA`.
3. Sinon les données sont copiées dans le tampon de la réponse (`parameter_copy_out`, `0x112ed8`).
4. `ReceiveParameter` vide la boîte (`parameter_clear`, `0x10f110`). `GlanceParameter` la laisse pleine, sauf pour les commandes 8 et 9, qu'elle retire aussi.

| Mot de la réponse | Contenu |
| --- | --- |
| 1 | le résultat |
| 2 | l'identifiant de l'expéditeur |
| 3 | la commande : **1 au démarrage** |
| 4 | le nombre d'octets copiés |
| 5 | `0x10` pour `ReceiveParameter` (la poignée change de propriétaire), 0 pour `GlanceParameter` (elle est copiée) |
| 6 | la poignée jointe au paramètre, ou 0 |
| 7, 8 | la taille et l'adresse des données. La taille du mot 7 est celle que le client a demandée, plafonnée à 0x1000, et non celle des octets copiés, qui est au mot 4 |

**Ce qu'il faut pour faire tourner le jeu sur PC.** Cette partie disait : répondre à `GetLockHandle` par un mutex libre, à `Initialize` par deux signaux, à `Enable` par 0, puis lever le second signal et tenir prêt un paramètre « expéditeur `0x101`, commande 1 ». L'identifiant `0x101` est celui que `ns` range au départ à `0x1240e8` pour le menu HOME. Le code du jeu, lu dans le [contrat APT](contrat-apt.md) (partie 2), montre qu'il en faut un peu plus : neuf réponses, dans cet ordre.

| Ordre | Requête du jeu | Réponse à rendre |
| --- | --- | --- |
| 1 | GetLockHandle | résultat 0, mots 2, 3 et 4 à 0, mot 5 un mutex libre |
| 2 | Initialize | résultat 0, mot 2 `0x04000000`, mots 3 et 4 deux signaux distincts |
| 3 | Enable | résultat 0 |
| 4 | NotifyToWait | résultat 0 ; puis lever une fois le signal du mot 4 d'Initialize |
| 5 | GlanceParameter, depuis le fil d'APT du jeu | résultat 0, expéditeur `0x101`, commande 1, taille 0, poignée 0 |
| 6 | ReceiveParameter, depuis le fil principal | la même chose |
| 7 | AppletUtility, opération 7 (4 octets valant `0x10`) | résultat 0 |
| 8 | AppletUtility, opération 4 | résultat 0 |
| 9 | GetSharedFont, plus tard dans `game_init_systems` | résultat 0, l'adresse du bloc, un vrai bloc de mémoire partagée dont le premier mot vaut 2 et qui porte la police à `+0x80` |

Trois pièges : le mot 3 de GetLockHandle doit être nul ; il ne faut jamais lever le signal des notifications sans notification à rendre (le jeu arrête tout par `svcBreak` si InquireNotification rend 0) ; et le jeu efface lui-même le signal des paramètres, il doit donc rester levé jusqu'à ce que son fil d'APT le lise. Que ces neuf réponses suffisent n'est pas vérifié : rien n'a été exécuté.

## Partie 5 : les tables d'APT

### Les quatre cases des programmes inscrits

À `0x124580`, quatre cases de 0x14 octets. Il ne peut y avoir qu'un programme de chaque sorte à la fois.

| Case | Adresse | Pour qui | Choisie quand |
| --- | --- | --- | --- |
| 0 | `0x124580` | l'application | position 0 |
| 1 | `0x124594` | un applet système | position 2 |
| 2 | `0x1245a8` | le menu HOME | position 2 et bit `0x20000000` des attributs |
| 3 | `0x1245bc` | un applet de bibliothèque | position 1, 3 ou 5 |

La position 4 n'a pas de case, et une position de 6 ou plus arrête `ns`.

| Décalage | Contenu |
| --- | --- |
| `+0x00` | le signal des notifications |
| `+0x04` | le signal des paramètres |
| `+0x08` | l'identifiant du programme, ou 0 si la case est libre |
| `+0x0C` | ses attributs : la position dans les trois bits du bas |
| `+0x10` | la notification en attente, 0 s'il n'y en a pas |
| `+0x11` | un état : 2 après `StartApplication`, 3 à certaines étapes des applets (pas suivi) |
| `+0x12` | 1 quand le programme est inscrit (mis par `Enable`) |
| `+0x13` | 1 quand `Enable` est terminé |

Deux fonctions retrouvent une case : `slot_from_attributes` (`0x10f99c`) à partir des attributs, `slot_from_applet_id` (`0x10f630`) à partir d'un identifiant. Cette dernière accepte aussi quatre identifiants génériques : `0x100` (l'applet système ou le menu), `0x200` et `0x400` (l'applet de bibliothèque, selon sa position), `0x300` (l'application).

### Le paramètre en attente

Une seule boîte, protégée par le verrou à `0x1245f0`.

| Adresse | Contenu |
| --- | --- |
| `0x12418c` | 1 si la boîte est pleine |
| `0x124190` | la commande |
| `0x124194` | l'expéditeur |
| `0x124198` | le destinataire |
| `0x12419c` | la poignée jointe |
| `0x1241a0` | la taille des données |
| `0x2103c4` | les données, 0x1000 octets au plus |

`send_parameter` refuse par `0xC8A0CC02` si la boîte est déjà pleine, et par `0xC880CFFA` si le destinataire n'est pas inscrit.

Les numéros de commande que le code écrit lui-même :

| Commande | Envoyée par | À qui |
| --- | --- | --- |
| 1 | `schedule_application_wakeup`, `apt_Initialize` | le programme qui démarre |
| 3 | `send_parameter`, quand SendParameter porte la commande `0x10` (`0x10f5d0`) | l'expéditeur, de la part du destinataire nommé : une réponse fabriquée par `ns` |
| `0x0A` | `apt_CloseApplication` | le programme qui reprend la main |
| `0x0B` | `apt_JumpToHomeMenu` | le menu HOME |
| `0x0B` | `apt_LeaveHomeMenu` | l'application |
| `0x0C` | `apt_OrderToCloseApplication` | l'application |
| `0x0C` ou `0x0F` | `apt_JumpToHomeMenu`, quand c'est un applet qui cède la place | l'applet lui-même |

### Le travail du fil ouvrier

Les passages de main attendent parfois qu'un programme démarre. Pour ne pas bloquer le service, la commande dépose un travail et répond tout de suite.

| Adresse | Contenu |
| --- | --- |
| `0x1241a5` | 1 tant qu'un travail est en cours : `worker_job_begin` (`0x10f7f4`) attend qu'il repasse à 0 |
| `0x1241a8` | la fonction à exécuter, posée par `worker_job_submit` (`0x10f78c`) |
| `0x1241b4` | le signal qui réveille le fil ouvrier |
| `0x2113c8` | le travail : la case visée (`+0x00`), son identifiant (`+0x04`), puis le paramètre à envoyer : commande (`+0x0C`), expéditeur (`+0x10`), destinataire (`+0x14`), poignée (`+0x18`), taille (`+0x1C`), données (`+0x20`) |

### La table des titres

À `0x123968`, 30 lignes de 0x40 octets : deux identifiants (4 octets chacun), puis sept numéros de titre de 8 octets, un par région. La région vient de `cfg` (`get_system_region`, `0x1034a8`). `title_id_from_applet_id` (`0x1123e8`) va de l'identifiant au titre, `applet_id_from_title_id` (`0x103d80`) fait le chemin inverse.

**Dans le fichier, les numéros de titre sont à zéro.** Ils sont écrits au démarrage par `static_init_title_tables` (`0x11ba94`). Le tableau ci-dessous a été obtenu en exécutant cette fonction dans un émulateur. Les trois colonnes montrées sont les régions 0, 1 et 2 ; les quatre autres sont dans `local/analyse/ns/applets.txt`.

| Identifiant | Second identifiant | Adresse | Région 0 | Région 1 | Région 2 |
| --- | --- | --- | --- | --- | --- |
| `0x101` | | `0x123968` | `0004003000008202` | `0004003000008f02` | `0004003000009802` |
| `0x103` | | `0x1239a8` | `0004003000008102` | `0004003000008102` | `0004003000008102` |
| `0x110` | | `0x1239e8` | `0004003000008402` | `0004003000009002` | `0004003000009902` |
| `0x112` | | `0x123a28` | `0004003000008d02` | `0004003000009602` | `0004003000009f02` |
| `0x113` | | `0x123a68` | `0004003000008702` | `0004003000009302` | `0004003000009c02` |
| `0x114` | | `0x123aa8` | `0004003000008802` | `0004003000009402` | `0004003000009d02` |
| `0x115` | | `0x123ae8` | `0004003000008602` | `0004003000009202` | `0004003000009b02` |
| `0x116` | | `0x123b28` | `0004003000008e02` | `0004003000009702` | `000400300000a002` |
| `0x117` | | `0x123b68` | `000400300000bc02` | `000400300000bd02` | `000400300000be02` |
| `0x118` | | `0x123ba8` | `0004003000008302` | `0004003000008b02` | `000400300000ba02` |
| `0x119` | | `0x123be8` | `0004003000009502` | `0004003000009e02` | `000400300000b902` |
| `0x201` | `0x401` | `0x123c28` | `000400300000c002` | `000400300000c802` | `000400300000d002` |
| `0x202` | `0x402` | `0x123c68` | `000400300000c102` | `000400300000c902` | `000400300000d102` |
| `0x204` | `0x404` | `0x123ca8` | `000400300000c302` | `000400300000cb02` | `000400300000d302` |
| `0x205` | `0x405` | `0x123ce8` | `000400300000c402` | `000400300000cc02` | `000400300000d402` |
| `0x206` | `0x406` | `0x123d28` | `000400300000c502` | `000400300000c502` | `000400300000c502` |
| `0x207` | `0x407` | `0x123d68` | `000400300000c602` | `000400300000ce02` | `000400300000d602` |
| `0x208` | `0x408` | `0x123da8` | `000400300000cd02` | `000400300000cd02` | `000400300000cd02` |
| `0x209` | `0x409` | `0x123de8` | `000400300000f602` | `000400300000f602` | `000400300000f602` |
| `0x300` | | `0x123e28` | `ffffffffffffffff` | `ffffffffffffffff` | `ffffffffffffffff` |
| `0x301` | | `0x123e68` | `0004001000020900` | `0004001000021900` | `0004001000022900` |
| `0xf10` | | `0x123ea8` | `0004003000008900` | `0004003000008900` | `0004003000008900` |
| `0xf11` à `0xf18` | | `0x123ee8` à `0x1240a8` | `000400000ffffd00`, `…fc00`, `…fb00`, `…f900`, `…f800`, `…f700`, `…f600`, `…f500` | les mêmes | les mêmes |

- **`0x300` est l'application.** Sa ligne ne contient que des `FF` : c'est `PrepareToStartApplication` qui y écrit le titre du jeu qu'on lance (`set_applet_title_id`, `0x10df10`).
- `0x101` est le menu HOME, les `0x1xx` les applets système, les `0x2xx` et `0x4xx` les applets de bibliothèque (clavier et autres), `0xf10` à `0xf18` des programmes de mise au point. Le code confirme les familles : `is_home_menu_id` (`0x10ee10`) reconnaît `0x101` et `0x103`, `is_system_applet_id` (`0x10e5cc`) les `0x1xx`, `is_application_id` (`0x10e5bc`) le seul `0x300`. Le nom de chaque applet, lui, n'est pas dans le module.
- Les régions 0, 1 et 2 seraient le Japon, l'Amérique et l'Europe : `0004003000009802` est le menu HOME européen d'après 3dbrew. À vérifier sur la console avec la liste des titres installés.

## Partie 6 : le bouton HOME pendant un jeu

### Du bouton à la notification

1. Un autre module publie la notification `0x204` à `sm`. `ns` y est abonné : la boucle de `ns_main` appelle `on_notification_204` (`0x11aafc`).
2. Le gestionnaire renonce si la console s'endort (état de `0x1241f8` à 4, 5 ou 6), si un réglage de `cfg` l'interdit, ou si un passage de main est déjà en cours (`0x1241be` non nul). Sinon il crée le fil `home_button_thread_main` (`0x118de8`).
3. Ce fil attend une milliseconde, puis **lève le drapeau 1** dans les « drapeaux d'occupation » (`busy_flags_try_set`, `0x1101fc`, sur le mot `0x1241be`). S'il n'y arrive pas, il s'arrête là.
4. `broadcast_notification` (`0x110e0c`) dépose **la notification 1** dans les quatre cases : pour chaque case inscrite, `slot_post_notification` (`0x10de9c`) écrit 1 à `+0x10` et lève le signal des notifications. Si la case contient déjà une notification pas encore lue, le fil réessaie toutes les 10 millisecondes.

Le jeu n'est donc pas seul prévenu : le menu HOME, s'il est inscrit, reçoit la même notification.

### Ce que le jeu doit faire

| Ordre | Commande | Ce que fait `ns` |
| --- | --- | --- |
| 1 | InquireNotification (`0x0B`) | `apt_InquireNotification` (`0x108054`) rend l'octet `+0x10` de la case du demandeur, **1**, et le remet à 0. Programme non inscrit : `0xC880CFFA` |
| 2 | PrepareToJumpToHomeMenu (`0x2B`) | `apt_PrepareToJumpToHomeMenu` (`0x108830`) refuse si un paramètre attend (`0xC8A0CC02`) ou si une opération est déjà préparée (`0xC8A0CFF0`). Sinon elle note la case active à `0x124139`, met l'octet « opération préparée » à `0x0E`, et, si le menu HOME ne tourne pas, le lance (`launch_applet_title`, `0x10ecd8`) |
| 3 | JumpToHomeMenu (`0x2C`) | `apt_JumpToHomeMenu` (`0x106c30`) s'occupe de la caméra et du suivi du visage (pas lu), rend le menu HOME actif, et lui envoie le paramètre « expéditeur `0x300`, commande `0x0B` » avec les données fournies par le jeu. L'octet « opération préparée » repasse à 0 |
| 4 | attendre son signal des paramètres | Rien ne se passe pour le jeu tant que le menu a la main |
| 5 | ReceiveParameter (`0x0D`) | Quand on revient au jeu, le menu a envoyé `PrepareToLeaveHomeMenu` puis `LeaveHomeMenu` : `apt_LeaveHomeMenu` (`0x106a7c`) rend la case 0 active et envoie au jeu le paramètre « commande `0x0B` », de la part du menu |

Ce tableau suit l'ordre de libctru. **Pokémon X en envoie davantage**, et le [contrat APT](contrat-apt.md) (partie 3) l'a lu dans son code. La notification 1 ne fait que poser un drapeau ; c'est la boucle principale qui agit, par `0x109de0` (appelée par `main_loop` à `0x106998`), puis `0x1100a8` et `0x11af2c` :

| Ordre | Commande envoyée par le jeu | Où, dans le jeu |
| --- | --- | --- |
| 1 | IsRegistered(`0x400`) : un applet de bibliothèque est-il ouvert ? | `0x11b5d8` |
| 2 | PrepareToJumpToHomeMenu, rejouée toutes les 10 millisecondes sur les trois codes « occupé » | `0x11b520` |
| 3 | GetAppletManInfo(`0xFF`) : le mot 4 donne l'identifiant du menu HOME | `0x11af5c` |
| 4 | IsRegistered(menu HOME), en boucle jusqu'à lire 1 | `0x11af98` |
| 5 | sauvegarde de la mémoire vidéo (`gspgpu_SaveVramSysArea`) | `0x11afc4` |
| 6 | SendParameter, commande `0x10`, 0x20 octets, au menu HOME ; puis GlanceParameter et ReceiveParameter jusqu'à recevoir la commande 3 que `ns` fabrique (partie 5) | `0x134cb0`, par `0x149c58` |
| 7 | SendCaptureBufferInfo, 0x20 octets | `0x134cb0`, par `0x149b40` |
| 8 | le son est arrêté (`dsp::DSP` UnloadComponent), le droit d'affichage rendu | `0x11afe8`, `0x11aff4` |
| 9 | JumpToHomeMenu | `0x11b01c` |
| 10 | NotifyToWait, AppletUtility 4, attente, GlanceParameter, ReceiveParameter (commande `0x0B`) | `apt_wait_for_wakeup` (`0x11b074`), appelée à `0x109e6c` |
| 11 | AppletUtility 7 (`0x10`) puis 4, AppletUtility 7 (1) puis 4 | la même |

L'ordre des appels de cette liste a été relu dans l'assembleur du jeu pour cette fiche (les adresses de la colonne de droite). La condition qui fait choisir au jeu entre accepter et refuser, elle, n'est pas lue.

**Pour refuser le menu HOME**, le jeu ne répond rien de tout cela, mais il doit baisser le drapeau 1, sans quoi plus aucun appui ne sera pris en compte. Cela se fait par `AppletUtility` (`0x4B`) : dans `apt_AppletUtility` (`0x1103e0`), l'opération 7 baisse les drapeaux qu'on lui donne, l'opération 6 essaie d'en lever, l'opération 3 les baisse tous.

**Si on ferme le jeu depuis le menu**, le menu envoie `OrderToCloseApplication` : le jeu reçoit le paramètre « commande `0x0C` », et doit répondre par `PrepareToCloseApplication` puis `CloseApplication`. `apt_CloseApplication` (`0x106f84`) vide la case 0 et rend la main.

### Les autres notifications d'APT

Tous les envois passent par `broadcast_notification`. Dix appels dans le code, tous avec un numéro écrit en dur.

| Notification | Déposée par | Après |
| --- | --- | --- |
| 1 | `home_button_thread_main` | la notification système `0x204` |
| 3 | `on_notification_101` (`0x11ab28`) | la notification système `0x101` |
| 4 | la fonction à `0x1124d0` (l'appel est à `0x103e5c`) | la minuterie de `ns_main` |
| 5 | la fonction à `0x118944` | la notification système `0x103` |
| 6 | la fonction à `0x11824c` | les notifications système `0x102` et `0x106` |
| 7 | la fonction à `0x118c48` | la notification système `0x203`, suivie de `PTMSYSM_ShutdownAsync` |
| 8 | `on_notification_202` (`0x10f310`) | la notification système `0x202`, et l'opération 12 d'`AppletUtility` |
| 9 | `job_cancel_power_button` (`0x112f64`) | l'opération 0 d'`AppletUtility` |
| 11 | les fonctions à `0x118794` et `0x102914`, deux appels | la notification système `0x100`, et l'arrêt de `ns` |

Les numéros 2 et 10 ne sont déposés nulle part dans ce module.

Le code de Pokémon X confirme le sens de ces numéros, par ce qu'il fait de chacun ([contrat APT](contrat-apt.md), partie 3, table de saut à 12 cases à `0x11aae4` dans le jeu) : 1 et 2 posent le drapeau du bouton HOME (2 est une seconde forme de 1, que `ns` n'envoie jamais) ; 3 est la question de veille, à laquelle le jeu répond par ReplySleepQuery ; 4 l'annulation de la veille, sans réponse ; 5 l'endormissement, suivi de ReplySleepNotificationComplete ; 6 le réveil ; 7 l'arrêt et 11 la fermeture, qui lèvent le drapeau « fermeture demandée » ; 8 et 9 lèvent et baissent l'état du bouton d'alimentation ; 10 fait envoyer SleepSystem, mais `ns` ne la dépose jamais. **0, ou 12 et plus, arrêtent le jeu par `svcBreak`.** Pour la 9, `ns` remet à zéro son propre état du bouton (`0x1241bc`) au même moment.

## Partie 7 : les notifications système que ns écoute

`subscribe_notification` (`0x111e60`) inscrit un gestionnaire dans la liste de `ns` (`register_notification_handler`, `0x1026c4`, liste à `0x216e70`) puis s'abonne auprès de `sm` (`SRV_Subscribe`). `subscribe_system_notifications` le fait pour 16 numéros, une petite fonction à `0x10118c` pour `0x101`. Le gestionnaire de `0x100` est inscrit sans abonnement : c'est `pm` qui envoie cette notification directement à `ns`. Les gestionnaires sont des objets, construits par `static_init_notification_handlers` (`0x11da38`) ; le premier mot de l'objet mène à la fonction.

| Notification | Objet | Gestionnaire | Adresse | Ce que fait le code |
| --- | --- | --- | --- | --- |
| `0x100` | `0x217514` | `on_notification_100` | `0x11e520` | Lève le drapeau d'arrêt de `ns_main`, dépose la notification 11, se désabonne de tout |
| `0x101` | `0x2168f0` | `on_notification_101` | `0x11ab28` | Dépose la notification 3 |
| `0x102` | `0x216910` | `on_notification_102` | `0x11ab78` | Mène à la notification 6 |
| `0x103` | `0x216900` | `on_notification_103` | `0x11ad98` | Mène à la notification 5 |
| `0x104` | `0x216930` | `on_notification_104` | `0x11ad10` | Appelle `PTMSYSM_SetWakeupTrigger` |
| `0x105` | `0x216940` | `on_notification_105` | `0x11acf0` | Pas lu |
| `0x106` | `0x216920` | `on_notification_106` | `0x11a88c` | Mène à la notification 6 |
| `0x200` | `0x2168e0` | `on_notification_200` | `0x11a9e8` | Arme la minuterie de `ns_main` pour 200 millisecondes |
| `0x202` | `0x2168c0` | `on_notification_202` | `0x10f310` | Dépose la notification 8 |
| `0x203` | `0x2168d0` | `on_notification_203` | `0x11adbc` | Dépose la notification 7, puis `PTMSYSM_ShutdownAsync` avec un délai de 11 secondes |
| `0x204` | `0x216950` | `on_notification_204` | `0x11aafc` | Lance le fil du bouton HOME (partie 6) |
| `0x205` | `0x216960` | `on_notification_205` | `0x11adf8` | Met à jour l'état du bouton HOME (`0x20ba90`) |
| `0x209` | `0x216984` | | `0x11aa78` | Appelle un test de l'objet (`0x118d4c`) puis, selon l'état de veille, son action (`0x1183f0`, qui crée le fil d'erreur). Survolé |
| `0x20A` | `0x216970` | | `0x11aa78` | La même fonction, avec le test `0x118d08` et l'action `0x118320`. Survolé |
| `0x110` à `0x113` | `0x216998`, 0x10 octets chacun | | `0x11aa48` | La fin d'un processus lancé par `ns` : voir `pm`, partie 6. Pas lu |

Le gestionnaire de `0x202` est rangé dans sa table sous l'adresse `0x11adf0`, une seule instruction qui saute à `0x10f310`.

`ns` publie lui-même une notification, `0x214` (`SRV_PublishToSubscriber`, à quatre endroits du code qui gère la mise en veille).

## Partie 8 : les commandes de ns:s, ns:p et ns:c

`nss_handle_command` (`0x116e68`) fait un aiguillage par table de saut sur 22 numéros.

| N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- |
| `0x01` | `0x000100C0` | LaunchFIRM | `nss_LaunchFIRM` | `0x11529c` | `0x00010040` |
| `0x02` | `0x000200C0` | LaunchTitle | `nss_LaunchTitle` | `0x1151f4` | `0x00020080` |
| `0x03` | `0x00030000` | TerminateApplication | `PMAPP_TerminateApplication` | `0x118184` | `0x00030040` |
| `0x04` | `0x00040040` | TerminateProcess | `PMAPP_TerminateProcess` | `0x1181c0` | `0x00040040` |
| `0x05` | `0x000500C0` | LaunchApplicationFIRM | `nss_LaunchApplicationFIRM` | `0x11509c` | `0x00050040` |
| `0x06` | `0x00060042` | SetWirelessRebootInfo | `nss_SetWirelessRebootInfo` | `0x1175fc` | `0x00060040` |
| `0x07` | `0x00070042` | CardUpdateInitialize | `nss_CardUpdateInitialize` | `0x116ac4` | `0x00070040` |
| `0x08` | `0x00080000` | CardUpdateShutdown | `nss_CardUpdateShutdown` | `0x11a814` | `0x00080040` |
| `0x09` | `0x00090000` | sans nom sur 3dbrew | `nss_cmd_0x09` | `0x116b30` | `0x00090040` |
| `0x0A` | `0x000A0000` | sans nom sur 3dbrew | `nss_cmd_0x0a` | `0x116a9c` | `0x000A0240` |
| `0x0B` | `0x000B0000` | sans nom sur 3dbrew | `nss_cmd_0x0b` | `0x116a18` | `0x000B0040` |
| `0x0C` | `0x000C0000` | sans nom sur 3dbrew | `nss_cmd_0x0c` | `0x116a84` | `0x000C0080` |
| `0x0D` | `0x000D0140` | SetTWLBannerHMAC | `nss_SetTWLBannerHMAC` | `0x1175e8` | `0x000D0040` |
| `0x0E` | `0x000E0000` | ShutdownAsync | `PTMSYSM_ShutdownAsync` | `0x11800c` | `0x000E0040` |
| `0x0F` | `0x000F0000` | sans nom sur 3dbrew | `nss_cmd_0x0f` | `0x118e50` | `0x000F0040` |
| `0x10` | `0x00100180` | RebootSystem | dans l'aiguillage | | `0x00100040` |
| `0x11` | `0x00110100` | TerminateTitle | `PMAPP_TerminateTitle` | `0x114400` | `0x00110040` |
| `0x12` | `0x001200C0` | SetApplicationCpuTimeLimit | `nss_SetApplicationCpuTimeLimit` | `0x1154ec` | `0x00120080` |
| `0x13` | `0x00130000` | sans nom sur 3dbrew | `nss_cmd_0x13` | `0x119650` | `0x00130080` |
| `0x14` | `0x00140042` | sans nom sur 3dbrew | `nss_cmd_0x14` | `0x119628` | `0x00140082` |
| `0x15` | `0x00150140` | LaunchApplication | `nss_LaunchApplication` | `0x117570` | `0x00150040` |
| `0x16` | `0x00160000` | RebootSystemClean | `nss_RebootSystemClean` | `0x117614` | `0x00160040` |

- Quatre commandes n'ont pas de fonction à elles : l'aiguillage appelle directement la requête vers un autre module. `TerminateApplication` et `TerminateProcess` passent à `pm` un délai de 3 secondes, `ShutdownAsync` passe à `ptm` un délai de 14 secondes.
- `RebootSystem` choisit dans l'aiguillage entre `reboot_with_firm_params` (`0x111e98`) et la fonction à `0x10fd50`.
- `nss_LaunchTitle` appelle `PMAPP_LaunchTitle` en retirant le drapeau « application » et en ajoutant « avec ses dépendances » : par `ns:s`, on lance un module ou un applet, pas un jeu. Un jeu passe par `APT` (partie 4) ou par `LaunchApplication`.
- Les commandes `0x09` à `0x0C` concernent, d'après 3dbrew, la mise à jour du système depuis une cartouche.

`nsp_handle_command` (`0x116dec`) et `nsc_handle_command` (`0x117320`) comparent le numéro à 1 et 2.

| Service | N° | En-tête de requête | Commande | Fonction | Adresse | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- |
| `ns:p` | 1 | `0x00010040` | RebootSystem | `nsp_RebootSystem` | `0x117528` | `0x00010040` |
| `ns:p` | 2 | `0x00020000` | ShutdownAsync | `PTMSYSM_ShutdownAsync` | `0x11800c` | `0x00020040` |
| `ns:c` | 1 | `0x00010100` | LockSpecialContent | `nsc_LockSpecialContent` | `0x116ba0` | `0x00010040` |
| `ns:c` | 2 | `0x00020100` | UnlockSpecialContent | `nsc_UnlockSpecialContent` | `0x111be0` | `0x00020040` |

Dans les trois gestionnaires, un numéro inconnu rend `0xD900182F`.

## Partie 9 : les services que ns appelle

Chaque requête a sa petite fonction, qui écrit un en-tête et appelle `SendSyncRequest`. Il y en a 91, autant que d'appels à `SendSyncRequest` dans le code. Les noms viennent de 3dbrew.

| Service | Requêtes | Poignée | Pour quoi faire |
| --- | --- | --- | --- |
| `srv:` (port) | 9 | `0x1242b4` | S'inscrire, créer ses six services, ouvrir les autres, recevoir et publier des notifications |
| `pm:app` | 12 | `0x124290` | Lancer et arrêter des titres, régler le temps de processeur, lire et écrire les paramètres de redémarrage |
| `am:u` | 21 | `0x1242bc`, copiée à `0x1242c4` | Lire la fiche d'un titre installé, vérifier les droits, installer une mise à jour |
| `fs:USER` | 16 | `0x124238`, passée en argument | Savoir quelle cartouche est là, déclarer des contenus spéciaux, lire la police |
| un fichier ouvert | 7 | passée en argument | Lire et écrire dans un fichier ouvert par `fs` |
| `ptm:sysm` | 13 | `0x124364`, copiée à `0x12436c` | La veille, l'arrêt, le redémarrage, l'état du couvercle |
| `cfg:s` | 5 | `0x1242dc`, copiée à `0x1242e0` | La région, le modèle, des réglages |
| `cam:s` | 3 | `0x124220` | Reprendre et rendre la caméra quand on passe par le menu HOME |
| `ps:ps` | 1 | `0x124298` | Chiffrer et déchiffrer, pour `Wrap` et `Unwrap` |
| `qtm:sp` | 1 | `0x124378` | Le suivi du visage de la New 3DS |
| `nwm::EXT` | 1 | `0x12434c` | Le Wi-Fi |
| `err:f` (port) | 1 | `0x124230` | Signaler une erreur fatale |
| non identifié | 1 | `0x12444c` | L'en-tête `0x00120000`, envoyé par la fonction à `0x117f4c` |

**Les requêtes vers `srv:` et `pm:app`**, celles qui comptent pour suivre un lancement :

| Service | En-tête | Nom sur 3dbrew | Fonction | Adresse |
| --- | --- | --- | --- | --- |
| `srv:` | `0x00010002` | RegisterClient | `SRV_RegisterClient` | `0x101ab4` |
| | `0x00020000` | EnableNotification | `SRV_EnableNotification` | `0x102804` |
| | `0x00030100` | RegisterService | `SRV_RegisterService` | `0x102754` |
| | `0x000400C0` | UnregisterService | `SRV_UnregisterService` | `0x1027b0` |
| | `0x00050100` | GetServiceHandle | `SRV_GetServiceHandle` | `0x103780` |
| | `0x00090040` | Subscribe | `SRV_Subscribe` | `0x1037dc` |
| | `0x000A0040` | Unsubscribe | `SRV_Unsubscribe` | `0x111924` |
| | `0x000B0000` | ReceiveNotification | `SRV_ReceiveNotification` | `0x102840` |
| | `0x000C0080` | PublishToSubscriber | `SRV_PublishToSubscriber` | `0x111f30` |
| `pm:app` | `0x00010140` | LaunchTitle | `PMAPP_LaunchTitle` | `0x1064a4` |
| | `0x00020082` | LaunchFIRM | `PMAPP_LaunchFIRM` | `0x10acd8` |
| | `0x00030080` | TerminateApplication | `PMAPP_TerminateApplication` | `0x118184` |
| | `0x00040100` | TerminateTitle | `PMAPP_TerminateTitle` | `0x114400` |
| | `0x000500C0` | TerminateProcess | `PMAPP_TerminateProcess` | `0x1181c0` |
| | `0x00070042` | GetFIRMLaunchParams | `PMAPP_GetFIRMLaunchParams` | `0x103a34` |
| | `0x00080100` | GetTitleExheaderFlags | `PMAPP_GetTitleExheaderFlags` | `0x114c74` |
| | `0x00090042` | SetFIRMLaunchParams | `PMAPP_SetFIRMLaunchParams` | `0x10ac88` |
| | `0x000A0140` | SetAppResourceLimit | `PMAPP_SetAppResourceLimit` | `0x10e9c8` |
| | `0x000B0140` | GetAppResourceLimit | `PMAPP_GetAppResourceLimit` | `0x10ea0c` |
| | `0x000C0080` | UnregisterProcess | `PMAPP_UnregisterProcess` | `0x118148` |
| | `0x000D0240` | LaunchTitleUpdate | `PMAPP_LaunchTitleUpdate` | `0x114cdc` |

`ns` envoie 12 des 13 commandes de `pm:app` que décrit la fiche de `pm` ; il n'envoie jamais la sixième, `PrepareForReboot`.

**Les requêtes vers les autres modules :**

| Service | En-tête | Nom sur 3dbrew | Fonction | Adresse |
| --- | --- | --- | --- | --- |
| `ptm:sysm` | `0x04020042` | ReplySleepQuery | `PTMSYSM_ReplySleepQuery` | `0x118050` |
| | `0x04030042` | NotifySleepPreparationComplete | `PTMSYSM_NotifySleepPreparationComplete` | `0x1180dc` |
| | `0x04040102` | SetWakeupTrigger | `PTMSYSM_SetWakeupTrigger` | `0x118094` |
| | `0x04060000` | RequestSleep | `PTMSYSM_RequestSleep` | `0x10a98c` |
| | `0x040700C0` | ShutdownAsync | `PTMSYSM_ShutdownAsync` | `0x11800c` |
| | `0x04090080` | RebootAsync | `PTMSYSM_RebootAsync` | `0x10a954` |
| | `0x040A0000` | CheckNew3DS | `PTMSYSM_CheckNew3DS` | `0x103740` |
| | `0x080E0140` | NotifyPlayEvent | `PTMSYSM_NotifyPlayEvent` | `0x10a908` |
| | `0x08100000` | ClearSoftwareClosedFlag | `PTMSYSM_ClearSoftwareClosedFlag` | `0x106340` |
| | `0x08110000` | GetShellStatus | `PTMSYSM_GetShellStatus` | `0x1025c8` |
| | `0x08120000` | IsShutdownByBatteryEmpty | `PTMSYSM_IsShutdownByBatteryEmpty` | `0x117fcc` |
| | `0x08140000` | GetLegacyJumpProhibitedFlag | `PTMSYSM_GetLegacyJumpProhibitedFlag` | `0x103700` |
| | `0x08180040` | ConfigureNew3DSCPU | `PTMSYSM_ConfigureNew3DSCPU` | `0x114e38` |
| `cfg:s` | `0x00020000` | SecureInfoGetRegion | `CFG_SecureInfoGetRegion` | `0x10621c` |
| | `0x00050000` | GetSystemModel | `CFG_GetSystemModel` | `0x114b04` |
| | `0x04010082` | GetConfigInfoBlk8 | `CFG_GetConfigInfoBlk8` | `0x110920` |
| | `0x04060000` | SecureInfoGetRegion | `CFGS_SecureInfoGetRegion` | `0x106194` |
| | `0x04080042` | SecureInfoGetSerialNo | `CFG_SecureInfoGetSerialNo` | `0x1061d4` |
| `fs:USER` | `0x08030204` | OpenFileDirectly | `FSUSER_OpenFileDirectly` | `0x10a4e4` |
| | `0x08130000` | GetCardType | `FSUSER_GetCardType` | `0x10be94` |
| | `0x08170000` | IsSdmcDetected | `FSUSER_IsSdmcDetected` | `0x10becc` |
| | `0x08180000` | IsSdmcWritable | `FSUSER_IsSdmcWritable` | `0x10bf04` |
| | `0x082F0040` | GetProgramLaunchInfo | `FSUSER_GetProgramLaunchInfo` | `0x10bf3c` |
| | `0x083A0100` | GetSpecialContentIndex | `FSUSER_GetSpecialContentIndex` | `0x114194` |
| | `0x085D01C0` | SetFsCompatibilityInfo | `FSUSER_SetFsCompatibilityInfo` | `0x114aac` |
| | `0x085E0040` | ResetCardCompatibilityParameter | `FSUSER_ResetCardCompatibilityParameter` | `0x1141f0` |
| | `0x08610042` | InitializeWithSdkVersion | `FSUSER_InitializeWithSdkVersion` | `0x1032c8` |
| | `0x08620040` | SetPriority | `FSUSER_SetPriority` | `0x101fd4` |
| | `0x08630000` | GetPriority | `FSUSER_GetPriority` | `0x11415c` |
| | `0x08720200` | RegisterTitleContentOverlay | `FSUSER_RegisterTitleContentOverlay` | `0x114d88` |
| | `0x08730100` | UnregisterTitleContentOverlay | `FSUSER_UnregisterTitleContentOverlay` | `0x105b34` |
| | `0x08770140` | RegisterSpecialTitleContent | `FSUSER_RegisterSpecialTitleContent` | `0x114dec` |
| | `0x08780100` | UnregisterSpecialTitleContent | `FSUSER_UnregisterSpecialTitleContent` | `0x105b78` |
| | `0x088600C0` | CheckUpdatedDat | `FSUSER_CheckUpdatedDat` | `0x114a58` |
| un fichier ouvert | `0x08010100` | OpenSubFile | `FSFILE_OpenSubFile` | `0x1165dc` |
| | `0x080200C2` | Read | `FSFILE_Read` | `0x116690` |
| | `0x08030102` | Write | `FSFILE_Write` | `0x116714` |
| | `0x08040000` | GetSize | `FSFILE_GetSize` | `0x116774` |
| | `0x08080000` | Close | `FSFILE_Close` | `0x1166e8` |
| | `0x080A0040` | SetPriority | `FSFILE_SetPriority` | `0x116628` |
| | `0x080C0000` | OpenLinkFile | `FSFILE_OpenLinkFile` | `0x116658` |
| `am:u` | `0x00020082` | GetProgramList | `AM_GetProgramList` | `0x113fc4` |
| | `0x00030084` | GetProgramInfos | `AM_GetProgramInfos` | `0x10bd70` |
| | `0x00140040` | DoCleanup | `AM_DoCleanup` | `0x115868` |
| | `0x00220080` | DeleteAllImportContextsFiltered | `AM_DeleteAllImportContextsFiltered` | `0x115820` |
| | `0x002500C0` | CheckContentRights | `AM_CheckContentRights` | `0x10585c` |
| | `0x002C0084` | GetProgramInfosIgnorePlatform | `AM_GetProgramInfosIgnorePlatform` | `0x10bddc` |
| | `0x04010080` | UpdateFirmwareTo | `AM_UpdateFirmwareTo` | `0x102ef4` |
| | `0x04020040` | BeginImportProgram | `AM_BeginImportProgram` | `0x1158a8` |
| | `0x04040002` | CancelImportProgram | `AM_CancelImportProgram` | `0x115998` |
| | `0x04060002` | EndImportProgramWithoutCommit | `AM_EndImportProgramWithoutCommit` | `0x115ac8` |
| | `0x04080042` | GetProgramInfoFromCia | `AM_GetProgramInfoFromCia` | `0x1159d8` |
| | `0x040B0002` | GetTransferSizeFromCia | `AM_GetTransferSizeFromCia` | `0x115a80` |
| | `0x040E00C2` | CommitImportProgramsAndUpdateFirmwareAuto | `AM_CommitImportProgramsAndUpdateFirmwareAuto` | `0x115b54` |
| | `0x04110044` | GetTwlProgramListForReboot | `AM_GetTwlProgramListForReboot` | `0x109db0` |
| | `0x04120000` | GetSystemUpdaterMutex | `AM_GetSystemUpdaterMutex` | `0x115a40` |
| | `0x04130002` | GetMetaSizeFromCia | `AM_GetMetaSizeFromCia` | `0x115950` |
| | `0x04140044` | GetMetaDataFromCia | `AM_GetMetaDataFromCia` | `0x1158f4` |
| | `0x04150080` | CheckDemoLaunchRights | `AM_CheckDemoLaunchRights` | `0x114024` |
| | `0x041600C0` | GetInternalTitleLocationInfo | `AM_GetInternalTitleLocationInfo` | `0x109e14` |
| | `0x041700C0` | PerpetuateAgbSaveData | `AM_PerpetuateAgbSaveData` | `0x102f30` |
| | `0x04180040` | BeginImportProgramForOverWrite | `AM_BeginImportProgramForOverWrite` | `0x115b08` |
| `cam:s` | `0x00410040` | sans nom utile | `CAM_cmd_0x0041` | `0x114d48` |
| | `0x00430000` | sans nom utile | `CAM_cmd_0x0043` | `0x114940` |
| | `0x00440000` | sans nom utile | `CAM_cmd_0x0044` | `0x114970` |
| `ps:ps` | `0x00050284` | EncryptSignDecryptVerifyAesCcm | `PS_EncryptSignDecryptVerifyAesCcm` | `0x1142b4` |
| `qtm:sp` | `0x040A0040` | SetQtmStatus | `QTMSP_SetQtmStatus` | `0x114c38` |
| `nwm::EXT` | `0x00060000` | absent de la Carte | `NWMEXT_cmd_0x0006` | `0x1062dc` |
| `err:f` | `0x00010800` | Throw | `ERRF_Throw` | `0x10a814` |

- La session `am` est ouverte sous le nom `am:u` (chaîne à `0x120308`), celui que l'exheader autorise. Les 21 en-têtes sont les mêmes dans `am:u` et dans `am:net`.
- `cfg:s` sert deux fois la région : par la commande commune `0x00020000` et par la commande `0x04060000`.
- `get_service_handle` (`0x111a84`) entoure `SRV_GetServiceHandle` : elle refuse un nom de plus de 8 caractères (`0xD9006405`) avant d'envoyer.

## Partie 10 : les autres adresses

| Adresse | Contenu |
| --- | --- |
| `0x120188` | les trois services `ns:` : nom et nombre de sessions |
| `0x1201a0` | les trois gestionnaires de `ns_main` |
| `0x1201c8` | les quatre titres qui contiennent la police : `0004009B00014002`, `…14102`, `…14202`, `…14302` |
| `0x123580` | l'octet « opération préparée » : 0 rien, 1 lancement d'application, `0x0E` saut vers le menu, `0x0F` sortie du menu |
| `0x123584` | le verrou d'APT rendu par `GetLockHandle` |
| `0x123594` | la région, de 0 à 6 |
| `0x1240e8` | l'identifiant du menu HOME, `0x101` au départ |
| `0x1240ec` | la case active, `0xFF` tant qu'il n'y en a pas |
| `0x1240f0` | l'identifiant du dernier programme réveillé |
| `0x124139` | la case notée par `PrepareToJumpToHomeMenu` |
| `0x124163` et `0x12416c` | 1 quand une session `APT` est ouverte, et sa poignée |
| `0x124164` | le signal d'arrêt du fil d'APT |
| `0x124180` | les trois noms `APT:A`, `APT:U`, `APT:S` |
| `0x1241bc`, `0x1241bd`, `0x12410e` | bouton d'alimentation, arrêt de la console, fermeture demandée : les trois états que `Enable` relit |
| `0x1241be` | les drapeaux d'occupation, 2 octets : 1 pour le bouton HOME, `0x10` et `0x40` pour les passages de main, 4 pour la veille |
| `0x1241c2` | le service de la session `APT` en cours : 0, 1 ou 2 |
| `0x1241d4` et `0x1241d8` | l'adresse et la poignée de la mémoire partagée de la police, rendues par `GetSharedFont` |
| `0x1241f8` | l'état de mise en veille |
| `0x124204` | la minuterie de `ns_main` |
| `0x124354` | l'arbitre d'adresses des verrous |
| `0x124468` | le nombre de poignées de `ns_main` |
| `0x124474` | le drapeau d'arrêt de `ns_main` |
| `0x124484` | le sémaphore des notifications |
| `0x1245d0` | par case, le numéro du titre lancé pour elle |
| `0x215000` | la copie des paramètres de redémarrage, 0x1000 octets |
| `0x216e70` | la liste des gestionnaires de notifications |
| `0x21754c` | par session de `ns_main` : son type et son contexte |
| `0x217630` | les 9 poignées de `ns_main` |

Les verrous du module (`lock_enter` à `0x111a4c`, `lock_leave` à `0x111a2c`) et ses signaux légers (`light_event_wait` à `0x10fbb8`, `light_event_signal` à `0x10fb00`) reposent sur `ArbitrateAddress`, comme dans `sm`, `hid` et `pm`.

## Partie 11 : les appels système utilisés

35 appels différents, à 212 endroits du code. Un nom en `svc…` désigne l'appel système lui-même ; seuls ceux qui ont une adresse dans ce tableau sont des fonctions du fichier de noms.

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x101eac` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x100230` |
| CreateThread | `0x08` | `svcCreateThread` | `0x1057cc` |
| ExitThread | `0x09` | dans `thread_trampoline` | `0x10bc90` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x109bb8` |
| CreateMutex | `0x13` | `svcCreateMutex` | `0x102e94` |
| ReleaseMutex | `0x14` | écrit sur place, à 3 endroits | |
| CreateEvent | `0x17` | `svcCreateEvent` | `0x110d70` |
| SignalEvent | `0x18` | écrit sur place, à 4 endroits | |
| ClearEvent | `0x19` | écrit sur place, une fois | |
| CreateTimer | `0x1A` | `svcCreateTimer` | `0x102eac` |
| SetTimer | `0x1B` | `svcSetTimer` | `0x1057f0` |
| CancelTimer | `0x1C` | écrit sur place, une fois | |
| ClearTimer | `0x1D` | dans `apt_thread_main` | `0x102978` |
| CreateMemoryBlock | `0x1E` | `svcCreateMemoryBlock` | `0x101e90` |
| MapMemoryBlock | `0x1F` | écrit sur place, à 2 endroits | |
| UnmapMemoryBlock | `0x20` | écrit sur place, une fois | |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x101e78` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x10e868` |
| CloseHandle | `0x23` | écrit sur place, à 66 endroits | |
| WaitSynchronization1 | `0x24` | écrit sur place, et dans `wait_handle_forever` (`0x11406c` : handle lu dans un objet, délai infini ; pas une enveloppe nue) | `0x11406c` |
| WaitSynchronizationN | `0x25` | `svcWaitSynchronizationN` | `0x101ef4` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x115030` |
| GetSystemTick | `0x28` | écrit sur place, à 3 endroits | |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x102ec4` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x102e7c` |
| SendSyncRequest | `0x32` | écrit sur place, à 91 endroits | |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x109ba0` |
| Break | `0x3C` | une seule fois, à `0x10bc88`, où mène `panic` | |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x101e58` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x101edc` |
| FlushProcessDataCache | `0x54` | écrit sur place, une fois | |
| StartInterProcessDma | `0x55` | `svcStartInterProcessDma` | `0x1149c8` |
| StopDma | `0x56` | écrit sur place, une fois | |
| KernelSetState | `0x7C` | écrit sur place, à 3 endroits | |

`WaitSynchronization1` compte 13 endroits en tout. Les trois `SignalEvent` qui comptent sont dans `slot_post_notification`, dans `slot_signal_parameter_event` et dans l'arrêt du fil d'APT. Les deux `KernelSetState` de `ns_main` (à `0x1004f8` et `0x100514`) passent le type 6 avec 1 puis 2, et un bit lu dans un réglage de `cfg` ; le troisième (à `0x10e548`) passe le type 9.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- L'aiguillage d'APT : les 93 numéros, leur fonction et leur en-tête de réponse. Première voie, un script a exécuté `apt_handle_command` dans un émulateur, une fois par numéro, sur le code brut et sans Ghidra, et a relevé la première fonction appelée et l'en-tête écrit. Seconde voie, un autre script a cherché dans le pseudo-code de Ghidra, pour chacune des 85 fonctions, le numéro de commande testé juste avant son appel : 85 sur 85 concordent. Les en-têtes de requête de 3dbrew tombent sur les mêmes numéros, et les 27 en-têtes que le code compare en entier sont ceux de 3dbrew.
- Les noms des 85 fonctions `apt_…` viennent donc de leur place dans l'aiguillage et du nom que 3dbrew donne à ce numéro, pas d'une lecture de chaque fonction.
- Les aiguillages de `ns:s`, `ns:p` et `ns:c` : la même émulation, et la lecture du pseudo-code des trois gestionnaires.
- Les 91 requêtes envoyées : un script a exécuté chaque petite fonction et relevé l'en-tête écrit et l'adresse d'où vient la poignée ; les noms des services ont été lus dans les fonctions qui ouvrent les sessions. Tous les en-têtes sauf deux sont dans la Carte des services sous le service trouvé. Les 12 de `pm:app` sont ceux que la fiche de `pm` a lus de l'autre côté.
- Qui appelle `require_apt_s` et `require_not_apt_a` : la réponse de REA et un relevé des sauts fait par un script sur le désassemblage donnent les mêmes listes. Aucune autre fonction ne lit l'octet `0x1241c2`.
- L'ordre des trois services d'APT (0 pour `APT:A`, 1 pour `APT:U`, 2 pour `APT:S`) : la table de pointeurs à `0x124180`, les trois chaînes, et le calcul du rang lu dans le désassemblage à `0x102cec`.
- La notification 1 pour le bouton HOME : l'argument de `broadcast_notification` lu dans le désassemblage à `0x118e14`, parce que le pseudo-code de Ghidra ne le montrait pas.
- Les 35 appels système utilisés font tous partie des 68 que l'exheader de `ns` autorise.
- Les 29 commandes d'`APT:U` que Pokémon X envoie : les mots écrits par sa fonction d'envoi et ceux que lit l'aiguillage de `ns`, et inversement pour la réponse ([contrat APT](contrat-apt.md)). 27 sont lues des deux côtés en entier, StartSystemApplet et GetAppletProgramInfo sont survolées côté module.
- Le sens des notifications 1 à 11 : ce que `ns` dépose (partie 6) et ce que le jeu fait de chaque valeur (table de saut à 12 cases à `0x11aae4` dans le jeu, relue pour cette fiche).
- Le traitement à part de la commande `0x10` de SendParameter : le jeu attend la commande 3 avant JumpToHomeMenu, et `send_parameter` la fabrique (`0x10f5d0`, relu dans l'assembleur pour cette fiche).
- La table des titres : son contenu vient de l'exécution de `static_init_title_tables` dans un émulateur. Recoupement : le titre de secours que le démarrage écrit en dur pour le menu HOME, `0004003000008102`, s'y retrouve à la ligne `0x103`, et `PrepareToStartApplication` écrit bien à la ligne `0x300`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Les mots « inscrit », « prêt », « actif », « opération préparée », « drapeaux d'occupation » : le code montre ce qu'il fait de ces octets, les mots sont les miens.
- Le sens des numéros. Les notifications d'APT (1 le bouton HOME, 3 à 6 la veille, 7 l'arrêt, 8 le bouton d'alimentation, 11 la fermeture) et les commandes de paramètre (1 le réveil, `0x0B` la reprise après une pause, `0x0C` l'annulation) portent ces noms dans libctru ; ils sont donnés de mémoire et ne sont pas dans la Carte des services. Ce que fait le code colle à ces noms, et le code de Pokémon X les confirme tous (partie 6). Restent interprétés les mots « question », « endormissement », « réveil », « annulation » pour 3 à 6 : ils sont déduits de la réponse que le jeu renvoie.
- Le sens des notifications système : `0x204` et `0x205` pour le bouton HOME appuyé puis relâché, `0x202` et `0x203` pour le bouton d'alimentation, `0x101` à `0x106` pour la veille. Seul le lien entre `0x204` et la notification 1 d'APT est lu dans le code.
- Ce que le client fait du verrou de `GetLockHandle` : connu par libctru. Dans `ns`, seule la règle « une session à la fois » est lue.
- Le rôle de chaque case, et les noms « applet système » et « applet de bibliothèque » pour les positions 1 à 5.
- Les noms des applets et des régions de la table des titres.
- La séquence du menu HOME avant le jeu (`PrepareToStartApplication` puis `StartApplication`) : les deux fonctions sont lues, mais c'est le menu, pas `ns`, qui décide de les envoyer dans cet ordre.
- L'ordre des commandes que le jeu envoie après une notification (partie 6) : la première version de cette fiche donnait celui de libctru. Celui de Pokémon X est maintenant lu dans son code (contrat APT, et l'assembleur relu pour cette fiche) ; ce qui reste interprété est la condition qui le fait accepter ou refuser le menu HOME, et le fait que ces envois partent vraiment : rien n'a été exécuté.
- Les neuf réponses minimales du démarrage (partie 4) : déduites des deux côtés, jamais essayées.
- Les priorités des fils : le code passe des constantes codées (`0x6C8DA535` pour les fils d'APT, `0x6C8DA530` et `0x6C8DA52F` pour deux autres), qu'une addition dans `create_thread` ramène à `0x35`, `0x30` et `0x2F`.
- Le fil de la police : lu en diagonale. Il ouvre l'archive `font:` d'un des quatre titres de `0x1201c8`, y lit un fichier `cbf_….bcfnt.lz` et le range dans la mémoire partagée.
- Les titres lancés au démarrage : `0004003000008A02` serait le programme d'affichage des erreurs.

**Pas lu**
- Toute la mise en veille : l'état de `0x1241f8`, les gestionnaires `0x101` à `0x106`, `ReplySleepQuery`, `SleepSystem`, les requêtes vers `ptm`.
- Les applets de bibliothèque et les applets système : les commandes `0x16` à `0x20`, `0x23` à `0x2A`, et les fonctions de travail `0x10b530`, `0x10b604`, `0x10b684`, `0x10d9a0`, `0x112fa0` ne sont que survolées.
- Le saut d'une application à une autre (`0x31` à `0x35`), `Wrap` et `Unwrap`, la capture d'écran, `DebugFunc`.
- Le corps de 16 des 22 commandes de `ns:s`, de `nsp_RebootSystem` et des deux de `ns:c` : seuls `LaunchTitle`, `RebootSystem` et les quatre qui renvoient à un autre module sont lus.
- La mise à jour depuis une cartouche et l'installation par `am` (les fonctions autour de `0x115000` à `0x116000`).
- Les deux fonctions de rattrapage (`0x100c74` et `0x101078`) appelées au démarrage, et ce que fait le démarrage quand la console sort d'un redémarrage.
- Les gestionnaires des notifications `0x105` et `0x110` à `0x113` ; ceux de `0x209` et `0x20A` sont survolés.
- La caméra et le suivi du visage autour du menu HOME (`0x10f164`, `0x10f254`).
- 610 fonctions n'ont pas de nom. `strlen` (`0x112794`) est nommée d'après sa forme.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système, nommer leurs enveloppes, trouver les fonctions manquées | `outils/prescan.py`, quatre passages | une minute par passage, décompilation comprise |
| Suivre les quatre aiguillages | `dispatch.py` et `dispatch2.py`, qui exécutent le code dans l'émulateur unicorn | quelques minutes |
| Relever les 91 requêtes envoyées | `stubs2.py`, par la même méthode | une minute |
| Lire la table des titres | `applets.py`, qui exécute la fonction d'initialisation | immédiat |
| Recouper l'aiguillage avec le pseudo-code | `crosscheck2.py` | immédiat |
| Lire le chemin du démarrage et celui du bouton HOME | Claude, dans le pseudo-code puis dans l'assembleur | le gros du temps |
| Fabriquer le fichier de noms et les tableaux | `names.py` et `mkfiche.py` | immédiat |

**Les pièges rencontrés.**
- Au premier passage Ghidra voyait 767 fonctions. Il lui manquait `apt_thread_main`, les trois gestionnaires de `ns:`, tous les gestionnaires de notifications et les fonctions d'initialisation. Avec les graines de `prescan`, 915 ; avec quatre requêtes trouvées à la main, 919.
- Ces quatre requêtes (`SRV_GetServiceHandle`, `PMAPP_LaunchFIRM`, `PTMSYSM_ReplySleepQuery`, `QTMSP_SetQtmStatus`) ne sont jamais appelées : on y arrive par un saut à la fin d'une autre fonction, et Ghidra les fondait dans celle-ci. C'est en comptant les `SendSyncRequest` que le manque s'est vu.
- `prescan` annonce « 45 pointeurs impairs, il y a du code Thumb ». C'est une fausse alerte ici : 39 sont le même pointeur `0x100227`, une fonction de la bibliothèque, un autre est `0x1000fd`, et les 5 derniers ne sont pas des adresses mais des nombres qui y ressemblent (`0x110001` est un numéro de réglage de `cfg`).
- Les numéros de titre de la table des applets sont à zéro dans le fichier. Ils ne se lisent qu'après avoir exécuté la fonction d'initialisation.
- Ghidra a perdu l'argument de `broadcast_notification` dans le fil du bouton HOME, et ceux de `svcKernelSetState`. Ils sont lus dans l'assembleur.
- Le pseudo-code attribue l'unique `svcBreak` à `on_notification_203` : c'est faux, il est à `0x10bc88`, où mène `panic`.

**Trois choses à savoir en relisant dans Ghidra.**
- `apt_handle_command` n'est pas un seul « switch » : une table de saut pour les numéros 0 à `0x2E`, puis des comparaisons en arbre pour le reste. Les commandes à partir de `0x47` sont à la fin de la fonction.
- Les travaux du fil ouvrier (`0x10b604`, `0x10b684`, `0x10d9a0`, `0x112fa0`) finissent tous dans le même morceau de code, autour de `0x10da30`. Ghidra l'affiche dans chacun avec des avertissements « bloc inatteignable ».
- Le début du fichier, de `0x100048` à `0x10022c`, est en Thumb. Les noms qu'on y poserait par une ligne `function` seraient désassemblés en ARM : rien n'y est nommé.

**Pour reprendre.** `ns.noms.tsv` porte 321 noms : les 309 de cette fiche, et 12 posés d'après le contrat APT (`busy_flags_set_wait`, `slot_from_position`, `request_sleep`…). Ceux en `apt_`, `nss_`, `nsp_` et `nsc_` sont les commandes reçues ; ceux en majuscules (`SRV_`, `PMAPP_`, `AM_`, `FSUSER_`, `FSFILE_`, `PTMSYSM_`, `CFG_`…) les requêtes envoyées ; ceux en `slot_`, `parameter_`, `worker_job_` et `job_` la mécanique des parties 4 et 5 ; ceux en `on_notification_` les gestionnaires de la partie 7. Le pseudo-code brut, l'assembleur et les scripts sont dans `local/analyse/ns/`, non versionné. `capstone` et `unicorn` sont ceux installés par la fiche de `fs`, dans `local/analyse/fs/pylib/`.
