(function () {
  'use strict';

  var B = window.Banc, M = window.Particules, U = B.ui;

  var CLE = 'particules.effet', CLE_FOND = 'particules.fond';
  var DELAI_SAUVE = 700;                 // millisecondes d'inactivité avant la sauvegarde automatique
  var ECHELLES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  var EXEMPLE = 'feu';

  var $ = function (s) { return document.querySelector(s); };
  var echapper = U.echapper;

  // ---------- Fenêtres ----------
  // o : { titre, html, ok (libellé, absent pour une simple information), action(formulaire) }.
  // action rend un texte pour signaler une erreur et garder la fenêtre ouverte.
  U.dialogue = function (o) {
    var m = $('#modal'), f, premier;
    if (U.joue) U.lire(false);
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
  function echelleConseillee() {
    var cote = Math.max(B.doc.w, B.doc.h), k = 1, i;
    for (i = 0; i < ECHELLES.length; i++) if (cote * ECHELLES[i] <= 256) k = ECHELLES[i];
    return k;
  }
  function demanderNom(titre, valeur, ok, suite) {
    U.dialogue({
      titre: titre, ok: ok,
      html: '<label class="champ">Nom <input type="text" name="nom" maxlength="40" value="' + echapper(valeur) + '"></label>',
      action: function (f) {
        var nom = f.elements.nom.value.trim();
        if (!nom) return 'Il faut un nom.';
        suite(nom);
      }
    });
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
  U.telecharger = telecharger;
  function telechargerPng(pix, w, h, nom) {
    M.versToile(pix, w, h).toBlob(function (b) {
      if (b) telecharger(b, nom); else U.alerte('Export impossible', 'Le navigateur n\'a pas pu fabriquer l\'image.');
    }, 'image/png');
  }
  function base() { return B.doc.nom.replace(/[\\/:*?"<>|]/g, '-') || 'effet'; }
  // Le nom sous lequel un jeu appellera l'effet : minuscules, sans accent ni espace.
  function nomLecteur() {
    return B.doc.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'effet';
  }

  function dlgPlanche() {
    var d = B.doc, n = d.images;
    U.dialogue({
      titre: 'Exporter la planche de sprites', ok: 'Exporter',
      html: '<p class="rang"><label class="champ">Disposition <select name="forme"><option value="ligne">Une ligne</option><option value="colonne">Une colonne</option><option value="grille">Grille</option></select></label>' +
        '<label class="champ">Colonnes <input type="number" name="cols" value="' + Math.ceil(Math.sqrt(n)) + '" min="1" max="' + n + '"></label></p><p class="rang">' + choixEchelle(1) + '</p>' +
        '<p class="note">' + n + ' image' + (n > 1 ? 's' : '') + ' de ' + d.w + ' × ' + d.h + ' px, rangées de gauche à droite puis de haut en bas, fond transparent. « Colonnes » ne sert qu\'à la grille. Un jeu les lit à ' + d.cadence + ' images par seconde.</p>',
      action: function (f) {
        var forme = f.elements.forme.value, k = Number(f.elements.echelle.value), cols = Math.round(Number(f.elements.cols.value)), p;
        if (forme === 'grille' && !(cols >= 1 && cols <= n)) return '« Colonnes » doit être un nombre entre 1 et ' + n + '.';
        p = B.planche(forme === 'ligne' ? n : forme === 'colonne' ? 1 : cols);
        if (p.w * k > 16384 || p.h * k > 16384) return 'La planche serait trop grande : réduis l\'agrandissement ou choisis une grille.';
        telechargerPng(B.agrandir(p.pix, p.w, p.h, k), p.w * k, p.h * k, base() + '-planche.png');
      }
    });
  }

  function dlgGif() {
    var d = B.doc, boucle = d.couches.some(function (c) { return c.visible && c.debit > 0; });
    U.dialogue({
      titre: 'Exporter en GIF animé', ok: 'Exporter',
      html: '<p class="rang">' + choixEchelle(echelleConseillee()) + '<label><input type="checkbox" name="boucle"' + (boucle ? ' checked' : '') + '> Lecture en boucle</label></p>' +
        '<p class="rang"><label class="champ">Fond <select name="fond"><option value="">transparent</option><option value="#3c3d41">gris</option><option value="#0f1219">nuit</option><option value="#c8ced6">jour</option></select></label></p>' +
        '<p class="note">' + d.images + ' image' + (d.images > 1 ? 's' : '') + ' à ' + d.cadence + ' par seconde. Le GIF arrondit les durées au centième de seconde ; l\'effet n\'a pas de demi-transparence, il passe donc tel quel.</p>',
      action: function (f) {
        var fond = f.elements.fond.value ? M.hexVers(f.elements.fond.value) : 0;
        var images = B.images().map(function (pix) {
          var o = pix, i;
          if (fond) { o = new Uint32Array(pix.length); for (i = 0; i < pix.length; i++) o[i] = pix[i] || fond; }
          return { pix: o, duree: 1000 / d.cadence };
        });
        var octets = window.Atelier.gifEncoder(images, d.w, d.h, { echelle: Number(f.elements.echelle.value), boucle: f.elements.boucle.checked });
        telecharger(new Blob([octets], { type: 'image/gif' }), base() + '.gif');
      }
    });
  }

  function dlgPng() {
    var d = B.doc;
    U.dialogue({
      titre: 'Exporter l\'image en PNG', ok: 'Exporter',
      html: '<p class="rang">' + choixEchelle(echelleConseillee()) + '</p><p class="note">L\'image ' + (U.f + 1) + ' sur ' + d.images + ', au format du sprite, fond transparent.</p>',
      action: function (f) {
        var k = Number(f.elements.echelle.value);
        telechargerPng(B.agrandir(B.image(U.f), d.w, d.h, k), d.w * k, d.h * k, base() + '-' + (U.f + 1) + '.png');
      }
    });
  }

  function dlgLecteur() {
    var nom = nomLecteur();
    U.dialogue({
      titre: 'Fichier pour le lecteur', ok: 'Télécharger',
      html: '<label class="champ">Nom dans le jeu <input type="text" name="nom" maxlength="40" value="' + echapper(nom) + '"></label>' +
        '<p class="note">Un petit fichier .js qui déclare l\'effet. Le jeu charge <code>particules/lecteur.js</code>, puis ce fichier, et l\'effet joue en temps réel avec le même moteur, image pour image. Le mode d\'emploi est dans l\'aide (F1).</p>',
      action: function (f) {
        var n = f.elements.nom.value.trim();
        if (!n) return 'Il faut un nom.';
        telecharger(new Blob([B.versLecteur(n)], { type: 'text/javascript' }), n.replace(/[\\/:*?"<>|\s]+/g, '-') + '.js');
      }
    });
  }

  // ---------- Ouverture ----------
  function sansExtension(nom) { return nom.replace(/\.[^.]*$/, '').slice(0, 60) || 'effet'; }

  function apresOuverture(texte, prereglage) {
    U.f = 0;
    U.marquerPrereglage(prereglage || '');
    U.ajuster();
    U.dire(texte);
    if (B.doc.images > 1) U.lire(true);
  }

  function ouvrir(fichier) {
    var l = new FileReader();
    l.onerror = function () { U.alerte('Ouverture impossible', 'Le fichier n\'a pas pu être lu.'); };
    l.onload = function () {
      var o, t = String(l.result);
      try {
        o = /^\s*[{[]/.test(t) ? JSON.parse(t) : B.depuisLecteur(t);
        if (!o) throw new Error('Ce fichier n\'est ni un effet de Particules (.json) ni un fichier pour le lecteur (.js).');
        if (o.format === 'atelier-pixel') throw new Error('C\'est un projet Atelier Pixel : ouvre-le dans Atelier Pixel. Particules ouvre ses propres effets.');
        B.ouvrirEffet(o, true);
        apresOuverture('Effet « ' + fichier.name + ' » ouvert. Ctrl+Z revient à l\'effet d\'avant.');
      } catch (err) {
        U.alerte('Ouverture impossible', err instanceof SyntaxError ? 'Ce fichier n\'est pas un effet lisible : le JSON est abîmé.' : err.message);
      }
    };
    l.readAsText(fichier);
  }

  // ---------- Sauvegarde automatique ----------
  var minuterie = null;
  function sauver() {
    var h = new Date();
    minuterie = null;
    try {
      localStorage.setItem(CLE, JSON.stringify(B.doc));
      $('#etatSauve').textContent = 'Sauvegarde auto ' + ('0' + h.getHours()).slice(-2) + ':' + ('0' + h.getMinutes()).slice(-2);
    } catch (err) {
      $('#etatSauve').textContent = 'Sauvegarde auto impossible (stockage plein ou interdit)';
    }
  }
  function sauverBientot() { clearTimeout(minuterie); minuterie = setTimeout(sauver, DELAI_SAUVE); }
  function reprendre() {
    try {
      var t = localStorage.getItem(CLE);
      if (!t) return false;
      B.ouvrirEffet(JSON.parse(t));
      return true;
    } catch (err) { return false; }
  }

  // ---------- Actions ----------
  var ACTIONS = {
    ouvrir: function () { $('#fichier').click(); },
    enregistrer: function () { telecharger(new Blob([JSON.stringify(B.versJson(), null, 1)], { type: 'application/json' }), base() + '.json'); },
    expPlanche: dlgPlanche,
    expGif: dlgGif,
    expPng: dlgPng,
    expAtelier: function () {
      telecharger(new Blob([JSON.stringify(B.versAtelier())], { type: 'application/json' }), base() + '-atelier.json');
      U.dire('Projet Atelier Pixel téléchargé : ouvre-le dans Atelier Pixel pour retoucher chaque image à la main.');
    },
    expLecteur: dlgLecteur,
    nouveau: function () {
      B.ouvrirEffet({ format: M.FORMAT, version: M.VERSION, nom: 'effet', w: 48, h: 48, images: 16, cadence: 12, graine: 1, couches: [{
        nom: 'Couche 1', emetteur: { forme: 'point', x: 24, y: 34 }, debit: 16, vie: 1, vieVar: 0.3, vitesse: 20, vitesseVar: 0.3, dispersion: 40, forme: 'carre', taille0: 2, taille1: 1,
        rampe: ['#ffffff', '#ffd84f', '#ff8a2e']
      }] }, true);
      apresOuverture('Effet neuf : une couche, un point qui émet vers le haut. Ctrl+Z revient à l\'effet d\'avant.');
    },

    annuler: function () { if (!B.annuler()) U.dire('Rien à annuler.'); },
    retablir: function () { if (!B.retablir()) U.dire('Rien à rétablir.'); },
    graine: function () {
      var g = (B.doc.graine * 7919 + 104729) % 999983 + 1;
      B.regler('@graine', g);
      U.dire('Graine ' + g + ' : mêmes réglages, autre hasard. Ctrl+Z reprend la précédente.');
    },

    coucheAjouter: function () { if (!B.coucheAjouter()) U.dire('Un effet a au plus ' + M.COUCHES_MAX + ' couches.'); },
    coucheDupliquer: function () { if (!B.coucheAjouter(B.couche())) U.dire('Un effet a au plus ' + M.COUCHES_MAX + ' couches.'); },
    coucheMonter: function () { if (!B.coucheEmpiler(1)) U.dire('« ' + B.couche().nom + ' » est déjà dessinée par-dessus les autres.'); },
    coucheDescendre: function () { if (!B.coucheEmpiler(-1)) U.dire('« ' + B.couche().nom + ' » est déjà tout en dessous.'); },
    coucheSupprimer: function () {
      var nom = B.couche().nom;
      if (!B.coucheSupprimer()) U.dire('Un effet garde au moins une couche.');
      else U.dire('« ' + nom + ' » supprimée. Ctrl+Z la ramène.');
    },
    coucheRenommer: function () { demanderNom('Renommer la couche', B.couche().nom, 'Renommer', function (nom) { B.regler('nom', nom); }); },
    coucheCacher: function () { B.regler('visible', !B.couche().visible); },
    renommer: function () { demanderNom('Nom de l\'effet', B.doc.nom, 'Renommer', function (nom) { B.regler('@nom', nom); }); },

    lire: function () { U.lire(); },
    imgPrecedente: function () { if (U.joue) U.lire(false); U.allerImage(U.f - 1); },
    imgSuivante: function () { if (U.joue) U.lire(false); U.allerImage(U.f + 1); },
    imgPremiere: function () { if (U.joue) U.lire(false); U.allerImage(0); },
    imgDerniere: function () { if (U.joue) U.lire(false); U.allerImage(B.doc.images - 1); },

    ajuster: function () { U.ajuster(); },
    zoomPlus: function () { U.zoomPas(1); },
    zoomMoins: function () { U.zoomPas(-1); },
    emetteurs: function () { U.emetteurs = !U.emetteurs; U.redessiner(); cocher(); },
    fondSuivant: function () { U.choisirFond(U.FONDS[(U.FONDS.indexOf(U.fond) + 1) % U.FONDS.length]); memoFond(); cocher(); },
    aide: aide,
    aideLecteur: aideLecteur
  };
  U.FONDS.forEach(function (f) { ACTIONS['fond:' + f] = function () { U.choisirFond(f); memoFond(); cocher(); }; });

  function memoFond() { try { localStorage.setItem(CLE_FOND, U.fond); } catch (e) { /* le fond revient au gris */ } }

  function agir(nom) {
    var p;
    if (nom.indexOf('prereglage:') === 0) {
      p = B.prereglage(nom.slice(11));
      if (!p) return;
      B.ouvrirEffet(p.effet, true);
      apresOuverture('« ' + p.nom + ' » ouvert : règle-le à droite, glisse son émetteur sur la toile. Ctrl+Z revient à l\'effet d\'avant.', p.id);
      return;
    }
    if (U.gesteEnCours() || !ACTIONS[nom]) return;
    ACTIONS[nom]();
  }
  U.agir = agir;

  // ---------- Menus ----------
  var MENUS = [
    { titre: 'Fichier', items: [['ouvrir', 'Ouvrir un effet…', 'Ctrl+O'], ['enregistrer', 'Enregistrer l\'effet (JSON)', 'Ctrl+S'], ['renommer', 'Nom de l\'effet…'], null,
      ['expPlanche', 'Exporter la planche de sprites…'], ['expGif', 'Exporter en GIF animé…'], ['expPng', 'Exporter l\'image en PNG…'], ['expAtelier', 'Envoyer vers Atelier Pixel'], ['expLecteur', 'Fichier pour le lecteur (.js)…'], null,
      ['nouveau', 'Nouvel effet'], ['prereglage:' + EXEMPLE, 'Effet d\'exemple']] },
    { titre: 'Édition', items: [['annuler', 'Annuler', 'Ctrl+Z'], ['retablir', 'Rétablir', 'Ctrl+Y'], null, ['graine', 'Autre graine', 'G']] },
    { titre: 'Couche', items: [['coucheAjouter', 'Nouvelle couche', 'N'], ['coucheDupliquer', 'Dupliquer la couche', 'Ctrl+D'], ['coucheRenommer', 'Renommer…', 'F2'], ['coucheCacher', 'Cacher ou montrer', 'H'], null,
      ['coucheMonter', 'Dessiner par-dessus', 'Page préc.'], ['coucheDescendre', 'Dessiner en dessous', 'Page suiv.'], null, ['coucheSupprimer', 'Supprimer la couche', 'Suppr']] },
    { titre: 'Lecture', items: [['lire', 'Lire / arrêter', 'Entrée'], ['imgPrecedente', 'Image précédente', '←'], ['imgSuivante', 'Image suivante', '→'], ['imgPremiere', 'Première image', 'Début'], ['imgDerniere', 'Dernière image', 'Fin']] },
    { titre: 'Vue', items: [['ajuster', 'Voir en entier', '0'], ['zoomPlus', 'Zoom avant', '+'], ['zoomMoins', 'Zoom arrière', '−'], null,
      ['emetteurs', 'Montrer les émetteurs', 'T'], null, ['fondSuivant', 'Fond suivant', 'F'], ['fond:gris', 'Fond gris'], ['fond:nuit', 'Fond de nuit'], ['fond:jour', 'Fond clair'], ['fond:damier', 'Damier']] },
    { titre: 'Aide', items: [['aide', 'Mode d\'emploi et raccourcis', 'F1'], ['aideLecteur', 'Jouer un effet dans un jeu']] }
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
    var c = { emetteurs: U.emetteurs }, k, els, i;
    U.FONDS.forEach(function (f) { c['fond:' + f] = U.fond === f; });
    for (k in c) { els = document.querySelectorAll('.menu-liste [data-act="' + k + '"]'); for (i = 0; i < els.length; i++) els[i].classList.toggle('coche', c[k]); }
  }
  U.surFond = function () { memoFond(); cocher(); };
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
      var b = e.target.closest('[data-act]');
      fermerMenus();
      if (b && !b.disabled) agir(b.dataset.act);
    });
    cocher();
  }

  // ---------- Aide ----------
  function table(l) { return '<table>' + l.map(function (r) { return '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>'; }

  function aide() {
    U.dialogue({
      titre: 'Particules : des effets en pixel-art pour les jeux',
      html: '<div class="aide"><div><h3>Comment ça marche</h3>' +
        '<p>Un effet est fait de <b>couches</b> (des flammes, puis des braises par-dessus). Chaque couche a un <b>émetteur</b> qui lâche des particules, soit en continu (le débit), soit toutes d\'un coup (la salve). Chacune part avec une vitesse, subit gravité, vent, traînée et turbulence, puis s\'éteint.</p>' +
        '<p>Au fil de sa vie, une particule parcourt la <b>rampe</b> de teintes de gauche à droite, grandit ou rapetisse, et pâlit par tramage : elle perd des pixels plutôt que de devenir translucide.</p>' +
        '<p>Tout se calcule dans la grille du sprite, en pixels entiers et avec les seules teintes des rampes. Un effet à débit boucle sans couture ; une salve part à l\'image 1. La même graine donne toujours les mêmes images.</p>' +
        '<p>Sur la toile, glisse la braise pour déplacer l\'émetteur, le carré pour le redimensionner, la pointe de la flèche pour changer la direction, et la ligne du sol pour le monter ou le descendre. Ce qui sort du sprite reste visible en pâle : l\'export le coupera.</p>' +
        '<p>En bas, la <b>mèche</b> est la boucle : la braise marque l\'image en cours, on la glisse pour parcourir les images.</p></div>' +
        '<div><h3>Partout</h3>' + table([['Molette', 'Zoom sur le curseur'], ['Espace, clic milieu', 'Déplacer la vue (ou glisser dans le vide)'], ['0', 'Voir en entier'], ['Ctrl+Z, Ctrl+Y', 'Annuler, rétablir'], ['Ctrl+S, Ctrl+O', 'Enregistrer, ouvrir'], ['G', 'Autre graine'], ['T', 'Montrer ou cacher les émetteurs'], ['F', 'Changer de fond'], ['Maj', 'Direction et rotation par crans de 15°']]) +
        '<h3>Lecture</h3>' + table([['Entrée', 'Lire ou arrêter'], ['← →', 'Image précédente, suivante'], ['Début, Fin', 'Première, dernière image']]) + '</div>' +
        '<div><h3>Couches</h3>' + table([['1 à 8', 'Choisir la couche'], ['N', 'Nouvelle couche'], ['Ctrl+D', 'Dupliquer'], ['F2', 'Renommer'], ['H', 'Cacher ou montrer'], ['Page préc., suiv.', 'Par-dessus, en dessous'], ['Suppr', 'Supprimer']]) +
        '<h3>Exports</h3><p class="note">La planche de sprites et le GIF pour un jeu ou une page ; l\'envoi vers Atelier Pixel pour retoucher chaque image au crayon ; le JSON pour rouvrir l\'effet ici ; le fichier pour le lecteur pour le jouer en direct dans un jeu (menu Aide, « Jouer un effet dans un jeu »).</p></div></div>'
    });
  }

  function aideLecteur() {
    var n = nomLecteur();
    U.dialogue({
      titre: 'Jouer un effet dans un jeu',
      html: '<div class="aide"><div><p><code>particules/lecteur.js</code> est le moteur de cet outil, seul, sans dépendance. Un jeu le charge, puis le fichier de l\'effet (menu Fichier, « Fichier pour le lecteur »), et l\'effet joue en temps réel, image pour image comme ici.</p>' +
        '<pre>&lt;script src="../particules/lecteur.js"&gt;&lt;/script&gt;\n&lt;script src="' + echapper(n) + '.js"&gt;&lt;/script&gt;</pre>' +
        '<h3>Une boucle dans un canvas</h3><pre>Particules.jouer(\'' + echapper(n) + '\', canvas, { echelle: 3 });</pre>' +
        '<h3>Les images, à dessiner soi-même</h3><pre>var fx = Particules.animation(\'' + echapper(n) + '\');\nctx.imageSmoothingEnabled = false;\n// t : secondes écoulées depuis le début\nctx.drawImage(fx.imageA(t), x, y, fx.w * 3, fx.h * 3);</pre></div>' +
        '<div><h3>Un émetteur vivant</h3><p class="note">Il suit un objet du jeu et laisse sa traînée derrière lui ; la salve part à la création, et sur demande. Le centre de l\'émetteur de la première couche se pose sur (x, y) ; le sol, s\'il y en a un, reste à la même distance sous lui quand il bouge.</p>' +
        '<pre>var s = Particules.simulation(\'' + echapper(n) + '\', { x: 100, y: 80 });\n// à chaque image :\ns.deplacer(x, y);\ns.avancer(dt);          // dt en secondes\ns.dessiner(ctx, 3);     // agrandi 3 fois\ns.salve();              // une salve de plus\ns.couper();             // n\'émet plus\ns.fini();               // vrai quand tout est retombé</pre>' +
        '<p class="note">On peut passer l\'objet JSON d\'un effet partout où un nom est attendu. Un jeu ouvert en file:// ne peut pas lire un .json avec fetch ; le fichier .js, lui, se charge toujours. Sous Node, <code>Particules.images(effet)</code> rend les images en pixels bruts.</p></div></div>'
    });
  }

  // ---------- Clavier ----------
  function touche(e) {
    // e.key manque sur les évènements de la saisie automatique du navigateur.
    var cle = e.key || '', k = cle.length === 1 ? cle.toLowerCase() : cle, ctrl = e.ctrlKey || e.metaKey, cible = e.target, tag = cible.tagName, o;
    // Un chiffre se reconnaît à sa touche ; sur le pavé sans Verr. Num., la touche donne Fin ou une flèche, pas un chiffre.
    var chiffre = cle.length === 1 ? /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '') : null;
    var saisie = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && cible.type !== 'checkbox' && cible.type !== 'range' && cible.type !== 'color');
    if (k === 'Escape') {
      if (U.fenetreOuverte()) U.fermer();
      else if (fermerMenus()) return;
      else if (saisie) cible.blur();
      return;
    }
    if (U.fenetreOuverte()) return;
    if (k === 'F1') { e.preventDefault(); agir('aide'); return; }
    if (ctrl && !e.altKey) {
      // Dans un champ en cours de frappe, Ctrl+Z et Ctrl+Y défont la frappe, pas l'effet.
      o = { z: e.shiftKey ? 'retablir' : 'annuler', y: 'retablir', s: 'enregistrer', o: 'ouvrir', d: 'coucheDupliquer' }[k];
      if (saisie && (k === 'z' || k === 'y')) return;
      // Ctrl+S au milieu d'une frappe : le champ est d'abord validé, pour que le fichier contienne la valeur tapée.
      if (o && saisie) cible.blur();
      if (o) { e.preventDefault(); agir(o); }
      return;
    }
    if (saisie) { if (k === 'Enter') cible.blur(); return; }
    if (e.altKey) return;
    // Sur une réglette, les flèches la règlent.
    if (tag === 'INPUT' && cible.type === 'range' && /^Arrow|^Page|^Home$|^End$/.test(k)) return;
    // Espace et Entrée cochent une case ou ouvrent le sélecteur de couleur.
    if (tag === 'INPUT' && (k === ' ' || k === 'Enter')) return;
    if (k === ' ') {
      if (tag === 'BUTTON' || tag === 'SUMMARY') return;
      e.preventDefault();
      if (!U.espace) { U.espace = true; $('#scene').classList.add('main'); }
      return;
    }
    if ((tag === 'BUTTON' || tag === 'SUMMARY') && k === 'Enter') return;
    // Les chiffres se lisent sur la position de la touche : un clavier français les donne sans Maj.
    // Sauf le « - », qui partage sa touche avec le 6 sur un clavier français : il reste le zoom arrière.
    if (chiffre && cle !== '-') k = chiffre[1];
    if (k === '0') o = 'ajuster';
    else if (/^[1-8]$/.test(k)) {
      e.preventDefault();
      // Changer de couche au milieu d'un glissement ferait sauter l'émetteur de la nouvelle.
      if (U.gesteEnCours()) return;
      if (Number(k) > B.doc.couches.length) U.dire('Il n\'y a que ' + B.doc.couches.length + (B.doc.couches.length > 1 ? ' couches.' : ' couche.'));
      else { U.choisirCouche(Number(k) - 1); U.dire('Couche ' + k + ' : « ' + B.couche().nom + ' ».'); }
      return;
    }
    else if (k === '+' || k === '=') o = 'zoomPlus';
    else if (k === '-') o = 'zoomMoins';
    else if (k === 'Enter') o = 'lire';
    else if (k === 'ArrowLeft') o = 'imgPrecedente';
    else if (k === 'ArrowRight') o = 'imgSuivante';
    else if (k === 'Home') o = 'imgPremiere';
    else if (k === 'End') o = 'imgDerniere';
    else if (k === 'g') o = 'graine';
    else if (k === 't') o = 'emetteurs';
    else if (k === 'f') o = 'fondSuivant';
    else if (k === 'n') o = 'coucheAjouter';
    else if (k === 'h') o = 'coucheCacher';
    else if (k === 'F2') o = 'coucheRenommer';
    else if (k === 'PageUp') o = 'coucheMonter';
    else if (k === 'PageDown') o = 'coucheDescendre';
    else if (k === 'Delete') o = 'coucheSupprimer';
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
    var repris, fond;
    U.initVue();
    U.initPanneaux();
    initMenus();
    $('#fichier').addEventListener('change', function () {
      if (this.files[0]) ouvrir(this.files[0]);
      this.value = '';
    });
    $('#modal').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-fermer]')) U.fermer(); });
    document.addEventListener('keydown', touche);
    document.addEventListener('keyup', relache);
    window.addEventListener('blur', function () { U.espace = false; $('#scene').classList.remove('main'); });
    // On peut aussi déposer un fichier sur la fenêtre.
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files[0] && !U.fenetreOuverte()) ouvrir(e.dataTransfer.files[0]);
    });
    window.addEventListener('pagehide', function () { if (minuterie !== null) { clearTimeout(minuterie); sauver(); } });

    try { fond = localStorage.getItem(CLE_FOND); } catch (e) { fond = null; }
    U.choisirFond(U.FONDS.indexOf(fond) >= 0 ? fond : 'gris');
    cocher();

    repris = reprendre();
    if (!repris) B.ouvrirEffet(B.prereglage(EXEMPLE).effet);
    B.surChange = function () { U.rafraichir(); sauverBientot(); };
    U.rafraichir();
    U.ajuster();
    U.marquerPrereglage(repris ? '' : EXEMPLE);
    U.dire(repris ? 'Effet repris là où tu l\'avais laissé.' : 'Un feu de camp pour commencer : choisis un autre effet à gauche, ou règle celui-ci à droite.');
    if (B.doc.images > 1) U.lire(true);
  }

  init();
})();
