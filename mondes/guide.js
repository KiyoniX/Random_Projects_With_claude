// Guides de l'Écliptique : habillage commun aux quatre chapitres (titre courant, onglets, sommaire, pictogrammes, carte à zoom).
(function () {
  'use strict';

  var Guide = window.Guide = {};
  var $ = function (s) { return document.querySelector(s); };

  Guide.COLL = '#c4165c';
  Guide.attr = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  // À l'affichage seulement : apostrophe typographique, espaces insécables de la ponctuation française
  Guide.typo = function (s) { return String(s).replace(/'/g, '’').replace(/ ([;:?!»])/g, '\xa0$1').replace(/« /g, '«\xa0'); };
  Guide.esc = function (s) { return Guide.attr(Guide.typo(s)); };
  Guide.fr = function (n, d) { return n.toLocaleString('fr-FR', { maximumFractionDigits: d === undefined ? 1 : d }); };
  Guide.cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };

  // ---------- Chapitres ----------
  Guide.CHAPITRES = [
    { cle: 'planete', titre: 'La planète', page: '../atlas-des-mondes/index.html', folio: 7 },
    { cle: 'histoire', titre: 'Un peu d\'histoire', page: '../chroniques/index.html', folio: 33 },
    { cle: 'langue', titre: 'Petit guide de conversation', page: '../langues-inventees/index.html', folio: 53 },
    { cle: 'steles', titre: 'Les stèles', page: '../steles/index.html', folio: 79 }
  ];

  // Tous les liens de chapitre de la page suivent l'adresse courante (graine et réglages)
  Guide.adresse = function (adr) {
    document.querySelectorAll('a[data-ch]').forEach(function (a) {
      var ch = Guide.CHAPITRES.filter(function (c) { return c.cle === a.dataset.ch; })[0];
      if (ch) a.href = ch.page + '#' + adr;
    });
  };
  Guide.destination = function (nom, chapitre) {
    var d = $('#gDest');
    if (d) d.textContent = Guide.typo(nom);
    document.title = Guide.typo(nom + ', ' + chapitre.charAt(0).toLowerCase() + chapitre.slice(1) + ' · Guides de l\'Écliptique');
  };

  // ---------- Sommaire de marge et titre courant ----------
  var rubriques = [];
  Guide.sommaire = function () {
    var box = $('#gSommaire');
    rubriques = [];
    document.querySelectorAll('[data-folio]').forEach(function (s) { if (!s.hidden && s.id && s.offsetParent !== null) rubriques.push(s); });
    if (box) {
      box.innerHTML = rubriques.filter(function (s) { return s.dataset.titre; }).map(function (s) {
        return '<li><a href="#' + s.id + '" data-vers="' + s.id + '">' + Guide.esc(s.dataset.titre) + '<span>' + s.dataset.folio + '</span></a></li>';
      }).join('');
      box.parentNode.hidden = !rubriques.some(function (s) { return s.dataset.titre; });
    }
    suivre();
  };
  function suivre() {
    var ici = rubriques[0];
    rubriques.forEach(function (s) { if (s.getBoundingClientRect().top < 120) ici = s; });
    if (!ici) return;
    var sec = $('#gSection'), fol = $('#gFolio');
    if (sec) sec.textContent = Guide.typo(ici.dataset.titre || ici.dataset.courant || '');
    if (fol) fol.textContent = ici.dataset.folio;
    document.querySelectorAll('#gSommaire a').forEach(function (a) { a.classList.toggle('ici', a.dataset.vers === ici.id); });
  }
  var attente = false;
  window.addEventListener('scroll', function () {
    if (attente) return;
    attente = true;
    requestAnimationFrame(function () { attente = false; suivre(); });
  }, { passive: true });
  // Les renvois internes ne touchent pas à l'adresse, qui porte la graine
  Guide.aller = function (id) {
    var cible = document.getElementById(id);
    if (!cible) return;
    cible.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-vers]');
    if (!a) return;
    e.preventDefault();
    Guide.aller(a.dataset.vers);
    var cible = document.getElementById(a.dataset.vers);
    if (cible) { cible.setAttribute('tabindex', '-1'); cible.focus({ preventScroll: true }); }
  });

  // ---------- Pictogrammes et signes ----------
  var PICTOS = {
    etoile: '<circle cx="11" cy="11" r="3.6"/><path d="M11 2.5v3M11 16.5v3M2.5 11h3M16.5 11h3M5 5l2.1 2.1M14.9 14.9 17 17M17 5l-2.1 2.1M7.1 14.9 5 17"/>',
    poids: '<path d="M6 8h10l2.5 10.5h-15z"/><circle cx="11" cy="5.5" r="2.4"/>',
    thermo: '<path d="M9 13.2V4.5a2 2 0 0 1 4 0v8.7a4 4 0 1 1-4 0z"/><path d="M11 8v7" stroke-width="2.2"/>',
    air: '<path d="M2.5 8h10a2.5 2.5 0 1 0-2.4-3.2M2.5 12h14a2.5 2.5 0 1 1-2.4 3.2M2.5 16h7"/>',
    eau: '<path d="M11 2.8c3.4 4.4 5.6 7.3 5.6 10.2a5.6 5.6 0 0 1-11.2 0c0-2.9 2.2-5.8 5.6-10.2z"/>',
    jour: '<circle cx="11" cy="11" r="8"/><path d="M11 6v5l3.4 2.2"/>',
    annee: '<rect x="3" y="4.5" width="16" height="14"/><path d="M3 9h16M7 2.5v4M15 2.5v4"/>',
    saison: '<path d="M4 18C4 9 9 4 18 4c0 9-5 14-14 14zM4 18l8-8"/>',
    lune: '<path d="M16.5 14.6A7.6 7.6 0 0 1 8 3.6a7.8 7.8 0 1 0 8.5 11z"/>',
    maison: '<path d="M3 10.5 11 3.5l8 7M5.5 9v9.5h11V9M9.3 18.5v-5h3.4v5"/>',
    bol: '<path d="M3 10h16a8 8 0 0 1-16 0zM7 6.5c0-1.6 1.6-1.6 1.6-3.2M11.4 6.5c0-1.6 1.6-1.6 1.6-3.2"/>',
    taille: '<path d="M8 2.5h6v17H8zM8 6h2.6M8 9.5h3.6M8 13h2.6M8 16.5h3.6"/>',
    repere: '<path d="M11 19.5c-3.8-4.6-5.6-7.5-5.6-10.2a5.6 5.6 0 0 1 11.2 0c0 2.7-1.8 5.6-5.6 10.2z"/><circle cx="11" cy="9.3" r="2"/>',
    attention: '<path d="M11 3 20 18.5H2zM11 9v4.6"/><circle cx="11" cy="15.9" r=".6" fill="currentColor"/>',
    plan: '<path d="M3 5.5 8.3 3.5l5.4 2 5.3-2v13l-5.3 2-5.4-2-5.3 2zM8.3 3.5v13M13.7 5.5v13"/>',
    bouche: '<path d="M3 11c2.6-3.6 5-4.4 8-2.6 3-1.8 5.4-1 8 2.6-2.6 3.8-5.2 5-8 5s-5.4-1.2-8-5zM3 11h16"/>',
    plume: '<path d="M4 18c1-7 5-12.5 14-14-1 8-6 12-12 12.5M4 18l6.5-7"/>'
  };
  Guide.picto = function (nom) {
    return '<svg class="picto" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PICTOS[nom] || '') + '</svg>';
  };
  var BRANCHE = 'M8 1.2l2.05 4.3 4.7.6-3.45 3.25.87 4.65L8 11.72 3.83 14l.87-4.65L1.25 6.1l4.7-.6z';
  Guide.etoiles = function (n) {
    var s = '';
    for (var i = 0; i < 3; i++) s += '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + BRANCHE + '" fill="' + (i < n ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
    return '<span class="etoiles" role="img" aria-label="' + n + (n > 1 ? ' étoiles' : ' étoile') + ' sur 3">' + s + '</span>';
  };

  // Numéro de renvoi cerclé, dessiné sur une carte
  Guide.pastille = function (ctx, x, y, texte, o) {
    o = o || {};
    var r = o.r || 8.5;
    ctx.beginPath(); ctx.arc(x, y, r + 1.6, 0, 6.2832); ctx.fillStyle = o.bord || '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fillStyle = o.fond || Guide.COLL; ctx.fill();
    if (o.trait) { ctx.lineWidth = 1.5; ctx.strokeStyle = o.trait; ctx.stroke(); }
    if (texte !== '' && texte !== undefined) {
      ctx.font = '700 ' + Math.round(r * 1.35) + 'px Bahnschrift, "Arial Narrow", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = o.encre || '#fff'; ctx.fillText(String(texte), x, y + 0.8);
      ctx.textAlign = 'left';
    }
  };
  Guide.etiquette = function (ctx, texte, x, y, largeur, o) {
    o = o || {};
    ctx.font = '600 13px Bahnschrift, "Arial Narrow", sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var tw = ctx.measureText(texte).width, ecart = (o.ecart || 12), tx = x + ecart + tw + 4 > largeur ? x - ecart - tw : x + ecart;
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(texte, tx, y + 0.5);
    ctx.fillStyle = o.encre || '#000'; ctx.fillText(texte, tx, y + 0.5);
  };

  // ---------- Carte : zoom à la molette, déplacement, boucle est-ouest ----------
  // opts : W, H (taille de la grille), dessus(ctx, carte), survol(i, j, x, y), quitte(), clic(x, y), outils (élément)
  Guide.Carte = function (canvas, opts) {
    var self = this, W = opts.W, H = opts.H, ctx = canvas.getContext('2d'), ZMAX = 14;
    var fond = document.createElement('canvas'), fctx;
    fond.width = W; fond.height = H; fctx = fond.getContext('2d');
    var v = { z: 1, cx: W / 2, cy: H / 2 }, lw = 0, lh = 0, dpr = 1, attendu = false, plein = false;
    var mod = function (a, n) { return ((a % n) + n) % n; };

    function mesure() {
      lw = canvas.clientWidth; lh = lw * H / W;
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      var bw = Math.max(1, Math.round(lw * dpr)), bh = Math.max(1, Math.round(lh * dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    }
    function borne() {
      v.z = Math.max(1, Math.min(ZMAX, v.z));
      var demi = H / (2 * v.z);
      v.cy = Math.max(demi, Math.min(H - demi, v.cy));
      v.cx = mod(v.cx, W);
      canvas.style.touchAction = v.z > 1.001 ? 'none' : 'pan-y';
      if (opts.outils) {
        var b = opts.outils.querySelector('[data-zoom="tout"]');
        if (b) b.disabled = self.entiereVue();
      }
    }
    self.W = W; self.H = H;
    self.echelle = function () { return lw / W * v.z; };
    self.zoom = function () { return v.z; };
    self.vue = function () { return { z: v.z, cx: v.cx, cy: v.cy }; };
    self.largeur = function () { return lw; };
    self.hauteur = function () { return lh; };
    self.entiereVue = function () { return v.z <= 1.001 && Math.abs(v.cx - W / 2) < 0.5; };
    // Position à l'écran d'un point de la grille (la copie la plus proche du centre de la vue)
    self.x = function (i) { return lw / 2 + (mod(i - v.cx + W / 2, W) - W / 2) * self.echelle(); };
    self.y = function (j) { return lh / 2 + (j - v.cy) * self.echelle(); };
    self.versCarte = function (px, py) {
      var s = self.echelle();
      return { i: mod(v.cx + (px - lw / 2) / s, W), j: v.cy + (py - lh / 2) / s };
    };

    self.dessine = function () {
      attendu = false;
      mesure();
      if (lw < 2) return;
      var s = self.echelle(), x0 = lw / 2 - v.cx * s, y0 = lh / 2 - v.cy * s;
      var px = function (a) { return Math.round(a * dpr) / dpr; };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, lw, lh);
      if (plein) {
        // Pixels nets dès que chaque case de la grille couvre au moins deux pixels d'écran
        ctx.imageSmoothingEnabled = s * dpr < 2;
        for (var k = -1; k <= 1; k++) {
          var a = px(x0 + k * W * s), b = px(x0 + (k + 1) * W * s);
          if (b > 0 && a < lw) ctx.drawImage(fond, a, px(y0), b - a, px(y0 + H * s) - px(y0));
        }
      }
      if (opts.dessus) opts.dessus(ctx, self);
    };
    self.demande = function () {
      if (attendu) return;
      attendu = true;
      requestAnimationFrame(self.dessine);
    };
    self.image = function (donnees, voile) {
      fctx.putImageData(donnees, 0, 0);
      if (voile) { fctx.fillStyle = voile; fctx.fillRect(0, 0, W, H); }
      plein = true; self.demande();
    };

    self.zoomer = function (facteur, px, py) {
      mesure();
      if (px === undefined) { px = lw / 2; py = lh / 2; }
      var s = self.echelle(), mi = v.cx + (px - lw / 2) / s, mj = v.cy + (py - lh / 2) / s;
      v.z = Math.max(1, Math.min(ZMAX, v.z * facteur));
      s = self.echelle();
      v.cx = mi - (px - lw / 2) / s; v.cy = mj - (py - lh / 2) / s;
      borne(); self.demande();
    };
    self.deplace = function (dx, dy) { var s = self.echelle(); v.cx += dx / s; v.cy += dy / s; borne(); self.demande(); };
    self.entiere = function () { v.z = 1; v.cx = W / 2; v.cy = H / 2; borne(); self.demande(); };

    // ---------- Souris, doigts, clavier ----------
    var doigts = {}, prise = null, pince = null;
    var local = function (e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = local(e);
      self.zoomer(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), p.x, p.y);
      if (opts.survol) { var m = self.versCarte(p.x, p.y); opts.survol(m.i, m.j, p.x, p.y); }
    }, { passive: false });
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var p = local(e);
      doigts[e.pointerId] = p;
      var ids = Object.keys(doigts);
      if (ids.length === 1) prise = { x: p.x, y: p.y, cx: v.cx, cy: v.cy, bouge: false };
      else if (ids.length === 2) {
        var a = doigts[ids[0]], b = doigts[ids[1]];
        pince = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
        if (prise) prise.bouge = true;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ }
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = local(e);
      if (doigts[e.pointerId]) {
        doigts[e.pointerId] = p;
        var ids = Object.keys(doigts);
        if (pince && ids.length === 2) {
          var a = doigts[ids[0]], b = doigts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          self.zoomer(d / pince.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
          pince.d = d;
          return;
        }
        if (prise && ids.length === 1) {
          var dx = p.x - prise.x, dy = p.y - prise.y;
          if (!prise.bouge && Math.abs(dx) + Math.abs(dy) > 4) { prise.bouge = true; canvas.classList.add('glisse'); }
          if (prise.bouge) { var s = self.echelle(); v.cx = prise.cx - dx / s; v.cy = prise.cy - dy / s; borne(); self.demande(); }
          return;
        }
      }
      if (opts.survol) { var m = self.versCarte(p.x, p.y); opts.survol(m.i, m.j, p.x, p.y); }
    });
    var lache = function (e) {
      var etait = doigts[e.pointerId];
      delete doigts[e.pointerId];
      if (Object.keys(doigts).length < 2) pince = null;
      canvas.classList.remove('glisse');
      if (etait && prise && !prise.bouge && e.type === 'pointerup' && opts.clic) { var p = local(e); opts.clic(p.x, p.y, e); }
      if (!Object.keys(doigts).length) prise = null;
    };
    canvas.addEventListener('pointerup', lache);
    canvas.addEventListener('pointercancel', lache);
    canvas.addEventListener('pointerleave', function () { if (opts.quitte) opts.quitte(); });
    canvas.addEventListener('keydown', function (e) {
      var k = e.key, pas = 60;
      if (k === '+' || k === '=') self.zoomer(1.5);
      else if (k === '-' || k === '_') self.zoomer(1 / 1.5);
      else if (k === '0' || e.code === 'Digit0' || k === 'Escape' || k === 'Home') self.entiere();
      else if (k === 'ArrowLeft') self.deplace(-pas, 0);
      else if (k === 'ArrowRight') self.deplace(pas, 0);
      else if (k === 'ArrowUp' && v.z > 1.001) self.deplace(0, -pas);
      else if (k === 'ArrowDown' && v.z > 1.001) self.deplace(0, pas);
      else return;
      e.preventDefault();
    });
    if (opts.outils) {
      opts.outils.addEventListener('click', function (e) {
        var b = e.target.closest('[data-zoom]');
        if (!b) return;
        if (b.dataset.zoom === 'plus') self.zoomer(1.6);
        else if (b.dataset.zoom === 'moins') self.zoomer(1 / 1.6);
        else self.entiere();
      });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { self.demande(); }).observe(canvas);
    else window.addEventListener('resize', self.demande);
    borne();
  };
})();
