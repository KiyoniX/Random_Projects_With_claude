# Reprendre le chantier sur une autre machine

Ce fichier s'adresse à la session Claude Code qui reprend `decompil-3ds` sur le PC fixe de l'utilisateur, après la journée du 16 octobre 2026 faite sur son portable. La mémoire de travail de Claude reste sur la machine où elle a été écrite : tout ce qu'il faut savoir est donc ici, dans `etat.json` et dans les README.

## 1. Le code : `git pull`

Tout ce qui est versionné est sur `main` (commit `00fb221` et suivants). Ce qui ne l'est pas, c'est `decompil-3ds/local/` (le dump du jeu et de la console, les extraits, les outils déballés, les sorties générées). Il ne doit **jamais** entrer dans git, ni être distribué.

## 2. Remonter `local/` à partir des zips

L'utilisateur transfère `local/` en plusieurs zips de 950 Mo au plus, faits sur le portable par `python outils/pack_local.py` :
- `decompil-local-001.zip`, `decompil-local-002.zip`… ;
- `manifeste.json`, qui donne le SHA-256 de chaque fichier ;
- `reassembler.py` (le même que `outils/reassembler.py`).

Les trois fichiers de plus de 900 Mo (`dump/nand.bin`, `dump/pokemon-x.cxi`, `extrait/romfs/a/0/0/7`) sont coupés en morceaux `.part001`, `.part002`…

1. Mettre **tous** les zips, `manifeste.json` et `reassembler.py` dans un même dossier.
2. Lancer `python reassembler.py <chemin du dépôt>\decompil-3ds`. Le script extrait tout dans `decompil-3ds/local/`, recolle les morceaux, les efface, puis vérifie la taille et le SHA-256 de chaque fichier. Il doit finir par « N fichiers vérifiés, 0 erreurs ». S'il signale une erreur, un zip manque ou est abîmé : le redemander.

Ce que contiennent les zips : `dump`, `extrait`, `outils` (Ghidra 12.1.4, llvm-mingw, ctrtool, makerom, scripts Ghidra 3DS), `telechargements`, `pylib` (pyctr, unicorn, capstone, pycryptodomex), `sd`, `sauvegarde-sd`, `mods-build`, `recomp/trous.txt` et `trous-cro.txt`, et les captures du GPU (`analyse/pica/*.pkl`, `analyse/terrain/rec2/`, `portage/captures`).

Ce qui n'y est pas, parce que ça se refait : `portage/target*`, le reste de `analyse/` et le code recompilé (`local/recomp/jeu/`).

## 3. Installer ce qui n'est pas dans `local/`

- **Python 3.12** avec `numpy`, `capstone`, `unicorn` (2.1.x), `pillow`. Les outils trouvent aussi `pyctr` et les autres dans `local/pylib/`.
- **Rust** (1.94 ou plus récent, cible MSVC) pour `portage/`. Le rendu force le backend **Vulkan** : il faut un pilote Vulkan (`vulkaninfo --summary`).
- **Node.js** pour les tests de `carte-des-services/` (`node tests.js`, `node corrections.js --check`).
- Facultatif :
  - **devkitPro** (`C:\devkitPro`, paquet 3ds-dev). Son installateur ne marche pas en silencieux. Pour compiler, lancer `C:\devkitPro\msys2\usr\bin\bash.exe -l <script>` avec le script dans un fichier.
  - **WSL Ubuntu** avec Ghidra dans `/opt/ghidra` pour le serveur MCP `rea-wsl` (REA, paquet npm `rea-agents`). Voir `outils/REA.md`. Les outils `outils/ghidra_direct.py` et `outils/emulate_dispatch.py` n'en ont pas besoin : ils utilisent le Ghidra de `local/outils/`.

## 4. Régénérer ce qui se refait

Depuis `decompil-3ds/` :

