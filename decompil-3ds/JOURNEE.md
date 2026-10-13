# La journée du 14 octobre 2026 : reverse de la 3DS elle-même

Le but du jour n'est pas Pokémon X, c'est la console : comprendre comment elle démarre, ce qui tourne dessus, et lire un vrai module système dans Ghidra. Pokémon X vient en fin de journée, quand la chaîne entière aura été faite une fois sur quelque chose de plus petit.

## La veille, ce soir

- [ ] Charger la console. Vérifier qu'elle démarre bien sur Luma (Select à l'allumage ouvre son menu).
- [ ] Libérer **4 Go** sur la microSD : la sauvegarde NAND d'une New 3DS fait environ 1,3 Go, le dump de Pokémon X avec sa mise à jour environ 2 Go.
- [ ] Copier sur la microSD le contenu de `local/sd/` (préparé) : `luma/payloads/GodMode9.firm` (GodMode9 2.2.3, à jour), `gm9/` (ses scripts), `3ds/ftpd.3dsx` (le serveur FTP, pour envoyer les fichiers au PC sans sortir la carte). Si tu as déjà GodMode9 dans `luma/payloads`, le nouveau le remplace.
- [ ] Installer **devkitPro** : `local/telechargements/devkitProUpdater-3.0.3.exe`, cocher « 3DS Development ». Puis dans son terminal MSYS2, `pacman -Syu` et vérifier `arm-none-eabi-gcc --version`. `python outils/verifier.py` doit alors dire devkitPro présent.
- [ ] Si tu veux REA sur l'ARM demain : dans un PowerShell administrateur, `wsl --install -d Ubuntu`, redémarrer, puis dans Ubuntu : `sudo apt install openjdk-21-jdk nodejs npm` (Node 22 au moins, sinon par nvm). Ce n'est pas bloquant pour la journée ; sans ça, tout se fait à la main dans Ghidra, et c'est très bien pour apprendre.
- [ ] PC et console sur le **même Wi-Fi** (pour ftpd et pour le débogueur GDB de Rosalina). Noter l'adresse IP de la console : Paramètres de la console, Internet, Paramètres de connexion, ta connexion, Changer les paramètres, Paramètres IP.
- [ ] Un lecteur de microSD sous la main quand même : pour la NAND, c'est plus rapide que le Wi-Fi.

## Ce qu'il faut avoir sur la table

