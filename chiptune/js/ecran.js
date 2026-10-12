(function () {
  'use strict';

  var P = window.Puce;
  // Les quatre teintes de l'écran à cristaux liquides, du fond à l'encre, plus un voile pour les temps.
  var TEINTES = ['#c8d0a2', '#a2ad80', '#5a6a42', '#1c2a1b'];
  var VOILE = '#bcc594';
  var POINTILLE = '#adb787';          // cellules vides : à peine plus sombres que le fond
  var LC = 6, HL = 9;                 // largeur d'un caractère et hauteur d'une ligne, en points
  var MARGE = 3;                      // marge gauche de la grille, en points
  var NUM = 3 * LC;                   // colonne des numéros de ligne
  var LV = 13 * LC + 3;               // largeur d'une voie
  var ENTETE = 2 * HL + 2;            // hauteur de l'en-tête de la grille
  var CASE_ARR = 9 * LC + 4;          // largeur d'une case de l'arrangement
  // position (en caractères) et largeur de chaque sous-colonne : note, instrument ×2, volume, effet, paramètre ×2
  var COLS = [[0, 3], [4, 1], [5, 1], [7, 1], [9, 1], [10, 1], [11, 1]];

  // ---------- Police à points 5 × 7 ----------
  var GLYPHES = {
    A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
    E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
    I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
    M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
    Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
    U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
    Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
    '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
    '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
    '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
    '-': [0, 0, 0, 31, 0, 0, 0], '#': [10, 10, 31, 10, 31, 10, 10], '.': [0, 0, 0, 0, 0, 12, 12], '=': [0, 0, 31, 0, 31, 0, 0],
    ':': [0, 12, 12, 0, 12, 12, 0], '+': [0, 4, 4, 31, 4, 4, 0], '/': [1, 1, 2, 4, 8, 16, 16], '%': [24, 25, 2, 4, 8, 19, 3],
    '\'': [4, 4, 8, 0, 0, 0, 0], ',': [0, 0, 0, 0, 12, 4, 8], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4],
    '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], '×': [0, 17, 10, 4, 10, 17, 0], '·': [0, 0, 0, 4, 0, 0, 0],
    '▶': [8, 12, 14, 15, 14, 12, 8], '<': [2, 4, 8, 16, 8, 4, 2], '>': [8, 4, 2, 1, 2, 4, 8]
  };
  var ORDRE = Object.keys(GLYPHES), RANG = {};
  ORDRE.forEach(function (c, i) { RANG[c] = i; });

  var u = 2;                           // pixels d'écran par point
  var atlas = [];
  function echelle() {
    // Le plus gros point entier qui laisse la grille tenir sur les deux tiers de la fenêtre,
    // sans descendre sous un point et demi de pixel CSS.
    var d = window.devicePixelRatio || 1, large = Math.floor(0.68 * window.innerWidth * d / (MARGE + NUM + 5 * LV + 2));
    return Math.max(Math.ceil(1.5 * d), Math.min(8, large));
  }
  function construireAtlas() {
    var t, c, x, i, r, b, g;
    atlas = [];
    for (t = 0; t < 5; t++) {
      c = document.createElement('canvas');
      c.width = ORDRE.length * 5 * u; c.height = 7 * u;
      x = c.getContext('2d');
      x.fillStyle = t < 4 ? TEINTES[t] : POINTILLE;
      for (i = 0; i < ORDRE.length; i++) {
        g = GLYPHES[ORDRE[i]];
        for (r = 0; r < 7; r++) for (b = 0; b < 5; b++) if (g[r] & (16 >> b)) x.fillRect((i * 5 + b) * u, r * u, u, u);
      }
      atlas.push(c);
    }
  }
  function sansAccent(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }

  // Écrit un texte à la position (x, y) donnée en points, dans la teinte t.
  function texte(ctx, s, x, y, t, brut) {
    var i, k;
    if (!brut) s = sansAccent(s);
    for (i = 0; i < s.length; i++) {
      k = RANG[s[i]];
      if (k !== undefined) ctx.drawImage(atlas[t], k * 5 * u, 0, 5 * u, 7 * u, (x + i * LC) * u, y * u, 5 * u, 7 * u);
    }
  }
  function rect(ctx, x, y, w, h, t) {
    ctx.fillStyle = typeof t === 'number' ? TEINTES[t] : t;
    ctx.fillRect(x * u, y * u, w * u, h * u);
  }
  // Ajuste la taille interne d'un canvas à sa taille affichée ; renvoie ses dimensions en points.
  function caler(cv) {
    var d = window.devicePixelRatio || 1, w = Math.max(1, Math.round(cv.clientWidth * d)), h = Math.max(1, Math.round(cv.clientHeight * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w: Math.floor(w / u), h: Math.floor(h / u) };
  }
  P.ecran = { TEINTES: TEINTES, LC: LC, HL: HL, texte: texte, rect: rect, caler: caler, unite: function () { return u; } };

  // ---------- Grille du motif ----------
  var vue = { haut: 0, lignes: 16, arrDebut: 0 };
  P.vue = vue;
  P.LARGEUR_GRILLE = MARGE + NUM + 5 * LV + 2;      // en points

  function hex1(n) { return n.toString(16).toUpperCase(); }
  function hex2(n) { return (n < 16 ? '0' : '') + hex1(n); }
  function dec2(n) { return (n < 10 ? '0' : '') + n; }

  // lecture : { motif, ligne } de la ligne jouée, ou null.
  P.dessinerGrille = function (cv, lecture) {
    var ctx = cv.getContext('2d'), dim = caler(cv), p = P.projet, m = P.motif(), cur = P.cur, r = P.sel ? P.plage() : null;
    var lignes = Math.max(4, Math.floor((dim.h - ENTETE - 1) / HL)), ppt = p.pasParTemps, joue = lecture && lecture.motif === cur.motif ? lecture.ligne : -1;
    var v, l, y, x, col, n, t, muet, c, s, xc;
    vue.lignes = lignes;
    if (P.suivre && joue >= 0) {
      if (joue < vue.haut + 2 || joue > vue.haut + lignes - 3) vue.haut = joue - Math.floor(lignes / 3);
    }
    vue.haut = Math.max(0, Math.min(vue.haut, m.pas - lignes));
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 0, 0, dim.w, dim.h, 0);

    // en-tête
    rect(ctx, 0, 0, dim.w, ENTETE - 2, 2);
    for (v = 0; v < 5; v++) {
      x = MARGE + NUM + v * LV;
      muet = P.voieMuette && P.voieMuette(v);
      if (v === cur.voie) rect(ctx, x - 2, 1, LV - 2, ENTETE - 4, 3);
      texte(ctx, P.NOMS_VOIES[v], x, 2, muet ? 1 : 0);
      texte(ctx, muet ? 'MUETTE' : 'NOT IN V FX', x, 2 + HL, 1);
    }

    for (l = vue.haut; l < m.pas && l < vue.haut + lignes; l++) {
      y = ENTETE + (l - vue.haut) * HL;
      if (l % ppt === 0) rect(ctx, 0, y - 1, dim.w, HL, VOILE);
      if (l === joue) { rect(ctx, 0, y - 1, dim.w, 1, 3); rect(ctx, 0, y + HL - 2, dim.w, 1, 3); rect(ctx, 0, y - 1, NUM + 1, HL, 3); }
      texte(ctx, dec2(l), MARGE, y, l === joue ? 0 : (l % (ppt * 4) === 0 ? 3 : 2));
      for (v = 0; v < 5; v++) {
        x = MARGE + NUM + v * LV; col = m.voies[v];
        muet = P.voieMuette && P.voieMuette(v);
        if (r && v >= r.v0 && v <= r.v1 && l >= r.l0 && l <= r.l1) rect(ctx, x - 2, y - 1, LV - 1, HL, 1);
        n = col.n[l];
        if (n) {
          texte(ctx, P.nomNote(n), x, y, muet ? 2 : 3);
          // une note étrangère à la gamme est soulignée en pointillé
          if (n !== P.NOTE_OFF && v !== 3 && !P.dansGamme(n)) for (c = 0; c < 3 * LC - 1; c += 2) rect(ctx, x + c, y + 7, 1, 1, 3);
        } else texte(ctx, '···', x, y, 4);
        t = muet ? 1 : 2;
        texte(ctx, col.i[l] ? dec2(col.i[l]) : '··', x + 4 * LC, y, col.i[l] ? t : 4);
        texte(ctx, col.v[l] ? hex1(col.v[l] - 1) : '·', x + 7 * LC, y, col.v[l] ? t : 4);
        texte(ctx, col.e[l] ? String.fromCharCode(col.e[l]) + hex2(col.p[l]) : '···', x + 9 * LC, y, col.e[l] ? (muet ? 2 : 3) : 4);
      }
      if (l === cur.ligne) {
        c = COLS[cur.col]; xc = MARGE + NUM + cur.voie * LV + c[0] * LC; col = m.voies[cur.voie];
        rect(ctx, xc - 1, y - 1, c[1] * LC + 1, HL, 3);
        if (cur.col === 0) s = P.nomNote(col.n[l]);
        else if (cur.col < 3) s = (col.i[l] ? dec2(col.i[l]) : '··')[cur.col - 1];
        else if (cur.col === 3) s = col.v[l] ? hex1(col.v[l] - 1) : '·';
        else s = (col.e[l] ? String.fromCharCode(col.e[l]) + hex2(col.p[l]) : '···')[cur.col - 4];
        texte(ctx, s, xc, y, 0);
      }
    }
    // ascenseur discret
    if (m.pas > lignes) {
      y = ENTETE + (dim.h - ENTETE) * vue.haut / m.pas;
      rect(ctx, dim.w - 2, y, 2, Math.max(4, (dim.h - ENTETE) * lignes / m.pas), 2);
    }
  };

  // Cellule sous un point du canvas (coordonnées en pixels CSS) : { voie, ligne, col } ou null.
  P.celluleSous = function (cv, px, py) {
    var d = window.devicePixelRatio || 1, x = px * d / u, y = py * d / u, m = P.motif(), v, l, c, i, k = 0;
    if (y < ENTETE) return null;
    l = vue.haut + Math.floor((y - ENTETE + 1) / HL);
    if (l >= m.pas) l = m.pas - 1;
    v = Math.floor((x - MARGE - NUM + 2) / LV);
    if (v < 0) v = 0;
    if (v > 4) v = 4;
    c = (x - MARGE - NUM - v * LV) / LC;
    for (i = 0; i < COLS.length; i++) if (c >= COLS[i][0] - 0.5) k = i;
    return { voie: v, ligne: l, col: k };
  };
  P.voieSousEntete = function (cv, px, py) {
    var d = window.devicePixelRatio || 1, x = px * d / u, y = py * d / u;
    if (y >= ENTETE) return -1;
    return Math.max(0, Math.min(4, Math.floor((x - MARGE - NUM + 2) / LV)));
  };
  P.montrerCurseur = function () {
    var c = P.cur.ligne;
    if (c < vue.haut + 1) vue.haut = Math.max(0, c - 1);
    if (c > vue.haut + vue.lignes - 2) vue.haut = c - vue.lignes + 2;
  };

  // ---------- Arrangement ----------
  P.dessinerArrangement = function (cv, lecture) {
    var ctx = cv.getContext('2d'), dim = caler(cv), p = P.projet, arr = p.arrangement, visibles = Math.max(1, Math.floor(dim.w / CASE_ARR)), i, x, a, m, ici, joue, t;
    if (P.cur.ordre < vue.arrDebut) vue.arrDebut = P.cur.ordre;
    if (P.cur.ordre >= vue.arrDebut + visibles) vue.arrDebut = P.cur.ordre - visibles + 1;
    vue.arrDebut = Math.max(0, Math.min(vue.arrDebut, arr.length - visibles));
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 0, 0, dim.w, dim.h, 0);
    for (i = vue.arrDebut; i < arr.length && i < vue.arrDebut + visibles + 1; i++) {
      x = (i - vue.arrDebut) * CASE_ARR + 1; a = arr[i]; m = p.motifs[a.motif];
      ici = i === P.cur.ordre; joue = lecture && lecture.ordre === i;
      rect(ctx, x, 1, CASE_ARR - 2, 3 * HL + 1, ici ? 3 : 1);
      if (!ici) rect(ctx, x + 1, 2, CASE_ARR - 4, 3 * HL - 1, 0);
      t = ici ? 0 : 3;
      texte(ctx, dec2(i + 1) + (joue ? '▶' : ' ') + (i === p.boucle && arr.length > 1 ? 'BOUCLE' : ''), x + 2, 3, ici ? 0 : 2, true);
      texte(ctx, (m ? m.nom : '?').slice(0, 9), x + 2, 3 + HL, t);
      texte(ctx, (m ? m.pas : 0) + ' PAS' + (a.fois > 1 ? ' ×' + a.fois : ''), x + 2, 3 + 2 * HL, ici ? 1 : 2, true);
    }
  };
  P.ordreSous = function (cv, px) {
    var d = window.devicePixelRatio || 1, i = vue.arrDebut + Math.floor(px * d / u / CASE_ARR);
    return i < P.projet.arrangement.length ? i : -1;
  };

  // ---------- Oscilloscope et vumètre d'une voie ----------
  var fenetre = new Float32Array(1024);
  P.dessinerScope = function (cv, voie) {
    var ctx = cv.getContext('2d'), dim = caler(cv), n = P.scope ? P.scope(voie, fenetre) : 0, h = dim.h - 5, g = 1 / (window.Chiptune.GAINS[voie] * 1.15);
    var i, x, y, dep = 0, crete = 0, pas, segs, ya;
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 0, 0, dim.w, dim.h, 0);
    rect(ctx, 0, Math.floor(h / 2), dim.w, 1, 1);
    if (n) {
      for (i = 0; i < n; i++) if (Math.abs(fenetre[i]) > crete) crete = Math.abs(fenetre[i]);
      // déclenchement sur un front montant, pour une image stable
      for (i = 1; i < n / 2; i++) if (fenetre[i - 1] < 0 && fenetre[i] >= 0) { dep = i; break; }
      pas = (n / 2) / dim.w; ya = -1;
      for (x = 0; x < dim.w; x++) {
        y = Math.round((h - 1) / 2 - fenetre[Math.floor(dep + x * pas)] * g * (h - 1) / 2);
        y = Math.max(0, Math.min(h - 1, y));
        if (ya < 0) ya = y;
        rect(ctx, x, Math.min(y, ya), 1, Math.abs(y - ya) + 1, 3);
        ya = y;
      }
    }
    segs = Math.round(Math.min(1, crete * g) * 16);
    for (i = 0; i < 16; i++) rect(ctx, 1 + i * Math.floor((dim.w - 1) / 16), dim.h - 3, Math.floor((dim.w - 1) / 16) - 1, 3, i < segs ? 3 : 1);
  };

  // ---------- Barres à dessiner (enveloppe, rapports, table d'onde) ----------
  // opt : { max, lire(), ecrire(tableau), boucle() -> indice ou -1 }
  P.creerBarres = function (cv, opt) {
    var b = { dessiner: dessiner }, appui = false, dernier = -1;
    function geometrie() {
      var dim = caler(cv), t = opt.lire(), n = Math.max(1, t.length), lw = Math.max(2, Math.min(12, Math.floor((dim.w - 2) / n)));
      return { dim: dim, t: t, n: n, lw: lw, h: dim.h - 4 };
    }
    function dessiner() {
      var ctx = cv.getContext('2d'), g = geometrie(), i, hb, bo = opt.boucle ? opt.boucle() : -1, y;
      ctx.imageSmoothingEnabled = false;
      rect(ctx, 0, 0, g.dim.w, g.dim.h, 0);
      for (i = 0; i <= opt.max; i += (opt.max > 4 ? 5 : 1)) {
        y = g.h - Math.round(i * (g.h - 2) / opt.max) - 1;
        rect(ctx, 0, y, g.dim.w, 1, VOILE);
      }
      for (i = 0; i < g.t.length; i++) {
        hb = Math.round(g.t[i] * (g.h - 2) / opt.max) + 1;
        rect(ctx, 1 + i * g.lw, g.h - hb, g.lw - 1, hb, opt.traits ? 1 : 3);
        if (opt.traits) rect(ctx, 1 + i * g.lw, g.h - hb, g.lw - 1, 2, 3);
      }
      if (bo >= 0 && bo < g.t.length) { rect(ctx, 1 + bo * g.lw, g.dim.h - 3, (g.t.length - bo) * g.lw - 1, 2, 2); }
    }
    function poser(e) {
      var d = window.devicePixelRatio || 1, bo = cv.getBoundingClientRect(), g = geometrie(), x = (e.clientX - bo.left) * d / u, y = (e.clientY - bo.top) * d / u;
      var i = Math.floor((x - 1) / g.lw), val = Math.round((g.h - 1 - y) * opt.max / (g.h - 2)), t, a, k;
      if (i < 0 || i >= g.t.length) return;
      val = Math.max(0, Math.min(opt.max, val));
      t = g.t.slice();
      // comble les colonnes sautées quand la souris va vite
      a = dernier < 0 ? i : dernier;
      for (k = Math.min(a, i); k <= Math.max(a, i); k++) t[k] = val;
      dernier = i;
      opt.ecrire(t);
      dessiner();
    }
    cv.addEventListener('pointerdown', function (e) { appui = true; dernier = -1; cv.setPointerCapture(e.pointerId); poser(e); e.preventDefault(); });
    cv.addEventListener('pointermove', function (e) { if (appui) poser(e); });
    cv.addEventListener('pointerup', function () { appui = false; });
    cv.addEventListener('pointercancel', function () { appui = false; });
    return b;
  };

  // Trace une forme d'onde rendue (aperçu d'un bruitage).
  P.dessinerOnde = function (cv, ech) {
    var ctx = cv.getContext('2d'), dim = caler(cv), x, i, a, b, lo, hi, m = dim.h / 2, pas = ech.length / dim.w;
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 0, 0, dim.w, dim.h, 0);
    rect(ctx, 0, Math.floor(m), dim.w, 1, 1);
    for (x = 0; x < dim.w; x++) {
      a = Math.floor(x * pas); b = Math.max(a + 1, Math.floor((x + 1) * pas)); lo = 1; hi = -1;
      for (i = a; i < b && i < ech.length; i++) { if (ech[i] < lo) lo = ech[i]; if (ech[i] > hi) hi = ech[i]; }
      if (hi < lo) continue;
      lo = Math.round(m - lo * 1.5 * (m - 1)); hi = Math.round(m - hi * 1.5 * (m - 1));
      rect(ctx, x, Math.max(0, hi), 1, Math.min(dim.h, lo) - Math.max(0, hi) + 1, 3);
    }
  };

  P.initEcran = function () {
    var e = echelle();
    if (e === u && atlas.length) return;
    u = e;
    construireAtlas();
  };
})();
