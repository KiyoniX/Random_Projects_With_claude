# La recompilation statique ARM vers C

Le but à terme : faire tourner Pokémon X sur PC sans émulateur de processeur. Aujourd'hui le banc d'essai (`banc/`) exécute le code ARM du jeu sous unicorn. Ce dossier fait le premier pas pour s'en passer : un **recompilateur** qui lit `code.bin` et écrit, pour chaque fonction du jeu, une fonction C équivalente, que le compilateur du PC transforme ensuite en code natif.

Le C produit à partir du code du jeu vient d'un dump personnel : il n'est écrit que dans `local/recomp/` (jamais versionné). Ce dossier-ci ne contient que l'outil, son support d'exécution et ses tests sur du code fabriqué.

## Ce que fait chaque fichier

| Fichier | Rôle |
| --- | --- |
| `recomp.py` | le recompilateur : lit `code.bin` + l'exheader + la liste des fonctions de Ghidra, traduit chaque fonction, écrit les fichiers C (`stats`, `gen`, `test`) |
| `armdec.py` | le décodeur ARM (mode ARM, ARMv6K) : un mot de 32 bits devient des lignes de C |
| `cro_recomp.py` | la même chose pour les 133 modules `.cro` : un C **relogeable**, sans dépendre de l'adresse où `ro` charge le module (voir « Les modules `.cro` ») |
| `thumbdec.py` | le décodeur Thumb (Thumb-1 de l'ARMv6, il n'y a pas d'IT sur l'ARM11) |
| `vfpdec.py` | la VFPv2 : transferts, arithmétique simple et double, comparaisons, conversions |
| `runtime/rt.h`, `runtime/rt.c` | le support d'exécution que le C inclut : l'état du processeur, la mémoire par table de pages, l'aiguillage des appels, les opérations ARM sans équivalent en C |
| `harness.py` | la validation différentielle : compile le C en DLL (clang portable), la charge avec ctypes, la rejoue contre unicorn |
| `validate.py` | la validation sur les fonctions du jeu (`leaf`, `tree`, `retry`, `speed`, `build`) |
| `tests.py` | les tests, sur du code fabriqué (aucun octet du jeu) |

## Les lancer

```
python recomp/recomp.py stats                        # couverture des instructions de tout code.bin
python recomp/recomp.py gen --out local/recomp/jeu   # tout le jeu en C (23 882 fonctions, 61 Mo de C)
python recomp/recomp.py gen --out DIR --only 0x100048,0x1000a0 --asm     # quelques fonctions, avec l'ARM en commentaire
python recomp/cro_recomp.py gen                      # les 133 modules .cro en C, dans local/recomp/jeu (quelques secondes)
python recomp/cro_recomp.py stats [--only A,B]       # fonctions trouvées et couverture, module par module
python recomp/cro_recomp.py bases [--only A,B]       # contrôle : le même module traduit à deux adresses donne le même C
python recomp/tests.py                               # les tests (environ trois minutes)

python recomp/validate.py leaf --n 650 --start 0     # fonctions feuilles : natif contre unicorn
python recomp/validate.py tree --n 2500              # fonctions dont tous les appelés sont recompilés
python recomp/validate.py retry --draws 1500         # rejoue les feuilles qui n'avaient aucune tirée exploitable
python recomp/validate.py speed                      # vitesse du natif contre unicorn
python recomp/validate.py build                      # compile tout le jeu recompilé en une DLL
```

Il faut, dans `local/` (jamais versionné) :
- `local/pylib/` : `unicorn`, `capstone`, `numpy` (le décodeur n'a pas besoin de capstone : il ne sert qu'aux commentaires `--asm`) ;
- `local/outils/llvm-mingw/` : le compilateur C portable, **llvm-mingw 20261006 (clang 23.1.3, ucrt, x86_64)**, déballé depuis la page de versions officielle de `mstorsjo/llvm-mingw`, sans installation système ; `VERSION.txt` y note la version. Il n'y a pas de compilateur hôte sous Windows (devkitARM ne compile que pour ARM) et la distribution Ubuntu de WSL n'a pas de gcc ;
- `local/extrait/maj/exefs/code.bin` et `exheader.bin`, et `local/analyse/maj/gh/funcs.tsv` (la liste des fonctions : début, taille, mode).

