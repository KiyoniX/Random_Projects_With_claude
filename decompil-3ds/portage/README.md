# Portage PC de Pokémon X (Rust + wgpu, Vulkan)

Ce dossier est le portage natif de Pokémon X sur PC. Il est ouvert le 16/10/2026, en commençant par le GPU. Tout est en
Rust (edition 2024), noms de code en anglais, commentaires en français. Rien du jeu ni de la console n'est versionné ici :
les captures du vrai jeu vivent dans `../local/`, les tests fabriquent leurs données.

## L'architecture visée

```
        +-----------------------------+      +--------------------------------------+
        | code ARM du jeu, recompilé  |      | mods : overlay.json + romfs/         |
        | en C (../recomp/, rt.c)     |      | (../mods/ produit, `overlay` lit)    |
        +--------------+--------------+      +------------------+-------------------+
                       | appels système (SVC)                    | fichiers servis
        +--------------v-----------------------------------------v-------------------+
        |  noyau et services de la console, réécrits en Rust : mémoire, fils,         |
        |  sm, fs, gsp, hid, apt, ro, cfg… chacun vérifié contre le banc Python        |
        |  (../banc/, la référence de comportement d'après les fiches de ../fiches/)   |
        +--------------+-------------------------------------------------------------+
                       | listes de commandes GPU + mémoire (le format de capture)
        +--------------v--------------+      +--------------------------------------+
        |  pica : PICA200 -> wgpu     |----->|  fenêtre (winit) : deux écrans,      |
        |  (Vulkan), échelle 1x à 4x  |      |  échelle réglable, plus tard le son  |
        +-----------------------------+      +--------------------------------------+
```

1. **Le code du jeu** est recompilé de l'ARM vers du C (`../recomp/`), compilé en bibliothèque, appelé depuis Rust.
2. **Le noyau et les services** sont écrits en Rust. Règle de travail : le banc Python reste l'oracle ; chaque service Rust
   est vérifié en rejouant les mêmes échanges et en comparant les réponses avec celles du banc.
3. **Le rendu** est `pica` (ci-dessous) : les listes de commandes du GPU de la console deviennent des dessins wgpu.
4. **Les mods** ne sont lus que par `overlay` : `overlay.json` (format 1) et `romfs/`, comme le dit le contrat de
   `../mods/README.md`.

### Les crates (`crates/`)

| Crate | Rôle |
|---|---|
| `capture` | le format de capture neutre (lecture et écriture), ci-dessous |
| `formats` | tuiles de Morton, 5 formats de couleur, les 14 formats de texture dont ETC1 et ETC1A4 ; vérifiée contre `banc/pica/formats.py` |
| `pica` | le PICA200 vers wgpu : registres, sommets, shaders traduits, textures, combinateur, mélange, transferts |
| `overlay` | lit `overlay.json` et `romfs/` des mods ; refuse un `format` plus grand que 1 ; SHA-1 maison |
| `portage` | l'outil : `replay`, `compare`, `window`, `overlay` |
| `kernel` | le noyau de la console (mémoire, objets, ordonnanceur, horloge du banc, 41 appels système, IPC, journal au format du banc) ; processeur scénarisé pour les tests |
| `hostcpu` | le code ARM recompilé en C, chargé depuis `jeu-hote.dll` (fibres Windows), y compris les modules `.cro` recompilés |
| `services` | `srv:`, `APT:U`, `fs:USER`, `gsp::Gpu`, `dsp::DSP`, `hid:USER`, `cfg:u`, `ptm:u`, `err:f`, `ldr:ro`, et les services simplifiés (`ndm:u`, `boss:U`, `frd:u`, `y2r:u`, réseau…) |
| `romfs` | le romfs d'un `.cxi` déchiffré et sa surcouche de mods (`overlay`), tables refabriquées comme `mods/modkit/romfs3.py` |
| `cro` | le chargeur de modules `.cro` (port de `outils/cro_loader.py`, identique à Python sur les 133 modules) |
| `runtime` | l'exécutable `runtime` : `run` (le jeu sur le noyau Rust) et `compare` (deux journaux) |

## Le format de capture (`.picacap`)

