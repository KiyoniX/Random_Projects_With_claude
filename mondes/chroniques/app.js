// Chapitre « Un peu d'histoire » : frise, carte au fil des siècles et dates clés dans la langue du peuple.
(function () {
  'use strict';

  var PG = window.PG, Lang = window.Lang, Hist = window.Hist, Guide = window.Guide, W = PG.W, H = PG.H;
  var $ = function (s) { return document.querySelector(s); };
  var esc = Guide.esc, typo = Guide.typo;
  var lane = function (key) { return Hist.LANES.filter(function (l) { return l.key === (key === 'paix' ? 'guerre' : key); })[0]; };

  var state = { seed: '', tuned: [], world: null, hist: null, year: 1, selected: null, timer: null, stages: {}, pos: {} };

  // Deux encres seulement : les familles d'événements se distinguent par leur signe
  var COLL = Guide.COLL, NOIR = '#000';
  var POL = [{ fond: COLL, encre: '#fff', nom: 'magenta' }, { fond: NOIR, encre: '#fff', nom: 'noir' }, { fond: '#fff', encre: NOIR, trait: NOIR, bord: NOIR, nom: 'blanc' }];
  function sign(type, x, y, r, more) {
    var a = ' ' + (more || '') + '/>';
    if (type === 'cite') return '<rect x="' + (x - r * 0.85) + '" y="' + (y - r * 0.85) + '" width="' + r * 1.7 + '" height="' + r * 1.7 + '" fill="' + NOIR + '" stroke="#fff" stroke-width="1"' + a;
    if (type === 'guerre') return '<path d="M' + x + ' ' + (y - r * 1.15) + 'L' + (x + r * 1.1) + ' ' + (y + r * 0.85) + 'H' + (x - r * 1.1) + 'Z" fill="' + COLL + '" stroke="#fff" stroke-width="1"' + a;
    if (type === 'paix') return '<circle cx="' + x + '" cy="' + y + '" r="' + r * 0.85 + '" fill="#fff" stroke="' + COLL + '" stroke-width="2.2"' + a;
    if (type === 'nature') return '<path d="M' + x + ' ' + (y - r * 1.15) + 'L' + (x + r * 1.15) + ' ' + y + 'L' + x + ' ' + (y + r * 1.15) + 'L' + (x - r * 1.15) + ' ' + y + 'Z" fill="#fff" stroke="' + NOIR + '" stroke-width="1.8"' + a;
    if (type === 'savoir') return '<circle cx="' + x + '" cy="' + y + '" r="' + r * 0.95 + '" fill="' + NOIR + '" stroke="#fff" stroke-width="1"' + a;
    var u = r / 5;
    return '<path d="M' + (x - 5.5 * u) + ' ' + (y + 4.4 * u) + 'V' + (y - 3.6 * u) + 'l' + 2.75 * u + ' ' + 3.4 * u + 'L' + x + ' ' + (y - 5 * u) + 'l' + 2.75 * u + ' ' + 4.8 * u + 'l' + 2.75 * u + ' ' + (-3.4 * u) + 'V' + (y + 4.4 * u) + 'Z" fill="' + COLL + '" stroke="#fff" stroke-width="1"' + a;
  }
  function signSvg(type) { return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' + sign(type, 8, 8, 5.4) + '</svg>'; }
  function kind(e) { return e.type === 'paix' ? 'Paix' : lane(e.type).name; }

  // ---------- Monde : même calcul que les deux autres chapitres ----------
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
      // Mêmes mots manquants que dans le guide de conversation (pas de « lune » sur un monde sans lune, etc.)
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
    var h = state.hist, box = $('#frise'), width = Math.max(760, box.clientWidth), padL = 92, padR = 14;
    var X = function (year) { return padL + (year - 1) / 999 * (width - padL - padR); };
    var laneY = function (i) { return 138 + i * 30; }, height = laneY(Hist.LANES.length) + 2;
    var s = '<svg width="' + width + '" height="' + height + '" role="img" aria-label="Frise de mille ans">';
    h.eras.forEach(function (era, i) {
      var x0 = X(era.from), x1 = X(era.to);
      if (i % 2 === 0) s += '<rect x="' + x0 + '" y="0" width="' + (x1 - x0) + '" height="' + height + '" fill="#e6e6df"/>';
      s += '<line x1="' + x0 + '" y1="0" x2="' + x0 + '" y2="' + height + '" stroke="#000" stroke-width="1"/>';
      if (x1 - x0 > 96) s += '<text class="era-label" x="' + (x0 + 6) + '" y="17">' + esc(era.name) + '</text>';
    });
    // Population
    var max = Math.max.apply(null, h.pop), top = 34, bottom = 100, path = '';
    h.pop.forEach(function (v, d) { path += (d ? 'L' : 'M') + X(Math.max(1, d * 10)).toFixed(1) + ' ' + (bottom - v / max * (bottom - top)).toFixed(1); });
    s += '<path d="' + path + 'L' + X(1000) + ' ' + bottom + 'L' + X(1) + ' ' + bottom + 'Z" fill="#f1d3df"/><path d="' + path + '" fill="none" stroke="' + COLL + '" stroke-width="2"/>';
    s += '<text class="lane-label" x="0" y="' + (top + 36) + '">Population</text>';
    s += '<line x1="' + X(1) + '" y1="' + bottom + '.5" x2="' + X(1000) + '" y2="' + bottom + '.5" stroke="#000"/>';
    for (var y = 0; y <= 1000; y += 100) {
      var gx = X(Math.max(1, y));
      s += '<line x1="' + gx + '" y1="' + bottom + '" x2="' + gx + '" y2="' + (bottom + 5) + '" stroke="#000"/><text class="axis" x="' + gx + '" y="' + (bottom + 17) + '" text-anchor="' + (y === 0 ? 'start' : y === 1000 ? 'end' : 'middle') + '">' + (y || 1) + '</text>';
    }
    Hist.LANES.forEach(function (l, i) {
      s += '<line x1="' + padL + '" y1="' + laneY(i) + '.5" x2="' + (width - padR) + '" y2="' + laneY(i) + '.5" stroke="#54544e" stroke-dasharray="1 3"/>' +
        '<text class="lane-label" x="0" y="' + (laneY(i) + 4) + '">' + esc(l.name.split(' ')[0]) + '</text>';
    });
    s += '<circle id="halo" r="12" fill="none" stroke="#000" stroke-width="2" cx="-40" cy="-40"/>';
    var last = {};
    state.pos = {};
    h.events.forEach(function (e) {
      var li = Hist.LANES.indexOf(lane(e.type)), x = X(e.year), up = last[li] !== undefined && x - last[li].x < 12 ? !last[li].up : false;
      last[li] = { x: x, up: up };
      var cy = laneY(li) + (up ? -9 : 0);
      state.pos[e.id] = { x: x, y: cy };
      s += sign(e.type, +x.toFixed(1), cy, e.major ? 6.6 : 5, 'class="dot" data-id="' + e.id + '"').replace('/>', '><title>An ' + e.year + ', ' + esc(e.title) + '</title>') + '</' + (e.type === 'cite' ? 'rect' : e.type === 'paix' || e.type === 'savoir' ? 'circle' : 'path') + '>';
    });
    s += '<line id="cursor" x1="0" y1="0" x2="0" y2="' + height + '" stroke="#000" stroke-width="1.5"/></svg>';
    box.innerHTML = s;
    state.X = X;
    moveCursor();
  }
  function moveCursor() {
    var c = $('#cursor'), halo = $('#halo'), p = state.selected && state.pos[state.selected.id];
    if (c && state.X) { var x = state.X(state.year); c.setAttribute('x1', x); c.setAttribute('x2', x); }
    if (halo && p) { halo.setAttribute('cx', p.x); halo.setAttribute('cy', p.y); }
  }

  // ---------- Carte ----------
  var carte = new Guide.Carte($('#map'), {
    W: W, H: H, outils: $('#mapOutils'), dessus: drawMap,
    survol: function (fi, fj, x, y) {
      var c = cityAt(x, y), h = state.hist;
      $('#map').style.cursor = c ? 'pointer' : '';
      if (!h) return;
      if (!c) { $('#mapSonde').textContent = typo('Survolez une cité pour savoir quand elle fut fondée ; un clic mène à sa fondation.'); return; }
      var dead = c.destroyed && c.destroyed <= state.year;
      $('#mapSonde').textContent = typo(c.name + ', fondée en l\'an ' + c.founded + (dead ? ', en ruines depuis l\'an ' + c.destroyed + '.' : ' ; ' + h.polName(h.polities[h.ownerAt(c, state.year)], state.year).toLowerCase().replace(/ de .*/, '') + ' de ' + h.polities[h.ownerAt(c, state.year)].seat.name + ' en l\'an ' + state.year + '.'));
    },
    clic: function (x, y) {
      var c = cityAt(x, y);
      if (!c) return;
      var e = state.hist.events.filter(function (v) { return v.title === 'Fondation de ' + c.name; })[0];
      if (e) { stop(); select(e, true); }
    }
  });
  function visible(c) { return c.founded <= state.year; }
  function cityAt(x, y) {
    var found = null, best = 15 * 15;
    if (!state.hist) return null;
    state.hist.cities.forEach(function (c) {
      if (!visible(c)) return;
      var dx = carte.x(c.i) - x, dy = carte.y(c.j) - y, d = dx * dx + dy * dy;
      if (d < best) { best = d; found = c; }
    });
    return found;
  }
  function drawMap(ctx, m) {
    var h = state.hist, year = state.year, w = m.largeur(), s = m.echelle();
    if (!h) return;
    var sel = state.selected, near = sel && Math.abs(sel.year - year) <= 12 ? sel : null;
    var arrow = function (a, b, dash) {
      var dx = b.i - a.i;
      if (Math.abs(dx) > W / 2) dx += dx < 0 ? W : -W;
      [[m.x(a.i), m.y(a.j)], [m.x(b.i) - dx * s, m.y(b.j) - (b.j - a.j) * s]].forEach(function (o, n) {
        if (n === 1 && Math.abs(o[0] - m.x(a.i)) < 1) return;
        var ex = o[0] + dx * s, ey = o[1] + (b.j - a.j) * s, ang = Math.atan2(ey - o[1], ex - o[0]);
        [['#fff', 5], ['#000', 2]].forEach(function (st) {
          ctx.beginPath(); ctx.setLineDash(st[1] === 2 ? dash || [] : []); ctx.moveTo(o[0], o[1]); ctx.lineTo(ex - 6 * Math.cos(ang), ey - 6 * Math.sin(ang));
          ctx.strokeStyle = st[0]; ctx.lineWidth = st[1]; ctx.stroke(); ctx.setLineDash([]);
        });
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 13 * Math.cos(ang - 0.4), ey - 13 * Math.sin(ang - 0.4)); ctx.lineTo(ex - 13 * Math.cos(ang + 0.4), ey - 13 * Math.sin(ang + 0.4)); ctx.closePath();
        ctx.fillStyle = '#000'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      });
    };
    if (near && near.where && near.where.from) arrow(near.where.from, near.where.to, near.type === 'guerre' ? null : [6, 4]);
    var names = s >= 0.85;
    h.cities.forEach(function (c, n) {
      if (!visible(c)) return;
      var x = m.x(c.i), y = m.y(c.j), dead = c.destroyed && c.destroyed <= year;
      if (names || dead && s >= 0.6) Guide.etiquette(ctx, c.name, x, y, w, { encre: dead ? '#54544e' : '#000', ecart: dead ? 9 : 13 });
      if (dead) {
        [['#fff', 5], ['#000', 2]].forEach(function (st) {
          ctx.strokeStyle = st[0]; ctx.lineWidth = st[1]; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x - 4.5, y - 4.5); ctx.lineTo(x + 4.5, y + 4.5); ctx.moveTo(x + 4.5, y - 4.5); ctx.lineTo(x - 4.5, y + 4.5); ctx.stroke();
        });
        ctx.lineCap = 'butt';
      } else {
        var pol = h.polities[h.ownerAt(c, year)], k = POL[pol.id];
        Guide.pastille(ctx, x, y, c.lost ? '' : n + 1, { r: pol.seat === c ? 10 : c.lost ? 6 : 8.5, fond: k.fond, encre: k.encre, trait: k.trait, bord: k.bord });
      }
    });
    if (near && near.where && near.where.at) {
      var a = near.where.at;
      ctx.beginPath(); ctx.arc(m.x(a.i), m.y(a.j), 17, 0, 6.2832); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x(a.i), m.y(a.j), 17, 0, 6.2832); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  function renderMap() {
    var h = state.hist, year = state.year, alive = 0, ruins = 0;
    h.cities.forEach(function (c) {
      if (!visible(c)) return;
      if (c.destroyed && c.destroyed <= year) ruins++; else alive++;
    });
    carte.demande();
    var d = Math.min(100, Math.round(year / 10));
    $('#mapNote').textContent = typo('An ' + year + ', ' + Hist.STAGES[h.levelAt(year)].toLowerCase() + '. Environ ' + PG.count(h.pop[d], 'individus') + ', ' + alive + (alive > 1 ? ' lieux habités' : ' lieu habité') + (ruins ? ', ' + ruins + ' en ruines' : '') + '.');
  }

  // ---------- Notice de l'événement choisi ----------
  function renderDetail() {
    var e = state.selected, L = state.world.people.lang, box = $('#detail');
    if (!e) { box.innerHTML = ''; return; }
    told(e);
    box.innerHTML = '<p class="quand lineale"><span class="etiquette">' + signSvg(e.type) + esc(kind(e)) + '</span><b>An ' + e.year + '</b><span class="indigene">' + esc(L.num(e.year)) + '</span></p>' +
      '<h3>' + esc(e.title) + '</h3><figure class="specimen">' + L.write(e.text, 34) +
      '<figcaption><span class="indigene">' + esc(e.text) + '</span><br>« ' + esc(e.fr) + ' »</figcaption></figure>' +
      (e.modern ? '<p class="modern">Langue de l’époque. Aujourd’hui, on dirait : <span class="indigene">' + esc(e.modern) + '</span></p>' : '') +
      (e.cause ? '<p class="why">' + esc(e.cause) + '.</p>' : '');
  }

  function mark() {
    document.querySelectorAll('.entry').forEach(function (b) { b.classList.toggle('on', !!state.selected && +b.dataset.id === state.selected.id); });
  }
  function select(e, moveYear) {
    state.selected = e;
    if (moveYear) setYear(e.year, true);
    renderDetail(); moveCursor(); renderMap();
    mark();
  }
  function setYear(year, keep) {
    state.year = Math.max(1, Math.min(1000, Math.round(year)));
    $('#year').value = state.year; $('#yearOut').textContent = state.year;
    if (!keep) {
      // L'événement le plus récent devient celui affiché
      var cur = null;
      state.hist.events.forEach(function (e) { if (e.year <= state.year) cur = e; });
      if (cur && cur !== state.selected) { state.selected = cur; renderDetail(); mark(); }
    }
    moveCursor(); renderMap();
  }

  // ---------- Dates clés, souverains, guerres, aujourd'hui ----------
  function renderChronicle() {
    var h = state.hist, L = state.world.people.lang;
    $('#chronicle').innerHTML = h.eras.map(function (era, i) {
      var last = i === h.eras.length - 1;
      var list = h.events.filter(function (e) { return e.year >= era.from && (last ? e.year <= era.to : e.year < era.to); });
      return '<div class="era"><div class="era-head"><h3>' + esc(era.name) + '</h3><span class="indigene">' + esc(L.translate(era.name).text.replace(/\.$/, '')) + '</span><span class="span lineale">an ' + era.from + ' à ' + era.to + '</span></div>' +
        list.map(function (e) {
          told(e);
          return '<button type="button" class="entry" data-id="' + e.id + '"><span class="y">' + e.year + '</span>' + signSvg(e.type) + '<span class="quoi"><b>' + esc(e.title) + '</b><span class="indigene">' + esc(e.text) + '</span><span class="fr">' + esc(e.fr) + '</span></span></button>';
        }).join('') + '</div>';
    }).join('');
  }
  function bullet(pol) {
    var k = POL[pol.id];
    return '<i class="puce" style="background:' + k.fond + '"></i>';
  }
  function renderPowers() {
    var h = state.hist;
    $('#powers').innerHTML = h.polities.map(function (pol) {
      var fate = pol.end ? 'De l\'an ' + pol.founded + ' à l\'an ' + pol.end + ', puis absorbé par ' + h.union.pol.seat.name
        : 'Depuis l\'an ' + pol.founded + (h.union && h.union.pol === pol ? ' ; règne sur tout le peuple depuis l\'an ' + h.union.year : '');
      return '<div class="power encadre' + (pol.id ? ' gris' : '') + '"><h3>' + bullet(pol) + esc(h.polName(pol, pol.end || 1000)) + '</h3><p class="fate">' + esc(fate) + '. Sur la carte, pastilles ' + (pol.id === 0 ? 'magenta' : pol.id === 1 ? 'noires' : 'blanches') + '.</p><ul>' +
        pol.rulers.map(function (r) { return '<li><span>' + esc(r.name) + (r.epithet ? ' <em>' + esc(r.epithet) + '</em>' : '') + '</span><span>' + r.from + ' à ' + r.to + '</span></li>'; }).join('') + '</ul></div>';
    }).join('');
    $('#wars').innerHTML = h.wars.length ? '<h3 class="sous">Les guerres</h3><ol class="guerres">' + h.wars.map(function (war) {
      var out = war.union ? 'Les vaincus sont absorbés : c\'est l\'union du peuple.' : war.prize ? war.prize.name + ' change de mains.' : 'Les vaincus paient un tribut.';
      return '<li>' + signSvg('guerre') + '<p><b>' + esc(war.name) + '</b><span class="lineale"> an ' + war.from + ' à ' + war.to + '</span><br>' +
        esc(h.polName(war.a, war.from) + ' contre ' + h.polName(war.b, war.from).replace(/^(Royaume|Clan)/, function (c) { return c.toLowerCase(); }) + '. Victoire de ' + war.win.seat.name + '. ' + out + (war.sacked ? ' ' + war.sacked.name + ' est détruite.' : '')) + '</p></li>';
    }).join('') + '</ol>' : '<p class="note-ligne paix-note">Aucune guerre entre royaumes ou clans en mille ans : tout au plus des révoltes et des querelles d’héritiers.</p>';
  }
  function renderToday() {
    var h = state.hist;
    $('#today').innerHTML = '<tr><th></th><th>Lieu</th><th class="n">Fondé en l’an</th><th>Aujourd’hui</th><th>Pouvoir</th></tr>' + h.cities.map(function (c, n) {
      return c.lost ? '<tr class="ruin"><td>✕</td><td class="lieu">' + esc(c.name) + '</td><td class="n">' + c.founded + '</td><td>en ruines depuis l’an ' + c.destroyed + '</td><td></td></tr>'
        : '<tr><td><span class="renvoi">' + (n + 1) + '</span></td><td class="lieu">' + esc(c.name) + '</td><td class="n">' + c.founded + '</td><td>' + esc(PG.count(c.pop, 'habitants')) + '</td><td>' + esc(h.polName(h.polities[h.ownerAt(c, 1000)], 1000)) + '</td></tr>';
    }).join('');
  }

  // ---------- Chargement ----------
  function address() { return encodeURIComponent(state.seed) + (state.tuned.length ? ';' + state.tuned.join(';') : ''); }
  function stop() { if (state.timer) { clearInterval(state.timer); state.timer = null; $('#play').textContent = 'Dérouler les mille ans'; } }
  function load(seed, tuned) {
    stop();
    state.seed = seed; state.tuned = tuned || []; state.stages = {}; state.selected = null;
    $('#seed').value = seed;
    try { history.replaceState(null, '', '#' + address()); } catch (e) { /* adresse non modifiable en local sur certains navigateurs */ }
    Guide.adresse(address());
    var w = state.world = worldOf(seed, state.tuned), p = w.people;
    $('#toAtlas').href = '../atlas-des-mondes/index.html#' + address();
    $('#toLang').href = '../langues-inventees/index.html#' + address();
    $('#story').hidden = !p; $('#noPeople').hidden = !!p; $('#entree').hidden = !p; $('#margeNote').hidden = !p;
    Guide.destination(w.planet, 'Un peu d\'histoire');
    carte.entiere();
    if (!p) {
      state.hist = null;
      $('#name').textContent = 'Un monde sans histoire. ';
      $('#origin').textContent = typo('Planète ' + w.planet + ', ' + w.pl.verdict.toLowerCase() + '.');
      $('#heroScript').innerHTML = ''; $('#synopsis').textContent = '';
      $('#noPeople').innerHTML = '<p class="etiquette">Bon à savoir</p><p>' + esc((w.life.peopleNote || 'Aucun peuple ne vit ici.') + ' Ce chapitre reste donc blanc : essayez une autre destination.') + '</p>';
      Guide.sommaire();
      return;
    }
    var h = state.hist = Hist.generate(w), L = p.lang;
    carte.image(new ImageData(PG.texture(w.pl, 'natural'), W, H), 'rgba(244,244,239,.34)');
    $('#name').textContent = typo('Chronique des ' + p.name + ', ');
    $('#origin').textContent = typo((p.aquatic ? 'peuple marin' : 'peuple') + ' de la planète ' + w.planet + ' : mille ans, soit ' + h.earthYears.toLocaleString('fr-FR') + ' années terrestres.');
    var hero = L.translate('Nous avons raconté notre histoire.').text;
    $('#heroScript').innerHTML = L.write(hero, 40);
    $('#heroRoman').textContent = typo(hero);
    $('#synopsis').textContent = typo(h.synopsis);
    $('#legend').innerHTML = Hist.LANES.map(function (l) {
      return l.key === 'guerre' ? '<li>' + signSvg('guerre') + 'Guerres</li><li>' + signSvg('paix') + 'Paix</li>' : '<li>' + signSvg(l.key) + esc(l.name) + '</li>';
    }).join('') + '<li class="pop"><i></i>Population</li>';
    Guide.sommaire();
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
    if (b) { stop(); select(state.hist.events[+b.dataset.id], true); Guide.aller('carte'); }
  });
  $('#year').addEventListener('input', function () { stop(); setYear(+this.value); });
  $('#play').addEventListener('click', function () {
    if (state.timer) { stop(); return; }
    if (state.year >= 1000) setYear(1);
    this.textContent = 'Arrêter le temps';
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

  window.__chroniques = { state: state, load: load, carte: carte };
})();
