// Ville à règles : ménages, emplois, loyers, budget et circulation.
// Un jour dure DAY secondes simulées et l'économie fait ses comptes deux fois par jour.
// Les voitures roulent en temps réel : une seconde de trajet compte pour une minute.
(function () {
  'use strict';

  var V = window.Ville, W = V.W, H = V.H;
  var DAY = V.DAY = 320, FS = 80, FW = W / FS, FH = H / FS;
  var VMAX = [0, 42, 62, 84], WAGE = V.WAGE = [1500, 2600, 4800];
  var KINDS = V.KINDS = {
    R: { name: 'Logements', cap: [3, 6, 12, 24, 45] },
    C: { name: 'Commerces', jobs: [4, 8, 14, 24, 40], mix: [0.55, 0.35, 0.1] },
    I: { name: 'Industrie', jobs: [10, 18, 30], mix: [0.7, 0.25, 0.05] },
    O: { name: 'Bureaux', jobs: [8, 18, 40, 70, 120], mix: [0.1, 0.5, 0.4] },
    P: { name: 'Parc' },
    S: { name: 'École', jobs: [12], mix: [0.3, 0.5, 0.2] },
    H: { name: 'Clinique', jobs: [16], mix: [0.3, 0.4, 0.3] }
  };
  V.CLASSES = ['modeste', 'moyen', 'aisé'];
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  V.Sim = function (seed, laws) {
    var city = V.create(seed, laws), r = V.rng('sim' + seed);
    var S = { city: city, laws: laws, t: DAY * 0.2, day: 1, hh: [], cars: [], money: 150, hist: [], demand: { R: 1, C: 0, I: 0, O: 0 },
      by: { R: [], C: [], I: [], O: [], P: [], S: [], H: [] }, stats: {}, log: [], trucks: [], nextId: 1 };
    var F = S.fields = { acc: new Float32Array(FW * FH), pol: new Float32Array(FW * FH), park: new Float32Array(FW * FH), ave: new Float32Array(FW * FH), pop: new Float32Array(FW * FH) };
    var fcell = function (x, y) { return clamp(Math.floor(y / FS), 0, FH - 1) * FW + clamp(Math.floor(x / FS), 0, FW - 1); };
    var pick = function (list) { return list[Math.floor(r() * list.length)]; };
    var note = function (text) { S.log.unshift({ day: S.day, text: text }); if (S.log.length > 30) S.log.pop(); };

    // ---------- Bâtiments ----------
    function setJobs(b) {
      var K = KINDS[b.type];
      if (!K.jobs) return;
      var total = K.jobs[Math.min(b.level, K.jobs.length) - 1], j0 = Math.round(total * K.mix[0]), j2 = Math.round(total * K.mix[2]);
      b.jobs = [j0, total - j0 - j2, j2];
    }
    function build(type, slot) {
      var e = city.edges[slot.edge], A = city.nodes[e.a], B = city.nodes[e.b];
      var b = { id: S.nextId++, type: type, slot: slot, x: slot.x, y: slot.y, ang: slot.ang, level: 1, edge: e.id,
        node: Math.hypot(A.x - slot.x, A.y - slot.y) < Math.hypot(B.x - slot.x, B.y - slot.y) ? e.a : e.b,
        occ: [], jobs: [0, 0, 0], filled: [0, 0, 0], workers: [], cust: 0, value: 0.3, ask: 1, bad: 0, born: S.day, hue: r() };
      setJobs(b);
      slot.b = b; city.buildings.push(b); S.by[type].push(b);
      b.value = valueAt(b);
      return b;
    }
    function demolish(b) {
      b.dead = true; b.slot.b = null;
      b.workers.slice().forEach(function (h) { quit(h); });
      S.by[b.type].splice(S.by[b.type].indexOf(b), 1);
      city.buildings.splice(city.buildings.indexOf(b), 1);
      S.hh.forEach(function (h) { if (h.shop === b) h.shop = null; });
    }
    var capOf = function (b) { return KINDS.R.cap[b.level - 1]; };
    var maxLevel = function (type) { return type === 'I' ? 3 : type === 'R' && laws.low ? 2 : laws.low ? 3 : 5; };

    // ---------- Champs : accessibilité, pollution, parcs, avenues ----------
    function stamp(field, x, y, R, amount, add) {
      var x0 = Math.max(0, Math.floor((x - R) / FS)), x1 = Math.min(FW - 1, Math.floor((x + R) / FS));
      var y0 = Math.max(0, Math.floor((y - R) / FS)), y1 = Math.min(FH - 1, Math.floor((y + R) / FS));
      for (var j = y0; j <= y1; j++) for (var i = x0; i <= x1; i++) {
        var d = Math.hypot((i + 0.5) * FS - x, (j + 0.5) * FS - y), v = amount * (1 - d / R);
        if (v <= 0) continue;
        if (add) field[j * FW + i] += v; else if (v > field[j * FW + i]) field[j * FW + i] = v;
      }
    }
    function fields() {
      F.acc.fill(0); F.pol.fill(0); F.park.fill(0); F.ave.fill(0); F.pop.fill(0);
      city.buildings.forEach(function (b) {
        if (b.type === 'R') { F.pop[fcell(b.x, b.y)] += b.occ.length; stamp(F.acc, b.x, b.y, 500, b.occ.length * 0.4, true); }
        else if (b.type === 'P') stamp(F.park, b.x, b.y, 420, 1, false);
        else if (b.jobs) stamp(F.acc, b.x, b.y, 700, b.jobs[0] + b.jobs[1] + b.jobs[2], true);
        if (b.type === 'I') stamp(F.pol, b.x, b.y, 430, 0.45 + b.level * 0.15, true);
      });
      city.edges.forEach(function (e) {
        var A = city.nodes[e.a], B = city.nodes[e.b], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        if (e.flow > 150) stamp(F.pol, mx, my, 170, Math.min(0.5, e.flow / 2400), true);
        if (e.level >= 2) stamp(F.ave, mx, my, 260, 1, false);
      });
      // Un village n'offre pas l'accessibilité d'une métropole : l'échelle a un plancher
      var max = 4000;
      for (var i = 0; i < F.acc.length; i++) if (F.acc[i] > max) max = F.acc[i];
      for (i = 0; i < F.acc.length; i++) { F.acc[i] = Math.sqrt(F.acc[i] / max); if (F.pol[i] > 1) F.pol[i] = 1; }
    }
    function valueAt(b) {
      var c = fcell(b.x, b.y), central = Math.max(0, 1 - Math.hypot(b.x - city.center.x, b.y - city.center.y) / 1900);
      var svc = (near(b, S.by.S, 800) ? 0.06 : 0) + (near(b, S.by.H, 1000) ? 0.05 : 0);
      return clamp(0.1 + 0.42 * F.acc[c] + 0.2 * F.park[c] + svc + 0.14 * central - 0.55 * F.pol[c] - 0.1 * Math.min(1, city.edges[b.edge].flow / 1400), 0.03, 1);
    }
    function near(b, list, R) { for (var i = 0; i < list.length; i++) if (Math.hypot(list[i].x - b.x, list[i].y - b.y) < R) return true; return false; }

    // ---------- Ménages ----------
    var incomeOf = function (h) { return h.job ? WAGE[h.jobK] : 750; };
    var rentOf = function (v) { return 230 + 1250 * Math.pow(v, 1.7); };
    function rentFor(h, b) {
      var rent = rentOf(b.value) * b.ask;
      if (laws.cap) rent = Math.min(rent, 820);
      if (laws.mix && h.cls === 0 && (h.home === b ? h.social : b.occ.filter(function (o) { return o.social; }).length < Math.ceil(capOf(b) * 0.3))) rent = Math.min(rent, 480);
      return rent;
    }
    function chooseHome(h, income) {
      var best = null, bu = -1e9, list = S.by.R;
      for (var k = 0, found = 0; k < 40 && found < 10 && list.length; k++) {
        var b = pick(list);
        if (b.occ.length >= capOf(b)) continue;
        found++;
        var burden = rentFor(h, b) / income;
        if (burden > 0.46) continue;
        var u = b.value * (0.4 + 0.6 * h.cls) - 2.2 * Math.max(0, burden - 0.25) - (h.job ? Math.hypot(b.x - h.job.x, b.y - h.job.y) / 2200 : 0) + r() * 0.05;
        if (u > bu) { bu = u; best = b; }
      }
      return best;
    }
    function moveIn(h, b) {
      if (h.home) h.home.occ.splice(h.home.occ.indexOf(h), 1);
      h.social = laws.mix && h.cls === 0 && rentOf(b.value) * b.ask > 480 && b.occ.filter(function (o) { return o.social; }).length < Math.ceil(capOf(b) * 0.3);
      h.home = b; b.occ.push(h); h.path = null; h.strain = 0;
    }
    function quit(h) {
      if (!h.job) return;
      h.job.filled[h.jobK]--; h.job.workers.splice(h.job.workers.indexOf(h), 1);
      h.job = null; h.path = null; h.idle = 0;
    }
    function leave(h) {
      quit(h); h.gone = true;
      h.home.occ.splice(h.home.occ.indexOf(h), 1);
      if (h.shop) h.shop.cust--;
    }
    function seekJob(h) {
      var work = S.work;
      for (var k = h.cls; k >= 0; k--) {
        var best = null, bd = 1e9;
        for (var t = 0, found = 0; t < 50 && found < 14 && work.length; t++) {
          var b = pick(work);
          if (b.filled[k] >= b.jobs[k]) continue;
          found++;
          var d = Math.hypot(b.x - h.home.x, b.y - h.home.y);
          if (d < bd) { bd = d; best = b; }
        }
        if (best && (!h.job || k > h.jobK)) { quit(h); h.job = best; h.jobK = k; best.filled[k]++; best.workers.push(h); h.path = null; return true; }
        if (h.job) return false;
      }
      return false;
    }
    function quitFar(h, far) {
      if (!h.job) return;
      for (var t = 0; t < 20; t++) {
        var b = pick(S.work);
        if (b.filled[h.jobK] < b.jobs[h.jobK] && Math.hypot(b.x - h.home.x, b.y - h.home.y) < far * 0.6) {
          var k = h.jobK; quit(h); h.job = b; h.jobK = k; b.filled[k]++; b.workers.push(h); h.commute *= 0.6; return;
        }
      }
    }
    function seekShop(h) {
      var best = null, bd = 1e9;
      for (var t = 0; t < 6 && S.by.C.length; t++) { var b = pick(S.by.C), d = Math.hypot(b.x - h.home.x, b.y - h.home.y) * (1 + b.cust / (b.jobs[0] + b.jobs[1] + b.jobs[2]) / 8); if (d < bd) { bd = d; best = b; } }
      if (h.shop) h.shop.cust--;
      h.shop = best; if (best) best.cust++;
    }
    function arrive(cls) {
      var h = { id: S.nextId++, cls: cls, home: null, job: null, jobK: 0, shop: null, dep: 5.6 + r() * 4.2, at: 0, went: 0, shopDay: 0, shopH: 17.5 + r() * 3,
        commute: 0, happy: 0.6, strain: 0, idle: 0, since: S.day };
      h.ret = h.dep + 8.5 + r() * 1.5;
      var b = chooseHome(h, WAGE[cls] * 0.9);
      if (!b) return false;
      moveIn(h, b); S.hh.push(h); seekJob(h); seekShop(h);
      return true;
    }

    // ---------- Itinéraires : A* sensible aux bouchons de la veille ----------
    var gS = new Float32Array(1024), seen = new Int32Array(1024), from = new Int32Array(1024), mark = 0, heap = [];
    var cost = function (e, d) { return e.len / (VMAX[e.level] * (e.calm ? 0.25 : 1) * Math.max(0.12, 1 - 0.85 * Math.min(1, e.cong[d]) * Math.min(1, e.cong[d]))); };
    function route(a, b) {
      var N = city.nodes.length;
      if (N > gS.length) { gS = new Float32Array(N * 2); seen = new Int32Array(N * 2); from = new Int32Array(N * 2); mark = 0; }
      var nodes = city.nodes, T = nodes[b], st = ++mark, n, i;
      heap.length = 0;
      var push = function (f, id) {
        heap.push(f, id);
        for (var c = heap.length - 2; c > 0;) { var p = ((c / 2 - 1) >> 1) * 2; if (heap[p] <= heap[c]) break; var tf = heap[p], ti = heap[p + 1]; heap[p] = heap[c]; heap[p + 1] = heap[c + 1]; heap[c] = tf; heap[c + 1] = ti; c = p; }
      };
      var pop = function () {
        var id = heap[1], lf = heap[heap.length - 2], li = heap[heap.length - 1];
        heap.length -= 2;
        if (heap.length) {
          heap[0] = lf; heap[1] = li;
          for (var p = 0; ;) {
            var l = p * 2 + 2, rr = l + 2, m = p;
            if (l < heap.length && heap[l] < heap[m]) m = l;
            if (rr < heap.length && heap[rr] < heap[m]) m = rr;
            if (m === p) break;
            var tf = heap[p], ti = heap[p + 1]; heap[p] = heap[m]; heap[p + 1] = heap[m + 1]; heap[m] = tf; heap[m + 1] = ti; p = m;
          }
        }
        return id;
      };
      gS[a] = 0; seen[a] = st; from[a] = -1; push(0, a);
      while (heap.length) {
        n = pop();
        if (n === b) break;
        var node = nodes[n], g = gS[n];
        for (i = 0; i < node.e.length; i++) {
          var e = city.edges[node.e[i]], d = e.a === n ? 0 : 1, o = d ? e.a : e.b, ng = g + cost(e, d);
          if (seen[o] !== st || ng < gS[o]) { gS[o] = ng; seen[o] = st; from[o] = e.id * 2 + d; push(ng + Math.hypot(nodes[o].x - T.x, nodes[o].y - T.y) / 84, o); }
        }
      }
      if (seen[b] !== st) return null;
      var path = [];
      for (n = b; from[n] >= 0;) { var code = from[n]; path.push(code); var ed = city.edges[code >> 1]; n = code & 1 ? ed.b : ed.a; }
      return path.reverse();
    }
    var flip = function (path) { var out = []; for (var i = path.length - 1; i >= 0; i--) out.push(path[i] ^ 1); return out; };

    // ---------- Déplacements ----------
    function trip(h, A, B, next, purpose) {
      var d = Math.hypot(A.x - B.x, A.y - B.y), c0 = fcell(A.x, A.y), c1 = fcell(B.x, B.y);
      h.at = -1; h.next = next;
      if (d < 330 || A.node === B.node) { h.until = S.t + d / 80; if (purpose < 2) sample(h, d / 80); return; }
      if (laws.bus && F.ave[c0] > 0.1 && F.ave[c1] > 0.1 && (h.id % 10) < 5) { h.until = S.t + d / 55 + 5; if (purpose < 2) sample(h, d / 55 + 5); return; }
      var path;
      if (purpose < 2) { if (!h.path) h.path = route(h.home.node, h.job.node); path = h.path && (purpose ? flip(h.path) : h.path); }
      else path = route(A.node, B.node);
      if (!path || !path.length || S.cars.length > 6000) { h.until = S.t + d / 50; return; }
      launch({ h: h, path: path, purpose: purpose, w: 1 });
    }
    function launch(car) {
      var code = car.path[0], e = city.edges[code >> 1];
      car.i = 0; car.s = 0; car.t0 = S.t; car.wait = 0; car.v = 0; car.lane = Math.floor(r() * 3);
      e.load[code & 1] += car.w;
      S.cars.push(car);
    }
    function sample(h, minutes) { h.commute = h.commute ? h.commute * 0.7 + minutes * 0.3 : minutes; }
    function moveCars(dt) {
      var cars = S.cars, edges = city.edges;
      for (var i = cars.length - 1; i >= 0; i--) {
        var c = cars[i], code = c.path[c.i], e = edges[code >> 1], d = code & 1, lanes = e.level;
        var dens = e.load[d] / Math.max(3, e.len * lanes / 9);
        if (dens > e.peak[d]) e.peak[d] = dens;
        c.v = VMAX[e.level] * (e.calm ? 0.3 : 1) * Math.max(0.06, 1 - dens * dens);
        c.s += c.v * dt;
        if (c.s < e.len) continue;
        if (c.i + 1 >= c.path.length) {
          e.load[d] -= c.w; e.count++;
          cars[i] = cars[cars.length - 1]; cars.pop();
          if (c.h && !c.h.gone) { c.h.at = c.h.next; c.h.until = 0; if (c.purpose < 2) sample(c.h, S.t - c.t0); if (c.h.at === 2) c.h.until = S.t + 5; }
          continue;
        }
        var nc = c.path[c.i + 1], ne = edges[nc >> 1], nd = nc & 1;
        // Tronçon suivant saturé : on attend au carrefour, le bouchon remonte
        if (ne.load[nd] >= Math.max(3, ne.len * ne.level / 9) && c.wait < 7) { c.s = e.len; c.wait += dt; c.v = 0; continue; }
        e.load[d] -= c.w; e.count++; ne.load[nd] += c.w;
        c.i++; c.s = 0; c.wait = 0;
      }
    }
    function schedule() {
      var hour = (S.t % DAY) / DAY * 24, hh = S.hh;
      for (var i = 0; i < hh.length; i++) {
        var h = hh[i];
        if (h.at === -1) { if (h.until && S.t >= h.until) { h.at = h.next; h.until = h.at === 2 ? S.t + 5 : 0; } continue; }
        if (h.at === 0) {
          if (h.job && h.went !== S.day && hour >= h.dep && hour < h.dep + 4) { h.went = S.day; trip(h, h.home, h.job, 1, 0); }
          else if (h.shop && h.shopDay !== S.day && hour >= h.shopH && (h.id + S.day) % 3 === 0) { h.shopDay = S.day; trip(h, h.home, h.shop, 2, 2); }
        } else if (h.at === 1) { if (hour >= h.ret || h.went !== S.day || !h.job) trip(h, h.job || h.home, h.home, 0, 1); }
        else if (h.at === 2 && S.t >= h.until) trip(h, h.shop || h.home, h.home, 0, 3);
      }
      while (S.trucks.length && S.trucks[S.trucks.length - 1].hour <= hour) {
        var tk = S.trucks.pop();
        if (tk.from.dead || tk.to.dead || tk.from.node === tk.to.node) continue;
        var path = route(tk.from.node, tk.to.node);
        if (path && path.length) launch({ h: null, path: path, purpose: 4, w: 2 });
      }
    }

    // ---------- Journée : marché, loyers, chantiers, budget ----------
    function freeSlots() { return city.slots.filter(function (s) { return !s.b && !s.dead; }); }
    function place(type, free) {
      var best = null, bs = -1e9, sep = laws.sep ? 320 : 90, c = city.center;
      for (var k = 0; k < 40 && free.length; k++) {
        var s = pick(free);
        if (s.b || s.dead) continue;
        var f = fcell(s.x, s.y), e = city.edges[s.edge], dc = Math.hypot(s.x - c.x, s.y - c.y), sc;
        if (type === 'R') { if (near(s, S.by.I, sep)) continue; sc = F.acc[f] * 0.6 + F.park[f] * 0.3 - F.pol[f] * 1.5 - dc / 6000; }
        else if (type === 'C') sc = F.acc[f] + e.level * 0.25 + Math.min(1, e.flow / 800) * 0.6 - F.pol[f] * 0.4;
        else if (type === 'I') { if (near(s, S.by.R, sep)) continue; sc = e.level * 0.2 - F.acc[f] * 0.8 - Math.abs(dc - 900) / 1500 + (near(s, S.by.I, 200) ? 0.5 : 0); }
        else sc = F.acc[f] * 1.2 + e.level * 0.2 - dc / 2500 - F.pol[f];
        sc += r() * 0.15;
        if (sc > bs) { bs = sc; best = s; }
      }
      return best ? build(type, best) : null;
    }
    function service(type, radius, cost, free, perUnit) {
      // Un ménage non desservi, pris au hasard, désigne l'emplacement ; à défaut, c'est la saturation qui décide
      var homes = S.by.R.filter(function (b) { return b.occ.length && !near(b, S.by[type], radius); });
      var lacking = homes.reduce(function (n, b) { return n + b.occ.length; }, 0);
      if (!homes.length && S.by[type].length < S.hh.length / perUnit) homes = S.by.R.filter(function (b) { return b.occ.length && !near(b, S.by[type], radius * 0.4); });
      if (!homes.length || S.money < cost) return lacking;
      // Un parc doit couvrir le logement visé ; une école ou une clinique peut s'installer un peu plus loin, faute de place
      var target = pick(homes), best = null, bd = type === 'P' ? radius * 0.9 : radius * 2;
      free.forEach(function (s) { var d = Math.hypot(s.x - target.x, s.y - target.y); if (!s.b && !s.dead && d < bd) { bd = d; best = s; } });
      if (best) { build(type, best); S.money -= cost; S.spent += cost; if (type !== 'P') note(type === 'S' ? 'Une école ouvre.' : 'Une clinique ouvre.'); }
      return lacking;
    }

    function daily() {
      var hh = S.hh, i, b;
      fields();
      S.work = S.by.C.concat(S.by.I, S.by.O, S.by.S, S.by.H);
      // Le foncier suit le quartier ; le loyer demandé baisse tant qu'un logement reste vide et remonte quand l'immeuble est plein
      city.buildings.forEach(function (x) {
        x.value = x.value * 0.6 + valueAt(x) * 0.4;
        if (x.type === 'R') x.ask = x.occ.length < capOf(x) ? Math.max(0.7, x.ask - 0.05) : Math.min(1.25, x.ask + 0.015);
      });
      S.spent = 0;

      // Circulation de la veille : mémoire des bouchons, élargissements
      var worst = null, jam = 0, dirs = 0;
      city.edges.forEach(function (e) {
        for (var d = 0; d < 2; d++) { e.cong[d] = e.cong[d] * 0.55 + Math.min(1.5, e.peak[d]) * 0.45; e.peak[d] = 0; dirs++; if (e.cong[d] > 0.7) jam++; }
        e.flow = e.flow * 0.5 + e.count * 0.5; e.count = 0;
        e.calm = !!laws.calm && Math.hypot((city.nodes[e.a].x + city.nodes[e.b].x) / 2 - city.center.x, (city.nodes[e.a].y + city.nodes[e.b].y) / 2 - city.center.y) < 380;
      });
      var jammed = city.edges.filter(function (e) { return e.level < 3 && Math.max(e.cong[0], e.cong[1]) > 0.5; })
        .sort(function (a, z) { return Math.max(z.cong[0], z.cong[1]) - Math.max(a.cong[0], a.cong[1]); });
      for (i = 0; i < jammed.length && i < 4 && S.money > 10; i++) {
        worst = jammed[i]; worst.level++; worst.cong[0] *= 0.5; worst.cong[1] *= 0.5; S.money -= 10; S.spent += 10; S.widened++;
      }
      if (i) note(i > 1 ? i + ' tronçons élargis contre les bouchons.' : 'Un tronçon élargi contre les bouchons.');

      // Ménages : bonheur, loyers, déménagements, emploi, ascension sociale
      var schooled = 0;
      for (i = hh.length - 1; i >= 0; i--) {
        var h = hh[i], income = incomeOf(h), rent = rentFor(h, h.home), burden = rent / income, c = fcell(h.home.x, h.home.y);
        var school = near(h.home, S.by.S, 800), clinic = near(h.home, S.by.H, 1000);
        if (school) schooled++;
        var now = 0.52 + 0.2 * h.home.value + 0.12 * F.park[c] - 0.25 * F.pol[c] - 0.3 * clamp((h.commute - 18) / 35, 0, 1) - 0.32 * clamp((burden - 0.3) / 0.3, 0, 1) -
          (h.job ? 0 : 0.22) + (school ? 0.06 : 0) + (clinic ? 0.05 : 0) - Math.max(0, laws.tax - 0.12) * 1.2;
        h.happy = h.happy * 0.7 + clamp(now, 0, 1) * 0.3; h.rent = rent;
        h.strain = burden > 0.58 ? h.strain + 1 : Math.max(0, h.strain - 1);
        if (h.job) h.idle = 0; else { h.idle++; seekJob(h); }
        if (h.job && h.jobK < h.cls && r() < 0.2) seekJob(h);
        if (!h.shop || r() < 0.03) seekShop(h);
        // Trop de route : on cherche un emploi plus proche, ou un logement près du sien
        if (h.commute > 35 && r() < 0.1) { var far = Math.hypot(h.job ? h.job.x - h.home.x : 0, h.job ? h.job.y - h.home.y : 0); quitFar(h, far); }
        if (h.strain > 5 || h.happy < 0.32 && r() < 0.12 || h.commute > 40 && r() < 0.06) {
          var nb = chooseHome(h, income);
          if (nb && nb !== h.home) { if (h.strain > 5) S.evicted++; moveIn(h, nb); }
          else if (h.strain > 9 || h.idle > 18 && r() < 0.25 || h.happy < 0.22 && r() < 0.2) { leave(h); hh[i] = hh[hh.length - 1]; hh.pop(); S.left++; continue; }
        }
        if (school && h.job && h.cls < 2 && r() < 0.0035) { h.cls++; S.rose++; }
        if ((h.id + S.day) % 4 === 0) h.path = null;
      }

      // Entreprises : un commerce sans clients ou une usine sans bras ferme
      for (i = S.work.length - 1; i >= 0; i--) {
        b = S.work[i];
        var total = b.jobs[0] + b.jobs[1] + b.jobs[2], filled = b.filled[0] + b.filled[1] + b.filled[2];
        var weak = b.type === 'C' ? b.cust < total * 1.1 || filled < total * 0.25 : (b.type === 'I' || b.type === 'O') && filled < total * 0.25;
        b.bad = weak && S.day - b.born > 6 ? b.bad + 1 : Math.max(0, b.bad - 1);
        if (b.bad > 14) { demolish(b); S.closed++; }
      }
      S.work = S.by.C.concat(S.by.I, S.by.O, S.by.S, S.by.H);
      if (S.closed) note(S.closed > 1 ? S.closed + ' entreprises ferment, faute de clients ou de bras.' : 'Une entreprise ferme, faute de clients ou de bras.');
      if (S.evicted > 4) note(S.evicted + ' ménages chassés par leur loyer.');

      // Demande et attrait
      var units = 0, jobsCap = { C: 0, I: 0, O: 0 }, vac = [0, 0, 0], jobsAll = 0, filledAll = 0;
      S.by.R.forEach(function (x) { units += capOf(x); });
      S.work.forEach(function (x) { for (var k = 0; k < 3; k++) { vac[k] += x.jobs[k] - x.filled[k]; jobsAll += x.jobs[k]; filledAll += x.filled[k]; if (jobsCap[x.type] !== undefined) jobsCap[x.type] += x.jobs[k]; } });
      var n = hh.length, idle = hh.filter(function (x) { return !x.job; }).length, happy = n ? hh.reduce(function (a, x) { return a + x.happy; }, 0) / n : 0.6;
      var attract = clamp(0.45 + 1.6 * (vac[0] + vac[1] + vac[2]) / (n + 20) - 2.5 * idle / (n + 10) + (happy - 0.5) - 2.5 * (laws.tax - 0.12), 0, 1.6);
      var base = Math.max(n, 14) * 1.08 + 14, need = { C: base * 0.3, I: base * 0.36, O: base * 0.3 };
      var vacancy = units - n, wantVac = attract > 0.15 ? (8 + units * 0.14) * Math.min(1, attract) : 0;
      S.demand = { R: clamp((wantVac - vacancy) / (wantVac + 4), -1, 1), C: clamp((need.C - jobsCap.C) / (need.C * 0.3 + 6), -1, 1),
        I: clamp((need.I - jobsCap.I) / (need.I * 0.3 + 6), -1, 1), O: clamp((need.O - jobsCap.O) / (need.O * 0.3 + 6), -1, 1) };

      // Chantiers privés : la plus forte demande d'abord ; à défaut de parcelle, on surélève
      var free = freeSlots(), builds = Math.min(4 + Math.floor(n / 25), 30), stuck = 0, dem = { R: S.demand.R, C: S.demand.C, I: S.demand.I, O: S.demand.O };
      for (i = 0; i < builds; i++) {
        var type = ['R', 'C', 'I', 'O'].sort(function (a, z) { return dem[z] - dem[a]; })[0];
        if (dem[type] <= 0.03) break;
        b = place(type, free);
        if (!b) {
          var list = S.by[type].filter(function (x) { return x.level < maxLevel(type) && (type === 'R' ? x.occ.length >= capOf(x) : x.filled[0] + x.filled[1] + x.filled[2] >= (x.jobs[0] + x.jobs[1] + x.jobs[2]) * 0.8) && x.value > 0.2 + x.level * 0.07 * (laws.cap && type === 'R' ? 1.6 : 1); });
          if (list.length) { b = pick(list); b.level++; setJobs(b); } else stuck++;
        }
        dem[type] -= type === 'R' ? 2 / (wantVac + 4) : 8 / (need[type] * 0.3 + 6);
      }
      // Surélévations spontanées là où le foncier est cher
      for (i = 0; i < 2 + n / 150; i++) {
        b = pick(city.buildings);
        if (!b || !KINDS[b.type].cap && !KINDS[b.type].jobs || b.type === 'S' || b.type === 'H' || b.level >= maxLevel(b.type)) continue;
        var full = b.type === 'R' ? b.occ.length >= capOf(b) : b.filled[0] + b.filled[1] + b.filled[2] >= b.jobs[0] + b.jobs[1] + b.jobs[2];
        if (full && S.demand[b.type] > 0 && b.value > 0.3 + b.level * 0.09 * (laws.cap && b.type === 'R' ? 1.5 : 1)) { b.level++; setJobs(b); }
      }

      // Nouveaux venus, selon les emplois vacants de leur rang
      var come = Math.floor(attract * (5 + 1.3 * Math.sqrt(n)) * Math.max(0, 1 - n / 9000) + r()), tv = vac[0] + vac[1] + vac[2] + 3;
      S.came = 0;
      for (i = 0; i < come; i++) {
        var x = r() * tv, cls = x < vac[0] + 1.4 ? 0 : x < vac[0] + vac[1] + 2.5 ? 1 : 2;
        if (arrive(cls)) S.came++;
      }

      // Services publics et voirie, dans la limite du trésor
      S.noSchool = hh.length > 60 ? service('S', 800, 22, free, 450) : 0;
      S.noClinic = hh.length > 150 ? service('H', 1000, 30, free, 1000) : 0;
      S.noPark = service('P', laws.park ? 300 : 750, 4, free, laws.park ? 60 : 200);
      var left = free.filter(function (s) { return !s.b && !s.dead; }).length, want = 30 + city.buildings.length * 0.22;
      if ((left < want || stuck) && S.money > -80) {
        var roads = Math.min(10, 1 + Math.ceil((want - left) / 8) + stuck);
        for (i = 0; i < roads; i++) {
          var anchor = r() < 0.3 || !city.buildings.length ? city.center : pick(city.buildings);
          var e = V.growRoad(city, anchor, 450, stuck > 2 && S.money > 60 && i % 2 === 0);
          if (e) { var price = e.bridge ? 40 : e.level > 1 ? 6 : 1.2; S.money -= price; S.spent += price; if (e.bridge) note('Un pont franchit le fleuve.'); }
        }
      }

      // Budget, en milliers d'euros par jour
      var taxes = 0, upkeep = 0;
      hh.forEach(function (x) { taxes += incomeOf(x) * laws.tax / 21000; });
      taxes += filledAll * 0.004 * laws.tax / 0.12;
      city.edges.forEach(function (e) { upkeep += e.len * e.level * 0.00016 * (e.bridge ? 4 : 1); if (laws.bus && e.level >= 2) upkeep += e.len * 0.0006; });
      upkeep += S.by.P.length * 0.07 + S.by.S.length * 0.7 + S.by.H.length * 0.9;
      S.money += taxes - upkeep;

      // Livraisons du lendemain : chaque usine approvisionne des commerces
      S.trucks = [];
      S.by.I.forEach(function (x) {
        var k = Math.ceil((x.filled[0] + x.filled[1] + x.filled[2]) / 8);
        for (var q = 0; q < k && S.by.C.length; q++) S.trucks.push({ hour: 7 + r() * 11, from: x, to: pick(S.by.C) });
      });
      S.trucks.sort(function (a, z) { return z.hour - a.hour; });

      // Bilan
      var cm = 0, cn = 0, rentSum = 0, cl = [0, 0, 0], cellP = {}, D = 0;
      hh.forEach(function (x) {
        if (x.commute) { cm += x.commute; cn++; }
        rentSum += x.rent || 0; cl[x.cls]++;
        var k = Math.floor(x.home.y / 320) * 15 + Math.floor(x.home.x / 320), o = cellP[k] || (cellP[k] = [0, 0, 0]); o[x.cls]++;
      });
      if (cl[0] && cl[2]) { Object.keys(cellP).forEach(function (k) { D += Math.abs(cellP[k][0] / cl[0] - cellP[k][2] / cl[2]); }); D /= 2; }
      S.stats = { hh: n, pop: Math.round(n * 2.4), jobs: jobsAll, filled: filledAll, idle: n ? idle / n : 0, happy: happy, commute: cn ? cm / cn : 0, rent: n ? rentSum / n : 0,
        taxes: taxes, upkeep: upkeep, spent: S.spent, balance: taxes - upkeep - S.spent, jam: dirs ? jam / dirs : 0, classes: cl, segregation: D, attract: attract,
        buildings: city.buildings.length, roads: city.edges.reduce(function (a, e) { return a + e.len; }, 0) / 1000, units: units,
        noPark: S.noPark, noSchool: S.noSchool, noClinic: S.noClinic, came: S.came, left: S.left, evicted: S.evicted, closed: S.closed, rose: S.rose, widened: S.widened, peakCars: S.peakCars };
      S.hist.push({ pop: S.stats.pop, money: S.money, commute: S.stats.commute, happy: happy, idle: S.stats.idle, cars: S.peakCars });
      if (S.hist.length > 400) S.hist.shift();
      S.left = 0; S.evicted = 0; S.closed = 0; S.rose = 0; S.peakCars = 0;
    }

    // ---------- Horloge ----------
    S.left = 0; S.evicted = 0; S.closed = 0; S.rose = 0; S.peakCars = 0; S.widened = 0; S.work = []; S.acc = 0; S.tick = 0;
    S.step = function (dt) {
      S.t += dt; S.acc += dt;
      var tick = Math.floor(S.t / (DAY / 2));
      if (tick !== S.tick) { S.tick = tick; S.day = Math.floor(S.t / DAY) + 1; daily(); }
      if (S.acc >= 0.5) { S.acc = 0; schedule(); if (S.cars.length > S.peakCars) S.peakCars = S.cars.length; }
      moveCars(dt);
    };
    S.hour = function () { return (S.t % DAY) / DAY * 24; };
    S.rentFor = rentFor; S.incomeOf = incomeOf; S.capOf = capOf; S.route = route; S.fcell = fcell;
    fields(); daily();
    return S;
  };
})();
