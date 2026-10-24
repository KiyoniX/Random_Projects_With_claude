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

La source de vérité est **`etat.json`** (page `index.html`, ou `python outils/tableau.py --suivre`). Au soir du 20/10/2026 :
- **Décompilation** : 19 439 fonctions nommées et relues sur 254 501 (7,6 %) ; noyau ARM11 89 %, démarrage et ARM9 23 %, modules système 21 %, applets ~1,5 %, jeu 2,4 %. Seuls les noms haute (deux voies) entrent dans `fiches/*.noms.tsv` ; versement par `python outils/verser.py <decision.json>` (option `promote` quand la relecture apporte la seconde voie, liste d'objets par module pour plusieurs fichiers).
- **Fait le 20/10** : 61 envois IPC promus après relecture d'ipc_trace ; 341 renommages relus (format `_cmd_0xNNNN`, jumeaux -safe, harmonisations, `wcs*`, SPI::NOR et pxi:mc nommés par la Carte) ; fiches .md de error, swkbd, extrapad, memolib ; premiers lots des applets menu, mint, friend, snote_ap, newslist, cherry (`local/analyse/<m>/noms-proposes.tsv`, notes-100.md, fiche-brouillon.md) dont 97 haute non-IPC versées ; audit des `_alt_` (`shared_memory_dtor_unchecked`) ; `couverture.py` refuse la haute si les appelées n'ont pas les mêmes noms versés, sur un émetteur IPC ou sur un nom de rôle (`couverture.py revoir` → `local/analyse/audit-alt/propages-a-revoir.tsv`, 1 745 lignes).
- **ipc_trace.py corrigé** (8 fautes de la relecture + 4 de snote_ap ; surtout : le code du module était réécrit entre deux passages par des écritures fausses, ce qui faussait tous les résultats d'avant). Tests verts. **La passe `all` n'a été refaite que pour 13 modules sur 54 (ac à error)** : `local/analyse/ipc_trace/resultats.tsv` mélange lignes neuves et anciennes.

Prochains chantiers, dans l'ordre :
1. finir la passe ipc_trace (`cd outils ; for m in extrapad friends fs gpio gsp hid http i2c ir loader mcu memolib mic mp mvd ndm news nfc nim ns nwm pdn pm ps ptm pxi qtm ro sm socket spi ssl swkbd snote_ap friend cherry newslist mint menu; do python ipc_trace.py all --only $m; done`, menu > 25 min), comparer à `resultats-avant.tsv` (scratchpad compare.py perdu : refaire), vérifier que les 61 versés tiennent (attendu : news 0x103028 et 2 CAMQ_ changent de verdict, voir le rapport dans le commit) ;
2. relire puis verser les envois IPC haute des six lots d'applets (repassés avec l'outil final), et corriger dans ces lots les fautes systématiques de `local/analyse/relecture-applets-5/relecture.md` (jumeaux comptés sur des appelées non versées, faux `_alt_`, rôles reportés par empreinte, preuves qui citent les adresses du module d'origine) ;
3. traiter `propages-a-revoir.tsv` ; décider si les jumeaux alignés (-safe) échappent aux règles « émetteur IPC » et « nom de rôle » (une ligne dans `twin_grade`) ;
4. les 13 autres applets, puis le noyau, l'ARM9 et les mémoires de démarrage ; ensuite seulement le jeu.

Décidé par l'utilisateur le 24/10 : `hardware_timer_unregister_event` (kernel9) et `hardware_timer_cancel_event` (kernel11) gardent chacun leur nom, pas d'unification.

Décisions en attente de l'utilisateur : `fs_close_archive` et `httpc_close_context` (forme de destructeur de table) contre l'alignement sur `file_close_handle` ; `ndm_u_open` (Thumb) et `ndm_open_session` (ARM), deux codes ; même code sous deux noms : `memclr` (19 fiches) / `memzero` (kernel11, kernel9, arm9loader, process9 ; la seconde passe de kernel9 propose memclr), `dsp_*` / `nndsp_*`, `srv_enable_notification` / `get_notification_semaphore` ; la Carte donne LoadExeCRO à ldr:ro 0x000902C2 (3dbrew affiche LoadCRO_New : l'extraction a pris la cible du lien), défaut peut-être plus large ; `cfg_get_debug_flag` pour ir 0x108750 (et le sens du bit d'ENVINFO dans ir.md) ; noms de fichiers du romfs dans les fiches (retirés en attendant) ; `GPIOIR_GetData` ou `GetGPIOData` ; les 53 gestionnaires nommés par leur seul numéro (`local/analyse/renommages/gestionnaires.tsv`) ; verser en haute les 37 envois par numéro (`local/analyse/ipc_trace/decision-cmd.json`) ; cam:q et cecd:s prouvés par la table d'aiguillage de la fiche plutôt que la Carte ; `icache_prefetch_range` (boot11, sens de c7,c13,1 à relire dans le manuel ARM) ; réécrire l'historique pour les anciens Co-Authored-By.

## 6. Les directives de l'utilisateur (elles étaient dans la mémoire du portable)

- **Le but, en trois parties** : la 3DS décompilée à 100 % ; Pokémon X porté nativement sur PC, mieux rendu et plus rapide ; un moteur de mods pour des romhacks et des fangames. Chaque mod doit tourner à la fois sur la console (LayeredFS de Luma) et sur le PC.
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
