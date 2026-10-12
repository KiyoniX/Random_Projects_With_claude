(function () {
  'use strict';

  var M = (typeof window !== 'undefined' ? window : globalThis).Tuiles;

  // Bits des huit voisins, dans le sens des aiguilles d'une montre à partir du nord.
  var N = 1, NE = 2, E = 4, SE = 8, S = 16, SO = 32, O = 64, NO = 128;
  var VOISINS = [[0, -1, N], [1, -1, NE], [1, 0, E], [1, 1, SE], [0, 1, S], [-1, 1, SO], [-1, 0, O], [-1, -1, NO]];

  var A = M.auto = { N: N, NE: NE, E: E, SE: SE, S: S, SO: SO, O: O, NO: NO };

  // ---------- Masques ----------
  // Un coin ne compte que si ses deux bords voisins sont présents : il reste 47 cas sur 256.
  function reduire(m) {
    if (!(m & N && m & E)) m &= ~NE;
    if (!(m & S && m & E)) m &= ~SE;
    if (!(m & S && m & O)) m &= ~SO;
    if (!(m & N && m & O)) m &= ~NO;
    return m;
  }

  var MASQUES47 = [], RANG47 = new Uint8Array(256), MASQUES16 = [];
  (function () {
    var m, vus = {}, k;
    for (m = 0; m < 256; m++) if (reduire(m) === m && !vus[m]) { vus[m] = true; MASQUES47.push(m); }
    for (m = 0; m < 256; m++) RANG47[m] = MASQUES47.indexOf(reduire(m));
    // Jeu de 16 : rang = nord + 2 × est + 4 × sud + 8 × ouest ; les coins suivent les bords.
    for (k = 0; k < 16; k++) {
      m = (k & 1 ? N : 0) | (k & 2 ? E : 0) | (k & 4 ? S : 0) | (k & 8 ? O : 0);
      if (m & N && m & E) m |= NE;
      if (m & S && m & E) m |= SE;
      if (m & S && m & O) m |= SO;
      if (m & N && m & O) m |= NO;
      MASQUES16.push(m);
    }
  })();

  A.reduire = reduire;
  A.MASQUES47 = MASQUES47;
  A.MASQUES16 = MASQUES16;
  A.masques = function (forme) { return forme === 16 ? MASQUES16 : MASQUES47; };

  // Rang de la tuile d'un terrain pour un masque de voisinage.
  A.rang = function (forme, m) {
    if (forme === 16) return (m & N ? 1 : 0) | (m & E ? 2 : 0) | (m & S ? 4 : 0) | (m & O ? 8 : 0);
    return RANG47[m & 255];
  };

  // ---------- Pose ----------
  // Un terrain : { nom, forme (16 ou 47), base (rang de sa première tuile dans le jeu) }.
  function dansTerrain(cal, x, y, a, b) {
    var c = M.carte, g;
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) return true;      // le terrain se prolonge hors de la carte
    g = cal.cases[y * c.w + x] & M.NUMERO;
    return g >= a && g < b;
  }

  function recalculer(cal, x, y, jeu, ter) {
    var c = M.carte, a = jeu.premier + ter.base, b = a + ter.forme, m = 0, k;
    if (x < 0 || y < 0 || x >= c.w || y >= c.h || !dansTerrain(cal, x, y, a, b)) return;
    for (k = 0; k < 8; k++) if (dansTerrain(cal, x + VOISINS[k][0], y + VOISINS[k][1], a, b)) m |= VOISINS[k][2];
    M.poser(cal, x, y, a + A.rang(ter.forme, m));
  }

  // Pose (ou retire) le terrain sur une case, puis raccorde la case et ses huit voisines.
  A.poser = function (cal, x, y, jeu, ter, retirer) {
    var c = M.carte, a = jeu.premier + ter.base, dx, dy;
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
    if (retirer) {
      if (!dansTerrain(cal, x, y, a, a + ter.forme)) return;
      M.poser(cal, x, y, 0);
    } else if (!dansTerrain(cal, x, y, a, a + ter.forme)) M.poser(cal, x, y, a);
    for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) recalculer(cal, x + dx, y + dy, jeu, ter);
  };

  // Le terrain auquel appartient une tuile, ou null.
  A.terrainDe = function (g) {
    var jeu = M.jeuDe(g & M.NUMERO), k, t, r;
    if (!jeu) return null;
    r = (g & M.NUMERO) - jeu.premier;
    for (k = 0; k < jeu.terrains.length; k++) {
      t = jeu.terrains[k];
      if (r >= t.base && r < t.base + t.forme) return { jeu: jeu, terrain: t, i: k };
    }
    return null;
  };

  // ---------- Dessin des tuiles d'un terrain ----------
  // Dit si le pixel (px, py) d'une tuile de côté n appartient au terrain, pour un masque de voisinage.
  // m : largeur de la bordure laissée vide du côté où le terrain s'arrête.
  function dedans(px, py, n, m, k) {
    var gx = px < m ? -1 : px >= n - m ? 1 : 0, gy = py < m ? -1 : py >= n - m ? 1 : 0;
    var bh = gx < 0 ? k & O : k & E, bv = gy < 0 ? k & N : k & S, coin, cx, cy, ux, uy;
    if (gx && !gy && !bh) return false;
    if (gy && !gx && !bv) return false;
    if (gx && gy) {
      if (!bh || !bv) return false;
      coin = gx < 0 ? (gy < 0 ? k & NO : k & SO) : (gy < 0 ? k & NE : k & SE);
      if (!coin) {
        // Coin rentrant : une morsure arrondie dans l'angle de la tuile.
        cx = gx < 0 ? px + 0.5 : n - px - 0.5; cy = gy < 0 ? py + 0.5 : n - py - 0.5;
        if (Math.sqrt(cx * cx + cy * cy) < m * 0.95) return false;
      }
    }
    // Coins saillants arrondis, là où deux bords libres se rencontrent.
    ux = !(k & O) && px < 2 * m ? px - m + 0.5 : !(k & E) && px >= n - 2 * m ? n - m - px - 0.5 : -1;
    uy = !(k & N) && py < 2 * m ? py - m + 0.5 : !(k & S) && py >= n - 2 * m ? n - m - py - 0.5 : -1;
    if (ux >= 0 && uy >= 0 && ux < m && uy < m && Math.sqrt((m - ux) * (m - ux) + (m - uy) * (m - uy)) > m + 0.2) return false;
    return true;
  }

  function assombrir(c, k) {
    return ((c & 0xff000000) | (Math.round((c >>> 16 & 255) * k) << 16) | (Math.round((c >>> 8 & 255) * k) << 8) | Math.round((c & 255) * k)) >>> 0;
  }

  // Fabrique les tuiles d'un terrain à partir d'une tuile répétable (pixels 0xAABBGGRR, côté n).
  // fond : tuile posée là où le terrain s'arrête (sinon transparent). Rend une liste de tampons de pixels.
  A.tuiles = function (src, n, forme, fond) {
    var m = Math.max(1, Math.round(n * 3 / 16)), ep = n >= 32 ? 2 : 1;
    return A.masques(forme).map(function (k) {
      var o = new Uint32Array(n * n), x, y, d, bord;
      function oui(X, Y) { return X < 0 || Y < 0 || X >= n || Y >= n ? true : dedans(X, Y, n, m, k); }
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++) {
          if (!dedans(x, y, n, m, k)) { o[y * n + x] = fond ? fond[y * n + x] : 0; continue; }
          bord = false;
          for (d = 1; d <= ep && !bord; d++) bord = !oui(x - d, y) || !oui(x + d, y) || !oui(x, y - d) || !oui(x, y + d);
          o[y * n + x] = bord ? assombrir(src[y * n + x], 0.62) : src[y * n + x];
        }
      }
      return o;
    });
  };
})();
