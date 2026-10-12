(function () {
  'use strict';

  var A = window.Atelier;

  // ---------- Palettes ----------
  var PALETTES = [
    { nom: 'DawnBringer 32', hex: '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30' },
    { nom: 'Endesga 32', hex: 'be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569' },
    { nom: 'PICO-8', hex: '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa' },
    { nom: 'Sweetie 16', hex: '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57' },
    { nom: 'Game Boy', hex: '0f380f 306230 8bac0f 9bbc0f' },
    { nom: 'Gris (8 niveaux)', hex: '000000 242424 494949 6d6d6d 929292 b6b6b6 dbdbdb ffffff' }
  ];

  A.PALETTES = PALETTES.map(function (p) {
    return { nom: p.nom, couleurs: p.hex.split(' ').map(A.hexDepuis) };
  });
  A.palette = A.PALETTES[0].couleurs.slice();

  // ---------- Sprite d'exemple ----------
  // Une gelée qui saute : quatre calques, huit images.
  var POSES = [
    // largeur, hauteur, altitude, durée, yeux fermés
    [20, 13, 0, 220, 0], [24, 9, 0, 110, 1], [16, 17, 3, 80, 0], [18, 15, 9, 80, 0],
    [20, 13, 12, 110, 0], [18, 15, 7, 80, 0], [25, 8, 0, 90, 1], [22, 11, 0, 110, 0]
  ];

  A.exemple = function () {
    var W = 32, H = 32, SOL = 27, CX = 16;
    var c = function (h) { return A.hexDepuis(h); };
    var trait = c('#222034'), vert = c('#6abe30'), clair = c('#99e550'), sombre = c('#37946e'), blanc = c('#ffffff');
    var terre = c('#663931'), herbe = c('#4b692f'), herbe2 = c('#6abe30'), ciel = c('#5fcde4'), nuage = c('#cbdbfc');

    A.docNouveau(W, H);
    var d = A.doc, n = W * H;
    d.calques = [];
    ['Décor', 'Ombre', 'Gelée', 'Visage'].forEach(function (nom, i) {
      d.calques.push({ id: 9000 + i, nom: nom, visible: true, opacite: i === 1 ? 0.45 : 1, verrou: false });
    });
    var ids = d.calques.map(function (cal) { return cal.id; });

    var decor = new Uint32Array(n), x, y;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (y >= SOL + 1) decor[y * W + x] = (x * 7 + y * 13) % 11 === 0 ? c('#8f563b') : terre;
        else if (y === SOL) decor[y * W + x] = (x * 5) % 7 < 2 ? herbe2 : herbe;
        else decor[y * W + x] = ciel;
      }
    }
    [[4, 5, 7], [5, 4, 4], [22, 8, 6], [23, 7, 3]].forEach(function (nu) {
      for (x = 0; x < nu[2]; x++) decor[nu[1] * W + nu[0] + x] = nuage;
    });
    [3, 9, 21, 28].forEach(function (hx) { decor[(SOL - 1) * W + hx] = herbe; });

    d.images = POSES.map(function (p) {
      var lw = p[0], lh = p[1], base = SOL - p[2], rx = lw / 2, corps = new Uint32Array(n), visage = new Uint32Array(n), ombre = new Uint32Array(n);
      function dedans(px, py) {
        if (py >= base) return false;
        var u = (px + 0.5 - CX) / rx, v = (py + 0.5 - base) / lh;
        return u * u + v * v <= 1;
      }
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          if (!dedans(x, y)) continue;
          var bord = !dedans(x - 1, y) || !dedans(x + 1, y) || !dedans(x, y - 1) || !dedans(x, y + 1);
          var u = (x + 0.5 - CX) / rx, v = (y + 0.5 - base) / lh;
          corps[y * W + x] = bord ? trait : (v > -0.2 || u > 0.62) ? sombre : (u < -0.15 && v < -0.55) ? clair : vert;
        }
      }
      // Reflet et yeux, placés en proportion de la pose.
      var yy = Math.round(base - lh * 0.5), ry = Math.round(base - lh * 0.78);
      visage[ry * W + CX - Math.round(rx * 0.45)] = blanc;
      visage[ry * W + CX - Math.round(rx * 0.45) + 1] = blanc;
      [-3, 3].forEach(function (dx) {
        visage[yy * W + CX + dx] = trait;
        if (!p[4]) visage[(yy - 1) * W + CX + dx] = trait;
        else visage[yy * W + CX + dx + (dx < 0 ? -1 : 1)] = trait;
      });
      var ro = Math.max(3, Math.round(rx - p[2] * 0.5));
      for (x = CX - ro; x < CX + ro; x++) {
        ombre[SOL * W + x] = trait;
        if (x > CX - ro + 1 && x < CX + ro - 2) ombre[(SOL + 1) * W + x] = trait;
      }
      var cels = {};
      cels[ids[0]] = decor; cels[ids[1]] = ombre; cels[ids[2]] = corps; cels[ids[3]] = visage;
      return { id: 9100 + POSES.indexOf(p), duree: p[3], cels: cels };
    });
    d.iCalque = 2;
    A.palette = A.PALETTES[0].couleurs.slice();
    // Passe par le format de projet : identifiants renumérotés, historique remis à zéro.
    A.depuisProjet(A.versProjet());
  };
})();