Écrit par `../banc/pica/export_capture.py` à partir d'un `.pkl` de `banc/pica/replay.py`, lu par la crate `capture`.
Petit-boutiste. Un en-tête de 16 octets, puis des blocs `étiquette(4 octets) | longueur(u32) | contenu` ; un bloc inconnu
est ignoré (les versions futures peuvent en ajouter).

| Élément | Contenu |
|---|---|
| en-tête | `PICACAP\0`, version u32 (1), nombre de blocs u32 |
| `REGS` | nombre N u32, N valeurs u32 des registres (0x300), N octets « déjà écrit par le jeu » |
| `SHDR` | code du shader 4096 u32, descripteurs d'opérandes 4096 u32, uniformes flottants 96x4 f32, attributs fixes 16x4 f32 |
| `GSTA` | 8 u32 (décalage du code, des descripteurs, index des attributs fixes, des uniformes, drapeau « uniformes f32 », ligne du brouillard, table et ligne des tables d'éclairage), 2 longueurs u32, mots en attente (attributs fixes puis uniformes) |
| `FOGT` | table du brouillard, 128 x (valeur, différence) f32 |
| `LUTS` | tables d'éclairage, 24 x 256 x (valeur, différence) f32 |
| `MEMR` | une région de mémoire (adresses du jeu : tas linéaire, mémoire vidéo) : adresse u32, taille u32, codec u32 (0 brut, 1 zlib), octets |
| `CMDW` | une commande de la file de gsp : 8 mots u32, longueur u32, octets (pour la commande 1, la liste de commandes GPU, sauts déjà suivis) |

La capture est une photo de ce que le GPU peut lire à un instant, plus l'état de ses registres ; les commandes (0 copie,
1 liste GPU, 2 remplissage, 3 transfert vers l'écran, 4 copie de texture) sont rejouées dans l'ordre.

```
python banc/pica/export_capture.py local/analyse/pica/np.pkl local/portage/captures/np.picacap
```

Les listes de commandes d'une capture sont **déjà suivies** (sauts 0x238-0x23D, jusqu'à 20 000 sauts par commande) : l'exporteur
recopie `follow_jumps` du banc et suit la chaîne entière pour les anciens `.pkl` (champ `'sauts'` différent de 2). La crate
`pica` a le même `state::follow_jumps(mémoire, liste)` pour le futur service gsp : à n'appliquer qu'**une fois**. L'exporteur lit
les `.pkl` sans importer le code du banc (les classes de `pica/` sont remplacées par des coquilles vides) : il marche même si
le banc est en cours de modification.

## `pica` : comment le PICA200 devient du wgpu

