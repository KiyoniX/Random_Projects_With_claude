(function () {
  'use strict';

  var GL = 64;                 // colonnes mémorisées par caractère
  var GX = 16;                 // colonne de l'origine : le dessin peut déborder de 16 pixels à gauche
  var H_MIN = 5, H_MAX = 32;   // hauteur de la police, en pixels
  var AV_MAX = GL - GX;        // chasse maximale
  var HIST_MAX = 400;
  var FORMAT = 'police-pixel';
  var FRANCAIS = 'àâäéèêëîïôöùûüÿçÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇœŒæÆ«»’‘“”–—…€°';
  var ACCENTS = [0x60, 0xB4, 0x2C6, 0xA8, 0xB8, 0x131];
  var BLANCS = [0x20, 0xA0, 0x202F];
  // Diacritique combinant -> accent dessiné à part dans la police.
  var MARQUES = { 0x300: 0x60, 0x301: 0xB4, 0x302: 0x2C6, 0x303: 0x2DC, 0x308: 0xA8, 0x30A: 0x2DA, 0x30C: 0x2C7, 0x327: 0xB8 };
  var STYLES = { '': 1, normal: 1, regular: 1, romain: 1, gras: 1, bold: 1, italique: 1, italic: 1, 'gras italique': 1, 'bold italic': 1 };

  var PP = window.PP = {
    GL: GL, GX: GX, H_MIN: H_MIN, H_MAX: H_MAX, AV_MAX: AV_MAX, FORMAT: FORMAT, STYLES: STYLES,
    police: null,
    revision: 0,          // augmente à chaque modification : sert à périmer les caractères composés
    pressePapier: null,
    surChange: null       // appelé après chaque opération validée, annulée ou rétablie
  };

  function borne(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function entier(v, a, b, defaut) {
    v = Math.round(Number(v));
    if (!isFinite(v)) v = defaut;
    return borne(v, a, b);
  }
  PP.borne = borne;

  // ---------- Jeu de caractères ----------
  PP.car = function (code) { return String.fromCodePoint(code); };
  PP.codes = function (texte) {
    var r = [], i, c;
    for (i = 0; i < texte.length; i++) {
      c = texte.codePointAt(i);
      if (c > 0xFFFF) i++;
      r.push(c);
    }
    return r;
  };
  PP.hexa = function (code) {
    var s = code.toString(16).toUpperCase();
    while (s.length < 4) s = '0' + s;
    return 'U+' + s;
  };

  PP.estBlanc = function (code) {
    return code === 0x20 || code === 0xA0 || (code >= 0x2000 && code <= 0x200A) || code === 0x202F || code === 0x205F || code === 0x3000;
  };

  PP.jeuFrancais = function () {
    var vus = {}, r = [], i;
    function ajoute(c) { if (!vus[c]) { vus[c] = 1; r.push(c); } }
    for (i = 32; i < 127; i++) ajoute(i);
    PP.codes(FRANCAIS).forEach(ajoute);
    ACCENTS.forEach(ajoute);
    BLANCS.forEach(ajoute);
    return r.sort(function (a, b) { return a - b; });
  };

  // Lettre de base et accent d'un caractère accentué, d'après sa décomposition Unicode.
  PP.decomposition = function (code) {
    var d = PP.codes(PP.car(code).normalize('NFD')), base, accent;
    if (d.length !== 2 || !MARQUES[d[1]]) return null;
    base = d[0]; accent = MARQUES[d[1]];
    if (base === 0x69 && accent !== 0xB8) base = 0x131;
    return { base: base, accent: accent };
  };

  var GROUPES = ['Haut de casse', 'Bas de casse', 'Chiffres', 'Ponctuation et signes', 'Accents', 'Lettres accentuées', 'Ligatures et autres lettres', 'Blancs'];
  function groupeDe(code) {
    if (code >= 65 && code <= 90) return 0;
    if (code >= 97 && code <= 122) return 1;
    if (code >= 48 && code <= 57) return 2;
    if (PP.estBlanc(code)) return 7;
    if (ACCENTS.indexOf(code) >= 0 || code === 0x2DC || code === 0x2DA || code === 0x2C7 || (code >= 0x300 && code <= 0x36F)) return 4;
    if (code < 127) return 3;
    var c = PP.car(code);
    if (/\p{L}/u.test(c)) return c.normalize('NFD').length > c.length ? 5 : 6;
    return 3;
  }

  // Les caractères de la police, rangés comme dans une casse.
  PP.groupes = function () {
    var r = GROUPES.map(function (nom) { return { nom: nom, codes: [] }; }), k;
    for (k in PP.police.glyphes) r[groupeDe(+k)].codes.push(+k);
    r.forEach(function (g) { g.codes.sort(function (a, b) { return a - b; }); });
    return r.filter(function (g) { return g.codes.length; });
  };
  PP.ordre = function () {
    var r = [];
    PP.groupes().forEach(function (g) { r = r.concat(g.codes); });
    return r;
  };

  // ---------- Police ----------
  function glypheNeuf(code, av) { return { code: code, av: av, pix: null, comp: null }; }

  PP.policeCreer = function (o) {
    o = o || {};
    var h = entier(o.h, H_MIN, H_MAX, 12);
    var desc = entier(o.hdesc, 0, h - 2, Math.max(1, Math.round(h / 6)));
    var base = entier(o.base, 2, h, h - desc);
    var hcap = entier(o.hcap, 1, base, Math.max(3, Math.round(base * 0.7)));
    var p = {
      nom: String(o.nom || 'Sans titre'), style: String(o.style || 'Normal'), auteur: String(o.auteur || ''), licence: String(o.licence || ''),
      h: h, base: base, hcap: hcap,
      hx: entier(o.hx, 1, base, Math.max(2, Math.round(hcap * 0.7))),
      hasc: entier(o.hasc, 1, base, hcap),
      hdesc: entier(o.hdesc, 0, h - base, h - base),
      fixe: !!o.fixe, chasse: entier(o.chasse, 1, AV_MAX, Math.round(h / 2)),
      interlettre: entier(o.interlettre, -4, 16, 0), interligne: entier(o.interligne, 0, 32, 1),
      pas: entier(o.pas, 0, 16, 0), gras: !!o.gras, italique: !!o.italique,
      glyphes: {}, crenage: {}, courant: 65
    };
    var av = entier(o.chasse, 1, AV_MAX, Math.max(3, Math.round(hcap * 0.75) + 1));
    (o.codes || PP.jeuFrancais()).forEach(function (c) { p.glyphes[c] = glypheNeuf(c, PP.estBlanc(c) ? Math.max(2, Math.round(av * 0.6)) : av); });
    return p;
  };

  PP.ouvrir = function (p) {
    PP.police = p;
    if (!p.glyphes[p.courant]) p.courant = PP.ordre()[0];
    PP.revision++;
    histInit();
    signaler('Ouvrir');
  };

  // Exécute f avec une autre police à la place de la police en cours, sans toucher à l'historique.
  PP.avec = function (p, f) {
    var avant = PP.police, r;
    PP.police = p; PP.revision++;
    try { r = f(); } finally { PP.police = avant; PP.revision++; }
    return r;
  };

  PP.glyphe = function (code) { return PP.police.glyphes[code] || null; };

  // Rend un caractère modifiable : un caractère figé (retenu par l'historique) est d'abord copié.
  PP.ecrire = function (code) {
    var p = PP.police, g = p.glyphes[code];
    if (!g) return null;
    if (g.fige) {
      g = p.glyphes[code] = {
        code: g.code, av: g.av, pix: g.pix ? new Uint8Array(g.pix) : null,
        comp: g.comp ? { base: g.comp.base, accent: g.comp.accent, dx: g.comp.dx, dy: g.comp.dy } : null
      };
    }
    if (!g.pix && !g.comp) g.pix = new Uint8Array(GL * p.h);
    PP.revision++;
    return g;
  };

  var vides = {};
  function vide(h) { return vides[h] || (vides[h] = new Uint8Array(GL * h)); }

  // Décalage d'une rangée dans une police penchée (0 dans une police droite).
  function penche(r) {
    var p = PP.police;
    return p.pas ? Math.floor((p.base - 1 - r) / p.pas) : 0;
  }

  // Boîte de l'encre ; avec redresse, les colonnes sont comptées sans la pente de l'italique.
  function boite(pix, h, redresse) {
    var x0 = GL, x1 = -1, y0 = -1, y1 = -1, x, y, o, d;
    for (y = 0; y < h; y++) {
      o = y * GL; d = redresse ? penche(y) : 0;
      for (x = 0; x < GL; x++) {
        if (pix[o + x]) {
          if (y0 < 0) y0 = y;
          y1 = y;
          if (x - d < x0) x0 = x - d;
          if (x - d > x1) x1 = x - d;
        }
      }
    }
    return y0 < 0 ? null : { x0: x0 - GX, y0: y0, x1: x1 - GX, y1: y1 };
  }

  var cache = {};

  // Décalage donné à l'accent d'un caractère composé : placement automatique plus réglage manuel.
  function placement(g, pb, pa) {
    var p = PP.police, eb = boite(pb, p.h, true), ea = boite(pa, p.h, true), dx = 0, dy = 0, haut = p.base - p.hx;
    if (eb && ea) {
      if (ea.y1 < p.base && eb.y0 < haut) dy = eb.y0 - haut;
      dx = Math.round(((eb.x0 + eb.x1) - (ea.x0 + ea.x1)) / 2) + penche(ea.y1 + dy) - penche(ea.y1);
    }
    return { dx: dx + g.comp.dx, dy: dy + g.comp.dy };
  }

  function resoudre(g, pile) {
    var p = PP.police, h = p.h;
    if (!g.comp) return g.pix || vide(h);
    var c = cache[g.code];
    if (c && c.rev === PP.revision && c.g === g) return c.pix;
    if (pile.indexOf(g.code) >= 0) return vide(h);
    pile = pile.concat(g.code);
    var b = p.glyphes[g.comp.base], a = p.glyphes[g.comp.accent];
    var pb = b ? resoudre(b, pile) : vide(h), pa = a ? resoudre(a, pile) : vide(h);
    var d = placement(g, pb, pa), pix = new Uint8Array(pb), x, y, nx, ny;
    for (y = 0; y < h; y++) {
      for (x = 0; x < GL; x++) {
        if (!pa[y * GL + x]) continue;
        nx = x + d.dx; ny = y + d.dy;
        if (nx >= 0 && nx < GL && ny >= 0 && ny < h) pix[ny * GL + nx] = 1;
      }
    }
    cache[g.code] = { rev: PP.revision, g: g, pix: pix, d: d };
    return pix;
  }

  // Pixels d'un caractère (GL colonnes par rangée), composition résolue. À ne pas modifier.
  PP.pixels = function (code) {
    var g = PP.police.glyphes[code];
    return g ? resoudre(g, []) : vide(PP.police.h);
  };
  PP.placement = function (code) {
    var g = PP.police.glyphes[code];
    if (!g || !g.comp) return null;
    resoudre(g, []);
    return cache[code] && cache[code].g === g ? cache[code].d : { dx: 0, dy: 0 };
  };
  PP.encre = function (code) { return boite(PP.pixels(code), PP.police.h, false); };
  PP.boite = function (pix) { return boite(pix, PP.police.h, false); };
  PP.lire = function (code, x, y) {
    var p = PP.police;
    if (y < 0 || y >= p.h || x < -GX || x >= GL - GX) return 0;
    return PP.pixels(code)[y * GL + x + GX];
  };

  PP.avance = function (code) {
    var p = PP.police, g = p.glyphes[code], n = 0;
    if (p.fixe) return p.chasse;
    while (g && g.comp && p.glyphes[g.comp.base] && n++ < 8) g = p.glyphes[g.comp.base];
    return g ? g.av : PP.notdef().av;
  };

  // Un caractère reste « à dessiner » tant qu'il n'a pas d'encre, sauf les blancs.
  PP.aDessiner = function (code) { return !PP.estBlanc(code) && !PP.encre(code); };
  PP.utilisable = function (code) { return !!PP.police.glyphes[code] && (PP.estBlanc(code) || !!PP.encre(code)); };

  // Le caractère de remplacement : un cadre de la hauteur des capitales.
  PP.notdef = function () {
    var p = PP.police, l = p.fixe ? Math.max(1, p.chasse - 1) : Math.max(3, Math.round(p.hcap * 0.6));
    var pix = new Uint8Array(GL * p.h), x, y, y0 = Math.max(0, p.base - p.hcap), y1 = p.base - 1;
    for (y = y0; y <= y1; y++) {
      for (x = 0; x < l; x++) if (y === y0 || y === y1 || x === 0 || x === l - 1) pix[y * GL + GX + x] = 1;
    }
    return { pix: pix, av: p.fixe ? p.chasse : l + 1 };
  };

  // ---------- Historique ----------
  // Chaque état est une copie légère de la police : les caractères sont partagés et figés,
  // seuls ceux qu'une opération modifie sont dupliqués.
  var hist = { pile: [], i: -1 };
  var CHAMPS = ['nom', 'style', 'auteur', 'licence', 'h', 'base', 'hcap', 'hx', 'hasc', 'hdesc', 'fixe', 'chasse', 'interlettre', 'interligne', 'pas', 'gras', 'italique', 'courant'];

  function copieEtat(p) {
    var s = { glyphes: {}, crenage: {} }, k;
    CHAMPS.forEach(function (c) { s[c] = p[c]; });
    for (k in p.glyphes) s.glyphes[k] = p.glyphes[k];
    for (k in p.crenage) s.crenage[k] = p.crenage[k];
    return s;
  }
  function instantane() {
    var s = copieEtat(PP.police), k;
    for (k in s.glyphes) s.glyphes[k].fige = true;
    return s;
  }
  function histInit() { hist.pile = [instantane()]; hist.i = 0; }
  function signaler(nom) { if (PP.surChange) PP.surChange(nom); }

  PP.valider = function (nom) {
    hist.pile.length = hist.i + 1;
    hist.pile.push(instantane());
    hist.i++;
    while (hist.pile.length > HIST_MAX) { hist.pile.shift(); hist.i--; }
    signaler(nom);
  };
  function revenirA(i, nom) {
    var courant = PP.police.courant;
    hist.i = i;
    PP.police = copieEtat(hist.pile[i]);
    if (nom === 'Revenir' && PP.police.glyphes[courant]) PP.police.courant = courant;
    PP.revision++;
    signaler(nom);
  }
  PP.annuler = function () {
    if (hist.i <= 0) return false;
    revenirA(hist.i - 1, 'Annuler');
    return true;
  };
  PP.retablir = function () {
    if (hist.i >= hist.pile.length - 1) return false;
    revenirA(hist.i + 1, 'Rétablir');
    return true;
  };
  // Abandonne ce qui n'a pas été validé.
  PP.revenir = function () { revenirA(hist.i, 'Revenir'); };
  PP.histEtat = function () { return { avant: hist.i, apres: hist.pile.length - 1 - hist.i }; };

  // Changer de caractère n'est pas une étape d'historique.
  PP.aller = function (code) {
    if (!PP.police.glyphes[code]) return false;
    PP.police.courant = code;
    hist.pile[hist.i].courant = code;
    return true;
  };

  // ---------- Caractères ----------
  PP.ajouter = function (codes) {
    var p = PP.police, n = 0, dernier = null;
    codes.forEach(function (c) {
      if (c < 0x20 || (c >= 0x7F && c < 0xA0) || c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF)) return;
      dernier = c;
      if (p.glyphes[c]) return;
      var ref = p.glyphes[0x6E] || p.glyphes[0x4E];
      p.glyphes[c] = glypheNeuf(c, PP.estBlanc(c) ? PP.avance(0x20) : (ref ? PP.avance(ref.code) : Math.round(p.h / 2)));
      n++;
    });
    if (dernier !== null) p.courant = dernier;
    if (n) { PP.revision++; PP.valider('Ajouter des caractères'); }
    else if (dernier !== null) PP.aller(dernier);
    return n;
  };

  // Caractères composés qui s'appuient sur celui-ci.
  PP.dependants = function (code) {
    var r = [], k, g;
    for (k in PP.police.glyphes) {
      g = PP.police.glyphes[k];
      if (g.comp && (g.comp.base === code || g.comp.accent === code)) r.push(+k);
    }
    return r;
  };

  PP.retirer = function (code) {
    var p = PP.police, ordre = PP.ordre(), i = ordre.indexOf(code), k;
    if (i < 0 || ordre.length < 2) return false;
    PP.dependants(code).forEach(function (c) { PP.detacher(c, true); });
    delete p.glyphes[code];
    for (k in p.crenage) if (k.split(',').indexOf(String(code)) >= 0) delete p.crenage[k];
    p.courant = ordre[i + 1] !== undefined ? ordre[i + 1] : ordre[i - 1];
    PP.revision++;
    PP.valider('Retirer le caractère');
    return true;
  };

  PP.effacer = function (code) {
    var av = PP.avance(code), g = PP.ecrire(code);
    g.comp = null;
    g.pix = null;
    g.av = av;
    PP.valider('Effacer le caractère');
  };

  PP.dupliquer = function (source, cible) {
    var p = PP.police, s = p.glyphes[source], g;
    if (!s || source === cible) return false;
    if (!p.glyphes[cible]) p.glyphes[cible] = glypheNeuf(cible, s.av);
    g = PP.ecrire(cible);
    g.av = PP.avance(source);
    g.comp = null;
    g.pix = new Uint8Array(PP.pixels(source));
    p.courant = cible;
    PP.revision++;
    PP.valider('Dupliquer le caractère');
    return true;
  };

  PP.reglerAvance = function (code, av) {
    var g = PP.ecrire(code);
    g.av = entier(av, 0, AV_MAX, g.av);
    return g.av;
  };

  // Approche gauche : déplace le dessin. Approche droite : change la chasse.
  PP.approches = function (code) {
    var e = PP.encre(code), av = PP.avance(code);
    return e ? { g: e.x0, d: av - e.x1 - 1 } : { g: 0, d: av };
  };
  PP.reglerApproches = function (code, gauche, droite) {
    var a = PP.approches(code), e = PP.encre(code), g = PP.police.glyphes[code];
    if (!e || g.comp) return false;
    gauche = entier(gauche, -GX, AV_MAX - 1, a.g);
    droite = entier(droite, -GX, AV_MAX, a.d);
    if (gauche !== a.g && !PP.decaler(code, gauche - a.g, 0)) return false;
    if (!PP.police.fixe) PP.reglerAvance(code, borne(gauche + (e.x1 - e.x0 + 1) + droite, 0, AV_MAX));
    return true;
  };

  // ---------- Composition des accents ----------
  PP.lier = function (code, base, accent) {
    var p = PP.police, g;
    if (!p.glyphes[code] || !p.glyphes[base] || !p.glyphes[accent]) return 'Il manque la lettre de base ou l\'accent dans la police.';
    if (base === code || accent === code) return 'Un caractère ne peut pas se composer avec lui-même.';
    if (PP.dependants(code).length) return 'Ce caractère sert déjà de base ou d\'accent à d\'autres.';
    g = PP.ecrire(code);
    g.pix = null;
    g.comp = { base: base, accent: accent, dx: 0, dy: 0 };
    PP.valider('Composer le caractère');
    return '';
  };
  PP.ajusterAccent = function (code, dx, dy) {
    var g = PP.police.glyphes[code];
    if (!g || !g.comp) return false;
    g = PP.ecrire(code);
    g.comp.dx = borne(g.comp.dx + dx, -GX, GX);
    g.comp.dy = borne(g.comp.dy + dy, -H_MAX, H_MAX);
    return true;
  };
  // Détache la composition : le caractère garde son dessin et redevient indépendant.
  PP.detacher = function (code, sansValider) {
    var g = PP.police.glyphes[code], pix, av;
    if (!g || !g.comp) return false;
    pix = new Uint8Array(PP.pixels(code)); av = PP.avance(code);
    g = PP.ecrire(code);
    g.comp = null; g.pix = pix; g.av = av;
    if (!sansValider) PP.valider('Détacher la composition');
    return true;
  };
  // Compose tous les caractères accentués encore vides dont la base et l'accent sont dessinés.
  PP.composerManquants = function () {
    var p = PP.police, n = 0, k, d, g;
    for (k in p.glyphes) {
      g = p.glyphes[k];
      if (g.comp || g.pix && boite(g.pix, p.h)) continue;
      d = PP.decomposition(+k);
      if (!d) continue;
      if (d.base === 0x131 && !p.glyphes[0x131]) d.base = 0x69;
      if (!p.glyphes[d.base] || !p.glyphes[d.accent] || !PP.encre(d.base) || !PP.encre(d.accent)) continue;
      g = PP.ecrire(+k);
      g.pix = null;
      g.comp = { base: d.base, accent: d.accent, dx: 0, dy: 0 };
      n++;
    }
    if (n) PP.valider('Composer les accentués');
    return n;
  };

  // ---------- Métriques ----------
  // Change la hauteur et les repères. Le dessin suit la ligne de base ; ce qui dépasse est perdu.
  PP.reglerMetriques = function (o) {
    var p = PP.police, h = entier(o.h, H_MIN, H_MAX, p.h), base = entier(o.base, 1, h, Math.min(p.base, h)), dy = base - p.base, k, g, n, x, y, ny;
    if (h !== p.h || dy) {
      for (k in p.glyphes) {
        g = p.glyphes[k];
        if (!g.pix) continue;
        g = PP.ecrire(+k);
        n = new Uint8Array(GL * h);
        for (y = 0; y < p.h; y++) {
          ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (x = 0; x < GL; x++) n[ny * GL + x] = g.pix[y * GL + x];
        }
        g.pix = n;
      }
      p.h = h; p.base = base;
    }
    p.hcap = entier(o.hcap, 1, base, Math.min(p.hcap, base));
    p.hx = entier(o.hx, 1, base, Math.min(p.hx, base));
    p.hasc = entier(o.hasc, 1, base, Math.min(p.hasc, base));
    p.hdesc = entier(o.hdesc, 0, h - base, Math.min(p.hdesc, h - base));
    PP.revision++;
    PP.valider('Régler les repères');
  };

  PP.reglerPolice = function (o) {
    var p = PP.police;
    ['nom', 'style', 'auteur', 'licence'].forEach(function (c) { if (o[c] !== undefined) p[c] = String(o[c]).slice(0, 2000); });
    if (o.fixe !== undefined) p.fixe = !!o.fixe;
    if (o.chasse !== undefined) p.chasse = entier(o.chasse, 1, AV_MAX, p.chasse);
    if (o.interlettre !== undefined) p.interlettre = entier(o.interlettre, -4, 16, p.interlettre);
    if (o.interligne !== undefined) p.interligne = entier(o.interligne, 0, 32, p.interligne);
    if (o.gras !== undefined) p.gras = !!o.gras;
    if (o.italique !== undefined) p.italique = !!o.italique;
    PP.revision++;
    PP.valider('Régler la police');
  };

  // ---------- Crénage ----------
  PP.crenage = function (a, b) { return PP.police.crenage[a + ',' + b] || 0; };
  PP.reglerCrenage = function (a, b, v) {
    var c = PP.police.crenage, k = a + ',' + b;
    v = entier(v, -GX, GX, 0);
    if (v) c[k] = v; else delete c[k];
  };
  PP.paires = function () {
    var r = [], k, t;
    for (k in PP.police.crenage) { t = k.split(','); r.push({ a: +t[0], b: +t[1], v: PP.police.crenage[k] }); }
    return r.sort(function (x, y) { return x.a - y.a || x.b - y.b; });
  };

  // Bords gauche et droit de l'encre, rangée par rangée.
  function profil(code) {
    var p = PP.police, pix = PP.pixels(code), g = [], d = [], x, y, o;
    for (y = 0; y < p.h; y++) {
      g[y] = Infinity; d[y] = -Infinity; o = y * GL;
      for (x = 0; x < GL; x++) {
        if (pix[o + x]) {
          if (g[y] === Infinity) g[y] = x - GX;
          d[y] = x - GX + 1;
        }
      }
    }
    return { g: g, d: d };
  }
  // Plus petit blanc entre deux caractères posés côte à côte ; une rangée de marge évite les contacts en diagonale.
  function blanc(pa, pb, av, h) {
    var m = Infinity, y, d;
    for (y = 0; y < h; y++) {
      d = Math.max(pa.d[y], y ? pa.d[y - 1] : -Infinity, y < h - 1 ? pa.d[y + 1] : -Infinity);
      if (d === -Infinity || pb.g[y] === Infinity) continue;
      m = Math.min(m, av - d + pb.g[y]);
    }
    return m;
  }
  var CRENABLES = /[\p{L}\p{N}.,;:!?'"’‘“”«»\-–—()\/…]/u;

  // Paires qui gagneraient à être resserrées : celles dont le blanc dépasse d'au moins deux pixels l'approche
  // courante de la police. Le resserrement proposé laisse un pixel de plus que cette approche.
  PP.detecterCrenage = function () {
    var p = PP.police, codes = [], profils = {}, r = [], k, i, j, a, b, cible, b0, v, max, ca, cb, la, lb;
    if (p.fixe) return r;
    for (k in p.glyphes) {
      if (CRENABLES.test(PP.car(+k)) && PP.encre(+k) && groupeDe(+k) !== 4) { codes.push(+k); profils[k] = profil(+k); }
    }
    function ref(c) { return profils[c] ? blanc(profils[c], profils[c], PP.avance(c), p.h) : Infinity; }
    cible = Math.min(ref(0x6E), ref(0x48), ref(0x6C));
    if (cible === Infinity) cible = 1;
    cible = Math.max(1, cible);
    max = Math.max(1, Math.round(p.hx / 3));
    for (i = 0; i < codes.length; i++) {
      a = codes[i]; ca = PP.car(a); la = /[\p{L}\p{N}]/u.test(ca);
      for (j = 0; j < codes.length; j++) {
        b = codes[j]; cb = PP.car(b); lb = /[\p{L}\p{N}]/u.test(cb);
        if (!la && !lb) continue;
        if (/\p{Ll}/u.test(ca) && /\p{Lu}/u.test(cb)) continue;
        if (/\p{N}/u.test(ca) && !/\p{L}/u.test(cb) || /\p{N}/u.test(cb) && !/\p{L}/u.test(ca)) continue;
        if (/[.,;:!?…)]/.test(ca)) continue;
        b0 = blanc(profils[a], profils[b], PP.avance(a) + p.interlettre, p.h);
        v = Math.min(b0 === Infinity ? max : b0 - cible - 1, max, Math.max(0, Math.min(PP.avance(a), PP.avance(b)) - 2));
        if (v >= 1 && PP.crenage(a, b) > -v) r.push({ a: a, b: b, v: -v, gain: v + (/\p{L}/u.test(ca) && /\p{L}/u.test(cb) ? 0.5 : 0) + (a < 128 && b < 128 ? 0.25 : 0) });
      }
    }
    return r.sort(function (x, y) { return y.gain - x.gain || x.a - y.a || x.b - y.b; });
  };

  // ---------- Mise en ligne d'un texte ----------
  // Rend les lignes composées : pour chaque caractère son code (-1 : absent de la police) et son abscisse.
  PP.mettreEnLigne = function (texte, largeurMax) {
    var p = PP.police, lignes = [], ligne, x, prec, dernierBlanc, nd = PP.notdef().av, codes = PP.codes(texte), i, c, av, k, coupe, reste, decal;
    function ouvre() { ligne = { cars: [], l: 0 }; lignes.push(ligne); x = 0; prec = -1; dernierBlanc = -1; }
    ouvre();
    for (i = 0; i < codes.length; i++) {
      c = codes[i];
      if (c === 10) { ouvre(); continue; }
      if (c === 13 || c === 9) continue;
      if (!PP.utilisable(c)) c = -1;
      av = (c < 0 ? nd : PP.avance(c)) + p.interlettre;
      k = c >= 0 && prec >= 0 ? PP.crenage(prec, c) : 0;
      if (largeurMax && x + k + av > largeurMax && ligne.cars.length) {
        if (c === 0x20) { ouvre(); continue; }
        if (dernierBlanc >= 0) {
          coupe = ligne.cars.splice(dernierBlanc);
          reste = coupe.slice(1);
          ligne.l = ligne.cars.length ? ligne.cars[ligne.cars.length - 1].x + ligne.cars[ligne.cars.length - 1].av : 0;
          ouvre();
          if (reste.length) {
            decal = reste[0].x;
            reste.forEach(function (r) { r.x -= decal; ligne.cars.push(r); });
            x = reste[reste.length - 1].x + reste[reste.length - 1].av;
            prec = reste[reste.length - 1].code;
          }
        } else ouvre();
        k = c >= 0 && prec >= 0 ? PP.crenage(prec, c) : 0;
      }
      x += k;
      if (c === 0x20) dernierBlanc = ligne.cars.length;
      ligne.cars.push({ code: c, x: x, av: av });
      x += av;
      ligne.l = x;
      prec = c;
    }
    return { lignes: lignes, l: lignes.reduce(function (m, li) { return Math.max(m, li.l); }, 0), h: lignes.length * (p.h + p.interligne) - p.interligne };
  };

  // Dessine un texte dans un masque d'un octet par pixel (marge : pixels libres autour).
  PP.rendre = function (texte, largeurMax, marge) {
    var p = PP.police, mise = PP.mettreEnLigne(texte, largeurMax), m = marge === undefined ? GX : marge;
    var l = Math.max(1, mise.l + 2 * m), h = Math.max(1, mise.h + 2 * m), masque = new Uint8Array(l * h), nd = null;
    mise.lignes.forEach(function (ligne, n) {
      var y0 = m + n * (p.h + p.interligne);
      ligne.cars.forEach(function (c) {
        var pix = c.code < 0 ? (nd || (nd = PP.notdef())).pix : PP.pixels(c.code), x, y, px, o;
        for (y = 0; y < p.h; y++) {
          o = y * GL;
          for (x = 0; x < GL; x++) {
            if (!pix[o + x]) continue;
            px = m + c.x + x - GX;
            if (px >= 0 && px < l) masque[(y0 + y) * l + px] = 1;
          }
        }
      });
    });
    return { l: l, h: h, masque: masque, marge: m, mise: mise };
  };

  // ---------- Enregistrement ----------
  PP.versJSON = function () {
    var p = PP.police, o = { format: FORMAT, version: 1 }, k;
    CHAMPS.forEach(function (c) { o[c] = p[c]; });
    o.caracteres = PP.ordre().map(function (code) {
      var g = p.glyphes[code], r = { c: code, car: PP.car(code), a: g.av }, e, y, x, s;
      if (g.comp) r.comp = [g.comp.base, g.comp.accent, g.comp.dx, g.comp.dy];
      else if (g.pix && (e = boite(g.pix, p.h))) {
        r.x = e.x0; r.y = e.y0; r.l = [];
        for (y = e.y0; y <= e.y1; y++) {
          s = '';
          for (x = e.x0; x <= e.x1; x++) s += g.pix[y * GL + x + GX] ? '#' : '.';
          r.l.push(s);
        }
      }
      return r;
    });
    o.crenage = PP.paires().map(function (q) { return [q.a, q.b, q.v]; });
    return o;
  };

  PP.depuisJSON = function (o) {
    if (!o || o.format !== FORMAT || !Array.isArray(o.caracteres)) throw new Error('Ce fichier n\'est pas un projet Police Pixel.');
    var p = PP.policeCreer({
      nom: o.nom, style: o.style, auteur: o.auteur, licence: o.licence, h: o.h, base: o.base, hcap: o.hcap, hx: o.hx, hasc: o.hasc, hdesc: o.hdesc,
      fixe: o.fixe, chasse: o.chasse, interlettre: o.interlettre, interligne: o.interligne, pas: o.pas, gras: o.gras, italique: o.italique, codes: []
    });
    o.caracteres.forEach(function (r) {
      var code = entier(r.c, 0x20, 0x10FFFF, -1), g, x, y, px, py;
      if (code < 0) return;
      g = p.glyphes[code] = glypheNeuf(code, entier(r.a, 0, AV_MAX, p.chasse));
      if (Array.isArray(r.comp)) g.comp = { base: +r.comp[0], accent: +r.comp[1], dx: entier(r.comp[2], -GX, GX, 0), dy: entier(r.comp[3], -H_MAX, H_MAX, 0) };
      else if (Array.isArray(r.l)) {
        g.pix = new Uint8Array(GL * p.h);
        for (y = 0; y < r.l.length; y++) {
          for (x = 0; x < String(r.l[y]).length; x++) {
            if (String(r.l[y]).charAt(x) !== '#') continue;
            px = entier(r.x, -GX, AV_MAX, 0) + x + GX; py = entier(r.y, 0, H_MAX, 0) + y;
            if (px >= 0 && px < GL && py >= 0 && py < p.h) g.pix[py * GL + px] = 1;
          }
        }
      }
    });
    if (!Object.keys(p.glyphes).length) throw new Error('Ce projet ne contient aucun caractère.');
    (o.crenage || []).forEach(function (q) {
      var v = entier(q[2], -GX, GX, 0);
      if (v && p.glyphes[q[0]] && p.glyphes[q[1]]) p.crenage[q[0] + ',' + q[1]] = v;
    });
    p.courant = p.glyphes[o.courant] ? o.courant : (p.glyphes[65] ? 65 : +Object.keys(p.glyphes)[0]);
    return p;
  };

  // ---------- Notation en clair ----------
  // Une police écrite à la main : des lignes « @@clé valeur… », puis un bloc par caractère séparé par une ligne vide.
  // Bloc dessiné : « A [d=rangées sous la ligne de base] [g=approche gauche] [a=chasse] » suivi de ses rangées (# = encre).
  // Bloc composé : « é = e ´ [dx dy] ».
  function codeDe(s) { return /^U\+[0-9A-Fa-f]{2,6}$/.test(s) ? parseInt(s.slice(2), 16) : s.codePointAt(0); }

  PP.depuisTexte = function (texte) {
    var o = { codes: [] }, blocs = [], paires = [], p;
    texte.replace(/\r/g, '').split(/\n[ \t]*\n/).forEach(function (bloc) {
      var lignes = bloc.split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!lignes.length) return;
      if (lignes[0].indexOf('@@') === 0) {
        lignes.forEach(function (l) {
          var t = l.slice(2).trim().split(/\s+/), i;
          if (t[0] === 'crenage') { for (i = 1; i + 1 < t.length; i += 2) paires.push([t[i], +t[i + 1]]); }
          else if (t[0] === 'nom' || t[0] === 'style' || t[0] === 'auteur' || t[0] === 'licence') o[t[0]] = l.slice(2).trim().slice(t[0].length + 1);
          else for (i = 0; i + 1 < t.length; i += 2) o[t[i]] = +t[i + 1];
        });
        if (o.fixe) { o.chasse = o.fixe; o.fixe = true; }
        return;
      }
      blocs.push(lignes);
    });
    p = PP.policeCreer(o);
    blocs.forEach(function (lignes) {
      var t = lignes[0].trim().split(/\s+/), code = codeDe(t[0]), g = p.glyphes[code] = glypheNeuf(code, 0), opt = {}, rangs = lignes.slice(1), l = 0, y0, x, y, py;
      if (t[1] === '=' && t.length >= 4) {
        g.comp = { base: codeDe(t[2]), accent: codeDe(t[3]), dx: +t[4] || 0, dy: +t[5] || 0 };
        return;
      }
      t.slice(1).forEach(function (m) { var q = m.split('='); opt[q[0]] = +q[1]; });
      rangs.forEach(function (r) { l = Math.max(l, r.trim().length); });
      g.av = opt.a !== undefined ? opt.a : (p.fixe ? p.chasse : (opt.g || 0) + l + 1);
      if (!rangs.length) return;
      g.pix = new Uint8Array(GL * p.h);
      y0 = p.base + (opt.d || 0) - rangs.length;
      for (y = 0; y < rangs.length; y++) {
        py = y0 + y;
        if (py < 0 || py >= p.h) throw new Error('Le caractère ' + t[0] + ' sort de la hauteur de la police.');
        for (x = 0; x < rangs[y].trim().length; x++) if (rangs[y].trim().charAt(x) === '#') g.pix[py * GL + GX + (opt.g || 0) + x] = 1;
      }
    });
    Object.keys(p.glyphes).forEach(function (k) {
      var g = p.glyphes[k];
      if (g.comp && p.glyphes[g.comp.base]) g.av = p.glyphes[g.comp.base].av;
    });
    paires.forEach(function (q) {
      var c = PP.codes(q[0]);
      if (c.length === 2 && q[1]) p.crenage[c[0] + ',' + c[1]] = q[1];
    });
    p.courant = p.glyphes[65] ? 65 : +Object.keys(p.glyphes)[0];
    return p;
  };
})();
