(function () {
  'use strict';

  var A = window.Atelier, U = A.ui;

  var $ = function (s) { return document.querySelector(s); };

  // ---------- Actions ----------
  function calque() { return A.doc.iCalque; }
  function image() { return A.doc.iImage; }
  function aller(i) { A.allerImage(i); U.rafraichir(); }
  function sinon(fait, texte) { if (!fait) U.message(texte); }
  function pousser(dx, dy) { if (A.doc.sel) U.dire(A.selDeplacer(dx, dy)); else U.message('Aucune sélection à déplacer.'); }

  var ACTIONS = {
    nouveau: function () { U.dlgNouveau(); },
    ouvrir: function () { U.choisirProjet(); },
    enregistrer: function () { U.enregistrer(); },
    importer: function () { U.choisirImage(); },
    expPng: function () { U.dlgPng(); },
    expPlanche: function () { U.dlgPlanche(); },
    expGif: function () { U.dlgGif(); },
    exemple: function () { A.exemple(); U.nom = 'gelee'; U.rafraichirPalette(); U.apresChargement(); U.lire(true); },

    annuler: function () { sinon(A.annuler(), 'Rien à annuler.'); },
    retablir: function () { sinon(A.retablir(), 'Rien à rétablir.'); },
    couper: function () { U.dire(A.selCouper()); },
    copier: function () { A.selCopier(); U.message(A.doc.sel ? 'Sélection copiée.' : 'Calque copié.'); },
    coller: function () { U.dire(A.selColler()); if (A.doc.sel && A.doc.sel.flot) U.choisirOutil('selection'); },
    supprimer: function () { U.dire(A.selSupprimer()); },
    toutSel: function () { A.selTout(); },
    deselect: function () { A.selAucune(); },
    retournerH: function () { U.dire(A.selRetourner(true)); },
    retournerV: function () { U.dire(A.selRetourner(false)); },
    pivoterD: function () { U.dire(A.selPivoter(1)); },
    pivoterG: function () { U.dire(A.selPivoter(-1)); },
    selGauche: function () { pousser(-1, 0); },
    selDroite: function () { pousser(1, 0); },
    selHaut: function () { pousser(0, -1); },
    selBas: function () { pousser(0, 1); },

    redim: function () { U.dlgRedimensionner(); },
    echelle: function () { U.dlgEchelle(); },
    recadrer: function () { if (!A.doc.sel) U.message('Trace d\'abord une sélection.'); else A.recadrer(); },

    calAjouter: function () { A.calqueAjouter(); },
    calDupliquer: function () { A.calqueDupliquer(calque()); },
    calSupprimer: function () { sinon(A.calqueSupprimer(calque()), 'Il faut garder au moins un calque.'); },
    calMonter: function () { A.calqueDeplacer(calque(), calque() + 1); },
    calDescendre: function () { A.calqueDeplacer(calque(), calque() - 1); },
    calFusionner: function () { sinon(A.calqueFusionner(calque()), 'Il n\'y a pas de calque en dessous.'); },
    calRenommer: function () { U.renommerCalque(calque()); },
    calDessus: function () { A.allerCalque(calque() + 1); U.rafraichir(); },
    calDessous: function () { A.allerCalque(calque() - 1); U.rafraichir(); },

    imgAjouter: function () { A.imageAjouter(); },
    imgDupliquer: function () { A.imageDupliquer(image()); },
    imgSupprimer: function () { sinon(A.imageSupprimer(image()), 'Il faut garder au moins une image.'); },
    imgGauche: function () { A.imageDeplacer(image(), image() - 1); },
    imgDroite: function () { A.imageDeplacer(image(), image() + 1); },
    imgPrecedente: function () { aller((image() + A.doc.images.length - 1) % A.doc.images.length); },
    imgSuivante: function () { aller((image() + 1) % A.doc.images.length); },
    imgPremiere: function () { aller(0); },
    imgDerniere: function () { aller(A.doc.images.length - 1); },
    cadence: function () { A.cadence(Number($('#cadence').value)); },
    lire: function () { U.lire(); },

    grille: function () { U.grille = !U.grille; cocher(); U.redessiner(); },
    oignon: function () { U.oignon.actif = !U.oignon.actif; cocher(); U.redessiner(); },
    ajuster: function () { U.ajuster(); },
    zoomPlus: function () { U.zoomPas(1); },
    zoomMoins: function () { U.zoomPas(-1); },
    zoomReel: function () { U.zoomReel(); },
    pinceauPlus: function () { U.regler('taille', U.taille + 1); },
    pinceauMoins: function () { U.regler('taille', U.taille - 1); },

    echanger: function () { U.echanger(); },
    palAjouter: function () { U.palAjouter(); },
    palRetirer: function () { U.palRetirer(); },
    palExtraire: function () { U.palExtraire(); },
    aide: function () { aide(); }
  };

  function agir(nom) {
    if (nom.indexOf('outil:') === 0) { U.choisirOutil(nom.slice(6)); return; }
    if (U.gesteEnCours() || !ACTIONS[nom]) return;
    ACTIONS[nom]();
  }
  U.agir = agir;

  function cocher() {
    var els = document.querySelectorAll('[data-act="grille"]'), i;
    for (i = 0; i < els.length; i++) els[i].classList.toggle('coche', U.grille);
    els = document.querySelectorAll('[data-act="oignon"]');
    for (i = 0; i < els.length; i++) els[i].classList.toggle('coche', U.oignon.actif);
    $('#oignon').checked = U.oignon.actif;
  }

  // ---------- Raccourcis ----------
  // [touches, action, description]. La première touche est celle qu'affichent les menus et l'aide.
  var RACCOURCIS = [
    ['ctrl+z', 'annuler', 'Annuler'],
    ['ctrl+y ctrl+shift+z', 'retablir', 'Rétablir'],
    ['ctrl+x', 'couper', 'Couper'],
    ['ctrl+c', 'copier', 'Copier la sélection (ou le calque)'],
    ['ctrl+v', 'coller', 'Coller'],
    ['delete backspace', 'supprimer', 'Effacer la sélection'],
    ['ctrl+a', 'toutSel', 'Tout sélectionner'],
    ['ctrl+d ctrl+shift+a', 'deselect', 'Désélectionner'],
    ['ctrl+arrowleft', 'selGauche', 'Pousser la sélection d\'un pixel (Ctrl + flèches)'],
    ['ctrl+arrowright', 'selDroite', ''],
    ['ctrl+arrowup', 'selHaut', ''],
    ['ctrl+arrowdown', 'selBas', ''],
    ['shift+h', 'retournerH', 'Retourner horizontalement'],
    ['shift+v', 'retournerV', 'Retourner verticalement'],
    ['shift+r', 'pivoterD', 'Rotation de 90° (sélection, ou sprite entier)'],
    ['x', 'echanger', 'Échanger couleur principale et secondaire'],
    [', [', 'pinceauMoins', 'Pinceau plus petit (ou Maj + molette)'],
    ['; . ]', 'pinceauPlus', 'Pinceau plus gros (ou Maj + molette)'],
    ['arrowleft', 'imgPrecedente', 'Image précédente'],
    ['arrowright', 'imgSuivante', 'Image suivante'],
    ['home', 'imgPremiere', 'Première image'],
    ['end', 'imgDerniere', 'Dernière image'],
    ['enter', 'lire', 'Lire / arrêter l\'animation (ou Espace)'],
    ['n', 'imgAjouter', 'Nouvelle image'],
    ['shift+d', 'imgDupliquer', 'Dupliquer l\'image'],
    ['arrowup', 'calDessus', 'Calque du dessus'],
    ['arrowdown', 'calDessous', 'Calque du dessous'],
    ['shift+n', 'calAjouter', 'Nouveau calque'],
    ['f2', 'calRenommer', 'Renommer le calque'],
    ['+ = shift++', 'zoomPlus', 'Zoom avant (ou molette)'],
    ['- shift+_', 'zoomMoins', 'Zoom arrière (ou molette)'],
    ['0 shift+0 à', 'ajuster', 'Ajuster la vue au sprite'],
    ['shift+g', 'grille', 'Grille de pixels'],
    ['shift+o', 'oignon', 'Pelure d\'oignon'],
    ['ctrl+s', 'enregistrer', 'Enregistrer le projet'],
    ['ctrl+o', 'ouvrir', 'Ouvrir un projet'],
    ['alt+n', 'nouveau', 'Nouveau sprite'],
    ['f1 shift+?', 'aide', 'Cette aide']
  ];
  var TOUCHES = {}, AFFICHE = {};
  var NOMS_TOUCHES = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', delete: 'Suppr', enter: 'Entrée', home: 'Début', end: 'Fin', ctrl: 'Ctrl', shift: 'Maj', alt: 'Alt' };

  function joli(combo) {
    return combo.split('+').map(function (t) { return NOMS_TOUCHES[t] || (t.length === 1 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1)); }).join('+');
  }

  function initRaccourcis() {
    RACCOURCIS.forEach(function (r) {
      var combos = r[0].split(' ');
      combos.forEach(function (c) { TOUCHES[c] = r[1]; });
      AFFICHE[r[1]] = joli(combos[0]);
    });
    U.OUTILS.forEach(function (o) { TOUCHES[o.touche.toLowerCase()] = 'outil:' + o.id; });
  }

  function saisie(el) { return el && (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'range' && el.type !== 'radio' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'); }

  function touche(e) {
    var k = e.key.toLowerCase(), combo, act;
    if (k === 'escape') {
      if (U.fenetreOuverte()) U.fermer();
      else if (fermerMenus()) return;
      else if (saisie(document.activeElement)) document.activeElement.blur();
      else if (!U.abandonner()) A.selAucune();
      return;
    }
    if (U.fenetreOuverte() || saisie(document.activeElement)) return;
    if (k === ' ') {
      e.preventDefault();
      if (!U.espace) { U.espace = true; U.espaceUtilise = false; $('#scene').classList.add('main'); U.redessiner(); }
      return;
    }
    if (k === 'control' || k === 'shift' || k === 'alt' || k === 'meta' || k === 'altgraph') return;
    combo = ((e.ctrlKey || e.metaKey) ? 'ctrl+' : '') + (e.altKey ? 'alt+' : '') + (e.shiftKey ? 'shift+' : '') + k;
    act = TOUCHES[combo];
    // AltGr compte pour Ctrl+Alt sous Windows : les caractères obtenus ainsi ([ et ]) restent reconnus.
    if (!act && e.ctrlKey && e.altKey && k.length === 1) act = TOUCHES[k];
    if (!act) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    agir(act);
  }

  function relache(e) {
    if (e.key !== ' ' || !U.espace) return;
    U.espace = false;
    $('#scene').classList.remove('main');
    if (!U.espaceUtilise && !U.fenetreOuverte() && !saisie(document.activeElement)) U.lire();
    U.redessiner();
  }

  // ---------- Menus ----------
  var MENUS = [
    ['Fichier', [['nouveau', 'Nouveau sprite…'], ['ouvrir', 'Ouvrir un projet…'], ['enregistrer', 'Enregistrer le projet'], null,
      ['importer', 'Importer une image ou une planche…'], null,
      ['expPng', 'Exporter l\'image en PNG…'], ['expPlanche', 'Exporter la planche de sprites…'], ['expGif', 'Exporter en GIF animé…'], null,
      ['exemple', 'Charger le sprite d\'exemple']]],
    ['Édition', [['annuler', 'Annuler'], ['retablir', 'Rétablir'], null, ['couper', 'Couper'], ['copier', 'Copier'], ['coller', 'Coller'], ['supprimer', 'Effacer'], null,
      ['toutSel', 'Tout sélectionner'], ['deselect', 'Désélectionner'], null,
      ['retournerH', 'Retourner horizontalement'], ['retournerV', 'Retourner verticalement'], ['pivoterD', 'Rotation de 90° horaire'], ['pivoterG', 'Rotation de 90° antihoraire']]],
    ['Sprite', [['redim', 'Redimensionner la toile…'], ['echelle', 'Mettre à l\'échelle…'], ['recadrer', 'Recadrer sur la sélection']]],
    ['Calque', [['calAjouter', 'Nouveau calque'], ['calDupliquer', 'Dupliquer'], ['calRenommer', 'Renommer'], ['calFusionner', 'Fusionner vers le bas'], ['calSupprimer', 'Supprimer'], null,
      ['calMonter', 'Monter'], ['calDescendre', 'Descendre']]],
    ['Image', [['imgAjouter', 'Nouvelle image'], ['imgDupliquer', 'Dupliquer'], ['imgSupprimer', 'Supprimer'], null,
      ['imgGauche', 'Avancer dans l\'ordre'], ['imgDroite', 'Reculer dans l\'ordre'], null, ['lire', 'Lire / arrêter']]],
    ['Affichage', [['grille', 'Grille de pixels'], ['oignon', 'Pelure d\'oignon'], null, ['zoomPlus', 'Zoom avant'], ['zoomMoins', 'Zoom arrière'], ['ajuster', 'Ajuster au sprite'], ['zoomReel', 'Taille réelle (100 %)']]],
    ['Aide', [['aide', 'Raccourcis et gestes']]]
  ];

  function initMenus() {
    $('#menus').innerHTML = MENUS.map(function (m) {
      return '<div class="menu"><button type="button" class="menu-titre">' + m[0] + '</button><div class="menu-liste" hidden>' + m[1].map(function (l) {
        if (!l) return '<hr>';
        return '<button type="button" data-act="' + l[0] + '"><span>' + l[1] + '</span><kbd>' + (AFFICHE[l[0]] || '') + '</kbd></button>';
      }).join('') + '</div></div>';
    }).join('');
    $('#menus').addEventListener('click', function (e) {
      var t = e.target.closest('.menu-titre'), liste;
      if (!t) return;
      liste = t.nextElementSibling;
      if (liste.hidden) { fermerMenus(); liste.hidden = false; t.classList.add('ouvert'); } else fermerMenus();
      e.stopPropagation();
    });
    $('#menus').addEventListener('pointerover', function (e) {
      var t = e.target.closest('.menu-titre');
      if (t && document.querySelector('.menu-titre.ouvert') && !t.classList.contains('ouvert')) { fermerMenus(); t.nextElementSibling.hidden = false; t.classList.add('ouvert'); }
    });
  }

  function fermerMenus() {
    var els = document.querySelectorAll('.menu-liste'), i, ouvert = false;
    for (i = 0; i < els.length; i++) {
      if (!els[i].hidden) ouvert = true;
      els[i].hidden = true;
      els[i].previousElementSibling.classList.remove('ouvert');
    }
    return ouvert;
  }

  // ---------- Aide ----------
  function aide() {
    var outils = U.OUTILS.map(function (o) { return '<tr><td><kbd>' + o.touche + '</kbd></td><td>' + o.nom + '</td></tr>'; }).join('');
    var autres = RACCOURCIS.filter(function (r) { return r[2]; }).map(function (r) {
      return '<tr><td><kbd>' + joli(r[0].split(' ')[0]) + '</kbd></td><td>' + r[2] + '</td></tr>';
    }), moitie = Math.ceil(autres.length / 2);
    U.dialogue({
      titre: 'Raccourcis et gestes',
      html: '<div class="aide"><div><h3>Outils</h3><table>' + outils + '</table>' +
        '<h3>Souris</h3><table>' +
        '<tr><td><kbd>Clic gauche</kbd></td><td>Dessiner avec la couleur principale</td></tr>' +
        '<tr><td><kbd>Clic droit</kbd></td><td>Dessiner avec la couleur secondaire</td></tr>' +
        '<tr><td><kbd>Alt+clic</kbd></td><td>Pipette, depuis un outil de dessin</td></tr>' +
        '<tr><td><kbd>Maj</kbd></td><td>Ligne à 45°, carré, cercle</td></tr>' +
        '<tr><td><kbd>Molette</kbd></td><td>Zoom centré sur le curseur</td></tr>' +
        '<tr><td><kbd>Espace+glisser</kbd></td><td>Déplacer la vue (ou clic du milieu)</td></tr>' +
        '<tr><td><kbd>Échap</kbd></td><td>Abandonner le tracé, désélectionner</td></tr>' +
        '<tr><td><kbd>Glisser</kbd></td><td>Réordonner calques et images</td></tr>' +
        '</table></div><div><h3>Clavier</h3><table>' + autres.slice(0, moitie).join('') + '</table></div>' +
        '<div><h3>&nbsp;</h3><table>' + autres.slice(moitie).join('') + '</table></div></div>'
    });
  }

  // ---------- Mise à jour générale ----------
  var taille = '';

  U.rafraichir = function () {
    var d = A.doc, h = A.histEtat(), t = d.w + '×' + d.h;
    U.rafraichirPanneaux();
    U.infos();
    $('#bAnnuler').disabled = !h.avant;
    $('#bRetablir').disabled = !h.apres;
    if (t !== taille) { taille = t; U.ajuster(); }
    U.redessiner();
  };

  function init() {
    U.initVue();
    initRaccourcis();
    initMenus();
    U.initPanneaux();
    U.initFichiers();
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'), el = document.activeElement;
      fermerMenus();
      // Un bouton qui garderait le clavier détournerait Entrée et Espace.
      if (el && el.closest && !el.closest('#modal') && (el.tagName === 'BUTTON' || el.type === 'checkbox')) el.blur();
      if (b) agir(b.dataset.act);
    });
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (!el.closest('#modal') && (el.tagName === 'SELECT' || el.type === 'range' || el.type === 'number')) el.blur();
    });
    // La case de la frise et le menu Affichage montrent le même état de la pelure d'oignon.
    $('#oignon').addEventListener('change', cocher);
    document.addEventListener('keydown', touche);
    document.addEventListener('keyup', relache);
    window.addEventListener('blur', function () { U.espace = false; $('#scene').classList.remove('main'); });

    A.surChange = function () { U.rafraichir(); U.sauverBientot(); };
    var reprise = U.reprendre();
    if (!reprise) { A.exemple(); U.nom = 'gelee'; }
    U.rafraichirPalette();
    cocher();
    U.ajuster();
    if (!reprise) U.lire(true);
    else U.message('Sprite de la dernière séance repris.');
  }

  init();
})();
