(function () {
  'use strict';

  var A = window.Atelier;

  // Une sélection : { x, y, w, h, masque, flot }.
  // masque (w × h) vaut 1 sur les pixels choisis. flot, s'il existe, contient des pixels détachés du
  // calque qui suivent la sélection jusqu'à ce qu'elle soit ancrée. Ces tableaux ne sont jamais
  // modifiés sur place : l'historique les partage.

  // ---------- Outils internes ----------
  function plein(w, h) { return new Uint8Array(w * h).fill(1); }

  // Fabrique une sélection à partir d'un masque de la taille du sprite.
  function depuisMasque(m) {
    var d = A.doc, x0 = d.w, y0 = d.h, x1 = -1, y1 = -1, x, y, w, h, o;
    for (y = 0; y < d.h; y++) {
      for (x = 0; x < d.w; x++) {
        if (!m[y * d.w + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    w = x1 - x0 + 1; h = y1 - y0 + 1;
    o = new Uint8Array(w * h);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) o[y * w + x] = m[(y0 + y) * d.w + x0 + x];
    return { x: x0, y: y0, w: w, h: h, masque: o, flot: null };
  }

  // Masque de la taille du sprite, ou null sans sélection.
  A.selMasquePlein = function () {
    var d = A.doc, s = d.sel, m, i, j, X, Y;
    if (!s) return null;
    m = new Uint8Array(d.w * d.h);
    for (j = 0; j < s.h; j++) {
      Y = s.y + j;
      if (Y < 0 || Y >= d.h) continue;
      for (i = 0; i < s.w; i++) {
        X = s.x + i;
        if (X >= 0 && X < d.w && s.masque[j * s.w + i]) m[Y * d.w + X] = 1;
      }
    }
    return m;
  };

  A.selContient = function (x, y) {
    var s = A.doc.sel;
    if (!s) return false;
    x -= s.x; y -= s.y;
    return x >= 0 && y >= 0 && x < s.w && y < s.h && !!s.masque[y * s.w + x];
  };

  function poser(buf, s) {
    var d = A.doc, i, j, X, Y, k;
    for (j = 0; j < s.h; j++) {
      Y = s.y + j;
      if (Y < 0 || Y >= d.h) continue;
      for (i = 0; i < s.w; i++) {
        X = s.x + i; k = j * s.w + i;
        if (X >= 0 && X < d.w && s.masque[k] && s.flot[k]) buf[Y * d.w + X] = A.sur(buf[Y * d.w + X], s.flot[k]);
      }
    }
  }

  // Le celluloïd actif tel qu'il sera une fois la sélection flottante posée.
  A.celAvecFlot = function () {
    var d = A.doc, b = A.celLire(d.iImage, d.iCalque);
    b = b ? new Uint32Array(b) : new Uint32Array(d.w * d.h);
    poser(b, d.sel);
    return b;
  };

  // Pose les pixels flottants sur le calque actif. Ne valide pas : rend vrai s'il y avait quelque chose à poser.
  A.selAncrer = function () {
    var d = A.doc, s = d.sel;
    if (!s || !s.flot) return false;
    poser(A.celEcrire(d.iImage, d.iCalque), s);
    s.flot = null;
    d.sel = depuisMasque(A.selMasquePlein());
    return true;
  };

  // Détache du calque actif les pixels sélectionnés.
  function soulever() {
    var d = A.doc, s = d.sel, src, buf, flot, i, j, p;
    if (s.flot) return;
    flot = new Uint32Array(s.w * s.h);
    src = A.celLire(d.iImage, d.iCalque);
    if (src && !A.tamponVide(src)) {
      buf = A.celEcrire(d.iImage, d.iCalque);
      for (j = 0; j < s.h; j++) {
        for (i = 0; i < s.w; i++) {
          if (!s.masque[j * s.w + i]) continue;
          p = (s.y + j) * d.w + s.x + i;
          flot[j * s.w + i] = buf[p];
          buf[p] = 0;
        }
      }
    }
    d.sel = { x: s.x, y: s.y, w: s.w, h: s.h, masque: s.masque, flot: flot };
  }

  function remplacer(sel, nom) {
    A.selAncrer();
    A.doc.sel = sel;
    A.valider(nom);
  }

  // ---------- Sélectionner ----------
  A.selRect = function (x0, y0, x1, y1) {
    var d = A.doc;
    var xa = Math.max(0, Math.min(x0, x1)), ya = Math.max(0, Math.min(y0, y1));
    var xb = Math.min(d.w - 1, Math.max(x0, x1)), yb = Math.min(d.h - 1, Math.max(y0, y1));
    if (xb < xa || yb < ya) return A.selAucune();
    remplacer({ x: xa, y: ya, w: xb - xa + 1, h: yb - ya + 1, masque: plein(xb - xa + 1, yb - ya + 1), flot: null }, 'Sélection');
    return true;
  };

  A.selBaguette = function (x, y, contigu) {
    var d = A.doc, b;
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return A.selAucune();
    A.selAncrer();
    b = A.celLire(d.iImage, d.iCalque) || new Uint32Array(d.w * d.h);
    d.sel = depuisMasque(A.zone(b, d.w, d.h, x, y, contigu, null));
    A.valider('Baguette magique');
    return true;
  };

  A.selTout = function (sansValider) {
    if (sansValider) { A.doc.sel = { x: 0, y: 0, w: A.doc.w, h: A.doc.h, masque: plein(A.doc.w, A.doc.h), flot: null }; return; }
    remplacer({ x: 0, y: 0, w: A.doc.w, h: A.doc.h, masque: plein(A.doc.w, A.doc.h), flot: null }, 'Tout sélectionner');
  };

  A.selAucune = function () {
    if (!A.doc.sel) return false;
    remplacer(null, 'Désélectionner');
    return true;
  };

  // ---------- Déplacer et transformer ----------
  // Avec sansValider, l'appelant valide lui-même à la fin du geste.
  A.selDeplacer = function (dx, dy, sansValider) {
    var s = A.doc.sel, refus;
    if (!s) return 'Aucune sélection.';
    if (!s.flot) {
      refus = A.calqueLibre();
      if (refus) return refus;
      soulever();
      s = A.doc.sel;
    }
    A.doc.sel = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h, masque: s.masque, flot: s.flot };
    if (!sansValider) A.valider('Déplacer la sélection');
    return '';
  };

  A.selSupprimer = function () {
    var d = A.doc, s = d.sel;
    if (!s) return 'Aucune sélection.';
    if (s.flot) {
      d.sel = null;
      A.valider('Supprimer');
      return '';
    }
    return A.modifier('Supprimer', function (buf, base, clip) {
      var change = false, i;
      for (i = 0; i < buf.length; i++) if (clip[i] && buf[i]) { buf[i] = 0; change = true; }
      return change;
    });
  };

  // Copie la sélection, ou tout le celluloïd actif s'il n'y en a pas.
  A.selCopier = function () {
    var d = A.doc, s = d.sel, src, pix, i, j, p;
    if (s && s.flot) {
      A.pressePapier = { x: s.x, y: s.y, w: s.w, h: s.h, masque: s.masque, pix: s.flot };
      return true;
    }
    src = A.celLire(d.iImage, d.iCalque);
    if (!s) s = { x: 0, y: 0, w: d.w, h: d.h, masque: plein(d.w, d.h) };
    pix = new Uint32Array(s.w * s.h);
    if (src) {
      for (j = 0; j < s.h; j++) {
        for (i = 0; i < s.w; i++) {
          p = j * s.w + i;
          if (s.masque[p]) pix[p] = src[(s.y + j) * d.w + s.x + i];
        }
      }
    }
    A.pressePapier = { x: s.x, y: s.y, w: s.w, h: s.h, masque: s.masque, pix: pix };
    return true;
  };

  A.selCouper = function () {
    if (!A.doc.sel) return 'Aucune sélection.';
    var refus = A.calqueLibre();
    if (refus) return refus;
    A.selCopier();
    return A.selSupprimer();
  };

  A.selColler = function () {
    var c = A.pressePapier, d = A.doc, refus;
    if (!c) return 'Le presse-papiers est vide.';
    refus = A.calqueLibre();
    if (refus) return refus;
    A.selAncrer();
    // Un contenu collé hors de la toile serait introuvable : il revient dans le coin.
    var x = c.x < d.w && c.x + c.w > 0 ? c.x : 0, y = c.y < d.h && c.y + c.h > 0 ? c.y : 0;
    d.sel = { x: x, y: y, w: c.w, h: c.h, masque: c.masque, flot: c.pix };
    A.valider('Coller');
    return '';
  };

  // Retourne la sélection, ou le celluloïd actif s'il n'y en a pas.
  A.selRetourner = function (horizontal) {
    var d = A.doc, s = d.sel, refus = A.calqueLibre();
    if (refus) return refus;
    if (!s) {
      return A.modifier('Retourner', function (buf, base) {
        buf.set(A.retournerTampon(base, d.w, d.h, horizontal));
        return !A.tamponVide(base);
      });
    }
    soulever();
    s = d.sel;
    d.sel = {
      x: s.x, y: s.y, w: s.w, h: s.h,
      masque: A.retournerTampon(s.masque, s.w, s.h, horizontal), flot: A.retournerTampon(s.flot, s.w, s.h, horizontal)
    };
    A.valider('Retourner la sélection');
    return '';
  };

  // Tourne la sélection de 90° autour de son centre, ou tout le sprite s'il n'y en a pas.
  A.selPivoter = function (sens) {
    var d = A.doc, s = d.sel, refus;
    if (!s) { A.docPivoter(sens); return ''; }
    refus = A.calqueLibre();
    if (refus) return refus;
    soulever();
    s = d.sel;
    d.sel = {
      x: s.x + Math.floor((s.w - s.h) / 2), y: s.y + Math.floor((s.h - s.w) / 2), w: s.h, h: s.w,
      masque: A.pivoterTampon(s.masque, s.w, s.h, sens), flot: A.pivoterTampon(s.flot, s.w, s.h, sens)
    };
    A.valider('Pivoter la sélection');
    return '';
  };
})();
