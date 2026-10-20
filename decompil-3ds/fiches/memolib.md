# memolib, l'applet du bloc-notes

`memolib` est l'applet de bibliothèque du bloc-notes : un jeu l'appelle par APT pour que le joueur écrive ou dessine une note sur l'écran tactile. Elle reçoit un bloc de paramètre de 0x100 octets et une mémoire partagée qu'elle projette, dessine par `gsp::Gpu` avec la bibliothèque graphique et la bibliothèque de mise en page des applets, lit le stylet et les boutons par `hid:USER`, joue ses sons par `csnd:SND`, puis rend le bloc au jeu.

Fiche du 20 octobre 2026, tirée du brouillon du 18/10 (`local/analyse/memolib/`) après relecture adverse ; la fonction principale a été relue en assembleur pour cette fiche. Les adresses sont celles du module chargé à `0x00100000`. Une grande partie du code est celui d'[extrapad](extrapad.md) (même bibliothèque des applets : 1 038 fonctions d'`extrapad` ont une copie identique ici).

**Les noms.** Un nom sans marque est dans `memolib.noms.tsv` à cette adresse (confiance haute). Un nom suivi de † n'est que **proposé** (confiance moyenne, `local/analyse/memolib/noms-proposes.tsv`).

## Carte d'identité

