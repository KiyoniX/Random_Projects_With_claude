// Chroniques d'un monde : frise, carte animée et chronique dans la langue du peuple.
(function () {
  'use strict';

  var PG = window.PG, Lang = window.Lang, Hist = window.Hist, W = PG.W, H = PG.H;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var lane = function (key) { return Hist.LANES.filter(function (l) { return l.key === (key === 'paix' ? 'guerre' : key); })[0]; };
  var colorOf = function (e) { return e.type === 'paix' ? '#8fd694' : lane(e.type).color; };

  var state = { seed: '', tuned: [], world: null, hist: null, year: 1, selected: null, timer: null, stages: {}, base: null };

  // ---------- Monde : même calcul que l'Atlas et la Fabrique de langues ----------
  function worldOf(seed, tuned) {
    var prm = PG.randomParams(seed);
    if (tuned.length === 6 && PG.STARS[tuned[0]]) {
      var n = tuned.slice(1).map(Number);
      if (n.every(isFinite)) { prm.star = tuned[0]; prm.S = n[0]; prm.water = n[1]; prm.P = n[2]; prm.R = n[3]; prm.tilt = n[4]; }
    }
    var pl = PG.classify(PG.fields(seed), prm), life = PG.life(pl, seed);
    var nameRng = PG.rng('nom' + seed);
    var planet = PG.langFor(null, seed).word(nameRng, 2, 3) + (nameRng() < 0.5 ? ' ' + ['II', 'III', 'IV', 'V', 'VI', 'b', 'c'][Math.floor(nameRng() * 7)] : '');
    var people = life.people;
    if (people) {
      var f = function (id) { return pl.stats[id].frac; }, B = PG.B;
      // Mêmes mots manquants que dans la Fabrique (pas de « lune » sur un monde sans lune, etc.)
      Lang.worldWords(people.lang, { aquatic: people.aquatic, moons: prm.moons, tilt: prm.tilt, tech: people.level, T: people.home.T,
        ice: f(B.SEA_ICE) + f(B.ICE), liquid: pl.liquid, dry: f(B.DESERT) + f(B.ARID), dayH: prm.dayH, star: prm.star, g: pl.g });
    }
    return { seed: seed, pl: pl, prm: prm, life: life, people: people, planet: planet };
  }

  // Langue de l'époque : plus on remonte, plus elle diffère de celle d'aujourd'hui
  function stageOf(year) {
    var n = year < 250 ? 4 : year < 500 ? 3 : year < 750 ? 2 : year < 900 ? 1 : 0, L = state.world.people.lang;
    if (!n) return L;
    return state.stages[n] || (state.stages[n] = L.derive('archaïque', n));
  }
  function told(e) {
    if (!e.text) {
      var L = state.world.people.lang, old = stageOf(e.year).translate(e.fr).text, now = L.translate(e.fr).text;
      e.text = old; e.modern = old !== now ? now : '';
    }
    return e;
  }

  // ---------- Frise ----------
  function renderFrise() {
    var h = state.hist, box = $('#frise'), width = Math.max(760, box.clientWidth - 2), padL = 118, padR = 16;
    var X = function (year) { return padL + (year - 1) / 999 * (width - padL - padR); };
    var laneY = function (i) { return 132 + i * 30; }, height = laneY(Hist.LANES.length) + 8;
    var s = '<svg width="' + width + '" height="' + height + '" role="img" aria-label="Frise de mille ans">';
    var shades = ['#3a2d1c', '#2a2f3d', '#33261f', '#22332c', '#3a2a36'];
    h.eras.forEach(function (era, i) {
      var x0 = X(era.from), x1 = X(era.to);
      s += '<rect x="' + x0 + '" y="6" width="' + (x1 - x0) + '" height="' + (height - 12) + '" fill="' + shades[i % shades.length] + '" opacity=".55"/>';
      if (x1 - x0 > 90) s += '<text class="era-label" x="' + (x0 + 8) + '" y="24">' + esc(era.name) + '</text>';
    });
    // Population
    var max = Math.max.apply(null, h.pop), top = 38, bottom = 104, path = '';
    h.pop.forEach(function (v, d) { path += (d ? 'L' : 'M') + X(Math.max(1, d * 10)).toFixed(1) + ' ' + (bottom - v / max * (bottom - top)).toFixed(1); });
    s += '<path d="' + path + 'L' + X(1000) + ' ' + bottom + 'L' + X(1) + ' ' + bottom + 'Z" fill="rgba(242,192,120,.18)"/><path d="' + path + '" fill="none" stroke="#f2c078" stroke-width="1.6"/>';
    s += '<text class="lane-label" x="8" y="' + (top + 30) + '">Population</text>';
    for (var y = 0; y <= 1000; y += 100) {
      s += '<line x1="' + X(Math.max(1, y)) + '" y1="110" x2="' + X(Math.max(1, y)) + '" y2="' + (height - 8) + '" stroke="rgba(255,255,255,.06)"/><text class="axis" x="' + X(Math.max(1, y)) + '" y="118" text-anchor="middle">' + (y || 1) + '</text>';
    }
    Hist.LANES.forEach(function (l, i) { s += '<text class="lane-label" x="8" y="' + (laneY(i) + 4) + '">' + esc(l.name.split(' ')[0]) + '</text>'; });
    var last = {};
    h.events.forEach(function (e) {
      var li = Hist.LANES.indexOf(lane(e.type)), x = X(e.year), up = last[li] !== undefined && x - last[li].x < 11 ? !last[li].up : false;
      last[li] = { x: x, up: up };
      s += '<circle class="dot" data-id="' + e.id + '" cx="' + x.toFixed(1) + '" cy="' + (laneY(li) + (up ? -8 : 0)) + '" r="' + (e.major ? 7 : 5) + '" fill="' + colorOf(e) + '"><title>An ' + e.year + ' · ' + esc(e.title) + '</title></circle>';
    });
    s += '<line id="cursor" x1="0" y1="6" x2="0" y2="' + (height - 6) + '" stroke="#fff" stroke-width="1.5" opacity=".8"/></svg>';
    box.innerHTML = s;
    state.X = X;
    moveCursor();
  }
  function moveCursor() {
    var c = $('#cursor');
    if (c) { var x = state.X(state.year); c.setAttribute('x1', x); c.setAttribute('x2', x); }
    document.querySelectorAll('.frise .dot').forEach(function (d) { d.classList.toggle('on', state.selected && +d.dataset.id === state.selected.id); });
  }

  // ---------- Carte ----------
  var mapCtx = $('#map').getContext('2d');
  function renderMap() {
    var h = state.hist, year = state.year;
    mapCtx.putImageData(state.base, 0, 0);
    mapCtx.fillStyle = 'rgba(8,6,4,.28)'; mapCtx.fillRect(0, 0, W, H);
    var sel = state.selected, near = sel && Math.abs(sel.year - year) <= 12 ? sel : null;
    var line = function (a, b, color, dash) {
      var bx = b.i; if (Math.abs(b.i - a.i) > W / 2) bx += b.i < a.i ? W : -W;
      mapCtx.beginPath(); mapCtx.setLineDash(dash || []); mapCtx.moveTo(a.i, a.j); mapCtx.lineTo(bx, b.j);
      mapCtx.strokeStyle = color; mapCtx.lineWidth = 2; mapCtx.stroke(); mapCtx.setLineDash([]);
      var ang = Math.atan2(b.j - a.j, bx - a.i);
      mapCtx.beginPath(); mapCtx.moveTo(bx, b.j); mapCtx.lineTo(bx - 9 * Math.cos(ang - 0.4), b.j - 9 * Math.sin(ang - 0.4)); mapCtx.lineTo(bx - 9 * Math.cos(ang + 0.4), b.j - 9 * Math.sin(ang + 0.4)); mapCtx.closePath();
      mapCtx.fillStyle = color; mapCtx.fill();
    };
    if (near && near.where && near.where.from) line(near.where.from, near.where.to, colorOf(near), near.type === 'guerre' ? null : [6, 4]);
    mapCtx.font = '600 11px "Segoe UI", sans-serif'; mapCtx.textBaseline = 'middle';
    var alive = 0, ruins = 0;
    h.cities.forEach(function (c) {
      if (c.founded > year) return;
      var dead = c.destroyed && c.destroyed <= year;
      if (dead) {
        ruins++;
        mapCtx.strokeStyle = 'rgba(255,255,255,.55)'; mapCtx.lineWidth = 1.5;
        mapCtx.beginPath(); mapCtx.moveTo(c.i - 3, c.j - 3); mapCtx.lineTo(c.i + 3, c.j + 3); mapCtx.moveTo(c.i + 3, c.j - 3); mapCtx.lineTo(c.i - 3, c.j + 3); mapCtx.stroke();
      } else {
        alive++;
        var pol = h.polities[h.ownerAt(c, year)], seat = pol.seat === c;
        mapCtx.beginPath(); mapCtx.arc(c.i, c.j, seat ? 5.5 : 3.8, 0, 6.283);
        mapCtx.fillStyle = pol.color; mapCtx.fill(); mapCtx.lineWidth = 1.5; mapCtx.strokeStyle = '#111'; mapCtx.stroke();
      }
      var tw = mapCtx.measureText(c.name).width, tx = c.i + tw + 12 > W ? c.i - tw - 8 : c.i + 8;
      mapCtx.lineWidth = 3; mapCtx.strokeStyle = 'rgba(0,0,0,.75)'; mapCtx.strokeText(c.name, tx, c.j);
      mapCtx.fillStyle = dead ? 'rgba(255,255,255,.55)' : '#fff'; mapCtx.fillText(c.name, tx, c.j);
    });
    if (near && near.where && near.where.at) {
      var a = near.where.at;
      mapCtx.beginPath(); mapCtx.arc(a.i, a.j, 13, 0, 6.283); mapCtx.strokeStyle = colorOf(near); mapCtx.lineWidth = 2.5; mapCtx.stroke();
    }
    var d = Math.min(100, Math.round(year / 10));
    $('#mapNote').textContent = 'An ' + year + ' · ' + Hist.STAGES[h.levelAt(year)] + ' · ≈ ' + PG.count(h.pop[d], 'individus') + ' · ' + alive + (alive > 1 ? ' lieux habités' : ' lieu habité') + (ruins ? ', ' + ruins + (ruins > 1 ? ' en ruines' : ' en ruines') : '');
  }

  // ---------- Détail ----------
  function renderDetail() {
    var e = state.selected, L = state.world.people.lang, box = $('#detail');
    if (!e) { box.innerHTML = ''; return; }
    told(e);
    var l = lane(e.type);
    box.innerHTML = '<div class="when"><span class="lane" style="background:' + colorOf(e) + '">' + esc(e.type === 'paix' ? 'Paix' : l.name) + '</span>' +
      '<span class="tag">An ' + e.year + '</span><span class="num">' + esc(L.num(e.year)) + '</span></div>' +
      '<h4>' + esc(e.title) + '</h4>' + L.write(e.text, 34) +
      '<p class="roman">' + esc(e.text) + '</p><p class="fr">« ' + esc(e.fr) + ' »</p>' +
      (e.modern ? '<p class="modern">Langue de l\'époque. Aujourd\'hui, on dirait :<br><b>' + esc(e.modern) + '</b></p>' : '') +
      (e.cause ? '<p class="why">' + esc(e.cause) + '</p>' : '');
  }

  function select(e, moveYear) {
    state.selected = e;
    if (moveYear) setYear(e.year, true);
    renderDetail(); moveCursor(); renderMap();
    document.querySelectorAll('.entry').forEach(function (b) { b.classList.toggle('on', +b.dataset.id === e.id); });
  }
  function setYear(year, keep) {
    state.year = Math.max(1, Math.min(1000, Math.round(year)));
    $('#year').value = state.year; $('#yearOut').textContent = state.year;
    if (!keep) {
      // L'événement le plus récent devient celui affiché
      var cur = null;
      state.hist.events.forEach(function (e) { if (e.year <= state.year) cur = e; });
      if (cur && cur !== state.selected) { state.selected = cur; renderDetail(); document.querySelectorAll('.entry').forEach(function (b) { b.classList.toggle('on', +b.dataset.id === cur.id); }); }
    }
    moveCursor(); renderMap();
  }

  // ---------- Chronique, pouvoirs, aujourd'hui ----------
  function renderChronicle() {
    var h = state.hist, L = state.world.people.lang;
    $('#chronicle').innerHTML = h.eras.map(function (era, i) {
      var last = i === h.eras.length - 1;
      var list = h.events.filter(function (e) { return e.year >= era.from && (last ? e.year <= era.to : e.year < era.to); });
      return '<div class="era"><div class="era-head"><h4>' + esc(era.name) + '</h4><span class="native">' + esc(L.translate(era.name).text.replace(/\.$/, '')) + '</span><span class="span">an ' + era.from + ' à ' + era.to + '</span></div>' +
        list.map(function (e) {
          told(e);
          return '<button type="button" class="entry" data-id="' + e.id + '"><span class="y">' + e.year + '</span><span class="d" style="background:' + colorOf(e) + '"></span><span><b>' + esc(e.title) + '</b><span class="nat">' + esc(e.text) + '</span><br><span class="fr">' + esc(e.fr) + '</span></span></button>';
        }).join('') + '</div>';
    }).join('');
  }
  function renderPowers() {
    var h = state.hist;
    $('#powers').innerHTML = h.polities.map(function (pol) {
      var fate = pol.end ? 'De l\'an ' + pol.founded + ' à l\'an ' + pol.end + ', puis absorbé par ' + h.union.pol.seat.name
        : 'Depuis l\'an ' + pol.founded + (h.union && h.union.pol === pol ? ' ; règne sur tout le peuple depuis l\'an ' + h.union.year : '');
      return '<div class="power" style="--c:' + pol.color + '"><h4>' + esc(h.polName(pol, pol.end || 1000)) + '</h4><p class="fate">' + esc(fate) + '</p><ul>' +
        pol.rulers.map(function (r) { return '<li><span>' + esc(r.name) + (r.epithet ? ' <em>' + esc(r.epithet) + '</em>' : '') + '</span><span>' + r.from + '–' + r.to + '</span></li>'; }).join('') + '</ul></div>';
    }).join('');
  }
  function renderToday() {
    var h = state.hist;
    $('#today').innerHTML = '<tr><th>Lieu</th><th>Fondé en l\'an</th><th>Aujourd\'hui</th><th>Pouvoir</th></tr>' + h.cities.map(function (c) {
      return c.lost ? '<tr><td class="ruin">' + esc(c.name) + '</td><td>' + c.founded + '</td><td class="ruin">en ruines depuis l\'an ' + c.destroyed + '</td><td></td></tr>'
        : '<tr><td>' + esc(c.name) + '</td><td>' + c.founded + '</td><td>' + PG.count(c.pop, 'habitants') + '</td><td>' + esc(h.polName(h.polities[h.ownerAt(c, 1000)], 1000)) + '</td></tr>';
    }).join('');
  }

  // ---------- Chargement ----------
  function address() { return encodeURIComponent(state.seed) + (state.tuned.length ? ';' + state.tuned.join(';') : ''); }
  function stop() { if (state.timer) { clearInterval(state.timer); state.timer = null; $('#play').textContent = '▶ Dérouler'; } }
  function load(seed, tuned) {
    stop();
    state.seed = seed; state.tuned = tuned || []; state.stages = {}; state.selected = null;
    $('#seed').value = seed;
    try { history.replaceState(null, '', '#' + address()); } catch (e) { /* adresse non modifiable en local sur certains navigateurs */ }
    var w = state.world = worldOf(seed, state.tuned), p = w.people;
    $('#toAtlas').href = '../atlas-des-mondes/index.html#' + address();
    $('#toLang').href = '../langues-inventees/index.html#' + address();
    $('#story').hidden = !p; $('#noPeople').hidden = !!p; $('#toLang').hidden = !p;
    if (!p) {
      state.hist = null;
      $('#origin').textContent = 'Planète ' + w.planet + ' · ' + w.pl.verdict.toLowerCase();
      $('#name').textContent = 'Un monde sans histoire';
      $('#heroScript').innerHTML = ''; $('#synopsis').textContent = '';
      $('#noPeople').textContent = (w.life.peopleNote || 'Aucun peuple ne vit ici.') + ' Essayez un autre monde.';
      return;
    }
    var h = state.hist = Hist.generate(w), L = p.lang;
    state.base = new ImageData(PG.texture(w.pl, 'natural'), W, H);
    $('#origin').textContent = (p.aquatic ? 'Peuple marin' : 'Peuple') + ' de la planète ' + w.planet + ' · mille ans, soit ' + h.earthYears.toLocaleString('fr-FR') + ' années terrestres';
    $('#name').textContent = 'Chronique des ' + p.name;
    $('#heroScript').innerHTML = L.write(L.translate('Nous avons raconté notre histoire.').text, 40);
    $('#synopsis').textContent = h.synopsis;
    $('#legend').innerHTML = Hist.LANES.map(function (l) { return '<li><i style="background:' + l.color + '"></i>' + esc(l.name) + '</li>'; }).join('') + '<li><i style="background:#8fd694"></i>Paix</li>';
    renderFrise(); renderChronicle(); renderPowers(); renderToday();
    state.year = 1;
    select(h.events[0], true);
  }
  function randomSeed() {
    var a = ['astre', 'brume', 'corail', 'dune', 'ecume', 'forge', 'givre', 'halo', 'iris', 'jade', 'lune', 'mousse', 'nacre', 'onde', 'pollen', 'quartz', 'roc', 'sable', 'tourbe', 'volcan'];
    return a[Math.floor(Math.random() * a.length)] + '-' + Math.floor(Math.random() * 9000 + 1000);
  }

  // ---------- Événements ----------
  $('#frise').addEventListener('click', function (e) {
    if (!state.hist) return;
    var dot = e.target.closest('.dot');
    if (dot) { stop(); select(state.hist.events[+dot.dataset.id], true); return; }
    var svg = this.querySelector('svg'), r = svg.getBoundingClientRect(), x = e.clientX - r.left;
    var x0 = state.X(1), x1 = state.X(1000);
    if (x >= x0 - 4) { stop(); setYear(1 + (x - x0) / (x1 - x0) * 999); }
  });
  $('#chronicle').addEventListener('click', function (e) {
    var b = e.target.closest('.entry');
    if (b) { stop(); select(state.hist.events[+b.dataset.id], true); $('#frise').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  $('#year').addEventListener('input', function () { stop(); setYear(+this.value); });
  $('#play').addEventListener('click', function () {
    if (state.timer) { stop(); return; }
    if (state.year >= 1000) setYear(1);
    this.textContent = '⏸ Pause';
    state.timer = setInterval(function () {
      if (state.year >= 1000) { stop(); return; }
      setYear(state.year + 3);
    }, 50);
  });
  $('#newBtn').addEventListener('click', function () { load(randomSeed()); });
  $('#seedForm').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#seed').value.trim(); if (v) load(v); });
  var resize = null;
  window.addEventListener('resize', function () { clearTimeout(resize); resize = setTimeout(function () { if (state.hist) renderFrise(); }, 150); });

  var parts = location.hash.slice(1).split(';'), initial = '';
  try { initial = decodeURIComponent(parts[0]); } catch (e) { /* adresse illisible : nouvelle graine */ }
  load(initial || randomSeed(), parts.slice(1));

  window.__chroniques = { state: state, load: load };
})();
