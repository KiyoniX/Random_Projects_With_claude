(function () {
  'use strict';

  var T = (typeof window !== 'undefined' ? window : globalThis).Textures, O = T.o;
  var TAU = O.TAU, mod = O.mod, borne = O.borne, frac = O.frac, h2 = O.h2, bruit = O.bruit, bruit3 = O.bruit3, fbm = O.fbm, voronoi = O.voronoi, biseau = O.biseau;

  var MOUSSE = { nom: 'Mousse', hex: ['21402a', '3a6b2f', '659a3e', '9cc85c'] };

  // ---------- Outils communs ----------
  function glisse(id, nom, def, min, max) { return { id: id, nom: nom, def: def, min: min === undefined ? 0 : min, max: max === undefined ? 1 : max }; }
  function choix(id, nom, options) { return { id: id, nom: nom, options: options, def: options[0][0] }; }

  // Coussins de mousse : sombres en bas à droite, clairs en haut à gauche. poids décale le seuil pixel par pixel.
  function mousse(c, rampe, quantite, graine, poids) {
    if (quantite <= 0) return;
    var n = c.n, f = Math.max(2, Math.round(4 * c.e)), m = new Float32Array(n * n), seuil = 0.8 - quantite * 0.3, x, y, p = 0, t;
    for (y = 0; y < n; y++) for (x = 0; x < n; x++, p++) m[p] = fbm(x / n, y / n, f, f, 3, graine) + (poids ? poids[p] : 0);
    for (y = 0, p = 0; y < n; y++) {
      for (x = 0; x < n; x++, p++) {
        if (m[p] <= seuil) continue;
        t = 1 + (m[c.i(x - 1, y - 1)] <= seuil ? 1 : 0) - (m[c.i(x + 1, y + 1)] <= seuil ? 1 : 0) + (m[p] > seuil + 0.1 ? 1 : 0);
        c.r[p] = rampe; c.v[p] = borne(t, 0, 3);
      }
    }
  }

  // Petit galet éclairé d'en haut à gauche, avec son ombre portée.
  function caillou(c, cx, cy, rx, ry, rampe, base, max) {
    var X = Math.ceil(rx), Y = Math.ceil(ry), a = rx + 0.35, b = ry + 0.35, dx, dy, l;
    function dedans(x, y) { return (x * x) / (a * a) + (y * y) / (b * b) <= 1; }
    for (dy = -Y; dy <= Y + 1; dy++) {
      for (dx = -X; dx <= X + 1; dx++) {
        if (dedans(dx, dy)) {
          l = -dx / a - dy / b;
          c.pose(cx + dx, cy + dy, rampe, borne(base + (l > 0.45 ? 1 : l < -0.55 ? -1 : 0), 0, max));
        } else if (dedans(dx - 1, dy - 1)) c.plus(cx + dx, cy + dy, -1);
      }
    }
  }

  O.glisse = glisse; O.choix = choix; O.mousse = mousse; O.caillou = caillou; O.MOUSSE = MOUSSE;

  // ---------- Herbe ----------
  T.matiere({
    id: 'herbe', nom: 'Herbe', anime: true,
    rampes: [
      { nom: 'Herbe', hex: ['1b3d2b', '2a5f33', '3f8a3a', '63b045', '9cd65a'] },
      { nom: 'Terre', hex: ['4a3122', '6e4a2c', '8f6a3c'] },
      { nom: 'Fleurs', hex: ['f4f0dc', 'f2c83c', 'e0709a'] }
    ],
    reglages: [glisse('touffes', 'Touffes claires et sombres', 0.4), glisse('brins', 'Densité des brins', 0.55), glisse('longueur', 'Longueur des brins', 0.4), glisse('terre', 'Terre apparente', 0), glisse('fleurs', 'Fleurs', 0.15), glisse('vent', 'Vent (animation)', 0.5)],
    dessiner: function (c) {
      var n = c.n, p = c.p, f = Math.max(2, Math.round(3 * c.e)), sol = new Uint8Array(n * n), x, y, i = 0, b, t, k, r, nb, brins = [], br, h, xx, ton, osc, seuil = 0.22 + p.terre * 0.36;
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          b = fbm(x / n, y / n, f, f, 2, c.g);
          t = fbm(x / n, y / n, f, f, 3, c.g + 50);
          if (p.terre > 0 && t < seuil) {
            sol[i] = 1;
            k = h2(x, y, c.g + 3);
            c.pose(x, y, 1, 1 + (k < 0.16 ? -1 : k > 0.86 ? 1 : 0));
          } else c.pose(x, y, 0, p.terre > 0 && t < seuil + 0.025 ? 0 : Math.round(borne(1.5 + (b - 0.5) * p.touffes * 5, 0.6, 2.4)));
        }
      }
      r = c.alea(1);
      nb = Math.round(p.brins * n * n / 8);
      for (k = 0; k < nb; k++) brins.push({ x: Math.floor(r() * n), y: Math.floor(r() * n), h: 2 + Math.floor(r() * (1.5 + p.longueur * 4 * c.e)), pen: Math.floor(r() * 3) - 1, ph: r(), clair: r() });
      brins.sort(function (a, z) { return a.y - z.y || a.x - z.x; });
      for (k = 0; k < brins.length; k++) {
        br = brins[k]; h = br.h;
        if (sol[c.i(br.x, br.y)] && br.clair > 0.12) continue;
        osc = p.vent > 0 ? Math.round(Math.sin(TAU * (c.phase + br.ph * 0.35 + br.x / n)) * p.vent * 1.3) : 0;
        if (br.clair < 0.6) c.plus(br.x + 1, br.y, -1);
        for (i = 0; i < h; i++) {
          t = i / (h - 1);
          xx = br.x + Math.round(br.pen * t * t * h / 3) + (t > 0.55 ? osc : 0);
          ton = i === 0 ? 1 : t < 0.6 ? 2 : (h >= 4 && br.clair > 0.6 && i === h - 1) ? 4 : 3;
          c.pose(xx, br.y - i, 0, ton);
        }
      }
      r = c.alea(2);
      nb = Math.round(p.fleurs * n * n / 70);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n); t = r() < 0.5 ? 0 : 2; b = r();
        if (sol[c.i(x, y)]) continue;
        if (n >= 32 && b < 0.55) {
          c.pose(x - 1, y, 2, t); c.pose(x + 1, y, 2, t); c.pose(x, y - 1, 2, t); c.pose(x, y + 1, 2, t);
          c.pose(x, y, 2, 1);
          c.pose(x + 1, y + 1, 0, 0);
        } else c.pose(x, y, 2, b < 0.8 ? t : 1);
      }
    }
  });

  // ---------- Terre ----------
  T.matiere({
    id: 'terre', nom: 'Terre',
    rampes: [
      { nom: 'Terre', hex: ['2b1c17', '46291e', '63402a', '825a38', 'a27a4e'] },
      { nom: 'Cailloux', hex: ['4e4a48', '7d7870', 'aaa594', 'd0ccba'] }
    ],
    reglages: [glisse('mottes', 'Taille des mottes', 0.5), glisse('relief', 'Relief des mottes', 0.5), glisse('cailloux', 'Cailloux', 0.3), glisse('humidite', 'Zones humides', 0.3), glisse('crevasses', 'Crevasses (sécheresse)', 0)],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = Math.max(2, Math.round(n / ((3.5 + p.mottes * 5) * c.e))), V = voronoi(n, K, K, 1, c.g), rad = n / K / 2;
      var K2 = Math.max(2, Math.round(n / (11 * c.e))), V2 = p.crevasses > 0 ? voronoi(n, K2, K2, 1, c.g + 40) : null, fente = new Uint8Array(n * n);
      var x, y, i = 0, k, t, l, r, nb, larg = 0.45 + p.crevasses * 0.9;
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          k = V.id[i];
          t = Math.round(1.6 + (h2(k, 1, c.g) - 0.5) * 1.7);
          if (fbm(x / n, y / n, 2, 2, 2, c.g + 7) < 0.3 + p.humidite * 0.28) t -= 1;
          if (h2(k, 2, c.g) < p.relief * 1.2) {
            l = (-V.dx[i] - V.dy[i]) / rad;
            if (l > 0.55) t += 1; else if (l < -0.6 || V.bord[i] < 0.6) t -= 1;
          }
          if (V2 && V2.bord[i] < larg) { fente[i] = 1; t = 0; }
          c.pose(x, y, 0, borne(t, 0, 4));
        }
      }
      if (V2) for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (!fente[c.i(x, y)] && fente[c.i(x - 1, y - 1)]) c.pose(x, y, 0, Math.min(4, c.v[c.i(x, y)] + 1));
      r = c.alea(1);
      nb = Math.round(n * n * 0.035);
      for (k = 0; k < nb; k++) c.plus(Math.floor(r() * n), Math.floor(r() * n), r() < 0.5 ? -1 : 1);
      nb = Math.round(p.cailloux * n * n / 55);
      for (k = 0; k < nb; k++) caillou(c, Math.floor(r() * n), Math.floor(r() * n), 0.5 + Math.floor(r() * (1 + 1.6 * c.e)) * 0.5, 0.5 + Math.floor(r() * (1 + 1.2 * c.e)) * 0.5, 1, 1 + Math.floor(r() * 2), 3);
    }
  });

  // ---------- Sable ----------
  T.matiere({
    id: 'sable', nom: 'Sable',
    rampes: [
      { nom: 'Sable', hex: ['a8804c', 'c9a162', 'dfc07e', 'efd89c', 'faecc0'] },
      { nom: 'Débris', hex: ['7a6a5a', 'c4b8a8', 'f6f2e6'] }
    ],
    reglages: [glisse('ondes', 'Rides du vent', 0.6), glisse('echelle', 'Écart entre les rides', 0.5), glisse('tortu', 'Sinuosité', 0.5), glisse('grains', 'Grains', 0.4), glisse('debris', 'Coquillages et cailloux', 0.2),
      choix('sens', 'Sens des rides', [['h', 'Horizontales'], ['d', 'En diagonale'], ['v', 'Verticales']])],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = Math.max(1, Math.round(n / ((6 + p.echelle * 8) * c.e))), Kd = Math.max(1, Math.round(K * 0.7));
      var kx = p.sens === 'h' ? 0 : p.sens === 'v' ? K : Kd, ky = p.sens === 'v' ? 0 : p.sens === 'h' ? K : Kd;
      var x, y, u, v, w, w2, ph, t, r, nb, k;
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++) {
          u = x / n; v = y / n;
          w = fbm(u, v, 2, 2, 2, c.g) * 2 - 1;
          w2 = fbm(u, v, 3, 3, 2, c.g + 9);
          ph = TAU * (kx * u + ky * v) + p.tortu * 5 * w;
          t = 2;
          if (p.ondes > 0 && w2 > 0.3) {
            if (Math.sin(ph) > 1 - 0.42 * p.ondes) t = 3;
            else if (Math.sin(ph - 1.25) > 1 - 0.5 * p.ondes) t = 1;
          }
          c.pose(x, y, 0, t);
        }
      }
      r = c.alea(1);
      nb = Math.round(p.grains * n * n / 11);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n); t = r();
        c.pose(x, y, 0, borne(c.v[c.i(x, y)] + (t < 0.5 ? -1 : 1), 1, t > 0.93 ? 4 : 3));
      }
      nb = Math.round(p.debris * n * n / 110);
      for (k = 0; k < nb; k++) caillou(c, Math.floor(r() * n), Math.floor(r() * n), 0.5 + Math.floor(r() * (1 + 1.3 * c.e)) * 0.5, 0.5 + Math.floor(r() * (1 + c.e)) * 0.5, 1, r() < 0.5 ? 1 : 0, 2);
    }
  });

  // ---------- Gravier ----------
  T.matiere({
    id: 'gravier', nom: 'Gravier',
    rampes: [
      { nom: 'Cailloux gris', hex: ['25252c', '45464f', '696b73', '90939a', 'b9bcc0'] },
      { nom: 'Cailloux bruns', hex: ['3a2c24', '66503c', '917658', 'b89c78'] },
      { nom: 'Fond', hex: ['181514', '2c2723'] }
    ],
    reglages: [glisse('taille', 'Taille des cailloux', 0.4), glisse('variete', 'Cailloux bruns', 0.35), glisse('relief', 'Relief', 0.6), glisse('espace', 'Espacement', 0.3)],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = Math.max(2, Math.round(n / Math.max(4.2, (3.2 + p.taille * 6) * c.e))), V = voronoi(n, K, K, 1, c.g), rad = n / K / 2;
      var j = (0.3 + p.espace * 1.1) * Math.min(1, c.e), cel = new Int32Array(n * n), x, y, i, k, ra, base, l;
      for (i = 0; i < n * n; i++) cel[i] = V.bord[i] < j || (rad > 2.4 && V.bord[i] < j + 0.8 && V.bord2[i] < j + 0.8) ? -1 : V.id[i];
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          k = cel[i];
          if (k < 0) { c.pose(x, y, 2, cel[c.i(x - 1, y - 1)] >= 0 || cel[c.i(x, y - 1)] >= 0 ? 0 : 1); continue; }
          ra = h2(k, 1, c.g) < p.variete ? 1 : 0;
          base = 1 + Math.floor(h2(k, 2, c.g) * (ra ? 1.999 : 2.999));
          l = (-V.dx[i] - V.dy[i]) / rad;
          c.pose(x, y, ra, borne(base + Math.round(borne(l * p.relief * 1.7, -1, 1)), 0, ra ? 3 : 4));
        }
      }
    }
  });

  // ---------- Pierre brute ----------
  T.matiere({
    id: 'pierre', nom: 'Pierre brute',
    rampes: [{ nom: 'Roche', hex: ['1f1d27', '37363f', '54545e', '767880', '9da1a4', 'c6caca'] }, MOUSSE],
    reglages: [glisse('echelle', 'Taille des blocs', 0.5), glisse('rugosite', 'Rugosité', 0.5), glisse('fissures', 'Fissures', 0.5), glisse('strates', 'Strates', 0.3), glisse('mousse', 'Mousse', 0)],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = Math.max(2, Math.round(n / ((7 + p.echelle * 8) * c.e))), V = voronoi(n, K, K, 1, c.g), V2 = voronoi(n, K * 2, K * 2, 1, c.g + 5);
      var faille = new Uint8Array(n * n), poids = new Float32Array(n * n), sous = new Int32Array(n * n), bis, x, y, i, t, s, r, nb, k, larg = 0.45 + p.fissures * 0.75;
      for (i = 0; i < n * n; i++) sous[i] = V.id[i] * 4096 + V2.id[i];
      bis = biseau(sous, n);
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          t = 2.5 + (-(V.dx[i] - V2.dx[i]) - (V.dy[i] - V2.dy[i])) / (n / K) * 2.6 + (h2(V.id[i], 1, c.g) - 0.5) * 0.9 + (h2(V2.id[i], 2, c.g) - 0.5) * 1.6 * p.rugosite;
          s = fbm(x / n, y / n, 1, Math.max(2, Math.round(5 * c.e)), 2, c.g + 3);
          t = Math.round(t + (s - 0.5) * p.strates * 5);
          if (bis[i] > 0 && h2(sous[i], 3, c.g) < 0.15 + p.rugosite * 0.5) t += 1;
          else if (bis[i] < 0 && h2(sous[i], 4, c.g) < 0.15 + p.rugosite * 0.5) t -= 1;
          if (p.fissures > 0 && V.bord[i] < larg && fbm(x / n, y / n, 3, 3, 2, c.g + 11) < 0.34 + p.fissures * 0.22) { faille[i] = 1; poids[i] = 0.1; }
          c.pose(x, y, 0, borne(t, 1, 4));
        }
      }
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          if (faille[i]) c.pose(x, y, 0, 0);
          else if (faille[c.i(x - 1, y - 1)]) c.pose(x, y, 0, Math.min(5, c.v[i] + 1));
        }
      }
      r = c.alea(1);
      nb = Math.round(p.rugosite * n * n / 30);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n);
        if (!faille[c.i(x, y)]) c.pose(x, y, 0, borne(c.v[c.i(x, y)] + (r() < 0.5 ? -1 : 1), 1, 5));
      }
      mousse(c, 1, p.mousse, c.g + 21, poids);
    }
  });

  // ---------- Écorce ----------
  T.matiere({
    id: 'ecorce', nom: 'Écorce',
    rampes: [{ nom: 'Écorce', hex: ['1c130f', '33241b', '4f3a2a', '6e543c', '8d7254', 'ad9474'] }, MOUSSE],
    reglages: [glisse('echelle', 'Largeur des plaques', 0.5), glisse('allonge', 'Allongement', 0.6), glisse('sillons', 'Profondeur des sillons', 0.5), glisse('fibres', 'Fibres', 0.6), glisse('mousse', 'Mousse', 0)],
    dessiner: function (c) {
      var n = c.n, p = c.p, Kx = Math.max(2, Math.round(n / ((5 + p.echelle * 7) * c.e))), Ky = Math.max(2, Math.round(Kx / (1.6 + p.allonge * 2.6)));
      var V = voronoi(n, Kx, Ky, 0.75, c.g, { ax: 1, ay: Ky / Kx, quinconce: Kx % 2 === 0 }), j = 0.55 + p.sillons * 1.3 * c.e, poids = new Float32Array(n * n);
      var x, y, i = 0, k, t, fb, fc = Math.max(2, n / 2);
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          k = V.id[i];
          if (V.bord[i] < j) { c.pose(x, y, 0, V.bord[i] < j - 1.1 ? 0 : (V.dx[i] > 0 ? 0 : 1)); poids[i] = 0.1; continue; }
          t = 2 + Math.round(h2(k, 1, c.g) * 1.4);
          fb = bruit(x / 2 + h2(k, 2, c.g) * 40, y / n * 3, fc, 3, c.g + 8);
          if (fb > 1 - 0.42 * p.fibres) t -= 1; else if (fb < 0.32 * p.fibres) t += 1;
          if (V.bord[i] < j + 1.2) t += V.dx[i] < 0 ? 1 : -1;
          c.pose(x, y, 0, borne(t, 1, 5));
        }
      }
      mousse(c, 1, p.mousse, c.g + 21, poids);
    }
  });

  // ---------- Feuillage ----------
  T.matiere({
    id: 'feuillage', nom: 'Feuillage', anime: true,
    rampes: [
      { nom: 'Feuilles', hex: ['0f2a1c', '1a4424', '2a6630', '448c3a', '70b448', 'acd866'] },
      { nom: 'Baies', hex: ['7a1626', 'cf3838', 'f6a6a0'] }
    ],
    reglages: [glisse('taille', 'Taille des feuilles', 0.5), glisse('densite', 'Densité', 0.6), glisse('variete', 'Variété des tons', 0.5), glisse('nervures', 'Nervures', 0.5), glisse('baies', 'Baies', 0.15), glisse('vent', 'Frémissement (animation)', 0.4),
      choix('forme', 'Forme des feuilles', [['ovale', 'Ovales'], ['pointue', 'Lancéolées'], ['ronde', 'Rondes']])],
    dessiner: function (c) {
      var n = c.n, p = c.p, L = (5 + p.taille * 8) * c.e, larg = { ovale: 0.52, pointue: 0.34, ronde: 0.85 }[p.forme];
      var nb = Math.round(p.densite * 2.4 * n * n / (L * L * larg)), marque = new Int32Array(n * n), r = c.alea(1);
      var x, y, i, k, cx, cy, a, lon, lar, base, ca, sa, dx, dy, lg, tr, t, hw, cote, ton, R, liste, q, ph;
      for (y = 0, i = 0; y < n; y++) for (x = 0; x < n; x++, i++) c.pose(x, y, 0, fbm(x / n, y / n, 3, 3, 2, c.g) > 0.56 ? 1 : 0);
      for (k = 0; k < nb; k++) {
        cx = r() * n; cy = r() * n; a = r() * TAU; lon = L * (0.75 + 0.5 * r()); lar = lon * larg; ph = r();
        base = borne(1 + Math.round(k / nb * 1.7 + (r() - 0.5) * p.variete * 1.8), 1, 3);
        a += p.vent * 0.3 * Math.sin(TAU * (c.phase + ph));
        ca = Math.cos(a); sa = Math.sin(a);
        cote = (sa - ca) > 0 ? 1 : -1;      // le côté de la feuille tourné vers la lumière
        R = Math.ceil(lon / 2) + 1; liste = [];
        for (dy = -R; dy <= R; dy++) {
          for (dx = -R; dx <= R; dx++) {
            x = Math.floor(cx) + dx; y = Math.floor(cy) + dy;
            lg = (x + 0.5 - cx) * ca + (y + 0.5 - cy) * sa; tr = -(x + 0.5 - cx) * sa + (y + 0.5 - cy) * ca;
            t = lg / lon + 0.5;
            if (t < 0 || t > 1) continue;
            hw = lar / 2 * (p.forme === 'pointue' ? Math.sin(Math.PI * Math.pow(t, 0.7)) : p.forme === 'ronde' ? Math.sqrt(Math.sin(Math.PI * t)) : Math.pow(Math.sin(Math.PI * t), 0.75));
            if (Math.abs(tr) > hw) continue;
            ton = base;
            if (Math.abs(tr) < 0.55 && p.nervures > 0.25 && lon >= 6 && t < 0.85) ton = base - 1 + (p.nervures > 0.75 ? 2 : 0);
            else if (tr * cote > 0.5) ton = base + 1 + (t > 0.72 && lon >= 6 ? 1 : 0);
            else if (Math.abs(tr) > hw - 1 && lar >= 3) ton = base - 1;
            i = c.i(x, y);
            c.r[i] = 0; c.v[i] = borne(ton, 0, 5); marque[i] = k + 1;
            liste.push(x, y);
          }
        }
        // Ombre portée sur ce qui se trouve dessous.
        for (q = 0; q < liste.length; q += 2) {
          i = c.i(liste[q] + 1, liste[q + 1] + 1);
          if (marque[i] !== k + 1 && marque[i] !== -k - 1) { c.v[i] = Math.max(0, c.v[i] - 1); marque[i] = -k - 1; }
        }
      }
      r = c.alea(2);
      nb = Math.round(p.baies * n * n / 130);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n);
        if (n >= 32) { c.pose(x, y, 1, 2); c.pose(x + 1, y, 1, 1); c.pose(x, y + 1, 1, 1); c.pose(x + 1, y + 1, 1, 0); c.plus(x + 2, y + 2, -1); c.plus(x + 1, y + 2, -1); }
        else c.pose(x, y, 1, 1);
      }
    }
  });

  // ---------- Eau calme ----------
  T.matiere({
    id: 'eau', nom: 'Eau calme', anime: true,
    rampes: [{ nom: 'Eau', hex: ['14305a', '1c4c84', '2a6fae', '4f9bcc', '93cfe8', 'e2f5fa'] }],
    reglages: [glisse('vagues', 'Rangs de vaguelettes', 0.5), glisse('reflets', 'Nombre de reflets', 0.5), glisse('fond', 'Variations de fond', 0.5), glisse('agitation', 'Mouvement (animation)', 0.5), glisse('eclats', 'Éclats', 0.3)],
    dessiner: function (c) {
      var n = c.n, p = c.p, Ky = Math.max(2, Math.round(n / ((4 + (1 - p.vagues) * 5) * c.e))), nd = Math.max(1, Math.round(n / (10 * c.e) * (0.4 + 1.2 * p.reflets)));
      var x, y, i, b, rg, k, x0, y0, lon, ph, clair, dx, yy, r, nb, deja = new Uint8Array(n * n), ff = Math.max(3, Math.round(4 * c.e));
      var ox = 0.3 * p.agitation * Math.cos(TAU * c.phase), oy = 0.3 * p.agitation * Math.sin(TAU * c.phase);      // le fond dérive en rond : la boucle se referme
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++) {
          b = 0.65 * bruit(x / n * 2 + ox, y / n * ff + oy, 2, ff, c.g) + 0.35 * bruit(x / n * 4 - ox, y / n * ff * 2 + oy, 4, ff * 2, c.g + 40);
          c.pose(x, y, 0, Math.round(borne(1.5 + (b - 0.5) * 4 * p.fond, 0.6, 2.4)));
        }
      }
      // Chaque vaguelette est un tiret légèrement arqué qui glisse et respire au fil de la boucle.
      for (rg = 0; rg < Ky; rg++) {
        for (k = 0; k < nd; k++) {
          ph = h2(rg, k, c.g + 1); clair = h2(rg, k, c.g + 2);
          if (Math.sin(TAU * (c.phase + h2(rg, k, c.g + 3))) < -0.75) continue;
          x0 = Math.floor((k + h2(rg, k, c.g + 4)) * n / nd + (rg & 1) * n / nd / 2);
          y0 = Math.floor((rg + 0.2 + 0.6 * h2(rg, k, c.g + 5)) * n / Ky);
          lon = Math.max(2, Math.round((2.5 + 5 * h2(rg, k, c.g + 6)) * c.e * (0.8 + 0.25 * Math.sin(TAU * (c.phase + ph + 0.25)))));
          dx = Math.round(p.agitation * 2.2 * c.e * Math.sin(TAU * (c.phase + ph)));
          for (i = 0; i < lon; i++) {
            yy = y0 + (lon >= 4 && (i === 0 || i === lon - 1) ? 1 : 0);
            c.pose(x0 + dx + i, yy, 0, clair < 0.4 && i > 0 && i < lon - 1 ? 4 : 3);
            deja[c.i(x0 + dx + i, yy)] = 1;
          }
          for (i = 1; i < lon - 1; i++) if (!deja[c.i(x0 + dx + i, y0 + 1)]) c.pose(x0 + dx + i, y0 + 1, 0, 0);
        }
      }
      r = c.alea(1);
      nb = Math.round(p.eclats * n * n / 90);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n); b = Math.sin(TAU * (c.phase + r()));
        if (b > 0.2) { c.pose(x, y, 0, 5); if (b > 0.8 && n >= 32) { c.pose(x - 1, y, 0, 4); c.pose(x + 1, y, 0, 4); } }
      }
    }
  });

  // ---------- Eau vive ----------
  T.matiere({
    id: 'eauvive', nom: 'Eau vive', anime: true,
    rampes: [{ nom: 'Eau', hex: ['123a5e', '17588a', '2380b4', '49aad2', '8fd8ec', 'e6fafc'] }],
    reglages: [glisse('echelle', 'Taille des mailles', 0.5), glisse('epaisseur', 'Épaisseur des reflets', 0.4), glisse('ecume', 'Écume', 0.4), glisse('remous', 'Remous (animation)', 0.6), glisse('fond', 'Variations de fond', 0.4)],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = Math.max(2, Math.round(n / ((7 + p.echelle * 8) * c.e))), rad = n / K / 2;
      var V = voronoi(n, K, K, 1, c.g, { orbite: 0.12 + 0.3 * p.remous, phase: c.phase });
      var x, y, i = 0, t, e = 0.15 + (0.35 + p.epaisseur * 0.7) * c.e, d, b;
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          b = V.bord[i];
          d = Math.sqrt(V.dx[i] * V.dx[i] + V.dy[i] * V.dy[i]) / rad;
          if (b < e) t = (V.bord2[i] < e + 0.6 && h2(V.id[i], 1, c.g) < p.ecume * 1.6) ? 5 : 4;
          else if (b < e + 0.75 * c.e && (V.dx[i] + V.dy[i] > 0 || h2(V.id[i], 1, c.g) < p.ecume * 0.5)) t = 3;
          else {
            t = d > 0.5 ? 2 : 1;
            if (bruit3(x / n * 3, y / n * 3, c.phase * 2, 3, 3, 2, c.g + 9) < 0.3 + p.fond * 0.25) t -= 1;
          }
          c.pose(x, y, 0, t);
        }
      }
    }
  });

  // ---------- Lave ----------
  T.matiere({
    id: 'lave', nom: 'Lave', anime: true,
    rampes: [
      { nom: 'Croûte', hex: ['160c10', '2a171a', '442622', '5f382c'] },
      { nom: 'Feu', hex: ['6e1208', 'b8280a', 'ea5e0e', 'fa9c28', 'fdde60', 'fffad2'] }
    ],
    reglages: [glisse('echelle', 'Taille des plaques', 0.5), glisse('coulees', 'Largeur des coulées', 0.5), glisse('lueur', 'Chaleur', 0.6), glisse('croute', 'Relief de la croûte', 0.5), glisse('braises', 'Braises', 0.3), glisse('pouls', 'Pulsation (animation)', 0.5)],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = Math.max(2, Math.round(n / ((8 + p.echelle * 9) * c.e)));
      var V = voronoi(n, K, K, 1, c.g, { orbite: 0.05, phase: c.phase }), V2 = voronoi(n, K * 2, K * 2, 1, c.g + 6), bis, plaque = new Int32Array(n * n);
      var x, y, i, w, q, t, b, r, nb, k;
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          w = (0.3 + p.coulees * 2.6) * c.e * (0.3 + 1.4 * bruit3(x / n * 3, y / n * 3, c.phase * 2, 3, 3, 2, c.g + 2));
          w *= 1 + 0.3 * p.pouls * Math.sin(TAU * (c.phase + h2(V.id[i], 4, c.g)));
          b = V.bord[i];
          if (b < w) {
            plaque[i] = -1;
            q = 1 - b / w;
            c.pose(x, y, 1, Math.min(5, 1 + q * (1.6 + 3.2 * p.lueur) + 0.5 * p.pouls * Math.sin(TAU * (c.phase + x / n + y / n))));
          } else {
            plaque[i] = V.id[i] * 4096 + V2.id[i];
            c.pose(x, y, 0, b < w + 1.1 ? -1 : 1 + Math.round(h2(V.id[i], 1, c.g) * 0.9 + (h2(V2.id[i], 2, c.g) - 0.5) * p.croute));
          }
        }
      }
      bis = biseau(plaque, n);
      for (i = 0; i < n * n; i++) {
        if (plaque[i] < 0) continue;
        if (c.v[i] < 0) { c.r[i] = 1; c.v[i] = 0; }          // liseré rougi par la chaleur
        else if (bis[i] > 0 && p.croute > 0.15) c.v[i] = Math.min(3, c.v[i] + 1);
        else if (bis[i] < 0 && p.croute > 0.15) c.v[i] = Math.max(0, c.v[i] - 1);
      }
      r = c.alea(1);
      nb = Math.round(p.braises * n * n / 60);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n); t = Math.sin(TAU * (c.phase + r()));
        if (plaque[c.i(x, y)] >= 0 && t > -0.3) c.pose(x, y, 1, t > 0.6 ? 3 : 1);
      }
    }
  });

  // ---------- Neige ----------
  T.matiere({
    id: 'neige', nom: 'Neige', anime: true,
    rampes: [{ nom: 'Neige', hex: ['6c80b0', '93aad2', 'bccfe8', 'dfe9f6', 'ffffff'] }],
    reglages: [glisse('congeres', 'Congères', 0.5), glisse('echelle', 'Largeur des congères', 0.5), glisse('grain', 'Grain', 0.15), glisse('creux', 'Petits creux', 0.2), glisse('eclats', 'Scintillement (animation)', 0.3)],
    dessiner: function (c) {
      var n = c.n, p = c.p, f = Math.max(1, Math.round(n / ((13 + p.echelle * 14) * c.e))), H = new Int16Array(n * n), niveaux = Math.min(6, (1 + p.congeres * 5.8) * c.e / 1.41);
      var x, y, i, r, nb, k, b, t, ici, bas, loin;
      // Courbes de niveau d'un relief étiré par le vent : une arête claire face à la lumière, une ombre nette derrière.
      for (y = 0, i = 0; y < n; y++) for (x = 0; x < n; x++, i++) H[i] = Math.floor(fbm(x / n, y / n, f, f * 2, 2, c.g) * niveaux);
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          ici = H[i]; bas = H[c.i(x + 1, y + 1)]; loin = H[c.i(x + 2, y + 2)];
          t = 3;
          if (p.congeres > 0) {
            if (H[c.i(x - 1, y - 1)] > ici) t = 1.6;
            else if (H[c.i(x - 2, y - 2)] > ici) t = 2;
            else if (H[c.i(x - 3, y - 3)] > ici && c.e > 0.9) t = 2.5;
            else if (bas < ici || loin < ici) t = 4;
          }
          c.pose(x, y, 0, t);
        }
      }
      r = c.alea(1);
      nb = Math.round(p.grain * n * n / 14);
      for (k = 0; k < nb; k++) c.plus(Math.floor(r() * n), Math.floor(r() * n), -1);
      nb = Math.round(p.creux * n * n / 150);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n); t = 1 + Math.floor(r() * (1 + c.e));
        for (i = 0; i <= t; i++) { c.pose(x + i, y - (i === 0 || i === t ? 0 : 1), 0, 2); c.pose(x + i, y + 1, 0, 4); }
        c.pose(x - 1, y + 1, 0, 2);
      }
      nb = Math.round(p.eclats * n * n / 70);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n); b = Math.sin(TAU * (c.phase + r()));
        if (b < -0.1) continue;
        c.pose(x, y, 0, 4);
        if (b > 0.75 && n >= 32) { c.pose(x - 1, y, 0, 4); c.pose(x + 1, y, 0, 4); c.pose(x, y - 1, 0, 4); c.pose(x, y + 1, 0, 4); }
      }
    }
  });

  // ---------- Glace ----------
  T.matiere({
    id: 'glace', nom: 'Glace',
    rampes: [{ nom: 'Glace', hex: ['2f5f92', '4f8abd', '7db5dc', 'aed8ee', 'd8f0f8', 'ffffff'] }],
    reglages: [glisse('fissures', 'Fissures', 0.5), glisse('reflets', 'Reflets', 0.5), glisse('nuages', 'Profondeur', 0.5), glisse('bulles', 'Bulles', 0.3), glisse('givre', 'Givre', 0.2)],
    dessiner: function (c) {
      var n = c.n, p = c.p, Kd = Math.max(1, Math.round(1.6 * c.e)), fente = new Uint8Array(n * n);
      var x, y, i, u, v, t, tt, fr, ligne, r, nb, k, file, f, a, px, py, pas, lon;
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          u = x / n; v = y / n;
          t = borne(2 + Math.round((fbm(u, v, 2, 2, 3, c.g) - 0.5) * 5.5 * p.nuages), 1, 3);
          tt = (u + v) * Kd + 0.5 * (bruit(u * 2, v * 2, 2, 2, c.g + 4) - 0.5);
          fr = frac(tt); ligne = mod(Math.floor(tt), Kd);
          if (p.reflets > 0 && bruit((u - v) * 3 + ligne * 5.3, ligne * 3.1, 3, 97, c.g + 6) > 0.62 - p.reflets * 0.3) {
            if (fr < 0.22 * p.reflets + 0.04) t += 1;
            else if (fr > 0.42 && fr < 0.42 + 0.07 * p.reflets + 0.02) t += 1;
          }
          if (p.givre > 0 && ((x + y) & 1) && fbm(u, v, 6, 6, 2, c.g + 8) > 0.8 - p.givre * 0.25) t += 1;
          c.pose(x, y, 0, t);
        }
      }
      r = c.alea(1);
      file = [];
      nb = p.fissures > 0 ? Math.max(1, Math.round(p.fissures * 2.4 * c.e)) : 0;
      for (k = 0; k < nb; k++) file.push({ x: r() * n, y: r() * n, a: r() * TAU, l: n * (0.55 + 0.5 * r()) });
      while (file.length) {
        f = file.pop(); px = f.x; py = f.y; a = f.a; lon = f.l;
        for (pas = 0; pas < lon; pas++) {
          fente[c.i(Math.floor(px), Math.floor(py))] = 1;
          px += Math.cos(a) * 0.9; py += Math.sin(a) * 0.9;
          a += (r() - 0.5) * 0.1;
          if (r() < 0.025) a += r() < 0.5 ? 0.45 : -0.45;
          if (r() < 0.02 && lon > 10) file.push({ x: px, y: py, a: a + (r() < 0.5 ? 0.75 : -0.75), l: lon * 0.4 });
        }
      }
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          if (fente[i]) c.pose(x, y, 0, 5);
          else if (fente[c.i(x, y - 1)] || fente[c.i(x - 1, y)]) c.pose(x, y, 0, Math.max(0, c.v[i] - 1));
        }
      }
      nb = Math.round(p.bulles * n * n / 90);
      for (k = 0; k < nb; k++) {
        x = Math.floor(r() * n); y = Math.floor(r() * n);
        if (fente[c.i(x, y)]) continue;
        c.pose(x, y, 0, 4);
        if (r() < 0.6) c.pose(x + 1, y + 1, 0, 1);
      }
    }
  });
})();
