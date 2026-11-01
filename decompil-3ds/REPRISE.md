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

Fait le 1/11 après un plantage de l'utilisateur (saut vers `0x4cf5e0`, un opcode de l'interpréteur de scripts sans entrée) : toute adresse citée par un pointeur a son entrée (`recomp.cited_addresses`, +2 568 sur `code.bin`), sans changer le code déjà traduit ; rejeu du plantage passé, 25 s toujours identiques, six robots de 25 min sans arrêt. Les robots « bataille » n'ont pas lancé de combat, mais voir plus bas pour les combats à plusieurs.

Audit du PICA contre Azahar (`local/analyse/pica-audit/`) : corrigés, dans le moteur et, sauf mention, dans le banc : tables d'éclairage en signe et grandeur ; shader de géométrie sur le processeur (`pica/src/geometry.rs`, moteur seul, le banc l'avait) ; quaternions opposés d'un triangle (moteur seul : dessin sans indices, le programme tourne aussi pour le premier sommet) ; couleur de sommet absolue et saturée, attributs non écrits à 1 (moteur seul) ; transferts linéaire vers tuiles ; sources 1 et 2 sans éclairage à zéro ; `ADD_MULT` saturé ; ciseau compté depuis le bas (moteur seul). Vérifié à l'œil sur un combat, sans image de référence : aucune comparaison à une vraie console. Non faits, relevés dans le rapport : filtre de réduction et mipmaps, mode ombre et gaz, textures cubiques et d'ombre, texture procédurale, tampon W, plan de coupe : `runtime run --dessiner` les note s'ils servent ; aucun n'est sorti sur les parties jouées. « texture 0 introuvable » (200/s au champ) est une adresse nulle, lue en noir transparent comme Azahar : un de ses deux chemins rend l'alpha à 255, à trancher si un défaut s'y rattache.

