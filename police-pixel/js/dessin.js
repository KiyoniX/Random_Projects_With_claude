(function () {
  'use strict';

  var PP = window.PP, GL = PP.GL, GX = PP.GX;

  // ---------- Tracés ----------
  // Les tracés ne valident pas l'historique : c'est le geste entier qui fait une étape.
  function dedans(x, y) { return y >= 0 && y < PP.police.h && x >= -GX && x < GL - GX; }

  PP.point = function (code, x, y, v) {
    if (!dedans(x, y)) return;
    PP.ecrire(code).pix[y * GL + x + GX] = v ? 1 : 0;
  };

  PP.ligne = function (code, x0, y0, x1, y1, v) {
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy, e2, pix = PP.ecrire(code).pix, n = 0;
    while (n++ < 400) {
      if (dedans(x0, y0)) pix[y0 * GL + x0 + GX] = v ? 1 : 0;
      if (x0 === x1 && y0 === y1) break;
      e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  };

  PP.rect = function (code, x0, y0, x1, y1, v, plein) {
    var pix = PP.ecrire(code).pix, x, y, t;
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { t = y0; y0 = y1; y1 = t; }
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        if ((plein || y === y0 || y === y1 || x === x0 || x === x1) && dedans(x, y)) pix[y * GL + x + GX] = v ? 1 : 0;
      }
    }
  };

  // Zone où le remplissage peut s'étendre : la case du caractère, élargie à son encre.
  PP.zone = function (code) {
    var e = PP.encre(code), av = PP.avance(code);
    return { x0: Math.min(0, e ? e.x0 : 0), x1: Math.max(av - 1, e ? e.x1 : 0, 0) };
  };

  PP.remplir = function (code, x, y, v) {
    var z = PP.zone(code), h = PP.police.h, pix, pile, cible, n = 0, px, py;
    v = v ? 1 : 0;
    if (y < 0 || y >= h || x < z.x0 || x > z.x1) return 0;
    pix = PP.ecrire(code).pix;
    cible = pix[y * GL + x + GX];
    if (cible === v) return 0;
    pile = [x, y];
    while (pile.length) {
      py = pile.pop(); px = pile.pop();
      if (py < 0 || py >= h || px < z.x0 || px > z.x1 || pix[py * GL + px + GX] !== cible) continue;
      pix[py * GL + px + GX] = v; n++;
      pile.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
    }
    return n;
  };

  // ---------- Transformations d'un caractère ----------
  // Déplace le dessin ; refusé s'il devait sortir de la hauteur ou de la mémoire du caractère.
  PP.decaler = function (code, dx, dy) {
    var g = PP.police.glyphes[code], e = PP.encre(code), h = PP.police.h, n, x, y;
    if (!g || g.comp || !e) return false;
    if (e.y0 + dy < 0 || e.y1 + dy >= h || e.x0 + dx < -GX || e.x1 + dx >= GL - GX) return false;
    g = PP.ecrire(code);
    n = new Uint8Array(GL * h);
    for (y = e.y0; y <= e.y1; y++) for (x = e.x0; x <= e.x1; x++) if (g.pix[y * GL + x + GX]) n[(y + dy) * GL + x + dx + GX] = 1;
    g.pix = n;
    return true;
  };

  // Retourne le dessin : gauche-droite dans sa case, haut-bas dans la hauteur de son encre.
  PP.retourner = function (code, sens) {
    var g = PP.police.glyphes[code], e = PP.encre(code), h = PP.police.h, n, x, y, a, b;
    if (!g || g.comp || !e) return false;
    g = PP.ecrire(code);
    n = new Uint8Array(GL * h);
    a = Math.min(0, e.x0); b = Math.max(PP.avance(code) - 1, e.x1);
    if (e.x0 >= 0 && e.x1 < PP.avance(code)) { a = e.x0; b = e.x1; }
    for (y = e.y0; y <= e.y1; y++) {
      for (x = e.x0; x <= e.x1; x++) {
        if (!g.pix[y * GL + x + GX]) continue;
        if (sens === 'h') n[y * GL + (a + b - x) + GX] = 1;
        else n[(e.y0 + e.y1 - y) * GL + x + GX] = 1;
      }
    }
    g.pix = n;
    return true;
  };

  // ---------- Sélection ----------
  // Un morceau de dessin : { l, h, pix } avec un octet par pixel.
  PP.extraire = function (code, x, y, l, h) {
    var pix = new Uint8Array(l * h), i, j;
    for (j = 0; j < h; j++) for (i = 0; i < l; i++) pix[j * l + i] = PP.lire(code, x + i, y + j);
    return { l: l, h: h, pix: pix };
  };
  PP.vider = function (code, x, y, l, h) { PP.rect(code, x, y, x + l - 1, y + h - 1, 0, true); };
  PP.poser = function (code, morceau, x, y) {
    var i, j;
    for (j = 0; j < morceau.h; j++) for (i = 0; i < morceau.l; i++) if (morceau.pix[j * morceau.l + i]) PP.point(code, x + i, y + j, 1);
  };

  // ---------- Variantes de toute la police ----------
  function dessines() {
    var r = [], k, g;
    for (k in PP.police.glyphes) { g = PP.police.glyphes[k]; if (!g.comp && g.pix && PP.boite(g.pix)) r.push(+k); }
    return r;
  }
  function detacherTout() {
    var k;
    for (k in PP.police.glyphes) if (PP.police.glyphes[k].comp) PP.detacher(+k, true);
  }
  function nommer(style) {
    var p = PP.police;
    p.style = PP.STYLES[p.style.toLowerCase()] && !p.gras && !p.italique ? style : p.style + ' ' + style.toLowerCase();
  }
  function elargir(n) {
    var p = PP.police, k;
    if (p.fixe) { p.chasse = Math.min(PP.AV_MAX, p.chasse + n); return; }
    for (k in p.glyphes) if (!p.glyphes[k].comp && !PP.estBlanc(+k)) PP.ecrire(+k).av = Math.min(PP.AV_MAX, p.glyphes[k].av + n);
  }

  // Gras : chaque pixel est doublé vers la droite, la chasse gagne un pixel.
  PP.deriverGras = function () {
    var h = PP.police.h;
    dessines().forEach(function (code) {
      var g = PP.ecrire(code), src = new Uint8Array(g.pix), x, y;
      for (y = 0; y < h; y++) for (x = 0; x < GL - 1; x++) if (src[y * GL + x]) g.pix[y * GL + x + 1] = 1;
    });
    elargir(1);
    nommer('Gras');
    PP.police.gras = true;
    PP.revision++;
    PP.valider('Dériver un gras');
  };

  // Italique : cisaillement en escalier, un pixel vers la droite toutes les « pas » rangées au-dessus de la ligne de base.
  PP.deriverItalique = function (pas) {
    var p = PP.police, h = p.h;
    pas = PP.borne(Math.round(pas) || 3, 2, 8);
    if (p.pas) return false;
    dessines().forEach(function (code) {
      var g = PP.ecrire(code), src = new Uint8Array(g.pix), x, y, d, nx;
      g.pix.fill(0);
      for (y = 0; y < h; y++) {
        d = Math.floor((p.base - 1 - y) / pas);
        for (x = 0; x < GL; x++) {
          nx = x + d;
          if (src[y * GL + x] && nx >= 0 && nx < GL) g.pix[y * GL + nx] = 1;
        }
      }
    });
    p.pas = pas;
    nommer('Italique');
    p.italique = true;
    PP.revision++;
    PP.valider('Dériver un italique');
    return true;
  };

  // Agrandit la hauteur de n rangées et recopie chaque dessin transformé par f(source, cible, lire).
  function refaire(haut, bas, f) {
    var p = PP.police, h0 = p.h, h1 = h0 + haut + bas, liste;
    if (h1 > PP.H_MAX) return false;
    detacherTout();
    liste = dessines();
    liste.forEach(function (code) {
      var g = PP.ecrire(code), src = g.pix, n = new Uint8Array(GL * h1);
      function lire(x, y) { return x >= 0 && x < GL && y >= 0 && y < h0 ? src[y * GL + x] : 0; }
      f(n, lire, h1);
      g.pix = n;
    });
    Object.keys(p.glyphes).forEach(function (k) {
      var g = p.glyphes[k];
      if (g.pix && g.pix.length !== GL * h1) PP.ecrire(+k).pix = null;
    });
    p.h = h1; p.base += haut + bas; p.hx += haut + bas; p.hcap += haut + bas; p.hasc += haut + bas;
    p.hdesc = Math.min(p.hdesc, p.h - p.base);
    return true;
  }
  function voisin(lire, x, y) {
    var i, j;
    for (j = -1; j <= 1; j++) for (i = -1; i <= 1; i++) if (lire(x + i, y + j)) return 1;
    return 0;
  }

  // Contour : ne garde que le liseré d'un pixel autour de chaque dessin.
  PP.deriverContour = function () {
    var ok = refaire(1, 1, function (n, lire, h1) {
      var x, y;
      for (y = 0; y < h1; y++) for (x = 0; x < GL; x++) if (!lire(x - 1, y - 1) && voisin(lire, x - 1, y - 1)) n[y * GL + x] = 1;
    });
    if (!ok) return false;
    elargir(2);
    nommer('Contour');
    PP.revision++;
    PP.valider('Dériver un contour');
    return true;
  };

  // Ombre : le liseré, doublé d'une ombre portée en bas à droite.
  PP.deriverOmbre = function () {
    var ok = refaire(1, 2, function (n, lire, h1) {
      var x, y;
      for (y = 0; y < h1; y++) {
        for (x = 0; x < GL; x++) {
          if (!lire(x - 1, y - 1) && (voisin(lire, x - 1, y - 1) || voisin(lire, x - 2, y - 2))) n[y * GL + x] = 1;
        }
      }
    });
    if (!ok) return false;
    elargir(3);
    nommer('Ombré');
    PP.revision++;
    PP.valider('Dériver une ombre');
    return true;
  };
})();
