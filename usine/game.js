(function () {
  'use strict';

  var U = window.Usine;
  var DX = U.DX, DY = U.DY, OBJETS = U.OBJETS, PIECES = U.PIECES, MACHINE = U.MACHINE;
  var CLE = 'usine-v1';
  var VITESSES = [1, 2, 4, 16];
  var CADENCES = [8, 4, 2, 1];     // périodes proposées pour une source du bac à sable
  var FLECHES = ['→', '↓', '←', '↑'];
  var ALERTE = 8;                  // pas d'attente avant de signaler une machine
  var ZMAX = 128;
  var PI = Math.PI;
  var POLICE = 'Bahnschrift, "Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif';

  // Peintures d'atelier.
  var NOIR = '#1b1d1f', TRAIT = '#15171a', JAUNE = '#f5b800', PEINT = '#e6ae12';
  var ACIER = '#a7aeb3', ACIER_C = '#d6dbde', ACIER_S = '#5d6469', CAOUT = '#292b2e';
  var CARTER = {
    four: ['#17191b', '#3a4044'], presse: ['#163c69', '#2f6db0'], tour: ['#1c4832', '#3f8a5e'],
    assem: ['#565d62', '#9ea5aa'], broyeur: ['#7a1913', '#c8281e'], src: ['#9c7400', '#f0b20a']
  };
  var MATIERE = {
    mf: ['#6d7d8a', '#262d33'], mc: ['#b9662f', '#4a2410'], lf: ['#8f9ca6', '#2c3740'], lc: ['#c96a26', '#4a2610'],
    pl: ['#cdd6dc', '#2c3740'], fi: ['#e08638', '#4a2610'], en: ['#e3e8ec', '#20282e'], ch: ['#8a7767', '#2a211a'],
    me: ['#5c8fdc', '#16264a'], ci: ['#3fa565', '#0f3a1e'], au: ['#f2c230', '#3d2c05']
  };
  var COS = [1, 0, -1, 0], SIN = [0, 1, 0, -1];

  var $ = function (s) { return document.querySelector(s); };
  var cv = $('#vue'), ctx = cv.getContext('2d');

  // ---------- État ----------
  // niv : niveau courant, plan : pièces posées, S : simulation, hist : annuler/rétablir.
  // outil : pièce à poser, 'pipette', 'gomme' ou null (main libre). geste : glisser en cours.
  // vue : z case en pixels CSS, zc zoom visé, (ox, oy) coin de la grille, (ax, ay) point fixe du zoom.
  var sauve = { plans: {}, records: {}, dernier: '', vit: 0, aide: false };
  var niv, plan, S, hist, objetsNiv = [], scene = null, usure = [];
  var outil = null, dir = 0, objF = 'mf', per = 4;
  var vue = { z: 48, zc: 48, ox: 0, oy: 0, ax: 0, ay: 0, l: 0, h: 0, dpr: 1 };
  var survol = null, souris = null, geste = null;
  var pause = false, vit = 0, acc = 0, dernier = 0, alpha = 1, majA = 0, temps = 0;
  var res = null, memo = {};

  function lireSauve() {
    try {
      var s = JSON.parse(localStorage.getItem(CLE));
      if (s && s.plans && s.records) sauve = s;
    } catch (e) { /* stockage indisponible : on joue sans mémoire */ }
    vit = VITESSES[sauve.vit] ? sauve.vit : 0;
  }
  function ecrireSauve() {
    try { localStorage.setItem(CLE, JSON.stringify(sauve)); } catch (e) { /* idem */ }
  }

  function trouver(id) {
    if (id === 'bac') return U.BAC;
    for (var i = 0; i < U.NIVEAUX.length; i++) if (U.NIVEAUX[i].id === id) return U.NIVEAUX[i];
    return null;
  }
  function reussis() {
    var n = 0;
    U.NIVEAUX.forEach(function (v) { if (sauve.records[v.id] && sauve.records[v.id].e) n++; });
    return n;
  }
  function ouvert(i) { return i <= reussis() + 1; }
  function etoiles(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(n); }
  function borne(v, a, b) { return v < a ? a : v > b ? b : v; }
  function alea(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }

  // Les objets qu'on peut rencontrer dans un niveau : ceux des sources, puis tout ce que les machines permises en tirent.
  function objetsDe(n) {
    var vus = {}, l = [], encore = true;
    function voir(k) { if (!vus[k]) { vus[k] = true; l.push(k); encore = true; } }
    if (n.bac) return Object.keys(OBJETS);
    n.sources.forEach(function (s) { s.o.forEach(voir); });
    while (encore) {
      encore = false;
      U.RECETTES.forEach(function (r) {
        var k;
        if (n.pieces.indexOf(r.m) < 0) return;
        for (k in r.e) if (!vus[k]) return;
        r.s.forEach(voir);
      });
    }
    return l;
  }

  function texteBesoins(facteur) {
    var c0 = S.besoins[0].c;
    return S.besoins.map(function (b) {
      var n = facteur ? Math.round(b.c * facteur / c0) : b.c;
      return n + ' ' + OBJETS[b.k].pluriel;
    }).join(' et ') + ' par minute';
  }
  function textePalier(p) {
    var t = [];
    if (p.debit !== undefined) t.push(texteBesoins(p.debit));
    if (p.cout !== undefined) t.push('coût ≤ ' + p.cout);
    if (p.emprise !== undefined) t.push('emprise ≤ ' + p.emprise + ' cases');
    return t.join(', ');
  }

  // ---------- Niveau ----------
  function charger(n) {
    niv = n;
    plan = U.decoder(niv, sauve.plans[niv.id] || '[]');
    hist = U.histo();
    objetsNiv = objetsDe(niv);
    if (objetsNiv.indexOf(objF) < 0) objF = objetsNiv[0];
    outil = 'tapis'; dir = 0; geste = null; survol = null;
    sauve.dernier = niv.id;
    try { history.replaceState(null, '', '#' + niv.id); } catch (e) { location.replace('#' + niv.id); }   // Chrome refuse replaceState en file://
    user();
    reconstruire();
    enregistrer();
    monter();
    cadrer();
  }

  function reconstruire() {
    S = U.creer(niv, plan);
    acc = 0; alpha = 1; res = null; memo = {};
    preparer();
  }
  function enregistrer() {
    sauve.plans[niv.id] = U.coder(plan);
    ecrireSauve();
  }

  function modifier(fn) {
    var avant = U.coder(plan);
    fn();
    if (U.noter(hist, avant, plan)) { reconstruire(); enregistrer(); }
  }

  function verdict() {
    var r = U.resultat(S), rec, neuf = false;
    res = r;
    if (!r.valide) return;
    rec = sauve.records[niv.id] || (sauve.records[niv.id] = { e: 0, debit: 0, cout: 0, emprise: 0, plan: '', pd: 0, pc: 0 });
    if (r.etoiles > rec.e || (r.etoiles === rec.e && (r.debit > rec.pd || (r.debit === rec.pd && r.cout < rec.pc)))) {
      rec.e = r.etoiles; rec.plan = U.coder(plan); rec.pd = r.debit; rec.pc = r.cout; neuf = true;
    }
    if (r.debit > rec.debit) { rec.debit = r.debit; neuf = true; }
    if (!rec.cout || r.cout < rec.cout) { rec.cout = r.cout; neuf = true; }
    if (!rec.emprise || r.emprise < rec.emprise) { rec.emprise = r.emprise; neuf = true; }
    if (neuf) ecrireSauve();
  }

  function pas() {
    U.avancer(S);
    if (!niv.bac) verdict();
  }

  // ---------- Tracés ----------
  function poly(c, p) {
    c.beginPath();
    c.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
    c.closePath();
  }
  function arrondi(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function disque(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, 2 * PI); }
  function plein(c) { c.fill(); c.stroke(); }
  function trait(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
  function fleche(c, x0, y0, x1, y1, t) {
    var a = Math.atan2(y1 - y0, x1 - x0);
    trait(c, x0, y0, x1, y1);
    c.save();
    c.translate(x1, y1); c.rotate(a);
    poly(c, [t * 0.3, 0, -t, -t * 0.8, -t, t * 0.8]); c.fill();
    c.restore();
  }

  // ---------- Dessin des objets ----------
  // Chaque objet est une petite pièce, reconnaissable à sa silhouette autant qu'à sa couleur.
  function objet(c, k, x, y, r) {
    var m = MATIERE[k], i, a, p;
    c.save();
    c.translate(x, y); c.scale(r, r);
    c.lineWidth = 0.15; c.lineJoin = 'round'; c.lineCap = 'butt'; c.fillStyle = m[0]; c.strokeStyle = m[1];
    switch (k) {
      case 'mf':
        poly(c, [-0.9, -0.1, -0.35, -0.85, 0.6, -0.7, 0.95, 0.2, 0.2, 0.9, -0.7, 0.6]); plein(c);
        c.fillStyle = '#a3b3bf'; poly(c, [-0.35, -0.85, 0.6, -0.7, 0.08, -0.08, -0.9, -0.1]); c.fill();
        c.fillStyle = '#47545e'; poly(c, [0.08, -0.08, 0.95, 0.2, 0.2, 0.9]); c.fill();
        c.fillStyle = '#a2573a'; disque(c, -0.3, 0.35, 0.13); c.fill();
        poly(c, [-0.9, -0.1, -0.35, -0.85, 0.6, -0.7, 0.95, 0.2, 0.2, 0.9, -0.7, 0.6]); c.stroke();
        break;
      case 'mc':
        p = [-0.42, 0.34, 0.52, 0.44, 0.3, 0.5, 0.02, -0.4, 0.54];
        c.lineWidth = 0.3;
        for (i = 0; i < 9; i += 3) { disque(c, p[i], p[i + 1], p[i + 2]); c.stroke(); }
        for (i = 0; i < 9; i += 3) { disque(c, p[i], p[i + 1], p[i + 2]); c.fill(); }
        c.fillStyle = '#e7a06a'; disque(c, -0.12, -0.55, 0.2); c.fill(); disque(c, -0.58, 0.2, 0.15); c.fill();
        c.fillStyle = '#3c9d86'; disque(c, 0.5, 0.2, 0.17); c.fill(); disque(c, -0.2, 0.42, 0.13); c.fill();
        break;
      case 'lf':
        c.beginPath(); c.rect(-1, -0.62, 2, 1.24); plein(c);
        c.lineWidth = 0.08;
        c.beginPath(); c.moveTo(-1, -0.62); c.lineTo(-0.64, -0.3); c.moveTo(1, -0.62); c.lineTo(0.64, -0.3);
        c.moveTo(-1, 0.62); c.lineTo(-0.64, 0.3); c.moveTo(1, 0.62); c.lineTo(0.64, 0.3); c.stroke();
        c.fillStyle = '#e1e8ec'; c.beginPath(); c.rect(-0.64, -0.3, 1.28, 0.6); plein(c);
        break;
      case 'lc':
        arrondi(c, -1, -0.58, 2, 1.16, 0.58); plein(c);
        c.fillStyle = '#f6b077'; c.lineWidth = 0.08;
        arrondi(c, -0.66, -0.26, 1.32, 0.52, 0.26); plein(c);
        break;
      case 'pl':
        c.beginPath(); c.rect(-0.84, -0.84, 1.68, 1.68); plein(c);
        c.strokeStyle = '#f6f9fa'; c.lineWidth = 0.16;
        trait(c, -0.5, 0.3, 0.3, -0.5); trait(c, -0.1, 0.5, 0.5, -0.1);
        c.fillStyle = m[1];
        for (i = 0; i < 4; i++) { disque(c, i & 1 ? 0.54 : -0.54, i & 2 ? 0.54 : -0.54, 0.12); c.fill(); }
        break;
      case 'fi':
        c.lineWidth = 0.13; trait(c, 0.5, 0.6, 1, 0.95);
        c.lineWidth = 0.15; disque(c, 0, 0, 0.9); plein(c);
        c.strokeStyle = '#96501a'; c.lineWidth = 0.08;
        disque(c, 0, 0, 0.7); c.stroke(); disque(c, 0, 0, 0.52); c.stroke();
        c.fillStyle = '#2a1a10'; c.strokeStyle = m[1]; c.lineWidth = 0.12; disque(c, 0, 0, 0.33); plein(c);
        break;
      case 'en':
        p = [];
        for (i = 0; i < 8; i++) {
          a = i * PI / 4;
          p.push(0.68 * Math.cos(a - 0.28), 0.68 * Math.sin(a - 0.28), Math.cos(a - 0.17), Math.sin(a - 0.17),
            Math.cos(a + 0.17), Math.sin(a + 0.17), 0.68 * Math.cos(a + 0.28), 0.68 * Math.sin(a + 0.28));
        }
        poly(c, p); plein(c);
        c.strokeStyle = '#9aa5ad'; c.lineWidth = 0.07; disque(c, 0, 0, 0.47); c.stroke();
        c.fillStyle = m[1]; disque(c, 0, 0, 0.26); c.fill();
        break;
      case 'ch':
        poly(c, [-0.95, 0.1, -0.35, -0.75, -0.1, 0.25]); plein(c);
        poly(c, [0.1, -0.35, 0.95, -0.55, 0.6, 0.3]); plein(c);
        poly(c, [-0.35, 0.55, 0.5, 0.45, 0.1, 0.98]); plein(c);
        c.strokeStyle = '#c9b8a8'; c.lineWidth = 0.08;
        trait(c, -0.6, -0.1, -0.35, -0.45); trait(c, 0.35, -0.3, 0.7, -0.38);
        break;
      case 'me':
        c.lineWidth = 0.2; trait(c, -1.05, 0, 1.05, 0);
        c.lineWidth = 0.15; poly(c, [0, -0.95, 0.95, 0, 0, 0.95, -0.95, 0]); plein(c);
        c.strokeStyle = '#eef4ff'; c.lineWidth = 0.14;
        disque(c, 0, 0, 0.36); c.stroke();
        c.beginPath(); c.moveTo(-0.36, 0); c.lineTo(0.36, 0); c.moveTo(0, -0.36); c.lineTo(0, 0.36); c.stroke();
        break;
      case 'ci':
        c.strokeStyle = '#d9b233'; c.lineWidth = 0.14;
        c.beginPath();
        for (i = -0.6; i < 0.7; i += 0.4) { c.moveTo(i, -0.95); c.lineTo(i, 0.95); }
        c.stroke();
        c.strokeStyle = m[1]; c.lineWidth = 0.15;
        c.beginPath(); c.rect(-0.95, -0.6, 1.9, 1.2); plein(c);
        c.strokeStyle = '#a5e3b8'; c.lineWidth = 0.07;
        c.beginPath(); c.moveTo(-0.75, -0.38); c.lineTo(-0.5, -0.38); c.lineTo(-0.5, 0); c.moveTo(0.75, 0.38); c.lineTo(0.52, 0.38); c.lineTo(0.52, 0.05); c.stroke();
        c.fillStyle = '#15171a'; c.fillRect(-0.33, -0.27, 0.66, 0.54);
        break;
      default:
        c.fillStyle = ACIER; c.lineWidth = 0.1;
        c.beginPath(); c.rect(-1, -0.2, 2, 0.5); plein(c);
        c.lineWidth = 0.13; trait(c, 0, -0.6, 0, -0.92);
        c.fillStyle = '#c8281e'; disque(c, 0, -0.92, 0.13); c.fill();
        c.fillStyle = m[0]; c.lineWidth = 0.15;
        arrondi(c, -0.8, -0.62, 1.6, 1.42, 0.3); plein(c);
        c.fillStyle = m[1];
        disque(c, -0.33, -0.05, 0.2); c.fill(); disque(c, 0.33, -0.05, 0.2); c.fill();
        c.lineWidth = 0.12; trait(c, -0.28, 0.45, 0.28, 0.45);
        c.fillStyle = '#fff'; disque(c, -0.28, -0.1, 0.07); c.fill(); disque(c, 0.38, -0.1, 0.07); c.fill();
    }
    c.restore();
  }

  function icone(k, px) {
    var e = document.createElement('canvas'), c;
    e.width = e.height = px * 2; e.className = 'ico'; e.title = OBJETS[k].nom;
    c = e.getContext('2d');
    objet(c, k, px, px, px * 0.8);
    return e;
  }

  // ---------- Dessin des pièces ----------
  // Tout se dessine dans une case unité centrée sur l'origine, la sortie vers +x ; l'appelant tourne le repère.
  // o : forme du tapis, raccords, objet filtré, type de caisse.
  function boulons(c, p) {
    c.fillStyle = TRAIT;
    for (var i = 0; i < p.length; i += 2) { disque(c, p[i], p[i + 1], 0.022); c.fill(); }
  }

  // Un tapis : châssis d'acier, rives, bande de caoutchouc. Il déborde un peu de la case pour se raccorder au voisin.
  function troncon(c, x0, x1) {
    c.fillStyle = ACIER_S; c.fillRect(x0, -0.37, x1 - x0, 0.74);
    c.fillStyle = ACIER; c.fillRect(x0, -0.36, x1 - x0, 0.08); c.fillRect(x0, 0.28, x1 - x0, 0.08);
    c.fillStyle = ACIER_C; c.fillRect(x0, -0.36, x1 - x0, 0.025); c.fillRect(x0, 0.28, x1 - x0, 0.025);
    c.fillStyle = CAOUT; c.fillRect(x0, -0.275, x1 - x0, 0.55);
  }

  function bande(c, forme, cg, cd) {
    var k, a0, a1;
    if (forme === 0) {
      troncon(c, -0.52, 0.52);
      boulons(c, [-0.36, -0.32, 0, -0.32, 0.36, -0.32, -0.36, 0.32, 0, 0.32, 0.36, 0.32]);
      [cg ? -1 : 0, cd ? 1 : 0].forEach(function (s) {
        if (!s) return;
        c.fillStyle = ACIER; c.fillRect(-0.36, s < 0 ? -0.52 : 0.37, 0.72, 0.15);
        c.fillStyle = CAOUT; c.fillRect(-0.275, s < 0 ? -0.52 : 0.27, 0.55, 0.25);
      });
      return;
    }
    k = forme === 1 ? -0.5 : 0.5;
    a0 = (forme === 1 ? PI / 2 : PI) - 0.04; a1 = (forme === 1 ? PI : 1.5 * PI) + 0.04;
    c.lineCap = 'butt';
    c.strokeStyle = ACIER_S; c.lineWidth = 0.74; c.beginPath(); c.arc(0.5, k, 0.5, a0, a1); c.stroke();
    c.strokeStyle = ACIER; c.lineWidth = 0.08;
    c.beginPath(); c.arc(0.5, k, 0.82, a0, a1); c.stroke();
    c.beginPath(); c.arc(0.5, k, 0.18, a0, a1); c.stroke();
    c.strokeStyle = ACIER_C; c.lineWidth = 0.025; c.beginPath(); c.arc(0.5, k, 0.848, a0, a1); c.stroke();
    c.strokeStyle = CAOUT; c.lineWidth = 0.55; c.beginPath(); c.arc(0.5, k, 0.5, a0, a1); c.stroke();
  }

  function moignons(c, rel) {
    rel.forEach(function (r) {
      c.save();
      c.rotate(r * PI / 2);
      troncon(c, 0, 0.52);
      c.restore();
    });
  }

  function carter(c, k, trace) {
    var t = CARTER[k];
    c.lineJoin = 'round';
    c.fillStyle = t[0]; c.strokeStyle = TRAIT; c.lineWidth = 0.035;
    trace(1); plein(c);
    c.fillStyle = t[1];
    c.save(); c.translate(-0.012, -0.016); c.scale(0.88, 0.88); trace(0.88); c.restore(); c.fill();
  }

  // La goulotte de sortie : tôle claire, flèche noire. Les fentes sombres sont les entrées.
  function goulotte(c) {
    c.fillStyle = ACIER_C; c.strokeStyle = TRAIT; c.lineWidth = 0.03; c.lineJoin = 'round';
    poly(c, [0.26, -0.21, 0.52, -0.15, 0.52, 0.15, 0.26, 0.21]); plein(c);
    c.fillStyle = TRAIT; poly(c, [0.31, -0.12, 0.49, 0, 0.31, 0.12]); c.fill();
  }
  function fentes(c, r) {
    c.fillStyle = TRAIT;
    c.fillRect(-r, -0.14, 0.055, 0.28); c.fillRect(-0.14, -r, 0.28, 0.055); c.fillRect(-0.14, r - 0.055, 0.28, 0.055);
  }
  function piste(c, r) {
    c.strokeStyle = TRAIT; c.lineWidth = 0.065; disque(c, 0, 0, r); c.stroke();
  }

  // Couche basse : ce qui passe sous les objets.
  function bas(c, k, d, o) {
    var i, v;
    c.save();
    c.rotate(d * PI / 2);
    c.lineJoin = 'round'; c.lineCap = 'butt';
    switch (k) {
      case 'tapis': bande(c, o.forme, o.cg, o.cd); break;
      case 'pont':
        c.rotate(PI / 2); bande(c, 0, false, false);
        break;
      case 'sep':
        moignons(c, o.rel);
        c.fillStyle = '#946d00'; c.strokeStyle = TRAIT; c.lineWidth = 0.035;
        poly(c, [0, -0.48, 0.48, 0, 0, 0.48, -0.48, 0]); plein(c);
        c.fillStyle = JAUNE; poly(c, [-0.01, -0.41, 0.4, -0.01, -0.01, 0.39, -0.42, -0.01]); c.fill();
        c.fillStyle = c.strokeStyle = TRAIT; c.lineWidth = 0.06;
        trait(c, -0.3, 0, -0.07, 0);
        fleche(c, -0.07, 0, 0.26, 0, 0.1); fleche(c, -0.07, 0, -0.07, -0.24, 0.1); fleche(c, -0.07, 0, -0.07, 0.24, 0.1);
        break;
      case 'fus':
        moignons(c, o.rel);
        c.fillStyle = '#0f4a59'; c.strokeStyle = TRAIT; c.lineWidth = 0.035;
        disque(c, 0, 0, 0.45); plein(c);
        c.fillStyle = '#2b93ab'; disque(c, -0.01, -0.015, 0.39); c.fill();
        c.fillStyle = c.strokeStyle = '#fff'; c.lineWidth = 0.065;
        c.beginPath(); c.moveTo(-0.3, 0); c.lineTo(0, 0); c.moveTo(0, -0.29); c.lineTo(0, 0.29); c.stroke();
        fleche(c, 0, 0, 0.27, 0, 0.11);
        break;
      case 'filtre':
        moignons(c, o.rel);
        c.fillStyle = ACIER_S; c.strokeStyle = TRAIT; c.lineWidth = 0.035;
        poly(c, [-0.45, -0.45, 0.14, -0.45, 0.46, -0.17, 0.46, 0.17, 0.14, 0.45, -0.45, 0.45]); plein(c);
        c.fillStyle = '#e9ecea';
        poly(c, [-0.41, -0.41, 0.11, -0.41, 0.4, -0.16, 0.4, 0.14, 0.11, 0.38, -0.41, 0.38]); c.fill();
        c.fillStyle = TRAIT; poly(c, [0.2, -0.13, 0.38, 0, 0.2, 0.13]); c.fill();
        break;
      case 'out':
        c.rotate(-d * PI / 2);
        if (o.type === 'benne') {
          c.fillStyle = '#131716'; c.fillRect(-0.37, -0.37, 0.74, 0.74);
          c.fillStyle = '#6b5a4c'; poly(c, [-0.25, 0.1, -0.05, -0.2, 0.05, 0.15]); c.fill();
          c.fillStyle = '#7f8b93'; poly(c, [0.05, -0.05, 0.28, -0.22, 0.22, 0.2]); c.fill();
          c.fillStyle = '#8a4a2a'; poly(c, [-0.2, 0.22, 0.12, 0.2, -0.02, 0.33]); c.fill();
        } else {
          c.fillStyle = '#4a3319'; c.fillRect(-0.35, -0.35, 0.7, 0.7);
          c.strokeStyle = '#3a2812'; c.lineWidth = 0.02;
          for (i = -0.2; i < 0.3; i += 0.2) trait(c, i, -0.35, i, 0.35);
          if (o.type === 'tout') {
            c.strokeStyle = c.fillStyle = '#f2ead8'; c.lineWidth = 0.06;
            c.beginPath(); c.moveTo(-0.2, 0.04); c.lineTo(-0.2, 0.2); c.lineTo(0.2, 0.2); c.lineTo(0.2, 0.04); c.stroke();
            fleche(c, 0, -0.24, 0, 0.08, 0.1);
          } else {
            v = o.type.split('+');
            c.fillStyle = '#f7f4e8'; c.strokeStyle = TRAIT; c.lineWidth = 0.025;
            c.beginPath(); c.rect(v.length > 1 ? -0.3 : -0.2, -0.26, v.length > 1 ? 0.6 : 0.4, 0.4); plein(c);
            v.forEach(function (it, j) { objet(c, it, v.length > 1 ? -0.15 + j * 0.3 : 0, -0.06, v.length > 1 ? 0.12 : 0.15); });
          }
        }
        break;
    }
    c.restore();
  }

  // Couche haute : ce qui couvre les objets.
  function haut(c, k, d, o) {
    var i, v;
    c.save();
    c.rotate(d * PI / 2);
    c.lineJoin = 'round'; c.lineCap = 'butt';
    switch (k) {
      case 'four':
        carter(c, k, function () { poly(c, [-0.27, -0.45, 0.27, -0.45, 0.45, -0.27, 0.45, 0.27, 0.27, 0.45, -0.27, 0.45, -0.45, 0.27, -0.45, -0.27]); });
        fentes(c, 0.45); goulotte(c);
        c.fillStyle = '#b5532a'; c.strokeStyle = TRAIT; c.lineWidth = 0.03; disque(c, -0.03, 0, 0.255); plein(c);
        c.strokeStyle = '#7d3416'; c.lineWidth = 0.02;
        for (i = 0; i < 8; i++) trait(c, -0.03 + 0.17 * Math.cos(i * PI / 4), 0.17 * Math.sin(i * PI / 4), -0.03 + 0.25 * Math.cos(i * PI / 4), 0.25 * Math.sin(i * PI / 4));
        c.fillStyle = '#2a0e06'; disque(c, -0.03, 0, 0.17); c.fill();
        c.fillStyle = ACIER_S; c.strokeStyle = TRAIT; c.lineWidth = 0.03; disque(c, -0.31, -0.31, 0.075); plein(c);
        c.fillStyle = TRAIT; disque(c, -0.31, -0.31, 0.04); c.fill();
        break;
      case 'presse':
        carter(c, k, function () { arrondi(c, -0.45, -0.45, 0.9, 0.9, 0.04); });
        fentes(c, 0.45); goulotte(c);
        c.fillStyle = '#12233a'; c.fillRect(-0.24, -0.2, 0.4, 0.4);
        c.fillStyle = ACIER_C; c.strokeStyle = TRAIT; c.lineWidth = 0.028;
        for (i = 0; i < 4; i++) { disque(c, i & 1 ? 0.2 : -0.31, i & 2 ? 0.31 : -0.31, 0.065); plein(c); }
        break;
      case 'tour':
        carter(c, k, function () { disque(c, 0, 0, 0.47); });
        fentes(c, 0.455); goulotte(c);
        c.fillStyle = ACIER_S; c.strokeStyle = TRAIT; c.lineWidth = 0.03; disque(c, -0.03, 0, 0.25); plein(c);
        c.fillStyle = ACIER_C; disque(c, -0.03, 0, 0.2); c.fill();
        break;
      case 'assem':
        carter(c, k, function () { poly(c, [-0.28, -0.46, 0.28, -0.46, 0.28, -0.28, 0.46, -0.28, 0.46, 0.28, 0.28, 0.28, 0.28, 0.46, -0.28, 0.46, -0.28, 0.28, -0.46, 0.28, -0.46, -0.28, -0.28, -0.28]); });
        fentes(c, 0.46); goulotte(c);
        boulons(c, [-0.2, -0.34, 0.16, -0.34, -0.2, 0.31, 0.16, 0.31, -0.35, -0.2, -0.35, 0.17]);
        c.fillStyle = '#3f4549'; c.strokeStyle = TRAIT; c.lineWidth = 0.03; disque(c, -0.03, 0, 0.24); plein(c);
        break;
      case 'broyeur':
        carter(c, k, function () { arrondi(c, -0.45, -0.45, 0.9, 0.9, 0.1); });
        c.fillStyle = JAUNE; c.fillRect(-0.32, -0.32, 0.62, 0.62);
        c.save();
        c.beginPath(); c.rect(-0.32, -0.32, 0.62, 0.62); c.clip();
        c.strokeStyle = TRAIT; c.lineWidth = 0.055;
        for (i = -0.9; i < 0.9; i += 0.15) trait(c, i, 0.4, i + 0.8, -0.4);
        c.restore();
        c.fillStyle = TRAIT; c.fillRect(-0.25, -0.25, 0.48, 0.48);
        c.fillStyle = ACIER_C;
        for (i = 0; i < 4; i++) {
          poly(c, [-0.25 + i * 0.12, -0.25, -0.13 + i * 0.12, -0.25, -0.19 + i * 0.12, -0.03]); c.fill();
          poly(c, [-0.25 + i * 0.12, 0.23, -0.13 + i * 0.12, 0.23, -0.19 + i * 0.12, 0.01]); c.fill();
        }
        break;
      case 'pont':
        // Tablier surélevé : rampes sombres aux deux bouts, palier plus clair, garde-corps jaunes.
        c.fillStyle = ACIER_S; c.fillRect(-0.52, -0.43, 1.04, 0.86);
        c.fillStyle = '#34373b'; c.fillRect(-0.52, -0.3, 1.04, 0.6);
        c.fillStyle = '#464b50'; c.fillRect(-0.36, -0.3, 0.72, 0.6);
        c.fillStyle = '#565c61'; c.fillRect(-0.36, -0.3, 0.03, 0.6); c.fillRect(0.33, -0.3, 0.03, 0.6);
        c.fillStyle = JAUNE; c.fillRect(-0.52, -0.43, 1.04, 0.13); c.fillRect(-0.52, 0.3, 1.04, 0.13);
        c.fillStyle = '#ffe07a'; c.fillRect(-0.52, -0.43, 1.04, 0.03); c.fillRect(-0.52, 0.3, 1.04, 0.03);
        c.fillStyle = TRAIT;
        for (i = -0.5; i < 0.5; i += 0.31) { c.fillRect(i, -0.44, 0.07, 0.15); c.fillRect(i, 0.29, 0.07, 0.15); }
        break;
      case 'filtre':
        c.fillStyle = ACIER_S; c.strokeStyle = TRAIT; c.lineWidth = 0.03;
        c.beginPath(); c.rect(-0.2, -0.47, 0.24, 0.94); plein(c);
        c.fillStyle = '#2f9a4c'; c.fillRect(-0.17, -0.44, 0.18, 0.88);
        c.fillStyle = '#f7f4e8'; disque(c, -0.08, 0, 0.215); plein(c);
        break;
      case 'src':
        carter(c, k, function () { arrondi(c, -0.46, -0.46, 0.92, 0.92, 0.07); });
        goulotte(c);
        c.fillStyle = '#211d17'; c.strokeStyle = TRAIT; c.lineWidth = 0.03;
        c.beginPath(); c.rect(-0.36, -0.33, 0.58, 0.64); plein(c);
        c.fillStyle = '#4b4233';
        poly(c, [-0.36, -0.33, 0.22, -0.33, 0.14, -0.25, -0.28, -0.25]); c.fill();
        poly(c, [-0.36, -0.33, -0.28, -0.25, -0.28, 0.23, -0.36, 0.31]); c.fill();
        break;
      case 'out':
        if (o.type === 'benne') {
          c.fillStyle = '#39453f'; c.strokeStyle = TRAIT; c.lineWidth = 0.035;
          c.beginPath(); c.rect(-0.47, -0.47, 0.94, 0.94); c.rect(0.37, -0.37, -0.74, 0.74); c.fill('evenodd');
          c.strokeRect(-0.47, -0.47, 0.94, 0.94); c.strokeRect(-0.37, -0.37, 0.74, 0.74);
          c.fillStyle = '#55635c';
          for (i = -0.36; i < 0.3; i += 0.22) { c.fillRect(i, -0.455, 0.1, 0.07); c.fillRect(i, 0.385, 0.1, 0.07); c.fillRect(-0.455, i, 0.07, 0.1); c.fillRect(0.385, i, 0.07, 0.1); }
        } else {
          c.fillStyle = '#c69a5e'; c.strokeStyle = '#3a2812'; c.lineWidth = 0.035;
          c.beginPath(); c.rect(-0.47, -0.47, 0.94, 0.94); c.rect(0.35, -0.35, -0.7, 0.7); c.fill('evenodd');
          c.strokeRect(-0.47, -0.47, 0.94, 0.94); c.strokeRect(-0.35, -0.35, 0.7, 0.7);
          c.lineWidth = 0.018; c.strokeStyle = '#8a6535';
          trait(c, -0.47, -0.41, 0.47, -0.41); trait(c, -0.47, 0.41, 0.47, 0.41); trait(c, -0.41, -0.35, -0.41, 0.35); trait(c, 0.41, -0.35, 0.41, 0.35);
          c.fillStyle = ACIER; c.strokeStyle = TRAIT; c.lineWidth = 0.02;
          for (i = 0; i < 4; i++) { c.beginPath(); c.rect(i & 1 ? 0.33 : -0.48, i & 2 ? 0.33 : -0.48, 0.15, 0.15); plein(c); }
        }
        break;
    }
    c.restore();

    // Ce qui se lit toujours droit, quelle que soit l'orientation.
    if (k === 'filtre' && o.f) objet(c, o.f, -0.08 * COS[d], -0.08 * SIN[d], 0.15);
    else if (k === 'src') {
      v = o.seq || (o.f ? [o.f] : []);
      v.forEach(function (it, j) {
        var dx = v.length > 1 ? (j ? 0.13 : -0.13) : 0, ax = -0.07 * COS[d], ay = -0.07 * SIN[d];
        objet(c, it, ax + (d & 1 ? 0 : dx), ay + (d & 1 ? dx : 0) - 0.02, v.length > 1 ? 0.12 : 0.17);
      });
    }
  }

  // Organes mobiles des machines, redessinés à chaque image. prog : avancement de la recette, ou undefined à l'arrêt.
  function organes(c, k, d, prog, t) {
    var x = -0.03 * COS[d], y = -0.03 * SIN[d], a, i, s;
    switch (k) {
      case 'four':
        piste(c, 0.215);
        if (prog === undefined) break;
        s = 0.5 + 0.5 * Math.sin(t * 0.009 + x * 40);
        c.fillStyle = 'rgba(255,' + Math.round(120 + 50 * s) + ',30,0.95)'; disque(c, x, y, 0.15); c.fill();
        c.fillStyle = '#fff1b8'; disque(c, x, y, 0.06 + 0.03 * s); c.fill();
        break;
      case 'presse':
        s = prog === undefined ? 0.125 : 0.155 - 0.06 * Math.sin(prog * PI);
        c.fillStyle = ACIER; c.strokeStyle = TRAIT; c.lineWidth = 0.028;
        c.beginPath(); c.rect(-0.055 * COS[d] - s, -0.055 * SIN[d] - s, 2 * s, 2 * s); plein(c);
        c.fillStyle = ACIER_C; c.fillRect(-0.055 * COS[d] - s * 0.55, -0.055 * SIN[d] - s * 0.55, s * 1.1, s * 1.1);
        x = -0.055 * COS[d]; y = -0.055 * SIN[d];
        break;
      case 'tour':
        a = prog === undefined ? 0.5 : t * 0.02;
        c.strokeStyle = TRAIT; c.lineWidth = 0.07; c.lineCap = 'butt';
        c.beginPath();
        for (i = 0; i < 3; i++) { c.moveTo(x + 0.05 * Math.cos(a + i * 2.094), y + 0.05 * Math.sin(a + i * 2.094)); c.lineTo(x + 0.19 * Math.cos(a + i * 2.094), y + 0.19 * Math.sin(a + i * 2.094)); }
        c.stroke();
        c.fillStyle = TRAIT; disque(c, x, y, 0.045); c.fill();
        break;
      case 'assem':
        a = d * PI / 2 + (prog === undefined ? 2.4 : 2.4 + 1.5 * Math.sin(prog * PI * 4));
        c.strokeStyle = TRAIT; c.lineWidth = 0.13; c.lineCap = 'round';
        trait(c, x, y, x + 0.17 * Math.cos(a), y + 0.17 * Math.sin(a));
        c.strokeStyle = JAUNE; c.lineWidth = 0.085;
        trait(c, x, y, x + 0.17 * Math.cos(a), y + 0.17 * Math.sin(a));
        c.lineCap = 'butt';
        c.fillStyle = TRAIT; disque(c, x, y, 0.05); c.fill();
        break;
      default: return;
    }
    if (prog === undefined) return;
    c.strokeStyle = '#fff'; c.lineWidth = 0.05; c.lineCap = 'butt';
    c.beginPath(); c.arc(x, y, k === 'four' ? 0.215 : k === 'presse' ? 0.26 : 0.225, -PI / 2, -PI / 2 + prog * 2 * PI); c.stroke();
  }

  function palette(c, n) {
    var i;
    c.fillStyle = '#b08d5b'; c.strokeStyle = '#4a3319'; c.lineWidth = 0.025;
    c.beginPath(); c.rect(-0.4, -0.38, 0.8, 0.76); plein(c);
    c.strokeStyle = '#8a6a3c'; c.lineWidth = 0.02;
    for (i = -0.25; i < 0.3; i += 0.126) trait(c, -0.4, i, 0.4, i);
    c.strokeStyle = TRAIT; c.lineWidth = 0.028;
    if (n === 0) {
      c.fillStyle = '#9a7443'; c.beginPath(); c.rect(-0.31, -0.3, 0.62, 0.6); plein(c);
      c.lineWidth = 0.02; c.strokeStyle = '#5a3f1e';
      c.strokeRect(-0.24, -0.23, 0.48, 0.46); trait(c, -0.24, -0.23, 0.24, 0.23); trait(c, 0.24, -0.23, -0.24, 0.23);
    } else if (n === 1) {
      for (i = 0; i < 4; i++) {
        c.fillStyle = i === 2 ? '#c8281e' : '#2a5c96';
        disque(c, i & 1 ? 0.17 : -0.17, i & 2 ? 0.17 : -0.17, 0.155); plein(c);
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 0.02; disque(c, i & 1 ? 0.17 : -0.17, i & 2 ? 0.17 : -0.17, 0.1); c.stroke();
        c.strokeStyle = TRAIT; c.lineWidth = 0.028;
        c.fillStyle = TRAIT; disque(c, (i & 1 ? 0.17 : -0.17) + 0.05, (i & 2 ? 0.17 : -0.17) - 0.04, 0.022); c.fill();
      }
    } else {
      c.fillStyle = ACIER_C; c.beginPath(); c.rect(-0.34, -0.26, 0.68, 0.52); plein(c);
      c.fillStyle = ACIER; c.fillRect(-0.32, -0.24, 0.64, 0.1);
      c.fillStyle = TRAIT; c.fillRect(-0.2, -0.27, 0.05, 0.54); c.fillRect(0.15, -0.27, 0.05, 0.54);
    }
  }

  function vignette(k, f) {
    var e = document.createElement('canvas'), c, o = { forme: 0, cg: false, cd: false, rel: [0, 1, 2, 3], type: 'tout', f: f };
    e.width = e.height = 88;
    c = e.getContext('2d');
    c.translate(44, 44); c.scale(78, 78);
    bas(c, k, 0, o);
    if (k === 'tapis') { c.strokeStyle = '#8b9297'; c.lineWidth = 0.05; c.beginPath(); c.moveTo(-0.28, -0.13); c.lineTo(-0.15, 0); c.lineTo(-0.28, 0.13); c.moveTo(0.12, -0.13); c.lineTo(0.25, 0); c.lineTo(0.12, 0.13); c.stroke(); }
    haut(c, k, 0, o);
    organes(c, k, 0, undefined, 0);
    return e;
  }

  function silhouette(k) {
    var e = vignette(k, ''), c = e.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(0, 0, e.width, e.height);
    return e;
  }

  // ---------- Calques ----------
  // Chaque pièce fixe est dessinée une fois, à l'échelle courante, avec son ombre portée, puis tamponnée.
  // Pendant un zoom animé, les calques sont étirés ; ils sont refaits nets dès que l'échelle se pose.
  var calques = { z: 0, s: {} }, brouillon = [document.createElement('canvas'), document.createElement('canvas')];
  var OMBRE_BAS = [0.02, 0.035, 0.3], OMBRE_HAUT = [0.045, 0.07, 0.36], OMBRE_OBJET = [0.02, 0.03, 0.4], OMBRE_PONT = [0.07, 0.11, 0.42];
  var Z = 48, OX = 0, OY = 0, ECH = 1, LARG = 0, HAUT = 0;   // repère de l'image en cours, en pixels réels

  function calque(cle, ombre, fn) {
    var s = calques.s[cle], T, c, a, b;
    if (s) return s;
    T = Math.ceil(calques.z * 1.5);
    s = document.createElement('canvas'); s.width = s.height = T;
    a = brouillon[0]; b = brouillon[1];
    a.width = a.height = b.width = b.height = T;
    c = a.getContext('2d');
    c.translate(T / 2, T / 2); c.scale(calques.z, calques.z);
    fn(c);
    c = b.getContext('2d');
    c.drawImage(a, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = '#000'; c.fillRect(0, 0, T, T);
    c = s.getContext('2d');
    c.globalAlpha = ombre[2];
    c.drawImage(b, Math.max(1, Math.round(ombre[0] * calques.z)), Math.max(1, Math.round(ombre[1] * calques.z)));
    c.globalAlpha = 1;
    c.drawImage(a, 0, 0);
    calques.s[cle] = s;
    return s;
  }

  function tamponner(s, x, y, libre) {
    var t = s.width * ECH, px = OX + (x + 0.5) * Z - t / 2, py = OY + (y + 0.5) * Z - t / 2;
    if (px > LARG || py > HAUT || px + t < 0 || py + t < 0) return;
    if (ECH !== 1) ctx.drawImage(s, px, py, t, t);
    else if (libre) ctx.drawImage(s, px, py);
    else ctx.drawImage(s, Math.round(px), Math.round(py));
  }

  function calqueBas(k, d, o, cle) {
    return calque(cle, OMBRE_BAS, function (c) { bas(c, k, d, o); });
  }
  function calqueHaut(k, d, o, cle) {
    return calque(cle, k === 'pont' ? OMBRE_PONT : OMBRE_HAUT, function (c) { haut(c, k, d, o); });
  }
  function calqueObjet(k) {
    return calque('o|' + k, OMBRE_OBJET, function (c) { objet(c, k, 0, 0, 0.27); });
  }
  function calquePalette(n) {
    return calque('pal|' + n, OMBRE_HAUT, function (c) { palette(c, n); });
  }
  function cleDe(k, d, o) {
    return [k, d, o.forme, +o.cg, +o.cd, o.rel.join(''), o.type, o.f || '', o.seq ? o.seq.join('+') : ''].join('|');
  }

  // ---------- Scène ----------
  // Ce que le dessin doit savoir de la simulation, calculé une fois par construction.
  function occupe(x, y) {
    return x >= 0 && y >= 0 && x < S.w && y < S.h && !!S.cases[y * S.w + x];
  }

  function preparer() {
    var sc = scene = { bandes: [], aigs: [], hauts: [], machines: [], ponts: [], marques: [] };
    S.ents.forEach(function (e) {
      var a = e.am, o, d, cle;
      o = e.g = { forme: 0, cg: false, cd: false, rel: [], f: e.f, seq: null, t0: 0.08, t1: 0.95, type: '', prog: undefined };
      if (e.k === 'src') o.seq = e.seq.filter(function (x, i) { return e.seq.indexOf(x) === i; });
      if (e.k === 'out') o.type = e.veut ? Object.keys(e.veut).join('+') : e.benne ? 'benne' : 'tout';
      if (e.k === 'tapis') {
        o.forme = !a[0] && a[1] && !a[2] ? 1 : !a[0] && a[2] && !a[1] ? 2 : 0;
        o.cg = !o.forme && !!a[1]; o.cd = !o.forme && !!a[2];
      } else if (e.k === 'fus') {
        o.rel = [0];
        if (a[0]) o.rel.push(2);
        if (a[1]) o.rel.push(3);
        if (a[2]) o.rel.push(1);
      } else if (e.k === 'sep' || e.k === 'filtre') {
        o.rel = [2];
        e.vers.forEach(function (l) { o.rel.push((l.d - e.d) & 3); });
      }
      if (e.k === 'tapis' || e.k === 'pont') {
        // Les chevrons ne débordent de la case que là où une pièce voisine les recouvre.
        d = e.k === 'pont' ? (e.d + 1) & 3 : e.d;
        o.dv = d;
        if (occupe(e.x + DX[d], e.y + DY[d])) o.t1 = 1.05;
        d = (d + (o.forme === 1 ? 3 : o.forme === 2 ? 1 : 2)) & 3;
        if (occupe(e.x + DX[d], e.y + DY[d])) o.t0 = -0.05;
      }
      cle = cleDe(e.k, e.d, o);
      o.cb = 'b|' + cle; o.ch = 'h|' + cle;
      if (e.k === 'tapis' || e.k === 'pont') sc.bandes.push(e);
      else if (e.k === 'sep' || e.k === 'fus' || e.k === 'filtre' || e.k === 'out') sc.aigs.push(e);
      if (e.k !== 'tapis' && e.k !== 'sep' && e.k !== 'fus') sc.hauts.push(e);
      if (MACHINE[e.k]) sc.machines.push(e);
      if (e.k === 'pont') sc.ponts.push(e);
      if (e.k === 'src' || e.k === 'out') sc.marques.push(e);
    });
  }

  // Traces d'usage sur la dalle, propres à chaque atelier.
  function user() {
    var g = U.NIVEAUX.indexOf(niv) * 17 + 5, i, n = 6 + Math.round(niv.w * niv.h / 30);
    usure = [];
    for (i = 0; i < n; i++) {
      usure.push({ t: alea(g + i * 3) < 0.55 ? 0 : 1, x: alea(g + i * 7 + 1) * (niv.w + 2) - 1, y: alea(g + i * 11 + 2) * (niv.h + 2) - 1,
        r: 5 + alea(g + i * 13 + 3) * 9, a: alea(g + i * 5 + 4) * 2 * PI, l: 1.5 + alea(g + i * 19 + 6) * 3.5 });
    }
  }

  // ---------- Dessin du sol ----------
  var motifs = null, rayures = { s: 0, m: null }, fond = document.createElement('canvas'), cleFond = '';

  function grain(base, clair, sombre) {
    var e = document.createElement('canvas'), c, i;
    e.width = e.height = 160;
    c = e.getContext('2d');
    c.fillStyle = base; c.fillRect(0, 0, 160, 160);
    for (i = 0; i < 900; i++) {
      c.fillStyle = i % 3 ? sombre : clair;
      c.globalAlpha = 0.1 + Math.random() * 0.22;
      c.fillRect(Math.floor(Math.random() * 160), Math.floor(Math.random() * 160), 1 + (i % 7 === 0 ? 1 : 0), 1);
    }
    return ctx.createPattern(e, 'repeat');
  }

  function motifRayures() {
    var s = Math.max(6, Math.round(Z * 0.28)), e, c;
    if (rayures.s === s) return rayures.m;
    e = document.createElement('canvas'); e.width = e.height = s;
    c = e.getContext('2d');
    c.fillStyle = JAUNE; c.fillRect(0, 0, s, s);
    c.fillStyle = NOIR;
    poly(c, [0, 0, s / 2, 0, 0, s / 2]); c.fill();
    poly(c, [s, 0, s, s / 2, s / 2, s, 0, s]); c.fill();
    rayures.s = s; rayures.m = ctx.createPattern(e, 'repeat');
    return rayures.m;
  }

  // La dalle ne change que si la vue bouge : elle est peinte à part et recopiée telle quelle.
  function sol() {
    var cle = [niv.id, Z, OX, OY, LARG, HAUT].join('|'), ecran = ctx;
    if (cle !== cleFond) {
      cleFond = cle;
      if (fond.width !== LARG || fond.height !== HAUT) { fond.width = LARG; fond.height = HAUT; }
      ctx = fond.getContext('2d');
      peindreSol();
      ctx = ecran;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fond, 0, 0);
  }

  function peindreSol() {
    var w = niv.w, h = niv.h, fx = U.fixes(niv), dpr = vue.dpr, i, x, y, t, u, px, lw, k0, k1, b, n;
    if (!motifs) motifs = { clair: grain('#cfccc2', '#e4e1d8', '#8f8c82'), sombre: grain('#b7b4a9', '#cdcac0', '#7d7a70') };
    ctx.setTransform(1, 0, 0, 1, Math.round(OX), Math.round(OY));
    ctx.fillStyle = motifs.sombre; ctx.fillRect(-Math.round(OX), -Math.round(OY), LARG, HAUT);
    ctx.fillStyle = motifs.clair; ctx.fillRect(0, 0, w * Z, h * Z);

    // Traces de pneus et taches.
    ctx.lineCap = 'round';
    for (i = 0; i < usure.length; i++) {
      u = usure[i];
      if (u.t === 0) {
        // Deux traces de roues parallèles, à peine courbes.
        t = u.l / u.r / 2; x = (u.x + u.r * Math.cos(u.a)) * Z; y = (u.y + u.r * Math.sin(u.a)) * Z;
        ctx.strokeStyle = 'rgba(40,38,34,.055)'; ctx.lineWidth = Z * 0.11;
        ctx.beginPath(); ctx.arc(x, y, u.r * Z, u.a + PI - t, u.a + PI + t); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, (u.r + 0.46) * Z, u.a + PI - t, u.a + PI + t); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(70,55,35,.035)';
        ctx.beginPath(); ctx.ellipse(u.x * Z, u.y * Z, u.l * Z * 0.2, u.l * Z * 0.13, u.a, 0, 2 * PI); ctx.fill();
        ctx.beginPath(); ctx.ellipse((u.x + 0.1) * Z, (u.y + 0.05) * Z, u.l * Z * 0.11, u.l * Z * 0.08, u.a, 0, 2 * PI); ctx.fill();
      }
    }
    ctx.lineCap = 'butt';

    // Quadrillage discret des cases, puis joints de dilatation toutes les quatre cases, sur toute la dalle.
    ctx.strokeStyle = Z < 22 * dpr ? 'rgba(60,56,48,.1)' : 'rgba(60,56,48,.17)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (x = 1; x < w; x++) if (x % 4) { px = Math.round(x * Z) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, h * Z); }
    for (y = 1; y < h; y++) if (y % 4) { px = Math.round(y * Z) + 0.5; ctx.moveTo(0, px); ctx.lineTo(w * Z, px); }
    ctx.stroke();
    lw = Math.max(1, Math.round(Z * 0.03));
    for (t = 0; t < 2; t++) {
      ctx.strokeStyle = t ? 'rgba(255,255,255,.4)' : '#8d8a80'; ctx.lineWidth = t ? 1 : lw;
      ctx.beginPath();
      k0 = Math.floor(-OX / Z / 4); k1 = Math.ceil((LARG - OX) / Z / 4);
      for (x = k0; x <= k1; x++) { px = Math.round(x * 4 * Z) + (t ? lw / 2 + 0.5 : 0) + (lw & 1 ? 0.5 : 0); ctx.moveTo(px, -OY); ctx.lineTo(px, HAUT - OY); }
      k0 = Math.floor(-OY / Z / 4); k1 = Math.ceil((HAUT - OY) / Z / 4);
      for (y = k0; y <= k1; y++) { px = Math.round(y * 4 * Z) + (t ? lw / 2 + 0.5 : 0) + (lw & 1 ? 0.5 : 0); ctx.moveTo(-OX, px); ctx.lineTo(LARG - OX, px); }
      ctx.stroke();
    }

    // Marquage : la travée est cernée d'une bande jaune, écaillée par endroits.
    lw = Math.max(2, Math.round(Z * 0.085));
    ctx.strokeStyle = PEINT; ctx.lineWidth = lw;
    ctx.strokeRect(-lw * 1.1, -lw * 1.1, w * Z + lw * 2.2, h * Z + lw * 2.2);
    ctx.fillStyle = motifs.sombre;
    n = 2 * (w + h);
    for (i = 0; i < n; i++) {
      t = alea(i * 3.7 + w) * (w + h) * 2; u = (0.06 + alea(i * 9.1) * 0.16) * Z;
      if (alea(i * 5.3 + h) < 0.45) continue;
      if (t < w) ctx.fillRect(t * Z, -lw * 1.7, u, lw * (0.4 + alea(i) * 0.8));
      else if (t < 2 * w) ctx.fillRect((t - w) * Z, h * Z + lw * 0.5, u, lw * (0.4 + alea(i) * 0.8));
      else if (t < 2 * w + h) ctx.fillRect(-lw * 1.7, (t - 2 * w) * Z, lw * (0.4 + alea(i) * 0.8), u);
      else ctx.fillRect(w * Z + lw * 0.5, (t - 2 * w - h) * Z, lw * (0.4 + alea(i) * 0.8), u);
    }

    // Repères de travée au pochoir : lettres en haut, chiffres à gauche.
    if (Z >= 20 * dpr) {
      px = Math.max(10 * dpr, Math.min(Z * 0.34, 26 * dpr));
      ctx.font = '700 ' + px + 'px ' + POLICE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(38,40,42,.62)';
      t = lw * 1.7 + px * 0.75;
      for (x = 0; x < w; x++) ctx.fillText(String.fromCharCode(65 + x % 26), (x + 0.5) * Z, -t);
      for (y = 0; y < h; y++) ctx.fillText(String(y + 1), -t, (y + 0.5) * Z);
      ctx.fillStyle = motifs.sombre;
      u = Math.max(1, px * 0.1);
      for (x = 0; x < w; x++) ctx.fillRect((x + 0.5) * Z - u / 2, -t - px * 0.6, u, px * 1.2);
      for (y = 0; y < h; y++) ctx.fillRect(-t - px * 0.7, (y + 0.5) * Z - u / 2 + px * 0.04, px * 1.4, u);
    }

    // Zones de stockage : interdites, bordées de noir et jaune, encombrées de palettes.
    b = Math.max(3, Math.round(Z * 0.13));
    for (i = 0; i < w * h; i++) {
      if (fx[i] !== 'mur') continue;
      x = i % w; y = (i - x) / w;
      ctx.fillStyle = 'rgba(58,66,74,.3)'; ctx.fillRect(Math.round(x * Z), Math.round(y * Z), Math.ceil(Z), Math.ceil(Z));
    }
    ctx.fillStyle = motifRayures();
    for (i = 0; i < w * h; i++) {
      if (fx[i] !== 'mur') continue;
      x = i % w; y = (i - x) / w;
      px = Math.round(x * Z); t = Math.round(y * Z); u = Math.round((x + 1) * Z) - px; n = Math.round((y + 1) * Z) - t;
      if (x === 0 || fx[i - 1] !== 'mur') ctx.fillRect(px, t, b, n);
      if (x === w - 1 || fx[i + 1] !== 'mur') ctx.fillRect(px + u - b, t, b, n);
      if (y === 0 || fx[i - w] !== 'mur') ctx.fillRect(px, t, u, b);
      if (y === h - 1 || fx[i + w] !== 'mur') ctx.fillRect(px, t + n - b, u, b);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (i = 0; i < w * h; i++) {
      if (fx[i] !== 'mur') continue;
      n = Math.floor(alea(i * 2.3 + w * 7) * 4);
      if (n < 3) tamponner(calquePalette(n), i % w, (i - i % w) / w);
    }
  }

  // ---------- Dessin de la scène ----------
  // Chevrons d'une bande, ajoutés au tracé courant. Ils défilent d'une case par pas de simulation.
  function chevrons(e, d, forme, t0, t1, phase) {
    var cx = OX + (e.x + 0.5) * Z, cy = OY + (e.y + 0.5) * Z, c = COS[d] * Z, s = SIN[d] * Z, k, t, ux, uy, a, ca, sa, j, lx, ly;
    var PX = [-0.08, 0.05, -0.08], PY = [-0.13, 0, 0.13];
    if (cx < -Z || cy < -Z || cx > LARG + Z || cy > HAUT + Z) return;
    for (k = -1; k < 3; k++) {
      t = k * 0.5 + phase;
      if (t < t0 || t > t1) continue;
      if (forme === 0 || t > 1) { ux = -0.5 + t; uy = 0; a = 0; }
      else if (t < 0) { ux = 0; uy = forme === 1 ? -0.5 + t : 0.5 - t; a = forme === 1 ? PI / 2 : -PI / 2; }
      else if (forme === 1) { a = PI - t * PI / 2; ux = 0.5 + 0.5 * Math.cos(a); uy = -0.5 + 0.5 * Math.sin(a); a -= PI / 2; }
      else { a = PI + t * PI / 2; ux = 0.5 + 0.5 * Math.cos(a); uy = 0.5 + 0.5 * Math.sin(a); a += PI / 2; }
      ca = Math.cos(a); sa = Math.sin(a);
      for (j = 0; j < 3; j++) {
        lx = ux + PX[j] * ca - PY[j] * sa; ly = uy + PX[j] * sa + PY[j] * ca;
        if (j) ctx.lineTo(cx + lx * c - ly * s, cy + lx * s + ly * c); else ctx.moveTo(cx + lx * c - ly * s, cy + lx * s + ly * c);
      }
    }
  }

  var passeHaute = false;
  function unObjet(it, e, tablier) {
    var x = e.x, y = e.y, dessus;
    if (!it) return;
    dessus = tablier || (it.h && it.m === S.pas && alpha < 1);
    if (dessus !== passeHaute) return;
    if (it.m === S.pas && alpha < 1) { x = it.fx + (x - it.fx) * alpha; y = it.fy + (y - it.fy) * alpha; }
    tamponner(calqueObjet(it.k), x, y, true);
  }

  function lesObjets(hautes) {
    var i, e, a, t;
    passeHaute = hautes;
    for (i = 0; i < S.ents.length; i++) {
      e = S.ents[i];
      if (MACHINE[e.k] || e.k === 'src') continue;
      unObjet(e.it, e, e.k === 'pont');
      unObjet(e.it2, e, false);
    }
    if (hautes || alpha >= 1) return;
    // Objets avalés pendant ce pas : ils glissent vers la pièce et s'effacent.
    for (i = 0; i < S.anims.length; i++) {
      a = S.anims[i];
      t = alpha;
      ctx.globalAlpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
      tamponner(calqueObjet(a.k), a.fx + (a.x - a.fx) * t, a.fy + (a.y - a.fy) * t, true);
    }
    ctx.globalAlpha = 1;
  }

  // Signalétique : triangle jaune de danger pour ce qui est bloqué, rond bleu d'obligation pour ce qu'il faut alimenter.
  function panneau(e, danger) {
    var r = Math.max(7.5 * vue.dpr, Z * 0.2), x = OX + e.x * Z + r * 0.95, y = OY + e.y * Z + r * 0.95;
    ctx.lineJoin = 'round';
    if (danger) {
      ctx.fillStyle = ctx.strokeStyle = NOIR; ctx.lineWidth = r * 0.3;
      poly(ctx, [x, y - r * 0.85, x + r * 0.95, y + r * 0.75, x - r * 0.95, y + r * 0.75]); plein(ctx);
      ctx.fillStyle = JAUNE;
      poly(ctx, [x, y - r * 0.62, x + r * 0.74, y + r * 0.62, x - r * 0.74, y + r * 0.62]); ctx.fill();
      ctx.fillStyle = NOIR;
      ctx.fillRect(x - r * 0.11, y - r * 0.27, r * 0.22, r * 0.5); ctx.fillRect(x - r * 0.11, y + r * 0.32, r * 0.22, r * 0.2);
    } else {
      ctx.fillStyle = '#fff'; disque(ctx, x, y, r * 1.08); ctx.fill();
      ctx.fillStyle = '#1f5fa8'; disque(ctx, x, y, r * 0.95); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - r * 0.12, y - r * 0.62, r * 0.24, r * 0.5);
      poly(ctx, [x - r * 0.38, y - r * 0.18, x + r * 0.38, y - r * 0.18, x, y + r * 0.26]); ctx.fill();
      ctx.fillRect(x - r * 0.5, y + r * 0.38, r, r * 0.2);
    }
  }

  // Afficheur de cadence. Il garde une taille lisible à tout zoom ; trop grand pour la case, il sort de la travée.
  function etiquette(e, texte, couleur) {
    var dpr = vue.dpr, px = borne(Z * 0.2, 11 * dpr, 15 * dpr), l = texte.length * px * 0.5 + px * 0.8, h = px * 1.3;
    var x = OX + (e.x + 0.5) * Z, y = OY + (e.y + 1) * Z - h * 0.5 - Z * 0.03;
    if (l > Z * 0.96) {
      if (e.x === 0) { x = OX - l / 2 - Z * 0.2; y = OY + (e.y + 0.5) * Z; }
      else if (e.x === niv.w - 1) { x = OX + niv.w * Z + l / 2 + Z * 0.2; y = OY + (e.y + 0.5) * Z; }
      else if (e.y === 0) y = OY - h / 2 - Z * 0.2;
      else if (e.y === niv.h - 1) y = OY + niv.h * Z + h / 2 + Z * 0.2;
      else y = OY + (e.y + 1) * Z;
    }
    x = Math.round(x - l / 2); y = Math.round(y - h / 2); l = Math.round(l); h = Math.round(h);
    ctx.fillStyle = '#101214'; ctx.fillRect(x, y, l, h);
    ctx.strokeStyle = '#7b8286'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, l - 1, h - 1);
    ctx.font = '600 ' + px + 'px ' + POLICE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = couleur;
    ctx.fillText(texte, x + l / 2, y + h / 2 + px * 0.07);
  }

  function fantome(x, y) {
    var o = { forme: 0, cg: false, cd: false, rel: [0, 1, 2, 3], type: 'tout', f: outil === 'filtre' || outil === 'src' ? objF : '', seq: null };
    var cle = 'f|' + cleDe(outil, dir, o);
    ctx.globalAlpha = 0.62;
    if (outil !== 'src' && !MACHINE[outil] && outil !== 'broyeur') tamponner(calqueBas(outil, dir, o, 'b|' + cle), x, y);
    if (outil !== 'tapis' && outil !== 'sep' && outil !== 'fus') tamponner(calqueHaut(outil, dir, o, 'h|' + cle), x, y);
    if (MACHINE[outil]) {
      ctx.setTransform(Z, 0, 0, Z, OX + (x + 0.5) * Z, OY + (y + 0.5) * Z);
      organes(ctx, outil, dir, undefined, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
    if (outil === 'tapis') {
      ctx.beginPath(); chevrons({ x: x, y: y }, dir, 0, 0.08, 0.95, 0.27);
      ctx.strokeStyle = '#c9cfd3'; ctx.lineWidth = Z * 0.055; ctx.stroke();
    }
  }

  function dessiner() {
    var dpr = vue.dpr, sc = scene, i, e, o, t, c, ok, x, y, lw;
    var phase = pause ? 0 : alpha % 1;
    Z = vue.z * dpr; OX = vue.ox * dpr; OY = vue.oy * dpr; LARG = cv.width; HAUT = cv.height;
    if (vue.z === vue.zc && calques.z !== Z) { calques.z = Z; calques.s = {}; }
    if (!calques.z) calques.z = Z;
    ECH = Z / calques.z;
    if ('fontStretch' in ctx) ctx.fontStretch = 'condensed';

    sol();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';

    for (i = 0; i < sc.bandes.length; i++) { e = sc.bandes[i]; tamponner(calqueBas(e.k, e.d, e.g, e.g.cb), e.x, e.y); }
    ctx.beginPath();
    for (i = 0; i < sc.bandes.length; i++) { e = sc.bandes[i]; o = e.g; chevrons(e, o.dv, o.forme, o.t0, o.t1, phase); }
    ctx.strokeStyle = '#8b9297'; ctx.lineWidth = Z * 0.05; ctx.stroke();
    for (i = 0; i < sc.aigs.length; i++) { e = sc.aigs[i]; tamponner(calqueBas(e.k, e.d, e.g, e.g.cb), e.x, e.y); }
    lesObjets(false);
    for (i = 0; i < sc.hauts.length; i++) { e = sc.hauts[i]; tamponner(calqueHaut(e.k, e.d, e.g, e.g.ch), e.x, e.y); }

    for (i = 0; i < sc.machines.length; i++) {
      e = sc.machines[i];
      x = OX + (e.x + 0.5) * Z; y = OY + (e.y + 0.5) * Z;
      if (x < -Z || y < -Z || x > LARG + Z || y > HAUT + Z) continue;
      t = e.rec ? 1 - (e.t - (pause ? 0 : Math.min(1, alpha) - 1)) / e.rec.t : undefined;
      if (t !== undefined) t = borne(t, 0, 1);
      if (e.rec && e.t === 0) t = undefined;
      ctx.setTransform(Z, 0, 0, Z, x, y);
      organes(ctx, e.k, e.d, t, pause ? 0 : temps);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (sc.ponts.length) {
      ctx.beginPath();
      for (i = 0; i < sc.ponts.length; i++) chevrons(sc.ponts[i], sc.ponts[i].d, 0, 0.08, 0.95, phase);
      ctx.strokeStyle = '#b4babf'; ctx.lineWidth = Z * 0.05; ctx.stroke();
    }
    lesObjets(true);

    // Diagnostic et afficheurs.
    for (i = 0; i < S.ents.length; i++) {
      e = S.ents[i];
      if (MACHINE[e.k]) { if (e.att >= ALERTE) panneau(e, e.etat === 'bloquee'); }
      else if (e.k === 'src') { if (e.att >= ALERTE) panneau(e, true); }
      else if ((e.k === 'filtre' || e.k === 'sep') && coince(e)) panneau(e, true);
    }
    for (i = 0; i < sc.marques.length; i++) {
      e = sc.marques[i];
      if (e.k === 'src') etiquette(e, Math.round(240 / e.p) + '/min', '#ffcf3a');
      else if (e.veut) {
        t = []; ok = true;
        for (c in e.veut) { t.push((e.taux[c] || 0) + '/' + e.veut[c]); if ((e.taux[c] || 0) < e.veut[c]) ok = false; }
        etiquette(e, t.join(' '), ok ? '#74e58a' : '#ffb836');
      } else {
        t = 0;
        for (c in e.taux) t += e.taux[c];
        etiquette(e, t + '/min', '#d6dbde');
      }
    }

    // Case survolée et pièce fantôme.
    if (survol && survol.dans) {
      x = Math.round(OX + survol.x * Z); y = Math.round(OY + survol.y * Z); t = Math.round(Z);
      lw = Math.max(2, Math.round(2.5 * dpr));
      c = '#1f5fa8'; ok = true;
      if (outil && outil !== 'pipette' && outil !== 'gomme') {
        ok = U.posable(niv, survol.x, survol.y, outil);
        if (!geste) fantome(survol.x, survol.y);
        if (!ok) c = '#c8281e';
      } else if (outil === 'gomme') c = '#c8281e';
      else if (!outil) c = '#3d4347';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = lw + 2; ctx.strokeRect(x + lw / 2, y + lw / 2, t - lw, t - lw);
      ctx.strokeStyle = c; ctx.lineWidth = lw;
      if (outil === 'pipette') ctx.setLineDash([lw * 3, lw * 2]);
      ctx.strokeRect(x + lw / 2, y + lw / 2, t - lw, t - lw);
      ctx.setLineDash([]);
      if (!ok || outil === 'gomme') { ctx.beginPath(); ctx.moveTo(x + t * 0.25, y + t * 0.25); ctx.lineTo(x + t * 0.75, y + t * 0.75); ctx.moveTo(x + t * 0.75, y + t * 0.25); ctx.lineTo(x + t * 0.25, y + t * 0.75); ctx.stroke(); }
    }
  }

  // Un séparateur ou un filtre qui garde son objet depuis longtemps.
  function coince(e) {
    return !!e.it && S.pas - e.it.m >= ALERTE;
  }

  // ---------- Vue ----------
  function taille() {
    var r = $('#cadre').getBoundingClientRect(), neuf = !vue.l;
    vue.dpr = window.devicePixelRatio || 1;
    vue.l = Math.max(100, r.width); vue.h = Math.max(100, r.height);
    cv.width = Math.round(vue.l * vue.dpr); cv.height = Math.round(vue.h * vue.dpr);
    if (neuf && niv) cadrer(); else if (niv) borner();
  }
  // Échelle qui montre toute la travée, repères et afficheurs compris.
  function ajuste() {
    return Math.min((vue.l - 150) / niv.w, (vue.h - 96) / niv.h);
  }
  function zmin() { return borne(Math.floor(ajuste() * 0.5), 12, 40); }
  function poserVue(z) {
    vue.z = Math.round(z * vue.dpr) / vue.dpr;
  }
  function cadrer() {
    poserVue(borne(Math.floor(ajuste()), 12, 84));
    vue.zc = vue.z;
    vue.ox = Math.round((vue.l - niv.w * vue.z) / 2);
    vue.oy = Math.round((vue.h - niv.h * vue.z) / 2 + 6);
  }
  // Le centre de la vue ne quitte pas la travée de plus d'une case.
  function borner() {
    vue.ox = borne(vue.ox, vue.l / 2 - (niv.w + 1) * vue.z, vue.l / 2 + vue.z);
    vue.oy = borne(vue.oy, vue.h / 2 - (niv.h + 1) * vue.z, vue.h / 2 + vue.z);
  }
  function zoomer(f, px, py) {
    vue.zc = borne(vue.zc * f, zmin(), ZMAX);
    vue.ax = px; vue.ay = py;
  }
  // Rapproche l'échelle de sa cible en gardant fixe le point sous le curseur.
  function animerVue(dt) {
    var z;
    if (vue.z === vue.zc) return;
    z = vue.z + (vue.zc - vue.z) * (1 - Math.exp(-dt / 50));
    if (Math.abs(vue.zc - z) < 0.004 * vue.zc) {
      z = Math.round(vue.zc * vue.dpr) / vue.dpr;
      vue.zc = z;
    }
    vue.ox = vue.ax - (vue.ax - vue.ox) * z / vue.z;
    vue.oy = vue.ay - (vue.ay - vue.oy) * z / vue.z;
    vue.z = z;
    if (z === vue.zc) { vue.ox = Math.round(vue.ox * vue.dpr) / vue.dpr; vue.oy = Math.round(vue.oy * vue.dpr) / vue.dpr; }
    borner();
  }
  function caseDe(ev) {
    var r = cv.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    var x = Math.floor((px - vue.ox) / vue.z), y = Math.floor((py - vue.oy) / vue.z);
    return { x: x, y: y, px: px, py: py, dans: x >= 0 && y >= 0 && x < niv.w && y < niv.h };
  }

  // ---------- Gestes ----------
  function poserIci(c) {
    return U.poser(plan, niv, c.x, c.y, outil, dir, objF, per);
  }

  // Trace des tapis de la dernière case à la case c, chacun tourné vers le suivant.
  function tracer(c) {
    var a = geste.der, dx, dy, d, p, change = false;
    while (a.x !== c.x || a.y !== c.y) {
      dx = c.x - a.x; dy = c.y - a.y;
      d = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      p = a.x >= 0 && a.y >= 0 && a.x < niv.w && a.y < niv.h ? plan.c[a.y * niv.w + a.x] : null;
      if (p && p.k === 'tapis' && p.d !== d) { p.d = d; change = true; }
      a = { x: a.x + DX[d], y: a.y + DY[d] };
      p = a.x >= 0 && a.y >= 0 && a.x < niv.w && a.y < niv.h ? plan.c[a.y * niv.w + a.x] : null;
      // Un tapis déjà là garde son sens tant que le tracé ne le quitte pas : on peut finir dessus pour s'y déverser.
      if (!p && U.poser(plan, niv, a.x, a.y, 'tapis', d)) change = true;
      dir = d;
    }
    geste.der = a;
    return change;
  }

  function finGeste() {
    if (geste && geste.avant !== undefined && U.noter(hist, geste.avant, plan)) enregistrer();
    geste = null;
    curseur();
  }

  function pipette(c) {
    var p = c && c.dans ? plan.c[c.y * niv.w + c.x] : null;
    if (p) {
      outil = p.k; dir = p.d;
      if (p.f) objF = p.f;
      if (p.p) per = p.p;
    } else outil = null;
    majOutils();
  }

  function tourner(sens) {
    var p = survol && survol.dans ? plan.c[survol.y * niv.w + survol.x] : null;
    if (!outil && p) { modifier(function () { p.d = (p.d + sens) & 3; }); return; }
    dir = (dir + sens) & 3;
    majOutils();
  }

  function choisirObjet(k) {
    var p = survol && survol.dans ? plan.c[survol.y * niv.w + survol.x] : null;
    objF = k;
    if (p && (p.k === 'filtre' || p.k === 'src') && (!outil || outil === p.k)) modifier(function () { p.f = k; });
    majOutils();
  }

  function curseur() {
    cv.style.cursor = geste && geste.type === 'vue' ? 'grabbing' : outil ? 'crosshair' : 'grab';
  }

  cv.addEventListener('pointerdown', function (ev) {
    var c = caseDe(ev);
    ev.preventDefault();
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* pointeur déjà relâché */ }
    survol = c;
    if (ev.button === 1 || (ev.button === 0 && (ev.shiftKey || !outil))) {
      geste = { type: 'vue', x: ev.clientX, y: ev.clientY };
      curseur();
      return;
    }
    if (ev.button === 2 || (ev.button === 0 && outil === 'gomme')) {
      geste = { type: 'gomme', avant: U.coder(plan) };
      if (U.oter(plan, c.x, c.y)) reconstruire();
      return;
    }
    if (ev.button !== 0) return;
    if (outil === 'pipette') { pipette(c); return; }
    geste = { type: 'pose', avant: U.coder(plan), der: c };
    if (poserIci(c)) reconstruire();
  });

  cv.addEventListener('pointermove', function (ev) {
    var c = caseDe(ev);
    souris = c; survol = c;
    if (!geste) return;
    if (geste.type === 'vue') {
      vue.ox += ev.clientX - geste.x; vue.oy += ev.clientY - geste.y;
      geste.x = ev.clientX; geste.y = ev.clientY;
      borner();
    } else if (geste.type === 'gomme') {
      if (U.oter(plan, c.x, c.y)) reconstruire();
    } else if (outil === 'tapis') {
      if (tracer(c)) reconstruire();
      majOutils();
    }
  });

  function lacher() { finGeste(); }
  cv.addEventListener('pointerup', lacher);
  cv.addEventListener('pointercancel', lacher);
  cv.addEventListener('pointerleave', function () { if (!geste) { survol = null; souris = null; } });
  cv.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  // Le clic du milieu déplace la vue : pas de défilement automatique du navigateur.
  cv.addEventListener('mousedown', function (ev) { if (ev.button === 1) ev.preventDefault(); });
  cv.addEventListener('auxclick', function (ev) { ev.preventDefault(); });
  cv.addEventListener('wheel', function (ev) {
    var c = caseDe(ev), dy = ev.deltaY * (ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 300 : 1);
    ev.preventDefault();
    if (!dy) return;
    zoomer(Math.exp(-borne(dy, -300, 300) * (ev.ctrlKey ? 0.01 : 0.0015)), c.px, c.py);
  }, { passive: false });

  document.addEventListener('keydown', function (ev) {
    var k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key, n, v;
    if (!$('#niveaux').hidden || !$('#aide').hidden) {
      if (k === 'Escape') fermer();
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); annuler(); }
      else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); retablir(); }
      return;
    }
    if (ev.altKey) return;
    n = /^Digit(\d)$/.exec(ev.code);
    if (n) {
      v = niv.pieces[(+n[1] + 9) % 10];
      if (v) { outil = v; majOutils(); }
      return;
    }
    switch (k) {
      case 'r': tourner(ev.shiftKey ? 3 : 1); break;
      case 'q': pipette(survol); break;
      case 'g': outil = outil === 'gomme' ? null : 'gomme'; majOutils(); break;
      case 'f':
        if (objetsNiv.length) choisirObjet(objetsNiv[(objetsNiv.indexOf(objF) + 1) % objetsNiv.length]);
        break;
      case 'Escape': outil = null; majOutils(); break;
      case 'Delete': case 'Backspace':
        if (survol && survol.dans) modifier(function () { U.oter(plan, survol.x, survol.y); });
        break;
      case ' ': ev.preventDefault(); basculerPause(); break;
      case 'n': case '.': unPas(); break;
      case 'c': cadrer(); break;
      case '+': case '=': zoomer(1.25, souris ? souris.px : vue.l / 2, souris ? souris.py : vue.h / 2); break;
      case '-': zoomer(0.8, souris ? souris.px : vue.l / 2, souris ? souris.py : vue.h / 2); break;
    }
  });

  // ---------- Commandes ----------
  function annuler() {
    var p = U.annuler(hist, niv, plan);
    if (p) { plan = p; reconstruire(); enregistrer(); }
  }
  function retablir() {
    var p = U.retablir(hist, niv, plan);
    if (p) { plan = p; reconstruire(); enregistrer(); }
  }
  function basculerPause() { pause = !pause; acc = 0; alpha = 1; majOutils(); }
  function unPas() { pause = true; acc = 0; alpha = 1; pas(); majOutils(); }
  function fermer() { $('#niveaux').hidden = true; $('#aide').hidden = true; }
  function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }

  // Le planning : une ligne par ordre de fabrication.
  function ouvrirNiveaux() {
    var g = $('#grille');
    g.textContent = '';
    U.NIVEAUX.concat([U.BAC]).forEach(function (n, i) {
      var b = document.createElement('button'), rec = sauve.records[n.id], libre = n.bac || ouvert(i), t = [], l = [], c;
      function cellule(cls, texte) { var s = document.createElement('span'); s.className = cls; s.textContent = texte; b.appendChild(s); return s; }
      b.type = 'button'; b.className = 'of' + (n === niv ? ' ici' : ''); b.disabled = !libre;
      b.dataset.niv = n.id;
      if (rec && rec.e) {
        if (n.paliers.some(function (p) { return p.debit !== undefined; })) t.push('débit ' + rec.debit);
        t.push('coût ' + rec.cout, 'emprise ' + rec.emprise);
      }
      n.sorties.forEach(function (s) { for (var k in s.veut) l.push(s.veut[k] + ' ' + OBJETS[k].pluriel); });
      cellule('n', n.bac ? '' : deuxChiffres(i + 1));
      c = cellule('des', '');
      c.appendChild(document.createElement('b')).textContent = n.nom;
      c.appendChild(document.createElement('small')).textContent = n.idee;
      cellule('qte', n.bac ? 'Rien à livrer' : l.join(', '));
      cellule('etoiles', n.bac ? '' : etoiles(rec ? rec.e : 0));
      cellule('recs', t.join(', '));
      cellule('aimant' + (n.bac ? '' : rec && rec.e ? ' fait' : libre ? ' lance' : ''), n.bac ? 'Libre' : rec && rec.e ? 'Livré' : libre ? 'À lancer' : 'En attente');
      g.appendChild(b);
    });
    $('#niveaux').hidden = false;
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'), i;
    if (!b) return;
    if (b.dataset.niv) { fermer(); charger(trouver(b.dataset.niv)); return; }
    if (b.dataset.piece) { outil = outil === b.dataset.piece ? null : b.dataset.piece; majOutils(); return; }
    if (b.dataset.objet) { choisirObjet(b.dataset.objet); return; }
    if (b.dataset.per) { per = +b.dataset.per; majOutils(); return; }
    if (b.dataset.vit) { vit = +b.dataset.vit; sauve.vit = vit; ecrireSauve(); majOutils(); return; }
    switch (b.dataset.act) {
      case 'niveaux': ouvrirNiveaux(); break;
      case 'bac': fermer(); charger(U.BAC); break;
      case 'aide': $('#aide').hidden = false; break;
      case 'fermer': fermer(); sauve.aide = true; ecrireSauve(); break;
      case 'pipette': outil = outil === 'pipette' ? null : 'pipette'; majOutils(); break;
      case 'gomme': outil = outil === 'gomme' ? null : 'gomme'; majOutils(); break;
      case 'tourner': dir = (dir + 1) & 3; majOutils(); break;
      case 'annuler': annuler(); break;
      case 'retablir': retablir(); break;
      case 'vider': modifier(function () { plan = U.planVide(niv); }); break;
      case 'meilleur': modifier(function () { plan = U.decoder(niv, sauve.records[niv.id].plan); }); break;
      case 'pause': basculerPause(); break;
      case 'pas': unPas(); break;
      case 'relancer': reconstruire(); break;
      case 'cadrer': cadrer(); break;
      case 'zoomPlus': zoomer(1.3, vue.l / 2, vue.h / 2); break;
      case 'zoomMoins': zoomer(1 / 1.3, vue.l / 2, vue.h / 2); break;
      case 'suivant':
        i = U.NIVEAUX.indexOf(niv);
        if (U.NIVEAUX[i + 1]) charger(U.NIVEAUX[i + 1]);
        break;
    }
    b.blur();
  });

  window.addEventListener('hashchange', function () {
    var n = trouver(decodeURIComponent(location.hash.slice(1)));
    if (n && n !== niv) charger(n);
  });
  window.addEventListener('resize', taille);

  // ---------- Poste de travail ----------
  // Monte tout ce qui ne dépend que du niveau : bon de fabrication, magasin, gamme.
  function monter() {
    var i = U.NIVEAUX.indexOf(niv), pal = $('#palette'), rec = $('#recettes'), obj = $('#objectifs');
    $('#num').textContent = niv.bac ? 'Atelier libre' : 'Commande ' + (i + 1) + ' sur ' + U.NIVEAUX.length;
    $('#nom').textContent = niv.nom;
    $('#ref').textContent = niv.bac ? 'Libre' : 'OF n° ' + deuxChiffres(i + 1);
    $('#idee').textContent = niv.idee;
    $('#texte').textContent = niv.texte;
    $('#blocObjectifs').hidden = !!niv.bac;
    $('#mDebit').hidden = !!niv.bac;

    pal.textContent = '';
    niv.pieces.forEach(function (k, j) {
      var b = document.createElement('button'), n = document.createElement('i'), c = document.createElement('u'), s = document.createElement('span');
      b.type = 'button'; b.className = 'piece'; b.dataset.piece = k; b.title = PIECES[k].info;
      n.textContent = j < 10 ? String((j + 1) % 10) : '';
      c.textContent = PIECES[k].cout ? PIECES[k].cout : '';
      c.hidden = !PIECES[k].cout;
      s.textContent = PIECES[k].nom;
      b.appendChild(n); b.appendChild(c); b.appendChild(vignette(k, k === 'src' ? 'mf' : k === 'filtre' ? 'en' : '')); b.appendChild(s);
      pal.appendChild(b);
    });

    // Les pièces absentes de cette commande ne laissent au panneau que leur silhouette peinte.
    U.BAC.pieces.forEach(function (k) {
      var d, s;
      if (PIECES[k].cout === 0 || niv.pieces.indexOf(k) >= 0) return;
      d = document.createElement('div'); s = document.createElement('span');
      d.className = 'piece absente'; d.title = PIECES[k].nom + ' : pas dans cette commande';
      s.textContent = PIECES[k].nom;
      d.appendChild(silhouette(k)); d.appendChild(s);
      pal.appendChild(d);
    });

    rec.textContent = '';
    U.RECETTES.forEach(function (r) {
      var li, k, n, em, sp, sm;
      if (niv.pieces.indexOf(r.m) < 0) return;
      for (k in r.e) if (objetsNiv.indexOf(k) < 0) return;
      li = document.createElement('li');
      em = document.createElement('em'); em.textContent = PIECES[r.m].nom; li.appendChild(em);
      for (k in r.e) for (n = 0; n < r.e[k]; n++) li.appendChild(icone(k, 10));
      sp = document.createElement('span'); sp.textContent = '→'; li.appendChild(sp);
      r.s.forEach(function (s) { li.appendChild(icone(s, 10)); });
      sm = document.createElement('small'); sm.textContent = (r.t / U.PAS_SEC + ' s').replace('.', ',') + ', ' + Math.round(240 / r.t) + ' par min';
      li.appendChild(sm);
      rec.appendChild(li);
    });
    rec.parentNode.hidden = !rec.children.length;

    obj.textContent = '';
    if (!niv.bac) {
      ['Livrer ' + texteBesoins(0)].concat(niv.paliers.map(textePalier)).forEach(function (t, j) {
        var li = document.createElement('li'), k = document.createElement('i'), b = document.createElement('b'), s = document.createElement('span');
        k.className = 'case';
        b.textContent = '★★★'.slice(0, j + 1); s.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        li.appendChild(k); li.appendChild(b); li.appendChild(s);
        obj.appendChild(li);
      });
    }
    majOutils();
    memo = {};
  }

  function majOutils() {
    var ch = $('#choix'), montre = outil === 'filtre' || outil === 'src', l;
    [].forEach.call(document.querySelectorAll('.piece'), function (b) { b.classList.toggle('actif', b.dataset.piece === outil); });
    [].forEach.call(document.querySelectorAll('[data-vit]'), function (b) { b.classList.toggle('actif', +b.dataset.vit === vit); });
    $('[data-act="pipette"]').classList.toggle('actif', outil === 'pipette');
    $('[data-act="gomme"]').classList.toggle('actif', outil === 'gomme');
    $('#pause').classList.toggle('actif', pause);
    $('#voyant').classList.toggle('arret', pause);
    $('#marche').textContent = pause ? 'À l\'arrêt' : 'En marche';
    $('#lPause').textContent = pause ? 'Reprendre' : 'Arrêt';
    $('#fleche').textContent = FLECHES[dir];
    curseur();
    ch.hidden = !montre;
    if (!montre) return;
    ch.textContent = '';
    l = document.createElement('span');
    l.textContent = outil === 'filtre' ? 'Laisse passer tout droit (touche F) :' : 'Fournit (touche F) :';
    ch.appendChild(l);
    objetsNiv.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'puce' + (k === objF ? ' actif' : ''); b.dataset.objet = k;
      b.appendChild(icone(k, 10));
      b.appendChild(document.createTextNode(OBJETS[k].nom));
      ch.appendChild(b);
    });
    if (outil !== 'src') return;
    l = document.createElement('span'); l.className = 'sep'; ch.appendChild(l);
    CADENCES.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'puce' + (p === per ? ' actif' : ''); b.dataset.per = p;
      b.textContent = 240 / p + ' par min';
      ch.appendChild(b);
    });
  }

  // N'écrit dans la page que ce qui a changé.
  function ecrire(sel, t) {
    if (memo[sel] === t) return;
    memo[sel] = t;
    $(sel).textContent = t;
  }
  // Compteur mécanique : un rouleau par chiffre.
  function rouleaux(sel, n) {
    var e, t = ('000' + n).slice(-Math.max(3, String(n).length)), i, s;
    if (memo[sel] === t) return;
    memo[sel] = t;
    e = $(sel);
    e.textContent = '';
    for (i = 0; i < t.length; i++) {
      s = document.createElement('span'); s.textContent = t.charAt(i);
      if (i < t.length - String(n).length) s.className = 'vide';
      e.appendChild(s);
    }
  }

  function majTableau() {
    var rec = sauve.records[niv.id], r = res, sec, t, i, lis, ul, cle, tot = {}, k, suiv;
    ecrire('#horloge', Math.floor(S.pas / U.PAS_SEC / 60) + ' min ' + ('0' + Math.floor(S.pas / U.PAS_SEC) % 60).slice(-2) + ' s');
    rouleaux('#vCout', S.cout);
    rouleaux('#vEmprise', S.emprise);
    ecrire('#record', niv.bac ? '' : etoiles(rec ? rec.e : 0));
    ecrire('#rCout', rec && rec.e ? 'record ' + rec.cout : '');
    ecrire('#rEmprise', rec && rec.e ? 'record ' + rec.emprise : '');
    document.querySelector('[data-act="annuler"]').disabled = !hist.avant.length;
    document.querySelector('[data-act="retablir"]').disabled = !hist.apres.length;
    $('#meilleur').hidden = !(rec && rec.plan && rec.plan !== U.coder(plan));

    // Débits par sortie.
    ul = $('#sorties');
    if (niv.bac) {
      S.sorties.forEach(function (o) { for (k in o.taux) tot[k] = (tot[k] || 0) + o.taux[k]; });
      t = Object.keys(tot).map(function (x) { return x + ':' + tot[x]; }).join(',');
    } else t = S.besoins.map(function (b) { return b.k + ':' + (b.o.taux[b.k] || 0) + '/' + b.c; }).join(',');
    if (memo.sorties !== t) {
      memo.sorties = t;
      ul.textContent = '';
      (niv.bac ? Object.keys(tot).map(function (x) { return { k: x, n: tot[x], c: 0 }; }) :
        S.besoins.map(function (b) { return { k: b.k, n: b.o.taux[b.k] || 0, c: b.c }; })).forEach(function (b) {
        var li = document.createElement('li'), s = document.createElement('span'), v = document.createElement('b');
        li.className = b.c ? (b.n >= b.c ? 'ok' : 'ko') : '';
        s.textContent = OBJETS[b.k].pluriel;
        v.textContent = b.n + (b.c ? ' / ' + b.c : '') + ' par min';
        li.appendChild(icone(b.k, 10)); li.appendChild(s); li.appendChild(v);
        ul.appendChild(li);
      });
    }
    if (niv.bac) return;

    rouleaux('#vDebit', S.debit);
    ecrire('#rDebit', rec && rec.e ? 'record ' + rec.debit : '');
    lis = $('#objectifs').children;
    for (i = 0; i < lis.length; i++) lis[i].classList.toggle('ok', !!r && r.etoiles > i);
    t = S.amorce ? Math.min(S.tenue, U.TENUE) : 0;
    cle = String(Math.round(100 * t / U.TENUE));
    if (memo.tenue !== cle) { memo.tenue = cle; $('#tenue').style.width = cle + '%'; }
    sec = Math.floor(t / U.PAS_SEC);
    ecrire('#etat', r && r.valide ? 'Réussi ' + etoiles(r.etoiles) : t ? 'Débit tenu ' + sec + ' s sur 30' : S.pas < 8 ? 'Débit à tenir 30 s' : 'Débit insuffisant');
    $('#tampon').hidden = !(r && r.valide);
    t = '';
    if (r && r.valide) {
      if (r.etoiles === 3) t = 'Trois étoiles. Les records restent à battre : débit, coût, emprise.';
      else t = 'Commande honorée. Pour l\'étoile suivante : ' + textePalier(niv.paliers[r.etoiles - 1]) + '.';
    }
    ecrire('#bravo', t);
    $('#bravo').hidden = !t;
    suiv = U.NIVEAUX[U.NIVEAUX.indexOf(niv) + 1];
    $('#suivant').hidden = !(suiv && rec && rec.e);
  }

  // ---------- Bulle d'information ----------
  function nomObjets(o) {
    return Object.keys(o).map(function (k) { return (o[k] > 1 ? o[k] + ' ' + OBJETS[k].pluriel : OBJETS[k].nom); }).join(' + ');
  }

  function infoPiece(e) {
    var t = '<b>' + PIECES[e.k].nom + '</b>', k, l, m, r;
    if (e.k === 'src') {
      t = '<b>Source</b> : ' + e.seq.map(function (x) { return OBJETS[x].nom; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' et ') +
        (e.seq.length > 1 ? ' (' + e.seq.map(function (x) { return OBJETS[x].nom.split(' ').pop(); }).join(', ') + ', en boucle)' : '') + ', ' + Math.round(240 / e.p) + ' par minute.';
      if (e.att >= ALERTE) t += '<br><span class="bloque">Bloquée : rien ne prend ce qu\'elle sort.</span>';
      return t;
    }
    if (e.k === 'out') {
      if (!e.veut) {
        l = Object.keys(e.taux).filter(function (x) { return e.taux[x]; }).map(function (x) { return e.taux[x] + ' ' + OBJETS[x].pluriel; });
        return '<b>' + (e.fixe ? 'Benne' : 'Sortie') + '</b> : avale tout.' + (l.length ? '<br>Par minute : ' + l.join(', ') + '.' : '');
      }
      return '<b>Caisse</b> : n\'accepte que ' + Object.keys(e.veut).map(function (x) { return 'les ' + OBJETS[x].pluriel + ' (' + (e.taux[x] || 0) + ' / ' + e.veut[x] + ' par minute)'; }).join(' et ') + '.';
    }
    if (MACHINE[e.k]) {
      if (e.rec && e.t > 0) t += ' : ' + nomObjets(e.rec.e) + ' → ' + e.rec.s.map(function (x) { return OBJETS[x].nom; }).join(' + ') + '.';
      else if (e.etat === 'bloquee') t += '<br><span class="bloque">Bloquée : ' + 'rien ne prend ce qui sort' + (e.out.length ? ' (' + OBJETS[e.out[0].k].nom + ')' : '') + '.</span>';
      else if (e.nb) {
        m = [];
        U.RECS[e.k].forEach(function (rc) {
          var bon = true, q = [];
          for (k in e.buf) if (!rc.e[k]) bon = false;
          if (!bon) return;
          for (k in rc.e) if ((e.buf[k] || 0) < rc.e[k]) q.push(OBJETS[k].nom);
          if (q.length) m.push(q.join(' + '));
        });
        t += '<br><span class="alerte">A reçu ' + nomObjets(e.buf) + ', attend : ' + m.join(' ou ') + '.</span>';
      } else t += '<br><span class="alerte">' + (S.pas < ALERTE ? 'En attente.' : 'À l\'arrêt : rien n\'arrive.') + '</span>';
      return t;
    }
    if (e.k === 'filtre') {
      t += ' : ' + OBJETS[e.f].nom + ' tout droit, le reste sur les côtés.';
      if (e.it && coince(e)) {
        r = e.it.k === e.f;
        t += '<br><span class="bloque">Bloqué : ' + OBJETS[e.it.k].nom + (r ? ' ne peut pas avancer.' : ' n\'a pas de côté où partir.') + '</span>';
      }
      return t;
    }
    t += '<br>' + PIECES[e.k].info;
    if (e.it) t += '<br>Porte : ' + OBJETS[e.it.k].nom + '.';
    return t;
  }

  function majBulle() {
    var b = $('#bulle'), e, t = '', x, y;
    if (souris && souris.dans && !geste) {
      e = S.cases[souris.y * niv.w + souris.x];
      if (e && (!outil || outil === 'gomme' || outil === 'pipette' || e.fixe || MACHINE[e.k] || e.k === 'filtre')) t = infoPiece(e);
      else if (!e && U.fixes(niv)[souris.y * niv.w + souris.x] === 'mur') t = '<b>Zone de stockage</b> : rien ne se pose ici.';
    }
    if (!t) { b.hidden = true; memo.bulle = ''; return; }
    if (memo.bulle !== t) { memo.bulle = t; b.innerHTML = t; }
    b.hidden = false;
    x = souris.px + 16; y = souris.py + 16;
    if (x + b.offsetWidth > vue.l - 4) x = souris.px - b.offsetWidth - 12;
    if (y + b.offsetHeight > vue.h - 4) y = souris.py - b.offsetHeight - 12;
    b.style.left = Math.max(4, x) + 'px'; b.style.top = Math.max(4, y) + 'px';
  }

  // ---------- Boucle ----------
  function image(t) {
    var dt = Math.min(100, t - dernier), n = 0;
    dernier = t; temps = t;
    if (!pause) {
      acc += dt * U.PAS_SEC * VITESSES[vit] / 1000;
      while (acc >= 1 && n < 8) { pas(); acc -= 1; n++; }
      if (acc >= 1) acc = 0;
      alpha = acc;
    } else alpha = 1;
    animerVue(dt);
    dessiner();
    if (t - majA > 120) { majA = t; majTableau(); majBulle(); }
    requestAnimationFrame(image);
  }

  // ---------- Démarrage ----------
  lireSauve();
  taille();
  charger(trouver(decodeURIComponent(location.hash.slice(1))) || trouver(sauve.dernier) || U.NIVEAUX[0]);
  if (!sauve.aide) $('#aide').hidden = false;
  dernier = performance.now();
  requestAnimationFrame(image);

  // Poignée de mise au point, sans effet sur le jeu.
  U.debug = { avancer: function (n) { while (n-- > 0) pas(); majTableau(); dessiner(); }, dessiner: dessiner,
    etat: function () { return { S: S, plan: plan, vue: vue, outil: outil, dir: dir, res: res, pause: pause }; } };
})();