Effets de combat (retour de l'utilisateur, 1/11) : les bits de SETEMIT étaient faux dans le banc et le moteur (bit 22 sens inverse, bit 23 primitive, bits 24-25 sommet : `shader_bytecode.h` de nihstro), les particules perdaient un triangle sur deux ou plus. Rugissement a son onde et la baisse de stat ses particules à l'image ; statuts, soins et Nitrocharge ne sont pas revus à l'œil. En haute définition, les modèles 3D lissent les textures au plus proche quand elles se répètent sur les deux axes (les décors, en morceaux bord à bord, feraient des coutures), et, quand ils sont opaques et découpés par « alpha > 0 », décident de la forme par la part de voisins non nuls, sans jeter les alphas faibles (`sample_unit`) : une découpe à mi-hauteur coupait Reptincelle en travers, vu réglé en jeu par l'utilisateur. Aucun rejeu de ce Pokémon n'existe (le journal de sa partie du 1/11 a divergé au rejeu, cause non cherchée : sans doute l'heure réelle ou la sauvegarde, qu'un rejeu ne reprend pas).

Contours (1/11) : le jeu les calcule en lisant son tampon de profondeur ; la conversion se faisait à la définition de la console, d'où les marches autour des flammes et du joueur : elle se fait à l'échelle, sans lissage. En combat, l'écran du bas suit l'appli ouverte (`battle_screen`, champs de `local/analyse/DllBattle/notes.md`) : caché s'il n'y a rien à toucher, seuls les deux boutons pour une question. La question « Oublier une capacité » est bien `app::YesNo`, vue en jeu par l'utilisateur ; ses boutons sont au-dessus de la boîte de dialogue. La liste d'oubli (`+0x26C`) et `BtlvUiPokeSelect` (`+0x1B3`) ramènent l'écran. Échap reste le recours pour tout autre écran.

Combats à plusieurs (1/11) : l'utilisateur a vu un Pokémon caché par l'interface en double. Essai par mods de `local/analyse/rendu/mods-test` : le dresseur 86 (Patxi) de `a/0/3/8` a son octet 2 (type de combat, 0 simple, 1 double, 2 triple, 3 rotation, répartition 719/31/18/16 sur 784) et son octet 3 (nombre de Pokémon) changés, trois Pokémon dans `a/0/4/0`, rejoués depuis la partie du 1/11. Double et triple gagnés jusqu'à l'évolution, rotation jouée 400 s sans arrêt : aucun plantage (à la touche A, donc pas tous les écrans ; 1 contre 5 et combats à quatre joueurs non essayés). L'octet `+0xA1` des objets d'interface donne la règle (relevé à 40 et 60 s sur les quatre combats). Quand elle n'est pas nulle, le menu et la colonne passent à 88 points de large (`Layout::SmallCorner` et `SmallMoves`). Une bande à côté de l'image a été essayée et écartée par l'utilisateur, qui a relevé une zone libre d'environ 104 x 171 en bas à droite, sur une caméra rapprochée ; caméra au repos, 104 points cachaient le Pokémon de droite et l'ennemi de droite, d'où 88. Les rectangles des capacités valent aussi dans ces combats, et les boutons de plus (Déplacer, flèches de rotation) sont dans le bas de cet écran. Les boutons d'une question gardent leur place : ils peuvent couvrir le Pokémon de droite le temps de répondre.

Tranché par l'utilisateur : les points noirs sur les boutons de combat sont une animation passagère, et les deux arcs sur la tête de Tarsal font partie du modèle. Rien à corriger.

Connu et non réglé : l'upscale n'a pas xBRZ (GPL) ; réseau, caméra et micro sont factices.

Pour enquêter sans l'utilisateur : le journal de `portage play` garde toujours ses entrées ; `runtime run --rejouer JOURNAL` refait la partie à l'identique, sans fenêtre et deux à trois fois plus vite, et `portage play --rejouer` la refait dans la fenêtre (avec `--aller-a S`, la fenêtre reste cachée jusqu'à cette heure du jeu, atteinte à pleine vitesse : pour montrer un moment à l'utilisateur, sans qu'une touche dérègle le rejeu). Une partie reprise dépend de son heure de départ à la milliseconde, de son mod et de sa sauvegarde : le journal note les deux premiers, `depart/` à côté de lui garde les archives du lancement, et le rejeu reprend le tout (`journal.txt` et `depart/` sont écrasés au lancement suivant : les copier pour garder une partie). Vérifié sur 15 s en fenêtre, tout le journal identique. La partie du 1/11 de l'utilisateur (`local/analyse/rendu/partie-1911`, deux combats et l'évolution en Reptincelle) est reprise avec une heure retrouvée par balayage : ses 400 000 lignes détaillées (108 s) sont identiques, et le rejeu atteint bien le second combat et l'évolution à la fin ; le journal limite ses lignes, le reste n'est pas comparé ligne à ligne. Après un changement de fichier du jeu : `recomp.py gen`, `cro_recomp.py gen`, `validate.py build --host` (moins d'une minute), et vérifier que la construction n'a pas échoué. Toute adresse notée à la main dans `local/recomp/trous.txt` reste pour les générations suivantes : `trous.txt` ne doit garder que des adresses vraiment atteintes.

À faire, sans urgence (décidé par l'utilisateur) : viser à la souris avec Otto Focus. La scène se vise en penchant la console ; `hid` écrit pour l'instant une console à plat et immobile (`crates/services/src/small.rs`). L'idée est que le mouvement de la souris devienne celui du gyroscope, avec le coefficient que le jeu demande déjà au service (14,375 unités par degré par seconde).

Demandé par l'utilisateur pour la montée en résolution : toutes les techniques d'upscale des émulateurs comme Citra, réglables dans le launcher. Liste à vérifier dans leur code le moment venu : échelle de rendu interne (1x à 4x, déjà là), filtres de texture (Anime4K, bicubique, ScaleForce, xBRZ, MMPX), filtrage linéaire ou au plus proche à l'affichage, shaders de post-traitement, packs de textures personnalisées.

État de la console à la pause (24/10) : 19 839 fonctions nommées et relues sur 254 369. Toutes les applets ont un premier lot relu ; secondes passes relues et versées pour kernel9 et arm9loader. Outils du 21 au 24/10 : `ipc_trace` écrit après chaque module et ne cherche les ouvertures que dans les fonctions qui peuvent écrire les places (1 s au lieu d'une heure, `--full` garde l'ancien balayage ; lancer un processus par module, la passe complète dans un seul processus finit par planter dans unicorn) ; `ghidra_direct.find_pointers` filtre les cibles ARM des tables de distances ; swkbd-safe a le même code.bin que swkbd (`fiches/safe.md`).

Décidé par l'utilisateur le 24/10 : `hardware_timer_unregister_event` (kernel9) et `hardware_timer_cancel_event` (kernel11) gardent chacun leur nom, pas d'unification.

La passe `ipc_trace` complète (25/10, résultats dans `local/analyse/ipc_trace/`) donne 1 317 envois TRACED sur 2 955. Ils ne sont pas versés : c'est un lot tout prêt si la console reprend. Sur les 61 envois déjà versés, 5 ne sont plus TRACED, et la trace n'y est pour rien : ce sont les règles de verdict qui se sont durcies. cecd:s a un préfixe étranger ; pour cam:q, rien ne prouve que l'aiguillage soit le même que chez ses frères.

À vérifier par l'utilisateur en jouant (1/11) : le son, à l'oreille (stéréo, musique du combat, volume) ; le launcher, à l'œil, puis Jouer ; un clic sur une capacité dans la colonne ; le plein écran F11 ; Shift au clavier ; un vrai combat de dresseur et un combat double ; sauvegarder avec Rapport puis relancer ; l'intro du titre en laissant 70 s ; les filtres de texture à l'échelle 4 ; une scène au stylet (boîte PC, Poké Récré).

Archipelago (1/11) : preuve de bout en bout avec le serveur officiel 0.6.9 (`archipelago/docs/dev/progress.md`, `fiches/pokemon-x-archipelago.md`) : le monde `archipelago/apworld/pokemon_x` n'est qu'un essai à trois contrôles. Pour l'essai : Python 3.13 (`py -3.13`), `SKIP_REQUIREMENTS_UPDATE=1`, `Generate.py`, `MultiServer.py`, puis `runtime run --archipelago ws://127.0.0.1:38281 --joueur Kris`.

Décisions en attente de l'utilisateur pour Pokémon X : quels contrôles, quels objets de progression et quel objectif pour Archipelago ; les 876 noms de natifs en moyenne (`local/analyse/natifs/`) : le relecteur propose qu'un nom `amx_<Natif>` entre en haute comme un export, puisqu'il dit seulement « enregistré sous ce nom », sans s'étendre aux fonctions appelées ; plusieurs natifs de code identique gardent chacun leur nom (`CommandNOP`, `DuelingDump_nop`…) : `fiches/README.md` ne couvre pas ce cas .

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
