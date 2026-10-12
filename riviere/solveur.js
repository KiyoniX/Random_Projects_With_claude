(function () {
  'use strict';

  var R = window.Riviere, NX = R.NX, NY = R.NY, N = NX * NY;

  var TAU = 0.56;            // temps de relaxation : viscosité = (TAU - 0,5) / 3
  var SMAG = 0.3;            // viscosité de sous-maille (Smagorinsky)
  var UMAX = 0.25;           // borne sur la vitesse, en cases par pas
  var RHO_OUT = 1;
  var U_IN = 0.05;           // débit du fleuve par case d'entrée
  var CRUE = 1.35;           // la crue décennale multiplie le débit entrant
  var RAMP = 1 / 250;        // le débit change progressivement
  // La sortie absorbe les ondes de pression (impédance du réseau, √3) autour de sa vitesse moyenne récente :
  // sans cela le fleuve entier ballotte entre ses deux bouts pendant des milliers de pas.
  var ABSORB = 1.73, ABSORB_RATE = 1 / 1000;
  var HEAD = 0.016;         // marge des quais au-dessus du fleuve à ponts d'une pile, en densité
  var SURGE = 0.1;           // part des quais que la crue noie à elle seule
  var QUAY_GAIN = 0.5;       // un quai rehausse la berge d'autant
  var CAP = 2.5;             // à CAP fois la hauteur des quais, le fleuve déborde en amont du plan : l'entrée se ferme
  var CAP_BAND = 0.01;
  var DRAG = 0.25;           // freinage d'une roue : la vitesse v devient v / (1 + DRAG × |v|) à chaque pas
  var MEAS = 8;              // pas entre deux relevés
  var LRATE = 1 / 25, PRATE = 1 / 40, SMOOTH = 1 / 150;
  var WIN = 32, WIN_EVERY = 32;   // fenêtre de stabilité : WIN relevés espacés de WIN_EVERY pas
  var SETTLE_MIN = 1200, SETTLE_MAX = 7000, CAL_MAX = 12000;
  var UNIT = 10000;          // sacs de farine par unité de puissance du réseau

  var PILE_W = 1, PILE_L = 1.7;     // demi-largeur et demi-longueur d'une pile, en cases
  var MILL_W = 2.6, MILL_L = 1.5;   // demi-envergure et demi-épaisseur d'une roue
  var MILL_MIN = 9;                 // cases d'eau qu'il faut à une roue
  var MILL_GAP = 5.6;               // écart entre deux roues
  var DIKE_R = 0.8, DIKE_MAX = 45;
  var COST = { arch: 10, span: 0.5, pile: 12, mill: 60, dike: 4, quay: 5 };
  var BUDGET = 400;     // écus en plus du prix de ponts à une pile
  // Production de référence : la plus petite de deux bornes, ce que rendraient SITES roues aux meilleures places
  // du fleuve nu (pour une part REF_SITES) et ce que vaut la marge des quais prise sur tout le débit (part REF_HEAD).
  var SITES = 6, REF_SITES = 0.14, REF_HEAD = 0.45;
  var STARS = [0.5, 1, 1.15];     // seuils d'étoiles, en part de cette référence

  var W0 = 4 / 9, W1 = 1 / 9, W2 = 1 / 36;
  var N1 = N, N2 = 2 * N, N3 = 3 * N, N4 = 4 * N, N5 = 5 * N, N6 = 6 * N, N7 = 7 * N, N8 = 8 * N;

  // ---------- Simulation ----------
  // Boltzmann sur réseau D2Q9, collision BGK, repris du projet Flux. Directions : 0 repos, 1 est, 2 sud,
  // 3 ouest, 4 nord, 5 sud-est, 6 sud-ouest, 7 nord-ouest, 8 nord-est (y vers le bas).
  // Seules les cases du lit sont calculées : act en tient la liste.
  var F = new Float64Array(9 * N), G = new Float64Array(9 * N);
  var RHO = new Float32Array(N), UX = new Float32Array(N), UY = new Float32Array(N);
  var solid = new Uint8Array(N), wk = new Uint8Array(N), drag = new Float32Array(N);
  var act = new Int32Array(0), nAct = 0;
  var river = null, inP = null, outP = null;
  var nSt = 0, inSt = 0, outSt = 0;
  var LV = new Float64Array(0), REF0 = new Float64Array(0), REF1 = new Float64Array(0), stSum = new Float64Array(0), stCnt = new Int32Array(0);
  var sim = {
    steps: 0, since: 0, hn: 0, guard: 0, uin: 0, target: U_IN, rin: 1, pu: 0, q: 0, qs: 0, cap: 1.4,
    regime: 0, ready: false, phase: 0, q0: 0, free: HEAD, head1: 0, ref: 0, pot: 0, budget: 0, stars: [0, 0, 0], sites: [], prod: 0, top: 0, bare: null
  };
  var histP = new Float64Array(WIN), histL = new Float64Array(WIN);

  function setEq(A, c, r, vx, vy) {
    var k = 1 - 1.5 * (vx * vx + vy * vy), a = vx + vy, b = vy - vx;
    A[c] = W0 * r * k;
    A[N1 + c] = W1 * r * (k + 3 * vx + 4.5 * vx * vx);
    A[N3 + c] = W1 * r * (k - 3 * vx + 4.5 * vx * vx);
    A[N2 + c] = W1 * r * (k + 3 * vy + 4.5 * vy * vy);
    A[N4 + c] = W1 * r * (k - 3 * vy + 4.5 * vy * vy);
    A[N5 + c] = W2 * r * (k + 3 * a + 4.5 * a * a);
    A[N7 + c] = W2 * r * (k - 3 * a + 4.5 * a * a);
    A[N6 + c] = W2 * r * (k + 3 * b + 4.5 * b * b);
    A[N8 + c] = W2 * r * (k - 3 * b + 4.5 * b * b);
  }

  function touch() { sim.since = 0; sim.hn = 0; }

  // L'entrée impose le débit du fleuve : équilibre à la densité de la case voisine, à la vitesse qui donne
  // ce débit. Elle se ferme quand le niveau atteint le plafond (fleuve barré). La sortie est un réservoir
  // à pression fixe, comme les bouches de Flux.
  function feed() {
    var cells = inP.cells, n = cells.length, off = inP.off, j, c, nb, m = 0, rs = 0, r, un, s, q = 0;
    for (j = 0; j < n; j++) { nb = cells[j] + off; if (!solid[nb]) { rs += RHO[nb]; m++; } }
    rs = m ? rs / m : RHO_OUT;
    sim.rin = rs;
    sim.uin += (sim.target - sim.uin) * RAMP;
    s = (sim.cap - rs) / CAP_BAND; s = s > 1 ? 1 : s < 0 ? 0 : s;
    un = sim.uin * s / rs;
    for (j = 0; j < n; j++) {
      c = cells[j]; nb = c + off;
      r = solid[nb] ? rs : RHO[nb];
      setEq(F, c, r, un * inP.nx, un * inP.ny);
      if (!solid[nb]) q += RHO[nb] * (UX[nb] * inP.nx + UY[nb] * inP.ny);
    }
    sim.q = q; sim.qs += (q - sim.qs) * SMOOTH;

    cells = outP.cells; n = cells.length; off = outP.off; q = 0; m = 0;
    for (j = 0; j < n; j++) { nb = cells[j] + off; if (!solid[nb]) { q += UX[nb] * outP.nx + UY[nb] * outP.ny; m++; } }
    if (m) q /= m;
    sim.pu += (q - sim.pu) * ABSORB_RATE;
    r = RHO_OUT - ABSORB * (q - sim.pu);
    for (j = 0; j < n; j++) {
      c = cells[j]; nb = c + off;
      un = solid[nb] ? 0 : UX[nb] * outP.nx + UY[nb] * outP.ny;
      setEq(F, c, r, un * outP.nx, un * outP.ny);
    }
  }

  function collide() {
    var i, c, s, sw, sn, se, ss, dg;
    var f0, f1, f2, f3, f4, f5, f6, f7, f8, r, vx, vy, u2, k, a, b, om, q, pxx, pyy, pxy, t, swap;
    for (i = 0; i < nAct; i++) {
      c = act[i];
      if (solid[c]) continue;
      sw = solid[c - 1]; sn = solid[c - NX]; se = solid[c + 1]; ss = solid[c + NX];
      f0 = F[c];
      f1 = sw ? F[N3 + c] : F[N1 + c - 1];
      f2 = sn ? F[N4 + c] : F[N2 + c - NX];
      f3 = se ? F[N1 + c] : F[N3 + c + 1];
      f4 = ss ? F[N2 + c] : F[N4 + c + NX];
      // En diagonale, deux parois qui se touchent par le coin ferment aussi le passage.
      s = c - NX - 1; f5 = (solid[s] || (sw && sn)) ? F[N7 + c] : F[N5 + s];
      s = c - NX + 1; f6 = (solid[s] || (se && sn)) ? F[N8 + c] : F[N6 + s];
      s = c + NX + 1; f7 = (solid[s] || (se && ss)) ? F[N5 + c] : F[N7 + s];
      s = c + NX - 1; f8 = (solid[s] || (sw && ss)) ? F[N6 + c] : F[N8 + s];

      r = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
      if (!(r > 0.5 && r < 2)) {          // attrape aussi NaN : la case repart du repos
        f0 = W0; f1 = f2 = f3 = f4 = W1; f5 = f6 = f7 = f8 = W2; r = 1; sim.guard++;
      }
      vx = (f1 + f5 + f8 - f3 - f6 - f7) / r;
      vy = (f2 + f5 + f6 - f4 - f7 - f8) / r;
      u2 = vx * vx + vy * vy;
      if (u2 > UMAX * UMAX) { k = UMAX / Math.sqrt(u2); vx *= k; vy *= k; u2 = UMAX * UMAX; }
      RHO[c] = r;

      k = 1 - 1.5 * u2; a = vx + vy; b = vy - vx;
      f0 -= W0 * r * k;
      t = W1 * r;
      f1 -= t * (k + 3 * vx + 4.5 * vx * vx);
      f3 -= t * (k - 3 * vx + 4.5 * vx * vx);
      f2 -= t * (k + 3 * vy + 4.5 * vy * vy);
      f4 -= t * (k - 3 * vy + 4.5 * vy * vy);
      t = W2 * r;
      f5 -= t * (k + 3 * a + 4.5 * a * a);
      f7 -= t * (k - 3 * a + 4.5 * a * a);
      f6 -= t * (k + 3 * b + 4.5 * b * b);
      f8 -= t * (k - 3 * b + 4.5 * b * b);

      // f0..f8 ne contiennent plus que l'écart à l'équilibre : son tenseur des contraintes
      // donne le taux de cisaillement local, qui allonge le temps de relaxation.
      q = f5 + f6 + f7 + f8;
      pxx = f1 + f3 + q; pyy = f2 + f4 + q; pxy = f5 - f6 + f7 - f8;
      q = Math.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy);
      om = 1 - 2 / (TAU + Math.sqrt(TAU * TAU + SMAG * q / r));

      // Sous une roue, l'eau repart d'un équilibre ralenti : la quantité de mouvement perdue est ce que la roue prend.
      dg = drag[c];
      if (dg !== 0) {
        k = 1 / (1 + dg * Math.sqrt(u2));
        vx *= k; vy *= k;
        k = 1 - 1.5 * (vx * vx + vy * vy); a = vx + vy; b = vy - vx;
      }
      UX[c] = vx; UY[c] = vy;

      G[c] = W0 * r * k + om * f0;
      t = W1 * r;
      G[N1 + c] = t * (k + 3 * vx + 4.5 * vx * vx) + om * f1;
      G[N3 + c] = t * (k - 3 * vx + 4.5 * vx * vx) + om * f3;
      G[N2 + c] = t * (k + 3 * vy + 4.5 * vy * vy) + om * f2;
      G[N4 + c] = t * (k - 3 * vy + 4.5 * vy * vy) + om * f4;
      t = W2 * r;
      G[N5 + c] = t * (k + 3 * a + 4.5 * a * a) + om * f5;
      G[N7 + c] = t * (k - 3 * a + 4.5 * a * a) + om * f7;
      G[N6 + c] = t * (k + 3 * b + 4.5 * b * b) + om * f6;
      G[N8 + c] = t * (k - 3 * b + 4.5 * b * b) + om * f8;
    }
    swap = F; F = G; G = swap;
  }

  // La comptabilité reste hors de la boucle chaude.
  function step() {
    feed();
    collide();
    sim.steps++; sim.since++;
    if (sim.steps % MEAS === 0) measure();
    if (sim.steps % WIN_EVERY === 0) {
      histP[sim.hn % WIN] = sim.prod;
      histL[sim.hn % WIN] = sim.ready ? sim.top * sim.free : LV[inSt] - LV[outSt];
      sim.hn++;
    }
  }

  function rest() {
    var i, c;
    for (i = 0; i < nAct; i++) { c = act[i]; setEq(F, c, RHO_OUT, 0, 0); RHO[c] = RHO_OUT; UX[c] = 0; UY[c] = 0; }
    for (i = 0; i < nSt; i++) LV[i] = RHO_OUT;
    sim.steps = 0; sim.uin = 0; sim.rin = RHO_OUT; sim.pu = 0; sim.q = 0; sim.qs = 0; sim.prod = 0; sim.top = 0;
    touch();
  }

  // ---------- Relevés ----------
  // Le niveau d'une station est la densité moyenne de sa tranche de fleuve, lissée dans le temps ;
  // la cote d'un quartier est le plus haut écart au fleuve nu le long de ses berges.
  var wardLevel = new Float64Array(0), wardLimit = new Float64Array(0), wardSt = [];
  var mills = [], millCells = new Int32Array(64 * 40), millFrom = new Int32Array(65), millP = new Float64Array(64), millU = new Float64Array(64);

  // Part de crue dans le débit du moment, de 0 à 1.
  function phi() {
    var p = (sim.uin / U_IN - 1) / (CRUE - 1);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }
  function level(j) {
    var p = phi();
    return LV[j] - REF0[j] - (REF1[j] - REF0[j]) * p + SURGE * sim.free * p;
  }

  function measure() {
    var i, j, c, m, w, list, top = 0, v, p, sum, u, up, du, cnt, total = 0;
    for (j = 0; j < nSt; j++) { stSum[j] = 0; stCnt[j] = 0; }
    for (i = 0; i < nAct; i++) {
      c = act[i];
      if (solid[c]) continue;
      j = river.st[c];
      stSum[j] += RHO[c]; stCnt[j]++;
    }
    for (j = 0; j < nSt; j++) {
      v = stCnt[j] ? stSum[j] / stCnt[j] : j ? LV[j - 1] : LV[j];
      LV[j] += (v - LV[j]) * LRATE;
    }
    if (sim.ready) {
      for (w = 0; w < wardSt.length; w++) {
        list = wardSt[w]; v = -1;
        for (i = 0; i < list.length; i++) { p = level(list[i]); if (p > v) v = p; }
        wardLevel[w] = v;
        v /= wardLimit[w];
        if (v > top) top = v;
      }
      sim.top = top;
    }
    // Une roue prend à l'eau la force qu'elle lui oppose, fois la vitesse.
    for (m = 0; m < mills.length; m++) {
      sum = 0; u = 0; cnt = millFrom[m + 1] - millFrom[m];
      for (i = millFrom[m]; i < millFrom[m + 1]; i++) {
        c = millCells[i];
        up = Math.sqrt(UX[c] * UX[c] + UY[c] * UY[c]);
        du = 1 - DRAG * up;
        v = du > 0.05 ? up / du : up;
        sum += RHO[c] * DRAG * v * up * (v + up) * 0.5;
        u += up;
      }
      millP[m] += (sum - millP[m]) * PRATE;
      millU[m] = cnt ? u / cnt : 0;
      total += millP[m];
    }
    sim.prod = total;
  }

  // Les relevés sont tenus pour stables quand production et niveau ne bougent presque plus sur toute la fenêtre,
  // ou, si l'écoulement bat sans fin, après une longue attente : on rend alors les moyennes.
  function settled() {
    var i, lo = Infinity, hi = -Infinity, sp = 0, l0 = Infinity, l1 = -Infinity, sl = 0;
    if (sim.hn < WIN || sim.since < SETTLE_MIN || Math.abs(sim.uin - sim.target) > 0.002 * U_IN) return null;
    for (i = 0; i < WIN; i++) {
      sp += histP[i]; if (histP[i] < lo) lo = histP[i]; if (histP[i] > hi) hi = histP[i];
      sl += histL[i]; if (histL[i] < l0) l0 = histL[i]; if (histL[i] > l1) l1 = histL[i];
    }
    sp /= WIN; sl /= WIN;
    if ((hi - lo > Math.max(0.015 * sp, 2e-6) || l1 - l0 > (sim.ready ? 0.012 * sim.free : 1e-4)) && sim.since < (sim.ready ? SETTLE_MAX : CAL_MAX)) return null;
    return { prod: sp, top: sim.ready ? sl / sim.free : sl };
  }

  // ---------- Fleuve ----------
  function load(rv) {
    var c, x, y, i, j, list = [];
    river = rv; inP = rv.inlet; outP = rv.outlet;
    for (c = 0; c < N; c++) { solid[c] = rv.bed[c] ? 0 : 1; wk[c] = 0; drag[c] = 0; setEq(F, c, RHO_OUT, 0, 0); RHO[c] = RHO_OUT; UX[c] = 0; UY[c] = 0; }
    for (y = 1; y < NY - 1; y++) for (x = 1; x < NX - 1; x++) if (rv.bed[y * NX + x]) list.push(y * NX + x);
    for (x = 0; x < NX; x++) { solid[x] = 1; solid[N - NX + x] = 1; }
    for (y = 0; y < NY; y++) { solid[y * NX] = 1; solid[y * NX + NX - 1] = 1; }
    for (i = 0; i < inP.cells.length; i++) solid[inP.cells[i]] = 0;
    for (i = 0; i < outP.cells.length; i++) solid[outP.cells[i]] = 0;
    act = new Int32Array(list); nAct = list.length;
    nSt = rv.nSt; inSt = 1; outSt = nSt - 2;
    LV = new Float64Array(nSt); REF0 = new Float64Array(nSt); REF1 = new Float64Array(nSt); stSum = new Float64Array(nSt); stCnt = new Int32Array(nSt);
    wardSt = rv.wards.map(function (wd) { return wd.stations; });
    wardLevel = new Float64Array(wardSt.length); wardLimit = new Float64Array(wardSt.length);
    // Un pont se décrit sur la grille : ses culées a et b, sa longueur.
    rv.crossings.forEach(function (f) {
      f.gax = f.ax / R.CELL; f.gay = f.ay / R.CELL; f.gbx = f.bx / R.CELL; f.gby = f.by / R.CELL;
      f.glen = Math.sqrt((f.gbx - f.gax) * (f.gbx - f.gax) + (f.gby - f.gay) * (f.gby - f.gay));
    });
    works = []; mills = []; millFrom[0] = 0;
    sim.ready = false; sim.phase = 0; sim.regime = 0; sim.target = U_IN; sim.cap = 1.4; sim.bare = null; sim.free = HEAD; sim.guard = 0;
    sim.budget = BUDGET;
    for (j = 0; j < rv.crossings.length; j++) sim.budget += bridgeCost({ t: 'pont', cr: j, piles: evenPiles(j, 1) });
    sim.budget = Math.round(sim.budget / 10) * 10;
    rest();
  }

  function simpleBridges() {
    return river.crossings.map(function (f, j) { return { t: 'pont', cr: j, piles: evenPiles(j, 1) }; });
  }

  // Étalonnage, à appeler jusqu'à ce que sim.ready soit vrai. Trois écoulements sont établis tour à tour :
  // le fleuve nu au débit ordinaire puis en crue, dont les niveaux servent de référence, et le fleuve
  // avec un pont d'une pile à chaque traversée, qui fixe la hauteur des quais.
  function calibrate(n) {
    var i, j, s, h;
    for (i = 0; i < n && !sim.ready; i++) {
      step();
      s = settled();
      if (!s) continue;
      if (sim.phase === 0) {
        REF0.set(LV); sim.q0 = sim.qs;
        sim.bare = snapshot();
        sim.phase = 1; sim.target = U_IN * CRUE; touch();
      } else if (sim.phase === 1) {
        REF1.set(LV);
        restore(sim.bare);
        sim.target = U_IN;
        setWorks(simpleBridges());
        sim.phase = 2;
      } else {
        for (j = river.town0, h = 0; j >= 0 && j <= river.town1; j++) if (LV[j] - REF0[j] > h) h = LV[j] - REF0[j];
        sim.head1 = h; sim.free = h + HEAD;
        sim.cap = REF1[inSt] + CAP * sim.free;
        setWorks([]);
        restore(sim.bare);
        findSites();
        sim.phase = 3; sim.ready = true; touch();
      }
    }
    return sim.ready;
  }

  // Les meilleures places à roue du fleuve nu, d'après le cube de la vitesse, et les seuils d'étoiles qui en découlent.
  function findSites() {
    var cand = [], out = [], x, y, i, j, s, ok;
    function pot(c) {
      if (!river.zone[c]) return;
      var u2 = UX[c] * UX[c] + UY[c] * UY[c];
      s.p += RHO[c] * DRAG * u2 * Math.sqrt(u2); s.n++;
    }
    for (y = 2; y < NY - 2; y += 2) {
      for (x = 2; x < NX - 2; x += 2) {
        if (!river.zone[y * NX + x]) continue;
        s = { x: x + 0.5, y: y + 0.5, p: 0, n: 0 };
        millFootprint(s.x, s.y, pot);
        if (s.n >= MILL_MIN) cand.push(s);
      }
    }
    cand.sort(function (a, b) { return b.p - a.p; });
    for (i = 0; i < cand.length && out.length < 12; i++) {
      s = cand[i]; ok = true;
      for (j = 0; j < out.length && ok; j++) ok = (out[j].x - s.x) * (out[j].x - s.x) + (out[j].y - s.y) * (out[j].y - s.y) >= MILL_GAP * MILL_GAP;
      if (ok) out.push(s);
    }
    sim.sites = out; sim.pot = 0;
    for (i = 0; i < out.length && i < SITES; i++) sim.pot += out[i].p;
    sim.ref = Math.min(REF_SITES * sim.pot, REF_HEAD * sim.q0 * HEAD / 3);
    for (i = 0; i < 3; i++) sim.stars[i] = sim.ref * STARS[i];
  }

  function snapshot() {
    return { F: F.slice(), RHO: RHO.slice(), UX: UX.slice(), UY: UY.slice(), LV: LV.slice(), uin: sim.uin, pu: sim.pu, qs: sim.qs };
  }
  function restore(s) {
    F.set(s.F); RHO.set(s.RHO); UX.set(s.UX); UY.set(s.UY); LV.set(s.LV);
    sim.uin = s.uin; sim.pu = s.pu; sim.qs = s.qs; sim.prod = 0;
    touch();
  }

  function setRegime(k) {
    sim.regime = k ? 1 : 0;
    sim.target = U_IN * (k ? CRUE : 1);
    touch();
  }

  // ---------- Ouvrages ----------
  // pont : { t, cr, piles } (piles : positions de 0 à 1 le long du tablier) ; moulin : { t, x, y } ;
  // digue : { t, x0, y0, x1, y1 } ; quai : { t, w }. Coordonnées en cases.
  var works = [];

  function deckCell(f, t) { return ((f.gay + (f.gby - f.gay) * t) | 0) * NX + ((f.gax + (f.gbx - f.gax) * t) | 0); }
  function waterSpan(j) {
    var f = river.crossings[j], m = Math.ceil(f.glen * 3), i, t0 = -1, t1 = -1;
    for (i = 0; i <= m; i++) if (river.bed[deckCell(f, i / m)]) { if (t0 < 0) t0 = i / m; t1 = i / m; }
    return [t0 < 0 ? 0 : t0, t1 < 0 ? 1 : t1];
  }
  function evenPiles(j, n) {
    var w = waterSpan(j), out = [], i;
    for (i = 1; i <= n; i++) out.push(w[0] + (w[1] - w[0]) * i / (n + 1));
    return out;
  }
  // Arches d'un pont : les portées d'eau entre deux appuis (culée, pile ou île), en cases.
  function spans(o) {
    var f = river.crossings[o.cr], m = Math.ceil(f.glen * 3), i, p, t, run = 0, out = [], free;
    for (i = 0; i <= m; i++) {
      t = i / m;
      free = river.bed[deckCell(f, t)];
      for (p = 0; free && p < o.piles.length; p++) if (Math.abs(t - o.piles[p]) * f.glen <= PILE_W) free = 0;
      if (free) run++;
      else if (run) { out.push(run / 3); run = 0; }
    }
    if (run) out.push(run / 3);
    return out;
  }
  function bridgeCost(o) {
    var s = spans(o), i, cost = o.piles.length * COST.pile;
    for (i = 0; i < s.length; i++) cost += COST.arch + COST.span * s[i] * s[i];
    return Math.round(cost);
  }
  function dikeLength(o) { return Math.sqrt((o.x1 - o.x0) * (o.x1 - o.x0) + (o.y1 - o.y0) * (o.y1 - o.y0)); }
  function costOf(o) {
    if (o.t === 'pont') return bridgeCost(o);
    if (o.t === 'moulin') return COST.mill;
    if (o.t === 'digue') return Math.max(COST.dike, Math.round(COST.dike * dikeLength(o)));
    return COST.quay * river.wards[o.w].banks.length;
  }
  function totalCost(list) {
    var s = 0, i;
    for (i = 0; i < list.length; i++) s += costOf(list[i]);
    return s;
  }

  // Appelle fn pour chaque case dont le centre est dans le rectangle de centre (x, y) et d'axe (ux, uy).
  function eachCell(x, y, ux, uy, hl, hw, fn) {
    var r = Math.sqrt(hl * hl + hw * hw) + 1, cx, cy, dx, dy;
    var y1 = Math.min(NY - 2, Math.ceil(y + r)), x1 = Math.min(NX - 2, Math.ceil(x + r));
    for (cy = Math.max(1, Math.floor(y - r)); cy <= y1; cy++) {
      for (cx = Math.max(1, Math.floor(x - r)); cx <= x1; cx++) {
        dx = cx + 0.5 - x; dy = cy + 0.5 - y;
        if (Math.abs(dx * ux + dy * uy) <= hl && Math.abs(dy * ux - dx * uy) <= hw) fn(cy * NX + cx);
      }
    }
  }
  // Point du tracé le plus proche : il donne le sens du courant à cet endroit.
  function courseAt(x, y) {
    var i = x >= 0 && y >= 0 && x < NX && y < NY ? river.samp[(y | 0) * NX + (x | 0)] : -1;
    return i < 0 ? river.nearest(x * R.CELL, y * R.CELL) : i;
  }
  function millFootprint(x, y, fn) {
    var i = courseAt(x, y);
    eachCell(x, y, river.tx[i], river.ty[i], MILL_L, MILL_W, fn);
  }
  // Une roue se pose dans l'eau, le long des quartiers, à l'écart des autres roues.
  function canMill(x, y, list, skip) {
    var n = 0, i, o;
    if (!(x >= 1 && y >= 1 && x < NX - 1 && y < NY - 1) || !river.zone[(y | 0) * NX + (x | 0)]) return false;
    for (i = 0; i < list.length; i++) {
      o = list[i];
      if (o.t === 'moulin' && i !== skip && (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y) < MILL_GAP * MILL_GAP) return false;
    }
    millFootprint(x, y, function (c) { if (river.zone[c] && !wk[c]) n++; });
    return n >= MILL_MIN;
  }
  function dikeCells(o, fn) {
    var l = dikeLength(o), m = Math.max(1, Math.ceil(l * 2)), i, x, y, cx, cy, dx, dy;
    for (i = 0; i <= m; i++) {
      x = o.x0 + (o.x1 - o.x0) * i / m; y = o.y0 + (o.y1 - o.y0) * i / m;
      for (cy = Math.max(1, Math.floor(y - 1)); cy <= Math.min(NY - 2, Math.ceil(y + 1)); cy++) {
        for (cx = Math.max(1, Math.floor(x - 1)); cx <= Math.min(NX - 2, Math.ceil(x + 1)); cx++) {
          dx = cx + 0.5 - x; dy = cy + 0.5 - y;
          if (dx * dx + dy * dy <= DIKE_R * DIKE_R && river.zone[cy * NX + cx]) fn(cy * NX + cx);
        }
      }
    }
  }
  function canDike(o) {
    var n = 0, l = dikeLength(o);
    if (!(l <= DIKE_MAX && l >= 1.5)) return false;
    dikeCells(o, function () { n++; });
    return n > 0;
  }
  function pilePoint(o, p) {
    var f = river.crossings[o.cr], t = o.piles[p];
    return { x: f.gax + (f.gbx - f.gax) * t, y: f.gay + (f.gby - f.gay) * t, ux: (f.gbx - f.gax) / f.glen, uy: (f.gby - f.gay) / f.glen };
  }

  // Reporte les ouvrages sur la grille. Une case qui se ferme perd sa vitesse ; une case qui se rouvre
  // repart du repos, au niveau de sa station.
  function setWorks(list) {
    var i, c, p, w, n = 0, m = 0, o, pt, r;
    function close(cc) { if (river.bed[cc]) wk[cc] = 1; }
    function wheel(cc) {
      if (!river.zone[cc] || wk[cc] || drag[cc] || n >= millCells.length) return;
      drag[cc] = DRAG; millCells[n++] = cc;
    }
    works = list;
    for (i = 0; i < nAct; i++) { c = act[i]; wk[c] = 0; drag[c] = 0; }
    for (w = 0; w < wardLimit.length; w++) wardLimit[w] = sim.free;
    for (i = 0; i < list.length; i++) {
      o = list[i];
      if (o.t === 'pont') {
        for (p = 0; p < o.piles.length; p++) {
          pt = pilePoint(o, p);
          eachCell(pt.x, pt.y, pt.ux, pt.uy, PILE_W, PILE_L, close);
        }
      } else if (o.t === 'digue') dikeCells(o, close);
      else if (o.t === 'quai') wardLimit[o.w] = sim.free * (1 + QUAY_GAIN);
    }
    mills = [];
    for (i = 0; i < list.length; i++) {
      o = list[i];
      if (o.t !== 'moulin' || m >= 64) continue;
      millFootprint(o.x, o.y, wheel);
      mills.push(i);
      millFrom[++m] = n;
    }
    for (i = 0; i < nAct; i++) {
      c = act[i];
      if (wk[c] === solid[c]) continue;
      solid[c] = wk[c];
      UX[c] = 0; UY[c] = 0;
      if (!wk[c]) { r = LV[river.st[c]] || RHO_OUT; setEq(F, c, r, 0, 0); RHO[c] = r; }
    }
    touch();
  }

  // ---------- Verdict ----------
  function bridged() {
    var done = [], i, n = 0;
    for (i = 0; i < works.length; i++) if (works[i].t === 'pont' && !done[works[i].cr]) { done[works[i].cr] = true; n++; }
    return n;
  }
  function flooded() {
    var out = [], w;
    for (w = 0; w < wardLevel.length; w++) if (wardLevel[w] > wardLimit[w]) out.push(w);
    return out;
  }
  // Étoiles pour une production mesurée au débit ordinaire, sans inondation ; la troisième exige d'avoir tenu la crue.
  function starsFor(prod, crueOk) {
    var n = 0;
    while (n < 3 && prod >= sim.stars[n]) n++;
    if (n === 3 && !crueOk) n = 2;
    return n;
  }

  R.sim = {
    U_IN: U_IN, CRUE: CRUE, SURGE: SURGE, QUAY_GAIN: QUAY_GAIN, UNIT: UNIT, COST: COST, DIKE_MAX: DIKE_MAX, DIKE_R: DIKE_R,
    MILL_W: MILL_W, MILL_L: MILL_L, MILL_GAP: MILL_GAP, PILE_W: PILE_W, PILE_L: PILE_L,
    state: sim, load: load, step: step, calibrate: calibrate, settled: settled, setRegime: setRegime, rest: rest, snapshot: snapshot, restore: restore,
    setWorks: setWorks, works: function () { return works; }, costOf: costOf, totalCost: totalCost, spans: spans, evenPiles: evenPiles, waterSpan: waterSpan,
    simpleBridges: simpleBridges, canMill: canMill, canDike: canDike, pilePoint: pilePoint, courseAt: courseAt, bridged: bridged, flooded: flooded, starsFor: starsFor,
    level: level, phi: phi,
    // Empreintes sur la grille, pour le dessin : cases d'une roue, d'une digue, d'une pile.
    millCells: millFootprint, dikeCells: dikeCells,
    pileCells: function (o, p, fn) { var pt = pilePoint(o, p); eachCell(pt.x, pt.y, pt.ux, pt.uy, PILE_W, PILE_L, fn); },
    fields: function () { return { rho: RHO, ux: UX, uy: UY, solid: solid, drag: drag, wk: wk, lv: LV, ref0: REF0, ref1: REF1, f: F }; },
    wards: function () { return { level: wardLevel, limit: wardLimit }; },
    mills: function () { return { index: mills, p: millP, u: millU }; }
  };
})();
