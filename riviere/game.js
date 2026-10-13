(function () {
  'use strict';

  var P = window.PlanVille, R = window.Riviere, S = R.sim, st = S.state;
  var NX = R.NX, NY = R.NY, CELL = R.CELL, PX = R.PX, STATION = R.STATION;

  var SPEEDS = [8, 24, 48];     // pas de simulation par image
  var FRAME_MS = 12;            // au-delà, l'image rend la main même s'il reste des pas à faire
  var CAL_MS = 30;              // temps donné à l'étalonnage par image
  var NT = 800;                 // traceurs
  var MAX_PILES = 6;
  var PILE_GAP = 2.6;           // écart entre deux piles, en cases
  var TOISES = 5;               // toises par unité du plan, comme dans Plans de ville
  var WARN = 0.8;               // part des quais à partir de laquelle un quartier est menacé
  var INK = '#3d2f21', STONE = '#7a5d43', GROUND = '#f1e5c6', ROOF = '#b99d75', RED = '#b3402a', OK = '#4f7a3a';
  var WASH = '222, 178, 62';   // gomme-gutte : le jaune des ouvrages projetés
  var GRID = 6;                // la grille de simulation se montre quand une case fait au moins ce nombre de pixels
  // Dégradés : position, rouge, vert, bleu.
  var RAMPS = {
    courant: [0, 226, 236, 226, 0.3, 141, 187, 196, 0.6, 54, 116, 150, 0.85, 30, 58, 104, 1, 60, 30, 76],
    niveau: [0, 200, 224, 220, 0.4, 222, 214, 150, 0.7, 226, 164, 84, 0.8, 204, 96, 60, 1, 150, 36, 34]
  };
  var TOOLS = {
    pont: 'Clique une traversée lavée de jaune pour y jeter un pont. Sur un pont bâti, clique le tablier pour y ajouter une pile : des arches plus courtes coûtent moins cher, mais chaque pile freine l\'eau.',
    moulin: 'Pose une roue dans l\'eau, le long des quartiers (60 écus). Elle rend selon le cube de la vitesse du courant qui la traverse, et le freine.',
    digue: 'Trace un mur dans l\'eau, le long des quartiers (4 écus la case), pour rabattre le courant vers une roue. Plus tu resserres, plus l\'eau monte.',
    quai: 'Clique la berge d\'un quartier pour rehausser ses quais de moitié (5 écus par longueur de berge). Clique encore pour les défaire.',
    deplacer: 'Fais glisser une roue, une pile le long de son pont, une digue ou l\'un de ses bouts.',
    retirer: 'Clique un ouvrage pour le retirer : roue, digue, pile, quai, ou pont entier en cliquant son tablier.'
  };

  var $ = function (s) { return document.querySelector(s); };

  // ---------- État ----------
  var canvas = $('#vue'), ctx = canvas.getContext('2d');
  // trail : le sillage des traceurs, tenu à la taille de l'écran pour rester net quand on regarde de près.
  var field = layer(NX, NY), trail = layer(8, 8), fieldImg = field.ctx.createImageData(NX, NY);
  var LUT = { courant: ramp(RAMPS.courant), niveau: ramp(RAMPS.niveau) };
  var TX = new Float32Array(NT), TY = new Float32Array(NT), TA = new Float32Array(NT);
  var refSt = new Float64Array(0);

  // city : la ville ouverte. paint et src : cases à colorier et case du lit dont chacune prend la valeur.
  var city = null, river = null, clip = null, paint = new Int32Array(0), src = new Int32Array(0), bedList = new Int32Array(0);
  // norm et crue : derniers relevés stables, avec la disposition qu'ils jugent.
  var ui = {
    tool: 'pont', piles: 1, view: 'plan', paused: false, speed: 1,
    works: [], undo: [], redo: [], hx: -1, hy: -1, hover: null, drag: null, tick: 0, spin: new Float32Array(64),
    norm: null, crue: null, stars: 0
  };
  var save = { best: {} };

  var view = window.VuePlanche.create({
    cadre: $('#carte'), feuille: $('#feuille'), px: PX, loupe: $('#loupe'), mention: $('#grossi'),
    // Les onglets des outils occupent le bord gauche de la table tant qu'elle est assez large.
    marge: function () {
      var wide = $('#carte').clientWidth > 620;
      return { l: wide ? 104 : 8, t: wide ? 10 : 44, r: wide ? 14 : 8, b: wide ? 10 : 84 };
    },
    glisse: function (e) { return e.button === 0 && e.shiftKey; },
    saisie: function () {
      if (ui.drag && ui.drag.kind !== 'trace' && !ui.drag.moved) ui.undo.pop();
      ui.drag = null;
    },
    change: wipe
  });

  function wipe() {
    trail.ctx.setTransform(1, 0, 0, 1, 0, 0);
    trail.ctx.clearRect(0, 0, trail.cv.width, trail.cv.height);
  }
  function layer(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return { cv: cv, ctx: cv.getContext('2d') };
  }
  function ramp(stops) {
    var lut = new Uint8Array(768), i, k, t, a, j;
    for (i = 0; i < 256; i++) {
      t = i / 255; k = 0;
      while (k + 8 < stops.length && t > stops[k + 4]) k += 4;
      a = Math.min(1, Math.max(0, (t - stops[k]) / (stops[k + 4] - stops[k])));
      for (j = 1; j <= 3; j++) lut[i * 3 + j - 1] = stops[k + j] + (stops[k + 4 + j] - stops[k + j]) * a;
    }
    return lut;
  }
  function fmt(v) { return (Math.abs(v) < 0.05 ? 0 : v).toFixed(1).replace('.', ','); }
  function starText(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(n); }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

  // ---------- Sauvegarde ----------
  function loadSave() {
    try {
      var s = JSON.parse(localStorage.getItem('riviere.v1'));
      if (s && s.best) save = s;
    } catch (e) { /* stockage indisponible : on joue sans mémoire */ }
  }
  function writeSave() {
    try { localStorage.setItem('riviere.v1', JSON.stringify(save)); } catch (e) { /* idem */ }
  }

  // ---------- Ville ----------
  function open(seed, size, from) {
    var plan = P.plan(seed, size, from), address = encodeURIComponent(seed) + '/' + size + (from ? '?' + from.query : '');
    var c, x, y, dx, dy, o, list = [], from0 = [], beds = [], i;
    river = R.tracer(seed, size, plan, from ? from.milieu : '');
    city = { seed: seed, size: size, from: from, address: address, key: seed + '/' + size, plan: plan };
    S.load(river);
    $('#plan').innerHTML = river.svg;
    clip = new Path2D(river.outline + river.island);
    // Les cases de rive prennent la couleur de leur voisine du lit : la teinte va ainsi jusqu'au trait de berge.
    for (y = 0; y < NY; y++) {
      for (x = 0; x < NX; x++) {
        c = y * NX + x; o = -1;
        if (river.bed[c]) { o = c; beds.push(c); }
        else for (dy = -1; dy <= 1 && o < 0; dy++) for (dx = -1; dx <= 1 && o < 0; dx++) {
          if (x + dx >= 0 && x + dx < NX && y + dy >= 0 && y + dy < NY && river.bed[c + dy * NX + dx]) o = c + dy * NX + dx;
        }
        if (o >= 0) { list.push(c); from0.push(o); }
      }
    }
    paint = new Int32Array(list); src = new Int32Array(from0); bedList = new Int32Array(beds);
    refSt = new Float64Array(river.nSt);
    for (i = 0; i < fieldImg.data.length; i++) fieldImg.data[i] = 0;
    for (i = 0; i < NT; i++) spawn(i, true);
    wipe();
    ui.works = []; ui.undo = []; ui.redo = []; ui.hover = null; ui.drag = null; ui.norm = null; ui.crue = null; ui.stars = 0;

    $('#graine').value = seed; $('#taille').value = size;
    $('#ville').textContent = plan.name;
    $('#cours').textContent = 'sur ' + river.name;
    document.title = plan.name + ' sur ' + river.name + ', rivières et moulins';
    $('#legende').textContent = plan.size.charAt(0).toUpperCase() + plan.size.slice(1) + (plan.people ? ' des ' + plan.people : '') + ', ' + plural(river.crossings.length, 'traversée', 'traversées') + ' à relier, ' +
      plural(river.wards.length, 'quartier riverain', 'quartiers riverains') + (river.isle ? ', une île' : '') + '.';
    $('#versPlan').href = '../plans-de-ville/index.html#' + address;
    $('#attente').hidden = false;
    try { history.replaceState(null, '', '#' + address); } catch (e) { location.replace('#' + address); }   // Chrome refuse replaceState en file://
    view.entier();
    hud();
  }

  function readAddress() {
    var a = P.parse(location.hash.slice(1));
    open(a.seed || Math.random().toString(36).slice(2, 8), a.size, a.from);
  }

  // Les seuils ne sont connus qu'une fois le fleuve nu mesuré.
  function onReady() {
    var i, top = st.stars[2] * 1.3;
    $('#attente').hidden = true;
    for (i = 0; i < 3; i++) $('#seuil' + i).style.left = (st.stars[i] / top * 100) + '%';
    $('#seuils').textContent = 'Étoiles à ' + fmt(st.stars[0] * S.UNIT) + ', ' + fmt(st.stars[1] * S.UNIT) + ' et ' + fmt(st.stars[2] * S.UNIT) + ' sacs ; la troisième, crue tenue.';
    $('#repere').style.bottom = (100 / 1.3) + '%';
    for (i = 0; i < NT; i++) spawn(i, true);
    hud();
  }

  // ---------- Chantier ----------
  function key() { return JSON.stringify(ui.works); }
  function pushUndo() {
    ui.undo.push(key());
    if (ui.undo.length > 80) ui.undo.shift();
    ui.redo = [];
  }
  function apply() { S.setWorks(ui.works); ui.hover = null; }
  function undo() {
    if (!ui.undo.length) return;
    ui.redo.push(key());
    ui.works = JSON.parse(ui.undo.pop());
    apply();
  }
  function redo() {
    if (!ui.redo.length) return;
    ui.undo.push(key());
    ui.works = JSON.parse(ui.redo.pop());
    apply();
  }
  function reset() {
    if (!st.ready) return;
    pushUndo();
    ui.works = [];
    S.setRegime(0);
    apply();
    S.restore(st.bare);
  }

  function bridgeOf(cr) {
    for (var i = 0; i < ui.works.length; i++) if (ui.works[i].t === 'pont' && ui.works[i].cr === cr) return i;
    return -1;
  }
  function quayOf(w) {
    for (var i = 0; i < ui.works.length; i++) if (ui.works[i].t === 'quai' && ui.works[i].w === w) return i;
    return -1;
  }
  // Une pile tient dans l'eau, à l'écart des autres piles du pont.
  function pileFits(o, t, skip) {
    var f = river.crossings[o.cr], p, x = f.gax + (f.gbx - f.gax) * t, y = f.gay + (f.gby - f.gay) * t;
    if (!(t > 0 && t < 1) || !river.bed[(y | 0) * NX + (x | 0)]) return false;
    for (p = 0; p < o.piles.length; p++) if (p !== skip && Math.abs(o.piles[p] - t) * f.glen < PILE_GAP) return false;
    return true;
  }
  function segment(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0, c = t < 0 ? 0 : t > 1 ? 1 : t;
    dx = ax + dx * c - px; dy = ay + dy * c - py;
    return { t: t, d: Math.sqrt(dx * dx + dy * dy) };
  }
  // Quartier dont la berge passe sous le pointeur, ou -1.
  function bankWard(x, y) {
    var px = x * CELL, py = y * CELL, i = river.nearest(px, py), lat, d, w, k;
    lat = (px - river.x[i]) * -river.ty[i] + (py - river.y[i]) * river.tx[i];
    d = Math.abs(lat) - river.hw[i];
    if (d < -10 || d > 18) return -1;
    w = river.stWard[((i / STATION) | 0) * 2 + (lat > 0 ? 0 : 1)];
    for (k = 0; k < river.wards.length; k++) if (river.wards[k].i === w) return k;
    return -1;
  }
  // Ce que désigne le pointeur, du plus petit ouvrage au plus grand.
  function pick(x, y) {
    var i, p, o, s, pt, f, best = null, d;
    for (i = 0; i < ui.works.length; i++) {
      o = ui.works[i];
      if (o.t === 'moulin') {
        d = Math.sqrt((o.x - x) * (o.x - x) + (o.y - y) * (o.y - y));
        if (d < 3.4 && (!best || d < best.d)) best = { kind: 'moulin', i: i, d: d };
      }
    }
    if (best) return best;
    for (i = 0; i < ui.works.length; i++) {
      o = ui.works[i];
      if (o.t !== 'pont') continue;
      for (p = 0; p < o.piles.length; p++) {
        pt = S.pilePoint(o, p);
        if ((pt.x - x) * (pt.x - x) + (pt.y - y) * (pt.y - y) < 2.4 * 2.4) return { kind: 'pile', i: i, p: p };
      }
    }
    for (i = 0; i < ui.works.length; i++) {
      o = ui.works[i];
      if (o.t !== 'digue') continue;
      if ((o.x0 - x) * (o.x0 - x) + (o.y0 - y) * (o.y0 - y) < 4) return { kind: 'digue', i: i, end: 0 };
      if ((o.x1 - x) * (o.x1 - x) + (o.y1 - y) * (o.y1 - y) < 4) return { kind: 'digue', i: i, end: 1 };
      if (segment(x, y, o.x0, o.y0, o.x1, o.y1).d < 1.7) return { kind: 'digue', i: i, end: -1 };
    }
    for (i = 0; i < river.crossings.length; i++) {
      f = river.crossings[i];
      s = segment(x, y, f.gax, f.gay, f.gbx, f.gby);
      if (s.d < 2.6) return { kind: 'pont', cr: i, i: bridgeOf(i), t: s.t };
    }
    i = bankWard(x, y);
    return i < 0 ? null : { kind: 'berge', w: i };
  }

  function remove(h) {
    var o;
    if (!h || h.kind === 'pont' && h.i < 0) return;
    if (h.kind === 'berge') { h = { i: quayOf(h.w) }; if (h.i < 0) return; }
    pushUndo();
    o = ui.works[h.i];
    if (h.kind === 'pile') o.piles.splice(h.p, 1);
    else ui.works.splice(h.i, 1);
    apply();
  }

  function press(x, y, erase) {
    var h = pick(x, y), o;
    if (erase || ui.tool === 'retirer') { remove(h); return; }
    if (ui.tool === 'pont') {
      if (!h || h.kind !== 'pont' && h.kind !== 'pile') return;
      if (h.kind === 'pile') return;
      if (h.i < 0) { pushUndo(); ui.works.push({ t: 'pont', cr: h.cr, piles: S.evenPiles(h.cr, ui.piles) }); apply(); return; }
      o = ui.works[h.i];
      if (o.piles.length < MAX_PILES && pileFits(o, h.t, -1)) { pushUndo(); o.piles.push(h.t); o.piles.sort(function (a, b) { return a - b; }); apply(); }
    } else if (ui.tool === 'moulin') {
      if (S.canMill(x, y, ui.works, -1)) { pushUndo(); ui.works.push({ t: 'moulin', x: x, y: y }); apply(); }
    } else if (ui.tool === 'digue') {
      ui.drag = { kind: 'trace', x0: x, y0: y, x1: x, y1: y };
    } else if (ui.tool === 'quai') {
      if (!h || h.kind !== 'berge') return;
      pushUndo();
      if (quayOf(h.w) >= 0) ui.works.splice(quayOf(h.w), 1); else ui.works.push({ t: 'quai', w: h.w });
      apply();
    } else if (ui.tool === 'deplacer' && h && (h.kind === 'moulin' || h.kind === 'pile' || h.kind === 'digue')) {
      pushUndo();
      ui.drag = { kind: h.kind, i: h.i, p: h.p, end: h.end, lx: x, ly: y, moved: false };
    }
  }

  function dragTo(x, y) {
    var d = ui.drag, o, f, t, dx, dy, trial;
    if (d.kind === 'trace') { d.x1 = x; d.y1 = y; return; }
    o = ui.works[d.i];
    if (d.kind === 'moulin') {
      if (!S.canMill(x, y, ui.works, d.i)) return;
      o.x = x; o.y = y;
    } else if (d.kind === 'pile') {
      f = river.crossings[o.cr];
      t = segment(x, y, f.gax, f.gay, f.gbx, f.gby).t;
      if (!pileFits(o, t, d.p)) return;
      o.piles[d.p] = t;
    } else {
      dx = x - d.lx; dy = y - d.ly;
      trial = { t: 'digue', x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 };
      if (d.end !== 1) { trial.x0 += dx; trial.y0 += dy; }
      if (d.end !== 0) { trial.x1 += dx; trial.y1 += dy; }
      d.lx = x; d.ly = y;
      if (!S.canDike(trial)) return;
      o.x0 = trial.x0; o.y0 = trial.y0; o.x1 = trial.x1; o.y1 = trial.y1;
    }
    d.moved = true;
    S.setWorks(ui.works);
  }

  function release() {
    var d = ui.drag, o;
    ui.drag = null;
    if (!d) return;
    if (d.kind === 'trace') {
      o = { t: 'digue', x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 };
      if (S.canDike(o)) { pushUndo(); ui.works.push(o); apply(); }
    } else if (!d.moved) ui.undo.pop();
    else if (d.kind === 'pile') ui.works[d.i].piles.sort(function (a, b) { return a - b; });
  }

  // ---------- Boucle ----------
  function frame() {
    var t0 = performance.now(), n = 0, want;
    if (!st.ready) {
      do { S.calibrate(25); n += 25; } while (!st.ready && performance.now() - t0 < CAL_MS);
      if (st.ready) onReady();
    } else if (!ui.paused) {
      want = SPEEDS[ui.speed];
      while (n < want) {
        S.step(); n++;
        if ((n & 3) === 0 && performance.now() - t0 > FRAME_MS) break;
      }
    }
    if (n) moveTracers(n > 60 ? 60 : n);
    draw();
    if (ui.tick++ % 6 === 0) hud();
    requestAnimationFrame(frame);
  }

  // Relève le verdict dès que la mesure est stable : au débit ordinaire la production, en crue la tenue.
  function judge() {
    var s = S.settled(), k, complete, cost, best, crueOk;
    if (!st.ready) return null;
    k = key();
    if (s && st.regime === 0 && S.phi() < 0.01) ui.norm = { key: k, prod: s.prod, flooded: S.flooded().length };
    if (s && st.regime === 1 && S.phi() > 0.99) ui.crue = { key: k, ok: !S.flooded().length };
    complete = S.bridged() === river.crossings.length;
    cost = S.totalCost(ui.works);
    crueOk = !!(ui.crue && ui.crue.key === k && ui.crue.ok);
    ui.stars = ui.norm && ui.norm.key === k && complete && cost <= st.budget && !ui.norm.flooded ? S.starsFor(ui.norm.prod, crueOk) : 0;
    best = save.best[city.key];
    if (ui.stars > 0 && (!best || ui.stars > best.e || ui.stars === best.e && ui.norm.prod * S.UNIT > best.p)) {
      save.best[city.key] = { p: ui.norm.prod * S.UNIT, e: ui.stars };
      writeSave();
    }
    return s;
  }

  // ---------- Traceurs ----------
  function spawn(i, anywhere) {
    var f = S.fields(), c = -1, k, cells = river.inlet.cells;
    if (!anywhere && Math.random() < 0.6) c = cells[(Math.random() * cells.length) | 0] + river.inlet.off;
    for (k = 0; k < 8 && (c < 0 || f.solid[c]); k++) c = bedList[(Math.random() * bedList.length) | 0];
    TX[i] = c % NX + Math.random(); TY[i] = ((c / NX) | 0) + Math.random();
    TA[i] = 50 + Math.random() * 260;
  }

  function moveTracers(n) {
    var g = trail.ctx, f = S.fields(), ux = f.ux, uy = f.uy, solid = f.solid, sub = Math.ceil(n / 8), h = n / sub, i, k, c, x, y, nx, ny;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.11)';
    g.fillRect(0, 0, trail.cv.width, trail.cv.height);
    g.globalCompositeOperation = 'source-over';
    view.repere(g);
    g.strokeStyle = ui.view === 'plan' ? 'rgba(52,96,116,0.4)' : 'rgba(255,255,255,0.6)';
    g.lineWidth = 1.1 / Math.pow(view.zoom, 0.6);
    g.beginPath();
    for (i = 0; i < NT; i++) {
      x = TX[i]; y = TY[i]; nx = x; ny = y;
      for (k = 0; k < sub; k++) {
        if (!(nx >= 1 && ny >= 1 && nx < NX - 1 && ny < NY - 1)) break;
        c = (ny | 0) * NX + (nx | 0);
        nx += ux[c] * h; ny += uy[c] * h;
      }
      if (--TA[i] < 0 || !(nx >= 1 && ny >= 1 && nx < NX - 1 && ny < NY - 1) || solid[(ny | 0) * NX + (nx | 0)]) { spawn(i, false); continue; }
      g.moveTo(x * CELL, y * CELL); g.lineTo(nx * CELL, ny * CELL);
      TX[i] = nx; TY[i] = ny;
    }
    g.stroke();
  }

  // ---------- Affichage ----------
  function paintField() {
    var d = fieldImg.data, f = S.fields(), lut = LUT[ui.view], level = ui.view === 'niveau', i, c, s, j, v, p = S.phi(), inv = 255 / (1.25 * st.free);
    if (level) for (j = 0; j < river.nSt; j++) refSt[j] = f.ref0[j] + (f.ref1[j] - f.ref0[j]) * p - S.SURGE * st.free * p;
    for (i = 0; i < paint.length; i++) {
      c = paint[i]; s = src[i]; j = c * 4;
      if (f.solid[s]) { d[j + 3] = 0; continue; }
      if (level) v = (f.rho[s] - refSt[river.st[s]]) * inv;
      else v = Math.sqrt(f.ux[s] * f.ux[s] + f.uy[s] * f.uy[s]) * 1900;
      v = v > 255 ? 255 : v > 0 ? v | 0 : 0;
      d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2]; d[j + 3] = 235;
    }
    field.ctx.putImageData(fieldImg, 0, 0);
  }

  function polygon(poly) {
    ctx.beginPath();
    for (var i = 0; i < poly.length; i++) if (i) ctx.lineTo(poly[i].x, poly[i].y); else ctx.moveTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }

  // Quartiers inondés en bleu, quartiers menacés cernés de rouge. Les mentions s'écrivent à part, par-dessus le fleuve.
  function drawWards(labels) {
    var wd = S.wards(), w, r, poly, x, y, i;
    if (!st.ready) return;
    for (w = 0; w < river.wards.length; w++) {
      r = wd.level[w] / wd.limit[w];
      if (r < WARN || labels && r <= 1) continue;
      poly = river.wards[w].poly;
      polygon(poly);
      if (labels) {
        for (i = 0, x = 0, y = 0; i < poly.length; i++) { x += poly[i].x; y += poly[i].y; }
        ctx.font = 'italic 700 15px \'Palatino Linotype\', Georgia, serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(241,229,198,0.9)'; ctx.strokeText('inondé', x / poly.length, y / poly.length - 12);
        ctx.fillStyle = '#1f4159'; ctx.fillText('inondé', x / poly.length, y / poly.length - 12);
      } else if (r > 1) {
        ctx.fillStyle = 'rgba(72,124,158,0.5)'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#2c5673'; ctx.setLineDash([]); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(179,64,42,0.10)'; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = RED; ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  function bankLine(w) {
    var banks = river.wards[w].banks, b, j, s, i, i1, first;
    ctx.beginPath();
    for (b = 0; b < banks.length; b++) {
      j = banks[b] >> 1; s = banks[b] & 1 ? -1 : 1;
      i1 = Math.min(river.n - 1, (j + 1) * STATION + 1); first = true;
      for (i = j * STATION; i <= i1; i += 2) {
        if (first) ctx.moveTo(river.x[i] - s * river.ty[i] * (river.hw[i] + 2.5), river.y[i] + s * river.tx[i] * (river.hw[i] + 2.5));
        else ctx.lineTo(river.x[i] - s * river.ty[i] * (river.hw[i] + 2.5), river.y[i] + s * river.tx[i] * (river.hw[i] + 2.5));
        first = false;
      }
    }
  }
  function drawQuays() {
    var i, o;
    ctx.lineCap = 'butt';
    for (i = 0; i < ui.works.length; i++) {
      o = ui.works[i];
      if (o.t !== 'quai') continue;
      bankLine(o.w);
      ctx.lineWidth = 6.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.lineWidth = 4; ctx.strokeStyle = STONE; ctx.stroke();
    }
  }

  function deck(f, half) {
    var l = f.glen * CELL, nx = -(f.by - f.ay) / l * half, ny = (f.bx - f.ax) / l * half;
    ctx.beginPath();
    ctx.moveTo(f.ax + nx, f.ay + ny); ctx.lineTo(f.bx + nx, f.by + ny); ctx.lineTo(f.bx - nx, f.by - ny); ctx.lineTo(f.ax - nx, f.ay - ny);
    ctx.closePath();
  }
  function pileShape(o, p, grow) {
    var pt = S.pilePoint(o, p), x = pt.x * CELL, y = pt.y * CELL, w = S.PILE_W * CELL + grow, l = S.PILE_L * CELL + grow, vx = -pt.uy, vy = pt.ux;
    ctx.beginPath();
    ctx.moveTo(x + pt.ux * w + vx * l, y + pt.uy * w + vy * l);
    ctx.lineTo(x + vx * (l + 4), y + vy * (l + 4));
    ctx.lineTo(x - pt.ux * w + vx * l, y - pt.uy * w + vy * l);
    ctx.lineTo(x - pt.ux * w - vx * l, y - pt.uy * w - vy * l);
    ctx.lineTo(x - vx * (l + 4), y - vy * (l + 4));
    ctx.lineTo(x + pt.ux * w - vx * l, y + pt.uy * w - vy * l);
    ctx.closePath();
  }
  function drawBridges() {
    var j, f, b, o, p, hot;
    for (j = 0; j < river.crossings.length; j++) {
      f = river.crossings[j]; b = bridgeOf(j);
      hot = ui.hover && ui.hover.kind === 'pont' && ui.hover.cr === j;
      if (b < 0) {
        deck(f, 5.5);
        ctx.fillStyle = 'rgba(' + WASH + (hot && ui.tool === 'pont' ? ',0.85)' : ',0.5)'); ctx.fill();
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      o = ui.works[b];
      for (p = 0; p < o.piles.length; p++) {
        pileShape(o, p, 0);
        ctx.fillStyle = STONE; ctx.fill();
        ctx.lineWidth = ui.hover && ui.hover.kind === 'pile' && ui.hover.i === b && ui.hover.p === p ? 2.4 : 1.1; ctx.strokeStyle = INK; ctx.stroke();
      }
      deck(f, 5);
      ctx.fillStyle = GROUND; ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = INK; ctx.stroke();
      deck(f, 2.6);
      ctx.lineWidth = 0.6; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  function drawDikes() {
    var i, o;
    ctx.lineCap = 'round';
    for (i = 0; i < ui.works.length; i++) {
      o = ui.works[i];
      if (o.t !== 'digue') continue;
      ctx.beginPath(); ctx.moveTo(o.x0 * CELL, o.y0 * CELL); ctx.lineTo(o.x1 * CELL, o.y1 * CELL);
      ctx.lineWidth = S.DIKE_R * 2 * CELL + 2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.lineWidth = S.DIKE_R * 2 * CELL - 0.6; ctx.strokeStyle = ui.hover && ui.hover.kind === 'digue' && ui.hover.i === i ? '#96785c' : STONE; ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // Une roue vue de dessus : son cadre en travers du courant, ses pales qui défilent, la cabane du meunier.
  function wheel(x, y, phase, fill, stroke) {
    var i = S.courseAt(x, y), al = S.MILL_L * CELL, aw = S.MILL_W * CELL, k, px;
    ctx.save();
    ctx.translate(x * CELL, y * CELL);
    ctx.rotate(Math.atan2(river.ty[i], river.tx[i]));
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(-al, -aw, al * 2, aw * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (k = 0; k < 3; k++) {
      px = -al + ((phase + k / 3) % 1) * al * 2;
      ctx.moveTo(px, -aw + 1); ctx.lineTo(px, aw - 1);
    }
    ctx.stroke();
    ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(0, -aw - 2.5); ctx.lineTo(0, aw + 2.5); ctx.stroke();
    ctx.restore();
  }
  function drawMills() {
    var m = S.mills(), k, o;
    for (k = 0; k < m.index.length; k++) {
      o = ui.works[m.index[k]];
      if (!o) continue;
      if (!ui.paused) ui.spin[k] = (ui.spin[k] + m.u[k] * 0.9) % 1;
      wheel(o.x, o.y, ui.spin[k], 'rgba(241,229,198,0.82)', INK);
      ctx.fillStyle = ROOF; ctx.strokeStyle = INK; ctx.lineWidth = ui.hover && ui.hover.kind === 'moulin' && ui.hover.i === m.index[k] ? 2.2 : 1;
        ctx.beginPath(); ctx.rect(o.x * CELL - 3.4, o.y * CELL - 3.4, 6.8, 6.8); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(o.x * CELL - 3.4, o.y * CELL - 3.4); ctx.lineTo(o.x * CELL + 3.4, o.y * CELL + 3.4); ctx.moveTo(o.x * CELL + 3.4, o.y * CELL - 3.4); ctx.lineTo(o.x * CELL - 3.4, o.y * CELL + 3.4); ctx.stroke();
    }
  }

  // De près, la grille de la simulation : les cases que ferment les ouvrages, celles que freinent les roues.
  function drawGrid() {
    var f = S.fields(), d = view.dpr || 1, x0 = Math.max(1, Math.floor(-view.x / view.k / CELL)), y0 = Math.max(1, Math.floor(-view.y / view.k / CELL));
    var x1 = Math.min(NX - 2, Math.ceil((canvas.width / d - view.x) / view.k / CELL)), y1 = Math.min(NY - 2, Math.ceil((canvas.height / d - view.y) / view.k / CELL)), x, y, c;
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        c = y * NX + x;
        if (!river.bed[c] || !f.wk[c] && !f.drag[c]) continue;
        ctx.fillStyle = f.wk[c] ? 'rgba(61,47,33,0.3)' : 'rgba(47,86,115,0.25)';
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    ctx.beginPath();
    for (x = x0; x <= x1 + 1; x++) { ctx.moveTo(x * CELL, y0 * CELL); ctx.lineTo(x * CELL, (y1 + 1) * CELL); }
    for (y = y0; y <= y1 + 1; y++) { ctx.moveTo(x0 * CELL, y * CELL); ctx.lineTo((x1 + 1) * CELL, y * CELL); }
    ctx.lineWidth = 1 / view.k; ctx.strokeStyle = 'rgba(31,65,89,0.2)'; ctx.stroke();
  }
  // Les cases exactes qu'occuperait l'ouvrage sous le pointeur.
  function footprint(each, ok) {
    if (CELL * view.k < GRID) return;
    ctx.fillStyle = ok ? 'rgba(79,122,58,0.45)' : 'rgba(179,64,42,0.4)';
    each(function (c) { ctx.fillRect((c % NX) * CELL, ((c / NX) | 0) * CELL, CELL, CELL); });
  }

  // Ce que ferait un clic, dessiné sous le pointeur.
  function drawGhost() {
    var d = ui.drag, h = ui.hover, o, ok, f;
    if (!st.ready || ui.hx < 0) return;
    if (d && d.kind === 'trace') {
      o = { t: 'digue', x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 }; ok = S.canDike(o);
      footprint(function (fn) { S.dikeCells(o, fn); }, ok);
      ctx.lineCap = 'round'; ctx.lineWidth = S.DIKE_R * 2 * CELL; ctx.strokeStyle = ok ? 'rgba(79,122,58,0.85)' : 'rgba(179,64,42,0.8)';
      ctx.beginPath(); ctx.moveTo(d.x0 * CELL, d.y0 * CELL); ctx.lineTo(d.x1 * CELL, d.y1 * CELL); ctx.stroke(); ctx.lineCap = 'butt';
    } else if (d) return;
    else if (ui.tool === 'moulin') {
      ok = S.canMill(ui.hx, ui.hy, ui.works, -1);
      footprint(function (fn) { S.millCells(ui.hx, ui.hy, function (c) { if (river.zone[c]) fn(c); }); }, ok);
      wheel(ui.hx, ui.hy, 0, ok ? 'rgba(79,122,58,0.25)' : 'rgba(179,64,42,0.25)', ok ? OK : RED);
    } else if (ui.tool === 'pont' && h && h.kind === 'pont' && h.i >= 0) {
      o = ui.works[h.i]; f = { t: 'pont', cr: o.cr, piles: [h.t] };
      ok = o.piles.length < MAX_PILES && pileFits(o, h.t, -1);
      footprint(function (fn) { S.pileCells(f, 0, function (c) { if (river.bed[c]) fn(c); }); }, ok);
      pileShape(f, 0, 0.5);
      ctx.lineWidth = 1.6; ctx.strokeStyle = ok ? OK : RED; ctx.stroke();
    } else if (ui.tool === 'quai' && h && h.kind === 'berge') {
      bankLine(h.w);
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(79,122,58,0.75)'; ctx.stroke();
    } else if (ui.tool === 'digue') {
      ctx.beginPath(); ctx.arc(ui.hx * CELL, ui.hy * CELL, 3.5, 0, 6.2832);
      ctx.lineWidth = 1.4; ctx.strokeStyle = river.zone[(ui.hy | 0) * NX + (ui.hx | 0)] ? OK : RED; ctx.stroke();
    }
  }

  function draw() {
    var near = CELL * view.k >= GRID;
    if (view.ajuste(canvas) || trail.cv.width !== canvas.width || trail.cv.height !== canvas.height) { trail.cv.width = canvas.width; trail.cv.height = canvas.height; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!river) return;
    view.repere(ctx);
    ctx.save();
    ctx.beginPath(); ctx.rect(19.5, 19.5, PX - 39, PX - 39); ctx.clip();   // le cadre du plan reste intact
    drawWards(false);
    ctx.save();
    ctx.clip(clip, 'evenodd');
    if (ui.view !== 'plan' && (st.ready || ui.view === 'courant')) {
      paintField();
      ctx.imageSmoothingEnabled = !near;   // de près, chaque case garde sa teinte
      ctx.drawImage(field.cv, 0, 0, PX, PX);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(trail.cv, 0, 0);
    ctx.restore();
    if (near && st.ready) drawGrid();
    ctx.restore();
    drawQuays();
    drawDikes();
    drawBridges();
    drawMills();
    drawWards(true);
    drawGhost();
    ctx.restore();
  }

  // ---------- Tableau de bord ----------
  function setBut(el, state, text) { el.className = state; el.textContent = text; }

  function describe(h) {
    var o, m, k, f, wd, r;
    if (!h) return '';
    if (h.kind === 'moulin') {
      m = S.mills(); k = m.index.indexOf(h.i);
      return k < 0 ? '' : 'Moulin : ' + fmt(m.p[k] * S.UNIT) + ' sacs par jour, courant à ' + Math.round(m.u[k] / S.U_IN * 100) + ' % de celui de l\'entrée.';
    }
    if (h.kind === 'digue') { o = ui.works[h.i]; return 'Digue : ' + S.costOf(o) + ' écus.'; }
    if (h.kind === 'pont' || h.kind === 'pile') {
      f = river.crossings[h.kind === 'pile' ? ui.works[h.i].cr : h.cr];
      o = h.i >= 0 ? ui.works[h.i] : null;
      if (!o) return f.name + ' (à bâtir) : ' + S.costOf({ t: 'pont', cr: h.cr, piles: S.evenPiles(h.cr, ui.piles) }) + ' écus avec ' + plural(ui.piles, 'pile', 'piles') + '.';
      return f.name + ' : ' + plural(o.piles.length, 'pile', 'piles') + ', arches de ' + S.spans(o).map(function (s) { return Math.round(s * CELL / city.plan.model.k * TOISES); }).join(', ') + ' toises, ' + S.costOf(o) + ' écus.';
    }
    wd = S.wards(); r = wd.level[h.w] / wd.limit[h.w];
    return river.wards[h.w].name + ' : eau à ' + Math.max(0, Math.round(r * 100)) + ' % des quais' + (quayOf(h.w) >= 0 ? ' (rehaussés)' : ', les rehausser coûterait ' + S.costOf({ t: 'quai', w: h.w }) + ' écus') + '.';
  }

  function hud() {
    var s, wd, w, r, cost, left, n, list = [], drowned = 0, text, best, k, advice = '', prod, need;
    if (!city) return;
    each('[data-outil]', function (el) { el.setAttribute('aria-pressed', el.getAttribute('data-outil') === ui.tool); });
    each('[data-piles]', function (el) { el.setAttribute('aria-pressed', +el.getAttribute('data-piles') === ui.piles); });
    each('[data-vue]', function (el) { el.setAttribute('aria-pressed', el.getAttribute('data-vue') === ui.view); });
    each('[data-vit]', function (el) { el.setAttribute('aria-pressed', +el.getAttribute('data-vit') === ui.speed); });
    $('#piles').hidden = ui.tool !== 'pont';
    $('#mode').textContent = TOOLS[ui.tool];
    $('[data-act="annuler"]').disabled = !ui.undo.length;
    $('[data-act="retablir"]').disabled = !ui.redo.length;
    $('[data-act="pause"]').textContent = ui.paused ? 'Reprendre' : 'Pause';
    $('[data-act="pause"]').setAttribute('aria-pressed', ui.paused);
    $('[data-act="crue"]').setAttribute('aria-pressed', st.regime === 1);
    $('[data-act="crue"]').disabled = !st.ready;
    best = save.best[city.key];
    $('#record').textContent = best ? 'Meilleur chantier ici : ' + starText(best.e) + ' ' + fmt(best.p) + ' sacs' : 'Aucun chantier réussi ici pour l\'instant.';

    if (!st.ready) {
      $('#etape').textContent = ['On mesure le fleuve nu.', 'On mesure le fleuve nu en crue.', 'On éprouve des ponts à une pile pour fixer la hauteur des quais.'][st.phase] || '';
      $('#avance').style.width = Math.min(100, (st.phase + Math.min(1, st.since / 7000)) / 3 * 100) + '%';
      $('#etat').textContent = 'Étalonnage…'; $('#etat').className = 'etat';
      $('#info').textContent = '';
      $('#etoiles').textContent = starText(0);
      setBut($('#butPonts'), '', plural(river.crossings.length, 'traversée', 'traversées') + ' à relier par un pont');
      setBut($('#butCrue'), '', 'Aucun quartier inondé');
      setBut($('#butBudget'), '', 'Rester dans le budget de ' + st.budget + ' écus');
      $('#budget').textContent = st.budget;
      return;
    }

    s = judge();
    wd = S.wards();
    for (w = 0; w < river.wards.length; w++) {
      r = wd.level[w] / wd.limit[w];
      if (r > 1) { drowned++; list.push('<span class="noye">' + river.wards[w].name + '</span>'); }
      else if (r >= WARN) list.push(river.wards[w].name);
    }
    cost = S.totalCost(ui.works); left = st.budget - cost; n = S.bridged();
    prod = ui.norm && ui.norm.key === key() && s && st.regime === 0 ? ui.norm.prod : st.prod;

    $('#prod').textContent = fmt(prod * S.UNIT);
    $('#prodBarre').style.width = Math.min(100, prod / (st.stars[2] * 1.3) * 100) + '%';
    $('#niveau').textContent = Math.round(st.top * 100);
    $('#niveauBarre').style.height = Math.min(100, st.top / 1.3 * 100) + '%';
    $('#niveauBarre').parentNode.className = 'limni' + (st.top > 1 ? ' haut' : '');
    $('#menaces').innerHTML = list.length ? (drowned ? 'Inondé ou menacé : ' : 'Menacé : ') + list.join(', ') : 'Aucun quartier menacé.';
    $('#budget').textContent = left;
    $('#budgetSur').textContent = 'écus sur ' + st.budget;
    $('#budget').className = left < 0 ? 'non' : '';
    $('#budgetBarre').style.width = Math.max(0, Math.min(100, left / st.budget * 100)) + '%';
    $('#budgetBarre').parentNode.className = 'regle budget' + (left < 0 ? ' vide' : '');

    setBut($('#butPonts'), n === river.crossings.length ? 'ok' : '', n + ' / ' + plural(river.crossings.length, 'traversée reliée', 'traversées reliées'));
    setBut($('#butCrue'), drowned ? 'non' : 'ok', drowned ? plural(drowned, 'quartier inondé', 'quartiers inondés') : 'Aucun quartier inondé');
    setBut($('#butBudget'), left < 0 ? 'non' : 'ok', left < 0 ? 'Budget dépassé de ' + (-left) + ' écus' : 'Budget tenu : ' + cost + ' écus sur ' + st.budget);

    $('#etat').textContent = ui.paused ? 'En pause' : s ? 'Mesure stable' : 'Mesure en cours…';
    $('#etat').className = s && !ui.paused ? 'etat ok' : 'etat';
    $('#etoiles').textContent = starText(ui.stars);
    $('#etoiles').className = s ? 'etoiles' : 'etoiles attend';

    k = key();
    if (st.regime === 1) text = !s ? 'la crue monte…' : drowned ? 'la crue passe par-dessus les quais' : 'la crue est tenue';
    else text = ui.crue && ui.crue.key === k ? (ui.crue.ok ? 'crue tenue par ce chantier' : 'ce chantier ne tient pas la crue') : 'chantier pas encore éprouvé';
    $('#crue').textContent = text;
    $('#crue').className = 'verdict' + (st.regime === 1 && s || st.regime === 0 && ui.crue && ui.crue.key === k ? (drowned || ui.crue && ui.crue.key === k && !ui.crue.ok ? ' non' : ' ok') : '');

    need = st.stars[Math.min(2, ui.stars)];
    if (n < river.crossings.length) advice = 'Jette un pont sur chaque traversée lavée de jaune.';
    else if (left < 0) advice = 'Le budget est dépassé : allège le chantier.';
    else if (drowned) advice = 'Retire un obstacle en aval des quartiers inondés, ou rehausse leurs quais.';
    else if (st.regime === 1) advice = s ? 'Reviens au débit ordinaire pour mesurer la farine.' : '';
    else if (!s) advice = '';
    else if (ui.stars === 3) advice = 'Trois étoiles : la ville moud sans se mouiller.';
    else if (prod >= st.stars[2]) advice = 'Pour la troisième étoile, lance la crue décennale : aucun quartier ne doit être inondé.';
    else advice = 'Encore ' + fmt((need - prod) * S.UNIT) + ' sacs pour ' + (ui.stars ? 'l\'étoile suivante' : 'la première étoile') + ' : cherche le courant le plus vif.';
    $('#conseil').textContent = advice;
    $('#info').textContent = describe(ui.hover);
  }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  // ---------- Commandes ----------
  function locate(e) {
    var p = view.point(e);
    ui.hx = p.x / CELL;
    ui.hy = p.y / CELL;
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (e.button === 1 || !st.ready) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
    locate(e);
    press(ui.hx, ui.hy, e.button === 2);
    hud();
  });
  canvas.addEventListener('pointermove', function (e) {
    locate(e);
    if (!st.ready) return;
    if (ui.drag) dragTo(ui.hx, ui.hy);
    else ui.hover = pick(ui.hx, ui.hy);
  });
  function drop() { release(); hud(); }
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);
  canvas.addEventListener('pointerleave', function () { if (!ui.drag) { ui.hx = -1; ui.hover = null; } });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function setView(v) {
    ui.view = v;
    wipe();
  }
  function toggleCrue() {
    if (st.ready) S.setRegime(st.regime ? 0 : 1);
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act],[data-outil],[data-piles],[data-vue],[data-vit]') : null, act;
    if (!el) return;
    if (el.hasAttribute('data-outil')) ui.tool = el.getAttribute('data-outil');
    else if (el.hasAttribute('data-piles')) ui.piles = +el.getAttribute('data-piles');
    else if (el.hasAttribute('data-vue')) setView(el.getAttribute('data-vue'));
    else if (el.hasAttribute('data-vit')) ui.speed = +el.getAttribute('data-vit');
    act = el.getAttribute('data-act');
    if (act === 'annuler') undo();
    else if (act === 'retablir') redo();
    else if (act === 'zero') reset();
    else if (act === 'pause') ui.paused = !ui.paused;
    else if (act === 'crue') toggleCrue();
    hud();
  });

  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase(), tools = { p: 'pont', m: 'moulin', d: 'digue', q: 'quai', v: 'deplacer', r: 'retirer' };
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (k === ' ' && e.target && e.target.tagName === 'BUTTON') return;
    if ((e.ctrlKey || e.metaKey) && k === 'z') { if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') redo();
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (tools[k]) ui.tool = tools[k];
    else if (k === ' ' && e.target && e.target.tagName === 'SUMMARY') return;
    else if (k === ' ') ui.paused = !ui.paused;
    else if (k === 'c') toggleCrue();
    else if (k === '1' || e.code === 'Digit1') setView('plan');   // position de la touche : un clavier français donne les chiffres sans Maj
    else if (k === '2' || e.code === 'Digit2') setView('courant');
    else if (k === '3' || e.code === 'Digit3') setView('niveau');
    else return;
    e.preventDefault();
    hud();
  });

  $('#depart').addEventListener('submit', function (e) {
    var seed = $('#graine').value.trim() || Math.random().toString(36).slice(2, 8);
    e.preventDefault();
    open(seed, $('#taille').value, city && city.from && city.from.seed === seed ? city.from : null);
  });
  $('#taille').addEventListener('change', function () {
    open($('#graine').value.trim() || city.seed, $('#taille').value, city.from && city.from.seed === $('#graine').value.trim() ? city.from : null);
  });
  $('#hasard').addEventListener('click', function () { open(Math.random().toString(36).slice(2, 8), $('#taille').value, null); });
  window.addEventListener('hashchange', function () {
    var a = P.parse(location.hash.slice(1));
    if (a.seed !== city.seed || a.size !== city.size || (a.from ? a.from.query : '') !== (city.from ? city.from.query : '')) readAddress();
  });

  // ---------- Démarrage ----------
  loadSave();
  readAddress();
  requestAnimationFrame(frame);

  // Prise pour les essais et pour la console : avance la simulation sans attendre les images.
  window.RIVIERE = {
    ui: ui, vue: view, ville: function () { return city; }, fleuve: function () { return river; },
    poser: function (list) { ui.works = list; apply(); },
    avance: function (n) {
      var i;
      while (!st.ready) S.calibrate(500);
      if ($('#attente').hidden === false) onReady();
      for (i = 0; i < n; i++) { S.step(); if (i % 24 === 23) moveTracers(24); }
      draw(); hud();
    }
  };
})();
