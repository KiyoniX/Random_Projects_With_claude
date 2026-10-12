(function () {
  'use strict';

  var M = window.Tuiles, J = M.jeux;

  var TRONC = 16;                 // côté d'un tronçon de calque gardé en mémoire, en cases
  var TRONCS_MAX = 1400;          // au-delà, les tronçons sortis de l'écran sont jetés
  var NIVEAUX = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];   // zooms, en huitièmes de la taille réelle
  var REGLE = 18;                 // épaisseur des règles, en pixels CSS
  var ANIM_MIN = 4;               // sous cette taille de case à l'écran, les animations sont figées
  var MINI_MAX = [176, 124];      // encombrement maximal de la mini-carte, en pixels CSS
  var DELAI_MINI = 220;
  var GRILLE_FORTE = 10;          // une ligne claire toutes les dix cases, d'accord avec les nombres des règles

  var FOND = '#3c3c3e', DAMIER = ['#55555a', '#4b4b50'], BANDE = '#2a2a2c', TRAIT = '#18181a';
  var TEXTE = '#e6e6e3', DOUX = '#a5a5a1', PALE = '#747477', AMBRE = '#e8b04a', CORAIL = '#e2665a', CYAN = '#5cb8c8';

  var $ = function (s) { return document.querySelector(s); };

  // La vue : ppt = côté d'une case à l'écran, (ox, oy) = position à l'écran du coin de la carte.
  // Tout est compté en pixels physiques entiers : une case commence toujours sur un pixel exact.
  var U = M.ui = {
    ppt: 32, ox: 0, oy: 0,
    grille: true, regles: true, mini: true, anime: true,
    survol: null,           // case survolée { x, y }
    essai: null,            // partie en cours du mode essai
    apercuOutil: null,      // dessin de l'outil par-dessus la carte
    AMBRE: AMBRE, CORAIL: CORAIL, CYAN: CYAN
  };

  var scene, toile, g, L = 0, H = 0, D = 1, demande = false;
  var caches = new Map();           // id de calque → Map(clé de tronçon → { toile, r, sale, prochain })
  var toilesJeux = new WeakMap();
  var debX = 0, debY = 0;           // débord des tuiles plus grandes que la case, en cases
  var prochainChangement = Infinity, motifDamier = null, motifPpt = 0;
  var miniSale = true, minuterieMini = null, image = 0;

  // ---------- Géométrie ----------
  function regle() { return U.regles && !U.essai ? Math.round(REGLE * D) : 0; }

  // Position d'un événement de souris, en pixels physiques de la toile.
  U.px = function (e) {
    var r = toile.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) * L / r.width), y: Math.floor((e.clientY - r.top) * H / r.height) };
  };
  U.caseA = function (px, py) { return { x: Math.floor((px - U.ox) / U.ppt), y: Math.floor((py - U.oy) / U.ppt) }; };
  // Point de la carte, en pixels de carte.
  U.pointA = function (px, py) { var k = M.carte.tc / U.ppt; return { x: (px - U.ox) * k, y: (py - U.oy) * k }; };
  U.dansCarte = function (c) { return c.x >= 0 && c.y >= 0 && c.x < M.carte.w && c.y < M.carte.h; };
  U.echelle = function () { return D; };

  function niveau() {
    var z = U.ppt * 8 / M.carte.tc, k, mieux = 0;
    for (k = 0; k < NIVEAUX.length; k++) if (Math.abs(NIVEAUX[k] - z) < Math.abs(NIVEAUX[mieux] - z)) mieux = k;
    return mieux;
  }
  U.zoomTexte = function () { var z = U.ppt * 100 / M.carte.tc; return (z % 1 ? z.toFixed(1).replace('.', ',') : z) + ' %'; };

  function bornerVue() {
    var c = M.carte, r = regle(), m = Math.round(40 * D);
    U.ox = Math.round(Math.max(r + m - c.w * U.ppt, Math.min(L - m, U.ox)));
    U.oy = Math.round(Math.max(r + m - c.h * U.ppt, Math.min(H - m, U.oy)));
  }

  // Change de niveau en gardant sous le pixel (px, py) la même case, au même endroit de la case.
  U.zoomer = function (sens, px, py) {
    var k = Math.max(0, Math.min(NIVEAUX.length - 1, niveau() + sens)), ppt = NIVEAUX[k] * M.carte.tc / 8, mx, my, cx, cy;
    if (ppt === U.ppt) return;
    if (px === undefined) { px = Math.round((L + regle()) / 2); py = Math.round((H + regle()) / 2); }
    mx = (px - U.ox) / U.ppt; my = (py - U.oy) / U.ppt;
    cx = Math.floor(mx); cy = Math.floor(my);
    U.ox = px - cx * ppt - Math.min(ppt - 1, Math.floor((mx - cx) * ppt));
    U.oy = py - cy * ppt - Math.min(ppt - 1, Math.floor((my - cy) * ppt));
    U.ppt = ppt;
    bornerVue();
    U.demander();
    if (U.surVue) U.surVue();
  };

  U.centrerSur = function (cx, cy) {
    var r = regle();
    U.ox = Math.round((L + r) / 2 - cx * U.ppt);
    U.oy = Math.round((H + r) / 2 - cy * U.ppt);
    bornerVue();
    U.demander();
  };

  // huitiemes : niveau voulu, ou rien pour le plus grand qui montre toute la carte.
  U.cadrer = function (huitiemes) {
    var c = M.carte, r = regle(), m = Math.round(14 * D), k, z = NIVEAUX[0];
    if (huitiemes) z = huitiemes;
    else for (k = 0; k < NIVEAUX.length; k++) if (NIVEAUX[k] * c.tc / 8 * c.w <= L - r - 2 * m && NIVEAUX[k] * c.tc / 8 * c.h <= H - r - 2 * m) z = NIVEAUX[k];
    U.ppt = z * c.tc / 8;
    U.centrerSur(c.w / 2, c.h / 2);
    if (U.surVue) U.surVue();
  };

  U.deplacer = function (dx, dy) { U.ox += dx; U.oy += dy; bornerVue(); U.demander(); };

  // ---------- Images des jeux ----------
  U.toileJeu = function (j) {
    var c = toilesJeux.get(j), ctx, im;
    if (c) return c;
    c = document.createElement('canvas');
    c.width = j.w; c.height = j.h;
    ctx = c.getContext('2d');
    im = ctx.createImageData(j.w, j.h);
    new Uint32Array(im.data.buffer).set(j.pix);
    ctx.putImageData(im, 0, 0);
    toilesJeux.set(j, c);
    return c;
  };

  // Dessine la tuile de valeur v dans la case dont le coin est (dx, dy) et le côté r (aperçu du tampon,
  // export en image). Une tuile plus grande que la case déborde vers la droite et vers le haut, comme dans Tiled.
  // Rend l'instant de son prochain changement d'image.
  U.dessinerTuile = function (ctx, v, dx, dy, r, t) {
    var num = v & M.NUMERO, j = M.jeuDe(num), k, im, ech, w, h, X, Y, hf, vf;
    if (!j) {
      ctx.fillStyle = '#d43ad0'; ctx.fillRect(dx, dy, r, r);
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(dx + (r >> 2), dy + (r >> 2), r >> 1, r >> 1);
      return Infinity;
    }
    k = num - j.premier;
    im = j.anims[k] ? J.imageA(j, k, t) : k;
    ech = r / M.carte.tc; w = j.tw * ech; h = j.th * ech; X = dx; Y = dy + r - h;
    if (v > M.NUMERO) {
      hf = v & M.RET_H; vf = v & M.RET_V;
      if (v & M.RET_D) ctx.setTransform(0, vf ? -1 : 1, hf ? -1 : 1, 0, X + (hf ? w : 0), Y + (vf ? h : 0));
      else ctx.setTransform(hf ? -1 : 1, 0, 0, vf ? -1 : 1, X + (hf ? w : 0), Y + (vf ? h : 0));
      ctx.drawImage(U.toileJeu(j), (im % j.cols) * j.tw, Math.floor(im / j.cols) * j.th, j.tw, j.th, 0, 0, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else ctx.drawImage(U.toileJeu(j), (im % j.cols) * j.tw, Math.floor(im / j.cols) * j.th, j.tw, j.th, X, Y, w, h);
    return j.anims[k] ? J.prochain(j, k, t) : Infinity;
  };

  U.dessinerCollision = function (ctx, v, dx, dy, r) {
    var ep;
    if (v === 1) {
      ctx.fillStyle = 'rgba(226,102,90,.5)'; ctx.fillRect(dx, dy, r, r);
      if (r >= 8) { ctx.fillStyle = 'rgba(110,26,22,.75)'; ctx.fillRect(dx, dy, r, 1); ctx.fillRect(dx, dy, 1, r); }
    } else if (v === 2) {
      ep = Math.max(1, Math.round(r / 5));
      ctx.fillStyle = 'rgba(232,176,74,.92)'; ctx.fillRect(dx, dy, r, ep);
      ctx.fillStyle = 'rgba(232,176,74,.22)'; ctx.fillRect(dx, dy + ep, r, r - ep);
    } else if (v === 3 || v === 4) {
      ctx.fillStyle = 'rgba(226,102,90,.5)';
      ctx.beginPath();
      if (v === 3) { ctx.moveTo(dx, dy + r); ctx.lineTo(dx + r, dy + r); ctx.lineTo(dx + r, dy); }
      else { ctx.moveTo(dx, dy); ctx.lineTo(dx, dy + r); ctx.lineTo(dx + r, dy + r); }
      ctx.fill();
    }
  };

  // ---------- Tronçons ----------
  // Un tronçon de tuiles est calculé pixel par pixel, sans passer par drawImage : dézoomé, un calque de
  // 256 × 256 cases coûte alors le nombre de pixels de l'écran, pas le nombre de cases.
  var tampons = {}, colU = new Int32Array(1024), ligV = new Int32Array(1024);

  function peindreTuiles(cal, cx, cy, r, t, e) {
    var c = M.carte, n = TRONC * r, x0 = cx * TRONC, y0 = cy * TRONC, w = c.w, cases = cal.cases, tp = tampons[n], out, ctx;
    var xa = Math.max(0, x0 - debX), xb = Math.min(c.w, x0 + TRONC), yb = Math.min(c.h, y0 + TRONC + debY);
    var x, y, v, num, j = null, ja = 0, jb = 0, k, im, tw, th, dw, dh, dx0, dy0, px, py, X, Y, su, sv, u, q, src, jw, sx0, sy0, hf, vf, df, col, a, d, da, ka, oa, p;
    if (!tp) { tp = tampons[n] = { im: new ImageData(n, n) }; tp.pix = new Uint32Array(tp.im.data.buffer); }
    out = tp.pix;
    out.fill(0);
    e.r = r; e.sale = false; e.prochain = Infinity; e.vide = true;
    for (y = y0; y < yb; y++) {
      for (x = xa; x < xb; x++) {
        v = cases[y * w + x];
        if (!v) continue;
        num = v & M.NUMERO;
        if (num < ja || num >= jb) { j = M.jeuDe(num); if (j) { ja = j.premier; jb = ja + j.nb; } else { ja = jb = 0; } }
        if (!j) {
          if (x >= x0 && y < y0 + TRONC) { e.vide = false; for (py = 0; py < r; py++) out.fill(0xffd03ad4, ((y - y0) * r + py) * n + (x - x0) * r, ((y - y0) * r + py) * n + (x - x0 + 1) * r); }
          continue;
        }
        tw = j.tw; th = j.th;
        if ((x < x0 || y >= y0 + TRONC) && tw <= c.tc && th <= c.tc) continue;
        e.vide = false;
        k = num - ja; im = k;
        if (j.anims[k]) { im = J.imageA(j, k, t); p = J.prochain(j, k, t); if (p < e.prochain) e.prochain = p; }
        dw = Math.max(1, Math.round(tw * r / c.tc)); dh = Math.max(1, Math.round(th * r / c.tc));
        dx0 = (x - x0) * r; dy0 = (y - y0 + 1) * r - dh;
        src = j.pix; jw = j.w; sx0 = (im % j.cols) * tw; sy0 = Math.floor(im / j.cols) * th;
        hf = v & M.RET_H; vf = v & M.RET_V; df = v & M.RET_D;
        if (dw > colU.length || dh > ligV.length) continue;
        // Avec la transposition, l'axe horizontal de l'écran lit l'axe vertical de la tuile.
        for (px = 0; px < dw; px++) { u = Math.floor((px + 0.5) * (df ? th : tw) / dw); colU[px] = hf ? (df ? th : tw) - 1 - u : u; }
        for (py = 0; py < dh; py++) { u = Math.floor((py + 0.5) * (df ? tw : th) / dh); ligV[py] = vf ? (df ? tw : th) - 1 - u : u; }
        for (py = 0; py < dh; py++) {
          Y = dy0 + py;
          if (Y < 0 || Y >= n) continue;
          sv = ligV[py]; q = Y * n;
          for (px = 0; px < dw; px++) {
            X = dx0 + px;
            if (X < 0 || X >= n) continue;
            su = colU[px];
            col = df ? src[(sy0 + su) * jw + sx0 + sv] : src[(sy0 + sv) * jw + sx0 + su];
            a = col >>> 24;
            if (a === 255) out[q + X] = col;
            else if (a) {
              d = out[q + X]; da = d >>> 24;
              if (!da) out[q + X] = col;
              else {
                ka = da * (255 - a) / 255; oa = a + ka;
                out[q + X] = ((Math.round(oa) << 24) | (Math.round(((col >>> 16 & 255) * a + (d >>> 16 & 255) * ka) / oa) << 16) | (Math.round(((col >>> 8 & 255) * a + (d >>> 8 & 255) * ka) / oa) << 8) | Math.round(((col & 255) * a + (d & 255) * ka) / oa)) >>> 0;
              }
            }
          }
        }
      }
    }
    if (e.toile.width !== n) e.toile.width = e.toile.height = n;
    ctx = e.toile.getContext('2d');
    if (!e.vide || e.peint) ctx.putImageData(tp.im, 0, 0);
    e.peint = !e.vide;
  }

  function peindre(cal, cx, cy, r, t, e) {
    var c = M.carte, n = TRONC * r, ctx, x, y, v, x0 = cx * TRONC, y0 = cy * TRONC, xb = Math.min(c.w, x0 + TRONC), yb = Math.min(c.h, y0 + TRONC);
    if (cal.type === 'tuiles') { peindreTuiles(cal, cx, cy, r, t, e); return; }
    if (e.toile.width !== n) e.toile.width = e.toile.height = n;
    ctx = e.toile.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, n, n);
    ctx.imageSmoothingEnabled = false;
    e.r = r; e.sale = false; e.prochain = Infinity; e.vide = true;
    for (y = y0; y < yb; y++) {
      for (x = x0; x < xb; x++) {
        v = cal.cases[y * c.w + x];
        if (!v) continue;
        e.vide = false;
        U.dessinerCollision(ctx, v, (x - x0) * r, (y - y0) * r, r);
      }
    }
  }

  function troncon(cal, cx, cy, r, t) {
    var m = caches.get(cal.id), k = cy * 64 + cx, e;
    if (!m) caches.set(cal.id, m = new Map());
    e = m.get(k);
    if (!e) { e = { toile: document.createElement('canvas'), r: 0, sale: true, prochain: Infinity, vide: true }; m.set(k, e); }
    if (e.sale || e.r !== r || e.prochain <= t) peindre(cal, cx, cy, r, t, e);
    e.vu = image;
    return e;
  }

  function salir(cal, x, y) {
    var m = caches.get(cal.id), cx, cy, e, tu = cal.type === 'tuiles';
    var cxa = Math.floor(x / TRONC), cxb = Math.floor((x + (tu ? debX : 0)) / TRONC), cya = Math.floor((y - (tu ? debY : 0)) / TRONC), cyb = Math.floor(y / TRONC);
    if (m) for (cy = cya; cy <= cyb; cy++) for (cx = cxa; cx <= cxb; cx++) { e = m.get(cy * 64 + cx); if (e) e.sale = true; }
    miniSale = true;
    U.demander();
  }

  U.toutRepeindre = function () {
    var c = M.carte;
    caches = new Map();
    debX = debY = 0;
    c.jeux.forEach(function (j) { debX = Math.max(debX, Math.ceil(j.tw / c.tc) - 1); debY = Math.max(debY, Math.ceil(j.th / c.tc) - 1); });
    miniSale = true;
    U.demander();
  };

  // ---------- Dessin ----------
  function damier(ppt) {
    var c, x;
    if (motifDamier && motifPpt === ppt) return motifDamier;
    c = document.createElement('canvas');
    c.width = c.height = ppt * 2;
    x = c.getContext('2d');
    x.fillStyle = DAMIER[0]; x.fillRect(0, 0, ppt * 2, ppt * 2);
    x.fillStyle = DAMIER[1]; x.fillRect(ppt, 0, ppt, ppt); x.fillRect(0, ppt, ppt, ppt);
    motifPpt = ppt;
    return (motifDamier = g.createPattern(c, 'repeat'));
  }

  // Écart entre deux graduations numérotées : assez large pour loger un nombre.
  function pasRegle() {
    var pas = [1, 2, 5, 10, 20, 50, 100], k;
    for (k = 0; k < pas.length; k++) if (pas[k] * U.ppt >= 30 * D) return pas[k];
    return 200;
  }

  function dessinerObjets(cal) {
    var k = U.ppt / M.carte.tc, sel = U.objSel, actif = M.calqueActif() === cal;
    g.font = '600 ' + Math.round(11 * D) + 'px "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    cal.objets.forEach(function (o) {
      var x = Math.round(U.ox + o.x * k), y = Math.round(U.oy + o.y * k), w = Math.round(o.w * k), h = Math.round(o.h * k), t = Math.round(5 * D), nom = o.nom || o.type, lw, choisi = sel === o.id && actif;
      g.lineWidth = Math.max(1, Math.round(1.5 * D));
      if (o.w || o.h) {
        g.fillStyle = choisi ? 'rgba(92,184,200,.3)' : 'rgba(92,184,200,.16)';
        g.fillRect(x, y, w, h);
        g.strokeStyle = TRAIT; g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
        g.strokeStyle = choisi ? '#fff' : CYAN; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        if (choisi) [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(function (p) { g.fillStyle = TRAIT; g.fillRect(p[0] - t, p[1] - t, 2 * t, 2 * t); g.fillStyle = '#fff'; g.fillRect(p[0] - t + D, p[1] - t + D, 2 * t - 2 * D, 2 * t - 2 * D); });
      } else {
        g.beginPath(); g.moveTo(x, y - t - 2); g.lineTo(x + t + 2, y); g.lineTo(x, y + t + 2); g.lineTo(x - t - 2, y); g.closePath();
        g.fillStyle = choisi ? '#fff' : CYAN; g.fill();
        g.strokeStyle = TRAIT; g.stroke();
      }
      if (nom && U.ppt >= 8 * D) {
        lw = Math.ceil(g.measureText(nom).width) + Math.round(8 * D);
        y = (o.w || o.h ? y : y - t - 2) - Math.round(17 * D);
        x = o.w || o.h ? x : x - (lw >> 1);
        g.fillStyle = choisi ? '#fff' : CYAN; g.fillRect(x, y, lw, Math.round(15 * D));
        g.fillStyle = '#0f2226'; g.fillText(nom, x + Math.round(4 * D), y + Math.round(8 * D));
      }
    });
  }

  function dessinerGrille(xa, ya, xb, yb) {
    var c = M.carte, pas = GRILLE_FORTE, x, y, X0 = Math.max(xa, U.ox), Y0 = Math.max(ya, U.oy), X1 = Math.min(xb, U.ox + c.w * U.ppt), Y1 = Math.min(yb, U.oy + c.h * U.ppt);
    for (x = Math.max(0, Math.floor((xa - U.ox) / U.ppt)); x <= c.w && U.ox + x * U.ppt <= xb; x++) {
      if (x % pas === 0) g.fillStyle = 'rgba(255,255,255,.26)'; else if (U.ppt >= 6 * D) g.fillStyle = 'rgba(0,0,0,.2)'; else continue;
      g.fillRect(U.ox + x * U.ppt, Y0, 1, Y1 - Y0);
    }
    for (y = Math.max(0, Math.floor((ya - U.oy) / U.ppt)); y <= c.h && U.oy + y * U.ppt <= yb; y++) {
      if (y % pas === 0) g.fillStyle = 'rgba(255,255,255,.26)'; else if (U.ppt >= 6 * D) g.fillStyle = 'rgba(0,0,0,.2)'; else continue;
      g.fillRect(X0, U.oy + y * U.ppt, X1 - X0, 1);
    }
  }

  // Les règles graduent la carte en cases ; la case survolée y est reportée sur les deux axes.
  function dessinerRegles(r) {
    var c = M.carte, pas = pasRegle(), x, y, p, s = U.survol && U.dansCarte(U.survol) ? U.survol : null, txt;
    g.fillStyle = BANDE; g.fillRect(0, 0, L, r); g.fillRect(0, 0, r, H);
    g.font = Math.round(10.5 * D) + 'px Bahnschrift, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    if (s) {
      g.fillStyle = AMBRE;
      g.fillRect(Math.max(r, U.ox + s.x * U.ppt), 0, U.ppt, r);
      g.fillRect(0, Math.max(r, U.oy + s.y * U.ppt), r, U.ppt);
    }
    for (x = Math.max(0, Math.floor((r - U.ox) / U.ppt)); x <= c.w && (p = U.ox + x * U.ppt) < L; x++) {
      if (p < r) continue;
      if (x % pas) { if (U.ppt >= 5 * D) { g.fillStyle = PALE; g.fillRect(p, r - Math.round(4 * D), 1, Math.round(4 * D)); } continue; }
      g.fillStyle = PALE; g.fillRect(p, Math.round(r / 2), 1, r - Math.round(r / 2));
      if (x < c.w) { g.fillStyle = s && s.x === x ? '#1c1c1e' : DOUX; g.textAlign = 'left'; g.fillText(String(x), p + Math.round(3 * D), Math.round(r * 0.45)); }
    }
    for (y = Math.max(0, Math.floor((r - U.oy) / U.ppt)); y <= c.h && (p = U.oy + y * U.ppt) < H; y++) {
      if (p < r) continue;
      if (y % pas) { if (U.ppt >= 5 * D) { g.fillStyle = PALE; g.fillRect(r - Math.round(4 * D), p, Math.round(4 * D), 1); } continue; }
      g.fillStyle = PALE; g.fillRect(Math.round(r / 2), p, r - Math.round(r / 2), 1);
      if (y < c.h) {
        g.save(); g.translate(Math.round(r * 0.45), p + Math.round(3 * D)); g.rotate(-Math.PI / 2);
        g.fillStyle = s && s.y === y ? '#1c1c1e' : DOUX; g.textAlign = 'right'; g.fillText(String(y), 0, 0);
        g.restore();
      }
    }
    // Hors de la graduation, la case survolée s'écrit en clair sur sa marque.
    if (s && pas > 1 && U.ppt * pas > 0) {
      txt = String(s.x); g.textAlign = 'left';
      if (s.x % pas) { p = U.ox + s.x * U.ppt; if (p >= r) { x = Math.ceil(g.measureText(txt).width) + Math.round(6 * D); g.fillStyle = AMBRE; g.fillRect(p, 0, Math.max(U.ppt, x), r); g.fillStyle = '#1c1c1e'; g.fillText(txt, p + Math.round(3 * D), Math.round(r * 0.45)); } }
      txt = String(s.y);
      if (s.y % pas) { p = U.oy + s.y * U.ppt; if (p >= r) { x = Math.ceil(g.measureText(txt).width) + Math.round(6 * D); g.fillStyle = AMBRE; g.fillRect(0, p, r, Math.max(U.ppt, x)); g.save(); g.translate(Math.round(r * 0.45), p + Math.round(3 * D)); g.rotate(-Math.PI / 2); g.fillStyle = '#1c1c1e'; g.textAlign = 'right'; g.fillText(txt, 0, 0); g.restore(); } }
    }
    g.fillStyle = BANDE; g.fillRect(0, 0, r, r);
    g.fillStyle = TRAIT; g.fillRect(r - 1, 0, 1, H); g.fillRect(0, r - 1, L, 1);
    g.textAlign = 'left';
  }

  // Encadre un rectangle de cases : liseré sombre, trait clair, pointillé.
  U.cadre = function (x, y, w, h, couleur) {
    var X = U.ox + x * U.ppt, Y = U.oy + y * U.ppt, W = w * U.ppt, Hh = h * U.ppt, e = Math.max(1, Math.round(D));
    g.fillStyle = 'rgba(0,0,0,.75)';
    g.fillRect(X - e, Y - e, W + 2 * e, e); g.fillRect(X - e, Y + Hh, W + 2 * e, e); g.fillRect(X - e, Y, e, Hh); g.fillRect(X + W, Y, e, Hh);
    g.fillStyle = couleur || '#fff';
    g.fillRect(X, Y, W, e); g.fillRect(X, Y + Hh - e, W, e); g.fillRect(X, Y, e, Hh); g.fillRect(X + W - e, Y, e, Hh);
  };
  U.contexte = function () { return g; };

  function dessiner() {
    var c = M.carte, r = regle(), t, rc, cx, cy, cxa, cxb, cya, cyb, e, n = 0, pas, W = c.w * U.ppt, Hh = c.h * U.ppt;
    demande = false;
    if (!c || !L) return;
    t = U.anime && U.ppt >= ANIM_MIN ? performance.now() : 0;
    rc = Math.min(U.ppt, c.tc);
    pas = TRONC * U.ppt;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = false;
    g.fillStyle = FOND; g.fillRect(0, 0, L, H);
    g.save();
    g.beginPath(); g.rect(r, r, L - r, H - r); g.clip();
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(U.ox + Math.round(3 * D), U.oy + Math.round(3 * D), W, Hh);
    if (!c.fond && U.ppt >= 4) { g.fillStyle = damier(U.ppt); g.translate(U.ox, U.oy); g.fillRect(0, 0, W, Hh); g.translate(-U.ox, -U.oy); }
    else { g.fillStyle = c.fond || DAMIER[0]; g.fillRect(U.ox, U.oy, W, Hh); }
    cxa = Math.max(0, Math.floor((r - U.ox) / pas)); cxb = Math.min(Math.ceil(c.w / TRONC) - 1, Math.floor((L - 1 - U.ox) / pas));
    cya = Math.max(0, Math.floor((r - U.oy) / pas)); cyb = Math.min(Math.ceil(c.h / TRONC) - 1, Math.floor((H - 1 - U.oy) / pas));
    prochainChangement = Infinity;
    c.calques.forEach(function (cal) {
      if (!cal.visible || cal.opacite <= 0) return;
      if (U.essai && cal.type !== 'tuiles' && !U.essai.reperes) return;
      g.globalAlpha = cal.opacite;
      if (cal.type === 'objets') { dessinerObjets(cal); return; }
      for (cy = cya; cy <= cyb; cy++) {
        for (cx = cxa; cx <= cxb; cx++) {
          e = troncon(cal, cx, cy, rc, t);
          if (e.prochain < prochainChangement) prochainChangement = e.prochain;
          if (!e.vide) g.drawImage(e.toile, U.ox + cx * pas, U.oy + cy * pas, pas, pas);
        }
      }
    });
    g.globalAlpha = 1;
    // Trop de tronçons gardés : ceux qui ne sont plus à l'écran sont jetés.
    caches.forEach(function (m) { n += m.size; });
    if (n > TRONCS_MAX) caches.forEach(function (m) { m.forEach(function (e, k) { if (e.vu !== image) m.delete(k); }); });
    image++;
    if (U.essai) { if (U.dessinerEssai) U.dessinerEssai(g, D); g.restore(); return; }
    if (U.grille) dessinerGrille(r, r, L, H);
    if (M.sel) U.cadre(M.sel.x, M.sel.y, M.sel.w, M.sel.h, '#fff');
    if (U.apercuOutil) U.apercuOutil(g, t, D);
    g.restore();
    if (r) dessinerRegles(r);
    if (miniSale && !minuterieMini) minuterieMini = setTimeout(dessinerMini, DELAI_MINI);
    placerMiniVue();
  }

  U.demander = function () {
    if (demande) return;
    demande = true;
    requestAnimationFrame(dessiner);
  };
  U.dessinerTout = dessiner;

  // ---------- Mini-carte ----------
  // Un pixel par case : la couleur moyenne de la tuile visible la plus haute.
  function dessinerMini() {
    var c = M.carte, mini = $('#mini'), ctx, im, pix, i, n = c.w * c.h, k, cal, v, j, coul, vide = 0xff504b4b, cadre = $('#miniCadre'), ech;
    minuterieMini = null;
    miniSale = false;
    cadre.hidden = !U.mini || !!U.essai;
    if (cadre.hidden) return;
    if (mini.width !== c.w || mini.height !== c.h) { mini.width = c.w; mini.height = c.h; }
    ech = Math.min(MINI_MAX[0] / c.w, MINI_MAX[1] / c.h);
    mini.style.width = Math.round(c.w * ech) + 'px'; mini.style.height = Math.round(c.h * ech) + 'px';
    ctx = mini.getContext('2d');
    im = ctx.createImageData(c.w, c.h);
    pix = new Uint32Array(im.data.buffer);
    pix.fill(vide);
    for (k = 0; k < c.calques.length; k++) {
      cal = c.calques[k];
      if (cal.type !== 'tuiles' || !cal.visible) continue;
      for (i = 0; i < n; i++) {
        v = cal.cases[i] & M.NUMERO;
        if (!v) continue;
        j = M.jeuDe(v);
        coul = j ? j.moyennes[v - j.premier] : 0;
        if (coul) pix[i] = coul;
      }
    }
    ctx.putImageData(im, 0, 0);
    placerMiniVue();
  }

  function placerMiniVue() {
    var c = M.carte, mini = $('#mini'), v = $('#miniVue'), r = regle(), kx, ky, x0, y0, x1, y1;
    if ($('#miniCadre').hidden) return;
    kx = parseFloat(mini.style.width) / c.w; ky = parseFloat(mini.style.height) / c.h;
    x0 = Math.max(0, (r - U.ox) / U.ppt); y0 = Math.max(0, (r - U.oy) / U.ppt);
    x1 = Math.min(c.w, (L - U.ox) / U.ppt); y1 = Math.min(c.h, (H - U.oy) / U.ppt);
    // Quand toute la carte est à l'écran, la mini-carte ne sert à rien : elle s'efface.
    $('#miniCadre').classList.toggle('inutile', x0 <= 0 && y0 <= 0 && x1 >= c.w && y1 >= c.h);
    v.style.left = Math.round(x0 * kx) + 'px'; v.style.top = Math.round(y0 * ky) + 'px';
    v.style.width = Math.max(2, Math.round((x1 - x0) * kx)) + 'px'; v.style.height = Math.max(2, Math.round((y1 - y0) * ky)) + 'px';
  }

  U.rafraichirMini = function () { miniSale = true; if (minuterieMini) { clearTimeout(minuterieMini); minuterieMini = null; } dessinerMini(); };

  function viserMini(e) {
    var mini = $('#mini'), r = mini.getBoundingClientRect(), c = M.carte;
    U.centrerSur((e.clientX - r.left) / r.width * c.w, (e.clientY - r.top) / r.height * c.h);
  }

  // ---------- Mise en place ----------
  U.ajusterToile = function () {
    var w = scene.clientWidth, h = scene.clientHeight;
    D = window.devicePixelRatio || 1;
    L = Math.max(1, Math.round(w * D)); H = Math.max(1, Math.round(h * D));
    if (toile.width !== L || toile.height !== H) { toile.width = L; toile.height = H; }
    toile.style.width = w + 'px'; toile.style.height = h + 'px';
    motifDamier = null;
    bornerVue();
    dessiner();
  };
  U.tailleToile = function () { return { l: L, h: H, regle: regle() }; };

  U.initVue = function () {
    var cadre = $('#miniCadre'), tenu = false;
    scene = $('#scene'); toile = $('#toile');
    g = toile.getContext('2d');
    M.surCase = salir;
    M.surStructure = function () { U.toutRepeindre(); };
    window.addEventListener('resize', U.ajusterToile);
    cadre.addEventListener('pointerdown', function (e) { if (e.button) return; tenu = true; cadre.setPointerCapture(e.pointerId); viserMini(e); e.preventDefault(); e.stopPropagation(); });
    cadre.addEventListener('pointermove', function (e) { if (tenu) viserMini(e); });
    cadre.addEventListener('pointerup', function () { tenu = false; });
    cadre.addEventListener('pointercancel', function () { tenu = false; });
    // Les animations ne redessinent la carte qu'au moment où une image change.
    setInterval(function () {
      if (U.essai || document.hidden) return;
      if (U.anime && prochainChangement <= performance.now()) U.demander();
      if (U.tic) U.tic();
    }, 40);
  };
})();
