// Ville à règles : plan, vues thématiques, règles et vue de près.
(function () {
  'use strict';

  var V = window.Ville, W = V.W, H = V.H;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var fr = function (n) { return Math.round(n).toLocaleString('fr-FR'); };

  var canvas = $('#view'), ctx = canvas.getContext('2d');
  var state = { S: null, speed: 4, view: 'ville', cam: { x: 0, y: 0, z: 0.6 }, pick: null, ground: null, sorted: [], count: -1, booting: false };
  var laws = { layout: 'organique', sep: false, park: false, low: false, cap: false, mix: false, bus: false, calm: false, tax: 0.12 };

  // Couleurs du plan. Chaque teinte est doublée d'un signe sur le toit, pour qui distingue mal les couleurs.
  var INK = '#16181b', FONT = '"Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif', GRID = 400;
  var CLS = ['#de6a2c', '#f0c53b', '#2f6fb5'], CLSMARK = ['', 'b1', 'b2'];
  var ROOF = { R: ['#d9907a', '#e0a088', '#cf8068', '#e6b09a'], C: ['#4a86c8'], I: ['#9b8fb5'], O: ['#58b0a8'], P: ['#93c77f'], S: ['#ffffff'], H: ['#ffffff'] };
  var MARK = { C: 'h', I: 'b2', O: 'sq', S: 'bar', H: 'x', P: 'dots' };
  var DULL = '#cfccc0';
  var SIZE = { R: [20, 18], C: [22, 18], I: [24, 22], O: [20, 20], P: [24, 22], S: [24, 20], H: [24, 20] };
  var LEGENDS = {
    ville: [['#d9907a', 'Logements'], ['#4a86c8', 'Commerces', 'h'], ['#9b8fb5', 'Industrie', 'b2'], ['#58b0a8', 'Bureaux', 'sq'], ['#93c77f', 'Parcs', 'dots'], ['#ffffff', 'École', 'bar'], ['#ffffff', 'Clinique', 'x']],
    trafic: [['#82aad7', 'Fluide', 'l1'], ['#f7c800', 'Chargé', 'l2'], ['#c4161c', 'Bouchon', 'l3']],
    classes: [[CLS[0], 'Ménages modestes'], [CLS[1], 'Ménages moyens', 'b1'], [CLS[2], 'Ménages aisés', 'b2']],
    valeur: [['#e8ecf4', 'Foncier bas'], ['#7aa0d0', 'Moyen'], ['#10346e', 'Élevé']],
    bonheur: [['#c4161c', 'Malheureux'], ['#f0ece0', 'Mitigés'], ['#0b4ea2', 'Heureux']],
    pollution: [['rgba(150,90,40,.8)', 'Air et bruit dégradés']]
  };
  function ramp(stops, t) {
    t = clamp(t, 0, 1) * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(t)), f = t - i, a = stops[i], b = stops[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }
  var HEAT = [[130, 170, 215], [247, 200, 0], [196, 22, 28]], VAL = [[232, 236, 244], [122, 160, 208], [16, 52, 110]], MOOD = [[196, 22, 28], [240, 236, 224], [11, 78, 162]];
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' + Math.round((n >> 16) * k) + ',' + Math.round((n >> 8 & 255) * k) + ',' + Math.round((n & 255) * k) + ')';
  }
  // Pastille de légende : la teinte du toit et son signe
  function sw(col, mark) {
    var m = '';
    if (mark === 'b1') m = '<path d="M8 1v11" stroke="' + INK + '" stroke-width="1.6"/>';
    else if (mark === 'b2') m = '<path d="M5.5 1v11M10.5 1v11" stroke="' + INK + '" stroke-width="1.6"/>';
    else if (mark === 'h') m = '<path d="M1 8.5h14" stroke="' + INK + '" stroke-width="1.6"/>';
    else if (mark === 'sq') m = '<rect x="5.5" y="4" width="5" height="5" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
    else if (mark === 'bar') m = '<rect x="7" y="2.5" width="2" height="8" fill="#0b4ea2"/>';
    else if (mark === 'x') m = '<path d="M8 2.5v8M4 6.5h8" stroke="#c4161c" stroke-width="2.2"/>';
    else if (mark === 'dots') m = '<circle cx="5" cy="5" r="2" fill="#3f8a44"/><circle cx="10.5" cy="8" r="2" fill="#3f8a44"/>';
    else if (mark) return '<svg class="sw" viewBox="0 0 16 13" aria-hidden="true"><path d="M0 6.5h16" stroke="' + col + '" stroke-width="' + ({ l1: 3, l2: 5, l3: 8 })[mark] + '"/></svg>';
    return '<svg class="sw" viewBox="0 0 16 13" aria-hidden="true"><rect x=".5" y=".5" width="15" height="12" fill="' + col + '" stroke="' + INK + '"/>' + m + '</svg>';
  }
  // Carré du plan, comme dans l'index des rues : lettre de colonne, numéro de rangée
  var square = function (x, y) { return String.fromCharCode(65 + clamp(Math.floor(x / GRID), 0, W / GRID - 1)) + (clamp(Math.floor(y / GRID), 0, H / GRID - 1) + 1); };

  // ---------- Terrain ----------
  function paintGround(city) {
    // Un pixel par case : l'agrandissement lissé donne des rives et des reliefs doux
    var c = document.createElement('canvas'), T = city.T, k = 1;
    c.width = V.GW * k; c.height = V.GH * k;
    var g = c.getContext('2d');
    for (var j = 0; j < V.GH; j++) for (var i = 0; i < V.GW; i++) {
      var q = j * V.GW + i, e = T.elev[q];
      g.fillStyle = T.water[q] ? ramp([[146, 194, 224], [176, 213, 234]], e * 2) : T.rock[q] ? ramp([[214, 208, 194], [190, 184, 170]], (e - 0.7) * 5) : ramp([[224, 231, 207], [240, 237, 224], [230, 222, 199]], (e - 0.25) * 2.2);
      g.fillRect(i * k, j * k, k, k);
    }
    state.ground = c;
  }

  // ---------- Couleur d'un bâtiment selon la vue ----------
  function colorOf(b) {
    var S = state.S, v = state.view, i;
    if (v === 'valeur') return ramp(VAL, b.value * 1.25);
    if (v === 'classes' || v === 'bonheur') {
      if (b.type !== 'R' || !b.occ.length) return DULL;
      if (v === 'bonheur') { var hp = 0; for (i = 0; i < b.occ.length; i++) hp += b.occ[i].happy; return ramp(MOOD, (hp / b.occ.length - 0.25) / 0.5); }
      return CLS[classOf(b)];
    }
    if (v === 'trafic' || v === 'pollution') return DULL;
    var list = ROOF[b.type];
    if (b.type === 'R' && b.level >= 4) return '#c9b5a8';
    return list[Math.floor(b.hue * list.length)];
  }
  function classOf(b) {
    var n = [0, 0, 0]; for (var i = 0; i < b.occ.length; i++) n[b.occ[i].cls]++;
    return n[2] >= n[1] && n[2] >= n[0] ? 2 : n[1] >= n[0] ? 1 : 0;
  }

  // ---------- Dessin ----------
  function resize() {
    var r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d);
  }
  function draw() {
    var S = state.S, city = S.city, cam = state.cam, d = window.devicePixelRatio || 1, z = cam.z * d, cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f4f3ec'; ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(z, 0, 0, z, cw / 2 - cam.x * z, ch / 2 - cam.y * z);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.ground, 0, 0, W, H);
    var x0 = cam.x - cw / 2 / z - 60, x1 = cam.x + cw / 2 / z + 60, y0 = cam.y - ch / 2 / z - 60, y1 = cam.y + ch / 2 / z + 60;
    var view = state.view, i, e, A, B, k;

    // Carroyage du plan et filet du cadre
    ctx.lineWidth = 1 / z; ctx.strokeStyle = 'rgba(22,24,27,.16)'; ctx.beginPath();
    for (i = GRID; i < W; i += GRID) { ctx.moveTo(i, 0); ctx.lineTo(i, H); }
    for (i = GRID; i < H; i += GRID) { ctx.moveTo(0, i); ctx.lineTo(W, i); }
    ctx.stroke();
    ctx.lineWidth = 3 / z; ctx.strokeStyle = INK; ctx.strokeRect(0, 0, W, H);

    if (view === 'pollution') {
      var F = S.fields.pol, FS = W / 60;
      for (i = 0; i < F.length; i++) if (F[i] > 0.03) { ctx.fillStyle = 'rgba(160,92,36,' + Math.min(0.75, F[i] * 0.9).toFixed(2) + ')'; ctx.fillRect((i % 60) * FS, Math.floor(i / 60) * FS, FS + 0.5, FS + 0.5); }
    }

    // Rues : bordure, puis chaussée (blanche pour une rue, jaune pour une avenue, orangée pour un boulevard)
    ctx.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (i = 0; i < city.edges.length; i++) {
        e = city.edges[i]; A = city.nodes[e.a]; B = city.nodes[e.b];
        if (Math.max(A.x, B.x) < x0 || Math.min(A.x, B.x) > x1 || Math.max(A.y, B.y) < y0 || Math.min(A.y, B.y) > y1) continue;
        ctx.lineWidth = 6 + e.level * 4 + (pass ? 0 : e.bridge ? 5 : 3);
        ctx.strokeStyle = pass ? (e.calm ? '#cfe2c2' : ['', '#ffffff', '#fbe7a1', '#f3c456'][e.level]) : e.bridge ? INK : '#8a857a';
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
    }
    if (view === 'trafic') {
      // La charge se lit à la couleur et à l'épaisseur du trait
      ctx.lineCap = 'butt';
      for (i = 0; i < city.edges.length; i++) {
        e = city.edges[i]; A = city.nodes[e.a]; B = city.nodes[e.b];
        if (Math.max(A.x, B.x) < x0 || Math.min(A.x, B.x) > x1 || Math.max(A.y, B.y) < y0 || Math.min(A.y, B.y) > y1) continue;
        var off = 2 + e.level * 1.6;
        for (var dir = 0; dir < 2; dir++) {
          var sgn = dir ? -1 : 1, load = Math.max(e.cong[dir], e.load[dir] / Math.max(3, e.len * e.level / 9));
          ctx.strokeStyle = ramp(HEAT, load / 0.9); ctx.lineWidth = (2 + e.level * 1.6) * (0.5 + 0.7 * clamp(load / 0.9, 0, 1));
          ctx.beginPath(); ctx.moveTo(A.x - e.uy * off * sgn, A.y + e.ux * off * sgn); ctx.lineTo(B.x - e.uy * off * sgn, B.y + e.ux * off * sgn); ctx.stroke();
        }
      }
    }

    // Bâtiments, du fond vers l'avant, avec un léger relief
    if (state.count !== city.buildings.length) { state.sorted = city.buildings.slice().sort(function (p, q) { return p.y - q.y; }); state.count = city.buildings.length; }
    var flat = cam.z < 0.35;
    for (i = 0; i < state.sorted.length; i++) {
      var b = state.sorted[i];
      if (b.dead || b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
      var sz = SIZE[b.type], hw = sz[0] / 2, hd = sz[1] / 2, co = Math.cos(b.ang), si = Math.sin(b.ang), col = colorOf(b);
      var px = [b.x + co * hw - si * hd, b.x + co * hw + si * hd, b.x - co * hw + si * hd, b.x - co * hw - si * hd];
      var py = [b.y + si * hw + co * hd, b.y + si * hw - co * hd, b.y - si * hw - co * hd, b.y - si * hw + co * hd];
      var lift = b.type === 'P' ? 0 : 2 + b.level * (b.type === 'I' ? 2 : 4.2);
      if (b.type === 'P') {
        ctx.fillStyle = view === 'ville' ? '#93c77f' : '#b9cfae'; ctx.beginPath(); ctx.moveTo(px[0], py[0]); for (k = 1; k < 4; k++) ctx.lineTo(px[k], py[k]); ctx.fill();
        if (!flat) { ctx.fillStyle = '#3f8a44'; for (k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(b.x + Math.cos(b.hue * 9 + k * 2.1) * 6, b.y + Math.sin(b.hue * 9 + k * 2.1) * 5, 3.6, 0, 6.283); ctx.fill(); } }
        continue;
      }
      if (!flat) {
        ctx.fillStyle = col.charAt(0) === '#' ? shade(col, 0.6) : 'rgba(22,24,27,.5)';
        ctx.beginPath(); ctx.moveTo(px[0], py[0]); for (k = 1; k < 4; k++) ctx.lineTo(px[k], py[k]);
        for (k = 3; k >= 0; k--) ctx.lineTo(px[k], py[k] - lift);
        ctx.fill();
        ctx.beginPath(); ctx.moveTo(px[0], py[0]); ctx.lineTo(px[1], py[1]); ctx.lineTo(px[1], py[1] - lift); ctx.lineTo(px[0], py[0] - lift); ctx.fill();
        ctx.beginPath(); ctx.moveTo(px[2], py[2]); ctx.lineTo(px[3], py[3]); ctx.lineTo(px[3], py[3] - lift); ctx.lineTo(px[2], py[2] - lift); ctx.fill();
      } else lift = 0;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(px[0], py[0] - lift); for (k = 1; k < 4; k++) ctx.lineTo(px[k], py[k] - lift); ctx.closePath(); ctx.fill();
      if (flat) continue;
      ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(22,24,27,.6)'; ctx.stroke();
      // Signe du toit : nature du bâtiment sur le plan de ville, rang des ménages sur le plan des classes
      var mark = view === 'ville' ? MARK[b.type] : view === 'classes' && b.type === 'R' && b.occ.length ? CLSMARK[classOf(b)] : '';
      if (!mark) continue;
      var at = function (u, v, move) { ctx[move ? 'moveTo' : 'lineTo'](b.x + co * u - si * v, b.y + si * u + co * v - lift); };
      ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.beginPath();
      if (mark === 'b1') { at(0, hd, 1); at(0, -hd); }
      else if (mark === 'b2') { at(-hw / 3, hd, 1); at(-hw / 3, -hd); at(hw / 3, hd, 1); at(hw / 3, -hd); }
      else if (mark === 'h') { at(-hw, hd * 0.4, 1); at(hw, hd * 0.4); }
      else if (mark === 'sq') { at(-3.5, -3.5, 1); at(3.5, -3.5); at(3.5, 3.5); at(-3.5, 3.5); ctx.closePath(); }
      ctx.stroke();
      if (mark === 'bar' || mark === 'x') { ctx.fillStyle = mark === 'x' ? '#c4161c' : '#0b4ea2'; ctx.fillRect(b.x - 2, b.y - lift - 6, 4, 12); if (mark === 'x') ctx.fillRect(b.x - 6, b.y - lift - 2, 12, 4); }
    }

    // Voitures : à droite de l'axe, rouges quand elles sont à l'arrêt ; les camions sont plus longs
    if (cam.z > 0.22) {
      for (i = 0; i < S.cars.length; i++) {
        var c = S.cars[i], code = c.path[c.i]; e = city.edges[code >> 1]; A = city.nodes[e.a];
        var dd = code & 1, s = dd ? e.len - c.s : c.s, side = (dd ? -1 : 1) * (2.2 + (c.lane % e.level) * 3.2);
        var cx = A.x + e.ux * s - e.uy * side, cy = A.y + e.uy * s + e.ux * side;
        if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
        var len = c.purpose === 4 ? 10 : 6;
        ctx.fillStyle = c.v < 6 ? '#c4161c' : c.purpose === 4 ? INK : c.purpose >= 2 ? '#0b4ea2' : '#3d4348';
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(e.uy, e.ux)); ctx.fillRect(-len / 2, -1.6, len, 3.2); ctx.restore();
      }
    }

    // Vu de près : trajets domicile-travail en bleu, objet désigné cerclé de jaune
    var p = state.pick;
    if (p && p.b && !p.b.dead) {
      var bb = p.b, people = bb.type === 'R' ? bb.occ : bb.workers;
      ctx.lineWidth = 2 / cam.z; ctx.strokeStyle = 'rgba(11,78,162,.7)';
      for (i = 0; i < people.length && i < 40; i++) {
        var hh = people[i], path = hh.path;
        if (!hh.job) continue;
        ctx.beginPath();
        if (path && path.length) {
          var n0 = path[0] & 1 ? city.edges[path[0] >> 1].b : city.edges[path[0] >> 1].a; ctx.moveTo(hh.home.x, hh.home.y); ctx.lineTo(city.nodes[n0].x, city.nodes[n0].y);
          for (var q = 0; q < path.length; q++) { var pe = city.edges[path[q] >> 1], nn = city.nodes[path[q] & 1 ? pe.a : pe.b]; ctx.lineTo(nn.x, nn.y); }
          ctx.lineTo(hh.job.x, hh.job.y);
        } else { ctx.moveTo(hh.home.x, hh.home.y); ctx.lineTo(hh.job.x, hh.job.y); }
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(bb.x, bb.y, 20, 0, 6.283);
      ctx.strokeStyle = INK; ctx.lineWidth = 6 / cam.z; ctx.stroke(); ctx.strokeStyle = '#f7c800'; ctx.lineWidth = 3 / cam.z; ctx.stroke();
    } else if (p && p.e) {
      A = city.nodes[p.e.a]; B = city.nodes[p.e.b];
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = INK; ctx.lineWidth = 7 / cam.z; ctx.stroke(); ctx.strokeStyle = '#f7c800'; ctx.lineWidth = 4 / cam.z; ctx.stroke();
    }

    // La nuit tombe
    var hour = S.hour(), night = clamp((Math.abs(hour - 12.5) - 7) / 2.5, 0, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (night > 0) { ctx.fillStyle = 'rgba(8,12,38,' + (night * 0.3).toFixed(2) + ')'; ctx.fillRect(0, 0, cw, ch); }

    // Repères du carroyage, épinglés aux bords du plan
    ctx.font = Math.round(12 * d) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var tag = function (text, x, y) { ctx.fillStyle = '#f4f3ec'; ctx.fillRect(x - 9 * d, y - 8 * d, 18 * d, 16 * d); ctx.fillStyle = INK; ctx.fillText(text, x, y + d); };
    for (i = 0; i < W / GRID; i++) { var sx = cw / 2 + ((i + 0.5) * GRID - cam.x) * z; if (sx > 30 * d && sx < cw - 12 * d) tag(String.fromCharCode(65 + i), sx, 9 * d); }
    for (i = 0; i < H / GRID; i++) { var sy = ch / 2 + ((i + 0.5) * GRID - cam.y) * z; if (sy > 28 * d && sy < ch - 10 * d) tag(String(i + 1), 10 * d, sy); }
  }

  // ---------- Panneaux ----------
  var CHARTS = [['pop', 'Habitants'], ['money', 'Trésor'], ['commute', 'Trajet moyen'], ['happy', 'Bonheur']];
  var HINT = '<p>Clique un bâtiment ou une rue du plan pour voir qui y vit, où ils travaillent et par où ils passent.</p>';
  $('#charts').innerHTML = CHARTS.map(function (c) { return '<div class="chart"><canvas data-key="' + c[0] + '" width="280" height="80"></canvas><span>' + c[1] + '</span></div>'; }).join('');
  function panel() {
    var S = state.S, s = S.stats, hour = S.hour();
    $('#day').textContent = 'Jour ' + S.day;
    $('#hour').textContent = String(Math.floor(hour)).padStart(2, '0') + ' h ' + String(Math.floor(hour % 1 * 60)).padStart(2, '0') + ', ' + fr(S.cars.length) + ' véhicules en route';
    var k = [[fr(s.pop), 'habitants'], [fr(S.money) + ' k€', 'trésor', S.money < 0], [(s.idle * 100).toFixed(0) + ' %', 'chômage', s.idle > 0.1], [Math.round(s.commute) + ' min', 'trajet moyen', s.commute > 30],
      [Math.round(s.happy * 100) + ' %', 'bonheur', s.happy < 0.45], [fr(s.rent) + ' €', 'loyer moyen'], [(s.jam * 100).toFixed(0) + ' %', 'voies saturées', s.jam > 0.15], [s.segregation.toFixed(2), 'ségrégation', s.segregation > 0.6]];
    $('#kpis').innerHTML = k.map(function (x) { return '<li' + (x[2] ? ' class="warn"' : '') + '><span>' + x[1] + '</span><b>' + x[0] + '</b></li>'; }).join('');
    $('#demand').innerHTML = [['R', 'Logements', '#d9907a'], ['C', 'Commerces', '#4a86c8'], ['I', 'Industrie', '#9b8fb5'], ['O', 'Bureaux', '#58b0a8']].map(function (d) {
      var v = S.demand[d[0]], w = Math.abs(v) * 50;
      return '<div class="bar">' + d[1] + '<small>trop</small><div><i style="background:' + d[2] + ';width:' + w.toFixed(0) + '%;left:' + (v < 0 ? 50 - w : 50).toFixed(0) + '%"></i></div><small>peu</small></div>';
    }).join('');
    document.querySelectorAll('#charts canvas').forEach(function (cv) {
      var g = cv.getContext('2d'), key = cv.dataset.key, data = S.hist.map(function (h) { return h[key]; });
      g.clearRect(0, 0, 280, 80);
      if (data.length < 2) return;
      var lo = Math.min.apply(null, data), hi = Math.max.apply(null, data), span = hi - lo || 1;
      g.strokeStyle = INK; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath();
      data.forEach(function (v, n) { var x = n / (data.length - 1) * 276 + 2, y = 74 - (v - lo) / span * 68; if (n) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    });
    $('#log').innerHTML = S.log.slice(0, 8).map(function (l) { return '<li><span>Jour ' + l.day + '</span>' + esc(l.text) + '</li>'; }).join('') || '<li><span></span>Rien à signaler.</li>';
    inspect();
  }
  function inspect() {
    var S = state.S, p = state.pick, box = $('#inspect'), K = V.KINDS, html;
    if (!p || p.b && p.b.dead) { if (p) { state.pick = null; box.innerHTML = '<p>Ce bâtiment a disparu.</p>'; } return; }
    if (p.e) {
      var e = p.e, sat = Math.max(e.cong[0], e.cong[1]), A = S.city.nodes[e.a], B = S.city.nodes[e.b];
      box.innerHTML = '<h3>' + (e.bridge ? 'Pont' : ['', 'Rue', 'Avenue', 'Boulevard'][e.level]) + ', carré ' + square((A.x + B.x) / 2, (A.y + B.y) / 2) + '</h3><p>' + fr(e.len) + ' m, ' + e.level * 2 + ' voies' + (e.calm ? ', en zone apaisée' : '') + '.</p>' +
        '<p>' + fr(e.flow) + ' passages par demi-journée, saturation de pointe ' + Math.round(Math.min(1.5, sat) * 100) + ' %.</p><p>' + (sat > 0.5 && e.level < 3 ? 'Sera élargie dès que le trésor le permet.' : sat > 0.5 ? 'Déjà au gabarit maximal.' : 'Circulation fluide.') + '</p>';
      return;
    }
    var b = p.b, where = ', carré ' + square(b.x, b.y), who = function (h) {
      var income = S.incomeOf(h), d = h.job ? Math.hypot(h.job.x - h.home.x, h.job.y - h.home.y) : 0;
      return '<li><b>' + sw(CLS[h.cls], CLSMARK[h.cls]) + 'Ménage ' + V.CLASSES[h.cls] + '</b>' + (h.social ? ', logement social' : '') +
        '<small>' + (h.job ? K[h.job.type].name.toLowerCase() + ' à ' + fr(d) + ' m, ' + Math.round(h.commute || 0) + ' min de trajet' : 'sans emploi depuis ' + h.idle + ' demi-journées') + '</small>' +
        '<small>' + fr(income) + ' € de revenu, ' + Math.round((h.rent || S.rentFor(h, h.home)) / income * 100) + ' % en loyer, bonheur ' + Math.round(h.happy * 100) + ' %</small></li>';
    };
    if (b.type === 'R') {
      html = '<h3>' + (b.level < 2 ? 'Maisons' : b.level < 4 ? 'Petit immeuble' : 'Grand immeuble') + where + '</h3><p>' + b.occ.length + ' ménages pour ' + S.capOf(b) + ' logements, foncier ' + Math.round(b.value * 100) + ' / 100.</p><ul>' + b.occ.slice(0, 7).map(who).join('') + '</ul>';
    } else if (b.type === 'P') html = '<h3>Parc' + where + '</h3><p>Relève le foncier et le bonheur à 400 m à la ronde.</p>';
    else {
      var total = b.jobs[0] + b.jobs[1] + b.jobs[2], filled = b.filled[0] + b.filled[1] + b.filled[2];
      html = '<h3>' + K[b.type].name + where + '</h3><p>' + filled + ' postes pourvus sur ' + total + ' (' + b.filled.map(function (n, i) { return n + ' ' + V.CLASSES[i] + (n > 1 ? 's' : ''); }).join(', ') + ').</p>' +
        (b.type === 'C' ? '<p>' + b.cust + ' ménages clients.' + (b.bad > 4 ? ' <span class="alerte">En difficulté.</span>' : '') + '</p>' : b.bad > 4 ? '<p class="alerte">Manque de bras : menacé de fermeture.</p>' : '') +
        '<p>Foncier ' + Math.round(b.value * 100) + ' / 100, ouvert au jour ' + b.born + '.</p><ul>' + b.workers.slice(0, 6).map(who).join('') + '</ul>';
    }
    box.innerHTML = html;
  }
  function legend() { $('#legend').innerHTML = LEGENDS[state.view].map(function (l) { return '<li>' + sw(l[0], l[2]) + l[1] + '</li>'; }).join(''); }

  // ---------- Boucle ----------
  var last = 0, tick = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var S = state.S, dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!S || state.booting) return;
    if (state.speed) {
      var step = state.speed <= 4 ? 0.05 : 0.1, n = Math.min(80, Math.max(1, Math.round(dt * state.speed / step)));
      for (var i = 0; i < n; i++) S.step(step);
    }
    draw();
    if (now - tick > 350) { tick = now; panel(); }
  }

  // ---------- Vue ----------
  var zmin = function () { var r = canvas.getBoundingClientRect(); return Math.min(0.14, r.width / (W + 200), r.height / (H + 200)); };
  // Vue d'ensemble : toute la ville bâtie tient dans le cadre
  function fit() {
    var S = state.S, r = canvas.getBoundingClientRect();
    if (!S || !r.width) return;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    S.city.nodes.forEach(function (n) { if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x; if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y; });
    state.cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: clamp(Math.min(r.width / (x1 - x0 + 360), r.height / (y1 - y0 + 360)), zmin(), 0.62) };
  }

  // ---------- Fondation ----------
  function found(seed) {
    state.booting = true; state.pick = null; state.count = -1;
    $('#seed').value = seed; $('#veil').hidden = false;
    try { history.replaceState(null, '', '#' + encodeURIComponent(seed)); } catch (e) { /* adresse non modifiable en local sur certains navigateurs */ }
    $('#inspect').innerHTML = HINT;
    setTimeout(function () {
      var S = state.S = V.Sim(seed, laws), days = 0;
      paintGround(S.city);
      state.cam = { x: S.city.center.x, y: S.city.center.y, z: 0.62 };
      // Quelques jours d'avance pour ne pas ouvrir sur un hameau vide
      (function grow() {
        for (var i = 0; i < V.DAY * 10; i++) S.step(0.1);
        days++;
        $('#veilText').textContent = 'La ville se bâtit… jour ' + days;
        if (days < 12) setTimeout(grow, 0); else { state.booting = false; $('#veil').hidden = true; resize(); fit(); panel(); }
      })();
    }, 30);
  }
  function randomSeed() {
    var a = ['gué', 'pont', 'colline', 'rive', 'moulin', 'marais', 'falaise', 'plaine', 'source', 'confluent', 'port', 'vallon'];
    return a[Math.floor(Math.random() * a.length)] + '-' + Math.floor(Math.random() * 900 + 100);
  }
  function fromHash() {
    try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; /* adresse illisible : nouveau site */ }
  }

  // ---------- Événements ----------
  var drag = null;
  var toWorld = function (ev) {
    var r = canvas.getBoundingClientRect();
    return { x: state.cam.x + (ev.clientX - r.left - r.width / 2) / state.cam.z, y: state.cam.y + (ev.clientY - r.top - r.height / 2) / state.cam.z };
  };
  // Le clic milieu déplace le plan au lieu de lancer le défilement automatique
  canvas.addEventListener('mousedown', function (ev) { if (ev.button === 1) ev.preventDefault(); });
  canvas.addEventListener('pointerdown', function (ev) { drag = { x: ev.clientX, y: ev.clientY, moved: ev.button !== 0 }; canvas.setPointerCapture(ev.pointerId); canvas.classList.add('drag'); });
  canvas.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    state.cam.x = clamp(state.cam.x - dx / state.cam.z, 0, W); state.cam.y = clamp(state.cam.y - dy / state.cam.z, 0, H);
    drag.x = ev.clientX; drag.y = ev.clientY;
  });
  canvas.addEventListener('pointerup', function (ev) {
    canvas.classList.remove('drag');
    if (drag && !drag.moved && state.S) {
      var p = toWorld(ev), city = state.S.city, best = null, bd = 18;
      city.buildings.forEach(function (b) { var d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = b; } });
      if (best) state.pick = { b: best };
      else {
        bd = 14; var be = null;
        city.edges.forEach(function (e) { var d = V.segDist(p.x, p.y, city.nodes[e.a].x, city.nodes[e.a].y, city.nodes[e.b].x, city.nodes[e.b].y); if (d < bd) { bd = d; be = e; } });
        state.pick = be ? { e: be } : null;
        if (!be) $('#inspect').innerHTML = HINT;
      }
      inspect();
    }
    drag = null;
  });
  canvas.addEventListener('pointercancel', function () { drag = null; canvas.classList.remove('drag'); });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var before = toWorld(ev), cam = state.cam;
    cam.z = clamp(cam.z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), zmin(), 3);
    var after = toWorld(ev);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
  }, { passive: false });
  var mark = function (box, attr, value) { box.querySelectorAll('button').forEach(function (b) { var on = b.dataset[attr] === String(value); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); };
  $('#speeds').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (b) { state.speed = +b.dataset.speed; mark(this, 'speed', state.speed); } });
  $('#views').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (b) { state.view = b.dataset.view; mark(this, 'view', state.view); legend(); } });
  document.querySelectorAll('[name=layout]').forEach(function (box) { box.addEventListener('change', function () { if (box.checked) laws.layout = box.value; }); });
  document.querySelectorAll('[data-law]').forEach(function (box) { box.addEventListener('change', function () { laws[box.dataset.law] = box.checked; }); });
  $('#tax').addEventListener('input', function () { laws.tax = +this.value / 100; $('#taxOut').textContent = this.value + ' %'; });
  $('#seedForm').addEventListener('submit', function (ev) { ev.preventDefault(); var v = $('#seed').value.trim(); if (v) found(v); });
  $('#newBtn').addEventListener('click', function () { found(randomSeed()); });
  $('#fit').addEventListener('click', fit);
  window.addEventListener('keydown', function (ev) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName) && ev.target.type !== 'checkbox' && ev.target.type !== 'radio' || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (ev.key === '0' || ev.key === 'à' || ev.key === 'Home') { ev.preventDefault(); fit(); }
  });
  window.addEventListener('resize', resize);
  // Une autre graine arrive par l'adresse : on refonde
  window.addEventListener('hashchange', function () { var v = fromHash(); if (v && !state.booting && state.S && v !== state.S.city.seed) found(v); });

  // Le navigateur peut avoir gardé les réglages d'une visite précédente : les panneaux repartent des lois de départ
  document.querySelectorAll('[name=layout]').forEach(function (box) { box.checked = box.value === laws.layout; });
  document.querySelectorAll('[data-law]').forEach(function (box) { box.checked = laws[box.dataset.law]; });
  $('#tax').value = 12; $('#taxOut').textContent = '12 %';

  resize(); legend(); mark($('#speeds'), 'speed', state.speed); mark($('#views'), 'view', state.view);
  found(fromHash() || randomSeed());
  requestAnimationFrame(frame);

  window.__ville = { state: state, laws: laws };
})();
