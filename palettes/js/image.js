(function () {
  'use strict';

  var P = window.Palettes, U = P.ui, $ = U.$;

  var COTE_MAX = 4096;                    // côté maximal d'une image chargée
  var ZOOMS = [0.125, 0.25, 1 / 3, 0.5, 2 / 3, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32];
  var MARGE = 16;                         // marge autour de l'image ajustée, en pixels
  var SEUIL_CLIC = 4;                     // en deçà, un appui sur une vue est un clic et non un déplacement

  // img : l'image chargée { nom, w, h, data, histo, toile, simulee: { vision: toile } }.
  // rendu : la même image avec la palette { indices, toile, erreur, usage }.
  // vue : le zoom et le point de l'image placé au centre des deux vues.
  var img = null, rendu = null, vue = { z: 1, cx: 0, cy: 0 }, prise = null;

  U.image = function () { return img; };
  U.usagePalette = function () { return img && P.E.couleurs.length ? P.usage(img.histo, P.rgbPalette()) : null; };

  function toileDe(data, w, h) {
    var c = document.createElement('canvas'), g, im;
    c.width = w; c.height = h;
    g = c.getContext('2d');
    im = g.createImageData(w, h);
    im.data.set(data);
    g.putImageData(im, 0, 0);
    return c;
  }

  // ---------- Vues ----------
  function tailleVue() {
    var r = $('#cadreOrigine').getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  function dessinerVue(canvas, source) {
    var r = canvas.parentNode.getBoundingClientRect(), k = window.devicePixelRatio || 1, W = Math.max(1, Math.round(r.width * k)), H = Math.max(1, Math.round(r.height * k)), g, z;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    g = canvas.getContext('2d');
    g.clearRect(0, 0, W, H);
    if (!source) return;
    z = vue.z * k;
    // Net dès qu'un pixel de l'image couvre au moins un pixel de l'écran ; lissé seulement en réduction.
    g.imageSmoothingEnabled = z < 1;
    g.drawImage(source, Math.round(W / 2 - vue.cx * z), Math.round(H / 2 - vue.cy * z), Math.round(img.w * z), Math.round(img.h * z));
  }

  function origineVisible() {
    var v = P.R.vision;
    if (v === 'normale') return img.toile;
    if (!img.simulee[v]) img.simulee[v] = toileDe(P.simulerImage(img.data, v), img.w, img.h);
    return img.simulee[v];
  }

  U.dessinerVues = function () {
    $('#depot').hidden = !!img;
    $('#zoom').hidden = !img;
    document.querySelectorAll('#vues .legende').forEach(function (l) { l.hidden = !img; });
    dessinerVue($('#vueOrigine'), img ? origineVisible() : null);
    dessinerVue($('#vueRendu'), img && rendu ? rendu.toile : null);
    $('#zoomVal').textContent = Math.round(vue.z * 100) + ' %';
  };

  function borner() {
    if (!img) return;
    vue.cx = P.borne(vue.cx, 0, img.w); vue.cy = P.borne(vue.cy, 0, img.h);
  }

  function ajuster() {
    var t = tailleVue(), i, z = ZOOMS[0];
    if (!img) return;
    for (i = 0; i < ZOOMS.length; i++) if (img.w * ZOOMS[i] <= t.w - MARGE && img.h * ZOOMS[i] <= t.h - MARGE) z = ZOOMS[i];
    vue.z = z; vue.cx = img.w / 2; vue.cy = img.h / 2;
    U.dessinerVues();
  }
  U.ajusterVues = ajuster;

  // sens : +1 ou -1. (px, py) : le point de la vue, compté depuis son centre, qui doit rester sous le curseur.
  function zoomer(sens, px, py) {
    var i = 0, k, z0 = vue.z;
    if (!img) return;
    for (k = 0; k < ZOOMS.length; k++) if (Math.abs(ZOOMS[k] - z0) < Math.abs(ZOOMS[i] - z0)) i = k;
    i = P.borne(i + sens, 0, ZOOMS.length - 1);
    vue.cx += (px || 0) / z0 - (px || 0) / ZOOMS[i];
    vue.cy += (py || 0) / z0 - (py || 0) / ZOOMS[i];
    vue.z = ZOOMS[i];
    borner();
    U.dessinerVues();
  }

  // Le pixel de l'image sous un point de l'écran, ou null en dehors.
  function pixelSous(cadre, e) {
    var r = cadre.getBoundingClientRect(), x = Math.floor(vue.cx + (e.clientX - r.left - r.width / 2) / vue.z), y = Math.floor(vue.cy + (e.clientY - r.top - r.height / 2) / vue.z);
    return x >= 0 && y >= 0 && x < img.w && y < img.h ? { x: x, y: y } : null;
  }

  function cliquer(cadre, e) {
    var p = pixelSous(cadre, e), k, hex, i;
    if (!p) return;
    k = p.y * img.w + p.x;
    if (cadre.id === 'cadreRendu') {
      // Sur l'image recalculée : montre quelle couleur de la palette sert à cet endroit.
      if (rendu && rendu.indices[k] >= 0) U.choisir(rendu.indices[k], e.ctrlKey || e.shiftKey);
      return;
    }
    if (img.data[k * 4 + 3] < 128) return;
    hex = P.rgbVersHex([img.data[k * 4], img.data[k * 4 + 1], img.data[k * 4 + 2]]);
    i = P.E.couleurs.indexOf(hex);
    if (i >= 0) { U.choisir(i); U.message('#' + hex + ' est déjà dans la palette.'); return; }
    if (P.ajouter(hex)) { P.valider('Prélever une couleur'); U.message('#' + hex + ' prélevée dans l\'image et ajoutée à la palette.'); }
  }

  function initVues() {
    ['#cadreOrigine', '#cadreRendu'].forEach(function (s) {
      var cadre = $(s);
      cadre.addEventListener('wheel', function (e) {
        var r;
        if (!img) return;
        e.preventDefault();
        r = cadre.getBoundingClientRect();
        zoomer(e.deltaY < 0 ? 1 : -1, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
      }, { passive: false });
      cadre.addEventListener('pointerdown', function (e) {
        if (!img || e.button > 1) return;
        prise = { cadre: cadre, x: e.clientX, y: e.clientY, cx: vue.cx, cy: vue.cy, bouge: false, e: e };
        try { cadre.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ }
      });
      cadre.addEventListener('dblclick', ajuster);
    });
    window.addEventListener('pointermove', function (e) {
      if (!prise) return;
      if (!prise.bouge && Math.abs(e.clientX - prise.x) + Math.abs(e.clientY - prise.y) < SEUIL_CLIC) return;
      prise.bouge = true;
      $('#vues').classList.add('saisie');
      vue.cx = prise.cx - (e.clientX - prise.x) / vue.z; vue.cy = prise.cy - (e.clientY - prise.y) / vue.z;
      borner();
      U.dessinerVues();
    });
    window.addEventListener('pointerup', function (e) {
      var p = prise;
      prise = null;
      if (!p) return;
      $('#vues').classList.remove('saisie');
      if (!p.bouge && e.button === 0) cliquer(p.cadre, p.e);
    });
    $('#zoom').addEventListener('click', function (e) {
      var b = e.target.closest('[data-zoom]');
      if (!b) return;
      if (b.dataset.zoom === '0') ajuster(); else zoomer(Number(b.dataset.zoom));
    });
    window.addEventListener('resize', function () { U.rafraichirBande(); U.dessinerVues(); });
  }

  // ---------- Extraction ----------
  // Tire la palette de l'image selon les réglages ; les couleurs verrouillées sont gardées telles quelles.
  U.extraire = function () {
    var E = P.E, R = P.R, fixes = [], r, couleurs, verrous, ordre;
    if (!img) { U.message('Charge d\'abord une image : il n\'y a rien à extraire.'); return; }
    E.couleurs.forEach(function (h, i) { if (E.verrous[i]) fixes.push(P.hexVersRgb(h)); });
    r = P.extraire(img.histo, Math.max(R.n, fixes.length), { methode: R.methode, equilibre: R.equilibre / 100, fixes: fixes });
    couleurs = r.couleurs; verrous = couleurs.map(function (c, i) { return i < fixes.length; });
    if (!r.exact) {
      ordre = P.trier(couleurs, 'rampes');
      couleurs = ordre.map(function (i) { return r.couleurs[i]; });
      verrous = ordre.map(function (i) { return i < fixes.length; });
    }
    P.remplacer(couleurs.map(P.rgbVersHex), verrous);
    img.exact = r.exact;
    P.valider('Extraire la palette', 'extraire');
    U.message('Palette de ' + U.pluriel(P.E.couleurs.length, 'couleur') + ' tirée de « ' + img.nom + ' ».');
  };

  // Recalcule l'image avec la palette en cours, puis la peint selon la vision simulée.
  U.recalculerImage = function () {
    var pal, R = P.R;
    if (!img) return;
    pal = P.rgbPalette();
    rendu = { indices: P.recalculer(img.data, img.w, img.h, pal, { trame: R.trame, force: R.force / 100 }), erreur: P.erreurMoyenne(img.histo, pal), toile: rendu ? rendu.toile : null };
    U.repeindreRendu();
  };

  U.repeindreRendu = function () {
    var pal, v = P.R.vision, g, im;
    if (!img || !rendu) { U.dessinerVues(); return; }
    pal = P.rgbPalette().map(function (c) { return P.simuler(c, v); });
    if (!rendu.toile || rendu.toile.width !== img.w || rendu.toile.height !== img.h) rendu.toile = toileDe(new Uint8ClampedArray(img.w * img.h * 4), img.w, img.h);
    g = rendu.toile.getContext('2d');
    im = g.createImageData(img.w, img.h);
    P.peindre(rendu.indices, pal, im.data);
    g.putImageData(im, 0, 0);
    U.dessinerVues();
    U.rafraichirInfoImage();
  };

  U.rafraichirInfoImage = function () {
    var n = P.E.couleurs.length, t = '';
    if (img) {
      t = '« ' + img.nom + ' », ' + img.w + ' × ' + img.h + ' px, ' + (img.histo.exact ? U.pluriel(img.histo.nb, 'couleur') + ' distincte' + (img.histo.nb > 1 ? 's' : '') : 'plus de 4 096 couleurs distinctes') + '.';
      if (rendu) t += ' Écart moyen entre l\'image et son rendu : ' + U.fr(rendu.erreur) + (rendu.erreur < 0.05 ? ' (rendu exact).' : rendu.erreur < 2 ? ' (à peine visible).' : '.');
      if (img.histo.exact && img.histo.nb <= n && rendu && rendu.erreur < 0.05) t += ' L\'image tient tout entière dans la palette.';
    } else t = 'Formats PNG, JPEG, GIF, WebP ou BMP, jusqu\'à ' + COTE_MAX + ' px de côté. L\'image reste sur ta machine.';
    $('#infoImage').textContent = t;
    $('#legendeRendu').textContent = 'Avec la palette, ' + U.pluriel(n, 'couleur') + (P.R.trame === 'aucune' ? '' : P.R.trame === 'ordonnee' ? ', tramage ordonné' : ', diffusion d\'erreur');
    $('#etatInfo').textContent = img ? img.w + ' × ' + img.h + ' px' : '';
    $('#bExtraire').disabled = $('#bRendu').disabled = !img;
  };

  // ---------- Chargement ----------
  // Reçoit une image RVBA et en tire aussitôt une palette.
  U.definirImage = function (data, w, h, nom) {
    img = { nom: nom, w: w, h: h, data: data, histo: P.histogramme(data, w, h), toile: toileDe(data, w, h), simulee: {}, exact: false };
    rendu = null;
    if (!P.E.verrous.some(function (v) { return v; })) P.E.nom = P.nomPropre(nom);
    U.montrerOnglet('extraire');
    ajuster();
    P.clore();
    U.extraire();
    P.clore();
  };

  // Lit un fichier image et le passe à suite(data, w, h).
  U.lireImage = function (fichier, suite) {
    var l = new FileReader();
    l.onerror = function () { U.message('Le fichier n\'a pas pu être lu.'); };
    l.onload = function () {
      var im = new Image();
      im.onerror = function () { U.message('« ' + (fichier.name || 'image') + ' » n\'est pas une image que le navigateur sait lire.'); };
      im.onload = function () {
        var c = document.createElement('canvas'), g, w = im.naturalWidth, h = im.naturalHeight;
        if (w > COTE_MAX || h > COTE_MAX || !w || !h) { U.message('L\'image fait ' + w + ' × ' + h + ' px : le maximum est ' + COTE_MAX + ' px de côté.'); return; }
        c.width = w; c.height = h;
        g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0);
        suite(g.getImageData(0, 0, w, h).data, w, h);
      };
      im.src = l.result;
    };
    l.readAsDataURL(fichier);
  };

  U.chargerImage = function (fichier) {
    var nom = String(fichier.name || 'image collée').replace(/\.[^.]*$/, '');
    U.lireImage(fichier, function (data, w, h) { U.definirImage(data, w, h, nom); });
  };

  U.telechargerRendu = function () {
    if (!img) return;
    U.recalculerImage();
    // Toujours en couleurs vraies, même si une vision simulée est affichée.
    var c = toileDe(P.peindre(rendu.indices, P.rgbPalette()), img.w, img.h);
    c.toBlob(function (b) {
      if (b) U.telecharger(b, U.nomFichier() + '-' + P.E.couleurs.length + 'c.png'); else U.message('Le navigateur n\'a pas pu fabriquer l\'image.');
    }, 'image/png');
  };

  // L'image recalculée, en pixels RVBA, pour l'export vers Atelier Pixel.
  U.renduPixels = function () {
    if (img) U.recalculerImage();
    return img && rendu ? { w: img.w, h: img.h, data: P.peindre(rendu.indices, P.rgbPalette()) } : null;
  };

  U.initImage = function () {
    initVues();
    $('#bImage').addEventListener('click', function () { $('#fichierImage').click(); });
    $('#fichierImage').addEventListener('change', function () {
      if (this.files[0]) U.chargerImage(this.files[0]);
      this.value = '';
    });
    $('#bExemple').addEventListener('click', function () {
      var p = P.paysage();
      U.definirImage(p.data, p.w, p.h, 'Lac au couchant');
    });
    $('#bExtraire').addEventListener('click', function () { P.clore(); U.extraire(); P.clore(); });
    $('#bRendu').addEventListener('click', U.telechargerRendu);
  };
})();
