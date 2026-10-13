(function () {
  'use strict';

  var M = window.Tuiles, U = M.ui, J = M.jeux, A = M.auto;

  var ZOOM_PALETTE_MAX = 8;
  var TYPES_OBJET = ['départ', 'coffre', 'porte', 'déclencheur', 'pnj', 'ennemi', 'pièce', 'sortie'];
  var DUREE_MSG = 6000;

  var $ = function (s) { return document.querySelector(s); };
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  U.echapper = echapper;

  // ---------- Icônes ----------
  var TRACES = {
    tampon: '<path d="M7.5 3h5v4.5l2.5 3.5v2h-10v-2L7.5 7.5z"/><path d="M4 16.5h12"/>',
    terrain: '<path d="M3.5 9a5 5 0 015-5h3a5 5 0 015 5v2a5 5 0 01-5 5h-3a5 5 0 01-5-5z"/><path d="M7.5 8.5h5v3h-5z"/>',
    gomme: '<path d="M4.6 12.4l7-7a1.4 1.4 0 012 0l2.9 2.9a1.4 1.4 0 010 2L11 15.800H7.900z"/><path d="M8.300 8.700l4.900 4.900M7 16.500h9.500"/>',
    pot: '<path d="M9.2 3.200l6.500 6.500-5 5a1.800 1.800 0 01-2.600 0L4.400 11a1.800 1.800 0 010-2.600z"/><path d="M4.300 9.700h11"/><path class="plein" d="M16.700 12.500s1.500 2.100 1.500 3.200a1.500 1.500 0 01-3 0c0-1.100 1.500-3.200 1.500-3.200z"/>',
    rect: '<path d="M3.500 5h13v10h-13z"/>',
    ligne: '<path d="M5 15L15 5"/><circle class="plein" cx="5" cy="15" r="1.600"/><circle class="plein" cx="15" cy="5" r="1.600"/>',
    pipette: '<path d="M12.800 3.400l3.800 3.800-2.100 2.100-3.800-3.800z"/><path d="M11.300 6.900L4.800 13.400V15.700h2.300l6.500-6.500"/>',
    selection: '<path d="M3.500 6.500v-3h3M9 3.500h2M13.500 3.500h3v3M16.500 9v2M16.500 13.500v3h-3M11 16.500H9M6.500 16.500h-3v-3M3.500 11V9"/>',
    main: '<path d="M7 10.500V5.200a1.150 1.150 0 012.300 0v4.300V4.200a1.150 1.150 0 012.300 0v5.300V5.200a1.150 1.150 0 012.300 0v5.300V7.700a1.150 1.150 0 012.300 0v4.800c0 2.800-2 4.500-4.800 4.500-2.300 0-3.700-.9-4.900-3.300L4.600 11a1.150 1.150 0 012-1.100z"/>',
    objSel: '<path d="M5.500 3.500l9.500 7.500-4.300.5 2.300 4.800-1.900.900-2.300-4.900L5.500 15z"/>',
    objPoint: '<path d="M10 3l5.500 7L10 17 4.500 10z"/><circle class="plein" cx="10" cy="10" r="1.500"/>',
    objRect: '<path d="M5 6h10v8H5z"/><path class="plein" d="M3.500 4.500h3v3h-3zM13.500 4.500h3v3h-3zM3.500 12.500h3v3h-3zM13.500 12.500h3v3h-3z"/>',
    oeil: '<path d="M2.500 10s2.800-4.500 7.500-4.500S17.500 10 17.500 10s-2.800 4.500-7.500 4.500S2.500 10 2.500 10z"/><circle cx="10" cy="10" r="2"/>',
    oeilFerme: '<path d="M3 8.500c1.500 2 4 3.500 7 3.500s5.500-1.500 7-3.500M5 11.500l-1.200 1.800M10 12v2.300M15 11.500l1.200 1.800"/>',
    verrou: '<path d="M5.500 9.500h9v6.500h-9z"/><path d="M7.500 9.500V7a2.500 2.500 0 015 0v2.500"/>',
    verrouOuvert: '<path d="M5.500 9.500h9v6.500h-9z"/><path d="M7.500 9.500V6.500a2.500 2.500 0 014.800-.9"/>',
    plus: '<path d="M10 4.500v11M4.500 10h11"/>',
    copie: '<path d="M7 7h9v9H7z"/><path d="M4 13V4h9"/>',
    haut: '<path d="M10 15.500v-11M5.500 9L10 4.500 14.500 9"/>',
    bas: '<path d="M10 4.500v11M5.500 11l4.500 4.500 4.500-4.500"/>',
    corbeille: '<path d="M4.500 6h11M8 6V4h4v2M6 6l.7 10h6.600L14 6M8.500 8.500v5M11.500 8.500v5"/>',
    miroirH: '<path d="M10 3v14" stroke-dasharray="2 2"/><path d="M7.500 6L3.500 10l4 4zM12.500 6l4 4-4 4z"/>',
    miroirV: '<path d="M3 10h14" stroke-dasharray="2 2"/><path d="M6 7.500L10 3.500l4 4zM6 12.500l4 4 4-4z"/>',
    tourner: '<path d="M15.500 10a5.500 5.500 0 11-2-4.200"/><path d="M14 2.500v3.700h-3.700"/>',
    de: '<path d="M4 4h12v12H4z"/><circle class="plein" cx="7.300" cy="7.300" r="1.100"/><circle class="plein" cx="12.700" cy="12.700" r="1.100"/><circle class="plein" cx="10" cy="10" r="1.100"/>',
    grille: '<path d="M3.500 3.500h13v13h-13zM3.500 8h13M3.500 12h13M8 3.500v13M12 3.500v13"/>',
    murs: '<path d="M3.500 3.500h13v13h-13z"/><path d="M3.500 16.500l13-13M3.500 10l6.500-6.500M10 16.500l6.500-6.500"/>',
    annuler: '<path d="M7 5L3.500 8.500 7 12"/><path d="M3.500 8.500H12a4 4 0 010 8H8"/>',
    retablir: '<path d="M13 5l3.500 3.500L13 12"/><path d="M16.500 8.500H8a4 4 0 000 8h4"/>',
    jouer: '<path class="plein" d="M6 4l10 6-10 6z"/>',
    tuiles: '<path d="M3.500 3.500h5.500v5.500H3.500zM11 3.500h5.500v5.500H11zM3.500 11h5.500v5.500H3.500zM11 11h5.500v5.500H11z"/>',
    objets: '<path d="M10 3l5.500 7L10 17 4.500 10z"/>',
    collisions: '<path d="M3.500 16.500v-6h6v-6h7v12z"/>',
    importer: '<path d="M10 3.500v9M6 9l4 4 4-4M4 16.500h12"/>',
    moins: '<path d="M4.500 10h11"/>',
    croix: '<path d="M5.500 5.500l9 9M14.500 5.500l-9 9"/>'
  };
  function icone(nom) { return '<svg viewBox="0 0 20 20" aria-hidden="true">' + TRACES[nom] + '</svg>'; }
  U.icone = icone;

  // ---------- Messages ----------
  var minuterieMsg = null;
  U.message = function (texte) {
    $('#etatMsg').textContent = texte;
    clearTimeout(minuterieMsg);
    minuterieMsg = setTimeout(function () { $('#etatMsg').textContent = ''; }, DUREE_MSG);
  };

  // ---------- Outils ----------
  function construireOutils() {
    var type = M.calqueActif().type;
    $('#outils').innerHTML = U.OUTILS.filter(function (o) { return o.types.indexOf(type) >= 0; }).map(function (o) {
      return (o.id === 'main' || o.id === 'pipette' ? '<i class="filet"></i>' : '') +
        '<button type="button" class="outil' + (o.id === U.outil ? ' actif' : '') + '" data-outil="' + o.id + '" title="' + echapper(o.nom) + ' (' + o.touche + ')" aria-label="' + echapper(o.nom) + '">' + icone(o.id) + '</button>';
    }).join('');
  }

  function bouton(act, ico, titre, actif) { return '<button type="button" class="b carre' + (actif ? ' actif' : '') + '" data-act="' + act + '" title="' + echapper(titre) + '" aria-label="' + echapper(titre) + '">' + icone(ico) + '</button>'; }
  function coche(id, texte, etat, titre) { return '<label class="coche" title="' + echapper(titre || '') + '"><input type="checkbox" data-opt="' + id + '"' + (etat ? ' checked' : '') + '> ' + texte + '</label>'; }

  function construireOptions() {
    var o = U.outilInfo(U.outil), h = '<strong>' + echapper(o.nom) + '</strong>', t, type = M.calqueActif().type;
    var orienter = bouton('miroirH', 'miroirH', 'Miroir horizontal (X)') + bouton('miroirV', 'miroirV', 'Miroir vertical (Y)') + (type === 'tuiles' || U.outil === 'selection' ? bouton('tourner', 'tourner', 'Quart de tour (Z, Maj+Z dans l\'autre sens)') : '');
    if (U.outil === 'tampon') h += (type === 'tuiles' ? coche('aleatoire', 'Au hasard parmi les tuiles choisies', U.aleatoire, 'Chaque case reçoit une des tuiles sélectionnées dans le jeu (D)') : '') + '<span class="grappe">' + orienter + '</span>';
    else if (U.outil === 'rect') h += coche('plein', 'Plein', U.plein) + (type === 'tuiles' ? coche('aleatoire', 'Au hasard', U.aleatoire, 'Chaque case reçoit une des tuiles sélectionnées dans le jeu (D)') : '');
    else if (U.outil === 'pot') h += coche('contigu', 'Zone contiguë', U.contigu, 'Décoché : toutes les cases identiques de la carte') + (type === 'tuiles' ? coche('aleatoire', 'Au hasard', U.aleatoire, 'Chaque case reçoit une des tuiles sélectionnées dans le jeu (D)') : '');
    else if (U.outil === 'ligne' && type === 'tuiles') h += coche('aleatoire', 'Au hasard', U.aleatoire);
    else if (U.outil === 'selection') h += '<span class="grappe"><button type="button" class="b" data-act="copier">Copier</button><button type="button" class="b" data-act="couper">Couper</button><button type="button" class="b" data-act="supprimer">Vider</button></span><span class="grappe">' + orienter + '</span>';
    else if (U.outil === 'terrain') {
      t = U.terrainActif();
      h += '<select data-opt="terrain" aria-label="Terrain">' + M.carte.jeux.map(function (j) {
        return j.terrains.map(function (ter, i) { return '<option value="' + j.id + ':' + i + '"' + (t && t.jeu === j && t.terrain === ter ? ' selected' : '') + '>' + echapper(ter.nom) + ' (' + ter.forme + ' tuiles)</option>'; }).join('');
      }).join('') + '</select>';
    }
    h += '<span class="astuce">' + echapper(o.aide) + '</span>';
    $('#optionsOutil').innerHTML = h;
  }

  function majVue() {
    var col = M.calqueDeType('collisions');
    $('#zoomVal').textContent = U.zoomTexte();
    $('#bGrille').classList.toggle('actif', U.grille);
    $('#bMurs').classList.toggle('actif', col.visible);
  }
  U.surVue = majVue;

  // ---------- Calques ----------
  function construireCalques() {
    var c = M.carte, h = '', k, cal, actif = M.calqueActif(), nbTuiles = c.calques.filter(function (x) { return x.type === 'tuiles'; }).length;
    for (k = c.calques.length - 1; k >= 0; k--) {
      cal = c.calques[k];
      h += '<div class="calque g-' + cal.type + (k === c.iCalque ? ' actif' : '') + (cal.visible ? '' : ' cache') + '" data-i="' + k + '">' +
        '<span class="genre" title="' + (cal.type === 'tuiles' ? 'Calque de tuiles' : cal.type === 'objets' ? 'Calque d\'objets' : 'Calque de collisions') + '">' + icone(cal.type) + '</span>' +
        '<span class="nom">' + echapper(cal.nom) + '</span>' +
        (cal.opacite < 1 ? '<span class="op">' + Math.round(cal.opacite * 100) + ' %</span>' : '') +
        '<button type="button" class="ico' + (cal.verrou ? ' marque' : '') + '" data-r="verrou" title="' + (cal.verrou ? 'Déverrouiller' : 'Verrouiller') + '">' + icone(cal.verrou ? 'verrou' : 'verrouOuvert') + '</button>' +
        '<button type="button" class="ico" data-r="visible" title="' + (cal.visible ? 'Masquer' : 'Montrer') + '">' + icone(cal.visible ? 'oeil' : 'oeilFerme') + '</button></div>';
    }
    $('#calques').innerHTML = h;
    $('#calOpacite').value = Math.round(actif.opacite * 100);
    $('#calOpaciteVal').textContent = Math.round(actif.opacite * 100) + ' %';
    document.querySelector('[data-act=calDupliquer]').disabled = actif.type !== 'tuiles';
    document.querySelector('[data-act=calSupprimer]').disabled = actif.type !== 'tuiles' || nbTuiles < 2;
    document.querySelector('[data-act=calMonter]').disabled = c.iCalque >= c.calques.length - 1;
    document.querySelector('[data-act=calDescendre]').disabled = c.iCalque <= 0;
  }

  function renommerCalque(ligne) {
    var i = Number(ligne.dataset.i), span = ligne.querySelector('.nom'), champ = document.createElement('input'), fini = false;
    champ.type = 'text'; champ.className = 'nom'; champ.maxLength = 40; champ.value = M.carte.calques[i].nom;
    span.replaceWith(champ);
    champ.focus(); champ.select();
    function clore(garder) {
      if (fini) return;
      fini = true;
      if (!garder || !M.calqueRegler(i, 'nom', champ.value)) construireCalques();
    }
    champ.addEventListener('blur', function () { clore(true); });
    champ.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') clore(true); else if (e.key === 'Escape') clore(false);
    });
  }

  // ---------- Jeu de tuiles ----------
  U.jeuActif = 0;                         // id du jeu montré dans la palette
  U.selJeu = { x: 0, y: 0, w: 1, h: 1 };  // tuiles choisies dans ce jeu
  U.zoomPalette = 0;                      // 0 : ajusté à la largeur du volet

  var signaturePalette = '', gestePalette = null, ficheLue = false;

  function jeuMontre() {
    var j = M.jeuParId(U.jeuActif);
    if (!j && M.carte.jeux.length) { j = M.carte.jeux[0]; U.jeuActif = j.id; U.selJeu = { x: 0, y: 0, w: 1, h: 1 }; }
    return j || null;
  }
  U.jeuMontre = jeuMontre;

  function echellePalette(j) {
    var place = ($('#puits').clientWidth - 14) * U.echelle();
    return U.zoomPalette || Math.max(1, Math.min(4, Math.floor(place / j.w)));
  }

  function dessinerPalette() {
    var j = jeuMontre(), c = $('#palette'), g, k, e, t = performance.now(), s = U.selJeu, rangs, sig = '', x, y, im, ep;
    if (!j || M.calqueActif().type !== 'tuiles') return;
    e = echellePalette(j); rangs = Math.ceil(j.nb / j.cols);
    if (c.width !== j.w * e || c.height !== j.h * e) { c.width = j.w * e; c.height = j.h * e; }
    c.style.width = c.width / U.echelle() + 'px'; c.style.height = c.height / U.echelle() + 'px';
    g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(U.toileJeu(j), 0, 0, j.w * e, j.h * e);
    for (k in j.anims) {
      k = Number(k); im = U.anime ? J.imageA(j, k, t) : k; sig += im + ',';
      x = (k % j.cols) * j.tw * e; y = Math.floor(k / j.cols) * j.th * e;
      g.clearRect(x, y, j.tw * e, j.th * e);
      g.drawImage(U.toileJeu(j), (im % j.cols) * j.tw, Math.floor(im / j.cols) * j.th, j.tw, j.th, x, y, j.tw * e, j.th * e);
      g.fillStyle = 'rgba(24,24,26,.8)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + 1, y + 1); g.lineTo(x + 6, y + 1); g.lineTo(x + 1, y + 6); g.fill();
    }
    signaturePalette = sig;
    g.fillStyle = 'rgba(0,0,0,.3)';
    for (x = 1; x < j.cols; x++) g.fillRect(x * j.tw * e, 0, 1, c.height);
    for (y = 1; y < rangs; y++) g.fillRect(0, y * j.th * e, c.width, 1);
    j.terrains.forEach(function (ter) {
      var a = ter.base, b = ter.base + ter.forme - 1, ya = Math.floor(a / j.cols), yb = Math.floor(b / j.cols);
      g.fillStyle = U.CYAN;
      g.fillRect(0, ya * j.th * e, 2, (yb - ya + 1) * j.th * e);
    });
    ep = 2;
    x = s.x * j.tw * e; y = s.y * j.th * e;
    g.fillStyle = '#18181a'; g.fillRect(x - 1, y - 1, s.w * j.tw * e + 2, ep + 1); g.fillRect(x - 1, y + s.h * j.th * e - ep, s.w * j.tw * e + 2, ep + 1); g.fillRect(x - 1, y, ep + 1, s.h * j.th * e); g.fillRect(x + s.w * j.tw * e - ep, y, ep + 1, s.h * j.th * e);
    g.fillStyle = U.AMBRE; g.fillRect(x, y, s.w * j.tw * e, ep); g.fillRect(x, y + s.h * j.th * e - ep, s.w * j.tw * e, ep); g.fillRect(x, y, ep, s.h * j.th * e); g.fillRect(x + s.w * j.tw * e - ep, y, ep, s.h * j.th * e);
  }
  U.dessinerPalette = dessinerPalette;

  // Les tuiles choisies dans la palette deviennent le tampon.
  function tamponDepuisPalette() {
    var j = jeuMontre(), s = U.selJeu, b, x, y, k, t;
    if (!j) { U.tampon = null; return; }
    b = M.bloc(s.w, s.h);
    for (y = 0; y < s.h; y++) for (x = 0; x < s.w; x++) { k = (s.y + y) * j.cols + s.x + x; b.cases[y * s.w + x] = k < j.nb ? j.premier + k : 0; }
    U.tampon = Array.prototype.some.call(b.cases, function (v) { return v; }) ? b : null;
    t = U.tampon ? A.terrainDe(b.cases[0]) : null;
    if (t) U.terrain = { jeu: t.jeu.id, i: t.i };
  }
  U.tamponDepuisPalette = tamponDepuisPalette;

  // Après une pipette : montre dans la palette la tuile prise, quand le tampon tient dans un seul jeu.
  U.surTampon = function (depuisCarte) {
    var b = U.tampon, j, k, s;
    if (depuisCarte && b && M.calqueActif().type === 'tuiles') {
      j = M.jeuDe(b.cases[0] & M.NUMERO);
      if (j) {
        U.jeuActif = j.id;
        k = (b.cases[0] & M.NUMERO) - j.premier;
        s = { x: k % j.cols, y: Math.floor(k / j.cols), w: 1, h: 1 };
        // Un bloc pris tel quel dans le jeu y retrouve son cadre.
        if (b.w * b.h > 1 && s.x + b.w <= j.cols && Array.prototype.every.call(b.cases, function (v, i) { return v === j.premier + (s.y + Math.floor(i / b.w)) * j.cols + s.x + i % b.w; })) { s.w = b.w; s.h = b.h; }
        U.selJeu = s;
        k = A.terrainDe(b.cases[0]);
        if (k) U.terrain = { jeu: k.jeu.id, i: k.i };
      }
    }
    construireSource();
    construireOptions();
    majEtat();
  };

  function casePalette(e) {
    var j = jeuMontre(), c = $('#palette'), r = c.getBoundingClientRect(), rangs = Math.ceil(j.nb / j.cols);
    return { x: M.borne(Math.floor((e.clientX - r.left) / r.width * j.cols), 0, j.cols - 1), y: M.borne(Math.floor((e.clientY - r.top) / r.height * rangs), 0, rangs - 1) };
  }

  function infoTuile(j, k) {
    var nom = j.noms[k], t = A.terrainDe(j.premier + k), txt = 'tuile ' + k + ' de « ' + j.nom + ' »';
    txt = nom ? nom + ', ' + txt : t ? 'Terrain ' + t.terrain.nom + ', ' + txt : 'T' + txt.slice(1);
    if (j.anims[k]) txt += ', animée (' + j.anims[k].length + ' images)';
    return txt;
  }

  function construireSource() {
    var cal = M.calqueActif(), z = $('#source'), j, h, s, k, objets, o;
    z.className = 'volet source s-' + cal.type;
    if (cal.type === 'collisions') {
      h = '<h2>Collisions</h2><p class="note">Choisis ce que tu poses sur le calque de collisions, puis dessine avec les mêmes outils que les tuiles.</p><div class="genres">';
      M.COLLISIONS.forEach(function (t) {
        h += '<button type="button" class="genreCol' + (U.tamponCol.w === 1 && U.tamponCol.h === 1 && U.tamponCol.cases[0] === t.v ? ' actif' : '') + '" data-col="' + t.v + '"><canvas width="26" height="26" data-v="' + t.v + '"></canvas><span>' + echapper(t.nom) + '</span><kbd>' + t.v + '</kbd></button>';
      });
      h += '</div><p class="note">En mode « vue de dessus », une pente compte comme un mur et une plateforme ne gêne pas.</p>';
      z.innerHTML = h;
      z.querySelectorAll('canvas').forEach(function (c) {
        var g = c.getContext('2d'), v = Number(c.dataset.v);
        g.fillStyle = '#55555a'; g.fillRect(0, 0, 26, 26);
        g.fillStyle = '#4b4b50'; g.fillRect(13, 0, 13, 13); g.fillRect(0, 13, 13, 13);
        U.dessinerCollision(g, v, 1, 1, 24);
      });
      return;
    }
    if (cal.type === 'objets') {
      objets = cal.objets; o = U.objSel ? M.objet(U.objSel) : null;
      // Juste après une saisie dans la fiche, elle reste en place : la refaire volerait le focus (Tab) et le clic en cours.
      if (ficheLue && o && $('#fiche') && majListeObjets(objets)) return;
      h = '<h2>Objets <span class="compte">' + (objets.length || '') + '</span></h2>';
      if (!objets.length) h += '<p class="note">Aucun objet. Pose un point (P) pour le départ du joueur, ou trace une zone (R) pour une porte, un coffre, un déclencheur.</p>';
      h += '<div class="liste' + (o ? '' : ' seule') + '" id="listeObjets">' + objets.map(function (ob) {
        return '<button type="button" class="ligneObjet' + (o === ob ? ' actif' : '') + '" data-id="' + ob.id + '">' + icone(ob.w || ob.h ? 'rect' : 'objets') + '<span>' + echapper(ob.nom || '(sans nom)') + '</span><em>' + echapper(ob.type) + '</em></button>';
      }).join('') + '</div>';
      if (o) {
        h += '<form class="fiche" id="fiche" autocomplete="off"><label>Nom <input type="text" name="nom" maxlength="40" value="' + echapper(o.nom) + '"></label>' +
          '<label>Type <input type="text" name="type" maxlength="40" list="typesObjet" value="' + echapper(o.type) + '" placeholder="départ, coffre, porte…"></label>' +
          '<datalist id="typesObjet">' + TYPES_OBJET.map(function (t) { return '<option value="' + t + '">'; }).join('') + '</datalist>' +
          '<div class="quatre"><label>x <input type="number" name="x" value="' + o.x + '"></label><label>y <input type="number" name="y" value="' + o.y + '"></label>' +
          (o.w || o.h ? '<label>larg. <input type="number" name="w" min="1" value="' + o.w + '"></label><label>haut. <input type="number" name="h" min="1" value="' + o.h + '"></label>' : '<span class="note">Point, en pixels de carte</span>') + '</div>' +
          '<h3>Propriétés</h3><div id="props">' + o.props.map(function (p) {
            return '<div class="prop"><input type="text" data-p="cle" maxlength="60" value="' + echapper(p[0]) + '" placeholder="clé" aria-label="Clé"><input type="text" data-p="val" maxlength="400" value="' + echapper(p[1]) + '" placeholder="valeur" aria-label="Valeur"><button type="button" class="ico" data-oter title="Retirer cette propriété">' + icone('croix') + '</button></div>';
          }).join('') + '</div>' +
          '<div class="rang"><button type="button" class="b" data-act="propAjouter">Ajouter une propriété</button><button type="button" class="b" data-act="supprimer">Supprimer l\'objet</button></div></form>';
      } else if (objets.length) h += '<p class="note">Clique un objet, ici ou sur la carte, pour voir son nom, son type et ses propriétés.</p>';
      z.innerHTML = h;
      return;
    }
    j = jeuMontre();
    h = '<h2>Jeu de tuiles</h2><div class="rang"><select id="choixJeu" aria-label="Jeu de tuiles affiché">' + M.carte.jeux.map(function (x) { return '<option value="' + x.id + '"' + (j === x ? ' selected' : '') + '>' + echapper(x.nom) + '</option>'; }).join('') + '</select>' +
      bouton('jeuImporter', 'importer', 'Importer une image, un atlas de Textures ou un projet Atelier Pixel') + bouton('jeuTextures', 'tuiles', 'Générer des tuiles avec Textures') + '</div>';
    if (!j) {
      z.innerHTML = h + '<p class="note">Aucun jeu de tuiles. Importe une image découpée en grille, un atlas de Textures, un sprite d\'Atelier Pixel, ou génère des tuiles sur place.</p><div class="rang"><button type="button" class="b fort" data-act="jeuDemo">Tuiles de démonstration</button></div>';
      return;
    }
    s = U.selJeu; k = s.y * j.cols + s.x;
    h += '<div class="puits" id="puits"><canvas id="palette"></canvas></div>' +
      '<div class="rang pied"><span class="note" id="infoPalette">' + echapper(s.w * s.h > 1 ? s.w + ' × ' + s.h + ' tuiles choisies' : infoTuile(j, Math.min(k, j.nb - 1))) + '</span>' +
      '<span class="grappe">' + bouton('paletteMoins', 'moins', 'Réduire le jeu de tuiles') + bouton('palettePlus', 'plus', 'Agrandir le jeu de tuiles') + '</span></div>';
    if (j.terrains.length) {
      h += '<div class="terrains">' + j.terrains.map(function (ter, i) {
        var actif = U.outil === 'terrain' && U.terrain && U.terrain.jeu === j.id && U.terrain.i === i;
        return '<button type="button" class="b' + (actif ? ' actif' : '') + '" data-terrain="' + i + '" title="Tracer ce terrain : les bords se raccordent tout seuls (T)">' + icone('terrain') + echapper(ter.nom) + '</button>';
      }).join('') + '</div>';
    }
    z.innerHTML = h;
    dessinerPalette();
  }
  U.construireSource = construireSource;

  // ---------- Fiche d'objet ----------
  // Met à jour sur place les noms de la liste d'objets ; rend faux si la liste a changé de longueur.
  function majListeObjets(objets) {
    var l = document.querySelectorAll('#listeObjets .ligneObjet');
    if (l.length !== objets.length) return false;
    objets.forEach(function (ob, k) { l[k].querySelector('span').textContent = ob.nom || '(sans nom)'; l[k].querySelector('em').textContent = ob.type; });
    return true;
  }

  function lireFiche() {
    var f = $('#fiche'), o = U.objSel ? M.objet(U.objSel) : null, champs, props = [];
    if (!f || !o) return;
    champs = { nom: f.elements.nom.value, type: f.elements.type.value, x: Number(f.elements.x.value) || 0, y: Number(f.elements.y.value) || 0 };
    if (f.elements.w) { champs.w = Math.max(1, Number(f.elements.w.value) || 1); champs.h = Math.max(1, Number(f.elements.h.value) || 1); }
    f.querySelectorAll('.prop').forEach(function (l) {
      var cle = l.querySelector('[data-p=cle]').value.trim();
      if (cle) props.push([cle, l.querySelector('[data-p=val]').value]);
    });
    champs.props = props;
    M.objetModifier(o.id, champs);
    ficheLue = true;
    M.valider('Modifier l\'objet');
    ficheLue = false;
  }

  U.surObjet = function (saisir) {
    var f;
    if (M.calqueActif().type !== 'objets') return;
    construireSource();
    if (saisir) { f = $('#fiche'); if (f) { f.elements.nom.focus(); f.elements.nom.select(); } }
  };

  // ---------- Barre d'état ----------
  function majEtat() {
    var c = M.carte, s = U.survol, cal = M.calqueActif(), v, j, txt = '', h = M.histEtat();
    if (s && U.dansCarte(s)) {
      $('#etatPos').textContent = 'x ' + s.x + '  y ' + s.y;
      if (cal.type === 'tuiles') {
        v = M.lire(cal, s.x, s.y); j = v ? M.jeuDe(v & M.NUMERO) : null;
        txt = v ? (j ? infoTuile(j, (v & M.NUMERO) - j.premier) : 'Tuile d\'un jeu supprimé') : 'Case vide';
        if (v > M.NUMERO) txt += ', retournée';
      } else if (cal.type === 'collisions') txt = M.COLLISIONS[M.lire(cal, s.x, s.y)].nom;
    } else $('#etatPos').textContent = '–';
    $('#etatCase').textContent = txt;
    $('#etatCarte').textContent = c.w + ' × ' + c.h + ' cases de ' + c.tc + ' px, ' + (c.mode === 'plateformes' ? 'plateformes' : 'vue de dessus');
    $('#bAnnuler').disabled = !h.avant;
    $('#bRetablir').disabled = !h.apres;
  }
  U.surSurvol = majEtat;
  U.surSelection = function () { majEtat(); };

  // ---------- Tout rafraîchir ----------
  U.rafraichir = function () {
    U.accorderOutil();
    if (U.objSel && !M.objet(U.objSel)) U.objSel = null;
    if (U.tampon && !Array.prototype.every.call(U.tampon.cases, function (v) { return !v || M.jeuDe(v & M.NUMERO); })) U.tampon = null;
    if (!U.tampon && M.carte.jeux.length) tamponDepuisPalette();
    construireOutils();
    construireOptions();
    construireCalques();
    construireSource();
    majEtat();
    majVue();
    if ($('#nomCarte') !== document.activeElement) $('#nomCarte').value = M.carte.nom;
    document.title = M.carte.nom + ' — Tuiles';
    U.demander();
  };
  U.surOutil = function () { construireOutils(); construireOptions(); if (M.calqueActif().type === 'tuiles') construireSource(); };

  // L'aperçu des animations dans la palette.
  U.tic = function () {
    var j = jeuMontre(), k, sig = '', t;
    if (!j || !U.anime || M.calqueActif().type !== 'tuiles' || !$('#palette')) return;
    t = performance.now();
    for (k in j.anims) sig += J.imageA(j, Number(k), t) + ',';
    if (sig !== signaturePalette) dessinerPalette();
  };

  // ---------- Événements ----------
  U.initPanneaux = function () {
    document.querySelectorAll('[data-ico]').forEach(function (el) { el.innerHTML = icone(el.dataset.ico); });
    $('#outils').addEventListener('click', function (e) {
      var b = e.target.closest('[data-outil]');
      if (b) U.choisirOutil(b.dataset.outil);
    });

    $('#optionsOutil').addEventListener('change', function (e) {
      var el = e.target, o = el.dataset.opt, q;
      if (o === 'aleatoire') U.aleatoire = el.checked;
      else if (o === 'plein') U.plein = el.checked;
      else if (o === 'contigu') U.contigu = el.checked;
      else if (o === 'terrain') { q = el.value.split(':'); U.terrain = { jeu: Number(q[0]), i: Number(q[1]) }; construireSource(); }
      el.blur();
      U.demander();
    });

    $('#calques').addEventListener('click', function (e) {
      var l = e.target.closest('.calque'), b = e.target.closest('[data-r]'), i;
      if (!l || e.target.tagName === 'INPUT') return;
      i = Number(l.dataset.i);
      if (b) { M.calqueRegler(i, b.dataset.r, !M.carte.calques[i][b.dataset.r]); return; }
      if (i !== M.carte.iCalque) { M.allerCalque(i); U.rafraichir(); }
    });
    $('#calques').addEventListener('dblclick', function (e) {
      var l = e.target.closest('.calque');
      if (l && e.target.classList.contains('nom') && e.target.tagName !== 'INPUT') renommerCalque(l);
    });
    $('#calOpacite').addEventListener('input', function () {
      M.calqueRegler(M.carte.iCalque, 'opacite', Number(this.value) / 100, true);
      $('#calOpaciteVal').textContent = this.value + ' %';
      U.demander();
    });
    $('#calOpacite').addEventListener('change', function () { M.valider('Opacité du calque'); this.blur(); });

    var source = $('#source');
    source.addEventListener('pointerdown', function (e) {
      var c;
      if (e.target.id !== 'palette' || e.button) return;
      c = casePalette(e);
      gestePalette = c;
      e.target.setPointerCapture(e.pointerId);
      U.selJeu = { x: c.x, y: c.y, w: 1, h: 1 };
      dessinerPalette();
      e.preventDefault();
    });
    source.addEventListener('pointermove', function (e) {
      var c, j = jeuMontre(), k;
      if (e.target.id !== 'palette' || !j) return;
      c = casePalette(e);
      if (gestePalette) {
        U.selJeu = { x: Math.min(c.x, gestePalette.x), y: Math.min(c.y, gestePalette.y), w: Math.abs(c.x - gestePalette.x) + 1, h: Math.abs(c.y - gestePalette.y) + 1 };
        dessinerPalette();
        $('#infoPalette').textContent = U.selJeu.w * U.selJeu.h > 1 ? U.selJeu.w + ' × ' + U.selJeu.h + ' tuiles choisies' : infoTuile(j, Math.min(c.y * j.cols + c.x, j.nb - 1));
      } else {
        k = c.y * j.cols + c.x;
        $('#infoPalette').textContent = k < j.nb ? infoTuile(j, k) : '';
      }
    });
    function finPalette() {
      if (!gestePalette) return;
      gestePalette = null;
      tamponDepuisPalette();
      if (U.outil !== 'tampon' && U.outil !== 'rect' && U.outil !== 'ligne' && U.outil !== 'pot') U.choisirOutil('tampon');
      construireSource();
      construireOptions();
    }
    source.addEventListener('pointerup', finPalette);
    source.addEventListener('pointercancel', finPalette);

    source.addEventListener('click', function (e) {
      var col = e.target.closest('[data-col]'), ob = e.target.closest('[data-id]'), ter = e.target.closest('[data-terrain]'), oter = e.target.closest('[data-oter]');
      if (col) {
        U.tamponCol = M.blocUn(Number(col.dataset.col), 'collisions');
        if (U.outil === 'gomme' || U.outil === 'selection' || U.outil === 'pipette') U.choisirOutil('tampon');
        construireSource();
      } else if (ob) {
        U.objSel = Number(ob.dataset.id);
        U.choisirOutil('objSel');
        construireSource();
        U.demander();
      } else if (ter) {
        U.terrain = { jeu: U.jeuActif, i: Number(ter.dataset.terrain) };
        U.choisirOutil('terrain');
      } else if (oter) {
        oter.closest('.prop').remove();
        lireFiche();
      }
    });
    source.addEventListener('change', function (e) {
      if (e.target.id === 'choixJeu') {
        U.jeuActif = Number(e.target.value);
        U.selJeu = { x: 0, y: 0, w: 1, h: 1 };
        U.zoomPalette = 0;
        tamponDepuisPalette();
        construireSource();
        construireOptions();
      } else if (e.target.closest('#fiche')) lireFiche();
    });
    source.addEventListener('submit', function (e) { e.preventDefault(); if (document.activeElement) document.activeElement.blur(); });

    $('#nomCarte').addEventListener('change', function () { if (!M.carteRegler('nom', this.value)) this.value = M.carte.nom; this.blur(); });
    $('#nomCarte').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); else if (e.key === 'Escape') { this.value = M.carte.nom; this.blur(); } });
  };

  U.ajouterProp = function () {
    var z = $('#props'), d;
    if (!z) return;
    d = document.createElement('div');
    d.className = 'prop';
    d.innerHTML = '<input type="text" data-p="cle" maxlength="60" placeholder="clé" aria-label="Clé"><input type="text" data-p="val" maxlength="400" placeholder="valeur" aria-label="Valeur"><button type="button" class="ico" data-oter title="Retirer cette propriété">' + icone('croix') + '</button>';
    z.appendChild(d);
    d.querySelector('input').focus();
  };

  U.zoomerPalette = function (sens) {
    var j = jeuMontre();
    if (!j) return;
    U.zoomPalette = M.borne(echellePalette(j) + sens, 1, ZOOM_PALETTE_MAX);
    construireSource();
  };
  U.construireOptions = construireOptions;
})();
