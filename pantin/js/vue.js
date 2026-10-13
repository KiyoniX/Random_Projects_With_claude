(function () {
  'use strict';

  var P = window.Pantin;

  var ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48];
  var MARGE = 64;                 // ce qu'on voit du plan autour du cadre, en pixels du sprite
  var TAPIS = '#2a2b2d', TRAIT = '#333437', TRAIT_FIN = '#2f3033';
  var LAITON = '#d2ab52', LAITON_SOMBRE = '#6a4f1c', LAITON_CLAIR = '#f3dfa2';
  var AVANT = '#e2665a', APRES = '#5aa0e2';   // pelure d'oignon : l'image d'avant en rouge, celle d'après en bleu

  var $ = function (s) { return document.querySelector(s); };
  function icone(d) { return '<svg viewBox="0 0 20 20">' + d + '</svg>'; }

  // L'état de l'interface. mode : decoupe, montage ou animation. sel : pièce choisie (0 : aucune). f : image en cours.
  var U = P.ui = {
    mode: 'animation', outil: 'tourner', sel: 0, f: 0, z: 8, cx: 0, cy: 0,
    masque: null, oignon: false, attaches: true, cran: 0, espace: false, joue: false
  };

  var MAIN = { id: 'main', nom: 'Main', touche: 'h', svg: '<path d="M6 11V5.5a1.2 1.2 0 0 1 2.4 0V10M8.4 9V4a1.2 1.2 0 0 1 2.4 0v5M10.8 9V5a1.2 1.2 0 0 1 2.4 0v5M13.2 10V7a1.2 1.2 0 0 1 2.4 0v5c0 3-2 5-5 5s-4-1.4-5.4-4L4 10.6a1.2 1.2 0 0 1 2-1.2"/>', astuce: 'Glisse pour déplacer la vue. Espace maintenu ou clic milieu font la même chose avec n\'importe quel outil.' };
  U.OUTILS = {
    decoupe: [
      { id: 'baguette', nom: 'Baguette', touche: 'b', svg: '<path d="M4 16 12 8"/><path d="M13.5 2.5v3M13.5 9v2M10 6.5h2M15 6.5h2.5M11 4l1 1M16 4l-1 1M16 9l-1-1"/>', astuce: 'Clique un morceau : tous ses pixels qui se touchent sont pris. Maj ajoute, Alt retire. Entrée détache la pièce.' },
      { id: 'rect', nom: 'Rectangle', touche: 'r', svg: '<rect x="3.5" y="4.5" width="13" height="11" stroke-dasharray="2.4 2"/>', astuce: 'Trace un rectangle autour d\'un morceau. Maj ajoute, Alt retire. Entrée détache la pièce.' },
      { id: 'lasso', nom: 'Lasso', touche: 'l', svg: '<path d="M10 4c4 0 7 1.8 7 4.2S14 12.5 10 12.5 3 10.6 3 8.2 6 4 10 4z" stroke-dasharray="2.4 2"/><path d="M6.5 12c-1.5 1-1.6 2.6-.2 3s2.200-.8 1.200-2"/>', astuce: 'Entoure à main levée la partie à découper, pour séparer un membre du reste du dessin. Entrée détache la pièce.' },
      MAIN
    ],
    montage: [
      { id: 'deplacer', nom: 'Placer', touche: 'v', svg: '<path d="M10 2.5v15M2.5 10h15M10 2.500 7.800 4.700M10 2.500l2.200 2.200M10 17.500l-2.200-2.200M10 17.500l2.200-2.200M2.500 10l2.200-2.200M2.500 10l2.200 2.200M17.500 10l-2.200-2.200M17.500 10l-2.200 2.200"/>', astuce: 'Glisse une pièce pour la mettre à sa place au repos. Les pièces qu\'elle tient la suivent.' },
      { id: 'attache', nom: 'Attache', touche: 'a', svg: '<circle cx="10" cy="7" r="4.200"/><path d="M10 3v8M8.800 11 7 17.500M11.200 11 13 17.500"/>', astuce: 'Clique sur une pièce l\'endroit où elle est épinglée : c\'est le point autour duquel elle tournera.' },
      { id: 'lier', nom: 'Tenir', touche: 'l', svg: '<circle cx="5.500" cy="14.500" r="2.500"/><circle cx="14.500" cy="5.500" r="2.500"/><path d="M7.300 12.700 12.700 7.300"/>', astuce: 'Glisse d\'une pièce vers celle qui la tient (la main vers l\'avant-bras, l\'avant-bras vers le bras). Lâche dans le vide pour la libérer.' },
      MAIN
    ],
    animation: [
      { id: 'tourner', nom: 'Tourner', touche: 'r', svg: '<path d="M15.500 10a5.500 5.500 0 1 1-2-4.200"/><path d="M13.800 2.800v3.200h-3.200"/><circle class="plein" cx="10" cy="10" r="1.300"/>', astuce: 'Glisse une pièce pour la faire tourner autour de son attache : une clé se pose toute seule à l\'image en cours. Maj : crans de 15°.' },
      { id: 'deplacer', nom: 'Décaler', touche: 'v', svg: '<path d="M10 2.500v15M2.500 10h15M10 2.500 7.800 4.700M10 2.500l2.200 2.200M10 17.500l-2.200-2.200M10 17.500l2.200-2.200M2.500 10l2.200-2.200M2.500 10l2.200 2.200M17.500 10l-2.200-2.200M17.500 10l-2.200 2.200"/>', astuce: 'Glisse une pièce pour la décaler à cette image (un saut, un pas, un étirement). Une clé se pose toute seule.' },
      MAIN
    ]
  };
  var dernier = { decoupe: 'baguette', montage: 'deplacer', animation: 'tourner' };

  var scene, toile, g, geste = null, demande = false, revMasque = 0;

  // ---------- Vue ----------
  // L'image que montre la scène : la pose de repos pendant le montage.
  U.image = function () { return U.mode === 'montage' ? -1 : U.f; };
  function etendue() {
    var d = P.doc;
    return U.mode === 'decoupe' ? { w: d.planche.w, h: d.planche.h } : { w: d.w, h: d.h };
  }

  U.redessiner = function () {
    if (demande) return;
    demande = true;
    requestAnimationFrame(function () { demande = false; dessiner(); });
  };

  U.ajuster = function () {
    var e = etendue(), W = scene.clientWidth, H = scene.clientHeight, z = ZOOMS[0], i;
    for (i = 0; i < ZOOMS.length; i++) if (e.w * ZOOMS[i] <= W - 70 && e.h * ZOOMS[i] <= H - 70) z = ZOOMS[i];
    U.z = z; U.cx = Math.round((W - e.w * z) / 2); U.cy = Math.round((H - e.h * z) / 2);
    U.redessiner();
  };

  // Change le zoom en gardant sous le curseur le point du plan qui s'y trouve.
  function zoomer(z, sx, sy) {
    var x = (sx - U.cx) / U.z, y = (sy - U.cy) / U.z;
    U.z = z; U.cx = Math.round(sx - x * z); U.cy = Math.round(sy - y * z);
    U.redessiner();
  }
  U.zoomPas = function (sens, sx, sy) {
    var i = ZOOMS.indexOf(U.z), j = P.borne((i < 0 ? 6 : i) + sens, 0, ZOOMS.length - 1);
    if (sx === undefined) { sx = scene.clientWidth / 2; sy = scene.clientHeight / 2; }
    zoomer(ZOOMS[j], sx, sy);
  };

  function plan(e) {
    var r = scene.getBoundingClientRect();
    return { x: (e.clientX - r.left - U.cx) / U.z, y: (e.clientY - r.top - U.cy) / U.z, sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  // ---------- Images calculées ----------
  function versToile(pix, w, h, teinte) {
    var c = document.createElement('canvas'), k = c.getContext('2d'), im;
    c.width = w; c.height = h;
    im = k.createImageData(w, h);
    new Uint32Array(im.data.buffer).set(pix);
    k.putImageData(im, 0, 0);
    if (teinte) { k.globalCompositeOperation = 'source-in'; k.fillStyle = teinte; k.fillRect(0, 0, w, h); }
    return c;
  }
  U.versToile = versToile;

  var caches = {};
  function memo(nom, cle, calcul) {
    var c = caches[nom];
    if (!c || c.cle !== cle) c = caches[nom] = { cle: cle, v: calcul() };
    return c.v;
  }
  function zone(f, teinte) {
    var d = P.doc;
    return versToile(P.composer(f, -MARGE, -MARGE, d.w + 2 * MARGE, d.h + 2 * MARGE), d.w + 2 * MARGE, d.h + 2 * MARGE, teinte);
  }
  var damier = null;
  function motif() {
    var c, k;
    if (damier) return damier;
    c = document.createElement('canvas'); c.width = c.height = 16; k = c.getContext('2d');
    k.fillStyle = '#8a8a8a'; k.fillRect(0, 0, 16, 16);
    k.fillStyle = '#6e6e6e'; k.fillRect(8, 0, 8, 8); k.fillRect(0, 8, 8, 8);
    return (damier = g.createPattern(c, 'repeat'));
  }

  // ---------- Dessin ----------
  function tapis(W, H) {
    var pas = 8 * U.z, x, y;
    g.fillStyle = TAPIS; g.fillRect(0, 0, W, H);
    // Le quadrillage du tapis de découpe : un trait tous les 8 pixels du sprite, et chaque pixel de très près.
    if (U.z >= 12) {
      g.fillStyle = TRAIT_FIN;
      for (x = ((U.cx % U.z) + U.z) % U.z; x < W; x += U.z) g.fillRect(x, 0, 1, H);
      for (y = ((U.cy % U.z) + U.z) % U.z; y < H; y += U.z) g.fillRect(0, y, W, 1);
    }
    if (pas >= 16) {
      g.fillStyle = TRAIT;
      for (x = ((U.cx % pas) + pas) % pas; x < W; x += pas) g.fillRect(x, 0, 1, H);
      for (y = ((U.cy % pas) + pas) % pas; y < H; y += pas) g.fillRect(0, y, W, 1);
    }
  }

  function tete(x, y, r, choisie) {
    g.beginPath(); g.arc(x, y, r, 0, 6.2832);
    g.fillStyle = LAITON; g.fill();
    g.lineWidth = choisie ? 2 : 1; g.strokeStyle = choisie ? '#fff' : LAITON_SOMBRE; g.stroke();
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, 6.2832); g.fillStyle = LAITON_CLAIR; g.fill();
    g.beginPath(); g.moveTo(x, y - r + 1.5); g.lineTo(x, y + r - 1.5); g.lineWidth = 1; g.strokeStyle = LAITON_SOMBRE; g.stroke();
  }

  function cadre(x, y, w, h, texte) {
    g.strokeStyle = 'rgba(220, 220, 222, .75)'; g.lineWidth = 1;
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    g.fillStyle = '#909197'; g.font = '11px "Segoe UI", sans-serif'; g.textBaseline = 'top';
    g.fillText(texte, x, y + h + 5);
  }

  function dessinerPlanche() {
    var d = P.doc, pl = d.planche, z = U.z, im = memo('planche', pl, function () { return versToile(pl.pix, pl.w, pl.h); });
    g.fillStyle = motif(); g.fillRect(U.cx, U.cy, pl.w * z, pl.h * z);
    g.drawImage(im, U.cx, U.cy, pl.w * z, pl.h * z);
    cadre(U.cx, U.cy, pl.w * z, pl.h * z, 'Planche de ' + pl.w + ' × ' + pl.h + ' px');
    // Les pièces déjà détachées, là où elles ont été prises.
    d.pieces.forEach(function (p) {
      var choisie = p.id === U.sel;
      g.setLineDash(choisie ? [] : [3, 3]); g.lineWidth = choisie ? 2 : 1;
      g.strokeStyle = choisie ? LAITON : 'rgba(255, 255, 255, .55)';
      g.strokeRect(U.cx + p.sx * z + 0.5, U.cy + p.sy * z + 0.5, p.w * z - 1, p.h * z - 1);
    });
    g.setLineDash([]);
    if (U.masque) {
      g.drawImage(memo('masque', revMasque, function () {
        var pix = new Uint32Array(pl.w * pl.h), i;
        for (i = 0; i < pix.length; i++) if (U.masque[i]) pix[i] = pl.pix[i] ? 0xb452abd2 : 0x4052abd2;
        return versToile(pix, pl.w, pl.h);
      }), U.cx, U.cy, pl.w * z, pl.h * z);
    }
    if (geste && geste.type === 'rect') {
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.setLineDash([4, 3]);
      g.strokeRect(U.cx + Math.min(geste.x0, geste.x1) * z + 0.5, U.cy + Math.min(geste.y0, geste.y1) * z + 0.5, (Math.abs(geste.x1 - geste.x0) + 1) * z - 1, (Math.abs(geste.y1 - geste.y0) + 1) * z - 1);
      g.setLineDash([]);
    }
    if (geste && geste.type === 'lasso') {
      g.beginPath();
      geste.pts.forEach(function (q, i) { g[i ? 'lineTo' : 'moveTo'](U.cx + q.x * z, U.cy + q.y * z); });
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
    }
  }

  function dessinerPantin() {
    var d = P.doc, z = U.z, f = U.image(), an = P.anim(), W = (d.w + 2 * MARGE) * z, H = (d.h + 2 * MARGE) * z, ox = U.cx - MARGE * z, oy = U.cy - MARGE * z;
    var mats = P.matrices(f), cle = P.rev + ':' + f + ':' + d.iAnim, av, ap;
    function S(m, u, v, p) { return [U.cx + (m[0] * (u - p.px) + m[2] * (v - p.py) + m[4]) * z, U.cy + (m[1] * (u - p.px) + m[3] * (v - p.py) + m[5]) * z]; }

    g.fillStyle = motif(); g.fillRect(U.cx, U.cy, d.w * z, d.h * z);
    if (U.oignon && U.mode === 'animation' && an.n > 1) {
      av = f > 0 ? f - 1 : an.boucle ? an.n - 1 : -1; ap = f < an.n - 1 ? f + 1 : an.boucle ? 0 : -1;
      g.globalAlpha = 0.34;
      if (av >= 0) g.drawImage(memo('avant', cle, function () { return zone(av, AVANT); }), ox, oy, W, H);
      if (ap >= 0 && ap !== av) g.drawImage(memo('apres', cle, function () { return zone(ap, APRES); }), ox, oy, W, H);
      g.globalAlpha = 1;
    }
    // Ce qui dépasse du cadre reste visible, en plus pâle : il ne sera pas dans l'image exportée.
    var im = memo('pantin', cle, function () { return zone(f); });
    g.globalAlpha = 0.3; g.drawImage(im, ox, oy, W, H); g.globalAlpha = 1;
    g.save(); g.beginPath(); g.rect(U.cx, U.cy, d.w * z, d.h * z); g.clip(); g.drawImage(im, ox, oy, W, H); g.restore();
    cadre(U.cx, U.cy, d.w * z, d.h * z, 'Cadre de ' + d.w + ' × ' + d.h + ' px' + (U.mode === 'montage' ? ', pose de repos' : ', image ' + (U.f + 1) + ' sur ' + an.n));

    if (!U.attaches && !U.sel) return;
    // Le fil qui va de l'attache d'une pièce à celle de la pièce qui la tient.
    if (U.attaches) {
      g.strokeStyle = 'rgba(255, 255, 255, .5)'; g.lineWidth = 1; g.beginPath();
      d.pieces.forEach(function (p) {
        var m = mats[p.id], mm = p.parent && mats[p.parent];
        if (!mm || !p.visible) return;
        g.moveTo(U.cx + mm[4] * z, U.cy + mm[5] * z); g.lineTo(U.cx + m[4] * z, U.cy + m[5] * z);
      });
      g.stroke();
    }
    d.pieces.forEach(function (p) {
      var m = mats[p.id], q;
      if (p.id !== U.sel) return;
      g.beginPath();
      [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]].forEach(function (c, i) { q = S(m, c[0], c[1], p); g[i ? 'lineTo' : 'moveTo'](q[0], q[1]); });
      g.closePath(); g.strokeStyle = LAITON; g.lineWidth = 1.5; g.stroke();
    });
    d.pieces.forEach(function (p) {
      var m = mats[p.id];
      if (!p.visible || (!U.attaches && p.id !== U.sel)) return;
      tete(U.cx + m[4] * z, U.cy + m[5] * z, p.id === U.sel ? 6 : 4.5, p.id === U.sel);
    });
    if (geste && geste.type === 'lier' && geste.bouge) {
      g.beginPath(); g.moveTo(U.cx + mats[geste.p.id][4] * z, U.cy + mats[geste.p.id][5] * z); g.lineTo(geste.sx, geste.sy);
      g.strokeStyle = LAITON; g.lineWidth = 2; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
    }
  }

  function dessiner() {
    var dpr = window.devicePixelRatio || 1, W = scene.clientWidth, H = scene.clientHeight;
    if (!W || !H || !P.doc) return;
    if (toile.width !== Math.round(W * dpr) || toile.height !== Math.round(H * dpr)) { toile.width = Math.round(W * dpr); toile.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    tapis(W, H);
    if (U.mode === 'decoupe') dessinerPlanche(); else dessinerPantin();
  }

  // ---------- Découpe ----------
  // Combine un nouveau masque avec la sélection : la remplace, s'y ajoute (Maj) ou s'en retire (Alt).
  function combiner(m, e) {
    var i, reste = false;
    if (U.masque && (e.shiftKey || e.altKey)) {
      for (i = 0; i < m.length; i++) m[i] = e.altKey ? (U.masque[i] && !m[i] ? 1 : 0) : (U.masque[i] || m[i] ? 1 : 0);
    } else if (e.altKey) m.fill(0);
    for (i = 0; i < m.length && !reste; i++) reste = !!m[i];
    U.masque = reste ? m : null; revMasque++;
    U.dire(reste ? 'Sélection prête : Entrée la détache en pièce, Échap l\'abandonne.' : '');
  }

  function baguette(x, y, e) {
    var pl = P.doc.planche, w = pl.w, h = pl.h, m = new Uint8Array(w * h), i = y * w + x, pile, k, px, py, dx, dy, j;
    if (x < 0 || y < 0 || x >= w || y >= h || !pl.pix[i]) { if (!e.shiftKey && !e.altKey) U.abandonner(); return; }
    pile = [i]; m[i] = 1;
    while (pile.length) {
      k = pile.pop(); px = k % w; py = (k - px) / w;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        if (px + dx < 0 || px + dx >= w || py + dy < 0 || py + dy >= h) continue;
        j = k + dy * w + dx;
        if (!m[j] && pl.pix[j]) { m[j] = 1; pile.push(j); }
      }
    }
    combiner(m, e);
  }

  function finRect(geste, e) {
    var pl = P.doc.planche, m = new Uint8Array(pl.w * pl.h), x, y;
    var x0 = Math.max(0, Math.min(geste.x0, geste.x1)), x1 = Math.min(pl.w - 1, Math.max(geste.x0, geste.x1));
    var y0 = Math.max(0, Math.min(geste.y0, geste.y1)), y1 = Math.min(pl.h - 1, Math.max(geste.y0, geste.y1));
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) m[y * pl.w + x] = 1;
    combiner(m, e);
  }

  function finLasso(geste, e) {
    var pl = P.doc.planche, m = new Uint8Array(pl.w * pl.h), pts = geste.pts, n = pts.length, y, yc, i, a, b, xs, k, x;
    if (n < 3) { if (!e.shiftKey && !e.altKey) U.abandonner(); return; }
    for (y = 0; y < pl.h; y++) {
      yc = y + 0.5; xs = [];
      for (i = 0; i < n; i++) {
        a = pts[i]; b = pts[(i + 1) % n];
        if ((a.y <= yc) !== (b.y <= yc)) xs.push(a.x + (yc - a.y) * (b.x - a.x) / (b.y - a.y));
      }
      xs.sort(function (p, q) { return p - q; });
      for (k = 0; k + 1 < xs.length; k += 2) for (x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(pl.w - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * pl.w + x] = 1;
    }
    combiner(m, e);
  }

  U.poserMasque = function (m) { U.masque = m; revMasque++; U.redessiner(); };
  U.abandonner = function () {
    if (!U.masque) return false;
    U.masque = null; revMasque++; U.dire(''); U.redessiner();
    return true;
  };

  // ---------- Gestes ----------
  U.gesteEnCours = function () { return !!geste; };

  // Retient l'état d'avant au premier vrai mouvement, pour qu'un simple clic ne remplisse pas l'historique.
  function entamer() {
    if (!geste.entame) { P.marquer(); geste.entame = true; }
  }

  function bas(e) {
    var q = plan(e), f = U.image(), id, p, m, mm, po;
    if (geste || (e.button !== 0 && e.button !== 1)) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (U.joue) U.lire(false);
    scene.setPointerCapture(e.pointerId);
    if (e.button === 1 || U.espace || U.outil === 'main') {
      geste = { type: 'main', sx: q.sx, sy: q.sy, cx: U.cx, cy: U.cy };
      scene.classList.add('main');
      e.preventDefault();
      return;
    }
    if (U.mode === 'decoupe') {
      if (U.outil === 'baguette') baguette(Math.floor(q.x), Math.floor(q.y), e);
      else if (U.outil === 'rect') geste = { type: 'rect', x0: Math.floor(q.x), y0: Math.floor(q.y), x1: Math.floor(q.x), y1: Math.floor(q.y) };
      else geste = { type: 'lasso', pts: [{ x: q.x, y: q.y }] };
      U.redessiner();
      return;
    }
    id = P.toucher(f, q.x, q.y, Math.max(1, 5 / U.z));
    // L'attache se pose sur la pièce déjà choisie tant qu'on reste à côté d'elle : on peut l'épingler hors du dessin.
    if (U.outil === 'attache' && U.sel && !id) {
      p = P.piece(U.sel); m = P.attacheRepos(p);
      if (q.x >= m.x - p.px - 4 && q.y >= m.y - p.py - 4 && q.x <= m.x - p.px + p.w + 4 && q.y <= m.y - p.py + p.h + 4) id = U.sel;
    }
    U.choisir(id);
    p = P.piece(id);
    if (!p) return;
    m = P.matrices(f);
    if (U.outil === 'attache') { geste = { type: 'attache', p: p }; bouge(e); }
    else if (U.outil === 'lier') geste = { type: 'lier', p: p, sx: q.sx, sy: q.sy, x0: q.sx, y0: q.sy };
    else if (U.mode === 'montage') geste = { type: 'placer', p: p, x: q.x, y: q.y, mx: p.mx, my: p.my };
    else if (U.outil === 'tourner') {
      po = P.pose(id, f);
      geste = { type: 'tourner', p: p, base: po.a, somme: 0, avant: Math.atan2(q.y - m[id][5], q.x - m[id][4]), ax: m[id][4], ay: m[id][5] };
    } else {
      po = P.pose(id, f); mm = p.parent ? m[p.parent] : [1, 0, 0, 1, 0, 0];
      geste = { type: 'decaler', p: p, x: q.x, y: q.y, dx: po.dx, dy: po.dy, mere: mm };
    }
  }

  function bouge(e) {
    var q = plan(e), t = geste, p, a, pas, det, wx, wy, o;
    $('#etatPos').textContent = Math.floor(q.x) + ', ' + Math.floor(q.y);
    if (!t) return;
    p = t.p;
    if (t.type === 'main') { U.cx = t.cx + Math.round(q.sx - t.sx); U.cy = t.cy + Math.round(q.sy - t.sy); }
    else if (t.type === 'rect') { t.x1 = Math.floor(q.x); t.y1 = Math.floor(q.y); }
    else if (t.type === 'lasso') { t.pts.push({ x: q.x, y: q.y }); }
    else if (t.type === 'lier') { t.sx = q.sx; t.sy = q.sy; if (Math.abs(q.sx - t.x0) + Math.abs(q.sy - t.y0) > 5) t.bouge = true; }
    else if (t.type === 'placer') {
      wx = t.mx + Math.round(q.x - t.x); wy = t.my + Math.round(q.y - t.y);
      if (wx === p.mx && wy === p.my) return;
      entamer(); p.mx = wx; p.my = wy; P.rev++;
    } else if (t.type === 'attache') {
      o = P.attacheRepos(p);
      wx = Math.round((q.x - (o.x - p.px)) * 2) / 2; wy = Math.round((q.y - (o.y - p.py)) * 2) / 2;
      if (P.borne(wx, 0, p.w) === p.px && P.borne(wy, 0, p.h) === p.py) return;
      entamer(); P.poserAttache(p, wx, wy); P.rev++;
    } else if (t.type === 'tourner') {
      a = Math.atan2(q.y - t.ay, q.x - t.ax);
      o = a - t.avant; t.avant = a;
      if (o > Math.PI) o -= 2 * Math.PI; else if (o < -Math.PI) o += 2 * Math.PI;
      t.somme += o * 180 / Math.PI;
      pas = e.shiftKey ? 15 : U.cran;
      a = t.base + t.somme;
      a = pas ? Math.round(a / pas) * pas : Math.round(a);
      if (P.cle(p.id, U.f) && P.cle(p.id, U.f).a === a) return;
      entamer(); P.poserCle(p.id, U.f, { a: a }); P.rev++;
    } else if (t.type === 'decaler') {
      // Le glissement se compte dans le repère de la pièce mère, qui peut être tournée.
      det = t.mere[0] * t.mere[3] - t.mere[1] * t.mere[2];
      wx = q.x - t.x; wy = q.y - t.y;
      o = { dx: Math.round(t.dx + (t.mere[3] * wx - t.mere[2] * wy) / det), dy: Math.round(t.dy + (t.mere[0] * wy - t.mere[1] * wx) / det) };
      a = P.cle(p.id, U.f);
      if (a && a.dx === o.dx && a.dy === o.dy) return;
      if (!a && o.dx === t.dx && o.dy === t.dy) return;
      entamer(); P.poserCle(p.id, U.f, o); P.rev++;
    }
    if (t.entame && U.surGeste) U.surGeste();
    U.redessiner();
  }

  function haut(e) {
    var t = geste, q, id;
    if (!t) return;
    geste = null;
    scene.classList.toggle('main', U.espace);
    if (t.type === 'rect') finRect(t, e);
    else if (t.type === 'lasso') finLasso(t, e);
    else if (t.type === 'lier' && t.bouge) {
      q = plan(e);
      id = P.toucher(-1, q.x, q.y, Math.max(1, 5 / U.z));
      if (id === t.p.id) id = t.p.parent;
      if (id && P.descend(id, t.p.id)) U.dire('Impossible : « ' + P.piece(id).nom + ' » est déjà tenue par « ' + t.p.nom + ' ».');
      else if (id !== t.p.parent) {
        P.marquer(); P.lier(t.p, id); t.entame = true;
        U.dire(id ? '« ' + t.p.nom + ' » est tenue par « ' + P.piece(id).nom + ' ».' : '« ' + t.p.nom + ' » n\'est plus tenue par rien.');
      }
    }
    if (t.entame) P.change();
    U.redessiner();
  }

  function molette(e) {
    var q = plan(e);
    e.preventDefault();
    if (e.deltaY) U.zoomPas(e.deltaY < 0 ? 1 : -1, q.sx, q.sy);
  }

  // ---------- Outils et modes ----------
  U.choisirOutil = function (id) {
    var l = U.OUTILS[U.mode], o = l.filter(function (x) { return x.id === id; })[0] || l[0], b = document.querySelectorAll('.outil'), i;
    U.outil = dernier[U.mode] = o.id;
    scene.dataset.outil = o.id;
    for (i = 0; i < b.length; i++) b[i].classList.toggle('actif', b[i].dataset.outil === o.id);
    $('#nomOutil').textContent = o.nom;
    $('#astuce').textContent = o.astuce;
  };

  U.choisirMode = function (mode) {
    var b = document.querySelectorAll('.etape'), i;
    if (!U.OUTILS[mode]) return;
    if (U.joue && mode !== 'animation') U.lire(false);
    U.mode = mode;
    for (i = 0; i < b.length; i++) b[i].classList.toggle('actif', b[i].dataset.mode === mode);
    $('#outils').innerHTML = U.OUTILS[mode].map(function (o) {
      return '<button type="button" class="outil" data-outil="' + o.id + '" title="' + o.nom + ' (' + o.touche.toUpperCase() + ')">' + icone(o.svg) + '</button>';
    }).join('');
    U.choisirOutil(dernier[mode]);
    if (U.rafraichir) U.rafraichir();
    U.ajuster();
  };

  U.initVue = function () {
    scene = $('#scene'); toile = $('#toile'); g = toile.getContext('2d');
    scene.addEventListener('pointerdown', bas);
    scene.addEventListener('pointermove', bouge);
    scene.addEventListener('pointerup', haut);
    scene.addEventListener('pointercancel', haut);
    scene.addEventListener('pointerleave', function () { if (!geste) $('#etatPos').textContent = '–'; });
    scene.addEventListener('wheel', molette, { passive: false });
    scene.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Le clic milieu ne lance pas le défilement automatique du navigateur.
    scene.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    $('#outils').addEventListener('click', function (e) {
      var b = e.target.closest('.outil');
      if (b) U.choisirOutil(b.dataset.outil);
    });
    $('#etapes').addEventListener('click', function (e) {
      var b = e.target.closest('.etape');
      if (b) U.choisirMode(b.dataset.mode);
    });
    window.addEventListener('resize', U.redessiner);
    if (window.ResizeObserver) new ResizeObserver(U.redessiner).observe(scene);
  };
})();
