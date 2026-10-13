# Brancher REA (Reverse Engineer Anything) sur Claude Code

Vérifié le **2026-10-13** avec : `rea-agents` **6.4.0** (dernière version npm, publiée le 2026-10-11), Node 22.23.1, Ghidra 12.1.4 (`local/outils/ghidra/`), JDK Temurin 21.0.12, Windows 11.
Sources : `npx -y rea-agents@latest --help` et l'aide de chaque commande, le code du paquet 6.4.0, la doc du dépôt `morluto/rea` (`docs/installation.md`, `client-configuration.md`, `cli.md`, `raw-binary.md`, `ghidra-provider.md`, `windows-ghidra-p0.md`). Le site `rea.tools` renvoie aux mêmes guides.

## Le verdict d'abord

**Sous Windows, REA 6.4.0 ne sait pas ouvrir notre `code.bin`.** Son fournisseur Ghidra pour Windows (« Windows Ghidra P0 », expérimental) n'accepte que des exécutables **PE x86/x86-64**. Essayé le 2026-10-13 sur un petit code ARM :

- fichier brut : refusé, `unsupported binary format` ;
- même code enveloppé dans un ELF ARM : refusé, `Windows Ghidra P0 accepts PE targets only`.

Brancher REA aujourd'hui ne donne donc rien sur Pokémon X. Il reste deux chemins, décrits plus bas : Linux (WSL), ou attendre une version de REA qui accepte les binaires bruts sous Windows. En attendant, le travail se fait dans Ghidra (voir `GHIDRA.md`).

**État au 2026-10-13, après cette vérification :** REA est quand même branché, pour être prêt. `rea-agents` 6.4.0 est installé en global (`npm install -g`), `GHIDRA_INSTALL_DIR` est posé durablement (`setx`) vers `local\outils\ghidra`, et `rea setup --client claude_code --yes` a écrit l'entrée `mcpServers.rea` dans `~/.claude.json` (sauvegarde `.claude.json.rea.backup`) avec `GHIDRA_INSTALL_DIR` et `JAVA_HOME` dans son bloc `env`, plus le skill dans `~/.claude/skills/reverse-engineer-anything`. `rea doctor --provider ghidra` est sain. L'essai du refus (brut puis ELF fabriqué par `outils/elfer.py`) a été refait avec ce branchement : même résultat. `outils/verifier.py` marque REA présent quand le paquet et l'enregistrement sont là ; la tâche « WSL » du palier 2 reste la vraie condition pour qu'il serve.

## 1. Vérifier que le paquet existe (sans rien installer)

```powershell
npx -y rea-agents@latest --version      # 6.4.0
npx -y rea-agents@latest --help         # la liste des commandes
npm view rea-agents version             # la version publiée
```

