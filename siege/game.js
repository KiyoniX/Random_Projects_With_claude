(function () {
  'use strict';

  var PX = 1000;             // côté du plan, en pixels : tout le jeu se mesure dans cette unité
  var FRAME = 20;            // marge du cadre : les assaillants apparaissent sur ce bord
  var DT = 1 / 30;           // pas de temps de la logique, en secondes
  var WAVES = 14;
  var LIVES = 12;            // assaillants que la place peut encaisser
  var REFUND = 0.7;          // part de l'or investi rendue à la vente
  var WAIT = 30, BREATH = 12; // délai avant la vague suivante : au plus tard, et une fois le terrain vide
  var BASE = 14, STEP = 7, QUAD = 0.3;   // budget d'une vague : BASE + STEP × n + QUAD × n²
  var FEINT = [0.8, 0.4];    // parts du budget quand une seconde porte est attaquée
  var FINAL = 1.3;           // budget de l'assaut final, partagé entre toutes les portes
  var GATE_HP = 200;
  var FLANK = 44;            // distance le long du rempart entre une porte et ses postes de flanquement
  var HERSE = [{ cost: 60, hp: 80 }, { cost: 90, hp: 120 }];
  var REPAIR = { cost: 25, hp: 50 };
  var REBUILD = { cost: 90, part: 0.6 };
  var ARROW_SPEED = 320, STONE_SPEED = 150;
  var STORE = 'siege';

  // Selon la taille de la ville : or de départ, poids des vagues, PV des assaillants multipliés à chaque vague.
  var SIZES = {
    bourg: { gold: 260, mul: 1.1, rise: 1.205 },
    ville: { gold: 330, mul: 1, rise: 1.18 },
    cite: { gold: 400, mul: 1, rise: 1.15 }
  };

  // Une valeur par niveau. on : emplacements permis. pierce : ignore le blindage. near : portée minimale.
  // guard : passages d'assaillants encaissés hors les murs avant d'être emporté.
  var TOWERS = [
    { id: 'archer', ch: 'A', name: 'Archers', on: ['tour', 'rue', 'route'], cost: [50, 45, 80], range: [130, 140, 150], cd: [0.8, 0.75, 0.7], dmg: [7, 11, 17], guard: [10, 14, 18],
      desc: 'Tir rapide sur une cible. Peinent contre les boucliers. Hors les murs, le poste finit par être emporté.' },
    { id: 'baliste', ch: 'B', name: 'Baliste', on: ['tour', 'rue'], cost: [120, 100, 150], range: [210, 230, 250], cd: [2.4, 2.2, 2], dmg: [55, 95, 150], pierce: true,
      desc: 'Longue portée, vise le plus costaud et perce le blindage. Lente.' },
    { id: 'trebuchet', ch: 'T', name: 'Trébuchet', on: ['tour', 'rue'], cost: [110, 90, 140], range: [250, 270, 290], near: 70, cd: [3.4, 3.2, 3], dmg: [20, 32, 50], area: [26, 30, 34],
      desc: 'Pierre qui écrase toute une zone, très loin. Ne tire pas à ses pieds.' },
    { id: 'poix', ch: 'P', name: 'Poix bouillante', on: ['porte'], cost: [70, 60, 100], range: [40, 44, 48], cd: [1.6, 1.5, 1.4], dmg: [9, 14, 22], pour: true,
      desc: 'Se verse sur tout ce qui se presse à la porte, blindage ou non.' },
    { id: 'pieux', ch: 'X', name: 'Pieux', on: ['route'], cost: [30, 30, 45], range: [40, 45, 50], slow: [0.35, 0.45, 0.55], spike: [3, 5, 8], guard: [24, 40, 60],
      desc: 'Barrent la route : ralentissent et blessent ceux qui passent, puis cèdent à l\'usure.' }
  ];
  var TOWER = {};
  TOWERS.forEach(function (t) { TOWER[t.id] = t; });

  // cost : poids dans le budget d'une vague. gap : secondes entre deux apparitions. gate : dégâts par seconde contre une porte.
  var FOES = {
    p: { name: 'Piétaille', hp: 24, speed: 12, gate: 1.2, gold: 4, cost: 2, gap: 0.9, tag: 'ordinaire' },
    c: { name: 'Cavalier', hp: 20, speed: 24, gate: 1, gold: 5, cost: 3, gap: 0.7, tag: 'rapide' },
    b: { name: 'Bouclier', hp: 60, speed: 9, armor: 5, gate: 2, gold: 10, cost: 6, gap: 1.6, tag: 'lent, blindé' },
    e: { name: 'Échelle', hp: 30, speed: 13, climb: 5, gold: 7, cost: 4.5, gap: 1.2, tag: 'franchit le rempart sans toucher à la porte' },
    B: { name: 'Bélier', hp: 220, speed: 7, armor: 4, gate: 12, gold: 30, cost: 22, gap: 6, ram: true, raid: 3, tag: 'ne s\'en prend qu\'à la porte' }
  };
  var SCRIPT = ['p', 'pc', 'pb', 'pe', 'pcB'];   // les premières vagues présentent les assaillants un par un
  var POOL = ['p', 'c', 'b', 'e'];

  var WINDS = ['de l\'Est', 'du Sud-Est', 'du Sud', 'du Sud-Ouest', 'de l\'Ouest', 'du Nord-Ouest', 'du Nord', 'du Nord-Est'];
  var KINDS = { tour: 'Tour du rempart', porte: 'Porte', route: 'Avant-poste hors les murs', rue: 'Poste dans la ville' };

  var INK = '#3d2f21', GROUND = '#f1e5c6', BLOOD = '#b3341f', GORE = '#6e1c10';   // l'encre rouge est réservée à l'ennemi et au danger
  var WASH = 'rgba(226, 180, 56, .62)', PIN = '#2c3f5a';
  var FONT = '\'Palatino Linotype\', \'Book Antiqua\', Palatino, Georgia, serif';

  var $ = function (s) { return document.querySelector(s); };

  // ---------- Hasard ----------
  var rng;
  function seedRng(str) {
    var h = 1779033703 ^ str.length, i;
    for (i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    rng = function () {
      h = h + 0x6D2B79F5 | 0;
      var t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function int(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = int(0, i), t = arr[i];
      arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function sample(arr, n) { return shuffle(arr.slice()).slice(0, n); }

  // ---------- Géométrie ----------
  function sq(n) { return n * n; }
  function dist(a, b) { return Math.sqrt(sq(a.x - b.x) + sq(a.y - b.y)); }
  function inFrame(p) { return p.x >= FRAME && p.x <= PX - FRAME && p.y >= FRAME && p.y <= PX - FRAME; }

  // Une voie : une suite de points et la distance parcourue à chacun.
  function track(pts) {
    var out = [pts[0]], cum = [0], i, l;
    for (i = 1; i < pts.length; i++) {
      l = dist(out[out.length - 1], pts[i]);
      if (l < 0.01) continue;
      out.push(pts[i]);
      cum.push(cum[cum.length - 1] + l);
    }
    return { pts: out, cum: cum, len: cum[cum.length - 1] };
  }
  // Point de la voie à la distance d, et sens de marche à cet endroit.
  function along(tr, d) {
    var i = 1, a, b, l, t;
    if (tr.pts.length < 2) return { x: tr.pts[0].x, y: tr.pts[0].y, ux: 1, uy: 0 };
    d = Math.max(0, Math.min(tr.len, d));
    while (i < tr.cum.length - 1 && tr.cum[i] < d) i++;
    a = tr.pts[i - 1]; b = tr.pts[i]; l = tr.cum[i] - tr.cum[i - 1]; t = (d - tr.cum[i - 1]) / l;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ux: (b.x - a.x) / l, uy: (b.y - a.y) / l };
  }
  // Coupe une suite de points partie de l'intérieur là où elle sort du cadre.
  function clip(pts) {
    var out = [pts[0]], i, n, a, b, lo, hi, t;
    for (i = 1; i < pts.length; i++) {
      a = pts[i - 1]; b = pts[i];
      if (inFrame(b)) { out.push(b); continue; }
      for (lo = 0, hi = 1, n = 0; n < 30; n++) {
        t = (lo + hi) / 2;
        if (inFrame({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) lo = t; else hi = t;
      }
      out.push({ x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo });
      break;
    }
    return out;
  }

  // ---------- État ----------
  // S : la partie, que seule la logique modifie. U : l'interface (choix en cours, curseur, pause, vitesse).
  var S;
  var U = { pick: null, sel: null, cur: null, foe: null, paused: false, speed: 1, acc: 0, last: 0, link: null, address: '' };

  function say(text) { S.msg = text; }

  function bestOf(key) {
    try { return (JSON.parse(localStorage.getItem(STORE)) || {})[key] || 0; } catch (e) { return 0; }
  }
  function saveBest() {
    if (S.score <= S.best) return;
    S.best = S.score; S.record = true;
    try {
      var all = JSON.parse(localStorage.getItem(STORE)) || {};
      all[S.key] = S.score;
      localStorage.setItem(STORE, JSON.stringify(all));
    } catch (e) { /* stockage indisponible : le record ne vaut que pour cette session */ }
  }

  // ---------- Champ de bataille ----------
  // Tire du plan les fronts (une route, une porte, une avenue) et les emplacements de défense.
  function newBoard(model) {
    var k = model.k, half = model.px / 2, slots = [], fronts, plaza;
    function P(v) { return { x: v.x * k + half, y: v.y * k + half }; }
    function first(lists, g) {
      for (var i = 0; i < lists.length; i++) if (lists[i][0] === g) return lists[i];
      return null;
    }
    function slot(kind, p, front, d, gap) {
      var s;
      if (slots.some(function (o) { return dist(o, p) < gap; })) return null;
      s = { i: slots.length, kind: kind, x: p.x, y: p.y, front: front, d: d, tower: null };
      slots.push(s);
      return s;
    }

    plaza = P(window.PlanVille.geo.centroid(model.centre.poly));
    fronts = model.gates.map(function (g, i) {
      var at = P(g), way = (first(model.highways, g) || [g]).map(P), av = (first(model.avenues, g) || [g]).map(P);
      var end = way[way.length - 1], out = dist(end, { x: half, y: half }) > 1 ? { x: end.x - half, y: end.y - half } : { x: 1, y: 0 }, l = Math.sqrt(out.x * out.x + out.y * out.y);
      // Une route qui s'arrêterait avant le cadre est prolongée tout droit vers le large.
      way.push({ x: end.x + out.x / l * 3 * PX, y: end.y + out.y / l * 3 * PX });
      return {
        i: i, x: at.x, y: at.y, name: 'Porte ' + WINDS[(Math.round(Math.atan2(at.y - half, at.x - half) / (Math.PI / 4)) + 8) % 8],
        road: track(clip(way).reverse()), street: track(av.concat([plaza])),
        hp: GATE_HP, max: GATE_HP, lvl: 0, down: false, slot: null
      };
    });

    fronts.forEach(function (f) { f.slot = slot('porte', f, f.i, 0, 0); });
    model.wall.forEach(function (v) {
      if (model.gates.indexOf(v) < 0) slot('tour', P(v), -1, 0, 20);
    });
    // Le plan ne garantit pas de tour près d'une porte : deux postes sur la courtine la flanquent.
    model.gates.forEach(function (g) {
      [1, -1].forEach(function (dir) {
        var n = model.wall.length, i = model.wall.indexOf(g), a = P(g), b, l, rest = FLANK;
        for (;;) {
          i = (i + dir + n) % n; b = P(model.wall[i]); l = dist(a, b);
          if (l >= rest || model.gates.indexOf(model.wall[i]) >= 0) break;
          rest -= l; a = b;
        }
        if (l > 0.01) slot('tour', { x: a.x + (b.x - a.x) * Math.min(1, rest / l), y: a.y + (b.y - a.y) * Math.min(1, rest / l) }, -1, 0, 26);
      });
    });
    fronts.forEach(function (f) {
      [55, 115, 175].forEach(function (s, n) {
        var d = f.road.len - s, p;
        if (d < 30) return;
        p = along(f.road, d);
        slot('route', { x: p.x - p.uy * (n % 2 ? -15 : 15), y: p.y + p.ux * (n % 2 ? -15 : 15) }, f.i, d, 22);
      });
      [60, 130].forEach(function (d, n) {
        var p;
        if (d > f.street.len - 45) return;
        p = along(f.street, d);
        slot('rue', { x: p.x - p.uy * (n % 2 ? 13 : -13), y: p.y + p.ux * (n % 2 ? 13 : -13) }, f.i, d, 24);
      });
    });
    return { fronts: fronts, slots: slots, plaza: plaza };
  }

  function newGame(seed, size, from) {
    var city, board;
    seed = seed || Math.random().toString(36).slice(2, 8);
    size = SIZES[size] ? size : 'ville';
    city = window.PlanVille.plan(seed, size, from || null);
    board = newBoard(city.model);
    seedRng('siege/' + seed + '/' + size);
    S = {
      seed: seed, size: size, key: seed + '/' + size, city: city, name: city.name,
      fronts: board.fronts, slots: board.slots, plaza: board.plaza,
      gold: SIZES[size].gold, lives: LIVES, score: 0, kills: 0, wave: 0, tick: 0, timer: 0, born: 0,
      towers: [], foes: [], shots: [], fx: [], queue: [],
      over: null, record: false, best: bestOf(seed + '/' + size),
      msg: 'Regarde quelle porte est visée, poste tes défenses, puis lance la vague.'
    };
    S.waves = targets().map(function (main, n) { return makeWave(n + 1, main); });
    S.next = S.waves[0];
    return S;
  }

  // ---------- Vagues ----------
  // La porte principale de chaque vague : toutes y passent à tour de rôle, jamais deux fois de suite la même.
  function targets() {
    var out = [], round;
    while (out.length < WAVES) {
      round = shuffle(S.fronts.map(function (f) { return f.i; }));
      if (out.length && round.length > 1 && round[0] === out[out.length - 1]) round.push(round.shift());
      out = out.concat(round);
    }
    return out.slice(0, WAVES);
  }

  function makeWave(n, main) {
    var G = S.fronts.length, last = n === WAVES, ram = last || (n >= 5 && n % 3 === 2);
    var types = n <= SCRIPT.length ? SCRIPT[n - 1].split('') : sample(POOL, int(2, 3)).concat(ram ? ['B'] : []);
    var crowd = types.filter(function (ch) { return !FOES[ch].ram; });
    var budget = (BASE + STEP * n + QUAD * n * n) * SIZES[S.size].mul, shares = S.fronts.map(function () { return 0; }), groups = [];
    if (last) shares = shares.map(function () { return FINAL / G; });
    else if (G > 1 && n >= 4) { shares[main] = FEINT[0]; shares[(main + int(1, G - 1)) % G] = FEINT[1]; }
    else shares[main] = 1;
    shares.forEach(function (share, g) {
      var start = 0;
      if (!share) return;
      types.forEach(function (ch, j) {
        var def = FOES[ch], count;
        if (def.ram) count = last ? 1 : g !== main ? 0 : n >= 10 ? 2 : 1;
        else count = Math.max(j ? 0 : 1, Math.round(budget * share / crowd.length / def.cost));
        if (!count) return;
        groups.push({ front: g, ch: ch, count: count, gap: def.gap, at: start });
        // Les groupes se chevauchent : le suivant part avant que le précédent ait fini d'arriver.
        start += count * def.gap * 0.6;
      });
    });
    return { n: n, main: main, mul: Math.pow(SIZES[S.size].rise, n - 1), groups: groups, fronts: S.fronts.filter(function (f) { return shares[f.i] > 0; }).map(function (f) { return f.i; }) };
  }

  function launch() {
    var w = S.next, now = S.tick * DT;
    S.wave = w.n;
    w.groups.forEach(function (g) {
      for (var i = 0; i < g.count; i++) S.queue.push({ at: now + g.at + i * g.gap, ch: g.ch, front: g.front, mul: w.mul });
    });
    S.queue.sort(function (a, b) { return a.at - b.at; });
    S.next = S.waves[w.n] || null;
    S.timer = WAIT;
    say('Vague ' + w.n + ' : ' + (w.n === WAVES ? 'assaut général, toutes les portes sont attaquées.' : w.fronts.map(function (i) { return S.fronts[i].name.toLowerCase(); }).join(' et ') + '.'));
  }

  function canCall() {
    return !S.over && !S.queue.length && S.wave < WAVES;
  }
  // Appeler la vague en avance rapporte un or par seconde gagnée.
  function callWave() {
    var bonus;
    if (!canCall()) return false;
    bonus = S.wave ? Math.ceil(S.timer) : 0;
    launch();
    if (bonus > 0) { S.gold += bonus; S.score += bonus; say(S.msg + ' Appel anticipé : +' + bonus + ' or.'); }
    return true;
  }

  // ---------- Assaillants ----------
  // stage : 0 sur la route, 1 devant la porte, 2 dans l'avenue.
  function place(f) {
    var fr = S.fronts[f.front], p = along(f.stage === 2 ? fr.street : fr.road, f.d);
    f.x = p.x - p.uy * f.off; f.y = p.y + p.ux * f.off; f.ux = p.ux; f.uy = p.uy;
  }
  function spawn(q) {
    var def = FOES[q.ch], hp = Math.round(def.hp * q.mul), n = S.born++;
    var f = { ch: q.ch, def: def, hp: hp, max: hp, front: q.front, stage: 0, d: 0, off: (n * 7 % 5 - 2) * 3, stop: 5 + n * 3 % 5 * 3.5, wait: 0, slow: 0, slowT: 0, gone: false };
    place(f);
    S.foes.push(f);
  }
  // Distance qu'il lui reste à parcourir jusqu'à la place.
  function left(f) {
    var fr = S.fronts[f.front];
    return f.stage === 2 ? fr.street.len - f.d : fr.road.len - f.d + fr.street.len;
  }

  function slay(f) {
    f.gone = true;
    S.gold += f.def.gold; S.score += f.def.gold; S.kills++;
  }
  function hurt(f, n, pierce) {
    if (f.gone) return;
    f.hp -= pierce ? n : Math.max(1, n - (f.def.armor || 0));
    if (f.hp <= 0) slay(f);
  }

  function batter(fr, n) {
    if (fr.down) return;
    fr.hp -= n;
    if (fr.hp > 0) return;
    fr.hp = 0; fr.down = true;
    S.fx.push({ kind: 'boom', x: fr.x, y: fr.y, r: 30, t: 0.5, T: 0.5 });
    say('La ' + fr.name.toLowerCase() + ' cède ! L\'ennemi s\'engouffre dans l\'avenue.');
  }

  // Un assaillant passe devant une défense hors les murs : il l'abîme, et les pieux le blessent.
  function raid(t, f) {
    if (t.def.spike) hurt(f, t.def.spike[t.lvl], true);
    t.wear += f.def.raid || 1;
    if (t.wear < t.def.guard[t.lvl]) return;
    t.gone = true; t.slot.tower = null;
    S.fx.push({ kind: 'boom', x: t.x, y: t.y, r: 16, t: 0.4, T: 0.4 });
    say(t.def.name + ' hors les murs : emportés par l\'assaut.');
  }

  function advance(f) {
    var def = f.def, fr = S.fronts[f.front], v = def.speed, from = f.d, i, t;
    if (f.gone) return;
    if (f.slowT > 0) { f.slowT -= DT; v *= 1 - f.slow; }
    if (f.stage === 0) {
      f.d += v * DT;
      for (i = 0; i < S.towers.length; i++) {
        t = S.towers[i];
        if (!t.gone && t.slot.kind === 'route' && t.slot.front === f.front && from < t.slot.d && f.d >= t.slot.d) raid(t, f);
      }
      if (f.gone) return;
      if (f.d >= fr.road.len - f.stop) { f.d = fr.road.len - f.stop; f.stage = 1; f.wait = def.climb || 0; }
    } else if (f.stage === 1) {
      if (fr.down || (def.climb && (f.wait -= DT) <= 0)) {
        // Un bélier n'a plus rien à faire devant une porte tombée.
        if (def.ram) { f.gone = true; return; }
        f.stage = 2; f.d = 0;
      } else if (!def.climb) batter(fr, def.gate * DT);
    } else {
      f.d += v * DT;
      if (f.d >= fr.street.len) {
        f.gone = true;
        S.lives--;
        say(def.name + ' sur la place : elle peut encore en encaisser ' + Math.max(0, S.lives) + '.');
        return;
      }
    }
    place(f);
  }

  // ---------- Défenses ----------
  function allowed(def, slot) { return def.on.indexOf(slot.kind) >= 0; }

  function build(id, slot) {
    var def = TOWER[id], t;
    if (S.over || !def || !slot) return null;
    if (slot.tower) { say('Cet emplacement est déjà tenu.'); return null; }
    if (!allowed(def, slot)) { say(def.name + ' : ' + where(def) + ' seulement.'); return null; }
    if (S.gold < def.cost[0]) { say('Pas assez d\'or pour : ' + def.name + ' (' + def.cost[0] + ').'); return null; }
    S.gold -= def.cost[0];
    t = { def: def, slot: slot, x: slot.x, y: slot.y, lvl: 0, cd: 0, spent: def.cost[0], wear: 0, gone: false };
    S.towers.push(t);
    slot.tower = t;
    say(def.name + ' en place.');
    return t;
  }
  function upgradeCost(t) { return t.lvl < 2 ? t.def.cost[t.lvl + 1] : 0; }
  function upgrade(t) {
    var cost = upgradeCost(t);
    if (S.over || !cost || t.gone) return false;
    if (S.gold < cost) { say('Pas assez d\'or pour améliorer (' + cost + ').'); return false; }
    S.gold -= cost; t.spent += cost; t.lvl++; t.wear = 0;
    say(t.def.name + ' : niveau ' + (t.lvl + 1) + '.');
    return true;
  }
  function resale(t) {
    var worn = t.def.guard && t.slot.kind === 'route' ? 1 - t.wear / t.def.guard[t.lvl] : 1;
    return Math.floor(t.spent * REFUND * worn);
  }
  function sell(t) {
    var i = S.towers.indexOf(t), gain = resale(t);
    if (S.over || i < 0 || t.gone) return false;
    S.towers.splice(i, 1);
    t.slot.tower = null;
    S.gold += gain;
    say(t.def.name + ' : vendu, +' + gain + ' or.');
    return true;
  }

  function besieged(fr) {
    return S.foes.some(function (f) { return !f.gone && f.front === fr.i && f.stage < 2; });
  }
  function repair(fr) {
    if (S.over || fr.down || fr.hp >= fr.max) return false;
    if (S.gold < REPAIR.cost) { say('Pas assez d\'or pour réparer (' + REPAIR.cost + ').'); return false; }
    S.gold -= REPAIR.cost;
    fr.hp = Math.min(fr.max, fr.hp + REPAIR.hp);
    say(fr.name + ' réparée.');
    return true;
  }
  function rebuild(fr) {
    if (S.over || !fr.down) return false;
    if (besieged(fr)) { say('Impossible de relever la porte tant que l\'ennemi tient la route.'); return false; }
    if (S.gold < REBUILD.cost) { say('Pas assez d\'or pour relever la porte (' + REBUILD.cost + ').'); return false; }
    S.gold -= REBUILD.cost;
    fr.down = false; fr.hp = Math.round(fr.max * REBUILD.part);
    say(fr.name + ' relevée.');
    return true;
  }
  function herseCost(fr) { return fr.lvl < HERSE.length ? HERSE[fr.lvl].cost : 0; }
  function reinforce(fr) {
    var cost = herseCost(fr);
    if (S.over || !cost) return false;
    if (S.gold < cost) { say('Pas assez d\'or pour la herse (' + cost + ').'); return false; }
    S.gold -= cost;
    fr.max += HERSE[fr.lvl].hp;
    if (!fr.down) fr.hp += HERSE[fr.lvl].hp;
    fr.lvl++;
    say(fr.name + ' : ' + (fr.lvl === 1 ? 'herse posée.' : 'herse doublée.'));
    return true;
  }

  function inRange(t, f) {
    var d2 = sq(f.x - t.x) + sq(f.y - t.y);
    return d2 <= sq(t.def.range[t.lvl]) && (!t.def.near || d2 >= sq(t.def.near));
  }

  function aim(t) {
    var def = t.def, best = null, top = -Infinity, i, j, f, v, r2;
    for (i = 0; i < S.foes.length; i++) {
      f = S.foes[i];
      if (f.gone || !inRange(t, f)) continue;
      v = -left(f);                                  // par défaut : le plus près de la place
      if (def.pierce) v = f.hp + v / 10000;          // la baliste préfère le plus costaud
      if (def.area) {                                // le trébuchet cherche l'attroupement
        r2 = sq(def.area[t.lvl]);
        for (j = 0; j < S.foes.length; j++) if (!S.foes[j].gone && sq(S.foes[j].x - f.x) + sq(S.foes[j].y - f.y) <= r2) v += 10000;
      }
      if (v > top) { top = v; best = f; }
    }
    return best;
  }

  // Où sera la cible dans s secondes.
  function ahead(f, s) {
    var fr = S.fronts[f.front], v = f.def.speed * (f.slowT > 0 ? 1 - f.slow : 1);
    if (f.stage === 1) return { x: f.x, y: f.y };
    return along(f.stage === 2 ? fr.street : fr.road, f.stage === 2 ? f.d + v * s : Math.min(f.d + v * s, fr.road.len - f.stop));
  }

  function pour(t) {
    var hit = false, i, f;
    for (i = 0; i < S.foes.length; i++) {
      f = S.foes[i];
      if (f.gone || f.front !== t.slot.front || !inRange(t, f)) continue;
      hit = true;
      hurt(f, t.def.dmg[t.lvl], true);
    }
    if (hit) S.fx.push({ kind: 'poix', x: t.x, y: t.y, r: t.def.range[t.lvl], t: 0.35, T: 0.35 });
    return hit;
  }

  function fire(t) {
    var def = t.def, L = t.lvl, i, f, p, T;
    if (t.gone) return;
    if (def.slow) {
      for (i = 0; i < S.foes.length; i++) {
        f = S.foes[i];
        if (!f.gone && f.front === t.slot.front && f.stage === 0 && Math.abs(f.d - t.slot.d) <= def.range[L]) {
          f.slow = Math.max(f.slowT > 0 ? f.slow : 0, def.slow[L]);
          f.slowT = 0.2;
        }
      }
      return;
    }
    if (t.cd > 0) { t.cd -= DT; return; }
    if (def.pour) { if (pour(t)) t.cd = def.cd[L]; return; }
    f = aim(t);
    if (!f) return;
    t.cd = def.cd[L];
    if (def.pierce) {
      // Le trait de baliste touche tout de suite ; on n'en dessine que la trace.
      S.fx.push({ kind: 'bolt', x: t.x, y: t.y, x2: f.x, y2: f.y, t: 0.18, T: 0.18 });
      hurt(f, def.dmg[L], true);
    } else if (def.area) {
      T = Math.sqrt(sq(f.x - t.x) + sq(f.y - t.y)) / STONE_SPEED;
      p = ahead(f, T);
      S.shots.push({ kind: 'stone', x: t.x, y: t.y, x0: t.x, y0: t.y, tx: p.x, ty: p.y, t: 0, T: T, dmg: def.dmg[L], area: def.area[L], done: false });
    } else {
      S.shots.push({ kind: 'arrow', x: t.x, y: t.y, to: f, tx: f.x, ty: f.y, dmg: def.dmg[L], done: false });
    }
  }

  // ---------- Projectiles ----------
  function fly(s) {
    var dx, dy, l, step, i, f;
    if (s.kind === 'stone') {
      s.t += DT;
      if (s.t < s.T) { s.x = s.x0 + (s.tx - s.x0) * s.t / s.T; s.y = s.y0 + (s.ty - s.y0) * s.t / s.T; return; }
      s.done = true;
      for (i = 0; i < S.foes.length; i++) {
        f = S.foes[i];
        if (sq(f.x - s.tx) + sq(f.y - s.ty) <= sq(s.area)) hurt(f, s.dmg, false);
      }
      S.fx.push({ kind: 'boom', x: s.tx, y: s.ty, r: s.area, t: 0.3, T: 0.3 });
      return;
    }
    if (s.to.gone) { s.done = true; return; }
    s.tx = s.to.x; s.ty = s.to.y;
    dx = s.tx - s.x; dy = s.ty - s.y; l = Math.sqrt(dx * dx + dy * dy); step = ARROW_SPEED * DT;
    if (l <= step) { s.done = true; hurt(s.to, s.dmg, false); return; }
    s.x += dx / l * step; s.y += dy / l * step; s.ux = dx / l; s.uy = dy / l;
  }

  // ---------- Boucle de jeu ----------
  function finish(won) {
    if (won) S.fronts.forEach(function (fr) { S.score += fr.down ? 0 : 30; });
    if (won) S.score += S.lives * 20;
    S.over = won ? 'won' : 'lost';
    saveBest();
  }

  function tick() {
    var i, now;
    if (S.over) return;
    S.tick++;
    now = S.tick * DT;
    while (S.queue.length && S.queue[0].at <= now) spawn(S.queue.shift());
    for (i = 0; i < S.foes.length; i++) advance(S.foes[i]);
    for (i = 0; i < S.towers.length; i++) fire(S.towers[i]);
    for (i = 0; i < S.shots.length; i++) fly(S.shots[i]);
    for (i = 0; i < S.fx.length; i++) S.fx[i].t -= DT;
    S.foes = S.foes.filter(function (f) { return !f.gone; });
    S.towers = S.towers.filter(function (t) { return !t.gone; });
    S.shots = S.shots.filter(function (s) { return !s.done; });
    S.fx = S.fx.filter(function (e) { return e.t > 0; });

    if (S.lives <= 0) { finish(false); return; }
    if (!S.wave || S.queue.length) return;
    if (S.wave >= WAVES) {
      if (!S.foes.length) finish(true);
      return;
    }
    if (!S.foes.length && S.timer > BREATH) S.timer = BREATH;
    S.timer -= DT;
    if (S.timer <= 0) launch();
  }

  // ---------- Textes ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function elide(name) { return /^[aeiouyàâäéèêëîïôöûü]/i.test(name) ? 'd\'' : 'de '; }
  function where(def) {
    return def.on.map(function (k) { return k === 'tour' ? 'sur une tour' : k === 'porte' ? 'sur une porte' : k === 'route' ? 'le long d\'une route' : 'dans une avenue'; }).join(', ');
  }
  function stats(def, L) {
    var out = [];
    if (def.dmg) out.push('Dégâts ' + def.dmg[L]);
    if (def.area) out.push('Zone ' + def.area[L]);
    if (def.slow) out.push('Ralentit de ' + Math.round(def.slow[L] * 100) + ' %');
    if (def.spike) out.push('Blesse de ' + def.spike[L]);
    out.push('Portée ' + def.range[L]);
    if (def.cd) out.push('Recharge ' + String(def.cd[L]).replace('.', ',') + ' s');
    return out.map(function (t, n) { return n ? t.toLowerCase() : t; }).join(', ');
  }

  // Prise pour les essais et la console : toute la logique tourne sans affichage.
  window.Siege = {
    DT: DT, WAVES: WAVES, LIVES: LIVES, TOWERS: TOWERS, TOWER: TOWER, FOES: FOES, SIZES: SIZES, HERSE: HERSE, REPAIR: REPAIR, REBUILD: REBUILD, PX: PX, FRAME: FRAME,
    state: function () { return S; }, ui: U,
    newGame: newGame, tick: tick, build: build, upgrade: upgrade, upgradeCost: upgradeCost, sell: sell, resale: resale, allowed: allowed,
    repair: repair, rebuild: rebuild, reinforce: reinforce, herseCost: herseCost, callWave: callWave, canCall: canCall
  };
  if (!$('#board')) return;

  // ---------- Vue ----------
  var canvas = $('#fx'), ctx = canvas.getContext('2d');
  var view = window.VuePlanche.create({
    cadre: $('#board'), feuille: $('#feuille'), px: PX, loupe: $('#loupe'), mention: $('#grossi'),
    // Les jetons occupent le bord gauche de la table tant qu'elle est assez large.
    marge: function () {
      var wide = $('#board').clientWidth > 620;
      return { l: wide ? 104 : 8, t: wide ? 10 : 44, r: wide ? 14 : 8, b: wide ? 10 : 84 };
    },
    // Maj + glisser, clic milieu, ou glisser depuis un endroit où il n'y a rien à désigner.
    glisse: function (e) { return e.button === 0 && (e.shiftKey || !nearest(S.slots, view.point(e), 20)); },
    clic: function () { act(null); render(); }
  });

  // ---------- Signes ----------
  // Chaque signe tient dans un carré de 20 centré sur l'origine : des traits [tracé, remplissage, encre, épaisseur].
  // Les assaillants regardent vers la droite : on les tourne dans le sens de leur marche.
  var SIGNS = {
    archer: [['M-4 -9Q9 0 -4 9', '', INK, 1.9], ['M-4 -9L-4 9', '', INK, 0.8], ['M-9 0L9 0M5.5 -2.6L9 0L5.5 2.6', '', INK, 1.3]],
    baliste: [['M-9 -1Q0 -10 9 -1', '', INK, 1.9], ['M-9 -1L0 4L9 -1', '', INK, 0.8], ['M0 -7L0 9M-4 9L4 9', '', INK, 2.2]],
    trebuchet: [['M-7 9L-1 -1L5 9M-9 9L8 9', '', INK, 1.5], ['M-9 -9L5 2', '', INK, 1.9], ['M2.5 2H8.5V8H2.5Z', INK, INK, 0.6], ['M-9 -9Q-10.5 -3 -7 -1', '', INK, 0.8]],
    poix: [['M-7 -2Q-7 8 0 8Q7 8 7 -2Z', INK, INK, 0.8], ['M-9 -2L9 -2', '', INK, 1.7], ['M-5.5 -2Q0 -11.5 5.5 -2', '', INK, 1]],
    pieux: [['M-8 8L-4 -8M-2 8L2 -8M4 8L8 -8', '', INK, 1.9], ['M-10 8L10 8', '', INK, 1]],
    p: [['M4.5 0A4.5 4.5 0 1 1 -4.5 0A4.5 4.5 0 1 1 4.5 0Z', BLOOD, GORE, 1.2], ['M2 -4L10 -4', '', GORE, 1.1]],
    c: [['M10 0L-6 6.5L-2.5 0L-6 -6.5Z', '#cf4a30', GORE, 1.3]],
    b: [['M-6 -6H5V6H-6Z', '#8a2a19', GORE, 1.2], ['M6.5 -7.5V7.5', '', GORE, 2.6]],
    e: [['M-9 -4.5H9V4.5H-9Z', GROUND, '', 0], ['M-9 -4.5H9M-9 4.5H9M-5.5 -4.5V4.5M-1.8 -4.5V4.5M1.8 -4.5V4.5M5.5 -4.5V4.5', '', BLOOD, 1.6]],
    B: [['M-10 -8.5H-5M5 -8.5H10M-10 8.5H-5M5 8.5H10', '', GORE, 2.6], ['M-13 -6.5H11V6.5H-13Z', '#a33a22', GORE, 1.6], ['M-13 0H11', '', GORE, 0.8], ['M11 0H19', '', GORE, 3], ['M19 -2.8V2.8', '', GORE, 3.6]]
  };
  Object.keys(SIGNS).forEach(function (id) {
    SIGNS[id].forEach(function (s) { s[4] = new Path2D(s[0]); });
  });
  function sign(id) {
    SIGNS[id].forEach(function (s) {
      if (s[1]) { ctx.fillStyle = s[1]; ctx.fill(s[4]); }
      if (s[2]) { ctx.strokeStyle = s[2]; ctx.lineWidth = s[3]; ctx.stroke(s[4]); }
    });
  }
  // Le même signe pour la légende, hors du plan.
  function signSvg(id) {
    return '<svg class="signe" viewBox="' + (id === 'B' ? '-15 -11 37 22' : '-11 -11 22 22') + '" aria-hidden="true">' + SIGNS[id].map(function (s) {
      return '<path d="' + s[0] + '" fill="' + (s[1] || 'none') + '" stroke="' + (s[2] || 'none') + '" stroke-width="' + s[3] + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }).join('') + '</svg>';
  }

  // ---------- Dessin ----------
  function ring(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function ink(fill, stroke, width) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 1; ctx.stroke(); }
  }
  function text(s, x, y, size, style, fill, halo) {
    ctx.font = (style || '') + ' ' + size + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    if (halo) { ctx.strokeStyle = halo; ctx.lineWidth = 4; ctx.strokeText(s, x, y); }
    ctx.fillStyle = fill || INK;
    ctx.fillText(s, x, y);
  }
  // Une jauge tracée à l'encre : une réglette graduée au quart, noircie de ce qui reste.
  function gauge(x, y, w, h, part, color) {
    var i;
    part = Math.max(0, Math.min(1, part));
    ctx.fillStyle = GROUND; ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * part, h);
    ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.strokeRect(x - w / 2, y, w, h);
    ctx.beginPath();
    for (i = 1; i < 4; i++) { ctx.moveTo(x - w / 2 + w * i / 4, y + h); ctx.lineTo(x - w / 2 + w * i / 4, y + h + 2); }
    ctx.lineWidth = 0.7; ctx.stroke();
  }
  // L'épingle qui marque la défense désignée.
  function pin(x, y) {
    ring(x, y, 15.5); ink(null, INK, 1.8);
    ctx.beginPath(); ctx.moveTo(x + 7, y - 7.5); ctx.lineTo(x + 12.5, y - 14); ink(null, INK, 1.3);
    ring(x + 13.5, y - 15.5, 4.6); ink(PIN, INK, 1);
    ring(x + 12.2, y - 16.9, 1.3); ink('rgba(255, 255, 255, .6)');
  }

  // Portée à montrer : la défense sous le curseur, sinon celle qu'on s'apprête à poser, sinon la sélection.
  function zone() {
    var c = U.cur, t = c && c.tower, def;
    if (!t && c && U.pick && allowed(TOWER[U.pick], c)) return { x: c.x, y: c.y, r: TOWER[U.pick].range[0], near: TOWER[U.pick].near };
    if (!t) t = U.sel && U.sel.tower;
    if (!t) return null;
    def = t.def;
    return { x: t.x, y: t.y, r: def.range[t.lvl], near: def.near };
  }

  // Un emplacement libre : un rond pointillé ; lavé de jaune, comme un ouvrage projeté, quand la défense choisie peut s'y poser.
  function drawSlot(s) {
    var open = U.pick && !s.tower && allowed(TOWER[U.pick], s);
    if (s.tower || s.kind === 'porte') return;
    ctx.globalAlpha = U.pick && !open ? 0.35 : 1;
    ring(s.x, s.y, open ? 9 : 7);
    if (open) ink(WASH, INK, 1.3);
    else { ink('rgba(241, 229, 198, .8)'); ctx.setLineDash([2.2, 2]); ink(null, INK, 1.1); ctx.setLineDash([]); }
    if (s.kind !== 'tour') { ring(s.x, s.y, 1.6); ink(INK); }
    ctx.globalAlpha = 1;
  }

  function drawGate(fr) {
    var aimed = S.next && S.next.fronts.indexOf(fr.i) >= 0, open = U.pick === 'poix' && !fr.slot.tower;
    var inx = PX / 2 - fr.x, iny = PX / 2 - fr.y, l = Math.sqrt(inx * inx + iny * iny) || 1, far = 30 + Math.abs(inx / l) * 34, lx = fr.x + inx / l * far, ly = fr.y + iny / l * far;
    if (aimed) {
      ctx.setLineDash([5, 4]);
      ring(fr.x, fr.y, 19 + Math.sin(S.tick / 6) * 1.5); ink(null, BLOOD, 2.2);
      ctx.setLineDash([]);
    }
    if (open) { ring(fr.x, fr.y, 14); ink(WASH, INK, 1.7); }
    if (fr.down) {
      ctx.beginPath();
      ctx.moveTo(fr.x - 9, fr.y - 9); ctx.lineTo(fr.x + 9, fr.y + 9); ctx.moveTo(fr.x + 9, fr.y - 9); ctx.lineTo(fr.x - 9, fr.y + 9);
      ink(null, BLOOD, 3.5);
    }
    text(fr.name.replace('Porte ', 'P. '), lx, ly - 7, 13, 'italic bold', fr.down ? BLOOD : INK, GROUND);
    gauge(lx, ly + 2, 44, 5, fr.hp / fr.max, fr.hp * 3 < fr.max ? BLOOD : INK);
    if (U.sel === fr.slot) pin(fr.x, fr.y);
  }

  function drawTower(t) {
    var def = t.def, i, part;
    ring(t.x, t.y, 13); ink(GROUND, INK, 1.5);
    ring(t.x, t.y, 11.2); ink(null, INK, 0.45);
    ctx.save();
    ctx.translate(t.x, t.y); ctx.scale(0.86, 0.86);
    sign(def.id);
    ctx.restore();
    for (i = 0; i <= t.lvl; i++) { ring(t.x - 6 * t.lvl / 2 + i * 6, t.y + 17.5, 2); ink(INK, GROUND, 0.8); }
    if (def.guard && t.slot.kind === 'route') {
      part = 1 - t.wear / def.guard[t.lvl];
      gauge(t.x, t.y - 20, 22, 3.5, part, part < 0.34 ? BLOOD : INK);
    }
    if (U.sel === t.slot && t.slot.kind !== 'porte') pin(t.x, t.y);
  }

  function drawFoe(f) {
    var ch = f.ch, w;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(Math.atan2(f.uy, f.ux));
    ctx.scale(1.25, 1.25);
    sign(ch);
    ctx.restore();
    if (f.slowT > 0) { ctx.setLineDash([2, 2]); ring(f.x, f.y, ch === 'B' ? 20 : 11); ink(null, '#2f5f8a', 1.2); ctx.setLineDash([]); }
    if (f.hp < f.max) {
      w = ch === 'B' ? 28 : 14;
      ctx.beginPath(); ctx.moveTo(f.x - w / 2, f.y - 14); ctx.lineTo(f.x + w / 2, f.y - 14); ink(null, GROUND, 4);
      ctx.beginPath(); ctx.moveTo(f.x - w / 2, f.y - 14); ctx.lineTo(f.x + w / 2, f.y - 14); ink(null, INK, 0.7);
      ctx.beginPath(); ctx.moveTo(f.x - w / 2, f.y - 14); ctx.lineTo(f.x - w / 2 + w * Math.max(0, f.hp / f.max), f.y - 14); ink(null, GORE, 2.6);
    }
  }

  // Fanion planté au bord du plan : d'où viendra la prochaine vague.
  function drawOmen(fr, n) {
    var p = along(fr.road, 30), beat = 1 + Math.sin(S.tick / 6) * 0.06;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(beat, beat);
    ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(0, -27); ink(null, GROUND, 4.5);
    ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(0, -27); ink(null, INK, 1.7);
    ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(25, -24); ctx.lineTo(18, -18); ctx.lineTo(25, -12); ctx.lineTo(0, -9); ctx.closePath(); ink(BLOOD, GORE, 1.3);
    ring(0, 7, 2.2); ink(INK);
    text(String(n), 9, -17.5, 13, 'bold', GROUND);
    ctx.restore();
  }

  function burst(x, y, r, n) {
    var i, a;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      a = i / n * Math.PI * 2 + 0.3;
      ctx.moveTo(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  }

  function draw() {
    var z = zone(), i, s, e, k;
    view.ajuste(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    view.repere(ctx);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // La route que prendra la prochaine vague, pointée à l'encre rouge.
    if (S.next) {
      S.next.fronts.forEach(function (g) {
        var pts = S.fronts[g].road.pts;
        ctx.beginPath();
        pts.forEach(function (p, n) { if (n) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        ctx.setLineDash([2.5, 8]); ink(null, 'rgba(179, 52, 31, .8)', 2.6); ctx.setLineDash([]);
      });
    }
    ring(S.plaza.x, S.plaza.y, 13); ink(null, S.lives * 3 <= LIVES ? BLOOD : INK, 1.8);

    for (i = 0; i < S.slots.length; i++) drawSlot(S.slots[i]);
    S.fronts.forEach(drawGate);
    for (i = 0; i < S.towers.length; i++) drawTower(S.towers[i]);
    for (i = 0; i < S.foes.length; i++) if (!S.foes[i].def.ram) drawFoe(S.foes[i]);
    for (i = 0; i < S.foes.length; i++) if (S.foes[i].def.ram) drawFoe(S.foes[i]);

    for (i = 0; i < S.shots.length; i++) {
      s = S.shots[i];
      if (s.kind === 'stone') {
        k = Math.sin(Math.PI * s.t / s.T);
        ring(s.x, s.y, 2.5); ink('rgba(61, 47, 33, .3)');
        ring(s.x, s.y - k * 26, 3.5 + k * 2); ink('#6b5a4a', INK, 1.2);
      } else if (s.ux !== undefined) {
        ctx.beginPath(); ctx.moveTo(s.x - s.ux * 9, s.y - s.uy * 9); ctx.lineTo(s.x, s.y); ink(null, INK, 1.5);
      }
    }
    for (i = 0; i < S.fx.length; i++) {
      e = S.fx[i]; k = Math.max(0, e.t / e.T);
      if (e.kind === 'bolt') {
        ctx.globalAlpha = k;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ink(null, INK, 2.2);
      } else if (e.kind === 'poix') {
        ctx.globalAlpha = k * 0.5;
        ring(e.x, e.y, e.r); ink('#3a2a1c');
      } else {
        ctx.globalAlpha = k;
        ring(e.x, e.y, e.r * (0.9 - k * 0.4)); ink('rgba(107, 90, 71, .28)');
        burst(e.x, e.y, e.r * (1.15 - k * 0.5), 9); ink(null, INK, 1.6);
      }
      ctx.globalAlpha = 1;
    }

    if (z) {
      ring(z.x, z.y, z.r); ink('rgba(61, 47, 33, .07)');
      ctx.setLineDash([7, 5]); ink(null, INK, 1.4);
      if (z.near) { ring(z.x, z.y, z.near); ink(null, BLOOD, 1.2); }
      ctx.setLineDash([]);
    }
    if (U.cur) { ring(U.cur.x, U.cur.y, U.cur.kind === 'porte' ? 16.5 : 14.5); ink(null, GROUND, 3.4); ink(null, INK, 1.1); }
    if (S.next && !S.over) S.next.fronts.forEach(function (g) { drawOmen(S.fronts[g], S.next.n); });
  }

  // ---------- Affichage ----------
  var shown = {};

  // N'écrit dans la page que ce qui a changé : un bouton recréé sous le curseur perdrait son clic.
  function put(sel, html) {
    if (shown[sel] === html) return;
    shown[sel] = html;
    $(sel).innerHTML = html;
  }

  // Les défenses à poser : des jetons sur le bord de la table.
  function shopView() {
    return TOWERS.map(function (def, i) {
      return '<button type="button" class="jeton' + (U.pick === def.id ? ' on' : '') + (S.gold < def.cost[0] ? ' poor' : '') + '" data-act="pick" data-i="' + i + '" aria-pressed="' + (U.pick === def.id) + '">' +
        '<span class="key">' + (i + 1) + '</span>' + signSvg(def.id) + '<span class="nom">' + esc(def.name) + '</span><span class="price">' + def.cost[0] + ' or</span></button>';
    }).join('');
  }

  function gateView(fr) {
    var cost = herseCost(fr);
    return '<p><b>' + esc(fr.name) + '</b>, ' + (fr.down ? '<span class="bad">tombée</span>' : Math.ceil(fr.hp) + ' PV sur ' + fr.max) + (fr.lvl ? ', herse ' + fr.lvl + '/' + HERSE.length : '') + '.</p>' +
      '<div class="mentions">' +
      (fr.down ? '<button type="button" class="mention" data-act="rebuild"' + (S.gold >= REBUILD.cost && !besieged(fr) ? '' : ' disabled') + '>Relever (R), ' + REBUILD.cost + ' or</button>'
        : '<button type="button" class="mention" data-act="repair"' + (S.gold >= REPAIR.cost && fr.hp < fr.max ? '' : ' disabled') + '>Réparer (R), ' + REPAIR.cost + ' or</button>') +
      '<button type="button" class="mention" data-act="herse"' + (cost && S.gold >= cost ? '' : ' disabled') + '>' + (cost ? 'Herse (H), ' + cost + ' or' : 'Herse doublée') + '</button></div>';
  }
  function towerView(t) {
    var def = t.def, cost = upgradeCost(t);
    return '<p><b>' + esc(def.name) + ', niveau ' + (t.lvl + 1) + ' sur 3.</b> ' + esc(stats(def, t.lvl)) + '.' +
      (def.guard && t.slot.kind === 'route' ? ' Tient encore ' + (def.guard[t.lvl] - t.wear) + ' passages.' : '') + '</p>' +
      (cost ? '<p><i>Au niveau ' + (t.lvl + 2) + ' : ' + esc(stats(def, t.lvl + 1).toLowerCase()) + '.</i></p>' : '') +
      '<div class="mentions">' +
      '<button type="button" class="mention" data-act="up"' + (cost && S.gold >= cost ? '' : ' disabled') + '>' + (cost ? 'Améliorer (A), ' + cost + ' or' : 'Niveau maximal') + '</button>' +
      '<button type="button" class="mention" data-act="sell">Vendre (X), +' + resale(t) + ' or</button></div>';
  }
  function infoView() {
    var s = U.sel, def, out = [];
    if (s) {
      if (s.kind === 'porte') out.push(gateView(S.fronts[s.front]));
      if (s.tower) out.push(towerView(s.tower));
      else if (s.kind === 'porte') out.push('<p><i>Choisis la poix (4) puis clique la porte pour en garnir le châtelet.</i></p>');
      return out.join('');
    }
    if (U.pick) {
      def = TOWER[U.pick];
      return '<p><b>' + esc(def.name) + ', ' + def.cost[0] + ' or.</b> ' + esc(def.desc) + ' ' + esc(stats(def, 0)) + '.</p><p><i>Se pose ' + esc(where(def)) + ' : clique un emplacement lavé de jaune. Échap pour annuler.</i></p>';
    }
    return '<p>Prends un jeton (1 à 5), puis clique un emplacement du plan. Clique une défense posée pour l\'améliorer ou la vendre, une porte pour la réparer.</p>';
  }

  // L'état des portes : une ligne par porte, sa jauge tracée à l'encre.
  function gatesView() {
    return S.fronts.map(function (fr) {
      var aimed = S.next && S.next.fronts.indexOf(fr.i) >= 0, low = fr.hp * 3 < fr.max;
      return '<button type="button" class="porte' + (U.sel === fr.slot ? ' on' : '') + (aimed ? ' aimed' : '') + (fr.down ? ' down' : '') + '" data-act="gate" data-i="' + fr.i + '">' +
        '<span class="nom">' + esc(fr.name) + '</span><span class="jauge' + (low ? ' bas' : '') + '"><i style="width:' + Math.round(fr.hp / fr.max * 100) + '%"></i></span>' +
        '<span class="hp' + (fr.down ? ' bad' : '') + '">' + (fr.down ? 'tombée' : Math.ceil(fr.hp) + '/' + fr.max) + '</span></button>';
    }).join('');
  }

  function musterView(w, front) {
    return w.groups.filter(function (g) { return g.front === front; }).map(function (g) {
      return '<span class="pion">' + signSvg(g.ch) + g.count + ' ' + esc(FOES[g.ch].name.toLowerCase()) + '</span>';
    }).join('');
  }
  function waveView() {
    var w = S.next, head;
    if (!w) return '<p><b>C\'est le dernier assaut.</b> Tiens bon.</p>';
    if (!S.wave) head = 'Vague 1 : quand tu veux.';
    else if (S.queue.length) head = 'Vague ' + w.n + ' : après celle-ci.';
    else head = 'Vague ' + w.n + ' dans ' + Math.ceil(S.timer) + ' s.';
    return '<p><b>' + head + '</b>' + (w.n === WAVES ? ' <i>Assaut général.</i>' : '') + '</p>' + w.fronts.map(function (g) {
      return '<div class="front"><span class="aim">' + esc(S.fronts[g].name) + '</span>' + (w.fronts.length > 1 && w.n < WAVES ? g === w.main ? ' <i>assaut</i>' : ' <i>diversion</i>' : '') + '<div class="troupe">' + musterView(w, g) + '</div></div>';
    }).join('');
  }

  function hintView() {
    var s = U.cur, f = U.foe, t;
    if (f && !f.gone) return f.def.name + ', ' + Math.ceil(f.hp) + ' PV sur ' + f.max + ' : ' + f.def.tag + '.';
    if (!s) return '';
    t = s.tower;
    if (t) return (s.kind === 'porte' ? S.fronts[s.front].name + ' : ' : '') + t.def.name + ' niveau ' + (t.lvl + 1) + ', ' + stats(t.def, t.lvl).toLowerCase() + '.';
    if (s.kind === 'porte') return S.fronts[s.front].name + ', ' + (S.fronts[s.front].down ? 'tombée' : Math.ceil(S.fronts[s.front].hp) + ' PV sur ' + S.fronts[s.front].max) + ' : clique pour la réparer, la herser ou y verser la poix.';
    if (U.pick) return KINDS[s.kind] + ' : ' + (allowed(TOWER[U.pick], s) ? TOWER[U.pick].name + ' pour ' + TOWER[U.pick].cost[0] + ' or.' : TOWER[U.pick].name.toLowerCase() + ' impossible ici.');
    return KINDS[s.kind] + ' : emplacement libre.';
  }

  // La dépêche qui clôt le siège.
  function modalView() {
    var won = S.over === 'won', up = S.fronts.filter(function (fr) { return !fr.down; }).length;
    return '<div class="depeche" role="dialog" aria-modal="true"><h2>' + (won ? 'Victoire' : 'Défaite') + '</h2><p>' +
      (won ? esc(S.name) + ' tient : les ' + WAVES + ' vagues sont repoussées, ' + up + ' porte' + (up > 1 ? 's' : '') + ' sur ' + S.fronts.length + ' encore debout.' : 'La place ' + elide(S.name) + esc(S.name) + ' tombe à la vague ' + S.wave + '.') +
      '</p><ul class="ecritures"><li>Assaillants abattus<b>' + S.kills + '</b></li><li>Score<b>' + S.score + '</b></li><li>' + (S.record ? 'Nouveau record pour cette ville' : 'Record de cette ville') + '<b>' + S.best + '</b></li></ul>' +
      '<div class="mentions">' +
      '<button type="button" class="mention" data-act="retry">Revanche</button>' +
      '<button type="button" class="mention" data-act="random">Autre ville</button>' +
      '<a class="mention" href="' + esc($('#toPlan').getAttribute('href')) + '">Retour au plan</a></div></div>';
  }

  function render() {
    if (U.sel && !U.sel.tower && U.sel.kind !== 'porte') U.sel = null;
    put('#lives', String(Math.max(0, S.lives)));
    put('#gold', String(S.gold));
    put('#waveNo', String(S.wave));
    put('#score', String(S.score));
    put('#best', String(Math.max(S.best, S.score)));
    put('#hint', esc(hintView()));
    put('#msg', esc(S.msg));
    put('#shop', shopView());
    put('#info', infoView());
    put('#gates', gatesView());
    put('#wave', waveView());
    put('#ctl',
      '<button type="button" class="sceau" data-act="next"' + (canCall() ? '' : ' disabled') + '><span>Lancer<br>la vague</span><small>N</small></button>' +
      '<div class="allure"><button type="button" class="mention' + (U.paused ? ' on' : '') + '" data-act="pause">' + (U.paused ? 'Reprendre' : 'Pause') + ' (Espace)</button>' +
      '<span class="choix">Allure (V) ' + [1, 2, 3].map(function (n) {
        return '<button type="button"' + (U.speed === n ? ' class="on"' : '') + ' data-act="speed" data-i="' + n + '" aria-pressed="' + (U.speed === n) + '">×' + n + '</button>';
      }).join('') + '</span></div>');
    put('#modal', S.over ? modalView() : '');
    $('#modal').hidden = !S.over;
    draw();
  }

  function frame(now) {
    var dt = Math.min(0.25, (now - U.last) / 1000);
    U.last = now;
    if (!U.paused && !S.over) {
      U.acc += dt * U.speed;
      while (U.acc >= DT) { tick(); U.acc -= DT; }
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Commandes ----------
  function addressOf(seed, size, from) { return encodeURIComponent(seed) + '/' + size + (from ? '?' + from.query : ''); }

  // La cité d'origine (atlas) reste attachée à la ville tant que la graine ne change pas.
  function start(seed, size) {
    var from;
    seed = seed || Math.random().toString(36).slice(2, 8);
    size = SIZES[size] ? size : 'ville';
    from = U.link && U.link.seed === seed ? U.link : null;
    newGame(seed, size, from);
    U.pick = null; U.sel = null; U.cur = null; U.foe = null; U.paused = false; U.acc = 0;
    U.address = addressOf(seed, size, from);
    $('#seed').value = seed;
    $('#size').value = size;
    $('#plan').innerHTML = S.city.svg;
    $('#lead').textContent = 'Journal du siège ' + elide(S.name).trim();
    $('#city').textContent = S.name;
    $('#caption').textContent = S.city.size.charAt(0).toUpperCase() + S.city.size.slice(1) + (S.city.people ? ' des ' + S.city.people : '') + ', ' + S.fronts.length + ' portes à tenir contre ' + WAVES + ' vagues.';
    $('#waves').textContent = 'sur ' + WAVES;
    document.title = 'Siège ' + elide(S.name) + S.name;
    $('#toPlan').href = '../plans-de-ville/index.html#' + U.address;
    try { history.replaceState(null, '', '#' + U.address); } catch (e) { location.replace('#' + U.address); }   // Chrome refuse replaceState en file://
    view.entier();
  }
  function readAddress() {
    var a = window.PlanVille.parse(location.hash.slice(1));
    U.link = a.from;
    return a;
  }

  function choose(id) {
    U.pick = U.pick === id ? null : id;
    U.sel = null;
  }
  function act(s) {
    if (!s) { U.sel = null; return; }
    if (U.pick && !s.tower && allowed(TOWER[U.pick], s)) { build(U.pick, s); return; }
    if (s.tower || s.kind === 'porte') { U.sel = s; U.pick = null; }
    else if (U.pick) build(U.pick, s);
    else { U.sel = null; say('Emplacement libre : choisis d\'abord une défense (1 à 5).'); }
  }
  function gateSel() { return U.sel && U.sel.kind === 'porte' ? S.fronts[U.sel.front] : null; }
  function sellSel() {
    if (U.sel && U.sel.tower && sell(U.sel.tower) && U.sel.kind !== 'porte') U.sel = null;
  }
  function mend() {
    var fr = gateSel();
    if (fr) { if (fr.down) rebuild(fr); else repair(fr); }
  }
  function cycleSpeed() { U.speed = U.speed % 3 + 1; }

  function nearest(list, p, max) {
    var best = null, top = max, i, d;
    for (i = 0; i < list.length; i++) {
      d = dist(list[i], p);
      if (d < top) { top = d; best = list[i]; }
    }
    return best;
  }
  function hover(e) {
    var p = view.point(e);
    U.cur = nearest(S.slots, p, 20);
    U.foe = U.cur ? null : nearest(S.foes, p, 14);
    canvas.style.cursor = U.cur ? 'pointer' : '';
  }
  // Au clavier, la flèche mène à l'emplacement le plus proche dans cette direction.
  function step(dx, dy) {
    var c = U.cur || S.fronts[0].slot, best = null, top = Infinity;
    S.slots.forEach(function (s) {
      var fwd = (s.x - c.x) * dx + (s.y - c.y) * dy, side = Math.abs((s.x - c.x) * dy - (s.y - c.y) * dx), v = fwd + side * 2.5;
      if (s !== c && fwd > 1 && v < top) { top = v; best = s; }
    });
    U.cur = U.cur ? best || c : c;
    U.foe = null;
  }

  canvas.addEventListener('pointermove', hover);
  canvas.addEventListener('pointerleave', function () { U.cur = null; U.foe = null; });
  canvas.addEventListener('pointerdown', function (e) {
    if (e.button) return;
    hover(e);
    act(U.cur);
    render();
  });
  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    U.pick = null; U.sel = null;
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), i;
    if (!b) return;
    i = +b.dataset.i;
    switch (b.dataset.act) {
      case 'pick': choose(TOWERS[i].id); break;
      case 'gate': U.sel = S.fronts[i].slot; U.pick = null; break;
      case 'up': if (U.sel && U.sel.tower) upgrade(U.sel.tower); break;
      case 'sell': sellSel(); break;
      case 'repair': case 'rebuild': mend(); break;
      case 'herse': if (gateSel()) reinforce(gateSel()); break;
      case 'next': callWave(); break;
      case 'pause': U.paused = !U.paused; break;
      case 'speed': U.speed = i; break;
      case 'retry': start(S.seed, S.size); break;
      case 'random': U.link = null; start('', S.size); break;
    }
    // Un bouton cliqué à la souris ne doit pas garder le focus, sinon Espace le réactiverait au lieu de mettre en pause.
    if (e.detail) b.blur();
    render();
  });

  var ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName, k = e.key.length === 1 ? e.key.toLowerCase() : e.key, n = parseInt(k, 10);
    if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'SELECT') return;
    if ((tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') && (k === 'Enter' || k === ' ')) return;
    if (S.over) return;
    if (n >= 1 && n <= TOWERS.length) choose(TOWERS[n - 1].id);
    else if (ARROWS[k]) step(ARROWS[k][0], ARROWS[k][1]);
    else if (k === 'Enter') { if (U.cur) act(U.cur); }
    else if (k === 'Escape') { U.pick = null; U.sel = null; }
    else if (k === ' ' || k === 'p') U.paused = !U.paused;
    else if (k === 'v') cycleSpeed();
    else if (k === 'n') callWave();
    else if (k === 'a') { if (U.sel && U.sel.tower) upgrade(U.sel.tower); }
    else if (k === 'x' || k === 'Delete') sellSel();
    else if (k === 'r') mend();
    else if (k === 'h') { if (gateSel()) reinforce(gateSel()); }
    else return;
    e.preventDefault();
    render();
  });

  $('#setup').addEventListener('submit', function (e) {
    e.preventDefault();
    start($('#seed').value.trim(), $('#size').value);
    $('#seed').blur();
    render();
  });
  $('#size').addEventListener('change', function () { start($('#seed').value.trim() || S.seed, $('#size').value); $('#size').blur(); render(); });
  $('#random').addEventListener('click', function () { U.link = null; start('', $('#size').value); render(); });

  window.addEventListener('hashchange', function () {
    var a;
    if (location.hash.slice(1) === U.address) return;
    a = readAddress();
    if (addressOf(a.seed, a.size, a.from) === U.address) return;
    start(a.seed, a.size);
    render();
  });

  window.Siege.render = render;
  window.Siege.view = view;

  (function () {
    var a = readAddress();
    start(a.seed, a.size);
  })();
  render();
  requestAnimationFrame(function (now) { U.last = now; frame(now); });
})();
