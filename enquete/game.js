(function () {
  'use strict';

  var DEBUT = 21 * 60, PAS = 30;   // première tranche et durée d'une tranche, en minutes
  var NUIT = 6 * 60;               // de minuit à l'aube, en minutes
  var COUT_ERREUR = 2;             // actions perdues par fausse accusation

  // groupe : chance que le coupable s'invente des témoins (qui le démentiront).
  // extra : chance de mensonges supplémentaires. fausse : chance d'un faux lieu du crime.
  // marge : actions en plus ou en moins par rapport à tout ce qu'on peut faire d'utile.
  var NIVEAUX = {
    facile:    { nom: 'Facile',    suspects: 5, pieces: 5, armes: 5, rivales: 2, tranches: 4, fenetre: 2, secrets: 0, fausse: 0,   groupe: 1,    extra: 0,    marge: 4 },
    normal:    { nom: 'Normal',    suspects: 6, pieces: 6, armes: 6, rivales: 2, tranches: 5, fenetre: 3, secrets: 1, fausse: 0.5, groupe: 0.7,  extra: 0.35, marge: 0 },
    difficile: { nom: 'Difficile', suspects: 7, pieces: 7, armes: 7, rivales: 3, tranches: 5, fenetre: 3, secrets: 2, fausse: 1,   groupe: 0.45, extra: 0.7,  marge: -3 }
  };

  var MANOIRS = ['manoir des Ormes', 'manoir de la Hulotte', 'manoir des Trois-Étangs', 'manoir de Courteval'];
  var MOIS = ['octobre', 'novembre', 'février', 'mars'];

  var VICTIMES = [
    { prenom: 'Achille', nom: 'Montclar', court: 'M. Montclar', g: 'm', metier: 'armateur' },
    { prenom: 'Eugénie', nom: 'Saint-Clair', court: 'Mme Saint-Clair', g: 'f', metier: 'propriétaire des filatures Saint-Clair' },
    { prenom: 'Théodore', nom: 'Kervadec', court: 'M. Kervadec', g: 'm', metier: 'banquier' },
    { prenom: 'Mathilde', nom: 'Bellanger', court: 'Mme Bellanger', g: 'f', metier: 'collectionneuse' }
  ];

  // lien et mobile reçoivent la victime, pour s'accorder avec elle.
  var GENS = [
    { id: 'delmas', prenom: 'Hortense', nom: 'Delmas', court: 'Mme Delmas', ini: 'H. D.', g: 'f', metier: 'antiquaire',
      caractere: 'sèche, précise, compte chacun de ses mots',
      lien: function (v) { return 'fournit depuis dix ans les collections ' + de(v.court); },
      mobile: function (v) { return v.court + ' venait de découvrir que deux pièces vendues par elle étaient des faux.'; } },
    { id: 'vasseur', prenom: 'Armand', nom: 'Vasseur', court: 'le docteur Vasseur', ini: 'A. V.', g: 'm', metier: 'médecin',
      caractere: 'affable, un peu trop sûr de lui',
      lien: function (v) { return 'médecin personnel ' + de(v.court); },
      mobile: function (v) { return v.court + ' menaçait de révéler une erreur de diagnostic qui aurait ruiné sa réputation.'; } },
    { id: 'brossard', prenom: 'Octave', nom: 'Brossard', court: 'le colonel Brossard', ini: 'O. B.', g: 'm', metier: 'colonel en retraite',
      caractere: 'bourru, parle fort, rougit vite',
      lien: function (v) { return 'vieil ami ' + de(v.court) + ' et son partenaire de chasse'; },
      mobile: function (v) { return 'Il devait à ' + v.court + ' une forte somme perdue au jeu, exigible à la fin du mois.'; } },
    { id: 'aubert', prenom: 'Lucie', nom: 'Aubert', court: 'Mlle Aubert', ini: 'L. A.', g: 'f', metier: 'secrétaire',
      caractere: 'discrète, observatrice, nerveuse',
      lien: function (v) { return 'secrétaire particulière ' + de(v.court) + ' depuis trois ans'; },
      mobile: function (v) { return v.court + ' venait de lui signifier son renvoi, sans lettre de recommandation.'; } },
    { id: 'carbonnel', prenom: 'Félix', nom: 'Carbonnel', court: 'Me Carbonnel', ini: 'F. C.', g: 'm', metier: 'notaire',
      caractere: 'onctueux, prudent, méticuleux',
      lien: function (v) { return 'notaire ' + de(v.court) + ', chargé de sa succession'; },
      mobile: function (v) { return v.court + ' avait exigé une vérification complète des comptes de l’étude.'; } },
    { id: 'rochefort', prenom: 'Blanche', nom: 'de Rochefort', court: 'Mme de Rochefort', ini: 'B. R.', g: 'f', metier: 'cantatrice',
      caractere: 'théâtrale, généreuse, rancunière',
      lien: function (v) { return 'amie de longue date et protégée ' + de(v.court); },
      mobile: function (v) { return v.court + ' venait de retirer son soutien financier à sa prochaine tournée.'; } },
    { id: 'perrin', prenom: 'Gaston', nom: 'Perrin', court: 'M. Perrin', ini: 'G. P.', g: 'm', metier: 'marchand de tableaux',
      caractere: 'jovial, bavard, fuyant dès qu’on parle d’argent',
      lien: function (v) { return 'associé ' + de(v.court) + ' dans une galerie parisienne'; },
      mobile: function (v) { return v.court + ' voulait dissoudre leur association et réclamer sa part.'; } },
    { id: 'castel', prenom: 'Irène', nom: 'Castel', court: 'Mlle Castel', ini: 'I. C.', g: 'f', metier: 'journaliste',
      caractere: 'vive, ironique, curieuse de tout',
      lien: function (v) { return 'filleule ' + de(v.court); },
      mobile: function (v) { return 'Elle préparait un article sur les affaires ' + de(v.court) + ', qui menaçait de lui couper les vivres.'; } },
    { id: 'morel', prenom: 'Augustin', nom: 'Morel', court: 'l’abbé Morel', ini: 'A. M.', g: 'm', metier: 'curé du village',
      caractere: 'doux, distrait, plus têtu qu’il n’y paraît',
      lien: function () { return 'confesseur et vieil ami de la famille'; },
      mobile: function (v) { return v.court + ' venait d’annuler le legs promis à sa paroisse.'; } },
    { id: 'verdier', prenom: 'Solange', nom: 'Verdier', court: 'Mme Verdier', ini: 'S. V.', g: 'f', metier: 'gouvernante',
      caractere: 'droite, dévouée, avare de paroles',
      lien: function () { return 'gouvernante du manoir depuis vingt ans'; },
      mobile: function (v) { return v.court + ' comptait vendre le manoir et congédier toute la maison.'; } },
    { id: 'hartmann', prenom: 'Léopold', nom: 'Hartmann', court: 'le professeur Hartmann', ini: 'L. H.', g: 'm', metier: 'égyptologue',
      caractere: 'savant, susceptible, toujours à court d’argent',
      lien: function (v) { return 'savant dont ' + v.court + ' finançait les fouilles'; },
      mobile: function (v) { return v.court + ' refusait de payer la prochaine campagne et réclamait les pièces déjà rapportées.'; } },
    { id: 'fontaine', prenom: 'Colette', nom: 'Fontaine', court: 'Mlle Fontaine', ini: 'C. F.', g: 'f', metier: 'actrice de cinéma',
      caractere: 'charmeuse, impatiente, plus lucide qu’elle ne le montre',
      lien: function (v) { return 'nièce ' + de(v.court) + ' et son unique héritière'; },
      mobile: function (v) { return v.court + ' s’apprêtait à refaire son testament au profit d’une œuvre de charité.'; } }
  ];

  var PIECES = [
    { id: 'salon', nom: 'le salon', court: 'Salon', cache: 'sous un coussin du canapé' },
    { id: 'biblio', nom: 'la bibliothèque', court: 'Biblio.', cache: 'derrière une rangée de dictionnaires' },
    { id: 'manger', nom: 'la salle à manger', court: 'S. à manger', cache: 'au fond du buffet' },
    { id: 'cuisine', nom: 'la cuisine', court: 'Cuisine', cache: 'dans le seau à charbon' },
    { id: 'serre', nom: 'la serre', court: 'Serre', cache: 'sous un grand pot retourné' },
    { id: 'bureau', nom: 'le bureau', court: 'Bureau', cache: 'derrière le classeur' },
    { id: 'billard', nom: 'la salle de billard', court: 'Billard', cache: 'sous la housse du billard' },
    { id: 'fumoir', nom: 'le fumoir', court: 'Fumoir', cache: 'derrière le paravent' },
    { id: 'musique', nom: 'le salon de musique', court: 'Musique', cache: 'dans le coffre du piano' },
    { id: 'cave', nom: 'la cave', court: 'Cave', cache: 'entre deux casiers à bouteilles' }
  ];

  var ARMES = [
    { id: 'tisonnier', nom: 'le tisonnier', genre: 'contondant', lieu: 'salon', place: 'près de la cheminée' },
    { id: 'chandelier', nom: 'le chandelier d’argent', genre: 'contondant', lieu: 'manger', place: 'sur la desserte' },
    { id: 'buste', nom: 'le buste de marbre', genre: 'contondant', lieu: 'biblio', place: 'sur son socle' },
    { id: 'presse', nom: 'le presse-papiers de bronze', genre: 'contondant', lieu: 'bureau', place: 'sur le sous-main' },
    { id: 'pilon', nom: 'le pilon de cuivre', genre: 'contondant', lieu: 'cuisine', place: 'sur l’étagère' },
    { id: 'trophee', nom: 'le trophée d’étain', genre: 'contondant', lieu: 'billard', place: 'sur la cheminée' },
    { id: 'coupe', nom: 'le coupe-papier d’acier', genre: 'tranchant', lieu: 'bureau', place: 'dans le plumier' },
    { id: 'couteau', nom: 'le couteau à découper', genre: 'tranchant', lieu: 'cuisine', place: 'sur le billot' },
    { id: 'secateur', nom: 'le sécateur', genre: 'tranchant', lieu: 'serre', place: 'à son clou' },
    { id: 'poignard', nom: 'le poignard oriental', genre: 'tranchant', lieu: 'fumoir', place: 'dans sa vitrine' },
    { id: 'serpette', nom: 'la serpette de vigneron', genre: 'tranchant', lieu: 'cave', place: 'près des casiers' },
    { id: 'corde', nom: 'la corde de piano', genre: 'lien', lieu: 'musique', place: 'dans la boîte de l’accordeur' },
    { id: 'cordeliere', nom: 'la cordelière de rideau', genre: 'lien', lieu: 'biblio', place: 'à la fenêtre' },
    { id: 'fil', nom: 'le fil de fer', genre: 'lien', lieu: 'serre', place: 'sur l’établi' }
  ];

  var GENRES = {
    contondant: { cause: function (v) { return 'a été tué' + v.e + ' d’un coup violent à la tempe, porté avec un objet lourd'; }, bref: 'un objet lourd', trace: 'on y voit encore du sang, mal essuyé' },
    tranchant: { cause: function (v) { return 'a été poignardé' + v.e + ' : une seule plaie, nette, faite par une lame'; }, bref: 'une lame', trace: 'on y voit encore du sang, mal essuyé' },
    lien: { cause: function (v) { return 'a été étranglé' + v.e + ' avec un lien mince et solide'; }, bref: 'un lien mince', trace: 'son diamètre correspond exactement au sillon relevé sur le cou de la victime' }
  };

  var NOMBRES = { 5: 'cinq', 6: 'six', 7: 'sept' };
  var CHEVEUX = ['blonds', 'bruns', 'roux', 'gris'];
  var TABAC = { cigarette: 'la cigarette', cigare: 'le cigare', pipe: 'la pipe' };
  var CENDRE = { cigarette: 'de la cendre de cigarette', cigare: 'de la cendre de cigare', pipe: 'des brins de tabac à pipe' };

  var ACCUEILS = [
    function () { return 'Je n’ai rien à cacher, inspecteur. Voici ma soirée.'; },
    function (p) { return 'Faites vite, je vous prie : cette nuit m’a brisé' + e(p.g) + '.'; },
    function () { return 'Je vous répondrai aussi exactement que possible.'; },
    function () { return 'Quelle horreur… Je vous dis ce dont je me souviens.'; },
    function () { return 'Vous me soupçonnez, naturellement. Notez donc.'; },
    function () { return 'Asseyez-vous, inspecteur. Je vais tâcher de ne rien oublier.'; }
  ];
  var ESQUIVES = [
    'Je ne vois pas ce que vous voulez me faire dire. Cela ne me concerne pas.',
    'Et que voulez-vous que j’y réponde, inspecteur ? Je n’en sais pas plus que vous.',
    'Vous perdez votre temps avec moi. Je n’ai rien à ajouter là-dessus.'
  ];
  var SECRETS = {
    porto: 'une carafe de porto renversée, puis épongée en cachette',
    lettres: 'de vieilles lettres brûlées en cachette',
    tiroir: 'un coffret forcé pour y reprendre une lettre'
  };
  var MARQUES = { '': '·', p: '●', a: '✕', d: '?' };
  var SUIVANT = { '': 'p', p: 'a', a: 'd', d: '' };

  var $ = function (s) { return document.querySelector(s); };

  // ---------- Hasard ----------
  var rng;
  function seedRng(str) {
    var h = 1779033703 ^ str.length, i;
    for (i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    rng = function () {
      h = h + 0x6D2B79F5 | 0;
      var t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function int(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function pick(arr) { return arr[int(0, arr.length - 1)]; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = int(0, i), t = arr[i];
      arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function sample(arr, n) { return shuffle(arr.slice()).slice(0, n); }

  // ---------- Langue ----------
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function e(g) { return g === 'f' ? 'e' : ''; }
  function il(g) { return g === 'f' ? 'elle' : 'il'; }
  function de(x) {
    if (x.indexOf('le ') === 0) return 'du ' + x.slice(3);
    if (/^[aeiouyhéèêâîôû]/i.test(x)) return 'd’' + x;
    return 'de ' + x;
  }
  function liste(noms) {
    if (noms.length < 2) return noms.join('');
    return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
  }
  function heureTxt(s, plus) {
    var m = DEBUT + s * PAS + (plus || 0);
    return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + m % 60 : '');
  }
  function complet(p) { return p.prenom + ' ' + p.nom; }
  function fume(p) { return p.tabac ? 'fume ' + TABAC[p.tabac] : 'ne fume pas'; }
  function manuel(p) { return p.main === 'gauche' ? (p.g === 'f' ? 'gauchère' : 'gaucher') : (p.g === 'f' ? 'droitière' : 'droitier'); }

  // ---------- Accès à l'affaire ----------
  function parId(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function gens(aff, id) { return parId(aff.suspects, id); }
  function piece(aff, id) { return parId(aff.pieces, id); }
  function court(aff, id) { return id === 'V' ? aff.victime.court : gens(aff, id).court; }
  function secretDe(aff, id) {
    for (var i = 0; i < aff.secrets.length; i++) if (aff.secrets[i].qui === id) return aff.secrets[i];
    return null;
  }
  function element(aff, src, texte, faits, plus) {
    var el = Object.assign({ id: 'e' + (++aff.compteur), src: src, texte: texte, faits: faits || [] }, plus);
    aff.elements.push(el);
    return el;
  }

  // ---------- Vérité : qui était où ----------
  function repartir(liste, cle, valeurs, coupable) {
    var vals = shuffle(valeurs.slice()), autres;
    shuffle(liste.slice()).forEach(function (p, i) { p[cle] = vals[i % vals.length]; });
    autres = liste.filter(function (p) { return p !== coupable; });
    if (!autres.some(function (p) { return p[cle] === coupable[cle]; })) pick(autres)[cle] = coupable[cle];
  }

  // Place tout le monde, tranche par tranche. Les gens restent volontiers où ils sont et vont là où il y a du monde.
  function placer(aff, reserve, force) {
    var pos = {}, ids = aff.suspects.map(function (p) { return p.id; }).concat('V'), s;
    ids.forEach(function (id) { pos[id] = []; });
    for (s = 0; s < aff.T; s++) {
      var occupe = {};
      var ordre = shuffle(ids.slice()).sort(function (a, b) { return (force[b + s] ? 1 : 0) - (force[a + s] ? 1 : 0); });
      ordre.forEach(function (id) {
        var ou = force[id + s], libres, pleines, avant;
        if (id === 'V' && s > aff.verite.heure) { pos.V[s] = null; return; }
        if (!ou) {
          libres = aff.pieces.map(function (p) { return p.id; }).filter(function (p) { return !reserve[p + s]; });
          pleines = libres.filter(function (p) { return occupe[p]; });
          avant = s ? pos[id][s - 1] : null;
          if (avant && libres.indexOf(avant) >= 0 && rng() < 0.45) ou = avant;
          else ou = pleines.length && rng() < 0.7 ? pick(pleines) : pick(libres);
        }
        pos[id][s] = ou;
        occupe[ou] = true;
      });
    }
    return pos;
  }

  function presents(aff, pos, s, ou, sauf) {
    return aff.suspects.map(function (p) { return p.id; }).concat('V').filter(function (id) { return id !== sauf && pos[id][s] === ou; });
  }

  // Le coupable s'invente une autre pièce : soit parmi des témoins qui le démentiront, soit seul.
  function alibi(aff, pos, s, reserve, groupe) {
    var V = aff.verite, ids = aff.pieces.map(function (p) { return p.id; }).filter(function (p) { return !reserve[p + s] && p !== pos[V.coupable][s]; });
    var pleines = ids.filter(function (p) { return presents(aff, pos, s, p, 'V').length; });
    var vides = ids.filter(function (p) { return !presents(aff, pos, s, p).length; });
    var ou = (pleines.length && (rng() < groupe || !vides.length)) ? pick(pleines) : pick(vides);
    return ou ? { piece: ou, avec: presents(aff, pos, s, ou), faux: true } : null;
  }

  // ---------- Affaire ----------
  function tenter(graine, niv) {
    var N = NIVEAUX[niv], T = N.tranches, v = Object.assign({}, pick(VICTIMES));
    var suspects = sample(GENS, N.suspects).sort(function (a, b) { return GENS.indexOf(a) - GENS.indexOf(b); }).map(function (p) { return Object.assign({}, p); });
    var pieces = sample(PIECES, N.pieces).sort(function (a, b) { return PIECES.indexOf(a) - PIECES.indexOf(b); }).map(function (p) { return Object.assign({ dans: 'dans ' + p.nom }, p); });
    var dispo, genres, genre, memes, armes, coupable, arme, lieu, heure, prise, debut, fin, innocents, sortes, secrets = [], reserve = {}, force = {}, pos, dits = {}, aff, V, s;

    v.e = e(v.g);
    if (suspects.filter(function (p) { return p.g === 'f'; }).length < 2 || suspects.filter(function (p) { return p.g === 'm'; }).length < 2) return null;
    dispo = ARMES.filter(function (a) { return parId(pieces, a.lieu); });
    genres = Object.keys(GENRES).filter(function (g) { return dispo.filter(function (a) { return a.genre === g; }).length >= N.rivales; });
    if (!genres.length) return null;
    genre = pick(genres);
    memes = sample(dispo.filter(function (a) { return a.genre === genre; }), N.rivales);
    armes = memes.concat(sample(dispo.filter(function (a) { return a.genre !== genre; }), N.armes - memes.length));
    armes.sort(function (a, b) { return ARMES.indexOf(a) - ARMES.indexOf(b); });

    coupable = pick(suspects); arme = pick(memes); lieu = pick(pieces);
    heure = int(1, T - 1);
    prise = arme.lieu === lieu.id ? heure : int(0, heure - 1);
    debut = Math.max(0, Math.min(T - N.fenetre, heure - int(0, N.fenetre - 1)));
    fin = debut + N.fenetre - 1;

    repartir(suspects, 'cheveux', sample(CHEVEUX, 3), coupable);
    repartir(suspects, 'tabac', ['cigarette', 'cigare', 'pipe', ''], coupable);
    suspects.forEach(function (p) { p.main = 'droite'; });
    sample(suspects, N.suspects > 6 ? 3 : 2).forEach(function (p) { p.main = 'gauche'; });

    // Secrets : un innocent seul dans une pièce, qui refusera d'en parler.
    innocents = suspects.filter(function (p) { return p !== coupable; });
    sortes = shuffle(['lettres', 'tiroir']);
    sample(innocents, N.secrets).forEach(function (p, n) {
      var sl = rng() < 0.7 ? int(debut, fin) : int(0, T - 1);
      var libres = pieces.filter(function (x) {
        return x.id !== lieu.id && !(sl === prise && x.id === arme.lieu) && !secrets.some(function (o) { return o.piece === x.id; });
      });
      secrets.push({ qui: p.id, heure: sl, piece: pick(libres).id, genre: n === 0 && rng() < N.fausse ? 'porto' : sortes[n % 2] });
    });

    aff = {
      graine: graine, niveau: niv, T: T, victime: v, manoir: pick(MANOIRS), date: int(3, 27) + ' ' + pick(MOIS) + ' ' + int(1923, 1929),
      suspects: suspects, pieces: pieces, armes: armes, genre: genre, debut: debut, fin: fin, secrets: secrets,
      elements: [], compteur: 0,
      verite: { coupable: coupable.id, arme: arme.id, piece: lieu.id, heure: heure, prise: prise }
    };
    V = aff.verite;

    reserve[lieu.id + heure] = true;
    force[coupable.id + heure] = force['V' + heure] = lieu.id;
    if (prise !== heure) force[coupable.id + prise] = arme.lieu;
    secrets.forEach(function (x) { reserve[x.piece + x.heure] = true; force[x.qui + x.heure] = x.piece; });
    pos = V.pos = placer(aff, reserve, force);

    // Dépositions : les innocents disent vrai, le coupable arrange les siennes.
    suspects.forEach(function (p) {
      dits[p.id] = [];
      for (s = 0; s < T; s++) dits[p.id].push({ piece: pos[p.id][s], avec: presents(aff, pos, s, pos[p.id][s], p.id) });
    });
    secrets.forEach(function (x) { dits[x.qui][x.heure].tu = true; });
    dits[coupable.id][heure] = alibi(aff, pos, heure, reserve, N.groupe);
    if (!dits[coupable.id][heure]) return null;
    V.mensonges = [heure];
    if (prise !== heure && !presents(aff, pos, prise, arme.lieu, coupable.id).length && rng() < N.extra) {
      s = alibi(aff, pos, prise, reserve, 0.5);
      if (s) { dits[coupable.id][prise] = s; V.mensonges.push(prise); }
    }
    if (heure + 1 < T && rng() < N.extra * 0.7) {
      dits[coupable.id][heure + 1].avec.push('V');
      dits[coupable.id][heure + 1].faux = true;
      V.mensonges.push(heure + 1);
      V.revenant = heure + 1;
    }
    V.dits = dits;
    V.cachette = heure + 1 < T && rng() < 0.6 ? pos[coupable.id][heure + 1] : lieu.id;

    rediger(aff);
    if (!completer(aff)) return null;
    aff.utiles = necessaires(aff);
    aff.total = actionsDe(aff).length;
    aff.budget = aff.total + N.marge;
    if (aff.utiles.length > aff.budget - 2) return null;
    return aff;
  }

  function creer(graine, niv) {
    var aff = null, n;
    for (n = 0; !aff && n < 5000; n++) {
      seedRng(graine + '|' + niv + '|' + n);
      aff = tenter(graine, niv);
    }
    if (aff) aff.essais = n;
    return aff;
  }

  // ---------- Rédaction : dossier, dépositions, fouilles ----------
  function deposition(aff, p, s, d, avant) {
    var h = heureTxt(s), ou = piece(aff, d.piece), f = e(p.g), noms = d.avec.map(function (id) { return court(aff, id); }), t, ferme = false;
    if (avant && !avant.tu && avant.piece === d.piece) {
      // jamais deux fois de suite la même tournure
      p.tic = pick([0, 1, 2].filter(function (n) { return n !== p.tic; }));
      t = ['À ' + h + ', j’y étais encore', 'À ' + h + ', je n’avais pas quitté ' + ou.nom, 'À ' + h + ', toujours ' + ou.dans][p.tic];
      ferme = p.tic === 1;   // cette tournure ne supporte pas « avec… » à la suite
    }
    else if (avant && !avant.tu) t = pick(['Vers ' + h + ', je suis passé' + f + ' ' + ou.dans, 'À ' + h + ', je me trouvais ' + ou.dans, 'Vers ' + h + ', je suis allé' + f + ' ' + ou.dans]);
    else t = pick(['À ' + h + ', j’étais ' + ou.dans, 'À ' + h + ', je me trouvais ' + ou.dans]);
    if (!noms.length) return t + pick([' ; j’y étais seul' + f + '.', '. Il n’y avait personne d’autre.'].concat(ferme ? [] : [', seul' + f + '.']));
    return t + pick([
      '. ' + cap(liste(noms)) + (noms.length > 1 ? ' s’y trouvaient' : ' s’y trouvait') + ' aussi.',
      ' ; il y avait là ' + liste(noms) + '.'
    ].concat(ferme ? [] : [' avec ' + liste(noms) + '.', ', en compagnie ' + liste(noms.map(de)) + '.']));
  }

  function rediger(aff) {
    var V = aff.verite, v = aff.victime, N = NIVEAUX[aff.niveau], arme = parId(aff.armes, V.arme);
    var bruit = pick(aff.armes.filter(function (a) { return a.id !== V.arme; }));
    var faux = aff.secrets.filter(function (x) { return x.genre === 'porto'; })[0];

    element(aff, 'dossier', 'Nuit du ' + aff.date + ', ' + aff.manoir + '. À minuit, le majordome a découvert le corps ' + de(complet(v)) + ', ' + v.metier + ', dans la lingerie, sous l’escalier de service, roulé dans un drap. ' +
      cap(il(v.g)) + ' recevait ce soir-là ' + NOMBRES[aff.suspects.length] + ' personnes. Aucune n’a quitté le manoir : le coupable est l’une d’elles.');
    element(aff, 'dossier', 'Rapport du médecin. ' + v.court + ' ' + GENRES[aff.genre].cause(v) + '. La mort est survenue entre ' + heureTxt(aff.debut) + ' et ' + heureTxt(aff.fin + 1) +
      '. Le corps a été déplacé : le crime a eu lieu dans l’une des ' + NOMBRES[aff.pieces.length] + ' pièces du rez-de-chaussée.',
      [{ t: 'genre', genre: aff.genre }, { t: 'fenetre', de: aff.debut, a: aff.fin }]);

    aff.suspects.forEach(function (p) {
      var coupable = p.id === V.coupable, f = e(p.g), avant = null, redite = {};
      p.accueil = pick(ACCUEILS)(p);
      V.dits[p.id].forEach(function (d, s) {
        var h = heureTxt(s), faits = [], t, ordre;
        if (d.tu) {
          t = pick(['À ' + h + '… Je préfère ne rien dire de cette demi-heure. Cela n’a aucun rapport avec votre enquête.', 'Pour ' + h + ', permettez-moi de me taire. C’est une affaire privée.']);
          element(aff, 't:' + p.id, t, [], { qui: p.id, slot: s, tu: true });
          avant = d;
          return;
        }
        t = deposition(aff, p, s, d, avant);
        faits.push({ t: 'dit', qui: p.id, slot: s, piece: d.piece, avec: d.avec.slice() });
        avant = d;
        if (!coupable) {
          aff.armes.forEach(function (a) {
            var quand = a.id === V.arme ? V.prise : 99;
            if (a.lieu !== d.piece || s === quand || (a !== arme && a !== bruit)) return;
            if (redite[a.id + (s < quand)] || rng() > (a === arme ? 0.6 : 0.25)) return;
            redite[a.id + (s < quand)] = true;
            if (s < quand) t += ' ' + pick([cap(a.nom) + ' était à sa place, ' + a.place + '.', 'J’ai noté que ' + a.nom + ' était bien ' + a.place + '.']);
            else t += ' ' + pick(['Détail qui m’a frappé' + f + ' : ' + a.nom + ' n’était plus ' + a.place + '.', cap(a.nom) + ' n’était plus ' + a.place + ', j’en suis certain' + f + '.']);
            faits.push({ t: 'note', qui: p.id, slot: s, arme: a.id, vu: s < quand });
          });
          ordre = d.piece === V.piece ? V.heure : (faux && d.piece === faux.piece && p.id !== faux.qui ? faux.heure : null);
          if (ordre !== null && s !== ordre && !redite[d.piece + (s > ordre)] && rng() < (s > ordre ? 0.75 : 0.35)) {
            redite[d.piece + (s > ordre)] = true;
            if (s > ordre) t += ' ' + pick(['La pièce était en désordre : un meuble de travers, une tache sur le sol. Sur le moment, je n’y ai pas pris garde.', 'J’ai remarqué un meuble de travers et une tache sur le sol, sans m’y arrêter.']);
            else t += ' ' + pick(['Tout y était parfaitement en ordre.', 'Rien n’y était dérangé, je vous l’assure.']);
            faits.push({ t: 'desordre', qui: p.id, slot: s, piece: d.piece, vu: s > ordre });
          }
        }
        element(aff, 't:' + p.id, t, faits, { qui: p.id, slot: s });
      });
    });

    aff.pieces.forEach(function (ou) {
      var src = 'f:' + ou.id;
      var sec = aff.secrets.filter(function (x) { return x.piece === ou.id; })[0], q = sec && gens(aff, sec.qui);
      if (ou.id === V.piece) {
        element(aff, src, pick([
          'Un meuble redressé de travers, des éclats de verre poussés dans un coin, une tache sombre frottée à la hâte sur le sol : on dirait qu’on s’est battu ici.',
          'Une chaise renversée, des éclats de verre sous un meuble, une tache sombre encore humide qu’on a tenté d’éponger : on dirait qu’on s’est battu ici.'
        ]), [], { trace: true });
      } else if (sec && sec.genre === 'porto') {
        element(aff, src, 'Une chaise de travers, des éclats de verre sous un meuble, une tache sombre épongée à la hâte sur le sol : on dirait qu’on s’est battu ici.', [], { trace: true, secret: q.id });
        element(aff, src, 'Sous la chaise, un mouchoir brodé aux initiales « ' + q.ini + ' ».', [], { secret: q.id });
      } else {
        element(aff, src, pick(['Rien d’anormal : pas un meuble déplacé, aucune trace de lutte.', 'Tout est en ordre. Aucune trace de lutte, rien n’a été nettoyé à la hâte.']), [{ t: 'net', piece: ou.id }]);
        if (sec && sec.genre === 'lettres') element(aff, src, 'Dans un seau de métal, des lettres à demi brûlées. Sur un fragment intact, une signature : « ' + q.prenom + ' ».', [], { secret: q.id });
        if (sec && sec.genre === 'tiroir') element(aff, src, 'Un coffret à documents, laissé là par ' + v.court + ', a été forcé. Au fond, ' + (q.g === 'f' ? 'une broche gravée' : 'un bouton de manchette gravé') + ' « ' + q.ini + ' ».', [], { secret: q.id });
      }
      aff.armes.forEach(function (a) {
        if (a.lieu !== ou.id) return;
        if (a.id === V.arme) element(aff, src, cap(a.nom) + ', qui se trouve d’ordinaire ' + a.place + ', a disparu.', [{ t: 'arme', arme: a.id }]);
        else element(aff, src, pick([cap(a.nom) + ' est bien ' + a.place + ' : rien à signaler.', 'Rien à dire ' + de(a.nom) + ', toujours ' + a.place + '.', cap(a.nom) + ' n’a pas bougé : on le voit ' + a.place + ', sous une fine couche de poussière.'].slice(0, a.nom.indexOf('la ') === 0 ? 2 : 3)), [{ t: 'intacte', arme: a.id }]);
      });
      if (ou.id === V.cachette) element(aff, src, cap(ou.cache) + ', quelqu’un a caché ' + arme.nom + ' : ' + GENRES[aff.genre].trace + '.', [{ t: 'arme', arme: arme.id }]);
    });

    aff.secrets.forEach(function (x) {
      var q = gens(aff, x.qui), f = e(q.g), ou = piece(aff, x.piece), h = heureTxt(x.heure), t;
      var faits = [{ t: 'dit', qui: q.id, slot: x.heure, piece: x.piece, avec: [] }];
      if (x.genre === 'porto') {
        t = 'Soit. À ' + h + ', j’étais ' + ou.dans + ', seul' + f + '. J’ai renversé une carafe de porto et brisé deux verres ; j’ai épongé de mon mieux et je me suis tu' + f + ' par amour-propre. Cette tache n’a rien à voir avec la mort ' + de(v.court) + '.';
        faits.push({ t: 'explique', qui: q.id, piece: x.piece });
      } else if (x.genre === 'lettres') {
        t = 'Ces lettres sont les miennes. À ' + h + ', j’étais ' + ou.dans + ', seul' + f + ', occupé' + f + ' à les brûler. Une vieille histoire, sans rapport avec ce drame.';
      } else {
        t = 'C’est moi qui ai forcé ce coffret. À ' + h + ', j’étais ' + ou.dans + ', seul' + f + ' : je voulais reprendre une lettre écrite à ' + v.court + ' dans un moment de colère. Rien de plus.';
      }
      element(aff, 'aveu:' + q.id, t, faits, { qui: q.id, slot: x.heure });
    });
  }

  // Indices relevés sur le corps : on en ajoute tant que plusieurs hypothèses tiennent encore.
  function completer(aff) {
    var V = aff.verite, c = gens(aff, V.coupable), pistes, garde = [], sol, i, essai, reste;
    function indice(x) { return { src: 'corps', texte: x[0], faits: [x[1]] }; }
    function compte(liste) { return hypotheses(aff, savoir(aff.elements.concat(liste))); }

    function poids(x) { return aff.suspects.filter(function (p) { return p[x[1].cle] === x[1].val; }).length; }
    pistes = shuffle([
      ['Entre les doigts crispés de la victime, quelques cheveux ' + c.cheveux + ', arrachés pendant la lutte.', { t: 'trait', cle: 'cheveux', val: c.cheveux }],
      [aff.genre === 'lien' ? 'D’après la torsion du lien, la personne qui a serré se sert de sa main ' + c.main + '.' : 'D’après l’angle de la blessure, le coup a été porté de la main ' + c.main + '.', { t: 'trait', cle: 'main', val: c.main }],
      ['Dans la poussière de la lingerie, une empreinte nette : ' + (c.g === 'f' ? 'un escarpin de femme, à talon fin.' : 'un soulier d’homme.'), { t: 'trait', cle: 'g', val: c.g }]
    ].concat(c.tabac ? [['Sur le drap qui enveloppe le corps, ' + CENDRE[c.tabac] + ' : la personne qui a traîné le corps jusqu’ici fume ' + TABAC[c.tabac] + '.', { t: 'trait', cle: 'tabac', val: c.tabac }]] : [])).sort(function (a, b) { return poids(b) - poids(a); }).map(indice);
    pistes.push(indice(['La montre de la victime s’est brisée pendant la lutte. Elle est arrêtée à ' + heureTxt(V.heure, int(2, 5) * 5) + '.', { t: 'heure', slot: V.heure }]));

    garde.push(pistes.shift());
    sol = compte(garde);
    for (i = 0; i < pistes.length && sol.length > 1; i++) {
      essai = compte(garde.concat(pistes[i]));
      if (essai.length < sol.length) { garde.push(pistes[i]); sol = essai; }
    }
    if (sol.length !== 1 || sol[0].c !== V.coupable || sol[0].w !== V.arme || sol[0].r !== V.piece || sol[0].t !== V.heure) return false;
    for (i = garde.length - 1; i >= 0 && garde.length > 1; i--) {
      reste = garde.slice(0, i).concat(garde.slice(i + 1));
      if (compte(reste).length === 1) garde = reste;
    }
    garde.forEach(function (x) { element(aff, x.src, x.texte, x.faits); });
    return true;
  }

  // ---------- Solveur ----------
  // Rassemble les faits portés par une liste d'éléments du dossier.
  function savoir(elements) {
    var k = { dits: [], notes: [], desordres: [], expliques: [], traits: [], intactes: {}, nettes: {}, arme: null, genre: null, fenetre: null, heure: null };
    elements.forEach(function (el) {
      el.faits.forEach(function (f) {
        if (f.t === 'dit') k.dits.push(f);
        else if (f.t === 'note') k.notes.push(f);
        else if (f.t === 'desordre') k.desordres.push(f);
        else if (f.t === 'explique') k.expliques.push(f);
        else if (f.t === 'trait') k.traits.push(f);
        else if (f.t === 'intacte') k.intactes[f.arme] = true;
        else if (f.t === 'net') k.nettes[f.piece] = true;
        else if (f.t === 'arme') k.arme = f.arme;
        else if (f.t === 'genre') k.genre = f.genre;
        else if (f.t === 'fenetre') k.fenetre = f;
        else if (f.t === 'heure') k.heure = f.slot;
      });
    });
    return k;
  }

  function memeGroupe(a, b) {
    return a.avec.length === b.avec.length && a.avec.indexOf(b.qui) >= 0 && b.avec.indexOf(a.qui) >= 0 &&
      a.avec.every(function (x) { return x === b.qui || b.avec.indexOf(x) >= 0; });
  }
  function contredit(a, b) {
    if (a.slot !== b.slot || a.qui === b.qui) return false;
    if (a.piece === b.piece) return !memeGroupe(a, b);
    return a.avec.indexOf(b.qui) >= 0 || b.avec.indexOf(a.qui) >= 0 || a.avec.some(function (x) { return b.avec.indexOf(x) >= 0; });
  }
  function accord(dits) {
    for (var i = 0; i < dits.length; i++) for (var j = i + 1; j < dits.length; j++) if (contredit(dits[i], dits[j])) return false;
    return true;
  }
  // c a-t-il pu se trouver dans cette pièce à cette tranche, d'après les autres ?
  function libre(c, s, ou, dits) {
    return !dits.some(function (d) {
      if (d.slot !== s) return false;
      return d.piece === ou ? d.avec.indexOf(c) < 0 : d.avec.indexOf(c) >= 0;
    });
  }
  function accessible(c, w, r, t, k, dits) {
    var apres = -1, avant = 99, g;
    k.notes.forEach(function (n) {
      if (n.qui === c || n.arme !== w.id) return;
      if (n.vu) apres = Math.max(apres, n.slot); else avant = Math.min(avant, n.slot);
    });
    if (w.lieu === r) return apres < t && t < avant;
    for (g = apres + 1; g < Math.min(t, avant); g++) if (libre(c, g, w.lieu, dits)) return true;
    return false;
  }

  // Toutes les combinaisons coupable / arme / pièce / heure que les faits connus n'excluent pas.
  // opt.seul limite à un suspect ; opt.sansAccord, sansAcces, sansTraits désactivent une famille de règles.
  function hypotheses(aff, k, opt) {
    var out = [];
    opt = opt || {};
    aff.suspects.forEach(function (p) {
      var c = p.id, dits, t;
      if (opt.seul && opt.seul !== c) return;
      if (!opt.sansTraits && k.traits.some(function (x) { return p[x.cle] !== x.val; })) return;
      dits = k.dits.filter(function (d) { return d.qui !== c; });
      if (!opt.sansAccord && !accord(dits)) return;
      for (t = 0; t < aff.T; t++) {
        if (k.fenetre && (t < k.fenetre.de || t > k.fenetre.a)) continue;
        if (k.heure !== null && k.heure !== t) continue;
        if (dits.some(function (d) { return d.slot >= t && d.avec.indexOf('V') >= 0; })) continue;
        if (dits.some(function (d) { return d.slot === t && d.avec.indexOf(c) >= 0; })) continue;
        aff.pieces.forEach(function (ou) {
          var r = ou.id;
          if (k.nettes[r] || k.expliques.some(function (x) { return x.qui !== c && x.piece === r; })) return;
          if (dits.some(function (d) { return d.slot === t && d.piece === r; })) return;
          if (k.desordres.some(function (n) { return n.qui !== c && n.piece === r && (n.vu ? n.slot <= t : n.slot >= t); })) return;
          aff.armes.forEach(function (w) {
            if ((k.genre && w.genre !== k.genre) || k.intactes[w.id] || (k.arme && k.arme !== w.id)) return;
            if (!opt.sansAcces && !accessible(c, w, r, t, k, dits)) return;
            out.push({ c: c, w: w.id, r: r, t: t });
          });
        });
      }
    });
    return out;
  }

  // ---------- Actions ----------
  // Clés : i:suspect (interroger), f:pièce (fouiller), corps, a:suspect (aveu obtenu par confrontation).
  function actionsDe(aff) {
    return aff.suspects.map(function (p) { return 'i:' + p.id; })
      .concat(aff.pieces.map(function (p) { return 'f:' + p.id; }), 'corps', aff.secrets.map(function (x) { return 'a:' + x.qui; }));
  }
  function reunis(aff, fait) {
    return aff.elements.filter(function (el) {
      var p = el.src.split(':');
      if (p[0] === 'dossier') return true;
      if (p[0] === 'corps') return !!fait.corps;
      if (p[0] === 'aveu') return !!(fait['a:' + p[1]] && fait['i:' + p[1]] && fait['f:' + secretDe(aff, p[1]).piece]);
      return !!fait[(p[0] === 't' ? 'i:' : 'f:') + p[1]];
    });
  }
  // Un ensemble d'actions dont on ne peut plus rien retirer sans perdre l'unicité de la solution.
  function necessaires(aff) {
    var cles = shuffle(actionsDe(aff)), fait = {}, tour;
    cles.forEach(function (c) { fait[c] = true; });
    for (tour = 0; tour < 2; tour++) cles.forEach(function (c) {
      if (!fait[c]) return;
      fait[c] = false;
      if (hypotheses(aff, savoir(reunis(aff, fait))).length !== 1) fait[c] = true;
    });
    return cles.filter(function (c) { return fait[c]; });
  }

  // ---------- Dénouement ----------
  function recit(aff) {
    var V = aff.verite, v = aff.victime, c = gens(aff, V.coupable), arme = parId(aff.armes, V.arme), ou = piece(aff, V.piece), f = e(c.g), I = cap(il(c.g));
    var m = V.dits[c.id][V.heure], out = [], t;
    out.push(complet(c) + ' a tué ' + complet(v) + ' ' + ou.dans + ', entre ' + heureTxt(V.heure) + ' et ' + heureTxt(V.heure + 1) + ', avec ' + arme.nom + '. ' + c.mobile(v));
    if (V.prise === V.heure) t = 'L’arme était sur place : ' + arme.nom + ' se trouvait ' + arme.place + '. ';
    else t = 'À ' + heureTxt(V.prise) + ', ' + il(c.g) + ' avait pris ' + arme.nom + ' ' + piece(aff, arme.lieu).dans + '. ';
    t += I + ' a ensuite traîné le corps jusqu’à la lingerie, puis caché l’arme ' + piece(aff, V.cachette).cache + ', ' + piece(aff, V.cachette).dans + '.';
    out.push(t);
    t = 'Interrogé' + f + ', ' + il(c.g) + ' a prétendu avoir passé cette demi-heure ' + piece(aff, m.piece).dans +
      (m.avec.length ? ' avec ' + liste(m.avec.map(function (id) { return court(aff, id); })) : ', seul' + f) + '.';
    if (V.revenant) t += ' Pour brouiller l’heure, ' + il(c.g) + ' a même affirmé avoir vu ' + v.court + ' en vie à ' + heureTxt(V.revenant) + '.';
    out.push(t);
    aff.secrets.forEach(function (x) {
      out.push(cap(court(aff, x.qui)) + ' cachait autre chose : ' + SECRETS[x.genre] + ', ' + piece(aff, x.piece).dans + ', à ' + heureTxt(x.heure) + '.');
    });
    return out;
  }

  // Pourquoi le crime n'a pas pu avoir lieu à une autre tranche, tout le reste étant acquis.
  function ecarte(aff, k, dits, t) {
    var V = aff.verite, c = gens(aff, V.coupable), ou = piece(aff, V.piece), arme = parId(aff.armes, V.arme), x;
    x = dits.filter(function (d) { return d.slot >= t && d.avec.indexOf('V') >= 0; }).sort(function (a, b) { return b.slot - a.slot; })[0];
    if (x) return court(aff, x.qui) + ' a vu ' + aff.victime.court + ' en vie à ' + heureTxt(x.slot) + '.';
    x = dits.filter(function (d) { return d.slot === t && d.avec.indexOf(c.id) >= 0; })[0];
    if (x) return c.court + ' était alors ' + piece(aff, x.piece).dans + ', et ' + court(aff, x.qui) + ' le confirme.';
    x = dits.filter(function (d) { return d.slot === t && d.piece === ou.id; })[0];
    if (x) return court(aff, x.qui) + ' se trouvait alors ' + ou.dans + ' et n’y a rien vu.';
    x = k.desordres.filter(function (n) { return n.qui !== c.id && n.piece === ou.id && (n.vu ? n.slot <= t : n.slot >= t); })[0];
    if (x) return court(aff, x.qui) + (x.vu ? ' a trouvé ' + ou.nom + ' en désordre dès ' : ' a vu ' + ou.nom + ' encore en ordre à ') + heureTxt(x.slot) + '.';
    if (!accessible(c.id, arme, ou.id, t, k, dits)) return c.court + ' n’avait pas encore pu prendre ' + arme.nom + '.';
    return 'la montre brisée de la victime indique une autre demi-heure.';
  }

  function conclusions(aff) {
    var V = aff.verite, v = aff.victime, c = gens(aff, V.coupable), arme = parId(aff.armes, V.arme), ou = piece(aff, V.piece), h = heureTxt(V.heure);
    var k = savoir(aff.elements), dits = k.dits.filter(function (d) { return d.qui !== c.id; }), out = [], l, x, noms;
    var miens = k.dits.filter(function (d) { return d.qui === c.id; });
    var heurts = [];   // récits d'innocents que le coupable contredit
    miens.forEach(function (m) { dits.forEach(function (d) { if (contredit(m, d)) heurts.push({ mien: m, autre: d }); }); });

    l = ['Le médecin plaçait la mort entre ' + heureTxt(aff.debut) + ' et ' + heureTxt(aff.fin + 1) + '.'];
    for (x = aff.debut; x <= aff.fin; x++) if (x !== V.heure) l.push('Pas à ' + heureTxt(x) + ' : ' + ecarte(aff, k, dits, x));
    out.push({ titre: 'L’heure : ' + h, lignes: l });

    l = ['Les traces de lutte se trouvaient ' + ou.dans + '.'];
    aff.secrets.forEach(function (s) {
      if (s.genre === 'porto') l.push('Le désordre relevé ' + piece(aff, s.piece).dans + ' venait d’une carafe renversée : ' + court(aff, s.qui) + ' l’a reconnu.');
    });
    noms = aff.pieces.filter(function (p) { return dits.some(function (d) { return d.slot === V.heure && d.piece === p.id; }); }).map(function (p) { return p.dans; });
    if (noms.length) l.push('À ' + h + ', des témoins se trouvaient ' + liste(noms) + ' : le crime n’a pas pu y avoir lieu.');
    out.push({ titre: 'Le lieu : ' + ou.nom, lignes: l });

    l = ['Le médecin avait reconnu la marque laissée par ' + GENRES[aff.genre].bref + '.', cap(arme.nom) + ' n’était plus ' + arme.place + ' : c’est l’objet caché ' + piece(aff, V.cachette).cache + ', ' + piece(aff, V.cachette).dans + '.'];
    noms = aff.armes.filter(function (a) { return a.genre === aff.genre && a !== arme; }).map(function (a) { return a.nom; });
    if (noms.length) l.push(cap(liste(noms)) + (noms.length > 1 ? ' n’avaient' : ' n’avait') + ' pas quitté ' + (noms.length > 1 ? 'leur' : 'sa') + ' place.');
    x = k.notes.filter(function (n) { return n.arme === arme.id; });
    noms = [];
    x.sort(function (a, b) { return a.slot - b.slot; });
    x.filter(function (n) { return n.vu; }).slice(-1).forEach(function (n) { noms.push(court(aff, n.qui) + ' a noté sa présence à ' + heureTxt(n.slot)); });
    x.filter(function (n) { return !n.vu; }).slice(0, 1).forEach(function (n) { noms.push(court(aff, n.qui) + ' a remarqué son absence dès ' + heureTxt(n.slot)); });
    if (noms.length) l.push(cap(noms.join(' ; ')) + '.');
    out.push({ titre: 'L’arme : ' + arme.nom, lignes: l });

    l = [];
    x = V.dits[c.id][V.heure];
    noms = x.avec.map(function (id) { return court(aff, id); });
    if (noms.length) l.push(cap(c.court) + ' affirmait avoir passé la demi-heure de ' + h + ' ' + piece(aff, x.piece).dans + ' avec ' + liste(noms) + '. ' + cap(liste(noms)) + (noms.length > 1 ? ' ne l’y ont' : ' ne l’y a') + ' pas vu' + e(c.g) + '.');
    else l.push(cap(c.court) + ' disait avoir été seul' + e(c.g) + ' ' + piece(aff, x.piece).dans + ' à ' + h + ' : personne ne peut le confirmer.');
    V.mensonges.forEach(function (s) {
      var q = heurts.filter(function (o) { return o.mien.slot === s; })[0];
      if (q && s !== V.heure) l.push(cap(c.court) + ' se disait aussi ' + piece(aff, q.mien.piece).dans + ' à ' + heureTxt(s) + ' : le récit ' + de(court(aff, q.autre.qui)) + ' ne s’accorde pas avec le sien.');
    });
    if (V.prise !== V.heure) l.push('À ' + heureTxt(V.prise) + ', ' + il(c.g) + ' a pu passer ' + piece(aff, arme.lieu).dans + ', où se trouvait ' + arme.nom + '.');
    k.traits.forEach(function (tr) {
      if (tr.cle === 'cheveux') l.push('Les cheveux ' + tr.val + ' trouvés dans la main de la victime sont de la couleur des siens.');
      else if (tr.cle === 'tabac') l.push(cap(il(c.g)) + ' fume ' + TABAC[tr.val] + ', comme la personne qui a traîné le corps.');
      else if (tr.cle === 'main') l.push(cap(il(c.g)) + ' est ' + manuel(c) + ', comme l’auteur du geste.');
      else l.push('L’empreinte relevée près du corps est celle d’' + (c.g === 'f' ? 'une femme' : 'un homme') + '.');
    });
    out.push({ titre: 'Le coupable : ' + complet(c), lignes: l });

    l = aff.suspects.filter(function (p) { return p !== c; }).map(function (p) {
      var nom = cap(p.court), tr, d, q;
      tr = k.traits.filter(function (t) { return p[t.cle] !== t.val; })[0];
      if (tr && tr.cle === 'cheveux') return nom + ' a les cheveux ' + p.cheveux + ', et non ' + tr.val + '.';
      if (tr && tr.cle === 'tabac') return nom + ' ' + fume(p) + ' : la cendre n’est pas la sienne.';
      if (tr && tr.cle === 'main') return nom + ' est ' + manuel(p) + ' : le geste n’est pas le sien.';
      if (tr) return nom + ' est ' + (p.g === 'f' ? 'une femme' : 'un homme') + ' : l’empreinte n’est pas la sienne.';
      d = dits.filter(function (o) { return o.slot === V.heure && o.qui !== p.id && o.avec.indexOf(p.id) >= 0; })[0];
      if (d) return nom + ' était ' + piece(aff, d.piece).dans + ' à ' + h + ' : ' + court(aff, d.qui) + ' le confirme.';
      if (V.dits[c.id][V.heure].avec.indexOf(p.id) >= 0) return c.court.replace(/^l/, 'L') + ' dit avoir passé la demi-heure de ' + h + ' avec ' + p.court + ' : si c’est vrai, ' + p.court + ' a un alibi ; si c’est faux, c’est ' + c.court + ' qui ment.';
      q = heurts.filter(function (o) { return o.autre.qui !== p.id; })[0];
      if (q) return 'Accuser ' + p.court + ' obligerait à croire à la fois ' + c.court + ' et ' + court(aff, q.autre.qui) + ', dont les récits se contredisent sur ' + heureTxt(q.mien.slot) + '.';
      if (hypotheses(aff, k, { seul: p.id, sansAcces: true }).length) return nom + ' n’a pas pu prendre ' + arme.nom + ' à temps : les témoignages ne lui en laissent pas l’occasion.';
      return nom + ' : à aucune heure compatible avec le rapport du médecin ' + il(p.g) + ' n’a pu se trouver seul' + e(p.g) + ' avec la victime ' + ou.dans + '.';
    });
    out.push({ titre: 'Les autres', lignes: l });
    return out;
  }

  // ---------- Partie ----------
  // S : la partie en cours. A : l'affaire.
  var S, A;

  function nouvelle(graine, niv) {
    graine = graine || Math.random().toString(36).slice(2, 8);
    if (!NIVEAUX[niv]) niv = 'normal';
    A = creer(graine, niv);
    S = {
      actions: A.budget, fausses: 0, fait: {}, onglet: 'enquete', heure: A.debut, grille: {}, notes: '',
      acc: { c: null, w: null, r: null }, dernier: null, alerte: '', confronte: null, fini: null
    };
    $('#seed').value = graine;
    $('#niveau').value = niv;
    try { history.replaceState(null, '', '#' + encodeURIComponent(graine) + '/' + niv); } catch (err) { /* page ouverte hors navigateur */ }
  }

  function connus() { return reunis(A, S.fait); }
  function origine(src) {
    var p = src.split(':');
    if (p[0] === 'dossier') return 'Dossier';
    if (p[0] === 'corps') return 'Le corps';
    if (p[0] === 't') return 'Déposition ' + de(gens(A, p[1]).court);
    if (p[0] === 'aveu') return 'Aveu ' + de(gens(A, p[1]).court);
    return cap(piece(A, p[1]).nom);
  }
  function depenser() {
    S.actions--;
    S.alerte = S.actions > 0 ? '' : 'L’aube se lève sur le manoir. Tu n’as plus le temps de chercher : il te reste une seule accusation.';
    if (S.actions <= 0) S.onglet = 'accusation';
  }
  function pieces(src) { return A.elements.filter(function (el) { return el.src === src; }); }

  function interroger(id) {
    var p = gens(A, id), neuf = !S.fait['i:' + id];
    if (neuf && (S.actions <= 0 || S.fini)) return;
    S.fait['i:' + id] = true;
    S.dernier = { titre: 'Déposition ' + de(complet(p)), intro: p.accueil, src: ['t:' + id, 'aveu:' + id] };
    if (neuf) depenser();
  }
  function fouiller(id) {
    var neuf = !S.fait['f:' + id];
    if (neuf && (S.actions <= 0 || S.fini)) return;
    S.fait['f:' + id] = true;
    S.dernier = { titre: 'Fouille : ' + piece(A, id).nom, src: ['f:' + id] };
    if (neuf) depenser();
  }
  function examiner() {
    var neuf = !S.fait.corps;
    if (neuf && (S.actions <= 0 || S.fini)) return;
    S.fait.corps = true;
    S.dernier = { titre: 'Examen du corps, dans la lingerie', src: ['corps'] };
    if (neuf) depenser();
  }

  function confronter(id, elId) {
    var p = gens(A, id), el = parId(A.elements, elId), sec = secretDe(A, id), dit, mien, texte, geste = '';
    S.confronte = null;
    if (S.actions <= 0 || S.fini) return;
    dit = el.faits.filter(function (f) { return f.t === 'dit'; })[0];
    mien = dit && pieces('t:' + id).concat(S.fait['a:' + id] ? pieces('aveu:' + id) : []).map(function (x) { return x.faits[0]; })
      .filter(function (f) { return f && f.t === 'dit' && contredit(f, dit); })[0];
    if (sec && el.secret === id && !S.fait['a:' + id]) {
      S.fait['a:' + id] = true;
      geste = cap(p.court) + ' baisse les yeux, hésite, puis se décide.';
      texte = pieces('aveu:' + id)[0].texte;
    } else if (el.qui === id) {
      texte = 'Je vous l’ai déjà dit, inspecteur, et je n’y change pas une virgule.';
    } else if (mien && id === A.verite.coupable) {
      geste = cap(p.court) + ' pâlit, cherche ses mots, se reprend trop vite.';
      texte = 'J’ai pu confondre les heures, voilà tout. Vous n’en tirerez rien de plus.';
    } else if (mien) {
      geste = cap(p.court) + ' vous regarde bien en face.';
      texte = 'Je maintiens chaque mot de ma déposition, inspecteur. Si quelqu’un prétend autre chose, c’est qu’il ment.';
    } else {
      texte = ESQUIVES[(el.id.length + el.texte.length + p.nom.length) % ESQUIVES.length];
    }
    S.dernier = { titre: 'Confrontation : ' + complet(p), rappel: el, geste: geste, parole: texte };
    depenser();
  }

  function accuser() {
    var V = A.verite;
    if (S.fini || !S.acc.c || !S.acc.w || !S.acc.r) return;
    if (S.acc.c === V.coupable && S.acc.w === V.arme && S.acc.r === V.piece) { S.fini = { gagne: true }; S.onglet = 'fin'; return; }
    S.fausses++;
    if (S.actions <= 0) { S.fini = { gagne: false }; S.onglet = 'fin'; return; }
    S.actions = Math.max(0, S.actions - COUT_ERREUR);
    S.alerte = 'Le juge d’instruction refuse de signer : ton accusation ne tient pas. ' +
      (S.actions > 0 ? 'Tu perds ' + COUT_ERREUR + ' actions.' : 'L’aube se lève : il te reste une seule accusation.');
  }

  function note() {
    if (!S.fini.gagne) return 0;
    return Math.max(1, Math.round(10 + 10 * S.actions / A.budget) - 4 * S.fausses);
  }
  function grade(n) {
    return n >= 17 ? 'Limier de légende' : n >= 14 ? 'Fin limier' : n >= 11 ? 'Inspecteur solide' : n > 0 ? 'Enquêteur laborieux' : 'Affaire non résolue';
  }
  function horloge() {
    var m = Math.round((1 - Math.max(0, S.actions) / A.budget) * NUIT / 5) * 5;
    return m ? Math.floor(m / 60) + ' h ' + (m % 60 < 10 ? '0' : '') + m % 60 : 'minuit';
  }

  // ---------- Affichage ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function bouton(act, label, attrs, cls, off) {
    return '<button type="button" class="btn ' + (cls || '') + '" data-act="' + act + '"' + (attrs || '') + (off ? ' disabled' : '') + '>' + label + '</button>';
  }
  function parole(el) { return el.src.charAt(0) === 't' || el.src.charAt(0) === 'a'; }
  function ligne(el) {
    return '<p class="piece' + (parole(el) ? ' dit' : '') + (el.tu ? ' tu' : '') + '">' + (parole(el) ? '« ' + esc(el.texte) + ' »' : esc(el.texte)) + '</p>';
  }

  function vueDernier() {
    var d = S.dernier, html;
    if (!d) return '<section class="feuille note"><h2>Par où commencer</h2><p>Interroge les invités, fouille les pièces, examine le corps. Tout ce que tu apprends est rangé dans le carnet, où une grille t’aide à recouper qui était où.</p><p>Tu as ' + A.budget + ' actions avant l’aube.</p></section>';
    html = '<section class="feuille note"><h2>' + esc(d.titre) + '</h2>';
    if (d.intro) html += '<p class="piece dit">« ' + esc(d.intro) + ' »</p>';
    if (d.rappel) html += '<p class="rappel">Tu lui mets sous les yeux — ' + esc(origine(d.rappel.src)) + ' : ' + esc(d.rappel.texte) + '</p>';
    if (d.geste) html += '<p class="geste">' + esc(d.geste) + '</p>';
    if (d.parole) html += '<p class="piece dit">« ' + esc(d.parole) + ' »</p>';
    if (d.src) html += connus().filter(function (el) { return d.src.indexOf(el.src) >= 0; }).map(ligne).join('');
    return html + '</section>';
  }

  function vueEnquete() {
    var bloque = S.actions <= 0 || !!S.fini, dossier = pieces('dossier');
    return '<div class="haut">' +
      '<section class="feuille pv"><span class="tampon">Affaire ' + esc(A.graine) + '</span><h2>Procès-verbal</h2>' + dossier.map(ligne).join('') + '</section>' +
      vueDernier() + '</div>' +
      '<h2 class="rubrique">Les suspects</h2><div class="fiches">' + A.suspects.map(function (p) {
        var vu = S.fait['i:' + p.id];
        return '<article class="fiche"><h3>' + esc(complet(p)) + '</h3>' +
          '<p class="etat">' + esc(cap(p.metier)) + ' — ' + esc(p.caractere) + '.</p>' +
          '<p><b>Lien :</b> ' + esc(p.lien(A.victime)) + '.</p>' +
          '<p><b>Mobile possible :</b> ' + esc(p.mobile(A.victime)) + '</p>' +
          '<p><b>Signalement :</b> cheveux ' + p.cheveux + ', ' + fume(p) + ', ' + manuel(p) + '.</p>' +
          '<div class="gestes">' + (vu ? bouton('interroger', 'Relire', ' data-id="' + p.id + '"') + bouton('confronter', 'Confronter', ' data-id="' + p.id + '"', 'main', bloque)
            : bouton('interroger', 'Interroger', ' data-id="' + p.id + '"', 'main', bloque)) + '</div></article>';
      }).join('') + '</div>' +
      '<h2 class="rubrique">Les lieux</h2><div class="fiches lieux">' +
      '<article class="fiche"><h3>La lingerie</h3><p class="etat">Le corps y a été retrouvé.</p><div class="gestes">' +
      (S.fait.corps ? bouton('examiner', 'Relire') : bouton('examiner', 'Examiner le corps', '', 'main', bloque)) + '</div></article>' +
      A.pieces.map(function (ou) {
        var vu = S.fait['f:' + ou.id], objets = A.armes.filter(function (a) { return a.lieu === ou.id; }).map(function (a) { return a.nom + ' (' + a.place + ')'; });
        return '<article class="fiche"><h3>' + esc(cap(ou.nom)) + '</h3>' +
          '<p class="etat">' + (objets.length ? 'On y range ' + esc(liste(objets)) + '.' : 'Aucun objet dangereux n’y est rangé.') + '</p>' +
          '<div class="gestes">' + (vu ? bouton('fouiller', 'Relire', ' data-id="' + ou.id + '"') : bouton('fouiller', 'Fouiller', ' data-id="' + ou.id + '"', 'main', bloque)) + '</div></article>';
      }).join('') + '</div>';
  }

  function vueGrille() {
    var lignes = [{ id: 'V', nom: A.victime.nom + ' †' }].concat(A.suspects.map(function (p) { return { id: p.id, nom: p.nom }; })), s, onglets = '';
    for (s = 0; s < A.T; s++) onglets += '<button type="button" class="heure' + (s === S.heure ? ' on' : '') + '" data-act="heure" data-i="' + s + '">' + heureTxt(s) + '</button>';
    return '<section class="feuille"><h2>Grille de recoupement</h2>' +
      '<p class="mode">Choisis une heure, puis clique une case pour la faire passer de présent <b class="m-p">●</b> à absent <b class="m-a">✕</b>, douteux <b class="m-d">?</b>, puis vide.</p>' +
      '<div class="heures">' + onglets + '</div>' +
      '<div class="defile"><table class="grille"><thead><tr><th></th>' + A.pieces.map(function (p) { return '<th>' + esc(p.court) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      lignes.map(function (l) {
        return '<tr><th>' + esc(l.nom) + '</th>' + A.pieces.map(function (p) {
          var cle = S.heure + '|' + l.id + '|' + p.id, m = S.grille[cle] || '';
          return '<td><button type="button" class="case m-' + m + '" data-act="case" data-k="' + cle + '" aria-label="' + esc(l.nom + ', ' + p.nom) + '">' + MARQUES[m] + '</button></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="mode">' + bouton('vider', 'Effacer la grille') + '</p></section>';
  }

  function vueCarnet() {
    var k = connus(), depos = '', indices = '';
    A.suspects.forEach(function (p) {
      var l = k.filter(function (el) { return el.src === 't:' + p.id || el.src === 'aveu:' + p.id; });
      if (l.length) depos += '<h3>' + esc(complet(p)) + '</h3>' + l.map(ligne).join('');
    });
    ['dossier', 'corps'].concat(A.pieces.map(function (p) { return 'f:' + p.id; })).forEach(function (src) {
      var l = k.filter(function (el) { return el.src === src; });
      if (l.length) indices += '<h3>' + esc(origine(src)) + '</h3>' + l.map(ligne).join('');
    });
    return '<div class="carnet"><div>' +
      '<section class="feuille"><h2>Dépositions</h2>' + (depos || '<p class="mode">Personne n’a encore été interrogé.</p>') + '</section>' +
      '<section class="feuille"><h2>Indices matériels</h2>' + indices + '</section></div><div>' +
      vueGrille() +
      '<section class="feuille"><h2>Notes</h2><textarea id="notes" rows="8" placeholder="Tes hypothèses, tes doutes…">' + esc(S.notes) + '</textarea></section></div></div>';
  }

  function choix(cle, titre, items) {
    return '<fieldset class="choix"><legend>' + titre + '</legend>' + items.map(function (it) {
      return '<button type="button" class="btn' + (S.acc[cle] === it.id ? ' on' : '') + '" data-act="choix" data-k="' + cle + '" data-id="' + it.id + '">' + esc(it.nom) + '</button>';
    }).join('') + '</fieldset>';
  }
  function vueAccusation() {
    var pret = S.acc.c && S.acc.w && S.acc.r;
    return '<section class="feuille acte"><span class="tampon">Mandat</span><h2>Accusation</h2>' +
      '<p class="mode">Désigne le coupable, l’arme et la pièce du crime. ' + (S.actions > 0 ? 'Une erreur te coûte ' + COUT_ERREUR + ' actions.' : 'C’est ta dernière chance.') + '</p>' +
      choix('c', 'Le coupable', A.suspects.map(function (p) { return { id: p.id, nom: complet(p) }; })) +
      choix('w', 'L’arme', A.armes.map(function (a) { return { id: a.id, nom: cap(a.nom) }; })) +
      choix('r', 'Le lieu', A.pieces.map(function (p) { return { id: p.id, nom: cap(p.nom) }; })) +
      '<div class="gestes">' + bouton('accuser', 'Signer l’accusation', '', 'main', !pret) + bouton('renoncer', 'Renoncer et lire le dénouement') + '</div></section>';
  }

  function vueFin() {
    var n = note(), k = connus().length;
    return '<section class="feuille acte"><span class="tampon">' + (S.fini.gagne ? 'Affaire résolue' : 'Classée') + '</span>' +
      '<h2>' + (S.fini.gagne ? 'Tu tiens le coupable' : 'Le coupable t’a échappé') + '</h2>' +
      '<p class="verdict"><b>' + n + '/20</b> — ' + grade(n) + '. ' + Math.max(0, S.actions) + ' action' + (S.actions > 1 ? 's' : '') + ' restante' + (S.actions > 1 ? 's' : '') + ' sur ' + A.budget + ', ' +
      (S.fausses ? S.fausses + ' fausse' + (S.fausses > 1 ? 's' : '') + ' accusation' + (S.fausses > 1 ? 's' : '') : 'aucune fausse accusation') + '. Tu avais réuni ' + k + ' des ' + A.elements.length + ' pièces du dossier.</p>' +
      '<h3>Ce qui s’est passé</h3>' + recit(A).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') +
      '<h3>Ce qui permettait de conclure</h3>' + conclusions(A).map(function (b) {
        return '<h4>' + esc(b.titre) + '</h4><ul>' + b.lignes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
      }).join('') +
      '<p class="mode">Le strict nécessaire tenait en ' + A.utiles.length + ' actions.</p>' +
      '<div class="gestes">' + bouton('hasard', 'Nouvelle affaire', '', 'main') + '</div></section>';
  }

  function vueModal() {
    var p = gens(A, S.confronte), k = connus().filter(function (el) { return el.src !== 'dossier'; }), groupes = [], html = '';
    k.forEach(function (el) { if (groupes.indexOf(el.src) < 0) groupes.push(el.src); });
    groupes.forEach(function (src) {
      html += '<h3>' + esc(origine(src)) + '</h3>' + k.filter(function (el) { return el.src === src; }).map(function (el) {
        return '<button type="button" class="preuve" data-act="montrer" data-id="' + el.id + '">' + esc(el.texte) + '</button>';
      }).join('');
    });
    return '<div class="win" role="dialog" aria-modal="true"><h2>Confronter ' + esc(complet(p)) + '</h2>' +
      '<p class="mode">Choisis la pièce du dossier à lui mettre sous les yeux. Cela coûte une action.</p>' + html +
      '<div class="gestes">' + bouton('fermer', 'Annuler') + '</div></div>';
  }

  function render() {
    var onglets = S.fini ? [['fin', 'Dénouement'], ['enquete', 'Enquête'], ['carnet', 'Carnet']] : [['enquete', 'Enquête'], ['carnet', 'Carnet'], ['accusation', 'Accusation']];
    $('#actions').textContent = Math.max(0, S.actions) + '/' + A.budget;
    $('#horloge').textContent = horloge();
    $('#fausses').textContent = S.fausses;
    $('#onglets').innerHTML = onglets.map(function (o) {
      return '<button type="button" class="onglet' + (S.onglet === o[0] ? ' on' : '') + '" data-act="onglet" data-id="' + o[0] + '">' + o[1] + '</button>';
    }).join('');
    $('#screen').innerHTML = (S.alerte && !S.fini ? '<p class="alerte">' + esc(S.alerte) + '</p>' : '') +
      (S.onglet === 'fin' ? vueFin() : S.onglet === 'carnet' ? vueCarnet() : S.onglet === 'accusation' ? vueAccusation() : vueEnquete());
    $('#modal').hidden = !S.confronte;
    $('#modal').innerHTML = S.confronte ? vueModal() : '';
  }

  // ---------- Commandes ----------
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]'), id;
    if (!b) return;
    id = b.dataset.id;
    switch (b.dataset.act) {
      case 'onglet': S.onglet = id; break;
      case 'interroger': interroger(id); break;
      case 'fouiller': fouiller(id); break;
      case 'examiner': examiner(); break;
      case 'confronter': if (S.actions > 0 && !S.fini) S.confronte = id; break;
      case 'montrer': confronter(S.confronte, id); break;
      case 'fermer': S.confronte = null; break;
      case 'heure': S.heure = +b.dataset.i; break;
      case 'case': S.grille[b.dataset.k] = SUIVANT[S.grille[b.dataset.k] || '']; break;
      case 'vider': S.grille = {}; break;
      case 'choix': S.acc[b.dataset.k] = id; break;
      case 'accuser': accuser(); break;
      case 'renoncer': S.fini = { gagne: false }; S.onglet = 'fin'; break;
      case 'hasard': nouvelle('', $('#niveau').value); break;
    }
    render();
  });

  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'notes') S.notes = ev.target.value;
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && S.confronte) { S.confronte = null; render(); }
  });

  $('#seedForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    nouvelle($('#seed').value.trim(), $('#niveau').value);
    render();
  });

  (function () {
    var h = '', m;
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (err) { /* hash illisible : affaire au hasard */ }
    m = h.match(/^(.*)\/(facile|normal|difficile)$/);
    nouvelle(m ? m[1] : h, m ? m[2] : 'normal');
    render();
  })();
})();
