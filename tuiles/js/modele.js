(function () {
  'use strict';

  var racine = typeof window !== 'undefined' ? window : globalThis;

  var CARTE_MAX = 512;                    // côté maximal d'une carte, en cases
  var TAILLES_TUILE = [8, 16, 32];
  var HIST_MAX = 500;                     // profondeur de l'historique
  var HIST_OCTETS = 96 * 1024 * 1024;     // plafond mémoire des étapes retenues
  var NOM_MAX = 40;

  // Une case de calque de tuiles est un entier : numéro global de la tuile (0 = vide) et trois
  // drapeaux d'orientation, rangés comme dans Tiled.
  var RET_H = 0x80000000, RET_V = 0x40000000, RET_D = 0x20000000, NUMERO = 0x1fffffff;

  // Valeurs d'une case du calque de collisions.
  var COLLISIONS = [
    { v: 0, id: 'vide', nom: 'Vide' },
    { v: 1, id: 'plein', nom: 'Plein' },
    { v: 2, id: 'plateforme', nom: 'Plateforme traversable' },
    { v: 3, id: 'pente-montante', nom: 'Pente montante' },
    { v: 4, id: 'pente-descendante', nom: 'Pente descendante' }
  ];

  var M = racine.Tuiles = {
    CARTE_MAX: CARTE_MAX, TAILLES_TUILE: TAILLES_TUILE, COLLISIONS: COLLISIONS,
    RET_H: RET_H, RET_V: RET_V, RET_D: RET_D, NUMERO: NUMERO,
    carte: null,
    sel: null,            // sélection rectangulaire { x, y, w, h }, en cases
    surChange: null,      // appelé après chaque étape validée, annulée ou rétablie
    surCase: null,        // appelé pour chaque case modifiée : (calque, x, y)
    surStructure: null    // appelé quand la carte entière est remplacée
  };

  function borne(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dim(v) { return borne(Math.round(Number(v)) || 1, 1, CARTE_MAX); }
  function nomPropre(s, defaut) { return String(s === undefined || s === null ? '' : s).trim().slice(0, NOM_MAX) || defaut; }
  M.borne = borne;
  M.nomPropre = nomPropre;

  // ---------- Carte ----------
  // calques[0] est le calque du dessous. Trois types : 'tuiles' (cases en Uint32Array),
  // 'collisions' (cases en Uint8Array) et 'objets' (liste d'objets). Un seul calque de chacun des deux derniers.
  function nid() { return M.carte.idSuivant++; }

  function creerCalque(type, nom) {
    var c = M.carte, cal = { id: nid(), nom: nom, type: type, visible: true, opacite: 1, verrou: false };
    if (type === 'tuiles') cal.cases = new Uint32Array(c.w * c.h);
    else if (type === 'collisions') cal.cases = new Uint8Array(c.w * c.h);
    else cal.objets = [];
    return cal;
  }

  M.nouvelle = function (o) {
    o = o || {};
    M.carte = {
      nom: nomPropre(o.nom, 'carte'), w: dim(o.w || 40), h: dim(o.h || 30),
      tc: TAILLES_TUILE.indexOf(Number(o.tc)) >= 0 ? Number(o.tc) : 16,
      mode: o.mode === 'plateformes' ? 'plateformes' : 'dessus', fond: '',
      calques: [], jeux: [], iCalque: 0, idSuivant: 1, premierLibre: 1
    };
    M.carte.calques = [creerCalque('tuiles', 'Sol'), creerCalque('tuiles', 'Décor'), creerCalque('objets', 'Objets'), creerCalque('collisions', 'Collisions')];
    M.sel = null;
    histInit();
    if (M.surStructure) M.surStructure();
    signaler('Nouvelle carte');
  };

  // Met en place une carte déjà construite (ouverture d'un projet).
  M.installer = function (carte) {
    M.carte = carte;
    M.sel = null;
    histInit();
    if (M.surStructure) M.surStructure();
    signaler('Ouvrir');
  };

  M.calqueActif = function () { return M.carte.calques[M.carte.iCalque]; };
  M.calqueDeType = function (type) {
    var k, cs = M.carte.calques;
    for (k = 0; k < cs.length; k++) if (cs[k].type === type) return cs[k];
    return null;
  };
  M.calqueLibre = function () {
    var c = M.calqueActif();
    if (c.verrou) return 'Le calque « ' + c.nom + ' » est verrouillé.';
    if (!c.visible) return 'Le calque « ' + c.nom + ' » est masqué.';
    return '';
  };

  // Le jeu qui contient la tuile de numéro global g, ou null.
  M.jeuDe = function (g) {
    var js = M.carte.jeux, k;
    for (k = js.length - 1; k >= 0; k--) if (g >= js[k].premier) return g < js[k].premier + js[k].nb ? js[k] : null;
    return null;
  };
  M.jeuParId = function (id) {
    var js = M.carte.jeux, k;
    for (k = 0; k < js.length; k++) if (js[k].id === id) return js[k];
    return null;
  };

  // ---------- Historique ----------
  // Une étape retient les seules cases changées (indice, valeur d'avant, valeur d'après) et, quand la
  // structure a bougé (calques, taille, objets, jeux), deux photos légères qui partagent les tampons de cases.
  // Les tampons ne sont modifiés que par poser() : une photo retrouve donc toujours son contenu quand
  // l'historique revient à elle.
  var hist = { pile: [], i: 0, octets: 0 };
  var attente = new Map();      // tampon → Map(indice → valeur d'avant), pour l'opération en cours
  var structSale = false, repere = null;

  function copieObjet(o) {
    return { id: o.id, nom: o.nom, type: o.type, x: o.x, y: o.y, w: o.w, h: o.h, props: o.props.map(function (p) { return [p[0], p[1]]; }) };
  }
  function copieCalque(c) {
    var o = { id: c.id, nom: c.nom, type: c.type, visible: c.visible, opacite: c.opacite, verrou: c.verrou };
    if (c.cases) o.cases = c.cases; else o.objets = c.objets.map(copieObjet);
    return o;
  }
  function photo() {
    var c = M.carte;
    return { nom: c.nom, w: c.w, h: c.h, tc: c.tc, mode: c.mode, fond: c.fond, iCalque: c.iCalque, idSuivant: c.idSuivant, premierLibre: c.premierLibre, jeux: c.jeux.slice(), calques: c.calques.map(copieCalque) };
  }
  function restaurer(p) {
    M.carte = { nom: p.nom, w: p.w, h: p.h, tc: p.tc, mode: p.mode, fond: p.fond, iCalque: p.iCalque, idSuivant: p.idSuivant, premierLibre: p.premierLibre, jeux: p.jeux.slice(), calques: p.calques.map(copieCalque) };
    bornerSel();
    if (M.surStructure) M.surStructure();
  }
  function bornerSel() {
    var s = M.sel, c = M.carte;
    if (s && (s.x + s.w > c.w || s.y + s.h > c.h)) M.sel = null;
  }

  // Octets des tampons qu'une photo est seule à retenir.
  function poids(avant, apres) {
    var vus = new Set(), n = 0;
    avant.calques.forEach(function (c) { if (c.cases) vus.add(c.cases); });
    apres.calques.forEach(function (c) { if (c.cases && !vus.has(c.cases)) n += c.cases.byteLength; });
    avant.jeux.forEach(function (j) { vus.add(j); });
    apres.jeux.forEach(function (j) { if (!vus.has(j) && j.pix) n += 256; });
    return n + 512;
  }

  function histInit() {
    hist.pile = []; hist.i = 0; hist.octets = 0;
    attente = new Map(); structSale = false;
    repere = photo();
  }

  function elaguer() {
    while (hist.pile.length > 1 && (hist.pile.length > HIST_MAX || hist.octets > HIST_OCTETS)) {
      hist.octets -= hist.pile.shift().octets;
      hist.i--;
    }
  }

  function signaler(nom) { if (M.surChange) M.surChange(nom); }

  function calqueDuTampon(t) {
    var cs = M.carte.calques, k;
    for (k = 0; k < cs.length; k++) if (cs[k].cases === t) return cs[k];
    return null;
  }

  // Écrit les valeurs d'une liste de rustines. avecSignal : prévenir la vue case par case.
  function appliquer(rustines, cle, avecSignal) {
    var w = M.carte.w;
    rustines.forEach(function (r) {
      var t = r.t, idx = r.idx, val = r[cle], k, cal = avecSignal && M.surCase ? calqueDuTampon(t) : null;
      for (k = 0; k < idx.length; k++) t[idx[k]] = val[k];
      if (cal) for (k = 0; k < idx.length; k++) M.surCase(cal, idx[k] % w, Math.floor(idx[k] / w));
    });
  }

  M.toucher = function () { structSale = true; };
  M.enCours = function () { return structSale || attente.size > 0; };

  M.valider = function (nom) {
    var rustines = [], octets = 0, e;
    attente.forEach(function (m, t) {
      var n = 0, k = 0, idx, av, ap;
      m.forEach(function (v, i) { if (t[i] !== v) n++; });
      if (!n) return;
      idx = new Int32Array(n); av = new t.constructor(n); ap = new t.constructor(n);
      m.forEach(function (v, i) { if (t[i] !== v) { idx[k] = i; av[k] = v; ap[k] = t[i]; k++; } });
      rustines.push({ t: t, idx: idx, av: av, ap: ap });
      octets += idx.byteLength + av.byteLength + ap.byteLength;
    });
    attente = new Map();
    e = { nom: nom, rustines: rustines, avant: null, apres: null, octets: octets + 64 };
    if (structSale) {
      structSale = false;
      e.avant = repere;
      e.apres = repere = photo();
      e.octets += poids(e.avant, e.apres);
    }
    if (!rustines.length && !e.avant) return false;
    while (hist.pile.length > hist.i) hist.octets -= hist.pile.pop().octets;
    hist.pile.push(e);
    hist.i++;
    hist.octets += e.octets;
    elaguer();
    signaler(nom);
    return true;
  };

  // Abandonne ce qui n'a pas été validé.
  M.revenir = function () {
    var w = M.carte.w;
    attente.forEach(function (m, t) {
      var cal = !structSale && M.surCase ? calqueDuTampon(t) : null;
      m.forEach(function (v, i) {
        if (t[i] === v) return;
        t[i] = v;
        if (cal) M.surCase(cal, i % w, Math.floor(i / w));
      });
    });
    attente = new Map();
    if (structSale) { structSale = false; restaurer(repere); }
  };

  M.annuler = function () {
    var e;
    if (M.enCours()) M.revenir();
    if (!hist.i) return false;
    e = hist.pile[--hist.i];
    appliquer(e.rustines, 'av', !e.avant);
    if (e.avant) { repere = e.avant; restaurer(e.avant); }
    signaler('Annuler');
    return e.nom;
  };
  M.retablir = function () {
    var e;
    if (M.enCours()) M.revenir();
    if (hist.i >= hist.pile.length) return false;
    e = hist.pile[hist.i++];
    if (e.apres) { repere = e.apres; restaurer(e.apres); }
    appliquer(e.rustines, 'ap', !e.apres);
    signaler('Rétablir');
    return e.nom;
  };
  M.histEtat = function () { return { avant: hist.i, apres: hist.pile.length - hist.i, octets: hist.octets }; };

  // Changer de calque n'est pas une étape : la position est reportée dans la photo courante.
  M.allerCalque = function (i) {
    i = borne(i, 0, M.carte.calques.length - 1);
    M.carte.iCalque = i;
    repere.iCalque = i;
  };

  // ---------- Cases ----------
  M.poser = function (cal, x, y, v) {
    var c = M.carte, t = cal.cases, i, m;
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) return false;
    i = y * c.w + x;
    v = v >>> 0;
    if (t[i] === v) return false;
    m = attente.get(t);
    if (!m) attente.set(t, m = new Map());
    if (!m.has(i)) m.set(i, t[i]);
    t[i] = v;
    if (M.surCase) M.surCase(cal, x, y);
    return true;
  };

  M.lire = function (cal, x, y) {
    var c = M.carte;
    return x < 0 || y < 0 || x >= c.w || y >= c.h ? 0 : cal.cases[y * c.w + x];
  };

  // Un bloc : { w, h, cases, type }. Les cases vides d'un bloc de tuiles ne recouvrent rien, sauf avec tout.
  M.bloc = function (w, h, cases, type) { return { w: w, h: h, cases: cases || new Uint32Array(w * h), type: type || 'tuiles' }; };
  M.blocUn = function (v, type) { return M.bloc(1, 1, new Uint32Array([v >>> 0]), type); };

  M.extraire = function (cal, x, y, w, h) {
    var b = M.bloc(w, h, null, cal.type), i, j;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) b.cases[j * w + i] = M.lire(cal, x + i, y + j);
    return b;
  };

  M.poserBloc = function (cal, x, y, b, tout) {
    var i, j, v, n = 0;
    for (j = 0; j < b.h; j++) {
      for (i = 0; i < b.w; i++) {
        v = b.cases[j * b.w + i];
        if ((v || tout) && M.poser(cal, x + i, y + j, v)) n++;
      }
    }
    return n;
  };

  // Source qui répète un bloc à partir de (ox, oy) : sert au pot, au rectangle et à la ligne.
  M.motif = function (b, ox, oy) {
    return function (x, y) {
      var i = ((x - ox) % b.w + b.w) % b.w, j = ((y - oy) % b.h + b.h) % b.h;
      return b.cases[j * b.w + i];
    };
  };

  M.effacer = function (cal, x, y, w, h) {
    var i, j, n = 0;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) if (M.poser(cal, x + i, y + j, 0)) n++;
    return n;
  };

  M.rectangle = function (cal, x0, y0, x1, y1, f, plein) {
    var xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1), x, y, n = 0;
    for (y = ya; y <= yb; y++) {
      for (x = xa; x <= xb; x++) {
        if (!plein && x !== xa && x !== xb && y !== ya && y !== yb) continue;
        if (M.poser(cal, x, y, f(x, y))) n++;
      }
    }
    return n;
  };

  M.ligne = function (x0, y0, x1, y1, f) {
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, e2;
    for (;;) {
      f(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };

  // Les cases de même valeur que (x, y) : la zone qui la touche (contigu) ou toutes celles de la carte.
  M.zone = function (cal, x, y, contigu) {
    var c = M.carte, w = c.w, h = c.h, t = cal.cases, n = w * h, cible, pile, vu, k = 0, i, px, out, nb = 0;
    if (x < 0 || y < 0 || x >= w || y >= h) return new Int32Array(0);
    cible = t[y * w + x];
    out = new Int32Array(n);
    if (!contigu) {
      for (i = 0; i < n; i++) if (t[i] === cible) out[nb++] = i;
      return out.subarray(0, nb);
    }
    pile = new Int32Array(n); vu = new Uint8Array(n);
    pile[k++] = y * w + x; vu[y * w + x] = 1;
    while (k) {
      i = pile[--k]; out[nb++] = i; px = i % w;
      if (px > 0 && !vu[i - 1] && t[i - 1] === cible) { vu[i - 1] = 1; pile[k++] = i - 1; }
      if (px < w - 1 && !vu[i + 1] && t[i + 1] === cible) { vu[i + 1] = 1; pile[k++] = i + 1; }
      if (i >= w && !vu[i - w] && t[i - w] === cible) { vu[i - w] = 1; pile[k++] = i - w; }
      if (i < n - w && !vu[i + w] && t[i + w] === cible) { vu[i + w] = 1; pile[k++] = i + w; }
    }
    return out.subarray(0, nb);
  };

  M.remplir = function (cal, x, y, f, contigu, limite) {
    var z = M.zone(cal, x, y, contigu), w = M.carte.w, k, i, n = 0, X, Y;
    for (k = 0; k < z.length; k++) {
      i = z[k]; X = i % w; Y = (i - X) / w;
      if (limite && (X < limite.x || Y < limite.y || X >= limite.x + limite.w || Y >= limite.y + limite.h)) continue;
      if (M.poser(cal, X, Y, f(X, Y))) n++;
    }
    return n;
  };

  // Déplace (ou copie) le contenu d'un rectangle. Les cases vides déplacées ne recouvrent rien.
  M.deplacerZone = function (cal, r, dx, dy, copie) {
    var b = M.extraire(cal, r.x, r.y, r.w, r.h);
    if (!copie) M.effacer(cal, r.x, r.y, r.w, r.h);
    M.poserBloc(cal, r.x + dx, r.y + dy, b, false);
  };

  // ---------- Orientation ----------
  function retournerCase(v, axe) { return v & NUMERO ? (v ^ (axe === 'h' ? RET_H : RET_V)) >>> 0 : v; }
  function pivoterCase(v, sens) {
    var h = v & RET_H ? 1 : 0, vv = v & RET_V ? 1 : 0, d = v & RET_D ? 1 : 0, nh, nv;
    if (!(v & NUMERO)) return v;
    if (sens > 0) { nh = vv ^ 1; nv = h; } else { nh = vv; nv = h ^ 1; }
    return ((v & NUMERO) | (nh ? RET_H : 0) | (nv ? RET_V : 0) | (d ? 0 : RET_D)) >>> 0;
  }
  M.retournerCase = retournerCase;
  M.pivoterCase = pivoterCase;

  M.blocRetourner = function (b, axe) {
    var o = M.bloc(b.w, b.h, null, b.type), x, y, v, col = b.type === 'collisions';
    for (y = 0; y < b.h; y++) {
      for (x = 0; x < b.w; x++) {
        v = axe === 'h' ? b.cases[y * b.w + (b.w - 1 - x)] : b.cases[(b.h - 1 - y) * b.w + x];
        o.cases[y * b.w + x] = col ? (axe === 'h' && v >= 3 ? 7 - v : v) : retournerCase(v, axe);
      }
    }
    return o;
  };
  M.blocPivoter = function (b, sens) {
    var o = M.bloc(b.h, b.w, null, b.type), x, y, v, col = b.type === 'collisions';
    for (y = 0; y < b.h; y++) {
      for (x = 0; x < b.w; x++) {
        v = b.cases[y * b.w + x];
        if (!col) v = pivoterCase(v, sens);
        if (sens > 0) o.cases[x * b.h + (b.h - 1 - y)] = v; else o.cases[(b.w - 1 - x) * b.h + y] = v;
      }
    }
    return o;
  };

  // ---------- Carte entière ----------
  // ax, ay : ancrage du contenu, 0 (début), 0.5 (centre) ou 1 (fin). Avec sansValider, l'étape d'historique est laissée à l'appelant.
  M.redimensionner = function (nw, nh, ax, ay, sansValider) {
    var c = M.carte, w = c.w, h = c.h, dx, dy;
    nw = dim(nw); nh = dim(nh);
    if (nw === w && nh === h) return false;
    dx = Math.round((nw - w) * ax); dy = Math.round((nh - h) * ay);
    c.calques.forEach(function (cal) {
      var o, x, y, X, Y;
      if (!cal.cases) {
        cal.objets.forEach(function (ob) { ob.x += dx * c.tc; ob.y += dy * c.tc; });
        return;
      }
      o = new cal.cases.constructor(nw * nh);
      for (y = 0; y < h; y++) {
        Y = y + dy;
        if (Y < 0 || Y >= nh) continue;
        for (x = 0; x < w; x++) {
          X = x + dx;
          if (X >= 0 && X < nw) o[Y * nw + X] = cal.cases[y * w + x];
        }
      }
      cal.cases = o;
    });
    c.w = nw; c.h = nh;
    M.sel = null;
    structSale = true;
    if (!sansValider) M.valider('Redimensionner la carte');
    return true;
  };

  // cle : nom, tc, mode ou fond. Avec sansValider, l'étape d'historique est laissée à l'appelant.
  M.carteRegler = function (cle, valeur, sansValider) {
    var c = M.carte, k;
    if (cle === 'nom') valeur = nomPropre(valeur, c.nom);
    if (cle === 'mode') valeur = valeur === 'plateformes' ? 'plateformes' : 'dessus';
    if (cle === 'tc') {
      valeur = Number(valeur);
      if (TAILLES_TUILE.indexOf(valeur) < 0) return false;
      k = valeur / c.tc;
      if (k !== 1) M.calqueDeType('objets').objets.forEach(function (o) { o.x = Math.round(o.x * k); o.y = Math.round(o.y * k); o.w = Math.round(o.w * k); o.h = Math.round(o.h * k); });
    }
    if (c[cle] === valeur) return false;
    c[cle] = valeur;
    structSale = true;
    if (!sansValider) M.valider('Carte : ' + cle);
    return true;
  };

  // ---------- Calques ----------
  M.calqueAjouter = function (nom) {
    var c = M.carte, n = c.calques.filter(function (k) { return k.type === 'tuiles'; }).length, i = c.iCalque;
    // Un nouveau calque de tuiles se glisse au-dessus du calque actif, mais sous les objets et les collisions s'ils sont au sommet.
    while (i >= 0 && c.calques[i].type !== 'tuiles') i--;
    c.calques.splice(i + 1, 0, creerCalque('tuiles', nomPropre(nom, 'Calque ' + (n + 1))));
    c.iCalque = i + 1;
    structSale = true;
    M.valider('Nouveau calque');
  };

  M.calqueSupprimer = function (i) {
    var c = M.carte, cal = c.calques[i];
    if (cal.type !== 'tuiles' || c.calques.filter(function (k) { return k.type === 'tuiles'; }).length < 2) return false;
    c.calques.splice(i, 1);
    if (c.iCalque > i || c.iCalque >= c.calques.length) c.iCalque--;
    structSale = true;
    M.valider('Supprimer le calque');
    return true;
  };

  M.calqueDupliquer = function (i) {
    var c = M.carte, src = c.calques[i], cal;
    if (src.type !== 'tuiles') return false;
    cal = creerCalque('tuiles', nomPropre(src.nom + ' copie', 'Calque'));
    cal.cases.set(src.cases);
    cal.visible = src.visible; cal.opacite = src.opacite;
    c.calques.splice(i + 1, 0, cal);
    c.iCalque = i + 1;
    structSale = true;
    M.valider('Dupliquer le calque');
    return true;
  };

  M.calqueDeplacer = function (i, j) {
    var c = M.carte, actif = c.calques[c.iCalque];
    j = borne(j, 0, c.calques.length - 1);
    if (i === j) return false;
    c.calques.splice(j, 0, c.calques.splice(i, 1)[0]);
    c.iCalque = c.calques.indexOf(actif);
    structSale = true;
    M.valider('Déplacer le calque');
    return true;
  };

  // cle : nom, visible, opacite ou verrou. Avec sansValider, l'étape d'historique est laissée à l'appelant.
  M.calqueRegler = function (i, cle, valeur, sansValider) {
    var cal = M.carte.calques[i];
    if (cle === 'opacite') valeur = borne(Number(valeur) || 0, 0, 1);
    if (cle === 'nom') valeur = nomPropre(valeur, cal.nom);
    if (cal[cle] === valeur) return false;
    cal[cle] = valeur;
    structSale = true;
    if (!sansValider) M.valider('Calque : ' + cle);
    return true;
  };

  // ---------- Objets ----------
  // Un objet : { id, nom, type, x, y, w, h, props }, en pixels de carte. Un point a w = h = 0.
  // props : liste de paires [clé, valeur]. L'étape d'historique est laissée à l'appelant.
  M.objetAjouter = function (o) {
    var ob = { id: nid(), nom: nomPropre(o.nom, ''), type: nomPropre(o.type, ''), x: Math.round(o.x), y: Math.round(o.y), w: Math.max(0, Math.round(o.w || 0)), h: Math.max(0, Math.round(o.h || 0)), props: (o.props || []).map(function (p) { return [String(p[0]), String(p[1])]; }) };
    M.calqueDeType('objets').objets.push(ob);
    structSale = true;
    return ob;
  };
  M.objet = function (id) {
    var l = M.calqueDeType('objets').objets, k;
    for (k = 0; k < l.length; k++) if (l[k].id === id) return l[k];
    return null;
  };
  M.objetModifier = function (id, champs) {
    var ob = M.objet(id), k;
    if (!ob) return false;
    for (k in champs) {
      if (k === 'props') ob.props = champs.props.map(function (p) { return [String(p[0]).slice(0, 60), String(p[1]).slice(0, 400)]; });
      else if (k === 'nom' || k === 'type') ob[k] = String(champs[k]).trim().slice(0, NOM_MAX);
      else if (k === 'x' || k === 'y') ob[k] = Math.round(champs[k]);
      else if (k === 'w' || k === 'h') ob[k] = Math.max(0, Math.round(champs[k]));
    }
    structSale = true;
    return true;
  };
  M.objetSupprimer = function (id) {
    var l = M.calqueDeType('objets').objets, k;
    for (k = 0; k < l.length; k++) if (l[k].id === id) { l.splice(k, 1); structSale = true; return true; }
    return false;
  };

  // ---------- Jeux de tuiles ----------
  // Un jeu garde pour toujours sa plage de numéros : supprimer un jeu ne renumérote pas les autres.
  M.jeuAjouter = function (j, sansValider) {
    var c = M.carte;
    j.id = nid();
    j.premier = c.premierLibre;
    c.premierLibre += j.nb;
    c.jeux.push(j);
    structSale = true;
    if (!sansValider) M.valider('Ajouter le jeu « ' + j.nom + ' »');
    return j;
  };

  M.jeuSupprimer = function (id) {
    var c = M.carte, j = M.jeuParId(id), a, b;
    if (!j) return false;
    a = j.premier; b = j.premier + j.nb;
    c.calques.forEach(function (cal) {
      var t = cal.cases, i, g;
      if (cal.type !== 'tuiles') return;
      for (i = 0; i < t.length; i++) {
        g = t[i] & NUMERO;
        if (g >= a && g < b) M.poser(cal, i % c.w, Math.floor(i / c.w), 0);
      }
    });
    c.jeux.splice(c.jeux.indexOf(j), 1);
    structSale = true;
    M.valider('Supprimer le jeu « ' + j.nom + ' »');
    return true;
  };

  // Un jeu ne se modifie pas en place : il est remplacé par une copie retouchée, pour que l'historique garde l'ancien.
  M.jeuRegler = function (id, champs) {
    var c = M.carte, j = M.jeuParId(id), n, k, pareil = true;
    if (!j) return false;
    for (k in champs) if (champs[k] !== j[k]) pareil = false;
    if (pareil) return false;
    n = {};
    for (k in j) n[k] = j[k];
    for (k in champs) n[k] = champs[k];
    n.id = j.id; n.premier = j.premier; n.nb = j.nb;
    c.jeux[c.jeux.indexOf(j)] = n;
    structSale = true;
    M.valider('Jeu « ' + n.nom + ' »');
    return n;
  };

  // Combien de cases de la carte emploient une tuile de ce jeu.
  M.jeuEmploi = function (id) {
    var j = M.jeuParId(id), n = 0;
    M.carte.calques.forEach(function (cal) {
      var t = cal.cases, i, g;
      if (cal.type !== 'tuiles') return;
      for (i = 0; i < t.length; i++) { g = t[i] & NUMERO; if (g >= j.premier && g < j.premier + j.nb) n++; }
    });
    return n;
  };
})();
