(function () {
  'use strict';

  var B = window.Banc, M = window.Particules, U = B.ui;

  var DELAI_MSG = 7000;
  var CLE_GROUPES = 'particules.groupes';

  var $ = function (s) { return document.querySelector(s); };
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  U.echapper = echapper;
  function virgule(v, n) { return String(Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).replace('.', ','); }
  U.virgule = virgule;
  function icone(d) { return '<svg viewBox="0 0 20 20">' + d + '</svg>'; }

  var OEIL = icone('<path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2"/>');
  var OEIL_FERME = icone('<path d="M2.5 10s3 4 7.5 4 7.5-4 7.5-4M5 12.5l-1.2 1.8M10 14v2.2M15 12.5l1.2 1.8"/>');

  // ---------- Messages ----------
  var minuterieMsg = null;
  U.dire = function (texte) {
    $('#etatMsg').textContent = texte || '';
    clearTimeout(minuterieMsg);
    if (texte) minuterieMsg = setTimeout(function () { $('#etatMsg').textContent = ''; }, DELAI_MSG);
  };

  // ---------- Réglages ----------
  // Chaque réglage : chemin (voir B.lire), libellé, bornes de la réglette, pas, unité.
  // k : facteur d'affichage (100 pour un pourcentage). max2 : borne de la saisie au clavier, au-delà de la réglette.
  function reg(c, nom, min, max, pas, unite, o) {
    o = o || {};
    o.t = 'reg'; o.c = c; o.nom = nom; o.min = min; o.max = max; o.pas = pas; o.unite = unite || ''; o.k = o.k || 1;
    return o;
  }
  function pct(c, nom, o) { o = o || {}; o.k = 100; return reg(c, nom, 0, 100, 1, '%', o); }
  function forme(c) { return function (cc) { return c.indexOf(cc.emetteur.forme) >= 0; }; }

  var EMETTEURS = [
    ['point', 'Point', '<circle class="plein" cx="10" cy="10" r="2.6"/>'],
    ['ligne', 'Ligne', '<path d="M3 13 17 7"/><circle class="plein" cx="10" cy="10" r="1.6"/>'],
    ['cercle', 'Cercle', '<circle cx="10" cy="10" r="6.5"/>'],
    ['rect', 'Rectangle', '<rect x="3.5" y="5.5" width="13" height="9"/>']
  ];
  var FORMES = [
    ['carre', 'Carré', '<rect class="plein" x="5" y="5" width="10" height="10"/>'],
    ['rond', 'Rond', '<path class="plein" d="M8 4h4v2h2v2h2v4h-2v2h-2v2H8v-2H6v-2H4V8h2V6h2z"/>'],
    ['anneau', 'Anneau', '<path class="plein" d="M8 4h4v2h2v2h2v4h-2v2h-2v2H8v-2H6v-2H4V8h2V6h2zm0 4v4h4V8z"/>'],
    ['plus', 'Croix', '<path class="plein" d="M8 3h4v5h5v4h-5v5H8v-5H3V8h5z"/>'],
    ['trait', 'Trait', '<path class="plein" d="M14 3h3v3h-3zM11 6h3v3h-3zM8 9h3v3H8zM5 12h3v3H5z"/>']
  ];

  var GROUPES = [
    { id: 'sprite', titre: 'Sprite', champs: [
      { t: 'paire', nom: 'Taille', l: [['@w', 'l', 8, 256], ['@h', 'h', 8, 256]], titre: 'Largeur et hauteur du sprite exporté, en pixels' },
      { t: 'graine' },
      { t: 'sol' }
    ] },
    { id: 'emetteur', titre: 'Émetteur', champs: [
      { t: 'choix', c: 'emetteur.forme', liste: EMETTEURS },
      { t: 'paire', nom: 'Position', l: [['emetteur.x', 'x', -256, 512], ['emetteur.y', 'y', -256, 512]], titre: 'Centre de l\'émetteur, en pixels depuis le coin haut gauche du sprite. Se glisse aussi sur la toile.' },
      reg('emetteur.l', 'Longueur', 0, 128, 1, 'px', { si: forme(['ligne', 'cercle', 'rect']), max2: 512, noms: { cercle: 'Diamètre', rect: 'Largeur' } }),
      reg('emetteur.h', 'Hauteur', 0, 128, 1, 'px', { si: forme(['rect']), max2: 512 }),
      reg('emetteur.rot', 'Rotation', -180, 180, 1, '°', { si: forme(['ligne', 'rect']) }),
      { t: 'case', c: 'emetteur.contour', nom: 'Émettre seulement depuis le bord', si: forme(['cercle', 'rect']) }
    ] },
    { id: 'emission', titre: 'Émission', champs: [
      reg('debit', 'Débit', 0, 200, 1, '/s', { max2: 1000, titre: 'Particules par seconde, sans fin : l\'animation boucle sans couture.' }),
      reg('salve', 'Salve', 0, 300, 1, '', { max2: 2000, titre: 'Particules lâchées toutes ensemble à la première image (une explosion, un impact).' }),
      reg('vie', 'Durée de vie', 0.05, 8, 0.05, 's', { max2: 20, dec: 2 }),
      pct('vieVar', 'Variation')
    ] },
    { id: 'depart', titre: 'Départ', champs: [
      reg('vitesse', 'Vitesse', 0, 300, 1, 'px/s', { max2: 2000 }),
      pct('vitesseVar', 'Variation'),
      reg('angle', 'Direction', -180, 180, 1, '°', { si: function (c) { return !c.radial; }, titre: '0° vers le haut, 90° vers la droite. La pointe de la flèche se glisse aussi sur la toile.', min2: -360, max2: 360 }),
      reg('dispersion', 'Dispersion', 0, 360, 1, '°', { titre: 'Ouverture du cône de départ autour de la direction' }),
      { t: 'case', c: 'radial', nom: 'Partir du centre vers l\'extérieur' }
    ] },
    { id: 'forces', titre: 'Forces', champs: [
      reg('gravite', 'Gravité', -400, 400, 1, 'px/s²', { min2: -3000, max2: 3000, titre: 'Positive, elle fait tomber ; négative, elle fait monter (fumée, flammes, bulles).' }),
      reg('vent', 'Vent', -200, 200, 1, 'px/s²', { min2: -3000, max2: 3000, titre: 'Pousse vers la droite (positif) ou vers la gauche (négatif).' }),
      reg('trainee', 'Traînée', 0, 10, 0.1, '/s', { max2: 30, dec: 1, titre: 'Le freinage de l\'air : à 1, une particule perd près des deux tiers de sa vitesse en une seconde.' }),
      reg('turbulence', 'Turbulence', 0, 300, 1, 'px/s²', { max2: 3000, titre: 'Des remous qui font onduler les trajectoires.' }),
      reg('turbEchelle', 'Tourbillons', 1, 64, 1, 'px', { max2: 256, si: function (c) { return c.turbulence > 0; }, titre: 'Taille des remous : petits, ils font trembler ; grands, ils font louvoyer.' })
    ] },
    { id: 'sol', titre: 'Au sol', champs: [
      { t: 'explique' },
      { t: 'liste', c: 'impact', nom: 'La particule', liste: [['traverse', 'traverse le sol'], ['rebond', 'rebondit'], ['arret', 's\'arrête net'], ['disparait', 'disparaît']] },
      pct('rebond', 'Rebond', { si: function (c) { return c.impact === 'rebond'; } }),
      pct('frottement', 'Frottement', { si: function (c) { return c.impact === 'rebond'; } })
    ] },
    { id: 'apparence', titre: 'Apparence', champs: [
      { t: 'choix', c: 'forme', liste: FORMES },
      reg('taille0', 'Taille début', 0, 12, 1, 'px', { max2: 16, si: function (c) { return c.forme !== 'trait'; } }),
      reg('taille1', 'Taille fin', 0, 12, 1, 'px', { max2: 16, si: function (c) { return c.forme !== 'trait'; } }),
      pct('tailleVar', 'Variation', { si: function (c) { return c.forme !== 'trait'; } }),
      reg('etirement', 'Traîne', 0, 150, 1, 'ms', { k: 1000, max2: 1000, si: function (c) { return c.forme === 'trait'; }, titre: 'Longueur du trait : le chemin parcouru pendant ce temps.' })
    ] },
    { id: 'couleur', titre: 'Couleur', champs: [
      { t: 'rampe' },
      { t: 'liste', c: 'couleur', nom: 'Teinte', liste: [['vie', 'suit la rampe au fil de la vie'], ['hasard', 'une teinte de la rampe au hasard']] },
      pct('opacite0', 'Opacité début'),
      pct('opacite1', 'Opacité fin'),
      { t: 'case', c: 'trame', nom: 'Tramer la demi-transparence', titre: 'Tramage ordonné : la particule pâlit en perdant des pixels au lieu de devenir translucide. Sans trame, elle disparaît d\'un coup sous 50 %.' },
      pct('scintille', 'Scintillement', { titre: 'Part des images où chaque particule s\'éteint un instant.' }),
      { t: 'liste', c: 'dessus', nom: 'Par-dessus', liste: [['jeunes', 'les plus jeunes'], ['vieux', 'les plus vieilles']] }
    ] }
  ];

  var ouverts = {};
  try { ouverts = JSON.parse(localStorage.getItem(CLE_GROUPES)) || {}; } catch (e) { ouverts = {}; }

  function htmlChamp(f, i) {
    var id = 'r' + i;
    if (f.t === 'reg') {
      return '<label class="reg" data-i="' + i + '"' + (f.titre ? ' title="' + echapper(f.titre) + '"' : '') + '><span class="nom">' + f.nom + '</span>' +
        '<input type="range" data-c="' + f.c + '" min="' + f.min * 1 + '" max="' + f.max + '" step="' + f.pas + '" aria-label="' + echapper(f.nom) + '">' +
        '<input type="number" data-c="' + f.c + '" min="' + (f.min2 !== undefined ? f.min2 : f.min) + '" max="' + (f.max2 || f.max) + '" step="' + f.pas + '" aria-label="' + echapper(f.nom) + '">' +
        '<span class="unite">' + f.unite + '</span></label>';
    }
    if (f.t === 'paire') {
      return '<div class="paire" data-i="' + i + '" title="' + echapper(f.titre) + '"><span class="nom">' + f.nom + '</span>' + f.l.map(function (p) {
        return '<label>' + p[1] + ' <input type="number" data-c="' + p[0] + '" min="' + p[2] + '" max="' + p[3] + '" step="1"></label>';
      }).join('') + '</div>';
    }
    if (f.t === 'case') return '<label class="case" data-i="' + i + '"' + (f.titre ? ' title="' + echapper(f.titre) + '"' : '') + '><input type="checkbox" data-c="' + f.c + '"> ' + f.nom + '</label>';
    if (f.t === 'liste') {
      return '<label class="reg court" data-i="' + i + '"><span class="nom">' + f.nom + '</span><select data-c="' + f.c + '">' +
        f.liste.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></label>';
    }
    if (f.t === 'choix') {
      return '<div class="formes" data-i="' + i + '" role="radiogroup">' + f.liste.map(function (o) {
        return '<button type="button" data-c="' + f.c + '" data-v="' + o[0] + '" title="' + o[1] + '">' + icone(o[2]) + o[1] + '</button>';
      }).join('') + '</div>';
    }
    if (f.t === 'graine') {
      return '<div class="paire" data-i="' + i + '" title="Le hasard de l\'effet. Même graine, mêmes réglages : mêmes images, partout."><span class="nom">Graine</span>' +
        '<input type="number" data-c="@graine" min="0" max="999999999" step="1" style="width:7.5em"><button type="button" class="btn mini" data-act="graine">Autre</button></div>';
    }
    if (f.t === 'sol') {
      return '<div class="paire" data-i="' + i + '"><label class="nom"><input type="checkbox" data-c="@sol.actif"> Sol</label>' +
        '<label title="Hauteur du sol, en pixels depuis le haut du sprite. Se glisse aussi sur la toile.">à y <input type="number" data-c="@sol.y" min="-256" max="512" step="1"></label></div>';
    }
    if (f.t === 'explique') return '<p class="explique" data-i="' + i + '" id="' + id + '"></p>';
    if (f.t === 'rampe') {
      return '<div data-i="' + i + '" class="rampe-bloc"><div class="rampe" id="rampe"></div><div class="rampe-cmd" style="margin-top:4px">' +
        '<button type="button" class="btn mini" data-rampe="ajouter" title="Ajouter une teinte à la fin de la rampe">+ Teinte</button>' +
        '<button type="button" class="btn mini" data-rampe="retirer" title="Retirer la dernière teinte">− Teinte</button>' +
        '<button type="button" class="btn mini" data-rampe="inverser" title="Retourner la rampe">Inverser</button></div></div>';
    }
    return '';
  }

  var CHAMPS = [];
  function construireReglages() {
    $('#reglages').innerHTML = GROUPES.map(function (gr) {
      var ouvert = ouverts[gr.id] !== false;
      return '<details class="groupe" data-g="' + gr.id + '"' + (ouvert ? ' open' : '') + '><summary>' + gr.titre + '<span class="note" id="note-' + gr.id + '"></span></summary><div class="corps">' +
        gr.champs.map(function (f) { CHAMPS.push(f); return htmlChamp(f, CHAMPS.length - 1); }).join('') + '</div></details>';
    }).join('');
  }

  function afficher(f, v) {
    return f.dec ? Math.round(v * f.k * Math.pow(10, f.dec)) / Math.pow(10, f.dec) : Math.round(v * f.k * 1000) / 1000;
  }

  // Met chaque champ à la valeur du document, sans toucher à celui qu'on est en train de saisir.
  function valeursReglages() {
    var c = B.couche(), d = B.doc, actif = document.activeElement, els, i, el, f, v, bloc;
    $('#note-emetteur').textContent = c.nom;
    for (i = 0; i < CHAMPS.length; i++) {
      f = CHAMPS[i];
      bloc = document.querySelector('[data-i="' + i + '"]');
      if (f.si) bloc.hidden = !f.si(c, d);
      if (f.noms) bloc.querySelector('.nom').textContent = f.noms[c.emetteur.forme] || f.nom;
    }
    els = document.querySelectorAll('#reglages [data-c]');
    for (i = 0; i < els.length; i++) {
      el = els[i];
      v = B.lire(el.dataset.c);
      f = CHAMPS[Number(el.closest('[data-i]').dataset.i)];
      if (el.tagName === 'BUTTON') { el.classList.toggle('actif', el.dataset.v === v); el.setAttribute('aria-checked', el.dataset.v === v); continue; }
      // Seul le champ numérique en cours de frappe est épargné : une case cochée ou une liste qui garde le focus suit Ctrl+Z.
      if (el === actif && el.type === 'number') continue;
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'range' || el.type === 'number') el.value = f && f.t === 'reg' ? afficher(f, v) : v;
      else el.value = v;
    }
    // Pendant qu'on choisit une teinte, on repeint les cases sans les refaire : le sélecteur de couleur resterait sans attache.
    els = $('#rampe').querySelectorAll('label');
    if (els.length === c.rampe.length) {
      for (i = 0; i < els.length; i++) {
        els[i].style.background = c.rampe[i];
        els[i].title = 'Teinte ' + (i + 1) + ' sur ' + c.rampe.length + ' : ' + c.rampe[i] + '. Clique pour la changer.';
        if (els[i].firstChild !== enCours) els[i].firstChild.value = c.rampe[i];
      }
    } else {
      $('#rampe').innerHTML = c.rampe.map(function (h, k) {
        return '<label style="background:' + h + '" title="Teinte ' + (k + 1) + ' sur ' + c.rampe.length + ' : ' + h + '. Clique pour la changer."><input type="color" data-t="' + k + '" value="' + h + '" aria-label="Teinte ' + (k + 1) + '"></label>';
      }).join('');
    }
    // Le sol se règle pour tout l'effet ; chaque couche dit seulement comment elle le touche.
    document.querySelector('[data-g=sol]').classList.toggle('inerte', !d.sol.actif);
    document.querySelector('[data-g=sol] .explique').textContent = d.sol.actif ? 'Le sol est à y = ' + virgule(d.sol.y, 1) + ' pour toutes les couches.' : 'Coche « Sol » dans Sprite pour poser un sol sur lequel les particules rebondissent ou s\'arrêtent.';
    $('#note-sol').textContent = d.sol.actif ? '' : 'pas de sol';
  }

  // Une réglette qu'on glisse ne fait qu'une seule étape d'annulation, et ne recalcule l'effet qu'une fois par image d'écran.
  var enCours = null, attente = 0;
  function bientot() { if (!attente) attente = requestAnimationFrame(function () { attente = 0; B.change(); }); }
  // Fin du geste : le dernier calcul part tout de suite. Chrome n'envoie pas « change » si la réglette revient à sa valeur de départ,
  // d'où l'appel aussi au relâchement et à la perte du focus.
  function finir() { if (attente) { cancelAnimationFrame(attente); attente = 0; B.change(); } enCours = null; }
  function lireChamp(el) {
    var f = CHAMPS[Number(el.closest('[data-i]').dataset.i)], v = Number(el.value), min, max;
    if (el.value === '' || !isFinite(v)) return null;
    if (f && f.t === 'reg') {
      min = f.min2 !== undefined ? f.min2 : f.min; max = f.max2 || f.max;
      return B.borne(v, min, max) / f.k;
    }
    return B.borne(v, Number(el.min), Number(el.max));
  }

  function initReglages() {
    var z = $('#reglages');
    construireReglages();
    z.addEventListener('input', function (e) {
      var el = e.target, v, c, t;
      if (el.type === 'range') {
        v = lireChamp(el);
        if (v === null) return;
        if (enCours !== el) { B.marquer(); enCours = el; }
        B.ecrire(el.dataset.c, v); bientot();
      } else if (el.type === 'color') {
        c = B.couche(); t = Number(el.dataset.t);
        if (enCours !== el) { B.marquer(); enCours = el; }
        c.rampe[t] = el.value; bientot();
      }
    });
    z.addEventListener('change', function (e) {
      var el = e.target, v, f;
      if (el.type === 'range' || el.type === 'color') {
        finir();
        // Un sélecteur de couleur qui n'envoie que « change » (sans « input ») : la teinte est prise ici.
        if (el.type === 'color' && B.couche().rampe[Number(el.dataset.t)] !== el.value) {
          v = B.couche().rampe.slice(); v[Number(el.dataset.t)] = el.value; B.regler('rampe', v);
        }
        return;
      }
      if (!el.dataset.c) return;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.tagName === 'SELECT') v = el.value;
      else v = lireChamp(el);
      if (v !== null) B.regler(el.dataset.c, v);
      // Le champ montre ce qui a été retenu : la valeur bornée, ou l'ancienne s'il a été vidé.
      // Il a encore le focus, et le rafraîchissement épargne le champ en cours de saisie.
      if (el.type === 'number') { f = CHAMPS[Number(el.closest('[data-i]').dataset.i)]; el.value = f && f.t === 'reg' ? afficher(f, B.lire(el.dataset.c)) : B.lire(el.dataset.c); }
      U.rafraichir();
    });
    // La perte du focus ne compte que pour le champ en cours : en glissant une réglette, le champ d'avant perd le focus
    // après le premier « input » de la nouvelle, et couperait le geste en deux étapes d'annulation.
    ['pointerup', 'keyup', 'focusout'].forEach(function (t) { z.addEventListener(t, function (e) { if (enCours && (t !== 'focusout' || e.target === enCours)) finir(); }); });
    // Un nombre tapé sans Entrée est retenu avant que la réglette saisie ne bouge : son « change » tomberait au milieu du geste.
    z.addEventListener('pointerdown', function (e) { var a = document.activeElement; if (a && a.type === 'number' && a !== e.target && z.contains(a)) a.blur(); });
    z.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]'), r = e.target.closest('[data-rampe]'), c = B.couche(), l;
      if (b) { B.regler(b.dataset.c, b.dataset.v); return; }
      if (!r) return;
      l = c.rampe.slice();
      if (r.dataset.rampe === 'ajouter') { if (l.length >= M.RAMPE_MAX) { U.dire('Une rampe a au plus ' + M.RAMPE_MAX + ' teintes.'); return; } l.push(l[l.length - 1]); }
      else if (r.dataset.rampe === 'retirer') { if (l.length < 2) { U.dire('Une rampe garde au moins une teinte.'); return; } l.pop(); }
      else l.reverse();
      B.regler('rampe', l);
    });
    z.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d.dataset || !d.dataset.g) return;
      ouverts[d.dataset.g] = d.open;
      try { localStorage.setItem(CLE_GROUPES, JSON.stringify(ouverts)); } catch (err) { /* sans stockage, les groupes rouvrent tous */ }
    }, true);
  }

  // ---------- Couches ----------
  U.choisirCouche = function (i) {
    i = B.borne(i, 0, B.doc.couches.length - 1);
    if (i === B.ic) return;
    B.ic = i;
    U.rafraichir();
  };
  function listeCouches() {
    var d = B.doc;
    $('#compteCouches').textContent = d.couches.length + ' sur ' + M.COUCHES_MAX;
    // De haut en bas comme on les voit : la couche dessinée en dernier est en tête de liste.
    $('#couches').innerHTML = d.couches.map(function (c, i) { return i; }).reverse().map(function (i) {
      var c = d.couches[i];
      return '<div class="couche' + (i === B.ic ? ' actif' : '') + (c.visible ? '' : ' cache') + '" data-ic="' + i + '" title="Couche ' + (i + 1) + ' : ' + echapper(c.nom) + '. Double-clic pour la renommer.">' +
        '<button type="button" class="ico" data-r="visible" title="' + (c.visible ? 'Cacher la couche' : 'Montrer la couche') + '">' + (c.visible ? OEIL : OEIL_FERME) + '</button>' +
        '<span class="num">' + (i + 1) + '</span><span class="nom">' + echapper(c.nom) + '</span>' +
        '<span class="teintes">' + c.rampe.map(function (h) { return '<i style="background:' + h + '"></i>'; }).join('') + '</span></div>';
    }).join('');
  }
  function initCouches() {
    $('#couches').addEventListener('click', function (e) {
      var r = e.target.closest('.couche'), i;
      if (!r) return;
      i = Number(r.dataset.ic);
      if (e.target.closest('[data-r=visible]')) { B.marquer(); B.doc.couches[i].visible = !B.doc.couches[i].visible; B.change(); }
      else U.choisirCouche(i);
    });
    $('#couches').addEventListener('dblclick', function (e) { if (e.target.closest('.nom')) U.agir('coucheRenommer'); });
  }

  // ---------- Catalogue ----------
  var vignettes = [];
  function initCatalogue() {
    var z = $('#vignettes');
    z.innerHTML = B.PREREGLAGES.map(function (p) {
      return '<button type="button" class="vignette" data-p="' + p.id + '" title="Ouvrir « ' + echapper(p.nom) + ' »"><span class="boite"><canvas></canvas></span><span>' + echapper(p.nom) + '</span></button>';
    }).join('');
    vignettes = B.PREREGLAGES.map(function (p, i) {
      var el = z.children[i], c = el.querySelector('canvas'), e = M.normaliser(p.effet);
      var k = Math.max(1, Math.floor(Math.min(74 / e.w, 62 / e.h)));
      c.width = e.w; c.height = e.h; c.style.width = e.w * k + 'px'; c.style.height = e.h * k + 'px';
      return { p: p, el: el, c: c, e: e, images: null, repos: 0, minuterie: 0 };
    });
    // Les images se calculent après le premier affichage, pour ne pas retarder l'ouverture.
    setTimeout(function () {
      vignettes.forEach(function (v) {
        var plan = M.preparer(v.e), max = -1, f, n;
        v.images = M.images(plan);
        // Au repos, la vignette montre son image la plus fournie.
        for (f = 0; f < v.images.length; f++) { n = v.images[f].reduce(function (s, x) { return s + (x ? 1 : 0); }, 0); if (n > max) { max = n; v.repos = f; } }
        montrer(v, v.repos);
      });
    }, 30);
    z.addEventListener('pointerenter', function (e) { var v = vignette(e.target); if (v) animer(v, true); }, true);
    z.addEventListener('pointerleave', function (e) { var v = vignette(e.target); if (v) animer(v, false); }, true);
    z.addEventListener('click', function (e) {
      var b = e.target.closest('.vignette');
      if (b) U.agir('prereglage:' + b.dataset.p);
    });
  }
  function vignette(el) {
    var b = el.closest && el.closest('.vignette'), i;
    if (!b || b !== el) return null;
    for (i = 0; i < vignettes.length; i++) if (vignettes[i].el === b) return vignettes[i];
    return null;
  }
  function montrer(v, f) {
    var g = v.c.getContext('2d'), im = g.createImageData(v.e.w, v.e.h);
    new Uint32Array(im.data.buffer).set(v.images[f]);
    g.putImageData(im, 0, 0);
  }
  function animer(v, oui) {
    var f = v.repos;
    clearInterval(v.minuterie);
    if (!v.images) return;
    if (!oui) { montrer(v, v.repos); return; }
    v.minuterie = setInterval(function () { f = (f + 1) % v.images.length; montrer(v, f); }, 1000 / v.e.cadence);
  }
  U.marquerPrereglage = function (id) {
    vignettes.forEach(function (v) { v.el.classList.toggle('actif', v.p.id === id); });
  };

  // ---------- La mèche ----------
  // La boucle d'images est une mèche lente : la partie brûlée est derrière, la braise marque l'image en cours.
  var meche, mg, survolMeche = -1;
  var CHANVRE = '#a88d63', CHANVRE_SOMBRE = '#6e5a3c', CHANVRE_CLAIR = '#c9b083', CENDRE = '#3d3936', CENDRE_CLAIRE = '#625b55';
  function hacheMeche(i) { var h = Math.imul(i + 1, 2654435761) >>> 0; return (h ^ (h >>> 15)) / 4294967296 % 1; }

  function geomMeche() {
    var W = meche.clientWidth, n = B.doc.images, g0 = 14, g1 = W - 14;
    return { W: W, n: n, x0: g0, x1: g1, pas: (g1 - g0) / n, y: 14 };
  }

  function dessinerMeche() {
    var dpr = window.devicePixelRatio || 1, q = geomMeche(), W = q.W, H = meche.clientHeight, x, i, f, xb, col, y = q.y, ex, k, s, t;
    if (!W) return;
    if (meche.width !== Math.round(W * dpr) || meche.height !== Math.round(H * dpr)) { meche.width = Math.round(W * dpr); meche.height = Math.round(H * dpr); }
    mg.setTransform(dpr, 0, 0, dpr, 0, 0);
    mg.fillStyle = '#232427'; mg.fillRect(0, 0, W, H);
    xb = Math.round(q.x0 + (U.f + 0.5) * q.pas);
    // La corde : des « pixels » de 2 px, trois rangs dont l'un plus sombre qui tourne, pour la torsion.
    for (x = q.x0; x < q.x1; x += 2) {
      i = (x - q.x0) >> 1;
      if (x < xb - 4) {
        // Brûlée : plus mince, cendre piquée de gris.
        mg.fillStyle = CENDRE; mg.fillRect(x, y + 2, 2, 4);
        if (hacheMeche(i) < 0.35) { mg.fillStyle = CENDRE_CLAIRE; mg.fillRect(x, y + (hacheMeche(i + 99) < 0.5 ? 2 : 4), 2, 2); }
        continue;
      }
      for (k = 0; k < 4; k++) {
        col = (i + k) % 4 === 0 ? CHANVRE_SOMBRE : k === 0 ? CHANVRE_CLAIR : CHANVRE;
        mg.fillStyle = col; mg.fillRect(x, y + k * 2, 2, 2);
      }
    }
    // Les ligatures : une par image, quand elles ont la place de se voir.
    if (q.pas >= 5) {
      for (f = 1; f < q.n; f++) {
        x = Math.round(q.x0 + f * q.pas);
        if (x >= xb - 4) { mg.fillStyle = '#4b3e2a'; mg.fillRect(x, y - 1, 1, 10); }
      }
    }
    if (survolMeche >= 0 && survolMeche !== U.f) {
      mg.fillStyle = 'rgba(255, 255, 255, .12)';
      mg.fillRect(Math.round(q.x0 + survolMeche * q.pas), 2, Math.max(2, Math.round(q.pas)), 24);
    }
    // La braise, en pixels de 2, et quelques étincelles qui changent à chaque image.
    ex = xb - 1;
    mg.fillStyle = '#7a3412'; mg.fillRect(ex - 8, y - 2, 18, 12); mg.fillRect(ex - 6, y - 4, 14, 16);
    mg.fillStyle = '#f0762e'; mg.fillRect(ex - 6, y - 2, 14, 12); mg.fillRect(ex - 4, y - 4, 10, 16);
    mg.fillStyle = '#ffc46b'; mg.fillRect(ex - 4, y, 10, 8); mg.fillRect(ex - 2, y - 2, 6, 12);
    mg.fillStyle = '#fff3c4'; mg.fillRect(ex - 2, y + 2, 6, 4);
    for (s = 0; s < 5; s++) {
      t = hacheMeche(U.f * 13 + s * 7);
      mg.fillStyle = s % 2 ? '#ffc46b' : '#f0762e';
      mg.fillRect(ex + Math.round((t - 0.5) * 26) & ~1, y - 7 - Math.round(hacheMeche(U.f * 5 + s) * 6) & ~1, 2, 2);
    }
    // Les numéros, tous les cinq, et celui de l'image en cours.
    mg.font = '12px "Bahnschrift SemiCondensed", Bahnschrift, "Arial Narrow", sans-serif'; mg.textBaseline = 'top'; mg.textAlign = 'center';
    for (f = 0; f < q.n; f++) {
      if (f !== U.f && f !== 0 && (f + 1) % 5) continue;
      x = q.x0 + (f + 0.5) * q.pas;
      if (f !== U.f && Math.abs(x - xb) < 16) continue;
      mg.fillStyle = f === U.f ? '#ffc46b' : '#909197';
      mg.fillText(String(f + 1), x, y + 20);
    }
  }

  function initMeche() {
    var glisse = false;
    meche = $('#meche'); mg = meche.getContext('2d');
    function image(e) { var r = meche.getBoundingClientRect(), q = geomMeche(); return B.borne(Math.floor((e.clientX - r.left - q.x0) / q.pas), 0, q.n - 1); }
    meche.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (U.joue) U.lire(false);
      glisse = true; meche.setPointerCapture(e.pointerId);
      U.allerImage(image(e));
    });
    meche.addEventListener('pointermove', function (e) {
      var f = image(e);
      if (glisse) U.allerImage(f);
      else if (f !== survolMeche) { survolMeche = f; dessinerMeche(); }
    });
    meche.addEventListener('pointerup', function () { glisse = false; });
    meche.addEventListener('pointercancel', function () { glisse = false; });
    meche.addEventListener('pointerleave', function () { survolMeche = -1; dessinerMeche(); });
  }

  // ---------- Lecture ----------
  U.allerImage = function (f) {
    var n = B.doc.images;
    f = ((Math.round(f) % n) + n) % n;
    if (f === U.f) return;
    U.f = f;
    U.surImage();
  };
  U.surImage = function () {
    dessinerMeche(); U.redessiner(); infoEtat();
  };

  // generation : arrêter puis relancer dans la même image ne laisse pas tourner deux boucles.
  var dernierTemps = 0, reste = 0, generation = 0;
  function tic(t, g) {
    var duree = 1000 / B.doc.cadence, avance = 0;
    if (!U.joue || g !== generation) return;
    reste += Math.min(250, t - dernierTemps); dernierTemps = t;
    while (reste >= duree) { reste -= duree; avance++; }
    if (avance) { U.f = (U.f + avance) % B.doc.images; U.surImage(); }
    requestAnimationFrame(function (t2) { tic(t2, g); });
  }
  // Sans argument : bascule.
  U.lire = function (etat) {
    etat = etat === undefined ? !U.joue : etat;
    if (etat === U.joue) return;
    if (etat && B.doc.images < 2) { U.dire('L\'animation n\'a qu\'une image.'); return; }
    U.joue = etat;
    $('#bLire').textContent = etat ? '■ Arrêter' : '▶ Lire';
    var g = ++generation;
    if (etat) { dernierTemps = performance.now(); reste = 0; requestAnimationFrame(function (t) { tic(t, g); }); }
  };

  // ---------- Rafraîchissement ----------
  function infoEtat() {
    var d = B.doc, n = M.compte(B.plan(), U.f);
    $('#etatInfo').textContent = d.couches.length + (d.couches.length > 1 ? ' couches' : ' couche') + ', ' + n + (n > 1 ? ' particules' : ' particule') + ' à l\'image ' + (U.f + 1);
  }

  U.rafraichir = function () {
    var d = B.doc, p = B.plan(), nb = p.couches[B.ic].naissances || 0, flux = d.couches.some(function (c) { return c.visible && c.debit > 0; }), salve = d.couches.some(function (c) { return c.visible && c.salve > 0; }), b = $('#boucleInfo');
    if (U.f >= d.images) U.f = d.images - 1;
    listeCouches(); valeursReglages();
    if (document.activeElement !== $('#nImages')) $('#nImages').value = d.images;
    if (document.activeElement !== $('#cadence')) $('#cadence').value = d.cadence;
    $('#duree').textContent = virgule(d.images / d.cadence, 2) + ' s';
    // Le débit est arrondi à un nombre entier de naissances par boucle, pour qu'elle raccorde sans couture.
    $('#note-emission').textContent = B.couche().visible && B.couche().debit > 0 ? nb + ' par boucle, soit ' + virgule(nb * d.cadence / d.images, 1) + '/s' : '';
    if (B.salveCoupee()) { b.textContent = 'Attention : la salve vit plus longtemps que l\'animation, elle sera coupée'; b.style.color = '#e2665a'; }
    else {
      b.style.color = '';
      b.textContent = flux && salve ? 'En boucle, et une salve à l\'image 1' : flux ? 'Boucle sans couture' : salve ? 'Une seule fois : la salve part à l\'image 1' : 'Rien n\'est émis';
    }
    $('#bAnnuler').disabled = !B.peutAnnuler(); $('#bRetablir').disabled = !B.peutRetablir();
    dessinerMeche(); infoEtat();
    U.redessiner();
  };

  U.initPanneaux = function () {
    initReglages(); initCouches(); initCatalogue(); initMeche();
    $('#nImages').addEventListener('change', function () {
      var v = Number(this.value);
      if (this.value !== '' && isFinite(v)) B.regler('@images', B.borne(Math.round(v), 1, M.IMAGES_MAX));
      this.value = B.doc.images;
      U.rafraichir();
    });
    $('#cadence').addEventListener('change', function () {
      var v = Number(this.value);
      if (this.value !== '' && isFinite(v)) B.regler('@cadence', B.borne(Math.round(v), 1, M.CADENCE_MAX));
      this.value = B.doc.cadence;
      U.rafraichir();
    });
    if (window.ResizeObserver) new ResizeObserver(dessinerMeche).observe($('#meche'));
  };
})();
