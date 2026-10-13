# Ghidra pour la 3DS : charger code.bin, lancer les scripts, déboguer sur la console

Vérifié le **2026-10-13** avec : Ghidra **12.1.4** (build du 2026-09-21, `local/outils/ghidra/`), JDK Temurin **21.0.12**, Python 3.12, Windows 11, les scripts `zaksabeast/3ds-Ghidra-Scripts` (commit `df63903`), et Luma3DS **v13.4** pour la partie console.
Sources : `GettingStarted.md`, `docs/WhatsNew.md` et `docs/ChangeHistory.md`, `support/analyzeHeadlessREADME.md`, `Ghidra/Processors/ARM/data/languages/ARM.ldefs` (tous dans le dossier local), le code des scripts, le README et le code de Luma3DS sur GitHub, et le wiki Luma3DS.
Les commandes partent de la racine `decompil-3ds/`, sous PowerShell.

## À savoir avant de commencer : Jython

Depuis Ghidra 12, un script `.py` sans en-tête `@runtime` s'exécute avec **PyGhidra** (CPython 3), et Jython n'est plus installé par défaut (`ChangeHistory.md`, GP-5415 et GP-6754). Or les scripts 3DS sont écrits pour **Jython (Python 2)** : ils font `from __main__ import currentProgram` et `array('b', str)`, ce qui échoue en Python 3.

Essayé le 2026-10-13 : lancé tel quel, `Set3dsTlsType.py` s'arrête sur `Ghidra was not started with PyGhidra. Python is not available`. Il faut donc :

- installer l'extension Jython (étape 2) ;
- ajouter `# @runtime Jython` en tête des quatre scripts (étape 7).

**Ces deux choses sont faites par `python outils/installer.py`** depuis le 2026-10-13 : il déballe l'extension Jython livrée avec Ghidra dans `Ghidra\Extensions\` et pose l'en-tête sur les quatre scripts. Les étapes 2 et 7 ci-dessous expliquent ce qu'il fait, pour le refaire à la main si besoin.

PyGhidra n'est pas nécessaire pour ces scripts ; il est décrit en annexe.

## A. Dans l'interface

1. **Lancer Ghidra.** Java 21 est trouvé par `JAVA_HOME` (prioritaire) ou par le `PATH`. Sinon, Ghidra demande au premier lancement le dossier du JDK, celui qui contient `bin\` (`GettingStarted.md`, « Java Notes »).
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"   # si besoin
   .\local\outils\ghidra\ghidraRun.bat
   ```
2. **Installer Jython, une seule fois.** Deux façons, d'après `GettingStarted.md` :
   - dans l'interface : *File → Install Extensions*, cocher **Jython**, puis redémarrer Ghidra ;
   - ou déballer l'extension dans l'installation, ce qui sert aussi à l'analyse sans interface (partie B). Ghidra doit être fermé.
     ```powershell
     Expand-Archive .\local\outils\ghidra\Extensions\Ghidra\ghidra_12.1.4_PUBLIC_20260921_Jython.zip -DestinationPath .\local\outils\ghidra\Ghidra\Extensions
     ```
