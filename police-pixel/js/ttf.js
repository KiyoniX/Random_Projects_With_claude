(function () {
  'use strict';

  var PP = window.PP, GL = PP.GL, GX = PP.GX;

  var UNITE = 64;              // unités de police par pixel : le cadratin vaut la hauteur de la police
  var PAIRES_MAX = 10000;      // au-delà, la sous-table de crénage ne tient plus dans ses longueurs sur 16 bits
  var EPOQUE = Date.UTC(1904, 0, 1) / 1000;

  // ---------- Contours ----------
  // Suit les bords de l'encre et rend des contours fermés, en pixels, l'axe des y vers le haut et
  // la ligne de base en 0. L'encre est toujours à droite du sens de parcours : les contours
  // extérieurs tournent dans le sens des aiguilles d'une montre, les trous dans l'autre sens.
  // Directions : 0 est, 1 sud, 2 ouest, 3 nord (à l'écran).
  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  PP.contours = function (pix, h, base) {
    var L = GL + 1, sorties = {}, aretes = [], contours = [], x, y, i;
    function plein(px, py) { return px >= 0 && px < GL && py >= 0 && py < h && pix[py * GL + px] === 1; }
    function arete(vx, vy, d) {
      var k = vy * L + vx, a = { x: vx, y: vy, d: d, vu: false };
      (sorties[k] || (sorties[k] = [])).push(a);
      aretes.push(a);
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < GL; x++) {
        if (!pix[y * GL + x]) continue;
        if (!plein(x, y - 1)) arete(x, y, 0);
        if (!plein(x + 1, y)) arete(x + 1, y, 1);
        if (!plein(x, y + 1)) arete(x + 1, y + 1, 2);
        if (!plein(x - 1, y)) arete(x, y + 1, 3);
      }
    }
    for (i = 0; i < aretes.length; i++) {
      if (aretes[i].vu) continue;
      var a = aretes[i], pts = [], d0 = -1, choix, k, j, suiv;
      while (!a.vu) {
        a.vu = true;
        if (a.d !== d0) pts.push([a.x - GX, base - a.y]);
        d0 = a.d;
        choix = sorties[(a.y + DY[a.d]) * L + a.x + DX[a.d]];
        suiv = null;
        // À un coin où deux pixels ne se touchent que par la pointe, on tourne à droite :
        // chaque contour reste autour de son propre pixel et ne se recoupe pas.
        for (k = 1; k >= -1 && !suiv; k--) {
          for (j = 0; j < choix.length; j++) if (!choix[j].vu && choix[j].d === (a.d + k + 4) % 4) { suiv = choix[j]; break; }
        }
        if (!suiv) break;
        a = suiv;
      }
      // Le premier point est superflu si le contour se referme en ligne droite.
      if (pts.length > 1 && aretes[i].d === d0) pts.shift();
      contours.push(pts);
    }
    return contours;
  };

  // ---------- Écriture binaire ----------
  function Tampon() { this.o = []; }
  Tampon.prototype = {
    u8: function (v) { this.o.push(v & 255); return this; },
    u16: function (v) { this.o.push(v >>> 8 & 255, v & 255); return this; },
    i16: function (v) { return this.u16(v < 0 ? v + 65536 : v); },
    u32: function (v) { this.o.push(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255); return this; },
    tag: function (s) { for (var i = 0; i < 4; i++) this.o.push(s.charCodeAt(i)); return this; },
    octets: function (t) { for (var i = 0; i < t.length; i++) this.o.push(t[i]); return this; },
    zeros: function (n) { while (n-- > 0) this.o.push(0); return this; },
    aligner: function () { while (this.o.length & 3) this.o.push(0); return this; },
    placer16: function (pos, v) { this.o[pos] = v >>> 8 & 255; this.o[pos + 1] = v & 255; }
  };

  function somme(o, debut, fin) {
    var s = 0, i;
    for (i = debut; i < fin; i += 4) s = (s + ((o[i] << 24 | (o[i + 1] || 0) << 16 | (o[i + 2] || 0) << 8 | (o[i + 3] || 0)) >>> 0)) >>> 0;
    return s;
  }
  function puissance(n) {
    var e = 0;
    while ((2 << e) <= n) e++;
    return e;
  }
  function ascii(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Œ/g, 'OE').replace(/œ/g, 'oe').replace(/Æ/g, 'AE').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]/g, '');
  }

  // ---------- Glyphes ----------
  // Rend la liste des glyphes : le caractère de remplacement, puis les caractères utilisables par code croissant.
  function inventaire(unite) {
    var p = PP.police, liste = [], codes = [], k, nd = PP.notdef();
    function glyphe(code, pix, av) {
      var cs = PP.contours(pix, p.h, p.base), g = { code: code, av: Math.max(0, av + p.interlettre) * unite, contours: cs, xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0 }, premier = true;
      cs.forEach(function (c) {
        c.forEach(function (pt) {
          var x = pt[0] * unite, y = pt[1] * unite;
          if (premier) { g.xMin = g.xMax = x; g.yMin = g.yMax = y; premier = false; }
          g.xMin = Math.min(g.xMin, x); g.xMax = Math.max(g.xMax, x);
          g.yMin = Math.min(g.yMin, y); g.yMax = Math.max(g.yMax, y);
          g.points++;
        });
      });
      return g;
    }
    liste.push(glyphe(-1, nd.pix, nd.av));
    for (k in p.glyphes) if (PP.utilisable(+k)) codes.push(+k);
    codes.sort(function (a, b) { return a - b; });
    codes.forEach(function (c) { liste.push(glyphe(c, PP.pixels(c), PP.avance(c))); });
    return liste;
  }

  function tableGlyf(liste, unite) {
    var glyf = new Tampon(), loca = new Tampon();
    liste.forEach(function (g) {
      loca.u32(glyf.o.length);
      if (!g.contours.length) return;
      var drapeaux = [], xs = new Tampon(), ys = new Tampon(), px = 0, py = 0, fin = -1;
      glyf.i16(g.contours.length).i16(g.xMin).i16(g.yMin).i16(g.xMax).i16(g.yMax);
      g.contours.forEach(function (c) {
        fin += c.length;
        glyf.u16(fin);
        c.forEach(function (pt) {
          var x = pt[0] * unite, y = pt[1] * unite, dx = x - px, dy = y - py, f = 1;
          if (dx === 0) f |= 0x10;
          else if (dx > -256 && dx < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xs.u8(Math.abs(dx)); }
          else xs.i16(dx);
          if (dy === 0) f |= 0x20;
          else if (dy > -256 && dy < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ys.u8(Math.abs(dy)); }
          else ys.i16(dy);
          drapeaux.push(f);
          px = x; py = y;
        });
      });
      glyf.u16(0).octets(drapeaux).octets(xs.o).octets(ys.o).aligner();
    });
    loca.u32(glyf.o.length);
    return { glyf: glyf, loca: loca };
  }

  // ---------- Tables ----------
  function tableCmap(liste) {
    var t = new Tampon(), segs = [], groupes = [], i, g, s, grand = false, n, f4 = new Tampon(), f12 = new Tampon(), enregs, pos;
    for (i = 1; i < liste.length; i++) {
      g = liste[i];
      s = groupes[groupes.length - 1];
      if (s && g.code === s.fin + 1) s.fin = g.code; else groupes.push({ debut: g.code, fin: g.code, gid: i });
      if (g.code > 0xFFFF) { grand = true; continue; }
      s = segs[segs.length - 1];
      if (s && g.code === s.fin + 1) s.fin = g.code; else segs.push({ debut: g.code, fin: g.code, gid: i });
    }
    segs.push({ debut: 0xFFFF, fin: 0xFFFF, gid: 0 });
    n = segs.length;
    f4.u16(4).u16(16 + n * 8).u16(0).u16(n * 2).u16(2 << puissance(n)).u16(puissance(n)).u16(n * 2 - (2 << puissance(n)));
    segs.forEach(function (q) { f4.u16(q.fin); });
    f4.u16(0);
    segs.forEach(function (q) { f4.u16(q.debut); });
    segs.forEach(function (q) { f4.u16(q.debut === 0xFFFF ? 1 : (q.gid - q.debut) & 0xFFFF); });
    segs.forEach(function () { f4.u16(0); });
    f12.u16(12).u16(0).u32(16 + groupes.length * 12).u32(0).u32(groupes.length);
    groupes.forEach(function (q) { f12.u32(q.debut).u32(q.fin).u32(q.gid); });
    enregs = grand ? [[0, 3, 4], [0, 4, 12], [3, 1, 4], [3, 10, 12]] : [[0, 3, 4], [3, 1, 4]];
    t.u16(0).u16(enregs.length);
    pos = 4 + enregs.length * 8;
    enregs.forEach(function (e) { t.u16(e[0]).u16(e[1]).u32(e[2] === 4 ? pos : pos + f4.o.length); });
    t.octets(f4.o);
    if (grand) t.octets(f12.o);
    return t;
  }

  function nomsDe(p) {
    var ribbi = p.gras && p.italique ? 'Bold Italic' : p.gras ? 'Bold' : p.italique ? 'Italic' : 'Regular';
    var courant = !!PP.STYLES[p.style.trim().toLowerCase()], famille = p.nom.trim() || 'Sans titre';
    var famille1 = courant ? famille : famille + ' ' + p.style.trim();
    var complet = famille1 + (ribbi === 'Regular' ? '' : ' ' + ribbi);
    var ps = (ascii(famille1) || 'Police') + '-' + ribbi.replace(' ', '');
    var n = { 1: famille1, 2: ribbi, 3: complet + ';PolicePixel;1.000', 4: complet, 5: 'Version 1.000', 6: ps.slice(0, 63), 10: 'Dessinée case par case avec Police Pixel.' };
    if (p.auteur) { n[0] = '© ' + p.auteur; n[9] = p.auteur; }
    if (p.licence) n[13] = p.licence;
    if (!courant) { n[16] = famille; n[17] = p.style.trim(); }
    return n;
  }
  PP.nomsTtf = function () { return nomsDe(PP.police); };

  function tableName(p) {
    var t = new Tampon(), noms = nomsDe(p), ids = Object.keys(noms).map(Number).sort(function (a, b) { return a - b; }), texte = new Tampon();
    t.u16(0).u16(ids.length).u16(6 + ids.length * 12);
    ids.forEach(function (id) {
      var s = noms[id], debut = texte.o.length, i;
      for (i = 0; i < s.length; i++) texte.u16(s.charCodeAt(i));
      t.u16(3).u16(1).u16(0x409).u16(id).u16(texte.o.length - debut).u16(debut);
    });
    return t.octets(texte.o);
  }

  function paires(liste, unite) {
    var gid = {}, r = [];
    liste.forEach(function (g, i) { if (g.code >= 0) gid[g.code] = i; });
    PP.paires().forEach(function (q) {
      if (gid[q.a] !== undefined && gid[q.b] !== undefined) r.push({ a: gid[q.a], b: gid[q.b], v: q.v * unite });
    });
    r.sort(function (x, y) { return x.a - y.a || x.b - y.b; });
    return r;
  }

  function tableKern(ps) {
    var t = new Tampon(), n = ps.length, e = puissance(n);
    t.u16(0).u16(1).u16(0).u16(14 + n * 6).u16(1);
    t.u16(n).u16((1 << e) * 6).u16(e).u16((n - (1 << e)) * 6);
    ps.forEach(function (q) { t.u16(q.a).u16(q.b).i16(q.v); });
    return t;
  }

  // GPOS : une seule consultation d'ajustement par paires (format 1), rattachée à la fonction « kern ».
  function tableGpos(ps) {
    var t = new Tampon(), premiers = [], jeux = {}, sous, pos, i, n;
    ps.forEach(function (q) {
      if (!jeux[q.a]) { jeux[q.a] = []; premiers.push(q.a); }
      jeux[q.a].push(q);
    });
    n = premiers.length;
    t.u32(0x00010000).u16(10).u16(48).u16(62);
    // Scripts DFLT et latn, chacun avec son système de langue par défaut.
    t.u16(2).tag('DFLT').u16(14).tag('latn').u16(26);
    for (i = 0; i < 2; i++) t.u16(4).u16(0).u16(0).u16(0xFFFF).u16(1).u16(0);
    // Fonctions.
    t.u16(1).tag('kern').u16(8).u16(0).u16(1).u16(0);
    // Consultations.
    t.u16(1).u16(4).u16(2).u16(0).u16(1).u16(8);
    sous = t.o.length;
    t.u16(1).u16(0).u16(0x0004).u16(0).u16(n);
    pos = 10 + n * 2;
    premiers.forEach(function (a) { t.u16(pos); pos += 2 + jeux[a].length * 4; });
    premiers.forEach(function (a) {
      t.u16(jeux[a].length);
      jeux[a].forEach(function (q) { t.u16(q.b).i16(q.v); });
    });
    t.placer16(sous + 2, t.o.length - sous);
    t.u16(1).u16(n);
    premiers.forEach(function (a) { t.u16(a); });
    return t.o.length - sous > 0xFFFF ? null : t;
  }

  function plages(liste) {
    var r = [0, 0, 0, 0];
    function bit(n) { r[n >> 5] = (r[n >> 5] | (1 << (n & 31))) >>> 0; }
    liste.forEach(function (g) {
      var c = g.code;
      if (c < 0) return;
      if (c < 0x80) bit(0); else if (c < 0x100) bit(1); else if (c < 0x180) bit(2); else if (c < 0x250) bit(3);
      else if (c >= 0x2B0 && c < 0x300) bit(5); else if (c >= 0x300 && c < 0x370) bit(6); else if (c >= 0x370 && c < 0x400) bit(7);
      else if (c >= 0x400 && c < 0x500) bit(9); else if (c >= 0x2000 && c < 0x2070) bit(31); else if (c >= 0x20A0 && c < 0x20D0) bit(33);
      else if (c >= 0x2190 && c < 0x2200) bit(37); else if (c >= 0x2200 && c < 0x2300) bit(38); else if (c >= 0x2500 && c < 0x2580) bit(43);
      else if (c >= 0x2580 && c < 0x25A0) bit(44); else if (c >= 0x25A0 && c < 0x2600) bit(45); else if (c >= 0x2600 && c < 0x2700) bit(46);
      else if (c > 0xFFFF) bit(57);
    });
    return r;
  }

  // ---------- Fichier TrueType ----------
  // Options : date (secondes Unix), kern et gpos (true par défaut), unite.
  PP.ttf = function (o) {
    o = o || {};
    var p = PP.police, U = o.unite || UNITE, liste = inventaire(U), n = liste.length, tables = {}, t, gl, ps, i, g;
    var asc = p.base * U, desc = (p.h - p.base) * U, date = (o.date !== undefined ? o.date : Math.floor(Date.now() / 1000)) - EPOQUE;
    var xMin = 0, yMin = 0, xMax = 0, yMax = 0, avMax = 0, lsbMin = 0, rsbMin = 0, etendue = 0, ptsMax = 0, ctrMax = 0, somAv = 0, nbAv = 0, premier = true;
    var dernierCode = 0, premierCode = 0xFFFF, grasItal = (p.gras ? 1 : 0) | (p.italique ? 2 : 0);

    liste.forEach(function (q) {
      avMax = Math.max(avMax, q.av);
      if (q.av) { somAv += q.av; nbAv++; }
      if (q.code >= 0) { premierCode = Math.min(premierCode, q.code, 0xFFFF); dernierCode = Math.max(dernierCode, Math.min(q.code, 0xFFFF)); }
      if (!q.contours.length) return;
      if (premier) { xMin = q.xMin; yMin = q.yMin; xMax = q.xMax; yMax = q.yMax; lsbMin = q.xMin; rsbMin = q.av - q.xMax; premier = false; }
      xMin = Math.min(xMin, q.xMin); yMin = Math.min(yMin, q.yMin); xMax = Math.max(xMax, q.xMax); yMax = Math.max(yMax, q.yMax);
      lsbMin = Math.min(lsbMin, q.xMin); rsbMin = Math.min(rsbMin, q.av - q.xMax); etendue = Math.max(etendue, q.xMax);
      ptsMax = Math.max(ptsMax, q.points); ctrMax = Math.max(ctrMax, q.contours.length);
    });

    gl = tableGlyf(liste, U);
    tables.glyf = gl.glyf; tables.loca = gl.loca;
    tables.cmap = tableCmap(liste);
    tables.name = tableName(p);

    t = tables.head = new Tampon();
    t.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5F0F3CF5).u16(0x000B).u16(p.h * U);
    t.u32(Math.floor(date / 4294967296)).u32(date >>> 0).u32(Math.floor(date / 4294967296)).u32(date >>> 0);
    t.i16(xMin).i16(yMin).i16(xMax).i16(yMax).u16(grasItal).u16(p.h).i16(2).i16(1).i16(0);

    t = tables.hhea = new Tampon();
    t.u32(0x00010000).i16(asc).i16(-desc).i16(p.interligne * U).u16(avMax).i16(lsbMin).i16(rsbMin).i16(etendue);
    t.i16(p.pas ? p.pas : 1).i16(p.pas ? 1 : 0).i16(0).zeros(8).i16(0).u16(n);

    t = tables.hmtx = new Tampon();
    liste.forEach(function (q) { t.u16(q.av).i16(q.xMin); });

    t = tables.maxp = new Tampon();
    t.u32(0x00010000).u16(n).u16(ptsMax).u16(ctrMax).u16(0).u16(0).u16(2).zeros(16);

    t = tables.post = new Tampon();
    t.u32(0x00030000).u32(p.pas ? Math.round(-Math.atan(1 / p.pas) * 180 / Math.PI * 65536) >>> 0 : 0).i16(-U).i16(U).u32(p.fixe ? 1 : 0).zeros(16);

    // Pas de lissage ni d'ajustement : le dessin est déjà sur la grille.
    if (o.gasp !== false) {
      t = tables.gasp = new Tampon();
      t.u16(1).u16(1).u16(0xFFFF).u16(o.gasp === undefined ? 0x0001 : o.gasp);
    }

    ps = o.kern === false && o.gpos === false ? [] : paires(liste, U);
    // La limite de la table kern ne vaut que pour elle : GPOS garde toutes les paires tant qu'elles y tiennent.
    if (ps.length && o.kern !== false) tables.kern = tableKern(ps.slice(0, PAIRES_MAX));
    if (ps.length && o.gpos !== false) { t = tableGpos(ps); if (t) tables.GPOS = t; }

    var pl = plages(liste);
    t = tables['OS/2'] = new Tampon();
    t.u16(4).i16(nbAv ? Math.round(somAv / nbAv) : 0).u16(p.gras ? 700 : 400).u16(5).u16(0);
    t.i16(Math.round(p.h * U * 0.65)).i16(Math.round(p.h * U * 0.6)).i16(0).i16(Math.round(p.h * U * 0.075));
    t.i16(Math.round(p.h * U * 0.65)).i16(Math.round(p.h * U * 0.6)).i16(0).i16(Math.round(p.h * U * 0.35));
    t.i16(U).i16(Math.round(p.hx * U / 2)).i16(0);
    for (i = 0; i < 10; i++) t.u8(i === 3 && p.fixe ? 9 : 0);
    t.u32(pl[0]).u32(pl[1]).u32(pl[2]).u32(pl[3]).tag('NONE');
    t.u16((p.italique ? 0x01 : 0) | (p.gras ? 0x20 : 0) | (grasItal ? 0 : 0x40) | 0x80);
    t.u16(premierCode).u16(dernierCode).i16(asc).i16(-desc).i16(p.interligne * U).u16(asc).u16(desc);
    t.u32(1).u32(0).i16(p.hx * U).i16(p.hcap * U).u16(0).u16(PP.utilisable(0x20) ? 0x20 : 0).u16(ps.length ? 2 : 0);

    // Assemblage : en-tête, répertoire trié par étiquette, puis les tables alignées sur quatre octets.
    var etiquettes = Object.keys(tables).sort(), f = new Tampon(), nt = etiquettes.length, e = puissance(nt), pos = 12 + nt * 16, posHead = 0, s;
    f.u32(0x00010000).u16(nt).u16((1 << e) * 16).u16(e).u16(nt * 16 - (1 << e) * 16);
    etiquettes.forEach(function (tag) {
      g = tables[tag];
      f.tag(tag).u32(somme(g.o, 0, g.o.length)).u32(pos).u32(g.o.length);
      if (tag === 'head') posHead = pos;
      pos += (g.o.length + 3) & ~3;
    });
    etiquettes.forEach(function (tag) { f.octets(tables[tag].o).aligner(); });
    s = (0xB1B0AFBA - somme(f.o, 0, f.o.length)) >>> 0;
    f.o[posHead + 8] = s >>> 24; f.o[posHead + 9] = s >>> 16 & 255; f.o[posHead + 10] = s >>> 8 & 255; f.o[posHead + 11] = s & 255;
    return new Uint8Array(f.o);
  };

  // ---------- Enveloppe WOFF ----------
  // Le même contenu que le TrueType, tables non compressées.
  PP.woff = function (ttf) {
    var nt = ttf[4] << 8 | ttf[5], f = new Tampon(), rep = [], i, o, pos, total;
    function u32(k) { return (ttf[k] << 24 | ttf[k + 1] << 16 | ttf[k + 2] << 8 | ttf[k + 3]) >>> 0; }
    for (i = 0; i < nt; i++) { o = 12 + i * 16; rep.push({ tag: o, som: u32(o + 4), pos: u32(o + 8), lg: u32(o + 12) }); }
    pos = 44 + nt * 20;
    total = pos;
    rep.forEach(function (r) { total += (r.lg + 3) & ~3; });
    f.tag('wOFF').u32(0x00010000).u32(total).u16(nt).u16(0).u32(ttf.length).u16(1).u16(0).zeros(20);
    rep.forEach(function (r) {
      f.octets(ttf.subarray(r.tag, r.tag + 4)).u32(pos).u32(r.lg).u32(r.lg).u32(r.som);
      pos += (r.lg + 3) & ~3;
    });
    rep.forEach(function (r) { f.octets(ttf.subarray(r.pos, r.pos + r.lg)).aligner(); });
    return new Uint8Array(f.o);
  };
})();