- **Listes de commandes** (`state.rs`) : même décodage que le banc (masques d'octets, écritures consécutives, ports à
  auto-incrément : uniformes, code, descripteurs, attributs fixes, brouillard, tables d'éclairage).
- **Sommets** (`vertex.rs`) : les tampons de sommets sont lus et décodés sur le processeur (8 types d'attributs, attributs
  fixes, permutation) et envoyés dans un tampon de stockage ; les triangles (liste, bande, éventail) sont assemblés là.
- **Shaders de sommets** (`shader.rs`) : chaque programme PICA est **traduit en WGSL** et mis en cache (clé : code,
  descripteurs, entrée, registres de sortie). `IF`, `CALL`, `LOOP`, `JMPC`/`JMPU` vers l'avant, `CMP`, adressage relatif
  a0/a1/aL, multiplication « zéro fois l'infini donne zéro ». Les constantes (flottants, entiers, booléens) sont lues dans
  un bloc d'uniformes à chaque dessin : un programme se traduit une fois. Le shader fait aussi le passage vers l'espace
  de découpe de wgpu (viewport et profondeur de la console, relation linéaire en x, y, z, w).
- **Découpe** : le volume de la console (-w <= z <= 0) est celui de wgpu après le changement de signe de z dans le shader de
  sommets ; la profondeur de la console (z/w * échelle + décalage, interpolée linéairement à l'écran) est écrite par le shader
  de fragments (`frag_depth`) et fait rejeter les points hors de [0, 1], comme le banc.
- **Rastérisation par le GPU** : viewport, ciseaux « inclure » (un rectangle) et « exclure » (quatre rectangles autour du
  trou), test de profondeur, élimination des faces (mode 1 : on garde le sens horaire, mode 2 : l'antihoraire), mélange
  (équations et facteurs), masque d'écriture.
- **Facteurs « constante » exacts** : ceux de la source (couleur ou alpha constants, et leurs compléments) sont multipliés dans
  le shader (facteur « un » pour le GPU) ; la constante du GPU sert à la destination.
- **Pochoir** : tampon `Depth32FloatStencil8` (D24S8 du jeu), fonction, opérations, masques, référence ; relu et réécrit avec
  la profondeur. Un pochoir initial non uniforme est approché par sa valeur la plus courante.
- **Opérations logiques** : le shader lit une copie du tampon de couleur d'avant le dessin et applique les 16 opérations
  (limite : deux fragments qui se recouvrent dans un même dessin lisent tous deux l'état d'avant).
- **Éclairage par fragment** : tout `lighting.py` (24 tables, 8 lumières, spot, atténuation, Fresnel, relief, ombre, modes de
  configuration) est décodé dans le shader depuis les registres 0x140-0x1FF ; les tables vont dans un tampon de stockage
  refait seulement quand le jeu les change.
- **Textures projetées** (type 3 de 0x83 : division par le w de la texture 0) et **profondeur relue comme texture**.
- **Sauts dans les shaders** : les sauts vers l'avant sont des `if`, ceux qui dépassent la fin du bloc le terminent (comme le
  banc), un saut vers l'arrière de premier niveau devient une boucle bornée (4096 tours).
- **Tampons de rendu** : textures RGBA8 et Depth32Float à `échelle x` leur taille native. Ils ne sont **rendus à la
  mémoire du jeu que si une commande la lit ou la recouvre** (`sync_read`, `before_write`, `after_write` : plages de
  mémoire, pas « tout, à chaque commande ») ; à la création, un tampon est chargé depuis la mémoire (l'agrandissement se
  fait sur le GPU) ; la profondeur initiale est un effacement (cas courant) ou un dessin plein écran depuis une texture.
  Un remplissage de mémoire qui recouvre entièrement un tampon d'une seule valeur est un effacement sur le GPU (le tampon
  reste vivant, sans relire la mémoire).
- **Textures** : décodées une fois (`formats`), gardées tant que la mémoire ne change pas sous elles (horodatage par page
  de 4 Kio dans `Memory`, le CRC32 ne sert qu'à départager une page réécrite à l'identique). L'échantillonnage (4 modes de
  bord, plus proche ou bilinéaire, ligne 0 = haut) est fait dans le shader de fragments, comme le banc.
