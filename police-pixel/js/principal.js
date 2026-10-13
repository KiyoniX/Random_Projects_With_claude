(function () {
  'use strict';

  var PP = window.PP, U = PP.ui;

  var DEMO_DEPART = 1;         // la police montrée à la première ouverture
  var POLICES_INTERFACE = [[1, 'PP Gaillarde'], [2, 'PP Gros-texte']];

  var $ = function (s) { return document.querySelector(s); };

  // ---------- Actions ----------
  var ACTIONS = {
    nouveau: function () { U.nouveau(); },
    ouvrir: function () { U.ouvrirProjet(); },
    enregistrer: function () { U.enregistrer(); U.propre = true; },
    importer: function () { U.importerPlanche(); },
    demo0: function () { U.demo(0); }, demo1: function () { U.demo(1); }, demo2: function () { U.demo(2); },
    annuler: function () { if (!U.avantHistorique() && !PP.annuler()) U.message('Rien à annuler.'); },
    retablir: function () { if (!U.avantHistorique() && !PP.retablir()) U.message('Rien à rétablir.'); },
    couper: function () { U.couper(); }, copier: function () { U.copier(); }, coller: function () { U.coller(); },
    toutSel: function () { U.toutSelectionner(); },
    effacer: function () { U.abandonner(); PP.effacer(PP.police.courant); },
    ajouter: function () { U.ajouter(); },
    dupliquer: function () { U.dupliquerVers(); },
    composer: function () { U.composer(); },
    composerAuto: function () {
      var code = PP.police.courant, d = PP.decomposition(code), r;
      if (!d) { U.composer(); return; }
      if (d.base === 0x131 && !PP.glyphe(0x131)) d.base = 0x69;
      U.deselectionner();
      r = PP.lier(code, d.base, d.accent);
      if (r) U.message(r);
    },
    detacher: function () { if (!PP.detacher(PP.police.courant)) U.message('Ce caractère n\'est pas composé.'); },
    composerTous: function () {
      U.deselectionner();
      var n = PP.composerManquants();
      U.message(n ? n + ' caractères accentués composés à partir de leur lettre et de leur accent.' : 'Rien à composer : dessine d\'abord les lettres de base et les accents (` ´ ˆ ¨ ¸).');
    },
    retirer: function () {
      var code = PP.police.courant;
      U.abandonner();
      if (PP.retirer(code)) U.message('« ' + PP.car(code) + ' » retiré de la police. Ctrl+Z pour le remettre.');
    },
    retournerH: function () { retourner('h'); }, retournerV: function () { retourner('v'); },
    gauche: function () { U.pousser(-1, 0); }, droite: function () { U.pousser(1, 0); }, haut: function () { U.pousser(0, -1); }, bas: function () { U.pousser(0, 1); },
    infos: function () { U.deselectionner(); U.infos(); },
    gras: function () { U.deselectionner(); PP.deriverGras(); U.message('Police épaissie d\'un pixel. Ctrl+Z pour revenir au maigre.'); },
    italique: function () { U.italique(); },
    contour: function () { U.deselectionner(); U.message(PP.deriverContour() ? 'Police réduite à son contour ; la hauteur gagne deux pixels.' : 'La police est trop haute pour gagner deux rangées (32 au plus).'); U.ajuster(); },
    ombre: function () { U.deselectionner(); U.message(PP.deriverOmbre() ? 'Police ombrée ; la hauteur gagne trois pixels.' : 'La police est trop haute pour gagner trois rangées (32 au plus).'); U.ajuster(); },
    expTtf: function () { U.exporter('ttf'); }, expWoff: function () { U.exporter('woff'); }, expCss: function () { U.exporter('css'); },
    expPlanche: function () { U.exporter('planche'); }, expBmfont: function () { U.exporter('bmfont'); }, expGrille: function () { U.exporter('grille'); },
    aide: function () { aide(); },
    zoomPlus: function () { U.zoomer(1); }, zoomMoins: function () { U.zoomer(-1); }, ajuster: function () { U.ajuster(); },
    allerA: function () { $('#allerA').focus(); },
    precedent: function () { voisin(-1); }, suivant: function () { voisin(1); },
    rangHaut: function () { rangee(-1); }, rangBas: function () { rangee(1); },
    poser: function () { U.deselectionner(); },
    supprimer: function () { if (!U.supprimer()) U.message('Aucune sélection. Pour vider le caractère : Édition > Effacer le caractère.'); }
  };

  function retourner(sens) {
    U.deselectionner();
    if (PP.retourner(PP.police.courant, sens)) PP.valider('Retourner');
    else U.message(PP.glyphe(PP.police.courant).comp ? 'Détache d\'abord la composition.' : 'Rien à retourner.');
  }

  U.agir = function (act) {
    if (ACTIONS[act]) ACTIONS[act]();
    else U.agirCrenage(act);
  };

  // Change de caractère ; le morceau en cours de déplacement est d'abord posé.
  U.aller = function (code) {
    if (!PP.glyphe(code)) return false;
    U.deselectionner();
    PP.aller(code);
    U.rafraichir();
    return true;
  };
  function voisin(pas) {
    var ordre = PP.ordre(), i = ordre.indexOf(PP.police.courant), n = i + pas;
    U.aller(ordre[PP.borne(n, 0, ordre.length - 1)]);
  }
  // Rangée du dessus ou du dessous, telle qu'on la voit dans la casse : chaque groupe commence une rangée,
  // on prend donc le cassetin de la rangée voisine le plus proche en colonne.
  function rangee(sens) {
    var actif = document.querySelector('#casse .cassetin.actif'), r, ecart = null, mieux = null, dx = 0;
    if (!actif) return;
    r = actif.getBoundingClientRect();
    document.querySelectorAll('#casse .cassetin').forEach(function (b) {
      var q = b.getBoundingClientRect(), dy = (q.top - r.top) * sens, d = Math.abs(q.left - r.left);
      if (dy < r.height / 2) return;
      if (ecart === null || dy < ecart - 1 || (Math.abs(dy - ecart) <= 1 && d < dx)) { ecart = dy; mieux = b; dx = d; }
    });
    if (mieux) U.aller(+mieux.dataset.code);
  }

  // ---------- Fiche du caractère et enseigne ----------
  function fiche() {
    var p = PP.police, code = p.courant, g = p.glyphes[code], a = PP.approches(code), encre = PP.encre(code), d = PP.decomposition(code), comp = $('#ficheComp'), blanc = PP.estBlanc(code);
    $('#ficheCar').textContent = blanc ? '␣' : PP.car(code);
    $('#ficheCode').textContent = PP.hexa(code);
    $('#fChasse').value = PP.avance(code); $('#fChasse').disabled = p.fixe || !!g.comp;
    $('#fGauche').value = encre ? a.g : ''; $('#fDroite').value = encre ? a.d : '';
    $('#fGauche').disabled = !encre || !!g.comp; $('#fDroite').disabled = !encre || !!g.comp || p.fixe;
    if (g.comp) {
      comp.innerHTML = '<span>Composé de <b>' + U.echapper(PP.car(g.comp.base)) + '</b> et de <b>' + U.echapper(PP.car(g.comp.accent)) + '</b>, accent décalé de ' + g.comp.dx + ', ' + (-g.comp.dy) + '</span>' +
        '<button type="button" class="btn mini" data-act="detacher" title="Garde le dessin tel quel et le rend indépendant de sa lettre de base">Détacher</button>';
    } else if (d && !encre && p.glyphes[d.accent] && (p.glyphes[d.base] || p.glyphes[0x69])) {
      comp.innerHTML = '<button type="button" class="btn mini fort" data-act="composerAuto">Composer avec ' + U.echapper(PP.car(d.base === 0x131 && !p.glyphes[0x131] ? 0x69 : d.base)) + ' et ' + U.echapper(PP.car(d.accent)) + '</button>';
    } else if (!blanc) {
      comp.innerHTML = '<button type="button" class="btn mini" data-act="composer" title="Faire de ce caractère la réunion d\'une lettre et d\'un accent">Composer…</button>' +
        '<button type="button" class="btn mini" data-act="dupliquer" title="Recopier ce dessin dans un autre caractère (Ctrl+D)">Dupliquer vers…</button>';
    } else comp.innerHTML = '<span>Un blanc n\'a pas de dessin : seule sa chasse compte.</span>';
  }

  function enseigne() {
    var p = PP.police, c = $('#enseigneNom'), e = Math.max(1, Math.floor(26 / p.h)), nom = p.nom + (PP.STYLES[p.style.toLowerCase()] && !p.gras && !p.italique ? '' : ' ' + p.style), r, g, x, y;
    if (!PP.codes(nom).every(PP.utilisable)) nom = PP.codes(nom).filter(PP.utilisable).map(PP.car).join('');
    r = PP.rendre(nom || '?', 0, 0);
    c.width = r.l * e; c.height = r.h * e;
    g = c.getContext('2d');
    g.fillStyle = U.TEINTES.papier;
    for (y = 0; y < r.h; y++) for (x = 0; x < r.l; x++) if (r.masque[y * r.l + x]) g.fillRect(x * e, y * e, e, e);
    $('#enseigneNote').textContent = p.h + ' px, ' + (p.fixe ? 'chasse fixe de ' + p.chasse : 'proportionnelle');
    document.title = p.nom + ' – Police Pixel';
  }

  U.rafraichir = function () {
    var h = PP.histEtat();
    U.redessiner();
    U.casse();
    fiche();
    enseigne();
    U.epreuve();
    $('#etatInfo').textContent = PP.ordre().filter(PP.utilisable).length + ' caractères prêts, ' + PP.paires().length + ' paires de crénage';
    document.querySelectorAll('[data-act=annuler]').forEach(function (b) { b.disabled = !h.avant; });
    document.querySelectorAll('[data-act=retablir]').forEach(function (b) { b.disabled = !h.apres; });
  };

  // ---------- Clavier ----------
  var TOUCHES = {
    'ctrl+z': 'annuler', 'ctrl+y': 'retablir', 'ctrl+shift+z': 'retablir', 'ctrl+c': 'copier', 'ctrl+x': 'couper', 'ctrl+v': 'coller', 'ctrl+a': 'toutSel',
    'ctrl+s': 'enregistrer', 'ctrl+o': 'ouvrir', 'ctrl+e': 'expTtf', 'ctrl+d': 'dupliquer',
    c: 'crayon', g: 'gomme', l: 'ligne', r: 'rect', p: 'pot', s: 'selection', m: 'main',
    h: 'retournerH', v: 'retournerV', '0': 'ajuster', 'à': 'ajuster', '+': 'zoomPlus', '=': 'zoomPlus', '-': 'zoomMoins',
    arrowleft: 'precedent', arrowright: 'suivant', arrowup: 'rangHaut', arrowdown: 'rangBas',
    'shift+arrowleft': 'gauche', 'shift+arrowright': 'droite', 'shift+arrowup': 'haut', 'shift+arrowdown': 'bas',
    tab: 'allerA', enter: 'poser', delete: 'supprimer', backspace: 'supprimer', f1: 'aide', '?': 'aide', 'shift+?': 'aide'
  };
  var OUTILS = { crayon: 1, gomme: 1, ligne: 1, rect: 1, pot: 1, selection: 1, main: 1 };

  function saisie(el) { return el && (el.tagName === 'INPUT' && el.type !== 'checkbox' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'); }

  function touche(e) {
    var k = e.key.toLowerCase(), combo, act;
    if (k === 'escape') {
      if (U.fenetreOuverte()) U.fermer();
      else if (fermerMenus()) return;
      else if (saisie(document.activeElement)) document.activeElement.blur();
      else U.abandonner();
      return;
    }
    if (U.fenetreOuverte() || saisie(document.activeElement)) return;
    if (k === ' ') {
      e.preventDefault();
      if (!U.espace) { U.espace = true; $('#scene').classList.add('main'); }
      return;
    }
    if (k === 'control' || k === 'shift' || k === 'alt' || k === 'meta' || k === 'altgraph') return;
    combo = ((e.ctrlKey || e.metaKey) ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '') + k;
    act = TOUCHES[combo] || (!e.ctrlKey && !e.metaKey && !e.altKey ? TOUCHES[k] : null);
    if (e.altKey && !e.ctrlKey) return;
    if (!act) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (OUTILS[act]) U.choisir(act); else U.agir(act);
  }
  function relache(e) {
    if (e.key !== ' ' || !U.espace) return;
    U.espace = false;
    $('#scene').classList.remove('main');
  }

  // ---------- Menus ----------
  var MENUS = [
    ['Fichier', [['nouveau', 'Nouvelle police…'], ['ouvrir', 'Ouvrir un projet…', 'Ctrl+O'], ['enregistrer', 'Enregistrer le projet', 'Ctrl+S'], null,
      ['importer', 'Importer une planche de caractères…'], null,
      ['demo0', 'Démonstration : Mignonne, 5 × 7 à chasse fixe'], ['demo1', 'Démonstration : Gaillarde, proportionnelle'], ['demo2', 'Démonstration : Gros-texte, à empattements']]],
    ['Édition', [['annuler', 'Annuler', 'Ctrl+Z'], ['retablir', 'Rétablir', 'Ctrl+Y'], null,
      ['couper', 'Couper', 'Ctrl+X'], ['copier', 'Copier', 'Ctrl+C'], ['coller', 'Coller', 'Ctrl+V'], ['toutSel', 'Sélectionner tout le dessin', 'Ctrl+A'], null,
      ['retournerH', 'Retourner gauche-droite', 'H'], ['retournerV', 'Retourner haut-bas', 'V'], ['effacer', 'Effacer le caractère']]],
    ['Caractère', [['ajouter', 'Ajouter des caractères…'], ['dupliquer', 'Dupliquer vers…', 'Ctrl+D'], ['retirer', 'Retirer de la police'], null,
      ['composer', 'Composer avec une lettre et un accent…'], ['detacher', 'Détacher la composition'], ['composerTous', 'Composer tous les accentués vides'], null,
      ['allerA', 'Aller à un caractère', 'Tab']]],
    ['Police', [['infos', 'Informations et repères…'], null,
      ['gras', 'Variante grasse'], ['italique', 'Variante italique…'], ['contour', 'Variante en contour'], ['ombre', 'Variante ombrée'], null,
      ['kDetecter', 'Détecter les paires à créner']]],
    ['Exporter', [['expTtf', 'Police TrueType (.ttf)', 'Ctrl+E'], ['expWoff', 'Police web (.woff)'], ['expCss', 'Extrait CSS @font-face…'], null,
      ['expPlanche', 'Planche PNG et positions JSON'], ['expBmfont', 'BMFont (.fnt et PNG)'], ['expGrille', 'Planche en grille (PNG)']]],
    ['Aide', [['aide', 'Mode d\'emploi et raccourcis', 'F1']]]
  ];

  function fermerMenus() {
    var o = document.querySelector('.menu-titre.ouvert');
    if (!o) return false;
    o.classList.remove('ouvert');
    o.nextElementSibling.hidden = true;
    return true;
  }
  function menus() {
    $('#menus').innerHTML = MENUS.map(function (m) {
      return '<div class="menu"><button type="button" class="menu-titre">' + m[0] + '</button><div class="menu-liste" hidden>' + m[1].map(function (l) {
        return l ? '<button type="button" data-act="' + l[0] + '"><span>' + l[1] + '</span><kbd>' + (l[2] || '') + '</kbd></button>' : '<hr>';
      }).join('') + '</div></div>';
    }).join('');
    $('#menus').addEventListener('click', function (e) {
      var t = e.target.closest('.menu-titre'), liste;
      if (!t) return;
      liste = t.nextElementSibling;
      if (liste.hidden) { fermerMenus(); liste.hidden = false; t.classList.add('ouvert'); } else fermerMenus();
      e.stopPropagation();
    });
    $('#menus').addEventListener('mouseover', function (e) {
      var t = e.target.closest('.menu-titre');
      if (t && document.querySelector('.menu-titre.ouvert') && !t.classList.contains('ouvert')) { fermerMenus(); t.nextElementSibling.hidden = false; t.classList.add('ouvert'); }
    });
  }

  // ---------- Aide ----------
  function aide() {
    function table(lignes) { return '<table>' + lignes.map(function (l) { return '<tr><td><kbd>' + l[0] + '</kbd></td><td>' + l[1] + '</td></tr>'; }).join('') + '</table>'; }
    U.dialogue({
      titre: 'Mode d\'emploi',
      large: true,
      html: '<div class="aide"><div>' +
        '<h3>Dessiner</h3>' + table([['Clic gauche', 'pose un pixel'], ['Clic droit', 'efface'], ['C G L R P S', 'crayon, gomme, ligne, rectangle, remplissage, sélection'],
          ['Maj + flèches', 'déplace le dessin, la sélection ou l\'accent d\'un pixel'], ['H, V', 'retourne gauche-droite, haut-bas'], ['Ctrl + Z, Ctrl + Y', 'annule, rétablit'],
          ['Ctrl + C, X, V', 'copie, coupe, colle (aussi d\'un caractère à l\'autre)'], ['Entrée', 'pose le morceau déplacé'], ['Échap', 'abandonne le geste en cours']]) +
        '<h3>Voir</h3>' + table([['Molette', 'zoom centré sur le pointeur'], ['+, −, 0', 'agrandit, réduit, ajuste à la vue'], ['Espace + glisser', 'déplace la vue (ou bouton du milieu, ou M)']]) +
        '</div><div>' +
        '<h3>Parcourir la casse</h3>' + table([['← →', 'caractère précédent, suivant'], ['↑ ↓', 'rangée du dessus, du dessous'], ['Tab, puis un caractère', 'y va directement'], ['Ctrl + D', 'duplique le caractère vers un autre']]) +
        '<h3>Fichiers</h3>' + table([['Ctrl + S', 'enregistre le projet (.police.json)'], ['Ctrl + O', 'ouvre un projet'], ['Ctrl + E', 'exporte la police en TrueType']]) +
        '<h3>Les repères</h3><p>La case de papier a la largeur de la chasse : tire les deux carrés bleus de son bord droit pour la changer. Le trait rouge est la ligne de base ; ce qui descend dessous est un jambage. ' +
        'On peut dessiner hors de la case : le caractère débordera alors sur ses voisins.</p>' +
        '</div><div class="texte">' +
        '<h3>Les accents</h3><p>Dessine une fois les accents du groupe « Accents » (<kbd>`</kbd> <kbd>´</kbd> <kbd>ˆ</kbd> <kbd>¨</kbd> <kbd>¸</kbd>) à leur place au-dessus d\'un bas de casse, puis <i>Caractère &gt; Composer tous les accentués vides</i>. ' +
        'Chaque caractère composé reste lié à sa lettre et à son accent : retouche le « e », tous ses dérivés suivent. L\'accent, en bleu, se règle avec Maj + flèches ; « Détacher » fige le dessin.</p>' +
        '<h3>L\'épreuve et le crénage</h3><p>L\'épreuve compose ton texte en direct, pixels nets, de ×1 à ×4. Coche « Composer avec la police exportée » pour voir le fichier TrueType lui-même au travail. ' +
        'Dans l\'onglet Crénage, tape une paire (AV, To, L’) et resserre-la, ou laisse l\'outil proposer les paires dont le blanc est trop grand.</p>' +
        '<h3>Utiliser la police</h3><p>Le fichier .ttf s\'installe par un double-clic dans Windows. Il est net à ' + PP.police.h + ' px et à ses multiples (' + PP.police.h * 2 + ', ' + PP.police.h * 3 + '…) ; ' +
        'en points dans un traitement de texte, cela fait ' + (PP.police.h * 0.75) + ' pt, ' + (PP.police.h * 1.5) + ' pt… à 100 % de zoom. Pour un jeu, préfère la planche PNG avec son JSON ou le format BMFont.</p>' +
        '</div></div>',
      boutons: [{ nom: 'Fermer', fort: true }]
    });
  }

  // ---------- Démarrage ----------
  // L'interface est composée avec deux des polices de démonstration, fabriquées par l'exportateur lui-même.
  function policesInterface() {
    if (!window.FontFace || !document.fonts) return Promise.resolve();
    return Promise.all(POLICES_INTERFACE.map(function (q) {
      var ttf = PP.avec(PP.demo(q[0]), function () { return PP.ttf(); });
      return new FontFace(q[1], ttf.buffer).load().then(function (face) { document.fonts.add(face); });
    })).then(function () {
      document.documentElement.classList.add('polices');
      U.police = '"PP Gaillarde", "Segoe UI", sans-serif';
    }, function () { /* le navigateur garde sa police par défaut */ });
  }

  function demarrer() {
    var p = U.restaurer();
    U.lireReglages();
    menus();
    U.initVue(); U.initCasse(); U.initEpreuve(); U.initFichiers();
    PP.surChange = function (nom) {
      if (nom !== 'Ouvrir') { U.propre = false; U.sauverBientot(); }
      U.rafraichir();
    };
    U.surRetouche = function () { U.casseRetouche(); U.epreuve(); };
    U.propre = !p;
    PP.ouvrir(p || PP.demo(DEMO_DEPART));
    U.propre = !p;
    U.ajuster();

    document.addEventListener('keydown', touche);
    document.addEventListener('keyup', relache);
    window.addEventListener('blur', function () { U.espace = false; $('#scene').classList.remove('main'); });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!e.target.closest('.menu-titre')) fermerMenus();
      if (!b || b.disabled) return;
      if (b.closest('.menu-liste') || b.closest('.outils')) b.blur();
      U.agir(b.dataset.act);
    });
    $('#fChasse').addEventListener('change', function () { U.deselectionner(); PP.reglerAvance(PP.police.courant, this.value); PP.valider('Régler la chasse'); });
    function approches() {
      U.deselectionner();
      if (PP.reglerApproches(PP.police.courant, $('#fGauche').value, $('#fDroite').value)) PP.valider('Régler les approches');
      else { U.message('Le dessin ne peut pas aller plus loin.'); U.rafraichir(); }
    }
    $('#fGauche').addEventListener('change', approches);
    $('#fDroite').addEventListener('change', approches);
    window.addEventListener('beforeunload', function () { U.deselectionner(); });
    document.body.classList.add('pret');
  }

  policesInterface().then(demarrer);
})();