Les tests sans dump (`python recomp/tests.py`) n'ont besoin que de unicorn et du compilateur ; sans eux, la partie différentielle est sautée avec un message.

## Comment c'est fait

**Une fonction du jeu devient une fonction C** `void f_00100048(Cpu *c)`. L'état du processeur est une structure (`rt.h`) : `r[16]`, les drapeaux N Z C V Q séparés (chacun 0 ou 1), GE, FPSCR, les registres VFP, le registre du stockage local du fil. À l'intérieur de la fonction, les registres et les drapeaux sont des **variables locales** du C (le compilateur les range dans de vrais registres) ; ils sont rendus à la structure avant chaque appel, retour ou appel système, et relus après.

**La mémoire n'est pas projetée telle quelle** (4 Gio d'adresses de la console). Chaque accès passe par `rd8/rd16/rd32/wr8/wr16/wr32`, qui retrouvent la page de 4 Kio dans une table (adresse >> 12) vers un pointeur du PC, avec un chemin lent pour les accès à cheval sur deux pages. Une page absente de la table est une faute rendue à l'hôte. Deux pages peuvent pointer vers le même bloc : les alias de la console (le miroir des `.cro`, la mémoire partagée) restent possibles, comme dans `banc/memory.py`.

**Le flot de contrôle** :
- les branchements internes deviennent des `goto` vers des étiquettes ; seules les instructions atteignables depuis le début de la fonction sont écrites (les pools de littéraux ne sont donc jamais traduits comme du code) ;
- `bl` vers une fonction recompilée est un appel C direct ; un `b` hors de la fonction est un appel terminal ;
- `bx`/`blx` registre, `ldr pc`, `mov pc` et tout appel dont la cible n'est pas une fonction connue passent par l'**aiguillage** `rt_dispatch(c, adresse)` (recherche dichotomique dans la table générée `table.c`) ; le bit 0 de l'adresse choisit Thumb ou ARM ;
- les tables de sauts (`add pc, pc, rX, lsl #2` suivi de `b`, et `ldrls pc, [pc, rX, lsl #2]` suivi d'adresses) deviennent un `switch` ;
- `bx lr`, `pop {..., pc}`, `ldr pc, [sp], #4` et `mov pc, lr` sont des retours C ;
- Ghidra coupe parfois une fonction avant les blocs d'un `switch` qu'il n'a pas résolu : une cible entre la fin déclarée et la fonction suivante agrandit la fonction ;
- `svc` appelle `rt_svc(c, numéro, pc)`, un rappel vers l'hôte (le noyau en Python, aujourd'hui).

**Rien n'est silencieux** : toute instruction non traduite devient `rt_unimplemented(c, pc)`, qui rend la main à l'hôte avec le code `RT_UNIMPLEMENTED` et l'adresse ; un saut vers une adresse qui n'est pas une fonction recompilée rend `RT_NO_TARGET`. Aucune ne continue en faisant semblant.

**Arrondi de la VFP** : le noyau de la console règle FPSCR à `0x03C00000` (arrondi vers zéro, vidage des dénormaux, NaN par défaut). `rt_call` règle MXCSR du PC d'après le FPSCR de l'état le temps de l'appel et le remet ensuite ; le C est compilé avec `-ffp-contract=off` (pas de multiplication-addition fusionnée : la VFPv2 n'en a pas).

## Ce qui est couvert (mesuré sur tout `code.bin`)

`python recomp/recomp.py stats`, sur les 23 882 fonctions de Ghidra (23 390 ARM, 492 Thumb), en comptant les instructions atteignables depuis le début de chaque fonction :

| | traduit |
| --- | --- |
| ARM | 1 005 148 / 1 005 154 (99,9994 %) |
| Thumb | 14 495 / 14 495 (100 %) |
| dont VFP | 51 320 / 51 325 (99,99 %) |

Les 6 instructions non traduites (appel explicite à `rt_unimplemented`) : 4 instructions de registres `d16`-`d31` (VFPv3, inexistantes sur l'ARM11 : du code d'un autre processeur ou des données), 1 mot de donnée lu comme du code, 1 `mcr`/`mrc` du coprocesseur 15 hors entretien du cache. 23 877 fonctions sur 23 882 sont entièrement traduites.

Le jeu entier compilé (`validate.py build`) : 61 fichiers C, 34 s avec `-O1` sur 28 cœurs, une DLL de 77 Mo.

