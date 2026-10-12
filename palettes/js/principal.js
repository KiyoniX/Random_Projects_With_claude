(function () {
  'use strict';

  var P = window.Palettes, U = P.ui, $ = U.$;

  var DELAI_ADRESSE = 250;                // millisecondes de calme avant d'écrire l'adresse
  var GRANDE_IMAGE = 300000;              // au-delà de ce nombre de pixels, le recalcul attend la fin du geste
  var DELAI_GRANDE = 70;

  var adresse = '', minuterieAdresse = null, attente = null, aRecalculer = false;

  // ---------- Rafraîchissement ----------
  function rafraichirPage() {
    var o = P.R.onglet;
    if (o === 'extraire') U.rafraichirInfoImage();
    else if (o === 'verifier') U.rafraichirVerifier();
    else if (o === 'bibliotheque') U.rafraichirBibliotheque();
    else if (o === 'fichiers') U.rafraichirFichiers();
  }

  // Le coûteux (image recalculée, page de l'onglet) est remis à plus tard et regroupé.
  function planifier(recalcul) {
    var im = U.image();
    aRecalculer = aRecalculer || recalcul;
    if (attente !== null) return;
    attente = setTimeout(function () {
      var r = aRecalculer;
      attente = null; aRecalculer = false;
      if (r && U.image()) U.recalculerImage();
      rafraichirPage();
    }, im && im.w * im.h > GRANDE_IMAGE ? DELAI_GRANDE : 0);
  }

  function rafraichirBarre() {
    var E = P.E, h = P.histEtat(), v = E.verrous.filter(function (x) { return x; }).length;
    if (document.activeElement !== $('#nom')) $('#nom').value = E.nom;
    $('#compte').textContent = U.pluriel(E.couleurs.length, 'couleur') + (v ? ', dont ' + v + ' verrouillée' + (v > 1 ? 's' : '') : '');
    $('#bAnnuler').disabled = !h.avant;
    $('#bRetablir').disabled = !h.apres;
    document.title = (E.nom ? E.nom + ' – ' : '') + 'Palettes';
  }

  // choixSeul : seule la couleur choisie a changé, la palette est la même.
  U.rafraichir = function (choixSeul) {
    U.rafraichirBande();
    U.rafraichirValeurs();
    U.rafraichirCote();
    rafraichirBarre();
    noterAdresse();
    planifier(!choixSeul);
  };

  // ---------- Adresse ----------
  function noterAdresse() {
    clearTimeout(minuterieAdresse);
    minuterieAdresse = setTimeout(function () {
      adresse = P.versAdresse();
      try { history.replaceState(null, '', adresse); } catch (e) { location.replace(adresse); }   // Chrome refuse replaceState en file://
    }, DELAI_ADRESSE);
  }
  U.lien = function () { return location.href.replace(/#.*$/, '') + P.versAdresse(); };

  // ---------- Réglages ----------
  // Met tous les champs d'accord avec P.R (au démarrage ou après la lecture d'une adresse).
  U.majReglages = function () {
    var R = P.R;
    $('#rN').value = $('#rNn').value = R.n;
    $('#rMethode').value = R.methode;
    $('#rEquilibre').value = R.equilibre; $('#rEquilibreVal').textContent = R.equilibre;
    $('#rTrame').value = R.trame;
    $('#rForce').value = R.force; $('#rForceVal').textContent = R.force + ' %';
    $('#ligneForce').classList.toggle('inerte', R.trame === 'aucune');
    $('#vision').value = R.vision;
    document.body.dataset.fond = R.fond;
    document.querySelectorAll('#fonds button').forEach(function (b) { b.classList.toggle('actif', Number(b.dataset.fond) === R.fond); });
  };

  U.definirVision = function (v) {
    P.regler('vision', v);
    U.majReglages();
    U.repeindreRendu();
    noterAdresse();
    rafraichirPage();
  };

  U.montrerOnglet = function (id) {
    P.regler('onglet', id);
    document.querySelectorAll('#onglets [data-onglet]').forEach(function (b) { b.classList.toggle('actif', b.dataset.onglet === P.R.onglet); });
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = p.id !== 'page-' + P.R.onglet; });
    if (P.R.onglet === 'extraire') U.dessinerVues();
    if (P.R.onglet === 'construire') U.rafraichirConstruire();
    rafraichirPage();
    noterAdresse();
  };

  // Un réglage d'extraction a changé : la palette est tirée de nouveau si une image est là.
  function reextraire() {
    U.majReglages();
    if (U.image()) U.extraire(); else noterAdresse();
  }

  function brancher() {
    $('#onglets').addEventListener('click', function (e) {
      var b = e.target.closest('[data-onglet]'), f = e.target.closest('[data-fond]');
      if (b) U.montrerOnglet(b.dataset.onglet);
      if (f) { P.regler('fond', f.dataset.fond); U.majReglages(); noterAdresse(); }
    });
    $('#vision').addEventListener('change', function () { U.definirVision(this.value); });

    $('#rN').addEventListener('input', function () { P.regler('n', this.value); reextraire(); });
    $('#rNn').addEventListener('input', function () { if (this.value >= 2 && this.value <= 64) { P.regler('n', this.value); $('#rN').value = P.R.n; if (U.image()) U.extraire(); else noterAdresse(); } });
    $('#rNn').addEventListener('change', function () { P.regler('n', this.value); P.clore(); reextraire(); P.clore(); });
    $('#rN').addEventListener('change', P.clore);
    $('#rMethode').addEventListener('change', function () { P.regler('methode', this.value); P.clore(); reextraire(); P.clore(); });
    $('#rEquilibre').addEventListener('input', function () { P.regler('equilibre', this.value); reextraire(); });
    $('#rEquilibre').addEventListener('change', P.clore);
    $('#rTrame').addEventListener('change', function () { P.regler('trame', this.value); U.majReglages(); noterAdresse(); planifier(true); });
    $('#rForce').addEventListener('input', function () { P.regler('force', this.value); U.majReglages(); noterAdresse(); planifier(true); });

    $('#nom').addEventListener('input', function () { P.E.nom = P.nomPropre(this.value); P.valider('Renommer', 'nom'); });
    $('#nom').addEventListener('change', function () { P.clore(); this.value = P.E.nom; });
    $('#nom').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
    $('#bAnnuler').addEventListener('click', P.annuler);
    $('#bRetablir').addEventListener('click', P.retablir);
    $('#bLien').addEventListener('click', function () { U.copier(U.lien(), 'Lien de la palette'); });

    window.addEventListener('hashchange', function () {
      var avant = P.versAdresse(), sel = P.E.sel, sel2 = P.E.sel2;
      if (!location.hash || location.hash === adresse) return;
      if (!P.depuisAdresse(location.hash)) return;
      // Le navigateur peut réécrire l'adresse autrement que nous : si rien n'a changé, ce n'est pas une étape.
      if (P.versAdresse() === avant) { P.E.sel = sel; P.E.sel2 = sel2; return; }
      U.majReglages();
      U.montrerOnglet(P.R.onglet);
      P.valider('Ouvrir un lien');
    });

    // Fichiers déposés : une image part à l'extraction, sauf dans l'onglet des fichiers où elle est lue
    // comme une bande de couleurs ; tout autre fichier est lu comme une palette.
    window.addEventListener('dragover', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      e.preventDefault();
      document.body.classList.add('survol');
    });
    window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('survol'); });
    window.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      document.body.classList.remove('survol');
      if (!f) return;
      e.preventDefault();
      if (/^image\//.test(f.type) && P.R.onglet !== 'fichiers') U.chargerImage(f); else U.importerFichier(f);
    });
    window.addEventListener('paste', function (e) {
      var cible = e.target && e.target.tagName, items = e.clipboardData ? e.clipboardData.items : [], i, texte;
      if (cible === 'INPUT' || cible === 'TEXTAREA') return;
      for (i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { e.preventDefault(); U.chargerImage(items[i].getAsFile()); return; }
      }
      texte = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (texte && texte.trim()) { e.preventDefault(); U.importerTexte(texte, ''); }
    });

    document.addEventListener('keydown', function (e) {
      var cible = e.target.tagName, texte = cible === 'TEXTAREA' || cible === 'SELECT' || (cible === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox'), E = P.E, k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (texte && e.target.id !== 'nom') return;
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); P.annuler(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); P.retablir(); }
        else if (k === 'd' && !texte) { e.preventDefault(); U.actions.dupliquer(); }
        return;
      }
      if (texte || e.metaKey) return;
      if (e.key === 'Delete') U.actions.retirer();
      else if (k === 'v' && !e.altKey) U.actions.verrou();
      else if (e.key === 'Escape' && E.sel2 >= 0) { E.sel2 = -1; P.noterChoix(); U.rafraichir(true); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && cible !== 'INPUT') {
        e.preventDefault();
        if (e.altKey) U.actions.pousser(e.key === 'ArrowLeft' ? -1 : 1);
        else U.choisir(P.borne(E.sel + (e.key === 'ArrowLeft' ? -1 : 1), 0, E.couleurs.length - 1));
      }
    });
    document.addEventListener('keyup', function (e) { if (e.key === 'Alt') P.clore(); });
  }

  // ---------- Démarrage ----------
  function demarrer() {
    var depart;
    function options(liste) { return liste.map(function (x) { return '<option value="' + x.id + '">' + U.echapper(x.nom) + '</option>'; }).join(''); }
    $('#vision').innerHTML = options(P.VISIONS);
    $('#rMethode').innerHTML = options(P.METHODES);
    $('#rTrame').innerHTML = options(P.TRAMES);
    if (!(location.hash.length > 1 && P.depuisAdresse(location.hash))) {
      depart = P.FOURNIES.filter(function (p) { return p.nom === P.PALETTE_DEPART; })[0] || P.FOURNIES[0];
      P.remplacer(depart.couleurs, [], depart.nom);
    }
    P.histInit();
    U.initNuancier();
    U.initImage();
    U.initPages();
    brancher();
    P.surChange = function () { U.rafraichir(); };
    U.majReglages();
    U.rafraichir();
    U.montrerOnglet(P.R.onglet);
  }

  demarrer();
})();
