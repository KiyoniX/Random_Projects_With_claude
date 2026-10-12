(function () {
  'use strict';

  var PP = window.PP, U = PP.ui;

  var COTE = 32;               // hauteur utile d'un cassetin, en pixels d'écran

  var $ = function (s) { return document.querySelector(s); };
  var signature = '', toiles = {};

  function echelle() { return Math.max(1, Math.floor(COTE / PP.police.h)); }

  // ---------- Cassetins ----------
  function peindre(code) {
    var c = toiles[code], p = PP.police, e, av, x, bouton, vide;
    if (!c) return;
    e = echelle(); av = PP.avance(code);
    bouton = c.parentNode;
    vide = PP.aDessiner(code);
    bouton.classList.toggle('vide', vide);
    bouton.classList.toggle('lie', !!p.glyphes[code].comp);
    bouton.classList.toggle('blanc', PP.estBlanc(code));
    c.width = COTE; c.height = p.h * e;
    if (vide) return;
    x = Math.round((COTE - av * e) / 2);
    U.peindre(c.getContext('2d'), PP.pixels(code), p.h, x, 0, e, U.TEINTES.encre);
  }

  function construire() {
    var html = '';
    PP.groupes().forEach(function (g) {
      html += '<h3>' + g.nom + '</h3><div class="cassetins">' + g.codes.map(function (code) {
        var car = PP.estBlanc(code) ? '' : PP.car(code);
        return '<button type="button" class="cassetin" data-code="' + code + '" title="' + (car === '"' ? '&quot;' : car === '&' ? '&amp;' : car === '<' ? '&lt;' : car) + ' ' + PP.hexa(code) + '">' +
          '<canvas width="1" height="1"></canvas><i>' + (car === '&' ? '&amp;' : car === '<' ? '&lt;' : car) + '</i></button>';
      }).join('') + '</div>';
    });
    $('#casse').innerHTML = html;
    toiles = {};
    document.querySelectorAll('#casse .cassetin').forEach(function (b) { toiles[b.dataset.code] = b.firstChild; });
  }

  // Redessine la casse ; elle n'est reconstruite que si le jeu de caractères a changé.
  U.casse = function () {
    var p = PP.police, s = Object.keys(p.glyphes).join(',') + '/' + p.h, n = 0, total = 0, k, actif;
    if (s !== signature) { construire(); signature = s; }
    for (k in p.glyphes) { peindre(+k); total++; if (PP.aDessiner(+k)) n++; }
    $('#casseCompte').textContent = total + ' caractères' + (n ? ', dont ' + n + ' à dessiner' : '');
    $('#casseCompte').classList.toggle('reste', n > 0);
    actif = $('#casse .cassetin.actif');
    if (actif) actif.classList.remove('actif');
    actif = toiles[p.courant] && toiles[p.courant].parentNode;
    if (actif) {
      actif.classList.add('actif');
      // En fenêtre étroite la casse ne défile pas elle-même : on ne fait pas sauter la page vers elle à chaque trait.
      if (actif.scrollIntoView && $('#casse').scrollHeight > $('#casse').clientHeight) actif.scrollIntoView({ block: 'nearest' });
    }
  };

  // Pendant un geste : seuls le caractère en cours et ceux qui en dépendent changent.
  U.casseRetouche = function () {
    var code = PP.police.courant;
    peindre(code);
    PP.dependants(code).forEach(peindre);
  };

  // Nombre de cassetins par rangée, pour monter et descendre avec les flèches.
  U.casseColonnes = function () {
    var b = $('#casse .cassetins'), c = b && b.firstChild;
    return b && c ? Math.max(1, Math.floor((b.clientWidth + 2) / (c.offsetWidth + 2))) : 10;
  };

  // ---------- Aller à un caractère ----------
  function codeSaisi(s) {
    var m = /^(?:U\+|0x)([0-9a-f]{2,6})$/i.exec(s.trim());
    if (m) return parseInt(m[1], 16);
    return s ? s.codePointAt(0) : -1;
  }

  U.initCasse = function () {
    var champ = $('#allerA');
    $('#casse').addEventListener('click', function (e) {
      var b = e.target.closest('.cassetin');
      if (b) U.aller(+b.dataset.code);
    });
    $('#casse').addEventListener('dblclick', function (e) {
      var b = e.target.closest('.cassetin.vide');
      if (b && PP.decomposition(+b.dataset.code)) U.agir('composerAuto');
    });
    // Un caractère tapé y mène aussitôt ; un code (U+0152) attend Entrée.
    champ.addEventListener('input', function () {
      var v = champ.value, code;
      if (!v || /^(u\+?|0x?)[0-9a-f]*$/i.test(v)) return;
      code = v.codePointAt(0);
      champ.value = '';
      champ.blur();
      if (!U.aller(code)) U.message('« ' + PP.car(code) + ' » n\'est pas dans la police : ajoutez-le avec « + Ajouter ».');
    });
    champ.addEventListener('keydown', function (e) {
      var code;
      if (e.key !== 'Enter') return;
      code = codeSaisi(champ.value);
      champ.value = '';
      champ.blur();
      if (code >= 0 && !U.aller(code)) U.message(PP.hexa(code) + ' n\'est pas dans la police : ajoutez-le avec « + Ajouter ».');
    });
    champ.addEventListener('focus', function () { U.message('Tapez un caractère pour y aller, ou un code comme U+0152 puis Entrée. Échap pour renoncer.'); });
  };
  U.codeSaisi = codeSaisi;
})();