Couvert : toutes les formes de données (décalages immédiat et par registre, retenue du décaleur, drapeaux), conditions, LDR/STR et leurs formes d'adressage, LDRH/LDRSH/LDRSB/LDRD/STRD, LDM/STM (4 modes), multiplications (MUL, MLA, UMULL, SMULL, UMLAL, SMLAL, UMAAL, SMUL/SMLA/SMLAW/SMLAL en 16 bits, SMUAD, SMLAD, SMLALD, SMMUL), CLZ, QADD/QSUB, les extensions (UXTB, SXTH, UXTB16, SXTAB...), PKHBT/PKHTB, SSAT/USAT/SSAT16/USAT16, REV/REV16/REVSH, SEL, les opérations en parallèle (`qadd16`, `uhadd8`...), USAD8, LDREX/STREX (octet, demi-mot, mot, double mot), CLREX, SWP, MRS, MSR (drapeaux), `mrc` du registre de stockage local, les opérations d'entretien du cache (sans effet), PLD, les indices (nop, yield...), `svc`, et la VFPv2 : VLDR/VSTR/VLDM/VSTM/VPUSH/VPOP, VADD/VSUB/VMUL/VDIV/VMLA/VMLS/VNMLA/VNMLS/VNMUL en simple et en double, VABS/VNEG/VSQRT/VMOV, VCMP/VCMPE, VMRS/VMSR/FMSTAT, VCVT (entier, simple, double), VMOV avec le cœur.

## Les modules `.cro`

Presque tout le code du jeu est dans 133 modules `.cro` (6,1 Mo de code ARM, 1,05 million d'instructions, 37 854 fonctions
trouvées) que `ro` charge et reloge à l'exécution. Tant qu'ils restaient à unicorn, le natif ne servait à rien : sur 24 s de banc,
743 s de PC dont 4,7 s dans le natif et 537 s sous unicorn.

### La méthode : un C relogeable (voie « b »), et pourquoi pas la voie « a »

Deux voies : compiler chaque module **à l'adresse où le banc le charge** (a), ou rendre le C **indépendant de cette adresse** (b).
J'ai vérifié si l'adresse est déterministe, et elle ne l'est pas assez pour (a) :

- *d'une exécution à l'autre* : oui, sur le banc. Dans les 51 exécutions gardées dans `local/analyse/`, le même module est toujours à la
  même adresse (`DllTitle` `0x6a9000`, `DllBackGround` `0x6cc000`, `DllSequence` `0x6d5000`). Le banc est déterministe ;
- *selon l'ordre des chargements* : non. L'adresse « miroir » est celle du tampon que le jeu a réservé dans son tas moins `0x0799B000`
  (`ldr_ro.py`, `LoadExeCRO`). Les modules qui se chargent ensemble s'empilent à la suite : `DllBackGround` n'est à `0x6cc000` que
  parce que `DllTitle` (`0x22000` octets) l'a précédé ; chargé seul ou après un autre module, il serait ailleurs. Le premier module
  chargé occupe toujours la première place libre (`0x6a9000` pour `DllLangSelect`, `DllTitle`, `DllStartMenu` et `DllField`, qui se
  succèdent et sont déchargés entre-temps) ;
- *sur la console* : l'adresse vient de l'allocateur du tas du jeu, donc de tout ce que le jeu a alloué avant (sauvegarde, écran
  précédent, langue). Rien ne la fige.

La voie (a) casserait donc à la première différence de trajectoire : tous les `bl` internes, toutes les adresses de pool, les tables
de sauts et les retours choisis à la main seraient faux, sans que rien ne le signale à l'exécution. Il aurait fallu un C par disposition
possible. La voie (b) coûte quelques réécritures et sert aussi au portage Rust : le C d'un module est le même quelle que soit la base.

### Comment le C d'un module ne dépend pas de sa base

- Chaque module est traduit **à une adresse factice** (`0x40000000 + indice × 2 Mio`), avec ses corrections internes appliquées à cette
  adresse : le décodeur lit ainsi les tables de sauts et sait ce que visent les pointeurs de fonction. Les adresses de code ainsi
  produites (retour d'un `bl`, `add rX, pc, #imm`, cible de l'aiguillage, entrée de fonction) sont ensuite **réécrites** en
  `RT_MBASE + décalage`, où `RT_MBASE` = `rt_mb[indice]` est la base réelle du module, posée par l'hôte au chargement.
