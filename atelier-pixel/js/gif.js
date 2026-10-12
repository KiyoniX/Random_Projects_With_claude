(function () {
  'use strict';

  var A = window.Atelier;

  var SEUIL_ALPHA = 128;      // en dessous, un pixel devient transparent : le GIF n'a pas de demi-transparence
  var COULEURS_MAX = 255;     // une entrée de la table est gardée pour la transparence

  // ---------- Palette ----------
  // Réduit une liste de couleurs [rvb, effectif] à n teintes par coupe médiane.
  function coupeMediane(couleurs, n) {
    var boites = [couleurs], i, k, b, pire, etendue, axe, min, max, c, v, total, moitie, cumul;
    function canal(rvb, a) { return rvb >>> (a * 8) & 255; }
    while (boites.length < n) {
      pire = -1; etendue = 0;
      for (i = 0; i < boites.length; i++) {
        b = boites[i];
        if (b.length < 2) continue;
        for (k = 0; k < 3; k++) {
          min = 255; max = 0;
          for (c = 0; c < b.length; c++) { v = canal(b[c][0], k); if (v < min) min = v; if (v > max) max = v; }
          if (max - min >= etendue) { etendue = max - min; pire = i; axe = k; }
        }
      }
      if (pire < 0) break;
      b = boites[pire];
      b.sort(function (p, q) { return canal(p[0], axe) - canal(q[0], axe); });
      total = 0;
      for (c = 0; c < b.length; c++) total += b[c][1];
      moitie = total / 2; cumul = 0;
      for (c = 0; c < b.length - 1; c++) { cumul += b[c][1]; if (cumul >= moitie) break; }
      boites.splice(pire, 1, b.slice(0, c + 1), b.slice(c + 1));
    }
    return boites.map(function (bt) {
      var s = [0, 0, 0], t = 0, j;
      for (j = 0; j < bt.length; j++) {
        s[0] += (bt[j][0] & 255) * bt[j][1]; s[1] += (bt[j][0] >>> 8 & 255) * bt[j][1]; s[2] += (bt[j][0] >>> 16 & 255) * bt[j][1];
        t += bt[j][1];
      }
      return Math.round(s[0] / t) | Math.round(s[1] / t) << 8 | Math.round(s[2] / t) << 16;
    });
  }

  function plusProche(table, rvb) {
    var r = rvb & 255, g = rvb >>> 8 & 255, b = rvb >>> 16 & 255, mieux = 0, dmin = Infinity, i, d, dr, dg, db;
    for (i = 0; i < table.length; i++) {
      dr = r - (table[i] & 255); dg = g - (table[i] >>> 8 & 255); db = b - (table[i] >>> 16 & 255);
      d = dr * dr + dg * dg + db * db;
      if (d < dmin) { dmin = d; mieux = i; }
    }
    return mieux;
  }

  // ---------- Compression LZW ----------
  function lzw(indices, bitsMin, octets) {
    var raz = 1 << bitsMin, fin = raz + 1, suivant = fin + 1, taille = bitsMin + 1;
    var dico = new Map(), tampon = 0, nbits = 0, bloc = [], i, k, cle, code, prefixe;
    function sortir(c) {
      tampon |= c << nbits; nbits += taille;
      while (nbits >= 8) {
        bloc.push(tampon & 255); tampon >>>= 8; nbits -= 8;
        if (bloc.length === 255) vider();
      }
    }
    function vider() {
      if (!bloc.length) return;
      octets.push(bloc.length);
      for (var j = 0; j < bloc.length; j++) octets.push(bloc[j]);
      bloc = [];
    }
    octets.push(bitsMin);
    sortir(raz);
    prefixe = indices[0];
    for (i = 1; i < indices.length; i++) {
      k = indices[i];
      cle = prefixe << 8 | k;
      code = dico.get(cle);
      if (code !== undefined) { prefixe = code; continue; }
      sortir(prefixe);
      if (suivant < 4096) {
        dico.set(cle, suivant++);
        if (suivant > (1 << taille) && taille < 12) taille++;
      } else {
        sortir(raz);
        dico.clear(); suivant = fin + 1; taille = bitsMin + 1;
      }
      prefixe = k;
    }
    sortir(prefixe);
    sortir(fin);
    if (nbits > 0) { bloc.push(tampon & 255); }
    vider();
    octets.push(0);
  }

  // ---------- Encodeur ----------
  // images : [{ pix: Uint32Array(w × h), duree: millisecondes }]. Rend un Uint8Array au format GIF89a.
  // options : echelle (entier, 1 par défaut), boucle (vrai par défaut).
  A.gifEncoder = function (images, w, h, options) {
    options = options || {};
    var k = Math.max(1, Math.round(options.echelle || 1)), boucle = options.boucle !== false;
    var compte = new Map(), transparent = false, f, i, c, pix, n = w * h;
    for (f = 0; f < images.length; f++) {
      pix = images[f].pix;
      for (i = 0; i < n; i++) {
        c = pix[i];
        if (c >>> 24 < SEUIL_ALPHA) { transparent = true; continue; }
        c &= 0xffffff;
        compte.set(c, (compte.get(c) || 0) + 1);
      }
    }
    var liste = Array.from(compte.entries()), table, index = new Map(), max = transparent ? COULEURS_MAX : 256;
    if (liste.length <= max) {
      table = liste.map(function (e) { return e[0]; });
      table.forEach(function (rvb, j) { index.set(rvb, j); });
    } else {
      table = coupeMediane(liste, max);
      liste.forEach(function (e) { index.set(e[0], plusProche(table, e[0])); });
    }
    // La transparence prend l'entrée 0 ; les couleurs sont décalées d'autant.
    var decal = transparent ? 1 : 0, total = table.length + decal, bits = 1;
    while ((1 << bits) < total) bits++;
    var o = [], W = w * k, H = h * k;
    function mot(v) { o.push(v & 255, v >> 8 & 255); }
    function texte(s) { for (var j = 0; j < s.length; j++) o.push(s.charCodeAt(j)); }

    texte('GIF89a');
    mot(W); mot(H);
    o.push(0x80 | 0x70 | (bits - 1), 0, 0);
    if (transparent) o.push(0, 0, 0);
    for (i = 0; i < table.length; i++) o.push(table[i] & 255, table[i] >>> 8 & 255, table[i] >>> 16 & 255);
    for (i = total; i < (1 << bits); i++) o.push(0, 0, 0);
    if (boucle && images.length > 1) {
      o.push(0x21, 0xff, 11);
      texte('NETSCAPE2.0');
      o.push(3, 1, 0, 0, 0);
    }

    var ind = new Uint8Array(W * H), x, y, v, j;
    for (f = 0; f < images.length; f++) {
      pix = images[f].pix;
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          c = pix[y * w + x];
          v = c >>> 24 < SEUIL_ALPHA ? 0 : index.get(c & 0xffffff) + decal;
          for (j = 0; j < k; j++) ind[y * k * W + x * k + j] = v;
        }
        for (j = 1; j < k; j++) ind.copyWithin((y * k + j) * W, y * k * W, (y * k + 1) * W);
      }
      // Extension de contrôle : chaque image efface la précédente, durée en centièmes de seconde.
      o.push(0x21, 0xf9, 4, transparent ? 0x09 : 0x04);
      mot(A.gifDelai(images[f].duree));
      o.push(0, 0);
      o.push(0x2c); mot(0); mot(0); mot(W); mot(H); o.push(0);
      lzw(ind, Math.max(2, bits), o);
    }
    o.push(0x3b);
    return new Uint8Array(o);
  };

  // Les navigateurs ralentissent les durées inférieures à 2 centièmes : on ne descend pas en dessous.
  A.gifDelai = function (ms) { return Math.max(2, Math.min(65535, Math.round(ms / 10))); };
})();
