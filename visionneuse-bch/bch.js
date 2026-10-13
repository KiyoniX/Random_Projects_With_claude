/*
 * bch.js : lecture et rendu des modèles BCH (aussi appelés H3D), le format de modèles 3D
 * du moteur de Game Freak sur 3DS (Pokémon X/Y, Rubis Oméga/Saphir Alpha).
 *
 * Pose window.BCH = { lire, rendre, estBCH }, sans aucune dépendance. L'explorateur de romfs
 * le charge par <script src="../visionneuse-bch/bch.js">. Sous Node, module.exports = BCH.
 *
 * Tout ce qui concerne le format est un portage des sources de gdkchan, citées à chaque endroit :
 *  - SPICA (github.com/gdkchan/SPICA) : SPICA/Formats/CtrH3D/H3DHeader.cs, H3DRelocator.cs,
 *    H3DSection.cs, H3D.cs, Model/H3DModel.cs, Model/H3DBone.cs, Model/Mesh/H3DMesh.cs,
 *    Model/Mesh/H3DSubMesh.cs, Model/Material/H3DMaterial.cs, H3DMaterialParams.cs,
 *    H3DTextureMapper.cs, H3DTextureCoord.cs, Texture/H3DTexture.cs, Animation/H3DAnimation.cs,
 *    H3DAnimationElement.cs, H3DAnimTransform.cs, H3DAnimQuatTransform.cs, H3DAnimMtxTransform.cs,
 *    H3DFloatKeyFrameGroup.cs, Formats/Common/KeyFrameQuantizationHelper.cs, TextureTransform.cs,
 *    PICA/PICACommandReader.cs, PICA/Commands/PICAVectorFloat24.cs, PICA/Converters/TextureConverter.cs,
 *    TextureCompression.cs, VerticesConverter.cs, Math3D/Interpolation.cs, et pour la pose
 *    SPICA.Rendering/Animation/SkeletalAnimation.cs et SPICA.Rendering/Mesh.cs.
 *  - Ohana3DS Rebirth (github.com/gdkchan/Ohana3DS-Rebirth) : Ohana/Models/BCH.cs, qui lit tout
 *    d'un bloc, et Ohana/Models/PICA200/PICACommand.cs pour les numéros de registres.
 *  - 3dbrew, « GPU/Internal Registers », pour le sens des registres PICA200.
 * Quand SPICA et Ohana divergent, on suit SPICA (plus récent, du même auteur) et on le dit.
 */
