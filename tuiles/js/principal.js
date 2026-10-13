(function () {
  'use strict';

  var M = window.Tuiles, U = M.ui, J = M.jeux, A = M.auto, Es = M.essai;

  var DT_MAX = 0.25;             // secondes : au-delà (onglet resté en arrière-plan), l'essai ne rattrape pas le temps perdu
  var CASES_ESSAI = 30;          // largeur visée de la vue d'essai, en cases

  var $ = function (s) { return document.querySelector(s); };
  var echapper = U.echapper;

  // ---------- Commandes ----------
  function basculerCalque(type) {
    var k = M.carte.calques.indexOf(M.calqueDeType(type));
    M.calqueRegler(k, 'visible', !M.carte.calques[k].visible);
  }
  function annuler(sens) {
    var nom;
    if (U.gesteEnCours()) return;
    nom = sens < 0 ? M.annuler() : M.retablir();
    if (nom) U.message((sens < 0 ? 'Annulé : ' : 'Rétabli : ') + nom);
    else U.message(sens < 0 ? 'Rien à annuler.' : 'Rien à rétablir.');
  }
  function vue(cle) { U[cle] = !U[cle]; U.rafraichir(); U.rafraichirMini(); U.ajusterToile(); }

  var ACTIONS = {
    nouvelle: function () { U.dlgNouvelle(); },
    ouvrir: function () { U.choisirProjet(); },
    enregistrer: function () { U.enregistrer(); },
    png: function () { U.dlgPng(); },
    moteur: function () { U.dlgMoteur(); },
    tiled: function () { U.dlgTiled(); },
    exVillage: function () { exemple('village'); },
    exNiveau: function () { exemple('niveau'); },
    annuler: function () { annuler(-1); },
    retablir: function () { annuler(1); },
    couper: function () { U.couper(); },
    copier: function () { U.copier(); },
    coller: function () { U.coller(); },
    supprimer: function () { U.supprimer(); },
    toutSel: function () { U.toutSelectionner(); },
    desel: function () { U.deselectionner(); },
    miroirH: function () { U.orienter('h'); },
    miroirV: function () { U.orienter('v'); },
    tourner: function () { U.orienter('d'); },
    tournerG: function () { U.orienter('g'); },
    carte: function () { U.dlgCarte(); },
    calAjouter: function () { M.calqueAjouter(); },
    calDupliquer: function () { M.calqueDupliquer(M.carte.iCalque); },
    calSupprimer: function () { if (!M.calqueSupprimer(M.carte.iCalque)) U.message('Ce calque ne se supprime pas : il faut garder un calque de tuiles, les objets et les collisions.'); },
    calMonter: function () { M.calqueDeplacer(M.carte.iCalque, M.carte.iCalque + 1); },
    calDescendre: function () { M.calqueDeplacer(M.carte.iCalque, M.carte.iCalque - 1); },
    calDessus: function () { M.allerCalque(M.carte.iCalque + 1); U.rafraichir(); },
    calDessous: function () { M.allerCalque(M.carte.iCalque - 1); U.rafraichir(); },
    essayer: function () { essayer(); },
    jeuImporter: function () { U.choisirFichiers(); },
    jeuTextures: function () { U.dlgTextures(); },
    jeuDemo: function () { var j = M.jeuAjouter(J.demo(M.carte.tc)); U.jeuActif = j.id; U.selJeu = { x: 0, y: 0, w: 1, h: 1 }; U.tamponDepuisPalette(); U.toutRepeindre(); U.rafraichir(); },
    jeuRenommer: function () { U.dlgJeuRenommer(); },
    jeuAnimer: function () { U.dlgAnimer(); },
    jeuFiger: function () { U.retirerAnimation(); },
    jeuTerrain: function () { U.dlgTerrain(); },
    jeuPng: function () { U.exporterJeu(); },
    jeuSupprimer: function () { U.jeuSupprimer(); },
    paletteMoins: function () { U.zoomerPalette(-1); },
    palettePlus: function () { U.zoomerPalette(1); },
    propAjouter: function () { U.ajouterProp(); },
    zoomPlus: function () { U.zoomer(1); },
    zoomMoins: function () { U.zoomer(-1); },
    zoomReel: function () { U.cadrer(8); },
    zoomTout: function () { U.cadrer(); },
    grille: function () { vue('grille'); },
    regles: function () { vue('regles'); },
    mini: function () { vue('mini'); },
    anime: function () { vue('anime'); U.toutRepeindre(); },
    murs: function () { basculerCalque('collisions'); },
    hasard: function () { U.aleatoire = !U.aleatoire; U.construireOptions(); U.demander(); U.message(U.aleatoire ? 'Pinceau au hasard : chaque case reçoit une des tuiles choisies dans le jeu.' : 'Pinceau au hasard arrêté.'); },
    aide: function () { aide(); },
    format: function () { format(); }
  };
  // Une commande de l'en-tête pendant l'essai ramène d'abord à l'éditeur : l'essai garde sinon un monde périmé.
  U.agir = function (act) { if (U.essai && act !== 'essayer') finEssai(); if (ACTIONS[act]) ACTIONS[act](); };

  // ---------- Menus ----------
  var MENUS = [
    { titre: 'Fichier', items: [['nouvelle', 'Nouvelle carte…'], ['ouvrir', 'Ouvrir un projet…', 'Ctrl+O'], ['enregistrer', 'Enregistrer le projet', 'Ctrl+S'], null,
      ['png', 'Exporter en PNG…', 'Ctrl+E'], ['moteur', 'Exporter pour un moteur de jeu (JSON)…'], ['tiled', 'Exporter pour Tiled (.tmj)…'], null,
      ['exVillage', 'Ouvrir l\'exemple : village'], ['exNiveau', 'Ouvrir l\'exemple : niveau de plateformes']] },
    { titre: 'Édition', items: [['annuler', 'Annuler', 'Ctrl+Z'], ['retablir', 'Rétablir', 'Ctrl+Y'], null, ['couper', 'Couper', 'Ctrl+X'], ['copier', 'Copier', 'Ctrl+C'], ['coller', 'Coller', 'Ctrl+V'], ['supprimer', 'Vider la sélection', 'Suppr'], null,
      ['toutSel', 'Tout sélectionner', 'Ctrl+A'], ['desel', 'Désélectionner', 'Ctrl+D'], null, ['miroirH', 'Miroir horizontal', 'X'], ['miroirV', 'Miroir vertical', 'Y'], ['tourner', 'Quart de tour', 'Z'], ['hasard', 'Pinceau au hasard', 'D']] },
    { titre: 'Carte', items: [['carte', 'Taille et réglages de la carte…'], null, ['calAjouter', 'Nouveau calque de tuiles', 'Maj+N'], ['calDupliquer', 'Dupliquer le calque'], ['calSupprimer', 'Supprimer le calque'], ['calDessus', 'Calque du dessus', 'Page préc.'], ['calDessous', 'Calque du dessous', 'Page suiv.'], null, ['essayer', 'Essayer la carte', 'Ctrl+Entrée']] },
    { titre: 'Tuiles', items: [['jeuImporter', 'Importer une image, un atlas, un sprite…', 'Ctrl+I'], ['jeuTextures', 'Générer avec Textures…'], ['jeuDemo', 'Ajouter les tuiles de démonstration'], null,
      ['jeuRenommer', 'Renommer le jeu affiché…'], ['jeuAnimer', 'Animer les tuiles choisies…'], ['jeuFiger', 'Retirer l\'animation de la tuile'], ['jeuTerrain', 'Faire un terrain depuis la tuile…'], ['jeuPng', 'Enregistrer l\'image du jeu (PNG)'], ['jeuSupprimer', 'Supprimer le jeu affiché…']] },
    { titre: 'Vue', items: [['zoomPlus', 'Zoom avant', '+'], ['zoomMoins', 'Zoom arrière', '−'], ['zoomReel', 'Taille réelle (100 %)', 'Ctrl+1'], ['zoomTout', 'Voir toute la carte', 'Ctrl+0'], null,
      ['grille', 'Grille', 'Q', 'grille'], ['regles', 'Règles graduées', '', 'regles'], ['mini', 'Mini-carte', '', 'mini'], ['murs', 'Collisions visibles', 'C', 'murs'], ['anime', 'Animations en direct', '', 'anime']] },
    { titre: 'Aide', items: [['aide', 'Raccourcis clavier', 'F1'], ['format', 'Format d\'export pour un moteur']] }
  ];

  function coche(cle) { return cle === 'murs' ? M.calqueDeType('collisions').visible : U[cle]; }

  function construireMenus() {
    $('#menus').innerHTML = MENUS.map(function (m, k) {
      return '<div class="menu"><button type="button" class="menu-titre" data-menu="' + k + '">' + m.titre + '</button><div class="menu-liste" hidden>' + m.items.map(function (i) {
        return i ? '<button type="button" data-act="' + i[0] + '"' + (i[3] ? ' data-coche="' + i[3] + '"' : '') + '><span>' + echapper(i[1]) + '</span><kbd>' + (i[2] || '') + '</kbd></button>' : '<hr>';
      }).join('') + '</div></div>';
    }).join('');
  }
  function fermerMenus() {
    document.querySelectorAll('.menu-liste').forEach(function (l) { l.hidden = true; });
    document.querySelectorAll('.menu-titre').forEach(function (b) { b.classList.remove('ouvert'); });
  }
  function ouvrirMenu(b) {
    var l = b.nextElementSibling;
    fermerMenus();
    l.querySelectorAll('[data-coche]').forEach(function (x) { x.classList.toggle('coche', !!coche(x.dataset.coche)); });
    l.hidden = false;
    b.classList.add('ouvert');
  }
  function menuOuvert() { return !!document.querySelector('.menu-titre.ouvert'); }

  // ---------- Aide ----------
  function table(lignes) { return '<table>' + lignes.map(function (l) { return '<tr><td><kbd>' + l[0] + '</kbd></td><td>' + l[1] + '</td></tr>'; }).join('') + '</table>'; }

  function aide() {
    U.dialogue({
      titre: 'Raccourcis clavier', large: true,
      html: '<div class="aide"><div><h3>Outils</h3>' + table([['B', 'Tampon'], ['T', 'Terrain à raccords automatiques'], ['E', 'Gomme'], ['G', 'Pot de remplissage'], ['R', 'Rectangle (ou zone d\'objet)'], ['L', 'Ligne'], ['I', 'Pipette'], ['S', 'Sélection (ou choix d\'un objet)'], ['P', 'Point (calque d\'objets)'], ['H', 'Main'], ['Clic droit', 'Prendre la tuile ; glisser : un bloc'], ['Alt + clic', 'Pipette passagère'], ['0 à 4', 'Type de collision (calque de collisions)']]) + '</div>' +
        '<div><h3>Tampon et sélection</h3>' + table([['X / Y', 'Miroir horizontal / vertical'], ['Z, Maj+Z', 'Quart de tour'], ['D', 'Pinceau au hasard'], ['Ctrl+C / X / V', 'Copier, couper, coller'], ['Suppr', 'Vider la sélection, supprimer l\'objet'], ['Ctrl+A / D', 'Tout sélectionner / désélectionner'], ['Ctrl + glisser', 'Copier la sélection en la déplaçant'], ['Échap', 'Désélectionner, fermer']]) +
        '<h3>Historique et fichiers</h3>' + table([['Ctrl+Z', 'Annuler'], ['Ctrl+Y, Ctrl+Maj+Z', 'Rétablir'], ['Ctrl+S', 'Enregistrer le projet'], ['Ctrl+O', 'Ouvrir un projet'], ['Ctrl+I', 'Importer des tuiles'], ['Ctrl+E', 'Exporter en PNG']]) + '</div>' +
        '<div><h3>Vue</h3>' + table([['Molette', 'Zoom sur la case visée'], ['Clic milieu, Espace + glisser', 'Déplacer la vue'], ['+ / −', 'Zoom'], ['Ctrl+1', 'Taille réelle'], ['Ctrl+0', 'Voir toute la carte'], ['Q', 'Grille'], ['C', 'Collisions visibles']]) +
        '<h3>Calques et essai</h3>' + table([['Page préc. / suiv.', 'Calque du dessus / du dessous'], ['Maj+N', 'Nouveau calque'], ['Double-clic', 'Renommer un calque'], ['Ctrl+Entrée', 'Essayer la carte'], ['Flèches ou ZQSD', 'Bouger pendant l\'essai'], ['Espace', 'Sauter (mode plateformes)']]) + '</div></div>' +
        '<p class="note">On peut aussi déposer des fichiers sur la fenêtre : un projet, une image à découper, un atlas de Textures (le JSON seul suffit, l\'image est recalculée), un projet Atelier Pixel.</p>'
    });
  }

  function format() {
    U.dialogue({
      titre: 'Format d\'export pour un moteur de jeu', large: true,
      html: '<div class="doc"><p>« Exporter pour un moteur de jeu » écrit un fichier <b>.carte.json</b> :</p>' +
        '<pre>{\n  "format": "tuiles-carte", "version": 1,\n  "nom": "Village", "largeur": 44, "hauteur": 30,   // en cases\n  "tuile": 16,                                     // côté d\'une case, en pixels\n  "mode": "dessus",                                // ou "plateformes"\n  "jeux": [ { "nom": "Textures", "image": "textures-41.png", "donnees": "data:image/png;base64,…",\n              "premier": 41, "nombre": 80, "colonnes": 8, "largeurTuile": 16, "hauteurTuile": 16,\n              "animations": { "49": [ { "tuile": 49, "duree": 125 }, { "tuile": 50, "duree": 125 } ] } } ],\n  "calques": [ { "nom": "Sol", "visible": true, "opacite": 1,\n                 "cases": [41, 41, 0, …],            // largeur × hauteur numéros, ligne par ligne ; 0 = vide\n                 "orientations": [0, 1, 0, …] } ],   // absent si aucune tuile n\'est retournée\n  "collisions": { "types": ["vide", "plein", "plateforme", "pente-montante", "pente-descendante"],\n                  "cases": [0, 1, 1, …] },           // rang dans « types »\n  "objets": [ { "id": 7, "nom": "Départ", "type": "départ", "forme": "point",   // ou "rectangle"\n                "x": 328, "y": 232, "largeur": 0, "hauteur": 0,                  // en pixels de carte\n                "proprietes": { "contenu": "clé" } } ]\n}</pre>' +
        '<p><b>Trouver une tuile.</b> Un numéro n appartient au jeu tel que premier ≤ n &lt; premier + nombre. Avec i = n − premier, la tuile est dans l\'image du jeu en x = (i modulo colonnes) × largeurTuile, y = partie entière de (i ÷ colonnes) × hauteurTuile. Les calques se dessinent dans l\'ordre du tableau, le premier dessous. Une tuile plus grande que la case se pose alignée en bas à gauche de la case.</p>' +
        '<p><b>Orientations.</b> Un nombre de 0 à 7 : 1 = miroir horizontal, 2 = miroir vertical, 4 = transposition (échange des axes), appliquée en premier. Un quart de tour à droite vaut 5, un demi-tour 3, un quart de tour à gauche 6.</p>' +
        '<p><b>Animations.</b> La clé est le numéro de la tuile posée sur la carte ; la liste donne les images à montrer tour à tour, avec leur durée en millisecondes.</p>' +
        '<p><b>Collisions.</b> « plateforme » n\'arrête que ce qui tombe dessus. « pente-montante » monte vers la droite (le sol va du coin bas gauche au coin haut droit), « pente-descendante » descend vers la droite.</p>' +
        '<p>Le fichier <b>.tuiles.json</b> de « Enregistrer le projet » sert à rouvrir la carte ici ; l\'export <b>.tmj</b> s\'ouvre dans Tiled.</p></div>'
    });
  }

  // ---------- Exemples ----------
  function nommee(j, debut) {
    var k;
    for (k in j.noms) if (j.noms[k].indexOf(debut) === 0) return j.premier + Number(k);
    return 0;
  }
  function terrainNomme(j, debut) {
    var k;
    for (k = 0; k < j.terrains.length; k++) if (j.terrains[k].nom.indexOf(debut) === 0) return j.terrains[k];
    return j.terrains[0];
  }

  function exemple(genre) {
    var village = genre === 'village', tex = J.texturesPretes(), jd, jt, jo, c, sol, chemins, decor, col, x, y, k, T = {};
    function mur(x, y, v) { M.poser(col, x, y, v === undefined ? 1 : v); }
    function terrain(cal, j, ter, x0, y0, x1, y1, solide) { for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) { A.poser(cal, xx, yy, j, ter); if (solide) mur(xx, yy); } }
    function pave(cal, v, x0, y0, x1, y1, solide) { for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) { M.poser(cal, xx, yy, v); if (solide !== undefined) mur(xx, yy, solide); } }
    function chose(nom, x, y, solide) { M.poser(decor, x, y, nommee(jd, nom)); if (solide) mur(x, y); }

    M.nouvelle(village ? { nom: 'Village', w: 44, h: 30, tc: 16, mode: 'dessus' } : { nom: 'Niveau', w: 64, h: 22, tc: 16, mode: 'plateformes' });
    jd = M.jeuAjouter(J.demo(16), true);
    if (tex) {
      jt = M.jeuAjouter(J.depuisTextures([{ matiere: 'herbe', graine: 'pré' }, { matiere: 'eau', graine: 'lac' }, { matiere: 'briques', graine: 'mur' }, { matiere: 'planches', graine: 'pont' }, { matiere: 'tuiles', graine: 'toit' }, { matiere: 'pierre', graine: 'roc' }, { matiere: 'sable', graine: 'dune' },
        { matiere: 'terre', graine: 'sol', terrain: 47 }, { matiere: 'paves', graine: 'rue', terrain: 47 }, { matiere: 'eau', graine: 'lac', terrain: 47 }, { matiere: 'herbe', graine: 'pré', terrain: 47 }], 16, 'Textures'), true);
    }
    jo = jt || jd;
    T.herbe = jt ? nommee(jt, 'Herbe') : nommee(jd, 'Herbe 1');
    T.eau = jt ? nommee(jt, 'Eau') : nommee(jd, 'Eau');
    T.briques = nommee(jo, 'Mur de briques'); T.planches = jt ? nommee(jt, 'Planches') : nommee(jd, 'Plancher'); T.toit = jt ? nommee(jt, 'Tuiles') : nommee(jd, 'Toit');
    T.terre = terrainNomme(jo, jt ? 'Terre' : 'Chemin'); T.paves = jt ? terrainNomme(jt, 'Pavés') : T.terre; T.lac = jt ? terrainNomme(jt, 'Eau') : null; T.pre = jt ? terrainNomme(jt, 'Herbe') : T.terre;
    c = M.carte;
    sol = c.calques[0];
    M.allerCalque(0);
    M.calqueAjouter(village ? 'Chemins' : 'Plateformes');
    c = M.carte;
    chemins = c.calques[1]; decor = c.calques[2]; col = M.calqueDeType('collisions');

    if (village) {
      pave(sol, T.herbe, 0, 0, 43, 29);
      if (!jt) for (k = 0; k < 160; k++) M.poser(sol, (k * 37) % 44, (k * 53) % 30, nommee(jd, 'Herbe ' + (1 + k % 3)) || T.herbe);
      terrain(chemins, jo, T.terre, 0, 14, 43, 15); terrain(chemins, jo, T.terre, 20, 3, 21, 29); terrain(chemins, jo, T.terre, 7, 10, 8, 14); terrain(chemins, jo, T.terre, 31, 9, 32, 14); terrain(chemins, jo, T.terre, 10, 15, 11, 19);
      terrain(chemins, jo, T.paves, 16, 11, 25, 18);
      if (T.lac) terrain(chemins, jt, T.lac, 30, 20, 39, 26, true); else pave(sol, T.eau, 30, 20, 39, 26, 1);
      [[4, 5, 7], [28, 4, 8], [7, 19, 7]].forEach(function (m) {
        pave(decor, T.toit, m[0], m[1], m[0] + m[2] - 1, m[1] + 2, 1);
        pave(decor, m[1] === 4 ? T.planches : T.briques, m[0], m[1] + 3, m[0] + m[2] - 1, m[1] + 4, 1);
        chose('Porte', m[0] + (m[2] >> 1), m[1] + 4, true);
        M.objetAjouter({ nom: m[1] === 4 ? 'Porte de la forge' : m[1] === 5 ? 'Porte de l\'auberge' : 'Porte du moulin', type: 'porte', x: (m[0] + (m[2] >> 1)) * 16, y: (m[1] + 5) * 16, w: 16, h: 16, props: [['vers', m[1] === 4 ? 'forge' : m[1] === 5 ? 'auberge' : 'moulin']] });
      });
      [[1, 2], [13, 3], [15, 7], [2, 11], [38, 3], [41, 9], [26, 20], [3, 22], [16, 23], [24, 26], [41, 17], [36, 12], [1, 27], [13, 27], [25, 2]].forEach(function (p) { chose('Arbre', p[0], p[1], true); });
      [[12, 8], [23, 6], [35, 17], [5, 16], [27, 12], [18, 21], [42, 24]].forEach(function (p) { chose('Buisson', p[0], p[1], true); });
      [[28, 22], [40, 28], [14, 12], [34, 2]].forEach(function (p) { chose('Rocher', p[0], p[1], true); });
      chose('Coffre', 24, 12, true); chose('Panneau', 18, 13, true); chose('Tonneau', 12, 9, true); chose('Caisse', 36, 9, true); chose('Caisse', 37, 9, true); chose('Tonneau', 15, 23, true);
      M.objetAjouter({ nom: 'Départ', type: 'départ', x: 21 * 16, y: 16 * 16 + 8 });
      M.objetAjouter({ nom: 'Coffre', type: 'coffre', x: 24 * 16, y: 12 * 16, w: 16, h: 16, props: [['contenu', 'clé du moulin']] });
      M.objetAjouter({ nom: 'Bord du lac', type: 'déclencheur', x: 29 * 16, y: 19 * 16, w: 12 * 16, h: 16, props: [['texte', 'L\'eau est froide.']] });
      M.objetAjouter({ nom: 'Marchand', type: 'pnj', x: 18 * 16 + 8, y: 17 * 16 + 8 });
    } else {
      c.fond = '#86b9e8';
      terrain(chemins, jo, T.terre, 0, 17, 17, 21, true); terrain(chemins, jo, T.terre, 23, 17, 41, 21, true); terrain(chemins, jo, T.terre, 46, 15, 63, 21, true);
      terrain(chemins, jo, T.terre, 29, 14, 35, 16, true); terrain(chemins, jo, T.terre, 52, 11, 58, 14, true);
      if (jt) { terrain(decor, jo, T.pre, 0, 17, 17, 17); terrain(decor, jo, T.pre, 23, 17, 28, 17); terrain(decor, jo, T.pre, 36, 17, 41, 17); terrain(decor, jo, T.pre, 29, 14, 35, 14); terrain(decor, jo, T.pre, 46, 15, 51, 15); terrain(decor, jo, T.pre, 59, 15, 63, 15); terrain(decor, jo, T.pre, 52, 11, 58, 11); }
      pave(sol, T.eau, 18, 20, 22, 21); pave(sol, T.eau, 42, 20, 45, 21);
      pave(decor, T.briques, 7, 13, 10, 13, 1); pave(decor, T.briques, 13, 10, 15, 10, 1); pave(decor, T.briques, 24, 12, 26, 12, 1);
      pave(decor, T.planches, 18, 16, 22, 16, 2); pave(decor, T.planches, 38, 12, 41, 12, 2); pave(decor, T.planches, 42, 15, 45, 15, 2); pave(decor, T.planches, 47, 11, 49, 11, 2);
      chose('Arbre', 2, 16); chose('Buisson', 5, 16); chose('Arbre', 15, 16); chose('Rocher', 25, 16); chose('Arbre', 39, 16); chose('Buisson', 60, 14); chose('Arbre', 62, 14);
      chose('Caisse', 11, 16, true); chose('Caisse', 12, 16, true); chose('Caisse', 12, 15, true); chose('Coffre', 55, 10, false); chose('Panneau', 48, 14, false); chose('Porte', 62, 14, false);
      M.objetAjouter({ nom: 'Départ', type: 'départ', x: 3 * 16 + 8, y: 16 * 16 + 8 });
      [[8, 12], [9, 12], [14, 9], [20, 14], [25, 11], [32, 12], [39, 10], [40, 10], [48, 9]].forEach(function (p, n) { M.objetAjouter({ nom: 'Pièce ' + (n + 1), type: 'pièce', x: p[0] * 16 + 8, y: p[1] * 16 + 8 }); });
      M.objetAjouter({ nom: 'Trésor', type: 'coffre', x: 55 * 16, y: 10 * 16, w: 16, h: 16, props: [['contenu', '50 pièces']] });
      M.objetAjouter({ nom: 'Arrivée', type: 'sortie', x: 62 * 16, y: 13 * 16, w: 16, h: 32, props: [['vers', 'niveau-2']] });
      M.objetAjouter({ nom: 'Chute dans l\'eau', type: 'déclencheur', x: 18 * 16, y: 20 * 16, w: 5 * 16, h: 32, props: [['effet', 'retour au départ']] });
    }
    M.calqueDeType('collisions').visible = false;
    M.allerCalque(1);
    M.installer(M.carte);
    U.apresChargement();
    U.jeuActif = jo.id;
    U.rafraichir();
    U.message(village ? 'Exemple « village » : touche C pour voir les collisions, Ctrl+Entrée pour s\'y promener.' : 'Exemple « niveau de plateformes » : Ctrl+Entrée pour l\'essayer.');
  }

  // ---------- Essai ----------
  var touchesEssai = { ArrowLeft: 'gauche', ArrowRight: 'droite', ArrowUp: 'haut', ArrowDown: 'bas', q: 'gauche', a: 'gauche', d: 'droite', z: 'haut', w: 'haut', s: 'bas', ' ': 'saut' };

  function essayer() {
    var m, j, t;
    if (U.essai) { finEssai(); return; }
    if (U.gesteEnCours() || U.fenetreOuverte()) return;
    m = Es.monde();
    j = Es.depart(m);
    if (!j) { U.alerte('Essai impossible', 'Aucune case libre où poser le personnage : le calque de collisions remplit toute la carte.'); return; }
    t = U.tailleToile();
    U.essai = { m: m, j: j, e: {}, reperes: false, vue: { ppt: U.ppt, ox: U.ox, oy: U.oy }, dernier: performance.now(), depart: { x: j.x, y: j.y }, touche: '' };
    document.body.classList.add('essai');
    $('#essaiMode').textContent = m.mode === 'plateformes' ? 'Plateformes' : 'Vue de dessus';
    $('#essaiSaut').hidden = m.mode !== 'plateformes';
    U.ajusterToile();
    t = U.tailleToile();
    U.ppt = m.tc * Math.max(1, Math.round(t.l / (CASES_ESSAI * m.tc)));
    requestAnimationFrame(boucle);
  }

  function finEssai() {
    var v = U.essai.vue;
    U.essai = null;
    document.body.classList.remove('essai');
    U.ppt = v.ppt; U.ox = v.ox; U.oy = v.oy;
    U.ajusterToile();
    U.rafraichirMini();
  }

  function boucle(t) {
    var s = U.essai, m, j, k, dim, dt, W, H, noms;
    if (!s) return;
    m = s.m; j = s.j;
    dt = Math.min(DT_MAX, Math.max(0, (t - s.dernier) / 1000));
    s.dernier = t;
    if ($('#modal').hidden) Es.pas(m, j, { gauche: s.e.gauche, droite: s.e.droite, haut: s.e.haut, bas: s.e.bas, saut: s.e.saut || (m.mode === 'plateformes' && s.e.haut) }, dt);
    dim = U.tailleToile(); k = U.ppt / m.tc; W = m.w * U.ppt; H = m.h * U.ppt;
    // La vue suit le personnage sans montrer l'extérieur de la carte, sauf si la carte est plus petite que l'écran.
    U.ox = W <= dim.l ? Math.round((dim.l - W) / 2) : Math.round(M.borne(dim.l / 2 - (j.x + j.w / 2) * k, dim.l - W, 0));
    U.oy = H <= dim.h ? Math.round((dim.h - H) / 2) : Math.round(M.borne(dim.h / 2 - (j.y + j.h / 2) * k, dim.h - H, 0));
    noms = Es.touches(m, j).map(function (o) { return (o.nom || '(sans nom)') + (o.type ? ' (' + o.type + ')' : ''); }).join(', ');
    if (noms !== s.touche) { s.touche = noms; $('#essaiTouche').textContent = noms ? 'Touche : ' + noms : ''; }
    U.dessinerTout();
    requestAnimationFrame(boucle);
  }

  // Le personnage : un petit bonhomme dessiné en pixels de carte.
  U.dessinerEssai = function (g) {
    var s = U.essai, j = s.j, k = U.ppt / s.m.tc, x = Math.round(U.ox + j.x * k), y = Math.round(U.oy + j.y * k), w = Math.round(j.w * k), h = Math.round(j.h * k), p = Math.max(1, Math.round(k));
    var pas = j.vx || (s.m.mode !== 'plateformes' && j.vy) ? Math.floor(j.marche * 8) % 2 : 0, oeil = j.face > 0 ? w - 4 * p : 2 * p;
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + p, y + h - p, w - 2 * p, 2 * p);
    g.fillStyle = '#1c1c1e'; g.fillRect(x, y, w, h - (pas ? p : 0));
    g.fillStyle = '#f0c35a'; g.fillRect(x + p, y + p, w - 2 * p, h - 2 * p - (pas ? p : 0));
    g.fillStyle = '#c9743f'; g.fillRect(x + p, y + Math.round(h * 0.55), w - 2 * p, h - Math.round(h * 0.55) - p - (pas ? p : 0));
    g.fillStyle = '#1c1c1e'; g.fillRect(x + oeil, y + 3 * p, p, 2 * p); g.fillRect(x + oeil + (j.face > 0 ? -3 * p : 3 * p), y + 3 * p, p, 2 * p);
    g.fillRect(x + p + (pas ? 0 : p), y + h - p, 2 * p, p); g.fillRect(x + w - 3 * p - (pas ? 0 : p), y + h - p, 2 * p, p);
  };

  function toucheEssai(e, bas) {
    var s = U.essai, cle = touchesEssai[e.key] || touchesEssai[e.key.toLowerCase()];
    if (bas && e.key === 'Escape') { finEssai(); e.preventDefault(); return; }
    if (bas && e.ctrlKey && e.key === 'Enter') { finEssai(); e.preventDefault(); return; }
    if (bas && !e.repeat && (e.key === 'c' || e.key === 'C')) { s.reperes = !s.reperes; return; }
    if (bas && !e.repeat && (e.key === 'r' || e.key === 'R')) { s.j.x = s.depart.x; s.j.y = s.depart.y; s.j.vx = s.j.vy = 0; return; }
    if (!cle) return;
    s.e[cle] = bas;
    e.preventDefault();
  }

  // ---------- Clavier ----------
  var TOUCHES_OUTILS = { b: 'tampon', t: 'terrain', e: 'gomme', g: 'pot', r: 'rect', l: 'ligne', i: 'pipette', s: 'selection', h: 'main', p: 'objPoint' };

  function clavier(e) {
    var cible = e.target, saisie = cible.tagName === 'TEXTAREA' || cible.tagName === 'SELECT' || (cible.tagName === 'INPUT' && cible.type !== 'checkbox' && cible.type !== 'range' && cible.type !== 'radio');
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, ctrl = e.ctrlKey || e.metaKey, chiffre = /^Digit([0-4])$/.exec(e.code), type, o;
    // Les chiffres se lisent sur la position de la touche : un clavier français les donne sans Maj.
    if (chiffre && k !== '#') k = chiffre[1];
    // Le champ du nom de carte reste à l'écran pendant l'essai : on doit pouvoir y écrire toutes les lettres.
    if (U.essai && !saisie) { toucheEssai(e, true); return; }
    if (k === 'Escape') {
      if (U.fenetreOuverte()) U.fermer();
      else if (menuOuvert()) fermerMenus();
      else if (saisie) cible.blur();
      else if (!U.gesteEnCours()) { U.deselectionner(); if (U.objSel) { U.objSel = null; U.rafraichir(); } }
      return;
    }
    if (U.fenetreOuverte()) return;
    if (k === 'F1') { e.preventDefault(); aide(); return; }
    if (ctrl && !e.altKey) {
      o = { z: e.shiftKey ? 'retablir' : 'annuler', y: 'retablir', s: 'enregistrer', o: 'ouvrir', i: 'jeuImporter', e: 'png', Enter: 'essayer', '0': 'zoomTout', '1': 'zoomReel' }[k];
      if (saisie && k !== 's' && k !== 'o' && k !== 'Enter') return;
      if (!o && !saisie) o = { c: 'copier', x: 'couper', v: 'coller', a: 'toutSel', d: 'desel' }[k];
      if (o) { e.preventDefault(); U.agir(o); }
      return;
    }
    if (saisie || e.altKey) return;
    if (k === ' ') { if (!U.espace) { U.espace = true; $('#scene').classList.add('main'); U.demander(); } if (cible.tagName !== 'BUTTON') e.preventDefault(); return; }
    if (U.gesteEnCours()) return;
    type = M.calqueActif().type;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); U.supprimer(); }
    else if (k === 'PageUp') { e.preventDefault(); U.agir('calDessus'); }
    else if (k === 'PageDown') { e.preventDefault(); U.agir('calDessous'); }
    else if (k === '+' || k === '=') U.zoomer(1);
    else if (k === '-') U.zoomer(-1);
    else if (e.shiftKey && k === 'n') U.agir('calAjouter');
    else if (k === 'z') U.agir(e.shiftKey ? 'tournerG' : 'tourner');
    else if (k === 'x') U.agir('miroirH');
    else if (k === 'y') U.agir('miroirV');
    else if (k === 'd') U.agir('hasard');
    else if (k === 'q' || k === '#') U.agir('grille');
    else if (k === 'c') U.agir('murs');
    else if (type === 'collisions' && k >= '0' && k <= '4') { U.tamponCol = M.blocUn(Number(k), 'collisions'); U.choisirOutil('tampon'); U.construireSource(); }
    else if (TOUCHES_OUTILS[k]) {
      o = TOUCHES_OUTILS[k];
      if (type === 'objets') o = { selection: 'objSel', rect: 'objRect', objPoint: 'objPoint', main: 'main' }[o];
      if (o) U.choisirOutil(o);
    }
  }

  // ---------- Démarrage ----------
  function carteDeDepart() {
    var c, k, sol, jd;
    M.nouvelle({ nom: 'carte', w: 40, h: 30, tc: 16 });
    jd = M.jeuAjouter(J.demo(16), true);
    sol = M.carte.calques[0];
    for (k = 0; k < 40 * 30; k++) M.poser(sol, k % 40, Math.floor(k / 40), jd.premier + (k * 7 + Math.floor(k / 40) * 3) % 11 % 3);
    c = M.carte;
    c.iCalque = 0;
    M.installer(c);
  }

  function demarrer() {
    var repris;
    construireMenus();
    U.initVue();
    U.initOutils();
    U.initPanneaux();
    U.initFichiers();
    repris = U.reprendre();
    if (!repris) carteDeDepart();
    M.surChange = function () {
      U.rafraichir();
      U.sauverBientot();
    };

    document.addEventListener('click', function (e) {
      var titre = e.target.closest('.menu-titre'), b = e.target.closest('[data-act]');
      if (titre) { if (titre.classList.contains('ouvert')) fermerMenus(); else ouvrirMenu(titre); return; }
      fermerMenus();
      if (b && !b.disabled) { U.agir(b.dataset.act); if (b.closest('.outils, .options, .rapides, .volet')) b.blur(); }
    });
    $('#menus').addEventListener('mouseover', function (e) {
      var titre = e.target.closest('.menu-titre');
      if (titre && menuOuvert() && !titre.classList.contains('ouvert')) ouvrirMenu(titre);
    });
    document.addEventListener('keydown', clavier);
    document.addEventListener('keyup', function (e) {
      if (U.essai) { toucheEssai(e, false); return; }
      if (e.key === ' ') { U.espace = false; $('#scene').classList.remove('main'); U.demander(); }
    });
    window.addEventListener('blur', function () { U.espace = false; $('#scene').classList.remove('main'); if (U.essai) U.essai.e = {}; });
    window.addEventListener('beforeunload', function () { U.sauverMaintenant(); });

    U.ajusterToile();
    U.apresChargement();
    if (repris) U.message('Carte de la dernière séance reprise.');
    else U.message('Choisis une tuile à droite et dessine. Fichier, « Ouvrir l\'exemple », montre une carte complète.');
    if (!J.texturesPretes()) $('#etatSauve').textContent = 'Textures non chargé : génération sur place indisponible';
  }

  demarrer();
})();
