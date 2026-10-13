/*
 * lecteur.js : le moteur de « Particules » et son lecteur autonome.
 * Un seul fichier, sans dépendance. L'outil s'en sert pour calculer chaque image ;
 * un jeu le charge pour jouer les mêmes effets en temps réel, au pixel près.
 *
 * Dans un jeu :
 *
 *   <script src="../particules/lecteur.js"></script>
 *   <script src="feu.js"></script>          (export « Fichier pour le lecteur » de l'outil)
 *
 *   // 1. Une boucle toute faite, jouée dans un canvas (agrandi d'un nombre entier de fois) :
 *   Particules.jouer('feu', document.querySelector('#torche'), { echelle: 3 });
 *
 *   // 2. Les images d'une boucle, à dessiner soi-même dans la boucle du jeu :
 *   var feu = Particules.animation('feu');
 *   ctx.imageSmoothingEnabled = false;
 *   ctx.drawImage(feu.imageA(temps), x, y, feu.w * 3, feu.h * 3);     // temps en secondes
 *
 *   // 3. Un émetteur vivant, qui suit un objet et laisse sa traînée derrière lui :
 *   var s = Particules.simulation('etincelles', { x: 120, y: 80 });
 *   // à chaque image du jeu :
 *   s.deplacer(joueur.x, joueur.y); s.avancer(dt); s.dessiner(ctx, 3);
 *   s.salve();       // tire la salve de l'effet (une explosion, un impact)
 *   s.couper();      // arrête d'émettre ; s.fini() devient vrai quand tout est retombé
 *
 * Le fichier feu.js exporté par l'outil contient un appel
 *   Particules.ajouter('feu', { format: 'particules', version: 1, ... });
 * On peut aussi passer directement l'objet JSON d'un effet partout où un nom est attendu.
 * (Un jeu ouvert en file:// ne peut pas lire un .json avec fetch : le fichier .js, lui, se charge toujours.)
 *
 * Le rendu est déterministe : pour une graine donnée, chaque image est la même à chaque fois
 * (au pixel près dans un même navigateur ; d'un moteur JavaScript à l'autre, un pixel peut changer à la marge).
 * Le sol d'un émetteur vivant suit l'émetteur : il reste à la même distance sous lui quand il bouge.
 * Sans navigateur (Node, tests) : Particules.images(effet) rend un tableau d'Uint32Array (pixels 0xAABBGGRR).
 */
