(function () {
  'use strict';

  // Le vitrail se mesure en millimètres, origine en haut à gauche du panneau, y vers le bas.
  // Le réseau de plombs est un graphe planaire : des nœuds { id, x, y } et des plombs { id, a, b, c, l, bord },
  // où c vaut null pour un plomb droit ou [x1, y1, x2, y2] pour une courbe de Bézier cubique.
  // Invariant : deux plombs ne se croisent jamais ailleurs qu'en un nœud. Chaque ajout coupe ce qu'il croise.
  var V = window.Vitrail = window.Vitrail || {};
  var G = V.geo = {};

  var EPS = 0.4;           // deux points plus proches que ça, en mm, sont le même nœud
  var PAS_COURBE = 2.5;    // longueur d'un segment quand on aplatit une courbe, en mm
  var K_ARC = 4 / 3;       // pour approcher un arc de cercle par une cubique

  G.EPS = EPS;

  function r2(v) { return Math.round(v * 100) / 100; }
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  G.r2 = r2; G.dist = dist;

  // ---------- Bézier ----------
  function pointBez(a, c, b, t) {
    var u = 1 - t;
    if (!c) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    return {
      x: u * u * u * a.x + 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * b.y
    };
  }
  G.pointBez = pointBez;

  // Coupe une courbe en t (de Casteljau) : [contrôles de la première moitié, point de coupe, contrôles de la seconde].
  function couperBez(a, c, b, t) {
    if (!c) return [null, lerp(a, b, t), null];
    var c1 = { x: c[0], y: c[1] }, c2 = { x: c[2], y: c[3] };
    var p01 = lerp(a, c1, t), p12 = lerp(c1, c2, t), p23 = lerp(c2, b, t), p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
    return [[p01.x, p01.y, p012.x, p012.y], m, [p123.x, p123.y, p23.x, p23.y]];
  }

  // Coupe une courbe aux paramètres ts (croissants, dans ]0, 1[). Rend les morceaux { c, b }.
  function decouper(a, c, b, ts) {
    var out = [], prec = 0, deb = a, cc = c, i, u, r;
    for (i = 0; i < ts.length; i++) {
      u = (ts[i] - prec) / (1 - prec);
      r = couperBez(deb, cc, b, u);
      out.push({ c: r[0], b: r[1] });
      deb = r[1]; cc = r[2]; prec = ts[i];
    }
    out.push({ c: cc, b: b });
    return out;
  }

  // Une courbe en polyligne ; chaque point garde son paramètre t.
  function aplatir(a, c, b) {
    var l, n, i, p, out = [];
    if (!c) return [{ x: a.x, y: a.y, t: 0 }, { x: b.x, y: b.y, t: 1 }];
    l = Math.hypot(c[0] - a.x, c[1] - a.y) + Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(b.x - c[2], b.y - c[3]);
    n = Math.max(6, Math.min(160, Math.ceil(l / PAS_COURBE)));
    for (i = 0; i <= n; i++) { p = pointBez(a, c, b, i / n); p.t = i / n; out.push(p); }
    return out;
  }
  G.aplatir = aplatir;

  function boite(pts) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    pts.forEach(function (p) { if (p.x < b.x0) b.x0 = p.x; if (p.x > b.x1) b.x1 = p.x; if (p.y < b.y0) b.y0 = p.y; if (p.y > b.y1) b.y1 = p.y; });
    return b;
  }
  function chevauche(a, b, m) { m = m || 0; return a.x0 <= b.x1 + m && b.x0 <= a.x1 + m && a.y0 <= b.y1 + m && b.y0 <= a.y1 + m; }
  G.boite = boite;

  // La polyligne d'un plomb, gardée tant que ses extrémités et ses contrôles ne bougent pas.
  var traces = new WeakMap();
  function trace(doc, e) {
    var a = doc.noeuds[e.a], b = doc.noeuds[e.b], k = a.x + ',' + a.y + ',' + b.x + ',' + b.y + (e.c ? ',' + e.c.join(',') : ''), m = traces.get(e);
    if (m && m.k === k) return m.p;
    m = { k: k, p: aplatir(a, e.c, b) };
    m.p.bb = boite(m.p);
    traces.set(e, m);
    return m.p;
  }
  G.trace = trace;

  // Direction de départ d'un plomb depuis l'extrémité « de » (exacte : la tangente de la courbe).
  function tangente(doc, e, de) {
    var a = doc.noeuds[e.a], b = doc.noeuds[e.b], dx, dy;
    if (de === e.a) {
      if (e.c) { dx = e.c[0] - a.x; dy = e.c[1] - a.y; if (dx * dx + dy * dy < 1e-8) { dx = e.c[2] - a.x; dy = e.c[3] - a.y; } }
      else { dx = b.x - a.x; dy = b.y - a.y; }
    } else {
      if (e.c) { dx = e.c[2] - b.x; dy = e.c[3] - b.y; if (dx * dx + dy * dy < 1e-8) { dx = e.c[0] - b.x; dy = e.c[1] - b.y; } }
      else { dx = a.x - b.x; dy = a.y - b.y; }
    }
    return { x: dx, y: dy };
  }

  function croise(p, q, r, s) {
    var ux = q.x - p.x, uy = q.y - p.y, vx = s.x - r.x, vy = s.y - r.y, d = ux * vy - uy * vx, wx, wy, t, u;
    if (Math.abs(d) < 1e-12) return null;
    wx = r.x - p.x; wy = r.y - p.y;
    t = (wx * vy - wy * vx) / d; u = (wx * uy - wy * ux) / d;
    if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null;
    return { t: t, u: u, x: p.x + ux * t, y: p.y + uy * t };
  }

  G.croisent = function (p, q, r, t) { return !!croise(p, q, r, t); };

  // Le point d'une polyligne le plus proche de q : { d, x, y, t }.
  function projeter(pts, q) {
    var best = { d: Infinity }, i, a, b, dx, dy, l2, s, x, y, d;
    for (i = 0; i < pts.length - 1; i++) {
      a = pts[i]; b = pts[i + 1]; dx = b.x - a.x; dy = b.y - a.y; l2 = dx * dx + dy * dy;
      s = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
      x = a.x + dx * s; y = a.y + dy * s; d = Math.hypot(q.x - x, q.y - y);
      if (d < best.d) best = { d: d, x: x, y: y, t: a.t + (b.t - a.t) * s };
    }
    return best;
  }
  G.projeter = projeter;

  // ---------- Formes de panneau ----------
  // Arc de cercle en cubiques, de l'angle a0 à a1 (en radians, y vers le bas : un angle croissant tourne dans le sens des aiguilles).
  function arc(cx, cy, r, a0, a1) {
    var n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9)), d = (a1 - a0) / n, k = K_ARC * Math.tan(d / 4) * r, out = [], i, t0, t1;
    for (i = 0; i < n; i++) {
      t0 = a0 + d * i; t1 = t0 + d;
      out.push({
        a: { x: cx + r * Math.cos(t0), y: cy + r * Math.sin(t0) },
        c: [cx + r * Math.cos(t0) - k * Math.sin(t0), cy + r * Math.sin(t0) + k * Math.cos(t0), cx + r * Math.cos(t1) + k * Math.sin(t1), cy + r * Math.sin(t1) - k * Math.cos(t1)],
        b: { x: cx + r * Math.cos(t1), y: cy + r * Math.sin(t1) }
      });
    }
    return out;
  }
  G.arc = arc;
  function droit(a, b) { return { a: a, c: null, b: b }; }
  // Applique (x, y) → (x·sx + tx, y·sy + ty) à une liste de segments.
  function affine(segs, sx, sy, tx, ty) {
    return segs.map(function (s) {
      return {
        a: { x: s.a.x * sx + tx, y: s.a.y * sy + ty }, b: { x: s.b.x * sx + tx, y: s.b.y * sy + ty },
        c: s.c ? [s.c[0] * sx + tx, s.c[1] * sy + ty, s.c[2] * sx + tx, s.c[3] * sy + ty] : null
      };
    });
  }

  G.affine = affine;

  // Une chaîne de Catmull-Rom en cubiques passant par les points. ferme : la chaîne revient au premier point.
  function catmull(pts, ferme) {
    var n = pts.length, out = [], i, p0, p1, p2, p3, m = ferme ? n : n - 1;
    function P(i) {
      if (ferme) return pts[(i + n) % n];
      if (i < 0) return { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y };
      if (i >= n) return { x: 2 * pts[n - 1].x - pts[n - 2].x, y: 2 * pts[n - 1].y - pts[n - 2].y };
      return pts[i];
    }
    if (n < 2) return out;
    if (n === 2 && !ferme) return [droit(pts[0], pts[1])];
    for (i = 0; i < m; i++) {
      p0 = P(i - 1); p1 = P(i); p2 = P(i + 1); p3 = P(i + 2);
      out.push({ a: p1, c: [p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6], b: p2 });
    }
    return out;
  }
  G.catmull = catmull;

  G.FORMES = [
    { id: 'rect', nom: 'Rectangle' },
    { id: 'lancette', nom: 'Lancette en ogive' },
    { id: 'oeil', nom: 'Œil-de-bœuf' },
    { id: 'rosace', nom: 'Rosace à lobes' },
    { id: 'trefle', nom: 'Trèfle' },
    { id: 'quadrilobe', nom: 'Quadrilobe' },
    { id: 'libre', nom: 'Forme libre' }
  ];

  // Les lobes d'un polylobe de rayon 1 centré en 0 : centres, rayon, et pointes rentrantes entre deux lobes.
  function lobes(n) {
    var s = Math.sin(Math.PI / n), d = 1 / (1 + 1.25 * s), r = 1 - d, rho = d * Math.cos(Math.PI / n) + Math.sqrt(Math.max(0, r * r - d * d * s * s)), out = { r: r, d: d, centres: [], pointes: [] }, i, phi;
    for (i = 0; i < n; i++) {
      phi = -Math.PI / 2 + i * 2 * Math.PI / n;
      out.centres.push({ x: d * Math.cos(phi), y: d * Math.sin(phi), phi: phi });
      out.pointes.push({ x: rho * Math.cos(phi + Math.PI / n), y: rho * Math.sin(phi + Math.PI / n) });
    }
    return out;
  }

  function nombreLobes(f) { return f.type === 'trefle' ? 3 : f.type === 'quadrilobe' ? 4 : Math.max(5, Math.min(16, Math.round(f.lobes) || 8)); }

  // Le contour du panneau : une boucle de segments, dans le sens des aiguilles d'une montre, dans le rectangle 0..l × 0..h.
  G.contour = function (f) {
    var L = f.l, H = f.h, segs = [], ha, lo, n, i, c, a0, a1, prev, k;
    if (f.type === 'lancette') {
      // Arc brisé équilatéral : chaque arc a pour centre la naissance de l'autre. Trop bas, il s'aplatit.
      ha = Math.min(0.866 * L, 0.75 * H); k = ha / (0.866 * L);
      segs.push(droit({ x: 0, y: H }, { x: 0, y: ha }));
      segs = segs.concat(affine(arc(L, 0.866 * L, L, Math.PI, Math.PI * 4 / 3), 1, k, 0, ha - 0.866 * L * k));
      segs = segs.concat(affine(arc(0, 0.866 * L, L, Math.PI * 5 / 3, Math.PI * 2), 1, k, 0, ha - 0.866 * L * k));
      segs.push(droit({ x: L, y: ha }, { x: L, y: H }));
      segs.push(droit({ x: L, y: H }, { x: 0, y: H }));
    } else if (f.type === 'oeil') {
      segs = affine(arc(0, 0, 1, -Math.PI, Math.PI), L / 2, H / 2, L / 2, H / 2);
    } else if (f.type === 'rosace' || f.type === 'trefle' || f.type === 'quadrilobe') {
      n = nombreLobes(f); lo = lobes(n);
      for (i = 0; i < n; i++) {
        c = lo.centres[i]; prev = lo.pointes[(i + n - 1) % n];
        a0 = Math.atan2(prev.y - c.y, prev.x - c.x); a1 = Math.atan2(lo.pointes[i].y - c.y, lo.pointes[i].x - c.x);
        while (a1 <= a0) a1 += 2 * Math.PI;
        segs = segs.concat(arc(c.x, c.y, lo.r, a0, a1));
      }
      segs = affine(segs, L / 2, H / 2, L / 2, H / 2);
    } else if (f.type === 'libre' && f.libre && f.libre.length >= 3) {
      segs = catmull(f.libre.map(function (p) { return { x: p[0] * L, y: p[1] * H }; }), true);
    } else {
      segs = [droit({ x: 0, y: 0 }, { x: L, y: 0 }), droit({ x: L, y: 0 }, { x: L, y: H }), droit({ x: L, y: H }, { x: 0, y: H }), droit({ x: 0, y: H }, { x: 0, y: 0 })];
    }
    // Les extrémités se recollent exactement d'un segment au suivant.
    segs.forEach(function (s, j) { var t = segs[(j + 1) % segs.length]; t.a = s.b; });
    return segs;
  };

  // Les pointes rentrantes d'un polylobe, en mm (vide pour les autres formes).
  G.pointesLobes = function (f) {
    if (f.type !== 'rosace' && f.type !== 'trefle' && f.type !== 'quadrilobe') return [];
    return lobes(nombreLobes(f)).pointes.map(function (p) { return { x: p.x * f.l / 2 + f.l / 2, y: p.y * f.h / 2 + f.h / 2 }; });
  };

  function polyContour(segs) {
    var out = [];
    segs.forEach(function (s) { var p = aplatir(s.a, s.c, s.b); p.pop(); out = out.concat(p); });
    return out;
  }
  G.polyContour = polyContour;

  var polyCache = { k: '', p: null };
  G.contourPoly = function (doc) {
    var f = doc.forme, k = JSON.stringify(f);
    if (polyCache.k !== k) { polyCache.k = k; polyCache.p = polyContour(G.contour(f)); polyCache.p.bb = boite(polyCache.p); }
    return polyCache.p;
  };

  function dansPoly(poly, p) {
    var dedans = false, i, j, a, b;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a = poly[i]; b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) dedans = !dedans;
    }
    return dedans;
  }
  G.dansPoly = dansPoly;

  function aireSignee(poly) {
    var s = 0, i, a, b;
    for (i = 0; i < poly.length; i++) { a = poly[i]; b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  }
  G.aireSignee = aireSignee;

  // ---------- Édition du réseau ----------
  function nouveauNoeud(doc, x, y) {
    var n = { id: doc.suivant++, x: r2(x), y: r2(y) };
    doc.noeuds[n.id] = n;
    return n.id;
  }
  function arrondirC(c) { return c ? c.map(r2) : null; }

  function noeudProche(doc, p, rayon, sauf) {
    var best = null, d = rayon, k, n, e;
    for (k in doc.noeuds) {
      n = doc.noeuds[k];
      if (n.id === sauf) continue;
      e = dist(n, p);
      if (e <= d) { d = e; best = n.id; }
    }
    return best;
  }
  G.noeudProche = noeudProche;

  // Le plomb le plus proche d'un point : { e, d, x, y, t }, ou null au-delà du rayon.
  function plombProche(doc, p, rayon, filtre) {
    var best = null;
    doc.plombs.forEach(function (e) {
      var pts, q;
      if (filtre && !filtre(e)) return;
      pts = trace(doc, e);
      if (!chevauche(pts.bb, { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, rayon)) return;
      q = projeter(pts, p);
      if (q.d <= rayon && (!best || q.d < best.d)) { q.e = e; best = q; }
    });
    return best;
  }
  G.plombProche = plombProche;

  // Remplace le plomb e par ses morceaux coupés aux paramètres ts, chacun finissant au nœud donné.
  function scinder(doc, e, ts, ids) {
    var a = doc.noeuds[e.a], b = doc.noeuds[e.b], fin = e.b, morceaux = decouper(a, e.c, b, ts), i, prec = e.a;
    for (i = 0; i < morceaux.length; i++) {
      var vers = i < ids.length ? ids[i] : fin, m = morceaux[i];
      if (i === 0) { e.b = vers; e.c = arrondirC(m.c); }
      else doc.plombs.push({ id: doc.suivant++, a: prec, b: vers, c: arrondirC(m.c), l: e.l, bord: e.bord });
      prec = vers;
    }
  }

  // Coupe le plomb e au point le plus proche de p et rend le nœud ainsi créé (ou l'extrémité, si p en est tout près).
  function couperEn(doc, e, p) {
    var q = projeter(trace(doc, e), p), id;
    if (dist(q, doc.noeuds[e.a]) < EPS) return e.a;
    if (dist(q, doc.noeuds[e.b]) < EPS) return e.b;
    id = nouveauNoeud(doc, q.x, q.y);
    scinder(doc, e, [q.t], [id]);
    return id;
  }
  G.couper = function (doc, idPlomb, p) {
    var e = G.plomb(doc, idPlomb);
    return e ? couperEn(doc, e, p) : 0;
  };

  G.plomb = function (doc, id) {
    for (var i = 0; i < doc.plombs.length; i++) if (doc.plombs[i].id === id) return doc.plombs[i];
    return null;
  };

  // Le nœud d'une extrémité : celui qu'on désigne, un nœud tout proche, un point sur un plomb (qu'on coupe), ou un nœud neuf.
  function extremite(doc, P) {
    var id, q;
    if (P.id && doc.noeuds[P.id]) return P.id;
    // Un nœud désigné qui a disparu entre-temps (nettoyé par un ajout précédent) se retrouve par sa place.
    if (!isFinite(P.x) || !isFinite(P.y)) return 0;
    id = noeudProche(doc, P, EPS);
    if (id) return id;
    q = plombProche(doc, P, EPS);
    if (q) return couperEn(doc, q.e, P);
    return nouveauNoeud(doc, P.x, P.y);
  }

  function degre(doc) {
    var d = {};
    doc.plombs.forEach(function (e) { d[e.a] = (d[e.a] || 0) + 1; d[e.b] = (d[e.b] || 0) + 1; });
    return d;
  }
  G.degres = degre;

  // Retire les nœuds qui ne tiennent plus aucun plomb.
  function nettoyer(doc) {
    var d = degre(doc), k;
    for (k in doc.noeuds) if (!d[k]) delete doc.noeuds[k];
  }

  // Le plomb chevauche-t-il un plomb existant (même tracé posé deux fois) ? Entre deux mêmes nœuds, un plomb qui longe
  // l'autre à moins d'un millimètre sur toute sa longueur est aussi un doublon : il ne laisserait qu'une lamelle sans épaisseur.
  function dejaPose(doc, m, a, b, c) {
    var q = plombProche(doc, m, EPS * 0.75);
    if (q && q.d < EPS * 0.75) return true;
    return doc.plombs.some(function (e) {
      var pts;
      if (!((e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id))) return false;
      pts = trace(doc, e);
      return [0.15, 0.3, 0.5, 0.7, 0.85].every(function (t) { return projeter(pts, pointBez(a, c, b, t)).d < 1; });
    });
  }

  // Une courbe qui, juste après l'un de ses bouts, passe hors du panneau (d'un rien, sans recouper la bordure assez loin
  // pour être coupée) fausserait l'ordre des plombs autour du nœud : elle n'est pas posée.
  function sortDuBord(poly, a, c, b) {
    var ferme = poly.concat([poly[0]]), l = dist(a, b), r = Math.min(3, l * 0.3);
    return [[a, 0, 0.5], [b, 1, 0.5]].some(function (z) {
      var lo = 0, hi = z[2], m, p, j;
      for (j = 0; j < 30; j++) { m = (lo + hi) / 2; p = pointBez(a, c, b, z[1] ? 1 - m : m); if (dist(p, z[0]) < r) lo = m; else hi = m; }
      p = pointBez(a, c, b, z[1] ? 1 - hi : hi);
      return !dansPoly(poly, p) && projeter(ferme, p).d > 0.3;
    });
  }

  // Un plomb qui va d'un nœud de bordure à un autre en longeant la bordure à moins d'un millimètre et demi ne laisserait
  // entre eux qu'une lamelle de verre impossible à couper, et rendrait la bordure ambiguë : il n'est pas posé.
  function longeBord(doc, poly, a, c, b) {
    var ferme = poly.concat([poly[0]]);
    if (!G.surBord(doc, a.id) || !G.surBord(doc, b.id)) return false;
    return [0.25, 0.5, 0.75].every(function (t) { return projeter(ferme, pointBez(a, c, b, t)).d < 1.5; });
  }

  // Ajoute un plomb de A à B (points { x, y } ou nœuds { id }), courbe si c est donné.
  // Il coupe et est coupé par tout ce qu'il croise ; ce qui sort du panneau est laissé de côté.
  // Rend le nombre de morceaux posés.
  G.ajouter = function (doc, A, B, c, l, bord) {
    var na, nb, pa, pb, pts, coupes = [], parPlomb = [], points, ts, ids, morceaux, prec, n = 0, poly = bord ? null : G.contourPoly(doc);
    if (!bord && !A.id && !B.id && dist(A, B) < EPS && !c) return 0;
    na = extremite(doc, A); nb = extremite(doc, B);
    if (!na || !nb || na === nb) { nettoyer(doc); return 0; }
    pa = doc.noeuds[na]; pb = doc.noeuds[nb];
    if (c && A.x !== undefined && (pa.x !== A.x || pa.y !== A.y)) c = [c[0] + pa.x - A.x, c[1] + pa.y - A.y, c[2], c[3]];
    if (c && B.x !== undefined && (pb.x !== B.x || pb.y !== B.y)) c = [c[0], c[1], c[2] + pb.x - B.x, c[3] + pb.y - B.y];
    pts = aplatir(pa, c, pb); pts.bb = boite(pts);

    // Les croisements avec les plombs déjà posés.
    doc.plombs.forEach(function (e) {
      var q = trace(doc, e), i, j, x, liste = null;
      if (!chevauche(pts.bb, q.bb, EPS)) return;
      for (i = 0; i < pts.length - 1; i++) {
        if (Math.max(pts[i].x, pts[i + 1].x) < q.bb.x0 - EPS || Math.min(pts[i].x, pts[i + 1].x) > q.bb.x1 + EPS ||
          Math.max(pts[i].y, pts[i + 1].y) < q.bb.y0 - EPS || Math.min(pts[i].y, pts[i + 1].y) > q.bb.y1 + EPS) continue;
        for (j = 0; j < q.length - 1; j++) {
          x = croise(pts[i], pts[i + 1], q[j], q[j + 1]);
          if (!x || dist(x, pa) < EPS || dist(x, pb) < EPS) continue;
          x.tn = pts[i].t + (pts[i + 1].t - pts[i].t) * x.t;
          x.te = q[j].t + (q[j + 1].t - q[j].t) * x.u;
          if (!liste) { liste = []; parPlomb.push({ e: e, l: liste }); }
          liste.push(x); coupes.push(x);
        }
      }
    });
    // Un nœud existant posé sur le tracé (deux plombs droits qui se chevauchent dans le même alignement) coupe aussi le nouveau plomb :
    // le morceau commun se reconnaît ensuite comme déjà posé.
    Object.keys(doc.noeuds).forEach(function (k) {
      var nd = doc.noeuds[k], q;
      if (nd.id === na || nd.id === nb || nd.x < pts.bb.x0 - EPS || nd.x > pts.bb.x1 + EPS || nd.y < pts.bb.y0 - EPS || nd.y > pts.bb.y1 + EPS) return;
      q = projeter(pts, nd);
      if (q.d < EPS * 0.5 && q.t > 1e-6 && q.t < 1 - 1e-6) coupes.push({ tn: q.t, n: nd.id, x: nd.x, y: nd.y });
    });
    // Chaque plomb croisé est coupé ; un croisement tout près d'une de ses extrémités reprend ce nœud.
    parPlomb.forEach(function (g) {
      var e = g.e, a = doc.noeuds[e.a], b = doc.noeuds[e.b], ts = [], ids = [], der = null;
      g.l.sort(function (p, q) { return p.te - q.te; });
      g.l.forEach(function (x) {
        if (dist(x, a) < EPS) x.n = e.a;
        else if (dist(x, b) < EPS) x.n = e.b;
        else if (der && dist(x, der) < EPS) x.n = der.n;
        else { x.n = nouveauNoeud(doc, x.x, x.y); ts.push(x.te); ids.push(x.n); }
        der = x;
      });
      if (ts.length) scinder(doc, e, ts, ids);
    });

    // Le nouveau plomb, coupé à chaque croisement.
    coupes.sort(function (p, q) { return p.tn - q.tn; });
    points = [{ tn: 0, n: na }];
    coupes.forEach(function (x) {
      var d = points[points.length - 1];
      if (x.n === d.n || x.n === nb) return;
      if (x.tn - d.tn < 1e-6) return;
      points.push({ tn: x.tn, n: x.n });
    });
    points.push({ tn: 1, n: nb });
    ts = []; ids = [];
    points.slice(1, -1).forEach(function (p) { ts.push(p.tn); ids.push(p.n); });
    morceaux = decouper(pa, c, pb, ts);
    prec = na;
    morceaux.forEach(function (m, i) {
      var vers = i < ids.length ? ids[i] : nb, a = doc.noeuds[prec], b = doc.noeuds[vers], mc, mil;
      if (vers === prec || dist(a, b) < EPS && !m.c) { prec = vers; return; }
      mc = arrondirC(m.c);
      // Le contrôle suit le nœud, qui a pu être arrondi ou repris un peu à côté du point exact.
      mil = pointBez(a, mc, b, 0.5);
      if ((!poly || (dansPoly(poly, mil) && !(mc && sortDuBord(poly, a, mc, b)) && !longeBord(doc, poly, a, mc, b))) && !dejaPose(doc, mil, a, b, mc)) {
        doc.plombs.push({ id: doc.suivant++, a: prec, b: vers, c: mc, l: l, bord: !!bord });
        n++;
      }
      prec = vers;
    });
    nettoyer(doc);
    return n;
  };

  // Ajoute une chaîne de segments (contour, courbe tracée) ; rend le nombre de plombs posés.
  G.ajouterChaine = function (doc, segs, l, bord) {
    var n = 0;
    segs.forEach(function (s) { n += G.ajouter(doc, { x: s.a.x, y: s.a.y }, { x: s.b.x, y: s.b.y }, s.c, l, bord); });
    return n;
  };

  // Retire des plombs, puis recolle les plombs droits alignés qu'un nœud devenu inutile séparait.
  G.retirer = function (doc, ids) {
    var ote = {}, d, k, inc, e1, e2, a, b, m;
    var bouts = {};
    ids.forEach(function (id) { ote[id] = true; });
    doc.plombs.forEach(function (e) { if (ote[e.id] && !e.bord) { bouts[e.a] = true; bouts[e.b] = true; } });
    doc.plombs = doc.plombs.filter(function (e) { return !ote[e.id] || e.bord; });
    nettoyer(doc);
    d = degre(doc);
    // Seuls les nœuds que le retrait a laissés à deux plombs sont recollés : un nœud posé exprès ailleurs reste.
    for (k in bouts) {
      if (d[k] !== 2) continue;
      inc = doc.plombs.filter(function (e) { return e.a === +k || e.b === +k; });
      e1 = inc[0]; e2 = inc[1];
      if (!e2) continue;
      if (e1.c || e2.c || e1.bord || e2.bord || e1.l !== e2.l) continue;
      a = doc.noeuds[e1.a === +k ? e1.b : e1.a]; b = doc.noeuds[e2.a === +k ? e2.b : e2.a]; m = doc.noeuds[k];
      if (a.id === b.id || Math.abs((b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x)) / (dist(a, b) || 1) > 0.05) continue;
      e1.a = a.id; e1.b = b.id;
      doc.plombs.splice(doc.plombs.indexOf(e2), 1);
      delete doc.noeuds[k];
    }
  };

  // Retire les plombs qui ne rejoignent rien, de proche en proche. Rend le nombre de plombs retirés.
  G.elaguer = function (doc) {
    var n = 0, d, pend;
    for (;;) {
      d = degre(doc);
      pend = doc.plombs.filter(function (e) { return !e.bord && (d[e.a] === 1 || d[e.b] === 1); }).map(function (e) { return e.id; });
      if (!pend.length) return n;
      n += pend.length;
      G.retirer(doc, pend);
    }
  };

  // Un nœud qui tient au bord du panneau ne se déplace pas : il ferait sortir le contour de sa forme.
  G.surBord = function (doc, id) {
    return doc.plombs.some(function (e) { return e.bord && (e.a === id || e.b === id); });
  };

  // Déplace un nœud à sa place définitive : ses plombs sont reposés, ce qui coupe ce qu'ils croisent désormais.
  // cible : { x, y } (un nœud ou un plomb tout proche le reprennent) ou { id } pour souder sur un nœud.
  G.deplacer = function (doc, id, cible, depart) {
    var n = doc.noeuds[id], inc, autres = [], fin;
    if (!n || G.surBord(doc, id)) return false;
    inc = doc.plombs.filter(function (e) { return e.a === id || e.b === id; });
    doc.plombs = doc.plombs.filter(function (e) { return inc.indexOf(e) < 0; });
    inc.forEach(function (e) {
      var autre = e.a === id ? e.b : e.a, c = e.c ? e.c.slice() : null, dx = (cible.x === undefined ? doc.noeuds[cible.id].x : cible.x) - (depart ? depart.x : n.x), dy = (cible.y === undefined ? doc.noeuds[cible.id].y : cible.y) - (depart ? depart.y : n.y);
      if (c && e.a === id) { c[0] += dx; c[1] += dy; } else if (c) { c[2] += dx; c[3] += dy; }
      autres.push({ autre: autre, c: c, depuis: e.a === id, l: e.l });
    });
    autres.forEach(function (o) { var a = doc.noeuds[o.autre]; o.p = { id: o.autre, x: a.x, y: a.y }; });
    delete doc.noeuds[id];
    fin = cible.id && doc.noeuds[cible.id] ? cible.id : extremite(doc, cible);
    if (!fin) return autres.length;
    // Chaque bout garde sa place : un ajout peut nettoyer un nœud resté seul un instant, le suivant le refait au même endroit.
    var F = { id: fin, x: doc.noeuds[fin].x, y: doc.noeuds[fin].y }, perdus = 0;
    autres.forEach(function (o) {
      if (o.autre === fin) return;
      if (!(o.depuis ? G.ajouter(doc, F, o.p, o.c, o.l) : G.ajouter(doc, o.p, F, o.c, o.l))) perdus++;
    });
    nettoyer(doc);
    // Rend le nombre de plombs qui n'ont pas pu être reposés (sortis du panneau, ou confondus avec un autre).
    return perdus;
  };

  // Les contrôles qui font passer la courbe de a à b par le point p (en son milieu).
  G.controlesPar = function (a, b, p) {
    var qx = (4 * p.x - a.x - b.x) / 2, qy = (4 * p.y - a.y - b.y) / 2;
    return [r2(a.x + (qx - a.x) * 2 / 3), r2(a.y + (qy - a.y) * 2 / 3), r2(b.x + (qx - b.x) * 2 / 3), r2(b.y + (qy - b.y) * 2 / 3)];
  };

  // Courbe le plomb pour qu'il passe par p, puis le repose (il peut croiser d'autres plombs). Rend faux si c'est un plomb de bordure.
  G.courber = function (doc, idPlomb, p) {
    var e = G.plomb(doc, idPlomb), a, b;
    if (!e || e.bord) return false;
    a = doc.noeuds[e.a]; b = doc.noeuds[e.b];
    doc.plombs.splice(doc.plombs.indexOf(e), 1);
    if (G.ajouter(doc, { id: a.id }, { id: b.id }, G.controlesPar(a, b, p), e.l)) return true;
    // La courbe sortirait du panneau ou doublerait un plomb : le plomb reste droit.
    doc.plombs.push(e);
    return false;
  };

  // Refait le réseau sur une nouvelle forme : les plombs du maître verrier sont mis à l'échelle et reposés.
  // Chaque point (x, y) devient (x·sx + dx, y·sy + dy) ; la grisaille et les verres suivent.
  G.refaire = function (doc, sx, sy, dx, dy) {
    sx = sx || 1; sy = sy || 1; dx = dx || 0; dy = dy || 0;
    function X(v) { return r2(v * sx + dx); }
    function Y(v) { return r2(v * sy + dy); }
    var auBord = {}, poly, anciens;
    doc.plombs.forEach(function (e) { if (e.bord) { auBord[e.a] = true; auBord[e.b] = true; } });
    anciens = doc.plombs.filter(function (e) { return !e.bord; }).map(function (e) {
      var a = doc.noeuds[e.a], b = doc.noeuds[e.b];
      return { a: { x: X(a.x), y: Y(a.y), bord: auBord[e.a] }, b: { x: X(b.x), y: Y(b.y), bord: auBord[e.b] }, c: e.c ? [X(e.c[0]), Y(e.c[1]), X(e.c[2]), Y(e.c[3])] : null, l: e.l };
    });
    G.bordure(doc);
    // Un plomb qui touchait l'ancien contour touche le nouveau : l'ogive, par exemple, ne grandit pas comme le rectangle.
    poly = G.contourPoly(doc).slice();
    poly.push(poly[0]);
    anciens.forEach(function (o) {
      [o.a, o.b].forEach(function (p, i) {
        var q, ox, oy;
        if (!p.bord) return;
        q = projeter(poly, p); ox = r2(q.x) - p.x; oy = r2(q.y) - p.y;
        p.x = r2(q.x); p.y = r2(q.y);
        if (o.c && i === 0) { o.c[0] += ox; o.c[1] += oy; } else if (o.c) { o.c[2] += ox; o.c[3] += oy; }
      });
      // Un plomb dont les deux bouts sont venus sur le contour et qui le longe ne séparerait qu'une lamelle : il disparaît.
      if (o.a.bord && o.b.bord && projeter(poly, pointBez(o.a, o.c, o.b, 0.5)).d < Math.max(3, dist(o.a, o.b) * 0.08)) return;
      G.ajouter(doc, { x: o.a.x, y: o.a.y }, { x: o.b.x, y: o.b.y }, o.c, o.l);
    });
    reparer(doc);
    doc.pieces.forEach(function (p) { p.x = X(p.x); p.y = Y(p.y); });
    doc.grisaille.forEach(function (s) { s.pts = s.pts.map(function (q) { return [X(q[0]), Y(q[1])]; }); s.l = r2(s.l * Math.sqrt(sx * sy)); });
  };

  // Après un changement de forme, de vieux plombs peuvent frôler la nouvelle bordure à quelques dixièmes de millimètre près,
  // assez pour que les pièces ne pavent plus le panneau. On le vérifie, et l'on retire alors les plombs les plus collés
  // à la bordure, un par un, jusqu'à ce que les pièces couvrent de nouveau tout le panneau. Rend le nombre de plombs retirés.
  function reparer(doc) {
    var A = G.aireContour(doc), poly = G.contourPoly(doc), ferme = poly.concat([poly[0]]), n = 0, r, S, l;
    function ecart() { r = faces(doc); S = r.faces.reduce(function (s, f) { return s + f.aire; }, 0); return Math.abs(S / A - 1); }
    while (ecart() > 1e-4 && n < 40) {
      l = doc.plombs.filter(function (e) { return !e.bord; }).map(function (e) {
        var a = doc.noeuds[e.a], b = doc.noeuds[e.b], m = Infinity, t;
        for (t = 0.1; t < 0.95; t += 0.1) m = Math.min(m, projeter(ferme, pointBez(a, e.c, b, t)).d);
        return { e: e, d: m };
      }).sort(function (p, q) { return p.d - q.d; });
      if (!l.length || l[0].d > 3) break;
      G.retirer(doc, [l[0].e.id]);
      n++;
    }
    return n;
  }
  G.reparer = reparer;

  // Pose le contour seul : le réseau est vidé.
  G.bordure = function (doc) {
    var segs = G.contour(doc.forme), ids = [];
    doc.noeuds = {}; doc.plombs = [];
    segs.forEach(function (s) { ids.push(nouveauNoeud(doc, s.a.x, s.a.y)); });
    segs.forEach(function (s, i) {
      var b = ids[(i + 1) % ids.length], pa = doc.noeuds[ids[i]], pb = doc.noeuds[b], c = arrondirC(s.c);
      if (c) { c[0] += pa.x - s.a.x; c[1] += pa.y - s.a.y; c[2] += pb.x - s.b.x; c[3] += pb.y - s.b.y; c = arrondirC(c); }
      doc.plombs.push({ id: doc.suivant++, a: ids[i], b: b, c: c, l: doc.bordure, bord: true });
    });
  };

  // ---------- Pièces ----------
  // Les faces bornées du réseau, après avoir mis de côté les plombs pendants (qui ne séparent rien).
  function faces(doc) {
    var N = doc.noeuds, actifs = [], adj = {}, deg = {}, file = [], pendants = [], tous = degre(doc), k, n, e, i, sortants = {}, demis = [], cycles = [], vu, h, cyc, pere = {};
    doc.plombs.forEach(function (e) { (adj[e.a] = adj[e.a] || []).push(e); (adj[e.b] = adj[e.b] || []).push(e); });
    for (k in adj) { deg[k] = adj[k].length; if (deg[k] === 1) file.push(+k); }
    var ote = {};
    while (file.length) {
      n = file.pop();
      if (deg[n] !== 1) continue;
      e = adj[n].filter(function (x) { return !ote[x.id]; })[0];
      if (!e) continue;
      ote[e.id] = true; pendants.push(e);
      deg[e.a]--; deg[e.b]--;
      k = e.a === n ? e.b : e.a;
      if (deg[k] === 1) file.push(k);
    }
    doc.plombs.forEach(function (e) { if (!ote[e.id]) actifs.push(e); });

    // Demi-plombs et ordre angulaire autour de chaque nœud.
    function racine(x) { while (pere[x] !== undefined && pere[x] !== x) x = pere[x]; return x; }
    actifs.forEach(function (e) {
      var h0 = { e: e, de: e.a, vers: e.b, s: 1 }, h1 = { e: e, de: e.b, vers: e.a, s: -1 }, ra, rb;
      h0.jumeau = h1; h1.jumeau = h0;
      [h0, h1].forEach(function (h) {
        (sortants[h.de] = sortants[h.de] || []).push(h);
        demis.push(h);
      });
      if (pere[e.a] === undefined) pere[e.a] = e.a;
      if (pere[e.b] === undefined) pere[e.b] = e.b;
      ra = racine(e.a); rb = racine(e.b);
      if (ra !== rb) pere[ra] = rb;
    });
    // L'ordre des plombs autour d'un nœud se lit là où chacun traverse un petit cercle centré sur le nœud, pas sur
    // leurs tangentes : une courbe qui frôle la bordure peut partir un rien vers l'extérieur avant d'y revenir.
    for (k in sortants) {
      var rayon = 3;
      sortants[k].forEach(function (h) { rayon = Math.min(rayon, 0.3 * dist(N[h.e.a], N[h.e.b])); });
      sortants[k].forEach(function (h) {
        var e = h.e, a = N[e.a], b = N[e.b], o = N[h.de], lo = 0, hi = 0.5, m, p, j;
        if (!e.c) { h.ang = Math.atan2((h.s > 0 ? b.y - a.y : a.y - b.y), (h.s > 0 ? b.x - a.x : a.x - b.x)); return; }
        for (j = 0; j < 30; j++) { m = (lo + hi) / 2; p = pointBez(a, e.c, b, h.s > 0 ? m : 1 - m); if (dist(p, o) < rayon) lo = m; else hi = m; }
        p = pointBez(a, e.c, b, h.s > 0 ? hi : 1 - hi);
        h.ang = Math.atan2(p.y - o.y, p.x - o.x);
      });
      sortants[k].sort(function (p, q) { return p.ang - q.ang; });
      sortants[k].forEach(function (h, j) { h.rang = j; });
    }
    // Tourner toujours au plus près à gauche laisse la face à gauche du trajet.
    demis.forEach(function (h) {
      var l = sortants[h.vers], j = h.jumeau.rang;
      h.suivant = l[(j + 1) % l.length];
    });
    vu = new Set();
    demis.forEach(function (h0) {
      if (vu.has(h0)) return;
      cyc = []; h = h0;
      while (!vu.has(h)) { vu.add(h); cyc.push(h); h = h.suivant; }
      cycles.push(cyc);
    });

    var out = [], trous = [];
    cycles.forEach(function (cyc) {
      var poly = [], A;
      cyc.forEach(function (h) {
        var q = trace(doc, h.e), j;
        if (h.s > 0) for (j = 0; j < q.length - 1; j++) poly.push({ x: q[j].x, y: q[j].y });
        else for (j = q.length - 1; j > 0; j--) poly.push({ x: q[j].x, y: q[j].y });
      });
      A = aireSignee(poly);
      // Avec ce sens de parcours, une face bornée a une aire négative ; le dehors d'un îlot, positive.
      if (A < 0) out.push({ demis: cyc, poly: poly.reverse(), aireBrute: -A, comp: racine(cyc[0].de), trous: [] });
      else trous.push({ poly: poly, aire: A, comp: racine(cyc[0].de) });
    });
    // Le plus grand dehors est celui du panneau ; les autres sont des îlots posés dans une pièce.
    trous.sort(function (p, q) { return q.aire - p.aire; });
    trous.slice(1).forEach(function (t) {
      var mieux = null, p = t.poly[0];
      out.forEach(function (f) {
        if (f.comp === t.comp || (mieux && f.aireBrute >= mieux.aireBrute)) return;
        if (dansPoly(f.poly, p)) mieux = f;
      });
      if (mieux) mieux.trous.push(t.poly);
    });
    out.forEach(function (f) {
      f.aire = f.aireBrute - f.trous.reduce(function (s, t) { return s + Math.abs(aireSignee(t)); }, 0);
      f.bb = boite(f.poly);
    });
    return { faces: out, pendants: pendants, degres: tous, dehors: trous };
  }

  // Un point bien à l'intérieur de la pièce : le milieu du plus large intervalle sur quelques horizontales.
  function interieur(f) {
    var bb = f.bb, mieux = null, i, y, xs, k;
    var anneaux = [f.poly].concat(f.trous);
    for (i = 1; i <= 11; i++) {
      y = bb.y0 + (bb.y1 - bb.y0) * (i / 12) + 1e-4;
      xs = [];
      anneaux.forEach(function (poly) {
        var j, a, b;
        for (j = 0; j < poly.length; j++) {
          a = poly[j]; b = poly[(j + 1) % poly.length];
          if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
        }
      });
      xs.sort(function (p, q) { return p - q; });
      for (k = 0; k + 1 < xs.length; k += 2) {
        // Une marge verticale départage les intervalles : on préfère le milieu de la pièce à ses bords.
        var w = (xs[k + 1] - xs[k]) * (1 - 0.6 * Math.abs(i / 12 - 0.5));
        if (!mieux || w > mieux.w) mieux = { w: w, x: (xs[k] + xs[k + 1]) / 2, y: y };
      }
    }
    return mieux ? { x: r2(mieux.x), y: r2(mieux.y) } : { x: r2((bb.x0 + bb.x1) / 2), y: r2((bb.y0 + bb.y1) / 2) };
  }

  G.dansFace = function (f, p) {
    if (p.x < f.bb.x0 || p.x > f.bb.x1 || p.y < f.bb.y0 || p.y > f.bb.y1) return false;
    if (!dansPoly(f.poly, p)) return false;
    for (var i = 0; i < f.trous.length; i++) if (dansPoly(f.trous[i], p)) return false;
    return true;
  };

  // ---------- Règles du métier ----------
  G.REGLES = { aireMin: 4, angleMin: 25, rentrant: 195, creux: 0.35, rapportMax: 10, largeurMin: 10 };

  function enveloppe(pts) {
    var p = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; }), bas = [], haut = [], i;
    function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    for (i = 0; i < p.length; i++) { while (bas.length >= 2 && cr(bas[bas.length - 2], bas[bas.length - 1], p[i]) <= 0) bas.pop(); bas.push(p[i]); }
    for (i = p.length - 1; i >= 0; i--) { while (haut.length >= 2 && cr(haut[haut.length - 2], haut[haut.length - 1], p[i]) <= 0) haut.pop(); haut.push(p[i]); }
    bas.pop(); haut.pop();
    return bas.concat(haut);
  }
  function distSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, s = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - a.x - dx * s, p.y - a.y - dy * s);
  }
  function perimetre(poly) {
    var s = 0, i;
    for (i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
    return s;
  }

  // Les coins d'une pièce : à chaque nœud de son contour, l'angle intérieur en degrés.
  function coins(doc, f) {
    var out = [], hs = f.demis, n = hs.length, i, h, p, din, dout, t, cr, dot, tour;
    for (i = 0; i < n; i++) {
      p = hs[(i + n - 1) % n]; h = hs[i];
      t = tangente(doc, p.e, p.vers); din = { x: -t.x, y: -t.y };
      dout = tangente(doc, h.e, h.de);
      cr = din.x * dout.y - din.y * dout.x; dot = din.x * dout.x + din.y * dout.y;
      tour = Math.atan2(cr, dot);
      // Le contour est parcouru face à gauche, dans le sens où une aire de face est négative : un coin saillant tourne à rebours.
      out.push({ noeud: h.de, x: doc.noeuds[h.de].x, y: doc.noeuds[h.de].y, angle: 180 + tour * 180 / Math.PI });
    }
    return out;
  }

  G.faces = faces;
  G.analyser = function (doc) {
    var r = faces(doc), R = doc.regles || G.REGLES, av = [], d = r.degres, aireTotale = 0, bande;
    r.faces.forEach(function (f) {
      var h, P, q, rho, w, cs, prof = 0, bouche = 1, ou = null, rentrant = false;
      f.centre = interieur(f);
      aireTotale += f.aire;
      f.avert = [];
      if (f.aire < R.aireMin * 100) f.avert.push({ type: 'petite', x: f.centre.x, y: f.centre.y, texte: 'trop petite (' + (f.aire / 100).toFixed(1).replace('.', ',') + ' cm²)' });
      cs = coins(doc, f);
      f.coins = cs;
      cs.forEach(function (c) {
        if (c.angle < R.angleMin) f.avert.push({ type: 'pointe', x: c.x, y: c.y, texte: 'pointe de ' + Math.round(c.angle) + '°' });
        else if (c.angle > R.rentrant) { rentrant = true; f.avert.push({ type: 'rentrant', x: c.x, y: c.y, texte: 'angle rentrant de ' + Math.round(c.angle) + '°' }); }
      });
      // Un creux trop profond : la coupe au diamant ne suit pas une courbe rentrante serrée.
      h = enveloppe(f.poly);
      if (!rentrant && h.length >= 3) {
        f.poly.forEach(function (p) {
          var j, m = Infinity, k = -1, dd;
          for (j = 0; j < h.length; j++) { dd = distSeg(p, h[j], h[(j + 1) % h.length]); if (dd < m) { m = dd; k = j; } }
          if (m > prof) { prof = m; bouche = dist(h[k], h[(k + 1) % h.length]); ou = p; }
        });
        if (prof > 4 && prof > R.creux * bouche) f.avert.push({ type: 'creux', x: ou.x, y: ou.y, texte: 'creux trop profond (' + Math.round(prof) + ' mm pour ' + Math.round(bouche) + ' mm d\'ouverture)' });
      }
      // Allongement : rapport longueur sur largeur d'une bande de même aire et même périmètre.
      P = perimetre(f.poly);
      q = P * P / (4 * f.aireBrute) - 2;
      rho = q > 2 ? (q + Math.sqrt(q * q - 4)) / 2 : 1;
      w = Math.sqrt(f.aireBrute / rho);
      f.allonge = rho; f.largeur = w;
      if (rho > R.rapportMax) f.avert.push({ type: 'fine', x: f.centre.x, y: f.centre.y, texte: 'trop longue pour sa largeur (' + Math.round(rho) + ' fois)' });
      else if (w < R.largeurMin && rho > 3) f.avert.push({ type: 'fine', x: f.centre.x, y: f.centre.y, texte: 'trop fine (' + Math.round(w) + ' mm)' });
      if (f.trous.length) f.avert.push({ type: 'trou', x: f.trous[0][0].x, y: f.trous[0][0].y, texte: 'percée : un plomb doit rejoindre l\'îlot qu\'elle entoure' });
    });
    // Numérotation : par bandes horizontales, de haut en bas puis de gauche à droite.
    bande = Math.max(30, (doc.forme.h || 600) / 14);
    r.faces.sort(function (p, q) { return Math.floor(p.centre.y / bande) - Math.floor(q.centre.y / bande) || p.centre.x - q.centre.x || p.centre.y - q.centre.y; });
    r.faces.forEach(function (f, i) {
      f.numero = i + 1;
      f.avert.forEach(function (a) { a.face = f.numero; av.push(a); });
    });
    // Un plomb qui finit dans le verre : la pièce devrait être fendue, ce que le verre ne permet pas.
    r.pendants.forEach(function (e) {
      [e.a, e.b].forEach(function (n) {
        if (d[n] === 1 && !e.bord) av.push({ type: 'pendant', face: 0, x: doc.noeuds[n].x, y: doc.noeuds[n].y, texte: 'plomb qui ne rejoint rien' });
      });
    });
    return { faces: r.faces, pendants: r.pendants, avertissements: av, aire: aireTotale, degres: d };
  };

  G.aireContour = function (doc) { return Math.abs(aireSignee(G.contourPoly(doc))); };

  // Garde les morceaux du segment [a, b] qui tombent dans le polygone.
  G.clipSegment = function (poly, a, b) {
    var ts = [0, 1], i, p, q, x, out = [];
    for (i = 0; i < poly.length; i++) {
      p = poly[i]; q = poly[(i + 1) % poly.length];
      x = croise(a, b, p, q);
      if (x) ts.push(Math.max(0, Math.min(1, x.t)));
    }
    ts.sort(function (u, v) { return u - v; });
    for (i = 0; i + 1 < ts.length; i++) {
      if (ts[i + 1] - ts[i] < 1e-6) continue;
      if (dansPoly(poly, lerp(a, b, (ts[i] + ts[i + 1]) / 2))) out.push([lerp(a, b, ts[i]), lerp(a, b, ts[i + 1])]);
    }
    // Les morceaux contigus se recollent.
    return out.reduce(function (acc, s) {
      var d = acc[acc.length - 1];
      if (d && dist(d[1], s[0]) < 1e-6) d[1] = s[1]; else acc.push(s);
      return acc;
    }, []);
  };
})();