| | |
| --- | --- |
| Titre | `000400300000F602`, nom `memolib` (exheader) |
| Fichier lu | `local/extrait/memolib/exefs/code.bin` et `exheader.bin` |
| Taille | 0x56A0C octets de code (`0x100000`), 0x8828 de lecture seule (`0x157000`), 0x7C6C de données (`0x160000`), 0x13220 de mémoire à zéro ; pile de 0x10000 |
| Fonctions | 1 440 pour Ghidra, plus 68 entrées manquées et un corps de veneer (`0x1004e4`) : 1 509 ; 128 nommées dans `memolib.noms.tsv`, 430 proposées en moyenne |
| Services permis (exheader) | `$hioFIO`, `$hostio0`, `$hostio1`, `cfg:u`, `fs:USER`, `gsp::Gpu`, `hid:USER`, `ndm:u`, `pxi:dev`, `APT:A`, `csnd:SND` ; pas d'`ir:USER` |
| Services ouverts par le code | `srv:`, `APT:A` (puis `APT:U` en repli, même code qu'`extrapad`), `cfg:u` (repli `cfg:i`, `cfg:s`), `fs:USER`, `gsp::Gpu`, `hid:USER`, `csnd:SND`, `ndm:u`, et le port `err:f` |
| Identifiant d'applet | 0x409, premier argument de `apt_setup_and_init`† (`0x1022ec`), appelé en `0x10071c` |
| Paramètre | 0x100 octets, sur la pile de `memolib_main`† |
| Dépendances déclarées | 31 titres (exheader) |
| Romfs | une archive de mises en page (la page, les boutons des tampons et des pages, leurs animations), une police BCFNT, les messages par langue, les nuanceurs, les sons (`.bcwav`) et les séquences (`.sseq`) |

## Partie 1 : le démarrage

`entry` (`0x100000`) : `clear_bss`† (`0x100024`, de `0x167c6c` à `0x17ae8c` : fin des données et 0x13220 octets de mémoire à zéro), les arguments du programme, le moteur d'exécution et `srv:` (`0x13066c`), les tas (`0x101f00` : tas linéaire de 0x400000 octets, tas ordinaire porté à 0xFD000), les 91 constructeurs statiques (`0x10065c`), une table d'initialisation vide, les services de départ (`0x100cb8` : notifications de `srv:`, APT, `NDMU_OverrideDefaultDaemons` `0x11666c` et `NDMU_SuspendDaemons` `0x116630`), puis `memolib_main`† (`0x1006dc`) et la fin du processus.

`memolib_main`† (relu en assembleur, `0x1006dc` à `0x100be0`) :

1. Initialise APT en applet 0x409 (`0x1022ec`), pose ses rappels de veille et du bouton HOME (`0x10214c`, `0x102138`, `0x10228c`, `0x102278`, qui rangent fonction et argument dans la table `0x16505c`), puis `APT_FinishPreloadingLibraryApplet` par `0x1024a8`.
2. Prépare son tas (`0x1690d0`), ouvre `fs:USER` (`0x101c18`), monte le romfs sous « rom: ».
3. Reçoit le paramètre (`0x130958`) : l'expéditeur en `sp+0x118`, le bloc de 0x100 octets en `sp+0x10`, la poignée jointe en `sp+0x110` (`0x1007e8` à `0x100808`). Range -1 dans le mot +0x6C du bloc (`0x10080c`).
4. Si une poignée est jointe, projette la mémoire partagée (`0x1023e4`, qui appelle `map_shared_memory` `0x103c08` avec la permission 3) à l'adresse `0x169128`, de la taille du mot +0x14 du bloc.
5. **Sortie immédiate** si l'un des octets d'état de la bibliothèque des applets (lus par `0x130948` et `0x130938`) est levé : +0x6C reçoit 12, puis `APT_PrepareToCloseLibraryApplet` et `APT_CloseLibraryApplet` rendent le bloc (`0x10085c` à `0x10087c`).
6. Ouvre `hid:USER` (`0x1020a4`), appelle `0x10442c(1)` si l'octet +0x61 est levé, puis tourne sa boucle (`0x1008e8` à `0x100a64`). La boucle s'arrête quand l'un des deux octets d'état se lève, ou quand l'étape de la scène (`0x107140`) rend non nul alors que +0x6C vaut 10.
7. À la sortie de la boucle : crée un bloc de mémoire de 0x2000 octets (`0x103b74`), appelle `0x102e38` puis `0x1307bc` sur le tas, démonte « rom: ».
8. Si la boucle ne s'est arrêtée ni par les octets d'état, ni par +0x64, ni avec +0x6C à 10, attend un nouveau message d'APT (`0x130958` à nouveau, sans tampon, en `0x100b58`) : s'il rend autre chose que 4 ou 7, l'applet appelle `0x10442c(1)` et **reprend sa boucle** (`0x100b80`, saut en `0x1008b0`).
9. Sinon, `APT_PrepareToCloseLibraryApplet` par `0x1023f8` (ses deux arguments dépendent de +0x6C et de l'étape 8), puis `APT_CloseLibraryApplet` par `0x10237c` avec le bloc de la pile, 0x100 octets et la poignée `[0x165024]`, et la fin du processus.

## Partie 2 : les services

Même méthode que pour [extrapad](extrapad.md) : en-tête à `+0x80` du stockage local, poignée lue avant `svc 0x32`, ouverture qui cite la chaîne du service.

| Service | Poignée | Requêtes nommées dans la fiche |
| --- | --- | --- |
| `srv:` | `[0x16544c]` | `SRV_RegisterClient`, `SRV_EnableNotification`, `SRV_GetServiceHandle`, `SRV_ReceiveNotification` |
| `APT:A` | `[0x165348]` ; « APT:A » d'abord | 25 requêtes (`APT_*`), dont `APT_ReceiveParameter` (`0x117a04`), `APT_PrepareToCloseLibraryApplet` (`0x104ac4`), `APT_CloseLibraryApplet` (`0x104a70`) |
| `cfg:u` | `[0x165358]` ; `[0x165b94]` (`cfg:s`) et `[0x165b90]` (`cfg:i`) en repli | `CFG_GetConfigInfoBlk2`, `CFG_SecureInfoGetRegion` |
| `fs:USER` | `[0x16510c]` | `FSUSER_GetPriority`, `FSUSER_OpenFileDirectly` ; les autres envois de `fs:USER` et ceux d'un fichier ouvert sont seulement proposés |
| `gsp::Gpu` | `[0x165414]`, recopiée en `[0x165418]` | `GSPGPU_AcquireRight`, `GSPGPU_SetLcdForceBlack`, `GSPGPU_WriteHWRegsWithMask`, `GSPGPU_ImportDisplayCaptureInfo`, `GSPGPU_RegisterInterruptRelayQueue`, `GSPGPU_UnregisterInterruptRelayQueue` ; sept autres seulement proposés |
| `hid:USER` | `[0x165430]` | `HIDUSER_GetIPCHandles` (`0x109d94`) |
| `csnd:SND` | `[0x1653dc]` | `CSND_Initialize`, `CSND_Shutdown`, `CSND_ExecuteCommands`, `CSND_AcquireSoundChannels`, `CSND_ReleaseSoundChannels`, `CSND_FlushDataCache` |
| `ndm:u` | `[0x165b98]` | `NDMU_SuspendDaemons`, `NDMU_OverrideDefaultDaemons` |
| `err:f` (port) | `[0x1650f0]`, connexion au port « err:f » | `ERRF_Throw` (`0x137450`) |

49 envois sont nommés dans `memolib.noms.tsv`. Comme dans `extrapad`, les envois de la forme de `cam:u` (poignée `[0x165658]`) et de `dsp::DSP` sont liés mais leur poignée n'est jamais ouverte (seule écriture : la remise à zéro par un constructeur statique).

## Partie 3 : le paramètre reçu et ce qui est rendu

Le bloc de 0x100 octets est à `sp+0x10` dans `memolib_main`† ; les décalages ci-dessous sont relus en assembleur (adresse sur la pile moins `0x10`).

| Décalage | Taille | Usage lu |
| --- | --- | --- |
| +0x14 | mot | taille de la mémoire partagée jointe (`ldr r2, [sp, #0x24]` en `0x10082c`) |
| +0x61 | octet | non nul : `0x10442c(1)` avant la boucle (sens non lu) |
| +0x62 | octet | non nul, avec l'octet `0x16925c` nul : +0x6C reçoit 10 et `0x102dd4` est appelé (sens non lu) |
| +0x64 | octet | quand `0x1023d4` rend vrai : non nul, +0x6C reçoit 12 et `0x102dd4` est appelé ; nul, `0x12b6d8` est appelé (sens non lu) |
| +0x6C | mot | **l'issue rendue au jeu** : -1 à la réception, 12 sur une sortie immédiate ou par +0x64, 10 par +0x62 ; elle décide aussi des arguments de `APT_PrepareToCloseLibraryApplet`. Le sens des valeurs n'est pas lu |

Le brouillon prenait +0x6C pour un « état local » : c'est un mot du bloc (`sp+0x7c` est dans le tampon `sp+0x10` à `sp+0x110`), donc rendu au jeu avec le reste. **Le bloc entier est rendu** par `APT_CloseLibraryApplet`, avec la poignée de `[0x165024]` (supposé : la mémoire partagée de la note).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 49 envois nommés dans `memolib.noms.tsv` : en-tête, Carte des services, et poignée remontée jusqu'à la chaîne de son service.
- La taille du bloc (0x100, passée en dur à la réception et à `APT_CloseLibraryApplet`), la projection de la mémoire partagée depuis la poignée reçue, les décalages +0x14, +0x61, +0x62, +0x64 et +0x6C : pseudo-code de Ghidra, puis désassemblage relu pour cette fiche.
- Les bornes de la mémoire à zéro : lecture, et tailles de l'exheader.

**Interprété, à relire dans Ghidra**
- Les noms suivis de † (dont `clear_bss`†, `memolib_main`†), et les rôles des fonctions citées par leur seule adresse, repris d'`extrapad` là où le code est le même.
- Le contenu de la mémoire partagée (la note) et la poignée rendue.

**Pas lu**
- Le sens des octets +0x61, +0x62, +0x64 et des valeurs 10 et 12 de +0x6C.
- Le dessin au stylet, les tampons, les pages, une sauvegarde éventuelle.
- La bibliothèque de mise en page et de son, l'essentiel du code de `0x140000` à `0x154000`.
- Les 951 fonctions qui n'ont aucun nom, et les 430 qui n'ont qu'un nom proposé.

## Comment cette fiche a été faite

Comme celle d'[extrapad](extrapad.md), dont la plupart des noms sont repris par empreinte ; détail et compte dans `local/analyse/memolib/notes-100.md`. La relecture du 20/10 a contrôlé chaque nom contre `memolib.noms.tsv` et relu `memolib_main`† en assembleur.

**Pour reprendre.** `memolib.noms.tsv` est le fichier de graines ; propositions dans `local/analyse/memolib/noms-proposes.tsv`, pseudo-code dans `local/analyse/memolib/gh/`, non versionnés.
