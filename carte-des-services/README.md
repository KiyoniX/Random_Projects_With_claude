# Carte des services

Le système de la 3DS dessiné comme le plan d'un réseau de transport, vu depuis un jeu. Chaque module système est une ligne, chaque service une station, et le jeu est la gare centrale. Ouvre `index.html` : tout marche hors ligne, les données sont embarquées dans `donnees.js`.

Quand tu lis un jeu dans Ghidra et que tu tombes sur un en-tête IPC (`0x080201C2`), un `svc 0x32` ou une adresse (`0x1FF82000`), tape-le au guichet d'information : la page te dit ce que c'est et renvoie à la page 3dbrew d'où vient l'information.

## Ce qu'il y a dedans

- **Le plan du réseau** : 42 modules et 150 services. Une station ronde est ouverte aux jeux, une coche est réservée au système. Les petites pastilles sous une station donnent les lignes qui l'appellent, quand 3dbrew le dit.
- **Les horaires d'une station** : ses commandes IPC, avec l'en-tête, le nom, le nombre de paramètres, et pour les pages lues, les mots de la requête et de la réponse.
- **Le plan du quartier** : la mémoire vue par le jeu, la mémoire physique et le partage de la FCRAM, ancienne 3DS et New 3DS côte à côte.
- **Les appels système** : la liste filtrable des SVC.

Molette pour rapprocher, glisser pour déplacer, `0` pour revenir à la vue d'ensemble, `/` pour aller au guichet.

## Les données

Elles viennent de [3dbrew](https://www.3dbrew.org/wiki/Services_API), lu par la Wayback Machine. Les pages de chaque commande n'ont pas toutes pu être lues : celles qui manquent portent la mention « page non lue », et l'en-tête suffit alors à compter les paramètres. Les rôles des modules, en français, sont écrits à la main.

`node tests.js` vérifie les données : chaque service a son module, chaque commande un en-tête valide et unique dans son service, chaque entrée son adresse 3dbrew, et le décodeur retrouve `OpenFile` (`0x080201C2`), `OpenFileDirectly` (`0x08030204`) et la région de `0x1FF82000`.
