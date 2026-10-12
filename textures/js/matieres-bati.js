(function () {
  'use strict';

  var T = (typeof window !== 'undefined' ? window : globalThis).Textures, O = T.o;
  var TAU = O.TAU, mod = O.mod, borne = O.borne, frac = O.frac, h2 = O.h2, bruit = O.bruit, fbm = O.fbm, voronoi = O.voronoi, biseau = O.biseau, diviseur = O.diviseur;
  var glisse = O.glisse, choix = O.choix, mousse = O.mousse, MOUSSE = O.MOUSSE;

  // Joints : sombres juste sous une pierre ou à sa droite (ombre portée), plus clairs ailleurs.
  function joints(c, cel, rampe, max) {
    var n = c.n, x, y, i = 0;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++, i++) {
        if (cel[i] >= 0) continue;
        c.r[i] = rampe;
        c.v[i] = cel[c.i(x, y - 1)] >= 0 || cel[c.i(x - 1, y)] >= 0 ? 0 : h2(x, y, c.g + 77) < 0.12 ? Math.min(max, 2) : 1;
      }
    }
  }

  // ---------- Mur de briques ----------
  T.matiere({
    id: 'briques', nom: 'Mur de briques',
    rampes: [
      { nom: 'Brique', hex: ['4b1d1b', '762b22', '9f3f2b', 'bf5c39', 'da845a'] },
      { nom: 'Joint', hex: ['3f3a36', '6b635a', '968d7d'] },
      MOUSSE
    ],
    reglages: [glisse('taille', 'Taille des briques', 0.5), glisse('joint', 'Épaisseur des joints', 0.3), glisse('variation', 'Variation des teintes', 0.5), glisse('usure', 'Usure', 0.3), glisse('mousse', 'Mousse', 0),
      choix('appareil', 'Appareillage', [['demi', 'Décalé de moitié'], ['quart', 'En escalier'], ['alea', 'Irrégulier'], ['boutisse', 'Panneresses et boutisses'], ['empile', 'Empilé']])],
    dessiner: function (c) {
      var n = c.n, p = c.p, R = diviseur(n, n / ((3.2 + p.taille * 6) * c.e), 2), bh = n / R, K = Math.max(1, R / 2), bw = n / K;
      var j = borne(Math.round(bh * (0.1 + p.joint * 0.28)), 1, bh - 2), cel = new Int32Array(n * n), poids = new Float32Array(n * n);
      var x, y, i = 0, rg, ly, lr, dec, xx, col, lx, fw, fh = bh - j, id, h, t, coin, u;
      for (y = 0; y < n; y++) {
        rg = Math.floor(y / bh); ly = y - rg * bh;
        lr = p.appareil === 'boutisse' && (rg & 1) ? bw / 2 : bw;
        dec = p.appareil === 'demi' ? (rg & 1) * bw / 2 : p.appareil === 'quart' ? (R >= 4 ? (rg % 4) * bw / 4 : (rg & 1) * bw / 2) : p.appareil === 'alea' ? Math.floor(h2(rg, 9, c.g) * bw) : p.appareil === 'boutisse' ? (rg & 1) * bw / 4 : 0;
        dec = Math.floor(dec);
        for (x = 0; x < n; x++, i++) {
          xx = mod(x - dec, n); col = Math.floor(xx / lr); lx = xx - col * lr; fw = lr - j;
          id = rg * 256 + col;
          if (lx >= fw || ly >= fh) { cel[i] = -1; poids[i] = 0.13; continue; }
          h = h2(id, 1, c.g);
          if (fh >= 5 && h2(id, 4, c.g) < p.usure * 0.9) {
            coin = Math.floor(h2(id, 5, c.g) * 4);
            u = (coin & 1 ? fw - 1 - lx : lx) + (coin & 2 ? fh - 1 - ly : ly);
            if (u < (fh >= 6 ? 2 : 1)) { cel[i] = -1; continue; }
          }
          cel[i] = id;
          t = 2 + Math.round((h - 0.5) * 2.6 * p.variation);
          if (h2(id, 2, c.g) < 0.1 * p.variation) t -= 1;
          if (fw >= 3 && fh >= 3) {
            if (fh < 5) { if (ly === 0 && lx < fw - 1) t += 1; }
            else if ((ly === 0 && lx < fw - 1) || (lx === 0 && ly < fh - 1)) t += 1;
            else if ((ly === fh - 1 && lx > 0) || (lx === fw - 1 && ly > 0)) t -= 1;
            else if (fh >= 5 && h2(x, y, c.g + 2) < 0.03 + p.usure * 0.09) t -= 1;
            else if (fh >= 5 && h2(x, y, c.g + 3) < 0.03) t += 1;
            if (fw >= 7 && fh >= 6 && h2(id, 6, c.g) < p.usure * 0.3 && lx === Math.floor(fw * (0.3 + 0.4 * h2(id, 7, c.g))) + (h2(id, ly, c.g) < 0.4 ? 1 : 0)) t = 0;
          }
          c.pose(x, y, 0, borne(t, 0, 4));
        }
      }
      joints(c, cel, 1, 2);
      mousse(c, 2, p.mousse, c.g + 21, poids);
    }
  });

  // ---------- Pavés ----------
  T.matiere({
    id: 'paves', nom: 'Pavés',
    rampes: [
      { nom: 'Pavé', hex: ['24232b', '3f3f4a', '5d5e69', '7f828a', 'a5a9ab', 'cbcfcc'] },
      { nom: 'Joint', hex: ['1e1a18', '37302a', '504638'] },
      MOUSSE
    ],
    reglages: [glisse('taille', 'Taille des pavés', 0.5), glisse('joint', 'Largeur des joints', 0.35), glisse('bombe', 'Bombé', 0.6), glisse('variation', 'Variation des teintes', 0.5), glisse('regularite', 'Régularité', 0.3), glisse('mousse', 'Mousse dans les joints', 0)],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = Math.max(2, Math.round(n / ((6 + p.taille * 8) * c.e))), rad = n / K / 2;
      var V = voronoi(n, K, K, 1 - p.regularite * 0.8, c.g, { decale: K % 2 === 0 && p.regularite > 0.5 });
      var j = 0.5 + p.joint * 1.3 * c.e, cel = new Int32Array(n * n), poids = new Float32Array(n * n), bis, x, y, i, k, base, l, t;
      for (i = 0; i < n * n; i++) {
        cel[i] = V.bord[i] < j || (V.bord[i] < j + 0.9 && V.bord2[i] < j + 0.9) ? -1 : V.id[i];
        poids[i] = cel[i] < 0 ? 0.16 : -0.07;
      }
      bis = biseau(cel, n);
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          k = cel[i];
          if (k < 0) continue;
          base = 2 + Math.round((h2(k, 1, c.g) - 0.5) * 2.4 * p.variation);
          l = (-V.dx[i] - V.dy[i]) / rad * 0.75;
          t = base + borne(l * p.bombe * 1.8, -1.2, 1.4);
          if (bis[i] < 0) t = Math.min(t, base - 1);
          else if (bis[i] > 0 && l > 0) t = Math.max(t, base + 1);
          else if (h2(x, y, c.g + 2) < 0.035) t -= 1;
          c.pose(x, y, 0, borne(t, 0, 5));
        }
      }
      joints(c, cel, 1, 2);
      mousse(c, 2, p.mousse, c.g + 21, poids);
    }
  });

  // ---------- Dalles ----------
  T.matiere({
    id: 'dalles', nom: 'Dalles',
    rampes: [
      { nom: 'Dalle', hex: ['34302e', '544e48', '746d62', '92897a', 'b0a994', 'ccc7b4'] },
      { nom: 'Joint', hex: ['1f1c1a', '37322d'] },
      MOUSSE
    ],
    reglages: [glisse('taille', 'Taille des dalles', 0.5), glisse('assemblage', 'Dalles de tailles mêlées', 0.5), glisse('joint', 'Largeur des joints', 0.2), glisse('grain', 'Grain de la pierre', 0.5), glisse('fissures', 'Fissures', 0.3), glisse('usure', 'Coins ébréchés', 0.3), glisse('variation', 'Variation des teintes', 0.4), glisse('mousse', 'Mousse', 0)],
    dessiner: function (c) {
      var n = c.n, p = c.p, G = diviseur(n, n / ((7 + p.taille * 9) * c.e), 2), cs = n / G, jw = Math.max(1, Math.round((0.5 + p.joint * 2) * c.e));
      var dalle = new Int32Array(G * G).fill(-1), cel = new Int32Array(n * n), poids = new Float32Array(n * n), r = c.alea(1), f = Math.max(3, Math.round(6 * c.e));
      var x, y, i, gi, gj, a, b, d, sid, bis, t, m, k, px, py, an, pas, voisins;
      function g(ci, cj) { return mod(cj, G) * G + mod(ci, G); }
      // Assemblage : certaines cases se soudent en dalles de 2 × 1, 1 × 2 ou 2 × 2.
      for (gj = 0; gj < G; gj++) {
        for (gi = 0; gi < G; gi++) {
          if (dalle[g(gi, gj)] >= 0) continue;
          sid = gj * G + gi; dalle[sid] = sid; a = r(); b = r();
          if (G < 4 || a > p.assemblage * 0.75) continue;
          if (b < 0.3 && dalle[g(gi + 1, gj)] < 0 && dalle[g(gi, gj + 1)] < 0 && dalle[g(gi + 1, gj + 1)] < 0) dalle[g(gi + 1, gj)] = dalle[g(gi, gj + 1)] = dalle[g(gi + 1, gj + 1)] = sid;
          else if (b < 0.65 && dalle[g(gi + 1, gj)] < 0) dalle[g(gi + 1, gj)] = sid;
          else if (dalle[g(gi, gj + 1)] < 0) dalle[g(gi, gj + 1)] = sid;
        }
      }
      function de(xx, yy) { return dalle[g(Math.floor(mod(xx, n) / cs), Math.floor(mod(yy, n) / cs))]; }
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          sid = de(x, y);
          cel[i] = de(x + jw, y) !== sid || de(x, y + jw) !== sid || de(x + jw, y + jw) !== sid ? -1 : sid;
        }
      }
      // Coins ébréchés.
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          if (cel[i] < 0) continue;
          voisins = (cel[c.i(x - 1, y)] < 0 ? 1 : 0) + (cel[c.i(x + 1, y)] < 0 ? 1 : 0) + (cel[c.i(x, y - 1)] < 0 ? 1 : 0) + (cel[c.i(x, y + 1)] < 0 ? 1 : 0);
          if (voisins >= 2 && h2(x, y, c.g + 4) < p.usure * 0.7) cel[i] = -2;
        }
      }
      for (i = 0; i < n * n; i++) { if (cel[i] === -2) cel[i] = -1; poids[i] = cel[i] < 0 ? 0.14 : 0; }
      bis = biseau(cel, n);
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          sid = cel[i];
          if (sid < 0) continue;
          t = Math.round(2.5 + (h2(sid, 1, c.g) - 0.5) * 3 * p.variation);
          m = fbm(x / n, y / n, f, f, 2, c.g + sid * 13);
          if (m > 0.74 - p.grain * 0.14) t += 1; else if (m < 0.27 + p.grain * 0.13) t -= 1;
          if (bis[i] > 0) t += 1; else if (bis[i] < 0) t -= 1;
          c.pose(x, y, 0, borne(t, 1, 5));
        }
      }
      // Fissures : une marche au hasard qui s'arrête au bord de sa dalle.
      for (k = 0; k < G * G; k++) {
        a = r(); px = (k % G + 0.2 + 0.6 * r()) * cs; py = (Math.floor(k / G) + 0.2 + 0.6 * r()) * cs; an = r() * TAU; d = r();
        if (a > p.fissures * 0.7) continue;
        sid = cel[c.i(Math.floor(px), Math.floor(py))];
        if (sid < 0) continue;
        for (b = 0; b < 2; b++) {
          x = px; y = py; t = an + b * Math.PI + (d - 0.5);
          for (pas = 0; pas < cs * 2; pas++) {
            i = c.i(Math.floor(x), Math.floor(y));
            if (cel[i] !== sid) break;
            c.v[i] = 0;
            m = c.i(Math.floor(x) + 1, Math.floor(y) + 1);
            if (cel[m] === sid && c.v[m] > 0) c.v[m] = Math.min(5, c.v[m] + 0.5);
            x += Math.cos(t) * 0.8; y += Math.sin(t) * 0.8;
            t += (h2(pas, k * 2 + b, c.g + 6) - 0.5) * 0.45;
          }
        }
      }
      for (i = 0; i < n * n; i++) if (cel[i] >= 0) c.v[i] = Math.round(c.v[i]);
      joints(c, cel, 1, 1);
      mousse(c, 2, p.mousse, c.g + 21, poids);
    }
  });

  // ---------- Planches de bois ----------
  T.matiere({
    id: 'planches', nom: 'Planches de bois',
    rampes: [
      { nom: 'Bois', hex: ['33200f', '553519', '7a4e24', '9c6a32', 'ba8a48', 'd6ac6a'] },
      { nom: 'Clous', hex: ['1d1d22', '5c5c66', 'a9a9b4'] }
    ],
    reglages: [glisse('largeur', 'Largeur des planches', 0.5), glisse('veinage', 'Veinage', 0.6), glisse('noeuds', 'Nœuds', 0.4), glisse('clous', 'Clous', 0.6), glisse('usure', 'Usure', 0.3), glisse('variation', 'Variation des teintes', 0.5),
      choix('sens', 'Sens des planches', [['h', 'Horizontales'], ['v', 'Verticales']]), choix('pose', 'Pose', [['decale', 'Joints décalés'], ['continu', 'Planches continues']])],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = diviseur(n, n / ((6 + p.largeur * 10) * c.e), 2), pw = n / K, hz = p.sens === 'h';
      var lignes = Math.max(1.5, pw / 3.2), fa = Math.max(2, Math.round(2 * c.e)), nj = p.pose === 'decale' ? Math.max(1, Math.round(c.e)) : 0;
      var a, b, q, lb, i, k, t, seg, jts, d, base, tt, fr, da, db, dn, kn, rn, ton, clou, r, nb, x, y, ja, pos = [];
      function px(aa, bb) { return hz ? c.i(aa, bb) : c.i(bb, aa); }
      for (q = 0; q < K; q++) {
        jts = [];
        for (k = 0; k < nj; k++) jts.push(Math.floor((k + 0.15 + 0.7 * h2(q, k, c.g + 1)) * n / nj + h2(q, 50, c.g) * n) % n);
        jts.sort(function (u, w) { return u - w; });
        pos.push(jts);
      }
      for (b = 0; b < n; b++) {
        q = Math.floor(b / pw); lb = b - q * pw; jts = pos[q];
        for (a = 0; a < n; a++) {
          seg = 0; d = n;
          for (k = 0; k < jts.length; k++) { if (jts[k] <= a) seg++; d = Math.min(d, mod(a - jts[k], n)); }
          seg = jts.length ? seg % jts.length : 0;
          base = 2 + Math.round((h2(q, seg, c.g + 2) - 0.5) * 2.4 * p.variation);
          i = px(a, b);
          c.r[i] = 0;
          if (lb === pw - 1 || (jts.length && d === 0)) { c.v[i] = 0; continue; }
          ton = base;
          tt = (lb + 0.5) / pw * lignes + 1.5 * bruit(a / n * fa, q * 3.7 + seg * 1.3, fa, 512, c.g + 3) + h2(q, seg, c.g + 4) * 7;
          // Nœud : les veines le contournent.
          kn = -1;
          if (h2(q, seg + 20, c.g) < p.noeuds * 0.75 && pw >= 5) {
            da = mod(a - Math.floor(h2(q, seg + 30, c.g) * n) + n / 2, n) - n / 2;
            db = lb + 0.5 - pw * (0.35 + 0.3 * h2(q, seg + 40, c.g));
            rn = Math.min(pw * 0.28, (1 + h2(q, seg + 60, c.g) * 1.4) * c.e);
            dn = Math.sqrt(da * da / 3.2 + db * db);
            tt += 1.3 * Math.exp(-dn * dn / (rn * rn * 5)) * (db < 0 ? -1 : 1);
            kn = dn;
          }
          fr = frac(tt);
          if (fr < lignes / pw * 1.05) { if (bruit(a / n * fa * 3, Math.floor(tt) * 1.9 + q * 5.3, fa * 3, 512, c.g + 5) < 0.3 + p.veinage * 0.55) ton -= 1; }
          else if (fr > 0.5 && fr < 0.5 + lignes / pw && bruit(a / n * fa * 3, Math.floor(tt) * 2.3 + q * 7.1, fa * 3, 512, c.g + 6) < p.veinage * 0.45) ton += 1;
          if (kn >= 0 && kn < rn) ton = kn < rn * 0.5 ? 0 : 1;
          if (lb === 0) ton += 1; else if (lb === pw - 2 && pw >= 6) ton -= 1;
          if (jts.length && d === 1) ton += 1; else if (jts.length && d === n - 1) ton -= 1;
          c.v[i] = borne(ton, 1, 5);
          if (kn >= 0 && kn < rn * 0.5) c.v[i] = 0;
        }
      }
      // Clous : près des joints, ou sur deux lignes de solives quand les planches sont continues.
      if (p.clous > 0.05) {
        for (q = 0; q < K; q++) {
          clou = pos[q].length ? [] : [Math.floor(n / 4), Math.floor(3 * n / 4)];
          for (k = 0; k < pos[q].length; k++) clou.push(pos[q][k] - 2 - Math.round(c.e), pos[q][k] + 2 + Math.round(c.e));
          for (k = 0; k < clou.length; k++) {
            ja = pw >= 9 && p.clous > 0.5 ? [Math.floor(pw / 4), Math.floor(pw * 3 / 4) - 1] : [Math.floor(pw / 2) - 1];
            for (t = 0; t < ja.length; t++) {
              a = clou[k]; b = q * pw + ja[t];
              if (n >= 64) {
                i = px(a, b); c.r[i] = 1; c.v[i] = 2;
                i = px(a + 1, b); c.r[i] = 1; c.v[i] = 1;
                i = px(a, b + 1); c.r[i] = 1; c.v[i] = 1;
                i = px(a + 1, b + 1); c.r[i] = 1; c.v[i] = 0;
              } else { i = px(a, b); c.r[i] = 1; c.v[i] = 1; i = px(a + 1, b + 1); if (c.r[i] === 0) c.v[i] = Math.max(0, c.v[i] - 1); }
            }
          }
        }
      }
      r = c.alea(1);
      nb = Math.round(p.usure * n * n / 80);
      for (k = 0; k < nb; k++) {
        a = Math.floor(r() * n); b = Math.floor(r() * n); t = 2 + Math.floor(r() * 4 * c.e); d = r() < 0.6 ? 1 : -1;
        for (x = 0; x < t; x++) { i = px(a + x, b); if (c.r[i] === 0 && c.v[i] >= 1) c.v[i] = borne(c.v[i] + d, 1, 5); }
      }
    }
  });

  // ---------- Tuiles de toit ----------
  T.matiere({
    id: 'tuiles', nom: 'Tuiles de toit',
    rampes: [{ nom: 'Tuile', hex: ['471a19', '722920', 'a03c2a', 'c25836', 'dc8052', 'f0ac7c'] }, MOUSSE],
    reglages: [glisse('taille', 'Taille des tuiles', 0.5), glisse('variation', 'Variation des teintes', 0.5), glisse('usure', 'Usure', 0.3), glisse('mousse', 'Mousse', 0),
      choix('forme', 'Forme', [['ecaille', 'Écailles arrondies'], ['plate', 'Tuiles plates'], ['canal', 'Tuiles canal']])],
    dessiner: function (c) {
      var n = c.n, p = c.p, R = diviseur(n, n / ((6 + p.taille * 8) * c.e), 2), th = n / R, tw = th, poids = new Float32Array(n * n);
      var x, y, i = 0, rg, ly, col, lx, yb, base, t, id, nx, tl, Rr, bord;
      function arc(l) {
        if (p.forme !== 'ecaille') return th - 1;
        var q = (l + 0.5 - tw / 2) / (tw / 2);
        return th - 1 - Math.round(tw * 0.42 * (1 - Math.sqrt(Math.max(0, 1 - q * q))));
      }
      function ton(id) { return 2 + Math.round((h2(id, 1, c.g) - 0.5) * 2.6 * p.variation) + (h2(id, 2, c.g) < 0.08 * p.variation ? 1 : 0); }
      if (p.forme === 'canal') {
        Rr = Math.max(1, R / 2); tl = n / Rr;
        for (y = 0; y < n; y++) {
          for (x = 0; x < n; x++, i++) {
            col = Math.floor(x / tw); lx = x - col * tw;
            ly = mod(y - (col & 1) * Math.floor(tl / 2), n); rg = Math.floor(ly / tl); ly -= rg * tl;
            id = rg * 256 + col; base = ton(id);
            nx = (lx + 0.5) / tw * 2 - 1;
            t = base + (nx < -0.45 ? 1 : nx > 0.4 ? -1 : 0);
            if (tw >= 8 && nx > -0.45 && nx < -0.15) t = base + (ly > tl * 0.2 ? 2 : 1);
            if (lx === 0 || lx === tw - 1) t = lx === 0 && tw >= 6 ? 1 : 0;
            if (ly === tl - 1) t = 0; else if (ly === 0) t -= 1; else if (ly === tl - 2 && tl >= 8) t += 1;
            if (ly > tl - 4 || lx === 0) poids[i] = 0.1;
            if (h2(x, y, c.g + 3) < p.usure * 0.1) t -= 1;
            c.pose(x, y, 0, borne(t, 0, 5));
          }
        }
      } else {
        for (y = 0; y < n; y++) {
          rg = Math.floor(y / th); ly = y - rg * th;
          for (x = 0; x < n; x++, i++) {
            lx = mod(x - (rg & 1) * Math.floor(tw / 2), n); col = Math.floor(lx / tw); lx -= col * tw;
            yb = arc(lx);
            if (h2(rg * 256 + col, 5, c.g) < p.usure * 0.6 && Math.abs(lx - Math.floor(tw * (0.25 + 0.5 * h2(rg * 256 + col, 6, c.g)))) < 1 + (th >= 12 ? 1 : 0)) yb -= 1;
            if (ly > yb) {
              // Sous l'arrondi, on voit le haut de la tuile du rang suivant, dans l'ombre.
              id = mod(rg + 1, R) * 256 + Math.floor(mod(x - ((rg + 1) & 1) * Math.floor(tw / 2), n) / tw);
              c.pose(x, y, 0, borne(ton(id) - 1, 1, 4));
              poids[i] = 0.12;
              continue;
            }
            id = rg * 256 + col; base = ton(id);
            bord = ly === yb || ly > arc(lx - 1) || ly > arc(lx + 1) || (p.forme === 'plate' && lx === tw - 1);
            if (bord) t = 0;
            else {
              t = base + (lx < Math.max(1, tw * 0.22) ? 1 : lx >= tw * 0.72 ? -1 : 0);
              if (ly === 0 && th >= 5) t -= 1;
              else if (ly === yb - 1 && th >= 8 && lx > tw * 0.2 && lx < tw * 0.7) t += 1;
              else if (h2(x, y, c.g + 3) < p.usure * 0.12) t -= 1;
              t = borne(t, 1, 5);
            }
            if (ly >= yb - 1) poids[i] = 0.08;
            c.pose(x, y, 0, t);
          }
        }
      }
      mousse(c, 1, p.mousse, c.g + 21, poids);
    }
  });

  // ---------- Tôle ----------
  T.matiere({
    id: 'tole', nom: 'Tôle rivetée',
    rampes: [
      { nom: 'Métal', hex: ['1f232b', '353d49', '52606c', '76868f', 'a1b1b6', 'd2dedd'] },
      { nom: 'Rouille', hex: ['42200f', '6f3515', '9c4f1c', 'c67430'] }
    ],
    reglages: [glisse('plaques', 'Taille des plaques', 0.5), glisse('rivets', 'Rivets', 0.6), glisse('brosse', 'Brossage', 0.5), glisse('rouille', 'Rouille', 0.25), glisse('rayures', 'Rayures', 0.3),
      choix('type', 'Type', [['plaques', 'Plaques rivetées'], ['ondulee', 'Tôle ondulée'], ['larmee', 'Tôle larmée']])],
    dessiner: function (c) {
      var n = c.n, p = c.p, G = diviseur(n, n / ((15 + p.plaques * 16) * c.e), 1), cs = n / G, metal = new Uint8Array(n * n);
      var x, y, i = 0, gi, gj, lx, ly, t, s, m, f = Math.max(2, Math.round(3 * c.e)), tw, P, cx, cy, d, r, nb, k, a, lon, px, py, nr, q, e, seuil;
      function rivet(rx, ry) {
        if (n >= 64) {
          c.pose(rx, ry, 0, 5); c.pose(rx + 1, ry, 0, 4); c.pose(rx, ry + 1, 0, 4); c.pose(rx + 1, ry + 1, 0, 2);
          c.pose(rx + 2, ry + 1, 0, 1); c.pose(rx + 1, ry + 2, 0, 1); c.pose(rx + 2, ry + 2, 0, 0);
        } else { c.pose(rx, ry, 0, 5); c.pose(rx + 1, ry + 1, 0, 0); c.pose(rx + 1, ry, 0, 1); c.pose(rx, ry + 1, 0, 1); }
      }
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          gi = Math.floor(x / cs); gj = Math.floor(y / cs); lx = x - gi * cs; ly = y - gj * cs;
          if (p.type === 'ondulee') {
            tw = diviseur(n, (4 + p.plaques * 6) * c.e, 4, 16);
            t = 2.5 + 1.9 * Math.cos(TAU * ((x + 0.5) / tw) + 0.9);
            if (ly === cs - 1) t = 0; else if (ly === 0) t += 1;
          } else {
            t = 2 + (h2(gi, gj, c.g + 1) < 0.4 ? 1 : 0);
            s = bruit(x / n * 3, y * 0.7, 3, 4096, c.g + 2 + (gi + gj * 16) * 31);
            if (s > 1 - 0.3 * p.brosse) t += 1; else if (s < 0.28 * p.brosse) t -= 1;
            if (p.type === 'larmee') {
              P = n >= 32 ? 8 : 4; cx = mod(x, P); cy = mod(y, P);
              d = ((Math.floor(x / P) + Math.floor(y / P)) & 1) ? cx - cy : cx + cy - (P - 1);
              q = ((Math.floor(x / P) + Math.floor(y / P)) & 1) ? cx + cy - (P - 1) : cx - cy;
              if (Math.abs(q) <= P / 2 - 1) { if (d === 0) t = 5; else if (d === 1) t = 1; else if (d === -1 && P >= 8) t = 4; }
            } else if (lx === cs - 1 || ly === cs - 1) t = 0;
            else if (lx === 0 || ly === 0) t = 4;
            else if (lx === cs - 2 || ly === cs - 2) t = Math.min(t, 1);
          }
          c.pose(x, y, 0, borne(t, 0, 5));
        }
      }
      if (p.type !== 'larmee' && p.rivets > 0.05) {
        e = cs >= 12 ? 2 : 1;
        nr = Math.max(2, Math.round(cs / ((6 + (1 - p.rivets) * 10) * c.e)));
        for (gj = 0; gj < G; gj++) {
          for (gi = 0; gi < G; gi++) {
            for (k = 0; k < nr; k++) {
              q = Math.round(e + (cs - 2 * e - 2) * (nr === 1 ? 0 : k / (nr - 1)));
              if (p.type === 'ondulee') { if (k % 2 === 0) rivet(gi * cs + q, gj * cs + e); continue; }
              rivet(gi * cs + q, gj * cs + e);
              if (cs >= 10) rivet(gi * cs + q, gj * cs + cs - e - 3);
              if (k > 0 && k < nr - 1) { rivet(gi * cs + e, gj * cs + q); if (cs >= 10) rivet(gi * cs + cs - e - 3, gj * cs + q); }
            }
          }
        }
      }
      r = c.alea(1);
      nb = Math.round(p.rayures * 5 * c.e * c.e);
      for (k = 0; k < nb; k++) {
        px = r() * n; py = r() * n; a = (r() - 0.5) * 1.2 + (r() < 0.5 ? 0 : Math.PI / 2); lon = n * (0.15 + 0.35 * r());
        for (q = 0; q < lon; q++) { c.plus(Math.floor(px), Math.floor(py), 1); px += Math.cos(a); py += Math.sin(a); }
      }
      for (i = 0; i < n * n; i++) c.v[i] = Math.min(5, c.v[i]);
      if (p.rouille > 0) {
        seuil = 0.8 - p.rouille * 0.36;
        for (y = 0, i = 0; y < n; y++) {
          for (x = 0; x < n; x++, i++) {
            lx = x % cs; ly = y % cs;
            m = fbm(x / n, y / n, f * 3, f, 2, c.g + 9) + (p.type !== 'larmee' && (lx < 2 || ly < 2 || lx > cs - 3 || ly > cs - 3) ? 0.07 : 0) + (c.v[i] <= 1 ? 0.05 : 0);
            if (m > seuil) { c.r[i] = 1; c.v[i] = borne((m - seuil) * 16 + (c.v[i] >= 4 ? 1 : c.v[i] <= 1 ? -1 : 0), 0, 3); }
          }
        }
      }
    }
  });

  // ---------- Tissu ----------
  T.matiere({
    id: 'tissu', nom: 'Tissu',
    rampes: [
      { nom: 'Fil A', hex: ['232750', '364482', '5266ac', '7c92cf', 'aebfea'] },
      { nom: 'Fil B', hex: ['5e1a2a', '8f2a36', 'bd4646', 'dd7868', 'f2b0a0'] }
    ],
    reglages: [glisse('fil', 'Grosseur du fil', 0.4), glisse('relief', 'Relief', 0.7), glisse('irregularite', 'Irrégularité des fils', 0.3), glisse('usure', 'Usure', 0.1),
      choix('armure', 'Armure', [['toile', 'Toile'], ['serge', 'Sergé'], ['natte', 'Natté']]), choix('motif', 'Motif', [['uni', 'Uni'], ['chine', 'Chiné (deux fils)'], ['raye', 'Rayures'], ['carreaux', 'Carreaux']])],
    dessiner: function (c) {
      var n = c.n, p = c.p, w = diviseur(n, (1.6 + p.fil * 4.5) * c.e, 2, n / 8), nt = n / w, P = Math.min(nt, 8), f = Math.max(2, Math.round(3 * c.e));
      var x, y, i = 0, ti, tj, lx, ly, chaine, ra, t, q, s, k, voisin, bandes = [0, 0, 0, 1, 0, 1, 1, 1];
      function dessus(a, b) {
        if (p.armure === 'serge') return mod(a - b, 4) < 2;
        if (p.armure === 'natte') return (((a >> 1) + (b >> 1)) & 1) === 0;
        return ((a + b) & 1) === 0;
      }
      function fil(k2) { return P >= 8 ? bandes[mod(k2, 8)] : (mod(k2, P) < P / 2 ? 0 : 1); }
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          ti = Math.floor(x / w); tj = Math.floor(y / w); lx = x - ti * w; ly = y - tj * w;
          chaine = dessus(ti, tj);
          if (chaine) { ra = p.motif === 'raye' || p.motif === 'carreaux' ? fil(ti) : 0; q = lx; s = ly; k = ti; voisin = !dessus(ti, tj + (ly === 0 ? -1 : 1)); }
          else { ra = p.motif === 'carreaux' ? fil(tj) : p.motif === 'chine' ? 1 : 0; q = ly; s = lx; k = tj + 1000; voisin = dessus(ti + (lx === 0 ? -1 : 1), tj); }
          t = chaine ? 2 : 2 - (w === 2 ? 1 : 0) * (p.relief > 0.3 ? 1 : 0);
          if (p.relief > 0.15) {
            if (q === 0) t += 1; else if (q === w - 1 && w > 2) t -= 1;
            if (w >= 4 && voisin && (s === 0 || s === w - 1) && p.relief > 0.5) t -= 1;
          }
          if (!chaine && w > 2 && p.motif === 'uni') t -= 0.5 * p.relief;
          if (h2(mod(k, 1000) % nt, k >= 1000 ? 1 : 0, c.g) < p.irregularite * 0.4) t += h2(k, 3, c.g) < 0.5 ? -1 : 1;
          if (p.usure > 0 && fbm(x / n, y / n, f, f, 2, c.g + 5) > 0.7 - p.usure * 0.25) t += 1;
          if (h2(x, y, c.g + 6) < p.usure * 0.06) t += 1;
          c.pose(x, y, ra, borne(Math.round(t), 0, 4));
        }
      }
    }
  });

  // ---------- Marbre ----------
  T.matiere({
    id: 'marbre', nom: 'Marbre veiné',
    rampes: [
      { nom: 'Marbre', hex: ['55566a', '858694', 'b0b1bb', 'd5d5da', 'eeeeec', 'ffffff'] },
      { nom: 'Veinules', hex: ['8c7a5a', 'c4ae84'] }
    ],
    reglages: [glisse('veines', 'Nombre de veines', 0.5), glisse('turbulence', 'Turbulence', 0.6), glisse('epaisseur', 'Épaisseur des veines', 0.4), glisse('veinules', 'Veinules dorées', 0.4), glisse('nuages', 'Nuages', 0.5),
      choix('sens', 'Sens des veines', [['d', 'En diagonale'], ['h', 'Horizontales'], ['v', 'Verticales']])],
    dessiner: function (c) {
      var n = c.n, p = c.p, K = Math.max(1, Math.round((0.5 + p.veines * 1.5) * c.e)), kx = p.sens === 'h' ? 0 : K, ky = p.sens === 'v' ? 0 : K;
      var kx2 = K, ky2 = p.sens === 'h' ? K : -K, f = Math.max(2, Math.round(3 * c.e));
      var x, y, i, d, lv, ton, A = new Float32Array(n * n), B = new Float32Array(n * n);
      function pente(F, x, y) {
        var a = F[c.i(x, y)], dx = F[c.i(x + 1, y)] - a, dy = F[c.i(x, y + 1)] - a;
        dx -= Math.round(dx); dy -= Math.round(dy);
        return Math.sqrt(dx * dx + dy * dy);
      }
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          A[i] = kx * x / n + ky * y / n + p.turbulence * 1.6 * (fbm(x / n, y / n, 2, 2, 4, c.g) * 2 - 1);
          B[i] = kx2 * x / n + ky2 * y / n + p.turbulence * 1.3 * (fbm(x / n, y / n, 3, 3, 3, c.g + 30) * 2 - 1);
        }
      }
      for (y = 0, i = 0; y < n; y++) {
        for (x = 0; x < n; x++, i++) {
          ton = Math.round(4.05 + (fbm(x / n, y / n, f, f, 3, c.g + 8) - 0.5) * p.nuages * 4.4);
          // Distance à la veine en pixels : l'écart de phase divisé par la pente du champ.
          d = Math.abs(frac(A[i]) - 0.5) / Math.max(pente(A, x, y), 0.25 / n);
          lv = (0.25 + 1.3 * p.epaisseur * c.e) * (0.15 + 1.5 * fbm(x / n, y / n, 3, 3, 2, c.g + 4));
          if (d < lv) ton = lv > 1 && d < lv * 0.45 ? 0 : lv > 0.6 ? 1 : 2;
          else if (d < lv + 1 && lv > 0.5) ton = Math.min(ton, 3);
          else if (p.veinules > 0) {
            d = Math.abs(frac(B[i]) - 0.5) / Math.max(pente(B, x, y), 0.25 / n);
            if (d < 0.55 && fbm(x / n, y / n, 2, 2, 2, c.g + 12) < 0.28 + p.veinules * 0.3) { c.pose(x, y, 1, fbm(x / n, y / n, 4, 4, 1, c.g + 13) < 0.45 ? 0 : 1); continue; }
          }
          c.pose(x, y, 0, borne(ton, 0, 5));
        }
      }
    }
  });
})();
