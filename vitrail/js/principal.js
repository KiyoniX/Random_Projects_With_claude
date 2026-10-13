(function () {
  'use strict';

  // Menus, fenêtres, fichiers, clavier, sauvegarde automatique et démarrage.
  var V = window.Vitrail, G = V.geo, R = V.rendu, U = V.ui;

  var CLE = 'vitrail.projet';
  var DELAI_SAUVE = 700;
  var PNG_MAX = 8000;      // côté maximal d'une image exportée, en pixels

  var $ = function (s) { return document.querySelector(s); };
  var echapper = V.echapper;

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
      } else if (r !== false) U.fermer();
    });
    premier = f.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=color]), select') || f.querySelector('button.fort');
    if (premier) { premier.focus(); if (premier.select) premier.select(); }
    f.scrollTop = 0;
  };
  U.fermer = function () { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
  U.fenetreOuverte = function () { return !$('#modal').hidden; };
  U.alerte = function (titre, texte) { U.dialogue({ titre: titre, html: '<p>' + echapper(texte) + '</p>' }); };

  function choix(nom, liste, valeur) {
    return '<select name="' + nom + '">' + liste.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(valeur) ? ' selected' : '') + '>' + echapper(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function nombre(v) { v = Number(String(v).replace(',', '.')); return isFinite(v) ? v : null; }

  // ---------- Téléchargements ----------
  function telecharger(blob, nom) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = nom;
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
    U.dire('Fichier « ' + nom + ' » téléchargé.');
  }
  function base() { return V.doc.nom.replace(/[\\/:*?"<>|]/g, '-').trim() || 'vitrail'; }

  // L'image du vitrail : k pixels par millimètre, une marge d'un centimètre autour.
  V.image = function (k, vue, fond) {
    var f = V.doc.forme, m = 10, c = document.createElement('canvas'), g;
    c.width = Math.round((f.l + 2 * m) * k); c.height = Math.round((f.h + 2 * m) * k);
    g = c.getContext('2d');
    if (fond) { g.fillStyle = vue === 'atelier' ? '#9b9e9a' : vue === 'carton' ? '#efeee8' : '#fbfaf3'; g.fillRect(0, 0, c.width, c.height); }
    R.dessiner(g, { doc: V.doc, calc: V.calc, vue: vue, z: k, ox: m * k, oy: m * k, dpr: 1, verreDe: V.verre });
    return c;
  };

  function dlgPng() {
    var f = V.doc.forme;
    U.dialogue({
      titre: 'Exporter l\'image en PNG', ok: 'Exporter',
      html: '<p class="rang"><label class="champ">Finesse ' + choix('k', [[0.5, '5 pixels par cm'], [1, '10 pixels par cm'], [2, '20 pixels par cm'], [4, '40 pixels par cm']], 1) + '</label></p>' +
        '<p class="rang"><label class="champ">Lumière ' + choix('vue', [['jour', 'table allumée'], ['atelier', 'table éteinte'], ['carton', 'carton numéroté']], U.vue) + '</label></p>' +
        '<p class="rang"><label><input type="checkbox" name="fond" checked> Garder la table en fond (sinon, fond transparent)</label></p>' +
        '<p class="note">Le panneau fait ' + V.fr(f.l / 10) + ' × ' + V.fr(f.h / 10) + ' cm ; l\'image garde les textures de chaque verre.</p>',
      action: function (fo) {
        var k = Number(fo.elements.k.value), c;
        if ((f.l + 20) * k > PNG_MAX || (f.h + 20) * k > PNG_MAX) return 'L\'image dépasserait ' + PNG_MAX + ' pixels de côté : choisis une finesse plus faible.';
        c = V.image(k, fo.elements.vue.value, fo.elements.fond.checked);
        c.toBlob(function (b) { if (b) telecharger(b, base() + '.png'); else U.alerte('Export impossible', 'Le navigateur n\'a pas pu fabriquer l\'image.'); }, 'image/png');
      }
    });
  }

  function formeHtml(f) {
    return '<p class="rang"><label class="champ">Forme ' + choix('forme', G.FORMES.filter(function (x) { return x.id !== 'libre'; }).map(function (x) { return [x.id, x.nom]; }), f.type === 'libre' ? 'rect' : f.type) + '</label>' +
      '<label class="champ">Lobes <input type="number" name="lobes" min="5" max="16" value="' + f.lobes + '"></label></p>' +
      '<p class="rang"><label class="champ">Largeur <input type="number" name="l" step="0.5" value="' + f.l / 10 + '"> cm</label><label class="champ">Hauteur <input type="number" name="h" step="0.5" value="' + f.h / 10 + '"> cm</label></p>';
  }
  function lireForme(fo) {
    var l = nombre(fo.elements.l.value), h = nombre(fo.elements.h.value);
    if (l === null || h === null || l * 10 < V.COTE_MIN || h * 10 < V.COTE_MIN || l * 10 > V.COTE_MAX || h * 10 > V.COTE_MAX) return 'Largeur et hauteur vont de ' + V.COTE_MIN / 10 + ' à ' + V.COTE_MAX / 10 + ' cm.';
    return { type: fo.elements.forme.value, l: Math.round(l * 10), h: Math.round(h * 10), lobes: V.borne(Math.round(nombre(fo.elements.lobes.value) || 8), 5, 16), libre: null };
  }

  function dlgNouveau() {
    U.dialogue({
      titre: 'Nouveau panneau', ok: 'Poser le panneau',
      html: formeHtml(V.doc.forme) + '<p class="note">La table est vidée : il ne reste que le plomb de bordure. Les verres de l\'atelier restent. Ctrl+Z ramène le vitrail en cours.</p>',
      action: function (fo) {
        var f = lireForme(fo), verres = V.doc.verres;
        if (typeof f === 'string') return f;
        V.marquer();
        V.doc.forme = f; V.doc.pieces = []; V.doc.grisaille = []; V.doc.nom = 'vitrail';
        G.bordure(V.doc);
        V.doc.verres = verres;
        V.change(false);
        U.ajuster();
        U.choisirOutil('plomb');
        U.dire('Panneau posé : trace les plombs qui le découpent en pièces.');
      }
    });
  }

  var SYLLABES = ['ro', 'sa', 'li', 'mé', 'ta', 'vi', 'non', 'char', 'tres', 'bel', 'lu', 'mi', 'ga', 'ber', 'sel', 'pa'];
  function graineHasard() { var s = '', i; for (i = 0; i < 3; i++) s += SYLLABES[Math.floor(Math.random() * SYLLABES.length)]; return s; }

  function dlgGenerer() {
    U.dialogue({
      titre: 'Générer un réseau de plombs', ok: 'Générer',
      html: '<p class="rang"><label class="champ">Motif ' + choix('motif', V.MOTIFS.map(function (m) { return [m.id, m.nom]; }), U.dernierMotif || 'fleur') + '</label></p>' +
        '<p class="rang"><label class="champ">Graine <input type="text" name="graine" maxlength="30" value="' + graineHasard() + '"></label></p>' +
        '<p class="note">Le réseau est tracé sur la forme du panneau en cours (' + echapper(G.FORMES.filter(function (x) { return x.id === V.doc.forme.type; })[0].nom.toLowerCase()) + ', ' + V.fr(V.doc.forme.l / 10) + ' × ' + V.fr(V.doc.forme.h / 10) + ' cm), puis vitré avec les verres de l\'atelier. Le vitrail actuel est remplacé ; Ctrl+Z le ramène. Une même graine redonne le même réseau.</p>',
      action: function (fo) {
        var m = fo.elements.motif.value, gr = fo.elements.graine.value.trim() || graineHasard();
        U.dernierMotif = m;
        V.marquer();
        V.generer(m, gr);
        V.change(false);
        U.choisir(null);
        U.ajuster();
        U.dire(V.calc.faces.length + ' pièces tirées de la graine « ' + gr + ' » : retouche les plombs, change les verres.');
      }
    });
  }

  function dlgVerre(v) {
    var neuf = !v, cur = V.verre(U.verre);
    if (neuf && V.doc.verres.length >= V.VERRES_MAX) { U.dire('L\'atelier garde au plus ' + V.VERRES_MAX + ' verres.'); return; }
    v = v || { nom: '', couleur: cur ? cur.couleur : '#6fa6d6', texture: cur ? cur.texture : 'cathedrale' };
    U.dialogue({
      titre: neuf ? 'Ajouter un verre' : 'Modifier le verre', ok: neuf ? 'Ajouter' : 'Modifier',
      html: '<p class="rang"><label class="champ">Nom <input type="text" name="nom" maxlength="40" value="' + echapper(v.nom) + '" placeholder="tiré de la couleur"></label></p>' +
        '<p class="rang"><label class="champ">Couleur <input type="color" name="couleur" value="' + v.couleur + '"></label>' +
        '<label class="champ">Texture ' + choix('texture', R.TEXTURES.map(function (t) { return [t.id, t.nom]; }), v.texture) + '</label></p>' +
        (neuf ? '' : '<p class="note">Toutes les pièces de ce verre changent avec lui.</p>'),
      action: function (fo) {
        var nom = fo.elements.nom.value.trim() || V.nomTeinte(fo.elements.couleur.value), o;
        V.marquer();
        if (neuf) { o = { id: V.verreSuivant(), nom: nom, couleur: fo.elements.couleur.value.toLowerCase(), texture: fo.elements.texture.value }; V.doc.verres.push(o); U.verre = o.id; }
        else { o = V.verre(v.id); o.nom = nom; o.couleur = fo.elements.couleur.value.toLowerCase(); o.texture = fo.elements.texture.value; }
        V.change(false);
      }
    });
  }

  function dlgPalette(p, nomFichier) {
    U.dialogue({
      titre: 'Prendre les verres d\'une palette', ok: 'Prendre ces couleurs',
      html: '<p>« ' + echapper(p.nom || nomFichier) + ' » : ' + p.couleurs.length + (p.couleurs.length > 1 ? ' couleurs.' : ' couleur.') + '</p>' +
        '<p class="nuancier">' + p.couleurs.map(function (c) { return '<i style="background:' + c + '" title="' + c + '"></i>'; }).join('') + '</p>' +
        '<p class="rang"><label><input type="radio" name="mode" value="remplacer" checked> Remplacer les verres de l\'atelier : chaque pièce prend la couleur la plus proche</label></p>' +
        '<p class="rang"><label><input type="radio" name="mode" value="ajouter"> Les ajouter aux verres de l\'atelier</label></p>' +
        '<p class="note">Chaque couleur devient un verre ; sa texture est choisie selon sa clarté, et se change ensuite par « Modifier ».</p>',
      action: function (fo) {
        var garder = fo.elements.mode.value === 'ajouter', n;
        U.finirChaine();
        V.marquer();
        n = V.appliquerPalette(p, garder);
        if (!garder) U.verre = V.doc.verres[0].id;
        V.change(false);
        U.dire(n + (n > 1 ? ' verres pris' : ' verre pris') + ' de la palette' + (garder ? '.' : ' : le vitrail en prend les couleurs.'));
      }
    });
  }

  function dlgRegles() {
    var r = V.doc.regles;
    function ligne(nom, libelle, unite, pas, aide) { return '<tr><td><label for="r-' + nom + '">' + libelle + '</label></td><td><input type="number" id="r-' + nom + '" name="' + nom + '" step="' + pas + '" value="' + r[nom] + '"> ' + unite + '</td><td class="note">' + aide + '</td></tr>'; }
    U.dialogue({
      titre: 'Règles de coupe', ok: 'Appliquer',
      html: '<table class="regles">' +
        ligne('aireMin', 'Pièce plus petite que', 'cm²', 0.5, 'trop petite pour la tenir sous le plomb') +
        ligne('angleMin', 'Pointe plus fermée que', '°', 1, 'la pointe casse à la coupe ou au sertissage') +
        ligne('rentrant', 'Angle rentrant au-delà de', '°', 1, 'la coupe au diamant file tout droit : un coin rentrant fend la pièce') +
        ligne('creux', 'Creux plus profond que', '× l\'ouverture', 0.05, 'une courbe rentrante serrée se gruge mal') +
        ligne('rapportMax', 'Pièce plus longue que', 'fois sa largeur', 0.5, 'une bande trop étroite casse en la manipulant') +
        ligne('largeurMin', 'Bande plus étroite que', 'mm', 1, 'compté pour les pièces allongées') +
        '</table><p class="rang"><label><input type="checkbox" name="defaut"> Revenir aux réglages d\'atelier</label></p>' +
        '<p class="note">Ce sont des avertissements : le crayon gras les marque sur la table et dans la liste, rien n\'est interdit.</p>',
      action: function (fo) {
        var o = {}, k, v;
        for (k in G.REGLES) {
          v = fo.elements.defaut.checked ? G.REGLES[k] : nombre(fo.elements[k].value);
          if (v === null || v < 0) return 'Chaque seuil doit être un nombre positif.';
          o[k] = v;
        }
        V.marquer(); V.doc.regles = o; V.change(false);
      }
    });
  }

  // ---------- Ouverture ----------
  var attendPalette = false;
  function ouvrir(fichier, palette) {
    var l = new FileReader();
    l.onerror = function () { U.alerte('Ouverture impossible', 'Le fichier n\'a pas pu être lu.'); };
    l.onload = function () {
      var o = null, p;
      try { o = JSON.parse(l.result); } catch (e) { o = null; }
      try {
        if (o && o.format === 'vitrail') {
          if (palette) throw new Error('Ce fichier est un projet Vitrail, pas une palette : ouvre-le par « Ouvrir un projet ».');
          V.depuisProjet(o);
          U.choisir(null); U.finirChaine(); U.ajuster();
          U.dire('Projet « ' + fichier.name + ' » ouvert.');
          return;
        }
        p = V.lirePalette(l.result);
        dlgPalette(p, fichier.name.replace(/\.[^.]*$/, ''));
      } catch (err) {
        U.alerte('Ouverture impossible', err.message || 'Ce fichier n\'est ni un projet Vitrail ni une palette.');
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
      localStorage.setItem(CLE, JSON.stringify(V.versProjet()));
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
      V.depuisProjet(JSON.parse(t));
      return true;
    } catch (err) { return false; }
  }

  // ---------- Actions ----------
  function choisie() {
    var f = U.pieceChoisie();
    if (!f) U.dire('Choisis d\'abord une pièce : un clic dessus avec l\'outil Verre ou Nœud.');
    return f;
  }

  var ACTIONS = {
    nouveau: dlgNouveau,
    ouvrir: function () { attendPalette = false; $('#fichier').click(); },
    ouvrirPalette: function () { attendPalette = true; $('#fichier').click(); },
    enregistrer: function () { telecharger(new Blob([JSON.stringify(V.versProjet())], { type: 'application/json' }), base() + '.json'); },
    expSvg: function () { telecharger(new Blob([V.svg()], { type: 'image/svg+xml' }), base() + '.svg'); },
    expPng: dlgPng,
    expCalibre: function () {
      telecharger(new Blob([V.calibre()], { type: 'image/svg+xml' }), base() + '-calibre.svg');
      U.dire('Calibre téléchargé : imprime-le à 100 %, et vérifie la règle de 10 cm avant de découper.');
    },
    exemple: function () { V.marquer(); V.exemple(true); U.choisir(null); U.ajuster(); U.dire('Vitrail d\'exemple : une lancette à la fleur. Change un verre, déplace un nœud, coupe une pièce.'); },
    generer: dlgGenerer,
    contour: function () { U.choisirOutil('contour'); U.dire('Trace le contour du panneau d\'un seul geste sur la table.'); },
    regles: dlgRegles,
    plombsTous: function () {
      var l = V.doc.plomb, n = 0;
      V.marquer();
      V.doc.plombs.forEach(function (e) { if (!e.bord && e.l !== l) { e.l = l; n++; } });
      if (!n) { V.annulerMarque(); U.dire('Tous les plombs font déjà ' + l + ' mm.'); return; }
      V.change(false); U.dire(n + ' plombs passés à ' + l + ' mm.');
    },
    toutRetirer: function () { V.marquer(); G.bordure(V.doc); V.doc.pieces = []; V.change(false); U.dire('Il ne reste que la bordure. Ctrl+Z ramène les plombs.'); },

    annuler: function () { if (!V.annuler()) U.dire('Rien à annuler.'); },
    retablir: function () { if (!V.retablir()) U.dire('Rien à rétablir.'); },
    vider: function () { var f = choisie(); if (f && f.verre) { V.marquer(); V.vitrer(f, 0); V.change(false); U.dire('Pièce ' + f.numero + ' sans verre.'); } },
    viderTout: function () { if (!V.doc.pieces.length) return; V.marquer(); V.doc.pieces = []; V.change(false); U.dire('Plus aucune pièce n\'a de verre.'); },
    grisailleTout: function () { if (!V.doc.grisaille.length) { U.dire('Il n\'y a pas de grisaille.'); return; } V.marquer(); V.doc.grisaille = []; V.change(false); },
    grisailleFine: function () { U.largeurGrisaille = 0.8; cocher(); U.dire('Grisaille fine : 0,8 mm.'); },
    grisailleMoyenne: function () { U.largeurGrisaille = 1.5; cocher(); U.dire('Grisaille moyenne : 1,5 mm.'); },
    grisailleLarge: function () { U.largeurGrisaille = 3; cocher(); U.dire('Grisaille large : 3 mm.'); },

    verreAjouter: function () { dlgVerre(null); },
    verreModifier: function () { var v = V.verre(U.verre); if (v) dlgVerre(v); },
    verreRetirer: function () {
      var v = V.verre(U.verre), n;
      if (!v) return;
      if (V.doc.verres.length < 2) { U.dire('Il faut garder au moins un verre.'); return; }
      n = V.calc.faces.filter(function (f) { return f.verre === v.id; }).length;
      V.marquer();
      V.doc.verres = V.doc.verres.filter(function (x) { return x !== v; });
      V.change(false);
      U.dire('« ' + v.nom + ' » retiré de l\'atelier' + (n ? ' : ' + n + (n > 1 ? ' pièces restent' : ' pièce reste') + ' sans verre.' : '.'));
    },

    jour: function () { U.choisirVue('jour'); cocher(); },
    atelier: function () { U.choisirVue('atelier'); cocher(); },
    carton: function () { U.choisirVue('carton'); cocher(); },
    reglesVoir: function () { U.regles = !U.regles; U.rafraichir(); cocher(); },
    ajuster: function () { U.ajuster(); },
    zoomPlus: function () { U.zoomPas(1); },
    zoomMoins: function () { U.zoomPas(-1); },
    aide: aide
  };

  // Ce qui ne touche qu'à la vue n'interrompt pas une ligne de plomb en cours de tracé.
  var VUES = { ajuster: 1, zoomPlus: 1, zoomMoins: 1, jour: 1, atelier: 1, carton: 1, reglesVoir: 1, aide: 1, grisailleFine: 1, grisailleMoyenne: 1, grisailleLarge: 1 };
  function agir(nom) {
    if (nom.indexOf('outil:') === 0) { U.choisirOutil(nom.slice(6)); return; }
    if (U.gesteEnCours() || !ACTIONS[nom]) return;
    if (!VUES[nom]) U.finirChaine();
    ACTIONS[nom]();
  }
  U.agir = agir;

  // ---------- Menus ----------
  var MENUS = [
    { titre: 'Fichier', items: [['nouveau', 'Nouveau panneau…'], ['ouvrir', 'Ouvrir un projet ou une palette…', 'Ctrl+O'], ['enregistrer', 'Enregistrer le projet', 'Ctrl+S'], null,
      ['expSvg', 'Exporter en SVG'], ['expPng', 'Exporter l\'image en PNG…'], ['expCalibre', 'Exporter le calibre (patron de coupe)'], null,
      ['exemple', 'Vitrail d\'exemple']] },
    { titre: 'Édition', items: [['annuler', 'Annuler', 'Ctrl+Z'], ['retablir', 'Rétablir', 'Ctrl+Y'], null, ['vider', 'Retirer le verre de la pièce', 'Suppr'], ['viderTout', 'Retirer tous les verres'], null,
      ['grisailleFine', 'Grisaille fine'], ['grisailleMoyenne', 'Grisaille moyenne'], ['grisailleLarge', 'Grisaille large'], ['grisailleTout', 'Effacer toute la grisaille']] },
    { titre: 'Panneau', items: [['generer', 'Générer un réseau de plombs…'], ['contour', 'Tracer le contour à la main'], null, ['plombsTous', 'Mettre tous les plombs à la largeur choisie'], ['toutRetirer', 'Retirer tous les plombs'], null, ['regles', 'Règles de coupe…']] },
    { titre: 'Verres', items: [['ouvrirPalette', 'Prendre les verres d\'une palette…'], null, ['verreAjouter', 'Ajouter un verre…'], ['verreModifier', 'Modifier le verre choisi…'], ['verreRetirer', 'Retirer le verre choisi de l\'atelier']] },
    { titre: 'Vue', items: [['jour', 'Table allumée', 'J'], ['atelier', 'Table éteinte, côté atelier', 'A'], ['carton', 'Carton numéroté', 'N'], null,
      ['reglesVoir', 'Marquer les règles de coupe', 'R'], null, ['ajuster', 'Voir en entier', '0'], ['zoomPlus', 'Zoom avant', '+'], ['zoomMoins', 'Zoom arrière', '−']] },
    { titre: 'Aide', items: [['aide', 'Mode d\'emploi et raccourcis', 'F1']] }
  ];

  function menuOuvert() { return !!document.querySelector('.menu-titre.ouvert'); }
  function fermerMenus() {
    var o = document.querySelectorAll('.menu-titre.ouvert'), i;
    for (i = 0; i < o.length; i++) { o[i].classList.remove('ouvert'); o[i].setAttribute('aria-expanded', 'false'); o[i].nextElementSibling.hidden = true; }
    return o.length > 0;
  }
  function ouvrirMenu(titre) {
    fermerMenus();
    titre.classList.add('ouvert'); titre.setAttribute('aria-expanded', 'true'); titre.nextElementSibling.hidden = false;
  }
  function cocher() {
    var c = { jour: U.vue === 'jour', atelier: U.vue === 'atelier', carton: U.vue === 'carton', reglesVoir: U.regles, grisailleFine: U.largeurGrisaille === 0.8, grisailleMoyenne: U.largeurGrisaille === 1.5, grisailleLarge: U.largeurGrisaille === 3 }, k, els, i;
    for (k in c) { els = document.querySelectorAll('.menu-liste [data-act="' + k + '"]'); for (i = 0; i < els.length; i++) els[i].classList.toggle('coche', c[k]); }
  }
  function initMenus() {
    var z = $('#menus');
    z.innerHTML = MENUS.map(function (m) {
      return '<div class="menu"><button type="button" class="menu-titre" aria-haspopup="true" aria-expanded="false">' + m.titre + '</button><div class="menu-liste" hidden>' + m.items.map(function (it) {
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
    var r = V.doc.regles;
    U.dialogue({
      titre: 'Vitrail : composer un panneau qu\'on peut couper',
      html: '<div class="aide"><div><h3>Comme à l\'atelier</h3><ol>' +
        '<li><b>Le panneau.</b> Choisis sa forme et sa taille réelle à droite. Le plomb de bordure le ceinture.</li>' +
        '<li><b>Les plombs.</b> Trace-les droits ou courbes : chaque plomb qui va d\'un bord à un autre partage une pièce en deux. Les pièces se calculent seules.</li>' +
        '<li><b>Les verres.</b> Choisis un verre (ou son chiffre) et clique les pièces. Une palette du site s\'ouvre comme jeu de verres.</li>' +
        '<li><b>Les règles.</b> Le crayon gras marque ce qui se coupera mal. Retouche, ou passe outre : ce ne sont que des avertissements.</li>' +
        '<li><b>Le calibre.</b> Exporte le patron de coupe numéroté, imprime-le à 100 % et découpe-le aux ciseaux à calibre.</li></ol>' +
        '<h3>Les règles de coupe</h3><p class="note">Pièce de moins de ' + V.fr(r.aireMin) + ' cm², pointe de moins de ' + r.angleMin + '°, angle rentrant au-delà de ' + r.rentrant + '°, creux plus profond que ' + V.fr(r.creux) + ' fois son ouverture, pièce plus longue que ' + V.fr(r.rapportMax) + ' fois sa largeur ou bande de moins de ' + r.largeurMin + ' mm, plomb qui ne rejoint rien, pièce percée.</p>' +
        '<p><button type="button" class="btn" data-act="regles">Régler les seuils…</button></p></div>' +
        '<div><h3>Partout</h3>' + table([['Molette', 'Zoom sur le curseur'], ['Espace ou clic milieu', 'Déplacer la vue'], ['0', 'Voir en entier'], ['1 à 9', 'Choisir un verre'], ['J A N', 'Table allumée, éteinte, carton'], ['R', 'Marquer les règles de coupe'], ['Ctrl+Z, Ctrl+Y', 'Annuler, rétablir'], ['Ctrl+S, Ctrl+O', 'Enregistrer, ouvrir'], ['Échap', 'Finir la ligne, lâcher la pièce']]) +
        '<h3>Outils</h3>' + table([['L', 'Plomb droit (Maj : 15°, Alt : sans aimant)'], ['C', 'Plomb courbe'], ['V', 'Nœud : déplacer, courber, souder'], ['X', 'Couper un plomb'], ['E', 'Effacer'], ['B', 'Verre (Maj : tout un verre, Alt : pipette)'], ['I', 'Pipette'], ['G', 'Grisaille'], ['H', 'Main']]) + '</div>' +
        '<div><h3>Sur la table</h3>' + table([['Entrée', 'Finir la ligne de plomb'], ['Suppr', 'Retirer le verre de la pièce'], ['Cercle rouge', 'Coin fautif : pointe ou angle rentrant'], ['Tirets rouges', 'Pièce fautive tout entière'], ['Croix rouge', 'Plomb qui ne rejoint rien'], ['Hachures', 'Pièce encore sans verre']]) +
        '<p class="note">Les plombs s\'accrochent entre eux : un plomb qui en croise un autre le coupe, et les deux se soudent au croisement. Le carton numéroté (N) montre les numéros du calibre.</p></div></div>'
    });
  }

  // ---------- Clavier ----------
  function touche(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, ctrl = e.ctrlKey || e.metaKey, cible = e.target, tag = cible.tagName, chiffre = /^(?:Digit|Numpad)([0-9])$/.exec(e.code), o, i;
    var saisie = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && cible.type !== 'checkbox' && cible.type !== 'radio' && cible.type !== 'range');
    if (k === 'Escape') {
      if (U.fenetreOuverte()) U.fermer();
      else if (fermerMenus()) return;
      else if (saisie) cible.blur();
      else if (U.outil === 'contour') { U.abandonnerGeste(); U.choisirOutil(U.avantContour || 'plomb'); U.dire('Contour abandonné.'); }
      else if (U.abandonnerGeste()) U.dire('Geste abandonné.');
      else if (!U.finirChaine()) U.choisir(null);
      return;
    }
    if (U.fenetreOuverte()) return;
    if (k === 'F1') { e.preventDefault(); agir('aide'); return; }
    // Dans un champ, Ctrl+Z et Ctrl+Y défont la frappe, pas le vitrail.
    if (ctrl && saisie && (k === 'z' || k === 'y')) return;
    if (ctrl && !e.altKey) {
      o = { z: e.shiftKey ? 'retablir' : 'annuler', y: 'retablir', s: 'enregistrer', o: 'ouvrir' }[k];
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
    if (chiffre && !e.shiftKey) {
      e.preventDefault();
      i = Number(chiffre[1]);
      if (!i) agir('ajuster');
      else if (V.doc.verres[i - 1]) { U.choisirVerre(V.doc.verres[i - 1].id); U.dire('Verre ' + i + ' : « ' + V.doc.verres[i - 1].nom + ' ».'); }
      return;
    }
    o = U.OUTILS.filter(function (x) { return x.touche === k; })[0];
    if (o) o = 'outil:' + o.id;
    else if (k === '+' || k === '=') o = 'zoomPlus';
    else if (k === '-') o = 'zoomMoins';
    else if (k === 'j') o = 'jour';
    else if (k === 'a') o = 'atelier';
    else if (k === 'n') o = 'carton';
    else if (k === 'r') o = 'reglesVoir';
    else if (k === 'Enter') { U.finirChaine(); e.preventDefault(); return; }
    else if (k === 'Delete' || k === 'Backspace') o = 'vider';
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
      if (this.files[0]) ouvrir(this.files[0], attendPalette);
      this.value = '';
    });
    $('#modal').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-fermer]')) U.fermer(); });
    $('#vues').addEventListener('click', function (e) { var b = e.target.closest('[data-vue]'); if (b) { U.choisirVue(b.dataset.vue); cocher(); } });
    document.addEventListener('keydown', touche);
    document.addEventListener('keyup', relache);
    window.addEventListener('blur', function () { U.espace = false; });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files[0] && !U.fenetreOuverte()) ouvrir(e.dataTransfer.files[0], false);
    });
    window.addEventListener('pagehide', function () { if (minuterie !== null) { clearTimeout(minuterie); sauver(); } });

    repris = reprendre();
    if (!repris) V.exemple();
    V.surChange = function () { U.rafraichir(); sauverBientot(); };
    U.verre = V.doc.verres[0].id;
    U.choisirVue('jour');
    U.choisirOutil('verre');
    U.rafraichir();
    U.ajuster();
    if (!repris) U.dire('Vitrail d\'exemple : choisis un verre à droite et clique une pièce, ou prends l\'outil Plomb (L) pour redécouper.');
  }

  init();
})();
