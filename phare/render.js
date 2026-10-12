// Le quart de nuit : rendu. Le ciel et la mer d'abord, puis les navires, puis la tour par lancer de rayons.
// Les murs vitrés laissent passer le regard : chaque colonne garde tous ses obstacles et les peint du plus loin au plus près.
(function () {
  'use strict';

  var P = window.Phare, R = P.render = {};
  var RW = 480, RH = 270, PL = 0.8, K = RW / (2 * PL), TS = 64, GS = 11, LEN = [26, 46, 18];
  var clamp = P.clamp, ctx, frame, px, T = {}, SP = {}, LV = [], stars = [], colAz = new Float32Array(RW), glint = new Float32Array(RW);
  // Regard et ambiance de l'image en cours
  var dx, dy, plx, ply, hz, ex, ey, alt, fogR, fogG, fogB, fogK, dawn, yaw;

  var hash = function (i, k) { var v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  var byte = function (v) { return v > 255 ? 255 : v < 0 ? 0 : v | 0; };
  var pack = function (r, g, b) { return 0xff000000 | (byte(b) << 16) | (byte(g) << 8) | byte(r); };
  var add = function (i, r, g, b) { var c = px[i]; px[i] = pack((c & 255) + r, (c >> 8 & 255) + g, (c >> 16 & 255) + b); };

  // ---------- Textures et silhouettes, dessinées au lancement ----------
  // Chaque point reçoit un rôle : 0 vide, 1 matière, 2 lumière, 3 verre
  function paint(w, h, draw, glow) {
    var c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true }), i;
    c.width = w; c.height = h; draw(g);
    var d = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer.slice(0)), f = new Uint8Array(w * h);
    for (i = 0; i < d.length; i++) {
      var a = d[i] >>> 24, n = (hash(i, w) - 0.5) * 20, col = d[i];
      f[i] = a < 60 ? 0 : a < 200 ? 3 : 1;
      if (f[i] === 1) d[i] = pack((col & 255) + n, (col >> 8 & 255) + n, (col >> 16 & 255) + n);
    }
    if (glow) {
      g.clearRect(0, 0, w, h); glow(g);
      var e = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
      for (i = 0; i < e.length; i++) if (e[i] >>> 24 > 128) { d[i] = e[i] | 0xff000000; f[i] = 2; }
    }
    return { c: d, f: f, w: w, h: h };
  }
  var B = function (g, col, x, y, w, h) { g.fillStyle = col; g.fillRect(x, y, w, h); };
  var disc = function (g, col, x, y, r) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  var poly = function (g, col, p) { g.fillStyle = col; g.beginPath(); g.moveTo(p[0], p[1]); for (var i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.fill(); };
  var stone = function (g) {
    B(g, '#a39e90', 0, 0, 64, 64);
    for (var r = 0; r < 4; r++) { B(g, '#837e71', 0, r * 16, 64, 1); for (var c = 0; c < 3; c++) B(g, '#837e71', c * 32 + (r % 2 ? 16 : 0), r * 16, 1, 16); }
    B(g, '#5c5a52', 0, 58, 64, 6);
  };
  var plate = function (g) {
    B(g, '#34443f', 0, 0, 64, 64); B(g, '#25322e', 0, 0, 64, 2); B(g, '#25322e', 0, 61, 64, 3);
    [3, 60].forEach(function (x) { [6, 30, 54].forEach(function (y) { B(g, '#7c8a80', x, y, 1, 1); }); });
  };
  var shelf = function (item, n) {
    return paint(TS, TS, function (g) {
      stone(g); B(g, '#3b2a1a', 6, 6, 52, 52); B(g, '#241a10', 9, 9, 46, 46);
      [24, 40, 55].forEach(function (y) { B(g, '#5a4028', 6, y, 52, 3); });
      for (var i = 0; i < Math.min(n, 9); i++) {
        var x = 12 + (i % 3) * 14, y = [24, 40, 55][Math.floor(i / 3)];
        if (item === 'bidon') { B(g, '#2c5a8a', x, y - 12, 10, 12); B(g, '#1d3f63', x + 2, y - 14, 4, 2); B(g, '#8fb0cf', x + 2, y - 9, 6, 1); }
        else if (item === 'ampoule') { disc(g, '#e9e2c0', x + 5, y - 8, 4); B(g, '#8a7a50', x + 3, y - 4, 4, 4); }
        else { B(g, '#b9b4a6', x + 2, y - 9, 6, 9); B(g, '#8a6a2a', x + 2, y - 9, 6, 2); B(g, '#8a6a2a', x + 2, y - 2, 6, 2); }
      }
    });
  };
  R.stock = function (S) { T.b = shelf('bidon', S.stock.bidon); T.a = shelf('ampoule', S.stock.ampoule); T.u = shelf('fusible', S.stock.fusible); };

  function build() {
    T['#'] = paint(TS, TS, stone);
    T.W = paint(TS, TS, function (g) { stone(g); B(g, '#3d2f20', 16, 12, 32, 34); g.clearRect(19, 15, 26, 28); B(g, '#3d2f20', 31, 15, 2, 28); B(g, '#3d2f20', 19, 28, 26, 2); B(g, '#6f6a60', 14, 46, 36, 3); });
    T.G = paint(TS, TS, function (g) {
      B(g, 'rgba(150,190,200,0.5)', 0, 0, 64, 64); B(g, '#26332f', 0, 0, 3, 64); B(g, '#26332f', 61, 0, 3, 64); B(g, '#26332f', 0, 0, 64, 4);
      B(g, '#34443f', 0, 44, 64, 20); B(g, '#26332f', 0, 44, 64, 2); [8, 24, 40, 56].forEach(function (x) { B(g, '#7c8a80', x, 52, 1, 1); });
    });
    T.R = paint(TS, TS, function (g) { B(g, '#2a3336', 0, 41, 64, 2); B(g, '#2a3336', 0, 61, 64, 3); B(g, '#2a3336', 0, 51, 64, 1); for (var x = 3; x < 64; x += 8) B(g, '#2a3336', x, 43, 1, 18); });
    T.L = paint(TS, TS, function (g) { B(g, '#1a1c1c', 0, 0, 64, 64); B(g, '#7a5a22', 0, 0, 64, 9); B(g, '#a07a30', 0, 7, 64, 2); B(g, '#7a5a22', 0, 46, 64, 18); B(g, '#a07a30', 0, 46, 64, 2); B(g, '#4d3814', 8, 52, 48, 8); },
      function (g) { B(g, '#fff0b8', 4, 10, 56, 35); for (var y = 12; y < 45; y += 5) B(g, '#e2bd62', 4, y, 56, 1); disc(g, '#e2bd62', 32, 27, 11); disc(g, '#fffbe6', 32, 27, 8); B(g, '#a07a30', 0, 10, 4, 35); B(g, '#a07a30', 60, 10, 4, 35); });
    T.g = paint(TS, TS, function (g) {
      stone(g); B(g, '#2f4a3a', 6, 22, 52, 38); B(g, '#243a2d', 6, 22, 52, 3); for (var x = 12; x < 40; x += 5) B(g, '#1c2d23', x, 28, 2, 26);
      B(g, '#8a2a20', 10, 10, 30, 12); B(g, '#5c1a14', 22, 6, 6, 4); disc(g, '#d8d2c0', 49, 38, 6); B(g, '#3a3a36', 49, 33, 1, 5); B(g, '#1c1c1a', 50, 4, 4, 18);
    }, function (g) { B(g, '#7dff8a', 46, 50, 4, 3); });
    var fuse = function (led) { return paint(TS, TS, function (g) { stone(g); B(g, '#6c7074', 16, 12, 32, 36); B(g, '#4a4e52', 18, 14, 28, 32); for (var i = 0; i < 3; i++) B(g, '#c9c2a8', 22 + i * 8, 20, 4, 12); B(g, '#2a2c2e', 22, 38, 20, 4); }, function (g) { B(g, led, 40, 16, 4, 3); }); };
    T.f = fuse('#62ff7a'); T.fKO = fuse('#ff4030');
    T.j = paint(TS, TS, function (g) { stone(g); B(g, '#5a3d22', 2, 36, 60, 28); B(g, '#3f2a16', 2, 36, 60, 3); B(g, '#e8e0c8', 14, 28, 17, 9); B(g, '#d8cfb4', 32, 28, 17, 9); for (var y = 30; y < 36; y += 2) { B(g, '#6a6252', 16, y, 13, 1); B(g, '#6a6252', 34, y, 10, 1); } B(g, '#8a6a2a', 53, 26, 6, 10); },
      function (g) { B(g, '#ffd27a', 54, 17, 4, 9); B(g, '#fff4c8', 55, 20, 2, 5); });
    T.r = paint(TS, TS, function (g) { stone(g); B(g, '#5a3d22', 2, 40, 60, 24); B(g, '#3a2a1e', 12, 18, 40, 22); B(g, '#241a12', 14, 20, 36, 18); disc(g, '#12100c', 24, 29, 7); for (var y = 24; y < 35; y += 3) B(g, '#3a2a1e', 18, y, 12, 1); disc(g, '#8a7a5a', 44, 34, 2); B(g, '#8a8a84', 50, 4, 1, 14); },
      function (g) { B(g, '#ffb040', 36, 23, 12, 5); B(g, '#7a3a00', 41, 23, 1, 5); });
    T.c = paint(TS, TS, function (g) { stone(g); B(g, '#d8caa0', 8, 8, 48, 38); B(g, '#b9a878', 8, 8, 48, 1); poly(g, '#8fa9b8', [8, 30, 22, 24, 34, 31, 56, 22, 56, 46, 8, 46]); disc(g, '#5a4a3a', 28, 20, 2); disc(g, '#5a4a3a', 44, 36, 2); disc(g, '#b02a20', 34, 26, 2); B(g, '#3a3a36', 8, 6, 2, 2); B(g, '#3a3a36', 54, 6, 2, 2); });
    T.m = paint(TS, TS, function (g) { stone(g); disc(g, '#8a6a2a', 32, 26, 14); disc(g, '#ece6d2', 32, 26, 11); for (var a = 0; a < 6.2; a += 0.52) B(g, '#3a3a36', 32 + Math.cos(a) * 9, 26 + Math.sin(a) * 9, 1, 1); poly(g, '#20201e', [32, 25, 39, 19, 33, 27]); disc(g, '#8a6a2a', 32, 26, 2); });
    T.l = paint(TS, TS, function (g) { stone(g); B(g, '#3b2a1a', 0, 34, 64, 30); B(g, '#2f4f6a', 0, 38, 46, 14); B(g, '#243e54', 0, 44, 46, 2); B(g, '#e4e0d4', 46, 37, 16, 9); B(g, '#241a10', 0, 54, 64, 10); });
    T.k = paint(TS, TS, function (g) { plate(g); disc(g, '#8a6a2a', 30, 30, 17); disc(g, '#34443f', 30, 30, 13); for (var a = 0; a < 6.2; a += 0.52) B(g, '#a07a30', 29 + Math.cos(a) * 18, 29 + Math.sin(a) * 18, 3, 3); disc(g, '#a07a30', 30, 30, 4); B(g, '#c9c2a8', 30, 28, 20, 4); B(g, '#3a2a1e', 48, 24, 5, 14); });
    var horn = function (on) { return paint(TS, TS, function (g) { plate(g); poly(g, '#a07a30', [10, 20, 36, 10, 36, 34, 10, 26]); disc(g, '#7a5a22', 36, 22, 12); disc(g, '#1a1c1c', 36, 22, 8); B(g, '#1a1c1c', 48, 34, 4, 22); B(g, '#b02a20', 46, on ? 30 : 48, 8, 8); }, function (g) { B(g, on ? '#ff5a40' : '#3a1410', 14, 46, 6, 4); }); };
    T.h = horn(false); T.hOn = horn(true);
    T.v = paint(TS, TS, function (g) { plate(g); disc(g, '#a07a30', 32, 30, 18); disc(g, '#34443f', 32, 30, 14); for (var a = 0; a < 3.1; a += 0.785) { g.save(); g.translate(32, 30); g.rotate(a); B(g, '#a07a30', -17, -1, 34, 3); g.restore(); } disc(g, '#7a5a22', 32, 30, 5); });
    var stairs = function (up) { return paint(TS, TS, function (g) { stone(g); B(g, '#0f0d0b', 10, 4, 44, 60); for (var i = 0; i < 7; i++) { if (up) B(g, '#7a664c', 10 + i * 3, 56 - i * 8, 44 - i * 6, 3); else if (i < 4) B(g, '#4a3e2e', 10 + i * 4, 60 - i * 5, 44 - i * 8, 2); } B(g, '#a07a30', up ? 12 : 50, up ? 20 : 30, 2, 40); }); };
    T['>'] = stairs(true); T['<'] = stairs(false);
    T.P = paint(TS, TS, function (g) { stone(g); B(g, '#2c4034', 12, 6, 40, 58); for (var x = 12; x < 52; x += 8) B(g, '#223228', x, 6, 1, 58); B(g, '#1c1c1a', 12, 16, 40, 3); B(g, '#1c1c1a', 12, 48, 40, 3); disc(g, '#a07a30', 46, 34, 2); });
    T.flag = paint(TS, TS, function (g) { B(g, '#6d6a62', 0, 0, 64, 64); B(g, '#4e4c46', 0, 0, 64, 1); B(g, '#4e4c46', 0, 32, 64, 1); B(g, '#4e4c46', 0, 0, 1, 32); B(g, '#4e4c46', 32, 32, 1, 32); });
    T.wood = paint(TS, TS, function (g) { B(g, '#6a4c2c', 0, 0, 64, 64); for (var y = 0; y < 64; y += 16) { B(g, '#4a341c', 0, y, 64, 1); B(g, '#4a341c', (y * 5) % 48 + 8, y, 1, 16); } });
    T.iron = paint(TS, TS, function (g) { B(g, '#3a4644', 0, 0, 64, 64); B(g, '#2a3432', 0, 0, 64, 1); B(g, '#2a3432', 0, 0, 1, 64); for (var y = 8; y < 64; y += 16) for (var x = 8; x < 64; x += 16) B(g, '#55625e', x, y, 2, 2); });
    // Caillebotis de la galerie : on voit la mer entre les barreaux
    T.grate = paint(TS, TS, function (g) { for (var i = 0; i < 64; i += 8) { B(g, '#20282a', i, 0, 3, 64); B(g, '#20282a', 0, i, 64, 3); } });
    T.beam = paint(TS, TS, function (g) { B(g, '#3f2e1c', 0, 0, 64, 64); for (var y = 0; y < 64; y += 16) B(g, '#2a1e12', 0, y, 64, 2); B(g, '#241a10', 26, 0, 12, 64); });
    T.dome = paint(TS, TS, function (g) { B(g, '#222c2a', 0, 0, 64, 64); B(g, '#161d1c', 0, 0, 64, 2); B(g, '#161d1c', 0, 0, 2, 64); });

    var lights = function (pts) { return function (g) { pts.forEach(function (p) { B(g, p[0], p[1], p[2], p[3], p[4]); }); }; };
    // Navires dessinés proue à droite ; le magenta devient le feu de bord, rouge ou vert selon le côté qu'on voit
    SP.ship = [
      paint(64, 32, function (g) { poly(g, '#1f3038', [2, 20, 50, 20, 62, 14, 58, 32, 6, 32]); B(g, '#7a2a22', 6, 28, 52, 2); B(g, '#9aa09a', 12, 10, 16, 10); B(g, '#565c58', 11, 8, 18, 2); B(g, '#3a3a36', 36, 2, 1, 18); poly(g, '#3a3a36', [37, 6, 52, 18, 52, 19, 37, 8]); B(g, '#3a3a36', 46, 12, 1, 8); },
        lights([['#fff6d8', 35, 0, 3, 3], ['#ff00ff', 54, 16, 3, 3], ['#ffd880', 15, 13, 3, 3], ['#ffd880', 21, 13, 3, 3]])),
      paint(64, 32, function (g) { poly(g, '#3b2424', [1, 18, 59, 18, 63, 13, 60, 32, 3, 32]); B(g, '#5a4030', 22, 11, 9, 7); B(g, '#3a5060', 32, 9, 9, 9); B(g, '#506040', 42, 12, 9, 6); B(g, '#a8a8a0', 4, 5, 13, 13); B(g, '#2a2a2a', 8, 0, 5, 5); B(g, '#8a2a20', 8, 2, 5, 1); B(g, '#3a3a36', 54, 5, 1, 13); },
        lights([['#fff6d8', 53, 3, 3, 3], ['#fff6d8', 15, 2, 2, 2], ['#ff00ff', 58, 15, 3, 3], ['#ffd880', 6, 8, 2, 2], ['#ffd880', 11, 8, 2, 2], ['#ffd880', 6, 13, 2, 2]])),
      paint(64, 32, function (g) { poly(g, '#c8c8c0', [14, 25, 50, 25, 55, 23, 48, 32, 18, 32]); B(g, '#444440', 32, 1, 1, 24); poly(g, '#8f948f', [34, 3, 34, 23, 50, 23]); poly(g, '#7f847f', [31, 5, 31, 23, 16, 23]); },
        lights([['#fff6d8', 31, 0, 3, 2], ['#ff00ff', 49, 24, 3, 2], ['#ffd880', 27, 26, 3, 2]]))
    ];
    SP.rock = [[2, 24, 6, 10, 12, 14, 16, 2, 22, 12, 27, 8, 30, 24], [1, 24, 8, 12, 13, 16, 20, 6, 25, 15, 31, 24], [3, 24, 5, 15, 11, 6, 15, 13, 21, 9, 24, 17, 29, 14, 31, 24]].map(function (p, i) {
      return paint(32, 24, function (g) { poly(g, '#17191c', p); poly(g, '#2a2f33', [p[4], p[5], p[6], p[7], p[6] + 3, 24, p[4] + 1, 24]); for (var x = 1; x < 31; x += 3) B(g, '#8fa2a8', x, 22 - (x * (i + 3)) % 2, 2, 2); });
    });

    P.LEVELS.forEach(function (rows) { var a = new Uint8Array(GS * GS); rows.forEach(function (row, y) { for (var x = 0; x < GS; x++) a[y * GS + x] = row.charCodeAt(x); }); LV.push(a); });
    for (var i = 0; i < 320; i++) stars.push({ a: hash(i, 1) * 6.2832, e: Math.asin(hash(i, 2) * 0.92), b: 60 + hash(i, 3) * 150 });
    for (i = 0; i < RW; i++) colAz[i] = Math.atan((2 * i / RW - 1) * PL);
  }

  R.init = function (canvas, S) {
    ctx = canvas.getContext('2d'); frame = ctx.createImageData(RW, RH); px = new Uint32Array(frame.data.buffer);
    build(); R.stock(S);
  };

  // Point du monde à h au-dessus de l'eau, vu à l'écran
  function proj(wx, wy, h) {
    var ox = wx - ex, oy = wy - ey, d = dx * ox + dy * oy;
    return d < 1 ? null : { x: RW / 2 + K * (dx * oy - dy * ox) / d, y: hz + (alt - h) * K / d, d: d };
  }
  function dot(x, y, r, g, b, f) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < RW && y < RH) px[y * RW + x] = pack(r + (fogR - r) * f, g + (fogG - g) * f, b + (fogB - b) * f);
  }

  // ---------- Ciel ----------
  function sky(N, tm) {
    var w = N.w, dim = 1 - 0.45 * w.cloud, fl = N.flash * 100, y, i;
    var zr = (3 + 40 * dawn) * dim, zg = (5 + 58 * dawn) * dim, zb = (13 + 90 * dawn) * dim, hr = (13 + 150 * dawn) * dim, hg = (21 + 100 * dawn) * dim, hb = (38 + 80 * dawn) * dim;
    for (y = 0; y < Math.min(RH, hz + 1); y++) {
      var e = clamp((hz - y) / K * 1.3), f = w.fog * (0.95 - 0.4 * e), r = hr + (zr - hr) * e, g = hg + (zg - hg) * e, b = hb + (zb - hb) * e;
      px.fill(pack(r + (fogR - r) * f + fl, g + (fogG - g) * f + fl, b + (fogB - b) * f + fl * 1.1), y * RW, y * RW + RW);
    }
    var clear = clamp(1 - w.cloud * 1.3) * (1 - w.fog) * (1 - dawn);
    if (clear > 0.03) for (i = 0; i < stars.length; i++) {
      var s = stars[i], rel = P.angdiff(s.a, yaw);
      if (Math.abs(rel) > 1.2) continue;
      var sx = Math.round(RW / 2 + K * Math.tan(rel)), sy = Math.round(hz - K * Math.tan(s.e) / Math.cos(rel));
      if (sx < 0 || sx >= RW || sy < 0 || sy >= hz || sy >= RH) continue;
      var v = s.b * clear * (0.8 + 0.2 * Math.sin(tm * 3 + i));
      add(sy * RW + sx, v, v, v * 1.05);
    }
    // La lune, plus ou moins voilée
    var mrel = P.angdiff(N.moon, yaw), mv = clamp(1 - w.cloud * 0.9) * (1 - w.fog * 0.9);
    if (Math.abs(mrel) < 1.2 && mv > 0.05) {
      var mx = Math.round(RW / 2 + K * Math.tan(mrel)), my = Math.round(hz - K * 0.5 / Math.cos(mrel));
      for (y = -9; y <= 9; y++) for (var x = -9; x <= 9; x++) {
        var d2 = x * x + y * y, X = mx + x, Y = my + y;
        if (d2 > 81 || X < 0 || X >= RW || Y < 0 || Y >= RH || Y >= hz) continue;
        if (d2 <= 36) { if ((x - 3) * (x - 3) + y * y > 30) add(Y * RW + X, 225 * mv, 225 * mv, 205 * mv); } else add(Y * RW + X, 14 * mv, 16 * mv, 18 * mv);
      }
    }
    for (x = 0; x < RW; x++) { var q = P.angdiff(yaw + colAz[x], N.moon) / 0.16; glint[x] = Math.exp(-q * q) * mv; }
    // Éclair
    if (N.flash > 0.55 && N.bolt) {
      var brel = P.angdiff(N.bolt.a, yaw);
      if (Math.abs(brel) < 1.2) { var bx = RW / 2 + K * Math.tan(brel); for (y = 0; y < hz && y < RH; y++) { bx += (hash(y, N.bolt.k) - 0.5) * 5; var X2 = Math.round(bx); if (X2 >= 1 && X2 < RW - 1) { px[y * RW + X2] = 0xffffffff; add(y * RW + X2 - 1, 90, 90, 120); add(y * RW + X2 + 1, 90, 90, 120); } } }
    }
  }

  // ---------- Mer : chaque point de l'eau sait s'il est dans le faisceau ----------
  function sea(N, tm, rg) {
    var w = N.w, bx = Math.cos(N.beamA), by = Math.sin(N.beamA), hw = N.manual ? 0.9975 : 0.994, rg2 = rg * rg, sw = 0.6 + w.wind, fl = N.flash * 45;
    var sr = 4 + 30 * dawn, sg = 11 + 46 * dawn, sb = 21 + 62 * dawn, x, y;
    for (y = Math.max(0, hz + 1); y < RH; y++) {
      var dist = alt * K / (y - hz), fk = 1 - Math.exp(-dist * fogK), amp = sw / (1 + dist * 0.006), o = y * RW;
      var wx = ex + dist * (dx - plx), wy = ey + dist * (dy - ply), stx = dist * 2 * plx / RW, sty = dist * 2 * ply / RW;
      for (x = 0; x < RW; x++, wx += stx, wy += sty) {
        var n = Math.sin(wx * 0.11 + tm * 1.1 + Math.sin(wy * 0.07 + tm * 0.5) * 1.7) * Math.sin(wy * 0.13 - tm * 0.8 + wx * 0.03);
        var r = sr + n * amp * 7 + fl, g = sg + n * amp * 11 + fl, b = sb + n * amp * 15 + fl, d2 = wx * wx + wy * wy;
        if (n > 0.3 && glint[x] > 0.02) { var gl = glint[x] * (n - 0.3) * 240 * (0.35 + amp); r += gl; g += gl; b += gl * 0.9; }
        if (d2 < 620) {
          // L'îlot qui porte la tour, frangé d'écume
          if (d2 > 500) { r = g = b = 105 + n * 40; } else { r = 26 + n * 6; g = 27 + n * 6; b = 30 + n * 6; }
        } else if (d2 < rg2) {
          var dd = Math.sqrt(d2), cs = (wx * bx + wy * by) / dd;
          if (cs > hw) { var li = (cs - hw) / (1 - hw) * (1 - dd / rg) * (0.55 + 0.45 * n); r += li * 200; g += li * 185; b += li * 125; }
        }
        px[o + x] = pack(r + (fogR - r) * fk, g + (fogG - g) * fk, b + (fogB - b) * fk);
      }
    }
  }

  // ---------- Lointain : la côte et les feux du port ----------
  function coast(N, tm) {
    var port = N.sea.port, fk = 1 - Math.exp(-1000 * fogK), base = hz + alt * K / 1000, x, y, i;
    if (fk > 0.985) return;
    for (x = 0; x < RW; x++) {
      var az = yaw + colAz[x], rel = P.angdiff(az, port.a);
      if (Math.abs(rel) > 0.9) continue;
      var hgt = (12 + 16 * (0.5 + 0.5 * Math.sin(az * 9) * Math.sin(az * 23 + 1))) * (1 - rel * rel / 0.81) * K / 1000;
      for (y = Math.max(0, Math.round(base - hgt)); y <= Math.min(RH - 1, Math.round(base)); y++) px[y * RW + x] = pack(5 + (fogR - 5) * fk, 7 + (fogG - 7) * fk, 9 + (fogB - 9) * fk);
    }
    for (i = -5; i <= 5; i++) {
      var p = proj(port.x - Math.sin(port.a) * i * 16, port.y + Math.cos(port.a) * i * 16, 3 + (i * 7 + 35) % 6);
      if (!p) continue;
      var tw = 0.75 + 0.25 * Math.sin(tm * 2 + i * 1.7);
      if (Math.abs(i) === 5) dot(p.x, p.y, i < 0 ? 255 : 40, i < 0 ? 40 : 255, 60, fk * 0.5); else dot(p.x, p.y, 255 * tw, 200 * tw, 120 * tw, fk * 0.6);
    }
  }

  // ---------- Le faisceau dans l'air, vu depuis la lanterne ----------
  function shaft(N, rg) {
    var bx = Math.cos(N.beamA), by = Math.sin(N.beamA), str = 0.1 + N.w.fog * 0.45 + N.w.rain * 0.2;
    for (var x = 0; x < RW; x++) {
      var cam = 2 * x / RW - 1, vx = dx + plx * cam, vy = dy + ply * cam, den = vx * by - vy * bx;
      if (Math.abs(den) < 1e-4) continue;
      var s = (ey * bx - ex * by) / den, u = (ey * vx - ex * vy) / den;
      if (s < 0.3 || u < 0.5 || u > rg) continue;
      var th = Math.min(70, (0.22 + u * 0.03) * K / s), it = str * 255 / (1 + u * 0.012), ya = Math.max(0, Math.floor(hz - th)), yb = Math.min(RH - 1, Math.ceil(hz + th));
      for (var y = ya; y <= yb; y++) { var q = 1 - Math.abs(y - hz) / th; if (q > 0) { q *= q * it; add(y * RW + x, q, q * 0.92, q * 0.7); } }
    }
  }

  // ---------- Navires et récifs ----------
  function blit(sp, cx, by, w, h, flip, shade, fk, side, lights) {
    var x0 = Math.round(cx - w / 2), y0 = Math.round(by) - h, xa = Math.max(0, x0), xb = Math.min(RW, x0 + w), ya = Math.max(0, y0), yb = Math.min(RH, y0 + h);
    for (var y = ya; y < yb; y++) {
      var v = ((y - y0) * sp.h / h) | 0;
      for (var x = xa; x < xb; x++) {
        var u = ((x - x0) * sp.w / w) | 0, i = v * sp.w + (flip ? sp.w - 1 - u : u), f = sp.f[i];
        if (!f) continue;
        var c = sp.c[i], r = c & 255, g = c >> 8 & 255, b = c >> 16 & 255, k = fk;
        if (f === 2 && lights) { if (r > 200 && g < 80 && b > 200) { r = side[0]; g = side[1]; b = side[2]; } k = fk * 0.55; }
        else if (f === 2) { r = g = b = 12; }
        else { r *= shade; g *= shade; b *= shade; }
        px[y * RW + x] = pack(r + (fogR - r) * k, g + (fogG - g) * k, b + (fogB - b) * k);
      }
    }
  }
  function sprites(N) {
    var list = [], amb = 0.2 + 0.3 * glintAmb + dawn * 0.8 + N.flash * 1.5, i, best = 1e9;
    R.aim = null;
    N.sea.reefs.forEach(function (q) { q.rocks.forEach(function (k) { var p = proj(k.x, k.y, 0); if (p) list.push({ p: p, rock: k }); }); });
    N.ships.forEach(function (s) { var p = proj(s.x, s.y, 0); if (p) list.push({ p: p, ship: s }); });
    list.sort(function (a, b) { return b.p.d - a.p.d; });
    for (i = 0; i < list.length; i++) {
      var it = list[i], p = it.p, fk = 1 - Math.exp(-p.d * fogK);
      if (fk > 0.985) continue;
      if (it.rock) { blit(SP.rock[it.rock.v], p.x, p.y + 1, Math.max(1, Math.round(it.rock.s * 1.3 * K / p.d)), Math.max(1, Math.round(it.rock.s * K / p.d)), false, amb * 1.4, fk, null, false); continue; }
      var s = it.ship, len = LEN[s.kind], lx = s.x - ex, ly = s.y - ey, ll = Math.hypot(lx, ly), across = Math.abs(s.hx * ly - s.hy * lx) / ll, right = -dy * s.hx + dx * s.hy > 0;
      var w = Math.max(1, Math.round(len * K / p.d * Math.max(0.3, across))), h = Math.max(1, Math.round(len * 0.5 * K / p.d)), sunk = s.state === 'naufrage';
      blit(SP.ship[s.kind], p.x, p.y + (sunk ? h * Math.min(0.85, 0.2 + s.gone / 18) : 0), w, h, !right, amb + s.lit * 1.6, fk, right ? [60, 255, 90] : [255, 50, 40], !sunk);
      if (!sunk && w < 16) dot(p.x, p.y - h, 255, 246, 216, fk * 0.55);
      // Navire sous le réticule : le gardien le reconnaît
      var off = Math.abs(p.x - RW / 2);
      if (off < Math.max(8, w / 2 + 4) && Math.abs(p.y - h / 2 - RH / 2) < Math.max(10, h / 2 + 6) && off < best) { best = off; R.aim = s; }
    }
  }
  var glintAmb = 0;

  function rain(N) {
    var w = N.w, n = Math.round(w.rain * 260), slant = 2 + w.wind * 6;
    for (var i = 0; i < n; i++) {
      var x = Math.random() * (RW + 40) - 20, y = Math.random() * RH, l = 5 + Math.random() * 6;
      for (var k = 0; k < l; k++) { var X = Math.round(x - k * slant / l), Y = Math.round(y + k); if (X >= 0 && X < RW && Y >= 0 && Y < RH) add(Y * RW + X, 38, 44, 52); }
    }
  }

  // ---------- La tour ----------
  var HK = new Uint8Array(16), HD = new Float32Array(16), HS = new Uint8Array(16), HX = new Uint8Array(16), HY = new Uint8Array(16), HO = new Uint8Array(16), HN = new Float32Array(16);
  function tower(N, S, pl) {
    var lv = pl.level, cells = LV[lv], x, y, i, o, c;
    var bx = Math.cos(N.beamA), by = Math.sin(N.beamA), el = Math.hypot(ex, ey) || 1, toMe = (ex * bx + ey * by) / el, pulse = N.lit && lv === 2 ? Math.pow(Math.max(0, toMe), 6) : 0, fl = N.flash * 0.7;
    // Lumière du dedans (lampe, ou feu qui balaie la lanterne) et lumière du dehors (nuit, aube, éclairs)
    var ir, ig, ib, or = 0.14 + pulse * 0.5 + dawn * 0.6 + fl, og = 0.18 + pulse * 0.46 + dawn * 0.55 + fl, ob = 0.26 + pulse * 0.34 + dawn * 0.55 + fl;
    if (lv === 2) { ir = N.lit ? 0.5 + 0.5 * pulse : 0.13; ig = N.lit ? 0.46 + 0.5 * pulse : 0.16; ib = N.lit ? 0.34 + 0.44 * pulse : 0.22; }
    else { ir = N.power ? 1 : 0.13; ig = N.power ? 0.9 : 0.16; ib = N.power ? 0.7 : 0.22; }
    ir += fl * 0.5 + dawn * 0.3; ig += fl * 0.5 + dawn * 0.3; ib += fl * 0.6 + dawn * 0.3;
    var floorT = lv === 0 ? T.flag : lv === 1 ? T.wood : T.iron, ceilT = lv === 2 ? T.dome : T.beam;

    for (y = 0; y < RH; y++) {
      var dyp = y - hz;
      if (!dyp) continue;
      var below = dyp > 0, rd = 0.5 * K / Math.abs(dyp);
      if (rd > 13) continue;
      var fx = pl.x + rd * (dx - plx), fy = pl.y + rd * (dy - ply), sx = rd * 2 * plx / RW, sy = rd * 2 * ply / RW, fall = 1 / (1 + rd * rd * 0.04);
      o = y * RW;
      for (x = 0; x < RW; x++, fx += sx, fy += sy) {
        if (fx < 0 || fy < 0 || fx >= GS || fy >= GS) continue;
        var cx = fx | 0, cy = fy | 0, kc = cells[cy * GS + cx], tex = below ? (kc === 32 ? floorT : kc === 46 ? T.grate : null) : kc === 32 ? ceilT : null;
        if (!tex) continue;
        i = (((fy - cy) * TS) | 0) * TS + (((fx - cx) * TS) | 0);
        if (!tex.f[i]) continue;
        c = tex.c[i];
        if (kc === 46) px[o + x] = pack((c & 255) * or * fall, (c >> 8 & 255) * og * fall, (c >> 16 & 255) * ob * fall);
        else px[o + x] = pack((c & 255) * ir * fall, (c >> 8 & 255) * ig * fall, (c >> 16 & 255) * ib * fall);
      }
    }

    for (x = 0; x < RW; x++) {
      var cam = 2 * x / RW - 1, rx = dx + plx * cam, ry = dy + ply * cam, mx = pl.x | 0, my = pl.y | 0, ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
      var stx = rx < 0 ? -1 : 1, sty = ry < 0 ? -1 : 1, sdx = (rx < 0 ? pl.x - mx : mx + 1 - pl.x) * ddx, sdy = (ry < 0 ? pl.y - my : my + 1 - pl.y) * ddy;
      var n = 0, side = 0, d = 0, prev = cells[my * GS + mx];
      while (n < 16) {
        if (sdx < sdy) { d = sdx; sdx += ddx; mx += stx; side = 0; } else { d = sdy; sdy += ddy; my += sty; side = 1; }
        if (mx < 0 || my < 0 || mx >= GS || my >= GS) break;
        var k = cells[my * GS + mx];
        if (k === 32 || k === 46 || k === 126) { prev = k; continue; }
        // Face tournée vers le faisceau : sert à faire briller la lentille de ce côté-là
        HK[n] = k; HD[n] = d; HS[n] = side; HX[n] = mx; HY[n] = my; HO[n] = prev !== 32 ? 1 : 0; HN[n] = side ? -sty * by : -stx * bx; n++;
        if (k !== 87 && k !== 71 && k !== 82) break;
        prev = k;
      }
      while (n--) {
        k = HK[n]; d = HD[n]; side = HS[n];
        var ch = String.fromCharCode(k), tx = ch === 'f' && !N.fuse ? T.fKO : ch === 'h' && N.horn ? T.hOn : T[ch];
        var h = K / d, top = hz - h / 2, ya = Math.max(0, Math.floor(top)), yb = Math.min(RH, Math.ceil(top + h)), wx = side ? pl.x + d * rx : pl.y + d * ry;
        var u = ((wx - Math.floor(wx)) * TS) | 0, st = TS / h, tp = (ya - top) * st, sh = (side ? 0.82 : 1) / (1 + d * d * 0.03);
        var lr = (HO[n] ? or : ir) * sh, lg = (HO[n] ? og : ig) * sh, lb = (HO[n] ? ob : ib) * sh;
        var em = k === 76 ? (N.lit ? 0.3 + 0.7 * Math.pow(Math.max(0, HN[n]), 3) : 0.07) : k === 114 || k === 103 || k === 104 ? (N.power ? 1 : 0.06) : 1;
        var dirt = k === 71 ? N.glass[P.paneAt(HX[n], HY[n])] : 0;
        for (y = ya; y < yb; y++, tp += st) {
          i = (tp > 63 ? 63 : tp | 0) * TS + u;
          var f = tx.f[i];
          if (!f) continue;
          c = tx.c[i]; o = y * RW + x;
          if (f === 1) px[o] = pack((c & 255) * lr, (c >> 8 & 255) * lg, (c >> 16 & 255) * lb);
          else if (f === 2) px[o] = pack((c & 255) * em, (c >> 8 & 255) * em, (c >> 16 & 255) * em);
          else {
            // Verre : un voile, plus épais et tacheté quand le sel s'y dépose
            var a = 0.05 + dirt * (0.5 + 0.3 * hash(i >> 1, 9)), bg = px[o];
            px[o] = pack((bg & 255) + (190 * lr + 20 - (bg & 255)) * a, (bg >> 8 & 255) + (200 * lg + 22 - (bg >> 8 & 255)) * a, (bg >> 16 & 255) + (205 * lb + 26 - (bg >> 16 & 255)) * a);
          }
        }
      }
    }
  }

  R.frame = function (N, S, pl, tm) {
    var w = N.w, fl = N.flash * 90;
    yaw = pl.a; dx = Math.cos(yaw); dy = Math.sin(yaw); plx = -dy * PL; ply = dx * PL; hz = (RH >> 1) + Math.round(pl.pitch);
    ex = pl.x - 5.5; ey = pl.y - 5.5; alt = P.ALT[pl.level]; dawn = clamp((N.t - 0.86) / 0.14);
    fogR = 26 + 95 * dawn + fl; fogG = 32 + 88 * dawn + fl; fogB = 38 + 86 * dawn + fl; fogK = 0.0003 + w.fog * 0.007 + w.rain * 0.0012;
    var rg = P.range(N, S, N.beamA, N.manual);
    sky(N, tm);
    glintAmb = clamp(1 - w.cloud) * (1 - w.fog);
    sea(N, tm, rg);
    coast(N, tm);
    if (pl.level === 2 && rg > 0) shaft(N, rg);
    sprites(N);
    if (w.rain > 0.02) rain(N);
    tower(N, S, pl);
    ctx.putImageData(frame, 0, 0);
  };
})();
