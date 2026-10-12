(function () {
  'use strict';

  var P = window.Palettes, U = P.ui = {};

  var LARGEUR_CASE = 62;                  // largeur visée d'une case de la bande, en pixels
  var SEUIL_GLISSER = 6;                  // déplacement à partir duquel un clic devient un glisser
  var DUREE_MESSAGE = 6000;
  var DELAI_DOUBLE = 350;                 // millisecondes entre les deux clics d'un double-clic

  var $ = function (s) { return document.querySelector(s); };
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fr(v, d) { return v.toFixed(d === undefined ? 1 : d).replace('.', ','); }
  function pluriel(n, mot) { return n + ' ' + mot + (n > 1 ? 's' : ''); }
  U.$ = $; U.echapper = echapper; U.fr = fr; U.pluriel = pluriel;

  var minuterieMsg = null;
  U.message = function (texte) {
    $('#etatMsg').textContent = texte;
    clearTimeout(minuterieMsg);
    minuterieMsg = setTimeout(function () { $('#etatMsg').textContent = ''; }, DUREE_MESSAGE);
  };

  // Une suite de cases jointives, pour les aperçus et les listes. marques : indices à encadrer.
  U.puces = function (couleurs, marques) {
    return '<span class="puces">' + couleurs.map(function (h, i) {
      return '<i style="background:#' + h + '"' + (marques && marques[i] ? ' class="marque"' : '') + ' title="#' + h + '"></i>';
    }).join('') + '</span>';
  };

  // ---------- Bande ----------
  var glisse = null;        // { i, x, y, actif, cible } pendant un glisser dans la bande
  var dernierClic = { i: -1, t: 0 };

  U.rafraichirBande = function () {
    var E = P.E, el = $('#bande'), n = E.couleurs.length, largeur = el.clientWidth || 1200, hauteur = el.clientHeight || 160;
    var parRang = Math.max(4, Math.floor(largeur / LARGEUR_CASE)), rangs = Math.ceil(n / parRang), cols = Math.ceil(n / rangs), h = '';
    var auClavier = document.activeElement && document.activeElement.parentNode === el;
    el.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    el.classList.toggle('serre', largeur / cols < 54 || hauteur / rangs < 30);
    el.classList.toggle('nain', hauteur / rangs < 15 || largeur / cols < 15);
    E.couleurs.forEach(function (c, i) {
      var rgb = P.hexVersRgb(c);
      h += '<button type="button" role="option" class="nuance' + (i === E.sel ? ' choisie' : '') + (i === E.sel2 ? ' choisie2' : '') + (E.verrous[i] ? ' verrou' : '') +
        '" data-i="' + i + '" aria-selected="' + (i === E.sel) + '" style="--c:#' + c + ';color:' + P.encre(rgb) + '" title="#' + c + ', clarté ' + Math.round(P.clarte(rgb)) +
        (E.verrous[i] ? ', verrouillée' : '') + '"><span>' + c.toUpperCase() + '</span></button>';
    });
    el.innerHTML = h + '<i class="repere" id="repere" hidden></i>';
    if (auClavier && el.children[E.sel]) el.children[E.sel].focus();
  };

  U.rafraichirValeurs = function () {
    var E = P.E;
    $('#valeurs').innerHTML = E.couleurs.map(function (c, i) {
      return '<i data-i="' + i + '"' + (i === E.sel ? ' class="choisie"' : '') + ' style="left:' + P.clarte(P.hexVersRgb(c)).toFixed(2) + '%;--c:#' + c + '"></i>';
    }).join('');
  };

  function choisir(i, second) {
    var E = P.E;
    if (second) E.sel2 = (i === E.sel || i === E.sel2) ? -1 : i;
    else { E.sel = i; if (E.sel2 === i) E.sel2 = -1; }
    P.noterChoix();
    U.rafraichir(true);
  }
  U.choisir = choisir;

  // Où tomberait la couleur glissée : l'indice devant lequel elle s'insère.
  function cibleSous(x, y) {
    var el = document.elementFromPoint(x, y), b = el && el.closest ? el.closest('#bande .nuance') : null, r;
    if (!b) return -1;
    r = b.getBoundingClientRect();
    return Number(b.dataset.i) + (x > r.left + r.width / 2 ? 1 : 0);
  }
  function montrerRepere(cible) {
    var rep = $('#repere'), cases = document.querySelectorAll('#bande .nuance'), apres = cible >= cases.length, c = cases[apres ? cases.length - 1 : cible], r, rb;
    if (cible < 0 || !c) { rep.hidden = true; return; }
    r = c.getBoundingClientRect(); rb = $('#bande').getBoundingClientRect();
    rep.hidden = false;
    rep.style.left = (apres ? r.right : r.left) - rb.left - 2 + 'px';
    rep.style.top = r.top - rb.top + 'px';
    rep.style.height = r.height + 'px';
  }

  function initBande() {
    var el = $('#bande');
    el.addEventListener('pointerdown', function (e) {
      var b = e.target.closest('.nuance');
      if (!b || e.button !== 0) return;
      glisse = { i: Number(b.dataset.i), x: e.clientX, y: e.clientY, actif: false, cible: -1, second: e.ctrlKey || e.shiftKey || e.metaKey };
    });
    window.addEventListener('pointermove', function (e) {
      if (!glisse) return;
      if (!glisse.actif && Math.abs(e.clientX - glisse.x) + Math.abs(e.clientY - glisse.y) < SEUIL_GLISSER) return;
      glisse.actif = true;
      el.classList.add('traine');
      glisse.cible = cibleSous(e.clientX, e.clientY);
      montrerRepere(glisse.cible);
    });
    window.addEventListener('pointerup', function () {
      var g = glisse, j;
      glisse = null;
      if (!g) return;
      el.classList.remove('traine');
      if (!g.actif) {
        // La bande est reconstruite à chaque choix : le double-clic se reconnaît ici, pas par l'événement du navigateur.
        if (!g.second && dernierClic.i === g.i && Date.now() - dernierClic.t < DELAI_DOUBLE) { dernierClic.i = -1; basculerVerrou(g.i); return; }
        dernierClic = { i: g.i, t: Date.now() };
        choisir(g.i, g.second);
        return;
      }
      $('#repere').hidden = true;
      if (g.cible < 0) return;
      j = g.cible > g.i ? g.cible - 1 : g.cible;
      if (P.deplacer(g.i, j)) P.valider('Déplacer la couleur');
    });
    window.addEventListener('pointercancel', function () { glisse = null; el.classList.remove('traine'); });
    el.addEventListener('keydown', function (e) {
      var b = e.target.closest('.nuance');
      if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choisir(Number(b.dataset.i), e.ctrlKey || e.shiftKey); }
    });
    $('#valeurs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-i]');
      if (t) choisir(Number(t.dataset.i), e.ctrlKey || e.shiftKey);
    });
  }

  // ---------- Sélecteur de couleur ----------
  // La teinte et la saturation sont gardées ici : un gris ou un noir n'en ont plus dans leur code RVB.
  var tsv = { h: 0, s: 0, v: 0, hex: '' };

  function suivre() {
    var c = P.E.couleurs[P.E.sel], t;
    if (!c || c === tsv.hex) return;
    t = P.rgbVersHsv(P.hexVersRgb(c));
    if (t.v > 0 && t.s > 0) tsv.h = t.h;
    if (t.v > 0) tsv.s = t.s;
    tsv.v = t.v; tsv.hex = c;
  }

  function dessinerSv() {
    var c = $('#sv'), g = c.getContext('2d'), w = c.width, h = c.height, d, x, y;
    g.fillStyle = '#' + P.rgbVersHex(P.hsvVersRgb(tsv.h, 1, 1));
    g.fillRect(0, 0, w, h);
    d = g.createLinearGradient(0, 0, w, 0); d.addColorStop(0, '#fff'); d.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = d; g.fillRect(0, 0, w, h);
    d = g.createLinearGradient(0, 0, 0, h); d.addColorStop(0, 'rgba(0,0,0,0)'); d.addColorStop(1, '#000');
    g.fillStyle = d; g.fillRect(0, 0, w, h);
    x = tsv.s * w; y = (1 - tsv.v) * h;
    g.lineWidth = 3; g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.stroke();
  }

  // Donne à la couleur choisie la valeur du sélecteur. Tant que le geste dure, tout tient en une étape d'historique.
  function appliquer() {
    var hex = P.rgbVersHex(P.hsvVersRgb(tsv.h, tsv.s, tsv.v)), E = P.E;
    tsv.hex = hex;
    if (E.couleurs[E.sel] === hex) { U.rafraichirCote(); return; }
    E.couleurs[E.sel] = hex;
    P.valider('Modifier la couleur', 'couleur' + E.sel);
  }
  U.definirCouleur = function (hex) {
    hex = P.hexPropre(hex);
    if (!hex || P.E.couleurs[P.E.sel] === hex) return false;
    P.E.couleurs[P.E.sel] = hex;
    P.valider('Modifier la couleur');
    return true;
  };

  U.rafraichirCote = function () {
    var E = P.E, c = E.couleurs[E.sel], rgb = P.hexVersRgb(c), autre = E.sel2 >= 0 ? E.couleurs[E.sel2] : null, lch = P.rgbVersLch(rgb), h, r2, ratio, actif = document.activeElement;
    suivre();
    dessinerSv();
    $('#teinte').value = Math.round(tsv.h);
    if (actif !== $('#hex')) $('#hex').value = c;
    if (actif !== $('#cT')) $('#cT').value = Math.round(tsv.h);
    if (actif !== $('#cS')) $('#cS').value = Math.round(tsv.s * 100);
    if (actif !== $('#cV')) $('#cV').value = Math.round(tsv.v * 100);
    h = '<div class="demi" style="background:#' + c + ';color:' + P.encre(rgb) + '"><b>#' + c.toUpperCase() + '</b><span>' + (E.sel + 1) + ' sur ' + E.couleurs.length + (E.verrous[E.sel] ? ', verrouillée' : '') + '</span></div>';
    if (autre) h += '<div class="demi" style="background:#' + autre + ';color:' + P.encre(P.hexVersRgb(autre)) + '"><b>#' + autre.toUpperCase() + '</b><span>' + (E.sel2 + 1) + ' sur ' + E.couleurs.length + '</span></div>';
    $('#echantillon').innerHTML = h;
    $('#mesures').innerHTML = 'Clarté <b>' + Math.round(lch[0] * 100) + '</b>, saturation perçue <b>' + Math.round(lch[1] * 250) + '</b>, teinte <b>' + (lch[1] < P.NEUTRE ? 'neutre' : Math.round(lch[2]) + '°') + '</b><br>' +
      'Contraste <b>' + fr(P.contraste(rgb, [0, 0, 0])) + '</b> sur noir, <b>' + fr(P.contraste(rgb, [255, 255, 255])) + '</b> sur blanc';
    if (autre) {
      r2 = P.hexVersRgb(autre); ratio = P.contraste(rgb, r2);
      $('#paire').innerHTML = '<p>Entre les deux : contraste <b>' + fr(ratio, 2) + ' : 1</b> (' + P.niveau(ratio) + '), écart perçu <b>' + fr(P.ecart(rgb, r2)) + '</b>.</p>' +
        '<div class="rang"><button type="button" class="btn mini" data-paire="fusionner"' + (E.verrous[E.sel] && E.verrous[E.sel2] ? ' disabled title="Deux couleurs verrouillées ne se fondent pas"' : '') + '>Fusionner les deux</button>' +
        '<button type="button" class="btn mini" data-paire="echanger">Échanger leurs places</button></div>';
    } else $('#paire').innerHTML = '<p class="note">Ctrl+clic sur une autre couleur pour la comparer à celle-ci ou les fusionner. Glisser une couleur la déplace.</p>';
    $('#bVerrou').textContent = E.verrous[E.sel] ? 'Déverrouiller' : 'Verrouiller';
    $('#bVerrou').classList.toggle('actif', !!E.verrous[E.sel]);
    $('#bRetirer').disabled = E.couleurs.length < 2;
    $('#bAjouter').disabled = $('#bDupliquer').disabled = E.couleurs.length >= P.COULEURS_MAX;
    if (actif !== $('#reduireN')) {
      $('#reduireN').max = E.couleurs.length;
      if (!(Number($('#reduireN').value) >= 1) || Number($('#reduireN').value) >= E.couleurs.length) $('#reduireN').value = Math.max(1, Math.min(E.couleurs.length - 1, Math.ceil(E.couleurs.length / 2)));
    }
    $('#bReduire').disabled = E.couleurs.length < 2;
  };

  function initSelecteur() {
    var sv = $('#sv'), tient = false;
    function viser(e) {
      var r = sv.getBoundingClientRect();
      tsv.s = P.borne((e.clientX - r.left) / r.width, 0, 1);
      tsv.v = 1 - P.borne((e.clientY - r.top) / r.height, 0, 1);
      appliquer();
    }
    sv.addEventListener('pointerdown', function (e) {
      tient = true;
      try { sv.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ }
      viser(e);
    });
    sv.addEventListener('pointermove', function (e) { if (tient) viser(e); });
    window.addEventListener('pointerup', function () { if (tient) { tient = false; P.clore(); } });
    $('#teinte').addEventListener('input', function () { tsv.h = Number(this.value) % 360; appliquer(); });
    $('#teinte').addEventListener('change', P.clore);
    [['#cT', 'h', 1, 360], ['#cS', 's', 100, 100], ['#cV', 'v', 100, 100]].forEach(function (d) {
      $(d[0]).addEventListener('input', function () {
        if (this.value === '' || !isFinite(this.value)) return;
        tsv[d[1]] = P.borne(Number(this.value), 0, d[3]) / d[2] % (d[1] === 'h' ? 360 : 2);
        appliquer();
      });
      $(d[0]).addEventListener('change', function () { P.clore(); U.rafraichirCote(); });
    });
    $('#hex').addEventListener('change', function () {
      if (!P.hexPropre(this.value)) { U.message('« ' + this.value + ' » n\'est pas une couleur : six chiffres hexadécimaux, par exemple 3b5dc9.'); this.value = P.E.couleurs[P.E.sel]; return; }
      U.definirCouleur(this.value);
      this.value = P.E.couleurs[P.E.sel];
    });
    $('#hex').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
  }

  // ---------- Actions sur la palette ----------
  function basculerVerrou(i) {
    P.E.verrous[i] = !P.E.verrous[i];
    P.valider(P.E.verrous[i] ? 'Verrouiller' : 'Déverrouiller');
  }

  U.actions = {
    ajouter: function () {
      var E = P.E, lch = P.rgbVersLch(P.hexVersRgb(E.couleurs[E.sel]));
      lch[0] = lch[0] > 0.85 ? lch[0] - 0.1 : lch[0] + 0.1;
      if (P.ajouter(P.rgbVersHex(P.lchVersRgb(lch)), E.sel)) P.valider('Ajouter une couleur');
      else U.message('Une palette ne dépasse pas ' + P.COULEURS_MAX + ' couleurs.');
    },
    dupliquer: function () {
      if (P.ajouter(P.E.couleurs[P.E.sel], P.E.sel)) P.valider('Dupliquer la couleur');
    },
    retirer: function () {
      if (P.retirer(P.E.sel)) P.valider('Retirer la couleur');
      else U.message('Une palette garde au moins une couleur.');
    },
    verrou: function () { basculerVerrou(P.E.sel); },
    fusionner: function () {
      var E = P.E;
      if (E.sel2 < 0) { U.message('Ctrl+clic sur une seconde couleur, puis « Fusionner les deux ».'); return; }
      if (P.fusionner(E.sel, E.sel2)) P.valider('Fusionner deux couleurs');
    },
    echanger: function () {
      var E = P.E, a = E.sel, b = E.sel2, t;
      if (b < 0) return;
      t = E.couleurs[a]; E.couleurs[a] = E.couleurs[b]; E.couleurs[b] = t;
      t = E.verrous[a]; E.verrous[a] = E.verrous[b]; E.verrous[b] = t;
      E.sel = b; E.sel2 = a;
      P.valider('Échanger deux couleurs');
    },
    trier: function () {
      var o = $('#tri');
      P.ordonner(P.trier(P.rgbPalette(), o.value));
      P.valider('Trier ' + o.options[o.selectedIndex].text.toLowerCase());
    },
    reduire: function () {
      var E = P.E, n = Math.round(Number($('#reduireN').value)), fixes = E.verrous.filter(function (v) { return v; }).length, r;
      if (!(n >= 1) || n >= E.couleurs.length) { U.message('Indique un nombre entre 1 et ' + (E.couleurs.length - 1) + '.'); return; }
      // Avec une image, les couleurs qui y servent le plus pèsent davantage dans les fusions.
      r = P.reduire(P.rgbPalette(), n, E.verrous, U.usagePalette ? U.usagePalette() : null);
      P.remplacer(r.couleurs.map(P.rgbVersHex), r.verrous);
      P.valider('Réduire à ' + pluriel(r.couleurs.length, 'couleur'));
      if (r.couleurs.length > n) U.message(pluriel(fixes, 'couleur') + ' verrouillée' + (fixes > 1 ? 's' : '') + ' : la palette ne descend pas en dessous.');
    },
    // Déplace la couleur choisie d'un cran.
    pousser: function (sens) {
      if (P.deplacer(P.E.sel, P.E.sel + sens)) P.valider('Déplacer la couleur', 'pousser');
    }
  };

  U.initNuancier = function () {
    initBande();
    initSelecteur();
    $('#tri').innerHTML = P.TRIS.map(function (t) { return '<option value="' + t.id + '">' + echapper(t.nom) + '</option>'; }).join('');
    $('#bAjouter').addEventListener('click', U.actions.ajouter);
    $('#bDupliquer').addEventListener('click', U.actions.dupliquer);
    $('#bRetirer').addEventListener('click', U.actions.retirer);
    $('#bVerrou').addEventListener('click', U.actions.verrou);
    $('#bTrier').addEventListener('click', U.actions.trier);
    $('#bReduire').addEventListener('click', U.actions.reduire);
    $('#reduireN').addEventListener('keydown', function (e) { if (e.key === 'Enter') U.actions.reduire(); });
    $('#paire').addEventListener('click', function (e) {
      var b = e.target.closest('[data-paire]');
      if (b) U.actions[b.dataset.paire]();
    });
  };
})();
