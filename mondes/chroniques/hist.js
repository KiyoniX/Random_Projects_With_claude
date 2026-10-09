// Mille ans d'histoire pour le peuple d'une planète de l'Atlas des mondes.
// Tout est déduit de la graine : la fin de l'histoire correspond à l'état décrit par l'Atlas (cités, population, stade).
(function () {
  'use strict';

  var Hist = window.Hist = {};
  Hist.STAGES = ['Chasseurs-cueilleurs', 'Villages agricoles', 'Cités-États', 'Âge industriel', 'Ère spatiale'];
  Hist.LANES = [
    { key: 'cite', name: 'Cités et migrations', color: '#f2c078' },
    { key: 'guerre', name: 'Guerres et paix', color: '#ef6f6c' },
    { key: 'nature', name: 'Nature et ciel', color: '#6fb7ef' },
    { key: 'savoir', name: 'Savoirs et croyances', color: '#c9b6ff' },
    { key: 'souverain', name: 'Souverains', color: '#e9ecf5' }
  ];
  var POL_COLORS = ['#f2c078', '#7fd1c8', '#e58fb1'];

  Hist.generate = function (w) {
    var PG = window.PG, B = PG.B, W = PG.W, H = PG.H;
    var p = w.people, L = p.lang, prm = w.prm, pl = w.pl, level = p.level, aquatic = p.aquatic;
    var rng = PG.rng('histoire' + w.seed);
    var R = function (a, b) { return a + Math.floor(rng() * (b - a + 1)); };
    var pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    var f = function (id) { return pl.stats[id].frac; };
    var cold = p.home.T < 5 || f(B.SEA_ICE) + f(B.ICE) > 0.2;
    var dry = f(B.DESERT) + f(B.ARID) > 0.12;
    var sea = pl.liquid > 0.45 || aquatic;
    var mount = f(B.MOUNTAIN) > 0.02 && !aquatic;
    var events = [];
    var ev = function (o) { events.push(o); return o; };

    // ---------- Progrès technique ----------
    var start = Math.max(0, level - (level >= 2 ? 2 : level));
    var steps = [];
    for (var k = start + 1; k <= level; k++) {
      steps.push({ to: k, year: Math.round(1000 * (k - start) / (level - start + 1)) + R(-55, 55) });
    }
    var levelAt = function (year) {
      var l = start;
      steps.forEach(function (s) { if (year >= s.year) l = s.to; });
      return l;
    };
    var place = function (year) { return levelAt(year) >= 2 ? 'ville' : 'village'; };
    var title = function (year, female) { return levelAt(year) >= 2 ? (female ? 'reine' : 'roi') : 'chef'; };

    // ---------- Cités ----------
    var dist = function (a, b) { var dx = Math.abs(a.i - b.i); dx = Math.min(dx, W - dx); return Math.sqrt(dx * dx + (a.j - b.j) * (a.j - b.j)); };
    var n = p.cities.length, years = [1];
    for (var r = 1; r < n; r++) years.push(Math.max(30, Math.min(900, Math.round(60 + (r / n) * 700 + R(-40, 40)))));
    years.sort(function (a, b) { return a - b; });
    var cities = p.cities.map(function (c, r) {
      return { name: c.name, i: c.i, j: c.j, pop: c.pop, biome: c.biome, founded: years[r], destroyed: null, owners: [], lost: false };
    });
    var okBiome = function (b) { return aquatic ? b === B.SHALLOW : b >= 4 && !PG.BIOMES[b].dead; };
    var lostCount = R(1, 2);
    for (var q = 0; q < lostCount; q++) {
      for (var tries = 0; tries < 40; tries++) {
        var base = pick(cities), a = rng() * 6.283, d = 28 + rng() * 45;
        var ci = ((Math.round(base.i + Math.cos(a) * d) % W) + W) % W, cj = Math.round(base.j + Math.sin(a) * d * 0.7);
        if (cj < 8 || cj >= H - 8 || !okBiome(pl.biome[cj * W + ci])) continue;
        var cand = { name: L.word(rng, 2, 3), i: ci, j: cj, pop: 0, biome: pl.biome[cj * W + ci], founded: R(25, 480), destroyed: 0, owners: [], lost: true };
        if (cities.some(function (c) { return dist(c, cand) < 18; })) continue;
        cities.push(cand);
        break;
      }
    }
    var lost = cities.filter(function (c) { return c.lost; });

    // ---------- Royaumes et clans ----------
    var kPol = n <= 2 ? 1 : rng() < 0.25 ? 1 : (n >= 5 && rng() < 0.5 ? 3 : 2);
    var polities = [];
    for (var s = 0; s < kPol; s++) {
      polities.push({ id: s, seat: cities[s], founded: cities[s].founded, end: null, color: POL_COLORS[s], rulers: [], ancestor: L.word(rng, 2, 3) });
    }
    var polName = function (pol, year) { return (levelAt(year) >= 2 ? 'Royaume de ' : 'Clan de ') + pol.seat.name; };
    cities.forEach(function (c) {
      var best = null;
      polities.forEach(function (pol) {
        if (pol.founded <= c.founded && (!best || dist(c, pol.seat) < dist(c, best.seat))) best = pol;
      });
      c.owners.push({ year: c.founded, pol: (best || polities[0]).id });
      // Cité mère : la plus proche parmi les plus anciennes
      c.mother = null;
      cities.forEach(function (o) { if (o !== c && o.founded < c.founded && (!c.mother || dist(c, o) < dist(c, c.mother))) c.mother = o; });
    });
    var ownerAt = function (c, year) {
      var o = c.owners[0].pol;
      c.owners.forEach(function (x) { if (x.year <= year) o = x.pol; });
      return o;
    };
    var count = function (pol, year) { return cities.filter(function (c) { return c.founded <= year && (!c.destroyed || c.destroyed > year) && ownerAt(c, year) === pol.id; }).length; };

    // ---------- Guerres ----------
    var wars = [], union = null;
    var firstWar = Math.max.apply(null, polities.map(function (x) { return x.founded; })) + 40;
    if (kPol >= 2 && firstWar < 900) {
      var nW = level >= 1 ? R(2, 4) : R(1, 2), unify = rng() < 0.5, wy = [];
      for (var t0 = 0; t0 < 60 && wy.length < nW; t0++) {
        var y0 = R(firstWar, 940);
        if (y0 < 960 && wy.every(function (y) { return Math.abs(y - y0) > 70; })) wy.push(y0);
      }
      wy.sort(function (a, b) { return a - b; });
      wy.forEach(function (y, idx) {
        var alive = polities.filter(function (x) { return x.end === null; });
        if (alive.length < 2) return;
        var A = pick(alive), Bp = pick(alive.filter(function (x) { return x !== A; }));
        var dur = Math.min(R(2, 14), 990 - y), last = idx === wy.length - 1;
        var strong = count(A, y) + rng() * 1.5 >= count(Bp, y) + rng() * 1.5, win = strong ? A : Bp, lose = strong ? Bp : A;
        var prize = cities.filter(function (c) { return !c.lost && c !== lose.seat && c.founded < y && ownerAt(c, y) === lose.id; })[0];
        var sacked = lost.filter(function (c) { return !c.destroyed && c.founded < y - 20; })[0];
        var names = ['du Sel', 'des Deux ' + (levelAt(y) >= 2 ? 'Rois' : 'Chefs'), 'des Frontières', 'de ' + (prize || lose.seat).name];
        if (dry) names.push('des Puits', 'du Sable');
        if (sea) names.push('des Marées', 'des Pêcheries');
        if (cold) names.push('des Trois Hivers', 'des Pâturages d\'hiver');
        var war = { name: 'La Guerre ' + pick(names), from: y, to: y + dur, a: A, b: Bp, win: win, lose: lose, prize: prize, sacked: sacked, union: false };
        wars.push(war);
        ev({ year: y, type: 'guerre', title: war.name, fr: 'Les guerriers de ' + A.seat.name + ' ont marché vers ' + Bp.seat.name + '.', where: { from: A.seat, to: Bp.seat }, war: war,
          cause: polName(A, y) + ' contre ' + polName(Bp, y) });
        var field = sacked || prize || lose.seat;
        ev({ year: y + Math.max(1, Math.floor(dur / 2)), type: 'guerre', title: 'Bataille de ' + field.name, fr: pick(['Beaucoup de guerriers sont morts devant ' + field.name + '.', 'Le sang est tombé sur la terre de ' + field.name + '.']), where: { at: field }, shock: 0.06 });
        if (sacked) {
          sacked.destroyed = y + dur;
          ev({ year: y + dur, type: 'guerre', title: 'Chute de ' + sacked.name, fr: aquatic ? 'Les guerriers ont brisé les maisons de ' + sacked.name + '.' : 'Les guerriers ont brûlé ' + sacked.name + '.', where: { at: sacked }, cause: 'La cité ne sera jamais rebâtie' });
        }
        if (last && unify) {
          war.union = true; union = { year: y + dur, pol: win };
          polities.forEach(function (x) {
            if (x !== win && x.end === null) {
              x.end = y + dur;
              cities.forEach(function (c) { if (ownerAt(c, y + dur) === x.id) c.owners.push({ year: y + dur, pol: win.id }); });
            }
          });
          ev({ year: y + dur, type: 'paix', title: 'L\'Union des ' + p.name, fr: 'Un seul ' + title(y + dur, false) + ' garde les ' + place(y + dur) + 's.', where: { at: win.seat }, cause: win.seat.name + ' devient la capitale de tous' });
        } else {
          if (prize) prize.owners.push({ year: y + dur, pol: win.id });
          ev({ year: y + dur, type: 'paix', title: 'Paix de ' + (prize || win.seat).name, fr: 'Les deux ' + title(y + dur, false) + 's ont fait la paix.', where: { at: prize || win.seat },
            cause: prize ? prize.name + ' passe au ' + polName(win, y + dur).toLowerCase().replace(/ de .*/, '') + ' de ' + win.seat.name : polName(lose, y + dur) + ' paie un tribut' });
        }
      });
    } else {
      var nC = R(1, 2);
      for (var c0 = 0; c0 < nC; c0++) {
        var yc = R(120, 930), rebel = cities.filter(function (c) { return !c.lost && c.founded < yc && c !== cities[0]; })[0];
        if (rebel && rng() < 0.6) ev({ year: yc, type: 'guerre', title: 'Révolte de ' + rebel.name, fr: 'Le peuple de ' + rebel.name + ' a brisé la porte du ' + title(yc, false) + '.', where: { at: rebel }, shock: 0.04 });
        else ev({ year: yc, type: 'guerre', title: 'La Querelle des héritiers', fr: 'Deux frères ont voulu la maison du ' + title(yc, false) + '.', where: { at: cities[0] }, shock: 0.03 });
      }
    }

    // ---------- Souverains ----------
    polities.forEach(function (pol) {
      var t = pol.founded, end = pol.end || 1000;
      while (t < end) {
        var len = R(9, 38), female = rng() < 0.45;
        pol.rulers.push({ name: L.word(rng, 2, 3), from: t, to: Math.min(end, t + len), female: female, pol: pol, epithet: '' });
        t += len;
      }
    });
    var rulerAt = function (pol, year) {
      return pol.rulers.filter(function (x) { return x.from <= year && year < x.to; })[0] || pol.rulers[pol.rulers.length - 1];
    };

    // ---------- Fondations et migrations ----------
    var PLACE = {};
    PLACE[B.FOREST] = PLACE[B.TAIGA] = PLACE[B.JUNGLE] = 'dans la forêt';
    PLACE[B.MOUNTAIN] = 'sur la montagne';
    PLACE[B.DESERT] = PLACE[B.ARID] = 'dans le désert';
    PLACE[B.TUNDRA] = PLACE[B.COLD_STEPPE] = 'dans la neige';
    PLACE[B.GRASS] = PLACE[B.SAVANNA] = 'dans l\'herbe';
    PLACE[B.SHALLOW] = 'dans la mer';
    cities.forEach(function (c, idx) {
      var where = PLACE[c.biome] || 'devant la mer', pol = polities[c.owners[0].pol], ru = rulerAt(pol, c.founded);
      if (idx === 0) {
        ev({ year: 1, type: 'cite', title: 'Fondation de ' + c.name, fr: 'Le peuple a bâti ' + c.name + ' ' + where + '.', where: { at: c }, cause: 'An 1 : le calendrier des ' + p.name + ' commence ici', major: true });
      } else {
        ev({ year: c.founded, type: 'cite', title: 'Fondation de ' + c.name, fr: c.mother && rng() < 0.6 ? 'Les enfants de ' + c.mother.name + ' ont bâti ' + c.name + ' ' + where + '.' : ru.name + ' a bâti ' + c.name + ' ' + where + '.',
          where: c.mother ? { from: c.mother, to: c } : { at: c }, cause: c.lost ? 'Cité aujourd\'hui disparue' : PG.BIOMES[c.biome].name, ruler: ru });
        if (!ru.epithet) ru.epithet = ru.female ? 'la Bâtisseuse' : 'le Bâtisseur';
      }
    });

    // ---------- Nature et ciel, selon la planète ----------
    var haven = cities[0], nat = [];
    var span = R(3, 7);
    if (cold) nat.push({ title: 'Le Grand Hiver', fr: 'La neige est tombée pendant ' + span + ' ans.', cause: 'Climat froid : ' + Math.round(p.home.T) + ' °C en moyenne au berceau du peuple', shock: 0.22, exodus: true });
    if (prm.tilt >= 28) nat.push({ title: 'L\'Année sans été', fr: 'L\'été n\'est pas venu.', cause: 'Inclinaison de ' + prm.tilt + '° : des saisons extrêmes', shock: 0.14 });
    if (dry) nat.push({ title: 'La Grande Sécheresse', fr: 'La pluie n\'est pas venue pendant ' + span + ' ans.', cause: Math.round((f(B.DESERT) + f(B.ARID)) * 100) + ' % de la planète est aride', shock: 0.2, exodus: true });
    if (sea) nat.push({ title: 'Le Raz-de-marée', fr: 'La mer a pris les maisons de ' + pick(cities.slice(0, n)).name + '.', cause: Math.round(pl.liquid * 100) + ' % de la planète est sous l\'eau', shock: 0.1 });
    if (mount) nat.push({ title: 'La Montagne de feu', fr: 'La montagne a brûlé le ciel.', cause: 'Hautes montagnes : ' + (f(B.MOUNTAIN) * 100).toFixed(1).replace('.', ',') + ' % de la surface', shock: 0.12 });
    if (prm.star === 'M') nat.push({ title: 'La Colère du soleil', fr: aquatic ? 'Le soleil rouge a tué les poissons.' : 'Le soleil rouge a brûlé le ciel.', cause: 'Les naines rouges ont de violentes éruptions', shock: 0.15 });
    if (prm.star === 'F') nat.push({ title: 'Le Ciel blanc', fr: 'Le soleil a brûlé la peau des enfants.', cause: 'Étoile blanche, riche en ultraviolets', shock: 0.08 });
    if (prm.moons >= 1) nat.push({ title: prm.moons >= 2 ? 'La Nuit des lunes noires' : 'La Lune noire', fr: 'La nuit est venue pendant le jour.', cause: 'Éclipse : ' + prm.moons + (prm.moons > 1 ? ' lunes' : ' lune'), shock: 0 });
    var beasts = [];
    w.life.groups.forEach(function (g) { if (g.stat.id > 2) beasts.push({ herb: g.fauna[0], pred: g.fauna[1] }); });
    if (beasts.length && !aquatic) { var bt = pick(beasts).pred; nat.push({ title: 'L\'Année des ' + bt.name.split(' ')[0], fr: 'Les bêtes ont tué les chasseurs.', cause: bt.name + ', ' + bt.role.toLowerCase(), shock: 0.05 }); }
    nat.push({ title: 'La Fièvre grise', fr: 'La mort est entrée dans les maisons.', cause: 'Épidémie', shock: 0.25 });
    nat.push({ title: 'La Grande Faim', fr: 'Le peuple a mangé l\'herbe.', cause: 'Famine', shock: 0.15 });
    nat.push({ title: 'L\'Étoile qui tombe', fr: 'Une étoile est tombée dans la mer.', cause: 'Chute d\'une météorite', shock: 0.03 });
    var nNat = Math.min(nat.length, R(3, 5)), natYears = [];
    for (var m = 0; m < nNat; m++) {
      var e = nat.splice(Math.floor(rng() * Math.min(nat.length, 4 + m)), 1)[0], yn = 0;
      for (var t1 = 0; t1 < 30; t1++) { yn = R(40, 970); if (natYears.every(function (y) { return Math.abs(y - yn) > 45; })) break; }
      natYears.push(yn);
      ev({ year: yn, type: 'nature', title: e.title, fr: e.fr, cause: e.cause, shock: e.shock, where: { at: haven } });
      var gone = lost.filter(function (c) { return !c.destroyed && c.founded < yn - 20; })[0];
      if (e.exodus && gone) {
        gone.destroyed = yn + 2;
        var refuge = gone.mother && !gone.mother.lost ? gone.mother : haven;
        ev({ year: yn + 2, type: 'cite', title: 'Abandon de ' + gone.name, fr: 'Le peuple de ' + gone.name + ' a marché vers ' + refuge.name + '.', where: { from: gone, to: refuge }, cause: 'Suite de : ' + e.title.toLowerCase() });
      }
    }
    // Une cité perdue que rien n'a encore détruite s'éteint d'elle-même
    lost.forEach(function (c) {
      if (c.destroyed) return;
      c.destroyed = Math.min(980, c.founded + R(120, 380));
      ev({ year: c.destroyed, type: 'cite', title: 'Abandon de ' + c.name, fr: 'Les enfants de ' + c.name + ' sont partis.', where: { at: c }, cause: 'Cité aujourd\'hui en ruines' });
    });
    if (prm.tilt >= 28) ev({ year: R(60, 300), type: 'cite', title: 'La Première Grande Migration', fr: 'Le peuple marche avec les saisons.', where: { at: haven }, cause: 'Inclinaison de ' + prm.tilt + '° : on change de région deux fois par an' });

    // ---------- Savoirs et croyances ----------
    var herb = beasts.length ? beasts[0].herb : null, flora = w.life.groups.filter(function (g) { return g.stat.id === p.home.id; })[0];
    steps.forEach(function (st) {
      if (st.to === 1) {
        ev({ year: st.year, type: 'savoir', title: 'Les Premiers Champs', fr: aquatic ? 'Le peuple a cultivé les herbes de la mer.' : 'Le peuple a cultivé la terre.', cause: 'Passage à : ' + Hist.STAGES[1].toLowerCase() + (flora ? ' ; on cultive le ' + flora.flora.name.toLowerCase() : ''), major: true });
        if (herb) ev({ year: st.year + R(20, 70), type: 'savoir', title: 'Domestication du ' + herb.name.split(' ')[0], fr: 'Nous gardons les bêtes.', cause: herb.name + ', ' + herb.role.toLowerCase() });
      } else if (st.to === 2) {
        ev({ year: st.year, type: 'savoir', title: 'Les Premières Murailles', fr: 'Le peuple a bâti de grandes maisons de pierre.', cause: 'Passage à : ' + Hist.STAGES[2].toLowerCase(), major: true });
        ev({ year: st.year + R(15, 60), type: 'savoir', title: 'L\'Invention de l\'écriture', fr: 'Nous avons écrit notre langue.', cause: 'Écriture ' + L.script.name + ' : ' + L.script.desc });
      } else if (st.to === 3) {
        ev({ year: st.year, type: 'savoir', title: 'L\'Âge des machines', fr: 'Le feu travaille pour nous.', cause: 'Passage à : ' + Hist.STAGES[3].toLowerCase(), major: true });
      } else {
        ev({ year: st.year, type: 'savoir', title: 'Le Premier Envol', fr: prm.moons ? 'Nous avons volé vers la lune.' : 'Nous avons volé vers les étoiles.', cause: 'Passage à : ' + Hist.STAGES[4].toLowerCase(), major: true });
      }
    });
    var sunName = { M: 'rouge', K: 'jaune', G: 'jaune', F: 'blanc' }[prm.star];
    ev({ year: R(20, 260), type: 'savoir', title: prm.moons >= 2 ? 'Le Culte des lunes' : 'Le Culte du soleil ' + sunName, fr: prm.moons >= 2 ? 'Le peuple a prié les ' + ['', '', 'deux', 'trois'][prm.moons] + ' lunes.' : 'Le peuple a prié le soleil ' + sunName + '.', cause: prm.moons >= 2 ? prm.moons + ' lunes dans le ciel' : 'Une ' + pl.star.name + ' dans le ciel' });
    var localDays = Math.round(pl.yearDays * 24 / prm.dayH);
    ev({ year: R(90, 420), type: 'savoir', title: 'Le Calendrier', fr: 'Nous comptons les jours.', cause: 'Année de ' + localDays + ' jours ; on compte en base ' + L.G.base });
    if (sea && !aquatic) ev({ year: R(150, 700), type: 'savoir', title: 'La Première Traversée', fr: 'Les bateaux ont traversé la mer.', cause: Math.round(pl.liquid * 100) + ' % d\'océans à franchir' });
    var hero = L.word(rng, 2, 3);
    ev({ year: R(200, 850), type: 'savoir', title: 'Le Chant de ' + hero, fr: aquatic ? 'Il a traversé la nuit et il a trouvé la lumière.' : 'Il a traversé la nuit et il a trouvé le feu.', cause: 'Le plus ancien poème encore récité', verse: true });
    if (start >= 2) ev({ year: R(100, 500), type: 'savoir', title: 'La Grande Bibliothèque de ' + cities[0].name, fr: 'Nous gardons les mots des pères.', where: { at: cities[0] }, cause: 'Écriture ' + L.script.name });
    else if (level === 0) {
      ev({ year: R(100, 600), type: 'savoir', title: 'Les Peintures de ' + cities[0].name, fr: 'Nous avons raconté notre histoire sur la pierre.', where: { at: cities[0] }, cause: 'Un peuple sans écriture garde sa mémoire en images' });
      if (herb) ev({ year: R(300, 900), type: 'savoir', title: 'La Grande Chasse', fr: 'Les chasseurs ont tué une grande bête.', cause: herb.name + ', ' + herb.role.toLowerCase() });
    }
    var yw = R(300, 900);
    if (levelAt(yw) >= 2) {
      if (dry) ev({ year: yw, type: 'savoir', title: 'Le Canal de ' + cities[0].name, fr: 'L\'eau de la rivière est venue dans la ville.', where: { at: cities[0] }, cause: 'Un grand ouvrage contre la sécheresse' });
      else ev({ year: yw, type: 'savoir', title: 'Le Grand Temple de ' + cities[0].name, fr: 'Le ' + title(yw, false) + ' a bâti une maison pour les dieux.', where: { at: cities[0] }, cause: 'Le plus grand édifice du monde connu' });
    }

    // ---------- Souverains marquants ----------
    wars.forEach(function (war) {
      var a = rulerAt(war.win, war.to), b = rulerAt(war.lose, war.to);
      if (!a.epithet) a.epithet = a.female ? 'la Conquérante' : 'le Conquérant';
      if (!b.epithet) b.epithet = b.female ? 'la Vaincue' : 'le Vaincu';
    });
    polities.forEach(function (pol) {
      var longest = pol.rulers.slice().sort(function (a, b) { return (b.to - b.from) - (a.to - a.from); })[0];
      if (longest && !longest.epithet) longest.epithet = longest.female ? 'l\'Ancienne' : 'l\'Ancien';
      pol.rulers.forEach(function (ru) {
        if (!ru.epithet && ru.to - ru.from <= 10) ru.epithet = ru.female ? 'la Brève' : 'le Bref';
        if (!ru.epithet && rng() < 0.3) ru.epithet = pick(ru.female ? ['la Sage', 'la Juste', 'la Silencieuse'] : ['le Sage', 'le Juste', 'le Silencieux']);
      });
      pol.rulers.filter(function (ru) { return ru.epithet && ru.to - ru.from >= 14; }).slice(0, 3).forEach(function (ru, idx) {
        var good = !/Vaincu/.test(ru.epithet), t = title(ru.from, ru.female);
        var deed = !good ? 'a été ' + (t === 'reine' ? 'une reine triste' : 'un ' + t + ' triste')
          : [t === 'reine' ? 'a été une bonne reine' : 'a été un bon ' + t, 'a gardé le peuple pendant ' + (ru.to - ru.from) + ' ans', 'a donné la paix aux enfants du peuple'][idx % 3];
        ev({ year: ru.from, type: 'souverain', title: 'Règne de ' + ru.name + ' ' + ru.epithet, fr: ru.name + ' ' + deed + '.',
          where: { at: pol.seat }, cause: polName(pol, ru.from) + ', ' + (ru.to - ru.from) + ' ans de règne', ruler: ru });
      });
    });

    events = events.filter(function (e) { return e.year >= 1 && e.year <= 1000; }).sort(function (a, b) { return a.year - b.year; });
    events.forEach(function (e, i) { e.id = i; });

    // ---------- Ères ----------
    var cuts = [{ year: 1, name: start === 0 ? 'Le temps des chasseurs' : start === 1 ? 'Le temps des champs' : 'Le temps des rois' }];
    steps.forEach(function (st) { cuts.push({ year: st.year, name: ['', 'Le temps des champs', 'Le temps des rois', aquatic ? 'Le temps des machines' : 'Le temps du feu', 'Le temps des étoiles'][st.to] }); });
    if (union && cuts.every(function (c) { return Math.abs(c.year - union.year) > 60; })) cuts.push({ year: union.year, name: 'Le temps de la paix' });
    else if (wars.length && cuts.length < 3) {
      var big = wars.slice().sort(function (a, b) { return (b.to - b.from) - (a.to - a.from); })[0];
      if (cuts.every(function (c) { return Math.abs(c.year - big.from) > 60; })) { cuts.push({ year: big.from, name: 'Le temps de la guerre' }); if (big.to < 900) cuts.push({ year: big.to, name: 'Le temps des enfants' }); }
    }
    if (cuts.length < 2) cuts.push({ year: R(380, 620), name: 'Le temps des chemins' });
    cuts.sort(function (a, b) { return a.year - b.year; });
    var eras = cuts.map(function (c, i) { return { name: c.name, from: c.year, to: i + 1 < cuts.length ? cuts[i + 1].year : 1000 }; });

    // ---------- Population ----------
    var growth = [6, 14, 30, 60, 90][level] / [6, 14, 30, 60, 90][start] * (4 + rng() * 4), P0 = p.total / growth, pop = [];
    for (var d = 0; d <= 100; d++) {
      var year = d * 10, x = year / 1000, v = Math.exp(Math.log(P0) + (Math.log(p.total) - Math.log(P0)) * (x * x * (3 - 2 * x) * 0.6 + x * 0.4));
      events.forEach(function (e) {
        if (e.shock && year >= e.year) v *= 1 - e.shock * Math.exp(-(year - e.year) / 55);
      });
      pop.push(v);
    }
    var fix = p.total / pop[100];
    pop = pop.map(function (v, d) { return v * (1 + (fix - 1) * d / 100); });

    // ---------- Résumé ----------
    var founded = cities.filter(function (c) { return !c.lost; }).length, worst = events.filter(function (e) { return e.type === 'nature' && e.shock; }).sort(function (a, b) { return b.shock - a.shock; })[0];
    var longest = wars.slice().sort(function (a, b) { return (b.to - b.from) - (a.to - a.from); })[0];
    var synopsis = [];
    synopsis.push(start === level ? 'En mille ans, les ' + p.name + ' sont restés ' + Hist.STAGES[level].toLowerCase().replace('villages agricoles', 'des villageois').replace('cités-états', 'un peuple de cités') + '.'
      : 'En mille ans, les ' + p.name + ' sont passés du stade « ' + Hist.STAGES[start].toLowerCase() + ' » au stade « ' + Hist.STAGES[level].toLowerCase() + ' ».');
    synopsis.push(founded + ' ' + p.tech.word + ' existent encore' + (lost.length ? ', ' + lost.length + (lost.length > 1 ? ' ont disparu' : ' a disparu') : '') + '.');
    if (wars.length) synopsis.push(wars.length + (wars.length > 1 ? ' guerres ont' : ' guerre a') + ' opposé ' + (kPol === 2 ? 'les deux' : 'les trois') + ' ' + (level >= 2 ? 'royaumes' : 'clans') + ' ; la plus longue, ' + longest.name.replace(/^La /, 'la ') + ', a duré ' + (longest.to - longest.from) + ' ans.');
    synopsis.push(union ? 'Depuis l\'an ' + union.year + ', un seul pouvoir règne depuis ' + union.pol.seat.name + '.' : kPol > 1 ? 'Le peuple reste divisé entre ' + polities.map(function (x) { return x.seat.name; }).join(' et ') + '.' : 'Le peuple n\'a jamais connu qu\'un seul pouvoir, celui de ' + cities[0].name + '.');
    if (worst) synopsis.push('Sa pire épreuve : ' + worst.title.replace(/^(La|Le|L')/, function (a) { return a.toLowerCase(); }) + ', en l\'an ' + worst.year + '.');

    return {
      events: events, eras: eras, cities: cities, polities: polities, wars: wars, pop: pop, union: union, steps: steps, start: start,
      synopsis: synopsis.join(' '), levelAt: levelAt, ownerAt: ownerAt, polName: polName,
      earthYears: Math.round(1000 * pl.yearDays / 365.25)
    };
  };
})();
