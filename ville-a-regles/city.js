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
    var riverX = function (y) { return W * bank + Math.sin(y / 650 + p1) * W * 0.06 + Math.sin(y / 230 + p2) * W * 0.018; };
    var T = { elev: new Float32Array(GW * GH), water: new Uint8Array(GW * GH), rock: new Uint8Array(GW * GH), riverX: riverX };
    for (var j = 0; j < GH; j++) for (i = 0; i < GW; i++) {
      var x = (i + 0.5) * CS, y = (j + 0.5) * CS;
      var e = noise(x / 900, y / 900) * 0.55 + noise(x / 380 + 9, y / 380 + 4) * 0.3 + noise(x / 150 + 31, y / 150 + 17) * 0.15;
      T.elev[j * GW + i] = e;
      if (Math.abs(x - riverX(y)) < 62 + 24 * Math.sin(y / 400 + p3) || e < 0.27) T.water[j * GW + i] = 1;
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
        var a = k * 0.7, d = k * 9, x = x0 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d * 0.7;
        ok = !city.blocked(x, y);
        for (var ring = 1; ring <= size && ok; ring++) for (var q = 0; q < 12 && ok; q++) if (city.blocked(x + Math.cos(q * 0.52) * ring * 80, y + Math.sin(q * 0.52) * ring * 80)) ok = false;
        if (ok) { cx = x; cy = y; }
      }
    }
    city.center = { x: cx, y: cy };
    var c0 = addNode(city, cx, cy), n = laws.layout === 'radial' ? 6 : 4, base = laws.layout === 'organique' ? r() * 6.28 : city.tilt;
    for (var s = 0; s < n; s++) {
      var from = c0, ang = base + s * 6.2832 / n + (laws.layout === 'organique' ? (r() - 0.5) * 0.5 : 0);
      for (var g = 0; g < 3; g++) {
        var e = V.tryRoad(city, from, city.nodes[from].x + Math.cos(ang) * 104, city.nodes[from].y + Math.sin(ang) * 104, 2);
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
          var slot = { id: city.slots.length, x: x, y: y, ang: Math.atan2(uy, ux), edge: e.id, b: null, dead: false };
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
    var ang = Math.atan2(y2 - A.y, x2 - A.x), bad = false;
    var tooClose = function (node, a) {
      return node.e.some(function (id) {
        var e = city.edges[id], o = city.nodes[e.a === node.id ? e.b : e.a];
        return angDiff(Math.atan2(o.y - node.y, o.x - node.x), a) < 0.5;
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
      return { ang: Math.atan2(o.y - node.y, o.x - node.x), level: e.level };
    });
    var main = ends.length === 1 && ends[0].level >= 2 && r() < 0.8;
    // Une ville à l'étroit ouvre des avenues, seules capables de franchir l'eau
    var at = function (a, l, lv) { tries.push({ x: node.x + Math.cos(a) * (bold ? 230 : l), y: node.y + Math.sin(a) * (bold ? 230 : l), lv: bold ? 2 : lv || 1 }); };
    if (layout === 'damier') {
      for (k = 0; k < 4; k++) at(city.tilt + k * 1.5708, 104, main && angDiff(city.tilt + k * 1.5708, ends[0].ang + Math.PI) < 0.1 ? 2 : 1);
    } else if (layout === 'radial') {
      var phi = Math.atan2(node.y - c.y, node.x - c.x), rho = Math.hypot(node.x - c.x, node.y - c.y);
      at(phi, 104, main ? 2 : 1);
      if (rho > 60) [1, -1].forEach(function (s) { var a = phi + s * 104 / rho; tries.push({ x: c.x + Math.cos(a) * rho, y: c.y + Math.sin(a) * rho, lv: 1 }); });
      at(phi + Math.PI, 104);
    } else {
      ends.forEach(function (o) {
        at(o.ang + Math.PI + (r() - 0.5) * 0.7, 80 + r() * 40, main ? 2 : 1);
        at(o.ang + 1.5708 + (r() - 0.5) * 0.5, 75 + r() * 40);
        at(o.ang - 1.5708 + (r() - 0.5) * 0.5, 75 + r() * 40);
      });
    }
    // L'axe principal d'abord, le reste dans le désordre
    tries.sort(function (a, b) { return b.lv - a.lv || r() - 0.5; });
    for (k = 0; k < tries.length; k++) {
      var e = V.tryRoad(city, node.id, tries[k].x, tries[k].y, tries[k].lv);
      if (e) return e;
    }
    return null;
  };
})();
