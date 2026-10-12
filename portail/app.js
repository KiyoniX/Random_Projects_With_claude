(function () {
  'use strict';

  var SEED_KEY = 'portail-graine', BOX_KEY = 'portail-boite';
  var FRAME_W = 1200;      // largeur à laquelle un projet est affiché dans son aperçu vivant
  var LIVE_DELAY = 450;    // attente avant de lancer l'aperçu vivant d'une boîte sortie (ms)
  var WORDS = ['astre', 'brume', 'corail', 'dune', 'ecume', 'forge', 'givre', 'halo', 'iris', 'jade', 'lune', 'mousse', 'nacre', 'onde', 'pollen', 'quartz', 'roc', 'sable', 'tourbe', 'volcan'];

  // hash : ce que le projet attend après le « # » pour une graine donnée ; absent, il n'en utilise pas.
  // w, h : largeur et hauteur de la tranche, en pixels. cmd : projet à lancer en ligne de commande, sans page.
  function plain(s) { return encodeURIComponent(s); }
  function town(s) { return encodeURIComponent(s) + '/ville'; }

  var SHELVES = [
    {
      title: 'Un même univers', note: 'La graine d\'une planète donne ses cités, chaque cité son plan, et chaque plan ses catacombes, son siège et sa rivière.',
      items: [
        { id: 'atlas', title: 'Atlas des mondes', dir: 'mondes/atlas-des-mondes', hash: plain, kind: 'Générateur', w: 86, h: 318, text: 'Une planète entière : climat, biomes, espèces, peuple et cités.' },
        { id: 'langues', title: 'Fabrique de langues', dir: 'mondes/langues-inventees', hash: plain, kind: 'Générateur', w: 62, h: 300, text: 'La langue du peuple : sons, grammaire, écriture, traduction du français.' },
        { id: 'chroniques', title: 'Chroniques d\'un monde', dir: 'mondes/chroniques', hash: plain, kind: 'Générateur', w: 70, h: 310, text: 'Mille ans d\'histoire : guerres, cités et souverains sur une carte animée.' },
        { id: 'plans', title: 'Plans de ville', dir: 'plans-de-ville', hash: town, kind: 'Générateur', w: 78, h: 290, text: 'Une ville médiévale sur parchemin : remparts, quartiers, parcelles, champs.' },
        { id: 'cachots', title: 'Cartes & Cachots', dir: 'cartes-et-cachots', hash: plain, kind: 'Jeu de dix minutes', w: 66, h: 276, text: 'Un donjon en caractères, des combats de cartes, un dragon au fond.' },
        { id: 'siege', title: 'Sièges de villes', dir: 'siege', hash: town, kind: 'Jeu', w: 72, h: 290, text: 'Les assaillants arrivent par les routes du plan : à toi de tenir les portes.' },
        { id: 'riviere', title: 'Rivières et moulins', dir: 'riviere', hash: town, kind: 'Jeu', w: 72, h: 290, text: 'Un fleuve traverse la ville : pose ponts et moulins sans l\'inonder.' }
      ]
    },
    {
      title: 'Jeux', note: 'À jouer tout de suite.',
      items: [
        { id: 'defense', title: 'Défense ASCII', dir: 'defense-ascii', hash: plain, kind: 'Jeu d\'un quart d\'heure', w: 74, h: 296, text: 'Tower defense en caractères : cinq tours, sept ennemis, vingt vagues.' },
        { id: 'enquete', title: 'Nuit blanche au manoir', dir: 'enquete', hash: function (s) { return encodeURIComponent(s) + '/normal'; }, kind: 'Jeu de déduction', w: 90, h: 312, text: 'Un crime, des dépositions à recouper, une seule solution logique.' },
        { id: 'flux', title: 'Flux', dir: 'flux', kind: 'Jeu de réflexion', w: 60, h: 284, text: 'Dix gaines à retailler pour obtenir le meilleur débit, sur une vraie simulation de fluide.' },
        { id: 'usine', title: 'Usine à la chaîne', dir: 'usine', kind: 'Jeu d\'automatisation', w: 84, h: 306, text: 'Tapis roulants, machines et recettes : tiens le débit demandé avec le moins de pièces.' },
        { id: 'tycoon', title: 'Dev Tycoon', dir: 'dev-tycoon', kind: 'Jeu de gestion', w: 68, h: 270, text: 'Monte ta boîte de développeurs, et surprends ceux qui trichent avec une IA.' }
      ]
    },
    {
      title: 'Outils et atelier', note: 'Pour dessiner, fabriquer, et un simulateur à lancer au terminal.',
      items: [
        { id: 'atelier', title: 'Atelier Pixel', dir: 'atelier-pixel', kind: 'Outil', w: 80, h: 300, text: 'Éditeur de pixel-art animé : calques, frise d\'images, pelure d\'oignon, export GIF.' },
        { id: 'textures', title: 'Textures répétables', dir: 'textures', kind: 'Outil', w: 76, h: 288, text: 'Pierre, bois, herbe, eau : des tuiles en pixel-art qui se raccordent sans couture.' },
        { id: 'erosion', title: 'Érosion', dir: 'erosion-rust', cmd: 'cargo run --release', kind: 'Simulateur en Rust', w: 58, h: 262, text: 'Eau, gel, vent, glaciers et végétation sculptent un relief.' }
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
    return it.dir + '/index.html' + (it.hash && seed ? '#' + it.hash(seed) : '');
  }

  // ---------- Étagères ----------
  // Le titre court sur toute la hauteur de la tranche : son corps s'ajuste à sa longueur.
  function spine(it) {
    var size = Math.max(13, Math.min(21, (it.h - (it.id === 'enquete' || it.id === 'tycoon' ? 110 : 74)) / (it.title.length * 0.6)));
    var inner = '<span class="name">' + esc(it.title) + '</span>' + (it.hash ? '<span class="dot" title="Suit la graine commune"></span>' : '');
    var attrs = ' class="box b-' + it.id + '" data-id="' + it.id + '" style="--w:' + it.w + 'px;--h:' + it.h + 'px;--fs:' + size.toFixed(1) + 'px"';
    return it.cmd ? '<button type="button"' + attrs + '>' + inner + '</button>' : '<a' + attrs + ' href="' + esc(url(it)) + '">' + inner + '</a>';
  }
  function renderShelves() {
    $('#shelves').innerHTML = SHELVES.map(function (sh) {
      return '<section class="shelf"><div class="row">' + sh.items.map(spine).join('') + '</div>' +
        '<div class="plank"><h2>' + esc(sh.title) + '</h2><p>' + esc(sh.note) + '</p></div></section>';
    }).join('');
  }

  // ---------- Boîte sortie ----------
  function renderTable() {
    var it = current, seeded = it.hash ? ' Suit la graine commune.' : '';
    $('#table').innerHTML = '<div class="lid b-' + it.id + '">' +
      '<div class="cover"><span class="initial">' + esc(it.title.charAt(0)) + '</span>' +
      (it.cmd ? '' : '<img src="portail/apercus/' + it.id + '.webp" alt="" onerror="this.remove()">') + '</div>' +
      '<div class="notice"><h3>' + esc(it.title) + '</h3><p>' + esc(it.text) + '</p>' +
      '<p class="facts">' + esc(it.kind) + '.' + seeded + '</p>' +
      (it.cmd ? '<p class="facts">Se lance au terminal, dans <code>' + esc(it.dir) + '</code> : <code>' + esc(it.cmd) + '</code></p>'
        : '<a class="open" href="' + esc(url(it)) + '">Ouvrir la boîte</a>') + '</div></div>';
  }

  // La vraie page du projet remplace la vignette, réduite à la taille du couvercle.
  function wake() {
    var cover = $('#table .cover'), frame;
    if (!cover || current.cmd || cover.querySelector('iframe')) return;
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
  document.addEventListener('click', function (e) {
    var b = boxOf(e);
    if (!b || b.classList.contains('on')) return;
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
