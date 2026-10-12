// Les couloirs oublient : rendu. Sol et plafond ligne par ligne, un rayon par colonne, puis créatures et objets.
// La même routine dessine la vue principale et le miroir de poche, qui regarde dans le dos.
(function () {
  'use strict';

  var C = window.Couloirs, G = C.G, TS = 64, FAR = 22, RW = 480, RH = 270, MW = 120, MH = 68;
  var main, mirror, cone = new Float32Array(RW * RH);

  // ---------- Textures dessinées au lancement ----------
  function texture(fn) {
    var t = new Uint8Array(TS * TS * 3);
    for (var y = 0; y < TS; y++) for (var x = 0; x < TS; x++) { var c = fn(x, y), o = (y * TS + x) * 3; t[o] = c[0]; t[o + 1] = c[1]; t[o + 2] = c[2]; }
    return t;
  }
  var grain = function (x, y, k) { var n = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return n - Math.floor(n); };
  var paper = function (x, y) {
    var n = grain(x, y, 1) * 14 - 7, stripe = x % 16 < 2 ? -16 : 0, motif = (x % 16 + (y % 16 < 8 ? y % 16 : 15 - y % 16)) % 16 === 7 ? -12 : 0;
    var stain = grain(x >> 3, y >> 3, 5) > 0.88 ? -18 : 0;
    if (y > 57) return [96 + n, 78 + n, 38 + n];
    return [200 + n + stripe + motif + stain, 178 + n + stripe + motif + stain, 86 + n + stripe * 0.5 + stain];
  };
  var concrete = function (x, y) {
    var n = grain(x, y, 11) * 22 - 11 + (grain(x >> 2, y >> 2, 12) > 0.8 ? -14 : 0), v = 126 + n - (y % 32 === 0 || x === 0 ? 30 : 0);
    if (y > 34 && y < 44) return ((x + y) >> 3) & 1 ? [204 + n, 172 + n, 30] : [32, 32, 30];
    return [v, v, v + 4];
  };
  var tile = function (x, y) {
    var n = grain(x >> 3, y >> 3, 21) * 10, joint = x % 8 === 0 || y % 8 === 0;
    if (y >= 24 && y < 32) return joint ? [40, 90, 120] : [60 + n, 140 + n, 190 + n];
    return joint ? [150, 160, 160] : [224 + n, 230 + n, 226 + n];
  };
  var damask = function (x, y) {
    var n = grain(x, y, 31) * 12 - 6, d = Math.abs(x % 16 - 8) + Math.abs(y % 16 - 8);
    if (y > 44) return y === 45 ? [40, 24, 14] : [86 + n - (x % 16 < 1 ? 20 : 0), 52 + n, 30 + n];
    return d === 6 || d === 2 ? [176 + n, 140 + n, 60] : [122 + n, 28 + n * 0.5, 34 + n * 0.5];
  };
  // Mur repéré : deux bandes de ruban rouge en croix. Mur à note : un papier punaisé.
  var pinned = function (base) { return function (x, y) { var d1 = Math.abs(x - y), d2 = Math.abs(x + y - 63); return (d1 < 4 || d2 < 4) && y < 58 ? [170 + grain(x, y, 2) * 20, 34, 28] : base(x, y); }; };
  var noted = function (base) {
    return function (x, y) {
      if (x < 20 || x > 43 || y < 16 || y > 39) return base(x, y);
      if (x > 30 && x < 33 && y < 19) return [150, 30, 26];
      return y % 5 === 2 && x > 22 && x < 41 - grain(y, 1, 8) * 9 && y > 20 ? [70, 70, 96] : [228 - grain(x, y, 7) * 10, 222, 198];
    };
  };
  var set = function (wall, floor, ceil, lamp) { return { wall: texture(wall), pin: texture(pinned(wall)), note: texture(noted(wall)), floor: texture(floor), ceil: texture(ceil), lamp: lamp }; };
  var TEX = {
    bureaux: set(paper,
      function (x, y) { var n = grain(x, y, 4) * 26 - 13; return [142 + n, 120 + n, 62 + n * 0.6]; },
      function (x, y) { var n = grain(x, y, 6) * 10 - 5, line = x % 32 === 0 || y % 32 === 0 ? -34 : 0; return [206 + n + line, 198 + n + line, 158 + n + line]; }, [255, 250, 210]),
    parking: set(concrete,
      function (x, y) { var n = grain(x, y, 13) * 18; return x < 3 ? [186, 186, 166] : [50 + n, 50 + n, 54 + n]; },
      function (x, y) { var n = grain(x, y, 14) * 16 - 8, v = 108 + n - (y % 32 < 5 ? 34 : 0); return x > 19 && x < 25 ? [96, 62, 40] : [v, v, v + 3]; }, [214, 232, 255]),
    piscine: set(tile,
      function (x, y) { var n = grain(x >> 3, y >> 3, 22) * 14; return x % 8 === 0 || y % 8 === 0 ? [112, 150, 160] : [146 + n, 200 + n, 214 + n]; },
      function (x, y) { var n = grain(x, y, 23) * 8, line = x % 32 === 0 || y % 32 === 0 ? -30 : 0; return [214 + n + line, 222 + n + line, 220 + n + line]; }, [226, 255, 248]),
    hotel: set(damask,
      function (x, y) { var n = grain(x, y, 32) * 14, d = Math.abs(x % 32 - 16) + Math.abs(y % 32 - 16); return d % 8 < 2 ? [156 + n, 96 + n, 34] : [108 + n, 36 + n * 0.5, 30]; },
      function (x, y) { var n = grain(x, y, 33) * 8, line = x % 32 < 2 || y % 32 < 2 ? -40 : 0; return [214 + n + line, 202 + n + line, 176 + n + line]; }, [255, 214, 150])
  };
  var EXIT = texture(function (x, y) {
    if (y > 5 && y < 17 && x > 14 && x < 50) return (x + y) % 5 === 0 ? [20, 120, 60] : [60, 255, 120];
    if (x < 8 || x > 55 || y < 22) return [58, 56, 50];
    return [18 + grain(x, y, 3) * 8, 18, 20];
  });
  var DOOR = texture(function (x, y) {
    var n = grain(x, y, 41) * 12 - 6, frame = x < 6 || x > 57 || y < 4, inset = x > 13 && x < 50 && (y > 9 && y < 29 || y > 33 && y < 59);
    if (frame) return [52 + n, 30 + n, 18];
    if (x > 25 && x < 38 && y > 13 && y < 20) return [204, 172, 82];
    if (x > 47 && x < 53 && y > 33 && y < 39) return [222, 192, 92];
    return inset && !(x > 15 && x < 48 && (y > 11 && y < 27 || y > 35 && y < 57)) ? [70 + n, 42 + n, 22] : [124 + n, 76 + n, 40 + n];
  });

  // ---------- Silhouettes : u de -1 à 1, v de 0 (tête) à 1 (sol). Le quatrième nombre marque ce qui luit. ----------
  var INK = [8, 7, 9];
  var SHAPE = {
    // Trop haut, tête ronde, bras trop longs
    guet: { h: 1.12, w: 0.22, f: function (u, v) { return (v < 0.14 ? Math.hypot(u / 0.42, (v - 0.07) / 0.07) < 1 : v < 0.2 ? Math.abs(u) < 0.16 : Math.abs(u) < 0.52 - v * 0.22 || Math.abs(Math.abs(u) - 0.78) < 0.1 && v < 0.78) ? INK : null; } },
    // Pâle, étroit, sans visage
    aimant: { h: 1.0, w: 0.13, f: function (u, v) { return (v < 0.13 ? Math.hypot(u / 0.6, (v - 0.065) / 0.065) < 1 : v < 0.24 ? Math.abs(u) < 0.14 : Math.abs(u) < 0.42 + Math.sin(v * 9) * 0.06) ? [196 - v * 60, 192 - v * 60, 178 - v * 50] : null; } },
    // Basse, large, toute en oreilles
    ecoute: { h: 0.62, w: 0.34, f: function (u, v) { var a = Math.abs(u); return (v < 0.42 ? a > 0.3 && a < 0.3 + v * 1.5 && a < 0.95 : Math.hypot(u / 0.72, (v - 0.72) / 0.3) < 1 || a < 0.5 && v > 0.7) ? [38, 28, 22] : null; } },
    // Un corps noir sous un faux panneau de sortie
    mime: { h: 1.0, w: 0.2, f: function (u, v) { if (v < 0.2) return Math.abs(u) < 0.95 ? (v > 0.03 && v < 0.17 && Math.abs(u) < 0.85 ? [60, 255, 120, 1] : [40, 40, 36]) : null; return Math.abs(u) < 0.5 - v * 0.2 ? INK : null; } },
    // Deux ailes poudreuses qui battent
    phalene: { h: 0.7, w: 0.36, f: function (u, v) { var a = Math.abs(u), k = 0.6 + 0.4 * Math.sin(G.time * 17); return a < 0.1 && v > 0.2 && v < 0.75 ? [60, 56, 48] : v > 0.1 && v < 0.8 && a < k && a > Math.abs(v - 0.42) * 1.6 ? [150 - a * 60, 144 - a * 60, 128 - a * 50] : null; } },
    pile: { h: 0.16, w: 0.045, glow: 0.3, f: function (u, v) { return v < 0.12 ? (Math.abs(u) < 0.4 ? [190, 190, 180] : null) : v < 0.5 ? [226, 186, 40] : [30, 30, 30]; } },
    ruban: { h: 0.13, w: 0.065, glow: 0.3, f: function (u, v) { var d = Math.hypot(u, (v - 0.5) * 2); return d < 1 && d > 0.35 ? [176, 36, 30] : null; } },
    amande: { h: 0.24, w: 0.05, glow: 0.3, f: function (u, v) { return v < 0.3 ? (Math.abs(u) < 0.35 ? [200, 206, 210] : null) : v > 0.5 && v < 0.8 ? [80, 130, 190] : [232, 236, 232]; } },
    miroir: { h: 0.2, w: 0.1, glow: 0.45, f: function (u, v) { var d = Math.hypot(u, (v - 0.5) * 2); return d > 1 ? null : d > 0.8 ? [150, 120, 50] : [190 + u * 50, 214 + u * 30, 226]; } }
  };

  // ---------- Une vue : principale ou miroir ----------
  function View(canvas, w, h, isMain) {
    var ctx = canvas.getContext('2d'), frame = ctx.createImageData(w, h);
    return { ctx: ctx, frame: frame, px: new Uint32Array(frame.data.buffer), z: new Float32Array(w), w: w, h: h, main: isMain };
  }
  function view(V, a, pitch) {
    var px = V.px, W = V.w, H = V.h, zb = V.z, p = G.player, s = G.size, cell = G.cell, seen = G.seen, pin = G.pin, memo = G.memo, now = G.time, T = TEX[G.spec.theme];
    var dx = Math.cos(a), dy = Math.sin(a), plx = -dy * 0.66, ply = dx * 0.66, half = H >> 1, hz = half + Math.round(pitch * H / RH), near = G.near;
    var dark = !!G.spec.dark, beam = dark && p.lamp && V.main ? (p.battery < 0.12 && Math.sin(now * 40) > 0.3 ? 0.5 : 1.25) : 0;
    // Néons : ils vacillent, et de plus en plus quand quelque chose approche
    var flick = 0.94 + 0.06 * Math.sin(now * 23) * Math.sin(now * 3.1) - (near < 9 && Math.sin(now * 31) > 0.86 - (9 - near) * 0.05 ? 0.45 : 0);
    var floorT = T.floor, ceilT = T.ceil, lamp = T.lamp, x, y, o, sh, i;
    // Dans le noir : on devine ce qui est tout près et la masse des murs ; la lampe fait le reste
    var shade = function (d, wall) { return dark ? 0.5 / (1 + d * d * 0.9) + (wall ? 0.035 : 0.012) : flick / (1 + d * d * 0.02); };
    var lit = function (cam, d) { return !dark || d < 2.5 || beam > 0 && Math.abs(cam) < 0.8 && d < 11; };

    for (y = 0; y < H; y++) {
      var row = y * W, up = y < hz;
      if (y === hz) { px.fill(0xff000000, row, row + W); continue; }
      var dist = half / Math.abs(y - hz), base = shade(dist, false), far = beam / (1 + dist * dist * 0.03), tex = up ? ceilT : floorT;
      var sx = (2 * plx * dist) / W, sy = (2 * ply * dist) / W, fx = p.x + (dx - plx) * dist, fy = p.y + (dy - ply) * dist;
      for (x = 0; x < W; x++, fx += sx, fy += sy) {
        var cx = Math.floor(fx), cy = Math.floor(fy), u = fx - cx, v = fy - cy;
        o = (((v * TS) & 63) * TS + ((u * TS) & 63)) * 3;
        // Un néon toutes les trois cases : il éclaire le plafond et le sol sous lui
        var mx = fx - Math.floor(fx / 3) * 3 - 1.5, my = fy - Math.floor(fy / 3) * 3 - 1.5;
        sh = dark ? base + (beam ? cone[row + x] * far : 0) : base * Math.max(0.5, 1.05 - (mx * mx + my * my) * 0.24);
        if (up) {
          if (Math.abs(mx) < 0.34 && Math.abs(my) < 0.2) { var on = dark ? 0.1 + sh * 0.5 : flick; px[row + x] = 0xff000000 | (Math.min(255, lamp[2] * on) << 16) | (Math.min(255, lamp[1] * on) << 8) | Math.min(255, lamp[0] * on); continue; }
        } else if (cx > 0 && cy > 0 && cx < s && cy < s && pin[cy * s + cx] === 1 && (((u * 8) | 0) + ((v * 8) | 0)) % 4 === 0) { px[row + x] = 0xff000000 | ((30 * sh) << 16) | ((34 * sh) << 8) | Math.min(255, 170 * sh); continue; }
        px[row + x] = 0xff000000 | (Math.min(255, tex[o + 2] * sh) << 16) | (Math.min(255, tex[o + 1] * sh) << 8) | Math.min(255, tex[o] * sh);
      }
    }

    for (x = 0; x < W; x++) {
      var cam = 2 * x / W - 1, rx = dx + plx * cam, ry = dy + ply * cam;
      var mxi = Math.floor(p.x), myi = Math.floor(p.y), ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
      var stx = rx < 0 ? -1 : 1, sty = ry < 0 ? -1 : 1, sdx = (rx < 0 ? p.x - mxi : mxi + 1 - p.x) * ddx, sdy = (ry < 0 ? p.y - myi : myi + 1 - p.y) * ddy;
      var side = 0, hit = 0, d = 0, ci = 0;
      while (!hit && d < FAR) {
        if (sdx < sdy) { d = sdx; sdx += ddx; mxi += stx; side = 0; } else { d = sdy; sdy += ddy; myi += sty; side = 1; }
        if (mxi < 0 || myi < 0 || mxi >= s || myi >= s) break;
        ci = myi * s + mxi; hit = cell[ci];
        // Ce que la lampe n'éclaire pas n'est pas vu : ni retenu par les murs, ni porté sur le plan
        if (lit(cam, d)) { seen[ci] = now; memo[ci] = hit + 1; }
      }
      zb[x] = hit ? d : FAR;
      if (V.main && x === W >> 1) { G.look = hit ? ci : -1; G.lookD = d; }
      if (!hit) continue;
      var h = H / d, top = hz - h / 2, y0 = Math.max(0, Math.floor(top)), y1 = Math.min(H, Math.ceil(top + h));
      var wx = side ? p.x + d * rx : p.y + d * ry, wt = hit === 2 ? EXIT : hit === 3 ? DOOR : hit === 4 ? T.note : pin[ci] === 1 ? T.pin : T.wall;
      var tx = ((wx - Math.floor(wx)) * TS) & 63, step = TS / h, tp = (y0 - top) * step, k0 = (side ? 0.78 : 1) * shade(d, true), k1 = (side ? 0.78 : 1) * beam / (1 + d * d * 0.03);
      for (y = y0; y < y1; y++, tp += step) {
        o = ((tp > 63 ? 63 : tp | 0) * TS + tx) * 3;
        // Le panneau de la sortie luit dans le noir
        sh = hit === 2 && wt[o + 1] > 200 ? 1 : k0 + (beam ? cone[y * W + x] * k1 : 0);
        px[y * W + x] = 0xff000000 | (Math.min(255, wt[o + 2] * sh) << 16) | (Math.min(255, wt[o + 1] * sh) << 8) | Math.min(255, wt[o] * sh);
      }
    }

    // Créatures et objets, du plus loin au plus près, cachés par les murs
    var list = [], inv = 1 / (plx * dy - dx * ply);
    G.mobs.forEach(function (m) { if (m.on) list.push(m); });
    G.items.forEach(function (it) { list.push(it); });
    list.forEach(function (q) { var ox = q.x - p.x, oy = q.y - p.y; q.sx = inv * (dy * ox - dx * oy); q.sd = inv * (-ply * ox + plx * oy); });
    list.sort(function (a2, b2) { return b2.sd - a2.sd; });
    for (i = 0; i < list.length; i++) {
      var q = list[i], sp = SHAPE[q.kind], tY = q.sd;
      if (tY < 0.2 || tY > FAR) continue;
      var size = H / tY, scx = Math.floor(W / 2 * (1 + q.sx / tY)), wh = Math.max(1, size * sp.w), bottom = hz + size / 2, hh = size * sp.h, vis = false;
      var b0 = Math.max(sp.glow || 0, shade(tY, true)), b1 = beam / (1 + tY * tY * 0.03);
      for (x = Math.max(0, Math.floor(scx - wh)); x < Math.min(W, scx + wh); x++) {
        if (tY >= zb[x]) continue;
        vis = true;
        var uu = (x - scx) / wh;
        for (y = Math.max(0, Math.floor(bottom - hh)); y < Math.min(H, bottom); y++) {
          var c = sp.f(uu, (y - (bottom - hh)) / hh);
          if (!c) continue;
          sh = c[3] ? 1 : b0 + (beam ? cone[y * W + x] * b1 : 0);
          px[y * W + x] = 0xff000000 | (Math.min(255, c[2] * sh) << 16) | (Math.min(255, c[1] * sh) << 8) | Math.min(255, c[0] * sh);
        }
      }
      // Vu de face, ou seulement dans le miroir : les créatures font la différence
      if (vis && q.due !== undefined && lit(2 * scx / W - 1, tY)) { if (V.main) q.seen = true; else q.back = true; }
    }

    // Peur : l'image vire au rouge quand quelque chose est tout près
    if (V.main && (near < 5 || G.flash > 0)) {
      var red = Math.max(G.flash, (5 - near) / 5 * 0.5);
      for (o = 0; o < px.length; o++) { var c2 = px[o]; px[o] = 0xff000000 | (((c2 >> 16 & 255) * (1 - red)) << 16) | (((c2 >> 8 & 255) * (1 - red)) << 8) | Math.min(255, (c2 & 255) * (1 - red * 0.4) + 90 * red); }
    }
    V.ctx.putImageData(V.frame, 0, 0);
  }

  C.init = function (canvas, glass) {
    main = View(canvas, RW, RH, true); mirror = View(glass, MW, MH, false);
    // Le faisceau de la lampe : un rond au centre de l'écran, qui s'éteint vers les bords
    for (var y = 0; y < RH; y++) for (var x = 0; x < RW; x++) { var d = Math.hypot((x - RW / 2) / (RW * 0.36), (y - RH / 2) / (RH * 0.6)); cone[y * RW + x] = d < 0.55 ? 1 : Math.max(0, 1 - (d - 0.55) / 0.5); }
  };
  C.draw = function () {
    var p = G.player;
    G.mobs.forEach(function (m) { m.seen = false; m.back = false; });
    // Paupières closes : rien n'est vu, et ce qui n'avance que dans le noir en profite
    if (G.shut > 0) { main.px.fill(0xff000000); main.ctx.putImageData(main.frame, 0, 0); G.look = -1; return; }
    view(main, p.a, p.pitch + Math.sin(G.time * 9) * p.breath * 5);
    if (p.mirrorUp) view(mirror, p.a + Math.PI, 0);
  };
})();
