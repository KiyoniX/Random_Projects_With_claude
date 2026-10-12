(function () {
  'use strict';

  var SAVE_KEY = 'portail-graine';
  var FRAME_W = 1200;      // largeur à laquelle un projet est affiché dans son aperçu vivant
  var HOVER_DELAY = 350;   // attente avant de lancer l'aperçu, pour ne pas tout charger en traversant la page (ms)
  var WORDS = ['astre', 'brume', 'corail', 'dune', 'ecume', 'forge', 'givre', 'halo', 'iris', 'jade', 'lune', 'mousse', 'nacre', 'onde', 'pollen', 'quartz', 'roc', 'sable', 'tourbe', 'volcan'];

  // hash : ce que le projet attend après le « # » pour une graine donnée ; absent, il n'en utilise pas.
  // shot : vignette dans portail/apercus/ ; cmd : projet à lancer en ligne de commande, sans page.
  function plain(s) { return encodeURIComponent(s); }
  function town(s) { return encodeURIComponent(s) + '/ville'; }

  var SHELVES = [
    {
      title: 'Un même univers', sub: 'Sept pages qui se prolongent : la graine d\'une planète donne ses cités, et chaque cité son plan.',
      path: ['Planète', 'Langue et histoire du peuple', 'Cité', 'Catacombes, siège ou rivière'],
      items: [
        { id: 'atlas', title: 'Atlas des mondes', dir: 'mondes/atlas-des-mondes', hash: plain, text: 'Une planète entière : climat, biomes, espèces, peuple et cités.', tags: ['générateur'] },
        { id: 'langues', title: 'Fabrique de langues', dir: 'mondes/langues-inventees', hash: plain, text: 'La langue du peuple : sons, grammaire, écriture, traduction du français.', tags: ['générateur'] },
        { id: 'chroniques', title: 'Chroniques d\'un monde', dir: 'mondes/chroniques', hash: plain, text: 'Mille ans d\'histoire : guerres, cités et souverains sur une carte animée.', tags: ['générateur'] },
        { id: 'plans', title: 'Plans de ville', dir: 'plans-de-ville', hash: town, text: 'Une ville médiévale sur parchemin : remparts, quartiers, parcelles, champs.', tags: ['générateur'] },
        { id: 'cachots', title: 'Cartes & Cachots', dir: 'cartes-et-cachots', hash: plain, text: 'Roguelike en ASCII : trois étages, des combats de cartes, un dragon au fond.', tags: ['jeu', '10 min'] },
        { id: 'siege', title: 'Sièges de villes', dir: 'siege', hash: town, text: 'Les assaillants arrivent par les routes du plan : à toi de tenir les portes.', tags: ['jeu'] },
        { id: 'riviere', title: 'Rivières et moulins', dir: 'riviere', hash: town, text: 'Un fleuve traverse la ville : pose ponts et moulins sans l\'inonder.', tags: ['jeu', 'fluides'] }
      ]
    },
    {
      title: 'Jeux', sub: 'À jouer tout de suite.',
      items: [
        { id: 'defense', title: 'Défense ASCII', dir: 'defense-ascii', hash: plain, text: 'Tower defense en caractères : cinq tours, sept ennemis, vingt vagues.', tags: ['jeu', '15 min'] },
        { id: 'enquete', title: 'Nuit blanche au manoir', dir: 'enquete', hash: function (s) { return encodeURIComponent(s) + '/normal'; }, text: 'Un crime, des dépositions à recouper, une seule solution logique.', tags: ['jeu', 'déduction'] },
        { id: 'flux', title: 'Flux', dir: 'flux', text: 'Dix conduits à retailler pour obtenir le meilleur débit, sur une vraie simulation de fluide.', tags: ['jeu', 'fluides'] },
        { id: 'usine', title: 'Usine à la chaîne', dir: 'usine', text: 'Tapis roulants, machines et recettes : tiens le débit demandé avec le moins de pièces.', tags: ['jeu', 'automatisation'] },
        { id: 'tycoon', title: 'Dev Tycoon', dir: 'dev-tycoon', text: 'Monte ta boîte de développeurs, et surprends ceux qui trichent avec une IA.', tags: ['jeu', 'gestion'] }
      ]
    },
    {
      title: 'Outils', sub: 'Pour dessiner et fabriquer.',
      items: [
        { id: 'atelier', title: 'Atelier Pixel', dir: 'atelier-pixel', text: 'Éditeur de pixel-art animé : calques, frise d\'images, pelure d\'oignon, export GIF.', tags: ['outil'] },
        { id: 'textures', title: 'Textures répétables', dir: 'textures', text: 'Pierre, bois, herbe, eau : des tuiles en pixel-art qui se raccordent sans couture.', tags: ['outil', 'générateur'] }
      ]
    },
    {
      title: 'Hors navigateur', sub: 'À lancer depuis un terminal.',
      items: [
        { id: 'erosion', title: 'Érosion', cmd: 'cargo run --release', dir: 'erosion-rust', text: 'Simulateur d\'érosion en Rust : eau, gel, vent, glaciers et végétation.', tags: ['simulation', 'Rust'] }
      ]
    }
  ];

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ---------- Graine ----------
  function randomSeed() { return WORDS[Math.floor(Math.random() * WORDS.length)] + '-' + Math.floor(Math.random() * 9000 + 1000); }
  function loadSeed() {
    try { return localStorage.getItem(SAVE_KEY) || ''; } catch (e) { return ''; }
  }
  function saveSeed(s) {
    try { localStorage.setItem(SAVE_KEY, s); } catch (e) { /* stockage indisponible */ }
  }
  function url(it) {
    var seed = $('#seed').value.trim();
    return it.dir + '/index.html' + (it.hash && seed ? '#' + it.hash(seed) : '');
  }

  // ---------- Affichage ----------
  function card(it) {
    var seeded = it.hash ? '<span class="tag seeded">graine</span>' : '';
    var tags = it.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + seeded;
    var shot = '<div class="shot"><span class="glyph">' + esc(it.title.charAt(0)) + '</span>' +
      '<img src="portail/apercus/' + it.id + '.webp" alt="" loading="lazy" onerror="this.remove()"></div>';
    var body = '<div class="body"><h3>' + esc(it.title) + '</h3><p>' + esc(it.text) + '</p>' +
      (it.cmd ? '<p>Dans <code>' + esc(it.dir) + '</code> : <code>' + esc(it.cmd) + '</code></p>' : '') + '<div class="tags">' + tags + '</div></div>';
    return it.cmd ? '<article class="card">' + shot + body + '</article>' : '<a class="card" data-id="' + it.id + '" href="' + esc(url(it)) + '">' + shot + body + '</a>';
  }

  function render() {
    $('#shelves').innerHTML = SHELVES.map(function (sh) {
      return '<section class="shelf"><div class="shelf-head"><h2>' + esc(sh.title) + '</h2><p>' + esc(sh.sub) + '</p></div>' +
        (sh.path ? '<p class="path">' + sh.path.map(function (p) { return '<b>' + esc(p) + '</b>'; }).join('<i>→</i>') + '</p>' : '') +
        '<div class="grid">' + sh.items.map(card).join('') + '</div></section>';
    }).join('');
  }

  var byId = {};
  SHELVES.forEach(function (sh) { sh.items.forEach(function (it) { byId[it.id] = it; }); });

  function relink() {
    document.querySelectorAll('a.card').forEach(function (a) { a.href = url(byId[a.dataset.id]); });
  }

  // ---------- Aperçu vivant ----------
  // Au survol, la vraie page du projet remplace la vignette, réduite à la taille de la carte.
  var timer = null;

  function wake(a) {
    var shot = a.querySelector('.shot'), frame;
    if (shot.querySelector('iframe')) return;
    frame = document.createElement('iframe');
    frame.src = url(byId[a.dataset.id]);
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.transform = 'scale(' + shot.clientWidth / FRAME_W + ')';
    shot.appendChild(frame);
    shot.insertAdjacentHTML('beforeend', '<span class="live">en direct</span>');
  }
  function sleep(a) {
    a.querySelectorAll('iframe, .live').forEach(function (el) { el.remove(); });
  }
  document.addEventListener('pointerover', function (e) {
    var a = e.target.closest && e.target.closest('a.card');
    if (!a || e.pointerType === 'touch' || (e.relatedTarget && a.contains(e.relatedTarget))) return;
    clearTimeout(timer);
    timer = setTimeout(function () { wake(a); }, HOVER_DELAY);
  });
  document.addEventListener('pointerout', function (e) {
    var a = e.target.closest && e.target.closest('a.card');
    if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
    clearTimeout(timer);
    sleep(a);
  });

  // ---------- Commandes ----------
  $('#seed').addEventListener('input', function () { saveSeed(this.value.trim()); relink(); });
  $('#random').addEventListener('click', function () {
    $('#seed').value = randomSeed();
    saveSeed($('#seed').value);
    relink();
  });
  $('#seedForm').addEventListener('submit', function (e) { e.preventDefault(); });

  $('#seed').value = loadSeed() || randomSeed();
  saveSeed($('#seed').value);
  render();
})();
