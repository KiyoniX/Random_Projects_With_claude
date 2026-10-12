(function () {
  'use strict';

  var SIZES = {
    bourg: { label: 'bourg', wards: 9, gates: 2 },
    ville: { label: 'ville', wards: 16, gates: 3 },
    cite: { label: 'cité', wards: 28, gates: 4 }
  };
  var PX = 1000;                             // côté du plan, en pixels
  var STREET = 0.6, ROAD = 1.1, MOAT = 1.6;  // demi-largeurs des rues, routes et fossés, en unités du plan
  var HOUSE = 5;                             // surface minimale d'une maison
  var TOISES = 5;                            // toises par unité du plan

  var INK = '#3d2f21', ROOF = '#b99d75', STONE = '#7a5d43', WATER = '#b9d0d2';
  // Couleurs et campagne selon le milieu : sow et grow sont les parts de champs et de bois, sparse la surface par arbre isolé.
  var MILIEUX = {
    '': { paper: '#e4d2aa', ground: '#f1e5c6', fields: ['#d8cd97', '#ccd19c', '#dfcd92', '#c6ca92'], wood: '#8fa56e', grass: '#c3d199', glade: '#cdd3a2', sow: 0.55, grow: 0.17, sparse: 90 },
    foret: { paper: '#dbcf9f', ground: '#f0e6c4', fields: ['#d3cc94', '#c6cf98', '#d9cc90', '#bfc88e'], wood: '#7f9c62', grass: '#b9cc8f', glade: '#c3cf98', sow: 0.3, grow: 0.5, sparse: 30 },
    aride: { paper: '#e9d29c', ground: '#f5e7c1', fields: ['#dcc98e', '#d6c486', '#e2cf96', '#cfc08a'], wood: '#a3a36a', grass: '#cfcf96', glade: '#dccf9a', sow: 0.22, grow: 0.04, sparse: 260 },
    froid: { paper: '#e2dfd1', ground: '#f3f1e5', fields: ['#d6d5bd', '#cfd3c0', '#dcd8bf', '#c9cdb9'], wood: '#6f8a6a', grass: '#c5d0b8', glade: '#cdd6c6', sow: 0.3, grow: 0.3, sparse: 70 }
  };
  var FONT = '\'Palatino Linotype\', \'Book Antiqua\', Palatino, Georgia, serif';

  var HEADS = ['Mont', 'Val', 'Roche', 'Beau', 'Clair', 'Haute', 'Château', 'Pont', 'Bois', 'Font', 'Aigue', 'Belle', 'Castel', 'Mau', 'Ville', 'Neuf'];
  var TAILS = ['fort', 'clair', 'bourg', 'mont', 'val', 'court', 'lieu', 'roux', 'garde', 'rive', 'pierre', 'brune', 'vert', 'franc', 'joie', 'ville'];
  var ENDS = ['', '', '', '', '-le-Vieux', '-la-Garde', '-les-Tours', '-le-Haut', '-en-Marche'];
  var TRADES = ['des Tanneurs', 'des Tisserands', 'des Orfèvres', 'des Bouchers', 'des Potiers', 'des Drapiers', 'des Forgerons', 'des Meuniers', 'du Puits', 'de la Halle', 'des Carmes', 'Saint-Michel', 'Sainte-Anne', 'des Changeurs', 'du Vieux-Pont', 'des Écrivains', 'de la Monnaie', 'des Chandeliers', 'du Guet', 'des Teinturiers', 'des Arbalétriers', 'des Lombards', 'du Four', 'de la Poterne', 'des Cordiers', 'des Vignerons', 'du Beffroi', 'des Tonneliers'];
  var SAINTS = ['Saint-Jean', 'Saint-Martin', 'Notre-Dame', 'Saint-Pierre', 'Sainte-Croix', 'Saint-Étienne'];

  var $ = function (s) { return document.querySelector(s); };

  // ---------- Hasard ----------
  var rng;
  function seedRng(str) {
    var h = 1779033703 ^ str.length, i;
    for (i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    rng = function () {
      h = h + 0x6D2B79F5 | 0;
      var t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function int(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function pick(arr) { return arr[int(0, arr.length - 1)]; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = int(0, i), t = arr[i];
      arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- Géométrie ----------
  // Un polygone est une liste de sommets { x, y, n } ; n étiquette l'arête qui part du sommet.
  // Tous sont convexes et tournent dans le même sens.

  // Garde la partie du polygone où (p - P)·N <= 0. L'arête créée par la coupe reçoit l'étiquette label.
  function cut(poly, px, py, nx, ny, label) {
    var out = [], i, a, b, da, db, t;
    for (i = 0; i < poly.length; i++) {
      a = poly[i]; b = poly[(i + 1) % poly.length];
      da = (a.x - px) * nx + (a.y - py) * ny;
      db = (b.x - px) * nx + (b.y - py) * ny;
      if (da <= 0) out.push(a);
      if ((da <= 0) !== (db <= 0)) {
        t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, n: da <= 0 ? label : a.n });
      }
    }
    return out;
  }
  function area(poly) {
    var s = 0, i, a, b;
    for (i = 0; i < poly.length; i++) { a = poly[i]; b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  }
  function centroid(poly) {
    var x = 0, y = 0, s = 0, i, a, b, w;
    for (i = 0; i < poly.length; i++) {
      a = poly[i]; b = poly[(i + 1) % poly.length];
      w = a.x * b.y - b.x * a.y;
      x += (a.x + b.x) * w; y += (a.y + b.y) * w; s += w;
    }
    return { x: x / (3 * s), y: y / (3 * s) };
  }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  function longest(poly) {
    var best = 0, len = -1, i, l;
    for (i = 0; i < poly.length; i++) {
      l = dist(poly[i], poly[(i + 1) % poly.length]);
      if (l > len) { len = l; best = i; }
    }
    var a = poly[best], b = poly[(best + 1) % poly.length];
    return { a: a, len: len, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len };
  }
  // Rétrécit le polygone ; by est une distance ou une fonction (a, b) qui la donne pour chaque arête.
  function inset(poly, by) {
    var out = poly, i, a, b, dx, dy, l, d;
    for (i = 0; i < poly.length && out.length; i++) {
      a = poly[i]; b = poly[(i + 1) % poly.length];
      dx = b.x - a.x; dy = b.y - a.y; l = Math.sqrt(dx * dx + dy * dy);
      if (l < 1e-9) continue;
      d = typeof by === 'function' ? by(a, b) : by;
      out = cut(out, a.x - dy / l * d, a.y + dx / l * d, dy, -dx, a.n);
    }
    return out.length >= 3 && area(out) > 0.5 ? out : [];
  }
  function inside(poly, p) {
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) return false;
    }
    return true;
  }
  function scatter(poly, count) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, out = [], tries = count * 6, p;
    poly.forEach(function (v) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
    while (out.length < count && tries-- > 0) {
      p = { x: x0 + rng() * (x1 - x0), y: y0 + rng() * (y1 - y0) };
      if (inside(poly, p)) out.push(p);
    }
    return out;
  }

  // Découpe un îlot en parcelles, en coupant à chaque fois le plus long côté.
  // Les grands morceaux sont séparés par une ruelle de largeur gap.
  function lots(poly, min, gap, out, depth) {
    var A = area(poly), e, t, px, py, g;
    if (poly.length < 3 || A < min * 0.3) return;
    if (A < min * (1.2 + rng() * 1.3) || depth > 14) { out.push(poly); return; }
    e = longest(poly);
    t = (0.35 + rng() * 0.3) * e.len;
    px = e.a.x + e.ux * t; py = e.a.y + e.uy * t;
    g = A > min * 8 ? gap / 2 : 0;
    lots(cut(poly, px - e.ux * g, py - e.uy * g, e.ux, e.uy), min, gap, out, depth + 1);
    lots(cut(poly, px + e.ux * g, py + e.uy * g, -e.ux, -e.uy), min, gap, out, depth + 1);
  }

  function voronoi(sites, B) {
    return sites.map(function (s, i) {
      var poly = [{ x: -B, y: -B, n: -1 }, { x: B, y: -B, n: -2 }, { x: B, y: B, n: -3 }, { x: -B, y: B, n: -4 }];
      sites.forEach(function (o, j) {
        if (j !== i) poly = cut(poly, (s.x + o.x) / 2, (s.y + o.y) / 2, o.x - s.x, o.y - s.y, j);
      });
      return poly;
    });
  }

  // Plus court chemin sur les arêtes acceptées par ok, jusqu'au premier nœud accepté par done.
  function route(nodes, from, ok, done) {
    var best = {}, prev = {}, open = [from], cur, i, b, path;
    best[from] = 0;
    while (open.length) {
      for (b = 0, i = 1; i < open.length; i++) if (best[open[i]] < best[open[b]]) b = i;
      cur = open.splice(b, 1)[0];
      if (done(nodes[cur], cur)) {
        for (path = [cur]; prev[path[0]] !== undefined;) path.unshift(prev[path[0]]);
        return path;
      }
      nodes[cur].links.forEach(function (l) {
        var d = best[cur] + l.len;
        if (!ok(l)) return;
        if (best[l.to] === undefined) open.push(l.to);
        else if (d >= best[l.to]) return;
        best[l.to] = d; prev[l.to] = cur;
      });
    }
    return null;
  }

  // ---------- Ville ----------
  function cityName() {
    var head, tail;
    do { head = pick(HEADS); tail = pick(TAILS); } while (head.toLowerCase() === tail);
    return head + tail + pick(ENDS);
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function elide(name) { return /^[aeiouyàâäéèêëîïôöûü]/i.test(name) ? 'd\'' : 'de'; }

  // from, facultatif, décrit la cité d'un autre projet : { name, people, milieu, old }.
  function plan(seed, sizeKey, from) {
    seedRng(seed + '/' + sizeKey);
    from = from || {};
    var size = SIZES[sizeKey], drawn = cityName(), name = from.name || drawn, pal = MILIEUX[from.milieu] || MILIEUX[''];
    var PAPER = pal.paper, GROUND = pal.ground, WOOD = pal.wood, GRASS = pal.grass;
    var count = size.wards * 4 + 8, sites = [], a0 = rng() * Math.PI * 2, i, a, r;

    // Sites en spirale : serrés au centre, espacés vers la campagne.
    for (i = 0; i < count; i++) {
      a = a0 + Math.sqrt(i) * 5; r = i ? 10 + i * (2 + rng()) : 0;
      sites.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    var B = 10 + count * 3 + 30;
    for (i = 0; i < 2; i++) sites = voronoi(sites, B).map(centroid);

    var cells = voronoi(sites, B).map(function (poly, n) {
      var c = centroid(poly);
      return { i: n, poly: poly, c: c, d: Math.sqrt(c.x * c.x + c.y * c.y), inner: false, type: '' };
    });
    var order = cells.slice().sort(function (p, q) { return p.d - q.d; });
    var centre = order[0];
    order.slice(0, size.wards).forEach(function (c) { c.inner = true; });
    function isInner(n) { return n >= 0 && cells[n].inner; }

    // Graphe des sommets. Un sommet est nommé par les trois cellules (ou bords) qui s'y touchent.
    var nodes = {};
    cells.forEach(function (c) {
      c.poly.forEach(function (v, k) {
        var before = c.poly[(k + c.poly.length - 1) % c.poly.length].n;
        v.key = [c.i, before, v.n].sort(function (p, q) { return p - q; }).join('_');
        if (!nodes[v.key]) nodes[v.key] = { x: v.x, y: v.y, key: v.key, links: [] };
      });
    });
    cells.forEach(function (c) {
      c.poly.forEach(function (v, k) {
        var w = c.poly[(k + 1) % c.poly.length], kind, len;
        if (v.n < c.i) return;
        kind = c.inner && isInner(v.n) ? 'street' : c.inner || isInner(v.n) ? 'wall' : 'path';
        len = dist(v, w);
        nodes[v.key].links.push({ to: w.key, len: len, kind: kind });
        nodes[w.key].links.push({ to: v.key, len: len, kind: kind });
      });
    });

    // Rempart : le contour de l'ensemble des quartiers.
    var next = {}, wall = [], cur, first;
    cells.forEach(function (c) {
      if (!c.inner) return;
      c.poly.forEach(function (v, k) {
        if (!isInner(v.n)) { next[v.key] = c.poly[(k + 1) % c.poly.length].key; first = v.key; }
      });
    });
    for (cur = first; cur && wall.length < 500; cur = next[cur]) {
      wall.push(nodes[cur]);
      if (next[cur] === first) break;
    }
    var wallR = 0;
    wall.forEach(function (v) { wallR = Math.max(wallR, Math.sqrt(v.x * v.x + v.y * v.y)); });
    var viewR = wallR * 1.5, k = PX / 2 / viewR;

    // Portes : sommets du rempart où débouche une rue, bien répartis autour de la ville.
    var gates = [];
    shuffle(wall.filter(function (v) { return v.links.some(function (l) { return l.kind === 'street'; }); })).forEach(function (v) {
      var ang = Math.atan2(v.y, v.x);
      if (gates.length < size.gates && gates.every(function (g) {
        var diff = Math.abs(ang - Math.atan2(g.y, g.x));
        return Math.min(diff, Math.PI * 2 - diff) > Math.PI * 1.2 / size.gates;
      })) gates.push(v);
    });
    var gateKeys = {};
    gates.forEach(function (g) { gateKeys[g.key] = g; });

    // Routes : de chaque porte à la place, puis de la porte vers le bord de la carte.
    var roads = {}, highways = [], avenues = [], plaza = {};
    centre.poly.forEach(function (v) { plaza[v.key] = true; });
    function pave(path) {
      for (var n = 1; n < path.length; n++) roads[path[n - 1] < path[n] ? path[n - 1] + '|' + path[n] : path[n] + '|' + path[n - 1]] = true;
    }
    function isRoad(p, q) { return p.key && q.key && roads[p.key < q.key ? p.key + '|' + q.key : q.key + '|' + p.key]; }
    gates.forEach(function (g) {
      var inward = route(nodes, g.key, function (l) { return l.kind === 'street'; }, function (v, key) { return plaza[key]; });
      if (inward) { pave(inward); avenues.push(inward.map(function (key) { return nodes[key]; })); }

      // Hors les murs, la route traverse d'abord le champ qui fait face à la porte.
      var out = cells[g.key.split('_').map(Number).filter(function (n) { return n >= 0 && !cells[n].inner; })[0]];
      var gl = Math.sqrt(g.x * g.x + g.y * g.y), far = null, score = 0;
      if (!out) return;
      out.poly.forEach(function (v) {
        var s = ((v.x - g.x) * g.x + (v.y - g.y) * g.y) / gl;
        if (s > score && !v.key.split('_').some(function (n) { return isInner(+n); })) { score = s; far = v; }
      });
      if (!far) return;
      var outward = route(nodes, far.key, function (l) { return l.kind === 'path'; }, function (v) { return Math.sqrt(v.x * v.x + v.y * v.y) > viewR * 1.45; });
      if (!outward) return;
      pave(outward);
      out.type = 'faubourg'; out.gate = g; out.far = far;
      highways.push([g].concat(outward.map(function (key) { return nodes[key]; })));
    });

    // Quartiers.
    centre.type = 'plaza';
    function ofType(list, type) { if (list.length) pick(list).type = type; }
    ofType(cells.filter(function (c) {
      return c.inner && !c.type && c.poly.some(function (v) { return !isInner(v.n); }) && !c.poly.some(function (v) { return gateKeys[v.key]; });
    }), 'castle');
    ofType(centre.poly.map(function (v) { return cells[v.n]; }).filter(function (c) { return c && c.inner && !c.type; }), 'church');
    if (size.wards >= 12) ofType(cells.filter(function (c) { return c.inner && !c.type; }), 'park');
    var trades = shuffle(TRADES.slice());
    cells.forEach(function (c) {
      if (c.type) return;
      if (c.inner) { c.type = 'houses'; c.name = 'Quartier ' + trades.pop(); return; }
      r = rng();
      c.type = r < pal.sow ? 'fields' : r < pal.sow + pal.grow ? 'forest' : 'plain';
    });

    function margin(c) {
      return function (p, q) {
        if (p.n === undefined) return 0;
        if (isRoad(p, q)) return ROAD;
        if (p.n < 0) return STREET;
        if (cells[p.n].inner !== c.inner) return MOAT;
        return c.inner ? STREET : 0.45;
      };
    }

    // ---------- Dessin ----------
    function X(v) { return (v.x * k + PX / 2).toFixed(1); }
    function Y(v) { return (v.y * k + PX / 2).toFixed(1); }
    function d(poly) { return 'M' + poly.map(function (v) { return X(v) + ' ' + Y(v); }).join('L') + 'Z'; }
    function line(pts) { return 'M' + pts.map(function (v) { return X(v) + ' ' + Y(v); }).join('L'); }
    function dot(p, radius) {
      var px = (radius * k).toFixed(1);
      return 'M' + (p.x * k + PX / 2 - radius * k).toFixed(1) + ' ' + Y(p) + 'a' + px + ' ' + px + ' 0 1 0 ' + (radius * k * 2).toFixed(1) + ' 0a' + px + ' ' + px + ' 0 1 0 ' + (-radius * k * 2).toFixed(1) + ' 0';
    }
    function path(dd, fill, stroke, width, extra) {
      return dd ? '<path d="' + dd + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + width + '" stroke-linejoin="round"' + (extra || '') + '/>' : '';
    }
    function trees(poly, per) {
      return path(scatter(poly, Math.round(area(poly) / per)).map(function (p) { return dot(p, 0.5 + rng() * 0.45); }).join(''), WOOD, INK, 0.6);
    }
    function hatch(poly, step) {
      var e = longest(poly), nx = -e.uy, ny = e.ux, lo = Infinity, hi = -Infinity, out = '', o, pts;
      poly.forEach(function (v) { var p = v.x * nx + v.y * ny; lo = Math.min(lo, p); hi = Math.max(hi, p); });
      for (o = lo + step / 2; o < hi; o += step) {
        pts = [];
        poly.forEach(function (v, n) {
          var w = poly[(n + 1) % poly.length], da = v.x * nx + v.y * ny - o, db = w.x * nx + w.y * ny - o;
          if ((da < 0) !== (db < 0)) pts.push({ x: v.x + (w.x - v.x) * da / (da - db), y: v.y + (w.y - v.y) * da / (da - db) });
        });
        if (pts.length === 2) out += line(pts);
      }
      return out;
    }
    function label(p, text, size) {
      return '<text x="' + X(p) + '" y="' + Y(p) + '" font-size="' + size + '" text-anchor="middle" font-style="italic" fill="' + INK + '" stroke="' + GROUND + '" stroke-width="4" stroke-linejoin="round" paint-order="stroke">' + text + '</text>';
    }
    function ward(title, body) { return body ? '<g class="ward"><title>' + title + '</title>' + body + '</g>' : ''; }

    var houses = 0, labels = '';
    function buildings(block, min, keep) {
      var list = [];
      lots(block, min, 0.9, list, 0);
      list = list.filter(keep || function () { return rng() > 0.06; });
      houses += list.length;
      return path(list.map(d).join(''), ROOF, INK, 0.9);
    }

    function innerWard(c) {
      var block = inset(c.poly, margin(c)), m = centroid(block.length ? block : c.poly), e, w, h, ca, sa, cross, keep, pit;
      if (!block.length) return '';
      if (c.type === 'plaza') {
        labels += label({ x: m.x, y: m.y + 3.2 }, 'Place du Marché', 15);
        return ward('Place du Marché', path(d(block), 'transparent', 'none', 0) + path(dot(m, 1.5), GROUND, INK, 1.2) + path(dot(m, 0.9), WATER, INK, 0.8));
      }
      if (c.type === 'park') {
        return ward('Jardins', path(d(block), GRASS, INK, 0.8) + trees(block, 7));
      }
      if (c.type === 'castle') {
        keep = inset(block, Math.sqrt(area(block)) * 0.27);
        labels += label({ x: m.x, y: m.y + Math.sqrt(area(block)) * 0.5 }, 'Château', 15);
        return ward('Château', path(d(block), GROUND, INK, 3.5) + path(block.map(function (v) { return dot(v, 0.75); }).join(''), INK, INK, 1) + path(keep.length ? d(keep) : '', STONE, INK, 1.5));
      }
      if (c.type === 'church') {
        // Une église en croix au milieu du quartier, des maisons autour.
        e = longest(block); h = Math.sqrt(area(block)) * 0.3; w = h * 0.3;
        ca = e.ux; sa = e.uy;
        cross = [[-h, -w], [-h * 0.35, -w], [-h * 0.35, -h * 0.55], [h * 0.05, -h * 0.55], [h * 0.05, -w], [h, -w], [h, w], [h * 0.05, w], [h * 0.05, h * 0.55], [-h * 0.35, h * 0.55], [-h * 0.35, w], [-h, w]].map(function (p) {
          return { x: m.x + p[0] * ca - p[1] * sa, y: m.y + p[0] * sa + p[1] * ca };
        });
        c.name = 'Église ' + pick(SAINTS);
        labels += label({ x: m.x, y: m.y + h * 0.55 + 2.6 }, c.name, 13);
        // L'entrée des catacombes : un puits au chevet de l'église.
        pit = { x: m.x + h * 0.6 * ca + h * 0.75 * sa, y: m.y + h * 0.6 * sa - h * 0.75 * ca };
        return ward(c.name, buildings(block, HOUSE * 1.4, function (lot) { return dist(centroid(lot), m) > h * 1.25; }) + path(d(cross), STONE, INK, 1.5)) +
          (inside(block, pit) ? ward('Entrée des catacombes', path(dot(pit, 0.7), INK, INK, 1) + path(dot(pit, 0.3), GROUND, 'none', 0)) : '');
      }
      return ward(c.name, buildings(block, HOUSE * (0.8 + 0.9 * c.d / wallR)));
    }

    function outerWard(c) {
      var parts = [c.poly], out = '', e, l;
      if (c.poly.every(function (v) { return Math.abs(v.x) > viewR || Math.abs(v.y) > viewR; }) && c.d > viewR * 1.5) return '';
      if (c.type === 'faubourg') {
        l = dist(c.gate, c.far);
        e = { ux: (c.far.x - c.gate.x) / l, uy: (c.far.y - c.gate.y) / l };
        parts = [cut(c.poly, c.gate.x - e.uy * ROAD, c.gate.y + e.ux * ROAD, e.uy, -e.ux), cut(c.poly, c.gate.x + e.uy * ROAD, c.gate.y - e.ux * ROAD, -e.uy, e.ux)];
      }
      parts.forEach(function (part) {
        var block = part.length >= 3 ? inset(part, margin(c)) : [], sub = [];
        if (!block.length) return;
        if (c.type === 'forest') out += path(d(block), pal.glade, 'none', 0, ' opacity=".6"') + trees(block, 6);
        else if (c.type === 'plain') out += trees(block, pal.sparse);
        else if (c.type === 'fields') {
          lots(block, area(block) / int(2, 4), 0, sub, 0);
          sub.forEach(function (f) {
            f = inset(f, 0.3);
            if (f.length) out += path(d(f), pick(pal.fields), INK, 0.7) + path(hatch(f, 1.5), 'none', INK, 0.35, ' opacity=".55"');
          });
        } else {
          out += buildings(block, HOUSE * 1.7, function (lot) { return dist(centroid(lot), c.gate) < 9 + rng() * 9 && rng() < 0.7; });
        }
      });
      return ward(c.type === 'faubourg' ? 'Faubourg' : c.type === 'fields' ? 'Champs' : c.type === 'forest' ? 'Bois' : 'Prés', out);
    }

    var land = cells.filter(function (c) { return !c.inner; }).map(outerWard).join('');
    var town = cells.filter(function (c) { return c.inner; }).map(innerWard).join('');
    var ways = highways.map(function (h) {
      return path(line(h), 'none', INK, (ROAD * 2 * k + 2).toFixed(1), ' stroke-linecap="round"') + path(line(h), 'none', GROUND, (ROAD * 2 * k).toFixed(1), ' stroke-linecap="round"');
    }).join('');
    var towers = path(wall.filter(function (v) { return !gateKeys[v.key]; }).map(function (v) { return dot(v, 0.8); }).join(''), INK, INK, 1);
    var doors = gates.map(function (g) {
      var s = (1.5 * k).toFixed(1);
      return '<rect x="' + (g.x * k + PX / 2 - 1.5 * k).toFixed(1) + '" y="' + (g.y * k + PX / 2 - 1.5 * k).toFixed(1) + '" width="' + (3 * k).toFixed(1) + '" height="' + (3 * k).toFixed(1) + '" rx="2" fill="' + GROUND + '" stroke="' + INK + '" stroke-width="3" transform="rotate(' + (Math.atan2(g.y, g.x) * 180 / Math.PI).toFixed(0) + ' ' + X(g) + ' ' + Y(g) + ')"><title>Porte</title></rect>';
    }).join('');

    var bar = 20 * k, title = name.toUpperCase(), kind = from.old ? 'vieille ville' : size.label, tw = Math.max(title.length * 19 + 70, 250);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + PX + ' ' + PX + '" width="' + PX + '" height="' + PX + '" font-family="' + FONT + '">' +
      '<defs>' +
      '<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="' + int(1, 999) + '"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.22  0 0 0 0 0.1  0.35 0 0 0 0"/></filter>' +
      '<radialGradient id="shade" r="0.75"><stop offset="0.6" stop-color="#5a4025" stop-opacity="0"/><stop offset="1" stop-color="#5a4025" stop-opacity=".4"/></radialGradient>' +
      '<clipPath id="frame"><rect x="18" y="18" width="' + (PX - 36) + '" height="' + (PX - 36) + '"/></clipPath>' +
      '</defs>' +
      '<rect width="' + PX + '" height="' + PX + '" fill="' + PAPER + '"/>' +
      '<g clip-path="url(#frame)">' + land + ways +
      path(d(wall), GROUND, 'none', 0) + town +
      path(d(wall), 'none', INK, 5) + towers + doors + labels + '</g>' +
      '<rect width="' + PX + '" height="' + PX + '" filter="url(#grain)"/>' +
      '<rect width="' + PX + '" height="' + PX + '" fill="url(#shade)"/>' +
      '<rect x="18" y="18" width="' + (PX - 36) + '" height="' + (PX - 36) + '" fill="none" stroke="' + INK + '" stroke-width="3"/>' +
      '<rect x="26" y="26" width="' + (PX - 52) + '" height="' + (PX - 52) + '" fill="none" stroke="' + INK + '" stroke-width="1"/>' +
      // Cartouche
      '<rect x="' + (PX / 2 - tw / 2) + '" y="40" width="' + tw + '" height="66" fill="' + GROUND + '" stroke="' + INK + '" stroke-width="2"/>' +
      '<rect x="' + (PX / 2 - tw / 2 + 5) + '" y="45" width="' + (tw - 10) + '" height="56" fill="none" stroke="' + INK + '" stroke-width=".8"/>' +
      '<text x="' + PX / 2 + '" y="63" font-size="13" font-style="italic" text-anchor="middle" fill="' + INK + '">Plan de la ' + kind + ' ' + elide(name) + '</text>' +
      '<text x="' + PX / 2 + '" y="92" font-size="27" letter-spacing="3" text-anchor="middle" fill="' + INK + '">' + esc(title) + '</text>' +
      // Rose des vents
      '<g transform="translate(' + (PX - 92) + ' ' + (PX - 100) + ')" fill="' + INK + '" stroke="' + INK + '">' +
      '<circle r="30" fill="' + GROUND + '" stroke-width="1.2"/><path d="M-36 0L0 -7L36 0L0 7Z" fill="' + GROUND + '" stroke-width="1"/><path d="M0 -44L7 0L0 44L-7 0Z" stroke-width="1"/><path d="M0 -44L7 0L0 0Z" fill="' + GROUND + '" stroke-width="1"/>' +
      '<text y="-50" font-size="17" text-anchor="middle" stroke="none">N</text></g>' +
      // Échelle
      '<g transform="translate(52 ' + (PX - 62) + ')" stroke="' + INK + '" fill="' + INK + '">' +
      '<rect width="' + bar.toFixed(1) + '" height="6" fill="' + GROUND + '" stroke-width="1.2"/><rect width="' + (bar / 2).toFixed(1) + '" height="6" stroke-width="1.2"/>' +
      '<text x="' + (bar / 2).toFixed(1) + '" y="24" font-size="13" font-style="italic" text-anchor="middle" stroke="none">' + 20 * TOISES + ' toises</text></g>' +
      '</svg>';

    return {
      svg: svg, name: name, size: kind, people: from.people || '', wards: size.wards, gates: gates.length, towers: wall.length - gates.length, houses: houses,
      pop: Math.round(houses * (5.5 + rng()) / 10) * 10,
      // La ville en données, pour les projets qui jouent sur le plan. Un point du plan se place à x * k + PX / 2 sur le dessin.
      model: { k: k, px: PX, viewR: viewR, wallR: wallR, cells: cells, centre: centre, nodes: nodes, wall: wall, gates: gates, avenues: avenues, highways: highways }
    };
  }

  // Adresse d'un plan : « graine/taille », suivie pour une cité de l'atlas de « ?nom=…&peuple=…&milieu=…&ancienne=…&atlas=… ».
  function parse(raw) {
    var q = raw.indexOf('?'), head = (q < 0 ? raw : raw.slice(0, q)).split('/'), prm = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1)), seed = '';
    try { seed = decodeURIComponent(head[0]); } catch (e) { /* adresse illisible : graine au hasard */ }
    return {
      seed: seed, size: SIZES[head[1]] ? head[1] : 'ville',
      from: prm.get('nom') ? { seed: seed, name: prm.get('nom'), people: prm.get('peuple') || '', milieu: prm.get('milieu') || '', old: prm.get('ancienne') === '1', atlas: prm.get('atlas') || '', query: raw.slice(q + 1) } : null
    };
  }

  // Les autres projets chargent ce fichier pour tracer la même ville ; chez eux, l'interface ci-dessous ne démarre pas.
  window.PlanVille = { plan: plan, parse: parse, SIZES: SIZES, geo: { cut: cut, inset: inset, area: area, centroid: centroid, dist: dist, inside: inside, route: route } };
  if (!$('#toDungeon')) return;

  // ---------- Interface ----------
  var current = null, link = null;   // link : la cité d'où l'on vient, tant qu'on ne change pas de graine
  var vue = window.VuePlanche.create({
    cadre: $('#table'), feuille: $('#feuille'), px: PX, loupe: $('#loupe'), mention: $('#grossi'),
    marge: function () {
      var wide = $('#table').clientWidth > 620;
      return { l: wide ? 104 : 8, t: wide ? 10 : 44, r: 14, b: 10 };
    },
    glisse: function (e) { return e.button === 0; }
  });

  function readAddress() {
    var a = parse(location.hash.slice(1));
    $('#seed').value = a.seed;
    $('#size').value = a.size;
    link = a.from;
  }

  function entry(label, value, unit) { return '<li>' + label + '<b>' + value + '</b>' + (unit ? '<small>' + unit + '</small>' : '') + '</li>'; }

  function show() {
    var seed = $('#seed').value.trim() || Math.random().toString(36).slice(2, 8), size = SIZES[$('#size').value] ? $('#size').value : 'ville';
    var from = link && link.seed === seed ? link : null, address = encodeURIComponent(seed) + '/' + size + (from ? '?' + from.query : '');
    $('#seed').value = seed;
    current = plan(seed, size, from);
    $('#map').innerHTML = current.svg;
    // Les noms des quartiers se lisent sur l'étiquette de la table plutôt que dans une infobulle.
    Array.prototype.forEach.call($('#map').querySelectorAll('title'), function (t) {
      t.parentNode.setAttribute('data-nom', t.textContent);
      t.parentNode.removeChild(t);
    });
    $('#caption').textContent = current.name + ', ' + current.size + (current.people ? ' des ' + current.people : '');
    $('#count').innerHTML = entry('Quartiers dans les murs', current.wards) + entry('Portes', current.gates) + entry('Tours du rempart', current.towers) +
      entry('Maisons', current.houses.toLocaleString('fr-FR')) + entry('Habitants, environ', current.pop.toLocaleString('fr-FR'));
    document.title = 'Plan ' + elide(current.name) + (elide(current.name) === 'de' ? ' ' : '') + current.name;
    $('#toDungeon').href = '../cartes-et-cachots/index.html#' + encodeURIComponent(seed + '-' + size) + '?' + new URLSearchParams({ ville: current.name, plan: address });
    $('#toSiege').href = '../siege/index.html#' + address;
    $('#toRiver').href = '../riviere/index.html#' + address;
    $('#toAtlas').parentNode.hidden = !(from && from.atlas);
    if (from && from.atlas) $('#toAtlas').href = '../mondes/atlas-des-mondes/index.html#' + from.atlas;
    try { history.replaceState(null, '', '#' + address); } catch (e) { location.replace('#' + address); }   // Chrome refuse replaceState en file://
    vue.entier();
  }

  function nameUnder(e) {
    var w = e.target.closest ? e.target.closest('[data-nom]') : null;
    $('#hint').textContent = w ? w.getAttribute('data-nom') : '';
  }
  $('#map').addEventListener('pointermove', nameUnder);
  $('#map').addEventListener('pointerleave', function () { $('#hint').textContent = ''; });

  function save(blob, ext) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url;
    a.download = current.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function svgBlob() { return new Blob([current.svg], { type: 'image/svg+xml;charset=utf-8' }); }

  $('#form').addEventListener('submit', function (e) { e.preventDefault(); show(); });
  $('#size').addEventListener('change', show);
  $('#random').addEventListener('click', function () { $('#seed').value = ''; show(); });
  $('#svg').addEventListener('click', function () { save(svgBlob(), 'svg'); });
  $('#png').addEventListener('click', function () {
    var img = new Image(), url = URL.createObjectURL(svgBlob());
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = PX * 2;
      canvas.getContext('2d').drawImage(img, 0, 0, PX * 2, PX * 2);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) { save(blob, 'png'); });
    };
    img.src = url;
  });

  window.PlanVille.vue = vue;

  readAddress();
  show();
})();
