(function () {
  'use strict';

  var PP = window.PP, U = PP.ui;

  var TAILLES = [1, 2, 3, 4];
  var MARGE = 5;               // blanc autour du texte, en pixels de la police
  var DELAI_POLICE = 250;      // attente avant de refabriquer la vraie police de l'épreuve
  var PHRASES = [
    ['Pangramme', 'Portez ce vieux whisky au juge blond qui fume.\nPORTEZ CE VIEUX WHISKY AU JUGE BLOND QUI FUME.'],
    ['Accents et ligatures', 'Dès Noël, où un zéphyr haï me vêt de glaçons würmiens, je dîne d’exquis rôtis de bœuf au kir, à l’aÿ d’âge mûr, & cætera.\nÀ L’ŒUVRE : ÉTÉ, FENÊTRE, NAÏF, GARÇON, CAPHARNAÜM, L’HAŸ, ÆTHER, ÇÀ ET LÀ, OÙ ?'],
    ['Chiffres et ponctuation', '0123456789 — 1 234,50 € (TVA 20 %) ; 3 × 7 = 21 ; 12 °C\n« Qui ? Quoi ! Où… » dit-elle – “oui”, ‘non’, c’est-à-dire : #42, a@b.fr, [x] {y} <z> 5/8 + 1*2 ^ ~ _ | \\'],
    ['Alphabet', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\nàâäéèêëîïôöùûüÿç ÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇ œŒæÆ'],
    ['Crénage', 'AVATAR Tolérance VOYAGE LYON Type Yves Pays, L’AVENIR. Vous Tapez « Table » : F. P. T. V. W. Y. r, v, y.'],
    ['Confusions', 'Il1| O0o rn m cl d vv w 5S 2Z 8B ,. ;: ’\' “" -–— iıí ÎI lI'],
    ['Paragraphe', 'Le compositeur lève la lettre dans la casse, l’aligne dans son composteur, justifie la ligne puis la dépose sur la galée. Une fois la page serrée dans son châssis, on en tire une épreuve : c’est sur elle que le correcteur traque les coquilles, les lettres retournées et les blancs mal répartis.']
  ];
  var MOTS = 'AVANT AVEC Avenue AWARD AYANT ATLAS Ajout FAÇADE Fa Fonte PAGE Papier Tapis Table Terre Tirage Tout Type Très Tulipe TAXE VASTE Va Vers Voyage Vue WAGON Wagon Yak Yeux Yole LYON LA VOIX L’été L’art Lys LTD Kyoto RAYON Ravi KO Koala ' +
    'r, v, y, w, f. r. v. y. F. P. T. V. W. Y. F, P, T, V, W, Y, livre avoir voyage ouvrage rayon wagon côté typo affiche effet fjord';

  var $ = function (s) { return document.querySelector(s); };

  var E = U.epreuveEtat = { texte: PHRASES[1][1], taille: 2, sombre: false, vraie: false, onglet: 'epreuve', paire: [0x41, 0x56], propositions: null };
  var attente = false, vraie = { famille: '', rev: -1, n: 0, minuterie: 0, face: null };
  var tampon = document.createElement('canvas');

  // ---------- Rendu d'un texte ----------
  // Peint le masque d'un texte composé, agrandi t fois, pixels nets.
  function peindreMasque(toile, r, t, encre, fond) {
    var c = toile.getContext('2d'), img, i, d, e = couleur(encre);
    tampon.width = r.l; tampon.height = r.h;
    img = new ImageData(r.l, r.h); d = img.data;
    for (i = 0; i < r.masque.length; i++) {
      if (!r.masque[i]) continue;
      d[i * 4] = e[0]; d[i * 4 + 1] = e[1]; d[i * 4 + 2] = e[2]; d[i * 4 + 3] = 255;
    }
    tampon.getContext('2d').putImageData(img, 0, 0);
    toile.width = r.l * t; toile.height = r.h * t;
    c.fillStyle = fond; c.fillRect(0, 0, toile.width, toile.height);
    c.imageSmoothingEnabled = false;
    c.drawImage(tampon, 0, 0, r.l * t, r.h * t);
  }
  function couleur(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  function teintes() { return E.sombre ? [U.TEINTES.papier, U.TEINTES.encre] : [U.TEINTES.encre, U.TEINTES.papier]; }

  // ---------- Épreuve ----------
  function largeurUtile(feuille, t) { return Math.max(40, Math.floor((feuille.clientWidth - 18) / t) - 2 * MARGE); }

  function dessinerEpreuve() {
    var feuille = $('#eFeuille'), toile = $('#eToile'), p = PP.police, t = E.taille, tt = teintes(), r, c;
    feuille.classList.toggle('sombre', E.sombre);
    if (!E.vraie || !vraie.famille) {
      r = PP.rendre(E.texte, largeurUtile(feuille, t), MARGE);
      peindreMasque(toile, r, t, tt[0], tt[1]);
      return;
    }
    // Avec la police exportée : mêmes coupures de ligne, mais c'est le navigateur qui compose.
    r = PP.mettreEnLigne(E.texte, largeurUtile(feuille, t));
    toile.width = (r.l + 2 * MARGE) * t; toile.height = (Math.max(r.h, p.h) + 2 * MARGE) * t;
    c = toile.getContext('2d');
    c.fillStyle = tt[1]; c.fillRect(0, 0, toile.width, toile.height);
    c.fillStyle = tt[0]; c.font = (p.h * t) + 'px "' + vraie.famille + '"'; c.textBaseline = 'alphabetic';
    r.lignes.forEach(function (ligne, n) {
      var s = ligne.cars.map(function (k) { return k.code < 0 ? '￿' : PP.car(k.code); }).join('');
      c.fillText(s, MARGE * t, (MARGE + n * (p.h + p.interligne) + p.base) * t);
    });
  }

  // Refabrique le TrueType de la police en cours et le charge dans la page.
  function fabriquer() {
    var rev = PP.revision, famille = 'PP Epreuve ' + (++vraie.n), face;
    try { face = new FontFace(famille, PP.ttf().buffer); } catch (e) { U.message('La police n\'a pas pu être fabriquée : ' + e.message); return; }
    face.load().then(function () {
      if (vraie.face) document.fonts.delete(vraie.face);
      document.fonts.add(face);
      vraie.face = face; vraie.famille = famille; vraie.rev = rev;
      U.epreuve();
    }, function () { U.message('Le navigateur a refusé la police fabriquée.'); });
  }

  // ---------- Crénage ----------
  function motsAvec(paire) {
    var s = PP.car(paire[0]) + PP.car(paire[1]), r = MOTS.split(' ').filter(function (m) { return m.indexOf(s) >= 0; }).slice(0, 4);
    var majuscule = /\p{Lu}/u.test(PP.car(paire[0])) && /\p{Lu}/u.test(PP.car(paire[1]));
    r.push(majuscule ? 'HH' + s + 'HH' : 'nn' + s + 'nn');
    return r.filter(function (m) { return PP.codes(m).every(PP.utilisable); }).join('  ');
  }

  function dessinerCrenage() {
    var feuille = $('#kFeuille'), toile = $('#kToile'), p = PP.police, a = E.paire[0], b = E.paire[1], tt = teintes(), c, s, r, t, l, h, ok;
    ok = PP.utilisable(a) && PP.utilisable(b);
    $('#kValeur').textContent = ok ? PP.crenage(a, b) : '–';
    feuille.classList.toggle('sombre', E.sombre);
    l = feuille.clientWidth - 18; h = feuille.clientHeight - 14;
    c = toile.getContext('2d');
    if (!ok) { toile.width = Math.max(1, l); toile.height = Math.max(1, h); c.fillStyle = tt[1]; c.fillRect(0, 0, l, h); return; }
    s = PP.car(a) + PP.car(b);
    r = PP.rendre(s, 0, MARGE);
    t = PP.borne(Math.min(Math.floor(l * 0.3 / r.l), Math.floor(h / r.h)), 1, 8);
    peindreMasque(toile, r, t, tt[0], tt[1]);
    // À droite de la paire agrandie, des mots qui la contiennent.
    var gros = document.createElement('canvas'), mots = PP.rendre(motsAvec(E.paire).replace(/ {2}/g, '\n'), 0, MARGE), tm = PP.borne(Math.min(Math.floor((l - r.l * t) / mots.l), Math.floor(h / mots.h)), 1, 3);
    gros.width = toile.width; gros.height = toile.height;
    gros.getContext('2d').drawImage(toile, 0, 0);
    peindreMasque(toile, mots, tm, tt[0], tt[1]);
    var petit = document.createElement('canvas');
    petit.width = toile.width; petit.height = toile.height;
    petit.getContext('2d').drawImage(toile, 0, 0);
    toile.width = gros.width + petit.width; toile.height = Math.max(gros.height, petit.height);
    c.fillStyle = tt[1]; c.fillRect(0, 0, toile.width, toile.height);
    c.drawImage(gros, 0, Math.floor((toile.height - gros.height) / 2));
    c.drawImage(petit, gros.width, Math.floor((toile.height - petit.height) / 2));
  }

  function ligne(q, classe, action) {
    var actif = q.a === E.paire[0] && q.b === E.paire[1];
    return '<div class="k-ligne' + (actif ? ' actif' : '') + '"><button type="button" class="k-paire" data-a="' + q.a + '" data-b="' + q.b + '"><b>' + echapper(PP.car(q.a) + PP.car(q.b)) + '</b><span>' + (q.v > 0 ? '+' : '') + q.v + '</span></button>' +
      '<button type="button" class="k-geste" data-' + classe + '="' + q.a + ',' + q.b + ',' + q.v + '" title="' + action + '">' + (classe === 'applique' ? 'Appliquer' : 'Retirer') + '</button></div>';
  }
  function echapper(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function listes() {
    var ps = PP.paires(), pr = E.propositions;
    $('#kPaires').innerHTML = '<h3>' + (ps.length ? ps.length + (ps.length > 1 ? ' paires réglées' : ' paire réglée') : 'Aucune paire réglée') + '</h3>' +
      (ps.length ? ps.map(function (q) { return ligne(q, 'retire', 'Retirer le crénage de cette paire'); }).join('') : '<p class="note">Tapez deux caractères dans « Paire », ou lancez la détection.</p>');
    if (pr) pr = pr.filter(function (q) { return PP.utilisable(q.a) && PP.utilisable(q.b) && PP.crenage(q.a, q.b) > q.v; });
    $('#kTout').hidden = !pr || !pr.length;
    $('#kPropositions').innerHTML = !pr ? '<h3>Propositions</h3><p class="note">La détection compare le blanc entre deux caractères à l\'approche courante de la police.</p>' :
      PP.police.fixe ? '<h3>Propositions</h3><p class="note">Une police à chasse fixe ne se crène pas.</p>' :
      '<h3>' + (pr.length ? pr.length + (pr.length > 1 ? ' paires à resserrer' : ' paire à resserrer') : 'Plus rien à resserrer') + '</h3>' + pr.slice(0, 400).map(function (q) { return ligne(q, 'applique', 'Appliquer ce resserrement'); }).join('') +
      (pr.length > 400 ? '<p class="note">… et ' + (pr.length - 400) + ' autres : « Tout appliquer » les prend toutes.</p>' : '');
  }

  function choisirPaire(a, b, garderChamp) {
    E.paire = [a, b];
    if (!garderChamp) $('#kPaire').value = PP.car(a) + PP.car(b);
    U.epreuve();
  }
  function crener(delta, absolu) {
    var a = E.paire[0], b = E.paire[1];
    if (!PP.utilisable(a) || !PP.utilisable(b)) { U.message('Tapez deux caractères de la police dans « Paire ».'); return; }
    if (PP.police.fixe) { U.message('Une police à chasse fixe ne se crène pas : décochez « Chasse fixe » dans Police > Informations et repères.'); return; }
    PP.reglerCrenage(a, b, absolu ? 0 : PP.crenage(a, b) + delta);
    PP.valider('Régler le crénage');
  }

  U.agirCrenage = function (act) {
    if (act === 'kMoins') crener(-1);
    else if (act === 'kPlus') crener(1);
    else if (act === 'kZero') crener(0, true);
    else if (act === 'kDetecter') {
      U.onglet('crenage');
      E.propositions = PP.detecterCrenage();
      U.message(PP.police.fixe ? 'Une police à chasse fixe ne se crène pas.' : E.propositions.length ? E.propositions.length + ' paires gagneraient à être resserrées.' : 'Aucune paire à resserrer.');
      if (E.propositions.length) choisirPaire(E.propositions[0].a, E.propositions[0].b); else U.epreuve();
    } else if (act === 'kToutAppliquer') {
      var n = 0;
      (E.propositions || []).forEach(function (q) { if (PP.utilisable(q.a) && PP.utilisable(q.b) && PP.crenage(q.a, q.b) > q.v) { PP.reglerCrenage(q.a, q.b, q.v); n++; } });
      if (n) { PP.valider('Appliquer le crénage détecté'); U.message(n + ' paires resserrées. Ctrl+Z pour revenir en arrière.'); }
    } else return false;
    return true;
  };

  // ---------- Rafraîchissement ----------
  U.epreuve = function () {
    if (attente) return;
    attente = true;
    requestAnimationFrame(function () {
      var p = PP.police;
      attente = false;
      $('#eInterlettre').value = p.interlettre; $('#eInterligne').value = p.interligne;
      $('#eEspace').value = p.glyphes[0x20] ? PP.avance(0x20) : '';
      $('#eEspace').disabled = !p.glyphes[0x20] || p.fixe;
      if (E.onglet === 'epreuve') {
        dessinerEpreuve();
        if (E.vraie && vraie.rev !== PP.revision) { clearTimeout(vraie.minuterie); vraie.minuterie = setTimeout(fabriquer, DELAI_POLICE); }
      } else { dessinerCrenage(); listes(); }
    });
  };

  U.onglet = function (nom) {
    E.onglet = nom;
    document.querySelectorAll('.onglet').forEach(function (b) { b.classList.toggle('actif', b.dataset.onglet === nom); b.setAttribute('aria-selected', b.dataset.onglet === nom); });
    document.querySelectorAll('#epreuve [data-vue]').forEach(function (el) { el.hidden = el.dataset.vue !== nom; });
    U.epreuve();
  };

  U.initEpreuve = function () {
    var texte = $('#eTexte');
    $('#ePhrases').innerHTML = '<option value="">Phrases d\'essai…</option>' + PHRASES.map(function (q, i) { return '<option value="' + i + '">' + q[0] + '</option>'; }).join('');
    $('#eTailles').innerHTML = TAILLES.map(function (t) { return '<button type="button" class="btn mini" data-taille="' + t + '" title="' + t + ' pixel' + (t > 1 ? 's' : '') + ' d\'écran par pixel de police">×' + t + '</button>'; }).join('');
    function tailles() { document.querySelectorAll('#eTailles button').forEach(function (b) { b.classList.toggle('actif', +b.dataset.taille === E.taille); }); }
    texte.value = E.texte; $('#eSombre').checked = E.sombre; tailles();
    $('#kPaire').value = PP.car(E.paire[0]) + PP.car(E.paire[1]);
    texte.addEventListener('input', function () { E.texte = texte.value; U.epreuve(); if (U.surReglage) U.surReglage(); });
    $('#ePhrases').addEventListener('change', function () {
      if (this.value === '') return;
      E.texte = texte.value = PHRASES[+this.value][1];
      this.value = '';
      U.epreuve(); if (U.surReglage) U.surReglage();
    });
    $('#eTailles').addEventListener('click', function (e) {
      var b = e.target.closest('[data-taille]');
      if (!b) return;
      E.taille = +b.dataset.taille; tailles(); U.epreuve(); if (U.surReglage) U.surReglage();
    });
    $('#eSombre').addEventListener('change', function () { E.sombre = this.checked; U.epreuve(); if (U.surReglage) U.surReglage(); });
    $('#eVraie').addEventListener('change', function () {
      E.vraie = this.checked;
      if (E.vraie) U.message('L\'épreuve est maintenant composée par le navigateur avec le fichier TrueType fabriqué à la volée.');
      U.epreuve();
    });
    $('#eInterlettre').addEventListener('change', function () { PP.reglerPolice({ interlettre: this.value }); });
    $('#eInterligne').addEventListener('change', function () { PP.reglerPolice({ interligne: this.value }); });
    $('#eEspace').addEventListener('change', function () {
      PP.reglerAvance(0x20, this.value);
      if (PP.glyphe(0xA0)) PP.reglerAvance(0xA0, this.value);
      PP.valider('Régler l\'espace');
    });
    document.querySelector('.onglets').addEventListener('click', function (e) {
      var b = e.target.closest('.onglet');
      if (b) U.onglet(b.dataset.onglet);
    });
    $('#kPaire').addEventListener('input', function () {
      var c = PP.codes(this.value);
      if (c.length >= 2) choisirPaire(c[0], c[1], true);
    });
    function clicListe(e) {
      var b = e.target.closest('.k-paire'), g = e.target.closest('.k-geste'), t;
      if (b) choisirPaire(+b.dataset.a, +b.dataset.b);
      else if (g && g.dataset.retire) { t = g.dataset.retire.split(','); PP.reglerCrenage(+t[0], +t[1], 0); PP.valider('Retirer une paire'); }
      else if (g && g.dataset.applique) { t = g.dataset.applique.split(','); E.paire = [+t[0], +t[1]]; $('#kPaire').value = PP.car(+t[0]) + PP.car(+t[1]); PP.reglerCrenage(+t[0], +t[1], +t[2]); PP.valider('Appliquer une proposition'); }
    }
    $('#kPaires').addEventListener('click', clicListe);
    $('#kPropositions').addEventListener('click', clicListe);
    if (window.ResizeObserver) new ResizeObserver(U.epreuve).observe($('#epreuve'));
  };
  U.peindreMasque = peindreMasque;
})();
