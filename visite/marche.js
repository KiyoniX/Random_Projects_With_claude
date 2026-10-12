(function () {
  'use strict';

  var RAYON = 0.3;        // rayon du marcheur
  var TAILLE = 1.7;       // sa hauteur ; ce qui est plus haut que sa tête ne l'arrête pas
  var YEUX = 1.6;
  var MARCHE = 0.5;       // ce qu'il enjambe sans sauter
  var PAS_MAX = 0.12;     // plus grand déplacement d'un coup, bien en deçà du rayon : aucun mur ne peut être sauté
  var CASE = 8;           // maille de la grille de recherche
  var PESANTEUR = 14, SAUT = 4.4;

  // ---------- Grille ----------
  // Range dans chaque case les numéros des objets dont la boîte, élargie de marge, la touche.
  function grille(n, demi, boite, marge) {
    var N = Math.max(1, Math.ceil(demi * 2 / CASE)), debut = new Uint32Array(N * N + 1), liste, i, b, x, y, pos, pass;
    function c(v) { return Math.max(0, Math.min(N - 1, Math.floor((v + demi) / CASE))); }
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < n; i++) {
        b = boite(i);
        for (y = c(b[1] - marge); y <= c(b[3] + marge); y++) for (x = c(b[0] - marge); x <= c(b[2] + marge); x++) {
          if (pass) liste[pos[y * N + x]++] = i; else debut[y * N + x + 1]++;
        }
      }
      if (!pass) {
        for (i = 0; i < N * N; i++) debut[i + 1] += debut[i];
        liste = new Uint32Array(debut[N * N]); pos = debut.slice(0, N * N);
      }
    }
    return { N: N, debut: debut, liste: liste, de: function (x, y) { return c(y) * N + c(x); } };
  }

  // ---------- Marche ----------
  // col : { segs : 7 nombres par mur (ax, ay, bx, by, bas, haut en a, haut en b), ronds : 5 par obstacle rond (x, y, r, bas, haut),
  //         dalles : planchers en hauteur { poly, z, ox, oy, gx, gy }, limite, zsol(x, y) }.
  function creer(col) {
    var segs = col.segs, ronds = col.ronds, dalles = col.dalles, demi = col.limite + 40, box = [0, 0, 0, 0];
    var gs = grille(segs.length / 7, demi, function (i) {
      var o = i * 7;
      box[0] = Math.min(segs[o], segs[o + 2]); box[1] = Math.min(segs[o + 1], segs[o + 3]); box[2] = Math.max(segs[o], segs[o + 2]); box[3] = Math.max(segs[o + 1], segs[o + 3]);
      return box;
    }, RAYON + 0.3);
    var gr = grille(ronds.length / 5, demi, function (i) {
      var o = i * 5;
      box[0] = ronds[o] - ronds[o + 2]; box[1] = ronds[o + 1] - ronds[o + 2]; box[2] = ronds[o] + ronds[o + 2]; box[3] = ronds[o + 1] + ronds[o + 2];
      return box;
    }, RAYON + 0.3);
    var gd = grille(dalles.length, demi, function (i) {
      var p = dalles[i].poly, k;
      box[0] = box[1] = Infinity; box[2] = box[3] = -Infinity;
      for (k = 0; k < p.length; k += 2) { box[0] = Math.min(box[0], p[k]); box[2] = Math.max(box[2], p[k]); box[1] = Math.min(box[1], p[k + 1]); box[3] = Math.max(box[3], p[k + 1]); }
      return box;
    }, 0.1);
    var pleins = col.pleins || [], gp = grille(pleins.length, demi, function (i) {
      var p = pleins[i].poly, k;
      box[0] = box[1] = Infinity; box[2] = box[3] = -Infinity;
      for (k = 0; k < p.length; k += 2) { box[0] = Math.min(box[0], p[k]); box[2] = Math.max(box[2], p[k]); box[1] = Math.min(box[1], p[k + 1]); box[3] = Math.max(box[3], p[k + 1]); }
      return box;
    }, 0.1);
    var px, py;   // position en cours de correction

    function surDalle(d, x, y) {
      var p = d.poly, n = p.length, i, j, s, pos = 0, neg = 0;
      for (i = 0; i < n; i += 2) {
        j = (i + 2) % n;
        s = (p[j] - p[i]) * (y - p[i + 1]) - (p[j + 1] - p[i + 1]) * (x - p[i]);
        if (s > 1e-9) pos++; else if (s < -1e-9) neg++;
        if (pos && neg) return false;
      }
      return true;
    }
    // Le sol sous le marcheur : le terrain, ou le plus haut plancher qu'il peut atteindre d'un pas.
    function sol(x, y, z) {
      var h = col.zsol(x, y), c = gd.de(x, y), k, d, zd;
      for (k = gd.debut[c]; k < gd.debut[c + 1]; k++) {
        d = dalles[gd.liste[k]];
        zd = d.z + (x - d.ox) * d.gx + (y - d.oy) * d.gy;
        if (zd > h && zd <= z + MARCHE + 1e-6 && surDalle(d, x, y)) h = zd;
      }
      return h;
    }

    // Écarte (px, py) des murs qu'il pénètre ; renvoie la plus forte pénétration rencontrée.
    function ecarte(z, corrige) {
      var c = gs.de(px, py), k, o, ax, ay, bx, by, dx, dy, l2, t, cx, cy, ex, ey, d, pire = 0, r;
      for (k = gs.debut[c]; k < gs.debut[c + 1]; k++) {
        o = gs.liste[k] * 7;
        ax = segs[o]; ay = segs[o + 1]; bx = segs[o + 2]; by = segs[o + 3];
        dx = bx - ax; dy = by - ay; l2 = dx * dx + dy * dy;
        t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (z + TAILLE <= segs[o + 4] || z + MARCHE >= segs[o + 5] + (segs[o + 6] - segs[o + 5]) * t) continue;
        cx = ax + dx * t; cy = ay + dy * t; ex = px - cx; ey = py - cy;
        d = Math.sqrt(ex * ex + ey * ey);
        if (d >= RAYON) continue;
        if (RAYON - d > pire) pire = RAYON - d;
        if (!corrige) continue;
        if (d < 1e-7) { d = Math.sqrt(l2) || 1; ex = -dy / d; ey = dx / d; d = 0; r = RAYON; } else { ex /= d; ey /= d; r = RAYON - d; }
        px += ex * (r + 1e-4); py += ey * (r + 1e-4);
      }
      c = gr.de(px, py);
      for (k = gr.debut[c]; k < gr.debut[c + 1]; k++) {
        o = gr.liste[k] * 5;
        if (z + TAILLE <= ronds[o + 3] || z + MARCHE >= ronds[o + 4]) continue;
        ex = px - ronds[o]; ey = py - ronds[o + 1]; r = ronds[o + 2] + RAYON;
        d = Math.sqrt(ex * ex + ey * ey);
        if (d >= r) continue;
        if (r - d > pire) pire = r - d;
        if (!corrige) continue;
        r -= d;
        if (d < 1e-7) { ex = 1; ey = 0; d = 1; }
        px += ex / d * (r + 1e-4); py += ey / d * (r + 1e-4);
      }
      return pire;
    }
    // Dans l'épaisseur d'un bâtiment ou d'un mur ?
    function plein(x, y) {
      var c = gp.de(x, y), k;
      for (k = gp.debut[c]; k < gp.debut[c + 1]; k++) if (surDalle(pleins[gp.liste[k]], x, y)) return true;
      return false;
    }
    function libre(x, y, z) { px = x; py = y; return ecarte(z, false) < 1e-3 && x * x + y * y <= (col.limite + 0.01) * (col.limite + 0.01); }

    // Avance le marcheur w { x, y, z, vz, auSol } de (dx, dy) mètres, puis le pose ou le laisse tomber pendant dt.
    function pas(w, dx, dy, dt, saut) {
      var l = Math.sqrt(dx * dx + dy * dy), n = Math.max(1, Math.ceil(l / PAS_MAX)), i, it, f, r;
      for (i = 0; i < n; i++) {
        px = w.x + dx / n; py = w.y + dy / n;
        // Chaque correction pousse le long de la normale du mur : le reste du pas glisse le long de la façade.
        for (it = 0; it < 6 && ecarte(w.z, true) > 0; it++);
        r = Math.sqrt(px * px + py * py);
        if (r > col.limite) { px *= col.limite / r; py *= col.limite / r; }
        if (ecarte(w.z, false) < 1e-3) { w.x = px; w.y = py; }
      }
      f = sol(w.x, w.y, w.z);
      if (w.auSol) {
        if (saut) { w.vz = SAUT; w.auSol = false; }
        else if (f >= w.z - MARCHE - 0.15) { w.z = f; w.vz = 0; }
        else w.auSol = false;
      }
      if (!w.auSol) {
        f = sol(w.x, w.y, w.z);
        w.vz -= PESANTEUR * dt;
        w.z += w.vz * dt;
        if (w.z <= f && w.vz <= 0) { w.z = f; w.vz = 0; w.auSol = true; }
      }
      // En changeant de hauteur, il a pu se retrouver contre un mur qui ne le gênait pas plus haut.
      px = w.x; py = w.y;
      if (ecarte(w.z, false) > 0) {
        for (it = 0; it < 6 && ecarte(w.z, true) > 0; it++);
        if (ecarte(w.z, false) < 1e-3) { w.x = px; w.y = py; }
      }
    }

    // Le point libre le plus proche de (x, y), cherché en spirale : pour le départ et les voyages sur la carte.
    function pose(x, y) {
      var r, a, qx, qy, z;
      for (r = 0; r < 60; r += 0.5) for (a = 0; a < 6.283; a += r ? 0.7 / r : 7) {
        qx = x + Math.cos(a) * r; qy = y + Math.sin(a) * r; z = col.zsol(qx, qy);
        if (!plein(qx, qy) && libre(qx, qy, z) && voisinage(qx, qy, z)) return { x: qx, y: qy, z: z };
      }
      return { x: x, y: y, z: col.zsol(x, y) };
    }
    // Refuse les poches fermées (l'intérieur d'une maison, d'une tour) : il faut pouvoir s'éloigner de quelques mètres.
    function voisinage(x, y, z) {
      var k, a, s, ok = 0;
      for (k = 0; k < 8; k++) {
        a = k * Math.PI / 4;
        for (s = 0.25; s <= 4; s += 0.25) if (!libre(x + Math.cos(a) * s, y + Math.sin(a) * s, z)) break;
        if (s > 4) ok++;
      }
      return ok >= 2;
    }

    return { sol: sol, libre: libre, plein: plein, pas: pas, pose: pose, nouveau: function (x, y) { return { x: x, y: y, z: sol(x, y, col.zsol(x, y)), vz: 0, auSol: true }; } };
  }

  window.VisiteMarche = { RAYON: RAYON, TAILLE: TAILLE, YEUX: YEUX, MARCHE: MARCHE, PAS_MAX: PAS_MAX, creer: creer };
})();
