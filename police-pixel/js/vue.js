(function () {
  'use strict';

  var PP = window.PP, GL = PP.GL, GX = PP.GX;

  var ZOOMS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];
  var CRAN = 60;               // défilement de molette qui vaut un cran de zoom
  var TEINTES = {
    fond: '#27282c', table: '#2f3136', papier: '#e9e8e3', encre: '#17181b', dehors: '#c9ccd3',
    grille: 'rgba(23, 24, 27, .14)', grilleTable: 'rgba(255, 255, 255, .055)',
    base: '#d9513c', repere: '#3d8fd1', discret: '#8d919b', accent: '#2f7fc4', voisin: 'rgba(23, 24, 27, .22)', voisinDehors: 'rgba(201, 204, 211, .3)'
  };
  var NOMS = { crayon: 'Crayon', gomme: 'Gomme', ligne: 'Ligne', rect: 'Rectangle', pot: 'Remplissage', selection: 'Sélection', main: 'Main' };
  var ASTUCES = {
    crayon: 'Clic gauche pose, clic droit efface.',
    gomme: 'Efface les pixels touchés.',
    ligne: 'Tire une droite ; clic droit pour effacer le long de la droite.',
    rect: 'Tire un rectangle ; clic droit pour effacer.',
    pot: 'Remplit la zone touchée, sans sortir de la case du caractère.',
    selection: 'Tire un cadre, puis déplace-le. Ctrl+C copie, Ctrl+V colle, y compris dans un autre caractère.',
    main: 'Tire pour déplacer la vue. Partout ailleurs : bouton du milieu ou barre d\'espace.'
  };

  var $ = function (s) { return document.querySelector(s); };

  // ---------- État de l'interface ----------
  var U = PP.ui = {
    outil: 'crayon', plein: false, zoom: 16, ox: 60, oy: 20, reperes: true, voisins: false,
    sel: null,            // { x, y, l, h, flot } : flot est le morceau soulevé, pas encore reposé
    espace: false, survol: null, police: 'sans-serif'
  };
  U.TEINTES = TEINTES;
  var scene, toile, ctx, geste = null, attente = false, molette = 0, L = 0, H = 0;

  U.message = function (texte) {
    var el = $('#etatMsg');
    el.textContent = texte || '';
    clearTimeout(U.message.t);
    if (texte) U.message.t = setTimeout(function () { el.textContent = ''; }, 6000);
  };

  // Peint un caractère du modèle : (x, y) est le coin de son origine, e la taille d'un pixel.
  U.peindre = function (c, pix, h, x, y, e, teinte) {
    var i, j, o;
    c.fillStyle = teinte;
    for (j = 0; j < h; j++) {
      o = j * GL;
      for (i = 0; i < GL; i++) if (pix[o + i]) c.fillRect(x + (i - GX) * e, y + j * e, e, e);
    }
  };

  // ---------- Rendu ----------
  U.redessiner = function () {
    if (attente) return;
    attente = true;
    requestAnimationFrame(dessiner);
  };

  function tailler() {
    var r = window.devicePixelRatio || 1, l = scene.clientWidth, h = scene.clientHeight;
    if (!l || !h) return;
    L = l; H = h;
    toile.width = Math.round(l * r); toile.height = Math.round(h * r);
    toile.style.width = l + 'px'; toile.style.height = h + 'px';
    ctx.setTransform(r, 0, 0, r, 0, 0);
    dessiner();
  }

  function horizontale(y, teinte, nom, epais) {
    var py = U.oy + y * U.zoom;
    ctx.fillStyle = teinte;
    ctx.fillRect(0, py - (epais ? 1 : 0), L, epais ? 2 : 1);
    ctx.fillText(nom, 6, py - 3);
  }

  function dessiner() {
    attente = false;
    if (!PP.police || !L) return;
    var p = PP.police, z = U.zoom, code = p.courant, g = p.glyphes[code], av = PP.avance(code), pix = PP.pixels(code), x, y, i, o, d, ordre, k, s, f;
    ctx.fillStyle = TEINTES.fond; ctx.fillRect(0, 0, L, H);
    // La table (tout ce que le caractère peut occuper) et sa case de papier.
    ctx.fillStyle = TEINTES.table; ctx.fillRect(U.ox - GX * z, U.oy, GL * z, p.h * z);
    ctx.fillStyle = TEINTES.papier; ctx.fillRect(U.ox, U.oy, av * z, p.h * z);
    if (U.voisins) {
      ordre = PP.ordre(); k = ordre.indexOf(code);
      if (k > 0) {
        d = PP.avance(ordre[k - 1]) + p.interlettre + PP.crenage(ordre[k - 1], code);
        U.peindre(ctx, PP.pixels(ordre[k - 1]), p.h, U.ox - d * z, U.oy, z, TEINTES.voisinDehors);
      }
      if (k < ordre.length - 1) {
        d = av + p.interlettre + PP.crenage(code, ordre[k + 1]);
        U.peindre(ctx, PP.pixels(ordre[k + 1]), p.h, U.ox + d * z, U.oy, z, TEINTES.voisinDehors);
      }
    }
    // L'encre : noire sur le papier, claire au-delà de la case ; l'accent d'un composé en bleu.
    var pa = null, pl = null;
    if (g.comp && p.glyphes[g.comp.accent]) { pa = PP.pixels(g.comp.accent); pl = PP.placement(code); }
    for (y = 0; y < p.h; y++) {
      o = y * GL;
      for (x = 0; x < GL; x++) {
        if (!pix[o + x]) continue;
        i = x - GX;
        ctx.fillStyle = i >= 0 && i < av ? TEINTES.encre : TEINTES.dehors;
        if (pa && y - pl.dy >= 0 && y - pl.dy < p.h && x - pl.dx >= 0 && x - pl.dx < GL && pa[(y - pl.dy) * GL + x - pl.dx]) ctx.fillStyle = TEINTES.accent;
        ctx.fillRect(U.ox + i * z, U.oy + y * z, z, z);
      }
    }
    s = U.sel;
    if (s && s.flot) {
      for (y = 0; y < s.h; y++) for (x = 0; x < s.l; x++) {
        if (!s.flot.pix[y * s.l + x]) continue;
        ctx.fillStyle = TEINTES.accent;
        ctx.fillRect(U.ox + (s.x + x) * z, U.oy + (s.y + y) * z, z, z);
      }
    }
    // Quadrillage.
    if (z >= 5) {
      ctx.fillStyle = TEINTES.grilleTable;
      for (x = -GX; x <= GL - GX; x++) ctx.fillRect(U.ox + x * z, U.oy, 1, p.h * z);
      for (y = 0; y <= p.h; y++) ctx.fillRect(U.ox - GX * z, U.oy + y * z, GL * z, 1);
      ctx.fillStyle = TEINTES.grille;
      for (x = 1; x < av; x++) ctx.fillRect(U.ox + x * z, U.oy, 1, p.h * z);
      for (y = 1; y < p.h; y++) ctx.fillRect(U.ox, U.oy + y * z, av * z, 1);
    }
    // Repères.
    ctx.font = '14px ' + U.police; ctx.textBaseline = 'alphabetic';
    if (U.reperes) {
      f = p.hasc === p.hcap;
      if (!f) horizontale(p.base - p.hasc, TEINTES.discret, 'ascendantes');
      horizontale(p.base - p.hcap, TEINTES.repere, f ? 'capitales et ascendantes' : 'capitales');
      horizontale(p.base - p.hx, TEINTES.repere, 'hauteur d\'x');
      if (p.hdesc) horizontale(p.base + p.hdesc, TEINTES.discret, 'descendantes');
      horizontale(p.base, TEINTES.base, 'ligne de base', true);
    }
    // Bords de la case : l'origine à gauche, la chasse à droite avec sa poignée.
    ctx.fillStyle = TEINTES.discret;
    ctx.fillRect(U.ox, U.oy - 14, 1, p.h * z + 28);
    ctx.fillStyle = p.fixe ? TEINTES.discret : TEINTES.repere;
    ctx.fillRect(U.ox + av * z, U.oy - 14, 1, p.h * z + 28);
    if (!p.fixe && !g.comp) { ctx.fillRect(U.ox + av * z - 4, U.oy - 22, 9, 9); ctx.fillRect(U.ox + av * z - 4, U.oy + p.h * z + 13, 9, 9); }
    ctx.fillStyle = TEINTES.discret;
    ctx.fillText('chasse ' + av, U.ox + av * z + 10, U.oy - 14);
    // Sélection.
    if (s) {
      ctx.strokeStyle = TEINTES.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(U.ox + s.x * z, U.oy + s.y * z, s.l * z, s.h * z);
      ctx.setLineDash([]);
    }
    $('#zoomVal').textContent = z + '×';
  }

  // ---------- Vue : zoom et déplacement ----------
  function borner() {
    var z = U.zoom, p = PP.police, marge = 48;
    U.ox = Math.round(PP.borne(U.ox, marge - (GL - GX) * z, L - marge + GX * z));
    U.oy = Math.round(PP.borne(U.oy, marge - p.h * z, H - marge));
  }

  // Change le zoom en gardant fixe le point de la grille situé sous (mx, my).
  U.zoomer = function (sens, mx, my) {
    var i = ZOOMS.indexOf(U.zoom), n, z;
    if (i < 0) i = 8;
    n = PP.borne(i + sens, 0, ZOOMS.length - 1);
    if (n === i) return;
    if (mx === undefined) { mx = L / 2; my = H / 2; }
    z = ZOOMS[n];
    U.ox = mx - (mx - U.ox) / U.zoom * z;
    U.oy = my - (my - U.oy) / U.zoom * z;
    U.zoom = z;
    borner();
    U.redessiner();
  };

  U.ajuster = function () {
    var p = PP.police, av = Math.max(PP.avance(p.courant), 4), i, z = ZOOMS[0];
    if (!L) return;
    for (i = 0; i < ZOOMS.length; i++) if ((av + 10) * ZOOMS[i] <= L - 150 && (p.h + 1.5) * ZOOMS[i] <= H - 30) z = ZOOMS[i];
    U.zoom = z;
    U.ox = Math.round((L + 90 - av * z) / 2);
    U.oy = Math.round((H - p.h * z) / 2);
    U.redessiner();
  };

  // ---------- Sélection ----------
  // Repose le morceau soulevé : c'est à ce moment que le déplacement devient une étape d'historique.
  U.ancrer = function () {
    var s = U.sel;
    if (!s || !s.flot) return false;
    PP.poser(PP.police.courant, s.flot, s.x, s.y);
    s.flot = null;
    PP.valider('Déplacer la sélection');
    return true;
  };
  U.deselectionner = function () {
    U.ancrer();
    if (U.sel) { U.sel = null; U.redessiner(); }
  };
  function soulever() {
    var s = U.sel, code = PP.police.courant;
    if (s.flot) return;
    s.flot = PP.extraire(code, s.x, s.y, s.l, s.h);
    PP.vider(code, s.x, s.y, s.l, s.h);
  }
  function libre() {
    var g = PP.glyphe(PP.police.courant);
    if (g.comp) { U.message('Caractère composé : Maj+flèches déplace l\'accent ; détache-le (fiche du caractère) pour le retoucher.'); return false; }
    return true;
  }

  U.toutSelectionner = function () {
    var e = PP.encre(PP.police.courant);
    U.ancrer();
    if (!e || !libre()) return;
    U.sel = { x: e.x0, y: e.y0, l: e.x1 - e.x0 + 1, h: e.y1 - e.y0 + 1, flot: null };
    U.choisir('selection');
  };
  U.copier = function () {
    var s = U.sel, code = PP.police.courant, e = PP.encre(code), m;
    if (s) m = s.flot ? { l: s.l, h: s.h, pix: new Uint8Array(s.flot.pix) } : PP.extraire(code, s.x, s.y, s.l, s.h);
    else if (e) { m = PP.extraire(code, e.x0, e.y0, e.x1 - e.x0 + 1, e.y1 - e.y0 + 1); s = { x: e.x0, y: e.y0 }; }
    else return false;
    m.x = s.x; m.y = s.y;
    PP.pressePapier = m;
    U.message(U.sel ? 'Sélection copiée.' : 'Dessin du caractère copié.');
    return true;
  };
  U.couper = function () {
    var s = U.sel;
    if (!s || !libre() || !U.copier()) return;
    if (!s.flot) PP.vider(PP.police.courant, s.x, s.y, s.l, s.h);
    U.sel = null;
    PP.valider('Couper');
  };
  U.coller = function () {
    var m = PP.pressePapier, p = PP.police;
    if (!m || !libre()) return;
    U.ancrer();
    U.sel = { x: m.x, y: PP.borne(m.y, 0, Math.max(0, p.h - m.h)), l: m.l, h: Math.min(m.h, p.h), flot: { l: m.l, h: m.h, pix: new Uint8Array(m.pix) } };
    U.choisir('selection');
    U.message('Collé : déplace le morceau, puis Entrée ou un clic ailleurs pour le poser.');
  };
  U.supprimer = function () {
    var s = U.sel;
    if (!s || !libre()) return false;
    if (!s.flot) PP.vider(PP.police.courant, s.x, s.y, s.l, s.h);
    U.sel = null;
    PP.valider('Effacer la sélection');
    return true;
  };
  // Déplace d'un pixel le morceau sélectionné, l'accent d'un composé, ou tout le dessin.
  U.pousser = function (dx, dy) {
    var s = U.sel, code = PP.police.courant, g = PP.glyphe(code);
    if (s) {
      soulever();
      s.x = PP.borne(s.x + dx, -GX, GL - GX - s.l); s.y = PP.borne(s.y + dy, -s.h + 1, PP.police.h - 1);
      U.retouche();
    } else if (g.comp) {
      PP.ajusterAccent(code, dx, dy);
      PP.valider('Déplacer l\'accent');
    } else if (PP.decaler(code, dx, dy)) PP.valider('Déplacer le dessin');
    else U.message(PP.encre(code) ? 'Le dessin ne peut pas sortir de la hauteur de la police.' : 'Rien à déplacer.');
  };
  // Abandonne le geste ou le morceau en cours. Rend vrai s'il y avait quelque chose à abandonner.
  U.abandonner = function () {
    var fait = !!geste || !!U.sel;
    if (geste && geste.modifie || U.sel && U.sel.flot) { geste = null; U.sel = null; PP.revenir(); }
    geste = null; U.sel = null;
    U.redessiner();
    return fait;
  };
  // Annuler pendant qu'un morceau est soulevé : on le repose d'abord là où il a été pris.
  U.avantHistorique = function () {
    if (geste || (U.sel && U.sel.flot)) { U.abandonner(); return true; }
    U.sel = null;
    return false;
  };

  // ---------- Souris ----------
  function position(e) {
    var r = toile.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    return { mx: mx, my: my, x: Math.floor((mx - U.ox) / U.zoom), y: Math.floor((my - U.oy) / U.zoom) };
  }
  function surPoignee(q) {
    var p = PP.police, px = U.ox + PP.avance(p.courant) * U.zoom;
    return !p.fixe && Math.abs(q.mx - px) <= 7 && (q.my < U.oy - 2 || q.my > U.oy + p.h * U.zoom + 2) && q.my > U.oy - 26 && q.my < U.oy + p.h * U.zoom + 26;
  }
  function dansSel(q) { var s = U.sel; return s && q.x >= s.x && q.x < s.x + s.l && q.y >= s.y && q.y < s.y + s.h; }

  function presse(e) {
    var q = position(e), code = PP.police.courant, g = PP.glyphe(code), v;
    if (geste) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    toile.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (e.button === 1 || U.espace || U.outil === 'main') {
      geste = { type: 'main', mx: q.mx, my: q.my, ox: U.ox, oy: U.oy };
      scene.classList.add('tire');
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    if (surPoignee(q) && !g.comp) { U.ancrer(); geste = { type: 'chasse', av: PP.avance(code) }; return; }
    if (!libre()) return;
    if (U.outil === 'selection') {
      if (dansSel(q)) { soulever(); geste = { type: 'deplace', dx: q.x - U.sel.x, dy: q.y - U.sel.y, modifie: true }; }
      else { U.ancrer(); U.sel = null; geste = { type: 'cadre', x: q.x, y: q.y }; }
      U.retouche();
      return;
    }
    U.deselectionner();
    v = e.button === 0 && U.outil !== 'gomme' ? 1 : 0;
    if (U.outil === 'pot') {
      if (PP.remplir(code, q.x, q.y, v)) PP.valider('Remplir');
      else U.message('Rien à remplir ici : le remplissage reste dans la case du caractère.');
      return;
    }
    g = PP.ecrire(code);
    geste = { type: U.outil === 'crayon' || U.outil === 'gomme' ? 'trait' : 'forme', x: q.x, y: q.y, v: v, origine: new Uint8Array(g.pix), modifie: true };
    if (geste.type === 'trait') PP.point(code, q.x, q.y, v);
    else tracerForme(q);
    U.retouche();
  }

  function tracerForme(q) {
    var code = PP.police.courant;
    PP.ecrire(code).pix.set(geste.origine);
    if (U.outil === 'ligne') PP.ligne(code, geste.x, geste.y, q.x, q.y, geste.v);
    else PP.rect(code, geste.x, geste.y, q.x, q.y, geste.v, U.plein);
  }

  function bouge(e) {
    var q = position(e), p = PP.police, code = p.courant, s, av;
    U.survol = q;
    $('#etatPos').textContent = q.y >= 0 && q.y < p.h && q.x >= -GX && q.x < GL - GX ? 'x ' + q.x + ', y ' + (p.base - 1 - q.y) : '–';
    if (!geste) {
      scene.classList.toggle('poignee', surPoignee(q) && !PP.glyphe(code).comp);
      scene.classList.toggle('dans', U.outil === 'selection' && !!dansSel(q));
      return;
    }
    if (geste.type === 'main') { U.ox = geste.ox + q.mx - geste.mx; U.oy = geste.oy + q.my - geste.my; borner(); U.redessiner(); return; }
    if (geste.type === 'chasse') {
      av = PP.borne(Math.round((q.mx - U.ox) / U.zoom), 0, PP.AV_MAX);
      if (av !== PP.avance(code)) { PP.reglerAvance(code, av); geste.modifie = true; U.retouche(); }
      return;
    }
    if (geste.type === 'trait') {
      if (q.x === geste.x && q.y === geste.y) return;
      PP.ligne(code, geste.x, geste.y, q.x, q.y, geste.v);
      geste.x = q.x; geste.y = q.y;
    } else if (geste.type === 'forme') tracerForme(q);
    else if (geste.type === 'cadre') {
      s = { x: Math.min(geste.x, q.x), y: Math.min(geste.y, q.y), flot: null };
      s.l = Math.abs(q.x - geste.x) + 1; s.h = Math.abs(q.y - geste.y) + 1;
      s.x = PP.borne(s.x, -GX, GL - GX - 1); s.y = PP.borne(s.y, 0, p.h - 1);
      s.l = Math.min(s.l, GL - GX - s.x); s.h = Math.min(s.h, p.h - s.y);
      U.sel = s; geste.bouge = true;
    } else if (geste.type === 'deplace') {
      s = U.sel;
      s.x = PP.borne(q.x - geste.dx, -GX, GL - GX - s.l); s.y = PP.borne(q.y - geste.dy, -s.h + 1, p.h - 1);
    }
    U.retouche();
  }

  function relache(e) {
    var g = geste;
    if (!g) return;
    geste = null;
    scene.classList.remove('tire');
    try { toile.releasePointerCapture(e.pointerId); } catch (err) { /* capture déjà rendue */ }
    if (g.type === 'trait' || g.type === 'forme') PP.valider(NOMS[U.outil]);
    else if (g.type === 'chasse' && g.modifie) PP.valider('Régler la chasse');
    else if (g.type === 'cadre' && !g.bouge) { U.sel = null; U.redessiner(); }
  }

  function roule(e) {
    var q = position(e), n;
    e.preventDefault();
    // Une molette à crans envoie environ 100 par cran ; un pavé tactile, beaucoup de petites valeurs.
    molette += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    n = molette > 0 ? Math.floor(molette / CRAN) : Math.ceil(molette / CRAN);
    if (!n) return;
    molette -= n * CRAN;
    U.zoomer(n > 0 ? -1 : 1, q.mx, q.my);
  }

  // ---------- Outils ----------
  var ICONES = {
    crayon: '<path d="M4 16l1-4 8-8 3 3-8 8z"/><path d="M11 6l3 3"/>',
    gomme: '<path d="M8 16h8"/><path d="M4 12l7-7 5 5-6 6H7z"/><path d="M8 8l5 5"/>',
    ligne: '<path d="M4 16L16 4"/>',
    rect: '<rect x="4" y="5" width="12" height="10"/>',
    pot: '<path d="M9 4l6 6-5 5-5-5 5-5z"/><path d="M5 10h10"/><path class="plein" d="M16.5 13c1 1.6 1 2.6 0 3.2-1-.6-1-1.6 0-3.2z"/>',
    selection: '<rect x="4" y="4" width="12" height="12" stroke-dasharray="2.5 2"/>',
    main: '<path d="M7 10V5.5a1 1 0 0 1 2 0V9V4.5a1 1 0 0 1 2 0V9V5.5a1 1 0 0 1 2 0V10V7.5a1 1 0 0 1 2 0V12c0 3-2 5-4.5 5S7 15.5 5 12.5L4 11a1 1 0 0 1 1.6-1.2z"/>'
  };
  var TOUCHES = { crayon: 'C', gomme: 'G', ligne: 'L', rect: 'R', pot: 'P', selection: 'S', main: 'M' };
  var ACTIONS = [
    ['gauche', 'Déplacer le dessin d\'un pixel à gauche (Maj+←)', '<path d="M15 10H5M9 6l-4 4 4 4"/>'],
    ['droite', 'Déplacer le dessin d\'un pixel à droite (Maj+→)', '<path d="M5 10h10M11 6l4 4-4 4"/>'],
    ['haut', 'Déplacer le dessin d\'un pixel vers le haut (Maj+↑)', '<path d="M10 15V5M6 9l4-4 4 4"/>'],
    ['bas', 'Déplacer le dessin d\'un pixel vers le bas (Maj+↓)', '<path d="M10 5v10M6 11l4 4 4-4"/>'],
    ['retournerH', 'Retourner gauche-droite (H)', '<path d="M10 3v14" stroke-dasharray="2 2"/><path d="M7 6l-4 4 4 4z"/><path class="plein" d="M13 6l4 4-4 4z"/>'],
    ['retournerV', 'Retourner haut-bas (V)', '<path d="M3 10h14" stroke-dasharray="2 2"/><path d="M6 7l4-4 4 4z"/><path class="plein" d="M6 13l4 4 4-4z"/>']
  ];

  U.choisir = function (outil) {
    if (!NOMS[outil]) return;
    if (outil !== 'selection') U.deselectionner();
    U.outil = outil;
    scene.dataset.outil = outil;
    document.querySelectorAll('.outil[data-outil]').forEach(function (b) { b.classList.toggle('actif', b.dataset.outil === outil); b.setAttribute('aria-pressed', b.dataset.outil === outil); });
    $('#nomOutil').textContent = NOMS[outil];
    $('#astuce').textContent = ASTUCES[outil];
    document.querySelectorAll('#options [data-pour]').forEach(function (el) { el.hidden = el.dataset.pour.split(' ').indexOf(outil) < 0; });
    U.redessiner();
  };

  // Appelé pendant un geste : le dessin change sans que l'historique ait encore avancé.
  U.retouche = function () {
    U.redessiner();
    if (U.surRetouche) U.surRetouche();
  };

  U.initVue = function () {
    scene = $('#scene'); toile = $('#toile'); ctx = toile.getContext('2d');
    $('#outils').innerHTML = Object.keys(NOMS).map(function (o) {
      return '<button type="button" class="outil" data-outil="' + o + '" title="' + NOMS[o] + ' (' + TOUCHES[o] + ')" aria-label="' + NOMS[o] + '"><svg viewBox="0 0 20 20">' + ICONES[o] + '</svg></button>';
    }).join('') + '<span class="trait"></span>' + ACTIONS.map(function (a) {
      return '<button type="button" class="outil" data-act="' + a[0] + '" title="' + a[1] + '" aria-label="' + a[1] + '"><svg viewBox="0 0 20 20">' + a[2] + '</svg></button>';
    }).join('');
    $('#outils').addEventListener('click', function (e) {
      var b = e.target.closest('[data-outil]');
      if (b) U.choisir(b.dataset.outil);
    });
    toile.addEventListener('pointerdown', presse);
    toile.addEventListener('pointermove', bouge);
    toile.addEventListener('pointerup', relache);
    toile.addEventListener('pointercancel', relache);
    toile.addEventListener('pointerleave', function () { if (!geste) { U.survol = null; $('#etatPos').textContent = '–'; } });
    toile.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    scene.addEventListener('wheel', roule, { passive: false });
    scene.addEventListener('auxclick', function (e) { e.preventDefault(); });
    $('#oPlein').addEventListener('change', function () { U.plein = this.checked; });
    $('#oReperes').addEventListener('change', function () { U.reperes = this.checked; U.redessiner(); });
    $('#oVoisins').addEventListener('change', function () { U.voisins = this.checked; U.redessiner(); });
    if (window.ResizeObserver) new ResizeObserver(tailler).observe(scene);
    window.addEventListener('resize', tailler);
    tailler();
    U.choisir('crayon');
  };
  U.gesteEnCours = function () { return !!geste; };
  U.tailleScene = function () { return { l: L, h: H }; };
})();
