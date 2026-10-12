// Chapitre « Petit guide de conversation ». La langue est celle du peuple de la planète portant la même graine.
(function () {
  'use strict';

  var Lang = window.Lang, PG = window.PG, Guide = window.Guide;
  var $ = function (s) { return document.querySelector(s); };
  var esc = Guide.esc, attr = Guide.attr, typo = Guide.typo, cap = Guide.cap;

  var state = { seed: '', tuned: [], L: null, world: null, over: { cons: null, vows: null, order: null }, base: null };

  // ---------- Monde d'origine (calculé avec le moteur de la planète) ----------
  function worldOf(seed, tuned) {
    if (!PG || !PG.fields) return null;
    var prm = PG.randomParams(seed);
    if (tuned.length === 6 && PG.STARS[tuned[0]]) {
      var n = tuned.slice(1).map(Number);
      if (n.every(isFinite)) { prm.star = tuned[0]; prm.S = n[0]; prm.water = n[1]; prm.P = n[2]; prm.R = n[3]; prm.tilt = n[4]; }
    }
    var pl = PG.classify(PG.fields(seed), prm), life = PG.life(pl, seed);
    var nameRng = PG.rng('nom' + seed);
    var planet = PG.langFor(null, seed).word(nameRng, 2, 3) + (nameRng() < 0.5 ? ' ' + ['II', 'III', 'IV', 'V', 'VI', 'b', 'c'][Math.floor(nameRng() * 7)] : '');
    return { pl: pl, prm: prm, life: life, people: life.people, planet: planet };
  }

  function build() {
    var w = state.world, people = w && w.people, opts = {};
    if (people && people.lang.opts) { opts.env = people.lang.opts.env; opts.medium = people.lang.opts.medium; }
    if (state.over.cons) opts.cons = state.over.cons;
    if (state.over.vows) opts.vows = state.over.vows;
    if (state.over.order) opts.order = state.over.order;
    var L = state.L = Lang.create(state.seed, opts);
    state.words = [];
    if (people) {
      var f = function (id) { return w.pl.stats[id].frac; }, B = PG.B;
      state.words = Lang.worldWords(L, {
        aquatic: people.aquatic, moons: w.prm.moons, tilt: w.prm.tilt, tech: people.level, T: people.home.T,
        ice: f(B.SEA_ICE) + f(B.ICE), liquid: w.pl.liquid, dry: f(B.DESERT) + f(B.ARID), dayH: w.prm.dayH, star: w.prm.star, g: w.pl.g
      });
    }
    render();
  }

  // ---------- Rendu ----------
  function examples() {
    var w = state.world, p = w && w.people, list = ['Le chasseur voit la bête.', 'Je ne mange pas de viande.', 'Les enfants vont dormir.', 'La maison de mon père est très vieille.', 'Est-ce que tu parles notre langue ?'];
    if (p) {
      var sun = { M: 'rouge', K: 'jaune', G: 'jaune', F: 'blanc' }[w.prm.star];
      list.unshift('Nous sommes les ' + p.name + '.', 'Le soleil ' + sun + ' brille sur ' + (p.aquatic || w.pl.liquid > 0.5 ? 'la mer' : 'la terre') + '.');
      if (p.cities[0]) list.push('Mon frère habite à ' + p.cities[0].name + '.');
    }
    return list;
  }

  function renderHero() {
    var w = state.world, p = w && w.people, L = state.L;
    var name = p ? 'La langue des ' + p.name : 'Langue ' + L.word(Lang.rng('nomlangue' + state.seed), 2, 3);
    $('#name').textContent = typo(name + ', ');
    $('#origin').textContent = typo(p ? (p.aquatic ? 'peuple marin' : 'peuple') + ' de la planète ' + w.planet + ' (' + p.tech.name.toLowerCase() + ').'
      : w ? 'née sans monde : la planète ' + w.planet + ' n\'a pas de peuple.' : 'langue sans monde.');
    var fr = p ? 'Nous sommes les ' + p.name + '.' : 'Bonjour, étranger.';
    var t = L.translate(fr);
    $('#heroScript').innerHTML = L.write(t.text, 46);
    $('#heroRoman').textContent = typo(t.text);
    $('#heroFr').textContent = typo('« ' + fr + ' »');
    Guide.destination(w ? w.planet : name, 'Petit guide de conversation');
  }

  function renderWorld() {
    var L = state.L, p = state.world && state.world.people;
    $('#world').hidden = !p; $('#mots').hidden = !p;
    if (!p) return;
    var causes = L.traits.concat([{ cause: 'Support d\'écriture', effect: 'écriture ' + L.script.name + ' : ' + L.script.desc }]);
    $('#causes').innerHTML = causes.map(function (c) { return '<li><b>' + esc(c.cause) + '.</b> ' + esc(cap(c.effect)) + '.</li>'; }).join('');
    $('#wwords').innerHTML = state.words.length ? state.words.map(function (x) {
      return x.word
        ? '<li><span class="w indigene">' + esc(x.word) + '</span>' + L.write(x.word, 26) + '<span class="fr">' + esc(x.fr) + '</span><span class="why">' + esc(cap(x.note)) + '.</span></li>'
        : '<li class="none"><span class="w">Pas de mot pour « ' + esc(x.fr) + ' »</span><span></span><span class="why">' + esc(cap(x.note.replace('aucun mot : ', ''))) + '.</span></li>';
    }).join('') : '<li class="none"><span class="w">Rien de particulier</span><span></span><span class="why">Ce monde ressemble assez au nôtre pour que le vocabulaire se recouvre.</span></li>';
  }

  // Conseils de prononciation pour les sons qui ne se lisent pas comme en français
  var ASTUCES = { sh: 'comme « ch » dans chat', ch: 'comme « tch » dans tchèque', kh: 'raclé au fond de la gorge, comme la jota espagnole', th: 'la langue entre les dents, comme l\'anglais think',
    dj: 'comme dans djinn', q: 'un k prononcé tout au fond de la gorge', '\'': 'bref arrêt de la voix, comme entre les deux mots de « le haut »', h: 'toujours soufflé',
    w: 'comme « ou » dans oui', y: 'comme dans yaourt', r: 'roulé du bout de la langue', s: 'toujours dur, comme dans sol', g: 'toujours dur, comme dans gare',
    e: 'comme « è » dans mer', u: 'comme dans lune', ai: 'comme dans ail', au: '« a » puis « o », d\'un seul souffle', eu: 'comme dans feu' };
  function renderSounds() {
    var L = state.L;
    var chips = function (all, on) {
      return Object.keys(all).map(function (p) { return '<button type="button" class="chip" data-p="' + attr(p) + '" aria-pressed="' + (on.indexOf(p) >= 0) + '">' + esc(p) + '</button>'; }).join('');
    };
    $('#cons').innerHTML = chips(Lang.CONS, L.cons);
    $('#vows').innerHTML = chips(Lang.VOWS, L.vows);
    $('#nCons').textContent = '(' + L.cons.length + ')';
    $('#nVows').textContent = '(' + L.vows.length + ')';
    var r = Lang.rng('exemples' + state.seed + L.cons.join('') + L.vows.join('')), syl = [];
    for (var i = 0; i < 8; i++) syl.push(L.syllable(r));
    $('#shape').innerHTML = 'Les syllabes ont la forme <b>' + L.shape + '</b> (C : consonne ; V : voyelle ; L : l, r ou w ; entre parenthèses, ce qui est facultatif). Par exemple : <span class="indigene">' + esc(syl.join(', ')) + '</span>.';
    $('#astuces').innerHTML = L.cons.concat(L.vows).filter(function (p) { return ASTUCES[p]; }).map(function (p) {
      return '<li><b>' + esc(p) + '</b>' + esc(ASTUCES[p]) + '</li>';
    }).join('');
    $('#resetSounds').hidden = !(state.over.cons || state.over.vows);
  }

  function renderTranslation() {
    var L = state.L, t = L.translate($('#input').value);
    $('#resScript').innerHTML = t.text ? L.write(t.text, 38) : '';
    $('#resRoman').textContent = typo(t.text || '…');
    $('#resGloss').innerHTML = t.sentences.map(function (s) {
      return s.words.map(function (w) { return '<span class="wd' + (w.coined ? ' coined' : '') + '"><b>' + esc(w.w) + '</b><span>' + esc(w.g) + '</span></span>'; }).join('');
    }).join('<span class="sep"></span>');
    $('#resNotes').innerHTML = t.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
    renderThenNow();
  }

  function renderGrammar() {
    var L = state.L;
    $('#order').value = L.G.order;
    $('#gram').innerHTML = Lang.describe(L).map(function (r) {
      return '<div class="regle-gram"><h3>' + esc(r.name) + '</h3><p class="loi">' + esc(cap(r.rule)) + '.</p><p class="ex"><span class="indigene">' + esc(r.ex) + '</span><br><span class="fr">' + esc(r.fr) + '</span></p></div>';
    }).join('');
  }

  function renderScript() {
    var L = state.L;
    $('#scriptDesc').textContent = typo('Écriture ' + L.script.name + ' : ' + L.script.desc + '. Un signe par son' + (L.script.bar ? ', les signes d\'un mot reliés par une barre' : '') + '.');
    $('#alphabet').innerHTML = L.cons.concat(L.vows).map(function (p) {
      return '<div><svg viewBox="0 0 20 31" aria-hidden="true">' + L.glyph(p) + '</svg><span>' + esc(p) + '</span></div>';
    }).join('');
  }

  var SAMPLE = ['soleil', 'eau', 'terre', 'nuit', 'homme', 'femme', 'enfant', 'main', 'cœur', 'maison', 'manger', 'voir', 'parler', 'grand', 'bon', 'froid'];
  function aged() {
    var years = +$('#years').value;
    return years ? state.L.derive('temps', years / 250, years) : state.L;
  }
  function renderEvolution() {
    var L = state.L, years = +$('#years').value, D = aged();
    $('#yearsOut').textContent = typo(years ? years + ' ans' : 'aujourd\'hui');
    $('#laws').innerHTML = years && D.laws.length ? D.laws.map(function (l, i) { return '<li>' + esc(cap(l)) + ' <span class="vers">vers l’an ' + Math.round((i + 1) * years / D.laws.length) + '</span></li>'; }).join('')
      : '<li class="none">Déplacez la réglette pour faire vieillir la langue.</li>';
    $('#evo').innerHTML = '<tr><th>Sens</th><th>Langue ancienne</th><th>' + (years ? years + ' ans plus tard' : 'Aujourd’hui') + '</th><th>Écriture</th></tr>' + SAMPLE.map(function (c) {
      var a = L.form(c), b = D.form(c);
      return '<tr><td>' + c + '</td><td class="indigene">' + esc(a) + '</td><td class="indigene' + (a !== b ? ' chg' : '') + '">' + esc(b) + '</td><td>' + L.write(b, 22) + '</td></tr>';
    }).join('');
    renderThenNow();
    renderDialects();
  }
  function renderThenNow() {
    var L = state.L, years = +$('#years').value, text = $('#input').value;
    if (!years || !text.trim()) { $('#thenNow').innerHTML = ''; return; }
    $('#thenNow').innerHTML = '<div><h4>Votre phrase, langue ancienne</h4><p class="indigene">' + esc(L.translate(text).text) + '</p></div>' +
      '<div><h4>La même, ' + years + ' ans plus tard</h4><p class="indigene">' + esc(aged().translate(text).text) + '</p></div>';
  }
  function renderDialects() {
    var L = state.L, p = state.world && state.world.people, box = $('#dialects');
    if (!p || p.cities.length < 2) { box.innerHTML = ''; return; }
    var cities = p.cities.slice(0, 4), vars = cities.map(function (c, i) { return i === 0 ? L : L.derive('cité' + c.name, Math.min(i + 1, 4)); });
    box.innerHTML = '<h3 class="sous">D’une cité à l’autre</h3><p class="dial-note">' + esc(cities[0].name) + ' parle la langue de référence. Plus une cité en est éloignée par le rang, plus son parler a dérivé.</p>' +
      '<div class="defile"><table class="tableau evo"><tr><th>Sens</th>' + cities.map(function (c, i) { return '<th><span class="renvoi">' + (i + 1) + '</span> ' + esc(c.name) + '</th>'; }).join('') + '</tr>' +
      SAMPLE.slice(0, 9).map(function (c) {
        var ref = L.form(c);
        return '<tr><td>' + c + '</td>' + vars.map(function (v) { var f = v.form(c); return '<td class="indigene' + (f !== ref ? ' chg' : '') + '">' + esc(f) + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '<tr class="lois"><td>lois</td>' + vars.map(function (v, i) { return '<td>' + (i ? v.laws.map(esc).join(' ; ') : 'référence') + '</td>'; }).join('') + '</tr></table></div>';
  }

  function renderDict() {
    var L = state.L, q = $('#search').value.trim().toLowerCase(), cat = $('#cat').value;
    var rows = L.dictionary().filter(function (e) {
      return (!cat || e.cat === cat) && (!q || e.fr.toLowerCase().indexOf(q) >= 0 || (e.word || '').indexOf(q) >= 0);
    });
    $('#dict').innerHTML = rows.length ? rows.map(function (e) {
      return e.word
        ? '<div class="entry"><span class="fr">' + esc(e.fr) + ' <i>' + e.pos + '</i></span><b class="indigene">' + esc(e.word) + '</b>' + L.write(e.word, 20) + '</div>'
        : '<div class="entry none"><span class="fr">' + esc(e.fr) + '</span><b>aucun mot</b><i>' + esc(e.why) + '</i></div>';
    }).join('') : '<p class="empty">Aucun mot ne correspond.</p>';
  }

  // Expressions utiles : une simple lecture de la langue, qui ne doit laisser aucune trace dans ses racines ni dans ses signes
  var PHRASES = ['Bonjour, ami.', 'Merci beaucoup.', 'Oui. Non.', 'Je ne parle pas votre langue.', 'Où est la ville ?', 'Je cherche de l\'eau.', 'Je veux manger et dormir.',
    'Combien pour ce pain ?', 'Je suis un étranger.', 'Nous venons en paix.', 'Votre maison est belle.', 'Adieu.'];
  function renderPhrases() {
    var L = state.L, S = L.script, keep = { base: L._base, used: L._used, form: L._form, g: S._g, sig: S._sig }, rows = '';
    L._base = Object.assign({}, keep.base); L._used = Object.assign({}, keep.used); L._form = Object.assign({}, keep.form);
    S._g = Object.assign({}, keep.g); S._sig = Object.assign({}, keep.sig);
    try {
      rows = PHRASES.map(function (fr) {
        var t = L.translate(fr);
        return '<tr><td>' + esc(fr) + '</td><td class="indigene">' + esc(t.text) + '</td><td>' + L.write(t.text, 24) + '</td></tr>';
      }).join('');
    } finally {
      L._base = keep.base; L._used = keep.used; L._form = keep.form; S._g = keep.g; S._sig = keep.sig;
    }
    $('#phrases').innerHTML = '<tr><th>En français</th><th>Dites</th><th>Vous lirez</th></tr>' + rows;
  }

  function render() {
    renderHero(); renderWorld(); renderSounds(); renderGrammar(); renderScript();
    $('#examples').innerHTML = examples().map(function (e) { return '<button type="button" class="bouton" data-fr="' + attr(e) + '">' + esc(e) + '</button>'; }).join('');
    if (!$('#input').value || state.fresh) { $('#input').value = examples()[0]; state.fresh = false; }
    renderTranslation(); renderEvolution(); renderDict();
    renderPhrases();
    Guide.sommaire();
  }

  // ---------- Chargement ----------
  function address() { return encodeURIComponent(state.seed) + (state.tuned.length ? ';' + state.tuned.join(';') : ''); }
  function load(seed, tuned) {
    state.seed = seed; state.tuned = tuned || [];
    state.over = { cons: null, vows: null, order: null };
    state.fresh = true;
    $('#seed').value = seed;
    try { history.replaceState(null, '', '#' + address()); } catch (e) { /* adresse non modifiable en local sur certains navigateurs */ }
    Guide.adresse(address());
    $('#toAtlas').href = '../atlas-des-mondes/index.html#' + address();
    $('#toHist').href = '../chroniques/index.html#' + address();
    state.world = worldOf(seed, state.tuned);
    build();
  }
  function randomSeed() {
    var a = ['astre', 'brume', 'corail', 'dune', 'ecume', 'forge', 'givre', 'halo', 'iris', 'jade', 'lune', 'mousse', 'nacre', 'onde', 'pollen', 'quartz', 'roc', 'sable', 'tourbe', 'volcan'];
    return a[Math.floor(Math.random() * a.length)] + '-' + Math.floor(Math.random() * 9000 + 1000);
  }

  // ---------- Événements ----------
  function toggle(kind, p) {
    var cur = (state.over[kind] || state.L[kind]).slice(), i = cur.indexOf(p);
    if (i >= 0) cur.splice(i, 1); else cur.push(p);
    if (cur.length < (kind === 'cons' ? 3 : 1)) return;
    state.over[kind] = cur;
    build();
  }
  $('#cons').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (b) toggle('cons', b.dataset.p); });
  $('#vows').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (b) toggle('vows', b.dataset.p); });
  $('#resetSounds').addEventListener('click', function () { state.over.cons = state.over.vows = null; build(); });
  $('#order').addEventListener('change', function () { state.over.order = this.value; build(); });
  $('#input').addEventListener('input', renderTranslation);
  $('#examples').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { $('#input').value = b.dataset.fr; renderTranslation(); } });
  $('#years').addEventListener('input', renderEvolution);
  $('#search').addEventListener('input', renderDict);
  $('#cat').addEventListener('change', renderDict);
  $('#newBtn').addEventListener('click', function () { load(randomSeed()); });
  $('#seedForm').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#seed').value.trim(); if (v) load(v); });

  var cats = [];
  Lang.CONCEPTS.forEach(function (c) { if (cats.indexOf(c.cat) < 0) cats.push(c.cat); });
  $('#cat').innerHTML = '<option value="">Toutes les catégories</option>' + cats.map(function (c) { return '<option>' + c + '</option>'; }).join('');

  var parts = location.hash.slice(1).split(';'), initial = '';
  try { initial = decodeURIComponent(parts[0]); } catch (e) { /* adresse illisible : nouvelle graine */ }
  load(initial || randomSeed(), parts.slice(1));

  window.__fabrique = { state: state, load: load };
})();
