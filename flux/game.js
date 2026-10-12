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
  var SPEEDS = [6, 24, 40];        // pas de simulation par image
  var FRAME_MS = 11;               // au-delà, l'image rend la main même s'il reste des pas à faire
  var NT = 1500, NTX = 900;        // filets d'air : fond permanent, renfort dans la fenêtre quand on zoome
  var ZMAX = 40;                   // pixels par case au plus fort zoom
  var PADX = 48, PADY = 46;        // marge du plan en vue d'ensemble : bouches, cotes et repères
  var RIVE = 3;                    // épaisseur, en cases, de la bande hachurée le long des parois
  var CM = 5;                      // une case vaut 5 cm : donne l'échelle du cartouche
  var ROLES = { entree: 'Entrée', sortie: 'Sortie', fuite: 'Fuite' };
  var PAPIER = '#f1f2ec', ENCRE = '#1b2530', BLEU = '#1d4f8c', ROUGE = '#cf3a1f', SEPIA = '#8a6a3a';
  var TEINTE = { entree: BLEU, sortie: ENCRE, fuite: ROUGE };
  var POLICE = 'Bahnschrift, "Arial Narrow", "Franklin Gothic Medium", sans-serif';
  // Consignes : mêmes niveaux, vocabulaire de la gaine de ventilation.
  var TEXTES = {
    bouchon: 'Un bouchon de plâtre ferme la gaine. Ta gomme ne peut retirer que 110 cases : perce là où chaque case rapporte le plus.',
    bosses: 'Trois bosses de plâtre étranglent la gaine. Le débit se décide au passage le plus étroit : répartis ta gomme en conséquence.',
    fuite: 'Avant la grille, un piquage laisse fuir l\'air : tout ce qui sort par la bouche marquée « fuite » est retiré de ton débit. Tu n\'as que 14 cases à poser.',
    coude: 'L\'air doit prendre un virage à angle droit. Taille le coin de plâtre à l\'intérieur du virage pour l\'aider à tourner : toutes les entailles ne se valent pas.',
    diaphragme: 'Une plaque percée freine tout, et tu ne peux pas l\'enlever. Mais le jet qui en sort gaspille son élan en tourbillons : pose de la matière pour guider l\'air avant et après le trou.',
    partage: 'Deux sorties, A et B. Seule la plus faible compte, comptée deux fois : freine juste ce qu\'il faut la branche trop gourmande.',
    aiguillage: 'L\'air file tout droit vers la fuite, et la zone à hachures croisées est interdite. Dix cases ne suffisent pas à fermer le passage : trouve comment freiner le plus avec si peu.',
    pilier: 'Un poteau de béton bouche presque toute la gaine. Creuse le plâtre des parois pour que l\'air le contourne sans trop de détours.',
    serpentin: 'La gaine serpente longuement entre deux cloisons de plâtre. Ouvre un raccourci : une brèche large ou deux petites, dans l\'épais ou dans le mince ?',
    usine: 'Une fuite à fermer, une bosse à raboter, deux sorties à équilibrer, et des budgets serrés. La plus faible des sorties A et B compte double, la fuite se soustrait.',
    bac: 'Aucun objectif, aucun budget : dessine ce que tu veux et regarde l\'air s\'en arranger. Le plâtre se gomme, le béton reste.'
  };
  // Lavis sur papier : position, rouge, vert, bleu. La clarté décroît toujours avec la grandeur,
  // et les tourbillons opposent bleu et orangé : lisible sans distinguer le rouge du vert.
  var RAMPS = {
    vitesse: [0, 241, 242, 236, 0.2, 212, 229, 232, 0.45, 150, 198, 218, 0.72, 84, 150, 196, 1, 40, 98, 158],
    pression: [0, 241, 242, 236, 0.2, 245, 236, 204, 0.5, 240, 208, 134, 0.78, 226, 164, 88, 1, 194, 116, 56],
    tourbillon: [0, 178, 86, 24, 0.3, 230, 170, 112, 0.5, 241, 242, 236, 0.7, 136, 178, 220, 1, 32, 84, 154]
  };
  var GAMMA = 0.6;
  // Graduations de la légende : position sur le dégradé, texte.
  var GRADS = {
    vitesse: [0, '0', Math.pow(1 / 3, GAMMA), '0,05', Math.pow(2 / 3, GAMMA), '0,10', 1, '0,15'],
    pression: [0.2, '0', 0.575, '50', 0.95, '100'],
    tourbillon: [0, 'antihoraire', 0.5, '0', 1, 'horaire']
  };
  var UNITES = { vitesse: 'Vitesse de l\'air, en cases par pas', pression: 'Surpression, en % de celle de l\'entrée', tourbillon: 'Sens et force de la rotation de l\'air' };
  // Catégories du plan, et traits qui les séparent.
  var C_AIR = 0, C_MUR = 1, C_PLATRE = 2, C_AJOUT = 3, C_INTERDIT = 4, C_GOMME = 5, C_HORS = 6;
  var S_MUR = 0, S_AJOUT = 1, S_PLATRE = 2, S_INTERDIT = 3, S_GOMME = 4, S_BORD = 5;
  var PAL = [241, 242, 236, 168, 173, 166, 216, 190, 138, 207, 58, 31, 222, 222, 226, 249, 214, 204, 0, 0, 0, 29, 79, 140, 27, 37, 48, 207, 58, 31];

  var canvas = $('#vue'), ctx = canvas.getContext('2d');
  var mini = $('#carte'), mctx = mini.getContext('2d');
  var field = layer(NX, NY), plan = layer(NX, NY), walls = layer(8, 8), trail = layer(8, 8), trail2 = layer(8, 8);
  var fieldImg = field.ctx.createImageData(NX, NY), planImg = plan.ctx.createImageData(NX, NY);
  var LUT = { vitesse: ramp(RAMPS.vitesse, GAMMA), pression: ramp(RAMPS.pression, 1), tourbillon: ramp(RAMPS.tourbillon, 1) };
  var TX = new Float32Array(NT + NTX), TY = new Float32Array(NT + NTX), TA = new Float32Array(NT + NTX);
  var inlets = new Int32Array(0);
  var cat = new Uint8Array(N), rim = new Uint8Array(N), ES = new Int8Array(49);
  var geo = { runs: [[], [], [], [], []], h: [[], [], [], [], [], []], v: [[], [], [], [], [], []] };
  var hatches = {}, nHatches = 0;
  var thumbs = [];
  var pvC = new Int32Array(N), pvS = new Uint8Array(N), seen = new Uint32Array(N), pv = { gen: 0, n: 0, ok: 0, budget: 0, lock: 0, added: 0, removed: 0 };
  var pts = {}, npts = 0, pinch = null;
  var doux = true;

  // z : pixels d'écran par case. tx, ty : position à l'écran du coin de la case (0, 0).
  // zt et l'ancre décrivent le zoom en cours d'approche ; shown est la vue des calques déjà tracés.
  var view = { w: 1000, h: 500, pr: 1, z: 5, tx: 0, ty: 0, zfit: 5, zt: 5, ax: 0, ay: 0, awx: 0, awy: 0, fit: true };
  var shown = { z: 0, tx: 0, ty: 0 };

  // n : numéro du niveau, -1 pour le bac à sable. k : ce que pose le trait en cours.
  var ui = {
    n: 0, tool: CLAY, size: 4, view: 'vitesse', paused: false, speed: 1,
    down: false, line: false, k: CLAY, changed: 0, lx: 0, ly: 0, ax: 0, ay: 0,
    over: false, sx: 0, sy: 0, hx: -1, hy: -1, pan: null, space: false, spaceUsed: false,
    dirty: true, planDirty: true, miniDirty: true, redraw: true, coord: '', legend: '', mini: false,
    undo: [], redo: [], tick: 0, done: 0
  };
  var save = { best: {} };

  function layer(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return { cv: cv, ctx: cv.getContext('2d') };
  }

  // gamma < 1 : les faibles valeurs prennent plus de teinte, pour qu'un écoulement lent reste lisible.
  function ramp(stops, gamma) {
    var lut = new Uint8Array(768), i, k, t, a, j;
    for (i = 0; i < 256; i++) {
      t = Math.pow(i / 255, gamma); k = 0;
      while (k + 8 < stops.length && t > stops[k + 4]) k += 4;
      a = Math.min(1, Math.max(0, (t - stops[k]) / (stops[k + 4] - stops[k])));
      for (j = 1; j <= 3; j++) lut[i * 3 + j - 1] = stops[k + j] + (stops[k + 4 + j] - stops[k + j]) * a;
    }
    return lut;
  }

  function fmt(v) { return (Math.abs(v) < 0.05 ? 0 : v).toFixed(1).replace('.', ','); }
  function nbsp(t) { return t.replace(/ ([:;?!»])/g, ' $1').replace(/« /g, '« '); }
  function starText(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function two(n) { return (n < 10 ? '0' : '') + n; }

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
    ui.undo = []; ui.redo = []; ui.dirty = true; ui.done = 0; ui.down = false; ui.line = false; ui.pan = null;
    ui.tool = def.pinceau === 0 ? FLUID : CLAY;
    for (p = 0; p < ports.length; p++) {
      if (ports[p].role !== 'entree') continue;
      for (j = 0; j < ports[p].cells.length; j++) list.push(ports[p].cells[j] + ports[p].off);
    }
    inlets = new Int32Array(list);
    fitView(true);
    for (j = 0; j < NT + NTX; j++) spawn(j, true);
    clearTrail();
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
  // Rien n'est redessiné si rien n'a bougé : ni pas de calcul, ni vue, ni plan, ni curseur.
  function tick(n) {
    var t0 = performance.now(), i = 0;
    syncView();
    while (i < n) {
      step(); i++;
      if ((i & 3) === 0 && performance.now() - t0 > FRAME_MS) break;
    }
    if (i) moveTracers(i);
    if (i || ui.redraw || ui.dirty) draw();
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

  // ---------- Vue ----------
  function clampView() {
    var pr = view.pr, cw, ch, tx = view.tx, ty = view.ty;
    view.z = clamp(view.z, view.zfit, ZMAX);
    cw = NX * view.z; ch = NY * view.z;
    tx = cw + 2 * PADX <= view.w ? (view.w - cw) / 2 : clamp(tx, view.w - PADX - cw, PADX);
    ty = ch + 2 * PADY <= view.h ? (view.h - ch) / 2 : clamp(ty, view.h - PADY - ch, PADY);
    view.tx = Math.round(tx * pr) / pr; view.ty = Math.round(ty * pr) / pr;
    view.fit = view.z <= view.zfit * 1.0005;
  }
  function setView(z, tx, ty) {
    view.z = z; view.zt = clamp(z, view.zfit, ZMAX); view.tx = tx; view.ty = ty;
    clampView();
    ui.redraw = true;
  }
  function zoomBy(k, sx, sy) {
    view.zt = clamp(view.zt * k, view.zfit, ZMAX);
    view.ax = sx; view.ay = sy;
    view.awx = (sx - view.tx) / view.z; view.awy = (sy - view.ty) / view.z;
    ui.redraw = true;
  }
  function fitView(now) {
    view.zt = view.zfit;
    view.ax = view.w / 2; view.ay = view.h / 2;
    view.awx = (view.ax - view.tx) / view.z; view.awy = (view.ay - view.ty) / view.z;
    if (now) { view.z = view.zfit; clampView(); }
    ui.redraw = true;
  }
  // Le zoom rejoint sa cible en quelques images, la case sous le curseur restant sous le curseur.
  function stepView() {
    var r;
    if (view.zt === view.z) return;
    r = Math.log(view.zt / view.z);
    view.z = !doux || Math.abs(r) < 0.012 ? view.zt : view.z * Math.exp(r * 0.34);
    view.tx = view.ax - view.awx * view.z; view.ty = view.ay - view.awy * view.z;
    clampView();
    if (view.fit) view.zt = view.z;
  }

  // Aligne les calques sur la vue : les filets déjà tracés suivent le déplacement au lieu de disparaître.
  function syncView() {
    var g, s, sw, pr = view.pr;
    stepView();
    if (view.z === shown.z && view.tx === shown.tx && view.ty === shown.ty) return;
    if (shown.z) {
      g = trail2.ctx; s = view.z / shown.z;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, trail2.cv.width, trail2.cv.height);
      g.setTransform(s, 0, 0, s, (view.tx - shown.tx * s) * pr, (view.ty - shown.ty * s) * pr);
      g.drawImage(trail.cv, 0, 0);
      sw = trail; trail = trail2; trail2 = sw;
    }
    shown.z = view.z; shown.tx = view.tx; shown.ty = view.ty;
    ui.planDirty = true; ui.miniDirty = true; ui.redraw = true;
    mini.hidden = view.fit;
  }
  function clearTrail() {
    trail.ctx.setTransform(1, 0, 0, 1, 0, 0);
    trail.ctx.clearRect(0, 0, trail.cv.width, trail.cv.height);
  }

  function resize() {
    var box = canvas.parentNode, w = box ? box.clientWidth : 0, h = box ? box.clientHeight : 0, pr, cx, cy, i, l;
    if (!(w > 0 && h > 0)) { w = 1000; h = 500; }
    pr = Math.min(window.devicePixelRatio || 1, 2);
    if (!(pr > 0)) pr = 1;
    if (w * h * pr * pr > 2.6e6) pr = Math.sqrt(2.6e6 / (w * h));
    if (w === view.w && h === view.h && pr === view.pr && shown.z) return;
    cx = (view.w / 2 - view.tx) / view.z; cy = (view.h / 2 - view.ty) / view.z;
    l = [canvas, walls.cv, trail.cv, trail2.cv];
    for (i = 0; i < l.length; i++) { l[i].width = Math.round(w * pr); l[i].height = Math.round(h * pr); }
    view.w = w; view.h = h; view.pr = pr;
    view.zfit = Math.max(1.5, Math.min((w - 2 * PADX) / NX, (h - 2 * PADY) / NY));
    if (view.fit) view.z = view.zfit;
    view.z = clamp(view.z, view.zfit, ZMAX); view.zt = view.z;
    view.tx = w / 2 - cx * view.z; view.ty = h / 2 - cy * view.z;
    clampView();
    shown.z = 0; ui.redraw = true;
  }

  function X(i) { return Math.round((view.tx + i * view.z) * view.pr); }
  function Y(j) { return Math.round((view.ty + j * view.z) * view.pr); }

  // ---------- Filets d'air ----------
  function spawn(i, anywhere) {
    var c = -1, k, x0, x1, y0, y1;
    if (i >= NT) {
      x0 = Math.max(1, Math.floor(-view.tx / view.z)); x1 = Math.min(NX - 2, Math.floor((view.w - view.tx) / view.z));
      y0 = Math.max(1, Math.floor(-view.ty / view.z)); y1 = Math.min(NY - 2, Math.floor((view.h - view.ty) / view.z));
      for (k = 0; k < 10 && (c < 0 || solid[c]); k++) c = (y0 + ((Math.random() * (y1 - y0 + 1)) | 0)) * NX + x0 + ((Math.random() * (x1 - x0 + 1)) | 0);
      if (c < 0 || solid[c]) { TX[i] = -9; TA[i] = 30; return; }
      TX[i] = c % NX + Math.random(); TY[i] = ((c / NX) | 0) + Math.random();
      TA[i] = 30 + Math.random() * 180;
      return;
    }
    if (inlets.length && !anywhere && Math.random() < 0.75) c = inlets[(Math.random() * inlets.length) | 0];
    for (k = 0; k < 12 && (c < 0 || solid[c]); k++) c = (1 + ((Math.random() * (NY - 2)) | 0)) * NX + 1 + ((Math.random() * (NX - 2)) | 0);
    if (c < 0 || solid[c]) c = NX + 1;
    TX[i] = c % NX + Math.random(); TY[i] = ((c / NX) | 0) + Math.random();
    TA[i] = 60 + Math.random() * 360;
  }

  function moveTracers(n) {
    var g = trail.ctx, sub = Math.ceil(n / 8), h = n / sub, i, k, c, x, y, nx, ny;
    var z = view.z * view.pr, ox = view.tx * view.pr, oy = view.ty * view.pr, cw = trail.cv.width, ch = trail.cv.height;
    var vx0 = -ox / z - 2, vx1 = (cw - ox) / z + 2, vy0 = -oy / z - 2, vy1 = (ch - oy) / z + 2;
    var count = view.z > view.zfit * 1.35 ? NT + NTX : NT;
    // Les filets ne vivent que dans l'emprise du conduit : inutile d'estomper les marges.
    var fx = Math.max(0, X(0)), fy = Math.max(0, Y(0));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(fx, fy, Math.min(cw, X(NX)) - fx, Math.min(ch, Y(NY)) - fy);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(16,36,58,0.54)';
    g.lineWidth = clamp(0.95 + view.z * 0.04, 1.1, 2.2) * view.pr;
    g.lineCap = 'butt';
    g.beginPath();
    for (i = 0; i < count; i++) {
      x = TX[i]; y = TY[i]; nx = x; ny = y;
      for (k = 0; k < sub; k++) {
        if (!(nx >= 1 && ny >= 1 && nx < NX - 1 && ny < NY - 1)) break;
        c = (ny | 0) * NX + (nx | 0);
        nx += UX[c] * h; ny += UY[c] * h;
      }
      if (--TA[i] < 0 || !(nx >= 1 && ny >= 1 && nx < NX - 1 && ny < NY - 1) || solid[(ny | 0) * NX + (nx | 0)]) { spawn(i, false); continue; }
      TX[i] = nx; TY[i] = ny;
      if (nx < vx0 || nx > vx1 || ny < vy0 || ny > vy1) { if (i >= NT) spawn(i, false); continue; }
      g.moveTo(ox + x * z, oy + y * z); g.lineTo(ox + nx * z, oy + ny * z);
    }
    g.stroke();
  }

  // ---------- Plan : géométrie ----------
  // Recalculée à chaque retouche : catégorie de chaque case, bandes à remplir, traits de contour.
  function edgeStyle(a, b) {
    if (a === b) return -1;
    if (a === C_HORS || b === C_HORS) return a === C_MUR || b === C_MUR || a === C_PLATRE || b === C_PLATRE || a === C_AJOUT || b === C_AJOUT ? S_BORD : -1;
    if (a === C_MUR || b === C_MUR) return S_MUR;
    if (a === C_AJOUT || b === C_AJOUT) return S_AJOUT;
    if (a === C_PLATRE || b === C_PLATRE) return S_PLATRE;
    if (a === C_INTERDIT || b === C_INTERDIT) return S_INTERDIT;
    return S_GOMME;
  }

  function buildPlan() {
    var d = planImg.data, x, y, c, k, p, f, f0, s, s0, x0, a, b, i, j;
    for (c = 0; c < N; c++) {
      k = kind[c];
      cat[c] = k === WALL ? C_MUR : k === CLAY ? (kind0[c] === CLAY ? C_PLATRE : C_AJOUT) : lock[c] ? C_INTERDIT : kind0[c] === CLAY ? C_GOMME : C_AIR;
      rim[c] = k === WALL ? 255 : 0;
    }
    for (p = 1; p <= RIVE; p++) {
      for (y = 0, c = 0; y < NY; y++) {
        for (x = 0; x < NX; x++, c++) {
          if (rim[c] !== 255) continue;
          if ((x > 0 && rim[c - 1] === p - 1) || (x < NX - 1 && rim[c + 1] === p - 1) || (y > 0 && rim[c - NX] === p - 1) || (y < NY - 1 && rim[c + NX] === p - 1)) rim[c] = p;
        }
      }
    }
    for (i = 0; i < 5; i++) geo.runs[i].length = 0;
    for (i = 0; i < 6; i++) { geo.h[i].length = 0; geo.v[i].length = 0; }
    for (y = 0, c = 0, j = 0; y < NY; y++) {
      f0 = -1; x0 = 0;
      for (x = 0; x <= NX; x++) {
        f = -1;
        if (x < NX) {
          k = cat[c];
          f = k === C_MUR ? (rim[c] === 255 ? 0 : 1) : k === C_PLATRE ? 2 : k === C_AJOUT ? 3 : k === C_INTERDIT ? 4 : -1;
          d[j] = PAL[k * 3]; d[j + 1] = PAL[k * 3 + 1]; d[j + 2] = PAL[k * 3 + 2]; d[j + 3] = 255;
          c++; j += 4;
        }
        if (f !== f0) { if (f0 >= 0) geo.runs[f0].push(x0, x, y); f0 = f; x0 = x; }
      }
    }
    for (y = 0; y <= NY; y++) {
      s0 = -1; x0 = 0;
      for (x = 0; x <= NX; x++) {
        s = -1;
        if (x < NX) {
          a = y > 0 ? cat[(y - 1) * NX + x] : C_HORS; b = y < NY ? cat[y * NX + x] : C_HORS;
          s = ES[a * 7 + b];
        }
        if (s !== s0) { if (s0 >= 0) geo.h[s0].push(x0, x, y); s0 = s; x0 = x; }
      }
    }
    for (x = 0; x <= NX; x++) {
      s0 = -1; x0 = 0;
      for (y = 0; y <= NY; y++) {
        s = -1;
        if (y < NY) {
          a = x > 0 ? cat[y * NX + x - 1] : C_HORS; b = x < NX ? cat[y * NX + x] : C_HORS;
          s = ES[a * 7 + b];
        }
        if (s !== s0) { if (s0 >= 0) geo.v[s0].push(x0, y, x); s0 = s; x0 = y; }
      }
    }
    plan.ctx.putImageData(planImg, 0, 0);
    ui.dirty = false; ui.planDirty = true; ui.miniDirty = true;
  }

  // ---------- Plan : tracé ----------
  // Hachures : un carreau répété, redessiné à l'épaisseur voulue pour rester net à tout zoom.
  // sens 0 : montantes, 1 : descendantes, 2 : croisées.
  function hatch(color, p, lw, sens) {
    var key = color + '|' + p + '|' + lw + '|' + sens, l, g, k, pat;
    if (hatches[key]) return hatches[key];
    if (nHatches > 60) { hatches = {}; nHatches = 0; }
    l = layer(p, p); g = l.ctx;
    g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'square';
    g.beginPath();
    for (k = -1; k <= 1; k++) {
      if (sens !== 1) { g.moveTo(k * p - 1, p + 1); g.lineTo(k * p + p + 1, -1); }
      if (sens !== 0) { g.moveTo(k * p - 1, -1); g.lineTo(k * p + p + 1, p + 1); }
    }
    g.stroke();
    pat = ctx.createPattern(l.cv, 'repeat');
    hatches[key] = pat; nHatches++;
    return pat;
  }

  function fillRuns(g, a) {
    var i, x0, y0;
    for (i = 0; i < a.length; i += 3) {
      x0 = X(a[i]); y0 = Y(a[i + 2]);
      g.fillRect(x0, y0, X(a[i + 1]) - x0, Y(a[i + 2] + 1) - y0);
    }
  }
  function hatchRuns(g, a, color, p, lw, sens) {
    var pat = hatch(color, p, lw, sens);
    if (!pat) return;
    if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([1, 0, 0, 1, X(0), Y(0)]));
    g.fillStyle = pat;
    fillRuns(g, a);
  }
  function inkEdges(g, s, t) {
    var h = geo.h[s], v = geo.v[s], o = t >> 1, i, a;
    for (i = 0; i < h.length; i += 3) { a = X(h[i]); g.fillRect(a - o, Y(h[i + 2]) - o, X(h[i + 1]) - a + t, t); }
    for (i = 0; i < v.length; i += 3) { a = Y(v[i]); g.fillRect(X(v[i + 2]) - o, a - o, t, Y(v[i + 1]) - a + t); }
  }
  function dashEdges(g, s) {
    var h = geo.h[s], v = geo.v[s], i;
    g.beginPath();
    for (i = 0; i < h.length; i += 3) { g.moveTo(X(h[i]), Y(h[i + 2]) + 0.5); g.lineTo(X(h[i + 1]), Y(h[i + 2]) + 0.5); }
    for (i = 0; i < v.length; i += 3) { g.moveTo(X(v[i + 2]) + 0.5, Y(v[i])); g.lineTo(X(v[i + 2]) + 0.5, Y(v[i + 1])); }
    g.stroke();
  }

  function renderPlan() {
    var g = walls.ctx, pr = view.pr, z = view.z, p, t, i;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, walls.cv.width, walls.cv.height);
    p = Math.round(clamp(z * 1.5, 6, 13) * pr);
    t = Math.max(2, Math.round(clamp(1.6 + z * 0.06, 2, 3.5) * pr));

    g.fillStyle = '#e9eae3'; fillRuns(g, geo.runs[0]); fillRuns(g, geo.runs[1]);
    hatchRuns(g, geo.runs[1], 'rgba(27,37,48,0.5)', p, Math.max(1, Math.round(pr)), 0);
    g.fillStyle = '#efe5cb'; fillRuns(g, geo.runs[2]);
    hatchRuns(g, geo.runs[2], 'rgba(138,106,58,0.85)', Math.max(4, Math.round(p * 0.75)), Math.max(1, Math.round(pr)), 1);
    g.fillStyle = '#f8ded6'; fillRuns(g, geo.runs[3]);
    hatchRuns(g, geo.runs[3], ROUGE, Math.max(4, Math.round(p * 0.6)), Math.max(1, Math.round(1.4 * pr)), 0);
    hatchRuns(g, geo.runs[4], 'rgba(27,37,48,0.34)', Math.round(p * 1.2), Math.max(1, Math.round(pr)), 2);

    g.lineWidth = Math.max(1, Math.round(pr));
    g.strokeStyle = ROUGE; g.setLineDash([2 * pr, 3 * pr]); dashEdges(g, S_GOMME);
    g.strokeStyle = ENCRE; g.setLineDash([6 * pr, 4 * pr]); dashEdges(g, S_INTERDIT);
    g.setLineDash([]);
    g.fillStyle = SEPIA; inkEdges(g, S_PLATRE, Math.max(1, Math.round(1.3 * pr)));
    g.fillStyle = ROUGE; inkEdges(g, S_AJOUT, t);
    g.fillStyle = ENCRE; inkEdges(g, S_BORD, Math.max(1, Math.round(pr)));
    inkEdges(g, S_MUR, t);

    g.setTransform(pr, 0, 0, pr, 0, 0);
    for (i = 0; i < ports.length; i++) drawPort(g, ports[i]);
    drawRefs(g);
    ui.planDirty = false;
  }

  function setFont(g, px, weight) {
    g.font = (weight || 500) + ' ' + px + 'px ' + POLICE;
    if ('fontStretch' in g) g.fontStretch = 'semi-condensed';
  }

  // Une bouche, dans son repère : u le long de l'ouverture, v vers l'extérieur du plan.
  // Soufflage : cases barrées d'une croix. Reprise : une seule diagonale. Fuite : pointillé et trait brisé.
  function drawPort(g, po) {
    var z = view.z, col = TEINTE[po.role], len = (po.a - po.de + 1) * z, horiz = po.nx !== 0;
    var d = clamp(z * 2.2, 11, 16), h = clamp(z * 1.2, 6, 9), n = Math.max(1, Math.round(len / d)), s = len / n, i, u, c, tx, ty;
    var ox = horiz ? view.tx + (po.cote === 'O' ? 0 : NX * z) : view.tx + po.de * z;
    var oy = horiz ? view.ty + po.de * z : view.ty + (po.cote === 'N' ? 0 : NY * z);
    var out = po.cote === 'O' || po.cote === 'N' ? -1 : 1;
    g.save();
    if (horiz) g.transform(0, 1, out, 0, ox, oy); else g.transform(1, 0, 0, out, ox, oy);
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.4; g.lineJoin = 'miter';
    if (po.role === 'fuite') {
      g.setLineDash([5, 3]); g.strokeRect(0, 0.7, len, d); g.setLineDash([]);
      g.beginPath();
      for (i = 0; i <= n * 2; i++) { u = i * s / 2; if (i) g.lineTo(u, i % 2 ? d * 0.3 : d * 0.7); else g.moveTo(u, d * 0.7); }
      g.stroke();
    } else {
      g.fillStyle = PAPIER; g.fillRect(0, 0.7, len, d); g.fillStyle = col;
      g.strokeRect(0, 0.7, len, d);
      g.lineWidth = 1;
      g.beginPath();
      for (i = 0; i < n; i++) {
        u = i * s;
        if (i) { g.moveTo(u, 0.7); g.lineTo(u, d); }
        g.moveTo(u, d); g.lineTo(u + s, 0.7);
        if (po.role === 'entree') { g.moveTo(u, 0.7); g.lineTo(u + s, d); }
      }
      g.stroke();
    }
    // Flèches : vers l'intérieur pour l'entrée, vers l'extérieur sinon.
    g.beginPath();
    for (i = 0; i < n; i++) {
      u = (i + 0.5) * s;
      if (po.role === 'entree') { g.moveTo(u - h * 0.42, -1.5); g.lineTo(u + h * 0.42, -1.5); g.lineTo(u, -1.5 - h); }
      else { g.moveTo(u - h * 0.42, d + 2.5); g.lineTo(u + h * 0.42, d + 2.5); g.lineTo(u, d + 2.5 + h); }
      g.closePath();
    }
    g.fill();
    // Cote de l'ouverture, en cases.
    c = d + h + 6.5;
    g.strokeStyle = ENCRE; g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(0, c); g.lineTo(len, c);
    g.moveTo(0, c - 4); g.lineTo(0, c + 3); g.moveTo(len, c - 4); g.lineTo(len, c + 3);
    g.moveTo(-2.5, c + 2.5); g.lineTo(2.5, c - 2.5); g.moveTo(len - 2.5, c + 2.5); g.lineTo(len + 2.5, c - 2.5);
    g.stroke();
    g.restore();
    tx = horiz ? ox + out * (c + 7) : ox + len / 2;
    ty = horiz ? oy + len / 2 : oy + out * (c + 7);
    g.save();
    g.translate(tx, ty);
    if (horiz) g.rotate(-Math.PI / 2);
    setFont(g, 11, 500);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ENCRE;
    g.fillText(String(po.a - po.de + 1), 0, 0.5);
    g.restore();
  }

  // Repères de la trame : lettres en tête, chiffres à gauche, qui restent au bord quand on zoome.
  function drawRefs(g) {
    var z = view.z, k, p, x, y, skip, cy = Math.max(view.ty - 34, 11), cx = Math.max(view.tx - 36, 11);
    setFont(g, 10, 600);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 0.9; g.strokeStyle = ENCRE;
    for (k = 0; k < 15; k++) {
      x = k < 10 ? view.tx + (10 + 20 * k) * z : cx;
      y = k < 10 ? cy : view.ty + (10 + 20 * (k - 10)) * z;
      skip = false;
      for (p = 0; p < ports.length; p++) {
        if (k < 10 && ports[p].cote === 'N' && 10 + 20 * k >= ports[p].de - 3 && 10 + 20 * k <= ports[p].a + 4) skip = true;
        if (k >= 10 && ports[p].cote === 'O' && 10 + 20 * (k - 10) >= ports[p].de - 3 && 10 + 20 * (k - 10) <= ports[p].a + 4) skip = true;
      }
      if (skip && view.fit) continue;
      if ((k < 10 && x < cx + 18) || (k >= 10 && y < cy + 18)) continue;
      g.fillStyle = PAPIER;
      g.beginPath(); g.arc(x, y, 7.5, 0, 6.2832); g.fill(); g.stroke();
      g.fillStyle = ENCRE;
      g.fillText(k < 10 ? 'ABCDEFGHIJ'.charAt(k) : String(k - 9), x, y + 0.5);
    }
  }

  // Étiquettes des bouches : le débit de chacune, relu à chaque image.
  function drawTags() {
    var z = view.z, p, po, text, w, x, y, mid;
    setFont(ctx, 12, 600);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineWidth = 1;
    for (p = 0; p < ports.length; p++) {
      po = ports[p];
      text = (ROLES[po.role] + (po.nom ? ' ' + po.nom : '')).toUpperCase() + '  ' + fmt(PQS[p] * UNIT);
      w = Math.ceil(ctx.measureText(text).width) + 10;
      mid = (po.de + po.a + 1) / 2 * z;
      if (po.cote === 'O') { x = view.tx + 7; y = view.ty + mid - 9; }
      else if (po.cote === 'E') { x = view.tx + NX * z - 7 - w; y = view.ty + mid - 9; }
      else if (po.cote === 'N') { x = view.tx + mid - w / 2; y = view.ty + 7; }
      else { x = view.tx + mid - w / 2; y = view.ty + NY * z - 25; }
      x = Math.round(x) + 0.5; y = Math.round(y) + 0.5;
      if (x > view.w || y > view.h || x + w < 0 || y + 18 < 0) continue;
      ctx.fillStyle = PAPIER; ctx.fillRect(x, y, w, 18);
      ctx.strokeStyle = TEINTE[po.role]; ctx.strokeRect(x, y, w, 18);
      ctx.fillStyle = TEINTE[po.role]; ctx.fillText(text, x + 5, y + 9.5);
    }
  }

  // ---------- Affichage ----------
  function paintField() {
    var d = fieldImg.data, lut = LUT[ui.view], view2 = ui.view, x, y, c, j, v;
    for (y = 0, c = 0, j = 0; y < NY; y++) {
      for (x = 0; x < NX; x++, c++, j += 4) {
        if (view2 === 'tourbillon') {
          v = 128;
          if (!solid[c] && x > 0 && y > 0 && x < NX - 1 && y < NY - 1) v += (UY[c + 1] - UY[c - 1] - UX[c + NX] + UX[c - NX]) * 2400;
        } else if (solid[c]) v = 0;
        else if (view2 === 'vitesse') v = Math.sqrt(UX[c] * UX[c] + UY[c] * UY[c]) * 1700;
        else v = ((RHO[c] - RHO_OUT) / (RHO_IN - RHO_OUT) * 0.75 + 0.2) * 255;
        v = v > 255 ? 255 : v > 0 ? v | 0 : 0;
        d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2]; d[j + 3] = 255;
      }
    }
    field.ctx.putImageData(fieldImg, 0, 0);
  }

  // Trame tous les dix cases, puis quadrillage des cases quand elles sont assez grosses pour être visées.
  function drawGrid(x0, x1, y0, y1) {
    var z = view.z, i, a = X(x0), b = Y(y0), w = X(x1) - a, h = Y(y1) - b;
    if (z >= 9) {
      ctx.fillStyle = 'rgba(27,37,48,' + Math.min(0.17, (z - 7) * 0.022).toFixed(3) + ')';
      for (i = x0; i <= x1; i++) if (i % 10) ctx.fillRect(X(i), b, 1, h);
      for (i = y0; i <= y1; i++) if (i % 10) ctx.fillRect(a, Y(i), w, 1);
    }
    ctx.fillStyle = z >= 9 ? 'rgba(29,79,140,0.3)' : 'rgba(29,79,140,0.13)';
    for (i = Math.ceil(x0 / 10) * 10; i <= x1; i += 10) ctx.fillRect(X(i), b, 1, h);
    for (i = Math.ceil(y0 / 10) * 10; i <= y1; i += 10) ctx.fillRect(a, Y(i), w, 1);
  }

  function draw() {
    var z = view.z, x0, x1, y0, y1, a, b, w, h;
    aim();
    paintField();
    if (ui.dirty) buildPlan();
    if (ui.planDirty) renderPlan();
    x0 = Math.max(0, Math.floor(-view.tx / z) - 1); x1 = Math.min(NX, Math.ceil((view.w - view.tx) / z) + 1);
    y0 = Math.max(0, Math.floor(-view.ty / z) - 1); y1 = Math.min(NY, Math.ceil((view.h - view.ty) / z) + 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPIER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(field.cv, x0, y0, x1 - x0, y1 - y0, X(x0), Y(y0), X(x1) - X(x0), Y(y1) - Y(y0));
    drawGrid(x0, x1, y0, y1);
    a = Math.max(0, X(0)); b = Math.max(0, Y(0)); w = Math.min(canvas.width, X(NX)) - a; h = Math.min(canvas.height, Y(NY)) - b;
    if (w > 0 && h > 0) ctx.drawImage(trail.cv, a, b, w, h, a, b, w, h);
    ctx.drawImage(walls.cv, 0, 0);
    drawFootprint();
    ctx.setTransform(view.pr, 0, 0, view.pr, 0, 0);
    drawTags();
    if (ui.miniDirty && !view.fit) drawMini();
    ui.redraw = false;
  }

  function drawMini() {
    var w = mini.width, h = mini.height, k = w / NX;
    var x = -view.tx / view.z * k, y = -view.ty / view.z * k, vw = view.w / view.z * k, vh = view.h / view.z * k;
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(plan.cv, 0, 0, w, h);
    mctx.fillStyle = 'rgba(207,58,31,0.14)'; mctx.fillRect(x, y, vw, vh);
    mctx.strokeStyle = ROUGE; mctx.lineWidth = 2; mctx.strokeRect(x + 1, y + 1, vw - 2, vh - 2);
    ui.miniDirty = false;
  }

  // ---------- Visée ----------
  function aim() {
    if (!ui.over && !ui.down) { ui.hx = -1; ui.hy = -1; return; }
    ui.hx = (ui.sx - view.tx) / view.z; ui.hy = (ui.sy - view.ty) / view.z;
  }

  // Ce que ferait le pinceau, sans rien modifier : mêmes cases et même ordre que dab et stroke,
  // mêmes refus que setCell. État par case : 0 inchangée, 1 modifiée, 2 hors budget, 3 zone interdite, 4 béton.
  // Une case déjà vue garde son premier verdict, comme dans un vrai tracé.
  function tryInto(c, k) {
    var was = kind[c], s = 1;
    if (seen[c] === pv.gen) return;
    seen[c] = pv.gen;
    if (was === k) s = 0;
    else if (was === WALL) s = 4;
    else if (lock[c]) s = 3;
    else if (k === CLAY) {
      if (kind0[c] === CLAY) pv.removed--;
      else if (pv.added >= sim.paint) s = 2;
      else pv.added++;
    } else if (kind0[c] !== CLAY) pv.added--;
    else if (pv.removed >= sim.erase) s = 2;
    else pv.removed++;
    if (s === 1) pv.ok++; else if (s === 2) pv.budget++; else if (s === 3) pv.lock++;
    pvC[pv.n] = c; pvS[pv.n] = s; pv.n++;
  }
  function stamp(px, py, d, k) {
    var r = d / 2, x, y, dx, dy;
    var x0 = Math.max(1, Math.floor(px - r)), x1 = Math.min(NX - 2, Math.ceil(px + r));
    var y0 = Math.max(1, Math.floor(py - r)), y1 = Math.min(NY - 2, Math.ceil(py + r));
    x = Math.floor(px); y = Math.floor(py);
    if (x >= 1 && y >= 1 && x <= NX - 2 && y <= NY - 2) tryInto(y * NX + x, k);
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        dx = x + 0.5 - px; dy = y + 0.5 - py;
        if (dx * dx + dy * dy <= r * r) tryInto(y * NX + x, k);
      }
    }
  }
  function footprint(ax, ay, bx, by, d, k) {
    var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), m = Math.max(1, Math.ceil(len * 2)), i;
    pv.gen++; pv.n = 0; pv.ok = 0; pv.budget = 0; pv.lock = 0; pv.added = sim.added; pv.removed = sim.removed;
    stamp(ax, ay, d, k);
    if (len > 0) for (i = 1; i <= m; i++) stamp(ax + (bx - ax) * i / m, ay + (by - ay) * i / m, d, k);
  }

  function drawFootprint() {
    var z = view.z * view.pr, k = ui.down ? ui.k : ui.tool, i, c, s, x, y, w, h, fine = view.z >= 8, text = '';
    if (ui.hx >= 0 && !ui.pan && !pinch) {
      if (ui.line) footprint(ui.ax, ui.ay, ui.hx, ui.hy, ui.size, k); else footprint(ui.hx, ui.hy, ui.hx, ui.hy, ui.size, k);
      for (i = 0; i < pv.n; i++) {
        c = pvC[i]; s = pvS[i];
        x = X(c % NX); y = Y((c / NX) | 0); w = X(c % NX + 1) - x; h = Y(((c / NX) | 0) + 1) - y;
        if (s === 1) {
          ctx.fillStyle = k === CLAY ? 'rgba(207,58,31,0.62)' : 'rgba(255,255,255,0.78)';
          ctx.fillRect(x, y, w, h);
          if (k !== CLAY) { ctx.fillStyle = ROUGE; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h); }
        } else if (s === 2 || s === 3) {
          ctx.fillStyle = 'rgba(27,37,48,0.3)';
          ctx.fillRect(x, y, w, h);
          if (fine) {
            ctx.strokeStyle = ENCRE; ctx.lineWidth = Math.max(1, view.pr * 1.2);
            ctx.beginPath(); ctx.moveTo(x + w * 0.25, y + h * 0.25); ctx.lineTo(x + w * 0.75, y + h * 0.75);
            ctx.moveTo(x + w * 0.75, y + h * 0.25); ctx.lineTo(x + w * 0.25, y + h * 0.75); ctx.stroke();
          }
        } else if (fine) {
          ctx.fillStyle = 'rgba(27,37,48,0.4)';
          ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
        }
      }
      if (!fine) {
        ctx.strokeStyle = k === CLAY ? ROUGE : ENCRE; ctx.lineWidth = Math.max(1, view.pr * 1.2);
        ctx.beginPath();
        ctx.arc((view.tx + ui.hx * view.z) * view.pr, (view.ty + ui.hy * view.z) * view.pr, Math.max(ui.size / 2, 0.6) * z, 0, 6.2832);
        ctx.stroke();
      }
      x = Math.floor(ui.hx); y = Math.floor(ui.hy);
      if (x >= 0 && y >= 0 && x < NX && y < NY) {
        text = (ui.line ? 'Trait droit jusqu\'à la case ' : 'Case ') + x + ' ; ' + y + ', repère ' + 'ABCDEFGHIJ'.charAt((x / 20) | 0) + (((y / 20) | 0) + 1) + '. ' +
          pv.ok + (k === CLAY ? ' à poser' : ' à gommer') +
          (pv.budget ? ', ' + pv.budget + ' hors budget' : '') + (pv.lock ? ', ' + pv.lock + ' en zone interdite' : '');
      }
    }
    if (!text) text = view.fit ? 'Molette pour zoomer sur le plan' : 'Espace ou clic milieu, puis glisser, pour déplacer la vue';
    if (text !== ui.coord) { ui.coord = text; $('#coord').textContent = text; }
  }

  // ---------- Cartouche et instruments ----------
  function polar(r, deg) {
    var a = (deg - 90) * Math.PI / 180;
    return (80 + r * Math.cos(a)).toFixed(1) + ' ' + (78 + r * Math.sin(a)).toFixed(1);
  }
  function dialMax() { return level.etoiles ? level.etoiles[2] * 1.2 : 100; }
  function dialAngle(v) { return -120 + 240 * clamp(v / dialMax(), 0, 1.03); }

  // Débitmètre : cadran gradué de 0 à 120 % du seuil des trois étoiles, seuils repérés en rouge.
  function renderDial() {
    var max = dialMax(), steps = [1, 2, 5, 10, 20, 25, 50], step = 50, s, i, k, v, a, e = level.etoiles;
    for (i = steps.length - 1; i >= 0; i--) if (max / steps[i] <= 6.5) step = steps[i];
    s = '<svg viewBox="0 0 160 124" role="img" aria-label="Débitmètre"><path class="arc" d="M' + polar(54, -120) + ' A54 54 0 1 1 ' + polar(54, 120) + '"/>';
    if (e) s += '<path class="zone" d="M' + polar(58.5, dialAngle(e[0])) + ' A58.5 58.5 0 ' + (dialAngle(max) - dialAngle(e[0]) > 180 ? 1 : 0) + ' 1 ' + polar(58.5, 120) + '"/>';
    for (i = 0; i * step / 5 <= max + 1e-6; i++) {
      v = i * step / 5; a = dialAngle(v);
      s += '<path class="' + (i % 5 ? 'trait' : 'trait gros') + '" d="M' + polar(54, a) + ' L' + polar(i % 5 ? 49.5 : 46, a) + '"/>';
      if (i % 5 === 0) s += '<text class="chiffre" x="' + polar(37, a).replace(' ', '" y="') + '" dy="3">' + v + '</text>';
    }
    if (e) {
      for (i = 0; i < 3; i++) {
        a = dialAngle(e[i]);
        s += '<path class="seuil" d="M' + polar(45, a) + ' L' + polar(61, a) + '"/>';
        for (k = 0; k <= i; k++) s += '<circle class="pion" r="1.5" cx="' + polar(64.5 + k * 4.2, a).replace(' ', '" cy="') + '"/>';
      }
    }
    s += '<g id="aiguille"><path d="M80 86 L78.6 78 L80 30 L81.4 78 Z"/><circle cx="80" cy="78" r="4.2"/></g>' +
      '<text class="mesure" id="debit" x="80" y="118">0,0</text></svg>';
    $('#cadran').innerHTML = s;
  }

  function renderLegend() {
    var st = RAMPS[ui.view], gr = GRADS[ui.view], i, css = [], html = '';
    for (i = 0; i < st.length; i += 4) css.push('rgb(' + st[i + 1] + ',' + st[i + 2] + ',' + st[i + 3] + ') ' + (st[i] * 100) + '%');
    $('#teinte').style.background = 'linear-gradient(90deg,' + css.join(',') + ')';
    for (i = 0; i < gr.length; i += 2) {
      html += '<span style="left:' + (gr[i] * 100).toFixed(1) + '%"' + (gr[i] > 0.9 ? ' class="fin"' : gr[i] < 0.05 ? ' class="debut"' : '') + '>' + gr[i + 1] + '</span>';
    }
    $('#grads').innerHTML = html;
    $('#unite').textContent = UNITES[ui.view];
    ui.legend = ui.view;
  }

  function renderBrief() {
    var def = level, html = '', p, po, d = new Date();
    $('#num').textContent = ui.n < 0 ? 'Libre' : two(ui.n + 1) + ' / ' + LEVELS.length;
    $('#nom').textContent = ui.n < 0 ? 'Feuille de brouillon' : def.nom;
    $('#idee').textContent = def.idee;
    $('#texte').textContent = nbsp(TEXTES[def.id] || def.texte);
    $('#date').textContent = two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear();
    for (p = 0; p < ports.length; p++) {
      po = ports[p];
      html += '<li class="b-' + po.role + '"><span>' + ROLES[po.role] + (po.nom ? ' ' + po.nom : '') + '</span><b id="q' + p + '">0,0</b></li>';
    }
    $('#bouches').innerHTML = html;
    $('#verdict').hidden = !def.etoiles;
    $('#libre').hidden = !!def.etoiles;
    if (def.etoiles) {
      $('#seuils').innerHTML = '<span>★ <b>' + fmt(def.etoiles[0]) + '</b></span><span>★★ <b>' + fmt(def.etoiles[1]) + '</b></span><span>★★★ <b>' + fmt(def.etoiles[2]) + '</b></span>';
    }
    $('#regle').textContent = def.score === 'min' ? 'Débit utile = 2 × la plus faible sortie' + (hasLeak() ? ' − fuite' : '')
      : hasLeak() ? 'Débit utile = sortie − fuite' : 'Débit utile = débit de sortie';
    renderDial();
    renderLegend();
  }
  function hasLeak() {
    for (var p = 0; p < ports.length; p++) if (ports[p].role === 'fuite') return true;
    return false;
  }

  function budget(el, used, max, word) {
    el.hidden = max === 0 && used === 0;
    el.querySelector('b').textContent = max >= 1e9 ? 'à volonté' : (max - used) + ' / ' + max;
    el.querySelector('i').style.width = max >= 1e9 ? '100%' : max ? ((max - used) / max * 100) + '%' : '0%';
    el.classList.toggle('vide', max < 1e9 && used >= max);
    el.querySelector('span').textContent = word;
  }

  function indice(n) {
    return n < 26 ? String.fromCharCode(65 + n) : String.fromCharCode(64 + ((n / 26) | 0)) + String.fromCharCode(65 + n % 26);
  }

  function hud() {
    var v = score(), s = judge(), def = level, p, n, b, el;
    $('#debit').textContent = fmt(v);
    $('#aiguille').style.transform = 'rotate(' + dialAngle(v).toFixed(1) + 'deg)';
    for (p = 0; p < ports.length; p++) { el = $('#q' + p); if (el) el.textContent = fmt(PQS[p] * UNIT); }
    budget($('#bPinceau'), sim.added, sim.paint, 'À poser');
    budget($('#bGomme'), sim.removed, sim.erase, 'À gommer');
    $('#etat').textContent = ui.paused ? 'Soufflerie arrêtée' : s === null ? 'Mesure en cours…' : 'Mesure stable';
    $('#etat').className = s === null || ui.paused ? 'etat' : 'etat ok';
    $('#echelle').textContent = '1:' + Math.max(1, Math.round(CM * 10 / (view.z * 0.2646)));
    $('#indice').textContent = indice(ui.undo.length);
    $('[data-act="ensemble"]').disabled = view.fit;
    $('[data-act="dezoom"]').disabled = view.fit;
    $('[data-act="zoom"]').disabled = view.zt >= ZMAX;
    $('#etoiles').hidden = !def.etoiles;
    if (def.etoiles) {
      $('#etoiles').textContent = starText(starsFor(s === null ? v : s));
      $('#etoiles').className = s === null ? 'etoiles attente' : 'etoiles';
      b = save.best[def.id];
      $('#record').textContent = b ? 'Record ' + fmt(b.d) + '  ' + starText(b.e) : 'Pas encore de record';
      $('#suivant').hidden = !(b && b.e > 0 && ui.n + 1 < LEVELS.length);
      $('#tampon').hidden = !ui.done;
      $('#tamponTitre').textContent = ui.done === 3 ? 'Bon pour exécution' : 'Validé';
      $('#tamponEtoiles').textContent = starText(ui.done);
      $('#bravo').textContent = ui.done === 3 ? 'Gaine optimisée.' : 'Tu peux encore gratter du débit.';
    } else { $('#suivant').hidden = true; $('#tampon').hidden = true; }
    toggle('[data-act="pinceau"]', ui.tool === CLAY);
    toggle('[data-act="gomme"]', ui.tool === FLUID);
    toggle('[data-act="pause"]', ui.paused);
    $('[data-act="pause"]').textContent = ui.paused ? 'Relancer' : 'Arrêter';
    $('[data-act="annuler"]').disabled = !ui.undo.length;
    $('[data-act="retablir"]').disabled = !ui.redo.length;
    if (ui.legend !== ui.view) renderLegend();
    each('[data-vue]', function (el2) { el2.setAttribute('aria-pressed', el2.getAttribute('data-vue') === ui.view); });
    each('[data-vit]', function (el2) { el2.setAttribute('aria-pressed', +el2.getAttribute('data-vit') === ui.speed); });
    each('[data-taille]', function (el2) { el2.setAttribute('aria-pressed', +el2.getAttribute('data-taille') === ui.size); });
  }
  function toggle(sel, on) { $(sel).setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  // Trace-cercles : un trou par taille de tracé.
  function renderTemplate() {
    var html = '', n, d;
    for (n = 1; n <= 12; n++) {
      d = (5 + n * 1.55).toFixed(1);
      html += '<button type="button" data-taille="' + n + '" title="Taille ' + n + '" aria-label="Taille ' + n + '"><i style="width:' + d + 'px;height:' + d + 'px"></i></button>';
    }
    $('#gabarit').innerHTML = html + '<span>Taille du tracé, <kbd>+</kbd> <kbd>−</kbd></span>';
  }

  // ---------- Meuble à plans ----------
  // Une vignette par planche, relevée une fois au démarrage sur le plan d'origine.
  function snapshot() {
    var t, p, j, d, po;
    buildPlan();
    t = cat.slice();
    for (p = 0; p < ports.length; p++) {
      po = ports[p];
      for (j = 0; j < po.cells.length; j++) for (d = 0; d < 3; d++) t[po.cells[j] + po.off * d] = po.role === 'entree' ? 7 : po.role === 'sortie' ? 8 : 9;
    }
    return t;
  }
  function paintThumb(cv, t) {
    var g = cv.getContext('2d'), img = g.createImageData(NX, NY), d = img.data, c, j;
    for (c = 0, j = 0; c < N; c++, j += 4) { d[j] = PAL[t[c] * 3]; d[j + 1] = PAL[t[c] * 3 + 1]; d[j + 2] = PAL[t[c] * 3 + 2]; d[j + 3] = 255; }
    g.putImageData(img, 0, 0);
  }

  function renderLevels() {
    var html = '', i, b, ok;
    for (i = 0; i < LEVELS.length; i++) {
      b = bestOf(i); ok = unlocked(i);
      html += '<button type="button" class="tiroir' + (i === ui.n ? ' ici' : '') + '" data-act="niveau" data-n="' + i + '"' + (ok ? '' : ' disabled') + '>' +
        (ok ? '<canvas class="vignette" data-th="' + i + '" width="' + NX + '" height="' + NY + '"></canvas>' : '<span class="vignette clos">Sous clé</span>') +
        '<span class="etiquette"><span class="no">' + two(i + 1) + '</span><b>' + LEVELS[i].nom + '</b>' +
        '<span class="sous">' + (ok ? LEVELS[i].idee : 'Valide d\'abord la planche ' + two(i)) + '</span></span>' +
        '<span class="visa"><span class="et">' + starText(b ? b.e : 0) + '</span><span>' + (b ? 'record ' + fmt(b.d) : i === ui.n ? 'sur la table' : '') + '</span></span></button>';
    }
    html += '<button type="button" class="tiroir large' + (ui.n < 0 ? ' ici' : '') + '" data-act="niveau" data-n="-1">' +
      '<canvas class="vignette" data-th="' + LEVELS.length + '" width="' + NX + '" height="' + NY + '"></canvas>' +
      '<span class="etiquette"><span class="no">∞</span><b>Brouillon</b><span class="sous">Une feuille libre, sans objectif ni budget</span></span>' +
      '<span class="visa"><span>' + (ui.n < 0 ? 'sur la table' : '') + '</span></span></button>';
    $('#tiroirs').innerHTML = html;
    each('#tiroirs canvas', function (cv) { paintThumb(cv, thumbs[+cv.getAttribute('data-th')]); });
    $('#niveaux').hidden = false;
    $('#aide').hidden = true;
  }

  // ---------- Commandes : tracé, zoom, déplacement ----------
  function locate(e) {
    var r = canvas.getBoundingClientRect();
    ui.sx = (e.clientX - r.left) * (r.width ? view.w / r.width : 1);
    ui.sy = (e.clientY - r.top) * (r.height ? view.h / r.height : 1);
    ui.over = true;
    aim();
    ui.redraw = true;
  }
  function capture(e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
  }
  function cursor() { canvas.style.cursor = ui.pan ? 'grabbing' : ui.space ? 'grab' : 'crosshair'; }

  // Un deuxième doigt transforme le geste en zoom : le trait entamé par le premier est repris.
  function cancelStroke() {
    if (!ui.down) return;
    if (ui.line) ui.line = false;
    else if (ui.changed) { restore(ui.undo.pop()); ui.dirty = true; }
    else ui.undo.pop();
    ui.down = false;
  }
  function pinchState() {
    var k, a = null, b = null;
    for (k in pts) { if (!a) a = pts[k]; else if (!b) b = pts[k]; }
    if (!a || !b) return null;
    return { d: Math.max(8, Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  canvas.addEventListener('pointerdown', function (e) {
    var n, s, el = document.activeElement;
    if (el && el !== document.body && el.blur) el.blur();
    locate(e);
    if (e.pointerType === 'touch') {
      if (!pts[e.pointerId]) npts++;
      pts[e.pointerId] = { x: ui.sx, y: ui.sy };
      if (npts >= 2) {
        e.preventDefault();
        cancelStroke();
        s = pinchState();
        if (s) pinch = { d: s.d, z: view.z, wx: (s.x - view.tx) / view.z, wy: (s.y - view.ty) / view.z };
        ui.over = false;
        return;
      }
    }
    if (e.button === 1 || (e.button === 0 && ui.space)) {
      e.preventDefault(); capture(e);
      ui.pan = { sx: ui.sx, sy: ui.sy, tx: view.tx, ty: view.ty };
      ui.spaceUsed = true; view.zt = view.z;
      cursor();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault(); capture(e);
    ui.k = e.button === 2 ? FLUID : ui.tool;
    ui.down = true; ui.ax = ui.hx; ui.ay = ui.hy; ui.changed = 0;
    // Avec Maj, rien n'est posé avant le relâchement : le trait droit se règle d'abord à l'aperçu.
    ui.line = !!e.shiftKey;
    if (ui.line) return;
    pushUndo();
    n = dab(ui.hx, ui.hy, ui.size, ui.k);
    ui.lx = ui.hx; ui.ly = ui.hy;
    ui.changed = n;
    if (n) { ui.dirty = true; ui.done = 0; }
  });
  canvas.addEventListener('pointermove', function (e) {
    var n, s, z;
    locate(e);
    if (e.pointerType === 'touch' && pts[e.pointerId]) {
      pts[e.pointerId].x = ui.sx; pts[e.pointerId].y = ui.sy;
      if (pinch) {
        s = pinchState();
        if (s) { z = clamp(pinch.z * s.d / pinch.d, view.zfit, ZMAX); setView(z, s.x - pinch.wx * z, s.y - pinch.wy * z); }
        ui.over = false;
        return;
      }
    }
    if (ui.pan) { setView(view.z, ui.pan.tx + ui.sx - ui.pan.sx, ui.pan.ty + ui.sy - ui.pan.sy); return; }
    if (!ui.down || ui.line) return;
    n = stroke(ui.lx, ui.ly, ui.hx, ui.hy, ui.size, ui.k);
    ui.lx = ui.hx; ui.ly = ui.hy;
    if (n) { ui.changed += n; ui.dirty = true; ui.done = 0; }
  });
  function release(e) {
    if (e.type === 'pointerup') locate(e);
    if (e.pointerType === 'touch') {
      if (pts[e.pointerId]) { delete pts[e.pointerId]; npts--; }
      if (npts < 2) pinch = null;
      ui.over = false;
    }
    if (ui.pan) { ui.pan = null; cursor(); }
    if (ui.down && ui.line && e.type === 'pointerup') {
      pushUndo();
      ui.changed = dab(ui.ax, ui.ay, ui.size, ui.k) + stroke(ui.ax, ui.ay, ui.hx, ui.hy, ui.size, ui.k);
      if (ui.changed) { ui.dirty = true; ui.done = 0; }
    }
    if (ui.down && !ui.changed && (!ui.line || e.type === 'pointerup')) ui.undo.pop();
    ui.down = false; ui.line = false; ui.redraw = true;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', function () { if (!ui.down) { ui.over = false; ui.redraw = true; } });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener('auxclick', function (e) { e.preventDefault(); });

  // La molette zoome sur la case visée et ne fait jamais défiler la page.
  function onWheel(e) {
    var r = canvas.getBoundingClientRect(), d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1);
    var sx = (e.clientX - r.left) * (r.width ? view.w / r.width : 1), sy = (e.clientY - r.top) * (r.height ? view.h / r.height : 1);
    e.preventDefault();
    if (e.target !== canvas) { sx = view.w / 2; sy = view.h / 2; }
    zoomBy(Math.exp(-clamp(d, -600, 600) * (e.ctrlKey ? 0.01 : 0.0022)), sx, sy);
  }
  canvas.addEventListener('wheel', onWheel, { passive: false });
  mini.addEventListener('wheel', onWheel, { passive: false });

  // Mini-carte : cliquer ou glisser y centre la vue.
  function miniGo(e) {
    var r = mini.getBoundingClientRect();
    if (!r.width) return;
    setView(view.z, view.w / 2 - (e.clientX - r.left) / r.width * NX * view.z, view.h / 2 - (e.clientY - r.top) / r.height * NY * view.z);
  }
  mini.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { mini.setPointerCapture(e.pointerId); } catch (err) { /* idem */ }
    ui.mini = true; miniGo(e);
  });
  mini.addEventListener('pointermove', function (e) { if (ui.mini) miniGo(e); });
  mini.addEventListener('pointerup', function () { ui.mini = false; });
  mini.addEventListener('pointercancel', function () { ui.mini = false; });

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act],[data-vue],[data-vit],[data-taille]') : null, act;
    if (!el) return;
    if (el.hasAttribute('data-vue')) ui.view = el.getAttribute('data-vue');
    else if (el.hasAttribute('data-vit')) ui.speed = +el.getAttribute('data-vit');
    else if (el.hasAttribute('data-taille')) ui.size = +el.getAttribute('data-taille');
    act = el.getAttribute('data-act');
    if (act === 'pinceau') ui.tool = CLAY;
    else if (act === 'gomme') ui.tool = FLUID;
    else if (act === 'annuler') undo();
    else if (act === 'retablir') redo();
    else if (act === 'zero') resetLevel();
    else if (act === 'pause') ui.paused = !ui.paused;
    else if (act === 'pas') { ui.paused = true; tick(8); }
    else if (act === 'zoom') zoomBy(1.6, view.w / 2, view.h / 2);
    else if (act === 'dezoom') zoomBy(1 / 1.6, view.w / 2, view.h / 2);
    else if (act === 'ensemble') fitView(false);
    else if (act === 'niveaux') renderLevels();
    else if (act === 'aide') { $('#aide').hidden = false; $('#niveaux').hidden = true; }
    else if (act === 'fermer') { $('#aide').hidden = true; $('#niveaux').hidden = true; }
    else if (act === 'niveau') openLevel(+el.getAttribute('data-n'));
    else if (act === 'suivant' && unlocked(ui.n + 1)) openLevel(ui.n + 1);
    else if (act === 'bac') openLevel(-1);
    ui.redraw = true;
    hud();
  });

  // Espace seule arrête ou relance la soufflerie au relâchement ; maintenue pendant un glisser, elle déplace la vue.
  function keyboardFocus(el) {
    try { return el && el.tagName === 'BUTTON' && el.matches(':focus-visible'); } catch (e) { return false; }
  }
  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase(), pas = view.w * 0.16;
    if (e.target && e.target.tagName === 'INPUT') return;
    if (k === ' ' && keyboardFocus(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && k === 'z') { if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') redo();
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === 'b' || k === 'p') ui.tool = CLAY;
    else if (k === 'g' || k === 'e') ui.tool = FLUID;
    else if (k === ' ') { if (!e.repeat) { ui.space = true; ui.spaceUsed = false; cursor(); } }
    else if (k === 'n') { ui.paused = true; tick(8); }
    else if (k === '1' || k === '&') ui.view = 'vitesse';
    else if (k === '2' || k === 'é') ui.view = 'pression';
    else if (k === '3' || k === '"') ui.view = 'tourbillon';
    else if (k === '0' || k === 'à' || k === 'home') fitView(false);
    else if (k === '+' || k === '=') ui.size = Math.min(12, ui.size + 1);
    else if (k === '-') ui.size = Math.max(1, ui.size - 1);
    else if (k === 'arrowleft') setView(view.z, view.tx + pas, view.ty);
    else if (k === 'arrowright') setView(view.z, view.tx - pas, view.ty);
    else if (k === 'arrowup') setView(view.z, view.tx, view.ty + pas);
    else if (k === 'arrowdown') setView(view.z, view.tx, view.ty - pas);
    else if (k === 'escape') { $('#aide').hidden = true; $('#niveaux').hidden = true; if (ui.line) { ui.line = false; ui.down = false; } }
    else return;
    e.preventDefault();
    ui.redraw = true;
    hud();
  });
  document.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (k !== ' ' || !ui.space) return;
    e.preventDefault();
    ui.space = false;
    if (!ui.spaceUsed && !ui.pan) { ui.paused = !ui.paused; hud(); }
    cursor();
  });
  window.addEventListener('blur', function () { ui.space = false; });
  window.addEventListener('resize', resize);

  // ---------- Démarrage ----------
  (function () {
    var a, b, n = 0;
    for (a = 0; a < 7; a++) for (b = 0; b < 7; b++) ES[a * 7 + b] = edgeStyle(a, b);
    try { doux = !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { doux = true; }
    loadSave();
    renderTemplate();
    resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas.parentNode);
    for (a = 0; a <= LEVELS.length; a++) { loadLevel(a < LEVELS.length ? LEVELS[a] : SANDBOX); thumbs.push(snapshot()); }
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
    fields: function () { return { rho: RHO, ux: UX, uy: UY, kind: kind, kind0: kind0, lock: lock, f: F }; },
    view: function () { return { z: view.z, zt: view.zt, tx: view.tx, ty: view.ty, w: view.w, h: view.h, pr: view.pr, zfit: view.zfit, fit: view.fit }; },
    setView: setView, fit: fitView, redraw: function () { ui.redraw = true; },
    preview: function (x, y) { footprint(x, y, x, y, ui.size, ui.tool); return { ok: pv.ok, budget: pv.budget, lock: pv.lock, n: pv.n }; }
  };
})();