```
python outils/verifier.py                              # mesure l'état, réécrit etat.js
python outils/ghidra_direct.py maj                     # seulement si local/analyse/maj/gh/funcs.tsv manque (zips d'avant le 16/10 au soir)
python recomp/recomp.py gen --out local/recomp/jeu     # code.bin en C (relit local/recomp/trous.txt)
python recomp/cro_recomp.py gen                        # les 133 modules .cro en C relogeable
python recomp/validate.py build --host                 # jeu-hote.dll (environ 214 Mo)
python recomp/validate.py build --logw                 # jeu-journal.dll, pour --cpu verifier
cd portage && cargo build --release && cargo test      # le portage Rust
cd .. && python outils/tests.py                        # tous les tests Python (lecteurs, banc, recomp, mods)
```

Vérification rapide que tout marche :
- `python banc/run.py --secondes 3 --cpu hybride` doit atteindre P5 ;
- `portage/target/release/runtime run --seconds 3` puis `runtime compare` contre le journal du banc doit dire « aucun écart » ;
- `portage/target/release/portage replay local/portage/captures/terrain2.picacap --scale 2` doit écrire le palais Chaydeuvre en PNG.

## 5. Où on en est, et quoi faire ensuite

La source de vérité est **`etat.json`** (page `index.html`, ou `python outils/tableau.py --suivre`).

