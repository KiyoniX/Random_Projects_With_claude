(function () {
  'use strict';

  var M = window.Tuiles, U = M.ui, J = M.jeux, F = M.formats;

  var CLE = 'tuiles.projet';
  var DELAI_SAUVE = 900;                 // millisecondes de calme avant la sauvegarde automatique
  var ECHELLES = [1, 2, 3, 4, 6, 8];
  var COTE_MAX = 16384, AIRE_MAX = 120e6;   // limites d'une image exportée
  var IMAGE_MAX = 8192;                  // côté maximal d'une image importée
  var ECART_FICHIERS = 350;              // millisecondes entre deux téléchargements enchaînés
  var MATIERES_DEFAUT = ['herbe', 'terre', 'paves', 'eau'];

  var $ = function (s) { return document.querySelector(s); };
  var echapper = U.echapper;

  // ---------- Fenêtres ----------
  // o : { titre, html, ok (libellé, absent pour une simple information), action(formulaire), pret(formulaire), large }.
  // action rend un texte pour signaler une erreur et garder la fenêtre ouverte.
  U.dialogue = function (o) {
    var m = $('#modal'), f, premier;
    m.innerHTML = '<form class="fen' + (o.large ? ' large' : '') + '" novalidate><h2>' + echapper(o.titre) + '</h2><div class="corps">' + o.html + '</div>' +
      '<p class="erreur" hidden></p><div class="pied">' +
      (o.ok ? '<button type="button" class="b" data-fermer>Annuler</button><button type="submit" class="b fort">' + echapper(o.ok) + '</button>'
        : '<button type="button" class="b fort" data-fermer>Fermer</button>') + '</div></form>';
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
    if (o.pret) o.pret(f);
    premier = f.querySelector('input:not([type=radio]):not([type=checkbox]), select') || f.querySelector('button.fort');
    if (premier) { premier.focus(); if (premier.select) premier.select(); }
    f.scrollTop = 0;
  };
  U.fermer = function () { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
  U.fenetreOuverte = function () { return !$('#modal').hidden; };
  U.alerte = function (titre, texte) { U.dialogue({ titre: titre, html: '<p>' + echapper(texte) + '</p>' }); };

  function entier(f, nom, min, max) {
    var v = Math.round(Number(f.elements[nom].value));
    if (!(v >= min && v <= max)) throw new Error('« ' + f.elements[nom].dataset.nom + ' » doit être un nombre entre ' + min + ' et ' + max + '.');
    return v;
  }
  function champ(libelle, nom, valeur, min, max) {
    return '<label class="champ">' + libelle + ' <input type="number" name="' + nom + '" data-nom="' + libelle + '" value="' + valeur + '" min="' + min + '" max="' + max + '" step="1"></label>';
  }
  function liste(libelle, nom, options, choisi) {
    return '<label class="champ">' + libelle + ' <select name="' + nom + '">' + options.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(choisi) ? ' selected' : '') + '>' + echapper(o[1]) + '</option>'; }).join('') + '</select></label>';
  }
  var MODES = [['dessus', 'Vue de dessus'], ['plateformes', 'Plateformes (de profil, avec gravité)']];

  // ---------- Carte ----------
  U.apresChargement = function () {
    U.jeuActif = 0; U.selJeu = { x: 0, y: 0, w: 1, h: 1 }; U.zoomPalette = 0;
    U.tampon = null; U.terrain = null; U.objSel = null;
    U.rafraichir();
    U.cadrer();
  };

  U.dlgNouvelle = function () {
    var c = M.carte;
    U.dialogue({
      titre: 'Nouvelle carte', ok: 'Créer',
      html: '<p class="rang"><label class="champ">Nom <input type="text" name="nom" maxlength="40" value="carte"></label></p>' +
        '<p class="rang">' + champ('Largeur', 'w', 40, 1, M.CARTE_MAX) + champ('Hauteur', 'h', 30, 1, M.CARTE_MAX) + '<span class="note">en cases</span></p>' +
        '<p class="rang">' + liste('Taille d\'une case', 'tc', M.TAILLES_TUILE.map(function (t) { return [t, t + ' px']; }), c.tc) + liste('Essai', 'mode', MODES, c.mode) + '</p>' +
        '<p><label><input type="checkbox" name="jeux" checked> Garder les jeux de tuiles de la carte actuelle</label></p>' +
        '<p class="note">La carte en cours sera remplacée : enregistre le projet d\'abord si tu veux la garder.</p>',
      action: function (f) {
        var jeux = f.elements.jeux.checked ? M.carte.jeux : [], w = entier(f, 'w', 1, M.CARTE_MAX), h = entier(f, 'h', 1, M.CARTE_MAX);
        M.nouvelle({ nom: f.elements.nom.value, w: w, h: h, tc: f.elements.tc.value, mode: f.elements.mode.value });
        jeux.forEach(function (j) { M.jeuAjouter(J.creer({ nom: j.nom, tw: j.tw, th: j.th, cols: j.cols, nb: j.nb, pix: j.pix, anims: j.anims, terrains: j.terrains, noms: j.noms, origine: j.origine }), true); });
        if (!jeux.length) M.jeuAjouter(J.demo(M.carte.tc), true);
        M.installer(M.carte);
        U.apresChargement();
      }
    });
  };

  U.dlgCarte = function () {
    var c = M.carte, cases = '', i;
    for (i = 0; i < 9; i++) cases += '<label><input type="radio" name="ancre" value="' + i + '"' + (i === 0 ? ' checked' : '') + '><span></span></label>';
    U.dialogue({
      titre: 'Taille et réglages de la carte', ok: 'Appliquer',
      html: '<p class="rang">' + champ('Largeur', 'w', c.w, 1, M.CARTE_MAX) + champ('Hauteur', 'h', c.h, 1, M.CARTE_MAX) + '<span class="note">en cases</span></p>' +
        '<div class="rang"><span>Où reste le contenu actuel</span><div class="ancres">' + cases + '</div></div>' +
        '<p class="note">Agrandir ajoute des cases vides du côté opposé à l\'ancrage ; réduire coupe ce qui dépasse. Les objets suivent.</p>' +
        '<p class="rang">' + liste('Taille d\'une case', 'tc', M.TAILLES_TUILE.map(function (t) { return [t, t + ' px']; }), c.tc) + liste('Essai', 'mode', MODES, c.mode) + '</p>' +
        '<p class="rang"><label><input type="checkbox" name="avecFond"' + (c.fond ? ' checked' : '') + '> Couleur de fond</label><input type="color" name="fond" value="' + (c.fond || '#7fb4e6') + '"></p>' +
        '<p class="note">Changer la taille d\'une case ne redessine pas les tuiles : un jeu d\'une autre taille déborde de la case, comme dans Tiled.</p>',
      // Choisir une couleur, c'est vouloir un fond : la case se coche d'elle-même.
      pret: function (f) { f.elements.fond.addEventListener('input', function () { f.elements.avecFond.checked = true; }); },
      action: function (f) {
        var a = Number(f.elements.ancre.value), w = entier(f, 'w', 1, M.CARTE_MAX), h = entier(f, 'h', 1, M.CARTE_MAX), change;
        // Une seule étape d'historique pour tout « Appliquer ».
        change = M.redimensionner(w, h, (a % 3) / 2, Math.floor(a / 3) / 2, true);
        M.carteRegler('tc', f.elements.tc.value, true);
        M.carteRegler('mode', f.elements.mode.value, true);
        M.carteRegler('fond', f.elements.avecFond.checked ? f.elements.fond.value : '', true);
        M.valider('Réglages de la carte');
        if (change) U.cadrer();
        U.toutRepeindre();
      }
    });
  };

  // ---------- Téléchargements ----------
  function telecharger(blob, nom, muet) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = nom;
    // Ce clic-là ne regarde pas la page : il refermerait un menu ouvert entre-temps.
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
    if (!muet) U.message('Fichier « ' + nom + ' » téléchargé.');
  }
  function telechargerToile(c, nom, muet) {
    c.toBlob(function (b) {
      if (b) telecharger(b, nom, muet); else U.alerte('Export impossible', 'Le navigateur n\'a pas pu fabriquer l\'image « ' + nom + ' ».');
    }, 'image/png');
  }
  function telechargerJson(o, nom, muet) { telecharger(new Blob([JSON.stringify(o)], { type: 'application/json' }), nom, muet); }
  // Plusieurs fichiers à la suite, espacés pour que le navigateur les accepte tous.
  function enchainer(taches) {
    taches.forEach(function (t, k) { setTimeout(t, k * ECART_FICHIERS); });
  }

  function toileDePixels(pix, w, h) {
    var c = document.createElement('canvas'), g, im;
    c.width = w; c.height = h;
    g = c.getContext('2d');
    im = g.createImageData(w, h);
    new Uint32Array(im.data.buffer).set(pix);
    g.putImageData(im, 0, 0);
    return c;
  }

  U.enregistrer = function () { telechargerJson(F.versProjet(), F.nomFichier(M.carte.nom) + '.tuiles.json'); };

  // ---------- Export en image ----------
  // Dessine les calques voulus dans une image neuve. o : { k, calques, fond, reperes }.
  U.rendre = function (o) {
    var c = M.carte, r = c.tc * o.k, toile = document.createElement('canvas'), g, x, y, v;
    toile.width = c.w * r; toile.height = c.h * r;
    g = toile.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (o.fond) { g.fillStyle = o.fond; g.fillRect(0, 0, toile.width, toile.height); }
    o.calques.forEach(function (cal) {
      if (!cal.cases || (cal.type === 'collisions' && !o.reperes)) return;
      g.globalAlpha = cal.opacite;
      for (y = 0; y < c.h; y++) {
        for (x = 0; x < c.w; x++) {
          v = cal.cases[y * c.w + x];
          if (!v) continue;
          if (cal.type === 'tuiles') U.dessinerTuile(g, v, x * r, y * r, r, 0); else U.dessinerCollision(g, v, x * r, y * r, r);
        }
      }
    });
    g.globalAlpha = 1;
    return toile;
  };

  U.dlgPng = function () {
    var c = M.carte;
    U.dialogue({
      titre: 'Exporter la carte en PNG', ok: 'Exporter',
      html: '<p class="pile"><label><input type="radio" name="quoi" value="plat" checked> Une image : les calques visibles aplatis</label>' +
        '<label><input type="radio" name="quoi" value="calques"> Une image par calque de tuiles visible</label>' +
        '<label><input type="radio" name="quoi" value="actif"> Le calque actif seul</label></p>' +
        '<p class="rang">' + liste('Agrandissement', 'k', ECHELLES.map(function (k) { return [k, '×' + k]; }), 1) +
        '<label><input type="checkbox" name="fond"' + (c.fond ? ' checked' : '') + (c.fond ? '' : ' disabled') + '> Avec la couleur de fond</label></p>' +
        '<p><label><input type="checkbox" name="reperes"> Montrer aussi les collisions (image aplatie)</label></p>' +
        '<p class="note">' + c.w * c.tc + ' × ' + c.h * c.tc + ' px à l\'échelle 1, sans lissage. Les tuiles animées sont rendues sur leur première image.</p>',
      action: function (f) {
        var k = Number(f.elements.k.value), quoi = f.elements.quoi.value, W = c.w * c.tc * k, H = c.h * c.tc * k, base = F.nomFichier(c.nom), fond = f.elements.fond.checked ? c.fond : '', visibles, actif = M.calqueActif();
        if (W > COTE_MAX || H > COTE_MAX || W * H > AIRE_MAX) return 'L\'image ferait ' + W + ' × ' + H + ' px : réduis l\'agrandissement.';
        visibles = c.calques.filter(function (cal) { return cal.visible && cal.opacite > 0; });
        if (quoi === 'plat') telechargerToile(U.rendre({ k: k, calques: visibles, fond: fond, reperes: f.elements.reperes.checked }), base + '.png');
        else if (quoi === 'actif') {
          if (!actif.cases) return 'Le calque d\'objets ne s\'exporte pas en image.';
          telechargerToile(U.rendre({ k: k, calques: [actif], fond: '', reperes: true }), base + '-' + F.nomFichier(actif.nom) + '.png');
        } else {
          visibles = visibles.filter(function (cal) { return cal.type === 'tuiles'; });
          enchainer(visibles.map(function (cal, n) {
            return function () { telechargerToile(U.rendre({ k: k, calques: [cal], fond: '' }), base + '-' + (n + 1) + '-' + F.nomFichier(cal.nom) + '.png', true); };
          }));
          U.message(visibles.length + ' images en cours de téléchargement.');
        }
      }
    });
  };

  U.exporterJeu = function () {
    var j = jeuMontre();
    if (j) telechargerToile(U.toileJeu(j), F.fichierJeu(j));
  };

  // ---------- Export pour un moteur ----------
  U.dlgMoteur = function () {
    var c = M.carte;
    U.dialogue({
      titre: 'Exporter pour un moteur de jeu', ok: 'Exporter',
      html: '<p>Un fichier JSON simple : les calques en tableaux d\'indices, les collisions, les objets. Le format est décrit dans Aide, « Format d\'export ».</p>' +
        '<p class="pile"><label><input type="checkbox" name="dedans" checked> Incorporer les images des jeux de tuiles dans le fichier</label>' +
        '<label><input type="checkbox" name="png"> Télécharger aussi les images des jeux en PNG</label></p>' +
        '<p class="note">' + c.jeux.length + ' jeu' + (c.jeux.length > 1 ? 'x' : '') + ' de tuiles, ' + c.calques.filter(function (k) { return k.type === 'tuiles'; }).length + ' calques de tuiles, ' + M.calqueDeType('objets').objets.length + ' objets.</p>',
      action: function (f) {
        var dedans = f.elements.dedans.checked, taches = [function () {
          telechargerJson(F.versMoteur(dedans ? function (j) { return U.toileJeu(j).toDataURL('image/png'); } : null), F.nomFichier(c.nom) + '.carte.json');
        }];
        if (f.elements.png.checked) c.jeux.forEach(function (j) { taches.push(function () { telechargerToile(U.toileJeu(j), F.fichierJeu(j), true); }); });
        enchainer(taches);
      }
    });
  };

  U.dlgTiled = function () {
    var t = F.versTiled();
    U.dialogue({
      titre: 'Exporter pour Tiled', ok: 'Exporter',
      html: '<p>La carte au format JSON de Tiled (.tmj), avec une image PNG par jeu de tuiles. Range tous les fichiers dans le même dossier avant d\'ouvrir la carte dans Tiled.</p>' +
        '<p class="note">' + (t.images.length + 1) + ' fichiers : ' + echapper(F.nomFichier(M.carte.nom)) + '.tmj, ' + t.images.map(function (i) { return echapper(i.fichier); }).join(', ') + '.</p>' +
        '<p class="note">Les collisions deviennent un calque de tuiles sur le jeu « collisions » ; les objets, un calque d\'objets avec leurs propriétés en texte.</p>',
      action: function () {
        var taches = [function () { telecharger(new Blob([JSON.stringify(t.carte)], { type: 'application/json' }), F.nomFichier(M.carte.nom) + '.tmj'); }];
        t.images.forEach(function (i) {
          taches.push(function () {
            var p;
            if (i.collisions) { p = F.pixCollisions(M.carte.tc); telechargerToile(toileDePixels(p.pix, p.w, p.h), i.fichier, true); }
            else telechargerToile(U.toileJeu(i.jeu), i.fichier, true);
          });
        });
        enchainer(taches);
      }
    });
  };

  // ---------- Ouverture et import ----------
  function sansExtension(nom) { return nom.replace(/\.[^.]*$/, '').replace(/\.tuiles$/, '').replace(/[\\/:*?"<>|]/g, '-') || 'jeu'; }

  function lireTexte(fichier) {
    return new Promise(function (ok, ko) {
      var l = new FileReader();
      l.onload = function () { ok(l.result); };
      l.onerror = function () { ko(new Error('Le fichier « ' + fichier.name + ' » n\'a pas pu être lu.')); };
      l.readAsText(fichier);
    });
  }
  function lireImage(fichier) {
    return new Promise(function (ok, ko) {
      var l = new FileReader();
      l.onerror = function () { ko(new Error('Le fichier « ' + fichier.name + ' » n\'a pas pu être lu.')); };
      l.onload = function () {
        var img = new Image();
        img.onerror = function () { ko(new Error('« ' + fichier.name + ' » n\'est pas une image reconnue.')); };
        img.onload = function () {
          var c = document.createElement('canvas'), g, w = img.naturalWidth, h = img.naturalHeight;
          if (w > IMAGE_MAX || h > IMAGE_MAX) { ko(new Error('« ' + fichier.name + ' » fait ' + w + ' × ' + h + ' px : le maximum est ' + IMAGE_MAX + '.')); return; }
          c.width = w; c.height = h;
          g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          ok({ nom: fichier.name, pix: new Uint32Array(g.getImageData(0, 0, w, h).data.buffer), w: w, h: h });
        };
        img.src = l.result;
      };
      l.readAsDataURL(fichier);
    });
  }

  function ajouterJeux(jeux, texte) {
    jeux.forEach(function (j, k) { M.jeuAjouter(j, k < jeux.length - 1); });
    U.jeuActif = jeux[0].id;
    U.selJeu = { x: 0, y: 0, w: 1, h: 1 }; U.zoomPalette = 0;
    U.tamponDepuisPalette();
    if (M.calqueActif().type !== 'tuiles') M.allerCalque(M.carte.calques.indexOf(M.carte.calques.filter(function (c) { return c.type === 'tuiles'; })[0]));
    U.toutRepeindre();
    U.rafraichir();
    U.message(texte);
  }

  // Devine la découpe d'après le nom du fichier et la taille de l'image.
  function deviner(im) {
    var c = M.carte, m = /planche-(\d+)x(\d+)/.exec(im.nom), t = /(?:^|-)(\d+)px/.exec(im.nom), o = { tw: c.tc, th: c.tc, anim: '' };
    if (m && Number(m[2]) * Number(m[1]) === im.w) { o.tw = o.th = Number(m[2]); o.anim = 'tout'; }
    else if (/planche/.test(im.nom) && im.w % im.h === 0 && im.w > im.h) { o.tw = o.th = im.h; o.anim = 'tout'; }
    else if (t && im.w % Number(t[1]) === 0 && im.h % Number(t[1]) === 0) o.tw = o.th = Number(t[1]);
    else if (im.w % c.tc || im.h % c.tc) { o.tw = Math.min(im.w, J.TUILE_MAX); o.th = Math.min(im.h, J.TUILE_MAX); }
    return o;
  }

  function dlgDecoupe(im, suivant) {
    var d = deviner(im);
    U.dialogue({
      titre: 'Importer une image comme jeu de tuiles', ok: 'Importer', large: true,
      html: '<div class="deux"><div class="corps">' +
        '<p>« ' + echapper(im.nom) + ' », ' + im.w + ' × ' + im.h + ' px</p>' +
        '<p class="rang"><label class="champ">Nom <input type="text" name="nom" maxlength="40" value="' + echapper(sansExtension(im.nom).slice(0, 40)) + '"></label></p>' +
        '<p class="rang">' + champ('Largeur d\'une tuile', 'tw', d.tw, 1, Math.min(im.w, J.TUILE_MAX)) + champ('Hauteur', 'th', d.th, 1, Math.min(im.h, J.TUILE_MAX)) + '</p>' +
        '<p class="rang">' + champ('Marge autour', 'marge', 0, 0, 64) + champ('Espace entre les tuiles', 'espace', 0, 0, 64) + '</p>' +
        '<p class="rang">' + liste('Animation', 'anim', [['', 'Aucune : chaque case est une tuile'], ['tout', 'Toutes les cases forment une animation'], ['ligne', 'Chaque ligne est une animation']], d.anim) + champ('Durée d\'une image (ms)', 'duree', 125, 10, 60000) + '</p>' +
        '<p class="note" data-bilan></p>' +
        '<p class="note">Une planche d\'animation de Textures ou une planche de sprites d\'Atelier Pixel se découpe à la taille d\'une image, avec « Toutes les cases forment une animation ».</p>' +
        '</div><div class="apercuDecoupe"><canvas data-apercu></canvas></div></div>',
      pret: function (f) {
        var c = f.querySelector('[data-apercu]'), src = toileDePixels(im.pix, im.w, im.h);
        function maj() {
          var tw = Math.max(1, Math.round(Number(f.elements.tw.value)) || 1), th = Math.max(1, Math.round(Number(f.elements.th.value)) || 1), m = Math.max(0, Math.round(Number(f.elements.marge.value)) || 0), e = Math.max(0, Math.round(Number(f.elements.espace.value)) || 0);
          var g = J.grille(im.w, im.h, { tw: tw, th: th, marge: m, espace: e }), k = Math.max(1, Math.floor(Math.min(380 / im.w, 300 / im.h))), ctx, x, y;
          if (im.w * k < 120 && im.h * k < 120) k = Math.max(1, Math.floor(Math.min(240 / im.w, 240 / im.h)));
          f.querySelector('[data-bilan]').textContent = g.cols > 0 && g.rangs > 0 ? g.cols + ' colonnes × ' + g.rangs + ' lignes : ' + g.cols * g.rangs + ' tuiles de ' + tw + ' × ' + th + ' px (les cases vides de la fin sont ignorées).' : 'L\'image est plus petite qu\'une tuile de cette taille.';
          c.width = im.w * k; c.height = im.h * k;
          c.style.width = Math.min(380, im.w * k) + 'px';
          ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(src, 0, 0, im.w * k, im.h * k);
          ctx.strokeStyle = 'rgba(232,176,74,.9)'; ctx.lineWidth = 1;
          for (y = 0; y < g.rangs; y++) for (x = 0; x < g.cols; x++) ctx.strokeRect((m + x * (tw + e)) * k + 0.5, (m + y * (th + e)) * k + 0.5, tw * k - 1, th * k - 1);
        }
        f.addEventListener('input', maj);
        maj();
      },
      action: function (f) {
        var j = J.depuisImage(im.pix, im.w, im.h, {
          nom: f.elements.nom.value, tw: entier(f, 'tw', 1, Math.min(im.w, J.TUILE_MAX)), th: entier(f, 'th', 1, Math.min(im.h, J.TUILE_MAX)),
          marge: entier(f, 'marge', 0, 64), espace: entier(f, 'espace', 0, 64), anim: f.elements.anim.value, duree: entier(f, 'duree', 10, 60000)
        });
        ajouterJeux([j], 'Jeu « ' + j.nom + ' » ajouté : ' + j.nb + ' tuile' + (j.nb > 1 ? 's' : '') + ' de ' + j.tw + ' × ' + j.th + ' px.');
        if (suivant) setTimeout(suivant, 0);
      }
    });
  }

  // Reçoit des fichiers de toute sorte : projet de l'éditeur, atlas de Textures (JSON seul ou avec son image),
  // projet Atelier Pixel, images à découper.
  U.recevoir = function (fichiers) {
    var liste = Array.prototype.slice.call(fichiers), jsons = liste.filter(function (f) { return /\.(json|tmj)$/i.test(f.name) || f.type === 'application/json'; });
    var images = liste.filter(function (f) { return jsons.indexOf(f) < 0; });
    if (!liste.length) return;
    Promise.all([Promise.all(jsons.map(function (f) { return lireTexte(f).then(function (t) { var o; try { o = JSON.parse(t); } catch (e) { throw new Error('« ' + f.name + ' » n\'est pas un fichier JSON lisible.'); } return { nom: f.name, o: o }; }); })), Promise.all(images.map(lireImage))]).then(function (r) {
      var js = r[0], ims = r[1], projet, atlas, reste = ims.slice(), ajoutes = [], file;
      projet = js.filter(function (x) { return x.o && x.o.format === F.FORMAT_PROJET; })[0];
      if (projet) {
        F.depuisProjet(projet.o);
        U.apresChargement();
        U.message('Projet « ' + projet.nom + ' » ouvert.');
        return;
      }
      js.forEach(function (x) {
        var im, jeux;
        if (x.o && x.o.format === 'textures-atlas') {
          im = reste.filter(function (i) { return i.w === x.o.largeur && i.h === x.o.hauteur; })[0];
          if (im) reste.splice(reste.indexOf(im), 1);
          jeux = J.depuisAtlas(x.o, im ? im.pix : null, im ? im.w : 0, im ? im.h : 0);
          atlas = im ? 'image' : 'calcul';
          ajoutes = ajoutes.concat(jeux);
        } else if (x.o && x.o.format === 'atelier-pixel') ajoutes.push(J.depuisAtelier(x.o, sansExtension(x.nom).slice(0, 40)));
        else if (x.o && x.o.format === F.FORMAT_CARTE) throw new Error('« ' + x.nom + ' » est une carte exportée pour un moteur : elle ne se rouvre pas. Ouvre plutôt le projet (.tuiles.json).');
        else throw new Error('« ' + x.nom + ' » n\'est ni un projet de l\'éditeur, ni un atlas de Textures, ni un projet Atelier Pixel.');
      });
      if (ajoutes.length) {
        ajouterJeux(ajoutes, ajoutes.length + ' jeu' + (ajoutes.length > 1 ? 'x' : '') + ' de tuiles ajouté' + (ajoutes.length > 1 ? 's' : '') + (atlas === 'calcul' ? ' (atlas recalculé d\'après ses réglages, sans son image).' : '.'));
      }
      file = reste.slice();
      (function suivant() { var im = file.shift(); if (im) dlgDecoupe(im, suivant); })();
    }).catch(function (err) { U.alerte('Import impossible', err.message || String(err)); });
  };

  U.choisirProjet = function () { $('#fichierProjet').click(); };
  U.choisirFichiers = function () { $('#fichierImport').click(); };

  // ---------- Tuiles de Textures ----------
  function graineAuHasard() { return Math.random().toString(36).slice(2, 8); }

  U.dlgTextures = function () {
    var T = window.Textures, c = M.carte, opts;
    if (!J.texturesPretes()) {
      U.alerte('Textures introuvable', 'Le générateur de Textures (dossier « textures » voisin de celui-ci) n\'a pas pu être chargé. Tu peux toujours exporter un atlas depuis Textures et l\'importer ici.');
      return;
    }
    opts = T.matieres.map(function (m) { return [m.id, m.nom]; });
    U.dialogue({
      titre: 'Générer des tuiles avec Textures', ok: 'Ajouter le jeu', large: true,
      html: '<p>Coche les matières voulues : chacune devient une tuile de ' + c.tc + ' px qui se répète sans raccord. Les matières animées donnent une tuile animée.</p>' +
        '<div class="matieres">' + T.matieres.map(function (m) {
          return '<label class="matiere"><input type="checkbox" name="m" value="' + m.id + '"' + (MATIERES_DEFAUT.indexOf(m.id) >= 0 ? ' checked' : '') + '><canvas width="' + c.tc * 2 + '" height="' + c.tc * 2 + '" data-m="' + m.id + '"></canvas><span>' + echapper(m.nom) + (m.anime ? ' <i title="Matière animée">animée</i>' : '') + '</span></label>';
        }).join('') + '</div>' +
        '<p class="rang"><label class="champ">Graine <input type="text" name="graine" maxlength="40" value="' + graineAuHasard() + '" spellcheck="false"></label><button type="button" class="b" data-hasard>Autre graine</button>' +
        '<label class="champ">Nom du jeu <input type="text" name="nom" maxlength="40" value="Textures"></label></p>' +
        '<h3>Terrain à raccords automatiques</h3>' +
        '<p class="rang">' + liste('Matière', 'ter', [['', 'Aucun']].concat(opts), 'terre') + liste('Autour', 'fond', [['', 'Transparent']].concat(opts), '') + liste('Jeu de', 'forme', [[47, '47 tuiles (coins rentrants)'], [16, '16 tuiles']], 47) + '</p>' +
        '<p class="note">Le terrain se trace avec l\'outil Terrain (T) : bords et coins sont choisis d\'après les cases voisines. Pour d\'autres réglages (couleurs, taille des briques…), compose les textures dans l\'outil Textures et importe son atlas.</p>',
      pret: function (f) {
        function apercus() {
          var graine = f.elements.graine.value || 'atelier';
          T.matieres.forEach(function (m) {
            var cv = f.querySelector('canvas[data-m="' + m.id + '"]'), j = J.depuisTextures([{ matiere: m.id, graine: graine, terrain: 16 }], c.tc, 'x'), g = cv.getContext('2d'), src = toileDePixels(J.tuile(j, 15), c.tc, c.tc), x, y;
            for (y = 0; y < 2; y++) for (x = 0; x < 2; x++) g.drawImage(src, x * c.tc, y * c.tc);
          });
        }
        f.querySelector('[data-hasard]').addEventListener('click', function () { f.elements.graine.value = graineAuHasard(); apercus(); });
        f.elements.graine.addEventListener('input', apercus);
        apercus();
      },
      action: function (f) {
        var graine = f.elements.graine.value || 'atelier', el = [], j;
        Array.prototype.forEach.call(f.querySelectorAll('input[name=m]:checked'), function (x) { el.push({ matiere: x.value, graine: graine }); });
        if (f.elements.ter.value) el.push({ matiere: f.elements.ter.value, graine: graine, terrain: Number(f.elements.forme.value), fond: f.elements.fond.value });
        if (!el.length) return 'Coche au moins une matière, ou choisis un terrain.';
        j = J.depuisTextures(el, c.tc, f.elements.nom.value);
        ajouterJeux([j], 'Jeu « ' + j.nom + ' » ajouté : ' + j.nb + ' tuiles calculées par Textures (graine ' + graine + ').');
      }
    });
  };

  // ---------- Réglages d'un jeu ----------
  // Le jeu affiché ; sans jeu, les commandes du menu Tuiles le disent au lieu de ne rien faire.
  function jeuMontre() {
    var j = U.jeuMontre();
    if (!j) U.message('Aucun jeu de tuiles : importe une image, génère des tuiles avec Textures ou ajoute les tuiles de démonstration.');
    return j;
  }

  U.dlgJeuRenommer = function () {
    var j = jeuMontre();
    if (!j) return;
    U.dialogue({
      titre: 'Renommer le jeu de tuiles', ok: 'Renommer',
      html: '<p class="rang"><label class="champ">Nom <input type="text" name="nom" maxlength="40" value="' + echapper(j.nom) + '"></label></p>',
      action: function (f) { M.jeuRegler(j.id, { nom: M.nomPropre(f.elements.nom.value, j.nom) }); }
    });
  };

  U.jeuSupprimer = function () {
    var j = jeuMontre(), n;
    if (!j) return;
    n = M.jeuEmploi(j.id);
    U.dialogue({
      titre: 'Supprimer le jeu « ' + j.nom + ' »', ok: 'Supprimer',
      html: '<p>' + (n ? n + ' case' + (n > 1 ? 's' : '') + ' de la carte emploie' + (n > 1 ? 'nt' : '') + ' ce jeu : elles seront vidées.' : 'Aucune case de la carte n\'emploie ce jeu.') + ' Ctrl+Z le ramène.</p>',
      action: function () { M.jeuSupprimer(j.id); U.jeuActif = 0; U.tampon = null; U.toutRepeindre(); U.rafraichir(); }
    });
  };

  // Les tuiles choisies dans la palette deviennent les images d'une animation portée par la première.
  U.dlgAnimer = function () {
    var j = jeuMontre(), s = U.selJeu, rangs = [], x, y, k, anims, i;
    if (!j) return;
    for (y = 0; y < s.h; y++) for (x = 0; x < s.w; x++) { k = (s.y + y) * j.cols + s.x + x; if (k < j.nb) rangs.push(k); }
    if (rangs.length < 2) { U.message('Choisis d\'abord, dans le jeu, les tuiles qui forment l\'animation (glisse pour en prendre plusieurs).'); return; }
    U.dialogue({
      titre: 'Animer une tuile', ok: 'Animer',
      html: '<p>Les ' + rangs.length + ' tuiles choisies deviennent les images d\'une animation. Elle est portée par la première (tuile ' + rangs[0] + ') : c\'est elle qu\'on pose sur la carte.</p>' +
        '<p class="rang">' + champ('Durée d\'une image (ms)', 'duree', 150, 10, 60000) + '</p>',
      action: function (f) {
        var d = entier(f, 'duree', 10, 60000);
        anims = {};
        for (i in j.anims) anims[i] = j.anims[i];
        anims[rangs[0]] = rangs.map(function (r) { return { t: r, d: d }; });
        M.jeuRegler(j.id, { anims: anims });
        U.selJeu = { x: rangs[0] % j.cols, y: Math.floor(rangs[0] / j.cols), w: 1, h: 1 };
        U.tamponDepuisPalette();
        U.toutRepeindre();
      }
    });
  };

  U.retirerAnimation = function () {
    var j = jeuMontre(), s = U.selJeu, k, anims = {}, i;
    if (!j) return;
    k = s.y * j.cols + s.x;
    if (!j.anims[k]) { U.message('La tuile choisie n\'est pas animée.'); return; }
    for (i in j.anims) if (Number(i) !== k) anims[i] = j.anims[i];
    M.jeuRegler(j.id, { anims: anims });
    U.toutRepeindre();
  };

  U.dlgTerrain = function () {
    var j = jeuMontre(), s = U.selJeu, k;
    if (!j) return;
    k = s.y * j.cols + s.x;
    if (k >= j.nb || j.tw !== j.th) { U.message('Choisis une tuile carrée dans le jeu.'); return; }
    U.dialogue({
      titre: 'Faire un terrain depuis la tuile ' + k, ok: 'Créer le terrain',
      html: '<p>La tuile est découpée en bords et en coins arrondis : un nouveau jeu reçoit les tuiles du terrain, à tracer avec l\'outil Terrain (T). Le résultat est meilleur avec une tuile qui se répète sans raccord.</p>' +
        '<p class="rang"><label class="champ">Nom <input type="text" name="nom" maxlength="40" value="' + echapper((j.noms[k] || 'Terrain').slice(0, 40)) + '"></label>' + liste('Jeu de', 'forme', [[47, '47 tuiles (coins rentrants)'], [16, '16 tuiles']], 47) + '</p>',
      action: function (f) {
        var n = J.terrainDepuisTuile(j, k, Number(f.elements.forme.value), M.nomPropre(f.elements.nom.value, 'Terrain'));
        ajouterJeux([n], 'Terrain « ' + n.nom + ' » créé : choisis l\'outil Terrain (T) pour le tracer.');
        U.terrain = { jeu: n.id, i: 0 };
        U.choisirOutil('terrain');
      }
    });
  };

  // ---------- Sauvegarde automatique ----------
  var minuterie = null;

  function sauver() {
    var h = new Date();
    minuterie = null;
    try {
      localStorage.setItem(CLE, JSON.stringify(F.versProjet()));
      $('#etatSauve').textContent = 'Sauvegarde auto ' + ('0' + h.getHours()).slice(-2) + ':' + ('0' + h.getMinutes()).slice(-2);
    } catch (err) {
      $('#etatSauve').textContent = 'Sauvegarde auto impossible (projet trop lourd ou stockage interdit) : enregistre le projet';
    }
  }
  U.sauverBientot = function () {
    clearTimeout(minuterie);
    minuterie = setTimeout(sauver, DELAI_SAUVE);
  };
  U.sauverMaintenant = function () { clearTimeout(minuterie); sauver(); };

  // Reprend la carte de la dernière séance. Rend faux s'il n'y en a pas ou si elle est illisible.
  U.reprendre = function () {
    try {
      var t = localStorage.getItem(CLE);
      if (!t) return false;
      F.depuisProjet(JSON.parse(t));
      return true;
    } catch (err) {
      return false;
    }
  };

  U.initFichiers = function () {
    $('#fichierProjet').addEventListener('change', function () { U.recevoir(this.files); this.value = ''; });
    $('#fichierImport').addEventListener('change', function () { U.recevoir(this.files); this.value = ''; });
    $('#modal').addEventListener('click', function (e) {
      if (e.target === this || e.target.closest('[data-fermer]')) U.fermer();
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length && !U.essai) U.recevoir(e.dataTransfer.files);
    });
    window.addEventListener('pagehide', function () { if (minuterie !== null) { clearTimeout(minuterie); sauver(); } });
  };
})();
