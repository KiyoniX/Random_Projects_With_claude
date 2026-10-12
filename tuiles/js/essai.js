(function () {
  'use strict';

  var M = (typeof window !== 'undefined' ? window : globalThis).Tuiles;

  // Toutes les grandeurs sont en cases (par seconde) et multipliées par la taille d'une case.
  var PAS = 1 / 120;            // pas de simulation, en secondes : jamais plus d'un cinquième de case par pas
  var PAS_PAR_APPEL = 2400;     // au-delà (20 s d'un coup), le temps en trop est abandonné
  var VITESSE = 6;
  var GRAVITE = 60;
  var SAUT = 17.5;              // vitesse de départ d'un saut : environ deux cases et demie de haut
  var CHUTE = 22;               // vitesse de chute maximale
  var MARCHE = 0.6;             // hauteur qu'on franchit sans sauter en sortant d'une pente

  var Es = M.essai = {};

  // ---------- Monde ----------
  Es.monde = function () {
    var c = M.carte;
    return { tc: c.tc, w: c.w, h: c.h, col: M.calqueDeType('collisions').cases, mode: c.mode };
  };

  function type(m, cx, cy) { return cx < 0 || cy < 0 || cx >= m.w || cy >= m.h ? 1 : m.col[cy * m.w + cx]; }
  // Vu de dessus, une pente est un mur et une plateforme ne gêne pas.
  function plein(m, cx, cy) {
    var v = type(m, cx, cy);
    return v === 1 || (m.mode === 'dessus' && v >= 3);
  }
  function libre(m, x, y, w, h) {
    var tc = m.tc, cx, cy;
    for (cy = Math.floor(y / tc); cy <= Math.ceil((y + h) / tc) - 1; cy++) for (cx = Math.floor(x / tc); cx <= Math.ceil((x + w) / tc) - 1; cx++) if (plein(m, cx, cy)) return false;
    return true;
  }
  Es.libre = libre;

  Es.joueur = function (m, x, y) {
    var tc = m.tc, plat = m.mode === 'plateformes';
    return { x: x, y: y, w: Math.round(tc * 0.62), h: Math.round(tc * (plat ? 0.88 : 0.62)), vx: 0, vy: 0, auSol: false, pente: false, face: 1, marche: 0 };
  };

  function sansAccent(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  // Le personnage part de l'objet de type « départ » ; à défaut, de la case libre la plus proche du centre.
  Es.depart = function (m) {
    var objets = M.calqueDeType('objets').objets, j = Es.joueur(m, 0, 0), tc = m.tc, k, o, r, cx, cy, mx = m.w >> 1, my = m.h >> 1, x, y;
    for (k = 0; k < objets.length; k++) {
      o = objets[k];
      if (!/^(depart|joueur|start|spawn)/.test(sansAccent(o.type)) && !/^(depart|joueur)/.test(sansAccent(o.nom))) continue;
      x = o.x + o.w / 2 - j.w / 2;
      y = m.mode === 'plateformes' ? Math.floor((o.y + o.h) / tc - (o.h ? 0.001 : 0)) * tc + tc - j.h : o.y + o.h / 2 - j.h / 2;
      x = M.borne(x, 0, m.w * tc - j.w); y = M.borne(y, 0, m.h * tc - j.h);
      if (libre(m, x, y, j.w, j.h)) { j.x = x; j.y = y; return j; }
    }
    for (r = 0; r < Math.max(m.w, m.h); r++) {
      for (cy = my - r; cy <= my + r; cy++) {
        for (cx = mx - r; cx <= mx + r; cx++) {
          if (Math.max(Math.abs(cx - mx), Math.abs(cy - my)) !== r || type(m, cx, cy) !== 0) continue;
          j.x = cx * tc + (tc - j.w) / 2; j.y = cy * tc + tc - j.h;
          if (libre(m, j.x, j.y, j.w, j.h)) return j;
        }
      }
    }
    return null;
  };

  // ---------- Déplacement ----------
  // Un axe à la fois. Le pas est assez court pour qu'on n'entre jamais que dans une rangée de cases nouvelle.
  function bougerX(m, j, dx) {
    var tc = m.tc, nx = j.x + dx, cx, cy, y0 = Math.floor(j.y / tc), y1 = Math.ceil((j.y + j.h) / tc) - 1, haut = -1, ny;
    if (!dx) return;
    cx = dx > 0 ? Math.ceil((nx + j.w) / tc) - 1 : Math.floor(nx / tc);
    for (cy = y0; cy <= y1; cy++) if (plein(m, cx, cy)) { haut = cy; break; }
    if (haut >= 0) {
      // En haut d'une pente, le sol qui suit fait une petite marche : on la monte.
      ny = haut * tc - j.h;
      if (j.pente && j.y - ny <= tc * MARCHE && libre(m, nx, ny, j.w, j.h)) { j.x = nx; j.y = ny; return; }
      nx = dx > 0 ? cx * tc - j.w : (cx + 1) * tc;
      j.vx = 0;
    }
    j.x = nx;
  }

  function bougerY(m, j, dy) {
    var tc = m.tc, ny = j.y + dy, cx, cy, x0 = Math.floor(j.x / tc), x1 = Math.ceil((j.x + j.w) / tc) - 1, bas = j.y + j.h, v;
    if (!dy) return;
    if (dy > 0) {
      cy = Math.ceil((ny + j.h) / tc) - 1;
      for (cx = x0; cx <= x1; cx++) {
        v = type(m, cx, cy);
        // Une plateforme traversable n'arrête que ce qui lui tombe dessus.
        if (plein(m, cx, cy) || (v === 2 && m.mode === 'plateformes' && bas <= cy * tc)) { ny = cy * tc - j.h; j.vy = 0; j.auSol = true; break; }
      }
    } else {
      cy = Math.floor(ny / tc);
      for (cx = x0; cx <= x1; cx++) if (plein(m, cx, cy)) { ny = (cy + 1) * tc; j.vy = 0; break; }
    }
    j.y = ny;
  }

  // Hauteur du sol d'une case en pente sous le point d'abscisse fx.
  function surface(m, cx, cy, fx) {
    var tc = m.tc, v = type(m, cx, cy), d = M.borne(fx - cx * tc, 0, tc);
    return v === 3 ? (cy + 1) * tc - d : v === 4 ? cy * tc + d : null;
  }

  function pentes(m, j, etaitAuSol) {
    var tc = m.tc, fx = j.x + j.w / 2, cx = Math.floor(fx / tc), bas = j.y + j.h, cy = Math.floor((bas - 0.001) / tc), s, k;
    j.pente = false;
    for (k = 0; k < 2; k++) {
      s = surface(m, cx, cy + k, fx);
      if (s === null) continue;
      // Enfoncé dans la pente : on remonte. Juste au-dessus en marchant : on reste collé au sol.
      j.pente = true;
      if ((bas > s || (etaitAuSol && j.vy >= 0 && s - bas <= tc * 0.5)) && libre(m, j.x, s - j.h, j.w, j.h)) { j.y = s - j.h; j.vy = 0; j.auSol = true; }
      return;
    }
  }

  // Avance la simulation de dt secondes. e : { gauche, droite, haut, bas, saut }.
  Es.pas = function (m, j, e, dt) {
    var tc = m.tc, n = Math.min(PAS_PAR_APPEL, Math.max(1, Math.ceil(dt / PAS - 1e-9))), h = Math.min(dt, n * PAS) / n, k, ax, ay, l, sol;
    if (!(dt > 0)) return;
    ax = (e.droite ? 1 : 0) - (e.gauche ? 1 : 0);
    ay = (e.bas ? 1 : 0) - (e.haut ? 1 : 0);
    if (ax) j.face = ax;
    for (k = 0; k < n; k++) {
      if (m.mode === 'plateformes') {
        j.vx = ax * VITESSE * tc;
        if (e.saut && j.auSol) { j.vy = -SAUT * tc; j.auSol = false; j.pente = false; }
        j.vy = Math.min(CHUTE * tc, j.vy + GRAVITE * tc * h);
        sol = j.auSol;
        bougerX(m, j, j.vx * h);
        j.auSol = false;
        bougerY(m, j, j.vy * h);
        pentes(m, j, sol);
      } else {
        l = ax && ay ? Math.SQRT1_2 : 1;
        j.vx = ax * l * VITESSE * tc; j.vy = ay * l * VITESSE * tc;
        bougerX(m, j, j.vx * h);
        bougerY(m, j, j.vy * h);
        j.auSol = true;
      }
      if (j.vx || (m.mode !== 'plateformes' && j.vy)) j.marche += h;
    }
  };

  // Les objets que le personnage touche.
  Es.touches = function (m, j) {
    var r = m.tc * 0.4;
    return M.calqueDeType('objets').objets.filter(function (o) {
      var x = o.w || o.h ? o.x : o.x - r, y = o.w || o.h ? o.y : o.y - r, w = o.w || o.h ? o.w : 2 * r, h = o.w || o.h ? o.h : 2 * r;
      return j.x < x + w && j.x + j.w > x && j.y < y + h && j.y + j.h > y;
    });
  };
})();