- Tout le reste vient de la **mémoire** : un mot de pool de littéral est relu par `rd32` à l'exécution, il porte donc l'adresse réelle que
  `ro` y a écrite (correction interne, ou import résolu vers `code.bin` ou un autre module). Aucune constante n'est repliée dans un module.
  Un appel vers `code.bin` ou un autre module passe par `rt_dispatch` avec cette adresse réelle ; un appel dans le module est un appel C direct.
- Les `switch` des tables de sauts (`add pc, pc, rX, lsl #2`, `ldr pc, [pc, rX, lsl #2]`) restent en adresses factices **des deux côtés** : ils ne
  dépendent que de l'indice. Un retour non-local (`RT_POPC`, `rt_unwind`) compare l'adresse visée, ramenée à l'adresse factice
  (`adresse - RT_MBASE + factice`).
- `python recomp/cro_recomp.py bases` traduit chaque module à **deux** adresses factices et exige le même C une fois réécrit : une constante du
  code qui tomberait par hasard dans la fenêtre factice (et serait prise pour une adresse) y serait vue. Écart sur les 133 modules : 0.
- `rt_dispatch` cherche d'abord dans la table de `code.bin`, puis dans les modules chargés (le dernier trouvé d'abord) : recherche
  dichotomique dans la table du module, indexée par décalage dans le module (bit 0 pour Thumb).

### Les points d'entrée (aucun module n'a de liste Ghidra)

