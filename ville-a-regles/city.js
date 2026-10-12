// Ville à règles : terrain, réseau de rues et parcelles.
// Le réseau est un graphe de carrefours et de tronçons ; chaque tronçon porte des parcelles sur ses deux côtés.
(function () {
  'use strict';

  var V = window.Ville = {};
  var W = V.W = 4800, H = V.H = 3200, CS = V.CS = 40, GW = V.GW = W / CS, GH = V.GH = H / CS;
  var HS = 120, HW = Math.ceil(W / HS), HH = Math.ceil(H / HS);

  V.rng = function (str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    var a = (h ^ (h >>> 16)) >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };

  // ---------- Trigonométrie portable ----------
  // Math.sin, Math.cos et Math.atan2 ne sont pas fixés par la norme et diffèrent d'un moteur à l'autre au dernier chiffre :
  // la ville n'emploie que ces versions-ci (fdlibm), faites d'opérations exactes. Valables pour |x| < 800000.
  var mot = new DataView(new ArrayBuffer(8));
  var haut = function (x) { mot.setFloat64(0, x); return mot.getInt32(0); };
  function ksin(x, y, reste) {
    var z = x * x, v = z * x, p = 8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04 + z * (2.75573137070700676789e-06 + z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)));
    if ((haut(x) & 0x7fffffff) < 0x3e400000) return x;
    return reste ? x - ((z * (0.5 * y - v * p) - y) - v * -1.66666666666666324348e-01) : x + v * (-1.66666666666666324348e-01 + z * p);
  }
  function kcos(x, y) {
    var ix = haut(x) & 0x7fffffff, z = x * x, q;
    if (ix < 0x3e400000) return 1;
    var p = z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05 + z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
    if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * p - x * y));
    if (ix > 0x3fe90000) q = 0.28125; else { mot.setInt32(0, ix - 0x00200000); mot.setInt32(4, 0); q = mot.getFloat64(0); }
    return (1 - q) - ((0.5 * z - q) - (z * p - x * y));
  }
  // Ramène x dans [-π/4, π/4] : rend le quadrant et laisse l'angle réduit, en deux morceaux, dans red
  var red = [0, 0];
  function reduit(x) {
    var t = Math.abs(x), n = Math.floor(t * 6.36619772367581382433e-01 + 0.5), j = (haut(x) & 0x7fffffff) >> 20;
    var p = t - n * 1.57079632673412561417e+00, w = n * 6.07710050650619224932e-11, y = p - w;
    if (j - ((haut(y) >> 20) & 0x7ff) > 16) {
      t = p; w = n * 6.07710050630396597660e-11; p = t - w; w = n * 2.02226624879595063154e-21 - ((t - p) - w); y = p - w;
      if (j - ((haut(y) >> 20) & 0x7ff) > 49) { t = p; w = n * 2.02226624871116645580e-21; p = t - w; w = n * 8.47842766036889956997e-32 - ((t - p) - w); y = p - w; }
    }
    red[0] = x < 0 ? -y : y; red[1] = x < 0 ? -((p - y) - w) : (p - y) - w;
    return (x < 0 ? -n : n) & 3;
  }
  var sin = function (x) {
    if ((haut(x) & 0x7fffffff) <= 0x3fe921fb) return ksin(x, 0, 0);
    var n = reduit(x), a = red[0], b = red[1];
    return n === 0 ? ksin(a, b, 1) : n === 1 ? kcos(a, b) : n === 2 ? -ksin(a, b, 1) : -kcos(a, b);
  };
  var cos = function (x) {
    if ((haut(x) & 0x7fffffff) <= 0x3fe921fb) return kcos(x, 0);
    var n = reduit(x), a = red[0], b = red[1];
    return n === 0 ? kcos(a, b) : n === 1 ? -ksin(a, b, 1) : n === 2 ? -kcos(a, b) : ksin(a, b, 1);
  };
  var AH = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
  var AL = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
  function atan(x) {
    var ix = haut(x) & 0x7fffffff, neg = x < 0, id = -1;
    if (ix >= 0x44100000) return neg ? -(AH[3] + AL[3]) : AH[3] + AL[3];
    if (ix < 0x3fdc0000) { if (ix < 0x3e200000) return x; }
    else {
      x = Math.abs(x);
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); } else if (ix < 0x3ff30000) { id = 1; x = (x - 1) / (x + 1); }
      else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
    }
    var z = x * x, w = z * z;
    var s = z * (3.33333333333329318027e-01 + w * (1.42857142725034663711e-01 + w * (9.09088713343650656196e-02 + w * (6.66107313738753120669e-02 + w * (4.97687799461593236017e-02 + w * 1.62858201153657823623e-02)))))
      + w * (-1.99999999998764832476e-01 + w * (-1.11111104054623557880e-01 + w * (-7.69187620504482999495e-02 + w * (-5.83357013379057348645e-02 + w * -3.65315727442169155270e-02))));
    if (id < 0) return x - x * s;
    z = AH[id] - ((x * s - AL[id]) - x);
    return neg ? -z : z;
  }
  var atan2 = function (y, x) {
    var PI = 3.1415926535897931160e+00, PIB = 1.2246467991473531772e-16, hx = haut(x), hy = haut(y), z;
    if (x === 1) return atan(y);
    if (y === 0) return hx < 0 ? (hy < 0 ? -PI : PI) : y;
    if (x === 0) return hy < 0 ? -PI / 2 : PI / 2;
    var k = ((hy & 0x7fffffff) - (hx & 0x7fffffff)) >> 20;
    if (k > 60) return hy < 0 ? -(PI / 2 + 0.5 * PIB) : PI / 2 + 0.5 * PIB;
    z = hx < 0 && k < -60 ? 0 : atan(Math.abs(y / x));
    return hx < 0 ? (hy < 0 ? (z - PIB) - PI : PI - (z - PIB)) : hy < 0 ? -z : z;
  };

  // ---------- Terrain : un fleuve, quelques lacs, des collines rocheuses ----------
  function terrain(seed) {
    var r = V.rng('terrain' + seed), perm = [], i;
    for (i = 0; i < 256; i++) perm.push(Math.floor(r() * 256));
    var lat = function (x, y) { return perm[(perm[x & 255] + y) & 255] / 255; };
    var noise = function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var a = lat(xi, yi), b = lat(xi + 1, yi), c = lat(xi, yi + 1), d = lat(xi + 1, yi + 1);
      return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy;
    };
    var bank = 0.56 + (r() - 0.5) * 0.14, p1 = r() * 6.28, p2 = r() * 6.28, p3 = r() * 6.28;
    var riverX = function (y) { return W * bank + sin(y / 650 + p1) * W * 0.06 + sin(y / 230 + p2) * W * 0.018; };
    var T = { elev: new Float32Array(GW * GH), water: new Uint8Array(GW * GH), rock: new Uint8Array(GW * GH), riverX: riverX };
    for (var j = 0; j < GH; j++) for (i = 0; i < GW; i++) {
      var x = (i + 0.5) * CS, y = (j + 0.5) * CS;
      var e = noise(x / 900, y / 900) * 0.55 + noise(x / 380 + 9, y / 380 + 4) * 0.3 + noise(x / 150 + 31, y / 150 + 17) * 0.15;
      T.elev[j * GW + i] = e;
      if (Math.abs(x - riverX(y)) < 62 + 24 * sin(y / 400 + p3) || e < 0.27) T.water[j * GW + i] = 1;
      else if (e > 0.71) T.rock[j * GW + i] = 1;
    }
    return T;
  }

  // ---------- Géométrie ----------
  var segDist = V.segDist = function (px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  };
  function cross(ax, ay, bx, by, cx, cy, dx, dy) {
    var d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    var d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }
  var angDiff = function (a, b) { var d = Math.abs(a - b) % 6.2832; return d > 3.1416 ? 6.2832 - d : d; };

  // ---------- Ville ----------
  V.create = function (seed, laws) {
    var r = V.rng('ville' + seed), T = terrain(seed);
    var city = { seed: seed, laws: laws, T: T, nodes: [], edges: [], slots: [], buildings: [], eHash: [], sHash: [], tilt: (r() - 0.5) * 0.9, r: r, stamp: 0 };
    for (var i = 0; i < HW * HH; i++) { city.eHash.push([]); city.sHash.push([]); }
    city.blocked = function (x, y) {
      if (x < 70 || y < 70 || x > W - 70 || y > H - 70) return true;
      var c = Math.floor(y / CS) * GW + Math.floor(x / CS);
      return !!(T.water[c] || T.rock[c]);
    };
    // Centre : la première clairière sur la rive gauche
    var cx = T.riverX(H / 2) - 700, cy = H / 2, ok = false, x0 = cx;
    for (var size = 3; size >= 0 && !ok; size--) {
      for (var k = 0; k < 400 && !ok; k++) {
        var a = k * 0.7, d = k * 9, x = x0 + cos(a) * d, y = H / 2 + sin(a) * d * 0.7;
        ok = !city.blocked(x, y);
        for (var ring = 1; ring <= size && ok; ring++) for (var q = 0; q < 12 && ok; q++) if (city.blocked(x + cos(q * 0.52) * ring * 80, y + sin(q * 0.52) * ring * 80)) ok = false;
        if (ok) { cx = x; cy = y; }
      }
    }
    city.center = { x: cx, y: cy };
    var c0 = addNode(city, cx, cy), n = laws.layout === 'radial' ? 6 : 4, base = laws.layout === 'organique' ? r() * 6.28 : city.tilt;
    for (var s = 0; s < n; s++) {
      var from = c0, ang = base + s * 6.2832 / n + (laws.layout === 'organique' ? (r() - 0.5) * 0.5 : 0);
      for (var g = 0; g < 3; g++) {
        var e = V.tryRoad(city, from, city.nodes[from].x + cos(ang) * 104, city.nodes[from].y + sin(ang) * 104, 2);
        if (!e) break;
        from = e.b === from ? e.a : e.b;
        if (laws.layout === 'organique') ang += (r() - 0.5) * 0.4;
      }
    }
    for (var m = 0; m < 30; m++) V.growRoad(city, city.center, 500);
    return city;
  };

  function addNode(city, x, y) { city.nodes.push({ id: city.nodes.length, x: x, y: y, e: [] }); return city.nodes.length - 1; }
  function cells(ax, ay, bx, by, pad, fn) {
    var x0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad) / HS)), x1 = Math.min(HW - 1, Math.floor((Math.max(ax, bx) + pad) / HS));
    var y0 = Math.max(0, Math.floor((Math.min(ay, by) - pad) / HS)), y1 = Math.min(HH - 1, Math.floor((Math.max(ay, by) + pad) / HS));
    for (var j = y0; j <= y1; j++) for (var i = x0; i <= x1; i++) fn(j * HW + i);
  }
  // Tronçons dont la boîte touche la zone, sans doublon
  function edgesNear(city, ax, ay, bx, by, pad) {
    var out = [], st = ++city.stamp;
    cells(ax, ay, bx, by, pad, function (c) {
      var list = city.eHash[c];
      for (var i = 0; i < list.length; i++) { var e = city.edges[list[i]]; if (e.seen !== st) { e.seen = st; out.push(e); } }
    });
    return out;
  }
  V.slotsNear = function (city, x, y, pad) {
    var out = [];
    cells(x, y, x, y, pad, function (c) { var list = city.sHash[c]; for (var i = 0; i < list.length; i++) out.push(city.slots[list[i]]); });
    return out;
  };

  function addEdge(city, a, b, level, bridge) {
    var A = city.nodes[a], B = city.nodes[b], len = Math.hypot(B.x - A.x, B.y - A.y), ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
    var e = { id: city.edges.length, a: a, b: b, len: len, ux: ux, uy: uy, level: level, bridge: bridge, calm: false,
      load: [0, 0], peak: [0, 0], cong: [0, 0], count: 0, flow: 0, slots: [] };
    city.edges.push(e); A.e.push(e.id); B.e.push(e.id);
    cells(A.x, A.y, B.x, B.y, 0, function (c) { city.eHash[c].push(e.id); });
    // La nouvelle chaussée condamne les parcelles libres qu'elle traverse
    cells(A.x, A.y, B.x, B.y, 30, function (c) {
      city.sHash[c].forEach(function (id) { var s = city.slots[id]; if (!s.b && !s.dead && segDist(s.x, s.y, A.x, A.y, B.x, B.y) < 24) s.dead = true; });
    });
    if (!bridge) {
      var n = Math.floor((len - 30) / 26), start = (len - (n - 1) * 26) / 2;
      [1, -1].forEach(function (side) {
        for (var k = 0; k < n; k++) {
          var d = start + k * 26, x = A.x + ux * d - uy * side * 27, y = A.y + uy * d + ux * side * 27;
          if (city.blocked(x, y)) continue;
          if (edgesNear(city, x, y, x, y, 30).some(function (o) { return o !== e && segDist(x, y, city.nodes[o.a].x, city.nodes[o.a].y, city.nodes[o.b].x, city.nodes[o.b].y) < 21; })) continue;
          if (V.slotsNear(city, x, y, 26).some(function (s) { return !s.dead && Math.hypot(s.x - x, s.y - y) < 23; })) continue;
          var slot = { id: city.slots.length, x: x, y: y, ang: atan2(uy, ux), edge: e.id, b: null, dead: false };
          city.slots.push(slot); e.slots.push(slot.id);
          city.sHash[Math.floor(y / HS) * HW + Math.floor(x / HS)].push(slot.id);
        }
      });
    }
    return e;
  }

  // Tente d'ouvrir un tronçon depuis un carrefour vers un point ; s'accroche à un carrefour voisin s'il y en a un
  V.tryRoad = function (city, from, x2, y2, level) {
    var A = city.nodes[from], len = Math.hypot(x2 - A.x, y2 - A.y), target = -1, best = len * 0.45, i;
    if (A.e.length >= (from === 0 ? 6 : 4)) return null;
    edgesNear(city, x2, y2, x2, y2, best).forEach(function (e) {
      [e.a, e.b].forEach(function (id) {
        var n = city.nodes[id], d = Math.hypot(n.x - x2, n.y - y2);
        if (id !== from && d < best) { best = d; target = id; }
      });
    });
    if (target >= 0) {
      var Tn = city.nodes[target];
      if (Tn.e.length >= 4) return null;
      if (A.e.some(function (id) { var e = city.edges[id]; return e.a === target || e.b === target; })) return null;
      x2 = Tn.x; y2 = Tn.y; len = Math.hypot(x2 - A.x, y2 - A.y);
      if (len < 45 || len > 190) return null;
    }
    if (x2 < 70 || y2 < 70 || x2 > W - 70 || y2 > H - 70) return null;
    // Eau et roche : un pont court est permis aux avenues, la roche jamais
    var wet = 0, steps = Math.ceil(len / 20);
    for (i = 0; i <= steps; i++) {
      var px = A.x + (x2 - A.x) * i / steps, py = A.y + (y2 - A.y) * i / steps, c = Math.floor(py / CS) * GW + Math.floor(px / CS);
      if (city.T.rock[c]) return null;
      if (city.T.water[c]) { if (i === 0 || i === steps) return null; wet++; }
    }
    if (wet && level < 2) return null;
    var ang = atan2(y2 - A.y, x2 - A.x), bad = false;
    var tooClose = function (node, a) {
      return node.e.some(function (id) {
        var e = city.edges[id], o = city.nodes[e.a === node.id ? e.b : e.a];
        return angDiff(atan2(o.y - node.y, o.x - node.x), a) < 0.5;
      });
    };
    if (tooClose(A, ang) || target >= 0 && tooClose(city.nodes[target], ang + Math.PI)) return null;
    edgesNear(city, A.x, A.y, x2, y2, 45).forEach(function (e) {
      if (bad || e.a === from || e.b === from || e.a === target || e.b === target) return;
      var P = city.nodes[e.a], Q = city.nodes[e.b];
      if (cross(A.x, A.y, x2, y2, P.x, P.y, Q.x, Q.y) || segDist(x2, y2, P.x, P.y, Q.x, Q.y) < 34 ||
        segDist(P.x, P.y, A.x, A.y, x2, y2) < 34 || segDist(Q.x, Q.y, A.x, A.y, x2, y2) < 34) bad = true;
    });
    if (bad) return null;
    cells(A.x, A.y, x2, y2, 30, function (cell) {
      city.sHash[cell].forEach(function (id) { var s = city.slots[id]; if (s.b && segDist(s.x, s.y, A.x, A.y, x2, y2) < 24) bad = true; });
    });
    if (bad) return null;
    return addEdge(city, from, target >= 0 ? target : addNode(city, x2, y2), level, wet > 0);
  };

  // Étend le réseau près d'un point d'intérêt, selon le tracé imposé par la règle en vigueur
  V.growRoad = function (city, focus, spread, bold) {
    var r = city.r, N = city.nodes.length, node = null, bs = -1e9, k;
    for (k = 0; k < 16; k++) {
      var n = city.nodes[Math.floor(r() * N)];
      if (n.e.length >= 4) continue;
      var sc = -Math.hypot(n.x - focus.x, n.y - focus.y) / spread + r() * 0.9 + (n.e.length === 1 ? 0.35 : 0);
      if (sc > bs) { bs = sc; node = n; }
    }
    if (!node) return null;
    var layout = city.laws.layout, c = city.center, tries = [], ends = node.e.map(function (id) {
      var e = city.edges[id], o = city.nodes[e.a === node.id ? e.b : e.a];
      return { ang: atan2(o.y - node.y, o.x - node.x), level: e.level };
    });
    var main = ends.length === 1 && ends[0].level >= 2 && r() < 0.8;
    // Une ville à l'étroit ouvre des avenues, seules capables de franchir l'eau
    var at = function (a, l, lv) { tries.push({ x: node.x + cos(a) * (bold ? 230 : l), y: node.y + sin(a) * (bold ? 230 : l), lv: bold ? 2 : lv || 1 }); };
    if (layout === 'damier') {
      for (k = 0; k < 4; k++) at(city.tilt + k * 1.5708, 104, main && angDiff(city.tilt + k * 1.5708, ends[0].ang + Math.PI) < 0.1 ? 2 : 1);
    } else if (layout === 'radial') {
      var phi = atan2(node.y - c.y, node.x - c.x), rho = Math.hypot(node.x - c.x, node.y - c.y);
      at(phi, 104, main ? 2 : 1);
      if (rho > 60) [1, -1].forEach(function (s) { var a = phi + s * 104 / rho; tries.push({ x: c.x + cos(a) * rho, y: c.y + sin(a) * rho, lv: 1 }); });
      at(phi + Math.PI, 104);
    } else {
      ends.forEach(function (o) {
        at(o.ang + Math.PI + (r() - 0.5) * 0.7, 80 + r() * 40, main ? 2 : 1);
        at(o.ang + 1.5708 + (r() - 0.5) * 0.5, 75 + r() * 40);
        at(o.ang - 1.5708 + (r() - 0.5) * 0.5, 75 + r() * 40);
      });
    }
    // L'axe principal d'abord, le reste dans le désordre. Le tri est écrit ici, par insertion dichotomique :
    // la comparaison tire au sort, et Array.sort ne garantit ni le nombre ni l'ordre de ses comparaisons
    for (k = 1; k < tries.length; k++) {
      var t = tries[k], lo = 0, hi = k;
      while (lo < hi) { var mid = (lo + hi) >> 1; if ((tries[mid].lv - t.lv || r() - 0.5) < 0) hi = mid; else lo = mid + 1; }
      tries.splice(k, 1); tries.splice(lo, 0, t);
    }
    for (k = 0; k < tries.length; k++) {
      var e = V.tryRoad(city, node.id, tries[k].x, tries[k].y, tries[k].lv);
      if (e) return e;
    }
    return null;
  };
})();
