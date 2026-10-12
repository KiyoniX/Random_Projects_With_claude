// Les couloirs oublient : paliers, règles d'oubli, créatures et objets.
// Dix paliers, quatre décors. Chaque décor a sa façon d'oublier, chaque créature sa règle.
(function (root) {
  'use strict';

  var C = root.Couloirs = {}, TAU = Math.PI * 2;
  C.THEMES = {
    bureaux: { name: 'les bureaux', pillar: 0.8, part: 0.36 },
    parking: { name: 'le parking', pillar: 0.9, part: 0.2 },
    piscine: { name: 'la piscine', pillar: 0.8, part: 0.42 },
    hotel: { name: 'l\'hôtel' }
  };
  C.LEVELS = [
    { theme: 'bureaux', mobs: ['guet'] },
    { theme: 'parking', mobs: ['ecoute'] },
    { theme: 'piscine', mobs: ['guet'] },
    { theme: 'hotel', mobs: ['aimant'] },
    { theme: 'bureaux', dark: true, mobs: ['phalene'] },
    { theme: 'parking', mobs: ['ecoute', 'mime'] },
    { theme: 'piscine', dark: true, mobs: ['guet', 'phalene'] },
    { theme: 'hotel', mobs: ['aimant', 'ecoute'] },
    { theme: 'bureaux', dark: true, mobs: ['mime', 'guet', 'phalene'] },
    { theme: 'parking', dark: true, mobs: ['ecoute', 'aimant', 'mime'] }
  ];
  // Notes d'anciens égarés : la première dit vrai, la seconde ment
  var NOTES = {
    bureaux: ['Ce que tu ne regardes plus, le couloir le reprend.', 'Les murs ne bougent que si tu cours.'],
    parking: ['Ne t\'arrête pas. Ici, c\'est l\'immobilité qui efface.', 'Reste immobile : tout se calme.'],
    piscine: ['Tout change quand tes yeux se ferment. Cligne avant d\'y être forcé.', 'Retiens tes paupières assez longtemps et la porte vient à toi.'],
    hotel: ['Aucune porte ne mène deux fois au même endroit.', 'La porte au bout du couloir mène toujours à la sortie.'],
    guet: ['Il n\'avance que dans ton dos. Le miroir le fige.', 'Ferme les yeux, il s\'en va.'],
    aimant: ['Le pâle vient dès que tu regardes vers lui, même à travers un mur. Détourne-toi.', 'Fixe le pâle : il recule.'],
    ecoute: ['Elle est aveugle. Marche, ne cours pas. Si elle est près, ne bouge plus.', 'Cours : elle est lente.'],
    mime: ['Deux bourdonnements ? Le faux bat un peu trop vite.', 'Le bourdonnement le plus fort est toujours le bon.'],
    phalene: ['Éteins ta lampe. Elle vient à la lumière.', 'La lumière la tient à distance.'],
    ruban: ['Le ruban tient les murs. Garde-le pour les abords de la porte.', 'Le ruban attire ce qui rôde.']
  };
  var FIRST = { guet: 'Tu n\'es plus seul.', aimant: 'Quelque chose de pâle se tient sur ta route.', ecoute: 'Quelque chose écoute.', phalene: 'Un froissement d\'ailes, dans le noir.' };

  var G = C.G = { seed: 1, size: 0, cell: null, seen: null, pin: null, memo: null, notes: {}, doors: [], items: [], mobs: [], events: [], level: 1, spec: null, theme: null, hotel: false,
    memory: 6, blinkEvery: 8, marks: 0, caught: 0, time: 0, clock: 0, start: null, exit: null, flash: 0, shut: 0, near: 99, look: -1, lookD: 99, nextShift: 0, won: false, say: '', sayUntil: 0,
    player: { x: 0, y: 0, a: 0, pitch: 0, stamina: 1, breath: 0, winded: false, sprint: false, noise: 0, still: 0, lamp: false, battery: 1, mirror: false, mirrorUp: false, blink: 0 } };
  var at = C.at = function (x, y) { return y * G.size + x; };
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var angdiff = C.angdiff = function (a, b) { var d = (a - b) % TAU; return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d; };
  function rng(seed) {
    return function () { seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function emit(type) { G.events.push(type); }
  function tell(text, seconds) { G.say = text; G.sayUntil = G.time + seconds; }
  C.tell = tell;

  // ---------- Construction d'un palier ----------
  // Piliers aux coins, cloisons entre eux, pièces toujours libres : un open space qui se referme
  function roll(x, y, rand) {
    var s = G.size, ex = x % 2 === 0, ey = y % 2 === 0;
    if (x === 0 || y === 0 || x === s - 1 || y === s - 1) return 1;
    return ex && ey ? (rand() < G.theme.pillar ? 1 : 0) : ex || ey ? (rand() < G.theme.part ? 1 : 0) : 0;
  }
  function buildOpen(r) {
    var s = G.size, x, y;
    for (y = 0; y < s; y++) for (x = 0; x < s; x++) { G.cell[at(x, y)] = roll(x, y, r); G.seen[at(x, y)] = G.time - r() * G.memory; }
    // Départ dans un coin, sortie vers le coin opposé : un bloc porte, dont les abords restent dégagés
    G.start = { x: 3.5, y: 3.5, a: 0.6 };
    var e = G.exit = { x: s - 5 - 2 * Math.floor(r() * 4), y: s - 5 - 2 * Math.floor(r() * 4) };
    G.cell[at(e.x, e.y)] = 2; G.pin[at(e.x, e.y)] = 2;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { G.cell[at(e.x + d[0], e.y + d[1])] = 0; G.pin[at(e.x + d[0], e.y + d[1])] = 2; });
  }
  // Hôtel : un quadrillage de couloirs coupés par endroits, et des portes au milieu de chaque tronçon
  function buildHotel(r) {
    var s = G.size, x, y, cand = [];
    for (y = 0; y < s; y++) for (x = 0; x < s; x++) {
      var edge = x === 0 || y === 0 || x === s - 1 || y === s - 1, mid = x % 4 === 2 && y % 4 === 0 || y % 4 === 2 && x % 4 === 0;
      G.cell[at(x, y)] = edge || x % 4 !== 2 && y % 4 !== 2 ? 1 : mid && (x > 5 || y > 5) && r() < 0.42 ? 1 : 0;
      G.pin[at(x, y)] = 2;
    }
    for (y = 1; y < s - 1; y++) for (x = 1; x < s - 1; x++) {
      var fx = x % 4 === 3 && y % 4 === 0 ? x - 1 : x % 4 === 1 && y % 4 === 0 ? x + 1 : x, fy = x % 4 === 0 && y % 4 === 3 ? y - 1 : x % 4 === 0 && y % 4 === 1 ? y + 1 : y;
      if ((fx !== x || fy !== y) && fx > 0 && fy > 0 && fx < s - 1 && fy < s - 1 && G.cell[at(fx, fy)] === 0 && (r() < 0.55 || x === 3 && y === 4)) cand.push({ x: x, y: y, fx: fx, fy: fy });
    }
    // Chaque tronçon de couloirs reçoit un numéro : la sortie doit donner sur un tronçon où d'autres portes arrivent
    var zone = new Int16Array(s * s), zones = 0, count = [0];
    for (y = 1; y < s - 1; y++) for (x = 1; x < s - 1; x++) {
      if (G.cell[at(x, y)] || zone[at(x, y)]) continue;
      var stack = [at(x, y)]; zone[at(x, y)] = ++zones; count.push(0);
      while (stack.length) { var c = stack.pop(); [1, -1, s, -s].forEach(function (d) { if (!G.cell[c + d] && !zone[c + d]) { zone[c + d] = zones; stack.push(c + d); } }); }
    }
    cand.forEach(function (d) { count[zone[at(d.fx, d.fy)]]++; });
    cand.sort(function (a, b) { return b.fx + b.fy - a.fx - a.fy; });
    var good = cand.filter(function (d) { return count[zone[at(d.fx, d.fy)]] > 2; }), e = (good.length ? good : cand)[Math.floor(r() * Math.min(4, good.length || cand.length))];
    cand.splice(cand.indexOf(e), 1);
    G.exit = { x: e.x, y: e.y }; G.cell[at(e.x, e.y)] = 2;
    G.doors = cand; cand.forEach(function (d) { G.cell[at(d.x, d.y)] = 3; });
    G.start = { x: 2.5, y: 2.5, a: 0 };
  }
  function furnish(r) {
    var s = G.size, spec = G.spec, p = G.player, x, y, spots = [], slots = [], keys = [spec.theme].concat(spec.mobs, ['ruban']), far = function (q) { return q.x + q.y > 9; };
    for (y = 2; y < s - 2; y++) for (x = 2; x < s - 2; x++) {
      var wall = G.hotel ? (x % 4 === 1 || x % 4 === 3) && (y % 4 === 1 || y % 4 === 3) : x % 2 === 0 && y % 2 === 0, room = G.hotel ? x % 4 === 2 && y % 4 === 2 : x % 2 === 1 && y % 2 === 1;
      if (wall && G.cell[at(x, y)] < 2 && Math.abs(x - G.exit.x) + Math.abs(y - G.exit.y) > 2) spots.push({ x: x, y: y });
      if (room) slots.push({ x: x, y: y });
    }
    var take = function (list) { return list.splice(Math.floor(r() * list.length), 1)[0]; };
    spots = spots.filter(far); slots = slots.filter(far);
    for (var k = 0; k < 6 && spots.length; k++) {
      var q = take(spots), key = keys[k % keys.length];
      G.cell[at(q.x, q.y)] = 4; G.pin[at(q.x, q.y)] = 2; G.notes[at(q.x, q.y)] = NOTES[key][r() < 0.25 ? 1 : 0];
    }
    var kinds = ['pile', 'ruban'].concat(spec.dark ? ['pile', 'pile'] : [], r() < 0.35 ? ['amande'] : []);
    kinds.forEach(function (kind) { var c = take(slots); G.items.push({ kind: kind, x: c.x + 0.5, y: c.y + 0.5 }); });
    // Le miroir attend près du départ tant qu'on ne l'a pas ramassé
    if (!p.mirror) G.items.push({ kind: 'miroir', x: G.hotel ? 6.5 : 7.5, y: G.hotel ? 2.5 : 3.5 });
  }
  C.newLevel = function (n) {
    var spec = C.LEVELS[n - 1], r = rng(G.seed * 31 + n * 7919), s;
    G.level = n; G.spec = spec; G.theme = C.THEMES[spec.theme]; G.hotel = spec.theme === 'hotel';
    s = G.size = G.hotel ? 33 + 4 * Math.floor(n / 4) : 31 + (n - 1) * 2;
    G.memory = Math.max(2.4, 6 - (n - 1) * 0.4); G.blinkEvery = Math.max(4.5, 8 - n * 0.3);
    G.cell = new Uint8Array(s * s); G.seen = new Float32Array(s * s); G.pin = new Uint8Array(s * s); G.memo = new Uint8Array(s * s);
    G.notes = {}; G.doors = []; G.items = []; G.told = {};
    if (G.hotel) buildHotel(r); else buildOpen(r);
    furnish(r);
    G.mobs = spec.mobs.map(function (kind) { return { kind: kind, x: 0, y: 0, on: false, seen: false, back: false, due: 0, t: 0, tx: 0, ty: 0, alert: false, lunge: false }; });
    G.player.lamp = !!spec.dark && G.player.battery > 0;
    wake();
    tell('Palier ' + n + ', ' + G.theme.name + (spec.dark ? ', dans le noir.' : '.'), 5);
  };
  C.newGame = function (seed) {
    var p = G.player;
    G.seed = seed; G.caught = 0; G.clock = 0; G.time = 0; G.marks = 3; G.won = false; G.events.length = 0;
    p.stamina = 1; p.breath = 0; p.winded = false; p.battery = 1; p.lamp = false; p.mirror = false; p.mirrorUp = false;
    C.newLevel(1);
  };
  function wake() {
    var p = G.player, x, y, n = G.level;
    p.x = G.start.x; p.y = G.start.y; p.a = G.start.a; p.pitch = 0; p.blink = 0; p.still = 0; G.nextShift = 0;
    if (!G.hotel) for (y = 2; y <= 4; y++) for (x = 2; x <= 4; x++) if (!G.pin[at(x, y)]) G.cell[at(x, y)] = x % 2 === 0 && y % 2 === 0 ? 1 : 0;
    G.mobs.forEach(function (m, i) {
      m.on = false; m.t = 0; m.alert = false; m.lunge = false;
      m.due = G.time + (m.kind === 'guet' ? Math.max(10, 26 - n * 1.5) : m.kind === 'mime' ? 5 : m.kind === 'ecoute' ? 8 : 13) + i * 4;
    });
  }

  // ---------- Oubli ----------
  // Un mur qui change s'efface souvent du plan ; sinon le plan garde l'ancien tracé, et il ment
  function reroll(x, y) {
    var i = at(x, y), was = G.cell[i];
    G.cell[i] = roll(x, y, Math.random);
    if (G.cell[i] !== was && G.memo[i] && Math.random() < 0.55) G.memo[i] = 0;
  }
  function sweep(chance) {
    var s = G.size, p = G.player;
    for (var y = 1; y < s - 1; y++) for (var x = 1; x < s - 1; x++) {
      if (G.pin[at(x, y)] || Math.abs(x + 0.5 - p.x) < 1.6 && Math.abs(y + 0.5 - p.y) < 1.6 || Math.random() > chance) continue;
      reroll(x, y);
    }
  }
  function forget(dt) {
    var s = G.size, p = G.player, now = G.time, th = G.spec.theme;
    if (th === 'parking') {
      // Le parking tient tant qu'on marche
      if (p.still > 0.8 && now > G.nextShift) { G.nextShift = now + 0.9; sweep(0.4); emit('shift'); }
    } else if (th === 'bureaux') {
      for (var y = 1; y < s - 1; y++) for (var x = 1; x < s - 1; x++) {
        var i = at(x, y);
        if (G.pin[i] || now - G.seen[i] < G.memory || Math.abs(x + 0.5 - p.x) < 1.6 && Math.abs(y + 0.5 - p.y) < 1.6) continue;
        reroll(x, y); G.seen[i] = now - Math.random() * G.memory * 0.5;
      }
    } else if (th === 'piscine') {
      // Les yeux se ferment tout seuls quand la jauge est pleine : mieux vaut choisir son moment
      p.blink += dt / G.blinkEvery;
      if (p.blink >= 1) C.blink();
    }
  }
  C.blink = function () {
    if (G.spec.theme !== 'piscine' || G.shut > 0) return;
    G.player.blink = 0; G.shut = 0.3; sweep(1); emit('blink');
  };
  C.mark = function () {
    var p = G.player, s = G.size;
    if (G.hotel) { tell('Ici les murs tiennent tout seuls.', 2); return; }
    if (!G.marks) { tell('Plus de ruban.', 2); return; }
    G.marks--;
    for (var y = Math.max(1, Math.floor(p.y - 2.5)); y <= Math.min(s - 2, Math.floor(p.y + 2.5)); y++)
      for (var x = Math.max(1, Math.floor(p.x - 2.5)); x <= Math.min(s - 2, Math.floor(p.x + 2.5)); x++) if (!G.pin[at(x, y)]) G.pin[at(x, y)] = 1;
    tell('Repère posé. Ici, plus rien ne bougera.', 3); emit('mark');
  };
  C.lamp = function () {
    var p = G.player;
    if (!G.spec.dark) { tell('Il fait assez clair ici. Garde tes piles.', 2); return; }
    if (p.battery <= 0) { tell('Les piles sont mortes.', 2); return; }
    p.lamp = !p.lamp; emit('click');
  };

  // ---------- Le joueur ----------
  var solid = function (x, y) { return G.cell[at(Math.floor(x), Math.floor(y))] > 0; };
  function move(dt, inp) {
    var p = G.player, moving = !!(inp.ahead || inp.strafe);
    if (p.stamina <= 0) p.winded = true;
    if (p.stamina > 0.35) p.winded = false;
    // Courir fait du bruit, essouffle, et range le miroir
    p.sprint = !!(inp.sprint && moving && !p.winded);
    p.mirrorUp = !!(inp.mirror && p.mirror && !p.sprint);
    p.stamina = clamp(p.stamina + (p.sprint ? -0.3 : 0.2) * dt); p.breath = clamp(p.breath + (p.sprint ? 0.45 : -0.16) * dt);
    p.noise = !moving ? 0 : p.sprint ? 1 : 0.3;
    p.still = moving ? 0 : p.still + dt;
    if (p.lamp) { p.battery = Math.max(0, p.battery - dt / 100); if (!p.battery) { p.lamp = false; tell('La lampe s\'éteint. Plus de piles.', 4); } }
    if (!moving) return;
    var n = Math.hypot(inp.ahead, inp.strafe), sp = (p.sprint ? 4.4 : p.winded ? 1.9 : 2.7) * dt / n, r = 0.22;
    var vx = (Math.cos(p.a) * inp.ahead - Math.sin(p.a) * inp.strafe) * sp, vy = (Math.sin(p.a) * inp.ahead + Math.cos(p.a) * inp.strafe) * sp;
    var cx = Math.floor(p.x + vx * 3 + Math.sign(vx) * r), cy = Math.floor(p.y + vy * 3 + Math.sign(vy) * r), c = G.cell[at(cx, cy)];
    // La sortie et les portes se franchissent en marchant dedans
    if (c === 2) { if (G.level === C.LEVELS.length) { G.won = true; emit('win'); } else { C.newLevel(G.level + 1); emit('level'); } return; }
    if (c === 3) { door(cx, cy); return; }
    if (!solid(p.x + vx + Math.sign(vx) * r, p.y - r) && !solid(p.x + vx + Math.sign(vx) * r, p.y + r)) p.x += vx;
    if (!solid(p.x - r, p.y + vy + Math.sign(vy) * r) && !solid(p.x + r, p.y + vy + Math.sign(vy) * r)) p.y += vy;
  }
  function door(x, y) {
    var p = G.player, others = G.doors.filter(function (d) { return d.x !== x || d.y !== y; }), d = others[Math.floor(Math.random() * others.length)];
    if (!d) return;
    p.x = d.fx + 0.5; p.y = d.fy + 0.5; p.a = Math.atan2(d.fy - d.y, d.fx - d.x) + (Math.random() < 0.5 ? 1.57 : -1.57);
    G.shut = 0.22; emit('door');
  }
  function pick() {
    var p = G.player;
    G.items = G.items.filter(function (it) {
      if (Math.hypot(it.x - p.x, it.y - p.y) > 0.6) return true;
      if (it.kind === 'pile') { p.battery = Math.min(1, p.battery + 0.4); tell('Des piles.', 2); }
      else if (it.kind === 'ruban') { G.marks++; tell('Un rouleau de ruban.', 2); }
      else if (it.kind === 'amande') { if (G.caught) G.caught--; tell('Eau d\'amande. Un mauvais réveil s\'efface.', 4); }
      else { p.mirror = true; tell('Un miroir de poche. Clic droit ou R pour regarder derrière toi.', 6); }
      emit('pick');
      return false;
    });
  }

  // ---------- Créatures : toutes traversent les murs, aucune n'obéit à la même règle ----------
  function spot(m, a, d) {
    var p = G.player, s = G.size;
    m.x = Math.max(2, Math.min(s - 2, p.x + Math.cos(a) * d)); m.y = Math.max(2, Math.min(s - 2, p.y + Math.sin(a) * d));
    return Math.hypot(m.x - p.x, m.y - p.y) > 7;
  }
  function spawn(m) {
    var p = G.player, e = G.exit, toExit = Math.atan2(e.y + 0.5 - p.y, e.x + 0.5 - p.x), far = Math.hypot(e.x + 0.5 - p.x, e.y + 0.5 - p.y), ok;
    if (m.kind === 'aimant') ok = far > 12 && spot(m, toExit + (Math.random() - 0.5) * 0.5, Math.min(12, far * 0.6));   // toujours sur la route de la sortie
    else if (m.kind === 'mime') ok = spot(m, toExit + Math.PI + (Math.random() - 0.5) * 1.8, 13 + Math.random() * 5);    // toujours à l'opposé
    else ok = spot(m, Math.random() * TAU, m.kind === 'ecoute' ? 16 + Math.random() * 6 : 12 + Math.random() * 6);
    if (!ok) { m.due = G.time + 2; return; }
    m.on = true; m.t = 0; m.alert = false; m.lunge = false; m.tx = m.x; m.ty = m.y;
    if (FIRST[m.kind] && !G.told[m.kind]) { G.told[m.kind] = true; tell(FIRST[m.kind], 4); }
  }
  function creatures(dt) {
    var p = G.player, e = G.exit;
    G.near = 99;
    G.mobs.forEach(function (m) {
      if (!m.on) { if (G.time > m.due) spawn(m); return; }
      var d = Math.hypot(p.x - m.x, p.y - m.y) || 1, v = 0, tx = p.x, ty = p.y, roam = false;
      if (m.kind === 'guet') {
        // N'avance que hors du regard ; le miroir compte comme un regard
        if (!m.seen && !m.back) v = 1.15 + G.level * 0.06;
      } else if (m.kind === 'aimant') {
        // Avance dès qu'il est dans l'axe du regard, vu ou non ; le miroir ne le déclenche pas
        if (Math.abs(angdiff(Math.atan2(m.y - p.y, m.x - p.x), p.a)) < 0.55 && d < 16 && G.shut <= 0) v = 1.9;
        if (Math.hypot(e.x - m.x, e.y - m.y) > Math.hypot(e.x - p.x, e.y - p.y) + 3) { m.t += dt; if (m.t > 5) { m.on = false; m.due = G.time + 3; } } else m.t = 0;
      } else if (m.kind === 'ecoute') {
        // Aveugle : va là où elle a entendu marcher, s'arrête à un pas et écoute
        if (p.noise > 0 && d < p.noise * 20) { m.tx = p.x; m.ty = p.y; m.alert = true; m.t = 0; }
        if (m.alert) { tx = m.tx; ty = m.ty; if (Math.hypot(tx - m.x, ty - m.y) > (p.noise ? 0 : 1.2)) v = 3.1; else if ((m.t += dt) > 4) m.alert = false; } else roam = true;
      } else if (m.kind === 'mime') {
        // Immobile, il bourdonne comme la sortie ; il bondit quand on arrive dessus
        if (d < 4.5 && !m.lunge) { m.lunge = true; m.t = 0; tell('Ce n\'était pas la sortie.', 3); }
        if (m.lunge) { v = 3.5; if ((m.t += dt) > 4) { m.on = false; m.due = G.time + 6; } }
      } else if (p.lamp) v = 2.3; else roam = true;   // phalène : vient à la lumière
      if (roam) { if (Math.hypot(m.tx - m.x, m.ty - m.y) < 0.5) spotTarget(m); tx = m.tx; ty = m.ty; v = 0.7; }
      var lx = tx - m.x, ly = ty - m.y, l = Math.hypot(lx, ly) || 1, st = Math.min(v * dt, l);
      m.x += lx / l * st; m.y += ly / l * st;
      if (d < G.near && (m.kind !== 'mime' || m.lunge)) G.near = d;
      if (d < 0.6) caught();
    });
  }
  function spotTarget(m) { var a = Math.random() * TAU, s = G.size; m.tx = Math.max(2, Math.min(s - 2, m.x + Math.cos(a) * 8)); m.ty = Math.max(2, Math.min(s - 2, m.y + Math.sin(a) * 8)); }
  function caught() {
    G.caught++; G.flash = 1;
    if (!G.hotel) sweepAll();
    wake(); emit('caught');
    tell('Il t\'a touché. Tu te réveilles ailleurs.', 5);
  }
  function sweepAll() { for (var i = 0; i < G.cell.length; i++) if (!G.pin[i]) reroll(i % G.size, Math.floor(i / G.size)); }

  C.step = function (dt, inp) {
    G.time += dt; G.clock += dt; G.flash = Math.max(0, G.flash - dt * 0.8); G.shut = Math.max(0, G.shut - dt);
    move(dt, inp);
    if (G.won) return;
    forget(dt); creatures(dt); pick();
  };
})(typeof window !== 'undefined' ? window : globalThis);
