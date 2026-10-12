(function () {
  'use strict';

  var W = 44, H = 19;        // taille de la carte, en cases
  var DT = 1 / 30;           // pas de temps de la logique, en secondes
  var WAVES = 20;
  var LIVES = 20, GOLD = 150;
  var REFUND = 0.7;          // part de l'or investi rendue à la vente
  var WAIT = 20, BREATH = 5; // délai avant la vague suivante : au plus tard, et une fois le terrain vide
  var HP_GROWTH = 1.1;       // PV des ennemis multipliés à chaque vague
  var ROCKS = 0.08;
  var SHOT_SPEED = 16;       // cases par seconde
  var POISON_TIME = 4;
  var SLOW_TIME = 1.6;
  var STORE = 'defense-ascii';

  // Une valeur par niveau. ground : ne vise pas les volants. pierce : ignore le blindage.
  var TOWERS = [
    { id: 'archer', ch: 'A', name: 'Archer', cost: [50, 50, 90], range: [3.2, 3.5, 3.8], cd: [0.8, 0.75, 0.7], dmg: [7, 11, 17],
      desc: 'Tir rapide sur une cible, au sol comme en vol. Peine contre les blindés.' },
    { id: 'canon', ch: 'C', name: 'Canon', cost: [85, 75, 120], range: [3, 3.2, 3.5], cd: [1.6, 1.5, 1.4], dmg: [18, 28, 44], area: [1.5, 1.7, 1.9], ground: true,
      desc: 'Boulet qui frappe toute une zone. Ne vise pas les volants.' },
    { id: 'glace', ch: 'G', name: 'Glace', cost: [60, 55, 85], range: [2.8, 3.1, 3.4], cd: [1.2, 1.2, 1.2], dmg: [2, 3, 5], slow: [0.45, 0.55, 0.65],
      desc: 'Onde de givre : ralentit tout ce qui passe à portée.' },
    { id: 'poison', ch: 'P', name: 'Poison', cost: [80, 65, 100], range: [3, 3.3, 3.6], cd: [1.3, 1.1, 0.9], dps: [7, 12, 19],
      desc: 'Dégâts continus qui ignorent le blindage. Sans effet sur les squelettes.' },
    { id: 'baliste', ch: 'B', name: 'Baliste', cost: [130, 100, 160], range: [6.5, 7.5, 8.5], cd: [2.8, 2.6, 2.4], dmg: [40, 68, 110], pierce: true,
      desc: 'Longue portée, vise le plus costaud et perce le blindage. Lente.' }
  ];
  var TOWER = {};
  TOWERS.forEach(function (t) { TOWER[t.id] = t; });

  // cost : poids dans le budget d'une vague. gap : secondes entre deux apparitions.
  var FOES = {
    r: { name: 'Rat', hp: 6, speed: 2.3, gold: 2, cost: 1, gap: 0.3, tag: 'en essaim' },
    g: { name: 'Gobelin', hp: 22, speed: 1.5, gold: 5, cost: 2.5, gap: 0.8, tag: 'ordinaire' },
    w: { name: 'Warg', hp: 18, speed: 3, gold: 5, cost: 3, gap: 0.6, tag: 'rapide' },
    c: { name: 'Chauve-souris', hp: 18, speed: 2, gold: 6, cost: 3.5, gap: 0.7, fly: true, tag: 'volante, coupe tout droit' },
    s: { name: 'Squelette', hp: 44, speed: 1.3, armor: 2, gold: 8, cost: 4.5, gap: 1, nopoison: true, tag: 'insensible au poison' },
    o: { name: 'Orque', hp: 72, speed: 0.95, armor: 5, gold: 12, cost: 7, gap: 1.6, tag: 'lent, blindé' },
    T: { name: 'Troll', hp: 360, speed: 0.7, armor: 3, gold: 60, cost: 40, gap: 5, boss: true, lives: 5, tag: 'boss, peu sensible au froid' }
  };
  var SCRIPT = ['g', 'r', 'gw', 'og', 'gT', 'cg', 'sr'];   // les premières vagues présentent les ennemis un par un
  var POOL = ['r', 'g', 'w', 'c', 's', 'o'];

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
  // S : la partie, que seule la logique modifie. U : l'interface (choix en cours, curseur, pause, vitesse).
  var S;
  var U = { pick: null, sel: null, cur: null, paused: false, speed: 1, acc: 0, last: 0 };

  function newGame(seed) {
    seed = seed || Math.random().toString(36).slice(2, 8);
    seedRng(seed);
    S = {
      seed: seed, gold: GOLD, lives: LIVES, score: 0, kills: 0, wave: 0, tick: 0, timer: 0,
      towers: [], foes: [], shots: [], fx: [], queue: [],
      over: null, endless: false, record: false, best: bestOf(seed),
      msg: 'Pose tes premières tours, puis lance la vague quand tu es prêt.'
    };
    newMap();
    S.next = makeWave(1);
  }

  function say(text) { S.msg = text; }
  function sq(n) { return n * n; }
  function at(x, y) { return y * W + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

  function bestOf(seed) {
    try { return (JSON.parse(localStorage.getItem(STORE)) || {})[seed] || 0; } catch (e) { return 0; }
  }
  function saveBest() {
    if (S.score <= S.best) return;
    S.best = S.score; S.record = true;
    try {
      var all = JSON.parse(localStorage.getItem(STORE)) || {};
      all[S.seed] = S.score;
      localStorage.setItem(STORE, JSON.stringify(all));
    } catch (e) { /* stockage indisponible : le record ne vaut que pour cette session */ }
  }

  // ---------- Carte ----------
  function line(a, b) {
    var x = a.x, y = a.y, dx = Math.abs(b.x - x), dy = Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1, err = dx - dy, e2, out = [];
    for (;;) {
      out.push({ x: x, y: y });
      if (x === b.x && y === b.y) return out;
      e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  // Le chemin avance vers l'est et change de moitié de carte à chaque coude : il ne se touche jamais.
  function carve() {
    var path = [], x = 0, y = int(2, H - 3), col = int(3, 6), to;
    function put() { path.push({ x: x, y: y }); }
    while (col < W - 3) {
      while (x < col) { put(); x++; }
      to = y < H / 2 ? int(y + 5, H - 2) : int(1, y - 5);
      while (y !== to) { put(); y += y < to ? 1 : -1; }
      col += int(5, 8);
    }
    while (x < W) { put(); x++; }
    return path;
  }

  function newMap() {
    var i, last;
    S.path = carve();
    last = S.path[S.path.length - 1];
    S.air = line(S.path[0], last);
    S.road = []; S.rock = []; S.grid = []; S.base = []; S.look = [];
    S.path.forEach(function (p) { S.road[at(p.x, p.y)] = true; });
    for (i = 0; i < W * H; i++) {
      if (S.road[i]) { S.base[i] = ' '; S.look[i] = 'road'; }
      else if (rng() < ROCKS) { S.rock[i] = true; S.base[i] = rng() < 0.5 ? '^' : '%'; S.look[i] = 'rock'; }
      else { S.base[i] = rng() < 0.12 ? ',' : '.'; S.look[i] = 'soil'; }
    }
    S.base[at(S.path[0].x, S.path[0].y)] = '>'; S.look[at(S.path[0].x, S.path[0].y)] = 'road gate';
    S.base[at(last.x, last.y)] = '@'; S.look[at(last.x, last.y)] = 'road home';
  }

  function free(x, y) {
    var i = at(x, y);
    return inside(x, y) && !S.road[i] && !S.rock[i] && !S.grid[i];
  }

  // ---------- Vagues ----------
  function makeWave(n) {
    var boss = n % 5 === 0;
    var types = n <= SCRIPT.length ? SCRIPT[n - 1].split('') : sample(POOL, int(2, 3)).concat(boss ? ['T'] : []);
    var crowd = types.filter(function (ch) { return !FOES[ch].boss; });
    var budget = (10 + 5 * n) * (boss ? 0.6 : 1), start = 0;
    return {
      n: n, mul: Math.pow(HP_GROWTH, n - 1),
      groups: types.map(function (ch) {
        var def = FOES[ch], g = { ch: ch, gap: def.gap, at: start };
        g.count = def.boss ? Math.ceil(n / 10) : Math.max(1, Math.round(budget / crowd.length / def.cost));
        // Les groupes se chevauchent : le suivant part avant que le précédent ait fini d'arriver.
        start += g.count * g.gap * 0.6;
        return g;
      })
    };
  }

  function launch() {
    var w = S.next, now = S.tick * DT;
    S.wave = w.n;
    w.groups.forEach(function (g) {
      for (var i = 0; i < g.count; i++) S.queue.push({ at: now + g.at + i * g.gap, ch: g.ch, mul: w.mul });
    });
    S.queue.sort(function (a, b) { return a.at - b.at; });
    S.next = makeWave(w.n + 1);
    S.timer = WAIT;
    say('Vague ' + w.n + (w.n % 5 === 0 ? ' : un troll approche.' : '.'));
  }

  function canCall() {
    return !S.over && !S.queue.length && (S.wave < WAVES || S.endless);
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

  // ---------- Ennemis ----------
  function spawn(q) {
    var def = FOES[q.ch], route = def.fly ? S.air : S.path, hp = Math.round(def.hp * q.mul);
    S.foes.push({ ch: q.ch, def: def, hp: hp, max: hp, route: route, d: 0, x: route[0].x, y: route[0].y, slow: 0, slowT: 0, dps: 0, poisT: 0, gone: false });
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

  function advance(f) {
    var v = f.def.speed, i, k, a, b;
    if (f.gone) return;
    if (f.poisT > 0) {
      f.poisT -= DT;
      f.hp -= f.dps * DT;
      if (f.hp <= 0) { slay(f); return; }
    }
    if (f.slowT > 0) { f.slowT -= DT; v *= 1 - f.slow; }
    f.d += v * DT;
    if (f.d >= f.route.length - 1) {
      f.gone = true;
      S.lives -= f.def.lives || 1;
      say(f.def.name + ' passé : ' + Math.max(0, S.lives) + ' vies restantes.');
      return;
    }
    i = Math.floor(f.d); k = f.d - i; a = f.route[i]; b = f.route[i + 1];
    f.x = a.x + (b.x - a.x) * k;
    f.y = a.y + (b.y - a.y) * k;
  }

  // ---------- Tours ----------
  function towerAt(x, y) { return inside(x, y) ? S.grid[at(x, y)] || null : null; }

  function build(id, x, y) {
    var def = TOWER[id], t;
    if (S.over || !def) return null;
    if (!free(x, y)) { say('Impossible de bâtir ici.'); return null; }
    if (S.gold < def.cost[0]) { say('Pas assez d\'or pour : ' + def.name + ' (' + def.cost[0] + ').'); return null; }
    S.gold -= def.cost[0];
    t = { def: def, x: x, y: y, lvl: 0, cd: 0, spent: def.cost[0] };
    S.towers.push(t);
    S.grid[at(x, y)] = t;
    say(def.name + ' en place.');
    return t;
  }
  function upgradeCost(t) { return t.lvl < 2 ? t.def.cost[t.lvl + 1] : 0; }
  function upgrade(t) {
    var cost = upgradeCost(t);
    if (S.over || !cost) return false;
    if (S.gold < cost) { say('Pas assez d\'or pour améliorer (' + cost + ').'); return false; }
    S.gold -= cost; t.spent += cost; t.lvl++;
    say(t.def.name + ' passe au niveau ' + (t.lvl + 1) + '.');
    return true;
  }
  function resale(t) { return Math.floor(t.spent * REFUND); }
  function sell(t) {
    var i = S.towers.indexOf(t);
    if (S.over || i < 0) return false;
    S.towers.splice(i, 1);
    S.grid[at(t.x, t.y)] = null;
    S.gold += resale(t);
    say(t.def.name + ' vendu : +' + resale(t) + ' or.');
    return true;
  }

  function inRange(t, f) { return sq(f.x - t.x) + sq(f.y - t.y) <= sq(t.def.range[t.lvl]); }

  function aim(t) {
    var def = t.def, best = null, top = -Infinity, i, f, v;
    for (i = 0; i < S.foes.length; i++) {
      f = S.foes[i];
      if (f.gone || (def.ground && f.def.fly) || (def.dps && f.def.nopoison) || !inRange(t, f)) continue;
      v = f.d - f.route.length;                    // par défaut : le plus près de la sortie
      if (def.pierce) v = f.hp + v / 1000;         // la baliste préfère le plus costaud
      if (def.dps && f.poisT > 0.5) v -= 1000;     // le poison cherche d'abord une cible saine
      if (v > top) { top = v; best = f; }
    }
    return best;
  }

  function dash(dx, dy) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax > 2 * ay) return '-';
    if (ay > 2 * ax) return '|';
    return dx * dy > 0 ? '\\' : '/';
  }
  function spark(x, y, ch, cls, t) { S.fx.push({ x: x, y: y, ch: ch, cls: cls, t: t }); }

  function frost(t) {
    var L = t.lvl, hit = false, i, f, dx, dy;
    for (i = 0; i < S.foes.length; i++) {
      f = S.foes[i];
      if (f.gone || !inRange(t, f)) continue;
      hit = true;
      f.slow = Math.max(f.slowT > 0 ? f.slow : 0, t.def.slow[L] * (f.def.boss ? 0.5 : 1));
      f.slowT = SLOW_TIME;
      hurt(f, t.def.dmg[L], true);
    }
    if (!hit) return false;
    for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) if (dx || dy) spark(t.x + dx, t.y + dy, dash(dx, dy), 'fx-ice', 0.15);
    return true;
  }

  function fire(t) {
    var def = t.def, L = t.lvl, f;
    if (t.cd > 0) { t.cd -= DT; return; }
    if (def.slow) { if (frost(t)) t.cd = def.cd[L]; return; }
    f = aim(t);
    if (!f) return;
    t.cd = def.cd[L];
    if (def.pierce) {
      // Le trait de baliste touche tout de suite ; on n'en dessine que la trace.
      line(t, { x: Math.round(f.x), y: Math.round(f.y) }).slice(1).forEach(function (p) { spark(p.x, p.y, dash(f.x - t.x, f.y - t.y), 'fx-bolt', 0.12); });
      hurt(f, def.dmg[L], true);
      return;
    }
    S.shots.push({ def: def, x: t.x, y: t.y, to: f, tx: f.x, ty: f.y, dmg: def.dmg && def.dmg[L], area: def.area && def.area[L], dps: def.dps && def.dps[L], done: false });
  }

  // ---------- Projectiles ----------
  function land(s) {
    var f = s.to, r = Math.ceil(s.area || 0), i, dx, dy;
    s.done = true;
    if (s.area) {
      for (i = 0; i < S.foes.length; i++) {
        f = S.foes[i];
        if (!f.def.fly && sq(f.x - s.tx) + sq(f.y - s.ty) <= sq(s.area)) hurt(f, s.dmg, false);
      }
      for (dy = -r; dy <= r; dy++) for (dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= sq(s.area)) spark(Math.round(s.tx) + dx, Math.round(s.ty) + dy, '*', 'fx-boom', 0.2);
      }
    } else if (f.gone) {
      return;
    } else if (s.dps) {
      f.dps = Math.max(f.poisT > 0 ? f.dps : 0, s.dps);
      f.poisT = POISON_TIME;
    } else hurt(f, s.dmg, false);
  }

  function fly(s) {
    var dx, dy, dist, step = SHOT_SPEED * DT;
    if (!s.to.gone) { s.tx = s.to.x; s.ty = s.to.y; }
    dx = s.tx - s.x; dy = s.ty - s.y; dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= step) { land(s); return; }
    s.x += dx / dist * step; s.y += dy / dist * step;
    s.ch = s.area ? 'o' : s.dps ? '~' : dash(dx, dy);
  }

  // ---------- Boucle de jeu ----------
  function finish(won) {
    if (won) S.score += S.lives * 20;
    S.over = won ? 'won' : 'lost';
    saveBest();
  }
  function goEndless() {
    if (S.over !== 'won') return;
    S.over = null; S.endless = true; S.record = false;
    say('Mode sans fin : les vagues ne s\'arrêteront plus.');
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
    S.shots = S.shots.filter(function (s) { return !s.done; });
    S.fx = S.fx.filter(function (e) { return e.t > 0; });

    if (S.lives <= 0) { finish(false); return; }
    if (!S.wave || S.queue.length) return;
    if (S.wave >= WAVES && !S.endless) {
      if (!S.foes.length) finish(true);
      return;
    }
    if (!S.foes.length && S.timer > BREATH) S.timer = BREATH;
    S.timer -= DT;
    if (S.timer <= 0) launch();
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

  // ---------- Affichage ----------
  var shown = {};

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // N'écrit dans la page que ce qui a changé : un bouton recréé sous le curseur perdrait son clic.
  function put(sel, html) {
    if (shown[sel] === html) return;
    shown[sel] = html;
    $(sel).innerHTML = html;
  }

  function foeAt(x, y) {
    for (var i = 0; i < S.foes.length; i++) if (Math.round(S.foes[i].x) === x && Math.round(S.foes[i].y) === y) return S.foes[i];
    return null;
  }

  // Tour dont on montre la portée : celle sous le curseur, sinon celle qu'on s'apprête à poser, sinon la sélection.
  function zone() {
    var c = U.cur, t = c && towerAt(c.x, c.y);
    if (t) return { x: t.x, y: t.y, r: t.def.range[t.lvl] };
    if (c && U.pick && free(c.x, c.y)) return { x: c.x, y: c.y, r: TOWER[U.pick].range[0] };
    if (U.sel) return { x: U.sel.x, y: U.sel.y, r: U.sel.def.range[U.sel.lvl] };
    return null;
  }

  function mapView() {
    var ch = S.base.slice(), cls = S.look.slice(), z = zone(), out = '', i, x, y, f, run, k;
    function mark(px, py, c, name) {
      var j;
      px = Math.round(px); py = Math.round(py);
      if (!inside(px, py)) return;
      j = at(px, py);
      ch[j] = c; cls[j] = (S.road[j] ? 'road ' : '') + name;
    }
    S.towers.forEach(function (t) { mark(t.x, t.y, t.def.ch, 'tw tw-' + t.def.id + ' l' + t.lvl + (t === U.sel ? ' sel' : '')); });
    S.fx.forEach(function (e) { mark(e.x, e.y, e.ch, e.cls); });
    for (i = 0; i < S.foes.length; i++) {
      f = S.foes[i];
      if (!f.def.boss) mark(f.x, f.y, f.ch, 'foe' + (f.slowT > 0 ? ' cold' : f.poisT > 0 ? ' sick' : '') + (f.hp * 2 < f.max ? ' hurt' : ''));
    }
    for (i = 0; i < S.foes.length; i++) {
      f = S.foes[i];
      if (f.def.boss) mark(f.x, f.y, f.ch, 'foe boss' + (f.slowT > 0 ? ' cold' : f.poisT > 0 ? ' sick' : ''));
    }
    S.shots.forEach(function (s) { if (s.ch) mark(s.x, s.y, s.ch, 'shot-' + s.def.id); });
    if (U.cur && U.pick && free(U.cur.x, U.cur.y)) mark(U.cur.x, U.cur.y, TOWER[U.pick].ch, 'ghost');
    if (z) {
      for (y = Math.max(0, Math.ceil(z.y - z.r)); y <= Math.min(H - 1, Math.floor(z.y + z.r)); y++) {
        for (x = Math.max(0, Math.ceil(z.x - z.r)); x <= Math.min(W - 1, Math.floor(z.x + z.r)); x++) {
          if (sq(x - z.x) + sq(y - z.y) <= sq(z.r)) cls[at(x, y)] += ' rng';
        }
      }
    }
    if (U.cur) cls[at(U.cur.x, U.cur.y)] += U.pick && !free(U.cur.x, U.cur.y) && !towerAt(U.cur.x, U.cur.y) ? ' cur bad' : ' cur';

    for (y = 0; y < H; y++) {
      run = ''; k = cls[at(0, y)];
      for (x = 0; x < W; x++) {
        i = at(x, y);
        if (cls[i] !== k) { out += '<span class="' + k + '">' + esc(run) + '</span>'; run = ''; k = cls[i]; }
        run += ch[i];
      }
      out += '<span class="' + k + '">' + esc(run) + '</span>' + (y < H - 1 ? '\n' : '');
    }
    return out;
  }

  function stats(def, L) {
    var out = [];
    if (def.dmg) out.push('Dégâts ' + def.dmg[L]);
    if (def.dps) out.push('Poison ' + def.dps[L] + '/s pendant ' + POISON_TIME + ' s');
    if (def.area) out.push('Zone ' + def.area[L]);
    if (def.slow) out.push('Ralentit de ' + Math.round(def.slow[L] * 100) + ' %');
    out.push('Portée ' + def.range[L]);
    out.push('Recharge ' + def.cd[L] + ' s');
    return out.join(' · ');
  }

  function shopView() {
    return TOWERS.map(function (def, i) {
      return '<button type="button" class="buy' + (U.pick === def.id ? ' on' : '') + (S.gold < def.cost[0] ? ' poor' : '') + '" data-act="pick" data-i="' + i + '">' +
        '<span class="key">' + (i + 1) + '</span><span class="tw-' + def.id + '">' + def.ch + '</span> ' + esc(def.name) + '<span class="price">' + def.cost[0] + ' or</span></button>';
    }).join('');
  }

  function infoView() {
    var t = U.sel, def, cost;
    if (t) {
      def = t.def; cost = upgradeCost(t);
      return '<b>' + esc(def.name) + ' · niveau ' + (t.lvl + 1) + '/3</b>\n' + esc(stats(def, t.lvl)) +
        (cost ? '\n<i>Niveau ' + (t.lvl + 2) + ' :</i> ' + esc(stats(def, t.lvl + 1)) : '') +
        '<div class="row">' +
        '<button type="button" class="btn" data-act="up"' + (cost && S.gold >= cost ? '' : ' disabled') + '>' + (cost ? 'Améliorer [A] ' + cost + ' or' : 'Niveau maximal') + '</button>' +
        '<button type="button" class="btn" data-act="sell">Vendre [X] +' + resale(t) + ' or</button></div>';
    }
    if (U.pick) {
      def = TOWER[U.pick];
      return '<b>' + esc(def.name) + ' · ' + def.cost[0] + ' or</b>\n' + esc(def.desc) + '\n' + esc(stats(def, 0)) + '\n<i>Clique une case libre pour la poser. Échap pour annuler.</i>';
    }
    return 'Choisis une tour (1 à 5), puis clique une case libre. Clique une tour posée pour l\'améliorer ou la vendre.';
  }

  function waveView() {
    var w = S.next, head;
    if (S.wave >= WAVES && !S.endless) return 'C\'est la dernière vague. Tiens bon.';
    if (!S.wave) head = 'Vague 1 : quand tu veux.';
    else if (S.queue.length) head = 'Vague ' + w.n + ' : après celle-ci.';
    else head = 'Vague ' + w.n + ' dans ' + Math.ceil(S.timer) + ' s.';
    return '<b>' + head + '</b>\n' + w.groups.map(function (g) {
      var def = FOES[g.ch];
      return (g.count < 10 ? ' ' : '') + g.count + ' × <span class="foe' + (def.boss ? ' boss' : '') + '">' + g.ch + '</span> ' + esc(def.name) + ' <i>' + esc(def.tag) + '</i>';
    }).join('\n');
  }

  function hintView() {
    var c = U.cur, t, f, i;
    if (!c) return ' ';
    i = at(c.x, c.y);
    if ((f = foeAt(c.x, c.y))) return f.ch + ' ' + f.def.name + ' · ' + Math.ceil(f.hp) + '/' + f.max + ' PV · ' + f.def.tag;
    if ((t = towerAt(c.x, c.y))) return t.def.name + ' niveau ' + (t.lvl + 1) + ' · ' + stats(t.def, t.lvl);
    if (S.road[i]) return 'Chemin : les ennemis passent ici.';
    if (S.rock[i]) return 'Rocher : rien à bâtir ici.';
    return U.pick ? 'Case libre : ' + TOWER[U.pick].name + ' pour ' + TOWER[U.pick].cost[0] + ' or.' : 'Case libre.';
  }

  function modalView() {
    var won = S.over === 'won';
    return '<div class="win" role="dialog" aria-modal="true"><h2>' + (won ? 'Victoire' : 'Défaite') + '</h2><p>' +
      (won ? 'Les ' + WAVES + ' vagues sont repoussées et il te reste ' + S.lives + ' vies.' : 'Ta base tombe à la vague ' + S.wave + '.') +
      ' Ennemis abattus : ' + S.kills + ' · Score : ' + S.score + (S.record ? ' · nouveau record pour cette graine !' : ' · Record : ' + S.best) + '</p><div class="opts">' +
      (won ? '<button type="button" class="btn" data-act="endless">Mode sans fin</button>' : '') +
      '<button type="button" class="btn" data-act="retry">Revanche (graine ' + esc(S.seed) + ')</button>' +
      '<button type="button" class="btn" data-act="random">Nouvelle carte</button></div></div>';
  }

  function render() {
    put('#lives', String(Math.max(0, S.lives)));
    put('#gold', String(S.gold));
    put('#waveNo', S.wave + (S.endless ? '' : '/' + WAVES));
    put('#score', String(S.score));
    put('#best', String(Math.max(S.best, S.score)));
    put('#map', mapView());
    put('#hint', esc(hintView()));
    put('#msg', esc(S.msg));
    put('#shop', shopView());
    put('#info', infoView());
    put('#wave', waveView());
    put('#ctl',
      '<button type="button" class="btn" data-act="next"' + (canCall() ? '' : ' disabled') + '>Vague suivante [N]</button>' +
      '<button type="button" class="btn' + (U.paused ? ' on' : '') + '" data-act="pause">' + (U.paused ? 'Reprendre' : 'Pause') + ' [Espace]</button>' +
      '<span class="speeds">' + [1, 2, 3].map(function (n) {
        return '<button type="button" class="btn' + (U.speed === n ? ' on' : '') + '" data-act="speed" data-i="' + n + '">×' + n + '</button>';
      }).join('') + ' [V]</span>');
    put('#modal', S.over ? modalView() : '');
    $('#modal').hidden = !S.over;
  }

  // ---------- Commandes ----------
  function start(seed) {
    newGame(seed);
    U.pick = null; U.sel = null; U.cur = null; U.paused = false; U.acc = 0;
    $('#seed').value = S.seed;
    // location.replace plutôt que history.replaceState, que Chrome refuse sur une page ouverte en file://.
    try { location.replace(location.href.split('#')[0] + '#' + encodeURIComponent(S.seed)); } catch (e) { /* page ouverte hors navigateur */ }
  }
  function hashSeed() {
    try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; }
  }

  function choose(id) {
    U.pick = U.pick === id ? null : id;
    U.sel = null;
  }
  function act(x, y) {
    var t = towerAt(x, y);
    if (t) { U.sel = t; U.pick = null; }
    else if (U.pick) build(U.pick, x, y);
    else U.sel = null;
  }
  function sellSel() {
    if (U.sel && sell(U.sel)) U.sel = null;
  }
  function cycleSpeed() { U.speed = U.speed % 3 + 1; }

  function cellOf(e) {
    var r = $('#map').getBoundingClientRect();
    var x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
    return inside(x, y) ? { x: x, y: y } : null;
  }

  $('#map').addEventListener('pointermove', function (e) { U.cur = cellOf(e); });
  $('#map').addEventListener('pointerleave', function () { U.cur = null; });
  $('#map').addEventListener('pointerdown', function (e) {
    var c = cellOf(e);
    if (!c || e.button) return;
    U.cur = c;
    act(c.x, c.y);
    render();
  });
  $('#map').addEventListener('contextmenu', function (e) {
    e.preventDefault();
    U.pick = null; U.sel = null;
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), i;
    if (!b) return;
    i = +b.dataset.i;
    switch (b.dataset.act) {
      case 'pick': choose(TOWERS[i].id); break;
      case 'up': if (U.sel) upgrade(U.sel); break;
      case 'sell': sellSel(); break;
      case 'next': callWave(); break;
      case 'pause': U.paused = !U.paused; break;
      case 'speed': U.speed = i; break;
      case 'endless': goEndless(); break;
      case 'retry': start(S.seed); break;
      case 'random': start(''); break;
    }
    // Un bouton cliqué à la souris ne doit pas garder le focus, sinon Espace le réactiverait au lieu de mettre en pause.
    if (e.detail) b.blur();
    render();
  });

  var ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName, k = e.key.length === 1 ? e.key.toLowerCase() : e.key, n = parseInt(k, 10), c;
    if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT') return;
    if (tag === 'BUTTON' && (k === 'Enter' || k === ' ')) return;
    if (S.over) return;
    if (n >= 1 && n <= TOWERS.length) choose(TOWERS[n - 1].id);
    else if (ARROWS[k]) {
      c = U.cur || { x: W >> 1, y: H >> 1 };
      U.cur = { x: Math.max(0, Math.min(W - 1, c.x + ARROWS[k][0])), y: Math.max(0, Math.min(H - 1, c.y + ARROWS[k][1])) };
    } else if (k === 'Enter') { if (U.cur) act(U.cur.x, U.cur.y); }
    else if (k === 'Escape') { U.pick = null; U.sel = null; }
    else if (k === ' ' || k === 'p') U.paused = !U.paused;
    else if (k === 'v') cycleSpeed();
    else if (k === 'n') callWave();
    else if (k === 'a') { if (U.sel) upgrade(U.sel); }
    else if (k === 'x' || k === 'Delete') sellSel();
    else return;
    e.preventDefault();
    render();
  });

  $('#seedForm').addEventListener('submit', function (e) {
    e.preventDefault();
    start($('#seed').value.trim());
    $('#seed').blur();
    render();
  });

  window.addEventListener('hashchange', function () {
    if (hashSeed() !== S.seed) { start(hashSeed()); render(); }
  });

  // Prise pour les essais et la console : toute la logique tourne sans affichage.
  window.defenseAscii = {
    W: W, H: H, DT: DT, WAVES: WAVES, TOWERS: TOWERS, FOES: FOES,
    state: function () { return S; }, ui: U,
    newGame: newGame, tick: tick, build: build, upgrade: upgrade, upgradeCost: upgradeCost, sell: sell,
    free: free, callWave: callWave, canCall: canCall, goEndless: goEndless, render: render
  };

  start(hashSeed());
  render();
  requestAnimationFrame(function (now) { U.last = now; frame(now); });
})();
