// Chapitre « La planète » : fiche pratique, globe, carte générale, milieux naturels, peuple, villes et étapes.
(function () {
  'use strict';

  var PG = window.PG, Guide = window.Guide, W = PG.W, H = PG.H, B = PG.B;
  var $ = function (s) { return document.querySelector(s); };
  var fr = Guide.fr, esc = Guide.esc, attr = Guide.attr, typo = Guide.typo, cap = Guide.cap;
  var calme = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = { seed: '', prm: null, F: null, pl: null, life: null, mode: 'natural', tex: {}, shift: 0, paused: calme, name: '', stamp: 0 };
  var globe = new PG.Globe($('#globe'));

  function texture(mode) {
    if (!state.tex[mode]) state.tex[mode] = PG.texture(state.pl, mode);
    return state.tex[mode];
  }
  function degres(t) { return fr(t, 0).replace('-', '−') + ' °C'; }

  // ---------- Couverture et fiche d'identité ----------
  function renderSheet() {
    var pl = state.pl, prm = pl.prm, ua = fr(pl.au, 2) + ' unité' + (pl.au >= 2 ? 's' : '') + ' astronomique' + (pl.au >= 2 ? 's' : '');
    $('#pName').textContent = typo(state.name);
    $('#pStar').textContent = typo(pl.verdict + ' en orbite autour d\'une ' + pl.star.name + ', à ' + ua + ' de son étoile.');
    $('#pVerdict').textContent = pl.verdict;
    $('#globeLegende').textContent = typo(state.name + ' vue de l\'espace, sous la lumière de sa ' + pl.star.name + '. Faites glisser le globe pour le tourner.');
    var facts = [
      ['Étoile', cap(pl.star.name) + ', ' + fr(pl.star.kelvin, 0) + ' K'],
      ['Distance à l\'étoile', fr(pl.au, 2) + ' UA'],
      ['Rayon', fr(pl.radiusKm, 0) + ' km'],
      ['Gravité', fr(pl.g, 2) + ' g'],
      ['Température moyenne', degres(pl.Tmean)],
      ['Eau liquide', fr(pl.liquid * 100, 0) + ' % de la surface'],
      ['Ébullition de l\'eau', isFinite(pl.boil) ? degres(pl.boil) : 'impossible'],
      ['Jour', prm.dayH + ' h'],
      ['Année', fr(pl.yearDays * 24 / prm.dayH, 0) + ' jours locaux'],
      ['Lunes', String(prm.moons)]
    ];
    $('#facts').innerHTML = facts.map(function (f) { return '<div><dt>' + typo(f[0]) + '</dt><dd>' + f[1] + '</dd></div>'; }).join('');
    Guide.destination(state.name, 'La planète');
  }

  // ---------- Avant de partir ----------
  function renderPractical() {
    var pl = state.pl, prm = pl.prm, g = pl.g, P = prm.P, T = pl.Tmean, tilt = prm.tilt;
    var air = P < 0.05 ? ['irrespirable', 'Pas d\'air à proprement parler : scaphandre du premier au dernier jour.']
      : !pl.alive ? ['à ne pas respirer', 'Rien ne vit ici qui prouve que cet air se respire : gardez le masque.']
      : P <= 0.45 ? ['respirable avec précaution', 'Air ténu, comme en très haute montagne : oxygène d\'appoint conseillé, efforts mesurés.']
      : P >= 2.2 ? ['respirable, mais dense', 'L\'air porte les sons très loin et freine la marche ; les premiers jours sont fatigants.']
      : ['respirable', 'Pression confortable. La faune locale respire sans appareil, vous aussi.'];
    var items = [
      ['poids', 'Pesanteur', fr(g, 2) + ' g', 'Un voyageur de 70 kg en pèse ' + fr(70 * g, 0) + '. ' +
        (g >= 1.35 ? 'Chaque pas coûte : prévoyez des étapes courtes.' : g <= 0.8 ? 'On bondit plus qu\'on ne marche : gare aux plafonds.' : 'Vous ne sentirez guère la différence.')],
      ['air', 'Air', fr(P, 2) + ' bar, ' + air[0], air[1]],
      ['thermo', 'Températures', degres(T) + ' en moyenne', T < -10 ? 'Équipement polaire indispensable hors des régions les plus chaudes.'
        : T < 8 ? 'Climat frais : vêtements chauds en toute saison.' : T < 25 ? 'Climat doux : une laine pour le soir suffit.'
        : T < 55 ? 'Chaleur constante : chapeau, eau, et sieste aux heures chaudes.' : 'Chaleur mortelle : combinaison réfrigérée obligatoire.'],
      ['eau', 'Eau', pl.liquid > 0 ? fr(pl.liquid * 100, 0) + ' % de la surface' : 'aucune eau liquide',
        (pl.liquid > 0.005 ? '' : 'Emportez toute votre eau. ') + (isFinite(pl.boil) ? 'Ici, l\'eau bout à ' + degres(pl.boil) + (pl.boil < 90 ? ' : la cuisson est plus longue.' : pl.boil > 110 ? ' : attention aux brûlures.' : '.') : 'Sans pression, l\'eau ne reste pas liquide.')],
      ['jour', 'Jour et nuit', 'jour de ' + prm.dayH + ' h', prm.dayH >= 40 ? 'Journées interminables : dormez à midi, comme tout ce qui vit ici.'
        : prm.dayH <= 11 ? 'Jours très courts : le sommeil se prend en siestes.' : prm.dayH >= 20 && prm.dayH <= 28 ? 'Presque le rythme terrestre : pas de décalage à craindre.' : 'Comptez quelques jours pour vous y faire.'],
      ['annee', 'Calendrier', 'année de ' + fr(pl.yearDays * 24 / prm.dayH, 0) + ' jours locaux', 'Soit ' + fr(pl.yearDays, 0) + ' jours terrestres pour un tour complet de l\'étoile.'],
      ['saison', 'Meilleure saison', tilt <= 6 ? 'toute l\'année' : tilt >= 28 ? 'les intersaisons' : 'printemps et automne',
        tilt <= 6 ? 'Avec ' + tilt + '° d\'inclinaison, il n\'y a pas de saisons : partez quand vous voulez.'
        : tilt >= 28 ? 'Avec ' + tilt + '° d\'inclinaison, étés et hivers sont extrêmes : évitez-les l\'un et l\'autre.'
        : 'Saisons modérées (' + tilt + '° d\'inclinaison) ; visez celles de l\'hémisphère visité.'],
      ['etoile', 'Lumière', pl.star.name, prm.star === 'M' ? 'Lumière rouge et faible, comme un crépuscule permanent ; abritez-vous lors des éruptions de l\'étoile.'
        : prm.star === 'K' ? 'Lumière orangée, douce pour les yeux.' : prm.star === 'F' ? 'Lumière crue, chargée d\'ultraviolets : lunettes et écran total.' : 'Lumière jaune, familière.'],
      ['lune', 'Nuits', prm.moons === 0 ? 'sans lune' : prm.moons === 1 ? 'une lune' : prm.moons + ' lunes',
        prm.moons === 0 ? 'Nuits d\'un noir complet : lampe indispensable.' : prm.moons === 1 ? 'Une lune éclaire les nuits et règle les marées.' : 'Nuits claires, marées compliquées : renseignez-vous avant de longer une côte.']
    ];
    $('#pratiqueListe').innerHTML = items.map(function (it) {
      return '<li>' + Guide.picto(it[0]) + '<div><h3>' + it[1] + '</h3><p class="valeur">' + esc(cap(it[2])) + '</p><p>' + esc(it[3]) + '</p></div></li>';
    }).join('');
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

  // ---------- Carte générale ----------
  function cityScreen(c) { return { x: carte.x(c.i), y: carte.y(c.j) }; }
  function drawOver(ctx, m) {
    var w = m.largeur(), h = m.hauteur(), k, r, people = state.life && state.life.people;
    // Parallèles et méridiens tous les 30°
    ctx.lineWidth = 1;
    for (k = 1; k < 6; k++) {
      var y = Math.round(m.y(H * k / 6)) + 0.5;
      if (y < 0 || y > h) continue;
      ctx.strokeStyle = k === 3 ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.2)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,.2)';
    for (k = 0; k < 12; k++) {
      var x = Math.round(m.x(W * k / 12)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    if (!people) return;
    // Sur une carte trop petite, les numéros seuls : les noms sont dans « Villes et étapes »
    if (m.echelle() >= 0.85) {
      people.cities.forEach(function (c, n) {
        var p = cityScreen(c);
        Guide.etiquette(ctx, c.name, p.x, p.y, w, { ecart: n === 0 ? 14 : 12 });
      });
    }
    for (r = people.cities.length - 1; r >= 0; r--) {
      var q = cityScreen(people.cities[r]);
      Guide.pastille(ctx, q.x, q.y, r + 1, { r: r === 0 ? 10 : 8.5 });
    }
  }
  function cityAt(x, y) {
    var people = state.life && state.life.people, found = -1, best = 15 * 15;
    if (!people || people.aquatic) return -1;
    people.cities.forEach(function (c, n) {
      var p = cityScreen(c), d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < best) { best = d; found = n; }
    });
    return found;
  }
  var carte = new Guide.Carte($('#map'), {
    W: W, H: H, outils: $('#mapOutils'), dessus: drawOver,
    survol: function (fi, fj, x, y) {
      var pl = state.pl;
      if (!pl) return;
      var i = PG.clamp(Math.floor(fi), 0, W - 1), j = PG.clamp(Math.floor(fj), 0, H - 1);
      var k = j * W + i, a = pl.alt[k], lat = pl.F.lat[j] * 180 / Math.PI, n = cityAt(x, y);
      $('#probe').textContent = typo((n >= 0 ? state.life.people.cities[n].name + ' (un clic ouvre le plan de la ville). ' : '') + PG.BIOMES[pl.biome[k]].name + ', ' + degres(pl.T[k]) + ', ' +
        (a < 0 ? 'profondeur ' + fr(-a * 1000, 0) + ' m' : 'altitude ' + fr(a * 1000, 0) + ' m, humidité ' + fr(pl.M[k] * 100, 0) + ' %') +
        ', par ' + fr(Math.abs(lat), 0) + '° ' + (lat >= 0 ? 'nord' : 'sud') + '.');
      $('#map').style.cursor = n < 0 ? '' : 'pointer';
    },
    clic: function (x, y) {
      var n = cityAt(x, y);
      if (n >= 0) location.href = planLink(state.life.people.cities[n], n);
    }
  });
  function renderMap() { carte.image(new ImageData(texture(state.mode), W, H)); renderKey(); }

  // Échelles des calques (mêmes teintes que les textures de la planète)
  var KEYS = {
    relief: ['Profondeur et altitude', [[8, 22, 66], [60, 130, 190], [70, 130, 70], [150, 175, 95], [205, 190, 120], [150, 110, 80], [120, 105, 100], [245, 245, 250]], ['fonds marins', 'côtes', 'sommets']],
    temp: ['Température', [[40, 20, 110], [50, 90, 200], [130, 200, 235], [235, 245, 230], [140, 205, 110], [245, 215, 80], [235, 120, 50], [170, 30, 40]], ['−70 °C', 'doux', '80 °C']],
    hum: ['Humidité des terres', [[205, 170, 115], [200, 195, 120], [110, 175, 100], [45, 130, 140], [30, 70, 160]], ['sec', '50 %', 'détrempé']]
  };
  function renderKey() {
    var k = KEYS[state.mode];
    $('#legende').innerHTML = k ? '<div class="echelle"><p>' + k[0] + '</p><div class="rampe" style="background:linear-gradient(90deg,' + k[1].map(PG.rgb).join(',') + ')"></div>' +
      '<p class="bornes">' + k[2].map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</p></div>' : '';
    $('#biomes').classList.toggle('sans-teinte', !!k);
  }

  function renderBiomes() {
    var pal = PG.palette(state.pl.star);
    var rows = state.pl.stats.filter(function (s) { return s.frac >= 0.004; }).sort(function (a, b) { return b.frac - a.frac; });
    $('#biomes').innerHTML = rows.map(function (s) {
      return '<li><i style="background:' + PG.rgb(pal[s.id]) + '"></i><span class="nom">' + PG.BIOMES[s.id].name + '</span><span class="barre"><span style="width:' + Math.max(1, s.frac / rows[0].frac * 100) + '%"></span></span><b>' + fr(s.frac * 100, 1) + ' %</b></li>';
    }).join('');
  }

  function renderClimate() {
    var pl = state.pl, F = pl.F, bands = [], j, i, k;
    for (k = 0; k < 6; k++) bands.push({ w: 0, T: 0, lw: 0, M: 0, bio: {} });
    for (j = 0; j < H; j++) {
      var b = bands[Math.min(5, Math.floor(j / (H / 6)))], wj = F.cosLat[j];
      for (i = 0; i < W; i += 2) {
        k = j * W + i;
        b.w += wj; b.T += pl.T[k] * wj;
        if (pl.alt[k] >= 0) { b.lw += wj; b.M += pl.M[k] * wj; }
        b.bio[pl.biome[k]] = (b.bio[pl.biome[k]] || 0) + wj;
      }
    }
    var names = [['Pôle Nord', '60° à 90° N'], ['Nord tempéré', '30° à 60° N'], ['Tropique nord', '0° à 30° N'], ['Tropique sud', '0° à 30° S'], ['Sud tempéré', '30° à 60° S'], ['Pôle Sud', '60° à 90° S']];
    $('#climat').innerHTML = '<tr><th>Zone</th><th>Latitudes</th><th class="n">Temp.</th><th class="n">Humidité</th><th>Milieu dominant</th></tr>' + bands.map(function (b, n) {
      var top = Object.keys(b.bio).sort(function (x, y) { return b.bio[y] - b.bio[x]; })[0];
      return '<tr><td>' + names[n][0] + '</td><td>' + names[n][1] + '</td><td class="n">' + degres(b.T / b.w) + '</td><td class="n">' + (b.lw ? fr(b.M / b.lw * 100, 0) + ' %' : 'sans terres') + '</td><td>' + PG.BIOMES[top].name + '</td></tr>';
    }).join('');
  }

  // ---------- Planches d'espèces ----------
  var fig = 0;
  function tint(id, t) { return PG.rgb(PG.mix(PG.palette(state.pl.star)[id], [246, 246, 241], t)); }
  function plate(traits, id) {
    return '<div class="image" style="--teinte:' + tint(id, 0.74) + ';--sol:' + (traits.kind === 'aquatic' ? tint(id, 0.74) : tint(id, 0.45)) + '">' + PG.drawCreature(traits) + '</div>';
  }
  function adaptations(list) {
    return '<ul class="adaptations">' + list.map(function (a) { return '<li><b>' + esc(a.cause) + '.</b> ' + esc(cap(a.effect)) + '.</li>'; }).join('') + '</ul>';
  }
  function speciesCard(sp, id) {
    var sizeTxt = sp.size >= 1 ? fr(sp.size, 1) + ' m' : fr(sp.size * 100, 0) + ' cm';
    var massTxt = sp.mass >= 1000 ? fr(sp.mass / 1000, 1) + ' t' : sp.mass >= 1 ? fr(sp.mass, 0) + ' kg' : fr(sp.mass * 1000, 0) + ' g';
    fig++;
    return '<figure class="planche espece">' + plate(sp.traits, id) + '<figcaption>' +
      '<p class="nom"><span class="fig">Fig. ' + fig + '</span><b>' + esc(sp.name) + '</b>, ' + esc(sp.role.toLowerCase()) + '</p>' +
      '<dl class="mensurations"><div><dt>Taille</dt><dd>' + sizeTxt + '</dd></div><div><dt>Poids</dt><dd>' + massTxt + '</dd></div><div><dt>Effectif</dt><dd>≈ ' + esc(PG.count(sp.pop, 'individus')) + '</dd></div></dl>' +
      '<p class="moeurs">' + esc(cap(sp.habit)) + '.</p>' + adaptations(sp.adapt) + '</figcaption></figure>';
  }

  function renderLife() {
    var life = state.life, note = $('#lifeNote');
    note.hidden = !life.note;
    note.innerHTML = '<p class="etiquette">Bon à savoir</p><p>' + esc(life.note) + '</p>';
    var pal = PG.palette(state.pl.star);
    fig = 0;
    $('#life').innerHTML = life.groups.map(function (g) {
      var st = g.stat;
      return '<article class="milieu"><div class="notice"><h3><i style="background:' + PG.rgb(pal[st.id]) + '"></i>' + g.biome.name + '</h3>' +
        '<p class="mesures">' + fr(st.frac * 100, 1) + ' % de la planète<br>' + degres(st.T) + ' en moyenne' + (st.id > 2 ? '<br>humidité ' + fr(st.M * 100, 0) + ' %' : '') + '</p>' +
        '<p class="flore"><b>Flore : ' + esc(g.flora.name) + '.</b> ' + esc(cap(g.flora.form)) + (g.flora.notes.length ? ' ; ' + g.flora.notes.map(esc).join(' ; ') : '') + '.</p></div>' +
        g.fauna.map(function (sp) { return speciesCard(sp, st.id); }).join('') + '</article>';
    }).join('');
  }

  // ---------- Le peuple ----------
  var FACT_PICTO = { Habitat: 'maison', Subsistance: 'bol', Calendrier: 'annee', Ciel: 'etoile', Limite: 'attention', Taille: 'taille' };
  function renderPeople() {
    var p = state.life.people, box = $('#people');
    $('#villes').hidden = !p;
    if (!p) {
      box.innerHTML = '<div class="encadre gris"><p class="etiquette">Bon à savoir</p><p>' + esc(state.life.peopleNote) + '</p></div>';
      $('#cities').innerHTML = '';
      return;
    }
    var b = p.body, home = PG.BIOMES[p.home.id].name.toLowerCase();
    var facts = (p.aquatic ? [] : [['Taille', fr(b.size, 2) + ' m']]).concat(p.facts);
    fig++;
    box.innerHTML = '<div class="peuple">' +
      '<figure class="planche portrait">' + plate(b.traits, p.home.id) + '<figcaption><span class="fig">Fig. ' + fig + '</span>Un ' + esc(p.name) + (p.aquatic ? ', habitant des récifs.' : ', ' + fr(b.size, 2) + ' m.') + '</figcaption></figure>' +
      '<div class="peuple-texte"><h3>Les ' + esc(p.name) + '</h3>' +
      '<p class="intro">' + esc((p.aquatic ? 'Peuple marin' : 'Peuple') + ' d\'environ ' + PG.count(p.total, 'individus') + ', parvenu au stade « ' + p.tech.name.toLowerCase() + ' ». Berceau : ' + home + ', ' + degres(p.home.T) + ' en moyenne.') + '</p>' +
      '<ul class="moeurs-peuple">' + facts.map(function (f) { return '<li>' + Guide.picto(FACT_PICTO[f[0]] || 'repere') + '<p><b>' + esc(f[0]) + '.</b> ' + esc(cap(f[1])) + '.</p></li>'; }).join('') + '</ul>' +
      (b.adapt.length ? '<h4>Comment les reconnaître</h4>' + adaptations(b.adapt) : '') +
      '</div></div>' + languageCard(p);
    renderCities(p);
  }

  function languageCard(p) {
    var L = p.lang;
    if (!L || !L.translate) return '';
    var hello = L.translate('Nous sommes les ' + p.name + '.');
    var traits = L.traits.length ? L.traits : [{ cause: 'Sons', effect: L.cons.length + ' consonnes et ' + L.vows.length + ' voyelles ; ordre des mots ' + L.G.order }];
    return '<div class="encadre parler"><div><p class="etiquette">Bon à savoir</p><h3>La langue des ' + esc(p.name) + '</h3>' +
      '<ul class="adaptations">' + traits.map(function (t) { return '<li><b>' + esc(t.cause) + '.</b> ' + esc(cap(t.effect)) + '.</li>'; }).join('') +
      '<li><b>Écriture ' + L.script.name + '.</b> ' + esc(cap(L.script.desc)) + '.</li></ul>' +
      '<p class="renvois">Voir le <a href="../langues-inventees/index.html#' + address() + '">Petit guide de conversation, page 53</a>, <a href="../chroniques/index.html#' + address() + '">Un peu d’histoire, page 33</a>, et <a href="../steles/index.html#' + address() + '">Les stèles, page 79</a>.</p></div>' +
      '<figure class="specimen">' + L.write(hello.text, 40) + '<figcaption><span class="indigene">' + esc(hello.text) + '</span><br>« Nous sommes les ' + esc(p.name) + '. »</figcaption></figure></div>';
  }

  // ---------- Villes et étapes ----------
  // Étoiles : le rang d'abord ; une cité presque aussi peuplée que la première en gagne une, un tout petit lieu n'en a jamais trois
  function stars(r, pop, first) {
    var n = r === 0 ? 3 : r <= 2 ? 2 : 1;
    if (r > 0 && pop >= first * 0.45 && n < 3) n++;
    if (pop < 200 && n > 2) n--;
    return n;
  }
  function renderCities(p) {
    var one = p.tech.word.slice(0, -1), habitat = p.facts[0][1].split(' ; ')[0];
    $('#villesChapo').textContent = typo('Les ' + p.cities.length + ' ' + p.tech.word + ' des ' + p.name + ', par ordre d\'importance. Les numéros renvoient à la carte générale.');
    $('#cities').innerHTML = '<p class="legende-etoiles lineale">' + Guide.etoiles(3) + ' étape majeure <span></span>' + Guide.etoiles(2) + ' halte recommandée <span></span>' + Guide.etoiles(1) + ' si vous passez par là</p>' +
      '<ol class="etapes">' + p.cities.map(function (c, r) {
        var plan = planLink(c, r), n = stars(r, c.pop, p.cities[0].pop);
        return '<li><span class="renvoi">' + (r + 1) + '</span><div><h3>' + (plan ? '<a href="' + attr(plan) + '" title="Voir le plan de la ville">' + esc(c.name) + '</a>' : esc(c.name)) + ' ' + Guide.etoiles(n) + '</h3>' +
          '<p class="situation">' + (r === 0 ? (p.level === 0 ? 'Principal ' + one : 'Capitale') : cap(one)) + ', ' + PG.BIOMES[c.biome].name.toLowerCase() + '. ' + esc(cap(PG.count(c.pop, 'habitants'))) + '.</p>' +
          (r === 0 ? '<p class="a-voir"><b>À voir.</b> ' + esc(cap(habitat)) + '.</p>' : '') +
          (plan ? '<p class="vers-plan">' + Guide.picto('plan') + '<a href="' + attr(plan) + '">Plan de la ville</a></p>' : '') + '</div></li>';
      }).join('') + '</ol>' +
      '<p class="note-ligne">' + (p.aquatic ? 'Les cités marines n’ont pas de plan : elles se visitent à la nage, entre les récifs.' : 'Cliquez sur un nom, ou sur un numéro de la carte, pour ouvrir le plan de la ville.') + '</p>';
  }

  // Plan d'une ville, tracé par le projet « plans-de-ville » : la graine, la taille et la campagne viennent de la planète.
  function planLink(c, r) {
    var p = state.life.people, b = c.biome;
    if (p.aquatic) return '';
    var size = p.level === 0 ? 'bourg' : p.level === 1 ? (r === 0 ? 'ville' : 'bourg') : r === 0 ? 'cite' : r < 3 ? 'ville' : 'bourg';
    var milieu = b === B.ICE || b === B.TUNDRA || b === B.COLD_STEPPE ? 'froid' : b === B.TAIGA || b === B.FOREST || b === B.JUNGLE ? 'foret' : b === B.ARID || b === B.DESERT ? 'aride' : '';
    return '../../plans-de-ville/index.html#' + encodeURIComponent(state.seed + '-' + c.name) + '/' + size + '?' +
      new URLSearchParams({ nom: c.name, peuple: p.name, milieu: milieu, ancienne: p.level >= 3 ? '1' : '0', atlas: address() });
  }

  // ---------- Mise à jour ----------
  function update() {
    state.pl = PG.classify(state.F, state.prm);
    state.life = PG.life(state.pl, state.seed);
    state.tex = {}; state.stamp++;
    // La géométrie du globe ne dépend que de l'inclinaison et de l'atmosphère
    var key = [state.prm.tilt, state.prm.P, state.prm.star, state.pl.haze].join('|');
    if (key !== state.globeKey) { state.globeKey = key; globe.build(state.pl); }
    renderSheet(); renderPractical(); renderMap(); renderBiomes(); renderClimate(); renderLife(); renderPeople();
    Guide.sommaire();
  }

  // L'adresse retient la graine et les réglages : « graine;étoile;ensoleillement;eau;air;taille;inclinaison »
  function address() {
    var p = state.prm;
    return encodeURIComponent(state.seed) + ';' + [p.star, p.S, p.water, p.P, p.R, p.tilt].join(';');
  }
  function saveAddress() {
    try { history.replaceState(null, '', '#' + address()); } catch (e) { /* adresse non modifiable en local sur certains navigateurs */ }
    Guide.adresse(address());
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
    $('#pName').textContent = typo(state.name);
    saveAddress();
    syncControls();
    carte.entiere();
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
  var CONTROLS = { cStar: 'star', cS: 'S', cWater: 'water', cP: 'P', cR: 'R', cTilt: 'tilt' };
  // Seule la réglette touchée change : les autres gardent leur valeur exacte, même hors des crans
  function onControl(e) {
    var key = CONTROLS[e.target.id];
    state.prm[key] = key === 'star' ? e.target.value : +e.target.value;
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
  function pauseLabel() {
    var b = $('#pause');
    b.setAttribute('aria-pressed', state.paused);
    b.textContent = state.paused ? 'Faire tourner' : 'Arrêter la rotation';
  }
  $('#pause').addEventListener('click', function () { state.paused = !state.paused; pauseLabel(); });
  pauseLabel();
  document.querySelectorAll('.mode').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.mode = btn.dataset.mode;
      document.querySelectorAll('.mode').forEach(function (m) { m.setAttribute('aria-pressed', m === btn); });
      if (state.pl) renderMap();
    });
  });

  // Sur petit écran, le baromètre quitte la marge pour se glisser sous le frontispice
  var etroit = window.matchMedia('(max-width: 1020px)');
  function placeBarometer() { (etroit.matches ? $('#baroSlot') : $('.marge')).appendChild($('.barometre')); }
  etroit.addEventListener('change', placeBarometer);
  placeBarometer();

  // Rotation du globe à la souris, au doigt ou aux flèches
  var drag = null, canvas = $('#globe');
  canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, shift: state.shift }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', function (e) {
    if (drag) state.shift = drag.shift - (e.clientX - drag.x) / canvas.getBoundingClientRect().width * W * 0.5;
  });
  canvas.addEventListener('pointerup', function () { drag = null; });
  canvas.addEventListener('pointercancel', function () { drag = null; });
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    state.shift += e.key === 'ArrowLeft' ? -20 : 20;
    e.preventDefault();
  });

  // ---------- Animation ----------
  var last = performance.now(), drawn = '';
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!state.paused && !drag) state.shift += dt * 16;
    if (state.pl) {
      var key = Math.round(state.shift) + '|' + Math.round(state.shift * 1.18) + '|' + state.mode + '|' + state.stamp;
      if (key !== drawn) { drawn = key; globe.draw(state.pl, texture(state.mode), state.shift, state.mode === 'natural'); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  var parts = location.hash.slice(1).split(';'), initial = '';
  try { initial = decodeURIComponent(parts[0]); } catch (e) { /* adresse illisible : nouvelle graine */ }
  load(initial || randomSeed(), parts.slice(1));

  window.__atlas = { state: state, load: load, carte: carte };
})();
