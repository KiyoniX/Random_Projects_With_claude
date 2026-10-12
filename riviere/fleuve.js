(function () {
  'use strict';

  var PX = 1000;                 // côté du plan, en pixels
  var NX = 320, NY = 320, N = NX * NY, CELL = PX / NX;   // grille de la simulation
  var DS = 1.5;                  // pas du tracé, en pixels
  var WIDTH = 64;                // largeur moyenne du lit, en pixels
  var STATION = 8;               // points du tracé par station de mesure
  var QUAY = 8;                  // largeur de la grève qui borde le lit, en pixels
  var TRIES = 400;               // tracés essayés avant de garder le moins mauvais
  var NEED = { bourg: 2, ville: 2, cite: 3 };   // traversées exigées au moins

  var INK = '#3d2f21', ROOF = '#b99d75', WATER = '#b9d0d2', DEEP = '#7fa3ab';
  // Plans-de-ville n'expose pas sa palette : les teintes utiles sont recopiées ici, par milieu.
  var MILIEUX = {
    '': { ground: '#f1e5c6', wood: '#8fa56e', grass: '#c3d199' },
    foret: { ground: '#f0e6c4', wood: '#7f9c62', grass: '#b9cc8f' },
    aride: { ground: '#f5e7c1', wood: '#a3a36a', grass: '#cfcf96' },
    froid: { ground: '#f3f1e5', wood: '#6f8a6a', grass: '#c5d0b8' }
  };
  var WOODS = ['#8fa56e', '#7f9c62', '#a3a36a', '#6f8a6a'];
  var RIVERS = ['la Vive', 'l\'Aigue', 'la Brune', 'la Sorgue', 'le Clain', 'la Douce', 'l\'Orge', 'la Lise', 'le Ru-Franc', 'la Morte-Eau', 'la Vanne', 'l\'Yeuse'];
  var BRIDGES = ['Grand-Pont', 'Pont-Neuf', 'Pont aux Meuniers', 'Petit-Pont', 'Pont Notre-Dame', 'Pont des Tanneurs', 'Pont au Change', 'Pont Saint-Jean'];

  // ---------- Hasard ----------
  function seeded(str) {
    var h = 1779033703 ^ str.length, i;
    for (i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    return function () {
      h = h + 0x6D2B79F5 | 0;
      var t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- Géométrie ----------
  function smooth(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

  function inPoly(poly, x, y) {
    var inside = false, i, j, a, b;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a = poly[i]; b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function segDist(x, y, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l ? ((x - a.x) * dx + (y - a.y) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    dx = a.x + dx * t - x; dy = a.y + dy * t - y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  // Distance au polygone, nulle à l'intérieur.
  function polyDist(poly, x, y) {
    var d = Infinity, i;
    if (inPoly(poly, x, y)) return 0;
    for (i = 0; i < poly.length; i++) d = Math.min(d, segDist(x, y, poly[i], poly[(i + 1) % poly.length]));
    return d;
  }
  // Position du croisement sur le segment ab (0 à 1), ou -1.
  function cross(a, b, c, d) {
    var rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx, t, u;
    if (Math.abs(den) < 1e-9) return -1;
    t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    return t >= 0 && t < 1 && u >= 0 && u <= 1 ? t : -1;
  }

  // ---------- Tracé ----------
  // Un cours : une ligne d'un bord du plan au bord opposé, faite d'une dérive douce et de deux méandres,
  // rééchantillonnée tous les DS pixels. hw est la demi-largeur du lit en chaque point.
  // Deux fois sur trois, le cours vise l'intervalle entre une porte et la place : il coupe alors l'avenue de cette porte.
  function course(rnd, t) {
    var horiz = rnd() < 0.5, rev = rnd() < 0.5;
    var a = 500 + (rnd() * 2 - 1) * 250, b = a + (rnd() * 2 - 1) * 170;
    var g = t.gates.length && rnd() < 0.67 ? t.gates[Math.floor(rnd() * t.gates.length)] : null, gf = 0.3 + rnd() * 0.5, gu = 0, gv = 0, shift = 0;
    if (g) {
      horiz = Math.abs(g.y - t.centre.y) > Math.abs(g.x - t.centre.x);
      gu = horiz ? g.x : g.y;
      gv = horiz ? t.centre.y + (g.y - t.centre.y) * gf : t.centre.x + (g.x - t.centre.x) * gf;
      a = 0; b = (rnd() * 2 - 1) * 170;
    }
    var L1 = 430 + rnd() * 260, A1 = Math.min(28 + rnd() * 40, L1 * L1 / 4300), p1 = rnd() * 6.283;
    var A2 = 5 + rnd() * 8, L2 = 230 + rnd() * 110, p2 = rnd() * 6.283;
    var w1 = 150 + rnd() * 120, q1 = rnd() * 6.283, w2 = 60 + rnd() * 50, q2 = rnd() * 6.283;
    var isle = rnd() < 0.7, ic = 0.24 + rnd() * 0.52, il = 100 + rnd() * 60, ih = 9 + rnd() * 4, io = (rnd() * 2 - 1) * 6;
    var raw = [], u, v, e, i, n, len = 0, d, s, t, k, p, q, c = { horiz: horiz, rev: rev };

    function lateral(w) {
      var f = smooth(Math.min(w, PX - w) / 120);
      return a + (b - a) * smooth(w / PX) + f * (A1 * Math.sin(w / L1 * 6.283 + p1) + A2 * Math.sin(w / L2 * 6.283 + p2));
    }
    if (g) shift = gv - lateral(gu);
    for (u = -14; u <= PX + 14; u += 2) {
      v = lateral(u) + shift;
      raw.push(horiz ? { x: u, y: v } : { x: v, y: u });
    }
    if (rev) raw.reverse();
    for (i = 1; i < raw.length; i++) len += Math.sqrt((raw[i].x - raw[i - 1].x) * (raw[i].x - raw[i - 1].x) + (raw[i].y - raw[i - 1].y) * (raw[i].y - raw[i - 1].y));
    n = Math.floor(len / DS);
    c.n = n; c.len = len;
    c.x = new Float32Array(n); c.y = new Float32Array(n); c.tx = new Float32Array(n); c.ty = new Float32Array(n);
    c.hw = new Float32Array(n); c.ih = new Float32Array(n); c.io = io;
    for (i = 0, k = 1, s = 0; i < n; i++) {
      t = i * DS;
      for (;;) {
        p = raw[k - 1]; q = raw[k];
        d = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y));
        if (s + d >= t || k === raw.length - 1) break;
        s += d; k++;
      }
      e = d ? (t - s) / d : 0;
      c.x[i] = p.x + (q.x - p.x) * e; c.y[i] = p.y + (q.y - p.y) * e;
    }
    for (i = 0; i < n; i++) {
      p = i < 3 ? 0 : i - 3; q = i > n - 4 ? n - 1 : i + 3;
      u = c.x[q] - c.x[p]; v = c.y[q] - c.y[p]; d = Math.sqrt(u * u + v * v);
      c.tx[i] = u / d; c.ty[i] = v / d;
    }
    // Largeur : deux ondulations, calmées près des bords du plan pour des bouches bien droites.
    for (i = 0; i < n; i++) {
      s = i * DS;
      e = smooth(Math.min(s, len - s) / 110);
      v = 1 + e * (0.17 * Math.sin(s / w1 + q1) + 0.07 * Math.sin(s / w2 + q2));
      c.hw[i] = WIDTH / 2 * (v < 0.84 ? 0.84 : v > 1.3 ? 1.3 : v);
    }
    // Île : le lit s'élargit autour d'un banc en amande, décalé de io vers une rive.
    c.isle = isle;
    if (isle) {
      p = Math.round((ic * len - il / 2) / DS); q = Math.round((ic * len + il / 2) / DS);
      c.i0 = p; c.i1 = q;
      for (i = p + 1; i < q; i++) {
        v = Math.pow(Math.sin(Math.PI * (i - p) / (q - p)), 0.8) * ih;
        c.ih[i] = v;
        c.hw[i] += v * 0.9;
      }
    }
    return c;
  }

  // Note un cours : 0 s'il respecte tout, sinon d'autant plus que les défauts sont graves.
  function judge(c, t) {
    var pen = 0, i, j, x, y, hw, a, b, d, n = c.n, inside = 0, walls = 0, av = 0, hi = 0;
    var pts = [];
    for (i = 0; i < n; i += 4) pts.push({ x: c.x[i], y: c.y[i], i: i });

    for (i = 4; i < n - 4; i += 2) {
      x = c.x[i]; y = c.y[i]; hw = c.hw[i];
      d = c.horiz ? y : x;
      if (d < 105 || d > PX - 105) pen += 20;
      // Rayon de courbure : les rives ne doivent pas se recouper.
      a = c.tx[i + 4] - c.tx[i - 4]; b = c.ty[i + 4] - c.ty[i - 4];
      if (Math.sqrt(a * a + b * b) / (8 * DS) * hw > 0.75) pen += 10;
    }
    for (j = 0; j < pts.length; j++) {
      x = pts[j].x; y = pts[j].y; hw = c.hw[pts[j].i];
      if (inPoly(t.wall, x, y)) inside++;
      if (polyDist(t.plaza, x, y) < hw + 3) pen += 40;
      if (t.castle && polyDist(t.castle, x, y) < hw + 9) pen += 40;
      if (t.church) { a = t.church.x - x; b = t.church.y - y; if (Math.sqrt(a * a + b * b) < hw + t.church.r) pen += 40; }
      for (i = 0; i < t.gates.length; i++) {
        a = t.gates[i].x - x; b = t.gates[i].y - y;
        if (Math.sqrt(a * a + b * b) < hw + 18) pen += 30;
      }
    }
    if (inside * 4 * DS < 270) pen += 500;
    for (j = 1; j < pts.length; j++) {
      a = pts[j - 1]; b = pts[j];
      for (i = 0; i < t.wall.length; i++) if (cross(a, b, t.wall[i], t.wall[(i + 1) % t.wall.length]) >= 0) walls++;
      t.avenues.forEach(function (line) { for (var q = 1; q < line.length; q++) if (cross(a, b, line[q - 1], line[q]) >= 0) av++; });
      t.highways.forEach(function (line) { for (var q = 1; q < line.length; q++) if (cross(a, b, line[q - 1], line[q]) >= 0) hi++; });
    }
    if (walls !== 2) pen += walls === 4 ? 150 : 600;
    if (!av) pen += 400;
    pen += hi * 60;
    c.walls = walls; c.avenues = av; c.highways = hi;
    return pen;
  }

  // ---------- Fleuve ----------
  function trace(seed, sizeKey, plan, milieu) {
    var m = plan.model, k = m.k, geo = window.PlanVille.geo, pal = MILIEUX[milieu] || MILIEUX[''];
    var rnd = seeded(seed + '/' + sizeKey + '/fleuve');
    function P(v) { return { x: v.x * k + PX / 2, y: v.y * k + PX / 2 }; }
    function polyOf(type) {
      var c = m.cells.filter(function (q) { return q.inner && q.type === type; })[0];
      return c ? c.poly.map(P) : null;
    }
    var town = {
      centre: P(m.centre.c), wall: m.wall.map(P), gates: m.gates.map(P), plaza: m.centre.poly.map(P), castle: polyOf('castle'), church: null,
      avenues: m.avenues.map(function (a) { return a.map(P); }), highways: m.highways.map(function (a) { return a.map(P); })
    };
    var inner = m.cells.filter(function (c) { return c.inner; });
    // L'église occupe le milieu de son quartier ; le fleuve peut longer ses maisons, pas la traverser.
    inner.forEach(function (cl) {
      if (cl.type !== 'church') return;
      var mid = geo.centroid(cl.poly);
      town.church = { x: mid.x * k + PX / 2, y: mid.y * k + PX / 2, r: Math.sqrt(geo.area(cl.poly)) * 0.36 * k };
    });

    var c = null, best = Infinity, tries = 0, cand, pen;
    while (tries < TRIES && best > 0) {
      cand = course(rnd, town); pen = judge(cand, town); tries++;
      if (pen < best) { best = pen; c = cand; }
    }
    var n = c.n, i, j, x, y;
    // Une île ne se loge pas sous le rempart.
    if (c.isle && inPoly(town.wall, c.x[c.i0], c.y[c.i0]) !== inPoly(town.wall, c.x[c.i1], c.y[c.i1])) {
      for (i = c.i0; i <= c.i1; i++) { c.hw[i] -= c.ih[i] * 0.9; c.ih[i] = 0; }
      c.isle = false;
    }

    // Distance signée à la rive (négative dans le lit), par recherche du point du tracé le plus proche.
    function nearest(px, py) {
      var bi = 0, bd = Infinity, d, q, lo, hi;
      for (q = 0; q < n; q += 8) {
        d = (c.x[q] - px) * (c.x[q] - px) + (c.y[q] - py) * (c.y[q] - py);
        if (d < bd) { bd = d; bi = q; }
      }
      lo = Math.max(0, bi - 8); hi = Math.min(n - 1, bi + 8);
      for (q = lo; q <= hi; q++) {
        d = (c.x[q] - px) * (c.x[q] - px) + (c.y[q] - py) * (c.y[q] - py);
        if (d < bd) { bd = d; bi = q; }
      }
      return bi;
    }
    function depth(px, py) {
      var q = nearest(px, py);
      return Math.sqrt((c.x[q] - px) * (c.x[q] - px) + (c.y[q] - py) * (c.y[q] - py)) - c.hw[q];
    }

    // Grille : band couvre le lit et l'île, bed le lit seul. samp est le point du tracé le plus proche.
    var band = new Uint8Array(N), bed = new Uint8Array(N), samp = new Int16Array(N), near = new Float32Array(N);
    var r, x0, x1, y0, y1, gx, gy, d, cell, lat;
    for (i = 0; i < N; i++) { near[i] = 1e9; samp[i] = -1; }
    for (i = 0; i < n; i++) {
      r = c.hw[i] / CELL; gx = c.x[i] / CELL; gy = c.y[i] / CELL;
      x0 = Math.max(0, Math.floor(gx - r)); x1 = Math.min(NX - 1, Math.ceil(gx + r));
      y0 = Math.max(0, Math.floor(gy - r)); y1 = Math.min(NY - 1, Math.ceil(gy + r));
      for (y = y0; y <= y1; y++) {
        for (x = x0; x <= x1; x++) {
          d = (x + 0.5 - gx) * (x + 0.5 - gx) + (y + 0.5 - gy) * (y + 0.5 - gy);
          if (d > r * r) continue;
          cell = y * NX + x;
          band[cell] = 1;
          if (d < near[cell]) { near[cell] = d; samp[cell] = i; }
        }
      }
    }
    for (cell = 0; cell < N; cell++) {
      if (!band[cell]) continue;
      i = samp[cell];
      bed[cell] = 1;
      if (c.ih[i] > 0) {
        lat = ((cell % NX + 0.5) * CELL - c.x[i]) * -c.ty[i] + (((cell / NX) | 0) + 0.5) * CELL * c.tx[i] - c.y[i] * c.tx[i];
        if (Math.abs(lat - c.io) < c.ih[i] - 1.2) bed[cell] = 0;
      }
    }

    // Stations de mesure et quartiers riverains (rive gauche, rive droite).
    var nSt = Math.ceil(n / STATION), stWard = new Int16Array(nSt * 2), st = new Int16Array(N), zone = new Uint8Array(N);
    function wardAt(px, py) {
      var p = { x: (px - PX / 2) / k, y: (py - PX / 2) / k }, q;
      for (q = 0; q < inner.length; q++) if (geo.inside(inner[q].poly, p)) return inner[q].i;
      return -1;
    }
    var z0 = -1, z1 = -1;
    for (j = 0; j < nSt; j++) {
      i = Math.min(n - 1, j * STATION + (STATION >> 1));
      d = c.hw[i] + QUAY + 2;
      stWard[j * 2] = wardAt(c.x[i] - c.ty[i] * d, c.y[i] + c.tx[i] * d);
      stWard[j * 2 + 1] = wardAt(c.x[i] + c.ty[i] * d, c.y[i] - c.tx[i] * d);
      if (stWard[j * 2] >= 0 || stWard[j * 2 + 1] >= 0) { if (z0 < 0) z0 = j; z1 = j; }
    }
    // On bâtit le long des quartiers ; deux stations de berge restent toujours en amont des ouvrages.
    var b0 = z0 + 2, b1 = z1;
    for (cell = 0; cell < N; cell++) {
      st[cell] = bed[cell] ? (samp[cell] / STATION) | 0 : -1;
      zone[cell] = bed[cell] && st[cell] >= b0 && st[cell] <= b1 ? 1 : 0;
    }
    var wards = [], byCell = {};
    for (j = z0; j >= 0 && j <= z1; j++) {
      [0, 1].forEach(function (side) {
        var w = stWard[j * 2 + side], cl, e;
        if (w < 0) return;
        e = byCell[w];
        if (!e) {
          cl = m.cells[w];
          e = byCell[w] = { i: w, name: cl.type === 'plaza' ? 'Place du Marché' : cl.type === 'castle' ? 'Château' : cl.type === 'park' ? 'Jardins' : cl.name || 'Quartier', poly: cl.poly.map(P), stations: [], banks: [] };
          wards.push(e);
        }
        if (e.stations[e.stations.length - 1] !== j) e.stations.push(j);
        e.banks.push(j * 2 + side);
      });
    }

    // Traversées : là où une avenue, une route ou une rue coupe le tracé.
    var found = [];
    function scan(line, kind) {
      var q, a, b, t, e, l;
      for (q = 1; q < line.length; q++) {
        a = line[q - 1]; b = line[q];
        l = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
        if (l < 1e-6) continue;
        for (e = 4; e < n; e += 4) {
          t = cross({ x: c.x[e - 4], y: c.y[e - 4] }, { x: c.x[e], y: c.y[e] }, a, b);
          if (t >= 0) found.push({ i: Math.round(e - 4 + t * 4), kind: kind, dx: (b.x - a.x) / l, dy: (b.y - a.y) / l });
        }
      }
    }
    town.avenues.forEach(function (l) { scan(l, 'avenue'); });
    town.highways.forEach(function (l) { scan(l, 'route'); });
    inner.forEach(function (cl) {
      cl.poly.forEach(function (v, q) {
        if (v.n > cl.i && m.cells[v.n] && m.cells[v.n].inner) scan([P(v), P(cl.poly[(q + 1) % cl.poly.length])], 'rue');
      });
    });
    var need = NEED[sizeKey] || 2, crossings = [];
    function apart(f, gap) { return crossings.every(function (o) { return Math.abs(o.i - f.i) * DS > gap; }); }
    found.forEach(function (f) { if (f.kind !== 'rue' && f.i > 30 && f.i < n - 30 && apart(f, 45)) crossings.push(f); });
    var rues = found.filter(function (f) { return f.kind === 'rue'; });
    while (crossings.length < need) {
      var pick = null, far = 70;
      rues.forEach(function (f) {
        var g = Infinity;
        crossings.forEach(function (o) { g = Math.min(g, Math.abs(o.i - f.i) * DS); });
        if (!apart(f, 70)) return;
        if (!crossings.length) g = 1000 - Math.abs(f.i - n / 2);
        if (g > far) { far = g; pick = f; }
      });
      if (!pick) break;
      crossings.push(pick);
    }
    crossings.sort(function (p, q) { return p.i - q.i; });
    crossings.forEach(function (f, q) {
      var nx = -c.ty[f.i], ny = c.tx[f.i], dot = f.dx * nx + f.dy * ny, ux, uy, l, e, px, py, lim = 0.77, s;
      // Le pont suit la rue, sans s'écarter de plus de 40 degrés de la perpendiculaire au courant.
      if (dot < 0) { f.dx = -f.dx; f.dy = -f.dy; dot = -dot; }
      ux = f.dx; uy = f.dy;
      if (dot < lim) {
        s = f.dx * c.tx[f.i] + f.dy * c.ty[f.i] < 0 ? -1 : 1;
        ux = nx * lim + s * c.tx[f.i] * 0.638; uy = ny * lim + s * c.ty[f.i] * 0.638;
      }
      l = Math.sqrt(ux * ux + uy * uy); ux /= l; uy /= l;
      [-1, 1].forEach(function (dir) {
        px = c.x[f.i]; py = c.y[f.i];
        for (e = 0; e < 140 && depth(px, py) < 0; e++) { px += ux * dir; py += uy * dir; }
        if (dir < 0) { f.ax = px - ux * 4; f.ay = py - uy * 4; } else { f.bx = px + ux * 4; f.by = py + uy * 4; }
      });
      f.x = c.x[f.i]; f.y = c.y[f.i]; f.station = (f.i / STATION) | 0;
      f.name = BRIDGES[(q + Math.floor(rnd() * BRIDGES.length)) % BRIDGES.length];
    });
    crossings.forEach(function (f, q) { for (j = 0; j < q; j++) if (crossings[j].name === f.name) f.name = f.kind === 'route' ? 'Pont de la Route' : 'Pont ' + (q + 1); });

    // Bouches : le lit touche deux bords opposés de la grille.
    function port(first) {
      var i0 = first ? 0 : n - 1, side, list = [], q, nx = 0, ny = 0;
      if (c.horiz) { side = c.x[i0] < PX / 2 ? 0 : NX - 1; nx = side ? -1 : 1; for (q = 1; q < NY - 1; q++) if (bed[q * NX + side]) list.push(q * NX + side); }
      else { side = c.y[i0] < PX / 2 ? 0 : NY - 1; ny = side ? -1 : 1; for (q = 1; q < NX - 1; q++) if (bed[side * NX + q]) list.push(side * NX + q); }
      return { cells: new Int32Array(list), nx: nx, ny: ny, off: nx + ny * NX };
    }

    // ---------- Dessin ----------
    function f1(v) { return v.toFixed(1); }
    var left = [], right = [], isleL = [], isleR = [];
    for (i = 0; i < n; i += 2) {
      left.push(f1(c.x[i] - c.ty[i] * c.hw[i]) + ' ' + f1(c.y[i] + c.tx[i] * c.hw[i]));
      right.push(f1(c.x[i] + c.ty[i] * c.hw[i]) + ' ' + f1(c.y[i] - c.tx[i] * c.hw[i]));
      if (c.ih[i] > 0) {
        isleL.push(f1(c.x[i] - c.ty[i] * (c.io + c.ih[i])) + ' ' + f1(c.y[i] + c.tx[i] * (c.io + c.ih[i])));
        isleR.push(f1(c.x[i] - c.ty[i] * (c.io - c.ih[i])) + ' ' + f1(c.y[i] + c.tx[i] * (c.io - c.ih[i])));
      }
    }
    var outline = 'M' + left.join('L') + 'L' + right.reverse().join('L') + 'Z';
    var island = isleL.length > 2 ? 'M' + isleL.join('L') + 'L' + isleR.reverse().join('L') + 'Z' : '';

    // Les maisons et les arbres que le fleuve recouvre disparaissent du plan.
    function clear(svg) {
      return svg.replace(/<path d="([^"]+)" fill="(#[0-9a-f]{6})"/g, function (all, dd, fill) {
        var house = fill === ROOF, tree = WOODS.indexOf(fill) >= 0 && dd.indexOf('a') > 0, kept;
        if (!house && !tree) return all;
        kept = dd.split('M').filter(function (part) {
          var nums, q, sx = 0, sy = 0, cnt = 0;
          if (!part) return false;
          if (tree) {
            nums = part.split(/[ a]/);
            return depth(+nums[0] + +nums[2], +nums[1]) > 3;
          }
          nums = part.replace('Z', '').split('L');
          for (q = 0; q < nums.length; q++) {
            var xy = nums[q].split(' ');
            if (depth(+xy[0], +xy[1]) < QUAY - 2) return false;
            sx += +xy[0]; sy += +xy[1]; cnt++;
          }
          return depth(sx / cnt, sy / cnt) > QUAY - 2;
        });
        return '<path d="' + (kept.length ? 'M' + kept.join('M') : 'M0 0') + '" fill="' + fill + '"';
      });
    }

    var ticks = '', towers = '', trees = '', name = RIVERS[Math.floor(rnd() * RIVERS.length)];
    for (i = 6; i < n - 6; i += 7) {
      [1, -1].forEach(function (s) {
        var bx = c.x[i] - s * c.ty[i] * (c.hw[i] + 1.5), by = c.y[i] + s * c.tx[i] * (c.hw[i] + 1.5), l = 2.5 + rnd() * 2.5;
        ticks += 'M' + f1(bx) + ' ' + f1(by) + 'l' + f1(-s * c.ty[i] * l) + ' ' + f1(s * c.tx[i] * l);
      });
    }
    // Deux tours encadrent le fleuve là où il passe sous le rempart.
    [1, -1].forEach(function (s) {
      var a, b, q, e, t, tx, ty, rr = (0.8 * k).toFixed(1);
      for (i = 4; i < n; i += 4) {
        a = { x: c.x[i - 4] - s * c.ty[i - 4] * (c.hw[i - 4] + 3), y: c.y[i - 4] + s * c.tx[i - 4] * (c.hw[i - 4] + 3) };
        b = { x: c.x[i] - s * c.ty[i] * (c.hw[i] + 3), y: c.y[i] + s * c.tx[i] * (c.hw[i] + 3) };
        for (q = 0; q < town.wall.length; q++) {
          t = cross(a, b, town.wall[q], town.wall[(q + 1) % town.wall.length]);
          if (t < 0) continue;
          tx = a.x + (b.x - a.x) * t; ty = a.y + (b.y - a.y) * t; e = 0.8 * k;
          towers += 'M' + f1(tx - e) + ' ' + f1(ty) + 'a' + rr + ' ' + rr + ' 0 1 0 ' + f1(e * 2) + ' 0a' + rr + ' ' + rr + ' 0 1 0 ' + f1(-e * 2) + ' 0';
        }
      }
    });
    if (island) {
      for (i = c.i0 + 14; i < c.i1 - 14; i += 9) {
        d = c.io + (rnd() * 2 - 1) * Math.max(0, c.ih[i] - 5);
        x = c.x[i] - c.ty[i] * d; y = c.y[i] + c.tx[i] * d; r = 2.4 + rnd() * 1.6;
        trees += 'M' + f1(x - r) + ' ' + f1(y) + 'a' + f1(r) + ' ' + f1(r) + ' 0 1 0 ' + f1(r * 2) + ' 0a' + f1(r) + ' ' + f1(r) + ' 0 1 0 ' + f1(-r * 2) + ' 0';
      }
    }
    // Le nom du fleuve, hors les murs, le long de la rive.
    var li = -1, label = '', ang;
    for (i = 60; i < n - 60 && li < 0; i += 10) {
      x = c.x[i] - c.ty[i] * (c.hw[i] + 16); y = c.y[i] + c.tx[i] * (c.hw[i] + 16);
      if (x > 120 && x < 880 && y > 150 && y < 860 && polyDist(town.wall, x, y) > 40 && polyDist(town.wall, c.x[i], c.y[i]) > 40) li = i;
    }
    if (li >= 0) {
      ang = Math.atan2(c.ty[li], c.tx[li]) * 180 / Math.PI;
      d = c.hw[li] + 15;
      if (ang > 90 || ang < -90) { ang += 180; }
      x = c.x[li] - c.ty[li] * d; y = c.y[li] + c.tx[li] * d;
      label = '<text x="' + f1(x) + '" y="' + f1(y) + '" font-size="15" font-style="italic" text-anchor="middle" fill="#4d6a73" stroke="' + pal.ground + '" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke" transform="rotate(' + ang.toFixed(0) + ' ' + f1(x) + ' ' + f1(y) + ')">' + name.charAt(0).toUpperCase() + name.slice(1) + '</text>';
    }

    // Amont et aval, écrits dans l'eau aux deux bouts du plan.
    function along(q, text) {
      var a = Math.atan2(c.ty[q], c.tx[q]) * 180 / Math.PI;
      if (a > 90 || a < -90) a += 180;
      return '<text x="' + f1(c.x[q]) + '" y="' + f1(c.y[q]) + '" dy="4" font-size="13" font-style="italic" text-anchor="middle" fill="#3f5d67" transform="rotate(' + a.toFixed(0) + ' ' + f1(c.x[q]) + ' ' + f1(c.y[q]) + ')">' + text + '</text>';
    }
    label += along(52, 'amont') + along(n - 53, 'aval');

    var layer = '<g class="fleuve"><clipPath id="lit"><path d="' + outline + '"/></clipPath>' +
      '<path d="' + outline + '" fill="none" stroke="' + pal.ground + '" stroke-width="' + QUAY * 2 + '" stroke-linejoin="round"/>' +
      '<path d="' + ticks + '" fill="none" stroke="' + INK + '" stroke-width=".7" opacity=".55"/>' +
      '<path d="' + outline + '" fill="' + WATER + '" stroke="none"/>' +
      '<g clip-path="url(#lit)"><path d="' + outline + '" fill="none" stroke="' + DEEP + '" stroke-width="13" opacity=".4"/>' +
      '<path d="' + outline + '" fill="none" stroke="' + DEEP + '" stroke-width="5" opacity=".45"/></g>' +
      '<path d="' + outline + '" fill="none" stroke="' + INK + '" stroke-width="1.5" stroke-linejoin="round"/>' +
      (island ? '<path d="' + island + '" fill="' + pal.grass + '" stroke="' + INK + '" stroke-width="1.3" stroke-linejoin="round"/><path d="' + trees + '" fill="' + pal.wood + '" stroke="' + INK + '" stroke-width=".6"/>' : '') +
      (towers ? '<path d="' + towers + '" fill="' + INK + '" stroke="' + INK + '" stroke-width="1"/>' : '') +
      label + '</g>';
    var svg = clear(plan.svg), end = svg.indexOf('</g><rect width="' + PX + '" height="' + PX + '" filter="url(#grain)"/>'), at = svg.indexOf('<text');
    if (end < 0) end = svg.lastIndexOf('</svg>');
    if (at < 0 || at > end) at = end;
    svg = svg.slice(0, at) + layer + svg.slice(at);

    return {
      name: name, tries: tries, penalty: best, walls: c.walls, avenues: c.avenues, highways: c.highways, horiz: c.horiz, isle: !!island,
      n: n, x: c.x, y: c.y, tx: c.tx, ty: c.ty, hw: c.hw,
      band: band, bed: bed, samp: samp, st: st, zone: zone, nSt: nSt, stWard: stWard, build0: b0, build1: b1, town0: z0, town1: z1,
      wards: wards, crossings: crossings, inlet: port(true), outlet: port(false),
      outline: outline, island: island, svg: svg, depth: depth, nearest: nearest
    };
  }

  window.Riviere = window.Riviere || {};
  window.Riviere.NX = NX; window.Riviere.NY = NY; window.Riviere.CELL = CELL; window.Riviere.PX = PX; window.Riviere.STATION = STATION;
  window.Riviere.DS = DS;
  window.Riviere.tracer = trace;
})();
