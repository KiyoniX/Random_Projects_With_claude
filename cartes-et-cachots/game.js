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
  var COLS = 64, ROWS = 30; // l'écran, en cases
  var MX = 4, MY = 3;       // coin de la carte du donjon dans l'écran
  var BOX = 10, CARD_H = 10; // largeur intérieure et hauteur d'une carte, en cases
  var PER_ROW = 5, PER_PAGE = 10;
  var LINE = 1.2, STRETCH = 1.25;   // hauteur de rangée, étirement maximal des caractères
  var Z_MIN = 0.5, Z_MAX = 4, Z_STEP = 1.15;
  var NOIR = 0, ROUGE = 1, VERT = 2, JAUNE = 3, BLEU = 4, MAGENTA = 5, CYAN = 6, BLANC = 7;

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
  // page : la page de service affichée par-dessus le jeu (le guide), ou rien.
  var S, C = null, modal = null, vis = [], page = null;
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
      (won ? (S.city ? 'Tu remontes dans les rues ' + of(S.city) : 'Tu ressors du donjon') + ', les poches pleines.' : 'Ta descente s\'arrête à l\'étage ' + S.floor + '.'), [
        { label: 'Rejouer', note: 'nouveau donjon', fn: function () { newRun(''); } },
        { label: 'Revanche', note: 'graine ' + seed, fn: function () { newRun(seed); } }
      ], null);
    modal.won = won;
    modal.stats = [['Ennemis vaincus', S.kills], ['Or', S.gold], ['Deck', S.deck.length + ' cartes'], ['Durée', mins + ' min']];
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

  // ---------- Écran ----------
  // Une grille de cases fixes, comme une page vidéotex : chaque case porte un caractère et un attribut.
  var grid, tags;
  var PLAIN = { cls: '' }, SKIP = { skip: true }, mosaics = {};

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pad(s, w) { while (s.length < w) s += ' '; return s; }
  function rep(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }

  // at(encre, fond, classes en plus) : un attribut de case. Encre noire sur fond de couleur = vidéo inverse.
  function at(fg, bg, x) { return { cls: 'f' + fg + (bg ? ' b' + bg : '') + (x ? ' ' + x : '') }; }
  // Rend un attribut cliquable.
  function on(a, o) {
    if (!o || !o.act) return a;
    return { cls: a.cls, m: a.m, act: o.act, i: o.i, off: o.off, label: o.label };
  }
  // Mosaïque : trois chiffres, un par rangée de pavés (0 vide, 1 gauche, 2 droite, 3 les deux).
  function mo(pat, fg, sp, x) {
    var key = pat + fg + (sp ? 's' : '') + (x || ''), cls = 'm' + (sp ? ' sp' : ''), i;
    if (mosaics[key]) return mosaics[key];
    for (i = 0; i < 3; i++) if (pat.charAt(i) !== '0') cls += ' ' + 'abc'.charAt(i) + pat.charAt(i) + (i === 1 ? 'm' : '');
    return (mosaics[key] = { cls: cls + ' f' + fg + (x ? ' ' + x : ''), m: true });
  }

  function clear() {
    grid = []; tags = [];
    for (var y = 0; y < ROWS; y++) grid.push(new Array(COLS));
  }
  function put(x, y, text, a) {
    text = String(text);
    for (var i = 0; i < text.length; i++) if (y >= 0 && y < ROWS && x + i >= 0 && x + i < COLS) grid[y][x + i] = { ch: text.charAt(i), a: a || PLAIN };
    return x + text.length;
  }
  function fill(x, y, w, a) { put(x, y, rep(' ', w), a); }
  function raw(x, y, w, html) {
    grid[y][x] = { raw: html, w: w };
    for (var i = 1; i < w; i++) grid[y][x + i] = SKIP;
  }
  // Texte agrandi : sx et sy valent 1 ou 2. Posé sur sa rangée du bas, il déborde vers le haut.
  function big(x, y, text, a, sx, sy) {
    raw(x, y, text.length * sx, '<span class="g ' + (sx > 1 ? sy > 1 ? 's2' : 'w2' : 'h2') + ' ' + a.cls + '" style="width:' + text.length * sx + 'ch"><span>' + esc(text) + '</span></span>');
  }
  function rule(y) { fill(0, y, COLS, mo('030', BLEU)); }
  function crenel(y, fg) {
    for (var x = 0; x < COLS; x++) put(x, y, ' ', mo(x % 4 < 2 ? '330' : '300', fg));
  }
  function gauge(x, y, n, max, w, fg) {
    var units = Math.max(0, Math.min(w * 2, Math.ceil(n / max * w * 2))), i;
    for (i = 0; i < w; i++) put(x + i, y, ' ', units >= 2 * i + 2 ? mo('333', fg, true) : units === 2 * i + 1 ? mo('111', fg, true) : mo('030', BLEU));
  }
  // Dessin en pavés : chaque ligne de texte est une rangée de pavés, X = allumé.
  function picture(x, y, rows, fg) {
    var cx, cy, r, pat, l;
    for (cy = 0; cy * 3 < rows.length; cy++) {
      for (cx = 0; cx * 2 < rows[0].length; cx++) {
        pat = '';
        for (r = 0; r < 3; r++) {
          l = rows[cy * 3 + r] || '';
          pat += (l.charAt(cx * 2) === 'X' ? 1 : 0) + (l.charAt(cx * 2 + 1) === 'X' ? 2 : 0);
        }
        if (pat !== '000') put(x + cx, y + cy, ' ', mo(pat, fg));
      }
    }
  }

  function open(a, n, seen) {
    var tag = a.act ? 'button' : a.href ? 'a' : 'span', g, s;
    s = '<' + tag + ' class="' + a.cls + '" style="width:' + n + 'ch"';
    if (a.href) s += ' href="' + esc(a.href) + '"';
    if (a.act) {
      g = a.act + (a.i == null ? '' : '-' + a.i);
      s += ' type="button" data-act="' + a.act + '" data-g="' + g + '"' + (a.i == null ? '' : ' data-i="' + a.i + '"') + (a.off ? ' disabled' : '');
      // Un bouton s'étale sur plusieurs morceaux : seul le premier reçoit le focus.
      if (seen[g]) s += ' tabindex="-1" aria-hidden="true"';
      else if (a.label) s += ' aria-label="' + esc(a.label) + '"';
      seen[g] = true;
    }
    return s + '>';
  }
  function flush() {
    var out = '', seen = {}, x, y, c, a, n, text, tag;
    for (y = 0; y < ROWS; y++) {
      tag = tags[y] || 'div';
      out += '<' + tag + ' class="r">';
      x = 0;
      while (x < COLS) {
        c = grid[y][x];
        if (c && c.raw) { out += c.raw; x += c.w; continue; }
        a = c && c.a || PLAIN; text = ''; n = 0;
        while (x < COLS && (c = grid[y][x], !(c && c.raw) && (c && c.a || PLAIN) === a)) { text += c && c.ch || ' '; n++; x++; }
        out += open(a, n, seen) + (a.m ? '' : esc(text)) + (a.act ? '</button>' : a.href ? '</a>' : '</span>');
      }
      out += '</' + tag.split(' ')[0] + '>';
    }
    return out;
  }

  // ---------- Affichage ----------
  var TYPES = {
    att: { fg: ROUGE, sign: '♠', name: 'attaque' },
    tec: { fg: CYAN, sign: '♦', name: 'technique' },
    pou: { fg: JAUNE, sign: '♥', name: 'pouvoir' }
  };
  var INK = {
    me: at(NOIR, BLANC), foe: at(ROUGE), boss: at(NOIR, MAGENTA, 'cl'), dim: at(BLEU), floor: at(CYAN),
    wall: mo('333', BLEU, true), wallDim: mo('121', BLEU),
    exit: at(NOIR, VERT), gold: at(JAUNE), potion: at(MAGENTA), altar: at(NOIR, CYAN), camp: at(NOIR, ROUGE), shop: at(NOIR, JAUNE)
  };
  var SKULL = [
    '....XXXXXXXXXXXX....',
    '..XXXXXXXXXXXXXXXX..',
    '.XXXXXXXXXXXXXXXXXX.',
    'XXXXXXXXXXXXXXXXXXXX',
    'XXX.....XXXX.....XXX',
    'XXX.....XXXX.....XXX',
    'XXX.....XXXX.....XXX',
    'XXXX...XXXXXX...XXXX',
    'XXXXXXXXX..XXXXXXXXX',
    '.XXXXXXX....XXXXXXX.',
    '..XXXXXXXXXXXXXXXX..',
    '....XXXXXXXXXXXX....',
    '....XX.XX..XX.XX....',
    '....XX.XX..XX.XX....',
    '.....XXXXXXXXXX.....'
  ];
  var CROWN = [
    'XX.......XX.......XX',
    'XX.......XX.......XX',
    'XXX.....XXXX.....XXX',
    'XXX.....XXXX.....XXX',
    'XXXX...XXXXXX...XXXX',
    'XXXXX.XXXXXXXX.XXXXX',
    'XXXXXXXXXXXXXXXXXXXX',
    'XXXXXXXXXXXXXXXXXXXX',
    'XXXX.XXXX..XXXX.XXXX',
    'XXXXXXXXXXXXXXXXXXXX',
    '....................',
    'XXXXXXXXXXXXXXXXXXXX'
  ];

  // Coupe aux espaces, et après un trait d'union quand un mot dépasse.
  function wrap(text, w) {
    var lines = [], line = '', cut;
    text.split(' ').forEach(function (word) {
      if (line && (line + ' ' + word).length > w) { lines.push(line); line = ''; }
      line = line ? line + ' ' + word : word;
      while (line.length > w && (cut = line.lastIndexOf('-', w - 1) + 1) > 0) { lines.push(line.slice(0, cut)); line = line.slice(cut); }
    });
    if (line) lines.push(line);
    return lines;
  }
  function states(st) {
    return Object.keys(STATUS).filter(function (k) { return st[k]; }).map(function (k) { return STATUS[k] + ' ' + st[k]; }).join('  ');
  }
  function lead(label, w) { return label + ' ' + rep('.', w - label.length - 1); }
  function clip(s, w) { return s.length > w ? s.slice(0, w - 1) + '…' : s; }

  // Rangée 0 : le service, le plan d'où l'on vient, la graine, le zoom, le témoin de connexion.
  function header() {
    var from = link && link.seed === S.seed ? link : null, seed = 'graine ' + clip(S.seed, 14);
    put(0, 0, '3615 CACHOTS', at(JAUNE));
    if (from) put(14, 0, clip('Plan ' + of(from.name), 20), { cls: 'f6', href: '../plans-de-ville/index.html#' + from.plan });
    put(55 - seed.length, 0, seed);
    raw(56, 0, 6, '<span class="f6" id="zoomtag" style="width:6ch">' + esc(zoomTag()) + '</span>');
    put(63, 0, 'C', at(NOIR, BLANC));
  }
  function hud(fighting) {
    var x = 1;
    if (!fighting) {
      put(1, 1, 'PV');
      gauge(4, 1, S.me.hp, S.me.max, 14, VERT);
      put(19, 1, Math.max(0, S.me.hp) + '/' + S.me.max);
      x = 26;
    }
    put(put(x, 1, 'Or ') , 1, S.gold, at(JAUNE));
    put(put(x + 7, 1, 'Potions '), 1, S.potions, at(MAGENTA));
    put(put(x + 19, 1, 'Deck '), 1, S.deck.length, at(CYAN));
    put(put(COLS - 10, 1, 'Étage '), 1, S.floor + '/' + FLOORS, at(VERT));
  }
  function journal(y, n) {
    var lines = [];
    S.log.slice(-n).forEach(function (l, i, all) {
      wrap(l, COLS - 4).forEach(function (part) { lines.push({ text: part, fresh: i === all.length - 1 }); });
    });
    lines.slice(-n).forEach(function (l, i) {
      put(2, y + i, l.text, at(l.fresh ? BLANC : CYAN));
    });
  }
  // Bandeau du bas : la touche en vidéo inverse, puis ce qu'elle fait.
  function keys(items) {
    var x = 1;
    items.forEach(function (it) {
      if (!it) return;
      x = put(x, ROWS - 1, it.k, on(at(NOIR, it.off ? BLEU : BLANC, 'cap'), it));
      x = put(x, ROWS - 1, ' ' + it.label, on(at(it.off ? BLEU : BLANC, 0, 'lib'), it)) + 2;
    });
    return x;
  }

  function cell(x, y) {
    var i = y * W + x, t = S.map[y][x], f, it;
    if (!S.seen[i]) return null;
    if (vis[i]) {
      if (x === S.x && y === S.y) return ['@', INK.me];
      if ((f = foeAt(x, y))) return [f.ch, f.boss ? INK.boss : INK.foe];
    }
    if ((it = itemAt(x, y))) return [it.ch, vis[i] ? INK[it.kind] : INK.dim];
    if (t === '#') return [' ', vis[i] ? INK.wall : INK.wallDim];
    return [t, vis[i] ? INK.floor : INK.dim];
  }
  function mapPage() {
    var x, y, c;
    hud(false);
    rule(2);
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) if ((c = cell(x, y))) put(MX + x, MY + y, c[0], c[1]);
    }
    rule(MY + H);
    journal(MY + H + 1, 3);
    keys([
      { k: '←↑↓→', label: 'marcher' },
      { k: 'Espace', label: 'attendre', act: 'wait' },
      { k: 'P', label: 'potion ×' + S.potions, act: 'potion', off: !S.potions },
      { k: 'C', label: 'deck', act: 'deck' },
      { k: 'G', label: 'guide', act: 'guide' }
    ]);
  }

  // Une carte : bandeau à la couleur du type (touche, signe, coût), nom, texte, le tout dans un cadre de pavés.
  // o : { act, i, off, key }.
  function card(x, y, id, o) {
    var c = CARDS[id], t = TYPES[c.type], tone = o.off ? BLEU : t.fg, name = wrap(c.name, BOX), body = name.concat(wrap(c.desc, BOX)), i;
    var hit = { act: o.act, i: o.i, off: o.off, label: c.name + ', ' + t.name + ', coût ' + c.cost + '. ' + c.desc };
    var left = on(mo('111', tone, false, 'fr'), hit), right = on(mo('222', tone, false, 'fr'), hit);
    var title = on(at(t.fg), hit), text = on(at(BLANC), hit);
    put(x, y, pad('  ' + t.sign, BOX - 1) + c.cost + '● ', on(at(o.off ? BLANC : NOIR, tone, 'bar'), hit));
    if (o.key) put(x, y, o.key, on(at(BLANC), hit));
    for (i = 0; i < CARD_H - 2; i++) {
      put(x, y + 1 + i, ' ', left);
      put(x + 1, y + 1 + i, pad(body[i] || '', BOX), i < name.length ? title : text);
      put(x + BOX + 1, y + 1 + i, ' ', right);
    }
    put(x, y + CARD_H - 1, ' ', on(mo('113', tone, false, 'fr'), hit));
    put(x + 1, y + CARD_H - 1, rep(' ', BOX), on(mo('003', tone, false, 'fr'), hit));
    put(x + BOX + 1, y + CARD_H - 1, ' ', on(mo('223', tone, false, 'fr'), hit));
  }
  // Abscisse de la n-ième carte d'une rangée qui en compte « count », centrée.
  function slot(n, count) { return ((COLS - count * (BOX + 3) + 1) >> 1) + n * (BOX + 3); }

  function fightPage() {
    var f = C.foe, me = S.me, n = C.hand.length, two = n > PER_ROW, tone = f.ref.boss ? MAGENTA : ROUGE, face = f.def.face, y = two ? 2 : 5, x, i;
    var pile = 'Pioche ' + C.draw.length + '  Défausse ' + C.discard.length;
    if (!two) { hud(true); rule(2); }
    big((COLS - face.length * 2) >> 1, y, face, at(tone), 2, 2);
    y += two ? 1 : 2;
    put(4, y, f.def.name);
    gauge(20, y, f.hp, f.max, 20, tone);
    put(41, y, Math.max(0, f.hp) + '/' + f.max);
    if (f.block) put(50, y, 'Armure ' + f.block, at(CYAN));
    y++;
    put(4, y, 'Prépare', at(NOIR, JAUNE));
    x = put(20, y, intent(), at(JAUNE));
    if (two) put(x + 2, y, states(f.st), at(MAGENTA)); else put(20, y + 1, states(f.st), at(MAGENTA));
    y += two ? 1 : 2;
    if (!two) rule(y++);
    put(4, y, 'Toi');
    gauge(20, y, me.hp, me.max, 20, VERT);
    put(41, y, Math.max(0, me.hp) + '/' + me.max);
    put(50, y, 'Armure ' + me.block, at(CYAN));
    y++;
    put(4, y, 'Énergie');
    for (i = 0; i < Math.max(ENERGY, C.energy); i++) put(20 + i * 2, y, i < C.energy ? '●' : '○', at(JAUNE));
    put(COLS - 2 - pile.length, y, pile, at(CYAN));
    y++;
    put(20, y, states(me.st), at(MAGENTA));
    y += two ? 1 : 2;
    C.hand.forEach(function (id, i) {
      var row = i / PER_ROW | 0;
      card(slot(i % PER_ROW, Math.min(PER_ROW, n - row * PER_ROW)), y + row * CARD_H, id, { act: 'card', i: i, off: CARDS[id].cost > C.energy, key: i < 9 ? i + 1 : '' });
    });
    if (two) journal(ROWS - 2, 1); else journal(y + CARD_H + 1, 3);
    keys([
      n ? { k: n > 1 ? '1-' + Math.min(9, n) : '1', label: 'jouer' } : null,
      { k: 'E', label: 'fin du tour', act: 'end' },
      { k: 'P', label: 'potion ×' + S.potions, act: 'potion', off: !S.potions },
      { k: 'C', label: 'deck', act: 'deck' },
      { k: 'G', label: 'guide', act: 'guide' }
    ]);
  }

  // Une fenêtre de choix occupe toute la page. Au-delà de dix options, on feuillette avec Suite et Retour.
  function choicePage() {
    var pages = Math.max(1, Math.ceil(modal.opts.length / PER_PAGE)), p = modal.page = Math.max(0, Math.min(pages - 1, modal.page || 0)), base = p * PER_PAGE;
    var list = modal.opts.slice(base, base + PER_PAGE), count = list.filter(function (o) { return o.card; }).length, tall = count > PER_ROW;
    var band = S.over ? modal.won ? at(NOIR, JAUNE) : at(BLANC, ROUGE) : at(BLANC, BLEU), tone = S.over ? modal.won ? JAUNE : ROUGE : BLEU;
    var y = tall ? 4 : 6, k = 0, top = 0, x;
    if (!S.over) hud(false);
    fill(0, 2, COLS, band); fill(0, 3, COLS, band);
    big(2, 3, modal.title, band, 2, 2);
    if (pages > 1) put(COLS - 10, 3, 'page ' + (p + 1) + '/' + pages, band);
    if (!tall) crenel(4, tone);
    wrap(modal.text, S.over ? 38 : COLS - 4).forEach(function (l) { put(2, y++, l); });
    if (modal.stats) {
      y++;
      modal.stats.forEach(function (s) {
        put(2, y, lead(s[0], 26) + ' ' + s[1]);
        y++;
      });
      picture(46, 7, modal.won ? CROWN : SKULL, modal.won ? JAUNE : BLANC);
    }
    y++;
    list.forEach(function (o, j) {
      var row, cx, cy;
      if (!o.card) return;
      row = k / PER_ROW | 0;
      cx = slot(k % PER_ROW, Math.min(PER_ROW, count - row * PER_ROW)); cy = y + row * (CARD_H + 1);
      card(cx, cy, o.card, { act: o.fn ? 'opt' : '', i: base + j, off: o.off, key: o.fn && j < 9 ? j + 1 : '' });
      if (o.note) put(cx + ((BOX + 2 - o.note.length) >> 1), cy + CARD_H, o.note, at(o.off ? ROUGE : JAUNE));
      k++;
    });
    if (k) y += Math.ceil(k / PER_ROW) * (CARD_H + 1) + 1;
    list.forEach(function (o, j) {
      var hit, ink;
      if (o.card) return;
      hit = { act: o.fn ? 'opt' : '', i: base + j, off: o.off, label: o.label + (o.note ? ', ' + o.note : '') };
      ink = on(at(o.off ? BLEU : BLANC, 0, 'lib'), hit);
      put(4, y, ' ' + (j < 9 ? j + 1 : ' ') + ' ', on(at(NOIR, o.off ? BLEU : BLANC, 'cap'), hit));
      put(7, y, ' ' + (o.note ? lead(o.label, 26) + ' ' + o.note : o.label), ink);
      y += 2;
    });
    list.forEach(function (o, j) { if (o.fn && !o.off && j < 9) top = j + 1; });
    x = 1;
    if (top) {
      x = put(1, ROWS - 1, top > 1 ? 'Tapez 1 à ' + top : 'Tapez 1') + 1;
      put(x, ROWS - 1, ' ', at(NOIR, BLANC, 'cl'));
    }
    x = Math.max(x + 3, 16);
    [
      modal.skip ? { k: 'Échap', label: modal.skip, act: 'skip' } : null,
      pages > 1 ? { k: '←', label: 'retour', act: 'turn', i: -1, off: !p } : null,
      pages > 1 ? { k: '→', label: 'suite', act: 'turn', i: 1, off: p === pages - 1 } : null,
      { k: 'G', label: 'guide', act: 'guide' }
    ].forEach(function (it) {
      if (!it) return;
      x = put(x, ROWS - 1, it.k, on(at(NOIR, it.off ? BLEU : BLANC, 'cap'), it));
      x = put(x, ROWS - 1, ' ' + it.label, on(at(it.off ? BLEU : BLANC, 0, 'lib'), it)) + 2;
    });
  }

  var GUIDE = [
    ['Donjon', 'Flèches ou ZQSD pour marcher, Espace pour attendre, P pour boire une potion. Fonce dans un ennemi pour l\'attaquer : celui qui frappe le premier rend l\'autre vulnérable.'],
    ['Combat', '1 à 9 pour jouer une carte, E ou Entrée pour finir le tour. L\'armure disparaît au début de ton tour suivant.'],
    ['États', 'Vulnérable, +50 % de dégâts subis. Faible, −25 % de dégâts infligés. Poison, autant de PV perdus au début du tour, puis il baisse de 1. Une carte épuisée ne revient pas avant le combat suivant.'],
    ['Écran', 'La molette agrandit ou réduit l\'affichage, les touches + et − aussi. Glisse pour déplacer la vue (ou clic du milieu, ou Espace maintenu). 0 ou double-clic : taille ajustée.']
  ];
  function guidePage() {
    var y = 9, x, band = at(BLANC, BLEU);
    function sample(x, y, ch, ink, label) { return put(put(x, y, ch, ink), y, ' ' + label) + 2; }
    fill(0, 1, COLS, band); fill(0, 2, COLS, band);
    big(2, 2, 'Cartes & Cachots', band, 2, 2);
    put(COLS - 21, 2, 'un donjon aux cartes', band);
    crenel(3, BLEU);
    x = sample(2, 5, '@', INK.me, 'toi');
    x = put(x, 5, 'r g s', INK.foe); x = put(x, 5, ' ennemis') + 2;
    x = sample(x, 5, 'D', at(NOIR, MAGENTA), 'dragon');
    x = sample(x, 5, '>', INK.exit, 'escalier');
    sample(x, 5, '*', INK.gold, 'or');
    x = sample(2, 6, '!', INK.potion, 'potion');
    x = sample(x, 6, '?', INK.altar, 'autel');
    x = sample(x, 6, '&', INK.camp, 'feu de camp');
    sample(x, 6, '$', INK.shop, 'marchand');
    x = 2;
    ['att', 'tec', 'pou'].forEach(function (k) { x = sample(x, 7, TYPES[k].sign, at(TYPES[k].fg), TYPES[k].name); });
    sample(x, 7, '●', at(JAUNE), 'énergie');
    GUIDE.forEach(function (g) {
      put(2, y, g[0], at(NOIR, CYAN));
      wrap(g[1], COLS - 13).forEach(function (l) { put(10, y++, l); });
    });
    y = ROWS - 4;
    tags[y] = 'form id="seedForm"';
    put(2, y, 'Graine');
    raw(10, y, 24, '<input id="seed" type="text" maxlength="24" autocomplete="off" spellcheck="false" aria-label="Graine du donjon" value="' + esc(S.seed) + '">');
    x = put(36, y, 'Entrée', on(at(NOIR, BLANC, 'cap'), { act: 'launch' }));
    x = put(x, y, ' lancer', on(at(BLANC, 0, 'lib'), { act: 'launch' })) + 2;
    put(x, y, 'au hasard', on(at(NOIR, BLANC, 'cap'), { act: 'random' }));
    put(1, ROWS - 1, 'Guide', at(NOIR, CYAN));
    x = 9;
    [{ k: 'G', label: S.over ? 'retour' : 'retour au jeu', act: 'guide' }, { k: '+ −', label: 'zoom' }, { k: '0', label: 'taille ajustée', act: 'zfit' }].forEach(function (it) {
      x = put(x, ROWS - 1, it.k, on(at(NOIR, BLANC, 'cap'), it));
      x = put(x, ROWS - 1, ' ' + it.label, on(at(BLANC, 0, 'lib'), it)) + 2;
    });
  }

  function render() {
    clear();
    header();
    if (page) guidePage();
    else if (modal) choicePage();
    else if (C) fightPage();
    else mapPage();
    ecran.innerHTML = flush();
    $('#poste').dataset.mode = page || modal ? 'page' : C ? 'combat' : 'donjon';
    $('#annonce').textContent = modal ? modal.title + '. ' + modal.text : S.log[S.log.length - 1] || '';
    follow();
    light(view.hot);
  }

  // ---------- Vue ----------
  // La molette change la taille des caractères ; quand la grille dépasse le tube, on la déplace en glissant.
  var ecran = $('#ecran'), tube = $('#tube');
  var view = { z: 1, x: 0, y: 0, base: null, hot: '', drag: null, space: false, moved: false, inside: false, eat: false };
  try { view.z = Math.max(Z_MIN, Math.min(Z_MAX, +localStorage.getItem('cachots-zoom') || 1)); } catch (e) { /* pas de mémoire : taille ajustée */ }

  function zoomTag() { return view.z === 1 ? '' : '×' + view.z.toFixed(2).replace('.', ','); }
  function loose() { return !!view.base && (view.gw > view.tw || view.gh > view.th); }

  // Taille ajustée : la grille entière tient dans la place libre. Tant qu'il y a la place, une rangée fait un multiple de trois pavés.
  function fit() {
    var scene = $('#scene'), w = scene.clientWidth - 28, h = scene.clientHeight - 28, ratio, rh, cw, k = 1;
    if (!(w > 100 && h > 100)) return;
    ratio = $('#etalon').getBoundingClientRect().width / 1000 || 0.55;
    rh = Math.max(9, Math.floor(h / (ROWS + 2) / 3) * 3);
    cw = rh / LINE * ratio;
    if (cw * (COLS + 4) > w) {
      cw = w / (COLS + 4);
      rh = Math.max(8, Math.floor(cw / ratio * LINE));
      if (rh >= 15) rh -= rh % 3;
    } else k = Math.min(STRETCH, w / (cw * (COLS + 4)));   // les caractères d'un Minitel sont larges
    view.ratio = ratio;
    view.base = { rh: rh, k: k };
    view.tw = Math.round(rh / LINE * ratio * k * (COLS + 4));
    view.th = Math.round(rh * (ROWS + 2));
    tube.style.width = view.tw + 'px';
    tube.style.height = view.th + 'px';
    scale();
    view.x = (view.tw - view.gw) / 2; view.y = (view.th - view.gh) / 2;
    place();
    follow();
  }
  function scale() {
    var rh = Math.max(6, Math.round(view.base.rh * view.z)), size = rh / LINE;
    view.rh = rh; view.cw = size * view.ratio * view.base.k;
    view.gw = COLS * view.cw; view.gh = ROWS * rh;
    ecran.style.fontSize = size + 'px';
    ecran.style.lineHeight = rh + 'px';
    ecran.style.setProperty('--rh', rh + 'px');
  }
  function place() {
    var mx = (view.tw - view.gw) / 2, my = (view.th - view.gh) / 2, edge = view.base.rh;
    view.x = mx >= 0 ? mx : Math.max(view.tw - view.gw - edge, Math.min(edge, view.x));
    view.y = my >= 0 ? my : Math.max(view.th - view.gh - edge, Math.min(edge, view.y));
    ecran.style.transform = 'translate(' + Math.round(view.x) + 'px,' + Math.round(view.y) + 'px) scale(' + view.base.k + ',1)';
    tube.classList.toggle('large', loose());
  }
  // Le point (cx, cy) du tube reste sous le curseur pendant que la taille change.
  function zoomAt(z, cx, cy) {
    var u, v, tag;
    if (!view.base) return;
    z = Math.max(Z_MIN, Math.min(Z_MAX, z));
    if (Math.abs(z - 1) < 0.04) z = 1;
    if (cx == null) { cx = view.tw / 2; cy = view.th / 2; }
    u = (cx - view.x) / view.gw; v = (cy - view.y) / view.gh;
    view.z = z;
    scale();
    view.x = cx - u * view.gw; view.y = cy - v * view.gh;
    place();
    try { localStorage.setItem('cachots-zoom', z); } catch (e) { /* tant pis */ }
    tag = $('#zoomtag');
    if (tag) tag.textContent = zoomTag();
  }
  // Dans le donjon, la vue agrandie suit le joueur.
  function follow() {
    var px, py, mx, my;
    if (!loose() || C || modal || page) return;
    px = view.x + (MX + S.x + 0.5) * view.cw; py = view.y + (MY + S.y + 0.5) * view.rh;
    mx = Math.min(view.tw / 2, view.cw * 9); my = Math.min(view.th / 2, view.rh * 5);
    if (px < mx) view.x += mx - px; else if (px > view.tw - mx) view.x -= px - (view.tw - mx);
    if (py < my) view.y += my - py; else if (py > view.th - my) view.y -= py - (view.th - my);
    place();
  }
  function light(g) {
    var old = ecran.querySelectorAll('.hot'), now = g ? ecran.querySelectorAll('[data-g="' + g + '"]:not(:disabled)') : [], i;
    for (i = 0; i < old.length; i++) old[i].classList.remove('hot');
    for (i = 0; i < now.length; i++) now[i].classList.add('hot');
    view.hot = g;
  }

  tube.addEventListener('wheel', function (e) {
    var r = tube.getBoundingClientRect();
    e.preventDefault();
    zoomAt(view.z * (e.deltaY < 0 ? Z_STEP : 1 / Z_STEP), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  tube.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });   // pas de défilement automatique
  tube.addEventListener('pointerdown', function (e) {
    if (e.button !== 1 && !(e.button === 0 && (view.space || loose()))) return;
    if (e.target.tagName === 'INPUT') return;
    view.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: view.x, y: view.y, live: false, now: e.button === 1 || view.space, left: e.button === 0 };
  });
  tube.addEventListener('pointermove', function (e) {
    var d = view.drag, dx, dy;
    if (!d || d.id !== e.pointerId) return;
    dx = e.clientX - d.sx; dy = e.clientY - d.sy;
    if (!d.live) {
      if (!d.now && dx * dx + dy * dy < 36) return;
      d.live = true; view.moved = true;
      try { tube.setPointerCapture(d.id); } catch (err) { /* pointeur déjà relâché */ }
      tube.classList.add('prise');
    }
    view.x = d.x + dx; view.y = d.y + dy;
    place();
  });
  function release(e) {
    var d = view.drag;
    if (!d || d.id !== e.pointerId) return;
    view.drag = null;
    tube.classList.remove('prise');
    if (d.live && d.left) { view.eat = true; setTimeout(function () { view.eat = false; }, 0); }   // le clic qui suit un glisser ne compte pas
  }
  tube.addEventListener('pointerup', release);
  tube.addEventListener('pointercancel', release);
  tube.addEventListener('pointerenter', function () { view.inside = true; });
  tube.addEventListener('pointerleave', function () { view.inside = false; });
  tube.addEventListener('dblclick', function (e) {
    if (e.target.closest('[data-act], a, input')) return;
    zoomAt(1);
  });
  tube.addEventListener('mouseover', function (e) {
    var b = e.target.closest('[data-g]'), g = b ? b.dataset.g : '';
    if (g !== view.hot) light(g);
  });
  tube.addEventListener('mouseleave', function () { light(''); });
  window.addEventListener('resize', fit);

  // ---------- Commandes ----------
  var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  function turn(d) { modal.page = (modal.page || 0) + d; }
  function launch(seed) { page = null; newRun(seed); }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), i, free = !modal && !page;
    if (!b || view.eat) return;
    i = +b.dataset.i;
    switch (b.dataset.act) {
      case 'opt': choose(i); break;
      case 'skip': skip(); break;
      case 'turn': turn(i); break;
      case 'card': if (C && free) playCard(i); break;
      case 'end': if (C && free) endTurn(); break;
      case 'potion': if (free) quaff(); break;
      case 'move': if (free && !C) step(DIRS[i][0], DIRS[i][1]); break;
      case 'wait': if (free && !C) tick(); break;
      case 'deck': if (free) showDeck(); break;
      case 'guide': page = page ? null : 'guide'; break;
      case 'launch': launch($('#seed').value.trim()); break;
      case 'random': launch(''); break;
      case 'zin': zoomAt(view.z * Z_STEP); return;
      case 'zout': zoomAt(view.z / Z_STEP); return;
      case 'zfit': zoomAt(1); return;
    }
    render();
  });

  // Renvoie vrai si la touche a servi.
  function press(k) {
    var n = parseInt(k, 10);
    if (page) {
      if (k === 'Escape' || k === 'Enter' || k === ' ' || k === 'g') page = null;
      else return false;
    } else if (k === 'g') page = 'guide';
    else if (modal) {
      if (n >= 1) choose((modal.page || 0) * PER_PAGE + n - 1);
      else if (k === 'Escape' || k === '0') skip();
      else if (k === 'ArrowRight' || k === 'PageDown') turn(1);
      else if (k === 'ArrowLeft' || k === 'PageUp') turn(-1);
      else return false;
    } else if (C) {
      if (n >= 1) playCard(n - 1);
      else if (k === 'e' || k === 'Enter' || k === ' ') endTurn();
      else if (k === 'p') quaff();
      else if (k === 'c') showDeck();
      else return false;
    } else if (KEYS[k]) step(KEYS[k][0], KEYS[k][1]);
    else if (k === ' ' || k === '.') tick();
    else if (k === 'p') quaff();
    else if (k === 'c') showDeck();
    else return false;
    return true;
  }

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName, k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT') return;
    if (tag === 'BUTTON' && (k === 'Enter' || k === ' ')) return;
    if (k === '+' || k === '=' || k === '-' || (k === '0' && !modal)) {
      zoomAt(k === '0' ? 1 : view.z * (k === '-' ? 1 / Z_STEP : Z_STEP));
      e.preventDefault();
      return;
    }
    // Vue agrandie, curseur sur l'écran : Espace maintenu sert à glisser, et n'agit qu'au relâchement s'il n'a pas servi.
    if (k === ' ' && !modal && !page && view.inside && loose()) {
      if (!e.repeat) { view.space = true; view.moved = false; }
      e.preventDefault();
      return;
    }
    if (!press(k)) return;
    e.preventDefault();
    render();
  });
  document.addEventListener('keyup', function (e) {
    if (e.key !== ' ' || !view.space) return;
    view.space = false;
    if (!view.moved && press(' ')) render();
  });

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    launch($('#seed').value.trim());
    render();
  });

  // Adresse : « graine » ou, venu d'un plan de ville, « graine?ville=Nom&plan=adresse du plan ».
  var raw0 = location.hash.slice(1), cutAt = raw0.indexOf('?'), prm = new URLSearchParams(cutAt < 0 ? '' : raw0.slice(cutAt + 1)), first = '';
  try { first = decodeURIComponent(cutAt < 0 ? raw0 : raw0.slice(0, cutAt)); } catch (e) { /* adresse illisible : graine au hasard */ }
  if (first && prm.get('ville')) link = { seed: first, name: prm.get('ville'), plan: prm.get('plan') || '', query: raw0.slice(cutAt + 1) };
  if (!first) page = 'guide';   // première visite : la page de garde
  newRun(first);
  render();
  fit();
})();
