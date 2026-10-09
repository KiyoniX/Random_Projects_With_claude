// Génération de la planète : bruit, relief, climat, biomes, textures et rendu du globe.
(function () {
  'use strict';

  var PG = window.PG = {};
  var W = PG.W = 720, H = PG.H = 360;

  var clamp = PG.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var smooth = function (a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  var mix = PG.mix = function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };

  // ---------- Hasard reproductible ----------
  PG.rng = function (str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    var a = (h ^ (h >>> 16)) >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };

  // ---------- Étoiles ----------
  PG.STARS = {
    M: { name: 'naine rouge', kelvin: 3200, lum: 0.04, mass: 0.3, css: '#ff8a5c', veg: [52, 30, 66], vegName: 'violet sombre', sky: [255, 170, 125] },
    K: { name: 'naine orange', kelvin: 4500, lum: 0.3, mass: 0.7, css: '#ffc27a', veg: [98, 112, 38], vegName: 'olive doré', sky: [150, 190, 235] },
    G: { name: 'naine jaune', kelvin: 5800, lum: 1, mass: 1, css: '#fff1c9', veg: [56, 122, 50], vegName: 'vert', sky: [110, 170, 255] },
    F: { name: 'étoile blanche', kelvin: 6800, lum: 3, mass: 1.3, css: '#e8f1ff', veg: [28, 128, 142], vegName: 'turquoise', sky: [85, 145, 255] }
  };

  // ---------- Biomes ----------
  var B = PG.B = {
    DEEP: 0, SHALLOW: 1, SEA_ICE: 2, ICE: 3, TUNDRA: 4, TAIGA: 5, COLD_STEPPE: 6, FOREST: 7, GRASS: 8,
    ARID: 9, DESERT: 10, SAVANNA: 11, JUNGLE: 12, MOUNTAIN: 13, SCORCHED: 14, SALT: 15, BARREN: 16, LAVA: 17
  };
  PG.BIOMES = [
    { name: 'Océan profond', of: 'des abysses', npp: 0.12, water: true },
    { name: 'Mers peu profondes', of: 'des récifs', npp: 0.5, water: true },
    { name: 'Banquise', of: 'des banquises', npp: 0.05, water: true },
    { name: 'Calotte glaciaire', of: 'des glaces', npp: 0.005 },
    { name: 'Toundra', of: 'des toundras', npp: 0.08 },
    { name: 'Taïga', of: 'des taïgas', npp: 0.35 },
    { name: 'Steppe froide', of: 'des steppes', npp: 0.15 },
    { name: 'Forêt tempérée', of: 'des forêts', npp: 0.7 },
    { name: 'Prairie', of: 'des prairies', npp: 0.4 },
    { name: 'Steppe aride', of: 'des plateaux secs', npp: 0.1 },
    { name: 'Désert chaud', of: 'des dunes', npp: 0.03 },
    { name: 'Savane', of: 'des savanes', npp: 0.5 },
    { name: 'Jungle', of: 'des jungles', npp: 1 },
    { name: 'Haute montagne', of: 'des cimes', npp: 0.05 },
    { name: 'Terres brûlées', of: '', npp: 0, dead: true },
    { name: 'Bassin salin', of: '', npp: 0, dead: true },
    { name: 'Roche nue', of: '', npp: 0, dead: true },
    { name: 'Enfer minéral', of: '', npp: 0, dead: true }
  ];

  // ---------- Bruit de Perlin 3D ----------
  function makeNoise(rand) {
    var p = new Uint8Array(512), perm = [], i;
    for (i = 0; i < 256; i++) perm[i] = i;
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (i = 0; i < 512; i++) p[i] = perm[i & 255];
    function grad(h, x, y, z) {
      h &= 15;
      var u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
      return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
    return function (x, y, z) {
      var fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
      var X = fx & 255, Y = fy & 255, Z = fz & 255;
      x -= fx; y -= fy; z -= fz;
      var u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
      var A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, Bq = p[X + 1] + Y, BA = p[Bq] + Z, BB = p[Bq + 1] + Z;
      var l1 = grad(p[AA], x, y, z), l2 = grad(p[BA], x - 1, y, z), l3 = grad(p[AB], x, y - 1, z), l4 = grad(p[BB], x - 1, y - 1, z);
      var l5 = grad(p[AA + 1], x, y, z - 1), l6 = grad(p[BA + 1], x - 1, y, z - 1), l7 = grad(p[AB + 1], x, y - 1, z - 1), l8 = grad(p[BB + 1], x - 1, y - 1, z - 1);
      var a = l1 + u * (l2 - l1), b = l3 + u * (l4 - l3), c = l5 + u * (l6 - l5), d = l7 + u * (l8 - l7);
      var e = a + v * (b - a), f = c + v * (d - c);
      return e + w * (f - e);
    };
  }
  function fbm(n, x, y, z, oct) {
    var s = 0, a = 1, norm = 0;
    for (var o = 0; o < oct; o++) {
      s += a * n(x, y, z); norm += a;
      a *= 0.52; x *= 2; y *= 2; z *= 2;
    }
    return s / norm;
  }

  // ---------- Champs bruts (dépendent seulement de la graine) ----------
  PG.fields = function (seed) {
    var nE = makeNoise(PG.rng('relief' + seed)), nM = makeNoise(PG.rng('pluie' + seed)), nC = makeNoise(PG.rng('nuages' + seed));
    var e = new Float32Array(W * H), m = new Float32Array(W * H), c = new Float32Array(W * H);
    var lat = new Float32Array(H), cosLat = new Float32Array(H);
    for (var j = 0; j < H; j++) {
      var la = (0.5 - (j + 0.5) / H) * Math.PI;
      lat[j] = la; cosLat[j] = Math.cos(la);
      var y = Math.sin(la), cl = cosLat[j];
      for (var i = 0; i < W; i++) {
        var lo = ((i + 0.5) / W) * 2 * Math.PI - Math.PI;
        var x = cl * Math.cos(lo), z = cl * Math.sin(lo);
        var q = fbm(nE, x * 2 + 5.2, y * 2 + 1.3, z * 2 + 9.1, 3) * 0.35;
        var base = fbm(nE, (x + q) * 1.35, (y + q) * 1.35, (z - q) * 1.35, 6);
        var ridge = 1 - Math.abs(fbm(nE, x * 2.7 + 31, y * 2.7 + 17, z * 2.7 + 5, 4)) * 2.2;
        var k = j * W + i;
        e[k] = base + 0.22 * (ridge * ridge - 0.45) * clamp(base * 2 + 0.5, 0, 1);
        m[k] = fbm(nM, x * 2.1 + 3, y * 2.1 + 7, z * 2.1 + 11, 4);
        c[k] = fbm(nC, x * 2.6 + q * 2, y * 4.5, z * 2.6 - q * 2, 5);
      }
    }
    return { e: e, m: m, c: c, lat: lat, cosLat: cosLat };
  };

  // Niveau de la mer : altitude sous laquelle se trouve la fraction « water » de la surface
  function seaLevel(F, water) {
    if (water <= 0) return -9;
    var bins = 2000, lo = -1.6, hi = 1.6, hist = new Float64Array(bins), total = 0;
    for (var j = 0; j < H; j++) {
      var w = F.cosLat[j];
      for (var i = 0; i < W; i++) {
        var b = clamp(Math.floor((F.e[j * W + i] - lo) / (hi - lo) * bins), 0, bins - 1);
        hist[b] += w; total += w;
      }
    }
    var acc = 0, target = total * water;
    for (var k = 0; k < bins; k++) { acc += hist[k]; if (acc >= target) return lo + (k + 1) / bins * (hi - lo); }
    return hi;
  }

  // ---------- Paramètres aléatoires d'une planète ----------
  PG.randomParams = function (seed) {
    var r = PG.rng('params' + seed);
    var s = r(), star = s < 0.25 ? 'M' : s < 0.55 ? 'K' : s < 0.85 ? 'G' : 'F';
    return {
      star: star,
      S: +(clamp(0.55 + r() * 0.85 + (r() < 0.2 ? r() * 0.7 - 0.25 : 0), 0.25, 2.2)).toFixed(2),
      water: Math.round(clamp(Math.pow(r(), 0.8) * 0.92 + 0.04, 0, 1) * 100) / 100,
      P: +Math.pow(10, r() * 1.15 - 0.55).toFixed(2),
      R: +(0.6 + r() * 1.2).toFixed(2),
      tilt: Math.round(r() * 45),
      dayH: Math.round(8 + r() * r() * 62),
      moons: Math.floor(r() * 3.4)
    };
  };

  // ---------- Climat et biomes ----------
  PG.classify = function (F, prm) {
    var star = PG.STARS[prm.star], g = prm.R, P = prm.P;
    var Tmean = 255 * Math.pow(prm.S, 0.25) + 33 * Math.sqrt(P) - 273.15;
    var grad = clamp(42 / Math.sqrt(Math.max(P, 0.05)), 12, 75);
    var boil = P < 0.01 ? -Infinity : 100 + 28 * Math.log(P);
    var sea = seaLevel(F, prm.water);
    var Hmax = 9 / g, lapse = 6.5 * Math.min(1, P + 0.2);
    var n = W * H, i, j, k;

    var minE = Infinity, maxE = -Infinity;
    for (k = 0; k < n; k++) { if (F.e[k] < minE) minE = F.e[k]; if (F.e[k] > maxE) maxE = F.e[k]; }

    var T = new Float32Array(n), M = new Float32Array(n), alt = new Float32Array(n), biome = new Uint8Array(n);
    var totalW = 0, liquidW = 0, coolW = 0, tSum = 0;

    // Passe 1 : altitude et température
    for (j = 0; j < H; j++) {
      var s2 = Math.sin(F.lat[j]); s2 *= s2;
      var w = F.cosLat[j];
      for (i = 0; i < W; i++) {
        k = j * W + i;
        var e = F.e[k], t = Tmean + grad / 3 - grad * s2 + F.c[k] * 4;
        if (e < sea) {
          alt[k] = -Math.pow((sea - e) / (sea - minE), 0.9) * 8 / g;
          t = Tmean + (t - Tmean) * 0.8;
          if (t > -4 && t < boil && P >= 0.01) { liquidW += w; if (t < 75) coolW += w; }
        } else {
          alt[k] = Math.pow((e - sea) / (maxE - sea + 1e-6), 1.35) * Hmax;
          t -= alt[k] * lapse;
        }
        T[k] = t; totalW += w; tSum += t * w;
      }
    }
    var liquid = liquidW / totalW;
    // La vie demande de l'eau liquide qui ne soit pas brûlante
    var alive = P >= 0.05 && coolW / totalW >= 0.005;
    var wet = liquid > 0 ? (0.35 + 0.65 * Math.sqrt(liquid)) * (0.6 + 0.4 * Math.min(1, P)) : 0.03;

    // Passe 2 : humidité, biomes, statistiques
    var stats = [];
    for (k = 0; k < PG.BIOMES.length; k++) stats.push({ id: k, w: 0, T: 0, M: 0, lat: 0 });
    for (j = 0; j < H; j++) {
      var la = F.lat[j], band = 0.2 * Math.cos(6 * la), wj = F.cosLat[j], absLat = Math.abs(la) * 180 / Math.PI;
      for (i = 0; i < W; i++) {
        k = j * W + i;
        var tt = T[k], a = alt[k], b;
        var hum = clamp((0.5 + 0.6 * F.m[k] + band) * wet - Math.max(0, a) / Hmax * 0.2, 0, 1);
        if (a < 0) {
          hum = liquid > 0 ? 1 : 0;
          if (tt <= -4) b = prm.water > 0 && P >= 0.01 || tt < -40 ? B.SEA_ICE : B.SALT;
          else if (tt >= boil || P < 0.01) b = B.SALT;
          else b = a > -1.6 / g ? B.SHALLOW : B.DEEP;
        } else if (tt > 250) b = B.LAVA;
        else if (tt > 60 || (P >= 0.01 && tt >= boil)) b = B.SCORCHED;
        else if (a / Hmax > 0.5) b = B.MOUNTAIN;
        else if (tt < -12) b = wet > 0.1 ? B.ICE : B.BARREN;
        else if (!alive) b = B.BARREN;
        else if (tt < 0) b = B.TUNDRA;
        else if (tt < 7) b = hum < 0.3 ? B.COLD_STEPPE : B.TAIGA;
        else if (tt < 20) b = hum < 0.25 ? B.ARID : hum < 0.5 ? B.GRASS : B.FOREST;
        else b = hum < 0.22 ? B.DESERT : hum < 0.5 ? B.SAVANNA : hum < 0.62 && tt < 26 ? B.FOREST : B.JUNGLE;
        M[k] = hum; biome[k] = b;
        var st = stats[b]; st.w += wj; st.T += tt * wj; st.M += hum * wj; st.lat += absLat * wj;
      }
    }
    var radiusKm = 6371 * prm.R, surface = 4 * Math.PI * radiusKm * radiusKm;
    stats.forEach(function (s) {
      s.frac = s.w / totalW; s.area = s.frac * surface;
      if (s.w) { s.T /= s.w; s.M /= s.w; s.lat /= s.w; }
    });

    // Nuages
    var cover = clamp(liquid * 1.1, 0, 1) * clamp(P, 0, 1.2) / 1.2 * 0.85;
    var haze = P > 3 && Tmean > 60;
    if (haze) cover = Math.max(cover, 0.75);
    var cloud = new Uint8Array(n), thr = 0.34 - cover * 0.5;
    if (cover > 0.02) for (k = 0; k < n; k++) cloud[k] = smooth(thr, thr + 0.22, F.c[k]) * 235;

    var f = function (id) { return stats[id].frac; };
    var land = 1 - f(B.DEEP) - f(B.SHALLOW) - f(B.SEA_ICE) - f(B.SALT);
    var verdict;
    if (P < 0.05) verdict = 'Monde sans air';
    else if (!alive) verdict = Tmean > 60 ? 'Fournaise' : Tmean < -20 ? 'Boule de glace' : 'Désert planétaire';
    else if (tSum / totalW > 55) verdict = 'Monde étuve';
    else if (f(B.DEEP) + f(B.SHALLOW) > 0.85) verdict = 'Monde océan';
    else if (f(B.SEA_ICE) + f(B.ICE) + f(B.TUNDRA) > 0.55) verdict = 'Monde glacé';
    else if (f(B.DESERT) + f(B.ARID) + f(B.SCORCHED) > land * 0.5) verdict = 'Monde aride';
    else if (f(B.JUNGLE) + f(B.FOREST) + f(B.TAIGA) > land * 0.45) verdict = 'Monde-jardin';
    else verdict = 'Monde tempéré';

    var au = Math.sqrt(star.lum / prm.S);
    return {
      prm: prm, star: star, F: F, T: T, M: M, alt: alt, biome: biome, cloud: cloud, stats: stats,
      Tmean: tSum / totalW, boil: boil, liquid: liquid, alive: alive, haze: haze, verdict: verdict,
      g: g, radiusKm: radiusKm, surface: surface, landFrac: land, Hmax: Hmax,
      au: au, yearDays: Math.sqrt(au * au * au / star.mass) * 365.25,
      lights: new Uint8Array(n)
    };
  };

  // ---------- Textures ----------
  function ramp(stops, v) {
    for (var i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i];
        return mix(a[1], b[1], clamp((v - a[0]) / (b[0] - a[0]), 0, 1));
      }
    }
    return stops[stops.length - 1][1];
  }
  var TEMP_RAMP = [[-70, [40, 20, 110]], [-35, [50, 90, 200]], [-10, [130, 200, 235]], [5, [235, 245, 230]], [18, [140, 205, 110]], [30, [245, 215, 80]], [45, [235, 120, 50]], [80, [170, 30, 40]], [250, [70, 10, 30]]];
  var HUM_RAMP = [[0, [205, 170, 115]], [0.25, [200, 195, 120]], [0.5, [110, 175, 100]], [0.75, [45, 130, 140]], [1, [30, 70, 160]]];
  var LAND_RAMP = [[0, [70, 130, 70]], [0.12, [150, 175, 95]], [0.3, [205, 190, 120]], [0.55, [150, 110, 80]], [0.8, [120, 105, 100]], [1, [245, 245, 250]]];

  // Couleur de chaque biome ; la végétation prend la teinte adaptée à l'étoile
  PG.palette = function (star) {
    var veg = star.veg, vegLight = mix(veg, [230, 220, 150], 0.45), vegDark = mix(veg, [8, 16, 20], 0.45);
    var col = [];
    col[B.DEEP] = [12, 38, 90]; col[B.SHALLOW] = [30, 96, 152]; col[B.SEA_ICE] = [212, 227, 238]; col[B.ICE] = [240, 245, 250];
    col[B.TUNDRA] = mix(vegLight, [160, 160, 150], 0.6); col[B.TAIGA] = vegDark; col[B.COLD_STEPPE] = mix(vegLight, [180, 170, 130], 0.6);
    col[B.FOREST] = veg; col[B.GRASS] = vegLight; col[B.ARID] = mix([192, 166, 116], veg, 0.15); col[B.DESERT] = [222, 190, 130];
    col[B.SAVANNA] = mix(vegLight, [200, 160, 90], 0.5); col[B.JUNGLE] = mix(veg, vegDark, 0.55); col[B.MOUNTAIN] = [122, 113, 106];
    col[B.SCORCHED] = [112, 62, 42]; col[B.SALT] = [224, 214, 198]; col[B.BARREN] = [126, 119, 113]; col[B.LAVA] = [58, 24, 20];
    return col;
  };

  PG.texture = function (pl, mode) {
    var n = W * H, out = new Uint8ClampedArray(n * 4), col = PG.palette(pl.star);

    for (var k = 0; k < n; k++) {
      var c, a = pl.alt[k], b = pl.biome[k];
      if (mode === 'temp') c = ramp(TEMP_RAMP, pl.T[k]);
      else if (mode === 'hum') c = a < 0 ? [24, 44, 96] : ramp(HUM_RAMP, pl.M[k]);
      else if (mode === 'relief') c = a < 0 ? mix([60, 130, 190], [8, 22, 66], clamp(-a * pl.g / 8, 0, 1)) : ramp(LAND_RAMP, a / pl.Hmax);
      else {
        c = col[b];
        if (b === B.DEEP) c = mix([22, 70, 128], c, clamp(-a * pl.g / 5, 0, 1));
        else if (b === B.MOUNTAIN && pl.T[k] < -3) c = [236, 239, 244];
        else if (b === B.LAVA && pl.F.m[k] > 0.12) c = [255, 130, 40];
      }
      if (a > 0 && mode !== 'temp' && mode !== 'hum') {
        var shade = clamp(1 + (pl.F.e[k] - pl.F.e[(k + 1) % n]) * 9, 0.72, 1.28);
        c = [c[0] * shade, c[1] * shade, c[2] * shade];
      }
      var o = k * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
    return out;
  };

  // ---------- Globe ----------
  PG.Globe = function (canvas) {
    var N = canvas.width, ctx = canvas.getContext('2d');
    var R = N / 2 - 26, c = N / 2;
    var img = ctx.createImageData(N, N), base = new Uint8ClampedArray(N * N * 4);
    var px = [], row, col0, lit, rim, spec, count = 0;
    var L = [-0.55, 0.38, 0.74], Ln = Math.hypot(L[0], L[1], L[2]);
    L = [L[0] / Ln, L[1] / Ln, L[2] / Ln];
    var Hv = [L[0], L[1], L[2] + 1], Hn = Math.hypot(Hv[0], Hv[1], Hv[2]);
    Hv = [Hv[0] / Hn, Hv[1] / Hn, Hv[2] / Hn];
    var atm = [110, 170, 255], atmK = 1;

    this.build = function (pl) {
      var tilt = pl.prm.tilt * Math.PI / 180, ct = Math.cos(tilt), stl = Math.sin(tilt);
      atm = pl.haze ? [235, 205, 140] : pl.star.sky;
      atmK = clamp(pl.prm.P, 0, 1.6) / 1.6;
      px = []; var rows = [], cols = [], lits = [], rims = [], specs = [];
      base.fill(0);
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var dx = (x - c) / R, dy = (c - y) / R, r2 = dx * dx + dy * dy;
          if (r2 <= 1) {
            var z = Math.sqrt(1 - r2);
            var xr = dx * ct + dy * stl, yr = -dx * stl + dy * ct;
            var la = Math.asin(clamp(yr, -1, 1)), lo = Math.atan2(xr, z);
            px.push(y * N + x);
            rows.push(clamp(Math.floor((0.5 - la / Math.PI) * H), 0, H - 1) * W);
            cols.push(Math.floor((lo / (2 * Math.PI) + 0.5) * W));
            var ndl = dx * L[0] + dy * L[1] + z * L[2];
            lits.push(smooth(-0.1, 0.3, ndl) * (0.35 + 0.65 * Math.max(0, ndl)));
            rims.push(Math.pow(1 - z, 2.6));
            specs.push(Math.pow(Math.max(0, dx * Hv[0] + dy * Hv[1] + z * Hv[2]), 60));
          } else if (r2 < 1.21 && atmK > 0.02) {
            var r = Math.sqrt(r2), edge = (dx * L[0] + dy * L[1]) / r;
            var al = Math.pow(1 - (r - 1) / 0.1, 2.4) * smooth(-0.5, 0.5, edge) * atmK;
            if (r < 1.1 && al > 0) {
              var o = (y * N + x) * 4;
              base[o] = atm[0]; base[o + 1] = atm[1]; base[o + 2] = atm[2]; base[o + 3] = al * 200;
            }
          }
        }
      }
      count = px.length;
      row = Int32Array.from(rows); col0 = Int32Array.from(cols);
      lit = Float32Array.from(lits); rim = Float32Array.from(rims); spec = Float32Array.from(specs);
    };

    this.draw = function (pl, tex, shift, natural) {
      var d = img.data;
      d.set(base);
      var s = ((Math.round(shift) % W) + W) % W, cs = ((Math.round(shift * 1.18) % W) + W) % W;
      var cloudCol = pl.haze ? [236, 214, 160] : [255, 255, 255];
      for (var k = 0; k < count; k++) {
        var cell = row[k] + (col0[k] + s) % W, t = cell * 4;
        var r = tex[t], g = tex[t + 1], b = tex[t + 2], l = lit[k];
        if (natural) {
          var bio = pl.biome[cell];
          if (bio < 2) { var sp = spec[k] * 190; r += sp; g += sp; b += sp; }
          var ca = pl.cloud[row[k] + (col0[k] + cs) % W] / 255;
          if (ca) { r += (cloudCol[0] - r) * ca; g += (cloudCol[1] - g) * ca; b += (cloudCol[2] - b) * ca; }
          var light = 0.03 + l;
          r *= light; g *= light; b *= light;
          if (bio === B.LAVA && l < 0.3) { r += 120 * (1 - l / 0.3) * (tex[t] > 200 ? 1 : 0.15); g += 40 * (1 - l / 0.3) * (tex[t] > 200 ? 1 : 0); }
          var nl = pl.lights[cell];
          if (nl && l < 0.16) { var q = (1 - l / 0.16) * nl / 255 * (1 - ca); r += 255 * q; g += 205 * q; b += 120 * q; }
          var ar = rim[k] * atmK * (0.25 + l) * 1.3;
          r += atm[0] * ar; g += atm[1] * ar; b += atm[2] * ar;
        } else {
          var fl = 0.55 + 0.5 * l;
          r *= fl; g *= fl; b *= fl;
        }
        var o = px[k] * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
  };
})();