`npx` met le paquet en cache (`%LOCALAPPDATA%\npm-cache\_npx\`) mais ne modifie aucune configuration.

## 2. Ce que fait `npx -y rea-agents@latest setup`

D'après `docs/installation.md` et le code du paquet :

1. Il propose une liste d'agents détectés (Claude Code, Codex, Cursor…). Un agent déjà branché est présélectionné ; un agent simplement détecté ne l'est pas.
2. Pour Claude Code, il écrit une entrée `mcpServers.rea` dans **`~/.claude.json`** (ou `$CLAUDE_CONFIG_DIR/.claude.json` si cette variable est définie), et copie un skill dans **`~/.claude/skills/`** (`reverse-engineer-anything`). Option `--skill=false` pour s'en passer.
3. Il affiche le plan complet (chemins, changements, variables d'environnement) et **demande confirmation avant d'écrire**. Refuser ou Ctrl-C ne change rien. Il ne passe en mode interactif que si on le lance dans un vrai terminal.
4. Avant d'écrire, il fait une copie `.rea.backup` du fichier, sans toucher aux autres entrées.
5. Il n'installe jamais Ghidra, Java ni Python. Il peut proposer d'installer Hopper (macOS et Linux seulement), avec une confirmation à part.
6. Sur Windows, l'entrée écrite ressemble à `cmd.exe /d /c npx -y rea-agents@6.4.0 mcp` : la version est figée à celle qui a lancé `setup`.

Options utiles :

```powershell
npx -y rea-agents@latest setup --client claude_code --dry-run   # n'écrit rien, montre le plan
npx -y rea-agents@latest setup --client claude_code              # demande confirmation
npx -y rea-agents@latest uninstall                               # retire seulement ce que REA a ajouté
```

## 3. Lui indiquer notre Ghidra local

Il faut définir une **variable d'environnement**. Il n'y a ni option en ligne de commande ni fichier de configuration propre à REA pour ça.

```powershell
$env:GHIDRA_INSTALL_DIR = "C:\Users\krisr\Documents\RandomProjects\decompil-3ds\local\outils\ghidra"
npx -y rea-agents@latest providers --format json   # « ghidra » doit passer à "available", version 12.1.4
```

Essayé le 2026-10-13 : avec cette variable, REA trouve `analyzeHeadless.bat`, le décompilateur `win_x86_64`, Ghidra 12.1.4 et le JDK 21 (via `JAVA_HOME` ou le `PATH`). Sans elle, la réponse est `not_configured`.

Le serveur MCP lancé par Claude Code doit recevoir cette variable. Si `setup` est lancé dans la même session PowerShell, juste après le `$env:` ci-dessus, il l'ajoute au bloc `env` de l'entrée MCP (« Detected provider settings », `installation.md`) ; elle apparaît dans le plan, à vérifier avant d'accepter. Autres variables documentées :

| Variable | Rôle |
|---|---|
| `REA_GHIDRA_LANGUAGE_ID` | force le langage, par exemple `ARM:LE:32:v6` (REA vérifie qu'il existe dans les `.ldefs`) |
| `REA_GHIDRA_COMPILER_SPEC_ID` | facultatif, exige la variable précédente |
| `REA_GHIDRA_SEED_FILE` | TSV `adresse<TAB>function\|code\|label[<TAB>nom]` appliqué avant l'analyse |
| `REA_GHIDRA_DISABLED_ANALYZERS` | analyseurs Ghidra à couper, par leur nom exact |
| `REA_GHIDRA_STARTUP_TIMEOUT_MS` | délai d'ouverture, 330000 par défaut (à monter pour un gros binaire) |
| `GHIDRA_HEADLESS_MAXMEM` | mémoire du JVM, `2G` par défaut |
| `REA_ANALYSIS_PROVIDER=ghidra` | préférer Ghidra quand plusieurs fournisseurs conviennent |

## 4. Un binaire ARM brut (`code.bin` à `0x00100000`)

- **REA n'ouvre pas un projet Ghidra existant.** Pour chaque cible, il refait un import dans une base Ghidra temporaire (`-readOnly -deleteProject`, vu dans son code). Les noms posés à la main ou par les scripts 3DS dans notre projet ne lui parviennent pas.
- **Avec la 6.4.0, on ne peut lui passer ni adresse de base ni chargeur.** `--target-format` n'accepte que le DOS `.COM`. Seuls les en-têtes ELF, PE et Mach-O sont reconnus.
- **Sur la branche `main`, pas encore publiée sur npm** (`docs/raw-binary.md`) : `--target-format raw-binary --architecture arm --entry-point 0x00100000`. Le fichier entier est placé à l'adresse d'entrée, avec le langage imposé **`ARM:LE:32:v7`** (et non v6). Cette doc précise : « Windows Ghidra P0 continues to admit native PE applications and DLLs only; raw-binary targets are unsupported. »
- **Contournement sous Linux (confirmé le 2026-10-13 sur l'ELF de l'exercice 01, voir plus bas) :** envelopper `code.bin` dans un ELF qui le charge à `0x00100000`, et forcer `REA_GHIDRA_LANGUAGE_ID=ARM:LE:32:v6`. C'est ce que fait `outils/elfer.py` (un segment, ou trois d'après `exheader.bin` : `.text` en lecture-exécution, `.rodata` en lecture, `.data` plus `.bss` en lecture-écriture) :

```powershell
python outils\elfer.py local\extrait\exefs\code.bin        # écrit code.elf à côté
```

Sous Windows, REA 6.4.0 a bien reconnu cet ELF, puis l'a refusé faute de fournisseur. Le même ELF s'ouvre dans Ghidra sans avoir à saisir l'adresse de base.

- **Le chemin Linux, essayé le 2026-10-13 : il marche.** Ubuntu 26.04 est installé sous WSL (`wsl --install -d Ubuntu --no-launch`, sans droits administrateur ni redémarrage puisque WSL 2 était déjà là pour Docker), avec `openjdk-21-jdk-headless` et le `nodejs` de la distribution (22.22.1). Le dossier Ghidra local sert tel quel par `/mnt/c/...` : il contient le décompilateur `linux_x86_64`. Avec `GHIDRA_INSTALL_DIR=/mnt/c/Users/krisr/Documents/RandomProjects/decompil-3ds/local/outils/ghidra` et `REA_GHIDRA_LANGUAGE_ID=ARM:LE:32:v6`, `npx -y rea-agents@6.4.0 search <ex01.elf> Exercice --provider ghidra` ouvre l'ELF ARM et rend `0x118000 "Exercice 01 : la boucle"`. Compter 2 min 20 par commande en ligne avec Ghidra lu à travers `/mnt/c` (chaque appel refait l'import). Depuis, `rea-agents` 6.4.0 est installé en global dans Ubuntu (`/usr/local/bin/rea`) et Ghidra est copié côté Linux dans `/opt/ghidra` ; `rea mcp doctor` y est sain (170 outils).
- **Le serveur MCP côté WSL** est enregistré dans `~/.claude.json` sous le nom **`rea-wsl`**, à côté de `rea` (la version Windows, gardée pour les PE). Sa commande : `wsl.exe -d Ubuntu -- env GHIDRA_INSTALL_DIR=/opt/ghidra REA_GHIDRA_LANGUAGE_ID=ARM:LE:32:v6 REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000 GHIDRA_HEADLESS_MAXMEM=4G rea mcp`. Le langage ARM v6 y est imposé : cette entrée ne sert qu'aux binaires 3DS. Les cibles se donnent en chemins `/mnt/c/...`. Sauvegarde de la configuration d'avant : `~/.claude.json.avant-rea-wsl.backup`. Pour la retirer : `claude mcp remove rea-wsl -s user`.

## 4 bis. Le pont et le premier passage automatique (depuis le 2026-10-13)

En ligne de commande, chaque question à REA refait l'import et l'analyse. `outils/rea_bridge.py` lance le serveur MCP de REA sous Ubuntu une seule fois et le garde ouvert sur un port local : une question prend alors une quinzaine de secondes.

```powershell
python outils/rea_bridge.py serve                 # dans un terminal à part, il ne rend pas la main
python outils/prescan.py hid                      # ouvre local/extrait/hid/exefs/code.elf et fait le premier passage
python outils/rea_bridge.py call procedure_pseudo_code '{"procedure": "0x102178"}' --save local/analyse/hid service_loop
python outils/rea_bridge.py stop
```

`prescan.py <module>` repère les appels système (noms tirés de la Carte des services), nomme leurs enveloppes, trouve la fonction qui appelle `ReplyAndReceive`, et surtout les **fonctions que Ghidra a manquées** : celles qui ne sont appelées que par une table de pointeurs, comme les gestionnaires de commandes. Il les écrit en graines dans `fiches/<module>.noms.tsv`. Il faut alors relancer le pont avec `REA_GHIDRA_SEED_FILE=/mnt/c/.../fiches/<module>.noms.tsv` et repasser prescan jusqu'à « aucune ». Mesuré : `sm` passe de 102 à 110 fonctions, `hid` de 250 à 276.

Le même fichier `.noms.tsv` porte les noms qu'on donne aux fonctions (troisième colonne, en anglais) : REA les applique à chaque ouverture, le pseudo-code sort avec.

## 5. Commandes CLI utiles sur un binaire natif

Elles valent pour une cible que REA accepte : un PE sous Windows, ou ELF/Mach-O/brut sous Linux et macOS. `<bin>` est un chemin absolu.

```powershell
npx -y rea-agents@latest analyze   <bin> --provider ghidra --format json   # vue d'ensemble, segments, base
npx -y rea-agents@latest decompile <bin> 0x00100000 --provider ghidra     # pseudo-code d'une fonction
npx -y rea-agents@latest function  <bin> 0x00100000 --provider ghidra     # fiche complète : pseudo-code, appels, preuves
npx -y rea-agents@latest instructions <bin> 0x00100000 --provider ghidra  # assembleur seul
npx -y rea-agents@latest search    <bin> "a/0/" --provider ghidra                 # chaînes (défaut --kind strings)
npx -y rea-agents@latest search    <bin> "^FUN_" --kind procedures --mode regex   # symboles et fonctions
npx -y rea-agents@latest xrefs     <bin> 0x00123456 --provider ghidra     # qui référence cette adresse
npx -y rea-agents@latest trace     <bin> "romfs" --provider ghidra        # suit un texte à travers les références
npx -y rea-agents@latest address-to-file-offset <bin> 0x00123456          # adresse → position dans le fichier
```

Avec `--snapshot <fichier>`, un résultat est réutilisé tant que la cible et les réglages ne changent pas. Sans cette option, chaque commande refait l'import et l'analyse.

## 6. Limites

- Windows : uniquement des PE x86/x64, et en **lecture seule** (pas de renommage). Linux et macOS permettent de renommer une fonction ou d'ajouter un commentaire d'entrée, mais seulement dans la base temporaire.
- Rien n'est écrit dans notre projet Ghidra, et l'état de l'interface Ghidra lui est invisible.
- La recherche de chaînes ne voit que les chaînes que Ghidra a définies. Un résultat vide ne prouve pas qu'un texte est absent.
- Un premier import lourd peut dépasser le délai de Claude Code ; monter `REA_GHIDRA_STARTUP_TIMEOUT_MS`.
- Le mode brut (sur `main`) n'accepte ni Thumb seul, ni big-endian, et impose `ARM:LE:32:v7`.
- Une idée **à confirmer** pour lui transmettre nos noms : exporter depuis notre projet un TSV `adresse<TAB>function<TAB>nom` et le passer par `REA_GHIDRA_SEED_FILE`.

## 7. Vérifier qu'il marche

```powershell
$env:GHIDRA_INSTALL_DIR = "C:\Users\krisr\Documents\RandomProjects\decompil-3ds\local\outils\ghidra"
npx -y rea-agents@latest doctor --provider ghidra --format json   # lecture seule
npx -y rea-agents@latest mcp doctor                               # le serveur MCP démarre et liste ses outils
```

Puis dans Claude Code, après redémarrage : `/mcp` doit montrer `rea` connecté.

## 8. Exemple de demande à Claude Code (une fois REA branché et la cible acceptée)

```text
Avec REA (fournisseur ghidra), ouvre local/extrait/exefs/code.elf (code.bin de Pokémon X
chargé à 0x00100000, ARM v6). Trouve la fonction qui ouvre un fichier du romfs : pars des
chaînes « rom: » et « a/0/ », remonte les références croisées jusqu'à l'appel IPC
FS:OpenFile (en-tête 0x080201C2), et donne son adresse, son pseudo-code et la preuve de
chaque étape. Ne renomme rien.
```
