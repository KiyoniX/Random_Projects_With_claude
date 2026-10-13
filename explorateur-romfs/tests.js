// Tests des lecteurs de formats, sur des données fabriquées. Deux façons de les lancer :
//   node explorateur-romfs/tests.js
//   ouvrir explorateur-romfs/tests.html dans le navigateur
// Les jeux d'essai reprennent ceux de decompil-3ds/outils/ (garc.py, lz11.py, texte.py).
(function (racine) {
  'use strict';

  function lancer(F, journal) {
    var reussis = 0, rates = 0;
    function ok(cond, message) { if (cond) reussis++; else { rates++; journal('RATÉ : ' + message, true); } }
    function egaux(a, b) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
    function leve(f) { try { f(); return false; } catch (e) { return e instanceof Error && /[a-zé]/.test(e.message); } }
    function octets(s) { return new Uint8Array(Array.prototype.map.call(s, function (c) { return c.charCodeAt(0) & 0xFF; })); }
    function hasard(graine) { var s = graine; return function () { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; return s >> 16 & 0xFF; }; }
    function section(nom, f) { var r0 = rates; try { f(); } catch (e) { ok(false, 'exception : ' + e.message); } journal(nom + (rates === r0 ? ' : bon.' : ' : des échecs.'), rates !== r0); }

    section('GARC, allers-retours en version 4 et 6', function () {
      var jeux = [
        [],
        [[octets('')]],
        [[octets('un')], [octets('deux'), octets('trois')], [], [new Uint8Array(7), octets('xxxxxxxxxxxxx'), octets('y')]],
        [[0, 1, 2, 3, 4].map(function () { var o = new Uint8Array(256); for (var i = 0; i < 256; i++) o[i] = i; return o; })]
      ];
      [4, 6].forEach(function (version) {
        jeux.forEach(function (e, n) {
          var g = F.garc.ecrire(e, version), lu = F.garc.lire(g);
          ok(lu.version === version, 'version lue ' + lu.version + ' au lieu de ' + version);
          ok(lu.entrees.length === e.length && lu.entrees.every(function (s, i) {
            return s.length === e[i].length && s.every(function (f, j) { return egaux(f, e[i][j]); });
          }), 'aller-retour GARC raté, jeu ' + n + ', version ' + version);
        });
      });
      var g = F.garc.ecrire([[octets('abc')]], 4);
      ok(g[0] === 0x43 && g[1] === 0x52 && g[2] === 0x41 && g[3] === 0x47, 'le magic doit s\'écrire « CRAG »');
      ok(F.nature(g, 'x').type === 'garc', 'un GARC doit être reconnu');
      ok(leve(function () { F.garc.lire(octets('CRAG')); }), 'un GARC tronqué doit lever une erreur');
      var abime = g.slice(); abime[0x1C] = 0;
      ok(leve(function () { F.garc.lire(abime); }), 'un FATO abîmé doit lever une erreur');
    });

    section('LZ11, allers-retours, et LZ10 écrit à la main', function () {
      var h = hasard(3), essais = [
        octets(''), octets('a'), octets('abcabcabcabcabc'), (function () { var o = new Uint8Array(768); for (var i = 0; i < 768; i++) o[i] = i & 255; return o; })(),
        new Uint8Array(5000), (function () { var o = new Uint8Array(3000); for (var i = 0; i < 3000; i++) o[i] = h(); return o; })(),
        (function () { var mots = ['pokemon', 'garc', 'kalos', '\xff\x00'], s = ''; for (var i = 0; i < 800; i++) s += mots[h() & 3]; return octets(s); })()
      ];
      essais.forEach(function (d) {
        var c = F.lz11.compresser(d);
        if (d.length) ok(egaux(F.lz11.decompresser(c), d), 'aller-retour LZ11 raté sur ' + d.length + ' octets');
        if (d.length) ok(F.lz11.estCompresse(c), 'flux LZ11 de ' + d.length + ' octets non reconnu');
      });
      // Les trois longueurs de référence de LZ11 : courte, moyenne (0x11 à 0x110), longue (0x111 et plus).
      var long = new Uint8Array(0x20000); for (var i = 0; i < long.length; i++) long[i] = i % 7;
      var cl = F.lz11.compresser(long);
      ok(egaux(F.lz11.decompresser(cl), long), 'aller-retour LZ11 raté sur une longue répétition');
      var lz10 = new Uint8Array([0x10, 8, 0, 0, 8, 97, 98, 97, 98, (4 - 3) << 4 | 0, 2 - 1]);
      ok(String.fromCharCode.apply(null, F.lz11.decompresser(lz10)) === 'abababab', 'LZ10 écrit à la main mal lu');
      ok(leve(function () { F.lz11.decompresser(octets('abcd')); }), 'un flux sans octet de type doit lever une erreur');
      ok(leve(function () { F.lz11.decompresser(F.lz11.compresser(octets('abcdefgh')).subarray(0, 8)); }), 'un flux tronqué doit lever une erreur');
      ok(leve(function () { F.lz11.decompresser(new Uint8Array([0x11, 4, 0, 0, 0x80, 0x10, 0x05])); }), 'une référence hors du flux doit lever une erreur');
      ok(!F.lz11.estCompresse(new Uint8Array([0x11, 2, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40])), 'un fichier bien plus gros que sa taille annoncée n\'est pas du LZ');
      ok(!F.lz11.estCompresse(new Uint8Array([0x11, 8, 0, 0, 0x80, 0, 0, 0])), 'un flux qui commence par une référence n\'est pas du LZ');
    });

    section('Textes de X/Y, allers-retours, structure et erreurs', function () {
      var vide = new Uint8Array([1, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0x10, 0, 0, 0, 4, 0, 0, 0]);
      ok(egaux(F.texte.encoder([]), vide), 'fichier vide différent de celui de pk3DS');
      ok(F.texte.decoder(vide).length === 0, 'le fichier vide doit donner zéro ligne');
      var cent = []; for (var n = 0; n < 300; n++) cent.push('ligne ' + n + ', ça boucle');
      var jeux = [
        [''], ['Bonjour !'],
        ['Électhor', 'Pokémon', 'Œuf de Pikachu à éclore… peut-être', 'ça, là, où, Noël, garçon'],
        ['Première ligne\\nseconde ligne', 'Appuie sur A\\rpuis la suite\\c', 'Fin.'],
        ['[VAR TRNAME] a reçu [VAR ITEM1(0001)] !', '[VAR COLOR(0003)]rouge[VAR COLOR(0000)] et noir',
          '[VAR 0BAD(0002,FFFF)] variable sans nom', '[VAR NUM3(0000,0001,0002)]'],
        ['Attends…[WAIT 30] voilà.', '[~ 12]', 'Barre \\\\ et crochet \\[ ouvert ] fermé'],
        ['  espaces gardés  ', new Array(1001).join('a'), new Array(1002).join('b')],
        cent
      ];
      jeux.forEach(function (lignes) {
        var d = F.texte.encoder(lignes), lu = F.texte.decoder(d);
        ok(lu.length === lignes.length && lu.every(function (l, i) { return l === lignes[i]; }), 'aller-retour texte raté sur ' + JSON.stringify(lignes.slice(0, 2)));
        ok(egaux(F.texte.encoder(lu), d), 'réencodage différent sur ' + JSON.stringify(lignes.slice(0, 2)));
        ok(F.nature(d, 'x').type === 'texte', 'texte non reconnu par nature()');
      });
      var d = F.texte.encoder(['B', 'é']);
      function u16(p) { return d[p] | d[p + 1] << 8; }
      function u32(p) { return (u16(p) | u16(p + 2) << 16) >>> 0; }
      ok(u16(0) === 1 && u16(2) === 2 && u32(4) === 4 + 16 + 4 + 4 && u32(8) === 0 && u32(12) === 0x10, 'en-tête de deux lignes faux');
      ok(u32(0x14) === 4 + 16 && u16(0x18) === 2 && u32(0x1C) === 4 + 16 + 4 && u16(0x20) === 2, 'table des lignes fausse');
      ok(u16(0x10 + 20) === (66 ^ 0x7C89) && u16(0x10 + 22) === 0xE44B, 'clé de la ligne 0 fausse');
      ok(u16(0x10 + 24) === (0xE9 ^ 0xA60C), 'clé de la ligne 1 fausse');
      ok(F.texte.decoder(F.texte.encoder(['a\nb']))[0] === 'a\\nb', 'un vrai retour à la ligne doit valoir \\n');
      var s = F.texte.encoder(['Nidoran♂ et Nidoran♀…'], { symboles: true });
      ok(F.texte.decoder(s, { symboles: true })[0] === 'Nidoran♂ et Nidoran♀…', 'symboles du jeu mal relus');
      ok(F.texte.decoder(s)[0] === 'Nidoran et Nidoran', 'sans l\'option, les caractères privés doivent rester tels quels');
      [['[VAR TRNAME'], ['\\x'], ['[INCONNU 1]'], ['[VAR PASUNNOM]'], ['fin\\']].forEach(function (m) {
        ok(leve(function () { F.texte.encoder(m); }), JSON.stringify(m) + ' aurait dû être refusé');
      });
      ok(leve(function () { F.texte.decoder(F.texte.encoder(['abc']).subarray(0, -2)); }), 'un fichier tronqué aurait dû être refusé');
    });

    section('Textures : tuiles de 8 × 8 en ordre de Morton, formats simples', function () {
      var L = 16, H = 8, rgba = new Uint8ClampedArray(L * H * 4);
      for (var y = 0; y < H; y++) for (var x = 0; x < L; x++) { var i = (y * L + x) * 4; rgba[i] = x * 16; rgba[i + 1] = y * 32; rgba[i + 2] = 255 - x * 8; rgba[i + 3] = 255; }
      var brut = F.texture.encoder(rgba, 'RGBA8', L, H);
      // Le pixel (1, 0) est le deuxième stocké, (0, 1) le troisième, (2, 0) le cinquième, (8, 0) le 65e.
      function stocke(k) { return [brut[k * 4 + 3], brut[k * 4 + 2], brut[k * 4 + 1], brut[k * 4]]; }
      ok(stocke(1)[0] === 16 && stocke(1)[1] === 0, 'Morton : le 2e pixel stocké doit être (1, 0)');
      ok(stocke(2)[0] === 0 && stocke(2)[1] === 32, 'Morton : le 3e pixel stocké doit être (0, 1)');
      ok(stocke(4)[0] === 32 && stocke(4)[1] === 0, 'Morton : le 5e pixel stocké doit être (2, 0)');
      ok(stocke(64)[0] === 128 && stocke(64)[1] === 0, 'la deuxième tuile doit commencer à (8, 0)');
      ok(brut[0] === 255 && brut[3] === 0 && brut[1] === 255, 'RGBA8 se stocke A, B, G, R');
      ok(egaux(F.texture.decoder(brut, 'RGBA8', L, H), rgba), 'aller-retour RGBA8 raté');
      ['RGB8', 'RGB565', 'RGBA5551', 'RGBA4', 'LA8', 'L8', 'LA4', 'L4'].forEach(function (f) {
        var r = F.texture.decoder(F.texture.encoder(rgba, f, L, H), f, L, H), pire = 0;
        var gris = f.charAt(0) === 'L';
        for (var k = 0; k < rgba.length; k += 4) {
          if (gris) { var l = Math.round(0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2]); pire = Math.max(pire, Math.abs(r[k] - l)); }
          else for (var c = 0; c < 3; c++) pire = Math.max(pire, Math.abs(r[k + c] - rgba[k + c]));
        }
        var tolere = /4$/.test(f) ? 9 : /565|5551/.test(f) ? 5 : 1;
        ok(pire <= tolere, 'aller-retour ' + f + ' trop loin (écart ' + pire + ')');
      });
      var a4 = F.texture.decoder(new Uint8Array(32).fill(0x0F, 0, 1), 'A4', 2, 1);
      ok(a4[3] === 255 && a4[7] === 0, 'A4 : le pixel pair est dans le quartet bas');
      var la8 = F.texture.decoder(new Uint8Array(128).fill(0).map(function (v, k) { return k % 2 ? 200 : 100; }), 'LA8', 8, 8);
      ok(la8[0] === 200 && la8[3] === 100, 'LA8 se stocke A puis L');
      ok(leve(function () { F.texture.decoder(new Uint8Array(10), 'RGBA8', 8, 8); }), 'une texture trop courte doit lever une erreur');
    });

    section('ETC1 et ETC1A4 : blocs de 4 × 4 lus en petit-boutiste', function () {
      // Mode individuel, couleur 1 = (15, 0, 0) soit (255, 0, 0), couleur 2 = (0, 0, 15), tables 0,
      // pas de retournement : la moitié gauche est rouge + 2, la droite bleue + 2 ; un pixel à « -8 ».
      function bloc(hi, lo) { return [lo & 255, lo >>> 8 & 255, lo >>> 16 & 255, lo >>> 24 & 255, hi & 255, hi >>> 8 & 255, hi >>> 16 & 255, hi >>> 24 & 255]; }
      var hi = (15 << 28 | 0 << 24 | 0 << 20 | 0 << 16 | 0 << 12 | 15 << 8) >>> 0;
      var lo = (1 << (0 * 4 + 1)) | (1 << (16 + 0 * 4 + 1));   // texel (0, 1) : grand modificateur, négatif
      var b = bloc(hi, lo), vide = bloc(0, 0);
      var tuile = [].concat(b, vide, vide, vide);
      var r = F.texture.decoder(new Uint8Array(tuile), 'ETC1', 8, 8);
      function px(x, y) { var i = (y * 8 + x) * 4; return [r[i], r[i + 1], r[i + 2], r[i + 3]].join(','); }
      ok(px(0, 0) === '255,2,2,255', 'ETC1 : (0, 0) doit valoir 255,2,2 et non ' + px(0, 0));
      ok(px(0, 1) === '247,0,0,255', 'ETC1 : (0, 1) doit valoir 247,0,0 et non ' + px(0, 1));
      ok(px(3, 3) === '2,2,255,255', 'ETC1 : (3, 3) doit valoir 2,2,255 et non ' + px(3, 3));
      ok(px(4, 0) === '2,2,2,255', 'ETC1 : le 2e bloc de la tuile est à droite du premier');
      // Mode différentiel et retournement : couleur (16, 8, 0) en 5 bits, delta (-1, 0, +3), tables 7 et 0.
      var hd = (16 << 27 | 7 << 24 | 8 << 19 | 0 << 16 | 0 << 11 | 3 << 8 | 7 << 5 | 0 << 2 | 1 << 1 | 1) >>> 0;
      var r2 = F.texture.decoder(new Uint8Array([].concat(vide, vide, bloc(hd, 0), vide)), 'ETC1', 8, 8);
      function px2(x, y) { var i = (y * 8 + x) * 4; return [r2[i], r2[i + 1], r2[i + 2]].join(','); }
      ok(px2(0, 4) === [Math.min(255, 132 + 47), 66 + 47, 47].join(','), 'ETC1 différentiel : haut du bloc faux (' + px2(0, 4) + ')');
      ok(px2(3, 6) === [123 + 2, 66 + 2, 24 + 2].join(','), 'ETC1 différentiel retourné : bas du bloc faux (' + px2(3, 6) + ')');
      // ETC1A4 : 8 octets d'alpha avant chaque bloc, quartet du texel x * 4 + y.
      var alpha = [0x0F, 0, 0, 0, 0, 0, 0, 0xF0];   // texel 0 opaque, texel 15 (3, 3) opaque, le reste transparent
      var r3 = F.texture.decoder(new Uint8Array([].concat(alpha, b, alpha, vide, alpha, vide, alpha, vide)), 'ETC1A4', 8, 8);
      ok(r3[3] === 255 && r3[(1 * 8 + 0) * 4 + 3] === 0 && r3[(3 * 8 + 3) * 4 + 3] === 255, 'ETC1A4 : alpha mal placé');
    });

    section('BCLIM et paquet mini', function () {
      var L = 24, H = 10, rgba = new Uint8ClampedArray(L * H * 4);
      for (var k = 0; k < rgba.length; k += 4) { rgba[k] = k % 256; rgba[k + 1] = 80; rgba[k + 2] = 160; rgba[k + 3] = 255; }
      var f = F.bclim.ecrire(rgba, L, H, 'RGBA8');
      var nat = F.nature(f, 'x.bclim');
      ok(nat.type === 'bclim' && nat.largeur === 24 && nat.hauteur === 10, 'BCLIM non reconnu');
      ok(F.nature(f.subarray(0, 64), 'x', f.length, f.subarray(f.length - 0x28)).type === 'bclim', 'BCLIM non reconnu par son seul pied de page');
      var lu = F.bclim.lire(f);
      ok(lu.largeur === L && lu.hauteur === H && egaux(lu.rgba, rgba), 'aller-retour BCLIM raté');
      ok(lu.stockee === '32 × 16', 'un BCLIM se stocke aux puissances de deux');
      var m = F.mini.ecrire('PC', [octets('BCH\0abcdef'), octets('xyz')]);
      var nm = F.nature(m, 'x');
      ok(nm.type === 'mini' && nm.nombre === 2, 'paquet mini non reconnu');
      var lm = F.mini.lire(m);
      ok(lm.fichiers.length === 2 && F.nature(lm.fichiers[0]).type === 'bch', 'paquet mini mal ouvert');
      ok(F.nature(octets('ABCDxxxxxxxxxxxxxxxx')).type === 'inconnu', 'un magic inconnu doit rester inconnu');
      ok(F.nature(new Uint8Array(0)).type === 'vide', 'un fichier vide doit être dit vide');
    });

    section('Zip sans compression', function () {
      ok(F.zip.crc32(octets('123456789')) === 0xCBF43926, 'CRC-32 de « 123456789 » faux');
      var morceaux = F.zip.ecrire([{ nom: 'a.bin', octets: octets('abc') }, { nom: 'é/b.txt', octets: new Uint8Array(0) }]);
      var total = morceaux.reduce(function (s, m) { return s + m.length; }, 0);
      ok(total === (30 + 5 + 3) + (30 + 8) + (46 + 5) + (46 + 8) + 22, 'taille du zip inattendue : ' + total);
    });

    journal(rates ? reussis + ' vérifications bonnes, ' + rates + ' ratées.' : 'Les ' + reussis + ' vérifications sont bonnes.', rates > 0);
    return rates;
  }

  racine.lancerTests = lancer;
  if (typeof module !== 'undefined' && module.exports && typeof require !== 'undefined' && require.main === module) {
    var F = require('./formats.js');
    var rates = lancer(F, function (m) { console.log(m); });
    process.exitCode = rates ? 1 : 0;
  }
})(typeof window !== 'undefined' ? window : globalThis);
