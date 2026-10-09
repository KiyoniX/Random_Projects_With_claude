// Interface : contrôles, globe animé, carte, fiches du vivant.
(function () {
  'use strict';

  var PG = window.PG, W = PG.W, H = PG.H, B = PG.B;
  var $ = function (s) { return document.querySelector(s); };
  var fr = function (n, d) { return n.toLocaleString('fr-FR', { maximumFractionDigits: d === undefined ? 1 : d }); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  var state = { seed: '', prm: null, F: null, pl: null, life: null, mode: 'natural', tex: {}, shift: 0, paused: false, name: '' };
  var globe = new PG.Globe($('#globe'));
  var mapCtx = $('#map').getContext('2d');

  function texture(mode) {
    if (!state.tex[mode]) state.tex[mode] = PG.texture(state.pl, mode);
    return state.tex[mode];
  }

  // ---------- Rendu ----------
  function renderSheet() {
    var pl = state.pl, prm = pl.prm;
    $('#pStar').textContent = 'En orbite autour d\'une ' + pl.star.name + ' · ' + fr(pl.star.kelvin, 0) + ' K';
    $('#pName').textContent = state.name;
    $('#pVerdict').textContent = pl.verdict;
    var facts = [
      ['Température moyenne', fr(pl.Tmean, 0) + ' °C'],
      ['Gravité', fr(pl.g, 2) + ' g'],
      ['Rayon', fr(pl.radiusKm, 0) + ' km'],
      ['Eau liquide', fr(pl.liquid * 100, 0) + ' % de la surface'],
      ['Ébullition de l\'eau', isFinite(pl.boil) ? fr(pl.boil, 0) + ' °C' : 'impossible'],
      ['Distance à l\'étoile', fr(pl.au, 2) + ' UA'],
      ['Jour', prm.dayH + ' h'],
      ['Année', fr(pl.yearDays * 24 / prm.dayH, 0) + ' jours locaux'],
      ['Lunes', String(prm.moons)]
    ];
    $('#facts').innerHTML = facts.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('');
  }

  function syncControls() {
    var p = state.prm;
    $('#cStar').value = p.star; $('#cS').value = p.S; $('#cWater').value = p.water; $('#cP').value = p.P; $('#cR').value = p.R; $('#cTilt').value = p.tilt;
    outputs();
  }
  function outputs() {
    var p = state.prm;
    $('#oS').textContent = fr(p.S * 100, 0) + ' % de la Terre';
    $('#oWater').textContent = fr(p.water * 100, 0) + ' %';
    $('#oP').textContent = fr(p.P, 2) + ' bar';
    $('#oR').textContent = fr(p.R, 2) + ' × Terre';
    $('#oTilt').textContent = p.tilt + '°';
  }

  function renderMap() {
    mapCtx.putImageData(new ImageData(texture(state.mode), W, H), 0, 0);
    var people = state.life.people;
    if (!people) return;
    mapCtx.font = '600 11px "Segoe UI", sans-serif';
    mapCtx.textBaseline = 'middle';
    people.cities.forEach(function (c, r) {
      mapCtx.beginPath();
      mapCtx.arc(c.i, c.j, r === 0 ? 4.5 : 3.2, 0, 6.283);
      mapCtx.fillStyle = '#fff'; mapCtx.fill();
      mapCtx.lineWidth = 1.5; mapCtx.strokeStyle = '#111'; mapCtx.stroke();
      var tw = mapCtx.measureText(c.name).width, left = c.i + tw + 12 > W;
      var tx = left ? c.i - tw - 8 : c.i + 8;
      mapCtx.lineWidth = 3; mapCtx.strokeStyle = 'rgba(0,0,0,.75)'; mapCtx.strokeText(c.name, tx, c.j);
      mapCtx.fillStyle = '#fff'; mapCtx.fillText(c.name, tx, c.j);
    });
  }

  function renderBiomes() {
    var pal = PG.palette(state.pl.star);
    var rows = state.pl.stats.filter(function (s) { return s.frac >= 0.004; }).sort(function (a, b) { return b.frac - a.frac; });
    $('#biomes').innerHTML = rows.map(function (s) {
      return '<li><i style="background:' + PG.rgb(pal[s.id]) + '"></i><span>' + PG.BIOMES[s.id].name + '</span><b>' + fr(s.frac * 100, 1) + ' %</b>' +
        '<span class="bar"><span style="width:' + Math.max(1, s.frac / rows[0].frac * 100) + '%"></span></span></li>';
    }).join('');
  }

  function speciesCard(sp, ground) {
    var sizeTxt = sp.size >= 1 ? fr(sp.size, 1) + ' m' : fr(sp.size * 100, 0) + ' cm';
    var massTxt = sp.mass >= 1000 ? fr(sp.mass / 1000, 1) + ' t' : sp.mass >= 1 ? fr(sp.mass, 0) + ' kg' : fr(sp.mass * 1000, 0) + ' g';
    return '<article class="sp"><div class="sp-art" style="--ground:' + ground + '">' + PG.drawCreature(sp.traits) + '</div><div class="sp-body">' +
      '<h5>' + esc(sp.name) + '</h5><p class="sp-role">' + sp.role + '</p>' +
      '<p class="sp-nums">' + sizeTxt + ' · ' + massTxt + ' · ≈ ' + PG.count(sp.pop, 'individus') + '</p>' +
      '<p class="sp-habit">' + esc(sp.habit.charAt(0).toUpperCase() + sp.habit.slice(1)) + '.</p>' +
      '<ul class="adapt">' + sp.adapt.map(function (a) { return '<li><span>' + esc(a.cause) + '</span>' + esc(a.effect) + '</li>'; }).join('') + '</ul></div></article>';
  }
  function groundOf(id) {
    return PG.rgb(PG.mix(PG.palette(state.pl.star)[id], [10, 12, 20], 0.55));
  }

  function renderLife() {
    var life = state.life, note = $('#lifeNote');
    note.hidden = !life.note; note.textContent = life.note;
    var pal = PG.palette(state.pl.star);
    $('#life').innerHTML = life.groups.map(function (g) {
      var st = g.stat;
      return '<div class="group"><div class="group-info"><div class="group-head"><i style="background:' + PG.rgb(pal[st.id]) + '"></i><h4>' + g.biome.name + '</h4></div>' +
        '<p class="group-stats">' + fr(st.frac * 100, 1) + ' % de la planète<br>' + fr(st.T, 0) + ' °C en moyenne' + (st.id > 2 ? '<br>humidité ' + fr(st.M * 100, 0) + ' %' : '') + '</p>' +
        '<p class="flora"><b>Flore : ' + esc(g.flora.name) + '.</b> ' + g.flora.form.charAt(0).toUpperCase() + g.flora.form.slice(1) + (g.flora.notes.length ? ' ; ' + g.flora.notes.map(esc).join(' ; ') : '') + '.</p>' +
        '</div>' + g.fauna.map(function (sp) { return speciesCard(sp, groundOf(st.id)); }).join('') + '</div>';
    }).join('');
  }

  function renderPeople() {
    var p = state.life.people, box = $('#people');
    if (!p) { box.innerHTML = '<p class="note">' + state.life.peopleNote + '</p>'; return; }
    var b = p.body, sizeTxt = fr(b.size, 2) + ' m';
    var facts = [['Stade', p.tech.name], ['Population', '≈ ' + PG.count(p.total, 'individus')], ['Berceau', PG.BIOMES[p.home.id].name + ', ' + fr(p.home.T, 0) + ' °C']]
      .concat(p.aquatic ? [] : [['Taille', sizeTxt]]).concat(p.facts);
    box.innerHTML = '<div class="people"><div class="people-main">' +
      '<div class="people-top"><div class="sp-art" style="--ground:' + groundOf(p.home.id) + '">' + PG.drawCreature(b.traits) + '</div>' +
      '<div><p class="eyebrow">' + (p.aquatic ? 'Peuple marin' : 'Peuple') + '</p><h4>Les ' + esc(p.name) + '</h4></div></div>' +
      '<dl class="kv">' + facts.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>' +
      '<ul class="adapt" style="margin-top:1rem">' + b.adapt.map(function (a) { return '<li><span>' + esc(a.cause) + '</span>' + esc(a.effect) + '</li>'; }).join('') + '</ul>' +
      '</div><div class="cities"><h5>Ses ' + p.tech.word + ' · points blancs sur la carte</h5><ul>' +
      p.cities.map(function (c, r) {
        return '<li><span class="rank">' + (r + 1) + '</span><span class="cname">' + esc(c.name) + '<small>' + PG.BIOMES[c.biome].name + '</small></span><span class="cpop">' + PG.count(c.pop, 'habitants') + '</span></li>';
      }).join('') +
      '</ul></div></div>' + languageCard(p);
  }

  function languageCard(p) {
    var L = p.lang;
    if (!L || !L.translate) return '';
    var hello = L.translate('Nous sommes les ' + p.name + '.');
    var traits = L.traits.length ? L.traits : [{ cause: 'Sons', effect: L.cons.length + ' consonnes et ' + L.vows.length + ' voyelles ; ordre des mots ' + L.G.order }];
    return '<div class="langcard"><div><p class="eyebrow">Langue</p><h4>La langue des ' + esc(p.name) + '</h4>' +
      '<ul class="adapt">' + traits.map(function (t) { return '<li><span>' + esc(t.cause) + '</span>' + esc(t.effect) + '</li>'; }).join('') +
      '<li><span>Écriture ' + L.script.name + '</span>' + esc(L.script.desc) + '</li></ul></div>' +
      '<div class="langsample">' + L.write(hello.text, 34) + '<p class="roman">' + esc(hello.text) + '</p><p class="gloss">« Nous sommes les ' + esc(p.name) + '. »</p>' +
      '<a class="btn" href="../langues-inventees/index.html#' + address() + '">Explorer la langue</a> ' +
      '<a class="btn btn-ghost" href="../chroniques/index.html#' + address() + '">Lire son histoire</a></div></div>';
  }

  // ---------- Mise à jour ----------
  function update() {
    state.pl = PG.classify(state.F, state.prm);
    state.life = PG.life(state.pl, state.seed);
    state.tex = {};
    // La géométrie du globe ne dépend que de l'inclinaison et de l'atmosphère
    var key = [state.prm.tilt, state.prm.P, state.prm.star, state.pl.haze].join('|');
    if (key !== state.globeKey) { state.globeKey = key; globe.build(state.pl); }
    renderSheet(); renderMap(); renderBiomes(); renderLife(); renderPeople();
  }

  // L'adresse retient la graine et les réglages : « graine;étoile;ensoleillement;eau;air;taille;inclinaison »
  function address() {
    var p = state.prm;
    return encodeURIComponent(state.seed) + ';' + [p.star, p.S, p.water, p.P, p.R, p.tilt].join(';');
  }
  function saveAddress() {
    try { history.replaceState(null, '', '#' + address()); } catch (e) { /* adresse non modifiable en local sur certains navigateurs */ }
  }

  function load(seed, tuned) {
    state.seed = seed;
    state.prm = PG.randomParams(seed);
    if (tuned && tuned.length === 6 && PG.STARS[tuned[0]]) {
      var num = tuned.slice(1).map(Number);
      if (num.every(isFinite)) { state.prm.star = tuned[0]; state.prm.S = num[0]; state.prm.water = num[1]; state.prm.P = num[2]; state.prm.R = num[3]; state.prm.tilt = num[4]; }
    }
    var nameRng = PG.rng('nom' + seed);
    state.name = PG.langFor(null, seed).word(nameRng, 2, 3) + (nameRng() < 0.5 ? ' ' + ['II', 'III', 'IV', 'V', 'VI', 'b', 'c'][Math.floor(nameRng() * 7)] : '');
    $('#seed').value = seed;
    saveAddress();
    syncControls();
    document.body.classList.add('loading');
    setTimeout(function () {
      state.F = PG.fields(seed);
      update();
      document.body.classList.remove('loading');
    }, 30);
  }

  function randomSeed() {
    var a = ['astre', 'brume', 'corail', 'dune', 'ecume', 'forge', 'givre', 'halo', 'iris', 'jade', 'lune', 'mousse', 'nacre', 'onde', 'pollen', 'quartz', 'roc', 'sable', 'tourbe', 'volcan'];
    return a[Math.floor(Math.random() * a.length)] + '-' + Math.floor(Math.random() * 9000 + 1000);
  }

  // ---------- Événements ----------
  var pending = false;
  function onControl() {
    var p = state.prm;
    p.star = $('#cStar').value; p.S = +$('#cS').value; p.water = +$('#cWater').value; p.P = +$('#cP').value; p.R = +$('#cR').value; p.tilt = +$('#cTilt').value;
    outputs();
    saveAddress();
    if (pending || !state.F) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; update(); });
  }
  ['#cStar', '#cS', '#cWater', '#cP', '#cR', '#cTilt'].forEach(function (id) { $(id).addEventListener('input', onControl); });

  $('#newBtn').addEventListener('click', function () { load(randomSeed()); });
  $('#seedForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('#seed').value.trim();
    if (v) load(v);
  });
  $('#pause').addEventListener('click', function () {
    state.paused = !state.paused;
    this.setAttribute('aria-pressed', state.paused);
    this.textContent = state.paused ? 'Reprendre' : 'Pause';
  });
  document.querySelectorAll('.mode').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.mode = btn.dataset.mode;
      document.querySelectorAll('.mode').forEach(function (m) { m.setAttribute('aria-pressed', m === btn); });
      if (state.pl) renderMap();
    });
  });

  // Sonde de la carte
  $('#map').addEventListener('pointermove', function (e) {
    var pl = state.pl;
    if (!pl) return;
    var r = this.getBoundingClientRect();
    var i = PG.clamp(Math.floor((e.clientX - r.left) / r.width * W), 0, W - 1), j = PG.clamp(Math.floor((e.clientY - r.top) / r.height * H), 0, H - 1);
    var k = j * W + i, a = pl.alt[k], lat = pl.F.lat[j] * 180 / Math.PI;
    $('#probe').textContent = PG.BIOMES[pl.biome[k]].name + ' · ' + fr(pl.T[k], 0) + ' °C · ' +
      (a < 0 ? 'profondeur ' + fr(-a * 1000, 0) + ' m' : 'altitude ' + fr(a * 1000, 0) + ' m · humidité ' + fr(pl.M[k] * 100, 0) + ' %') +
      ' · latitude ' + fr(Math.abs(lat), 0) + '° ' + (lat >= 0 ? 'N' : 'S');
  });

  // Rotation du globe à la souris ou au doigt
  var drag = null, canvas = $('#globe');
  canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, shift: state.shift }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', function (e) {
    if (drag) state.shift = drag.shift - (e.clientX - drag.x) / canvas.getBoundingClientRect().width * W * 0.5;
  });
  canvas.addEventListener('pointerup', function () { drag = null; });
  canvas.addEventListener('pointercancel', function () { drag = null; });

  // ---------- Animation ----------
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!state.paused && !drag) state.shift += dt * 16;
    if (state.pl) globe.draw(state.pl, texture(state.mode), state.shift, state.mode === 'natural');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  var parts = location.hash.slice(1).split(';'), initial = '';
  try { initial = decodeURIComponent(parts[0]); } catch (e) { /* adresse illisible : nouvelle graine */ }
  load(initial || randomSeed(), parts.slice(1));

  window.__atlas = { state: state, load: load };
})();
