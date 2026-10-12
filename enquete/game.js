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

  // ---------- Affichage : outils ----------
  var ETATS = { '': 'case vide', p: 'présent', a: 'absent', d: 'douteux' };
  var TRAITS = {
    '': '',
    p: '<svg class="m-p" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13c2 2 4 5 6 8C13 13 17 7 21 3"/></svg>',
    a: '<svg class="m-a" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4c4 5 9 11 14 16M19 5C14 9 9 15 5 20"/></svg>',
    d: '<span class="m-d" aria-hidden="true">?</span>'
  };
  var PARAPHE = '<svg class="paraphe" viewBox="0 0 60 30" aria-hidden="true"><path d="M4 22c8-14 14-16 12-6s8 2 12-4s2 14 8 6s8-10 20-8"/></svg>';
  var FICELLE = '<svg class="ficelle" viewBox="0 0 60 44" aria-hidden="true"><path d="M57 24C44 6 30 40 16 22S4 6 1 3"/></svg>';

  // Silhouettes des fiches : coiffure, pilosité, lunettes, col.
  var PORTRAITS = {
    delmas: ['chignon', '', 'pincenez', 'montant'], vasseur: ['raie', 'moustache', '', 'papillon'],
    brossard: ['degarni', 'bacchantes', '', 'officier'], aubert: ['carre', '', '', 'claudine'],
    carbonnel: ['chauve', 'barbiche', 'pincenez', 'cravate'], rochefort: ['ondule', '', '', 'perles'],
    perrin: ['canotier', 'moustache', '', 'papillon'], castel: ['cloche', '', '', 'foulard'],
    morel: ['calotte', '', 'rondes', 'romain'], verdier: ['bandeaux', '', '', 'montant'],
    hartmann: ['bataille', 'barbe', 'rondes', 'cravate'], fontaine: ['garconne', '', '', 'sautoir']
  };
  var BUSTE = '<path d="M3 96C5 80 17 75 33 71V62M77 96C75 80 63 75 47 71V62"/>' +
    '<path class="plein" d="M25 38C25 22 55 22 55 38C55 50 48 60 40 60C32 60 25 50 25 38Z"/><path d="M25 37c-3-1-3 6 1 7M55 37c3-1 3 6-1 7"/>';
  var VISAGE = '<path d="M32.5 39h4M43.5 39h4M32 35.5q2.5-1.5 5 0M43 35.5q2.5-1.5 5 0M40 39.5l-1.6 7.5h3M36.5 52.5q3.5 1.6 7 0"/>';
  var COIFFES = {
    chignon: '<circle class="plein" cx="40" cy="13.5" r="6.5"/><path class="plein" d="M25 37C23 23 31 19 40 19s17 4 15 18c-2-6-7-9-15-9s-13 3-15 9Z"/>',
    raie: '<path class="plein" d="M25 37C23 24 30 18 41 18c9 0 15 6 14 19c-1-5-4-8-8-10c-7 3-15 3-22 10Z"/><path d="M34 20l3 6"/>',
    degarni: '<path d="M25 36c-3-4-2-9 1-11M55 36c3-4 2-9-1-11M27 27l2 3M53 27l-2 3"/>',
    chauve: '<path d="M32 28q4-3 8-3"/>',
    carre: '<path class="plein" d="M22 52C18 32 25 17 40 17s22 15 18 35h-4c2-10 0-18-5-23c-6 3-15 4-22 3c-2 5-2 13-1 20Z"/>',
    garconne: '<path class="plein" d="M22 52C18 32 25 17 40 17s22 15 18 35h-4c2-10 0-18-5-23c-6 3-15 4-22 3c-2 5-2 13-1 20Z"/><path d="M24 27q16-6 32 0"/><circle class="plein" cx="40" cy="23" r="1.8"/>',
    ondule: '<path class="plein" d="M23 49c-7-3-7-12-3-17c-3-7 3-14 9-14c3-5 11-6 14-2c6-3 13 2 13 9c5 4 5 13-1 18c2-7 0-15-6-20c-6 4-16 5-23 3c-3 5-4 13-3 23Z"/><path d="M30 21q4 2 5 6M47 19q-1 4 2 7"/>',
    canotier: '<path d="M25 36v-7M55 36v-7"/><path class="plein" d="M26 28V15h28v13Z"/><path d="M26 23h28"/><path class="bord" d="M12 28h56"/>',
    cloche: '<path d="M24 40c-2 5-1 9 2 12M56 40c2 5 1 9-2 12"/><path class="plein" d="M21 39C18 22 28 12 40 12s22 10 19 27c-6-4-13-5-19-5s-13 1-19 5Z"/><path d="M22 30c6-4 30-4 36 0"/>',
    calotte: '<path d="M25 36c-1-6 1-10 4-12M55 36c1-6-1-10-4-12"/><path class="plein" d="M29 26c3-8 19-8 22 0Z"/>',
    bandeaux: '<path class="plein" d="M25 38C22 24 31 18 40 18s18 6 15 20c-1-7-6-12-15-13c-9 1-14 6-15 13Z"/><path d="M40 18v7"/>',
    bataille: '<path class="plein" d="M24 37l-3-8l5 2l-2-8l6 4v-8l5 6l3-8l3 8l5-6v8l6-4l-2 8l5-2l-3 8c-2-6-7-10-16-10s-13 4-15 10Z"/>'
  };
  // Pilosité : ce qui passe sous les traits du visage, puis ce qui passe dessus.
  var POILS = {
    moustache: ['', '<path class="plein" d="M33.5 49.5q3.5-3 6.5 0q3-3 6.5 0q-3.5 1.6-6.5.6q-3 1-6.5-.6Z"/>'],
    bacchantes: ['', '<path class="plein" d="M29 47c3-2 8-2 11 1c3-3 8-3 11-1c1 2 3 2 4 0c0 5-5 6-9 4c-2-1-4-1-6 0c-2-1-4-1-6 0c-4 2-9 1-9-4c1 2 3 2 4 0Z"/><path d="M26 42v7M54 42v7"/>'],
    barbiche: ['', '<path class="plein" d="M33.5 49.5q3.5-3 6.5 0q3-3 6.5 0q-3.5 1.6-6.5.6q-3 1-6.5-.6Z"/><path class="plein" d="M36.5 56q3.5 1.5 7 0l-3.5 9Z"/>'],
    barbe: ['<path class="plein" d="M26 44c0 16 6 25 14 25s14-9 14-25c-2 6-5 8-8 8c-2-2-10-2-12 0c-3 0-6-2-8-8Z"/><path d="M33 58v6M37 59v8M41.5 59v8M46 58v6"/>', '']
  };
  var VERRES = {
    rondes: '<circle cx="34.5" cy="39.5" r="4.6"/><circle cx="45.5" cy="39.5" r="4.6"/><path d="M39.1 39h1.8M29.9 39l-4.5-1.5M50.1 39l4.5-1.5"/>',
    pincenez: '<ellipse cx="34.5" cy="39.5" rx="4" ry="3.2"/><ellipse cx="45.5" cy="39.5" rx="4" ry="3.2"/><path d="M38.5 38.6q1.5-1.6 3 0M49.5 40c5 7 4 20 1 30"/>'
  };
  var COLS = {
    cravate: '<path d="M33 70l7 7l7-7M40 77l-3 19M40 77l3 19M24 74l13 22M56 74L43 96"/>',
    papillon: '<path d="M33 70l7 6l7-6M24 74l12 22M56 74L44 96"/><path class="plein" d="M40 76l-7-4v8ZM40 76l7-4v8Z"/>',
    officier: '<path class="plein" d="M32 68h16v7H32Z"/><path d="M40 68v7M8 83l13-6M72 83l-13-6"/><circle cx="40" cy="82" r="1.3"/><circle cx="40" cy="90" r="1.3"/>',
    romain: '<path class="plein" d="M32 68h16v6H32Z"/><path d="M37 68v6M43 68v6M40 74v22"/>',
    claudine: '<path class="plein" d="M40 72c-5-3-10-2-12 3c3 3 9 3 12-3ZM40 72c5-3 10-2 12 3c-3 3-9 3-12-3Z"/>',
    montant: '<path class="plein" d="M32 66c5 3 11 3 16 0v6c-5 3-11 3-16 0Z"/><ellipse cx="40" cy="76.5" rx="2.4" ry="3"/>',
    perles: '<path d="M27 74q13 15 26 0"/><path class="perles" d="M31 70q9 10 18 0"/>',
    sautoir: '<path d="M27 74q13 11 26 0"/><path class="perles" d="M34 69c-2 14 1 22 6 27M46 69c2 14-1 22-6 27"/>',
    foulard: '<path d="M32 70q8 7 16 0M40 77l-5 12M40 77l4 11"/><path class="plein" d="M36 73h8v4h-8Z"/>'
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function bouton(act, label, attrs, cls, off) {
    return '<button type="button" class="btn ' + (cls || '') + '" data-act="' + act + '"' + (attrs || '') + (off ? ' disabled' : '') + '>' + label + '</button>';
  }
  function parole(el) { return el.src.charAt(0) === 't' || el.src.charAt(0) === 'a'; }
  // Pas de retour à la ligne avant une ponctuation haute ni après un guillemet ouvrant.
  function txt(s) { return esc(s).replace(/ ([;:?!»])/g, '&nbsp;$1').replace(/« /g, '«&nbsp;'); }
  function pluriel(n, mot) { return n + ' ' + mot.replace(/\*/g, n > 1 ? 's' : ''); }

  // Frappe de machine : quelques lettres pâles, grasses ou descendues, toujours les mêmes pour un même texte.
  function frappe(s) {
    var h = 2166136261 ^ s.length, out = '', i, c, r;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      h = h + s.charCodeAt(i) | 0;
      r = (h >>> 4) % 100;
      if (r < 8 && /[A-Za-zÀ-ÿ0-9]/.test(c)) out += '<span class="' + (r < 3 ? 'pale' : r < 6 ? 'gras' : 'bas') + '">' + c + '</span>';
      else if (c === ' ' && (/[;:?!»]/.test(s.charAt(i + 1)) || s.charAt(i - 1) === '«')) out += '&nbsp;';
      else out += esc(c);
    }
    return out;
  }

  function portrait(p) {
    var t = PORTRAITS[p.id] || ['raie', '', '', 'cravate'], poils = POILS[t[1]] || ['', ''];
    return '<svg class="portrait" viewBox="0 0 80 96" aria-hidden="true">' + BUSTE + poils[0] + VISAGE + poils[1] + COIFFES[t[0]] + (VERRES[t[2]] || '') + COLS[t[3]] + '</svg>';
  }

  // ---------- Affichage : pièces du dossier ----------
  function rang(cle) { return actionsDe(A).indexOf(cle) + 3; }
  function entete(titre, n, legiste) {
    return '<header class="entete"><p class="service">' + (legiste ? 'Institut<br>médico-légal' : 'Sûreté générale<br>Brigade mobile') + '</p>' +
      '<h3>' + titre + '</h3>' + (n ? '<p class="no">Pièce n° <b class="main">' + n + '</b></p>' : '<p class="no"></p>') + '</header>';
  }
  function declare(el) {
    return '<p class="dit' + (el.tu ? ' tu' : '') + (el.src.charAt(0) === 'a' ? ' aveu' : '') + '"><span class="marge">' + heureTxt(el.slot) + '</span>«&nbsp;' + frappe(el.texte) + '&nbsp;»</p>';
  }
  // Ce qui ne révèle rien reste une ligne du procès-verbal ; le reste part sous scellés.
  function releve(el) {
    if (el.faits.some(function (f) { return f.t === 'net' || f.t === 'intacte'; })) return '<p class="constat"><span class="marge">R.A.S.</span>' + frappe(el.texte) + '</p>';
    return '<div class="scelle">' + FICELLE + '<div class="etq"><p class="no">Scellé n° ' + el.id.slice(1) + '</p><p>' + frappe(el.texte) + '</p></div></div>';
  }
  function constat() {
    return '<section class="feuille pv" id="p-constat">' + entete('Procès-verbal de constatation', 1) +
      '<p>' + frappe(pieces('dossier')[0].texte) + '</p></section>';
  }
  function legiste() {
    return '<section class="feuille pv medical" id="p-legiste">' + entete('Rapport médico-légal', 2, true) +
      '<p>' + frappe(pieces('dossier')[1].texte) + '</p></section>';
  }
  function audition(p, bref) {
    var l = connus().filter(function (el) { return el.src === 't:' + p.id || el.src === 'aveu:' + p.id; });
    return '<section class="feuille pv" id="p-i-' + p.id + '">' + entete(bref ? esc(complet(p)) : 'Procès-verbal d’audition', rang('i:' + p.id)) +
      (bref ? '' : '<p class="formule">' + frappe(cap(A.manoir) + ', nuit du ' + A.date + '. Devant nous comparaît ' + p.prenom + ' ' + p.nom.toUpperCase() + ', ' + p.metier + ', qui déclare :') + '</p>' +
        '<p class="dit">«&nbsp;' + frappe(p.accueil) + '&nbsp;»</p>') +
      l.map(declare).join('') +
      (bref ? '' : '<footer class="signe"><span>Lecture faite, persiste et signe.' + PARAPHE + '</span><b class="main">' + esc(p.prenom.charAt(0) + '. ' + p.nom) + '</b></footer>') + '</section>';
  }
  function perquisition(ou, bref) {
    return '<section class="feuille pv" id="p-f-' + ou.id + '">' + entete(bref ? esc(cap(ou.nom)) : 'Procès-verbal de perquisition', rang('f:' + ou.id)) +
      (bref ? '' : '<p class="formule">' + frappe('Fouille ' + de(ou.nom) + '. Constaté et saisi ce qui suit :') + '</p>') +
      pieces('f:' + ou.id).map(releve).join('') + '</section>';
  }
  function examen(bref) {
    return '<section class="feuille pv medical" id="p-corps">' + entete(bref ? 'Le corps' : 'Constatations sur le corps', rang('corps'), true) +
      (bref ? '' : '<p class="formule">' + frappe('Examen pratiqué dans la lingerie, où le corps a été retrouvé. Relevé et placé sous scellés :') + '</p>') +
      pieces('corps').map(releve).join('') + '</section>';
  }
  function confrontation(d) {
    var el = d.rappel, o = origine(el.src);
    return '<section class="feuille pv">' + entete('Procès-verbal de confrontation') +
      '<p class="formule">' + frappe(d.titre + '. La pièce suivante lui est mise sous les yeux (' + o.charAt(0).toLowerCase() + o.slice(1) + ') :') + '</p>' +
      (parole(el) ? '<blockquote class="rappel">«&nbsp;' + frappe(el.texte) + '&nbsp;»</blockquote>' : releve(el)) +
      (d.geste ? '<p class="geste main">' + esc(d.geste) + '</p>' : '') +
      '<p class="dit"><span class="marge">rép.</span>«&nbsp;' + frappe(d.parole) + '&nbsp;»</p></section>';
  }

  // ---------- Affichage : enquête ----------
  function vueLecture() {
    var d = S.dernier, src, html;
    if (!d) {
      html = '<aside class="billet main"><p>Interroge les invités, fouille les pièces, examine le corps. Tout ce que tu apprends est rangé dans le carnet, où une grille t’aide à recouper qui était où.</p>' +
        '<p>Tu as ' + A.budget + ' actions avant l’aube.</p><p class="sig">Le commissaire</p></aside>' + constat() + legiste();
    } else if (d.rappel) {
      html = confrontation(d);
    } else {
      src = d.src[0].split(':');
      html = src[0] === 't' ? audition(gens(A, src[1])) : src[0] === 'f' ? perquisition(piece(A, src[1])) : examen();
    }
    if (d) html += '<p class="retour">' + bouton('constat', 'Revenir au procès-verbal de constatation', '', 'relire') + '</p>';
    return '<div class="lecture" id="lecture" tabindex="0" role="region" aria-label="Pièce sous les yeux">' + html + '</div>';
  }

  function rubrique(nom, valeur) { return '<div><dt>' + nom + '</dt><dd>' + txt(valeur) + '</dd></div>'; }
  function fiche(p, i) {
    var vu = S.fait['i:' + p.id], bloque = S.actions <= 0 || !!S.fini, attr = ' data-id="' + p.id + '"';
    return '<article class="fiche" aria-label="' + esc(complet(p)) + '">' +
      '<header><span>Fiche de signalement</span><span>n° ' + (i + 1) + '</span></header>' +
      '<div class="ident"><div class="photo">' + portrait(p) + '</div><dl class="cases">' +
      rubrique('Nom', p.nom.toUpperCase()) + rubrique('Prénom', p.prenom) + rubrique('Profession', p.metier) + '</dl></div>' +
      '<dl class="trio">' + rubrique('Cheveux', p.cheveux) + rubrique('Tabac', p.tabac || 'ne fume pas') + rubrique('Main', p.main) + '</dl>' +
      '<dl class="rubriques">' + rubrique('Observations', cap(p.caractere) + '.') + rubrique('Relations avec la victime', cap(p.lien(A.victime)) + '.') +
      rubrique('Mobile possible', p.mobile(A.victime)) + rubrique('Connu des services', 'Néant.') + '</dl>' +
      (vu ? '<span class="vu">Entendu' + e(p.g) + '</span>' : '') +
      '<div class="gestes">' + (vu ? bouton('confronter', 'Confronter', attr, 'acte', bloque) + bouton('interroger', 'Relire sa déposition', attr, 'relire')
        : bouton('interroger', 'Interroger', attr, 'acte', bloque)) + '</div></article>';
  }
  function croquis() {
    var bloque = S.actions <= 0 || !!S.fini;
    return '<section class="feuille croquis"><p class="legende main">Rez-de-chaussée, croquis sans échelle</p><div class="plan">' +
      '<article class="salle corps"><h3>La lingerie</h3><p>Le corps y a été retrouvé.</p><div class="gestes">' +
      (S.fait.corps ? bouton('examiner', 'Relire les constatations', '', 'relire') : bouton('examiner', 'Examiner le corps', '', 'acte', bloque)) + '</div></article>' +
      A.pieces.map(function (ou) {
        var vu = S.fait['f:' + ou.id], objets = A.armes.filter(function (a) { return a.lieu === ou.id; }).map(function (a) { return a.nom + ' (' + a.place + ')'; });
        return '<article class="salle"><h3>' + esc(cap(ou.nom)) + (vu ? ' <span class="fait">fouillé</span>' : '') + '</h3>' +
          '<p>' + (objets.length ? 'On y range ' + esc(liste(objets)) + '.' : 'Aucun objet dangereux n’y est rangé.') + '</p>' +
          '<div class="gestes">' + (vu ? bouton('fouiller', 'Relire le procès-verbal', ' data-id="' + ou.id + '"', 'relire') : bouton('fouiller', 'Fouiller', ' data-id="' + ou.id + '"', 'acte', bloque)) + '</div></article>';
      }).join('') + '</div></section>';
  }
  function vueEnquete() {
    return '<div class="table">' + vueLecture() + '<div class="pile">' +
      '<h2 class="crayon">Les invités de la soirée</h2><div class="fiches">' + A.suspects.map(fiche).join('') + '</div>' +
      '<h2 class="crayon">Les lieux</h2>' + croquis() + '</div></div>';
  }

  // ---------- Affichage : carnet ----------
  function vueGrille() {
    var lignes = [{ id: 'V', nom: A.victime.nom + ' †' }].concat(A.suspects.map(function (p) { return { id: p.id, nom: p.nom }; })), s, heures = '';
    for (s = 0; s < A.T; s++) heures += '<button type="button" class="heure' + (s === S.heure ? ' on' : '') + '" data-act="heure" data-i="' + s + '"' + (s === S.heure ? ' aria-current="true"' : '') + '>' + heureTxt(s) + '</button>';
    return '<section class="page"><h2 class="crayon">Qui était où ?</h2>' +
      '<div class="heures">' + heures + '</div>' +
      '<div class="defile"><table class="grille"><thead><tr><td></td>' + A.pieces.map(function (p) { return '<th scope="col"><span>' + esc(p.court) + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
      lignes.map(function (l) {
        return '<tr><th scope="row">' + esc(l.nom) + '</th>' + A.pieces.map(function (p) {
          var cle = S.heure + '|' + l.id + '|' + p.id, m = S.grille[cle] || '';
          return '<td><button type="button" class="case" data-act="case" data-k="' + cle + '" aria-label="' + esc(l.nom + ', ' + p.nom + ' : ' + ETATS[m]) + '">' + TRAITS[m] + '</button></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="mode">Choisis une heure, puis clique une case : ' + TRAITS.p + ' présent, ' + TRAITS.a + ' absent, ' + TRAITS.d + ' douteux, puis vide. ' +
      bouton('vider', 'Gommer toute la grille', '', 'relire') + '</p></section>';
  }

  function vueCarnet() {
    var depos = '', index = [], indices;
    A.suspects.forEach(function (p) {
      if (!S.fait['i:' + p.id]) return;
      depos += audition(p, true);
      index.push(['p-i-' + p.id, p.nom]);
    });
    index.push(['p-constat', 'Constatation'], ['p-legiste', 'Médecin']);
    indices = constat() + legiste();
    if (S.fait.corps) { indices += examen(true); index.push(['p-corps', 'Corps']); }
    A.pieces.forEach(function (ou) {
      if (!S.fait['f:' + ou.id]) return;
      indices += perquisition(ou, true);
      index.push(['p-f-' + ou.id, cap(ou.nom)]);
    });
    return '<div class="carnet"><div class="calepin" id="calepin">' + vueGrille() +
      '<section class="page lignee"><h2 class="crayon"><label for="notes">Notes</label></h2><textarea id="notes" class="main" rows="6" placeholder="Tes hypothèses, tes doutes…">' + esc(S.notes) + '</textarea></section></div>' +
      '<div class="pieces"><h2 class="crayon">Pièces versées au dossier</h2>' +
      '<p class="index">' + index.map(function (x) { return '<button type="button" class="btn relire" data-act="aller" data-id="' + x[0] + '">' + esc(x[1]) + '</button>'; }).join('') + '</p>' +
      (depos || '<p class="vide main">Personne n’a encore été interrogé.</p>') + indices + '</div></div>';
  }

  // ---------- Affichage : mandat et rapport de clôture ----------
  function blanc(texte, vide) {
    return '<span class="blanc' + (texte ? ' main' : '') + '">' + (texte ? esc(texte) : '<i>' + vide + '</i>') + '</span>';
  }
  function choix(cle, titre, items) {
    return '<fieldset class="mention' + (S.acc[cle] ? ' faite' : '') + '"><legend>' + titre + ' <i>(rayer les mentions inutiles)</i></legend>' + items.map(function (it) {
      var on = S.acc[cle] === it.id;
      return '<button type="button" class="option' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="choix" data-k="' + cle + '" data-id="' + it.id + '">' + esc(it.nom) + '</button>';
    }).join('') + '</fieldset>';
  }
  function vueAccusation() {
    var pret = S.acc.c && S.acc.w && S.acc.r, c = S.acc.c && gens(A, S.acc.c), v = A.victime;
    return '<section class="feuille mandat"><header class="tete"><p class="service">République française<br>Cabinet du juge d’instruction</p><h2>Mandat d’amener</h2></header>' +
      '<p class="mode">Remplis le mandat : désigne le coupable, l’arme et la pièce du crime. ' + (S.actions > 0 ? 'Si le juge refuse de le signer, tu perds ' + COUT_ERREUR + ' actions.' : 'C’est ta dernière chance.') + '</p>' +
      '<p class="dispositif">Nous, juge d’instruction, mandons et ordonnons à tous agents de la force publique d’amener devant nous ' +
      blanc(c && complet(c), 'nom du prévenu') + ', pour avoir donné la mort à ' + esc(complet(v)) + ' ' +
      blanc(S.acc.r && piece(A, S.acc.r).dans, 'lieu du crime') + ', au moyen ' + blanc(S.acc.w && de(parId(A.armes, S.acc.w).nom), 'arme employée') + '.</p>' +
      choix('c', 'Le prévenu', A.suspects.map(function (p) { return { id: p.id, nom: complet(p) }; })) +
      choix('r', 'Le lieu', A.pieces.map(function (p) { return { id: p.id, nom: cap(p.nom) }; })) +
      choix('w', 'L’arme', A.armes.map(function (a) { return { id: a.id, nom: cap(a.nom) }; })) +
      (S.fausses ? '<p class="refus main">' + pluriel(S.fausses, 'mandat* déjà refusé*') + ' par le juge.</p>' : '') +
      '<div class="gestes signature">' + bouton('accuser', 'Signer le mandat', '', 'acte', !pret) + bouton('renoncer', 'Renoncer et lire le rapport de clôture', '', 'relire') + '</div></section>';
  }

  function vueFin() {
    var n = note(), k = connus().length, gagne = S.fini.gagne;
    return '<section class="feuille pv cloture">' + entete('Rapport de clôture') +
      '<p class="tampon ' + (gagne ? 'classe' : 'echec') + '">' + (gagne ? 'Classé' : 'Non élucidé') + '</p>' +
      '<div class="avis main"><b>' + n + '/20</b><p>' + grade(n) + '. ' + (gagne ? 'Tu tiens le coupable.' : 'Le coupable t’a échappé.') + '</p></div>' +
      '<p>' + frappe((S.actions > 0 ? 'Il te restait ' + pluriel(S.actions, 'action*') : 'Il ne te restait aucune action') + ' sur ' + A.budget + ', avec ' +
      (S.fausses ? pluriel(S.fausses, 'fausse* accusation*') : 'aucune fausse accusation') + '. Tu avais réuni ' + k + ' des ' + A.elements.length + ' pièces du dossier. Le strict nécessaire tenait en ' + A.utiles.length + ' actions.') + '</p>' +
      '<h4>Ce qui s’est passé</h4>' + recit(A).map(function (t) { return '<p>' + frappe(t) + '</p>'; }).join('') +
      '<h4>Ce qui permettait de conclure</h4>' + conclusions(A).map(function (b) {
        return '<h5>' + esc(b.titre) + '</h5><ul>' + b.lignes.map(function (t) { return '<li>' + frappe(t) + '</li>'; }).join('') + '</ul>';
      }).join('') +
      '<div class="gestes">' + bouton('hasard', 'Ouvrir une nouvelle affaire', '', 'acte') + '</div></section>';
  }

  function vueModal() {
    var p = gens(A, S.confronte), k = connus().filter(function (el) { return el.src !== 'dossier'; }), groupes = [], html = '';
    k.forEach(function (el) { if (groupes.indexOf(el.src) < 0) groupes.push(el.src); });
    groupes.forEach(function (src) {
      html += '<h3>' + esc(origine(src)) + '</h3>' + k.filter(function (el) { return el.src === src; }).map(function (el) {
        return '<button type="button" class="preuve" data-act="montrer" data-id="' + el.id + '">' + txt(el.texte) + '</button>';
      }).join('');
    });
    return '<div class="win" role="dialog" aria-modal="true" aria-labelledby="titreModal"><h2 id="titreModal">Confronter ' + esc(complet(p)) + '</h2>' +
      '<p class="mode">Choisis la pièce du dossier à lui mettre sous les yeux. Cela coûte une action.</p>' + html +
      '<div class="gestes">' + bouton('fermer', 'Annuler', '', 'relire') + '</div></div>';
  }

  // ---------- Affichage : rendu ----------
  var retour = null;   // suspect dont la confrontation était ouverte au rendu précédent

  function repere(el) {
    var d = el && el.dataset;
    if (!d || !d.act) return el && el.id ? '#' + el.id : '';
    return '[data-act="' + d.act + '"]' + (d.id ? '[data-id="' + d.id + '"]' : '') + (d.k ? '[data-k="' + d.k + '"]' : '') + (d.i ? '[data-i="' + d.i + '"]' : '');
  }
  function amener(sel, force) {
    var el = document.querySelector(sel), r, calme;
    if (!el || !el.getBoundingClientRect || !el.scrollIntoView) return;
    r = el.getBoundingClientRect();
    calme = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (force || r.top < 0 || r.top > window.innerHeight * 0.7) el.scrollIntoView({ block: 'start', behavior: calme ? 'auto' : 'smooth' });
  }

  function render() {
    var onglets = S.fini ? [['fin', 'Dénouement'], ['enquete', 'Enquête'], ['carnet', 'Carnet']] : [['enquete', 'Enquête'], ['carnet', 'Carnet'], ['accusation', 'Accusation']];
    var reste = Math.max(0, S.actions), m = Math.round((1 - reste / A.budget) * NUIT / 5) * 5;
    var actif = document.activeElement, sel = repere(actif), calepin = document.getElementById('calepin'), haut = calepin ? calepin.scrollTop : 0, cible = null;

    $('#affaire').textContent = 'Affaire ' + A.victime.nom;
    $('#lieu').textContent = cap(A.manoir) + ', nuit du ' + A.date;
    $('#horloge').textContent = horloge();
    $('#actions').textContent = reste ? pluriel(reste, 'action*') + ' sur ' + A.budget : 'L’aube se lève';
    $('#fausses').textContent = S.fausses ? pluriel(S.fausses, 'mandat* refusé*') : '';
    $('#aigH').style.transform = 'rotate(' + m / 2 + 'deg)';
    $('#aigM').style.transform = 'rotate(' + m * 6 + 'deg)';
    $('#onglets').innerHTML = onglets.map(function (o) {
      return '<button type="button" class="onglet o-' + o[0] + (S.onglet === o[0] ? ' on' : '') + '" data-act="onglet" data-id="' + o[0] + '"' + (S.onglet === o[0] ? ' aria-current="page"' : '') + '>' + o[1] + '</button>';
    }).join('');
    $('#screen').className = 'o-' + S.onglet;
    $('#screen').innerHTML = (S.alerte && !S.fini ? '<p class="alerte" role="alert">' + frappe(S.alerte) + '</p>' : '') +
      (S.onglet === 'fin' ? vueFin() : S.onglet === 'carnet' ? vueCarnet() : S.onglet === 'accusation' ? vueAccusation() : vueEnquete());
    $('#modal').hidden = !S.confronte;
    $('#modal').innerHTML = S.confronte ? vueModal() : '';

    // Le rendu remplace les boutons : on rend le clavier à celui qui vient de servir, ou à son voisin le plus utile.
    calepin = document.getElementById('calepin');
    if (calepin) calepin.scrollTop = haut;
    if (S.confronte && !retour) cible = $('#modal').querySelector('button');
    else if (!S.confronte && retour) cible = document.querySelector('[data-act="confronter"][data-id="' + retour + '"]') || document.getElementById('lecture');
    else if (sel && actif && actif.isConnected === false) cible = document.querySelector(sel) || document.getElementById('lecture');
    retour = S.confronte;
    if (cible && cible.focus) cible.focus({ preventScroll: true });
  }

  // ---------- Commandes ----------
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]'), id, act;
    if (!b) return;
    id = b.dataset.id;
    act = b.dataset.act;
    switch (act) {
      case 'onglet': S.onglet = id; break;
      case 'interroger': interroger(id); break;
      case 'fouiller': fouiller(id); break;
      case 'examiner': examiner(); break;
      case 'confronter': if (S.actions > 0 && !S.fini) S.confronte = id; break;
      case 'montrer': confronter(S.confronte, id); break;
      case 'fermer': S.confronte = null; break;
      case 'constat': S.dernier = null; break;
      case 'heure': S.heure = +b.dataset.i; break;
      case 'case': S.grille[b.dataset.k] = SUIVANT[S.grille[b.dataset.k] || '']; break;
      case 'vider': S.grille = {}; break;
      case 'choix': S.acc[b.dataset.k] = id; break;
      case 'accuser': accuser(); break;
      case 'renoncer': S.fini = { gagne: false }; S.onglet = 'fin'; break;
      case 'hasard': nouvelle('', $('#niveau').value); break;
      case 'aller': amener('#' + id, true); return;
    }
    render();
    if (/^(interroger|fouiller|examiner|montrer|constat)$/.test(act)) amener(document.getElementById('lecture') ? '#lecture' : '#screen');
    else if (/^(onglet|accuser|renoncer|hasard)$/.test(act)) amener('#screen');
  });

  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'notes') S.notes = ev.target.value;
  });

  document.addEventListener('keydown', function (ev) {
    var boutons, premier, dernier;
    if (!S.confronte) return;
    if (ev.key === 'Escape') { S.confronte = null; render(); return; }
    if (ev.key !== 'Tab') return;
    // Le clavier ne sort pas de la confrontation tant qu'elle est ouverte.
    boutons = $('#modal').querySelectorAll('button');
    premier = boutons[0];
    dernier = boutons[boutons.length - 1];
    if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
    else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
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