| Quoi | Pourquoi |
| --- | --- |
| La New 3DS XL, son chargeur, la microSD et un lecteur | Tout part d'elle |
| GodMode9 à jour sur la SD | Les dumps : NAND, clés, FIRM, modules système, Pokémon X |
| ftpd sur la SD | Envoyer les fichiers au PC par Wi-Fi (`ftp://IP-de-la-console:5000`, dans l'explorateur Windows ou un client FTP) |
| Ghidra 12.1.4, ctrtool, les scripts 3DS, les outils Python | Déjà dans `local/outils/` et `outils/` |
| devkitPro | Compiler les exercices et avoir le GDB qui parle à Rosalina |
| 3dbrew ouvert dans un onglet, et la Carte des services du site | Pour mettre un nom sur chaque en-tête IPC et chaque SVC |
| Les sources de Luma3DS et d'Azahar ouvertes dans un autre onglet | Deux réimplémentations lisibles de ce qu'on va désassembler : `Luma3DS/sysmodules/` et `azahar/src/core/hle/service/` |

## Comment la 3DS démarre, en cinq lignes

1. **boot9 et boot11**, en ROM dans la puce, lancent le **FIRM** (NATIVE_FIRM) depuis la NAND. boot9strap intercepte ça pour lancer Luma à la place.
2. Le FIRM contient **kernel9 et Process9** (ARM9 : sécurité, NAND, cartouche, chiffrement) et **kernel11** (ARM11).
3. kernel11 lance les **modules système** : `sm` (le registre des services), `fs`, `loader`, `pm`, `pxi`, puis `hid`, `gsp`, `dsp`, `cfg`, `ptm`, `ns`, `am` et les autres. Chacun est un titre à part dans la CTRNAND, un NCCH comme un jeu, avec son `code.bin`.
4. `ns` lance le **menu Home**, qui lance les jeux par `pm` et `loader`.
5. Un jeu ne parle au matériel que par les services de ces modules, par **IPC** (messages dans le TLS) et par les **SVC** du noyau.

Luma remplace ou patche quelques-uns de ces modules (`loader`, `pm`, `sm`, `fs` par patchs) et ajoute **Rosalina** : c'est tout ce qui nous donne le débogueur.

## Le matin : sortir les fichiers de la console

Tout avec GodMode9 (Start à l'allumage). Les sorties vont dans `0:/gm9/out` sur la SD.

1. **Sauvegarde NAND, d'abord.** `[S:] SYSNAND VIRTUAL`, `nand.bin`, A, « Copy to 0:/gm9/out ». Environ 1,3 Go. On ne touche jamais à la NAND après, mais on a le filet.
2. **Les clés et les ROM de démarrage.** `[M:] MEMORY VIRTUAL` : `boot9.bin` et `boot11.bin`, « Copy to 0:/gm9/out ». Ce sont les ROM des deux processeurs : lisibles dans Ghidra (ARM9 pour boot9, ARM11 pour boot11), et ctrtool s'en sert pour déchiffrer.
3. **Le FIRM.** `[S:] SYSNAND VIRTUAL`, `firm0.bin`, A, « FIRM image options », « Decrypt file (0:/gm9/out) ». Sur PC : `python outils/extraire.py local/dump/firm0.bin firm` en sort les sections ARM9 et ARM11 avec leur adresse de chargement.
4. **Les modules système.** `[1:] SYSNAND CTRNAND`, dossier `title`, A, « Open title manager ». Les modules sont les titres `00040130` ; sur New 3DS, certains ont une version `00040130 2…` qui prend le pas. Pour chacun, A, « Dump CXI/NDS file ». À prendre aujourd'hui :
   - `hid` (`0004013000001D02`) : le plus petit module utile, il écrit l'état des boutons en mémoire partagée. **C'est celui qu'on lit en premier.**
   - `sm` (`0004013000001002`) : le registre des services, le cœur de l'IPC.
   - `fs` (`0004013000001102`), `gsp` (`0004013000001C02`), `dsp` (`0004013000001A02`), `cfg` (`0004013000001702`), `ptm` (`0004013000002202`), `ns` (`0004013000008002`), `loader` (`0004013000001302`), `pm` (`0004013000001202`).
   Les numéros viennent de 3dbrew (« Title list », « System Modules ») : à confirmer dans le gestionnaire, qui affiche le nom à côté.
5. **Pokémon X** et sa mise à jour, comme décrit dans « Le jeu » de la page du carnet.
6. **Transférer** : soit la carte dans le lecteur, soit lancer `ftpd` depuis le Homebrew Launcher et ouvrir `ftp://IP:5000` depuis le PC. Tout va dans `local/dump/`, qui n'est jamais versionné.

Puis, pour chaque fichier : `python outils/inspecter.py local/dump/<fichier>`, et recopier les SHA-256 dans le journal.

## Midi : extraire et ouvrir

```powershell
python outils/extraire.py local/dump/hid.cxi hid          # -> local/extrait/hid/exefs/code.bin
python outils/elfer.py local/extrait/hid/exefs/code.bin   # -> code.elf, chargé à 0x00100000 en trois segments
python outils/extraire.py local/dump/firm0.bin firm       # -> local/extrait/firm/ : kernel11, kernel9, Process9
```

Ghidra : `local/outils/ghidra/ghidraRun.bat`, nouveau projet dans `local/ghidra-projet/`, importer `code.elf` (langage `ARM:LE:32:v6`), analyser, puis les quatre scripts dans l'ordre (`outils/GHIDRA.md`, partie A). Pour `Label3dsHandles`, il faut d'abord nommer la fonction qui demande un handle à `srv:` : dans un module système, c'est celle qui écrit l'en-tête `0x00050100`.

## L'après-midi : lire `hid`, puis faire parler la console

**Lire `hid` dans Ghidra**, avec la Carte des services du site et `azahar/src/core/hle/service/hid/hid.cpp` à côté. Ce qu'on cherche, dans l'ordre :

1. Le point d'entrée et la boucle de service : un module système attend des messages avec `svcReplyAndReceive` (SVC `0x4F`) dans une boucle sans fin. La reconnaître, c'est avoir compris l'IPC.
2. L'aiguillage des commandes : un `switch` sur l'en-tête IPC lu dans le TLS. Les cas sont les commandes de `hid:USER` (`GetIPCHandles` `0x000A0000`, `EnableAccelerometer` `0x00110000`, `EnableGyroscope` `0x00130000`…) : vérifier chaque valeur dans la Carte des services.
3. La mémoire partagée : où `hid` écrit l'état des boutons (3dbrew « HID Shared Memory »), et comment le jeu la lit sans IPC.
4. Noter dans Ghidra tout ce qu'on a compris : c'est ce qu'on relira demain.

**Les exercices, puis Rosalina.**

5. Dans le terminal MSYS2 de devkitPro : `cd exercices/01-boucle && make`. Copier `ex01.3dsx` dans `3ds/` sur la SD, le lancer depuis le Homebrew Launcher. Ouvrir `ex01.bin` dans Ghidra et répondre aux questions de la page (section Exercices).
6. Rosalina (L + Bas + Select), « Debugger options », « Enable debugger ». Sur le PC : `arm-none-eabi-gdb`, puis `target extended-remote IP:4000`, `info os processes`, `attach <pid>` de l'exercice, `monitor getmemregions`, un point d'arrêt sur `printf`. Puis **désactiver le débogueur** à la fin (sinon la console ne s'éteint plus proprement). Détails dans `outils/GHIDRA.md`, partie D.

**En fin de journée, Pokémon X.** `extraire.py` sans nom (le romfs prend plusieurs minutes), `elfer.py`, import dans Ghidra, les scripts, le compte des fonctions dans la fiche. Et un tour dans l'Explorateur de romfs et la Visionneuse BCH du site avec le vrai romfs : c'est le premier contact de ces outils avec de vrais fichiers, il faut noter tout ce qui casse.

## Le soir

- `etat.json` : cocher ce qui est fait, le journal, la prochaine action ; `python outils/verifier.py`.
- Ne jamais versionner `local/`. Le dépôt ne reçoit que des notes et des outils.

## Si quelque chose bloque

| Symptôme | Piste |
| --- | --- |
| GodMode9 ne voit pas `[M:]` ou refuse de déchiffrer | Vérifier que c'est bien le 2.2.3 copié ce soir, lancé par Luma (chainloader : Start à l'allumage) |
| ctrtool dit que le fichier est chiffré | Repasser par « Decrypt file » dans GodMode9 ; les .cxi du gestionnaire de titres sortent déjà déchiffrés |
| Les scripts Ghidra ne se lancent pas | L'extension Jython et l'en-tête `@runtime Jython` : `python outils/installer.py` les pose |
| GDB se connecte mais `attach` échoue | Le débogueur de Rosalina doit être activé après le lancement du processus ; trois processus au plus |
| Le débogueur fait planter le jeu | Connu avec Pokémon : commencer par l'exercice 01, pas par le jeu |
