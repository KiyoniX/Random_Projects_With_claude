// Fabrique de langues : interface. La langue est celle du peuple de la planète portant la même graine dans l'Atlas des mondes.
(function () {
  'use strict';

  var Lang = window.Lang, PG = window.PG;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };

  var state = { seed: '', tuned: [], L: null, world: null, over: { cons: null, vows: null, order: null }, base: null };

  // ---------- Monde d'origine (calculé avec le moteur de l'Atlas) ----------
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
    $('#name').textContent = name;
    $('#origin').textContent = p ? (p.aquatic ? 'Peuple marin' : 'Peuple') + ' de la planète ' + w.planet + ' · ' + p.tech.name.toLowerCase()
      : w ? 'La planète ' + w.planet + ' n\'a pas de peuple : cette langue est née sans monde' : 'Langue sans monde';
    var fr = p ? 'Nous sommes les ' + p.name + '.' : 'Bonjour, étranger.';
    var t = L.translate(fr);
    $('#heroScript').innerHTML = L.write(t.text, 46);
    $('#heroRoman').textContent = t.text;
    $('#heroFr').textContent = '« ' + fr + ' »';
    var link = $('#toAtlas');
    link.hidden = !w;
    link.href = '../atlas-des-mondes/index.html#' + address();
  }

  function renderWorld() {
    var L = state.L, box = $('#world'), p = state.world && state.world.people;
    box.hidden = !p;
    if (!p) return;
    var causes = L.traits.concat([{ cause: 'Support d\'écriture', effect: 'écriture ' + L.script.name + ' : ' + L.script.desc }]);
    $('#causes').innerHTML = causes.map(function (c) { return '<li><b>' + esc(c.cause) + '</b>' + esc(cap(c.effect)) + '.</li>'; }).join('');
    $('#wwords').innerHTML = state.words.length ? state.words.map(function (x) {
      return x.word
        ? '<li><span class="w">' + esc(x.word) + '</span>' + L.write(x.word, 26) + '<span class="fr">' + esc(x.fr) + '</span><span class="why">' + esc(cap(x.note)) + '.</span></li>'
        : '<li class="none"><span class="w">pas de mot pour « ' + esc(x.fr) + ' »</span><span></span><span class="why">' + esc(cap(x.note.replace('aucun mot : ', ''))) + '.</span></li>';
    }).join('') : '<li class="none"><span class="w">Rien de particulier</span><span></span><span class="why">Ce monde ressemble assez au nôtre pour que le vocabulaire se recouvre.</span></li>';
  }

  function renderSounds() {
    var L = state.L;
    var chips = function (all, on) {
      return Object.keys(all).map(function (p) { return '<button type="button" class="chip" data-p="' + esc(p) + '" aria-pressed="' + (on.indexOf(p) >= 0) + '">' + esc(p) + '</button>'; }).join('');
    };
    $('#cons').innerHTML = chips(Lang.CONS, L.cons);
    $('#vows').innerHTML = chips(Lang.VOWS, L.vows);
    $('#nCons').textContent = '· ' + L.cons.length;
    $('#nVows').textContent = '· ' + L.vows.length;
    var r = Lang.rng('exemples' + state.seed + L.cons.join('') + L.vows.join('')), syl = [];
    for (var i = 0; i < 8; i++) syl.push(L.syllable(r));
    $('#shape').innerHTML = 'Forme des syllabes : <b>' + L.shape + '</b> (C = consonne, V = voyelle, L = l, r ou w ; entre parenthèses = facultatif). Par exemple : <b>' + syl.join(', ') + '</b>.';
    $('#resetSounds').hidden = !(state.over.cons || state.over.vows);
  }

  function renderTranslation() {
    var L = state.L, t = L.translate($('#input').value);
    $('#resScript').innerHTML = t.text ? L.write(t.text, 38) : '';
    $('#resRoman').textContent = t.text || '…';
    $('#resGloss').innerHTML = t.sentences.map(function (s) {
      return s.words.map(function (w) { return '<span class="wd' + (w.coined ? ' coined' : '') + '"><b>' + esc(w.w) + '</b><span>' + esc(w.g) + '</span></span>'; }).join('');
    }).join('<span class="sep"></span>');
    $('#resNotes').innerHTML = t.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
    renderThenNow();
  }

  function renderGrammar() {
    var L = state.L;
    $('#order').value = L.G.order;
    $('#gram').innerHTML = '<tr><th>Règle</th><th>Dans cette langue</th><th>Exemple</th></tr>' + Lang.describe(L).map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + esc(cap(r.rule)) + '</td><td><span class="ex">' + esc(r.ex) + '</span><br><span class="fr">' + esc(r.fr) + '</span></td></tr>';
    }).join('');
  }

  function renderScript() {
    var L = state.L;
    $('#scriptDesc').textContent = 'Écriture ' + L.script.name + ' : ' + L.script.desc + '. Un signe par son' + (L.script.bar ? ', les signes d\'un mot reliés par une barre' : '') + '.';
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
    $('#yearsOut').textContent = years ? years + ' ans' : 'aujourd\'hui';
    $('#laws').innerHTML = years && D.laws.length ? D.laws.map(function (l, i) { return '<li>' + esc(cap(l)) + ' <span style="color:var(--muted)">(vers l\'an ' + Math.round((i + 1) * years / D.laws.length) + ')</span></li>'; }).join('')
      : '<li class="none">Déplacez le curseur pour faire vieillir la langue.</li>';
    $('#evo').innerHTML = '<tr><th>Sens</th><th>Langue ancienne</th><th>' + (years ? years + ' ans plus tard' : 'Aujourd\'hui') + '</th><th>Écriture</th></tr>' + SAMPLE.map(function (c) {
      var a = L.form(c), b = D.form(c);
      return '<tr><td>' + c + '</td><td>' + esc(a) + '</td><td class="' + (a !== b ? 'chg' : '') + '">' + esc(b) + '</td><td>' + L.write(b, 22) + '</td></tr>';
    }).join('');
    renderThenNow();
    renderDialects();
  }
  function renderThenNow() {
    var L = state.L, years = +$('#years').value, text = $('#input').value;
    if (!years || !text.trim()) { $('#thenNow').innerHTML = ''; return; }
    $('#thenNow').innerHTML = '<div><span class="label">Votre phrase, langue ancienne</span><p>' + esc(L.translate(text).text) + '</p></div>' +
      '<div><span class="label">La même, ' + years + ' ans plus tard</span><p>' + esc(aged().translate(text).text) + '</p></div>';
  }
  function renderDialects() {
    var L = state.L, p = state.world && state.world.people, box = $('#dialects');
    if (!p || p.cities.length < 2) { box.innerHTML = ''; return; }
    var cities = p.cities.slice(0, 4), vars = cities.map(function (c, i) { return i === 0 ? L : L.derive('cité' + c.name, Math.min(i + 1, 4)); });
    box.innerHTML = '<h4 class="sub-h">D\'une cité à l\'autre</h4><p class="block-sub" style="margin-bottom:1rem">' + esc(cities[0].name) + ' parle la langue de référence. Plus une cité en est éloignée par le rang, plus son parler a dérivé.</p>' +
      '<div class="table-wrap"><table class="evo"><tr><th>Sens</th>' + cities.map(function (c) { return '<th>' + esc(c.name) + '</th>'; }).join('') + '</tr>' +
      SAMPLE.slice(0, 9).map(function (c) {
        var ref = L.form(c);
        return '<tr><td>' + c + '</td>' + vars.map(function (v) { var f = v.form(c); return '<td class="' + (f !== ref ? 'chg' : '') + '">' + esc(f) + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '<tr><td>lois</td>' + vars.map(function (v, i) { return '<td style="font-family:var(--sans);font-size:.78rem;color:var(--muted)">' + (i ? v.laws.map(esc).join(' ; ') : 'référence') + '</td>'; }).join('') + '</tr></table></div>';
  }

  function renderDict() {
    var L = state.L, q = $('#search').value.trim().toLowerCase(), cat = $('#cat').value;
    var rows = L.dictionary().filter(function (e) {
      return (!cat || e.cat === cat) && (!q || e.fr.toLowerCase().indexOf(q) >= 0 || (e.word || '').indexOf(q) >= 0);
    });
    $('#dict').innerHTML = rows.length ? rows.map(function (e) {
      return e.word
        ? '<div class="entry"><b>' + esc(e.word) + '</b>' + L.write(e.word, 22) + '<span class="fr">' + esc(e.fr) + '<i>' + e.pos + '</i></span></div>'
        : '<div class="entry none"><b>aucun mot</b><span></span><span class="fr">' + esc(e.fr) + '<i>' + esc(e.why) + '</i></span></div>';
    }).join('') : '<p class="empty">Aucun mot ne correspond.</p>';
  }

  function render() {
    renderHero(); renderWorld(); renderSounds(); renderGrammar(); renderScript();
    $('#examples').innerHTML = examples().map(function (e) { return '<button type="button">' + esc(e) + '</button>'; }).join('');
    if (!$('#input').value || state.fresh) { $('#input').value = examples()[0]; state.fresh = false; }
    renderTranslation(); renderEvolution(); renderDict();
  }

  // ---------- Chargement ----------
  function address() { return encodeURIComponent(state.seed) + (state.tuned.length ? ';' + state.tuned.join(';') : ''); }
  function load(seed, tuned) {
    state.seed = seed; state.tuned = tuned || [];
    state.over = { cons: null, vows: null, order: null };
    state.fresh = true;
    $('#seed').value = seed;
    try { history.replaceState(null, '', '#' + address()); } catch (e) { /* adresse non modifiable en local sur certains navigateurs */ }
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
  $('#examples').addEventListener('click', function (e) { if (e.target.tagName === 'BUTTON') { $('#input').value = e.target.textContent; renderTranslation(); } });
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
