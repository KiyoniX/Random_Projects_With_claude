(function () {
  'use strict';

  var racine = typeof window !== 'undefined' ? window : globalThis;
  var P = racine.Palettes;

  var EXACT_MAX = 4096;                   // au-delà, les couleurs de l'image sont regroupées en cases de 5 bits par canal
  var ALPHA_MIN = 128;                    // un pixel moins opaque est tenu pour transparent
  var TOURS_MAX = 24;                     // itérations des k-moyennes
  var ECART_RAMPE = 22;                   // degrés de teinte au-delà desquels deux couleurs voisines changent de rampe
  var LARGEUR_RAMPE = 90;                 // étendue de teinte maximale d'une rampe détectée
  var BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];

  P.METHODES = [
    { id: 'kmoy', nom: 'K-moyennes (OKLab)' },
    { id: 'variance', nom: 'Coupe par variance (RVB)' },
    { id: 'mediane', nom: 'Coupe médiane (RVB)' }
  ];
  P.TRAMES = [
    { id: 'aucune', nom: 'Sans tramage' },
    { id: 'ordonnee', nom: 'Tramage ordonné' },
    { id: 'diffusion', nom: 'Diffusion d\'erreur' }
  ];

  // ---------- Histogramme ----------
  // Les couleurs distinctes d'une image RVBA et leur nombre de pixels. Tant qu'il y en a peu, elles sont
  // gardées exactes et dans l'ordre de lecture ; sinon elles sont regroupées par cases.
  P.histogramme = function (data, w, h) {
    var n = w * h, carte = new Map(), exact = true, visibles = 0, i, p, cle, v, nb, rgb, poids, lab, q, k;
    for (i = 0, p = 0; i < n; i++, p += 4) {
      if (data[p + 3] < ALPHA_MIN) continue;
      visibles++;
      if (!exact) continue;
      cle = data[p] << 16 | data[p + 1] << 8 | data[p + 2];
      v = carte.get(cle);
      if (v !== undefined) carte.set(cle, v + 1);
      else if (carte.size >= EXACT_MAX) exact = false;
      else carte.set(cle, 1);
    }
    if (exact) {
      nb = carte.size; rgb = new Uint8Array(nb * 3); poids = new Float64Array(nb); k = 0;
      carte.forEach(function (compte, c) {
        rgb[k * 3] = c >> 16 & 255; rgb[k * 3 + 1] = c >> 8 & 255; rgb[k * 3 + 2] = c & 255;
        poids[k++] = compte;
      });
    } else {
      var comptes = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
      for (i = 0, p = 0; i < n; i++, p += 4) {
        if (data[p + 3] < ALPHA_MIN) continue;
        cle = (data[p] >> 3) << 10 | (data[p + 1] >> 3) << 5 | data[p + 2] >> 3;
        comptes[cle]++; sr[cle] += data[p]; sg[cle] += data[p + 1]; sb[cle] += data[p + 2];
      }
      nb = 0;
      for (i = 0; i < 32768; i++) if (comptes[i]) nb++;
      rgb = new Uint8Array(nb * 3); poids = new Float64Array(nb); k = 0;
      for (i = 0; i < 32768; i++) {
        if (!comptes[i]) continue;
        rgb[k * 3] = Math.round(sr[i] / comptes[i]); rgb[k * 3 + 1] = Math.round(sg[i] / comptes[i]); rgb[k * 3 + 2] = Math.round(sb[i] / comptes[i]);
        poids[k++] = comptes[i];
      }
    }
    lab = new Float64Array(nb * 3);
    for (k = 0; k < nb; k++) {
      q = P.rgbVersLab([rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]]);
      lab[k * 3] = q[0]; lab[k * 3 + 1] = q[1]; lab[k * 3 + 2] = q[2];
    }
    return { nb: nb, rgb: rgb, lab: lab, poids: poids, exact: exact, visibles: visibles, pixels: n };
  };

  function couleurDe(histo, k) { return [histo.rgb[k * 3], histo.rgb[k * 3 + 1], histo.rgb[k * 3 + 2]]; }
  function cle(c) { return c[0] << 16 | c[1] << 8 | c[2]; }
  function region(histo, k) { return (histo.rgb[k * 3] >> 5) << 6 | (histo.rgb[k * 3 + 1] >> 5) << 3 | histo.rgb[k * 3 + 2] >> 5; }

  // ---------- Coupes en boîtes ----------
  // Une boîte : des couleurs de l'histogramme, leur poids, et la dispersion qui décide de sa coupe.
  function boite(histo, w, membres, parVariance) {
    var b = { m: membres, poids: 0, axe: 0, note: 0 }, min = [255, 255, 255], max = [0, 0, 0], s1 = [0, 0, 0], s2 = [0, 0, 0], i, k, c, v, e, mieux = -1;
    for (i = 0; i < membres.length; i++) {
      k = membres[i]; b.poids += w[k];
      for (c = 0; c < 3; c++) {
        v = histo.rgb[k * 3 + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
        s1[c] += v * w[k]; s2[c] += v * v * w[k];
      }
    }
    for (c = 0; c < 3; c++) {
      if (max[c] === min[c]) continue;
      // Dispersion pondérée du canal, ou simple étendue pour la coupe médiane.
      e = parVariance ? Math.max(0, s2[c] - s1[c] * s1[c] / b.poids) : max[c] - min[c];
      if (e > mieux) { mieux = e; b.axe = c; }
      if (parVariance) b.note += e;
    }
    if (!parVariance && mieux > 0) b.note = mieux * mieux * b.poids;
    if (membres.length < 2 || mieux < 0) b.note = 0;
    else if (b.note <= 0) b.note = 1e-12;
    return b;
  }

  // Coupe jusqu'à obtenir n boîtes : toujours celle qui disperse le plus, le long de son canal le plus étendu.
  // La coupe médiane partage le poids en deux ; la coupe par variance cherche l'endroit qui sépare le mieux deux groupes.
  function boites(histo, w, membres, n, parVariance) {
    var liste = [boite(histo, w, membres, parVariance)], i, b, mieux, axe, tri, somme, sx, coupe, k, v, note, g, d, out = [];
    while (liste.length < n) {
      mieux = -1;
      for (i = 0; i < liste.length; i++) if (liste[i].note > 0 && (mieux < 0 || liste[i].note > liste[mieux].note)) mieux = i;
      if (mieux < 0) break;
      b = liste[mieux]; axe = b.axe;
      tri = b.m.slice().sort(function (x, y) { return histo.rgb[x * 3 + axe] - histo.rgb[y * 3 + axe] || x - y; });
      somme = 0; coupe = 1;
      if (parVariance) {
        sx = 0; note = -1; g = 0;
        for (k = 0; k < tri.length; k++) sx += histo.rgb[tri[k] * 3 + axe] * w[tri[k]];
        for (k = 0; k < tri.length - 1; k++) {
          v = histo.rgb[tri[k] * 3 + axe];
          somme += w[tri[k]]; g += v * w[tri[k]];
          if (histo.rgb[tri[k + 1] * 3 + axe] === v) continue;
          d = g / somme - (sx - g) / (b.poids - somme);
          d = d * d * somme * (b.poids - somme);
          if (d > note) { note = d; coupe = k + 1; }
        }
      } else {
        for (k = 0; k < tri.length - 1; k++) {
          somme += w[tri[k]];
          if (somme >= b.poids / 2) break;
        }
        coupe = Math.min(k + 1, tri.length - 1);
      }
      liste.splice(mieux, 1, boite(histo, w, tri.slice(0, coupe), parVariance), boite(histo, w, tri.slice(coupe), parVariance));
    }
    liste.forEach(function (bo) {
      var t = [0, 0, 0], j, q;
      for (j = 0; j < bo.m.length; j++) {
        q = bo.m[j];
        t[0] += histo.rgb[q * 3] * w[q]; t[1] += histo.rgb[q * 3 + 1] * w[q]; t[2] += histo.rgb[q * 3 + 2] * w[q];
      }
      out.push([Math.round(t[0] / bo.poids), Math.round(t[1] / bo.poids), Math.round(t[2] / bo.poids)]);
    });
    return out;
  }

  // ---------- K-moyennes ----------
  // Un tour : chaque couleur rejoint son centre le plus proche. Rend vrai si une couleur a changé de groupe.
  function affecter(lab, w, membres, cl, nc, groupe, dmin, sommes) {
    var nm = membres.length, bouge = false, i, j, m, d, dl, da, db, mieux, note, x, y, z, p;
    sommes.fill(0);
    for (i = 0; i < nm; i++) {
      m = membres[i] * 3; x = lab[m]; y = lab[m + 1]; z = lab[m + 2]; mieux = 0; note = 1e9;
      for (j = 0, p = 0; j < nc; j++, p += 3) {
        dl = x - cl[p]; da = y - cl[p + 1]; db = z - cl[p + 2];
        d = dl * dl + da * da + db * db;
        if (d < note) { note = d; mieux = j; }
      }
      dmin[i] = note;
      if (groupe[i] !== mieux) { groupe[i] = mieux; bouge = true; }
      d = w[membres[i]]; p = mieux * 4;
      sommes[p] += x * d; sommes[p + 1] += y * d; sommes[p + 2] += z * d; sommes[p + 3] += d;
    }
    return bouge;
  }

  // Les « fixes » sont des centres imposés qui ne bougent pas ; n centres libres s'y ajoutent.
  function kmoyennes(histo, w, membres, n, fixes) {
    var nm = membres.length, nf = fixes.length, cl = new Float64Array((nf + n) * 3), dmin = new Float64Array(nm), groupe = new Int32Array(nm).fill(-1);
    var lab = histo.lab, nc = 0, sommes, tour, i, j, c, loin, note, out = [];
    fixes.forEach(function (q) {
      c = P.rgbVersLab(q);
      cl[nc * 3] = c[0]; cl[nc * 3 + 1] = c[1]; cl[nc * 3 + 2] = c[2];
      nc++;
    });
    // Départ : les centres d'une coupe par variance, qui respecte déjà les poids.
    boites(histo, w, membres, n, true).forEach(function (q) {
      c = P.rgbVersLab(q);
      cl[nc * 3] = c[0]; cl[nc * 3 + 1] = c[1]; cl[nc * 3 + 2] = c[2];
      nc++;
    });
    sommes = new Float64Array(nc * 4);
    for (tour = 0; tour < TOURS_MAX; tour++) {
      if (!affecter(lab, w, membres, cl, nc, groupe, dmin, sommes)) break;
      for (j = nf; j < nc; j++) {
        if (sommes[j * 4 + 3] > 0) {
          cl[j * 3] = sommes[j * 4] / sommes[j * 4 + 3]; cl[j * 3 + 1] = sommes[j * 4 + 1] / sommes[j * 4 + 3]; cl[j * 3 + 2] = sommes[j * 4 + 2] / sommes[j * 4 + 3];
          continue;
        }
        // Un centre resté sans couleur repart de celle que la palette rend le plus mal.
        loin = -1; note = 0;
        for (i = 0; i < nm; i++) if (dmin[i] * w[membres[i]] > note) { note = dmin[i] * w[membres[i]]; loin = i; }
        if (loin < 0) continue;
        cl[j * 3] = lab[membres[loin] * 3]; cl[j * 3 + 1] = lab[membres[loin] * 3 + 1]; cl[j * 3 + 2] = lab[membres[loin] * 3 + 2];
        dmin[loin] = 0;
      }
    }
    for (j = nf; j < nc; j++) out.push(P.labVersRgb([cl[j * 3], cl[j * 3 + 1], cl[j * 3 + 2]]));
    return out;
  }

  // ---------- Extraction ----------
  // o : { methode, equilibre (0 : teintes rares, 1 : grandes masses), fixes ([r, v, b] à garder tels quels) }.
  // Rend n couleurs au plus, les fixes en tête. Si l'image en compte moins, elles sont rendues exactes, dans l'ordre de lecture.
  P.extraire = function (histo, n, o) {
    o = o || {};
    var fixes = (o.fixes || []).slice(0, n), prises = {}, membres = [], libres = n - fixes.length, puissance, w, masse, i, c, out, vus, manque, lf, d, loin, note;
    fixes.forEach(function (f) { prises[cle(f)] = true; });
    for (i = 0; i < histo.nb; i++) if (!prises[cle(couleurDe(histo, i))]) membres.push(i);
    if (libres <= 0 || !membres.length) return { couleurs: fixes, exact: histo.exact && !membres.length };
    if (histo.exact && membres.length <= libres) {
      return { couleurs: fixes.concat(membres.map(function (k) { return couleurDe(histo, k); })), exact: true };
    }
    // Le poids d'une couleur : ses pixels, corrigés selon la masse de sa région (512 régions dans le cube RVB).
    // À l'équilibre 1 chaque pixel compte pour un ; vers 0, toutes les régions tendent à peser autant,
    // si bien qu'une petite tache d'une teinte à part vaut une grande plage.
    puissance = 0.1 + 0.9 * P.borne(o.equilibre === undefined ? 0.6 : o.equilibre, 0, 1);
    w = new Float64Array(histo.nb); masse = new Float64Array(512);
    for (i = 0; i < histo.nb; i++) masse[region(histo, i)] += histo.poids[i];
    for (i = 0; i < histo.nb; i++) w[i] = histo.poids[i] * Math.pow(masse[region(histo, i)], puissance - 1);

    if (o.methode === 'mediane' || o.methode === 'variance') {
      // Une coupe en boîtes ne sait pas imposer un centre : les couleurs déjà rendues par une fixe lui sont retirées.
      if (fixes.length) {
        lf = fixes.map(P.rgbVersLab);
        membres = membres.filter(function (k) {
          var q = [histo.lab[k * 3], histo.lab[k * 3 + 1], histo.lab[k * 3 + 2]];
          return !lf.some(function (f) { return P.ecartLab(q, f) < 4; });
        });
      }
      out = membres.length ? boites(histo, w, membres, libres, o.methode === 'variance') : [];
    } else out = kmoyennes(histo, w, membres, libres, fixes);

    // Deux centres peuvent s'arrondir sur la même couleur : le doublon est remplacé par la couleur de l'image la plus mal rendue.
    vus = {}; fixes.forEach(function (f) { vus[cle(f)] = true; });
    out = out.filter(function (q) { if (vus[cle(q)]) return false; vus[cle(q)] = true; return true; });
    manque = Math.min(libres, membres.length) - out.length;
    while (manque-- > 0) {
      lf = fixes.concat(out).map(P.rgbVersLab); loin = -1; note = 0;
      for (i = 0; i < membres.length; i++) {
        c = couleurDe(histo, membres[i]);
        if (vus[cle(c)]) continue;
        d = Math.min.apply(null, lf.map(function (f) { return P.ecartLab(f, [histo.lab[membres[i] * 3], histo.lab[membres[i] * 3 + 1], histo.lab[membres[i] * 3 + 2]]); }));
        if (d * w[membres[i]] >= note) { note = d * w[membres[i]]; loin = i; }
      }
      if (loin < 0) break;
      c = couleurDe(histo, membres[loin]);
      vus[cle(c)] = true; out.push(c);
    }
    return { couleurs: fixes.concat(out), exact: false };
  };

  // L'indice de la couleur de la palette la plus proche, pour chaque couleur de l'histogramme.
  function attribuer(histo, palette) {
    var labs = palette.map(P.rgbVersLab), table = new Int32Array(histo.nb), dist = new Float64Array(histo.nb), i, j, d, dl, da, db, mieux, note;
    for (i = 0; i < histo.nb; i++) {
      mieux = 0; note = 1e9;
      for (j = 0; j < labs.length; j++) {
        dl = histo.lab[i * 3] - labs[j][0]; da = histo.lab[i * 3 + 1] - labs[j][1]; db = histo.lab[i * 3 + 2] - labs[j][2];
        d = dl * dl + da * da + db * db;
        if (d < note) { note = d; mieux = j; }
      }
      table[i] = mieux; dist[i] = 100 * Math.sqrt(note);
    }
    return { table: table, dist: dist };
  }

  // Écart perceptuel moyen entre l'image et son rendu avec la palette (sans tramage), pondéré par les pixels.
  P.erreurMoyenne = function (histo, palette) {
    if (!palette.length || !histo.nb) return 0;
    var a = attribuer(histo, palette), s = 0, t = 0, i;
    for (i = 0; i < histo.nb; i++) { s += a.dist[i] * histo.poids[i]; t += histo.poids[i]; }
    return s / t;
  };

  // Nombre de pixels que chaque couleur de la palette reprend.
  P.usage = function (histo, palette) {
    var u = new Float64Array(palette.length), a, i;
    if (!palette.length) return u;
    a = attribuer(histo, palette);
    for (i = 0; i < histo.nb; i++) u[a.table[i]] += histo.poids[i];
    return u;
  };

  // ---------- Réduction d'une palette ----------
  function melange(a, b, pa, pb) {
    var x = P.rgbVersLab(a), y = P.rgbVersLab(b), t = pb / (pa + pb);
    return P.labVersRgb([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  P.melange = melange;

  // Fond ensemble les couleurs les plus proches jusqu'à n'en garder que n. Une couleur verrouillée ne change
  // pas et absorbe celles qu'on lui fond ; deux verrouillées ne sont jamais fondues. poids est facultatif.
  P.reduire = function (couleurs, n, verrous, poids) {
    var g = couleurs.map(function (c, i) { return { c: c, lab: P.rgbVersLab(c), v: !!(verrous && verrous[i]), p: poids && poids[i] > 0 ? poids[i] : 1 }; });
    var i, j, a, b, d, note, x, y;
    n = Math.max(1, Math.round(n));
    while (g.length > n) {
      note = Infinity; a = -1;
      for (i = 0; i < g.length; i++) {
        for (j = i + 1; j < g.length; j++) {
          if (g[i].v && g[j].v) continue;
          d = P.ecartLab(g[i].lab, g[j].lab);
          d = d * d * g[i].p * g[j].p / (g[i].p + g[j].p);
          if (d < note) { note = d; a = i; b = j; }
        }
      }
      if (a < 0) break;
      x = g[a]; y = g[b];
      if (y.v) { x.c = y.c; x.v = true; }
      else if (!x.v) x.c = melange(x.c, y.c, x.p, y.p);
      x.lab = P.rgbVersLab(x.c); x.p += y.p;
      g.splice(b, 1);
    }
    return { couleurs: g.map(function (e) { return e.c; }), verrous: g.map(function (e) { return e.v; }) };
  };

  // Les paires de couleurs plus proches que le seuil, les plus proches d'abord.
  P.proches = function (couleurs, seuil, vision) {
    var labs = couleurs.map(function (c) { return P.rgbVersLab(vision ? P.simuler(c, vision) : c); }), out = [], i, j, d;
    for (i = 0; i < labs.length; i++) {
      for (j = i + 1; j < labs.length; j++) {
        d = P.ecartLab(labs[i], labs[j]);
        if (d < seuil) out.push({ a: i, b: j, ecart: d });
      }
    }
    return out.sort(function (x, y) { return x.ecart - y.ecart || x.a - y.a || x.b - y.b; });
  };

  // ---------- Tri ----------
  // Regroupe les couleurs par familles de teinte, chacune de l'ombre à la lumière ; les gris forment la leur.
  P.rampes = function (couleurs) {
    var lch = couleurs.map(P.rgbVersLch), gris = [], vives = [], groupes = [], i, saut = 0, plus = -1, d, parL;
    parL = function (a, b) { return lch[a][0] - lch[b][0] || a - b; };
    for (i = 0; i < couleurs.length; i++) (lch[i][1] < P.NEUTRE ? gris : vives).push(i);
    vives.sort(function (a, b) { return lch[a][2] - lch[b][2] || a - b; });
    // Le cercle des teintes est ouvert à son plus grand vide.
    for (i = 0; i < vives.length; i++) {
      d = (lch[vives[(i + 1) % vives.length]][2] - lch[vives[i]][2] + 360) % 360;
      if (vives.length > 1 && d > plus) { plus = d; saut = (i + 1) % vives.length; }
    }
    vives = vives.slice(saut).concat(vives.slice(0, saut));

    function ecartTeinte(a, b) { return (lch[b][2] - lch[a][2] + 360) % 360; }
    function couper(liste) {
      var k, cut = -1, vide = -1, etendue = 0, e;
      for (k = 1; k < liste.length; k++) {
        e = ecartTeinte(liste[k - 1], liste[k]);
        etendue += e;
        if (e > vide) { vide = e; cut = k; }
      }
      if (liste.length < 2 || (vide <= ECART_RAMPE && etendue <= LARGEUR_RAMPE) || vide <= 0) { groupes.push(liste); return; }
      couper(liste.slice(0, cut));
      couper(liste.slice(cut));
    }
    if (vives.length) couper(vives);
    groupes = groupes.map(function (g) { return g.sort(parL); });
    if (gris.length) groupes.unshift(gris.sort(parL));
    return groupes;
  };

  P.TRIS = [
    { id: 'rampes', nom: 'Par rampes détectées' },
    { id: 'teinte', nom: 'Par teinte' },
    { id: 'clarte', nom: 'Par clarté' },
    { id: 'saturation', nom: 'Par saturation' }
  ];
  // Rend l'ordre des indices après tri.
  P.trier = function (couleurs, critere) {
    var lch = couleurs.map(P.rgbVersLch), ordre = couleurs.map(function (c, i) { return i; });
    if (critere === 'rampes') return [].concat.apply([], P.rampes(couleurs));
    if (critere === 'clarte') return ordre.sort(function (a, b) { return lch[a][0] - lch[b][0] || a - b; });
    if (critere === 'saturation') return ordre.sort(function (a, b) { return lch[a][1] - lch[b][1] || a - b; });
    return ordre.sort(function (a, b) {
      var ga = lch[a][1] < P.NEUTRE, gb = lch[b][1] < P.NEUTRE;
      if (ga !== gb) return ga ? -1 : 1;
      return (ga ? 0 : lch[a][2] - lch[b][2]) || lch[a][0] - lch[b][0] || a - b;
    });
  };

  // ---------- Image recalculée ----------
  var cache = null;

  // L'indice de la couleur de la palette (pl : ses coordonnées à plat) la plus proche de (r, v, b).
  function proche(r, g, b, pl, nb, trio) {
    var cl = r << 16 | g << 8 | b, m = cache[cl], q, x, y, z, j, p, d, dl, da, db, note;
    if (m >= 0) return m;
    trio[0] = r; trio[1] = g; trio[2] = b;
    q = P.rgbVersLab(trio); x = q[0]; y = q[1]; z = q[2]; note = 1e9;
    for (j = 0, p = 0; j < nb; j++, p += 3) {
      dl = x - pl[p]; da = y - pl[p + 1]; db = z - pl[p + 2];
      d = dl * dl + da * da + db * db;
      if (d < note) { note = d; m = j; }
    }
    cache[cl] = m;
    return m;
  }
  function oct(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

  // Rend, pour chaque pixel, l'indice de sa couleur dans la palette (-1 : transparent).
  // o : { trame ('aucune', 'ordonnee', 'diffusion'), force (0…1) }.
  P.recalculer = function (data, w, h, palette, o) {
    o = o || {};
    var n = w * h, out = new Int16Array(n), nb = palette.length, pl = new Float64Array(nb * 3), trame = o.trame || 'aucune', force = o.force === undefined ? 0.5 : o.force;
    var i, j, p, x, y, r, g, b, q, k, etal, seuil, err, suiv, tmp, er, eg, eb, c, trio = [0, 0, 0];
    if (!nb) return out.fill(-1);
    if (!cache) cache = new Int16Array(1 << 24);
    cache.fill(-1);
    for (j = 0; j < nb; j++) { q = P.rgbVersLab(palette[j]); pl[j * 3] = q[0]; pl[j * 3 + 1] = q[1]; pl[j * 3 + 2] = q[2]; }

    if (trame === 'diffusion' && force > 0) {
      // Floyd et Steinberg : l'erreur de chaque pixel est reportée à droite et sur la ligne du dessous.
      err = new Float32Array((w + 2) * 3); suiv = new Float32Array((w + 2) * 3);
      for (y = 0, i = 0, p = 0; y < h; y++) {
        for (x = 0; x < w; x++, i++, p += 4) {
          if (data[p + 3] < ALPHA_MIN) { out[i] = -1; continue; }
          k = (x + 1) * 3;
          r = oct(data[p] + err[k]); g = oct(data[p + 1] + err[k + 1]); b = oct(data[p + 2] + err[k + 2]);
          j = proche(r, g, b, pl, nb, trio); out[i] = j; c = palette[j];
          er = (r - c[0]) * force; eg = (g - c[1]) * force; eb = (b - c[2]) * force;
          err[k + 3] += er * 0.4375; err[k + 4] += eg * 0.4375; err[k + 5] += eb * 0.4375;
          suiv[k - 3] += er * 0.1875; suiv[k - 2] += eg * 0.1875; suiv[k - 1] += eb * 0.1875;
          suiv[k] += er * 0.3125; suiv[k + 1] += eg * 0.3125; suiv[k + 2] += eb * 0.3125;
          suiv[k + 3] += er * 0.0625; suiv[k + 4] += eg * 0.0625; suiv[k + 5] += eb * 0.0625;
        }
        tmp = err; err = suiv; suiv = tmp; suiv.fill(0);
      }
      return out;
    }
    etal = trame === 'ordonnee' ? 220 / Math.cbrt(nb) * force : 0;
    for (y = 0, i = 0, p = 0; y < h; y++) {
      for (x = 0; x < w; x++, i++, p += 4) {
        if (data[p + 3] < ALPHA_MIN) { out[i] = -1; continue; }
        if (etal) {
          seuil = ((BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5) * etal;
          out[i] = proche(oct(data[p] + seuil), oct(data[p + 1] + seuil), oct(data[p + 2] + seuil), pl, nb, trio);
        } else out[i] = proche(data[p], data[p + 1], data[p + 2], pl, nb, trio);
      }
    }
    return out;
  };

  // Des indices aux pixels RVBA.
  P.peindre = function (indices, palette, cible) {
    var o = cible || new Uint8ClampedArray(indices.length * 4), i, p, c;
    for (i = 0, p = 0; i < indices.length; i++, p += 4) {
      if (indices[i] < 0) { o[p] = o[p + 1] = o[p + 2] = o[p + 3] = 0; continue; }
      c = palette[indices[i]];
      o[p] = c[0]; o[p + 1] = c[1]; o[p + 2] = c[2]; o[p + 3] = 255;
    }
    return o;
  };
})();
