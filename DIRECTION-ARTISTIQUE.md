# Direction artistique

Ce document explique comment le site est pensé visuellement : le principe commun, l'identité de chaque projet avec ses couleurs et ses polices, les règles qui valent partout, et la marche à suivre pour ajouter un projet sans casser l'ensemble.

## Le principe

**Chaque projet tire son identité de son sujet, pas d'un habillage commun.**

La première version du dépôt avait un seul look pour tout : fond presque noir, un accent ambre, des cartes arrondies à bordure fine, de petites étiquettes en capitales espacées au-dessus de chaque chiffre, un mot du titre en couleur. C'était propre, et ça donnait à vingt projets différents l'air d'être le même tableau de bord. Tout a été refait à partir d'une question posée projet par projet : *à quoi ressemble cet objet dans le monde réel ?* Un jeu en caractères devient un Minitel, une enquête de 1924 devient un dossier de police, une simulation de ventilation devient une planche de bureau d'études.

Trois conséquences :

1. **L'interface est l'objet.** On ne pose pas des panneaux à côté d'une carte : les chiffres du siège sont tenus dans le registre de la garnison, écrit dans la marge de la carte. Un bouton n'est un bouton web que si l'objet réel a des boutons.
2. **Deux projets ne se ressemblent que s'ils sont de la même famille.** Le siège, la rivière et la visite partagent le parchemin du plan de ville parce qu'ils se jouent *sur* ce plan. Les outils graphiques partagent un fond neutre parce qu'ils servent à juger des couleurs.
3. **La couleur a toujours un rôle.** Le rouge du siège est réservé à l'ennemi, celui du listing aux alertes, celui de la planche de ventilation aux retouches du joueur.

## Ce qu'on s'interdit

Ces motifs sont les signes d'une page générée sans parti pris. Ils sont proscrits, sauf quand le sujet les impose (voir la colonne de droite).

| Motif | Exception légitime |
| --- | --- |
| Fond presque noir avec un seul accent vif | Le Minitel, dont l'écran est noir par nature, et qui emploie huit couleurs ; le frontispice du guide de voyage, où le globe est posé sur du noir |
| Cartes arrondies à bordure fine, toutes identiques | Aucune |
| Petites étiquettes en capitales espacées au-dessus d'une valeur | Les mentions d'un cartouche de dessin technique, les titres d'un cartouche de carte ancienne |
| Un mot du titre mis en couleur ou en italique | Aucune |
| Boutons « fantômes » tous pareils | Aucune : un contrôle prend la forme de l'objet (case à cocher imprimée, cachet de cire, bouton-poussoir, onglet de papier) |
| Libellés joints par des points médians | Aucune : on écrit une phrase, ou un tableau |
| Dégradé décoratif, ombre grise uniforme | Aucune |
| Fenêtre modale sur fond assombri | Quand l'objet en a (boîtes de dialogue du logiciel de 2003) |

## Ce qui vaut partout

- **Langue** : tout est en français. Les jeux et les outils tutoient ; le guide de voyage de `mondes` vouvoie, comme un guide imprimé ; dans l'enquête, les personnages vouvoient l'inspecteur.
- **Aucune dépendance, aucun réseau** : chaque page marche ouverte en `file://` comme publiée sur GitHub Pages. Pas de police distante, donc **polices du système Windows uniquement**, avec des replis. C'est la contrainte la plus structurante : voir « Limites connues ».
- **Deux ou trois familles de caractères par projet, pas plus.**
- **Zoom à la molette** partout où l'on dessine, pose ou regarde une carte : centré sur le curseur, déplacement de la vue (clic milieu, et Espace ou Maj + glisser selon ce que la touche fait déjà dans le jeu), une touche et un bouton pour revenir à la vue d'ensemble, visée exacte à tous les niveaux, et la page qui ne défile pas sous la molette.
- **Pixels nets** : tout ce qui est pixel-art ou caractère se rend sans lissage. Une toile doit aussi tomber sur un pixel entier de l'écran : une hauteur de ligne fractionnaire au-dessus d'elle suffit à la décaler et à la lisser. On donne donc des hauteurs de ligne entières à ce qui la précède (`chiptune`), ou on la recale à l'affichage (`textures`).
- **Aucune commande chassée** : un tampon, une bulle ou un bandeau qui apparaît en cours de partie ne déplace ni ne recouvre jamais une commande. Il se pose sur une zone sans bouton, ou prend sa propre place dans la mise en page. Les ordres qui font avancer le jeu (cachet, pause, niveau suivant) passent avant tout contenu de longueur variable, et la page se resserre quand la fenêtre est basse.
- **La forme, pas seulement la couleur** : tours, machines, ennemis et états se distinguent aussi par leur silhouette ou un signe, pour rester lisibles par un daltonien.
- **Graine** : un projet généré lit sa graine dans l'adresse, ce qui permet au portail de promener la même graine d'un projet à l'autre.
- **Règles intouchables** : une refonte visuelle ne change jamais une règle de jeu. Chaque refonte a été validée par un test rejoué avant et après, à résultat identique.
- **Fichier commun** : `portail/site.js`, chargé en dernier par chaque page, pose l'icône d'onglet du projet (la tranche de sa boîte en miniature) et une étiquette « Retour à la ludothèque » qui dépasse de 7 pixels en haut au centre de la fenêtre et descend au survol. C'est le seul élément visuel partagé par tout le site ; il reprend le papier et le laiton du portail.

## Le portail : la ludothèque

`index.html` et `portail/`.

Le portail n'est pas une grille de cartes : c'est une pièce avec trois étagères, où chaque projet est une boîte de jeu rangée sur la tranche. La tranche porte les couleurs et la typographie du projet, si bien que l'étagère montre d'un coup d'œil la variété du site. Survoler une boîte la sort de l'étagère et la pose sur la table de droite, couvercle ouvert sur un aperçu vivant (la vraie page, réduite). Les titres se lisent de bas en haut, comme sur les livres français.

