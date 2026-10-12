(function () {
  'use strict';

  var TAILLE_MAX = 1024;                  // côté maximal d'un sprite, en pixels
  var HIST_MAX = 300;                     // profondeur de l'historique
  var HIST_OCTETS = 160 * 1024 * 1024;    // plafond mémoire des tampons retenus par l'historique
  var FORMAT = 'atelier-pixel';

  // Un pixel est un entier 0xAABBGGRR : c'est l'ordre des octets d'une ImageData.
  // Un pixel transparent vaut toujours 0.
  var A = window.Atelier = {
    TAILLE_MAX: TAILLE_MAX,
    doc: null,            // le sprite en cours
    palette: [],
    pressePapier: null,
    surChange: null       // appelé après chaque opération validée, annulée ou rétablie
  };

  // ---------- Couleurs ----------
  function rgba(r, g, b, a) {
    if (a === undefined) a = 255;
    if (a <= 0) return 0;
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  function comp(c) { return [c & 255, c >>> 8 & 255, c >>> 16 & 255, c >>> 24]; }

  // Pose s sur d (fusion alpha normale), avec une opacité facultative entre 0 et 1.
  function sur(d, s, op) {
    var sa = s >>> 24;
    if (op !== undefined && op < 1) sa = Math.round(sa * op);
    if (sa === 0) return d;
    var da = d >>> 24;
    if (sa === 255 || da === 0) return ((sa << 24) | (s & 0xffffff)) >>> 0;
    var k = da * (255 - sa) / 255, oa = sa + k;
    var r = Math.round(((s & 255) * sa + (d & 255) * k) / oa);
    var g = Math.round(((s >>> 8 & 255) * sa + (d >>> 8 & 255) * k) / oa);
    var b = Math.round(((s >>> 16 & 255) * sa + (d >>> 16 & 255) * k) / oa);
    return rgba(r, g, b, Math.round(oa));
  }

  function melange(c1, c2, t) {
    var a = comp(c1), b = comp(c2), al = a[3] + (b[3] - a[3]) * t, i, o = [];
    if (al <= 0) return 0;
    // Interpolation pondérée par l'alpha, pour ne pas ternir vers une couleur transparente.
    for (i = 0; i < 3; i++) o.push(Math.round((a[i] * a[3] * (1 - t) + b[i] * b[3] * t) / al));
    return rgba(o[0], o[1], o[2], Math.round(al));
  }

  function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
  function hexVers(c) {
    var p = comp(c);
    return '#' + hex2(p[0]) + hex2(p[1]) + hex2(p[2]) + (p[3] < 255 ? hex2(p[3]) : '');
  }
  function hexDepuis(s) {
    s = String(s).trim().replace(/^#/, '');
    if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
    if (s.length < 6) s = s.replace(/./g, '$&$&');
    var n = parseInt(s.slice(0, 6), 16);
    return rgba(n >> 16 & 255, n >> 8 & 255, n & 255, s.length === 8 ? parseInt(s.slice(6), 16) : 255);
  }

  function rgbVersHsv(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return { h: h * 60, s: max ? d / max : 0, v: max / 255 };
  }
  function hsvVersRgb(h, s, v) {
    var f = function (n) {
      var k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return [f(5), f(3), f(1)];
  }

  // Éclaircit (sens > 0) ou assombrit (sens < 0) en gardant la teinte.
  function lumiere(c, sens) {
    if (!c) return 0;
    var p = comp(c), t = rgbVersHsv(p[0], p[1], p[2]), v = t.v + sens * 0.1, s = t.s;
    if (v > 1) { s = Math.max(0, s - (v - 1) * 1.5); v = 1; }
    if (v < 0) v = 0;
    var q = hsvVersRgb(t.h, s, v);
    return rgba(q[0], q[1], q[2], p[3]);
  }

  A.rgba = rgba; A.comp = comp; A.sur = sur; A.melange = melange; A.lumiere = lumiere;
  A.hexVers = hexVers; A.hexDepuis = hexDepuis; A.rgbVersHsv = rgbVersHsv; A.hsvVersRgb = hsvVersRgb;

  // ---------- Document ----------
  // calques[0] est le calque du dessous. Chaque image range ses celluloïds par identifiant de calque.
  var idSuivant = 1;
  function nid() { return idSuivant++; }
  function borne(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dim(v) { return borne(Math.round(Number(v)) || 1, 1, TAILLE_MAX); }

  function creerCalque(nom) { return { id: nid(), nom: nom, visible: true, opacite: 1, verrou: false }; }
  function creerImage(duree) { return { id: nid(), duree: duree || 100, cels: {} }; }

  A.docNouveau = function (w, h) {
    A.doc = { w: dim(w), h: dim(h), calques: [creerCalque('Calque 1')], images: [creerImage(100)], iImage: 0, iCalque: 0, sel: null };
    histInit();
    signaler('Nouveau');
  };

  A.celLire = function (iImage, iCalque) {
    return A.doc.images[iImage].cels[A.doc.calques[iCalque].id] || null;
  };

  // Rend un tampon modifiable : un tampon figé (retenu par l'historique) est d'abord copié.
  A.celEcrire = function (iImage, iCalque) {
    var d = A.doc, cels = d.images[iImage].cels, id = d.calques[iCalque].id, b = cels[id];
    if (!b) b = cels[id] = new Uint32Array(d.w * d.h);
    else if (b.fige) b = cels[id] = new Uint32Array(b);
    return b;
  };

  A.calqueLibre = function () {
    var c = A.doc.calques[A.doc.iCalque];
    if (c.verrou) return 'Le calque « ' + c.nom + ' » est verrouillé.';
    if (!c.visible) return 'Le calque « ' + c.nom + ' » est masqué.';
    return '';
  };

  function vide(b) {
    for (var i = 0; i < b.length; i++) if (b[i]) return false;
    return true;
  }
  A.tamponVide = vide;

  // ---------- Historique ----------
  // Chaque état est une copie légère du document : les tampons de pixels sont partagés et figés,
  // seuls ceux qu'une opération modifie sont dupliqués.
  var hist = { pile: [], i: -1 };

  function copieEtat(d) {
    return {
      w: d.w, h: d.h, iImage: d.iImage, iCalque: d.iCalque,
      calques: d.calques.map(function (c) { return { id: c.id, nom: c.nom, visible: c.visible, opacite: c.opacite, verrou: c.verrou }; }),
      images: d.images.map(function (im) {
        var cels = {}, k;
        for (k in im.cels) cels[k] = im.cels[k];
        return { id: im.id, duree: im.duree, cels: cels };
      }),
      sel: d.sel ? { x: d.sel.x, y: d.sel.y, w: d.sel.w, h: d.sel.h, masque: d.sel.masque, flot: d.sel.flot } : null
    };
  }

  function instantane() {
    var s = copieEtat(A.doc), i, k;
    for (i = 0; i < s.images.length; i++) for (k in s.images[i].cels) s.images[i].cels[k].fige = true;
    return s;
  }

  function histInit() { hist.pile = [instantane()]; hist.i = 0; }

  function elaguer() {
    while (hist.pile.length > HIST_MAX) { hist.pile.shift(); hist.i--; }
    for (;;) {
      var vus = new Set(), octets = 0, i, j, k, b;
      for (i = 0; i < hist.pile.length; i++) {
        for (j = 0; j < hist.pile[i].images.length; j++) {
          for (k in hist.pile[i].images[j].cels) {
            b = hist.pile[i].images[j].cels[k];
            if (!vus.has(b)) { vus.add(b); octets += b.byteLength; }
          }
        }
      }
      if (octets <= HIST_OCTETS || hist.pile.length <= 2) return;
      hist.pile.shift(); hist.i--;
    }
  }

  function signaler(nom) { if (A.surChange) A.surChange(nom); }

  A.valider = function (nom) {
    hist.pile.length = hist.i + 1;
    hist.pile.push(instantane());
    hist.i++;
    elaguer();
    signaler(nom);
  };
  A.annuler = function () {
    if (hist.i <= 0) return false;
    hist.i--;
    A.doc = copieEtat(hist.pile[hist.i]);
    signaler('Annuler');
    return true;
  };
  A.retablir = function () {
    if (hist.i >= hist.pile.length - 1) return false;
    hist.i++;
    A.doc = copieEtat(hist.pile[hist.i]);
    signaler('Rétablir');
    return true;
  };
  // Abandonne ce qui n'a pas été validé : retour au dernier état de l'historique.
  A.revenir = function () {
    A.doc = copieEtat(hist.pile[hist.i]);
    signaler('Revenir');
  };
  A.histEtat = function () { return { avant: hist.i, apres: hist.pile.length - 1 - hist.i }; };

  // Changer d'image ou de calque n'est pas une étape d'historique : la position courante est
  // reportée dans l'état du dessus, pour qu'une annulation y revienne.
  function noterPosition() {
    hist.pile[hist.i].iImage = A.doc.iImage;
    hist.pile[hist.i].iCalque = A.doc.iCalque;
  }
  function ancrer() { if (A.selAncrer()) A.valider('Ancrer la sélection'); }

  A.allerImage = function (i) {
    i = borne(i, 0, A.doc.images.length - 1);
    if (i === A.doc.iImage) return;
    ancrer();
    A.doc.iImage = i;
    noterPosition();
  };
  A.allerCalque = function (i) {
    i = borne(i, 0, A.doc.calques.length - 1);
    if (i === A.doc.iCalque) return;
    ancrer();
    A.doc.iCalque = i;
    noterPosition();
  };

  // ---------- Calques ----------
  A.calqueAjouter = function (nom) {
    var d = A.doc;
    A.selAncrer();
    d.calques.splice(d.iCalque + 1, 0, creerCalque(nom || 'Calque ' + (d.calques.length + 1)));
    d.iCalque++;
    A.valider('Nouveau calque');
  };

  A.calqueSupprimer = function (i) {
    var d = A.doc, k;
    if (d.calques.length < 2) return false;
    A.selAncrer();
    var id = d.calques[i].id;
    d.calques.splice(i, 1);
    for (k = 0; k < d.images.length; k++) delete d.images[k].cels[id];
    if (d.iCalque > i || d.iCalque >= d.calques.length) d.iCalque--;
    A.valider('Supprimer le calque');
    return true;
  };

  A.calqueDupliquer = function (i) {
    var d = A.doc, src = d.calques[i], c = creerCalque(src.nom + ' copie'), k, b;
    A.selAncrer();
    c.visible = src.visible; c.opacite = src.opacite;
    for (k = 0; k < d.images.length; k++) {
      b = d.images[k].cels[src.id];
      if (b) { b.fige = true; d.images[k].cels[c.id] = b; }
    }
    d.calques.splice(i + 1, 0, c);
    d.iCalque = i + 1;
    A.valider('Dupliquer le calque');
  };

  A.calqueDeplacer = function (i, j) {
    var d = A.doc;
    j = borne(j, 0, d.calques.length - 1);
    if (i === j) return false;
    A.selAncrer();
    var actif = d.calques[d.iCalque];
    d.calques.splice(j, 0, d.calques.splice(i, 1)[0]);
    d.iCalque = d.calques.indexOf(actif);
    A.valider('Déplacer le calque');
    return true;
  };

  // cle : nom, visible, opacite ou verrou. Avec sansValider, l'étape d'historique est laissée à l'appelant.
  A.calqueRegler = function (i, cle, valeur, sansValider) {
    var c = A.doc.calques[i];
    if (cle === 'opacite') valeur = borne(Number(valeur) || 0, 0, 1);
    if (cle === 'nom') valeur = String(valeur).trim().slice(0, 40) || c.nom;
    if (c[cle] === valeur && !sansValider) return false;
    if (i === A.doc.iCalque && cle !== 'nom') A.selAncrer();
    c[cle] = valeur;
    if (!sansValider) A.valider('Calque : ' + cle);
    return true;
  };

  A.calqueFusionner = function (i) {
    var d = A.doc, k, n = d.w * d.h, p, haut, bas, op;
    if (i < 1) return false;
    A.selAncrer();
    op = d.calques[i].opacite;
    for (k = 0; k < d.images.length; k++) {
      haut = d.images[k].cels[d.calques[i].id];
      if (!haut) continue;
      bas = A.celEcrire(k, i - 1);
      for (p = 0; p < n; p++) if (haut[p]) bas[p] = sur(bas[p], haut[p], op);
      delete d.images[k].cels[d.calques[i].id];
    }
    d.calques.splice(i, 1);
    d.iCalque = i - 1;
    A.valider('Fusionner vers le bas');
    return true;
  };

  // ---------- Images ----------
  A.imageAjouter = function () {
    var d = A.doc;
    A.selAncrer();
    d.images.splice(d.iImage + 1, 0, creerImage(d.images[d.iImage].duree));
    d.iImage++;
    A.valider('Nouvelle image');
  };

  A.imageDupliquer = function (i) {
    var d = A.doc, src = d.images[i], im = creerImage(src.duree), k;
    A.selAncrer();
    for (k in src.cels) { src.cels[k].fige = true; im.cels[k] = src.cels[k]; }
    d.images.splice(i + 1, 0, im);
    d.iImage = i + 1;
    A.valider('Dupliquer l\'image');
  };

  A.imageSupprimer = function (i) {
    var d = A.doc;
    if (d.images.length < 2) return false;
    A.selAncrer();
    d.images.splice(i, 1);
    if (d.iImage > i || d.iImage >= d.images.length) d.iImage--;
    A.valider('Supprimer l\'image');
    return true;
  };

  A.imageDeplacer = function (i, j) {
    var d = A.doc;
    j = borne(j, 0, d.images.length - 1);
    if (i === j) return false;
    A.selAncrer();
    var active = d.images[d.iImage];
    d.images.splice(j, 0, d.images.splice(i, 1)[0]);
    d.iImage = d.images.indexOf(active);
    A.valider('Déplacer l\'image');
    return true;
  };

  function duree(ms) { return borne(Math.round(Number(ms)) || 100, 10, 60000); }

  A.imageDuree = function (i, ms) {
    ms = duree(ms);
    if (A.doc.images[i].duree === ms) return false;
    A.doc.images[i].duree = ms;
    A.valider('Durée de l\'image');
    return true;
  };

  A.cadence = function (ips) {
    var ms = duree(1000 / (Number(ips) || 10)), i;
    for (i = 0; i < A.doc.images.length; i++) A.doc.images[i].duree = ms;
    A.valider('Cadence');
  };

  // ---------- Toile ----------
  function pivoterTampon(b, w, h, sens) {
    var o = new b.constructor(b.length), x, y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (sens > 0) o[x * h + (h - 1 - y)] = b[y * w + x];
        else o[(w - 1 - x) * h + y] = b[y * w + x];
      }
    }
    return o;
  }
  function retournerTampon(b, w, h, horizontal) {
    var o = new b.constructor(b.length), x, y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) o[y * w + x] = horizontal ? b[y * w + (w - 1 - x)] : b[(h - 1 - y) * w + x];
    }
    return o;
  }
  A.pivoterTampon = pivoterTampon;
  A.retournerTampon = retournerTampon;

  // Remplace chaque celluloïd par f(tampon) et donne au sprite sa nouvelle taille.
  function transformer(nw, nh, f, nom) {
    var d = A.doc, i, k;
    A.selAncrer();
    for (i = 0; i < d.images.length; i++) for (k in d.images[i].cels) d.images[i].cels[k] = f(d.images[i].cels[k]);
    d.w = nw; d.h = nh; d.sel = null;
    A.valider(nom);
  }

  // Nouvelle toile de nw × nh ; l'ancien contenu y est posé décalé de (dx, dy).
  A.toileChanger = function (nw, nh, dx, dy, nom) {
    var d = A.doc, w = d.w, h = d.h;
    nw = dim(nw); nh = dim(nh);
    if (nw === w && nh === h && !dx && !dy) return false;
    transformer(nw, nh, function (b) {
      var o = new Uint32Array(nw * nh), x, y, X, Y;
      for (y = 0; y < h; y++) {
        Y = y + dy;
        if (Y < 0 || Y >= nh) continue;
        for (x = 0; x < w; x++) {
          X = x + dx;
          if (X >= 0 && X < nw) o[Y * nw + X] = b[y * w + x];
        }
      }
      return o;
    }, nom || 'Redimensionner la toile');
    return true;
  };

  // ax, ay : ancrage du contenu, 0 (début), 0.5 (centre) ou 1 (fin).
  A.redimensionner = function (nw, nh, ax, ay) {
    nw = dim(nw); nh = dim(nh);
    return A.toileChanger(nw, nh, Math.round((nw - A.doc.w) * ax), Math.round((nh - A.doc.h) * ay));
  };

  A.recadrer = function () {
    var s = A.doc.sel;
    if (!s) return false;
    var pose = A.selAncrer();
    s = A.doc.sel;
    if (s && A.toileChanger(s.w, s.h, -s.x, -s.y, 'Recadrer')) return true;
    if (pose) A.valider('Ancrer la sélection');
    return false;
  };

  A.mettreEchelle = function (nw, nh) {
    var w = A.doc.w, h = A.doc.h;
    nw = dim(nw); nh = dim(nh);
    if (nw === w && nh === h) return false;
    transformer(nw, nh, function (b) {
      var o = new Uint32Array(nw * nh), x, y;
      for (y = 0; y < nh; y++) for (x = 0; x < nw; x++) o[y * nw + x] = b[Math.floor(y * h / nh) * w + Math.floor(x * w / nw)];
      return o;
    }, 'Mettre à l\'échelle');
    return true;
  };

  A.docPivoter = function (sens) {
    var w = A.doc.w, h = A.doc.h;
    transformer(h, w, function (b) { return pivoterTampon(b, w, h, sens); }, 'Rotation du sprite');
  };

  // ---------- Composition ----------
  A.composer = function (iImage, sansFlot) {
    var d = A.doc, n = d.w * d.h, out = new Uint32Array(n), im = d.images[iImage], k, i, cal, buf, op, s;
    for (k = 0; k < d.calques.length; k++) {
      cal = d.calques[k];
      if (!cal.visible || cal.opacite <= 0) continue;
      buf = im.cels[cal.id];
      if (!sansFlot && d.sel && d.sel.flot && iImage === d.iImage && k === d.iCalque) buf = A.celAvecFlot();
      if (!buf) continue;
      op = cal.opacite;
      for (i = 0; i < n; i++) {
        s = buf[i];
        if (s) out[i] = (op >= 1 && s >>> 24 === 255) ? s : sur(out[i], s, op);
      }
    }
    return out;
  };

  A.agrandir = function (pix, w, h, k) {
    if (k === 1) return pix;
    var o = new Uint32Array(w * k * h * k), x, y, i, c, W = w * k;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        c = pix[y * w + x];
        if (c) for (i = 0; i < k; i++) o[y * k * W + x * k + i] = c;
      }
      for (i = 1; i < k; i++) o.copyWithin((y * k + i) * W, y * k * W, (y * k + 1) * W);
    }
    return o;
  };

  // Toutes les images côte à côte, sur le nombre de colonnes demandé.
  A.planche = function (colonnes) {
    var d = A.doc, n = d.images.length, cols = borne(Math.round(colonnes) || n, 1, n), rangs = Math.ceil(n / cols);
    var W = cols * d.w, o = new Uint32Array(W * rangs * d.h), i, y, c, ox, oy;
    for (i = 0; i < n; i++) {
      c = A.composer(i);
      ox = (i % cols) * d.w; oy = Math.floor(i / cols) * d.h;
      for (y = 0; y < d.h; y++) o.set(c.subarray(y * d.w, (y + 1) * d.w), (oy + y) * W + ox);
    }
    return { pix: o, w: W, h: rangs * d.h };
  };

  A.couleursDuSprite = function (max) {
    var d = A.doc, vues = new Set(), i, k, b, p;
    for (i = 0; i < d.images.length; i++) {
      for (k in d.images[i].cels) {
        b = d.images[i].cels[k];
        for (p = 0; p < b.length; p++) if (b[p] && !vues.has(b[p])) { vues.add(b[p]); if (vues.size >= max) return Array.from(vues); }
      }
    }
    return Array.from(vues);
  };

  // ---------- Import d'images ----------
  function nettoyer(pix) {
    var o = new Uint32Array(pix), i;
    for (i = 0; i < o.length; i++) if (o[i] >>> 24 === 0) o[i] = 0;
    return o;
  }
  function tropGrand(w, h) { return w > TAILLE_MAX || h > TAILLE_MAX || w < 1 || h < 1; }

  A.docDepuisImage = function (pix, w, h) {
    if (tropGrand(w, h)) return false;
    A.docNouveau(w, h);
    A.doc.images[0].cels[A.doc.calques[0].id] = nettoyer(pix);
    histInit();
    signaler('Importer');
    return true;
  };

  // Découpe une planche en cases de lw × lh ; les cases vides de la fin sont ignorées.
  A.docDepuisPlanche = function (pix, w, h, lw, lh) {
    lw = Math.round(lw); lh = Math.round(lh);
    if (tropGrand(lw, lh) || lw > w || lh > h) return false;
    var cols = Math.floor(w / lw), rangs = Math.floor(h / lh), cases = [], i, x, y, b, src = nettoyer(pix);
    for (i = 0; i < cols * rangs; i++) {
      b = new Uint32Array(lw * lh);
      x = (i % cols) * lw; y = Math.floor(i / cols) * lh;
      for (var j = 0; j < lh; j++) b.set(src.subarray((y + j) * w + x, (y + j) * w + x + lw), j * lw);
      cases.push(b);
    }
    while (cases.length > 1 && vide(cases[cases.length - 1])) cases.pop();
    A.docNouveau(lw, lh);
    A.doc.images = cases.map(function (c) {
      var im = creerImage(100);
      im.cels[A.doc.calques[0].id] = c;
      return im;
    });
    histInit();
    signaler('Importer');
    return true;
  };

  A.importerCalque = function (pix, w, h, nom) {
    var d = A.doc, src = nettoyer(pix), b = new Uint32Array(d.w * d.h), y, l = Math.min(w, d.w);
    A.selAncrer();
    for (y = 0; y < Math.min(h, d.h); y++) b.set(src.subarray(y * w, y * w + l), y * d.w);
    d.calques.splice(d.iCalque + 1, 0, creerCalque(nom || 'Image importée'));
    d.iCalque++;
    d.images[d.iImage].cels[d.calques[d.iCalque].id] = b;
    A.valider('Importer comme calque');
  };

  // ---------- Projet ----------
  // Un celluloïd est enregistré en plages [longueur, r, v, b, a] puis en base64.
  function coder(buf) {
    var out = [], i = 0, n = buf.length, c, run, s = '', k;
    while (i < n) {
      c = buf[i]; run = 1;
      while (run < 255 && i + run < n && buf[i + run] === c) run++;
      out.push(run, c & 255, c >>> 8 & 255, c >>> 16 & 255, c >>> 24);
      i += run;
    }
    for (k = 0; k < out.length; k += 8000) s += String.fromCharCode.apply(null, out.slice(k, k + 8000));
    return btoa(s);
  }
  function decoder(texte, n) {
    var s = atob(texte), buf = new Uint32Array(n), i = 0, k, run, c;
    for (k = 0; k + 4 < s.length; k += 5) {
      run = s.charCodeAt(k);
      c = rgba(s.charCodeAt(k + 1), s.charCodeAt(k + 2), s.charCodeAt(k + 3), s.charCodeAt(k + 4));
      if (i + run > n) throw new Error('celluloïd trop long');
      if (c) buf.fill(c, i, i + run);
      i += run;
    }
    if (i !== n) throw new Error('celluloïd incomplet');
    return buf;
  }

  A.versProjet = function () {
    var d = A.doc;
    return {
      format: FORMAT, version: 1, w: d.w, h: d.h, iImage: d.iImage, iCalque: d.iCalque,
      palette: A.palette.map(hexVers),
      calques: d.calques.map(function (c) { return { id: c.id, nom: c.nom, visible: c.visible, opacite: c.opacite, verrou: c.verrou }; }),
      images: d.images.map(function (im, i) {
        var cels = {};
        d.calques.forEach(function (c, k) {
          var b = im.cels[c.id];
          // Une sélection en cours de déplacement est enregistrée posée.
          if (d.sel && d.sel.flot && i === d.iImage && k === d.iCalque) b = A.celAvecFlot();
          if (b && !vide(b)) cels[c.id] = coder(b);
        });
        return { duree: im.duree, cels: cels };
      })
    };
  };

  A.depuisProjet = function (o) {
    if (!o || o.format !== FORMAT || !Array.isArray(o.calques) || !Array.isArray(o.images)) throw new Error('Ce fichier n\'est pas un projet Atelier Pixel.');
    var w = Math.round(o.w), h = Math.round(o.h), max = 0, vus = {};
    if (tropGrand(w, h) || !o.calques.length || !o.images.length) throw new Error('Projet invalide.');
    var calques = o.calques.map(function (c) {
      var id = Math.round(c.id);
      if (!(id > 0) || vus[id]) throw new Error('Projet invalide.');
      vus[id] = true; max = Math.max(max, id);
      return { id: id, nom: String(c.nom || 'Calque').slice(0, 40), visible: c.visible !== false, opacite: c.opacite === undefined ? 1 : borne(Number(c.opacite), 0, 1) || 0, verrou: !!c.verrou };
    });
    idSuivant = Math.max(idSuivant, max + 1);
    var images = o.images.map(function (im) {
      var img = creerImage(duree(im.duree)), k;
      for (k in (im.cels || {})) if (vus[k]) img.cels[k] = decoder(im.cels[k], w * h);
      return img;
    });
    A.doc = {
      w: w, h: h, calques: calques, images: images, sel: null,
      iImage: borne(Math.round(o.iImage) || 0, 0, images.length - 1),
      iCalque: borne(Math.round(o.iCalque) || 0, 0, calques.length - 1)
    };
    if (Array.isArray(o.palette)) {
      var pal = o.palette.map(hexDepuis).filter(function (c) { return c !== null; });
      if (pal.length) A.palette = pal;
    }
    histInit();
    signaler('Ouvrir');
  };
})();
