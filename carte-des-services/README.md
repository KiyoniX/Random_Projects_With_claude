# Carte des services

Le système de la 3DS dessiné comme le plan d'un réseau de transport, vu depuis un jeu. Chaque module système est une ligne, chaque service une station, et le jeu est la gare centrale. Ouvre `index.html` : tout marche hors ligne, les données sont embarquées dans `donnees.js`.

Quand tu lis un jeu dans Ghidra et que tu tombes sur un en-tête IPC (`0x080201C2`), un `svc 0x32` ou une adresse (`0x1FF82000`), tape-le au guichet d'information : la page te dit ce que c'est et renvoie à la page 3dbrew d'où vient l'information.

## Ce qu'il y a dedans

- **Le plan du réseau** : 42 modules et 150 services. Une station ronde est ouverte aux jeux, une coche est réservée au système. Les petites pastilles sous une station donnent les lignes qui l'appellent, quand 3dbrew le dit ou quand le code de la console le montre.
- **Les horaires d'une station** : ses commandes IPC, avec l'en-tête, le nom, le nombre de paramètres, et pour les pages lues, les mots de la requête et de la réponse.
- **Le plan du quartier** : la mémoire vue par le jeu, la mémoire physique et le partage de la FCRAM, ancienne 3DS et New 3DS côte à côte.
- **Les appels système** : la liste filtrable des SVC.

Molette pour rapprocher, glisser pour déplacer, `0` pour revenir à la vue d'ensemble, `/` pour aller au guichet.

## Les données

Elles viennent de [3dbrew](https://www.3dbrew.org/wiki/Services_API), lu par la Wayback Machine. Les pages de chaque commande n'ont pas toutes pu être lues : celles qui manquent portent la mention « page non lue », et l'en-tête suffit alors à compter les paramètres. Les rôles des modules, en français, sont écrits à la main.

`node tests.js` vérifie les données : chaque service a son module, chaque commande un en-tête valide et unique dans son service, chaque entrée son adresse 3dbrew, et le décodeur retrouve `OpenFile` (`0x080201C2`), `OpenFileDirectly` (`0x08030204`) et la région de `0x1FF82000`. Il vérifie aussi les corrections ci-dessous, et que `donnees.js` est à jour.

## Les corrections, et ce que dit le code de la console

Le projet voisin [decompil-3ds](../decompil-3ds/) a lu des modules système (trente-deux le 16 octobre 2026) dans le code dumpé d'une New 3DS, une fiche par module (`../decompil-3ds/fiches/`). Ces lectures ont relevé des écarts avec la Carte. Ils sont traités par `corrections.js`, jamais à la main dans `donnees.js` :

```
node corrections.js           applique les corrections et récrit donnees.js s'il change
node corrections.js --check   n'écrit rien, sort en erreur si donnees.js n'est pas à jour
node corrections.js --list    affiche chaque correction appliquée
```

Le script qui a produit `donnees.js` n'est pas dans le dépôt. Si le fichier est un jour régénéré, relancer `node corrections.js` remet tout en place ; une correction qui ne trouve plus ce qu'elle attend est signalée (« NON APPLIQUÉE ») au lieu d'être forcée.

Trois cas, traités différemment :

- **La Carte avait mal recopié 3dbrew.** La donnée est corrigée d'après 3dbrew, relu en wikitexte brut le 13 octobre 2026. Ce sont les noms tronqués (« u8 » pour `u8 GetStepCount`, « Stubbed » pour une phrase : la commande reprend son nom, ou « Inconnue » si 3dbrew n'en donne pas, et la phrase reste en note), les tableaux des neuf services de `pxi`, qui sont sur leurs propres pages (rangés dans `corrections-pxi.json`), et deux descripteurs de traduction.
- **3dbrew et le code de la console ne disent pas la même chose.** La valeur de 3dbrew reste en place, avec son lien. À côté, une note « Vu dans le code de… » donne ce que le code fait, dans quel module, et renvoie à la fiche. Exemple : `cdc:HID` GetData, `0x00010042` sur 3dbrew, `0x00010000` dans `hid`. Au guichet, les deux en-têtes retrouvent la commande.
- **3dbrew ne donne pas l'en-tête en entier** (`0x081A....`). Si le code vérifie ou envoie un en-tête entier, la commande entre dans le tableau avec la marque « vu dans le code » ; sinon elle reste parmi les en-têtes incomplets, avec ce que le code en fait.

Dans les données, une note du code est un champ `seen` : une liste de `{ module, text }`, avec `h` quand le code écrit un autre en-tête que 3dbrew, et `byCode` quand l'en-tête de l'entrée vient du code. On en trouve sur une commande, un en-tête incomplet, un service, ou un lien « ce module appelle ». Un lien lu dans le code seul n'a pas d'adresse 3dbrew. `codeSource` dit où sont les fiches et quels modules ont été lus.

Ce que le code montre vaut pour cette console et ce micrologiciel ; les notes le disent sans effacer 3dbrew.
