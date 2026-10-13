(function () {
  'use strict';

  var PP = window.PP, GL = PP.GL, GX = PP.GX;

  var COLONNES = 16;           // caractères par rangée dans une planche en grille
  var BLOC = 65535;            // plus grand bloc « stocké » d'un flux zlib

  // ---------- PNG ----------
  var crcTable = null;
  function crc(o, debut, fin) {
    var c, n, k;
    if (!crcTable) {
      crcTable = [];
      for (n = 0; n < 256; n++) {
        c = n;
        for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    c = 0xFFFFFFFF;
    for (n = debut; n < fin; n++) c = crcTable[(c ^ o[n]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Image à deux couleurs (un bit par pixel) : le fond, transparent si fond est nul, et l'encre.
  PP.png = function (l, h, masque, encre, fond) {
    var o = [137, 80, 78, 71, 13, 10, 26, 10], lg = (l + 7) >> 3, brut = new Uint8Array(h * (lg + 1)), x, y, a = 1, b = 0, i, n, z = [0x78, 0x01];
    function u32(t, v) { t.push(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255); }
    function bloc(type, donnees) {
      var debut = o.length + 4, k;
      u32(o, donnees.length);
      for (k = 0; k < 4; k++) o.push(type.charCodeAt(k));
      for (k = 0; k < donnees.length; k++) o.push(donnees[k]);
      u32(o, crc(o, debut, o.length));
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < l; x++) if (masque[y * l + x]) brut[y * (lg + 1) + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
    for (i = 0; i < brut.length; i++) { a = (a + brut[i]) % 65521; b = (b + a) % 65521; }
    for (i = 0; i < brut.length || i === 0; i += BLOC) {
      n = Math.min(BLOC, brut.length - i);
      z.push(i + n >= brut.length ? 1 : 0, n & 255, n >> 8, ~n & 255, ~n >> 8 & 255);
      for (x = 0; x < n; x++) z.push(brut[i + x]);
    }
    u32(z, ((b << 16) | a) >>> 0);
    encre = encre || [255, 255, 255];
    var entete = [];
    u32(entete, l); u32(entete, h); entete.push(1, 3, 0, 0, 0);
    bloc('IHDR', entete);
    bloc('PLTE', (fond || [0, 0, 0]).concat(encre));
    if (!fond) bloc('tRNS', [0, 255]);
    bloc('IDAT', z);
    bloc('IEND', []);
    return new Uint8Array(o);
  };

  // ---------- Planche de caractères ----------
  function pot(n) { var p = 1; while (p < n) p *= 2; return p; }

  // Range les caractères utilisables dans une image. Mode « serree » : chaque dessin au plus juste, pour un
  // rendu par image dans un jeu. Mode « grille » : des cases égales, 16 par rangée, pour retoucher ailleurs.
  PP.planche = function (o) {
    o = o || {};
    var p = PP.police, cases = [], k, e, l, h, x, y, rang, masque, origine = 0, cl = 1, pl;
    for (k in p.glyphes) {
      if (!PP.utilisable(+k)) continue;
      e = PP.encre(+k);
      cases.push({ code: +k, e: e, av: PP.avance(+k) + p.interlettre, l: e ? e.x1 - e.x0 + 1 : 0, h: e ? e.y1 - e.y0 + 1 : 0, dx: e ? e.x0 : 0, dy: e ? e.y0 : 0, x: 0, y: 0 });
    }
    cases.sort(function (a, b) { return a.code - b.code; });
    if (o.mode === 'grille') {
      cases.forEach(function (c) {
        if (c.e) { origine = Math.max(origine, -c.e.x0); }
      });
      cases.forEach(function (c) { cl = Math.max(cl, origine + Math.max(c.av, c.e ? c.e.x1 + 1 : 0)); });
      l = cl * COLONNES; h = p.h * Math.ceil(cases.length / COLONNES);
      masque = new Uint8Array(l * h);
      cases.forEach(function (c, i) {
        c.x = (i % COLONNES) * cl; c.y = Math.floor(i / COLONNES) * p.h;
        c.l = cl; c.h = p.h; c.dx = -origine; c.dy = 0;
      });
      pl = { cl: cl, ch: p.h, origine: origine, colonnes: COLONNES };
    } else {
      var aire = 0, ordre = cases.filter(function (c) { return c.e; }).sort(function (a, b) { return b.h - a.h || a.code - b.code; });
      ordre.forEach(function (c) { aire += (c.l + 1) * (c.h + 1); });
      l = Math.max(pot(Math.ceil(Math.sqrt(aire * 1.15))), 16);
      ordre.forEach(function (c) { l = Math.max(l, pot(c.l + 2)); });
      x = 1; y = 1; rang = 0;
      ordre.forEach(function (c) {
        if (x + c.l + 1 > l) { x = 1; y += rang + 1; rang = 0; }
        c.x = x; c.y = y;
        x += c.l + 1; rang = Math.max(rang, c.h);
      });
      h = y + rang + 1;
      masque = new Uint8Array(l * h);
    }
    cases.forEach(function (c) {
      if (!c.e) return;
      var pix = PP.pixels(c.code), i, j, sx, sy;
      for (j = 0; j < c.h; j++) {
        for (i = 0; i < c.l; i++) {
          sx = c.dx + i + GX; sy = c.dy + j;
          if (sx >= 0 && sx < GL && pix[sy * GL + sx]) masque[(c.y + j) * l + c.x + i] = 1;
        }
      }
    });
    return { l: l, h: h, masque: masque, cases: cases, grille: pl || null };
  };

  // Positions et métriques de la planche, pour dessiner le texte soi-même.
  PP.plancheJSON = function (planche, image) {
    var p = PP.police, o = {
      police: p.nom, style: p.style, image: image, largeur: planche.l, hauteur: planche.h,
      taille: p.h, hauteurDeLigne: p.h + p.interligne, ligneDeBase: p.base, hauteurX: p.hx, hauteurCapitales: p.hcap,
      chasseFixe: p.fixe ? p.chasse + p.interlettre : 0, caracteres: {}, crenage: []
    };
    if (planche.grille) o.grille = { largeurCase: planche.grille.cl, hauteurCase: planche.grille.ch, colonnes: planche.grille.colonnes, origine: planche.grille.origine };
    planche.cases.forEach(function (c) {
      o.caracteres[c.code] = { car: PP.car(c.code), x: c.x, y: c.y, largeur: c.l, hauteur: c.h, decalageX: c.dx, decalageY: c.dy, avance: c.av };
    });
    PP.paires().forEach(function (q) { if (o.caracteres[q.a] && o.caracteres[q.b]) o.crenage.push([q.a, q.b, q.v]); });
    return o;
  };

  // Descripteur BMFont (format texte d'AngelCode).
  PP.bmfont = function (planche, image) {
    var p = PP.police, t = [], ps = PP.paires().filter(function (q) { return PP.utilisable(q.a) && PP.utilisable(q.b); });
    t.push('info face="' + p.nom.replace(/"/g, '') + '" size=' + p.h + ' bold=' + (p.gras ? 1 : 0) + ' italic=' + (p.italique ? 1 : 0) +
      ' charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=1,1 outline=0');
    t.push('common lineHeight=' + (p.h + p.interligne) + ' base=' + p.base + ' scaleW=' + planche.l + ' scaleH=' + planche.h + ' pages=1 packed=0 alphaChnl=0 redChnl=4 greenChnl=4 blueChnl=4');
    t.push('page id=0 file="' + image + '"');
    t.push('chars count=' + planche.cases.length);
    planche.cases.forEach(function (c) {
      t.push('char id=' + c.code + ' x=' + c.x + ' y=' + c.y + ' width=' + c.l + ' height=' + c.h + ' xoffset=' + c.dx + ' yoffset=' + c.dy + ' xadvance=' + c.av + ' page=0 chnl=15');
    });
    if (ps.length) {
      t.push('kernings count=' + ps.length);
      ps.forEach(function (q) { t.push('kerning first=' + q.a + ' second=' + q.b + ' amount=' + q.v); });
    }
    return t.join('\n') + '\n';
  };

  // ---------- Noms de fichiers et CSS ----------
  PP.nomFichier = function () {
    var p = PP.police, s = (p.nom + (PP.STYLES[p.style.trim().toLowerCase()] && !p.gras && !p.italique ? '' : '-' + p.style)).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss');   // ces lettres n'ont pas de décomposition
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'police';
  };

  PP.css = function () {
    var p = PP.police, n = PP.nomsTtf(), f = PP.nomFichier(), famille = n[16] || n[1];
    return '@font-face {\n' +
      '  font-family: "' + famille + '";\n' +
      '  src: url("' + f + '.woff") format("woff"),\n       url("' + f + '.ttf") format("truetype");\n' +
      '  font-weight: ' + (p.gras ? 700 : 400) + ';\n  font-style: ' + (p.italique ? 'italic' : 'normal') + ';\n  font-display: swap;\n}\n\n' +
      '/* Pixels nets : une taille multiple de ' + p.h + ' px (' + p.h + ', ' + p.h * 2 + ', ' + p.h * 3 + '…). */\n' +
      '.' + f + ' {\n  font-family: "' + famille + '", monospace;\n' + (p.gras ? '  font-weight: 700;\n' : '') + (p.italique ? '  font-style: italic;\n' : '') +
      '  font-size: ' + p.h * 2 + 'px;\n  line-height: ' + (p.h + p.interligne) * 2 + 'px;\n  -webkit-font-smoothing: none;\n  font-smooth: never;\n}\n';
  };

  // ---------- Import d'une planche ----------
  // Lit une image RVBA découpée en cases égales et en fait une police. Options : cl, ch (taille d'une case),
  // ox, oy (coin de la première case), ex, ey (écart entre les cases), codes (caractères dans l'ordre de lecture),
  // base (rangées au-dessus de la ligne de base), origine (colonne du début du caractère dans sa case),
  // largeurs (« detecter » : chasse d'après l'encre ; « case » : dessin laissé en place), approche, chasse.
  PP.encreImage = function (rvba, l, h) {
    var m = new Uint8Array(l * h), i, fa = rvba[3], fl = lum(0), d;
    function lum(k) { return rvba[k] * 0.299 + rvba[k + 1] * 0.587 + rvba[k + 2] * 0.114; }
    for (i = 0; i < l * h; i++) {
      if (rvba[i * 4 + 3] < 128) continue;
      if (fa < 128) { m[i] = 1; continue; }
      d = lum(i * 4) - fl;
      if (d > 96 || d < -96) m[i] = 1;
    }
    return m;
  };

  PP.importerPlanche = function (rvba, l, h, o) {
    var m = PP.encreImage(rvba, l, h), cl = Math.max(1, o.cl | 0), ch = PP.borne(o.ch | 0, PP.H_MIN, PP.H_MAX), ox = o.ox | 0, oy = o.oy | 0, ex = o.ex | 0, ey = o.ey | 0;
    var cols = Math.max(1, Math.floor((l - ox + ex) / (cl + ex))), rangs = Math.max(1, Math.floor((h - oy + ey) / (ch + ey)));
    var codes = o.codes || [], origine = o.origine | 0, approche = o.approche === undefined ? 1 : o.approche | 0, i, c, g, x, y, x0, x1, px, py, n = 0;
    var p = PP.policeCreer({ nom: o.nom || 'Planche importée', h: ch, base: o.base, hx: o.hx, hcap: o.hcap, fixe: o.largeurs === 'fixe', chasse: o.chasse || cl - origine, codes: [] });
    for (i = 0; i < codes.length && i < cols * rangs; i++) {
      c = codes[i];
      if (c < 0x20 || p.glyphes[c]) continue;
      px = ox + (i % cols) * (cl + ex); py = oy + Math.floor(i / cols) * (ch + ey);
      g = p.glyphes[c] = { code: c, av: o.chasse || cl - origine, pix: null, comp: null };
      x0 = cl; x1 = -1;
      for (y = 0; y < ch; y++) for (x = 0; x < cl; x++) if (px + x < l && py + y < h && m[(py + y) * l + px + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      if (x1 < 0) {
        if (o.largeurs === 'detecter') g.av = Math.max(2, Math.round(ch / 3));
        continue;
      }
      n++;
      g.pix = new Uint8Array(GL * ch);
      var dec = o.largeurs === 'detecter' ? -x0 : -origine;
      for (y = 0; y < ch; y++) {
        for (x = x0; x <= x1; x++) {
          if (px + x < l && py + y < h && m[(py + y) * l + px + x] && x + dec + GX >= 0 && x + dec + GX < GL) g.pix[y * GL + x + dec + GX] = 1;
        }
      }
      if (o.largeurs === 'detecter') g.av = Math.min(PP.AV_MAX, x1 - x0 + 1 + approche);
    }
    if (!n) throw new Error('Aucun caractère trouvé : vérifie la taille des cases et la couleur du fond.');
    p.courant = p.glyphes[65] ? 65 : +Object.keys(p.glyphes)[0];
    return p;
  };
})();
