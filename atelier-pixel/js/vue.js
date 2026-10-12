(function () {
  'use strict';

  var A = window.Atelier;

  var ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];
  var TRACE = { crayon: 1, gomme: 1, trame: 1, eclaircir: 1, ligne: 1, rect: 1, ellipse: 1 };
  var FOND = '#18181a';
  var DAMIER = ['#8a8a8a', '#6e6e6e'];
  var TEINTES_OIGNON = ['#ff4d6a', '#4da3ff'];   // images précédentes, images suivantes
  var FOURMIS_MAX = 40000;

  var $ = function (s) { return document.querySelector(s); };

  // ---------- État de l'interface ----------
  var U = A.ui = {
    outil: 'crayon', taille: 1, pixelParfait: false, plein: false, contigu: true, symetrie: '', trame: true,
    c1: A.rgba(34, 32, 52, 255), c2: A.rgba(255, 255, 255, 255), cible: 1,
    zoom: 8, ox: 0, oy: 0, grille: true,
    oignon: { actif: false, avant: 1, apres: 1, opacite: 0.45 },
    lecture: false, iLecture: 0, espace: false, espaceUtilise: false, survol: null
  };

  var scene, toile, ctx, tampon, calqueOignon, motif, geste = null, attente = false, phase = 0, fourmis = null;

  // Copie un tampon de pixels dans un canvas de même taille.
  U.peindre = function (canvas, pix, w, h) {
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pix.buffer, pix.byteOffset, pix.byteLength), w, h), 0, 0);
  };

  U.message = function (texte) {
    var el = $('#etatMsg');
    el.textContent = texte || '';
    clearTimeout(U.message.t);
    if (texte) U.message.t = setTimeout(function () { el.textContent = ''; }, 4000);
  };

  // Affiche le refus éventuel d'une opération du modèle ('' : fait, 'rien' : sans effet).
  U.dire = function (r) { if (typeof r === 'string' && r && r !== 'rien') U.message(r); };

  // ---------- Rendu ----------
  U.redessiner = function () {
    if (attente) return;
    attente = true;
    requestAnimationFrame(dessiner);
  };

  function creerMotif() {
    var c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = c.height = 16;
    g.fillStyle = DAMIER[0]; g.fillRect(0, 0, 16, 16);
    g.fillStyle = DAMIER[1]; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    return ctx.createPattern(c, 'repeat');
  }

  // Arêtes du masque de sélection, en coordonnées du sprite.
  function contour(s) {
    var segs = [], i, j, m = s.masque, w = s.w, h = s.h;
    function a(x, y) { return x >= 0 && y >= 0 && x < w && y < h && m[y * w + x]; }
    for (j = 0; j < h && segs.length < FOURMIS_MAX; j++) {
      for (i = 0; i < w; i++) {
        if (!m[j * w + i]) continue;
        if (!a(i, j - 1)) segs.push(i, j, i + 1, j);
        if (!a(i, j + 1)) segs.push(i, j + 1, i + 1, j + 1);
        if (!a(i - 1, j)) segs.push(i, j, i, j + 1);
        if (!a(i + 1, j)) segs.push(i + 1, j, i + 1, j + 1);
      }
    }
    if (segs.length >= FOURMIS_MAX) segs = [0, 0, w, 0, w, 0, w, h, w, h, 0, h, 0, h, 0, 0];
    return segs;
  }

  function pointilles(tracer) {
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); tracer(); ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -phase;
    ctx.strokeStyle = '#000';
    ctx.beginPath(); tracer(); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Une image voisine, teintée. Sur fond transparent elle n'apparaît que là où l'image courante est
  // vide, comme si elle était derrière. Si l'image courante est entièrement opaque (un décor), elle
  // serait invisible : on montre alors par-dessus ses seuls pixels qui diffèrent.
  function dessinerOignon(i, teinte, alpha, compo, opaque, x0, y0, W, H) {
    var d = A.doc, g, c, o, k;
    if (i < 0 || i >= d.images.length) return;
    c = A.composer(i, true);
    o = new Uint32Array(c.length);
    for (k = 0; k < c.length; k++) if (opaque ? c[k] !== compo[k] : compo[k] >>> 24 < 255) o[k] = c[k];
    U.peindre(calqueOignon, o, d.w, d.h);
    g = calqueOignon.getContext('2d');
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.7;
    g.fillStyle = teinte;
    g.fillRect(0, 0, d.w, d.h);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    ctx.globalAlpha = alpha;
    ctx.drawImage(calqueOignon, x0, y0, W, H);
    ctx.globalAlpha = 1;
  }

  function dessiner() {
    attente = false;
    var d = A.doc, r = scene.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var cw = Math.max(1, Math.round(r.width)), ch = Math.max(1, Math.round(r.height));
    if (toile.width !== Math.round(cw * dpr) || toile.height !== Math.round(ch * dpr)) {
      toile.width = Math.round(cw * dpr); toile.height = Math.round(ch * dpr);
      toile.style.width = cw + 'px'; toile.style.height = ch + 'px';
    }
    var z = U.zoom, x0 = Math.round(U.ox), y0 = Math.round(U.oy), W = d.w * z, H = d.h * z, k, i, s, g = geste, compo, opaque;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = FOND;
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(x0, y0);
    ctx.fillStyle = motif;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    compo = A.composer(d.iImage);
    U.peindre(tampon, compo, d.w, d.h);
    ctx.drawImage(tampon, x0, y0, W, H);

    if (U.oignon.actif) {
      opaque = true;
      for (i = 0; opaque && i < compo.length; i++) opaque = compo[i] >>> 24 === 255;
      for (k = U.oignon.avant; k >= 1; k--) dessinerOignon(d.iImage - k, TEINTES_OIGNON[0], U.oignon.opacite / k, compo, opaque, x0, y0, W, H);
      for (k = U.oignon.apres; k >= 1; k--) dessinerOignon(d.iImage + k, TEINTES_OIGNON[1], U.oignon.opacite / k, compo, opaque, x0, y0, W, H);
    }

    if (U.grille && z >= 6) {
      ctx.fillStyle = 'rgba(0, 0, 0, .28)';
      for (i = 1; i < d.w; i++) ctx.fillRect(x0 + i * z, y0, 1, H);
      for (i = 1; i < d.h; i++) ctx.fillRect(x0, y0 + i * z, W, 1);
    }
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, W + 1, H + 1);

    if (U.symetrie && (TRACE[U.outil] || U.outil === 'pot')) {
      ctx.fillStyle = 'rgba(80, 220, 255, .8)';
      if (U.symetrie.indexOf('h') >= 0) ctx.fillRect(x0 + Math.round(W / 2), y0 - 6, 1, H + 12);
      if (U.symetrie.indexOf('v') >= 0) ctx.fillRect(x0 - 6, y0 + Math.round(H / 2), W + 12, 1);
    }

    s = d.sel;
    if (s) {
      if (!fourmis || fourmis.sel !== s.masque) fourmis = { sel: s.masque, segs: contour(s) };
      pointilles(function () {
        var q = fourmis.segs, n;
        for (n = 0; n < q.length; n += 4) {
          ctx.moveTo(x0 + (s.x + q[n]) * z + 0.5, y0 + (s.y + q[n + 1]) * z + 0.5);
          ctx.lineTo(x0 + (s.x + q[n + 2]) * z + 0.5, y0 + (s.y + q[n + 3]) * z + 0.5);
        }
      });
    }
    if (g && g.type === 'cadre') {
      pointilles(function () {
        ctx.rect(x0 + Math.min(g.x0, g.x1) * z + 0.5, y0 + Math.min(g.y0, g.y1) * z + 0.5, (Math.abs(g.x1 - g.x0) + 1) * z, (Math.abs(g.y1 - g.y0) + 1) * z);
      });
    }
    if (g && g.type === 'degrade') {
      pointilles(function () {
        ctx.moveTo(x0 + (g.x0 + 0.5) * z, y0 + (g.y0 + 0.5) * z);
        ctx.lineTo(x0 + (g.x1 + 0.5) * z, y0 + (g.y1 + 0.5) * z);
      });
    }

    if (U.survol && !g && TRACE[U.outil] && !U.espace) {
      var t = U.taille, o = -(t >> 1), bx = x0 + (U.survol.x + o) * z, by = y0 + (U.survol.y + o) * z;
      ctx.strokeStyle = 'rgba(0, 0, 0, .8)';
      ctx.strokeRect(bx - 0.5, by - 0.5, t * z + 1, t * z + 1);
      ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
      ctx.strokeRect(bx + 0.5, by + 0.5, t * z - 1, t * z - 1);
    }
    if (U.apercuDessiner) U.apercuDessiner();
  }

  // ---------- Zoom et déplacement ----------
  function zoomer(z, cx, cy) {
    var px = (cx - U.ox) / U.zoom, py = (cy - U.oy) / U.zoom;
    U.zoom = z;
    U.ox = cx - px * z; U.oy = cy - py * z;
    U.infos();
    U.redessiner();
  }

  U.zoomPas = function (sens, cx, cy) {
    var r = scene.getBoundingClientRect(), i = 0;
    while (i < ZOOMS.length - 1 && ZOOMS[i] < U.zoom) i++;
    i = Math.max(0, Math.min(ZOOMS.length - 1, i + sens));
    zoomer(ZOOMS[i], cx === undefined ? r.width / 2 : cx, cy === undefined ? r.height / 2 : cy);
  };

  U.zoomReel = function () {
    var r = scene.getBoundingClientRect();
    zoomer(1, r.width / 2, r.height / 2);
  };

  // Plus grand zoom qui montre tout le sprite, centré.
  U.ajuster = function () {
    var r = scene.getBoundingClientRect(), d = A.doc, z = 1, i;
    for (i = 0; i < ZOOMS.length; i++) if (d.w * ZOOMS[i] <= r.width - 48 && d.h * ZOOMS[i] <= r.height - 48) z = ZOOMS[i];
    U.zoom = z;
    U.ox = Math.round((r.width - d.w * z) / 2);
    U.oy = Math.round((r.height - d.h * z) / 2);
    U.infos();
    U.redessiner();
  };

  U.infos = function () {
    var d = A.doc;
    $('#etatInfo').textContent = d.w + ' × ' + d.h + ' px · image ' + (d.iImage + 1) + '/' + d.images.length +
      ' · calque « ' + d.calques[d.iCalque].nom + ' » · zoom ' + U.zoom * 100 + ' %';
  };

  // ---------- Souris ----------
  function pixel(e) {
    var r = scene.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left - Math.round(U.ox)) / U.zoom), y: Math.floor((e.clientY - r.top - Math.round(U.oy)) / U.zoom) };
  }

  function prelever(p, bouton) {
    var c = A.pipette(p.x, p.y);
    if (c !== null) U.definirCouleur(bouton === 2 ? 2 : 1, c);
  }

  function bas(e) {
    var p = pixel(e), c, autre, r, outil;
    if (geste) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    try { scene.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ }
    if (e.button === 1 || U.espace || U.outil === 'main') {
      e.preventDefault();
      U.espaceUtilise = true;
      geste = { type: 'main', sx: e.clientX, sy: e.clientY, ox: U.ox, oy: U.oy };
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    c = e.button === 2 ? U.c2 : U.c1;
    autre = e.button === 2 ? U.c1 : U.c2;
    outil = U.outil;
    if (outil === 'pipette' || (e.altKey && (TRACE[outil] || outil === 'pot'))) {
      geste = { type: 'pipette', bouton: e.button };
      prelever(p, e.button);
      return;
    }
    if (TRACE[outil]) {
      if (outil === 'eclaircir' && e.button === 2) outil = 'assombrir';
      r = A.traitDebut({
        outil: outil, x: p.x, y: p.y, couleur: c, couleur2: autre, taille: U.taille,
        symetrie: U.symetrie, pixelParfait: U.pixelParfait, plein: U.plein
      });
      if (r) U.message(r); else geste = { type: 'trait' };
    } else if (outil === 'pot') {
      U.dire(A.remplir(p.x, p.y, c, U.contigu, U.symetrie));
    } else if (outil === 'degrade') {
      geste = { type: 'degrade', x0: p.x, y0: p.y, x1: p.x, y1: p.y, c1: c, c2: autre };
    } else if (outil === 'baguette') {
      A.selBaguette(p.x, p.y, U.contigu);
    } else if (outil === 'selection' && !A.selContient(p.x, p.y)) {
      geste = { type: 'cadre', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    } else if (outil === 'selection' || outil === 'deplacer') {
      geste = { type: 'glisser', x: p.x, y: p.y, bouge: false, auto: false };
      if (!A.doc.sel) {
        // Sans sélection, l'outil Déplacer emporte tout le calque.
        r = A.calqueLibre();
        if (r) { U.message(r); geste = null; return; }
        A.selTout(true);
        geste.auto = true;
      }
    }
    U.redessiner();
  }

  function bouge(e) {
    var p = pixel(e), g = geste, d = A.doc, r, dx, dy;
    U.survol = p;
    $('#etatPos').textContent = (p.x >= 0 && p.y >= 0 && p.x < d.w && p.y < d.h) ? 'x ' + p.x + ', y ' + p.y : '–';
    if (!g) { U.redessiner(); return; }
    if (g.type === 'main') {
      U.ox = g.ox + e.clientX - g.sx; U.oy = g.oy + e.clientY - g.sy;
    } else if (g.type === 'trait') {
      A.traitVers(p.x, p.y, e.shiftKey);
    } else if (g.type === 'pipette') {
      prelever(p, g.bouton);
    } else if (g.type === 'cadre') {
      g.x1 = p.x; g.y1 = p.y;
      if (e.shiftKey) { r = A.contraindre('rect', g.x0, g.y0, p.x, p.y); g.x1 = r[0]; g.y1 = r[1]; }
    } else if (g.type === 'degrade') {
      g.x1 = p.x; g.y1 = p.y;
    } else if (g.type === 'glisser') {
      dx = p.x - g.x; dy = p.y - g.y;
      if (dx || dy) {
        r = A.selDeplacer(dx, dy, true);
        if (r) { U.message(r); geste = null; } else { g.x = p.x; g.y = p.y; g.bouge = true; }
      }
    }
    U.redessiner();
  }

  function haut(e) {
    var g = geste;
    geste = null;
    try { scene.releasePointerCapture(e.pointerId); } catch (err) { /* déjà relâché */ }
    if (!g) return;
    if (g.type === 'trait') {
      A.traitFin();
    } else if (g.type === 'cadre') {
      if (g.x0 === g.x1 && g.y0 === g.y1) A.selAucune(); else A.selRect(g.x0, g.y0, g.x1, g.y1);
    } else if (g.type === 'degrade') {
      if (g.x0 !== g.x1 || g.y0 !== g.y1) U.dire(A.degrade(g.x0, g.y0, g.x1, g.y1, g.c1, g.c2, U.trame));
    } else if (g.type === 'glisser') {
      if (g.auto) { A.selAncrer(); A.doc.sel = null; }
      if (g.bouge) A.valider('Déplacer');
    }
    U.redessiner();
  }

  // Abandonne le geste en cours (touche Échap). Rend vrai s'il y en avait un.
  U.abandonner = function () {
    var g = geste;
    geste = null;
    if (!g) return false;
    if (g.type === 'trait') A.traitAnnuler();
    if (g.type === 'glisser') A.revenir();
    U.redessiner();
    return true;
  };

  U.gesteEnCours = function () { return !!geste; };

  function molette(e) {
    var r = scene.getBoundingClientRect();
    e.preventDefault();
    if (e.shiftKey) { U.regler('taille', U.taille + (e.deltaY < 0 || e.deltaX < 0 ? 1 : -1)); return; }
    U.zoomPas(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
  }

  // ---------- Mise en place ----------
  U.initVue = function () {
    scene = $('#scene'); toile = $('#toile');
    ctx = toile.getContext('2d');
    tampon = document.createElement('canvas');
    calqueOignon = document.createElement('canvas');
    motif = creerMotif();
    scene.addEventListener('pointerdown', bas);
    scene.addEventListener('pointermove', bouge);
    scene.addEventListener('pointerup', haut);
    scene.addEventListener('pointercancel', haut);
    scene.addEventListener('pointerleave', function () { U.survol = null; $('#etatPos').textContent = '–'; U.redessiner(); });
    scene.addEventListener('wheel', molette, { passive: false });
    scene.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    scene.addEventListener('auxclick', function (e) { e.preventDefault(); });
    window.addEventListener('resize', U.redessiner);
    setInterval(function () {
      if (A.doc && A.doc.sel) { phase = (phase + 1) % 8; U.redessiner(); }
    }, 180);
  };
})();
