(function () {
  'use strict';

  var U = window.Usine = {};

  U.PAS_SEC = 4;       // pas de simulation par seconde à vitesse ×1
  U.FENETRE = 240;     // fenêtre de mesure du débit, en pas : une minute de jeu
  U.TENUE = 120;       // le débit cible doit être tenu pendant ce nombre de pas
  U.DX = [1, 0, -1, 0];   // directions : 0 est, 1 sud, 2 ouest, 3 nord
  U.DY = [0, 1, 0, -1];

  U.OBJETS = {
    mf: { nom: 'minerai de fer', pluriel: 'minerais de fer', c: '#7f93a3', bord: '#2c3740' },
    mc: { nom: 'minerai de cuivre', pluriel: 'minerais de cuivre', c: '#c0703a', bord: '#4a2610' },
    lf: { nom: 'lingot de fer', pluriel: 'lingots de fer', c: '#b4c2cc', bord: '#2c3740' },
    lc: { nom: 'lingot de cuivre', pluriel: 'lingots de cuivre', c: '#e08a4c', bord: '#4a2610' },
    pl: { nom: 'plaque', pluriel: 'plaques', c: '#d5dde3', bord: '#2c3740' },
    fi: { nom: 'fil de cuivre', pluriel: 'fils de cuivre', c: '#f0a868', bord: '#4a2610' },
    en: { nom: 'engrenage', pluriel: 'engrenages', c: '#e3e8ec', bord: '#20282e' },
    ch: { nom: 'chute', pluriel: 'chutes', c: '#8a7767', bord: '#2a211a' },
    me: { nom: 'mécanisme', pluriel: 'mécanismes', c: '#8fb0e8', bord: '#1d2c4a' },
    ci: { nom: 'circuit', pluriel: 'circuits', c: '#6fc48c', bord: '#163822' },
    au: { nom: 'automate', pluriel: 'automates', c: '#f0c54a', bord: '#4a3608' }
  };

  U.PIECES = {
    tapis:   { nom: 'Tapis', cout: 1, info: 'Transporte un objet par case. Reçoit par l\'arrière et par les côtés ; l\'arrière passe d\'abord.' },
    sep:     { nom: 'Séparateur', cout: 3, info: 'Reçoit par l\'arrière et distribue à tour de rôle devant, à gauche et à droite, là où quelque chose peut recevoir.' },
    fus:     { nom: 'Fusionneur', cout: 3, info: 'Reçoit par l\'arrière et les côtés, à tour de rôle : personne n\'est oublié.' },
    pont:    { nom: 'Pont', cout: 4, info: 'Deux voies qui se croisent sans se mélanger : l\'une tout droit, l\'autre vers sa droite.' },
    filtre:  { nom: 'Filtre', cout: 5, info: 'Laisse passer tout droit l\'objet choisi et dévie les autres sur les côtés.' },
    four:    { nom: 'Four', cout: 10, info: 'Fond le minerai en lingot, et deux chutes en un lingot de fer.' },
    presse:  { nom: 'Presse', cout: 10, info: 'Lamine le lingot de fer en plaque, étire le lingot de cuivre en deux fils.' },
    tour:    { nom: 'Tour', cout: 12, info: 'Taille un engrenage dans une plaque. Il en sort aussi une chute.' },
    assem:   { nom: 'Assembleur', cout: 15, info: 'Réunit deux pièces différentes. Chaque ingrédient attend l\'autre.' },
    broyeur: { nom: 'Broyeur', cout: 6, info: 'Détruit tout ce qui y entre.' },
    src:     { nom: 'Source', cout: 0, info: 'Fournit un objet à cadence fixe.' },
    out:     { nom: 'Sortie', cout: 0, info: 'Accepte tout et compte ce qui arrive.' }
  };

  // e : entrées, s : sorties (dans l'ordre où elles quittent la machine), t : durée en pas.
  U.RECETTES = [
    { m: 'four', e: { mf: 1 }, s: ['lf'], t: 8 },
    { m: 'four', e: { mc: 1 }, s: ['lc'], t: 8 },
    { m: 'four', e: { ch: 2 }, s: ['lf'], t: 8 },
    { m: 'presse', e: { lf: 1 }, s: ['pl'], t: 4 },
    { m: 'presse', e: { lc: 1 }, s: ['fi', 'fi'], t: 4 },
    { m: 'tour', e: { pl: 1 }, s: ['en', 'ch'], t: 6 },
    { m: 'assem', e: { en: 1, fi: 1 }, s: ['me'], t: 8 },
    { m: 'assem', e: { pl: 1, fi: 1 }, s: ['ci'], t: 8 },
    { m: 'assem', e: { me: 1, ci: 1 }, s: ['au'], t: 12 }
  ];

  var TOUT = ['tapis', 'sep', 'fus', 'pont', 'filtre', 'four', 'presse', 'tour', 'assem', 'broyeur'];

  // Un niveau : sources (o : objets émis en boucle, p : un objet tous les p pas), sorties
  // (veut : objet → débit par minute ; sans veut, c'est une benne qui avale tout), murs [x, y, l, h].
  // La première étoile demande les débits de « veut ». paliers : conditions de la 2e puis de la 3e étoile ;
  // debit se lit sur la première sortie, les autres suivent en proportion.
  U.NIVEAUX = [
    { id: 'route', nom: 'Mise en route', idee: 'Tracer des tapis', w: 9, h: 5,
      texte: 'Deux wagonnets déversent du minerai de fer. Choisis le tapis, puis glisse la souris de la source jusqu\'à la caisse de sortie : les virages se font tout seuls. Un tapis qui en rejoint un autre par le côté s\'y déverse.',
      sources: [{ x: 0, y: 1, d: 0, o: ['mf'], p: 8 }, { x: 0, y: 3, d: 0, o: ['mf'], p: 8 }],
      sorties: [{ x: 8, y: 2, veut: { mf: 30 } }],
      pieces: ['tapis'], paliers: [{ debit: 60 }, { debit: 60, cout: 9 }] },

    { id: 'four', nom: 'Premier four', idee: 'Une machine, une recette', w: 9, h: 5,
      texte: 'La sortie veut des lingots. Un four fond un minerai en 2 secondes : pas plus de 30 lingots par minute. Il avale ce qu\'on lui amène par l\'arrière ou par les côtés et rend le lingot par l\'avant, côté flèche. Touche R pour le tourner.',
      sources: [{ x: 0, y: 1, d: 0, o: ['mf'], p: 8 }, { x: 0, y: 3, d: 0, o: ['mf'], p: 8 }],
      sorties: [{ x: 8, y: 2, veut: { lf: 30 } }],
      pieces: ['tapis', 'four'], paliers: [{ debit: 60 }, { debit: 60, cout: 28 }] },

    { id: 'separateur', nom: 'Le partage', idee: 'Répartir un flux', w: 10, h: 5,
      texte: 'La source débite 60 minerais par minute, un four n\'en fond que 30. Le séparateur distribue à tour de rôle devant lui, à sa gauche et à sa droite, partout où une pièce peut recevoir.',
      sources: [{ x: 0, y: 2, d: 0, o: ['mf'], p: 4 }],
      sorties: [{ x: 9, y: 2, veut: { lf: 30 } }],
      pieces: ['tapis', 'sep', 'four'], paliers: [{ debit: 60 }, { debit: 60, cout: 31 }] },

    { id: 'presse', nom: 'La tôlerie', idee: 'Accorder les cadences', w: 11, h: 7,
      texte: 'Minerai, lingot, plaque. La presse lamine un lingot par seconde, deux fois plus vite qu\'un four ne fond. La source déborde : à toi de compter les machines.',
      sources: [{ x: 0, y: 3, d: 0, o: ['mf'], p: 2 }],
      sorties: [{ x: 10, y: 3, veut: { pl: 30 } }],
      pieces: ['tapis', 'sep', 'four', 'presse'], paliers: [{ debit: 60 }, { debit: 90, cout: 64 }] },

    { id: 'filtre', nom: 'Le tri', idee: 'Séparer deux matières', w: 10, h: 7,
      texte: 'Fer et cuivre arrivent mélangés, un sur deux. Le filtre laisse passer tout droit l\'objet que tu choisis et dévie les autres sur le côté. Un même four fond les deux minerais : trier avant ou après ?',
      sources: [{ x: 0, y: 3, d: 0, o: ['mf', 'mc'], p: 4 }],
      sorties: [{ x: 9, y: 1, veut: { lf: 15 } }, { x: 9, y: 5, veut: { lc: 15 } }],
      pieces: ['tapis', 'sep', 'four', 'filtre'], paliers: [{ debit: 30 }, { debit: 30, cout: 42 }] },

    { id: 'goulet', nom: 'Le goulet', idee: 'Partager une voie unique', w: 9, h: 7,
      texte: 'Une seule brèche dans le mur, et deux sources qui débordent. Sur un tapis, ce qui arrive par l\'arrière ou par la gauche passe toujours d\'abord : l\'autre flux n\'avancerait jamais. Le fusionneur, lui, fait passer chacun à son tour.',
      sources: [{ x: 0, y: 1, d: 0, o: ['mf'], p: 1 }, { x: 0, y: 5, d: 0, o: ['mc'], p: 1 }],
      sorties: [{ x: 8, y: 1, veut: { mf: 110 } }, { x: 8, y: 5, veut: { mc: 110 } }],
      murs: [[4, 0, 1, 3], [4, 4, 1, 3]],
      pieces: ['tapis', 'fus', 'filtre'], paliers: [{ cout: 23 }, { cout: 23, emprise: 35 }] },

    { id: 'pont', nom: 'Le carrefour', idee: 'Croiser sans mélanger', w: 9, h: 7,
      texte: 'Trois flux, trois caisses, et aucune n\'est en face de la bonne source. Le pont fait se croiser deux voies : l\'une va tout droit, l\'autre part vers sa droite. Chaque pont coûte quatre tapis.',
      sources: [{ x: 0, y: 1, d: 0, o: ['mf'], p: 4 }, { x: 0, y: 3, d: 0, o: ['mc'], p: 4 }, { x: 0, y: 5, d: 0, o: ['lf'], p: 4 }],
      sorties: [{ x: 8, y: 1, veut: { mc: 60 } }, { x: 8, y: 3, veut: { lf: 60 } }, { x: 8, y: 5, veut: { mf: 60 } }],
      pieces: ['tapis', 'pont'], paliers: [{ cout: 36 }, { cout: 33 }] },

    { id: 'tour', nom: 'Les copeaux', idee: 'Évacuer un sous-produit', w: 10, h: 6,
      texte: 'Le tour taille un engrenage dans chaque plaque, et rend aussi une chute par la même bouche. La caisse refuse les chutes : si elles restent sur le tapis, tout se bloque. Filtre-les vers la benne du coin, ou vers un broyeur.',
      sources: [{ x: 0, y: 2, d: 0, o: ['pl'], p: 3 }],
      sorties: [{ x: 9, y: 2, veut: { en: 40 } }, { x: 0, y: 5 }],
      pieces: ['tapis', 'sep', 'fus', 'filtre', 'tour', 'broyeur'], paliers: [{ debit: 80 }, { debit: 80, cout: 45 }] },

    { id: 'recyclage', nom: 'Rien ne se perd', idee: 'Boucler un flux', w: 10, h: 7,
      texte: 'Vingt lingots par minute, pas un de plus. Mais deux chutes refondues au four redonnent un lingot : renvoie-les dans la chaîne et la même source nourrit presque deux fois plus d\'engrenages.',
      sources: [{ x: 0, y: 3, d: 0, o: ['lf'], p: 12 }],
      sorties: [{ x: 9, y: 3, veut: { en: 20 } }],
      pieces: ['tapis', 'sep', 'fus', 'pont', 'filtre', 'four', 'presse', 'tour', 'broyeur'], paliers: [{ debit: 36 }, { debit: 36, cout: 46 }] },

    { id: 'assembleur', nom: 'Le mécanisme', idee: 'Deux ingrédients', w: 11, h: 7,
      texte: 'Un engrenage et un fil font un mécanisme. L\'assembleur garde un ingrédient en attendant l\'autre, mais ne prend pas le même deux fois : amène-les par deux côtés différents. Un seul assembleur ne suit pas la cadence des deux sources.',
      sources: [{ x: 0, y: 1, d: 0, o: ['pl'], p: 6 }, { x: 0, y: 5, d: 0, o: ['lc'], p: 12 }],
      sorties: [{ x: 10, y: 3, veut: { me: 25 } }],
      pieces: ['tapis', 'sep', 'fus', 'pont', 'filtre', 'presse', 'tour', 'assem', 'broyeur'], paliers: [{ debit: 40 }, { debit: 40, cout: 92 }] },

    { id: 'commande', nom: 'La commande', idee: 'Livrer deux produits en proportion', w: 10, h: 7,
      texte: 'Le client veut deux plaques pour un engrenage. Une seule source de lingots : il faut envoyer au tour exactement la part qu\'il faut, ni plus ni moins.',
      sources: [{ x: 0, y: 3, d: 0, o: ['lf'], p: 4 }],
      sorties: [{ x: 9, y: 3, veut: { pl: 20 } }, { x: 5, y: 6, veut: { en: 10 } }],
      pieces: ['tapis', 'sep', 'fus', 'pont', 'filtre', 'four', 'presse', 'tour', 'broyeur'], paliers: [{ debit: 40 }, { debit: 40, cout: 48 }] },

    { id: 'exigu', nom: 'L\'atelier exigu', idee: 'Tout faire tenir', w: 5, h: 6,
      texte: 'Du minerai à l\'engrenage dans un réduit de cinq cases de large. Ici chaque machine doit prendre par un côté et rendre de l\'autre : les tapis sont un luxe.',
      sources: [{ x: 0, y: 0, d: 0, o: ['mf'], p: 4 }],
      sorties: [{ x: 4, y: 5, veut: { en: 30 } }],
      pieces: ['tapis', 'sep', 'fus', 'pont', 'filtre', 'four', 'presse', 'tour', 'broyeur'], paliers: [{ debit: 60 }, { debit: 60, cout: 78 }] },

    { id: 'melange', nom: 'La fonderie mixte', idee: 'Trier le plus tard possible', w: 12, h: 7,
      texte: 'Deux minerais de fer pour un de cuivre, à pleine cadence, et la moitié de l\'atelier est condamnée. Le four et la presse traitent les deux métaux : rien n\'oblige à trier d\'abord.',
      sources: [{ x: 0, y: 3, d: 0, o: ['mf', 'mf', 'mc'], p: 2 }],
      sorties: [{ x: 11, y: 1, veut: { pl: 40 } }, { x: 11, y: 5, veut: { fi: 40 } }],
      murs: [[1, 4, 6, 3], [9, 2, 2, 2]],
      pieces: ['tapis', 'sep', 'fus', 'pont', 'filtre', 'four', 'presse'], paliers: [{ debit: 80 }, { debit: 80, cout: 95 }] },

    { id: 'automate', nom: 'L\'automate', idee: 'La chaîne complète', w: 11, h: 9,
      texte: 'Un automate réunit un mécanisme et un circuit ; le circuit, une plaque et un fil. Tout part de deux sources de lingots. La caisse est au milieu de l\'atelier, et elle se remplit par tous les côtés.',
      sources: [{ x: 0, y: 1, d: 0, o: ['lf'], p: 4 }, { x: 0, y: 7, d: 0, o: ['lc'], p: 8 }],
      sorties: [{ x: 8, y: 4, veut: { au: 15 } }],
      pieces: TOUT, paliers: [{ debit: 30 }, { debit: 30, cout: 140 }] }
  ];

  U.BAC = { id: 'bac', nom: 'Bac à sable', idee: 'Sans objectif', w: 22, h: 13, bac: true,
    texte: 'Toutes les pièces, aucun objectif. Pose tes propres sources (objet et cadence au choix) et des sorties qui comptent ce qui leur arrive.',
    sources: [], sorties: [], pieces: TOUT.concat(['src', 'out']), paliers: [] };
})();
