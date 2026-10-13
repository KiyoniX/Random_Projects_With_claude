# Les fiches de reverse de la console

Une fiche par module système de la New 3DS, écrite à partir du module dumpé de la console. Chaque fiche a la même forme : carte d'identité, structure, tableaux des commandes avec leur fonction et leur adresse, une opération décrite pas à pas, tables en mémoire, appels système, puis ce qui est sûr, ce qui est interprété et ce qui n'est pas lu.

À côté de chaque fiche, un fichier `<module>.noms.tsv` : une adresse, `function` ou `label`, un nom en anglais. C'est le fichier de graines que REA recharge (`outils/REA.md`, partie 4 bis) ; les noms sortent alors dans le pseudo-code. Le pseudo-code brut n'est pas versionné, il reste dans `local/analyse/<module>/`.

| Fiche | Module | Ce qu'on y trouve | Fonctions nommées |
| --- | --- | --- | --- |
| [sm](sm.md) | le registre des services | la boucle de service, les 18 commandes de `srv:` et `srv:pm`, GetServiceHandle pas à pas | 40 sur 117 |
| [hid](hid.md) | les boutons et les capteurs | un fil par client, l'aiguillage de 24 commandes commun à quatre services, la mémoire partagée où les jeux lisent les boutons | 186 sur 301 |
| [loader](loader.md) | le chargement des programmes | LoadProcess en 8 étapes, la décompression du code vérifiée sur Pokémon X, les pages de chaque section | 92 sur 134 |
| [pm](pm.md) | le lancement des programmes | les 16 commandes de `pm:app` et `pm:dbg`, LaunchTitle en 12 étapes, la fin d'un processus | 127 sur 175 |
| [fs](fs.md) | les fichiers | les 136 commandes de `fs:USER`, celles d'un fichier et d'un dossier ouverts, un chemin complet jusqu'à Process9, les archives | 330 sur 1 995 |
| [gsp](gsp.md) | l'écran et le processeur graphique | les commandes de `gsp::Gpu` et `gsp::Lcd`, la mémoire partagée, la file de commandes graphiques, le relais des interruptions | 265 sur 418 |
| [pxi](pxi.md) | le passage vers Process9 | les neuf services et leur canal, une requête de `fs` suivie jusqu'aux registres PXI et retour | 103 sur 151 |
| [ns](ns.md) | la vie des applications (`APT`) | les 93 commandes d'`APT`, le démarrage d'un jeu pas à pas, le bouton HOME, `ns:s` | 309 sur 919 |
| [dsp](dsp.md) | le processeur de son | les 32 commandes de `dsp::DSP`, LoadComponent en 18 étapes vérifié sur le composant de Pokémon X, les tuyaux, le sémaphore | 189 sur 276 |
| [cfg](cfg.md) | les réglages de la console | 115 commandes sur quatre services, les 65 blocs de configuration, GetConfigInfoBlk2 pas à pas | 440 sur 686 |
| [ptm](ptm.md) | la batterie, le couvercle, la veille | cinq aiguillages, les notifications publiées, la mise en veille en 15 étapes | 317 sur 813 |

Ordre de lecture conseillé : `sm` (le plus court, il pose le vocabulaire), `hid`, puis `loader` et `pm` ensemble (ils se répondent), puis `fs` et `pxi` (la seconde prolonge la première), `gsp`, et `ns`, `dsp` et `cfg`, les services qu'un jeu appelle dès son démarrage. `ptm` complète `hid` et `ns` sur la veille.

Trois modules sont presque entièrement en Thumb (`fs`, `cfg`, `ptm`) : par le pont REA on n'en voit qu'une partie, et leurs fichiers de noms contiennent des lignes `label`. Pour les ouvrir en entier, chaque fiche renvoie au script Ghidra gardé dans `local/analyse/<module>/ghidra/`.

Les fiches se recoupent entre elles, et ces recoupements sont notés dans chacune : les requêtes que `pm` envoie à `loader`, celles que `ns` envoie à `pm`, la requête de lecture de `fs` reprise par `pxi`, les blocs d'étalonnage de `cfg` lus par `hid`, les notifications de veille publiées par `ptm` et reçues par `hid`.

Chaque fiche se termine par ses limites. Les parties « interprété » sont à relire dans Ghidra avant de s'appuyer dessus.
