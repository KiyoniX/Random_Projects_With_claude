(function () {
  'use strict';

  var COTE_MAX = 512;          // côté maximal du cadre et d'une planche, en pixels
  var PIECES_MAX = 48;
  var IMAGES_MAX = 120;        // longueur maximale d'une animation, en images
  var HIST_MAX = 150;          // profondeur de l'historique
  var GROS = 8;                // agrandissement de la rotation soignée : trois passes de Scale2x
  var FORMAT = 'pantin', FORMAT_ATELIER = 'atelier-pixel';
  var LISSAGES = ['doux', 'lin', 'palier'];

  // Un pixel est un entier 0xAABBGGRR, comme dans Atelier Pixel. Un pixel transparent vaut toujours 0.
  // Une pièce garde ses propres pixels ; son attache (px, py) est le point autour duquel elle tourne.
  // mx, my : place de l'attache au repos, comptée depuis l'attache de la pièce mère (depuis le coin du cadre pour une racine).
  // L'ordre du tableau des pièces est l'ordre d'empilement : la première est tout au fond.
  var P = window.Pantin = {
    COTE_MAX: COTE_MAX, PIECES_MAX: PIECES_MAX, IMAGES_MAX: IMAGES_MAX, LISSAGES: LISSAGES,
    doc: null,
    rev: 0,               // augmente à chaque changement : sert à savoir si une image calculée est encore bonne
    surChange: null       // appelé après chaque opération validée, annulée ou rétablie
  };

  // L'encodeur GIF est celui d'Atelier Pixel, chargé juste après : il s'accroche à cet objet.
  window.Atelier = window.Atelier || {};

  function borne(v, min, max) { return v < min ? min : v > max ? max : v; }
  function rgba(r, g, b, a) { return (a << 24 | b << 16 | g << 8 | r) >>> 0; }
  P.borne = borne;

  // Pose b par-dessus a.
  function sur(a, b) {
    var ab = b >>> 24, aa, s, r, g, bl;
    if (ab === 255 || !a) return b;
    aa = (a >>> 24) * (255 - ab) / 255; s = ab + aa;
    r = ((b & 255) * ab + (a & 255) * aa) / s; g = ((b >>> 8 & 255) * ab + (a >>> 8 & 255) * aa) / s; bl = ((b >>> 16 & 255) * ab + (a >>> 16 & 255) * aa) / s;
    return rgba(Math.round(r), Math.round(g), Math.round(bl), Math.round(s));
  }

  // ---------- Historique ----------
  // Les pixels d'une pièce ne sont jamais modifiés après sa découpe : les instantanés se les partagent.
  var passe = [], futur = [];

  function copie(d) {
    return {
      nom: d.nom, w: d.w, h: d.h, soigne: d.soigne, iAnim: d.iAnim, suivant: d.suivant, planche: d.planche,
      pieces: d.pieces.map(function (p) { var q = {}, k; for (k in p) q[k] = p[k]; return q; }),
      anims: d.anims.map(function (a) {
        var pistes = {}, k;
        for (k in a.pistes) pistes[k] = a.pistes[k].map(function (c) { return { f: c.f, a: c.a, dx: c.dx, dy: c.dy, l: c.l }; });
        return { nom: a.nom, n: a.n, cadence: a.cadence, boucle: a.boucle, pistes: pistes };
      })
    };
  }

  // À appeler juste avant de modifier le document : retient l'état d'avant.
  P.marquer = function () {
    passe.push(copie(P.doc));
    if (passe.length > HIST_MAX) passe.shift();
    futur = [];
  };
  P.change = function () { P.rev++; if (P.surChange) P.surChange(); };
  P.annuler = function () {
    if (!passe.length) return false;
    futur.push(P.doc); P.doc = passe.pop(); P.change();
    return true;
  };
  P.retablir = function () {
    if (!futur.length) return false;
    passe.push(P.doc); P.doc = futur.pop(); P.change();
    return true;
  };
  P.peutAnnuler = function () { return passe.length > 0; };
  P.peutRetablir = function () { return futur.length > 0; };
  function oublier() { passe = []; futur = []; }

  // ---------- Pièces ----------
  P.piece = function (id) {
    var l = P.doc.pieces, i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };
  P.rang = function (id) {
    var l = P.doc.pieces, i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) return i;
    return -1;
  };
  P.anim = function () { return P.doc.anims[P.doc.iAnim]; };
  P.enfants = function (id) { return P.doc.pieces.filter(function (p) { return p.parent === id; }); };
  P.profondeur = function (p) {
    var n = 0;
    while (p && p.parent && n < PIECES_MAX) { p = P.piece(p.parent); n++; }
    return n;
  };
  // Vrai si « id » est la pièce « de » ou l'une de ses descendantes.
  P.descend = function (id, de) {
    var p = P.piece(id), n = 0;
    while (p && n++ < PIECES_MAX) { if (p.id === de) return true; p = P.piece(p.parent); }
    return false;
  };

  // Rogne un tampon à ses pixels opaques. Rend nul s'il est vide.
  function rogner(pix, w, h) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1, x, y, o, W, H;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (pix[y * w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    W = x1 - x0 + 1; H = y1 - y0 + 1; o = new Uint32Array(W * H);
    for (y = 0; y < H; y++) o.set(pix.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + W), y * W);
    return { x: x0, y: y0, w: W, h: H, pix: o };
  }

  function nomLibre(base) {
    var noms = {}, n = 1;
    P.doc.pieces.forEach(function (p) { noms[p.nom] = true; });
    if (!noms[base]) return base;
    while (noms[base + ' ' + (n + 1)]) n++;
    return base + ' ' + (n + 1);
  }

  // Ajoute une pièce faite des pixels donnés, posée là où elle se trouvait sur la planche. Rend la pièce, ou nul.
  function ajouter(pix, w, h, nom) {
    var r = rogner(pix, w, h), d = P.doc, p;
    if (!r || d.pieces.length >= PIECES_MAX) return null;
    p = {
      id: d.suivant++, nom: nomLibre(nom || 'Pièce'), w: r.w, h: r.h, pix: r.pix, sx: r.x, sy: r.y,
      px: r.w / 2, py: r.h / 2, parent: 0, mx: r.x + r.w / 2, my: r.y + r.h / 2, visible: true
    };
    // L'attache tombe sur un demi-pixel et la pièce sur un pixel entier.
    p.px = Math.round(p.px * 2) / 2; p.py = Math.round(p.py * 2) / 2;
    p.mx = r.x + p.px; p.my = r.y + p.py;
    d.pieces.push(p);
    return p;
  }

  // Détache de la planche les pixels marqués par le masque (un octet par pixel).
  P.detacher = function (masque, nom) {
    var pl = P.doc.planche, pix = new Uint32Array(pl.w * pl.h), i, p;
    for (i = 0; i < pix.length; i++) if (masque[i]) pix[i] = pl.pix[i];
    if (!rogner(pix, pl.w, pl.h) || P.doc.pieces.length >= PIECES_MAX) return null;
    P.marquer();
    p = ajouter(pix, pl.w, pl.h, nom);
    P.change();
    return p;
  };

  // Les îlots de pixels opaques qui se touchent, coins compris. Rend une liste de masques.
  P.ilots = function () {
    var pl = P.doc.planche, w = pl.w, h = pl.h, vu = new Uint8Array(w * h), liste = [], i, m, pile, k, x, y, dx, dy, j;
    for (i = 0; i < vu.length; i++) {
      if (vu[i] || !pl.pix[i]) continue;
      m = new Uint8Array(w * h); pile = [i]; vu[i] = 1;
      while (pile.length) {
        k = pile.pop(); m[k] = 1; x = k % w; y = (k - x) / w;
        for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
          j = k + dy * w + dx;
          if (!vu[j] && pl.pix[j]) { vu[j] = 1; pile.push(j); }
        }
      }
      liste.push(m);
    }
    return liste;
  };

  P.detacherIlots = function () {
    var liste = P.ilots(), pl = P.doc.planche, n = 0;
    if (!liste.length) return 0;
    P.marquer();
    liste.forEach(function (m) {
      var pix = new Uint32Array(pl.w * pl.h), i;
      for (i = 0; i < pix.length; i++) if (m[i]) pix[i] = pl.pix[i];
      if (ajouter(pix, pl.w, pl.h)) n++;
    });
    P.change();
    return n;
  };

  P.supprimerPiece = function (id) {
    var p = P.piece(id), d = P.doc;
    if (!p) return false;
    P.marquer();
    // Ses filles se rattachent à sa mère sans bouger.
    P.enfants(id).forEach(function (c) { c.mx += p.mx; c.my += p.my; c.parent = p.parent; });
    d.pieces.splice(P.rang(id), 1);
    d.anims.forEach(function (a) { delete a.pistes[id]; });
    P.change();
    return true;
  };

  P.empiler = function (id, sens) {
    var i = P.rang(id), l = P.doc.pieces, j = i + sens, p;
    if (i < 0 || j < 0 || j >= l.length) return false;
    P.marquer();
    p = l[i]; l[i] = l[j]; l[j] = p;
    P.change();
    return true;
  };

  // Place de l'attache au repos, dans le cadre.
  P.attacheRepos = function (p) {
    var x = 0, y = 0, n = 0;
    while (p && n++ < PIECES_MAX) { x += p.mx; y += p.my; p = P.piece(p.parent); }
    return { x: x, y: y };
  };

  // Déplace l'attache sur la pièce (en pixels de la pièce) sans que rien ne bouge au repos.
  P.poserAttache = function (p, px, py) {
    var dx, dy;
    px = borne(Math.round(px * 2) / 2, 0, p.w); py = borne(Math.round(py * 2) / 2, 0, p.h);
    dx = px - p.px; dy = py - p.py;
    if (!dx && !dy) return;
    p.px = px; p.py = py; p.mx += dx; p.my += dy;
    P.enfants(p.id).forEach(function (c) { c.mx -= dx; c.my -= dy; });
  };

  // Attache la pièce à une autre (0 : à rien) sans la déplacer au repos. Rend faux si cela ferait une boucle.
  P.lier = function (p, idMere) {
    var ici = P.attacheRepos(p), mere = P.piece(idMere), la;
    if (idMere && (!mere || P.descend(idMere, p.id))) return false;
    la = mere ? P.attacheRepos(mere) : { x: 0, y: 0 };
    p.parent = mere ? mere.id : 0;
    p.mx = ici.x - la.x; p.my = ici.y - la.y;
    return true;
  };

  // ---------- Poses ----------
  var REPOS = { a: 0, dx: 0, dy: 0 };

  P.cle = function (id, f) {
    var k = P.anim().pistes[id], i;
    if (k) for (i = 0; i < k.length; i++) if (k[i].f === f) return k[i];
    return null;
  };

  // Pose d'une pièce à l'image f. f négatif : la pose de repos, celle du montage.
  P.pose = function (id, f) {
    var an = P.anim(), k = an.pistes[id], i, k0, k1, f0, f1, t;
    if (f < 0 || !k || !k.length) return REPOS;
    if (k.length === 1) return k[0];
    for (i = k.length - 1; i >= 0 && k[i].f > f; i--) { /* dernière clé à gauche */ }
    if (i < 0) {
      if (!an.boucle) return k[0];
      k0 = k[k.length - 1]; f0 = k0.f - an.n; k1 = k[0]; f1 = k1.f;
    } else if (i === k.length - 1) {
      if (!an.boucle) return k[i];
      k0 = k[i]; f0 = k0.f; k1 = k[0]; f1 = k1.f + an.n;
    } else { k0 = k[i]; f0 = k0.f; k1 = k[i + 1]; f1 = k1.f; }
    if (k0.l === 'palier' || f === f0) return k0;
    t = (f - f0) / (f1 - f0);
    if (k0.l !== 'lin') t = t * t * (3 - 2 * t);
    return { a: k0.a + (k1.a - k0.a) * t, dx: Math.round(k0.dx + (k1.dx - k0.dx) * t), dy: Math.round(k0.dy + (k1.dy - k0.dy) * t) };
  };

  // Pose une clé à l'image f (ou corrige celle qui s'y trouve) avec les valeurs données ; les autres gardent la pose calculée.
  P.poserCle = function (id, f, v) {
    var an = P.anim(), k = an.pistes[id] || (an.pistes[id] = []), c = P.cle(id, f), ici;
    if (!c) {
      ici = P.pose(id, f);
      c = { f: f, a: ici.a, dx: ici.dx, dy: ici.dy, l: 'doux' };
      k.push(c);
      k.sort(function (p, q) { return p.f - q.f; });
    }
    if (v) {
      if (v.a !== undefined) c.a = Math.round(v.a * 100) / 100;
      if (v.dx !== undefined) c.dx = Math.round(v.dx);
      if (v.dy !== undefined) c.dy = Math.round(v.dy);
      if (v.l !== undefined && LISSAGES.indexOf(v.l) >= 0) c.l = v.l;
    }
    return c;
  };

  P.oterCle = function (id, f) {
    var an = P.anim(), k = an.pistes[id], i;
    if (!k) return false;
    for (i = 0; i < k.length; i++) if (k[i].f === f) {
      k.splice(i, 1);
      if (!k.length) delete an.pistes[id];
      return true;
    }
    return false;
  };

  // Matrices [a, b, c, d, e, f] de chaque pièce à l'image f : x' = a·x + c·y + e, y' = b·x + d·y + f,
  // où (x, y) se compte depuis l'attache. Les angles sont en degrés, dans le sens des aiguilles d'une montre.
  P.matrices = function (f) {
    var m = {}, garde = 0;
    function de(p) {
      var mere, po, r, co, si, e, g;
      if (m[p.id]) return m[p.id];
      mere = p.parent && garde++ < 4096 ? P.piece(p.parent) : null;
      mere = mere ? de(mere) : [1, 0, 0, 1, 0, 0];
      po = P.pose(p.id, f); r = po.a * Math.PI / 180; co = Math.cos(r); si = Math.sin(r);
      e = p.mx + po.dx; g = p.my + po.dy;
      return (m[p.id] = [
        mere[0] * co + mere[2] * si, mere[1] * co + mere[3] * si,
        mere[2] * co - mere[0] * si, mere[3] * co - mere[1] * si,
        mere[0] * e + mere[2] * g + mere[4], mere[1] * e + mere[3] * g + mere[5]
      ]);
    }
    P.doc.pieces.forEach(de);
    return m;
  };

  // ---------- Rotation soignée ----------
  // Scale2x (EPX) : double l'image en devinant les diagonales, sans inventer de couleur.
  function doubler(pix, w, h) {
    var W = w * 2, o = new Uint32Array(W * h * 2), x, y, p, a, b, c, d, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = pix[y * w + x];
      a = y > 0 ? pix[(y - 1) * w + x] : 0; d = y < h - 1 ? pix[(y + 1) * w + x] : 0;
      c = x > 0 ? pix[y * w + x - 1] : 0; b = x < w - 1 ? pix[y * w + x + 1] : 0;
      i = y * 2 * W + x * 2;
      o[i] = (c === a && c !== d && a !== b) ? a : p;
      o[i + 1] = (a === b && a !== c && b !== d) ? b : p;
      o[i + W] = (d === c && d !== b && c !== a) ? c : p;
      o[i + W + 1] = (b === d && b !== a && d !== c) ? d : p;
    }
    return o;
  }
  var grosCache = new WeakMap();
  function gros(p) {
    var g = grosCache.get(p.pix);
    if (!g) {
      g = doubler(doubler(doubler(p.pix, p.w, p.h), p.w * 2, p.h * 2), p.w * 4, p.h * 4);
      grosCache.set(p.pix, g);
    }
    return g;
  }

  // ---------- Rendu ----------
  // L'image f, calculée sur la zone (ox, oy, W, H) du plan du cadre. Sans zone : le cadre exact.
  P.composer = function (f, ox, oy, W, H) {
    var d = P.doc, out, mats = P.matrices(f), i, p, m, det, xs, ys, x0, y0, x1, y1, X, Y, sx, sy, u, v, c, src, droit, k, g, gw;
    if (W === undefined) { ox = 0; oy = 0; W = d.w; H = d.h; }
    out = new Uint32Array(W * H);
    for (i = 0; i < d.pieces.length; i++) {
      p = d.pieces[i];
      if (!p.visible) continue;
      m = mats[p.id]; det = m[0] * m[3] - m[1] * m[2];
      xs = []; ys = [];
      [[0, 0], [p.w, 0], [0, p.h], [p.w, p.h]].forEach(function (q) {
        xs.push(m[0] * (q[0] - p.px) + m[2] * (q[1] - p.py) + m[4]); ys.push(m[1] * (q[0] - p.px) + m[3] * (q[1] - p.py) + m[5]);
      });
      x0 = Math.max(0, Math.floor(Math.min.apply(null, xs)) - ox); x1 = Math.min(W - 1, Math.ceil(Math.max.apply(null, xs)) - ox);
      y0 = Math.max(0, Math.floor(Math.min.apply(null, ys)) - oy); y1 = Math.min(H - 1, Math.ceil(Math.max.apply(null, ys)) - oy);
      // Une pièce droite ou tournée d'un quart de tour se recopie telle quelle ; les autres passent par l'image agrandie.
      droit = Math.abs(m[0] * m[1]) < 1e-9;
      k = d.soigne && !droit ? GROS : 1; src = k > 1 ? gros(p) : p.pix; gw = p.w * k;
      for (Y = y0; Y <= y1; Y++) for (X = x0; X <= x1; X++) {
        sx = X + ox + 0.5 - m[4]; sy = Y + oy + 0.5 - m[5];
        u = (m[3] * sx - m[2] * sy) / det + p.px; v = (m[0] * sy - m[1] * sx) / det + p.py;
        if (u < 0 || v < 0 || u >= p.w || v >= p.h) continue;
        c = src[Math.floor(v * k) * gw + Math.floor(u * k)];
        if (c) { g = Y * W + X; out[g] = sur(out[g], c); }
      }
    }
    return out;
  };

  // La pièce visible la plus haute dont un pixel opaque se trouve en (x, y) à l'image f. marge : tolérance en pixels.
  P.toucher = function (f, x, y, marge) {
    var d = P.doc, mats = P.matrices(f), i, p, m, det, u, v, proche = 0;
    for (i = d.pieces.length - 1; i >= 0; i--) {
      p = d.pieces[i];
      if (!p.visible) continue;
      m = mats[p.id]; det = m[0] * m[3] - m[1] * m[2];
      u = (m[3] * (x - m[4]) - m[2] * (y - m[5])) / det + p.px; v = (m[0] * (y - m[5]) - m[1] * (x - m[4])) / det + p.py;
      if (u >= 0 && v >= 0 && u < p.w && v < p.h && p.pix[Math.floor(v) * p.w + Math.floor(u)]) return p.id;
      if (!proche && u >= -marge && v >= -marge && u < p.w + marge && v < p.h + marge) proche = p.id;
    }
    return proche;
  };

  // ---------- Cadre ----------
  // Resserre le cadre sur tout ce que le pantin occupe, toutes animations confondues, avec une marge.
  P.cadrer = function (marge) {
    var d = P.doc, R = COTE_MAX, garde = d.iAnim, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, a, f, pix, x, y, W = d.w + 2 * R, H = d.h + 2 * R, w, h;
    function voir(fr) {
      pix = P.composer(fr, -R, -R, W, H);
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (pix[y * W + x]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    voir(-1);
    for (a = 0; a < d.anims.length; a++) { d.iAnim = a; for (f = 0; f < d.anims[a].n; f++) voir(f); }
    d.iAnim = garde;
    if (x1 < x0) return false;
    w = x1 - x0 + 1 + 2 * marge; h = y1 - y0 + 1 + 2 * marge;
    if (w > COTE_MAX || h > COTE_MAX) return false;
    P.marquer();
    d.pieces.forEach(function (p) { if (!p.parent) { p.mx -= x0 - R - marge; p.my -= y0 - R - marge; } });
    d.w = w; d.h = h;
    P.change();
    return true;
  };

  P.reglerCadre = function (w, h) {
    w = borne(Math.round(w) || 1, 1, COTE_MAX); h = borne(Math.round(h) || 1, 1, COTE_MAX);
    if (w === P.doc.w && h === P.doc.h) return;
    P.marquer(); P.doc.w = w; P.doc.h = h; P.change();
  };

  // ---------- Animations ----------
  function animNeuve(nom) { return { nom: nom, n: 12, cadence: 12, boucle: true, pistes: {} }; }

  P.animAjouter = function (nom, modele) {
    var a = modele ? copie({ pieces: [], anims: [modele] }).anims[0] : animNeuve(nom);
    a.nom = String(nom || 'Animation').slice(0, 40);
    P.marquer(); P.doc.anims.push(a); P.doc.iAnim = P.doc.anims.length - 1; P.change();
  };
  P.animSupprimer = function () {
    var d = P.doc;
    if (d.anims.length < 2) return false;
    P.marquer(); d.anims.splice(d.iAnim, 1); d.iAnim = Math.min(d.iAnim, d.anims.length - 1); P.change();
    return true;
  };
  // Change la longueur : les clés qui dépassent sont retirées.
  P.animLongueur = function (n) {
    var a = P.anim(), k;
    n = borne(Math.round(n) || 1, 1, IMAGES_MAX);
    if (n === a.n) return;
    P.marquer();
    a.n = n;
    for (k in a.pistes) { a.pistes[k] = a.pistes[k].filter(function (c) { return c.f < n; }); if (!a.pistes[k].length) delete a.pistes[k]; }
    P.change();
  };

  // Les images de l'animation en cours, au format du cadre.
  P.images = function () {
    var a = P.anim(), l = [], f;
    for (f = 0; f < a.n; f++) l.push(P.composer(f));
    return l;
  };

  P.planche = function (colonnes) {
    var d = P.doc, im = P.images(), n = im.length, cols = borne(Math.round(colonnes) || n, 1, n), rangs = Math.ceil(n / cols);
    var W = cols * d.w, o = new Uint32Array(W * rangs * d.h), i, y, ox, oy;
    for (i = 0; i < n; i++) {
      ox = (i % cols) * d.w; oy = Math.floor(i / cols) * d.h;
      for (y = 0; y < d.h; y++) o.set(im[i].subarray(y * d.w, (y + 1) * d.w), (oy + y) * W + ox);
    }
    return { pix: o, w: W, h: rangs * d.h };
  };

  P.agrandir = function (pix, w, h, k) {
    if (k === 1) return pix;
    var o = new Uint32Array(w * k * h * k), x, y, i, c, W = w * k;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) { c = pix[y * w + x]; if (c) for (i = 0; i < k; i++) o[y * k * W + x * k + i] = c; }
      for (i = 1; i < k; i++) o.copyWithin((y * k + i) * W, y * k * W, (y * k + 1) * W);
    }
    return o;
  };

  // ---------- Fichiers ----------
  // Codage d'une image : plages [longueur, r, v, b, a] puis base64 (le même que celui d'Atelier Pixel).
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
  function decoder(texte, n) {
    var ABIME = 'Une image de ce fichier est abîmée : il ne peut pas être ouvert.', s, buf = new Uint32Array(n), i = 0, k, run, c;
    try { s = atob(texte); } catch (err) { throw new Error(ABIME); }
    for (k = 0; k + 4 < s.length; k += 5) {
      run = s.charCodeAt(k);
      c = rgba(s.charCodeAt(k + 1), s.charCodeAt(k + 2), s.charCodeAt(k + 3), s.charCodeAt(k + 4));
      if (i + run > n) throw new Error(ABIME);
      if (c) buf.fill(c, i, i + run);
      i += run;
    }
    if (i !== n) throw new Error(ABIME);
    return buf;
  }
  function nombre(v, defaut) { v = Number(v); return isFinite(v) ? v : defaut; }

  P.versProjet = function () {
    var d = P.doc;
    return {
      format: FORMAT, version: 1, nom: d.nom, w: d.w, h: d.h, soigne: d.soigne, iAnim: d.iAnim,
      planche: { w: d.planche.w, h: d.planche.h, pix: coder(d.planche.pix) },
      pieces: d.pieces.map(function (p) {
        return { id: p.id, nom: p.nom, w: p.w, h: p.h, pix: coder(p.pix), sx: p.sx, sy: p.sy, px: p.px, py: p.py, parent: p.parent, mx: p.mx, my: p.my, visible: p.visible };
      }),
      anims: copie(d).anims
    };
  };

  P.depuisProjet = function (o) {
    var ids = {}, max = 0, pieces, anims, pl;
    if (!o || o.format !== FORMAT || !Array.isArray(o.pieces) || !Array.isArray(o.anims) || !o.planche) throw new Error('Ce fichier n\'est pas un projet Pantin.');
    if (!(o.planche.w >= 1 && o.planche.h >= 1 && o.planche.w <= COTE_MAX && o.planche.h <= COTE_MAX) || o.pieces.length > PIECES_MAX || !o.anims.length) throw new Error('Projet invalide.');
    pl = { w: Math.round(o.planche.w), h: Math.round(o.planche.h) };
    pl.pix = decoder(o.planche.pix, pl.w * pl.h);
    pieces = o.pieces.map(function (q) {
      var id = Math.round(q.id), w = Math.round(q.w), h = Math.round(q.h);
      if (!(id > 0) || ids[id] || !(w >= 1 && h >= 1 && w <= COTE_MAX && h <= COTE_MAX)) throw new Error('Projet invalide.');
      ids[id] = true; max = Math.max(max, id);
      return {
        id: id, nom: String(q.nom || 'Pièce').slice(0, 40), w: w, h: h, pix: decoder(q.pix, w * h), sx: nombre(q.sx, 0), sy: nombre(q.sy, 0),
        px: borne(nombre(q.px, w / 2), 0, w), py: borne(nombre(q.py, h / 2), 0, h), parent: Math.round(q.parent) || 0, mx: nombre(q.mx, 0), my: nombre(q.my, 0), visible: q.visible !== false
      };
    });
    anims = o.anims.map(function (a) {
      var n = borne(Math.round(a.n) || 1, 1, IMAGES_MAX), pistes = {}, k;
      for (k in (a.pistes || {})) if (ids[k] && Array.isArray(a.pistes[k])) {
        pistes[k] = a.pistes[k].map(function (c) {
          return { f: Math.round(c.f), a: nombre(c.a, 0), dx: Math.round(nombre(c.dx, 0)), dy: Math.round(nombre(c.dy, 0)), l: LISSAGES.indexOf(c.l) >= 0 ? c.l : 'doux' };
        }).filter(function (c, i, l) { return c.f >= 0 && c.f < n && l.findIndex(function (e) { return e.f === c.f; }) === i; }).sort(function (p, q) { return p.f - q.f; });
        if (!pistes[k].length) delete pistes[k];
      }
      return { nom: String(a.nom || 'Animation').slice(0, 40), n: n, cadence: borne(Math.round(a.cadence) || 12, 1, 60), boucle: a.boucle !== false, pistes: pistes };
    });
    P.doc = {
      nom: String(o.nom || 'pantin').slice(0, 60), w: borne(Math.round(o.w) || 1, 1, COTE_MAX), h: borne(Math.round(o.h) || 1, 1, COTE_MAX), soigne: o.soigne !== false,
      iAnim: borne(Math.round(o.iAnim) || 0, 0, anims.length - 1), suivant: max + 1, planche: pl, pieces: pieces, anims: anims
    };
    // Une mère inconnue ou une boucle de parenté laisserait la pièce sans place : elle redevient une racine.
    pieces.forEach(function (p) {
      var q = p, n = 0;
      if (p.parent && !ids[p.parent]) p.parent = 0;
      while (q && q.parent && n++ <= PIECES_MAX) q = P.piece(q.parent);
      if (n > PIECES_MAX) p.parent = 0;
    });
    oublier(); P.change();
  };

  // Un pantin neuf à partir d'une planche : rien n'est encore découpé.
  P.docDepuisPlanche = function (pix, w, h, nom) {
    if (!(w >= 1 && h >= 1 && w <= COTE_MAX && h <= COTE_MAX)) return false;
    var i, net = new Uint32Array(pix.length);
    for (i = 0; i < pix.length; i++) if (pix[i] >>> 24) net[i] = pix[i];
    P.doc = { nom: nom || 'pantin', w: w, h: h, soigne: true, iAnim: 0, suivant: 1, planche: { w: w, h: h, pix: net }, pieces: [], anims: [animNeuve('Animation 1')] };
    oublier(); P.change();
    return true;
  };

  // Un projet Atelier Pixel : chaque calque visible de la première image devient une pièce, déjà à sa place.
  function opacite(c) { return c.opacite === undefined ? 1 : borne(Number(c.opacite) || 0, 0, 1); }
  P.depuisAtelier = function (o, nom) {
    var w, h, n, im, tout, pieces = [];
    if (!o || o.format !== FORMAT_ATELIER || !Array.isArray(o.calques) || !Array.isArray(o.images) || !o.images.length) throw new Error('Ce fichier n\'est pas un projet Atelier Pixel.');
    w = Math.round(o.w); h = Math.round(o.h); n = w * h;
    if (!(w >= 1 && h >= 1 && w <= COTE_MAX && h <= COTE_MAX)) throw new Error('Ce sprite fait ' + o.w + ' × ' + o.h + ' px : le maximum est ' + COTE_MAX + '.');
    // La première image où un calque visible est peint : Atelier Pixel retient aussi l'image où l'on s'était arrêté, qui peut être vide.
    im = o.images.filter(function (m) { return m && m.cels && o.calques.some(function (c) { return c.visible !== false && opacite(c) > 0 && m.cels[c.id]; }); })[0];
    if (!im) throw new Error('Ce projet Atelier Pixel n\'a aucun pixel visible : il n\'y a rien à découper.');
    tout = new Uint32Array(n);
    o.calques.forEach(function (c) {
      var t = im.cels[c.id], op = opacite(c), buf, i, a;
      if (!t || c.visible === false || op <= 0) return;
      buf = decoder(t, n);
      // L'opacité du calque passe dans les pixels de la pièce, comme Atelier Pixel les montre.
      if (op < 1) for (i = 0; i < n; i++) if (buf[i]) { a = Math.round((buf[i] >>> 24) * op); buf[i] = a ? ((buf[i] & 0xffffff) | a << 24) >>> 0 : 0; }
      for (i = 0; i < n; i++) if (buf[i]) tout[i] = sur(tout[i], buf[i]);
      pieces.push({ pix: buf, nom: String(c.nom || 'Calque').slice(0, 40) });
    });
    P.docDepuisPlanche(tout, w, h, nom);
    if (pieces.length > 1) pieces.forEach(function (q) { ajouter(q.pix, w, h, q.nom); });
    P.change();
    return P.doc.pieces.length;
  };

  // L'animation en cours comme projet Atelier Pixel, une image par image, pour la retoucher à la main.
  P.versAtelier = function () {
    var d = P.doc, a = P.anim(), vues = {}, palette = [], duree = Math.round(1000 / a.cadence);
    function hex(v) { return (v < 16 ? '0' : '') + v.toString(16); }
    return {
      format: FORMAT_ATELIER, version: 1, w: d.w, h: d.h, iImage: 0, iCalque: 0,
      calques: [{ id: 1, nom: a.nom, visible: true, opacite: 1, verrou: false }],
      images: P.images().map(function (pix) {
        var i, c;
        for (i = 0; i < pix.length; i++) {
          c = pix[i];
          if (c && !vues[c] && palette.length < 256) { vues[c] = true; palette.push('#' + hex(c & 255) + hex(c >>> 8 & 255) + hex(c >>> 16 & 255) + (c >>> 24 < 255 ? hex(c >>> 24) : '')); }
        }
        return { duree: duree, cels: { 1: coder(pix) } };
      }),
      palette: palette
    };
  };

  // ---------- Pantin d'exemple ----------
  P.exemple = function () {
    var K = rgba(42, 29, 26, 255), PEAU = rgba(226, 178, 122, 255), ROUGE = rgba(200, 55, 45, 255), SANG = rgba(143, 36, 32, 255);
    var BLEU = rgba(47, 95, 168, 255), NUIT = rgba(31, 63, 119, 255), OR = rgba(232, 193, 74, 255);
    var W = 48, H = 24, pl = new Uint32Array(W * H), d, id = {};
    function bloc(x, y, w, h, c) { var i, j; for (j = 0; j < h; j++) for (i = 0; i < w; i++) pl[(y + j) * W + x + i] = c; }
    function point(x, y, c) { pl[y * W + x] = c; }
    // Cerne d'encre autour de tout ce qui est peint.
    function cerner() {
      var bord = [], x, y, i;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        i = y * W + x;
        if (!pl[i] && ((x > 0 && pl[i - 1]) || (x < W - 1 && pl[i + 1]) || (y > 0 && pl[i - W]) || (y < H - 1 && pl[i + W]))) bord.push(i);
      }
      bord.forEach(function (k) { pl[k] = K; });
    }
    // Tête et chapeau pointu.
    bloc(3, 6, 8, 7, PEAU); bloc(4, 5, 6, 1, PEAU); bloc(4, 13, 6, 1, PEAU);
    bloc(6, 1, 2, 1, ROUGE); bloc(5, 2, 4, 1, ROUGE); bloc(4, 3, 6, 1, ROUGE); bloc(3, 4, 8, 1, SANG);
    point(5, 8, K); point(8, 8, K); bloc(6, 11, 2, 1, SANG); point(3, 10, rgba(231, 142, 120, 255)); point(10, 10, rgba(231, 142, 120, 255));
    // Torse.
    bloc(16, 2, 8, 11, ROUGE); bloc(16, 11, 8, 2, SANG); bloc(19, 4, 2, 1, OR); bloc(19, 7, 2, 1, OR);
    // Bras, avant-bras et main.
    bloc(28, 2, 3, 7, ROUGE); bloc(34, 2, 3, 3, ROUGE); bloc(34, 5, 3, 4, PEAU);
    // Cuisse, jambe et soulier.
    bloc(28, 13, 4, 7, BLEU); bloc(35, 12, 4, 6, BLEU); bloc(35, 18, 5, 2, NUIT);
    cerner();
    P.doc = { nom: 'pantin', w: 40, h: 44, soigne: true, iAnim: 0, suivant: 1, planche: { w: W, h: H, pix: pl }, pieces: [], anims: [] };
    d = P.doc;
    function decoupe(nom, x, y, w, h, px, py, mere, mx, my) {
      var pix = new Uint32Array(w * h), j, p;
      for (j = 0; j < h; j++) pix.set(pl.subarray((y + j) * W + x, (y + j) * W + x + w), j * w);
      p = { id: d.suivant++, nom: nom, w: w, h: h, pix: pix, sx: x, sy: y, px: px, py: py, parent: mere ? id[mere] : 0, mx: mx, my: my, visible: true };
      d.pieces.push(p); id[nom] = p.id;
    }
    // Du fond vers le devant. Les membres de gauche et de droite sortent des mêmes pixels.
    decoupe('Cuisse gauche', 27, 12, 6, 9, 3, 2.5, '', 0, 0);
    decoupe('Jambe gauche', 34, 11, 7, 10, 3, 1.5, 'Cuisse gauche', 0, 5);
    decoupe('Cuisse droite', 27, 12, 6, 9, 3, 2.5, '', 0, 0);
    decoupe('Jambe droite', 34, 11, 7, 10, 3, 1.5, 'Cuisse droite', 0, 5);
    decoupe('Torse', 15, 1, 10, 13, 5, 11, '', 20, 26);
    decoupe('Tête', 2, 0, 10, 15, 5, 13.5, 'Torse', 0, -11.5);
    decoupe('Bras gauche', 27, 1, 5, 9, 2.5, 2.5, 'Torse', -5.5, -8.5);
    decoupe('Avant-bras gauche', 33, 1, 5, 9, 2.5, 1.5, 'Bras gauche', 0, 5);
    decoupe('Bras droit', 27, 1, 5, 9, 2.5, 2.5, 'Torse', 5.5, -8.5);
    decoupe('Avant-bras droit', 33, 1, 5, 9, 2.5, 1.5, 'Bras droit', 0, 5);
    ['Cuisse gauche', 'Cuisse droite'].forEach(function (n, i) { var p = P.piece(id[n]); p.parent = id.Torse; p.mx = i ? 3 : -3; p.my = 0.5; });

    function anim(nom, n, cadence, cles) {
      var a = { nom: nom, n: n, cadence: cadence, boucle: true, pistes: {} }, k;
      for (k in cles) a.pistes[id[k]] = cles[k].map(function (c) { return { f: c[0], a: c[1], dx: 0, dy: c[2] || 0, l: 'doux' }; });
      d.anims.push(a);
    }
    anim('On tire la ficelle', 16, 14, {
      'Torse': [[0, 0, 0], [8, 0, -2]],
      'Tête': [[0, 0], [4, 6], [12, -6]],
      'Bras droit': [[0, -8], [8, -118]], 'Avant-bras droit': [[0, -6], [8, -34]],
      'Bras gauche': [[0, 8], [8, 118]], 'Avant-bras gauche': [[0, 6], [8, 34]],
      'Cuisse droite': [[0, -4], [8, -46]], 'Jambe droite': [[0, 0], [8, 24]],
      'Cuisse gauche': [[0, 4], [8, 46]], 'Jambe gauche': [[0, 0], [8, -24]]
    });
    anim('Salut', 12, 12, {
      'Tête': [[0, -5], [6, 5]],
      'Bras droit': [[0, -142]], 'Avant-bras droit': [[0, -38], [3, 24], [6, -38], [9, 24]],
      'Bras gauche': [[0, 6], [6, 12]]
    });
    oublier(); P.change();
  };
})();
