(function () {
  'use strict';

  // La table lumineuse : zoom, déplacement de la vue, et les gestes de chaque outil.
  var V = window.Vitrail, G = V.geo, R = V.rendu;

  var Z_MIN = 0.12, Z_MAX = 40, PAS_ZOOM = 1.2;
  var AIMANT = 10;          // rayon d'aimantation, en pixels d'écran
  var DOUBLE_CLIC = 380;    // millisecondes
  var TABLE = { jour: '#fbfaf3', atelier: '#9b9e9a', carton: '#efeee8' };
  var GRILLE = { jour: ['#e9e8df', '#d6d5cb'], atelier: ['#939692', '#878a86'], carton: ['#e3e2da', '#d2d1c8'] };
  var PLOMB = '#232527', GRAPHITE = '#6b6f73';

  var $ = function (s) { return document.querySelector(s); };
  function icone(d) { return '<svg viewBox="0 0 20 20">' + d + '</svg>'; }

  // L'état de l'interface. sel : un point de la pièce choisie (la pièce se retrouve après chaque recalcul).
  var U = V.ui = {
    outil: 'plomb', vue: 'jour', z: 1, cx: 0, cy: 0, espace: false, regles: true, numeros: false,
    verre: 1, sel: null, survol: null, noeudVise: 0, largeurGrisaille: 1.5, curseur: null
  };

  U.OUTILS = [
    { id: 'plomb', nom: 'Plomb droit', touche: 'l', svg: '<path d="M3.5 16.5 16.5 3.5"/><path d="M2 14.5l3.5 3.5M14.5 2 18 5.5"/>', astuce: 'Glisse d\'un point à un autre, ou clique point par point (double-clic ou Entrée pour finir). Le plomb s\'aimante aux nœuds, aux plombs et à la grille. Maj : angles de 15°. Alt : sans aimant.' },
    { id: 'courbe', nom: 'Plomb courbe', touche: 'c', svg: '<path d="M3 15c2-9 6-9 7-5s5 4 7-5"/><circle class="plein" cx="3" cy="15" r="1.4"/><circle class="plein" cx="17" cy="5" r="1.4"/>', astuce: 'Trace à main levée : la courbe est lissée et s\'accroche aux plombs qu\'elle touche à ses deux bouts. Une boucle refermée fait une pièce ronde.' },
    { id: 'noeud', nom: 'Nœud', touche: 'v', svg: '<path d="M4 3l11 6-4.5 1.3L8.5 15z"/><circle cx="15.5" cy="15.5" r="2"/>', astuce: 'Glisse un nœud pour le déplacer, ou le milieu d\'un plomb pour le courber. Lâché sur un autre nœud, il s\'y soude. Un clic choisit une pièce.' },
    { id: 'couper', nom: 'Couper', touche: 'x', svg: '<path d="M2.5 10h15"/><circle cx="10" cy="10" r="2.6"/><path d="M10 3v2.5M10 14.5V17"/>', astuce: 'Clique un plomb pour y poser un nœud, ou glisse pour le tirer aussitôt ailleurs.' },
    { id: 'effacer', nom: 'Effacer', touche: 'e', svg: '<path d="M7.5 16.5 3 12l8-8 6 6-6.5 6.5z"/><path d="M5.5 9.5l5 5M7.5 16.5H17"/>', astuce: 'Passe sur les plombs et la grisaille à retirer : les pièces voisines se rejoignent. La bordure reste.' },
    { id: 'verre', nom: 'Verre', touche: 'b', svg: '<path d="M4 8.5 9 3.5l6.5 6.5-5 5z"/><path d="M4 8.5h11.5M16.5 12.5s1.8 2.300 1.800 3.400a1.800 1.800 0 0 1-3.600 0c0-1.100 1.800-3.400 1.800-3.400z"/>', astuce: 'Clique une pièce pour y poser le verre choisi, ou glisse sur plusieurs. Maj : toutes les pièces du même verre. Alt : pipette. Les chiffres choisissent le verre.' },
    { id: 'pipette', nom: 'Pipette', touche: 'i', svg: '<path d="M12.5 4.500 15.500 7.500M11 6l3 3-7 7H4v-3z"/><path d="M13 3.500a1.500 1.500 0 0 1 3.500 3.500"/>', astuce: 'Clique une pièce pour reprendre son verre ; l\'outil Verre revient tout seul.' },
    { id: 'grisaille', nom: 'Grisaille', touche: 'g', svg: '<path d="M16.5 3.5 9 11"/><path d="M9 11c-2.500-.500-4.500 1-4.500 3.500 0 1-.700 2-1.500 2.500 3 .500 6.500-.500 6.800-3.300z"/>', astuce: 'Peins à main levée les traits de grisaille, en noir brun, sur le verre. Elle passe sous les plombs.' },
    { id: 'main', nom: 'Main', touche: 'h', svg: '<path d="M6 11V5.500a1.200 1.200 0 0 1 2.400 0V10M8.400 9V4a1.200 1.200 0 0 1 2.400 0v5M10.800 9V5a1.200 1.200 0 0 1 2.400 0v5M13.200 10V7a1.200 1.200 0 0 1 2.400 0v5c0 3-2 5-5 5s-4-1.400-5.400-4L4 10.600a1.200 1.200 0 0 1 2-1.200"/>', astuce: 'Glisse pour déplacer la vue. Espace maintenu ou clic milieu font la même chose avec n\'importe quel outil.' }
  ];
  var CONTOUR = { id: 'contour', nom: 'Contour à la main', astuce: 'Trace d\'un seul geste le contour du panneau, en revenant près du départ. Échap abandonne.' };

  var scene, toile, g, geste = null, chaine = null, demande = false, dernierClic = { t: 0, x: 0, y: 0 };

  // ---------- Vue ----------
  U.redessiner = function () {
    if (demande) return;
    demande = true;
    requestAnimationFrame(function () { demande = false; dessiner(); });
  };

  U.ajuster = function () {
    var f = V.doc.forme, W = scene.clientWidth, H = scene.clientHeight, m = W < 500 ? 22 : 46;
    U.z = V.borne(Math.min((W - 2 * m) / f.l, (H - 2 * m - 18) / f.h), Z_MIN, Z_MAX);
    U.cx = Math.round((W - f.l * U.z) / 2); U.cy = Math.round((H - 18 - f.h * U.z) / 2);
    U.redessiner();
  };
  function zoomer(z, sx, sy) {
    var x = (sx - U.cx) / U.z, y = (sy - U.cy) / U.z;
    U.z = V.borne(z, Z_MIN, Z_MAX); U.cx = sx - x * U.z; U.cy = sy - y * U.z;
    U.redessiner();
  }
  U.zoomPas = function (sens, sx, sy) {
    if (sx === undefined) { sx = scene.clientWidth / 2; sy = scene.clientHeight / 2; }
    zoomer(U.z * Math.pow(PAS_ZOOM, sens), sx, sy);
  };
  // Amène un point du panneau au centre de la vue, sans changer le zoom (ou en rapprochant si c'est trop loin).
  U.centrer = function (p) {
    if (U.z < 1.2) U.z = Math.min(1.6, Z_MAX);
    U.cx = scene.clientWidth / 2 - p.x * U.z; U.cy = scene.clientHeight / 2 - p.y * U.z;
    U.redessiner();
  };

  // Mesuré sur la toile, pas sur la table : le cadre de la table l'entoure de quelques pixels.
  function plan(e) {
    var r = toile.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: (sx - U.cx) / U.z, y: (sy - U.cy) / U.z, sx: sx, sy: sy };
  }

  // Ce que vise le pointeur, aimants compris : un nœud, un point sur un plomb, la grille, ou le point exact.
  function viser(q, e, sauf, depuis) {
    var r = AIMANT / U.z, n, p, pas, a, l, k;
    if (depuis && e.shiftKey) {
      // Maj : un angle multiple de 15° depuis le point de départ.
      a = Math.atan2(q.y - depuis.y, q.x - depuis.x); l = Math.hypot(q.x - depuis.x, q.y - depuis.y);
      k = Math.round(a / (Math.PI / 12)) * Math.PI / 12;
      q = { x: depuis.x + Math.cos(k) * l, y: depuis.y + Math.sin(k) * l };
    }
    if (e.altKey) return { x: G.r2(q.x), y: G.r2(q.y), type: 'libre' };
    n = G.noeudProche(V.doc, q, r, sauf);
    if (n) return { x: V.doc.noeuds[n].x, y: V.doc.noeuds[n].y, id: n, type: 'noeud' };
    p = G.plombProche(V.doc, q, r * 0.8, sauf ? function (x) { return x.a !== sauf && x.b !== sauf; } : null);
    if (p) return { x: G.r2(p.x), y: G.r2(p.y), type: 'plomb' };
    if (V.doc.aimant && !(depuis && e.shiftKey)) { pas = V.doc.grille; return { x: Math.round(q.x / pas) * pas, y: Math.round(q.y / pas) * pas, type: 'grille' }; }
    return { x: G.r2(q.x), y: G.r2(q.y), type: 'libre' };
  }
  function spec(s) { return s.id && V.doc.noeuds[s.id] ? { id: s.id, x: V.doc.noeuds[s.id].x, y: V.doc.noeuds[s.id].y } : { x: s.x, y: s.y }; }

  U.pieceChoisie = function () { return U.sel ? V.pieceEn(U.sel) : null; };
  U.choisir = function (f) {
    U.sel = f ? { x: f.centre.x, y: f.centre.y } : null;
    if (U.surChoix) U.surChoix();
    U.redessiner();
  };

  // ---------- Dessin ----------
  function fond(W, H) {
    var pas = V.doc.grille * U.z, c = GRILLE[U.vue], x, y, i0, k;
    g.fillStyle = TABLE[U.vue]; g.fillRect(0, 0, W, H);
    // Le quadrillage du carton : un trait par pas de grille, plus marqué tous les dix.
    if (pas < 9) pas *= 10;
    if (pas < 9) return;
    k = pas === V.doc.grille * U.z ? 10 : 1;
    i0 = Math.floor(-U.cx / pas);
    for (x = U.cx + i0 * pas; x < W; x += pas, i0++) { g.fillStyle = (k > 1 && i0 % k === 0) ? c[1] : c[0]; g.fillRect(Math.round(x), 0, 1, H); }
    i0 = Math.floor(-U.cy / pas);
    for (y = U.cy + i0 * pas; y < H; y += pas, i0++) { g.fillStyle = (k > 1 && i0 % k === 0) ? c[1] : c[0]; g.fillRect(0, Math.round(y), W, 1); }
  }

  // Une réglette graduée en bas à gauche, et le nom du vitrail au crayon en bas à droite.
  function regle(W, H) {
    var cm = [1, 2, 5, 10, 20, 50, 100].filter(function (c) { return c * 10 * U.z <= Math.min(220, W * 0.35); }).pop() || 1, l = cm * 10 * U.z, x = 14, y = H - 16, i, encre = U.vue === 'atelier' ? '#2b2d2f' : GRAPHITE, f = V.doc.forme;
    g.fillStyle = encre; g.strokeStyle = encre; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y + 0.5); g.lineTo(x + l, y + 0.5);
    for (i = 0; i <= 10; i++) { g.moveTo(Math.round(x + l * i / 10) + 0.5, y - (i % 5 ? 3 : 6)); g.lineTo(Math.round(x + l * i / 10) + 0.5, y + 0.5); }
    g.stroke();
    g.font = '13px ' + R.POLICE_MAIN; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillText(cm + ' cm', x + l + 8, y + 3);
    if (W > 520) {
      g.textAlign = 'right';
      g.fillText(V.doc.nom + ', ' + V.fr(f.l / 10) + ' × ' + V.fr(f.h / 10) + ' cm', W - 14, y + 3);
    }
  }

  function chemin(pts) {
    g.beginPath();
    pts.forEach(function (q, i) { if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
  }

  function marque(s) {
    var x = U.cx + s.x * U.z, y = U.cy + s.y * U.z;
    g.lineWidth = 1.5; g.strokeStyle = PLOMB; g.fillStyle = '#fbfbf7';
    g.beginPath();
    if (s.type === 'noeud') { g.arc(x, y, 6, 0, 6.2832); g.fill(); g.stroke(); }
    else if (s.type === 'plomb') { g.rect(x - 4.5, y - 4.5, 9, 9); g.fill(); g.stroke(); }
    else { g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.lineWidth = 1.5; g.stroke(); }
  }

  function dessiner() {
    var dpr = window.devicePixelRatio || 1, W = scene.clientWidth, H = scene.clientHeight, t = geste, editer = U.outil === 'noeud' || U.outil === 'couper' || U.outil === 'plomb' || U.outil === 'courbe' || U.outil === 'effacer';
    if (!W || !H || !V.doc || !V.calc) return;
    if (toile.width !== Math.round(W * dpr) || toile.height !== Math.round(H * dpr)) { toile.width = Math.round(W * dpr); toile.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    fond(W, H);
    R.dessiner(g, {
      doc: V.doc, calc: V.calc, vue: U.vue, z: U.z, ox: U.cx, oy: U.cy, dpr: dpr, regles: U.regles, numeros: U.numeros && U.vue !== 'carton',
      sel: U.pieceChoisie(), survol: U.survol, noeuds: editer, noeudVise: U.noeudVise, verreDe: V.verre,
      effaces: t && t.type === 'effacer' ? t.ids : null, effacesG: t && t.type === 'effacer' ? t.gr : null
    });
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Ce qui est en train de se tracer.
    var depart = t && t.type === 'plomb' ? t.depart : chaine ? chaine.depart : null, fin = t && t.type === 'plomb' ? t.fin : chaine ? chaine.fin : null;
    if (depart && fin) {
      g.strokeStyle = 'rgba(35, 37, 39, .55)'; g.lineWidth = Math.max(2, V.doc.plomb * U.z); g.lineCap = 'round';
      g.beginPath(); g.moveTo(U.cx + depart.x * U.z, U.cy + depart.y * U.z); g.lineTo(U.cx + fin.x * U.z, U.cy + fin.y * U.z); g.stroke();
      g.lineWidth = 1; g.strokeStyle = '#fbfbf7'; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
      marque(depart); marque(fin);
    } else if (U.curseur && (U.outil === 'plomb' || U.outil === 'courbe') && !t && !U.espace) marque(U.curseur);
    if (t && (t.type === 'courbe' || t.type === 'contour' || t.type === 'grisaille')) {
      chemin(t.pts.map(function (q) { return { x: U.cx + q.x * U.z, y: U.cy + q.y * U.z }; }));
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (t.type === 'grisaille') { g.strokeStyle = 'rgba(43, 26, 16, .86)'; g.lineWidth = Math.max(1, U.largeurGrisaille * U.z); }
      else { g.strokeStyle = 'rgba(35, 37, 39, .55)'; g.lineWidth = t.type === 'contour' ? 3 : Math.max(2, V.doc.plomb * U.z); }
      g.stroke();
      if (t.depart) marque(t.depart);
    }
    if (t && t.type === 'noeud' && t.cible && t.bouge) marque(t.cible);
    if (U.outil === 'effacer' && U.curseur && !U.espace) {
      g.beginPath(); g.arc(U.cx + U.curseur.x * U.z, U.cy + U.curseur.y * U.z, 6, 0, 6.2832);
      g.strokeStyle = R.CRAYON; g.lineWidth = 1.5; g.stroke();
    }
    regle(W, H);
  }

  // ---------- Gestes ----------
  U.gesteEnCours = function () { return !!geste; };

  // Abandonne le geste en cours (Échap, ou le navigateur qui reprend le pointeur) : rien de ce qu'il a fait ne reste.
  U.abandonnerGeste = function () {
    var t = geste;
    if (!t) return false;
    geste = null;
    try { if (t.pid !== undefined) scene.releasePointerCapture(t.pid); } catch (err) { /* pointeur déjà relâché */ }
    scene.classList.toggle('main', U.espace);
    if (t.type === 'noeud' && t.bouge) { V.doc.noeuds[t.id].x = t.x; V.doc.noeuds[t.id].y = t.y; t.inc.forEach(function (o) { o.e.c = o.c; }); }
    if (t.type === 'courber' && t.bouge) t.e.c = t.c;
    if (t.entame) V.annulerMarque(); else V.apercu();
    U.redessiner();
    return true;
  };
  function entamer() { if (!geste.entame) { V.marquer(); geste.entame = true; } }

  // Termine le plomb tracé point par point.
  U.finirChaine = function () {
    if (!chaine) return false;
    chaine = null; U.redessiner();
    return true;
  };

  function poserPlomb(a, b) {
    var n;
    if (G.dist(a, b) < G.EPS) return 0;
    V.marquer();
    n = G.ajouter(V.doc, spec(a), spec(b), null, V.doc.plomb);
    if (!n) { V.annulerMarque(); U.dire('Ce plomb sortirait du panneau, ou il existe déjà.'); return 0; }
    V.change(true);
    return n;
  }

  // La courbe tracée à main levée, rééchantillonnée régulièrement puis lissée.
  function finCourbe(t, fin) {
    var pts = [t.depart].concat(t.pts.slice(1, -1)).concat([fin]), cum = [0], P = 0, i, n, out = [], k, s, a, b, ferme, segs, nb = 0;
    for (i = 1; i < pts.length; i++) { P += G.dist(pts[i - 1], pts[i]); cum.push(P); }
    if (P * U.z < 12) return;
    ferme = pts.length > 8 && G.dist(t.depart, fin) < AIMANT / U.z * 1.5 && P > 4 * G.dist(t.depart, fin);
    n = Math.max(ferme ? 4 : 2, Math.min(36, Math.round(P / Math.max(22, 55 / U.z))));
    for (k = 0, i = 0; k <= n; k++) {
      s = P * k / n;
      while (i < pts.length - 2 && cum[i + 1] < s) i++;
      a = pts[i]; b = pts[i + 1];
      out.push(k === 0 ? t.depart : k === n ? fin : { x: G.r2(a.x + (b.x - a.x) * (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1)), y: G.r2(a.y + (b.y - a.y) * (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1)) });
    }
    if (ferme) out.pop();
    segs = G.catmull(out, ferme);
    V.marquer();
    segs.forEach(function (sg, j) {
      var A = j === 0 ? spec(t.depart) : { x: sg.a.x, y: sg.a.y }, B = j === segs.length - 1 && !ferme ? spec(fin) : { x: sg.b.x, y: sg.b.y };
      nb += G.ajouter(V.doc, A, B, sg.c.map(G.r2), V.doc.plomb);
    });
    if (!nb) { V.annulerMarque(); U.dire('Cette courbe sortirait du panneau.'); return; }
    V.change(true);
  }

  // Le contour d'une forme libre : le panneau prend la boîte du tracé, les plombs restent où ils sont.
  function finContour(t) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, P = 0, cum = [0], i, k, n = 28, s, a, b, out = [], L, H, pts = t.pts;
    pts.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
    L = Math.round(x1 - x0); H = Math.round(y1 - y0);
    if (pts.length < 8 || L < V.COTE_MIN || H < V.COTE_MIN || L > V.COTE_MAX || H > V.COTE_MAX) { U.dire('Le contour doit faire entre 10 cm et 4 m de côté : recommence en traçant plus grand ou plus petit.'); return; }
    for (i = 1; i <= pts.length; i++) { P += G.dist(pts[i - 1], pts[i % pts.length]); cum.push(P); }
    for (k = 0, i = 0; k < n; k++) {
      s = P * k / n;
      while (cum[i + 1] < s) i++;
      a = pts[i]; b = pts[(i + 1) % pts.length];
      out.push([Math.round((a.x + (b.x - a.x) * (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1) - x0) / L * 1e4) / 1e4, Math.round((a.y + (b.y - a.y) * (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1) - y0) / H * 1e4) / 1e4]);
    }
    // Un contour qui se recoupe ne délimite pas un panneau : on le refuse plutôt que d'en tirer des pièces absurdes.
    if (G.polyContour(G.catmull(out.map(function (q) { return { x: q[0] * L, y: q[1] * H }; }), true)).some(function (a, i, poly) {
      var j, b = poly[(i + 1) % poly.length];
      for (j = i + 2; j < poly.length; j++) {
        if (i === 0 && j === poly.length - 1) continue;
        if (G.croisent(a, b, poly[j], poly[(j + 1) % poly.length])) return true;
      }
      return false;
    })) { U.dire('Ce contour se recoupe : retrace-le en une seule boucle, sans le croiser.'); return; }
    V.marquer();
    V.doc.forme = { type: 'libre', l: L, h: H, lobes: V.doc.forme.lobes, libre: out };
    G.refaire(V.doc, 1, 1, -x0, -y0);
    U.cx += x0 * U.z; U.cy += y0 * U.z;
    V.change(true);
    U.dire('Contour posé : ' + V.fr(L / 10) + ' × ' + V.fr(H / 10) + ' cm.');
  }

  function toucherEffacer(t, q) {
    var p = G.plombProche(V.doc, q, 6 / U.z, function (e) { return !e.bord; }), r;
    if (p) t.ids[p.e.id] = true;
    V.doc.grisaille.forEach(function (s, j) {
      r = Math.max(s.l / 2, 6 / U.z);
      if (s.pts.some(function (a, i) { var b = s.pts[i + 1] || a; return G.projeter([{ x: a[0], y: a[1], t: 0 }, { x: b[0], y: b[1], t: 1 }], q).d < r; })) t.gr[j] = true;
    });
  }

  function vitrer(f, e) {
    var v = U.verre, cible;
    if (!f || !V.verre(v)) return;
    if (e.shiftKey && f.verre) {
      cible = f.verre;
      if (cible === v) return;
      entamer();
      V.calc.faces.forEach(function (x) { if (x.verre === cible) V.vitrer(x, v); });
      V.change(false);
      U.dire('Toutes les pièces en « ' + V.verre(cible).nom + ' » passent en « ' + V.verre(v).nom + ' ».');
      return;
    }
    if (f.verre === v) return;
    entamer(); V.vitrer(f, v); V.change(false);
  }

  function pipette(f) {
    if (!f || !f.verre) { U.dire('Cette pièce n\'a pas encore de verre.'); return; }
    U.choisirVerre(f.verre);
    if (U.outil === 'pipette') U.choisirOutil('verre');
    U.dire('Verre repris : « ' + V.verre(f.verre).nom + ' ».');
  }

  function bas(e) {
    var q = plan(e), s, n, p, f, now = Date.now();
    if (geste || (e.button !== 0 && e.button !== 1 && e.button !== 2)) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (e.button === 2) { U.finirChaine(); return; }
    scene.setPointerCapture(e.pointerId);
    if (e.button === 1 || U.espace || U.outil === 'main') {
      geste = { type: 'main', sx: q.sx, sy: q.sy, cx: U.cx, cy: U.cy };
      scene.classList.add('main');
      e.preventDefault();
      return;
    }
    switch (U.outil) {
      case 'plomb':
        s = viser(q, e, 0, chaine && chaine.depart);
        // Un double-clic, ou un point posé sur un plomb existant, termine la ligne. Le second clic d'un double-clic
        // ne commence jamais une ligne neuve, même quand le premier a déjà fini la précédente.
        var double = now - dernierClic.t < DOUBLE_CLIC && Math.hypot(q.sx - dernierClic.x, q.sy - dernierClic.y) < 6;
        dernierClic = { t: now, x: q.sx, y: q.sy };
        if (double) { U.finirChaine(); dernierClic.t = 0; return; }
        if (chaine) {
          if (poserPlomb(chaine.depart, s) && (s.type === 'noeud' || s.type === 'plomb')) { chaine = null; U.redessiner(); return; }
          chaine.depart = s; chaine.fin = s;
          U.redessiner();
          return;
        }
        geste = { type: 'plomb', depart: s, fin: s, sx: q.sx, sy: q.sy };
        break;
      case 'courbe':
        s = viser(q, e);
        geste = { type: 'courbe', depart: s, pts: [{ x: s.x, y: s.y }], sx: q.sx, sy: q.sy };
        break;
      case 'contour':
        geste = { type: 'contour', pts: [{ x: q.x, y: q.y }] };
        break;
      case 'noeud':
        n = G.noeudProche(V.doc, q, AIMANT / U.z);
        if (n && G.surBord(V.doc, n)) { U.dire('Ce nœud tient le bord du panneau : il ne bouge pas. Change la forme dans le panneau de droite.'); n = 0; }
        if (n) { gesteNoeud(n, q); break; }
        p = G.plombProche(V.doc, q, AIMANT * 0.8 / U.z, function (x) { return !x.bord; });
        if (p) { geste = { type: 'courber', e: p.e, c: p.e.c, sx: q.sx, sy: q.sy }; break; }
        geste = { type: 'choisir', sx: q.sx, sy: q.sy, q: q };
        break;
      case 'couper':
        p = G.plombProche(V.doc, q, AIMANT / U.z, function (x) { return !x.bord; });
        if (!p) { U.dire(G.plombProche(V.doc, q, AIMANT / U.z) ? 'La bordure ne se coupe pas : les plombs s\'y accrochent d\'eux-mêmes.' : 'Clique sur un plomb pour le couper.'); return; }
        // Tout près d'un nœud qui existe déjà, rien n'est coupé : on reprend ce nœud, s'il peut bouger.
        n = G.noeudProche(V.doc, q, AIMANT / U.z);
        if (n) {
          if (G.surBord(V.doc, n)) { U.dire('Ce nœud tient le bord du panneau : il ne bouge pas.'); return; }
          gesteNoeud(n, q);
          break;
        }
        V.marquer();
        n = G.couper(V.doc, p.e.id, q);
        V.change(true);
        gesteNoeud(n, q);
        geste.entame = true;
        U.dire('Plomb coupé : glisse le nouveau nœud, ou passe à l\'outil Nœud pour le reprendre plus tard.');
        break;
      case 'effacer':
        geste = { type: 'effacer', ids: {}, gr: {}, der: q };
        toucherEffacer(geste, q);
        break;
      case 'verre':
        f = V.pieceEn(q);
        if (e.altKey) { pipette(f); return; }
        geste = { type: 'verre' };
        if (f) { U.choisir(f); vitrer(f, e); }
        break;
      case 'pipette':
        pipette(V.pieceEn(q));
        return;
      case 'grisaille':
        geste = { type: 'grisaille', pts: [{ x: q.x, y: q.y }], sx: q.sx, sy: q.sy };
        break;
    }
    // Le geste appartient au pointeur qui l'a commencé : un second doigt ne le conduit pas.
    if (geste) geste.pid = e.pointerId;
    U.redessiner();
  }

  function gesteNoeud(n, q) {
    var nd = V.doc.noeuds[n];
    geste = {
      type: 'noeud', id: n, x: nd.x, y: nd.y, sx: q.sx, sy: q.sy,
      inc: V.doc.plombs.filter(function (e) { return e.a === n || e.b === n; }).map(function (e) { return { e: e, c: e.c ? e.c.slice() : null }; })
    };
  }

  function bouge(e) {
    var q = plan(e), t = geste, s, dx, dy, nd, der, k, d, f;
    if (t && t.pid !== undefined && e.pointerId !== t.pid) return;
    $('#etatPos').textContent = V.fr(q.x / 10, 1) + ' × ' + V.fr(q.y / 10, 1) + ' cm';
    U.curseur = null; U.noeudVise = 0;
    if (!t) {
      if (U.espace) return;
      if (U.outil === 'plomb' || U.outil === 'courbe') {
        U.curseur = viser(q, e, 0, chaine && chaine.depart);
        if (chaine) chaine.fin = U.curseur;
      } else if (U.outil === 'noeud' || U.outil === 'couper') {
        U.noeudVise = G.noeudProche(V.doc, q, AIMANT / U.z) || 0;
      } else if (U.outil === 'effacer') U.curseur = q;
      f = U.outil === 'verre' || U.outil === 'pipette' ? V.pieceEn(q) : null;
      U.survol = f;
      U.redessiner();
      return;
    }
    switch (t.type) {
      case 'main': U.cx = t.cx + q.sx - t.sx; U.cy = t.cy + q.sy - t.sy; break;
      case 'plomb':
        t.fin = viser(q, e, 0, t.depart);
        if (Math.hypot(q.sx - t.sx, q.sy - t.sy) > 4) t.bouge = true;
        break;
      case 'courbe': case 'contour': case 'grisaille':
        der = t.pts[t.pts.length - 1];
        if (Math.hypot((q.x - der.x) * U.z, (q.y - der.y) * U.z) > 2) t.pts.push({ x: q.x, y: q.y });
        break;
      case 'noeud':
        if (!t.bouge && Math.hypot(q.sx - t.sx, q.sy - t.sy) < 3) return;
        t.bouge = true;
        s = viser(q, e, t.id);
        t.cible = s;
        entamer();
        nd = V.doc.noeuds[t.id]; nd.x = s.x; nd.y = s.y; dx = s.x - t.x; dy = s.y - t.y;
        t.inc.forEach(function (o) {
          if (!o.c) return;
          o.e.c = o.c.slice();
          if (o.e.a === t.id) { o.e.c[0] += dx; o.e.c[1] += dy; } else { o.e.c[2] += dx; o.e.c[3] += dy; }
        });
        V.apercu();
        break;
      case 'courber':
        if (!t.bouge && Math.hypot(q.sx - t.sx, q.sy - t.sy) < 3) return;
        t.bouge = true;
        entamer();
        t.e.c = G.controlesPar(V.doc.noeuds[t.e.a], V.doc.noeuds[t.e.b], q);
        t.q = q;
        V.apercu();
        break;
      case 'effacer':
        // Le trajet est suivi pas à pas, pour ne pas sauter un plomb fin quand la souris va vite.
        d = Math.hypot(q.x - t.der.x, q.y - t.der.y) * U.z;
        for (k = 1; k <= Math.ceil(d / 3); k++) toucherEffacer(t, { x: t.der.x + (q.x - t.der.x) * k / Math.ceil(d / 3), y: t.der.y + (q.y - t.der.y) * k / Math.ceil(d / 3) });
        t.der = q; U.curseur = q;
        break;
      case 'verre':
        f = V.pieceEn(q);
        if (f && !e.shiftKey) vitrer(f, e);
        U.survol = f;
        break;
    }
    U.redessiner();
  }

  function haut(e) {
    var t = geste, q = plan(e), ids, gr, n, f, pts;
    if (!t || (t.pid !== undefined && e.pointerId !== t.pid)) return;
    geste = null;
    scene.classList.toggle('main', U.espace);
    switch (t.type) {
      case 'plomb':
        if (t.bouge) poserPlomb(t.depart, t.fin);
        else { chaine = { depart: t.depart, fin: t.depart }; U.dire('Clique le point suivant ; double-clic, Entrée ou un plomb existant terminent la ligne.'); }
        break;
      case 'courbe': finCourbe(t, viser(q, e)); break;
      case 'contour':
        if (t.pts.length > 8) finContour(t); else U.dire('Trace le contour d\'un seul geste, en revenant près du départ.');
        U.choisirOutil(U.avantContour || 'plomb');
        break;
      case 'noeud':
        if (!t.bouge) { if (!t.entame) { f = V.pieceEn(q); U.choisir(f); } break; }
        // Le nœud revient à sa place le temps de le reposer pour de bon : ses plombs coupent alors ce qu'ils croisent.
        V.doc.noeuds[t.id].x = t.x; V.doc.noeuds[t.id].y = t.y;
        t.inc.forEach(function (o) { o.e.c = o.c; });
        n = G.deplacer(V.doc, t.id, spec(t.cible));
        V.change(true);
        if (n) U.dire(n > 1 ? n + ' plombs sont sortis du panneau ou se confondent avec un autre : Ctrl+Z les ramène.' : 'Un plomb est sorti du panneau ou se confond avec un autre : Ctrl+Z le ramène.');
        break;
      case 'courber':
        if (!t.bouge) { U.choisir(V.pieceEn(q)); break; }
        t.e.c = t.c;
        if (!G.courber(V.doc, t.e.id, t.q)) { V.annulerMarque(); U.dire('Cette courbe sortirait du panneau ou doublerait un plomb : le plomb reste droit.'); break; }
        V.change(true);
        break;
      case 'choisir': U.choisir(V.pieceEn(t.q)); break;
      case 'effacer':
        ids = Object.keys(t.ids).map(Number); gr = t.gr;
        if (!ids.length && !Object.keys(gr).length) break;
        V.marquer();
        if (ids.length) G.retirer(V.doc, ids);
        V.doc.grisaille = V.doc.grisaille.filter(function (s, j) { return !gr[j]; });
        V.change(true);
        n = ids.length + Object.keys(gr).length;
        U.dire(ids.length ? (ids.length > 1 ? ids.length + ' plombs retirés' : 'Plomb retiré') + ' : les pièces voisines se rejoignent.' : 'Grisaille effacée.');
        break;
      case 'grisaille':
        pts = simplifier(t.pts, 0.6 / U.z).map(function (p) { return [G.r2(p.x), G.r2(p.y)]; });
        V.marquer();
        V.doc.grisaille.push({ l: U.largeurGrisaille, pts: pts });
        V.change(false);
        break;
    }
    U.redessiner();
  }

  // Ramer-Douglas-Peucker : garde les points qui comptent dans un tracé à main levée.
  function simplifier(pts, tol) {
    if (pts.length < 3) return pts;
    var garde = new Uint8Array(pts.length), pile = [[0, pts.length - 1]], a, b, i, d, m, k;
    garde[0] = garde[pts.length - 1] = 1;
    while (pile.length) {
      k = pile.pop(); a = pts[k[0]]; b = pts[k[1]]; m = 0; d = -1;
      for (i = k[0] + 1; i < k[1]; i++) {
        var dd = G.projeter([{ x: a.x, y: a.y, t: 0 }, { x: b.x, y: b.y, t: 1 }], pts[i]).d;
        if (dd > d) { d = dd; m = i; }
      }
      if (d > tol) { garde[m] = 1; pile.push([k[0], m], [m, k[1]]); }
    }
    return pts.filter(function (p, j) { return garde[j]; });
  }

  function molette(e) {
    var q = plan(e);
    e.preventDefault();
    if (e.deltaY) U.zoomPas(e.deltaY < 0 ? 1 : -1, q.sx, q.sy);
  }

  // ---------- Outils ----------
  U.choisirOutil = function (id) {
    var o = U.OUTILS.filter(function (x) { return x.id === id; })[0] || (id === 'contour' ? CONTOUR : U.OUTILS[0]), b = document.querySelectorAll('.outil'), i;
    if (id === 'contour' && U.outil !== 'contour') U.avantContour = U.outil;
    U.finirChaine();
    U.outil = o.id; U.survol = null; U.curseur = null;
    scene.dataset.outil = o.id;
    for (i = 0; i < b.length; i++) b[i].classList.toggle('actif', b[i].dataset.outil === o.id);
    $('#astuce').textContent = o.astuce;
    $('#nomOutil').textContent = o.nom;
    U.redessiner();
  };
  U.choisirVue = function (v) {
    var b = document.querySelectorAll('[data-vue]'), i;
    U.vue = v;
    for (i = 0; i < b.length; i++) { b[i].classList.toggle('actif', b[i].dataset.vue === v); b[i].setAttribute('aria-checked', b[i].dataset.vue === v); }
    document.body.dataset.vue = v;
    U.redessiner();
  };

  U.initVue = function () {
    scene = $('#scene'); toile = $('#toile'); g = toile.getContext('2d');
    $('#outils').innerHTML = U.OUTILS.map(function (o) {
      return '<button type="button" class="outil" data-outil="' + o.id + '" title="' + o.nom + ' (' + o.touche.toUpperCase() + ')" aria-label="' + o.nom + '">' + icone(o.svg) + '</button>';
    }).join('');
    scene.addEventListener('pointerdown', bas);
    scene.addEventListener('pointermove', bouge);
    scene.addEventListener('pointerup', haut);
    scene.addEventListener('pointercancel', function (e) { if (geste && (geste.pid === undefined || e.pointerId === geste.pid)) U.abandonnerGeste(); });
    scene.addEventListener('pointerleave', function () { if (!geste) { $('#etatPos').textContent = '–'; U.survol = null; U.curseur = null; U.redessiner(); } });
    scene.addEventListener('wheel', molette, { passive: false });
    scene.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    scene.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    $('#outils').addEventListener('click', function (e) {
      var b = e.target.closest('.outil');
      if (b) U.choisirOutil(b.dataset.outil);
    });
    window.addEventListener('resize', U.redessiner);
    if (window.ResizeObserver) new ResizeObserver(U.redessiner).observe(scene);
  };
})();
