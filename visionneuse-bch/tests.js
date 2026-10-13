// Tests de la visionneuse BCH, à lancer par « node tests.js » depuis ce dossier.
// Sans fichier de jeu, on teste ce qu'on sait fabriquer : décodeurs de textures sur des blocs dont on
// connaît la réponse, ordre de Morton, commandes GPU, courbes d'animation, et un BCH entier écrit
// par fabrique.js (un cube texturé à un os) en version 7 et en version 0x21.
'use strict';
var BCH = require('./bch.js');
var Fab = require('./fabrique.js');
var I = BCH._interne;

var reussis = 0, rates = 0;
function test(nom, f) {
  try { f(); reussis++; console.log('  ok   ' + nom); }
  catch (e) { rates++; console.log('  RATÉ ' + nom + '\n       ' + (e && e.message)); }
}
function egal(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' : attendu ' + JSON.stringify(b) + ', obtenu ' + JSON.stringify(a)); }
function proche(a, b, tol, msg) { if (!(Math.abs(a - b) <= (tol || 1e-5))) throw new Error((msg || '') + ' : attendu ' + b + ', obtenu ' + a); }
function pixel(rgba, l, x, y) { var o = (y * l + x) * 4; return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]; }
function memePixel(a, b, msg) { egal(a.join(','), b.join(','), msg); }

// Position mémoire k → pixel (x, y) en mémoire, recopié de la table SwizzleLUT de SPICA (y × 8 + x).
var LUT = [0, 1, 8, 9, 2, 3, 10, 11, 16, 17, 24, 25, 18, 19, 26, 27, 4, 5, 12, 13, 6, 7, 14, 15, 20, 21, 28, 29, 22, 23, 30, 31,
  32, 33, 40, 41, 34, 35, 42, 43, 48, 49, 56, 57, 50, 51, 58, 59, 36, 37, 44, 45, 38, 39, 46, 47, 52, 53, 60, 61, 54, 55, 62, 63];

console.log('Ordre de Morton');
test('les 64 positions d’une tuile suivent la table de SPICA', function () {
  for (var k = 0; k < 64; k++) { var p = I.morton(k); egal(p.y * 8 + p.x, LUT[k], 'pixel ' + k); }
});

console.log('Formats directs (une tuile de 8 × 8)');
// Le pixel mémoire k va en (x, 7 − y) dans l'image : la première ligne de tuiles est le bas.
function decoder(format, octets) { return I.decoderTexture(new Uint8Array(octets), 8, 8, format); }
function ou(k) { var p = I.morton(k); return [p.x, 7 - p.y]; }
function verifier(format, taille, k, octetsPixel, attendu) {
  var oct = new Array(64 * taille).fill(0);
  for (var i = 0; i < octetsPixel.length; i++) oct[k * taille + i] = octetsPixel[i];
  var img = decoder(format, oct), xy = ou(k);
  memePixel(pixel(img, 8, xy[0], xy[1]), attendu, I.FORMATS_TEXTURE[format] + ' pixel ' + k);
}
test('RGBA8 : octets A, B, G, R', function () { verifier(0, 4, 5, [0x80, 0x30, 0x20, 0x10], [0x10, 0x20, 0x30, 0x80]); });
test('RGB8 : octets B, G, R', function () { verifier(1, 3, 9, [0x30, 0x20, 0x10], [0x10, 0x20, 0x30, 255]); });
test('RGBA5551 : R en haut, alpha sur le bit 0', function () {
  var v = (31 << 11) | (0 << 6) | (16 << 1) | 1;
  verifier(2, 2, 2, [v & 0xff, v >> 8], [255, 0, 132, 255]);
  var w = (8 << 11) | (31 << 6) | (0 << 1) | 0;
  verifier(2, 2, 63, [w & 0xff, w >> 8], [66, 255, 0, 0]);
});
test('RGB565 : R en haut, vert sur 6 bits', function () {
  var v = (0 << 11) | (32 << 5) | 31;
  verifier(3, 2, 7, [v & 0xff, v >> 8], [0, 130, 255, 255]);
});
test('RGBA4 : R, G, B, A du quartet haut au quartet bas', function () { verifier(4, 2, 12, [0x34, 0x12], [17, 34, 51, 68]); });
test('LA8 : octets A, L', function () { verifier(5, 2, 1, [0x40, 0xc0], [0xc0, 0xc0, 0xc0, 0x40]); });
test('HiLo8 : rouge = second octet, vert = premier', function () { verifier(6, 2, 3, [0x11, 0x22], [0x22, 0x11, 0, 255]); });
test('L8', function () { verifier(7, 1, 40, [0x5a], [0x5a, 0x5a, 0x5a, 255]); });
test('A8', function () { verifier(8, 1, 41, [0x5a], [255, 255, 255, 0x5a]); });
test('LA4 : luminance en haut, alpha en bas', function () { verifier(9, 1, 17, [0xa3], [170, 170, 170, 51]); });
test('L4 et A4 : le quartet bas est le premier pixel', function () {
  var oct = new Array(32).fill(0); oct[0] = 0x21;
  var img = decoder(10, oct);
  memePixel(pixel(img, 8, 0, 7), [17, 17, 17, 255], 'L4 pixel 0');
  memePixel(pixel(img, 8, 1, 7), [34, 34, 34, 255], 'L4 pixel 1');
  img = decoder(11, oct);
  memePixel(pixel(img, 8, 1, 7), [255, 255, 255, 34], 'A4 pixel 1');
});
test('une texture de 16 × 8 range ses tuiles de gauche à droite', function () {
  var oct = new Array(16 * 8).fill(0); oct[64] = 0x77; // premier pixel de la seconde tuile
  var img = I.decoderTexture(new Uint8Array(oct), 16, 8, 7);
  memePixel(pixel(img, 16, 8, 7), [0x77, 0x77, 0x77, 255]);
});

