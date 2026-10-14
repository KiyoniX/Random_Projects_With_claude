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

Ce que six modules ont appris (sm, hid, loader, pm, gsp, fs) :

- **`prescan.py <module> --dump`** range le pseudo-code de toutes les fonctions (`local/analyse/<module>/pseudo/`) et l'assembleur du module (`code.asm`, par l'objdump de devkitPro). Le pseudo-code de Ghidra perd les registres autour d'un `svc` écrit sur place : la poignée d'une requête, les arguments de `ControlMemory` ou de `CreateCodeSet` se lisent dans l'assembleur. Pour un module du FIRM, seul `.text` y est à la bonne adresse (les sections sont serrées).
- **Le Thumb.** Une graine `function` est toujours désassemblée en ARM. Pour nommer une fonction Thumb, écrire une ligne `label` au lieu de `function` : quand Ghidra crée la fonction, elle prend le nom. Si le nom ne prend pas quand même (`run_static_initializers` dans plusieurs modules), le noter dans la fiche et le poser à la main. prescan ne suit pas les pointeurs impairs, il les compte seulement.
- **Les modules en Thumb (`fs`, `cfg`, `ptm`) ne passent pas par le pont.** REA n'y voit qu'une partie des fonctions (1 637 sur 1 995 dans `fs`) et prescan annonce « aucune fonction manquée » ; quand il reconnaît le cas, il donne les deux commandes à lancer à la place :

```powershell
python outils/ghidra_direct.py cfg                                    # Ghidra sans REA, sous Ubuntu : une minute
python outils/emulate_dispatch.py cfg 0x107d40=cfg:u 0x106db4=cfg:s   # la table des commandes de chaque aiguillage
```

  `ghidra_direct.py` pose les graines Thumb (pointeurs impairs, table de distances), écarte les nombres qui ressemblent à des pointeurs, reconnaît à son code l'aide de « switch » `__ARM_common_switch8`, lui donne le réglage Call Fixup `switch8_r3` et impose les tables de saut, applique `fiches/<module>.noms.tsv` après l'analyse, puis range dans `local/analyse/<module>/gh/` la liste des fonctions (`funcs.tsv`), le pseudo-code (`pseudo/`) et le projet Ghidra. Ses scripts Ghidra sont dans `outils/ghidra_scripts/`. `emulate_dispatch.py` exécute un aiguillage pour chaque numéro de commande et rend la fonction appelée, l'en-tête de réponse et ce que le code vérifie de l'en-tête de requête ; il marche aussi sur un module ARM, et sa docstring dit ce que l'émulation suppose. Il lui faut `unicorn` et `capstone` dans `local/pylib/` : `python -m pip install --target local/pylib unicorn capstone`. Mesuré le 2026-10-14 : `ptm` 813 fonctions (comme sa fiche), `cfg` 689 (686 dans sa fiche), et les 239 lignes des tables de commandes de `cfg`, `ptm` et `hid` retrouvées à l'identique.
- **Ne pas se fier aux tailles de fonctions de Ghidra** : il ne compte pas les tables d'adresses posées au milieu du code.
- **Un début de fonction se cherche parfois à la main** : une fonction qui ne revient jamais ne sauve aucun registre, et prescan ne la reconnaît pas. Il signale alors « appel système hors de toute fonction ».

## 4 ter. Ce qui n'est pas un module : l'image brute (depuis le 2026-10-14)

boot9, boot11, kernel11, kernel9, Process9 et le chargeur ARM9 n'ont ni `code.bin` à `0x00100000` ni exheader qui découpe le code (sauf Process9, qui est rangé dans le FIRM). Ni le pont REA ni `ghidra_direct.py` ne les ouvrent tels quels. Trois chaînes avaient été écrites à part, une par fiche ; elles sont réunies dans `outils/` :

```powershell
python outils/firm.py local/dump/systeme/native.firm   # sections, modules de démarrage, arm9/ et kernel11/kernel11.elf
python outils/firm.py map 0 1 2 3                      # carte virtuelle de kernel11 (unicorn), morceaux vérifiés
python outils/ghidra_raw.py list                       # les cibles préréglées, et si leur fichier est là
python outils/ghidra_raw.py boot9                      # puis boot11, kernel11, kernel9, process9, arm9loader
python outils/svc_check.py                             # les svc des fiches contre kernel11 et les exheaders
```

