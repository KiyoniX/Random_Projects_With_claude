// Les couloirs oublient : commandes, son, affichage et écrans.
(function () {
  'use strict';

  var C = window.Couloirs, G = C.G, $ = function (s) { return document.querySelector(s); };
  var KEY = 'couloirs.record', canvas = $('#view'), mapCtx = $('#map').getContext('2d');
  var mode = 'title', keys = {}, held = false, turn = 0, tilt = 0, last = 0, frame = 0, stepIn = 0, breathIn = 0, shown = {}, blur = '', label = '';
  var inp = { ahead: 0, strafe: 0, sprint: false, mirror: false };

  function set(id, text) { if (shown[id] !== text) { shown[id] = text; $(id).textContent = text; } }
  function bar(id, v, bad) { var e = $(id); e.style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; e.className = bad ? 'bad' : ''; }
  function clock(t) { var s = Math.floor(t % 60); return Math.floor(t / 60) + ':' + (s < 10 ? '0' : '') + s; }
  function record() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function plural(n, word) { return n + ' ' + word + (n > 1 ? 's' : ''); }
  // Graine : un nombre de 1 à 999999 sert tel quel ; tout autre texte (la graine commune de la ludothèque) est réduit à un nombre
  function seedOf(text) {
    var n = /^\d+$/.test(text) ? parseInt(text, 10) % 1000000 : 0, h = 2166136261;
    if (n > 0 || !text) return n;
    for (var i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return 1 + (h >>> 0) % 999999;
  }
  function hashSeed() { try { return decodeURIComponent(location.hash.slice(1)).trim().slice(0, 24); } catch (e) { return ''; } }

  // ---------- Son : néons, deux bourdonnements possibles, grondement, pas et souffle ----------
  var au = null;
  function sound() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (au || !AC) return;
    var a = new AC(), out = a.createGain(), low = a.createBiquadFilter(), neon = a.createGain(), buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    out.gain.value = 0.5; out.connect(a.destination); low.type = 'lowpass'; low.frequency.value = 420; low.connect(out); neon.connect(low);
    var voice = function (type, freq, gain, to) { var o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = freq; g.gain.value = gain; o.connect(g); g.connect(to); o.start(); return g; };
    [[120, 0.05], [180, 0.025], [60, 0.05]].forEach(function (h) { voice('sawtooth', h[0], h[1], neon); });
    // Un bourdonnement : une note qui bat, étouffée quand elle vient de derrière, placée à gauche ou à droite
    var beacon = function (beat) {
      var gate = a.createGain(), lp = a.createBiquadFilter(), pan = a.createStereoPanner ? a.createStereoPanner() : null, g = voice('sine', 660, 0, gate);
      gate.gain.value = 0.5; voice('sine', beat, 0.5, gate.gain); lp.type = 'lowpass'; gate.connect(lp);
      if (pan) { lp.connect(pan); pan.connect(out); } else lp.connect(out);
      return { g: g, lp: lp, pan: pan };
    };
    au = { ctx: a, out: out, buf: buf, neon: neon, exit: beacon(2.2), mime: beacon(2.7), growl: voice('sawtooth', 46, 0, low) };
  }
  function beep(freq, dur, vol, delay, type) {
    if (!au) return;
    var a = au.ctx, t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(au.out); o.start(t); o.stop(t + dur + 0.05);
  }
  function crash(freq, dur, vol, kind) {
    if (!au) return;
    var a = au.ctx, t = a.currentTime, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = au.buf; f.type = kind || 'lowpass'; f.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(au.out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // Force d'un bourdonnement et angle sous lequel on l'entend
  function hum(x, y) {
    var p = G.player, d = Math.hypot(x - p.x, y - p.y), rel = Math.atan2(y - p.y, x - p.x) - p.a;
    return { s: 1 / (1 + d * 0.12), rel: Math.atan2(Math.sin(rel), Math.cos(rel)) };
  }
  function hear(dt) {
    var p = G.player, e = hum(G.exit.x + 0.5, G.exit.y + 0.5), fake = G.mobs.filter(function (m) { return m.kind === 'mime' && m.on && !m.lunge; })[0], f = fake ? hum(fake.x, fake.y) : null;
    // Le souffle court couvre tout
    var ears = 1 - 0.9 * p.breath, moving = inp.ahead || inp.strafe;
    bar('#signal', Math.max(e.s, f ? f.s : 0) * ears);
    if (!au) return;
    var now = au.ctx.currentTime, place = function (b, h) {
      b.g.gain.setTargetAtTime(h ? h.s * 0.22 * ears : 0, now, 0.1);
      if (!h) return;
      b.lp.frequency.setTargetAtTime(520 + 3200 * Math.max(0, Math.cos(h.rel)), now, 0.1);
      if (b.pan) b.pan.pan.setTargetAtTime(Math.sin(h.rel), now, 0.1);
    };
    place(au.exit, e); place(au.mime, f);
    au.neon.gain.setTargetAtTime(G.spec.dark ? 0 : 1, now, 0.3);
    au.growl.gain.setTargetAtTime(Math.max(0, 1 - G.near / 10) * 0.5, now, 0.15);
    if (moving && (stepIn -= dt * (p.sprint ? 2.1 : 1)) <= 0) { stepIn = 0.44; crash(p.sprint ? 700 : 420, 0.07, p.sprint ? 0.18 : 0.06); }
    if (p.breath > 0.25 && (breathIn -= dt) <= 0) { breathIn = 0.95 - p.breath * 0.45; crash(900, 0.36, p.breath * 0.16, 'bandpass'); }
  }
  function events() {
    for (var i = 0; i < G.events.length; i++) {
      var e = G.events[i];
      if (e === 'shift') crash(140, 0.5, 0.22);
      else if (e === 'blink') crash(300, 0.12, 0.05);
      else if (e === 'door') { crash(260, 0.4, 0.32); beep(180, 0.2, 0.05); }
      else if (e === 'pick') beep(880, 0.12, 0.06);
      else if (e === 'mark') crash(1800, 0.15, 0.08);
      else if (e === 'click') beep(1400, 0.03, 0.05, 0, 'square');
      else if (e === 'caught') crash(180, 1.2, 0.5);
      else if (e === 'level') { beep(520, 0.4, 0.07); beep(780, 0.5, 0.07, 0.15); }
      else if (e === 'win') end();
    }
    G.events.length = 0;
  }

  // ---------- Affichage ----------
  // Le plan : ce qu'on a vu, tel qu'on l'a vu. Quand un mur change, le tracé s'efface ou reste, faux.
  function map() {
    var p = G.player, s = G.size, cx = Math.floor(p.x), cy = Math.floor(p.y), g = mapCtx;
    g.clearRect(0, 0, 186, 186);
    for (var j = -15; j <= 15; j++) for (var i = -15; i <= 15; i++) {
      var x = cx + i, y = cy + j, m = x < 0 || y < 0 || x >= s || y >= s ? 0 : G.memo[y * s + x], px = (i + 15) * 6, py = (j + 15) * 6, tenu = m > 1 && G.pin[y * s + x] === 1;
      if (!m) continue;
      // Sol blanc, mur noir, sortie verte ; et une forme par signe : sortie encadrée, porte évidée, mur tenu par le ruban percé, note bordée
      g.fillStyle = m === 1 ? '#f4f3ec' : m === 3 ? '#00874a' : m === 4 ? '#16181a' : tenu ? '#c4161c' : m === 5 ? '#f9a900' : '#16181a';
      g.fillRect(px, py, 6, 6);
      if (m === 3) { g.fillRect(px - 3, py - 3, 12, 2); g.fillRect(px - 3, py + 7, 12, 2); g.fillRect(px - 3, py - 3, 2, 12); g.fillRect(px + 7, py - 3, 2, 12); }
      else if (m === 4 || tenu) { g.fillStyle = '#f4f3ec'; g.fillRect(px + (tenu ? 2 : 1), py + (tenu ? 2 : 1), tenu ? 2 : 4, tenu ? 2 : 4); }
      else if (m === 5) { g.fillStyle = '#16181a'; g.fillRect(px, py, 6, 1); g.fillRect(px, py + 5, 6, 1); g.fillRect(px, py, 1, 6); g.fillRect(px + 5, py, 1, 6); }
    }
    // « Tu es ici » : une flèche bleue cernée de blanc
    g.save(); g.translate(93, 93); g.rotate(p.a); g.fillStyle = '#f4f3ec'; g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, 8); g.lineTo(-7, -8); g.fill();
    g.fillStyle = '#00558c'; g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 5.5); g.lineTo(-5, -5.5); g.fill(); g.restore();
  }
  function hud(dt) {
    var p = G.player, pool = G.spec.theme === 'piscine', i = G.look, wanted = p.breath > 0.3 ? 'blur(' + ((p.breath - 0.3) * 3.5).toFixed(1) + 'px)' : '';
    set('#level', 'Palier ' + G.level); set('#place', G.theme.name + (G.spec.dark ? ', dans le noir' : ''));
    set('#clock', clock(G.clock));
    set('#marks', 'Ruban ' + G.marks);
    set('#caught', G.caught ? plural(G.caught, 'réveil') : '');
    $('#row-breath').hidden = p.stamina > 0.98; bar('#breath', p.stamina, p.winded);
    $('#row-lamp').hidden = !G.spec.dark; bar('#lamp', p.battery, p.battery < 0.15);
    $('#row-blink').hidden = !pool; bar('#blink', 1 - p.blink, p.blink > 0.8);
    $('#mirror').hidden = !p.mirrorUp;
    set('#note', i >= 0 && G.cell[i] === 4 && G.lookD < 2.6 ? '« ' + G.notes[i] + ' »' : '');
    set('#say', G.say); $('#say').style.opacity = G.time > G.sayUntil ? 0 : 1;
    // Le souffle court brouille la vue
    if (wanted !== blur) { blur = wanted; canvas.style.filter = wanted; }
    if (frame++ % 5 === 0) map();
    hear(dt);
  }

  // ---------- Écrans ----------
  function veil(band, title, lead, button, start) {
    $('#band').textContent = band; $('#title').textContent = title; $('#lead').textContent = lead; $('#go').textContent = button;
    $('#rules').hidden = !start && mode === 'end'; $('.seed').hidden = !start; $('#veil').hidden = false; $('#veil').className = mode === 'end' ? 'veil fin' : 'veil';
  }
  function begin() {
    sound();
    if (au && au.ctx.state === 'suspended') au.ctx.resume();
    if (mode !== 'pause') {
      var typed = $('#seed').value.trim(), seed = seedOf(typed) || 1 + Math.floor(Math.random() * 999999);
      C.newGame(seed); label = typed || String(seed);
      // location.replace plutôt que history.replaceState, que Chrome refuse sur une page ouverte en file://
      try { location.replace(location.href.split('#')[0] + '#' + encodeURIComponent(label)); } catch (e) { /* page ouverte hors navigateur */ }
    }
    mode = 'play'; keys = {}; held = false;
    $('#veil').hidden = true; $('#hud').hidden = false;
    if (canvas.requestPointerLock) { var lock = canvas.requestPointerLock(); if (lock && lock.catch) lock.catch(function () { /* souris non capturée : les flèches tournent la tête */ }); }
  }
  function pause() {
    if (mode !== 'play') return;
    mode = 'pause';
    veil('Rappel des consignes', 'Les couloirs attendent', 'Palier ' + G.level + ', ' + G.theme.name + '. Plan n° ' + label + '.', 'Reprendre', false);
  }
  function end() {
    var best = record(), mine = { t: Math.round(G.clock), c: G.caught, seed: label }, better = !best || mine.t < best.t;
    mode = 'end'; $('#hud').hidden = true; canvas.style.filter = blur = '';
    if (document.exitPointerLock) document.exitPointerLock();
    if (better) { try { localStorage.setItem(KEY, JSON.stringify(mine)); } catch (e) { /* pas de stockage : le record ne sera pas gardé */ } }
    veil('Point de rassemblement', 'Tu es sorti', 'Dix paliers en ' + clock(mine.t) + ', ' + (mine.c ? plural(mine.c, 'réveil') : 'sans un seul réveil') + '. Plan n° ' + mine.seed + '. ' +
      (better ? (best ? 'Nouveau record : l\'ancien était de ' + clock(best.t) + '.' : 'C\'est ton premier record.') : 'Ton record reste ' + clock(best.t) + '.'), 'Redescendre', false);
    $('#seed').value = '';
  }
  function title() {
    var best = record();
    veil('Consignes en cas d\'égarement', 'Les couloirs oublient', 'Tu es passé à travers le sol. Dix paliers te séparent de la sortie, et aucun n\'oublie de la même façon.', 'Entrer', true);
    $('#hint').textContent = 'Échap rend la souris. Mets le son.' + (best ? ' Record : ' + clock(best.t) + ', ' + plural(best.c, 'réveil') + ', plan n° ' + best.seed + '.' : '');
  }

  // ---------- Boucle ----------
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0)), p = G.player;
    last = now;
    if (mode !== 'play') return;
    p.a += ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * dt * 2.2 + turn; turn = 0;
    p.pitch = Math.max(-90, Math.min(90, p.pitch + tilt)); tilt = 0;
    inp.ahead = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0); inp.strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    inp.sprint = !!(keys.ShiftLeft || keys.ShiftRight); inp.mirror = !!(keys.KeyR || held);
    C.step(dt, inp);
    events();
    if (mode !== 'play') return;
    C.draw(); hud(dt);
  }

  document.addEventListener('keydown', function (e) {
    // Les codes sont physiques : sur un clavier AZERTY, Z et Q occupent la place de W et A et portent leur code
    if (mode === 'play') {
      keys[e.code] = true;
      if (!e.repeat) { if (e.code === 'KeyE') C.mark(); else if (e.code === 'KeyF') C.lamp(); else if (e.code === 'Space') C.blink(); else if (e.code === 'Escape') pause(); }
      if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
    }
  });
  document.addEventListener('keyup', function (e) { keys[e.code] = false; });
  document.addEventListener('mousemove', function (e) { if (mode === 'play' && document.pointerLockElement === canvas) { turn += e.movementX * 0.0026; tilt -= e.movementY * 0.7; } });
  document.addEventListener('mousedown', function (e) { if (e.button === 2) held = true; });
  document.addEventListener('mouseup', function (e) { if (e.button === 2) held = false; });
  document.addEventListener('contextmenu', function (e) { if (mode === 'play') e.preventDefault(); });
  document.addEventListener('pointerlockchange', function () { if (document.pointerLockElement !== canvas && mode === 'play' && G.locked) pause(); G.locked = document.pointerLockElement === canvas; });
  canvas.addEventListener('click', function () { if (mode === 'play' && canvas.requestPointerLock && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
  window.addEventListener('blur', function () { keys = {}; held = false; });
  $('#start').addEventListener('click', function () { if (mode === 'end') { mode = 'title'; title(); } else begin(); });
  window.addEventListener('hashchange', function () { if (mode === 'title') $('#seed').value = hashSeed(); });

  // Derrière l'accueil : le premier palier, immobile
  C.init(canvas, $('#mirror'));
  C.newGame(1);
  C.draw();
  $('#seed').value = hashSeed();
  title();
  requestAnimationFrame(loop);
})();