console.log('ETC1 et ETC1A4');
function mot(t, v) { t.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
test('mode individuel, deux moitiés côte à côte, tables 0 et 7', function () {
  // R1 = F, R2 = 0, G1 = G2 = 8, B1 = 0, B2 = F ; table 0 à gauche, 7 à droite
  var haut = ((0xf << 28) | (0x0 << 24) | (0x8 << 20) | (0x8 << 16) | (0x0 << 12) | (0xf << 8) | (0 << 5) | (7 << 2)) >>> 0;
  // pixel (3, 0) : i = 12, indice 3 (−183) ; pixel (1, 2) : i = 6, indice 1 (+8)
  var bas = ((1 << 12) | (1 << (16 + 12)) | (1 << 6)) >>> 0;
  var oct = []; mot(oct, bas); mot(oct, haut);
  while (oct.length < 32) oct.push(0);
  var img = I.decoderTexture(new Uint8Array(oct), 8, 8, 12);
  memePixel(pixel(img, 8, 0, 7), [255, 138, 2, 255], '(0, 0) : gauche, +2');
  memePixel(pixel(img, 8, 3, 7), [0, 0, 72, 255], '(3, 0) : droite, −183');
  memePixel(pixel(img, 8, 1, 5), [255, 144, 8, 255], '(1, 2) : gauche, +8');
});
test('mode différentiel, moitiés empilées', function () {
  // R = 16, dR = −1 ; G = 31, dG = 0 ; B = 0, dB = +3 ; tables 1 et 2 ; drapeau de bascule
  var haut = ((16 << 27) | (7 << 24) | (31 << 19) | (0 << 16) | (0 << 11) | (3 << 8) | (1 << 5) | (2 << 2) | 2 | 1) >>> 0;
  var oct = []; mot(oct, 0); mot(oct, haut);
  while (oct.length < 32) oct.push(0);
  var img = I.decoderTexture(new Uint8Array(oct), 8, 8, 12);
  memePixel(pixel(img, 8, 2, 6), [137, 255, 5, 255], '(2, 1) : moitié du haut, +5');
  memePixel(pixel(img, 8, 1, 4), [132, 255, 33, 255], '(1, 3) : moitié du bas, +9');
});
test('ETC1A4 : alpha par quartets, colonne par colonne ; blocs rangés en Z', function () {
  var oct = [];
  mot(oct, (0xa << 24) >>> 0); mot(oct, (0x5 << 28) >>> 0);               // (1, 2) → 0xA, (3, 3) → 0x5
  mot(oct, 0); mot(oct, ((0xf << 28) | (0xf << 24)) >>> 0);               // rouge plein + 2
  mot(oct, 0xffffffff); mot(oct, 0xffffffff);                             // second bloc : opaque
  mot(oct, 0); mot(oct, ((0xf << 12) | (0xf << 8)) >>> 0);                // bleu plein + 2
  while (oct.length < 64) oct.push(0);
  var img = I.decoderTexture(new Uint8Array(oct), 8, 8, 13);
  memePixel(pixel(img, 8, 1, 5), [255, 2, 2, 0xaa], 'alpha de (1, 2)');
  memePixel(pixel(img, 8, 3, 4), [255, 2, 2, 0x55], 'alpha de (3, 3)');
  memePixel(pixel(img, 8, 0, 7), [255, 2, 2, 0], 'alpha nul ailleurs');
  memePixel(pixel(img, 8, 5, 7), [2, 2, 255, 255], 'le second bloc est à droite (x = 4 à 7)');
});

console.log('Commandes GPU PICA200');
test('écritures simples, consécutives, à paramètres multiples, remplissage, uniformes 32 et 24 bits', function () {
  function tete(reg, extra, cons) { return (reg | (0xf << 16) | (extra << 20) | (cons ? 0x80000000 : 0)) >>> 0; }
  var dv = new DataView(new ArrayBuffer(4));
  function f(x) { dv.setFloat32(0, x); return dv.getUint32(0); }
  var m24 = I.motsVecteur24(1.5, -2, 0.25, 8);
  var mots = [
    0x12345678, tete(0x82, 0),
    1, tete(0x201, 2, true), 2, 3,
    7, tete(0x227, 1), 9, 0,
    0x80000006, tete(0x2c0, 0),
    f(4), tete(0x2c1, 3), f(3), f(2), f(1), 0,
    5, tete(0x2c0, 0),
    m24[0], tete(0x2c1, 2), m24[1], m24[2]
  ];
  var r = I.lireCommandes(new Uint32Array(mots));
  egal(r.registres[0x82], 0x12345678, '0x82');
  egal(r.registres[0x201], 1, '0x201'); egal(r.registres[0x202], 2, '0x202'); egal(r.registres[0x203], 3, '0x203');
  egal(r.registres[0x227], 7, '0x227');
  var c = r.commandes.filter(function (x) { return x.registre === 0x227; })[0];
  egal(c.params.join(','), '7,9', 'paramètres de 0x227');
  egal([r.uniformes[24], r.uniformes[25], r.uniformes[26], r.uniformes[27]].join(','), '1,2,3,4', 'uniforme 6 (x, y, z, w)');
  proche(r.uniformes[20], 1.5, 1e-4, 'u5.x'); proche(r.uniformes[21], -2, 1e-4, 'u5.y');
  proche(r.uniformes[22], 0.25, 1e-4, 'u5.z'); proche(r.uniformes[23], 8, 1e-4, 'u5.w');
});
test('flottants de 24 bits', function () {
  [0, 1, -1, 0.001, 1 / 127, 3.75, -1234.5].forEach(function (v) { proche(I.flottant24(I.flottantVers24(v)), v, Math.abs(v) * 2e-5 + 1e-12, String(v)); });
  egal(I.flottant24(0x3f0000), 1, '0x3F0000 vaut 1');
});

console.log('Courbes d’animation');
function lecteur(octets) { return new I.Lecteur(new Uint8Array(octets)); }
function f32le(t, x) { var d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); for (var i = 0; i < 4; i++) t.push(d.getUint8(i)); }
test('les huit quantifications', function () {
  var t = []; f32le(t, 3); f32le(t, 0.5); f32le(t, -1); f32le(t, 2);
  var k = I.lireCles(lecteur(t), 0, 0, 1, 1, 1, 0)[0];
  egal([k.image, k.valeur, k.pente, k.penteSortie].join(','), '3,0.5,-1,2', 'Hermite128');
  t = []; mot(t, (10 | (1000 << 12)) >>> 0); t.push(0x00, 0x01, 0x80, 0xff); // pentes 256/256 = 1 et −128/256
  k = I.lireCles(lecteur(t), 0, 1, 1, 0.5, 0.01, 1)[0];
  egal([k.image, k.valeur, k.pente, k.penteSortie].join(','), '5,11,1,-0.5', 'Hermite64');
  t = [7, 0x34, 0x12, 0x20, 0x00, 0xff]; // pentes : 0x020 = 32/32 = 1 ; 0xFF0 → −16/32
  k = I.lireCles(lecteur(t), 0, 2, 1, 1, 1, 0)[0];
  egal([k.image, k.valeur, k.pente, k.penteSortie].join(','), '7,4660,1,-0.5', 'Hermite48');
  t = []; f32le(t, 4); f32le(t, 9); f32le(t, 0.25);
  k = I.lireCles(lecteur(t), 0, 3, 1, 1, 1, 0)[0];
  egal([k.image, k.valeur, k.pente, k.penteSortie].join(','), '4,9,0.25,0.25', 'UnifiedHermite96');
  t = [64, 0, 100, 0, 0x80, 0xff];
  k = I.lireCles(lecteur(t), 0, 4, 1, 1, 1, 0)[0];
  egal([k.image, k.valeur, k.pente].join(','), '2,100,-0.5', 'UnifiedHermite48');
  t = [12, 0x23, 0x01, 0xff]; // valeur 0x123, pente : 0xFF0 → −16/32
  k = I.lireCles(lecteur(t), 0, 5, 1, 1, 1, 0)[0];
  egal([k.image, k.valeur, k.pente].join(','), '12,291,-0.5', 'UnifiedHermite32');
  t = []; f32le(t, 6); f32le(t, -3);
  k = I.lireCles(lecteur(t), 0, 6, 1, 1, 1, 0)[0];
  egal([k.image, k.valeur].join(','), '6,-3', 'StepLinear64');
  t = []; mot(t, (4095 | (0xfffff << 12)) >>> 0);
  k = I.lireCles(lecteur(t), 0, 7, 1, 1, 1, -1)[0];
  egal([k.image, k.valeur].join(','), '4095,1048574', 'StepLinear32');
});
function courbe(interp, cles) { return { interpolation: interp, cles: cles.map(function (c) { return { image: c[0], valeur: c[1], pente: c[2] || 0, penteSortie: c[3] || 0 }; }) }; }
test('palier, linéaire, bornes', function () {
  var c = courbe(1, [[0, 0], [10, 5], [20, 5]]);
  proche(I.valeurCourbe(c, 4), 2); proche(I.valeurCourbe(c, 15), 5); proche(I.valeurCourbe(c, -3), 0); proche(I.valeurCourbe(c, 30), 5);
  c = courbe(0, [[0, 1], [10, 2]]);
  proche(I.valeurCourbe(c, 9.9), 1); proche(I.valeurCourbe(c, 10), 2);
});
test('Hermite : comparé à la formule de Bernstein', function () {
  var g = [2, 1, 0, 0.3], d = [8, 4, -0.2, 0];
  var c = courbe(2, [g, d]);
  [2, 3.5, 5, 7.9].forEach(function (f) {
    var t = (f - 2) / 6, h = 6;
    var attendu = (2 * t * t * t - 3 * t * t + 1) * 1 + (t * t * t - 2 * t * t + t) * h * 0.3 + (-2 * t * t * t + 3 * t * t) * 4 + (t * t * t - t * t) * h * -0.2;
    proche(I.valeurCourbe(c, f), attendu, 1e-9, 'image ' + f);
  });
});
test('les deux mises en page d’une courbe (SPICA avant 0x20, Ohana)', function () {
  // forme 0x20 et plus : en-tête de 12 octets puis champs en ligne
  var t = []; f32le(t, 0); f32le(t, 10); mot(t, 0);
  t.push(1, 6, 2, 0); f32le(t, 1); f32le(t, 0); f32le(t, 1); f32le(t, 0.1); mot(t, 36);
  f32le(t, 0); f32le(t, 0); f32le(t, 10); f32le(t, 4);
  var c = I.lireCourbe(lecteur(t), 0, 0x21);
  proche(I.valeurCourbe(c, 5), 2, 1e-6, 'forme récente');
  // même courbe en version 7 lue sans bloc intérieur : on retombe sur la forme d'Ohana
  var drap = {};
  c = I.lireCourbe(lecteur(t), 0, 7, drap);
  proche(I.valeurCourbe(c, 5), 2, 1e-6, 'forme Ohana');
  egal(drap.courbeOhana, true, 'signalée');
  // forme ancienne de SPICA : pointeur vers un bloc qui répète début et fin
  t = []; f32le(t, 0); f32le(t, 10); mot(t, 0); mot(t, 16);
  f32le(t, 0); f32le(t, 10); t.push(1, 6, 2, 0); f32le(t, 0.1); f32le(t, 1); f32le(t, 0); f32le(t, 1); mot(t, 48);
  f32le(t, 0); f32le(t, 0); f32le(t, 10); f32le(t, 4);
  drap = {};
  c = I.lireCourbe(lecteur(t), 0, 7, drap);
  proche(I.valeurCourbe(c, 5), 2, 1e-6, 'forme ancienne');
  egal(drap.courbeOhana, undefined, 'non signalée');
});