3. **Créer un projet :** *File → New Project → Non-Shared Project*, dossier `local\ghidra-projet\`, nom `PokemonX`.
4. **Importer `code.bin`** (*File → Import File*, puis `local\extrait\exefs\code.bin`). Plus simple : importer `code.elf`, fabriqué par `python outils\elfer.py local\extrait\exefs\code.bin`, que Ghidra reconnaît comme ELF ARM et charge à `0x00100000` tout seul, en trois blocs si `exheader.bin` est à côté. Il ne reste alors que le langage à confirmer (`ARM:LE:32:v6`). Pour le binaire brut :
   - **Format :** `Raw Binary` ;
   - **Language :** cliquer sur `…` et choisir **`ARM:LE:32:v6`**, compilateur `default` (« Generic ARM/Thumb v6 little endian »). L'identifiant existe bien dans `ARM.ldefs` de Ghidra 12.1.4. Le processeur applicatif de la 3DS est un ARM11 MPCore (ARMv6K) : v6 est la variante la plus proche. v7 ou Cortex décoderaient aussi le code, mais accepteraient des instructions que la console n'a pas ;
   - **Options… → Base Address :** `0x00100000`.
5. **Ouvrir le programme et lancer l'analyse.** Double-cliquer sur `code.bin`. Avant d'accepter « Analyze now? », aller en `0x00100000` (touche `G`), appuyer sur `D` pour désassembler puis `F` pour créer la fonction : en binaire brut, Ghidra ne connaît pas le point d'entrée. Lancer ensuite l'analyse (*Analysis → Auto Analyze*) avec ces options (noms vérifiés dans Ghidra 12.1.4 ; l'effet sur notre binaire reste **à confirmer**) :
   - cocher **Aggressive Instruction Finder** : décoché par défaut, il trouve les fonctions que rien ne référence. Il peut aussi créer du faux code ;
   - décocher **Embedded Media** : il cherche des images et des sons dans les données, ce qui est inutile ici ;
   - garder **ARM Constant Reference Analyzer**, **Function Start Search**, **Decompiler Switch Analysis** et **Shared Return Calls** ;
   - si des fonctions s'arrêtent net après un appel, décocher **Non-Returning Functions - Discovered** et relancer.
6. **Vérifier la mémoire** (*Window → Memory Map*). L'import brut ne crée qu'un seul bloc. Il doit avoir la case **X** cochée, sinon `Label3dsSVCs` ne trouve rien. Facultatif : découper ce bloc en `.text`, `.rodata` et `.data` avec les tailles de l'exheader, pour que le décompilateur sache ce qui est en lecture seule.
7. **Brancher les scripts :**
   - ouvrir *Window → Script Manager* ;
   - cliquer sur le bouton *Manage Script Directories* (l'icône en liste), puis sur **+**, et ajouter `…\decompil-3ds\local\outils\ghidra-scripts`. La catégorie **3ds** apparaît dans l'arbre ;
   - ajouter `# @runtime Jython` sous la ligne `# @category 3ds` des quatre scripts. Pas dans `ctr_services.py` ni `ghidra_utils.py` : ce sont des modules importés. Le dossier est un clone git et `installer.py` ne le reclone pas, donc ce changement reste. Commande qui fait l'ajout, en UTF-8 sans BOM :
     ```powershell
     foreach ($f in 'Label3dsSVCs','Label3dsHandles','Label3dsCTRFns','Set3dsTlsType') {
       $p = (Resolve-Path ".\local\outils\ghidra-scripts\$f.py").Path
       $t = [IO.File]::ReadAllText($p)
       if ($t -notmatch '@runtime') {
         $t = $t -replace '(# @category 3ds\r?\n)', "`$1# @runtime Jython`n"
         [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
       }
     }
     ```
8. **Lancer les scripts dans l'ordre du README** (double-clic dans le Script Manager) :
   1. **`Label3dsSVCs.py`** cherche chaque instruction `svc` (motif `xx 00 00 EF`) et pose un signet « SVC ». Pour les SVC les plus courantes (`svcSendSyncRequest*`, `svcWaitSynchronization*`, `svcCloseHandle`, `svcGetSystemTick`, `svcClearEvent`, `svcSignalEvent`, `svcExitProcess`), il pose seulement un commentaire `svcXxx`. Pour les autres, **il pose une question oui/non à chaque fois** : « oui » renomme la fonction en `ctr::svcXxx`, « non » met un commentaire.
   2. **Avant le suivant, à la main :** trouver la fonction qui demande un handle de service à `srv:`. Elle écrit l'en-tête IPC `0x00050100` (srv:GetServiceHandle, d'après 3dbrew ; *Search → For Scalars*) et reçoit (pointeur de handle, nom du service). La renommer **`ctr::srv::GetServiceHandleDirect`**. Sans ce nom, le script suivant s'arrête sur `Cannot find ctr::srv::GetServiceHandleDirect`. Quelle fonction choisir exactement (enveloppe ou fonction directe) reste **à confirmer** sur le binaire.
   3. **`Label3dsHandles.py`** cherche les noms de services (`fs:USER`, `hid:USER`…) et suit les appels à `GetServiceHandleDirect`. Il étiquette la variable globale de chaque handle (`ctr::fs_user_handle`…). Les services inconnus deviennent `xxx_handle`, avec un message « Unmapped service ».
   4. **`Label3dsCTRFns.py`** nomme les fonctions IPC d'après leur en-tête et le handle qu'elles utilisent, à l'aide de la table de 3dbrew contenue dans `ctr_services.py`. Il produit des noms comme `ctr::fs::…` ; une enveloppe reçoit le suffixe `_wrapper`, un aiguilleur de commandes devient `handleServiceCommand`, et une commande inconnue `CTR_FN_<en-tête>` ou `<handle>_<en-tête>`.
   5. **`Set3dsTlsType.py`** crée les types `ThreadLocalStorage` (`storage[32]`, `command_buffer[64]`, `static_buffers[32]`) et `PThreadLocalStorage`. Il retype en `tls` chaque variable lue par `mrc p15, 0, rX, c13, c0, 3`, et nomme `ctr::getThreadLocalStorage` la fonction qui fait cette lecture.

## B. En ligne de commande (`analyzeHeadless`)

Syntaxe tirée de `support/analyzeHeadlessREADME.md` :

- `-postScript` prend un **nom** de script, sans chemin, et se répète pour chaque script ;
- `-scriptPath` prend des chemins séparés par `;`, entre guillemets ;
- `-loader-baseAddr` n'existe qu'avec `-loader BinaryLoader`.

Le projet ne doit pas être ouvert dans l'interface pendant ce temps.

9. **Importer et analyser.** Syntaxe essayée le 2026-10-13 sur un petit binaire ARM. Le journal confirme `"-loader-baseAddr" … new: "0x00100000"` et `Using Language/Compiler: ARM:LE:32:v6:default`.
   ```powershell
   New-Item -ItemType Directory -Force .\local\ghidra-projet | Out-Null
   .\local\outils\ghidra\support\analyzeHeadless.bat .\local\ghidra-projet PokemonX `
     -import .\local\extrait\exefs\code.bin `
     -loader BinaryLoader -loader-baseAddr 0x00100000 `
     -processor ARM:LE:32:v6 -cspec default `
     -log .\local\ghidra-projet\import.log
   ```
10. **Lancer des scripts sur le programme déjà importé**, sans refaire l'analyse. `-process` enregistre les changements, sauf si on ajoute `-readOnly`.
    ```powershell
    .\local\outils\ghidra\support\analyzeHeadless.bat .\local\ghidra-projet PokemonX `
      -process code.bin -noanalysis `
      -scriptPath "C:\Users\krisr\Documents\RandomProjects\decompil-3ds\local\outils\ghidra-scripts" `
      -postScript Label3dsHandles.py -postScript Label3dsCTRFns.py -postScript Set3dsTlsType.py `
      -scriptlog .\local\ghidra-projet\scripts.log
    ```
    `Label3dsSVCs.py` est à lancer dans l'interface : sans interface, ses questions `askYesNo` réclament un fichier `Label3dsSVCs.properties` (option `-propertiesPath`). Sa clé contient un retour à la ligne, et la façon de l'écrire reste **à confirmer**. Pour que les scripts tournent sans interface, l'extension Jython doit être déballée dans `Ghidra\Extensions` (étape 2, seconde façon), et les en-têtes `@runtime` doivent avoir été ajoutés (étape 7).

## C. Annexe : PyGhidra (pour de futurs scripts en Python 3)

11. Ghidra 12.1.4 accepte Python 3.9 à 3.14 (`application.properties`), donc le Python 3.12 déjà installé convient. Installation hors ligne depuis le paquet fourni (`GettingStarted.md`, « PyGhidra Mode ») :
    ```powershell
    py -3.12 -m pip install --no-index -f .\local\outils\ghidra\Ghidra\Features\PyGhidra\pypkg\dist pyghidra
    .\local\outils\ghidra\support\pyghidraRun.bat          # interface avec Python 3
    .\local\outils\ghidra\support\pyghidraRun.bat -H <mêmes arguments qu'analyzeHeadless>
    ```
    `pyghidraRun.bat` propose aussi d'installer `pyghidra` lui-même au premier lancement. Le dossier `dist` contient `pyghidra-3.1.0` et `jpype1-1.5.2` (wheel `cp312-win_amd64`).

## D. Déboguer sur la console (Luma3DS / Rosalina)

12. Sur la console, ouvrir Rosalina avec **L + Bas + Select** (README Luma3DS, « Basic usage »).
13. Aller dans **Debugger options**, puis **Enable debugger**. Les noms viennent du code `sysmodules/rosalina/source/menus/debugger.c`. Les autres entrées sont **Disable debugger** et **Force-debug next application at launch** : cette dernière arrête le prochain jeu lancé dès son démarrage, et l'écran indique le port à utiliser. Le wiki ajoute : choisir le processus cible dans la *Process List*, et **désactiver le débogueur à la fin**, sinon la console ne peut plus s'éteindre ou redémarrer proprement.
14. Les ports, d'après le README : **4000 à 4002** pour les connexions normales, en `extended-remote` ; **4003** pour l'arrêt au démarrage, sans `extended-remote`. Le README recommande le GDB patché de devkitARM et `attach` combiné avec `info os processes` :
    ```text
    arm-none-eabi-gdb
    (gdb) target extended-remote 192.168.1.XX:4000
    (gdb) info os processes
    (gdb) attach <pid>
    (gdb) monitor getmemregions
    ```
    D'autres commandes `monitor` sont présentes dans le code (`gdb/remote_command.c`) : `convertvatopa`, `syncrequestinfo`, `translatehandle`, `listallhandles`, `getmmuconfig`, `flushcaches`, `toggleextmemaccess`, `catchsvc`, `getthreadpriority`. Le wiki ajoute : jusqu'à 3 processus à la fois, des points d'arrêt logiciels, et 2 points de surveillance matériels.
15. **Attention avec Pokémon.** Le README signale que le moteur de triche fait planter les jeux Pokémon : il y a une course dans le noyau quand un `KDebugThread` est attaché à des threads qu'on crée et détruit sans cesse. Comme le débogueur GDB passe aussi par le débogage du noyau, il pourrait faire planter le jeu de la même façon (déduction **à confirmer**).
