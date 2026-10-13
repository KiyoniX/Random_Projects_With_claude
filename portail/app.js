(function () {
  'use strict';

  var SEED_KEY = 'portail-graine', BOX_KEY = 'portail-boite';
  var FRAME_W = 1200;      // largeur à laquelle un projet est affiché dans son aperçu vivant
  var LIVE_DELAY = 450;    // attente avant de lancer l'aperçu vivant d'une boîte sortie (ms)
  var WORDS = ['astre', 'brume', 'corail', 'dune', 'ecume', 'forge', 'givre', 'halo', 'iris', 'jade', 'lune', 'mousse', 'nacre', 'onde', 'pollen', 'quartz', 'roc', 'sable', 'tourbe', 'volcan'];

  // hash : ce que le projet attend après le « # » pour une graine donnée ; absent, il n'en utilise pas.
  // w, h : largeur et hauteur de la tranche, en pixels. cmd : projet à lancer en ligne de commande, sans page ; link : où mène alors sa boîte.
  // lourd : la page calcule trop au chargement pour tourner en aperçu vivant ; sa boîte garde la vignette.
  function plain(s) { return encodeURIComponent(s); }
  function town(s) { return encodeURIComponent(s) + '/ville'; }

  var SHELVES = [
    {
      title: 'Un même univers', note: 'La graine d\'une planète donne sa langue, son histoire, ses stèles et ses cités, chaque cité son plan, et chaque plan ses catacombes, son siège, sa rivière et sa visite à pied.',
      items: [
        { id: 'atlas', title: 'Atlas des mondes', dir: 'mondes/atlas-des-mondes', hash: plain, kind: 'Générateur', w: 86, h: 318, text: 'Le guide de voyage d\'une planète entière : climat, milieux naturels, espèces, peuple, villes et étapes.' },
        { id: 'chroniques', title: 'Chroniques d\'un monde', dir: 'mondes/chroniques', hash: plain, kind: 'Générateur', w: 70, h: 310, text: 'Le chapitre d\'histoire : mille ans de guerres, de cités et de souverains sur une carte animée.' },
        { id: 'langues', title: 'Fabrique de langues', dir: 'mondes/langues-inventees', hash: plain, kind: 'Générateur', w: 62, h: 300, text: 'Le guide de conversation : prononciation, expressions utiles, grammaire, écriture, traduction du français.' },
        { id: 'steles', title: 'Stèles d\'un monde', dir: 'mondes/steles', hash: plain, kind: 'Jeu de déchiffrement', w: 64, h: 296, text: 'Le cahier de fouilles : lire l\'écriture d\'un peuple à partir des noms connus, puis reconstituer sa chronique.' },
        { id: 'plans', title: 'Plans de ville', dir: 'plans-de-ville', hash: town, kind: 'Générateur', w: 78, h: 290, text: 'Une ville médiévale sur parchemin : remparts, quartiers, parcelles, champs.' },
        { id: 'cachots', title: 'Cartes & Cachots', dir: 'cartes-et-cachots', hash: plain, kind: 'Jeu de dix minutes', w: 66, h: 276, text: 'Un donjon en caractères, des combats de cartes, un dragon au fond.' },
        { id: 'siege', title: 'Sièges de villes', dir: 'siege', hash: town, kind: 'Jeu', w: 72, h: 290, text: 'Les assaillants arrivent par les routes du plan : à toi de tenir les portes.' },
        { id: 'riviere', title: 'Rivières et moulins', dir: 'riviere', hash: town, lourd: true, kind: 'Jeu', w: 72, h: 290, text: 'Un fleuve traverse la ville : pose ponts et moulins sans l\'inonder.' },
        { id: 'visite', title: 'Visite de la ville', dir: 'visite', hash: town, lourd: true, kind: 'Promenade en 3D', w: 76, h: 302, text: 'La ville du plan montée en volumes, à parcourir à pied par les rues et les portes.' }
      ]
    },
    {
      title: 'Jeux', note: 'À jouer tout de suite.',
      items: [
        { id: 'defense', title: 'Défense ASCII', dir: 'defense-ascii', hash: plain, kind: 'Jeu d\'un quart d\'heure', w: 74, h: 296, text: 'Tower defense en caractères : cinq tours, sept ennemis, vingt vagues.' },
        { id: 'enquete', title: 'Nuit blanche au manoir', dir: 'enquete', hash: function (s) { return encodeURIComponent(s) + '/normal'; }, kind: 'Jeu de déduction', w: 90, h: 312, text: 'Un crime, des dépositions à recouper, une seule solution logique.' },
        { id: 'flux', title: 'Flux', dir: 'flux', kind: 'Jeu de réflexion', w: 60, h: 284, text: 'Dix gaines à retailler pour obtenir le meilleur débit, sur une vraie simulation de fluide.' },
        { id: 'usine', title: 'Usine à la chaîne', dir: 'usine', kind: 'Jeu d\'automatisation', w: 84, h: 306, text: 'Tapis roulants, machines et recettes : tiens le débit demandé avec le moins de pièces.' },
        { id: 'ville', title: 'Ville à règles', dir: 'ville-a-regles', hash: plain, kind: 'Simulation', w: 66, h: 286, text: 'Une ville qui pousse seule, voiture par voiture : tu ne règles que ses lois, tracé, zonage, loyers, bus et impôt.' },
        { id: 'backrooms', title: 'Les couloirs oublient', dir: 'backrooms', hash: plain, kind: 'Jeu en vue subjective', w: 72, h: 298, text: 'Dix paliers de bureaux, de parking, de piscine et d\'hôtel, cinq créatures à règle, et une sortie qui ne se trouve qu\'à l\'oreille.' },
        { id: 'phare', title: 'Le quart de nuit', dir: 'phare', hash: plain, lourd: true, kind: 'Jeu en vue subjective', w: 68, h: 292, text: 'Gardien de phare : dix heures de nuit à tenir le feu pour les navires, entre pannes, brume et orages.' },
        { id: 'bureau', title: 'Bureau des réclamations', dir: 'bureau-des-reclamations', kind: 'Jeu de guichet', w: 70, h: 300, text: 'Sept jours à approuver, refuser ou transmettre des réclamations absurdes, selon un règlement qui change chaque matin.' },
        { id: 'tycoon', title: 'Dev Tycoon', dir: 'dev-tycoon', kind: 'Jeu de gestion', w: 68, h: 270, text: 'Monte ta boîte de développeurs, et surprends ceux qui trichent avec une IA.' }
      ]
    },
    {
      title: 'Outils et atelier', note: 'Pour dessiner, composer, fabriquer, et deux simulateurs à lancer au terminal.',
      items: [
        { id: 'atelier', title: 'Atelier Pixel', dir: 'atelier-pixel', kind: 'Outil', w: 80, h: 300, text: 'Éditeur de pixel-art animé : calques, frise d\'images, pelure d\'oignon, export GIF.' },
        { id: 'pantin', title: 'Pantin', dir: 'pantin', kind: 'Outil', w: 62, h: 292, text: 'Animer un sprite sans le redessiner : on le découpe en pièces, on les épingle, on pose quelques clés et les images entre deux se calculent.' },
        { id: 'particules', title: 'Particules', dir: 'particules', kind: 'Outil', w: 64, h: 296, text: 'Le banc d\'essai de l\'artificier : feu, fumée, pluie ou explosion, réglés en pixel-art, rendus en planches de sprites ou joués en direct dans un jeu par un petit lecteur.' },
        { id: 'eclairage', title: 'Éclairage', dir: 'eclairage', kind: 'Outil', w: 66, h: 300, text: 'Peindre le relief d\'un sprite, puis l\'éclairer de n\'importe quel côté sans le redessiner : chaque pixel reste dans sa rampe.' },
        { id: 'vitrail', title: 'Vitrail', dir: 'vitrail', kind: 'Outil', w: 72, h: 310, text: 'Tracer les plombs d\'un vitrail sur la table lumineuse, poser les verres, et sortir le calibre des pièces à couper.' },
        { id: 'textures', title: 'Textures répétables', dir: 'textures', kind: 'Outil', w: 76, h: 288, text: 'Pierre, bois, herbe, eau : des tuiles en pixel-art qui se raccordent sans couture.' },
        { id: 'palettes', title: 'Palettes', dir: 'palettes', kind: 'Outil', w: 64, h: 280, text: 'Tirer une palette d\'une image, la réduire, vérifier ses contrastes, l\'envoyer vers Atelier Pixel et Textures.' },
        { id: 'tuiles', title: 'Tuiles', dir: 'tuiles', kind: 'Outil', w: 70, h: 294, text: 'Éditeur de cartes en tuiles : calques, collisions, objets, et un personnage pour essayer le niveau.' },
        { id: 'police', title: 'Police Pixel', dir: 'police-pixel', kind: 'Outil', w: 68, h: 284, text: 'Dessiner un alphabet case par case, accents français compris, et l\'exporter en vraie police.' },
        { id: 'chiptune', title: 'La Puce à l\'oreille', dir: 'chiptune', kind: 'Outil', w: 82, h: 304, text: 'Séquenceur 8 bits à cinq voix : morceaux, bruitages, export WAV et lecteur pour les jeux.' },
        { id: 'erosion', title: 'Érosion', dir: 'erosion-rust', cmd: 'cargo run --release', link: 'https://github.com/KiyoniX/Random_Projects_With_claude/tree/main/erosion-rust', kind: 'Simulateur en Rust', w: 58, h: 262, text: 'Eau, gel, vent, glaciers et végétation sculptent un relief.' },
        { id: 'feu', title: 'Feu de forêt', dir: 'feu-rust', cmd: 'cargo run --release', link: 'https://github.com/KiyoniX/Random_Projects_With_claude/tree/main/feu-rust', kind: 'Simulateur en Rust', w: 58, h: 270, text: 'Vent, rafales, humidité, pente et sept essences : on allume, on trace des pare-feu, on largue de l\'eau.' }
      ]
    }
  ];

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var byId = {}, current = null, liveTimer = null;
  SHELVES.forEach(function (sh) { sh.items.forEach(function (it) { byId[it.id] = it; }); });

  // ---------- Graine ----------
  function randomSeed() { return WORDS[Math.floor(Math.random() * WORDS.length)] + '-' + Math.floor(Math.random() * 9000 + 1000); }
  function recall(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function keep(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* stockage indisponible */ }
  }
  function url(it) {
    var seed = $('#seed').value.trim();
    if (it.link) return it.link;
    return it.dir + '/index.html' + (it.hash && seed ? '#' + it.hash(seed) : '');
  }

  // ---------- Étagères ----------
  var GAP = 5, ROW_PAD = 28;   // jour entre deux boîtes, et marges d'une rangée, comme dans la feuille de style

  // Le titre court sur toute la hauteur de la tranche : son corps s'ajuste à sa longueur.
  function spine(it) {
    var size = Math.max(13, Math.min(21, (it.h - (it.id === 'enquete' || it.id === 'tycoon' ? 110 : it.dir.indexOf('mondes/') === 0 ? 130 : 74)) / (it.title.length * 0.6)));
    var inner = '<span class="name">' + esc(it.title) + '</span>' + (it.hash ? '<span class="dot" title="Suit la graine commune"></span>' : '');
    var attrs = ' class="box b-' + it.id + '" data-id="' + it.id + '" style="--w:' + it.w + 'px;--h:' + it.h + 'px;--fs:' + size.toFixed(1) + 'px"';
    return '<a' + attrs + ' href="' + esc(url(it)) + '">' + inner + '</a>';
  }
  // Une étagère qui déborde continue sur une planche de plus, sans étiquette : la pièce s'agrandit avec la collection.
  function lines(items, width) {
    var out = [], line = [], used = 0;
    items.forEach(function (it) {
      if (line.length && used + it.w > width) { out.push(line); line = []; used = 0; }
      line.push(it); used += it.w + GAP;
    });
    out.push(line);
    return out;
  }
  var shelfWidth = 0;
  function renderShelves() {
    shelfWidth = $('#shelves').clientWidth - ROW_PAD;
    $('#shelves').innerHTML = SHELVES.map(function (sh) {
      return lines(sh.items, shelfWidth).map(function (l, i) {
        return '<section class="shelf' + (i ? ' suite' : '') + '"><div class="row">' + l.map(spine).join('') + '</div>' +
          '<div class="plank">' + (i ? '' : '<h2>' + esc(sh.title) + '</h2><p>' + esc(sh.note) + '</p>') + '</div></section>';
      }).join('');
    }).join('');
    if (current) document.querySelectorAll('.box').forEach(function (b) { b.classList.toggle('on', b.dataset.id === current.id); });
  }
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if ($('#shelves').clientWidth - ROW_PAD !== shelfWidth) renderShelves(); }, 120);
  });

  // ---------- Boîte sortie ----------
  function renderTable() {
    var it = current, seeded = it.hash ? ' Suit la graine commune.' : '';
    $('#table').innerHTML = '<div class="lid b-' + it.id + '">' +
      '<div class="cover"><span class="initial">' + esc(it.title.charAt(0)) + '</span>' +
      (it.cmd ? '' : '<img src="portail/apercus/' + it.id + '.webp" alt="" onerror="this.remove()">') + '</div>' +
      '<div class="notice"><h3>' + esc(it.title) + '</h3><p>' + esc(it.text) + '</p>' +
      '<p class="facts">' + esc(it.kind) + '.' + seeded + '</p>' +
      (it.cmd ? '<p class="facts">Se lance au terminal, dans <code>' + esc(it.dir) + '</code> : <code>' + esc(it.cmd) + '</code></p><a class="open" href="' + esc(url(it)) + '">Voir le code sur GitHub</a>'
        : '<a class="open" href="' + esc(url(it)) + '">Ouvrir la boîte</a>') + '</div></div>';
  }

  // La vraie page du projet remplace la vignette, réduite à la taille du couvercle.
  function wake() {
    var cover = $('#table .cover'), frame;
    if (!cover || current.cmd || current.lourd || cover.querySelector('iframe')) return;
    frame = document.createElement('iframe');
    frame.src = url(current);
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.transform = 'scale(' + cover.clientWidth / FRAME_W + ')';
    cover.appendChild(frame);
  }

  function select(id) {
    if (current && current.id === id) return;
    current = byId[id];
    keep(BOX_KEY, id);
    document.querySelectorAll('.box').forEach(function (b) { b.classList.toggle('on', b.dataset.id === id); });
    renderTable();
    clearTimeout(liveTimer);
    liveTimer = setTimeout(wake, LIVE_DELAY);
  }

  function relink() {
    document.querySelectorAll('a.box').forEach(function (a) { a.href = url(byId[a.dataset.id]); });
    var id = current.id;
    current = null;
    select(id);
  }

  // ---------- Commandes ----------
  function boxOf(e) { return e.target.closest && e.target.closest('.box'); }

  document.addEventListener('pointerover', function (e) {
    var b = boxOf(e);
    if (b && e.pointerType !== 'touch') select(b.dataset.id);
  });
  document.addEventListener('focusin', function (e) {
    var b = boxOf(e);
    if (b) select(b.dataset.id);
  });
  // Au doigt, il n'y a pas de survol : le premier appui sort la boîte, le second l'ouvre.
  // L'appui donne aussi le focus, qui sort la boîte avant le clic : on retient donc celle qui était sortie quand le doigt s'est posé.
  var touched = '';
  document.addEventListener('pointerdown', function (e) {
    var b = boxOf(e);
    if (e.pointerType === 'touch') touched = b && b.classList.contains('on') ? b.dataset.id : '';
  }, true);
  document.addEventListener('click', function (e) {
    var b = boxOf(e);
    if (!b || (e.pointerType === 'touch' ? touched === b.dataset.id : b.classList.contains('on'))) return;
    e.preventDefault();
    select(b.dataset.id);
  });

  $('#seed').addEventListener('input', function () { keep(SEED_KEY, this.value.trim()); relink(); });
  $('#random').addEventListener('click', function () {
    $('#seed').value = randomSeed();
    keep(SEED_KEY, $('#seed').value);
    relink();
  });
  $('#seedForm').addEventListener('submit', function (e) { e.preventDefault(); });

  $('#seed').value = recall(SEED_KEY) || randomSeed();
  keep(SEED_KEY, $('#seed').value);
  renderShelves();
  select(byId[recall(BOX_KEY)] ? recall(BOX_KEY) : 'atlas');
})();