- **Rendus relus comme textures, à la définition de l'échelle, sans passer par la mémoire** : un tampon de couleur vivant
  RGBA8 que le jeu relit à la même adresse, aux mêmes dimensions (la texture est alors le tampon à `échelle x`, la couleur
  n'est jamais dégradée) ; un tampon de profondeur D24S8 relu en RGBA8 (les ombres : converti sur le GPU en octets de
  mémoire, 1/16 des points à l'échelle 4) ; le résultat d'un transfert de copie en tuiles (le jeu rend dans une texture :
  retournement et passage par les formats de la source et de la destination refaits sur le GPU, octet pour octet à
  l'échelle 1). Les copies vers la mémoire que le jeu relit ne sont pas touchées : un transfert vers l'écran est écrit
  en mémoire dès qu'une commande, un dessin ou une texture lit sa destination (voir « Transferts paresseux »).
- **Transferts paresseux** (`render/present.rs`) : un transfert vers l'écran construit l'image de l'écran sur le GPU
  (réduction, découpe, retournement, quart de tour en une passe) et garde une copie de la source ; l'écriture en mémoire
  (`materialize`) n'a lieu que si on la lit, la recouvre en partie, ou à `finish`. Un transfert recouvert en entier par un
  autre est abandonné sans jamais être écrit. Le résultat en mémoire est celui de l'écriture immédiate, octet pour octet
  (`Pica::eager_transfers` pour la comparer).
- **Vitesse du CPU** : les dessins qui visent les mêmes tampons s'enchaînent dans **une seule passe** ; les constantes
  (3,7 Kio par dessin), les sommets, les indices et les tables d'éclairage vont dans quatre grands tampons à décalage
  dynamique, remplis côté processeur et envoyés d'un coup à chaque envoi ; les groupes de liaisons sont mis en cache selon
  les textures ; les sommets décodés et assemblés sont gardés (clé : registres et plages de mémoire lues, horodatage de
  pages) ; le shader de fragments est retrouvé par une clé de registres sans fabriquer son texte ; les tables d'éclairage
  réécrites à l'identique ne sont copiées qu'une fois par envoi ; la relecture du GPU est groupée (un envoi, une
  attente) et la réduction des tampons à `échelle x` vers leur taille native se fait sur le GPU (moyenne exacte).
- **Fragments** (`fragment.rs`) : les six étages du combinateur TEV (sources, opérandes, 10 opérations, échelles, tampon
  de mise à jour), le brouillard et le test alpha, générés en WGSL selon l'état des registres.
- **Transferts** (`transfer.rs`) : transfert vers l'écran (réduction, découpe, retournement, formats), remplissages,
  copies de texture, faits sur la mémoire comme le banc.
- **Haute définition** : à l'échelle 2, 3 ou 4, les tampons de rendu sont plus grands (la géométrie, les bords et le
  filtrage sont rendus à cette taille) et le transfert vers l'écran lit directement le tampon du GPU. Les textures du jeu
  restent à leur définition d'origine : c'est la première preuve, pas encore de textures remplacées.

### Ce qui n'est pas fait dans `pica`

- les **shaders de géométrie** (la référence du banc les a en modes point et primitive fixe, jamais vus dans une capture du
  jeu : le Rust attendra que le jeu en utilise ; le dessin est signalé) ;
- les **textures procédurales**, les **niveaux de détail** et les **cubes** (non faits non plus dans le banc) ;
- un pochoir initial non uniforme (approché), les sauts vers l'arrière qui sortent de leur bloc (erreur signalée) ;
- une texture rendue puis réutilisée ne garde la définition de l'échelle que dans les trois cas ci-dessus (tampon de couleur
  vivant RGBA8 de mêmes adresse et dimensions, résultat d'un transfert de copie en tuiles de mêmes dimensions, profondeur) ;
  tout autre cas (autre format, dimensions différentes, recouvrement partiel) passe par la mémoire à la définition native ;
- à l'échelle 1 avec `readback` (images lues), un transfert vers l'écran dont la sortie est en tuiles passe par la mémoire
  (la mémoire en donne une image brouillée qui n'est pas une image d'écran) ; en direct (`Pica::readback = false`) il est
  paresseux ;
- l'écriture en mémoire d'un tampon de profondeur reste faite sur le processeur (la quantification en flottants 32 bits du
  banc, `z * 16777215 + 0,5`, n'est pas reproductible sur le GPU sans instruction fusionnée) ;
- la première image (shaders et pipelines à créer) coûte 60 à 80 ms par image du jeu : pas de cache de pipelines sur disque ;
- vitesse (portée 1 à 4 sur le terrain du palais) : voir « Vitesse » plus bas.

## Utilisation

```
cd portage
cargo build --release
cargo test

portage replay  ../local/portage/captures/np.picacap --scale 4 --out ../local/portage/rejeu/np-x4
portage compare ../local/portage/captures/np.picacap ../local/analyse/portage/ref/np --out ../local/portage/comparaison/np
portage window  ../local/portage/captures/enreg-24.picacap --scale 2     # 1 à 4 : échelle, flèches : image, L : lissage
portage bench   ../local/portage/captures/terrain2.picacap 20 --scale 1   # à froid puis à chaud, avec images et mémoire
portage bench   ../local/portage/captures/terrain2.picacap 20 --scale 4 --direct   # comme un affichage en direct
portage overlay ../local/mods-build/pc
```

`bench` compte en **images du jeu** (un transfert vers l'écran du haut, avec les écrans du bas qui l'accompagnent). Par
défaut chaque rejeu rend aussi les octets des images et met la mémoire à jour (`finish`) ; avec `--direct`, comme un
affichage en direct : pas de relecture des images, mémoire non écrite, le rejeu finit quand le GPU a fini (temps
« sérialisé »), puis les rejeux sont enchaînés sans attendre (temps « enchaîné »). `PORTAGE_PROFILE=1` détaille un
rejeu par étape (temps exclusifs) ; `PORTAGE_EAGER=1` fait passer les transferts par la mémoire (pour comparer) ;
`PORTAGE_DUMP_MEM=dossier` écrit la mémoire finale de `replay` (une région par fichier) et `replay` affiche son CRC32 ;
`PORTAGE_TRACE=1` (dessins, textures relues), `PORTAGE_TRACE_TEX=1` (adresses des textures), `PORTAGE_TRACE_CMD=1`
(transferts de la capture) pour comprendre une capture.

### Le runtime (noyau, services, processeur recompilé)

```
cd portage
cargo build --release
target/release/runtime run --seconds 3 --out ../local/analyse/runtime/rust      # le jeu sur le noyau Rust
python ../banc/run.py --cpu natif --secondes 3 --sortie ../local/analyse/runtime/ref   # la référence
target/release/runtime compare ../local/analyse/runtime/ref/journal.txt ../local/analyse/runtime/rust/journal.txt
# avec le dessin : pica en direct, une paire de PNG par seconde dans images/, aux noms du banc --dessiner
target/release/runtime run --seconds 12 --dessiner [--scale N] --out ../local/analyse/runtime/rust12d
python ../banc/run.py --cpu natif --dessiner --secondes 12 --sortie ../local/analyse/runtime/ref12d
target/release/portage compare-images ../local/analyse/runtime/ref12d/images ../local/analyse/runtime/rust12d/images
# le jeu en direct dans une fenêtre (journal dans local/analyse/runtime/play/)
target/release/portage play [--scale N] [--seconds S] [--screenshot-at T PRÉFIXE]
```

`portage play` mène le runtime par tranches depuis la boucle de la fenêtre, sur un seul fil : le temps du jeu suit le
temps réel (deux images de retard au plus ; au-delà, le jeu ralentit). Les images des écrans sont les textures que pica
construit sur le GPU, présentées par le même appareil (la surface vient de l'instance du rendu) ; le titre donne les
présentations par seconde, les images du jeu par seconde et la vitesse par rapport au temps réel. `--screenshot-at T
PRÉFIXE` écrit `PRÉFIXEhaut.png` et `PRÉFIXEbas.png`, ce que présente la fenêtre juste avant la première fin d'image à
l'heure T du jeu ou après, l'instant où le banc `--dessiner` prend les siennes : avec le nom d'une image du banc pour
préfixe, `compare-images` les met face à face.

| Touche | Bouton | Touche | Bouton |
| --- | --- | --- | --- |
| X | A | Entrée | START |
| Z | B | Retour arrière | SELECT |
| S | X | Flèches | croix directionnelle |
| A | Y | Q / W | L / R |

Échap quitte. Les touches tenues s'ajoutent aux appuis programmés (`--appuis`) au moment où `hid` lit les boutons.

Il faut la DLL `local/recomp/jeu/build/jeu-hote.dll` (voir `recomp/README.md`). Le journal est écrit au format de
`banc/journal.py`, ligne pour ligne. `compare` donne trois niveaux (exact, sans l'heure, sans l'heure ni le « où »).

**Fait (16/10)** : sur 3 s de banc (`--cpu natif`, avec les `.cro` recompilés branchés), le journal Rust et celui du banc
Python sont **identiques sur les 10 313 lignes** (heure comprise) : mêmes appels système, mêmes requêtes IPC, mêmes
réponses, même horloge, paliers P1 à P5. Avec un mod (`--mod`) le romfs est superposé par les crates `overlay` et `romfs`.
Sur 12 s, avec ou sans `--dessiner`, les journaux sont identiques à ceux du banc (33 032 lignes). Avec `--dessiner`,
`gsp::GpuBackend` est branché sur `pica::Pica::live`, projeté sans copie sur le tas linéaire et la mémoire vidéo du
noyau : les 24 images des 12 s sont celles du banc à 0,12/255 près en moyenne (écrans du bas identiques), en 9 s de PC
contre 196 s pour le banc ; `touch_all` avant chaque commande coûte environ 7 µs. Sans `--dessiner`, le GPU est sans
dessin : les transferts sont notés au journal comme au banc mais la mémoire vidéo n'est pas écrite.

En direct (`portage play`), le jeu tient le temps réel (vitesse 1,00, 30 images du jeu par seconde, présentation à la
fréquence de l'écran), la première image du jeu est présentée vers 0,3 s, et la fenêtre capturée aux instants du banc
est, octet pour octet, l'image PNG de `runtime run --dessiner` (8,19 s et 11,23 s). Le journal d'une partie en direct
est celui de `runtime run` : le découpage en tranches ne change rien au jeu.

**Pas fait** : le mode hybride (unicorn) : un saut vers du code non recompilé est une faute (le jeu s'arrête à 12,26 s) ;
le son ; la comparaison avec un mod n'a pas été refaite après la mise à jour de la DLL.

### Vitesse

Mesures sur un portable RTX 4070, Vulkan, `bench <capture> 30 --scale N` (meilleur de 29 rejeux à chaud ; « direct » :
moyenne de 29), en ms par image du jeu. « Avant » est l'état d'ouverture du chantier (une passe et trois tampons par dessin, relecture du GPU à chaque
commande), « après » la version actuelle ; « direct » est `--direct` (voir plus haut) :

| capture | échelle | à froid avant | à froid après | à chaud avant | à chaud après (images + mémoire) | direct sérialisé | direct enchaîné |
|---|---|---|---|---|---|---|---|
| terrain2 | 1 | 101 | 60 | 27 | 6,9 | 2,5 | 2,7 |
| terrain2 | 2 | 148 | 62 | 42 | 8,6 | 3,1 | 2,6 |
| terrain2 | 4 | 167 | 67 | 80 | 13,5 | 5,6 | 3,1 |
| enreg-24 | 1 | 114 | 78 | 24 | 6,5 | 2,2 | 2,2 |
| enreg-24 | 2 | 118 | 79 | 33 | 8,7 | 2,8 | 2,3 |
| enreg-24 | 4 | 148 | 86 | 65 | 14,5 | 4,9 | 2,7 |
| a1 | 1 | 104 | 80 | 26 | 6,7 | 2,5 | 2,4 |
| a1 | 2 | 104 | 92 | 32 | 8,8 | 3,1 | 2,4 |
| a1 | 4 | 157 | 92 | 65 | 14,5 | 4,7 | 2,8 |
| np (menu) | 1 | 26 | 24 | 10 | 5,7 | 0,6 | 0,7 |
| np (menu) | 2 | 31 | 27 | 16 | 7,3 | 0,6 | 0,8 |
| np (menu) | 4 | 50 | 29 | 37 | 12,1 | 1,2 | 1,7 |

Le but (moins de 16 ms par image du jeu au terrain, échelles 1 et 2, et le mieux possible à l'échelle 4) est atteint, y
compris à l'échelle 4 avec les images lues et la mémoire mise à jour. Les images rendues sont, à l'octet près, celles
d'avant (empreintes MD5 des PNG à l'échelle 1, 2 et 4 de six captures) ; la mémoire finale est la même octet pour octet en
mode paresseux et en mode `PORTAGE_EAGER`.

La référence de `compare` est la sortie de `python banc/pica/replay.py <pkl> --sortie <dossier>` (images `ecran-NN-haut|bas.png`
du rendu numpy). Variable `PORTAGE_GPU=nom` pour choisir la carte (par défaut la plus puissante).

## Où on en est

**Fait** : format de capture et exporteur ; crates `capture`, `formats`, `pica`, `overlay` ; rejeu sans fenêtre à
l'échelle 1 à 4 ; comparaison avec le banc (écran-titre, menu et terrain du palais, écart moyen 0,003 à 0,1/255) ; éclairage
par fragment, pochoir, opérations logiques, facteurs constants exacts, sauts de shader ; fenêtre ; vitesse (terrain du palais
sous 9 ms par image du jeu aux échelles 1 et 2, 14 ms à l'échelle 4 avec images et mémoire, 6 ms en direct) ; les tests
(`cargo test`) fabriquent leurs captures.

**Reste, dans l'ordre**
1. les shaders de géométrie quand le jeu en utilisera, et un cache de pipelines sur disque pour la première image ;
2. le noyau en Rust (mémoire, fils, synchronisation, SVC) face au banc ;
3. les services dans l'ordre des fiches : `sm`, `fs`, `apt`, `gsp` (la file qui alimente `pica`), `hid`, `cfg`, `ro`, `ndm`…
4. l'appel du C recompilé depuis Rust, jusqu'à l'écran-titre en direct (au lieu d'une capture) ;
5. le son, les entrées, la sauvegarde ;
6. le service des fichiers des mods par `overlay` au niveau de `fs`, puis les textures haute définition des mods (le
   dossier `pc/` du contrat) et le remplacement de textures dans `pica`.
