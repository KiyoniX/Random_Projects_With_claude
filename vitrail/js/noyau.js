(function () {
  'use strict';

  // L'état du vitrail, l'historique, les verres, et ce qui entre et sort en fichier.
  var V = window.Vitrail, G = V.geo, R = V.rendu;

  var FORMAT = 'vitrail';
  var HIST_MAX = 120;
  var VERRES_MAX = 40;
  var COTE_MIN = 100, COTE_MAX = 4000;   // un panneau fait entre 10 cm et 4 m de côté

  V.doc = null;
  V.calc = null;      // les pièces calculées : { faces, avertissements, aire, degres }
  V.rev = 0;          // augmente à chaque changement, pour les images gardées en cache
  V.surChange = null;
  V.COTE_MIN = COTE_MIN; V.COTE_MAX = COTE_MAX;
  V.PLOMBS = [4, 6, 8, 10];
  V.BORDURES = [8, 10, 12, 14, 16];
  V.GRILLES = [5, 10, 20, 50];

  // Les verres de l'atelier : couleur et texture. Les chiffres du clavier les prennent dans cet ordre.
  V.VERRES = [
    ['Rouge rubis', '#a3162a', 'antique'], ['Bleu de Chartres', '#1f3d96', 'antique'], ['Bleu ciel', '#6fa6d6', 'cathedrale'],
    ['Jaune d\'argent', '#e4a82a', 'cathedrale'], ['Vert bouteille', '#2e7a3c', 'antique'], ['Pourpre', '#6a2b6c', 'antique'],
    ['Opale blanche', '#ede6d4', 'opalescent'], ['Clair martelé', '#e6ece6', 'martele'], ['Paille chenillé', '#d8c27e', 'chenille'],
    ['Vert d\'eau', '#93c4ad', 'cathedrale']
  ];

  function verresDefaut() { return V.VERRES.map(function (v, i) { return { id: i + 1, nom: v[0], couleur: v[1], texture: v[2] }; }); }

  V.fr = function (v, dec) { return (dec === undefined ? String(v) : v.toFixed(dec)).replace('.', ','); };
  function borne(v, a, b) { return v < a ? a : v > b ? b : v; }
  V.borne = borne;

  V.docNeuf = function (forme) {
    var d = {
      nom: 'vitrail', forme: forme || { type: 'lancette', l: 500, h: 1200, lobes: 8, libre: null },
      plomb: 6, bordure: 12, grille: 10, aimant: true, regles: JSON.parse(JSON.stringify(G.REGLES)),
      noeuds: {}, plombs: [], suivant: 1, verres: verresDefaut(), pieces: [], grisaille: []
    };
    G.bordure(d);
    return d;
  };

  V.verre = function (id) {
    var l = V.doc.verres, i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };
  V.verreSuivant = function () { return V.doc.verres.reduce(function (m, v) { return Math.max(m, v.id); }, 0) + 1; };

  // ---------- Historique ----------
  var passe = [], futur = [], futurAvant = [];
  V.marquer = function () {
    passe.push(JSON.stringify(V.doc));
    if (passe.length > HIST_MAX) passe.shift();
    futurAvant = futur; futur = [];
  };
  // Oublie le dernier état retenu, quand l'opération n'a finalement rien changé.
  V.annulerMarque = function () {
    if (!passe.length) return;
    V.doc = JSON.parse(passe.pop());
    futur = futurAvant;
    V.change(false);
  };
  // Les réglages de l'établi (plomb des prochains tracés, grille, aimant) ne font pas partie de l'histoire : ils restent.
  function garderReglages(neuf, ancien) { neuf.plomb = ancien.plomb; neuf.grille = ancien.grille; neuf.aimant = ancien.aimant; return neuf; }
  V.annuler = function () {
    if (!passe.length) return false;
    futur.push(JSON.stringify(V.doc)); V.doc = garderReglages(JSON.parse(passe.pop()), V.doc); V.change(false);
    return true;
  };
  V.retablir = function () {
    if (!futur.length) return false;
    passe.push(JSON.stringify(V.doc)); V.doc = garderReglages(JSON.parse(futur.pop()), V.doc); V.change(false);
    return true;
  };
  V.peutAnnuler = function () { return passe.length > 0; };
  V.peutRetablir = function () { return futur.length > 0; };
  V.oublier = function () { passe = []; futur = []; };

  // ---------- Pièces et verres ----------
  // Une graine tirée de la place de la pièce : deux pièces du même verre ne montrent pas le même morceau de feuille.
  function graineDe(p) {
    var h = Math.imul(Math.round(p.x * 100) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(p.y * 100) + 0x27d4eb2f, 0xc2b2ae35);
    h ^= h >>> 13; h = Math.imul(h, 0x165667b1); h ^= h >>> 16;
    return (h >>> 0) % 99991 + 1;
  }

  // Chaque pièce garde son verre par un point posé à l'intérieur (doc.pieces). Après une retouche, une pièce sans
  // point reprend le verre de la pièce d'avant qui la contenait : couper une pièce en deux laisse les deux moitiés vitrées.
  function affecter(anciennes, herite, garder) {
    var faces = V.calc.faces, pts = V.doc.pieces.slice(), ids = {};
    V.doc.verres.forEach(function (v) { ids[v.id] = true; });
    faces.forEach(function (f) {
      var i, p = null, o;
      f.verre = 0; f.graine = 0;
      for (i = 0; i < pts.length; i++) if (pts[i] && G.dansFace(f, pts[i])) { p = pts[i]; pts[i] = null; break; }
      if (!p && herite && anciennes) {
        for (i = 0; i < anciennes.length; i++) {
          o = anciennes[i];
          if (o.verre && G.dansFace(o, f.centre)) { p = { verre: o.verre, graine: graineDe(f.centre) }; break; }
        }
      }
      if (p && ids[p.verre]) { f.verre = p.verre; f.graine = p.graine || graineDe(f.centre); }
    });
    if (!garder) V.doc.pieces = faces.filter(function (f) { return f.verre; }).map(function (f) { return { x: f.centre.x, y: f.centre.y, verre: f.verre, graine: f.graine }; });
  }

  // herite : la retouche vient d'un geste sur le réseau (les pièces nées d'une coupe gardent leur verre).
  V.change = function (herite) {
    var anciennes = V.calc ? V.calc.faces : null;
    V.calc = G.analyser(V.doc);
    affecter(anciennes, herite);
    V.rev++;
    if (V.surChange) V.surChange();
  };
  // Pendant un geste : les pièces se recalculent pour l'œil, sans toucher aux verres enregistrés.
  V.apercu = function () {
    V.calc = G.analyser(V.doc);
    affecter(null, false, true);
    V.rev++;
  };

  V.pieceEn = function (p) {
    var l = V.calc.faces, i;
    for (i = 0; i < l.length; i++) if (G.dansFace(l[i], p)) return l[i];
    return null;
  };
  V.pieceNumero = function (n) { return V.calc.faces[n - 1] || null; };

  // Pose un verre dans une pièce (0 : la vide).
  V.vitrer = function (f, idVerre) {
    V.doc.pieces = V.doc.pieces.filter(function (p) { return !G.dansFace(f, p); });
    if (idVerre) V.doc.pieces.push({ x: f.centre.x, y: f.centre.y, verre: idVerre, graine: f.graine || graineDe(f.centre) });
  };

  // ---------- Couleurs ----------
  function hsl(hex) {
    var c = R.rgb(hex), r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }
  V.hsl = hsl;

  // Un nom de verre tiré de sa couleur, comme on les nomme à l'atelier.
  V.nomTeinte = function (hex) {
    var c = hsl(hex), h = c.h, n;
    if (c.s < 0.14 || (c.l > 0.9 && c.s < 0.4)) n = c.l > 0.86 ? 'Blanc' : c.l > 0.6 ? 'Gris perle' : c.l > 0.28 ? 'Gris' : 'Noir de fumée';
    else if (h < 12 || h >= 345) n = 'Rouge';
    else if (h < 36) n = 'Orangé';
    else if (h < 50) n = 'Ambre';
    else if (h < 68) n = 'Jaune';
    else if (h < 95) n = 'Vert anis';
    else if (h < 160) n = 'Vert';
    else if (h < 190) n = 'Vert d\'eau';
    else if (h < 215) n = c.l > 0.55 ? 'Bleu ciel' : 'Bleu paon';
    else if (h < 252) n = c.l < 0.3 ? 'Bleu de nuit' : 'Bleu';
    else if (h < 290) n = 'Violet';
    else if (h < 330) n = 'Pourpre';
    else n = 'Rose';
    if (c.s >= 0.14 && c.l > 0.78) n += ' pâle';
    else if (c.s >= 0.14 && c.l < 0.22 && n !== 'Bleu de nuit') n += ' sombre';
    return n;
  };
  V.textureDe = function (hex, i) {
    var c = hsl(hex);
    if (c.l > 0.82 && c.s < 0.25) return 'clair';
    if (c.l > 0.74) return 'opalescent';
    if (c.s < 0.22) return 'martele';
    return ['antique', 'cathedrale', 'antique', 'chenille'][i % 4];
  };
  function nomLibre(nom, pris) {
    var n = 2;
    if (!pris[nom]) { pris[nom] = true; return nom; }
    while (pris[nom + ' ' + n]) n++;
    pris[nom + ' ' + n] = true;
    return nom + ' ' + n;
  }

  // Lit une palette du site (format « palette »), ou toute liste de codes #rrggbb.
  V.lirePalette = function (texte) {
    var o = null, liste, nom = '', vus = {}, out = [];
    try { o = JSON.parse(texte); } catch (e) { o = null; }
    if (o && o.format === FORMAT) throw new Error('Ce fichier est un projet Vitrail, pas une palette.');
    if (o && typeof o === 'object') { liste = Array.isArray(o) ? o : o.couleurs || o.colors || o.palette; nom = Array.isArray(o) ? '' : String(o.nom || o.name || ''); }
    else {
      liste = String(texte).match(/#[0-9a-f]{6}\b/gi);
      // La liste .hex de Palettes écrit ses codes sans « # », un par ligne.
      if (!liste) { liste = String(texte).split(/\r?\n/).filter(function (l) { return /^\s*[0-9a-f]{6}(?:[0-9a-f]{2})?\s*$/i.test(l); }); if (!liste.length) liste = null; }
    }
    if (!Array.isArray(liste)) throw new Error('Aucune liste de couleurs dans ce fichier.');
    liste.forEach(function (c) {
      var m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(typeof c === 'string' ? c.trim() : '');
      if (!m) return;
      c = '#' + m[1].toLowerCase();
      if (!vus[c] && out.length < VERRES_MAX) { vus[c] = true; out.push(c); }
    });
    if (!out.length) throw new Error('Aucune couleur lisible dans ce fichier.');
    return { nom: nom.slice(0, 40), couleurs: out };
  };

  function ecart(a, b) {
    var p = R.rgb(a), q = R.rgb(b), rm = (p[0] + q[0]) / 2, dr = p[0] - q[0], dg = p[1] - q[1], db = p[2] - q[2];
    return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
  }

  // Les verres pris d'une palette. garder : ils s'ajoutent ; sinon ils remplacent l'atelier, et chaque pièce
  // prend le nouveau verre le plus proche de l'ancien.
  V.appliquerPalette = function (p, garder) {
    var d = V.doc, id = garder ? V.verreSuivant() : 1, pris = {}, neufs, table = {};
    if (garder) d.verres.forEach(function (v) { pris[v.nom] = true; });
    neufs = p.couleurs.slice(0, garder ? Math.max(0, VERRES_MAX - d.verres.length) : VERRES_MAX).map(function (c, i) {
      return { id: id + i, nom: nomLibre(V.nomTeinte(c), pris), couleur: c, texture: V.textureDe(c, i) };
    });
    if (garder) { d.verres = d.verres.concat(neufs); return neufs.length; }
    d.verres.forEach(function (v) {
      var mieux = neufs[0];
      neufs.forEach(function (n) { if (ecart(v.couleur, n.couleur) < ecart(v.couleur, mieux.couleur)) mieux = n; });
      table[v.id] = mieux.id;
    });
    d.pieces.forEach(function (q) { q.verre = table[q.verre] || 0; });
    d.pieces = d.pieces.filter(function (q) { return q.verre; });
    d.verres = neufs;
    return neufs.length;
  };

  V.VERRES_MAX = VERRES_MAX;

  // ---------- Projet ----------
  V.versProjet = function () {
    var d = V.doc, ids = Object.keys(d.noeuds).map(Number).sort(function (a, b) { return a - b; });
    return {
      format: FORMAT, version: 1, nom: d.nom,
      panneau: { forme: d.forme.type, largeur: d.forme.l, hauteur: d.forme.h, lobes: d.forme.lobes, libre: d.forme.libre },
      plomb: d.plomb, bordure: d.bordure, grille: d.grille, aimant: d.aimant, regles: d.regles,
      noeuds: ids.map(function (id) { return [id, d.noeuds[id].x, d.noeuds[id].y]; }),
      plombs: d.plombs.map(function (e) {
        var o = { id: e.id, a: e.a, b: e.b, l: e.l };
        if (e.c) o.c = e.c;
        if (e.bord) o.bord = true;
        return o;
      }),
      verres: d.verres.map(function (v) { return { id: v.id, nom: v.nom, couleur: v.couleur, texture: v.texture }; }),
      pieces: d.pieces.map(function (p) { return { x: p.x, y: p.y, verre: p.verre, graine: p.graine }; }),
      grisaille: d.grisaille.map(function (s) { return { l: s.l, pts: s.pts }; })
    };
  };

  function nombre(v, def) { v = Number(v); return isFinite(v) ? v : def; }

  V.depuisProjet = function (o) {
    var d, max = 0, noeuds = {}, ids = {}, textures = {}, err = new Error('Ce projet Vitrail est abîmé : il ne peut pas être ouvert.');
    if (!o || o.format !== FORMAT) throw new Error('Ce fichier n\'est pas un projet Vitrail.');
    if (!o.panneau || typeof o.panneau !== 'object' || !Array.isArray(o.noeuds) || !Array.isArray(o.plombs) || !Array.isArray(o.verres)) throw err;
    R.TEXTURES.forEach(function (t) { textures[t.id] = true; });
    var types = {};
    G.FORMES.forEach(function (f) { types[f.id] = true; });
    d = {
      nom: String(o.nom || 'vitrail').slice(0, 60),
      forme: {
        type: types[o.panneau.forme] ? o.panneau.forme : 'rect',
        l: borne(Math.round(nombre(o.panneau.largeur, 600)), COTE_MIN, COTE_MAX), h: borne(Math.round(nombre(o.panneau.hauteur, 900)), COTE_MIN, COTE_MAX),
        lobes: borne(Math.round(nombre(o.panneau.lobes, 8)), 5, 16),
        libre: Array.isArray(o.panneau.libre) ? o.panneau.libre.filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); }).map(function (p) { return [Number(p[0]), Number(p[1])]; }) : null
      },
      plomb: borne(nombre(o.plomb, 6), 2, 30), bordure: borne(nombre(o.bordure, 12), 2, 30), grille: borne(nombre(o.grille, 10), 1, 200), aimant: o.aimant !== false,
      regles: {}, noeuds: {}, plombs: [], suivant: 1, verres: [], pieces: [], grisaille: []
    };
    if (d.forme.type === 'libre' && (!d.forme.libre || d.forme.libre.length < 3)) d.forme.type = 'rect';
    Object.keys(G.REGLES).forEach(function (k) { d.regles[k] = o.regles && isFinite(o.regles[k]) ? Number(o.regles[k]) : G.REGLES[k]; });
    if (o.noeuds.length > 50000 || o.plombs.length > 50000) throw err;
    o.noeuds.forEach(function (n) {
      if (!Array.isArray(n)) throw err;
      var id = Math.round(n[0]);
      if (!(id > 0) || noeuds[id] || !isFinite(n[1]) || !isFinite(n[2])) throw err;
      noeuds[id] = { id: id, x: Number(n[1]), y: Number(n[2]) }; max = Math.max(max, id);
    });
    d.noeuds = noeuds;
    o.plombs.forEach(function (e) {
      if (!e || typeof e !== 'object') throw err;
      var id = Math.round(e.id), c = null;
      if (!(id > 0) || ids[id] || !noeuds[e.a] || !noeuds[e.b] || Number(e.a) === Number(e.b)) throw err;
      if (Array.isArray(e.c)) { if (e.c.length !== 4 || !e.c.every(isFinite)) throw err; c = e.c.map(Number); }
      ids[id] = true; max = Math.max(max, id);
      d.plombs.push({ id: id, a: Number(e.a), b: Number(e.b), c: c, l: borne(nombre(e.l, 6), 1, 40), bord: !!e.bord });
    });
    if (!d.plombs.some(function (e) { return e.bord; })) throw err;
    d.suivant = max + 1;
    var vus = {};
    o.verres.slice(0, VERRES_MAX).forEach(function (v) {
      if (!v || typeof v !== 'object') return;
      var id = Math.round(v.id);
      if (!(id > 0) || vus[id] || !/^#[0-9a-f]{6}$/i.test(v.couleur)) return;
      vus[id] = true;
      d.verres.push({ id: id, nom: String(v.nom || V.nomTeinte(v.couleur)).slice(0, 40), couleur: v.couleur.toLowerCase(), texture: textures[v.texture] ? v.texture : 'cathedrale' });
    });
    if (!d.verres.length) d.verres = verresDefaut();
    (Array.isArray(o.pieces) ? o.pieces : []).forEach(function (p) {
      if (p && isFinite(p.x) && isFinite(p.y) && vus[p.verre]) d.pieces.push({ x: Number(p.x), y: Number(p.y), verre: Math.round(p.verre), graine: Math.round(nombre(p.graine, 1)) || 1 });
    });
    (Array.isArray(o.grisaille) ? o.grisaille : []).forEach(function (s) {
      if (!s || !Array.isArray(s.pts) || !s.pts.length) return;
      var pts = s.pts.filter(function (q) { return Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]); }).map(function (q) { return [Number(q[0]), Number(q[1])]; });
      if (pts.length) d.grisaille.push({ l: borne(nombre(s.l, 1.5), 0.3, 20), pts: pts });
    });
    // Le réseau est analysé avant de remplacer le vitrail en cours : un fichier qui ne s'analyse pas ne le détruit pas.
    try { G.analyser(d); } catch (e) { throw err; }
    V.doc = d;
    V.oublier();
    V.calc = null;
    V.change(false);
  };

  // ---------- SVG ----------
  function n2(v) { return String(Math.round(v * 100) / 100); }
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  V.echapper = echapper;

  // Le contour d'une pièce en vraies courbes, tel que les plombs le dessinent.
  function cheminFace(f) {
    var d = V.doc, s = '', N = d.noeuds;
    f.demis.forEach(function (h, i) {
      var e = h.e, a = N[h.de], b = N[h.vers];
      if (!i) s += 'M' + n2(a.x) + ' ' + n2(a.y);
      if (!e.c) s += 'L' + n2(b.x) + ' ' + n2(b.y);
      else if (h.s > 0) s += 'C' + n2(e.c[0]) + ' ' + n2(e.c[1]) + ' ' + n2(e.c[2]) + ' ' + n2(e.c[3]) + ' ' + n2(b.x) + ' ' + n2(b.y);
      else s += 'C' + n2(e.c[2]) + ' ' + n2(e.c[3]) + ' ' + n2(e.c[0]) + ' ' + n2(e.c[1]) + ' ' + n2(b.x) + ' ' + n2(b.y);
    });
    s += 'Z';
    f.trous.forEach(function (t) { s += 'M' + t.map(function (q) { return n2(q.x) + ' ' + n2(q.y); }).join('L') + 'Z'; });
    return s;
  }
  function cheminPlomb(e) {
    var a = V.doc.noeuds[e.a], b = V.doc.noeuds[e.b];
    return 'M' + n2(a.x) + ' ' + n2(a.y) + (e.c ? 'C' + e.c.map(n2).join(' ') + ' ' : 'L') + n2(b.x) + ' ' + n2(b.y);
  }
  function cm2(f) { return V.fr(f.aire / 100, 1); }

  V.svg = function () {
    var d = V.doc, c = V.calc, m = 10, W = d.forme.l, H = d.forme.h, largeurs = {}, out;
    out = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + (W + 2 * m) + 'mm" height="' + (H + 2 * m) + 'mm" viewBox="' + (-m) + ' ' + (-m) + ' ' + (W + 2 * m) + ' ' + (H + 2 * m) + '">\n' +
      '<title>' + echapper(d.nom) + '</title>\n<desc>Vitrail de ' + V.fr(W / 10) + ' × ' + V.fr(H / 10) + ' cm, ' + c.faces.length + ' pièces. Unités : millimètres, plombs à leur largeur réelle.</desc>\n' +
      '<defs><clipPath id="panneau"><path d="' + G.contourPoly(d).map(function (q, i) { return (i ? 'L' : 'M') + n2(q.x) + ' ' + n2(q.y); }).join('') + 'Z"/></clipPath></defs>\n' +
      '<g id="verres" stroke="none">\n';
    c.faces.forEach(function (f) {
      var v = f.verre && V.verre(f.verre);
      out += '<path id="piece-' + f.numero + '" d="' + cheminFace(f) + '" fill="' + (v ? v.couleur : '#ffffff') + '" fill-rule="evenodd" data-numero="' + f.numero + '" data-verre="' + echapper(v ? v.nom : '') + '" data-texture="' + (v ? v.texture : '') + '" data-surface-cm2="' + (f.aire / 100).toFixed(1) + '"><title>Pièce ' + f.numero + ' : ' + echapper(v ? v.nom : 'sans verre') + ', ' + cm2(f) + ' cm²</title></path>\n';
    });
    out += '</g>\n';
    if (d.grisaille.length) {
      out += '<g id="grisaille" fill="none" stroke="#2b1a10" stroke-opacity=".86" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#panneau)">\n';
      d.grisaille.forEach(function (s) { out += '<path stroke-width="' + n2(s.l) + '" d="M' + s.pts.map(function (q) { return n2(q[0]) + ' ' + n2(q[1]); }).join('L') + (s.pts.length === 1 ? 'h0.01' : '') + '"/>\n'; });
      out += '</g>\n';
    }
    d.plombs.forEach(function (e) { var k = (e.bord ? 'b' : 'p') + e.l; (largeurs[k] = largeurs[k] || []).push(cheminPlomb(e)); });
    out += '<g id="plombs" fill="none" stroke="#1b1c1e" stroke-linecap="round" stroke-linejoin="round">\n';
    Object.keys(largeurs).sort().forEach(function (k) {
      out += '<path id="' + (k[0] === 'b' ? 'bordure-' : 'plomb-') + k.slice(1) + 'mm" stroke-width="' + k.slice(1) + '" d="' + largeurs[k].join('') + '"/>\n';
    });
    return out + '</g>\n</svg>\n';
  };

  // ---------- Calibre ----------
  // Le patron de coupe à taille réelle : chaque pièce numérotée, la liste des pièces à côté, et une règle pour vérifier l'impression.
  V.calibre = function () {
    var d = V.doc, c = V.calc, m = 15, haut = 30, W = d.forme.l, H = d.forme.h, ligne = 6, parCol = Math.max(10, Math.floor((H - 20) / ligne)), lignes = [], cols, larg = 78, tot = {}, out, x0, y, i, police = 'Corbel, \'Segoe UI\', Arial, sans-serif';
    c.faces.forEach(function (f) { var v = f.verre && V.verre(f.verre); lignes.push([String(f.numero), v ? v.nom : '(sans verre)', cm2(f) + ' cm²', v ? v.couleur : '']); if (v) { tot[v.id] = tot[v.id] || { v: v, n: 0, a: 0 }; tot[v.id].n++; tot[v.id].a += f.aire; } });
    lignes.push(['', '', '', '']); lignes.push(['', 'Verre à prévoir', '', '']);
    d.verres.forEach(function (v) { if (tot[v.id]) lignes.push(['', v.nom + ' : ' + tot[v.id].n + (tot[v.id].n > 1 ? ' pièces' : ' pièce'), V.fr(tot[v.id].a / 100, 0) + ' cm²', v.couleur]); });
    cols = Math.ceil(lignes.length / parCol);
    var LW = W + 2 * m + cols * larg, LH = H + m + haut + 24;
    out = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + LW + 'mm" height="' + LH + 'mm" viewBox="0 0 ' + LW + ' ' + LH + '" font-family="' + police + '">\n' +
      '<title>Calibre : ' + echapper(d.nom) + '</title>\n<rect width="' + LW + '" height="' + LH + '" fill="#ffffff"/>\n' +
      '<text x="' + m + '" y="14" font-size="7" fill="#1b1c1e">Calibre : ' + echapper(d.nom) + '</text>\n' +
      '<text x="' + m + '" y="22" font-size="4" fill="#3a3d40">' + V.fr(W / 10) + ' × ' + V.fr(H / 10) + ' cm à taille réelle, ' + c.faces.length + ' pièces. Couper aux ciseaux à calibre : la lame du milieu retire le cœur du plomb.</text>\n' +
      '<g transform="translate(' + m + ' ' + haut + ')">\n<g fill="none" stroke="#1b1c1e" stroke-width="0.4" stroke-linejoin="round">\n';
    c.faces.forEach(function (f) { out += '<path d="' + cheminFace(f) + '"/>\n'; });
    out += '</g>\n<g fill="#1b1c1e" text-anchor="middle">\n';
    c.faces.forEach(function (f) {
      var v = f.verre && V.verre(f.verre), cote = Math.sqrt(f.aire), t = borne(cote * 0.22, 3, 14);
      out += '<text x="' + n2(f.centre.x) + '" y="' + n2(f.centre.y + t * 0.3) + '" font-size="' + n2(t) + '" font-weight="700">' + f.numero + '</text>\n';
      if (v && cote > 28) out += '<text x="' + n2(f.centre.x) + '" y="' + n2(f.centre.y + t * 0.3 + t * 0.75) + '" font-size="' + n2(Math.max(2.4, t * 0.38)) + '" fill="#3a3d40">' + echapper(v.nom) + '</text>\n';
    });
    out += '</g>\n';
    // La règle de 10 cm : si elle ne mesure pas 10 cm sur le papier, l'impression n'est pas à l'échelle.
    out += '<g transform="translate(0 ' + (H + 10) + ')" stroke="#1b1c1e" stroke-width="0.4"><path d="M0 0H100M0 -3V3M100 -3V3' + [10, 20, 30, 40, 50, 60, 70, 80, 90].map(function (k) { return 'M' + k + ' -1.5V1.5'; }).join('') + '"/>' +
      '<text x="104" y="1.5" font-size="4" stroke="none" fill="#1b1c1e">10 cm : vérifie cette règle sur le papier imprimé.</text></g>\n</g>\n';
    x0 = W + 2 * m;
    for (i = 0; i < lignes.length; i++) {
      var col = Math.floor(i / parCol), l = lignes[i], gx = x0 + col * larg;
      y = haut + 4 + (i % parCol) * ligne;
      if (l[3]) out += '<rect x="' + gx + '" y="' + (y - 3.4) + '" width="4" height="4" fill="' + l[3] + '" stroke="#1b1c1e" stroke-width="0.2"/>';
      out += '<text x="' + (gx + 13) + '" y="' + y + '" font-size="3.6" text-anchor="end" font-weight="700">' + l[0] + '</text><text x="' + (gx + 16) + '" y="' + y + '" font-size="3.6">' + echapper(l[1]) + '</text><text x="' + (gx + larg - 4) + '" y="' + y + '" font-size="3.6" text-anchor="end">' + l[2] + '</text>\n';
    }
    return out + '</svg>\n';
  };
})();
