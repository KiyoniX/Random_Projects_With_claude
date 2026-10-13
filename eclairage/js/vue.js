(function () {
  'use strict';

  var E = window.Eclairage;

  var ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48];
  var FONDS = { sombre: '#2a2b2d', gris: '#767676', clair: '#c9c9c9' };   // « gris » : le gris neutre à 18 % des photographes
  var GELATINE = '#ee8a3c', BLEU = '#5b8fd9';
  var PAS_MONTER = 16;              // ce que « monter » et « creuser » ajoutent ou retirent à chaque passage
  var TOUR = 4500;                  // durée d'un tour de lumière, en millisecondes

  var $ = function (s) { return document.querySelector(s); };
  function icone(d) { return '<svg viewBox="0 0 20 20">' + d + '</svg>'; }

  // L'état de l'interface. vue : sprite, hauteur, normales ou eclaire.
  var U = E.ui = {
    vue: 'eclaire', outil: 'pinceau', z: 8, cx: 0, cy: 0, espace: false, trait: true, pelure: true, tourne: false, fond: 'sombre',
    // Réglages des outils, communs à tous les sprites.
    o: { taille: 2, hauteur: 200, mode: 'poser', h2: 40, forme: 'radial', bombe: true, zone: 'morceau', profil: 'dome', largeur: 6, ajouter: false, force: 0.6, normale: E.coderNormale(-0.5, -0.5, 0.7), effacer: false }
  };

  U.OUTILS = [
    { id: 'pinceau', nom: 'Pinceau de hauteur', touche: 'b', svg: '<path d="M13.6 3.2l3.2 3.2-7.6 7.6-3.2-3.2z"/><path d="M6 10.8c-2 .1-3 1.6-3 3.6V17h2.6c2 0 3.3-1.1 3.4-2.9"/>', astuce: 'Peins la hauteur choisie. Alt+clic relève celle d\'un pixel. [ et ] changent la taille.' },
    { id: 'aplat', nom: 'Aplat', touche: 'f', svg: '<path d="M3.5 9.5 9.5 3.5l6 6-6 6z"/><path d="M3.5 9.5h12"/><path class="plein" d="M17 12.5c0 1.6 1 2.5 1 3.3a1 1 0 0 1-2 0c0-.8 1-1.7 1-3.3z"/>', astuce: 'Clique une zone : elle prend toute la hauteur choisie.' },
    { id: 'degrade', nom: 'Dégradé', touche: 'g', svg: '<circle cx="5.5" cy="5.5" r="2.2"/><path d="M7.2 7.2 15.5 15.5M15.5 15.5h-4.2M15.5 15.5v-4.2"/>', astuce: 'Glisse du point le plus haut vers le plus bas. Radial et bombé : pars du centre pour bomber une forme.' },
    { id: 'pente', nom: 'Pente automatique', touche: 'p', svg: '<path d="M2.5 15.5h15"/><path d="M3.5 15.5c1.6-6.5 3.8-9.5 6.5-9.5s4.9 3 6.5 9.5"/>', astuce: 'Clique une zone : la hauteur monte avec la distance au bord. Dôme, biseau ou coussin.' },
    { id: 'lisser', nom: 'Lissage', touche: 's', svg: '<path d="M3 8.5c1.6-3 3.2 3 4.8 0s3.2 3 4.8 0 3 3 4.4 0"/><path d="M3 14h14"/>', astuce: 'Passe sur les marches de hauteur pour les adoucir.' },
    { id: 'pipette', nom: 'Pipette de hauteur', touche: 'i', svg: '<path d="M12.6 3.4l4 4-2 2-4-4z"/><path d="M11.6 7.4 4.6 14.4 4 16l1.6-.6 7-7"/>', astuce: 'Clique un pixel pour reprendre sa hauteur et, s\'il en a une, sa normale peinte.' },
    { id: 'normale', nom: 'Normale à la main', touche: 'n', svg: '<path d="M3 16h14"/><path d="M4.5 16a5.5 5.5 0 0 1 11 0"/><path d="M10 16 13.6 6.6M13.6 6.6l-3 1.1M13.6 6.6l.7 3.1"/>', astuce: 'Choisis une direction sur la boule, puis peins les pixels qui regardent par là. Les normales peintes l\'emportent sur la hauteur.' },
    { id: 'main', nom: 'Main', touche: 'h', svg: '<path d="M6 11V5.5a1.2 1.2 0 0 1 2.4 0V10M8.4 9V4a1.2 1.2 0 0 1 2.4 0v5M10.8 9V5a1.2 1.2 0 0 1 2.4 0v5M13.2 10V7a1.2 1.2 0 0 1 2.4 0v5c0 3-2 5-5 5s-4-1.4-5.4-4L4 10.6a1.2 1.2 0 0 1 2-1.2"/>', astuce: 'Glisse pour déplacer la vue. Espace maintenu ou clic milieu font la même chose avec n\'importe quel outil.' }
  ];
  U.VUES = [
    { id: 'sprite', nom: 'Sprite' }, { id: 'hauteur', nom: 'Hauteur' }, { id: 'normales', nom: 'Normales' }, { id: 'eclaire', nom: 'Éclairé' }
  ];

  var scene, toile, g, geste = null, demande = false, survol = null;

  // ---------- Vue ----------
  U.redessiner = function () {
    if (demande) return;
    demande = true;
    requestAnimationFrame(function () { demande = false; dessiner(); });
  };

  U.ajuster = function () {
    var d = E.doc, W = scene.clientWidth, H = scene.clientHeight, z = ZOOMS[0], i;
    for (i = 0; i < ZOOMS.length; i++) if (d.w * ZOOMS[i] <= W - 60 && d.h * ZOOMS[i] <= H - 60) z = ZOOMS[i];
    U.z = z; U.cx = Math.round((W - d.w * z) / 2); U.cy = Math.round((H - d.h * z) / 2);
    U.redessiner();
  };

  // Change le zoom en gardant sous le curseur le point du sprite qui s'y trouve.
  function zoomer(z, sx, sy) {
    var x = (sx - U.cx) / U.z, y = (sy - U.cy) / U.z;
    U.z = z; U.cx = Math.round(sx - x * z); U.cy = Math.round(sy - y * z);
    U.redessiner();
  }
  U.zoomPas = function (sens, sx, sy) {
    var i = ZOOMS.indexOf(U.z), j = E.borne((i < 0 ? 6 : i) + sens, 0, ZOOMS.length - 1);
    if (sx === undefined) { sx = scene.clientWidth / 2; sy = scene.clientHeight / 2; }
    zoomer(ZOOMS[j], sx, sy);
  };

  function plan(e) {
    var r = scene.getBoundingClientRect();
    return { x: (e.clientX - r.left - U.cx) / U.z, y: (e.clientY - r.top - U.cy) / U.z, sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  // ---------- Images ----------
  function versToile(pix, w, h, c) {
    var k, im;
    c = c || document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    k = c.getContext('2d'); im = k.createImageData(w, h);
    new Uint32Array(im.data.buffer).set(pix);
    k.putImageData(im, 0, 0);
    return c;
  }
  U.versToile = versToile;

  // Les pixels de la vue demandée, pour l'image i.
  U.pixelsVue = function (vue, i) {
    var d = E.doc, im = d.images[i], R = d.reglages, n = d.w * d.h, o, p, v, N;
    if (vue === 'sprite') return im.pix;
    if (vue === 'eclaire') return E.eclairer(i, R);
    if (vue === 'hauteur') return E.carteHauteur(i);
    o = new Uint32Array(n); N = E.normales(i, R.profondeur);
    for (p = 0; p < n; p++) if (im.pix[p]) { v = E.coderNormale(N[p * 3], N[p * 3 + 1], N[p * 3 + 2]); o[p] = v; }
    return o;
  };

  var cache = { cle: '', toile: null }, cachePelure = { cle: '', toile: null }, cacheTrait = { cle: '', toile: null };
  function signature() { var R = E.doc.reglages, s = '', k; for (k in R) s += R[k] + '|'; return s; }
  function imageVue() {
    var d = E.doc, cle = U.vue + ':' + d.iImage + ':' + E.rev + ':' + E.revPalette + ':' + (U.vue === 'eclaire' || U.vue === 'normales' ? signature() : '');
    if (cache.cle !== cle) { cache.toile = versToile(U.pixelsVue(U.vue, d.iImage), d.w, d.h, cache.toile); cache.cle = cle; }
    return cache.toile;
  }
  function pelure() {
    var d = E.doc, cle = d.iImage + ':' + E.rev;
    if (cachePelure.cle !== cle) { cachePelure.toile = versToile(d.images[d.iImage].pix, d.w, d.h, cachePelure.toile); cachePelure.cle = cle; }
    return cachePelure.toile;
  }
  function trait() {
    var d = E.doc, im = d.images[d.iImage], A = E.analyse(), cle = d.iImage + ':' + E.rev + ':' + E.revPalette, o, p;
    if (!A.trait) return null;
    if (cacheTrait.cle !== cle) {
      o = new Uint32Array(d.w * d.h);
      for (p = 0; p < o.length; p++) if (im.pix[p] === A.trait) o[p] = A.trait;
      cacheTrait.toile = versToile(o, d.w, d.h, cacheTrait.toile); cacheTrait.cle = cle;
    }
    return cacheTrait.toile;
  }

  // ---------- Dessin ----------
  var pinceaux = {};
  // Le pinceau d'Atelier Pixel : carré jusqu'à 2, rond au-delà. Une liste de décalages [dx, dy, …].
  function pinceau(taille) {
    var p = [], c = (taille - 1) / 2, o = -(taille >> 1), i, j;
    if (pinceaux[taille]) return pinceaux[taille];
    for (j = 0; j < taille; j++) for (i = 0; i < taille; i++) {
      if (taille < 3 || (i - c) * (i - c) + (j - c) * (j - c) <= taille * taille / 4) p.push(o + i, o + j);
    }
    return (pinceaux[taille] = p);
  }

  function dessiner() {
    var dpr = window.devicePixelRatio || 1, W = scene.clientWidth, H = scene.clientHeight, d = E.doc, z = U.z, x, y, pas, im, A, k, l;
    if (!W || !H || !d) return;
    apercu();
    if (toile.width !== Math.round(W * dpr) || toile.height !== Math.round(H * dpr)) { toile.width = Math.round(W * dpr); toile.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = FONDS[U.fond] || FONDS.sombre; g.fillRect(0, 0, W, H);
    g.drawImage(imageVue(), U.cx, U.cy, d.w * z, d.h * z);
    if (U.pelure && (U.vue === 'hauteur' || U.vue === 'normales')) { g.globalAlpha = 0.32; g.drawImage(pelure(), U.cx, U.cy, d.w * z, d.h * z); g.globalAlpha = 1; }
    if (U.trait && U.vue !== 'sprite' && (U.vue !== 'eclaire' || !d.reglages.trait)) { l = trait(); if (l) g.drawImage(l, U.cx, U.cy, d.w * z, d.h * z); }
    // De très près, la grille des pixels.
    if (z >= 12) {
      g.fillStyle = 'rgba(255, 255, 255, .06)';
      for (x = 1; x < d.w; x++) g.fillRect(U.cx + x * z, U.cy, 1, d.h * z);
      for (y = 1; y < d.h; y++) g.fillRect(U.cx, U.cy + y * z, d.w * z, 1);
    }
    // Les normales peintes à la main : un point bleu, quand on les regarde ou qu'on les peint.
    if ((U.outil === 'normale' || U.vue === 'normales') && z >= 5) {
      im = d.images[d.iImage]; pas = Math.max(2, Math.round(z / 5));
      g.fillStyle = BLEU;
      for (k = 0; k < im.norm.length; k++) if (im.norm[k] && im.pix[k]) {
        x = k % d.w; y = (k - x) / d.w;
        g.fillRect(U.cx + x * z + (z - pas) / 2, U.cy + y * z + (z - pas) / 2, pas, pas);
      }
    }
    g.strokeStyle = 'rgba(220, 220, 222, .6)'; g.lineWidth = 1;
    g.strokeRect(U.cx - 0.5, U.cy - 0.5, d.w * z + 1, d.h * z + 1);
    g.fillStyle = '#909197'; g.font = '11px "Segoe UI", sans-serif'; g.textBaseline = 'top';
    A = d.images.length > 1 ? ', image ' + (d.iImage + 1) + ' sur ' + d.images.length : '';
    g.fillText(d.w + ' × ' + d.h + ' px' + A, U.cx, U.cy + d.h * z + 6);

    if (geste && geste.type === 'degrade') {
      g.strokeStyle = GELATINE; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(U.cx + (geste.x0 + 0.5) * z, U.cy + (geste.y0 + 0.5) * z); g.lineTo(U.cx + (geste.x1 + 0.5) * z, U.cy + (geste.y1 + 0.5) * z); g.stroke();
      if (U.o.forme === 'radial') {
        l = Math.sqrt((geste.x1 - geste.x0) * (geste.x1 - geste.x0) + (geste.y1 - geste.y0) * (geste.y1 - geste.y0)) * z;
        g.beginPath(); g.arc(U.cx + (geste.x0 + 0.5) * z, U.cy + (geste.y0 + 0.5) * z, l, 0, 6.2832); g.stroke();
      }
      g.setLineDash([]);
    }
    // L'empreinte du pinceau sous le curseur.
    if (survol && !U.espace && (U.outil === 'pinceau' || U.outil === 'lisser' || U.outil === 'normale')) {
      var pin = pinceau(U.o.taille);
      g.fillStyle = 'rgba(238, 138, 60, .28)';
      for (k = 0; k < pin.length; k += 2) g.fillRect(U.cx + (survol.x + pin[k]) * z, U.cy + (survol.y + pin[k + 1]) * z, z, z);
      g.strokeStyle = GELATINE; g.lineWidth = 1;
      x = survol.x - (U.o.taille >> 1); y = survol.y - (U.o.taille >> 1);
      g.strokeRect(U.cx + x * z + 0.5, U.cy + y * z + 0.5, U.o.taille * z - 1, U.o.taille * z - 1);
    } else if (survol && !U.espace && U.outil !== 'main') {
      g.strokeStyle = GELATINE; g.lineWidth = 1;
      g.strokeRect(U.cx + survol.x * z + 0.5, U.cy + survol.y * z + 0.5, z - 1, z - 1);
    }
  }

  // L'aperçu à taille réelle : la vue en cours à ×1 et à ×2, sur le fond choisi.
  function apercu() {
    var d = E.doc, z = $('#apercu'), c1 = $('#apercu1'), c2 = $('#apercu2'), place = z.clientWidth - 30, k, im = imageVue();
    if (!place || !z.clientHeight) return;
    z.style.background = FONDS[U.fond] || FONDS.sombre;
    k = Math.min(1, place / 3 / d.w, (z.clientHeight - 16) / 2 / d.h);
    [[c1, 1], [c2, 2]].forEach(function (e) {
      var c = e[0], w = Math.max(1, Math.round(d.w * e[1] * k)), h = Math.max(1, Math.round(d.h * e[1] * k)), g2;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; c.style.width = w + 'px'; c.style.height = h + 'px'; }
      g2 = c.getContext('2d'); g2.imageSmoothingEnabled = k < 1; g2.clearRect(0, 0, w, h); g2.drawImage(im, 0, 0, w, h);
    });
    $('#apercuInfo').textContent = k < 1 ? 'réduit' : '×1 et ×2';
  }

  // ---------- Lumière qui tourne ----------
  var dernier = 0, boucle = 0;
  function tic(t) {
    var R;
    boucle = 0;
    if (!U.tourne) return;
    R = E.doc.reglages;
    R.az = Math.round((R.az + (t - dernier) * 360 / TOUR) * 10) / 10 % 360; dernier = t;
    U.redessiner();
    if (U.surLumiere) U.surLumiere(true);
    boucle = requestAnimationFrame(tic);
  }
  // Sans argument : bascule.
  U.tourner = function (etat) {
    etat = etat === undefined ? !U.tourne : etat;
    if (etat === U.tourne) return;
    U.tourne = etat;
    // Une seule boucle à la fois, même si l'on arrête et relance dans la même image.
    if (boucle) { cancelAnimationFrame(boucle); boucle = 0; }
    if (etat) { dernier = performance.now(); boucle = requestAnimationFrame(tic); }
    else { E.doc.reglages.az = Math.round(E.doc.reglages.az) % 360; if (U.surLumiere) U.surLumiere(); if (U.sauverBientot) U.sauverBientot(); }
    if (U.cocher) U.cocher();
  };

  // ---------- Gestes ----------
  U.gesteEnCours = function () { return !!geste; };

  // Retient l'état d'avant au premier vrai changement, pour qu'un clic dans le vide ne remplisse pas l'historique.
  function entamer() { if (!geste.entame) { E.marquer(); geste.entame = true; } }

  function dans(x, y) { var d = E.doc; return x >= 0 && y >= 0 && x < d.w && y < d.h; }

  function touche1(x, y) {
    var d = E.doc, i = d.iImage, im = d.images[i], t = geste, p = y * d.w + x, v, H, Nm;
    if (!dans(x, y) || !im.pix[p] || t.touche[p]) return;
    t.touche[p] = 1;
    if (U.outil === 'normale') {
      v = U.o.effacer ? 0 : U.o.normale;
      if (im.norm[p] === v) return;
      entamer(); Nm = E.ecrireNorm(i); Nm[p] = v;
    } else {
      if (U.outil === 'lisser') v = t.base[p] + (E.moyenne(i, t.base, x, y) - t.base[p]) * U.o.force;
      else v = U.o.mode === 'monter' ? t.base[p] + PAS_MONTER : U.o.mode === 'creuser' ? t.base[p] - PAS_MONTER : U.o.hauteur;
      v = Math.round(E.borne(v, 0, 255));
      if (im.haut[p] === v) return;
      entamer(); H = E.ecrireHaut(i); H[p] = v;
    }
    t.change = true;
  }
  function tamponner(x, y) {
    var pin = pinceau(U.o.taille), k;
    for (k = 0; k < pin.length; k += 2) touche1(x + pin[k], y + pin[k + 1]);
  }
  function ligne(x0, y0, x1, y1, f) {
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, e2;
    for (;;) {
      f(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Relève la hauteur et la normale peinte d'un pixel.
  function pipette(x, y) {
    var d = E.doc, im = d.images[d.iImage], p = y * d.w + x;
    if (!dans(x, y) || !im.pix[p]) return;
    U.o.hauteur = im.haut[p];
    if (im.norm[p]) U.o.normale = im.norm[p];
    if (U.surOutil) U.surOutil();
    U.dire('Hauteur ' + im.haut[p] + (im.norm[p] ? ', et sa normale peinte, reprises.' : ' reprise.'));
  }

  function zoneOuDire(x, y) {
    var m = E.zone(E.doc.iImage, x, y, U.o.zone);
    if (!m) U.dire('Clique sur un pixel du sprite.');
    return m;
  }

  function bas(e) {
    var q = plan(e), x = Math.floor(q.x), y = Math.floor(q.y), d = E.doc, i = d.iImage, m, ch;
    if (geste || (e.button !== 0 && e.button !== 1)) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    scene.setPointerCapture(e.pointerId);
    if (e.button === 1 || U.espace || U.outil === 'main') {
      geste = { type: 'main', id: e.pointerId, sx: q.sx, sy: q.sy, cx: U.cx, cy: U.cy };
      scene.classList.add('main');
      e.preventDefault();
      return;
    }
    if (e.altKey || U.outil === 'pipette') { geste = { type: 'pipette', id: e.pointerId }; pipette(x, y); return; }
    if (U.outil === 'pinceau' || U.outil === 'lisser' || U.outil === 'normale') {
      geste = { type: 'trait', id: e.pointerId, touche: new Uint8Array(d.w * d.h), base: new Uint8Array(d.images[i].haut), lx: x, ly: y };
      tamponner(x, y);
      if (geste.change) { E.rev++; geste.change = false; }
      U.redessiner();
      return;
    }
    if (U.outil === 'degrade') {
      m = zoneOuDire(x, y);
      if (m) geste = { type: 'degrade', id: e.pointerId, m: m, base: new Uint8Array(d.images[i].haut), x0: x, y0: y, x1: x, y1: y };
      U.redessiner();
      return;
    }
    // Aplat et pente : un clic suffit.
    m = zoneOuDire(x, y);
    if (!m) return;
    E.marquer();
    ch = U.outil === 'aplat' ? E.aplat(i, m, U.o.hauteur) : E.pente(i, m, U.o);
    if (ch) { E.change(); U.dire(U.outil === 'aplat' ? 'Zone mise à la hauteur ' + U.o.hauteur + '.' : 'Pente posée : ' + E.PROFILS[U.o.profil].toLowerCase() + ' sur ' + U.o.largeur + ' px, jusqu\'à ' + U.o.hauteur + '.'); }
    else { E.oublierMarque(); U.dire('Rien n\'a changé : la zone avait déjà ce relief.'); }
  }

  function bouge(e) {
    var q = plan(e), t = geste, x = Math.floor(q.x), y = Math.floor(q.y), nv = dans(x, y) ? { x: x, y: y } : null;
    if (!survol !== !nv || (nv && (nv.x !== survol.x || nv.y !== survol.y))) { survol = nv; U.redessiner(); }
    if (U.surPosition) U.surPosition(nv);
    if (!t || e.pointerId !== t.id) return;
    if (t.type === 'main') { U.cx = t.cx + Math.round(q.sx - t.sx); U.cy = t.cy + Math.round(q.sy - t.sy); U.redessiner(); }
    else if (t.type === 'pipette') pipette(x, y);
    else if (t.type === 'trait') {
      if (x === t.lx && y === t.ly) return;
      ligne(t.lx, t.ly, x, y, tamponner); t.lx = x; t.ly = y;
      if (t.change) { E.rev++; t.change = false; U.redessiner(); }
    } else if (t.type === 'degrade') {
      if (x === t.x1 && y === t.y1) return;
      t.x1 = x; t.y1 = y;
      entamer();
      E.degrade(E.doc.iImage, t.m, t.base, t.x0, t.y0, t.x1, t.y1, { forme: U.o.forme, bombe: U.o.bombe, h1: U.o.hauteur, h2: U.o.h2 });
      E.rev++; U.redessiner();
    }
  }

  // Seul le doigt ou le bouton qui a commencé le geste le termine.
  function haut(e) {
    var t = geste;
    if (!t || e.pointerId !== t.id) return;
    geste = null;
    scene.classList.toggle('main', U.espace);
    if (t.entame) E.change();
    U.redessiner();
  }

  function molette(e) {
    var q = plan(e);
    e.preventDefault();
    if (e.deltaY) U.zoomPas(e.deltaY < 0 ? 1 : -1, q.sx, q.sy);
  }

  // ---------- Outils et vues ----------
  U.choisirOutil = function (id) {
    var o = U.OUTILS.filter(function (x) { return x.id === id; })[0] || U.OUTILS[0], b = document.querySelectorAll('.outil'), i;
    U.outil = o.id;
    scene.dataset.outil = o.id;
    for (i = 0; i < b.length; i++) b[i].classList.toggle('actif', b[i].dataset.outil === o.id);
    $('#nomOutil').textContent = o.nom;
    $('#astuce').textContent = o.astuce;
    if (U.surOutil) U.surOutil();
    U.redessiner();
  };

  U.choisirVue = function (id) {
    var b = document.querySelectorAll('.vue'), i;
    if (!U.VUES.some(function (v) { return v.id === id; })) return;
    U.vue = id;
    for (i = 0; i < b.length; i++) b[i].classList.toggle('actif', b[i].dataset.vue === id);
    if (U.cocher) U.cocher();
    U.redessiner();
  };

  U.initVue = function () {
    scene = $('#scene'); toile = $('#toile'); g = toile.getContext('2d');
    $('#outils').innerHTML = U.OUTILS.map(function (o) {
      return '<button type="button" class="outil" data-outil="' + o.id + '" title="' + o.nom + ' (' + o.touche.toUpperCase() + ')">' + icone(o.svg) + '</button>';
    }).join('');
    $('#vues').innerHTML = U.VUES.map(function (v, i) {
      return '<button type="button" class="vue" data-vue="' + v.id + '" title="' + v.nom + ' (' + (i + 1) + ')"><b>' + (i + 1) + '</b>' + v.nom + '</button>';
    }).join('');
    scene.addEventListener('pointerdown', bas);
    scene.addEventListener('pointermove', bouge);
    scene.addEventListener('pointerup', haut);
    scene.addEventListener('pointercancel', haut);
    scene.addEventListener('pointerleave', function () { if (!geste) { survol = null; if (U.surPosition) U.surPosition(null); U.redessiner(); } });
    scene.addEventListener('wheel', molette, { passive: false });
    scene.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Le clic milieu ne lance pas le défilement automatique du navigateur.
    scene.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    $('#outils').addEventListener('click', function (e) { var b = e.target.closest('.outil'); if (b) { U.choisirOutil(b.dataset.outil); if (U.sauverBientot) U.sauverBientot(); } });
    $('#vues').addEventListener('click', function (e) { var b = e.target.closest('.vue'); if (b) { U.choisirVue(b.dataset.vue); if (U.sauverBientot) U.sauverBientot(); } });
    window.addEventListener('resize', U.redessiner);
    if (window.ResizeObserver) new ResizeObserver(U.redessiner).observe(scene);
  };
})();
