(function () {
  'use strict';

  var MAX = 8;        // grossissement le plus fort, par rapport à la planche entière
  var BORD = 28;      // table qu'on laisse voir, en pixels, quand la planche déborde du cadre
  var SEUIL = 4;      // en deçà, un glisser est un clic

  // ---------- Vue ----------
  // Une planche carrée de px unités, posée sur une table (cadre) et regardée de plus ou moins près.
  // o.cadre : la table ; o.feuille : l'élément qui porte le dessin ; o.px : côté de la planche ;
  // o.marge() : place réservée sur la table { l, t, r, b } ; o.glisse(e) : ce pointeur déplace-t-il la vue ? ;
  // o.clic(e) : un glisser resté sur place ; o.saisie() : un geste à deux doigts commence ; o.change(v) : la vue a bougé ;
  // o.loupe : élément dont les [data-loupe] commandent la vue ; o.mention : où écrire le grossissement.
  function create(o) {
    var cadre = o.cadre, feuille = o.feuille, PX = o.px || 1000;
    var v = { k: 1, x: 0, y: 0, k0: 1, zoom: 1, px: PX };
    var drag = null, doigts = {}, pince = null;

    function zone() {
      var m = o.marge ? o.marge() : null, w = cadre.clientWidth, h = cadre.clientHeight;
      m = m || { l: 0, t: 0, r: 0, b: 0 };
      return { x: m.l, y: m.t, w: Math.max(40, w - m.l - m.r), h: Math.max(40, h - m.t - m.b) };
    }
    function clamp(z) {
      var size = PX * v.k;
      v.x = size <= z.w ? z.x + (z.w - size) / 2 : Math.min(z.x + BORD, Math.max(z.x + z.w - size - BORD, v.x));
      v.y = size <= z.h ? z.y + (z.h - size) / 2 : Math.min(z.y + BORD, Math.max(z.y + z.h - size - BORD, v.y));
    }
    function apply() {
      var z = zone(), size;
      v.k0 = Math.min(z.w, z.h) / PX;
      v.k = Math.min(v.k0 * MAX, Math.max(v.k0, v.k));
      clamp(z);
      v.zoom = v.k / v.k0;
      size = (PX * v.k).toFixed(2) + 'px';
      feuille.style.width = size; feuille.style.height = size;
      feuille.style.transform = 'translate(' + v.x.toFixed(2) + 'px,' + v.y.toFixed(2) + 'px)';
      if (o.mention) o.mention.textContent = '×' + (Math.round(v.zoom * 10) / 10).toString().replace('.', ',');
      cadre.classList.toggle('de-pres', v.zoom > 1.01);
      if (o.change) o.change(v);
    }

    // Grossit de f autour du point (cx, cy) du cadre.
    v.loupe = function (f, cx, cy) {
      var z = zone(), k = Math.min(v.k0 * MAX, Math.max(v.k0, v.k * f));
      if (cx === undefined) { cx = z.x + z.w / 2; cy = z.y + z.h / 2; }
      v.x = cx - (cx - v.x) * k / v.k; v.y = cy - (cy - v.y) * k / v.k; v.k = k;
      apply();
    };
    v.entier = function () { v.k = 0; apply(); };
    v.pousse = function (dx, dy) { v.x += dx; v.y += dy; apply(); };
    // Point du plan sous un point de l'écran.
    v.point = function (e) {
      var r = cadre.getBoundingClientRect();
      return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
    };
    // Position à l'écran d'un point du plan (pour les essais et les étiquettes).
    v.ecran = function (x, y) {
      var r = cadre.getBoundingClientRect();
      return { x: r.left + v.x + x * v.k, y: r.top + v.y + y * v.k };
    };
    // Met une toile à la taille du cadre, au pixel de l'écran ; dit si elle a changé.
    v.ajuste = function (canvas) {
      var d = window.devicePixelRatio || 1, w = Math.max(1, Math.round(cadre.clientWidth * d)), h = Math.max(1, Math.round(cadre.clientHeight * d));
      v.dpr = d;
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h;
      return true;
    };
    // Après cela, la toile se dessine en unités du plan.
    v.repere = function (ctx) {
      var d = v.dpr || window.devicePixelRatio || 1;
      ctx.setTransform(d * v.k, 0, 0, d * v.k, d * v.x, d * v.y);
    };
    v.rafraichit = apply;

    // ---------- Gestes ----------
    function surPlanche(e) {
      var t = e.target;
      return t === cadre || t.tagName === 'CANVAS' || feuille.contains(t);
    }
    function local(e) {
      var r = cadre.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function deux() {
      var ids = Object.keys(doigts), a = doigts[ids[0]], b = doigts[ids[1]];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(1, Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))) };
    }

    cadre.addEventListener('pointerdown', function (e) {
      var p;
      if (!surPlanche(e)) return;
      p = local(e);
      if (e.pointerType === 'touch') {
        doigts[e.pointerId] = p;
        if (Object.keys(doigts).length === 2) {
          if (o.saisie) o.saisie();
          drag = null;
          pince = deux();
          e.stopPropagation(); e.preventDefault();
          return;
        }
      }
      if (pince) { e.stopPropagation(); return; }
      if (e.button === 1 || (o.glisse && o.glisse(e))) {
        drag = { id: e.pointerId, x: p.x, y: p.y, moved: false, e: e };
        try { cadre.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
        cadre.classList.add('glisse');
        e.stopPropagation(); e.preventDefault();
      }
    }, true);

    cadre.addEventListener('pointermove', function (e) {
      var p = local(e), g;
      if (e.pointerType === 'touch' && doigts[e.pointerId]) doigts[e.pointerId] = p;
      if (pince) {
        if (Object.keys(doigts).length === 2) {
          g = deux();
          v.x += g.x - pince.x; v.y += g.y - pince.y;
          v.loupe(g.d / pince.d, g.x, g.y);
          pince = g;
        }
        e.stopPropagation();
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved && Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) < SEUIL) { e.stopPropagation(); return; }
      drag.moved = true;
      v.pousse(p.x - drag.x, p.y - drag.y);
      drag.x = p.x; drag.y = p.y;
      e.stopPropagation();
    }, true);

    function fin(e) {
      var d = drag;
      if (e.pointerType === 'touch') delete doigts[e.pointerId];
      if (pince) {
        if (!Object.keys(doigts).length) pince = null;
        e.stopPropagation();
        return;
      }
      if (!d || d.id !== e.pointerId) return;
      drag = null;
      cadre.classList.remove('glisse');
      try { cadre.releasePointerCapture(e.pointerId); } catch (err) { /* déjà relâché */ }
      e.stopPropagation();
      if (!d.moved && e.type === 'pointerup' && o.clic) o.clic(d.e);
    }
    cadre.addEventListener('pointerup', fin, true);
    cadre.addEventListener('pointercancel', fin, true);
    // Le clic milieu ne doit ni lancer le défilement automatique ni coller le presse-papiers.
    cadre.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    cadre.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });

    cadre.addEventListener('wheel', function (e) {
      var p = local(e), dy = e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1);
      e.preventDefault();
      v.loupe(Math.exp(-Math.max(-240, Math.min(240, dy)) * (e.ctrlKey ? 0.01 : 0.0022)), p.x, p.y);
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
      var tag = e.target && e.target.tagName;
      if (e.key === 'Shift') cadre.classList.add('maj');
      if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === '0' || e.key === 'Home') v.entier();
      else if (e.key === '+' || e.key === '=') v.loupe(1.4);
      else if (e.key === '-') v.loupe(1 / 1.4);
      else return;
      e.preventDefault();
    });
    document.addEventListener('keyup', function (e) { if (e.key === 'Shift') cadre.classList.remove('maj'); });
    window.addEventListener('blur', function () { cadre.classList.remove('maj'); });

    if (o.loupe) {
      o.loupe.addEventListener('click', function (e) {
        var b = e.target.closest('[data-loupe]'), a;
        if (!b) return;
        a = b.getAttribute('data-loupe');
        if (a === 'entier') v.entier(); else v.loupe(a === 'plus' ? 1.5 : 1 / 1.5);
        if (e.detail) b.blur();
      });
    }

    // Quand la table change de taille, la planche entière le reste ; une vue grossie garde son échelle.
    function resize() { if (v.zoom <= 1.01) v.entier(); else apply(); }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(cadre);
    else window.addEventListener('resize', resize);

    v.entier();
    return v;
  }

  window.VuePlanche = { create: create, MAX: MAX };
})();
