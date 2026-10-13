(function () {
  'use strict';

  var racine = typeof window !== 'undefined' ? window : globalThis;
  var P = racine.Palettes;

  var HIST_MAX = 200;                     // profondeur de l'historique
  var ONGLETS = ['extraire', 'construire', 'verifier', 'bibliotheque', 'fichiers'];

  // Les réglages : [clé dans l'adresse, défaut, minimum, maximum] ou [clé, défaut, valeurs permises].
  var REGLAGES = {
    n: ['k', 16, 2, 64],
    methode: ['m', 'kmoy', P.METHODES.map(function (m) { return m.id; })],
    equilibre: ['e', 60, 0, 100],
    trame: ['t', 'aucune', ['aucune', 'ordonnee', 'diffusion']],
    force: ['f', 50, 0, 100],
    seuil: ['s', 4, 1, 20],
    ratio: ['c', 4.5, [3, 4.5, 7]],
    vision: ['vi', 'normale', P.VISIONS.map(function (v) { return v.id; })],
    fond: ['fd', 1, 0, 3],
    onglet: ['o', 'extraire', ONGLETS]
  };

  // E : la palette en cours. sel et sel2 : la couleur choisie et celle qu'on lui compare (-1 : aucune).
  P.E = { nom: '', couleurs: [], verrous: [], sel: 0, sel2: -1 };
  P.R = {};
  P.surChange = null;       // appelé après chaque opération validée, annulée ou rétablie

  function defauts() {
    var r = {}, k;
    for (k in REGLAGES) r[k] = REGLAGES[k][1];
    return r;
  }
  function regler(r, k, v) {
    var d = REGLAGES[k];
    if (Array.isArray(d[2])) {
      if (typeof d[1] === 'number') v = Number(v);
      if (d[2].indexOf(v) >= 0) r[k] = v;
    } else if (v !== '' && v !== null && isFinite(v)) r[k] = P.borne(Math.round(Number(v)), d[2], d[3]);
  }
  P.R = defauts();
  P.regler = function (k, v) { regler(P.R, k, v); };

  // ---------- Palette ----------
  function ranger() {
    var E = P.E, n;
    E.couleurs = E.couleurs.slice(0, P.COULEURS_MAX);
    n = E.couleurs.length;
    E.verrous = E.couleurs.map(function (c, i) { return !!E.verrous[i]; });
    E.sel = n ? P.borne(Math.round(E.sel) || 0, 0, n - 1) : 0;
    if (!(E.sel2 >= 0 && E.sel2 < n) || E.sel2 === E.sel) E.sel2 = -1;
  }

  // Remplace toute la palette. verrous est facultatif.
  P.remplacer = function (couleurs, verrous, nom) {
    var E = P.E;
    E.couleurs = couleurs.map(P.hexPropre).filter(function (h) { return h; });
    E.verrous = verrous ? verrous.slice() : [];
    if (nom !== undefined) E.nom = P.nomPropre(nom);
    E.sel2 = -1;
    ranger();
  };

  P.ajouter = function (hex, apres) {
    var E = P.E, i = apres === undefined ? E.couleurs.length : apres + 1;
    if (E.couleurs.length >= P.COULEURS_MAX) return false;
    E.couleurs.splice(i, 0, P.hexPropre(hex) || '808080');
    E.verrous.splice(i, 0, false);
    E.sel = i; E.sel2 = -1;
    ranger();
    return true;
  };

  P.retirer = function (i) {
    var E = P.E;
    if (E.couleurs.length < 2) return false;
    E.couleurs.splice(i, 1); E.verrous.splice(i, 1);
    if (E.sel > i || E.sel >= E.couleurs.length) E.sel--;
    E.sel2 = -1;
    ranger();
    return true;
  };

  P.deplacer = function (i, j) {
    var E = P.E, n = E.couleurs.length, choisie;
    j = P.borne(j, 0, n - 1);
    if (i === j || i < 0 || i >= n) return false;
    choisie = E.couleurs.map(function (c, k) { return k === E.sel ? 1 : k === E.sel2 ? 2 : 0; });
    [E.couleurs, E.verrous, choisie].forEach(function (t) { t.splice(j, 0, t.splice(i, 1)[0]); });
    E.sel = choisie.indexOf(1); E.sel2 = choisie.indexOf(2);
    ranger();
    return true;
  };

  // Range la palette selon une liste d'indices (le résultat d'un tri).
  P.ordonner = function (ordre) {
    var E = P.E, c = E.couleurs, v = E.verrous, s = E.sel, s2 = E.sel2;
    E.couleurs = ordre.map(function (i) { return c[i]; });
    E.verrous = ordre.map(function (i) { return v[i]; });
    E.sel = ordre.indexOf(s); E.sel2 = ordre.indexOf(s2);
    ranger();
  };

  // Fond la couleur j dans la couleur i : leur mélange prend la place de i, sauf si l'une est verrouillée.
  P.fusionner = function (i, j) {
    var E = P.E, a, b;
    if (i === j || !E.couleurs[i] || !E.couleurs[j]) return false;
    if (E.verrous[i] && E.verrous[j]) return false;
    a = P.hexVersRgb(E.couleurs[i]); b = P.hexVersRgb(E.couleurs[j]);
    if (E.verrous[j]) { E.couleurs[i] = E.couleurs[j]; E.verrous[i] = true; }
    else if (!E.verrous[i]) E.couleurs[i] = P.rgbVersHex(P.melange(a, b, 1, 1));
    E.couleurs.splice(j, 1); E.verrous.splice(j, 1);
    E.sel = j < i ? i - 1 : i; E.sel2 = -1;
    ranger();
    return true;
  };

  P.rgbPalette = function () { return P.E.couleurs.map(P.hexVersRgb); };

  // ---------- Historique ----------
  var hist = { pile: [], i: -1 };

  function instantane(cle) {
    var E = P.E;
    return { nom: E.nom, couleurs: E.couleurs.slice(), verrous: E.verrous.slice(), sel: E.sel, sel2: E.sel2, cle: cle || '' };
  }
  function reprendre(s) {
    P.E = { nom: s.nom, couleurs: s.couleurs.slice(), verrous: s.verrous.slice(), sel: s.sel, sel2: s.sel2 };
  }
  function signaler(nom) { if (P.surChange) P.surChange(nom); }

  P.histInit = function () { ranger(); hist.pile = [instantane()]; hist.i = 0; };

  // Avec une clé, les validations qui se suivent sous la même clé ne font qu'une étape (un curseur qu'on traîne).
  P.valider = function (nom, cle) {
    ranger();
    var haut = hist.pile[hist.i];
    if (cle && haut && haut.cle === cle && hist.i > 0) hist.pile[hist.i] = instantane(cle);
    else {
      hist.pile.length = hist.i + 1;
      hist.pile.push(instantane(cle));
      hist.i++;
      while (hist.pile.length > HIST_MAX) { hist.pile.shift(); hist.i--; }
    }
    signaler(nom);
  };
  // Ferme l'étape en cours : la prochaine validation en ouvrira une autre, même sous la même clé.
  P.clore = function () { if (hist.pile[hist.i]) hist.pile[hist.i].cle = ''; };
  // Le choix d'une couleur n'est pas une étape : il est reporté dans l'état du dessus.
  P.noterChoix = function () {
    ranger();
    if (hist.pile[hist.i]) { hist.pile[hist.i].sel = P.E.sel; hist.pile[hist.i].sel2 = P.E.sel2; }
  };
  P.annuler = function () {
    if (hist.i <= 0) return false;
    hist.pile[hist.i].cle = '';
    hist.i--;
    hist.pile[hist.i].cle = '';
    reprendre(hist.pile[hist.i]);
    signaler('Annuler');
    return true;
  };
  P.retablir = function () {
    if (hist.i >= hist.pile.length - 1) return false;
    hist.i++;
    hist.pile[hist.i].cle = '';
    reprendre(hist.pile[hist.i]);
    signaler('Rétablir');
    return true;
  };
  P.histEtat = function () { return { avant: hist.i, apres: hist.pile.length - 1 - hist.i }; };

  // ---------- Adresse ----------
  // La palette et les réglages qui diffèrent du défaut, en un fragment d'adresse à partager.
  P.versAdresse = function () {
    var E = P.E, d = defauts(), t = ['p=' + E.couleurs.join('.')], v = [], k;
    E.verrous.forEach(function (x, i) { if (x) v.push(i); });
    if (v.length) t.push('v=' + v.join('.'));
    if (E.nom) t.push('n=' + encodeURIComponent(E.nom));
    for (k in REGLAGES) if (P.R[k] !== d[k]) t.push(REGLAGES[k][0] + '=' + P.R[k]);
    return '#' + t.join('&');
  };

  // Rend faux si le texte ne porte pas de palette ; l'état n'est alors pas touché.
  P.depuisAdresse = function (s) {
    var o = {}, r = defauts(), couleurs, verrous = [], k;
    String(s || '').replace(/^#/, '').split('&').forEach(function (bout) {
      var q = bout.indexOf('=');
      if (q > 0) o[bout.slice(0, q)] = bout.slice(q + 1);
    });
    couleurs = (o.p || '').split('.').map(P.hexPropre).filter(function (h) { return h; });
    if (!couleurs.length) return false;
    (o.v || '').split('.').forEach(function (x) { if (/^\d+$/.test(x)) verrous[Number(x)] = true; });
    for (k in REGLAGES) if (o[REGLAGES[k][0]] !== undefined) regler(r, k, o[REGLAGES[k][0]]);
    P.R = r;
    try { o.n = decodeURIComponent(o.n || ''); } catch (e) { o.n = ''; }
    P.remplacer(couleurs, verrous, o.n);
    P.E.sel = 0;
    return true;
  };
})();
