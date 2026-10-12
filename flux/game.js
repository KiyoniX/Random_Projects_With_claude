(function () {
  'use strict';

  var NX = 200, NY = 100, N = NX * NY;
  var TAU = 0.56;            // temps de relaxation : viscosité = (TAU - 0,5) / 3
  var SMAG = 0.3;            // viscosité de sous-maille (Smagorinsky), amortit les tourbillons trop fins
  var UMAX = 0.25;           // borne sur la vitesse, en cases par pas
  var RHO_IN = 1.03, RHO_OUT = 1;
  var ABSORB = 0.52;         // souplesse des bouches face aux ondes de pression (0,3 × √3)
  var ABSORB_RATE = 1 / 300; // lissage de la vitesse moyenne qui sert de référence
  var UNIT = 40;             // débit affiché = débit du réseau × UNIT
  var SMOOTH = 1 / 150;      // lissage exponentiel du débit
  var WIN = 40, WIN_EVERY = 25;   // fenêtre de stabilité : WIN relevés espacés de WIN_EVERY pas
  var SETTLE_MAX = 9000;     // au-delà, on accepte la moyenne même si le débit oscille encore

  var FLUID = 0, WALL = 1, CLAY = 2;
  var W0 = 4 / 9, W1 = 1 / 9, W2 = 1 / 36;
  var N1 = N, N2 = 2 * N, N3 = 3 * N, N4 = 4 * N, N5 = 5 * N, N6 = 6 * N, N7 = 7 * N, N8 = 8 * N;
  var SIDES = { O: [1, 0], E: [-1, 0], N: [0, 1], S: [0, -1] };   // normale entrante

  // Un niveau : des bouches sur le bord (cote O, E, N ou S, de la case « de » à la case « a »),
  // puis des formes posées dans l'ordre sur une grille vide. M : mur fixe, A : argile (retirable),
  // V : vide, Z : zone interdite. pinceau et gomme sont les budgets, en cases.
  // score 'min' : seule la sortie la plus faible compte. etoiles : seuils de débit utile.
  var LEVELS = [
    { id: 'bouchon', nom: 'Le bouchon', idee: 'Percer au bon endroit',
      texte: 'Un bouchon d\'argile ferme le conduit. Ta gomme ne peut retirer que 110 cases : perce là où chaque case rapporte le plus.',
      bouches: [{ cote: 'O', de: 30, a: 69, role: 'entree' }, { cote: 'E', de: 30, a: 69, role: 'sortie' }],
      formes: [['M', 'rect', 1, 1, 198, 29], ['M', 'rect', 1, 70, 198, 98], ['A', 'poly', 80, 30, 124, 30, 86, 70, 80, 70]],
      pinceau: 0, gomme: 110, etoiles: [3, 15, 30] },
    { id: 'bosses', nom: 'Les trois bosses', idee: 'Le passage le plus étroit commande',
      texte: 'Trois bosses d\'argile étranglent le conduit. Le débit se décide au passage le plus étroit : répartis ta gomme en conséquence.',
      bouches: [{ cote: 'O', de: 35, a: 64, role: 'entree' }, { cote: 'E', de: 35, a: 64, role: 'sortie' }],
      formes: [['M', 'rect', 1, 1, 198, 34], ['M', 'rect', 1, 65, 198, 98], ['A', 'rect', 50, 40, 61, 64], ['A', 'rect', 95, 44, 106, 64], ['A', 'rect', 140, 53, 151, 64]],
      pinceau: 0, gomme: 150, etoiles: [15, 30, 36.5] },
    { id: 'fuite', nom: 'La fuite', idee: 'Poser de la paroi',
      texte: 'Avant la grille, une dérivation laisse fuir le fluide : tout ce qui sort par la bouche rouge est retiré de ton débit. Tu n\'as que 14 cases de paroi.',
      bouches: [{ cote: 'O', de: 40, a: 59, role: 'entree' }, { cote: 'E', de: 40, a: 59, role: 'sortie' }, { cote: 'S', de: 78, a: 89, role: 'fuite' }],
      formes: [['M', 'rect', 1, 1, 198, 39], ['M', 'rect', 1, 60, 198, 98], ['V', 'poly', 70, 60, 98, 60, 90, 74, 78, 74], ['V', 'rect', 78, 74, 89, 98],
        ['M', 'rect', 140, 40, 142, 46], ['M', 'rect', 140, 53, 142, 59]],
      pinceau: 14, gomme: 0, etoiles: [5, 14, 20] },
    { id: 'coude', nom: 'Le coude', idee: 'Adoucir un virage',
      texte: 'Le fluide doit prendre un virage à angle droit. Taille le coin d\'argile à l\'intérieur du virage pour l\'aider à tourner : toutes les entailles ne se valent pas.',
      bouches: [{ cote: 'O', de: 10, a: 45, role: 'entree' }, { cote: 'S', de: 95, a: 140, role: 'sortie' }],
      formes: [['M', 'rect', 1, 1, 198, 98], ['V', 'rect', 1, 10, 70, 45], ['V', 'rect', 71, 20, 125, 35], ['V', 'rect', 110, 20, 125, 64], ['V', 'rect', 95, 65, 140, 98], ['A', 'rect', 84, 36, 109, 61]],
      pinceau: 0, gomme: 220, etoiles: [47, 52, 54] },
    { id: 'diaphragme', nom: 'Le diaphragme', idee: 'Ajouter de la matière pour gagner du débit',
      texte: 'Une plaque percée freine tout, et tu ne peux pas l\'enlever. Mais le jet qui en sort gaspille son élan en tourbillons : pose de la paroi pour guider le fluide avant et après le trou.',
      bouches: [{ cote: 'O', de: 30, a: 69, role: 'entree' }, { cote: 'E', de: 30, a: 69, role: 'sortie' }],
      formes: [['M', 'rect', 1, 1, 198, 29], ['M', 'rect', 1, 70, 198, 98], ['M', 'rect', 80, 30, 82, 43], ['M', 'rect', 80, 56, 82, 69]],
      pinceau: 700, gomme: 0, etoiles: [61.5, 64, 65.3] },
    { id: 'partage', nom: 'Le partage', idee: 'Équilibrer deux sorties',
      texte: 'Deux sorties, A et B. Seule la plus faible compte, comptée deux fois : freine juste ce qu\'il faut la branche trop gourmande.',
      score: 'min',
      bouches: [{ cote: 'O', de: 42, a: 57, role: 'entree' }, { cote: 'E', de: 12, a: 27, role: 'sortie', nom: 'A' }, { cote: 'E', de: 72, a: 87, role: 'sortie', nom: 'B' }],
      formes: [['M', 'rect', 1, 1, 198, 98], ['V', 'rect', 1, 42, 70, 57], ['V', 'rect', 55, 12, 70, 87], ['V', 'rect', 71, 12, 198, 27], ['V', 'rect', 71, 72, 198, 87],
        ['M', 'rect', 30, 42, 32, 46], ['M', 'rect', 30, 53, 32, 57], ['M', 'rect', 110, 72, 113, 81], ['M', 'rect', 140, 78, 143, 87]],
      pinceau: 30, gomme: 0, etoiles: [10.5, 12, 12.8] },
    { id: 'aiguillage', nom: 'L\'aiguillage', idee: 'Zone interdite',
      texte: 'Le fluide file tout droit vers la fuite, et la zone hachurée est interdite. Dix cases ne suffisent pas à fermer le passage : trouve comment freiner le plus avec si peu.',
      bouches: [{ cote: 'O', de: 35, a: 64, role: 'entree' }, { cote: 'N', de: 90, a: 125, role: 'sortie' }, { cote: 'E', de: 35, a: 64, role: 'fuite' }],
      formes: [['M', 'rect', 1, 1, 198, 98], ['V', 'rect', 1, 35, 60, 64], ['V', 'rect', 61, 42, 150, 57], ['V', 'rect', 151, 35, 198, 64],
        ['V', 'rect', 100, 20, 115, 41], ['V', 'rect', 90, 1, 125, 19], ['Z', 'rect', 116, 42, 150, 57], ['Z', 'rect', 151, 35, 198, 64]],
      pinceau: 10, gomme: 0, etoiles: [15, 28, 38] },
    { id: 'pilier', nom: 'Le pilier', idee: 'Contourner un obstacle imposé',
      texte: 'Un pilier d\'acier bouche presque tout le conduit. Creuse l\'argile des parois pour que le fluide le contourne sans trop de détours.',
      bouches: [{ cote: 'O', de: 40, a: 59, role: 'entree' }, { cote: 'E', de: 40, a: 59, role: 'sortie' }],
      formes: [['M', 'rect', 1, 1, 198, 98], ['V', 'rect', 1, 40, 198, 59], ['A', 'rect', 75, 26, 124, 39], ['A', 'rect', 75, 60, 124, 73], ['M', 'disc', 100, 50, 8]],
      pinceau: 0, gomme: 220, etoiles: [12, 22, 26.5] },
    { id: 'serpentin', nom: 'Le serpentin', idee: 'Ouvrir un raccourci',
      texte: 'Le conduit serpente longuement entre deux cloisons d\'argile. Ouvre un raccourci : une brèche large ou deux petites, dans l\'épais ou dans le mince ?',
      bouches: [{ cote: 'O', de: 12, a: 27, role: 'entree' }, { cote: 'E', de: 64, a: 79, role: 'sortie' }],
      formes: [['M', 'rect', 1, 1, 198, 98], ['V', 'rect', 1, 12, 180, 27], ['V', 'rect', 165, 12, 180, 53], ['V', 'rect', 20, 38, 180, 53], ['V', 'rect', 20, 38, 35, 79], ['V', 'rect', 20, 64, 198, 79],
        ['A', 'rect', 60, 28, 164, 37], ['A', 'rect', 36, 54, 140, 63], ['V', 'rect', 120, 28, 131, 33], ['V', 'rect', 60, 54, 71, 59]],
      pinceau: 0, gomme: 80, etoiles: [13.5, 15, 16.2] },
    { id: 'usine', nom: 'L\'usine', idee: 'Tout à la fois',
      texte: 'Une fuite à fermer, une bosse à raboter, deux sorties à équilibrer, et des budgets serrés. La plus faible des sorties A et B compte double, la fuite se soustrait.',
      score: 'min',
      bouches: [{ cote: 'O', de: 42, a: 57, role: 'entree' }, { cote: 'E', de: 12, a: 27, role: 'sortie', nom: 'A' }, { cote: 'E', de: 62, a: 77, role: 'sortie', nom: 'B' }, { cote: 'S', de: 114, a: 125, role: 'fuite' }],
      formes: [['M', 'rect', 1, 1, 198, 98], ['V', 'rect', 1, 42, 60, 57], ['V', 'rect', 45, 12, 60, 77], ['V', 'rect', 61, 12, 198, 27], ['V', 'rect', 61, 62, 198, 77],
        ['V', 'poly', 106, 78, 134, 78, 126, 90, 114, 90], ['V', 'rect', 114, 90, 125, 98], ['A', 'rect', 80, 66, 95, 77],
        ['M', 'rect', 25, 42, 27, 45], ['M', 'rect', 25, 54, 27, 57], ['M', 'rect', 150, 12, 152, 15]],
      pinceau: 18, gomme: 48, etoiles: [8, 16.5, 18.8] }
  ];
  var SANDBOX = { id: 'bac', nom: 'Bac à sable', idee: 'Sans objectif',
    texte: 'Aucun objectif, aucun budget : dessine ce que tu veux et regarde le fluide s\'en arranger. L\'argile ocre s\'efface, les murs d\'acier restent.',
    bouches: [{ cote: 'O', de: 25, a: 74, role: 'entree' }, { cote: 'E', de: 25, a: 74, role: 'sortie' }],
    formes: [['M', 'rect', 1, 1, 198, 24], ['M', 'rect', 1, 75, 198, 98], ['A', 'disc', 70, 50, 9], ['A', 'poly', 120, 25, 150, 25, 135, 45], ['A', 'poly', 120, 75, 150, 75, 135, 55]] };

  // ---------- Simulation ----------
  // Boltzmann sur réseau D2Q9, collision BGK. Directions : 0 repos, 1 est, 2 sud, 3 ouest, 4 nord,
  // 5 sud-est, 6 sud-ouest, 7 nord-ouest, 8 nord-est (y vers le bas). F[i * N + c] est la population i
  // de la case c après collision ; chaque pas la tire depuis la case amont, ou la fait rebondir
  // si cette case est une paroi (rebond à mi-chemin).
  var F = new Float64Array(9 * N), G = new Float64Array(9 * N);
  var RHO = new Float32Array(N), UX = new Float32Array(N), UY = new Float32Array(N);
  var kind = new Uint8Array(N), kind0 = new Uint8Array(N), lock = new Uint8Array(N);
  var solid = new Uint8Array(N);
  var ports = [];
  // Par bouche : débit instantané, débit lissé, vitesse normale moyenne lissée.
  var PQ = new Float64Array(8), PQS = new Float64Array(8), PU = new Float64Array(8);
  var sim = { steps: 0, added: 0, removed: 0, paint: 1e9, erase: 1e9, since: 0, hn: 0 };
  var hist = new Float64Array(WIN);

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

  function resetFluid() {
    var c, p;
    for (c = 0; c < N; c++) { setEq(F, c, RHO_OUT, 0, 0); RHO[c] = RHO_OUT; UX[c] = 0; UY[c] = 0; }
    for (p = 0; p < PQ.length; p++) { PQ[p] = 0; PQS[p] = 0; PU[p] = 0; }
    sim.steps = 0;
    touch();
  }
  function touch() { sim.since = 0; sim.hn = 0; }

  // Les bouches sont des réservoirs à pression imposée : équilibre à la densité voulue,
  // avec la vitesse normale de la case voisine. Le débit se lit sur cette même rangée voisine.
  // Une pression fixe renverrait les ondes sonores sans fin ; la densité cède donc un peu
  // quand la vitesse s'écarte de sa moyenne récente, ce qui les absorbe sans changer le régime établi.
  function feedPorts() {
    var p, j, po, cells, n, m, c, nb, un, q, r, k, vx, vy, a, b, t;
    for (p = 0; p < ports.length; p++) {
      po = ports[p]; cells = po.cells; n = cells.length; q = 0; m = 0;
      for (j = 0; j < n; j++) {
        nb = cells[j] + po.off;
        if (!solid[nb]) { q += UX[nb] * po.nx + UY[nb] * po.ny; m++; }
      }
      if (m) q /= m;
      PU[p] += (q - PU[p]) * ABSORB_RATE;
      r = po.rho - ABSORB * (q - PU[p]);
      q = 0;
      for (j = 0; j < n; j++) {
        c = cells[j]; nb = c + po.off;
        un = solid[nb] ? 0 : UX[nb] * po.nx + UY[nb] * po.ny;
        q += RHO[nb] * un;
        vx = un * po.nx; vy = un * po.ny;
        k = 1 - 1.5 * un * un; a = vx + vy; b = vy - vx;
        F[c] = W0 * r * k;
        t = W1 * r;
        F[N1 + c] = t * (k + 3 * vx + 4.5 * vx * vx);
        F[N3 + c] = t * (k - 3 * vx + 4.5 * vx * vx);
        F[N2 + c] = t * (k + 3 * vy + 4.5 * vy * vy);
        F[N4 + c] = t * (k - 3 * vy + 4.5 * vy * vy);
        t = W2 * r;
        F[N5 + c] = t * (k + 3 * a + 4.5 * a * a);
        F[N7 + c] = t * (k - 3 * a + 4.5 * a * a);
        F[N6 + c] = t * (k + 3 * b + 4.5 * b * b);
        F[N8 + c] = t * (k - 3 * b + 4.5 * b * b);
      }
      if (po.role !== 'entree') q = -q;
      PQ[p] = q;
      PQS[p] += (q - PQS[p]) * SMOOTH;
    }
  }

  function collide() {
    var x, y, c, s, sw, sn, se, ss;
    var f0, f1, f2, f3, f4, f5, f6, f7, f8, r, vx, vy, u2, k, a, b, om, q, pxx, pyy, pxy, t, swap;
    for (y = 1; y < NY - 1; y++) {
      for (x = 1, c = y * NX + 1; x < NX - 1; x++, c++) {
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
          f0 = W0; f1 = f2 = f3 = f4 = W1; f5 = f6 = f7 = f8 = W2; r = 1;
        }
        vx = (f1 + f5 + f8 - f3 - f6 - f7) / r;
        vy = (f2 + f5 + f6 - f4 - f7 - f8) / r;
        u2 = vx * vx + vy * vy;
        if (u2 > UMAX * UMAX) { k = UMAX / Math.sqrt(u2); vx *= k; vy *= k; u2 = UMAX * UMAX; }
        RHO[c] = r; UX[c] = vx; UY[c] = vy;

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
    }
    swap = F; F = G; G = swap;
  }

  // La comptabilité reste hors de la boucle chaude, que le moteur JavaScript optimise mieux seule.
  function step() {
    feedPorts();
    collide();
    sim.steps++; sim.since++;
    if (sim.steps % WIN_EVERY === 0) { hist[sim.hn % WIN] = rawScore(); sim.hn++; }
  }

  // ---------- Niveau ----------
  var level = null;

  function put(t, x, y) {
    if (x < 1 || y < 1 || x > NX - 2 || y > NY - 2) return;
    var c = y * NX + x;
    if (t === 'Z') lock[c] = 1;
    else kind[c] = t === 'M' ? WALL : t === 'A' ? CLAY : FLUID;
  }

  // Les sommets d'un polygone sont des coins de cases ; une case est prise si son centre est dedans.
  function inPoly(p, px, py) {
    var inside = false, i, j, n = p.length;
    for (i = 0, j = n - 2; i < n; j = i, i += 2) {
      if ((p[i + 1] > py) !== (p[j + 1] > py) &&
          px < (p[j] - p[i]) * (py - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
    }
    return inside;
  }

  function drawShape(s) {
    var t = s[0], x, y, d, p;
    if (s[1] === 'rect') {
      for (y = s[3]; y <= s[5]; y++) for (x = s[2]; x <= s[4]; x++) put(t, x, y);
    } else if (s[1] === 'disc') {
      for (y = Math.floor(s[3] - s[4]); y <= s[3] + s[4]; y++) {
        for (x = Math.floor(s[2] - s[4]); x <= s[2] + s[4]; x++) {
          d = (x + 0.5 - s[2]) * (x + 0.5 - s[2]) + (y + 0.5 - s[3]) * (y + 0.5 - s[3]);
          if (d <= s[4] * s[4]) put(t, x, y);
        }
      }
    } else {
      p = s.slice(2);
      for (y = 1; y < NY - 1; y++) for (x = 1; x < NX - 1; x++) if (inPoly(p, x + 0.5, y + 0.5)) put(t, x, y);
    }
  }

  function loadLevel(def) {
    var c, x, y, i, j, d, po, n, horiz;
    level = def;
    for (c = 0; c < N; c++) { kind[c] = FLUID; lock[c] = 0; }
    for (x = 0; x < NX; x++) { kind[x] = WALL; kind[N - NX + x] = WALL; }
    for (y = 0; y < NY; y++) { kind[y * NX] = WALL; kind[y * NX + NX - 1] = WALL; }
    for (i = 0; i < def.formes.length; i++) drawShape(def.formes[i]);

    ports = [];
    for (i = 0; i < def.bouches.length; i++) {
      d = def.bouches[i];
      n = SIDES[d.cote]; horiz = n[0] !== 0;
      po = {
        role: d.role, nom: d.nom || '', cote: d.cote, de: d.de, a: d.a,
        nx: n[0], ny: n[1], off: n[0] + n[1] * NX,
        rho: d.role === 'entree' ? RHO_IN : RHO_OUT,
        cells: new Int32Array(d.a - d.de + 1)
      };
      for (j = d.de; j <= d.a; j++) {
        c = horiz ? j * NX + (d.cote === 'O' ? 0 : NX - 1) : (d.cote === 'N' ? 0 : NY - 1) * NX + j;
        po.cells[j - d.de] = c;
        kind[c] = FLUID;
      }
      ports.push(po);
    }
    for (c = 0; c < N; c++) { kind0[c] = kind[c]; solid[c] = kind[c] === FLUID ? 0 : 1; }
    sim.added = 0; sim.removed = 0;
    sim.paint = def.pinceau === undefined ? 1e9 : def.pinceau;
    sim.erase = def.gomme === undefined ? 1e9 : def.gomme;
    resetFluid();
  }

  // ---------- Édition ----------
  // Le budget se compte par différence avec l'état de départ : remettre une case comme elle était rembourse.
  function setCell(c, k) {
    var was = kind[c], r, n;
    if (was === k || was === WALL || lock[c]) return 0;
    if (k === CLAY) {
      if (kind0[c] === CLAY) sim.removed--;
      else { if (sim.added >= sim.paint) return 0; sim.added++; }
      kind[c] = CLAY; solid[c] = 1; UX[c] = 0; UY[c] = 0;
    } else {
      if (kind0[c] === CLAY) { if (sim.removed >= sim.erase) return 0; sim.removed++; }
      else sim.added--;
      kind[c] = FLUID; solid[c] = 0;
      r = 0; n = 0;
      if (!solid[c - 1]) { r += RHO[c - 1]; n++; }
      if (!solid[c + 1]) { r += RHO[c + 1]; n++; }
      if (!solid[c - NX]) { r += RHO[c - NX]; n++; }
      if (!solid[c + NX]) { r += RHO[c + NX]; n++; }
      r = n ? r / n : RHO_OUT;
      setEq(F, c, r, 0, 0); RHO[c] = r;
    }
    return 1;
  }

  function dab(px, py, d, k) {
    var r = d / 2, x, y, dx, dy, n = 0;
    var x0 = Math.max(1, Math.floor(px - r)), x1 = Math.min(NX - 2, Math.ceil(px + r));
    var y0 = Math.max(1, Math.floor(py - r)), y1 = Math.min(NY - 2, Math.ceil(py + r));
    x = Math.floor(px); y = Math.floor(py);
    if (x >= 1 && y >= 1 && x <= NX - 2 && y <= NY - 2) n += setCell(y * NX + x, k);
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        dx = x + 0.5 - px; dy = y + 0.5 - py;
        if (dx * dx + dy * dy <= r * r) n += setCell(y * NX + x, k);
      }
    }
    if (n) touch();
    return n;
  }

  function stroke(ax, ay, bx, by, d, k) {
    var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    var m = Math.max(1, Math.ceil(len * 2)), i, n = 0;
    for (i = 1; i <= m; i++) n += dab(ax + (bx - ax) * i / m, ay + (by - ay) * i / m, d, k);
    return n;
  }

  function restore(snap) {
    var c;
    for (c = 0; c < N; c++) {
      if (kind[c] === snap[c]) continue;
      kind[c] = snap[c];
      if (snap[c] === FLUID) { solid[c] = 0; setEq(F, c, RHO_OUT, 0, 0); RHO[c] = RHO_OUT; }
      else { solid[c] = 1; }
      UX[c] = 0; UY[c] = 0;
    }
    sim.added = 0; sim.removed = 0;
    for (c = 0; c < N; c++) {
      if (kind[c] === CLAY && kind0[c] === FLUID) sim.added++;
      if (kind[c] === FLUID && kind0[c] === CLAY) sim.removed++;
    }
    touch();
  }

  // ---------- Score ----------
  // Débit utile, en unités du réseau : somme des sorties (ou la plus faible, comptée autant de fois
  // qu'il y a de sorties, quand il faut les équilibrer), moins ce qui part par les fuites.
  function rawScore() {
    var p, po, sum = 0, min = Infinity, n = 0, leak = 0;
    for (p = 0; p < ports.length; p++) {
      po = ports[p];
      if (po.role === 'sortie') { sum += PQS[p]; n++; if (PQS[p] < min) min = PQS[p]; }
      else if (po.role === 'fuite' && PQS[p] > 0) leak += PQS[p];
    }
    if (level && level.score === 'min' && n) sum = n * min;
    return sum - leak;
  }
  function score() { return Math.max(0, rawScore() * UNIT); }

  // La mesure est tenue pour stable quand le débit lissé ne bouge presque plus sur toute la fenêtre,
  // ou, pour un écoulement qui bat sans fin, après une longue attente : on rend alors la moyenne.
  function settled() {
    var i, v, lo = Infinity, hi = -Infinity, sum = 0;
    if (sim.hn < WIN) return null;
    for (i = 0; i < WIN; i++) { v = hist[i]; sum += v; if (v < lo) lo = v; if (v > hi) hi = v; }
    sum /= WIN;
    if (hi - lo > Math.max(0.01 * Math.abs(sum), 0.1 / UNIT) && sim.since < SETTLE_MAX) return null;
    return Math.max(0, sum * UNIT);
  }
  function starsFor(v) {
    var e = level && level.etoiles, n = 0;
    if (e && v !== null) while (n < 3 && v >= e[n]) n++;
    return n;
  }

  // ---------- Interface : état ----------
  var $ = function (s) { return document.querySelector(s); };
  var SCALE = 5, CW = NX * SCALE, CH = NY * SCALE;
  var SPEEDS = [6, 24, 40];        // pas de simulation par image
  var FRAME_MS = 11;               // au-delà, l'image rend la main même s'il reste des pas à faire
  var NT = 1500;                   // traceurs
  var ROLES = { entree: 'Entrée', sortie: 'Sortie', fuite: 'Fuite' };
  var INK = { entree: '#6fe0ff', sortie: '#7dffb0', fuite: '#ff6b6b' };
  // Dégradés : position, rouge, vert, bleu.
  var RAMPS = {
    vitesse: [0, 7, 18, 37, 0.25, 18, 60, 122, 0.5, 31, 163, 201, 0.75, 143, 240, 208, 1, 255, 251, 208],
    pression: [0, 20, 14, 52, 0.35, 92, 36, 120, 0.7, 214, 88, 110, 1, 255, 214, 130],
    tourbillon: [0, 255, 170, 90, 0.3, 150, 70, 40, 0.5, 7, 18, 37, 0.7, 30, 90, 160, 1, 120, 220, 255]
  };

  var canvas = $('#vue'), ctx = canvas.getContext('2d');
  var field = layer(NX, NY), walls = layer(NX, NY), trail = layer(CW, CH);
  var fieldImg = field.ctx.createImageData(NX, NY), wallImg = walls.ctx.createImageData(NX, NY);
  var LUT = { vitesse: ramp(RAMPS.vitesse), pression: ramp(RAMPS.pression), tourbillon: ramp(RAMPS.tourbillon) };
  var TX = new Float32Array(NT), TY = new Float32Array(NT), TA = new Float32Array(NT);
  var inlets = new Int32Array(0);

  // n : numéro du niveau, -1 pour le bac à sable. k : ce que pose le trait en cours.
  var ui = {
    n: 0, tool: CLAY, size: 4, view: 'vitesse', paused: false, speed: 1,
    down: false, k: CLAY, changed: 0, lx: 0, ly: 0, hx: -1, hy: -1,
    dirty: true, undo: [], redo: [], tick: 0, done: 0
  };
  var save = { best: {} };

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
  function nbsp(t) { return t.replace(/ ([:;?!])/g, ' $1'); }
  function starText(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(n); }

  // ---------- Sauvegarde ----------
  function loadSave() {
    try {
      var s = JSON.parse(localStorage.getItem('flux.v1'));
      if (s && s.best) save = s;
    } catch (e) { /* stockage indisponible : on joue sans mémoire */ }
  }
  function writeSave() {
    try { localStorage.setItem('flux.v1', JSON.stringify(save)); } catch (e) { /* idem */ }
  }
  function bestOf(i) { return save.best[LEVELS[i].id] || null; }
  function unlocked(i) { return i <= 0 || !!(bestOf(i - 1) && bestOf(i - 1).e > 0); }

  // ---------- Partie ----------
  function openLevel(n) {
    var def = n < 0 ? SANDBOX : LEVELS[n], p, j, list = [];
    ui.n = n;
    loadLevel(def);
    ui.undo = []; ui.redo = []; ui.dirty = true; ui.done = 0; ui.down = false;
    ui.tool = def.pinceau === 0 ? FLUID : CLAY;
    for (p = 0; p < ports.length; p++) {
      if (ports[p].role !== 'entree') continue;
      for (j = 0; j < ports[p].cells.length; j++) list.push(ports[p].cells[j] + ports[p].off);
    }
    inlets = new Int32Array(list);
    for (j = 0; j < NT; j++) spawn(j, true);
    trail.ctx.clearRect(0, 0, CW, CH);
    $('#niveaux').hidden = true; $('#aide').hidden = true;
    renderBrief();
    hud();
  }

  function pushUndo() {
    ui.undo.push(kind.slice());
    if (ui.undo.length > 60) ui.undo.shift();
    ui.redo = [];
  }
  function undo() {
    if (!ui.undo.length) return;
    ui.redo.push(kind.slice());
    restore(ui.undo.pop());
    ui.dirty = true; ui.done = 0;
  }
  function redo() {
    if (!ui.redo.length) return;
    ui.undo.push(kind.slice());
    restore(ui.redo.pop());
    ui.dirty = true; ui.done = 0;
  }
  function resetLevel() {
    pushUndo();
    restore(kind0);
    ui.dirty = true; ui.done = 0;
  }

  // Avance la simulation de n pas, sans dépasser le temps alloué à une image.
  function tick(n) {
    var t0 = performance.now(), i = 0;
    while (i < n) {
      step(); i++;
      if ((i & 3) === 0 && performance.now() - t0 > FRAME_MS) break;
    }
    if (i) moveTracers(i);
    draw();
    if (ui.tick++ % 6 === 0) hud();
  }
  function frame() {
    tick(ui.paused ? 0 : SPEEDS[ui.speed]);
    requestAnimationFrame(frame);
  }

  // Enregistre le débit dès que la mesure est stable, et seulement s'il bat le record.
  function judge() {
    var v = settled(), n, id, b;
    if (v === null || ui.n < 0) return v;
    n = starsFor(v); id = level.id; b = save.best[id];
    if (n > ui.done) ui.done = n;
    if (n > 0 && (!b || v > b.d)) { save.best[id] = { d: v, e: Math.max(n, b ? b.e : 0) }; writeSave(); }
    return v;
  }

  // ---------- Traceurs ----------
  function spawn(i, anywhere) {
    var c = -1, k;
    if (inlets.length && !anywhere && Math.random() < 0.75) c = inlets[(Math.random() * inlets.length) | 0];
    for (k = 0; k < 12 && (c < 0 || solid[c]); k++) c = (1 + ((Math.random() * (NY - 2)) | 0)) * NX + 1 + ((Math.random() * (NX - 2)) | 0);
    if (c < 0 || solid[c]) c = NX + 1;
    TX[i] = c % NX + Math.random(); TY[i] = ((c / NX) | 0) + Math.random();
    TA[i] = 60 + Math.random() * 360;
  }

  function moveTracers(n) {
    var g = trail.ctx, sub = Math.ceil(n / 8), h = n / sub, i, k, c, x, y, nx, ny;
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(0, 0, CW, CH);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(214,240,255,0.55)';
    g.lineWidth = 1.3;
    g.beginPath();
    for (i = 0; i < NT; i++) {
      x = TX[i]; y = TY[i]; nx = x; ny = y;
      for (k = 0; k < sub; k++) {
        if (!(nx >= 1 && ny >= 1 && nx < NX - 1 && ny < NY - 1)) break;
        c = (ny | 0) * NX + (nx | 0);
        nx += UX[c] * h; ny += UY[c] * h;
      }
      if (--TA[i] < 0 || !(nx >= 1 && ny >= 1 && nx < NX - 1 && ny < NY - 1) || solid[(ny | 0) * NX + (nx | 0)]) { spawn(i, false); continue; }
      g.moveTo(x * SCALE, y * SCALE); g.lineTo(nx * SCALE, ny * SCALE);
      TX[i] = nx; TY[i] = ny;
    }
    g.stroke();
  }

  // ---------- Affichage ----------
  function paintField() {
    var d = fieldImg.data, lut = LUT[ui.view], view = ui.view, x, y, c, j, v;
    for (y = 0, c = 0, j = 0; y < NY; y++) {
      for (x = 0; x < NX; x++, c++, j += 4) {
        if (view === 'tourbillon') {
          v = 128;
          if (!solid[c] && x > 0 && y > 0 && x < NX - 1 && y < NY - 1) v += (UY[c + 1] - UY[c - 1] - UX[c + NX] + UX[c - NX]) * 2400;
        } else if (solid[c]) v = 0;
        else if (view === 'vitesse') v = Math.sqrt(UX[c] * UX[c] + UY[c] * UY[c]) * 1700;
        else v = ((RHO[c] - RHO_OUT) / (RHO_IN - RHO_OUT) * 0.75 + 0.2) * 255;
        v = v > 255 ? 255 : v > 0 ? v | 0 : 0;
        d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2]; d[j + 3] = 255;
      }
    }
    field.ctx.putImageData(fieldImg, 0, 0);
  }

  function open4(x, y, c) {
    return (x > 0 && !solid[c - 1]) || (x < NX - 1 && !solid[c + 1]) || (y > 0 && !solid[c - NX]) || (y < NY - 1 && !solid[c + NX]);
  }

  // Murs d'acier hachurés, argile ocre mouchetée, liseré clair au contact du fluide, zones interdites rayées.
  function paintWalls() {
    var d = wallImg.data, x, y, c, j, k, r, g, b, a;
    for (y = 0, c = 0, j = 0; y < NY; y++) {
      for (x = 0; x < NX; x++, c++, j += 4) {
        k = kind[c]; a = 255;
        if (k === FLUID) { r = 255; g = 96; b = 96; a = lock[c] ? (((x + y) & 3) === 0 ? 170 : 30) : 0; }
        else if (k === WALL) {
          if (open4(x, y, c)) { r = 132; g = 184; b = 232; }
          else if ((x + y) % 6 === 0) { r = 34; g = 56; b = 88; }
          else { r = 18; g = 32; b = 54; }
        } else if (open4(x, y, c)) { r = 246; g = 200; b = 132; }
        else if ((x * 7 + y * 3) % 5 === 0) { r = 172; g = 112; b = 56; }
        else { r = 201; g = 138; b = 74; }
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = a;
      }
    }
    walls.ctx.putImageData(wallImg, 0, 0);
    ui.dirty = false;
  }

  function label(text, x, y, align, color) {
    ctx.textAlign = align;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(6,14,28,0.9)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawPorts() {
    var p, po, a, len, mid, text, color;
    ctx.font = '600 13px Consolas, "Cascadia Mono", Menlo, monospace';
    ctx.textBaseline = 'middle';
    for (p = 0; p < ports.length; p++) {
      po = ports[p]; color = INK[po.role];
      a = po.de * SCALE; len = (po.a - po.de + 1) * SCALE; mid = a + len / 2;
      text = (ROLES[po.role] + (po.nom ? ' ' + po.nom : '')).toUpperCase() + '  ' + fmt(PQS[p] * UNIT);
      ctx.fillStyle = color;
      if (po.cote === 'O') { ctx.fillRect(0, a, SCALE, len); label(text, SCALE + 8, mid, 'left', color); }
      else if (po.cote === 'E') { ctx.fillRect(CW - SCALE, a, SCALE, len); label(text, CW - SCALE - 8, mid, 'right', color); }
      else if (po.cote === 'N') { ctx.fillRect(a, 0, len, SCALE); label(text, mid, SCALE + 14, 'center', color); }
      else { ctx.fillRect(a, CH - SCALE, len, SCALE); label(text, mid, CH - SCALE - 13, 'center', color); }
    }
  }

  function draw() {
    var x;
    paintField();
    if (ui.dirty) paintWalls();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(field.cv, 0, 0, CW, CH);
    ctx.fillStyle = 'rgba(140,190,255,0.045)';
    for (x = 10; x < NX; x += 10) ctx.fillRect(x * SCALE, 0, 1, CH);
    for (x = 10; x < NY; x += 10) ctx.fillRect(0, x * SCALE, CW, 1);
    ctx.drawImage(trail.cv, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(walls.cv, 0, 0, CW, CH);
    drawPorts();
    if (ui.hx >= 0) {
      ctx.strokeStyle = ui.tool === CLAY ? '#f6c884' : '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ui.hx * SCALE, ui.hy * SCALE, Math.max(ui.size / 2, 0.6) * SCALE, 0, 6.2832);
      ctx.stroke();
    }
  }

  // ---------- Tableau de bord ----------
  function renderBrief() {
    var def = level, html = '', p, po;
    $('#num').textContent = ui.n < 0 ? 'Libre' : 'Niveau ' + (ui.n + 1) + ' / ' + LEVELS.length;
    $('#nom').textContent = def.nom;
    $('#idee').textContent = def.idee;
    $('#texte').textContent = nbsp(def.texte);
    for (p = 0; p < ports.length; p++) {
      po = ports[p];
      html += '<li class="b-' + po.role + '"><span>' + ROLES[po.role] + (po.nom ? ' ' + po.nom : '') + '</span><b id="q' + p + '">0,0</b></li>';
    }
    $('#bouches').innerHTML = html;
    $('#jauge').hidden = !def.etoiles;
    $('#verdict').hidden = !def.etoiles;
    if (def.etoiles) {
      for (p = 0; p < 3; p++) {
        $('#seuil' + p).style.left = (def.etoiles[p] / (def.etoiles[2] * 1.2) * 100) + '%';
        $('#seuil' + p).title = fmt(def.etoiles[p]);
      }
      $('#seuils').textContent = '★ ' + fmt(def.etoiles[0]) + '   ★★ ' + fmt(def.etoiles[1]) + '   ★★★ ' + fmt(def.etoiles[2]);
    }
    $('#regle').textContent = def.score === 'min' ? 'Débit utile = 2 × la plus faible sortie' + (hasLeak() ? ' − fuite' : '')
      : hasLeak() ? 'Débit utile = sortie − fuite' : 'Débit utile = débit de sortie';
  }
  function hasLeak() {
    for (var p = 0; p < ports.length; p++) if (ports[p].role === 'fuite') return true;
    return false;
  }

  function budget(el, used, max, word) {
    el.hidden = max === 0 && used === 0;
    el.querySelector('b').textContent = max >= 1e9 ? 'illimité' : (max - used) + ' / ' + max;
    el.querySelector('i').style.width = max >= 1e9 ? '100%' : max ? ((max - used) / max * 100) + '%' : '0%';
    el.classList.toggle('vide', max < 1e9 && used >= max);
    el.querySelector('span').textContent = word;
  }

  function hud() {
    var v = score(), s = judge(), def = level, p, n, b, el;
    $('#debit').textContent = fmt(v);
    for (p = 0; p < ports.length; p++) { el = $('#q' + p); if (el) el.textContent = fmt(PQS[p] * UNIT); }
    budget($('#bPinceau'), sim.added, sim.paint, 'Paroi à poser');
    budget($('#bGomme'), sim.removed, sim.erase, 'Argile à retirer');
    $('#etat').textContent = ui.paused ? 'En pause' : s === null ? 'Mesure en cours…' : 'Mesure stable';
    $('#etat').className = s === null || ui.paused ? 'etat' : 'etat ok';
    if (def.etoiles) {
      n = starsFor(s === null ? v : s);
      $('#fill').style.width = Math.min(100, v / (def.etoiles[2] * 1.2) * 100) + '%';
      $('#etoiles').textContent = starText(n);
      $('#etoiles').className = s === null ? 'etoiles attente' : 'etoiles';
      b = save.best[def.id];
      $('#record').textContent = b ? 'Record : ' + fmt(b.d) + '  ' + starText(b.e) : 'Pas encore de record';
      $('#suivant').hidden = !(b && b.e > 0 && ui.n + 1 < LEVELS.length);
      $('#bravo').hidden = !ui.done;
      $('#bravo').textContent = ui.done === 3 ? 'Trois étoiles : conduit optimisé.' : ui.done ? 'Niveau validé. Tu peux encore gratter du débit.' : '';
    }
    toggle('[data-act="pinceau"]', ui.tool === CLAY);
    toggle('[data-act="gomme"]', ui.tool === FLUID);
    toggle('[data-act="pause"]', ui.paused);
    $('[data-act="pause"]').textContent = ui.paused ? 'Reprendre' : 'Pause';
    $('[data-act="annuler"]').disabled = !ui.undo.length;
    $('[data-act="retablir"]').disabled = !ui.redo.length;
    $('#tailleVal').textContent = ui.size;
    each('[data-vue]', function (el2) { el2.setAttribute('aria-pressed', el2.getAttribute('data-vue') === ui.view); });
    each('[data-vit]', function (el2) { el2.setAttribute('aria-pressed', +el2.getAttribute('data-vit') === ui.speed); });
  }
  function toggle(sel, on) { $(sel).setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  function renderLevels() {
    var html = '', i, b, ok;
    for (i = 0; i < LEVELS.length; i++) {
      b = bestOf(i); ok = unlocked(i);
      html += '<button type="button" class="carte' + (i === ui.n ? ' ici' : '') + '" data-act="niveau" data-n="' + i + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="no">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span class="corps">' +
        '<b>' + LEVELS[i].nom + '</b>' +
        '<span class="sous">' + (ok ? LEVELS[i].idee : 'Verrouillé : réussis le niveau précédent') + '</span>' +
        '<span class="pied"><span class="et">' + starText(b ? b.e : 0) + '</span><span>' + (b ? 'record ' + fmt(b.d) : '') + '</span></span></span></button>';
    }
    html += '<button type="button" class="carte' + (ui.n < 0 ? ' ici' : '') + '" data-act="niveau" data-n="-1">' +
      '<span class="no">∞</span><span class="corps"><b>' + SANDBOX.nom + '</b><span class="sous">Ni objectif ni budget</span></span></button>';
    $('#grille').innerHTML = html;
    $('#niveaux').hidden = false;
    $('#aide').hidden = true;
  }

  // ---------- Commandes ----------
  function cellOf(e) {
    var r = canvas.getBoundingClientRect();
    ui.hx = (e.clientX - r.left) / r.width * NX;
    ui.hy = (e.clientY - r.top) / r.height * NY;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (e.button === 1) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
    cellOf(e);
    pushUndo();
    ui.down = true; ui.k = e.button === 2 ? FLUID : ui.tool;
    ui.changed = dab(ui.hx, ui.hy, ui.size, ui.k);
    ui.lx = ui.hx; ui.ly = ui.hy;
    if (ui.changed) { ui.dirty = true; ui.done = 0; }
  });
  canvas.addEventListener('pointermove', function (e) {
    var n;
    cellOf(e);
    if (!ui.down) return;
    n = stroke(ui.lx, ui.ly, ui.hx, ui.hy, ui.size, ui.k);
    ui.lx = ui.hx; ui.ly = ui.hy;
    if (n) { ui.changed += n; ui.dirty = true; ui.done = 0; }
  });
  function release() {
    if (ui.down && !ui.changed) ui.undo.pop();
    ui.down = false;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', function () { if (!ui.down) ui.hx = -1; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act],[data-vue],[data-vit]') : null, act;
    if (!el) return;
    if (el.hasAttribute('data-vue')) ui.view = el.getAttribute('data-vue');
    else if (el.hasAttribute('data-vit')) ui.speed = +el.getAttribute('data-vit');
    act = el.getAttribute('data-act');
    if (act === 'pinceau') ui.tool = CLAY;
    else if (act === 'gomme') ui.tool = FLUID;
    else if (act === 'annuler') undo();
    else if (act === 'retablir') redo();
    else if (act === 'zero') resetLevel();
    else if (act === 'pause') ui.paused = !ui.paused;
    else if (act === 'pas') { ui.paused = true; tick(8); }
    else if (act === 'niveaux') renderLevels();
    else if (act === 'aide') { $('#aide').hidden = false; $('#niveaux').hidden = true; }
    else if (act === 'fermer') { $('#aide').hidden = true; $('#niveaux').hidden = true; }
    else if (act === 'niveau') openLevel(+el.getAttribute('data-n'));
    else if (act === 'suivant' && unlocked(ui.n + 1)) openLevel(ui.n + 1);
    else if (act === 'bac') openLevel(-1);
    hud();
  });

  $('#taille').addEventListener('input', function () { ui.size = +this.value; hud(); });

  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (k === ' ' && e.target && e.target.tagName === 'BUTTON') return;
    if ((e.ctrlKey || e.metaKey) && k === 'z') { if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') redo();
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === 'b' || k === 'p') ui.tool = CLAY;
    else if (k === 'g' || k === 'e') ui.tool = FLUID;
    else if (k === ' ') ui.paused = !ui.paused;
    else if (k === 'n') { ui.paused = true; tick(8); }
    else if (k === '1') ui.view = 'vitesse';
    else if (k === '2') ui.view = 'pression';
    else if (k === '3') ui.view = 'tourbillon';
    else if (k === '+' || k === '=') ui.size = Math.min(12, ui.size + 1);
    else if (k === '-') ui.size = Math.max(1, ui.size - 1);
    else if (k === 'escape') { $('#aide').hidden = true; $('#niveaux').hidden = true; }
    else return;
    e.preventDefault();
    $('#taille').value = ui.size;
    hud();
  });

  // ---------- Démarrage ----------
  loadSave();
  (function () {
    var n = 0;
    while (n + 1 < LEVELS.length && unlocked(n + 1)) n++;
    openLevel(n);
    if (!bestOf(0)) $('#aide').hidden = false;
  })();
  requestAnimationFrame(frame);

  // Prise pour les tests hors navigateur et pour la console.
  window.FLUX = {
    NX: NX, NY: NY, UNIT: UNIT, LEVELS: LEVELS, SANDBOX: SANDBOX, sim: sim,
    load: loadLevel, open: openLevel, step: step, tick: tick, setCell: setCell, dab: dab, stroke: stroke, restore: restore,
    score: score, settled: settled, starsFor: starsFor, resetFluid: resetFluid, levels: renderLevels,
    ports: function () { return ports.map(function (po, p) { return { role: po.role, nom: po.nom, q: PQ[p], qs: PQS[p] }; }); },
    fields: function () { return { rho: RHO, ux: UX, uy: UY, kind: kind, kind0: kind0, lock: lock, f: F }; }
  };
})();
