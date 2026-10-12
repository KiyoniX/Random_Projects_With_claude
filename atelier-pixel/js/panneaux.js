(function () {
  'use strict';

  var A = window.Atelier, U = A.ui;

  var VIGNETTE = 52;            // côté maximal d'une vignette de la frise, en pixels d'écran
  var APERCU = [214, 84];      // place disponible pour l'aperçu ajusté

  var OUTILS = [
    { id: 'crayon', nom: 'Crayon', touche: 'B', astuce: 'Clic gauche : couleur principale · clic droit : secondaire · Alt : pipette', icone: '<path d="M3 17l1-4 9-9 3 3-9 9z"/><path d="M11.5 5.5l3 3"/>' },
    { id: 'gomme', nom: 'Gomme', touche: 'E', astuce: 'Efface les pixels du calque actif', icone: '<path d="M8 16l-4-4 8-8 5 5-7 7z"/><path d="M8 8l5 5M4 17h13"/>' },
    { id: 'pot', nom: 'Pot de peinture', touche: 'G', astuce: 'Remplit la zone cliquée, ou toute la couleur si « Zone contiguë » est décoché · Alt : pipette', icone: '<path d="M4 11l6-6 6 6-6 6z"/><path d="M10 5V2M4 11h12"/><path d="M17 14c.8 1.3 1.2 2 1.2 2.8a1.2 1.2 0 0 1-2.4 0c0-.8.4-1.5 1.2-2.8z"/>' },
    { id: 'pipette', nom: 'Pipette', touche: 'I', astuce: 'Prélève la couleur visible · clic gauche : principale · clic droit : secondaire', icone: '<path d="M13 3l4 4-2 2-4-4z"/><path d="M12 6l-8 8v3h3l8-8"/>' },
    { id: 'ligne', nom: 'Ligne', touche: 'L', astuce: 'Maj : angles de 45°', icone: '<path d="M3 17L17 3"/>' },
    { id: 'rect', nom: 'Rectangle', touche: 'R', astuce: 'Maj : carré', icone: '<path d="M3 5h14v10H3z"/>' },
    { id: 'ellipse', nom: 'Ellipse', touche: 'O', astuce: 'Maj : cercle', icone: '<ellipse cx="10" cy="10" rx="7" ry="5.5"/>' },
    { id: 'trame', nom: 'Tramage', touche: 'T', astuce: 'Peint un damier des deux couleurs ; une couleur secondaire transparente laisse un pixel sur deux intact', icone: '<path class="plein" d="M3 3h3.5v3.5H3zM10 3h3.5v3.5H10zM6.5 6.5H10V10H6.5zM13.5 6.5H17V10h-3.5zM3 10h3.5v3.5H3zM10 10h3.5v3.5H10zM6.5 13.5H10V17H6.5zM13.5 13.5H17V17h-3.5z"/>' },
    { id: 'degrade', nom: 'Dégradé', touche: 'D', astuce: 'Glisse de la couleur principale vers la secondaire ; limité à la sélection s\'il y en a une', icone: '<path d="M3 4h14v12H3z"/><path class="plein" d="M3 4h5v12H3zM9.5 4h2v12h-2zM13 4h1v12h-1z"/>' },
    { id: 'eclaircir', nom: 'Éclaircir / assombrir', touche: 'U', astuce: 'Clic gauche : éclaircir · clic droit : assombrir', icone: '<circle cx="10" cy="10" r="3.5"/><path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8"/>' },
    { id: 'selection', nom: 'Sélection rectangulaire', touche: 'M', astuce: 'Glisser : sélectionner · glisser dans la sélection : la déplacer · clic : désélectionner · Maj : carré', icone: '<path stroke-dasharray="2.5 2" d="M3.5 4.5h13v11h-13z"/>' },
    { id: 'baguette', nom: 'Baguette magique', touche: 'W', astuce: 'Sélectionne les pixels de la même couleur sur le calque actif', icone: '<path d="M3 17l8-8"/><path d="M14 2v3M14 9v3M9 7h3M16 7h3M10.5 3.5l1.5 1.5M17.5 3.5L16 5M17.5 10.5L16 9"/>' },
    { id: 'deplacer', nom: 'Déplacer', touche: 'V', astuce: 'Déplace la sélection, ou tout le contenu du calque s\'il n\'y en a pas', icone: '<path d="M10 2v16M2 10h16M10 2L7.5 4.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5"/>' },
    { id: 'main', nom: 'Main', touche: 'H', astuce: 'Déplace la vue ; marche aussi avec Espace + glisser ou le clic du milieu', icone: '<path d="M6.5 11V5.2a1.2 1.2 0 0 1 2.4 0V9.5 3.7a1.2 1.2 0 0 1 2.4 0V9.5 4.7a1.2 1.2 0 0 1 2.4 0V10 7.2a1.2 1.2 0 0 1 2.4 0V13c0 3-2 5-5 5-2.5 0-3.8-1-5-3l-2.3-3.7c-.7-1.2.9-2.3 1.9-1.3z"/>' }
  ];
  var ICONES = {
    oeil: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.2"/>',
    oeilFerme: '<path d="M2 10s3 4 8 4 8-4 8-4M5 12.5L3.5 15M10 14v3M15 12.5l1.5 2.5"/>',
    verrou: '<path d="M5 9h10v8H5z"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
    ouvert: '<path d="M5 9h10v8H5z"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1"/>'
  };
  U.OUTILS = OUTILS;

  var $ = function (s) { return document.querySelector(s); };
  function svg(d) { return '<svg viewBox="0 0 20 20" aria-hidden="true">' + d + '</svg>'; }
  function css(c) { var p = A.comp(c); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + (p[3] / 255).toFixed(3) + ')'; }
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function borne(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------- Outils et options ----------
  U.choisirOutil = function (id) {
    var o = OUTILS.filter(function (t) { return t.id === id; })[0], els, i, pour;
    if (!o) return;
    U.outil = id;
    els = document.querySelectorAll('.outil');
    for (i = 0; i < els.length; i++) els[i].classList.toggle('actif', els[i].dataset.outil === id);
    els = document.querySelectorAll('#options [data-pour]');
    for (i = 0; i < els.length; i++) {
      pour = els[i].dataset.pour.split(' ');
      els[i].hidden = pour.indexOf(id) < 0;
    }
    $('#nomOutil').textContent = o.nom;
    $('#astuce').textContent = o.astuce;
    $('#scene').dataset.outil = id;
    U.redessiner();
  };

  U.regler = function (cle, valeur) {
    if (cle === 'taille') valeur = borne(Math.round(valeur) || 1, 1, 32);
    U[cle] = valeur;
    $('#oTaille').value = U.taille;
    $('#oTailleVal').textContent = U.taille;
    $('#oParfait').checked = U.pixelParfait;
    $('#oPlein').checked = U.plein;
    $('#oContigu').checked = U.contigu;
    $('#oTrame').checked = U.trame;
    $('#oSym').value = U.symetrie;
    U.redessiner();
  };

  function initOutils() {
    $('#outils').innerHTML = OUTILS.map(function (o) {
      return '<button type="button" class="outil" data-outil="' + o.id + '" title="' + echapper(o.nom) + ' (' + o.touche + ')" aria-label="' + echapper(o.nom) + '">' + svg(o.icone) + '</button>';
    }).join('');
    $('#outils').addEventListener('click', function (e) {
      var b = e.target.closest('.outil');
      if (b) U.choisirOutil(b.dataset.outil);
    });
    $('#oTaille').addEventListener('input', function () { U.regler('taille', Number(this.value)); });
    $('#oParfait').addEventListener('change', function () { U.regler('pixelParfait', this.checked); });
    $('#oPlein').addEventListener('change', function () { U.regler('plein', this.checked); });
    $('#oContigu').addEventListener('change', function () { U.regler('contigu', this.checked); });
    $('#oTrame').addEventListener('change', function () { U.regler('trame', this.checked); });
    $('#oSym').addEventListener('change', function () { U.regler('symetrie', this.value); });
  }

  // ---------- Couleur ----------
  // La teinte, la saturation et la luminosité sont gardées à part : une couleur grise ou
  // transparente ne doit pas faire oublier la teinte en cours de réglage.
  var tsl = { h: 0, s: 0, v: 0, a: 255 };

  function courante() { return U['c' + U.cible]; }

  function lireCourante() {
    var p = A.comp(courante()), t;
    tsl.a = p[3];
    if (!p[3]) return;
    t = A.rgbVersHsv(p[0], p[1], p[2]);
    if (t.v > 0) { tsl.s = t.s; if (t.s > 0) tsl.h = t.h; }
    tsl.v = t.v;
  }

  function ecrireCourante() {
    var q = A.hsvVersRgb(tsl.h, tsl.s, tsl.v);
    U['c' + U.cible] = A.rgba(q[0], q[1], q[2], tsl.a);
    rafraichirCouleur();
  }

  U.definirCouleur = function (n, c) {
    U['c' + n] = c >>> 0;
    if (n === U.cible) lireCourante();
    rafraichirCouleur();
  };

  U.echanger = function () {
    var t = U.c1;
    U.c1 = U.c2; U.c2 = t;
    lireCourante();
    rafraichirCouleur();
  };

  function rafraichirCouleur() {
    var c = $('#sv'), g, w, h, deg, q = A.hsvVersRgb(tsl.h, tsl.s, tsl.v), x, y, els, i;
    if (c.clientWidth && (c.width !== c.clientWidth || c.height !== c.clientHeight)) { c.width = c.clientWidth; c.height = c.clientHeight; }
    g = c.getContext('2d'); w = c.width; h = c.height;
    g.fillStyle = 'hsl(' + tsl.h + ', 100%, 50%)';
    g.fillRect(0, 0, w, h);
    deg = g.createLinearGradient(0, 0, w, 0);
    deg.addColorStop(0, '#fff'); deg.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = deg; g.fillRect(0, 0, w, h);
    deg = g.createLinearGradient(0, 0, 0, h);
    deg.addColorStop(0, 'rgba(0, 0, 0, 0)'); deg.addColorStop(1, '#000');
    g.fillStyle = deg; g.fillRect(0, 0, w, h);
    x = tsl.s * w; y = (1 - tsl.v) * h;
    g.lineWidth = 2;
    g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.stroke();
    g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.stroke();

    $('#teinte').value = Math.round(tsl.h);
    $('#alpha').value = tsl.a;
    $('#alpha').style.setProperty('--c', 'rgb(' + q.join(',') + ')');
    $('#pastille1').style.setProperty('--c', css(U.c1));
    $('#pastille2').style.setProperty('--c', css(U.c2));
    $('#pastille1').classList.toggle('cible', U.cible === 1);
    $('#pastille2').classList.toggle('cible', U.cible === 2);
    if (document.activeElement !== $('#hex')) $('#hex').value = courante() ? A.hexVers(courante()) : 'transparent';
    els = document.querySelectorAll('.nuance');
    for (i = 0; i < els.length; i++) {
      els[i].classList.toggle('choisie', A.palette[i] === U.c1);
      els[i].classList.toggle('choisie2', A.palette[i] === U.c2);
    }
  }

  function initCouleur() {
    var c = $('#sv'), tire = false;
    function viser(e) {
      var r = c.getBoundingClientRect();
      tsl.s = borne((e.clientX - r.left) / r.width, 0, 1);
      tsl.v = 1 - borne((e.clientY - r.top) / r.height, 0, 1);
      if (!tsl.a) tsl.a = 255;
      ecrireCourante();
    }
    c.addEventListener('pointerdown', function (e) { tire = true; try { c.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ } viser(e); });
    c.addEventListener('pointermove', function (e) { if (tire) viser(e); });
    c.addEventListener('pointerup', function () { tire = false; });
    c.addEventListener('pointercancel', function () { tire = false; });
    $('#teinte').addEventListener('input', function () { tsl.h = Number(this.value) % 360; if (!tsl.a) tsl.a = 255; ecrireCourante(); });
    $('#alpha').addEventListener('input', function () { tsl.a = Number(this.value); ecrireCourante(); });
    $('#hex').addEventListener('change', function () {
      var v = A.hexDepuis(this.value);
      if (/^transparent$/i.test(this.value.trim())) v = 0;
      if (v === null) U.message('Couleur non reconnue : écris par exemple #ff8800 ou #ff880080.');
      else U.definirCouleur(U.cible, v);
      this.blur();
      rafraichirCouleur();
    });
    $('#hex').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
    [1, 2].forEach(function (n) {
      $('#pastille' + n).addEventListener('click', function () { U.cible = n; lireCourante(); rafraichirCouleur(); });
    });
  }

  // ---------- Palette ----------
  U.rafraichirPalette = function () {
    $('#palette').innerHTML = A.palette.map(function (c, i) {
      return '<button type="button" class="nuance" data-i="' + i + '" style="--c:' + css(c) + '" title="' + A.hexVers(c) + '"></button>';
    }).join('');
    rafraichirCouleur();
  };

  function changerPalette(couleurs) {
    A.palette = couleurs;
    U.rafraichirPalette();
    U.sauverBientot();
  }

  U.palAjouter = function () {
    var c = courante();
    if (!c) { U.message('Une couleur transparente ne se range pas dans la palette.'); return; }
    if (A.palette.indexOf(c) >= 0) { U.message('Cette couleur est déjà dans la palette.'); return; }
    changerPalette(A.palette.concat([c]));
  };
  U.palRetirer = function () {
    var c = courante();
    if (A.palette.indexOf(c) < 0) { U.message('La couleur courante n\'est pas dans la palette.'); return; }
    changerPalette(A.palette.filter(function (v) { return v !== c; }));
  };
  U.palExtraire = function () {
    var cs = A.couleursDuSprite(256);
    if (!cs.length) { U.message('Le sprite est vide.'); return; }
    function cle(c) { var p = A.comp(c), t = A.rgbVersHsv(p[0], p[1], p[2]); return t.s < 0.08 ? [-1, t.v] : [Math.floor(t.h / 30), t.v]; }
    cs.sort(function (a, b) { var x = cle(a), y = cle(b); return x[0] - y[0] || x[1] - y[1]; });
    changerPalette(cs);
    U.message(cs.length + ' couleur' + (cs.length > 1 ? 's' : '') + ' trouvée' + (cs.length > 1 ? 's' : '') + ' dans le sprite' + (cs.length === 256 ? ' (limité à 256)' : '') + '.');
  };

  function initPalette() {
    var el = $('#palette'), sel = $('#palettes');
    sel.innerHTML = '<option value="">Charger…</option>' + A.PALETTES.map(function (p, i) {
      return '<option value="' + i + '">' + echapper(p.nom) + ' (' + p.couleurs.length + ')</option>';
    }).join('');
    sel.addEventListener('change', function () {
      if (this.value !== '') changerPalette(A.PALETTES[Number(this.value)].couleurs.slice());
      this.value = '';
    });
    el.addEventListener('pointerdown', function (e) {
      var b = e.target.closest('.nuance');
      if (!b || (e.button !== 0 && e.button !== 2)) return;
      U.definirCouleur(e.button === 2 ? 2 : 1, A.palette[Number(b.dataset.i)]);
    });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  // ---------- Calques ----------
  function rafraichirCalques() {
    var d = A.doc, html = '', i, c;
    for (i = d.calques.length - 1; i >= 0; i--) {
      c = d.calques[i];
      html += '<div class="calque' + (i === d.iCalque ? ' actif' : '') + (c.visible ? '' : ' cache') + '" data-i="' + i + '" draggable="true">' +
        '<button type="button" class="ico" data-r="visible" title="' + (c.visible ? 'Masquer' : 'Afficher') + ' le calque">' + svg(c.visible ? ICONES.oeil : ICONES.oeilFerme) + '</button>' +
        '<button type="button" class="ico' + (c.verrou ? ' marque' : '') + '" data-r="verrou" title="' + (c.verrou ? 'Déverrouiller' : 'Verrouiller') + ' le calque">' + svg(c.verrou ? ICONES.verrou : ICONES.ouvert) + '</button>' +
        '<span class="nom" title="Double-clic pour renommer">' + echapper(c.nom) + '</span>' +
        (c.opacite < 1 ? '<span class="op">' + Math.round(c.opacite * 100) + ' %</span>' : '') + '</div>';
    }
    $('#calques').innerHTML = html;
    c = d.calques[d.iCalque];
    if (document.activeElement !== $('#calOpacite')) $('#calOpacite').value = Math.round(c.opacite * 100);
    $('#calOpaciteVal').textContent = Math.round(c.opacite * 100) + ' %';
  }

  U.renommerCalque = function (i) {
    var ligne = document.querySelector('.calque[data-i="' + i + '"] .nom'), champ, fini = false;
    if (!ligne) return;
    champ = document.createElement('input');
    champ.type = 'text'; champ.maxLength = 40; champ.value = A.doc.calques[i].nom; champ.className = 'nom';
    ligne.replaceWith(champ);
    champ.focus(); champ.select();
    function finir(garder) {
      if (fini) return;
      fini = true;
      if (!garder || !A.calqueRegler(i, 'nom', champ.value)) U.rafraichir();
    }
    champ.addEventListener('blur', function () { finir(true); });
    champ.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') finir(true);
      if (e.key === 'Escape') finir(false);
      e.stopPropagation();
    });
    champ.addEventListener('click', function (e) { e.stopPropagation(); });
  };

  // Rend les lignes d'une liste réordonnables par glisser-déposer.
  function glisserDeposer(el, selecteur, deplacer) {
    var source = null;
    el.addEventListener('dragstart', function (e) {
      var l = e.target.closest ? e.target.closest(selecteur) : null;
      if (!l) return;
      source = Number(l.dataset.i);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(source)); } catch (err) { /* certains navigateurs refusent */ }
    });
    el.addEventListener('dragover', function (e) {
      if (source !== null && e.target.closest(selecteur)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    });
    el.addEventListener('drop', function (e) {
      var l = e.target.closest(selecteur);
      e.preventDefault();
      if (l && source !== null) deplacer(source, Number(l.dataset.i));
      source = null;
    });
    el.addEventListener('dragend', function () { source = null; });
  }

  function initCalques() {
    var el = $('#calques');
    el.addEventListener('click', function (e) {
      var l = e.target.closest('.calque'), b = e.target.closest('[data-r]'), i;
      if (!l || e.target.tagName === 'INPUT') return;
      i = Number(l.dataset.i);
      if (b) A.calqueRegler(i, b.dataset.r, !A.doc.calques[i][b.dataset.r]);
      else { A.allerCalque(i); U.rafraichir(); }
    });
    el.addEventListener('dblclick', function (e) {
      var l = e.target.closest('.calque');
      if (l && e.target.classList.contains('nom') && e.target.tagName !== 'INPUT') U.renommerCalque(Number(l.dataset.i));
    });
    glisserDeposer(el, '.calque', function (de, vers) { A.calqueDeplacer(de, vers); });
    $('#calOpacite').addEventListener('input', function () {
      A.calqueRegler(A.doc.iCalque, 'opacite', Number(this.value) / 100, true);
      $('#calOpaciteVal').textContent = this.value + ' %';
      U.redessiner();
    });
    $('#calOpacite').addEventListener('change', function () { this.blur(); A.valider('Opacité du calque'); });
  }

  // ---------- Frise des images ----------
  function rafraichirImages() {
    var d = A.doc, el = $('#images'), k = Math.min(VIGNETTE / d.w, VIGNETTE / d.h), active;
    el.innerHTML = '';
    d.images.forEach(function (im, i) {
      var b = document.createElement('button'), c = document.createElement('canvas'), t = document.createElement('span');
      b.type = 'button';
      b.className = 'image' + (i === d.iImage ? ' actif' : '');
      b.dataset.i = i;
      b.draggable = true;
      b.title = 'Image ' + (i + 1) + ' · ' + im.duree + ' ms';
      U.peindre(c, A.composer(i), d.w, d.h);
      c.style.width = Math.max(1, Math.round(d.w * k)) + 'px';
      c.style.height = Math.max(1, Math.round(d.h * k)) + 'px';
      t.innerHTML = '<b>' + (i + 1) + '</b> ' + im.duree + ' ms';
      b.appendChild(c); b.appendChild(t);
      el.appendChild(b);
      if (i === d.iImage) active = b;
    });
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (document.activeElement !== $('#duree')) $('#duree').value = d.images[d.iImage].duree;
    if (document.activeElement !== $('#cadence')) $('#cadence').value = Math.max(1, Math.round(1000 / d.images[d.iImage].duree));
    marquerLecture();
  }

  function initImages() {
    var el = $('#images');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.image');
      if (!b) return;
      A.allerImage(Number(b.dataset.i));
      U.rafraichir();
    });
    glisserDeposer(el, '.image', function (de, vers) { A.imageDeplacer(de, vers); });
    $('#duree').addEventListener('change', function () {
      this.blur();
      if (!A.imageDuree(A.doc.iImage, Number(this.value))) U.rafraichir();
    });
    $('#oignon').addEventListener('change', function () { U.oignon.actif = this.checked; U.redessiner(); });
    $('#oignonAvant').addEventListener('change', function () { U.oignon.avant = borne(Math.round(Number(this.value)) || 0, 0, 3); this.value = U.oignon.avant; U.redessiner(); });
    $('#oignonApres').addEventListener('change', function () { U.oignon.apres = borne(Math.round(Number(this.value)) || 0, 0, 3); this.value = U.oignon.apres; U.redessiner(); });
    $('#oignonOpacite').addEventListener('input', function () { U.oignon.opacite = Number(this.value) / 100; U.redessiner(); });
  }

  // ---------- Lecture et aperçu ----------
  var minuterie = null;

  function marquerLecture() {
    var els = document.querySelectorAll('.image'), i;
    for (i = 0; i < els.length; i++) els[i].classList.toggle('joue', U.lecture && i === U.iLecture);
    $('#bLire').textContent = U.lecture ? '■ Arrêter' : '▶ Lire';
    $('#bLire').classList.toggle('actif', U.lecture);
  }

  U.apercuDessiner = function () {
    var d = A.doc, c = $('#apercu'), i = U.lecture ? Math.min(U.iLecture, d.images.length - 1) : d.iImage;
    var choix = Number($('#apercuTaille').value), k = choix;
    U.peindre(c, A.composer(i), d.w, d.h);
    if (!choix) {
      k = Math.min(APERCU[0] / d.w, APERCU[1] / d.h);
      if (k >= 1) k = Math.floor(k);
    }
    c.style.width = Math.max(1, Math.round(d.w * k)) + 'px';
    c.style.height = Math.max(1, Math.round(d.h * k)) + 'px';
  };

  function pas() {
    var d = A.doc;
    if (!U.lecture) return;
    if (U.iLecture >= d.images.length) U.iLecture = 0;
    U.apercuDessiner();
    marquerLecture();
    minuterie = setTimeout(function () {
      U.iLecture = (U.iLecture + 1) % A.doc.images.length;
      pas();
    }, d.images[U.iLecture].duree);
  }

  U.lire = function (etat) {
    U.lecture = etat === undefined ? !U.lecture : etat;
    clearTimeout(minuterie);
    if (U.lecture) { U.iLecture = A.doc.iImage; pas(); }
    marquerLecture();
    U.apercuDessiner();
  };

  // ---------- Ensemble ----------
  U.rafraichirPanneaux = function () {
    rafraichirCalques();
    rafraichirImages();
  };

  U.initPanneaux = function () {
    initOutils();
    initCouleur();
    initPalette();
    initCalques();
    initImages();
    $('#apercuTaille').addEventListener('change', U.apercuDessiner);
    lireCourante();
    U.rafraichirPalette();
    U.choisirOutil(U.outil);
    U.regler('taille', U.taille);
  };
})();
