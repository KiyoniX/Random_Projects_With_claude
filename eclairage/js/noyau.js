(function () {
  'use strict';

  var COTE_MAX = 512;          // côté maximal d'un sprite, en pixels
  var IMAGES_MAX = 64;         // images d'une animation venue d'Atelier Pixel
  var HIST_MAX = 120;          // profondeur de l'historique
  var HIST_OCTETS = 96 * 1024 * 1024;
  var COULEURS_MAX = 256;
  var FORMAT = 'eclairage', FORMAT_ATELIER = 'atelier-pixel', FORMAT_PALETTE = 'palette';
  var NEUTRE = 0.025;          // chroma OKLCH sous laquelle une couleur compte comme un gris (comme dans Palettes)
  var SEUIL_RAMPE = 0.13;      // écart de chroma relative au-delà duquel deux couleurs ne sont plus de la même rampe
  var POIDS_CLARTE = 0.25;     // ce que compte l'écart de clarté dans cet écart
  var POIDS_TEINTE = 0.3;      // ce que compte la teinte, à côté de la clarté, pour choisir un ton dans une rampe
  var OMBRE_PAS = 40;          // longueur maximale d'une ombre portée, en pixels
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // Un pixel est un entier 0xAABBGGRR, comme dans Atelier Pixel ; transparent vaut 0.
  // Chaque image garde trois cartes de même taille :
  //   pix   : le sprite ;
  //   haut  : la hauteur de chaque pixel, de 0 à 255 (Uint8Array) ;
  //   norm  : les normales peintes à la main, codées comme une carte de normales (x → R, y vers le haut → G, z → B),
  //           alpha 255 là où il y en a une, 0 ailleurs. Elles l'emportent sur celles qu'on tire de la hauteur.
  var E = window.Eclairage = {
    COTE_MAX: COTE_MAX, IMAGES_MAX: IMAGES_MAX, BAYER: BAYER,
    doc: null,
    rev: 0,                 // augmente à chaque changement du relief ou du sprite
    revPalette: 0,          // augmente quand la palette de rendu change
    surChange: null
  };

  // L'encodeur GIF est celui d'Atelier Pixel, chargé juste après : il s'accroche à cet objet.
  window.Atelier = window.Atelier || {};

  function borne(v, min, max) { return v < min ? min : v > max ? max : v; }
  function rgba(r, g, b, a) { return (a << 24 | b << 16 | g << 8 | r) >>> 0; }
  function hex2(v) { return (v < 16 ? '0' : '') + v.toString(16); }
  function versHex(c) { return '#' + hex2(c & 255) + hex2(c >>> 8 & 255) + hex2(c >>> 16 & 255); }
  function depuisHex(s) {
    var m = /^#?([0-9a-f]{6}|[0-9a-f]{3})(?:[0-9a-f]{2}|[0-9a-f])?$/i.exec(String(s || '').trim()), n;
    if (!m) return null;
    n = parseInt(m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1], 16);
    return rgba(n >> 16 & 255, n >> 8 & 255, n & 255, 255);
  }
  E.borne = borne; E.rgba = rgba; E.versHex = versHex; E.depuisHex = depuisHex;

  // Pose b par-dessus a.
  function sur(a, b) {
    var ab = b >>> 24, aa, s;
    if (ab === 255 || !a) return b;
    if (!ab) return a;
    aa = (a >>> 24) * (255 - ab) / 255; s = ab + aa;
    return rgba(Math.round(((b & 255) * ab + (a & 255) * aa) / s), Math.round(((b >>> 8 & 255) * ab + (a >>> 8 & 255) * aa) / s), Math.round(((b >>> 16 & 255) * ab + (a >>> 16 & 255) * aa) / s), Math.round(s));
  }

  // ---------- Couleur ----------
  // Le calcul de lumière se fait en RVB linéaire ; les clartés se comparent en OKLab.
  var LIN = new Float32Array(256), SRGB = new Uint8Array(4096), i0;
  for (i0 = 0; i0 < 256; i0++) { var v0 = i0 / 255; LIN[i0] = v0 <= 0.04045 ? v0 / 12.92 : Math.pow((v0 + 0.055) / 1.055, 2.4); }
  for (i0 = 0; i0 < 4096; i0++) { var l0 = i0 / 4095; SRGB[i0] = Math.round(255 * (l0 <= 0.0031308 ? l0 * 12.92 : 1.055 * Math.pow(l0, 1 / 2.4) - 0.055)); }
  function versSrgb(l) { return l <= 0 ? 0 : l >= 1 ? 255 : SRGB[(l * 4095 + 0.5) | 0]; }

  function oklab(r, g, b) {
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function linDe(c) { return [LIN[c & 255], LIN[c >>> 8 & 255], LIN[c >>> 16 & 255]]; }
  function labDe(c) { var l = linDe(c); return oklab(l[0], l[1], l[2]); }
  E.labDe = labDe;
  E.hexLin = function (h) { return linDe(depuisHex(h) || 0xffffffff); };

  // ---------- Historique ----------
  // Un état retient les cartes de chaque image et la palette. Les tableaux sont partagés et figés :
  // une opération qui en modifie un passe par ecrireHaut / ecrireNorm, qui le recopie s'il est figé.
  var passe = [], futur = [];

  function instantane() {
    var d = E.doc;
    return {
      iImage: d.iImage, palette: d.palette, paletteNom: d.paletteNom,
      images: d.images.map(function (im) { im.haut.fige = true; im.norm.fige = true; return { haut: im.haut, norm: im.norm }; })
    };
  }
  function restaurer(s) {
    var d = E.doc;
    d.palette = s.palette; d.paletteNom = s.paletteNom;
    s.images.forEach(function (t, i) { if (d.images[i]) { d.images[i].haut = t.haut; d.images[i].norm = t.norm; } });
    d.iImage = borne(s.iImage, 0, d.images.length - 1);
  }
  function octets(pile) {
    var vus = new Set(), n = 0;
    pile.forEach(function (s) { s.images.forEach(function (t) { [t.haut, t.norm].forEach(function (b) { if (!vus.has(b)) { vus.add(b); n += b.byteLength; } }); }); });
    return n;
  }

  // À appeler juste avant de modifier le relief ou la palette.
  // L'état d'avant (pile complète) reste de côté jusqu'à la marque suivante, pour qu'oublierMarque le rende tel quel.
  var avantMarque = null;
  E.marquer = function () {
    avantMarque = { passe: passe.slice(), futur: futur };
    passe.push(instantane());
    if (passe.length > HIST_MAX) passe.shift();
    while (passe.length > 2 && octets(passe) > HIST_OCTETS) passe.shift();
    futur = [];
  };
  // Retire le dernier état retenu, quand l'opération n'a finalement rien changé : « Rétablir » reste possible.
  E.oublierMarque = function () {
    if (avantMarque) { passe = avantMarque.passe; futur = avantMarque.futur; avantMarque = null; } else passe.pop();
  };
  E.change = function (palette) { E.rev++; if (palette) E.revPalette++; if (E.surChange) E.surChange(); };
  E.annuler = function () {
    if (!passe.length) return false;
    futur.push(instantane()); restaurer(passe.pop()); E.change(true);
    return true;
  };
  E.retablir = function () {
    if (!futur.length) return false;
    passe.push(instantane()); restaurer(futur.pop()); E.change(true);
    return true;
  };
  E.peutAnnuler = function () { return passe.length > 0; };
  E.peutRetablir = function () { return futur.length > 0; };
  function oublier() { passe = []; futur = []; }

  E.image = function (i) { return E.doc.images[i === undefined ? E.doc.iImage : i]; };
  E.ecrireHaut = function (i) {
    var im = E.doc.images[i];
    if (im.haut.fige) im.haut = new Uint8Array(im.haut);
    return im.haut;
  };
  E.ecrireNorm = function (i) {
    var im = E.doc.images[i];
    if (im.norm.fige) im.norm = new Uint32Array(im.norm);
    return im.norm;
  };

  // ---------- Normales ----------
  // Repère de l'écran : x vers la droite, y vers le bas, z vers celui qui regarde.
  // Le codage des fichiers suit la convention des moteurs dite « OpenGL » : y vers le haut.
  E.coderNormale = function (x, y, z) {
    var l = Math.sqrt(x * x + y * y + z * z) || 1;
    return rgba(Math.round((x / l * 0.5 + 0.5) * 255), Math.round((-y / l * 0.5 + 0.5) * 255), Math.round((z / l * 0.5 + 0.5) * 255), 255);
  };
  E.lireNormale = function (c) {
    var x = (c & 255) / 127.5 - 1, y = -((c >>> 8 & 255) / 127.5 - 1), z = (c >>> 16 & 255) / 127.5 - 1, l = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / l, y / l, z / l];
  };

  // Les normales de l'image : celles peintes à la main, sinon la pente de la hauteur (filtre de Sobel).
  // Un voisin transparent ou hors du sprite prend la hauteur du pixel lui-même : la silhouette ne fait pas de falaise,
  // c'est la pente qu'on peint qui fait tomber les bords. profondeur : ce que mesure une hauteur de 255, en pixels.
  var cacheN = {};
  E.normales = function (i, profondeur) {
    var d = E.doc, im = d.images[i], w = d.w, h = d.h, c = cacheN[i], n, N, x, y, p, hc, k, gx, gy, q, nx, ny, nz, l, s, v;
    if (c && c.haut === im.haut && c.norm === im.norm && c.rev === E.rev && c.prof === profondeur && c.w === w) return c.N;
    n = w * h; N = new Float32Array(n * 3); s = profondeur / 255 / 8;
    var H = new Float32Array(9);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x;
      if (!im.pix[p]) { N[p * 3 + 2] = 1; continue; }
      if (im.norm[p]) { v = E.lireNormale(im.norm[p]); N[p * 3] = v[0]; N[p * 3 + 1] = v[1]; N[p * 3 + 2] = v[2]; continue; }
      hc = im.haut[p]; k = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        q = (y + dy) * w + x + dx;
        H[k++] = (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h || !im.pix[q]) ? hc : im.haut[q];
      }
      gx = (H[2] + 2 * H[5] + H[8] - H[0] - 2 * H[3] - H[6]) * s;
      gy = (H[6] + 2 * H[7] + H[8] - H[0] - 2 * H[1] - H[2]) * s;
      nx = -gx; ny = -gy; nz = 1; l = Math.sqrt(nx * nx + ny * ny + 1);
      N[p * 3] = nx / l; N[p * 3 + 1] = ny / l; N[p * 3 + 2] = nz / l;
    }
    cacheN[i] = { haut: im.haut, norm: im.norm, rev: E.rev, prof: profondeur, w: w, N: N };
    return N;
  };

  // La carte de normales prête à exporter. inverserY : convention « DirectX », y vers le bas.
  E.carteNormales = function (i, profondeur, inverserY) {
    var d = E.doc, im = d.images[i], N = E.normales(i, profondeur), n = d.w * d.h, o = new Uint32Array(n), p, c;
    for (p = 0; p < n; p++) {
      if (!im.pix[p]) continue;
      c = E.coderNormale(N[p * 3], inverserY ? -N[p * 3 + 1] : N[p * 3 + 1], N[p * 3 + 2]);
      o[p] = (c & 0xffffff | (im.pix[p] >>> 24) << 24) >>> 0;
    }
    return o;
  };
  E.carteHauteur = function (i) {
    var d = E.doc, im = d.images[i], n = d.w * d.h, o = new Uint32Array(n), p, v;
    for (p = 0; p < n; p++) if (im.pix[p]) { v = im.haut[p]; o[p] = rgba(v, v, v, im.pix[p] >>> 24); }
    return o;
  };

  // ---------- Palette et rampes ----------
  // La palette de rendu : celle qu'on a chargée, ou les couleurs du sprite (et la palette du projet Atelier Pixel d'origine).
  // Les rampes se détectent comme dans Palettes : les gris ensemble, les autres par familles de teinte voisines.
  // Au plus 256 couleurs, sauf avec « toutes » : E.analyse rattache les autres à la plus proche de celles-là.
  E.couleursDuSprite = function (toutes) {
    var vues = new Set(), l = [];
    E.doc.images.forEach(function (im) {
      for (var p = 0; p < im.pix.length; p++) {
        var c = im.pix[p];
        if (c >>> 24 < 128) continue;
        c = (c | 0xff000000) >>> 0;
        if (!vues.has(c) && (toutes || l.length < COULEURS_MAX)) { vues.add(c); l.push(c); }
      }
    });
    return l;
  };

  // Dans une rampe, les tons sombres perdent de la chroma à mesure qu'ils perdent de la clarté : on compare donc
  // la chroma rapportée à la clarté (a / L, b / L), où les tons d'une même rampe restent voisins, avec un peu de clarté.
  // Les couleurs se regroupent par moyenne des écarts (une seule paire proche ne suffit pas à souder deux rampes) ;
  // une couleur restée seule rejoint la rampe la plus proche si elle n'en est pas trop loin. Les gris forment la leur.
  function rampes(couleurs) {
    var lab = couleurs.map(labDe), gris = [], vives = [], groupes = [], pts = [], i, j, q, l, D, n, taille, actif, mieux, a, b, v;
    function parL(x, y) { return lab[x][0] - lab[y][0] || x - y; }
    for (i = 0; i < couleurs.length; i++) {
      q = lab[i];
      if (Math.sqrt(q[1] * q[1] + q[2] * q[2]) < NEUTRE) { gris.push(i); continue; }
      l = Math.max(q[0], 0.2);
      vives.push(i); pts.push([q[1] / l, q[2] / l, q[0] * POIDS_CLARTE]);
    }
    n = vives.length; D = new Float64Array(n * n); taille = []; actif = []; groupes = [];
    for (i = 0; i < n; i++) {
      taille.push(1); actif.push(true); groupes.push([vives[i]]);
      for (j = 0; j < i; j++) {
        v = Math.sqrt((pts[i][0] - pts[j][0]) * (pts[i][0] - pts[j][0]) + (pts[i][1] - pts[j][1]) * (pts[i][1] - pts[j][1]) + (pts[i][2] - pts[j][2]) * (pts[i][2] - pts[j][2]));
        D[i * n + j] = D[j * n + i] = v;
      }
    }
    function fondre(seuil, seulement) {
      for (;;) {
        mieux = Infinity; a = -1;
        for (i = 0; i < n; i++) if (actif[i]) for (j = i + 1; j < n; j++) {
          if (!actif[j] || (seulement && (taille[i] > 1) === (taille[j] > 1))) continue;
          if (D[i * n + j] < mieux) { mieux = D[i * n + j]; a = i; b = j; }
        }
        if (a < 0 || mieux > seuil) return;
        // Lance et Williams : l'écart moyen au groupe fondu se tire des deux écarts d'avant.
        for (i = 0; i < n; i++) if (actif[i] && i !== a && i !== b) D[a * n + i] = D[i * n + a] = (D[a * n + i] * taille[a] + D[b * n + i] * taille[b]) / (taille[a] + taille[b]);
        taille[a] += taille[b]; actif[b] = false; groupes[a] = groupes[a].concat(groupes[b]);
      }
    }
    fondre(SEUIL_RAMPE, false);
    fondre(SEUIL_RAMPE * 1.6, true);
    groupes = groupes.filter(function (g, k) { return actif[k]; });
    // Les rampes se rangent par teinte, pour que l'affichage reste stable.
    groupes.sort(function (x, y) { return Math.atan2(lab[x[0]][2], lab[x[0]][1]) - Math.atan2(lab[y[0]][2], lab[y[0]][1]); });
    if (gris.length) groupes.unshift(gris);
    return groupes.map(function (g) {
      return g.sort(parL).map(function (k) { return { c: couleurs[k], L: lab[k][0], lab: lab[k], lin: linDe(couleurs[k]) }; });
    });
  }

  // Le trait du sprite : la couleur la plus fréquente sur le bord de la silhouette, si elle est sombre
  // et qu'elle tient surtout le bord. Un sprite sombre sans contour n'a donc pas de trait : il s'éclaire en entier.
  function chercherTrait() {
    var d = E.doc, w = d.w, h = d.h, bord = new Map(), dedans = new Map(), mieux = 0, n = 0, total = 0;
    d.images.forEach(function (im) {
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var p = y * w + x, c = im.pix[p], m;
        if (!c) continue;
        total++;
        m = x > 0 && im.pix[p - 1] && x < w - 1 && im.pix[p + 1] && y > 0 && im.pix[p - w] && y < h - 1 && im.pix[p + w] ? dedans : bord;
        m.set(c, (m.get(c) || 0) + 1);
      }
    });
    bord.forEach(function (k, c) { if (k > n) { n = k; mieux = c; } });
    // Un trait reste minoritaire : une couleur qui fait la moitié du sprite en est le corps.
    if (!mieux || labDe(mieux)[0] >= 0.42 || (dedans.get(mieux) || 0) > n || n + (dedans.get(mieux) || 0) > total / 2) return 0;
    return mieux;
  }

  // Ce que le rendu sait de chaque couleur du sprite : sa rampe, et sa couleur sans l'ombrage dessiné.
  var analyse = null;
  E.analyse = function () {
    var d = E.doc, pal, ram, idx, info, sprite, trait;
    if (analyse && analyse.rev === E.revPalette && analyse.doc === d) return analyse;
    sprite = E.couleursDuSprite();
    pal = (d.palette && d.palette.length ? d.palette : sprite).slice();
    // Les rampes comprennent toujours les couleurs du sprite : chacune doit avoir la sienne.
    var avec = sprite.slice(), dans = new Set(sprite);
    pal.forEach(function (c) { if (!dans.has(c) && avec.length < COULEURS_MAX + 64) { dans.add(c); avec.push(c); } });
    trait = chercherTrait();
    ram = rampes(avec);
    idx = new Map(); info = new Map();
    ram.forEach(function (r, k) { r.forEach(function (m) { idx.set(m.c, k); }); });
    // Sans l'ombrage dessiné, un pixel garde sa teinte mais prend la clarté du ton du milieu de sa rampe.
    // Un noir pur n'a pas de teinte à garder : il prend le ton du milieu.
    function sans(c, r) {
      var mil = r[Math.floor(r.length / 2)], lin = linDe(c), L = labDe(c)[0], f = Math.pow(mil.L / Math.max(L, 1e-6), 3);
      return { rampe: r, lin: lin, ref: L > 0.01 ? [Math.min(1, lin[0] * f), Math.min(1, lin[1] * f), Math.min(1, lin[2] * f)] : mil.lin };
    }
    sprite.forEach(function (c) { info.set(c, sans(c, ram[idx.get(c)])); });
    // Les couleurs au-delà de 256 (une image anticrénelée) suivent la rampe de la couleur retenue la plus proche.
    var reste = E.couleursDuSprite(true), labs;
    if (reste.length > sprite.length) {
      labs = sprite.map(labDe);
      reste.forEach(function (c) {
        var q, k, dd, mieux = 0, dmin = Infinity;
        if (info.has(c)) return;
        q = labDe(c);
        for (k = 0; k < labs.length; k++) { dd = (labs[k][0] - q[0]) * (labs[k][0] - q[0]) + (labs[k][1] - q[1]) * (labs[k][1] - q[1]) + (labs[k][2] - q[2]) * (labs[k][2] - q[2]); if (dd < dmin) { dmin = dd; mieux = k; } }
        info.set(c, sans(c, info.get(sprite[mieux]).rampe));
      });
    }
    analyse = {
      rev: E.revPalette, doc: d, rampes: ram, info: info, trait: trait, sprite: sprite, tronque: reste.length > sprite.length,
      palette: pal.map(function (c) { var l = linDe(c); return { c: c, lab: labDe(c), lin: l }; })
    };
    return analyse;
  };

  // ---------- Lumière ----------
  E.REGLAGES = {
    az: 315, el: 45, couleur: '#fff2dc', intensite: 1, ambiante: '#7f93b8', ambI: 0.35,
    rim: false, rimCouleur: '#ffd9a0', rimI: 0.5, spec: true, specI: 0.25, ombres: true, profondeur: 8,
    rendu: 'rampe', trame: false, aplanir: true, trait: true, prereglage: 'jour'
  };
  E.PREREGLAGES = [
    { id: 'jour', nom: 'Jour', r: { az: 315, el: 45, couleur: '#fff2dc', intensite: 1, ambiante: '#7f93b8', ambI: 0.35, rim: false, spec: true, specI: 0.25, ombres: true } },
    { id: 'crepuscule', nom: 'Crépuscule', r: { az: 255, el: 14, couleur: '#ff9a5c', intensite: 1.15, ambiante: '#5d4f86', ambI: 0.3, rim: true, rimCouleur: '#ffc98a', rimI: 0.45, spec: true, specI: 0.3, ombres: true } },
    { id: 'nuit', nom: 'Nuit bleue', r: { az: 30, el: 55, couleur: '#a9bfff', intensite: 0.6, ambiante: '#1f2c5c', ambI: 0.4, rim: true, rimCouleur: '#6f8cff', rimI: 0.35, spec: true, specI: 0.15, ombres: true } },
    { id: 'torche', nom: 'Torche', r: { az: 80, el: 22, couleur: '#ffb35a', intensite: 1.35, ambiante: '#2b2030', ambI: 0.18, rim: false, spec: true, specI: 0.35, ombres: true } },
    { id: 'lave', nom: 'Lave par en dessous', r: { az: 180, el: 18, couleur: '#ff5a1e', intensite: 1.4, ambiante: '#3a1712', ambI: 0.22, rim: true, rimCouleur: '#ffb347', rimI: 0.5, spec: true, specI: 0.2, ombres: true } }
  ];

  // Direction d'où vient la lumière. az : 0° en haut, 90° à droite (sens des aiguilles d'une montre) ; el : 0° rasant, 90° de face.
  E.direction = function (az, el) {
    var a = az * Math.PI / 180, e = el * Math.PI / 180;
    return [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)];
  };

  // L'image i éclairée, re-quantifiée selon les réglages R. az, el (facultatifs) remplacent ceux des réglages.
  E.eclairer = function (i, R, az, el) {
    var d = E.doc, im = d.images[i], w = d.w, h = d.h, n = w * h, out = new Uint32Array(n);
    var N = E.normales(i, R.profondeur), A = E.analyse(), L = E.direction(az === undefined ? R.az : az, el === undefined ? R.el : el);
    var lum = E.hexLin(R.couleur), amb = E.hexLin(R.ambiante), rim = E.hexLin(R.rimCouleur), k;
    for (k = 0; k < 3; k++) { lum[k] *= R.intensite; amb[k] *= R.ambI; rim[k] *= R.rim ? R.rimI : 0; }
    var Hx = L[0], Hy = L[1], Hz = L[2] + 1, hl = Math.sqrt(Hx * Hx + Hy * Hy + Hz * Hz), sI = R.spec ? R.specI : 0;
    Hx /= hl; Hy /= hl; Hz /= hl;
    // Le contre-jour vient de l'autre côté : il allume les bords qui tournent le dos à la lumière.
    var lxy = Math.sqrt(L[0] * L[0] + L[1] * L[1]), rx = lxy > 1e-6 ? -L[0] / lxy : 0, ry = lxy > 1e-6 ? -L[1] / lxy : 1;
    var ombre = R.ombres && lxy > 1e-3 ? ombres(im, w, h, L, R.profondeur) : null;
    var trait = R.trait ? A.trait : 0, mode = R.rendu, trame = R.trame && mode !== 'libre';
    var p, x, y, c, info, nx, ny, nz, df, s, rr, alb, r, g, b, q;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x; c = im.pix[p];
      if (!c) continue;
      if (c === trait || c >>> 24 < 128) { out[p] = c; continue; }
      info = A.info.get((c | 0xff000000) >>> 0);
      if (!info) { out[p] = c; continue; }
      nx = N[p * 3]; ny = N[p * 3 + 1]; nz = N[p * 3 + 2];
      df = nx * L[0] + ny * L[1] + nz * L[2];
      if (df < 0 || (ombre && ombre[p])) df = 0;
      s = 0;
      if (sI && df > 0) { s = nx * Hx + ny * Hy + nz * Hz; s = s > 0 ? Math.pow(s, 24) * sI : 0; }
      rr = 1 - nz; rr = rr * rr * Math.max(0, nx * rx + ny * ry) * 1.6;
      alb = R.aplanir ? info.ref : info.lin;
      r = alb[0] * (amb[0] + lum[0] * df) + lum[0] * s + rim[0] * rr * (alb[0] * 0.6 + 0.4);
      g = alb[1] * (amb[1] + lum[1] * df) + lum[1] * s + rim[1] * rr * (alb[1] * 0.6 + 0.4);
      b = alb[2] * (amb[2] + lum[2] * df) + lum[2] * s + rim[2] * rr * (alb[2] * 0.6 + 0.4);
      if (mode === 'libre') q = rgba(versSrgb(r), versSrgb(g), versSrgb(b), 255);
      else if (mode === 'palette') q = proche(A.palette, r, g, b, trame ? BAYER[(y & 3) * 4 + (x & 3)] : -1);
      else q = dansRampe(info.rampe, oklab(r > 0 ? r : 0, g > 0 ? g : 0, b > 0 ? b : 0), trame ? BAYER[(y & 3) * 4 + (x & 3)] : -1);
      out[p] = ((q & 0xffffff) | (c >>> 24) << 24) >>> 0;
    }
    return out;
  };

  // Seuil de trame : la trame ne sert qu'aux transitions, au milieu de l'écart entre deux tons.
  function tramer(t, seuil) {
    if (t < 0.3) return false;
    if (t > 0.7) return true;
    return (t - 0.3) / 0.4 * 16 > seuil + 0.5;
  }

  // Le ton de la rampe le plus proche : la clarté compte d'abord, la teinte départage (une lumière colorée tire
  // vers les tons de sa couleur). Avec la trame, le meilleur ton de l'autre côté en clarté prend sa part.
  function cout(m, t) { return (m.L - t[0]) * (m.L - t[0]) + POIDS_TEINTE * ((m.lab[1] - t[1]) * (m.lab[1] - t[1]) + (m.lab[2] - t[2]) * (m.lab[2] - t[2])); }
  function dansRampe(r, t, seuil) {
    var k, c, m = null, mc = Infinity, o = null, oc = Infinity;
    for (k = 0; k < r.length; k++) { c = cout(r[k], t); if (c < mc) { mc = c; m = r[k]; } }
    if (seuil < 0 || r.length < 2) return m.c;
    for (k = 0; k < r.length; k++) if ((r[k].L - t[0]) * (m.L - t[0]) < 0) { c = cout(r[k], t); if (c < oc) { oc = c; o = r[k]; } }
    if (!o) return m.c;
    return tramer(Math.abs(t[0] - m.L) / Math.abs(o.L - m.L), seuil) ? o.c : m.c;
  }

  // La couleur de toute la palette la plus proche en OKLab ; avec la trame, la seconde la plus proche prend sa part.
  function proche(pal, r, g, b, seuil) {
    var q = oklab(r > 0 ? r : 0, g > 0 ? g : 0, b > 0 ? b : 0), i, d, d1 = Infinity, d2 = Infinity, i1 = 0, i2 = 0, l, A, B, t, ux, uy, uz, u2;
    for (i = 0; i < pal.length; i++) {
      l = pal[i].lab; d = (l[0] - q[0]) * (l[0] - q[0]) + (l[1] - q[1]) * (l[1] - q[1]) + (l[2] - q[2]) * (l[2] - q[2]);
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; } else if (d < d2) { d2 = d; i2 = i; }
    }
    if (seuil < 0 || pal.length < 2) return pal[i1].c;
    A = pal[i1].lab; B = pal[i2].lab; ux = B[0] - A[0]; uy = B[1] - A[1]; uz = B[2] - A[2]; u2 = ux * ux + uy * uy + uz * uz;
    t = u2 ? ((q[0] - A[0]) * ux + (q[1] - A[1]) * uy + (q[2] - A[2]) * uz) / u2 : 0;
    // Au-delà de la seconde couleur, la plus proche reste seule.
    if (t <= 0 || t >= 1) return pal[i1].c;
    return tramer(t, seuil) ? pal[i2].c : pal[i1].c;
  }

  // Les pixels que le relief cache à la lumière : on remonte vers elle et on regarde si le terrain passe au-dessus du rayon.
  function ombres(im, w, h, L, profondeur) {
    var n = w * h, o = new Uint8Array(n), lxy = Math.sqrt(L[0] * L[0] + L[1] * L[1]), dx = L[0] / lxy, dy = L[1] / lxy, monte = L[2] / lxy;
    var k = profondeur / 255, x, y, p, s, sx, sy, q, h0, max = 0, hp;
    for (p = 0; p < n; p++) if (im.pix[p] && im.haut[p] > max) max = im.haut[p];
    if (!max) return o;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x;
      if (!im.pix[p]) continue;
      h0 = im.haut[p] * k;
      for (s = 1; s <= OMBRE_PAS; s++) {
        hp = h0 + monte * s;
        if (hp > max * k) break;
        sx = Math.round(x + dx * s); sy = Math.round(y + dy * s);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
        q = sy * w + sx;
        if (im.pix[q] && im.haut[q] * k > hp + 0.5) { o[p] = 1; break; }
      }
    }
    return o;
  }

  // ---------- Zones ----------
  // Le masque des pixels que touche une opération qui part de (x, y) :
  // morceau (pixels opaques qui se touchent, coins compris), matiere (même rampe, d'un seul tenant), couleur, ou tout.
  E.zone = function (i, x, y, sorte) {
    var d = E.doc, im = d.images[i], w = d.w, h = d.h, m = new Uint8Array(w * h), p0 = y * w + x, pile, k, px, py, dx, dy, j, A, rampe, ok, c0;
    if (x < 0 || y < 0 || x >= w || y >= h || !im.pix[p0]) return null;
    if (sorte === 'tout') { for (k = 0; k < m.length; k++) m[k] = im.pix[k] ? 1 : 0; return m; }
    c0 = im.pix[p0];
    if (sorte === 'matiere') {
      A = E.analyse(); rampe = (A.info.get((c0 | 0xff000000) >>> 0) || {}).rampe;
      ok = function (c) { var f = c && A.info.get((c | 0xff000000) >>> 0); return f && f.rampe === rampe; };
    } else if (sorte === 'couleur') ok = function (c) { return c === c0; };
    else ok = function (c) { return !!c; };
    pile = [p0]; m[p0] = 1;
    while (pile.length) {
      k = pile.pop(); px = k % w; py = (k - px) / w;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        if ((dx && dy && sorte !== 'morceau') || px + dx < 0 || px + dx >= w || py + dy < 0 || py + dy >= h) continue;
        j = k + dy * w + dx;
        if (!m[j] && ok(im.pix[j])) { m[j] = 1; pile.push(j); }
      }
    }
    return m;
  };

  // Distance de chaque pixel du masque au bord du masque, en pixels (chanfrein 1 / √2) ; un pixel du bord vaut 1.
  function distances(m, w, h) {
    var D = new Float32Array(w * h), x, y, p, v, R2 = Math.SQRT2;
    for (p = 0; p < D.length; p++) D[p] = m[p] ? 1e9 : 0;
    function lire(x, y) { return x < 0 || y < 0 || x >= w || y >= h ? 0 : D[y * w + x]; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x; if (!m[p]) continue;
      v = Math.min(D[p], lire(x - 1, y) + 1, lire(x, y - 1) + 1, lire(x - 1, y - 1) + R2, lire(x + 1, y - 1) + R2);
      D[p] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      p = y * w + x; if (!m[p]) continue;
      D[p] = Math.min(D[p], lire(x + 1, y) + 1, lire(x, y + 1) + 1, lire(x + 1, y + 1) + R2, lire(x - 1, y + 1) + R2);
    }
    return D;
  }

  // ---------- Opérations sur le relief ----------
  // Toutes rendent vrai si elles ont changé quelque chose ; l'appelant a marqué l'historique avant.
  E.PROFILS = { dome: 'Dôme', biseau: 'Biseau', coussin: 'Coussin' };
  function profil(t, sorte) {
    if (sorte === 'biseau') return t;
    if (sorte === 'coussin') return (1 - Math.cos(Math.PI * t)) / 2;
    return Math.sqrt(1 - (1 - t) * (1 - t));
  }

  // Pente depuis la silhouette : la hauteur monte avec la distance au bord du masque, sur « largeur » pixels.
  E.pente = function (i, m, o) {
    var d = E.doc, w = d.w, h = d.h, D = distances(m, w, h), H = E.ecrireHaut(i), base = d.images[i].haut, p, t, v, change = false;
    for (p = 0; p < m.length; p++) {
      if (!m[p]) continue;
      t = borne((D[p] - 0.5) / Math.max(1, o.largeur), 0, 1);
      v = profil(t, o.profil) * o.hauteur;
      v = Math.round(borne(o.ajouter ? base[p] + v : v, 0, 255));
      if (v !== H[p]) { H[p] = v; change = true; }
    }
    return change;
  };

  E.aplat = function (i, m, v) {
    var H = E.ecrireHaut(i), p, change = false;
    v = Math.round(borne(v, 0, 255));
    for (p = 0; p < m.length; p++) if (m[p] && H[p] !== v) { H[p] = v; change = true; }
    return change;
  };

  // Dégradé de h1 (au départ) à h2 (à l'arrivée). Radial : h1 au centre, h2 au bord ; bombé, il dessine un dôme.
  E.degrade = function (i, m, base, x0, y0, x1, y1, o) {
    var d = E.doc, w = d.w, h = d.h, H = E.ecrireHaut(i), dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy, x, y, p, t, v;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x;
      if (!m[p]) { H[p] = base[p]; continue; }
      if (o.forme === 'radial') {
        t = l2 ? borne(Math.sqrt(((x - x0) * (x - x0) + (y - y0) * (y - y0)) / l2), 0, 1) : 0;
        v = o.bombe ? o.h2 + (o.h1 - o.h2) * Math.sqrt(1 - t * t) : o.h1 + (o.h2 - o.h1) * t;
      } else {
        t = l2 ? borne(((x - x0) * dx + (y - y0) * dy) / l2, 0, 1) : 0;
        v = o.h1 + (o.h2 - o.h1) * (o.bombe ? Math.sin(t * Math.PI / 2) : t);
      }
      H[p] = Math.round(borne(v, 0, 255));
    }
  };

  // Lissage d'une zone entière : moyenne des voisins opaques, « passes » fois.
  E.lisserTout = function (i, passes) {
    var d = E.doc, im = d.images[i], w = d.w, h = d.h, H, src, k, x, y, p, s, n, dx, dy, q, change = false;
    for (k = 0; k < passes; k++) {
      src = new Uint8Array(im.haut); H = E.ecrireHaut(i);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        p = y * w + x; if (!im.pix[p]) continue;
        s = 0; n = 0;
        for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
          q = p + dy * w + dx; if (!im.pix[q]) continue;
          s += src[q]; n++;
        }
        q = Math.round(s / n);
        if (q !== H[p]) { H[p] = q; change = true; }
      }
    }
    return change;
  };
  // La moyenne autour d'un pixel, sur une hauteur donnée (pour le pinceau de lissage).
  E.moyenne = function (i, src, x, y) {
    var d = E.doc, im = d.images[i], w = d.w, h = d.h, s = 0, n = 0, dx, dy, q;
    for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
      if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
      q = (y + dy) * w + x + dx; if (!im.pix[q]) continue;
      s += src[q]; n++;
    }
    return n ? s / n : src[y * w + x];
  };

  E.inverser = function (i) {
    var im = E.doc.images[i], H = E.ecrireHaut(i), p, change = false;
    for (p = 0; p < H.length; p++) if (im.pix[p]) { H[p] = 255 - H[p]; change = true; }
    return change;
  };
  E.effacerNormales = function (i) {
    var im = E.doc.images[i], p;
    for (p = 0; p < im.norm.length && !im.norm[p]; p++) { /* cherche une normale peinte */ }
    if (p === im.norm.length) return false;
    E.ecrireNorm(i).fill(0);
    return true;
  };

  // Recopie le relief de l'image « de » sur l'image « vers », là où celle-ci est opaque.
  E.copierRelief = function (de, vers) {
    var a = E.doc.images[de], b = E.doc.images[vers], H, Nm, p, change = false;
    if (de === vers) return false;
    for (p = 0; p < a.pix.length && !change; p++) change = !!(b.pix[p] && a.pix[p]) && (a.haut[p] !== b.haut[p] || a.norm[p] !== b.norm[p]);
    if (!change) return false;
    H = E.ecrireHaut(vers); Nm = E.ecrireNorm(vers);
    for (p = 0; p < H.length; p++) if (b.pix[p] && a.pix[p]) { H[p] = a.haut[p]; Nm[p] = a.norm[p]; }
    return true;
  };

  // ---------- Documents ----------
  function imageNeuve(pix, w, h, duree) {
    var net = new Uint32Array(w * h), p;
    for (p = 0; p < net.length; p++) if (pix[p] >>> 24) net[p] = pix[p];
    return { duree: duree || 100, pix: net, haut: new Uint8Array(w * h), norm: new Uint32Array(w * h) };
  }
  function docNeuf(nom, w, h, images, palette, paletteNom, reglages) {
    var R = {}, k;
    for (k in E.REGLAGES) R[k] = E.REGLAGES[k];
    if (reglages) for (k in E.REGLAGES) if (reglages[k] !== undefined && typeof reglages[k] === typeof E.REGLAGES[k]) R[k] = reglages[k];
    R.az = ((R.az % 360) + 360) % 360; R.el = borne(R.el, 0, 90); R.intensite = borne(R.intensite, 0, 2); R.ambI = borne(R.ambI, 0, 1);
    R.rimI = borne(R.rimI, 0, 1); R.specI = borne(R.specI, 0, 1); R.profondeur = borne(Math.round(R.profondeur), 1, 32);
    ['couleur', 'ambiante', 'rimCouleur'].forEach(function (c) { if (!depuisHex(R[c])) R[c] = E.REGLAGES[c]; });
    if (['rampe', 'palette', 'libre'].indexOf(R.rendu) < 0) R.rendu = 'rampe';
    if (!E.PREREGLAGES.some(function (p) { return p.id === R.prereglage; })) R.prereglage = '';
    E.doc = { nom: nom || 'sprite', w: w, h: h, iImage: 0, images: images, palette: palette || null, paletteNom: paletteNom || '', reglages: R };
    cacheN = {}; analyse = null;
    oublier(); E.rev++; E.revPalette++;
  }

  // Un sprite neuf à partir d'une image : le relief est plat, à mi-hauteur.
  E.docDepuisImage = function (pix, w, h, nom) {
    if (!(w >= 1 && h >= 1 && w <= COTE_MAX && h <= COTE_MAX)) return false;
    var im = imageNeuve(pix, w, h), p;
    for (p = 0; p < im.haut.length; p++) if (im.pix[p]) im.haut[p] = 128;
    docNeuf(nom, w, h, [im], null, '', E.doc && E.doc.reglages);
    if (E.surChange) E.surChange();
    return true;
  };

  // ---------- Fichiers ----------
  // Codage d'une image : plages [longueur, r, v, b, a] puis base64 (celui d'Atelier Pixel).
  function coder(buf) {
    var out = [], i = 0, n = buf.length, c, run, s = '', k;
    while (i < n) {
      c = buf[i]; run = 1;
      while (run < 255 && i + run < n && buf[i + run] === c) run++;
      out.push(run, c & 255, c >>> 8 & 255, c >>> 16 & 255, c >>> 24);
      i += run;
    }
    for (k = 0; k < out.length; k += 8000) s += String.fromCharCode.apply(null, out.slice(k, k + 8000));
    return btoa(s);
  }
  // atob se plaint en anglais : on le dit en français.
  function deBase64(texte) {
    try { return atob(texte); } catch (e) { throw new Error('Une image de ce fichier est abîmée : son codage est illisible.'); }
  }
  function decoder(texte, n) {
    var s = deBase64(texte), buf = new Uint32Array(n), i = 0, k, run, c;
    for (k = 0; k + 4 < s.length; k += 5) {
      run = s.charCodeAt(k);
      c = rgba(s.charCodeAt(k + 1), s.charCodeAt(k + 2), s.charCodeAt(k + 3), s.charCodeAt(k + 4));
      if (i + run > n) throw new Error('Une image de ce fichier est abîmée : elle déborde de sa taille.');
      if (c) buf.fill(c, i, i + run);
      i += run;
    }
    if (i !== n) throw new Error('Une image de ce fichier est abîmée : elle est incomplète.');
    return buf;
  }
  // Une carte d'octets (la hauteur) : plages [longueur, valeur] puis base64.
  function coderOctets(buf) {
    var out = [], i = 0, n = buf.length, run, s = '', k;
    while (i < n) {
      run = 1;
      while (run < 255 && i + run < n && buf[i + run] === buf[i]) run++;
      out.push(run, buf[i]);
      i += run;
    }
    for (k = 0; k < out.length; k += 8000) s += String.fromCharCode.apply(null, out.slice(k, k + 8000));
    return btoa(s);
  }
  function decoderOctets(texte, n) {
    var s = deBase64(texte), buf = new Uint8Array(n), i = 0, k, run;
    for (k = 0; k + 1 < s.length; k += 2) {
      run = s.charCodeAt(k);
      if (i + run > n) throw new Error('Un relief de ce fichier est abîmé : il déborde de sa taille.');
      buf.fill(s.charCodeAt(k + 1), i, i + run);
      i += run;
    }
    if (i !== n) throw new Error('Un relief de ce fichier est abîmé : il est incomplet.');
    return buf;
  }
  E.coder = coder; E.decoder = decoder;

  E.versProjet = function () {
    var d = E.doc, R = {}, k;
    for (k in d.reglages) R[k] = d.reglages[k];
    return {
      format: FORMAT, version: 1, nom: d.nom, w: d.w, h: d.h, iImage: d.iImage,
      images: d.images.map(function (im) { return { duree: im.duree, pix: coder(im.pix), hauteur: coderOctets(im.haut), normales: coder(im.norm) }; }),
      palette: d.palette ? d.palette.map(versHex) : null, paletteNom: d.paletteNom,
      reglages: R
    };
  };

  E.depuisProjet = function (o) {
    var w, h, images, pal;
    if (!o || o.format !== FORMAT || !Array.isArray(o.images) || !o.images.length) throw new Error('Ce fichier n\'est pas un projet Éclairage.');
    w = Math.round(o.w); h = Math.round(o.h);
    if (!(w >= 1 && h >= 1 && w <= COTE_MAX && h <= COTE_MAX) || o.images.length > IMAGES_MAX) throw new Error('Projet invalide.');
    if (!o.images.every(function (q) { return q && typeof q.pix === 'string'; })) throw new Error('Projet invalide : une image est illisible.');
    images = o.images.map(function (q) {
      var im = imageNeuve(decoder(q.pix, w * h), w, h, borne(Math.round(q.duree) || 100, 10, 60000)), p, hn = q.hauteur ? decoderOctets(q.hauteur, w * h) : null, nn = q.normales ? decoder(q.normales, w * h) : null;
      for (p = 0; p < w * h; p++) if (im.pix[p]) { im.haut[p] = hn ? hn[p] : 128; im.norm[p] = nn && nn[p] >>> 24 ? (nn[p] | 0xff000000) >>> 0 : 0; }
      return im;
    });
    pal = Array.isArray(o.palette) ? o.palette.map(depuisHex).filter(function (c) { return c !== null; }).slice(0, COULEURS_MAX) : null;
    docNeuf(String(o.nom || 'sprite').slice(0, 60), w, h, images, pal && pal.length ? pal : null, String(o.paletteNom || '').slice(0, 40), o.reglages);
    E.doc.iImage = borne(Math.round(o.iImage) || 0, 0, images.length - 1);
    if (E.surChange) E.surChange();
  };

  // Un projet Atelier Pixel : les calques visibles de chaque image, composés. toutes : garder toutes les images
  // (sinon seulement celle qui était ouverte). Sa palette s'ajoute aux couleurs du sprite pour former les rampes.
  E.lireAtelier = function (o) {
    var w, h, n;
    if (!o || o.format !== FORMAT_ATELIER || !Array.isArray(o.calques) || !Array.isArray(o.images) || !o.images.length) throw new Error('Ce fichier n\'est pas un projet Atelier Pixel.');
    w = Math.round(o.w); h = Math.round(o.h); n = w * h;
    if (!(w >= 1 && h >= 1)) throw new Error('Projet Atelier Pixel invalide.');
    if (w > COTE_MAX || h > COTE_MAX) throw new Error('Ce sprite fait ' + w + ' × ' + h + ' px : le maximum est ' + COTE_MAX + '.');
    if (!o.images.every(function (im) { return im && typeof im === 'object'; }) || !o.calques.every(function (c) { return c && c.id !== undefined; })) throw new Error('Projet Atelier Pixel invalide.');
    return { w: w, h: h, n: o.images.length, iImage: borne(Math.round(o.iImage) || 0, 0, o.images.length - 1), o: o };
  };
  E.depuisAtelier = function (lu, toutes, nom) {
    var o = lu.o, w = lu.w, h = lu.h, n = w * h, liste = toutes ? o.images.slice(0, IMAGES_MAX) : [o.images[lu.iImage]], images, pal, p;
    images = liste.map(function (im) {
      var tout = new Uint32Array(n);
      o.calques.forEach(function (c) {
        var t = im.cels && im.cels[c.id], buf, i, op = c.opacite === undefined ? 1 : borne(Number(c.opacite) || 0, 0, 1);
        if (!t || c.visible === false || op <= 0) return;
        buf = decoder(t, n);
        for (i = 0; i < n; i++) if (buf[i]) tout[i] = sur(tout[i], op < 1 ? ((buf[i] & 0xffffff) | Math.round((buf[i] >>> 24) * op) << 24) >>> 0 : buf[i]);
      });
      var e = imageNeuve(tout, w, h, borne(Math.round(im.duree) || 100, 10, 60000));
      for (p = 0; p < n; p++) if (e.pix[p]) e.haut[p] = 128;
      return e;
    });
    if (!images.some(function (e) { for (var q = 0; q < n; q++) if (e.pix[q]) return true; return false; })) throw new Error('Ce projet n\'a aucun pixel visible : ses calques sont cachés ou vides.');
    pal = Array.isArray(o.palette) ? o.palette.map(depuisHex).filter(function (c) { return c !== null; }) : [];
    docNeuf(nom, w, h, images, null, '', E.doc && E.doc.reglages);
    // La palette du projet complète les couleurs du sprite : ses tons inutilisés allongent les rampes.
    if (pal.length) {
      var l = E.couleursDuSprite(), vus = new Set(l);
      pal.forEach(function (c) { if (!vus.has(c) && l.length < COULEURS_MAX) { vus.add(c); l.push(c); } });
      E.doc.palette = l; E.doc.paletteNom = 'du projet Atelier Pixel';
      E.revPalette++;
    }
    if (E.surChange) E.surChange();
    return images.length;
  };

  // Une palette du site (format « palette » de Palettes), ou celle d'un projet Atelier Pixel.
  E.lirePalette = function (o) {
    var l = o && (o.couleurs || o.palette || o.colors);
    if (Array.isArray(o)) l = o;
    if (!Array.isArray(l)) throw new Error('Ce fichier ne contient pas de liste de couleurs.');
    l = l.map(depuisHex).filter(function (c) { return c !== null; }).slice(0, COULEURS_MAX);
    if (!l.length) throw new Error('Aucune couleur trouvée dans ce fichier.');
    return { nom: String(o.nom || o.name || '').slice(0, 40), couleurs: l };
  };
  E.FORMAT_PALETTE = FORMAT_PALETTE;

  // Images éclairées pour une liste de directions. images : indices des images du sprite.
  // Rend une liste [{ pix, az, i }], directions dans l'ordre, image par image.
  E.versions = function (azimuts, images, el) {
    var d = E.doc, R = d.reglages, l = [];
    images.forEach(function (i) { azimuts.forEach(function (a) { l.push({ pix: E.eclairer(i, R, a, el === undefined ? R.el : el), az: a, i: i }); }); });
    return l;
  };

  // Planche : une ligne par image du sprite, une colonne par direction. rose : 3 × 3 autour du sprite tel quel (8 directions).
  E.planche = function (azimuts, images, rose) {
    var d = E.doc, w = d.w, h = d.h, v = E.versions(azimuts, images), cols, rangs, W, o, k, y, ox, oy, PLACE;
    if (rose) {
      // Place de chaque direction (0°, 45°…) dans la grille 3 × 3, en partant du haut, dans le sens des aiguilles d'une montre.
      PLACE = [[1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0]];
      cols = 3; rangs = 3 * images.length; W = 3 * w; o = new Uint32Array(W * rangs * h);
      images.forEach(function (i, r) {
        var src = d.images[i].pix;
        for (y = 0; y < h; y++) o.set(src.subarray(y * w, (y + 1) * w), (r * 3 * h + h + y) * W + w);
      });
      v.forEach(function (e, j) {
        var r = Math.floor(j / 8), pl = PLACE[j % 8];
        ox = pl[0] * w; oy = (r * 3 + pl[1]) * h;
        for (y = 0; y < h; y++) o.set(e.pix.subarray(y * w, (y + 1) * w), (oy + y) * W + ox);
      });
      return { pix: o, w: W, h: rangs * h };
    }
    cols = azimuts.length; rangs = images.length; W = cols * w; o = new Uint32Array(W * rangs * h);
    for (k = 0; k < v.length; k++) {
      ox = (k % cols) * w; oy = Math.floor(k / cols) * h;
      for (y = 0; y < h; y++) o.set(v[k].pix.subarray(y * w, (y + 1) * w), (oy + y) * W + ox);
    }
    return { pix: o, w: W, h: rangs * h };
  };

  E.agrandir = function (pix, w, h, k) {
    if (k === 1) return pix;
    var o = new Uint32Array(w * k * h * k), x, y, i, c, W = w * k;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) { c = pix[y * w + x]; if (c) for (i = 0; i < k; i++) o[y * k * W + x * k + i] = c; }
      for (i = 1; i < k; i++) o.copyWithin((y * k + i) * W, y * k * W, (y * k + 1) * W);
    }
    return o;
  };

  // Un projet Atelier Pixel, une image par version éclairée.
  E.versAtelier = function (versions, duree) {
    var d = E.doc, vues = {}, palette = [];
    return {
      format: FORMAT_ATELIER, version: 1, w: d.w, h: d.h, iImage: 0, iCalque: 0,
      calques: [{ id: 1, nom: 'Éclairé', visible: true, opacite: 1, verrou: false }],
      images: versions.map(function (v) {
        for (var p = 0; p < v.pix.length; p++) {
          var c = v.pix[p];
          if (c && !vues[c] && palette.length < COULEURS_MAX) { vues[c] = true; palette.push(versHex(c) + (c >>> 24 < 255 ? hex2(c >>> 24) : '')); }
        }
        return { duree: duree, cels: { 1: coder(v.pix) } };
      }),
      palette: palette
    };
  };

  // ---------- Sprite d'exemple ----------
  // Un champignon des bois, ombré à la main (lumière en haut à gauche), avec son relief déjà peint :
  // chapeau en dôme, pied en cylindre, pois en relief, lames et brins d'herbe en normales posées à la main.
  E.exemple = function () {
    var W = 40, H = 40, pix = new Uint32Array(W * H), haut = new Uint8Array(W * H), norm = new Uint32Array(W * H), x, y, p, t, k;
    var ROUGE = ['#4a1420', '#7d1f2c', '#b3313a', '#dc5446', '#f0705a'].map(depuisHex);
    var CREME = ['#5e4636', '#94775d', '#c8ab88', '#eedbb8', '#fff6e0'].map(depuisHex);
    var VERT = ['#173a2c', '#24603a', '#3f8a3e', '#74b24a', '#b0d86a'].map(depuisHex);
    var TRAIT = depuisHex('#1d1418');
    var cx = 19.5, cy = 17, rx = 16, ry = 12;
    function ton(r, v) { return r[borne(Math.round(v), 0, r.length - 1)]; }
    function mettre(x, y, c, hh) { if (x < 0 || y < 0 || x >= W || y >= H) return; p = y * W + x; pix[p] = c; haut[p] = hh; }
    // Le pied, un cylindre un peu évasé vers le bas.
    for (y = 18; y <= 34; y++) {
      var demi = 4.6 + (y - 18) * 0.12 + (y > 31 ? (y - 31) * 0.6 : 0);
      for (x = Math.floor(cx - demi); x <= Math.ceil(cx - 1 + demi); x++) {
        t = (x + 0.5 - cx) / (demi + 0.5);
        if (Math.abs(t) > 1) continue;
        mettre(x, y, ton(CREME, 3 - t * 1.6 - (y > 31 ? 0.6 : 0)), Math.round(150 * Math.sqrt(1 - t * t)));
      }
    }
    // Le chapeau, un demi-ovoïde, et sa lèvre.
    for (y = 2; y <= cy + 4; y++) for (x = 0; x < W; x++) {
      var u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, dd = u * u + v * v;
      if (dd > 1 || (y > cy && dd > 1 - (y - cy) * 0.12)) continue;
      if (y > cy + 1 && Math.abs(u) < 0.62) continue;
      var z = Math.sqrt(Math.max(0, 1 - dd)), lum = -u * 0.55 - v * 0.6 + z * 0.55;
      mettre(x, y, ton(ROUGE, 1.2 + lum * 2.4), Math.round(90 + 165 * z));
    }
    // Les lames, sous le chapeau : on les regarde par en dessous.
    for (y = cy + 1; y <= cy + 3; y++) for (x = Math.round(cx - 9); x <= Math.round(cx + 8); x++) {
      p = y * W + x;
      if (pix[p] && CREME.indexOf(pix[p]) < 0) continue;
      mettre(x, y, ton(CREME, (x % 2 ? 1 : 2) - (y - cy - 1) * 0.4), 70);
      norm[p] = E.coderNormale((x - cx) * 0.04, 0.75, 0.66);
    }
    // Les pois, posés en relief sur le chapeau.
    [[12, 8, 2.3], [21, 5, 1.8], [27, 10, 2.4], [17, 13, 1.6], [31, 15, 1.3], [8, 14, 1.4]].forEach(function (pt) {
      for (y = Math.floor(pt[1] - pt[2]); y <= Math.ceil(pt[1] + pt[2]); y++) for (x = Math.floor(pt[0] - pt[2]); x <= Math.ceil(pt[0] + pt[2]); x++) {
        var dx = x - pt[0], dy = y - pt[1], r2 = (dx * dx + dy * dy) / (pt[2] * pt[2]);
        p = y * W + x;
        if (r2 > 1 || ROUGE.indexOf(pix[p]) < 0) continue;
        pix[p] = ton(CREME, 3.6 - dx * 0.35 - dy * 0.35 - (x > cx + 6 ? 0.8 : 0));
        haut[p] = Math.min(255, haut[p] + Math.round(26 * Math.sqrt(1 - r2)));
      }
    });
    // L'herbe : des brins qui penchent chacun de leur côté, normales posées à la main.
    [[9, 3, -1], [11, 5, 1], [13, 4, 0], [15, 6, -1], [24, 5, 1], [26, 6, 0], [28, 4, -1], [30, 5, 1], [32, 3, 0], [7, 2, 1]].forEach(function (b) {
      for (k = 0; k < b[1]; k++) {
        x = b[0] + Math.round(b[2] * k * 0.35); y = 37 - k;
        if (pix[y * W + x] && VERT.indexOf(pix[y * W + x]) < 0) continue;
        mettre(x, y, ton(VERT, 1 + k * 0.7 + (b[2] < 0 ? 0.6 : 0)), 40 + k * 8);
        norm[y * W + x] = E.coderNormale(b[2] ? -b[2] * 0.6 : (k % 2 ? 0.5 : -0.5), -0.2, 0.75);
      }
    });
    for (x = 6; x <= 34; x++) { p = 38 * W + x; mettre(x, 38, ton(VERT, x % 3 ? 1 : 2), 30); norm[p] = E.coderNormale(0, -0.5, 0.85); }
    // Un cerne d'encre autour de tout.
    var bord = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      p = y * W + x;
      if (!pix[p] && ((x > 0 && pix[p - 1]) || (x < W - 1 && pix[p + 1]) || (y > 0 && pix[p - W]) || (y < H - 1 && pix[p + W]))) bord.push(p);
    }
    bord.forEach(function (q) { pix[q] = TRAIT; haut[q] = 20; });
    var im = { duree: 100, pix: pix, haut: haut, norm: norm };
    docNeuf('champignon', W, H, [im], ROUGE.concat(CREME, VERT, [TRAIT]), 'du champignon', null);
    E.doc.reglages.rim = true; E.doc.reglages.rimCouleur = '#ffd9a0'; E.doc.reglages.rimI = 0.35; E.doc.reglages.prereglage = '';
    if (E.surChange) E.surChange();
  };
})();