**Changement de cap du 25/10/2026 : la décompilation de la console est en pause.** Les trois travaux en cours sont finis (passe `ipc_trace` sur tous les modules, relecture de la seconde passe de boot9/boot11, seconde passe de process9 : 20 112 fonctions nommées et relues). Tout le travail porte maintenant sur **Pokémon X seul** :
1. le reverse du jeu (`code.bin` de la mise à jour et les 133 `.cro`), en lui reportant par empreinte les noms relus de la console ;
2. le portage natif sur PC (runtime Rust + wgpu déjà jouable jusqu'au palais) ;
3. un launcher, sur le modèle de Dusklight (le launcher de Zelda Twilight Princess) : réglages, choix d'interface, mods ;
4. la montée en résolution, les mods, Archipelago, de nouveaux Pokémon.

Idées d'interface de l'utilisateur, à développer avec lui avant de coder : Échap ouvre le menu de l'écran tactile ; les écrans interactifs (le mini-jeu des ballons…) reçoivent des calques pour jouer à la souris ; en combat, interface moderne (menus sur les côtés) ou à l'ancienne (menus en bas), au choix dans le launcher.

Décidé par l'utilisateur : Échap affiche l'écran du bas par-dessus le jeu, et cet écran n'est pas visible le reste du temps ; le launcher est une application à part, qui lance le jeu.

Fait et joué par l'utilisateur (31/10) : Échap et le stylet à la souris ; le menu ouvert bloque les déplacements ; Shift fait de la croix du clavier le pad circulaire ; en combat, l'écran du bas reste dans le coin en bas à droite (son dessin : les capacités empilées à droite, pas encore fait, il faut savoir quand l'écran des capacités est affiché) ; le launcher (`crates/launcher`) ; la partie gardée d'un lancement à l'autre (`local/analyse/runtime/play/archives/`). Écrans vus sans plantage : CT, photo d'Otto Focus, Pokédex, sac, équipe, Rapport, Options, Super Training, carte, combats sauvages jusqu'à la montée de niveau, les nouvelles capacités et l'évolution.

Fait sans l'utilisateur (1/11), à lui faire écouter ou vérifier : le son (voix du DSP mixées, PCM, ADPCM et AAC par symphonia, sortie cpal ; `runtime --son` écrit un WAV ; mesuré, pas écouté) ; la colonne des capacités en combat, reconnue dans l'image ; l'heure réelle en jeu ; les filtres de texture (Scale2x, MMPX, bicubique), les packs de textures (`--extraire-textures`, `--textures`), le lissage, F11. Causes trouvées et corrigées : l'état des voix n'avançait pas et l'AAC ne disait rien consommer (blocages CT et montée de niveau) ; `hid` n'écrivait pas gyroscope et accéléromètre (Otto Focus) ; `ExitThread` ne rendait pas les mutex (kernel11 `0xFFF132A0`, blocage de l'intro du titre). La sauvegarde s'écrit et revient au lancement suivant (vérifié par `runtime --garder-sauvegarde`).

Connu et non réglé : l'upscale n'a pas encore Anime4K, xBRZ (GPL) ni ScaleForce ; réseau, caméra et micro sont factices.

Pour enquêter sans l'utilisateur : le journal de `portage play` garde toujours ses entrées ; `runtime run --rejouer JOURNAL` refait la partie à l'identique, sans fenêtre et deux à trois fois plus vite, et `portage play --rejouer` la refait dans la fenêtre. Après un changement de fichier du jeu : `recomp.py gen`, `cro_recomp.py gen`, `validate.py build --host` (moins d'une minute), et vérifier que la construction n'a pas échoué. Toute adresse notée à la main dans `local/recomp/trous.txt` reste pour les générations suivantes : `trous.txt` ne doit garder que des adresses vraiment atteintes.

À faire, sans urgence (décidé par l'utilisateur) : viser à la souris avec Otto Focus. La scène se vise en penchant la console ; `hid` écrit pour l'instant une console à plat et immobile (`crates/services/src/small.rs`). L'idée est que le mouvement de la souris devienne celui du gyroscope, avec le coefficient que le jeu demande déjà au service (14,375 unités par degré par seconde).

Demandé par l'utilisateur pour la montée en résolution : toutes les techniques d'upscale des émulateurs comme Citra, réglables dans le launcher. Liste à vérifier dans leur code le moment venu : échelle de rendu interne (1x à 4x, déjà là), filtres de texture (Anime4K, bicubique, ScaleForce, xBRZ, MMPX), filtrage linéaire ou au plus proche à l'affichage, shaders de post-traitement, packs de textures personnalisées.

État de la console à la pause (24/10) : 19 839 fonctions nommées et relues sur 254 369. Toutes les applets ont un premier lot relu ; secondes passes relues et versées pour kernel9 et arm9loader. Outils du 21 au 24/10 : `ipc_trace` écrit après chaque module et ne cherche les ouvertures que dans les fonctions qui peuvent écrire les places (1 s au lieu d'une heure, `--full` garde l'ancien balayage ; lancer un processus par module, la passe complète dans un seul processus finit par planter dans unicorn) ; `ghidra_direct.find_pointers` filtre les cibles ARM des tables de distances ; swkbd-safe a le même code.bin que swkbd (`fiches/safe.md`).

Décidé par l'utilisateur le 24/10 : `hardware_timer_unregister_event` (kernel9) et `hardware_timer_cancel_event` (kernel11) gardent chacun leur nom, pas d'unification.

La passe `ipc_trace` complète (25/10, résultats dans `local/analyse/ipc_trace/`) donne 1 317 envois TRACED sur 2 955. Ils ne sont pas versés : c'est un lot tout prêt si la console reprend. Sur les 61 envois déjà versés, 5 ne sont plus TRACED, et la trace n'y est pour rien : ce sont les règles de verdict qui se sont durcies. cecd:s a un préfixe étranger ; pour cam:q, rien ne prouve que l'aiguillage soit le même que chez ses frères.

Décisions en attente de l'utilisateur : la couche FAT de process9 est celle d'ERTFS, ligne pour ligne : reprendre ses noms (`pc_isadir`, `pc_cl2sector`…) ? ; le bit 0 de SHA_CNT, dont le sens diverge selon la source, demande un essai sur le banc avant de nommer `sha_engine_not_busy` ; `mpu_disable` et `mmu_disable`, exception à la règle 2 ? ; convention `gsp_write_hw_regs` (le nom du jeu, reporté dans swkbd) ou `GSPGPU_WriteHWRegs` (errdisp, error) ; `fs_close_archive` et `httpc_close_context` (forme de destructeur de table) contre l'alignement sur `file_close_handle` ; `ndm_u_open` (Thumb) et `ndm_open_session` (ARM), deux codes ; même code sous deux noms : `dsp_*` / `nndsp_*`, `srv_enable_notification` / `get_notification_semaphore` ; la Carte donne LoadExeCRO à ldr:ro 0x000902C2 (3dbrew affiche LoadCRO_New : l'extraction a pris la cible du lien), défaut peut-être plus large ; `cfg_get_debug_flag` pour ir 0x108750 (et le sens du bit d'ENVINFO dans ir.md) ; noms de fichiers du romfs dans les fiches (retirés en attendant) ; `GPIOIR_GetData` ou `GetGPIOData` ; les 53 gestionnaires nommés par leur seul numéro (`local/analyse/renommages/gestionnaires.tsv`) ; verser en haute les 37 envois par numéro (`local/analyse/ipc_trace/decision-cmd.json`) ; cam:q et cecd:s prouvés par la table d'aiguillage de la fiche plutôt que la Carte ; `icache_prefetch_range` (boot11, sens de c7,c13,1 à relire dans le manuel ARM) ; réécrire l'historique pour les anciens Co-Authored-By.

## 6. Les directives de l'utilisateur (elles étaient dans la mémoire du portable)

- **Le but, en trois parties** (la première est en pause depuis le 25/10, voir §5) : la 3DS décompilée à 100 % ; Pokémon X porté nativement sur PC, mieux rendu et plus rapide ; un moteur de mods pour des romhacks et des fangames. Chaque mod doit tourner à la fois sur la console (LayeredFS de Luma) et sur le PC.
- **Le portage PC est en Rust + wgpu sous Vulkan.** Le banc Python reste l'outil d'enquête et la référence : chaque morceau Rust est vérifié contre lui. Le portage ne lit les mods que par la sortie `mods/build.py --pc` (`overlay.json`, format 1).
- **Identifiants en anglais** (variables, fonctions, noms donnés en reverse, nouveaux fichiers de code). **Textes pour l'utilisateur en français** (commentaires, fiches, messages, commits).
- **Sous-agents** (directive du 16/10 au soir, qui remplace l'ancienne « sonnet par défaut ») : Opus à l'effort maximal par défaut, Sonnet pour la recherche documentaire, Haiku pour les tâches mécaniques bien cadrées, Fable seulement si la tâche l'exige. Les agents sont définis dans `.claude/agents/` et les règles de qualité (KISS, pas de répétition, « comment un pro ferait ») dans `CLAUDE.md` à la racine. Peu d'agents à la fois. Préparer soi-même ce qui est partagé, donner à chacun un périmètre de fichiers, et vérifier ses résultats dans les octets avant de les intégrer : rejouer une table par `emulate_dispatch.py`, regarder les images, relancer les tests. Les briefs donnés le 16/10 reprenaient les règles de ce fichier.
- **Commits** : seulement à la fin d'un gros jalon. Ne pousser que si l'utilisateur le demande. Messages en français. Avant de pousser, faire `git fetch` : l'utilisateur travaille sur deux PC.
- **Continuer sans attendre** : si toutes les tâches sont finies et que l'utilisateur ne répond pas, enchaîner de soi-même sur le chantier suivant de `etat.json`. Les décisions qui lui reviennent restent en attente dans le rapport, sans bloquer le reste.
- **Jamais dans un fichier versionné** : un octet du jeu ou de la console, une clé, un OTP, un certificat, un identifiant de console. Les tests versionnés fabriquent leurs données.
- **Chaque fiche** sépare ce qui est sûr (deux voies indépendantes), ce qui est interprété, et ce qui n'est pas lu.
- **Pièges connus** :
  - un heredoc Bash qui contient du Python perd ses barres obliques inverses : écrire les scripts avec l'outil Write ;
  - `3dbrew.org` peut être bloqué par le pare-feu : passer par `web.archive.org` ;
  - le port USB de la console ne fait que charger : les échanges passent par ftpd sur la console, piloté par `curl` (l'adresse IP change d'un jour à l'autre).