| Rôle | Valeur |
| --- | --- |
| Mur | `#24423c`, ombre `#1b332e` |
| Bois de l'étagère | `#9a6a3d`, chant `#6a4324` |
| Papier (étiquettes, couvercle) | `#f2e9d0` |
| Encre | `#211b14` |
| Laiton (point « suit la graine », focus) | `#d1a94e` |
| Titres | Sitka Heading, puis Constantia, Georgia |
| Texte | Segoe UI |

- La graine commune est écrite sur une étiquette de carton à œillet. Un point de laiton sur une tranche signale un projet qui la reprend.
- Les étagères portent une étiquette de rayonnage : c'est le seul titre de section.
- Les pages lourdes au chargement (`riviere`, `visite`) gardent leur vignette au lieu de l'aperçu vivant.

## Les projets

### L'univers des villes : la table du cartographe

`plans-de-ville`, `siege`, `riviere`, `visite`.

Le plan de ville est une planche gravée sur parchemin, posée sur une table. Tout ce qui n'est pas la carte est écrit sur une feuille annexe dans la même encre : cartouche gravé, écritures à points de conduite, notes à la plume, mentions soulignées en guise de liens. Un choix se marque d'un trait de plume qui l'entoure, une action importante d'un cachet de cire.

| Rôle | Valeur |
| --- | --- |
| Encre | `#3d2f21`, pâle `#6b5a47` |
| Parchemin | `#f1e5c6`, feuille annexe `#ece0bf` |
| Vermillon (danger, ennemi) | `#b3341f` |
| Gomme-gutte (ce qu'on peut choisir) | `#d9b24a` |
| Imprimé | Palatino Linotype, puis Book Antiqua, Constantia |
| Plume | Gabriola, puis Segoe Script, Ink Free |

Chaque page change la table et le papier annexe pour se distinguer au premier regard :

| Page | Table | Feuille | Signe propre |
| --- | --- | --- | --- |
| `plans-de-ville` | noyer `#47331f` | parchemin | cachet de cire rouge `#a12c19` |
| `siege` | drap vert `#2b3b2f` | chamois `#ebdfbd` | jetons de défense épinglés, « Lancer la vague » en cire rouge |
| `riviere` | drap ardoise `#2b3d4a` | papier azuré `#e2e6da` | bleu de Prusse `#2a5674`, « Crue décennale » en cire bleue, échelle limnimétrique |
| `visite` | la ville en 3D | parchemin en surimpression | le plan lui-même sert de carte de poche ; nom du quartier annoncé comme une légende |

Dans le siège, le rouge est réservé à l'ennemi. Dans la rivière, la grille de calcul n'apparaît qu'en zoomant de près.

### `cartes-et-cachots` : le Minitel

Le jeu se joue dans un écran vidéotex, « 3615 CACHOTS », posé dans une coque beige à tube bombé. Grille stricte de 64 × 30 cases, huit couleurs franches sur noir, vidéo inverse, titres en double taille, cadres et jauges en mosaïques. Marchand, butin et fin de partie sont des pages vidéotex, pas des fenêtres. Le bandeau du bas liste les touches, à la manière de Sommaire / Guide / Envoi.

| Rôle | Valeur |
| --- | --- |
| Les huit couleurs | `#000` `#f00` `#0f0` `#ff0` `#00f` `#f0f` `#0ff` `#fff` |
| Coque | `#b7ab94`, clair `#cfc5b0`, ombre `#91866f` |
| Lunette | `#2b2622` |
| Caractères | Consolas, puis Cascadia Mono, Lucida Console, Courier New |

Les types de cartes se distinguent par la couleur et par un signe : ♠ rouge pour l'attaque, ♦ cyan pour la technique, ♥ jaune pour le pouvoir.

### `defense-ascii` : le listing d'imprimante

L'opposé du Minitel : fond clair, deux encres. Le champ de bataille est imprimé sur du papier listing à bandes vertes, avec bandes perforées et pliures. Faute de couleur, tout se distingue par des moyens d'imprimeur : gras par double frappe, soulignement, vidéo inverse, trames, hachures de portée. Les commandes sont des cases à cocher imprimées, la fin de partie un « compte rendu d'opération ».

| Rôle | Valeur |
| --- | --- |
| Papier | `#fbfbf5`, bandes `#d8e9d3` |
| Encre | `#1b1a1f`, ruban usé `#5b5d55` et `#83867c` |
| Trame serrée du terrain | `#d6d8cf` |
| Ruban rouge (ennemis, alertes) | `#c0211a` |
| Caractères | Courier New, puis Consolas, Lucida Console |

Niveau d'une tour : lettre grasse, puis soulignée, puis en vidéo inverse. Sur la carte, les bandes vertes s'arrêtent : le terrain est un aplat tramé gris et le chemin reste en papier nu, pour que le trajet des ennemis se lise d'un coup d'œil.

### `enquete` : le dossier de la Sûreté, 1924

On a sous les yeux le dossier d'instruction : chemise cartonnée à sangle, tampon de la brigade, intercalaires à onglets de papier. Chaque suspect a une fiche de signalement à gabarit imprimé, remplie à la machine, avec un portrait au trait. Les dépositions sont des procès-verbaux dactylographiés, les indices des scellés à étiquette, le carnet un calepin quadrillé, l'accusation un mandat à remplir. Le temps qui reste est une montre de gousset.

| Rôle | Valeur |
| --- | --- |
| Bureau | `#2a3731` |
| Chemise | `#b3c1ad` ; intercalaires chamois `#d6bf90`, bulle `#e3d3a4`, rose `#dcb6a3`, ardoise `#b4bfc6` |
| Papier | `#f3eee1`, bristol `#efe5c9` |
| Encres | noire `#23212a`, violette de tampon `#45338a`, bleue `#1f478f`, rouge `#a3271f` |
| Machine à écrire | Courier New |
| Manuscrit | Ink Free, puis Segoe Print |
| Imprimés administratifs | Constantia, puis Book Antiqua |

L'effet de frappe (lettres pâlies ou descendues) reste léger et stable : ce jeu se lit beaucoup.

### `flux` : la planche du bureau d'études

Un plan de gaines de ventilation sur papier clair, avec son cadre, ses repères et un cartouche en bas à droite qui porte l'information utile (titre, numéro de planche, échelle qui suit le zoom, seuils d'étoiles). Parois en trait fort hachuré, retouches du joueur au feutre rouge, écoulement en lavis bleu avec filets à l'encre. Le débit se lit sur un cadran à aiguille, les niveaux se choisissent dans un meuble à plans.

