(function () {
  'use strict';

  var W = 56, H = 22;      // taille d'un étage, en cases
  var FLOORS = 3;
  var VIEW = 7;            // rayon de vision
  var WAKE = 6;            // distance à laquelle un ennemi te repère
  var MAX_HP = 40;
  var HAND = 5, ENERGY = 3, HAND_MAX = 10;
  var POTION_HEAL = 10, POTION_PRICE = 30;
  var REST_HEAL = 12;
  var BOX = 16;            // largeur intérieure d'une carte, en caractères

  var STATUS = { vuln: 'Vulnérable', weak: 'Faible', poison: 'Poison', force: 'Force' };
  var KEYS = {
    ArrowUp: [0, -1], z: [0, -1], w: [0, -1],
    ArrowDown: [0, 1], s: [0, 1],
    ArrowLeft: [-1, 0], q: [-1, 0], a: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0]
  };

  // Types : att (attaque), tec (technique), pou (pouvoir).
  var CARDS = {
    frappe:   { name: 'Frappe', cost: 1, type: 'att', desc: '6 dégâts.', play: function () { hit(6); } },
    parade:   { name: 'Parade', cost: 1, type: 'tec', desc: '5 armure.', play: function () { armor(5); } },
    feinte:   { name: 'Feinte', cost: 0, type: 'att', desc: '3 dégâts. Pioche 1 carte.', play: function () { hit(3); draw(1); } },
    taillade: { name: 'Taillade', cost: 1, type: 'att', desc: '9 dégâts.', play: function () { hit(9); } },
    lourd:    { name: 'Coup lourd', cost: 2, type: 'att', desc: '17 dégâts.', play: function () { hit(17); } },
    double:   { name: 'Double frappe', cost: 1, type: 'att', desc: '4 dégâts, deux fois.', play: function () { hit(4); hit(4); } },
    entaille: { name: 'Entaille', cost: 1, type: 'att', desc: '5 dégâts. Vulnérable 2.', play: function () { hit(5); curse('vuln', 2); } },
    croc:     { name: 'Croc-en-jambe', cost: 1, type: 'att', desc: '4 dégâts. Faible 2.', play: function () { hit(4); curse('weak', 2); } },
    grace:    { name: 'Coup de grâce', cost: 1, type: 'att', desc: '7 dégâts. Double sous la moitié des PV ennemis.', play: function () { hit(C.foe.hp * 2 <= C.foe.max ? 14 : 7); } },
    ecu:      { name: 'Coup d\'écu', cost: 1, type: 'att', desc: 'Dégâts égaux à ton armure.', play: function () { hit(S.me.block); } },
    venin:    { name: 'Venin', cost: 1, type: 'tec', desc: 'Poison 5.', play: function () { curse('poison', 5); } },
    rempart:  { name: 'Rempart', cost: 2, type: 'tec', desc: '12 armure.', play: function () { armor(12); } },
    riposte:  { name: 'Riposte', cost: 1, type: 'tec', desc: '5 armure. 4 dégâts.', play: function () { armor(5); hit(4); } },
    garde:    { name: 'Garde haute', cost: 1, type: 'tec', desc: '7 armure. Faible 1.', play: function () { armor(7); curse('weak', 1); } },
    tactique: { name: 'Tactique', cost: 1, type: 'tec', desc: 'Pioche 3 cartes.', play: function () { draw(3); } },
    souffle:  { name: 'Second souffle', cost: 0, type: 'tec', desc: '+2 énergie. Épuisée.', exhaust: true, play: function () { C.energy += 2; } },
    bandage:  { name: 'Bandage', cost: 1, type: 'tec', desc: 'Soigne 6 PV. Épuisée.', exhaust: true, play: function () { heal(6); } },
    rage:     { name: 'Rage', cost: 1, type: 'pou', desc: 'Force +2. Épuisée.', exhaust: true, play: function () { S.me.st.force = (S.me.st.force || 0) + 2; } }
  };
  var START = ['frappe', 'frappe', 'frappe', 'frappe', 'parade', 'parade', 'parade', 'parade', 'feinte'];
  var POOL = Object.keys(CARDS).filter(function (id) { return id !== 'frappe' && id !== 'parade'; });

  // Un ennemi enchaîne ses coups dans l'ordre, en boucle.
  // Un coup combine : att (dégâts), times (répétitions), def (armure), force, give (états infligés).
  var FOES = {
    r: { name: 'Rat', the: 'le rat', face: '<:3 )~~', hp: 14, gold: 8, moves: [{ att: 5 }, { att: 5 }, { att: 7 }] },
    c: { name: 'Chauve-souris', the: 'la chauve-souris', face: '^v(oo)v^', hp: 12, gold: 8, moves: [{ att: 3, times: 2 }, { att: 3, times: 2 }, { give: { weak: 2 } }] },
    g: { name: 'Gobelin', the: 'le gobelin', face: '>(o_o)<', hp: 19, gold: 10, moves: [{ att: 6 }, { def: 6, att: 3 }, { att: 8 }] },
    s: { name: 'Squelette', the: 'le squelette', face: '[x_x]', hp: 30, gold: 13, moves: [{ att: 9 }, { def: 8 }, { att: 12 }] },
    a: { name: 'Araignée', the: 'l\'araignée', face: '/\\(oo)/\\', hp: 24, gold: 13, moves: [{ give: { poison: 3 } }, { att: 6 }, { att: 7 }] },
    o: { name: 'Orque', the: 'l\'orque', face: '(>_<)#', hp: 36, gold: 16, moves: [{ force: 2 }, { att: 9 }, { att: 9 }] },
    n: { name: 'Nécromancien', the: 'le nécromancien', face: '{-_-}~*', hp: 40, gold: 18, moves: [{ give: { vuln: 2 } }, { att: 11 }, { att: 6, times: 2 }] },
    t: { name: 'Troll', the: 'le troll', face: '[O___O]', hp: 52, gold: 20, moves: [{ att: 14 }, { def: 10 }, { att: 9, give: { weak: 2 } }] },
    D: { name: 'Dragon', the: 'le dragon', face: '<(O=O)>~~^^', hp: 130, gold: 50, moves: [{ att: 13 }, { att: 6, times: 3 }, { force: 3, def: 14 }, { att: 18 }, { give: { vuln: 2, weak: 2 } }] }
  };
  var SPAWNS = [['r', 'r', 'c', 'g'], ['g', 's', 'a', 'o'], ['s', 'o', 'n', 't']];

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
  function pick(arr) { return arr[int(0, arr.length - 1)]; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = int(0, i), t = arr[i];
      arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function sample(arr, n) { return shuffle(arr.slice()).slice(0, n); }

  // ---------- État ----------
  // S : la partie. C : le combat en cours. modal : la fenêtre de choix ouverte. vis : cases visibles.
  var S, C = null, modal = null, vis = [];
  var link = null;   // la ville dont on explore les catacombes, tant qu'on ne change pas de graine

  function of(name) { return (/^[aeiouyàâäéèêëîïôöûü]/i.test(name) ? 'd\'' : 'de ') + name; }

  function newRun(seed) {
    seed = seed || Math.random().toString(36).slice(2, 8);
    var from = link && link.seed === seed ? link : null;
    seedRng(seed);
    S = {
      seed: seed, city: from ? from.name : '', floor: 0, gold: 0, potions: 1, kills: 0, start: Date.now(), over: false, log: [],
      me: { hp: MAX_HP, max: MAX_HP, block: 0, st: {} },
      deck: START.slice()
    };
    C = null; modal = null;
    $('#seed').value = seed;
    $('#back').hidden = !from;
    if (from) { $('#back').href = '../plans-de-ville/index.html#' + from.plan; $('#back').textContent = 'Plan ' + of(from.name); }
    try { history.replaceState(null, '', '#' + encodeURIComponent(seed) + (from ? '?' + from.query : '')); } catch (e) { location.replace('#' + encodeURIComponent(seed) + (from ? '?' + from.query : '')); }   // Chrome refuse replaceState en file://
    say(from ? 'Tu descends dans les catacombes ' + of(from.name) + '. Un dragon dort au troisième étage.' : 'Tu entres dans le donjon. Le dragon dort au troisième étage.');
    descend();
  }

  function say(text) {
    S.log.push(text);
    if (S.log.length > 40) S.log.shift();
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function heal(n) { S.me.hp = Math.min(S.me.max, S.me.hp + n); }

  // ---------- Donjon ----------
  function mid(r) { return { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }; }
  function foeAt(x, y) {
    for (var i = 0; i < S.foes.length; i++) if (S.foes[i].x === x && S.foes[i].y === y) return S.foes[i];
    return null;
  }
  function itemAt(x, y) {
    for (var i = 0; i < S.items.length; i++) if (S.items[i].x === x && S.items[i].y === y) return S.items[i];
    return null;
  }
  function drop(it) { S.items.splice(S.items.indexOf(it), 1); }

  function tunnel(map, a, b) {
    var x = a.x, y = a.y;
    function across() { while (x !== b.x) { map[y][x] = '.'; x += x < b.x ? 1 : -1; } }
    function down() { while (y !== b.y) { map[y][x] = '.'; y += y < b.y ? 1 : -1; } }
    if (rng() < 0.5) { across(); down(); } else { down(); across(); }
    map[y][x] = '.';
  }

  function dig() {
    var map, rooms, r, x, y, i;
    do {
      map = []; rooms = [];
      for (y = 0; y < H; y++) { map.push([]); for (x = 0; x < W; x++) map[y].push('#'); }
      for (i = 0; i < 80 && rooms.length < 9; i++) {
        r = { w: int(5, 11), h: int(3, 6) };
        r.x = int(1, W - r.w - 1); r.y = int(1, H - r.h - 1);
        if (!rooms.some(function (o) { return r.x <= o.x + o.w && o.x <= r.x + r.w && r.y <= o.y + o.h && o.y <= r.y + r.h; })) rooms.push(r);
      }
    } while (rooms.length < 6);

    // Salles reliées de gauche à droite : on entre à l'ouest, la sortie est à l'est.
    rooms.sort(function (a, b) { return a.x - b.x; });
    rooms.forEach(function (room, n) {
      for (y = room.y; y < room.y + room.h; y++) for (x = room.x; x < room.x + room.w; x++) map[y][x] = '.';
      if (n) tunnel(map, mid(rooms[n - 1]), mid(room));
    });
    tunnel(map, mid(pick(rooms)), mid(pick(rooms)));

    var start = mid(rooms[0]), end = mid(rooms[rooms.length - 1]);
    S.map = map; S.seen = []; S.foes = []; S.items = [];
    S.x = start.x; S.y = start.y;

    function spot() {
      for (;;) {
        var room = rooms[int(1, rooms.length - 1)];
        var p = { x: int(room.x, room.x + room.w - 1), y: int(room.y, room.y + room.h - 1) };
        if (!foeAt(p.x, p.y) && !itemAt(p.x, p.y)) return p;
      }
    }
    function put(ch, kind, extra) {
      var it = Object.assign(spot(), { ch: ch, kind: kind }, extra);
      S.items.push(it);
    }

    var last = S.floor === FLOORS;
    if (last) S.foes.push({ x: end.x, y: end.y, ch: 'D', boss: true });
    else S.items.push({ x: end.x, y: end.y, ch: '>', kind: 'exit' });

    for (i = 0; i < (last ? 4 : 5); i++) S.foes.push(Object.assign(spot(), { ch: pick(SPAWNS[S.floor - 1]), awake: false }));
    for (i = 0; i < 3; i++) put('*', 'gold', { n: int(10, 20) });
    put('!', 'potion');
    put('?', 'altar', { offer: sample(POOL, 3) });
    put('&', 'camp');
    put('$', 'shop', { stock: sample(POOL, 3).map(function (id) { return { card: id, price: int(40, 60) }; }) });
  }

  function descend() {
    S.floor++;
    dig();
    look();
    if (S.floor > 1) say(S.floor === FLOORS ? 'Étage ' + S.floor + '. Une chaleur monte du fond de la galerie.' : 'Étage ' + S.floor + '. L\'air se fait plus lourd.');
  }

  function los(x0, y0, x1, y1) {
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy, e2;
    while (x0 !== x1 || y0 !== y1) {
      e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      if ((x0 !== x1 || y0 !== y1) && S.map[y0][x0] === '#') return false;
    }
    return true;
  }
  function look() {
    var x, y;
    vis = [];
    for (y = Math.max(0, S.y - VIEW); y <= Math.min(H - 1, S.y + VIEW); y++) {
      for (x = Math.max(0, S.x - VIEW); x <= Math.min(W - 1, S.x + VIEW); x++) {
        if ((x - S.x) * (x - S.x) + (y - S.y) * (y - S.y) <= VIEW * VIEW && los(S.x, S.y, x, y)) vis[y * W + x] = S.seen[y * W + x] = true;
      }
    }
  }

  function step(dx, dy) {
    var x = S.x + dx, y = S.y + dy, foe = foeAt(x, y), it;
    if (S.map[y][x] === '#') return;
    if (foe) { fight(foe, true); return; }
    S.x = x; S.y = y;
    it = itemAt(x, y);
    if (it && it.kind === 'exit') { descend(); return; }
    touch(it);
    if (modal) look(); else tick();
  }
  function tick() {
    moveFoes();
    look();
  }

  function moveFoes() {
    var list = S.foes.slice(), i, f, dx, dy, tries, t, x, y;
    for (i = 0; i < list.length; i++) {
      f = list[i];
      if (f.boss) continue;
      dx = S.x - f.x; dy = S.y - f.y;
      if (!f.awake) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= WAKE && los(f.x, f.y, S.x, S.y)) f.awake = true;
        continue;
      }
      if (rng() > 0.7) continue;
      tries = Math.abs(dx) >= Math.abs(dy) ? [[Math.sign(dx), 0], [0, Math.sign(dy)]] : [[0, Math.sign(dy)], [Math.sign(dx), 0]];
      for (t = 0; t < 2; t++) {
        x = f.x + tries[t][0]; y = f.y + tries[t][1];
        if ((x === f.x && y === f.y) || S.map[y][x] === '#' || foeAt(x, y)) continue;
        if (x === S.x && y === S.y) { fight(f, false); return; }
        f.x = x; f.y = y;
        break;
      }
    }
  }

  function touch(it) {
    if (!it) return;
    if (it.kind === 'gold') { S.gold += it.n; say('+' + it.n + ' or.'); drop(it); }
    else if (it.kind === 'potion') { S.potions++; say('Tu ramasses une potion.'); drop(it); }
    else if (it.kind === 'altar') altar(it);
    else if (it.kind === 'camp') camp(it);
    else if (it.kind === 'shop') shop(it);
  }

  function quaff() {
    if (!S.potions) { say('Tu n\'as plus de potion.'); return; }
    if (S.me.hp >= S.me.max) { say('Tu es en pleine forme : inutile de boire.'); return; }
    S.potions--;
    heal(POTION_HEAL);
    say('Tu bois une potion : +' + POTION_HEAL + ' PV.');
  }

  // ---------- Lieux ----------
  function gain(id) {
    S.deck.push(id);
    say(CARDS[id].name + ' rejoint ton deck.');
  }
  function altar(it) {
    ask('Autel', 'Trois cartes reposent sur la pierre. Tu ne peux en emporter qu\'une.', it.offer.map(function (id) {
      return { card: id, fn: function () { gain(id); drop(it); } };
    }), 'Plus tard');
  }
  function camp(it) {
    ask('Feu de camp', 'Les braises ne serviront qu\'une fois.', [
      { label: 'Se reposer', note: '+' + REST_HEAL + ' PV', fn: function () { heal(REST_HEAL); say('Tu te reposes près du feu.'); drop(it); } },
      { label: 'Oublier une carte', note: 'allège le deck', off: S.deck.length < 2, fn: function () { forget(it); } }
    ], 'Plus tard');
  }
  function forget(it) {
    ask('Oublier une carte', 'Elle quitte ton deck pour de bon.', S.deck.map(function (id, i) {
      return { card: id, fn: function () { S.deck.splice(i, 1); say('Tu oublies ' + CARDS[id].name + '.'); drop(it); } };
    }), 'Annuler');
  }
  function shop(it) {
    var opts = it.stock.map(function (s, i) {
      return { card: s.card, note: s.price + ' or', off: S.gold < s.price, fn: function () { S.gold -= s.price; it.stock.splice(i, 1); gain(s.card); shop(it); } };
    });
    opts.push({ label: 'Potion', note: POTION_PRICE + ' or', off: S.gold < POTION_PRICE, fn: function () { S.gold -= POTION_PRICE; S.potions++; say('Tu achètes une potion.'); shop(it); } });
    ask('Marchand', 'Tu as ' + S.gold + ' or.', opts, 'Partir');
  }
  function showDeck() {
    ask('Ton deck', S.deck.length + ' cartes.', S.deck.slice().sort().map(function (id) { return { card: id }; }), 'Fermer');
  }

  // ---------- Combat ----------
  function fight(f, first) {
    var def = FOES[f.ch];
    C = {
      foe: { ref: f, def: def, hp: def.hp, max: def.hp, block: 0, st: {}, turn: 0 },
      draw: shuffle(S.deck.slice()), hand: [], discard: [], energy: 0, fresh: {}
    };
    S.me.block = 0; S.me.st = {};
    if (f.boss) say('Le dragon ouvre un œil.');
    else if (first) { C.foe.st.vuln = 1; say('Tu surprends ' + def.the + '.'); }
    else { S.me.st.vuln = 1; say(cap(def.the) + ' te tombe dessus.'); }
    startTurn();
  }

  function dmg(base, from, to) {
    var n = base + (from.st.force || 0);
    if (from.st.weak) n *= 0.75;
    if (to.st.vuln) n *= 1.5;
    return Math.max(0, Math.floor(n));
  }
  // Renvoie les PV réellement perdus, armure déduite.
  function strike(base, from, to) {
    var n = dmg(base, from, to), blocked = Math.min(to.block, n);
    to.block -= blocked;
    to.hp -= n - blocked;
    return n - blocked;
  }
  function hit(n) { strike(n, S.me, C.foe); }
  function armor(n) { S.me.block += n; }
  function curse(st, n) { C.foe.st[st] = (C.foe.st[st] || 0) + n; }
  function draw(n) {
    while (n-- > 0 && C.hand.length < HAND_MAX) {
      if (!C.draw.length) {
        if (!C.discard.length) return;
        C.draw = shuffle(C.discard);
        C.discard = [];
      }
      C.hand.push(C.draw.pop());
    }
  }
  function poison(who) {
    if (!who.st.poison) return 0;
    var n = who.st.poison--;
    who.hp -= n;
    return n;
  }
  function fade(st, keep) {
    ['weak', 'vuln'].forEach(function (k) { if (st[k] && !keep[k]) st[k]--; });
  }

  function startTurn() {
    var n = poison(S.me);
    if (n) say('Le poison te ronge : ' + n + ' PV.');
    if (S.me.hp <= 0) { finish(false); return; }
    S.me.block = 0;
    C.energy = ENERGY;
    draw(HAND);
  }

  function playCard(i) {
    var id = C.hand[i], card = CARDS[id], before = C.foe.hp, lost;
    if (!card || card.cost > C.energy) return;
    C.energy -= card.cost;
    C.hand.splice(i, 1);
    card.play();
    if (!card.exhaust) C.discard.push(id);
    lost = before - C.foe.hp;
    say(card.name + (lost > 0 ? ' : ' + lost + ' dégâts.' : '.'));
    if (C.foe.hp <= 0) win();
  }

  function endTurn() {
    var f = C.foe, m = f.def.moves[f.turn % f.def.moves.length], who = cap(f.def.the), n, i, k;
    C.discard = C.discard.concat(C.hand);
    C.hand = [];

    f.block = 0;
    n = poison(f);
    if (n) say('Le poison ronge ' + f.def.the + ' : ' + n + ' PV.');
    if (f.hp <= 0) { win(); return; }

    if (m.def) { f.block += m.def; say(who + ' se protège.'); }
    if (m.att) {
      for (n = 0, i = 0; i < (m.times || 1); i++) n += strike(m.att, f, S.me);
      say(who + ' attaque : ' + (n ? n + ' PV perdus.' : 'ton armure tient.'));
    }
    if (m.force) { f.st.force = (f.st.force || 0) + m.force; say(who + ' se renforce.'); }
    for (k in m.give) {
      S.me.st[k] = (S.me.st[k] || 0) + m.give[k];
      C.fresh[k] = true;
      say(who + ' t\'inflige ' + STATUS[k] + ' ' + m.give[k] + '.');
    }
    if (S.me.hp <= 0) { finish(false); return; }

    // Un état reçu pendant ce tour ne s'use pas tout de suite.
    fade(f.st, {});
    fade(S.me.st, C.fresh);
    C.fresh = {};
    f.turn++;
    startTurn();
  }

  function intent() {
    var f = C.foe, m = f.def.moves[f.turn % f.def.moves.length], out = [], k;
    if (m.def) out.push('armure ' + m.def);
    if (m.att) out.push('attaque ' + dmg(m.att, f, S.me) + (m.times ? ' ×' + m.times : ''));
    if (m.force) out.push('Force +' + m.force);
    for (k in m.give) out.push(STATUS[k] + ' ' + m.give[k]);
    return out.join(', ');
  }

  function win() {
    var f = C.foe, gold = f.def.gold + int(0, 5);
    S.foes.splice(S.foes.indexOf(f.ref), 1);
    S.gold += gold; S.kills++;
    S.me.block = 0; S.me.st = {};
    C = null;
    say(cap(f.def.the) + ' s\'effondre. +' + gold + ' or.');
    if (f.ref.boss) { finish(true); return; }
    ask('Butin', 'Choisis une carte à ajouter à ton deck.', sample(POOL, 3).map(function (id) {
      return { card: id, fn: function () { gain(id); } };
    }), 'Ne rien prendre');
  }

  function finish(won) {
    var seed = S.seed, mins = Math.max(1, Math.round((Date.now() - S.start) / 60000));
    S.over = true;
    C = null;
    ask(won ? 'Le dragon est mort' : 'Tu es mort',
      (won ? (S.city ? 'Tu remontes dans les rues ' + of(S.city) : 'Tu ressors du donjon') + ', les poches pleines.' : 'Ta descente s\'arrête à l\'étage ' + S.floor + '.') +
      ' Ennemis vaincus : ' + S.kills + ' · Or : ' + S.gold + ' · Deck : ' + S.deck.length + ' cartes · ' + mins + ' min.', [
        { label: 'Rejouer', note: 'nouveau donjon', fn: function () { newRun(''); } },
        { label: 'Revanche', note: 'graine ' + seed, fn: function () { newRun(seed); } }
      ], null);
  }

  // ---------- Fenêtre de choix ----------
  // opts : { card | label, note, off, fn }. Sans fn, l'option est seulement affichée.
  function ask(title, text, opts, skipLabel) {
    modal = { title: title, text: text, opts: opts, skip: skipLabel };
  }
  function choose(i) {
    var o = modal.opts[i];
    if (!o || o.off || !o.fn) return;
    modal = null;
    o.fn();
  }
  function skip() {
    if (modal.skip) modal = null;
  }

  // ---------- Affichage ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function span(cls, ch) { return '<span class="' + cls + '">' + esc(ch) + '</span>'; }
  function pad(s, w) { while (s.length < w) s += ' '; return s; }
  function rep(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }
  function bar(n, max, w) {
    var full = Math.max(0, Math.min(w, Math.ceil(n / max * w)));
    return '[' + rep('#', full) + rep('.', w - full) + ']';
  }
  function wrap(text, w) {
    var lines = [], line = '';
    text.split(' ').forEach(function (word) {
      if (line && (line + ' ' + word).length > w) { lines.push(line); line = word; }
      else line = line ? line + ' ' + word : word;
    });
    if (line) lines.push(line);
    return lines;
  }
  function cardBox(id) {
    var c = CARDS[id], rule = '+' + rep('-', BOX + 2) + '+', body = wrap(c.desc, BOX);
    while (body.length < 4) body.push('');
    return [rule, '| ' + pad(c.name, BOX - 2) + ' ' + c.cost + ' |', rule]
      .concat(body.map(function (l) { return '| ' + pad(l, BOX) + ' |'; }), [rule]).join('\n');
  }
  function states(st) {
    return Object.keys(STATUS).filter(function (k) { return st[k]; }).map(function (k) { return STATUS[k] + ' ' + st[k]; }).join(' · ');
  }

  function cell(x, y) {
    var i = y * W + x, t = S.map[y][x], f, it;
    if (!S.seen[i]) return ' ';
    if (vis[i]) {
      if (x === S.x && y === S.y) return span('me', '@');
      if ((f = foeAt(x, y))) return span(f.boss ? 'boss' : 'foe', f.ch);
    }
    if ((it = itemAt(x, y))) return span(vis[i] ? 'it-' + it.kind : 'dim', it.ch);
    if (!vis[i]) return span('dim', t);
    return t === '#' ? span('wall', t) : t;
  }
  function logView() {
    var lines = S.log.slice(-5);
    return '<pre class="log" aria-live="polite">' + lines.map(function (l, i) {
      return i === lines.length - 1 ? '<b>' + esc(l) + '</b>' : esc(l);
    }).join('\n') + '</pre>';
  }
  function mapView() {
    var out = '', x, y;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) out += cell(x, y);
      out += '\n';
    }
    return '<pre class="map">' + out + '</pre>' + logView() +
      '<div class="pad">' +
      '<button type="button" class="up" data-act="move" data-i="0" aria-label="Haut">^</button>' +
      '<button type="button" class="left" data-act="move" data-i="2" aria-label="Gauche">&lt;</button>' +
      '<button type="button" data-act="wait" aria-label="Attendre">.</button>' +
      '<button type="button" data-act="move" data-i="3" aria-label="Droite">&gt;</button>' +
      '<button type="button" class="up" data-act="move" data-i="1" aria-label="Bas">v</button>' +
      '</div>';
  }

  function option(o, i, act) {
    var cls = o.card ? 'card t-' + CARDS[o.card].type : 'card label';
    var note = (act && i < 9 ? '[' + (i + 1) + '] ' : '') + (o.note || '');
    var inner = '<span class="box">' + esc(o.card ? cardBox(o.card) : o.label) + '</span><span class="note">' + esc(note) + '</span>';
    if (!act) return '<div class="' + cls + '">' + inner + '</div>';
    return '<button type="button" class="' + cls + '" data-act="' + act + '" data-i="' + i + '"' + (o.off ? ' disabled' : '') + '>' + inner + '</button>';
  }

  function fightView() {
    var f = C.foe, me = S.me;
    var hand = C.hand.map(function (id, i) {
      return option({ card: id, off: CARDS[id].cost > C.energy }, i, 'card');
    }).join('');
    return '<section class="fight">' +
      '<pre class="duel">' +
      '<b class="face' + (f.ref.boss ? ' boss' : '') + '">' + esc(f.def.face) + '</b>' +
      esc(f.def.name + '  ' + bar(f.hp, f.max, 20) + ' ' + f.hp + '/' + f.max + (f.block ? '  Armure ' + f.block : '')) + '\n' +
      '<span class="st">' + esc(states(f.st) || ' ') + '</span>\n' +
      '<i>' + esc('Prépare : ' + intent()) + '</i>' +
      '<span class="self">' + esc('Toi  ' + bar(me.hp, me.max, 20) + ' ' + me.hp + '/' + me.max + '  Armure ' + me.block + '  Énergie ' + C.energy) + '\n' +
      '<span class="st">' + esc(states(me.st) || ' ') + '</span></span>' +
      '</pre>' +
      '<div class="hand">' + hand + '</div>' +
      '<div class="actions">' +
      '<button type="button" class="btn" data-act="end">Fin du tour [E]</button>' +
      '<button type="button" class="btn" data-act="potion"' + (S.potions ? '' : ' disabled') + '>Potion [P] ×' + S.potions + '</button>' +
      '<span>Pioche ' + C.draw.length + ' · Défausse ' + C.discard.length + '</span>' +
      '</div>' + logView() + '</section>';
  }

  function modalView() {
    return '<div class="win" role="dialog" aria-modal="true"><h2>' + esc(modal.title) + '</h2><p>' + esc(modal.text) + '</p>' +
      '<div class="opts">' + modal.opts.map(function (o, i) { return option(o, i, o.fn ? 'opt' : ''); }).join('') + '</div>' +
      (modal.skip ? '<button type="button" class="btn" data-act="skip">' + esc(modal.skip) + ' [Échap]</button>' : '') + '</div>';
  }

  function render() {
    $('#hp').textContent = Math.max(0, S.me.hp) + '/' + S.me.max;
    $('#gold').textContent = S.gold;
    $('#potions').textContent = S.potions;
    $('#floor').textContent = S.floor + '/' + FLOORS;
    $('#deck').textContent = 'Deck (' + S.deck.length + ')';
    $('#screen').innerHTML = C ? fightView() : mapView();
    $('#modal').hidden = !modal;
    $('#modal').innerHTML = modal ? modalView() : '';
  }

  // ---------- Commandes ----------
  var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), i;
    if (!b) return;
    i = +b.dataset.i;
    switch (b.dataset.act) {
      case 'opt': choose(i); break;
      case 'skip': skip(); break;
      case 'card': playCard(i); break;
      case 'end': endTurn(); break;
      case 'potion': quaff(); break;
      case 'move': step(DIRS[i][0], DIRS[i][1]); break;
      case 'wait': tick(); break;
      case 'deck': if (!modal) showDeck(); break;
      case 'random': newRun(''); break;
    }
    render();
  });

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName, k = e.key.length === 1 ? e.key.toLowerCase() : e.key, n = parseInt(k, 10);
    if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT') return;
    if (tag === 'BUTTON' && (k === 'Enter' || k === ' ')) return;
    if (modal) {
      if (n >= 1) choose(n - 1);
      else if (k === 'Escape' || k === '0') skip();
      else return;
    } else if (C) {
      if (n >= 1) playCard(n - 1);
      else if (k === 'e' || k === 'Enter' || k === ' ') endTurn();
      else if (k === 'p') quaff();
      else return;
    } else if (KEYS[k]) step(KEYS[k][0], KEYS[k][1]);
    else if (k === ' ' || k === '.') tick();
    else if (k === 'p') quaff();
    else return;
    e.preventDefault();
    render();
  });

  $('#seedForm').addEventListener('submit', function (e) {
    e.preventDefault();
    newRun($('#seed').value.trim());
    $('#seed').blur();
    render();
  });

  // Adresse : « graine » ou, venu d'un plan de ville, « graine?ville=Nom&plan=adresse du plan ».
  var raw = location.hash.slice(1), cutAt = raw.indexOf('?'), prm = new URLSearchParams(cutAt < 0 ? '' : raw.slice(cutAt + 1)), first = '';
  try { first = decodeURIComponent(cutAt < 0 ? raw : raw.slice(0, cutAt)); } catch (e) { /* adresse illisible : graine au hasard */ }
  if (first && prm.get('ville')) link = { seed: first, name: prm.get('ville'), plan: prm.get('plan') || '', query: raw.slice(cutAt + 1) };
  newRun(first);
  render();
})();
