# La recompilation statique ARM vers C

Le but à terme : faire tourner Pokémon X sur PC sans émulateur de processeur. Aujourd'hui le banc d'essai (`banc/`) exécute le code ARM du jeu sous unicorn. Ce dossier fait le premier pas pour s'en passer : un **recompilateur** qui lit `code.bin` et écrit, pour chaque fonction du jeu, une fonction C équivalente, que le compilateur du PC transforme ensuite en code natif.

Le C produit à partir du code du jeu vient d'un dump personnel : il n'est écrit que dans `local/recomp/` (jamais versionné). Ce dossier-ci ne contient que l'outil, son support d'exécution et ses tests sur du code fabriqué.

## Ce que fait chaque fichier

| Fichier | Rôle |
| --- | --- |
| `recomp.py` | le recompilateur : lit `code.bin` + l'exheader + la liste des fonctions de Ghidra, traduit chaque fonction, écrit les fichiers C (`stats`, `gen`, `test`) |
| `armdec.py` | le décodeur ARM (mode ARM, ARMv6K) : un mot de 32 bits devient des lignes de C |
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
python recomp/tests.py                               # les tests (environ une minute et demie)

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
- Les `.cro` chargés plus tard (hors de portée pour l'instant).
- Les drapeaux cumulatifs d'exception du FPSCR (IXC, UFC...) ne sont pas tenus ; le mode NaN par défaut est supposé actif (c'est celui que pose le noyau).
- La précision des accès non alignés aux demi-mots et doubles mots à travers des pages mixtes, et l'atomicité réelle des accès exclusifs entre fils.

## Ce qui manque pour le jeu entier

1. **Les fils.** Une fonction recompilée garde son état dans la pile C du PC, pas dans un contexte qu'on peut ranger : `Cpu.save()/restore()` du banc ne se traduisent pas tels quels. Piste : un fil de la console = un fil de l'hôte (ou une fibre), un seul tournant à la fois ; `rt_svc` bloque le fil de l'hôte et rend la main au noyau Python, qui réveille le prochain.
2. **Le temps partagé.** Sans l'émulateur, rien ne préempte une boucle d'attente active. Les constructions de test ont `RT_BACKEDGE()` (compteur) ; une construction « coopérative » peut s'y appuyer pour rendre la main de temps en temps.
3. **Les points de repère** (`watch`) : au niveau d'une entrée de fonction, un crochet à l'entrée (macro vide hors mesure).
4. **Les modules `.cro`** : leur code est chargé et relogé à l'exécution. Pour l'instant : ou bien les recompiler à ce moment-là, ou bien laisser unicorn les exécuter via le même aiguillage (repli).
5. **La mémoire** : brancher `memory.AddressSpace` sur la table de pages (`rt_map`), voir plus bas.

## Comment cela remplacera `cpu_unicorn.py` derrière l'interface de `cpu.py`

L'interface étroite de `banc/cpu.py` (`get`, `set`, `regs`, `new_context`, `save`, `restore`, `run`, `invalidate`, `watch`, `request_stop`) a deux parties que le natif remplit ainsi :

1. **La mémoire.** `UnicornCpu.on_map/on_unmap/on_protect` projettent chaque plage d'`AddressSpace` avec `mem_map_ptr`. Un `NativeCpu` fera pareil avec `rt_map(première_page, nombre_de_pages, pointeur_hôte, droits)` : le pointeur est `region.host_pointer()`, c'est déjà ce que donne `Backing`. La table de pages remplace la projection d'unicorn et les alias restent.
2. **Les registres et l'exécution.** `get`/`set` lisent et écrivent la structure `Cpu` (`r[]`, drapeaux) ; `new_context` crée une structure et un fil d'hôte qui appellera `rt_call(c, pc)` ; `save`/`restore` choisissent quelle structure est le fil courant ; `run(max)` réveille le fil et attend qu'il rende la main sur un `svc` (`Stop.SVC`, numéro et pc) ou une faute (`rt_call` rend `RT_FAULT`, `RT_UNIMPLEMENTED`, `RT_NO_TARGET`, `Stop.FAULT` avec l'adresse). `rt_set_svc_hook` enregistre le rappel qui fait la coupure.
3. **L'ordre de bascule** : (a) `NativeCpu` à côté d'`UnicornCpu`, même banc, mêmes tests, et le palier P1 des deux côtés ; (b) mode hybride : l'aiguillage rappelle unicorn quand l'adresse n'est pas dans la table (modules `.cro`, code généré), avec échange des registres par `get`/`set` ; (c) les `.cro` recompilés au chargement ; (d) unicorn retiré avec `cpu.py`.

Le banc reste la référence : il compare le journal des appels système (`journal.txt`) entre les deux processeurs, et unicorn reste l'oracle du harnais ci-dessus.
