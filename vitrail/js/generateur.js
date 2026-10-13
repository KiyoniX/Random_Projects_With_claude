(function () {
  'use strict';

  // Le générateur : un réseau de plombs plausible, tiré d'une graine, sur la forme du panneau en cours.
  // Il pose des plombs comme le ferait le maître verrier (un filet de bordure, puis le motif dans le champ,
  // des plombs de rupture pour que chaque pièce se coupe), puis vitre chaque pièce selon son rôle.
  var V = window.Vitrail, G = V.geo, R = V.rendu;

  V.MOTIFS = [
    { id: 'fleur', nom: 'Fleur stylisée' },
    { id: 'rosace', nom: 'Rosace' },
    { id: 'losanges', nom: 'Vitrerie à losanges' },
    { id: 'bordure', nom: 'Bordure à filet et médaillon' },
    { id: 'geometrique', nom: 'Géométrique' },
    { id: 'eclats', nom: 'Éclats' }
  ];

  function graineTexte(s) {
    var h = 1779033703 ^ s.length, i;
    for (i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    return h >>> 0;
  }
  function dir(a) { return { x: Math.cos(a), y: Math.sin(a) }; }
  function plus(c, r, a) { return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }; }

  // La famille d'un verre, pour lui donner un rôle.
  function famille(v) {
    var c = V.hsl(v.couleur), h = c.h;
    if (c.l > 0.78 && c.s < 0.45 || c.s < 0.15) return 'clair';
    if (h < 20 || h >= 335) return 'rouge';
    if (h < 72) return 'jaune';
    if (h < 175) return 'vert';
    if (h < 262) return 'bleu';
    return 'pourpre';
  }

  V.generer = function (motif, graine) {
    var doc = V.doc, f = doc.forme, L = f.l, H = f.h, lp = doc.plomb, rnd = R.hasard(graineTexte(String(graine) + '/' + motif));
    var lobe = f.type === 'rosace' || f.type === 'trefle' || f.type === 'quadrilobe', champ, cb, C, w, h, regions = [], filetPoly = null;
    var familles = {};

    G.bordure(doc);
    doc.grisaille = []; doc.pieces = [];
    doc.verres.forEach(function (v) { var k = famille(v); (familles[k] = familles[k] || []).push(v.id); });
    function tirer(l) { return l[Math.floor(rnd() * l.length)]; }
    // Un verre pour un rôle : la première famille de la liste qui existe dans l'atelier, sinon n'importe lequel.
    function verrePour(prefs) {
      for (var i = 0; i < prefs.length; i++) if (familles[prefs[i]]) return tirer(familles[prefs[i]]);
      return tirer(doc.verres).id;
    }

    function seg(a, b) { G.ajouter(doc, a, b, null, lp); }
    // Un bout qui tombe tout près d'un nœud existant s'y accroche, plutôt que de laisser un éclat de verre entre les deux.
    // Seuls les bouts nés du rognage (posés sur le bord du champ) s'accrochent ainsi.
    function accroche(p, a, b) {
      var n = G.dist(p, a) > 1e-6 && G.dist(p, b) > 1e-6 && G.noeudProche(doc, p, 9);
      return n && G.projeter(champ.concat([champ[0]]), doc.noeuds[n]).d < 0.5 ? { x: doc.noeuds[n].x, y: doc.noeuds[n].y } : p;
    }
    // ac : le plomb de rupture peut glisser jusqu'au nœud voisin sur le bord (jamais un plomb qui sert d'appui à d'autres).
    function segDans(a, b, ac) { G.clipSegment(champ, a, b).forEach(function (q) { seg(ac ? accroche(q[0], a, b) : q[0], ac ? accroche(q[1], a, b) : q[1]); }); }
    function chaine(pts, ferme) { G.ajouterChaine(doc, G.catmull(pts, ferme), lp); return G.polyContour(G.catmull(pts, ferme)); }
    function cercle(c, r) { G.ajouterChaine(doc, G.arc(c.x, c.y, r, -Math.PI / 2, Math.PI * 1.5), lp); }
    function dansCercle(c, r) { return function (p) { return G.dist(p, c) < r; }; }
    function role(test, nom, verre) { regions.push({ test: test, nom: nom, verre: verre }); }

    // ---------- Filet de bordure ----------
    function filet(fw) {
      var inner = { type: f.type, l: L - 2 * fw, h: H - 2 * fw, lobes: f.lobes, libre: f.libre }, segs, poly, P = 0, cum = [0], n, i, k, pas, t, p, c, coins = [], j, a, b, ta, tb, an, bis;
      segs = G.affine(G.contour(inner), 1, 1, fw, fw);
      G.ajouterChaine(doc, segs, lp);
      poly = G.polyContour(segs);
      if (f.type === 'rect') {
        // Des carrés aux quatre coins, et des tronçons réguliers le long des côtés.
        [[fw, fw, -1, -1], [L - fw, fw, 1, -1], [L - fw, H - fw, 1, 1], [fw, H - fw, -1, 1]].forEach(function (q) {
          seg({ x: q[0], y: q[1] }, { x: q[0] + q[2] * fw * 2, y: q[1] }); seg({ x: q[0], y: q[1] }, { x: q[0], y: q[1] + q[3] * fw * 2 });
        });
        n = Math.max(1, Math.round((L - 2 * fw) / (fw * 5)));
        for (i = 1; i < n; i++) { t = fw + (L - 2 * fw) * i / n; seg({ x: t, y: -5 }, { x: t, y: fw }); seg({ x: t, y: H - fw }, { x: t, y: H + 5 }); }
        n = Math.max(1, Math.round((H - 2 * fw) / (fw * 5)));
        for (i = 1; i < n; i++) { t = fw + (H - 2 * fw) * i / n; seg({ x: -5, y: t }, { x: fw, y: t }); seg({ x: L - fw, y: t }, { x: L + 5, y: t }); }
        return poly;
      }
      c = { x: L / 2, y: H * (f.type === 'lancette' ? 0.6 : 0.5) };
      // Les angles vifs du contour intérieur reçoivent une coupe d'onglet : sans elle, le filet y ferait un angle rentrant.
      for (j = 0; j < segs.length; j++) {
        a = segs[j]; b = segs[(j + 1) % segs.length];
        ta = a.c ? Math.atan2(a.b.y - a.c[3], a.b.x - a.c[2]) : Math.atan2(a.b.y - a.a.y, a.b.x - a.a.x);
        tb = b.c ? Math.atan2(b.c[1] - b.a.y, b.c[0] - b.a.x) : Math.atan2(b.b.y - b.a.y, b.b.x - b.a.x);
        an = Math.abs(Math.atan2(Math.sin(tb - ta), Math.cos(tb - ta)));
        if (an > 0.2) {
          bis = Math.atan2(b.a.y - c.y, b.a.x - c.x);
          coins.push(b.a);
          seg(b.a, plus(b.a, fw * 4, bis));
        }
      }
      for (i = 0; i < poly.length; i++) { P += G.dist(poly[i], poly[(i + 1) % poly.length]); cum.push(P); }
      n = Math.max(6, Math.round(P / (fw * 5)));
      pas = P / n;
      // On part du haut pour que les coupes tombent symétriquement.
      for (k = 0, j = 0; k < poly.length; k++) if (poly[k].y < poly[j].y) j = k;
      for (i = 0; i < n; i++) {
        t = (cum[j] + i * pas) % P;
        for (k = 0; k < poly.length - 1 && cum[k + 1] < t; k++) { /* segment qui contient t */ }
        a = poly[k]; b = poly[(k + 1) % poly.length];
        p = { x: a.x + (b.x - a.x) * (t - cum[k]) / (G.dist(a, b) || 1), y: a.y + (b.y - a.y) * (t - cum[k]) / (G.dist(a, b) || 1) };
        if (coins.some(function (q) { return G.dist(q, p) < fw * 2; })) continue;
        seg(p, plus(p, fw * 4, Math.atan2(p.y - c.y, p.x - c.x)));
      }
      return poly;
    }

    // Un polylobe : un anneau intérieur passe sous les lobes, et chaque pointe rentrante y descend par un plomb.
    function couronneLobes() {
      var pointes = G.pointesLobes(f), c = { x: L / 2, y: H / 2 }, k = 0.8, segs, poly, n = pointes.length;
      segs = G.affine(G.arc(0, 0, 1, -Math.PI / 2, Math.PI * 1.5), L / 2 * k * Math.hypot((pointes[0].x - c.x) / (L / 2), (pointes[0].y - c.y) / (H / 2)), H / 2 * k * Math.hypot((pointes[0].x - c.x) / (L / 2), (pointes[0].y - c.y) / (H / 2)), c.x, c.y);
      G.ajouterChaine(doc, segs, lp);
      poly = G.polyContour(segs);
      pointes.forEach(function (p, i) {
        var dedans = G.clipSegment(poly, c, p)[0], a;
        if (dedans) seg(p, dedans[1]);
        // Un grand lobe est partagé en deux par son milieu.
        if (n <= 8) {
          a = -Math.PI / 2 + i * 2 * Math.PI / n;
          dedans = G.clipSegment(poly, c, { x: c.x + Math.cos(a) * L, y: c.y + Math.sin(a) * H })[0];
          if (dedans) seg(dedans[1], { x: c.x + Math.cos(a) * L, y: c.y + Math.sin(a) * H });
        }
      });
      return poly;
    }

    var fw = Math.max(16, Math.min(40, Math.min(L, H) * 0.06));
    if (lobe) { champ = couronneLobes(); filetPoly = champ; }
    else if (motif === 'eclats') champ = G.contourPoly(doc);
    else { champ = filet(fw); filetPoly = champ; }
    cb = G.boite(champ); w = cb.x1 - cb.x0; h = cb.y1 - cb.y0;
    C = { x: (cb.x0 + cb.x1) / 2, y: (cb.y0 + cb.y1) / 2 };
    if (f.type === 'lancette') C.y = cb.y0 + Math.max(h * 0.5, Math.min(h, w * 0.866) * 0.8);

    var vFond = verrePour(['bleu', 'clair']), vFond2 = verrePour(['bleu', 'pourpre', 'clair']), vFilet = [verrePour(['jaune', 'rouge']), verrePour(['rouge', 'pourpre', 'bleu'])];

    var MOTIFS = {
      fleur: function () {
        var cf = { x: C.x, y: h > w * 1.3 ? cb.y0 + Math.min(h * 0.4, w * 0.9) : C.y - h * 0.1 }, Rf = Math.min(w * 0.42, h * 0.28), rc = Rf * (0.24 + rnd() * 0.06);
        var n = rnd() < 0.5 ? 5 : 7, d = Math.PI / n * 0.56, i, th, pts, vP = verrePour(['rouge', 'pourpre']), vP2 = verrePour(['pourpre', 'rouge', 'jaune']), vC = verrePour(['jaune', 'rouge']), vV = verrePour(['vert', 'jaune']);
        var sw = Math.max(12, Math.min(30, w * 0.07)), bas = cb.y1, gl = [], dr = [], k, yy, ond, larg, feuille;
        cercle(cf, rc);
        role(dansCercle(cf, rc), 'coeur', vC);
        for (i = 0; i < n; i++) {
          th = -Math.PI / 2 + i * 2 * Math.PI / n;
          pts = [plus(cf, rc, th - d), plus(cf, rc + (Rf - rc) * 0.5, th - d * 1.12), plus(cf, Rf, th), plus(cf, rc + (Rf - rc) * 0.5, th + d * 1.12), plus(cf, rc, th + d)];
          (function (poly, v) { role(function (p) { return G.dansPoly(poly, p); }, 'petale', v); })(chaine(pts, false), i % 2 ? vP2 : vP);
          segDans(plus(cf, Rf, th), plus(cf, Rf + Math.max(w, h) * 2, th), true);
        }
        // Le tertre : un plomb bombé en travers du pied du panneau.
        var yt = bas - Math.min(h * 0.12, w * 0.32), bout = G.clipSegment(champ, { x: cb.x0 - 50, y: yt }, { x: cb.x1 + 50, y: yt })[0], vT = verrePour(['vert', 'jaune']), tertre;
        if (bout) {
          tertre = chaine([bout[0], { x: cb.x0 + w * 0.3, y: yt - h * 0.025 }, { x: cb.x0 + w * 0.68, y: yt - h * 0.04 }, bout[1]], false);
          role(function (p) { return p.y > yt - h * 0.04 && !G.dansPoly(tertre.concat([{ x: cb.x1, y: cb.y0 }, { x: cb.x0, y: cb.y0 }]), p); }, 'tertre', vT);
        }
        // La tige : deux plombs qui ondulent un peu, du cœur jusqu'au tertre, recoupés en tronçons.
        ond = (rnd() - 0.5) * w * 0.12;
        // La tige passe entre les deux pétales du bas : sa largeur tient dans l'écart qu'ils laissent au cœur.
        sw = Math.max(12, Math.min(34, w * 0.075, 2 * rc * Math.sin((2 * Math.PI / n - 2.24 * d) / 2) * 0.9));
        var y0 = cf.y + Math.sqrt(rc * rc - sw * sw / 4), y1 = (bout ? yt : bas) - 8, troncons = Math.max(3, Math.ceil((y1 - y0) / (7 * sw))), NT = troncons * 2;
        for (k = 0; k <= NT; k++) {
          yy = y0 + (y1 - y0) * k / NT;
          // L'ondulation ne commence qu'une fois passés les pétales du bas.
          larg = k < 2 ? 0 : Math.sin((k - 1) / (NT - 1) * Math.PI) * ond;
          gl.push({ x: C.x - sw / 2 + larg, y: yy });
          dr.push({ x: C.x + sw / 2 + larg, y: yy });
        }
        // Le pied de la tige se pose exactement sur le tertre, et un plomb descend de là jusqu'au filet.
        function hauteurTertre(x) {
          for (var j = 0; tertre && j < tertre.length - 1; j++) if ((tertre[j].x - x) * (tertre[j + 1].x - x) <= 0) return tertre[j].y + (tertre[j + 1].y - tertre[j].y) * (x - tertre[j].x) / ((tertre[j + 1].x - tertre[j].x) || 1);
          return null;
        }
        if (hauteurTertre(gl[NT].x) !== null) { gl[NT].y = hauteurTertre(gl[NT].x); dr[NT].y = hauteurTertre(dr[NT].x); }
        chaine(gl, false); chaine(dr, false);
        if (tertre) segDans({ x: (gl[NT].x + dr[NT].x) / 2, y: hauteurTertre((gl[NT].x + dr[NT].x) / 2) }, { x: (gl[NT].x + dr[NT].x) / 2, y: bas + 50 });
        else { segDans(gl[NT], { x: gl[NT].x, y: bas + 50 }); segDans(dr[NT], { x: dr[NT].x, y: bas + 50 }); }
        for (k = 2; k < NT; k += 2) seg(gl[k], dr[k]);
        (function (poly) { role(function (p) { return G.dansPoly(poly, p); }, 'tige', vV); })(G.polyContour(G.catmull(gl, false)).concat([gl[NT], dr[NT]]).concat(G.polyContour(G.catmull(dr, false)).concat([dr[NT]]).reverse()));
        // Deux feuilles en pointe, l'une à gauche, l'autre à droite, avec un plomb de rupture qui prolonge leur pointe.
        feuille = function (P, Q, sens) {
          var m = { x: (P.x + Q.x) / 2, y: (P.y + Q.y) / 2 }, lg = Math.min(w * 0.34, (w / 2 - sw) * 0.85), T = { x: m.x + sens * lg, y: m.y - lg * 0.6 }, a, b;
          a = chaine([P, { x: P.x + sens * lg * 0.22, y: P.y - lg * 0.5 }, T], false);
          b = chaine([T, { x: Q.x + sens * lg * 0.62, y: Q.y - lg * 0.2 }, Q], false);
          (function (poly) { role(function (p) { return G.dansPoly(poly, p); }, 'feuille', vV); })(a.concat(b));
          segDans(T, { x: T.x + sens * w * 2, y: T.y - w * 2 * 0.55 }, true);
        };
        feuille(gl[NT / 2], gl[NT / 2 + 1], -1); feuille(dr[Math.round(NT * 2 / 3)], dr[Math.round(NT * 2 / 3) + 1], 1);
        role(function (p) { return p.y < cf.y; }, 'fond', vFond);
        role(function () { return true; }, 'fond', vFond2);
      },

      rosace: function () {
        var rond = f.type === 'oeil' || lobe, Rr = Math.min(w, h) * (rond ? 0.5 : 0.46), n = lobe ? (f.type === 'rosace' ? Math.max(5, Math.min(16, f.lobes)) : f.type === 'trefle' ? 6 : 8) : 8 + Math.floor(rnd() * 3) * 2;
        var ray = [0.2, 0.5, 0.78], i, a, cc = { x: L / 2, y: lobe || f.type === 'oeil' ? H / 2 : C.y }, v = [verrePour(['jaune']), verrePour(['rouge', 'pourpre']), verrePour(['bleu']), verrePour(['pourpre', 'rouge']), verrePour(['clair', 'bleu'])];
        if (rond) ray = [0.2, 0.46, 0.72];
        else ray.push(1);
        ray.forEach(function (r) { cercle(cc, Rr * r); });
        for (i = 0; i < n; i++) {
          a = -Math.PI / 2 + i * 2 * Math.PI / n;
          seg(plus(cc, Rr * ray[0], a), plus(cc, Rr * ray[1], a));
          seg(plus(cc, Rr * ray[1], a + Math.PI / n), plus(cc, Rr * ray[2], a + Math.PI / n));
          // Les pétales : une courbe qui va d'un rayon à l'autre en passant par le milieu de la couronne.
          G.ajouterChaine(doc, G.catmull([plus(cc, Rr * ray[1], a), plus(cc, Rr * (ray[1] + ray[2]) / 2, a + Math.PI / n * 0.45), plus(cc, Rr * ray[2], a + Math.PI / n)], false), lp);
          if (ray[3]) seg(plus(cc, Rr * ray[2], a), plus(cc, Rr * ray[3], a));
          segDans(plus(cc, Rr * ray[ray.length - 1], a + (ray[3] ? Math.PI / n : 0)), plus(cc, Math.max(L, H) * 2, a + (ray[3] ? Math.PI / n : 0)), true);
        }
        role(dansCercle(cc, Rr * ray[0]), 'coeur', v[0]);
        role(function (p) {
          var d = G.dist(p, cc), k = 0, s;
          while (k < ray.length && d > Rr * ray[k]) k++;
          s = Math.floor(((Math.atan2(p.y - cc.y, p.x - cc.x) + Math.PI / 2 + 4 * Math.PI) % (2 * Math.PI)) / (Math.PI / n));
          p.anneau = k; p.secteur = s;
          return k > 0 && k < ray.length;
        }, 'couronne', function (p) { return p.anneau === 1 ? v[1] : p.anneau === 2 ? (p.secteur % 2 ? v[2] : v[0]) : v[3]; });
        role(function () { return true; }, 'fond', v[4]);
      },

      losanges: function () {
        var sw = Math.max(50, Math.min(140, w / 4.5)), sh = sw * 1.45, k, a, b, big = Math.max(w, h) * 2, vC = verrePour(['clair']), vA = [verrePour(['jaune']), verrePour(['bleu']), verrePour(['rouge', 'pourpre'])];
        for (k = -40; k <= 40; k++) {
          // Les deux familles de diagonales ; un losange tombe pile au centre du champ.
          a = { x: C.x + (k + 0.5) * sw, y: C.y }; b = { x: a.x - big * sw / sh, y: a.y + big };
          if (Math.abs(a.x - C.x) < w * 3) { segDans({ x: a.x + big * sw / sh, y: a.y - big }, b); segDans({ x: a.x - big * sw / sh, y: a.y - big }, { x: a.x + big * sw / sh, y: a.y + big }); }
        }
        role(function (p) { return Math.abs(p.x - C.x) / sw + Math.abs(p.y - C.y) / sh < 0.5; }, 'centre', vA[2]);
        role(function (p) { return rnd() < 0.16; }, 'semis', function () { return tirer(vA); });
        role(function () { return true; }, 'fond', vC);
      },

      bordure: function () {
        var Rm = Math.min(w, h) * 0.42, haut = { x: C.x, y: C.y - Rm }, bas = { x: C.x, y: C.y + Rm }, ga = { x: C.x - Rm, y: C.y }, dr = { x: C.x + Rm, y: C.y }, rc = Rm * 0.62, big = Math.max(w, h) * 2, i, a;
        var vL = verrePour(['bleu']), vM = verrePour(['rouge', 'pourpre']), vO = verrePour(['jaune']), vX = verrePour(['clair', 'vert']);
        seg(haut, dr); seg(dr, bas); seg(bas, ga); seg(ga, haut);
        segDans(haut, { x: haut.x, y: haut.y - big }); segDans(bas, { x: bas.x, y: bas.y + big }); segDans(ga, { x: ga.x - big, y: ga.y }); segDans(dr, { x: dr.x + big, y: dr.y });
        cercle(C, rc); cercle(C, rc * 0.36);
        [haut, dr, bas, ga].forEach(function (p) { var u = Math.atan2(p.y - C.y, p.x - C.x); seg(p, plus(C, rc, u)); });
        for (i = 0; i < 8; i++) { a = -Math.PI / 2 + Math.PI / 8 + i * Math.PI / 4; seg(plus(C, rc * 0.36, a), plus(C, rc, a)); }
        role(dansCercle(C, rc * 0.36), 'coeur', vO);
        role(dansCercle(C, rc), 'medaillon', function (p) { return Math.floor(((Math.atan2(p.y - C.y, p.x - C.x) + 4 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 2 ? vM : vO; });
        role(function (p) { return Math.abs(p.x - C.x) + Math.abs(p.y - C.y) < Rm; }, 'losange', vL);
        role(function () { return true; }, 'fond', vX);
      },

      geometrique: function () {
        var cibles = Math.max(8, Math.round(w * h / (130 * 130))), boites = [{ x0: cb.x0, y0: cb.y0, x1: cb.x1, y1: cb.y1 }], i, bx, t, mieux;
        while (boites.length < cibles) {
          mieux = 0;
          for (i = 1; i < boites.length; i++) if ((boites[i].x1 - boites[i].x0) * (boites[i].y1 - boites[i].y0) > (boites[mieux].x1 - boites[mieux].x0) * (boites[mieux].y1 - boites[mieux].y0)) mieux = i;
          bx = boites.splice(mieux, 1)[0];
          t = 0.32 + rnd() * 0.36;
          if (bx.x1 - bx.x0 > bx.y1 - bx.y0) {
            t = bx.x0 + (bx.x1 - bx.x0) * t;
            segDans({ x: t, y: bx.y0 }, { x: t, y: bx.y1 });
            boites.push({ x0: bx.x0, y0: bx.y0, x1: t, y1: bx.y1 }, { x0: t, y0: bx.y0, x1: bx.x1, y1: bx.y1 });
          } else {
            t = bx.y0 + (bx.y1 - bx.y0) * t;
            segDans({ x: bx.x0, y: t }, { x: bx.x1, y: t });
            boites.push({ x0: bx.x0, y0: bx.y0, x1: bx.x1, y1: t }, { x0: bx.x0, y0: t, x1: bx.x1, y1: bx.y1 });
          }
        }
        // Quelques rectangles reçoivent une diagonale.
        boites.forEach(function (b) { if (rnd() < 0.3 && Math.min(b.x1 - b.x0, b.y1 - b.y0) > 60) { if (rnd() < 0.5) segDans({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }); else segDans({ x: b.x1, y: b.y0 }, { x: b.x0, y: b.y1 }); } });
        var l = doc.verres.map(function (v) { return v.id; });
        role(function () { return true; }, 'fond', function () { return rnd() < 0.45 ? vFond : tirer(l); });
      },

      eclats: function () {
        var pas = Math.max(70, Math.sqrt(w * h / 34)), sites = [], x, y, B = Math.max(w, h) * 2;
        for (y = cb.y0 + pas / 2; y < cb.y1; y += pas) for (x = cb.x0 + pas / 2; x < cb.x1; x += pas) sites.push({ x: x + (rnd() - 0.5) * pas * 0.8, y: y + (rnd() - 0.5) * pas * 0.8 });
        // Diagramme de Voronoï par demi-plans, comme les quartiers du plan de ville.
        sites.forEach(function (s, i) {
          var poly = [{ x: s.x - B, y: s.y - B }, { x: s.x + B, y: s.y - B }, { x: s.x + B, y: s.y + B }, { x: s.x - B, y: s.y + B }];
          sites.forEach(function (o, j) {
            if (j === i || G.dist(s, o) > pas * 3.2) return;
            var px = (s.x + o.x) / 2, py = (s.y + o.y) / 2, nx = o.x - s.x, ny = o.y - s.y, out = [], k, a, b, da, db, t;
            for (k = 0; k < poly.length; k++) {
              a = poly[k]; b = poly[(k + 1) % poly.length];
              da = (a.x - px) * nx + (a.y - py) * ny; db = (b.x - px) * nx + (b.y - py) * ny;
              if (da <= 0) out.push(a);
              if ((da <= 0) !== (db <= 0)) { t = da / (da - db); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
            }
            poly = out;
          });
          s.poly = poly;
        });
        sites.forEach(function (s, i) {
          s.poly.forEach(function (a, k) {
            var b = s.poly[(k + 1) % s.poly.length], mil = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            // Chaque arête est commune à deux cellules : on ne la pose qu'une fois.
            var j = sites.reduce(function (m, o, q) { return q !== i && (m < 0 || G.dist(o, mil) < G.dist(sites[m], mil)) ? q : m; }, -1);
            if (j > i || j < 0) segDans(a, b);
          });
        });
        var chauds = [verrePour(['jaune']), verrePour(['rouge']), verrePour(['pourpre'])], froids = [verrePour(['bleu']), verrePour(['vert', 'bleu']), verrePour(['clair'])];
        role(function () { return true; }, 'fond', function (p) { return rnd() < (p.y - cb.y0) / h ? tirer(chauds) : tirer(froids); });
      }
    };
    (MOTIFS[motif] || MOTIFS.fleur)();
    // Un plomb qui finirait dans le verre ne se poserait pas : le générateur n'en laisse aucun.
    G.elaguer(doc);

    var calc = G.analyser(doc), tour = {}, centre = { x: L / 2, y: H / 2 };
    // Les pièces du filet alternent leurs deux verres en faisant le tour du panneau.
    if (filetPoly) calc.faces.filter(function (fa) { return !G.dansPoly(filetPoly, fa.centre); })
      .sort(function (p, q) { return Math.atan2(p.centre.y - centre.y, p.centre.x - centre.x) - Math.atan2(q.centre.y - centre.y, q.centre.x - centre.x); })
      .forEach(function (fa, i) { tour[fa.numero] = vFilet[i % 2]; });
    doc.pieces = calc.faces.map(function (fa) {
      var p = { x: fa.centre.x, y: fa.centre.y }, v = tour[fa.numero] || 0, i, r;
      if (!v) for (i = 0; i < regions.length && !v; i++) {
        r = regions[i];
        if (r.test(p)) v = typeof r.verre === 'function' ? r.verre(p) : r.verre;
      }
      return { x: p.x, y: p.y, verre: v || vFond, graine: 0 };
    });
    doc.nom = (V.MOTIFS.filter(function (m) { return m.id === motif; })[0] || V.MOTIFS[0]).nom.toLowerCase() + ' ' + graine;
  };

  // garderHistorique : venu du menu, l'exemple s'annule par Ctrl+Z comme toute autre opération.
  V.exemple = function (garderHistorique) {
    V.doc = V.docNeuf({ type: 'lancette', l: 500, h: 1200, lobes: 8, libre: null });
    V.generer('fleur', 'vitrail');
    V.doc.nom = 'lancette à la fleur';
    if (!garderHistorique) V.oublier();
    V.calc = null;
    V.change(false);
  };
})();
