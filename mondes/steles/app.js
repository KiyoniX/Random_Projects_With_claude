// Chapitre « Les stèles » : fouiller les cités, lire l'écriture, retrouver le sens des mots, reconstituer la chronique.
(function () {
  'use strict';

  var PG = window.PG, Lang = window.Lang, Hist = window.Hist, Steles = window.Steles, Guide = window.Guide, W = PG.W, H = PG.H;
  var $ = function (s) { return document.querySelector(s); };
  var esc = Guide.esc, attr = Guide.attr, typo = Guide.typo;
  var lane = function (key) { return Hist.LANES.filter(function (l) { return l.key === (key === 'paix' ? 'guerre' : key); })[0]; };
  var kind = function (e) { return e.type === 'paix' ? 'Paix' : lane(e.type).name; };
  var plural = function (n, one, many) { return n + ' ' + (n > 1 ? many : one); };

  var state = { seed: '', tuned: [], world: null, hist: null, game: null, save: null, known: {}, site: null, pick: null, sign: null, note: null, msg: null, gram: [] };

  // Deux encres seulement : les familles d'événements portent les mêmes signes qu'au chapitre 2
  var COLL = Guide.COLL, NOIR = '#000';
  function signe(type) {
    var x = 8, y = 8, r = 5.4, s;
    if (type === 'cite') s = '<rect x="' + (x - r * 0.85) + '" y="' + (y - r * 0.85) + '" width="' + r * 1.7 + '" height="' + r * 1.7 + '" fill="' + NOIR + '"/>';
    else if (type === 'guerre') s = '<path d="M' + x + ' ' + (y - r * 1.15) + 'L' + (x + r * 1.1) + ' ' + (y + r * 0.85) + 'H' + (x - r * 1.1) + 'Z" fill="' + COLL + '"/>';
    else if (type === 'paix') s = '<circle cx="' + x + '" cy="' + y + '" r="' + r * 0.85 + '" fill="#fff" stroke="' + COLL + '" stroke-width="2.2"/>';
    else if (type === 'nature') s = '<path d="M' + x + ' ' + (y - r * 1.15) + 'L' + (x + r * 1.15) + ' ' + y + 'L' + x + ' ' + (y + r * 1.15) + 'L' + (x - r * 1.15) + ' ' + y + 'Z" fill="#fff" stroke="' + NOIR + '" stroke-width="1.8"/>';
    else if (type === 'savoir') s = '<circle cx="' + x + '" cy="' + y + '" r="' + r * 0.95 + '" fill="' + NOIR + '"/>';
    else { var u = r / 5; s = '<path d="M' + (x - 5.5 * u) + ' ' + (y + 4.4 * u) + 'V' + (y - 3.6 * u) + 'l' + 2.75 * u + ' ' + 3.4 * u + 'L' + x + ' ' + (y - 5 * u) + 'l' + 2.75 * u + ' ' + 4.8 * u + 'l' + 2.75 * u + ' ' + (-3.4 * u) + 'V' + (y + 4.4 * u) + 'Z" fill="' + COLL + '"/>'; }
    return '<svg class="signe" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' + s + '</svg>';
  }

  // ---------- Monde : même calcul que les trois autres chapitres ----------
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
      Lang.worldWords(people.lang, { aquatic: people.aquatic, moons: prm.moons, tilt: prm.tilt, tech: people.level, T: people.home.T,
        ice: f(B.SEA_ICE) + f(B.ICE), liquid: pl.liquid, dry: f(B.DESERT) + f(B.ARID), dayH: prm.dayH, star: prm.star, g: pl.g });
    }
    return { seed: seed, pl: pl, prm: prm, life: life, people: people, planet: planet };
  }

  // ---------- Progression ----------
  function address() { return encodeURIComponent(state.seed) + (state.tuned.length ? ';' + state.tuned.join(';') : ''); }
  // Un monde, une sauvegarde : les réglages n'entrent dans la clé que s'ils s'écartent de ceux de la graine.
  // Les anciennes clés reprenaient l'adresse telle quelle, avec ou sans réglages : elles viennent après, pour être relues puis effacées.
  function saveKeys() {
    var p = state.world.prm, o = PG.randomParams(state.seed), seed = 'steles:' + encodeURIComponent(state.seed);
    var full = seed + ';' + [p.star, p.S, p.water, p.P, p.R, p.tilt].join(';');
    return [full === seed + ';' + [o.star, o.S, o.water, o.P, o.R, o.tilt].join(';') ? seed : full, full, 'steles:' + address()];
  }
  function persist() {
    try {
      var keys = saveKeys();
      localStorage.setItem(keys[0], JSON.stringify(state.save));
      keys.forEach(function (k) { if (k !== keys[0]) localStorage.removeItem(k); });
    } catch (e) { /* stockage indisponible : la partie reste en mémoire */ }
  }
  function restore() {
    var best = null, n = function (s) { return Object.keys(s.solved).length; };
    saveKeys().forEach(function (k) {
      // Deux parties pour un même monde : la plus avancée l'emporte
      try { var s = JSON.parse(localStorage.getItem(k)); if (s && s.v === 1 && (!best || n(s) > n(best))) best = s; } catch (e) { /* sauvegarde illisible : nouvelle partie */ }
    });
    return best;
  }
  function fresh() {
    var g = state.game;
    state.save = { v: 1, glyphs: {}, guess: {}, solved: {}, open: {}, names: {}, no: {}, camp: 1, tries: 0 };
    state.save.open[g.capital] = true;
    solve(g.steles[0], true);
  }
  function solve(st, free) {
    var s = state.save;
    s.solved[st.id] = true;
    st.words.forEach(function (x) {
      x.segs.forEach(function (p) { s.glyphs[p] = true; });
      if (x.kind === 'mot') s.guess[x.key] = x.concept;
    });
    if (!free) s.camp++;
  }
  var readable = function (x) { return x.segs.slice(0, x.n).every(function (p) { return state.save.glyphs[p]; }); };
  var reading = function (x) { return x.segs.map(function (p) { return state.save.glyphs[p] ? p : '·'; }).join(''); };
  var siteOf = function (idx) { return state.game.sites.filter(function (x) { return x.idx === idx; })[0]; };
  var doneIn = function (site) { return site.steles.filter(function (id) { return state.save.solved[id]; }).length; };
  var siteName = function (site) { return !site.city.lost || state.known['nom:' + site.city.name] ? site.city.name : 'Ruines sans nom'; };
  // Numéro de renvoi : celui de la carte générale ; les ruines prennent les numéros qu'elle laisse libres
  var numOf = function (site) { return site.idx + 1; };
  var figOf = function (st) { var site = siteOf(st.site); return numOf(site) + '.' + (site.steles.indexOf(st.id) + 1); };

  var GLOSS = { PL: 'pluriel', 'DÉF': 'le, la', ACC: 'objet', 'PASSÉ': 'passé', FUT: 'futur', 'NÉG': 'ne… pas', 'IMPÉR': 'ordre', '1SG': 'je', '2SG': 'tu', '3SG': 'il', '1PL': 'nous', '2PL': 'vous', '3PL': 'ils' };
  var pretty = function (g) {
    return g.split(/[-~]/).map(function (p) { return /\.POSS$/.test(p) ? 'à ' + GLOSS[p.slice(0, 3)] : GLOSS[p] || p; }).join(' + ');
  };

  // Ce qui s'écrit sous un mot : sens établi, hypothèse, ou rien
  function sense(st, x) {
    var s = state.save, done = s.solved[st.id], sure = done || state.known[x.key];
    if (x.kind === 'nom' && (sure || s.names[x.name])) return { c: 'sure', t: x.name };
    if (x.kind === 'mot' && sure) return { c: 'sure', t: done ? pretty(x.gloss) : x.concept };
    if (x.kind === 'outil' && sure) return { c: 'tool', t: pretty(x.gloss) };
    return s.guess[x.key] ? { c: 'guess', t: s.guess[x.key] + ' ?' } : { c: '', t: '' };
  }

  // ---------- Écriture ----------
  function sign(p, size) {
    return '<svg viewBox="0 0 21 31" width="' + Math.round(size * 21 / 31) + '" height="' + size + '" aria-hidden="true">' + state.world.people.lang.glyph(p) + '</svg>';
  }

  // ---------- Carte et sites ----------
  var SONDE = 'Survolez un site pour savoir où en sont ses fouilles ; un clic vous y mène.';
  var carte = new Guide.Carte($('#map'), {
    W: W, H: H, outils: $('#mapOutils'), dessus: drawMap,
    survol: function (fi, fj, x, y) {
      var site = siteAt(x, y), s = state.save;
      $('#map').style.cursor = site ? 'pointer' : '';
      if (!state.game) return;
      $('#mapSonde').textContent = typo(!site ? SONDE : 'Nº ' + numOf(site) + ', ' + siteName(site) + ' : ' + (s.open[site.idx] ? doneIn(site) + ' sur ' + plural(site.steles.length, 'stèle traduite', 'stèles traduites') + '.'
        : s.camp ? 'site à fouiller, une campagne suffit pour l\'ouvrir.' : 'site à fouiller, mais il vous manque une campagne.'));
    },
    quitte: function () { if (state.game) $('#mapSonde').textContent = typo(SONDE); },
    clic: function (x, y) { var site = siteAt(x, y); if (site) chooseSite(site.idx); }
  });
  function siteAt(x, y) {
    var found = null, best = 15 * 15;
    if (!state.game) return null;
    state.game.sites.forEach(function (site) {
      var dx = carte.x(site.city.i) - x, dy = carte.y(site.city.j) - y, d = dx * dx + dy * dy;
      if (d < best) { best = d; found = site; }
    });
    return found;
  }
  function drawMap(ctx, m) {
    var g = state.game, s = state.save;
    if (!g || !s) return;
    var w = m.largeur(), names = m.echelle() >= 0.85;
    var draw = function (site) {
      var c = site.city, x = m.x(c.i), y = m.y(c.j), open = s.open[site.idx], full = open && doneIn(site) === site.steles.length, here = state.site === site.idx, r = site.idx === g.capital ? 10 : 8.5;
      if (here) {
        [['#fff', 5], [NOIR, 2]].forEach(function (k) { ctx.beginPath(); ctx.arc(x, y, 17, 0, 6.2832); ctx.strokeStyle = k[0]; ctx.lineWidth = k[1]; ctx.stroke(); });
      }
      if (names || here) Guide.etiquette(ctx, siteName(site), x, y, w, { encre: c.lost ? '#54544e' : NOIR, ecart: here ? 22 : 13 });
      Guide.pastille(ctx, x, y, numOf(site), open ? { r: r, fond: full ? NOIR : COLL } : { r: r, fond: '#fff', encre: NOIR, trait: NOIR, bord: NOIR });
      if (full) {
        // Site entièrement traduit : pastille noire et coche
        var cx = x + r * 0.8, cy = y - r * 0.8;
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = NOIR; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 2.6, cy + 0.2); ctx.lineTo(cx - 0.7, cy + 2.2); ctx.lineTo(cx + 2.7, cy - 2); ctx.lineWidth = 1.6; ctx.stroke();
      }
    };
    g.sites.forEach(function (site) { if (state.site !== site.idx) draw(site); });
    g.sites.forEach(function (site) { if (state.site === site.idx) draw(site); });
  }
  function renderMap() {
    var s = state.save, g = state.game, left = g.steles.length - Object.keys(s.solved).length;
    carte.demande();
    if (!state.mapWarn) $('#mapNote').textContent = typo(g.sites.every(function (x) { return s.open[x.idx]; }) ? (left ? 'Tous les sites sont ouverts : ' + plural(left, 'stèle reste', 'stèles restent') + ' à traduire.' : 'Tous les sites sont fouillés, toutes les stèles sont traduites.')
      : s.camp ? plural(s.camp, 'campagne de fouilles disponible', 'campagnes de fouilles disponibles') + ' : désignez un site à fouiller.' : 'Aucune campagne disponible : traduisez une stèle pour en financer une.');
  }
  function renderSites() {
    var s = state.save;
    $('#sites').innerHTML = state.game.sites.map(function (site) {
      var open = s.open[site.idx], n = site.steles.length, d = doneIn(site), full = open && d === n, here = state.site === site.idx;
      return '<button type="button" class="site' + (open ? '' : ' closed') + (full ? ' full' : '') + (here ? ' on' : '') + '" data-site="' + site.idx + '" aria-pressed="' + here + '">' +
        '<span class="renvoi' + (full ? ' fait' : open ? '' : ' ferme') + '">' + numOf(site) + '</span><b>' + esc(siteName(site)) + '</b><span class="etat">' +
        (open ? d + ' / ' + plural(n, 'stèle', 'stèles') + (full ? ' <i aria-hidden="true">✓</i>' : '') : 'à fouiller') + '</span></button>';
    }).join('');
  }
  function chooseSite(idx) {
    var s = state.save;
    state.mapWarn = false;
    if (!s.open[idx]) {
      if (!s.camp) { state.mapWarn = true; $('#mapNote').textContent = typo('Aucune campagne disponible : traduisez d\'abord une stèle.'); return; }
      s.camp--; s.open[idx] = true;
    }
    state.site = idx; state.pick = null; state.sign = null; state.note = null; state.msg = null;
    refresh();
  }

  // ---------- Relevés ----------
  function renderSteles() {
    var s = state.save, site = siteOf(state.site);
    $('#siteTitle').innerHTML = '<span class="renvoi">' + numOf(site) + '</span>' + esc('Les stèles de ' + siteName(site).replace(/^Ruines/, 'ruines'));
    $('#steles').innerHTML = site.steles.map(function (id) {
      var st = state.game.steles[id], e = st.event, done = s.solved[id];
      var words = st.words.map(function (x, i) {
        var v = sense(st, x), on = !!state.pick && state.pick.s === id && state.pick.i === i;
        return '<button type="button" class="word ' + v.c + (on ? ' on' : '') + '" data-s="' + id + '" data-i="' + i + '" aria-pressed="' + on + '"><span class="glyphs">' +
          x.segs.map(function (p) { return sign(p, 34); }).join('') + '</span><span class="read">' + esc(reading(x)) + '</span><span class="sens">' + esc(v.t) + '</span></button>';
      }).join('');
      return '<figure class="releve' + (done ? ' done' : '') + '"><div class="pierre">' +
        (st.icons.length ? '<p class="relief" title="Reliefs sculptés à côté du texte">' + st.icons.map(function (c) { return '<span>' + Steles.ICONS[c] + '</span>'; }).join('') + '</p>' : '') +
        '<div class="words">' + words + '</div></div>' +
        '<figcaption><p class="legende"><span class="fig">Fig. ' + figOf(st) + '</span>' + signe(e.type) + '<span>' + esc(kind(e)) + (st.bilingual ? ', stèle bilingue' : '') + (done ? ', an ' + e.year : ', non datée') + '.</span>' +
        '<span class="tampon">' + (done ? '<i aria-hidden="true">✓</i> Traduite' : 'À traduire') + '</span></p>' +
        (done ? '<h4>' + esc(e.title) + '</h4><p class="fr">« ' + esc(e.fr) + ' »</p>' + (e.cause ? '<p class="why">' + esc(e.cause) + '.</p>' : '')
          : '<div class="act"><button type="button" class="bouton plein propose" data-s="' + id + '">Proposer cette lecture</button><span class="msg">' + (state.msg && state.msg.id === id ? '<i aria-hidden="true">✕</i> ' + esc(state.msg.text) : '') + '</span></div>') +
        '</figcaption></figure>';
    }).join('');
  }
  function propose(st) {
    var s = state.save, wrong = {}, unread = false;
    st.words.forEach(function (x) {
      var g = s.guess[x.key];
      if (x.kind === 'mot' ? g !== x.concept : g) wrong[x.key] = true;
      if (x.kind === 'nom' && !readable(x)) unread = true;
    });
    var n = Object.keys(wrong).length;
    if (!n && !unread) { solve(st); state.msg = null; state.note = null; return; }
    s.tries++;
    state.msg = { id: st.id, text: (n ? (n > 1 ? n + ' mots n\'ont pas le bon sens' : 'Un mot n\'a pas le bon sens') + (unread ? ', et un nom propre reste illisible.' : '.')
      : 'Les sens tiennent, mais un nom propre reste illisible : déchiffrez ses signes.') };
  }

  // ---------- Le mot à l'étude ----------
  function coche(data, texte, c, o) {
    return '<button type="button" class="coche' + (o.on ? ' on' : o.used ? ' used' : '') + '" ' + data + (o.on !== undefined ? ' aria-pressed="' + !!o.on + '"' : '') + (o.off ? ' disabled' : '') +
      '><span class="boite" aria-hidden="true"></span>' + (c ? '<i>' + c.icon + '</i>' : '') + '<span>' + esc(texte) + '</span></button>';
  }
  function renderPanel() {
    var s = state.save, g = state.game, box = $('#panel');
    box.className = 'etude encadre' + (state.pick ? '' : ' gris vide');
    if (!state.pick) {
      box.innerHTML = '<p class="etiquette">Mode d’emploi</p>' +
        '<p>La stèle bilingue de la capitale donne les premiers signes et les premiers mots.</p>' +
        '<h4>Lire</h4><p>Le nom d’une cité vivante se lit toujours de la même façon : trouvez-le sur une stèle et ses signes vous sont acquis.</p>' +
        '<h4>Comprendre</h4><p>Le type de la stèle, ses reliefs et les mots qui reviennent d’une stèle à l’autre trahissent le sens. Les petits mots de grammaire n’ont pas de sens à recevoir.</p>' +
        '<h4>Fouiller</h4><p>Chaque stèle traduite donne une campagne pour ouvrir un autre site.</p>';
      return;
    }
    var st = g.steles[state.pick.s], x = st.words[state.pick.i], sure = s.solved[st.id] || state.known[x.key] || x.kind === 'nom' && s.names[x.name];
    var seen = g.steles.filter(function (o) { return s.open[o.site] && o.words.some(function (y) { return y.key === x.key; }); }).length;
    var html = '<p class="etiquette">Le mot à l’étude</p><div class="signs">' + x.segs.map(function (p) {
      var on = state.sign === p;
      return '<button type="button" class="sign' + (s.glyphs[p] ? ' known' : '') + (on ? ' on' : '') + '" data-g="' + attr(p) + '" aria-pressed="' + on + '" aria-label="' + (s.glyphs[p] ? 'Signe lu : ' + attr(p) : 'Signe à lire') + '">' + sign(p, 40) + '<span>' + (s.glyphs[p] ? esc(p) : '?') + '</span></button>';
    }).join('') + '</div><p class="ou"><span class="fig">Fig. ' + figOf(st) + '</span>Mot nº ' + (state.pick.i + 1) + ', présent sur ' + plural(seen, 'stèle mise au jour', 'stèles mises au jour') + '.</p>';
    if (state.sign && !s.glyphs[state.sign]) {
      html += '<h4>Quel son note ce signe ?</h4><div class="reglette">' + g.sounds.filter(function (p) { return !s.glyphs[p]; }).map(function (p) {
        return '<button type="button" class="case" data-snd="' + attr(p) + '"' + (s.no['g:' + state.sign + '>' + p] ? ' disabled' : '') + '>' + esc(p) + '</button>';
      }).join('') + '</div>';
    }
    if (sure) {
      html += '<p class="acquis"><i aria-hidden="true">✓</i> ' + esc(x.kind === 'nom' ? 'Nom propre : ' + x.name + (g.names[x.name].ruler ? ', qui a régné de l\'an ' + g.names[x.name].ruler.from + ' à l\'an ' + g.names[x.name].ruler.to : ', une cité')
        : x.kind === 'mot' ? 'Sens établi : ' + x.concept : 'Mot de grammaire : ' + pretty(x.gloss)) + '.</p>';
    } else {
      var cities = g.known.filter(function (n) { return !s.names[n] && !state.known['nom:' + n] && Lang.segment(n).length <= x.segs.length; });
      if (cities.length) {
        html += '<h4>Est-ce le nom d’une cité ?</h4><div class="choix">' + cities.map(function (n) {
          return coche('data-nm="' + attr(n) + '"', n, null, { off: s.no['n:' + x.key + '>' + n] });
        }).join('') + '</div>';
      }
      var used = {};
      Object.keys(s.guess).forEach(function (k) { if (k !== x.key) used[s.guess[k]] = true; });
      [['nom', 'Un nom'], ['verbe', 'Un verbe'], ['adj.', 'Une qualité']].forEach(function (grp) {
        var list = g.concepts.filter(function (c) { return c.pos === grp[0] && !state.known[c.fr]; });
        if (!list.length) return;
        html += '<h4>' + grp[1] + ' ?</h4><div class="choix">' + list.map(function (c) {
          return coche('data-mean="' + attr(c.fr) + '"', c.fr, c, { on: s.guess[x.key] === c.fr, used: used[c.fr] });
        }).join('') + '</div>';
      });
    }
    if (state.note) html += '<p class="avis ' + (state.note.ok ? 'good' : 'fail') + '"><i aria-hidden="true">' + (state.note.ok ? '✓' : '✕') + '</i> ' + esc(state.note.text) + '</p>';
    box.innerHTML = html;
  }

  // ---------- État des fouilles, carnet, grammaire, chronique ----------
  function renderStats() {
    var s = state.save, g = state.game, done = Object.keys(s.solved).length;
    var read = g.sounds.filter(function (p) { return s.glyphs[p]; }).length, found = g.concepts.filter(function (c) { return state.known[c.fr]; }).length;
    $('#stats').innerHTML = [['Stèles traduites', done + ' sur ' + g.steles.length], ['Signes lus', read + ' sur ' + g.sounds.length], ['Mots compris', found + ' sur ' + g.concepts.length],
      [s.camp > 1 ? 'Campagnes en réserve' : 'Campagne en réserve', s.camp], [s.tries > 1 ? 'Erreurs' : 'Erreur', s.tries]].map(function (r) { return '<tr><td>' + r[0] + '</td><td class="n">' + r[1] + '</td></tr>'; }).join('');
    var win = $('#win');
    win.hidden = done < g.steles.length;
    if (!win.hidden) {
      var rank = s.tries <= 3 ? 'déchiffreur de légende' : s.tries <= 10 ? 'épigraphiste' : s.tries <= 25 ? 'fouilleur patient' : 'chercheur obstiné';
      win.innerHTML = '<p class="etiquette">Fouilles achevées</p><h3>La chronique est reconstituée</h3><p>' + esc(g.steles.length + ' stèles traduites, ' + plural(s.tries, 'erreur', 'erreurs') + ' : vous voilà ' + rank + '.') + '</p>' +
        '<a class="bouton" data-ch="histoire" href="../chroniques/index.html#' + address() + '">Comparer avec le chapitre 2, page 33</a>';
    }
  }
  function renderCarnet() {
    var s = state.save;
    $('#carnet').innerHTML = [['nom', 'Noms'], ['verbe', 'Verbes'], ['adj.', 'Qualités']].map(function (grp) {
      return '<div><h3>' + grp[1] + '</h3><ul>' + state.game.concepts.filter(function (c) { return c.pos === grp[0]; }).map(function (c) {
        var sure = state.known[c.fr], hyp = !sure && Object.keys(s.guess).some(function (k) { return s.guess[k] === c.fr; });
        return '<li class="' + (sure ? 'sure' : hyp ? 'guess' : '') + '"><span><i>' + c.icon + '</i>' + esc(c.fr) + '</span><span class="etat">' + (sure ? '<i aria-hidden="true">✓</i> compris' : hyp ? 'hypothèse ?' : '') + '</span></li>';
      }).join('') + '</ul></div>';
    }).join('');
  }
  var GRAM = {
    'Ordre des mots': /./, 'Article défini': /(^| )(le|la|les) |l'/i, 'Temps': /(^| )(a|ont|est|sont|avons) /, 'Accord du verbe': /(^| )(a|ont|est|sont|avons) /,
    'Lieu': / (dans|sur|vers|devant|pour|avec|pendant) /, 'Pluriel': /(^| )(les|des|deux|trois|aux) /i, 'Possession': / (de|du|notre) /, 'Adjectif': / (bon|bonne|grandes|seul|triste|rouge|jaune|blanc)[ .]/,
    'Objet du verbe': / (bâti|brûlé|gardé|prié|cultivé|pris|tué|mangé|brisé|traversé|écrit|gardons|comptons|garde) /, 'Négation': /n'| ne /, 'Nombres': /\d|(^| )(deux|trois) /i
  };
  function renderGrammar() {
    var solved = state.game.steles.filter(function (st) { return state.save.solved[st.id]; });
    $('#grammar').innerHTML = '<tr><th>Trait</th><th>Règle</th><th>Exemple</th></tr>' + state.gram.map(function (row) {
      var open = solved.some(function (st) { return GRAM[row.name].test(st.event.fr); });
      return open ? '<tr><td class="trait">' + esc(row.name) + '</td><td>' + esc(row.rule) + '</td><td class="ex"><span class="indigene">' + esc(row.ex) + '</span><small>' + esc(row.fr) + '</small></td></tr>'
        : '<tr class="locked"><td class="trait">' + esc(row.name) + '</td><td colspan="2">à découvrir sur une stèle</td></tr>';
    }).join('');
  }
  function renderChronicle() {
    var list = state.game.steles.filter(function (st) { return state.save.solved[st.id]; }), left = state.game.steles.length - list.length;
    $('#chronicle').innerHTML = list.map(function (st) {
      var e = st.event;
      return '<div class="entry"><span class="y">' + e.year + '</span>' + signe(e.type) + '<span class="quoi"><b>' + esc(e.title) + '</b><span class="fr">' + esc(e.fr) + '</span></span><span class="fig">Fig. ' + figOf(st) + '</span></div>';
    }).join('') + (left ? '<p class="empty">' + plural(left, 'stèle reste', 'stèles restent') + ' à traduire.</p>' : '');
  }

  function refresh() {
    var k = state.known = {};
    state.game.steles.forEach(function (st) { if (state.save.solved[st.id]) st.words.forEach(function (x) { k[x.key] = true; }); });
    persist();
    renderStats(); renderMap(); renderSites(); renderSteles(); renderPanel(); renderCarnet(); renderGrammar(); renderChronicle();
  }

  // ---------- Chargement ----------
  function load(seed, tuned) {
    state.seed = seed; state.tuned = tuned || []; state.pick = null; state.sign = null; state.note = null; state.msg = null; state.mapWarn = false;
    $('#seed').value = seed;
    try { history.replaceState(null, '', '#' + address()); } catch (e) { /* adresse non modifiable en local sur certains navigateurs */ }
    Guide.adresse(address());
    var w = state.world = worldOf(seed, state.tuned), p = w.people;
    $('#game').hidden = !p; $('#noPeople').hidden = !!p; $('#entree').hidden = !p; $('#margeNote').hidden = !p;
    Guide.destination(w.planet, 'Les stèles');
    carte.entiere();
    if (!p) {
      state.game = null; state.save = null;
      $('#name').textContent = 'Un monde sans stèles. ';
      $('#origin').textContent = typo('Planète ' + w.planet + ', ' + w.pl.verdict.toLowerCase() + '.');
      $('#brief').textContent = '';
      $('#noPeople').innerHTML = '<p class="etiquette">Bon à savoir</p><p>' + esc((w.life.peopleNote || 'Aucun peuple ne vit ici.') + ' Ce cahier reste donc blanc : essayez une autre destination.') + '</p>';
      Guide.sommaire();
      return;
    }
    state.hist = Hist.generate(w);
    var g = state.game = Steles.build(w, state.hist), L = p.lang;
    carte.image(new ImageData(PG.texture(w.pl, 'natural'), W, H), 'rgba(244,244,239,.34)');
    state.gram = Lang.describe(L).filter(function (row) { return GRAM[row.name]; });
    state.save = restore();
    if (!state.save) fresh();
    state.site = g.capital;
    $('#name').textContent = typo('Les stèles des ' + p.name + ', ');
    $('#origin').textContent = typo((p.aquatic ? 'peuple marin' : 'peuple') + ' de la planète ' + w.planet + ' : ' + g.steles.length + ' stèles enfouies sous ' + plural(g.sites.length, 'site', 'sites') + '.');
    $('#brief').textContent = typo('Mille ans d\'histoire dorment sous les cités des ' + p.name + '. Une seule stèle est bilingue : partez d\'elle pour lire leur écriture ' + L.script.name +
      ', retrouver le sens des mots et rendre à ce peuple sa chronique.');
    $('#mapSonde').textContent = typo(SONDE);
    Guide.sommaire();
    refresh();
  }
  function randomSeed() {
    var a = ['astre', 'brume', 'corail', 'dune', 'ecume', 'forge', 'givre', 'halo', 'iris', 'jade', 'lune', 'mousse', 'nacre', 'onde', 'pollen', 'quartz', 'roc', 'sable', 'tourbe', 'volcan'];
    return a[Math.floor(Math.random() * a.length)] + '-' + Math.floor(Math.random() * 9000 + 1000);
  }

  // ---------- Événements ----------
  $('#sites').addEventListener('click', function (e) {
    var b = e.target.closest('.site');
    if (b) chooseSite(+b.dataset.site);
  });
  $('#steles').addEventListener('click', function (e) {
    var w = e.target.closest('.word'), p = e.target.closest('.propose');
    if (w) { state.pick = { s: +w.dataset.s, i: +w.dataset.i }; state.sign = null; state.note = null; refresh(); }
    else if (p) {
      var avant = $('#win').hidden;
      propose(state.game.steles[+p.dataset.s]); refresh();
      // La dernière stèle traduite ramène à l'annonce, qui s'affiche en tête du cahier
      if (avant && !$('#win').hidden) Guide.aller('win');
    }
  });
  $('#panel').addEventListener('click', function (e) {
    var b = e.target.closest('button'), s = state.save;
    if (!b || !state.pick) return;
    var x = state.game.steles[state.pick.s].words[state.pick.i];
    if (b.dataset.g !== undefined) { state.sign = s.glyphs[b.dataset.g] ? null : b.dataset.g; state.note = null; }
    else if (b.dataset.snd !== undefined) {
      if (b.dataset.snd === state.sign) { s.glyphs[state.sign] = true; state.note = { ok: true, text: 'Ce signe se lit bien « ' + state.sign + ' ».' }; state.sign = null; }
      else { s.tries++; s.no['g:' + state.sign + '>' + b.dataset.snd] = 1; state.note = { ok: false, text: 'Avec « ' + b.dataset.snd + ' », les noms connus ne se lisent plus.' }; }
    } else if (b.dataset.nm !== undefined) {
      var name = b.dataset.nm;
      if (x.kind === 'nom' && x.name === name) {
        s.names[name] = true; delete s.guess[x.key];
        x.segs.slice(0, x.n).forEach(function (p) { s.glyphs[p] = true; });
        state.note = { ok: true, text: 'C\'est bien ' + name + ' : ses signes vous sont acquis.' };
      } else { s.tries++; s.no['n:' + x.key + '>' + name] = 1; state.note = { ok: false, text: 'Ce mot n\'est pas ' + name + '.' }; }
    } else if (b.dataset.mean !== undefined) {
      if (s.guess[x.key] === b.dataset.mean) delete s.guess[x.key]; else s.guess[x.key] = b.dataset.mean;
      state.note = null; state.msg = null;
    }
    refresh();
  });
  $('#reset').addEventListener('click', function () {
    if (!state.game || !window.confirm('Effacer l’avancement sur ce monde et reprendre les fouilles au début ?')) return;
    fresh(); state.site = state.game.capital; state.pick = null; state.sign = null; state.note = null; state.msg = null;
    refresh();
  });
  $('#newBtn').addEventListener('click', function () { load(randomSeed()); });
  $('#seedForm').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#seed').value.trim(); if (v) load(v); });

  var parts = location.hash.slice(1).split(';'), initial = '';
  try { initial = decodeURIComponent(parts[0]); } catch (e) { /* adresse illisible : nouvelle graine */ }
  load(initial || randomSeed(), parts.slice(1));

  window.__steles = { state: state, load: load, solve: solve, refresh: refresh, carte: carte };
})();
