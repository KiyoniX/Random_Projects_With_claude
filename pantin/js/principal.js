(function () {
  'use strict';

  var P = window.Pantin, U = P.ui;

  var CLE = 'pantin.projet';
  var DELAI_SAUVE = 700;                 // millisecondes d'inactivité avant la sauvegarde automatique
  var ECHELLES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];

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
    var cote = Math.max(P.doc.w, P.doc.h), k = 1, i;
    for (i = 0; i < ECHELLES.length; i++) if (cote * ECHELLES[i] <= 512) k = ECHELLES[i];
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
  function telechargerPng(pix, w, h, nom) {
    U.versToile(pix, w, h).toBlob(function (b) {
      if (b) telecharger(b, nom); else U.alerte('Export impossible', 'Le navigateur n\'a pas pu fabriquer l\'image.');
    }, 'image/png');
  }
  function base() { return P.doc.nom.replace(/[\\/:*?"<>|]/g, '-') || 'pantin'; }
  function suffixe() { return P.doc.anims.length > 1 ? '-' + P.anim().nom.toLowerCase().replace(/[^a-z0-9àâäéèêëîïôöùûüç]+/gi, '-').replace(/^-|-$/g, '') : ''; }

  function dlgPlanche() {
    var n = P.anim().n, d = P.doc;
    U.dialogue({
      titre: 'Exporter la planche de sprites', ok: 'Exporter',
      html: '<p class="rang"><label class="champ">Disposition <select name="forme"><option value="ligne">Une ligne</option><option value="colonne">Une colonne</option><option value="grille">Grille</option></select></label>' +
        '<label class="champ">Colonnes <input type="number" name="cols" value="' + Math.ceil(Math.sqrt(n)) + '" min="1" max="' + n + '"></label></p><p class="rang">' + choixEchelle(1) + '</p>' +
        '<p class="note">« ' + echapper(P.anim().nom) + ' » : ' + n + ' image' + (n > 1 ? 's' : '') + ' de ' + d.w + ' × ' + d.h + ' px, rangées de gauche à droite puis de haut en bas, fond transparent. « Colonnes » ne sert qu\'à la grille.</p>',
      action: function (f) {
        var forme = f.elements.forme.value, k = Number(f.elements.echelle.value), cols = Math.round(Number(f.elements.cols.value)), p;
        if (forme === 'grille' && !(cols >= 1 && cols <= n)) return '« Colonnes » doit être un nombre entre 1 et ' + n + '.';
        p = P.planche(forme === 'ligne' ? n : forme === 'colonne' ? 1 : cols);
        if (p.w * k > 16384 || p.h * k > 16384) return 'La planche serait trop grande : réduis l\'agrandissement ou choisis une grille.';
        telechargerPng(P.agrandir(p.pix, p.w, p.h, k), p.w * k, p.h * k, base() + suffixe() + '-planche.png');
      }
    });
  }

  function dlgGif() {
    var a = P.anim(), d = P.doc;
    U.dialogue({
      titre: 'Exporter en GIF animé', ok: 'Exporter',
      html: '<p class="rang">' + choixEchelle(echelleConseillee()) + '<label><input type="checkbox" name="boucle"' + (a.boucle ? ' checked' : '') + '> Lecture en boucle</label></p>' +
        '<p class="note">' + a.n + ' image' + (a.n > 1 ? 's' : '') + ' à ' + a.cadence + ' par seconde. Le GIF arrondit les durées au centième de seconde et ne connaît pas la demi-transparence.</p>',
      action: function (f) {
        var images = P.images().map(function (pix) { return { pix: pix, duree: 1000 / a.cadence }; });
        var octets = window.Atelier.gifEncoder(images, d.w, d.h, { echelle: Number(f.elements.echelle.value), boucle: f.elements.boucle.checked });
        telecharger(new Blob([octets], { type: 'image/gif' }), base() + suffixe() + '.gif');
      }
    });
  }

  function dlgPng() {
    var d = P.doc;
    U.dialogue({
      titre: 'Exporter l\'image en PNG', ok: 'Exporter',
      html: '<p class="rang">' + choixEchelle(echelleConseillee()) + '</p><p class="note">' + (U.mode === 'montage' ? 'La pose de repos' : 'L\'image ' + (U.f + 1)) + ', au format du cadre, fond transparent.</p>',
      action: function (f) {
        var k = Number(f.elements.echelle.value);
        telechargerPng(P.agrandir(P.composer(U.image()), d.w, d.h, k), d.w * k, d.h * k, base() + suffixe() + '-' + (U.mode === 'montage' ? 'repos' : U.f + 1) + '.png');
      }
    });
  }

  // ---------- Ouverture ----------
  function sansExtension(nom) { return nom.replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '-') || 'pantin'; }

  function apresOuverture(mode, texte) {
    if (U.joue) U.lire(false);
    U.sel = 0; U.f = 0; U.poserMasque(null);
    U.choisirMode(mode);
    U.dire(texte);
  }

  function ouvrir(fichier) {
    var l = new FileReader(), json = /\.json$/i.test(fichier.name) || fichier.type === 'application/json';
    l.onerror = function () { U.alerte('Ouverture impossible', 'Le fichier n\'a pas pu être lu.'); };
    if (json) {
      l.onload = function () {
        var o, n;
        try {
          o = JSON.parse(l.result);
          if (o && o.format === 'atelier-pixel') {
            n = P.depuisAtelier(o, sansExtension(fichier.name));
            apresOuverture(n ? 'montage' : 'decoupe', n ? n + ' calques d\'Atelier Pixel sont devenus ' + n + ' pièces, déjà à leur place : il reste à poser les attaches.' : 'Sprite d\'Atelier Pixel ouvert comme planche : il reste à le découper.');
          } else {
            P.depuisProjet(o);
            P.doc.nom = sansExtension(fichier.name);
            apresOuverture('animation', 'Projet « ' + fichier.name + ' » ouvert.');
          }
        } catch (err) {
          U.alerte('Ouverture impossible', err instanceof SyntaxError ? 'Ce fichier n\'est ni un projet Pantin ni un projet Atelier Pixel lisible.' : err.message);
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
        if (w > P.COTE_MAX || h > P.COTE_MAX) { U.alerte('Ouverture impossible', 'L\'image fait ' + w + ' × ' + h + ' px : le maximum est ' + P.COTE_MAX + '. Pantin travaille sur le dessin à sa taille réelle, pas sur une version agrandie.'); return; }
        c.width = w; c.height = h;
        k = c.getContext('2d');
        k.drawImage(img, 0, 0);
        P.docDepuisPlanche(new Uint32Array(k.getImageData(0, 0, w, h).data.buffer), w, h, sansExtension(fichier.name));
        apresOuverture('decoupe', 'Planche « ' + fichier.name + ' » ouverte : prends chaque morceau avec la baguette, puis Entrée.');
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
      localStorage.setItem(CLE, JSON.stringify(P.versProjet()));
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
      P.depuisProjet(JSON.parse(t));
      return true;
    } catch (err) { return false; }
  }

  // ---------- Actions ----------
  var presse = null;      // la pose copiée : { id de pièce : { a, dx, dy } }

  function choisie(texte) {
    var p = P.piece(U.sel);
    if (!p) U.dire(texte || 'Choisis d\'abord une pièce.');
    return p;
  }
  function enAnimation() {
    if (U.mode === 'animation') return true;
    U.dire('Les clés se posent à l\'étape 3, « Animer ».');
    return false;
  }

  var ACTIONS = {
    ouvrir: function () { $('#fichier').click(); },
    enregistrer: function () { telecharger(new Blob([JSON.stringify(P.versProjet())], { type: 'application/json' }), base() + '.json'); },
    expPlanche: dlgPlanche,
    expGif: dlgGif,
    expPng: dlgPng,
    expAtelier: function () {
      telecharger(new Blob([JSON.stringify(P.versAtelier())], { type: 'application/json' }), base() + suffixe() + '-atelier.json');
      U.dire('Projet Atelier Pixel téléchargé : ouvre-le dans Atelier Pixel pour retoucher chaque image à la main.');
    },
    exemple: function () { P.exemple(); apresOuverture('animation', 'Pantin d\'exemple : glisse un membre pour le faire tourner, ou appuie sur Entrée pour le voir bouger.'); U.lire(true); },

    annuler: function () { if (!P.annuler()) U.dire('Rien à annuler.'); },
    retablir: function () { if (!P.retablir()) U.dire('Rien à rétablir.'); },
    copierPose: function () {
      if (!enAnimation()) return;
      presse = {};
      P.doc.pieces.forEach(function (p) { var po = P.pose(p.id, U.f); presse[p.id] = { a: po.a, dx: po.dx, dy: po.dy }; });
      U.dire('Pose de l\'image ' + (U.f + 1) + ' copiée.');
    },
    collerPose: function () {
      var id;
      if (!enAnimation()) return;
      if (!presse) { U.dire('Aucune pose copiée.'); return; }
      P.marquer();
      for (id in presse) if (P.piece(Number(id))) P.poserCle(Number(id), U.f, presse[id]);
      P.change();
      U.dire('Pose collée sur l\'image ' + (U.f + 1) + '.');
    },
    toutSel: function () {
      var pl = P.doc.planche, m = new Uint8Array(pl.w * pl.h), i;
      if (U.mode !== 'decoupe') return;
      for (i = 0; i < m.length; i++) m[i] = pl.pix[i] ? 1 : 0;
      U.poserMasque(m);
    },

    detacher: function () {
      var p;
      if (U.mode !== 'decoupe') U.choisirMode('decoupe');
      if (!U.masque) { U.dire('Prends d\'abord un morceau de la planche avec la baguette, le rectangle ou le lasso.'); return; }
      if (P.doc.pieces.length >= P.PIECES_MAX) { U.dire('Un pantin ne peut pas avoir plus de ' + P.PIECES_MAX + ' pièces.'); return; }
      p = P.detacher(U.masque);
      if (!p) { U.dire('Il n\'y a aucun pixel dessiné dans cette sélection.'); return; }
      U.abandonner();
      U.choisir(p.id);
      U.dire('« ' + p.nom + ' » détachée. Quand tout est découpé, passe à l\'étape 2.');
    },
    ilots: function () {
      var n = P.ilots().length, fait;
      if (!n) { U.dire('La planche est vide.'); return; }
      if (P.doc.pieces.length + n > P.PIECES_MAX) { U.dire('Il y a ' + n + ' morceaux séparés sur la planche : c\'est trop pour un pantin de ' + P.PIECES_MAX + ' pièces.'); return; }
      fait = P.detacherIlots();
      U.dire(fait + (fait > 1 ? ' pièces détachées' : ' pièce détachée') + ' : une par morceau dessiné à part.');
    },
    pieceMonter: function () { var p = choisie(); if (p && !P.empiler(p.id, 1)) U.dire('« ' + p.nom + ' » est déjà tout devant.'); },
    pieceDescendre: function () { var p = choisie(); if (p && !P.empiler(p.id, -1)) U.dire('« ' + p.nom + ' » est déjà tout au fond.'); },
    pieceRenommer: function () {
      var p = choisie();
      if (p) demanderNom('Renommer la pièce', p.nom, 'Renommer', function (nom) { P.marquer(); p.nom = nom; P.change(); });
    },
    pieceSupprimer: function () { var p = choisie(); if (p) { P.supprimerPiece(p.id); U.dire('« ' + p.nom + ' » supprimée. Ctrl+Z la ramène.'); } },
    pieceLiberer: function () { var p = choisie(); if (p && p.parent) { P.marquer(); P.lier(p, 0); P.change(); } },

    lire: function () { U.lire(); },
    cle: function () {
      var p = enAnimation() && choisie('Choisis d\'abord la pièce qui reçoit la clé.');
      if (!p) return;
      if (P.cle(p.id, U.f)) { U.dire('« ' + p.nom + ' » a déjà une clé à l\'image ' + (U.f + 1) + '.'); return; }
      P.marquer(); P.poserCle(p.id, U.f); P.change();
    },
    cleOter: function () {
      var p = enAnimation() && choisie();
      if (!p) return;
      if (!P.cle(p.id, U.f)) { U.dire('« ' + p.nom + ' » n\'a pas de clé à l\'image ' + (U.f + 1) + '.'); return; }
      P.marquer(); P.oterCle(p.id, U.f); P.change();
    },
    imgPrecedente: function () { U.allerImage(U.f - 1); },
    imgSuivante: function () { U.allerImage(U.f + 1); },
    imgPremiere: function () { U.allerImage(0); },
    imgDerniere: function () { U.allerImage(P.anim().n - 1); },
    animAjouter: function () { demanderNom('Nouvelle animation', 'Animation ' + (P.doc.anims.length + 1), 'Créer', function (nom) { U.f = 0; P.animAjouter(nom); }); },
    animDupliquer: function () { demanderNom('Dupliquer l\'animation', P.anim().nom + ' (copie)', 'Dupliquer', function (nom) { P.animAjouter(nom, P.anim()); }); },
    animRenommer: function () { demanderNom('Renommer l\'animation', P.anim().nom, 'Renommer', function (nom) { P.marquer(); P.anim().nom = nom; P.change(); }); },
    animSupprimer: function () { U.f = 0; if (!P.animSupprimer()) U.dire('Il faut garder au moins une animation.'); },

    cadrer: function () { if (!P.cadrer(2)) U.dire('Rien à cadrer : aucune pièce visible.'); else { U.ajuster(); U.dire('Cadre resserré sur le pantin, avec 2 px de marge.'); } },
    ajuster: function () { U.ajuster(); },
    zoomPlus: function () { U.zoomPas(1); },
    zoomMoins: function () { U.zoomPas(-1); },
    oignon: function () { U.oignon = !U.oignon; U.rafraichir(); cocher(); },
    attaches: function () { U.attaches = !U.attaches; U.redessiner(); cocher(); },
    aide: aide
  };

  function agir(nom) {
    if (nom.indexOf('outil:') === 0) { U.choisirOutil(nom.slice(6)); return; }
    if (nom.indexOf('mode:') === 0) { U.choisirMode(nom.slice(5)); return; }
    if (U.gesteEnCours() || !ACTIONS[nom]) return;
    ACTIONS[nom]();
  }
  U.agir = agir;

  // ---------- Menus ----------
  var MENUS = [
    { titre: 'Fichier', items: [['ouvrir', 'Ouvrir une planche ou un projet…', 'Ctrl+O'], ['enregistrer', 'Enregistrer le projet', 'Ctrl+S'], null,
      ['expPlanche', 'Exporter la planche de sprites…'], ['expGif', 'Exporter en GIF animé…'], ['expPng', 'Exporter l\'image en PNG…'], ['expAtelier', 'Envoyer l\'animation vers Atelier Pixel'], null,
      ['exemple', 'Pantin d\'exemple']] },
    { titre: 'Édition', items: [['annuler', 'Annuler', 'Ctrl+Z'], ['retablir', 'Rétablir', 'Ctrl+Y'], null, ['copierPose', 'Copier la pose de l\'image', 'Ctrl+C'], ['collerPose', 'Coller la pose ici', 'Ctrl+V']] },
    { titre: 'Pièce', items: [['detacher', 'Détacher la sélection', 'Entrée'], ['ilots', 'Détacher tous les morceaux'], ['toutSel', 'Tout sélectionner sur la planche', 'Ctrl+A'], null,
      ['pieceMonter', 'Passer devant'], ['pieceDescendre', 'Passer derrière'], ['pieceLiberer', 'Libérer de la pièce qui la tient'], ['pieceRenommer', 'Renommer…', 'F2'], ['pieceSupprimer', 'Supprimer']] },
    { titre: 'Animation', items: [['lire', 'Lire / arrêter', 'Entrée'], ['cle', 'Poser une clé', 'K'], ['cleOter', 'Retirer la clé', 'Suppr'], null,
      ['animAjouter', 'Nouvelle animation…'], ['animDupliquer', 'Dupliquer l\'animation…'], ['animRenommer', 'Renommer l\'animation…'], ['animSupprimer', 'Supprimer l\'animation']] },
    { titre: 'Vue', items: [['ajuster', 'Voir en entier', '0'], ['zoomPlus', 'Zoom avant', '+'], ['zoomMoins', 'Zoom arrière', '−'], null,
      ['oignon', 'Pelure d\'oignon', 'O'], ['attaches', 'Montrer les attaches et les fils', 'T'], ['cadrer', 'Cadrer le pantin']] },
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
    var c = { oignon: U.oignon, attaches: U.attaches }, k, els, i;
    for (k in c) { els = document.querySelectorAll('.menu-liste [data-act="' + k + '"]'); for (i = 0; i < els.length; i++) els[i].classList.toggle('coche', c[k]); }
    $('#oignon').checked = U.oignon;
  }
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
  function aide() {
    function table(l) { return '<table>' + l.map(function (r) { return '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>'; }
    U.dialogue({
      titre: 'Pantin : animer un sprite découpé',
      html: '<div class="aide"><div><h3>La marche à suivre</h3><ol>' +
        '<li><b>Découper.</b> Ouvre un dessin (PNG à sa taille réelle). Prends chaque morceau avec la baguette, ou entoure-le au lasso s\'il touche le reste, puis Entrée. Laisse dépasser un peu de matière sous chaque articulation.</li>' +
        '<li><b>Monter.</b> Mets les pièces à leur place, pose l\'attache de chacune là où elle pivote, et dis quelle pièce la tient en glissant de l\'une à l\'autre.</li>' +
        '<li><b>Animer.</b> Va sur une image de la frise, fais tourner les membres : une clé se pose à chaque fois. Entre deux clés, Pantin calcule les images.</li>' +
        '<li><b>Retoucher.</b> « Envoyer vers Atelier Pixel » donne une image par image, à reprendre au crayon là où la rotation a abîmé un détail.</li></ol>' +
        '<p class="note">Un projet Atelier Pixel dont chaque membre est sur son calque s\'ouvre déjà découpé et assemblé.</p></div>' +
        '<div><h3>Partout</h3>' + table([['1 2 3', 'Découper, monter, animer'], ['Molette', 'Zoom sur le curseur'], ['Espace ou clic milieu', 'Déplacer la vue'], ['0', 'Voir en entier'], ['Ctrl+Z, Ctrl+Y', 'Annuler, rétablir'], ['Ctrl+S, Ctrl+O', 'Enregistrer, ouvrir'], ['T', 'Montrer ou cacher les attaches'], ['Échap', 'Abandonner la sélection']]) +
        '<h3>Découper</h3>' + table([['B R L', 'Baguette, rectangle, lasso'], ['Maj, Alt', 'Ajouter à la sélection, en retirer'], ['Entrée', 'Détacher la sélection en pièce']]) +
        '<h3>Monter</h3>' + table([['V A L', 'Placer, attache, tenir'], ['Suppr', 'Supprimer la pièce']]) + '</div>' +
        '<div><h3>Animer</h3>' + table([['R V', 'Tourner, décaler'], ['Maj', 'Tourner par crans de 15°'], ['← →', 'Image précédente, suivante'], ['Début, Fin', 'Première, dernière image'], ['Entrée', 'Lire ou arrêter'], ['K', 'Poser une clé'], ['Suppr', 'Retirer la clé'], ['Ctrl+C, Ctrl+V', 'Copier la pose, la coller ailleurs'], ['O', 'Pelure d\'oignon']]) +
        '<h3>Sur la frise</h3>' + table([['Rond', 'Clé qui repart en douceur'], ['Losange', 'Clé qui repart à vitesse régulière'], ['Carré', 'Clé tenue, puis saut d\'un coup'], ['Double-clic', 'Poser ou retirer une clé']]) + '</div></div>'
    });
  }

  // ---------- Clavier ----------
  function touche(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, ctrl = e.ctrlKey || e.metaKey, cible = e.target, tag = cible.tagName, chiffre = /^Digit([0-3])$/.exec(e.code), o;
    var saisie = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && cible.type !== 'checkbox' && cible.type !== 'range');
    if (k === 'Escape') {
      if (U.fenetreOuverte()) U.fermer();
      else if (fermerMenus()) return;
      else if (saisie) cible.blur();
      else if (!U.abandonner() && !U.gesteEnCours()) U.choisir(0);
      return;
    }
    if (U.fenetreOuverte()) return;
    if (k === 'F1') { e.preventDefault(); agir('aide'); return; }
    if (ctrl && !e.altKey) {
      o = { z: e.shiftKey ? 'retablir' : 'annuler', y: 'retablir', s: 'enregistrer', o: 'ouvrir' }[k];
      if (!o && !saisie) o = { c: 'copierPose', v: 'collerPose', a: 'toutSel' }[k];
      if (o) { e.preventDefault(); agir(o); }
      return;
    }
    if (saisie) { if (k === 'Enter') cible.blur(); return; }
    if (e.altKey) return;
    if (k === ' ') {
      if (tag === 'BUTTON') return;
      e.preventDefault();
      if (!U.espace) { U.espace = true; $('#scene').classList.add('main'); }
      return;
    }
    if (tag === 'BUTTON' && k === 'Enter') return;
    // Les chiffres se lisent sur la position de la touche : un clavier français les donne sans Maj.
    if (chiffre) k = chiffre[1];
    o = U.OUTILS[U.mode].filter(function (x) { return x.touche === k; })[0];
    if (k === '1') o = 'mode:decoupe'; else if (k === '2') o = 'mode:montage'; else if (k === '3') o = 'mode:animation';
    else if (k === '0' || k === 'Home' && U.mode !== 'animation') o = 'ajuster';
    else if (k === '+' || k === '=') o = 'zoomPlus';
    else if (k === '-') o = 'zoomMoins';
    else if (k === 'Enter') o = U.mode === 'decoupe' ? 'detacher' : 'lire';
    else if (k === 'ArrowLeft') o = 'imgPrecedente';
    else if (k === 'ArrowRight') o = 'imgSuivante';
    else if (k === 'Home') o = 'imgPremiere';
    else if (k === 'End') o = 'imgDerniere';
    else if (k === 'k') o = 'cle';
    else if (k === 'Delete' || k === 'Backspace') o = U.mode === 'animation' ? 'cleOter' : 'pieceSupprimer';
    else if (k === 'o') o = 'oignon';
    else if (k === 't') o = 'attaches';
    else if (k === 'F2') o = 'pieceRenommer';
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
    $('#fichier').addEventListener('change', function () {
      if (this.files[0]) ouvrir(this.files[0]);
      this.value = '';
    });
    $('#modal').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-fermer]')) U.fermer(); });
    document.addEventListener('keydown', touche);
    document.addEventListener('keyup', relache);
    window.addEventListener('blur', function () { U.espace = false; });
    // On peut aussi déposer un fichier sur la fenêtre.
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files[0] && !U.fenetreOuverte()) ouvrir(e.dataTransfer.files[0]);
    });
    window.addEventListener('pagehide', function () { if (minuterie !== null) { clearTimeout(minuterie); sauver(); } });

    repris = reprendre();
    if (!repris) P.exemple();
    P.surChange = function () { U.rafraichir(); sauverBientot(); };
    U.choisirMode('animation');
    if (!repris) { U.dire('Pantin d\'exemple : glisse un membre pour le faire tourner. Le menu Fichier ouvre ton propre dessin.'); U.lire(true); }
  }

  init();
})();
