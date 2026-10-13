(function () {
  'use strict';

  var racine = typeof window !== 'undefined' ? window : globalThis;
  var P = racine.Palettes;

  var FORMAT = 'palette';
  var FORMAT_ATELIER = 'atelier-pixel';   // le format de projet d'Atelier Pixel, version 1
  var ATELIER_COTE_MAX = 1024;            // côté maximal d'un sprite dans Atelier Pixel
  var MONO_MAX = 6;                       // jusqu'à ce nombre de couleurs, une palette habille les textures par clarté seule

  // Une palette lue ou écrite : { nom, couleurs: ['rrggbb', …] }.
  P.FORMATS = [
    { id: 'hex', nom: 'Liste .hex', ext: 'hex', type: 'text/plain' },
    { id: 'gpl', nom: 'GIMP .gpl', ext: 'gpl', type: 'text/plain' },
    { id: 'pal', nom: 'JASC .pal', ext: 'pal', type: 'text/plain' },
    { id: 'css', nom: 'Variables CSS', ext: 'css', type: 'text/css' },
    { id: 'json', nom: 'JSON', ext: 'json', type: 'application/json' }
  ];

  function nomPropre(s) { return String(s === undefined || s === null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40); }
  function propres(liste) {
    var out = [];
    (liste || []).forEach(function (h) { h = P.hexPropre(h); if (h && out.length < P.COULEURS_MAX) out.push(h); });
    return out;
  }
  P.nomPropre = nomPropre;

  // ---------- Écriture ----------
  var ecrire = {
    hex: function (p) { return p.couleurs.join('\n') + '\n'; },
    gpl: function (p) {
      return 'GIMP Palette\nName: ' + (nomPropre(p.nom) || 'Palette') + '\nColumns: ' + Math.min(16, p.couleurs.length) + '\n#\n' + p.couleurs.map(function (h) {
        var c = P.hexVersRgb(h);
        return ('  ' + c[0]).slice(-3) + ' ' + ('  ' + c[1]).slice(-3) + ' ' + ('  ' + c[2]).slice(-3) + '\t#' + h;
      }).join('\n') + '\n';
    },
    pal: function (p) {
      return 'JASC-PAL\r\n0100\r\n' + p.couleurs.length + '\r\n' + p.couleurs.map(function (h) { return P.hexVersRgb(h).join(' '); }).join('\r\n') + '\r\n';
    },
    css: function (p) {
      return '/* ' + (nomPropre(p.nom).replace(/\*\//g, '') || 'Palette') + ' */\n:root {\n' + p.couleurs.map(function (h, i) { return '  --couleur-' + (i + 1) + ': #' + h + ';'; }).join('\n') + '\n}\n';
    },
    json: function (p) {
      return JSON.stringify({ format: FORMAT, version: 1, nom: nomPropre(p.nom), couleurs: p.couleurs.map(function (h) { return '#' + h; }) }, null, 2) + '\n';
    }
  };
  P.ecrire = function (format, p) { return ecrire[format]({ nom: p.nom, couleurs: propres(p.couleurs) }); };

  // ---------- Lecture ----------
  function triplets(lignes) {
    var out = [];
    lignes.forEach(function (l) {
      var m = /^\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s|$)/.exec(l);
      if (m && m[1] < 256 && m[2] < 256 && m[3] < 256) out.push(P.rgbVersHex([Number(m[1]), Number(m[2]), Number(m[3])]));
    });
    return out;
  }

  // Les codes d'une ligne qui ne porte que des codes, avec ou sans « # » ; null si elle porte autre chose.
  // Huit chiffres : la transparence de fin est ignorée.
  function codes(l) {
    var out = [];
    // Trois nombres : un triplet rouge, vert, bleu plutôt que trois codes.
    if (/^\s*\d{1,3}(?:[\s,;]+\d{1,3}){2}\s*$/.test(l)) return null;
    return l.split(/[\s,;]+/).every(function (mot) {
      var m = /^(?:#|0x)?([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})$/i.exec(mot);
      if (m) out.push(m[1].slice(0, 6));
      return m || !mot;
    }) && out.length ? out : null;
  }

  var lire = {
    hex: function (t) {
      var out = [];
      t.split(/\r?\n/).forEach(function (l) {
        var re = /(?:^|[^\w&])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi, c, m;
        l = l.replace(/\/\/.*$/, '');
        // « ; » sépare des codes, ou ouvre un commentaire. Dans une ligne de texte, seuls les codes en « # » comptent.
        c = codes(l) || codes(l.replace(/;.*$/, ''));
        if (!c && !/^\s*;/.test(l)) { c = []; while ((m = re.exec(l))) c.push(m[1].slice(0, 6)); }
        if (c) out = out.concat(c);
      });
      return { nom: '', couleurs: out };
    },
    gpl: function (t) {
      var lignes = t.split(/\r?\n/), nom = '', corps = [];
      lignes.forEach(function (l, i) {
        var m = /^Name:\s*(.*)$/i.exec(l);
        if (m) nom = m[1];
        else if (i > 0 && !/^\s*#/.test(l) && !/^[A-Za-z]+:/.test(l)) corps.push(l);
      });
      return { nom: nom, couleurs: triplets(corps) };
    },
    pal: function (t) { return { nom: '', couleurs: triplets(t.split(/\r?\n/).slice(3)) }; },
    css: function (t) {
      var nom = /^\s*\/\*\s*([\s\S]*?)\s*\*\//.exec(t), out = [], re = /:\s*#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi, m;
      while ((m = re.exec(t))) out.push(m[1].length === 8 ? m[1].slice(0, 6) : m[1]);
      return { nom: nom ? nom[1] : '', couleurs: out };
    },
    json: function (t) {
      var o = JSON.parse(t), liste;
      // Notre format, un projet Atelier Pixel, le JSON de Lospec ou une simple liste.
      liste = Array.isArray(o) ? o : o && (o.couleurs || o.palette || o.colors);
      if (!Array.isArray(liste)) throw new Error('Ce JSON ne contient pas de liste de couleurs.');
      return { nom: Array.isArray(o) ? '' : o.nom || o.name || '', couleurs: liste.map(function (c) { return typeof c === 'string' ? c.replace(/^(#?[0-9a-f]{6})[0-9a-f]{2}$/i, '$1') : ''; }) };
    }
  };

  P.devinerFormat = function (texte, nomFichier) {
    var ext = /\.([a-z0-9]+)$/i.exec(nomFichier || ''), debut = texte.replace(/^﻿/, '').trimStart();
    if (/^GIMP Palette/i.test(debut)) return 'gpl';
    if (/^JASC-PAL/i.test(debut)) return 'pal';
    if (/^[\[{]/.test(debut)) return 'json';
    if (ext && lire[ext[1].toLowerCase()]) return ext[1].toLowerCase();
    if (/--[\w-]+\s*:|\{/.test(debut)) return 'css';
    return 'hex';
  };

  // Lit un texte dans le format donné (deviné s'il est omis). Lève une erreur s'il n'y a aucune couleur.
  P.lire = function (texte, format, nomFichier) {
    var p;
    texte = String(texte).replace(/^﻿/, '');
    format = format || P.devinerFormat(texte, nomFichier);
    try { p = lire[format](texte); } catch (e) { throw new Error(e instanceof SyntaxError ? 'Ce fichier JSON est illisible.' : e.message); }
    p = { nom: nomPropre(p.nom), couleurs: propres(p.couleurs), format: format };
    if (!p.couleurs.length) throw new Error('Aucune couleur trouvée dans ce fichier.');
    return p;
  };

  // ---------- Image en bande ----------
  // Une couleur par case de « cote » pixels, sur « colonnes » cases par ligne (toutes sur une ligne par défaut).
  P.bande = function (couleurs, cote, colonnes) {
    cote = Math.max(1, Math.round(cote) || 1);
    var n = couleurs.length, cols = Math.max(1, Math.min(n, Math.round(colonnes) || n)), rangs = Math.ceil(n / cols), w = cols * cote, h = rangs * cote;
    var data = new Uint8ClampedArray(w * h * 4), i, c, x, y, p;
    for (i = 0; i < n; i++) {
      c = P.hexVersRgb(couleurs[i]);
      for (y = 0; y < cote; y++) {
        for (x = 0; x < cote; x++) {
          p = ((Math.floor(i / cols) * cote + y) * w + (i % cols) * cote + x) * 4;
          data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
        }
      }
    }
    return { w: w, h: h, data: data };
  };

  // Les couleurs distinctes d'une image, dans l'ordre de lecture : relit une bande, agrandie ou non.
  P.depuisPixels = function (data, w, h) {
    var vues = {}, out = [], i, k;
    for (i = 0; i < w * h * 4; i += 4) {
      if (data[i + 3] < 128) continue;
      k = data[i] << 16 | data[i + 1] << 8 | data[i + 2];
      if (vues[k]) continue;
      vues[k] = true;
      if (out.length >= P.COULEURS_MAX) return { couleurs: out, tronquee: true };
      out.push(P.rgbVersHex([data[i], data[i + 1], data[i + 2]]));
    }
    return { couleurs: out, tronquee: false };
  };

  // ---------- Vers Atelier Pixel ----------
  // Même codage que l'éditeur : plages [longueur, r, v, b, a] puis base64. data est un tampon RVBA.
  function coder(data, n) {
    var s = '', i = 0, run, p, q;
    while (i < n) {
      p = i * 4; run = 1;
      if (data[p + 3] < 128) {
        while (run < 255 && i + run < n && data[(i + run) * 4 + 3] < 128) run++;
        s += String.fromCharCode(run, 0, 0, 0, 0);
      } else {
        for (q = p + 4; run < 255 && i + run < n && data[q + 3] >= 128 && data[q] === data[p] && data[q + 1] === data[p + 1] && data[q + 2] === data[p + 2]; q += 4) run++;
        s += String.fromCharCode(run, data[p], data[p + 1], data[p + 2], 255);
      }
      i += run;
    }
    return btoa(s);
  }

  // Un projet Atelier Pixel portant la palette. image (facultative) : { w, h, data RVBA } posée sur le calque ;
  // sans elle la toile est vide, de w × h pixels.
  P.versAtelier = function (p, o) {
    o = o || {};
    var im = o.image, w = im ? im.w : P.borne(Math.round(o.w) || 32, 1, ATELIER_COTE_MAX), h = im ? im.h : P.borne(Math.round(o.h) || 32, 1, ATELIER_COTE_MAX), cels = {};
    if (w > ATELIER_COTE_MAX || h > ATELIER_COTE_MAX) throw new Error('Atelier Pixel n\'ouvre pas de sprite de plus de ' + ATELIER_COTE_MAX + ' px de côté.');
    if (im) cels[1] = coder(im.data, w * h);
    return {
      format: FORMAT_ATELIER, version: 1, w: w, h: h, iImage: 0, iCalque: 0,
      palette: propres(p.couleurs).map(function (c) { return '#' + c; }),
      calques: [{ id: 1, nom: (nomPropre(p.nom) || 'Calque 1'), visible: true, opacite: 1, verrou: false }],
      images: [{ duree: 100, cels: cels }]
    };
  };
  P.ATELIER_COTE_MAX = ATELIER_COTE_MAX;

  // ---------- Vers Textures ----------
  // Textures garde dans son adresse une teinte par ton de chaque rampe de la matière (« te= »). On y range,
  // pour chaque ton d'origine, la couleur de la palette qui lui ressemble le plus ; dans une rampe, une couleur
  // déjà prise n'est reprise que faute de voisine acceptable, et les tons restent rangés du sombre au clair.
  // rampes : [{ hex: ['rrggbb', …] }], telles que les déclare la matière. Rend la liste à plat des teintes.
  P.teintesTextures = function (couleurs, rampes) {
    var pal = propres(couleurs).map(P.hexVersRgb), labs = pal.map(P.rgbVersLab), out = [];
    var mono = pal.length <= MONO_MAX || labs.every(function (l) { return P.labVersLch(l)[1] < 0.05; });
    var src = [], lo = 1, hi = 0, plo = 1, phi = 0;
    rampes.forEach(function (ra) { ra.hex.forEach(function (h) { var l = P.rgbVersLab(P.hexVersRgb(h)); src.push(l); lo = Math.min(lo, l[0]); hi = Math.max(hi, l[0]); }); });
    labs.forEach(function (l) { plo = Math.min(plo, l[0]); phi = Math.max(phi, l[0]); });
    var k = 0;
    rampes.forEach(function (ra) {
      var prises = {}, choix = [], i, j, l, d, mieux, note;
      for (i = 0; i < ra.hex.length; i++, k++) {
        l = src[k]; mieux = 0; note = 1e9;
        for (j = 0; j < labs.length; j++) {
          // Peu de couleurs ou que des gris : seule la clarté compte, étirée sur toute l'étendue de la palette.
          if (mono) d = Math.abs(plo + (l[0] - lo) / (hi - lo || 1) * (phi - plo) - labs[j][0]) * 100;
          else d = P.ecartLab(l, labs[j]) + (prises[j] ? 4.5 : 0);
          if (d < note) { note = d; mieux = j; }
        }
        prises[mieux] = true;
        choix.push(mieux);
      }
      choix.sort(function (a, b) { return labs[a][0] - labs[b][0] || a - b; });
      choix.forEach(function (j) { out.push(P.rgbVersHex(pal[j])); });
    });
    return out;
  };

  // Le fragment d'adresse que Textures relit : matière, graine, taille et teintes.
  P.adresseTextures = function (couleurs, matiere, graine, taille) {
    return '#m=' + matiere.id + '&g=' + encodeURIComponent(graine || 'atelier') + '&t=' + (taille || 32) + '&te=' + P.teintesTextures(couleurs, matiere.rampes).join('.');
  };
})();
