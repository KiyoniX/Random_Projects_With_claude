// Le quart de nuit : commandes, gestes du gardien, affichage, écrans et son.
(function () {
  'use strict';

  var P = window.Phare, R = P.render, $ = function (s) { return document.querySelector(s); };
  var KEY = 'phare.quart', canvas = $('#view');
  var ITEM = { b: 'bidon', a: 'ampoule', u: 'fusible' }, UN = { bidon: 'un bidon', ampoule: 'une ampoule', fusible: 'un fusible' }, LE = { bidon: 'le bidon', ampoule: 'l\'ampoule', fusible: 'le fusible' };
  var PANES = ['nord', 'est', 'sud', 'ouest'], TITLES = { journal: 'Journal de bord', radio: 'Cahier de veille radio', carte: 'Carte du secteur' }, COLS = { journal: 'Observations du gardien', radio: 'Messages reçus' };
  // Tant qu'on est à l'accueil, S est une carrière de démonstration : la mer tourne derrière le titre
  var S = P.newCareer(1907), N, mode = 'title', tm = 0, last = 0, panel = '', shown = -1, keys = {}, turn = 0, tilt = 0, tapped = false, wasLit = true, hints = {}, sayUntil = 0, nextClick = 0, nextTick = 0, shownText = {};
  var pl = { x: 9.5, y: 5.5, a: 0, pitch: -14, level: 2 };
  S.night = 4; S.up.lentille = true;
  N = P.startNight(S);

  var pct = function (v) { return Math.round(v * 100) + ' %'; };
  var cellAt = function (x, y) { return P.LEVELS[pl.level][Math.floor(y)].charAt(Math.floor(x)); };
  var solid = function (x, y) { var c = cellAt(x, y); return c !== ' ' && c !== '.'; };
  function el(tag, text, cls) { var e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
  function line(h, text, cls) { var p = el('p', '', 'ligne' + (cls ? ' ' + cls : '')); p.appendChild(el('time', h)); p.appendChild(el('span', text)); return p; }
  function set(id, text) { if (shownText[id] !== text) { shownText[id] = text; $(id).textContent = text; } }
  function tell(text, seconds) { sayUntil = tm + seconds; set('#say', text); $('#say').style.opacity = 1; }
  function load() { try { var s = JSON.parse(localStorage.getItem(KEY)); return s && s.v === 1 && !s.over ? s : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* stockage refusé : la partie continue sans sauvegarde */ } }
  // La graine de la carrière se lit dans l'adresse, après le # : un nombre tel quel, un mot réduit à un nombre ; sans rien, elle est tirée au sort
  function hashText() { try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; } }
  function seedOf(text) {
    if (/^\d{1,9}$/.test(text)) return +text;
    for (var h = 0, i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1e9;
    return text ? h : Math.floor(Math.random() * 1e9);
  }
  function toHash(seed) {
    var t = hashText();
    if (t && seedOf(t) === seed) return;
    try { history.replaceState(null, '', '#' + seed); } catch (e) { location.replace('#' + seed); }   // Chrome refuse replaceState en file://
  }

  // ---------- Déplacements ----------
  function move(dt) {
    var ahead = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    pl.a += ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * dt * 2.2 + turn; turn = 0;
    pl.pitch = Math.max(-110, Math.min(110, pl.pitch + tilt)); tilt = 0;
    if (!ahead && !strafe) return;
    if (panel) closePanel();
    var n = Math.hypot(ahead, strafe), sp = 2.5 * dt / n, vx = (Math.cos(pl.a) * ahead - Math.sin(pl.a) * strafe) * sp, vy = (Math.sin(pl.a) * ahead + Math.cos(pl.a) * strafe) * sp, r = 0.2;
    if (!solid(pl.x + vx + Math.sign(vx) * r, pl.y - r) && !solid(pl.x + vx + Math.sign(vx) * r, pl.y + r)) pl.x += vx;
    if (!solid(pl.x - r, pl.y + vy + Math.sign(vy) * r) && !solid(pl.x + r, pl.y + vy + Math.sign(vy) * r)) pl.y += vy;
  }
  function climb(d) {
    var rows = P.LEVELS[pl.level + d], want = d > 0 ? '<' : '>';
    for (var y = 0; y < rows.length; y++) { var x = rows[y].indexOf(want); if (x >= 0) { pl.x = x + 0.5; pl.y = y - 0.5; } }
    pl.level += d; pl.a = -Math.PI / 2; pl.pitch = 0;
    canvas.classList.remove('step'); void canvas.offsetWidth; canvas.classList.add('step');
    for (var i = 0; i < 4; i++) crash(260, 0.09, 0.14, i * 0.13);
  }

  // ---------- Ce que le gardien a devant lui, et ce qu'il peut en faire ----------
  function target() {
    var c = Math.cos(pl.a), s = Math.sin(pl.a);
    for (var d = 0.1; d < 1.5; d += 0.05) { var x = Math.floor(pl.x + c * d), y = Math.floor(pl.y + s * d), ch = P.LEVELS[pl.level][y].charAt(x); if (ch !== ' ' && ch !== '.') return { ch: ch, x: x, y: y }; }
    return null;
  }
  function rattle(freq) { if (tm > nextClick) { nextClick = tm + 0.09; beep(freq, 0.02, 0.03, 0, 'square'); } }
  function look(t) {
    var ch = t.ch, hand = N.hand, it = ITEM[ch];
    if (it) {
      if (hand === it) return { text: 'E — reposer ' + LE[it], tap: function () { N.hand = ''; S.stock[it]++; R.stock(S); beep(180, 0.06, 0.06); } };
      if (hand) return { text: 'Tu tiens déjà ' + LE[hand] + '.' };
      if (!S.stock[it]) return { text: 'L\'étagère est vide.' };
      return { text: 'E — prendre ' + UN[it] + ' (il en reste ' + S.stock[it] + ')', tap: function () { N.hand = it; S.stock[it]--; R.stock(S); beep(240, 0.06, 0.06); } };
    }
    switch (ch) {
      case 'k':
        if (N.manual) return { text: 'Le feu est tenu à la main : le mécanisme est débrayé.' };
        return { text: 'Maintenir E — remonter le mécanisme (' + pct(N.spring) + ')', hold: function (dt) { N.spring = Math.min(1, N.spring + dt * 0.45); rattle(800 + N.spring * 700); } };
      case 'h':
        if (!N.power) return { text: 'Corne de brume. Sans courant, elle reste muette.' };
        return { text: 'E — corne de brume : ' + (N.horn ? 'l\'arrêter' : 'la mettre en marche'), tap: function () { N.horn = !N.horn; P.log(N, S, N.horn ? 'Corne de brume en marche.' : 'Corne de brume arrêtée.'); beep(300, 0.08, 0.07); } };
      case 'v':
        return { text: N.manual ? 'E — rendre le feu au mécanisme' : 'E — prendre le feu en main', tap: function () {
          N.manual = !N.manual; beep(200, 0.1, 0.07);
          tell(N.manual ? 'Le feu suit ton regard. Tiens-le sur le navire.' : 'Le feu est rendu au mécanisme.', 4);
        } };
      case 'L':
        if (!N.bulb) return hand === 'ampoule' ? { text: 'E — changer l\'ampoule', tap: function () { P.newBulb(N, S); N.hand = ''; P.log(N, S, 'Ampoule changée.'); beep(520, 0.12, 0.07); } } : { text: 'L\'ampoule est morte. Il y en a au cellier, sur l\'étagère.' };
        return { text: N.power ? 'L\'optique. L\'ampoule tient bon.' : 'L\'ampoule est bonne, mais le courant n\'arrive plus.' };
      case 'G':
        var side = P.paneAt(t.x, t.y), dirt = N.glass[side];
        if (cellAt(pl.x, pl.y) !== '.') return dirt > 0.3 ? { text: 'Vitre ' + PANES[side] + ' encrassée à ' + pct(dirt) + '. Elle se nettoie depuis la galerie.' } : null;
        return dirt < 0.02 ? { text: 'Vitre ' + PANES[side] + ' : propre.' } : { text: 'Maintenir E — nettoyer la vitre ' + PANES[side] + ' (' + pct(dirt) + ' de sel)', hold: function (dt) { N.glass[side] = Math.max(0, dirt - dt * 0.6); if (tm > nextClick) { nextClick = tm + 0.16; crash(2600, 0.07, 0.05); } } };
      case '>': return { text: 'E — monter ' + P.ROOMS[pl.level + 1], tap: function () { climb(1); } };
      case '<': return { text: 'E — descendre ' + P.ROOMS[pl.level - 1], tap: function () { if (N.manual) { N.manual = false; } climb(-1); } };
      case 'g':
        var state = 'Génératrice, cuve à ' + pct(S.tank) + '. ';
        if (hand !== 'bidon') return { text: state + (S.tank < 0.3 ? 'Les bidons sont sur l\'étagère.' : '') };
        if (S.tank > 0.93) return { text: state + 'Elle est pleine.' };
        return { text: state + 'E — verser le bidon', tap: function () { S.tank = Math.min(1, S.tank + 0.55); N.hand = ''; P.log(N, S, 'Versé un bidon dans la cuve.'); crash(500, 0.9, 0.12); } };
      case 'f':
        if (N.fuse) return { text: 'Tableau électrique. Le fusible est bon.' };
        return hand === 'fusible' ? { text: 'E — remplacer le fusible', tap: function () { N.fuse = true; N.hand = ''; P.log(N, S, 'Fusible remplacé.'); beep(660, 0.1, 0.07); } } : { text: 'Fusible sauté. Il y en a sur l\'étagère.' };
      case 'j': return { text: 'E — lire le journal de bord', tap: function () { openPanel('journal'); } };
      case 'r':
        if (!N.power) return { text: 'La radio est muette sans courant.' };
        return { text: 'E — écouter la radio', tap: function () { openPanel('radio'); } };
      case 'c': return { text: 'E — consulter la carte', tap: function () { openPanel('carte'); } };
      case 'm': var pr = P.pressure(N); return { text: 'Baromètre : ' + pr.hpa + ' hPa, ' + pr.trend + '.' };
      case 'l': return { text: 'Pas avant le jour.' };
      case 'P': return { text: 'Dehors, la nuit et la mer. Ta place est ici.' };
    }
    return null;
  }

  // ---------- Journal, radio et carte ----------
  function openPanel(kind) {
    panel = kind; shown = -1;
    $('#panel').hidden = false; $('#chart').hidden = kind !== 'carte'; $('#panel-body').hidden = kind === 'carte';
    $('#panel-title').textContent = TITLES[kind]; $('#panel-cols').hidden = kind === 'carte'; $('#panel-signs').hidden = kind !== 'carte'; $('#panel-col').textContent = COLS[kind] || '';
    beep(340, 0.05, 0.04);
  }
  function closePanel() { panel = ''; $('#panel').hidden = true; }
  function fill() {
    var body = $('#panel-body'), night = 0;
    if (panel === 'carte') { chart(); return; }
    var list = panel === 'journal' ? S.journal.slice(-14) : N.radio.slice(-7);
    if ((panel === 'journal' ? S.journal.length : N.radio.length) === shown) return;
    shown = panel === 'journal' ? S.journal.length : N.radio.length;
    body.textContent = '';
    list.forEach(function (e) {
      if (panel === 'journal') { if (e.n !== night) { night = e.n; body.appendChild(el('h3', 'Nuit ' + e.n)); } body.appendChild(line(e.h, e.x)); }
      else { body.appendChild(line(e.h, P.cap(e.from) + ' : ' + e.x, e.unread ? 'new' : '')); e.unread = false; }
    });
  }
  // Carte marine : roches en croix dans leur ligne de danger, feu en étoile, secteur éclairé en jaune.
  // Un navire se lit à son signe : plein s'il fait route, creux s'il hésite, cerclé de rouge s'il ne voit plus le feu, croix s'il est perdu.
  function chart() {
    var c = $('#chart'), g = c.getContext('2d'), W = c.width, u = W / 340, k = W / 2 / 1060, m = function (v) { return W / 2 + v * k; }, port = N.sea.port, rg = P.range(N, S, N.beamA, N.manual), i;
    var INK = '#1b1b18', RED = '#b02a20', PAPER = '#ece5cf';
    g.fillStyle = PAPER; g.fillRect(0, 0, W, W);
    g.lineWidth = u; g.strokeStyle = '#9db3c4'; g.setLineDash([4 * u, 4 * u]); g.beginPath(); g.arc(W / 2, W / 2, 700 * k, 0, 7); g.stroke(); g.setLineDash([]);
    if (rg) { g.fillStyle = 'rgba(232,170,40,.5)'; g.beginPath(); g.moveTo(W / 2, W / 2); g.arc(W / 2, W / 2, rg * k, N.beamA - 0.11, N.beamA + 0.11); g.fill(); }
    g.textAlign = 'center'; g.strokeStyle = g.fillStyle = INK;
    N.sea.reefs.forEach(function (q) {
      g.setLineDash([u, 3 * u]); g.beginPath(); g.arc(m(q.x), m(q.y), Math.max(5 * u, q.r * k + 3 * u), 0, 7); g.stroke(); g.setLineDash([]);
      g.beginPath(); q.rocks.forEach(function (r) { g.moveTo(m(r.x) - 3 * u, m(r.y)); g.lineTo(m(r.x) + 3 * u, m(r.y)); g.moveTo(m(r.x), m(r.y) - 3 * u); g.lineTo(m(r.x), m(r.y) + 3 * u); }); g.stroke();
      g.font = 'italic ' + 11 * u + 'px Cambria, Georgia, serif'; g.fillText(P.cap(q.name), m(q.x), m(q.y) - q.r * k - 7 * u);
    });
    g.font = 11 * u + 'px Cambria, Georgia, serif';
    g.fillRect(m(port.x) - 4 * u, m(port.y) - 4 * u, 8 * u, 8 * u); g.fillText('Port', m(port.x), m(port.y) + (port.y > 0 ? -8 : 16) * u);
    g.fillText('N', W / 2, 15 * u); g.beginPath(); g.moveTo(W / 2, 18 * u); g.lineTo(W / 2, 30 * u); g.stroke();
    g.fillStyle = RED; g.beginPath(); for (i = 0; i < 10; i++) g.lineTo(W / 2 + Math.sin(i * 0.6283) * (i % 2 ? 2.4 : 6) * u, W / 2 - Math.cos(i * 0.6283) * (i % 2 ? 2.4 : 6) * u); g.fill();
    N.ships.forEach(function (s) {
      var lost = s.state === 'detresse' || s.doubt > 0.55;
      g.save(); g.translate(m(s.x), m(s.y)); g.lineWidth = 1.6 * u; g.strokeStyle = g.fillStyle = lost ? RED : INK;
      if (s.state === 'naufrage') { g.beginPath(); g.moveTo(-5 * u, -5 * u); g.lineTo(5 * u, 5 * u); g.moveTo(5 * u, -5 * u); g.lineTo(-5 * u, 5 * u); g.stroke(); }
      else {
        if (lost) { g.beginPath(); g.arc(0, 0, 11 * u, 0, 7); g.stroke(); }
        g.rotate(Math.atan2(s.hy, s.hx)); g.beginPath(); g.moveTo(8 * u, 0); g.lineTo(-5 * u, 5 * u); g.lineTo(-5 * u, -5 * u); g.closePath();
        if (!lost && s.doubt > 0.3) g.fillStyle = PAPER;
        g.fill(); g.stroke();
      }
      g.restore();
      g.fillStyle = INK; g.fillText(s.name, m(s.x), m(s.y) + 21 * u);
    });
  }

  // ---------- Affichage ----------
  function studs(n) { for (var h = '', i = 0; i < 5; i++) h += i < n ? '<i class="on"></i>' : '<i></i>'; return h; }
  function needle(id, deg) { deg = Math.round(deg); if (shownText[id] !== deg) { shownText[id] = deg; $(id).style.transform = 'rotate(' + deg + 'deg)'; } }
  function hud(lk) {
    var dial = function (id, v) { needle(id, v * 240 - 120); $(id).parentNode.classList.toggle('bad', v < 0.2); };
    var fire = !N.lit ? 'éteint' : N.manual ? 'à la main' : N.spring > 0 ? 'tourne' : 'fixe', aim = R.aim, hour = 'Nuit ' + S.night + ', ' + P.clock(N.t);
    // La pendule de quart fait son tour de cadran en dix heures ; son guichet donne le numéro de la nuit
    needle('#g-clock', P.clamp(N.t) * 300 - 150); set('#nuit', String(S.night));
    if (shownText.hour !== hour) { shownText.hour = hour; $('#clock').setAttribute('aria-label', hour); }
    if (shownText.trust !== S.trust) { shownText.trust = S.trust; $('#trust').innerHTML = studs(S.trust); $('#trust').setAttribute('aria-label', 'Confiance : ' + S.trust + ' sur 5'); }
    set('#hand', N.hand ? UN[N.hand] : 'rien');
    set('#g-fire', fire); $('#g-fire').className = fire === 'éteint' || fire === 'fixe' ? 'bad' : ''; $('#lampe').parentNode.classList.toggle('lit', N.lit);
    dial('#g-spring', N.spring); dial('#g-tank', S.tank); dial('#g-glass', 1 - (N.glass[0] + N.glass[1] + N.glass[2] + N.glass[3]) / 4);
    $('#call').classList.toggle('on', N.power && N.radio.some(function (r) { return r.unread; }));
    set('#aim', aim && !panel ? P.cap(P.title(aim)) + ', ' + P.mood(aim) : '');
    set('#prompt', lk && !panel ? lk.text : '');
    if (tm > sayUntil) $('#say').style.opacity = 0;
    if (panel) fill();
  }
  // Première nuit : quelques mots pour trouver ses marques
  function guide() {
    if (wasLit && !N.lit) tell('Le feu s\'est éteint.', 5);
    wasLit = N.lit;
    if (!N.first) return;
    var hint = function (k, when, text) { if (!hints[k] && when) { hints[k] = true; tell(text, 9); } };
    hint('a', N.time > 1.5, 'Le mécanisme, la corne et le volant sont en haut, dans la lanterne. L\'escalier est derrière toi.');
    hint('b', N.time > 22, 'Surveille les cadrans : le ressort se remonte là-haut, la cuve se remplit au cellier.');
    hint('c', N.time > 12 && N.w.fog > 0.25, 'La brume monte. Mets la corne en marche, dans la lanterne.');
    hint('d', N.time > 45 && N.radio.some(function (r) { return r.unread; }), 'La radio a parlé. Elle est au mur nord de la chambre de veille, près du journal.');
  }
  function events() {
    for (var i = 0; i < N.events.length; i++) {
      var e = N.events[i];
      if (e.type === 'thunder') crash(160, 2.6, 0.55, 0.3 + Math.random() * 1.4);
      else if (e.type === 'radio') { if (N.power) { beep(880, 0.08, 0.05); beep(1175, 0.08, 0.05, 0.12); } }
      else if (e.type === 'bulb') crash(3000, 0.12, 0.3);
      else if (e.type === 'fuse') crash(1200, 0.3, 0.3);
      else if (e.type === 'wreck') { tell(e.text, 7); crash(220, 1.8, 0.4); beep(70, 1.6, 0.12, 0, 'sawtooth'); }
      else if (e.type === 'lost') { beep(130, 0.9, 0.06, 0, 'sawtooth'); beep(130, 0.9, 0.06, 1.2, 'sawtooth'); }
      else if (e.type === 'tell') tell(e.text, 5);
    }
    N.events.length = 0;
  }

  // ---------- Son : mer, vent, pluie, génératrice, corne ----------
  var au = null;
  function sound() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (au || !AC) return;
    var a = new AC(), out = a.createGain(), low = a.createBiquadFilter(), buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    out.gain.value = 0.7; out.connect(a.destination); low.type = 'lowpass'; low.frequency.value = 320; low.connect(out);
    var hiss = function (type, freq) { var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); s.buffer = buf; s.loop = true; f.type = type; f.frequency.value = freq; g.gain.value = 0; s.connect(f); f.connect(g); g.connect(out); s.start(); return { f: f, g: g }; };
    var drone = function (freqs) { var g = a.createGain(); g.gain.value = 0; freqs.forEach(function (fq) { var o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq; o.connect(g); o.start(); }); g.connect(low); return g; };
    au = { ctx: a, out: out, buf: buf, sea: hiss('lowpass', 480), wind: hiss('bandpass', 700), rain: hiss('highpass', 3200), gen: drone([52, 104.5, 156]), horn: drone([98, 147, 98.6]) };
  }
  function beep(freq, dur, vol, delay, type) {
    if (!au) return;
    var a = au.ctx, t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(au.out); o.start(t); o.stop(t + dur + 0.05);
  }
  function crash(freq, dur, vol, delay) {
    if (!au) return;
    var a = au.ctx, t = a.currentTime + (delay || 0), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = au.buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(au.out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function ambience() {
    if (!au) return;
    var now = au.ctx.currentTime, w = N.w, out = cellAt(pl.x, pl.y) === '.', lv = pl.level, vol = mode === 'play' ? 1 : 0.4;
    var to = function (p, v) { p.setTargetAtTime(v, now, 0.15); };
    to(au.sea.g.gain, (0.05 + w.wind * 0.12) * (out ? 1 : lv === 2 ? 0.5 : 0.3) * (1 + 0.3 * Math.sin(tm * 0.7)) * vol);
    to(au.wind.g.gain, w.wind * 0.1 * (out ? 1 : 0.35) * vol); to(au.wind.f.frequency, 500 + w.wind * 600 + Math.sin(tm * 0.9) * 150);
    to(au.rain.g.gain, w.rain * 0.1 * (out ? 1 : 0.45) * vol);
    to(au.gen.gain, S.tank > 0 ? [0.1, 0.03, 0.008][lv] * vol : 0);
    to(au.horn.gain, N.horn && N.power && tm % 9 < 2.2 ? (lv === 2 ? 0.16 : 0.07) * vol : 0);
    // Le tic-tac du mécanisme, tant qu'il tourne
    if (mode === 'play' && lv === 2 && !N.manual && N.spring > 0 && tm > nextTick) { nextTick = tm + 0.5; beep(1900, 0.02, 0.025, 0, 'square'); }
  }

  // ---------- Écrans ----------
  function card(html, cls) { $('#card').className = 'card' + (cls ? ' ' + cls : ''); $('#card').innerHTML = html; $('#veil').hidden = false; }
  function grab() { var p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(function () {}); }
  var head = function (right) { return '<p class="entete"><span>Service des Phares et Balises</span><span>' + right + '</span></p>'; };
  // Le seul geste de ces pages : signer le registre
  var sign = function (id, label, text, quiet) { return '<p class="signe"><span>' + label + '</span><button type="button" id="' + id + '"' + (quiet ? ' class="quiet"' : '') + '>' + text + '</button></p>'; };
  function title() {
    var saved = load(), seed = seedOf(hashText());
    card('<div class="page">' + head('Feu n° ' + seed) + '<h1>Le quart de nuit</h1>' +
      '<p class="lead">Un phare, dix heures d\'obscurité, des navires qui comptent sur toi. Tiens le feu jusqu\'au jour.</p>' +
      '<h2>Consignes au gardien</h2><ol>' +
      '<li><b>ZQSD, WASD ou flèches</b> pour marcher, <b>souris</b> pour regarder, <b>E</b> pour agir.</li>' +
      '<li>Le feu a besoin de courant, d\'une ampoule et d\'un mécanisme remonté. Tout cela tombe en panne.</li>' +
      '<li>Dans la brume, la corne prend le relais. Les vitres se salissent et se nettoient depuis la galerie.</li>' +
      '<li>Au volant, tu braques le feu toi-même sur un navire perdu ou en détresse.</li>' +
      '<li><b>J</b> ouvre le journal de bord. Il s\'écrit seul.</li></ol>' +
      sign('start', 'Le gardien', 'Je prends le quart') + (saved ? sign('resume', 'ou bien', 'Je reprends à la nuit ' + saved.night, true) : '') +
      '<p class="hint">Échap rend la souris. Mets le son.</p></div>');
    $('#start').onclick = function () { S = P.newCareer(seed); save(); begin(); };
    if (saved) $('#resume').onclick = function () { S = saved; begin(); };
  }
  function begin() {
    sound(); toHash(S.seed);
    N = P.startNight(S); R.stock(S);
    pl.level = 1; pl.x = 5.5; pl.y = 6.5; pl.a = -Math.PI / 2; pl.pitch = 0;
    wasLit = true; hints = {}; panel = ''; keys = {};
    mode = 'play'; $('#veil').hidden = true; $('#hud').hidden = false; $('#panel').hidden = true;
    tell('Nuit ' + S.night + '. Le quart commence.', 4);
    grab();
  }
  function pause() {
    mode = 'pause'; keys = {};
    card('<div class="page">' + head('Feu n° ' + S.seed) + '<h1>Le feu attend</h1><p class="lead">Nuit ' + S.night + ', ' + P.clock(N.t) + '. La mer ne bouge plus tant que tu n\'es pas revenu.</p>' + sign('back', 'Le gardien', 'Je reprends le quart') + '</div>', 'billet');
    $('#back').onclick = function () { mode = 'play'; $('#veil').hidden = true; grab(); };
  }
  function relief() {
    var night = S.night, rep = P.endNight(N, S), c;
    mode = 'report'; closePanel(); $('#hud').hidden = true;
    if (document.exitPointerLock) document.exitPointerLock();
    if (S.over) { try { localStorage.removeItem(KEY); } catch (e) { /* rien à effacer */ } } else save();
    c = sign('next', 'Le gardien', S.over ? 'Je demande une autre affectation' : 'Je prends le quart suivant');
    card('<div class="page">' + head('Feu n° ' + S.seed) + '<h1>Nuit ' + night + ', la relève</h1><p class="cols"><span>Heure</span><span>Observations du gardien</span></p><div class="log" id="log"></div><table class="tally" id="tally"></table><p class="lead" id="verdict"></p>' + (S.over ? c : '') + '</div>' +
      (S.over ? '' : '<div class="page">' + head('Passage du ravitailleur') + '<h2>Bon de ravitaillement</h2><p class="cols bon"><span>Désignation</span><span>Prix</span><span>Commande</span></p><div class="shop" id="shop"></div>' + c + '</div>'), S.over ? 'billet' : 'double');
    c = $('#log'); N.lines.forEach(function (e) { c.appendChild(line(e.h, e.x)); });
    $('#verdict').textContent = S.over ? 'Les Phares et Balises te relèvent de tes fonctions. Bilan : ' + night + (night > 1 ? ' nuits, ' : ' nuit, ') + S.saved + (S.saved > 1 ? ' navires passés, ' : ' navire passé, ') + S.lost + (S.lost > 1 ? ' perdus.' : ' perdu.')
      : N.wrecks ? 'Une nuit de naufrage entame la confiance des Phares et Balises. À zéro, on te retire le phare.'
        : rep.clean ? 'Nuit sans perte : la confiance des Phares et Balises grandit. Le ravitailleur passe ce matin.' : 'Nuit calme. Le ravitailleur passe ce matin.';
    $('#next').onclick = function () { if (S.over) { S = P.newCareer(Math.floor(Math.random() * 1e9)); save(); } begin(); };
    shop(rep);
  }
  function shop(rep) {
    var tally = $('#tally'), box = $('#shop'), tr;
    tally.textContent = '';
    [['Passés', N.safe], ['Secourus', N.rescued], ['Perdus', N.wrecks], ['Solde de la nuit', rep.pay + ' F'], ['Caisse', S.money + ' F'], ['Confiance', '●'.repeat(S.trust) + '○'.repeat(5 - S.trust)]].forEach(function (t, i) {
      if (i % 3 === 0) tr = tally.appendChild(el('tr'));
      tr.appendChild(el('th', t[0])); tr.appendChild(el('td', String(t[1])));
    });
    if (S.over) return;
    box.textContent = '';
    // Une case par article : un « + » à la plume pour en commander un de plus, une coche pour ce qui est acquis
    P.SHOP.forEach(function (it) {
      var got = !!(it.once && S.up[it.id]), row = el('div'), p = el('p'), b = el('button', got ? '✓' : '+', got ? 'acquis' : '');
      p.appendChild(el('b', it.name)); p.appendChild(document.createTextNode(it.note + (it.once ? '' : ' En réserve : ' + S.stock[it.id] + '.')));
      b.type = 'button'; b.disabled = S.money < it.price || got;
      b.setAttribute('aria-label', got ? it.name + ' : acquis' : 'Commander : ' + it.name + ', ' + it.price + ' F');
      b.onclick = function () { if (P.buy(S, it.id)) { save(); R.stock(S); beep(520, 0.08, 0.06); shop(rep); } };
      row.appendChild(p); row.appendChild(el('span', it.price + ' F')); row.appendChild(b); box.appendChild(row);
    });
  }

  // ---------- Boucle ----------
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - last) / 1000 || 0), lk = null;
    last = now;
    if (mode === 'title') {
      // Derrière le titre : la galerie, la mer, et un phare qui ne tombe jamais en panne
      tm += dt; S.tank = 1; N.spring = 1; N.bulbLife = 99; N.fuse = true;
      P.step(N, S, dt); N.events.length = 0;
      if (N.done) N = P.startNight(S);
      pl.a = Math.sin(tm * 0.08) * 0.9;
    } else if (mode === 'play') {
      tm += dt; move(dt);
      if (N.manual) { if (pl.level !== 2 || cellAt(pl.x, pl.y) === '.') { N.manual = false; tell('Le feu est rendu au mécanisme.', 3); } else N.beamA = pl.a; }
      var t = target(); lk = t && look(t);
      if (lk && lk.hold && keys.KeyE && !panel) lk.hold(dt);
      if (tapped) { if (panel) closePanel(); else if (lk && lk.tap) { lk.tap(); lk = null; } }
      tapped = false;
      P.step(N, S, dt); events(); guide();
      if (N.done) { relief(); return; }
      hud(lk);
    }
    R.frame(N, S, pl, tm);
    ambience();
  }

  document.addEventListener('keydown', function (e) {
    if (mode !== 'play') return;
    if (e.code === 'KeyE' && !e.repeat) tapped = true;
    if (e.code === 'KeyJ' && !e.repeat) { if (panel === 'journal') closePanel(); else openPanel('journal'); }
    keys[e.code] = true;
    if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
  });
  document.addEventListener('keyup', function (e) { keys[e.code] = false; });
  document.addEventListener('mousemove', function (e) { if (document.pointerLockElement === canvas) { turn += e.movementX * 0.0023; tilt -= e.movementY * 0.8; } });
  document.addEventListener('pointerlockchange', function () { if (document.pointerLockElement !== canvas && mode === 'play') pause(); });
  canvas.addEventListener('click', function () { if (mode === 'play') grab(); });

  window.addEventListener('hashchange', function () { if (mode === 'title') title(); });

  R.init(canvas, S);
  title();
  requestAnimationFrame(loop);
})();
