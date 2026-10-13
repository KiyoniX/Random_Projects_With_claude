(function () {
  'use strict';

  // L'outil s'appelle « Banc » dans le code : c'est le banc d'essai de l'artificier.
  // Le moteur, lui, s'appelle Particules (lecteur.js, chargé avant) : c'est le nom que les jeux emploient.
  var M = window.Particules;
  var B = window.Banc = window.Banc || {};
  var HIST_MAX = 200;
  var FORMAT_ATELIER = 'atelier-pixel';

  B.doc = null;          // l'effet en cours, toujours normalisé par le moteur
  B.ic = 0;              // la couche choisie
  B.rev = 0;             // augmente à chaque changement : sert à savoir si un calcul est encore bon
  B.surChange = null;

  // L'encodeur GIF est celui d'Atelier Pixel, chargé juste après : il s'accroche à cet objet.
  window.Atelier = window.Atelier || {};

  B.borne = function (v, min, max) { return v < min ? min : v > max ? max : v; };
  B.couche = function () { return B.doc.couches[B.ic]; };

  // ---------- Historique ----------
  // Un effet tient en quelques kilo-octets de JSON : chaque état est gardé tel quel.
  var passe = [], futur = [];
  function etat() { return JSON.stringify({ d: B.doc, ic: B.ic }); }
  function remettre(t) { var o = JSON.parse(t); B.doc = o.d; B.ic = B.borne(o.ic, 0, B.doc.couches.length - 1); }

  B.marquer = function () {
    var t = etat();
    if (passe.length && passe[passe.length - 1] === t) return;
    passe.push(t);
    if (passe.length > HIST_MAX) passe.shift();
    futur = [];
  };
  B.change = function () {
    B.doc = M.normaliser(B.doc);
    B.ic = B.borne(B.ic, 0, B.doc.couches.length - 1);
    B.rev++;
    if (B.surChange) B.surChange();
  };
  B.annuler = function () {
    if (!passe.length) return false;
    futur.push(etat()); remettre(passe.pop()); B.change();
    return true;
  };
  B.retablir = function () {
    if (!futur.length) return false;
    passe.push(etat()); remettre(futur.pop()); B.change();
    return true;
  };
  B.peutAnnuler = function () { return passe.length > 0; };
  B.peutRetablir = function () { return futur.length > 0; };
  function oublier() { passe = []; futur = []; }

  // ---------- Réglages ----------
  // Lit ou écrit un réglage par son chemin : 'debit', 'emetteur.x' pour la couche choisie, '@w' ou '@sol.y' pour l'effet.
  function cible(chemin) {
    var o = chemin[0] === '@' ? B.doc : B.couche(), l = chemin.replace(/^@/, '').split('.'), i;
    for (i = 0; i < l.length - 1; i++) o = o[l[i]];
    return { o: o, k: l[l.length - 1] };
  }
  B.lire = function (chemin) { var c = cible(chemin); return c.o[c.k]; };
  // Sans marquer : le geste en cours (glisser une réglette) a déjà retenu l'état d'avant.
  B.ecrire = function (chemin, v) { var c = cible(chemin); c.o[c.k] = v; };
  B.regler = function (chemin, v) {
    // Une valeur égale (une rampe retournée qui ne change pas, par exemple) ne fait pas d'étape d'annulation.
    if (JSON.stringify(B.lire(chemin)) === JSON.stringify(v)) return;
    B.marquer(); B.ecrire(chemin, v); B.change();
  };

  // ---------- Calcul ----------
  var cache = { rev: -1, plan: null }, images = { rev: -1, l: [] };
  B.plan = function () {
    if (cache.rev !== B.rev) { cache.plan = M.preparer(B.doc); cache.rev = B.rev; images = { rev: B.rev, l: [] }; }
    return cache.plan;
  };
  // L'image f au format du sprite, gardée tant que rien ne change.
  B.image = function (f) {
    var p = B.plan();
    f = ((f % p.n) + p.n) % p.n;
    return images.l[f] || (images.l[f] = M.image(p, f));
  };
  B.images = function () { var l = [], f, n = B.plan().n; for (f = 0; f < n; f++) l.push(B.image(f)); return l; };

  // Vrai si une salve vit plus longtemps que la boucle : la fin de l'animation la couperait.
  B.salveCoupee = function () {
    var d = B.doc, t = d.images / d.cadence;
    return d.couches.some(function (c) { return c.visible && c.salve > 0 && c.vie * (1 + c.vieVar) > t + 1e-6; });
  };

  // ---------- Couches ----------
  B.coucheAjouter = function (modele) {
    var d = B.doc, c;
    if (d.couches.length >= M.COUCHES_MAX) return false;
    c = JSON.parse(JSON.stringify(modele || {
      nom: 'Couche ' + (d.couches.length + 1), emetteur: { forme: 'point', x: Math.round(d.w / 2), y: Math.round(d.h * 0.7) },
      debit: 16, vie: 1, vieVar: 0.3, vitesse: 20, vitesseVar: 0.3, dispersion: 40, forme: 'carre', taille0: 2, taille1: 1,
      rampe: ['#ffffff', '#ffd84f', '#ff8a2e']
    }));
    if (modele) c.nom = (modele.nom + ' (copie)').slice(0, 40);
    B.marquer();
    d.couches.splice(B.ic + 1, 0, c);
    B.ic++;
    B.change();
    return true;
  };
  B.coucheSupprimer = function () {
    if (B.doc.couches.length < 2) return false;
    B.marquer(); B.doc.couches.splice(B.ic, 1); B.ic = Math.max(0, B.ic - 1); B.change();
    return true;
  };
  // sens 1 : vers le dessus (plus tard dans la liste, dessinée après).
  B.coucheEmpiler = function (sens) {
    var l = B.doc.couches, j = B.ic + sens, c;
    if (j < 0 || j >= l.length) return false;
    B.marquer(); c = l[B.ic]; l[B.ic] = l[j]; l[j] = c; B.ic = j; B.change();
    return true;
  };

  // ---------- Ouverture ----------
  B.ouvrirEffet = function (o, garderHistorique) {
    var e = M.normaliser(o);
    // Rouvrir l'effet déjà ouvert ne fait pas d'étape d'annulation.
    if (garderHistorique && JSON.stringify(e) === JSON.stringify(B.doc)) { B.ic = 0; B.change(); return; }
    if (garderHistorique) B.marquer(); else oublier();
    B.doc = e; B.ic = 0; B.change();
  };
  B.versJson = function () { return JSON.parse(JSON.stringify(B.doc)); };

  // ---------- Exports ----------
  B.planche = function (colonnes, n) {
    var d = B.doc, im = B.images().slice(0, n || d.images), nb = im.length, cols = B.borne(Math.round(colonnes) || nb, 1, nb), rangs = Math.ceil(nb / cols);
    var W = cols * d.w, o = new Uint32Array(W * rangs * d.h), i, y, ox, oy;
    for (i = 0; i < nb; i++) {
      ox = (i % cols) * d.w; oy = Math.floor(i / cols) * d.h;
      for (y = 0; y < d.h; y++) o.set(im[i].subarray(y * d.w, (y + 1) * d.w), (oy + y) * W + ox);
    }
    return { pix: o, w: W, h: rangs * d.h, n: nb, cols: cols, rangs: rangs };
  };

  B.agrandir = function (pix, w, h, k) {
    if (k === 1) return pix;
    var o = new Uint32Array(w * k * h * k), x, y, i, c, W = w * k;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) { c = pix[y * w + x]; if (c) for (i = 0; i < k; i++) o[y * k * W + x * k + i] = c; }
      for (i = 1; i < k; i++) o.copyWithin((y * k + i) * W, y * k * W, (y * k + 1) * W);
    }
    return o;
  };

  // Codage d'une image : plages [longueur, r, v, b, a] puis base64 (celui d'Atelier Pixel).
  function coder(buf) {
    var out = [], i = 0, n = buf.length, c, run, s = '', k;
    while (i < n) {
      c = buf[i]; run = 1;
      while (run < 255 && i + run < n && buf[i + run] === c) run++;
      out.push(run, c & 255, c >>> 8 & 255, c >>> 16 & 255, c >>> 24);
      i += run;
    }
    for (k = 0; k < out.length; k += 8000) s += String.fromCharCode.apply(null, out.slice(k, k + 8000));
    return btoa(s);
  }
  B.coder = coder;

  function hex(v) { return (v < 16 ? '0' : '') + v.toString(16); }
  B.hex = function (c) { return '#' + hex(c & 255) + hex(c >>> 8 & 255) + hex(c >>> 16 & 255); };

  // L'animation comme projet Atelier Pixel : une image par image, une seule couche, la palette de l'effet.
  B.versAtelier = function () {
    var d = B.doc, p = B.plan(), duree = Math.round(1000 / d.cadence);
    return {
      format: FORMAT_ATELIER, version: 1, w: d.w, h: d.h, iImage: 0, iCalque: 0,
      palette: p.palette.map(B.hex),
      calques: [{ id: 1, nom: d.nom, visible: true, opacite: 1, verrou: false }],
      images: B.images().map(function (pix) { return { duree: duree, cels: { 1: coder(pix) } }; })
    };
  };

  // Le fichier que charge un jeu après lecteur.js.
  // Les noms passent par M.ligne : un saut de ligne fermerait le commentaire et ferait du reste du code.
  B.versLecteur = function (nom) {
    var n = JSON.stringify(M.ligne(nom));
    return '// Effet « ' + M.ligne(B.doc.nom) + ' » fait avec Particules. À charger après particules/lecteur.js.\n' +
      '// Particules.jouer(' + n + ', canvas, { echelle: 3 }) ou Particules.simulation(' + n + ', { x: x, y: y })\n' +
      'Particules.ajouter(' + n + ', ' + JSON.stringify(B.doc) + ');\n';
  };
  // Relit un fichier pour le lecteur : l'objet est le second argument de Particules.ajouter.
  // Le premier est une chaîne JSON, sautée en entier : elle peut contenir une accolade.
  B.depuisLecteur = function (texte) {
    var m = /Particules\.ajouter\(\s*"(?:[^"\\]|\\.)*"\s*,\s*/.exec(texte), d, f;
    if (!m) return null;
    d = m.index + m[0].length; f = texte.lastIndexOf('}');
    return d > 0 && f > d ? JSON.parse(texte.slice(d, f + 1)) : null;
  };

  B.prereglage = function (id) {
    var l = B.PREREGLAGES, i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };
})();