console.log('Un BCH entier fabriqué : le cube à un os');
[0x21, 7].forEach(function (version) {
  var octets = Fab.cube({ version: version });
  var nom = 'version 0x' + version.toString(16);
  var m;
  test(nom + ' : reconnu et lu', function () {
    egal(BCH.estBCH(octets), true, 'estBCH');
    m = BCH.lire(octets);
    egal(m.nom, 'cube_de_test', 'nom');
    egal(m.version.retro, version, 'version');
    egal(m.avertissements.length, 0, 'avertissements : ' + m.avertissements.join(' / '));
  });
  if (!m) return;
  test(nom + ' : maillages, attributs, sous-maillages', function () {
    egal(m.maillages.length, 2);
    var corps = m.maillages[0], couv = m.maillages[1];
    egal(corps.nom, 'cube_corps'); egal(couv.nom, 'cube_couvercle');
    egal(corps.sommets, 20); egal(corps.faces, 10);
    egal(couv.sommets, 4); egal(couv.faces, 2, 'la bande de 4 indices donne 2 triangles');
    egal(corps.sousMaillages[0].peau, 'lisse'); egal(couv.sousMaillages[0].peau, 'rigide');
    egal(corps.attributs.map(function (a) { return a.nom + ':' + a.format; }).join(' '), 'position:flottant normale:flottant uv0:court couleur:octet os:octet poids:octet');
    egal(couv.attributs.filter(function (a) { return a.fixe; }).length, 2, 'attributs fixes');
    // premier sommet de la face avant : (−1, 0, 1), UV (0, 0) ; le troisième : (1, 2, 1), UV (1, 1)
    egal(Array.from(corps.positions.slice(6, 9)).join(','), '1,2,1');
    egal(Array.from(corps.uvs.slice(4, 6)).join(','), '1,1');
    proche(corps.poids[0], 1, 1e-6, 'poids × 0,01');
    proche(corps.couleurs[3], 1, 1e-6, 'alpha ÷ 255');
    // couvercle en espace de l'os : y = 500 × 0,001 + 0,5 (uniformes en 24 bits)
    proche(couv.positions[1], 1, 1e-4, 'y local du couvercle');
    proche(couv.normales[1], 1, 1e-6, 'normale ÷ 127');
    proche(couv.couleurs[1], 0.94, 1e-3, 'couleur fixe');
    egal(couv.uvs[2], 1, 'UV flottant aligné sur 2 octets');
  });
  test(nom + ' : textures RGBA8 et ETC1A4', function () {
    egal(m.textures.length, 2);
    var caisse = m.textures[0], couv = m.textures[1];
    egal(caisse.nom + ' ' + caisse.format + ' ' + caisse.largeur + '×' + caisse.hauteur, 'caisse RGBA8 64×64');
    var ref = Fab.imageCaisse(64), diff = 0;
    for (var i = 0; i < ref.length; i++) if (ref[i] !== caisse.rgba[i]) diff++;
    egal(diff, 0, 'pixels de la caisse');
    egal(couv.format, 'ETC1A4');
    var refC = Fab.imageCouvercle(32);
    for (var j = 3; j < refC.length; j += 4) if (Math.round(refC[j] / 17) * 17 !== couv.rgba[j]) throw new Error('alpha du couvercle au pixel ' + (j >> 2));
    memePixel(pixel(couv.rgba, 32, 0, 0), [104, 70, 36, 255], 'bord du couvercle (6, 4, 2) × 17 + 2');
  });
  test(nom + ' : matériaux', function () {
    egal(m.materiaux.map(function (x) { return x.nom + '>' + x.textures[0]; }).join(' '), 'mat_caisse>caisse mat_couvercle>couvercle');
    egal(m.materiaux[1].alphaTest.actif, true, 'test alpha du couvercle');
    egal(m.materiaux[1].alphaTest.fonction, 7);
    proche(m.materiaux[1].alphaTest.reference, 128 / 255);
    egal(m.materiaux[0].alphaTest.actif, false);
    egal(m.materiaux[0].melange.actif, false);
    egal(m.materiaux[0].enveloppes[0].u, 2, 'enveloppe en répétition');
  });
  test(nom + ' : squelette et pose de repos', function () {
    egal(m.squelette.length, 1);
    egal(m.squelette[0].nom, 'racine');
    egal(m.squelette[0].parent, -1);
    proche(m.squelette[0].monde[13], 1, 1e-6, 'os en y = 1');
  });
  test(nom + ' : animations à courbes, quantifiées et par images', function () {
    egal(m.animations.map(function (a) { return a.nom + ':' + a.images; }).join(' '), 'tourne:60 hoche:40 saute:30');
    var tourne = m.animations[0], hoche = m.animations[1], saute = m.animations[2];
    var w = I.poseAnimee(m.squelette, tourne, 15)[0];
    proche(w[13], 1.125, 1e-6, 'translation Y en Hermite à l’image 15');
    proche(w[0], 0, 1e-6, 'rotation d’un quart de tour'); proche(w[8], 1, 1e-6, 'rotation d’un quart de tour');
    w = I.poseAnimee(m.squelette, hoche, 10)[0];
    proche(w[12], -0.3, 1e-5, 'palier en X à l’image 10');
    proche(w[0], 1, 1e-4, 'rotation Z nulle au milieu');
    w = I.poseAnimee(m.squelette, hoche, 20)[0];
    proche(w[12], 0.3, 1e-5, 'palier en X à l’image 20');
    proche(Math.atan2(w[1], w[0]), 0.25, 1e-4, 'rotation Z de 0,25 à l’image 20');
    w = I.poseAnimee(m.squelette, saute, 15)[0];
    proche(w[13], 1.8, 1e-5, 'saut à mi-course');
  });
  test(nom + ' : peau lisse et rigide', function () {
    var mondes = I.poseAnimee(m.squelette, m.animations[0], 15);
    var peaux = I.matricesPeau(m.squelette, mondes);
    var corps = m.maillages[0], couv = m.maillages[1];
    var P = new Float32Array(corps.sommets * 3);
    I.appliquerPeau(corps, peaux, P, null);
    // sommet 1 : (1, 0, 1) → monde × inverse → (1, 0,125, −1)
    proche(P[3], 1, 1e-5); proche(P[4], 0.125, 1e-5); proche(P[5], -1, 1e-5);
    var Q = new Float32Array(couv.sommets * 3);
    I.appliquerPeau(couv, peaux, Q, null);
    // sommet 0 du couvercle : (−1, 1, 1) dans l'os → (1, 2,125, 1)
    proche(Q[0], 1, 1e-4); proche(Q[1], 2.125, 1e-4); proche(Q[2], 1, 1e-4);
    // au repos, le couvercle se pose sur le corps (y = 2)
    I.appliquerPeau(couv, I.matricesPeau(m.squelette, m.squelette.map(function (b) { return b.monde; })), Q, null);
    proche(Q[1], 2, 1e-4, 'couvercle au repos');
  });
});

console.log('Refus');
test('un fichier qui n’est pas un BCH lève une erreur en français', function () {
  var e = null;
  try { BCH.lire(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])); } catch (x) { e = x; }
  if (!e || !/BCH/.test(e.message)) throw new Error('pas d’erreur claire');
  egal(BCH.estBCH(new Uint8Array([0x42, 0x43, 0x48, 0])), true);
  egal(BCH.estBCH(new Uint8Array([0x42, 0x43, 0x48])), false);
});
test('un BCH tronqué lève une erreur au lieu de planter', function () {
  var oct = Fab.cube({ version: 0x21 }).slice(0, 300);
  var e = null;
  try { BCH.lire(oct); } catch (x) { e = x; }
  if (!e || !/tronqué|hors du fichier/.test(e.message)) throw new Error('message : ' + (e && e.message));
});

console.log('\n' + reussis + ' tests réussis, ' + rates + ' ratés.');
process.exit(rates ? 1 : 0);
