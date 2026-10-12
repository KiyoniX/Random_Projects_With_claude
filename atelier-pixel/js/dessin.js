(function () {
  'use strict';

  var A = window.Atelier;

  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var FORMES = { ligne: true, rect: true, ellipse: true };
  var NOMS = {
    crayon: 'Crayon', gomme: 'Gomme', trame: 'Tramage', eclaircir: 'Éclaircir', assombrir: 'Assombrir',
    ligne: 'Ligne', rect: 'Rectangle', ellipse: 'Ellipse'
  };

  // ---------- Primitives ----------
  function ligne(x0, y0, x1, y1, f) {
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, e2;
    for (;;) {
      f(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Ellipse inscrite dans le rectangle donné (algorithme d'Alois Zingl).
  function ellipse(x0, y0, x1, y1, f) {
    var a = Math.abs(x1 - x0), b = Math.abs(y1 - y0), b1 = b & 1;
    var dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a, err = dx + dy + b1 * a * a, e2;
    if (x0 > x1) { x0 = x1; x1 += a; }
    if (y0 > y1) y0 = y1;
    y0 += (b + 1) >> 1; y1 = y0 - b1;
    a = 8 * a * a; b1 = 8 * b * b;
    do {
      f(x1, y0); f(x0, y0); f(x0, y1); f(x1, y1);
      e2 = 2 * err;
      if (e2 <= dy) { y0++; y1--; err += dy += a; }
      if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
    } while (x0 <= x1);
    while (y0 - y1 <= b) {
      f(x0 - 1, y0); f(x1 + 1, y0++);
      f(x0 - 1, y1); f(x1 + 1, y1--);
    }
  }

  // Pixels de même couleur que (x, y) : la zone qui le touche, ou tous ceux du tampon.
  function zone(buf, w, h, x, y, contigu, clip) {
    var m = new Uint8Array(w * h), cible = buf[y * w + x], i, pile, p, px;
    if (clip && !clip[y * w + x]) return m;
    if (!contigu) {
      for (i = 0; i < m.length; i++) if (buf[i] === cible && (!clip || clip[i])) m[i] = 1;
      return m;
    }
    pile = [y * w + x];
    m[pile[0]] = 1;
    function voir(q) {
      if (!m[q] && buf[q] === cible && (!clip || clip[q])) { m[q] = 1; pile.push(q); }
    }
    while (pile.length) {
      p = pile.pop(); px = p % w;
      if (px > 0) voir(p - 1);
      if (px < w - 1) voir(p + 1);
      if (p >= w) voir(p - w);
      if (p < m.length - w) voir(p + w);
    }
    return m;
  }

  A.ligne = ligne; A.ellipse = ellipse; A.zone = zone;

  function peindre(base, couleur) { return couleur >>> 24 === 0 ? 0 : A.sur(base, couleur); }

  var pinceaux = {};
  function pinceau(taille) {
    if (pinceaux[taille]) return pinceaux[taille];
    var p = [], c = (taille - 1) / 2, o = -(taille >> 1), i, j;
    for (j = 0; j < taille; j++) {
      for (i = 0; i < taille; i++) {
        if (taille < 3 || (i - c) * (i - c) + (j - c) * (j - c) <= taille * taille / 4) p.push(o + i, o + j);
      }
    }
    return (pinceaux[taille] = p);
  }
  A.pinceau = pinceau;

  // Contraint le second point : droite à 45° pour une ligne, carré pour les autres formes.
  function contraindre(outil, x0, y0, x, y) {
    var dx = x - x0, dy = y - y0, ax = Math.abs(dx), ay = Math.abs(dy), l = Math.max(ax, ay);
    if (outil === 'ligne') {
      if (ax > 2 * ay) return [x, y0];
      if (ay > 2 * ax) return [x0, y];
    }
    return [x0 + (dx < 0 ? -l : l), y0 + (dy < 0 ? -l : l)];
  }
  A.contraindre = contraindre;

  // ---------- Tracé ----------
  // Un tracé se fait toujours à partir du celluloïd d'origine (base) : chaque pixel n'est peint
  // qu'une fois, ce qui permet aussi de le rendre à son état d'origine (pixel parfait, formes).
  var T = null;

  function appliquer(i, x, y) {
    var o = T.o, b = T.base[i];
    switch (o.outil) {
      case 'gomme': return 0;
      case 'eclaircir': return A.lumiere(b, 1);
      case 'assombrir': return A.lumiere(b, -1);
      case 'trame': return ((x + y) & 1) ? (o.couleur2 >>> 24 ? A.sur(b, o.couleur2) : b) : peindre(b, o.couleur);
      default: return peindre(b, o.couleur);
    }
  }

  function un(x, y, signe) {
    if (x < 0 || y < 0 || x >= T.w || y >= T.h) return;
    var i = y * T.w + x;
    if (T.clip && !T.clip[i]) return;
    if (signe > 0) {
      if (++T.touche[i] === 1) T.buf[i] = appliquer(i, x, y);
    } else if (T.touche[i] && --T.touche[i] === 0) {
      T.buf[i] = T.base[i];
    }
  }

  function pose(x, y, signe) {
    un(x, y, signe);
    if (T.sh) un(T.w - 1 - x, y, signe);
    if (T.sv) un(x, T.h - 1 - y, signe);
    if (T.sh && T.sv) un(T.w - 1 - x, T.h - 1 - y, signe);
  }

  function tampon(x, y, signe) {
    for (var k = 0; k < T.pin.length; k += 2) pose(x + T.pin[k], y + T.pin[k + 1], signe);
  }

  function point(x, y) {
    var p = T.pts, a, b;
    tampon(x, y, 1);
    p.push(x, y);
    if (T.parfait && p.length >= 6) {
      a = p.length - 6; b = p.length - 4;
      // Le point du milieu forme un angle droit entre ses deux voisins : on le retire.
      if ((p[a] === p[b] || p[a + 1] === p[b + 1]) && (x === p[b] || y === p[b + 1]) && p[a] !== x && p[a + 1] !== y) {
        tampon(p[b], p[b + 1], -1);
        p.splice(b, 2);
      }
    }
    if (p.length > 8) p.splice(0, 2);
  }

  function forme(x, y) {
    var o = T.o, x0 = T.x0, y0 = T.y0, xa, xb, ya, yb, i, j, bords;
    T.buf.set(T.base);
    T.touche.fill(0);
    if (o.outil === 'ligne') { ligne(x0, y0, x, y, function (px, py) { tampon(px, py, 1); }); return; }
    xa = Math.min(x0, x); xb = Math.max(x0, x); ya = Math.min(y0, y); yb = Math.max(y0, y);
    if (o.outil === 'rect') {
      if (o.plein) {
        for (j = ya; j <= yb; j++) for (i = xa; i <= xb; i++) pose(i, j, 1);
      } else {
        for (i = xa; i <= xb; i++) { tampon(i, ya, 1); tampon(i, yb, 1); }
        for (j = ya; j <= yb; j++) { tampon(xa, j, 1); tampon(xb, j, 1); }
      }
      return;
    }
    if (!o.plein) { ellipse(xa, ya, xb, yb, function (px, py) { tampon(px, py, 1); }); return; }
    bords = {};
    ellipse(xa, ya, xb, yb, function (px, py) {
      var r = bords[py];
      if (!r) bords[py] = [px, px];
      else { if (px < r[0]) r[0] = px; if (px > r[1]) r[1] = px; }
    });
    for (j in bords) for (i = bords[j][0]; i <= bords[j][1]; i++) pose(i, Number(j), 1);
  }

  // o : { outil, x, y, couleur, couleur2, taille, symetrie ('', 'h', 'v', 'hv'), pixelParfait, plein }
  // Rend '' si le tracé commence, sinon la raison du refus.
  A.traitDebut = function (o) {
    var refus = A.calqueLibre();
    if (refus) return refus;
    var d = A.doc, n = d.w * d.h, ancre = A.selAncrer(), orig = A.celLire(d.iImage, d.iCalque), base, sym = o.symetrie || '';
    if (orig) { orig.fige = true; base = orig; } else base = new Uint32Array(n);
    T = {
      o: o, ancre: ancre, orig: orig, base: base, image: d.images[d.iImage], id: d.calques[d.iCalque].id,
      buf: A.celEcrire(d.iImage, d.iCalque), touche: new Uint16Array(n), clip: A.selMasquePlein(),
      w: d.w, h: d.h, x0: o.x, y0: o.y, pts: [], pin: pinceau(Math.max(1, o.taille || 1)),
      sh: sym.indexOf('h') >= 0, sv: sym.indexOf('v') >= 0,
      parfait: !!o.pixelParfait && (o.taille || 1) === 1 && !FORMES[o.outil]
    };
    if (FORMES[o.outil]) forme(o.x, o.y); else point(o.x, o.y);
    return '';
  };

  A.traitVers = function (x, y, contraint) {
    if (!T) return;
    if (FORMES[T.o.outil]) {
      if (contraint) { var c = contraindre(T.o.outil, T.x0, T.y0, x, y); x = c[0]; y = c[1]; }
      forme(x, y);
      return;
    }
    var p = T.pts, lx = p[p.length - 2], ly = p[p.length - 1], premier = true;
    if (lx === x && ly === y) return;
    ligne(lx, ly, x, y, function (px, py) {
      if (premier) premier = false; else point(px, py);
    });
  };

  function remettre(t) {
    if (t.orig) t.image.cels[t.id] = t.orig; else delete t.image.cels[t.id];
  }

  A.traitFin = function () {
    var t = T, change, i;
    T = null;
    if (!t) return false;
    change = t.ancre;
    for (i = 0; !change && i < t.buf.length; i++) change = t.buf[i] !== t.base[i];
    if (!change) { remettre(t); return false; }
    A.valider(NOMS[t.o.outil] || 'Dessin');
    return true;
  };

  A.traitAnnuler = function () {
    var t = T;
    T = null;
    if (!t) return;
    remettre(t);
    if (t.ancre) A.valider('Ancrer la sélection');
  };

  A.traitEnCours = function () { return !!T; };

  // ---------- Opérations directes ----------
  // Ouvre le celluloïd actif en écriture, applique f(tampon, base, masque de sélection) et valide si f rend vrai.
  function modifier(nom, f) {
    var refus = A.calqueLibre();
    if (refus) return refus;
    var d = A.doc, ancre = A.selAncrer(), orig = A.celLire(d.iImage, d.iCalque), im = d.images[d.iImage], id = d.calques[d.iCalque].id;
    var base = orig || new Uint32Array(d.w * d.h);
    base.fige = true;
    if (f(A.celEcrire(d.iImage, d.iCalque), base, A.selMasquePlein())) { A.valider(nom); return ''; }
    if (orig) im.cels[id] = orig; else delete im.cels[id];
    if (ancre) A.valider('Ancrer la sélection');
    return 'rien';
  }
  A.modifier = modifier;

  A.remplir = function (x, y, couleur, contigu, symetrie) {
    var d = A.doc, w = d.w, h = d.h, sym = symetrie || '';
    if (x < 0 || y < 0 || x >= w || y >= h) return 'rien';
    return modifier('Pot de peinture', function (buf, base, clip) {
      var graines = [[x, y]], change = false, g, m, i, c;
      if (sym.indexOf('h') >= 0) graines.push([w - 1 - x, y]);
      if (sym.indexOf('v') >= 0) graines.push([x, h - 1 - y]);
      if (sym === 'hv') graines.push([w - 1 - x, h - 1 - y]);
      for (g = 0; g < graines.length; g++) {
        m = zone(base, w, h, graines[g][0], graines[g][1], contigu, clip);
        for (i = 0; i < m.length; i++) {
          if (!m[i]) continue;
          c = peindre(base[i], couleur);
          if (c !== base[i]) { buf[i] = c; change = true; }
        }
      }
      return change;
    });
  };

  // Dégradé de c1 (en x0, y0) à c2 (en x1, y1), tramé en motif ordonné ou lissé.
  A.degrade = function (x0, y0, x1, y1, c1, c2, trame) {
    var w = A.doc.w, h = A.doc.h, dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    return modifier('Dégradé', function (buf, base, clip) {
      var x, y, i, t, c, change = false;
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          i = y * w + x;
          if (clip && !clip[i]) continue;
          t = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
          if (trame) c = t * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5 ? c2 : c1;
          else c = A.melange(c1, c2, t);
          c = c >>> 24 ? A.sur(base[i], c) : base[i];
          if (c !== base[i]) { buf[i] = c; change = true; }
        }
      }
      return change;
    });
  };

  // Couleur visible en (x, y), tous calques confondus.
  A.pipette = function (x, y) {
    var d = A.doc;
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return null;
    return A.composer(d.iImage)[y * d.w + x];
  };
})();
