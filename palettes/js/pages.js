(function () {
  'use strict';

  var P = window.Palettes, U = P.ui, $ = U.$, echapper = U.echapper, fr = U.fr, pluriel = U.pluriel;

  var CLE = 'palettes.bibliotheque';
  var GARDEES_MAX = 100;                  // palettes gardées dans le navigateur
  var PROCHES_MAX = 40;                   // paires listées au plus
  var CASE_CHIFFREE = 26;                 // côté d'une case de la matrice à partir duquel le rapport s'écrit dedans
  var FICHIERS_TEXTURES = ['moteur', 'matieres-nature', 'matieres-bati'];   // le moteur de Textures et ses matières
  var TOILES_ATELIER = [16, 32, 64, 128];

  // ---------- Téléchargements ----------
  U.nomFichier = function () {
    return (P.E.nom || 'palette').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'palette';
  };

  U.telecharger = function (blob, nom) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
    U.message('Fichier « ' + nom + ' » téléchargé.');
  };

  U.copier = function (texte, quoi) {
    function secours() {
      var z = document.createElement('textarea'), ok = false;
      z.value = texte; z.style.position = 'fixed'; z.style.opacity = '0';
      document.body.appendChild(z);
      z.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      z.remove();
      U.message(ok ? quoi + ' dans le presse-papiers.' : 'Copie refusée par le navigateur : sélectionne le texte à la main.');
    }
    // Le presse-papiers moderne n'existe pas sur une page ouverte en file://.
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texte).then(function () { U.message(quoi + ' dans le presse-papiers.'); }, secours);
    else secours();
  };

  function telechargerBande(cote) {
    var b = P.bande(P.E.couleurs, cote, cote > 1 ? 16 : 0), c = document.createElement('canvas'), g, im;
    c.width = b.w; c.height = b.h;
    g = c.getContext('2d');
    im = g.createImageData(b.w, b.h);
    im.data.set(b.data);
    g.putImageData(im, 0, 0);
    c.toBlob(function (blob) {
      if (blob) U.telecharger(blob, U.nomFichier() + (cote > 1 ? '-x' + cote : '') + '.png'); else U.message('Le navigateur n\'a pas pu fabriquer l\'image.');
    }, 'image/png');
  }

  // ---------- Construire ----------
  var base = '3b5dc9';

  function reglagesRampe() {
    return { tons: Number($('#raTons').value), etendue: Number($('#raEtendue').value), decalage: Number($('#raDecalage').value), saturation: Number($('#raSaturation').value) / 100 };
  }
  function couleursRampe() { return P.rampe(P.hexVersRgb(base), reglagesRampe()).map(P.rgbVersHex); }
  function couleursHarmonie() {
    var o = reglagesRampe(), tons = Number($('#haTons').value);
    o.tons = tons;
    return P.harmonie(P.hexVersRgb(base), $('#haType').value).map(function (c) {
      return tons > 1 ? P.rampe(c, o).map(P.rgbVersHex) : [P.rgbVersHex(c)];
    });
  }
  function grandesPuces(liste) {
    return '<div class="tons">' + liste.map(function (h) {
      var rgb = P.hexVersRgb(h);
      return '<i style="background:#' + h + ';color:' + P.encre(rgb) + '"' + (h === base ? ' class="depart"' : '') + ' title="#' + h + ', clarté ' + Math.round(P.clarte(rgb)) + '"><span>' + h.toUpperCase() + '</span></i>';
    }).join('') + '</div>';
  }

  U.rafraichirConstruire = function () {
    var o = reglagesRampe(), rangs = couleursHarmonie();
    $('#baseHex').value = '#' + base; $('#baseNuance').value = '#' + base;
    $('#raTonsVal').textContent = o.tons;
    $('#raEtendueVal').textContent = o.etendue;
    $('#raDecalageVal').textContent = o.decalage + '°';
    $('#raSaturationVal').textContent = Math.round(o.saturation * 100) + ' %';
    $('#haTonsVal').textContent = $('#haTons').value === '1' ? 'la teinte seule' : $('#haTons').value;
    $('#raApercu').innerHTML = grandesPuces(couleursRampe());
    $('#haApercu').innerHTML = rangs.map(grandesPuces).join('');
  };

  // Ajoute à la palette les couleurs qu'elle n'a pas encore, ou la remplace.
  function verser(liste, remplacer, nom) {
    var E = P.E, neuves, avant = E.couleurs.length;
    if (remplacer) P.remplacer(liste.filter(function (h, i) { return liste.indexOf(h) === i; }), [], nom);
    else {
      if (avant >= P.COULEURS_MAX) { U.message('Palette pleine : ' + P.COULEURS_MAX + ' couleurs au plus.'); return; }
      neuves = liste.filter(function (h, i) { return E.couleurs.indexOf(h) < 0 && liste.indexOf(h) === i; });
      if (!neuves.length) { U.message('Ces couleurs sont déjà toutes dans la palette.'); return; }
      P.remplacer(E.couleurs.concat(neuves), E.verrous);
      E.sel = Math.min(avant, E.couleurs.length - 1);
    }
    P.valider(remplacer ? 'Remplacer la palette' : 'Ajouter ' + pluriel(E.couleurs.length - avant, 'couleur'));
    if (!remplacer && avant + neuves.length > P.COULEURS_MAX) U.message('Palette pleine : ' + P.COULEURS_MAX + ' couleurs au plus.');
  }

  function definirBase(hex) {
    hex = P.hexPropre(hex);
    if (!hex) { U.message('La couleur de départ s\'écrit en six chiffres hexadécimaux, par exemple 3b5dc9.'); U.rafraichirConstruire(); return; }
    base = hex;
    U.rafraichirConstruire();
  }

  function initConstruire() {
    $('#haType').innerHTML = P.HARMONIES.map(function (h) { return '<option value="' + h.id + '">' + echapper(h.nom) + '</option>'; }).join('');
    $('#haType').value = 'triade';
    base = P.E.couleurs[P.E.sel] || base;
    ['#raTons', '#raEtendue', '#raDecalage', '#raSaturation', '#haTons'].forEach(function (s) { $(s).addEventListener('input', U.rafraichirConstruire); });
    $('#haType').addEventListener('change', U.rafraichirConstruire);
    $('#baseNuance').addEventListener('input', function () { definirBase(this.value); });
    $('#baseHex').addEventListener('change', function () { definirBase(this.value); });
    $('#baseHex').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
    $('#bBaseChoisie').addEventListener('click', function () { definirBase(P.E.couleurs[P.E.sel]); });
    $('#bRaAjouter').addEventListener('click', function () { verser(couleursRampe(), false); });
    $('#bRaRemplacer').addEventListener('click', function () { verser(couleursRampe(), true, 'Rampe #' + base); });
    $('#bHaAjouter').addEventListener('click', function () { verser([].concat.apply([], couleursHarmonie()), false); });
    $('#bHaRemplacer').addEventListener('click', function () { verser([].concat.apply([], couleursHarmonie()), true, $('#haType').options[$('#haType').selectedIndex].text + ' #' + base); });
    $('#bVierge').addEventListener('click', function () {
      P.remplacer([base], [], '');
      P.valider('Palette vierge');
      U.message('Palette d\'une seule couleur : « + Ajouter » à droite pour continuer.');
    });
  }

  // ---------- Vérifier : contrastes ----------
  var grille = null;        // { cote, n } : la géométrie de la matrice affichée

  function dessinerMatrice() {
    var pal = P.rgbPalette(), n = pal.length, cadre = $('#cadreMatrice'), c = $('#matrice'), k = window.devicePixelRatio || 1;
    var place = Math.max(60, Math.min(cadre.clientWidth, cadre.clientHeight)), cote = Math.max(3, Math.floor(place / (n + 1))), T = cote * (n + 1), g, i, j, r, bons = 0, x, y;
    c.width = Math.round(T * k); c.height = Math.round(T * k);
    c.style.width = c.style.height = T + 'px';
    g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 ' + Math.min(13, Math.round(cote * 0.42)) + 'px Bahnschrift, "Segoe UI", sans-serif';
    for (i = 0; i < n; i++) {
      g.fillStyle = '#' + P.E.couleurs[i];
      g.fillRect((i + 1) * cote, 0, cote, cote - 1);
      g.fillRect(0, (i + 1) * cote, cote - 1, cote);
    }
    for (j = 0; j < n; j++) {
      for (i = 0; i < n; i++) {
        x = (j + 1) * cote; y = (i + 1) * cote;
        g.fillStyle = '#' + P.E.couleurs[j];
        g.fillRect(x, y, cote, cote);
        if (i === j) continue;
        r = P.contraste(pal[i], pal[j]);
        g.fillStyle = '#' + P.E.couleurs[i];
        if (r >= P.R.ratio) {
          if (i < j) bons++;
          // Le rapport est écrit avec la couleur de la ligne sur celle de la colonne : s'il se lit, la paire tient.
          if (cote >= CASE_CHIFFREE) g.fillText(r >= 10 ? Math.round(r) : fr(r), x + cote / 2, y + cote / 2 + 1);
          else g.fillRect(x + Math.floor(cote * 0.3), y + Math.floor(cote * 0.3), Math.max(1, Math.ceil(cote * 0.4)), Math.max(1, Math.ceil(cote * 0.4)));
        } else if (cote >= CASE_CHIFFREE) g.fillRect(x + cote / 2 - 1.5, y + cote / 2 - 1.5, 3, 3);
      }
    }
    grille = { cote: cote, n: n, bons: bons };
    infoMatrice(-1, -1);
  }

  function infoMatrice(i, j) {
    var E = P.E, n = E.couleurs.length, paires = n * (n - 1) / 2, r;
    if (i >= 0 && j >= 0 && i !== j && i < n && j < n) {
      r = P.contraste(P.hexVersRgb(E.couleurs[i]), P.hexVersRgb(E.couleurs[j]));
      $('#infoMatrice').innerHTML = '<span class="puces"><i style="background:#' + E.couleurs[i] + '"></i><i style="background:#' + E.couleurs[j] + '"></i></span> #' + E.couleurs[i] + ' sur #' + E.couleurs[j] + ' : <b>' + fr(r, 2) + ' : 1</b>, ' + P.niveau(r) + '. Un clic choisit la paire.';
    } else {
      $('#infoMatrice').textContent = n < 2 ? 'Il faut au moins deux couleurs.' : grille.bons + ' des ' + pluriel(paires, 'paire') + ' atteignent ' + String(P.R.ratio).replace('.', ',') + ' : 1. ' +
        (grille.cote >= CASE_CHIFFREE ? 'Chaque case écrit le rapport avec la couleur de sa ligne sur celle de sa colonne ; un simple point : contraste insuffisant.' : 'Un carré plein marque les paires qui l\'atteignent. Survole une case pour lire son rapport.');
    }
  }

  function caseSous(e) {
    var r = $('#matrice').getBoundingClientRect();
    return { i: Math.floor((e.clientY - r.top) / grille.cote) - 1, j: Math.floor((e.clientX - r.left) / grille.cote) - 1 };
  }

  // ---------- Vérifier : valeurs, voisines, daltonisme ----------
  function rafraichirValeursDetail() {
    var E = P.E, L = E.couleurs.map(function (c, i) { return { i: i, l: P.clarte(P.hexVersRgb(c)) }; }).sort(function (a, b) { return a.l - b.l || a.i - b.i; });
    var n = L.length, vide = 0, ou = 0, serres = 0, k, ideal;
    for (k = 1; k < n; k++) {
      if (L[k].l - L[k - 1].l > vide) { vide = L[k].l - L[k - 1].l; ou = k; }
      if (L[k].l - L[k - 1].l < 1.5) serres++;
    }
    $('#escalier').innerHTML = L.map(function (x) {
      return '<i data-i="' + x.i + '"' + (x.i === E.sel ? ' class="choisie"' : '') + ' style="height:' + Math.max(1.5, x.l).toFixed(1) + '%;background:#' + E.couleurs[x.i] + '" title="#' + E.couleurs[x.i] + ', clarté ' + Math.round(x.l) + '"></i>';
    }).join('');
    if (n < 2) { $('#infoValeurs').textContent = 'Une seule couleur : pas d\'étagement à juger.'; return; }
    ideal = (L[n - 1].l - L[0].l) / (n - 1);
    $('#infoValeurs').innerHTML = 'Les couleurs rangées de la plus sombre à la plus claire : plus l\'escalier est régulier, mieux les valeurs sont étagées. Clartés de <b>' + Math.round(L[0].l) + '</b> à <b>' + Math.round(L[n - 1].l) +
      '</b>, soit une marche idéale de ' + fr(ideal) + '. Plus grande marche : <b>' + fr(vide) + '</b>, entre #' + E.couleurs[L[ou - 1].i] + ' et #' + E.couleurs[L[ou].i] + '. ' +
      (serres ? '<b>' + pluriel(serres, 'marche') + '</b> de moins de 1,5 : ces couleurs ont presque la même valeur et ne se détacheront que par leur teinte.' : 'Aucune marche de moins de 1,5.');
  }

  function rafraichirProches() {
    var E = P.E, liste = P.proches(P.rgbPalette(), P.R.seuil), h;
    $('#seuilVal').textContent = P.R.seuil;
    if (!liste.length) { $('#proches').innerHTML = '<p class="note">Aucune paire sous ce seuil : toutes les couleurs se distinguent.</p>'; return; }
    h = liste.slice(0, PROCHES_MAX).map(function (p) {
      var deux = E.verrous[p.a] && E.verrous[p.b];
      return '<div class="voisines"><button type="button" class="duo" data-a="' + p.a + '" data-b="' + p.b + '" title="Choisir cette paire"><i style="background:#' + E.couleurs[p.a] + '"></i><i style="background:#' + E.couleurs[p.b] + '"></i></button>' +
        '<span>#' + E.couleurs[p.a] + ' et #' + E.couleurs[p.b] + '</span><b>' + fr(p.ecart) + '</b>' +
        '<button type="button" class="btn mini" data-fondre="' + p.a + ',' + p.b + '"' + (deux ? ' disabled title="Deux couleurs verrouillées ne se fondent pas"' : '') + '>Fusionner</button></div>';
    }).join('');
    if (liste.length > PROCHES_MAX) h += '<p class="note">… et ' + pluriel(liste.length - PROCHES_MAX, 'autre paire') + '.</p>';
    $('#proches').innerHTML = h;
  }

  function rafraichirVisions() {
    var E = P.E, pal = P.rgbPalette(), normales = {}, h = '';
    P.proches(pal, P.R.seuil).forEach(function (p) { normales[p.a + ',' + p.b] = true; });
    P.VISIONS.forEach(function (v) {
      var sim = pal.map(function (c) { return P.rgbVersHex(P.simuler(c, v.id)); }), marques = [], perdues = 0;
      if (v.m) {
        P.proches(pal, P.R.seuil, v.id).forEach(function (p) {
          if (normales[p.a + ',' + p.b]) return;
          perdues++; marques[p.a] = marques[p.b] = true;
        });
      }
      h += '<button type="button" class="vision-rang' + (P.R.vision === v.id ? ' actif' : '') + '" data-vision="' + v.id + '" title="Appliquer cette vision aux images">' +
        '<span class="titre">' + echapper(v.nom) + (v.m ? '<em>' + (perdues ? pluriel(perdues, 'paire') + ' confondue' + (perdues > 1 ? 's' : '') : 'rien de confondu') + '</em>' : '') + '</span>' + U.puces(sim, marques) + '</button>';
    });
    $('#visions').innerHTML = h;
  }

  U.rafraichirVerifier = function () {
    $('#ratio').value = P.R.ratio;
    $('#seuil').value = P.R.seuil;
    dessinerMatrice();
    rafraichirValeursDetail();
    rafraichirProches();
    rafraichirVisions();
  };

  function initVerifier() {
    var m = $('#matrice');
    $('#ratio').addEventListener('change', function () { P.regler('ratio', this.value); U.rafraichir(); });
    $('#seuil').addEventListener('input', function () { P.regler('seuil', this.value); U.rafraichir(); });
    m.addEventListener('pointermove', function (e) { var c = caseSous(e); infoMatrice(c.i, c.j); });
    m.addEventListener('pointerleave', function () { infoMatrice(-1, -1); });
    // La matrice est taillée sur son cadre : elle se redessine quand la fenêtre change de taille.
    window.addEventListener('resize', function () { if (P.R.onglet === 'verifier') dessinerMatrice(); });
    m.addEventListener('click', function (e) {
      var c = caseSous(e), n = P.E.couleurs.length;
      if (c.i >= n || c.j >= n || (c.i < 0 && c.j < 0)) return;
      if (c.i < 0 || c.j < 0 || c.i === c.j) { U.choisir(Math.max(c.i, c.j)); return; }
      P.E.sel = c.i; P.E.sel2 = c.j;
      P.noterChoix();
      U.rafraichir(true);
    });
    $('#escalier').addEventListener('click', function (e) {
      var t = e.target.closest('[data-i]');
      if (t) U.choisir(Number(t.dataset.i), e.ctrlKey || e.shiftKey);
    });
    $('#proches').addEventListener('click', function (e) {
      var f = e.target.closest('[data-fondre]'), d = e.target.closest('.duo'), q;
      if (f) {
        q = f.dataset.fondre.split(',').map(Number);
        if (P.fusionner(q[0], q[1])) P.valider('Fusionner deux couleurs');
      } else if (d) {
        P.E.sel = Number(d.dataset.a); P.E.sel2 = Number(d.dataset.b);
        P.noterChoix();
        U.rafraichir(true);
      }
    });
    $('#visions').addEventListener('click', function (e) {
      var b = e.target.closest('[data-vision]');
      if (b) U.definirVision(b.dataset.vision);
    });
  }

  // ---------- Bibliothèque ----------
  var gardees = [], comparee = null;

  function lireGardees() {
    try {
      var t = JSON.parse(localStorage.getItem(CLE) || '[]');
      gardees = Array.isArray(t) ? t.filter(function (p) { return p && typeof p.nom === 'string' && Array.isArray(p.couleurs); }).map(function (p) {
        return { nom: P.nomPropre(p.nom), couleurs: p.couleurs.map(P.hexPropre).filter(function (h) { return h; }) };
      }).filter(function (p) { return p.couleurs.length; }).slice(0, GARDEES_MAX) : [];
    } catch (e) { gardees = []; }
  }
  function ecrireGardees() {
    try { localStorage.setItem(CLE, JSON.stringify(gardees)); }
    catch (e) { U.message('La bibliothèque n\'a pas pu être enregistrée (stockage plein ou interdit) : elle sera perdue à la fermeture.'); }
  }

  U.garder = function () {
    var E = P.E, nom = E.nom || 'Palette du ' + new Date().toLocaleDateString('fr-FR'), k;
    for (k = 0; k < gardees.length; k++) if (gardees[k].nom === nom) break;
    if (k === gardees.length && k >= GARDEES_MAX) { U.message('La bibliothèque est pleine (' + GARDEES_MAX + ' palettes) : retires-en une.'); return; }
    U.message(k < gardees.length ? '« ' + nom + ' » mise à jour dans la bibliothèque.' : '« ' + nom + ' » gardée dans la bibliothèque.');
    gardees[k] = { nom: nom, couleurs: E.couleurs.slice() };
    ecrireGardees();
    U.rafraichirBibliotheque();
  };

  function rayon(p, cle, perso) {
    var memes = p.couleurs.join() === P.E.couleurs.join();
    return '<div class="rayon' + (memes ? ' courante' : '') + (comparee && comparee.cle === cle ? ' comparee' : '') + '">' +
      '<button type="button" class="charger" data-charger="' + cle + '" title="Charger cette palette">' + '<span class="titre">' + echapper(p.nom) + '<em>' + p.couleurs.length + '</em></span>' + U.puces(p.couleurs) + '</button>' +
      '<button type="button" class="btn mini" data-comparer="' + cle + '">Comparer</button>' +
      (perso ? '<button type="button" class="btn mini" data-oter="' + cle + '" title="Retirer de la bibliothèque">✕</button>' : '') + '</div>';
  }
  function trouver(cle) {
    var q = cle.split(':');
    return (q[0] === 'm' ? gardees : P.FOURNIES)[Number(q[1])] || null;
  }

  function rafraichirComparaison() {
    var E = P.E, el = $('#comparaison'), autre = comparee && trouver(comparee.cle), A, B, la, lb, communes = 0, voisines = 0, seules = [], propresB = 0, h, cl;
    if (!autre) {
      comparee = null;
      el.innerHTML = '<h2>Comparer deux palettes</h2><p class="note">« Comparer », sur une palette de la liste, la pose ici face à la palette en cours : couleurs communes, couleurs voisines, et celles que l\'une a sans que l\'autre ait rien d\'approchant.</p>';
      return;
    }
    A = P.rgbPalette(); B = autre.couleurs.map(P.hexVersRgb); la = A.map(P.rgbVersLab); lb = B.map(P.rgbVersLab);
    function plusProche(l, liste) {
      var m = -1, d = 1e9, i, e;
      for (i = 0; i < liste.length; i++) { e = P.ecartLab(l, liste[i]); if (e < d) { d = e; m = i; } }
      return { i: m, ecart: d };
    }
    la.forEach(function (l, i) {
      var p = plusProche(l, lb);
      if (p.ecart < 0.01) communes++;
      else if (p.ecart < P.R.seuil) voisines++;
      else seules.push({ a: i, b: p.i, ecart: p.ecart });
    });
    lb.forEach(function (l) { if (plusProche(l, la).ecart >= P.R.seuil) propresB++; });
    cl = function (labs) { var l = labs.map(function (x) { return x[0] * 100; }); return Math.round(Math.min.apply(null, l)) + ' à ' + Math.round(Math.max.apply(null, l)); };
    h = '<h2>Comparer deux palettes</h2>' +
      '<div class="face"><span class="titre">' + echapper(E.nom || 'Palette en cours') + '<em>' + A.length + '</em></span>' + U.puces(E.couleurs) + '</div>' +
      '<div class="face"><span class="titre">' + echapper(autre.nom) + '<em>' + B.length + '</em></span>' + U.puces(autre.couleurs) + '</div>' +
      '<p><b>' + pluriel(communes, 'couleur') + '</b> en commun, <b>' + voisines + '</b> avec une voisine à moins de ' + P.R.seuil + ' d\'écart, <b>' + seules.length + '</b> sans équivalent dans « ' + echapper(autre.nom) + ' ». ' +
      'À l\'inverse, <b>' + propresB + '</b> de ses couleurs n\'ont rien d\'approchant ici. Clartés : ' + cl(la) + ' contre ' + cl(lb) + '.</p>';
    if (seules.length) {
      h += '<p class="note">Sans équivalent, avec ce que l\'autre palette a de plus proche :</p><div class="ecarts">' + seules.sort(function (x, y) { return y.ecart - x.ecart; }).map(function (s) {
        return '<div class="voisines"><span class="duo"><i style="background:#' + E.couleurs[s.a] + '"></i><i style="background:#' + autre.couleurs[s.b] + '"></i></span><span>#' + E.couleurs[s.a] + ' → #' + autre.couleurs[s.b] + '</span><b>' + fr(s.ecart) + '</b></div>';
      }).join('') + '</div>';
    }
    h += '<div class="rang"><button type="button" class="btn" data-charger="' + comparee.cle + '">Charger « ' + echapper(autre.nom) + ' »</button><button type="button" class="btn" data-comparer="">Fermer la comparaison</button></div>';
    el.innerHTML = h;
  }

  U.rafraichirBibliotheque = function () {
    var h = '<h2>Mes palettes</h2>', groupes = [];
    h += gardees.length ? gardees.map(function (p, k) { return rayon(p, 'm:' + k, true); }).join('')
      : '<p class="note">Rien encore. « Garder », en haut, range ici la palette en cours ; elle reste dans ce navigateur.</p>';
    P.FOURNIES.forEach(function (p, k) {
      if (groupes.indexOf(p.groupe) < 0) { groupes.push(p.groupe); h += '<h2>' + echapper(p.groupe) + '</h2>'; }
      h += rayon(p, 'f:' + k, false);
    });
    $('#rayons').innerHTML = h;
    rafraichirComparaison();
  };

  function initBibliotheque() {
    lireGardees();
    $('#page-bibliotheque').addEventListener('click', function (e) {
      var c = e.target.closest('[data-charger]'), k = e.target.closest('[data-comparer]'), o = e.target.closest('[data-oter]'), p;
      if (o) {
        gardees.splice(Number(o.dataset.oter.split(':')[1]), 1);
        comparee = null;
        ecrireGardees();
        U.rafraichirBibliotheque();
      } else if (k) {
        comparee = k.dataset.comparer && !(comparee && comparee.cle === k.dataset.comparer) ? { cle: k.dataset.comparer } : null;
        U.rafraichirBibliotheque();
      } else if (c && (p = trouver(c.dataset.charger))) {
        P.remplacer(p.couleurs, [], p.nom);
        P.valider('Charger « ' + p.nom + ' »');
        U.message('« ' + p.nom + ' » chargée : ' + pluriel(p.couleurs.length, 'couleur') + '.');
      }
    });
    $('#bGarder').addEventListener('click', U.garder);
  }

  // ---------- Importer et exporter ----------
  // p : { nom, couleurs }, lue d'un fichier ou d'un collage.
  U.importer = function (p, origine) {
    var E = P.E, avant = E.couleurs.length, neuves;
    if ($('#ajouterImport').checked) {
      neuves = p.couleurs.filter(function (h, i) { return E.couleurs.indexOf(h) < 0 && p.couleurs.indexOf(h) === i; });
      if (!neuves.length || avant >= P.COULEURS_MAX) { U.message(neuves.length ? 'Palette pleine : ' + P.COULEURS_MAX + ' couleurs au plus.' : 'Ces couleurs sont déjà toutes dans la palette.'); return; }
      P.remplacer(E.couleurs.concat(neuves), E.verrous);
      P.valider('Importer des couleurs');
      U.message(pluriel(P.E.couleurs.length - avant, 'couleur') + ' ajoutée' + (P.E.couleurs.length - avant > 1 ? 's' : '') + ' depuis ' + origine + '.');
    } else {
      P.remplacer(p.couleurs, [], p.nom || E.nom);
      P.valider('Importer une palette');
      U.message(pluriel(p.couleurs.length, 'couleur') + ' lue' + (p.couleurs.length > 1 ? 's' : '') + ' depuis ' + origine + '.');
    }
  };

  U.importerTexte = function (texte, nomFichier) {
    var p;
    try { p = P.lire(texte, null, nomFichier); } catch (e) { U.message(e.message); return false; }
    if (!p.nom && nomFichier) p.nom = nomFichier.replace(/\.[^.]*$/, '');
    U.importer(p, nomFichier ? '« ' + nomFichier + ' »' : 'le texte collé');
    return true;
  };

  // Un fichier de palette : une image est lue comme une bande de couleurs, le reste comme du texte.
  U.importerFichier = function (fichier) {
    var l;
    if (/^image\//.test(fichier.type) || /\.(png|gif|bmp|webp)$/i.test(fichier.name)) {
      U.lireImage(fichier, function (data, w, h) {
        var r = P.depuisPixels(data, w, h);
        if (!r.couleurs.length) { U.message('Cette image est entièrement transparente.'); return; }
        U.importer({ nom: fichier.name.replace(/\.[^.]*$/, ''), couleurs: r.couleurs }, '« ' + fichier.name + ' »');
        if (r.tronquee) U.message('L\'image compte plus de ' + P.COULEURS_MAX + ' couleurs : seules les premières sont gardées. Pour une photo, passe par « Extraire d\'une image ».');
      });
      return;
    }
    l = new FileReader();
    l.onerror = function () { U.message('Le fichier n\'a pas pu être lu.'); };
    l.onload = function () { U.importerTexte(String(l.result), fichier.name); };
    l.readAsText(fichier);
  };

  function formatChoisi() { return P.FORMATS.filter(function (f) { return f.id === $('#format').value; })[0]; }
  function texteExport() { return P.ecrire(formatChoisi().id, { nom: P.E.nom, couleurs: P.E.couleurs }); }

  // ---------- Vers Atelier Pixel et Textures ----------
  function rafraichirAtelier() {
    var im = U.image(), sel = $('#atelierContenu'), choix = sel.value || 'vide-32', trop = im && (im.w > P.ATELIER_COTE_MAX || im.h > P.ATELIER_COTE_MAX);
    sel.innerHTML = TOILES_ATELIER.map(function (t) { return '<option value="vide-' + t + '">Toile vide de ' + t + ' × ' + t + ' px</option>'; }).join('') +
      '<option value="image"' + (!im || trop ? ' disabled' : '') + '>L\'image recalculée' + (im ? ' (' + im.w + ' × ' + im.h + ' px)' : '') + '</option>';
    sel.value = choix === 'image' && (!im || trop) ? 'vide-32' : choix;
    $('#noteAtelier').textContent = !im ? 'Avec une image chargée dans « Extraire », le projet peut aussi contenir l\'image recalculée, prête à retoucher.'
      : trop ? 'L\'image dépasse ' + P.ATELIER_COTE_MAX + ' px de côté, la limite d\'un sprite dans Atelier Pixel : seule une toile vide est proposée.' : '';
  }

  function exporterAtelier() {
    var v = $('#atelierContenu').value, projet;
    try {
      projet = P.versAtelier({ nom: P.E.nom, couleurs: P.E.couleurs }, v === 'image' ? { image: U.renduPixels() } : { w: Number(v.slice(5)), h: Number(v.slice(5)) });
    } catch (e) { U.message(e.message); return; }
    U.telecharger(new Blob([JSON.stringify(projet)], { type: 'application/json' }), U.nomFichier() + '-atelier.json');
  }

  // Le moteur de Textures est chargé à la demande depuis le dossier voisin : ce sont ses propres matières
  // et son propre lecteur d'adresse qui servent, sans rien en recopier ici.
  var textures = 'absent';      // 'absent', 'charge', 'pret' ou 'introuvable'

  function chargerTextures() {
    var k = 0;
    if (textures !== 'absent') return;
    textures = 'charge';
    (function suivant() {
      var s;
      if (k >= FICHIERS_TEXTURES.length) {
        textures = window.Textures && window.Textures.matieres && window.Textures.matieres.length ? 'pret' : 'introuvable';
        rafraichirTextures();
        return;
      }
      s = document.createElement('script');
      s.src = '../textures/js/' + FICHIERS_TEXTURES[k++] + '.js';
      s.onload = suivant;
      s.onerror = function () { textures = 'introuvable'; rafraichirTextures(); };
      document.head.appendChild(s);
    })();
  }

  function rafraichirTextures() {
    var T = window.Textures, el = $('#matieres'), h = '';
    if (textures === 'introuvable') { el.innerHTML = '<p class="note">Le dossier « textures » n\'est pas à côté de celui-ci : l\'export vers Textures n\'est pas disponible.</p>'; return; }
    if (textures !== 'pret') { chargerTextures(); return; }
    T.matieres.forEach(function (m) {
      h += '<a class="matiere" data-id="' + m.id + '" target="_blank" rel="noopener" href="../textures/index.html' + P.adresseTextures(P.E.couleurs, m, P.E.nom || 'atelier', 32) + '" title="Ouvrir « ' + echapper(m.nom) + ' » dans Textures avec cette palette"><canvas width="64" height="64"></canvas><span>' + echapper(m.nom) + '</span></a>';
    });
    el.innerHTML = h;
    T.matieres.forEach(function (m) {
      var r = T.depuisTexte(P.adresseTextures(P.E.couleurs, m, P.E.nom || 'atelier', 32)), res, pix, c = el.querySelector('[data-id="' + m.id + '"] canvas'), g = c.getContext('2d'), im, x, y;
      r.images = 1;
      res = T.generer(r);
      pix = T.pixels(res.images[0], res.couleurs);
      im = g.createImageData(64, 64);
      for (y = 0; y < 64; y++) for (x = 0; x < 64; x++) new Uint32Array(im.data.buffer)[y * 64 + x] = pix[(y % 32) * 32 + x % 32];
      g.putImageData(im, 0, 0);
    });
  }

  U.rafraichirFichiers = function () {
    var t = texteExport().split('\n');
    $('#extrait').textContent = t.slice(0, 9).join('\n') + (t.length > 10 ? '\n…' : '');
    rafraichirAtelier();
    rafraichirTextures();
  };

  function initFichiers() {
    $('#format').innerHTML = P.FORMATS.map(function (f) { return '<option value="' + f.id + '">' + echapper(f.nom) + '</option>'; }).join('');
    $('#format').addEventListener('change', U.rafraichirFichiers);
    $('#bExporter').addEventListener('click', function () {
      var f = formatChoisi();
      U.telecharger(new Blob([texteExport()], { type: f.type }), U.nomFichier() + '.' + f.ext);
    });
    $('#bCopier').addEventListener('click', function () { U.copier(texteExport(), formatChoisi().nom); });
    $('#bPng1').addEventListener('click', function () { telechargerBande(1); });
    $('#bPngGrand').addEventListener('click', function () { telechargerBande(Number($('#pngCote').value)); });
    $('#bOuvrir').addEventListener('click', function () { $('#fichierPalette').click(); });
    $('#fichierPalette').addEventListener('change', function () {
      if (this.files[0]) U.importerFichier(this.files[0]);
      this.value = '';
    });
    $('#bLire').addEventListener('click', function () {
      if (!$('#collage').value.trim()) { U.message('Colle d\'abord une liste de couleurs dans la zone de texte.'); return; }
      if (U.importerTexte($('#collage').value, '')) $('#collage').value = '';
    });
    $('#bAtelier').addEventListener('click', exporterAtelier);
  }

  U.initPages = function () {
    initConstruire();
    initVerifier();
    initBibliotheque();
    initFichiers();
  };
})();
