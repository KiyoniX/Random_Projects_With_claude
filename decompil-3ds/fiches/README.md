# Les fiches de reverse de la console

Trois sortes de documents. Les **fiches de modules** décrivent chacune un module système de la New 3DS, lu dans le module dumpé de la console. L'**inventaire** fait le chemin inverse : il part du code de Pokémon X et relève tout ce que le jeu peut demander à la console. Les **contrats** relient les deux : pour un service, chaque commande que le jeu envoie est lue des deux côtés, dans le jeu et dans le module, avec ce qu'il faudra rendre à la place de la console sur PC.

Tous suivent la même règle : ce qui est sûr (vérifié par deux voies indépendantes), ce qui est interprété, et ce qui n'est pas lu, séparés à la fin de chaque document. Les parties « interprété » sont à relire dans Ghidra avant de s'appuyer dessus.

## Les fiches des modules

Chaque fiche a la même forme : carte d'identité, structure, tableaux des commandes avec leur fonction et leur adresse, une opération décrite pas à pas, tables en mémoire, appels système, puis ses limites.

À côté de chaque fiche, un fichier `<module>.noms.tsv` : une adresse, `function` (ARM), `label` (Thumb, ou une donnée hors du code) ou `data` (une donnée posée au milieu du code, comme la table des appels système de kernel11 ; lue par `ghidra_direct.py`, pas par REA), un nom en anglais (une ligne sans nom est une simple graine : elle demande à REA une fonction à cette adresse). C'est le fichier de graines que REA recharge (`outils/REA.md`, partie 4 bis) ; les noms sortent alors dans le pseudo-code. Le pseudo-code brut n'est pas versionné, il reste dans `local/analyse/<module>/`.

| Fiche | Module | Ce qu'on y trouve | Fonctions nommées |
| --- | --- | --- | --- |
| [sm](sm.md) | le registre des services | la boucle de service, les 18 commandes de `srv:` et `srv:pm`, GetServiceHandle pas à pas | 40 sur 117 |
| [hid](hid.md) | les boutons et les capteurs | un fil par client, l'aiguillage de 24 commandes commun à quatre services, la mémoire partagée où les jeux lisent les boutons | 186 sur 301 |
| [loader](loader.md) | le chargement des programmes | LoadProcess en 8 étapes, la décompression du code vérifiée sur Pokémon X, les pages de chaque section | 92 sur 134 |
| [pm](pm.md) | le lancement des programmes | les 16 commandes de `pm:app` et `pm:dbg`, LaunchTitle en 12 étapes, la fin d'un processus | 127 sur 175 |
| [fs](fs.md) | les fichiers | les 136 commandes de `fs:USER`, celles d'un fichier et d'un dossier ouverts, un chemin complet jusqu'à Process9, les archives | 330 sur 1 995 |
| [gsp](gsp.md) | l'écran et le processeur graphique | les commandes de `gsp::Gpu` et `gsp::Lcd`, la mémoire partagée, la file de commandes graphiques, le relais des interruptions | 265 sur 418 |
| [pxi](pxi.md) | le passage vers Process9 | les neuf services et leur canal, une requête de `fs` suivie jusqu'aux registres PXI et retour | 103 sur 151 |
| [ns](ns.md) | la vie des applications (`APT`) | les 93 commandes d'`APT`, le démarrage d'un jeu pas à pas, le bouton HOME, `ns:s` | 321 sur 919 |
| [dsp](dsp.md) | le processeur de son | les 32 commandes de `dsp::DSP`, LoadComponent en 18 étapes vérifié sur le composant de Pokémon X, les tuyaux, le sémaphore | 189 sur 276 |
| [cfg](cfg.md) | les réglages de la console | 115 commandes sur quatre services, les 65 blocs de configuration, GetConfigInfoBlk2 pas à pas | 440 sur 686 |
| [ptm](ptm.md) | la batterie, le couvercle, la veille | cinq aiguillages, les notifications publiées, la mise en veille en 15 étapes | 317 sur 813 |
| [ro](ro.md) | le chargeur des modules `.cro` | les 9 commandes de `ldr:ro`, LoadExeCRO en 15 étapes, les relocations en formules vérifiées par exécution, la liaison des imports dans les deux sens, le déchargement | 123 sur 180 |

