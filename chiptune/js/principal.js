(function () {
  'use strict';

  var P = window.Puce, el = P.el;
  var DELAI_SAUVEGARDE = 700;
  var LONGUEURS = [8, 12, 16, 24, 32, 48, 64, 96, 128];

  function $(id) { return document.getElementById(id); }

  var mode = 'morceau';
  var sale = true;                 // la grille doit être redessinée
  var derniereLigne = -2, dernierOrdre = -2;
  var scopes = [], boutonsMuet = [], boutonsSolo = [];
  var editInstr, editBruit, piano;
  var minuterieSauvegarde = 0;
  var ondeBruit = null;

  // ---------- Messages ----------
  function dire(texte) { $('message').textContent = texte; }

  function info() {
    var c = P.cur, m = P.motif(), col = m.voies[c.voie], n = col.n[c.ligne], e = col.e[c.ligne], t, x;
    if (mode === 'instruments') {
      x = P.projet.instruments[P.instr - 1];
      $('info').textContent = 'Instrument ' + P.instr + ' sur ' + P.projet.instruments.length + ', pour la voix ' + P.NOMS_TYPES[x.type].toLowerCase() + ' ; le clavier le joue';
      return;
    }
    if (mode === 'bruitages') {
      x = P.projet.bruitages[P.bruit];
      $('info').textContent = x && ondeBruit ? x.nom + ' : ' + (ondeBruit.length / 44100).toFixed(2).replace('.', ',') + ' s sur la voix ' + P.NOMS_TYPES[x.type].toLowerCase() : 'Aucun bruitage';
      return;
    }
    t = P.NOMS_VOIES[c.voie] + ', ligne ' + c.ligne + ' sur ' + m.pas;
    if (c.col >= 4) t += e ? ' : ' + P.EFFETS[String.fromCharCode(e)] : ' : effets A M D P V R C';
    else if (n && n !== P.NOTE_OFF) t += ' : ' + P.nomNoteFr(n) + (c.voie === 3 ? '' : ', ' + P.frequence(n).toFixed(1) + ' Hz') + (c.voie !== 3 && !P.dansGamme(n) ? ', hors de la gamme' : '');
    else if (n === P.NOTE_OFF) t += ' : relâche';
    $('info').textContent = t;
  }

  // ---------- Remise à jour de l'interface ----------
  function options(sel, liste, valeur) {
    sel.textContent = '';
    liste.forEach(function (o) { sel.appendChild(el('option', { value: o[0], texte: o[1] })); });
    sel.value = valeur;
  }

  function majFacade() {
    var p = P.projet, h = P.histTailles();
    if (document.activeElement !== $('r-tempo')) $('r-tempo').value = p.tempo;
    if (document.activeElement !== $('f-titre')) $('f-titre').value = p.titre;
    $('r-ppt').value = p.pasParTemps;
    $('r-swing').value = Math.round(p.swing * 100);
    $('o-swing').textContent = p.swing ? Math.round(p.swing * 100) + ' %' : 'droit';
    $('r-tonique').value = p.tonique;
    $('r-gamme').value = P.gamme().id;
    $('r-contrainte').checked = p.contrainte;
    $('b-annuler').disabled = !h[0];
    $('b-retablir').disabled = !h[1];
    document.title = p.titre + ', La Puce à l\'oreille';
  }

  function majPupitre() {
    var p = P.projet, m = P.motif(), a = p.arrangement[P.cur.ordre];
    options($('a-motif'), p.motifs.map(function (x, i) { return [i, (i + 1) + '. ' + x.nom]; }), P.cur.motif);
    if (document.activeElement !== $('a-nom')) $('a-nom').value = m.nom;
    options($('a-pas'), LONGUEURS.concat(LONGUEURS.indexOf(m.pas) < 0 ? [m.pas] : []).sort(function (x, y) { return x - y; }).map(function (n) { return [n, n + ' pas']; }), m.pas);
    $('a-fois').textContent = a.fois + ' fois';
    options($('s-instr'), p.instruments.map(function (x, i) { return [i + 1, (i < 9 ? '0' : '') + (i + 1) + '  ' + x.nom + ' (' + P.NOMS_TYPES[x.type].toLowerCase() + ')']; }), P.instr);
    $('s-octave').textContent = P.octave;
    $('i-octave').textContent = P.octave;
    $('s-avance').value = P.pasEdition;
    for (var v = 0; v < 5; v++) {
      boutonsMuet[v].setAttribute('aria-pressed', P.muets[v] ? 'true' : 'false');
      boutonsSolo[v].setAttribute('aria-pressed', P.solos[v] ? 'true' : 'false');
    }
  }

  function majListe(ol, objets, courant, choisir) {
    ol.textContent = '';
    objets.forEach(function (x, i) {
      var b = el('button', { type: 'button', 'aria-current': i === courant ? 'true' : 'false' }, [el('span', { classe: 'num', texte: (i < 9 ? '0' : '') + (i + 1) }), el('span', { texte: x.nom || 'sans nom' }), el('small', { texte: P.NOMS_TYPES[x.type].toLowerCase() })]);
      b.addEventListener('click', function () { choisir(i); });
      ol.appendChild(el('li', {}, [b]));
    });
  }

  function majAteliers() {
    var p = P.projet;
    if (mode === 'instruments') {
      majListe($('i-liste'), p.instruments, P.instr - 1, function (i) { P.instr = i + 1; P.signaler('choix'); essayer(); });
      editInstr.maj();
    }
    if (mode === 'bruitages') {
      majListe($('b-liste'), p.bruitages, P.bruit, function (i) { P.bruit = i; P.signaler('choix'); ecouterBruit(); });
      editBruit.maj();
      tracerBruit();
    }
  }

  function tracerBruit() {
    var b = P.projet.bruitages[P.bruit];
    ondeBruit = b ? window.Chiptune.rendreBruitage(b, 44100) : new Float32Array(1);
    P.dessinerOnde($('b-onde'), ondeBruit);
  }

  function majTout(quoi) {
    sale = true;
    if (quoi === 'vue') return;
    if (quoi === 'cellule') { info(); majFacade(); return; }
    majFacade(); majPupitre(); majAteliers(); info();
    majPiano();
  }

  var clePiano = '';
  function majPiano() {
    var p = P.projet, c = [P.octave, p.tonique, p.gamme, JSON.stringify(P.lettresPiano)].join('|');
    if (c === clePiano) return;
    clePiano = c;
    piano.construire();
  }

  // ---------- Sauvegarde automatique ----------
  function planifierSauvegarde(quoi) {
    if (quoi === 'curseur' || quoi === 'vue' || quoi === 'clavier' || quoi === 'choix') return;
    clearTimeout(minuterieSauvegarde);
    minuterieSauvegarde = setTimeout(P.sauverAuto, DELAI_SAUVEGARDE);
  }

  // ---------- Modes ----------
  function choisirMode(m) {
    mode = m;
    ['morceau', 'instruments', 'bruitages'].forEach(function (x) {
      $('vue-' + x).hidden = x !== m;
      $('mode-' + x).setAttribute('aria-selected', x === m ? 'true' : 'false');
    });
    majTout('mode');
    caler();
    if (m === 'morceau') $('grille').focus();
  }

  // ---------- Lecture ----------
  function lancer(quoi) {
    if (!P.lire(quoi)) { dire('Ce navigateur ne sait pas produire de son (Web Audio absente).'); return; }
    dire(quoi === 'motif' ? 'Lecture du motif « ' + P.motif().nom + ' » en boucle.' : 'Lecture du morceau depuis la section ' + (P.cur.ordre + 1) + '.');
    majTransport();
  }
  function stopper() { P.arreter(); dire('Arrêt.'); majTransport(); sale = true; }
  function majTransport() {
    $('b-lire').setAttribute('aria-pressed', P.etatLecture === 'morceau' ? 'true' : 'false');
    $('b-motif').setAttribute('aria-pressed', P.etatLecture === 'motif' ? 'true' : 'false');
    document.body.classList.toggle('joue', !!P.etatLecture);
  }

  function essayer() {
    var x = P.projet.instruments[P.instr - 1], n = x.noteFixe || (P.octave + 1) * 12 + 12;
    P.noteClavier(n, x);
    setTimeout(function () { P.finNoteClavier(n); }, 260);
  }
  function ecouterBruit() {
    var b = P.projet.bruitages[P.bruit];
    if (b) P.jouerBruitage(b);
  }

  // ---------- Boucle d'affichage ----------
  function image() {
    var pos = P.positionLecture(), ligne = pos ? pos.ligne : -1, ordre = pos ? pos.ordre : -1, v;
    if (mode === 'morceau') {
      // la vue suit la section jouée
      if (pos && P.suivre && P.etatLecture === 'morceau' && pos.ordre >= 0 && pos.ordre !== P.cur.ordre && pos.ordre !== dernierOrdre) {
        P.cur.ordre = pos.ordre; P.cur.motif = pos.motif; P.sel = null; P.recadrer();
        majPupitre(); info(); sale = true;
      }
      if (sale || ligne !== derniereLigne || ordre !== dernierOrdre) {
        P.dessinerGrille($('grille'), pos);
        P.dessinerArrangement($('arr'), pos);
        sale = false; derniereLigne = ligne; dernierOrdre = ordre;
      }
      for (v = 0; v < 5; v++) P.dessinerScope(scopes[v], v);
    } else if (mode === 'instruments') {
      P.dessinerScope($('i-scope'), [0, 2, 3, 4][P.projet.instruments[P.instr - 1].type]);
    }
    requestAnimationFrame(image);
  }

  // Donne à la grille la largeur exacte de ses colonnes, en points entiers.
  function caler() {
    var d = window.devicePixelRatio || 1, l;
    P.initEcran();
    l = P.LARGEUR_GRILLE * P.ecran.unite() / d;
    $('grille').style.width = l + 'px';
    $('arr').style.width = l + 'px';
    $('arr').style.height = (3 * P.ecran.HL + 3) * P.ecran.unite() / d + 'px';
    sale = true;
    if (mode !== 'morceau') majAteliers();
  }

  // ---------- Clavier ----------
  function champTexte(c) {
    return c && (c.tagName === 'SELECT' || c.tagName === 'TEXTAREA' || (c.tagName === 'INPUT' && /^(text|number)$/.test(c.type)));
  }

  function touche(e) {
    var ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), cible = e.target, x;
    if (ctrl && !e.altKey && (k === 'z' || k === 'y')) {
      if (champTexte(cible) && cible.tagName !== 'SELECT') return;
      x = (k === 'y' || e.shiftKey) ? P.retablir() : P.annuler();
      dire(x ? ((k === 'y' || e.shiftKey) ? 'Rétabli : ' : 'Annulé : ') + x.toLowerCase() + '.' : (k === 'y' || e.shiftKey) ? 'Rien à rétablir.' : 'Rien à annuler.');
      e.preventDefault();
      return;
    }
    if (ctrl && k === 's') { dire(P.enregistrer()); e.preventDefault(); return; }
    if (champTexte(cible)) return;
    if (cible.tagName === 'INPUT' && (cible.type === 'checkbox' || /^(Arrow|Home|End|Page)/.test(e.key))) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (cible.tagName === 'BUTTON' || cible.tagName === 'SUMMARY') return;
      if (mode === 'bruitages') ecouterBruit();
      else if (P.etatLecture) stopper();
      else lancer(e.shiftKey ? 'motif' : 'morceau');
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && cible.tagName !== 'BUTTON' && cible.tagName !== 'SUMMARY' && cible.tagName !== 'INPUT') {
      if (P.etatLecture) stopper(); else lancer('motif');
      e.preventDefault();
      return;
    }
    if (mode === 'morceau') {
      if (e.key === 'Tab' && document.activeElement !== $('grille')) return;
      if (e.key === 'Escape' && !P.sel) { $('grille').blur(); return; }
      if (P.toucheGrille(e, dire)) e.preventDefault();
      return;
    }
    if (ctrl || e.altKey) return;
    if (mode === 'instruments') {
      if (P.jouerTouche(e, P.projet.instruments[P.instr - 1])) { piano.allumer(P.noteDeTouche(e.code), true); e.preventDefault(); }
    }
  }

  // ---------- Branchements ----------
  function brancher() {
    var i;
    $('mode-morceau').addEventListener('click', function () { choisirMode('morceau'); });
    $('mode-instruments').addEventListener('click', function () { choisirMode('instruments'); });
    $('mode-bruitages').addEventListener('click', function () { choisirMode('bruitages'); });

    $('b-lire').addEventListener('click', function () { if (P.etatLecture === 'morceau') stopper(); else lancer('morceau'); });
    $('b-motif').addEventListener('click', function () { if (P.etatLecture === 'motif') stopper(); else lancer('motif'); });
    $('b-stop').addEventListener('click', stopper);

    options($('r-ppt'), [1, 2, 3, 4, 6, 8].map(function (n) { return [n, n]; }), 4);
    options($('r-tonique'), P.NOTES_FR.map(function (n, k) { return [k, n]; }), 0);
    options($('r-gamme'), P.GAMMES.map(function (g) { return [g.id, g.nom]; }), 'majeure');
    options($('s-avance'), [0, 1, 2, 3, 4, 6, 8].map(function (n) { return [n, n ? n + ' pas' : 'sur place']; }), 1);
    $('r-tempo').addEventListener('change', function () {
      var t = P.borne(Math.round(Number($('r-tempo').value)) || 120, 40, 300);
      $('r-tempo').value = t; P.regler('tempo', t);
    });
    $('r-ppt').addEventListener('change', function () { P.regler('pasParTemps', parseInt($('r-ppt').value, 10)); });
    $('r-swing').addEventListener('input', function () { P.regler('swing', parseInt($('r-swing').value, 10) / 100); });
    $('r-tonique').addEventListener('change', function () { P.regler('tonique', parseInt($('r-tonique').value, 10)); });
    $('r-gamme').addEventListener('change', function () { P.regler('gamme', $('r-gamme').value); });
    $('r-contrainte').addEventListener('change', function () { P.regler('contrainte', $('r-contrainte').checked); });

    $('b-annuler').addEventListener('click', function () { var x = P.annuler(); dire(x ? 'Annulé : ' + x.toLowerCase() + '.' : 'Rien à annuler.'); });
    $('b-retablir').addEventListener('click', function () { var x = P.retablir(); dire(x ? 'Rétabli : ' + x.toLowerCase() + '.' : 'Rien à rétablir.'); });

    // menus : se referment après un choix ou un clic ailleurs
    document.addEventListener('click', function (e) {
      ['menu-fichier', 'menu-export'].forEach(function (id) {
        var d = $(id);
        if (d.open && (!d.contains(e.target) || (e.target.tagName === 'BUTTON' && e.target.id !== 'f-hasard'))) d.open = false;
      });
    });
    $('f-titre').addEventListener('input', function () { P.regler('titre', $('f-titre').value.slice(0, 40) || 'Sans titre'); });
    $('f-nouveau').addEventListener('click', function () { P.arreter(); majTransport(); P.ouvrir(P.projetVide()); dire('Nouveau morceau : la grille est vide, la banque d\'instruments est prête.'); });
    $('f-ouvrir').addEventListener('click', function () { $('fichier').value = ''; $('fichier').click(); });
    $('fichier').addEventListener('change', function () {
      var f = $('fichier').files[0];
      if (!f) return;
      P.arreter(); majTransport();
      P.ouvrirFichier(f, function (err) { dire(err ? 'Ouverture impossible. ' + err : 'Projet ouvert : ' + P.projet.titre + '.'); });
    });
    $('f-enregistrer').addEventListener('click', function () { dire(P.enregistrer()); });
    P.DEMOS.forEach(function (d) {
      var b = el('button', { type: 'button' }, [el('span', { texte: d.nom }), el('small', { texte: d.style })]);
      b.addEventListener('click', function () { P.arreter(); majTransport(); P.ouvrir(d.creer()); dire('Morceau fourni ouvert : ' + d.nom + ' (' + d.style + '). Espace pour l\'écouter.'); });
      $('f-demos').appendChild(b);
    });
    $('f-hasard').addEventListener('click', function () {
      var g = P.borne(Math.round(Number($('f-graine').value)) || 1, 1, 999999);
      P.arreter(); majTransport();
      P.ouvrir(P.aleatoire(g));
      dire('Morceau composé à partir de la graine ' + g + ' : ' + P.NOTES_FR[P.projet.tonique] + ' ' + P.gamme().nom + ', ' + P.projet.tempo + ' à la noire.');
      $('f-graine').value = g + 1;
    });

    ['morceau', 'boucle', 'motif', 'motif-boucle'].forEach(function (q) {
      $('x-' + q).addEventListener('click', function () { dire(P.exporterWav(q, $('x-normaliser').checked)); });
    });
    $('x-bruitages').addEventListener('click', function () { dire(P.exporterBruitsZip($('x-normaliser').checked)); });
    $('x-lecteur').addEventListener('click', function () { dire(P.exporterLecteur()); });

    // voix
    for (i = 0; i < 5; i++) (function (v) {
      var cv = el('canvas', { classe: 'lcd', 'aria-hidden': 'true' });
      var m = el('button', { type: 'button', classe: 'cran', texte: 'Muette', 'aria-pressed': 'false' });
      var s = el('button', { type: 'button', classe: 'cran', texte: 'Seule', 'aria-pressed': 'false' });
      m.addEventListener('click', function () { P.muets[v] = !P.muets[v]; P.majMuets(); majPupitre(); sale = true; });
      s.addEventListener('click', function () { P.solos[v] = !P.solos[v]; P.majMuets(); majPupitre(); sale = true; });
      scopes.push(cv); boutonsMuet.push(m); boutonsSolo.push(s);
      $('voix').appendChild(el('div', { classe: 'voie' }, [el('span', { classe: 'nomvoie', texte: P.NOMS_VOIES[v] }), cv, m, s]));
    })(i);

    // section et motif
    $('a-motif').addEventListener('change', function () { P.arrMotif(parseInt($('a-motif').value, 10)); });
    $('a-nom').addEventListener('input', function () { P.motifRenommer($('a-nom').value); });
    $('a-pas').addEventListener('change', function () { P.motifLongueur(parseInt($('a-pas').value, 10)); dire('Le motif fait maintenant ' + P.motif().pas + ' pas.'); });
    $('a-moins').addEventListener('click', function () { P.arrFois(-1); });
    $('a-plus').addEventListener('click', function () { P.arrFois(1); });
    $('a-nouveau').addEventListener('click', function () { P.motifNouveau(false); dire('Motif vide ajouté après la section courante.'); });
    $('a-dupliquer').addEventListener('click', function () { P.motifNouveau(true); dire('Motif dupliqué : cette copie se modifie sans toucher à l\'original.'); });
    $('a-ajouter').addEventListener('click', function () { P.arrAjouter(); dire('Le même motif est rejoué dans une nouvelle section.'); });
    $('a-gauche').addEventListener('click', function () { P.arrDeplacer(-1); });
    $('a-droite').addEventListener('click', function () { P.arrDeplacer(1); });
    $('a-boucle').addEventListener('click', function () { P.arrBoucle(); dire('Le morceau reprendra à la section ' + (P.cur.ordre + 1) + ' après la dernière.'); });
    $('a-retirer').addEventListener('click', function () { dire(P.arrRetirer() ? 'Section retirée. Le motif reste disponible dans la liste.' : 'Un morceau garde au moins une section.'); });
    $('arr').addEventListener('pointerdown', function (e) {
      var i = P.ordreSous($('arr'), e.clientX - $('arr').getBoundingClientRect().left);
      if (i >= 0) P.allerOrdre(i);
    });

    // saisie
    $('s-instr').addEventListener('change', function () { P.instr = parseInt($('s-instr').value, 10); P.signaler('choix'); essayer(); });
    function octave(d) { P.octave = P.borne(P.octave + d, 0, 7); P.signaler('curseur'); }
    $('s-oct-moins').addEventListener('click', function () { octave(-1); });
    $('s-oct-plus').addEventListener('click', function () { octave(1); });
    $('i-oct-moins').addEventListener('click', function () { octave(-1); });
    $('i-oct-plus').addEventListener('click', function () { octave(1); });
    $('s-avance').addEventListener('change', function () { P.pasEdition = parseInt($('s-avance').value, 10); });
    $('s-suivre').addEventListener('change', function () { P.suivre = $('s-suivre').checked; });
    $('aide-touches').textContent = 'Deux rangées du clavier font le piano. 1 pose une relâche, Suppr efface, Maj + flèches sélectionne, Ctrl + ↑ ↓ transpose, Ctrl + C, X, V copie, coupe, colle.';

    P.brancherGrille($('grille'));

    // instruments
    editInstr = P.creerEditeur($('i-editeur'), {
      bruitage: false,
      lire: function () { return P.projet.instruments[P.instr - 1]; },
      regler: function (c, v) { P.instrRegler(P.instr - 1, c, v, false); }
    });
    $('i-nouveau').addEventListener('click', function () { P.instrNouveau(null); dire('Instrument ' + P.instr + ' créé.'); });
    $('i-dupliquer').addEventListener('click', function () { P.instrNouveau(P.projet.instruments[P.instr - 1]); dire('Instrument dupliqué sous le numéro ' + P.instr + '.'); });
    $('i-supprimer').addEventListener('click', function () { dire(P.instrSupprimer() ? 'Instrument supprimé ; les notes qui l\'utilisaient reprennent l\'instrument précédent de leur voie.' : 'Un morceau garde au moins un instrument.'); });
    piano = P.creerPiano($('i-piano'), function (n) { P.noteClavier(n, P.projet.instruments[P.instr - 1]); }, function (n) { P.finNoteClavier(n); });

    // bruitages
    editBruit = P.creerEditeur($('b-editeur'), {
      bruitage: true,
      lire: function () { return P.projet.bruitages[P.bruit]; },
      regler: function (c, v) { P.instrRegler(P.bruit, c, v, true); if ($('b-auto').checked && c !== 'nom') ecouterBruit(); }
    });
    P.FAMILLES.forEach(function (f) {
      var b = el('button', { type: 'button', classe: 'touche', texte: f[1] });
      b.addEventListener('click', function () { P.bruitRemplacer(P.bruitAuHasard(f[0]), 'Tirage'); ecouterBruit(); dire('Nouveau tirage dans la famille « ' + f[1].toLowerCase() + ' ». Annuler revient au son précédent.'); });
      $('b-familles').appendChild(b);
    });
    $('b-hasard').addEventListener('click', function () { P.bruitRemplacer(P.bruitAuHasard(), 'Tirage'); ecouterBruit(); dire('Son tiré au hasard : ' + P.projet.bruitages[P.bruit].nom.toLowerCase() + '.'); });
    $('b-variation').addEventListener('click', function () {
      var b = P.projet.bruitages[P.bruit];
      if (!b) { dire('Aucun bruitage à varier : créez-en un d\'abord.'); return; }
      P.bruitRemplacer(P.bruitVarier(b), 'Variation'); ecouterBruit(); dire('Variation du bruitage. Annuler revient à la version précédente.');
    });
    $('b-ecouter').addEventListener('click', ecouterBruit);
    $('b-nouveau').addEventListener('click', function () { P.bruitNouveau({ nom: 'Bruitage', type: 0, note: 72, duree: 8, a: 0, d: 10, s: 0, r: 2 }); ecouterBruit(); });
    $('b-dupliquer').addEventListener('click', function () { var b = P.projet.bruitages[P.bruit]; if (b) { P.bruitNouveau(P.copie(b)); dire('Bruitage dupliqué.'); } });
    $('b-supprimer').addEventListener('click', function () { P.bruitSupprimer(); });
    $('b-wav').addEventListener('click', function () { dire(P.exporterBruitWav(P.bruit, $('x-normaliser').checked)); });

    // Un bouton cliqué à la souris ne garde pas le clavier : Espace et les notes restent à la musique.
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || e.detail === 0 || b.closest('.menu')) return;
      if (mode === 'morceau') $('grille').focus({ preventScroll: true }); else b.blur();
    });
    document.addEventListener('keydown', touche);
    document.addEventListener('keyup', function (e) {
      var n = P.noteDeTouche(e.code);
      if (n) piano.allumer(n, false);
      P.toucheRelachee(e);
    });
    window.addEventListener('blur', function () { for (var v = 24; v < 120; v++) P.finNoteClavier(v); });
    window.addEventListener('resize', caler);
  }

  // ---------- Démarrage ----------
  P.initEcran();
  P.ecouter(majTout);
  P.ecouter(planifierSauvegarde);
  brancher();
  if (P.restaurerAuto()) dire('Votre dernier travail est rouvert. Espace lance la lecture.');
  else { P.ouvrir(P.DEMOS[0].creer()); dire('Morceau fourni : ' + P.DEMOS[0].nom + '. Espace lance la lecture ; les autres sont dans Fichier.'); }
  caler();
  majTransport();
  requestAnimationFrame(image);
  window.addEventListener('load', caler);
})();
