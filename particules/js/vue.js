(function () {
  'use strict';

  var B = window.Banc, M = window.Particules;

  var ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];
  var MARGE = 32;            // ce qu'on voit autour du sprite, en pixels du sprite
  var DEHORS = '#28292b';
  var FONDS = { gris: '#3c3d41', nuit: '#0f1219', jour: '#c8ced6' };
  var BRAISE = '#f0762e', BRAISE_CLAIRE = '#ffc46b';
  var VISEE = 8;             // tolérance de visée des poignées, en pixels d'écran

  var $ = function (s) { return document.querySelector(s); };

  // L'état de l'interface. f : image en cours. emetteurs : montrer les émetteurs et leurs poignées.
  var U = B.ui = { f: 0, z: 8, cx: 0, cy: 0, espace: false, joue: false, fond: 'gris', emetteurs: true };

  var scene, toile, g, geste = null, demande = false, survol = null;

  // ---------- Vue ----------
  U.redessiner = function () {
    if (demande) return;
    demande = true;
    requestAnimationFrame(function () { demande = false; dessiner(); });
  };

  U.ajuster = function () {
    var d = B.doc, W = scene.clientWidth, H = scene.clientHeight, z = ZOOMS[0], i;
    for (i = 0; i < ZOOMS.length; i++) if (d.w * ZOOMS[i] <= W - 80 && d.h * ZOOMS[i] <= H - 80) z = ZOOMS[i];
    U.z = z; U.cx = Math.round((W - d.w * z) / 2); U.cy = Math.round((H - d.h * z) / 2);
    U.redessiner();
  };

  // Change le zoom en gardant sous le curseur le point du sprite qui s'y trouve.
  function zoomer(z, sx, sy) {
    var x = (sx - U.cx) / U.z, y = (sy - U.cy) / U.z;
    U.z = z; U.cx = Math.round(sx - x * z); U.cy = Math.round(sy - y * z);
    U.redessiner();
  }
  U.zoomPas = function (sens, sx, sy) {
    var i = ZOOMS.indexOf(U.z), j = B.borne((i < 0 ? 6 : i) + sens, 0, ZOOMS.length - 1);
    if (sx === undefined) { sx = scene.clientWidth / 2; sy = scene.clientHeight / 2; }
    zoomer(ZOOMS[j], sx, sy);
  };

  function plan(e) {
    var r = scene.getBoundingClientRect();
    return { x: (e.clientX - r.left - U.cx) / U.z, y: (e.clientY - r.top - U.cy) / U.z, sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function ecran(x, y) { return { x: U.cx + x * U.z, y: U.cy + y * U.z }; }

  // ---------- Images ----------
  var damier = null, zone = { cle: '', toile: null };
  function motif() {
    var c, k;
    if (damier) return damier;
    c = document.createElement('canvas'); c.width = c.height = 16; k = c.getContext('2d');
    k.fillStyle = '#8a8a8a'; k.fillRect(0, 0, 16, 16);
    k.fillStyle = '#6e6e6e'; k.fillRect(8, 0, 8, 8); k.fillRect(0, 8, 8, 8);
    return (damier = g.createPattern(c, 'repeat'));
  }
  // Ce qui sort du sprite : calculé sur une marge autour, montré pâle parce que l'export le coupera.
  function large(f) {
    var d = B.doc, cle = B.rev + ':' + f, W = d.w + 2 * MARGE, H = d.h + 2 * MARGE;
    if (zone.cle !== cle) { zone.cle = cle; zone.toile = M.versToile(M.image(B.plan(), f, -MARGE, -MARGE, W, H), W, H); }
    return zone.toile;
  }

  // ---------- Dessin ----------
  // Les points remarquables de l'émetteur de la couche c, en pixels d'écran.
  function geometrie(c) {
    var em = c.emetteur, z = U.z, o = ecran(em.x, em.y), r = em.rot * Math.PI / 180, co = Math.cos(r), si = Math.sin(r), a, lg, t = null;
    if (em.forme === 'ligne') t = { x: o.x + co * em.l / 2 * z, y: o.y + si * em.l / 2 * z };
    else if (em.forme === 'cercle') t = { x: o.x + em.l / 2 * z, y: o.y };
    else if (em.forme === 'rect') t = { x: o.x + (co * em.l / 2 - si * em.h / 2) * z, y: o.y + (si * em.l / 2 + co * em.h / 2) * z };
    a = c.angle * Math.PI / 180;
    lg = B.borne(c.vitesse * 0.3 * z, 26, 110);
    return { o: o, taille: t, dir: c.radial ? null : { x: o.x + Math.sin(a) * lg, y: o.y - Math.cos(a) * lg }, lg: lg, co: co, si: si };
  }

  function contour(c, choisie) {
    var em = c.emetteur, z = U.z, q = geometrie(c), o = q.o;
    g.beginPath();
    if (em.forme === 'ligne') {
      g.moveTo(o.x - q.co * em.l / 2 * z, o.y - q.si * em.l / 2 * z); g.lineTo(o.x + q.co * em.l / 2 * z, o.y + q.si * em.l / 2 * z);
    } else if (em.forme === 'cercle') g.arc(o.x, o.y, Math.max(1, em.l / 2 * z), 0, 6.2832);
    else if (em.forme === 'rect') {
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s, i) {
        var x = s[0] * em.l / 2 * z, y = s[1] * em.h / 2 * z;
        g[i ? 'lineTo' : 'moveTo'](o.x + x * q.co - y * q.si, o.y + x * q.si + y * q.co);
      });
      g.closePath();
    }
    g.lineWidth = choisie ? 1.5 : 1;
    g.setLineDash(choisie && !em.contour ? [] : [4, 3]);
    g.strokeStyle = choisie ? BRAISE : 'rgba(255, 255, 255, .4)';
    if (em.forme !== 'point') g.stroke();
    g.setLineDash([]);
    return q;
  }

  // La direction de départ et sa dispersion : une flèche dont on saisit la pointe.
  function direction(c, q) {
    var a = c.angle * Math.PI / 180, dp = c.dispersion * Math.PI / 360, o = q.o, l = q.lg * 0.8, i;
    g.strokeStyle = 'rgba(240, 118, 46, .55)'; g.lineWidth = 1;
    if (c.radial) {
      for (i = 0; i < 8; i++) {
        a = i * Math.PI / 4;
        g.beginPath(); g.moveTo(o.x + Math.sin(a) * 9, o.y - Math.cos(a) * 9); g.lineTo(o.x + Math.sin(a) * 17, o.y - Math.cos(a) * 17); g.stroke();
      }
      return;
    }
    if (c.dispersion >= 359) { g.setLineDash([2, 3]); g.beginPath(); g.arc(o.x, o.y, l, 0, 6.2832); g.stroke(); g.setLineDash([]); }
    else if (c.dispersion > 0) {
      g.beginPath();
      g.moveTo(o.x + Math.sin(a - dp) * l, o.y - Math.cos(a - dp) * l); g.lineTo(o.x, o.y); g.lineTo(o.x + Math.sin(a + dp) * l, o.y - Math.cos(a + dp) * l);
      g.stroke();
    }
    g.strokeStyle = BRAISE; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(q.dir.x, q.dir.y); g.stroke();
    // Pointe de flèche.
    g.beginPath();
    g.moveTo(q.dir.x, q.dir.y);
    g.lineTo(q.dir.x - Math.sin(a - 0.45) * 8, q.dir.y + Math.cos(a - 0.45) * 8);
    g.lineTo(q.dir.x - Math.sin(a + 0.45) * 8, q.dir.y + Math.cos(a + 0.45) * 8);
    g.closePath(); g.fillStyle = survol === 'angle' ? BRAISE_CLAIRE : BRAISE; g.fill();
  }

  // Le centre de l'émetteur choisi : une braise en losange, ce qu'on saisit pour le déplacer.
  function centre(o, choisie) {
    var r = choisie ? 6 : 3.5;
    g.beginPath(); g.moveTo(o.x, o.y - r); g.lineTo(o.x + r, o.y); g.lineTo(o.x, o.y + r); g.lineTo(o.x - r, o.y); g.closePath();
    g.fillStyle = choisie ? (survol === 'centre' ? BRAISE_CLAIRE : BRAISE) : 'rgba(255, 255, 255, .55)'; g.fill();
    if (choisie) { g.lineWidth = 1; g.strokeStyle = '#2a1206'; g.stroke(); g.fillStyle = '#fff3c4'; g.fillRect(Math.round(o.x) - 1, Math.round(o.y) - 1, 2, 2); }
  }

  function dessiner() {
    var dpr = window.devicePixelRatio || 1, W = scene.clientWidth, H = scene.clientHeight, d = B.doc, z = U.z, x, y, sol, c, q;
    if (!W || !H || !d) return;
    if (toile.width !== Math.round(W * dpr) || toile.height !== Math.round(H * dpr)) { toile.width = Math.round(W * dpr); toile.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = DEHORS; g.fillRect(0, 0, W, H);

    g.fillStyle = U.fond === 'damier' ? motif() : FONDS[U.fond];
    g.fillRect(U.cx, U.cy, d.w * z, d.h * z);
    // La grille des pixels, seulement de près.
    if (z >= 10) {
      g.fillStyle = U.fond === 'jour' ? 'rgba(0, 0, 0, .06)' : 'rgba(255, 255, 255, .05)';
      for (x = 1; x < d.w; x++) g.fillRect(U.cx + x * z, U.cy, 1, d.h * z);
      for (y = 1; y < d.h; y++) g.fillRect(U.cx, U.cy + y * z, d.w * z, 1);
    }
    g.globalAlpha = 0.3;
    g.drawImage(large(U.f), U.cx - MARGE * z, U.cy - MARGE * z, (d.w + 2 * MARGE) * z, (d.h + 2 * MARGE) * z);
    g.globalAlpha = 1;
    g.drawImage(M.versToile(B.image(U.f), d.w, d.h), U.cx, U.cy, d.w * z, d.h * z);

    g.strokeStyle = 'rgba(220, 220, 222, .7)'; g.lineWidth = 1;
    g.strokeRect(U.cx - 0.5, U.cy - 0.5, d.w * z + 1, d.h * z + 1);
    g.fillStyle = '#909197'; g.font = '11px "Segoe UI", sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillText('Sprite de ' + d.w + ' × ' + d.h + ' px, image ' + (U.f + 1) + ' sur ' + d.images, U.cx, U.cy + d.h * z + 6);

    // Le sol : une ligne tiretée qui déborde du sprite, saisie par son étiquette.
    if (d.sol.actif) {
      sol = ecran(0, d.sol.y).y;
      g.strokeStyle = survol === 'sol' ? '#ffffff' : 'rgba(210, 210, 214, .75)'; g.lineWidth = 1; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(U.cx - MARGE * z, Math.round(sol) + 0.5); g.lineTo(U.cx + (d.w + MARGE) * z, Math.round(sol) + 0.5); g.stroke();
      g.setLineDash([]);
      g.fillStyle = survol === 'sol' ? '#ffffff' : '#c8c8cc'; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText('sol', U.cx - 8, sol);
    }

    if (!U.emetteurs) return;
    d.couches.forEach(function (cc, i) {
      if (i === B.ic || !cc.visible) return;
      q = contour(cc, false); centre(q.o, false);
    });
    c = B.couche();
    q = contour(c, true);
    direction(c, q);
    if (q.taille) {
      g.fillStyle = survol === 'taille' ? BRAISE_CLAIRE : '#1b1c1e'; g.strokeStyle = BRAISE; g.lineWidth = 1.5;
      g.fillRect(q.taille.x - 3.5, q.taille.y - 3.5, 7, 7); g.strokeRect(q.taille.x - 3.5, q.taille.y - 3.5, 7, 7);
    }
    centre(q.o, true);
  }

  // ---------- Gestes ----------
  U.gesteEnCours = function () { return !!geste; };

  function viser(q) {
    var d = B.doc, c = B.couche(), p, i, cc, o, v;
    function pres(a, r) { return a && Math.abs(a.x - q.sx) <= (r || VISEE) && Math.abs(a.y - q.sy) <= (r || VISEE); }
    if (U.emetteurs) {
      p = geometrie(c);
      // Sur un petit émetteur, les poignées se chevauchent : la plus proche du curseur l'emporte.
      v = [['taille', p.taille, VISEE], ['centre', p.o, VISEE], ['angle', p.dir, 10]].filter(function (h) { return pres(h[1], h[2]); });
      v.sort(function (a, b) { return Math.hypot(a[1].x - q.sx, a[1].y - q.sy) - Math.hypot(b[1].x - q.sx, b[1].y - q.sy); });
      if (v.length) return { type: v[0][0] };
      for (i = d.couches.length - 1; i >= 0; i--) {
        cc = d.couches[i];
        if (i === B.ic || !cc.visible) continue;
        o = ecran(cc.emetteur.x, cc.emetteur.y);
        if (pres(o)) return { type: 'centre', couche: i };
      }
    }
    if (d.sol.actif && Math.abs(ecran(0, d.sol.y).y - q.sy) <= 5 && q.x >= -MARGE && q.x <= d.w + MARGE) return { type: 'sol' };
    return null;
  }

  function bas(e) {
    var q = plan(e), v, c;
    if (geste || (e.button !== 0 && e.button !== 1)) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    scene.setPointerCapture(e.pointerId);
    v = e.button === 0 && !U.espace ? viser(q) : null;
    if (!v) {
      // Un clic gauche dans le vide déplace aussi la vue : il n'y a rien d'autre à faire sur la toile.
      geste = { type: 'main', sx: q.sx, sy: q.sy, cx: U.cx, cy: U.cy };
      scene.classList.add('saisie');
      e.preventDefault();
      return;
    }
    if (v.couche !== undefined) { U.choisirCouche(v.couche); }
    c = B.couche();
    geste = { type: v.type, x: q.x, y: q.y, ex: c.emetteur.x, ey: c.emetteur.y, sol: B.doc.sol.y };
    scene.classList.add('poignee');
  }

  function entamer() { if (!geste.entame) { B.marquer(); geste.entame = true; } }

  function bouge(e) {
    var q = plan(e), t = geste, c = B.couche(), em = c.emetteur, dx, dy, a, v, r, co, si;
    $('#etatPos').textContent = Math.floor(q.x) + ', ' + Math.floor(q.y);
    if (!t) {
      v = viser(q);
      v = v ? v.type : null;
      if (v !== survol) { survol = v; scene.classList.toggle('poignee', !!v); U.redessiner(); }
      return;
    }
    if (t.type === 'main') { U.cx = t.cx + Math.round(q.sx - t.sx); U.cy = t.cy + Math.round(q.sy - t.sy); U.redessiner(); return; }
    dx = q.x - em.x; dy = q.y - em.y;
    if (t.type === 'centre') {
      v = { x: Math.round(t.ex + q.x - t.x), y: Math.round(t.ey + q.y - t.y) };
      if (v.x === em.x && v.y === em.y) return;
      entamer(); em.x = v.x; em.y = v.y;
    } else if (t.type === 'sol') {
      v = Math.round(t.sol + q.y - t.y);
      if (v === B.doc.sol.y) return;
      entamer(); B.doc.sol.y = v;
    } else if (t.type === 'angle') {
      a = Math.atan2(dx, -dy) * 180 / Math.PI;
      a = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a);
      if (a === c.angle) return;
      entamer(); c.angle = a;
    } else if (t.type === 'taille') {
      if (em.forme === 'ligne') {
        a = Math.atan2(dy, dx) * 180 / Math.PI;
        a = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a);
        v = Math.round(2 * Math.sqrt(dx * dx + dy * dy));
        if (v === em.l && a === em.rot) return;
        entamer(); em.l = v; em.rot = a;
      } else if (em.forme === 'cercle') {
        v = Math.round(2 * Math.sqrt(dx * dx + dy * dy));
        if (v === em.l) return;
        entamer(); em.l = v;
      } else {
        r = em.rot * Math.PI / 180; co = Math.cos(r); si = Math.sin(r);
        v = { l: Math.round(2 * Math.abs(dx * co + dy * si)), h: Math.round(2 * Math.abs(-dx * si + dy * co)) };
        if (v.l === em.l && v.h === em.h) return;
        entamer(); em.l = v.l; em.h = v.h;
      }
    }
    B.change();
  }

  function haut() {
    var t = geste;
    if (!t) return;
    geste = null;
    scene.classList.remove('saisie');
    scene.classList.toggle('main', U.espace);
    U.redessiner();
  }

  function molette(e) {
    var q = plan(e);
    e.preventDefault();
    if (e.deltaY) U.zoomPas(e.deltaY < 0 ? 1 : -1, q.sx, q.sy);
  }

  U.choisirFond = function (f) {
    var b = document.querySelectorAll('#fonds button'), i;
    if (!FONDS[f] && f !== 'damier') return;
    U.fond = f;
    for (i = 0; i < b.length; i++) b[i].classList.toggle('actif', b[i].dataset.fond === f);
    U.redessiner();
  };
  U.FONDS = ['gris', 'nuit', 'jour', 'damier'];

  U.initVue = function () {
    scene = $('#scene'); toile = $('#toile'); g = toile.getContext('2d');
    scene.addEventListener('pointerdown', bas);
    scene.addEventListener('pointermove', bouge);
    scene.addEventListener('pointerup', haut);
    scene.addEventListener('pointercancel', haut);
    scene.addEventListener('pointerleave', function () { if (!geste) { $('#etatPos').textContent = '–'; if (survol) { survol = null; U.redessiner(); } } });
    scene.addEventListener('wheel', molette, { passive: false });
    scene.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Le clic milieu ne lance pas le défilement automatique du navigateur.
    scene.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    $('#fonds').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    $('#fonds').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fond]');
      if (b) { U.choisirFond(b.dataset.fond); if (U.surFond) U.surFond(); }
    });
    window.addEventListener('resize', U.redessiner);
    if (window.ResizeObserver) new ResizeObserver(U.redessiner).observe(scene);
  };
})();