- **`firm.py`** lit l'en-tête du FIRM lui-même (empreintes SHA-256 vérifiées, sans ctrtool) et écrit dans `local/extrait/firm/` : les sections `firm_<n>_<adresse>.bin`, les modules de démarrage en `.cxi`, `arm9/kernel9.bin`, `arm9/process9/exefs/code.bin` et son `exheader.bin` (rangés comme un module extrait), `arm9/arm9loader.bin`, et `kernel11/kernel11.elf`. Les 0x800 octets de l'en-tête du binaire ARM9 (champs de clés) ne sont recopiés nulle part. `extraire.py native.firm firm` l'appelle après ctrtool. Pour kernel11, la carte des morceaux (adresse virtuelle, place dans la section, adresse physique où le démarrage les recopie) est dans `raw_targets.toml` ; `firm.py map` exécute sous unicorn le constructeur des tables de pages (`0x1FFAF5A4`), décode les tables et vérifie chaque morceau. Si le point d'entrée ARM11 du FIRM n'est pas celui de la carte, il n'écrit pas l'ELF : la carte est à relire.
- **`ghidra_raw.py <cible>`** prend tout dans **`outils/raw_targets.toml`**, un fichier commenté : fichier d'entrée, format (`raw`, `elf`, ou `code` pour un `code.bin` avec exheader), adresse de base, langage (`v5t` pour l'ARM9, `v6` pour l'ARM11), plages de code, graines données à la main avec leur raison, tables lues à la main (table des svc, table des constructeurs), fichier de noms. Il réutilise de `ghidra_direct.py` la recherche des pointeurs (`Image`, `find_pointers`), des aides de switch et le lancement de Ghidra (`run_headless`), et range dans `local/analyse/<cible>/gh/` les mêmes fichiers, plus l'assembleur (`asm/0xADRESSE.s`, `listing.txt`). Pour un essai : `ghidra_raw.py kernel9 --name essai --code 0x...-0x...,...` (le dossier change, la cible préréglée reste), ou `ghidra_raw.py --image <fichier> --base 0x... --language v5t --code ... --seeds graines.tsv --names noms.tsv`.
- **Deux scripts Ghidra de plus** dans `outils/ghidra_scripts/` : `MarkDataBlocks.java`, avant l'analyse, fait de chaque plage qui n'est pas du code un bloc non exécutable (sans cela, 1 255 fausses fonctions Thumb dans les zéros de kernel9, et la recherche des trous irait jusqu'aux clés de boot9) ; `DumpListing.java`, après, écrit l'assembleur, sans jamais lire un bloc de données.
- **`svc_check.py`** recoupe les svc cités par chaque fiche de module, et ceux du code de Pokémon X, avec la table des svc de kernel11 (présents, pas une souche « non implémenté »), avec les noms de 3dbrew recopiés dans `fiches/kernel11.md`, et avec le masque des svc de l'exheader. `tests.py` le lance quand `kernel11.elf` et les exheaders sont là.

Revalidation du 2026-10-14, chaque cible relancée avec ces outils et les `.noms.tsv` des fiches :

| Cible | Fonctions au premier passage | Fonctions obtenues | Noms posés | Noms sans fonction |
| --- | --- | --- | --- | --- |
| boot9 | 572 | 564 | 258 | 0 |
| boot11 | 229 | 227 | 109 | 0 |
| kernel11 | 988 | 988, les mêmes | 359, et 68 étiquettes | 0 |
| kernel9 | 497 | 497, les mêmes | 46 | 0 |
| Process9 | 4 797 | 4 797, les mêmes | 385 | 0 |
| chargeur ARM9 | 185 | 185, les mêmes | — | — |
| cfg (`ghidra_direct.py`, contrôle du partage de code) | 689 | 689, les mêmes | 440 | 0 |

Les écarts : dans boot9 et boot11, l'aide de switch est la variante à lectures inversées (`0xFFFF0CDC`, `0x0001841C`), que `ghidra_direct.py` ne reconnaissait pas encore lors de la première analyse. Reconnue, ses tables sont imposées et les cas de switch ne sont plus pris pour des fonctions à part : les 8 fonctions de `0xFFFF10B4` à `0xFFFF10D6` rentrent dans `0xFFFF1098`, `0x000184E4` dans `0x000184CC`, `0x000188FC` dans `0x000188E4`. Aucune n'était nommée. Dans kernel11, la 68e étiquette est la ligne `data` de `svc_table`, ajoutée au fichier de noms depuis. Dans kernel9, la seconde plage de code va maintenant jusqu'à `0x0801C080` au lieu de `0x0801B6C0`, qui coupait la fonction `0x0801B6E0` (une fois les données rendues non exécutables, son corps tombait à un octet) ; le compte ne change pas.

Les pièges, en plus de ceux de la partie 4 bis :

- **Le `;` de `-scriptPath`** : `wsl.exe` refait une ligne qu'un shell relit. `run_headless` protège chaque argument ; à la main, mettre des apostrophes autour.
- **La mémoire de Ghidra** se règle par `GHIDRA_HEADLESS_MAXMEM` (lu par `analyzeHeadless`) ; `MAXMEM=3G` seul n'a aucun effet, et le tas reste à 2 Go. `ghidra_raw.py` passe `GHIDRA_HEADLESS_MAXMEM=3G`. Pas plus de deux Ghidra à la fois.
- **Une donnée au milieu du code** (la table des svc de kernel11) s'écrit en ligne `data` dans le fichier de noms : une ligne `label` y créerait une fonction Thumb.
- **Les aiguillages ARM par table de saut** (`ldrlo pc, [pc, r0, lsl #2]`, les commandes de Process9) restent des cas d'une seule fonction : ne pas mettre les cas dans le fichier de noms.

Restent dans `local/analyse/` (propres à une fiche, pas rangés) : les outils de lecture (`tree.py`, `profile.py`, `show.py`, `peek.py`, `xref_value.py`, `q.py`), la lecture des tables de commandes de Process9 (`tables.py`, `services.py`), les générateurs de noms et de tableaux (`build_names.py`, `gen_names.py`, `make_names.py`, `mk_svc_md.py`, `gen_doc.py`), et `survey.py` (l'entropie des mémoires de démarrage, qui a donné leurs plages de code).

## 4 quater. Les titres système tirés de la NAND (depuis le 2026-10-14)

Plus besoin de repasser par GodMode9 pour un module : `outils/nand.py` ouvre sur PC la sauvegarde NAND (`local/dump/nand.bin`), avec `boot9.bin` et la sauvegarde « essentielle » que GodMode9 range dans l'image (OTP et CID). Il faut une fois `python -m pip install --target local/pylib pyctr` : pyctr tire les clés de ces fichiers à l'exécution et déchiffre la CTRNAND ; aucune clé n'est écrite dans l'outil, et tout ce qu'il produit va sous `local/`.

```powershell
python outils/nand.py                       # partitions, puis les 133 titres : identifiant, nom, version, taille
python outils/nand.py titles module         # filtre (ici : les modules système)
python outils/nand.py title ndm errdisp     # NCCH déchiffré dans local/dump/systeme/<nom>.cxi, puis extraire.py
python outils/nand.py config                # sauvegarde de cfg (00010017) et son fichier config
python outils/nand.py file /dbs/title.db    # un fichier de la CTRNAND, dans local/dump/ctrnand/
python outils/nand.py all                   # modules, applets, archives, police, config, et local/extrait/inventaire-nand.txt
python outils/nand.py verify                # comparaison octet pour octet aux .cxi de GodMode9, et au native.firm
python outils/nand.py sd "local/dump/sd/Nintendo 3DS" 0004000000055D00   # sauvegarde et extdata d'un jeu
```

- **Noms** : celui de l'exheader, en minuscules. La version du mode sans échec d'un module (identifiant en `…03`) prend `-safe` (`cfg-safe`) ; celle qui tourne sous NATIVE_FIRM garde le nom nu (sur la New 3DS, `gsp`, `ptm`, `mcu`, `i2c`, `camera`... n'existent qu'en `2000xx02`). Les archives sans exheader sont `data-<bas de l'identifiant>`, sauf celles reconnues par leur contenu (`police-std`, `mii-ressources`, `mots-interdits`, `pays`, `certificats-ca`, `clcerta`, `cver`, `nver`).
- **Rien n'est écrasé** : si `<nom>.cxi` existe avec d'autres octets, la version de la NAND va en `<nom>.nand.cxi` ; `verify` l'écrit toujours à côté pour la comparaison.
- **La police partagée** (`cbf_std.bcfnt`, celle que `ns` charge pour GetSharedFont) est décompressée dans `local/extrait/police-partagee/`.
- **Piège** : sous Git Bash, un chemin qui commence par `/` est réécrit en chemin Windows ; mettre `MSYS_NO_PATHCONV=1`.
- **La sauvegarde d'un jeu** : copier d'abord par ftpd, sous `local/dump/sd/`, le dossier `Nintendo 3DS/<id0>/<id1>/title/<haut>/<bas>/data/` et `extdata/00000000/<bas>/` en gardant l'arborescence. `sd` les déchiffre avec le `movable.sed` **de la CTRNAND** : celui de la sauvegarde « essentielle » de GodMode9 est plus ancien sur cette console et ne donne pas l'id0 de la carte. Il ouvre ensuite le conteneur DISA de la sauvegarde (fichiers dans `sauvegarde/fichiers/`) et les DIFF des données étendues. Vérifié sur Pokémon X : `main` fait `0x65600` octets et ses 55 blocs ont tous leur CRC16-CCITT juste.
- **Piège** : pyctr réécrit, en lisant l'OTP, les clés X des emplacements 0x18 à 0x1B ; les NCCH « New 3DS » (gsp, ptm) en ont besoin intactes. `nand.py` garde donc un second moteur de clés, sans OTP, pour les NCCH.

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
