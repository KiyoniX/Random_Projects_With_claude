// Le quart de nuit : la mer, le temps, les navires, les machines et le journal de bord.
// Rien ici ne touche à l'écran : une nuit dure NIGHT secondes et couvre dix heures, de 20 h à 6 h.
(function (root) {
  'use strict';

  var P = root.Phare = {};
  var NIGHT = P.NIGHT = 420, TAU = 6.283185307;
  P.ROOMS = ['au cellier', 'à la chambre de veille', 'à la lanterne'];
  P.ALT = [6, 20, 34];
  // Une tour carrée, trois étages. ~ vide, # pierre, W fenêtre, G vitre, R garde-corps, . galerie, L lentille,
  // k mécanisme, h corne, v volant, g génératrice, f fusibles, b a u étagères, j journal, r radio, c carte, m baromètre, l lit, P porte
  P.LEVELS = [
    ['~~~~~~~~~~~', '~~~~~~~~~~~', '~~#b#a#u#~~', '~~#     #~~', '~~g     f~~', '~~W     #~~', '~~#     P~~', '~~#     #~~', '~~#>##W##~~', '~~~~~~~~~~~', '~~~~~~~~~~~'],
    ['~~~~~~~~~~~', '~~~~~~~~~~~', '~~#jW#rW#~~', '~~#     #~~', '~~W     c~~', '~~#     #~~', '~~l     W~~', '~~#     m~~', '~~#>#W#<#~~', '~~~~~~~~~~~', '~~~~~~~~~~~'],
    ['RRRRRRRRRRR', 'R.........R', 'R.GkGGGhG.R', 'R.G     G.R', 'R.G     G.R', 'R.G  L   .R', 'R.G     G.R', 'R.G     G.R', 'R.GvGGG<G.R', 'R.........R', 'RRRRRRRRRRR']
  ];
  P.KINDS = ['chalutier', 'cargo', 'voilier'];
  P.SHOP = [
    { id: 'bidon', name: 'Bidon de gazole', note: 'Un peu plus d\'une demi-cuve.', price: 15 },
    { id: 'ampoule', name: 'Ampoule de feu', note: 'Elles claquent sans prévenir.', price: 25 },
    { id: 'fusible', name: 'Fusible', note: 'Pour les nuits d\'orage.', price: 10 },
    { id: 'lentille', name: 'Lentille de premier ordre', note: 'Le feu porte un tiers plus loin.', price: 160, once: true },
    { id: 'ressort', name: 'Grand ressort', note: 'Le mécanisme tient presque deux fois plus longtemps.', price: 120, once: true },
    { id: 'filament', name: 'Ampoules à double filament', note: 'Elles durent deux fois plus.', price: 100, once: true },
    { id: 'para', name: 'Paratonnerre', note: 'La foudre épargne presque toujours le fusible.', price: 90, once: true },
    { id: 'vernis', name: 'Vernis hydrofuge', note: 'Les vitres s\'encrassent deux fois moins vite.', price: 70, once: true }
  ];
  var SHIPS = ['Marie-Galante', 'Étoile du Nord', 'Petit Jean', 'Sainte-Anne', 'Korrigan', 'Belle Hortense', 'Kenavo', 'Fleur de Mai', 'Notre-Dame des Flots', 'Cap Fréhel', 'Ville d\'Ys', 'Goéland',
    'Jeanne-Yvonne', 'Espérance', 'Trois Frères', 'Marsouin', 'Aurore', 'Tramontane', 'Père Tanguy', 'Saint-Guénolé', 'Intrépide', 'Recouvrance', 'Bonne Brise', 'Alcyon'];
  var REEFS = ['la Vieille', 'les Dents du Chien', 'la Jument', 'le Four', 'les Trois Sœurs', 'la Plate', 'le Corbeau', 'les Moines', 'la Teignouse'];
  var WINDS = ['est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest', 'nord', 'nord-est'];

  var clamp = P.clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  P.angdiff = function (a, b) { var d = (a - b) % TAU; return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d; };
  function rng(seed) {
    return function () { seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  var count = function (n, one, many) { return n === 0 ? 'aucun ' + one : n === 1 ? 'un ' + one : n + ' ' + many; };
  // L'angle 0 pointe vers l'est et les y descendent : un quart de tour mène au sud
  var wind = function (a) { return WINDS[((Math.round(a / (TAU / 8)) % 8) + 8) % 8]; };
  var vowel = function (s) { return /^[eo]/.test(s); };
  var from = function (a) { var n = wind(a); return (vowel(n) ? 'par l\'' : 'par le ') + n; };
  var toward = function (a) { var n = wind(a); return 'cap ' + (vowel(n) ? 'à l\'' : 'au ') + n; };
  var where = function (a) { var n = wind(a); return (vowel(n) ? 'à l\'' : 'au ') + n; };
  P.title = function (s) { return 'le ' + P.KINDS[s.kind] + ' ' + s.name; };
  var cap = P.cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  P.clock = function (t) { var m = Math.floor(clamp(t) * 600), mm = m % 60; return (20 + Math.floor(m / 60)) % 24 + ' h ' + (mm < 10 ? '0' : '') + mm; };
  // Face de la lanterne : 0 nord, 1 est, 2 sud, 3 ouest
  P.paneAt = function (x, y) { return y === 2 ? 0 : x === 8 ? 1 : y === 8 ? 2 : 3; };
  P.paneToward = function (a) { a = P.angdiff(a, 0); return Math.abs(a) < 0.7854 ? 1 : Math.abs(a) > 2.3562 ? 3 : a > 0 ? 2 : 0; };

  // ---------- Carrière ----------
  P.newCareer = function (seed) {
    return { v: 1, seed: seed, night: 1, trust: 3, money: 40, stock: { bidon: 3, ampoule: 2, fusible: 2 }, up: {}, tank: 0.7, journal: [], saved: 0, lost: 0, over: false };
  };
  P.buy = function (S, id) {
    var it = P.SHOP.filter(function (i) { return i.id === id; })[0];
    if (!it || S.money < it.price || it.once && S.up[id]) return false;
    S.money -= it.price;
    if (it.once) S.up[id] = true; else S.stock[id]++;
    return true;
  };
  // La mer ne change pas d'une nuit à l'autre : les récifs s'apprennent
  P.sea = function (S) {
    var r = rng(S.seed), port = r() * TAU, reefs = [], names = REEFS.slice(), tries = 0;
    while (reefs.length < 7 && tries++ < 400) {
      var a = r() * TAU, d = 170 + r() * 340, x = Math.cos(a) * d, y = Math.sin(a) * d, rad = 26 + r() * 24, n = 3 + Math.floor(r() * 3), rocks = [];
      if (reefs.some(function (q) { return Math.hypot(q.x - x, q.y - y) < 210; })) continue;
      for (var i = 0; i < n; i++) { var b = r() * TAU, e = r() * rad * 0.7; rocks.push({ x: x + Math.cos(b) * e, y: y + Math.sin(b) * e, s: 10 + r() * 16, v: Math.floor(r() * 3) }); }
      reefs.push({ x: x, y: y, r: rad, name: names.splice(Math.floor(r() * names.length), 1)[0], rocks: rocks });
    }
    return { reefs: reefs, port: { a: port, x: Math.cos(port) * 950, y: Math.sin(port) * 950 } };
  };

  // ---------- Temps qu'il fait ----------
  function noise(N, x, k) {
    var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    var h = function (n) { var v = Math.sin(n * 127.1 + N.o[k] * 311.7) * 43758.5453; return v - Math.floor(v); };
    return h(i) * (1 - u) + h(i + 1) * u;
  }
  P.weatherAt = function (N, t) {
    var sev = N.sev, fog = clamp((noise(N, t * 3, 0) - (0.8 - sev * 0.45)) * 3.5) * 0.85, rain = clamp((noise(N, t * 2.5, 1) - (0.82 - sev * 0.5)) * 3.5);
    // Première nuit : pas d'orage, mais un banc de brume au milieu du quart pour apprendre la corne
    if (N.first) { rain *= 0.5; fog = Math.max(fog, 0.6 * Math.exp(-Math.pow((t - 0.55) / 0.1, 2))); }
    var blow = clamp(0.12 + sev * 0.3 + (noise(N, t * 4, 2) - 0.5) * 0.5 + rain * 0.3);
    return { fog: fog, rain: rain, wind: blow, storm: rain > 0.5 ? (rain - 0.5) * 2 * blow : 0, cloud: clamp(Math.max(rain * 1.6, fog * 0.8, noise(N, t * 2, 3) * (0.3 + sev))) };
  };
  function forecast(N) {
    var out = [], seen = {};
    for (var i = 1; i <= 20; i++) {
      var w = P.weatherAt(N, i / 20), h = P.clock(i / 20).split(' h')[0] + ' h';
      [['storm', 0.15, 'orage'], ['fog', 0.4, 'brume'], ['rain', 0.4, 'pluie']].forEach(function (k) {
        if (w[k[0]] > k[1] && !seen[k[2]]) { seen[k[2]] = 1; out.push(k[2] + ' vers ' + h); }
      });
    }
    return out.length ? 'Bulletin de la nuit : ' + out.join(', ') + '.' : 'Bulletin de la nuit : ciel clair, mer maniable.';
  }
  P.pressure = function (N) {
    var bad = function (t) { var w = P.weatherAt(N, clamp(t)); return w.rain * 0.6 + w.wind * 0.3 + w.fog * 0.1; };
    var now = bad(N.t), next = bad(N.t + 0.1);
    return { hpa: Math.round(1024 - now * 38), trend: next > now + 0.06 ? 'en baisse' : next < now - 0.06 ? 'en hausse' : 'stable' };
  };

  // ---------- Début et fin de nuit ----------
  P.log = function (N, S, text) { var e = { n: S.night, h: P.clock(N.t), x: text }; S.journal.push(e); N.lines.push(e); };
  function emit(N, type, text) { N.events.push({ type: type, text: text || '' }); }
  function call(N, who, text) { N.radio.push({ h: P.clock(N.t), from: who, x: text, unread: true }); emit(N, 'radio'); }
  P.newBulb = function (N, S) { N.bulb = true; N.bulbLife = (150 + N.r() * 330) * (S.up.filament ? 2 : 1); };

  P.startNight = function (S) {
    var r = rng(S.seed * 7919 + S.night * 104729), sea = P.sea(S), sev = Math.min(1, 0.15 + S.night * 0.09), i;
    var N = { r: r, sea: sea, sev: sev, first: S.night === 1, t: 0, time: 0, o: [r() * 100, r() * 100, r() * 100, r() * 100], ships: [], queue: [], radio: [], events: [], lines: [], flags: {},
      rocks: sea.reefs.concat([{ x: 0, y: 0, r: 24, name: null }]), moon: r() * TAU,
      bulb: true, bulbLife: 0, fuse: true, power: true, lit: true, spring: 0.6, glass: [0.1, 0.1, 0.1, 0.1], horn: false, manual: false, beamA: r() * TAU,
      hand: '', flash: 0, bolt: null, w: null, dark: -1, safe: 0, wrecks: 0, rescued: 0, pay: 0, done: false };
    P.newBulb(N, S); N.bulbLife += 70;
    N.w = P.weatherAt(N, 0);
    var n = Math.min(16, 4 + Math.floor(S.night * 1.3)), names = SHIPS.slice(), edge = function (a) { return { x: Math.cos(a) * 1000, y: Math.sin(a) * 1000 }; };
    for (i = 0; i < n; i++) {
      var kind = r() < 0.5 ? 0 : r() < 0.6 ? 1 : 2, way = r(), a = sea.port.a + 0.7 + r() * (TAU - 1.4), a0, a1;
      if (way < 0.55) { a0 = edge(a); a1 = sea.port; } else if (way < 0.8) { a0 = sea.port; a1 = edge(a); } else { a0 = edge(a); a1 = edge(a + Math.PI + (r() - 0.5) * 1.6); }
      N.queue.push({ at: (0.02 + 0.7 * (i + r()) / n) * NIGHT, kind: kind, name: names.splice(Math.floor(r() * names.length), 1)[0], from: a0, to: a1, a: a });
    }
    if (S.night > 1 && r() < 0.3 + sev * 0.5) N.queue[Math.floor(r() * n)].sos = true;
    P.log(N, S, 'Pris le quart à 20 h. Cuve à ' + Math.round(S.tank * 100) + ' %, ' + count(S.stock.ampoule, 'ampoule', 'ampoules') + ' en réserve.');
    call(N, 'la capitainerie', forecast(N) + ' ' + cap(count(n, 'navire attendu', 'navires attendus')) + ' dans le secteur.');
    return N;
  };

  P.endNight = function (N, S) {
    var clean = N.wrecks === 0 && N.safe + N.rescued > 0, pay = 20 + N.pay;
    if (N.hand) { S.stock[N.hand]++; N.hand = ''; }
    N.t = 1;
    P.log(N, S, 'Jour à 6 h. ' + cap(count(N.safe + N.rescued, 'navire passé', 'navires passés')) + ', ' + (N.wrecks ? count(N.wrecks, 'perdu', 'perdus') : 'aucun perdu') + '.');
    // Une nuit de naufrage coûte un cran de confiance, deux à partir de trois navires perdus
    S.trust = Math.max(0, Math.min(5, S.trust - (N.wrecks >= 3 ? 2 : N.wrecks ? 1 : 0) + (clean ? 1 : 0)));
    S.money += pay; S.saved += N.safe + N.rescued; S.lost += N.wrecks; S.night++; S.over = S.trust <= 0;
    if (S.journal.length > 400) S.journal = S.journal.slice(-400);
    return { pay: pay, clean: clean };
  };

  // ---------- Portée du feu ----------
  P.range = function (N, S, a, manual) {
    if (!N.lit) return 0;
    var w = N.w, dirt = N.glass[P.paneToward(a)], base = 700 * (S.up.lentille ? 1.33 : 1);
    return manual ? base * 1.5 * (1 - 0.5 * w.fog) * (1 - 0.4 * dirt) * (1 - 0.15 * w.rain) : base * (1 - 0.7 * w.fog) * (1 - 0.6 * dirt) * (1 - 0.2 * w.rain);
  };
  P.mood = function (s) {
    if (s.state === 'detresse') return 'en détresse, canot guidé à ' + Math.round(s.held / 8 * 100) + ' %';
    if (s.state === 'naufrage') return 'perdu';
    if (s.state === 'sauve') return 'pris en remorque';
    return s.doubt < 0.3 ? 'fait route' : s.doubt < 0.6 ? 'hésite' : 'ne voit plus le feu';
  };

  // ---------- Navires ----------
  function launch(N, q) {
    var dx = q.to.x - q.from.x, dy = q.to.y - q.from.y, l = Math.hypot(dx, dy), out = q.from === N.sea.port;
    var s = { name: q.name, kind: q.kind, x: q.from.x, y: q.from.y, tx: q.to.x, ty: q.to.y, hx: dx / l, hy: dy / l, speed: [15, 13, 11][q.kind] * (0.9 + N.r() * 0.2),
      doubt: 0, state: 'route', lit: 0, turn: 0, sos: !!q.sos, held: 0, gone: 0, warned: false, toPort: q.to === N.sea.port };
    N.ships.push(s);
    call(N, P.title(s), out ? 'Nous quittons le port, ' + toward(Math.atan2(dy, dx)) + '.' : 'Nous entrons dans votre secteur ' + from(q.a) + (s.toPort ? ', cap sur le port.' : ', en transit.'));
  }
  function sail(N, S, s, dt) {
    var w = N.w, d = Math.hypot(s.x, s.y), bear = Math.atan2(s.y, s.x);
    var on = P.range(N, S, bear, N.manual) > d && Math.abs(P.angdiff(bear, N.beamA)) < (N.manual ? 0.07 : 0.11);
    s.lit = on ? 1 : Math.max(0, s.lit - dt * 2.5);
    if (s.state !== 'route' && s.state !== 'detresse') { s.gone += dt; return; }

    // Récif le plus proche, l'îlot du phare compris
    var near = null, nd = 1e9, nx = 0, ny = 0, ux = s.tx - s.x, uy = s.ty - s.y, ul = Math.hypot(ux, uy), i;
    if (ul < 30 && s.state === 'route') {
      s.state = 'arrive'; N.safe++; N.pay += [12, 18, 8][s.kind];
      P.log(N, S, cap(P.title(s)) + (s.toPort ? ' a doublé les roches et gagné le port.' : ' est sorti du secteur sans encombre.'));
      emit(N, 'tell', cap(P.title(s)) + (s.toPort ? ' est au port.' : ' est passé.'));
      return;
    }
    ux /= ul; uy /= ul;
    var sure = 1 - clamp((s.doubt - 0.3) / 0.5), close = false;
    for (i = 0; i < N.rocks.length; i++) {
      var q = N.rocks[i], rx = s.x - q.x, ry = s.y - q.y, rl = Math.hypot(rx, ry) || 1, gap = rl - q.r;
      if (gap < nd) { nd = gap; near = q; nx = rx / rl; ny = ry / rl; }
      // Un équipage qui voit le feu contourne : il s'écarte et glisse le long de la roche
      if (gap < 150) {
        // Le bord choisi à l'approche est gardé jusqu'au large, sinon le navire hésite devant la roche
        if (!s.turn) s.turn = (-ry * ux + rx * uy) / rl >= 0 ? 1 : -1;
        var k = (150 - gap) / 150; k = (k * 1.6 + k * k * 3) * sure; close = true;
        ux += (rx / rl * 0.7 - ry / rl * s.turn) * k; uy += (ry / rl * 0.7 + rx / rl * s.turn) * k;
      }
    }
    if (!close) s.turn = 0;
    if (nd < -near.r * 0.25) {
      s.state = 'naufrage'; N.wrecks++;
      P.log(N, S, cap(P.title(s)) + (near.name ? ' s\'est ouvert sur ' + near.name + '.' : ' s\'est brisé au pied même du phare.') + (N.lit ? '' : ' Le feu était éteint.'));
      call(N, P.title(s), 'Nous touchons ! Nous touchons ! Nous abandonnons le navire.');
      emit(N, 'wreck', cap(P.title(s)) + ' s\'est perdu' + (near.name ? ' sur ' + near.name + '.' : '.'));
      return;
    }

    if (s.state === 'detresse') {
      if (on && N.manual) s.held += dt;
      if (s.held >= 8) {
        s.state = 'sauve'; N.rescued++; N.pay += 40;
        P.log(N, S, 'Tenu le feu sur ' + P.title(s) + ' jusqu\'à l\'arrivée du canot. Équipage sauf.');
        call(N, 'le canot de sauvetage', 'Nous l\'avons en remorque. Merci, gardien.');
        emit(N, 'tell', 'Le canot a pris ' + P.title(s) + ' en remorque.');
        return;
      }
      s.x -= nx * 3.5 * dt; s.y -= ny * 3.5 * dt;
      return;
    }

    // Le doute : il tombe à chaque passage du faisceau, la corne le contient, la brume et l'orage le creusent
    if (on) s.doubt -= dt * (N.manual ? 3 : 2.6);
    else if (N.horn && N.power && d < 700) { if (s.doubt > 0.3) s.doubt -= dt * 0.15; }
    else if (d < 700) s.doubt += dt * (0.02 + 0.05 * w.fog + 0.035 * w.storm + 0.01 * w.rain);
    else s.doubt -= dt * 0.05;
    s.doubt = clamp(s.doubt);
    if (s.doubt > 0.55 && !s.warned) { s.warned = true; call(N, P.title(s), 'Phare, nous ne voyons plus votre feu. Nous sommes ' + where(bear) + ' de vous.'); emit(N, 'lost'); }
    if (s.doubt < 0.2) s.warned = false;
    if (s.sos && d < 520 && nd > 200) {
      s.sos = false; s.state = 'detresse';
      P.log(N, S, cap(P.title(s)) + ' signale une avarie de machine, ' + where(bear) + '.');
      call(N, P.title(s), 'Détresse ! Machine en avarie, nous dérivons' + (near.name ? ' sur ' + near.name : '') + ', ' + where(bear) + ' du phare. Tenez votre feu sur nous pour guider le canot.');
      emit(N, 'tell', 'Détresse à la radio.'); emit(N, 'lost');
      return;
    }
    // Sans repère, le courant porte sur les roches
    if (s.doubt > 0.35 && nd < 420) { var pull = (s.doubt - 0.35) * 2.6; ux -= nx * pull; uy -= ny * pull; }
    ul = Math.hypot(ux, uy) || 1;
    s.hx += (ux / ul - s.hx) * Math.min(1, dt * 0.9); s.hy += (uy / ul - s.hy) * Math.min(1, dt * 0.9);
    ul = Math.hypot(s.hx, s.hy) || 1; s.hx /= ul; s.hy /= ul;
    var v = s.speed * (1 - 0.35 * s.doubt) * dt;
    s.x += s.hx * v; s.y += s.hy * v;
  }

  // ---------- Un pas de temps ----------
  function notice(N, S, key, v, hi, lo, textOn, textOff) {
    if (v > hi && !N.flags[key]) { N.flags[key] = true; P.log(N, S, textOn); emit(N, key); }
    else if (v < lo && N.flags[key]) { N.flags[key] = false; P.log(N, S, textOff); }
  }
  P.step = function (N, S, dt) {
    var r = N.r, i;
    N.time += dt; N.t = N.time / NIGHT;
    var w = N.w = P.weatherAt(N, N.t);

    // Machines : la cuve nourrit tout, le ressort fait tourner l'optique, les vitres se salissent
    if (S.tank > 0) {
      S.tank -= dt / 230 * (N.horn && N.fuse ? 1.7 : 1);
      if (S.tank <= 0) { S.tank = 0; P.log(N, S, 'Cuve à sec. La génératrice s\'est tue.'); }
    }
    N.power = N.fuse && S.tank > 0;
    if (N.power && N.bulb) { N.bulbLife -= dt; if (N.bulbLife <= 0) { N.bulb = false; P.log(N, S, 'L\'ampoule a claqué.'); emit(N, 'bulb'); } }
    if (!N.manual && N.spring > 0) {
      N.spring -= dt / (S.up.ressort ? 200 : 110); N.beamA = (N.beamA + dt * 0.785) % TAU;
      if (N.spring <= 0) { N.spring = 0; P.log(N, S, 'Le mécanisme s\'est arrêté, faute de remontage.'); emit(N, 'tell', 'Le feu ne tourne plus.'); }
    }
    for (i = 0; i < 4; i++) N.glass[i] = Math.min(1, N.glass[i] + dt * (0.0012 + w.rain * w.wind * 0.012 + w.fog * 0.002) * (S.up.vernis ? 0.5 : 1));

    N.flash = Math.max(0, N.flash - dt * 2.5);
    if (w.storm > 0 && r() < w.storm * 0.12 * dt) {
      N.flash = 1; N.bolt = { a: r() * TAU, k: r() * 100 }; emit(N, 'thunder');
      if (N.fuse && r() < (S.up.para ? 0.04 : 0.22)) { N.fuse = false; N.power = false; P.log(N, S, 'La foudre a fait sauter le fusible.'); emit(N, 'fuse'); }
    }
    N.lit = N.power && N.bulb;
    if (!N.lit && N.dark < 0) N.dark = N.time;
    if (N.lit && N.dark >= 0) {
      var min = Math.round((N.time - N.dark) * 600 / NIGHT);
      if (min > 3) P.log(N, S, 'Feu rallumé après ' + min + ' minutes d\'obscurité.');
      N.dark = -1;
    }
    notice(N, S, 'fog', w.fog, 0.35, 0.15, 'La brume monte du large.', 'La brume se lève.');
    notice(N, S, 'rain', w.rain, 0.4, 0.15, 'Il pleut dru.', 'La pluie a cessé.');
    notice(N, S, 'storm', w.storm, 0.15, 0.02, 'Orage sur le secteur.', 'L\'orage s\'éloigne.');

    while (N.queue.length && N.queue[0].at <= N.time) launch(N, N.queue.shift());
    for (i = 0; i < N.ships.length; i++) sail(N, S, N.ships[i], dt);
    N.ships = N.ships.filter(function (s) { return s.state !== 'arrive' && s.gone < 25; });
    if (N.time >= NIGHT) N.done = true;
  };
})(typeof window !== 'undefined' ? window : globalThis);
