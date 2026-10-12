(function () {
  'use strict';

  var OCTETS = 28;                 // par sommet : position (3 flottants), normale et matière (4 octets), uv (2 flottants), teinte et graine (4 octets)
  var BLOC = 64;                   // côté d'un bloc de géométrie, en mètres
  var RDC = 3, ETAGE = 2.6;        // hauteur du rez-de-chaussée et d'un étage
  var TRAVEE = 2.4;                // largeur visée d'une travée de façade
  var MAT = { SOL: 0, COLOMBAGE: 1, PIERRE: 2, TUILE: 3, ARDOISE: 4, BOIS: 5, FEUILLE: 6, EAU: 7, LANTERNE: 8, EGLISE: 9, CHAUME: 10, FENETRE: 11, NOIR: 12, TRONC: 13 };
  var COUCHE = { SOL: 0, BATI: 1, ARBRES: 2, MURS: 3 };   // MURS : rempart et monuments, qu'on voit de loin

  var geo = window.PlanVille.geo;

  // ---------- Hasard ----------
  // Un tirage propre à chaque objet, pour ne rien devoir au générateur du plan.
  function alea(graine) {
    var h = (graine | 0) * 2654435761 | 0;
    return function () {
      h = h + 0x6D2B79F5 | 0;
      var t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- Tampon ----------
  // Tous les sommets vont dans un seul tampon ; les triangles sont rangés par bloc de terrain et par couche,
  // pour ne dessiner que ce qui est dans le champ.
  function tampon() {
    var cap = 1 << 15, buf = new ArrayBuffer(cap * OCTETS), f = new Float32Array(buf), o8 = new Uint8Array(buf), s8 = new Int8Array(buf);
    var T = { n: 0, mat: 0, r: 255, g: 255, b: 255, graine: 0, blocs: {}, liste: [], cur: null, tris: 0 };

    function grandir() {
      var nb = new ArrayBuffer(cap * 2 * OCTETS), n8 = new Uint8Array(nb);
      n8.set(o8);
      cap *= 2; buf = nb; f = new Float32Array(buf); o8 = n8; s8 = new Int8Array(buf);
    }
    T.bloc = function (couche, x, y) {
      var cle = couche + ':' + Math.floor(x / BLOC) + ':' + Math.floor(y / BLOC), b = T.blocs[cle];
      if (!b) {
        b = T.blocs[cle] = { couche: couche, idx: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        T.liste.push(b);
      }
      T.cur = b;
    };
    T.teinte = function (c) { T.r = c[0]; T.g = c[1]; T.b = c[2]; };
    T.v = function (x, h, y, nx, nh, ny, u, v) {
      var i = T.n++, p, q, b = T.cur, l;
      if (i >= cap) grandir();
      p = i * 7; q = i * OCTETS;
      l = Math.sqrt(nx * nx + nh * nh + ny * ny) || 1;
      f[p] = x; f[p + 1] = h; f[p + 2] = y;
      s8[q + 12] = Math.round(nx / l * 127); s8[q + 13] = Math.round(nh / l * 127); s8[q + 14] = Math.round(ny / l * 127);
      o8[q + 15] = T.mat;
      f[p + 4] = u; f[p + 5] = v;
      o8[q + 24] = T.r; o8[q + 25] = T.g; o8[q + 26] = T.b; o8[q + 27] = T.graine;
      if (x < b.min[0]) b.min[0] = x; if (x > b.max[0]) b.max[0] = x;
      if (h < b.min[1]) b.min[1] = h; if (h > b.max[1]) b.max[1] = h;
      if (y < b.min[2]) b.min[2] = y; if (y > b.max[2]) b.max[2] = y;
      return i;
    };
    T.t = function (a, b, c) { T.cur.idx.push(a, b, c); T.tris++; };
    // Face plane convexe : pts = [x, h, y, …], uv = [u, v, …]. La normale suit le sens de parcours ; le rendu l'oriente vers l'œil.
    T.face = function (pts, uv) {
      var n = pts.length / 3, nx = 0, nh = 0, ny = 0, i, j, a, b, c, k, first, prev, cur, ex, eh, ey, fx, fh, fy, cx, ch, cy;
      for (i = 0; i < n; i++) {
        j = (i + 1) % n; a = i * 3; b = j * 3;
        nx += (pts[a + 1] - pts[b + 1]) * (pts[a + 2] + pts[b + 2]);
        nh += (pts[a + 2] - pts[b + 2]) * (pts[a] + pts[b]);
        ny += (pts[a] - pts[b]) * (pts[a + 1] + pts[b + 1]);
      }
      if (nx * nx + nh * nh + ny * ny < 1e-10) return;
      first = -1; prev = -1;
      for (k = 1; k < n - 1; k++) {
        a = 0; b = k * 3; c = (k + 1) * 3;
        ex = pts[b] - pts[a]; eh = pts[b + 1] - pts[a + 1]; ey = pts[b + 2] - pts[a + 2];
        fx = pts[c] - pts[a]; fh = pts[c + 1] - pts[a + 1]; fy = pts[c + 2] - pts[a + 2];
        cx = eh * fy - ey * fh; ch = ey * fx - ex * fy; cy = ex * fh - eh * fx;
        if (cx * cx + ch * ch + cy * cy < 1e-8) { prev = -1; continue; }
        if (first < 0) first = T.v(pts[0], pts[1], pts[2], nx, nh, ny, uv[0], uv[1]);
        if (prev < 0) prev = T.v(pts[b], pts[b + 1], pts[b + 2], nx, nh, ny, uv[k * 2], uv[k * 2 + 1]);
        cur = T.v(pts[c], pts[c + 1], pts[c + 2], nx, nh, ny, uv[k * 2 + 2], uv[k * 2 + 3]);
        T.t(first, prev, cur);
        prev = cur;
      }
    };
    // Range les indices bloc après bloc ; chaque bloc retient sa plage.
    T.fin = function () {
      var total = 0, idx, at = 0, blocs;
      T.liste = T.liste.filter(function (b) { return b.idx.length; });
      T.liste.sort(function (p, q) { return p.couche - q.couche || p.min[2] - q.min[2] || p.min[0] - q.min[0]; });
      T.liste.forEach(function (b) { total += b.idx.length; });
      idx = new Uint32Array(total);
      blocs = T.liste.map(function (b) {
        var out = { couche: b.couche, debut: at, nombre: b.idx.length, min: b.min, max: b.max };
        idx.set(b.idx, at); at += b.idx.length;
        return out;
      });
      return { sommets: buf.slice(0, T.n * OCTETS), nSommets: T.n, indices: idx, blocs: blocs, octets: OCTETS };
    };
    return T;
  }

  // ---------- Polygones ----------
  // Les polygones sont convexes, en mètres, d'aire signée positive : la normale sortante de l'arête a→b est (dy, -dx).
  function aireSignee(poly) {
    var s = 0, i, a, b;
    for (i = 0; i < poly.length; i++) { a = poly[i]; b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  }
  // Retire les sommets confondus ou alignés, et remet le polygone dans le bon sens.
  function net(poly) {
    var out = [], i, a, b, c, n;
    for (i = 0; i < poly.length; i++) {
      a = poly[i]; b = out[out.length - 1];
      if (!b || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 0.05) out.push(a);
    }
    if (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) + Math.abs(out[0].y - out[out.length - 1].y) <= 0.05) out.pop();
    for (i = 0; i < out.length && out.length > 3; i++) {
      n = out.length; a = out[(i + n - 1) % n]; b = out[i]; c = out[(i + 1) % n];
      if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 0.02 * (geo.dist(a, b) + geo.dist(b, c))) { out.splice(i, 1); i--; }
    }
    if (out.length < 3 || Math.abs(aireSignee(out)) < 1) return null;
    if (aireSignee(out) < 0) {
      // Retourné, chaque sommet doit garder l'étiquette de l'arête qui en part.
      out = out.map(function (p, k) { return { x: p.x, y: p.y, n: out[(k + out.length - 1) % out.length].n }; }).reverse();
    }
    return out;
  }
  function aretes(poly) {
    return poly.map(function (a, i) {
      var b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      return { a: a, b: b, l: l, ux: dx / l, uy: dy / l, nx: dy / l, ny: -dx / l };
    });
  }
  // Pousse chaque arête de d vers l'extérieur ; les sommets glissent le long de la bissectrice.
  function decale(poly, d) {
    var E = aretes(poly), n = poly.length;
    return poly.map(function (b, i) {
      var p = E[(i + n - 1) % n], q = E[i], k = Math.max(0.05, 1 + p.nx * q.nx + p.ny * q.ny);
      return { x: b.x + (p.nx + q.nx) * d / k, y: b.y + (p.ny + q.ny) * d / k, n: b.n };
    });
  }
  // Le même décalage, exact jusque dans les coins en pointe : l'intersection des demi-plans repoussés. Le nombre de sommets peut changer.
  function gonfle(poly, d) {
    var out = null;
    aretes(poly).forEach(function (e) {
      var px = e.a.x + e.nx * d, py = e.a.y + e.ny * d, G = 1e5;
      if (!out) out = [{ x: px - e.ux * G, y: py - e.uy * G }, { x: px + e.ux * G, y: py + e.uy * G }, { x: px + e.ux * G - e.nx * G, y: py + e.uy * G - e.ny * G }, { x: px - e.ux * G - e.nx * G, y: py - e.uy * G - e.ny * G }];
      else out = geo.cut(out, px, py, e.nx, e.ny);
    });
    return out;
  }
  // Le plus petit angle intérieur, par son cosinus de déviation : proche de 0, le coin est en pointe.
  function pointe(poly) {
    var E = aretes(poly), n = poly.length, k = 2, i;
    for (i = 0; i < n; i++) k = Math.min(k, 1 + E[(i + n - 1) % n].nx * E[i].nx + E[(i + n - 1) % n].ny * E[i].ny);
    return k;
  }

  // ---------- Volumes simples ----------
  // Prisme droit sur un polygone, en pierre : u court le long du périmètre, v monte, en mètres.
  function prisme(T, poly, z0, z1, dessus) {
    var E = aretes(poly), u = 0, pts = [], uv = [];
    E.forEach(function (e) {
      T.face([e.a.x, z0, e.a.y, e.b.x, z0, e.b.y, e.b.x, z1, e.b.y, e.a.x, z1, e.a.y], [u, z0, u + e.l, z0, u + e.l, z1, u, z1]);
      u += e.l;
    });
    if (dessus !== false) {
      poly.forEach(function (p) { pts.push(p.x, z1, p.y); uv.push(p.x, p.y); });
      T.face(pts, uv);
    }
  }
  function rect(cx, cy, ux, uy, hl, hw) {
    var vx = -uy, vy = ux;
    return [
      { x: cx - ux * hl - vx * hw, y: cy - uy * hl - vy * hw }, { x: cx + ux * hl - vx * hw, y: cy + uy * hl - vy * hw },
      { x: cx + ux * hl + vx * hw, y: cy + uy * hl + vy * hw }, { x: cx - ux * hl + vx * hw, y: cy - uy * hl + vy * hw }
    ];
  }
  function boite(T, cx, cy, ux, uy, hl, hw, z0, z1) { prisme(T, rect(cx, cy, ux, uy, hl, hw), z0, z1); }
  function disque(cx, cy, r, n, a0) {
    var out = [], i, a;
    for (i = 0; i < n; i++) { a = (a0 || 0) + i * Math.PI * 2 / n; out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
    return out;
  }
  // Toit conique ou en flèche sur un polygone régulier.
  function cone(T, base, cx, cy, z0, z1) {
    aretes(base).forEach(function (e, i) {
      var s = Math.sqrt((e.a.x - cx) * (e.a.x - cx) + (e.a.y - cy) * (e.a.y - cy) + (z1 - z0) * (z1 - z0));
      T.face([e.a.x, z0, e.a.y, e.b.x, z0, e.b.y, cx, z1, cy], [i * 3, 0, i * 3 + e.l, 0, i * 3 + e.l / 2, s]);
    });
  }
  // Parapet crénelé le long de a→b, posé à la hauteur z du côté intérieur de la ligne (la normale sortante est donnée).
  function parapet(T, ax, ay, bx, by, nx, ny, z, h, e) {
    var dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy), ux, uy, n, i, pas, s, mx = -nx * e / 2, my = -ny * e / 2;
    if (L < 0.3) return;
    ux = dx / L; uy = dy / L;
    boite(T, (ax + bx) / 2 + mx, (ay + by) / 2 + my, ux, uy, L / 2, e / 2, z, z + h);
    n = Math.max(1, Math.round(L / 2));
    pas = L / n;
    for (i = 0; i < n; i++) {
      s = (i + 0.5) * pas;
      boite(T, ax + ux * s + mx, ay + uy * s + my, ux, uy, Math.min(0.6, pas * 0.3), e / 2, z + h, z + h + 0.8);
    }
  }

  // ---------- Toits ----------
  // Toit à croupes sur un polygone convexe : la hauteur en un point est la pente fois la distance au bord le plus proche.
  // Le pan d'une arête est donc la part du polygone plus proche d'elle que de toute autre, qu'on obtient par coupes successives.
  function croupes(poly) {
    var E = aretes(poly), pans = [], dmax = 0;
    E.forEach(function (e, i) {
      var pan = poly, j, o, nx, ny, c, l2;
      for (j = 0; j < E.length && pan.length >= 3; j++) {
        if (j === i) continue;
        o = E[j]; nx = o.nx - e.nx; ny = o.ny - e.ny; l2 = nx * nx + ny * ny;
        if (l2 < 1e-9) continue;
        c = (o.a.x * o.nx + o.a.y * o.ny) - (e.a.x * e.nx + e.a.y * e.ny);
        pan = geo.cut(pan, nx * c / l2, ny * c / l2, nx, ny);
      }
      if (pan.length < 3 || geo.area(pan) < 1e-3) return;
      pan = pan.map(function (p) {
        var d = Math.max(0, (e.a.x - p.x) * e.nx + (e.a.y - p.y) * e.ny);
        if (d > dmax) dmax = d;
        return { x: p.x, y: p.y, d: d };
      });
      pans.push({ e: e, pts: pan });
    });
    return { pans: pans, dmax: dmax, E: E };
  }

  function axeLong(poly) {
    var E = aretes(poly), best = E[0];
    E.forEach(function (e) { if (e.l > best.l) best = e; });
    return best;
  }

  // Une maison : murs sur le polygone de la parcelle, étage en encorbellement, toit à deux pans ou à croupes.
  // o : base, fond, etages, enc, toit ('pignon' ou 'croupes'), pente, debord, hToit (hauteur maximale du toit), axe { ux, uy },
  //     mur (matière), teinte, graine, bois (teinte des poutres), couv (matière du toit), teinteToit, rues (arête par arête : donne-t-elle sur la rue ?),
  //     cheminee, lucarne, rdc, etage, alea.
  // Renvoie { haut, faite, toit(p) } pour poser dessus et pour les essais.
  function maison(T, poly, o) {
    var rdc = o.rdc || RDC, et = o.etage || ETAGE, base = o.base, z1 = base + rdc, zt = z1 + (o.etages - 1) * et;
    var Q = o.enc ? decale(poly, o.enc) : poly, R = gonfle(Q, o.debord), EP = aretes(poly), EQ = aretes(Q);
    var pignon = o.toit === 'pignon', pente = o.pente, ax, vx, vy, t0, W, tmin = Infinity, tmax = -Infinity, smin = Infinity, smax = -Infinity, C, zE, faite, k = Math.sqrt(1 + pente * pente);

    if (pignon) {
      ax = o.axe || axeLong(Q); vx = -ax.uy; vy = ax.ux;
      Q.forEach(function (p) {
        var t = p.x * vx + p.y * vy, s = p.x * ax.ux + p.y * ax.uy;
        tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); smin = Math.min(smin, s); smax = Math.max(smax, s);
      });
      t0 = (tmin + tmax) / 2; W = (tmax - tmin) / 2;
      if (W * pente > o.hToit) { pente = o.hToit / W; k = Math.sqrt(1 + pente * pente); }
      faite = zt + W * pente;
    } else {
      C = croupes(R);
      if (C.dmax * pente > o.hToit) { pente = o.hToit / C.dmax; k = Math.sqrt(1 + pente * pente); }
      zE = zt - pente * o.debord;
      faite = zE + C.dmax * pente;
    }
    function tt(p) { return p.x * vx + p.y * vy - t0; }
    function toit(p) {
      var d = Infinity;
      if (pignon) return zt + pente * (W - Math.abs(tt(p)));
      C.E.forEach(function (e) { d = Math.min(d, (e.a.x - p.x) * e.nx + (e.a.y - p.y) * e.ny); });
      return zE + pente * d;
    }
    function vv(z) { return z <= z1 ? (z - base) / rdc : 1 + (z - z1) / et; }

    // Murs : une façade se lit en travées (u) et en niveaux (v), pour que le rendu y aligne poutres, portes et fenêtres.
    T.mat = o.mur; T.teinte(o.teinte); T.graine = o.graine;
    function facade(E, i, zb, haut) {
      var e = E[i], trav = Math.max(1, Math.round(e.l / TRAVEE)), u0 = i * 16 + (o.rues && !o.rues[i] ? 128 : 0), pts = [e.a, e.b], ta, tb, m, j, a, b, za, zb2;
      if (haut && pignon) {
        ta = tt(e.a); tb = tt(e.b);
        if (ta * tb < -1e-6) {
          m = ta / (ta - tb);
          pts = [e.a, { x: e.a.x + (e.b.x - e.a.x) * m, y: e.a.y + (e.b.y - e.a.y) * m, s: m }, e.b];
        }
      }
      for (j = 0; j + 1 < pts.length; j++) {
        a = pts[j]; b = pts[j + 1];
        za = haut ? (pignon ? toit(a) : zt) : z1; zb2 = haut ? (pignon ? toit(b) : zt) : z1;
        var ua = u0 + trav * (j === 0 ? 0 : pts[1].s), ub = u0 + trav * (j + 2 === pts.length ? 1 : pts[1].s);
        T.face([a.x, zb, a.y, b.x, zb, b.y, b.x, zb2, b.y, a.x, za, a.y], [ua, vv(zb), ub, vv(zb), ub, vv(zb2), ua, vv(za)]);
      }
    }
    EP.forEach(function (e, i) { facade(EP, i, base - o.fond, false); });
    if (o.etages > 1 || pignon) EQ.forEach(function (e, i) { facade(EQ, i, z1, true); });
    if (o.enc) {
      T.mat = MAT.BOIS; T.teinte(o.bois);
      EP.forEach(function (e, i) {
        var q = EQ[i];
        T.face([e.a.x, z1, e.a.y, q.a.x, z1, q.a.y, q.b.x, z1, q.b.y, e.b.x, z1, e.b.y], [0, 0, 0, 0.4, e.l, 0.4, e.l, 0]);
      });
    }

    // Toit.
    T.mat = o.couv; T.teinte(o.teinteToit);
    if (pignon) {
      [-1, 1].forEach(function (cote) {
        var pan = geo.cut(R, vx * t0, vy * t0, vx * cote, vy * cote), pts = [], uv = [];
        if (pan.length < 3) return;
        pan.forEach(function (p) {
          pts.push(p.x, toit(p), p.y);
          uv.push(p.x * ax.ux + p.y * ax.uy, (W + o.debord - Math.abs(tt(p))) * k);
        });
        T.face(pts, uv);
      });
    } else {
      C.pans.forEach(function (pan) {
        var pts = [], uv = [], e = pan.e;
        pan.pts.forEach(function (p) {
          pts.push(p.x, zE + pente * p.d, p.y);
          uv.push((p.x - e.a.x) * e.ux + (p.y - e.a.y) * e.uy, p.d * k);
        });
        T.face(pts, uv);
      });
    }

    var rnd = o.alea, c = geo.centroid(Q), s, t, p, zc, cote, w, zf, zd, tr, te, sc, P;
    // Cheminée : une souche de pierre qui dépasse le faîte.
    if (o.cheminee) {
      if (pignon) {
        s = (smin + smax) / 2 + (rnd() - 0.5) * (smax - smin) * 0.5; t = t0 + (rnd() < 0.5 ? -0.7 : 0.7);
        p = { x: ax.ux * s + vx * t, y: ax.uy * s + vy * t };
      } else p = { x: c.x + (rnd() - 0.5), y: c.y + (rnd() - 0.5) };
      zc = toit(p);
      T.mat = MAT.PIERRE; T.teinte([150, 132, 118]);
      boite(T, p.x, p.y, pignon ? ax.ux : 1, pignon ? ax.uy : 0, 0.42, 0.34, zc - 0.7, Math.max(zc, faite) + 0.9);
    }
    // Lucarne : une petite fenêtre sous son propre toit, à mi-pente.
    if (o.lucarne && pignon && W > 2.6 && smax - smin > 5) {
      cote = rnd() < 0.5 ? -1 : 1; w = 0.62;
      sc = (smin + smax) / 2 + (rnd() - 0.5) * (smax - smin) * 0.4;
      t = 0.74 * W; zf = zt + pente * (W - t); zd = zf + 1.15;
      te = W - (zd - zt) / pente; tr = W - (zd + 0.45 - zt) / pente;
      if (tr > 0.1) {
        P = function (ds, tq, z) { return [ax.ux * (sc + ds) + vx * (t0 + cote * tq), z, ax.uy * (sc + ds) + vy * (t0 + cote * tq)]; };
        T.mat = MAT.FENETRE; T.teinte(o.teinte);
        T.face([].concat(P(-w, t, zf), P(w, t, zf), P(w, t, zd), P(-w, t, zd)), [0, 0, 1, 0, 1, 1, 0, 1]);
        T.mat = o.mur;
        T.face([].concat(P(-w, t, zd), P(w, t, zd), P(0, t, zd + 0.45)), [200, 5, 200.2, 5, 200.1, 5.1]);
        T.face([].concat(P(-w, t, zf), P(-w, t, zd), P(-w, te, zd)), [200, 5, 200, 5.2, 200.2, 5.2]);
        T.face([].concat(P(w, t, zf), P(w, t, zd), P(w, te, zd)), [200, 5, 200, 5.2, 200.2, 5.2]);
        T.mat = o.couv; T.teinte(o.teinteToit);
        T.face([].concat(P(-w - 0.12, t + 0.15, zd - 0.08), P(0, t + 0.15, zd + 0.45), P(0, tr, zd + 0.45), P(-w - 0.12, te, zd - 0.08)), [0, 0, 0, 0.9, t - tr, 0.9, t - te, 0]);
        T.face([].concat(P(w + 0.12, t + 0.15, zd - 0.08), P(0, t + 0.15, zd + 0.45), P(0, tr, zd + 0.45), P(w + 0.12, te, zd - 0.08)), [0, 0, 0, 0.9, t - tr, 0.9, t - te, 0]);
      }
    }
    return { haut: zt, faite: faite, toit: toit, Q: Q, R: R, pignon: pignon };
  }

  // ---------- Petits objets ----------
  // Lanterne en potence sur une façade : (x, y) au pied du mur, (nx, ny) vers la rue.
  function lanterne(T, x, y, nx, ny, z) {
    T.mat = MAT.BOIS; T.teinte([46, 38, 32]); T.graine = 0;
    boite(T, x + nx * 0.45, y + ny * 0.45, nx, ny, 0.45, 0.04, z + 0.42, z + 0.5);
    T.mat = MAT.LANTERNE; T.teinte([255, 190, 110]);
    boite(T, x + nx * 0.8, y + ny * 0.8, nx, ny, 0.13, 0.13, z, z + 0.4);
  }

  // Arbre : un tronc et une couronne à facettes ; les normales rayonnent du cœur pour un ombrage doux.
  function arbre(T, x, y, z, r, conifere, rnd, teinte) {
    var ht = conifere ? r * 0.5 + 0.6 : r * 0.9 + 1.2, rt = 0.12 + r * 0.06, i, a, base = [], haut = [], A = [], Bq = [], top, bas, hc, n = 6, j, k, f, g;
    T.mat = MAT.TRONC; T.teinte([92, 72, 54]); T.graine = 0;
    for (i = 0; i < 4; i++) {
      a = i * Math.PI / 2;
      base.push(T.v(x + Math.cos(a) * rt, z - 0.4, y + Math.sin(a) * rt, Math.cos(a), 0, Math.sin(a), i, 0));
      haut.push(T.v(x + Math.cos(a) * rt * 0.7, z + ht + r * 0.4, y + Math.sin(a) * rt * 0.7, Math.cos(a), 0, Math.sin(a), i, 3));
    }
    for (i = 0; i < 4; i++) { j = (i + 1) % 4; T.t(base[i], base[j], haut[j]); T.t(base[i], haut[j], haut[i]); }

    T.mat = MAT.FEUILLE;
    f = 0.8 + rnd() * 0.4;
    function feuille(px, ph, py, cx, ch, cy, ombre) {
      g = ombre * f;
      T.r = Math.min(255, teinte[0] * g); T.g = Math.min(255, teinte[1] * g); T.b = Math.min(255, teinte[2] * g);
      return T.v(px, ph, py, px - cx, ph - ch, py - cy, px * 0.5, ph * 0.5 + py * 0.5);
    }
    if (conifere) {
      // Deux étages de branches en cône.
      for (k = 0; k < 2; k++) {
        var zb = z + ht + k * r * 1.1, rr = r * (0.95 - k * 0.3), zs = zb + r * (1.7 - k * 0.2), ring = [];
        a = rnd() * 6.28;
        for (i = 0; i < n; i++) ring.push(feuille(x + Math.cos(a + i * 6.283 / n) * rr, zb, y + Math.sin(a + i * 6.283 / n) * rr, x, zb - rr * 0.6, y, 0.62));
        top = feuille(x, zs, y, x, zb, y, 1.05);
        for (i = 0; i < n; i++) T.t(ring[i], ring[(i + 1) % n], top);
      }
      return;
    }
    hc = z + ht + r * 0.75; a = rnd() * 6.28;
    for (i = 0; i < n; i++) {
      j = a + i * 6.283 / n; k = 0.85 + rnd() * 0.3;
      A.push(feuille(x + Math.cos(j) * r * k, hc + r * (0.1 + rnd() * 0.2), y + Math.sin(j) * r * k, x, hc, y, 0.95));
      j += 3.1416 / n;
      Bq.push(feuille(x + Math.cos(j) * r * 0.72, hc - r * 0.55, y + Math.sin(j) * r * 0.72, x, hc, y, 0.6));
    }
    top = feuille(x + (rnd() - 0.5) * r * 0.3, hc + r * (0.85 + rnd() * 0.2), y + (rnd() - 0.5) * r * 0.3, x, hc, y, 1.12);
    bas = feuille(x, hc - r * 0.8, y, x, hc, y, 0.5);
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      T.t(A[i], A[j], top);
      T.t(A[i], Bq[i], A[j]);
      T.t(Bq[i], Bq[j], A[j]);
      T.t(Bq[i], bas, Bq[j]);
    }
  }

  window.VisiteBatir = {
    OCTETS: OCTETS, BLOC: BLOC, RDC: RDC, ETAGE: ETAGE, MAT: MAT, COUCHE: COUCHE,
    alea: alea, tampon: tampon, net: net, aretes: aretes, decale: decale, gonfle: gonfle, pointe: pointe, aireSignee: aireSignee,
    prisme: prisme, rect: rect, boite: boite, disque: disque, cone: cone, parapet: parapet,
    croupes: croupes, axeLong: axeLong, maison: maison, lanterne: lanterne, arbre: arbre
  };
})();
