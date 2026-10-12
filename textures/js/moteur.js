(function () {
  'use strict';

  var racine = typeof window !== 'undefined' ? window : globalThis;

  var TAILLES = [16, 32, 64, 128];
  var NB_IMAGES = [1, 4, 8, 16];
  var TRAMES = [0, 0.35, 0.85];              // force du tramage : aucun, léger, marqué
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var TAU = Math.PI * 2;
  var FORMAT_ATELIER = 'atelier-pixel';

  var PALETTES = [
    { id: 'db32', nom: 'DawnBringer 32', hex: '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30' },
    { id: 'endesga32', nom: 'Endesga 32', hex: 'be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569' },
    { id: 'pico8', nom: 'PICO-8', hex: '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa' },
    { id: 'sweetie16', nom: 'Sweetie 16', hex: '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57' },
    { id: 'gameboy', nom: 'Game Boy', mono: true, hex: '0f380f 306230 8bac0f 9bbc0f' },
    { id: 'gris8', nom: 'Gris (8 niveaux)', mono: true, hex: '000000 242424 494949 6d6d6d 929292 b6b6b6 dbdbdb ffffff' }
  ];

  var T = racine.Textures = { TAILLES: TAILLES, NB_IMAGES: NB_IMAGES, PALETTES: PALETTES, matieres: [], parId: {}, o: {} };

  // ---------- Hasard ----------
  function hacher(s) {
    var h = 2166136261, i;
    for (i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ h >>> 15, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return (h ^ h >>> 16) >>> 0;
  }
  function alea(g) {
    var a = g >>> 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // Hachage d'une case entière : toujours le même nombre entre 0 et 1 pour (x, y, s).
  function h2(x, y, s) {
    var h = (s | 0) ^ Math.imul(x | 0, 0x27d4eb2d);
    h = Math.imul(h ^ h >>> 15, 0x85ebca6b);
    h ^= Math.imul(y | 0, 0x165667b1);
    h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  // Reste toujours positif. Les arguments sont des entiers.
  function mod(a, n) {
    var r = (a | 0) % (n | 0);
    return (r < 0 ? r + n : r) | 0;
  }
  function borne(v, a, b) { return v < a ? a : v > b ? b : v; }
  function frac(v) { return v - Math.floor(v); }

  // ---------- Bruits périodiques ----------
  // Tous se referment sur eux-mêmes : px, py (et pz) sont les périodes, en cases du réseau.
  function lisse(t) { return t * t * (3 - 2 * t); }

  function bruit(x, y, px, py, s) {
    var x0 = Math.floor(x) | 0, y0 = Math.floor(y) | 0, fx = lisse(x - x0), fy = lisse(y - y0);
    var xa = mod(x0, px), xb = mod(x0 + 1, px), ya = mod(y0, py), yb = mod(y0 + 1, py);
    var a = h2(xa, ya, s), b = h2(xb, ya, s), c = h2(xa, yb, s), d = h2(xb, yb, s);
    return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
  }

  function bruit3(x, y, z, px, py, pz, s) {
    var z0 = Math.floor(z) | 0, fz = lisse(z - z0);
    var a = bruit(x, y, px, py, (s + mod(z0, pz) * 7919) | 0), b = bruit(x, y, px, py, (s + mod(z0 + 1, pz) * 7919) | 0);
    return a + (b - a) * fz;
  }

  // u, v entre 0 et 1 ; fx, fy : nombre de cases sur la tuile pour la première octave.
  function fbm(u, v, fx, fy, octaves, s) {
    var somme = 0, amp = 1, total = 0, i;
    s = s | 0;
    for (i = 0; i < octaves; i++) {
      somme += amp * bruit(u * fx, v * fy, fx, fy, (s + i * 131) | 0);
      total += amp; amp *= 0.5; fx *= 2; fy *= 2;
    }
    return somme / total;
  }

  // ---------- Cellules de Voronoï périodiques ----------
  // kx × ky germes sur une grille agitée. o : { ax, ay (étirement), orbite et phase (germes qui tournent), decale, quinconce }.
  // Rend par pixel : id du germe, dx/dy (écart au germe), bord et bord2 (distances aux deux frontières les plus proches).
  function voronoi(n, kx, ky, gigue, s, o) {
    o = o || {};
    var ax = o.ax || 1, ay = o.ay || 1, nb = kx * ky, gx = new Float32Array(nb), gy = new Float32Array(nb);
    var i, j, k, ox, oy, an;
    for (j = 0; j < ky; j++) {
      for (i = 0; i < kx; i++) {
        k = j * kx + i;
        ox = (h2(i, j, s) - 0.5) * gigue; oy = (h2(i, j, s + 1) - 0.5) * gigue;
        if (o.orbite) {
          an = TAU * ((h2(i, j, s + 3) < 0.5 ? 1 : -1) * (o.phase || 0) + h2(i, j, s + 2));
          ox += o.orbite * Math.cos(an); oy += o.orbite * Math.sin(an);
        }
        if (o.decale && (j & 1)) ox += 0.5;
        if (o.quinconce && (i & 1)) oy += 0.5;
        gx[k] = (i + 0.5 + ox) * n / kx; gy[k] = (j + 0.5 + oy) * n / ky;
      }
    }
    var id = new Int32Array(n * n), bord = new Float32Array(n * n), bord2 = new Float32Array(n * n);
    var dxs = new Float32Array(n * n), dys = new Float32Array(n * n);
    var cx = new Float64Array(25), cy = new Float64Array(25), cd = new Float64Array(25), ck = new Int32Array(25);
    var x, y, X, Y, ci, cj, di, dj, ii, jj, c, m, meilleur, d, ex, ey, b1, b2, p = 0;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++, p++) {
        X = x + 0.5; Y = y + 0.5;
        ci = Math.floor(X * kx / n); cj = Math.floor(Y * ky / n);
        c = 0; meilleur = 0;
        for (dj = -2; dj <= 2; dj++) {
          for (di = -2; di <= 2; di++, c++) {
            ii = mod(ci + di, kx); jj = mod(cj + dj, ky); k = jj * kx + ii;
            cx[c] = gx[k] + (ci + di - ii) / kx * n; cy[c] = gy[k] + (cj + dj - jj) / ky * n;
            ex = (X - cx[c]) * ax; ey = (Y - cy[c]) * ay;
            cd[c] = ex * ex + ey * ey; ck[c] = k;
            if (cd[c] < cd[meilleur]) meilleur = c;
          }
        }
        b1 = b2 = 1e9;
        for (m = 0; m < 25; m++) {
          if (m === meilleur) continue;
          ex = (cx[m] - cx[meilleur]) * ax; ey = (cy[m] - cy[meilleur]) * ay;
          d = (cd[m] - cd[meilleur]) / (2 * Math.sqrt(ex * ex + ey * ey) || 1);
          if (d < b1) { b2 = b1; b1 = d; } else if (d < b2) b2 = d;
        }
        id[p] = ck[meilleur]; bord[p] = b1; bord2[p] = b2;
        dxs[p] = X - cx[meilleur]; dys[p] = Y - cy[meilleur];
      }
    }
    return { id: id, bord: bord, bord2: bord2, dx: dxs, dy: dys, nb: nb };
  }

  // Lumière en haut à gauche : +1 sur les bords haut et gauche d'une zone, -1 sur les bords bas et droit.
  // Les pixels d'identifiant négatif (joints) sont ignorés.
  function biseau(id, n) {
    var o = new Int8Array(n * n), x, y, p, moi, lu, om;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        p = y * n + x; moi = id[p];
        if (moi < 0) continue;
        lu = id[mod(y - 1, n) * n + x] !== moi || id[y * n + mod(x - 1, n)] !== moi;
        om = id[mod(y + 1, n) * n + x] !== moi || id[y * n + mod(x + 1, n)] !== moi;
        o[p] = (lu ? 1 : 0) - (om ? 1 : 0);
      }
    }
    return o;
  }

  // Le diviseur de n (puissance de deux) le plus proche de la valeur voulue.
  function diviseur(n, voulu, min, max) {
    var d, mieux = min || 1, ecart = 1e9, e;
    for (d = min || 1; d <= (max || n / 2); d *= 2) {
      e = Math.abs(Math.log(d / Math.max(voulu, 0.01)));
      if (e < ecart) { ecart = e; mieux = d; }
    }
    return mieux;
  }

  T.o = { TAU: TAU, mod: mod, borne: borne, frac: frac, h2: h2, alea: alea, bruit: bruit, bruit3: bruit3, fbm: fbm, voronoi: voronoi, biseau: biseau, diviseur: diviseur };

  // ---------- Matières ----------
  // Une matière : { id, nom, anime, rampes: [{ nom, hex: [sombre … clair] }], reglages, dessiner(c) }.
  // dessiner remplit c.r (rampe de chaque pixel) et c.v (ton dans la rampe, de 0 à longueur - 1, fractionnaire pour un dégradé tramé).
  T.matiere = function (m) {
    T.matieres.push(m);
    T.parId[m.id] = m;
  };

  function contexte(n, g, phase, p) {
    var c = { n: n, g: g | 0, phase: phase, p: p, e: Math.sqrt(n / 32), r: new Uint8Array(n * n), v: new Float32Array(n * n) };
    c.i = function (x, y) { return mod(y, n) * n + mod(x, n); };
    c.pose = function (x, y, r, v) { var i = mod(y, n) * n + mod(x, n); c.r[i] = r; c.v[i] = v; };
    c.plus = function (x, y, dv) { var i = mod(y, n) * n + mod(x, n); c.v[i] = Math.max(0, c.v[i] + dv); };
    c.alea = function (k) { return alea(c.g + Math.imul(k, 0x9e3779b1)); };
    return c;
  }

  // ---------- Réglages ----------
  T.defauts = function (id) {
    var m = T.parId[id] || T.matieres[0], p = {};
    m.reglages.forEach(function (r) { p[r.id] = r.def; });
    return { matiere: m.id, graine: 'atelier', taille: 32, couleurs: 0, palette: 'matiere', teintes: null, trame: 1, contraste: 1, images: 8, p: p };
  };

  function nbTeintes(m) { return m.rampes.reduce(function (s, r) { return s + r.hex.length; }, 0); }
  T.nbTeintes = nbTeintes;

  function hexValide(h) { return typeof h === 'string' && /^[0-9a-f]{6}$/i.test(h); }

  T.normaliser = function (r) {
    r = r || {};
    var m = T.parId[r.matiere] || T.matieres[0], o = T.defauts(m.id), src = r.p || {}, total = nbTeintes(m);
    o.graine = String(r.graine === undefined || r.graine === '' ? o.graine : r.graine).slice(0, 40);
    if (TAILLES.indexOf(Number(r.taille)) >= 0) o.taille = Number(r.taille);
    if (NB_IMAGES.indexOf(Number(r.images)) >= 0) o.images = Number(r.images);
    if (PALETTES.some(function (p) { return p.id === r.palette; })) o.palette = r.palette;
    if (r.trame === 0 || r.trame === 1 || r.trame === 2) o.trame = r.trame;
    if (isFinite(r.contraste) && r.contraste !== null && r.contraste !== undefined) o.contraste = borne(Number(r.contraste), 0.4, 1.8);
    o.couleurs = Math.round(Number(r.couleurs)) || 0;
    if (o.couleurs < 2 || o.couleurs >= total) o.couleurs = 0;
    if (Array.isArray(r.teintes) && r.teintes.length === total && r.teintes.every(hexValide)) o.teintes = r.teintes.map(function (h) { return h.toLowerCase(); });
    m.reglages.forEach(function (d) {
      var v = src[d.id];
      if (d.options) {
        if (d.options.some(function (op) { return op[0] === v; })) o.p[d.id] = v;
      } else if (v !== undefined && v !== null && isFinite(v)) o.p[d.id] = borne(Number(v), d.min, d.max);
    });
    return o;
  };

  // Texte compact des réglages (pour l'adresse et la collection) : seules les valeurs qui diffèrent du défaut y figurent.
  T.versTexte = function (r) {
    r = T.normaliser(r);
    var m = T.parId[r.matiere], d = T.defauts(m.id), t = ['m=' + m.id, 'g=' + encodeURIComponent(r.graine), 't=' + r.taille], v = [];
    if (r.couleurs) t.push('c=' + r.couleurs);
    if (r.palette !== d.palette) t.push('pal=' + r.palette);
    if (r.trame !== d.trame) t.push('tr=' + r.trame);
    if (r.contraste !== d.contraste) t.push('ct=' + Math.round(r.contraste * 100) / 100);
    if (r.images !== d.images) t.push('im=' + r.images);
    m.reglages.forEach(function (x) {
      if (r.p[x.id] !== x.def) v.push(x.id + ':' + (x.options ? r.p[x.id] : Math.round(r.p[x.id] * 1000) / 1000));
    });
    if (v.length) t.push('v=' + v.join(','));
    if (r.teintes) t.push('te=' + r.teintes.join('.'));
    return t.join('&');
  };

  T.depuisTexte = function (s) {
    var r = { p: {} }, cles = { m: 'matiere', t: 'taille', c: 'couleurs', pal: 'palette', tr: 'trame', ct: 'contraste', im: 'images' };
    String(s || '').replace(/^#/, '').split('&').forEach(function (bout) {
      var k = bout.indexOf('='), cle = bout.slice(0, k), val = bout.slice(k + 1);
      if (k < 1) return;
      if (cle === 'g') { try { r.graine = decodeURIComponent(val); } catch (e) { r.graine = val; } }
      else if (cle === 'v') val.split(',').forEach(function (x) {
        var q = x.split(':');
        if (q.length === 2) r.p[q[0]] = isNaN(Number(q[1])) || q[1] === '' ? q[1] : Number(q[1]);
      });
      else if (cle === 'te') r.teintes = val.split('.');
      else if (cle === 'm' || cle === 'pal') r[cles[cle]] = val;
      else if (cles[cle]) r[cles[cle]] = Number(val);
    });
    return T.normaliser(r);
  };

  // ---------- Couleurs ----------
  function rgbDepuisHex(h) {
    var v = parseInt(h, 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  }
  function hexDepuisRgb(c) { return ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1); }
  T.hexDepuisRgb = hexDepuisRgb;

  // Espace OKLab : les distances y suivent mieux l'œil qu'en RVB.
  function lab(c) {
    function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    var r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function ecart(a, b) {
    var dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  }

  // Remplace chaque teinte par une couleur de la palette imposée. Dans une rampe, on évite de
  // reprendre deux fois la même couleur tant qu'une voisine acceptable existe.
  function imposer(pleine, mat, pal) {
    var cible = pal.hex.split(' ').map(rgbDepuisHex), labs = cible.map(lab), src = pleine.map(lab), out = [];
    var lo = 1, hi = 0, plo = 1, phi = 0, i = 0;
    src.forEach(function (l) { lo = Math.min(lo, l[0]); hi = Math.max(hi, l[0]); });
    labs.forEach(function (l) { plo = Math.min(plo, l[0]); phi = Math.max(phi, l[0]); });
    mat.rampes.forEach(function (ra) {
      var prises = {}, k, j, l, d, mieux, dm;
      for (k = 0; k < ra.hex.length; k++, i++) {
        l = src[i]; mieux = 0; dm = 1e9;
        for (j = 0; j < labs.length; j++) {
          // Palette monochrome : seule la clarté compte, étirée sur toute l'étendue disponible.
          if (pal.mono) d = Math.abs(plo + (l[0] - lo) / (hi - lo || 1) * (phi - plo) - labs[j][0]);
          else d = Math.sqrt(ecart(l, labs[j])) + (prises[j] ? 0.045 : 0);
          if (d < dm) { dm = d; mieux = j; }
        }
        prises[mieux] = true;
        out.push(cible[mieux]);
      }
    });
    return out;
  }

  // Fusionne les teintes les plus proches jusqu'à tenir dans la limite. usage : nombre de pixels par teinte.
  // Les teintes inutilisées ne comptent pas : elles sont rabattues sur la couleur gardée la plus proche.
  // Rend les couleurs gardées et la table qui envoie chaque teinte vers l'une d'elles.
  function reduire(teintes, limite, usage) {
    var groupes = [], vus = {}, table = new Uint8Array(teintes.length), labs = teintes.map(lab), i, j, a, b, d, dm;
    teintes.forEach(function (c, k) {
      if (!usage[k]) return;
      var cle = hexDepuisRgb(c);
      if (vus[cle] === undefined) { vus[cle] = groupes.length; groupes.push({ c: c, lab: labs[k], membres: [], poids: 0 }); }
      groupes[vus[cle]].membres.push(k);
      groupes[vus[cle]].poids += usage[k];
    });
    while (limite && groupes.length > limite) {
      dm = 1e9;
      for (i = 0; i < groupes.length; i++) {
        for (j = i + 1; j < groupes.length; j++) {
          // Critère de Ward : on sacrifie d'abord les couleurs proches et peu présentes.
          d = ecart(groupes[i].lab, groupes[j].lab) * groupes[i].poids * groupes[j].poids / (groupes[i].poids + groupes[j].poids);
          if (d < dm) { dm = d; a = i; b = j; }
        }
      }
      if (groupes[b].poids > groupes[a].poids) { groupes[a].c = groupes[b].c; groupes[a].lab = groupes[b].lab; }
      groupes[a].membres = groupes[a].membres.concat(groupes[b].membres);
      groupes[a].poids += groupes[b].poids;
      groupes.splice(b, 1);
    }
    groupes.forEach(function (gr, k) { gr.membres.forEach(function (m) { table[m] = k; }); });
    teintes.forEach(function (c, k) {
      if (usage[k]) return;
      dm = 1e9;
      groupes.forEach(function (gr, q) { d = ecart(labs[k], gr.lab); if (d < dm) { dm = d; table[k] = q; } });
    });
    return { couleurs: groupes.map(function (gr) { return gr.c; }), table: table };
  }

  // Les teintes de la matière, à plat, dans l'ordre des rampes.
  T.teintes = function (r) {
    var m = T.parId[r.matiere], t = [];
    if (r.teintes) return r.teintes.slice();
    m.rampes.forEach(function (ra) { ra.hex.forEach(function (h) { t.push(h); }); });
    return t;
  };

  // ---------- Génération ----------
  function dessin(tex, k) {
    var c = contexte(tex.n, tex.g, tex.nb > 1 ? k / tex.nb : 0, tex.r.p);
    tex.mat.dessiner(c);
    return c;
  }

  // Du ton fractionnaire à la teinte : contraste, puis tramage ordonné entre les deux tons voisins.
  function quantifier(tex, c) {
    var n = tex.n, r = tex.r, out = new Uint8Array(n * n), force = TRAMES[r.trame], x, y, p = 0, ra, max, v, i0, seuil;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++, p++) {
        ra = c.r[p]; max = tex.longs[ra] - 1;
        v = max / 2 + (c.v[p] - max / 2) * r.contraste;
        v = v < 0 ? 0 : v > max ? max : v;
        i0 = Math.floor(v);
        seuil = 0.5 + ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * force;
        out[p] = tex.decal[ra] + (v - i0 > seuil ? i0 + 1 : i0);
      }
    }
    return out;
  }

  // La palette finale se décide sur la première image : ses teintes, réduites à la limite demandée.
  T.preparer = function (r) {
    r = T.normaliser(r);
    var mat = T.parId[r.matiere], tex = { r: r, mat: mat, n: r.taille, nb: mat.anime ? r.images : 1, g: hacher(r.graine), decal: [], longs: [] }, k = 0, usage, red, i;
    mat.rampes.forEach(function (ra) { tex.decal.push(k); tex.longs.push(ra.hex.length); k += ra.hex.length; });
    tex.pleine = T.teintes(r).map(rgbDepuisHex);
    if (r.palette !== 'matiere') tex.pleine = imposer(tex.pleine, mat, PALETTES.filter(function (p) { return p.id === r.palette; })[0]);
    tex.premiere = quantifier(tex, dessin(tex, 0));
    usage = new Uint32Array(k);
    for (i = 0; i < tex.premiere.length; i++) usage[tex.premiere[i]]++;
    red = reduire(tex.pleine, r.couleurs, usage);
    tex.couleurs = red.couleurs; tex.table = red.table;
    return tex;
  };

  // L'image k de la boucle : un indice de couleur par pixel.
  T.image = function (tex, k) {
    var q = k === 0 ? tex.premiere : quantifier(tex, dessin(tex, k)), out = new Uint8Array(q.length), i;
    for (i = 0; i < q.length; i++) out[i] = tex.table[q[i]];
    return out;
  };

  T.generer = function (r) {
    var tex = T.preparer(r), images = [], k;
    for (k = 0; k < tex.nb; k++) images.push(T.image(tex, k));
    return { n: tex.n, nb: tex.nb, images: images, couleurs: tex.couleurs, r: tex.r };
  };

  // Pixels 0xAABBGGRR, l'ordre des octets d'une ImageData (et celui d'Atelier Pixel).
  T.pixels = function (indices, couleurs) {
    var o = new Uint32Array(indices.length), t = couleurs.map(function (c) { return (0xff000000 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0; }), i;
    for (i = 0; i < o.length; i++) o[i] = t[indices[i]];
    return o;
  };

  // ---------- Export vers Atelier Pixel ----------
  // Même codage que l'éditeur : plages [longueur, r, v, b, a] puis base64.
  function coder(indices, couleurs) {
    var s = '', i = 0, n = indices.length, c, run, col;
    while (i < n) {
      c = indices[i]; run = 1;
      while (run < 255 && i + run < n && indices[i + run] === c) run++;
      col = couleurs[c];
      s += String.fromCharCode(run, col[0], col[1], col[2], 255);
      i += run;
    }
    return btoa(s);
  }

  T.versAtelier = function (res, duree) {
    var nom = T.parId[res.r.matiere].nom;
    return {
      format: FORMAT_ATELIER, version: 1, w: res.n, h: res.n, iImage: 0, iCalque: 0,
      palette: res.couleurs.map(function (c) { return '#' + hexDepuisRgb(c); }),
      calques: [{ id: 1, nom: nom.slice(0, 40), visible: true, opacite: 1, verrou: false }],
      images: res.images.map(function (im) { return { duree: duree || 100, cels: { 1: coder(im, res.couleurs) } }; })
    };
  };
})();