(function (racine) {
  'use strict';

  // =====================================================================================
  // Lecteur binaire (petit-boutiste, comme la 3DS)
  // =====================================================================================

  function Lecteur(octets) {
    this.o = octets;
    this.d = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
    this.n = octets.length;
  }
  Lecteur.prototype.verifier = function (p, t) {
    if (!(p >= 0 && p + t <= this.n)) {
      throw new Error('Lecture hors du fichier à l’adresse 0x' + (p >>> 0).toString(16) + '.');
    }
  };
  Lecteur.prototype.u8 = function (p) { this.verifier(p, 1); return this.o[p]; };
  Lecteur.prototype.i8 = function (p) { this.verifier(p, 1); return this.d.getInt8(p); };
  Lecteur.prototype.u16 = function (p) { this.verifier(p, 2); return this.d.getUint16(p, true); };
  Lecteur.prototype.i16 = function (p) { this.verifier(p, 2); return this.d.getInt16(p, true); };
  Lecteur.prototype.u24 = function (p) { this.verifier(p, 3); return this.o[p] | (this.o[p + 1] << 8) | (this.o[p + 2] << 16); };
  Lecteur.prototype.u32 = function (p) { this.verifier(p, 4); return this.d.getUint32(p, true); };
  Lecteur.prototype.i32 = function (p) { this.verifier(p, 4); return this.d.getInt32(p, true); };
  Lecteur.prototype.f32 = function (p) { this.verifier(p, 4); return this.d.getFloat32(p, true); };
  Lecteur.prototype.ecrireU32 = function (p, v) { this.verifier(p, 4); this.d.setUint32(p, v >>> 0, true); };
  Lecteur.prototype.mots = function (p, n) {
    if (n > 0x40000) throw new Error('Liste de commandes GPU invraisemblable (' + n + ' mots).');
    this.verifier(p, n * 4);
    var r = new Uint32Array(n);
    for (var i = 0; i < n; i++) r[i] = this.d.getUint32(p + 4 * i, true);
    return r;
  };
  Lecteur.prototype.chaine = function (p) {
    if (!p) return '';
    this.verifier(p, 1);
    var fin = p;
    while (fin < this.n && this.o[fin] !== 0 && fin - p < 1024) fin++;
    var morceau = this.o.subarray(p, fin);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(morceau);
    var s = '';
    for (var i = 0; i < morceau.length; i++) s += String.fromCharCode(morceau[i]);
    return s;
  };

  var tampon4 = new DataView(new ArrayBuffer(4));
  function bitsVersFlottant(b) { tampon4.setUint32(0, b >>> 0); return tampon4.getFloat32(0); }
  function flottantVersBits(f) { tampon4.setFloat32(0, f); return tampon4.getUint32(0); }

  // Quartet i (0 à 15) d'un nombre de 64 bits donné en deux mots.
  function quartet(bas, haut, i) { return i < 8 ? (bas >>> (i * 4)) & 0xf : (haut >>> ((i - 8) * 4)) & 0xf; }

  function estBCH(octets) {
    return !!octets && octets.length >= 4 && octets[0] === 0x42 && octets[1] === 0x43 && octets[2] === 0x48 && octets[3] === 0;
  }

  // =====================================================================================
  // Commandes GPU PICA200 (SPICA/PICA/PICACommandReader.cs)
  // =====================================================================================

  // Flottant 24 bits du PICA : 1 bit de signe, 7 d'exposant (biais 63), 16 de mantisse.
  // (SPICA/PICA/Commands/PICAVectorFloat24.cs, GetFloat24)
  function flottant24(v) {
    v &= 0xffffff;
    if ((v & 0x7fffff) === 0) return (v >>> 23) ? -0 : 0;
    var mantisse = v & 0xffff, exposant = ((v >>> 16) & 0x7f) + 64, signe = v >>> 23;
    return bitsVersFlottant((signe << 31) | (exposant << 23) | (mantisse << 7));
  }
  function flottantVers24(f) {
    if (f === 0) return 0;
    var b = flottantVersBits(f), signe = b >>> 31, e = ((b >>> 23) & 0xff) - 64, m = (b >>> 7) & 0xffff;
    if (e <= 0) return signe << 23;
    if (e > 0x7f) e = 0x7f;
    return (signe << 23) | (e << 16) | m;
  }
  // Trois mots pour quatre composantes (SPICA PICAVectorFloat24 : X, Y, Z, W).
  function vecteur24(m0, m1, m2) {
    return [
      flottant24(m2 & 0xffffff),
      flottant24((m2 >>> 24) | ((m1 & 0xffff) << 8)),
      flottant24((m1 >>> 16) | ((m0 & 0xff) << 16)),
      flottant24(m0 >>> 8)
    ];
  }
  function motsVecteur24(x, y, z, w) {
    var X = flottantVers24(x), Y = flottantVers24(y), Z = flottantVers24(z), W = flottantVers24(w);
    var m2 = (X | ((Y & 0xff) << 24)) >>> 0;
    var m1 = ((Y >>> 8) | ((Z & 0xffff) << 16)) >>> 0;
    var m0 = ((Z >>> 16) | (W << 8)) >>> 0;
    return [m0, m1, m2];
  }

  // Lit une suite de commandes : [paramètre, en-tête] par paires, alignées sur 8 octets.
  // En-tête : registre (bits 0-15), masque d'octets (16-19), paramètres en plus (20-30),
  // écriture consécutive (31). Les registres 0x2C0 à 0x2C8 alimentent les uniformes
  // flottantes du shader de sommets (96 vecteurs), en 32 bits ou en 24 bits.
  function lireCommandes(mots) {
    var commandes = [];
    var uniformes = new Float32Array(96 * 4);
    var utilises = {};
    var indexU = 0, u32 = false, f24 = [0, 0, 0];
    var derniers = {};

    function valeursUniformes(params) {
      for (var k = 0; k < params.length; k++) {
        var p = params[k] >>> 0;
        var ui = (indexU >> 2) & 0x5f;
        utilises[ui] = true;
        if (u32) {
          // L'ordre d'envoi est W, Z, Y, X.
          uniformes[ui * 4 + (3 - (indexU & 3))] = bitsVersFlottant(p);
        } else {
          f24[indexU & 3] = p;
          if ((indexU & 3) === 2) {
            indexU++; // Trois mots suffisent pour quatre composantes de 24 bits.
            var v = vecteur24(f24[0], f24[1], f24[2]);
            uniformes.set(v, ui * 4);
          }
        }
        indexU++;
      }
    }
    function noter(c) {
      derniers[c.registre] = c.params[0] >>> 0;
      if (c.registre === 0x2c0) { indexU = (c.params[0] & 0xff) << 2; u32 = (c.params[0] >>> 31) !== 0; }
      else if (c.registre >= 0x2c1 && c.registre <= 0x2c8) valeursUniformes(c.params);
      commandes.push(c);
    }

    var i = 0, n = mots.length;
    while (i + 1 < n) {
      var param = mots[i++] >>> 0;
      var tete = mots[i++] >>> 0;
      var id = tete & 0xffff, masque = (tete >>> 16) & 0xf, extra = (tete >>> 20) & 0x7ff, consecutif = (tete >>> 31) !== 0;
      if (consecutif) {
        for (var k = 0; k <= extra; k++) {
          noter({ registre: id + k, params: [param], masque: masque });
          if (k < extra) { if (i >= n) break; param = mots[i++] >>> 0; }
        }
      } else {
        var params = [param];
        for (var e = 0; e < extra && i < n; e++) params.push(mots[i++] >>> 0);
        noter({ registre: id, params: params, masque: masque });
      }
      if (i & 1) i++; // remplissage : chaque commande occupe un nombre pair de mots
    }
    return { commandes: commandes, uniformes: uniformes, utilises: utilises, registres: derniers };
  }

  // =====================================================================================
  // Textures (SPICA/PICA/Converters/TextureConverter.cs et TextureCompression.cs)
  // =====================================================================================

  var FORMATS_TEXTURE = ['RGBA8', 'RGB8', 'RGBA5551', 'RGB565', 'RGBA4', 'LA8', 'HiLo8', 'L8', 'A8', 'LA4', 'L4', 'A4', 'ETC1', 'ETC1A4'];
  var BITS_PAR_PIXEL = [32, 24, 16, 16, 16, 16, 16, 8, 8, 8, 4, 4, 4, 8];

  function tailleTexture(largeur, hauteur, format) {
    return (largeur * hauteur * BITS_PAR_PIXEL[format]) >> 3;
  }

  // Position (x, y) du pixel i dans une tuile de 8 × 8 rangée dans l'ordre de Morton :
  // les bits pairs de i donnent x, les bits impairs donnent y (la table SwizzleLUT de SPICA).
  function morton(i) {
    return {
      x: (i & 1) | ((i >> 1) & 2) | ((i >> 2) & 4),
      y: ((i >> 1) & 1) | ((i >> 2) & 2) | ((i >> 3) & 4)
    };
  }
  var MORTON = [];
  for (var im = 0; im < 64; im++) MORTON.push(morton(im));

  var TABLE_ETC1 = [[2, 8, -2, -8], [5, 17, -5, -17], [9, 29, -9, -29], [13, 42, -13, -42],
    [18, 60, -18, -60], [24, 80, -24, -80], [33, 106, -33, -106], [47, 183, -47, -183]];

  function sature(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function signe3(v) { return v & 4 ? v - 8 : v; }

  // Un bloc ETC1 de 4 × 4 : la 3DS le range en mot de 64 bits petit-boutiste dont la valeur est
  // le mot ETC1 standard. haut = couleurs et drapeaux, bas = indices des pixels.
  // Écrit les couleurs dans sortie[(py * 4 + px) * 3].
  function blocETC1(bas, haut, sortie) {
    var flip = haut & 1, diff = (haut >>> 1) & 1;
    var t1 = (haut >>> 5) & 7, t2 = (haut >>> 2) & 7;
    var r1, g1, b1, r2, g2, b2;
    if (diff) {
      var R = (haut >>> 27) & 0x1f, G = (haut >>> 19) & 0x1f, B = (haut >>> 11) & 0x1f;
      var R2 = R + signe3((haut >>> 24) & 7), G2 = G + signe3((haut >>> 16) & 7), B2 = B + signe3((haut >>> 8) & 7);
      r1 = (R << 3) | (R >> 2); g1 = (G << 3) | (G >> 2); b1 = (B << 3) | (B >> 2);
      R2 &= 0x1f; G2 &= 0x1f; B2 &= 0x1f;
      r2 = (R2 << 3) | (R2 >> 2); g2 = (G2 << 3) | (G2 >> 2); b2 = (B2 << 3) | (B2 >> 2);
    } else {
      r1 = ((haut >>> 28) & 0xf) * 17; r2 = ((haut >>> 24) & 0xf) * 17;
      g1 = ((haut >>> 20) & 0xf) * 17; g2 = ((haut >>> 16) & 0xf) * 17;
      b1 = ((haut >>> 12) & 0xf) * 17; b2 = ((haut >>> 8) & 0xf) * 17;
    }
    for (var py = 0; py < 4; py++) {
      for (var px = 0; px < 4; px++) {
        var second = flip ? py >= 2 : px >= 2;
        var i = px * 4 + py; // les indices sont rangés colonne par colonne
        var idx = ((bas >>> i) & 1) | (((bas >>> (16 + i)) & 1) << 1);
        var m = TABLE_ETC1[second ? t2 : t1][idx];
        var o = (py * 4 + px) * 3;
        sortie[o] = sature((second ? r2 : r1) + m);
        sortie[o + 1] = sature((second ? g2 : g1) + m);
        sortie[o + 2] = sature((second ? b2 : b1) + m);
      }
    }
  }

  // Décode une texture tuilée : renvoie des pixels RGBA rangés de haut en bas (comme une image),
  // la première ligne de tuiles en mémoire étant le bas de l'image (SPICA retourne de même).
  function decoderTexture(src, largeur, hauteur, format) {
    var sortie = new Uint8ClampedArray(largeur * hauteur * 4);
    var nom = FORMATS_TEXTURE[format];
    if (!nom) throw new Error('Format de texture inconnu (' + format + ').');
    var besoin = tailleTexture(largeur, hauteur, format);
    if (src.length < besoin) throw new Error('Texture tronquée : ' + src.length + ' octets pour ' + besoin + ' attendus.');
    var dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
    var x, y, o, p, v;

    if (format === 12 || format === 13) {
      var alpha = format === 13, q = 0, bloc = new Uint8Array(48);
      var XT = [0, 4, 0, 4], YT = [0, 0, 4, 4];
      for (var ty = 0; ty < hauteur; ty += 8) {
        for (var tx = 0; tx < largeur; tx += 8) {
          for (var t = 0; t < 4; t++) {
            var aBas = 0xffffffff, aHaut = 0xffffffff;
            if (alpha) { aBas = dv.getUint32(q, true); aHaut = dv.getUint32(q + 4, true); q += 8; }
            blocETC1(dv.getUint32(q, true), dv.getUint32(q + 4, true), bloc);
            q += 8;
            for (var py = 0; py < 4; py++) {
              for (var px = 0; px < 4; px++) {
                x = tx + XT[t] + px; y = ty + YT[t] + py;
                if (x >= largeur || y >= hauteur) continue;
                o = ((hauteur - 1 - y) * largeur + x) * 4;
                p = (py * 4 + px) * 3;
                sortie[o] = bloc[p]; sortie[o + 1] = bloc[p + 1]; sortie[o + 2] = bloc[p + 2];
                var dec = (px * 4 + py) * 4; // l'alpha aussi est rangé colonne par colonne
                var a = (dec < 32 ? aBas >>> dec : aHaut >>> (dec - 32)) & 0xf;
                sortie[o + 3] = (a << 4) | a;
              }
            }
          }
        }
      }
      return sortie;
    }

    var pas = BITS_PAR_PIXEL[format] >> 3, i = 0;
    for (var tY = 0; tY < hauteur; tY += 8) {
      for (var tX = 0; tX < largeur; tX += 8) {
        for (var k = 0; k < 64; k++, i++) {
          x = tX + MORTON[k].x; y = tY + MORTON[k].y;
          o = ((hauteur - 1 - y) * largeur + x) * 4;
          var e = i * pas, r = 0, g = 0, b = 0, al = 255;
          switch (format) {
            case 0: al = src[e]; b = src[e + 1]; g = src[e + 2]; r = src[e + 3]; break;            // RGBA8 : A B G R
            case 1: b = src[e]; g = src[e + 1]; r = src[e + 2]; break;                              // RGB8 : B G R
            case 2: v = dv.getUint16(e, true);                                                      // RGBA5551
              r = ((v >> 11) & 0x1f); g = ((v >> 6) & 0x1f); b = ((v >> 1) & 0x1f);
              r = (r << 3) | (r >> 2); g = (g << 3) | (g >> 2); b = (b << 3) | (b >> 2); al = (v & 1) * 255; break;
            case 3: v = dv.getUint16(e, true);                                                      // RGB565
              r = (v >> 11) & 0x1f; g = (v >> 5) & 0x3f; b = v & 0x1f;
              r = (r << 3) | (r >> 2); g = (g << 2) | (g >> 4); b = (b << 3) | (b >> 2); break;
            case 4: v = dv.getUint16(e, true);                                                      // RGBA4
              r = ((v >> 12) & 0xf) * 17; g = ((v >> 8) & 0xf) * 17; b = ((v >> 4) & 0xf) * 17; al = (v & 0xf) * 17; break;
            case 5: al = src[e]; r = g = b = src[e + 1]; break;                                     // LA8 : A L
            case 6: r = src[e + 1]; g = src[e]; b = 0; break;                                       // HiLo8
            case 7: r = g = b = src[e]; break;                                                      // L8
            case 8: r = g = b = 255; al = src[e]; break;                                            // A8
            case 9: r = g = b = (src[i] >> 4) * 17; al = (src[i] & 0xf) * 17; break;              // LA4 : L en haut
            case 10: r = g = b = ((src[i >> 1] >> ((i & 1) << 2)) & 0xf) * 17; break;              // L4 : quartet bas d'abord
            case 11: r = g = b = 255; al = ((src[i >> 1] >> ((i & 1) << 2)) & 0xf) * 17; break;   // A4
          }
          if (x < largeur && y < hauteur) { sortie[o] = r; sortie[o + 1] = g; sortie[o + 2] = b; sortie[o + 3] = al; }
        }
      }
    }
    return sortie;
  }

  // =====================================================================================
  // Courbes d'animation (SPICA H3DFloatKeyFrameGroup.cs et KeyFrameQuantizationHelper.cs)
  // =====================================================================================

  var QUANTIFICATIONS = ['Hermite128', 'Hermite64', 'Hermite48', 'UnifiedHermite96', 'UnifiedHermite48', 'UnifiedHermite32', 'StepLinear64', 'StepLinear32'];
  var TAILLE_CLE = [16, 8, 6, 12, 6, 4, 8, 4];

  function lireCles(L, p, quant, n, echelleImage, echelleValeur, decalageValeur) {
    var cles = [];
    var t = TAILLE_CLE[quant];
    if (t === undefined) throw new Error('Quantification de courbe inconnue (' + quant + ').');
    for (var i = 0; i < n; i++, p += t) {
      var c = { image: 0, valeur: 0, pente: 0, penteSortie: 0 }, s, mot;
      switch (quant) {
        case 0: c.image = L.f32(p); c.valeur = L.f32(p + 4); c.pente = L.f32(p + 8); c.penteSortie = L.f32(p + 12); break;
        case 1: mot = L.u32(p); c.image = mot & 0xfff; c.valeur = (mot >>> 12) & 0xfffff;
          c.pente = L.i16(p + 4) / 256; c.penteSortie = L.i16(p + 6) / 256; break;
        case 2: c.image = L.u8(p); c.valeur = L.u16(p + 1); s = L.u24(p + 3);
          c.pente = ((s << 20) >> 20) / 32; c.penteSortie = ((s << 8) >> 20) / 32; break;
        case 3: c.image = L.f32(p); c.valeur = L.f32(p + 4); c.pente = c.penteSortie = L.f32(p + 8); break;
        case 4: c.image = L.u16(p) / 32; c.valeur = L.u16(p + 2); c.pente = c.penteSortie = L.i16(p + 4) / 256; break;
        case 5: c.image = L.u8(p); s = L.u24(p + 1); c.valeur = s & 0xfff; c.pente = c.penteSortie = ((s << 8) >> 20) / 32; break;
        case 6: c.image = L.f32(p); c.valeur = L.f32(p + 4); break;
        case 7: mot = L.u32(p); c.image = mot & 0xfff; c.valeur = (mot >>> 12) & 0xfffff; break;
      }
      c.image *= echelleImage;
      c.valeur = c.valeur * echelleValeur + decalageValeur;
      cles.push(c);
    }
    return cles;
  }

  // Une courbe à images clés. Deux mises en page selon la version (SPICA, IfVersion 0x20) :
  //  - 0x20 et plus : en-tête de 12 octets puis interpolation, quantification, nombre, échelles, pointeur ;
  //  - avant 0x20 : un pointeur vers un bloc qui répète début et fin puis porte ces champs.
  // Ohana lit toujours la première forme ; on vérifie donc que le bloc pointé répète bien
  // le début et la fin avant de suivre SPICA, sinon on prend la forme d'Ohana.
  function lireCourbe(L, p, version, avert) {
    var c = { debut: L.f32(p), fin: L.f32(p + 4), avant: L.u8(p + 8), apres: L.u8(p + 9), interpolation: 1, quantification: 0, cles: [] };
    var interp, quant, n, ev, dv, ei, adr;
    var interne = version < 0x20 ? L.u32(p + 12) : 0;
    var formeAncienne = false;
    if (version < 0x20 && interne && (interne & 3) === 0 && interne + 32 <= L.n) {
      formeAncienne = L.f32(interne) === c.debut && L.f32(interne + 4) === c.fin;
    }
    if (formeAncienne) {
      interp = L.u8(interne + 8); quant = L.u8(interne + 9); n = L.u16(interne + 10);
      ev = L.f32(interne + 16); dv = L.f32(interne + 20); ei = L.f32(interne + 24); adr = L.u32(interne + 28);
    } else {
      if (version < 0x20 && avert) avert.courbeOhana = true;
      interp = L.u8(p + 12); quant = L.u8(p + 13); n = L.u16(p + 14);
      ev = L.f32(p + 16); dv = L.f32(p + 20); ei = L.f32(p + 24); adr = L.u32(p + 32);
    }
    c.interpolation = interp;
    c.quantification = quant;
    c.cles = lireCles(L, adr, quant, n, ei, ev, dv);
    return c;
  }

  function courbeConstante(v) {
    return { debut: 0, fin: 0, interpolation: 1, quantification: -1, cles: [{ image: 0, valeur: v, pente: 0, penteSortie: 0 }] };
  }

  // SPICA/Math3D/Interpolation.cs
  function hermite(g, d, pg, pd, ecart, poids) {
    var r = g + (g - d) * (2 * poids - 3) * poids * poids;
    r += (ecart * (poids - 1)) * (pg * (poids - 1) + pd * poids);
    return r;
  }

  // H3DFloatKeyFrameGroup.GetFrameValue, porté tel quel.
  function valeurCourbe(courbe, image) {
    var cles = courbe.cles;
    if (cles.length === 0) return 0;
    if (cles.length === 1) return cles[0].valeur;
    var g = cles[0], d = cles[cles.length - 1];
    for (var i = 0; i < cles.length; i++) {
      var k = cles[i];
      if (k.image <= image) g = k;
      if (k.image >= image && k.image < d.image) d = k;
    }
    if (g.image !== d.image) {
      var ecart = image - g.image, poids = ecart / (d.image - g.image);
      switch (courbe.interpolation) {
        case 0: return g.valeur;
        case 1: return g.valeur * (1 - poids) + d.valeur * poids;
        case 2: return hermite(g.valeur, d.valeur, g.penteSortie, d.pente, ecart, poids);
        default: return g.valeur * (1 - poids) + d.valeur * poids;
      }
    }
    return g.valeur;
  }

  // =====================================================================================
  // Petites mathématiques (matrices 4 × 4 en colonnes, vecteur colonne, comme WebGL)
  // =====================================================================================

  function m4() { var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function m4mul(a, b, s) {
    s = s || new Float32Array(16);
    var r = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var l = 0; l < 4; l++) {
        r[c * 4 + l] = a[l] * b[c * 4] + a[4 + l] * b[c * 4 + 1] + a[8 + l] * b[c * 4 + 2] + a[12 + l] * b[c * 4 + 3];
      }
    }
    s.set(r);
    return s;
  }
  function m4translation(x, y, z) { var m = m4(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function m4echelle(x, y, z) { var m = m4(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function m4rotY(a) { var m = m4(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  // Matrice 3 × 4 lue rangée par rangée (trois rangées de quatre : rotation et translation).
  function m4depuis3x4(a) {
    var m = m4();
    m[0] = a[0]; m[4] = a[1]; m[8] = a[2]; m[12] = a[3];
    m[1] = a[4]; m[5] = a[5]; m[9] = a[6]; m[13] = a[7];
    m[2] = a[8]; m[6] = a[9]; m[10] = a[10]; m[14] = a[11];
    return m;
  }
  function m4inverse(m) {
    var a = m, r = new Float32Array(16);
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    var b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    var b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det || !isFinite(det)) return null;
    det = 1 / det;
    r[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; r[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    r[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; r[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    r[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; r[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    r[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; r[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    r[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; r[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    r[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; r[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    r[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; r[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    r[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; r[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return r;
  }
  // Quaternion (x, y, z, w) vers matrice de rotation.
  function m4quat(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3], m = m4();
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w);
    m[4] = 2 * (x * y - z * w); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w);
    m[8] = 2 * (x * z + y * w); m[9] = 2 * (y * z - x * w); m[10] = 1 - 2 * (x * x + y * y);
    return m;
  }
  // Rotation d'Euler appliquée X puis Y puis Z (SkeletalAnimation.Bone.CalculateQuaternion de SPICA).
  function quatEuler(r) {
    var sx = Math.sin(r[0] * 0.5), sy = Math.sin(r[1] * 0.5), sz = Math.sin(r[2] * 0.5);
    var cx = Math.cos(r[0] * 0.5), cy = Math.cos(r[1] * 0.5), cz = Math.cos(r[2] * 0.5);
    return [cz * sx * cy - sz * cx * sy, cz * cx * sy + sz * sx * cy, sz * cx * cy - cz * sx * sy, cz * cx * cy + sz * sx * sy];
  }
  function slerp(a, b, t) {
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1;
    if (d < 0) { d = -d; s = -1; }
    var k0, k1;
    if (d > 0.9995) { k0 = 1 - t; k1 = t; }
    else { var an = Math.acos(d), sn = Math.sin(an); k0 = Math.sin((1 - t) * an) / sn; k1 = Math.sin(t * an) / sn; }
    var r = [a[0] * k0 + b[0] * k1 * s, a[1] * k0 + b[1] * k1 * s, a[2] * k0 + b[2] * k1 * s, a[3] * k0 + b[3] * k1 * s];
    var l = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
    return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
  }
  // Locale d'un os : T × R × S (SPICA : Scale * Rotation * Translation en vecteur ligne).
  function m4locale(s, q, t) {
    var m = m4quat(q);
    m[0] *= s[0]; m[1] *= s[0]; m[2] *= s[0];
    m[4] *= s[1]; m[5] *= s[1]; m[6] *= s[1];
    m[8] *= s[2]; m[9] *= s[2]; m[10] *= s[2];
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
    return m;
  }

  // =====================================================================================
  // Lecture du fichier
  // =====================================================================================

  // Sections cibles de la table de relocalisation (SPICA/Formats/CtrH3D/H3DSection.cs).
  var S_CONTENU = 0, S_CHAINES = 1, S_COMMANDES = 2, S_COMMANDES_SRC = 3, S_DONNEES = 4, S_DONNEES_TEX = 5,
    S_DONNEES_SOMMETS = 6, S_DONNEES_IDX16 = 7, S_DONNEES_IDX8 = 8, S_EXT = 9, S_EXT_TEX = 10, S_EXT_SOMMETS = 11,
    S_EXT_IDX16 = 12, S_EXT_IDX8 = 13;

  function lireEntete(L) {
    if (!estBCH(L.o)) throw new Error('Ce n’est pas un fichier BCH : il ne commence pas par « BCH ».');
    // SPICA/Formats/CtrH3D/H3DHeader.cs
    var h = { retro: L.u8(4), avant: L.u8(5), convertisseur: L.u16(6) };
    var p = 8, ext = h.retro >= 0x21;
    h.contenu = L.u32(p); p += 4;
    h.chaines = L.u32(p); p += 4;
    h.commandes = L.u32(p); p += 4;
    h.donnees = L.u32(p); p += 4;
    h.ext = 0; if (ext) { h.ext = L.u32(p); p += 4; }
    h.reloc = L.u32(p); p += 4;
    h.longContenu = L.u32(p); p += 4;
    h.longChaines = L.u32(p); p += 4;
    h.longCommandes = L.u32(p); p += 4;
    h.longDonnees = L.u32(p); p += 4;
    h.longExt = 0; if (ext) { h.longExt = L.u32(p); p += 4; }
    h.longReloc = L.u32(p); p += 4;
    return h;
  }

  // SPICA H3DRelocator.GetLegacyRelocDiff : l'énumération des sections a changé avec les versions.
  function ecartAncien(section, version) {
    if (version > 7 && version < 0x21 && section >= S_DONNEES_SOMMETS) return -1;
    if (version < 7 && section >= S_COMMANDES_SRC) return 1;
    return 0;
  }

  function adresseSection(h, s) {
    switch (s) {
      case S_CONTENU: return h.contenu;
      case S_CHAINES: return h.chaines;
      case S_COMMANDES: case S_COMMANDES_SRC: return h.commandes;
      case S_DONNEES: case S_DONNEES_TEX: case S_DONNEES_SOMMETS: case S_DONNEES_IDX8: return h.donnees;
      case S_DONNEES_IDX16: return (h.donnees | 0x80000000) >>> 0;
      case S_EXT: case S_EXT_TEX: case S_EXT_SOMMETS: case S_EXT_IDX8: return h.ext;
      case S_EXT_IDX16: return (h.ext | 0x80000000) >>> 0;
    }
    return 0;
  }

  // SPICA H3DRelocator.ToAbsolute : chaque entrée désigne un pointeur (25 bits d'adresse, la section
  // cible sur 4 bits, la section où il se trouve sur 3) ; on ajoute au pointeur l'adresse de sa cible.
  function relocaliser(L, h) {
    var n = 0;
    for (var off = 0; off + 4 <= h.longReloc; off += 4) {
      var val = L.u32(h.reloc + off);
      var ptr = val & 0x1ffffff;
      var cible = (val >>> 25) & 0xf;
      var source = val >>> 29;
      cible += ecartAncien(cible, h.retro);
      if (cible !== S_CHAINES) ptr *= 4;
      var adr = adresseSection(h, source) + ptr;
      if (adr + 4 > L.n) continue;
      L.ecrireU32(adr, (L.u32(adr) + adresseSection(h, cible)) >>> 0);
      n++;
    }
    return n;
  }

  function lireDico(L, p) { return { table: L.u32(p), nombre: L.u32(p + 4), arbre: L.u32(p + 8) }; }

  // Noms rangés dans un arbre PATRICIA : nœuds de 12 octets, le premier est la racine
  // (SPICA H3DPatriciaTree, Ohana BCH.cs « Radix tree »).
  function nomsArbre(L, p, n) {
    var noms = [];
    if (!p) return noms;
    for (var i = 0; i < n; i++) noms.push(L.chaine(L.u32(p + 12 * (i + 1) + 8)));
    return noms;
  }

  var NOMS_ATTRIBUTS = ['position', 'normale', 'tangente', 'couleur', 'uv0', 'uv1', 'uv2', 'os', 'poids'];
  var FORMATS_ATTRIBUTS = ['octet signé', 'octet', 'court', 'flottant'];
  var PEAUX = ['aucune', 'lisse', 'rigide'];

  // ---------- Textures (SPICA H3DTexture.Deserialize, Ohana BCH.cs « Textures ») ----------
  function lireTexture(L, p) {
    var nom = L.chaine(L.u32(p + 28));
    var cmd = lireCommandes(L.mots(L.u32(p), L.u32(p + 4)));
    var format = L.u8(p + 24);
    var r = cmd.registres;
    var dim = r[0x82] || 0;
    var hauteur = dim & 0x7ff, largeur = (dim >>> 16) & 0x7ff;
    if (format >= FORMATS_TEXTURE.length && r[0x8e] !== undefined) format = r[0x8e] & 0xf;
    var adresse = r[0x85] || 0;
    var t = { nom: nom, largeur: largeur, hauteur: hauteur, format: FORMATS_TEXTURE[format] || ('format ' + format), rgba: null, erreur: null };
    try {
      if (!largeur || !hauteur) throw new Error('dimensions absentes des commandes');
      var taille = tailleTexture(largeur, hauteur, format);
      if (adresse + taille > L.n) throw new Error('les pixels dépassent la fin du fichier');
      t.rgba = decoderTexture(L.o.subarray(adresse, adresse + taille), largeur, hauteur, format);
    } catch (e) {
      t.erreur = e.message;
    }
    return t;
  }

  // ---------- Matériaux (SPICA H3DMaterial, H3DMaterialParams ; Ohana BCH.cs « Materials ») ----------
  function lireMateriau(L, p, version, h, avert) {
    var nouveau = version >= 0x21;
    var noms = nouveau ? p + 28 : p + 72;
    var m = {
      nom: L.chaine(L.u32(noms + 12)),
      textures: [L.chaine(L.u32(noms)), L.chaine(L.u32(noms + 4)), L.chaine(L.u32(noms + 8))],
      enveloppes: [],
      uv: null,
      alphaTest: { actif: false, fonction: 1, reference: 0 },
      melange: { actif: false, source: 1, destination: 0 },
      ecritureProfondeur: true,
      parametres: false
    };
    // Trois « mappers » de 16 octets : type, enveloppe U, enveloppe V, filtres, LOD, bordure.
    var mappeur = nouveau ? L.u32(p + 24) : p + 24;
    if (mappeur) {
      for (var i = 0; i < 3; i++) {
        var q = mappeur + i * 16;
        m.enveloppes.push({ u: L.u8(q + 1), v: L.u8(q + 2) });
      }
    }
    var params = L.u32(p);
    if (params && params + 0xd0 <= L.n) {
      try {
        // Coordonnée de texture 0 (H3DTextureCoord) : drapeaux, type de transformation, projection,
        // caméra, échelle, rotation, translation.
        var tc = params + 12;
        var type = L.u8(tc + 1), projection = L.u8(tc + 2);
        var su = L.f32(tc + 4), sv = L.f32(tc + 8), rot = L.f32(tc + 12), tu = L.f32(tc + 16), tv = L.f32(tc + 20);
        if (projection === 0 && isFinite(su) && isFinite(sv) && (su !== 0 || sv !== 0) && Math.abs(su) < 1e4 && Math.abs(sv) < 1e4) {
          m.uv = transformationUV(su, sv, rot, tu, tv, type);
        }
        // Commandes du fragment : SPICA les place à +0xC8, Ohana à +0xC0. On prend l'emplacement
        // qui pointe vraiment dans la section des commandes.
        var fsh = null;
        [0xc8, 0xc0].forEach(function (d) {
          if (fsh) return;
          var ptr = L.u32(params + d), n = L.u32(params + d + 4);
          if (ptr >= h.commandes && ptr + n * 4 <= h.commandes + h.longCommandes && n > 0 && n < 4096) fsh = { ptr: ptr, n: n };
        });
        if (fsh) {
          var r = lireCommandes(L.mots(fsh.ptr, fsh.n)).registres;
          m.parametres = true;
          if (r[0x104] !== undefined) {
            var at = r[0x104];
            m.alphaTest = { actif: (at & 1) === 1, fonction: (at >>> 4) & 7, reference: ((at >>> 8) & 0xff) / 255 };
            if (!m.alphaTest.actif) m.alphaTest.fonction = 1;
          }
          if (r[0x100] !== undefined && r[0x101] !== undefined) {
            var mode = (r[0x100] >>> 8) & 0xff, bf = r[0x101];
            var src = (bf >>> 16) & 0xf, dst = (bf >>> 20) & 0xf;
            m.melange = { actif: mode === 1 && !(src === 1 && dst === 0), source: src, destination: dst };
          }
          if (r[0x107] !== undefined) m.ecritureProfondeur = ((r[0x107] >>> 12) & 1) === 1;
        }
      } catch (e) {
        avert.push('Matériau « ' + m.nom + ' » : paramètres illisibles (' + e.message + ').');
      }
    }
    return m;
  }

  // SPICA/Formats/Common/TextureTransform.cs : renvoie [m11, m12, m21, m22, m41, m42].
  function transformationUV(SX, SY, R, TX, TY, type) {
    var CA = Math.cos(R), SA = Math.sin(R);
    var t = [SX * CA, SY * SA, SX * -SA, SY * CA, 0, 0];
    if (type === 1) { t[4] = SX * (-CA * TX - SA * TY); t[5] = SY * (SA * TX - CA * TY); }
    else if (type === 2) {
      t[4] = SX * CA * (-TX - 0.5) - SX * SA * (TY - 0.5) + 0.5;
      t[5] = SY * SA * (-TX - 0.5) + SY * CA * (TY - 0.5) + 0.5;
    } else {
      t[4] = SX * ((0.5 * SA - 0.5 * CA) + 0.5 - TX);
      t[5] = SY * ((0.5 * -SA - 0.5 * CA) + 0.5 - TY);
    }
    var identite = Math.abs(t[0] - 1) < 1e-6 && Math.abs(t[3] - 1) < 1e-6 && Math.abs(t[1]) < 1e-6 && Math.abs(t[2]) < 1e-6 && Math.abs(t[4]) < 1e-6 && Math.abs(t[5]) < 1e-6;
    return identite ? null : t;
  }

  // ---------- Squelette (SPICA H3DBone, Ohana BCH.cs « Skeleton ») ----------
  function lireSquelette(L, p, n, avert) {
    var os = [];
    for (var i = 0; i < n; i++) {
      var b = p + i * 0x64;
      var inv = [];
      for (var k = 0; k < 12; k++) inv.push(L.f32(b + 44 + 4 * k));
      os.push({
        nom: L.chaine(L.u32(b + 92)),
        parent: L.i16(b + 4),
        drapeaux: L.u32(b),
        compenseEchelle: (L.u32(b) & 0x00400000) !== 0,
        echelle: [L.f32(b + 8), L.f32(b + 12), L.f32(b + 16)],
        rotation: [L.f32(b + 20), L.f32(b + 24), L.f32(b + 28)],
        translation: [L.f32(b + 32), L.f32(b + 36), L.f32(b + 40)],
        inverse: m4depuis3x4(inv),
        monde: null
      });
    }
    // Pose de repos : SPICA prend l'inverse de la matrice inverse rangée dans le fichier
    // (SkeletalAnimation.ResetTransforms). Si elle n'est pas inversible, on chaîne les locales.
    var chaine = poseChaine(os, null);
    var douteux = 0;
    for (var j = 0; j < os.length; j++) {
      var m = m4inverse(os[j].inverse);
      if (!m) { m = chaine[j]; douteux++; os[j].inverse = m4inverse(m) || m4(); }
      os[j].monde = m;
      if (os[j].parent >= j) avert.push('Squelette mal ordonné : l’os « ' + os[j].nom + ' » vient avant son parent.');
    }
    if (douteux) avert.push(douteux + ' os sans matrice inverse utilisable : pose de repos recalculée depuis leurs transformations locales.');
    return os;
  }

  // Chaîne les transformations locales (os parents d'abord), avec l'état animé s'il y en a un.
  // SPICA.Rendering/Animation/SkeletalAnimation.GetSkeletonTransforms, y compris la compensation
  // d'échelle des segments.
  function poseChaine(os, etat, fixes) {
    var mondes = [];
    for (var i = 0; i < os.length; i++) {
      var b = os[i], e = etat ? etat[i] : null;
      if (fixes && fixes[i]) { mondes.push(fixes[i]); continue; }
      var s = e ? e.s : b.echelle, q = e ? e.q : quatEuler(b.rotation), t = e ? e.t : b.translation;
      var parent = b.parent >= 0 && b.parent < i ? b.parent : -1;
      var m;
      if (b.compenseEchelle && parent >= 0) {
        var ps = etat ? etat[parent].s : os[parent].echelle;
        var tc = [t[0] * ps[0], t[1] * ps[1], t[2] * ps[2]];
        m = m4mul(m4echelle(1 / ps[0], 1 / ps[1], 1 / ps[2]), m4locale(s, q, tc));
      } else {
        m = m4locale(s, q, t);
      }
      if (parent >= 0) m = m4mul(mondes[parent], m);
      mondes.push(m);
    }
    return mondes;
  }

  // ---------- Maillages (SPICA H3DMesh, H3DSubMesh, VerticesConverter ; Ohana BCH.cs « Vertices ») ----------
  function lireMaillage(L, m, nomsNoeuds, visibilite, avert) {
    var drap = L.u8(m + 2);
    var res = {
      materiau: L.u16(m),
      type: drap & 3,
      noeud: L.u16(m + 4),
      priorite: L.u16(m + 6) & 0xff,
      couche: (L.u16(m + 6) >>> 8) & 3,
      nom: '', visible: true
    };
    res.nom = nomsNoeuds[res.noeud] || ('maillage ' + res.noeud);
    if (visibilite) res.visible = visibilite(res.noeud);
    var cmd = lireCommandes(L.mots(L.u32(m + 8), L.u32(m + 12)));

    // Les attributs ne sont pas déclarés : on les déduit des registres du chargeur de sommets.
    var adresse = 0, fmtB = 0, fmtH = 0, attB = 0, attH = 0, permB = 0, permH = 0, pas = 0, total = 0, iFixe = 0;
    var fixes = {};
    cmd.commandes.forEach(function (c) {
      var p = c.params[0] >>> 0;
      switch (c.registre) {
        case 0x201: fmtB = (fmtB | p) >>> 0; break;                 // GPUREG_ATTRIBBUFFERS_FORMAT_LOW
        case 0x202: fmtH = (fmtH | p) >>> 0; break;                 // GPUREG_ATTRIBBUFFERS_FORMAT_HIGH
        case 0x203: adresse = p; break;                             // GPUREG_ATTRIBBUFFER0_OFFSET
        case 0x204: attB = (attB | p) >>> 0; break;                 // GPUREG_ATTRIBBUFFER0_CONFIG1
        case 0x205: attH = (attH | (p & 0xffff)) >>> 0; pas = (p >>> 16) & 0xff; break; // CONFIG2
        case 0x232: iFixe = p; break;                               // GPUREG_FIXEDATTRIB_INDEX
        case 0x233: case 0x234: case 0x235:                         // GPUREG_FIXEDATTRIB_DATA0..2
          (fixes[iFixe] = fixes[iFixe] || [0, 0, 0])[c.registre - 0x233] = p; break;
        case 0x242: total = p + 1; break;                           // GPUREG_VSH_NUM_ATTR
        case 0x2bb: permB = (permB | p) >>> 0; break;               // GPUREG_VSH_ATTRIBUTES_PERMUTATION_LOW
        case 0x2bc: permH = (permH | p) >>> 0; break;               // GPUREG_VSH_ATTRIBUTES_PERMUTATION_HIGH
      }
    });
    var U = cmd.uniformes, utilise = cmd.utilises;
    function uniforme(reg, comp) { return utilise[reg] ? U[reg * 4 + comp] : 1; }
    var attributs = [], attributsFixes = [];
    for (var idx = 0; idx < total && idx < 16; idx++) {
      if ((fmtH >>> (16 + idx)) & 1) {
        var f = fixes[idx] || [0, 0, 0];
        attributsFixes.push({ nom: quartet(permB, permH, idx), valeur: vecteur24(f[0], f[1], f[2]) });
      } else {
        var pi = quartet(attB, attH, idx);
        var nom = quartet(permB, permH, pi);
        var fmt = quartet(fmtB, fmtH, pi);
        var a = { nom: nom, format: fmt & 3, elements: (fmt >> 2) + 1, echelle: 1 };
        switch (nom) {
          case 0: a.echelle = uniforme(7, 0); break;
          case 1: a.echelle = uniforme(7, 1); break;
          case 2: a.echelle = uniforme(7, 2); break;
          case 3: a.echelle = uniforme(7, 3); break;
          case 4: a.echelle = uniforme(8, 0); break;
          case 5: a.echelle = uniforme(8, 1); break;
          case 6: a.echelle = uniforme(8, 2); break;
          case 8: a.echelle = uniforme(8, 3); break;
        }
        attributs.push(a);
      }
    }
    var decalage = utilise[6] ? [U[24], U[25], U[26]] : [0, 0, 0];
    res.attributs = attributs.map(function (a) {
      return { nom: NOMS_ATTRIBUTS[a.nom] || ('utilisateur ' + (a.nom - 9)), format: FORMATS_ATTRIBUTS[a.format], elements: a.elements, echelle: a.echelle, fixe: false };
    }).concat(attributsFixes.map(function (a) {
      return { nom: NOMS_ATTRIBUTS[a.nom] || ('utilisateur ' + (a.nom - 9)), format: 'constante', elements: 4, echelle: 1, fixe: true };
    }));
    if (!pas) throw new Error('taille de sommet absente des commandes GPU');

    // Sous-maillages : palette d'os, indices, primitive.
    var sousM = [];
    var smPtr = L.u32(m + 16), smN = L.u32(m + 20), maxIndex = 0;
    for (var s = 0; s < smN; s++) {
      var sp = smPtr + s * 0x34;
      var nOs = Math.min(L.u16(sp + 2), 20), palette = [];
      for (var k = 0; k < nOs; k++) palette.push(L.u16(sp + 4 + 2 * k));
      var c2 = lireCommandes(L.mots(L.u32(sp + 44), L.u32(sp + 48))).registres;
      var cfg = c2[0x227] || 0, nb = c2[0x228] || 0, prim = ((c2[0x25e] || 0) >>> 8) & 3;
      var seize = (cfg >>> 31) !== 0, ai = cfg & 0x7fffffff, indices = new Uint32Array(nb);
      L.verifier(ai, nb * (seize ? 2 : 1));
      for (var j = 0; j < nb; j++) {
        indices[j] = seize ? L.u16(ai + 2 * j) : L.u8(ai + j);
        if (indices[j] > maxIndex) maxIndex = indices[j];
      }
      sousM.push({ peau: L.u8(sp), palette: palette, indices: indices, primitive: prim });
    }
    var nbSommets = smN ? maxIndex + 1 : 0;
    L.verifier(adresse, nbSommets * pas);

    // Décodage des sommets (VerticesConverter.GetVertices).
    var sommets = [];
    var fixeOs = null, fixePoids = null, fixeCouleur = null;
    attributsFixes.forEach(function (a) {
      if (a.nom === 7) fixeOs = a.valeur;
      else if (a.nom === 8) fixePoids = a.valeur;
      else if (a.nom === 3) fixeCouleur = a.valeur;
    });
    var aNormale = false, aUV = false, aCouleur = !!fixeCouleur, aPoids = !!fixePoids;
    attributs.forEach(function (a) {
      if (a.nom === 1) aNormale = true; else if (a.nom === 4) aUV = true; else if (a.nom === 3) aCouleur = true; else if (a.nom === 8) aPoids = true;
    });
    for (var v = 0; v < nbSommets; v++) {
      var q = adresse + v * pas, base = adresse;
      var S = { p: [0, 0, 0], n: [0, 0, 1], uv: [0, 0], c: fixeCouleur ? fixeCouleur.slice() : [1, 1, 1, 1], os: [0, 0, 0, 0], w: [0, 0, 0, 0] };
      var bi = 0, wi = 0;
      for (var ia = 0; ia < attributs.length; ia++) {
        var at = attributs[ia];
        if (at.format >= 2) q += (q - base) & 1; // alignement sur 2 octets (AlignStream de SPICA)
        var el = [0, 0, 0, 1];
        for (var e = 0; e < at.elements; e++) {
          switch (at.format) {
            case 0: el[e] = L.i8(q); q += 1; break;
            case 1: el[e] = L.u8(q); q += 1; break;
            case 2: el[e] = L.i16(q); q += 2; break;
            case 3: el[e] = L.f32(q); q += 4; break;
          }
        }
        var sc = at.echelle;
        switch (at.nom) {
          case 0: S.p = [el[0] * sc + decalage[0], el[1] * sc + decalage[1], el[2] * sc + decalage[2]]; break;
          case 1: S.n = [el[0] * sc, el[1] * sc, el[2] * sc]; break;
          case 3: S.c = [el[0] * sc, el[1] * sc, el[2] * sc, at.elements > 3 ? el[3] * sc : 1]; break;
          case 4: S.uv = [el[0] * sc, el[1] * sc]; break;
          case 7: for (var b1 = 0; b1 < at.elements && bi < 4; b1++) S.os[bi++] = el[b1]; break;
          case 8: for (var w1 = 0; w1 < at.elements && wi < 4; w1++) S.w[wi++] = el[w1] * sc; break;
        }
      }
      if (fixeOs) { S.os[0] = fixeOs[0]; S.os[1] = fixeOs[1]; S.os[2] = fixeOs[2]; }
      if (fixePoids) { S.w[0] = fixePoids[0]; S.w[1] = fixePoids[1]; S.w[2] = fixePoids[2]; }
      sommets.push(S);
    }

    // Mise à plat : un jeu de sommets par sous-maillage (la palette d'os en dépend), des triangles.
    var pos = [], nor = [], uv = [], col = [], osG = [], poids = [], peau = [], tri = [];
    var horsPalette = 0;
    res.sousMaillages = sousM.map(function (sm) {
      var carte = new Map(), debut = tri.length;
      function sommet(i) {
        var k = carte.get(i);
        if (k !== undefined) return k;
        var S = sommets[i];
        k = pos.length / 3;
        carte.set(i, k);
        pos.push(S.p[0], S.p[1], S.p[2]);
        nor.push(S.n[0], S.n[1], S.n[2]);
        uv.push(S.uv[0], S.uv[1]);
        col.push(S.c[0], S.c[1], S.c[2], S.c[3]);
        var w = S.w.slice();
        if (sm.peau === 2 || !aPoids || (w[0] + w[1] + w[2] + w[3]) <= 0) w = [1, 0, 0, 0];
        for (var z = 0; z < 4; z++) {
          var local = S.os[z] | 0, g = sm.palette[local];
          if (g === undefined) { if (w[z] > 0 && sm.peau) horsPalette++; g = sm.palette[0] || 0; }
          osG.push(g);
          poids.push(sm.peau === 2 ? (z === 0 ? 1 : 0) : w[z]);
        }
        peau.push(sm.peau === 1 ? 1 : sm.peau === 2 ? 2 : 0);
        return k;
      }
      var I = sm.indices, nI = I.length;
      if (sm.primitive === 1) { // bande de triangles
        for (var t = 0; t + 2 < nI; t++) {
          var a0 = I[t], a1 = I[t + 1], a2 = I[t + 2];
          if (a0 === a1 || a1 === a2 || a0 === a2) continue;
          if (t & 1) tri.push(sommet(a1), sommet(a0), sommet(a2)); else tri.push(sommet(a0), sommet(a1), sommet(a2));
        }
      } else if (sm.primitive === 2) { // éventail
        for (var f2 = 1; f2 + 1 < nI; f2++) tri.push(sommet(I[0]), sommet(I[f2]), sommet(I[f2 + 1]));
      } else {
        for (var t3 = 0; t3 + 2 < nI; t3 += 3) tri.push(sommet(I[t3]), sommet(I[t3 + 1]), sommet(I[t3 + 2]));
      }
      return { peau: PEAUX[sm.peau] || ('mode ' + sm.peau), os: sm.palette, faces: (tri.length - debut) / 3, primitive: ['triangles', 'bande', 'éventail', 'géométrie'][sm.primitive] };
    });
    if (horsPalette) avert.push('Maillage « ' + res.nom + ' » : ' + horsPalette + ' sommets désignent un os hors de la palette de leur sous-maillage.');

    res.sommets = pos.length / 3;
    res.positions = new Float32Array(pos);
    res.normales = aNormale ? new Float32Array(nor) : null;
    res.uvs = aUV ? new Float32Array(uv) : null;
    res.couleurs = aCouleur ? new Float32Array(col) : null;
    res.os = new Uint16Array(osG);
    res.poids = new Float32Array(poids);
    res.peau = new Uint8Array(peau);
    res.indices = new Uint32Array(tri);
    res.faces = tri.length / 3;
    return res;
  }

  // ---------- Animations de squelette (SPICA H3DAnimation et ses éléments ; Ohana BCH.cs « Skeletal Animations ») ----------
  function lireAnimation(L, p, version, avert) {
    var anim = {
      nom: L.chaine(L.u32(p)),
      boucle: (L.u8(p + 4) & 1) === 1,
      images: L.f32(p + 8),
      os: [],
      ignores: 0
    };
    var tab = L.u32(p + 12), n = L.u32(p + 16);
    var drap = {};
    for (var i = 0; i < n; i++) {
      var e = L.u32(tab + 4 * i);
      var nom = L.chaine(L.u32(e)), prim = L.u16(e + 6);
      if (prim === 4) {
        // H3DAnimTransform : drapeaux, puis neuf mots (échelle, rotation, translation × X, Y, Z),
        // chacun constante ou pointeur vers une courbe.
        var fl = L.u32(e + 8), cm = 1 << 6, nm = 1 << 16, courbes = [];
        for (var k = 0; k < 9; k++) {
          var q = e + 12 + 4 * k;
          var constant = (fl & cm) !== 0, existe = (fl & nm) === 0;
          courbes.push(existe ? (constant ? courbeConstante(L.f32(q)) : lireCourbe(L, L.u32(q), version, drap)) : null);
          cm <<= 1; nm <<= 1;
          if (cm === 1 << 12) cm <<= 1; // le bit de W de la rotation ne sert pas
        }
        anim.os.push({ nom: nom, type: 'courbes', echelle: courbes.slice(0, 3), rotation: courbes.slice(3, 6), translation: courbes.slice(6, 9) });
      } else if (prim === 7) {
        // H3DAnimQuatTransform : une valeur par image (échelle, quaternion, translation).
        var f2 = L.u32(e + 8), adr = [L.u32(e + 12), L.u32(e + 16), L.u32(e + 20)];
        var cm2 = 4, nm2 = 32, listes = [[], [], []];
        for (var k2 = 0; k2 < 3; k2++) {
          var cst = (f2 & cm2) !== 0, ex = (f2 & nm2) === 0;
          if (ex) {
            var a = adr[k2], nb = 1;
            if (!cst) { a = L.u32(adr[k2] + 12); nb = L.u32(adr[k2] + 16); }
            if (nb > 100000) throw new Error('animation « ' + anim.nom + ' » : nombre d’images invraisemblable');
            var t = k2 === 1 ? 16 : 12;
            for (var j = 0; j < nb; j++) {
              var b = a + j * t;
              listes[k2].push(k2 === 1 ? [L.f32(b), L.f32(b + 4), L.f32(b + 8), L.f32(b + 12)] : [L.f32(b), L.f32(b + 4), L.f32(b + 8)]);
            }
          }
          cm2 >>= 1; nm2 >>= 1;
        }
        anim.os.push({ nom: nom, type: 'quaternions', echelles: listes[0], rotations: listes[1], translations: listes[2] });
      } else if (prim === 9) {
        // H3DAnimMtxTransform : une matrice 3 × 4 par image.
        var mp = L.u32(e + 20), mn = L.u32(e + 24), mats = [];
        if (mn > 100000) throw new Error('animation « ' + anim.nom + ' » : nombre d’images invraisemblable');
        for (var j2 = 0; j2 < mn; j2++) {
          var v = [];
          for (var z = 0; z < 12; z++) v.push(L.f32(mp + j2 * 48 + 4 * z));
          mats.push(m4depuis3x4(v));
        }
        anim.os.push({ nom: nom, type: 'matrices', matrices: mats });
      } else {
        anim.ignores++;
      }
    }
    if (drap.courbeOhana) avert.courbeOhana = true;
    return anim;
  }

  // Valeur d'une liste par image entière, bornée (H3DAnimQuatTransform.GetFrameValue).
  function parImage(liste, i) { return i < 0 ? liste[0] : i >= liste.length ? liste[liste.length - 1] : liste[i]; }

  // Matrices monde de tous les os pour une animation et une image (SPICA SkeletalAnimation).
  function poseAnimee(squelette, animation, image) {
    if (!animation || !squelette.length) return squelette.map(function (b) { return b.monde; });
    if (!animation._index) {
      var index = {};
      squelette.forEach(function (b, i) { index[b.nom] = i; });
      animation._index = index;
    }
    var etat = squelette.map(function (b) { return { s: b.echelle.slice(), r: b.rotation.slice(), t: b.translation.slice(), q: quatEuler(b.rotation) }; });
    var fixes = [];
    animation.os.forEach(function (el) {
      var i = animation._index[el.nom];
      if (i === undefined) return;
      var e = etat[i];
      if (el.type === 'courbes') {
        var tourne = false;
        for (var a = 0; a < 3; a++) {
          if (el.echelle[a]) e.s[a] = valeurCourbe(el.echelle[a], image);
          if (el.rotation[a]) { e.r[a] = valeurCourbe(el.rotation[a], image); tourne = true; }
          if (el.translation[a]) e.t[a] = valeurCourbe(el.translation[a], image);
        }
        if (tourne) e.q = quatEuler(e.r);
      } else if (el.type === 'quaternions') {
        var f = Math.floor(image), w = image - f;
        if (el.echelles.length) { var s0 = parImage(el.echelles, f), s1 = parImage(el.echelles, f + 1); e.s = [s0[0] + (s1[0] - s0[0]) * w, s0[1] + (s1[1] - s0[1]) * w, s0[2] + (s1[2] - s0[2]) * w]; }
        if (el.rotations.length) e.q = slerp(parImage(el.rotations, f), parImage(el.rotations, f + 1), w);
        if (el.translations.length) { var t0 = parImage(el.translations, f), t1 = parImage(el.translations, f + 1); e.t = [t0[0] + (t1[0] - t0[0]) * w, t0[1] + (t1[1] - t0[1]) * w, t0[2] + (t1[2] - t0[2]) * w]; }
      } else if (el.type === 'matrices' && el.matrices.length) {
        fixes[i] = parImage(el.matrices, Math.floor(image));
      }
    });
    return poseChaine(squelette, etat, fixes);
  }

  // ---------- Le fichier entier (SPICA H3D.Open, Ohana BCH.load) ----------
  function lire(octets, options) {
    options = options || {};
    if (!(octets instanceof Uint8Array)) octets = new Uint8Array(octets);
    if (!estBCH(octets)) throw new Error('Ce n’est pas un fichier BCH : il ne commence pas par « BCH ».');
    var copie = new Uint8Array(octets); // la relocalisation écrit dans les données
    var L = new Lecteur(copie);
    var h = lireEntete(L);
    var avert = [];
    var version = h.retro;
    if (h.reloc + h.longReloc > L.n) throw new Error('Fichier BCH tronqué : la table de relocalisation dépasse la fin du fichier.');
    relocaliser(L, h);

    var C = h.contenu;
    var dicos = {};
    ['modeles', 'materiaux', 'shaders', 'textures', 'luts', 'lumieres', 'cameras', 'brouillards', 'animSquelette',
      'animMateriaux', 'animVisibilite', 'animLumieres', 'animCameras', 'animBrouillards', 'scenes'].forEach(function (nom, i) {
      dicos[nom] = lireDico(L, C + 12 * i);
    });

    var res = {
      nom: '',
      version: { retro: version, avant: h.avant, convertisseur: h.convertisseur },
      nbModeles: dicos.modeles.nombre,
      maillages: [], materiaux: [], textures: [], squelette: [], animations: [],
      monde: m4(),
      avertissements: avert
    };

    // Textures
    for (var t = 0; t < dicos.textures.nombre; t++) {
      try {
        var tex = lireTexture(L, L.u32(dicos.textures.table + 4 * t));
        if (tex.erreur) avert.push('Texture « ' + tex.nom + ' » (' + tex.format + ') non décodée : ' + tex.erreur + '.');
        res.textures.push(tex);
      } catch (e) {
        avert.push('Texture n° ' + (t + 1) + ' illisible : ' + e.message);
      }
    }

    // Modèle
    var choix = options.modele || 0;
    if (dicos.modeles.nombre > 1) avert.push(dicos.modeles.nombre + ' modèles dans ce fichier : seul le n° ' + (choix + 1) + ' est montré.');
    if (dicos.modeles.nombre > 0 && choix < dicos.modeles.nombre) {
      var M = L.u32(dicos.modeles.table + 4 * choix);
      // SPICA H3DModel : drapeaux, échelle des os, silhouettes, matrice monde (3 × 4), matériaux,
      // maillages, quatre couches, (cullings dès la version 7), squelette, visibilité, nom, arbre des nœuds.
      var monde = [];
      for (var k = 0; k < 12; k++) monde.push(L.f32(M + 4 + 4 * k));
      res.monde = m4depuis3x4(monde);
      var mat = lireDico(L, M + 0x34);
      var maillages = { table: L.u32(M + 0x40), nombre: L.u32(M + 0x44) };
      var suite = M + (version > 6 ? 0x70 : 0x68);
      var sq = lireDico(L, suite);
      var visPtr = L.u32(suite + 12), visN = L.u32(suite + 16);
      res.nom = L.chaine(L.u32(suite + 20));
      var nbNoeuds = L.u32(suite + 24), arbre = L.u32(suite + 28);
      var noms = [];
      try { noms = nomsArbre(L, arbre, nbNoeuds); } catch (e) { avert.push('Noms des maillages illisibles.'); }
      var visibilite = null;
      if (visPtr && visN) {
        visibilite = function (noeud) {
          if (noeud >= visN) return true;
          try { return ((L.u32(visPtr + 4 * (noeud >> 5)) >>> (noeud & 31)) & 1) === 1; } catch (e) { return true; }
        };
      }
      for (var im = 0; im < mat.nombre; im++) {
        try { res.materiaux.push(lireMateriau(L, mat.table + im * (version >= 0x21 ? 0x2c : 0x58), version, h, avert)); }
        catch (e) { res.materiaux.push({ nom: 'matériau ' + (im + 1), textures: ['', '', ''], enveloppes: [], uv: null, alphaTest: { actif: false, fonction: 1, reference: 0 }, melange: { actif: false }, ecritureProfondeur: true }); avert.push('Matériau n° ' + (im + 1) + ' illisible : ' + e.message); }
      }
      try { res.squelette = lireSquelette(L, sq.table, sq.nombre, avert); }
      catch (e) { avert.push('Squelette illisible : ' + e.message); res.squelette = []; }
      var silhouettes = 0;
      for (var mm = 0; mm < maillages.nombre; mm++) {
        var adrM = maillages.table + mm * 0x38;
        try {
          if ((L.u8(adrM + 2) & 3) === 1) { silhouettes++; continue; } // maillage de silhouette (contour)
          res.maillages.push(lireMaillage(L, adrM, noms, visibilite, avert));
        } catch (e) {
          avert.push('Maillage n° ' + (mm + 1) + ' illisible : ' + e.message + '.');
        }
      }
      if (silhouettes) avert.push(silhouettes + ' maillages de silhouette (contours) laissés de côté.');
    }

    // Animations de squelette
    var flag = {};
    for (var a = 0; a < dicos.animSquelette.nombre; a++) {
      try {
        var an = lireAnimation(L, L.u32(dicos.animSquelette.table + 4 * a), version, flag);
        if (an.ignores) avert.push('Animation « ' + an.nom + ' » : ' + an.ignores + ' pistes d’un type non pris en charge ignorées.');
        res.animations.push(an);
      } catch (e) {
        avert.push('Animation n° ' + (a + 1) + ' illisible : ' + e.message);
      }
    }
    if (flag.courbeOhana) avert.push('Courbes d’animation rangées comme le lit Ohana3DS et non comme l’attend SPICA pour cette version : lecture à vérifier.');
    var autres = dicos.animMateriaux.nombre + dicos.animVisibilite.nombre + dicos.animLumieres.nombre + dicos.animCameras.nombre + dicos.animBrouillards.nombre;
    if (autres) avert.push(autres + ' animations de matériaux, de visibilité, de lumière ou de caméra ne sont pas lues.');
    return res;
  }

  // =====================================================================================
  // Peau : positions et normales posées (fait sur le processeur, sans limite d'os)
  // =====================================================================================

  // SPICA.Rendering/Mesh.cs : peau lisse = monde × inverse, peau rigide = monde seul.
  function matricesPeau(squelette, mondes) {
    var lisse = [], rigide = [];
    for (var i = 0; i < squelette.length; i++) {
      rigide.push(mondes[i]);
      lisse.push(m4mul(mondes[i], squelette[i].inverse));
    }
    return { lisse: lisse, rigide: rigide };
  }

  function appliquerPeau(m, peaux, sortieP, sortieN) {
    var P = m.positions, N = m.normales, n = m.sommets;
    for (var v = 0; v < n; v++) {
      var x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      var nx = N ? N[v * 3] : 0, ny = N ? N[v * 3 + 1] : 0, nz = N ? N[v * 3 + 2] : 1;
      var mode = m.peau[v];
      if (mode === 0 || !peaux) {
        sortieP[v * 3] = x; sortieP[v * 3 + 1] = y; sortieP[v * 3 + 2] = z;
        if (sortieN) { sortieN[v * 3] = nx; sortieN[v * 3 + 1] = ny; sortieN[v * 3 + 2] = nz; }
        continue;
      }
      var liste = mode === 2 ? peaux.rigide : peaux.lisse;
      var px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
      for (var k = 0; k < 4; k++) {
        var w = m.poids[v * 4 + k];
        if (!w) continue;
        var M = liste[m.os[v * 4 + k]];
        if (!M) continue;
        px += w * (M[0] * x + M[4] * y + M[8] * z + M[12]);
        py += w * (M[1] * x + M[5] * y + M[9] * z + M[13]);
        pz += w * (M[2] * x + M[6] * y + M[10] * z + M[14]);
        qx += w * (M[0] * nx + M[4] * ny + M[8] * nz);
        qy += w * (M[1] * nx + M[5] * ny + M[9] * nz);
        qz += w * (M[2] * nx + M[6] * ny + M[10] * nz);
      }
      sortieP[v * 3] = px; sortieP[v * 3 + 1] = py; sortieP[v * 3 + 2] = pz;
      if (sortieN) {
        var l = Math.hypot(qx, qy, qz) || 1;
        sortieN[v * 3] = qx / l; sortieN[v * 3 + 1] = qy / l; sortieN[v * 3 + 2] = qz / l;
      }
    }
  }

  // Normales calculées depuis les faces quand le maillage n'en a pas.
  function normalesFaces(m) {
    var N = new Float32Array(m.sommets * 3), P = m.positions, I = m.indices;
    for (var t = 0; t + 2 < I.length; t += 3) {
      var a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      var ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      var vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      [a, b, c].forEach(function (i) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; });
    }
    for (var i = 0; i < N.length; i += 3) {
      var l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
      N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
    }
    return N;
  }

  // =====================================================================================
  // Rendu WebGL 1, écrit à la main
  // =====================================================================================

  var VS_MODELE = [
    'attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUV; attribute vec4 aCol;',
    'uniform mat4 uVP; uniform mat4 uM; uniform vec3 uUV0; uniform vec3 uUV1;',
    'varying vec3 vNor; varying vec2 vUV; varying vec4 vCol;',
    'void main() {',
    '  vec4 p = uM * vec4(aPos, 1.0);',
    '  vNor = mat3(uM) * aNor;',
    '  vUV = vec2(dot(uUV0, vec3(aUV, 1.0)), dot(uUV1, vec3(aUV, 1.0)));',
    '  vCol = aCol;',
    '  gl_Position = uVP * p;',
    '}'].join('\n');

  var FS_MODELE = [
    'precision mediump float;',
    'uniform sampler2D uTex; uniform float uAvecTex; uniform float uAlphaFn; uniform float uAlphaRef; uniform float uEclaire; uniform vec3 uLum;',
    'varying vec3 vNor; varying vec2 vUV; varying vec4 vCol;',
    'bool passe(float a) {',
    '  float f = floor(uAlphaFn + 0.5), r = uAlphaRef;',
    '  if (f < 0.5) return false; if (f < 1.5) return true;',
    '  if (f < 2.5) return abs(a - r) < 0.003; if (f < 3.5) return abs(a - r) >= 0.003;',
    '  if (f < 4.5) return a < r; if (f < 5.5) return a <= r; if (f < 6.5) return a > r; return a >= r;',
    '}',
    'void main() {',
    '  vec4 c = vCol;',
    '  if (uAvecTex > 0.5) c *= texture2D(uTex, vUV);',
    '  if (!passe(c.a)) discard;',
    '  vec3 n = normalize(vNor);',
    '  float d = max(dot(n, uLum), 0.0);',
    '  float k = mix(1.0, 0.52 + 0.48 * d + 0.10 * max(n.y, 0.0), uEclaire);',
    '  gl_FragColor = vec4(c.rgb * k, c.a);',
    '}'].join('\n');

  var VS_TRAIT = [
    'attribute vec3 aPos; attribute vec4 aCol;',
    'uniform mat4 uVP; uniform mat4 uM; uniform float uTaille;',
    'varying vec4 vCol;',
    'void main() { vCol = aCol; gl_PointSize = uTaille; gl_Position = uVP * uM * vec4(aPos, 1.0); }'].join('\n');
  var FS_TRAIT = 'precision mediump float; varying vec4 vCol; void main() { gl_FragColor = vCol; }';

  var VS_FOND = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.999, 1.0); }';
  var FS_FOND = [
    'precision mediump float; uniform vec3 uA; uniform vec3 uB; uniform float uCase;',
    'void main() { vec2 c = floor(gl_FragCoord.xy / uCase); float k = mod(c.x + c.y, 2.0); gl_FragColor = vec4(mix(uA, uB, k), 1.0); }'].join('\n');

  var FONDS = {
    gris: [[0.47, 0.47, 0.46], [0.47, 0.47, 0.46]],
    noir: [[0.075, 0.075, 0.075], [0.075, 0.075, 0.075]],
    blanc: [[0.95, 0.95, 0.94], [0.95, 0.95, 0.94]],
    damier: [[0.80, 0.80, 0.79], [0.62, 0.62, 0.61]]
  };

  var VUES = {
    ensemble: [0.62, 0.32], face: [0, 0.06], dos: [Math.PI, 0.06], profil: [-Math.PI / 2, 0.06],
    gauche: [-Math.PI / 2, 0.06], droite: [Math.PI / 2, 0.06], dessus: [0, 1.5], dessous: [0, -1.5]
  };

  function compiler(gl, vs, fs) {
    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader : ' + gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Programme : ' + gl.getProgramInfoLog(p));
    var info = { p: p, a: {}, u: {} };
    var na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES), nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < na; i++) { var a = gl.getActiveAttrib(p, i); info.a[a.name] = gl.getAttribLocation(p, a.name); }
    for (var j = 0; j < nu; j++) { var u = gl.getActiveUniform(p, j); info.u[u.name] = gl.getUniformLocation(p, u.name); }
    return info;
  }

  function perspective(fov, aspect, pres, loin) {
    var f = 1 / Math.tan(fov / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (loin + pres) / (pres - loin); m[11] = -1; m[14] = 2 * loin * pres / (pres - loin);
    return m;
  }
  function regarder(oeil, cible, haut) {
    var zx = oeil[0] - cible[0], zy = oeil[1] - cible[1], zz = oeil[2] - cible[2];
    var l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    var xx = haut[1] * zz - haut[2] * zy, xy = haut[2] * zx - haut[0] * zz, xz = haut[0] * zy - haut[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    var m = m4();
    m[0] = xx; m[4] = xy; m[8] = xz; m[1] = yx; m[5] = yy; m[9] = yz; m[2] = zx; m[6] = zy; m[10] = zz;
    m[12] = -(xx * oeil[0] + xy * oeil[1] + xz * oeil[2]);
    m[13] = -(yx * oeil[0] + yy * oeil[1] + yz * oeil[2]);
    m[14] = -(zx * oeil[0] + zy * oeil[1] + zz * oeil[2]);
    return { m: m, droite: [xx, xy, xz], haut: [yx, yy, yz], avant: [-zx, -zy, -zz] };
  }

  // Tournette : un plateau de bois tourné, cerclé de laiton (sommets colorés, sans texture).
  function geometrieTournette(rayon, epaisseur, y) {
    var P = [], N = [], C = [], I = [];
    var bois = [[0.36, 0.25, 0.17], [0.40, 0.28, 0.19]], flanc = [0.25, 0.17, 0.11], laiton = [0.79, 0.64, 0.30];
    var seg = 96, anneaux = 9;
    function sommet(x, yy, z, nx, ny, nz, c) { P.push(x, yy, z); N.push(nx, ny, nz); C.push(c[0], c[1], c[2], 1); return P.length / 3 - 1; }
    var rIn = rayon * 0.955;
    // dessus : anneaux concentriques aux teintes alternées, comme le bois tourné
    var centre = sommet(0, y, 0, 0, 1, 0, bois[0]);
    var prec = null;
    for (var a = 1; a <= anneaux; a++) {
      var r = rIn * a / anneaux, coul = bois[a % 2], cour = [];
      for (var s = 0; s <= seg; s++) {
        var t = s / seg * Math.PI * 2;
        cour.push(sommet(Math.cos(t) * r, y, Math.sin(t) * r, 0, 1, 0, coul));
      }
      var anc = [];
      if (prec) {
        for (var s2 = 0; s2 <= seg; s2++) { var t2 = s2 / seg * Math.PI * 2, r0 = rIn * (a - 1) / anneaux; anc.push(sommet(Math.cos(t2) * r0, y, Math.sin(t2) * r0, 0, 1, 0, coul)); }
        for (var s3 = 0; s3 < seg; s3++) I.push(anc[s3], cour[s3 + 1], cour[s3], anc[s3], anc[s3 + 1], cour[s3 + 1]);
      } else {
        for (var s4 = 0; s4 < seg; s4++) I.push(centre, cour[s4 + 1], cour[s4]);
      }
      prec = cour;
    }
    // cerclage de laiton sur le dessus, puis le flanc
    function bande(r0, r1, y0, y1, c, normaleHaut) {
      var h = [], b = [];
      for (var s = 0; s <= seg; s++) {
        var t = s / seg * Math.PI * 2, cx = Math.cos(t), cz = Math.sin(t);
        h.push(sommet(cx * r0, y0, cz * r0, normaleHaut ? 0 : cx, normaleHaut ? 1 : 0, normaleHaut ? 0 : cz, c));
        b.push(sommet(cx * r1, y1, cz * r1, normaleHaut ? 0 : cx, normaleHaut ? 1 : 0, normaleHaut ? 0 : cz, c));
      }
      for (var k = 0; k < seg; k++) I.push(h[k], b[k + 1], b[k], h[k], h[k + 1], b[k + 1]);
    }
    bande(rIn, rayon, y, y, laiton, true);
    bande(rayon, rayon, y, y - epaisseur * 0.35, laiton, false);
    bande(rayon, rayon, y - epaisseur * 0.35, y - epaisseur, flanc, false);
    return { positions: new Float32Array(P), normales: new Float32Array(N), couleurs: new Float32Array(C), indices: new Uint16Array(I) };
  }

  function rendre(canvas, modele, options) {
    options = Object.assign({ fond: 'gris', grille: false, squelette: false, tournette: false, socle: false, interactions: true, surImage: null, surVue: null }, options || {});
    var gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL n’est pas disponible dans ce navigateur : la vitrine ne peut pas s’allumer.');
    var extU32 = gl.getExtension('OES_element_index_uint');
    var progM = compiler(gl, VS_MODELE, FS_MODELE);
    var progT = compiler(gl, VS_TRAIT, FS_TRAIT);
    var progF = compiler(gl, VS_FOND, FS_FOND);
    var squelette = modele.squelette || [];
    var lumiere = (function () { var v = [0.45, 0.8, 0.55], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();

    function tampon(donnees, cible, usage) {
      var b = gl.createBuffer();
      gl.bindBuffer(cible || gl.ARRAY_BUFFER, b);
      gl.bufferData(cible || gl.ARRAY_BUFFER, donnees, usage || gl.STATIC_DRAW);
      return b;
    }

    // ---- textures
    var blanc = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blanc);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    var texParNom = {};
    (modele.textures || []).forEach(function (t) {
      if (!t.rgba || texParNom[t.nom]) return;
      var tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // la ligne du bas de l'image est v = 0
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.largeur, t.hauteur, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(t.rgba.buffer, t.rgba.byteOffset, t.rgba.byteLength));
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      var pot = (t.largeur & (t.largeur - 1)) === 0 && (t.hauteur & (t.hauteur - 1)) === 0;
      if (pot) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      texParNom[t.nom] = { tex: tx, pot: pot };
    });
    function enveloppe(code, pot) {
      if (!pot) return gl.CLAMP_TO_EDGE;
      return code === 2 ? gl.REPEAT : code === 3 ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
    }

    // ---- maillages
    var objets = (modele.maillages || []).map(function (m) {
      var normales = m.normales || normalesFaces(m);
      var src = { positions: m.positions, normales: normales, sommets: m.sommets, peau: m.peau, os: m.os, poids: m.poids };
      var P = new Float32Array(m.sommets * 3), N = new Float32Array(m.sommets * 3);
      var grand = m.sommets > 65535;
      if (grand && !extU32) throw new Error('Ce maillage dépasse 65 535 sommets et le navigateur ne sait pas les indexer.');
      var mat = (modele.materiaux || [])[m.materiau] || null;
      var o = {
        m: m, src: src, P: P, N: N,
        bP: tampon(P, null, gl.DYNAMIC_DRAW), bN: tampon(N, null, gl.DYNAMIC_DRAW),
        bUV: tampon(m.uvs || new Float32Array(m.sommets * 2)),
        bC: m.couleurs ? tampon(m.couleurs) : null,
        bI: tampon(grand ? new Uint32Array(m.indices) : new Uint16Array(m.indices), gl.ELEMENT_ARRAY_BUFFER),
        typeI: grand ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        n: m.indices.length,
        mat: mat,
        tex: mat && mat.textures && texParNom[mat.textures[0]] || null,
        cache: m.visible === false
      };
      o.transparent = !!(mat && mat.melange && mat.melange.actif);
      return o;
    });

    // ---- pose
    var etat = { animation: -1, image: 0, vitesse: 1, lecture: false, angle: 0 };
    var mondes = squelette.map(function (b) { return b.monde; });
    function poser() {
      var anim = etat.animation >= 0 ? modele.animations[etat.animation] : null;
      mondes = poseAnimee(squelette, anim, etat.image);
      var peaux = squelette.length ? matricesPeau(squelette, mondes) : null;
      objets.forEach(function (o) {
        appliquerPeau(o.src, peaux, o.P, o.N);
        gl.bindBuffer(gl.ARRAY_BUFFER, o.bP); gl.bufferSubData(gl.ARRAY_BUFFER, 0, o.P);
        gl.bindBuffer(gl.ARRAY_BUFFER, o.bN); gl.bufferSubData(gl.ARRAY_BUFFER, 0, o.N);
      });
    }
    poser();

    // Boîte englobante de la pose de repos (maillages visibles).
    var mini = [Infinity, Infinity, Infinity], maxi = [-Infinity, -Infinity, -Infinity];
    objets.forEach(function (o) {
      if (o.cache) return;
      for (var i = 0; i < o.P.length; i += 3) {
        var x = o.P[i], y = o.P[i + 1], z = o.P[i + 2];
        var wx = modele.monde ? modele.monde[0] * x + modele.monde[4] * y + modele.monde[8] * z + modele.monde[12] : x;
        var wy = modele.monde ? modele.monde[1] * x + modele.monde[5] * y + modele.monde[9] * z + modele.monde[13] : y;
        var wz = modele.monde ? modele.monde[2] * x + modele.monde[6] * y + modele.monde[10] * z + modele.monde[14] : z;
        if (!isFinite(wx + wy + wz)) continue;
        mini[0] = Math.min(mini[0], wx); mini[1] = Math.min(mini[1], wy); mini[2] = Math.min(mini[2], wz);
        maxi[0] = Math.max(maxi[0], wx); maxi[1] = Math.max(maxi[1], wy); maxi[2] = Math.max(maxi[2], wz);
      }
    });
    if (!isFinite(mini[0])) { mini = [-1, 0, -1]; maxi = [1, 2, 1]; }
    var centre = [(mini[0] + maxi[0]) / 2, (mini[1] + maxi[1]) / 2, (mini[2] + maxi[2]) / 2];
    var rayon = Math.max(Math.hypot(maxi[0] - mini[0], maxi[1] - mini[1], maxi[2] - mini[2]) / 2, 1e-3);
    var sol = mini[1];

    // ---- tournette et grille
    var rTour = Math.max(Math.hypot(maxi[0] - centre[0], maxi[2] - centre[2]) * 1.12, rayon * 0.55);
    var epTour = rTour * 0.07;
    var tour = null;
    function construireTournette() {
      var g = geometrieTournette(rTour, epTour, sol - rayon * 0.004);
      tour = { bP: tampon(g.positions), bN: tampon(g.normales), bC: tampon(g.couleurs), bI: tampon(g.indices, gl.ELEMENT_ARRAY_BUFFER), n: g.indices.length };
    }
    if (options.socle) construireTournette();
    var grille = null;
    function construireGrille() {
      var y = sol - (options.socle ? epTour : 0) - rayon * 0.002, L2 = [], C2 = [];
      var pasG = Math.pow(10, Math.floor(Math.log10(rayon / 2))), etendue = Math.ceil(rayon * 3 / pasG) * pasG;
      var clair = options.fond === 'noir';
      for (var v = -etendue; v <= etendue + 1e-9; v += pasG) {
        var axe = Math.abs(v) < pasG / 2, a = axe ? 0.55 : 0.25;
        var c = clair ? [1, 1, 1, a] : [0.1, 0.08, 0.06, a];
        L2.push(v + centre[0], y, -etendue + centre[2], v + centre[0], y, etendue + centre[2]);
        L2.push(-etendue + centre[0], y, v + centre[2], etendue + centre[0], y, v + centre[2]);
        for (var k = 0; k < 4; k++) C2.push(c[0], c[1], c[2], c[3]);
      }
      grille = { bP: tampon(new Float32Array(L2)), bC: tampon(new Float32Array(C2)), n: L2.length / 3 };
    }
    var bFond = tampon(new Float32Array([-1, -1, 3, -1, -1, 3]));

    // ---- caméra orbitale
    // Cadrage : tout le spécimen et sa tournette, la cible un peu sous le centre.
    function cibleDepart() { return [centre[0], centre[1] - rayon * 0.12, centre[2]]; }
    // une vitrine plus haute que large recule la caméra, pour que le spécimen tienne en largeur
    function recul(k) { var a = (canvas.clientWidth || 4) / (canvas.clientHeight || 3); return rayon * k * Math.max(1, 0.95 / a); }
    var cam = { lacet: VUES.ensemble[0], tangage: VUES.ensemble[1], distance: recul(4.3), cible: cibleDepart() };
    var fov = 0.62;
    function oeil() {
      var cp = Math.cos(cam.tangage);
      return [cam.cible[0] + cam.distance * cp * Math.sin(cam.lacet), cam.cible[1] + cam.distance * Math.sin(cam.tangage), cam.cible[2] + cam.distance * cp * Math.cos(cam.lacet)];
    }
    function matrices() {
      var w = canvas.width || 1, h = canvas.height || 1;
      var o = oeil();
      var vue = regarder(o, cam.cible, [0, 1, 0]);
      var proj = perspective(fov, w / h, Math.max(cam.distance - rayon * 4, cam.distance * 0.01, rayon * 0.002), cam.distance + rayon * 8);
      return { vp: m4mul(proj, vue.m), vue: vue, oeil: o };
    }
    function vue(nom) {
      var v = VUES[nom] || VUES.ensemble;
      cam.lacet = v[0]; cam.tangage = v[1];
      cam.cible = cibleDepart();
      cam.distance = recul(nom === 'ensemble' || !VUES[nom] ? 4.3 : 4);
      sale = true;
      if (options.surVue) options.surVue(nom);
    }

    // ---- dessin
    var sale = true, enMarche = false, idBoucle = 0, dernier = 0;
    function attribut(prog, nom, b, taille) {
      var loc = prog.a[nom];
      if (loc === undefined) return;
      if (!b) { gl.disableVertexAttribArray(loc); gl.vertexAttrib4f(loc, 1, 1, 1, 1); return; }
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, taille, gl.FLOAT, false, 0, 0);
    }
    function ajusterTaille() {
      var r = window.devicePixelRatio || 1;
      var w = Math.max(1, Math.round(canvas.clientWidth * r)), h = Math.max(1, Math.round(canvas.clientHeight * r));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; sale = true; }
    }
    function modeleM() {
      var m = m4rotY(etat.angle);
      // la tournette tourne autour de l'axe vertical qui passe par le centre du spécimen
      m = m4mul(m4translation(centre[0], 0, centre[2]), m4mul(m, m4translation(-centre[0], 0, -centre[2])));
      return m;
    }
    function dessiner() {
      ajusterTaille();
      gl.viewport(0, 0, canvas.width, canvas.height);
      var f = FONDS[options.fond] || FONDS.gris;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
      gl.clearColor(f[0][0], f[0][1], f[0][2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (options.fond === 'damier') {
        gl.useProgram(progF.p);
        gl.uniform3fv(progF.u.uA, f[0]); gl.uniform3fv(progF.u.uB, f[1]);
        gl.uniform1f(progF.u.uCase, 12 * (window.devicePixelRatio || 1));
        gl.bindBuffer(gl.ARRAY_BUFFER, bFond);
        gl.enableVertexAttribArray(progF.a.aPos);
        gl.vertexAttribPointer(progF.a.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disableVertexAttribArray(progF.a.aPos);
      }
      var mt = matrices();
      var M = modeleM();
      var Mmod = modele.monde ? m4mul(M, modele.monde) : M;
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      // grille, sous tout le reste
      if (options.grille) {
        if (!grille || grille.fond !== options.fond) { construireGrille(); grille.fond = options.fond; }
        gl.useProgram(progT.p);
        gl.uniformMatrix4fv(progT.u.uVP, false, mt.vp);
        gl.uniformMatrix4fv(progT.u.uM, false, m4());
        gl.uniform1f(progT.u.uTaille, 1);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        attribut(progT, 'aPos', grille.bP, 3); attribut(progT, 'aCol', grille.bC, 4);
        gl.drawArrays(gl.LINES, 0, grille.n);
        gl.disable(gl.BLEND);
      }

      gl.useProgram(progM.p);
      gl.uniformMatrix4fv(progM.u.uVP, false, mt.vp);
      gl.uniform3fv(progM.u.uLum, lumiere);
      gl.uniform1i(progM.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);

      if (tour && options.socle) {
        gl.uniformMatrix4fv(progM.u.uM, false, M);
        gl.uniform3f(progM.u.uUV0, 1, 0, 0); gl.uniform3f(progM.u.uUV1, 0, 1, 0);
        gl.uniform1f(progM.u.uAvecTex, 0); gl.uniform1f(progM.u.uAlphaFn, 1); gl.uniform1f(progM.u.uAlphaRef, 0); gl.uniform1f(progM.u.uEclaire, 1);
        attribut(progM, 'aPos', tour.bP, 3); attribut(progM, 'aNor', tour.bN, 3); attribut(progM, 'aUV', null); attribut(progM, 'aCol', tour.bC, 4);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tour.bI);
        gl.drawElements(gl.TRIANGLES, tour.n, gl.UNSIGNED_SHORT, 0);
      }

      gl.uniformMatrix4fv(progM.u.uM, false, Mmod);
      var ordre = objets.filter(function (o) { return !o.cache; });
      ordre.sort(function (a, b) { return (a.transparent - b.transparent) || (a.m.couche - b.m.couche) || (a.m.priorite - b.m.priorite); });
      ordre.forEach(function (o) {
        var mat = o.mat;
        var tex = o.tex;
        gl.bindTexture(gl.TEXTURE_2D, tex ? tex.tex : blanc);
        if (tex) {
          var env = mat.enveloppes && mat.enveloppes[0] || { u: 2, v: 2 };
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, enveloppe(env.u, tex.pot));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, enveloppe(env.v, tex.pot));
        }
        var uv = mat && mat.uv;
        // [u v 1] × M de SPICA : u' = m11 u + m21 v + m41, v' = m12 u + m22 v + m42
        if (uv) { gl.uniform3f(progM.u.uUV0, uv[0], uv[2], uv[4]); gl.uniform3f(progM.u.uUV1, uv[1], uv[3], uv[5]); }
        else { gl.uniform3f(progM.u.uUV0, 1, 0, 0); gl.uniform3f(progM.u.uUV1, 0, 1, 0); }
        gl.uniform1f(progM.u.uAvecTex, tex ? 1 : 0);
        var at = mat && mat.alphaTest && mat.alphaTest.actif ? mat.alphaTest : null;
        gl.uniform1f(progM.u.uAlphaFn, at ? at.fonction : (tex && !o.transparent ? 7 : 1));
        gl.uniform1f(progM.u.uAlphaRef, at ? at.reference : (tex && !o.transparent ? 0.1 : 0));
        gl.uniform1f(progM.u.uEclaire, 1);
        if (o.transparent) {
          gl.enable(gl.BLEND);
          gl.blendFunc(FACTEURS(gl)[mat.melange.source] || gl.SRC_ALPHA, FACTEURS(gl)[mat.melange.destination] || gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false); // les surfaces mélangées ne masquent pas ce qui est derrière elles
        } else {
          gl.disable(gl.BLEND);
          gl.depthMask(true);
        }
        attribut(progM, 'aPos', o.bP, 3); attribut(progM, 'aNor', o.bN, 3); attribut(progM, 'aUV', o.bUV, 2); attribut(progM, 'aCol', o.bC, 4);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.bI);
        gl.drawElements(gl.TRIANGLES, o.n, o.typeI, 0);
      });
      gl.disable(gl.BLEND);
      gl.depthMask(true);

      // squelette par-dessus, sans test de profondeur
      if (options.squelette && squelette.length) {
        var L2 = [], C2 = [], J = [], CJ = [];
        for (var i = 0; i < squelette.length; i++) {
          var w = mondes[i];
          if (!w) continue;
          J.push(w[12], w[13], w[14]); CJ.push(0.82, 0.66, 0.31, 1);
          var p = squelette[i].parent;
          if (p >= 0 && mondes[p]) {
            var q = mondes[p];
            L2.push(q[12], q[13], q[14], w[12], w[13], w[14]);
            C2.push(0.86, 0.70, 0.33, 1, 0.86, 0.70, 0.33, 1);
          }
        }
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(progT.p);
        gl.uniformMatrix4fv(progT.u.uVP, false, mt.vp);
        gl.uniformMatrix4fv(progT.u.uM, false, Mmod);
        if (L2.length) {
          gl.uniform1f(progT.u.uTaille, 1);
          var b1 = tampon(new Float32Array(L2)), c1 = tampon(new Float32Array(C2));
          attribut(progT, 'aPos', b1, 3); attribut(progT, 'aCol', c1, 4);
          gl.drawArrays(gl.LINES, 0, L2.length / 3);
          gl.deleteBuffer(b1); gl.deleteBuffer(c1);
        }
        var b2 = tampon(new Float32Array(J));
        var noirs = new Float32Array(CJ.length); for (var z = 0; z < noirs.length; z += 4) { noirs[z] = 0.16; noirs[z + 1] = 0.12; noirs[z + 2] = 0.09; noirs[z + 3] = 1; }
        var c3 = tampon(noirs), c2 = tampon(new Float32Array(CJ));
        var r = window.devicePixelRatio || 1;
        gl.uniform1f(progT.u.uTaille, 8 * r);
        attribut(progT, 'aPos', b2, 3); attribut(progT, 'aCol', c3, 4);
        gl.drawArrays(gl.POINTS, 0, J.length / 3);
        gl.uniform1f(progT.u.uTaille, 5 * r);
        attribut(progT, 'aCol', c2, 4);
        gl.drawArrays(gl.POINTS, 0, J.length / 3);
        gl.deleteBuffer(b2); gl.deleteBuffer(c2); gl.deleteBuffer(c3);
        gl.enable(gl.DEPTH_TEST);
      }
      sale = false;
    }

    function boucle(t) {
      if (!enMarche) return;
      idBoucle = requestAnimationFrame(boucle);
      var dt = dernier ? Math.min((t - dernier) / 1000, 0.1) : 0;
      dernier = t;
      var anim = etat.animation >= 0 ? modele.animations[etat.animation] : null;
      if (etat.lecture && anim) {
        var total = Math.max(anim.images, 1);
        etat.image = (etat.image + dt * 30 * etat.vitesse) % total;
        if (etat.image < 0) etat.image += total;
        poser();
        sale = true;
        if (options.surImage) options.surImage(etatPublic());
      }
      if (options.tournette) { etat.angle = (etat.angle + dt * 0.4) % (Math.PI * 2); sale = true; }
      ajusterTaille();
      if (sale) dessiner();
    }

    function etatPublic() {
      var anim = etat.animation >= 0 ? modele.animations[etat.animation] : null;
      return { animation: etat.animation, image: etat.image, images: anim ? anim.images : 0, lecture: etat.lecture, vitesse: etat.vitesse };
    }

    // ---- interactions : orbite, déplacement, zoom centré sur le curseur
    var pointeurs = new Map(), geste = null;
    function pointSousCurseur(cx, cy) {
      var rect = canvas.getBoundingClientRect();
      var nx = ((cx - rect.left) / rect.width) * 2 - 1, ny = 1 - ((cy - rect.top) / rect.height) * 2;
      var mt = matrices(), v = mt.vue, aspect = rect.width / rect.height, t = Math.tan(fov / 2);
      var d = [v.avant[0] + (v.droite[0] * nx * aspect + v.haut[0] * ny) * t, v.avant[1] + (v.droite[1] * nx * aspect + v.haut[1] * ny) * t, v.avant[2] + (v.droite[2] * nx * aspect + v.haut[2] * ny) * t];
      // le point du plan qui passe par la cible, face à la caméra
      return [mt.oeil[0] + d[0] * cam.distance, mt.oeil[1] + d[1] * cam.distance, mt.oeil[2] + d[2] * cam.distance];
    }
    function zoomer(facteur, cx, cy) {
      var nouvelle = Math.min(Math.max(cam.distance * facteur, rayon * 0.15), rayon * 25);
      facteur = nouvelle / cam.distance;
      if (cx !== undefined) {
        var P = pointSousCurseur(cx, cy);
        cam.cible = [P[0] + (cam.cible[0] - P[0]) * facteur, P[1] + (cam.cible[1] - P[1]) * facteur, P[2] + (cam.cible[2] - P[2]) * facteur];
      }
      cam.distance = nouvelle;
      sale = true;
    }
    function deplacer(dx, dy) {
      var v = matrices().vue, k = 2 * cam.distance * Math.tan(fov / 2) / (canvas.clientHeight || 1);
      for (var i = 0; i < 3; i++) cam.cible[i] += (-v.droite[i] * dx + v.haut[i] * dy) * k;
      sale = true;
    }
    function tourner(dx, dy) {
      cam.lacet -= dx * 0.008;
      cam.tangage = Math.min(Math.max(cam.tangage + dy * 0.008, -1.55), 1.55);
      sale = true;
    }
    var ecouteurs = [];
    function ecouter(cible, type, f, opt) { cible.addEventListener(type, f, opt); ecouteurs.push([cible, type, f, opt]); }
    if (options.interactions) {
      canvas.style.touchAction = 'none';
      ecouter(canvas, 'wheel', function (e) {
        e.preventDefault();
        var d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        zoomer(Math.exp(d * 0.0013), e.clientX, e.clientY);
      }, { passive: false });
      ecouter(canvas, 'pointerdown', function (e) {
        canvas.setPointerCapture(e.pointerId);
        pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        var depl = e.button === 1 || e.button === 2 || e.shiftKey;
        geste = pointeurs.size >= 2 ? 'pincer' : depl ? 'deplacer' : 'tourner';
        if (e.button === 1) e.preventDefault();
      });
      ecouter(canvas, 'pointermove', function (e) {
        var p = pointeurs.get(e.pointerId);
        if (!p) return;
        if (geste === 'pincer' && pointeurs.size >= 2) {
          var ids = Array.from(pointeurs.keys()), a = pointeurs.get(ids[0]), b = pointeurs.get(ids[1]);
          var avant = Math.hypot(a.x - b.x, a.y - b.y), mx0 = (a.x + b.x) / 2, my0 = (a.y + b.y) / 2;
          p.x = e.clientX; p.y = e.clientY;
          var apres = Math.hypot(a.x - b.x, a.y - b.y), mx1 = (a.x + b.x) / 2, my1 = (a.y + b.y) / 2;
          if (apres > 0 && avant > 0) zoomer(avant / apres, mx1, my1);
          deplacer(mx1 - mx0, my1 - my0);
          return;
        }
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (geste === 'deplacer') deplacer(dx, dy); else if (geste === 'tourner') tourner(dx, dy);
      });
      var fin = function (e) { pointeurs.delete(e.pointerId); if (pointeurs.size === 0) geste = null; else if (pointeurs.size === 1) geste = 'tourner'; };
      ecouter(canvas, 'pointerup', fin);
      ecouter(canvas, 'pointercancel', fin);
      ecouter(canvas, 'contextmenu', function (e) { e.preventDefault(); });
      ecouter(canvas, 'auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
    }

    var controleur = {
      demarrer: function () { if (enMarche) return; enMarche = true; dernier = 0; sale = true; idBoucle = requestAnimationFrame(boucle); },
      arreter: function () { enMarche = false; cancelAnimationFrame(idBoucle); },
      vue: vue,
      animer: function (index, vitesse) {
        if (index === null || index === undefined || index < 0 || !modele.animations || !modele.animations[index]) {
          etat.animation = -1; etat.lecture = false; etat.image = 0;
        } else {
          if (etat.animation !== index) etat.image = 0;
          etat.animation = index; etat.lecture = true;
        }
        if (vitesse !== undefined && vitesse !== null) etat.vitesse = vitesse;
        poser(); sale = true;
        if (options.surImage) options.surImage(etatPublic());
      },
      image: function (n) {
        var anim = etat.animation >= 0 ? modele.animations[etat.animation] : null;
        etat.lecture = false;
        if (anim) {
          var total = Math.max(anim.images, 1);
          etat.image = ((n % total) + total) % total;
        }
        poser(); sale = true;
        if (options.surImage) options.surImage(etatPublic());
      },
      cacher: function (maillage, cache) {
        objets.forEach(function (o, i) {
          if (i === maillage || o.m.nom === maillage || o.m === maillage) o.cache = !!cache;
        });
        sale = true;
      },
      capture: function () { dessiner(); return canvas.toDataURL('image/png'); },
      // Commandes en plus du contrat
      lecture: function (oui) { if (etat.animation < 0) return; etat.lecture = oui === undefined ? !etat.lecture : !!oui; if (options.surImage) options.surImage(etatPublic()); },
      vitesse: function (v) { etat.vitesse = v; if (options.surImage) options.surImage(etatPublic()); },
      etat: etatPublic,
      fond: function (nom) { options.fond = nom; sale = true; },
      grille: function (oui) { options.grille = !!oui; sale = true; },
      squelette: function (oui) { options.squelette = !!oui; sale = true; },
      tournette: function (oui) { options.tournette = !!oui; if (!oui) { etat.angle = 0; } sale = true; },
      zoomer: function (f) { zoomer(f); },
      mesures: function () { return { centre: centre.slice(), rayon: rayon, mini: mini.slice(), maxi: maxi.slice() }; },
      redessiner: function () { sale = true; },
      detruire: function () {
        controleur.arreter();
        ecouteurs.forEach(function (e) { e[0].removeEventListener(e[1], e[2], e[3]); });
        var perte = gl.getExtension('WEBGL_lose_context');
        if (perte) perte.loseContext();
      }
    };
    return controleur;
  }

  function FACTEURS(gl) {
    return [gl.ZERO, gl.ONE, gl.SRC_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.DST_COLOR, gl.ONE_MINUS_DST_COLOR, gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA, gl.DST_ALPHA, gl.ONE_MINUS_DST_ALPHA, gl.CONSTANT_COLOR, gl.ONE_MINUS_CONSTANT_COLOR,
      gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.SRC_ALPHA_SATURATE];
  }

  var BCH = {
    lire: lire,
    rendre: rendre,
    estBCH: estBCH,
    // Pièces internes, exposées pour les tests et pour la page de la visionneuse.
    _interne: {
      Lecteur: Lecteur, lireCommandes: lireCommandes, flottant24: flottant24, flottantVers24: flottantVers24,
      vecteur24: vecteur24, motsVecteur24: motsVecteur24, morton: morton, decoderTexture: decoderTexture,
      blocETC1: blocETC1, tailleTexture: tailleTexture, FORMATS_TEXTURE: FORMATS_TEXTURE, lireCles: lireCles,
      lireCourbe: lireCourbe, valeurCourbe: valeurCourbe, poseAnimee: poseAnimee, matricesPeau: matricesPeau,
      appliquerPeau: appliquerPeau, quatEuler: quatEuler, m4mul: m4mul, m4inverse: m4inverse, m4: m4,
      transformationUV: transformationUV, QUANTIFICATIONS: QUANTIFICATIONS
    }
  };

  racine.BCH = BCH;
  if (typeof module !== 'undefined' && module.exports) module.exports = BCH;
})(typeof window !== 'undefined' ? window : globalThis);
