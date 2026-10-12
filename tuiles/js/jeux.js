(function () {
  'use strict';

  var racine = typeof window !== 'undefined' ? window : globalThis;
  var M = racine.Tuiles;

  var COLONNES = 8;                 // largeur des jeux fabriqués par l'outil
  var TUILE_MAX = 256;              // côté maximal d'une tuile importée
  var JEU_MAX = 4096;               // nombre maximal de tuiles d'un jeu
  var DUREE_TEXTURES = 125;         // millisecondes par image des matières animées (8 images par seconde)
  var IMAGES_TEXTURES = 8;
  var FORMAT_ATLAS = 'textures-atlas', FORMAT_ATELIER = 'atelier-pixel';

  // Un pixel est un entier 0xAABBGGRR, l'ordre des octets d'une ImageData. Transparent = 0.
  var J = M.jeux = { COLONNES: COLONNES, TUILE_MAX: TUILE_MAX };

  // ---------- Pixels ----------
  function rgba(r, g, b, a) {
    if (a === undefined) a = 255;
    return a <= 0 ? 0 : ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  function hex(s) { var v = parseInt(s, 16); return rgba(v >> 16 & 255, v >> 8 & 255, v & 255); }

  // Pose s sur d (fusion alpha normale), avec une opacité entre 0 et 1.
  function sur(d, s, op) {
    var sa = s >>> 24, da, k, oa;
    if (op < 1) sa = Math.round(sa * op);
    if (sa === 0) return d;
    da = d >>> 24;
    if (sa === 255 || da === 0) return ((sa << 24) | (s & 0xffffff)) >>> 0;
    k = da * (255 - sa) / 255; oa = sa + k;
    return rgba(Math.round(((s & 255) * sa + (d & 255) * k) / oa), Math.round(((s >>> 8 & 255) * sa + (d >>> 8 & 255) * k) / oa), Math.round(((s >>> 16 & 255) * sa + (d >>> 16 & 255) * k) / oa), Math.round(oa));
  }

  function nettoyer(pix) {
    var o = new Uint32Array(pix), i;
    for (i = 0; i < o.length; i++) if (o[i] >>> 24 === 0) o[i] = 0;
    return o;
  }
  function vide(b) {
    for (var i = 0; i < b.length; i++) if (b[i]) return false;
    return true;
  }

  // Extrait un rectangle d'une image.
  function prendre(pix, w, x, y, lw, lh) {
    var o = new Uint32Array(lw * lh), j;
    for (j = 0; j < lh; j++) o.set(pix.subarray((y + j) * w + x, (y + j) * w + x + lw), j * lw);
    return o;
  }

  // Au plus proche voisin, de n à cote pixels de côté.
  function mettreACote(pix, n, cote) {
    var o, x, y;
    if (n === cote) return pix;
    o = new Uint32Array(cote * cote);
    for (y = 0; y < cote; y++) for (x = 0; x < cote; x++) o[y * cote + x] = pix[Math.floor(y * n / cote) * n + Math.floor(x * n / cote)];
    return o;
  }

  J.rgba = rgba;
  J.prendre = prendre;

  // Codage d'une image : plages [longueur, r, v, b, a] puis base64 (le même que celui d'Atelier Pixel).
  J.coder = function (buf) {
    var out = [], i = 0, n = buf.length, c, run, s = '', k;
    while (i < n) {
      c = buf[i]; run = 1;
      while (run < 255 && i + run < n && buf[i + run] === c) run++;
      out.push(run, c & 255, c >>> 8 & 255, c >>> 16 & 255, c >>> 24);
      i += run;
    }
    for (k = 0; k < out.length; k += 8000) s += String.fromCharCode.apply(null, out.slice(k, k + 8000));
    return btoa(s);
  };
  J.decoder = function (texte, n) {
    var s = atob(texte), buf = new Uint32Array(n), i = 0, k, run, c;
    for (k = 0; k + 4 < s.length; k += 5) {
      run = s.charCodeAt(k);
      c = rgba(s.charCodeAt(k + 1), s.charCodeAt(k + 2), s.charCodeAt(k + 3), s.charCodeAt(k + 4));
      if (i + run > n) throw new Error('Image trop longue.');
      if (c) buf.fill(c, i, i + run);
      i += run;
    }
    if (i !== n) throw new Error('Image incomplète.');
    return buf;
  };

  // ---------- Jeu ----------
  // Un jeu : { id, premier, nom, tw, th (taille d'une tuile), cols, nb, w, h, pix (image sans marge),
  //            anims { rang: [{ t: rang, d: millisecondes }] }, terrains [{ nom, forme, base }], noms { rang: texte },
  //            moyennes (couleur moyenne de chaque tuile, pour la mini-carte), origine }.
  function moyennes(j) {
    var o = new Uint32Array(j.nb), k, x, y, c, ox, oy, r, g, b, n, a;
    for (k = 0; k < j.nb; k++) {
      ox = (k % j.cols) * j.tw; oy = Math.floor(k / j.cols) * j.th; r = g = b = n = 0;
      for (y = 0; y < j.th; y++) {
        for (x = 0; x < j.tw; x++) {
          c = j.pix[(oy + y) * j.w + ox + x]; a = c >>> 24;
          if (a > 40) { r += c & 255; g += c >>> 8 & 255; b += c >>> 16 & 255; n++; }
        }
      }
      if (n * 6 >= j.tw * j.th) o[k] = rgba(Math.round(r / n), Math.round(g / n), Math.round(b / n), 255);
    }
    return o;
  }

  J.creer = function (o) {
    var rangs = Math.ceil(o.nb / o.cols), j = {
      id: 0, premier: 0, nom: M.nomPropre(o.nom, 'Jeu de tuiles'), tw: o.tw, th: o.th, cols: o.cols, nb: o.nb,
      w: o.cols * o.tw, h: rangs * o.th, pix: o.pix, anims: o.anims || {}, terrains: o.terrains || [], noms: o.noms || {}, origine: o.origine || 'image'
    };
    if (!(j.nb >= 1 && j.nb <= JEU_MAX)) throw new Error('Un jeu contient entre 1 et ' + JEU_MAX + ' tuiles.');
    if (j.pix.length !== j.w * j.h) throw new Error('Image du jeu de taille inattendue.');
    j.moyennes = moyennes(j);
    return j;
  };

  // Range une liste de tuiles (tampons de tw × th pixels) sur une grille.
  function ranger(tuiles, tw, th, cols) {
    var rangs = Math.ceil(tuiles.length / cols), W = cols * tw, pix = new Uint32Array(W * rangs * th), k, y, ox, oy;
    for (k = 0; k < tuiles.length; k++) {
      if (!tuiles[k]) continue;
      ox = (k % cols) * tw; oy = Math.floor(k / cols) * th;
      for (y = 0; y < th; y++) pix.set(tuiles[k].subarray(y * tw, (y + 1) * tw), (oy + y) * W + ox);
    }
    return pix;
  }
  J.ranger = ranger;

  J.tuile = function (j, k) { return prendre(j.pix, j.w, (k % j.cols) * j.tw, Math.floor(k / j.cols) * j.th, j.tw, j.th); };

  // L'image de la tuile k à l'instant t (millisecondes) : son propre rang, ou celui d'une image de son animation.
  J.imageA = function (j, k, t) {
    var a = j.anims[k], total = 0, i;
    if (!a) return k;
    for (i = 0; i < a.length; i++) total += a[i].d;
    t = t % total;
    for (i = 0; i < a.length; i++) { if (t < a[i].d) return a[i].t; t -= a[i].d; }
    return k;
  };
  // Le prochain instant où l'animation de la tuile k change d'image.
  J.prochain = function (j, k, t) {
    var a = j.anims[k], total = 0, i, r;
    for (i = 0; i < a.length; i++) total += a[i].d;
    r = t % total;
    for (i = 0; i < a.length; i++) { if (r < a[i].d) return t + a[i].d - r; r -= a[i].d; }
    return t + total;
  };

  // ---------- Image découpée en grille ----------
  // o : { tw, th, marge, espace, anim ('', 'tout' ou 'ligne'), duree }.
  J.grille = function (w, h, o) {
    var m = o.marge || 0, e = o.espace || 0;
    return { cols: Math.floor((w - 2 * m + e) / (o.tw + e)), rangs: Math.floor((h - 2 * m + e) / (o.th + e)) };
  };

  J.depuisImage = function (pix, w, h, o) {
    var tw = Math.round(o.tw), th = Math.round(o.th), m = Math.round(o.marge || 0), e = Math.round(o.espace || 0), g, src, tuiles = [], i, n, anims = {}, r, a, d;
    if (!(tw >= 1 && th >= 1 && tw <= TUILE_MAX && th <= TUILE_MAX && m >= 0 && e >= 0)) throw new Error('Taille de tuile invalide (de 1 à ' + TUILE_MAX + ' px).');
    g = J.grille(w, h, { tw: tw, th: th, marge: m, espace: e });
    if (g.cols < 1 || g.rangs < 1) throw new Error('L\'image est plus petite qu\'une tuile.');
    src = nettoyer(pix);
    for (i = 0; i < g.cols * g.rangs; i++) tuiles.push(prendre(src, w, m + (i % g.cols) * (tw + e), m + Math.floor(i / g.cols) * (th + e), tw, th));
    n = tuiles.length;
    while (n > 1 && vide(tuiles[n - 1])) n--;
    if (n > JEU_MAX) throw new Error('Trop de tuiles (' + n + ') : le maximum est ' + JEU_MAX + '.');
    tuiles.length = n;
    d = M.borne(Math.round(o.duree) || 100, 10, 60000);
    if (o.anim === 'tout' && n > 1) {
      anims[0] = tuiles.map(function (t, k) { return { t: k, d: d }; });
    } else if (o.anim === 'ligne' && g.cols > 1) {
      for (r = 0; r * g.cols < n; r++) {
        a = [];
        for (i = r * g.cols; i < Math.min(n, (r + 1) * g.cols); i++) if (!vide(tuiles[i])) a.push({ t: i, d: d });
        if (a.length > 1) anims[r * g.cols] = a;
      }
    }
    return J.creer({ nom: o.nom, tw: tw, th: th, cols: g.cols, nb: n, pix: ranger(tuiles, tw, th, g.cols), anims: anims, origine: 'image' });
  };

  // ---------- Atlas de Textures ----------
  // json : le fichier textures-atlas.json. pix : les pixels de textures-atlas.png, ou null pour
  // recalculer chaque texture avec le moteur de Textures. Rend un jeu par taille de tuile.
  J.depuisAtlas = function (json, pix, w, h) {
    var T = racine.Textures, parTaille = {}, jeux = [];
    if (!json || json.format !== FORMAT_ATLAS || !Array.isArray(json.textures) || !json.textures.length) throw new Error('Ce fichier n\'est pas un atlas de Textures.');
    if (pix && (w !== json.largeur || h !== json.hauteur)) throw new Error('L\'image ne correspond pas à l\'atlas (' + json.largeur + ' × ' + json.hauteur + ' px attendus).');
    if (!pix && !(T && T.matieres.length)) throw new Error('Il faut aussi l\'image de l\'atlas (textures-atlas.png) : choisis les deux fichiers ensemble.');
    json.textures.forEach(function (tx) {
      var n = Math.round(tx.taille), nb = Math.max(1, Math.round(tx.images) || 1), g = parTaille[n], res, q, base;
      if (!(n >= 1 && n <= TUILE_MAX)) throw new Error('Atlas invalide.');
      if (!g) g = parTaille[n] = { n: n, tuiles: [], anims: {}, noms: {} };
      // Une animation commence sur une nouvelle ligne quand elle y tient.
      if (nb > 1 && nb <= COLONNES) while (g.tuiles.length % COLONNES && g.tuiles.length % COLONNES + nb > COLONNES) g.tuiles.push(null);
      base = g.tuiles.length;
      if (pix) {
        if (tx.x < 0 || tx.y < 0 || tx.x + n * nb > w || tx.y + n > h) throw new Error('Atlas invalide : « ' + tx.nom + ' » sort de l\'image.');
        for (q = 0; q < nb; q++) g.tuiles.push(prendre(pix, w, tx.x + q * n, tx.y, n, n));
      } else {
        res = T.generer(T.depuisTexte(tx.reglages));
        for (q = 0; q < res.nb; q++) g.tuiles.push(T.pixels(res.images[q], res.couleurs));
        nb = res.nb;
      }
      g.noms[base] = String(tx.nom || tx.matiere || 'Texture');
      if (nb > 1) {
        g.anims[base] = [];
        for (q = 0; q < nb; q++) g.anims[base].push({ t: base + q, d: DUREE_TEXTURES });
      }
    });
    Object.keys(parTaille).sort(function (a, b) { return a - b; }).forEach(function (k) {
      var g = parTaille[k];
      jeux.push(J.creer({ nom: 'Textures ' + g.n + ' px', tw: g.n, th: g.n, cols: COLONNES, nb: g.tuiles.length, pix: ranger(g.tuiles, g.n, g.n, COLONNES), anims: g.anims, noms: g.noms, origine: 'textures' }));
    });
    return jeux;
  };

  // ---------- Projet d'Atelier Pixel ----------
  // Chaque image du sprite devient une tuile ; s'il y en a plusieurs, la première est animée avec les durées du projet.
  J.depuisAtelier = function (o, nom) {
    var w, h, n, tuiles, anims = {}, cols;
    if (!o || o.format !== FORMAT_ATELIER || !Array.isArray(o.calques) || !Array.isArray(o.images) || !o.images.length) throw new Error('Ce fichier n\'est pas un projet Atelier Pixel.');
    w = Math.round(o.w); h = Math.round(o.h); n = w * h;
    if (!(w >= 1 && h >= 1 && w <= TUILE_MAX && h <= TUILE_MAX)) throw new Error('Le sprite fait ' + o.w + ' × ' + o.h + ' px : le maximum pour une tuile est ' + TUILE_MAX + '.');
    tuiles = o.images.map(function (im) {
      var out = new Uint32Array(n);
      o.calques.forEach(function (cal) {
        var op = cal.opacite === undefined ? 1 : Number(cal.opacite) || 0, txt = (im.cels || {})[cal.id], buf, i;
        if (cal.visible === false || op <= 0 || !txt) return;
        buf = J.decoder(txt, n);
        for (i = 0; i < n; i++) if (buf[i]) out[i] = sur(out[i], buf[i], op);
      });
      return out;
    });
    if (tuiles.length > 1) anims[0] = o.images.map(function (im, k) { return { t: k, d: M.borne(Math.round(im.duree) || 100, 10, 60000) }; });
    cols = Math.min(tuiles.length, COLONNES);
    return J.creer({ nom: nom || 'Sprite', tw: w, th: h, cols: cols, nb: tuiles.length, pix: ranger(tuiles, w, h, cols), anims: anims, origine: 'atelier' });
  };

  // ---------- Tuiles calculées par Textures ----------
  J.texturesPretes = function () { return !!(racine.Textures && racine.Textures.matieres && racine.Textures.matieres.length); };

  // Les images d'une matière au côté voulu. Textures ne descend pas sous 16 px : la tuile de 8 en est tirée.
  function matiere(id, graine, cote, fixe) {
    var T = racine.Textures, r = T.defauts(id), res;
    r.graine = graine; r.taille = Math.max(16, cote); r.images = fixe ? 1 : IMAGES_TEXTURES;
    res = T.generer(r);
    return { nom: T.parId[res.r.matiere].nom, images: res.images.map(function (im) { return mettreACote(T.pixels(im, res.couleurs), res.n, cote); }) };
  }

  // elements : [{ matiere, graine, terrain (0, 16 ou 47), fond (matière posée autour du terrain, ou '') }].
  // Les tuiles simples d'abord, puis les animations (une par ligne), puis les terrains.
  J.depuisTextures = function (elements, cote, nom) {
    var tuiles = [], anims = {}, noms = {}, terrains = [];
    if (!J.texturesPretes()) throw new Error('Le moteur de Textures n\'est pas chargé.');
    if (!elements.length) throw new Error('Choisis au moins une matière.');
    function ligne() { while (tuiles.length % COLONNES) tuiles.push(null); }
    var faits = elements.map(function (e) { return { e: e, m: matiere(e.matiere, e.graine, cote, !!e.terrain) }; });
    faits.forEach(function (f) {
      if (f.e.terrain || f.m.images.length > 1) return;
      noms[tuiles.length] = f.m.nom;
      tuiles.push(f.m.images[0]);
    });
    faits.forEach(function (f) {
      var base;
      if (f.e.terrain || f.m.images.length < 2) return;
      ligne();
      base = tuiles.length;
      noms[base] = f.m.nom + ' (animée)';
      anims[base] = f.m.images.map(function (im, q) { return { t: base + q, d: DUREE_TEXTURES }; });
      f.m.images.forEach(function (im) { tuiles.push(im); });
    });
    faits.forEach(function (f) {
      var fond, liste, forme = f.e.terrain === 16 ? 16 : 47;
      if (!f.e.terrain) return;
      ligne();
      fond = f.e.fond ? matiere(f.e.fond, f.e.graine, cote, true) : null;
      liste = M.auto.tuiles(f.m.images[0], cote, forme, fond ? fond.images[0] : null);
      terrains.push({ nom: f.m.nom + (fond ? ' sur ' + fond.nom.toLowerCase() : ''), forme: forme, base: tuiles.length });
      noms[tuiles.length] = 'Terrain : ' + f.m.nom;
      liste.forEach(function (t) { tuiles.push(t); });
    });
    return J.creer({ nom: nom || 'Textures', tw: cote, th: cote, cols: COLONNES, nb: tuiles.length, pix: ranger(tuiles, cote, cote, COLONNES), anims: anims, terrains: terrains, noms: noms, origine: 'textures' });
  };

  // Ajoute à un jeu existant un terrain tiré d'une de ses tuiles (carrée). Rend le nouveau jeu, qui n'est pas encore posé dans la carte.
  J.terrainDepuisTuile = function (j, k, forme, nom) {
    var src = J.tuile(j, k), liste = M.auto.tuiles(src, j.tw, forme, null);
    return J.creer({ nom: nom, tw: j.tw, th: j.th, cols: COLONNES, nb: liste.length, pix: ranger(liste, j.tw, j.th, COLONNES), terrains: [{ nom: nom, forme: forme, base: 0 }], noms: { 0: 'Terrain : ' + nom }, origine: 'terrain' });
  };

  // ---------- Tuiles de démonstration ----------
  // Dessinées en 16 px par le code, puis mises à la taille de la carte.
  function h2(x, y, s) {
    var h = (s | 0) ^ Math.imul(x | 0, 0x27d4eb2d);
    h = Math.imul(h ^ h >>> 15, 0x85ebca6b);
    h ^= Math.imul(y | 0, 0x165667b1);
    h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }

  function toile() {
    var p = new Uint32Array(256), t = {
      p: p,
      pt: function (x, y, c) { if (x >= 0 && y >= 0 && x < 16 && y < 16) p[y * 16 + x] = hex(c); },
      rect: function (x, y, w, h, c) { for (var j = y; j < y + h; j++) for (var i = x; i < x + w; i++) t.pt(i, j, c); },
      disque: function (cx, cy, r, c) { for (var j = 0; j < 16; j++) for (var i = 0; i < 16; i++) if ((i + 0.5 - cx) * (i + 0.5 - cx) + (j + 0.5 - cy) * (j + 0.5 - cy) <= r * r) t.pt(i, j, c); },
      grain: function (s, seuils, couleurs) {
        for (var j = 0; j < 16; j++) for (var i = 0; i < 16; i++) {
          var v = h2(i, j, s), k = 0;
          while (k < seuils.length && v > seuils[k]) k++;
          t.pt(i, j, couleurs[k]);
        }
      }
    };
    return t;
  }

  function demoTuiles() {
    var L = [], noms = {}, t, i, k, f;
    function fin(nom) { noms[L.length] = nom; L.push(t.p); }

    for (k = 0; k < 3; k++) {
      t = toile(); t.grain(11 + k, [0.72, 0.9], ['5c9a3e', '4d8736', '74b24e']);
      for (i = 0; i < 3 + k; i++) { f = Math.floor(h2(i, k, 5) * 14); t.pt(f, Math.floor(h2(k, i, 6) * 13) + 1, '86c25c'); t.pt(f, Math.floor(h2(k, i, 6) * 13) + 2, '3f7430'); }
      fin('Herbe ' + (k + 1));
    }
    t = toile(); t.grain(14, [0.75, 0.92], ['5c9a3e', '4d8736', '74b24e']);
    [[3, 4, 'f2e86a'], [11, 3, 'f4f4f0'], [6, 11, 'e9739b'], [13, 12, 'f2e86a']].forEach(function (q) { t.pt(q[0], q[1], q[2]); t.pt(q[0], q[1] + 1, '3f7430'); });
    fin('Herbe fleurie');
    t = toile(); t.grain(21, [0.6, 0.85, 0.96], ['8d6b45', '7a5a3a', '9f7c52', '5f452e']); fin('Terre');
    t = toile(); t.grain(22, [0.7, 0.93], ['dcc689', 'cdb577', 'ead9a3']); fin('Sable');
    t = toile(); t.rect(0, 0, 16, 16, '5b5d66');
    [[0, 0, 7, 7], [8, 0, 7, 7], [-4, 8, 7, 7], [4, 8, 7, 7], [12, 8, 7, 7]].forEach(function (q, n) { t.rect(q[0], q[1], q[2], q[3], n % 2 ? '8e919c' : '9da0aa'); t.rect(q[0], q[1], q[2], 1, 'b6b9c2'); });
    fin('Pavés');
    t = toile(); t.rect(0, 0, 16, 16, 'a9773f');
    for (i = 0; i < 4; i++) { t.rect(0, i * 4 + 3, 16, 1, '6e4a26'); t.rect(0, i * 4, 16, 1, 'be8a4c'); t.pt((i * 7 + 3) % 16, i * 4 + 1, '6e4a26'); t.rect((i * 5 + 9) % 16, i * 4, 1, 3, '8a5e30'); }
    fin('Plancher');

    for (f = 0; f < 4; f++) {
      t = toile(); t.rect(0, 0, 16, 16, '3b7cc2');
      for (i = 0; i < 16; i++) for (k = 0; k < 16; k++) if (h2(i, k, 31) > 0.86) t.pt(i, k, '3470b4');
      [[2, 3, 4], [10, 6, 3], [5, 10, 4], [12, 13, 3]].forEach(function (q) { t.rect((q[0] + f * 4) % 16, q[1], q[2], 1, '7fb6ea'); t.rect((q[0] + f * 4 + 1) % 16, q[1] + 1, q[2] - 1, 1, '5a9ad8'); });
      fin(f ? '' : 'Eau (animée)');
    }
    t = toile(); t.rect(0, 0, 16, 16, '6a2f28');
    for (k = 0; k < 4; k++) for (i = -1; i < 3; i++) { t.rect(i * 8 + (k % 2 ? 4 : 0) + 1, k * 4, 7, 3, (i + k) % 3 ? 'b0503f' : 'c0614c'); t.rect(i * 8 + (k % 2 ? 4 : 0) + 1, k * 4, 7, 1, 'cf755c'); }
    fin('Mur de briques');
    t = toile(); t.grain(41, [0.55, 0.9], ['777a84', '666972', '8b8e98']);
    t.rect(0, 15, 16, 1, '4b4d55'); t.rect(0, 7, 16, 1, '4b4d55'); t.rect(5, 0, 1, 7, '4b4d55'); t.rect(12, 8, 1, 7, '4b4d55'); t.rect(0, 0, 16, 1, '9ea1aa'); t.rect(0, 8, 16, 1, '9ea1aa');
    fin('Mur de pierre');
    t = toile(); t.rect(0, 0, 16, 16, '9c3f33');
    for (k = 0; k < 4; k++) for (i = -1; i < 3; i++) { t.disque(i * 8 + (k % 2 ? 4 : 0) + 4, k * 4 + 0.5, 4, k % 2 ? 'c75a45' : 'b84f3d'); }
    for (k = 0; k < 4; k++) t.rect(0, k * 4 + 3, 16, 1, '6f2a23');
    fin('Toit');
    t = toile(); t.rect(0, 0, 16, 16, '2a2a30'); t.rect(1, 1, 14, 14, '3a3b44'); fin('Ombre');

    t = toile(); t.rect(7, 10, 2, 5, '6e4a26'); t.rect(6, 14, 4, 1, '5a3b1e'); t.disque(8, 6.5, 6, '2f6b2c'); t.disque(7, 5.5, 4.6, '3f8a36'); t.disque(6, 4.5, 2.4, '58a747'); fin('Arbre');
    t = toile(); t.disque(8, 10.5, 5.2, '2f6b2c'); t.disque(7.2, 9.6, 3.8, '3f8a36'); t.pt(5, 8, '58a747'); t.pt(6, 7, '58a747'); t.pt(10, 11, 'd9525e'); t.pt(6, 12, 'd9525e'); fin('Buisson');
    t = toile(); t.disque(8, 10.5, 5, '5b5d66'); t.disque(7.4, 9.8, 3.9, '858893'); t.rect(5, 7, 3, 1, 'a9acb5'); fin('Rocher');
    t = toile(); t.rect(2, 5, 12, 10, '5a3b1e'); t.rect(3, 6, 10, 8, 'a9773f'); t.rect(3, 6, 10, 3, 'be8a4c'); t.rect(2, 9, 12, 1, '5a3b1e'); t.rect(7, 8, 2, 3, 'f2c94c'); t.rect(2, 5, 1, 10, '3f2a15'); t.rect(13, 5, 1, 10, '3f2a15'); fin('Coffre');
    t = toile(); t.rect(3, 1, 10, 15, '4a3018'); t.rect(4, 2, 8, 14, '8a5e30'); t.rect(4, 2, 8, 1, 'a9773f'); t.rect(7, 2, 1, 14, '6e4a26'); t.pt(10, 9, 'f2c94c'); fin('Porte');
    t = toile(); t.rect(2, 3, 12, 12, '6e4a26'); t.rect(3, 4, 10, 10, 'b98a52'); for (i = 0; i < 10; i++) { t.pt(3 + i, 4 + i, '8a5e30'); t.pt(12 - i, 4 + i, '8a5e30'); } t.rect(3, 4, 10, 1, 'd2a56a'); fin('Caisse');
    t = toile(); t.rect(7, 8, 2, 7, '6e4a26'); t.rect(2, 3, 12, 6, '5a3b1e'); t.rect(3, 4, 10, 4, 'c9a26a'); t.rect(5, 5, 6, 1, '6e4a26'); t.rect(5, 7, 4, 1, '6e4a26'); fin('Panneau');
    t = toile(); t.rect(4, 3, 8, 12, '6e4a26'); t.rect(5, 3, 6, 12, 'a9773f'); t.rect(4, 5, 8, 1, '4b4d55'); t.rect(4, 12, 8, 1, '4b4d55'); t.rect(6, 3, 1, 12, 'be8a4c'); fin('Tonneau');
    return { tuiles: L, noms: noms };
  }

  J.demo = function (cote) {
    var d = demoTuiles(), noms = {}, tuiles, liste, base, k;
    for (k in d.noms) if (d.noms[k]) noms[k] = d.noms[k];
    tuiles = d.tuiles.map(function (p) { return mettreACote(p, 16, cote); });
    base = tuiles.length;
    liste = M.auto.tuiles(tuiles[4], cote, 16, null);
    liste.forEach(function (p) { tuiles.push(p); });
    noms[base] = 'Terrain : chemin de terre';
    return J.creer({
      nom: 'Démonstration', tw: cote, th: cote, cols: COLONNES, nb: tuiles.length, pix: ranger(tuiles, cote, cote, COLONNES),
      anims: { 8: [8, 9, 10, 11].map(function (q) { return { t: q, d: 220 }; }) },
      terrains: [{ nom: 'Chemin de terre', forme: 16, base: base }], noms: noms, origine: 'demo'
    });
  };
})();