Le tableau s'allongera à mesure que d'autres parties du système seront lues.

Trois modules sont presque entièrement en Thumb (`fs`, `cfg`, `ptm`) : par le pont REA on n'en voit qu'une partie, et leurs fichiers de noms contiennent des lignes `label`. Pour les ouvrir en entier : `python outils/ghidra_direct.py <module>` lance Ghidra directement, crée les fonctions Thumb, pose les noms et range le pseudo-code dans `local/analyse/<module>/gh/` ; `python outils/emulate_dispatch.py <module> <adresse>` redonne la table de commandes d'un aiguillage en l'exécutant (`outils/REA.md`, partie 4 bis). Les fiches de `fs`, `cfg` et `ptm` renvoient encore aux scripts d'origine de leurs auteurs, que ces deux outils remplacent.

Les fiches se recoupent entre elles, et ces recoupements sont notés dans chacune : les requêtes que `pm` envoie à `loader`, celles que `ns` envoie à `pm`, la requête de lecture de `fs` reprise par `pxi`, les blocs d'étalonnage de `cfg` lus par `hid`, les notifications de veille publiées par `ptm` et reçues par `hid`.

## Ce qui n'est pas un module : le noyau, l'ARM9, les mémoires de démarrage

Ces binaires n'ont ni exheader ni code.elf : ce sont des images brutes, chargées à leur adresse dans Ghidra (sous WSL), parfois après une recopie ou un déchiffrement qu'il faut d'abord refaire. Chaque document a la forme d'une fiche (sûr, interprété, pas lu, et comment il a été fait), mais suit le binaire plutôt qu'une liste de commandes. Aucune clé ni donnée propre à la console n'y figure.

| Document | Binaire | Ce qu'on y trouve | Fonctions nommées |
| --- | --- | --- | --- |
| [kernel11](kernel11.md) | le noyau ARM11 (version 2.58-0) | la carte des adresses reconstituée, le démarrage jusqu'aux cinq modules du FIRM, les 126 appels système, les 20 classes d'objets, une requête IPC, ControlMemory et ArbitrateAddress pas à pas | 359 sur 988 |
| [process9](process9.md) | l'ARM9 : kernel9 et Process9 | la section ARM9 du FIRM découpée, kernel9 et ses 40 appels, le PXI vu de l'ARM9, 222 commandes sur six services, le romfs du jeu (archive `0x2345678E`) pas à pas jusqu'au déchiffrement AES | 385 sur 4 797 (et 46 sur 497 pour kernel9) |
| [boot9-boot11](boot9-boot11.md) | les deux mémoires de démarrage | le démarrage pas à pas jusqu'au saut dans le FIRM, la signature RSA et les empreintes des sections, ce que kernel11 et Process9 trouvent en mémoire en arrivant | 258 sur 564 (boot9), 109 sur 227 (boot11) |

## Le jeu : ce que Pokémon X peut demander

| Document | Ce qu'on y trouve |
| --- | --- |
| [pokemon-x-services](pokemon-x-services.md) | les 408 fonctions d'envoi du code de la mise à jour, une par commande, rangées par service (23 services et deux ports) ; comment le jeu ouvre ses services ; la séquence de démarrage, du point d'entrée à la boucle principale ; les modules `.cro` (133 fichiers et `static.crs`) et leur format ; le bilan pour le portage, service par service |
| `pokemon-x-services.tsv` | le tableau complet, une ligne par commande : service, en-tête, nom de la commande d'après la Carte des services, fonction du jeu, nombre d'appelants, module, preuve du service, d'où la fonction est atteinte |
| `pokemon-x.noms.tsv` | les noms de fonctions du jeu, au format des fichiers de noms des modules : 920 lignes, dont les 285 adresses des noms C++ que le jeu a gardés dans `static.crs`, et 172 noms venus des contrats. `python outils/ghidra_direct.py maj` les pose dans le pseudo-code |

