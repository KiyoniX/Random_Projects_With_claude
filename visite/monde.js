(function () {
  'use strict';

  var B = window.VisiteBatir, geo = window.PlanVille.geo, MAT = B.MAT, COUCHE = B.COUCHE;

  var S = 3.5;                                   // mètres par unité du plan
  var PAS = 8;                                   // maille du terrain, en mètres
  var MUR_H = 7, MUR_E = 1.2;                    // hauteur du chemin de ronde, demi-épaisseur de la courtine
  var PAR_H = 0.9, PAR_E = 0.45;                 // parapet : hauteur de l'appui, épaisseur
  var TOUR_R = 2.8, TOUR_H = 10.3;
  var PORTE_L = 6, PORTE_P = 4.5, PASSAGE = 2.2;   // demi-largeur et demi-profondeur d'une porte, demi-passage
  var ESCALIER = 14, PALIER = 2, MARCHE_L = 1.6;
  var DONJON_H = 24;
  var HORIZON = [1.5, 2.4, 4, 6.5], COLLINES = [10, 40, 85, 140];

  var ENDUITS = [[230, 216, 188], [224, 200, 152], [212, 180, 148], [236, 226, 204], [200, 178, 138], [222, 190, 166], [190, 172, 146], [214, 204, 170], [206, 196, 184], [232, 208, 150]];
  var TUILES = [[168, 84, 56], [150, 70, 48], [180, 100, 62], [140, 78, 58], [160, 92, 66]];
  var ARDOISES = [[84, 92, 108], [70, 78, 92], [96, 100, 112]];
  var CHAUMES = [[160, 140, 90], [142, 126, 86], [170, 150, 104]];
  var POUTRES = [[70, 50, 36], [58, 44, 34], [84, 58, 40], [48, 40, 36]];
  var REMPART = [176, 166, 150], CHATEAU = [164, 156, 144], EGLISE = [192, 180, 158];

  // Ce que le milieu change : couleurs du sol et des feuillages, part de conifères et d'ardoise, pente des toits.
  var MILIEUX = {
    '': { styles: [1, 1, 2, 2, 1, 0, 3, 2], herbe: [104, 120, 68], terre: [132, 112, 84], sousBois: [78, 100, 58], feuilles: [[74, 112, 52], [92, 124, 56], [62, 100, 50], [104, 122, 54]], coniferes: 0.12, ardoise: 0.3, pente: 1.12, neige: 0 },
    foret: { styles: [1, 2, 1, 2, 1, 2, 0, 1], herbe: [88, 108, 62], terre: [112, 98, 74], sousBois: [58, 84, 50], feuilles: [[56, 98, 48], [70, 108, 50], [48, 86, 46], [84, 110, 48]], coniferes: 0.45, ardoise: 0.4, pente: 1.2, neige: 0 },
    aride: { styles: [3, 3, 3, 0, 0, 3, 1, 3], herbe: [186, 160, 104], terre: [178, 148, 102], sousBois: [160, 146, 96], feuilles: [[118, 126, 70], [134, 132, 76], [100, 114, 64]], coniferes: 0.35, ardoise: 0, pente: 0.5, neige: 0 },
    froid: { styles: [1, 2, 0, 0, 1, 2, 1, 3], herbe: [206, 212, 222], terre: [156, 156, 160], sousBois: [200, 208, 214], feuilles: [[52, 80, 60], [64, 92, 72], [44, 70, 56]], coniferes: 0.85, ardoise: 0.7, pente: 1.4, neige: 1 }
  };
  var VENTS = ['du Levant', 'du Sud-Est', 'du Midi', 'du Sud-Ouest', 'du Couchant', 'du Nord-Ouest', 'du Nord', 'du Nord-Est'];
  var TYPES = { plaza: 'Place du Marché', castle: 'Château', park: 'Jardins', faubourg: 'Faubourg', fields: 'Champs', forest: 'Bois', plain: 'Prés' };

  // ---------- Outils ----------
  function M(p) { return { x: p.x * S, y: p.y * S, n: p.n, key: p.key }; }
  function lisse(a, b, x) { x = Math.max(0, Math.min(1, (x - a) / (b - a))); return x * x * (3 - 2 * x); }
  function hash2(i, j, g) {
    var h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ g;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function bruit(x, y, g) {
    var i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (hash2(i, j, g) * (1 - fx) + hash2(i + 1, j, g) * fx) * (1 - fy) + (hash2(i, j + 1, g) * (1 - fx) + hash2(i + 1, j + 1, g) * fx) * fy;
  }
  function dedans(poly, x, y) {
    var c = false, i, j, a, b;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a = poly[i]; b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  function couleur(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  // Les teintes des champs sont celles du plan, tirées du parchemin vers la terre : plus sombres et plus franches.
  function champ(hex, neige) {
    var c = couleur(hex), l = (c[0] + c[1] + c[2]) / 3;
    return c.map(function (v) { return Math.max(0, Math.min(255, neige ? 150 + (l + (v - l) * 1.5) * 0.4 : (l + (v - l) * 2.0) * 0.66)); });
  }

  // ---------- Monde ----------
  // Renvoie { monde, etapes } : chaque étape est [texte, fonction], à enchaîner dans l'ordre. Le monde est complet après la dernière.
  function creer(ville) {
    var m = ville.model, pal = MILIEUX[m.milieu] || MILIEUX[''], T = B.tampon(), rw = m.wallR * S;
    var graine = Math.round((m.wall[0].x * 977 + m.wall[0].y * 131) * 100) | 0, rnd = B.alea(graine);
    var segs = [], ronds = [], dalles = [], pleins = [], lieux = [], acces = [], lanternes = [], empreintes = [];
    var n = Math.floor(m.viewR * S * 2 / PAS) + 1, E = (n - 1) * PAS / 2, H = new Float32Array(n * n);
    var monde = { S: S, E: E, nom: ville.name, milieu: m.milieu, palette: pal, neige: pal.neige, mur: MUR_H, rayonMurs: rw };
    var etapes = [], W, portes = {}, courtines = [], couloirs = [], ecartees = 0;

    function mur(ax, ay, bx, by, z0, za, zb) { segs.push(ax, ay, bx, by, z0, za, zb === undefined ? za : zb); }
    function murs(poly, z0, top) {
      poly.forEach(function (a, i) { var b = poly[(i + 1) % poly.length]; mur(a.x, a.y, b.x, b.y, z0, top); });
    }
    function dalle(poly, z, ox, oy, gx, gy) {
      var flat = [];
      poly.forEach(function (p) { flat.push(p.x, p.y); });
      dalles.push({ poly: flat, z: z, ox: ox || 0, oy: oy || 0, gx: gx || 0, gy: gy || 0 });
    }

    // ---------- Terrain ----------
    // Plat dans les murs et autour, à peine vallonné vers le bord du plan ; l'horizon est une couronne de collines.
    function relief(x, y) {
      var r = Math.sqrt(x * x + y * y);
      return lisse(rw * 1.12, rw * 1.55, r) * ((bruit(x / 190, y / 190, graine) - 0.5) * 9 + (bruit(x / 60, y / 60, graine + 7) - 0.5) * 2);
    }
    // La hauteur du sol suit exactement les triangles du maillage, pour que le marcheur ne flotte ni ne s'enfonce.
    function zsol(x, y) {
      var gx = Math.max(0, Math.min(n - 1.0001, (x + E) / PAS)), gy = Math.max(0, Math.min(n - 1.0001, (y + E) / PAS));
      var i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, o = j * n + i, h00 = H[o], h10 = H[o + 1], h01 = H[o + n], h11 = H[o + n + 1];
      return fx > fy ? h00 + (h10 - h00) * fx + (h11 - h10) * fy : h00 + (h11 - h01) * fx + (h01 - h00) * fy;
    }
    function terrain() {
      var i, j, pave = B.BLOC / PAS, bi, bj, idx, k, f, bord = [], ring, prev, a, p, q;
      for (j = 0; j < n; j++) for (i = 0; i < n; i++) H[j * n + i] = relief(-E + i * PAS, -E + j * PAS);
      function h(i, j) { return H[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))]; }
      T.mat = MAT.SOL; T.teinte([255, 255, 255]); T.graine = 0;
      for (bj = 0; bj < n - 1; bj += pave) for (bi = 0; bi < n - 1; bi += pave) {
        T.bloc(COUCHE.SOL, -E + (bi + pave / 2) * PAS, -E + (bj + pave / 2) * PAS);
        idx = [];
        for (j = bj; j <= Math.min(bj + pave, n - 1); j++) for (i = bi; i <= Math.min(bi + pave, n - 1); i++) {
          idx[(j - bj) * (pave + 1) + i - bi] = T.v(-E + i * PAS, H[j * n + i], -E + j * PAS, h(i - 1, j) - h(i + 1, j), 2 * PAS, h(i, j - 1) - h(i, j + 1), 0, 0);
        }
        for (j = bj; j < Math.min(bj + pave, n - 1); j++) for (i = bi; i < Math.min(bi + pave, n - 1); i++) {
          k = (j - bj) * (pave + 1) + i - bi;
          T.t(idx[k], idx[k + 1], idx[k + pave + 2]); T.t(idx[k], idx[k + pave + 2], idx[k + pave + 1]);
        }
      }
      for (i = 0; i < n - 1; i++) bord.push([i, 0]);
      for (j = 0; j < n - 1; j++) bord.push([n - 1, j]);
      for (i = n - 1; i > 0; i--) bord.push([i, n - 1]);
      for (j = n - 1; j > 0; j--) bord.push([0, j]);
      T.bloc(COUCHE.SOL, 1e6, 1e6);
      prev = bord.map(function (c) { return T.v(-E + c[0] * PAS, H[c[1] * n + c[0]] - 0.05, -E + c[1] * PAS, 0, 1, 0, 0, 0); });
      for (k = 0; k < HORIZON.length; k++) {
        f = HORIZON[k];
        ring = bord.map(function (c) {
          var x = (-E + c[0] * PAS) * f, y = (-E + c[1] * PAS) * f;
          return T.v(x, COLLINES[k] * (0.25 + bruit(x / 700, y / 700, graine + 3) * 0.9 + bruit(x / 230, y / 230, graine + 5) * 0.25), y, -x, E * 3, -y, 0, 0);
        });
        for (a = 0; a < bord.length; a++) {
          p = a; q = (a + 1) % bord.length;
          T.t(prev[p], ring[p], ring[q]); T.t(prev[p], ring[q], prev[q]);
        }
        prev = ring;
      }
    }

    // ---------- Rempart ----------
    function dansVille(p) { return dedans(W, p.x, p.y); }
    // Au niveau du chemin de ronde, un bord est ouvert s'il donne sur la ville ou sur une courtine ; sinon il porte un parapet.
    function ouvert(p) {
      return dansVille(p) || courtines.some(function (c) {
        var s = (p.x - c.ax) * c.ux + (p.y - c.ay) * c.uy, t = (p.x - c.ax) * c.nx + (p.y - c.ay) * c.ny;
        return s > -0.02 && s < c.l + 0.02 && Math.abs(t) < MUR_E + 0.02;
      });
    }
    function bordure(a, b, nx, ny, h) {
      B.parapet(T, a.x, a.y, b.x, b.y, nx, ny, MUR_H, h, PAR_E);
      mur(a.x, a.y, b.x, b.y, MUR_H - 0.05, MUR_H + h + 0.8);
    }
    // Garnit de parapets le tour d'un polygone, par tronçons, là où il ne donne ni sur la ville ni sur une courtine.
    function ceinture(poly, pas, h) {
      B.aretes(poly).forEach(function (e) {
        var k = Math.max(1, Math.round(e.l / pas)), i, de = null, a, b, mid;
        function pt(i) { return { x: e.a.x + (e.b.x - e.a.x) * i / k, y: e.a.y + (e.b.y - e.a.y) * i / k }; }
        for (i = 0; i <= k; i++) {
          a = pt(i); b = pt(i + 1); mid = pt(i + 0.5);
          if (i < k && !(ouvert(a) && ouvert(b) && ouvert(mid))) { if (de === null) de = i; } else if (de !== null) { bordure(pt(de), a, e.nx, e.ny, h); de = null; }
        }
      });
    }

    function arche(g, P, demi, zn, zh, haut) {
      // Arc en plein cintre de part en part : deux faces percées, la voûte, et le massif au-dessus.
      var K = 8, i, a0, a1, t0, t1, z0, z1, cote;
      function R(r, t, z) { return [g.x + g.rx * r + g.tx * t, z, g.y + g.ry * r + g.ty * t]; }
      for (i = 0; i < K; i++) {
        a0 = Math.PI * i / K; a1 = Math.PI * (i + 1) / K;
        t0 = demi * Math.cos(a0); t1 = demi * Math.cos(a1); z0 = zn + demi * Math.sin(a0) * (zh - zn) / demi; z1 = zn + demi * Math.sin(a1) * (zh - zn) / demi;
        for (cote = -1; cote <= 1; cote += 2) T.face([].concat(R(cote * P, t0, z0), R(cote * P, t1, z1), R(cote * P, t1, haut), R(cote * P, t0, haut)), [t0, z0, t1, z1, t1, haut, t0, haut]);
        T.face([].concat(R(-P, t0, z0), R(P, t0, z0), R(P, t1, z1), R(-P, t1, z1)), [0, i * 0.8, 2 * P, i * 0.8, 2 * P, i * 0.8 + 0.8, 0, i * 0.8 + 0.8]);
      }
    }

    function rempart() {
      var i, a, b, c, dx, dy, l, ux, uy, s0, s1, toitTour = pal.ardoise > 0.5 ? MAT.ARDOISE : MAT.TUILE, teinteTour = pal.ardoise > 0.5 ? ARDOISES[1] : TUILES[1], vus = {}, k;
      W = m.wall.map(M);
      if (B.aireSignee(W) < 0) W.reverse();

      m.gates.forEach(function (gate) {
        var p = M(gate), din = null, dout = null, rx, ry, ang;
        function vers(q) { var x = q.x * S - p.x, y = q.y * S - p.y, l = Math.sqrt(x * x + y * y) || 1; return { x: x / l, y: y / l }; }
        m.avenues.forEach(function (av) { if (av[0].key === gate.key && av[1]) din = vers(av[1]); });
        m.highways.forEach(function (hw) { if (hw[0].key === gate.key && hw[1]) dout = vers(hw[1]); });
        // L'axe du passage suit la route qui sort de la ville, tant que les deux courtines viennent buter dans les flancs de la porte,
        // une de chaque côté ; sinon il se rapproche de la bissectrice des courtines, qui convient toujours.
        var wi = -1, da, db, bis, essais = [], k;
        W.forEach(function (v, k) { if (v.key === gate.key) wi = k; });
        function courtine(pas) {
          var j, q;
          for (j = 1; j < W.length; j++) { q = W[((wi + pas * j) % W.length + W.length) % W.length]; if (Math.pow(q.x - p.x, 2) + Math.pow(q.y - p.y, 2) > 144) break; }
          return vers({ x: q.x / S, y: q.y / S });
        }
        function unite(x, y) { var l = Math.sqrt(x * x + y * y); return l > 0.2 ? { x: x / l, y: y / l } : null; }
        function convient(r) {
          var ta = -da.x * r.y + da.y * r.x, ra = da.x * r.x + da.y * r.y, tb = -db.x * r.y + db.y * r.x, rb = db.x * r.x + db.y * r.y;
          return ta * tb < 0 && Math.abs(ta) >= 0.8 * Math.abs(ra) && Math.abs(tb) >= 0.8 * Math.abs(rb);
        }
        da = courtine(-1); db = courtine(1);
        bis = unite(da.x + db.x, da.y + db.y);
        if (bis && (din ? -(bis.x * din.x + bis.y * din.y) : bis.x * p.x + bis.y * p.y) < 0) { bis.x = -bis.x; bis.y = -bis.y; }
        if (dout) essais.push(dout);
        if (dout && bis) essais.push(unite(dout.x + bis.x, dout.y + bis.y));
        essais.push(bis, dout, unite((dout ? dout.x : 0) - (din ? din.x : 0), (dout ? dout.y : 0) - (din ? din.y : 0)), unite(p.x, p.y), { x: 1, y: 0 });
        essais = essais.filter(function (r) { return r; });
        k = 0;
        while (k < 2 && k < essais.length - 1 && !convient(essais[k])) k++;
        rx = essais[k].x; ry = essais[k].y;
        ang = Math.atan2(p.y, p.x);
        couloirs.push(B.rect(p.x + rx * 5.5, p.y + ry * 5.5, rx, ry, 16.5, 3.3));
        portes[gate.key] = { x: p.x, y: p.y, rx: rx, ry: ry, tx: -ry, ty: rx, nom: 'Porte ' + VENTS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8] };
      });
      // Une courtine qui part de l'emprise d'une porte ne commence qu'un peu avant d'en ressortir : elle se fond dans le massif.
      function recul(px, py, ux, uy) {
        var best = 0;
        m.gates.forEach(function (gate) {
          var g = portes[gate.key], r = (px - g.x) * g.rx + (py - g.y) * g.ry, t = (px - g.x) * g.tx + (py - g.y) * g.ty, dr = ux * g.rx + uy * g.ry, dt = ux * g.tx + uy * g.ty, sr, st;
          if (Math.abs(r) >= PORTE_P || Math.abs(t) >= PORTE_L) return;
          sr = dr > 1e-9 ? (PORTE_P - r) / dr : dr < -1e-9 ? (-PORTE_P - r) / dr : Infinity;
          st = dt > 1e-9 ? (PORTE_L - t) / dt : dt < -1e-9 ? (-PORTE_L - t) / dt : Infinity;
          best = Math.max(best, Math.min(sr, st) - 0.8);
        });
        return best;
      }
      // Pas de tour dans l'emprise d'une porte : elle boucherait le passage.
      W.forEach(function (v) {
        v.nue = m.gates.some(function (gate) { var g = portes[gate.key]; return Math.abs((v.x - g.x) * g.rx + (v.y - g.y) * g.ry) < PORTE_P + 0.5 && Math.abs((v.x - g.x) * g.tx + (v.y - g.y) * g.ty) < PORTE_L + 0.5; });
      });
      for (i = 0; i < W.length; i++) {
        a = W[i]; b = W[(i + 1) % W.length];
        dx = b.x - a.x; dy = b.y - a.y; l = Math.sqrt(dx * dx + dy * dy);
        if (l < 0.05) continue;
        ux = dx / l; uy = dy / l;
        s0 = recul(a.x, a.y, ux, uy);
        s1 = l - recul(b.x, b.y, -ux, -uy);
        if (s1 - s0 < 0.4) continue;
        courtines.push({ i: i, ax: a.x + ux * s0, ay: a.y + uy * s0, bx: a.x + ux * s1, by: a.y + uy * s1, ux: ux, uy: uy, nx: uy, ny: -ux, l: s1 - s0, pa: a.nue, pb: b.nue });
      }

      T.mat = MAT.PIERRE; T.teinte(REMPART); T.graine = 0;
      courtines.forEach(function (c) {
        var mx = (c.ax + c.bx) / 2, my = (c.ay + c.by) / 2, poly = B.rect(mx, my, c.ux, c.uy, c.l / 2, MUR_E), p0 = c.pa ? 0 : 2.2, p1 = c.l - (c.pb ? 0 : 2.2), ox = c.nx * MUR_E, oy = c.ny * MUR_E;
        T.bloc(COUCHE.MURS, mx, my);
        B.prisme(T, poly, -1.5, MUR_H);
        murs(poly, -9, MUR_H);
        dalle(poly, MUR_H);
        pleins.push(poly);
        if (p1 - p0 > 0.3) bordure({ x: c.ax + c.ux * p0 + ox, y: c.ay + c.uy * p0 + oy }, { x: c.ax + c.ux * p1 + ox, y: c.ay + c.uy * p1 + oy }, c.nx, c.ny, PAR_H);
      });

      // Tours : un tambour à la hauteur du chemin de ronde, ouvert à la gorge, sous un toit en poivrière.
      W.forEach(function (v, vi) {
        var gon;
        if (v.nue) return;
        gon = B.disque(v.x, v.y, TOUR_R, 12, vi * 0.7);
        T.bloc(COUCHE.MURS, v.x, v.y);
        T.mat = MAT.PIERRE; T.teinte(REMPART);
        B.prisme(T, gon, -1.5, MUR_H);
        murs(gon, -9, MUR_H);
        dalle(gon, MUR_H);
        ceinture(gon, 9, 1.3);
        T.mat = MAT.BOIS; T.teinte(POUTRES[0]);
        gon.forEach(function (p) { B.boite(T, p.x - (p.x - v.x) * 0.06, p.y - (p.y - v.y) * 0.06, 1, 0, 0.11, 0.11, MUR_H, TOUR_H); });
        T.mat = toitTour; T.teinte(teinteTour);
        B.cone(T, B.disque(v.x, v.y, TOUR_R + 0.7, 12, vi * 0.7), v.x, v.y, TOUR_H, TOUR_H + 5.2);
        empreintes.push(gon);
        pleins.push(gon);
      });

      // Portes : deux massifs, un passage voûté, une chambre de guet à colombages sous un toit à croupes.
      m.gates.forEach(function (gate, gi) {
        var g = portes[gate.key], tour = B.rect(g.x, g.y, g.rx, g.ry, PORTE_P, PORTE_L), cote, flanc, logis;
        T.bloc(COUCHE.MURS, g.x, g.y);
        T.mat = MAT.PIERRE; T.teinte(REMPART); T.graine = 0;
        for (cote = -1; cote <= 1; cote += 2) {
          flanc = B.rect(g.x + g.tx * cote * (PORTE_L + PASSAGE) / 2, g.y + g.ty * cote * (PORTE_L + PASSAGE) / 2, g.rx, g.ry, PORTE_P, (PORTE_L - PASSAGE) / 2);
          B.prisme(T, flanc, -1.5, MUR_H, false);
          murs(flanc, -9, MUR_H);
          pleins.push(flanc);
        }
        arche(g, PORTE_P, PASSAGE, 2.6, 4.8, MUR_H);
        T.face([tour[0].x, MUR_H, tour[0].y, tour[1].x, MUR_H, tour[1].y, tour[2].x, MUR_H, tour[2].y, tour[3].x, MUR_H, tour[3].y], [0, 0, 9, 0, 9, 12, 0, 12]);
        dalle(tour, MUR_H);
        ceinture(tour, 0.6, PAR_H);
        logis = B.rect(g.x, g.y, g.tx, g.ty, 3.5, 2.5);
        B.maison(T, logis, { base: MUR_H, fond: 0, etages: 1, toit: 'croupes', pente: 1.3, debord: 0.45, hToit: 9, mur: MAT.COLOMBAGE, teinte: ENDUITS[gi % ENDUITS.length], graine: 37 + gi * 16, bois: POUTRES[0], couv: toitTour, teinteToit: teinteTour, rues: [false, false, false, false], alea: rnd });
        murs(logis, MUR_H - 0.05, 99);
        empreintes.push(tour);
        lieux.push({ id: 'porte' + gi, nom: g.nom, x: g.x, y: g.y, r: 7, texte: 'Passer sous la ' + g.nom.charAt(0).toLowerCase() + g.nom.slice(1) });
        lanternes.push({ x: g.x - g.rx * (PORTE_P + 1.5), y: g.y - g.ry * (PORTE_P + 1.5) });
        lanternes.push({ x: g.x + g.rx * (PORTE_P + 1.5), y: g.y + g.ry * (PORTE_P + 1.5) });
        T.bloc(COUCHE.MURS, g.x, g.y);
        for (cote = -1; cote <= 1; cote += 2) {
          B.lanterne(T, g.x - g.rx * PORTE_P + g.tx * cote * (PASSAGE + 1), g.y - g.ry * PORTE_P + g.ty * cote * (PASSAGE + 1), -g.rx, -g.ry, 3.2);
          B.lanterne(T, g.x + g.rx * PORTE_P + g.tx * cote * (PASSAGE + 1), g.y + g.ry * PORTE_P + g.ty * cote * (PASSAGE + 1), g.rx, g.ry, 3.2);
        }
      });

      // Escaliers : une volée de pierre le long de la courtine, près de chaque porte.
      function escalier(c) {
        var s0 = (c.l - ESCALIER - PALIER) / 2, ix = -c.nx, iy = -c.ny, nb = 20, j, s, mid = MUR_E + MARCHE_L / 2, bas, haut, palier;
        function pt(s, o) { return { x: c.ax + c.ux * s + ix * o, y: c.ay + c.uy * s + iy * o }; }
        T.bloc(COUCHE.MURS, pt(s0, 0).x, pt(s0, 0).y);
        T.mat = MAT.PIERRE; T.teinte([168, 158, 142]); T.graine = 0;
        for (j = 0; j < nb; j++) {
          s = s0 + (j + 0.5) * ESCALIER / nb;
          B.boite(T, pt(s, mid).x, pt(s, mid).y, c.ux, c.uy, ESCALIER / nb / 2, MARCHE_L / 2, -0.5, (j + 1) * MUR_H / nb);
        }
        B.boite(T, pt(s0 + ESCALIER + PALIER / 2, mid).x, pt(s0 + ESCALIER + PALIER / 2, mid).y, c.ux, c.uy, PALIER / 2, MARCHE_L / 2, -0.5, MUR_H);
        bas = [pt(s0 + ESCALIER, MUR_E), pt(s0, MUR_E), pt(s0, MUR_E + MARCHE_L), pt(s0 + ESCALIER, MUR_E + MARCHE_L)];
        palier = [pt(s0 + ESCALIER + PALIER, MUR_E), pt(s0 + ESCALIER, MUR_E), pt(s0 + ESCALIER, MUR_E + MARCHE_L), pt(s0 + ESCALIER + PALIER, MUR_E + MARCHE_L)];
        dalle(bas, 0, bas[1].x, bas[1].y, c.ux * MUR_H / ESCALIER, c.uy * MUR_H / ESCALIER);
        dalle(palier, MUR_H);
        mur(bas[2].x, bas[2].y, bas[3].x, bas[3].y, -9, 0, MUR_H);
        mur(palier[2].x, palier[2].y, palier[3].x, palier[3].y, -9, MUR_H);
        mur(palier[3].x, palier[3].y, palier[0].x, palier[0].y, -9, MUR_H);
        haut = pt(s0 + ESCALIER + PALIER / 2, 0);
        monde.escaliers.push({ x: bas[1].x + ix * MARCHE_L / 2, y: bas[1].y + iy * MARCHE_L / 2, hx: haut.x, hy: haut.y });
      }
      monde.escaliers = [];
      m.gates.forEach(function (gate) {
        var debut = -1, j, c;
        courtines.forEach(function (c, ci) { if (W[c.i].key === gate.key) debut = ci; });
        for (j = 0; j < courtines.length; j++) {
          c = courtines[(Math.max(0, debut) + j) % courtines.length];
          if (c.l >= ESCALIER + PALIER + 9) { if (!vus[c.i]) { vus[c.i] = true; escalier(c); } return; }
        }
      });
      if (!monde.escaliers.length && courtines.length) {
        c = courtines[0];
        courtines.forEach(function (o) { if (o.l > c.l) c = o; });
        if (c.l >= ESCALIER + PALIER + 2) escalier(c);
      }
      if (monde.escaliers.length) lieux.push({ id: 'ronde', nom: 'Le chemin de ronde', haut: MUR_H - 0.5, ronde: true, texte: 'Monter sur le rempart par un escalier' });
    }

    // ---------- Monuments ----------
    function chateau() {
      var ch = m.castle, blk, kp, E, best = null, cellules = m.cells, c0, toit = pal.ardoise > 0 ? MAT.ARDOISE : MAT.TUILE, teinte = pal.ardoise > 0 ? ARDOISES[0] : TUILES[1], C, r, ax, tour, porte, pe, i, cx, cy;
      if (!ch) return;
      blk = B.net(ch.poly.map(M)); kp = ch.keep.length ? B.net(ch.keep.map(M)) : null;
      if (!blk) return;
      E = B.aretes(blk);
      // L'entrée s'ouvre sur la rue, du côté de la ville.
      [true, false].forEach(function (rue) {
        if (best) return;
        E.forEach(function (e) {
          var d = Math.sqrt(Math.pow((e.a.x + e.b.x) / 2, 2) + Math.pow((e.a.y + e.b.y) / 2, 2));
          if (e.l < 11 || (rue && !(cellules[e.a.n] && cellules[e.a.n].inner))) return;
          if (!best || d < best.d) best = { e: e, d: d };
        });
      });
      T.graine = 0;
      E.forEach(function (e) {
        var parts = [[0, e.l]], g;
        T.bloc(COUCHE.MURS, (e.a.x + e.b.x) / 2, (e.a.y + e.b.y) / 2);
        T.mat = MAT.PIERRE; T.teinte(CHATEAU);
        if (best && best.e === e) {
          parts = [[0, e.l / 2 - 2], [e.l / 2 + 2, e.l]];
          g = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, rx: e.nx, ry: e.ny, tx: e.ux, ty: e.uy };
          arche(g, 0.9, 2, 2.4, 4.2, 9.2);
          B.boite(T, g.x, g.y, e.ux, e.uy, 2, 0.9, 9.19, 9.2);
          B.parapet(T, g.x - e.ux * 2 + e.nx * 0.9, g.y - e.uy * 2 + e.ny * 0.9, g.x + e.ux * 2 + e.nx * 0.9, g.y + e.uy * 2 + e.ny * 0.9, e.nx, e.ny, 9.2, 0.7, 0.4);
          monde.entreeChateau = { x: g.x, y: g.y, nx: e.nx, ny: e.ny };
          lanternes.push({ x: g.x + e.nx * 2.5, y: g.y + e.ny * 2.5 });
          B.lanterne(T, g.x + e.ux * 3 + e.nx * 0.8, g.y + e.uy * 3 + e.ny * 0.8, e.nx, e.ny, 3.2);
          B.lanterne(T, g.x - e.ux * 3 + e.nx * 0.8, g.y - e.uy * 3 + e.ny * 0.8, e.nx, e.ny, 3.2);
          T.mat = MAT.PIERRE; T.teinte(CHATEAU);
        }
        parts.forEach(function (p) {
          var mx = e.a.x + e.ux * (p[0] + p[1]) / 2, my = e.a.y + e.uy * (p[0] + p[1]) / 2, poly = B.rect(mx, my, e.ux, e.uy, (p[1] - p[0]) / 2, 0.8);
          B.prisme(T, poly, -1.5, 8);
          B.parapet(T, e.a.x + e.ux * p[0] + e.nx * 0.8, e.a.y + e.uy * p[0] + e.ny * 0.8, e.a.x + e.ux * p[1] + e.nx * 0.8, e.a.y + e.uy * p[1] + e.ny * 0.8, e.nx, e.ny, 8, 0.7, 0.4);
          murs(poly, -9, 99);
          pleins.push(poly);
        });
      });
      blk.forEach(function (v, i) {
        var gon = B.disque(v.x, v.y, 2.5, 10, i);
        T.bloc(COUCHE.MURS, v.x, v.y);
        T.mat = MAT.PIERRE; T.teinte(CHATEAU);
        B.prisme(T, gon, -1.5, 11, false);
        murs(gon, -9, 99);
        T.mat = toit; T.teinte(teinte);
        B.cone(T, B.disque(v.x, v.y, 3, 10, i), v.x, v.y, 11, 16);
        empreintes.push(gon);
        pleins.push(gon);
      });
      if (!kp) return;

      // Le logis occupe l'emprise dessinée sur le plan ; le donjon s'élève en son milieu.
      c0 = geo.centroid(kp);
      T.bloc(COUCHE.MURS, c0.x, c0.y);
      B.maison(T, kp, { base: 0, fond: 1.5, etages: 3, rdc: 3.6, etage: 3.2, toit: 'croupes', pente: 0.8, debord: 0.3, hToit: 5.5, mur: MAT.EGLISE, teinte: CHATEAU, graine: 3, bois: POUTRES[0], couv: toit, teinteToit: teinte, alea: rnd, cheminee: true });
      murs(kp, -9, 99);
      empreintes.push(kp);
      pleins.push(kp);
      C = B.croupes(kp); r = Math.min(5.5, C.dmax * 0.5); ax = B.axeLong(kp);
      tour = B.rect(c0.x, c0.y, ax.ux, ax.uy, r, r);
      T.mat = MAT.PIERRE; T.teinte(CHATEAU); T.graine = 0;
      B.prisme(T, tour, 8, DONJON_H);
      B.aretes(tour).forEach(function (e) {
        B.parapet(T, e.a.x, e.a.y, e.b.x, e.b.y, e.nx, e.ny, DONJON_H, 1, 0.45);
        mur(e.a.x, e.a.y, e.b.x, e.b.y, DONJON_H - 0.05, DONJON_H + 2.5);
      });
      dalle(tour, DONJON_H);
      T.mat = MAT.BOIS; T.teinte([90, 66, 44]);
      B.boite(T, c0.x, c0.y, ax.ux, ax.uy, 0.6, 0.6, DONJON_H, DONJON_H + 0.07);
      // Une bannière au sommet, pour reconnaître le donjon de loin.
      B.boite(T, c0.x + ax.ux * (r - 0.6), c0.y + ax.uy * (r - 0.6), 1, 0, 0.06, 0.06, DONJON_H, DONJON_H + 7);
      T.mat = MAT.LANTERNE; T.teinte([170, 40, 30]); T.graine = 255;
      T.face([c0.x + ax.ux * (r - 0.6), DONJON_H + 6.9, c0.y + ax.uy * (r - 0.6), c0.x + ax.ux * (r - 0.6) - ax.uy * 2.6, DONJON_H + 6.3, c0.y + ax.uy * (r - 0.6) + ax.ux * 2.6, c0.x + ax.ux * (r - 0.6), DONJON_H + 5.6, c0.y + ax.uy * (r - 0.6)], [0, 0, 1, 0.5, 0, 1]);

      // La porte du logis mène au sommet ; la trappe en redescend.
      porte = monde.entreeChateau || { x: 0, y: 0 };
      B.aretes(kp).forEach(function (e) {
        var d = Math.pow((e.a.x + e.b.x) / 2 - porte.x, 2) + Math.pow((e.a.y + e.b.y) / 2 - porte.y, 2);
        if (e.l > 3 && (!pe || d < pe.d)) pe = { e: e, d: d };
      });
      if (!pe) return;
      i = pe.e; cx = (i.a.x + i.b.x) / 2; cy = (i.a.y + i.b.y) / 2;
      T.mat = MAT.BOIS; T.teinte([84, 58, 38]); T.graine = 0;
      B.boite(T, cx + i.nx * 0.06, cy + i.ny * 0.06, i.ux, i.uy, 0.9, 0.1, 0, 2.7);
      B.lanterne(T, cx + i.ux * 1.6, cy + i.uy * 1.6, i.nx, i.ny, 2.6);
      lanternes.push({ x: cx + i.nx * 1.5, y: cy + i.ny * 1.5 });
      acces.push({ x: cx + i.nx * 1.1, y: cy + i.ny * 1.1, z: 0, r: 1.7, texte: 'monter au sommet du donjon', vers: { x: c0.x - ax.ux * 1.6, y: c0.y - ax.uy * 1.6, z: DONJON_H, cap: Math.atan2(-c0.y, -c0.x) } });
      acces.push({ x: c0.x, y: c0.y, z: DONJON_H, r: 1.3, texte: 'redescendre par la trappe', vers: { x: cx + i.nx * 2.2, y: cy + i.ny * 2.2, z: 0, cap: Math.atan2(i.ny, i.nx) } });
      lieux.push({ id: 'donjon', nom: 'Le sommet du donjon', x: c0.x, y: c0.y, r: r + 1, haut: DONJON_H - 1, texte: 'Entrer au château et monter au donjon' });
    }

    function eglise() {
      var e = m.church, x, y, h, w, hn, cl, cx, cy, hc, couv = pal.ardoise > 0 ? MAT.ARDOISE : MAT.TUILE, teinte = pal.ardoise > 0 ? ARDOISES[1] : TUILES[0], o, ct, vx, vy, pit, i, a;
      if (!e) return;
      x = e.x * S; y = e.y * S; h = e.h * S; w = e.w * S; vx = -e.uy; vy = e.ux;
      hn = Math.max(8, Math.min(13, w * 1.9));
      T.bloc(COUCHE.MURS, x, y);
      o = { base: 0, fond: 1.5, etages: 1, rdc: hn, toit: 'pignon', pente: 1.25, debord: 0.3, hToit: 99, mur: MAT.EGLISE, teinte: EGLISE, graine: 1, bois: POUTRES[0], couv: couv, teinteToit: teinte, alea: rnd };
      o.axe = { ux: e.ux, uy: e.uy };
      B.maison(T, B.rect(x, y, e.ux, e.uy, h, w), o);
      cx = x - e.ux * 0.15 * h; cy = y - e.uy * 0.15 * h;
      o.axe = { ux: vx, uy: vy };
      B.maison(T, B.rect(cx, cy, vx, vy, 0.55 * h, 0.2 * h), o);
      // Le clocher sur la croisée : un fût de pierre, une chambre des cloches ajourée, une flèche.
      ct = Math.min(w, 0.2 * h) * 0.96; hc = hn * 2.7;
      cl = B.rect(cx, cy, e.ux, e.uy, ct, ct);
      T.mat = MAT.PIERRE; T.teinte(EGLISE); T.graine = 0;
      B.prisme(T, cl, hn, hc - 5, false);
      B.maison(T, cl, { base: hc - 5, fond: 0, etages: 1, rdc: 5, toit: 'croupes', pente: 4.4, debord: 0.35, hToit: 99, mur: MAT.EGLISE, teinte: EGLISE, graine: 2, bois: POUTRES[0], couv: couv, teinteToit: teinte, alea: rnd });
      murs(e.poly.map(M), -9, 99);
      pleins.push(B.rect(x, y, e.ux, e.uy, h, w), B.rect(cx, cy, vx, vy, 0.55 * h, 0.2 * h));
      empreintes.push(B.rect(x, y, e.ux, e.uy, h, w), B.rect(cx, cy, vx, vy, 0.55 * h, 0.2 * h));
      monde.clocher = { x: cx, y: cy, h: hc + ct * 4.4 };
      lieux.push({ id: 'eglise', nom: e.name, x: x, y: y, r: h * 1.3 + 2, texte: 'Aller jusqu\'à l\'église, sous son clocher' });
      lanternes.push({ x: x + e.ux * (h + 2), y: y + e.uy * (h + 2) });
      // Le portail, au bout de la nef.
      T.mat = MAT.BOIS; T.teinte([84, 58, 38]);
      B.boite(T, x + e.ux * (h + 0.05), y + e.uy * (h + 0.05), vx, vy, 1.3, 0.1, 0, 3.6);

      // Le puits des catacombes, au chevet.
      if (!e.pit) return;
      pit = M(e.pit);
      T.bloc(COUCHE.BATI, pit.x, pit.y);
      T.mat = MAT.PIERRE; T.teinte([150, 144, 134]);
      B.prisme(T, B.disque(pit.x, pit.y, 1.25, 10, 0), -0.5, 0.95);
      T.mat = MAT.NOIR; T.teinte([0, 0, 0]);
      a = [];
      B.disque(pit.x, pit.y, 0.9, 10, 0).forEach(function (p) { a.push(p.x, 0.97, p.y); });
      T.face(a, a.slice(0, 20));
      T.mat = MAT.BOIS; T.teinte(POUTRES[1]);
      for (i = -1; i <= 1; i += 2) B.boite(T, pit.x + i * 1.1, pit.y, 1, 0, 0.09, 0.09, 0.9, 2.5);
      B.boite(T, pit.x, pit.y, 1, 0, 1.2, 0.07, 2.2, 2.34);
      T.mat = couv; T.teinte(teinte);
      T.face([pit.x - 1.5, 2.4, pit.y - 1.1, pit.x + 1.5, 2.4, pit.y - 1.1, pit.x + 1.5, 3.2, pit.y, pit.x - 1.5, 3.2, pit.y], [0, 0, 3, 0, 3, 1.4, 0, 1.4]);
      T.face([pit.x - 1.5, 2.4, pit.y + 1.1, pit.x + 1.5, 2.4, pit.y + 1.1, pit.x + 1.5, 3.2, pit.y, pit.x - 1.5, 3.2, pit.y], [0, 0, 3, 0, 3, 1.4, 0, 1.4]);
      ronds.push(pit.x, pit.y, 1.3, -9, 99);
      monde.puits = pit;
      lieux.push({ id: 'puits', nom: 'Le puits des catacombes', x: pit.x, y: pit.y, r: 4.5, texte: 'Chercher le puits noir, au chevet de l\'église', catacombes: true });
    }

    function fontaine() {
      var pl = m.plaza, f, x, y, a = [];
      if (!pl) return;
      f = pl.fountain; x = f.x * S; y = f.y * S;
      T.bloc(COUCHE.BATI, x, y);
      T.mat = MAT.PIERRE; T.teinte([188, 182, 170]); T.graine = 0;
      B.prisme(T, B.disque(x, y, 4.4, 16, 0), -0.5, 0.18);
      B.prisme(T, B.disque(x, y, 3.2, 8, 0.39), -0.5, 0.85);
      B.prisme(T, B.disque(x, y, 0.42, 8, 0), 0.5, 2.3);
      B.prisme(T, B.disque(x, y, 1.15, 8, 0.39), 2.3, 2.55);
      B.prisme(T, B.disque(x, y, 0.2, 6, 0), 2.55, 3.3);
      T.mat = MAT.EAU; T.teinte([70, 110, 120]);
      B.disque(x, y, 2.85, 8, 0.39).forEach(function (p) { a.push(p.x, 0.87, p.y); });
      T.face(a, a.slice(0, 16));
      a = [];
      B.disque(x, y, 0.95, 8, 0.39).forEach(function (p) { a.push(p.x, 2.57, p.y); });
      T.face(a, a.slice(0, 16));
      ronds.push(x, y, 3.3, -9, 3);
      monde.fontaine = { x: x, y: y };
      lieux.push({ id: 'fontaine', nom: 'La fontaine du marché', x: x, y: y, r: 7.5, texte: 'Rejoindre la fontaine, sur la place' });
    }

    // ---------- Maisons ----------
    // Deux polygones convexes se chevauchent si aucune de leurs arêtes ne les sépare.
    function chevauche(p, q) {
      return ![p, q].some(function (poly) {
        return B.aretes(poly).some(function (e) {
          var lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
          p.forEach(function (v) { var d = v.x * e.nx + v.y * e.ny; lo = Math.min(lo, d); hi = Math.max(hi, d); });
          q.forEach(function (v) { var d = v.x * e.nx + v.y * e.ny; lo2 = Math.min(lo2, d); hi2 = Math.max(hi2, d); });
          return hi < lo2 || hi2 < lo;
        });
      });
    }
    // Le plan laisse parfois une maison au débouché d'une porte, la route la contournant de près. Montée en volume,
    // elle boucherait le passage : on dégage un couloir devant et derrière chaque porte.
    function gene(poly) {
      return couloirs.some(function (c) { return chevauche(poly, c); });
    }
    function maisons(de, a) {
      var i, b, c, poly, r, aire, o, fau, riche, k, e, best, hb, z, ardoises;
      for (i = de; i < a; i++) {
        b = m.buildings[i]; c = m.cells[b.ward];
        poly = B.net(b.poly.map(M));
        if (!poly) continue;
        if (gene(poly)) { ecartees++; continue; }
        r = B.alea(graine + i * 7919);
        aire = B.aireSignee(poly); fau = !c.inner; riche = fau ? 0 : Math.max(0, 1 - c.d / m.wallR);
        k = B.pointe(poly);
        ardoises = hash2(b.ward, 5, graine) < pal.ardoise;
        z = 0;
        if (fau) { z = Infinity; poly.forEach(function (p) { z = Math.min(z, zsol(p.x, p.y)); }); }
        o = {
          base: z, fond: fau ? 2 : 0.6, alea: r,
          etages: Math.max(1, Math.min(4, Math.round(fau ? 1 + r() * 0.9 : 1.3 + riche * 1.9 + r() * 1.3))),
          debord: k < 0.5 ? 0.12 : 0.38, hToit: 7.5, pente: pal.pente * (0.9 + r() * 0.25),
          mur: MAT.COLOMBAGE, teinte: ENDUITS[Math.floor(r() * ENDUITS.length)], graine: Math.floor(r() * 64) * 4 + pal.styles[Math.floor(r() * pal.styles.length)], bois: POUTRES[Math.floor(r() * POUTRES.length)],
          rues: poly.map(function (p) { return fau || p.n !== undefined; })
        };
        if (pal.pente < 0.8) o.teinte = [Math.min(255, o.teinte[0] + 14), Math.min(255, o.teinte[1] + 14), Math.min(255, o.teinte[2] + 10)];
        if (aire < 45) o.etages = Math.min(o.etages, 2);
        o.enc = !fau && o.etages > 1 && k > 0.6 && aire > 40 && pal.pente > 0.8 && r() < 0.5 ? 0.38 : 0;
        if (fau && pal.pente > 0.8 && !pal.neige) { o.couv = MAT.CHAUME; o.teinteToit = CHAUMES[Math.floor(r() * CHAUMES.length)]; o.pente *= 1.1; }
        else if (ardoises && r() < 0.85) { o.couv = MAT.ARDOISE; o.teinteToit = ARDOISES[Math.floor(r() * ARDOISES.length)]; o.pente *= 1.12; }
        else { o.couv = MAT.TUILE; o.teinteToit = TUILES[Math.floor(r() * TUILES.length)]; }
        // Deux pans si la parcelle est à peu près un rectangle, croupes sinon.
        o.toit = 'croupes';
        if (poly.length === 4) {
          e = B.aretes(poly); best = 0;
          e.forEach(function (q, j) { if (q.l > e[best].l) best = j; });
          if (Math.abs(e[best].ux * e[(best + 2) % 4].ux + e[best].uy * e[(best + 2) % 4].uy) > 0.92 && Math.abs(e[best].ux * e[(best + 1) % 4].ux + e[best].uy * e[(best + 1) % 4].uy) < 0.45 && r() < 0.8) o.toit = 'pignon';
        }
        o.cheminee = r() < 0.7;
        o.lucarne = o.etages > 1 && r() < 0.4;
        c = geo.centroid(poly);
        T.bloc(COUCHE.BATI, c.x, c.y);
        B.maison(T, poly, o);
        murs(poly, -9, 99);
        empreintes.push(poly);
        pleins.push(poly);
        // Une lanterne de loin en loin, sur une façade qui donne sur la rue.
        if (!fau && i % 5 === 0) {
          e = B.aretes(poly); best = null;
          e.forEach(function (q, j) { if (o.rues[j] && (!best || q.l > best.l)) best = q; });
          if (best) {
            hb = o.enc || 0;
            B.lanterne(T, (best.a.x + best.b.x) / 2 + best.nx * hb, (best.a.y + best.b.y) / 2 + best.ny * hb, best.nx, best.ny, o.etages > 1 ? 3.3 : 2.4);
            lanternes.push({ x: (best.a.x + best.b.x) / 2 + best.nx * (hb + 0.9), y: (best.a.y + best.b.y) / 2 + best.ny * (hb + 0.9) });
          }
        }
      }
    }

    // ---------- Arbres ----------
    function arbres() {
      m.trees.forEach(function (t, i) {
        var x = t.x * S, y = t.y * S, r = B.alea(graine + i * 31 + 5), c = m.cells[t.ward], ray = t.r * S * (0.85 + r() * 0.3), con;
        if (Math.abs(x) > E - 3 || Math.abs(y) > E - 3) return;
        con = r() < (c.type === 'park' ? pal.coniferes * 0.4 : pal.coniferes);
        T.bloc(COUCHE.ARBRES, x, y);
        B.arbre(T, x, y, zsol(x, y), con ? ray * 0.85 : ray, con, r, pal.feuilles[Math.floor(r() * pal.feuilles.length)]);
        ronds.push(x, y, 0.32, -9, 99);
      });
    }

    // ---------- Fin ----------
    function fin() {
      var mesh = T.fin(), pl = m.plaza, f = monde.fontaine, av, d, l;
      monde.sommets = mesh.sommets; monde.nSommets = mesh.nSommets; monde.indices = mesh.indices; monde.blocs = mesh.blocs; monde.octets = mesh.octets;
      monde.collision = { segs: new Float32Array(segs), ronds: new Float32Array(ronds), dalles: dalles, limite: E - 6, zsol: zsol,
        pleins: pleins.map(function (p) { var f = []; p.forEach(function (q) { f.push(q.x, q.y); }); return { poly: f }; })
      };
      monde.lieux = lieux; monde.acces = acces; monde.portes = m.gates.map(function (g) { return portes[g.key]; });
      monde.rempart = W; monde.courtines = courtines;
      // Ce que le rendu peint sur le sol : la ville pavée, les champs et leurs sillons, les routes, l'ombre au pied des murs.
      monde.sol = {
        herbe: pal.herbe, terre: pal.terre, sousBois: pal.sousBois, neige: pal.neige,
        ville: W,
        ilots: m.blocks.filter(function (b) { var t = m.cells[b.ward].type; return t === 'houses' || t === 'church'; }).map(function (b) { return b.poly.map(M); }),
        place: pl ? pl.poly.map(M) : null,
        chateau: m.castle ? m.castle.poly.map(M) : null,
        jardins: m.parks.map(function (p) { return p.poly.map(M); }),
        bois: m.woods.map(function (p) { return p.poly.map(M); }),
        champs: m.fields.map(function (fd) { var p = fd.poly.map(M), e = B.axeLong(p); return { poly: p, c: champ(fd.color, pal.neige), ux: e.ux, uy: e.uy }; }),
        routes: m.highways.map(function (h) { return h.map(M); }).concat(monde.portes.map(function (g) { return [{ x: g.x, y: g.y }, { x: g.x + g.rx * 20, y: g.y + g.ry * 20 }]; })),
        avenues: m.avenues.map(function (h) { return h.map(M); }),
        largeurRoute: 1.1 * S,
        empreintes: empreintes, lanternes: lanternes, fontaine: f
      };
      m.parks.slice(0, 1).forEach(function (pk) {
        var c = geo.centroid(pk.poly);
        lieux.push({ id: 'jardins', nom: 'Les jardins', x: c.x * S, y: c.y * S, r: 14, texte: 'Se reposer sous les arbres des jardins' });
      });
      // Départ : sur la place, tourné vers la fontaine.
      if (f) {
        av = m.avenues[0]; d = av ? M(av[av.length - 1]) : { x: f.x, y: f.y + 1 };
        l = Math.sqrt((d.x - f.x) * (d.x - f.x) + (d.y - f.y) * (d.y - f.y)) || 1;
        monde.depart = { x: f.x + (d.x - f.x) / l * 9, y: f.y + (d.y - f.y) / l * 9, cap: Math.atan2(f.y - d.y, f.x - d.x) };
      } else monde.depart = { x: 0, y: 0, cap: 0 };
      monde.quartier = function (x, y) {
        var p = { x: x / S, y: y / S }, i, c;
        for (i = 0; i < m.cells.length; i++) {
          c = m.cells[i];
          if (geo.inside(c.poly, p)) return c.name || TYPES[c.type] || '';
        }
        return '';
      };
      monde.stats = { sommets: mesh.nSommets, triangles: mesh.indices.length / 3, blocs: mesh.blocs.length, murs: segs.length / 7, ronds: ronds.length / 5, dalles: dalles.length, maisons: m.buildings.length - ecartees, ecartees: ecartees, arbres: m.trees.length };
    }

    etapes.push(['On nivelle le terrain', terrain], ['On élève le rempart', rempart], ['On dresse l\'église et le château', function () { chateau(); eglise(); fontaine(); }]);
    (function () {
      var de, pas = 250;
      function tranche(de) { return function () { maisons(de, Math.min(m.buildings.length, de + pas)); }; }
      for (de = 0; de < m.buildings.length; de += pas) etapes.push(['On bâtit les maisons', tranche(de)]);
    })();
    etapes.push(['On plante les arbres', arbres], ['On pave les rues', fin]);
    return { monde: monde, etapes: etapes };
  }

  function construire(ville) {
    var c = creer(ville);
    c.etapes.forEach(function (e) { e[1](); });
    return c.monde;
  }

  window.VisiteMonde = { S: S, MUR_H: MUR_H, creer: creer, construire: construire, MILIEUX: MILIEUX };
})();