(function (racine) {
  'use strict';

  var FORMAT = 'particules', VERSION = 1;
  var COTE_MIN = 8, COTE_MAX = 256;        // côtés du sprite, en pixels
  var IMAGES_MAX = 120, CADENCE_MAX = 60;
  var COUCHES_MAX = 8, RAMPE_MAX = 8;
  var PARTICULES_MAX = 4000;               // naissances par couche et par boucle, salve comprise
  var SOUS_PAS = 4;                        // pas d'intégration par image
  var ETATS_MAX = 2 * 20 * 60 + 2;         // échantillons d'une vie : 20 s, variation de 100 %, à 60 i/s
  var BUDGET = 1500000;                    // échantillons gardés par couche : au-delà, le débit de la boucle est réduit
  var FORMES = ['carre', 'rond', 'anneau', 'plus', 'trait'];
  var EMETTEURS = ['point', 'ligne', 'cercle', 'rect'];
  var IMPACTS = ['traverse', 'rebond', 'arret', 'disparait'];
  // Tramage ordonné de Bayer 4 × 4 : un pixel s'allume si l'opacité dépasse son seuil.
  // La trame est accrochée au sprite, pas à la particule : elle ne grouille pas quand la particule bouge.
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  var M = {
    FORMAT: FORMAT, VERSION: VERSION, COTE_MIN: COTE_MIN, COTE_MAX: COTE_MAX, IMAGES_MAX: IMAGES_MAX, CADENCE_MAX: CADENCE_MAX,
    COUCHES_MAX: COUCHES_MAX, RAMPE_MAX: RAMPE_MAX, FORMES: FORMES, EMETTEURS: EMETTEURS, IMPACTS: IMPACTS,
    effets: {}
  };

  // ---------- Outils ----------
  function borne(v, min, max) { return v < min ? min : v > max ? max : v; }
  function nombre(v, defaut, min, max) { v = Number(v); return isFinite(v) ? borne(v, min, max) : defaut; }
  // Un nom tient sur une ligne : il finit dans un commentaire du fichier pour le lecteur.
  function ligne(s) { return String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' '); }
  M.ligne = ligne;
  function choix(v, liste, defaut) { return liste.indexOf(v) >= 0 ? v : (defaut || liste[0]); }

  // '#rrggbb' vers 0xAABBGGRR opaque ; nul si la chaîne n'est pas une couleur.
  function hexVers(s) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim()), v;
    if (!m) return null;
    v = parseInt(m[1], 16);
    return (0xff000000 | (v & 255) << 16 | (v >>> 8 & 255) << 8 | v >>> 16) >>> 0;
  }
  M.hexVers = hexVers;

  // Générateur pseudo-aléatoire mulberry32 : rapide, et le même sur toutes les machines.
  function alea(graine) {
    var a = graine >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hache(a, b, c) {
    var h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Bruit de valeur lissé, entre -1 et 1. Sert à la turbulence.
  function bruit(x, y, k) {
    var i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    var a = hache(i, j, k), b = hache(i + 1, j, k), c = hache(i, j + 1, k), d = hache(i + 1, j + 1, k);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }

  // ---------- Normalisation ----------
  // Rend un effet complet et sûr à partir de n'importe quel objet : valeurs bornées, défauts posés.
  function couche(c, w, h) {
    c = c || {};
    var e = c.emetteur || {}, rampe = (Array.isArray(c.rampe) ? c.rampe : []).filter(function (x) { return hexVers(x) !== null; }).slice(0, RAMPE_MAX);
    if (!rampe.length) rampe = ['#ffffff'];
    return {
      nom: ligne(c.nom || 'Couche').slice(0, 40),
      visible: c.visible !== false,
      emetteur: {
        forme: choix(e.forme, EMETTEURS),
        x: nombre(e.x, w / 2, -COTE_MAX, 2 * COTE_MAX), y: nombre(e.y, h / 2, -COTE_MAX, 2 * COTE_MAX),
        l: nombre(e.l, 8, 0, 2 * COTE_MAX), h: nombre(e.h, 8, 0, 2 * COTE_MAX),
        rot: nombre(e.rot, 0, -360, 360), contour: !!e.contour
      },
      debit: nombre(c.debit, 20, 0, 1000), salve: Math.round(nombre(c.salve, 0, 0, 2000)),
      vie: nombre(c.vie, 1, 0.05, 20), vieVar: nombre(c.vieVar, 0, 0, 1),
      vitesse: nombre(c.vitesse, 20, 0, 2000), vitesseVar: nombre(c.vitesseVar, 0, 0, 1),
      angle: nombre(c.angle, 0, -360, 360), dispersion: nombre(c.dispersion, 0, 0, 360), radial: !!c.radial,
      gravite: nombre(c.gravite, 0, -3000, 3000), vent: nombre(c.vent, 0, -3000, 3000), trainee: nombre(c.trainee, 0, 0, 30),
      turbulence: nombre(c.turbulence, 0, 0, 3000), turbEchelle: nombre(c.turbEchelle, 16, 1, 256),
      impact: choix(c.impact, IMPACTS), rebond: nombre(c.rebond, 0.4, 0, 1), frottement: nombre(c.frottement, 0.3, 0, 1),
      forme: choix(c.forme, FORMES), taille0: nombre(c.taille0, 1, 0, 16), taille1: nombre(c.taille1, 1, 0, 16), tailleVar: nombre(c.tailleVar, 0, 0, 1),
      etirement: nombre(c.etirement, 0.04, 0, 1),
      rampe: rampe.map(function (x) { x = String(x).trim(); return (x[0] === '#' ? x : '#' + x).toLowerCase(); }),
      couleur: choix(c.couleur, ['vie', 'hasard']),
      opacite0: nombre(c.opacite0, 1, 0, 1), opacite1: nombre(c.opacite1, 1, 0, 1), trame: c.trame !== false,
      scintille: nombre(c.scintille, 0, 0, 1), dessus: choix(c.dessus, ['jeunes', 'vieux'])
    };
  }

  M.normaliser = function (o) {
    var w, h, s;
    if (!o || typeof o !== 'object' || o.format !== FORMAT) throw new Error('Ce n\'est pas un effet de Particules.');
    if (!Array.isArray(o.couches) || !o.couches.length) throw new Error('Cet effet n\'a aucune couche.');
    w = Math.round(nombre(o.w, 48, COTE_MIN, COTE_MAX)); h = Math.round(nombre(o.h, 48, COTE_MIN, COTE_MAX));
    s = o.sol || {};
    return {
      format: FORMAT, version: VERSION, nom: ligne(o.nom || 'effet').slice(0, 60),
      w: w, h: h,
      images: Math.round(nombre(o.images, 24, 1, IMAGES_MAX)), cadence: Math.round(nombre(o.cadence, 12, 1, CADENCE_MAX)),
      graine: Math.round(nombre(o.graine, 1, 0, 999999999)),
      sol: { actif: !!s.actif, y: nombre(s.y, h - 4, -COTE_MAX, 2 * COTE_MAX) },
      couches: o.couches.slice(0, COUCHES_MAX).map(function (c) { return couche(c, w, h); })
    };
  };

  // ---------- Naissance ----------
  // Lieu et vitesse de départ d'une particule. Les angles se comptent en degrés depuis le haut, dans le sens des aiguilles d'une montre.
  function naitre(c, r, x0, y0, id) {
    var em = c.emetteur, u = r(), v = r(), x = 0, y = 0, a, d, rot, co, si, per, vit, dir, p;
    if (em.forme === 'ligne') { x = (u - 0.5) * em.l; }
    else if (em.forme === 'cercle') {
      a = v * 2 * Math.PI; d = em.contour ? em.l / 2 : Math.sqrt(u) * em.l / 2;
      x = Math.cos(a) * d; y = Math.sin(a) * d;
    } else if (em.forme === 'rect') {
      if (em.contour) {
        per = 2 * (em.l + em.h); d = u * per;
        if (d < em.l) { x = d - em.l / 2; y = -em.h / 2; }
        else if (d < em.l + em.h) { x = em.l / 2; y = d - em.l - em.h / 2; }
        else if (d < 2 * em.l + em.h) { x = em.l / 2 - (d - em.l - em.h); y = em.h / 2; }
        else { x = -em.l / 2; y = em.h / 2 - (d - 2 * em.l - em.h); }
      } else { x = (u - 0.5) * em.l; y = (v - 0.5) * em.h; }
    }
    if (em.rot && em.forme !== 'point' && em.forme !== 'cercle') {
      rot = em.rot * Math.PI / 180; co = Math.cos(rot); si = Math.sin(rot);
      d = x * co - y * si; y = x * si + y * co; x = d;
    }
    vit = c.vitesse * (1 + c.vitesseVar * (2 * r() - 1));
    // Radial : chaque particule part en s'éloignant du centre de l'émetteur.
    dir = c.radial && (x || y) ? Math.atan2(x, -y) * 180 / Math.PI : c.radial ? r() * 360 : c.angle;
    dir = (dir + (r() - 0.5) * c.dispersion) * Math.PI / 180;
    p = {
      id: id, x: x0 + em.x + x, y: y0 + em.y + y, vx: Math.sin(dir) * vit, vy: -Math.cos(dir) * vit,
      age: 0, vie: Math.max(0.02, c.vie * (1 + c.vieVar * (2 * r() - 1))),
      kTaille: 1 + c.tailleVar * (2 * r() - 1), teinte: r(), phase: r() * 64,
      pose: false, sol: false, mort: false, dessous: false
    };
    return p;
  }

  // ---------- Mouvement ----------
  // Fait avancer une particule de duree secondes. solY : hauteur du sol dans le même repère, ou nul.
  function avancer(p, duree, c, solY, k, pasMax) {
    var n = Math.max(1, Math.ceil(duree / pasMax - 1e-9)), h = duree / n, i, ax, ay, f, avant, sc;
    for (i = 0; i < n && !p.mort; i++) {
      if (!p.pose) {
        ax = c.vent; ay = c.gravite;
        if (c.turbulence) {
          sc = 1 / c.turbEchelle;
          ax += c.turbulence * bruit(p.x * sc + p.phase, p.y * sc + p.age * 0.9, k);
          ay += c.turbulence * bruit(p.x * sc - p.phase, p.y * sc - p.age * 0.9, k + 7919);
        }
        p.vx += ax * h; p.vy += ay * h;
        if (c.trainee) { f = Math.exp(-c.trainee * h); p.vx *= f; p.vy *= f; }
        avant = p.y;
        p.x += p.vx * h; p.y += p.vy * h;
        if (solY !== null && c.impact !== 'traverse' && !p.dessous && p.y >= solY) {
          if (c.impact === 'disparait') { p.mort = true; break; }
          if (c.impact === 'arret') { p.y = solY - 0.001; p.vx = 0; p.vy = 0; p.pose = true; }
          else {
            if (p.vy > 0 && avant < solY - 0.002) {
              p.vy = -p.vy * c.rebond; p.vx *= 1 - c.frottement;
              if (p.vy > -8) p.vy = 0;
            } else if (p.vy > 0) p.vy = 0;
            p.y = solY - 0.001;
            // Posée, elle glisse en freinant.
            if (!p.vy) p.vx *= Math.exp(-c.frottement * 8 * h);
          }
        }
      }
      p.age += h;
    }
    p.sol = solY !== null && c.impact !== 'traverse' && !p.dessous && p.y >= solY - 0.01;
  }

  // ---------- Dessin ----------
  var masques = {};
  // Les pixels d'une particule de côté s, comptés depuis son coin haut gauche.
  function masque(forme, s) {
    var cle = forme + s, m = masques[cle], i, j, r, d, interieur, mil;
    if (m) return m;
    m = [];
    if (s <= 1) m.push(0, 0);
    else for (j = 0; j < s; j++) for (i = 0; i < s; i++) {
      d = (i + 0.5 - s / 2) * (i + 0.5 - s / 2) + (j + 0.5 - s / 2) * (j + 0.5 - s / 2);
      r = s / 2;
      if (forme === 'carre') m.push(i, j);
      else if (forme === 'plus') {
        mil = (s - 1) / 2;
        if (Math.abs(i - mil) < 0.6 || Math.abs(j - mil) < 0.6) m.push(i, j);
      } else {
        interieur = d <= r * r * 0.85;
        if (forme === 'rond' && interieur) m.push(i, j);
        else if (forme === 'anneau' && interieur && (s <= 2 || d > (r - 1) * (r - 1) * 0.85)) m.push(i, j);
      }
    }
    return (masques[cle] = m);
  }

  // Pose une particule dans le tampon out (W × H, dont le coin est en ox, oy).
  // q : { x, y, vx, vy, sol }, t : âge rapporté à la vie (0 à 1), cle : sert au scintillement.
  function poser(out, W, H, ox, oy, q, t, c, couleurs, solY, kTaille, teinte, cle1, cle2) {
    var s = Math.round((c.taille0 + (c.taille1 - c.taille0) * t) * kTaille), op = c.opacite0 + (c.opacite1 - c.opacite0) * t;
    var col, n = couleurs.length, X, Y, x0, y0, m, i, x1, y1, dx, dy, pas, e, sx, sy, lg;
    if (s < 1 || op <= 0) return;
    if (c.scintille && hache(cle1, cle2, 977) < c.scintille) return;
    col = couleurs[c.couleur === 'hasard' ? Math.min(n - 1, Math.floor(teinte * n)) : Math.min(n - 1, Math.floor(t * n))];
    function pixel(X, Y) {
      var px = X - ox, py = Y - oy;
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      if (op < 1 && (c.trame ? op <= (BAYER[(Y & 3) * 4 + (X & 3)] + 0.5) / 16 : op < 0.5)) return;
      out[py * W + px] = col;
    }
    X = Math.floor(q.x); Y = Math.floor(q.y);
    if (c.forme === 'trait') {
      // Un trait d'un pixel, tiré vers l'arrière de la vitesse : la pluie, les étincelles filantes.
      lg = Math.sqrt(q.vx * q.vx + q.vy * q.vy) * c.etirement;
      x1 = Math.floor(q.x - q.vx * c.etirement); y1 = Math.floor(q.y - q.vy * c.etirement);
      if (lg < 1) { x1 = X; y1 = Y; }
      dx = Math.abs(x1 - X); dy = -Math.abs(y1 - Y); sx = X < x1 ? 1 : -1; sy = Y < y1 ? 1 : -1; e = dx + dy;
      for (pas = 0; pas < 64; pas++) {
        if (!q.sol || Y < solY) pixel(X, Y);
        if (X === x1 && Y === y1) break;
        m = 2 * e;
        if (m >= dy) { e += dy; X += sx; }
        if (m <= dx) { e += dx; Y += sy; }
      }
      return;
    }
    x0 = X - ((s - 1) >> 1); y0 = Y - ((s - 1) >> 1);
    // Posée au sol, la particule s'y appuie au lieu de s'y enfoncer.
    if (q.sol && y0 + s > Math.ceil(solY)) y0 = Math.ceil(solY) - s;
    m = masque(c.forme, s);
    for (i = 0; i < m.length; i += 2) pixel(x0 + m[i], y0 + m[i + 1]);
  }

  // ---------- Boucle précalculée ----------
  // Chaque particule est suivie d'un bout à l'autre de sa vie, une fois pour toutes.
  // Le flux est périodique : les naissances d'une boucle se répètent à l'identique à chaque tour,
  // si bien que l'image n et l'image 0 se raccordent sans couture, et que l'image 0 contient déjà
  // les particules nées aux tours précédents. La salve, elle, part une seule fois, à l'image 0.
  function trajectoire(c, r, s, id, solY, k, dt) {
    var p = naitre(c, r, 0, 0, id), j0 = Math.ceil(s - 1e-9), vieI = p.vie / dt, d0 = j0 - s, l = [], sol = [];
    p.dessous = solY !== null && p.y >= solY;
    if (d0 > 0) avancer(p, d0 * dt, c, solY, k, dt / SOUS_PAS);
    while (d0 + sol.length < vieI && !p.mort && sol.length < ETATS_MAX) {
      l.push(p.x, p.y, p.vx, p.vy); sol.push(p.sol ? 1 : 0);
      avancer(p, dt, c, solY, k, dt / SOUS_PAS);
    }
    return { id: id, s: s, j0: j0, d0: d0, vieI: vieI, L: sol.length, etats: new Float32Array(l), sol: new Uint8Array(sol), kTaille: p.kTaille, teinte: p.teinte };
  }

  M.preparer = function (effet) {
    var e = M.normaliser(effet), dt = 1 / e.cadence, n = e.images, solY = e.sol.actif ? e.sol.y : null, plan;
    plan = { effet: e, w: e.w, h: e.h, n: n, cadence: e.cadence, dt: dt, solY: solY, couches: [], palette: [] };
    e.couches.forEach(function (c, ic) {
      var pc = { c: c, couleurs: c.rampe.map(hexVers), flux: [], salve: [] }, k = (e.graine * 31 + ic * 1009) | 0, nb, i, r;
      pc.couleurs.forEach(function (v) { if (plan.palette.indexOf(v) < 0) plan.palette.push(v); });
      plan.couches.push(pc);
      if (!c.visible) return;
      // Un nombre entier de naissances par boucle : le débit est arrondi pour que la boucle tombe juste.
      // Au moins une dès qu'il y a un débit ; et pas plus que ce que le budget d'échantillons permet de suivre.
      nb = c.debit > 0 ? Math.max(1, Math.round(c.debit * n * dt)) : 0;
      nb = Math.min(nb, PARTICULES_MAX, Math.max(1, Math.floor(BUDGET / Math.min(ETATS_MAX, Math.ceil(c.vie * (1 + c.vieVar) / dt) + 1))));
      pc.naissances = nb;
      for (i = 0; i < nb; i++) {
        r = alea(hache(e.graine, ic, i) * 4294967296);
        pc.flux.push(trajectoire(c, r, (i + r()) / nb * n, i, solY, k, dt));
      }
      nb = Math.min(PARTICULES_MAX, c.salve, Math.max(1, Math.floor(BUDGET / Math.min(ETATS_MAX, Math.ceil(c.vie * (1 + c.vieVar) / dt) + 1))));
      for (i = 0; i < nb; i++) {
        r = alea(hache(e.graine, ic + 101, i) * 4294967296);
        pc.salve.push(trajectoire(c, r, 0, 100000 + i, solY, k, dt));
      }
    });
    return plan;
  };

  // Les particules visibles à l'image f : [enregistrement, indice d'état, tour].
  function presentes(pc, f, n) {
    var l = [], i, t, k, j;
    for (i = 0; i < pc.flux.length; i++) {
      t = pc.flux[i];
      for (k = Math.floor((f - t.j0) / n); ; k--) {
        j = f - k * n - t.j0;
        if (j >= t.L) break;
        if (j >= 0) l.push(t, j, k);
      }
    }
    for (i = 0; i < pc.salve.length; i++) {
      t = pc.salve[i]; j = f - t.j0;
      if (j >= 0 && j < t.L) l.push(t, j, 0);
    }
    return l;
  }

  // L'image f, calculée sur la zone (ox, oy, W, H) du repère du sprite. Sans zone : le sprite exact.
  M.image = function (plan, f, ox, oy, W, H) {
    var out, ic, pc, l, ordre, a, i, t, j, q = { x: 0, y: 0, vx: 0, vy: 0, sol: false }, age;
    if (W === undefined) { ox = 0; oy = 0; W = plan.w; H = plan.h; }
    out = new Uint32Array(W * H);
    f = ((Math.round(f) % plan.n) + plan.n) % plan.n;
    for (ic = 0; ic < plan.couches.length; ic++) {
      pc = plan.couches[ic];
      if (!pc.c.visible) continue;
      l = presentes(pc, f, plan.n);
      ordre = [];
      for (i = 0; i < l.length; i += 3) ordre.push(i);
      // Les plus jeunes dessus (ou les plus vieilles) ; à âge égal, l'ordre de naissance.
      a = pc.c.dessus === 'jeunes' ? -1 : 1;
      ordre.sort(function (p, r) {
        var ap = l[p].d0 + l[p + 1], ar = l[r].d0 + l[r + 1];
        return ap !== ar ? (ap - ar) * a : l[p].id - l[r].id;
      });
      for (i = 0; i < ordre.length; i++) {
        t = l[ordre[i]]; j = l[ordre[i] + 1];
        q.x = t.etats[j * 4]; q.y = t.etats[j * 4 + 1]; q.vx = t.etats[j * 4 + 2]; q.vy = t.etats[j * 4 + 3]; q.sol = !!t.sol[j];
        age = (t.d0 + j) / t.vieI;
        poser(out, W, H, ox, oy, q, age, pc.c, pc.couleurs, plan.solY, t.kTaille, t.teinte, t.id * 7 + ic, j);
      }
    }
    return out;
  };

  // Combien de particules sont en vie à l'image f (toutes couches).
  M.compte = function (plan, f) {
    var n = 0;
    f = ((Math.round(f) % plan.n) + plan.n) % plan.n;
    plan.couches.forEach(function (pc) { if (pc.c.visible) n += presentes(pc, f, plan.n).length / 3; });
    return n;
  };

  M.images = function (effet) {
    var plan = effet.couches && effet.dt ? effet : M.preparer(effet), l = [], f;
    for (f = 0; f < plan.n; f++) l.push(M.image(plan, f));
    return l;
  };

  // ---------- Effets enregistrés ----------
  M.ajouter = function (nom, effet) { M.effets[nom] = effet; return effet; };
  function trouver(effet) {
    var e = typeof effet === 'string' ? M.effets[effet] : effet;
    if (!e) throw new Error('Effet inconnu : ' + effet + '. As-tu chargé son fichier .js après lecteur.js ?');
    return e;
  }

  // ---------- Dans le navigateur ----------
  var doc = racine.document;
  function versToile(pix, w, h) {
    var c = doc.createElement('canvas'), k = c.getContext('2d'), im;
    c.width = w; c.height = h;
    im = k.createImageData(w, h);
    new Uint32Array(im.data.buffer).set(pix);
    k.putImageData(im, 0, 0);
    return c;
  }
  M.versToile = versToile;

  // Les images d'une boucle, prêtes à dessiner. imageA(t) donne l'image à t secondes du début.
  M.animation = function (effet) {
    var plan = M.preparer(trouver(effet)), images = M.images(plan), toiles = [];
    return {
      w: plan.w, h: plan.h, n: plan.n, cadence: plan.cadence, images: images, plan: plan,
      boucle: plan.couches.some(function (pc) { return pc.flux.length > 0; }),
      toile: function (i) {
        i = ((Math.floor(i) % plan.n) + plan.n) % plan.n;
        return toiles[i] || (toiles[i] = versToile(images[i], plan.w, plan.h));
      },
      imageA: function (t) { return this.toile(Math.floor(t * plan.cadence)); }
    };
  };

  // Joue la boucle dans un canvas, agrandie d'un nombre entier de fois. Rend une commande { arreter, reprendre, image(i), anim }.
  M.jouer = function (effet, toile, opt) {
    opt = opt || {};
    var a = M.animation(effet), k = Math.max(1, Math.round(opt.echelle || 1)), g = toile.getContext('2d'), f = 0, debut = 0, actif = true, fin = opt.boucle === false, demande = 0;
    if (!opt.garderTaille) { toile.width = a.w * k; toile.height = a.h * k; }
    function montrer(i) {
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, toile.width, toile.height);
      g.drawImage(a.toile(i), Math.floor((toile.width - a.w * k) / 2), Math.floor((toile.height - a.h * k) / 2), a.w * k, a.h * k);
    }
    function tic(t) {
      if (!actif) return;
      if (!debut) debut = t - f * 1000 / a.cadence;
      var i = Math.floor((t - debut) * a.cadence / 1000);
      if (fin && i >= a.n) { montrer(a.n - 1); actif = false; return; }
      if (i % a.n !== f) { f = i % a.n; montrer(f); }
      demande = racine.requestAnimationFrame(tic);
    }
    montrer(0);
    demande = racine.requestAnimationFrame(tic);
    return {
      anim: a,
      arreter: function () { actif = false; racine.cancelAnimationFrame(demande); },
      reprendre: function () { if (!actif) { actif = true; debut = 0; racine.cancelAnimationFrame(demande); demande = racine.requestAnimationFrame(tic); } },
      image: function (i) { actif = false; racine.cancelAnimationFrame(demande); f = ((Math.floor(i) % a.n) + a.n) % a.n; montrer(f); }
    };
  };

  // ---------- Émetteur vivant ----------
  // Les mêmes lois que la boucle, mais au fil du temps : l'émetteur peut bouger, tirer une salve, se taire.
  // Le centre de l'émetteur de la première couche se pose en (x, y) ; les autres couches et le sol gardent leur place par rapport à lui.
  M.simulation = function (effet, opt) {
    opt = opt || {};
    var e = M.normaliser(trouver(effet)), dt = 1 / e.cadence, ref = e.couches[0].emetteur, parts = [], reste = 0, emet = true;
    var etats = e.couches.map(function (c, ic) {
      return { c: c, couleurs: c.rampe.map(hexVers), acc: 0, n: 0, s: 0, k: (e.graine * 31 + ic * 1009) | 0, ic: ic };
    });
    var s = { x: opt.x || 0, y: opt.y || 0, effet: e };
    function nouvelle(et, flux) {
      var i = flux ? et.n++ : et.s++, r = alea(hache(e.graine, et.ic + (flux ? 0 : 101), i) * 4294967296), p;
      if (flux) r();      // même tirage que dans la boucle, où le premier nombre place la naissance dans le temps
      p = naitre(et.c, r, s.x - ref.x, s.y - ref.y, (flux ? i : 100000 + i) * 7 + et.ic);
      p.et = et;
      p.dessous = e.sol.actif && p.y >= solY();
      return p;
    }
    function solY() { return e.sol.actif ? e.sol.y - ref.y + s.y : null; }
    function pas() {
      var i, j, p, nb, et, nouvelles = [];
      for (i = parts.length - 1; i >= 0; i--) {
        p = parts[i];
        avancer(p, dt, p.et.c, solY(), p.et.k, dt / SOUS_PAS);
        if (p.mort || p.age >= p.vie) parts.splice(i, 1);
      }
      for (i = 0; i < etats.length; i++) {
        et = etats[i];
        if (!et.c.visible || !emet) continue;
        et.acc += et.c.debit * dt;
        nb = Math.floor(et.acc); et.acc -= nb;
        for (j = 0; j < nb && parts.length + nouvelles.length < PARTICULES_MAX * 2; j++) {
          p = nouvelle(et, true);
          // Les naissances s'étalent sur la durée du pas, comme dans la boucle : la première a déjà presque un pas d'âge.
          avancer(p, (1 - (j + 0.5) / nb) * dt, et.c, solY(), et.k, dt / SOUS_PAS);
          if (!p.mort && p.age < p.vie) nouvelles.push(p);
        }
      }
      parts = parts.concat(nouvelles);
    }
    s.avancer = function (secondes) {
      reste += Math.min(0.25, Math.max(0, secondes || 0));
      while (reste >= dt) { reste -= dt; pas(); }
    };
    s.deplacer = function (x, y) { s.x = x; s.y = y; };
    s.salve = function () {
      etats.forEach(function (et) {
        var i;
        if (!et.c.visible) return;
        for (i = 0; i < et.c.salve && parts.length < PARTICULES_MAX * 2; i++) parts.push(nouvelle(et, false));
      });
    };
    s.couper = function () { emet = false; };
    s.relancer = function () { emet = true; };
    s.vivantes = function () { return parts.length; };
    s.fini = function () { return !parts.length && (!emet || !etats.some(function (et) { return et.c.visible && et.c.debit > 0; })); };
    // Dessine les particules dans ctx, agrandies k fois, décalées de (ox, oy) pixels d'écran.
    s.dessiner = function (ctx, k, ox, oy) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i, p, W, H, out, ordre;
      k = Math.max(1, Math.round(k || 1)); ox = ox || 0; oy = oy || 0;
      if (!parts.length) return;
      for (i = 0; i < parts.length; i++) {
        p = parts[i];
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      }
      // La marge couvre le plus long trait et la plus grosse particule ; le tampon ne dépasse pas ce que montre le canvas.
      x0 = Math.max(Math.floor(x0) - 80, Math.floor(-ox / k)); y0 = Math.max(Math.floor(y0) - 80, Math.floor(-oy / k));
      x1 = Math.min(Math.ceil(x1) + 81, Math.ceil((ctx.canvas.width - ox) / k)); y1 = Math.min(Math.ceil(y1) + 81, Math.ceil((ctx.canvas.height - oy) / k));
      W = Math.min(4096, x1 - x0); H = Math.min(4096, y1 - y0);
      if (W <= 0 || H <= 0) return;
      out = new Uint32Array(W * H);
      ordre = parts.slice().sort(function (a, b) {
        return a.et.ic !== b.et.ic ? a.et.ic - b.et.ic : (a.age - b.age) * (a.et.c.dessus === 'jeunes' ? -1 : 1) || a.id - b.id;
      });
      for (i = 0; i < ordre.length; i++) {
        p = ordre[i];
        poser(out, W, H, x0, y0, p, p.age / p.vie, p.et.c, p.et.couleurs, solY(), p.kTaille, p.teinte, p.id, Math.floor(p.age * e.cadence + 1e-6));
      }
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(versToile(out, W, H), ox + x0 * k, oy + y0 * k, W * k, H * k);
      ctx.restore();
    };
    if (opt.salve !== false) s.salve();
    return s;
  };

  racine.Particules = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