| Rôle | Valeur |
| --- | --- |
| Table | `#55675d` |
| Papier | `#f1f2ec`, béton `#e9eae3` |
| Encre | `#1b2530` |
| Bleu (air, mesures) | `#1d4f8c` |
| Rouge (retouches du joueur) | `#cf3a1f` |
| Sépia (matière qu'on peut gommer) | `#8a6a3a` |
| Caractères | Bahnschrift seul (une DIN, la lettre du dessin technique) |

### `usine` : le sol de l'atelier

On regarde l'atelier d'en haut. La grille est une dalle de béton avec ses joints et ses repères de travée peints au pochoir ; les zones interdites sont bordées de jaune et noir. Les machines ont du volume et une forme chacune. L'habillage vient de l'usine : poutre de pont roulant en en-tête, bon de fabrication sur planchette à pince, compteurs à rouleaux, magasin en panneau perforé, pupitre à voyant et arrêt coup de poing.

| Rôle | Valeur |
| --- | --- |
| Béton | `#cdcac0` |
| Jaune de sécurité | `#f5b800`, avec noir `#1b1d1f` |
| Bleu d'outillage | `#1f5fa8` |
| Rouge (organes dangereux, arrêt) | `#c8281e` |
| Vert machine | `#2f9a4c` |
| Papier du bon | `#f7f7f0`, encre `#1d3f77` |
| Caractères | Bahnschrift condensé seul |

Diagnostic : triangle jaune pour une machine bloquée, rond bleu pour une machine à alimenter.

### `dev-tycoon` : le logiciel de gestion du personnel, 2003

Le jeu se joue dans une application Windows d'époque : barre de titre bleue, vrais menus, barre d'outils à icônes de 16 pixels, biseaux, barre des tâches. C'est le seul projet où les boîtes de dialogue modales sont légitimes. Le tricheur se repère à son écran qui passe à l'orange, et le prendre sur le fait lui colle un tampon « Flagrant délit ».

| Rôle | Valeur |
| --- | --- |
| Gris système | `#d4d0c8`, relief `#fff`, ombres `#808080` et `#404040` |
| Sélection, barre de titre | `#0a246a` |
| Bulle d'information | `#ffffe1` |
| Orange « Klode » (le tricheur) | `#e8601c` |
| Caractères | Tahoma, puis MS Sans Serif, Segoe UI |

### `ville-a-regles` : le plan de ville et son mât de signalisation

On est à l'entrée de la commune, devant son mobilier de voirie. À gauche, le panneau « plan de la ville » dans son cadre d'acier galvanisé : bandeau bleu, plan carroyé de A à L et de 1 à 8, légende en pied. À droite, un mât porte les panneaux empilés. Le premier est le panneau d'entrée d'agglomération, blanc à listel rouge : le nom qu'on y écrit est la graine. Chaque règle est un panneau de zone avec son signal : rond cerclé de rouge pour ce qui interdit ou limite, bleu pour ce qui indique ou oblige, triangle pour le tracé des rues. Une règle levée devient grise et barrée d'une diagonale, comme un panneau de fin de prescription. La vitesse du temps se règle avec des limitations de vitesse et un STOP octogonal, l'impôt sur une réglette en forme de chaussée à ligne discontinue. Ce qu'on désigne sur le plan s'affiche sur un panneau temporaire jaune.

| Rôle | Valeur |
| --- | --- |
| Ciel (fond) | `#c5d5dc` |
| Blanc des panneaux | `#f4f3ec` |
| Noir (lettres, listels) | `#16181b` |
| Rouge (ce qui interdit ou limite, alertes, véhicules à l'arrêt) | `#c4161c` |
| Bleu (ce qui indique ou oblige, bandeau, trajets) | `#0b4ea2` |
| Jaune temporaire (ce qu'on regarde : vue choisie, objet désigné, focus) | `#f7c800` |
| Acier galvanisé (mât, cadre, règles levées) | `#8f989b`, clair `#b3bbbd`, sombre `#5c6568` |
| Panneaux | Franklin Gothic Medium, puis Arial Narrow, Arial |
| Texte courant | Segoe UI, puis Tahoma, Verdana |

Le plan reste en couleurs, comme un plan de ville imprimé : rues blanches, avenues jaunes, boulevards orangés. Chaque teinte de toit est doublée d'un signe : trait pour les commerces, deux barres pour l'industrie, carré pour les bureaux, croix rouge pour la clinique ; zéro, une ou deux barres selon le rang des ménages. Le trafic se lit à l'épaisseur du trait autant qu'à sa couleur. La vue de près donne le carré du plan (« carré E4 »), comme un index des rues.

### `backrooms` : la signalétique de sécurité

Bureaux, parking, piscine, hôtel : quatre lieux qui n'ont rien en commun, sauf ce que le règlement visse à leurs murs. Tout ce qui recouvre la vue est donc de la signalétique. L'écran-titre est l'affiche de consignes, bandeau rouge « Consignes en cas d'égarement », une consigne par ligne avec son pictogramme, et la graine s'écrit au feutre bleu dans la case « Plan n° ». On entre en appuyant sur le bloc de secours, boîtier blanc à face verte et deux voyants. En jeu : une plaque de palier (numéro, lieu, puis un relevé temps / ruban / réveils), des jauges à dix crans précédées de leur pictogramme, un plan d'évacuation « Tu es ici, tenu de mémoire », les messages sur une plaque gravée noire. La pause rappelle les consignes, la fin de partie est le panneau vert du point de rassemblement. Les lieux en 3D gardent leurs couleurs et leur lumière : c'est le bâtiment, pas l'habillage.

| Rôle | Valeur |
| --- | --- |
| Blanc de plaque (affiche, plaques, sol du plan) | `#f4f3ec`, chant `#c9c8bf` |
| Encre (texte, murs du plan, plaque gravée) | `#16181a` |
| Vert de secours (ce qui mène dehors : sortie, bourdonnement, bloc « Entrer », point de rassemblement) | `#00874a` |
| Rouge d'incendie (bandeau des consignes, jauge à bout, ruban posé) | `#c4161c` |
| Jaune d'avertissement (ce dont on se méfie : les notes) | `#f9a900` |
| Bleu d'obligation (ce que le joueur fait : gestes, « tu es ici », écriture au feutre) | `#00558c` |
| Papier des notes punaisées, repris de la texture des murs | `#e4dec6`, encre `#464660` |
| Signalétique | Arial, titres en Arial Black, puis Helvetica |
| Écriture à la main (notes, case de la graine) | Segoe Print, puis Ink Free, Comic Sans MS |

La couleur suit le code des panneaux et la forme le double toujours : rond pour un geste, carré pour le secours, triangle pour la méfiance. Une jauge à bout passe du cran plein au cran hachuré ; sur le plan, la sortie est encadrée, une porte évidée, un mur tenu par le ruban percé d'un point, une note bordée de noir. Pas de voile sombre derrière l'affiche : elle est posée sur le mur du premier palier.

### `phare` : la salle de veille

La nuit en 3D reste le sujet ; tout ce qui la recouvre vient de la salle de veille d'un phare des années 1950, en deux matières qui ne se mélangent pas. Ce que dit la tour se lit sur un pupitre de tôle peinte et rivetée, en bas de l'écran : pendule de quart dont l'aiguille fait son tour en dix heures, de 20 h à 6 h, avec le numéro de la nuit dans un guichet ; trois manomètres à zone rouge pour le ressort, la cuve et les vitres ; voyant du feu avec son état dans un guichet ; voyant d'appel radio ; têtes de laiton pour la confiance ; porte-étiquette pour ce qu'on a en main. Ce que dit le gardien s'écrit à la plume dans le registre des Phares et Balises : journal de bord et cahier de veille radio en colonnes « Heure » et « Observations », messages du jeu sur une bande de papier réglé, écran-titre, pause et relève sur les pages du registre relié (dos de toile, coins de laiton), la relève en double page avec le bon de ravitaillement à droite. Aucun voile sombre : le registre est posé sur la vue, qui reste visible à côté. La carte du secteur est une carte marine.

| Rôle | Valeur |
| --- | --- |
| Tôle peinte (pupitre, mur de la lanterne) | `#2f4038`, clair `#4a5d53`, ombre `#1a2520` |
| Laiton (lunettes des cadrans, plaques, porte-étiquettes, coins du registre) | `#b08a3c`, clair `#dcc078`, ombre `#6b5220` |
| Émail des cadrans et papier du registre | `#ece5cf`, réglure `#9db3c4` |
| Noir (imprimé, graduations, aiguilles) | `#1b1b18` |
| Encre bleu-noir (tout ce que le gardien écrit) | `#1c2a4a` |
| Minium (zone rouge, état dangereux, navire en péril) | `#b02a20` |
| Lampe allumée (voyants, rien d'autre) | `#ffd27a` |
| Plaques gravées, intitulés de colonnes | Franklin Gothic Medium, puis Arial Narrow, Arial |
| Imprimé du registre | Cambria, puis Georgia, Times New Roman |
| Plume du gardien | Segoe Script, puis Segoe Print |

On ne clique pas un bouton, on signe le registre : chaque action de page est une ligne de signature pointillée (« Je prends le quart »), et le ravitaillement se commande dans des cases imprimées, un « + » à la plume ou une coche pour ce qui est acquis. Rien ne tient à la seule couleur : un état dangereux du feu passe en réserve sur rouge dans son guichet, une aiguille tombe dans la zone rouge, un message radio non lu est souligné au crayon rouge, et sur la carte un navire est plein s'il fait route, creux s'il hésite, cerclé s'il ne voit plus le feu, en croix s'il est perdu. Les navires vouvoient le gardien à la radio.

### `bureau-des-reclamations` : le guichet, vers 1978

On est assis derrière le guichet 7. La cloison laquée forme un L : en haut la plaque gravée du bureau, l'éphéméride et l'horloge à palettes, à gauche la vitre à hygiaphone derrière laquelle attend le plaignant. Le reste est le comptoir en formica orange, vu de dessus. La réclamation est une liasse autocopiante en trois exemplaires (l'original blanc, les doubles rose et jaune qui dépassent), imprimée en brun et remplie au stylo-bille. Le règlement est une affiche vissée sous plexiglas, où l'on cercle au feutre rouge l'article qui motive le refus. Les décisions se prennent avec trois tampons à manche de bois. Les notes de service et les bilans du soir sont des feuilles perforées posées sur le comptoir à la place de la liasse, pendant que le rideau métallique du guichet est baissé : il n'y a pas de fenêtre modale.

| Rôle | Valeur |
| --- | --- |
| Formica du comptoir | `#d47a2a`, ombre portée `#a3561a` |
| Cloison laquée | `#e9e1ca` ; aluminium des huisseries `#b4b8b1`, ombre `#7f847d` |
| Brun d'imprimerie (tout ce qui est imprimé, plaque, bois) | `#58310f` |
| Papier | `#fbfaf3` ; doubles rose `#f0b8c4` (papillon du contrôle) et jaune `#f4e07a` (bordereau du jour, rectificatifs) |
| Stylos-bille et encres de tampon | bleue `#1c3fa8`, noire `#1a1a1c`, verte `#1c7a3c`, rouge `#c4281c` |
| Signalétique et titres | Franklin Gothic Medium, puis Arial Narrow, Arial |
| Imprimés | Arial, puis Helvetica |
| Stylo-bille | Segoe Script, puis Segoe Print, Lucida Handwriting |

Le brun est réservé à l'imprimé, pour que les quatre couleurs de stylo, qui comptent dans le règlement, ne se confondent jamais avec le formulaire ; l'encre employée est en outre écrite en toutes lettres au bas de la liasse. Les trois empreintes se distinguent par leur forme autant que par leur couleur : cadre double pour « Approuvé », ovale pour « Refusé », deux filets et une flèche pour « Transmis ». Le contrôle répond par un papillon rose marqué d'une case ✓, ½ ou ✗. L'Administration vouvoie son agent, dans les notes de service comme dans les messages du contrôle.

### `chiptune` : la console de poche, 1989

« La Puce à l'oreille » est une console portable : coque gris chaud, lunette ardoise, écran à quatre verts, boutons bordeaux, inscriptions bleu marine. Tout ce qui est à l'écran est dessiné avec une police à points 5 × 7 faite pour l'outil.

| Rôle | Valeur |
| --- | --- |
| Coque | `#c9c6bc`, clair `#dedbd2`, ombre `#a3a096` |
| Écran | `#c8d0a2`, encre `#1c2a1b` |
| Lunette | `#5b5c6b` |
| Inscriptions | bleu marine `#2b2e78` |
| Boutons | bordeaux `#8d2157` |
| Caractères hors écran | Bahnschrift |

### Les outils graphiques : le fond neutre

`atelier-pixel`, `pantin`, `particules`, `eclairage`, `textures`, `palettes`, `tuiles`, `police-pixel`.

Ici le fond gris neutre n'est pas un défaut de parti pris, c'est une nécessité de métier : une interface colorée fausse le jugement des couleurs qu'on dessine. Ces huit outils forment une famille reconnaissable (barre de menus en haut, outils à gauche, toile au centre, réglages à droite), et chacun pousse l'idée dans son sens.

| Outil | Ce qui lui est propre |
| --- | --- |
| `atelier-pixel` | Gris `#18181a` à `#2c2c30`, ambre `#e8b04a` réservé à la sélection en cours. Frise d'animation en bas. |
| `pantin` | Le plan de travail est un tapis de découpe gris, quadrillé tous les 8 pixels. Le seul ornement est l'attache parisienne : une tête de laiton fendue `#d2ab52` marque chaque pivot, un fil clair la relie à la pièce qui la tient, et le même laiton désigne ce qui est choisi. Trois étapes numérotées (découper, monter, animer), parce que c'est vraiment une suite. Sur la frise, la forme d'une clé dit comment la pièce repart : rond en douceur, losange régulier, carré par à-coup. |
| `particules` | Le banc d'essai de l'artificier. Le seul ornement est la mèche lente : la frise des images est une corde de chanvre `#a88d63` qui part en cendre derrière une braise en pixels, et la même braise `#f0762e` désigne l'émetteur qu'on glisse sur la toile et ce qui est choisi. Le catalogue montre chaque préréglage par son propre effet, pas par une icône ; un sélecteur de fond (gris, nuit, jour, damier) sert à juger. |
| `eclairage` | Mêmes gris : le plateau d'un studio. L'ornement est aussi l'instrument : la boule grise mate des plateaux de tournage, rendue avec la vraie lumière, sur laquelle on glisse un point à la couleur de la source ; autour d'elle, le sprite éclairé des huit directions, en rose. Gélatine orange `#ee8a3c` pour ce qui est choisi, gélatine bleue `#5b8fd9` pour marquer les normales peintes à la main. La boule des normales, en pixels, se peint aux couleurs d'une carte de normales. Chiffres et titres en Bahnschrift. |
| `textures` | Mêmes gris. La tuile seule et son pavage côte à côte : la répétition est le sujet. |
| `palettes` | Aucune couleur d'accent, uniquement des gris (`#1a1a1a` à `#f4f4f4`). La seule couleur à l'écran est la palette, étalée sur toute la largeur. Un sélecteur de fond (noir, gris, blanc) sert à juger. |
| `tuiles` | La carte prend presque tout l'écran, avec des règles graduées en cases. Ambre `#e8b04a` pour l'outil actif, cyan `#5cb8c8` pour les objets. |
| `police-pixel` | Gris de plomb (`#27282c` à `#4b4f58`), papier `#e9e8e3`. L'interface est composée dans les polices que l'outil fabrique lui-même (Gaillarde pour les libellés, Gros-texte pour les titres). Vocabulaire de l'atelier de composition : la casse, l'épreuve. |

### `vitrail` : la table lumineuse du maître verrier

Les outils graphiques gardent un fond gris parce qu'on y juge des couleurs. Le verrier, lui, juge son verre à contre-jour : la référence neutre de son métier est la lumière, pas le gris. La table est donc le plateau blanc rétroéclairé de l'atelier, quadrillé comme un carton, serré dans son cadre noir ; c'est la seule audace. Autour, le zinc de l'établi, sans ornement, et la structure de la famille des outils (menus en haut, outils à gauche, réglages à droite). Un interrupteur à trois positions allume la table (verres à contre-jour, plombs noirs), l'éteint (côté atelier : verres sourds, plombs gris, soudures à l'étain) ou montre le carton numéroté, tel qu'il sera découpé en calibres. Le vocabulaire est celui du métier : plombs, pièces, carton, calibre, grisaille, filet. Le nom et les mesures du panneau, la réglette et les numéros du carton sont écrits au crayon sur la table.

| Rôle | Valeur |
| --- | --- |
| Lumière (le plateau de la table, rien d'autre) | `#fbfaf3` ; éteinte `#9b9e9a` ; carton `#efeee8` |
| Zinc de l'établi (barres, panneaux, menus) | `#d3d6d3`, clair `#e6e8e5`, chant `#a5aaa7` |
| Plomb (texte, plombs, outil en main, ce qui est choisi) | `#232527` ; plombs de jour `#1b1c1e` |
| Graphite (trait du carton, texte secondaire) | `#575b5f` |
| Crayon gras (avertissements de coupe, rien d'autre) | `#b5281f` |
| Étain (soudures, côté atelier) | `#9aa1a5` |
| Interface | Corbel, puis Segoe UI, Candara ; chiffres alignés, car Corbel les dessine elzéviriens |
| Crayon (mesures sur la table, numéros du carton) | Segoe Print, puis Ink Free |

Sans la couleur, les avertissements se lisent à leur forme : un cercle sur un coin fautif (pointe, angle rentrant), des tirets autour d'une pièce fautive tout entière, une croix au bout d'un plomb qui ne rejoint rien. Une pièce sans verre est hachurée. La pièce choisie est cernée d'un double trait blanc et plomb, tireté, qui se lit sur n'importe quel verre. Les plaques de verre portent leur chiffre de clavier, et le carton numérote chaque pièce avec une pastille de sa couleur.

### `decompil-3ds` : l'établi du réparateur

La console est ouverte sur un tapis antistatique bleu, et sa carte mère sert de sommaire. Chaque composant renvoie à sa feuille : le connecteur de cartouche J1 au jeu, le processeur U1 à la carte du système, la FCRAM U2 aux formats de Pokémon X, la NAND U3 aux outils, le lecteur microSD J2 aux exercices, le port UART J3 au journal. L'avancement se lit en sérigraphie dans le cartouche, en bas à droite. Sept points de test, TP1 à TP7, sont les sept paliers : vides, à moitié ou pleins d'or, et leur piste passe à l'or quand le palier est terminé. Tout ce qu'on écrit est sur des feuilles de papier posées à plat, avec une ombre franche couleur de tapis, sans arrondi. Elles sont titrées par une étiquette Dymo qui déborde du coin : bande noire, lettres blanches en capitales, parce que l'étiqueteuse n'écrit qu'en capitales. Une bande « Tu es ici », sous la carte, donne le palier en cours et le prochain geste. C'est la seule audace : la carte. Le reste est sobre.

| Rôle | Valeur |
| --- | --- |
| Tapis antistatique (fond), ombre des feuilles | `#2e4d63`, ombre `#243d4e` |
| Vernis épargne, pistes, sérigraphie | `#1b5e36`, `#154a2b`, `#eef1ea` |
| Or des pastilles (ce qui est acquis : palier fait, outil présent, piste raccordée ; focus clavier) | `#d6a73b`, ombre `#9c7420` |
| Étain (broches, lecteur microSD), plastique des connecteurs, boîtier des puces et bande Dymo | `#c3c9cd`, `#3a3f45`, `#15181c` |
| Papier, filets, encre, encre pâle | `#f6f5ef`, `#dedcd2`, `#1e2226`, `#5a6168` |
| Marqueur rouge (ce qui bloque : outil absent, dump chiffré ; lien survolé) | `#c8321f` |
| Sérigraphie et étiquettes Dymo | OCR A Extended, puis OCR A Std, Consolas |
| Texte des feuilles | Segoe UI, puis Tahoma, Verdana |
| Adresses, commandes, chemins, relevé | Consolas, puis Lucida Console, Courier New |

Sans la couleur, les états se lisent à leur forme. Une pastille est pleine si c'est fait ou présent, en demi-disque si c'est entamé, vide si c'est à faire ou absent, barrée d'une diagonale pour un outil que le PC ne peut pas voir, comme GodMode9 sur la console. Les tâches ont des cases à cocher imprimées, et une tâche faite passe en encre pâle. Ce qui bloque est en rouge, précédé d'un ✗.

### `explorateur-romfs` : la réserve du musée et son meuble à tiroirs

Le romfs extrait est une collection inventoriée. À gauche, le meuble de fichier en chêne sert d'arbre, et c'est la seule audace : chaque dossier est une façade de tiroir avec son porte-étiquette de laiton, sa carte tapée à la machine et sa poignée ; un tiroir ouvert laisse voir son intérieur sombre, et les montants s'empilent à chaque niveau. Les GARC et les paquets « mini » sont des boîtes de conservation grises, avec leur prise et leur étiquette ; les fichiers sont des fiches vues par la tranche. À droite, la fiche de catalogue de la pièce choisie (carton réglé, filet noir sous la cote, trou de tringle) porte sa nature, sa taille et ses tampons. Dessous, sur la table d'examen en linoléum, la pièce est posée sur un relevé à onglets de papier : bordereau, texte, hexadécimal, image, modèle 3D, recherche. Les contrôles sont des tickets de carton à ombre franche ; seule l'ouverture d'un dossier est une plaque de laiton.

| Rôle | Valeur |
| --- | --- |
| Chêne du meuble (façades) | `#8a5a2b`, arête `#a8743f`, joints `#5b3a1b` |
| Intérieur d'un tiroir ouvert | `#3e2914` |
| Laiton (porte-étiquettes, poignées, ce qui est choisi, focus) | `#c9a24b`, ombre `#8a6d2a` |
| Carton des fiches | `#f4ecd8`, réglure `#d6c9a8` |
| Boîtes de conservation (GARC, paquets) | `#7e8b90`, ombre `#5c686d` |
| Linoléum de la réserve, table d'examen | `#b4b8ac`, ombre `#9a9f92` ; papier du relevé `#fbf9f2` |
| Encre de machine et de tampon | `#262320`, pâle `#6b6358` |
| Rouge de tampon (ce qui n'a pas pu être lu, rien d'autre) | `#b3261e` |
| Tapé à la machine (étiquettes, cotes, textes du jeu, hexadécimal) | Courier New, puis Courier, Nimbus Mono PS |
| L'outil | Segoe UI, puis Tahoma, Helvetica Neue |

Le tampon dit la nature, et sa forme la double : double cadre pour un GARC, cadre pincé pour le LZ, ovale pour un texte, hexagone pour un BCH, traits de coupe pour une image, chemise à onglet pour un paquet, cadre simple pour un format connu mais pas ouvert, tirets pour l'inconnu, croix pour l'illisible. Tous sont à l'encre noire sauf l'illisible, seul tampon rouge, précédé d'un ✗ dans le texte. Un fichier compressé reçoit deux tampons : LZ11, puis ce qu'il contient. Les variables des textes restent visibles telles que pk3DS les écrit, encadrées d'un filet. Zoom à la molette centré sur le curseur pour les images, glisser pour déplacer, `0` pour la vue d'ensemble.

### `visionneuse-bch` : la vitrine de la galerie

Le modèle est un spécimen exposé dans une vitrine de muséum, la galerie où l'on montre ce que l'explorateur de romfs a sorti de la réserve. La vitrine est un cadre de bois sombre et de verre ; sa corniche porte les commandes de la vitrine (vue, fond, grille, squelette, tournette). Le spécimen tourne sur une tournette de bois tourné cerclée de laiton, rendue en 3D avec lui : c'est la seule audace. Le fond de la vitre reste neutre pour qu'on juge le modèle, avec un sélecteur gris, noir, blanc ou damier. Sous la vitre, le socle porte la plaque de laiton gravée (le nom du fichier en italique, comme un nom d'espèce, puis le modèle, les sommets, les faces, les os et les animations) et le lecteur d'animations : une manivelle, dont un vingt-quatrième de tour avance d'une image et qu'un clic lance ou arrête, et deux réglettes de laiton graduées pour l'image et la vitesse. À droite, la fiche de collection est un cartel de papier : numéro d'inventaire, puis les rubriques Spécimen, Maillages, Textures, Squelette, Animations et Observations.

| Rôle | Valeur |
| --- | --- |
| Mur de la galerie | `#c4bdae`, ombre `#a8a091` |
| Bois sombre (vitrine, corniche, socle) | `#3b2a1e`, clair `#5a4030`, ombre `#24180f` |
| Laiton (plaque, manivelle, réglettes, ce qui est choisi) | `#c9a24b`, clair `#e3c77e`, ombre `#8a6a28` |
| Verre (arête de la vitre, reflet du coin) | `#9fb3ae` |
| Papier du cartel | `#f1ead8`, filets `#d6c9a9` |
| Encre | `#2a2018`, pâle `#6b5d4c` |
| Rouge (ce qui n'a pas pu être lu, rien d'autre) | `#a3301f` |
| Plaques et cartel | Cambria, puis Georgia |
| Outil | Segoe UI, puis Tahoma, Verdana |

La forme double la couleur : un maillage caché a sa case vide et son nom barré ; l'animation choisie porte un losange plein ◆, les autres un losange creux ◇ ; le fond choisi est cerclé de laiton et coché ; ce qui n'a pas été lu commence par ✗. Aucun voile sombre : la vitrine vide garde sa tournette, et le cartel d'invitation est posé dessus.

### `carte-des-services` : le plan du réseau

Le système de la 3DS vu depuis un jeu, dessiné comme le plan d'un réseau de métro. Chaque module système est une ligne avec son numéro, chaque service une station. Le jeu est la gare centrale d'où toutes les lignes partent en faisceau, à 45°, vers deux rives : le système, les fichiers, l'image et les entrées à droite, le réseau et les réglages à gauche. Le matériel (pxi, i2c, spi, gpio, pdn, mcu, codec) forme sous le réseau une ceinture de lignes en tirets ; pxi franchit la rivière qui sépare l'ARM11 de l'ARM9 et finit à Process9. Le panneau de droite est le panneau de la station : ses horaires sont les commandes IPC, en tableau. Le guichet d'information, en haut, comprend un nom, un en-tête IPC, un numéro de SVC ou une adresse. Le plan du quartier est la mémoire, ancienne 3DS et New 3DS côte à côte, en îlots dont la hauteur suit le logarithme de la taille. Une seule audace, le plan ; le reste est sobre.

| Rôle | Valeur |
| --- | --- |
| Papier du plan | `#f7f7f4` |
| Encre (texte, bandeau, gare, cadres) | `#1b1d21`, pâle `#5d6168` |
| Surligneur (ce qui est trouvé ou choisi, rien d'autre) | `#ffe14a` |
| Rivière ARM11 / ARM9 | `#cfe2ec`, berge `#9fc2d6` |
| Lignes, une couleur par famille | Système rouge vermillon `#d6332a`, Fichiers bleu outremer `#2c4cb8`, Image vert émeraude `#0f8a55`, Caméra et vidéo violet `#8b3fb0`, Son rose `#e2589c`, Entrées orange `#e58200`, Réglages brun `#8a4b22`, Sans fil local turquoise `#0a9fae`, Internet vert olive `#78900f`, Services en ligne bleu ciel `#3a90e6`, Matériel gris acier `#6b7079` |
| Signalétique (plan, fiches) | Segoe UI, puis Helvetica Neue, Arial |
| En-têtes IPC, adresses, SVC | Consolas, puis Cascadia Mono, Lucida Console |

Les 42 lignes se partagent onze couleurs, une par famille. Dans une famille, on les distingue par le numéro et le nom du module au terminus. L'ordre des couleurs a été vérifié pour le daltonisme entre familles voisines sur le plan. Sans la couleur, tout se lit encore à la forme :
- les services en ligne ont un trait double ;
- le matériel a des tirets et des plaques carrées ;
- une station ouverte aux jeux est un rond blanc cerclé d'encre, un service réservé au système une coche ;
- les pastilles numérotées sous une station donnent les lignes qui l'appellent ;
- ce qui est trouvé est surligné et cerclé plus épais, le reste du réseau pâlit ;
- dans le plan du quartier, un îlot hachuré diffère entre les deux modèles.

### `mondes` : le guide de voyage

`atlas-des-mondes`, `chroniques`, `langues-inventees`, `steles`.

Les quatre pages sont quatre chapitres d'un même guide touristique imaginaire, les « Guides de l'Écliptique, destinations hors système ». On ne consulte pas un générateur : on feuillette le guide d'une destination qui se trouve être un monde inventé. Le chapitre 1 est la planète (fiche d'identité, « Avant de partir », carte générale, milieux naturels, le peuple, villes et étapes notées en étoiles, chacune renvoyant à son plan), le chapitre 2 « Un peu d'histoire », le chapitre 3 le « Petit guide de conversation », le chapitre 4 le « Cahier de l'épigraphiste ».

La mise en page reprend le vocabulaire des guides imprimés : titre courant avec folio en haut de page, onglets de chapitre sur la tranche droite, sommaire du chapitre à points de conduite dans la marge, encadrés tramés « Bon à savoir », pastilles de renvoi numérotées partagées entre la carte et le texte, légendes « Fig. n » sous les planches d'espèces. Les curseurs qui modifient la planète sont un encart assumé, le « Baromètre du voyageur », fait de réglettes graduées. Le globe est le frontispice, posé sur un aplat noir comme une photo de couverture.

| Rôle | Valeur |
| --- | --- |
| Papier | `#f4f4ef`, blanc des planches `#fcfcfa` |
| Noir (texte, filets, boutons) | `#000`, gris secondaire `#54544e` |
| Magenta de collection (bandeau, onglet courant, pastilles, étoiles, réglettes) | `#c4165c`, foncé pour les liens `#8f0f43` |
| Trames des encadrés | `#f9ebf0` (magenta), `#e6e6df` (neutre), `#f1d3df` (onglets inactifs) |
| Titres, notices, tableaux | Bahnschrift étroit, puis Arial Narrow |
| Texte courant | Palatino Linotype, puis Book Antiqua, Georgia ; italique pour les chapôs, les légendes et les mots de la langue inventée |

Aucun arrondi sauf les pastilles rondes. Les cartes et les créatures restent en couleurs : ce sont les illustrations du guide. Zoom à la molette sur la carte générale et sur la carte historique, de ×1 à ×14, avec une carte qui boucle d'est en ouest.

Le chapitre 4, « Cahier de l'épigraphiste » (onglet « Les stèles »), est le cahier pratique du guide : le seul chapitre où le lecteur écrit. Le jeu de déchiffrement y prend les formes d'un cahier imprimé à remplir. Les sites de fouilles sont des pastilles sur la carte, reprises dans la liste voisine avec les numéros de la carte générale (les ruines prennent les numéros qu'elle laisse libres). Chaque stèle est une planche de relevé légendée « Fig. site.rang », où chaque mot porte sa translittération et une ligne pointillée qui attend son sens. Le mot à l'étude s'ouvre dans un encadré tramé : signes en cases jointives, sons proposés sur une réglette de cases, sens et noms de cités en cases à cocher imprimées. Viennent ensuite le carnet de vocabulaire, les notes de grammaire et la chronique à compléter, qui renvoie à chaque figure.

Les états s'y lisent sans la couleur. Un site ouvert a une pastille magenta, un site entièrement traduit une pastille noire avec une coche, un site à fouiller une pastille blanche cerclée de noir. Un sens établi est en romain sur filet plein, une hypothèse en italique avec un point d'interrogation sur pointillé. Une case choisie est noire et cochée, une case déjà employée ailleurs est hachurée, une case écartée est barrée d'une croix. Une stèle porte un tampon plein « ✓ Traduite » ou un tampon en tirets « À traduire » ; les avis commencent par ✓ ou ✕. Les familles d'événements reprennent les signes du chapitre 2 (carré, triangle, losange, rond, couronne). Les reliefs sculptés et les pictogrammes du vocabulaire sont imprimés en noir, comme des clichés tramés.

## Ajouter un projet

1. **Trouver l'objet.** Quel objet réel est-ce ? Vérifier qu'il n'est pas déjà pris (liste ci-dessus) et qu'il vient du sujet, pas d'une envie de style.
2. **Écrire le plan avant le code** : quatre à six couleurs nommées avec leur rôle, deux familles de caractères, un schéma de mise en page. Relire la liste « Ce qu'on s'interdit ».
3. **Dépenser l'audace à un seul endroit** : un élément mémorable (le cadran, le tampon, le tube cathodique), et le reste sobre et lisible.
4. **Prévoir le zoom à la molette** dès qu'il y a une grille ou une carte.
5. **Brancher le site** :
   - charger `../portail/site.js` à la fin du `<body>`, et laisser libres les 8 pixels du haut au centre de la page ;
   - ajouter l'icône d'onglet du projet dans la table `ICONS` de `portail/site.js` (fond, encre, lettre) ;
   - ajouter la boîte dans `portail/app.js` (titre, dossier, format de l'adresse si le projet a une graine, largeur et hauteur de la tranche) ;
   - dessiner sa tranche dans `portail/style.css` (classe `.b-<id>`), aux couleurs du projet ;
   - déposer une vignette `portail/apercus/<id>.webp` de 640 × 400 ;
   - ajouter une ligne au `README.md`.
6. **Regarder le résultat** sur des captures, en 1366 × 768 et en fenêtre étroite, et se demander honnêtement si l'on voit l'objet ou une page web déguisée.
7. **Jouer une vraie partie** jusqu'à la fin, victoire et défaite, avec les vraies commandes, en 1366 × 768, 1100 × 700 et 420 de large. Les défauts qui comptent (bouton poussé hors de l'écran, message caché sous une barre, chemin qui ne se lit pas) n'apparaissent pas sur l'écran d'accueil.

## Limites connues

- **Polices de Windows.** Bahnschrift, Sitka, Gabriola, Ink Free, Constantia, Palatino Linotype, Tahoma et Consolas sont livrées avec Windows. Sur macOS, Linux ou un téléphone, les polices de repli prennent le relais ; elles ont été choisies avec soin mais n'ont pas été regardées. Le rendu sera correct, moins caractérisé.
- **Navigateurs.** Tout a été vérifié dans Chrome. Firefox et Safari n'ont pas été essayés.
- **Tactile.** Le pincement à deux doigts est codé dans plusieurs projets et n'a été essayé qu'en émulation.
- **Petits écrans.** Les projets visent 1366 × 768. Plusieurs restent utilisables sur téléphone sans y être confortables (le Minitel donne des caractères d'environ 9 pixels, la grille du séquenceur défile).
- **Échelle d'affichage.** L'interface de `police-pixel`, composée en police pixel, est nette à 100 % et plus douce à 125 ou 150 %.
- **L'étiquette de retour** occupe 7 pixels en haut au centre de chaque page. Elle peut recouvrir un détail de décor ; aucune commande ne se trouve dessous.
