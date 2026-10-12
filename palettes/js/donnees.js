(function () {
  'use strict';

  var racine = typeof window !== 'undefined' ? window : globalThis;
  var P = racine.Palettes;

  // ---------- Palettes fournies ----------
  var FOURNIES = [
    { groupe: 'Pixel-art', nom: 'DawnBringer 32', hex: '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30' },
    { groupe: 'Pixel-art', nom: 'Endesga 32', hex: 'be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569' },
    { groupe: 'Pixel-art', nom: 'Sweetie 16', hex: '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57' },
    { groupe: 'Pixel-art', nom: 'Gris (8 niveaux)', hex: '000000 242424 494949 6d6d6d 929292 b6b6b6 dbdbdb ffffff' },
    { groupe: 'Machines', nom: 'PICO-8', hex: '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa' },
    { groupe: 'Machines', nom: 'Game Boy', hex: '0f380f 306230 8bac0f 9bbc0f' },
    { groupe: 'Machines', nom: 'NES', hex: '7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000 bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888 f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878 fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8' },
    { groupe: 'Machines', nom: 'CGA (16 couleurs)', hex: '000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff' },
    { groupe: 'Machines', nom: 'Commodore 64', hex: '000000 ffffff 68372b 70a4b2 6f3d86 588d43 352879 b8c76f 6f4f25 433900 9a6759 444444 6c6c6c 9ad284 6c5eb5 959595' },
    { groupe: 'Machines', nom: 'Vidéotex (8 couleurs)', hex: '000000 ff0000 00ff00 ffff00 0000ff ff00ff 00ffff ffffff' }
  ];
  P.FOURNIES = FOURNIES.map(function (p) { return { groupe: p.groupe, nom: p.nom, couleurs: p.hex.split(' ') }; });
  P.PALETTE_DEPART = 'Sweetie 16';

  // ---------- Image d'exemple ----------
  // Un lac de montagne au couchant, dessiné par calcul : des dégradés doux, donc des milliers de couleurs à réduire.
  function h1(x, s) {
    var h = (s | 0) ^ Math.imul(x | 0, 0x27d4eb2d);
    h = Math.imul(h ^ h >>> 15, 0x85ebca6b);
    h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function bruit(x, s) {
    var x0 = Math.floor(x), t = x - x0;
    t = t * t * (3 - 2 * t);
    return h1(x0, s) + (h1(x0 + 1, s) - h1(x0, s)) * t;
  }
  function mel(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  var CIEL = [[0, [22, 24, 66]], [0.38, [74, 52, 118]], [0.68, [196, 92, 122]], [0.88, [246, 158, 96]], [1, [255, 222, 150]]];

  P.paysage = function (w, h) {
    w = w || 240; h = h || 150;
    var data = new Uint8ClampedArray(w * h * 4), horizon = Math.round(h * 0.6), sx = w * 0.64, sy = horizon - h * 0.07, rs = h * 0.105, x, y, c, p, k, d, i;
    var pins = [];
    for (i = 0; i < 9; i++) pins.push({ x: (i < 5 ? i * 0.055 : 1 - (i - 5) * 0.06) * w + (h1(i, 7) - 0.5) * 6, h: h * (0.34 + h1(i, 3) * 0.3) * (i < 5 ? 1 - i * 0.13 : 1 - (i - 5) * 0.16) });

    function crete(px, base, amp, freq, s) {
      return base - amp * (bruit(px * freq, s) * 0.6 + bruit(px * freq * 2.7, s + 9) * 0.28 + bruit(px * freq * 7.1, s + 5) * 0.12);
    }
    function scene(px, py) {
      var t = Math.max(0, Math.min(1, py / horizon)), col, j, dist, lueur, haut;
      for (j = 1; j < CIEL.length; j++) if (t <= CIEL[j][0]) break;
      j = Math.min(j, CIEL.length - 1);
      col = mel(CIEL[j - 1][1], CIEL[j][1], (t - CIEL[j - 1][0]) / (CIEL[j][0] - CIEL[j - 1][0]));
      dist = Math.sqrt((px - sx) * (px - sx) + (py - sy) * (py - sy));
      lueur = Math.max(0, 1 - dist / (rs * 4.5));
      col = mel(col, [255, 214, 140], lueur * lueur * 0.7);
      if (dist < rs) col = mel([255, 246, 208], [255, 226, 150], dist / rs);
      else if (t < 0.45 && h1(Math.floor(px) * 131 + Math.floor(py), 21) > 0.992) col = mel(col, [235, 235, 255], 0.8);
      haut = crete(px / w, horizon * 0.98, horizon * 0.62, 3.1, 11);
      if (py > haut) col = mel([96, 72, 132], mel([196, 92, 122], [246, 158, 96], 0.4), 0.28 + 0.2 * (py - haut) / horizon);
      haut = crete(px / w + 3, horizon * 1.02, horizon * 0.42, 4.6, 23);
      if (py > haut) col = mel([52, 44, 96], [120, 70, 120], 0.25 * (py - haut) / horizon + (px / w) * 0.2);
      haut = crete(px / w + 7, horizon * 1.03, horizon * 0.2, 7.3, 31);
      if (py > haut) col = mel([24, 44, 58], [30, 62, 60], bruit(px * 0.31, 41));
      return col;
    }

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (y < horizon) c = scene(x + 0.5, y + 0.5);
        else {
          // Le lac : la scène en miroir, froissée par des rides, plus sombre et plus bleue en s'approchant.
          d = (y - horizon) / (h - horizon);
          k = Math.sin(y * 1.9 + bruit(y * 0.7, 51) * 6) * (1 + d * 5);
          c = scene(x + 0.5 + k, horizon - (y - horizon) * 1.25 - 0.5);
          c = mel(c, [18, 30, 70], 0.22 + d * 0.5);
          if (Math.abs(x - sx + k * 1.5) < rs * (0.5 + d * 0.9) && bruit(y * 1.7 + x * 0.05, 61) > 0.42) c = mel(c, [255, 226, 160], 0.55 * (1 - d * 0.7));
        }
        // Les sapins du premier plan.
        for (i = 0; i < pins.length; i++) {
          k = h - y;
          if (k < pins[i].h && Math.abs(x + 0.5 - pins[i].x) < (pins[i].h - k) * 0.17 * (0.72 + 0.28 * ((k * 0.28) % 1)) + 0.6) {
            c = x + 0.5 < pins[i].x - 0.5 && pins[i].x < w / 2 ? [26, 50, 52] : [12, 22, 32];
            if (x + 0.5 > pins[i].x && pins[i].x > w / 2) c = [34, 48, 62];
          }
        }
        p = (y * w + x) * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    }
    return { w: w, h: h, data: data };
  };
})();
