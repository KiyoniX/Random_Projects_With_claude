(function () {
  'use strict';

  // Le rendu du vitrail : textures de verre fabriquées par procédé, lumière de jour ou d'atelier, carton numéroté.
  // Tout se dessine en millimètres : l'appelant donne le zoom (pixels par mm) et la place de l'origine à l'écran.
  var V = window.Vitrail, G = V.geo;
  var R = V.rendu = {};

  var TUILE = 256;     // côté d'une tuile de texture, en pixels
  var MM = 80;         // la tuile couvre 80 mm de verre
  var PLOMB_JOUR = '#1b1c1e', PLOMB_NUIT = '#34383b', PLOMB_NUIT_CLAIR = '#5a6065', ETAIN = '#9aa1a5', ETAIN_SOMBRE = '#7d8388';
  var CRAYON = '#b5281f';   // le crayon gras du verrier : réservé aux avertissements de coupe
  var PAPIER = '#fbfbf7', GRAPHITE = '#3a3d40', GRISAILLE = '#2b1a10';
  var POLICE_MAIN = '"Segoe Print", "Ink Free", "Comic Sans MS", cursive';

  R.TEXTURES = [
    { id: 'cathedrale', nom: 'cathédrale lisse' },
    { id: 'antique', nom: 'antique, stries et bulles' },
    { id: 'martele', nom: 'martelé' },
    { id: 'opalescent', nom: 'opalescent marbré' },
    { id: 'chenille', nom: 'chenillé' },
    { id: 'clair', nom: 'clair' }
  ];
  R.CRAYON = CRAYON;

  // ---------- Bruit périodique ----------
  function hasard(s) {
    var h = (s >>> 0) || 1;
    return function () {
      h = h + 0x6D2B79F5 | 0;
      var t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  R.hasard = hasard;

  // Bruit de valeur qui se raccorde sur la tuile : nx × ny cases, octaves de plus en plus fines.
  function fbm(rnd, nx, ny, oct) {
    var grilles = [], k, i, g;
    for (k = 0; k < oct; k++) {
      g = { nx: nx << k, ny: ny << k, v: new Float32Array((nx << k) * (ny << k)) };
      for (i = 0; i < g.v.length; i++) g.v[i] = rnd();
      grilles.push(g);
    }
    return function (u, v) {
      var s = 0, a = 1, tot = 0, j, g, x, y, x0, y0, x1, y1, fx, fy, p, q;
      for (j = 0; j < grilles.length; j++) {
        g = grilles[j];
        x = u * g.nx; y = v * g.ny; x0 = Math.floor(x); y0 = Math.floor(y); fx = x - x0; fy = y - y0;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        x0 = ((x0 % g.nx) + g.nx) % g.nx; y0 = ((y0 % g.ny) + g.ny) % g.ny; x1 = (x0 + 1) % g.nx; y1 = (y0 + 1) % g.ny;
        p = g.v[y0 * g.nx + x0] + (g.v[y0 * g.nx + x1] - g.v[y0 * g.nx + x0]) * fx;
        q = g.v[y1 * g.nx + x0] + (g.v[y1 * g.nx + x1] - g.v[y1 * g.nx + x0]) * fx;
        s += (p + (q - p) * fy) * a; tot += a; a *= 0.5;
      }
      return s / tot;
    };
  }
  function lisse(a, b, x) { x = Math.max(0, Math.min(1, (x - a) / (b - a))); return x * x * (3 - 2 * x); }

  // Des bulles étirées dans le sens des stries : cœur clair, bord sombre.
  function bulles(d, h, rnd, n, rmin, rmax) {
    var T = TUILE, k, cx, cy, rx, ry, x, y, X, Y, r, i;
    for (k = 0; k < n; k++) {
      cx = rnd() * T; cy = rnd() * T; rx = rmin + rnd() * (rmax - rmin); ry = rx * (0.45 + rnd() * 0.2);
      for (y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
        r = Math.sqrt(((x - cx) / rx) * ((x - cx) / rx) + ((y - cy) / ry) * ((y - cy) / ry));
        if (r > 1.25) continue;
        X = ((x % T) + T) % T; Y = ((y % T) + T) % T; i = Y * T + X;
        if (r < 0.8) h[i] += 0.32 * (1 - r * r);
        else d[i] += 0.38 * (1 - Math.abs(r - 1) / 0.25);
      }
    }
  }

  // Les champs d'une texture : densité (assombrit), reflet (éclaircit), lait (l'opale qui blanchit le verre).
  var champs = {};
  function champ(id) {
    var T = TUILE, n = T * T, d = new Float32Array(n), h = new Float32Array(n), m = new Float32Array(n), rnd = hasard(id.charCodeAt(0) * 7919 + id.length), x, y, u, v, i, f, s, w, f2, f3, q, pts, k, best, dx, dy, hh, j;
    if (champs[id]) return champs[id];
    if (id === 'antique') {
      s = fbm(rnd, 2, 22, 3); f = fbm(rnd, 3, 3, 3);
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) { u = x / T; v = y / T; i = y * T + x; d[i] = 0.46 * (s(u, v) - 0.5) + 0.24 * (f(u, v) - 0.5); }
      bulles(d, h, rnd, 24, 1.6, 5);
    } else if (id === 'martele') {
      // Martelé : une cuvette sous chaque coup de marteau, éclairée d'en haut à gauche.
      pts = []; for (k = 0; k < 70; k++) pts.push([rnd() * T, rnd() * T]);
      hh = new Float32Array(n);
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) {
        best = Infinity;
        for (k = 0; k < pts.length; k++) {
          dx = Math.abs(x - pts[k][0]); dy = Math.abs(y - pts[k][1]);
          if (dx > T / 2) dx = T - dx; if (dy > T / 2) dy = T - dy;
          if (dx * dx + dy * dy < best) best = dx * dx + dy * dy;
        }
        hh[y * T + x] = best;
      }
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) {
        i = y * T + x; j = ((y + T - 1) % T) * T + (x + T - 1) % T;
        s = (hh[i] - hh[j]) / 40;
        h[i] = Math.max(0, Math.min(0.4, s)); d[i] = Math.max(0, Math.min(0.35, -s)) + 0.04;
      }
    } else if (id === 'opalescent') {
      f = fbm(rnd, 3, 3, 4); f2 = fbm(rnd, 3, 3, 4); f3 = fbm(rnd, 2, 2, 4);
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) {
        u = x / T; v = y / T; i = y * T + x;
        w = f3((u + 0.6 * f(u, v) + 1) % 1, (v + 0.6 * f2(u, v) + 1) % 1);
        m[i] = 0.12 + 0.78 * lisse(0.4, 0.62, w);
        d[i] = 0.1 * (f(u, v) - 0.5);
      }
    } else if (id === 'chenille') {
      f = fbm(rnd, 3, 3, 3); f2 = fbm(rnd, 4, 4, 2);
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) {
        u = x / T; v = y / T; i = y * T + x;
        q = f(u, v) * 9; q -= Math.floor(q);
        h[i] = 0.34 * Math.exp(-((q - 0.5) / 0.11) * ((q - 0.5) / 0.11));
        d[i] = 0.26 * Math.exp(-((q - 0.32) / 0.09) * ((q - 0.32) / 0.09)) + 0.1 * (f2(u, v) - 0.5);
      }
    } else if (id === 'clair') {
      f = fbm(rnd, 3, 3, 3); s = fbm(rnd, 1, 9, 3);
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) { u = x / T; v = y / T; i = y * T + x; d[i] = 0.06 * (f(u, v) - 0.5) + 0.03; h[i] = 0.5 * lisse(0.6, 0.8, s(v, u)); }
      bulles(d, h, rnd, 7, 1.2, 2.6);
    } else {
      // Cathédrale : lisse, avec la légère houle du verre laminé.
      f = fbm(rnd, 3, 3, 4); w = fbm(rnd, 2, 5, 3);
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) {
        u = x / T; v = y / T; i = y * T + x;
        d[i] = 0.17 * (f(u, v) - 0.5);
        h[i] = 0.06 * Math.pow(Math.max(0, Math.sin(2 * Math.PI * (u * 2 + w(u, v) * 1.2))), 3);
      }
    }
    return (champs[id] = { d: d, h: h, m: m });
  }

  function rgb(hex) { var v = parseInt(hex.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }
  R.rgb = rgb;

  // La tuile d'un verre : de jour la lumière le traverse ; côté atelier il ne renvoie que ce qui l'éclaire de face.
  var tuiles = {};
  function tuile(hex, tex, vue) {
    var cle = hex + tex + vue, T = TUILE, c, k, im, px, F, col, i, r, gr, b, dd, hh, mm, base;
    if (tuiles[cle]) return tuiles[cle];
    c = document.createElement('canvas'); c.width = c.height = T; k = c.getContext('2d');
    im = k.createImageData(T, T); px = im.data; F = champ(tex); col = rgb(hex);
    for (i = 0; i < T * T; i++) {
      dd = F.d[i]; hh = F.h[i]; mm = F.m[i];
      if (vue === 'jour') {
        r = col[0] * (1 - dd); gr = col[1] * (1 - dd); b = col[2] * (1 - dd);
        r += (255 - r) * hh; gr += (255 - gr) * hh; b += (255 - b) * hh;
        if (mm) { mm *= 0.72; r = r * (1 - mm) + 246 * mm; gr = gr * (1 - mm) + 242 * mm; b = b * (1 - mm) + 232 * mm; }
      } else {
        base = 0.32;
        r = (col[0] * base + 16) * (1 - dd * 0.9) + 95 * hh; gr = (col[1] * base + 17) * (1 - dd * 0.9) + 95 * hh; b = (col[2] * base + 19) * (1 - dd * 0.9) + 95 * hh;
        if (mm) { mm *= 0.85; r = r * (1 - mm) + (col[0] * 0.35 + 120) * mm; gr = gr * (1 - mm) + (col[1] * 0.35 + 116) * mm; b = b * (1 - mm) + (col[2] * 0.35 + 108) * mm; }
      }
      px[i * 4] = r; px[i * 4 + 1] = gr; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
    k.putImageData(im, 0, 0);
    return (tuiles[cle] = c);
  }

  var motifs = new WeakMap();
  function motif(g, hex, tex, vue) {
    var m = motifs.get(g), cle = hex + tex + vue;
    if (!m) { m = {}; motifs.set(g, m); }
    if (!m[cle]) m[cle] = g.createPattern(tuile(hex, tex, vue), 'repeat');
    return m[cle];
  }

  // Une petite plaque de verre pour la palette.
  R.vignette = function (verre, w, h, vue) {
    var c = document.createElement('canvas'), k;
    c.width = w; c.height = h; k = c.getContext('2d');
    k.fillStyle = k.createPattern(tuile(verre.couleur, verre.texture, vue || 'jour'), 'repeat');
    k.setTransform(0.55, 0, 0, 0.55, -verre.id * 37 % 100, -verre.id * 53 % 100);
    k.fillRect(0, 0, w / 0.55 + 200, h / 0.55 + 200);
    return c;
  };

  // ---------- Chemins ----------
  function cheminFace(f) {
    if (f._chemin) return f._chemin;
    var p = new Path2D();
    [f.poly].concat(f.trous).forEach(function (poly) {
      poly.forEach(function (q, i) { if (i) p.lineTo(q.x, q.y); else p.moveTo(q.x, q.y); });
      p.closePath();
    });
    return (f._chemin = p);
  }
  R.cheminFace = cheminFace;

  function cheminPlomb(doc, e, p) {
    var a = doc.noeuds[e.a], b = doc.noeuds[e.b];
    p.moveTo(a.x, a.y);
    if (e.c) p.bezierCurveTo(e.c[0], e.c[1], e.c[2], e.c[3], b.x, b.y); else p.lineTo(b.x, b.y);
  }

  // Les plombs regroupés par largeur, la bordure à part.
  function groupesPlombs(doc, filtre) {
    var gr = {}, k;
    doc.plombs.forEach(function (e) {
      if (filtre && !filtre(e)) return;
      k = e.l;
      if (!gr[k]) gr[k] = new Path2D();
      cheminPlomb(doc, e, gr[k]);
    });
    return Object.keys(gr).map(function (l) { return { l: Number(l), p: gr[l] }; }).sort(function (a, b) { return a.l - b.l; });
  }

  function variation(graine) { return (((graine * 2654435761) >>> 0) / 4294967296); }

  // ---------- Dessin ----------
  // o : { doc, calc, vue, z, ox, oy, dpr, sel, survol, regles, noeuds, effaces, verreDe(id), numeros }
  R.dessiner = function (g, o) {
    var doc = o.doc, calc = o.calc, z = o.z, dpr = o.dpr || 1, px = 1 / z, vue = o.vue, contour, groupes, carton = vue === 'carton';
    g.save();
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * o.ox, dpr * o.oy);
    g.lineCap = 'round'; g.lineJoin = 'round';

    // Les pièces.
    calc.faces.forEach(function (f) {
      var ch = cheminFace(f), verre = f.verre && o.verreDe(f.verre), v, a, m;
      if (carton) { g.fillStyle = PAPIER; g.fill(ch, 'evenodd'); return; }
      if (!verre) {
        // Pièce sans verre : la table se voit au travers, hachurée au crayon.
        g.fillStyle = vue === 'jour' ? 'rgba(251, 250, 243, .55)' : 'rgba(70, 73, 76, .5)'; g.fill(ch, 'evenodd');
        g.save(); g.clip(ch, 'evenodd');
        g.beginPath();
        for (a = f.bb.x0 - (f.bb.y1 - f.bb.y0); a < f.bb.x1; a += Math.max(4, 9 * px)) { g.moveTo(a, f.bb.y1); g.lineTo(a + (f.bb.y1 - f.bb.y0), f.bb.y0); }
        g.strokeStyle = vue === 'jour' ? 'rgba(107, 111, 115, .45)' : 'rgba(200, 204, 206, .35)'; g.lineWidth = px; g.stroke();
        g.restore();
        return;
      }
      v = variation(f.graine || 1);
      m = motif(g, verre.couleur, verre.texture, vue);
      m.setTransform(new DOMMatrix().translate(v * MM, variation((f.graine || 1) + 7) * MM).rotate((f.graine * 47) % 360).scale(MM / TUILE));
      g.fillStyle = m; g.fill(ch, 'evenodd');
      // Deux feuilles du même verre ne sont jamais tout à fait de la même densité.
      a = (v - 0.5) * (vue === 'jour' ? 0.16 : 0.08);
      g.fillStyle = a < 0 ? 'rgba(0, 0, 0, ' + (-a) + ')' : 'rgba(255, 255, 255, ' + a + ')';
      g.fill(ch, 'evenodd');
    });

    // La grisaille, peinte sur le verre : elle passe sous les plombs.
    if (doc.grisaille.length) {
      contour = new Path2D();
      G.contourPoly(doc).forEach(function (q, i) { if (i) contour.lineTo(q.x, q.y); else contour.moveTo(q.x, q.y); });
      g.save(); g.clip(contour);
      g.strokeStyle = carton ? 'rgba(58, 61, 64, .55)' : GRISAILLE; g.globalAlpha = carton ? 1 : 0.86;
      doc.grisaille.forEach(function (s, j) {
        g.beginPath();
        s.pts.forEach(function (q, i) { if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
        if (s.pts.length === 1) g.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]);
        g.lineWidth = s.l;
        if (o.effacesG && o.effacesG[j]) { g.save(); g.strokeStyle = CRAYON; g.stroke(); g.restore(); } else g.stroke();
      });
      g.restore();
    }

    // Les plombs.
    groupes = groupesPlombs(doc);
    groupes.forEach(function (gr) {
      if (carton) {
        g.strokeStyle = GRAPHITE; g.lineWidth = gr.l; g.stroke(gr.p);
        g.strokeStyle = '#e9e8e1'; g.lineWidth = Math.max(gr.l - 2.4 * px, gr.l * 0.35); g.stroke(gr.p);
        g.strokeStyle = 'rgba(58, 61, 64, .7)'; g.lineWidth = Math.min(px, 0.6); g.stroke(gr.p);
      } else if (vue === 'jour') { g.strokeStyle = PLOMB_JOUR; g.lineWidth = gr.l; g.stroke(gr.p); }
      else {
        g.strokeStyle = PLOMB_NUIT; g.lineWidth = gr.l; g.stroke(gr.p);
        g.strokeStyle = PLOMB_NUIT_CLAIR; g.lineWidth = gr.l * 0.32; g.stroke(gr.p);
      }
    });
    // Côté atelier, les soudures à l'étain brillent à chaque jonction.
    if (vue === 'atelier' && z > 0.8) {
      g.beginPath();
      Object.keys(calc.degres).forEach(function (k) {
        var n = doc.noeuds[k], r;
        if (!n || calc.degres[k] < 3) return;
        r = 4.2; g.moveTo(n.x + r, n.y); g.arc(n.x, n.y, r, 0, 6.2832);
      });
      g.fillStyle = ETAIN; g.fill(); g.strokeStyle = ETAIN_SOMBRE; g.lineWidth = 0.8; g.stroke();
    }
    if (o.effaces) {
      g.strokeStyle = CRAYON; g.globalAlpha = 0.85;
      doc.plombs.forEach(function (e) { var p; if (!o.effaces[e.id]) return; p = new Path2D(); cheminPlomb(doc, e, p); g.lineWidth = e.l + 2 * px; g.stroke(p); });
      g.globalAlpha = 1;
    }

    // Le carton : numéros au crayon, pastille de la couleur du verre.
    if (carton || o.numeros) calc.faces.forEach(function (f) {
      var cote = Math.min(Math.sqrt(f.aire), (f.largeur || 1e9) * 1.6) * z, taille, verre = f.verre && o.verreDe(f.verre), x = f.centre.x, y = f.centre.y;
      if (cote < 16) return;
      taille = Math.max(10, Math.min(24, cote * 0.24)) * px;
      g.font = (taille / 1) + 'px ' + POLICE_MAIN; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (!carton) {
        g.lineWidth = 3 * px; g.strokeStyle = 'rgba(251, 251, 247, .9)'; g.strokeText(String(f.numero), x, y);
        g.fillStyle = GRAPHITE; g.fillText(String(f.numero), x, y);
        return;
      }
      g.fillStyle = GRAPHITE; g.fillText(String(f.numero), x, y - (verre && cote > 44 ? taille * 0.35 : 0));
      if (verre && cote > 30) {
        // Sous le numéro dans une grande pièce, à sa droite dans une petite.
        var rp = Math.max(3.2 * px, taille * 0.24);
        g.beginPath(); g.arc(x + (cote > 44 ? 0 : g.measureText(String(f.numero)).width / 2 + rp + 2 * px), y + (cote > 44 ? taille * 0.75 : 0), rp, 0, 6.2832);
        g.fillStyle = verre.couleur; g.fill(); g.lineWidth = px; g.strokeStyle = GRAPHITE; g.stroke();
      }
    });

    // Les avertissements, au crayon gras : un cercle au coin fautif, la pièce entourée de tirets si c'est elle tout entière.
    if (o.regles) {
      var entieres = {};
      calc.avertissements.forEach(function (a) { if (a.type === 'petite' || a.type === 'fine' || a.type === 'creux' || a.type === 'trou') entieres[a.face] = true; });
      g.strokeStyle = CRAYON; g.lineWidth = 2 * px;
      g.setLineDash([6 * px, 4 * px]);
      calc.faces.forEach(function (f) { if (entieres[f.numero]) g.stroke(cheminFace(f)); });
      g.setLineDash([]);
      calc.avertissements.forEach(function (a) {
        var r = 9 * px;
        g.beginPath(); g.arc(a.x, a.y, r, 0, 6.2832);
        g.lineWidth = 3.5 * px; g.strokeStyle = 'rgba(251, 251, 247, .85)'; g.stroke();
        g.lineWidth = 2 * px; g.strokeStyle = CRAYON; g.stroke();
        if (a.type === 'pendant') { g.beginPath(); g.moveTo(a.x - r * 0.5, a.y - r * 0.5); g.lineTo(a.x + r * 0.5, a.y + r * 0.5); g.moveTo(a.x + r * 0.5, a.y - r * 0.5); g.lineTo(a.x - r * 0.5, a.y + r * 0.5); g.stroke(); }
        else if (a.type !== 'pointe' && a.type !== 'rentrant') { g.beginPath(); g.moveTo(a.x, a.y - r * 0.5); g.lineTo(a.x, a.y + r * 0.1); g.moveTo(a.x, a.y + r * 0.45); g.lineTo(a.x, a.y + r * 0.5); g.stroke(); }
      });
    }

    // La pièce choisie et celle qu'on survole : un double trait qui se lit sur n'importe quel verre.
    [[o.survol, false], [o.sel, true]].forEach(function (s) {
      var ch;
      if (!s[0]) return;
      ch = cheminFace(s[0]);
      g.strokeStyle = '#fbfbf7'; g.lineWidth = (s[1] ? 4 : 3) * px; g.stroke(ch);
      g.strokeStyle = '#232527'; g.lineWidth = 1.5 * px;
      if (s[1]) g.setLineDash([5 * px, 4 * px]);
      g.stroke(ch); g.setLineDash([]);
    });

    // Les nœuds, pendant qu'on retouche le réseau.
    if (o.noeuds) {
      var auBord = {};
      doc.plombs.forEach(function (e) { if (e.bord) { auBord[e.a] = true; auBord[e.b] = true; } });
      Object.keys(doc.noeuds).forEach(function (k) {
        var n = doc.noeuds[k], d = calc.degres[k] || 0, bord = auBord[k], r = (o.noeudVise === n.id ? 5.5 : bord ? 2.6 : 3.6) * px;
        g.beginPath(); g.arc(n.x, n.y, r, 0, 6.2832);
        g.fillStyle = d === 1 ? CRAYON : bord ? '#232527' : ETAIN; g.fill();
        g.lineWidth = (o.noeudVise === n.id ? 2 : 1) * px; g.strokeStyle = bord ? ETAIN : '#232527'; g.stroke();
      });
    }
    g.restore();
  };

  R.POLICE_MAIN = POLICE_MAIN;
})();