Ils viennent du fichier : exports par nom et par numéro, objet de contrôle (`0xA0` à `0xAC`), **adresses que d'autres modules et
`static.crs` importent** (c'est ce qui rend les fonctions que le programme principal appelle), pointeurs de fonction posés par les
corrections internes dans `.data` et `.rodata`. Puis la fermeture des appels (`bl`, aiguillage à cible constante), puis les
pointeurs posés **dans le code** par les corrections (fonctions passées en rappel ; ceux qui tombent au milieu de ce qui est déjà traduit,
cibles de tables de sauts, sont ignorés), puis les prologues `push {..., lr}` dans ce qu'aucune fonction n'a atteint. Un mot que `ro`
écrit est de la donnée : il n'est jamais pris pour du code. Le banc note ce qu'il rencontre sans que ce soit traduit dans
`local/recomp/trous-cro.txt` (`module décalage`), relu comme points de départ à la génération suivante (même cycle que `trous.txt`).

Résultat : environ 95 % des octets de code sont des instructions traduites (le reste : pools et données), aucune instruction non
traduite sur les 133 modules (une conversion VFP lisait mal les bits D et M : corrigé, avec son test).

### Le brancher dans le banc

`python recomp/recomp.py gen` puis `python recomp/cro_recomp.py gen` écrivent le C de `code.bin` et des modules dans `local/recomp/jeu`,
avec `cro_table.c` (une table par module et `rt_cro_init`) et `cro_meta.json` (indice, taille, empreinte et masque de chaque module) ;
`python recomp/validate.py build --host` compile tout dans la même DLL (214 Mo, 245 fichiers, environ une minute et demie).

Quand `ro` a fini de charger un module, `bench.on_cro_loaded` appelle `cpu.module_loaded(nom, base)` (`banc/cpu_native.py`) :
1. l'**empreinte du code en mémoire** est comparée à celle du fichier d'où le C a été tiré, les mots que `ro` écrit (corrections et
   imports) mis à zéro. Un code différent (autre version, mod) est **refusé** : le module reste à unicorn, qui exécute le vrai code ;
2. `rt_mod_set_base(indice, base)` : `rt_dispatch` trouve le module ; ses pages de code sont retirées d'unicorn (même mécanisme que `code.bin`) ;
3. la mémoire reprise (`unmap`, `protect` qui touche le module) **débranche** le module (`rt_mod_set_base(indice, 0)`, les pages
   redeviennent exécutables sous unicorn). Un module déchargé ou rechargé ailleurs n'exécute donc jamais de code périmé : sa base est
   relue à chaque aiguillage, et le C d'une ancienne adresse n'est plus atteignable ;
4. un module chargé deux fois à la fois n'a qu'une base : le second reste à unicorn.

Les adresses du code de module que ni le C ni la table ne couvrent (un trou) passent à unicorn avec la page rendue exécutable, comme pour `code.bin`.
Le mode `verifier` journalise aussi les entrées de fonction des modules branchés.

### Ajouts à l'interface C (rien ne change de sens)

`rt.h` : `RtModule`, `rt_mb[]`, `rt_mod_register`. `rt.c`, fonctions exportées en plus : `rt_cro_init` (écrite dans le C généré),
`rt_mod_count`, `rt_mod_name(i)`, `rt_mod_info(i, out[4])` (indice, décalage et taille du code, nombre d'entrées),
`rt_mod_set_base(i, base)` (0 : déchargé), `rt_mod_list_entries(i, out, max)`. `rt_has_entry` et `rt_can_hook` répondent aussi pour les modules
chargés. `rt_dispatch` cherche dans les modules chargés après `code.bin`. Sans `rt_cro_init`, aucune de ces fonctions ne change le comportement.

### Mesure

Scénario de 24 s de banc (`--appuis 14:START,16:A,18:A`), `--cpu hybride`, machine chargée par d'autres chantiers (les temps PC sont
indicatifs) :

| | temps PC | natif | unicorn | reste (Python) |
| --- | --- | --- | --- | --- |
| hybride, modules sous unicorn (avant) | 743 s | 4,7 s | 537 s | 202 s |
| hybride, modules recompilés, première génération | 320 s | 33 s | 170 s | 118 s |
| idem, avec les points d'entrée issus de `static.crs` | 338 s | 34 s | 190 s | 114 s |

Les 3 premières secondes du banc (`DllTitle` chargé) passent de plusieurs dizaines de secondes à **2,1 s de PC, 0 s sous unicorn, 0 traversée**.
Le temps restant sous unicorn vient de **trous de `code.bin`** : des adresses que Ghidra ne nomme pas et que le code des modules,
désormais natif, atteint (38 000 passages natif vers unicorn en 17 s, sur ~15 adresses vers `0x1b9c00`-`0x1bfc00`). Chaque tour du cycle
`banc` -> `trous.txt` -> `recomp.py gen` -> `build --host` en retire (708 -> 814 adresses, 25 572 fonctions de `code.bin`) et en
révèle d'autres plus bas dans la liste ; **le cycle n'est pas terminé**. Les modules eux-mêmes n'ont plus de trou sur ce scénario.
Pas encore mesuré après ce dernier tour : le temps final, et `--cpu verifier` sur des tranches de modules (non fait faute de temps).
Profil du Python (114 s) : non fait.

## La validation : natif contre unicorn

`harness.py` monte deux copies identiques de la mémoire du programme (les trois sections de `code.bin`, plus un tas de 64 Kio et une pile de 16 Kio), l'une pour unicorn, l'autre pour la DLL. Pour chaque fonction il tire des états de départ au hasard : registres (pointeurs dans le tas, petits entiers, valeurs libres, valeurs limites, pointeurs dans les sections), drapeaux, GE, registres VFP (flottants simples, doubles, NaN, infinis, dénormaux), tas (octets libres ou petits entiers et pointeurs) et pile. Les deux côtés exécutent la fonction, puis on compare **r0-r12, sp, lr, N Z C V Q, GE, d0-d15, les drapeaux du FPSCR et toute la mémoire inscriptible**. Les tirées où les deux côtés font la même faute mémoire, ou où unicorn n'atteint pas le retour (boucle trop longue), sont écartées ; une faute d'un seul côté est une divergence.

**Sur du code fabriqué** (`tests.py`, sans dump) : plusieurs centaines de mots ARM par famille d'encodage (14 familles, ARM et VFP) et de demi-mots Thumb (12 familles), tirés au hasard, suivis d'un `bx lr`, sont recompilés et rejoués : zéro divergence. Un petit programme avec appel `bl` et `pop {pc}`, et deux tables de sauts (`add pc` et `ldr pc`), passe aussi.

**Sur le jeu** (`validate.py`), résultats de la dernière passe :

| | fonctions | passent | échouent | sans tirée exploitable |
| --- | --- | --- | --- | --- |
| feuilles (ni appel, ni svc, 3 instructions ou plus), 100 tirées chacune | 4 490 (dont 71 Thumb) | 4 119 | 0 | 371 |
| les mêmes 371, rejouées avec 1 500 tirées | 371 | 210 | 0 | 161 |
| non feuilles dont tout l'arbre d'appels est recompilé, 500 tirées chacune | 2 191 (arbres de 3 130 fonctions) | 1 816 | 0 | 375 |

Soit **6 145 fonctions identiques à unicorn sur des centaines de tirées**, aucun échec. « Sans tirée exploitable » veut dire que toutes les tirées ont fait une faute mémoire (la fonction attend une structure bien formée) ou n'ont pas atteint le retour dans unicorn : ces fonctions ne sont pas validées, ni invalidées. Les feuilles de moins de 3 instructions (accesseurs) ne sont pas comptées.

Vitesse (`validate.py speed`, fonctions de calcul à boucle, 6 500 à 24 500 instructions par appel, natif compilé en `-O2` sans compteur) : unicorn fait de 76 à 290 millions d'instructions ARM par seconde ; le natif fait de 2 700 à 7 400 millions, soit **24 à 41 fois plus vite** (mesure de l'exécution seule, sans l'appel Python).

### Ce que la validation a trouvé (et corrigé)

- `str pc` et `stm {pc}` enregistrent `pc + 8` (unicorn, comme l'ARM11), pas `pc + 12` ;
- un accès exclusif (`ldrex`, `strex`) à une adresse mal alignée est une faute ;
- `LDM`/`STM` n'alignent pas l'adresse : unicorn lit à l'adresse donnée ;
- le NaN produit par `vnmul` est négatif (la négation s'applique après le NaN par défaut) ;
- dans le harnais : écrire le CPSR avant les registres (changer de mode échange `sp` et `lr`) ;
- des encodages « imprévisibles » du manuel (base dans la liste d'un `stm` avec écriture-retour, `ldrd` avec écriture-retour sur la destination, `mul` avec Rd = Rm) n'ont pas de sens défini : ils sont écartés des tirages et unicorn refuse certains.

### Ce qui n'est pas validé

- Les fonctions qui font un `svc`, un appel indirect (`blx` registre), ou appellent du code non recompilé : leur comportement dépend du reste de la console, il n'y a pas d'oracle isolé. Elles sont recompilées, mais pas validées une à une.
- Le sous-ensemble des fonctions où aucune tirée ne passe les fautes mémoire (surtout des fonctions qui attendent des structures bien formées).
- Les modules `.cro` : validés par la comparaison `verifier` sur des tranches du jeu (voir « Mesure »), pas fonction par fonction.
- Les drapeaux cumulatifs d'exception du FPSCR (IXC, UFC...) ne sont pas tenus ; le mode NaN par défaut est supposé actif (c'est celui que pose le noyau).
- La précision des accès non alignés aux demi-mots et doubles mots à travers des pages mixtes, et l'atomicité réelle des accès exclusifs entre fils.

## Branché dans le banc (`banc/cpu_native.py`, `banc/cpu_verify.py`)

`python banc/run.py --cpu hybride` (ou `natif`, `verifier`) fait tourner le jeu sur la DLL recompilée. Il faut d'abord
`python recomp/recomp.py gen --out local/recomp/jeu` puis `python recomp/validate.py build --host` (et `--logw` pour le mode
vérification). La compilation est incrémentale (objets gardés dans `build/objets/`) et le C est réparti en tranches fixes de
64 Kio d'adresses : ajouter des fonctions ne recompile que les tranches touchées.

- `runtime/host.c` : une fibre Windows par fil de la console, rend la main sur un appel système, un compteur épuisé (préemption
  coopérative), un repère ou un saut vers du code non recompilé (mode hybride : unicorn exécute alors ce code avec les mêmes
  registres et la même mémoire).
- `runtime/logw.c` : journal des écritures et des entrées de fonction, pour le mode vérification (le natif fait la tranche,
  unicorn la rejoue, arrêt à la première divergence). `VERIFIER_DEPUIS=N` saute la vérification des N premières tranches.
- **Les trous.** Ghidra laisse du code hors de ses fonctions (cibles de sauts calculés, suites de fonctions coupées). Le banc note
  chaque adresse du jeu rencontrée sans être recompilée dans `local/recomp/trous.txt` ; `recomp.py gen` les relit comme points de
  départ. Cycle : lancer le banc, `gen`, `build --host`, recommencer jusqu'à ce que le fichier ne grossisse plus.
- **Retours non-locaux.** Du code du jeu « revient » ailleurs qu'à son appelant (un `pop {..., pc}` qui termine l'épilogue de
  l'appelant ; une adresse de retour fixée à la main par `add lr, pc, #imm` éventuellement suivi de `add lr, lr, #imm`, puis
  empilée). Le C ne sait revenir qu'à l'appelant : `RT_PUSH` met `c->r[15]` à 0 avant un appel, tout retour y pose sa cible,
  `RT_POP` la compare à l'adresse rangée et, si elle diffère, la fonction rend la main à son tour jusqu'à l'appel qui l'attendait ;
  une fonction qui a des adresses de reprise à elle (`RT_POPC`, étiquette `rt_unwind`) y reprend. Côté hôte, un tel retour qui
  enjambe un passage par unicorn est suivi par `CMD_RETURN`. Tests sur code fabriqué : `test_native_cpu` et `PROGRAM_MANUAL_LR*`.
- **Pages cédées à unicorn.** Une boucle d'un module `.cro` qui rappelle de petites fonctions du jeu traversait le natif des
  centaines de milliers de fois (une traversée coûte des dizaines de microsecondes de Python). Au-delà de 200 appels depuis
  unicorn vers une même page du jeu, la page devient exécutable sous unicorn.

## Ce qui manque pour le jeu entier

1. **Les fils.** Une fonction recompilée garde son état dans la pile C du PC, pas dans un contexte qu'on peut ranger : `Cpu.save()/restore()` du banc ne se traduisent pas tels quels. Piste : un fil de la console = un fil de l'hôte (ou une fibre), un seul tournant à la fois ; `rt_svc` bloque le fil de l'hôte et rend la main au noyau Python, qui réveille le prochain.
2. **Le temps partagé.** Sans l'émulateur, rien ne préempte une boucle d'attente active. Les constructions de test ont `RT_BACKEDGE()` (compteur) ; une construction « coopérative » peut s'y appuyer pour rendre la main de temps en temps.
3. **Les points de repère** (`watch`) : au niveau d'une entrée de fonction, un crochet à l'entrée (macro vide hors mesure).
4. **Les modules `.cro`** : recompilés en C relogeable (section « Les modules `.cro` »), branchés dans le banc au chargement.
5. **La mémoire** : brancher `memory.AddressSpace` sur la table de pages (`rt_map`), voir plus bas.

## Comment cela remplacera `cpu_unicorn.py` derrière l'interface de `cpu.py`

L'interface étroite de `banc/cpu.py` (`get`, `set`, `regs`, `new_context`, `save`, `restore`, `run`, `invalidate`, `watch`, `request_stop`) a deux parties que le natif remplit ainsi :

1. **La mémoire.** `UnicornCpu.on_map/on_unmap/on_protect` projettent chaque plage d'`AddressSpace` avec `mem_map_ptr`. Un `NativeCpu` fera pareil avec `rt_map(première_page, nombre_de_pages, pointeur_hôte, droits)` : le pointeur est `region.host_pointer()`, c'est déjà ce que donne `Backing`. La table de pages remplace la projection d'unicorn et les alias restent.
2. **Les registres et l'exécution.** `get`/`set` lisent et écrivent la structure `Cpu` (`r[]`, drapeaux) ; `new_context` crée une structure et un fil d'hôte qui appellera `rt_call(c, pc)` ; `save`/`restore` choisissent quelle structure est le fil courant ; `run(max)` réveille le fil et attend qu'il rende la main sur un `svc` (`Stop.SVC`, numéro et pc) ou une faute (`rt_call` rend `RT_FAULT`, `RT_UNIMPLEMENTED`, `RT_NO_TARGET`, `Stop.FAULT` avec l'adresse). `rt_set_svc_hook` enregistre le rappel qui fait la coupure.
3. **L'ordre de bascule** : (a) `NativeCpu` à côté d'`UnicornCpu`, même banc, mêmes tests, et le palier P1 des deux côtés ; (b) mode hybride : l'aiguillage rappelle unicorn quand l'adresse n'est pas dans la table (modules `.cro`, code généré), avec échange des registres par `get`/`set` ; (c) les `.cro` recompilés au chargement ; (d) unicorn retiré avec `cpu.py`.

Le banc reste la référence : il compare le journal des appels système (`journal.txt`) entre les deux processeurs, et unicorn reste l'oracle du harnais ci-dessus.
