(function () {
  'use strict';

  var racine = typeof window !== 'undefined' ? window : globalThis;

  var COULEURS_MAX = 256;                 // taille maximale d'une palette
  var TEINTE_FROIDE = 265;                // teinte OKLCH vers laquelle tirent les ombres
  var TEINTE_CHAUDE = 85;                 // teinte OKLCH vers laquelle tirent les lumières
  var NEUTRE = 0.025;                     // chroma OKLCH sous laquelle une couleur compte comme un gris

  // Matrices de Machado, Oliveira et Fernandes (2009), sévérité totale, en RVB linéaire.
  var VISIONS = [
    { id: 'normale', nom: 'Vision normale' },
    { id: 'protan', nom: 'Protanopie (sans rouge)', m: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998] },
    { id: 'deutan', nom: 'Deutéranopie (sans vert)', m: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881] },
    { id: 'tritan', nom: 'Tritanopie (sans bleu)', m: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900] },
    { id: 'achro', nom: 'Achromatopsie (sans couleur)', m: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722] }
  ];

  // Une couleur de palette est un texte « rrggbb » en minuscules ; les calculs se font sur [r, v, b] entre 0 et 255.
  var P = racine.Palettes = { COULEURS_MAX: COULEURS_MAX, VISIONS: VISIONS, NEUTRE: NEUTRE };

  function borne(v, a, b) { return v < a ? a : v > b ? b : v; }
  P.borne = borne;

  // ---------- Hexadécimal ----------
  function hexVersRgb(s) {
    s = String(s).trim().replace(/^#/, '');
    if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
    if (s.length === 3) s = s.replace(/./g, '$&$&');
    var n = parseInt(s.slice(0, 6), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgbVersHex(c) { return ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1); }
  // Rend « rrggbb », ou null si le texte n'est pas une couleur.
  function hexPropre(s) {
    var c = hexVersRgb(s);
    return c ? rgbVersHex(c) : null;
  }
  P.hexVersRgb = hexVersRgb; P.rgbVersHex = rgbVersHex; P.hexPropre = hexPropre;

  // ---------- Teinte, saturation, valeur ----------
  function rgbVersHsv(c) {
    var r = c[0], g = c[1], b = c[2], max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return { h: h * 60, s: max ? d / max : 0, v: max / 255 };
  }
  function hsvVersRgb(h, s, v) {
    var f = function (n) {
      var k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return [f(5), f(3), f(1)];
  }
  P.rgbVersHsv = rgbVersHsv; P.hsvVersRgb = hsvVersRgb;

  // ---------- OKLab ----------
  var LIN = new Float64Array(256);
  (function () {
    for (var i = 0; i < 256; i++) LIN[i] = i / 255 <= 0.04045 ? i / 255 / 12.92 : Math.pow((i / 255 + 0.055) / 1.055, 2.4);
  })();
  function delin(v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }

  var K1 = 0.206, K2 = 0.03, K3 = (1 + K1) / (1 + K2);     // le « pied » de clarté proposé par Ottosson

  // OKLab tel que publié.
  function rgbVersOklab(c) {
    var r = LIN[c[0]], g = LIN[c[1]], b = LIN[c[2]];
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  // L'espace où se font tous les calculs. OKLab brut écarte beaucoup trop les teintes presque noires (sa racine
  // cubique n'a pas de pied) : la clarté passe par le pied d'Ottosson, et a, b sont réduits dans la même proportion.
  function rgbVersLab(c) {
    var q = rgbVersOklab(c), x = K3 * q[0] - K1, lr = 0.5 * (x + Math.sqrt(x * x + 4 * K2 * K3 * q[0])), k = q[0] > 1e-9 ? lr / q[0] : 0;
    return [lr, q[1] * k, q[2] * k];
  }
  function versOklab(q) {
    var l = q[0] * (q[0] + K1) / (K3 * (q[0] + K2)), k = q[0] > 1e-9 ? l / q[0] : 0;
    return [l, q[1] * k, q[2] * k];
  }
  // Rend [r, v, b] en nombres réels, peut-être hors de 0…255 si la couleur sort du gamut.
  function labVersRgbBrut(q) {
    q = versOklab(q);
    var l = q[0] + 0.3963377774 * q[1] + 0.2158037573 * q[2], m = q[0] - 0.1055613458 * q[1] - 0.0638541728 * q[2], s = q[0] - 0.0894841775 * q[1] - 1.291485548 * q[2];
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [
      255 * delin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      255 * delin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      255 * delin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
    ];
  }
  function arrondir(c) { return [borne(Math.round(c[0]), 0, 255), borne(Math.round(c[1]), 0, 255), borne(Math.round(c[2]), 0, 255)]; }
  function labVersRgb(q) { return arrondir(labVersRgbBrut(q)); }

  function labVersLch(q) {
    var h = Math.atan2(q[2], q[1]) * 180 / Math.PI;
    return [q[0], Math.sqrt(q[1] * q[1] + q[2] * q[2]), h < 0 ? h + 360 : h];
  }
  function lchVersLab(q) {
    var a = q[2] * Math.PI / 180;
    return [q[0], q[1] * Math.cos(a), q[1] * Math.sin(a)];
  }
  function dansGamut(c) { return c[0] > -0.5 && c[0] < 255.5 && c[1] > -0.5 && c[1] < 255.5 && c[2] > -0.5 && c[2] < 255.5; }
  // Une couleur hors gamut est ramenée dedans en baissant sa chroma, sans toucher à sa clarté ni à sa teinte.
  function lchVersRgb(q) {
    var l = borne(q[0], 0, 1), c = Math.max(0, q[1]), brut = labVersRgbBrut(lchVersLab([l, c, q[2]])), bas = 0, haut = c, i;
    if (dansGamut(brut)) return arrondir(brut);
    for (i = 0; i < 20; i++) {
      c = (bas + haut) / 2;
      if (dansGamut(labVersRgbBrut(lchVersLab([l, c, q[2]])))) bas = c; else haut = c;
    }
    return arrondir(labVersRgbBrut(lchVersLab([l, bas, q[2]])));
  }
  function rgbVersLch(c) { return labVersLch(rgbVersLab(c)); }
  P.rgbVersOklab = rgbVersOklab;
  P.rgbVersLab = rgbVersLab; P.labVersRgb = labVersRgb; P.labVersLch = labVersLch; P.lchVersLab = lchVersLab;
  P.lchVersRgb = lchVersRgb; P.rgbVersLch = rgbVersLch;

  // Distance perceptuelle : 100 × la distance dans l'espace de travail. Autour de 2, deux aplats voisins se distinguent à peine.
  function ecartLab(a, b) {
    var dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return 100 * Math.sqrt(dl * dl + da * da + db * db);
  }
  function ecart(a, b) { return ecartLab(rgbVersLab(a), rgbVersLab(b)); }
  // Clarté perçue de 0 à 100.
  function clarte(c) { return 100 * rgbVersLab(c)[0]; }
  P.ecartLab = ecartLab; P.ecart = ecart; P.clarte = clarte;

  // ---------- Contraste WCAG ----------
  function luminance(c) { return 0.2126 * LIN[c[0]] + 0.7152 * LIN[c[1]] + 0.0722 * LIN[c[2]]; }
  function contraste(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // Noir ou blanc : celui qui se lit le mieux posé sur c.
  function encre(c) { return luminance(c) > 0.179 ? '#000000' : '#ffffff'; }
  function niveau(ratio) { return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA grands textes' : 'insuffisant pour du texte'; }
  P.luminance = luminance; P.contraste = contraste; P.encre = encre; P.niveau = niveau;

  // ---------- Daltonisme ----------
  function vision(id) {
    for (var i = 0; i < VISIONS.length; i++) if (VISIONS[i].id === id) return VISIONS[i];
    return VISIONS[0];
  }
  function simuler(c, id) {
    var m = vision(id).m, r, g, b;
    if (!m) return [c[0], c[1], c[2]];
    r = LIN[c[0]]; g = LIN[c[1]]; b = LIN[c[2]];
    return arrondir([
      255 * delin(borne(m[0] * r + m[1] * g + m[2] * b, 0, 1)),
      255 * delin(borne(m[3] * r + m[4] * g + m[5] * b, 0, 1)),
      255 * delin(borne(m[6] * r + m[7] * g + m[8] * b, 0, 1))
    ]);
  }
  // Simule toute une image RVBA d'un coup ; rend un nouveau tampon.
  function simulerImage(data, id) {
    var m = vision(id).m, o = new Uint8ClampedArray(data.length), table = new Uint8Array(4097), i, r, g, b;
    if (!m) { o.set(data); return o; }
    for (i = 0; i <= 4096; i++) table[i] = Math.round(255 * delin(i / 4096));
    for (i = 0; i < data.length; i += 4) {
      r = LIN[data[i]]; g = LIN[data[i + 1]]; b = LIN[data[i + 2]];
      o[i] = table[Math.round(4096 * borne(m[0] * r + m[1] * g + m[2] * b, 0, 1))];
      o[i + 1] = table[Math.round(4096 * borne(m[3] * r + m[4] * g + m[5] * b, 0, 1))];
      o[i + 2] = table[Math.round(4096 * borne(m[6] * r + m[7] * g + m[8] * b, 0, 1))];
      o[i + 3] = data[i + 3];
    }
    return o;
  }
  P.simuler = simuler; P.simulerImage = simulerImage;

  // ---------- Rampes et harmonies ----------
  // Tourne la teinte h vers la cible d'au plus « pas » degrés, par le plus court chemin, sans la dépasser.
  function tirerVers(h, cible, pas) {
    var d = ((cible - h + 540) % 360) - 180;
    if (Math.abs(d) <= pas) return cible;
    return (h + (d > 0 ? pas : -pas) + 360) % 360;
  }

  // Décline une couleur de l'ombre à la lumière. o : { tons, etendue (clarté parcourue, 0…100),
  // decalage (degrés de teinte aux extrémités), saturation (0…1 : chroma gardée aux extrémités) }.
  // La couleur de base se retrouve telle quelle au milieu de la rampe.
  function rampe(base, o) {
    var tons = borne(Math.round(o.tons) || 5, 2, 12), lch = rgbVersLch(base), etendue = borne(o.etendue === undefined ? 60 : o.etendue, 5, 100) / 100;
    var decalage = o.decalage === undefined ? 20 : o.decalage, garde = o.saturation === undefined ? 0.6 : o.saturation;
    var bas = Math.max(0.06, lch[0] - etendue / 2), haut = Math.min(0.975, bas + etendue), out = [], milieu, i, t, l, h, c;
    bas = Math.max(0.06, haut - etendue);
    // Le ton qui porte la couleur de base est celui dont la clarté en est la plus proche.
    milieu = borne(Math.round((lch[0] - bas) / (haut - bas) * (tons - 1)), 0, tons - 1);
    for (i = 0; i < tons; i++) {
      if (i === milieu) { out.push([base[0], base[1], base[2]]); continue; }
      if (i < milieu) { t = (milieu - i) / milieu; l = lch[0] + (bas - lch[0]) * t; h = tirerVers(lch[2], TEINTE_FROIDE, decalage * t); }
      else { t = (i - milieu) / (tons - 1 - milieu); l = lch[0] + (haut - lch[0]) * t; h = tirerVers(lch[2], TEINTE_CHAUDE, decalage * t); }
      c = lch[1] * (1 - (1 - garde) * t * t);
      // Un gris reste gris : il n'a pas de teinte à décaler.
      out.push(lchVersRgb([l, lch[1] < NEUTRE ? lch[1] : c, lch[1] < NEUTRE ? lch[2] : h]));
    }
    return out;
  }

  var HARMONIES = [
    { id: 'complementaire', nom: 'Complémentaire', angles: [0, 180] },
    { id: 'divisee', nom: 'Complémentaire divisée', angles: [0, 150, 210] },
    { id: 'triade', nom: 'Triade', angles: [0, 120, 240] },
    { id: 'tetrade', nom: 'Tétrade (carré)', angles: [0, 90, 180, 270] },
    { id: 'rectangle', nom: 'Double complémentaire', angles: [0, 60, 180, 240] },
    { id: 'analogues', nom: 'Analogues', angles: [-30, 0, 30] },
    { id: 'analogues5', nom: 'Analogues larges', angles: [-60, -30, 0, 30, 60] },
    { id: 'mono', nom: 'Monochrome', angles: [0] }
  ];
  // Les teintes d'une harmonie : même clarté et même chroma que la base, teinte tournée dans OKLCH.
  function harmonie(base, id) {
    var lch = rgbVersLch(base), h = HARMONIES.filter(function (x) { return x.id === id; })[0] || HARMONIES[0];
    return h.angles.map(function (a) {
      return a === 0 ? [base[0], base[1], base[2]] : lchVersRgb([lch[0], lch[1], (lch[2] + a + 360) % 360]);
    });
  }
  P.HARMONIES = HARMONIES; P.rampe = rampe; P.harmonie = harmonie;
})();
