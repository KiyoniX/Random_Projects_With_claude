(function () {
  'use strict';

  // Les panneaux de droite : le panneau de verre et ses mesures, les verres de l'atelier, les pièces et les règles.
  var V = window.Vitrail, G = V.geo, R = V.rendu, U = V.ui;

  var DELAI_MSG = 7000;
  var $ = function (s) { return document.querySelector(s); };
  var echapper = V.echapper;

  // ---------- Messages ----------
  var minuterieMsg = null;
  U.dire = function (texte) {
    $('#etatMsg').textContent = texte || '';
    clearTimeout(minuterieMsg);
    if (texte) minuterieMsg = setTimeout(function () { $('#etatMsg').textContent = ''; }, DELAI_MSG);
  };

  function options(liste, valeur, unite) {
    if (liste.indexOf(valeur) < 0) liste = liste.concat([valeur]).sort(function (a, b) { return a - b; });
    return liste.map(function (v) { return '<option value="' + v + '"' + (v === valeur ? ' selected' : '') + '>' + V.fr(v) + ' ' + unite + '</option>'; }).join('');
  }
  // Ne refait une liste que si elle change : la refaire ferme le menu déroulant qu'on est en train d'ouvrir.
  function garnir(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }
  function texture(id) { return (R.TEXTURES.filter(function (t) { return t.id === id; })[0] || R.TEXTURES[0]).nom; }
  U.nomTexture = texture;

  // ---------- Verres ----------
  var cleVerres = '';
  function plaques() {
    var d = V.doc, cle = JSON.stringify(d.verres), z = $('#verres');
    if (cle !== cleVerres) {
      cleVerres = cle;
      z.innerHTML = d.verres.map(function (v, i) {
        return '<button type="button" class="plaque" data-verre="' + v.id + '" title="' + echapper(v.nom) + ', ' + texture(v.texture) + (i < 9 ? ' (' + (i + 1) + ')' : '') + '" aria-label="' + echapper(v.nom) + '"><canvas width="38" height="38"></canvas>' + (i < 9 ? '<span>' + (i + 1) + '</span>' : '') + '</button>';
      }).join('');
      d.verres.forEach(function (v, i) { z.children[i].querySelector('canvas').getContext('2d').drawImage(R.vignette(v, 38, 38), 0, 0); });
    }
    if (!V.verre(U.verre) && d.verres.length) U.verre = d.verres[0].id;
    Array.prototype.forEach.call(z.children, function (b) { b.classList.toggle('actif', Number(b.dataset.verre) === U.verre); });
    var v = V.verre(U.verre);
    $('#verreNom').innerHTML = v ? '<b>' + echapper(v.nom) + '</b> : ' + texture(v.texture) : 'Aucun verre dans l\'atelier.';
    $('#nbVerres').textContent = d.verres.length + ' sur ' + V.VERRES_MAX;
  }

  U.choisirVerre = function (id) {
    if (!V.verre(id)) return;
    U.verre = id;
    plaques();
    if (U.outil !== 'verre') U.choisirOutil('verre');
  };

  // ---------- Pièces et règles ----------
  var SIGNES = { pointe: 'rond', rentrant: 'rond', pendant: 'croix', petite: 'tirets', fine: 'tirets', creux: 'tirets', trou: 'tirets' };

  function pieces() {
    var c = V.calc, av = c.avertissements, f = U.pieceChoisie(), v, mes, m2 = c.aire / 1e6;
    $('#nbPieces').textContent = c.faces.length + (c.faces.length > 1 ? ' pièces, ' : ' pièce, ') + V.fr(m2 < 1 ? Math.round(m2 * 1000) / 1000 : Math.round(m2 * 100) / 100) + ' m²';
    if (f) {
      v = f.verre && V.verre(f.verre);
      mes = f.avert.map(function (a) { return a.texte; });
      $('#pieceInfo').innerHTML = '<b>Pièce ' + f.numero + '</b> : ' + (v ? echapper(v.nom) : 'sans verre') + ', ' + V.fr(f.aire / 100, 1) + ' cm²' + (mes.length ? '. <span class="faute">' + echapper(mes.join(', ')) + '.</span>' : '.');
    } else $('#pieceInfo').textContent = 'Clique une pièce avec l\'outil Verre ou Nœud pour la choisir.';
    $('#nbAvert').textContent = av.length ? av.length + (av.length > 1 ? ' avertissements' : ' avertissement') : 'aucun avertissement';
    $('#avert').innerHTML = av.length ? av.map(function (a, i) {
      return '<li><button type="button" data-i="' + i + '"><i class="signe ' + SIGNES[a.type] + '"></i>' + (a.face ? 'Pièce ' + a.face + ' : ' : '') + echapper(a.texte.charAt(0).toUpperCase() + a.texte.slice(1)) + '</button></li>';
    }).join('') : '<li class="vide">Toutes les pièces se coupent sans risque.</li>';
  }

  // ---------- Rafraîchissement ----------
  U.rafraichir = function () {
    var d = V.doc, f = d.forme, actif = document.activeElement;
    if (!d || !V.calc) return;
    $('#forme').value = f.type;
    if (actif !== $('#largeur')) $('#largeur').value = V.fr(f.l / 10).replace(',', '.');
    if (actif !== $('#hauteur')) $('#hauteur').value = V.fr(f.h / 10).replace(',', '.');
    if (actif !== $('#lobes')) $('#lobes').value = f.lobes;
    $('#rLobes').hidden = f.type !== 'rosace';
    garnir($('#plomb'), options(V.PLOMBS, d.plomb, 'mm'));
    garnir($('#bordure'), options(V.BORDURES, d.bordure, 'mm'));
    garnir($('#grille'), options(V.GRILLES, d.grille, 'mm'));
    $('#aimant').checked = d.aimant;
    $('#regles').checked = U.regles;
    plaques();
    pieces();
    $('#bAnnuler').disabled = !V.peutAnnuler(); $('#bRetablir').disabled = !V.peutRetablir();
    $('#etatInfo').textContent = V.calc.faces.length + ' pièces, ' + (V.calc.avertissements.length || 'aucun') + (V.calc.avertissements.length > 1 ? ' avertissements' : ' avertissement');
    U.redessiner();
  };
  U.surChoix = function () { if (V.calc) pieces(); };

  // ---------- Champs ----------
  function nombre(el) { var v = Number(String(el.value).replace(',', '.')); return el.value !== '' && isFinite(v) ? v : null; }

  // Change la forme ou les mesures : les plombs suivent à l'échelle, et ceux qui sortent du nouveau contour sont rognés.
  function reformer(modif) {
    var d = V.doc, avant = { l: d.forme.l, h: d.forme.h };
    V.marquer();
    modif(d.forme);
    G.refaire(d, d.forme.l / avant.l, d.forme.h / avant.h);
    V.change(true);
    U.ajuster();
  }

  U.initPanneaux = function () {
    $('#forme').innerHTML = G.FORMES.map(function (f) { return '<option value="' + f.id + '">' + f.nom + '</option>'; }).join('');
    $('#forme').addEventListener('change', function () {
      var t = this.value;
      if (t === 'libre' && !(V.doc.forme.libre && V.doc.forme.libre.length >= 3)) {
        this.value = V.doc.forme.type;
        U.choisirOutil('contour');
        U.dire('Trace le contour du panneau d\'un seul geste sur la table.');
        return;
      }
      reformer(function (f) { f.type = t; });
    });
    ['largeur', 'hauteur'].forEach(function (id) {
      $('#' + id).addEventListener('change', function () {
        var v = nombre(this), mm;
        if (v === null) { U.rafraichir(); return; }
        mm = V.borne(Math.round(v * 10), V.COTE_MIN, V.COTE_MAX);
        if (mm !== Math.round(v * 10)) U.dire('Un panneau fait entre ' + V.COTE_MIN / 10 + ' et ' + V.COTE_MAX / 10 + ' cm de côté.');
        if (mm === V.doc.forme[id === 'largeur' ? 'l' : 'h']) { U.rafraichir(); return; }
        reformer(function (f) { f[id === 'largeur' ? 'l' : 'h'] = mm; });
      });
    });
    $('#lobes').addEventListener('change', function () {
      var v = nombre(this);
      if (v === null) { U.rafraichir(); return; }
      reformer(function (f) { f.lobes = V.borne(Math.round(v), 5, 16); });
    });
    $('#plomb').addEventListener('change', function () { V.doc.plomb = Number(this.value); V.change(false); U.dire('Les prochains plombs feront ' + this.value + ' mm. « Panneau, mettre tous les plombs à cette largeur » change ceux qui sont posés.'); });
    $('#bordure').addEventListener('change', function () {
      var l = Number(this.value);
      V.marquer(); V.doc.bordure = l;
      V.doc.plombs.forEach(function (e) { if (e.bord) e.l = l; });
      V.change(false);
    });
    $('#grille').addEventListener('change', function () { V.doc.grille = Number(this.value); V.change(false); });
    $('#aimant').addEventListener('change', function () { V.doc.aimant = this.checked; V.change(false); });
    $('#regles').addEventListener('change', function () { U.regles = this.checked; U.redessiner(); });

    $('#verres').addEventListener('click', function (e) {
      var b = e.target.closest('.plaque');
      if (b) U.choisirVerre(Number(b.dataset.verre));
    });
    $('#verres').addEventListener('dblclick', function (e) { if (e.target.closest('.plaque')) U.agir('verreModifier'); });
    $('#avert').addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]'), a, f;
      if (!b) return;
      a = V.calc.avertissements[Number(b.dataset.i)];
      if (!a) return;
      f = a.face ? V.pieceNumero(a.face) : null;
      U.choisir(f);
      U.centrer(a);
    });
  };
})();
