(function () {
  'use strict';

  var E = window.Eclairage, U = E.ui;

  var CLE = 'eclairage.projet', CLE_PREFS = 'eclairage.preferences';
  var DELAI_SAUVE = 700;                 // millisecondes d'inactivité avant la sauvegarde automatique
  var ECHELLES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  var DIRECTIONS_MAX = 64;

  var $ = function (s) { return document.querySelector(s); };
  var echapper = U.echapper;

  // ---------- Fenêtres ----------
  // o : { titre, html, ok (libellé, absent pour une simple information), action(formulaire) }.
  // action rend un texte pour signaler une erreur et garder la fenêtre ouverte.
  U.dialogue = function (o) {
    var m = $('#modal'), f, premier;
    m.innerHTML = '<form class="fen" novalidate><h2>' + echapper(o.titre) + '</h2><div class="corps">' + o.html + '</div>' +
      '<p class="erreur" hidden></p><div class="pied">' +
      (o.ok ? '<button type="button" class="btn" data-fermer>Annuler</button><button type="submit" class="btn fort">' + echapper(o.ok) + '</button>'
        : '<button type="button" class="btn fort" data-fermer>Fermer</button>') + '</div></form>';
    m.hidden = false;
    f = m.querySelector('form');
    f.addEventListener('submit', function (e) {
      var r;
      e.preventDefault();
      if (!o.action) { U.fermer(); return; }
      try { r = o.action(f); } catch (err) { r = err.message || String(err); }
      if (typeof r === 'string') {
        f.querySelector('.erreur').textContent = r;
        f.querySelector('.erreur').hidden = false;
      } else U.fermer();
    });
    // Un champ marqué data-si="nom=valeur" ne se montre que si le champ « nom » vaut « valeur ».
    function conditions() {
      [].forEach.call(f.querySelectorAll('[data-si]'), function (el) { var c = el.dataset.si.split('='); el.hidden = !f.elements[c[0]] || f.elements[c[0]].value !== c[1]; });
    }
    f.addEventListener('change', conditions); conditions();
    premier = f.querySelector('input:not([type=radio]):not([type=checkbox]), select') || f.querySelector('button.fort');
    if (premier) { premier.focus(); if (premier.select) premier.select(); }
    f.scrollTop = 0;
  };
  U.fermer = function () { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
  U.fenetreOuverte = function () { return !$('#modal').hidden; };
  U.alerte = function (titre, texte) { U.dialogue({ titre: titre, html: '<p>' + echapper(texte) + '</p>' }); };

  function choixEchelle(defaut) {
    return '<label class="champ">Agrandissement <select name="echelle">' + ECHELLES.map(function (k) {
      return '<option value="' + k + '"' + (k === defaut ? ' selected' : '') + '>×' + k + '</option>';
    }).join('') + '</select></label>';
  }
  function echelleConseillee(cote) {
    var k = 1, i;
    for (i = 0; i < ECHELLES.length; i++) if (cote * ECHELLES[i] <= 256) k = ECHELLES[i];
    return k;
  }
  function plusieurs() { return E.doc.images.length > 1; }
  function choixImages(texte) {
    return plusieurs() ? '<label class="rang"><input type="checkbox" name="toutes"> ' + texte + ' (' + E.doc.images.length + ' images)</label>' : '';
  }
  function images(f) {
    var d = E.doc, l = [], i;
    if (f.elements.toutes && f.elements.toutes.checked) { for (i = 0; i < d.images.length; i++) l.push(i); return l; }
    return [d.iImage];
  }
  function choixDirections(defaut) {
    return '<p class="rang"><label class="champ">Directions <select name="dirs">' +
      [['8', '8 autour du sprite, tous les 45°'], ['16', '16 autour du sprite, tous les 22,5°'], ['4', '4 : haut, droite, bas, gauche'], ['liste', 'ma liste d\'azimuts']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === defaut ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label></p><p class="rang" data-si="dirs=liste"><label class="champ">Liste <input type="text" name="liste" value="0, 90, 180, 270" title="Azimuts en degrés : 0 en haut, 90 à droite"></label></p>';
  }
  // Les azimuts demandés, ou un texte d'erreur.
  function directions(f) {
    var v = f.elements.dirs.value, n = Number(v), l = [], i, m;
    if (v !== 'liste') { for (i = 0; i < n; i++) l.push(Math.round(i * 3600 / n) / 10); return l; }
    // « 22,5 » est un angle ; « 0, 90 » ou « 0;90 » en font deux.
    m = f.elements.liste.value.split(/\s*;\s*|,\s+|\s+/).filter(function (s) { return s !== ''; });
    for (i = 0; i < m.length; i++) {
      n = Number(m[i].replace(',', '.').replace('°', ''));
      if (!isFinite(n) || /,.*,/.test(m[i])) return '« ' + m[i] + ' » n\'est pas un angle.';
      l.push(((n % 360) + 360) % 360);
    }
    if (!l.length) return 'La liste d\'azimuts est vide.';
    if (l.length > DIRECTIONS_MAX) return 'Pas plus de ' + DIRECTIONS_MAX + ' directions.';
    return l;
  }

  // ---------- Téléchargements ----------
  function telecharger(blob, nom) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = nom;
    // Ce clic-là ne regarde pas la page : il refermerait un menu ouvert entre-temps.
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
    U.dire('Fichier « ' + nom + ' » téléchargé.');
  }
  function telechargerPng(pix, w, h, nom) {
    U.versToile(pix, w, h).toBlob(function (b) {
      if (b) telecharger(b, nom); else U.alerte('Export impossible', 'Le navigateur n\'a pas pu fabriquer l\'image.');
    }, 'image/png');
  }
  function base() { return E.doc.nom.replace(/[\\/:*?"<>|]/g, '-') || 'sprite'; }
  function trop(w, h, n) { return w > 16384 || h > 16384 || w * h * (n || 1) > 64e6; }

  // Plusieurs cartes côte à côte, une par image.
  function bande(cartes) {
    var d = E.doc, W = d.w * cartes.length, o = new Uint32Array(W * d.h), y;
    cartes.forEach(function (c, k) { for (y = 0; y < d.h; y++) o.set(c.subarray(y * d.w, (y + 1) * d.w), y * W + k * d.w); });
    return { pix: o, w: W, h: d.h };
  }

  function dlgPlanche() {
    var d = E.doc;
    U.dialogue({
      titre: 'Exporter la planche des directions', ok: 'Exporter',
      html: choixDirections('8') +
        '<p class="rang"><label class="champ">Disposition <select name="forme"><option value="rose">En rose, le sprite au milieu (8 directions)</option><option value="ligne">Une ligne par image</option></select></label></p>' +
        '<p class="rang">' + choixEchelle(1) + '</p>' + choixImages('Toutes les images de l\'animation') +
        '<p class="note">Chaque version est éclairée à ' + Math.round(d.reglages.el) + '° d\'élévation avec les réglages en cours, de ' + d.w + ' × ' + d.h + ' px, fond transparent. En ligne, les directions vont de gauche à droite dans l\'ordre de la liste ; 0° est la lumière qui vient d\'en haut.</p>',
      action: function (f) {
        var az = directions(f), k = Number(f.elements.echelle.value), rose = f.elements.forme.value === 'rose', p;
        if (typeof az === 'string') return az;
        if (rose && az.join() !== '0,45,90,135,180,225,270,315') return 'La rose place les directions tous les 45° autour du sprite : choisis « 8 autour du sprite », ou la disposition en ligne pour ta liste.';
        p = E.planche(az, images(f), rose);
        if (trop(p.w * k, p.h * k)) return 'La planche serait trop grande : réduis l\'agrandissement.';
        telechargerPng(E.agrandir(p.pix, p.w, p.h, k), p.w * k, p.h * k, base() + '-directions.png');
      }
    });
  }

  function dlgGif() {
    var d = E.doc;
    U.dialogue({
      titre: 'Exporter la lumière qui tourne en GIF', ok: 'Exporter',
      html: '<p class="rang"><label class="champ">Pas <select name="pas"><option value="8">8 images</option><option value="16" selected>16 images</option><option value="24">24 images</option><option value="32">32 images</option></select></label>' +
        '<label class="champ">Chaque image <input type="number" name="duree" value="80" min="20" max="2000"> ms</label></p>' +
        '<p class="rang">' + choixEchelle(echelleConseillee(Math.max(d.w, d.h))) + '</p>' +
        (plusieurs() ? '<label class="rang"><input type="checkbox" name="anime" checked> L\'animation du sprite joue pendant que la lumière tourne</label>' : '') +
        '<p class="note">Un tour complet en partant de l\'azimut en cours (' + Math.round(d.reglages.az) + '°), à ' + Math.round(d.reglages.el) + '° d\'élévation. Le GIF n\'a pas de demi-transparence.</p>',
      action: function (f) {
        var n = Number(f.elements.pas.value), ms = Number(f.elements.duree.value), k = Number(f.elements.echelle.value), R = d.reglages, l = [], j, anime = f.elements.anime && f.elements.anime.checked;
        if (!(ms >= 20 && ms <= 2000)) return 'La durée doit aller de 20 à 2000 ms.';
        if (trop(d.w * k, d.h * k, n)) return 'Le GIF serait trop lourd : réduis l\'agrandissement ou le nombre d\'images.';
        for (j = 0; j < n; j++) l.push({ pix: E.eclairer(anime ? j % d.images.length : d.iImage, R, (R.az + j * 360 / n) % 360), duree: ms });
        telecharger(new Blob([window.Atelier.gifEncoder(l, d.w, d.h, { echelle: k, boucle: true })], { type: 'image/gif' }), base() + '-lumiere.gif');
      }
    });
  }

  function dlgAtelier() {
    U.dialogue({
      titre: 'Envoyer les directions vers Atelier Pixel', ok: 'Envoyer',
      html: choixDirections('8') +
        '<p class="rang"><label class="champ">Chaque image <input type="number" name="duree" value="100" min="10" max="60000"> ms</label></p>' +
        choixImages('Toutes les images, une suite par direction') +
        '<p class="note">Un projet Atelier Pixel avec une image par direction, pour retoucher chaque version au crayon. Sa palette reprend les couleurs du rendu.</p>',
      action: function (f) {
        var az = directions(f), ms = Number(f.elements.duree.value), l = [];
        if (typeof az === 'string') return az;
        if (!(ms >= 10 && ms <= 60000)) return 'La durée doit aller de 10 à 60000 ms.';
        // Une suite par direction : toutes les images éclairées de là, puis la direction suivante.
        az.forEach(function (a) { images(f).forEach(function (i) { l.push({ pix: E.eclairer(i, E.doc.reglages, a) }); }); });
        telecharger(new Blob([JSON.stringify(E.versAtelier(l, Math.round(ms)))], { type: 'application/json' }), base() + '-directions-atelier.json');
        U.dire('Projet Atelier Pixel téléchargé : ' + l.length + ' images, à ouvrir dans Atelier Pixel.');
      }
    });
  }

  function dlgNormales() {
    var d = E.doc;
    U.dialogue({
      titre: 'Exporter la carte de normales', ok: 'Exporter',
      html: '<label class="rang"><input type="checkbox" name="inv"> Inverser Y (convention DirectX)</label>' +
        '<p class="rang">' + choixEchelle(1) + '</p>' + choixImages('Toutes les images, côte à côte') +
        '<p class="note">Codage des moteurs : x vers la droite dans le rouge, y vers le haut dans le vert, z vers toi dans le bleu ; une surface plate vaut (128, 128, 255). C\'est la convention dite OpenGL, celle de Godot, de Unity et de Blender. Unreal et les outils DirectX attendent y vers le bas : coche l\'inversion. Les pixels transparents du sprite le restent.</p>',
      action: function (f) {
        var inv = f.elements.inv.checked, k = Number(f.elements.echelle.value), l = images(f), b;
        if (trop(d.w * l.length * k, d.h * k)) return 'L\'image serait trop grande : réduis l\'agrandissement.';
        b = bande(l.map(function (i) { return E.carteNormales(i, d.reglages.profondeur, inv); }));
        telechargerPng(E.agrandir(b.pix, b.w, b.h, k), b.w * k, b.h * k, base() + '-normales' + (inv ? '-directx' : '') + '.png');
      }
    });
  }

  function dlgHauteur() {
    U.dialogue({
      titre: 'Exporter la carte de hauteur', ok: 'Exporter',
      html: '<p class="rang">' + choixEchelle(1) + '</p>' + choixImages('Toutes les images, côte à côte') +
        '<p class="note">Un gris par pixel : noir pour 0, blanc pour 255. Les pixels transparents du sprite le restent.</p>',
      action: function (f) {
        var k = Number(f.elements.echelle.value), l = images(f), d = E.doc, b;
        if (trop(d.w * l.length * k, d.h * k)) return 'L\'image serait trop grande : réduis l\'agrandissement.';
        b = bande(l.map(E.carteHauteur));
        telechargerPng(E.agrandir(b.pix, b.w, b.h, k), b.w * k, b.h * k, base() + '-hauteur.png');
      }
    });
  }

  function dlgPng() {
    var d = E.doc;
    U.dialogue({
      titre: 'Exporter l\'image éclairée', ok: 'Exporter',
      html: '<p class="rang">' + choixEchelle(echelleConseillee(Math.max(d.w, d.h))) + '</p><p class="note">L\'image en cours, éclairée avec les réglages en cours (azimut ' + Math.round(d.reglages.az) + '°, élévation ' + Math.round(d.reglages.el) + '°), fond transparent.</p>',
      action: function (f) {
        var k = Number(f.elements.echelle.value);
        telechargerPng(E.agrandir(E.eclairer(d.iImage, d.reglages), d.w, d.h, k), d.w * k, d.h * k, base() + '-eclaire-' + Math.round(d.reglages.az) + '.png');
      }
    });
  }

  // ---------- Ouverture ----------
  function sansExtension(nom) { return nom.replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '-') || 'sprite'; }

  // Un sprite neuf n'a pas de relief : on lui pose un dôme sur sa silhouette pour partir de quelque chose.
  function premierRelief() {
    var d = E.doc, i, cote = Math.min(d.w, d.h);
    for (i = 0; i < d.images.length; i++) E.pente(i, toutMasque(i), { profil: 'dome', largeur: Math.max(2, Math.round(cote / 6)), hauteur: 200, ajouter: false });
  }
  function toutMasque(i) {
    var im = E.doc.images[i], m = new Uint8Array(im.pix.length), p;
    for (p = 0; p < m.length; p++) m[p] = im.pix[p] ? 1 : 0;
    return m;
  }

  function apresOuverture(texte) {
    U.tourner(false);
    U.ajuster(); U.rafraichir();
    U.dire(texte);
  }

  function ouvrirAtelier(o, nom) {
    var lu = E.lireAtelier(o);
    function charger(toutes) {
      var n = E.depuisAtelier(lu, toutes, nom);
      premierRelief(); E.change(true);
      apresOuverture((n > 1 ? n + ' images ouvertes : peins le relief de la première, puis « Relief → toutes » le recopie.' : 'Sprite d\'Atelier Pixel ouvert.') + ' Un dôme est posé sur la silhouette pour commencer.');
    }
    if (lu.n < 2) { charger(false); return; }
    U.dialogue({
      titre: 'Ce projet a ' + lu.n + ' images', ok: 'Ouvrir',
      html: '<label class="rang"><input type="radio" name="quoi" value="toutes" checked> Toutes les images : chacune a son relief, qu\'on peint ou qu\'on recopie de l\'une à l\'autre</label>' +
        '<label class="rang"><input type="radio" name="quoi" value="une"> Seulement l\'image ' + (lu.iImage + 1) + ', celle qui était ouverte</label>' +
        '<p class="note">Chaque image est la composition de ses calques visibles.' + (lu.n > E.IMAGES_MAX ? ' Seules les ' + E.IMAGES_MAX + ' premières sont gardées.' : '') + '</p>',
      action: function (f) { charger(f.elements.quoi.value === 'toutes'); }
    });
  }

  function poserPalette(o, nomFichier) {
    var p = E.lirePalette(o), avant = E.doc.palette;
    if (avant && avant.join() === p.couleurs.join()) { U.dire('Cette palette est déjà celle du rendu.'); return; }
    E.marquer();
    E.doc.palette = p.couleurs; E.doc.paletteNom = '« ' + (p.nom || sansExtension(nomFichier)) + ' »';
    E.change(true);
    U.dire('Palette de rendu : ' + p.couleurs.length + ' couleurs. « Du sprite » revient aux couleurs du dessin.');
  }

  function ouvrir(fichier) {
    var l = new FileReader(), json = /\.json$/i.test(fichier.name) || fichier.type === 'application/json';
    l.onerror = function () { U.alerte('Ouverture impossible', 'Le fichier n\'a pas pu être lu.'); };
    if (json) {
      l.onload = function () {
        var o;
        try {
          o = JSON.parse(l.result);
          if (o && o.format === 'atelier-pixel') ouvrirAtelier(o, sansExtension(fichier.name));
          else if (o && (o.format === E.FORMAT_PALETTE || (!o.format && (o.couleurs || o.colors)) || Array.isArray(o))) poserPalette(o, fichier.name);
          else {
            E.depuisProjet(o);
            apresOuverture('Projet « ' + fichier.name + ' » ouvert.');
          }
        } catch (err) {
          U.alerte('Ouverture impossible', err instanceof SyntaxError ? 'Ce fichier n\'est ni un projet Éclairage, ni un projet Atelier Pixel, ni une palette lisible.' : err.message);
        }
      };
      l.readAsText(fichier);
      return;
    }
    l.onload = function () {
      var img = new Image();
      img.onerror = function () { U.alerte('Ouverture impossible', 'Ce fichier n\'est pas une image reconnue.'); };
      img.onload = function () {
        var c = document.createElement('canvas'), k, w = img.naturalWidth, h = img.naturalHeight;
        if (w > E.COTE_MAX || h > E.COTE_MAX) { U.alerte('Ouverture impossible', 'L\'image fait ' + w + ' × ' + h + ' px : le maximum est ' + E.COTE_MAX + '. Éclairage travaille sur le sprite à sa taille réelle, pas sur une version agrandie.'); return; }
        c.width = w; c.height = h;
        k = c.getContext('2d');
        k.drawImage(img, 0, 0);
        if (!w || !h) { U.alerte('Ouverture impossible', 'Cette image n\'a pas de taille en pixels.'); return; }
        E.docDepuisImage(new Uint32Array(k.getImageData(0, 0, w, h).data.buffer), w, h, sansExtension(fichier.name));
        premierRelief(); E.change(true);
        apresOuverture('« ' + fichier.name + ' » ouvert, avec un dôme sur sa silhouette pour commencer : peins le relief par-dessus.' + (E.analyse().tronque ? ' Il a plus de 256 couleurs : les rampes ne gardent que les 256 premières.' : ''));
      };
      img.src = l.result;
    };
    l.readAsDataURL(fichier);
  }

  // ---------- Sauvegarde automatique ----------
  var minuterie = null;
  function sauver() {
    var h = new Date();
    minuterie = null;
    try {
      localStorage.setItem(CLE, JSON.stringify(E.versProjet()));
      localStorage.setItem(CLE_PREFS, JSON.stringify({ o: U.o, vue: U.vue, outil: U.outil, trait: U.trait, pelure: U.pelure, fond: U.fond }));
      $('#etatSauve').textContent = 'Sauvegarde auto ' + ('0' + h.getHours()).slice(-2) + ':' + ('0' + h.getMinutes()).slice(-2);
    } catch (err) {
      $('#etatSauve').textContent = 'Sauvegarde auto impossible (stockage plein ou interdit)';
    }
  }
  function sauverBientot() { clearTimeout(minuterie); minuterie = setTimeout(sauver, DELAI_SAUVE); }
  U.sauverBientot = sauverBientot;
  function reprendre() {
    var t, a, k;
    try {
      a = JSON.parse(localStorage.getItem(CLE_PREFS) || 'null');
      if (a) {
        for (k in U.o) if (a.o && typeof a.o[k] === typeof U.o[k]) U.o[k] = a.o[k];
        U.o.taille = E.borne(Math.round(U.o.taille) || 1, 1, 8);
        U.o.hauteur = E.borne(Math.round(U.o.hauteur) || 0, 0, 255); U.o.h2 = E.borne(Math.round(U.o.h2) || 0, 0, 255);
        U.o.largeur = E.borne(Math.round(U.o.largeur) || 1, 1, 32); U.o.force = E.borne(Number(U.o.force) || 0.6, 0.1, 1);
        if (!E.PROFILS[U.o.profil]) U.o.profil = 'dome';
        if (['poser', 'monter', 'creuser'].indexOf(U.o.mode) < 0) U.o.mode = 'poser';
        if (['radial', 'lineaire'].indexOf(U.o.forme) < 0) U.o.forme = 'radial';
        if (['morceau', 'matiere', 'couleur', 'tout'].indexOf(U.o.zone) < 0) U.o.zone = 'morceau';
        if (!(U.o.normale >>> 24)) U.o.normale = E.coderNormale(-0.5, -0.5, 0.7);
        if (U.VUES.some(function (v) { return v.id === a.vue; })) U.vue = a.vue;
        if (U.OUTILS.some(function (o) { return o.id === a.outil; })) U.outil = a.outil;
        U.trait = a.trait !== false; U.pelure = a.pelure !== false; U.fond = a.fond || 'sombre';
      }
    } catch (err) { /* réglages illisibles : on garde ceux de départ */ }
    try {
      t = localStorage.getItem(CLE);
      if (!t) return false;
      E.depuisProjet(JSON.parse(t));
      return true;
    } catch (err) { return false; }
  }

  // ---------- Actions ----------
  function relief(f, texte) {
    E.marquer();
    if (f()) { E.change(); U.dire(texte); } else { E.oublierMarque(); U.dire('Rien n\'a changé.'); }
  }

  var ACTIONS = {
    ouvrir: function () { $('#fichier').click(); },
    enregistrer: function () { telecharger(new Blob([JSON.stringify(E.versProjet())], { type: 'application/json' }), base() + '.eclairage.json'); },
    expPlanche: dlgPlanche,
    expGif: dlgGif,
    expAtelier: dlgAtelier,
    expNormales: dlgNormales,
    expHauteur: dlgHauteur,
    expPng: dlgPng,
    chargerPalette: function () { $('#fichierPalette').click(); },
    paletteSprite: function () {
      if (!E.doc.palette) { U.dire('Le rendu prend déjà les couleurs du sprite.'); return; }
      E.marquer(); E.doc.palette = null; E.doc.paletteNom = ''; E.change(true);
      U.dire('Le rendu reprend les couleurs du sprite.');
    },
    exemple: function () { E.exemple(); apresOuverture('Champignon d\'exemple : son relief est déjà peint.'); U.choisirVue('eclaire'); U.tourner(true); },

    annuler: function () { if (!E.annuler()) U.dire('Rien à annuler.'); },
    retablir: function () { if (!E.retablir()) U.dire('Rien à rétablir.'); },

    penteTout: function () {
      var i = E.doc.iImage;
      relief(function () { return E.pente(i, toutMasque(i), U.o); }, 'Pente automatique sur tout le sprite : ' + E.PROFILS[U.o.profil].toLowerCase() + ' sur ' + U.o.largeur + ' px, jusqu\'à ' + U.o.hauteur + '. Ses réglages sont ceux de l\'outil Pente.');
    },
    lisserTout: function () { var i = E.doc.iImage; relief(function () { return E.lisserTout(i, 1); }, 'Relief lissé d\'un cran.'); },
    aplatTout: function () { var i = E.doc.iImage; relief(function () { return E.aplat(i, toutMasque(i), U.o.hauteur); }, 'Tout le relief est à la hauteur ' + U.o.hauteur + '.'); },
    inverser: function () { var i = E.doc.iImage; relief(function () { return E.inverser(i); }, 'Relief inversé : ce qui sortait rentre.'); },
    effacerNormales: function () { var i = E.doc.iImage; relief(function () { return E.effacerNormales(i); }, 'Normales peintes effacées : la hauteur seule décide.'); },
    copierSuivante: function () {
      var d = E.doc, i = d.iImage, j = (i + 1) % d.images.length;
      if (!plusieurs()) { U.dire('Le sprite n\'a qu\'une image.'); return; }
      relief(function () { return E.copierRelief(i, j); }, 'Relief de l\'image ' + (i + 1) + ' recopié sur l\'image ' + (j + 1) + '.');
      U.allerImage(j);
    },
    copierToutes: function () {
      var d = E.doc, i = d.iImage;
      if (!plusieurs()) { U.dire('Le sprite n\'a qu\'une image.'); return; }
      relief(function () { var ch = false, j; for (j = 0; j < d.images.length; j++) if (j !== i) ch = E.copierRelief(i, j) || ch; return ch; }, 'Relief de l\'image ' + (i + 1) + ' recopié ' + (d.images.length > 2 ? 'sur les ' + (d.images.length - 1) + ' autres, là où elles sont dessinées.' : 'sur l\'autre, là où elle est dessinée.'));
    },
    imgPrecedente: function () { U.allerImage(E.doc.iImage - 1); },
    imgSuivante: function () { U.allerImage(E.doc.iImage + 1); },

    tourner: function () { U.tourner(); },
    ombres: function () { E.doc.reglages.ombres = !E.doc.reglages.ombres; U.changeLumiere(); },
    rim: function () { E.doc.reglages.rim = !E.doc.reglages.rim; U.changeLumiere(); },
    spec: function () { E.doc.reglages.spec = !E.doc.reglages.spec; U.changeLumiere(); },

    trait: function () { U.trait = !U.trait; U.redessiner(); cocher(); sauverBientot(); },
    pelure: function () { U.pelure = !U.pelure; U.redessiner(); cocher(); sauverBientot(); },
    ajuster: function () { U.ajuster(); },
    zoomPlus: function () { U.zoomPas(1); },
    zoomMoins: function () { U.zoomPas(-1); },
    taillePlus: function () { U.o.taille = Math.min(8, U.o.taille + 1); U.surOutil(); U.redessiner(); sauverBientot(); },
    tailleMoins: function () { U.o.taille = Math.max(1, U.o.taille - 1); U.surOutil(); U.redessiner(); sauverBientot(); },
    aide: aide
  };
  E.PREREGLAGES.forEach(function (p) { ACTIONS['pre:' + p.id] = function () { U.appliquerPrereglage(p.id); }; });
  ['sombre', 'gris', 'clair'].forEach(function (f) { ACTIONS['fond:' + f] = function () { U.fond = f; U.redessiner(); cocher(); sauverBientot(); }; });

  function agir(nom) {
    if (nom.indexOf('outil:') === 0) { U.choisirOutil(nom.slice(6)); sauverBientot(); return; }
    if (nom.indexOf('vue:') === 0) { U.choisirVue(nom.slice(4)); sauverBientot(); return; }
    if (U.gesteEnCours() || !ACTIONS[nom]) return;
    ACTIONS[nom]();
  }
  U.agir = agir;

  // ---------- Menus ----------
  var MENUS = [
    { titre: 'Fichier', items: [['ouvrir', 'Ouvrir un sprite ou un projet…', 'Ctrl+O'], ['enregistrer', 'Enregistrer le projet', 'Ctrl+S'], null,
      ['expPlanche', 'Exporter la planche des directions…'], ['expGif', 'Exporter la lumière qui tourne en GIF…'], ['expAtelier', 'Envoyer les directions vers Atelier Pixel…'], ['expPng', 'Exporter l\'image éclairée…'], null,
      ['expNormales', 'Exporter la carte de normales…'], ['expHauteur', 'Exporter la carte de hauteur…'], null,
      ['chargerPalette', 'Charger une palette de rendu…'], ['paletteSprite', 'Rendre avec les couleurs du sprite'], null,
      ['exemple', 'Champignon d\'exemple']] },
    { titre: 'Édition', items: [['annuler', 'Annuler', 'Ctrl+Z'], ['retablir', 'Rétablir', 'Ctrl+Y']] },
    { titre: 'Relief', items: [['penteTout', 'Pente automatique sur tout le sprite'], ['lisserTout', 'Lisser tout le relief'], ['aplatTout', 'Tout mettre à la hauteur choisie'], ['inverser', 'Inverser le relief'], ['effacerNormales', 'Effacer les normales peintes'], null,
      ['copierSuivante', 'Recopier le relief sur l\'image suivante'], ['copierToutes', 'Recopier le relief sur toutes les images']] },
    { titre: 'Lumière', items: [['tourner', 'Faire tourner la lumière', 'R'], null].concat(E.PREREGLAGES.map(function (p) { return ['pre:' + p.id, p.nom]; }), [null,
      ['rim', 'Contre-jour'], ['spec', 'Reflet spéculaire'], ['ombres', 'Ombres portées']]) },
    { titre: 'Vue', items: U.VUES.map(function (v, i) { return ['vue:' + v.id, v.nom, String(i + 1)]; }).concat([null,
      ['trait', 'Trait en surimpression', 'T'], ['pelure', 'Pelure du sprite', 'O'], null,
      ['ajuster', 'Voir en entier', '0'], ['zoomPlus', 'Zoom avant', '+'], ['zoomMoins', 'Zoom arrière', '−'], null,
      ['fond:sombre', 'Fond sombre'], ['fond:gris', 'Fond gris à 18 %'], ['fond:clair', 'Fond clair']]) },
    { titre: 'Aide', items: [['aide', 'Mode d\'emploi et raccourcis', 'F1']] }
  ];

  function menuOuvert() { return !!document.querySelector('.menu-titre.ouvert'); }
  function fermerMenus() {
    var o = document.querySelectorAll('.menu-titre.ouvert'), i;
    for (i = 0; i < o.length; i++) { o[i].classList.remove('ouvert'); o[i].nextElementSibling.hidden = true; }
    return o.length > 0;
  }
  function ouvrirMenu(titre) {
    fermerMenus();
    titre.classList.add('ouvert'); titre.nextElementSibling.hidden = false;
  }
  function cocher() {
    var R = E.doc.reglages, c = { tourner: U.tourne, ombres: R.ombres, rim: R.rim, spec: R.spec, trait: U.trait, pelure: U.pelure }, k, els, i;
    U.VUES.forEach(function (v) { c['vue:' + v.id] = U.vue === v.id; });
    E.PREREGLAGES.forEach(function (p) { c['pre:' + p.id] = R.prereglage === p.id; });
    ['sombre', 'gris', 'clair'].forEach(function (f) { c['fond:' + f] = U.fond === f; });
    for (k in c) { els = document.querySelectorAll('.menu-liste [data-act="' + k + '"]'); for (i = 0; i < els.length; i++) els[i].classList.toggle('coche', !!c[k]); }
    $('#cTrait').checked = U.trait; $('#cPelure').checked = U.pelure;
    $('#bTourner').classList.toggle('allume', U.tourne);
    $('#bTourner').textContent = U.tourne ? '■ Arrêter' : '⟳ Tourner';
  }
  U.cocher = cocher;
  function initMenus() {
    var z = $('#menus');
    z.innerHTML = MENUS.map(function (m) {
      return '<div class="menu"><button type="button" class="menu-titre">' + m.titre + '</button><div class="menu-liste" hidden>' + m.items.map(function (it) {
        return it ? '<button type="button" data-act="' + it[0] + '"><span>' + it[1] + '</span>' + (it[2] ? '<kbd>' + it[2] + '</kbd>' : '') + '</button>' : '<hr>';
      }).join('') + '</div></div>';
    }).join('');
    z.addEventListener('click', function (e) {
      var t = e.target.closest('.menu-titre');
      if (!t) return;
      if (t.classList.contains('ouvert')) fermerMenus(); else ouvrirMenu(t);
      e.stopPropagation();
    });
    z.addEventListener('pointerover', function (e) {
      var t = e.target.closest('.menu-titre');
      if (t && menuOuvert() && !t.classList.contains('ouvert')) ouvrirMenu(t);
    });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'), bouton = e.target.closest('button');
      fermerMenus();
      // Un bouton cliqué à la souris ne garde pas le focus : Espace sert ensuite à déplacer la vue, pas à le relancer.
      if (bouton && e.detail) bouton.blur();
      if (b && !b.disabled) agir(b.dataset.act);
    });
  }

  // ---------- Aide ----------
  function aide() {
    function table(l) { return '<table>' + l.map(function (r) { return '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>'; }
    U.dialogue({
      titre: 'Éclairage : donner du relief à un sprite',
      html: '<div class="aide"><div><h3>La marche à suivre</h3><ol>' +
        '<li><b>Ouvrir.</b> Un PNG à sa taille réelle (jusqu\'à ' + E.COTE_MAX + ' px de côté) ou un projet Atelier Pixel. Un dôme est posé sur la silhouette pour commencer.</li>' +
        '<li><b>Peindre le relief.</b> En vue Hauteur (2), le blanc sort, le noir rentre. La pente automatique bombe un morceau d\'un clic, le dégradé radial aussi ; le pinceau et le lissage reprennent le détail.</li>' +
        '<li><b>Poser des normales à la main</b> là où la hauteur ne suffit pas (un pli, une lame, un brin d\'herbe) : choisis la direction sur la boule, puis peins. Les points bleus les montrent.</li>' +
        '<li><b>Éclairer.</b> Glisse sur la boule grise : le point de couleur est la lumière. Autour, le sprite éclairé de huit côtés. Les ambiances donnent un point de départ.</li>' +
        '<li><b>Exporter</b> la planche des directions, le GIF de la lumière qui tourne, les images vers Atelier Pixel, ou la carte de normales pour un moteur de jeu.</li></ol>' +
        '<h3>Les conventions</h3><p class="note">L\'azimut se compte comme sur un cadran : 0° la lumière vient d\'en haut, 90° de la droite. L\'élévation va de 0° (rasante) à 90° (de face). La profondeur dit combien de pixels séparent une hauteur de 0 d\'une hauteur de 255.</p>' +
        '<p class="note">La carte de normales suit la convention OpenGL : x vers la droite dans le rouge, y vers le haut dans le vert, z vers toi dans le bleu ; une surface plate vaut (128, 128, 255). Godot, Unity et Blender la lisent telle quelle ; pour Unreal et DirectX, coche « Inverser Y » à l\'export.</p>' +
        '<p class="note">Le rendu garde l\'esprit du pixel-art : chaque pixel reste dans la rampe de sa couleur et prend le ton le plus proche en clarté. Si une rampe n\'a qu\'un ton, la lumière n\'y peut rien : charge une palette plus riche, ou passe en couleurs libres.</p></div>' +
        '<div><h3>Partout</h3>' + table([['1 2 3 4', 'Sprite, hauteur, normales, éclairé'], ['Molette', 'Zoom sur le curseur'], ['Espace ou clic milieu', 'Déplacer la vue'], ['0', 'Voir en entier'], ['Ctrl+Z, Ctrl+Y', 'Annuler, rétablir'], ['Ctrl+S, Ctrl+O', 'Enregistrer, ouvrir'], ['T', 'Trait en surimpression'], ['O', 'Pelure du sprite'], ['R', 'Faire tourner la lumière'], ['← →', 'Image précédente, suivante']]) +
        '<h3>Outils</h3>' + table([['B', 'Pinceau de hauteur'], ['F', 'Aplat'], ['G', 'Dégradé'], ['P', 'Pente automatique'], ['S', 'Lissage'], ['I', 'Pipette de hauteur'], ['N', 'Normale à la main'], ['H', 'Main'], ['[ ]', 'Taille du pinceau'], ['Alt+clic', 'Pipette avec n\'importe quel outil']]) + '</div>' +
        '<div><h3>Les zones</h3><p class="note">L\'aplat, le dégradé et la pente agissent sur une zone qui part du pixel cliqué : le morceau (tous les pixels qui se touchent), la matière (les pixels d\'une même rampe de couleurs), la même couleur, ou tout le sprite.</p>' +
        '<h3>Les profils de pente</h3>' + table([['Dôme', 'Bord raide, sommet rond : un caillou, un chapeau'], ['Biseau', 'Pente droite : une pierre taillée, un cadre'], ['Coussin', 'Doux au bord comme au sommet : un tissu, une bulle']]) +
        '<h3>Le rendu</h3>' + table([['Rampe', 'Chaque pixel dans sa propre rampe'], ['Palette', 'La couleur la plus proche de toute la palette'], ['Libres', 'Les couleurs calculées, sans quantification']]) + '</div></div>'
    });
  }

  // ---------- Clavier ----------
  function touche(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, ctrl = e.ctrlKey || e.metaKey, cible = e.target, tag = cible.tagName, chiffre = /^(?:Digit|Numpad)([0-9])$/.exec(e.code), o;
    var saisie = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && cible.type !== 'checkbox' && cible.type !== 'range' && cible.type !== 'color');
    if (k === 'Escape') {
      if (U.fenetreOuverte()) U.fermer();
      else if (fermerMenus()) return;
      else if (saisie) cible.blur();
      else U.tourner(false);
      return;
    }
    if (U.fenetreOuverte()) return;
    if (k === 'F1') { e.preventDefault(); agir('aide'); return; }
    // Sur un clavier français, [ et ] demandent AltGr, que Windows annonce comme Ctrl+Alt.
    if (e.ctrlKey && e.altKey && (k === '[' || k === ']') && !saisie) { e.preventDefault(); agir(k === '[' ? 'tailleMoins' : 'taillePlus'); return; }
    if (ctrl && !e.altKey) {
      // Dans un champ, Ctrl+Z et Ctrl+Y défont la saisie, pas le relief.
      if (saisie && (k === 'z' || k === 'y')) return;
      o = { z: e.shiftKey ? 'retablir' : 'annuler', y: 'retablir', s: 'enregistrer', o: 'ouvrir' }[k];
      if (o) { e.preventDefault(); agir(o); }
      return;
    }
    if (saisie) { if (k === 'Enter') cible.blur(); return; }
    if (tag === 'INPUT' && cible.type === 'range' && /^Arrow|^Page|^Home$|^End$/.test(k)) return;
    if (e.altKey) { if (k === 'Alt') e.preventDefault(); return; }
    if (k === ' ') {
      // Un bouton atteint au clavier s'active avec Espace.
      if (tag === 'BUTTON') return;
      e.preventDefault();
      if (!U.espace) { U.espace = true; $('#scene').classList.add('main'); }
      return;
    }
    // Les chiffres se lisent sur la position de la touche : un clavier français les donne sans Maj.
    // Les signes de raccourci (le « - » est sur la touche 6) se lisent tels quels.
    if (chiffre && '+=-[]'.indexOf(k) < 0) k = chiffre[1];
    o = U.OUTILS.filter(function (x) { return x.touche === k; })[0];
    if (k >= '1' && k <= '4' && k.length === 1) o = 'vue:' + U.VUES[Number(k) - 1].id;
    else if (k === '0') o = 'ajuster';
    else if (k === '+' || k === '=') o = 'zoomPlus';
    else if (k === '-') o = 'zoomMoins';
    else if (k === '[') o = 'tailleMoins';
    else if (k === ']') o = 'taillePlus';
    else if (k === 'ArrowLeft') o = 'imgPrecedente';
    else if (k === 'ArrowRight') o = 'imgSuivante';
    else if (k === 't') o = 'trait';
    else if (k === 'o') o = 'pelure';
    else if (k === 'r') o = 'tourner';
    else if (o) o = 'outil:' + o.id;
    if (!o) return;
    e.preventDefault();
    agir(o);
  }
  function relache(e) {
    if (e.key !== ' ' || !U.espace) return;
    U.espace = false;
    if (!U.gesteEnCours()) $('#scene').classList.remove('main');
  }

  // ---------- Démarrage ----------
  function init() {
    var repris;
    U.initVue();
    U.initPanneaux();
    initMenus();
    $('#fichier').addEventListener('change', function () { if (this.files[0]) ouvrir(this.files[0]); this.value = ''; });
    $('#fichierPalette').addEventListener('change', function () {
      var f = this.files[0], l = new FileReader();
      this.value = '';
      if (!f) return;
      l.onload = function () { try { poserPalette(JSON.parse(l.result), f.name); } catch (err) { U.alerte('Palette illisible', err instanceof SyntaxError ? 'Ce fichier n\'est pas un JSON lisible.' : err.message); } };
      l.readAsText(f);
    });
    $('#modal').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-fermer]')) U.fermer(); });
    document.addEventListener('keydown', touche);
    document.addEventListener('keyup', relache);
    window.addEventListener('blur', function () { U.espace = false; if (!U.gesteEnCours()) $('#scene').classList.remove('main'); });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files[0] && !U.fenetreOuverte()) ouvrir(e.dataTransfer.files[0]);
    });
    window.addEventListener('pagehide', function () { if (minuterie !== null) { clearTimeout(minuterie); sauver(); } });

    repris = reprendre();
    if (!repris) { E.exemple(); U.vue = 'eclaire'; }
    E.surChange = function () { U.rafraichir(); sauverBientot(); };
    U.choisirOutil(U.outil);
    U.choisirVue(U.vue);
    U.ajuster();
    U.rafraichir();
    if (!repris) { U.dire('Champignon d\'exemple, relief déjà peint : glisse sur la boule grise pour placer la lumière. Le menu Fichier ouvre ton sprite.'); U.tourner(true); }
  }

  init();
})();