L'inventaire ne relève que les en-têtes. Les paramètres et les réponses sont dans les contrats, qui ont aussi corrigé l'inventaire (l'ordre du démarrage d'APT, le repli de `cfg`, ce que `ro` doit faire) ; chaque correction y est signalée là où elle s'applique.

## Les contrats : chaque commande lue des deux côtés

Un contrat prend un service, et pour chaque commande que Pokémon X envoie, met en face la fonction d'envoi du jeu et la fonction du module qui la reçoit : deux preuves indépendantes. Il dit ce que le jeu écrit, ce que le module en fait, ce que le jeu fait de la réponse, et ce qu'un programme qui prend la place de la console doit rendre. Chacun se termine par les désaccords trouvés (entre le jeu, le module, 3dbrew, la Carte et les fiches), puis par ses limites.

| Contrat | Service | Ce qu'on y trouve | Commandes lues des deux côtés |
| --- | --- | --- | --- |
| [contrat-apt](contrat-apt.md) | `APT:U` (module `ns`) | une session par commande sous un verrou ; le dialogue de démarrage en neuf réponses ; le fil d'APT du jeu et ses notifications ; le bouton HOME vu du jeu | 27 sur 29 ; les 2 autres lues côté jeu, survolées côté module |
| [contrat-gsp](contrat-gsp.md) | `gsp::Gpu` | la séquence jusqu'à la première image ; la file de commandes graphiques et les interruptions relayées ; les tampons d'écran ; les 68 écritures de registres du chemin `0x2A07` | 14 sur 14, et les 6 commandes de la file |
| [contrat-dsp](contrat-dsp.md) | `dsp::DSP` | le démarrage du son, rejoué dans un émulateur ; les 15 adresses de la mémoire partagée ; la boucle de son, qui n'envoie aucune commande ; le décodeur AAC | 13 sur 13 |
| [contrat-fs](contrat-fs.md) | `fs:USER`, un fichier ouvert, un dossier ouvert | le romfs ouvert comme un seul fichier et lu par le jeu lui-même ; ce que `fs` fait de l'archive `0x00000003` ; la sauvegarde et les données étendues ; l'écart sur GetExtDataBlockSize | 43 sur 43 (le corps du module lu en entier pour 36) |
| [contrat-petits-services](contrat-petits-services.md) | `srv:`, `hid:USER`, `cfg:u`, `ptm:u`, `err:f`, `ldr:ro` | les notifications que le jeu écoute ; ce qu'il lit dans la mémoire de `hid` ; les 16 blocs de configuration qu'il demande ; l'écran d'erreur ; le gestionnaire de modules `.cro` | 17 sur 22 ; `err:f` et `ldr:ro` lus côté jeu seulement (le côté `ro` est lu depuis dans sa fiche) |

Les noms de fonctions que les contrats proposent sont versés dans `pokemon-x.noms.tsv` (côté jeu) et dans les fichiers de noms des modules (côté module).

## Ordre de lecture

Pour la console seule : `sm` (le plus court, il pose le vocabulaire), `hid`, puis `loader` et `pm` ensemble (ils se répondent), puis `fs` et `pxi` (la seconde prolonge la première), `gsp`, et `ns`, `dsp` et `cfg`, les services qu'un jeu appelle dès son démarrage. `ptm` complète `hid` et `ns` sur la veille.

Pour le portage de Pokémon X : l'inventaire d'abord (`pokemon-x-services`, parties 2 et 4 au moins), puis les contrats dans l'ordre du démarrage du jeu : `contrat-petits-services` (`srv:` est le premier guichet ouvert, et `cfg`, `hid`, `ptm` suivent), `contrat-apt`, `contrat-fs`, `contrat-gsp`, `contrat-dsp`. Chaque contrat renvoie à la fiche du module quand il faut le détail d'une fonction.
