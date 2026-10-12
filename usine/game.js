(function () {
  'use strict';

  var U = window.Usine;
  var DX = U.DX, DY = U.DY, OBJETS = U.OBJETS, PIECES = U.PIECES, MACHINE = U.MACHINE;
  var CLE = 'usine-v1';
  var VITESSES = [1, 2, 4, 16];
  var CADENCES = [8, 4, 2, 1];     // périodes proposées pour une source du bac à sable
  var FLECHES = ['→', '↓', '←', '↑'];
  var ALERTE = 8;                  // pas d'attente avant de signaler une machine
  var ZMIN = 14, ZMAX = 96;
  var PI = Math.PI;
  var TEINTE = { four: '#70432e', presse: '#3a5469', tour: '#4b5f45', assem: '#5a4b80' };
  var POLICE = 'Bahnschrift, "DIN Alternate", "Segoe UI", Arial, sans-serif';

  var $ = function (s) { return document.querySelector(s); };
  var cv = $('#vue'), ctx = cv.getContext('2d');

  // ---------- État ----------
  // niv : niveau courant, plan : pièces posées, S : simulation, hist : annuler/rétablir.
  // outil : pièce à poser, 'pipette' ou null (main libre). geste : glisser en cours.
  var sauve = { plans: {}, records: {}, dernier: '', vit: 0, aide: false };
  var niv, plan, S, hist, objetsNiv = [];
  var outil = null, dir = 0, objF = 'mf', per = 4;
  var vue = { z: 48, ox: 0, oy: 0, l: 0, h: 0, dpr: 1 };
  var survol = null, souris = null, geste = null;
  var pause = false, vit = 0, acc = 0, dernier = 0, alpha = 1, majA = 0;
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
    reconstruire();
    enregistrer();
    monter();
    cadrer();
  }

  function reconstruire() {
    S = U.creer(niv, plan);
    acc = 0; alpha = 1; res = null; memo = {};
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

  // ---------- Dessin des objets ----------
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

  // Chaque objet a sa silhouette : on doit le reconnaître sans la couleur.
  function objet(c, k, x, y, r) {
    var o = OBJETS[k], i, a, p;
    c.save();
    c.translate(x, y); c.scale(r, r);
    c.lineWidth = 0.17; c.lineJoin = 'round'; c.fillStyle = o.c; c.strokeStyle = o.bord;
    switch (k) {
      case 'mf':
        poly(c, [-0.9, -0.15, -0.3, -0.9, 0.7, -0.65, 0.95, 0.3, 0.1, 0.9, -0.7, 0.6]); plein(c);
        c.beginPath(); c.moveTo(-0.3, -0.9); c.lineTo(0, 0); c.lineTo(0.95, 0.3); c.moveTo(0, 0); c.lineTo(-0.7, 0.6); c.lineWidth = 0.1; c.stroke();
        break;
      case 'mc':
        poly(c, [0, -0.95, 0.98, 0.72, -0.98, 0.72]); plein(c);
        c.fillStyle = o.bord; disque(c, 0, 0.2, 0.2); c.fill();
        break;
      case 'lf':
        poly(c, [-0.55, -0.5, 0.55, -0.5, 1, 0.5, -1, 0.5]); plein(c);
        c.beginPath(); c.moveTo(-0.45, -0.1); c.lineTo(0.45, -0.1); c.lineWidth = 0.1; c.stroke();
        break;
      case 'lc':
        arrondi(c, -1, -0.5, 2, 1, 0.5); plein(c);
        break;
      case 'pl':
        c.beginPath(); c.rect(-0.8, -0.8, 1.6, 1.6); plein(c);
        c.fillStyle = o.bord;
        for (i = 0; i < 4; i++) { disque(c, i & 1 ? 0.48 : -0.48, i & 2 ? 0.48 : -0.48, 0.12); c.fill(); }
        break;
      case 'fi':
        disque(c, 0, 0, 0.88); plein(c);
        c.fillStyle = '#18222a'; disque(c, 0, 0, 0.36); plein(c);
        break;
      case 'en':
        p = [];
        for (i = 0; i < 8; i++) {
          a = i * PI / 4;
          p.push(0.68 * Math.cos(a - 0.28), 0.68 * Math.sin(a - 0.28), Math.cos(a - 0.17), Math.sin(a - 0.17),
            Math.cos(a + 0.17), Math.sin(a + 0.17), 0.68 * Math.cos(a + 0.28), 0.68 * Math.sin(a + 0.28));
        }
        poly(c, p); plein(c);
        c.fillStyle = o.bord; disque(c, 0, 0, 0.27); c.fill();
        break;
      case 'ch':
        poly(c, [-0.95, 0.1, -0.35, -0.75, -0.1, 0.25]); plein(c);
        poly(c, [0.1, -0.35, 0.95, -0.55, 0.6, 0.3]); plein(c);
        poly(c, [-0.35, 0.55, 0.5, 0.45, 0.1, 0.98]); plein(c);
        break;
      case 'me':
        poly(c, [0, -1, 1, 0, 0, 1, -1, 0]); plein(c);
        disque(c, 0, 0, 0.36); c.lineWidth = 0.13; c.stroke();
        c.beginPath(); c.moveTo(-0.36, 0); c.lineTo(0.36, 0); c.moveTo(0, -0.36); c.lineTo(0, 0.36); c.stroke();
        break;
      case 'ci':
        c.strokeStyle = o.c; c.lineWidth = 0.14;
        c.beginPath();
        for (i = -0.6; i < 0.7; i += 0.4) { c.moveTo(i, -0.95); c.lineTo(i, 0.95); }
        c.stroke();
        c.strokeStyle = o.bord; c.lineWidth = 0.17;
        c.beginPath(); c.rect(-0.95, -0.6, 1.9, 1.2); plein(c);
        c.fillStyle = o.bord; c.fillRect(-0.35, -0.25, 0.7, 0.5);
        break;
      default:
        p = [];
        for (i = 0; i < 6; i++) p.push(Math.cos(i * PI / 3), Math.sin(i * PI / 3));
        poly(c, p); plein(c);
        c.fillStyle = o.bord; disque(c, 0, 0, 0.5); c.fill();
        c.fillStyle = o.c; disque(c, 0, 0, 0.2); c.fill();
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
  // o : précisions venues de la simulation (forme du tapis, liaisons, objet filtré…), absent pour une icône.
  function chevron(c, x, y, a) {
    c.save();
    c.translate(x, y); c.rotate(a);
    c.beginPath(); c.moveTo(-0.08, -0.13); c.lineTo(0.05, 0); c.lineTo(-0.08, 0.13); c.stroke();
    c.restore();
  }

  function bande(c, forme, cg, cd, phase, clair) {
    var k, t, a;
    c.save();
    c.beginPath(); c.rect(-0.5, -0.5, 1, 1); c.clip();
    c.fillStyle = clair ? '#3b4a56' : '#2a353e';
    c.strokeStyle = clair ? '#93a4b0' : '#5b6b77'; c.lineWidth = 0.045;
    if (forme === 0) {
      c.fillRect(-0.5, -0.3, 1, 0.6);
      if (cg) c.fillRect(-0.3, -0.5, 0.6, 0.2);
      if (cd) c.fillRect(-0.3, 0.3, 0.6, 0.2);
      c.beginPath();
      if (cg) { c.moveTo(-0.5, -0.3); c.lineTo(-0.3, -0.3); c.lineTo(-0.3, -0.5); c.moveTo(0.3, -0.5); c.lineTo(0.3, -0.3); c.lineTo(0.5, -0.3); }
      else { c.moveTo(-0.5, -0.3); c.lineTo(0.5, -0.3); }
      if (cd) { c.moveTo(-0.5, 0.3); c.lineTo(-0.3, 0.3); c.lineTo(-0.3, 0.5); c.moveTo(0.3, 0.5); c.lineTo(0.3, 0.3); c.lineTo(0.5, 0.3); }
      else { c.moveTo(-0.5, 0.3); c.lineTo(0.5, 0.3); }
      c.stroke();
    } else {
      k = forme === 1 ? -0.5 : 0.5;
      c.beginPath();
      if (forme === 1) { c.arc(0.5, k, 0.8, PI / 2, PI); c.arc(0.5, k, 0.2, PI, PI / 2, true); }
      else { c.arc(0.5, k, 0.8, PI, 1.5 * PI); c.arc(0.5, k, 0.2, 1.5 * PI, PI, true); }
      c.closePath(); c.fill();
      c.beginPath(); c.arc(0.5, k, 0.8, forme === 1 ? PI / 2 : PI, forme === 1 ? PI : 1.5 * PI); c.stroke();
      c.beginPath(); c.arc(0.5, k, 0.2, forme === 1 ? PI / 2 : PI, forme === 1 ? PI : 1.5 * PI); c.stroke();
    }
    c.strokeStyle = clair ? '#b9c6cf' : '#7f93a1'; c.lineWidth = 0.05; c.lineJoin = 'miter';
    // Les chevrons débordent d'une demi-case de chaque côté : le découpage raccorde les cases voisines.
    for (k = -1; k < 3; k++) {
      t = k * 0.5 + phase;
      if (t < -0.2 || t > 1.2) continue;
      if (forme === 0 || t > 1) chevron(c, -0.5 + t, 0, 0);
      else if (t < 0) chevron(c, 0, forme === 1 ? -0.5 + t : 0.5 - t, forme === 1 ? PI / 2 : -PI / 2);
      else if (forme === 1) { a = PI - t * PI / 2; chevron(c, 0.5 + 0.5 * Math.cos(a), -0.5 + 0.5 * Math.sin(a), a - PI / 2); }
      else { a = PI + t * PI / 2; chevron(c, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), a + PI / 2); }
    }
    c.restore();
  }

  function moignons(c, rel) {
    c.fillStyle = '#2a353e'; c.strokeStyle = '#5b6b77'; c.lineWidth = 0.045;
    rel.forEach(function (r) {
      c.save();
      c.rotate(r * PI / 2);
      c.fillRect(0, -0.3, 0.5, 0.6);
      c.beginPath(); c.moveTo(0.2, -0.3); c.lineTo(0.5, -0.3); c.moveTo(0.2, 0.3); c.lineTo(0.5, 0.3); c.stroke();
      c.restore();
    });
  }

  function fleche(c, x0, y0, x1, y1) {
    var a = Math.atan2(y1 - y0, x1 - x0);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.save();
    c.translate(x1, y1); c.rotate(a);
    c.beginPath(); c.moveTo(0.02, 0); c.lineTo(-0.11, -0.09); c.lineTo(-0.11, 0.09); c.closePath(); c.fill();
    c.restore();
  }

  function bouche(c) {
    c.fillStyle = '#d98a4e'; c.strokeStyle = '#0c1216'; c.lineWidth = 0.035; c.lineJoin = 'round';
    poly(c, [0.3, -0.15, 0.5, 0, 0.3, 0.15]); plein(c);
  }

  // Couche basse : ce qui passe sous les objets.
  function bas(c, k, d, o) {
    c.save();
    c.rotate(d * PI / 2);
    switch (k) {
      case 'tapis': bande(c, o ? o.forme : 0, o && o.cg, o && o.cd, o ? o.phase : 0.3); break;
      case 'pont':
        c.save(); c.rotate(PI / 2); bande(c, 0, false, false, o ? o.phase : 0.3); c.restore();
        break;
      case 'sep':
        moignons(c, o ? o.rel : [0, 1, 2, 3]);
        c.fillStyle = '#3a3320'; c.strokeStyle = '#e6bd5a'; c.lineWidth = 0.05; c.lineJoin = 'round';
        poly(c, [0, -0.46, 0.46, 0, 0, 0.46, -0.46, 0]); plein(c);
        c.fillStyle = c.strokeStyle = '#e6bd5a'; c.lineWidth = 0.055;
        c.beginPath(); c.moveTo(-0.3, 0); c.lineTo(-0.06, 0); c.stroke();
        fleche(c, -0.06, 0, 0.3, 0); fleche(c, -0.06, 0, -0.06, -0.27); fleche(c, -0.06, 0, -0.06, 0.27);
        break;
      case 'fus':
        moignons(c, o ? o.rel : [0, 1, 2, 3]);
        c.fillStyle = '#1f3440'; c.strokeStyle = '#7fc4e0'; c.lineWidth = 0.05;
        disque(c, 0, 0, 0.42); plein(c);
        c.fillStyle = c.strokeStyle = '#7fc4e0'; c.lineWidth = 0.055; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(-0.3, 0); c.lineTo(0.02, 0); c.moveTo(0, -0.3); c.lineTo(0, 0); c.lineTo(0, 0.3); c.stroke();
        fleche(c, 0, 0, 0.32, 0);
        break;
      case 'filtre':
        moignons(c, o ? o.rel : [0, 1, 2, 3]);
        c.fillStyle = '#20362f'; c.strokeStyle = '#6fd0a0'; c.lineWidth = 0.05; c.lineJoin = 'round';
        poly(c, [-0.44, -0.44, 0.12, -0.44, 0.44, -0.18, 0.44, 0.18, 0.12, 0.44, -0.44, 0.44]); plein(c);
        c.lineWidth = 0.04;
        c.beginPath(); c.moveTo(-0.34, -0.44); c.lineTo(-0.34, 0.44); c.moveTo(-0.24, -0.44); c.lineTo(-0.24, 0.44); c.stroke();
        break;
      case 'out':
        c.fillStyle = o && o.benne ? '#1c2228' : '#14241c';
        c.fillRect(-0.46, -0.46, 0.92, 0.92);
        break;
    }
    c.restore();
  }

  // Couche haute : ce qui couvre les objets.
  function haut(c, k, d, o) {
    var t = TEINTE[k], i, a, v;
    c.save();
    c.rotate(d * PI / 2);
    c.lineJoin = 'round';
    if (t) {
      c.fillStyle = t; c.strokeStyle = '#0c1216'; c.lineWidth = 0.05;
      if (k === 'four') poly(c, [-0.26, -0.43, 0.26, -0.43, 0.43, -0.26, 0.43, 0.26, 0.26, 0.43, -0.26, 0.43, -0.43, 0.26, -0.43, -0.26]);
      else if (k === 'presse') arrondi(c, -0.43, -0.43, 0.86, 0.86, 0.03);
      else if (k === 'tour') disque(c, 0, 0, 0.45);
      else poly(c, [-0.27, -0.44, 0.27, -0.44, 0.27, -0.27, 0.44, -0.27, 0.44, 0.27, 0.27, 0.27, 0.27, 0.44, -0.27, 0.44, -0.27, 0.27, -0.44, 0.27, -0.44, -0.27, -0.27, -0.27]);
      plein(c);
      bouche(c);
    }
    switch (k) {
      case 'pont':
        bande(c, 0, false, false, o ? o.phase : 0.3, true);
        c.fillStyle = '#e6bd5a';
        c.fillRect(-0.5, -0.38, 1, 0.08); c.fillRect(-0.5, 0.3, 1, 0.08);
        c.fillStyle = '#0c1216';
        c.fillRect(-0.5, -0.4, 0.06, 0.12); c.fillRect(0.44, -0.4, 0.06, 0.12); c.fillRect(-0.5, 0.28, 0.06, 0.12); c.fillRect(0.44, 0.28, 0.06, 0.12);
        break;
      case 'broyeur':
        c.fillStyle = '#3d2226'; c.strokeStyle = '#0c1216'; c.lineWidth = 0.05;
        arrondi(c, -0.43, -0.43, 0.86, 0.86, 0.08); plein(c);
        c.fillStyle = '#e8695a';
        for (i = 0; i < 4; i++) {
          poly(c, [-0.36 + i * 0.18, -0.32, -0.18 + i * 0.18, -0.32, -0.27 + i * 0.18, -0.04]); c.fill();
          poly(c, [-0.36 + i * 0.18, 0.32, -0.18 + i * 0.18, 0.32, -0.27 + i * 0.18, 0.04]); c.fill();
        }
        break;
      case 'src':
        c.fillStyle = '#1b2932'; c.strokeStyle = '#e6bd5a'; c.lineWidth = 0.05;
        arrondi(c, -0.44, -0.44, 0.88, 0.88, 0.14); c.fill();
        c.setLineDash([0.12, 0.08]); c.stroke(); c.setLineDash([]);
        bouche(c);
        break;
      case 'out':
        c.strokeStyle = o && o.benne ? '#8b9aa5' : '#7fd08a'; c.lineWidth = 0.07; c.lineJoin = 'miter';
        c.beginPath();
        for (i = 0; i < 4; i++) {
          a = i & 1 ? 0.44 : -0.44; v = i & 2 ? 0.44 : -0.44;
          c.moveTo(a, v - Math.sign(v) * 0.2); c.lineTo(a, v); c.lineTo(a - Math.sign(a) * 0.2, v);
        }
        c.stroke();
        break;
    }
    c.restore();

    // Pictogrammes : toujours droits, quelle que soit l'orientation.
    c.lineJoin = 'round'; c.lineCap = 'round';
    switch (k) {
      case 'four':
        c.fillStyle = '#ffab40';
        c.beginPath(); c.moveTo(0, -0.26); c.bezierCurveTo(0.24, -0.02, 0.18, 0.2, 0, 0.2); c.bezierCurveTo(-0.18, 0.2, -0.24, -0.02, 0, -0.26); c.fill();
        c.fillStyle = '#fff0b8';
        c.beginPath(); c.moveTo(0, -0.04); c.bezierCurveTo(0.1, 0.06, 0.08, 0.16, 0, 0.16); c.bezierCurveTo(-0.08, 0.16, -0.1, 0.06, 0, -0.04); c.fill();
        break;
      case 'presse':
        c.fillStyle = c.strokeStyle = '#dfe6ea'; c.lineWidth = 0.06;
        c.fillRect(-0.2, -0.24, 0.4, 0.08); c.fillRect(-0.2, 0.12, 0.4, 0.08);
        fleche(c, 0, -0.16, 0, 0.08);
        break;
      case 'tour':
        c.strokeStyle = c.fillStyle = '#dfe6ea'; c.lineWidth = 0.055;
        disque(c, 0, 0, 0.22); c.stroke();
        c.beginPath();
        for (i = 0; i < 3; i++) { a = -PI / 2 + i * 2 * PI / 3; c.moveTo(0.08 * Math.cos(a), 0.08 * Math.sin(a)); c.lineTo(0.22 * Math.cos(a), 0.22 * Math.sin(a)); }
        c.stroke();
        disque(c, 0, 0, 0.045); c.fill();
        break;
      case 'assem':
        c.strokeStyle = c.fillStyle = '#dfe6ea'; c.lineWidth = 0.055;
        c.strokeRect(-0.2, -0.2, 0.25, 0.25);
        c.fillRect(-0.06, -0.06, 0.25, 0.25);
        break;
      case 'filtre':
        if (o && o.f) objet(c, o.f, 0.08, 0, 0.19);
        break;
      case 'src':
        v = o && o.seq ? o.seq : o && o.f ? [o.f] : [];
        v.forEach(function (it, j) { objet(c, it, v.length > 1 ? -0.17 + j * 0.34 : -0.02, -0.1, v.length > 1 ? 0.15 : 0.2); });
        break;
      case 'out':
        if (o && o.veut) {
          v = Object.keys(o.veut);
          v.forEach(function (it, j) { objet(c, it, v.length > 1 ? -0.19 + j * 0.38 : 0, -0.08, v.length > 1 ? 0.16 : 0.22); });
        } else if (!o || !o.benne) {
          c.strokeStyle = c.fillStyle = '#7fd08a'; c.lineWidth = 0.06;
          c.beginPath(); c.moveTo(-0.22, -0.02); c.lineTo(-0.22, 0.2); c.lineTo(0.22, 0.2); c.lineTo(0.22, -0.02); c.stroke();
          fleche(c, 0, -0.3, 0, 0.08);
        } else {
          c.strokeStyle = '#8b9aa5'; c.lineWidth = 0.055;
          poly(c, [-0.24, -0.2, 0.24, -0.2, 0.17, 0.24, -0.17, 0.24]); c.stroke();
          c.beginPath(); c.moveTo(-0.08, -0.1); c.lineTo(-0.06, 0.14); c.moveTo(0.08, -0.1); c.lineTo(0.06, 0.14); c.moveTo(-0.3, -0.2); c.lineTo(0.3, -0.2); c.stroke();
        }
        break;
    }
    if (o && o.prog !== undefined) {
      c.fillStyle = '#0c1216'; c.fillRect(-0.24, 0.27, 0.48, 0.07);
      c.fillStyle = '#e6bd5a'; c.fillRect(-0.24, 0.27, 0.48 * o.prog, 0.07);
    }
    c.lineCap = 'butt';
  }

  function vignette(k, f) {
    var e = document.createElement('canvas'), c;
    e.width = e.height = 80;
    c = e.getContext('2d');
    c.translate(40, 40); c.scale(72, 72);
    bas(c, k, 0, null);
    haut(c, k, 0, { f: f });
    return e;
  }

  // ---------- Dessin de la scène ----------
  // Ce que le dessin d'une pièce doit savoir de la simulation, calculé une fois par construction.
  function apparence(e) {
    var o = e.g, a = e.am;
    if (o) return o;
    o = e.g = { forme: 0, cg: false, cd: false, rel: [], f: e.f, veut: e.veut, benne: e.benne, phase: 0 };
    if (e.k === 'src') o.seq = e.seq.filter(function (x, i) { return e.seq.indexOf(x) === i; });
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
    return o;
  }

  function place(x, y, fn) {
    ctx.save();
    ctx.translate(vue.ox + (x + 0.5) * vue.z, vue.oy + (y + 0.5) * vue.z);
    ctx.scale(vue.z, vue.z);
    fn();
    ctx.restore();
  }

  function unObjet(it, e, tablier) {
    var x = e.x, y = e.y, dessus;
    if (!it) return;
    dessus = tablier || (it.h && it.m === S.pas && alpha < 1);
    if (dessus !== passeHaute) return;
    if (it.m === S.pas && alpha < 1) { x = it.fx + (x - it.fx) * alpha; y = it.fy + (y - it.fy) * alpha; }
    objet(ctx, it.k, vue.ox + (x + 0.5) * vue.z, vue.oy + (y + 0.5) * vue.z, vue.z * 0.25);
  }
  var passeHaute = false;

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
      objet(ctx, a.k, vue.ox + (a.fx + (a.x - a.fx) * t + 0.5) * vue.z, vue.oy + (a.fy + (a.y - a.fy) * t + 0.5) * vue.z, vue.z * 0.25);
    }
    ctx.globalAlpha = 1;
  }

  function badge(e, rouge) {
    var z = vue.z, x = vue.ox + (e.x + 0.2) * z, y = vue.oy + (e.y + 0.2) * z, r = Math.max(7, z * 0.17);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#0c1216'; ctx.lineJoin = 'round';
    if (rouge) { ctx.fillStyle = '#e8695a'; ctx.beginPath(); ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7); }
    else { ctx.fillStyle = '#f0a13c'; poly(ctx, [x, y - r, x + r, y + r * 0.8, x - r, y + r * 0.8]); }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0c1216';
    if (rouge) ctx.fillRect(x - r * 0.5, y - r * 0.18, r, r * 0.36);
    else { ctx.fillRect(x - r * 0.12, y - r * 0.4, r * 0.24, r * 0.65); ctx.fillRect(x - r * 0.12, y + r * 0.4, r * 0.24, r * 0.22); }
  }

  function etiquette(e, texte, couleur) {
    var z = vue.z, px = Math.max(9, Math.min(13, z * 0.21));
    if (z < 34) return;
    ctx.font = '600 ' + px + 'px ' + POLICE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = couleur;
    ctx.fillText(texte, vue.ox + (e.x + 0.5) * z, vue.oy + (e.y + (e.k === 'src' ? 0.84 : 0.92)) * z);
  }

  function dessiner() {
    var z = vue.z, w = niv.w, h = niv.h, fx = U.fixes(niv), i, x, y, e, o, t, c, ok;
    var phase = pause ? 0 : alpha % 1;
    ctx.setTransform(vue.dpr, 0, 0, vue.dpr, 0, 0);
    ctx.fillStyle = '#10181e'; ctx.fillRect(0, 0, vue.l, vue.h);
    ctx.fillStyle = '#17232c'; ctx.fillRect(vue.ox, vue.oy, w * z, h * z);
    ctx.strokeStyle = '#223340'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (x = 0; x <= w; x++) { ctx.moveTo(Math.round(vue.ox + x * z) + 0.5, vue.oy); ctx.lineTo(Math.round(vue.ox + x * z) + 0.5, vue.oy + h * z); }
    for (y = 0; y <= h; y++) { ctx.moveTo(vue.ox, Math.round(vue.oy + y * z) + 0.5); ctx.lineTo(vue.ox + w * z, Math.round(vue.oy + y * z) + 0.5); }
    ctx.stroke();
    ctx.strokeStyle = '#d98a4e'; ctx.lineWidth = 2; ctx.strokeRect(vue.ox - 1, vue.oy - 1, w * z + 2, h * z + 2);

    // Zones interdites : hachures.
    for (i = 0; i < w * h; i++) {
      if (fx[i] !== 'mur') continue;
      x = vue.ox + (i % w) * z; y = vue.oy + Math.floor(i / w) * z;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, z, z); ctx.clip();
      ctx.fillStyle = '#0b1115'; ctx.fillRect(x, y, z, z);
      ctx.strokeStyle = '#3a2a22'; ctx.lineWidth = Math.max(2, z * 0.09);
      ctx.beginPath();
      for (t = -z; t < z; t += z / 3) { ctx.moveTo(x + t, y + z); ctx.lineTo(x + t + z, y); }
      ctx.stroke();
      ctx.restore();
    }

    for (i = 0; i < S.ents.length; i++) {
      e = S.ents[i]; o = apparence(e); o.phase = phase;
      place(e.x, e.y, function () { bas(ctx, e.k, e.d, o); });
    }
    lesObjets(false);
    for (i = 0; i < S.ents.length; i++) {
      e = S.ents[i]; o = e.g;
      o.prog = MACHINE[e.k] && e.rec ? 1 - (e.t - (pause ? 0 : Math.min(1, alpha) - 1)) / e.rec.t : undefined;
      if (o.prog !== undefined) o.prog = Math.max(0, Math.min(1, o.prog));
      place(e.x, e.y, function () { haut(ctx, e.k, e.d, o); });
    }
    lesObjets(true);

    // Diagnostic et compteurs.
    for (i = 0; i < S.ents.length; i++) {
      e = S.ents[i];
      if (MACHINE[e.k] && e.att >= ALERTE) badge(e, e.etat === 'bloquee');
      else if (e.k === 'src' && e.att >= ALERTE) badge(e, true);
      else if ((e.k === 'filtre' || e.k === 'sep') && coince(e)) badge(e, true);
      if (e.k === 'src') etiquette(e, Math.round(240 / e.p) + '/min', '#e6bd5a');
      else if (e.k === 'out') {
        if (e.veut) {
          t = []; ok = true;
          for (c in e.veut) { t.push((e.taux[c] || 0) + '/' + e.veut[c]); if ((e.taux[c] || 0) < e.veut[c]) ok = false; }
          etiquette(e, t.join(' '), ok ? '#7fd08a' : '#f0a13c');
        } else {
          t = 0;
          for (c in e.taux) t += e.taux[c];
          etiquette(e, t + '/min', '#8b9aa5');
        }
      }
    }

    // Case survolée et pièce fantôme.
    if (survol && survol.dans) {
      x = vue.ox + survol.x * z; y = vue.oy + survol.y * z;
      if (outil && outil !== 'pipette' && outil !== 'gomme' && !geste) {
        ok = U.posable(niv, survol.x, survol.y, outil);
        ctx.globalAlpha = 0.6;
        place(survol.x, survol.y, function () { bas(ctx, outil, dir, null); haut(ctx, outil, dir, { f: objF }); });
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ok ? '#e6bd5a' : '#e8695a';
      } else ctx.strokeStyle = outil === 'pipette' ? '#7fc4e0' : outil === 'gomme' ? '#e8695a' : '#dfe6ea';
      ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, z - 2, z - 2);
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
    if (neuf && niv) cadrer();
  }
  function cadrer() {
    vue.z = Math.max(ZMIN, Math.min(72, Math.floor(Math.min((vue.l - 40) / niv.w, (vue.h - 40) / niv.h))));
    vue.ox = Math.round((vue.l - niv.w * vue.z) / 2);
    vue.oy = Math.round((vue.h - niv.h * vue.z) / 2);
  }
  function zoomer(f, px, py) {
    var z = Math.max(ZMIN, Math.min(ZMAX, vue.z * f));
    vue.ox = px - (px - vue.ox) * z / vue.z;
    vue.oy = py - (py - vue.oy) * z / vue.z;
    vue.z = z;
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

  cv.addEventListener('pointerdown', function (ev) {
    var c = caseDe(ev);
    ev.preventDefault();
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* pointeur déjà relâché */ }
    survol = c;
    if (ev.button === 1 || (ev.button === 0 && (ev.shiftKey || !outil))) { geste = { type: 'vue', x: ev.clientX, y: ev.clientY }; return; }
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
  cv.addEventListener('wheel', function (ev) {
    var c = caseDe(ev);
    ev.preventDefault();
    zoomer(ev.deltaY < 0 ? 1.15 : 1 / 1.15, c.px, c.py);
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

  function ouvrirNiveaux() {
    var g = $('#grille');
    g.textContent = '';
    U.NIVEAUX.concat([U.BAC]).forEach(function (n, i) {
      var b = document.createElement('button'), rec = sauve.records[n.id], libre = n.bac || ouvert(i), t = [];
      b.type = 'button'; b.className = 'carte' + (n === niv ? ' ici' : ''); b.disabled = !libre;
      b.dataset.niv = n.id;
      if (rec && rec.e) {
        if (n.paliers.some(function (p) { return p.debit !== undefined; })) t.push('débit ' + rec.debit);
        t.push('coût ' + rec.cout, 'emprise ' + rec.emprise);
      }
      b.innerHTML = '<small><span>' + (n.bac ? 'Libre' : 'Commande ' + (i + 1)) + '</span>' + (libre ? '' : '<span>verrouillé</span>') + '</small><b></b><span></span>' +
        (n.bac ? '' : '<span class="etoiles">' + etoiles(rec ? rec.e : 0) + '</span><span class="rec">' + (t.length ? 'Records : ' + t.join(', ') : '&nbsp;') + '</span>');
      b.querySelector('b').textContent = n.nom;
      b.querySelector('b + span').textContent = n.idee;
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
      case 'zoomPlus': zoomer(1.25, vue.l / 2, vue.h / 2); break;
      case 'zoomMoins': zoomer(0.8, vue.l / 2, vue.h / 2); break;
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

  // ---------- Tableau de bord ----------
  // Monte tout ce qui ne dépend que du niveau.
  function monter() {
    var i = U.NIVEAUX.indexOf(niv), pal = $('#palette'), rec = $('#recettes'), obj = $('#objectifs');
    $('#num').textContent = niv.bac ? 'Libre' : 'Commande ' + (i + 1) + ' / ' + U.NIVEAUX.length;
    $('#nom').textContent = niv.nom;
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
      s.textContent = PIECES[k].nom;
      b.appendChild(n); b.appendChild(c); b.appendChild(vignette(k, k === 'src' ? 'mf' : k === 'filtre' ? 'en' : null)); b.appendChild(s);
      pal.appendChild(b);
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
      sm = document.createElement('small'); sm.textContent = (r.t / U.PAS_SEC + ' s').replace('.', ',') + ' · ' + Math.round(240 / r.t) + '/min';
      li.appendChild(sm);
      rec.appendChild(li);
    });
    rec.parentNode.hidden = !rec.children.length;

    obj.textContent = '';
    if (!niv.bac) {
      ['Livrer ' + texteBesoins(0)].concat(niv.paliers.map(textePalier)).forEach(function (t, j) {
        var li = document.createElement('li'), b = document.createElement('b'), s = document.createElement('span');
        b.textContent = etoiles(j + 1); s.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        li.appendChild(b); li.appendChild(s);
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
    $('#pause').textContent = pause ? 'Reprendre' : 'Pause';
    $('#fleche').textContent = FLECHES[dir];
    cv.style.cursor = outil ? 'crosshair' : 'grab';
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
      b.textContent = 240 / p + '/min';
      ch.appendChild(b);
    });
  }

  // N'écrit dans la page que ce qui a changé.
  function ecrire(sel, t) {
    if (memo[sel] === t) return;
    memo[sel] = t;
    $(sel).textContent = t;
  }

  function majTableau() {
    var rec = sauve.records[niv.id], r = res, sec, t, i, lis, ul, cle, tot = {}, k, suiv;
    ecrire('#horloge', Math.floor(S.pas / U.PAS_SEC / 60) + ' min ' + ('0' + Math.floor(S.pas / U.PAS_SEC) % 60).slice(-2) + ' s');
    ecrire('#vCout', String(S.cout));
    ecrire('#vEmprise', String(S.emprise));
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

    ecrire('#vDebit', String(S.debit));
    ecrire('#rDebit', rec && rec.e ? 'record ' + rec.debit : '');
    lis = $('#objectifs').children;
    for (i = 0; i < lis.length; i++) lis[i].classList.toggle('ok', !!r && r.etoiles > i);
    t = S.amorce ? Math.min(S.tenue, U.TENUE) : 0;
    cle = String(Math.round(100 * t / U.TENUE));
    if (memo.tenue !== cle) { memo.tenue = cle; $('#tenue').style.width = cle + '%'; }
    sec = Math.floor(t / U.PAS_SEC);
    ecrire('#etat', r && r.valide ? 'Réussi ' + etoiles(r.etoiles) : t ? 'Débit tenu ' + sec + ' s / 30' : S.pas < 8 ? '' : 'Débit insuffisant');
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
      else if (!e && U.fixes(niv)[souris.y * niv.w + souris.x] === 'mur') t = '<b>Zone interdite</b> : rien ne se pose ici.';
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
    dernier = t;
    if (!pause) {
      acc += dt * U.PAS_SEC * VITESSES[vit] / 1000;
      while (acc >= 1 && n < 8) { pas(); acc -= 1; n++; }
      if (acc >= 1) acc = 0;
      alpha = acc;
    } else alpha = 1;
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
  U.debug = { avancer: function (n) { while (n-- > 0) pas(); majTableau(); dessiner(); }, etat: function () { return { S: S, plan: plan, vue: vue, outil: outil, dir: dir, res: res }; } };
})();
