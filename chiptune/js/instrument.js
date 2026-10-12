(function () {
  'use strict';

  var P = window.Puce;
  var RAPPORTS = ['12,5 %', '25 %', '50 %', '75 %'];
  var ARPEGES = [['', 'aucun'], ['0 4 7', 'accord majeur'], ['0 3 7', 'accord mineur'], ['0 4 7 10', 'septième'], ['0 12', 'octave'], ['0 7 12', 'quinte et octave'], ['0 3 7 12', 'mineur montant'], ['0 5', 'quarte (pièce)']];
  var FAMILLES = [['saut', 'Saut'], ['piece', 'Pièce'], ['coup', 'Coup'], ['explosion', 'Explosion'], ['laser', 'Laser'], ['validation', 'Validation'], ['erreur', 'Erreur']];
  var TIC_MS = 1000 / 60;

  // ---------- Petits outils de construction ----------
  function el(tag, attrs, enfants) {
    var e = document.createElement(tag), k;
    for (k in attrs || {}) {
      if (k === 'texte') e.textContent = attrs[k];
      else if (k === 'classe') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (enfants || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  P.el = el;
  function ms(tics) { return Math.round(tics * TIC_MS) + ' ms'; }
  function signe(n) { return (n > 0 ? '+' : '') + n; }

  // ---------- Éditeur d'instrument ----------
  // acces : { lire() -> instrument ou bruitage, regler(champ, valeur), bruitage, surChange() }
  P.creerEditeur = function (racine, acces) {
    var majs = [], groupes = {};

    function curseur(parent, lib, champ, min, max, format) {
      var entree = el('input', { type: 'range', min: min, max: max, step: 1 }), sortie = el('output');
      parent.appendChild(el('label', { classe: 'champ' }, [el('span', { classe: 'lib', texte: lib }), entree, sortie]));
      entree.addEventListener('input', function () { acces.regler(champ, parseInt(entree.value, 10)); });
      majs.push(function (x) { entree.value = x[champ]; sortie.textContent = format ? format(x[champ], x) : x[champ]; });
      return entree;
    }
    function coche(parent, lib, champ) {
      var entree = el('input', { type: 'checkbox' });
      parent.appendChild(el('label', { classe: 'coche' }, [entree, el('span', { texte: lib })]));
      entree.addEventListener('change', function () { acces.regler(champ, entree.checked); });
      majs.push(function (x) { entree.checked = !!x[champ]; });
      return entree;
    }
    function groupe(colonne, nom, titre) {
      var g = el('fieldset', { classe: 'groupe' }, [el('legend', { texte: titre })]);
      colonne.appendChild(g); groupes[nom] = g;
      return g;
    }
    function longueur(parent, lib, champ, min, max, defaut) {
      var moins = el('button', { type: 'button', classe: 'touche mini', texte: '−', 'aria-label': lib + ' : raccourcir' });
      var plus = el('button', { type: 'button', classe: 'touche mini', texte: '+', 'aria-label': lib + ' : allonger' }), sortie = el('output');
      parent.appendChild(el('div', { classe: 'champ' }, [el('span', { classe: 'lib', texte: lib }), moins, plus, sortie]));
      function changer(d) {
        var t = acces.lire()[champ].slice(), n = Math.max(min, Math.min(max, t.length + d));
        while (t.length < n) t.push(t.length ? t[t.length - 1] : defaut);
        t.length = n;
        acces.regler(champ, t);
      }
      moins.addEventListener('click', function () { changer(-1); });
      plus.addEventListener('click', function () { changer(1); });
      majs.push(function (x) { sortie.textContent = x[champ].length ? x[champ].length + ' pas' : 'aucun'; });
    }

    var colA = el('div', { classe: 'col' }), colB = el('div', { classe: 'col' }), colC = el('div', { classe: 'col' });
    racine.appendChild(colA); racine.appendChild(colB); racine.appendChild(colC);

    // Son
    var g = groupe(colA, 'son', acces.bruitage ? 'Bruitage' : 'Instrument');
    var nom = el('input', { type: 'text', maxlength: 24, 'aria-label': 'Nom' });
    g.appendChild(el('label', { classe: 'champ' }, [el('span', { classe: 'lib', texte: 'Nom' }), nom]));
    nom.addEventListener('input', function () { acces.regler('nom', nom.value); });
    majs.push(function (x) { if (document.activeElement !== nom) nom.value = x.nom; });
    var type = el('select', { 'aria-label': 'Voix' }, P.NOMS_TYPES.map(function (n, i) { return el('option', { value: i, texte: n }); }));
    g.appendChild(el('label', { classe: 'champ' }, [el('span', { classe: 'lib', texte: 'Voix' }), type]));
    type.addEventListener('change', function () { acces.regler('type', parseInt(type.value, 10)); });
    majs.push(function (x) { type.value = x.type; });
    curseur(g, 'Volume', 'vol', 0, 15);
    if (acces.bruitage) {
      curseur(g, 'Note', 'note', 24, 108, function (n) { return P.nomNoteFr(n); });
      curseur(g, 'Tenue', 'duree', 1, 120, ms);
    }

    // Enveloppe
    g = groupe(colA, 'env', 'Enveloppe de volume');
    var mode = el('select', { 'aria-label': 'Forme de l\'enveloppe' }, [el('option', { value: 'adsr', texte: 'quatre temps' }), el('option', { value: 'pas', texte: 'dessinée pas à pas' })]);
    g.appendChild(el('label', { classe: 'champ' }, [el('span', { classe: 'lib', texte: 'Forme' }), mode]));
    mode.addEventListener('change', function () { acces.regler('env', mode.value); });
    majs.push(function (x) { mode.value = x.env; });
    var cvEnv = el('canvas', { classe: 'lcd barres', 'aria-label': 'Enveloppe : volume à chaque tic' });
    g.appendChild(cvEnv);
    var barresEnv = P.creerBarres(cvEnv, {
      max: 15,
      lire: function () {
        var x = acces.lire(), t = [], k;
        if (x.env === 'pas') return x.pas;
        for (k = 0; k < x.a; k++) t.push(15 * (k + 1) / (x.a + 1));
        for (k = 0; k < x.d; k++) t.push(15 - (15 - x.s) * k / x.d);
        for (k = 0; k < 6; k++) t.push(x.s);
        for (k = 0; k < x.r; k++) t.push(x.s * (1 - k / x.r));
        t.push(0);
        return t.map(Math.round);
      },
      ecrire: function (t) { if (acces.lire().env === 'pas') acces.regler('pas', t); },
      boucle: function () { var x = acces.lire(); return x.env === 'pas' ? x.pasBoucle : -1; }
    });
    var adsr = el('div'), dessin = el('div');
    g.appendChild(adsr); g.appendChild(dessin);
    curseur(adsr, 'Attaque', 'a', 0, 40, ms);
    curseur(adsr, 'Déclin', 'd', 0, 90, ms);
    curseur(adsr, 'Maintien', 's', 0, 15);
    longueur(dessin, 'Longueur', 'pas', 1, 64, 0);
    curseur(dessin, 'Boucle', 'pasBoucle', -1, 63, function (n, x) { return n < 0 || n >= x.pas.length ? 'sans' : 'dès le pas ' + (n + 1); });
    curseur(g, 'Relâchement', 'r', 0, 90, ms);
    majs.push(function (x) { adsr.hidden = x.env !== 'adsr'; dessin.hidden = x.env !== 'pas'; });

    // Timbre
    g = groupe(colB, 'carre', 'Timbre du carré');
    var boutonsRap = RAPPORTS.map(function (r, i) {
      var b = el('button', { type: 'button', classe: 'cran', texte: r });
      b.addEventListener('click', function () { acces.regler('rap', i); });
      return b;
    });
    g.appendChild(el('div', { classe: 'champ' }, [el('span', { classe: 'lib', texte: 'Rapport cyclique' }), el('div', { classe: 'crans' }, boutonsRap)]));
    majs.push(function (x) { boutonsRap.forEach(function (b, i) { b.setAttribute('aria-pressed', i === x.rap ? 'true' : 'false'); }); });
    longueur(g, 'Balayage', 'rapSeq', 0, 32, 2);
    var cvRap = el('canvas', { classe: 'lcd barres basses', 'aria-label': 'Balayage du rapport cyclique, pas à pas' });
    g.appendChild(cvRap);
    var barresRap = P.creerBarres(cvRap, { max: 3, traits: true, lire: function () { return acces.lire().rapSeq; }, ecrire: function (t) { acces.regler('rapSeq', t); } });
    curseur(g, 'Lenteur', 'rapVit', 1, 12, function (n) { return n + (n > 1 ? ' tics par pas' : ' tic par pas'); });
    coche(g, 'Balayage en boucle', 'rapBoucle');
    majs.push(function (x) { cvRap.hidden = !x.rapSeq.length; });

    g = groupe(colB, 'bruit', 'Timbre du bruit');
    coche(g, 'Registre court (grain métallique)', 'court');

    g = groupe(colB, 'onde', 'Table d\'onde');
    var cvOnde = el('canvas', { classe: 'lcd barres', 'aria-label': 'Table d\'onde : 32 valeurs de 0 à 15' });
    g.appendChild(cvOnde);
    var barresOnde = P.creerBarres(cvOnde, { max: 15, traits: true, lire: function () { return acces.lire().onde; }, ecrire: function (t) { acces.regler('onde', t); } });
    var formes = {
      Sinus: function (i) { return 7.5 + 7.5 * Math.sin(2 * Math.PI * (i + 0.5) / 32); },
      Scie: function (i) { return i / 2; },
      Carré: function (i) { return i < 16 ? 15 : 0; },
      Triangle: function (i) { return i < 16 ? i : 31 - i; },
      Hasard: function () { return Math.random() * 15; }
    };
    g.appendChild(el('div', { classe: 'rangee' }, Object.keys(formes).map(function (n) {
      var b = el('button', { type: 'button', classe: 'touche', texte: n }), i, t;
      b.addEventListener('click', function () {
        t = [];
        for (i = 0; i < 32; i++) t.push(Math.max(0, Math.min(15, Math.round(formes[n](i)))));
        acces.regler('onde', t);
      });
      return b;
    })));

    // Arpège et vibrato
    g = groupe(colB, 'arp', 'Arpège');
    var arp = el('input', { type: 'text', 'aria-label': 'Demi-tons de l\'arpège, séparés par des espaces', placeholder: '0 4 7' });
    var modeles = el('select', { 'aria-label': 'Modèles d\'arpège' }, ARPEGES.map(function (a) { return el('option', { value: a[0], texte: a[1] }); }));
    g.appendChild(el('label', { classe: 'champ' }, [el('span', { classe: 'lib', texte: 'Demi-tons' }), arp, modeles]));
    function lireArp(s) {
      return s.split(/[\s,;]+/).map(function (q) { return parseInt(q, 10); }).filter(function (q) { return !isNaN(q); }).slice(0, 16).map(function (q) { return Math.max(-24, Math.min(24, q)); });
    }
    arp.addEventListener('input', function () { acces.regler('arp', lireArp(arp.value)); });
    modeles.addEventListener('change', function () { acces.regler('arp', lireArp(modeles.value)); });
    majs.push(function (x) { var s = x.arp.join(' '); if (document.activeElement !== arp) arp.value = s; modeles.value = ARPEGES.some(function (a) { return a[0] === s; }) ? s : ''; });
    curseur(g, 'Lenteur', 'arpVit', 1, 12, function (n) { return n + (n > 1 ? ' tics par note' : ' tic par note'); });
    coche(g, 'Arpège en boucle', 'arpBoucle');

    g = groupe(colC, 'vib', 'Vibrato');
    curseur(g, 'Profondeur', 'vibProf', 0, 100, function (n) { return n ? n + ' centièmes' : 'aucun'; });
    curseur(g, 'Vitesse', 'vibVit', 1, 15, function (n) { return n + ' Hz'; });
    curseur(g, 'Retard', 'vibDelai', 0, 60, ms);

    g = groupe(colC, 'haut', 'Hauteur');
    curseur(g, 'Glissement', 'gliss', -400, 400, function (n) { return n ? signe(n) + ' c. par tic' : 'aucun'; });
    curseur(g, 'Chute', 'chute', -48, 48, function (n) { return n ? 'part de ' + signe(n) + ' demi-tons' : 'aucune'; });
    curseur(g, 'Durée de la chute', 'chuteDuree', 1, 40, ms);
    if (!acces.bruitage) {
      var fixe = el('input', { type: 'checkbox' }), noteFixe = el('input', { type: 'range', min: 24, max: 108, step: 1, 'aria-label': 'Note fixe' }), sortieFixe = el('output');
      g.appendChild(el('label', { classe: 'coche' }, [fixe, el('span', { texte: 'Note fixe (percussion)' })]));
      var ligneFixe = el('label', { classe: 'champ' }, [el('span', { classe: 'lib', texte: 'Note jouée' }), noteFixe, sortieFixe]);
      g.appendChild(ligneFixe);
      fixe.addEventListener('change', function () { acces.regler('noteFixe', fixe.checked ? 60 : 0); });
      noteFixe.addEventListener('input', function () { acces.regler('noteFixe', parseInt(noteFixe.value, 10)); });
      majs.push(function (x) { fixe.checked = !!x.noteFixe; ligneFixe.hidden = !x.noteFixe; if (x.noteFixe) { noteFixe.value = x.noteFixe; sortieFixe.textContent = P.nomNoteFr(x.noteFixe); } });
    }

    return {
      maj: function () {
        var x = acces.lire(), i;
        racine.hidden = !x;
        if (!x) return;
        for (i = 0; i < majs.length; i++) majs[i](x);
        groupes.carre.hidden = x.type !== 0;
        groupes.bruit.hidden = x.type !== 2;
        groupes.onde.hidden = x.type !== 3;
        barresEnv.dessiner();
        if (x.type === 0 && x.rapSeq.length) barresRap.dessiner();
        if (x.type === 3) barresOnde.dessiner();
      }
    };
  };

  // ---------- Piano à l'écran ----------
  // jouer(note), finir(note)
  P.creerPiano = function (racine, jouer, finir) {
    var NOIRES = [1, 3, 6, 8, 10], touches = {}, n, actuelle = 0;
    function construire() {
      var base = (P.octave + 1) * 12, i, t, noire, pos = 0, lettres = {}, k;
      racine.textContent = ''; touches = {};
      // au-delà de la première octave, c'est la rangée du haut qui est affichée
      for (k in P.PIANO) if (!(P.PIANO[k] >= 12 && /^(Comma|KeyL|Period|Semicolon|Slash)$/.test(k))) lettres[P.PIANO[k]] = P.lettresPiano[k] || '';
      for (i = 0; i < 29; i++) {
        n = base + i; noire = NOIRES.indexOf(i % 12) >= 0;
        t = el('button', { type: 'button', classe: 'pt ' + (noire ? 'noire' : 'blanche') + (P.dansGamme(n) ? ' gamme' : ''), 'data-note': n, 'aria-label': P.nomNoteFr(n), tabindex: -1 },
          [el('span', { texte: lettres[i] || '' })]);
        t.style.left = noire ? 'calc(' + pos + ' * var(--lt) - var(--lt) * 0.32)' : 'calc(' + pos + ' * var(--lt))';
        if (!noire) pos++;
        if (i % 12 === 0) t.appendChild(el('i', { texte: P.NOTES_FR[0] + ' ' + (Math.floor(n / 12) - 1) }));
        racine.appendChild(t); touches[n] = t;
      }
      racine.style.setProperty('--nb', pos);
    }
    racine.addEventListener('pointerdown', function (e) {
      var t = e.target.closest('.pt');
      if (!t) return;
      actuelle = parseInt(t.getAttribute('data-note'), 10);
      jouer(actuelle);
      e.preventDefault();
    });
    window.addEventListener('pointerup', function () { if (actuelle) { finir(actuelle); actuelle = 0; } });
    return {
      construire: construire,
      allumer: function (note, oui) { if (touches[note]) touches[note].classList.toggle('enfoncee', oui); }
    };
  };

  // ---------- Atelier de bruitages ----------
  P.FAMILLES = FAMILLES;
})();
