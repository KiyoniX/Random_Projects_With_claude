/*
 * fabrique.js : un écrivain de BCH minimal, pour les tests et les captures.
 *
 * Il fabrique un cube texturé à un os, avec ses animations, dans la mise en page de la version 7
 * (Pokémon X/Y) ou 0x21 (Rubis Oméga/Saphir Alpha), en suivant la façon dont SPICA écrit
 * (H3D.Save, H3DRelocator.ToRelative, PICACommandWriter). Ce n'est pas un convertisseur :
 * il ne sait écrire que ce cube. La page ne le charge pas ; tests.js et le pilote de captures
 * s'en servent. Pose FabriqueBCH (navigateur) ou module.exports (Node).
 */
(function (racine) {
  'use strict';

  var dv4 = new DataView(new ArrayBuffer(4));

  function Tampon() { this.o = []; }
  Tampon.prototype.pos = function () { return this.o.length; };
  Tampon.prototype.u8 = function (v) { var p = this.o.length; this.o.push(v & 0xff); return p; };
  Tampon.prototype.u16 = function (v) { var p = this.o.length; this.o.push(v & 0xff, (v >>> 8) & 0xff); return p; };
  Tampon.prototype.u32 = function (v) { var p = this.o.length; v >>>= 0; this.o.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24); return p; };
  Tampon.prototype.f32 = function (v) { dv4.setFloat32(0, v, true); return this.u32(dv4.getUint32(0, true)); };
  Tampon.prototype.octets = function (a) { var p = this.o.length; for (var i = 0; i < a.length; i++) this.o.push(a[i] & 0xff); return p; };
  Tampon.prototype.zeros = function (n) { var p = this.o.length; for (var i = 0; i < n; i++) this.o.push(0); return p; };
  Tampon.prototype.aligner = function (n) { while (this.o.length % n) this.o.push(0); return this.o.length; };
  Tampon.prototype.poser32 = function (p, v) { v >>>= 0; this.o[p] = v & 0xff; this.o[p + 1] = (v >>> 8) & 0xff; this.o[p + 2] = (v >>> 16) & 0xff; this.o[p + 3] = v >>> 24; };
  Tampon.prototype.poserF32 = function (p, v) { dv4.setFloat32(0, v, true); this.poser32(p, dv4.getUint32(0, true)); };

  // Sections cibles (SPICA H3DSection) : contenu, chaînes, commandes, données, textures, sommets, index 16, index 8.
  var CONTENU = 0, CHAINES = 1, COMMANDES = 2, DONNEES = 4, TEXTURE = 5, SOMMETS = 6, INDEX16 = 7, INDEX8 = 8;

  // ---------------------------------------------------------------- textures
  function morton(i) {
    return { x: (i & 1) | ((i >> 1) & 2) | ((i >> 2) & 4), y: ((i >> 1) & 1) | ((i >> 2) & 2) | ((i >> 3) & 4) };
  }

  // RGBA8 tuilé : tuiles de 8 × 8 en ordre de Morton, première ligne de tuiles = bas de l'image,
  // chaque pixel rangé A, B, G, R.
  function encoderRGBA8(img, l, h) {
    var s = [];
    for (var ty = 0; ty < h; ty += 8) for (var tx = 0; tx < l; tx += 8) for (var k = 0; k < 64; k++) {
      var m = morton(k), o = ((h - 1 - (ty + m.y)) * l + tx + m.x) * 4;
      s.push(img[o + 3], img[o + 2], img[o + 1], img[o]);
    }
    return s;
  }

  // ETC1A4 réduit à des blocs unis : mode individuel, la même couleur sur 4 bits pour les deux moitiés,
  // table 0 et tous les indices à 0 (décalage +2). Couleur décodée = c × 17 + 2. L'alpha reste par pixel.
  function encoderETC1A4(img, l, h) {
    var s = [], XT = [0, 4, 0, 4], YT = [0, 0, 4, 4];
    function mot(t, v) { t.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
    for (var ty = 0; ty < h; ty += 8) for (var tx = 0; tx < l; tx += 8) for (var b = 0; b < 4; b++) {
      var bas = 0, haut = 0, somme = [0, 0, 0];
      for (var py = 0; py < 4; py++) for (var px = 0; px < 4; px++) {
        var y = ty + YT[b] + py, x = tx + XT[b] + px, o = ((h - 1 - y) * l + x) * 4;
        var a = Math.round(img[o + 3] / 17) & 0xf, dec = (px * 4 + py) * 4;
        if (dec < 32) bas = (bas | (a << dec)) >>> 0; else haut = (haut | (a << (dec - 32))) >>> 0;
        somme[0] += img[o]; somme[1] += img[o + 1]; somme[2] += img[o + 2];
      }
      mot(s, bas); mot(s, haut);
      var c = somme.map(function (v) { return Math.max(0, Math.min(15, Math.round((v / 16 - 2) / 17))); });
      var hautC = ((c[0] << 28) | (c[0] << 24) | (c[1] << 20) | (c[1] << 16) | (c[2] << 12) | (c[2] << 8)) >>> 0;
      mot(s, 0); mot(s, hautC);
    }
    return s;
  }

  // Petite police 5 × 7 pour l'étiquette de la caisse.
  var GLYPHES = {
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001']
  };

  // Image de la caisse : planches de bois, cadre, clous et une étiquette « BCH ».
  function imageCaisse(l) {
    var img = new Uint8Array(l * l * 4);
    function px(x, y, c) { var o = (y * l + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255; }
    for (var y = 0; y < l; y++) for (var x = 0; x < l; x++) {
      var planche = Math.floor(y / 10) % 2 ? [176, 125, 72] : [156, 107, 58];
      if (y % 10 === 0) planche = [90, 58, 30];
      var grain = ((x * 7 + y * 13) % 11 === 0) ? -12 : 0;
      px(x, y, [planche[0] + grain, planche[1] + grain, planche[2] + grain]);
      if (x < 5 || y < 5 || x >= l - 5 || y >= l - 5) px(x, y, [107, 68, 37]);
    }
    [[2, 2], [l - 3, 2], [2, l - 3], [l - 3, l - 3]].forEach(function (c) { px(c[0], c[1], [214, 180, 104]); });
    var lx = 12, ly = 23, lw = l - 24, lh = 18;
    for (var j = 0; j < lh; j++) for (var i = 0; i < lw; i++) px(lx + i, ly + j, (j === 0 || j === lh - 1 || i === 0 || i === lw - 1) ? [58, 42, 28] : [239, 228, 200]);
    'BCH'.split('').forEach(function (lettre, n) {
      var g = GLYPHES[lettre];
      for (var r = 0; r < 7; r++) for (var c = 0; c < 5; c++) if (g[r][c] === '1') {
        for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 2; dx++) px(lx + 5 + n * 12 + c * 2 + dx, ly + 2 + r * 2 + dy, [58, 42, 28]);
      }
    });
    return img;
  }

  // Image du couvercle : une grille de laiton ajourée (l'alpha fait les trous).
  function imageCouvercle(l) {
    var img = new Uint8Array(l * l * 4);
    for (var y = 0; y < l; y++) for (var x = 0; x < l; x++) {
      var o = (y * l + x) * 4, bx = Math.floor(x / 4), by = Math.floor(y / 4);
      var bord = bx === 0 || by === 0 || bx === l / 4 - 1 || by === l / 4 - 1;
      var c = bord ? [110, 72, 40] : ((bx + by) % 2 ? [200, 160, 72] : [180, 140, 60]);
      img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
      var trou = !bord && (x % 4 === 1 || x % 4 === 2) && (y % 4 === 1 || y % 4 === 2);
      img[o + 3] = trou ? 0 : 255;
    }
    return img;
  }

  // ---------------------------------------------------------------- l'écrivain
  function Ecrivain(version) {
    this.version = version;
    this.contenu = new Tampon();
    this.chaines = new Tampon();
    this.commandes = new Tampon();
    this.donnees = new Tampon();
    this.relocs = [];
    this.dico = {};
  }
  Ecrivain.prototype.chaine = function (s) {
    if (this.dico[s] !== undefined) return this.dico[s];
    var p = this.chaines.pos();
    var oct = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : s.split('').map(function (c) { return c.charCodeAt(0); });
    this.chaines.octets(oct); this.chaines.u8(0);
    this.dico[s] = p;
    return p;
  };
  // Pointeur dans le contenu vers une section (valeur relative au début de la cible).
  Ecrivain.prototype.ptr = function (cible, valeur) {
    var p = this.contenu.u32(valeur || 0);
    this.relocs.push({ source: CONTENU, pos: p, cible: cible });
    return p;
  };
  Ecrivain.prototype.nom = function (s) { return this.ptr(CHAINES, this.chaine(s)); };
  Ecrivain.prototype.fixer = function (p, v) { this.contenu.poser32(p, v); };

  // Liste de commandes PICA : [registre, [paramètres], options]. options.reloc : section visée par le
  // premier paramètre (adresse) ; options.consecutif : écriture sur des registres consécutifs.
  Ecrivain.prototype.cmd = function (liste) {
    var T = this.commandes;
    T.aligner(8);
    var debut = T.pos();
    for (var i = 0; i < liste.length; i++) {
      var reg = liste[i][0], params = liste[i][1], opt = liste[i][2] || {};
      var p = T.u32(params[0]);
      if (opt.reloc !== undefined) this.relocs.push({ source: COMMANDES, pos: p, cible: opt.reloc });
      T.u32((reg | (0xf << 16) | ((params.length - 1) << 20) | (opt.consecutif ? 0x80000000 : 0)) >>> 0);
      for (var k = 1; k < params.length; k++) T.u32(params[k]);
      if ((T.pos() - debut) % 8) T.u32(0);
    }
    return { ptr: debut, mots: (T.pos() - debut) / 4 };
  };

  // Uniformes du shader de sommets : trois mots par vecteur en 24 bits, ou quatre (W, Z, Y, X) en 32 bits.
  function uniformes(reg, vecteurs, en32) {
    var params = [];
    vecteurs.forEach(function (v) {
      if (en32) { params.push(f2u(v[3]), f2u(v[2]), f2u(v[1]), f2u(v[0])); }
      else params.push.apply(params, motsF24(v[0], v[1], v[2], v[3]));
    });
    return [[0x2c0, [(reg | (en32 ? 0x80000000 : 0)) >>> 0]], [0x2c1, params]];
  }
  function f2u(f) { dv4.setFloat32(0, f, true); return dv4.getUint32(0, true); }
  function f24(f) {
    if (f === 0) return 0;
    var b = f2u(f), s = b >>> 31, e = ((b >>> 23) & 0xff) - 64, m = (b >>> 7) & 0xffff;
    if (e <= 0) return s << 23;
    return (s << 23) | (Math.min(e, 0x7f) << 16) | m;
  }
  function motsF24(x, y, z, w) {
    var X = f24(x), Y = f24(y), Z = f24(z), W = f24(w);
    return [((Z >>> 16) | (W << 8)) >>> 0, ((Y >>> 8) | ((Z & 0xffff) << 16)) >>> 0, (X | ((Y & 0xff) << 24)) >>> 0];
  }

  // Assemble le fichier : en-tête, contenu, chaînes, commandes, données, relocalisation.
  Ecrivain.prototype.assembler = function () {
    var v = this.version, ext = v >= 0x21;
    var tailleEntete = 8 + (ext ? 6 : 5) * 4 * 2 + 8 + (v >= 8 ? 4 : 0);
    function al(n, a) { return Math.ceil(n / a) * a; }
    var aC = al(tailleEntete, 0x10), lC = al(this.contenu.pos(), 0x10);
    var aS = aC + lC, lS = al(this.chaines.pos(), 0x10);
    var aM = aS + lS, lM = al(this.commandes.pos(), 0x10);
    var aD = al(aM + lM, 0x80), lD = al(this.donnees.pos(), 0x10);
    var aR = aD + lD;
    var self = this;
    var reloc = new Tampon();
    this.relocs.forEach(function (r) {
      var adr = r.cible === CHAINES ? r.pos : r.pos >> 2;
      if (r.cible !== CHAINES && (r.pos & 3)) throw new Error('pointeur non aligné');
      var cible = r.cible;
      if (v > 7 && v < 0x21 && cible >= SOMMETS) cible += 1;      // inverse de GetLegacyRelocDiff
      if (v < 7 && cible >= 3) cible -= 1;
      if (v <= 7 && cible === TEXTURE) cible = DONNEES;           // Ohana : 0x24 pour les textures en version 7
      reloc.u32((adr | ((cible | (r.source << 4)) << 25)) >>> 0);
    });
    var lR = reloc.pos();
    var total = aR + lR;
    var sortie = new Uint8Array(total);
    var e = new Tampon();
    e.octets([0x42, 0x43, 0x48, 0]);
    e.u8(v); e.u8(v); e.u16(v >= 0x21 ? 42607 : 38497);
    e.u32(aC); e.u32(aS); e.u32(aM); e.u32(aD); if (ext) e.u32(0); e.u32(aR);
    e.u32(this.contenu.pos()); e.u32(this.chaines.pos()); e.u32(this.commandes.pos()); e.u32(this.donnees.pos()); if (ext) e.u32(0); e.u32(lR);
    e.u32(0); e.u32(0);
    if (v >= 8) { e.u16(0); e.u16(self.relocs.length); }
    sortie.set(e.o, 0);
    sortie.set(this.contenu.o, aC);
    sortie.set(this.chaines.o, aS);
    sortie.set(this.commandes.o, aM);
    sortie.set(this.donnees.o, aD);
    sortie.set(reloc.o, aR);
    return sortie;
  };

  // ---------------------------------------------------------------- courbes
  // Écrit une courbe à images clés et renvoie sa position dans le contenu.
  Ecrivain.prototype.courbe = function (c) {
    var C = this.contenu, v = this.version;
    var debut = C.pos();
    C.f32(c.debut || 0); C.f32(c.fin); C.u8(0); C.u8(0); C.u16(0);
    var interne = null, ptrCles;
    var vs = c.echelleValeur || 1, vo = c.decalageValeur || 0, fs = c.echelleImage || 1;
    if (v >= 0x20) {
      C.u8(c.interpolation); C.u8(c.quantification); C.u16(c.cles.length);
      C.f32(vs); C.f32(vo); C.f32(fs); C.f32(1 / c.fin);
      ptrCles = this.ptr(CONTENU, 0);
    } else {
      interne = this.ptr(CONTENU, 0);
      var pi = C.pos();
      this.fixer(interne, pi);
      C.f32(c.debut || 0); C.f32(c.fin); C.u8(c.interpolation); C.u8(c.quantification); C.u16(c.cles.length);
      C.f32(1 / c.fin); C.f32(vs); C.f32(vo); C.f32(fs);
      ptrCles = this.ptr(CONTENU, 0);
    }
    this.fixer(ptrCles, C.pos());
    c.cles.forEach(function (k) {
      var f = k[0] / fs, val = (k[1] - vo) / vs;
      switch (c.quantification) {
        case 0: C.f32(f); C.f32(val); C.f32(k[2] || 0); C.f32(k[3] || 0); break;                       // Hermite128
        case 2: {                                                                                         // Hermite48
          C.u8(Math.round(f)); C.u16(Math.round(val));
          var s = ((Math.round((k[2] || 0) * 32) & 0xfff) | ((Math.round((k[3] || 0) * 32) & 0xfff) << 12)) >>> 0;
          C.u8(s); C.u8(s >>> 8); C.u8(s >>> 16); break;
        }
        case 6: C.f32(f); C.f32(val); break;                                                            // StepLinear64
        case 7: C.u32(((Math.round(f) & 0xfff) | ((Math.round(val) & 0xfffff) << 12)) >>> 0); break;    // StepLinear32
        default: throw new Error('quantification non prise en charge par l’écrivain');
      }
    });
    C.aligner(4);
    return debut;
  };

  // ---------------------------------------------------------------- le cube
  function faces() {
    return [
      { n: [0, 0, 1], c: [[-1, 0, 1], [1, 0, 1], [1, 2, 1], [-1, 2, 1]] },
      { n: [0, 0, -1], c: [[1, 0, -1], [-1, 0, -1], [-1, 2, -1], [1, 2, -1]] },
      { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, -1], [1, 2, -1], [1, 2, 1]] },
      { n: [-1, 0, 0], c: [[-1, 0, -1], [-1, 0, 1], [-1, 2, 1], [-1, 2, -1]] },
      { n: [0, -1, 0], c: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]] }
    ];
  }
  var UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

  function cube(options) {
    options = options || {};
    var version = options.version || 0x21;
    var W = new Ecrivain(version), C = W.contenu, D = W.donnees;

    // -- textures dans les données brutes
    D.aligner(0x80);
    var adrCaisse = D.octets(encoderRGBA8(imageCaisse(64), 64, 64));
    D.aligner(0x80);
    var adrCouv = D.octets(encoderETC1A4(imageCouvercle(32), 32, 32));
    D.aligner(0x80);

    // -- sommets du corps : position flottante, normale flottante, UV en courts (÷ 4096),
    //    couleur en octets (÷ 255), indice d'os et poids (× 0,01) en octets. 34 octets par sommet.
    var corps = new Tampon(), indicesCorps = [];
    faces().forEach(function (f, i) {
      f.c.forEach(function (p, k) {
        [p[0], p[1], p[2], f.n[0], f.n[1], f.n[2]].forEach(function (x) { corps.f32(x); });
        corps.u16(UV[k][0] * 4096); corps.u16(UV[k][1] * 4096);
        var g = f.n[1] < 0 ? 170 : 255;
        corps.octets([g, g, g, 255, 0, 100]);
      });
      indicesCorps.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    D.aligner(4);
    var adrCorps = D.octets(corps.o);
    D.aligner(2);
    var adrIdxCorps = D.pos();
    indicesCorps.forEach(function (i) { D.u16(i); });

    // -- couvercle, dans l'espace de l'os (posé en y = 1) : position en courts (× 0,001, décalage 0,5),
    //    normale en octets signés (÷ 127), UV flottants alignés sur 2 octets. 18 octets par sommet.
    //    L'os et la couleur sont des attributs fixes ; une bande de 4 indices sur 8 bits.
    var couv = new Tampon();
    [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]].forEach(function (p, k) {
      couv.u16(p[0] * 1000); couv.u16((p[1] - 0.5) * 1000); couv.u16(p[2] * 1000);
      couv.octets([0, 127, 0, 0]);
      couv.f32(UV[k][0]); couv.f32(UV[k][1]);
    });
    D.aligner(4);
    var adrCouvS = D.octets(couv.o);
    var adrIdxCouv = D.octets([0, 1, 3, 2]);

    // -- commandes GPU
    function enteteAttributs(attrs, fixes, pas) {
      var fmtB = 0, fmtH = 0, perm = 0, permH = 0, att = 0;
      attrs.forEach(function (a, i) {
        var f = (a.format | ((a.elements - 1) << 2)) & 0xf;
        if (i < 8) fmtB |= f << (i * 4); else fmtH |= f << ((i - 8) * 4);
        if (i < 8) perm |= a.nom << (i * 4); else permH |= a.nom << ((i - 8) * 4);
        att |= i << (i * 4);
      });
      var total = attrs.length + fixes.length;
      fixes.forEach(function (f, k) {
        var i = attrs.length + k;
        fmtH |= 1 << (16 + i);
        if (i < 8) perm |= f.nom << (i * 4); else permH |= f.nom << ((i - 8) * 4);
      });
      fmtH |= (total - 1) << 28;
      var l = [
        [0x201, [fmtB >>> 0]], [0x202, [fmtH >>> 0]],
        [0x204, [att >>> 0]], [0x205, [((pas & 0xff) << 16 | (attrs.length << 28)) >>> 0]],
        [0x242, [total - 1]],
        [0x2bb, [perm >>> 0]], [0x2bc, [permH >>> 0]]
      ];
      fixes.forEach(function (f, k) {
        l.push([0x232, [attrs.length + k]]);
        l.push([0x233, motsF24(f.v[0], f.v[1], f.v[2], f.v[3]), { consecutif: true }]);
      });
      return l;
    }
    var cmdCorps = W.cmd([[0x203, [adrCorps], { reloc: SOMMETS }]]
      .concat(enteteAttributs([
        { nom: 0, format: 3, elements: 3 }, { nom: 1, format: 3, elements: 3 }, { nom: 4, format: 2, elements: 2 },
        { nom: 3, format: 1, elements: 4 }, { nom: 7, format: 1, elements: 1 }, { nom: 8, format: 1, elements: 1 }], [], 34))
      .concat(uniformes(6, [[0, 0, 0, 0]], true))
      .concat(uniformes(7, [[1, 1, 0, 1 / 255], [1 / 4096, 0, 0, 0.01]], true)));
    var cmdCouv = W.cmd([[0x203, [adrCouvS], { reloc: SOMMETS }]]
      .concat(enteteAttributs([
        { nom: 0, format: 2, elements: 3 }, { nom: 1, format: 0, elements: 3 }, { nom: 4, format: 3, elements: 2 }],
      [{ nom: 7, v: [0, 0, 0, 0] }, { nom: 3, v: [1, 0.94, 0.82, 1] }], 18))
      .concat(uniformes(6, [[0, 0.5, 0, 0]], false))
      .concat(uniformes(7, [[0.001, 1 / 127, 0, 1], [1, 0, 0, 1]], false)));
    var smCorps = W.cmd([
      [0x2b0, [0x7fff0002]], [0x227, [adrIdxCorps], { reloc: INDEX16 }], [0x228, [indicesCorps.length]], [0x25e, [0 << 8]]]);
    var smCouv = W.cmd([
      [0x2b0, [0x7fff0004]], [0x227, [adrIdxCouv], { reloc: INDEX8 }], [0x228, [4]], [0x25e, [1 << 8]]]);
    function cmdTexture(l, h, adr, format) {
      return W.cmd([[0x82, [(h | (l << 16)) >>> 0]], [0x84, [1]], [0x85, [adr], { reloc: TEXTURE }], [0x8e, [format]]]);
    }
    var texCaisse = cmdTexture(64, 64, adrCaisse, 0);
    var texCouv = cmdTexture(32, 32, adrCouv, 13);
    // Commandes du fragment : test alpha, mélange (désactivé : One, Zero), profondeur.
    function fragment(alpha) {
      return W.cmd([
        [0x100, [0xe40100]], [0x101, [(1 << 16) | (0 << 20) | (1 << 24) | (0 << 28)]],
        [0x104, [alpha ? (1 | (7 << 4) | (0x80 << 8)) : 0]], [0x107, [1 | (5 << 4) | (0xf << 8) | (1 << 12)]]]);
    }
    var fshCaisse = fragment(false), fshCouv = fragment(true);

    // -- en-tête du contenu : quinze dictionnaires (table, nombre, arbre)
    var dicos = [];
    for (var d = 0; d < 15; d++) dicos.push({ table: W.ptr(CONTENU, 0), nombre: C.u32(0), arbre: C.u32(0) });

    // -- textures
    C.aligner(4);
    W.fixer(dicos[3].table, C.pos()); C.poser32(dicos[3].nombre, 2);
    var tabTex = [W.ptr(CONTENU, 0), W.ptr(CONTENU, 0)];
    [[texCaisse, 0, 'caisse'], [texCouv, 13, 'couvercle']].forEach(function (t, i) {
      W.fixer(tabTex[i], C.pos());
      W.ptr(COMMANDES, t[0].ptr); C.u32(t[0].mots);
      C.u32(0); C.u32(0); C.u32(0); C.u32(0);
      C.u8(t[1]); C.u8(1); C.u16(0);
      W.nom(t[2]);
    });

    // -- modèle
    W.fixer(dicos[0].table, C.pos()); C.poser32(dicos[0].nombre, 1);
    var tabModele = W.ptr(CONTENU, 0);
    var M = C.pos();
    W.fixer(tabModele, M);
    C.u8(0); C.u8(0); C.u16(0);
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0].forEach(function (x) { C.f32(x); });
    var mMat = { table: W.ptr(CONTENU, 0), nombre: C.u32(2), arbre: C.u32(0) };
    var mMail = { table: W.ptr(CONTENU, 0), nombre: C.u32(2) };
    C.zeros(32);                                   // quatre couches (non relues)
    if (version > 6) C.zeros(8);                   // cullings
    var mSq = { table: W.ptr(CONTENU, 0), nombre: C.u32(1), arbre: W.ptr(CONTENU, 0) };
    var mVis = { table: W.ptr(CONTENU, 0), nombre: C.u32(2) };
    W.nom('cube_de_test');
    C.u32(2);
    var mArbre = W.ptr(CONTENU, 0);
    C.u32(0); C.u32(0);

    // matériaux (en ligne)
    var parametres = [];
    var materiaux = [['mat_caisse', 'caisse'], ['mat_couvercle', 'couvercle']];
    W.fixer(mMat.table, C.pos());
    materiaux.forEach(function (m) {
      parametres.push(W.ptr(CONTENU, 0));
      C.u32(0); C.u32(0); C.u32(0);
      C.u32(0); C.u32(0);                           // commandes de texture (non relues)
      function mappeur() { C.u8(0); C.u8(2); C.u8(2); C.u8(1); C.u8(1); C.u8(0); C.u16(0); C.f32(0); C.u32(0xffffffff); }
      var pm = null;
      if (version >= 0x21) pm = W.ptr(CONTENU, 0); else { mappeur(); mappeur(); mappeur(); }
      W.nom(m[1]); C.u32(0); C.u32(0); W.nom(m[0]);
      m.mappeur = pm;
    });
    materiaux.forEach(function (m) {
      if (m.mappeur !== null) { W.fixer(m.mappeur, C.pos()); for (var k = 0; k < 3; k++) { C.u8(0); C.u8(2); C.u8(2); C.u8(1); C.u8(1); C.u8(0); C.u16(0); C.f32(0); C.u32(0xffffffff); } }
    });
    // paramètres des matériaux : coordonnée de texture 0, puis commandes du fragment
    // (à +0xC8 comme SPICA en 0x21, à +0xC0 comme Ohana en version 7)
    [fshCaisse, fshCouv].forEach(function (f, i) {
      C.aligner(4);
      var P = C.pos();
      W.fixer(parametres[i], P);
      C.zeros(0x110);
      C.o[P + 12] = 0; C.o[P + 13] = 0; C.o[P + 14] = 0; C.o[P + 15] = 0xff;
      C.poserF32(P + 16, 1); C.poserF32(P + 20, 1);
      var off = version >= 0x21 ? 0xc8 : 0xc0;
      C.poser32(P + off, f.ptr); W.relocs.push({ source: CONTENU, pos: P + off, cible: COMMANDES });
      C.poser32(P + off + 4, f.mots);
    });

    // maillages (en ligne, 0x38 octets)
    W.fixer(mMail.table, C.pos());
    var sousPtr = [];
    [[0, 0, cmdCorps, 2], [1, 1, cmdCouv, 1]].forEach(function (m) {
      C.u16(m[0]); C.u8(m[3] << 2); C.u8(0); C.u16(m[1]); C.u16(m[1]);
      W.ptr(COMMANDES, m[2].ptr); C.u32(m[2].mots);
      sousPtr.push(W.ptr(CONTENU, 0)); C.u32(1);
      C.u32(0); C.u32(0);
      C.f32(0); C.f32(1); C.f32(0);
      W.ptr(CONTENU, M); C.u32(0); C.u32(0);
    });
    // sous-maillages (0x34 octets) : peau lisse pour le corps, rigide pour le couvercle
    [[1, smCorps], [2, smCouv]].forEach(function (s, i) {
      W.fixer(sousPtr[i], C.pos());
      C.u8(s[0]); C.u8(0); C.u16(1);
      C.u16(0); C.zeros(38);
      W.ptr(COMMANDES, s[1].ptr); C.u32(s[1].mots);
    });

    // squelette : un os « racine » posé en (0, 1, 0)
    W.fixer(mSq.table, C.pos());
    C.u32(0); C.u16(0xffff); C.u16(0);
    [1, 1, 1, 0, 0, 0, 0, 1, 0].forEach(function (x) { C.f32(x); });
    [1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0].forEach(function (x) { C.f32(x); });
    W.nom('racine'); C.u32(0);
    function arbre(noms) {
      var p = C.pos();
      C.u32(0xffffffff); C.u16(1); C.u16(0); C.u32(0);
      noms.forEach(function (n, i) { C.u32(i); C.u16(0); C.u16(i + 1); W.nom(n); });
      return p;
    }
    W.fixer(mSq.arbre, arbre(['racine']));
    W.fixer(mArbre, arbre(['cube_corps', 'cube_couvercle']));
    W.fixer(mVis.table, C.pos()); C.u32(3);

    // -- animations de squelette
    var anims = [];
    // « tourne » : courbes (rotation Y linéaire, translation Y en Hermite), échelle constante
    anims.push(function () {
      var rotY = W.courbe({ fin: 60, interpolation: 1, quantification: 6, cles: [[0, 0], [60, Math.PI * 2]] });
      var tY = W.courbe({ fin: 60, interpolation: 2, quantification: 0, cles: [[0, 1, 0, 0], [30, 1.25, 0, 0], [60, 1, 0, 0]] });
      return { nom: 'tourne', images: 60, element: function () {
        var e = C.pos();
        W.nom('racine'); C.u16(0); C.u16(4);
        var fl = (1 << 6) | (1 << 7) | (1 << 8) | (1 << 19) | (1 << 21) | (1 << 22) | (1 << 24);
        C.u32(fl);
        C.f32(1); C.f32(1); C.f32(1);
        C.u32(0); W.ptr(CONTENU, rotY); C.u32(0);
        C.u32(0); W.ptr(CONTENU, tY); C.u32(0);
        return e;
      } };
    });
    // « hoche » : rotation Z quantifiée (Hermite48) et translation X par paliers (StepLinear32)
    anims.push(function () {
      var rotZ = W.courbe({ fin: 40, interpolation: 2, quantification: 2, echelleValeur: 0.5 / 65535, decalageValeur: -0.25, echelleImage: 0.2,
        cles: [[0, -0.25, 0, 0], [20, 0.25, 0, 0], [40, -0.25, 0, 0]] });
      var tX = W.courbe({ fin: 40, interpolation: 0, quantification: 7, echelleValeur: 0.6 / 0xfffff, decalageValeur: -0.3, echelleImage: 0.01,
        cles: [[0, -0.3], [20, 0.3], [40, -0.3]] });
      return { nom: 'hoche', images: 40, element: function () {
        var e = C.pos();
        W.nom('racine'); C.u16(0); C.u16(4);
        var fl = (1 << 16) | (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20) | (1 << 23) | (1 << 24);
        C.u32(fl);
        C.u32(0); C.u32(0); C.u32(0);
        C.u32(0); C.u32(0); W.ptr(CONTENU, rotZ);
        W.ptr(CONTENU, tX); C.u32(0); C.u32(0);
        return e;
      } };
    });
    // « saute » : quaternions et translations image par image, échelle constante
    anims.push(function () {
      var n = 31;
      var adrT = C.pos();
      for (var i = 0; i < n; i++) { C.f32(0); C.f32(1 + 0.8 * Math.sin(Math.PI * i / (n - 1))); C.f32(0); }
      var adrR = C.pos();
      for (var j = 0; j < n; j++) { var a = 0.35 * Math.sin(Math.PI * 2 * j / (n - 1)) / 2; C.f32(Math.sin(a)); C.f32(0); C.f32(0); C.f32(Math.cos(a)); }
      var adrS = C.pos(); C.f32(1); C.f32(1); C.f32(1);
      function bloc(adr, nb) { var p = C.pos(); C.f32(0); C.f32(nb); C.u32(0); W.ptr(CONTENU, adr); C.u32(nb); return p; }
      var bR = bloc(adrR, n), bT = bloc(adrT, n);
      return { nom: 'saute', images: n - 1, element: function () {
        var e = C.pos();
        W.nom('racine'); C.u16(0); C.u16(7);
        C.u32(4);
        W.ptr(CONTENU, adrS); W.ptr(CONTENU, bR); W.ptr(CONTENU, bT);
        return e;
      } };
    });
    var faites = anims.map(function (f) { return f(); });
    W.fixer(dicos[8].table, C.pos()); C.poser32(dicos[8].nombre, faites.length);
    var tabAnim = faites.map(function () { return W.ptr(CONTENU, 0); });
    faites.forEach(function (a, i) {
      var tete = C.pos();
      W.fixer(tabAnim[i], tete);
      W.nom(a.nom); C.u8(1); C.u8(0); C.u16(1); C.f32(a.images);
      var tabEl = W.ptr(CONTENU, 0); C.u32(1); C.u32(0);
      var tEl = C.pos(); W.fixer(tabEl, tEl);
      var pEl = W.ptr(CONTENU, 0);
      W.fixer(pEl, a.element());
    });
    return W.assembler();
  }

  var FabriqueBCH = { cube: cube, encoderRGBA8: encoderRGBA8, encoderETC1A4: encoderETC1A4, imageCaisse: imageCaisse, imageCouvercle: imageCouvercle, motsF24: motsF24 };
  racine.FabriqueBCH = FabriqueBCH;
  if (typeof module !== 'undefined' && module.exports) module.exports = FabriqueBCH;
})(typeof window !== 'undefined' ? window : globalThis);
