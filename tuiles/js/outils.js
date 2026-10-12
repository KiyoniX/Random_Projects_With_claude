(function () {
  'use strict';

  var M = window.Tuiles, U = M.ui, A = M.auto;

  var SEUIL_MOLETTE = 50;        // défilement cumulé qui vaut un cran de zoom
  var PRISE = 7;                 // rayon de prise d'une poignée ou d'un point, en pixels CSS

  // types : les calques sur lesquels l'outil sert.
  var OUTILS = [
    { id: 'tampon', nom: 'Tampon', touche: 'B', types: 'tuiles collisions', aide: 'Pose la tuile ou le bloc choisi. Clic droit : prendre la tuile sous le curseur.' },
    { id: 'terrain', nom: 'Terrain', touche: 'T', types: 'tuiles', aide: 'Trace un terrain : les bords et les coins se raccordent tout seuls.' },
    { id: 'gomme', nom: 'Gomme', touche: 'E', types: 'tuiles collisions', aide: 'Vide les cases du calque actif.' },
    { id: 'pot', nom: 'Pot de remplissage', touche: 'G', types: 'tuiles collisions', aide: 'Remplit la zone de cases identiques ; dans une sélection, s\'y limite.' },
    { id: 'rect', nom: 'Rectangle', touche: 'R', types: 'tuiles collisions', aide: 'Glisse pour tracer un rectangle avec le tampon.' },
    { id: 'ligne', nom: 'Ligne', touche: 'L', types: 'tuiles collisions', aide: 'Glisse pour tracer une ligne avec le tampon.' },
    { id: 'pipette', nom: 'Pipette', touche: 'I', types: 'tuiles collisions', aide: 'Clique une case pour en faire le tampon ; glisse pour prendre un bloc.' },
    { id: 'selection', nom: 'Sélection', touche: 'S', types: 'tuiles collisions', aide: 'Glisse pour sélectionner ; glisse la sélection pour la déplacer (Ctrl : la copier).' },
    { id: 'objSel', nom: 'Choisir un objet', touche: 'S', types: 'objets', aide: 'Clique un objet pour le choisir, glisse-le pour le déplacer, tire un coin pour le redimensionner.' },
    { id: 'objPoint', nom: 'Point', touche: 'P', types: 'objets', aide: 'Clique pour poser un point : départ du joueur, apparition d\'un ennemi…' },
    { id: 'objRect', nom: 'Zone', touche: 'R', types: 'objets', aide: 'Glisse pour tracer une zone : porte, déclencheur, coffre…' },
    { id: 'main', nom: 'Main', touche: 'H', types: 'tuiles collisions objets', aide: 'Glisse pour déplacer la vue. Partout : clic du milieu, ou Espace + glisser.' }
  ];

  U.OUTILS = OUTILS;
  U.outil = 'tampon';
  U.tampon = null;                              // bloc de tuiles à poser
  U.tamponCol = M.blocUn(1, 'collisions');      // bloc de collisions à poser
  U.aleatoire = false;
  U.plein = true;
  U.contigu = true;
  U.terrain = null;                             // { jeu (id), i }
  U.objSel = null;                              // id de l'objet choisi
  U.pressePapier = null;
  U.espace = false;

  var scene, toile, geste = null, cumul = 0;

  function outil(id) { return OUTILS.filter(function (o) { return o.id === id; })[0]; }
  U.outilInfo = outil;

  U.tamponActif = function () { return M.calqueActif().type === 'collisions' ? U.tamponCol : U.tampon; };

  // Garde un outil qui convient au calque actif.
  U.accorderOutil = function () {
    var type = M.calqueActif().type;
    if (outil(U.outil).types.indexOf(type) < 0) U.outil = type === 'objets' ? 'objSel' : 'tampon';
    if (U.outil === 'terrain' && !terrainActif()) U.outil = 'tampon';
    scene.dataset.outil = U.outil;
  };

  U.choisirOutil = function (id) {
    var o = outil(id), type = M.calqueActif().type;
    if (!o) return;
    if (o.types.indexOf(type) < 0) {
      U.message(type === 'objets' ? 'Cet outil sert sur un calque de tuiles ou de collisions.' : 'Cet outil sert sur le calque d\'objets.');
      return;
    }
    if (id === 'terrain' && !terrainActif()) {
      var t = premierTerrain();
      if (!t) { U.message('Aucun jeu n\'a de terrain : génère-en un avec Textures, ou « Faire un terrain » depuis une tuile.'); return; }
      U.terrain = t;
    }
    U.outil = id;
    scene.dataset.outil = id;
    if (U.surOutil) U.surOutil();
    U.demander();
  };

  function terrainActif() {
    var j = U.terrain ? M.jeuParId(U.terrain.jeu) : null;
    return j && j.terrains[U.terrain.i] ? { jeu: j, terrain: j.terrains[U.terrain.i] } : null;
  }
  function premierTerrain() {
    var js = M.carte.jeux, k;
    for (k = 0; k < js.length; k++) if (js[k].terrains.length) return { jeu: js[k].id, i: 0 };
    return null;
  }
  U.terrainActif = terrainActif;

  // ---------- Sources ----------
  // Tirage stable : la même case reçoit la même tuile tant que le geste dure.
  function sourceHasard(b, graine) {
    var pleines = Array.prototype.filter.call(b.cases, function (v) { return v !== 0; });
    return function (x, y) {
      var h = (graine | 0) ^ Math.imul(x | 0, 0x27d4eb2d);
      h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h ^= Math.imul(y | 0, 0x165667b1); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
      return pleines.length ? pleines[((h ^ h >>> 16) >>> 0) % pleines.length] : 0;
    };
  }
  function source(b, x, y) { return U.aleatoire && b.type === 'tuiles' ? sourceHasard(b, Math.floor(Math.random() * 1e9)) : M.motif(b, x, y); }

  function decalage(b) { return { x: (b.w - 1) >> 1, y: (b.h - 1) >> 1 }; }

  function gommer(cal, x, y) {
    var t = cal.type === 'tuiles' ? A.terrainDe(M.lire(cal, x, y)) : null;
    if (t) A.poser(cal, x, y, t.jeu, t.terrain, true); else M.poser(cal, x, y, 0);
  }

  // ---------- Gestes sur les cases ----------
  function tracer(cal, x, y) {
    var b, t, d, ax, ay;
    if (geste.outil === 'gomme') { gommer(cal, x, y); return; }
    if (geste.outil === 'terrain') { t = terrainActif(); if (t) A.poser(cal, x, y, t.jeu, t.terrain, false); return; }
    b = geste.bloc;
    if (geste.f) { M.poser(cal, x, y, geste.f(x, y)); return; }
    // Un bloc se répète aligné sur le premier clic.
    d = decalage(b);
    ax = geste.x0 - d.x + Math.floor((x - geste.x0 + d.x) / b.w) * b.w;
    ay = geste.y0 - d.y + Math.floor((y - geste.y0 + d.y) / b.h) * b.h;
    M.poserBloc(cal, ax, ay, b, b.type === 'collisions');
  }

  function dans(r, c) { return r && c.x >= r.x && c.y >= r.y && c.x < r.x + r.w && c.y < r.y + r.h; }
  function rectDe(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 }; }
  function borner(c) { return { x: M.borne(c.x, 0, M.carte.w - 1), y: M.borne(c.y, 0, M.carte.h - 1) }; }

  function prendre(r) {
    var cal = M.calqueActif(), b = M.extraire(cal, r.x, r.y, r.w, r.h), k, cs = M.carte.calques, v;
    if (cal.type === 'tuiles' && r.w === 1 && r.h === 1 && !b.cases[0]) {
      for (k = cs.length - 1; k >= 0; k--) {
        v = cs[k].type === 'tuiles' && cs[k].visible ? M.lire(cs[k], r.x, r.y) : 0;
        if (v) { b.cases[0] = v; break; }
      }
    }
    if (cal.type === 'collisions') U.tamponCol = b;
    else {
      if (!Array.prototype.some.call(b.cases, function (x) { return x !== 0; })) { U.message('Rien à prendre ici : la case est vide.'); return; }
      U.tampon = b;
    }
    if (U.surTampon) U.surTampon(true);
  }

  function debut(e, p) {
    var c = U.caseA(p.x, p.y), cal = M.calqueActif(), o = U.outil, msg, b, lim;
    if (e.button === 2 || (e.button === 0 && (o === 'pipette' || e.altKey))) {
      if (!U.dansCarte(c)) return;
      geste = { type: 'pipette', a: c, b: c, retour: o === 'pipette' || e.button === 2 };
      return;
    }
    if (e.button !== 0) return;
    if (o === 'selection') {
      if (dans(M.sel, c)) {
        msg = M.calqueLibre();
        if (msg) { U.message(msg); return; }
        geste = { type: 'deplacer', a: c, r: { x: M.sel.x, y: M.sel.y, w: M.sel.w, h: M.sel.h }, copie: e.ctrlKey, bouge: false };
      } else geste = { type: 'selection', a: borner(c), b: borner(c), bouge: false };
      return;
    }
    msg = M.calqueLibre();
    if (msg) { U.message(msg); return; }
    b = U.tamponActif();
    if (o !== 'gomme' && o !== 'terrain' && !b) { U.message('Choisis d\'abord une tuile dans le jeu de tuiles, à droite.'); return; }
    if (o === 'terrain' && !terrainActif()) { U.message('Choisis un terrain sous le jeu de tuiles.'); return; }
    if (o === 'pot') {
      if (!U.dansCarte(c)) return;
      lim = dans(M.sel, c) ? M.sel : null;
      M.remplir(cal, c.x, c.y, source(b, c.x, c.y), U.contigu, lim);
      M.valider('Remplir');
      return;
    }
    if (o === 'rect' || o === 'ligne') {
      geste = { type: o, a: c, b: c, f: source(b, c.x, c.y), plein: U.plein };
      forme(cal);
      return;
    }
    geste = { type: 'trait', outil: o, x0: c.x, y0: c.y, dernier: c, bloc: b, f: o === 'tampon' && U.aleatoire && b.type === 'tuiles' ? sourceHasard(b, Math.floor(Math.random() * 1e9)) : null };
    tracer(cal, c.x, c.y);
  }

  function forme(cal) {
    var a = geste.a, b = geste.b, f = geste.f;
    M.revenir();
    if (geste.type === 'rect') M.rectangle(cal, a.x, a.y, b.x, b.y, f, geste.plein);
    else M.ligne(a.x, a.y, b.x, b.y, function (x, y) { M.poser(cal, x, y, f(x, y)); });
  }

  function suite(e, p) {
    var c = U.caseA(p.x, p.y), cal = M.calqueActif(), g = geste, dx, dy;
    if (g.type === 'vue') { U.deplacer(p.x - g.x, p.y - g.y); g.x = p.x; g.y = p.y; return; }
    if (g.type === 'trait') {
      if (c.x === g.dernier.x && c.y === g.dernier.y) return;
      M.ligne(g.dernier.x, g.dernier.y, c.x, c.y, function (x, y) { if (x !== g.dernier.x || y !== g.dernier.y) tracer(cal, x, y); });
      g.dernier = c;
    } else if (g.type === 'rect' || g.type === 'ligne') {
      if (c.x === g.b.x && c.y === g.b.y) return;
      g.b = c;
      forme(cal);
    } else if (g.type === 'pipette') {
      g.b = borner(c);
    } else if (g.type === 'selection') {
      g.b = borner(c);
      if (g.b.x !== g.a.x || g.b.y !== g.a.y) g.bouge = true;
      if (g.bouge) M.sel = rectDe(g.a, g.b);
    } else if (g.type === 'deplacer') {
      dx = c.x - g.a.x; dy = c.y - g.a.y;
      if (g.dx === dx && g.dy === dy) return;
      g.dx = dx; g.dy = dy; g.bouge = true;
      M.revenir();
      M.deplacerZone(cal, g.r, dx, dy, g.copie);
      M.sel = { x: g.r.x + dx, y: g.r.y + dy, w: g.r.w, h: g.r.h };
    } else suiteObjets(e, p);
    U.demander();
  }

  function fin() {
    var g = geste, s;
    geste = null;
    if (!g) return;
    if (g.type === 'trait') M.valider(g.outil === 'gomme' ? 'Gommer' : g.outil === 'terrain' ? 'Tracer un terrain' : 'Poser');
    else if (g.type === 'rect') M.valider('Rectangle');
    else if (g.type === 'ligne') M.valider('Ligne');
    else if (g.type === 'pipette') {
      prendre(rectDe(g.a, g.b));
      if (g.retour && M.calqueActif().type !== 'objets') U.choisirOutil('tampon');
    } else if (g.type === 'selection') {
      if (!g.bouge) M.sel = null;
      if (U.surSelection) U.surSelection();
    } else if (g.type === 'deplacer') {
      s = M.sel;
      if (g.bouge) {
        // Une sélection sortie de la carte est ramenée à ce qui en reste.
        s = { x: Math.max(0, s.x), y: Math.max(0, s.y), w: Math.min(M.carte.w, s.x + s.w) - Math.max(0, s.x), h: Math.min(M.carte.h, s.y + s.h) - Math.max(0, s.y) };
        M.sel = s.w > 0 && s.h > 0 ? s : null;
        M.valider(g.copie ? 'Copier la sélection' : 'Déplacer la sélection');
      }
    } else finObjets(g);
    U.demander();
  }

  // ---------- Gestes sur les objets ----------
  function aimant(v, e) { var pas = e.altKey ? 1 : M.carte.tc / 2; return Math.round(v / pas) * pas; }

  // L'objet sous le point, et la poignée touchée s'il est déjà choisi.
  function objetSous(p) {
    var l = M.calqueDeType('objets').objets, pt = U.pointA(p.x, p.y), tol = PRISE * U.echelle() * M.carte.tc / U.ppt, k, o, coins, i;
    o = U.objSel ? M.objet(U.objSel) : null;
    if (o && (o.w || o.h)) {
      coins = [[o.x, o.y], [o.x + o.w, o.y], [o.x, o.y + o.h], [o.x + o.w, o.y + o.h]];
      for (i = 0; i < 4; i++) if (Math.abs(pt.x - coins[i][0]) <= tol && Math.abs(pt.y - coins[i][1]) <= tol) return { o: o, coin: i };
    }
    for (k = l.length - 1; k >= 0; k--) {
      o = l[k];
      if (o.w || o.h ? pt.x >= o.x - tol / 2 && pt.y >= o.y - tol / 2 && pt.x <= o.x + o.w + tol / 2 && pt.y <= o.y + o.h + tol / 2 : Math.abs(pt.x - o.x) <= tol * 1.3 && Math.abs(pt.y - o.y) <= tol * 1.3) return { o: o, coin: -1 };
    }
    return null;
  }

  function debutObjets(e, p) {
    var pt = U.pointA(p.x, p.y), msg = M.calqueLibre(), t, o, c = M.carte;
    if (e.button !== 0) return;
    if (msg) { U.message(msg); return; }
    if (U.outil === 'objSel') {
      t = objetSous(p);
      U.objSel = t ? t.o.id : null;
      if (t) geste = { type: 'objet', id: t.o.id, coin: t.coin, px: pt.x, py: pt.y, o: { x: t.o.x, y: t.o.y, w: t.o.w, h: t.o.h }, bouge: false };
      if (U.surObjet) U.surObjet();
    } else if (U.outil === 'objPoint') {
      o = M.objetAjouter({ nom: '', type: '', x: M.borne(aimant(pt.x, e), 0, c.w * c.tc), y: M.borne(aimant(pt.y, e), 0, c.h * c.tc) });
      U.objSel = o.id;
      M.valider('Poser un point');
      if (U.surObjet) U.surObjet(true);
    } else if (U.outil === 'objRect') {
      geste = { type: 'zone', x0: aimant(pt.x, e), y0: aimant(pt.y, e), x1: aimant(pt.x, e), y1: aimant(pt.y, e) };
    }
    U.demander();
  }

  function suiteObjets(e, p) {
    var g = geste, pt = U.pointA(p.x, p.y), o, x, y, fx, fy;
    if (g.type === 'zone') { g.x1 = aimant(pt.x, e); g.y1 = aimant(pt.y, e); return; }
    if (g.type !== 'objet') return;
    o = g.o;
    if (g.coin < 0) {
      x = aimant(o.x + pt.x - g.px, e); y = aimant(o.y + pt.y - g.py, e);
      if (M.objet(g.id).x === x && M.objet(g.id).y === y) return;
      M.objetModifier(g.id, { x: x, y: y });
    } else {
      // Le coin opposé à la poignée ne bouge pas.
      fx = g.coin & 1 ? o.x : o.x + o.w; fy = g.coin & 2 ? o.y : o.y + o.h;
      x = aimant(pt.x, e); y = aimant(pt.y, e);
      M.objetModifier(g.id, { x: Math.min(x, fx), y: Math.min(y, fy), w: Math.abs(x - fx), h: Math.abs(y - fy) });
    }
    g.bouge = true;
    if (U.surObjet) U.surObjet();
  }

  function finObjets(g) {
    var o;
    if (g.type === 'zone') {
      if (g.x1 !== g.x0 && g.y1 !== g.y0) {
        o = M.objetAjouter({ nom: '', type: '', x: Math.min(g.x0, g.x1), y: Math.min(g.y0, g.y1), w: Math.abs(g.x1 - g.x0), h: Math.abs(g.y1 - g.y0) });
        U.objSel = o.id;
        M.valider('Tracer une zone');
        if (U.surObjet) U.surObjet(true);
      }
    } else if (g.type === 'objet' && g.bouge) {
      o = M.objet(g.id);
      // Une zone écrasée à plat par sa poignée reprend sa taille d'avant.
      if (g.coin >= 0 && (!o.w || !o.h)) M.revenir();
      else M.valider(g.coin < 0 ? 'Déplacer l\'objet' : 'Redimensionner l\'objet');
      if (U.surObjet) U.surObjet();
    }
  }

  // ---------- Aperçu de l'outil ----------
  function apercu(g, t) {
    var cal = M.calqueActif(), s = U.survol, o = U.outil, b, d, i, j, v, X, Y, k, r;
    if (geste && geste.type === 'pipette') { r = rectDe(geste.a, geste.b); U.cadre(r.x, r.y, r.w, r.h, U.CYAN); return; }
    if (geste && geste.type === 'zone') {
      k = U.ppt / M.carte.tc;
      X = Math.round(U.ox + Math.min(geste.x0, geste.x1) * k); Y = Math.round(U.oy + Math.min(geste.y0, geste.y1) * k);
      g.fillStyle = 'rgba(92,184,200,.25)'; g.fillRect(X, Y, Math.round(Math.abs(geste.x1 - geste.x0) * k), Math.round(Math.abs(geste.y1 - geste.y0) * k));
      g.strokeStyle = U.CYAN; g.lineWidth = 2; g.strokeRect(X + 1, Y + 1, Math.round(Math.abs(geste.x1 - geste.x0) * k) - 2, Math.round(Math.abs(geste.y1 - geste.y0) * k) - 2);
      return;
    }
    if (geste || !s || !U.dansCarte(s) || cal.type === 'objets' || U.espace || o === 'main') return;
    if (o === 'tampon' && (b = U.tamponActif()) && !cal.verrou) {
      d = decalage(b);
      if (U.aleatoire && b.type === 'tuiles') { U.cadre(s.x, s.y, 1, 1, U.AMBRE); return; }
      g.globalAlpha = 0.72;
      for (j = 0; j < b.h; j++) {
        for (i = 0; i < b.w; i++) {
          v = b.cases[j * b.w + i];
          X = U.ox + (s.x - d.x + i) * U.ppt; Y = U.oy + (s.y - d.y + j) * U.ppt;
          if (!v) continue;
          if (b.type === 'collisions') U.dessinerCollision(g, v, X, Y, U.ppt); else U.dessinerTuile(g, v, X, Y, U.ppt, t);
        }
      }
      g.globalAlpha = 1;
      U.cadre(s.x - d.x, s.y - d.y, b.w, b.h, U.AMBRE);
    } else U.cadre(s.x, s.y, 1, 1, o === 'gomme' ? U.CORAIL : o === 'selection' || o === 'pipette' ? '#fff' : U.AMBRE);
  }

  // ---------- Édition ----------
  function calqueDeCases() {
    var cal = M.calqueActif();
    if (cal.type === 'objets') { U.message('Sur le calque d\'objets, cette commande n\'a pas d\'effet.'); return null; }
    return cal;
  }

  U.copier = function () {
    var cal = calqueDeCases(), s = M.sel;
    if (!cal) return false;
    if (!s) { U.message('Sélectionne d\'abord une zone avec l\'outil Sélection (S).'); return false; }
    U.pressePapier = M.extraire(cal, s.x, s.y, s.w, s.h);
    U.message('Zone de ' + s.w + ' × ' + s.h + ' cases copiée. Ctrl+V pour la poser.');
    return true;
  };
  U.couper = function () {
    var cal = M.calqueActif(), msg;
    if (!U.copier()) return;
    msg = M.calqueLibre();
    if (msg) { U.message(msg); return; }
    M.effacer(cal, M.sel.x, M.sel.y, M.sel.w, M.sel.h);
    M.valider('Couper');
  };
  U.coller = function () {
    var cal = calqueDeCases(), b = U.pressePapier;
    if (!cal) return;
    if (!b) { U.message('Rien à coller : copie d\'abord une zone (Ctrl+C).'); return; }
    if (b.type !== cal.type) { U.message('Le bloc copié vient d\'un calque de ' + (b.type === 'tuiles' ? 'tuiles' : 'collisions') + ' : choisis un calque du même genre.'); return; }
    if (b.type === 'collisions') U.tamponCol = b; else U.tampon = b;
    U.aleatoire = false;
    if (U.surTampon) U.surTampon(false);
    U.choisirOutil('tampon');
    U.message('Clique sur la carte pour poser le bloc copié.');
  };
  U.supprimer = function () {
    var cal = M.calqueActif(), msg = M.calqueLibre();
    if (msg) { U.message(msg); return; }
    if (cal.type === 'objets') {
      if (U.objSel && M.objetSupprimer(U.objSel)) { U.objSel = null; M.valider('Supprimer l\'objet'); }
      return;
    }
    if (!M.sel) { U.message('Sélectionne d\'abord la zone à vider.'); return; }
    M.effacer(cal, M.sel.x, M.sel.y, M.sel.w, M.sel.h);
    M.valider('Vider la sélection');
  };
  U.toutSelectionner = function () {
    if (!calqueDeCases()) return;
    M.sel = { x: 0, y: 0, w: M.carte.w, h: M.carte.h };
    U.choisirOutil('selection');
  };
  U.deselectionner = function () { M.sel = null; U.demander(); };

  // Retourne ou pivote le tampon ; avec l'outil Sélection, le contenu de la sélection.
  U.orienter = function (quoi) {
    var cal = calqueDeCases(), s = M.sel, b, msg;
    if (!cal) return;
    function f(x) { return quoi === 'h' || quoi === 'v' ? M.blocRetourner(x, quoi) : M.blocPivoter(x, quoi === 'd' ? 1 : -1); }
    if (U.outil === 'selection' && s) {
      msg = M.calqueLibre();
      if (msg) { U.message(msg); return; }
      if (quoi !== 'h' && quoi !== 'v' && s.w !== s.h) { U.message('Seule une sélection carrée peut pivoter sur place.'); return; }
      b = f(M.extraire(cal, s.x, s.y, s.w, s.h));
      M.poserBloc(cal, s.x, s.y, b, true);
      M.valider(quoi === 'h' || quoi === 'v' ? 'Retourner la sélection' : 'Pivoter la sélection');
      return;
    }
    b = U.tamponActif();
    if (!b) return;
    if (cal.type === 'collisions') U.tamponCol = f(b); else U.tampon = f(b);
    if (U.surTampon) U.surTampon(false);
    U.demander();
  };

  // ---------- Événements ----------
  function survoler(p) {
    var c = p ? U.caseA(p.x, p.y) : null, s = U.survol, t = U.tailleToile();
    if (p && (p.x < t.regle || p.y < t.regle)) c = null;
    if ((c && s && c.x === s.x && c.y === s.y) || (!c && !s)) return;
    U.survol = c;
    if (U.surSurvol) U.surSurvol();
    U.demander();
  }

  U.gesteEnCours = function () { return !!geste; };

  U.initOutils = function () {
    scene = document.querySelector('#scene'); toile = document.querySelector('#toile');
    U.apercuOutil = apercu;

    toile.addEventListener('pointerdown', function (e) {
      var p;
      if (U.essai || geste) return;
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      p = U.px(e);
      try { toile.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      if (e.button === 1 || (e.button === 0 && (U.espace || U.outil === 'main'))) { geste = { type: 'vue', x: p.x, y: p.y }; scene.classList.add('saisie'); return; }
      if (M.calqueActif().type === 'objets') debutObjets(e, p); else debut(e, p);
      if (geste) geste.bouton = e.button;
      U.demander();
    });
    toile.addEventListener('pointermove', function (e) {
      var p = U.px(e);
      if (U.essai) return;
      survoler(p);
      if (geste) suite(e, p);
    });
    function lacher(e) {
      scene.classList.remove('saisie');
      if (geste && geste.type === 'vue') { geste = null; return; }
      if (geste) { if (e.type === 'pointercancel') { M.revenir(); geste = null; U.demander(); } else fin(); }
    }
    toile.addEventListener('pointerup', lacher);
    toile.addEventListener('pointercancel', lacher);
    toile.addEventListener('pointerleave', function () { if (!geste) survoler(null); });
    toile.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    toile.addEventListener('auxclick', function (e) { e.preventDefault(); });
    toile.addEventListener('dblclick', function () { if (M.calqueActif().type === 'objets' && U.objSel && U.surObjet) U.surObjet(true); });

    // Molette : un cran de zoom, la case visée reste sous le curseur.
    scene.addEventListener('wheel', function (e) {
      var p, d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1), n;
      e.preventDefault();
      if (U.essai || !d) return;
      if (cumul && (cumul > 0) !== (d > 0)) cumul = 0;
      cumul += d;
      if (Math.abs(cumul) < SEUIL_MOLETTE) return;
      n = cumul > 0 ? -1 : 1;
      cumul = 0;
      p = U.px(e);
      U.zoomer(n, p.x, p.y);
      survoler(p);
    }, { passive: false });
  };
})();
