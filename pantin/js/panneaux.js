(function () {
  'use strict';

  var P = window.Pantin, U = P.ui;

  var COL = 14, RANG = 20, TETE = 18;     // frise : largeur d'une image, hauteur d'une piste et de la ligne des numéros
  var DELAI_MSG = 7000;

  var $ = function (s) { return document.querySelector(s); };
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  U.echapper = echapper;

  var OEIL = '<svg viewBox="0 0 20 20"><path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2"/></svg>';
  var OEIL_FERME = '<svg viewBox="0 0 20 20"><path d="M2.5 10s3 4 7.5 4 7.5-4 7.5-4M5 12.5l-1.2 1.800M10 14v2.200M15 12.500l1.200 1.800"/></svg>';

  // ---------- Messages ----------
  var minuterieMsg = null;
  U.dire = function (texte) {
    $('#etatMsg').textContent = texte || '';
    clearTimeout(minuterieMsg);
    if (texte) minuterieMsg = setTimeout(function () { $('#etatMsg').textContent = ''; }, DELAI_MSG);
  };

  // Les pièces dans l'ordre où on les lit : celle de devant en premier.
  U.ordre = function () { return P.doc.pieces.slice().reverse(); };

  U.choisir = function (id) {
    id = P.piece(id) ? id : 0;
    if (id === U.sel) return;
    U.sel = id;
    marquerChoix(); panneauPiece(); dessinerFrise(); U.redessiner();
  };

  // ---------- Liste des pièces ----------
  function listePieces() {
    var l = U.ordre(), z = $('#pieces');
    $('#compte').textContent = l.length ? l.length + ' sur ' + P.PIECES_MAX : '';
    if (!l.length) {
      z.innerHTML = '<p class="vide">Aucune pièce. À l\'étape 1, prends un morceau de la planche avec la baguette puis appuie sur Entrée, ou choisis « Détacher tous les morceaux » dans le menu Pièce.</p>';
      $('#noms').innerHTML = '';
      return;
    }
    z.innerHTML = l.map(function (p) {
      var n = P.profondeur(p), mere = P.piece(p.parent);
      return '<div class="piece' + (p.visible ? '' : ' cache') + '" data-id="' + p.id + '" title="' + echapper(p.nom) + (mere ? ', tenue par ' + echapper(mere.nom) : ', libre') + '">' +
        '<button type="button" class="ico" data-r="visible" title="' + (p.visible ? 'Cacher la pièce' : 'Montrer la pièce') + '">' + (p.visible ? OEIL : OEIL_FERME) + '</button>' +
        '<canvas width="' + p.w + '" height="' + p.h + '"></canvas>' +
        (n ? '<span class="fil">' + new Array(n).join('  ') + '└</span>' : '') + '<span class="nom">' + echapper(p.nom) + '</span></div>';
    }).join('');
    l.forEach(function (p, i) {
      var c = z.children[i].querySelector('canvas'), im = c.getContext('2d').createImageData(p.w, p.h);
      new Uint32Array(im.data.buffer).set(p.pix);
      c.getContext('2d').putImageData(im, 0, 0);
    });
    $('#noms').innerHTML = l.map(function (p) { return '<div data-id="' + p.id + '">' + echapper(p.nom) + '</div>'; }).join('');
    marquerChoix();
  }

  function marquerChoix() {
    var els = document.querySelectorAll('#pieces .piece, #noms div'), i;
    for (i = 0; i < els.length; i++) els[i].classList.toggle('actif', Number(els[i].dataset.id) === U.sel);
  }

  // ---------- Pièce choisie ----------
  function panneauPiece() {
    var p = P.piece(U.sel), anime = U.mode === 'animation', po, cle;
    $('#pPiece').classList.toggle('inerte', !p);
    $('#titrePiece').textContent = p ? p.nom : 'Pièce choisie';
    $('#rPose').classList.toggle('inerte', !anime); $('#rDecal').classList.toggle('inerte', !anime);
    if (!p) { $('#mere').innerHTML = ''; return; }
    $('#mere').innerHTML = '<option value="0">rien (pièce libre)</option>' + U.ordre().filter(function (q) { return !P.descend(q.id, p.id); }).map(function (q) {
      return '<option value="' + q.id + '"' + (q.id === p.parent ? ' selected' : '') + '>' + echapper(q.nom) + '</option>';
    }).join('');
    valeursPiece();
    cle = anime && P.cle(p.id, U.f); po = cle || { l: 'doux' };
    $('#rLissage').classList.toggle('inerte', !cle);
    $('#lissage').value = po.l;
  }

  function valeursPiece() {
    var p = P.piece(U.sel), po, cle;
    if (!p) return;
    po = P.pose(p.id, U.image()); cle = U.mode === 'animation' && P.cle(p.id, U.f);
    if (document.activeElement !== $('#attX')) $('#attX').value = p.px;
    if (document.activeElement !== $('#attY')) $('#attY').value = p.py;
    if (document.activeElement !== $('#poseA')) $('#poseA').value = Math.round(po.a * 100) / 100;
    if (document.activeElement !== $('#poseX')) $('#poseX').value = po.dx;
    if (document.activeElement !== $('#poseY')) $('#poseY').value = po.dy;
    $('#rLissage').classList.toggle('inerte', !cle);
    if (cle) $('#lissage').value = cle.l;
  }

  // ---------- Frise ----------
  function dessinerFrise() {
    var an = P.anim(), l = U.ordre(), c = $('#frise'), g = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    var W = Math.max(an.n * COL + 1, $('#grille').clientWidth), H = Math.max(TETE + l.length * RANG, $('#pistes').clientHeight), f, x, y, i, k, j, mid, choisie, piste;
    c.style.width = W + 'px'; c.style.height = H + 'px';
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#151617'; g.fillRect(0, 0, W, H);
    // Les images de l'animation, par paquets de cinq.
    for (f = 0; f < an.n; f++) { g.fillStyle = Math.floor(f / 5) % 2 ? '#1f2022' : '#1b1c1e'; g.fillRect(f * COL, 0, COL, H); }
    g.fillStyle = '#2b2c2f'; g.fillRect(0, TETE - 1, an.n * COL, 1);
    for (i = 0; i < l.length; i++) {
      y = TETE + i * RANG;
      if (l[i].id === U.sel) { g.fillStyle = 'rgba(255, 255, 255, .07)'; g.fillRect(0, y, an.n * COL, RANG); }
      g.fillStyle = '#26272a'; g.fillRect(0, y + RANG - 1, an.n * COL, 1);
    }
    // L'image en cours.
    x = U.f * COL;
    g.fillStyle = 'rgba(210, 171, 82, .17)'; g.fillRect(x, 0, COL, H);
    g.fillStyle = '#d2ab52'; g.fillRect(x, 0, COL, TETE - 1);
    g.font = '10px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (f = 0; f < an.n; f++) {
      if (f !== U.f && f !== 0 && (f + 1) % 5) continue;
      g.fillStyle = f === U.f ? '#1c1608' : '#909197';
      g.fillText(String(f + 1), f * COL + COL / 2, TETE / 2);
    }
    // Les clés. Leur forme dit comment la pièce repart : rond en douceur, losange régulier, carré par à-coup.
    for (i = 0; i < l.length; i++) {
      piste = an.pistes[l[i].id];
      if (!piste) continue;
      mid = TETE + i * RANG + RANG / 2 - 0.5; choisie = l[i].id === U.sel;
      g.fillStyle = '#5d5e64';
      if (piste.length > 1) {
        if (an.boucle) g.fillRect(0, mid, an.n * COL, 1);
        else g.fillRect(piste[0].f * COL + COL / 2, mid, (piste[piste.length - 1].f - piste[0].f) * COL, 1);
      }
      g.fillStyle = choisie ? '#d2ab52' : '#c4c4c8';
      for (j = 0; j < piste.length; j++) {
        k = piste[j]; x = k.f * COL + COL / 2;
        g.beginPath();
        if (k.l === 'palier') g.rect(x - 4, mid - 3.5, 8, 8);
        else if (k.l === 'lin') { g.moveTo(x, mid - 5); g.lineTo(x + 5, mid + 0.5); g.lineTo(x, mid + 6); g.lineTo(x - 5, mid + 0.5); g.closePath(); }
        else g.arc(x, mid + 0.5, 4.5, 0, 6.2832);
        g.fill();
      }
    }
  }

  U.allerImage = function (f) {
    var n = P.anim().n;
    f = ((Math.round(f) % n) + n) % n;
    if (f === U.f) return;
    U.f = f;
    U.surGeste(); U.redessiner();
  };

  function initFrise() {
    var c = $('#frise'), glisse = false;
    function viser(e, choisir) {
      var r = c.getBoundingClientRect(), an = P.anim(), l = U.ordre();
      var col = P.borne(Math.floor((e.clientX - r.left) / COL), 0, an.n - 1), rang = Math.floor((e.clientY - r.top - TETE) / RANG);
      if (choisir && rang >= 0 && rang < l.length) U.choisir(l[rang].id);
      if (col !== U.f) { U.f = col; U.surGeste(); U.redessiner(); }
      return rang >= 0 && rang < l.length ? l[rang] : null;
    }
    c.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (U.joue) U.lire(false);
      if (U.mode !== 'animation') U.choisirMode('animation');
      glisse = true; c.setPointerCapture(e.pointerId);
      viser(e, true);
    });
    c.addEventListener('pointermove', function (e) { if (glisse) viser(e, false); });
    c.addEventListener('pointerup', function () { glisse = false; });
    c.addEventListener('pointercancel', function () { glisse = false; });
    c.addEventListener('dblclick', function (e) {
      var p = viser(e, true);
      if (p) U.agir(P.cle(p.id, U.f) ? 'cleOter' : 'cle');
    });
    $('#noms').addEventListener('click', function (e) {
      var d = e.target.closest('[data-id]');
      if (d) U.choisir(Number(d.dataset.id));
    });
  }

  // ---------- Aperçu ----------
  function apercu() {
    var d = P.doc, c = $('#apercu'), boite = c.parentNode, k = Math.min((boite.clientWidth - 10) / d.w, (boite.clientHeight - 10) / d.h), im;
    k = k >= 1 ? Math.floor(k) : k > 0 ? k : 1;
    if (c.width !== d.w || c.height !== d.h) { c.width = d.w; c.height = d.h; }
    c.style.width = Math.max(1, Math.round(d.w * k)) + 'px'; c.style.height = Math.max(1, Math.round(d.h * k)) + 'px';
    im = c.getContext('2d').createImageData(d.w, d.h);
    new Uint32Array(im.data.buffer).set(P.composer(U.image()));
    c.getContext('2d').putImageData(im, 0, 0);
    $('#apercuInfo').textContent = k >= 1 ? '×' + k : 'réduit';
  }

  // ---------- Lecture ----------
  var dernierTemps = 0, reste = 0;
  function tic(t) {
    var an = P.anim(), duree = 1000 / an.cadence, avance = 0;
    if (!U.joue) return;
    reste += Math.min(250, t - dernierTemps); dernierTemps = t;
    while (reste >= duree) { reste -= duree; avance++; }
    if (avance) {
      if (!an.boucle && U.f + avance >= an.n - 1) { U.f = an.n - 1; U.lire(false); U.surGeste(); U.redessiner(); return; }
      U.f = (U.f + avance) % an.n;
      U.surGeste(); U.redessiner();
    }
    requestAnimationFrame(tic);
  }
  // Sans argument : bascule.
  U.lire = function (etat) {
    var an = P.anim();
    etat = etat === undefined ? !U.joue : etat;
    if (etat === U.joue) return;
    if (etat && an.n < 2) { U.dire('Cette animation n\'a qu\'une image.'); return; }
    U.joue = etat;
    $('#bLire').textContent = etat ? '■ Arrêter' : '▶ Lire';
    if (etat) {
      if (U.mode !== 'animation') U.choisirMode('animation');
      if (!an.boucle && U.f >= an.n - 1) U.f = 0;
      dernierTemps = performance.now(); reste = 0;
      requestAnimationFrame(tic);
    }
  };

  // ---------- Rafraîchissement ----------
  // Pendant un geste ou la lecture : seulement ce qui dépend de la pose et de l'image en cours.
  U.surGeste = function () {
    valeursPiece(); dessinerFrise(); apercu();
  };

  U.rafraichir = function () {
    var d = P.doc, an = P.anim();
    if (!P.piece(U.sel)) U.sel = 0;
    if (U.f >= an.n) U.f = an.n - 1;
    listePieces(); panneauPiece();
    $('#anims').innerHTML = d.anims.map(function (a, i) { return '<option value="' + i + '"' + (i === d.iAnim ? ' selected' : '') + '>' + echapper(a.nom) + '</option>'; }).join('');
    if (document.activeElement !== $('#longueur')) $('#longueur').value = an.n;
    if (document.activeElement !== $('#cadence')) $('#cadence').value = an.cadence;
    $('#boucle').checked = an.boucle;
    if (document.activeElement !== $('#cadreW')) $('#cadreW').value = d.w;
    if (document.activeElement !== $('#cadreH')) $('#cadreH').value = d.h;
    $('#soigne').checked = d.soigne;
    $('#oignon').checked = U.oignon;
    $('#bAnnuler').disabled = !P.peutAnnuler(); $('#bRetablir').disabled = !P.peutRetablir();
    document.querySelector('.frise').classList.toggle('repos', U.mode !== 'animation');
    $('#etatInfo').textContent = d.pieces.length + (d.pieces.length > 1 ? ' pièces' : ' pièce') + ', « ' + an.nom + ' » : ' + an.n + (an.n > 1 ? ' images' : ' image') + ' à ' + an.cadence + ' i/s';
    dessinerFrise(); apercu();
    U.redessiner();
  };

  // ---------- Champs ----------
  function nombre(el) { var v = Number(el.value); return el.value !== '' && isFinite(v) ? v : null; }

  U.initPanneaux = function () {
    $('#pieces').addEventListener('click', function (e) {
      var r = e.target.closest('.piece'), p;
      if (!r) return;
      p = P.piece(Number(r.dataset.id));
      if (e.target.closest('[data-r=visible]')) { P.marquer(); p.visible = !p.visible; P.change(); }
      else U.choisir(p.id);
    });
    $('#pieces').addEventListener('dblclick', function (e) { if (e.target.closest('.nom')) U.agir('pieceRenommer'); });

    $('#mere').addEventListener('change', function () {
      var p = P.piece(U.sel);
      if (!p) return;
      P.marquer(); P.lier(p, Number(this.value)); P.change();
    });
    ['attX', 'attY'].forEach(function (id) {
      $('#' + id).addEventListener('change', function () {
        var p = P.piece(U.sel), x = nombre($('#attX')), y = nombre($('#attY'));
        if (!p || x === null || y === null) return;
        P.marquer(); P.poserAttache(p, x, y); P.change();
      });
    });
    [['poseA', 'a'], ['poseX', 'dx'], ['poseY', 'dy']].forEach(function (c) {
      $('#' + c[0]).addEventListener('change', function () {
        var v = nombre(this), o = {};
        if (!P.piece(U.sel) || v === null || U.mode !== 'animation') return;
        o[c[1]] = v;
        P.marquer(); P.poserCle(U.sel, U.f, o); P.change();
      });
    });
    $('#lissage').addEventListener('change', function () {
      if (!P.cle(U.sel, U.f)) return;
      P.marquer(); P.poserCle(U.sel, U.f, { l: this.value }); P.change();
    });
    ['cadreW', 'cadreH'].forEach(function (id) {
      $('#' + id).addEventListener('change', function () {
        var w = nombre($('#cadreW')), h = nombre($('#cadreH'));
        if (w !== null && h !== null) P.reglerCadre(w, h);
        U.rafraichir();
      });
    });
    $('#soigne').addEventListener('change', function () { P.marquer(); P.doc.soigne = this.checked; P.change(); });
    $('#cran').addEventListener('change', function () { U.cran = Number(this.value) || 0; });

    $('#anims').addEventListener('change', function () {
      if (U.joue) U.lire(false);
      P.doc.iAnim = P.borne(Number(this.value) || 0, 0, P.doc.anims.length - 1);
      U.f = 0;
      P.change();
    });
    $('#longueur').addEventListener('change', function () { var v = nombre(this); if (v !== null) P.animLongueur(v); U.rafraichir(); });
    $('#cadence').addEventListener('change', function () {
      var v = nombre(this);
      if (v !== null) { P.marquer(); P.anim().cadence = P.borne(Math.round(v) || 1, 1, 60); P.change(); }
      U.rafraichir();
    });
    $('#boucle').addEventListener('change', function () { P.marquer(); P.anim().boucle = this.checked; P.change(); });
    $('#oignon').addEventListener('change', function () { U.oignon = this.checked; U.rafraichir(); });
    initFrise();
    if (window.ResizeObserver) new ResizeObserver(function () { dessinerFrise(); apercu(); }).observe($('#pistes'));
  };
})();
