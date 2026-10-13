(function () {
  'use strict';

  var E = window.Eclairage, U = E.ui;

  var DELAI_MSG = 7000;
  var DELAI_ROSE = 140;          // les huit versions de la rose se recalculent après ce temps de calme
  var CASES = 15;                // la boule des normales fait 15 pixels de diamètre
  var GELATINE = '#ee8a3c';
  var SENS = ['en haut', 'en haut à droite', 'à droite', 'en bas à droite', 'en bas', 'en bas à gauche', 'à gauche', 'en haut à gauche'];

  var $ = function (s) { return document.querySelector(s); };
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  U.echapper = echapper;

  // ---------- Messages ----------
  var minuterieMsg = null;
  U.dire = function (texte) {
    $('#etatMsg').textContent = texte || '';
    clearTimeout(minuterieMsg);
    if (texte) minuterieMsg = setTimeout(function () { $('#etatMsg').textContent = ''; }, DELAI_MSG);
  };

  function gris(v) { return 'rgb(' + v + ',' + v + ',' + v + ')'; }
  function valeur(el, v) { if (document.activeElement !== el) el.value = v; }

  // ---------- Réglages de l'outil ----------
  U.surOutil = function () {
    var o = U.o, els = document.querySelectorAll('#pOutil [data-pour]'), i;
    for (i = 0; i < els.length; i++) els[i].hidden = els[i].dataset.pour.split(' ').indexOf(U.outil) < 0;
    valeur($('#oTaille'), o.taille); $('#vTaille').textContent = o.taille;
    valeur($('#oHauteur'), o.hauteur); valeur($('#nHauteur'), o.hauteur); $('#pHauteur').style.background = gris(o.hauteur);
    valeur($('#oH2'), o.h2); valeur($('#nH2'), o.h2); $('#pH2').style.background = gris(o.h2);
    $('#lHauteur').textContent = U.outil === 'degrade' ? 'Départ' : U.outil === 'pente' ? 'Sommet' : 'Hauteur';
    $('#oMode').value = o.mode; $('#oForme').value = o.forme; $('#oBombe').checked = o.bombe;
    $('#oProfil').value = o.profil; $('#oAjouter').checked = o.ajouter;
    valeur($('#oLargeur'), o.largeur); $('#vLargeur').textContent = o.largeur + ' px';
    $('#oZone').value = o.zone;
    valeur($('#oForce'), o.force); $('#vForce').textContent = Math.round(o.force * 100) + ' %';
    $('#oEffacer').checked = o.effacer;
    if (U.outil === 'normale' || U.outil === 'pipette') bouleNormale();
    $('#oHauteur').closest('.rang').hidden = $('#oHauteur').closest('.rang').hidden || (U.outil === 'pinceau' && o.mode !== 'poser');
  };

  // Ce que dit une normale, en mots.
  function decrire(n) {
    var v = E.lireNormale(n), pente = Math.round(Math.acos(E.borne(v[2], -1, 1)) * 180 / Math.PI), a;
    if (pente < 8) return 'Regarde droit vers toi.';
    a = (Math.atan2(v[0], -v[1]) * 180 / Math.PI + 360) % 360;
    return 'Regarde ' + SENS[Math.round(a / 45) % 8] + ', penchée de ' + pente + '°.';
  }

  // La boule des normales : chaque pixel est une direction. On clique celle à peindre.
  function caseNormale(i, j) {
    var r = (CASES - 1) / 2 + 0.5, u = (i + 0.5 - r) / r, v = (j + 0.5 - r) / r, d = u * u + v * v;
    if (d > 1) return 0;
    return E.coderNormale(u, v, Math.sqrt(1 - d));
  }
  function bouleNormale() {
    var c = $('#bouleNormale'), k = Math.max(4, Math.floor(Math.min(150, c.parentNode.clientWidth - 20) / CASES)), S = k * CASES, g, i, j, n, choix = U.o.normale, mieux = null, dmin = Infinity, a = E.lireNormale(choix), b, dd;
    if (c.width !== S) { c.width = S; c.height = S; c.style.width = S + 'px'; c.style.height = S + 'px'; }
    g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    for (j = 0; j < CASES; j++) for (i = 0; i < CASES; i++) {
      n = caseNormale(i, j);
      if (!n) continue;
      g.fillStyle = E.versHex(n); g.fillRect(i * k, j * k, k, k);
      b = E.lireNormale(n); dd = (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);
      if (dd < dmin) { dmin = dd; mieux = [i, j]; }
    }
    if (mieux) {
      g.strokeStyle = '#1d1206'; g.lineWidth = 3; g.strokeRect(mieux[0] * k - 0.5, mieux[1] * k - 0.5, k + 1, k + 1);
      g.strokeStyle = GELATINE; g.lineWidth = 2; g.strokeRect(mieux[0] * k - 0.5, mieux[1] * k - 0.5, k + 1, k + 1);
    }
    $('#infoNormale').textContent = U.o.effacer ? 'Le pinceau retire les normales peintes : la hauteur reprend la main.' : decrire(choix);
  }
  function initBouleNormale() {
    var c = $('#bouleNormale'), appui = false;
    function viser(e) {
      var r = c.getBoundingClientRect(), k = r.width / CASES, i = Math.floor((e.clientX - r.left) / k), j = Math.floor((e.clientY - r.top) / k), n;
      n = caseNormale(E.borne(i, 0, CASES - 1), E.borne(j, 0, CASES - 1));
      if (!n) return;
      U.o.normale = n; U.o.effacer = false;
      if (U.outil !== 'normale') U.choisirOutil('normale'); else U.surOutil();
    }
    c.addEventListener('pointerdown', function (e) { appui = true; c.setPointerCapture(e.pointerId); viser(e); });
    c.addEventListener('pointermove', function (e) { if (appui) viser(e); });
    c.addEventListener('pointerup', function () { appui = false; });
    c.addEventListener('pointercancel', function () { appui = false; });
  }

  // ---------- Lumière : la boule grise et sa rose ----------
  var rose = { S: 0, rb: 0, rr: 0, b: 0, vignettes: null, cle: '', minuterie: null, boule: null, cleBoule: '' };
  function sigRose() { var R = E.doc.reglages, s = E.rev + ':' + E.revPalette + ':' + E.doc.iImage + ':', k; for (k in R) if (k !== 'az' && k !== 'prereglage') s += R[k] + '|'; return s; }
  function sigBoule() { var R = E.doc.reglages; return [R.az, R.el, R.couleur, R.intensite, R.ambiante, R.ambI, R.rim, R.rimCouleur, R.rimI, R.spec, R.specI].join('|'); }

  function calculerVignettes() {
    var d = E.doc, k;
    rose.vignettes = [];
    for (k = 0; k < 8; k++) rose.vignettes.push(U.versToile(E.eclairer(d.iImage, d.reglages, k * 45), d.w, d.h));
    rose.cle = sigRose();
  }
  U.roseBientot = function () {
    clearTimeout(rose.minuterie);
    rose.minuterie = setTimeout(function () { calculerVignettes(); dessinerRose(); }, DELAI_ROSE);
  };

  // La boule grise, rendue avec la vraie lumière : mate, d'un gris à 18 %, sans quantification.
  function rendreBoule(px) {
    var R = E.doc.reglages, L = E.direction(R.az, R.el), lum = E.hexLin(R.couleur), amb = E.hexLin(R.ambiante), rim = E.hexLin(R.rimCouleur);
    var c = document.createElement('canvas'), g, im, d, x, y, u, v, r2, nz, df, s, rr, k, al, col, Hx, Hy, Hz, hl, lxy, rx, ry, i;
    for (k = 0; k < 3; k++) { lum[k] *= R.intensite; amb[k] *= R.ambI; rim[k] *= R.rim ? R.rimI : 0; }
    Hx = L[0]; Hy = L[1]; Hz = L[2] + 1; hl = Math.sqrt(Hx * Hx + Hy * Hy + Hz * Hz); Hx /= hl; Hy /= hl; Hz /= hl;
    lxy = Math.sqrt(L[0] * L[0] + L[1] * L[1]); rx = lxy > 1e-6 ? -L[0] / lxy : 0; ry = lxy > 1e-6 ? -L[1] / lxy : 1;
    c.width = c.height = px; g = c.getContext('2d'); im = g.createImageData(px, px); d = im.data;
    for (y = 0; y < px; y++) for (x = 0; x < px; x++) {
      u = (x + 0.5) / px * 2 - 1; v = (y + 0.5) / px * 2 - 1; r2 = u * u + v * v;
      if (r2 > 1) continue;
      nz = Math.sqrt(1 - r2);
      df = Math.max(0, u * L[0] + v * L[1] + nz * L[2]);
      s = R.spec && df > 0 ? Math.pow(Math.max(0, u * Hx + v * Hy + nz * Hz), 24) * R.specI : 0;
      rr = (1 - nz) * (1 - nz) * Math.max(0, u * rx + v * ry) * 1.6;
      i = (y * px + x) * 4;
      for (k = 0; k < 3; k++) {
        col = 0.18 * (amb[k] + lum[k] * df) + lum[k] * s + rim[k] * rr * 0.508;
        d[i + k] = Math.round(255 * (col <= 0.0031308 ? col * 12.92 : Math.min(1, 1.055 * Math.pow(col, 1 / 2.4) - 0.055)));
      }
      al = Math.min(1, (1 - Math.sqrt(r2)) * px / 2 + 0.3);
      d[i + 3] = Math.round(255 * al);
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  function dessinerRose() {
    var c = $('#rose'), dpr = window.devicePixelRatio || 1, S = Math.max(180, Math.min(226, c.parentNode.clientWidth - 22)), d = E.doc, R = d.reglages;
    var g, cx, k, a, x, y, b, kk, w, h, L, mx, my, choisie, pb;
    if (rose.S !== S || c.width !== Math.round(S * dpr)) {
      rose.S = S; c.width = Math.round(S * dpr); c.height = Math.round(S * dpr); c.style.width = S + 'px'; c.style.height = S + 'px';
      rose.rb = Math.round(S * 0.2); rose.rr = S * 0.38; rose.b = Math.round(S * 0.215);
    }
    if (!rose.vignettes || rose.cle !== sigRose()) { if (!rose.vignettes) calculerVignettes(); else U.roseBientot(); }
    g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S); g.imageSmoothingEnabled = false;
    cx = S / 2; b = rose.b; L = E.direction(R.az, R.el);
    // L'aiguille : de la boule vers la version qui regarde dans la même direction.
    a = R.az * Math.PI / 180;
    g.strokeStyle = 'rgba(238, 138, 60, .55)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx + Math.sin(a) * rose.rb, cx - Math.cos(a) * rose.rb); g.lineTo(cx + Math.sin(a) * (rose.rr - b * 0.62), cx - Math.cos(a) * (rose.rr - b * 0.62)); g.stroke();
    choisie = Math.round(R.az / 45) % 8;
    if (Math.abs(((R.az - choisie * 45) + 540) % 360 - 180) > 6) choisie = -1;
    w = d.w; h = d.h; kk = (b - 6) / Math.max(w, h); if (kk >= 1) kk = Math.floor(kk);
    for (k = 0; k < 8; k++) {
      a = k * Math.PI / 4; x = Math.round(cx + Math.sin(a) * rose.rr - b / 2); y = Math.round(cx - Math.cos(a) * rose.rr - b / 2);
      g.fillStyle = '#2a2b2d'; g.fillRect(x, y, b, b);
      g.strokeStyle = k === choisie ? GELATINE : '#3d3e43'; g.lineWidth = k === choisie ? 2 : 1;
      g.strokeRect(x + (k === choisie ? 1 : 0.5), y + (k === choisie ? 1 : 0.5), b - (k === choisie ? 2 : 1), b - (k === choisie ? 2 : 1));
      if (rose.vignettes) g.drawImage(rose.vignettes[k], Math.round(x + (b - w * kk) / 2), Math.round(y + (b - h * kk) / 2), Math.round(w * kk), Math.round(h * kk));
    }
    pb = Math.round(rose.rb * 2 * dpr);
    if (rose.cleBoule !== sigBoule() + pb) { rose.boule = rendreBoule(pb); rose.cleBoule = sigBoule() + pb; }
    g.imageSmoothingEnabled = true;
    g.drawImage(rose.boule, cx - rose.rb, cx - rose.rb, rose.rb * 2, rose.rb * 2);
    // Le point de la boule qui fait face à la lumière : la source elle-même, à sa couleur.
    mx = cx + L[0] * rose.rb; my = cx + L[1] * rose.rb;
    g.beginPath(); g.arc(mx, my, 5.5, 0, 6.2832); g.fillStyle = R.couleur; g.fill();
    g.lineWidth = 2; g.strokeStyle = GELATINE; g.stroke();
    g.beginPath(); g.arc(mx, my, 8.5, 0, 6.2832); g.lineWidth = 1; g.strokeStyle = 'rgba(20, 20, 20, .7)'; g.stroke();
  }

  function initRose() {
    var c = $('#rose'), mode = null;
    function viser(e, debut) {
      var r = c.getBoundingClientRect(), x = e.clientX - r.left - rose.S / 2, y = e.clientY - r.top - rose.S / 2, dist = Math.sqrt(x * x + y * y), R = E.doc.reglages, k, a, vx, vy;
      if (debut) {
        mode = dist <= rose.rb + 4 ? 'boule' : 'anneau';
        if (mode === 'anneau') {
          // Un clic sur une version donne exactement sa direction.
          for (k = 0; k < 8; k++) {
            a = k * Math.PI / 4; vx = Math.sin(a) * rose.rr; vy = -Math.cos(a) * rose.rr;
            if (Math.abs(x - vx) <= rose.b / 2 && Math.abs(y - vy) <= rose.b / 2) { R.az = k * 45; mode = null; changeLumiere(); return; }
          }
        }
      }
      if (dist < 1) return;
      R.az = Math.round((Math.atan2(x, -y) * 180 / Math.PI + 360) % 360) % 360;
      if (mode === 'boule') R.el = Math.round(Math.acos(Math.min(1, dist / rose.rb)) * 180 / Math.PI);
      changeLumiere();
    }
    c.addEventListener('pointerdown', function (e) { if (e.button !== 0) return; U.tourner(false); c.setPointerCapture(e.pointerId); viser(e, true); });
    c.addEventListener('pointermove', function (e) { if (mode) viser(e, false); });
    c.addEventListener('pointerup', function () { mode = null; });
    c.addEventListener('pointercancel', function () { mode = null; });
  }

  // Après un changement de lumière fait à la main : l'ambiance choisie devient « sur mesure ».
  function changeLumiere(garderPre) {
    if (!garderPre) E.doc.reglages.prereglage = '';
    U.surLumiere(); U.redessiner();
    if (U.cocher) U.cocher();
    if (U.sauverBientot) U.sauverBientot();
  }
  U.changeLumiere = changeLumiere;

  // rapide : pendant que la lumière tourne, seulement ce qui dépend de l'azimut.
  U.surLumiere = function (rapide) {
    var R = E.doc.reglages;
    valeur($('#rAz'), Math.round(R.az) % 360); valeur($('#rEl'), Math.round(R.el));
    dessinerRose();
    if (rapide) return;
    $('#rPre').value = R.prereglage || '';
    valeur($('#rCouleur'), R.couleur); valeur($('#rIntensite'), R.intensite);
    valeur($('#rAmbiante'), R.ambiante); valeur($('#rAmbI'), R.ambI);
    $('#rRim').checked = R.rim; valeur($('#rRimCouleur'), R.rimCouleur); valeur($('#rRimI'), R.rimI);
    $('#rSpec').checked = R.spec; valeur($('#rSpecI'), R.specI);
    $('#rOmbres').checked = R.ombres;
    $('#rRimI').disabled = !R.rim; $('#rRimCouleur').disabled = !R.rim; $('#rSpecI').disabled = !R.spec;
    valeur($('#rProfondeur'), R.profondeur); $('#vProfondeur').textContent = R.profondeur + ' px';
    $('#rRendu').value = R.rendu; $('#rTrame').checked = R.trame; $('#rTrame').disabled = R.rendu === 'libre';
    $('#rAplanir').checked = R.aplanir; $('#rTraitGarde').checked = R.trait;
    $('#bTourner').classList.toggle('allume', U.tourne);
    rampes();
  };

  U.appliquerPrereglage = function (id) {
    var p = E.PREREGLAGES.filter(function (x) { return x.id === id; })[0], R = E.doc.reglages, k;
    if (!p) return;
    for (k in p.r) R[k] = p.r[k];
    R.prereglage = id;
    changeLumiere(true);
    U.dire('Ambiance « ' + p.nom + ' ».');
  };

  // ---------- Rampes ----------
  function rampes() {
    var A = E.analyse(), R = E.doc.reglages, c = $('#toileRampes'), K = 12, G = 4, n = A.rampes.length, haut = 0, dpr = window.devicePixelRatio || 1, W, H, g;
    A.rampes.forEach(function (r) { haut = Math.max(haut, r.length); });
    haut = Math.min(haut, 12);
    W = Math.max(1, n * K + (n - 1) * G); H = Math.max(1, haut * K);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px';
    g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Une colonne par rampe, l'ombre en bas et la lumière en haut ; le trait est barré, le ton du milieu marqué.
    // Une rampe trop longue est montrée par échantillons.
    A.rampes.forEach(function (r, i) {
      var x = i * (K + G), n = Math.min(r.length, haut), ref = Math.round(Math.floor(r.length / 2) * (n - 1) / Math.max(1, r.length - 1)), j, vus = [];
      for (j = 0; j < n; j++) vus.push(r[n === r.length ? j : Math.round(j * (r.length - 1) / (n - 1))]);
      vus.forEach(function (m, j) {
        var y = H - (j + 1) * K;
        g.fillStyle = E.versHex(m.c); g.fillRect(x, y, K, K);
        if (m.c === A.trait && R.trait) { g.strokeStyle = '#909197'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 2, y + K - 2); g.lineTo(x + K - 2, y + 2); g.stroke(); }
        if (R.aplanir && j === ref && R.rendu !== 'palette') { g.fillStyle = GELATINE; g.fillRect(x, y + K / 2 - 1, 2, 2); }
      });
    });
    $('#compteRampes').textContent = A.palette.length + ' couleurs, ' + n + (n > 1 ? ' rampes' : ' rampe');
    $('#rampes').title = 'Palette ' + (E.doc.paletteNom || 'du sprite') + ', une colonne par rampe, de l\'ombre en bas à la lumière en haut. ' + (R.rendu === 'libre' ? 'En couleurs libres, elle ne sert pas.' : R.rendu === 'palette' ? 'Chaque pixel prend la couleur la plus proche de toute la palette.' : 'Chaque pixel reste dans sa rampe, au ton le plus proche en clarté.');
    $('#bPaletteSprite').disabled = !E.doc.palette;
    $('#compteRampes').title = A.tronque ? 'Plus de 256 couleurs : les autres suivent la rampe de la couleur la plus proche.' : '';
  }

  // ---------- Frise des images ----------
  function frise() {
    var d = E.doc, z = $('#images'), H = 40, k;
    $('#frise').hidden = d.images.length < 2;
    if (d.images.length < 2) return;
    k = Math.max(1, Math.floor(H / d.h)); if (d.h * k > H) k = H / d.h;
    z.innerHTML = d.images.map(function (im, i) { return '<button type="button" data-i="' + i + '" title="Image ' + (i + 1) + '"><span>' + (i + 1) + '</span><canvas width="' + d.w + '" height="' + d.h + '" style="width:' + Math.round(d.w * k) + 'px;height:' + Math.round(d.h * k) + 'px"></canvas></button>'; }).join('');
    d.images.forEach(function (im, i) { U.versToile(im.pix, d.w, d.h, z.children[i].querySelector('canvas')); z.children[i].classList.toggle('actif', i === d.iImage); });
  }
  U.allerImage = function (i) {
    var d = E.doc;
    i = ((i % d.images.length) + d.images.length) % d.images.length;
    if (i === d.iImage) return;
    d.iImage = i;
    U.rafraichir();
    if (U.sauverBientot) U.sauverBientot();
  };

  // ---------- Barre d'état ----------
  U.surPosition = function (q) {
    var d = E.doc, im = d.images[d.iImage], p;
    if (!q) { $('#etatPos').textContent = '–'; return; }
    p = q.y * d.w + q.x;
    $('#etatPos').textContent = q.x + ', ' + q.y + (im.pix[p] ? ' : hauteur ' + im.haut[p] + (im.norm[p] ? ', normale peinte' : '') : ' : transparent');
  };

  // ---------- Rafraîchissement ----------
  U.rafraichir = function () {
    var d = E.doc, A = E.analyse();
    $('#bAnnuler').disabled = !E.peutAnnuler(); $('#bRetablir').disabled = !E.peutRetablir();
    U.surOutil(); U.surLumiere(); frise();
    $('#etatInfo').textContent = d.nom + ', ' + d.w + ' × ' + d.h + ' px' + (d.images.length > 1 ? ', ' + d.images.length + ' images' : '') + (A.trait ? ', trait ' + E.versHex(A.trait) : '');
    if (U.cocher) U.cocher();
    U.redessiner();
  };

  // ---------- Champs ----------
  function nombre(el) { var v = Number(el.value); return el.value !== '' && isFinite(v) ? v : null; }

  U.initPanneaux = function () {
    var R = function () { return E.doc.reglages; };
    function lier(id, cle, conv, apres) {
      $('#' + id).addEventListener('input', function () {
        var v = conv(this);
        if (v === null) return;
        U.o[cle] = v; U.surOutil(); U.redessiner();
        if (U.sauverBientot) U.sauverBientot();
        if (apres) apres();
      });
    }
    lier('oTaille', 'taille', function (el) { return Math.round(nombre(el)); });
    lier('oHauteur', 'hauteur', function (el) { return Math.round(nombre(el)); });
    lier('nHauteur', 'hauteur', function (el) { var v = nombre(el); return v === null ? null : E.borne(Math.round(v), 0, 255); });
    lier('oH2', 'h2', function (el) { return Math.round(nombre(el)); });
    lier('nH2', 'h2', function (el) { var v = nombre(el); return v === null ? null : E.borne(Math.round(v), 0, 255); });
    lier('oLargeur', 'largeur', function (el) { return Math.round(nombre(el)); });
    lier('oForce', 'force', function (el) { return nombre(el); });
    [['oMode', 'mode'], ['oForme', 'forme'], ['oProfil', 'profil'], ['oZone', 'zone']].forEach(function (c) {
      $('#' + c[0]).addEventListener('change', function () { U.o[c[1]] = this.value; U.surOutil(); if (U.sauverBientot) U.sauverBientot(); });
    });
    [['oBombe', 'bombe'], ['oAjouter', 'ajouter'], ['oEffacer', 'effacer']].forEach(function (c) {
      $('#' + c[0]).addEventListener('change', function () { U.o[c[1]] = this.checked; U.surOutil(); U.redessiner(); if (U.sauverBientot) U.sauverBientot(); });
    });
    initBouleNormale();

    // Lumière : les réglages ne passent pas par l'historique, ils se sauvent avec le projet.
    function regler(id, cle, conv, evt) {
      $('#' + id).addEventListener(evt || 'input', function () {
        var v = conv(this);
        if (v === null) return;
        R()[cle] = v;
        changeLumiere();
      });
    }
    function num(min, max, rond) { return function (el) { var v = nombre(el); return v === null ? null : E.borne(rond ? Math.round(v) : v, min, max); }; }
    function texte(el) { return el.value; }
    function coche(el) { return el.checked; }
    $('#rAz').addEventListener('input', function () { var v = nombre(this); if (v === null) return; U.tourner(false); R().az = ((Math.round(v) % 360) + 360) % 360; changeLumiere(); });
    regler('rEl', 'el', num(0, 90, true));
    regler('rCouleur', 'couleur', texte); regler('rIntensite', 'intensite', num(0, 2));
    regler('rAmbiante', 'ambiante', texte); regler('rAmbI', 'ambI', num(0, 1));
    regler('rRim', 'rim', coche, 'change'); regler('rRimCouleur', 'rimCouleur', texte); regler('rRimI', 'rimI', num(0, 1));
    regler('rSpec', 'spec', coche, 'change'); regler('rSpecI', 'specI', num(0, 1));
    regler('rOmbres', 'ombres', coche, 'change');
    // Les réglages du rendu ne changent pas l'ambiance choisie.
    function rendu(id, cle, conv, evt) {
      $('#' + id).addEventListener(evt || 'change', function () { var v = conv(this); if (v === null) return; R()[cle] = v; changeLumiere(true); });
    }
    rendu('rProfondeur', 'profondeur', num(1, 32, true), 'input');
    rendu('rRendu', 'rendu', texte); rendu('rTrame', 'trame', coche); rendu('rAplanir', 'aplanir', coche); rendu('rTraitGarde', 'trait', coche);
    $('#rPre').innerHTML = '<option value="">sur mesure</option>' + E.PREREGLAGES.map(function (p) { return '<option value="' + p.id + '">' + echapper(p.nom) + '</option>'; }).join('');
    $('#rPre').addEventListener('change', function () { if (this.value) U.appliquerPrereglage(this.value); });
    initRose();

    $('#cTrait').addEventListener('change', function () { U.trait = this.checked; U.redessiner(); if (U.cocher) U.cocher(); if (U.sauverBientot) U.sauverBientot(); });
    $('#cPelure').addEventListener('change', function () { U.pelure = this.checked; U.redessiner(); if (U.cocher) U.cocher(); if (U.sauverBientot) U.sauverBientot(); });
    $('#images').addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) U.allerImage(Number(b.dataset.i)); });
    if (window.ResizeObserver) new ResizeObserver(function () { dessinerRose(); }).observe(document.querySelector('.cote'));
  };
})();
